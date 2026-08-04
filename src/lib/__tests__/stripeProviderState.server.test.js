import { createRequire } from "node:module";
import { describe, expect, test } from "vitest";

const require = createRequire(import.meta.url);
const {
  StripeProviderStateError,
  assertStripeObjectMode,
  assertStripeSecretKeyMode,
  mapStripeCheckoutObservation,
  mapStripeCheckoutReconciliation,
  normalizeStripeMode,
  planStripeCheckoutTransition
} = require("../../../functions/stripeProviderState.js");

describe("Stripe provider state", () => {
  test("requires explicit matching key and object modes", () => {
    expect(normalizeStripeMode(" LIVE ")).toBe("live");
    expect(assertStripeSecretKeyMode("rk_live_fixture", "live")).toBe(true);
    expect(assertStripeObjectMode({
      expectedMode: "test",
      eventLivemode: false,
      sessionLivemode: false
    })).toEqual({ mode: "test", livemode: false });
    expect(() => normalizeStripeMode("")).toThrow(StripeProviderStateError);
    expect(() => assertStripeSecretKeyMode("sk_test_fixture", "live")).toThrow(/matching/i);
    expect(() => assertStripeObjectMode({
      expectedMode: "live",
      eventLivemode: false,
      sessionLivemode: false
    })).toThrow(/does not match/i);
  });

  test.each([
    ["checkout.session.completed", "paid", "paid"],
    ["checkout.session.completed", "unpaid", "processing"],
    ["checkout.session.async_payment_succeeded", "paid", "paid"],
    ["checkout.session.async_payment_failed", "unpaid", "failed"],
    ["checkout.session.expired", "unpaid", "expired"]
  ])("maps %s with %s to %s", (eventType, paymentStatus, providerState) => {
    expect(mapStripeCheckoutObservation({
      eventType,
      session: { payment_status: paymentStatus, status: providerState === "expired" ? "expired" : "complete" }
    })).toMatchObject({ supported: true, providerState });
  });

  test.each([
    ["checkout.session.completed", "open", "paid", /status=complete/],
    ["checkout.session.completed", "complete", "no_payment_required", /payment_status=paid or unpaid/],
    ["checkout.session.async_payment_succeeded", "open", "paid", /status=complete/],
    ["checkout.session.async_payment_succeeded", "complete", "unpaid", /payment_status=paid/],
    ["checkout.session.async_payment_failed", "open", "unpaid", /status=complete/],
    ["checkout.session.async_payment_failed", "complete", "paid", /payment_status=unpaid/],
    ["checkout.session.expired", "complete", "unpaid", /status=expired/],
    ["checkout.session.expired", "expired", "paid", /payment_status=unpaid/]
  ])(
    "rejects inconsistent %s evidence with status=%s and payment_status=%s",
    (eventType, status, paymentStatus, expectedMessage) => {
      expect(() => mapStripeCheckoutObservation({
        eventType,
        session: { status, payment_status: paymentStatus }
      })).toThrow(expectedMessage);
    }
  );

  test("maps unsupported events without state mutation authority", () => {
    expect(mapStripeCheckoutObservation({
      eventType: "charge.refunded",
      session: {}
    })).toEqual({ supported: false, eventType: "charge.refunded" });
  });

  test.each([
    [{ status: "complete", payment_status: "paid" }, true, "paid", false],
    [{ status: "expired", payment_status: "unpaid" }, true, "expired", false],
    [{ status: "open", payment_status: "unpaid" }, false, "open", false],
    [{ status: "complete", payment_status: "unpaid", payment_intent: { status: "processing" } }, true, "processing", false],
    [{ status: "complete", payment_status: "unpaid", payment_intent: { status: "requires_payment_method" } }, true, "failed", false],
    [{ status: "complete", payment_status: "unpaid" }, false, "unknown", true]
  ])("maps provider reconciliation without guessing settlement", (session, actionable, providerState, reviewRequired) => {
    expect(mapStripeCheckoutReconciliation(session)).toEqual({
      actionable,
      providerState,
      reviewRequired
    });
  });

  test("plans processing, failure, expiry, and paid transitions without downgrading truth", () => {
    const currentPayment = {
      depositStatus: "sent",
      depositLink: "https://checkout.stripe.com/c/pay/session",
      depositConfirmedAtISO: "",
      stripeSessionId: "cs_test_active",
      stripeCheckoutState: "open"
    };
    expect(planStripeCheckoutTransition({
      currentPayment,
      sessionId: "cs_test_active",
      providerState: "failed"
    })).toMatchObject({
      apply: true,
      paymentPatch: {
        depositStatus: "unpaid",
        depositLink: "",
        stripeCheckoutState: "failed"
      }
    });
    expect(planStripeCheckoutTransition({
      currentPayment: { ...currentPayment, stripeSessionId: "cs_test_new" },
      sessionId: "cs_test_stale",
      providerState: "expired"
    })).toMatchObject({ apply: false, reason: "stale_session" });
    expect(planStripeCheckoutTransition({
      currentPayment: {
        ...currentPayment,
        depositStatus: "paid",
        depositConfirmedAtISO: "2026-08-04T00:00:00.000Z",
        stripeCheckoutState: "paid"
      },
      sessionId: "cs_test_active",
      providerState: "expired"
    })).toMatchObject({ apply: false, reason: "settlement_is_monotonic" });
    expect(planStripeCheckoutTransition({
      currentPayment: { ...currentPayment, stripeCheckoutState: "failed", depositLink: "" },
      sessionId: "cs_test_active",
      providerState: "paid",
      confirmedAtISO: "2026-08-04T00:00:00.000Z"
    })).toMatchObject({ apply: true, paymentPatch: { depositStatus: "paid" } });
  });
});
