# Project Status

Last updated: August 6, 2026

## Operational Health
- Runtime: release `v0.2.3` is live from merged `main` commit
  `d2747c693e4d15d0efc66cb3bbd76b03f31009f4`. Main CI run `31059404835`
  passed every required lane. The public custom domain
  (`https://quotepilot.mbmapps.com`) is aliased to Vercel production deployment
  `dpl_DgDTcfpR411dXZ9x3hZhR6Gigf6Z`, which is provider-reported `READY`.
  Firebase Hosting remains the origin/fallback (`https://tonicatering.web.app`)
  and was released with the same tagged source revision.
- Current branch product identity: install metadata, runtime defaults, proposals, integration messages, and onboarding links use QuotePilot/MBMapps branding; the legacy Firebase project ID and hosting origin remain unchanged infrastructure identifiers.
- Build and local validation: the current delivery-evidence head passes the
  full release lane with 318 unit tests passed and 39 intentionally skipped,
  production build, environment/secret checks, documentation governance, and
  bundle budget. Firestore rules pass 38/38; the default Playwright suite passes
  31 tests with 2 intentionally gated provisioning-role cases skipped; the
  Firebase Auth/catalog and authoritative quote/delivery/portal browser lanes
  each pass 1/1. The production Docker image builds successfully. Local
  Lighthouse passes with performance 0.87, LCP 3,823 ms, CLS 0.001, and TBT 120
  ms. Both the browser application and Functions production dependency trees
  report zero known vulnerabilities under `npm audit --omit=dev`. This is
  local/emulator evidence, not hosted tenant or provider acceptance.
- Functions runtime readiness: all 29 production Functions now run on Node.js
  22 with Firebase Admin 14 modular app, Auth, and Firestore APIs. The clean
  cloud install and each function update completed successfully from `v0.2.3`;
  the local authoritative and provisioning matrices also pass.
- Test coverage: unit + Playwright smoke suites are configured in CI.
- Current branch workflow delivery: proposal readiness, Good/Better/Best
  scenarios, quote lifecycle timelines, lead follow-ups, sensitive-action
  approval requests, the customer decision center, and event production
  checklists are implemented and locally covered. A tenant-scoped Workflow
  Attention queue now consolidates due follow-ups, pending approvals, and
  current customer change requests. Its post-idle header count preserves the
  lazy workspace boundary; request-ID-bound acknowledge/handled state is internal
  only and never edits customer decision evidence or sends email/SMS.
- Current branch quote-entry simplification: Step 1 keeps attendance and role
  counts in the primary flow while placing five exceptional staffing-rate
  values in Advanced Pricing. Existing saved/template values trigger a visible
  review warning and survive collapse/reopen; 1440px, 390px, and 320px layout
  containment is locally covered without changing pricing or persistence code.
- Current branch draft handoff: the final wizard action explicitly saves a
  draft, Quote History focuses the exact saved quote with a role-safe next
  action, copying an email template preserves draft status, and draft portal
  links are neither rendered nor copyable as customer-ready artifacts. Firebase
  admin delivery fails closed until a supported provider configuration is
  present, is bound to the saved content revision plus portal issuance, and
  sends only server-built
  email/portal content; browser PDF attachments are rejected. A 23-hour bounded
  provider-idempotency window supports prompt same-key retry, while uncertain
  outcomes enter a mutation-locked review state. An expired definite failure
  starts a fresh delivery generation; an ambiguous outcome requires same-key
  retry or audited provider review. A server-observed provider acceptance cannot
  be reconciled as not sent. Provider acceptance activates the portal only when
  it matches the valid current issuance. Acceptance against an invalid or
  expired portal is retained as `requires_rotation`; that portal remains
  inactive until guarded rotation and a new provider send establish evidence
  for the new issuance. Generic staff writes cannot claim `sent` or `viewed`,
  customer portal decisions are blocked during unresolved delivery, and owner
  draft SMS omits the inactive portal token. Copy Portal and portal links inside
  PDFs remain withheld without matching current-issuance delivery evidence.
  Admin expiry writes quote and portal lifecycle state atomically; the visible
  `Reopen` recovery returns an eligible expired quote to draft with a new portal
  issuance, while accepted, declined, and booked portal identities remain
  terminal. A quote expiring during unresolved delivery remains visible for
  provider review, and one failed legacy expiry projection no longer prevents
  the rest of Quote History from loading.
  The configuration check does not prove sender-domain verification or inbox
  delivery. Focused source/unit/rules coverage and a
  provider-disabled emulator failure path are local evidence; successful
  provider acceptance, atomic hosted completion, inbox delivery, and bounce
  handling remain unproved until provider/hosted acceptance is captured.
