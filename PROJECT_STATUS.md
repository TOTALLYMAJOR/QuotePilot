# Project Status

Last updated: July 27, 2026

## Operational Health
- Runtime: the public custom domain (`https://quotepilot.mbmapps.com`) is aliased to Vercel production deployment `dpl_AsPnyL3M8o5rF8GUSMgJ8HvZWmRh`, which reached `READY` on July 27, 2026. Hosted HTTP checks returned the QuotePilot application shell with status `200` at `/`, `/app`, and `/system`. Firebase Hosting remains the origin/fallback (`https://tonicatering.web.app`).
- Current branch product identity: install metadata, runtime defaults, proposals, integration messages, and onboarding links use QuotePilot/MBMapps branding; the legacy Firebase project ID and hosting origin remain unchanged infrastructure identifiers.
- Build and local validation: the stable combined runtime passes 219 unit
  tests and 33 focused Firestore rules tests. The provisioning emulator
  acceptance matrix, the authoritative owner/customer browser acceptance test (1/1),
  organization-scoped provisioning UI tests (7/7), and the unscoped
  platform-admin provisioning UI test (1/1) also pass. This is local/emulator evidence,
  not hosted tenant acceptance.
- Test coverage: unit + Playwright smoke suites are configured in CI.
- Current branch workflow delivery: proposal readiness, Good/Better/Best scenarios, quote lifecycle timelines, lead follow-ups, sensitive-action approval requests, the customer decision center, and event production checklists are implemented and locally covered.
- Production marketing delivery: a hospitality-first prospect page is live at `/`, the prior dark product overview is live at `/system`, and the authenticated workspace resolves at `/app`; customer portal query routes retain precedence in the client router.
- Current branch tenant onboarding delivery: admin-only Import Studio supports tenant-locked CSV preview/import for customers, packages, add-ons, rentals, and menu items, with duplicate skipping, receipts, and rollback limited to records stamped by the import batch.
- Current release-candidate provisioning hardening adds verified-email,
  role-document, and allowlist-backed platform authority; explicit plan/create
  confirmation; atomic collision-safe creation; seven-day owner invitations;
  an explicit active organization lifecycle; blank catalog and neutral
  unapproved pricing defaults; conflict-safe catalog saves; trusted atomic
  server-priced quote creation and edits; admin-only safe reopen; callable-only
  quote/portal cleanup; exact-order resume; a durable email-dispatch lease; a
  separate entitlement-only mode; preview-only CLI behavior; owner claims
  repair; deletion tombstones; and atomic terminal portal decisions across both
  quote copies. Until the coordinated production deployment is verified, these
  Functions/frontend changes do not have hosted tenant-acceptance proof.
- Controlled Functions CI deploys now materialize an ignored project
  environment only after validating the canonical `/app` URL, platform-admin
  allowlist, approved QuotePilot sender identity, Stripe secrets, and
  credentials for any explicitly enabled provider. The workflow remains gated
  by `ENABLE_FUNCTIONS_DEPLOY=false` by default.
- Current branch tenant identity fix: explicit blank tenant logo/contact/address/crew values no longer fall back to the legacy customer profile, and Catalog Admin branding edits retain their draft through parent rerenders with persistent save/discard affordances.
- Current branch tenant authorization hardening: Firestore denies unverified
  email authority and conflicting claim/role organization scopes, permits
  tenant-domain mapping changes only for same-organization admins, and keeps
  commercial entitlements server-owned. Direct quote and portal deletion is
  denied, sales status authority is limited to an exact draft-to-sent
  transition, and sales schedule writes are limited to non-evidentiary
  staff/checklist fields.
- Current branch provider authorization hardening: outbound quote email, owner
  SMS, payment requests, checkout creation, provider status, and provider tests
  require the current authoritative admin role. Disabled providers reject and
  omit retained credentials. Browser CRM networking is disabled; admins can
  record organization-scoped integration audit events without an outbound send.
