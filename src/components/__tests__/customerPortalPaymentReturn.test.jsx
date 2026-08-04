import { describe, expect, test } from "vitest";
import {
  getCustomerFinalBalanceUi,
  getPaymentReturnMessage,
  readPaymentReturnKind
} from "../CustomerPortalView";

describe("customer portal payment return messaging", () => {
  test("treats an unverified success query string only as a return hint", () => {
    const message = getPaymentReturnMessage("success", {
      depositStatus: "sent",
      stripeCheckoutState: "open"
    });

    expect(message).toMatchObject({ tone: "processing" });
    expect(message.text).toMatch(/no verified payment confirmation/i);
    expect(message.text).not.toMatch(/payment submitted/i);
  });

  test.each(["success", "cancelled"])(
    "provider-owned paid state outranks a %s return hint",
    (paymentReturn) => {
      expect(getPaymentReturnMessage(paymentReturn, {
        depositStatus: "paid",
        stripeCheckoutState: "paid"
      })).toMatchObject({ tone: "confirmed" });
    }
  );

  test("provider-owned processing state outranks a cancellation hint", () => {
    const message = getPaymentReturnMessage("cancelled", {
      depositStatus: "sent",
      stripeCheckoutState: "processing"
    });

    expect(message).toMatchObject({ tone: "processing" });
    expect(message.text).toMatch(/stripe reports/i);
  });

  test("shows a server-owned refunded state without treating the return hint as authority", () => {
    expect(getPaymentReturnMessage("success", {
      depositStatus: "refunded",
      stripeCheckoutState: "paid"
    })).toMatchObject({ tone: "refunded" });
  });

  test.each(["failed", "expired"])(
    "explains a verified %s outcome even after a cancellation return",
    (stripeCheckoutState) => {
      expect(getPaymentReturnMessage("cancelled", {
        depositStatus: "unpaid",
        stripeCheckoutState
      })).toMatchObject({ tone: "failed" });
    }
  );

  test("keeps cancellation explicitly non-authoritative", () => {
    const message = getPaymentReturnMessage("cancelled", {
      depositStatus: "unpaid"
    });

    expect(message).toMatchObject({ tone: "cancelled" });
    expect(message.text).toMatch(/without a verified payment confirmation/i);
    expect(message.text).not.toMatch(/no payment is recorded/i);
    expect(getPaymentReturnMessage("", {})).toBeNull();
  });

  test("uses final-balance provider evidence instead of the already-paid deposit", () => {
    const message = getPaymentReturnMessage("success", {
      depositStatus: "paid",
      stripeCheckoutState: "paid",
      finalBalance: {
        status: "sent",
        stripeCheckoutState: "processing"
      }
    }, "final_balance");

    expect(message).toMatchObject({ tone: "processing" });
    expect(message.text).toMatch(/final-balance payment is processing/i);
    expect(message.text).not.toMatch(/deposit/i);
  });

  test.each([
    ["paid", "paid", "confirmed"],
    ["unpaid", "failed", "failed"],
    ["unpaid", "expired", "failed"]
  ])("renders final-balance %s from its own provider projection", (status, stripeCheckoutState, tone) => {
    const message = getPaymentReturnMessage("success", {
      depositStatus: "paid",
      stripeCheckoutState: "paid",
      finalBalance: { status, stripeCheckoutState }
    }, "final_balance");

    expect(message).toMatchObject({ tone });
    expect(message.text).not.toMatch(/deposit/i);
  });

  test("keeps legacy returns on the deposit rail unless payment_kind selects final balance", () => {
    expect(readPaymentReturnKind("?payment=success")).toBe("deposit");
    expect(readPaymentReturnKind("?payment=success&payment_kind=final_balance"))
      .toBe("final_balance");
    expect(readPaymentReturnKind("?payment_kind=unexpected"))
      .toBe("deposit");
  });

  test("shows a customer-safe final balance and only exposes a published eligible Stripe link", () => {
    const quote = {
      status: "booked",
      booking: { contractNumber: "C-260804-12345" },
      payment: {
        depositStatus: "paid",
        finalBalance: {
          amountCents: 37500,
          currency: "usd",
          status: "sent",
          paymentLink: "https://checkout.stripe.com/c/pay/final-balance"
        }
      }
    };
    expect(getCustomerFinalBalanceUi(quote)).toMatchObject({
      visible: true,
      amountCents: 37500,
      currency: "usd",
      statusLabel: "awaiting payment",
      paymentLink: "https://checkout.stripe.com/c/pay/final-balance"
    });
    expect(getCustomerFinalBalanceUi({
      ...quote,
      status: "accepted"
    }).paymentLink).toBe("");
    expect(getCustomerFinalBalanceUi({
      ...quote,
      payment: {
        ...quote.payment,
        finalBalance: {
          ...quote.payment.finalBalance,
          status: "sent",
          stripeCheckoutState: "processing"
        }
      }
    })).toMatchObject({ statusLabel: "processing", paymentLink: "" });
    for (const stripeCheckoutState of ["failed", "expired"]) {
      expect(getCustomerFinalBalanceUi({
        ...quote,
        payment: {
          ...quote.payment,
          finalBalance: {
            ...quote.payment.finalBalance,
            status: "unpaid",
            stripeCheckoutState
          }
        }
      })).toMatchObject({
        statusLabel: stripeCheckoutState === "failed"
          ? "payment failed"
          : "payment link expired",
        paymentLink: ""
      });
    }
    expect(getCustomerFinalBalanceUi({
      ...quote,
      payment: {
        ...quote.payment,
        finalBalance: {
          ...quote.payment.finalBalance,
          paymentLink: "https://checkout.stripe.com.evil.test/phishing"
        }
      }
    }).paymentLink).toBe("");
    expect(getCustomerFinalBalanceUi({
      ...quote,
      payment: {
        ...quote.payment,
        finalBalance: { ...quote.payment.finalBalance, status: "paid" }
      }
    }).paymentLink).toBe("");
  });
});