- Production marketing delivery: a hospitality-first prospect page is live at `/`, the prior dark product overview is live at `/system`, and the authenticated workspace resolves at `/app`; customer portal query routes retain precedence in the client router.
- Current branch tenant onboarding delivery: admin-only Import Studio supports tenant-locked CSV preview/import for customers, packages, add-ons, rentals, and menu items, with duplicate skipping, receipts, and rollback limited to records stamped by the import batch.
- Production `v0.2.3` starter catalog delivery: the existing post-login blank-catalog
  gate now offers four one-click industry drafts in Catalog Admin. Versioned
  manifests populate tenant-scoped catalog and menu records with suggested
  minor-unit prices, provenance hashes, and unconfirmed pricing. Server
  transactions enforce revision preconditions for apply, untouched staged
  replacement, and confirmation; replacement detects custom records,
  pack-record divergence, and pricing-setting edits, while confirmation checks
  the complete catalog and records actor, timestamp, and catalog revision. The
  frontend, rules, and both starter-catalog callables are deployed from the
  tagged release. Public `/app` routing and unauthenticated callable rejection
  were verified; signed-in owner acceptance is still pending.
- Local-only UX audit closure candidate: customer artifacts, workspace
  navigation, menu/history states, portal recovery/payment-return UX, and
  accessibility coverage are implemented on this branch. These changes have
  not been merged, pushed, deployed, or exercised against production providers
  or data. Hosted portal recovery/callable behavior and authenticated human
  accessibility acceptance remain pending after review and release. Local
  validation passes 355 unit tests with 39 intentionally skipped, 42 default
  browser tests with 2 intentionally gated cases skipped, production build,
  environment/secret checks, documentation governance, bundle budget, and the
  local Lighthouse gate. Firestore rules pass 38/38; Firebase browser lanes
  pass the Auth reset/sign-in/catalog case and the authoritative pricing and
  delivery-boundary case.

### Local UX Audit Acceptance Ledger

`Pass` means evidence from this unmerged checkout only; `Partial` names a
verified seam that does not close the entire layer. `N/A` means that layer does
not apply to the criterion; `Pending` is deliberately not inferred from a lower
evidence layer.

