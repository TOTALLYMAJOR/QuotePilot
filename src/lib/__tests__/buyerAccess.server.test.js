import { createRequire } from "node:module";
import { describe, expect, test } from "vitest";

const require = createRequire(import.meta.url);
const {
  BUYER_ACCESS_AMOUNT_CENTS,
  BUYER_ACCESS_CURRENCY,
  BUYER_ACCESS_PLAN,
  BuyerAccessError,
  assertBuyerAccessRuntime,
  assertBuyerAccessSessionBinding,
  buildBuyerAccessCheckout,
  buildBuyerAccessIdentifiers,
  buildBuyerAccessReturnUrls,
  buyerAccessOrderIdForUid,
  buyerAccessStatusResponse,
  neutralizeBuyerAccessCheckoutSession,
  normalizeBuyerAccessRequest,
  planBuyerAccessTransition
} = require("../../../functions/buyerAccess.js");

const order = {
  orderId: buyerAccessOrderIdForUid("verified-owner-uid"),
  flow: "buyer_access",
  ownerUid: "verified-owner-uid",
  ownerEmail: "owner@example.com",
  organizationId: "acme-events-1234567890abcdef1234567890abcdef",
  organizationName: "Acme Events",
  checkoutGeneration: 1,
  stripeSessionId: "cs_test_buyer_access_101",
  status: "checkout_pending",
  accessGranted: false
};

const session = {
  id: order.stripeSessionId,
  livemode: false,
  mode: "payment",
  status: "open",
  payment_status: "unpaid",
  amount_total: BUYER_ACCESS_AMOUNT_CENTS,
  currency: BUYER_ACCESS_CURRENCY,
  invoice_creation: { enabled: true },
  client_reference_id: order.orderId,
  customer_email: order.ownerEmail,
  metadata: {
    flow: "buyer_access",
    buyerAccessOrderId: order.orderId,
    ownerUid: order.ownerUid,
    checkoutGeneration: "1",
    plan: BUYER_ACCESS_PLAN
  }
};

