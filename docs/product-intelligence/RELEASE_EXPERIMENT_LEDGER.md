# Release and Experiment Ledger

Last updated: 2026-10-15 15:40:00 CDT

## LED-022 — Quote-to-Confidence local candidate

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
| `LED-017` | Workspace WCAG scanner expansion and phone-width quote-step keyboard repair | Giving administrators keyboard access to the horizontally scrollable quote-step rail while scanning the default workspace against supported WCAG 2.0, 2.1, and 2.2 A/AA axe rules should reduce undetected access barriers without changing quote authority. | `MET-03`–`MET-05` | `GRD-01`, `GRD-02`, `GRD-11`, `GRD-12`, `GRD-15` | The focused local Playwright lane passes at 1440px and 390px after naming and focusing the current and legacy step rails. Hosted behavior, assistive-technology use, human acceptance, task completion, baseline, and outcome evidence remain absent. | `no_outcome_claim` |
| `LED-018` | Unreleased October 10 safety and loading candidate | Catering staff can review available client and operational evidence sooner while failed optional reads remain recoverable and nested diagnostic values remain private. | `MET-03`–`MET-05` as workflow diagnostics; route-loading improvement needs a separate before/after measurement | `GRD-01`, `GRD-02`, `GRD-07`, `GRD-09`, `GRD-11`, `GRD-12`, `GRD-15`, `GRD-16` | Local source separates public/staff/composer loading, bounds on-demand history concurrency, isolates read failures, and recursively sanitizes diagnostic context. The integrated Reporting review advances capability contract revision 5 for independent loading and retained-stale recovery coverage without changing metrics or authority. The compatibility Quote Workspace uses its existing event summary for identity and guest count rather than computing the full Ambient model; parity coverage preserves those displayed values without changing pricing or authorization. The completion handoff records local check results. No production exposure, frozen timing baseline, hosted authenticated acceptance, assistive-technology or human acceptance, causal comparison, or catering outcome is established. | `no_outcome_claim` |
| `LED-019` | Unreleased Inventory traceability and reviewed recipe-dependency candidate | Giving administrators an ingredient-local verified movement/commitment trace and requiring an exact affected-menu review before recipe publication should reduce reconciliation ambiguity and stale downstream menu-cost work without turning evidence into readiness or pricing authority. | `MET-11`, `MET-12` | `GRD-01`, `GRD-02`, `GRD-06`, `GRD-07`, `GRD-11`, `GRD-15`, `GRD-16` | Local runtime/client/component tests cover stable bounded cursors, tenant and malformed-evidence rejection, exact commitment reconciliation, entity-local retry/focus, stale-response suppression, and transactionally rechecked recipe dependency digests. Direct fixture publication now obtains the digest from the same authority, and a disposable Firebase-emulator run passes the reviewed recipe and dependent cost mutations. No hosted/authenticated browser run, current Firestore index deployment, assistive-technology or human acceptance, production exposure, baseline, or operational outcome is established. | `no_outcome_claim` |
| `LED-020` | Unreleased progressive performance and operability candidate | Deferring optional work, publishing independent evidence, preserving context, navigating exact consequences, and reconciling receiving lines independently should reduce operator waiting and unsafe replay without weakening authority. | `MET-03`–`MET-05`, `MET-11`, `MET-12`, `MET-18` | `GRD-01`, `GRD-02`, `GRD-06`, `GRD-07`, `GRD-09`, `GRD-11`, `GRD-12`, `GRD-15`, `GRD-16` | Earlier receipts support their source checkpoints, not the later dirty candidate. October 11 repairs Inventory settings-read eligibility and keeps 199 displayed rows plus one lookahead within the unchanged 200-record bound; 140 Inventory, 63 Now, and 10/10 route-gate tests pass, including diagnostic-only exclusion. Three reproduced quote-browser failures are fixed and their focused three-scenario rerun passes. An integrated browser run records 89 passed, 314 skipped, and one Workflow → Edit quote focus failure; both app shells now defer the quote-bound focus handoff until the matching hydrated editor is visible, preserving Ambient field intent, and the unchanged portal regression passes 1/1 in 37.0 seconds. The next full browser run records 88 passed, 314 skipped, and two readiness races before accessibility/typography sampling; all four quote repairs pass. Only exact-target test waits changed, with assertions intact. The fresh full suite passes 90, skips 314, and fails zero in 11.5 minutes with two workers and zero retries (`/tmp/quotepilot-browser-repair-ready.json`), covering all four quote repairs and both readiness fixes; earlier failures remain in the chronology. Fresh full units pass 6,255 with 100 skipped across 523 passing/three skipped files in 171.37 seconds. Compatibility build passes in 49.13 seconds with 3,477,038 bundle bytes against 3,652,845; Ambient build passes in 59.64 seconds with 4,964,850 bytes against the unchanged 4,968,757 ceiling. Standard homepage CWV passes; Truth Loop passes 136 tests. The original release wrapper **fails** branch-wide `DOC_GOVERNANCE_DIFF=origin/main...HEAD` timestamp advancement on 14 already-committed documents with clean working-tree copies; a separate HEAD-relative working-tree governance pass does not erase that failure. Five-run calibration `sYfMr3` passes 20/20 and adopts integer ceilings `ceil(nearest-rank p75 of five samples × 1.10)` in [the tracked calibration receipt](../performance/route-performance-calibration.json). Independent same-build verification `2oWf32` passes all 12 browser scenarios but **fails** the performance gate: Now/Clients and all byte ceilings pass; Inventory usable-core is 2994.8 ms > 2155 ms and quote-review is 2488.5 ms > 2462 ms; both supplemental ceilings also fail. Diagnostic `aQu9jj` records 1.834 seconds but is excluded from qualification and does not supersede that failed receipt or establish a new performance claim. The predeclared single three-run final-candidate verification `XiQcPO` passes 12/12 browser scenarios in 1.6 minutes and all median ceilings on build `027c8e5ab9c0159e8f52b3a5d0e5dcac938836db32667045d1952584255521e6`, against unchanged budget SHA-256 `8796586087699e7170c5b3e8b7fb2cec6b44af405bc2bd33e26df158cf009c16`. The raw receipt is `output/playwright/quotepilot-route-performance-XiQcPO/receipt.json`; all 12 compact samples are retained in `candidateVerifications[0]` of the tracked calibration receipt, with route medians summarized in [Product Intelligence](../PRODUCT_INTELLIGENCE.md#progressive-operability-hypothesis). Original calibration and failed `2oWf32` evidence remain unchanged; no causal timing improvement is attributed to the focus fix. Local performance is qualified, not released or hosted-qualified. The 14 branch-wide documentation timestamp debts remain the only observed release gate blocker in this validation. Opportunity and Schedule retain their documented calm state treatment and narrow domain-motion exceptions. No hosted qualification, production exposure, deployment, assistive-technology or human acceptance, physical Inventory correctness, baseline, or catering outcome is established; UAT v5 has not run against hosted roles. | `no_outcome_claim` |
| `LED-021` | Unreleased tenant-scoped authentication and setup-entry repair | Requiring current catalog evidence before an organization-scoped staff workspace renders, while binding setup bypass to the exact organization, should reduce incorrect setup paths and transient cross-tenant workspace exposure during account changes. | `MET-03`–`MET-05` | `GRD-01`, `GRD-02`, `GRD-07`, `GRD-15`, `GRD-16` | A focused hook regression passes 7/7. Disposable Firebase-emulator browser suites pass 4/4 auth/rules journeys and 3/3 authoritative-pricing journeys with retries disabled, including a mutation observer that records no protected workspace frame while switching to a blank tenant, restored clean quote fields, server pricing, provider-bound delivery, stale catalog rejection, and fresh-tab setup gating. This is local emulator evidence; hosted behavior, production identity changes, assistive-technology or human acceptance, timing impact, and catering outcome evidence remain absent. | `no_outcome_claim` |
| `LED-022` | Quote-to-Confidence isolated local candidate; flags off | Clear next actions, exact handoffs and operator-reviewed learning reduce repeated work without transferring authority. | `MET-19`, `MET-20`, `MET-21` | `GRD-01`, `GRD-04`, `GRD-07`, `GRD-09`, `GRD-16` | Local evidence only. Release integration now defers closeout actuals until supporting detail is opened and keeps the enabled learning review as the single actuals consumer; focused tests also preserve deterministic Inventory draft expiry and App/Legacy margin-comparison parity. The 14-day `BASE-09` remains uncollected; fewer than 50 eligible observations are informational. No hosted, human, or outcome evidence is established. | `no_outcome_claim` |
| `EXP-001` | Proposed owner-operator baseline and governed workflow comparison | QuotePilot reduces time from intent to reviewable quote and operating plan by 30% without increasing material corrections. | `MET-03`, `MET-07`, `MET-12`, `MET-16` | `GRD-03`, `GRD-04`, `GRD-07`, `GRD-16` | Protocol exists in Delivery Planning; baseline collection has not occurred. | `planned` |
| `EXP-002` | Proposed accepted-to-operational-handoff observation | Domain-specific currentness evidence exposes stale consumers early enough to reduce late operational discovery. | `MET-11`, `MET-12` | `GRD-06`, `GRD-07`, `GRD-15` | Required signal `SIG-011` is specified but not implemented. | `planned` |
| `LED-023` | Unreleased PR 90 replacement; local candidate only | Returning staff can see refreshed Quote History and Reporting data with less manual refresh work, without changing commercial facts. | `MET-04` | `GRD-01`, `GRD-04`, `GRD-06`, `GRD-07` | Local focus/visibility, exact-quote, closed-view and read-only expiry regressions. No hosted, human, baseline, or outcome evidence. | `no_outcome_claim` |

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
