import { createRequire } from "node:module";
// Fixture generation, shared by the JavaScript tests and the Python tests.
//
// Both reconciler fixtures are produced by the real exporter from documents
// produced by the real writer modules. Nothing is hand-authored, so a checked-in
// fixture cannot drift away from what the exporter actually emits: a JavaScript
// test asserts the exporter still produces these bytes, and the Python tests
// consume them. Change either tier and one of the two fails.

import {
  IDS,
  acceptedRecords,
  quoteVersionDocument,
  settledDepositLedger
} from "./authoritativeRecords.mjs";
import { exportBundle } from "../src/exporterCore.mjs";
import { guarded, producerRegistry } from "../src/producers/index.mjs";
import { createPayoutProducer } from "../src/producers/payoutProducer.mjs";
import { createFeeScheduleProducer } from "../src/producers/feeScheduleProducer.mjs";
import { createConsumptionProducer } from "../src/producers/consumptionProducer.mjs";
import { missing } from "../src/availability.mjs";

const require = createRequire(import.meta.url);
const phaseAuthority = require("../../functions/eventOperations.js");
const actualsAuthority = require("../../functions/eventOperatingActuals.js");

export const EVALUATED_AT = "2026-08-21T14:00:00.000Z";

/**
 * The declared schedule used by the worked example: 325 basis points plus
 * $1.20. It exists here only as an operator declaration in a fixture. Nothing
 * in the product asserts this rate, and the reconciler will not derive it.
 */
export const EXAMPLE_FEE_SCHEDULE = Object.freeze({
  percentBasisPoints: 325,
  fixedCents: 120,
  toleranceCents: 0,
  declaredBy: "organization settings",
  declaredAtISO: "2026-07-01T00:00:00.000Z",
  label: "Card present/online blended"
});

function sourceRecord({ eventCompleted = false } = {}) {
  const accepted = acceptedRecords();
  accepted.quote.payment = { ledger: settledDepositLedger() };
  return {
    quoteId: IDS.QUOTE_ID,
    quote: accepted.quote,
    acceptanceReceipt: accepted.acceptanceReceipt,
    quoteVersion: quoteVersionDocument(),
    organizationSettings: { catalogRevision: 12 },
    eventCompleted
  };
}

/** Real acceptance, phase and actuals planners create this synthetic private proof. */
export function declaredActualsFixture({ complete = true, costs = { labor: 208000, purchasing: 612000, other: 96000 } } = {}) {
  const record = sourceRecord();
  record.quote = { ...record.quote, id: IDS.QUOTE_ID, customerId: "customer-fixture", status: "booked", booking: { bookedAtISO: "2026-08-06T12:00:00.000Z" } };
  record.quoteVersion = { ...record.quoteVersion, organizationId: IDS.ORGANIZATION_ID, quoteId: IDS.QUOTE_ID, customerId: "customer-fixture", snapshot: { id: IDS.QUOTE_ID, organizationId: IDS.ORGANIZATION_ID, customerId: "customer-fixture", event: { ...record.quote.event } } };
  const refs = { organizationId: IDS.ORGANIZATION_ID, quoteId: IDS.QUOTE_ID, sourceVersionId: IDS.REVISION_ID, acceptanceReceiptId: IDS.RECEIPT_ID };
  const actor = { organizationId: refs.organizationId, uid: "actuals-fixture-operator", role: "admin" };
  const phase = phaseAuthority.planCommand({ source: refs, actor, nowISO: "2026-08-20T12:00:00.000Z", request: { ...refs, requestId: "fixture-actuals-phase-0001", command: "initialize", expectedLedgerRevision: 0, targetPhase: "prepared" } });
  let last = null;
  const receipts = [];
  function apply(command) {
    const revision = last?.nextActualsState.revision || 0;
    last = actualsAuthority.planCommand({ source: refs, actor, phaseSnapshot: phase.snapshot,
      actualsState: last?.nextActualsState, currentReceipt: last?.receipt,
      nowISO: `2026-08-20T12:00:${String(revision + 1).padStart(2, "0")}.000Z`,
      request: { ...refs, requestId: `fixture-actuals-command-${String(revision).padStart(4, "0")}`, actualsPolicyVersion: 1, expectedActualsRevision: revision, ...command } });
    receipts.push(last.receipt);
  }
  for (const category of ["labor", "purchasing", "other"]) {
    apply({ command: "record", category, description: `Private ${category} cost note`, costCents: costs[category], ...(category === "labor" ? { durationMinutes: 480, laborRole: "lead" } : {}) });
  }
  if (complete) for (const category of ["labor", "purchasing", "other"]) {
    apply({ command: "declare_category", category, state: "complete", note: `Private ${category} completeness declaration` });
  }
  const declarationReceipts = Object.fromEntries(receipts.filter((receipt) => receipt.request.command === "declare_category").map((receipt) => [receipt.receiptId, receipt]));
  const proof = { ...refs, sourceQuote: record.quote, sourceVersion: record.quoteVersion,
    acceptanceReceiptDocument: record.acceptanceReceipt, phaseLedger: phase.nextLedger, phaseReceipt: phase.receipt,
    actualsState: last.nextActualsState, actualsReceipt: last.receipt, declarationReceipts, observedPhaseReceipts: {} };
  record.actualsProof = proof;
  return { record, proof, receipts, actor, phase };
}

/**
 * What the exporter produces today, against the producers we actually have.
 * Payouts are blocked by the Connect stopping point, no organization has
 * declared a fee schedule, and no complete actuals declaration is available.
 */
export function currentStateBundle() {
  const producers = producerRegistry([
    guarded(createPayoutProducer(), { missing }),
    guarded(createFeeScheduleProducer({ readOrganizationSettings: () => null }), { missing }),
    guarded(createConsumptionProducer({ readConsumption: () => null }), { missing })
  ]);
  return exportBundle([sourceRecord()], { evaluatedAtISO: EVALUATED_AT, producers });
}

/**
 * The documented worked example.
 *
 * It supplies an explicitly authorized settlement source and a declared fee
 * schedule, so it represents the state *after* the payout integration and the
 * fee-schedule policy land. It is a fixture, not a bypass: the default
 * producer in `currentStateBundle` remains inert, and production code passes
 * no settlement source.
 */
export function workedExampleBundle() {
  const producers = producerRegistry([
    guarded(
      createPayoutProducer({
        settlementSource: {
          authorized: true,
          sourceObject: "fixture://authorized-settlement-source",
          settlementsFor: () => [
            {
              providerReference: "cs_test_deposit_1042",
              grossCents: 480000,
              netCents: 464280,
              settledAtISO: "2026-08-07T09:00:00.000Z",
              payoutReference: "po_1042"
            }
          ]
        }
      }),
      { missing }
    ),
    guarded(
      createFeeScheduleProducer({
        readOrganizationSettings: () => ({ processorFeeSchedule: EXAMPLE_FEE_SCHEDULE })
      }),
      { missing }
    ),
    guarded(createConsumptionProducer(), { missing })
  ]);
  return exportBundle([declaredActualsFixture().record], { evaluatedAtISO: EVALUATED_AT, producers });
}
