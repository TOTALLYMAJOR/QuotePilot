// Contract tests for the Commercial Truth Loop evidence exporter.
//
// These are deliberately fixture-independent: the source documents are built
// by the real writer modules (functions/proposalAcceptance.js,
// functions/paymentLedger.js), so the tests prove the exporter reads what
// QuotePilot actually writes rather than what the exporter author believed it
// writes. If an authoritative shape changes, these fail.

import { describe, expect, it } from "vitest";
import fs from "node:fs";
import path from "node:path";

import {
  IDS,
  acceptedRecords,
  quoteVersionDocument,
  sentQuoteDocument,
  settledDepositLedger
} from "../../../evidence/testing/authoritativeRecords.mjs";
import {
  EVALUATED_AT,
  currentStateBundle,
  workedExampleBundle
} from "../../../evidence/testing/buildFixtures.mjs";
import { exportBundle, exportRecord } from "../../../evidence/src/exporterCore.mjs";
import { canonicalJson, digestSha256 } from "../../../evidence/src/canonical.mjs";
import { coverageReport, structuralCoverage, observedCoverage, renderCoverageText } from "../../../evidence/src/coverage.mjs";
import { guarded, producerRegistry } from "../../../evidence/src/producers/index.mjs";
import { createPayoutProducer } from "../../../evidence/src/producers/payoutProducer.mjs";
import { createFeeScheduleProducer } from "../../../evidence/src/producers/feeScheduleProducer.mjs";
import { createConsumptionProducer } from "../../../evidence/src/producers/consumptionProducer.mjs";
import { AVAILABILITY, missing } from "../../../evidence/src/availability.mjs";

const REPO_ROOT = path.resolve(__dirname, "..", "..", "..");

function defaultProducers({ settlementSource = null, settings = null, consumption = null } = {}) {
  return producerRegistry([
    guarded(createPayoutProducer({ settlementSource }), { missing }),
    guarded(
      createFeeScheduleProducer({ readOrganizationSettings: () => settings }),
      { missing }
    ),
    guarded(
      createConsumptionProducer({ readConsumption: () => consumption }),
      { missing }
    )
  ]);
}

function sourceFor({ eventCompleted = false, quote = null } = {}) {
  const accepted = acceptedRecords();
  accepted.quote.payment = { ledger: settledDepositLedger() };
  return {
    quoteId: IDS.QUOTE_ID,
    quote: quote || accepted.quote,
    acceptanceReceipt: accepted.acceptanceReceipt,
    quoteVersion: quoteVersionDocument(),
    organizationSettings: { catalogRevision: 12 },
    eventCompleted
  };
}

function exportOne(source, producers = defaultProducers()) {
  return exportRecord(source, { evaluatedAtISO: EVALUATED_AT, producers });
}