describe("buyer access server contract", () => {
  test("fails closed unless the exact enable flag and Stripe test mode are configured", () => {
    expect(assertBuyerAccessRuntime({ enabled: " true ", stripeMode: " TEST " })).toEqual({
      enabled: true,
      stripeMode: "test"
    });
    expect(() => assertBuyerAccessRuntime({ enabled: "false", stripeMode: "test" }))
      .toThrow(/not enabled/i);
    expect(() => assertBuyerAccessRuntime({ enabled: "true", stripeMode: "live" }))
      .toThrow(/test mode/i);
  });

  test("accepts only bounded organization and owner names", () => {
    expect(normalizeBuyerAccessRequest({
      organizationName: "  Acme   Events  ",
      ownerName: "  Avery   Owner "
    })).toEqual({
      organizationName: "Acme Events",
      ownerName: "Avery Owner"
    });
    expect(() => normalizeBuyerAccessRequest({ organizationName: "A", ownerName: "Owner" }))
      .toThrow(BuyerAccessError);
    expect(() => normalizeBuyerAccessRequest({ organizationName: "Acme", ownerName: "A\u0000B" }))
      .toThrow(/ownerName/);
    expect(() => normalizeBuyerAccessRequest({
      organizationName: "Acme",
      ownerName: "Owner",
      amountCents: 0,
      plan: "enterprise",
      successUrl: "https://attacker.example.test"
    })).toThrow(/server-owned/);
  });

  test("derives a stable owner order and collision-resistant server organization identity", () => {
    const first = buildBuyerAccessIdentifiers({
      uid: "verified-owner-uid",
      organizationName: "Acme Events",
      randomUUID: () => "12345678-90ab-cdef-1234-567890abcdef"
    });
    const second = buildBuyerAccessIdentifiers({
      uid: "verified-owner-uid",
      organizationName: "Acme Events",
      randomUUID: () => "abcdefab-cdef-abcd-efab-cdefabcdefab"
    });
    expect(first.orderId).toBe(second.orderId);
    expect(first.organizationId).toBe("acme-events-1234567890abcdef1234567890abcdef");
    expect(second.organizationId).not.toBe(first.organizationId);
  });

  test("builds fixed one-dollar invoiced Checkout without client-controlled payment methods", () => {
    const checkout = buildBuyerAccessCheckout({
      appBaseUrl: "https://quotepilot.mbmapps.com/app",
      generation: 1,
      orderId: order.orderId,
      organizationName: order.organizationName,
      ownerEmail: order.ownerEmail,
      ownerUid: order.ownerUid
    });
    expect(checkout.idempotencyKey).toBe(`buyer-access-${order.orderId}-g1`);
    expect(checkout.params).toMatchObject({
      mode: "payment",
      client_reference_id: order.orderId,
      customer_email: order.ownerEmail,
      invoice_creation: { enabled: true },
      line_items: [{
        quantity: 1,
        price_data: {
          currency: "usd",
          unit_amount: 100,
          product_data: { name: "QuotePilot Starter Access" }
        }
      }],
      metadata: {
        flow: "buyer_access",
        buyerAccessOrderId: order.orderId,
        ownerUid: order.ownerUid,
        checkoutGeneration: "1",
        plan: "starter"
      }
    });
    expect(checkout.params.payment_method_types).toBeUndefined();
    expect(checkout.params.success_url).toBe(
      "https://quotepilot.mbmapps.com/start?purchase=success&session_id={CHECKOUT_SESSION_ID}"
    );
    expect(checkout.params.cancel_url).toBe(
      "https://quotepilot.mbmapps.com/start?purchase=cancelled"
    );
  });

  test("derives return URLs from the configured server origin and requires HTTPS", () => {
    expect(buildBuyerAccessReturnUrls("https://preview.example.test/app")).toEqual({
      successUrl: "https://preview.example.test/start?purchase=success&session_id={CHECKOUT_SESSION_ID}",
      cancelUrl: "https://preview.example.test/start?purchase=cancelled"
    });
    expect(() => buildBuyerAccessReturnUrls("http://public.example.test/app"))
      .toThrow(/HTTPS/);
    expect(() => buildBuyerAccessReturnUrls("ftp://localhost/app"))
      .toThrow(/HTTPS/);
    expect(() => buildBuyerAccessReturnUrls("https://buyer:secret@preview.example.test/app"))
      .toThrow(/HTTPS/);
  });

  test("validates test mode, session/order, exact amount, plan, UID, and owner email", () => {
    expect(assertBuyerAccessSessionBinding({
      eventLivemode: false,
      order,
      session,
      stripeMode: "test"
    })).toMatchObject({
      amountCents: 100,
      currency: "usd",
      orderId: order.orderId,
      ownerUid: order.ownerUid,
      sessionId: order.stripeSessionId
    });
    for (const invalidSession of [
      { ...session, amount_total: 0 },
      { ...session, amount_total: 101 },
      { ...session, currency: "cad" },
      { ...session, invoice_creation: { enabled: false } },
      { ...session, livemode: true },
      { ...session, customer_email: "attacker@example.com" },
      { ...session, metadata: { ...session.metadata, ownerUid: "other-owner" } },
      { ...session, metadata: { ...session.metadata, plan: "enterprise" } },
      { ...session, client_reference_id: "different-order" }
    ]) {
      expect(() => assertBuyerAccessSessionBinding({
        eventLivemode: false,
        order,
        session: invalidSession,
        stripeMode: "test"
      })).toThrow(BuyerAccessError);
    }
  });

  test("keeps failed access closed and permits only paid settlement to grant or restore access", () => {
    expect(planBuyerAccessTransition({
      currentStatus: "checkout_pending",
      providerState: "processing"
    })).toMatchObject({ apply: true, status: "payment_processing", accessGranted: false });
    expect(planBuyerAccessTransition({
      currentStatus: "checkout_pending",
      providerState: "failed"
    })).toMatchObject({ apply: true, status: "payment_failed", accessGranted: false });
    expect(planBuyerAccessTransition({
      currentStatus: "payment_failed",
      providerState: "expired"
    })).toMatchObject({ apply: false, status: "payment_failed", accessGranted: false });
    expect(planBuyerAccessTransition({
      currentStatus: "expired",
      providerState: "paid"
    })).toMatchObject({ apply: true, status: "active", accessGranted: true });
    expect(planBuyerAccessTransition({
      currentStatus: "active",
      providerState: "failed"
    })).toMatchObject({ apply: false, status: "active", accessGranted: true });
  });

  test("returns organization access only for the active owner-scoped order", () => {
    expect(buyerAccessStatusResponse(order)).toEqual({
      orderId: order.orderId,
      sessionId: order.stripeSessionId,
      status: "checkout_pending",
      accessGranted: false,
      organizationId: null,
      appUrl: null
    });
    expect(buyerAccessStatusResponse({
      ...order,
      status: "active",
      accessGranted: true
    })).toEqual({
      orderId: order.orderId,
      sessionId: order.stripeSessionId,
      status: "active",
      accessGranted: true,
      organizationId: order.organizationId,
      appUrl: "/app"
    });
  });

  test("expires an unattached open Session and requires review when expiration is ambiguous", async () => {
    const expireCalls = [];
    await expect(neutralizeBuyerAccessCheckoutSession({
      session,
      expireSession: async (sessionId) => {
        expireCalls.push(sessionId);
        return {
          ...session,
          status: "expired",
          payment_status: "unpaid"
        };
      }
    })).resolves.toEqual({
      outcome: "neutralized",
      reason: "expiration_confirmed",
      sessionId: session.id
    });
    expect(expireCalls).toEqual([session.id]);

    await expect(neutralizeBuyerAccessCheckoutSession({
      session,
      expireSession: async () => {
        throw new Error("provider outcome unknown");
      }
    })).resolves.toEqual({
      outcome: "review_required",
      reason: "expiration_unconfirmed",
      sessionId: session.id
    });
  });

  test("never expires or downgrades a Session that already reports paid", async () => {
    let expireCalled = false;
    await expect(neutralizeBuyerAccessCheckoutSession({
      session: {
        ...session,
        status: "complete",
        payment_status: "paid"
      },
      expireSession: async () => {
        expireCalled = true;
      }
    })).resolves.toEqual({
      outcome: "review_required",
      reason: "provider_reports_paid",
      sessionId: session.id
    });
    expect(expireCalled).toBe(false);
  });
});
