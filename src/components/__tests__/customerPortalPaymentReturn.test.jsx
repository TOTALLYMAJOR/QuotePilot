import { describe, expect, test } from "vitest";
import { getPaymentReturnMessage } from "../CustomerPortalView";

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
});