describe("evidence exporter: authoritative projection", () => {
  it("reads the accepted snapshot the real acceptance planner writes", () => {
    const record = exportOne(sourceFor());
    const accepted = record.evidence.acceptedSnapshot;

    expect(accepted.availability).toBe(AVAILABILITY.AVAILABLE);
    // 22592.00 dollars from the writer module, carried as minor units.
    expect(accepted.value.totalsMinor.total).toBe(2259200);
    expect(accepted.value.totalsMinor.deposit).toBe(480000);
    expect(accepted.value.revisionId).toBe(IDS.REVISION_ID);
  });

  it("reads the ledger entries the real payment planner writes", () => {
    const record = exportOne(sourceFor());
    const payments = record.evidence.payments;

    expect(payments.availability).toBe(AVAILABILITY.AVAILABLE);
    expect(payments.value).toHaveLength(1);
    expect(payments.value[0]).toMatchObject({
      paymentKind: "deposit",
      amountCents: 480000,
      state: "paid",
      providerReference: "cs_test_deposit_1042"
    });
  });

  it("projects the operational plan from the accepted selection", () => {
    const plan = exportOne(sourceFor()).evidence.operationalPlan;
    expect(plan.availability).toBe(AVAILABILITY.AVAILABLE);
    expect(plan.value.selections.rentals).toEqual(["Farm Tables", "Gold Flatware"]);
    expect(plan.value.staffing).toEqual({ servers: 6, chefs: 2, bartenders: 1 });
  });

  it("carries provenance on every section, including sections with no value", () => {
    const record = exportOne(sourceFor());
    for (const [section, envelope] of Object.entries(record.evidence)) {
      expect(envelope.provenance, section).toBeDefined();
      expect(envelope.provenance.exporterVersion, section).toBe(
        "commercial-evidence-exporter-v1"
      );
    }
    // Knowing which source we looked at and came up empty is itself evidence.
    expect(record.evidence.payouts.value).toBeUndefined();
    expect(record.evidence.payouts.provenance.exporterVersion).toBeTruthy();
  });

  it("records field-level provenance where a value came from another document", () => {
    const accepted = exportOne(sourceFor()).evidence.acceptedSnapshot;
    // The collection is proposalAcceptanceReceipts, matching
    // PROPOSAL_ACCEPTANCE_RECEIPTS_COLLECTION in functions/index.js.
    expect(accepted.provenance.sourceObject).toContain("proposalAcceptanceReceipts/");
    // Staffing is not on the signed snapshot, so it must not claim to be.
    expect(accepted.provenance.fields.staffing.sourceObject).toContain("/quotes/");
    expect(accepted.provenance.fields.staffing.derivation).toContain(
      "not carried on the signed snapshot"
    );
  });
});

describe("evidence exporter: determinism", () => {
  it("produces byte-identical output for the same source state", () => {
    const first = exportBundle([sourceFor()], {
      evaluatedAtISO: EVALUATED_AT,
      producers: defaultProducers()
    });
    const second = exportBundle([sourceFor()], {
      evaluatedAtISO: EVALUATED_AT,
      producers: defaultProducers()
    });
    expect(canonicalJson(first)).toBe(canonicalJson(second));
    expect(first.exporter.recordsDigestSha256).toBe(second.exporter.recordsDigestSha256);
  });

  it("sorts records so read order cannot change the output", () => {
    const a = { ...sourceFor(), quoteId: "quote_a" };
    const b = { ...sourceFor(), quoteId: "quote_b" };
    const forward = exportBundle([a, b], {
      evaluatedAtISO: EVALUATED_AT,
      producers: defaultProducers()
    });
    const reverse = exportBundle([b, a], {
      evaluatedAtISO: EVALUATED_AT,
      producers: defaultProducers()
    });
    expect(canonicalJson(forward)).toBe(canonicalJson(reverse));
  });

  it("refuses to read the evaluation instant from a clock", () => {
    expect(() =>
      exportBundle([sourceFor()], { producers: defaultProducers() })
    ).toThrow(/evaluatedAtISO/);
  });

  it("changes the digest when the source state changes", () => {
    const base = exportBundle([sourceFor()], {
      evaluatedAtISO: EVALUATED_AT,
      producers: defaultProducers()
    });
    const changed = exportBundle([sourceFor({ eventCompleted: true })], {
      evaluatedAtISO: EVALUATED_AT,
      producers: defaultProducers()
    });
    expect(changed.exporter.recordsDigestSha256).not.toBe(
      base.exporter.recordsDigestSha256
    );
  });

  it("digests only the records, so the digest is stable across exporter metadata", () => {
    const bundle = exportBundle([sourceFor()], {
      evaluatedAtISO: EVALUATED_AT,
      producers: defaultProducers()
    });
    expect(bundle.exporter.recordsDigestSha256).toBe(digestSha256(bundle.records));
  });
});

describe("evidence exporter: booked acceptance continuity", () => {
  it("verifies booked receipts and retains missing or contradictory acceptance evidence", () => {
    const booked = sourceFor();
    booked.quote.status = "booked";
    expect(exportOne(booked).evidence.acceptedSnapshot.availability).toBe(AVAILABILITY.AVAILABLE);
    expect(exportOne({ ...booked, acceptanceReceipt: null }).evidence.acceptedSnapshot.availability).toBe(AVAILABILITY.MISSING);
    const tampered = structuredClone(booked);
    tampered.acceptanceReceipt.proposalSnapshot.totalsMinor.total += 1;
    expect(exportOne(tampered).evidence.acceptedSnapshot.availability).toBe(AVAILABILITY.CONTRADICTORY);
  });
});

