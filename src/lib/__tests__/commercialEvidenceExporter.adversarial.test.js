// Adversarial tests for the evidence exporter.
//
// Each case is a way real Firestore data goes wrong. The exporter's job in all
// of them is the same: never coerce, never guess, never let a broken record
// read as a clean one. A test here that starts passing "more easily" is a
// regression.

import { describe, expect, it } from "vitest";

import {
  IDS,
  acceptedRecords,
  quoteVersionDocument,
  settledDepositLedger
} from "../../../evidence/testing/authoritativeRecords.mjs";
import { EVALUATED_AT } from "../../../evidence/testing/buildFixtures.mjs";
import { exportBundle, exportRecord } from "../../../evidence/src/exporterCore.mjs";
import { canonicalJson } from "../../../evidence/src/canonical.mjs";
import { guarded, producerRegistry } from "../../../evidence/src/producers/index.mjs";
import { createPayoutProducer } from "../../../evidence/src/producers/payoutProducer.mjs";
import { createFeeScheduleProducer } from "../../../evidence/src/producers/feeScheduleProducer.mjs";
import { createConsumptionProducer } from "../../../evidence/src/producers/consumptionProducer.mjs";
import {
  AVAILABILITY,
  EvidenceContractError,
  envelope,
  missing
} from "../../../evidence/src/availability.mjs";

function producers(overrides = {}) {
  return producerRegistry([
    guarded(createPayoutProducer(), { missing }),
    guarded(
      createFeeScheduleProducer({ readOrganizationSettings: () => overrides.settings ?? null }),
      { missing }
    ),
    guarded(
      createConsumptionProducer({ readConsumption: () => overrides.consumption ?? null }),
      { missing }
    )
  ]);
}

function source({ mutate = () => {}, eventCompleted = false } = {}) {
  const accepted = acceptedRecords();
  accepted.quote.payment = { ledger: settledDepositLedger() };
  const built = {
    quoteId: IDS.QUOTE_ID,
    quote: accepted.quote,
    acceptanceReceipt: accepted.acceptanceReceipt,
    quoteVersion: quoteVersionDocument(),
    organizationSettings: { catalogRevision: 12 },
    eventCompleted
  };
  mutate(built);
  return built;
}

const exportOne = (built, registry = producers()) =>
  exportRecord(built, { evaluatedAtISO: EVALUATED_AT, producers: registry });

describe("adversarial: absent evidence", () => {
  it("does not fall back to the quote's totals when the receipt is gone", () => {
    // The quote holds totalMinor and depositMinor, which look like a usable
    // substitute. They are not the signed promise, and reading them as one
    // would let an unsigned number reconcile real money.
    const record = exportOne(source({ mutate: (s) => { s.acceptanceReceipt = null; } }));
    expect(record.evidence.acceptedSnapshot.availability).toBe(AVAILABILITY.MISSING);
    expect(record.evidence.acceptedSnapshot.value).toBeUndefined();
    expect(record.evidence.acceptedSnapshot.detail).toContain("cannot be read from the quote alone");
  });

  it("reports an absent cost snapshot rather than an empty cost basis", () => {
    const record = exportOne(source({ mutate: (s) => { s.quoteVersion = { versionId: "v1" }; } }));
    expect(record.evidence.costBasis.availability).toBe(AVAILABILITY.MISSING);
    expect(record.evidence.costBasis.value).toBeUndefined();
  });

  it("reports an absent pricing authority rather than revision zero", () => {
    const record = exportOne(
      source({ mutate: (s) => { delete s.quote.pricingCatalogAuthority; } })
    );
    expect(record.evidence.authorizedQuote.availability).toBe(AVAILABILITY.MISSING);
  });
});

describe("adversarial: contradictory evidence", () => {
  it("reports a receipt that no longer hashes to the quote's digest", () => {
    const record = exportOne(
      source({
        mutate: (s) => {
          // Somebody edited the signed snapshot after acceptance.
          s.acceptanceReceipt.proposalSnapshot.totalsMinor.total = 9999999;
        }
      })
    );
    const accepted = record.evidence.acceptedSnapshot;
    expect(accepted.availability).toBe(AVAILABILITY.CONTRADICTORY);
    expect(accepted.value).toBeUndefined();
    // Both sides are carried so the disagreement is reviewable.
    expect(accepted.conflict.quoteSnapshotSha256).toBeTruthy();
    expect(accepted.conflict.receiptSnapshotSha256).toBeTruthy();
    expect(accepted.conflict.quoteSnapshotSha256).not.toBe(
      accepted.conflict.receiptSnapshotSha256
    );
  });

  it("reports a quote total that disagrees with the signed snapshot total", () => {
    const record = exportOne(
      source({
        mutate: (s) => {
          s.quote.acceptanceReceipt = {
            ...s.quote.acceptanceReceipt,
            totalMinor: 1
          };
        }
      })
    );
    expect(record.evidence.acceptedSnapshot.availability).toBe(
      AVAILABILITY.CONTRADICTORY
    );
  });

  it("reports a fee schedule that is not expressed in whole units", () => {
    const registry = producers({
      settings: {
        processorFeeSchedule: {
          percentBasisPoints: 2.9,
          fixedCents: 30,
          declaredBy: "owner",
          declaredAtISO: "2026-07-01T00:00:00.000Z"
        }
      }
    });
    const schedule = exportOne(source(), registry).evidence.processorFeeSchedule;
    expect(schedule.availability).toBe(AVAILABILITY.CONTRADICTORY);
  });
});

