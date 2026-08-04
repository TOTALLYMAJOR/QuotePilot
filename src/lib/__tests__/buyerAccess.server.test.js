import { createRequire } from "node:module";
import { describe, expect, test } from "vitest";

const require = createRequire(import.meta.url);
const {
  BUYER_ACCESS_AMOUNT_CENTS,
  BUYER_ACCESS_CURRENCY,
  BUYER_ACCESS_MODE,
  BUYER_ACCESS_PLAN,
  BUYER_ACCESS_STATUS_RATE_LIMIT,
  BUYER_ACCESS_STATUS_RATE_WINDOW_MS,
  BUYER_ACCESS_STRIPE_API_VERSION,
  BUYER_ACCESS_TURNSTILE_ACTION,
  BuyerAccessError,
  assertBuyerAccessInvoiceBinding,
  assertBuyerAccessRuntime,
  assertBuyerAccessTurnstileResult,
  authorizeBuyerAccessStatusRequest,
  buildBuyerAccessIdentifiers,
  buildBuyerAccessStripePlan,
  buyerAccessOrderIdForRequest,
  buyerAccessProviderStateForEvent,
  buyerAccessRateLimitDocumentId,
  buyerAccessStatusResponse,
  buyerAccessStatusTokenMatches,
  hashBuyerAccessSecret,
  isBuyerAccessInvoice,
  normalizeBuyerAccessHostedInvoiceUrl,
  normalizeBuyerAccessRequest,
  normalizeBuyerAccessStatusRequest,
  planBuyerAccessCreationReservation,
  planBuyerAccessRateLimit,
  planBuyerAccessTransition,
  resolveBuyerAccessBootstrapRecovery
} = require("../../../functions/buyerAccess.js");

const REQUEST_ID = "123e4567-e89b-42d3-a456-426614174000";
const OTHER_REQUEST_ID = "123e4567-e89b-42d3-b456-426614174001";
const RATE_LIMIT_SECRET = "test-only-buyer-rate-limit-secret-0123456789abcdef";
const HOSTED_INVOICE_URL = "https://invoice.stripe.com/i/acct_test/test_invoice_101?s=ap";
const order = {
  orderId: buyerAccessOrderIdForRequest({
    ownerEmail: "owner@example.com",
    requestId: REQUEST_ID
  }),
  flow: "buyer_access",
  buyerAccessMode: BUYER_ACCESS_MODE,
  ownerUid: "",
  ownerEmail: "owner@example.com",
  ownerName: "Avery Owner",
  organizationId: "acme-events-1234567890abcdef1234567890abcdef",
  organizationName: "Acme Events",
  invoiceGeneration: 1,
  stripeCustomerId: "cus_BuyerAccess101",
  stripeInvoiceId: "in_BuyerAccess101",
  plan: BUYER_ACCESS_PLAN,
  amountCents: BUYER_ACCESS_AMOUNT_CENTS,
  currency: BUYER_ACCESS_CURRENCY,
  status: "invoice_open",
  statusTokenHash: hashBuyerAccessSecret(REQUEST_ID),
  hostedInvoiceUrl: HOSTED_INVOICE_URL,
  accessGranted: false,
  workspaceReady: false,
  activationEmailSent: false
};

const invoice = {
  id: order.stripeInvoiceId,
  object: "invoice",
  livemode: false,
  status: "open",
  customer: order.stripeCustomerId,
  customer_email: order.ownerEmail,
  collection_method: "send_invoice",
  currency: BUYER_ACCESS_CURRENCY,
  amount_due: BUYER_ACCESS_AMOUNT_CENTS,
  amount_paid: 0,
  amount_remaining: BUYER_ACCESS_AMOUNT_CENTS,
  total: BUYER_ACCESS_AMOUNT_CENTS,
  subscription: null,
  hosted_invoice_url: HOSTED_INVOICE_URL,
  metadata: {
    flow: "buyer_access",
    buyerAccessOrderId: order.orderId,
    invoiceGeneration: "1",
    plan: BUYER_ACCESS_PLAN
  }
};

