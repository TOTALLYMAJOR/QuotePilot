# Changelog

All notable project changes are documented in this file.

This changelog is backfilled from git history and will be maintained going forward.

## [Unreleased]

### Added

- Hospitality-first QuotePilot landing page at `/`, adapted from the approved Magic Patterns direction with original catered-event imagery, real QuotePilot interfaces, proof-safe quote-to-event language, responsive and dark layouts, restrained reveal motion, and reduced-motion support.
- Durable landing-page design brief at `marketing/LandingPage.md`, including customer, copy, route, asset, preservation, and acceptance criteria.
- Saved dark QuotePilot product overview at `/system`, including its six-capability feature drawer, animated workflow map, real app screenshots, keyboard focus containment, and full-screen mobile layout.
- Admin-only Import Studio for tenant-locked customer and catalog CSV intake, automatic record/field recognition, row validation, duplicate-safe create behavior, persistent import receipts, and batch-scoped rollback.
- Admin-only customer-provisioning preflight, explicit new-organization confirmation, and a separate existing-organization entitlement-only update mode with auditable order records and operator acceptance guidance.
- Placeholder-only Firebase Functions environment template (`functions/.env.example`) for app, auth, Resend, Twilio, and Stripe runtime settings; real provider values remain excluded from tracked files.
- Fail-closed Firebase Functions environment materializer for controlled CI deploys; it validates the canonical `/app` URL, platform-admin allowlist, approved QuotePilot sender identity, and provider-specific requirements before writing an ignored project environment file.
- Emulator-only owner-onboarding and quote-acceptance matrix covering platform authority, verified-email invite activation, neutral tenant setup, reviewed pricing, quote readback, public acceptance, entitlement preservation, inactive/archive denial, cleanup, and tombstone enforcement.

- Proposal readiness scoring in the review step and Sales Workflow, with weighted completion criteria and actionable readiness gaps.
- Good/Better/Best quote scenarios with comparable package totals and one-click application back into the wizard.
- Sales Workflow workspace with lead follow-up stages, due dates, notes, completion state, quote lifecycle timelines, and an admin resolution queue for sensitive-action approval requests.
- Customer Proposal Decision Center with event scope, itemized pricing, payment state, and explicit accept/request-changes/decline decisions.
- Event production checklist for accepted/booked events with persistent completion state across planning, kitchen, logistics, team, service, and closeout tasks; the checklist does not represent inventory availability.
- Focused unit, Firestore rules, and Playwright coverage for workflow persistence, portal change requests, quote scenarios, and production checklist updates.
- Mainline safety-net workflow (`.github/workflows/mainline-safety-net.yml`) that auto-reverts failed `main` push head commits after `CI Quality` failure when the failing SHA is still current `main`.
- Cloud/local orchestration blueprint and runbook docs (`docs/ORCHESTRATION_BLUEPRINT.md`, `docs/ORCHESTRATION_RUNBOOK.md`) defining 4-layer control model, lane taxonomy, risk elevation policy, and PR evidence requirements.
- CI lane classifier script (`scripts/ci-lane-classifier.mjs`) that computes docs-only/high-risk state, change intent hints, tenant impact, and recommended lanes from changed paths.
- Shared orchestration lane runner (`scripts/orchestration-lanes.sh`) and npm lane entrypoints (`lane:quick`, `lane:core`, `lane:firebase-auth-rules`, `lane:authoritative-pricing`, `lane:release`).
- PR change-intent contract fields and lane evidence checklist in `.github/PULL_REQUEST_TEMPLATE.md`.
- Preview-only customer onboarding request script (`scripts/provision-customer-order.mjs`) with explicit tenant/order identity, plan/feature selection, and create-only draft handoff generation; live provisioning remains server-authoritative.
- Server-side onboarding callable (`provisionCustomerOrder`) in Cloud Functions to centralize customer provisioning logic, apply feature entitlements, store `provisioningOrders` audit records, and optionally send onboarding email.

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
- Portal token hardening with explicit token issue/expiry fields (`portalIssuedAtISO`, `portalExpiresAtISO`), admin-only portal key rotation action, and portal expiry enforcement in customer portal status/read paths.
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

