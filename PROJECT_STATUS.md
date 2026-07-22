# Project Status

Last updated: July 22, 2026

## Operational Health
- Canonical public URL: `https://quotepilot.mbmapps.com`; application defaults now use this host. The custom-domain hosting/DNS cutover is not yet verified live.
- Platform identity: QuotePilot by MBMApps is the product identity; Tasteful Touch Catering remains a customer organization with its own persisted branding and organization-scoped admin role.
- Build: `npm run build` passes locally for this branch.
- Test coverage: unit + Playwright smoke suites are configured in CI.
- Current branch workflow delivery: configurable package bundles, organization-scoped customer records, four branded portal themes with logo support, quote-scoped customer/staff chat, proposal readiness, Good/Better/Best scenarios, lifecycle timelines, lead follow-ups, the customer decision center, and event production checklists are implemented and locally covered.
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
- Portal chat rules are emulator-validated: customers may append customer messages only through an active bearer link; staff replies require same-organization authorization; messages are immutable.
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
- The checked local Firebase configuration files still contain placeholders. Real Firebase Web App values must be supplied through ignored `.env.local` files and the hosting provider before hosted verification or deployment.
- `quotepilot.mbmapps.com` currently resolves outside Firebase Hosting and did not complete a TLS request during the July 22 verification. It must be attached to the selected hosting project, given valid TLS, and authorized in Firebase Authentication before it is declared live.
- The new `portalDecision` Firestore rule changes and enriched portal snapshots are implemented locally but are not deployed or hosted-smoke-verified in this branch.
- Package bundles, customer record upserts, portal themes/logo snapshots, and portal chat are local branch capabilities only until their app and Firestore rule changes are deployed together.
- Approval requests are role-gated in the application workflow, but stronger server-authoritative action-specific enforcement and end-to-end audit linkage remain follow-up work.
- Existing portal snapshots need refresh/backfill before older links can display every newly added event, selection, and pricing field.
- Firestore production hardening is in active P0 execution; fallback retirement, denial evidence, migration execution, and portal hardening implementation are complete, but production rollout of updated portal rules is not complete yet.
- Bundle size remains a watch item; budget/CWV gates now prevent uncontrolled regressions.
- Functions integrations (Stripe/Twilio) remain optional and require secure runtime configuration.
- Staging sign-off routine must be re-established to keep `main` release-only under higher delivery velocity.

## Current Focus (Near-Term)
1. Deploy the updated app and `firestore.rules` together, then run hosted portal decision/chat smoke checks, including active, expired, deleted, cross-org, and change-request paths.
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
