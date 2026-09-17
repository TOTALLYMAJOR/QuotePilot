# Task 3 — Internal supply plan and authoritative stock count

Last updated: 2026-09-17 08:51:30 CDT

## Outcome

Implemented a callable-only, organization-scoped `event-supply-action-plan-v1` authority and extended the live inventory ingredient authority with a human-confirmed `record_stock_count` command. The implementation does not contact vendors, create purchase orders or reservations, authorize spend, change quote/commercial authority, or give browsers a direct Firestore write path.

Planner start: `2026-09-17T13:27:42.854Z` for `task-3-internal-supply-plan-authoritative-stock-count` (`auth_rules`, high risk). The brief's legacy `functions/inventoryAuthorityCore.cjs` path was refined, with approval, to the live `functions/inventoryIngredientCore.cjs`; the legacy file was left untouched.

## Authority delivered

- Current supply-plan head: `organizations/{organizationId}/eventSupplyActionPlans/{quoteId}`.
- Immutable revisions: `organizations/{organizationId}/eventSupplyActionPlans/{quoteId}/revisions/{revisionId}`.
- Immutable command receipts: `organizations/{organizationId}/eventSupplyActionPlanReceipts/{receiptId}`.
- Same-tenant admin/sales reads and admin-only mutations, with stored role, active organization, tombstone, tenant feature setting, global gate, and App Check `verified`/`monitoring` state checked or surfaced.
- Exact, idempotent `save_draft`, `approve`, `rebase`, and `cancel` envelopes with `requestId`, `expectedPlanRevision`, request-substitution refusal, immutable receipt verification, and competing-revision refusal.
- Server-derived exact allocation, shortage, and combined source fingerprints from verified `event-ingredient-plan-v1` evidence; bounded edits must exactly cover the shortage set and retain policy/offer fingerprints.
- Human approval binds the authenticated actor and server time. Rebase clears obsolete approval evidence. Cancellation preserves the last reviewed source. Resolution is derived only from a refreshed, verified allocation source with no shortages.
- `record_stock_count` accepts only the exact active ingredient, location, and base unit; requires non-negative counted quantity, occurrence time, actor, and expected stock revision; calculates the delta on the server; advances stock revision; and creates an immutable, backward-verifiable movement and command receipt.

## Changed implementation and tests

- Server authority: `functions/eventSupplyActionPlanCore.cjs`, `functions/inventoryIngredientCore.cjs`, `functions/inventoryAuthority.js`, `functions/index.js`.
- Client adapters: `src/lib/eventSupplyActionPlanClient.js`, `src/lib/inventoryAuthorityClient.js`.
- Browser-deny rules: `firestore.rules`.
- Focused server/client/rules/deployment tests under `src/lib/__tests__/` and `src/rules/__tests__/`, including tenant, role, exact-key, fingerprint, idempotency, request-substitution, stale-source, concurrency, legacy movement, and tamper cases.
- Export inventory expectations were updated in `src/lib/__tests__/capabilitySurfacingGate.test.js`; canonical capability contracts and product documentation were not changed.

## Red/green evidence

- Initial supply runtime suite: 3/3 red while its allocation fixture omitted fields required by the existing verified allocation authority; the fixture was corrected before implementation claims.
- Focused supply/client/deployment suite after self-review: 3 files, 35 tests passed.
- Focused Task 3 authority suites: 6 files, 123 tests passed before the final self-review; the affected supply files were rerun after the self-review.
- Full unit suite first exposed the expected export-inventory count change (150 to 152). After updating that test: 506 files passed, 3 skipped; 6007 tests passed, 100 skipped.
- Firestore emulator rules: 96/96 passed.
- Production build: passed after the final authority self-review.
- `node --check` for changed server modules: passed.
- `npm run check:project-state`: passed (12 capabilities, 10 blockers, 1 proof event, 5 commercial evidence records).
- `git diff --check`: passed.

## Bounded residuals and Task 5 obligations

- `npm run check:env` is blocked locally only because the six required `VITE_FIREBASE_*` values are absent. No secret values were inspected or logged.
- `npm run check:capability-surfaces` correctly refuses the new supply-plan core/client and two callable exports until Task 5 adds the discoverable role-safe UI, UI-state assertions, capability contract, Feature Matrix, User Manual, changelog, and Product Intelligence reconciliation. The command also reports unrelated branch-wide obligations. Task 3 did not edit those canonical authorities.
- `npm run check:docs:governance` and `npm run check:product-intelligence` likewise refuse completion without the Task 5-owned changelog/canonical-doc and Product Intelligence updates. These are recorded obligations, not authority silently adopted by Task 3.
- No hosted Firebase execution, deployment, production verification, provider proof, or human acceptance was performed.

Planner completion: `2026-09-17T13:51:59.804Z` (`auth_rules`, high risk). The completion file set includes the approved refinement to the live ingredient core and its focused tests.
