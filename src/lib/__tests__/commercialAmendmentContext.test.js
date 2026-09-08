import { describe, expect, test } from "vitest";
import { buildCommercialAmendmentContext } from "../commercialAmendmentContext";

describe("buildCommercialAmendmentContext", () => {
  test("projects the exact saved commitment and bounded preserved evidence without provider secrets", () => {
    const context = buildCommercialAmendmentContext({
      id: "quote-17",
      quoteNumber: "Q-0017",
      status: "viewed",
      activeVersionId: "v0017",
      latestVersionNumber: 17,
      event: { name: "Henderson Dinner", date: "2026-10-14", venue: "The Foundry", guests: 168 },
      totals: { total: 18400, deposit: 4600 },
      payment: {
        currency: "usd",
        depositStatus: "paid",
        depositConfirmedAtISO: "2026-08-20T17:00:00.000Z",
        stripeSessionId: "cs_secret_provider_identifier"
      },
      acceptanceReceipt: {
        receiptId: "acceptance-17",
        acceptedAtISO: "2026-08-19T12:00:00.000Z",
        quoteRevisionId: "v0016"
      },
      booking: {
        bookedAtISO: "2026-08-21T13:00:00.000Z",
        contractNumber: "QP-2026-17"
      },
      deliveryEvidence: {
        revisionId: "v0017",
        providerAcceptedAtISO: "2026-08-22T14:00:00.000Z",
        portalKey: "must-not-leak"
      }
    });

    expect(context).toMatchObject({
      quoteId: "quote-17",
      quoteNumber: "Q-0017",
      revisionId: "v0017",
      versionNumber: 17,
      versionLabel: "Version 17",
      status: "viewed",
      editable: true,
      commercial: { currency: "USD", total: 18400, deposit: 4600 },
      protocol: { state: "renewed_delivery_required", canAmend: true }
    });
    expect(context.preservedEvidence.map((item) => item.kind)).toEqual([
      "customer_acceptance",
      "provider_payment",
      "booking",
      "provider_delivery"
    ]);
    expect(JSON.stringify(context)).not.toContain("cs_secret_provider_identifier");
    expect(JSON.stringify(context)).not.toContain("must-not-leak");
    expect(Object.isFrozen(context)).toBe(true);
  });

  test.each(["accepted", "booked", "paid", "declined", "refunded", "expired", "deleted"])(
    "keeps %s commitment evidence outside the existing editable authority",
    (status) => {
      const context = buildCommercialAmendmentContext({ id: "quote-locked", status });
      expect(context.editable).toBe(false);
      expect(context.protocol).toMatchObject({
        state: "terminal_commitment_locked",
        canAmend: false
      });
    }
  );

  test("does not turn missing evidence into a positive claim", () => {
    const context = buildCommercialAmendmentContext({
      id: "quote-draft",
      status: "draft",
      totals: {}
    });
    expect(context.preservedEvidence).toEqual([]);
    expect(context.commercial).toEqual({ currency: "USD", total: null, deposit: null });
  });
});