- Firestore tenant seeding now defaults to a read-only preview, requires explicit
  project and organization scope, and requires an exact scope-bound
  confirmation before apply. Apply validates an existing non-retired tenant,
  uses collision-safe creates, and limits existing-menu patches to missing
  schema fields instead of replacing records.
- Production Firebase deploys are now manual-only and route through one
  fail-closed wrapper that requires a clean remotely published and semantically
  tagged `main` commit, an exact scope confirmation, the canonical Firebase
  project, a fresh frontend build, and validated ignored Functions
  configuration. Functions deploys include the matching Firestore rules.
- Vercel production deploys now require the same clean, published,
  semantically tagged `main` revision and run the production environment check
  before building, preventing E2E bypass, emulator, or local-fallback flags
  from being promoted.
- The production environment check now uses only Node built-ins so the
  dependency-free CI preflight can validate canonical Firebase settings and
  unsafe flag overrides before package installation.
- Local Firebase environment generation now writes only `.env.local`, refuses
  to overwrite an existing file by default, and requires an explicit
  project-scoped confirmation for replacement. Development catalog fallback is
  also disabled unless `VITE_ALLOW_LOCAL_CATALOG_FALLBACK` is explicitly
  enabled.
- Claims synchronization now rejects Auth users that do not have an
  authoritative role document. Provider templates keep credentials blank, and
  the configured Resend sender is described as approved-but-disabled until
  provider and DNS verification are complete.
- Outbound email, SMS, Stripe checkout, payment-request, provider-status, and
  provider-test callables now require the current authoritative admin role;
  sales users retain proposal preparation but cannot invoke provider actions.
- Disabled email and SMS providers now reject retained provider credentials,
  and generated Functions environments omit those secret fields entirely.
- Resend configuration now uses only the approved
  `QuotePilot by MBMapps <onboarding@quotepilot.mbmapps.com>` identity and stays
  disabled until that exact domain has provider, DNS, delivery, and inbox proof.
- Browser-originated CRM network sends are disabled. Admins may record scoped
  integration audit events while a server-authorized connector is pending.
- The local customer-provisioning CLI is now preview-only; live `--apply` writes are rejected so the legacy sequential path cannot leave a partial tenant or recreate retired state.
- Server-side provisioning now derives platform-admin authority from the
  current admin role document, the matching authenticated email, and the exact
  configured platform-admin allowlist; stale token claims and broad cross-org
  switches cannot elevate access. Tenant admins cannot create tenants, change
  paid entitlements, or archive/delete organizations.
- Staff and customer organization authority now requires a verified Firebase
  Auth email. Owner registration sends a verification message, pending owner
  invitations receive a bounded seven-day expiry, and organization bootstrap
  does not consume an invitation until the exact invited email is verified.
- New-tenant creation uses the requested organization and an intentionally
  blank catalog plus neutral zero-valued fee, tax, deposit, travel, and staffing
  settings instead of seeding sellable records or historical commercial
  defaults. It uses atomic create/precondition semantics, and an exact replay
  resumes only after the organization, settings, owner access, and expected
  catalog artifacts still match.
- Newly provisioned organizations persist an explicit active lifecycle, and
  the browser no longer synthesizes hard-coded products for an empty Firebase
  catalog. Quote creation stays locked until an organization admin saves at
  least one named package priced above zero, adds an event type, and explicitly
  approves the tenant's pricing setup.
- Catalog saves now patch only locally changed records and settings inside a
  transaction, compare the loaded server fingerprints before overwriting or
  deleting anything, reject duplicate identifiers and stale edits, and reload
  the authoritative catalog after a successful save.
- Authoritative pricing now rejects unreviewed tenant pricing and preserves
  explicit empty rate/tier/region/season arrays instead of reviving historical
  defaults. Direct Firestore quote creation is denied; Firebase quote create and
  duplicate paths now use trusted Functions that re-price from the current
  tenant catalog, ignore client totals/pricing/ownership/record identities and
  deposit links, generate canonical identities server-side, and atomically
  create the draft quote, portal snapshot, and initial version. Persisted
  presentation fields are bounded, and CRM endpoint/auth secrets are excluded.
