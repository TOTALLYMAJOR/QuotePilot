# Project Status

Last updated: August 3, 2026

## Operational Health
- Runtime: the public custom domain (`https://quotepilot.mbmapps.com`) is
  aliased to Vercel production deployment
  `dpl_9K7pqmZjqAMBbegKq3uyUf6rGVXv`, built from merged `main` commit
  `dc460e3dca79c0b0eea512bb1902ba20a4b7c67c`; it reached `READY` on August 3,
  2026. Main CI run `30837136091` passed all eight jobs, and hosted HTTP checks
  returned status `200` at `/`, `/app`, and `/system`. Firebase Hosting remains
  the origin/fallback (`https://tonicatering.web.app`).
- Current branch product identity: install metadata, runtime defaults, proposals, integration messages, and onboarding links use QuotePilot/MBMapps branding; the legacy Firebase project ID and hosting origin remain unchanged infrastructure identifiers.
- Build and local validation: the release candidate passes 249 unit tests (35
  intentionally skipped), 34 focused Firestore rules tests, and the default
  Playwright suite (29 passed, 2 intentionally gated provisioning-role cases
  skipped). The Firebase Auth/catalog browser lane, authoritative
  pricing/quote/portal browser lane, and full provisioning emulator acceptance
  matrix also pass. Both the browser application and Functions production
  dependency trees report zero known vulnerabilities under `npm audit
  --omit=dev`. This is local/emulator evidence, not hosted tenant acceptance.
- Functions runtime readiness: Functions now target Node.js 22 and use Firebase
  Admin 14 modular app, Auth, and Firestore APIs. The local authoritative and
  provisioning matrices pass with that runtime candidate.
- Test coverage: unit + Playwright smoke suites are configured in CI.
- Current branch workflow delivery: proposal readiness, Good/Better/Best scenarios, quote lifecycle timelines, lead follow-ups, sensitive-action approval requests, the customer decision center, and event production checklists are implemented and locally covered.
- Current branch quote-entry simplification: Step 1 keeps attendance and role
  counts in the primary flow while placing five exceptional staffing-rate
  values in Advanced Pricing. Existing saved/template values trigger a visible
  review warning and survive collapse/reopen; 1440px, 390px, and 320px layout
  containment is locally covered without changing pricing or persistence code.
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
- Workflow authority boundaries: approval resolution authorizes but does not
  itself execute a sensitive action; the matching Quote History operation must
  consume that exact approval. Customer acceptance does not prove payment or
  booking, and production checklist completion does not prove inventory
  availability.
- Current source-candidate approval authority: Firebase-backed approval request
  creation and admin resolution use same-tenant callable transactions with
  server-owned actor identity/timestamps and duplicate/replay rejection.
  Payment-request email, contract conversion, portal-link rotation, and
  permanent deletion require the exact approved request, persist server-owned
  execution outcome fields, and write a durable org-scoped execution audit.
  Contract conversion is server-planned, and completed atomic actions replay
  idempotently; failed provider execution requires a new approval. Direct
  Firestore approval-array, contract-evidence, and execution-audit writes are
  denied after the rules rollout. A
  confirmed missing-callable response alone may use the existing
  rule-authorized path during the Vercel-first deployment window; other
  callable errors fail closed. Pure planning, client delegation, rules denial,
  and the full provisioning emulator matrix pass. This boundary is not
  production behavior until the matching Functions and Firestore rules are
  deployed together.
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
- Latest Vercel production operation: merged `main` deployment
  `dpl_9K7pqmZjqAMBbegKq3uyUf6rGVXv`, including the canonical SPA rewrite and
  returning `200` for direct `/app` and `/system` requests.
- Last known good Firebase Hosting deploy:
  - commit: `a4a2568f06eaedcf9805c503bb161d2847d12710`
  - CI run: `CI Quality` #23203096351 (March 17, 2026 UTC)
  - workflow run: `Deploy Firebase Hosting (+ Optional Functions)` #23203174267 (March 17, 2026 UTC)

## Active Risks
- The Node.js 22/Firebase Admin 14 Functions candidate is locally validated but
  has not been deployed or observed on the production Functions runtime.
