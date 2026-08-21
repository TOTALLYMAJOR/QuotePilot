# Commercial Truth Loop: Design

Last updated: 2026-08-21 13:10:00 CDT

Architecture decision and authority boundary: `docs/COMMERCIAL_TRUTH_LOOP_ADR.md`.
Implementation: `truthloop/`.

## The chain

The loop reconciles one event's commercial record end to end:

```
customer request
  → authorized quote
  → accepted quote snapshot
  → deposit obligation
  → payment receipt
  → processor payout
  → operational consumption
  → actual contribution
```

Each link is a `ChainLink` value on every finding, so a report can be read in
the order value actually moves rather than in rule-definition order.

## Evidence supply chain

```
authoritative source → producer/exporter → canonical evidence bundle → reconciler → verdict + reason
```

| Stage | Owner | Guarantee |
|---|---|---|
| Authoritative source | existing TypeScript services | Firestore documents written by `proposalAcceptance.js`, `paymentLedger.js`, `pricingEngine.js`, and the quote/version writers |
| Producer / exporter | `evidence/`, `scripts/reconciliation-evidence-export.mjs` | Read-only projection; provenance on every section; availability classified, never collapsed to null; unknown schemas refused |
| Canonical bundle | `truthloop-evidence-bundle-v2` | Deterministic: sorted keys, sorted records, caller-supplied instant, `recordsDigestSha256` over the canonical records |
| Reconciler | `truthloop/` | Gates on availability before assessing; unverifiable verdicts carry a machine-readable reason code |
| Verdict + reason | `truthloop-reconciliation-v1` | `explained` / `discrepancy` / `unverifiable`, with `reasonCode`, `blockedSection`, and `blockedBy` |

`docs/truthloop-evidence-contract.json` is the single shared definition. The
exporter classifies availability and computes coverage from it; the reconciler
proves its rule registry matches it. A rule changed on one side without the
other fails `test_evidence_contract.py`.

### Availability states

| State | Meaning | Lets a rule reach a verdict |
|---|---|---|
| `available` | Exported with provenance | Yes |
| `not_applicable` | Cannot apply at this lifecycle stage — nothing to check | Yes (a pass) |
| `missing` | Should exist for this stage and does not | No |
| `not_yet_available` | The record has not reached the stage that produces it | No |
| `blocked_by_integration` | A named integration gate prevents production | No |
| `contradictory` | Two authoritative sources disagree; both values carried | No |
| `schema_drift` | The source declares a schema this exporter does not know | No |

`not_applicable` and `missing` are the load-bearing pair. Consumption before an
event has not happened is a pass; consumption after a delivered event is a
blocked record. Collapsing both to null would make the two indistinguishable.

### Reason codes

Every unverifiable finding carries `reasonCode`, `blockedSection`, and, for
integration blocks, `blockedBy`, so a future operator surface can group and
route blocked records without parsing prose: `evidence_missing`,
`evidence_not_yet_available`, `evidence_blocked_by_integration`,
`evidence_contradictory`, `evidence_schema_drift`, `evidence_incomplete`.

### Provenance

Each section stamps `exporterVersion`, `sourceObject`, `sourceField`,
`revision`, `sourceSchemaVersion`, and `observedAtISO`, plus per-field
overrides where a value came from a different document than the section
default. Two examples that matter:

* The signed snapshot lives on the acceptance receipt while the quote holds
  only a digest, so the exporter verifies the digest and reports disagreement
  as `contradictory` rather than picking a winner.
* Staffing counts are not carried on the signed snapshot, so they are read from
  the quote and stamped with that derivation rather than claiming to be part of
  the signed promise.

### Producers

| Section | Producer | Today |
|---|---|---|
| `payouts` | `payoutProducer.mjs` | `blocked_by_integration` (`stripe_connect_stopping_point`). It refuses any settlement source that does not declare itself authorized, so it cannot emit provider evidence by accident. |
| `processorFeeSchedule` | `feeScheduleProducer.mjs` | `missing`, constraint `business_policy`. Reads an operator declaration with actor and timestamp; never derives a rate from observed payouts. |
| `actualConsumption` | `consumptionProducer.mjs` | `not_applicable` before delivery, `missing` (constraint `engineering`) after. |