| Audit | Criterion | Local | Emulator | Hosted | Provider | Human |
|---|---|---|---|---|---|---|
| 1 | Reachable seven-field validation and focus | Pass | N/A | Pending | N/A | Pending |
| 2 | Customer-safe PDF and plain-language staffing | Pass | N/A | Pending | N/A | Pending |
| 3 | Consistent service-charge label and projection | Pass | N/A | Pending | N/A | Pending |
| 4 | Contrast and 44px targets | Pass | N/A | Pending | N/A | Pending |
| 5 | Login semantics and password reset | Pass | Pass: Auth OOB issued | Pending | Pending | Pending |
| 6 | Menu loading, empty, error, and retry states | Pass | N/A | Pending | N/A | Pending |
| 7 | Searchable, counted, consistently dated Quotes | Pass | N/A | Pending | N/A | Pending |
| 8 | Type floor, line height, and swap font loading | Pass | N/A | Pending | N/A | Pending |
| 9 | Compact workspace and canonical dirty reset | Pass | N/A | Pending | N/A | Pending |
| 10 | Responsive task-based navigation and menus | Pass | N/A | Pending | N/A | Pending |
| 11 | Truthful save and delivery handoff | Pass | Pass: disabled delivery fails closed | Pending | Pending | Pending |
| 12 | Branded portal and safe recovery contact | Pass | Partial: callable loaded | Pending | N/A | Pending |
| 13 | Acceptance, payment-return, and viewed closure | Pass | Pass: payment/delivery boundary | Pending | Pending | Pending |
- Production provisioning hardening includes verified-email,
  role-document, and allowlist-backed platform authority; explicit plan/create
  confirmation; atomic collision-safe creation; seven-day owner invitations;
  an explicit active organization lifecycle; blank catalog and neutral
  unapproved pricing defaults; conflict-safe catalog saves; trusted atomic
  server-priced quote creation and edits; admin-only safe reopen; callable-only
  quote/portal cleanup; exact-order resume; a durable email-dispatch lease; a
  separate entitlement-only mode; preview-only CLI behavior; owner claims
  repair; deletion tombstones; and atomic terminal portal decisions across both
  quote copies. The coordinated frontend, Functions, and rules deployment is
  complete; creation and owner activation of a disposable second organization
  still require an authenticated platform-admin acceptance session.
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
  denied, generic staff status writes cannot create `sent` or `viewed` evidence
  or rewrite an existing provider/customer lifecycle, and sales schedule writes
  are limited to non-evidentiary staff/checklist fields.
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
- Production approval authority: Firebase-backed approval request
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
  rule-authorized path during a deployment window; other callable errors fail
  closed. The matching Functions and Firestore rules are now deployed together;
  hosted authenticated workflow acceptance remains separate evidence.
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
- Portal token and delivery-evidence hardening is deployed: portal reads and
  customer decisions require a non-deleted,
  non-expired snapshot whose delivery evidence matches provider acceptance for
  the quote's current portal issuance. The Firestore emulator suite passes
  38/38, including fail-closed legacy/no-evidence coverage; hosted portal-path
  acceptance remains pending.
- A prior portal expiry-ms backfill was executed for production org `250`
  (`customerPortalQuotes patched=2`). That historical expiry field is not
  delivery evidence. Legacy projections without the new evidence fail closed
  under the current candidate and require an approved resend or truthful
  reconciliation; no backfill may fabricate acceptance.
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
- Latest Vercel production operation: `v0.2.3` deployment
  `dpl_DgDTcfpR411dXZ9x3hZhR6Gigf6Z`, including the canonical SPA rewrite and
  provider-verified aliases for `quotepilot.mbmapps.com`.
- Last known good coordinated Firebase deploy:
  - release/commit: `v0.2.3` / `d2747c693e4d15d0efc66cb3bbd76b03f31009f4`
  - CI run: `CI Quality` #31059404835 (August 5, 2026 UTC)
  - result: Firestore rules/indexes, all 29 Functions, and Hosting completed successfully

## Active Risks
- Firebase `functions.config()` compatibility remains temporary and must be
  migrated to environment parameters before the March 2027 shutdown.
- The Vercel deployment and custom-domain alias are provider-verified, but the authenticated production quote/save/export workflow still needs post-release browser acceptance.
- Provisioning hardening is deployed across the frontend, Functions, and rules,
  but a disposable second organization has not yet been created and activated
  through an authenticated platform-admin session. Do not treat deployment as
  owner onboarding or hosted tenant acceptance.