- Firebase quote edits now use the same trusted server-pricing boundary and
  atomically update the quote and portal projection while creating the next
  immutable version. Draft, sent, and viewed quotes with no terminal commercial
  evidence may be edited; accepted, declined, booked, paid, and refunded
  evidence cannot be overwritten.
- Quote reopen is now an admin-only callable for expired or legacy
  `status=deleted` records with a matching nonterminal active version. It
  rejects terminal decision/payment/booking evidence, rotates the portal
  identity, and writes a new version atomically; permanently deleted records
  cannot be reopened.
- Existing-organization updates must be explicitly selected in-app and are limited to plan entitlements plus a new provisioning audit order; owner identity, branding, catalog data, invitations, and onboarding email state remain unchanged.
- New-owner onboarding requires an explicit plan, validated email, and canonical read-only `/app` URL; claims failures block handoff and email delivery until the canonical repair callable succeeds, while starting the next tenant immediately clears the prior handoff from screen and session storage.
- Authoritative platform administrators without an organization scope now enter a dedicated `/app` customer-provisioning shell; tenant catalog, integration setup, quote activity, CRM, and organization-cleanup surfaces remain unavailable until the operator enters an organization-scoped workspace.
- Optional Resend sends acquire a durable, expiring dispatch lease before the
  provider call, use an order-scoped idempotency key, block concurrent retry
  sends, and transactionally preserve accepted, failed, disabled, and
  audit-persistence outcomes without rewriting an original sent timestamp on
  replay.
- Customer portal decisions now batch the public snapshot and organization
  quote atomically. Firestore requires matching post-write decision state on
  both documents, rejects a terminal decision without a fresh structured
  decision, and prevents accepted/declined quotes from being flipped later.
- Missing SMS-provider configuration now fails closed to `none` instead of
  selecting Twilio implicitly.
- Firebase browser test configuration accepts isolated Auth and Firestore
  emulator ports so authoritative lanes can run without disturbing unrelated
  local services. The runners use their own E2E config and fail on a port
  conflict instead of killing another process.
- Organization hard delete immediately tombstones the tenant, retires authoritative role assignments and invitations, removes tenant domains and public portal snapshots, and prevents later sign-in or stale claims from restoring access.
- Vercel's SPA catch-all now targets `/` when `cleanUrls` is enabled, restoring direct HTTP access to `/app` and `/system` while retaining the client-side route split.
- Public-route handoff now keeps `/` prospect-focused, lazy-loads the previous landing at `/system` and the authenticated workspace at `/app`, and gives customer `?portal=` links precedence over both marketing surfaces.
- Rebranded install metadata and customer-visible runtime fallbacks from the legacy catering identity to QuotePilot by MBMapps, including proposal/email/SMS defaults, neutral staff labels, the QuotePilot favicon, and custom-domain onboarding/payment links; corrected Vite environment/public-asset paths so the project-local `.env`, manifest, favicon, and service worker are included correctly.
- Firestore tenant authorization now rejects conflicting custom-claim and role-document organization scopes, while tenant-domain mapping writes are explicitly limited to same-organization admins.
- Tenant branding/contact normalization now preserves intentional blank logo, crew, phone, email, and address values instead of restoring the legacy customer defaults; custom tenants with missing legacy color fields receive neutral appearance defaults. Catalog Admin also keeps edits stable during parent rerenders, shows an always-visible save control and unsaved state, and warns before discarding changes.
- Customer portal snapshots now include customer-safe event scope, pricing breakdowns, selection labels, payment state, and decision receipts; Firestore portal patches remain constrained to allowed status and portal-decision fields.
- Sensitive-action approval resolution records admin intent without executing payment, contract, portal-link, or deletion actions; those actions remain separate admin operations.
- Quote History now uses the authenticated staff role to hide payment, booking, portal rotation, contract conversion, reopen, and delete controls from sales users while preserving proposal preparation. Sales can make only an exact draft-to-sent status transition and non-evidentiary schedule updates (staff lead, assignment time, kitchen checkpoints, and production checklist).
- `CI Quality` workflow now uses classifier-driven lane orchestration, branch concurrency cancellation, hard-vs-advisory heavy lane behavior, and artifact retention windows for failure triage.
- CI lane classifier now treats fallback-retirement-sensitive org/fallback modules (`src/lib/menuService.js`, `src/hooks/useCatalogData.js`, `src/lib/organizationService.js`, `src/context/OrganizationContext.jsx`) as high-risk, making Firebase heavy lanes required (non-advisory) on feature branches.
- Production deploy automation now requires controlled manual dispatch after
  the main-branch quality gates and published release tag are complete.
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
- Completed the parallel migration rollout: Firestore-backed event menus (`eventTypes/menuCategories/menuItems`), quote-history filtering, immutable menu snapshots, and pre-mutation version history in `quoteHistory`.
- Finalized menu cutover to Firestore-backed event menus by removing wizard/runtime fallback to static `DEFAULT_MENU_SECTIONS` and retiring the legacy static menu editor in Admin Catalog.
- Added admin-configurable labor rate types (bartender + staffing), with quote-time manual override support and persisted applied-rate snapshots in quote data.
- Added quote-history Edit workflow that reloads quotes into the wizard and updates the same quote with pre-save version snapshots plus labor-rate lock snapshots.
- Expanded Admin Catalog "Menu Management" editability so event types and categories can be renamed directly (item name/type/price editing remains supported).
- Event schedule cards now surface contract number and confirmation state for accepted/booked events.
- Fixed header crew chip spacing so staff image/name badges no longer overlap the brand text on narrower desktop widths.
- Production deploy workflow is manual-only after successful `CI Quality`,
  UAT evidence, and publication of the exact release tag.
