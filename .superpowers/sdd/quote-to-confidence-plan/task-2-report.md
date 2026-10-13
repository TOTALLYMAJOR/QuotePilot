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

## Review fix round 1

- Restored the pre-Task-2 workbench rendering and review eligibility when `decisionPacket` is off. The six-row comparison and its fail-closed review block now apply only when both the build and tenant gates enable the release.
- Hardened all six comparison rows. Guest, price, and margin require exact matching deltas; price requires a valid currency; staffing requires coverage state and gap totals; supply requires a coverage state consistent with its shortage count. Malformed evidence that claims to be healthy is downgraded to `schema_drift` and cannot reach review.
- Template starts now open the actual destination disclosure and focus the actual template control in both Guided and Composer modes. The interaction tests click the governed start action against the real mode components.
- Accepted-revision handoff now requires the active accepted revision, a portal decision bound to the same acceptance receipt ID, and matching quote/receipt portal issuance identities. Delivery provenance cannot override the active accepted revision, and Quote History preserves both accepted-revision and receipt IDs in its existing administration destination.
- The decision-packet headline claims an exact handoff only when that handoff is actually available.
- Repaired the two inherited Task 1 expectations narrowly: the ambient marker count now includes the three added customer/event fields, and the Step Event snapshot records only those corresponding markers.

## Review fix round 2

- Acceptance and the internal handoff now require an explicit `portalDecision.decision === "accepted"`. A declined or changes-requested decision alongside a receipt is contradictory; an absent decision is missing evidence. All three states are non-actionable.
- Extended the existing same-app Proposal administration arrival contract with an optional all-or-nothing pair of `acceptedRevisionId` and `acceptanceReceiptId` pins. Generic quote and payment administration arrivals remain unchanged, and partial or non-Proposal pinning is rejected.
- The actual App destination builder now recognizes a decision-packet handoff as Proposal administration and carries both pins through browser history state and arrival parsing.
- Quote History revalidates those pins against the currently selected quote, its current acceptance receipt, and the complete current decision-packet chain. A changed revision, mismatched receipt, conflicting decision, stale issuance, or unavailable authority renders a recovery surface and withholds generic quote administration.

## Authority and domain review

The catering-domain reconsideration result is **BOUND**. The presentation reduces re-entry and review effort, but it does not turn a template, previous event, scenario, acceptance receipt, or payment label into a new authority. Blank and template starts enter the ordinary quote draft; prior accepted events enter the existing exact-version rebook selection and staff review; the decision packet routes to existing quote administration only after matching the accepted revision and receipt. Supply remains a read projection and does not reserve stock, staffing remains recorded assignment versus projected requirement, and margin uses recorded costs only.

No customer decision, signature, acceptance, charge, booking, delivery, price, staffing assignment, inventory reservation, or provider evidence can be created from these new projections or components.

## Validation evidence

- Review-fix round 2 suites: **PASS** — 5 files, 74 tests, including conflicting and absent portal decisions, pinned arrival round-tripping, the actual App destination builder, exact Quote History arrival, and rendered recovery in place of generic administration.
- Repository unit suite: **PASS** — 504 files passed, 3 skipped; 5,997 tests passed, 100 skipped.
- `npm run build`: **PASS** — final Vite production build completed in 45.34s.
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
- Review fix round 1 start: `2026-09-17T12:51:41.509Z`
- Review fix round 1 complete: `2026-09-17T13:10:42.293Z`
- Review fix round 2 start: `2026-09-17T13:14:03.619Z`
- Review fix round 2 complete: `2026-09-17T13:24:05.292Z`

## Residual concerns

- The feature cannot appear in a normal build until both gates are explicitly enabled.
- Canonical capability and Product Intelligence registration is deliberately pending Task 5.
- Connected provider, hosted, production, and human-acceptance behavior was not exercised by this local slice.

## Development impact

The slice improves decision speed, reliability, and traceability: staff can compare six operational/commercial consequences in one keyboard-readable panel, start from governed existing sources without bypassing review, and see the exact customer-decision-to-accepted-revision chain without granting the presentation any mutation authority.
