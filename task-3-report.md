# Task 3 — Internal supply plan and authoritative stock count

Last updated: 2026-09-17 09:17:42 CDT

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

## Important-finding remediation

Fix round 1 planner start: `2026-09-17T13:56:23.100Z` for `task-3-fix-round-1-source-freshness-and-count-canonicalization` (`core`, high risk).

- Every supply-plan read and non-replay command now transactionally verifies the current allocation, current requirement head, pinned immutable requirement, current event projection, current quote plus pinned quote revision, every pinned recipe head, every relevant stock state, and every relevant allocation fence before returning or mutating authority.
- Full-document requirement, event-projection, quote-revision, recipe, stock, and fence fingerprints roll into an exact supporting-evidence fingerprint and the combined source fingerprint. Semantic drift additionally produces explicit ineligibility reasons. Exact receipt replay remains idempotent even if later source evidence changes.
- Only live `shortage` or `reserved` allocations with current supporting evidence are eligible. `released` and `settled` allocations are stale/ineligible and cannot be rebased into a resolved plan. Resolution still requires an eligible refreshed allocation with zero shortages.
- The client canonicalizes counted quantities before the callable payload, pending-attempt record, receipt comparison, and projection reconciliation. Both `37.500` to `37.5` and `0.000` to `0` succeed without weakening exact micros checks.

## Quote-source fingerprint remediation

Fix round 2 planner start: `2026-09-17T14:12:18.681Z` for `task-3-fix-round-2-quote-source-fingerprint-serialization` (`core`, high risk).

- Quote and immutable quote-version evidence now use a private, domain-separated SHA-256 fingerprint over a deterministic typed canonical representation. It supports finite decimal prices, totals, and rates; normalizes negative zero; and supports JavaScript `Date` plus exact persisted Firestore Timestamp-like `{seconds, nanoseconds}` and `{_seconds, _nanoseconds}` values.
- The serializer sorts object keys, distinguishes scalar types, bounds depth and node count, and fails closed with `data-loss` for non-finite or unsafe numbers, invalid timestamps, unsupported types or prototypes, symbol keys, undefined values, and cycles.
- The inventory quantity digest and its integer-only safeguards were not changed. This quote-only fingerprint does not calculate or authorize a price; it binds the exact current commercial evidence used by the supply-plan freshness check.
- Realistic quote/version fixtures exercise decimal menu price, subtotal, total, tax rate, and both persisted Timestamp shapes. A one-cent total drift changes the quote fingerprint, marks the plan stale, and refuses approval; non-finite and unsupported quote evidence are rejected deterministically.

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
- Fix round 1 began with 7 expected red regressions. After implementation, focused Task 3 coverage passed 155/155; full unit passed 6018 with 100 skipped across 506 passing and 3 skipped files; Firestore rules passed 96/96; and the production build passed.
- Fix round 2 began with all 15 supply-runtime tests red because the former inventory digest rejected realistic decimal quote evidence. After the quote-domain serializer was introduced, the supply runtime passed 15/15 and all focused Task 3 suites passed 158/158 across 6 files. Firestore rules passed 96/96 and the production build passed. The full unit suite was not rerun because this round did not change a shared core or the inventory digest; the fix-round-1 full-unit result above remains the latest full-suite evidence.

## Bounded residuals and Task 5 obligations

- `npm run check:env` is blocked locally only because the six required `VITE_FIREBASE_*` values are absent. No secret values were inspected or logged.
- `npm run check:capability-surfaces` correctly refuses the new supply-plan core/client and two callable exports until Task 5 adds the discoverable role-safe UI, UI-state assertions, capability contract, Feature Matrix, User Manual, changelog, and Product Intelligence reconciliation. The command also reports unrelated branch-wide obligations. Task 3 did not edit those canonical authorities.
- `npm run check:docs:governance` and `npm run check:product-intelligence` likewise refuse completion without the Task 5-owned changelog/canonical-doc and Product Intelligence updates. These are recorded obligations, not authority silently adopted by Task 3.
- No hosted Firebase execution, deployment, production verification, provider proof, or human acceptance was performed.

Planner completion: `2026-09-17T13:51:59.804Z` (`auth_rules`, high risk). The completion file set includes the approved refinement to the live ingredient core and its focused tests.

Fix round 1 planner completion: `2026-09-17T14:06:52.454Z` (`core`, high risk).

Fix round 2 planner completion: `2026-09-17T14:17:57.830Z` (`core`, high risk). The emitted canonical documentation and Product Intelligence obligations remain assigned to Task 5; this remediation changed no canonical authority documents.
