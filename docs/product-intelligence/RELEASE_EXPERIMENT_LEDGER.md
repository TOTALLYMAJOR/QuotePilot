# Release and Experiment Ledger

Last updated: 2026-09-17 14:17:30 CDT

## LED-006 — Quote-to-Confidence local candidate

Status: `no_outcome_claim`. Owner decision: pending. Recorded: 2026-09-17 UTC.
Task 5 review corrections bind new surfaces to their own tests, preserve connected
evidence states and parent-source recovery, and add local delivered-component
journeys through Client closeout and Library/Inventory with normalized mocked
authority receipts. Category aggregates and unavailable zero-denominator rates
do not change the event schema or authorize exposure. Hosted proof remains open.
Final integration fixes preserve shelf-count receipts across account/scope
changes while stopping subsequent requests, expose reviewed empty-shortage
rebases and independent cancellation, and align both shells' recorded-cost
comparison evidence. Local regressions exercise these reliability boundaries;
the unchanged metrics, gates, and authority contracts carry no outcome claim.
The final packaging pass compile-gates or lazy-loads default-off implementation
code and leaves only role-safe integration seams in the owning shells. This is
a delivery-cost correction under the same disabled exposure and does not add a
metric, production cohort, authority change, or outcome claim.

Catering value: the owner-operator needs to finish an explainable quote, hand off
the accepted promise, resolve supply exceptions, capture shelf facts and reuse
event learning with less repeated work. The expected improvement is directional
speed and reliability, mapped to `CAP-03`, `CAP-04`, `CAP-05`, `CAP-06`,
`CAP-09`; `OUT-02`, `OUT-03`, `OUT-05`, `OUT-06`; and
`MET-19`, `MET-20`, `MET-21`. Guardrails: `GRD-01`, `GRD-02`,
`GRD-04`, `GRD-06`, `GRD-07`, `GRD-09`, `GRD-10`, `GRD-11`,
`GRD-12`, `GRD-14`, `GRD-15`, `GRD-16`.

Exposure: isolated `codex/quote-to-confidence` source candidate; all six new
build/tenant gates default off. No hosted or production cohort is active under
this entry. Disable the relevant flag to withdraw presentation; server policy
and historical records retain their own authority. Five slices changed together,
so any later before/after association is confounded unless exposure is recorded.

Measurement: `BASE-09`, 14-day baseline and comparable 14-day follow-up;
`TGT-17`, `TGT-18` remain directional proposals. Fewer than 50 eligible
observations per cohort are informational. Report missing analytics sessions,
unsupported adoption receipts, source staleness and bounded-read truncation.
Available evidence is source plus local automated validation recorded in the
Task 5 report. No observed production values, frozen baseline, human preference,
measured outcome or causal attribution exists. Required next evidence: reviewed
hosted role journeys, human acceptance and an explicitly approved real baseline.
Broader existing-surface browser failures remain separately recorded in the Task
5 report; focused automated success does not qualify a release or expand exposure.

## Purpose

This ledger links product exposure to the metrics and guardrails it could move.
It does not replace `CHANGELOG.md`, `PROJECT_STATUS.md`, Git history, deployment
receipts, UAT evidence, or provider evidence. It records the causal hypothesis,
comparison plan, observed result, uncertainty, and owner decision those sources
do not own.

## Decision vocabulary

- `planned`: hypothesis and measurement plan exist; exposure has not begun.
- `observing`: eligible exposure exists; minimum evidence has not been reached.
- `adopt`: evidence supports retaining or expanding the change.
- `revise`: direction is useful but the implementation or measurement must change.
- `stop`: guardrail breach or negative outcome requires withdrawal.
- `investigate`: evidence is contradictory, truncated, confounded, or inadequate.
- `no_outcome_claim`: implementation/release evidence exists without outcome evidence.

## Seed ledger