describe("adversarial: schema and revision drift", () => {
  it("refuses an unknown proposal snapshot schema instead of reading it", () => {
    const record = exportOne(
      source({ mutate: (s) => { s.acceptanceReceipt.proposalSnapshot.schemaVersion = 3; } })
    );
    const accepted = record.evidence.acceptedSnapshot;
    expect(accepted.availability).toBe(AVAILABILITY.SCHEMA_DRIFT);
    expect(accepted.detail).toContain("this exporter knows 2");
    expect(accepted.value).toBeUndefined();
  });

  it("refuses an unknown payment ledger version", () => {
    const record = exportOne(
      source({ mutate: (s) => { s.quote.payment.ledger.version = 2; } })
    );
    expect(record.evidence.payments.availability).toBe(AVAILABILITY.SCHEMA_DRIFT);
  });

  it("refuses an unknown commercial snapshot version", () => {
    const record = exportOne(
      source({
        mutate: (s) => { s.quoteVersion.commercialSnapshot.version = "commercial-snapshot-v2"; }
      })
    );
    expect(record.evidence.costBasis.availability).toBe(AVAILABILITY.SCHEMA_DRIFT);
  });

  it("refuses an unknown pricing authority schema", () => {
    const record = exportOne(
      source({ mutate: (s) => { s.quote.pricingCatalogAuthority.schemaVersion = 7; } })
    );
    expect(record.evidence.authorizedQuote.availability).toBe(AVAILABILITY.SCHEMA_DRIFT);
  });
});

describe("adversarial: stale and conflicting revisions", () => {
  it("keeps the plan's source revision so a stale plan is visible downstream", () => {
    const record = exportOne(
      source({ mutate: (s) => { s.quote.workflow.quoteDelivery.revisionId = "rev_6"; } })
    );
    expect(record.evidence.operationalPlan.value.sourceRevisionId).toBe("rev_6");
    expect(record.evidence.acceptedSnapshot.value.revisionId).toBe(IDS.REVISION_ID);
  });

  it("carries a superseded catalog revision rather than the current one", () => {
    const record = exportOne(
      source({ mutate: (s) => { s.organizationSettings.catalogRevision = 20; } })
    );
    expect(record.currentCatalogRevision).toBe(20);
    expect(record.evidence.authorizedQuote.value.catalogAuthority.catalogRevision).toBe(12);
  });
});

describe("adversarial: partially written records", () => {
  it("separates a quote accepted with no receipt stub from one never accepted", () => {
    // Accepted-with-no-evidence is a broken record; never-accepted is an empty
    // one. Reporting both as "nothing to reconcile" would let the first read
    // as clean.
    const brokenlyAccepted = exportOne(
      source({
        mutate: (s) => {
          delete s.quote.acceptanceReceipt;
          s.acceptanceReceipt = null;
        }
      })
    );
    expect(brokenlyAccepted.evidence.acceptedSnapshot.availability).toBe(
      AVAILABILITY.MISSING
    );
    expect(brokenlyAccepted.evidence.acceptedSnapshot.detail).toContain(
      "no acceptance receipt stub"
    );

    const neverAccepted = exportOne(
      source({
        mutate: (s) => {
          s.quote.status = "sent";
          delete s.quote.acceptanceReceipt;
          s.acceptanceReceipt = null;
        }
      })
    );
    expect(neverAccepted.evidence.acceptedSnapshot.availability).toBe(
      AVAILABILITY.NOT_APPLICABLE
    );
  });

  it("reports a ledger whose entries array never landed", () => {
    const record = exportOne(
      source({ mutate: (s) => { s.quote.payment.ledger = { version: 1 }; } })
    );
    expect(record.evidence.payments.availability).toBe(AVAILABILITY.MISSING);
  });

  it("drops cost categories with a non-integer cost rather than rounding them", () => {
    const record = exportOne(
      source({
        mutate: (s) => {
          s.quoteVersion.commercialSnapshot.categories.labor.extendedCostCents = 2080.5;
        }
      })
    );
    const costBasis = record.evidence.costBasis.value;
    expect(costBasis.plannedCostCents.labor).toBeUndefined();
    expect(costBasis.missingCostCategories).toContain("labor");
  });

  it("reports a portal decision with an unparseable timestamp", () => {
    const record = exportOne(
      source({
        mutate: (s) => {
          s.quote.portalDecision = {
            decision: "changes_requested",
            requestId: "req_1",
            submittedAtISO: "last Tuesday",
            message: "more guests please"
          };
        }
      })
    );
    expect(record.evidence.customerRequest.availability).toBe(AVAILABILITY.MISSING);
  });
});

