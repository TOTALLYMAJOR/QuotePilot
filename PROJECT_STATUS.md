# Project Status

Last updated: July 26, 2026

## Operational Health
- Runtime: the public custom domain (`https://quotepilot.mbmapps.com`) is aliased to Vercel production deployment `dpl_DmKUyvdgm16jmNgWRerAwoAXx8Ek`, which reached `READY` on July 26, 2026 from source commit `f4d1ba002378a20f2ab714399a40db9db3b93cef`. Firebase Hosting remains the origin/fallback (`https://tonicatering.web.app`).
- Current branch product identity: install metadata, runtime defaults, proposals, integration messages, and onboarding links use QuotePilot/MBMapps branding; the legacy Firebase project ID and hosting origin remain unchanged infrastructure identifiers.
- Build: `npm run build` passes locally for this branch.
- Test coverage: unit + Playwright smoke suites are configured in CI.
- Current branch workflow delivery: proposal readiness, Good/Better/Best scenarios, quote lifecycle timelines, lead follow-ups, sensitive-action approval requests, the customer decision center, and event production checklists are implemented and locally covered.
- Current branch tenant onboarding delivery: admin-only Import Studio supports tenant-locked CSV preview/import for customers, packages, add-ons, rentals, and menu items, with duplicate skipping, receipts, and rollback limited to records stamped by the import batch. The provisioning form no longer defaults a blank owner UID to the operator's account.
- Current branch tenant identity fix: explicit blank tenant logo/contact/address/crew values no longer fall back to the legacy customer profile, and Catalog Admin branding edits retain their draft through parent rerenders with persistent save/discard affordances.
- Current branch tenant authorization hardening: Firestore denies conflicting claim/role organization scopes and permits tenant-domain mapping changes only for same-organization admins; the focused 11-case rules matrix, authenticated Firebase save smoke, and server-authoritative pricing smoke pass on isolated emulator ports.
- Workflow authority boundaries: approval resolution does not execute a sensitive action; customer acceptance does not prove payment or booking; production checklist completion does not prove inventory availability.
- CI gates: classifier-driven lane gates are configured (`lane:quick`, `lane:core`, `Docker Build Smoke`, `lane:playwright-smoke`, `lane:firebase-auth-rules`, `lane:authoritative-pricing`, `lane:cwv-smoke`).
- P0 fallback-retirement safeguard: classifier now elevates `menuService`/`useCatalogData`/`organizationService`/`OrganizationContext` edits to `high_risk`, so Firebase heavy lanes are required (not advisory) on feature branches.
- Legacy global runtime fallback retired: frontend tenant data services and authoritative pricing/functions paths now fail closed when org context is missing instead of reading legacy global collections.
- Firestore policy hardening: retired global business collections (`catalog*`, `pricing/settings`, `eventTypes`, `menu*`, `quotes`, `quoteHistory`) are now denied in rules so org-scoped paths are authoritative.
- P0 denial evidence captured: focused Firestore emulator matrix now documents same-org allow + wrong-org deny behavior for org-scoped quote/catalog write paths.
- Migration dry-run evidence captured for production project/org (`tonicatering` / `250`) under `.cache/migration-dry-runs/` with structured totals (`wouldCreate=468`, `wouldPatch=20`).
- Production migration execution evidence captured for project/org (`tonicatering` / `250`) under `.cache/migration-runs/` with structured totals (`source=496`, `created=1`, `patched=0`).
- Migration operator resilience: `scripts/migrate-to-multi-tenant.mjs` now supports Firestore REST execution (dry-run and apply) via Firebase CLI auth token when ADC credentials are unavailable.
- Portal token rule hardening is implemented and emulator-validated: portal snapshot reads/status updates now require active (non-deleted + non-expired) snapshots at the Firestore rule layer.
- Portal snapshot expiry-ms backfill was executed for production org `250` (`customerPortalQuotes patched=2`) to preserve existing portal-link behavior under hardened rules.
- Legacy quote safety: Firebase quote writes now auto-migrate legacy global quote docs into org-scoped paths during write/version flows when org context is present.
- Functions emulator compatibility: `functions.config()` v7 removal path now degrades safely to environment values instead of throwing at runtime.
- Deploy gate: production deploy workflow now runs only after successful `CI Quality` completion on `main` pushes (or controlled manual dispatch).
- Delivery controls: canonical doc ownership and governance checks are now enforced in CI.
- Commerce resilience: Twilio SMS failures are non-blocking for quote save and Stripe checkout.
- Buyer onboarding: Integrations Ops now includes an in-app setup assistant for optional Twilio configuration.
- Production guardrail: `ENABLE_FUNCTIONS_DEPLOY=false` (default locked state).
- Production fail-safe integration mode: `notifications.sms_provider="none"` in Firebase Functions config.
- Latest production release: header crew image/name spacing fix for narrow desktop header widths.
- Last known good production deploy:
  - commit: `a4a2568f06eaedcf9805c503bb161d2847d12710`
  - CI run: `CI Quality` #23203096351 (March 17, 2026 UTC)
  - workflow run: `Deploy Firebase Hosting (+ Optional Functions)` #23203174267 (March 17, 2026 UTC)

