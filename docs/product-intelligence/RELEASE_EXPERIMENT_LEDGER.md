# Release and Experiment Ledger

Last updated: 2026-09-24 22:00:00 CDT

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
| `LED-001` | `v0.15.0` product-analytics and Ambient metric extension | Clearer next actions and authoritative priced-draft feedback reduce quote friction and issue-resolution time. | `MET-01`–`MET-05` | `GRD-09`, `GRD-10`, `GRD-16` | Source/deployment history and bounded summary logic exist; no frozen production baseline or causal comparison is recorded. | `no_outcome_claim` |
| `LED-002` | `v0.17.0` commitment-to-execution and Event Preflight foundations | Accepted work can move into operational review with fewer hidden blockers and stale consumers. | `MET-07`, `MET-11`, `MET-12` | `GRD-04`, `GRD-07`, `GRD-15` | Source/release evidence exists; operational handoff coverage and late-discovery metrics are not centrally observable. | `no_outcome_claim` |
| `LED-003` | `v0.18.0` commercial platform and Inventory Phases 2–8; `v0.18.1` Inventory transport correction | Recorded costs, recipes, exact stock/cost evidence, and governed commercial configuration improve quote explainability and operational preparation. | `MET-08`, `MET-11`, `MET-12` | `GRD-01`–`GRD-03`, `GRD-06`, `GRD-07` | Source, CI, provider deployment, synthetic tenant population, and partial authenticated read evidence exist. Physical Inventory, real cost, human workflow, and outcome evidence remain absent. | `no_outcome_claim` |
| `LED-004` | `v0.19.0` coordinated Inquiry/Model Assist and qualified production profile, plus disposable Guided Inquiry emulator acceptance | Bounded inquiry capture can turn customer preferences into staff-reviewable opportunities without creating unsupported commitments. | Future inquiry-to-opportunity and correction measures; `MET-07` | `GRD-01`, `GRD-02`, `GRD-08`, `GRD-09` | Deployment/configuration evidence exists. Five disposable Firebase-emulator browser tests cover cross-tenant denial, exact active-publication behavior, idempotent recovery, tenant/IP quotas without inquiry authority artifacts, stale conversion rejection, and atomic duplicate-safe conversion. No production slug, hosted Turnstile result, provider notification outcome, accessibility, human acceptance, or commercial outcome is recorded. | `no_outcome_claim` |
| `LED-005` | Product-intelligence compliance gate and task-planner routing | Requiring a named catering actor, job, expected improvement, governed IDs, evidence need, and release record reduces product work that ships without a testable value hypothesis. | `MET-18` | `GRD-14`, `GRD-16` | Source contract and focused local tests exist. Fresh-agent evaluation at checkout `d1b1bd8c5caa67b16b23a2a9bd4e9faa7b195434` scored Dashboard `16/16` and Mechanical control `16/16`, with no rubric failures; human acceptance remains pending. CI execution, reviewer adherence, production behavior, and outcome evidence remain unproven. | `no_outcome_claim` |
| `LED-006` | Staff login recovery-first refinement | One dominant sign-in action, explicit registration context, and visible password-reset recovery reduce dead-end access attempts before catering staff reach quote and event work. | `MET-04` as the closest diagnostic; AuthGate is not currently instrumented | `GRD-01`, `GRD-02`, `GRD-11`, `GRD-12`, `GRD-15` | Source and focused component evidence exist. Responsive browser review, hosted authentication, production access telemetry, assistive-technology use, human acceptance, and outcome evidence remain absent. | `no_outcome_claim` |
| `LED-007` | Journey and functional requirement verification ledgers | Requiring work to name affected journey stages, functional capabilities, and separate proof classes makes the next catering-value proof explicit without turning documentation completion into product success. | `MET-18` | `GRD-14`, `GRD-16` | Source mappings and evidence-qualified checklists exist. Structural validation, repeated task use, human acceptance, and outcome evidence are evaluated separately. | `no_outcome_claim` |
| `LED-008` | Versioned layered evaluation manifest and immutable local receipt runner | Separate release-blocking authority, AI-grounding, journey, recovery, and telemetry evaluations make unsafe or unproven dimensions visible without allowing one strong area to hide another. | `MET-17`, `MET-18` | `GRD-01`–`GRD-16` | Source contract, focused runner tests, dry-run validation, and dirty-worktree local receipts pass `EVAL-001`, `EVAL-002`, `EVAL-003`, `EVAL-004`, and `EVAL-006`. CI, hosted, provider, production, operator-task, assistive-technology, human, and outcome evidence remain open. | `no_outcome_claim` |
| `LED-009` | Actor-journey initiative delivery packets | Binding open initiatives to named actors, `JRN-*` stages, `CAP-*` requirements, dependencies, acceptance criteria, and evidence classes should reduce out-of-order delivery and false completion claims. | `MET-17`, `MET-18` | `GRD-01`–`GRD-16` | Canonical backlog packets and journey bindings exist in source. No packet has been completed by this documentation change; execution adherence, owner acceptance, human evidence, and outcomes remain unproven. Stripe Connect is deferred outside the active dependency graph. | `no_outcome_claim` |
| `LED-010` | `QPI-02` starter-catalog to first authoritative quote repair | Letting an administrator immediately review the exact staged catalog, then publishing pricing only through the governed authority, should reduce setup dead ends and unsupported pricing confirmation before the first quote. | `MET-01`–`MET-05`, `MET-08` | `GRD-01`–`GRD-03`, `GRD-07`, `GRD-15`, `GRD-16` | Focused unit tests and disposable Firebase-emulator actor journeys cover starter, bypass, import, manual setup, publication, authoritative quote save, disabled-delivery fail-closed behavior, and stale-revision rejection. Hosted role/recovery, production, provider, accessibility, human-comprehension, baseline, and outcome evidence remain absent; `QPI-01` is not complete, so `QPI-02` remains dependency-blocked. Stripe Connect was not exercised. | `no_outcome_claim` |
| `LED-011` | Business Setup Center first-quote readiness hierarchy refinement | Leading with the existing business-ready projection while keeping cost, starting-point, and provider work secondary should reduce false setup dead ends before an administrator or sales user begins a quote. | `MET-01`–`MET-05` | `GRD-01`–`GRD-03`, `GRD-07`, `GRD-15`, `GRD-16` | Current-source implementation and focused component regressions distinguish aggregate `ready`, incomplete-but-`quote-ready`, and quote-blocked `attention` states without changing quote authority. Disposable Firebase-emulator desktop/mobile captures distinguish quote eligibility from optional setup and scope provider connection to provider-backed actions. Hosted-role, accessibility, human-comprehension, baseline, and outcome evidence remain absent; no saved quote, proposal send, or provider action was executed. | `no_outcome_claim` |
| `LED-012` | Quote-ready Library to unsaved-draft continuation | Giving authorized administrators and sales staff one explicit continuation from authoritative quote readiness into the existing guarded draft path should reduce path reconstruction without turning navigation into a false completion signal. | `MET-03`–`MET-05` | `GRD-01`–`GRD-03`, `GRD-07`, `GRD-15`, `GRD-16` | Focused component regressions prove application-authority precedence, callback forwarding, admin/sales eligibility, unauthorized-role withholding, and unsaved-draft boundary copy. A disposable Firebase-emulator administrator journey publishes a governed starter catalog, renders the continuation at desktop and phone widths, reads an empty authoritative organization quote-ID set immediately before the action, reaches `/app/quotes/new`, and proves that exact set remains empty afterward. Hosted sales-role, accessibility, human-comprehension, baseline, and outcome evidence remain absent. No saved quote, proposal send, or provider action is claimed. | `no_outcome_claim` |
| `LED-013` | Inventory evidence-table contained-scroll repair | Keeping all seven stock, allocation, cost, location, and purchase-pack axes legible and reachable at constrained widths should reduce evidence-review friction without merging independent authority. | `MET-11`, `MET-12` | `GRD-06`, `GRD-07`, `GRD-11`, `GRD-12` | Focused component checks and local 390/768/1440 component-browser checks prove page containment, guidance whenever the table overflows, keyboard scrolling, complete final-column visibility, and forced-colors focus width/color. Complementary route checks prove local fallback cannot self-enable Inventory without tenant authority and that an authenticated Firebase-emulator administrator can render the seven-axis table when the tenant gate is enabled. Hosted deployment binding, assistive-technology use, operator comprehension, physical Inventory, and operational outcomes remain absent. | `no_outcome_claim` |
| `LED-014` | Library semantic and keyboard-order repair | Matching DOM and focusable-control order to the visually leading quote-readiness rail at constrained widths should reduce task-discovery friction without displacing the desktop commercial catalog. | `MET-03`–`MET-05` | `GRD-01`, `GRD-02`, `GRD-11`, `GRD-12`, `GRD-15` | Component regression and local 390/768/1440 browser checks prove readiness-before-catalog DOM and focusable-control order, retained desktop 67/33 geometry, and zero axe violations. Hosted deployment binding, assistive-technology use, human comprehension, baseline, and outcome evidence remain absent. | `no_outcome_claim` |
| `LED-015` | Library first-quote menu-import orientation, canonical CSV template, durable source lineage, and exact accepted-row review | Carrying exact menu intent into Import Studio, giving administrators a deterministic header-only template, retaining bounded source context after publication, and returning the accepted receipt to one exact record should reduce source-format reconstruction and record-tracing ambiguity without implying activation or provider attestation. | `MET-03`–`MET-05`, `MET-08` | `GRD-01`–`GRD-03`, `GRD-07`, `GRD-11`, `GRD-12`, `GRD-15`, `GRD-16` | Focused component/model tests prove menu-route intent, exact template bytes, type detection, mapping, source-descriptor forwarding, fail-closed provenance validation, receipt binding, draft-merge retention, publication lineage, active-record stamping, business-hash exclusion, same-batch accepted-row selection, admin-only handoff, asynchronous exact-item focus, and missing-record no-substitution recovery. Local 390/768/1440 browser checks prove the route into Import Studio, template download name, page containment, unchanged local catalog, and zero axe violations. A disposable connected Firebase-emulator lane additionally proves starter publication, routed import with asynchronous current-section discovery, exact receipt-bound draft review, a later active revision, and one server-authoritative saved quote/version from empty history with the imported selection snapshot intact. Proposal delivery, customer acceptance, booking, payment, recipe truth, physical Inventory, hosted/provider/production behavior, assistive-technology use, human comprehension, baseline, activation-time, and outcomes remain absent. | `no_outcome_claim` |
| `LED-016` | Staff and Living Opportunity operator-language cleanup | Replacing the internal Decision Debt product name with pending-decision and final-count task language should reduce interpretation work while preserving the exact read, deadline, and Workflow task. | `MET-16` | `GRD-06`, `GRD-07`, `GRD-11`, `GRD-15` | Focused source and component tests prove the selected operator surfaces no longer expose the internal phrase and still preserve incomplete-read and exact Workflow-handoff behavior. Hosted, assistive-technology, human-comprehension, workflow-preference, usage, and outcome evidence remain absent. | `no_outcome_claim` |
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
