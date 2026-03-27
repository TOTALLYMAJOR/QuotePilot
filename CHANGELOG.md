# Changelog

All notable project changes are documented in this file.

This changelog is backfilled from git history and will be maintained going forward.

## [Unreleased]

### Added

- Mainline safety-net workflow (`.github/workflows/mainline-safety-net.yml`) that auto-reverts failed `main` push head commits after `CI Quality` failure when the failing SHA is still current `main`.
- Cloud/local orchestration blueprint and runbook docs (`docs/ORCHESTRATION_BLUEPRINT.md`, `docs/ORCHESTRATION_RUNBOOK.md`) defining 4-layer control model, lane taxonomy, risk elevation policy, and PR evidence requirements.
- CI lane classifier script (`scripts/ci-lane-classifier.mjs`) that computes docs-only/high-risk state, change intent hints, tenant impact, and recommended lanes from changed paths.
- Shared orchestration lane runner (`scripts/orchestration-lanes.sh`) and npm lane entrypoints (`lane:quick`, `lane:core`, `lane:firebase-auth-rules`, `lane:authoritative-pricing`, `lane:release`).
- PR change-intent contract fields and lane evidence checklist in `.github/PULL_REQUEST_TEMPLATE.md`.

- Firebase emulator browser smoke lane (`npm run test:e2e:firebase`) with seeded auth/org fixtures for real Auth + Firestore rules validation.
- Firebase authoritative browser smoke lane (`npm run test:e2e:firebase:authoritative`) that starts Functions emulator and validates authoritative pricing callable behavior in save flow.
- Runtime helper scripts for local test reliability:
  - `scripts/run-playwright.sh`
  - `scripts/ensure-playwright-linux-libs.sh`
  - `scripts/ensure-local-jre.sh`
  - `scripts/run-firebase-e2e.mjs`
  - `scripts/run-firebase-e2e-authoritative.mjs`
  - `scripts/run-firebase-e2e-inner.sh`
  - `scripts/seed-e2e-emulator-user.mjs`
- Customer-site Firebase Hosting deploy helper script (`scripts/deploy-hosting-customer.mjs`) for per-customer site deployments via a reusable `customer` target.
- Non-markdown secret asset scanner (`scripts/check-secret-assets.mjs`) with high-confidence token/private-key detection and placeholder-aware hardcoded key checks.
- GitHub security policy (`.github/SECURITY.md`) with private advisory reporting path and secret-handling response targets.
- Dependabot configuration (`.github/dependabot.yml`) for weekly npm and GitHub Actions dependency update PRs.
- Playwright quote-history booking scenarios for conversion/confirmation edge paths, including booked-conflict conversion blocking.
- Portal token hardening with explicit token issue/expiry fields (`portalIssuedAtISO`, `portalExpiresAtISO`), staff-driven portal key rotation action, and portal expiry enforcement in customer portal status/read paths.
- VS Code devcontainer config (`.devcontainer/devcontainer.json`) for isolated development using the existing Docker Compose `web-dev` service.
- End-user operations guide for staff/admin workflows (`docs/USER_MANUAL.md`).
- Global event-type context provider for cross-surface event-type synchronization (wizard + admin).
- Duplicate quote action in Quote History, creating new draft quotes with copied snapshots and pricing details.
- Booking workflow upgrades: availability-aware proposal-to-contract conversion and confirmation tracking in quote history.
- Firestore dynamic menu seed script (`scripts/seed-firestore-menu.mjs`) and npm entrypoint (`seed:menu:firestore`) for idempotent creation of `eventTypes`, `menuCategories`, and `menuItems`.
- Unit tests for booking conversion and confirmation lifecycle in local fallback mode.
- Visual snapshot tests covering Event/Menu/Review wizard states and the proposal sheet output.
- Session diagnostics module with runtime error capture (`window.error` and `unhandledrejection`) and a staff diagnostics modal with export/clear tools.
- Docker runtime scaffolding with multi-stage `Dockerfile`, `docker-compose.yml`, `.dockerignore`, and nginx SPA config.
- Canonical documentation ownership spec (`docs/DOC_SYSTEM.md`) with update triggers and data ownership matrix.
- Agent governance, performance guardrail docs, and technology exception log.
- Governance enforcement script (`scripts/check-doc-governance.mjs`) and bundle budget gate (`scripts/check-bundle-budget.mjs`).
- Lighthouse CI configuration and bundle baseline file for hard UX/performance gates.
- Wizard UI helper module (`src/lib/wizardUi.js`) with reusable step validation, step-status modeling, event-type template defaulting, and breakdown delta detection functions plus dedicated unit coverage (`src/lib/__tests__/wizardUi.test.js`).

### Changed