describe("adversarial: timezone boundaries", () => {
  it("normalizes offset timestamps to UTC so instants compare correctly", () => {
    const record = exportOne(
      source({
        mutate: (s) => {
          s.quote.portalDecision = {
            decision: "changes_requested",
            requestId: "req_1",
            submittedAtISO: "2026-08-19T12:00:00+05:00",
            message: "more guests please"
          };
        }
      })
    );
    expect(record.evidence.customerRequest.value.submittedAtISO).toBe(
      "2026-08-19T07:00:00.000Z"
    );
  });

  it("normalizes the same instant written three ways to one form", () => {
    const forms = [
      "2026-08-05T18:25:40Z",
      "2026-08-05T18:25:40.000Z",
      "2026-08-05T13:25:40-05:00"
    ];
    const normalized = forms.map((value) => {
      const record = exportOne(
        source({
          mutate: (s) => {
            s.quote.payment.ledger.entries[0].providerSettledAtISO = value;
          }
        })
      );
      return record.evidence.payments.value[0].providerSettledAtISO;
    });
    expect(new Set(normalized).size).toBe(1);
    expect(normalized[0]).toBe("2026-08-05T18:25:40.000Z");
  });

  it("keeps a date-only event date as written rather than shifting it by zone", () => {
    const record = exportOne(source());
    expect(record.eventDate).toBe("2026-10-17");
  });
});

describe("adversarial: duplicate events", () => {
  it("preserves duplicate ledger operations instead of collapsing them", () => {
    // Deduplicating here would hide exactly what the charge-integrity rule
    // exists to find.
    const record = exportOne(
      source({
        mutate: (s) => {
          const entry = s.quote.payment.ledger.entries[0];
          s.quote.payment.ledger.entries = [entry, { ...entry, operationId: "op_deposit_2" }];
        }
      })
    );
    expect(record.evidence.payments.value).toHaveLength(2);
    expect(record.evidence.payments.value.map((e) => e.providerReference)).toEqual([
      "cs_test_deposit_1042",
      "cs_test_deposit_1042"
    ]);
  });

  it("keeps two records for the same quote id distinguishable and ordered", () => {
    const bundle = exportBundle(
      [source(), { ...source(), quoteId: "quote_demo_0" }],
      { evaluatedAtISO: EVALUATED_AT, producers: producers() }
    );
    expect(bundle.records.map((record) => record.quoteId)).toEqual([
      "quote_demo_0",
      IDS.QUOTE_ID
    ]);
  });
});

describe("adversarial: producer failures", () => {
  it("turns a throwing producer into a missing envelope, not a crash", () => {
    const registry = producerRegistry([
      guarded(
        {
          section: "actualConsumption",
          producerId: "exploding-producer",
          produce() {
            throw new Error("upstream store unreachable");
          }
        },
        { missing }
      )
    ]);
    const record = exportOne(source({ eventCompleted: true }), registry);
    const consumption = record.evidence.actualConsumption;
    expect(consumption.availability).toBe(AVAILABILITY.MISSING);
    expect(consumption.detail).toContain("exploding-producer failed");
    expect(consumption.detail).toContain("upstream store unreachable");
  });

  it("reports an unregistered producer rather than assuming the section is fine", () => {
    const record = exportOne(source(), producerRegistry([]));
    for (const section of ["payouts", "processorFeeSchedule", "actualConsumption"]) {
      expect(record.evidence[section].availability, section).toBe(AVAILABILITY.MISSING);
      expect(record.evidence[section].detail, section).toContain("No producer is registered");
    }
  });

  it("rejects a duplicate producer for one section", () => {
    const build = () =>
      producerRegistry([
        { section: "payouts", producerId: "a", produce: () => null },
        { section: "payouts", producerId: "b", produce: () => null }
      ]);
    expect(build).toThrow(/Duplicate producer/);
  });
});

describe("adversarial: envelope integrity", () => {
  it("refuses an envelope that claims available with no value", () => {
    expect(() => envelope({ availability: AVAILABILITY.AVAILABLE })).toThrow(
      EvidenceContractError
    );
  });

  it("refuses an unavailable envelope that smuggles a value", () => {
    expect(() =>
      envelope({ availability: AVAILABILITY.MISSING, value: { total: 1 } })
    ).toThrow(EvidenceContractError);
  });

  it("refuses a contradictory envelope with no conflict recorded", () => {
    expect(() => envelope({ availability: AVAILABILITY.CONTRADICTORY })).toThrow(
      EvidenceContractError
    );
  });

  it("refuses an unknown availability state", () => {
    expect(() => envelope({ availability: "probably_fine" })).toThrow(
      EvidenceContractError
    );
  });
});

describe("adversarial: exporter output stability under mutation", () => {
  it("does not mutate the source documents it reads", () => {
    const built = source();
    const before = canonicalJson(built);
    exportOne(built);
    expect(canonicalJson(built)).toBe(before);
  });
});