- Primary Firebase deploy scripts and the production workflow now explicitly
  bind the `app` Hosting target to site `tonicatering` before deploying
  `hosting:app`, preventing an ambiguous default-site deployment.
- Standardized production safety controls: `ENABLE_FUNCTIONS_DEPLOY=false`
  default and fail-safe project-scoped SMS runtime environment
  (`NOTIFICATIONS_SMS_PROVIDER=none`).
- Added explicit release gate policy requiring green CI + 10-minute UAT + rollback SHA confirmation for production-triggering merges.
- Updated `@vitejs/plugin-react` to a Vite 7 compatible major version so `npm ci` succeeds for CI and container builds.
- Added invite-aware organization bootstrap in Cloud Functions (`organizationInvites`) so pre-authorized customer emails are granted org role/access automatically on first sign-in.
- Provisioning audit writes are owned by the server callable; the local preview
  script performs no Firebase or provider mutation.
- Customer provisioning now keeps neutral white-label branding/contact fields
  but starts the catalog blank; operators must configure or import reviewed
  pricing before quote acceptance.
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
- Added callable integration setup status + SMS test endpoints for admin-only buyer onboarding checks.
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
- Removed legacy global quote auto-migration from write/version operations;
  Firebase mutations now require the org-scoped quote target to exist instead
  of copying global data during a user write.
- Admin Catalog `Optional Modules` controls now enforce order entitlements: every module is visibly read-only while order entitlements are locked, and modules not included in the order remain off.
- Improved operator clarity for entitlement workflows:
  - Admin Catalog `Optional Modules` now shows per-feature `Included in order (read only)` vs `Not included in order (read only)` status text and routes all entitlement changes through customer provisioning.
  - User manual now includes a step-by-step no-Stripe provisioning runbook for new-customer setup and existing-customer feature entitlement updates.
- Retired local numeric org/order guessing, catalog seeding, Admin SDK writes,
  and REST write fallback from the provisioning CLI. Preview now requires exact
  organization and order identifiers and refuses to overwrite an existing
  email draft.
