# Task 2 report — Decision packet and governed quote starts

## Status

Implemented and locally validated the Release 2 decision presentation behind the default-off `decisionPacket` gate. The slice composes existing quote, template, rebook, portal-decision, acceptance, payment, and accepted-revision evidence without adding or altering any signature, acceptance, payment, pricing, template, rebook, delivery, or operational authority.

## Delivered

- Added a deeply frozen presentation-only comparison projection with six explicit rows: Guests, Menu, Price, Margin, Staffing, and Supply.
- Rendered an accessible `Current / Proposed / Difference` table in the existing commercial scenario workbench while preserving Task 1's existing all-scenario and mobile selected-scenario comparison surfaces.
- Preserved `missing`, `stale`, `contradictory`, `unavailable`, `not_yet_available`, `blocked_by_integration`, `schema_drift`, `unknown`, and `partial` evidence as visible non-pass states. Only `available` and `not_applicable` can reach the governed review continuation.
- Added exact recorded-cost margin comparison to the Living Commercial Twin. Margin remains unavailable unless both the saved and proposed snapshots have complete recorded-cost coverage and matching catalog revisions; no cost or rate is inferred.
- Added a governed new-draft start presentation for blank quote, current active Library template, and exact prior accepted event. The actions only focus or navigate into existing draft, template selection, customer, and rebook review paths.
- Added a read-only decision packet that composes the existing portal decision, exact acceptance receipt, payment projection, and staff accepted-revision handoff. The handoff is available only for an accepted/booked record with an exact current acceptance receipt in a connected authoritative workspace.
- Local fallback decision, acceptance, and payment records remain explicitly unavailable, and unsupported payment states are contradictory rather than silently normalized.
- Added the default-off tenant flag `featureFlags.decisionPacket` and build gate `VITE_DECISION_PACKET_ENABLED`. Both must be explicitly enabled. The Legacy app normalizes and preserves the flag but does not expose a new Legacy-only surface.

## Authority and domain review

The catering-domain reconsideration result is **BOUND**. The presentation reduces re-entry and review effort, but it does not turn a template, previous event, scenario, acceptance receipt, or payment label into a new authority. Blank and template starts enter the ordinary quote draft; prior accepted events enter the existing exact-version rebook selection and staff review; the decision packet routes to existing quote administration only after matching the accepted revision and receipt. Supply remains a read projection and does not reserve stock, staffing remains recorded assignment versus projected requirement, and margin uses recorded costs only.

No customer decision, signature, acceptance, charge, booking, delivery, price, staffing assignment, inventory reservation, or provider evidence can be created from these new projections or components.

## Validation evidence

- Final Task 2 projection/UI suites: **PASS** — 4 files, 47 tests.
- Expanded Task 2 integration suites: **PASS** — 10 files, 99 tests, covering Quote History, scenario workbench, living-twin, and hook/lib integration.
- Task 1 preservation suites: **PASS** — 8 files, 119 tests.
- Repository unit suite: **PARTIAL** — 502 files passed, 3 skipped, 2 failed; 5,970 tests passed, 100 skipped, 2 failed. Both failures are inherited Task 1 fixture drift in unchanged Task 2 files: `ambientEventLogisticsEditorFocus.test.jsx` still expects five ambient markers although Task 1 added three exact destination markers, and `wizardVisualSnapshots.test.jsx` retains the pre-Task-1 Step Event snapshot. `WizardSteps.jsx` and both failing test files are unchanged by Task 2.
- `npm run build`: **PASS** — final Vite production build completed in 30.05s.
- `npm run check:project-state`: **PASS**.
- `git diff --check`: **PASS**.
- `npm run check:env`: **BLOCKED BY LOCAL ENVIRONMENT** — the isolated worktree has none of the six required `VITE_FIREBASE_*` values. No values were fabricated or committed.
- `npm run check:docs:governance`: **EXPECTED TEMPORARY GOVERNANCE FAILURE** — behavior changed without the intentionally deferred Task 5 changelog update.
- `npm run check:product-intelligence`: **EXPECTED TEMPORARY GOVERNANCE FAILURE** — user-visible source changed without the intentionally deferred Product Intelligence index and release-ledger updates.
- `npm run check:capability-surfaces`: **EXPECTED TEMPORARY GOVERNANCE FAILURE** — the new presentation projection is not yet registered in a changed capability contract, alongside Task 1 paths already reserved for Task 5.
- Codebase Memory detected all 15 intended source/test paths. Its available generation (`2026-09-17T11:03:04Z`) predates this work; new paths are untracked and App/Legacy retain existing parse-partial records. Complete graph impact claims remain `GRAPH_COVERAGE_BLOCKED`; owned paths were directly reviewed and validated after the authorized implementation transition.

No hosted, provider, production, or human-acceptance claim is made from these local checks.

## Temporary Task 5 governance obligation

Task 5 must reconcile the stabilized cross-slice surface into the canonical capability contracts, Feature Matrix, User Manual, changelog, Product Intelligence index, journey/guardrails, and release ledger. In particular, it must register:

- `commercial-consequence-comparison-v1` and `data-consequence-comparison="current-proposed-difference"`;
- `quote-decision-packet-v1` and `data-capability-id="quote-decision-packet"`;
- `data-capability-id="governed-quote-starts"`;
- the default-off build/tenant gate `decisionPacket` / `VITE_DECISION_PACKET_ENABLED`;
- the explicit evidence-state and local-fallback boundaries documented in this report.

Until Task 5 completes that reconciliation, release integration must not treat this Task 2 commit alone as governance-complete.

## Planner records

- Start: `2026-09-17T12:23:40.085Z`
- Complete: `2026-09-17T12:47:15.917Z`

## Residual concerns

- The feature cannot appear in a normal build until both gates are explicitly enabled.
- Canonical capability and Product Intelligence registration is deliberately pending Task 5.
- The repository-wide suite retains two inherited Task 1 fixture failures described above; Task 2's focused suites and all Task 1 preservation suites pass.
- Connected provider, hosted, production, and human-acceptance behavior was not exercised by this local slice.

## Development impact

The slice improves decision speed, reliability, and traceability: staff can compare six operational/commercial consequences in one keyboard-readable panel, start from governed existing sources without bypassing review, and see the exact customer-decision-to-accepted-revision chain without granting the presentation any mutation authority.
