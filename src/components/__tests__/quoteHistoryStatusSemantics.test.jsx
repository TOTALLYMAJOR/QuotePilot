import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { describe, expect, test } from "vitest";
import { STATUS_FAMILY } from "../../lib/statusSemantics";
import { getQuoteHistoryStatusSemantics } from "../QuoteHistoryModal";

const QUOTE_HISTORY_SOURCE = readFileSync(
  fileURLToPath(new URL("../QuoteHistoryModal.jsx", import.meta.url)),
  "utf8"
);

describe("Quote History status semantics", () => {
  test("classifies lifecycle, booking confirmation, deposit, and final balance independently", () => {
    const semantics = getQuoteHistoryStatusSemantics({
      status: "booked",
      booking: { confirmationStatus: "confirmed" },
      payment: {
        depositStatus: "paid",
        finalBalance: { status: "paid", stripeCheckoutState: "failed" }
      }
    });

    expect(semantics).toEqual({
      lifecycle: { family: STATUS_FAMILY.CONFIRMED, label: "Booked" },
      bookingConfirmation: { family: STATUS_FAMILY.CONFIRMED, label: "Confirmed" },
      deposit: { family: STATUS_FAMILY.CONFIRMED, label: "Deposit paid" },
      finalBalance: { family: STATUS_FAMILY.CONFIRMED, label: "Balance paid" },
      finalBalanceDisplayStatus: "paid"
    });
    expect(new Set([
      semantics.lifecycle.label,
      semantics.bookingConfirmation.label,
      semantics.deposit.label,
      semantics.finalBalance.label
    ]).size).toBe(4);
  });

  test("keeps acceptance distinct from pending booking and payment facts", () => {
    const semantics = getQuoteHistoryStatusSemantics({
      status: "accepted",
      booking: { confirmationStatus: "pending" },
      payment: {
        depositStatus: "sent",
        finalBalance: { status: "sent", stripeCheckoutState: "processing" }
      }
    });

    expect(semantics.lifecycle).toEqual({
      family: STATUS_FAMILY.CONFIRMED,
      label: "Accepted"
    });
    expect(semantics.bookingConfirmation).toEqual({
      family: STATUS_FAMILY.ACTION,
      label: "Confirmation pending"
    });
    expect(semantics.deposit).toEqual({
      family: STATUS_FAMILY.PENDING,
      label: "Deposit requested"
    });
    expect(semantics.finalBalance).toEqual({
      family: STATUS_FAMILY.PROVIDER,
      label: "Balance processing"
    });
  });

  test("renders separate semantic chips while retaining authoritative status controls", () => {
    for (const label of [
      "Quote / proposal lifecycle",
      "Booking confirmation",
      "Deposit",
      "Final balance"
    ]) {
      expect(QUOTE_HISTORY_SOURCE).toContain(label);
    }

    for (const fact of ["lifecycle", "bookingConfirmation", "deposit", "finalBalance"]) {
      expect(QUOTE_HISTORY_SOURCE).toContain(
        `<StatusChip {...statusSemantics.${fact}} />`
      );
    }

    expect(QUOTE_HISTORY_SOURCE).toContain(
      "onChange={(e) => handleStatusUpdate(quote.id, e.target.value)}"
    );
    expect(QUOTE_HISTORY_SOURCE).toContain(
      "onChange={(e) => handleConfirmationUpdate(quote.id, e.target.value)}"
    );
    expect(QUOTE_HISTORY_SOURCE).toContain("Delivery readiness: Review required");
    expect(QUOTE_HISTORY_SOURCE).toContain("&& rebookDeliveryGate.ready");
    expect(QUOTE_HISTORY_SOURCE).toContain("Rebook review: {rebookDeliveryGate.ready ? \"Completed\" : \"Required before delivery\"}");
    expect(QUOTE_HISTORY_SOURCE).toContain("Open edit and complete review");
    expect(QUOTE_HISTORY_SOURCE).not.toContain("<strong>{quote.status || \"draft\"}</strong>");
    expect(QUOTE_HISTORY_SOURCE).not.toContain("Deposit: {quote.payment?.depositStatus");
  });
});