| Entry | Exposure | Catering-value hypothesis | Primary metrics | Guardrails | Evidence currently available | Decision |
|---|---|---|---|---|---|---|
| `LED-006` | Quote-to-Confidence isolated local candidate; flags off | Clear next actions, exact handoffs and operator-reviewed learning reduce repeated work without transferring authority. | `MET-19`, `MET-20`, `MET-21` | `GRD-01`, `GRD-04`, `GRD-07`, `GRD-09`, `GRD-16` | Local evidence only; 14-day `BASE-09` remains uncollected; fewer than 50 eligible observations are informational. | `no_outcome_claim` |
| `LED-001` | `v0.15.0` product-analytics and Ambient metric extension | Clearer next actions and authoritative priced-draft feedback reduce quote friction and issue-resolution time. | `MET-01`–`MET-05` | `GRD-09`, `GRD-10`, `GRD-16` | Source/deployment history and bounded summary logic exist; no frozen production baseline or causal comparison is recorded. | `no_outcome_claim` |
| `LED-002` | `v0.17.0` commitment-to-execution and Event Preflight foundations | Accepted work can move into operational review with fewer hidden blockers and stale consumers. | `MET-07`, `MET-11`, `MET-12` | `GRD-04`, `GRD-07`, `GRD-15` | Source/release evidence exists; operational handoff coverage and late-discovery metrics are not centrally observable. | `no_outcome_claim` |
| `LED-003` | `v0.18.0` commercial platform and Inventory Phases 2–8; `v0.18.1` Inventory transport correction | Recorded costs, recipes, exact stock/cost evidence, and governed commercial configuration improve quote explainability and operational preparation. | `MET-08`, `MET-11`, `MET-12` | `GRD-01`–`GRD-03`, `GRD-06`, `GRD-07` | Source, CI, provider deployment, synthetic tenant population, and partial authenticated read evidence exist. Physical Inventory, real cost, human workflow, and outcome evidence remain absent. | `no_outcome_claim` |
| `LED-004` | `v0.19.0` coordinated Inquiry/Model Assist and qualified production profile | Bounded inquiry capture can turn customer preferences into staff-reviewable opportunities without creating unsupported commitments. | Future inquiry-to-opportunity and correction measures; `MET-07` | `GRD-01`, `GRD-02`, `GRD-08`, `GRD-09` | Deployment/configuration evidence exists; no production slug, real inquiry conversion, notification outcome, human acceptance, or commercial outcome is recorded. | `no_outcome_claim` |
| `LED-005` | Product-intelligence compliance gate and task-planner routing | Requiring a named catering actor, job, expected improvement, governed IDs, evidence need, and release record reduces product work that ships without a testable value hypothesis. | `MET-18` | `GRD-14`, `GRD-16` | Source contract and focused local tests exist. Fresh-agent evaluation at checkout `d1b1bd8c5caa67b16b23a2a9bd4e9faa7b195434` scored Dashboard `16/16` and Mechanical control `16/16`, with no rubric failures; human acceptance remains pending. CI execution, reviewer adherence, production behavior, and outcome evidence remain unproven. | `no_outcome_claim` |
| `EXP-001` | Proposed owner-operator baseline and governed workflow comparison | QuotePilot reduces time from intent to reviewable quote and operating plan by 30% without increasing material corrections. | `MET-03`, `MET-07`, `MET-12`, `MET-16` | `GRD-03`, `GRD-04`, `GRD-07`, `GRD-16` | Protocol exists in Delivery Planning; baseline collection has not occurred. | `planned` |
| `EXP-002` | Proposed accepted-to-operational-handoff observation | Domain-specific currentness evidence exposes stale consumers early enough to reduce late operational discovery. | `MET-11`, `MET-12` | `GRD-06`, `GRD-07`, `GRD-15` | Required signal `SIG-011` is specified but not implemented. | `planned` |

Historical entries above are reconstruction aids, not retroactive experiments.
They do not assert that exposure was randomized, fully bound to users, or caused
an outcome.

## Prospective entry template

```text
Entry ID:
Status: planned | observing | adopt | revise | stop | investigate | no_outcome_claim
Owner:
Recorded at:

Catering value
- Actor:
- Job or decision:
- Expected improvement:
- Outcome and capability IDs:

Change and exposure
- Release/SHA/flag:
- Eligible tenant/role/journey:
- Exposure start/end:
- Rollback or stop mechanism:
- Concurrent material changes:

Measurement
- Primary metric and target:
- Diagnostic metrics:
- Guardrails:
- Baseline ID:
- Minimum sample/window:
- Segments and exclusions:

Result
- Evidence classes present:
- Observed values:
- Missingness/truncation/freshness:
- Competing explanations:
- Human interpretation:

Decision
- adopt | revise | stop | investigate
- Rationale:
- Canonical documents or code affected:
- Next observation:
```

## Operating rules

1. Write the hypothesis, target, guardrails, eligible cohort, and minimum sample
   before exposure whenever practical.
2. Bind every observation to a release, SHA, feature flag, tenant/role cohort,
   and time window. If exact binding is unavailable, say so.
3. Record concurrent changes and external factors; before/after correlation is
   not proof of causation.
4. Preserve unsuccessful and inconclusive experiments. Deleting them destroys
   institutional learning.
5. Do not promote a local, CI, deployment, provider, or human-acceptance result
   into commercial outcome evidence.
6. Close every observing entry with an owner decision or an explicit reason it
   remains open.
