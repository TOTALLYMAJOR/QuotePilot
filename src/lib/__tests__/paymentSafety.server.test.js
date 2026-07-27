import { createRequire } from "node:module";
import { describe, expect, test } from "vitest";

const require = createRequire(import.meta.url);
const {
  PaymentSafetyError,
  assertCheckoutPaymentTransition,
  assertPaymentPortalIdentity,
  buildStripeCheckoutIdempotencyKey,
  planDepositCheckout,
  validateStripeCheckoutScope,
  validateStripeCheckoutCompletion
} = require("../../../functions/paymentSafety.js");

const quote = {
  quoteId: "quote-1",
  organizationId: "org-a",
  portalKey: "portal-a",
  totals: {
    deposit: 123.45
  },
  payment: {
    stripeSessionId: "cs_test_active"
  }
};

const portal = {
  quoteId: "quote-1",
  organizationId: "org-a",
  portalKey: "portal-a"
};

const session = {
  id: "cs_test_active",
  mode: "payment",
  payment_status: "paid",
  currency: "usd",
  amount_total: 12345,
  metadata: {
    quoteId: "quote-1",
    organizationId: "org-a",
    portalKey: "portal-a"
  }
};

describe("server payment state safety", () => {
  test("creates only from a clean unpaid payment state", () => {
    expect(planDepositCheckout({
      depositStatus: "unpaid",
      depositLink: "",
      stripeSessionId: ""
    })).toMatchObject({
      action: "create",
      status: "unpaid"
    });
  });

  test("reuses one complete active checkout instead of creating another", () => {
    expect(planDepositCheckout({
      depositStatus: "sent",
      depositLink: "https://checkout.stripe.com/c/pay/existing",
      stripeSessionId: "cs_test_existing",
      checkoutGeneration: 3
    })).toEqual({
      action: "inspect_existing",
      status: "sent",
      depositLink: "https://checkout.stripe.com/c/pay/existing",
      stripeSessionId: "cs_test_existing",
      checkoutGeneration: 3,
      nextCheckoutGeneration: 4
    });
  });

  test.each([
    ["paid evidence", {
      depositStatus: "paid",
      depositLink: "https://checkout.stripe.com/c/pay/paid",
      stripeSessionId: "cs_test_paid"
    }],
    ["refunded evidence", { depositStatus: "refunded" }],
    ["confirmation timestamp", {
      depositStatus: "sent",
      depositConfirmedAtISO: "2026-07-27T12:00:00.000Z"
    }],
    ["link without session", {
      depositStatus: "sent",
      depositLink: "https://checkout.stripe.com/c/pay/incomplete"
    }],
    ["session without link", {
      depositStatus: "sent",
      stripeSessionId: "cs_test_incomplete"
    }],
    ["inconsistent state", { depositStatus: "sent" }]
  ])("rejects checkout creation over %s", (_label, payment) => {
    expect(() => planDepositCheckout(payment)).toThrow(PaymentSafetyError);
  });

  test("builds a stable scope-bound Stripe idempotency key", () => {
    const first = buildStripeCheckoutIdempotencyKey({
      quoteId: "quote-1",
      organizationId: "org-a",
      portalKey: "portal-a",
      amountTotal: 12345,
      checkoutGeneration: 1
    });
    const repeated = buildStripeCheckoutIdempotencyKey({
      quoteId: "quote-1",
      organizationId: "org-a",
      portalKey: "portal-a",
      amountTotal: 12345,
      checkoutGeneration: 1
    });
    const changed = buildStripeCheckoutIdempotencyKey({
      quoteId: "quote-1",
      organizationId: "org-a",
      portalKey: "portal-a",
      amountTotal: 12345,
      checkoutGeneration: 2
    });
    expect(first).toBe(repeated);
    expect(first).not.toBe(changed);
    expect(first.length).toBeLessThan(255);
  });

  test("accepts an exact unpaid Stripe session scope before completion", () => {
    expect(validateStripeCheckoutScope({
      session: {
        ...session,
        payment_status: "unpaid"
      },
      quote,
      quoteId: "quote-1",
      organizationId: "org-a"
    })).toMatchObject({
      sessionId: "cs_test_active",
      amountTotal: 12345,
      currency: "usd"
    });
  });

  test("allows one exact checkout transition and recognizes its idempotent replay", () => {
    const expectedPayment = {
      depositStatus: "unpaid",
      depositLink: "",
      stripeSessionId: "",
      depositConfirmedAtISO: "",
      checkoutGeneration: 0
    };
    const nextPayment = {
      depositStatus: "sent",
      depositLink: "https://checkout.stripe.com/c/pay/new",
      stripeSessionId: "cs_test_new",
      depositConfirmedAtISO: "",
      checkoutGeneration: 1
    };
    expect(assertCheckoutPaymentTransition({
      currentPayment: expectedPayment,
      expectedPayment,
      nextPayment
    })).toEqual({
      alreadyApplied: false
    });
    expect(assertCheckoutPaymentTransition({
      currentPayment: nextPayment,
      expectedPayment,
      nextPayment
    })).toEqual({
      alreadyApplied: true
    });
  });

  test.each([
    ["paid race", {
      depositStatus: "paid",
      depositLink: "https://checkout.stripe.com/c/pay/old",
      stripeSessionId: "cs_test_old",
      depositConfirmedAtISO: "2026-07-27T12:00:00.000Z",
      checkoutGeneration: 1
    }],
    ["different concurrent checkout", {
      depositStatus: "sent",
      depositLink: "https://checkout.stripe.com/c/pay/other",
      stripeSessionId: "cs_test_other",
      depositConfirmedAtISO: "",
      checkoutGeneration: 1
    }]
  ])("rejects a %s during checkout transition", (_label, currentPayment) => {
    expect(() => assertCheckoutPaymentTransition({
      currentPayment,
      expectedPayment: {
        depositStatus: "unpaid",
        checkoutGeneration: 0
      },
      nextPayment: {
        depositStatus: "sent",
        depositLink: "https://checkout.stripe.com/c/pay/new",
        stripeSessionId: "cs_test_new",
        checkoutGeneration: 1
      }
    })).toThrow(PaymentSafetyError);
  });

  test("accepts an exact quote and portal identity", () => {
    expect(assertPaymentPortalIdentity({
      quoteId: "quote-1",
      organizationId: "org-a",
      portalKey: "portal-a",
      quote,
      portal
    })).toBe(true);
  });

  test.each([
    ["foreign portal quote", { ...portal, quoteId: "quote-2" }],
    ["foreign portal organization", { ...portal, organizationId: "org-b" }],
    ["stale portal key", { ...portal, portalKey: "portal-b" }]
  ])("rejects %s", (_label, candidatePortal) => {
    expect(() => assertPaymentPortalIdentity({
      quoteId: "quote-1",
      organizationId: "org-a",
      portalKey: "portal-a",
      quote,
      portal: candidatePortal
    })).toThrow(PaymentSafetyError);
  });

  test("accepts an exact paid Stripe checkout session", () => {
    expect(validateStripeCheckoutCompletion({
      session,
      quote,
      quoteId: "quote-1",
      organizationId: "org-a"
    })).toEqual({
      sessionId: "cs_test_active",
      amountTotal: 12345,
      currency: "usd"
    });
  });

  test.each([
    ["stale session", { id: "cs_test_stale" }],
    ["unpaid session", { payment_status: "unpaid" }],
    ["subscription mode", { mode: "subscription" }],
    ["wrong currency", { currency: "cad" }],
    ["underpayment", { amount_total: 100 }],
    ["wrong quote metadata", { metadata: { ...session.metadata, quoteId: "quote-2" } }],
    ["wrong organization metadata", {
      metadata: { ...session.metadata, organizationId: "org-b" }
    }],
    ["wrong portal metadata", {
      metadata: { ...session.metadata, portalKey: "portal-b" }
    }]
  ])("rejects %s", (_label, patch) => {
    const candidate = {
      ...session,
      ...patch
    };
    expect(() => validateStripeCheckoutCompletion({
      session: candidate,
      quote,
      quoteId: "quote-1",
      organizationId: "org-a"
    })).toThrow(PaymentSafetyError);
  });
});
