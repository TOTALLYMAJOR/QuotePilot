import { createRequire } from "node:module";
import { describe, expect, test } from "vitest";

const require = createRequire(import.meta.url);
const {
  MAX_KNOWN_STRIPE_SESSION_IDS,
  PaymentSafetyError,
  assertCheckoutPaymentTransition,
  assertPaymentPortalIdentity,
  assertPreparedCheckoutPublicationTransition,
  assertPreparedCheckoutRegistrationTransition,
  buildPreparedCheckoutState,
  buildPublishedCheckoutState,
  buildStripeCheckoutIdempotencyKey,
  isKnownStripeSessionId,
  normalizeKnownStripeSessionIds,
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
      stripeCheckoutState: "open",
      checkoutGeneration: 3
    })).toEqual({
      action: "inspect_existing",
      status: "sent",
      depositLink: "https://checkout.stripe.com/c/pay/existing",
      stripeSessionId: "cs_test_existing",
      stripeCheckoutState: "open",
      checkoutGeneration: 3,
      nextCheckoutGeneration: 4
    });
  });

  test.each(["failed", "expired"])("rotates a %s checkout without erasing its audit session", (stripeCheckoutState) => {
    expect(planDepositCheckout({
      depositStatus: "unpaid",
      depositLink: "",
      stripeSessionId: "cs_test_terminal",
      stripeCheckoutState,
      checkoutGeneration: 4
    })).toMatchObject({
      action: "create",
      stripeSessionId: "cs_test_terminal",
      stripeCheckoutState,
      nextCheckoutGeneration: 5
    });
  });

  test("resumes a server-registered prepared checkout instead of creating another", () => {
    expect(planDepositCheckout({
      depositStatus: "unpaid",
      depositLink: "",
      stripeSessionId: "cs_test_prepared",
      stripeCheckoutState: "prepared",
      checkoutGeneration: 2
    })).toEqual({
      action: "inspect_prepared",
      status: "unpaid",
      depositLink: "",
      stripeSessionId: "cs_test_prepared",
      stripeCheckoutState: "prepared",
      checkoutGeneration: 2
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
      stripeCheckoutState: "",
      depositConfirmedAtISO: "",
      checkoutGeneration: 0
    };
    const nextPayment = {
      depositStatus: "sent",
      depositLink: "https://checkout.stripe.com/c/pay/new",
      stripeSessionId: "cs_test_new",
      stripeCheckoutState: "open",
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

  test("registers a fresh Stripe session without exposing its bearer URL", () => {
    const expectedPayment = {
      depositStatus: "unpaid",
      depositLink: "",
      stripeSessionId: "",
      stripeCheckoutState: "",
      depositConfirmedAtISO: "",
      checkoutGeneration: 0
    };
    const preparedPayment = buildPreparedCheckoutState({
      expectedPayment,
      stripeSessionId: "cs_test_prepared_1",
      checkoutGeneration: 1
    });
    expect(preparedPayment).toEqual({
      depositStatus: "unpaid",
      depositLink: "",
      stripeSessionId: "cs_test_prepared_1",
      stripeCheckoutState: "prepared",
      depositConfirmedAtISO: "",
      checkoutGeneration: 1,
      knownStripeSessionIds: ["cs_test_prepared_1"]
    });
    expect(assertPreparedCheckoutRegistrationTransition({
      currentPayment: expectedPayment,
      expectedPayment,
      preparedPayment
    })).toEqual({ alreadyApplied: false });
    expect(assertPreparedCheckoutRegistrationTransition({
      currentPayment: preparedPayment,
      expectedPayment,
      preparedPayment
    })).toEqual({ alreadyApplied: true });
  });

  test.each(["failed", "expired"])("keeps a %s session in bounded history when registering its replacement", (stripeCheckoutState) => {
    const expectedPayment = {
      depositStatus: "unpaid",
      depositLink: "",
      stripeSessionId: "cs_test_terminal_1",
      stripeCheckoutState,
      depositConfirmedAtISO: "",
      checkoutGeneration: 4,
      knownStripeSessionIds: ["cs_test_older_1", "cs_test_terminal_1"]
    };
    expect(buildPreparedCheckoutState({
      expectedPayment,
      stripeSessionId: "cs_test_prepared_5",
      checkoutGeneration: 5
    })).toMatchObject({
      stripeSessionId: "cs_test_prepared_5",
      checkoutGeneration: 5,
      knownStripeSessionIds: [
        "cs_test_older_1",
        "cs_test_terminal_1",
        "cs_test_prepared_5"
      ]
    });
  });

  test.each([
    ["paid evidence", {
      depositStatus: "paid",
      depositLink: "",
      stripeSessionId: "cs_test_paid_race",
      stripeCheckoutState: "paid",
      depositConfirmedAtISO: "2026-08-04T15:00:00.000Z",
      checkoutGeneration: 0
    }],
    ["concurrent generation", {
      depositStatus: "unpaid",
      depositLink: "",
      stripeSessionId: "cs_test_other_registration",
      stripeCheckoutState: "prepared",
      depositConfirmedAtISO: "",
      checkoutGeneration: 1
    }]
  ])("rejects prepared registration after %s changes current state", (_label, currentPayment) => {
    const expectedPayment = {
      depositStatus: "unpaid",
      depositLink: "",
      stripeSessionId: "",
      stripeCheckoutState: "",
      depositConfirmedAtISO: "",
      checkoutGeneration: 0
    };
    const preparedPayment = buildPreparedCheckoutState({
      expectedPayment,
      stripeSessionId: "cs_test_registration_race",
      checkoutGeneration: 1
    });
    expect(() => assertPreparedCheckoutRegistrationTransition({
      currentPayment,
      expectedPayment,
      preparedPayment
    })).toThrow(PaymentSafetyError);
  });

  test("publishes only the exact registered session without changing generation", () => {
    const preparedPayment = buildPreparedCheckoutState({
      expectedPayment: {
        depositStatus: "unpaid",
        checkoutGeneration: 0
      },
      stripeSessionId: "cs_test_prepared_publish",
      checkoutGeneration: 1
    });
    const publishedPayment = buildPublishedCheckoutState({
      preparedPayment,
      depositLink: "https://checkout.stripe.com/c/pay/prepared-publish"
    });
    expect(publishedPayment).toMatchObject({
      depositStatus: "sent",
      depositLink: "https://checkout.stripe.com/c/pay/prepared-publish",
      stripeSessionId: "cs_test_prepared_publish",
      stripeCheckoutState: "open",
      checkoutGeneration: 1,
      knownStripeSessionIds: ["cs_test_prepared_publish"]
    });
    expect(assertPreparedCheckoutPublicationTransition({
      currentPayment: preparedPayment,
      expectedPreparedPayment: preparedPayment,
      publishedPayment
    })).toEqual({ alreadyApplied: false });
    expect(assertPreparedCheckoutPublicationTransition({
      currentPayment: publishedPayment,
      expectedPreparedPayment: preparedPayment,
      publishedPayment
    })).toEqual({ alreadyApplied: true });
  });

  test.each([
    ["paid race", {
      depositStatus: "paid",
      depositLink: "",
      stripeSessionId: "cs_test_prepared_race",
      stripeCheckoutState: "paid",
      depositConfirmedAtISO: "2026-08-04T15:00:00.000Z",
      checkoutGeneration: 1
    }],
    ["different prepared session", {
      depositStatus: "unpaid",
      depositLink: "",
      stripeSessionId: "cs_test_other_prepared",
      stripeCheckoutState: "prepared",
      depositConfirmedAtISO: "",
      checkoutGeneration: 1
    }]
  ])("rejects publication after a %s", (_label, currentPayment) => {
    const preparedPayment = buildPreparedCheckoutState({
      expectedPayment: { depositStatus: "unpaid", checkoutGeneration: 0 },
      stripeSessionId: "cs_test_prepared_race",
      checkoutGeneration: 1
    });
    const publishedPayment = buildPublishedCheckoutState({
      preparedPayment,
      depositLink: "https://checkout.stripe.com/c/pay/race"
    });
    expect(() => assertPreparedCheckoutPublicationTransition({
      currentPayment,
      expectedPreparedPayment: preparedPayment,
      publishedPayment
    })).toThrow(PaymentSafetyError);
  });

  test.each([
    "http://checkout.stripe.com/c/pay/insecure",
    "https://attacker.example/c/pay/wrong-host",
    "https://user@checkout.stripe.com/c/pay/credential"
  ])("rejects unapproved publication URL %s", (depositLink) => {
    const preparedPayment = buildPreparedCheckoutState({
      expectedPayment: { depositStatus: "unpaid", checkoutGeneration: 0 },
      stripeSessionId: "cs_test_prepared_url",
      checkoutGeneration: 1
    });
    expect(() => buildPublishedCheckoutState({
      preparedPayment,
      depositLink
    })).toThrow(PaymentSafetyError);
  });

  test("normalizes, deduplicates, and bounds known Stripe session history", () => {
    const sessionIds = Array.from(
      { length: MAX_KNOWN_STRIPE_SESSION_IDS + 3 },
      (_value, index) => `cs_test_history_${index}`
    );
    const normalized = normalizeKnownStripeSessionIds([
      sessionIds[0],
      ...sessionIds,
      sessionIds.at(-1)
    ]);
    expect(normalized).toHaveLength(MAX_KNOWN_STRIPE_SESSION_IDS);
    expect(normalized.at(-1)).toBe(sessionIds.at(-1));
    expect(new Set(normalized).size).toBe(normalized.length);
    expect(isKnownStripeSessionId({
      stripeSessionId: "cs_test_current",
      knownStripeSessionIds: normalized
    }, "cs_test_current")).toBe(true);
    expect(isKnownStripeSessionId({
      stripeSessionId: "cs_test_current",
      knownStripeSessionIds: normalized
    }, normalized.at(-1))).toBe(true);
    expect(isKnownStripeSessionId({}, "not-a-session")).toBe(false);
    expect(() => normalizeKnownStripeSessionIds(["cs_test_valid", "invalid"])).toThrow(
      PaymentSafetyError
    );
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
