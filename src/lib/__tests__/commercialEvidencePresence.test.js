import { describe, expect, test } from "vitest";
import {
  attachBookingEvidencePresence,
  attachPaymentEvidencePresence,
  captureCommercialEvidencePresence,
  readCommercialEvidencePresence
} from "../commercialEvidencePresence";

describe("commercial evidence presence", () => {
  test("keeps absent source evidence missing after hydration supplies compatibility defaults", () => {
    const sourcePresence = captureCommercialEvidencePresence({ payment: undefined, booking: {} });
    const payment = attachPaymentEvidencePresence({
      depositStatus: "unpaid",
      finalBalance: { status: "unpaid", amountCents: 480000 }
    }, sourcePresence);
    const booking = attachBookingEvidencePresence({ confirmationStatus: "pending" }, sourcePresence);
    const hydrated = { id: "quote-1", payment, booking };

    expect(readCommercialEvidencePresence(hydrated)).toEqual({
      quote: true,
      deposit: false,
      depositStatus: false,
      depositStatusValue: "",
      finalBalance: false,
      finalBalanceStatus: false,
      finalBalanceStatusValue: "",
      finalBalanceCheckoutStateValue: "",
      booking: false,
      bookingStatus: false,
      bookingStatusValue: ""
    });
    expect(readCommercialEvidencePresence({ ...hydrated })).toEqual({
      quote: true,
      deposit: false,
      depositStatus: false,
      depositStatusValue: "",
      finalBalance: false,
      finalBalanceStatus: false,
      finalBalanceStatusValue: "",
      finalBalanceCheckoutStateValue: "",
      booking: false,
      bookingStatus: false,
      bookingStatusValue: ""
    });
    expect(JSON.stringify(hydrated)).not.toContain("commercial-evidence-presence");
  });

  test("recognizes explicit raw states and provider or contract evidence without inventing it", () => {
    expect(readCommercialEvidencePresence({
      id: "quote-2",
      payment: {
        depositStatus: "unpaid",
        finalBalance: { status: "sent" }
      },
      booking: { confirmationStatus: "pending" }
    })).toEqual({
      quote: true,
      deposit: true,
      depositStatus: true,
      depositStatusValue: "unpaid",
      finalBalance: true,
      finalBalanceStatus: true,
      finalBalanceStatusValue: "sent",
      finalBalanceCheckoutStateValue: "",
      booking: true,
      bookingStatus: true,
      bookingStatusValue: "pending"
    });
    expect(readCommercialEvidencePresence({
      quoteNumber: "QP-3",
      payment: { depositConfirmedAtISO: "2026-09-08T09:00:00.000Z" },
      booking: { contractNumber: "CT-3" }
    })).toMatchObject({
      quote: true,
      deposit: true,
      depositStatus: false,
      booking: true,
      bookingStatus: false
    });
  });

  test("does not turn empty shells or a missing quote into commercial assertions", () => {
    expect(readCommercialEvidencePresence({ payment: {}, booking: {} })).toEqual({
      quote: false,
      deposit: false,
      depositStatus: false,
      depositStatusValue: "",
      finalBalance: false,
      finalBalanceStatus: false,
      finalBalanceStatusValue: "",
      finalBalanceCheckoutStateValue: "",
      booking: false,
      bookingStatus: false,
      bookingStatusValue: ""
    });
  });

  test("marks malformed recorded statuses as present so projections can fail closed", () => {
    expect(readCommercialEvidencePresence({
      id: "quote-malformed",
      payment: {
        depositStatus: "provider_mystery",
        finalBalance: { stripeCheckoutState: "provider_mystery" }
      },
      booking: { confirmationStatus: "provider_mystery" }
    })).toMatchObject({
      depositStatus: true,
      depositStatusValue: "provider_mystery",
      finalBalanceStatus: true,
      finalBalanceCheckoutStateValue: "provider_mystery",
      bookingStatus: true,
      bookingStatusValue: "provider_mystery"
    });
  });
});