A producer that throws becomes a `missing` envelope naming the failed producer.
A producer failure is a data-supply fact, not a crash, and the record stays
unverifiable.

## Rule catalog

`npm run truthloop:rules` prints this catalog as JSON.

| Rule | Chain link | Detects |
|---|---|---|
| `accepted_record_stale_vs_request` | customer request | A customer change request that postdates, or contradicts, the accepted snapshot |
| `stale_catalog_revision` | authorized quote | A quote priced on a superseded or unconfirmed catalog revision |
| `payment_amount_mismatch` | payment receipt | A recorded payment whose amount is not the accepted obligation |
| `missing_or_duplicate_charge` | payment receipt | A missing settled charge, a duplicate settled charge, or a reused provider reference |
| `processor_fee_discrepancy` | processor payout | A charge-to-payout gap the declared fee schedule does not account for |
| `expected_revenue_not_received` | processor payout | Accepted revenue with no settled receipt after delivery |
| `promise_absent_from_plan` | operational consumption | Accepted menu, add-ons, rentals, guests, or staffing missing from the operational plan |
| `operational_overrun` | operational consumption | Labor or purchasing beyond the planned cost basis and declared tolerance |
| `provisional_cost_basis` | actual contribution | Contribution resting on provisional or missing cost evidence |
| `margin_category_omission` | actual contribution | Revenue categories carrying money but excluded from the margin model |
| `estimated_versus_realized_contribution` | actual contribution | The gap between projected and realized contribution |

Every rule runs against every record. Coverage is a property of the registry in
`truthloop/src/quotepilot_truthloop/rules/__init__.py`, not of per-record
branching, so a record can never quietly skip a rule.

## Finding status

| Status | Meaning | Counts as reconciled |
|---|---|---|
| `explained` | The rule reached a verdict and the chain agrees | Yes |
| `discrepancy` | The rule reached a verdict and the chain disagrees | No |
| `unverifiable` | The rule could not reach a verdict; required evidence is absent | **No** |

`unverifiable` is the load-bearing case. A record missing its payout evidence is
not a clean record, and the metric must not say it is. Each `unverifiable`
finding names the exact evidence node that would close it.

`fullyReconciled` is true only when a record produced findings and none of them
are `discrepancy` or `unverifiable`.

## Evidence status

Every finding cites its inputs with a strength, so a reader can tell what kind
of thing each number is:

| Status | Meaning |
|---|---|
| `verified` | Established by a trusted QuotePilot authority or a provider record |
| `recorded` | Written by staff through a trusted path |
| `declared` | Asserted by the organization as policy input (fee schedules, tolerances) |
| `interpreted` | Derived, provisional, or inferred |
| `absent` | Not present in the bundle |

A processor fee schedule is `declared`, never `verified`. QuotePilot does not
confirm a rate on a processor's behalf.

## Worked example

Given a $4,800.00 accepted deposit, a $4,800.00 recorded payment, a $4,642.80
payout, and a declared schedule of 325 basis points plus $1.20:

```
processor_fee_discrepancy → explained
  The accepted quote requires a $4,800.00 deposit. QuotePilot recorded a
  $4,800.00 payment, but the processor payout was $4,642.80. The $157.20
  difference matches the expected processing fee.

margin_category_omission → discrepancy
  The margin basis is $20,360.00, but $450.00 of accepted revenue sits outside
  it: travel ($450.00; delivery and travel revenue is outside the current
  margin model).
```

The payout is explained and the record still is not reconciled, because a
separate rule found a real gap. That separation is the point: one answered
question does not close an event.

Reproduce it with:

```bash
npm run truthloop:reconcile truthloop/fixtures/example-bundle.json
```

Remove the declared schedule and the same payout becomes a `$157.20`
discrepancy. The reconciler will not back-solve the rate.

## Money