- Retired legacy global catalog/quote fallback behavior across frontend services (`useCatalogData`, `menuService`, `quoteStore`) and authoritative pricing/functions codepaths (`pricingEngine`, `readQuoteOrThrow`), with strict org-required fail-closed behavior for Firebase tenant reads/writes.
- Firestore Rules now explicitly deny retired legacy global business collections (`catalog*`, `pricing/settings`, `eventTypes`, `menu*`, `quotes`, `quoteHistory`) so tenant business access is org-scoped by policy.
- Updated Cloud Functions config loading to safely handle `firebase-functions` v7 `functions.config()` removal by falling back to environment variables instead of throwing in runtime call paths (including `notifyOwnerNewQuote`).
- `scripts/migrate-to-multi-tenant.mjs` supports Firestore REST fallback when
  ADC credentials are unavailable and now defaults to read-only: project and
  organization scope are required, while apply mode additionally requires an
  exact confirmation token.
- `customerPortalQuotes` Firestore rules are now hardened to require active snapshots (`status != "deleted"` and `portalExpiresAtMs > request.time.toMillis()`) for portal reads/status updates and quote portal status patches.
- Portal snapshots now include `portalExpiresAtMs` from `quoteStore` to support rule-level expiry enforcement for newly written portal records.
- Migration backfill now patches missing `portalExpiresAtMs` for existing `customerPortalQuotes` records (in addition to `organizationId`) and uses safer REST pagination/token-refresh behavior under Firebase CLI auth fallback.
- Added Firestore rules emulator coverage for portal token hardening (active token allow, expired/deleted deny, and quote status patch gating through active portal snapshots).
- Captured P0 hardening evidence artifacts for production migration readiness:
  - Cross-org denial emulator matrix log (`.cache/p0-denial-matrix/20260328T001230Z--firestore-rules-cross-org-denial.log`)
  - Migration dry-run log/json (`.cache/migration-dry-runs/20260328T001210Z--tonicatering--250--dry-run.log`, `.cache/migration-dry-runs/20260328T001210Z--tonicatering--250--dry-run.json`)
- Captured portal-rule hardening rollout evidence:
  - Portal hardening emulator matrix log (`.cache/p0-denial-matrix/20260328T022716Z--firestore-rules-portal-expiry-hardening.log`)
  - Portal expiry-ms backfill dry-run log/json (`.cache/migration-dry-runs/20260328T022619Z--tonicatering--250--portal-ms-dry-run.log`, `.cache/migration-dry-runs/20260328T022619Z--tonicatering--250--portal-ms-dry-run.json`)
  - Portal expiry-ms backfill apply log/json (`.cache/migration-runs/20260328T022640Z--tonicatering--250--portal-ms-apply.log`, `.cache/migration-runs/20260328T022640Z--tonicatering--250--portal-ms-apply.json`)
- Executed production migration for org `250` with evidence capture:
  - Apply log/json (`.cache/migration-runs/20260328T001919Z--tonicatering--250--apply.log`, `.cache/migration-runs/20260328T001919Z--tonicatering--250--apply.json`)
  - Totals: `source=496`, `created=1`, `patched=0`
- Simplified quote staffing to direct manual role controls in Event Basics (servers, chefs, bartenders) with clear default-vs-override labeling in admin pricing settings and live count visibility in the quote breakdown.
- Added per-role mixed-rate CSV support for servers and chefs (`serverRateMixCsv`, `chefRateMixCsv`) so labor can apply different rates per staff member in live totals and proposal payload/PDF output.
- Added quote-level dietary restrictions and editable kitchen checkpoint overrides with schedule persistence (`booking.kitchenCheckpoints`) and schedule card rendering support.
- Added canonical menu template enforcement utilities (`src/data/canonicalMenuTemplate.js`, `src/lib/menuCanonicalSync.js`) and admin menu flows that keep event-type menus synchronized to the same canonical dataset.
- Replaced quote-history status-only deletion with admin callable hard delete
  (`hardDeleteQuote`) plus org-scoped purge support for legacy
  `status=deleted` records (`purgeDeletedQuotesForOrganization`). Firestore
  denies direct quote and portal deletes; the callables own recursive quote,
  version, and portal cleanup.

### Fixed

- Customer provisioning no longer silently substitutes the signed-in administrator's UID when the Owner UID field is blank; assigning the operator's own account now requires the explicit `Use My Account` action.
- Customer portal date-only event values now render in local time without shifting to the previous calendar day.
- Quote store unit fixtures now pin their intended validation date so portal-expiry and quote-expiry assertions remain deterministic over time.

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