- Resend custom-domain sending remains blocked because the account's one included domain slot is occupied by `leaguepilot.us`; adding `quotepilot.mbmapps.com` requires an account upgrade or explicit authorization to remove/migrate the existing domain, followed by authoritative DNS verification. The production custom-domain sender remains disabled. An external, manual Resend dashboard sandbox message from `QuotePilot by MBMapps <onboarding@resend.dev>` was provider-accepted and recorded as delivered (`34deea9f-8a1c-47ce-8f4e-2ea5164a2eec`), but that address is not an allowed QuotePilot Functions configuration and the result is not custom-domain or recipient-inbox proof.
- Import Studio frontend and `importBatches` Firestore rules are deployed but
  not hosted-smoke-verified. Excel intake,
  merge/update policies, saved import history UI, and active
  quote/payment/contract/booking imports are intentionally not included in this
  first slice.
- The customer decision frontend, `portalDecision` Firestore rules, and
  enriched portal snapshot support are deployed but not hosted-smoke-verified.
- Approval request creation, admin resolution, and action-specific execution
  linkage are deployed server-authoritatively; hosted authenticated acceptance
  remains pending.
- Workflow Attention and its change-request handling rules are deployed and
  locally covered, but authenticated hosted acceptance has not been captured.
  Automated customer/staff notifications and
  escalation delivery remain unimplemented.
- Existing portal snapshots still need a reviewed production dry run and apply
  before their customer-safe event, selection, and pricing projection is
  complete. Projection backfill is not delivery authority: legacy links without
  matching `deliveryEvidence` remain inactive and must be recovered through an
  approved resend or truthful provider reconciliation. The dry-run-first,
  tenant-scoped projection tool is implemented and locally validated; it never
  creates delivery evidence, and no production portal record was changed by
  that validation.
- Firestore production hardening and updated portal rules are deployed; hosted
  cross-tenant and portal-path acceptance remains pending.
- Bundle size remains a watch item; budget/CWV gates now prevent uncontrolled regressions.
- The quote builder now has a locally accepted mobile pricing path: after the
  user enters the wizard, Total and Deposit remain in view throughout steps
  1–5 at tested 320px, 390px, and 768px widths; the active step recenters after
  navigation and resize; and the one full breakdown opens as a focus-contained
  sheet with background isolation, Close/Escape recovery, and one concise live
  announcement. The 320px Save action remains unobstructed. The source is live;
  hosted mobile acceptance is pending.
- Authenticated workspace modal chunks now load on first use instead of during
  initial `/app` startup; local request-level browser coverage verifies the
  boundary, while hosted authenticated transfer evidence remains pending.
- Functions integrations (Stripe, Twilio, and Resend) remain optional and require secure runtime configuration plus provider-level acceptance/delivery proof; committed placeholder templates are not provider configuration.
- CRM outbound synchronization is intentionally disabled until a
  server-authorized connector with provider acceptance evidence is implemented.
- Staging sign-off routine must be re-established to keep `main` release-only under higher delivery velocity.

## Current Focus (Near-Term)
1. Sign in as an allowlisted platform admin, create and activate a disposable
   second organization, then run the hosted owner/quote/portal tenant acceptance
   checklist against the live `v0.2.3` frontend and backend.
2. Verify the intended Resend sender domain in the Resend dashboard and authoritative DNS; only then configure `onboarding@quotepilot.mbmapps.com` and capture accepted, delivered, and recipient proof from one controlled test.
3. Run hosted portal decision smoke checks for current-issuance evidence,
   active, expired, deleted, rotated,
   legacy-no-evidence, and change-request paths. Prove that a provider-accepted
   invalid portal remains inactive until guarded rotation and a new send.
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
- Remaining P0 rollout item: attach authenticated post-deploy tenant and portal
  smoke evidence to the deployed hardened rules.

## Notes

- Canonical status ownership is defined in [docs/DOC_SYSTEM.md](docs/DOC_SYSTEM.md).
- Launch operations guidance now lives in [docs/LAUNCH_RUNBOOK.md](docs/LAUNCH_RUNBOOK.md).
- Release-only branch and rollback policy live in [docs/VERSION_CONTROL.md](docs/VERSION_CONTROL.md).
- Backlog prioritization is tracked in [DEV_TASKS.md](DEV_TASKS.md).