describe("evidence exporter: producer coverage", () => {
  it("keeps the payout producer inert behind the Connect stopping point", () => {
    const payouts = exportOne(sourceFor()).evidence.payouts;
    expect(payouts.availability).toBe(AVAILABILITY.BLOCKED_BY_INTEGRATION);
    expect(payouts.blockedBy).toBe("stripe_connect_stopping_point");
    expect(payouts.constraintClass).toBe("integration");
    expect(payouts.value).toBeUndefined();
  });

  it("refuses a settlement source that is not explicitly authorized", () => {
    const producers = defaultProducers({
      settlementSource: { sourceObject: "some/store", settlementsFor: () => [{}] }
    });
    const payouts = exportOne(sourceFor(), producers).evidence.payouts;
    expect(payouts.availability).toBe(AVAILABILITY.BLOCKED_BY_INTEGRATION);
    expect(payouts.detail).toContain("without explicit authorization");
  });

  it("reports an undeclared fee schedule as a business-policy gap", () => {
    const schedule = exportOne(sourceFor()).evidence.processorFeeSchedule;
    expect(schedule.availability).toBe(AVAILABILITY.MISSING);
    expect(schedule.constraintClass).toBe("business_policy");
    expect(schedule.detail).toContain("will not infer a rate");
  });

  it("refuses a fee schedule with no declaring actor or timestamp", () => {
    const producers = defaultProducers({
      settings: { processorFeeSchedule: { percentBasisPoints: 290, fixedCents: 30 } }
    });
    const schedule = exportOne(sourceFor(), producers).evidence.processorFeeSchedule;
    expect(schedule.availability).toBe(AVAILABILITY.MISSING);
    expect(schedule.detail).toContain("not an operator declaration");
  });

  it("accepts a fully declared fee schedule", () => {
    const producers = defaultProducers({
      settings: {
        processorFeeSchedule: {
          percentBasisPoints: 325,
          fixedCents: 120,
          declaredBy: "owner",
          declaredAtISO: "2026-07-01T00:00:00.000Z"
        }
      }
    });
    const schedule = exportOne(sourceFor(), producers).evidence.processorFeeSchedule;
    expect(schedule.availability).toBe(AVAILABILITY.AVAILABLE);
    expect(schedule.value.percentBasisPoints).toBe(325);
  });

  it("does not infer actual costs from an elapsed event date", () => {
    const beforeEvent = exportOne(sourceFor()).evidence.actualConsumption;
    expect(beforeEvent.availability).toBe(AVAILABILITY.NOT_YET_AVAILABLE);

    const afterEvent = exportOne(sourceFor({ eventCompleted: true }))
      .evidence.actualConsumption;
    expect(afterEvent.availability).toBe(AVAILABILITY.NOT_YET_AVAILABLE);
    expect(afterEvent.constraintClass).toBe("business_policy");
  });
});