- `CI Quality` workflow now uses classifier-driven lane orchestration, branch concurrency cancellation, hard-vs-advisory heavy lane behavior, and artifact retention windows for failure triage.
- CI lane classifier now treats fallback-retirement-sensitive org/fallback modules (`src/lib/menuService.js`, `src/hooks/useCatalogData.js`, `src/lib/organizationService.js`, `src/context/OrganizationContext.jsx`) as high-risk, making Firebase heavy lanes required (non-advisory) on feature branches.
- Deploy workflow guard now explicitly restricts workflow-run deploys to successful `CI Quality` runs from `main` in the same repository context.
- Maintainer and release-manager check scripts now support orchestration lane semantics and high-risk execution profiles.
- Contributor/release/governance docs were updated to align with lane contracts and orchestration policy (`README.md`, `CONTRIBUTING.md`, `docs/VERSION_CONTROL.md`, `docs/DOC_SYSTEM.md`, `docs/AGENT_GOVERNANCE.md`).

- CI quality workflow now runs both Playwright lanes: standard smoke and Firebase emulator smoke (`test:e2e:firebase`).
- CI quality workflow now also runs Firebase authoritative smoke (`test:e2e:firebase:authoritative`).
- CI `Governance + Perf Gates` job now runs `npm run check:secrets` to block committed secrets in scripts/config assets.
- Firebase Hosting config moved to target-based multi-site layout (`app` + `customer`) and default hosting deploy now targets `hosting:app`.
- Production dependency lockfile now resolves `jspdf@4.2.1` to address known critical security advisories.
- `test:e2e` and `test:e2e:headed` now run through a Playwright wrapper that auto-resolves Linux shared-library dependencies.
- Added Firebase client emulator wiring (`auth` + `firestore` + optional functions) for deterministic emulator-backed browser testing.
- Expanded wizard to a 5-step flow (`Event Basics`, `Menu Selection`, `Add-ons / Rentals`, `Pricing Summary`, `Save / Submit`) with sticky live summary and toast feedback.
- Added quantity-aware `per_item` pricing support across menu/add-ons/rentals and quote snapshot persistence (`pricingType`, `quantity`, active-aware filtering).
- Updated Admin Catalog UX to tabbed sections (Packages/Addons/Rentals/Menu/Pricing) with inline menu-item save on blur/Enter and active/pricingType editing.
- Enforced non-dev fail-fast catalog behavior when Firebase is unavailable; local fallback remains development-only.
- Improved proposal PDF image handling with refactored loaders and explicit error logging for failed image fetch/render operations.
- Completed the parallel migration rollout: Firestore-backed event menus (`eventTypes/menuCategories/menuItems`), quote-history filtering, soft delete/reopen controls, immutable menu snapshots, and pre-mutation version history in `quoteHistory`.
- Finalized menu cutover to Firestore-backed event menus by removing wizard/runtime fallback to static `DEFAULT_MENU_SECTIONS` and retiring the legacy static menu editor in Admin Catalog.
- Added admin-configurable labor rate types (bartender + staffing), with quote-time manual override support and persisted applied-rate snapshots in quote data.
- Added quote-history Edit workflow that reloads quotes into the wizard and updates the same quote with pre-save version snapshots plus labor-rate lock snapshots.
- Expanded Admin Catalog "Menu Management" editability so event types and categories can be renamed directly (item name/type/price editing remains supported).
- Event schedule cards now surface contract number and confirmation state for accepted/booked events.
- Fixed header crew chip spacing so staff image/name badges no longer overlap the brand text on narrower desktop widths.
- Production deploy workflow is now gated on successful `CI Quality` completion for `main` pushes, with manual dispatch preserved for controlled operations.
- Standardized production safety controls: `ENABLE_FUNCTIONS_DEPLOY=false` default and fail-safe SMS runtime config (`notifications.sms_provider="none"`).
- Added explicit release gate policy requiring green CI + 10-minute UAT + rollback SHA confirmation for production-triggering merges.
- Updated `@vitejs/plugin-react` to a Vite 7 compatible major version so `npm ci` succeeds for CI and container builds.
- Added a CI Docker smoke check job that runs `docker compose build web` on pushes/PRs.
- Hardened Playwright smoke selectors with exact label matching to avoid `Venue`/`Venue address` strict-mode collisions.
- Updated Playwright history assertion to validate persisted quote row data that is actually rendered (`E2E Staff` and edited guest count).
- Added `Governance + Perf Gates` CI job to enforce doc sync/security/drift checks plus bundle/CWV thresholds.
- Consolidated canonical docs to remove duplicated status/backlog/process narrative across top-level files.
- Replaced legacy go-live content with pointer to canonical launch runbook (`docs/LAUNCH_RUNBOOK.md`).
- Hardened doc governance diff/path parsing and added explicit code/process/deploy/backlog doc ownership enforcement.
- Updated Lighthouse CI to run against `vite preview` on `127.0.0.1` for deterministic smoke checks.
- Ignored local `.lighthouseci/` artifacts to prevent accidental commit noise.
- Adjusted doc secret scanning to allow placeholder credential examples while still failing real token-like values.
- Added callable integration setup status + SMS test endpoints for staff-facing buyer onboarding checks.
- Added in-app `Buyer Setup Assistant (Optional Twilio)` guidance in Integrations Ops with copy-ready config/deploy commands.
- Hardened Twilio delivery so SMS provider errors no longer block core quote save or Stripe checkout workflows.
- Updated Playwright `webServer` configuration to use cross-platform env injection so Windows test runs start correctly.
- Fixed CI Lighthouse Chromium path step quoting so `Governance + Perf Gates` runs cleanly in GitHub Actions.
- Delivered a premium quote-wizard UX overhaul in one frontend pass:
  - Elevated CTA hierarchy with a new hero `Get Instant Quote` primary action, compact header quick-action CTA, and reduced-emphasis secondary nav pills.
  - Refactored Step 1 into accordion groups with progressive disclosure (`Core Event Basics`, `Client Contact`, `Advanced Pricing Overrides`, `Staffing Overrides`) and conditional bartender/staffing override visibility.
  - Added template-driven smart defaults on event-type changes with non-destructive apply rules (empty/default + untouched fields only).
  - Upgraded the stepper to explicit `current/completed/incomplete/locked` states with microcopy, warning treatment, and soft-lock forward gating on Step 1 required fields.
  - Reworked the live breakdown panel into grouped financial dashboard blocks with sticky desktop behavior, animated monetary transitions, and transient row-level delta cues.
  - Improved input ergonomics with guest/bartender steppers, event-hours slider + numeric sync, inline validation feedback, and motion/focus polish honoring `prefers-reduced-motion`.
