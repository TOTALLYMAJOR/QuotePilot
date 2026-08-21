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

/**
 * What the exporter produces today, against the producers we actually have.
 * Payouts are blocked by the Connect stopping point, no organization has
 * declared a fee schedule, and the event has not been delivered.
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
    guarded(createConsumptionProducer({ readConsumption: () => null }), { missing })
  ]);
  return exportBundle([sourceRecord()], { evaluatedAtISO: EVALUATED_AT, producers });
}
