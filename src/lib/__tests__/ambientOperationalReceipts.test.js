import { describe, expect, test } from "vitest";
import {
  AMBIENT_OPERATIONAL_RECEIPTS_MODEL,
  AMBIENT_OPERATIONAL_RECEIPTS_SURFACE,
  buildAmbientOperationalReceipts
} from "../ambientOperationalReceipts";

function bookedQuote(overrides = {}) {
  return {
    id: "quote-booked-1",
    status: "booked",
    activeVersionId: "version-accepted-1",
    lifecycle: {
      acceptedAtISO: "2026-08-01T15:00:00.000Z",
      bookedAtISO: "2026-08-02T15:00:00.000Z"
    },
    acceptanceReceipt: {
      receiptId: "acceptance-receipt-1",
      quoteRevisionId: "version-accepted-1",
      acceptedAtISO: "2026-08-01T15:00:00.000Z"
    },
    booking: {
      contractNumber: "QP-CONTRACT-104",
      receiptId: "contract-receipt-1",
      contractConvertedAtISO: "2026-08-02T15:00:00.000Z"
    },
    payment: {
      depositStatus: "paid",
      depositConfirmedAtISO: "2026-08-03T15:00:00.000Z",
      deposit: {
        status: "paid",
        receiptId: "deposit-receipt-1",
        paidAtISO: "2026-08-03T15:00:00.000Z"
      },
      finalBalance: { status: "unpaid" }
    },
    kitchenBeo: {
      state: "current",
      generationReceiptId: "beo-receipt-1",
      generatedAtISO: "2026-08-04T15:00:00.000Z"
    },
    operationalStaffing: {
      state: "covered",
      assignmentReceiptId: "staffing-receipt-1",
      recordedAtISO: "2026-08-05T15:00:00.000Z"
    },
    postEventCloseout: {
      state: "completed",
      lastActionReceiptId: "closeout-receipt-1",
      completedAtISO: "2026-08-20T15:00:00.000Z"
    },
    ...overrides
  };
}

describe("buildAmbientOperationalReceipts", () => {
  test("keeps acceptance, payment, contract, BEO, staffing, and closeout as separate receipts", () => {
    const model = buildAmbientOperationalReceipts(bookedQuote(), { role: "admin" });

    expect(model.modelId).toBe(AMBIENT_OPERATIONAL_RECEIPTS_MODEL);
    expect(model.surfaceContract).toBe(AMBIENT_OPERATIONAL_RECEIPTS_SURFACE);
    expect(model.receipts.map((item) => item.id)).toEqual([
      "acceptance",
      "contract",
      "payment",
      "beo",
      "staffing",
      "closeout"
    ]);
    expect(model.receipts.find((item) => item.id === "acceptance")).toMatchObject({
      state: "resolved",
      receiptId: "acceptance-receipt-1"
    });
    expect(model.receipts.find((item) => item.id === "payment")).toMatchObject({
      state: "partial",
      receiptId: "deposit-receipt-1"
    });
    expect(model.nextUnresolved).toMatchObject({
      receiptId: "payment",
      label: "Resolve payment evidence",
      available: true
    });
    expect(Object.isFrozen(model)).toBe(true);
  });

  test("fails lifecycle-only acceptance and booking closed without immutable receipt identity", () => {
    const model = buildAmbientOperationalReceipts(bookedQuote({
      acceptanceReceipt: {},
      booking: {},
      payment: { depositStatus: "checkout_returned", finalBalance: { status: "requested" } },
      kitchenBeo: undefined,
      operationalStaffing: undefined,
      postEventCloseout: undefined
    }), { role: "sales" });

    expect(model.receipts.find((item) => item.id === "acceptance").state).toBe("needs_evidence");
    expect(model.receipts.find((item) => item.id === "contract").state).toBe("needs_evidence");
    expect(model.receipts.find((item) => item.id === "payment").state).toBe("needs_action");
    expect(model.receipts.find((item) => item.id === "beo").state).toBe("unavailable");
    expect(model.nextUnresolved).toMatchObject({
      receiptId: "acceptance",
      available: true
    });
  });

  test("does not expose operational authority to customer roles", () => {
    const model = buildAmbientOperationalReceipts(bookedQuote(), { role: "customer" });

    expect(model.receipts.every((item) => item.resolution.available === false)).toBe(true);
    expect(model.receipts.find((item) => item.id === "payment").detail).toContain("Browser returns");
  });

  test("uses a truthful not-due state before customer acceptance", () => {
    const model = buildAmbientOperationalReceipts({ id: "draft-1", status: "draft" }, { role: "admin" });

    expect(model.applicable).toBe(false);
    expect(model.receipts.find((item) => item.id === "acceptance").state).toBe("not_due");
    expect(model.receipts.find((item) => item.id === "contract").state).toBe("not_due");
    expect(model.summary).toContain("appear after customer acceptance");
  });
});
