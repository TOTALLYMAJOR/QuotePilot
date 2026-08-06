import { createRequire } from "node:module";
import { describe, expect, test } from "vitest";

const require = createRequire(import.meta.url);
const {
  hasMaterialFinalBalanceCheckout,
  portalRotationPaymentKinds
} = require("../../../functions/portalRotationPayment.js");

describe("portal rotation checkout rail selection", () => {
  test("always reconciles the deposit without inventing a final-balance checkout", () => {
    expect(portalRotationPaymentKinds({ payment: {} })).toEqual(["deposit"]);
    expect(portalRotationPaymentKinds({
      payment: { finalBalance: { amountCents: 37500, status: "unpaid" } }
    })).toEqual(["deposit"]);
  });

  test.each([
    { status: "sent" },
    { paymentLink: "https://checkout.stripe.com/c/pay/test" },
    { stripeSessionId: "cs_test_final_balance" },
    { stripeCheckoutState: "open" },
    { checkoutGeneration: 1 },
    { knownStripeSessionIds: ["cs_test_previous"] },
    { confirmedAtISO: "2026-08-06T15:00:00.000Z" }
  ])("reconciles a material final-balance rail for %#", (finalBalance) => {
    const quote = { payment: { finalBalance: { status: "unpaid", ...finalBalance } } };
    expect(hasMaterialFinalBalanceCheckout(quote)).toBe(true);
    expect(portalRotationPaymentKinds(quote)).toEqual(["deposit", "final_balance"]);
  });
});