describe("buyer access invoice server contract", () => {
  test("pins the controlled Stripe test contract", () => {
    expect(BUYER_ACCESS_MODE).toBe("controlled_test");
    expect(BUYER_ACCESS_PLAN).toBe("starter");
    expect(BUYER_ACCESS_AMOUNT_CENTS).toBe(100);
    expect(BUYER_ACCESS_CURRENCY).toBe("usd");
    expect(BUYER_ACCESS_STRIPE_API_VERSION).toBe("2024-06-20");
    expect(BUYER_ACCESS_TURNSTILE_ACTION).toBe("buyer_access_invoice");
  });

  test("fails closed unless enabled in Stripe test mode", () => {
    expect(assertBuyerAccessRuntime({ enabled: " true ", stripeMode: " TEST " })).toEqual({
      enabled: true,
      stripeMode: "test"
    });
    expect(() => assertBuyerAccessRuntime({ enabled: "false", stripeMode: "test" }))
      .toThrow(/not enabled/i);
    expect(() => assertBuyerAccessRuntime({ enabled: "true", stripeMode: "live" }))
      .toThrow(/test mode/i);
  });

  test("accepts only the exact public create shape and normalizes bounded identity", () => {
    expect(normalizeBuyerAccessRequest({
      organizationName: "  Acme   Events  ",
      ownerName: "  Avery   Owner ",
      ownerEmail: " OWNER@Example.com ",
      requestId: REQUEST_ID.toUpperCase(),
      turnstileToken: "turnstile-token-with-enough-entropy"
    })).toEqual({
      organizationName: "Acme Events",
      ownerName: "Avery Owner",
      ownerEmail: "owner@example.com",
      requestId: REQUEST_ID,
      turnstileToken: "turnstile-token-with-enough-entropy"
    });
    expect(() => normalizeBuyerAccessRequest({
      organizationName: "Acme Events",
      ownerName: "Avery Owner",
      ownerEmail: "owner@example.com",
      requestId: REQUEST_ID,
      turnstileToken: "turnstile-token-with-enough-entropy",
      amountCents: 0
    })).toThrow(/server-owned/i);
    expect(() => normalizeBuyerAccessRequest({
      organizationName: "Acme Events",
      ownerName: "Avery Owner",
      ownerEmail: "not-an-email",
      requestId: REQUEST_ID,
      turnstileToken: "turnstile-token-with-enough-entropy"
    })).toThrow(BuyerAccessError);
    expect(() => normalizeBuyerAccessRequest({
      organizationName: "Acme Events",
      ownerName: "Avery Owner",
      ownerEmail: "owner@example.com",
      requestId: "not-a-uuid",
      turnstileToken: "turnstile-token-with-enough-entropy"
    })).toThrow(/requestId/i);
  });

  test("accepts only orderId and a UUIDv4 status token for status reads", () => {
    expect(normalizeBuyerAccessStatusRequest({
      orderId: order.orderId,
      statusToken: REQUEST_ID
    })).toEqual({
      orderId: order.orderId,
      statusToken: REQUEST_ID
    });
    expect(() => normalizeBuyerAccessStatusRequest({
      orderId: order.orderId,
      statusToken: REQUEST_ID,
      ownerEmail: order.ownerEmail
    })).toThrow(/invalid/i);
    expect(() => normalizeBuyerAccessStatusRequest({
      orderId: "ba-invalid",
      statusToken: REQUEST_ID
    })).toThrow(/orderId/i);
  });

  test("hashes the browser token and compares it without storing the raw value", () => {
    expect(hashBuyerAccessSecret(REQUEST_ID)).toMatch(/^[a-f0-9]{64}$/);
    expect(buyerAccessStatusTokenMatches({
      expectedHash: order.statusTokenHash,
      statusToken: REQUEST_ID
    })).toBe(true);
    expect(buyerAccessStatusTokenMatches({
      expectedHash: order.statusTokenHash,
      statusToken: OTHER_REQUEST_ID
    })).toBe(false);
  });

  test("derives secret-keyed rate records without exposing raw network or email identity", () => {
    const ipId = buyerAccessRateLimitDocumentId({
      rateLimitSecret: RATE_LIMIT_SECRET,
      scope: "status_ip",
      value: "203.0.113.42"
    });
    const emailId = buyerAccessRateLimitDocumentId({
      rateLimitSecret: RATE_LIMIT_SECRET,
      scope: "invoice_email",
      value: "owner@example.com"
    });
    expect(ipId).toMatch(/^status_ip-[a-f0-9]{40}$/);
    expect(emailId).toMatch(/^invoice_email-[a-f0-9]{40}$/);
    expect(ipId).not.toContain("203.0.113.42");
    expect(emailId).not.toContain("owner@example.com");
    expect(buyerAccessRateLimitDocumentId({
      rateLimitSecret: RATE_LIMIT_SECRET,
      scope: "status_ip",
      value: "203.0.113.42"
    })).toBe(ipId);
    expect(buyerAccessRateLimitDocumentId({
      rateLimitSecret: `${RATE_LIMIT_SECRET}-different`,
      scope: "status_ip",
      value: "203.0.113.42"
    })).not.toBe(ipId);
    expect(() => buyerAccessRateLimitDocumentId({
      rateLimitSecret: "too-short",
      scope: "status_ip",
      value: "203.0.113.42"
    })).toThrow(/not configured/i);
  });

  test("permits the full client polling budget and blocks the next request in-window", () => {
    expect(BUYER_ACCESS_STATUS_RATE_LIMIT).toBe(60);
    expect(BUYER_ACCESS_STATUS_RATE_WINDOW_MS).toBe(5 * 60 * 1000);
    const startedAtMs = Date.parse("2026-08-04T12:00:00.000Z");
    let current = null;
    for (let attempt = 0; attempt < BUYER_ACCESS_STATUS_RATE_LIMIT; attempt += 1) {
      const rate = planBuyerAccessRateLimit({
        current,
        limit: BUYER_ACCESS_STATUS_RATE_LIMIT,
        nowMs: startedAtMs + attempt * 100,
        windowMs: BUYER_ACCESS_STATUS_RATE_WINDOW_MS
      });
      expect(rate.blocked).toBe(false);
      current = rate.patch;
    }
    const blocked = planBuyerAccessRateLimit({
      current,
      limit: BUYER_ACCESS_STATUS_RATE_LIMIT,
      nowMs: startedAtMs + BUYER_ACCESS_STATUS_RATE_LIMIT * 100,
      windowMs: BUYER_ACCESS_STATUS_RATE_WINDOW_MS
    });
    expect(blocked.blocked).toBe(true);

    const reset = planBuyerAccessRateLimit({
      current,
      limit: BUYER_ACCESS_STATUS_RATE_LIMIT,
      nowMs: startedAtMs + BUYER_ACCESS_STATUS_RATE_WINDOW_MS,
      windowMs: BUYER_ACCESS_STATUS_RATE_WINDOW_MS
    });
    expect(reset).toMatchObject({ blocked: false, patch: { count: 1 } });
  });

  test("reused create reservations charge every IP attempt but charge email only once", () => {
    const nowMs = Date.parse("2026-08-04T12:00:00.000Z");
    const first = planBuyerAccessCreationReservation({
      nowMs,
      orderId: order.orderId
    });
    expect(first).toMatchObject({
      blocked: false,
      reused: false,
      ipRate: { patch: { count: 1 } },
      emailRate: { patch: { count: 1 } },
      reservationPatch: {
        scope: "invoice_reservation",
        orderId: order.orderId
      }
    });

    const currentReservation = first.reservationPatch;
    let currentIpRate = first.ipRate.patch;
    for (let retry = 0; retry < 2; retry += 1) {
      const repeated = planBuyerAccessCreationReservation({
        currentEmailRate: first.emailRate.patch,
        currentIpRate,
        currentReservation,
        nowMs: nowMs + (retry + 1) * 100,
        orderId: order.orderId
      });
      expect(repeated.blocked).toBe(false);
      expect(repeated.reused).toBe(true);
      expect(repeated.emailRate).toBeNull();
      expect(repeated.reservationPatch).toBeNull();
      currentIpRate = repeated.ipRate.patch;
    }
    const blockedRetry = planBuyerAccessCreationReservation({
      currentEmailRate: first.emailRate.patch,
      currentIpRate,
      currentReservation,
      nowMs: nowMs + 400,
      orderId: order.orderId
    });
    expect(blockedRetry.blocked).toBe(true);
    expect(blockedRetry.reused).toBe(true);
    expect(blockedRetry.emailRate).toBeNull();
    expect(blockedRetry.ipRate.patch.count).toBe(4);
  });

  test("charges well-formed unknown orders and wrong tokens before returning the same denial", async () => {
    const unknownTrace = [];
    await expect(authorizeBuyerAccessStatusRequest({
      input: { orderId: order.orderId, statusToken: REQUEST_ID },
      consumeRateLimit: async () => unknownTrace.push("rate"),
      readOrder: async () => {
        unknownTrace.push("read");
        return null;
      }
    })).rejects.toMatchObject({ code: "permission-denied" });
    expect(unknownTrace).toEqual(["rate", "read"]);

    const wrongTokenTrace = [];
    await expect(authorizeBuyerAccessStatusRequest({
      input: { orderId: order.orderId, statusToken: OTHER_REQUEST_ID },
      consumeRateLimit: async () => wrongTokenTrace.push("rate"),
      readOrder: async () => {
        wrongTokenTrace.push("read");
        return order;
      }
    })).rejects.toMatchObject({ code: "permission-denied" });
    expect(wrongTokenTrace).toEqual(["rate", "read"]);
  });

  test("never reads an order when rate infrastructure fails and accepts a valid token after a lease", async () => {
    let readAttempted = false;
    await expect(authorizeBuyerAccessStatusRequest({
      input: { orderId: order.orderId, statusToken: REQUEST_ID },
      consumeRateLimit: async () => {
        throw new Error("rate store unavailable");
      },
      readOrder: async () => {
        readAttempted = true;
        return order;
      }
    })).rejects.toThrow(/rate store unavailable/i);
    expect(readAttempted).toBe(false);

    const trace = [];
    await expect(authorizeBuyerAccessStatusRequest({
      input: { orderId: order.orderId, statusToken: REQUEST_ID },
      consumeRateLimit: async () => trace.push("rate"),
      readOrder: async () => {
        trace.push("read");
        return order;
      }
    })).resolves.toBe(order);
    expect(trace).toEqual(["rate", "read"]);
  });

  test("derives a stable request-scoped order and collision-resistant organization identity", () => {
    const first = buildBuyerAccessIdentifiers({
      ownerEmail: "OWNER@example.com",
      organizationName: "Acme Events",
      randomUUID: () => "12345678-90ab-cdef-1234-567890abcdef",
      requestId: REQUEST_ID
    });
    const second = buildBuyerAccessIdentifiers({
      ownerEmail: "owner@example.com",
      organizationName: "Acme Events",
      randomUUID: () => "abcdefab-cdef-abcd-efab-cdefabcdefab",
      requestId: REQUEST_ID
    });
    const replacement = buildBuyerAccessIdentifiers({
      ownerEmail: "owner@example.com",
      organizationName: "Acme Events",
      randomUUID: () => "abcdefab-cdef-abcd-efab-cdefabcdefab",
      requestId: OTHER_REQUEST_ID
    });
    expect(first.orderId).toBe(second.orderId);
    expect(first.orderId).toBe(order.orderId);
    expect(replacement.orderId).not.toBe(first.orderId);
    expect(first.organizationId).toBe("acme-events-1234567890abcdef1234567890abcdef");
    expect(second.organizationId).not.toBe(first.organizationId);
  });

  test("always generates an alphanumeric-leading webhook-safe organization identity", () => {
    const uuid = () => "12345678-90ab-cdef-1234-567890abcdef";
    expect(buildBuyerAccessIdentifiers({
      ownerEmail: "underscore@example.com",
      organizationName: "_Acme",
      randomUUID: uuid,
      requestId: REQUEST_ID
    }).organizationId).toBe(
      "acme-1234567890abcdef1234567890abcdef"
    );
    expect(buildBuyerAccessIdentifiers({
      ownerEmail: "only-underscores@example.com",
      organizationName: "___",
      randomUUID: uuid,
      requestId: REQUEST_ID
    }).organizationId).toBe(
      "workspace-1234567890abcdef1234567890abcdef"
    );
    for (const organizationName of ["_Acme", "___"]) {
      expect(buildBuyerAccessIdentifiers({
        ownerEmail: organizationName === "_Acme"
          ? "underscore@example.com"
          : "only-underscores@example.com",
        organizationName,
        randomUUID: uuid,
        requestId: REQUEST_ID
      }).organizationId).toMatch(/^[a-z0-9][a-z0-9_-]*-[a-f0-9]{32}$/);
    }
  });

  test("builds Customer, send-invoice, one-dollar item, finalize, and send steps", () => {
    const plan = buildBuyerAccessStripePlan({
      generation: 1,
      orderId: order.orderId,
      organizationName: order.organizationName,
      ownerEmail: order.ownerEmail,
      ownerName: order.ownerName
    });
    expect(plan.customer.params).toMatchObject({
      email: order.ownerEmail,
      name: order.ownerName,
      metadata: {
        flow: "buyer_access",
        buyerAccessOrderId: order.orderId,
        invoiceGeneration: "1",
        plan: "starter"
      }
    });
    expect(plan.invoice.params).toMatchObject({
      auto_advance: false,
      collection_method: "send_invoice",
      currency: "usd",
      days_until_due: 1,
      discounts: []
    });
    expect(plan.invoiceItem.params).toMatchObject({
      amount: 100,
      currency: "usd",
      discountable: false
    });
    expect(plan.finalize.params).toEqual({ auto_advance: false });
    expect(plan.send.params).toEqual({});
    expect(plan.customer.idempotencyKey).toBe(
      "buyer-access-" + order.orderId + "-g1-customer"
    );
    expect(plan.invoice.idempotencyKey).toBe(
      "buyer-access-" + order.orderId + "-g1-invoice"
    );
    expect(plan.invoiceItem.idempotencyKey).toBe(
      "buyer-access-" + order.orderId + "-g1-invoice_item"
    );
    expect(JSON.stringify(plan)).not.toContain("payment_method_types");
  });

  test("accepts only exact Stripe Hosted Invoice Page URLs", () => {
    expect(normalizeBuyerAccessHostedInvoiceUrl(HOSTED_INVOICE_URL))
      .toBe(HOSTED_INVOICE_URL);
    for (const invalidUrl of [
      "https://invoice.stripe.com/",
      "https://invoice.stripe.com/pay/test_invoice",
      "https://invoice.stripe.com/i/",
      "https://invoice.stripe.com/i/test_invoice#fragment",
      "https://invoice.stripe.com.evil.test/i/test_invoice",
      "http://invoice.stripe.com/i/test_invoice",
      "https://user:secret@invoice.stripe.com/i/test_invoice"
    ]) {
      expect(() => normalizeBuyerAccessHostedInvoiceUrl(invalidUrl))
        .toThrow(/Hosted Invoice Page URL/i);
    }
  });

  test("binds successful Turnstile results to the exact action and hostname", () => {
    expect(assertBuyerAccessTurnstileResult({
      allowedHostnames: ["quotepilot.mbmapps.com"],
      result: {
        success: true,
        action: "buyer_access_invoice",
        hostname: "quotepilot.mbmapps.com",
        challenge_ts: "2026-08-04T12:00:00.000Z"
      }
    })).toEqual({
      action: "buyer_access_invoice",
      hostname: "quotepilot.mbmapps.com",
      challengeTimestamp: "2026-08-04T12:00:00.000Z"
    });
    for (const result of [
      { success: false, action: "buyer_access_invoice", hostname: "quotepilot.mbmapps.com" },
      { success: true, action: "different_action", hostname: "quotepilot.mbmapps.com" },
      { success: true, action: "buyer_access_invoice", hostname: "attacker.example" }
    ]) {
      expect(() => assertBuyerAccessTurnstileResult({
        allowedHostnames: ["quotepilot.mbmapps.com"],
        result
      })).toThrow(/verification failed/i);
    }
  });

  test("recognizes only buyer Invoice objects and the four signed event states", () => {
    expect(isBuyerAccessInvoice(invoice)).toBe(true);
    expect(isBuyerAccessInvoice({ ...invoice, object: "checkout.session" })).toBe(false);
    expect(isBuyerAccessInvoice({
      ...invoice,
      metadata: { ...invoice.metadata, flow: "quote_payment" }
    })).toBe(false);
    expect(buyerAccessProviderStateForEvent("invoice.paid")).toBe("paid");
    expect(buyerAccessProviderStateForEvent("invoice.payment_failed")).toBe("failed");
    expect(buyerAccessProviderStateForEvent("invoice.voided")).toBe("void");
    expect(buyerAccessProviderStateForEvent("invoice.marked_uncollectible")).toBe("expired");
    expect(buyerAccessProviderStateForEvent("invoice.finalized")).toBe("");
  });

  test("binds an open Invoice to exact order, customer, amount, currency, and metadata", () => {
    expect(assertBuyerAccessInvoiceBinding({
      eventLivemode: false,
      invoice,
      order,
      providerState: "open",
      stripeMode: "test"
    })).toMatchObject({
      customerId: order.stripeCustomerId,
      hostedInvoiceUrl: HOSTED_INVOICE_URL,
      invoiceId: order.stripeInvoiceId,
      orderId: order.orderId,
      ownerEmail: order.ownerEmail,
      providerState: "open"
    });
    for (const invalidInvoice of [
      { ...invoice, livemode: true },
      { ...invoice, customer: "cus_Different" },
      { ...invoice, customer_email: "attacker@example.com" },
      { ...invoice, amount_due: 99 },
      { ...invoice, total: 101 },
      { ...invoice, total: undefined },
      { ...invoice, currency: "cad" },
      { ...invoice, collection_method: "charge_automatically" },
      { ...invoice, subscription: "sub_BuyerAccess" },
      {
        ...invoice,
        metadata: { ...invoice.metadata, invoiceGeneration: "2" }
      },
      {
        ...invoice,
        metadata: { ...invoice.metadata, plan: "enterprise" }
      }
    ]) {
      expect(() => assertBuyerAccessInvoiceBinding({
        eventLivemode: false,
        invoice: invalidInvoice,
        order,
        providerState: "open",
        stripeMode: "test"
      })).toThrow(BuyerAccessError);
    }
  });

  test("provisions only a fully settled, in-band paid Invoice with a real PaymentIntent", () => {
    const paidInvoice = {
      ...invoice,
      status: "paid",
      amount_paid: 100,
      amount_remaining: 0,
      paid_out_of_band: false,
      payment_intent: "pi_BuyerAccess101"
    };
    expect(assertBuyerAccessInvoiceBinding({
      eventLivemode: false,
      invoice: paidInvoice,
      order,
      providerState: "paid",
      stripeMode: "test"
    })).toMatchObject({
      paymentIntentId: "pi_BuyerAccess101",
      providerState: "paid"
    });
    for (const invalidInvoice of [
      { ...paidInvoice, amount_paid: 99 },
      { ...paidInvoice, amount_remaining: 1 },
      { ...paidInvoice, paid_out_of_band: true },
      { ...paidInvoice, paid_out_of_band: undefined },
      { ...paidInvoice, payment_intent: null },
      { ...paidInvoice, payment_intent: "ch_not_a_payment_intent" }
    ]) {
      expect(() => assertBuyerAccessInvoiceBinding({
        eventLivemode: false,
        invoice: invalidInvoice,
        order,
        providerState: "paid",
        stripeMode: "test"
      })).toThrow(BuyerAccessError);
    }
  });

  test("validates failed, void, and uncollectible Invoice event state exactly", () => {
    expect(assertBuyerAccessInvoiceBinding({
      eventLivemode: false,
      invoice,
      order,
      providerState: "failed",
      stripeMode: "test"
    }).hostedInvoiceUrl).toBe(HOSTED_INVOICE_URL);
    const voidInvoice = {
      ...invoice,
      status: "void",
      amount_due: 0,
      amount_paid: 0,
      amount_remaining: 0,
      total: 0,
      payment_intent: null,
      hosted_invoice_url: null
    };
    expect(assertBuyerAccessInvoiceBinding({
      eventLivemode: false,
      invoice: voidInvoice,
      order,
      providerState: "void",
      stripeMode: "test"
    }).providerState).toBe("void");
    const uncollectibleInvoice = {
      ...invoice,
      status: "uncollectible",
      amount_due: 100,
      amount_paid: 0,
      amount_remaining: 100,
      total: 100,
      payment_intent: null,
      hosted_invoice_url: null
    };
    expect(assertBuyerAccessInvoiceBinding({
      eventLivemode: false,
      invoice: uncollectibleInvoice,
      order,
      providerState: "expired",
      stripeMode: "test"
    }).providerState).toBe("expired");
    expect(planBuyerAccessTransition({
      currentStatus: "invoice_open",
      providerState: "void"
    })).toMatchObject({ apply: true, status: "void", accessGranted: false });
    expect(planBuyerAccessTransition({
      currentStatus: "invoice_open",
      providerState: "expired"
    })).toMatchObject({ apply: true, status: "expired", accessGranted: false });
  });

  test("keeps access closed until verified sign-in and never downgrades fulfillment", () => {
    expect(planBuyerAccessTransition({
      currentStatus: "invoice_open",
      providerState: "processing"
    })).toMatchObject({
      apply: true,
      status: "payment_processing",
      accessGranted: false
    });
    expect(planBuyerAccessTransition({
      currentStatus: "invoice_open",
      providerState: "paid"
    })).toMatchObject({
      apply: true,
      status: "activation_pending",
      accessGranted: false
    });
    expect(planBuyerAccessTransition({
      currentStatus: "activation_pending",
      providerState: "paid"
    })).toMatchObject({
      apply: false,
      status: "activation_pending",
      reason: "already_provisioned"
    });
    expect(planBuyerAccessTransition({
      currentStatus: "active",
      providerState: "failed"
    })).toMatchObject({
      apply: false,
      status: "active",
      accessGranted: true,
      reason: "already_active"
    });
  });

  test("recovers claims completion after first sync or final-write failure without reassignment", () => {
    const uid = "buyer-owner-uid";
    const activeOrder = {
      ...order,
      status: "active",
      ownerUid: uid,
      accessGranted: true,
      workspaceReady: true,
      activationEmailSent: false,
      claimsSyncStatus: "pending"
    };
    const roleRecord = {
      role: "admin",
      email: order.ownerEmail,
      organizationId: order.organizationId,
      buyerAccessOrderId: order.orderId,
      buyerAccessMode: BUYER_ACCESS_MODE,
      source: "buyer_access"
    };

    expect(resolveBuyerAccessBootstrapRecovery({
      authenticatedClaims: {},
      buyerAccessOrder: activeOrder,
      email: order.ownerEmail,
      roleRecord,
      uid
    })).toEqual({
      buyerAccessOrderId: order.orderId,
      organizationId: order.organizationId
    });
    expect(resolveBuyerAccessBootstrapRecovery({
      authenticatedClaims: {
        role: "admin",
        organizationId: order.organizationId
      },
      buyerAccessOrder: activeOrder,
      email: order.ownerEmail,
      roleRecord,
      uid
    })).toEqual({
      buyerAccessOrderId: order.orderId,
      organizationId: order.organizationId
    });

    const otherOrderId = "ba-" + "b".repeat(40);
    const otherOrganizationId = "other-workspace-" + "b".repeat(32);
    for (const invalid of [
      {
        authenticatedClaims: { role: "admin", organizationId: otherOrganizationId },
        buyerAccessOrder: activeOrder,
        roleRecord
      },
      {
        authenticatedClaims: { role: "customer", organizationId: "" },
        buyerAccessOrder: activeOrder,
        roleRecord: { ...roleRecord, buyerAccessOrderId: otherOrderId }
      },
      {
        authenticatedClaims: { role: "customer", organizationId: "" },
        buyerAccessOrder: activeOrder,
        roleRecord: { ...roleRecord, organizationId: otherOrganizationId }
      },
      {
        authenticatedClaims: { role: "customer", organizationId: "" },
        buyerAccessOrder: { ...activeOrder, ownerUid: "different-owner" },
        roleRecord
      },
      {
        authenticatedClaims: { role: "customer", organizationId: "" },
        buyerAccessOrder: { ...activeOrder, orderId: otherOrderId },
        roleRecord
      }
    ]) {
      expect(() => resolveBuyerAccessBootstrapRecovery({
        ...invalid,
        email: order.ownerEmail,
        uid
      })).toThrow(BuyerAccessError);
    }
  });

  test("projects only privacy-minimal, state-consistent public status", () => {
    expect(buyerAccessStatusResponse(order)).toEqual({
      orderId: order.orderId,
      status: "invoice_open",
      activationEmailSent: false,
      workspaceReady: false,
      appUrl: null,
      hostedInvoiceUrl: HOSTED_INVOICE_URL
    });
    expect(buyerAccessStatusResponse({
      ...order,
      status: "activation_pending",
      hostedInvoiceUrl: "",
      workspaceReady: true
    })).toEqual({
      orderId: order.orderId,
      status: "provisioning",
      activationEmailSent: false,
      workspaceReady: true,
      appUrl: null
    });
    expect(buyerAccessStatusResponse({
      ...order,
      status: "activation_sent",
      hostedInvoiceUrl: "",
      workspaceReady: true,
      activationEmailSent: true
    })).toMatchObject({
      status: "activation_sent",
      activationEmailSent: true,
      workspaceReady: true,
      appUrl: null
    });
    expect(buyerAccessStatusResponse({
      ...order,
      status: "active",
      hostedInvoiceUrl: "",
      accessGranted: true,
      workspaceReady: true,
      activationEmailSent: false
    })).toMatchObject({
      status: "active",
      activationEmailSent: false,
      workspaceReady: true,
      appUrl: "/app"
    });
    expect(() => buyerAccessStatusResponse({
      ...order,
      status: "active",
      accessGranted: true,
      workspaceReady: false
    })).toThrow(/inconsistent/i);
  });
});
