import { beforeEach, describe, expect, test, vi } from "vitest";

const buyerMocks = vi.hoisted(() => ({
  auth: {
    currentUser: {
      uid: "buyer-uid",
      email: "buyer@example.com",
      emailVerified: true
    }
  },
  cloudFunctions: { name: "test-functions" },
  callableResponses: new Map(),
  httpsCallable: vi.fn()
}));

vi.mock("firebase/functions", () => ({
  httpsCallable: buyerMocks.httpsCallable
}));

vi.mock("../firebase", () => ({
  auth: buyerMocks.auth,
  cloudFunctions: buyerMocks.cloudFunctions
}));

import {
  buildBuyerAccessCheckoutPayload,
  createBuyerAccessCheckout,
  getBuyerAccessCheckoutStatus,
  isBuyerAccessSessionId
} from "../buyerAccess";

function setCallableResponse(name, value) {
  buyerMocks.callableResponses.set(name, value);
}

describe("buyer access client", () => {
  beforeEach(() => {
    buyerMocks.auth.currentUser = {
      uid: "buyer-uid",
      email: "buyer@example.com",
      emailVerified: true
    };
    buyerMocks.callableResponses.clear();
    buyerMocks.httpsCallable.mockReset();
    buyerMocks.httpsCallable.mockImplementation((_functions, name) => async (payload) => {
      const response = buyerMocks.callableResponses.get(name);
      return {
        data: typeof response === "function" ? response(payload) : response
      };
    });
  });

  test("normalizes only the business and owner fields sent to Checkout", () => {
    expect(buildBuyerAccessCheckoutPayload({
      organizationName: "  Acme   Events  ",
      ownerName: "  Avery   Owner  ",
      amountCents: 5000,
      plan: "enterprise"
    })).toEqual({
      organizationName: "Acme Events",
      ownerName: "Avery Owner"
    });
  });

  test.each([
    [{ organizationName: "", ownerName: "Avery Owner" }, "business name"],
    [{ organizationName: "Acme Events", ownerName: "" }, "owner name"]
  ])("rejects incomplete buyer identity %#", (input, message) => {
    expect(() => buildBuyerAccessCheckoutPayload(input)).toThrow(message);
  });

  test("requires a signed-in verified Firebase user before calling Checkout", async () => {
    buyerMocks.auth.currentUser.emailVerified = false;

    await expect(createBuyerAccessCheckout({
      organizationName: "Acme Events",
      ownerName: "Avery Owner"
    })).rejects.toThrow("Verify your email");
    expect(buyerMocks.httpsCallable).not.toHaveBeenCalled();
  });

  test("accepts only an exact pending order with a Stripe-hosted Checkout URL", async () => {
    setCallableResponse("createBuyerAccessCheckout", (payload) => ({
      orderId: "buyer-order-1",
      sessionId: "cs_test_buyer_1",
      checkoutUrl: "https://checkout.stripe.com/c/pay/cs_test_buyer_1#fragment",
      status: "checkout_pending",
      echoedPayload: payload
    }));

    await expect(createBuyerAccessCheckout({
      organizationName: "Acme Events",
      ownerName: "Avery Owner"
    })).resolves.toEqual({
      orderId: "buyer-order-1",
      sessionId: "cs_test_buyer_1",
      checkoutUrl: "https://checkout.stripe.com/c/pay/cs_test_buyer_1#fragment",
      status: "checkout_pending"
    });

    const call = buyerMocks.httpsCallable.mock.results[0].value;
    expect(call).toBeTypeOf("function");
    expect(buyerMocks.httpsCallable).toHaveBeenCalledWith(
      buyerMocks.cloudFunctions,
      "createBuyerAccessCheckout"
    );
  });

  test.each([
    "http://checkout.stripe.com/c/pay/cs_test_buyer_1",
    "https://checkout.stripe.com.evil.test/c/pay/cs_test_buyer_1",
    "https://checkout.stripe.com:444/c/pay/cs_test_buyer_1",
    "https://buyer:secret@checkout.stripe.com/c/pay/cs_test_buyer_1",
    "https://evil.test/app",
    "javascript:alert(1)",
    "data:text/html,not-stripe"
  ])("rejects an unsafe Checkout destination %s", async (checkoutUrl) => {
    setCallableResponse("createBuyerAccessCheckout", {
      orderId: "buyer-order-1",
      sessionId: "cs_test_buyer_1",
      checkoutUrl,
      status: "checkout_pending"
    });

    await expect(createBuyerAccessCheckout({
      organizationName: "Acme Events",
      ownerName: "Avery Owner"
    })).rejects.toThrow("invalid Stripe URL");
  });

  test("keeps pending status non-authoritative for access", async () => {
    setCallableResponse("getBuyerAccessCheckoutStatus", {
      orderId: "buyer-order-1",
      sessionId: "cs_test_buyer_1",
      status: "checkout_pending",
      accessGranted: false,
      organizationId: null,
      appUrl: null
    });

    await expect(getBuyerAccessCheckoutStatus({ sessionId: "cs_test_buyer_1" }))
      .resolves.toEqual({
        orderId: "buyer-order-1",
        sessionId: "cs_test_buyer_1",
        status: "checkout_pending",
        accessGranted: false,
        organizationId: null,
        appUrl: null
      });
  });

  test("returns /app only for an active provisioned order", async () => {
    setCallableResponse("getBuyerAccessCheckoutStatus", {
      orderId: "buyer-order-1",
      sessionId: "cs_test_buyer_1",
      status: "active",
      accessGranted: true,
      organizationId: "acme-events",
      appUrl: "https://quotepilot.mbmapps.com/app"
    });

    await expect(getBuyerAccessCheckoutStatus({ sessionId: "cs_test_buyer_1" }))
      .resolves.toMatchObject({
        status: "active",
        accessGranted: true,
        organizationId: "acme-events",
        appUrl: "/app"
      });
  });

  test.each([
    {
      status: "active",
      accessGranted: false,
      organizationId: "acme-events",
      appUrl: "/app"
    },
    {
      status: "checkout_pending",
      accessGranted: true,
      organizationId: "acme-events",
      appUrl: "/app"
    }
  ])("rejects conflicting access evidence %#", async (conflict) => {
    setCallableResponse("getBuyerAccessCheckoutStatus", {
      orderId: "buyer-order-1",
      sessionId: "cs_test_buyer_1",
      ...conflict
    });

    await expect(getBuyerAccessCheckoutStatus({ sessionId: "cs_test_buyer_1" }))
      .rejects.toThrow(/incomplete|conflicting/i);
  });

  test("rejects malformed or mismatched Checkout Session identities", async () => {
    expect(isBuyerAccessSessionId("cs_test_valid_123")).toBe(true);
    expect(isBuyerAccessSessionId("cs_live_not_allowed_here")).toBe(false);
    expect(isBuyerAccessSessionId("not-a-session")).toBe(false);

    setCallableResponse("getBuyerAccessCheckoutStatus", {
      orderId: "buyer-order-1",
      sessionId: "cs_test_other",
      status: "active",
      accessGranted: true,
      organizationId: "acme-events",
      appUrl: "/app"
    });
    await expect(getBuyerAccessCheckoutStatus({ sessionId: "cs_test_buyer_1" }))
      .rejects.toThrow("did not match");
  });
});
