# Task 4 — Exception-first inventory and offline mobile capture

Last updated: 2026-09-17 10:11 CDT

## Outcome

Implemented three independently default-off Inventory capabilities without changing Task 3 wire contracts or adding browser Firestore writes:

- `inventoryExceptionWorkspace` leads with ordered shortage, stale-count, missing-cost, unresolved-conversion, and commitment-contention cards. Physical, committed, available-to-allocate, cost, location, and purchase-pack evidence stay separate, while the detailed seven-column ledger remains available under native disclosure.
- `eventSupplyActionPlan` exposes the Task 3 callable read/command contract for accepted or booked events. Administrators can edit supplier reference/label, planned quantity, optional estimated cost, notes, conditions, and exact policy/offer fingerprints; saving, rebasing, cancellation, explicit approval, source staleness, resolution, receipts, loading, empty, and error truth remain visible. It expressly does not contact vendors, create purchase orders or reservations, change stock, or authorize commercial scope.
- `inventoryMobileCapture` provides search-first walk-shelf capture with optional `BarcodeDetector` enhancement and a complete manual fallback. Native IndexedDB retains exact organization/user/location-scoped drafts for seven days. Offline state is device truth only; reconnect submission compares stock revisions and independently sends only clean `record_stock_count` lines through the existing gated Task 3 client while retaining successful receipts, conflicts, and partial failures for recovery.

Planner start: `2026-09-17T14:39:40.067Z` for `task-4-exception-first-inventory-offline-mobile-capture` (`ui`, medium risk). The final file set adds the dedicated E2E fixture and this task report. The planner's emitted canonical documentation and Product Intelligence changes remain explicitly assigned to Task 5 by the approved task boundary.

## Authority and safety boundaries

- All three flags normalize to `false` when absent or malformed.
- Supply-plan mutations call `applyEventSupplyActionPlanCommand`; stock-count submission calls `applyInventoryCommand` with the real organization, role, browser gate, tenant gate, request identity, and exact Task 3 command.
- Each shelf line carries the physical observation timestamp captured on device. Reconnection does not replace it with submission time.
- Capture keys include exact organization, authenticated user, and location identities; list and mutation access cannot display or address another scope.
- IndexedDB storage is reused for the page lifetime, expires records after seven days, and makes no cold-offline-launch promise.
- No vendor contact, purchase-order, reservation, pricing, quote, acceptance, payment, or commercial authority was introduced.

## Red/green and validation evidence

- Red: the new capture-draft and Inventory component tests initially failed against the missing draft module, capability exports, and feature-gated surfaces.
- Green after implementation and self-review: focused Task 4/client/flag coverage passed 102/102 across 7 files.
- Fresh full unit suite: 507 files passed, 3 skipped; 6,030 tests passed, 100 skipped.
- Fresh responsive/accessibility E2E: 2/2 Chromium tests passed at 1440×1000 and 390×844, including keyboard disclosure, focus, 44 px touch target, no horizontal overflow, Axe checks, loading/error/empty states, native IndexedDB save, offline submission refusal, and BarcodeDetector fallback.
- Fresh production build: passed with 369 modules transformed.
- `npm run check:project-state`: passed (12 capabilities, 10 blockers, 1 proof event, 5 commercial evidence records).
- `git diff --check`: passed.

## Explicit residuals and Task 5 obligations

- `npm run check:env` is locally blocked because the six required `VITE_FIREBASE_*` values are absent. No values were inspected or logged.
- `npm run check:docs:governance` correctly requires a changelog update for user-visible code. The approved Task 4 boundary forbids canonical-doc edits; Task 5 owns reconciliation.
- `npm run check:product-intelligence` correctly requires `docs/PRODUCT_INTELLIGENCE.md` and the release-experiment ledger. Those edits remain Task 5 work.
- `npm run check:capability-surfaces` evaluates the cumulative `origin/main...HEAD` branch and reports prior Task 1–3 backend paths/exports plus the new local draft module as uncovered until Task 5 updates capability contracts and canonical UI-state evidence.
- No hosted Firebase call, deployment, production verification, provider proof, or human acceptance was performed.

Planner completion: `2026-09-17T14:44:41.622Z` (`ui`, medium risk). The emitted canonical documentation and Product Intelligence obligations remain assigned to Task 5; Task 4 changed no canonical authority documents.

## Fix round 1 — concurrency and recovery hardening

Planner start: `2026-09-17T15:08:02.280Z` for `task-4-fix-round-1-inventory-concurrency-and-recovery` (`ui`, medium risk). An earlier planner invocation used the smaller initial file set at `2026-09-17T14:49:09.504Z`; the later timestamp records the exact final implementation/report scope.

The review findings are resolved without widening Inventory authority:

- A stale supply plan now rebases against refreshed shortage evidence. Edits are dirty-tracked, confirmation is reset on any event/revision/value change, and approval is allowed only for the exact saved revision and values.
- Supply-plan and capture reads/mutations are generation-fenced across organization, user, location, event, and empty-selection transitions so late callbacks cannot repopulate the wrong scope.
- Each capture line durably owns its exact request ID and canonical `record_stock_count` command. Uncertain outcomes—including an interrupted persisted in-flight attempt—explicitly reconcile the same identity; definitive rejections are reset before a new identity is issued for an explicitly reviewed rebase. Different ingredients at the same location no longer collide in pending-attempt identity, and unsafe upstream error text cannot prevent the recovery state itself from being persisted.
- Native IndexedDB create/update/submit/discard use atomic add or revision-checked read-write transactions. Mutations retry bounded compare-and-swap conflicts, merge independent lines, and persist each line's in-flight marker and receipt/conflict/error before moving to the next request.
- Search, reconnect comparison, and recovery all require exact organization/user/location/ingredient/base-unit evidence. Barcode files are decoded to `ImageBitmap`, passed to `BarcodeDetector`, and closed, with manual search preserved on every failure.
- With `inventoryExceptionWorkspace` off, the ledger retains the prior expanded presentation. The disclosure exists only when that feature flag is on.

Red evidence captured the original defects: 5/7 draft-store tests failed, the same-location/different-ingredient authority-client test failed, and 6/34 component tests failed. Initial E2E also exposed both the native two-tab IndexedDB create race and 28 px overflow at 768 px. After implementation:

- Focused unit/component/client: 3 files passed, 92/92 tests.
- Full unit: 507 files passed, 3 skipped; 6,043 tests passed, 100 skipped.
- Responsive/accessibility/native-browser E2E: 4/4 passed at 1440×1000, 768×1024, and 390×844, including native IndexedDB reload, concurrent-tab line merging, user-scope switching, partial authoritative receipt retention, and revision-conflict recovery. The fixture is explicitly marked as mock-server authority; this is not hosted Firebase proof.
- Production build: passed with 369 modules transformed.
- `npm run check:project-state`: passed (12 capabilities, 10 blockers, 1 proof event, 5 commercial evidence records).
- `git diff --check`: passed.

The expected Task 5/environment residuals remain unchanged: `check:env` lacks the six local Firebase variables; documentation and Product Intelligence gates require the explicitly deferred canonical files; and the cumulative capability-surface gate reports prior Task 1–3 backend paths plus the local draft module until Task 5 reconciliation. No hosted, deployed, provider, production, or human-acceptance claim is made.

Fix-round planner completion: `2026-09-17T15:16:31.677Z` (`ui`, medium risk), using the same exact final file set as the refreshed start record.