- Workflow authority boundaries: approval resolution does not execute a sensitive action; customer acceptance does not prove payment or booking; production checklist completion does not prove inventory availability.
- CI gates: classifier-driven lane gates are configured (`lane:quick`, `lane:core`, `Docker Build Smoke`, `lane:playwright-smoke`, `lane:firebase-auth-rules`, `lane:authoritative-pricing`, `lane:cwv-smoke`).
- P0 fallback-retirement safeguard: classifier now elevates `menuService`/`useCatalogData`/`organizationService`/`OrganizationContext` edits to `high_risk`, so Firebase heavy lanes are required (not advisory) on feature branches.
- Legacy global runtime fallback retired: frontend tenant data services and authoritative pricing/functions paths now fail closed when org context is missing instead of reading legacy global collections.
- Firestore policy hardening: retired global business collections (`catalog*`, `pricing/settings`, `eventTypes`, `menu*`, `quotes`, `quoteHistory`) are now denied in rules so org-scoped paths are authoritative.
- P0 denial evidence captured: focused Firestore emulator matrix now documents same-org allow + wrong-org deny behavior for org-scoped quote/catalog write paths.
- Migration dry-run evidence captured for production project/org (`tonicatering` / `250`) under `.cache/migration-dry-runs/` with structured totals (`wouldCreate=468`, `wouldPatch=20`).
- Production migration execution evidence captured for project/org (`tonicatering` / `250`) under `.cache/migration-runs/` with structured totals (`source=496`, `created=1`, `patched=0`).
- Migration operator resilience: `scripts/migrate-to-multi-tenant.mjs` supports
  Firestore REST execution when ADC credentials are unavailable, defaults to a
  read-only dry run, requires explicit project/organization scope, and requires
  an exact confirmation token before apply mode.
- Portal token rule hardening is implemented and emulator-validated: portal snapshot reads/status updates now require active (non-deleted + non-expired) snapshots at the Firestore rule layer.
- Portal snapshot expiry-ms backfill was executed for production org `250` (`customerPortalQuotes patched=2`) to preserve existing portal-link behavior under hardened rules.
- Legacy quote safety: Firebase writes no longer copy legacy global quote data
  into an organization during mutation. Direct quote creation is denied by
  Firestore rules, trusted Functions create and edit canonical drafts
  atomically with their portal/version records, and existing write/version
  flows require the org-scoped quote target to exist. Admin-only reopen rejects
  accepted, declined, booked, paid, or refunded evidence.
- E2E operational safety: Firebase browser lanes use an isolated emulator
  configuration and dedicated ports; they fail on a port conflict rather than
  terminating unrelated local processes.
- Firebase hosting target safety: the primary deploy scripts and workflow bind
  the `app` target to the `tonicatering` site before deploying `hosting:app`.
- Functions emulator compatibility: `functions.config()` v7 removal path now degrades safely to environment values instead of throwing at runtime.
- Deploy gate: production deployment is manual-only and requires a clean
  `main` commit that matches local upstream and `origin/main`, has a semantic
  release tag published to `origin`, and has completed the required CI/UAT
  evidence.
- Delivery controls: canonical doc ownership and governance checks are now enforced in CI.
- Commerce resilience: Twilio SMS failures are non-blocking for quote save and Stripe checkout.
- Buyer onboarding: admin-only Integrations Ops includes an in-app setup assistant for optional Twilio configuration.
- Production guardrail: `ENABLE_FUNCTIONS_DEPLOY=false` (default locked state).
- Production fail-safe integration mode:
  `NOTIFICATIONS_SMS_PROVIDER=none` in the ignored project-scoped Functions
  environment.