- Expanded Playwright smoke coverage for the new UX guidance behaviors: Step 1 soft-lock affordance, conditional bartender override visibility, hero CTA continuity, and live breakdown change cues.
- Tuned Vite production chunking with targeted `manualChunks` for React and Firebase vendor code to shrink the largest JS asset and restore bundle-budget gate compliance.
- Restored legacy-global write fallback for menu management mutations when org context is missing, preventing Admin Catalog add/edit/delete menu operations from failing in fallback mode.
- Hardened org-scoped write safety for protected catalog and quote persistence paths by removing legacy global write fallback in `menuService` and `useCatalogData` save flows, and by requiring organization context for Firebase quote mutations in `quoteStore` while preserving legacy read fallback behavior.
- Added legacy quote write auto-migration safeguards in `quoteStore` so legacy global quote docs are copied into org-scoped paths during Firebase write/version operations when org context is available.
- Updated Cloud Functions config loading to safely handle `firebase-functions` v7 `functions.config()` removal by falling back to environment variables instead of throwing in runtime call paths (including `notifyOwnerNewQuote`).

## [2026-03-10]

### Added

- `7a99d13`: Added integration config and sync audit ops modal.

### Changed

- `fe4d60b`: Disabled QuickBooks workflow and kept CRM integration ops active.
- `a942410`: Removed remaining QuickBooks references and aligned docs.

## [2026-03-09]

### Added

- `219fc4d`: Added configurable branding theme and logo upload.
- `7e82941`: Added booking status and submit-time availability checks.
- `1222c4a`: Added schedule calendar modal with month and week views.
- `35a1868`: Enhanced schedule staffing board and conflict checks.

## [2026-03-08]

### Added

- `d628cc4`: Added auth roles, customer portal, and hosting hardening.

## [2026-03-05]

### Changed

- `621057c`: Removed customer card surcharge from quote totals and UI.

## [2026-03-04]

### Changed

- `77c75bc`: Updated branding, quote preview, and PDF export.
- `dd48ef5`: Updated quote wizard content and pricing settings.

## [2026-03-03]

### Added

- `8b858e9`: Added project status summary document.

## [2026-03-02]

### Added

- `d833bfc`: Added professional project README.
- `2a029bc`: Enhanced quote sheet details and added Option 1 deployment scaffolding.

### Changed

- `a6dffbb`: Ignored local Firebase CLI state.

## [2026-02-27]

### Added

- `3b5f902`: Implemented beauty, capability, and configurability upgrades.
- `fa4e6a7`: Added editable menu item pricing to catalog and quote totals.

## [2026-02-26]

### Added

- `1ce0a73`: Initial commit with React Firebase quote wizard and dashboard/history baseline.
- `e062c93`: Added `.env.example` and deployment guides for Vercel/Firebase Hosting.
- `1f219a8`: Added branded header images and gold/black theme.

### Fixed

- `dd35879`: Fixed PDF export by generating downloadable files with jsPDF.
