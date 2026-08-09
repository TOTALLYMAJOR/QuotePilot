import { describe, expect, test } from "vitest";
import {
  buildCustomerCommercialMeasures,
  CUSTOMER_COMMERCIAL_MEASURES_SCHEMA_VERSION
} from "../customerCommercialMeasures";

function workspace(overrides = {}) {
  return {
    source: "firebase",
    customer: { id: "customer-1", customerId: "customer-1" },
    quotes: [],
    quotePageInfo: { limit: 25, truncated: false },
    ...overrides
  };
}

function quote({
  id,
  status = "draft",
  total = 0,
  deposit = 0,
  eventDate = "",
  payment = {}
} = {}) {
  return {
    id,
    customerId: "customer-1",
    status,
    totals: { total, deposit },
    event: { date: eventDate },
    payment: {
      depositStatus: "unpaid",
      ...payment
    }
  };
}

describe("Customer 360 commercial measures", () => {
  test("returns separate bounded quoted, accepted, booked, and provider-confirmed payment amounts", () => {
    const result = buildCustomerCommercialMeasures(workspace({
      quotes: [
        quote({ id: "draft-1", total: 100 }),
        quote({ id: "accepted-1", status: "accepted", total: 500 }),
        quote({
          id: "booked-1",
          status: "booked",
          total: 1_000,
          deposit: 250,
          eventDate: "2025-08-10",
          payment: {
            depositStatus: "paid",
            depositConfirmedAtISO: "2025-06-01T14:00:00.000Z",
            finalBalance: {
              status: "paid",
              amountCents: 75_000,
              currency: "usd",
              confirmedAtISO: "2025-08-01T14:00:00.000Z"
            }
          }
        }),
        quote({ id: "booked-2", status: "booked", total: 200, eventDate: "2026-08-10" })
      ]
    }));

    expect(result).toMatchObject({
      schemaVersion: CUSTOMER_COMMERCIAL_MEASURES_SCHEMA_VERSION,
      status: "success",
      source: "firebase",
      sourceLabel: "Firestore customer workspace",
      customerId: "customer-1",
      scope: {
        kind: "complete_customer_quote_read",
        label: "Lifetime commercial measures",
        complete: true
      },
      bounds: {
        inputQuoteCount: 4,
        displayedRecordCount: 4,
        excludedQuoteCount: 0,
      quoteReadLimit: 25,
        quoteReadTruncationKnown: true,
        quoteReadTruncated: false
      }
    });
    expect(result.measures.quoted).toMatchObject({
      amount: 1_800,
      amountCents: 180_000,
      status: "success",
      denominator: { eligibleRecordCount: 4, knownAmountRecordCount: 4 }
    });
    expect(result.measures.accepted).toMatchObject({ amount: 500, amountCents: 50_000 });
    expect(result.measures.booked).toMatchObject({ amount: 1_200, amountCents: 120_000 });
    expect(result.measures.webhookConfirmedDeposit).toMatchObject({
      amount: 250,
      amountCents: 25_000,
      denominator: {
        eligibleRecordCount: 1,
        evidenceQualifiedRecordCount: 1,
        knownAmountRecordCount: 1,
        unknownAmountRecordCount: 0
      }
    });
    expect(result.measures.webhookConfirmedFinalBalance).toMatchObject({
      amount: 750,
      amountCents: 75_000,
      denominator: {
        eligibleRecordCount: 1,
        evidenceQualifiedRecordCount: 1,
        knownAmountRecordCount: 1,
        unknownAmountRecordCount: 0,
        currencyMismatchRecordCount: 0
      }
    });
    expect(result.repeatEventSignal).toEqual({
      status: "success",
      basis: "displayed_quote_records_in_exact_booked_state",
      bookedEventCount: 2,
      knownEventDateCount: 2,
      unknownEventDateCount: 0,
      repeatBookingCount: 1,
      hasRepeatBookingEvidence: true,
      firstEventDate: "2025-08-10",
      lastEventDate: "2026-08-10",
      dateSpanDays: 365
    });
  });

  test("uses displayed-record wording and partial status when the quote read is truncated", () => {
    const result = buildCustomerCommercialMeasures(workspace({
      quotes: [quote({ id: "quote-1", status: "accepted", total: 500 })],
      quotePageInfo: { limit: 25, truncated: true }
    }));

    expect(result.status).toBe("partial");
    expect(result.scope).toEqual({
      kind: "displayed_records",
      label: "Displayed-record commercial measures",
      complete: false
    });
    expect(JSON.stringify(result).toLowerCase()).not.toContain("lifetime");
    expect(result.measures.quoted.amount).toBe(500);
  });

  test("does not claim lifetime scope when the quote-read bound is missing", () => {
    const input = workspace({ quotes: [quote({ id: "quote-1", total: 100 })] });
    delete input.quotePageInfo;

    const result = buildCustomerCommercialMeasures(input);

    expect(result.status).toBe("partial");
    expect(result.scope).toEqual({
      kind: "displayed_records",
      label: "Displayed-record commercial measures",
      complete: false
    });
    expect(result.bounds.quoteReadTruncationKnown).toBe(false);
    expect(JSON.stringify(result).toLowerCase()).not.toContain("lifetime");
  });

  test("preserves unknown amounts and genuine zeroes with explicit known/eligible denominators", () => {
    const result = buildCustomerCommercialMeasures(workspace({
      quotes: [
        quote({ id: "accepted-unknown", status: "accepted", total: "" }),
        quote({ id: "booked-zero", status: "booked", total: 0, eventDate: "2026-08-10" })
      ]
    }));

    expect(result.status).toBe("partial");
    expect(result.measures.quoted).toMatchObject({
      status: "partial",
      amount: 0,
      amountCents: 0,
      denominator: {
        eligibleRecordCount: 2,
        knownAmountRecordCount: 1,
        unknownAmountRecordCount: 1
      }
    });
    expect(result.measures.accepted).toMatchObject({
      status: "partial",
      amount: null,
      amountCents: null,
      denominator: {
        eligibleRecordCount: 1,
        knownAmountRecordCount: 0,
        unknownAmountRecordCount: 1
      }
    });
    expect(result.measures.booked).toMatchObject({
      status: "success",
      amount: 0,
      amountCents: 0
    });
  });

  test("requires exact paid state and valid canonical provider timestamps for payment inclusion", () => {
    const result = buildCustomerCommercialMeasures(workspace({
      quotes: [
        quote({
          id: "paid-without-evidence",
          deposit: 100,
          payment: {
            depositStatus: "paid",
            depositConfirmedAtISO: "",
            finalBalance: {
              status: "paid",
              amountCents: 40_000,
              confirmedAtISO: "2026-08-09"
            }
          }
        }),
        quote({
          id: "evidence-without-paid-state",
          deposit: 200,
          payment: {
            depositStatus: "sent",
            depositConfirmedAtISO: "2026-08-09T10:00:00.000Z",
            finalBalance: {
              status: "sent",
              amountCents: 80_000,
              confirmedAtISO: "2026-08-09T11:00:00.000Z"
            }
          }
        }),
        quote({
          id: "provider-confirmed",
          deposit: 300,
          payment: {
            depositStatus: "paid",
            depositConfirmedAtISO: "2026-08-09T12:00:00.000Z",
            finalBalance: {
              status: "paid",
              amountCents: 90_000,
              confirmedAtISO: "2026-08-09T13:00:00.000Z"
            }
          }
        })
      ]
    }));

    expect(result.measures.webhookConfirmedDeposit).toMatchObject({
      status: "partial",
      amount: 300,
      denominator: {
        eligibleRecordCount: 2,
        evidenceQualifiedRecordCount: 1,
        knownAmountRecordCount: 1,
        unknownAmountRecordCount: 1,
        evidenceMissingRecordCount: 1,
        stateMismatchRecordCount: 1
      }
    });
    expect(result.measures.webhookConfirmedFinalBalance).toMatchObject({
      status: "partial",
      amount: 900,
      denominator: {
        eligibleRecordCount: 2,
        evidenceQualifiedRecordCount: 1,
        knownAmountRecordCount: 1,
        unknownAmountRecordCount: 1,
        evidenceMissingRecordCount: 1,
        stateMismatchRecordCount: 1
      }
    });
  });

  test.each(["local", "mixed", "unknown"])(
    "fails closed for %s payment fields while preserving non-payment commercial measures",
    (source) => {
      const result = buildCustomerCommercialMeasures(workspace({
        source,
        quotes: [quote({
          id: "browser-paid",
          status: "booked",
          total: 1_000,
          deposit: 250,
          eventDate: "2026-08-10",
          payment: {
            depositStatus: "paid",
            depositConfirmedAtISO: "2026-06-01T14:00:00.000Z",
            finalBalance: {
              status: "paid",
              amountCents: 75_000,
              currency: "usd",
              confirmedAtISO: "2026-08-01T14:00:00.000Z"
            }
          }
        })]
      }));

      expect(result.measures.quoted).toMatchObject({ status: "success", amount: 1_000 });
      expect(result.measures.booked).toMatchObject({ status: "success", amount: 1_000 });
      expect(result.measures.webhookConfirmedDeposit).toMatchObject({
        status: "partial",
        amount: null,
        amountCents: null,
        denominator: {
          eligibleRecordCount: 1,
          evidenceQualifiedRecordCount: 0,
          knownAmountRecordCount: 0,
          unknownAmountRecordCount: 1,
          evidenceMissingRecordCount: 1
        }
      });
      expect(result.measures.webhookConfirmedFinalBalance).toMatchObject({
        status: "partial",
        amount: null,
        amountCents: null,
        denominator: {
          eligibleRecordCount: 1,
          evidenceQualifiedRecordCount: 0,
          knownAmountRecordCount: 0,
          unknownAmountRecordCount: 1,
          evidenceMissingRecordCount: 1
        }
      });
      expect(result.evidenceBoundary).toContain(
        "other sources fail closed"
      );
    }
  );

  test("marks contradictory provider timestamps outside paid state as partial without counting them", () => {
    const result = buildCustomerCommercialMeasures(workspace({
      quotes: [quote({
        id: "contradictory",
        total: 100,
        deposit: 25,
        payment: {
          depositStatus: "sent",
          depositConfirmedAtISO: "2026-08-09T10:00:00.000Z",
          finalBalance: {
            status: "sent",
            amountCents: 7_500,
            confirmedAtISO: "2026-08-09T11:00:00.000Z"
          }
        }
      })]
    }));

    expect(result.status).toBe("partial");
    expect(result.measures.webhookConfirmedDeposit).toMatchObject({
      status: "partial",
      amount: null,
      denominator: { eligibleRecordCount: 0, stateMismatchRecordCount: 1 }
    });
    expect(result.measures.webhookConfirmedFinalBalance).toMatchObject({
      status: "partial",
      amount: null,
      denominator: { eligibleRecordCount: 0, stateMismatchRecordCount: 1 }
    });
  });

  test("derives repeat signals deterministically from booked records and exposes missing dates", () => {
    const result = buildCustomerCommercialMeasures(workspace({
      quotes: [
        quote({ id: "booked-late", status: "booked", total: 1, eventDate: "2026-12-31" }),
        quote({ id: "booked-missing", status: "booked", total: 1, eventDate: "not-a-date" }),
        quote({ id: "booked-early", status: "booked", total: 1, eventDate: "2025-01-01" }),
        quote({ id: "accepted", status: "accepted", total: 1, eventDate: "2024-01-01" })
      ]
    }));

    expect(result.repeatEventSignal).toEqual({
      status: "partial",
      basis: "displayed_quote_records_in_exact_booked_state",
      bookedEventCount: 3,
      knownEventDateCount: 2,
      unknownEventDateCount: 1,
      repeatBookingCount: 2,
      hasRepeatBookingEvidence: true,
      firstEventDate: "2025-01-01",
      lastEventDate: "2026-12-31",
      dateSpanDays: null
    });
    expect(result.repeatEventSignal).not.toHaveProperty("predictedRevenue");
    expect(result.repeatEventSignal).not.toHaveProperty("predictedLead");
  });

  test("excludes unscoped records, reports the bound, and rejects email-shaped identity", () => {
    const result = buildCustomerCommercialMeasures(workspace({
      quotes: [
        quote({ id: "included", total: 100 }),
        { ...quote({ id: "foreign", total: 999 }), customerId: "customer-2" },
        { ...quote({ id: "", total: 999 }), customerId: "customer-1" }
      ]
    }));

    expect(result.status).toBe("partial");
    expect(result.bounds).toMatchObject({
      inputQuoteCount: 3,
      displayedRecordCount: 1,
      excludedQuoteCount: 2
    });
    expect(result.measures.quoted.amount).toBe(100);
    expect(() => buildCustomerCommercialMeasures(workspace({
      customer: { id: "customer@example.com" }
    }))).toThrow(/opaque customerId/);
  });

  test("returns an empty, deeply frozen, read-only projection without persisted rollups", () => {
    const result = buildCustomerCommercialMeasures(workspace());

    expect(result.status).toBe("empty");
    expect(result.measures.quoted).toMatchObject({
      status: "empty",
      amount: null,
      amountCents: null,
      denominator: {
        eligibleRecordCount: 0,
        knownAmountRecordCount: 0,
        unknownAmountRecordCount: 0
      }
    });
    expect(result.repeatEventSignal.status).toBe("empty");
    expect(result.projection).toEqual({
      mode: "derived_read_only",
      persistedRollup: false,
      writesPerformed: false
    });
    expect(Object.isFrozen(result)).toBe(true);
    expect(Object.isFrozen(result.measures)).toBe(true);
    expect(Object.isFrozen(result.measures.quoted.denominator)).toBe(true);
    expect(Object.isFrozen(result.repeatEventSignal)).toBe(true);
    expect(() => {
      result.measures.quoted.amount = 1;
    }).toThrow();
  });
});