- The Vercel deployment and custom-domain alias are provider-verified, but the authenticated production quote/save/export workflow still needs post-release browser acceptance.
- Provisioning hardening remains production-incomplete. The frontend source is
  live on Vercel, but do not treat the in-app preflight, verified-owner
  activation, entitlement-only update path, catalog conflict checks, trusted
  quote creation, CLI safety changes, or onboarding checklist as production
  behavior until the reviewed Functions/rules slice is deployed and exercised
  with a disposable second organization.
- Resend custom-domain sending remains blocked because the account's one included domain slot is occupied by `leaguepilot.us`; adding `quotepilot.mbmapps.com` requires an account upgrade or explicit authorization to remove/migrate the existing domain, followed by authoritative DNS verification. The production custom-domain sender remains disabled. An external, manual Resend dashboard sandbox message from `QuotePilot by MBMapps <onboarding@resend.dev>` was provider-accepted and recorded as delivered (`34deea9f-8a1c-47ce-8f4e-2ea5164a2eec`), but that address is not an allowed QuotePilot Functions configuration and the result is not custom-domain or recipient-inbox proof.
- Import Studio frontend code is live on Vercel, but its `importBatches`
  Firestore rules are not deployed or hosted-smoke-verified. Excel intake,
  merge/update policies, saved import history UI, and active
  quote/payment/contract/booking imports are intentionally not included in this
  first slice.
- The customer decision frontend is live on Vercel, but the new
  `portalDecision` Firestore rule changes and enriched portal snapshots are not
  deployed or hosted-smoke-verified.
- Approval request creation, admin resolution, and action-specific execution
  linkage are server-authoritative in the current source candidate, but the
  matching Functions/rules deployment and hosted acceptance remain pending.
- Existing portal snapshots still need a reviewed production dry run and apply
  before older links can display every newly added event, selection, and
  pricing field. A dry-run-first, tenant-scoped backfill tool is implemented
  and locally validated, including transactional emulator acceptance; no
  production portal record was changed by that validation.
- Firestore production hardening is in active P0 execution; fallback retirement, denial evidence, migration execution, and portal hardening implementation are complete, but production rollout of updated portal rules is not complete yet.
- Bundle size remains a watch item; budget/CWV gates now prevent uncontrolled regressions.
- The quote builder now has a locally accepted mobile pricing path: after the
  user enters the wizard, Total and Deposit remain in view throughout steps
  1–5 at tested 320px, 390px, and 768px widths; the active step recenters after
  navigation and resize; and the one full breakdown opens as a focus-contained
  sheet with background isolation, Close/Escape recovery, and one concise live
  announcement. The 320px Save action remains unobstructed. Hosted mobile
  acceptance is pending publication.
- Authenticated workspace modal chunks now load on first use instead of during
  initial `/app` startup; local request-level browser coverage verifies the
  boundary, while hosted transfer/CWV evidence remains pending publication.
- Functions integrations (Stripe, Twilio, and Resend) remain optional and require secure runtime configuration plus provider-level acceptance/delivery proof; committed placeholder templates are not provider configuration.
- CRM outbound synchronization is intentionally disabled until a
  server-authorized connector with provider acceptance evidence is implemented.
- Staging sign-off routine must be re-established to keep `main` release-only under higher delivery velocity.

## Current Focus (Near-Term)
1. Perform a controlled rules/Functions deployment from the reviewed merged
   `main` revision, then run the hosted owner/quote/portal tenant acceptance
   checklist against the already-live Vercel frontend.
2. Verify the intended Resend sender domain in the Resend dashboard and authoritative DNS; only then configure `onboarding@quotepilot.mbmapps.com` and capture accepted, delivered, and recipient proof from one controlled test.
3. Deploy the updated `firestore.rules` and run hosted portal decision smoke checks, including active, expired, deleted, and change-request paths.
4. Run and review the scoped production portal-projection dry run, resolve any
   reported conflicts, then explicitly authorize the guarded apply and retain
   its count-only evidence.
5. Re-establish staging sign-off workflow before broadening merge velocity into `main`.
6. Improve large-chunk performance while staying inside bundle/CWV guardrails.

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