- Latest Vercel production operation: SPA rewrite hotfix restoring direct `/app` and `/system` requests on the custom domain.
- Last known good Firebase Hosting deploy:
  - commit: `a4a2568f06eaedcf9805c503bb161d2847d12710`
  - CI run: `CI Quality` #23203096351 (March 17, 2026 UTC)
  - workflow run: `Deploy Firebase Hosting (+ Optional Functions)` #23203174267 (March 17, 2026 UTC)

## Active Risks
- The live Vercel SPA rewrite was deployed from an isolated hotfix based on
  commit `3a9918910bf1bb224cf0b92d5061d0359107a7b9`; the release-candidate source
  now contains the matching route and runbook changes, but the next production
  promotion still needs exact committed-revision verification.
- The Vercel deployment and custom-domain alias are provider-verified, but the authenticated production quote/save/export workflow still needs post-release browser acceptance.
- Provisioning hardening is release-candidate implementation only. Do not treat the
  in-app preflight, verified-owner activation, entitlement-only update path,
  catalog conflict checks, trusted quote creation, CLI safety changes, or
  onboarding checklist as production behavior until the reviewed
  Functions/frontend/rules slice is deployed and exercised with a disposable
  second organization.
- Resend custom-domain sending remains blocked because the account's one included domain slot is occupied by `leaguepilot.us`; adding `quotepilot.mbmapps.com` requires an account upgrade or explicit authorization to remove/migrate the existing domain, followed by authoritative DNS verification. The production custom-domain sender remains disabled. An external, manual Resend dashboard sandbox message from `QuotePilot by MBMapps <onboarding@resend.dev>` was provider-accepted and recorded as delivered (`34deea9f-8a1c-47ce-8f4e-2ea5164a2eec`), but that address is not an allowed QuotePilot Functions configuration and the result is not custom-domain or recipient-inbox proof.
- Import Studio and its `importBatches` Firestore rules are implemented locally but are not deployed or hosted-smoke-verified. Excel intake, merge/update policies, saved import history UI, and active quote/payment/contract/booking imports are intentionally not included in this first slice.
- The new `portalDecision` Firestore rule changes and enriched portal snapshots are implemented locally but are not deployed or hosted-smoke-verified in this branch.
- Approval requests are role-gated in the application workflow, but stronger server-authoritative action-specific enforcement and end-to-end audit linkage remain follow-up work.
- Existing portal snapshots need refresh/backfill before older links can display every newly added event, selection, and pricing field.
- Firestore production hardening is in active P0 execution; fallback retirement, denial evidence, migration execution, and portal hardening implementation are complete, but production rollout of updated portal rules is not complete yet.
- Bundle size remains a watch item; budget/CWV gates now prevent uncontrolled regressions.
- Functions integrations (Stripe, Twilio, and Resend) remain optional and require secure runtime configuration plus provider-level acceptance/delivery proof; committed placeholder templates are not provider configuration.
- CRM outbound synchronization is intentionally disabled until a
  server-authorized connector with provider acceptance evidence is implemented.
- Staging sign-off routine must be re-established to keep `main` release-only under higher delivery velocity.

## Current Focus (Near-Term)
1. Commit and review the locally validated provisioning hardening slice, then
   perform a controlled rules/Functions/frontend deployment and the hosted
   owner/quote/portal tenant acceptance checklist.
2. Verify the intended Resend sender domain in the Resend dashboard and authoritative DNS; only then configure `onboarding@quotepilot.mbmapps.com` and capture accepted, delivered, and recipient proof from one controlled test.
3. Publish the Vercel SPA rewrite hotfix through normal version control.
4. Deploy the updated `firestore.rules` and run hosted portal decision smoke checks, including active, expired, deleted, and change-request paths.
5. Refresh/backfill existing customer portal snapshots with the new customer-safe event and pricing fields.
6. Add server-authoritative enforcement and audit linkage for approval-request-to-admin-action execution.
7. Re-establish staging sign-off workflow before broadening merge velocity into `main`.
8. Improve large-chunk performance while staying inside bundle/CWV guardrails.

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
