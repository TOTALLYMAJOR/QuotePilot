# Task 4 — Exception-first inventory and offline mobile capture

Last updated: 2026-09-17 09:45 CDT

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