describe("evidence exporter: coverage report", () => {
  it("reports structural evidence producibility separately from rule verdicts", () => {
    const structural = structuralCoverage();
    expect(structural.rulesTotal).toBe(11);
    expect(structural.rulesReachable).toBe(10);
    expect(structural.fullyReconcilableToday).toBe(false);
    expect(structural.constraintSummary.integration.blockedSections).toEqual(["payouts"]);
    expect(structural.constraintSummary.business_policy.blockedSections).toEqual([
      "processorFeeSchedule"
    ]);
    expect(structural.constraintSummary.engineering).toBeUndefined();
  });

  it("keeps overrun blocked without explicit bounded comparison policy including zero declarations", () => {
    const bundle = workedExampleBundle();
    const check = () => observedCoverage(bundle).rules.find((rule) => rule.ruleId === "operational_overrun");
    expect(check().recordsWithCompleteEvidence).toBe(0);
    const complete = { laborBasisPoints: 0, purchasingBasisPoints: 0, minimumCents: 0, declaredBy: "fixture operator", declaredAtISO: EVALUATED_AT };
    bundle.records[0].overrunThresholds = complete;
    expect(check().recordsWithCompleteEvidence).toBe(0);
    bundle.records[0].overrunPolicyEvidence = { ...bundle.records[0].overrunPolicyEvidence, availability: "available", value: complete };
    expect(check().recordsWithCompleteEvidence).toBe(1);
    bundle.records[0].overrunPolicyEvidence.value = { ...complete, minimumCents: 1 };
    expect(check().recordsWithCompleteEvidence).toBe(0);
    delete bundle.records[0].overrunPolicyEvidence;
    expect(check().recordsWithCompleteEvidence).toBe(1);
    for (const [key, value] of [["laborBasisPoints", null], ["purchasingBasisPoints", false], ["minimumCents", -1], ["declaredBy", ""], ["declaredAtISO", "yesterday"], ["laborBasisPoints", 10_001]]) {
      bundle.records[0].overrunThresholds = { ...complete, [key]: value };
      expect(check().recordsWithCompleteEvidence).toBe(0);
    }
    bundle.records[0].overrunThresholds = { ...complete };
    delete bundle.records[0].overrunThresholds.minimumCents;
    expect(check().recordsWithCompleteEvidence).toBe(0);
    const text = renderCoverageText(coverageReport(bundle));
    expect(text).toContain("10/11 rules have producible evidence and policy inputs");
    expect(text).toContain("not a verdict count");
  });

  it("reports observed coverage per rule from a real bundle", () => {
    const report = coverageReport(currentStateBundle());
    const fee = report.observed.rules.find(
      (rule) => rule.ruleId === "processor_fee_discrepancy"
    );
    expect(fee.recordsEvaluated).toBe(1);
    expect(fee.recordsWithCompleteEvidence).toBe(0);
    expect(fee.availabilityTally.blocked_by_integration).toBe(1);

    const promises = report.observed.rules.find(
      (rule) => rule.ruleId === "promise_absent_from_plan"
    );
    expect(promises.recordsWithCompleteEvidence).toBe(1);
  });
});

describe("evidence exporter: cross-tier fixture binding", () => {
  // The reconciler's Python tests consume these files. Regenerating them here
  // means neither tier can drift from the other without a test failing.
  it("still produces the checked-in worked-example bundle", () => {
    const onDisk = fs.readFileSync(
      path.join(REPO_ROOT, "truthloop", "fixtures", "example-bundle.json"),
      "utf8"
    );
    expect(`${canonicalJson(workedExampleBundle())}\n`).toBe(onDisk);
  });

  it("still produces the checked-in current-state bundle", () => {
    const onDisk = fs.readFileSync(
      path.join(REPO_ROOT, "truthloop", "fixtures", "current-state-bundle.json"),
      "utf8"
    );
    expect(`${canonicalJson(currentStateBundle())}\n`).toBe(onDisk);
  });

  it("declares the bundle version the reconciler loads", () => {
    expect(currentStateBundle().bundleVersion).toBe("truthloop-evidence-bundle-v2");
  });
});

describe("evidence exporter: pre-acceptance records", () => {
  it("treats an unaccepted quote as having no commercial chain to reconcile", () => {
    const record = exportOne({
      quoteId: IDS.QUOTE_ID,
      quote: sentQuoteDocument(),
      quoteVersion: quoteVersionDocument(),
      organizationSettings: { catalogRevision: 12 },
      eventCompleted: false
    });
    expect(record.evidence.acceptedSnapshot.availability).toBe(
      AVAILABILITY.NOT_APPLICABLE
    );
    expect(record.evidence.payments.availability).toBe(AVAILABILITY.NOT_APPLICABLE);
    expect(record.evidence.operationalPlan.availability).toBe(
      AVAILABILITY.NOT_APPLICABLE
    );
    // The catalog revision still applies: reprice before sending.
    expect(record.evidence.authorizedQuote.availability).toBe(AVAILABILITY.AVAILABLE);
  });
});