## Active Risks
- The Vercel deployment and custom-domain alias are provider-verified, but the authenticated production quote/save/export workflow still needs post-release browser acceptance.
- Import Studio and its `importBatches` Firestore rules are implemented locally but are not deployed or hosted-smoke-verified. Excel intake, merge/update policies, saved import history UI, and active quote/payment/contract/booking imports are intentionally not included in this first slice.
- The new `portalDecision` Firestore rule changes and enriched portal snapshots are implemented locally but are not deployed or hosted-smoke-verified in this branch.
- Approval requests are role-gated in the application workflow, but stronger server-authoritative action-specific enforcement and end-to-end audit linkage remain follow-up work.
- Existing portal snapshots need refresh/backfill before older links can display every newly added event, selection, and pricing field.
- Firestore production hardening is in active P0 execution; fallback retirement, denial evidence, migration execution, and portal hardening implementation are complete, but production rollout of updated portal rules is not complete yet.
- Bundle size remains a watch item; budget/CWV gates now prevent uncontrolled regressions.
- Functions integrations (Stripe, Twilio, and Resend) remain optional and require secure runtime configuration plus provider-level acceptance/delivery proof.
- Staging sign-off routine must be re-established to keep `main` release-only under higher delivery velocity.

## Current Focus (Near-Term)
1. Deploy the updated `firestore.rules` and run hosted portal decision smoke checks, including active, expired, deleted, and change-request paths.
2. Refresh/backfill existing customer portal snapshots with the new customer-safe event and pricing fields.
3. Add server-authoritative enforcement and audit linkage for approval-request-to-admin-action execution.
4. Re-establish staging sign-off workflow before broadening merge velocity into `main`.
5. Improve large-chunk performance while staying inside bundle/CWV guardrails.

## P0 Execution Tracking (Completed March 28, 2026)
- Focus completed: migration execution after fallback retirement and denial-matrix verification.
- Evidence captured:
  - `.cache/p0-denial-matrix/20260328T001230Z--firestore-rules-cross-org-denial.log`
  - `.cache/p0-denial-matrix/20260328T022716Z--firestore-rules-portal-expiry-hardening.log`
  - `.cache/migration-dry-runs/20260328T001210Z--tonicatering--250--dry-run.log`
  - `.cache/migration-dry-runs/20260328T001210Z--tonicatering--250--dry-run.json`
  - `.cache/migration-dry-runs/20260328T022619Z--tonicatering--250--portal-ms-dry-run.log`
  - `.cache/migration-dry-runs/20260328T022619Z--tonicatering--250--portal-ms-dry-run.json`
  - `.cache/migration-runs/20260328T001919Z--tonicatering--250--apply.log`
  - `.cache/migration-runs/20260328T001919Z--tonicatering--250--apply.json`
  - `.cache/migration-runs/20260328T022640Z--tonicatering--250--portal-ms-apply.log`
  - `.cache/migration-runs/20260328T022640Z--tonicatering--250--portal-ms-apply.json`
- Remaining P0 rollout item: deploy hardened portal rules to production and attach post-deploy smoke evidence.

## Notes

- Canonical status ownership is defined in [docs/DOC_SYSTEM.md](docs/DOC_SYSTEM.md).
- Launch operations guidance now lives in [docs/LAUNCH_RUNBOOK.md](docs/LAUNCH_RUNBOOK.md).
- Release-only branch and rollback policy live in [docs/VERSION_CONTROL.md](docs/VERSION_CONTROL.md).
- Backlog prioritization is tracked in [DEV_TASKS.md](DEV_TASKS.md).