All money is non-negative integer cents, matching `totalsMinor` in
`functions/proposalAcceptance.js` and `amountCents` in
`functions/paymentLedger.js`. The loader **rejects** a float rather than
rounding it: an upstream float means precision was already lost, and rounding
here would manufacture confidence. Percentage fees use integer basis points
with half-up rounding, so results are identical on every platform.

## Evidence bundle

Input contract: `truthloop-evidence-bundle-v1`.

```json
{
  "bundleVersion": "truthloop-evidence-bundle-v1",
  "evaluatedAtISO": "2026-08-21T14:00:00.000Z",
  "records": [
    {
      "organizationId": "org_demo",
      "quoteId": "quote_demo_1",
      "quoteNumber": "QP-1042",
      "currentCatalogRevision": 12,
      "eventCompleted": false,
      "authorizedQuote": { "catalogAuthority": { "catalogRevision": 12, "confirmedCatalogRevision": 12 } },
      "acceptedSnapshot": { "revisionId": "rev_7", "acceptedAtISO": "...", "totalsMinor": {}, "selection": {}, "staffing": {} },
      "payments": [],
      "payouts": [],
      "processorFeeSchedule": {},
      "operationalPlan": {},
      "costBasis": {},
      "actualConsumption": {}
    }
  ]
}
```

`truthloop/fixtures/example-bundle.json` is the complete worked example.

Two loader behaviours matter:

- **A malformed field rejects its record, not the run.** Rejections are carried
  into the report and counted against the reconciliation rate, so one bad record
  can neither hide the good ones nor inflate the metric.
- **Absent sections stay absent.** A missing `costBasis` produces
  `present = false`, not a zero. A default is indistinguishable from evidence
  once it reaches a rule.

`evaluatedAtISO` and `eventCompleted` are supplied by the caller rather than
read from a clock, which is what makes a run reproducible.

## Success metrics

The report's `metrics` block carries them directly:

| Metric | Field |
|---|---|
| Percentage of commercial records fully reconciled | `fullyReconciledBasisPoints` |
| Unexplained financial discrepancies | `openDiscrepancies`, `unexplainedAmountCents` |
| Records blocked on missing evidence | `unverifiableFindings` |
| Records that could not be parsed | `recordsRejected` |
| Difference between estimated and realized contribution | `contributionVarianceCents` per record |
| Quotes with complete cost evidence | absence of `provisional_cost_basis` findings |

Time-to-explain and revenue leakage discovered are operator outcomes measured
against these outputs; the loop supplies the evidence, not the measurement.

## Commands

```bash
npm run test:truthloop                                          # unit tests (runs in lane:core)
npm run truthloop:rules                                         # rule catalog as JSON
npm run truthloop:reconcile truthloop/fixtures/example-bundle.json
npm run truthloop:reconcile -- --format json --out report.json truthloop/fixtures/example-bundle.json
bash scripts/run-truthloop.sh lint                              # optional ruff pass
```

Exit codes: `0` fully reconciled, `1` findings present, `2` bundle unreadable.

## Not yet built

The exporter has **no Firestore reader**. It projects already-read documents, so
a caller must assemble them. Building that tenant-scoped, role-checked read is
the next capability, tracked in `DEV_TASKS.md`. Until it ships, the loop runs on
exporter-generated fixtures and its evidence is local test evidence only.

Three evidence sections have no producer, and the coverage report names each
blocker by class:

| Section | Constraint | Why |
|---|---|---|
| `payouts` | `integration` | No settlement store exists; the Connect program stops after hosted Sandbox UAT |
| `processorFeeSchedule` | `business_policy` | The settings field does not exist and no organization has declared a schedule |
| `actualConsumption` | `engineering` | No post-event labor or purchasing capture surface or schema exists |

Because every rule must reach a verdict for a record to be `fullyReconciled`,
and `processor_fee_discrepancy` requires both blocked payout evidence and an
undeclared fee schedule, **no record can reach `fullyReconciled` today**. The
coverage report states this rather than leaving it to be inferred from a low
percentage.
