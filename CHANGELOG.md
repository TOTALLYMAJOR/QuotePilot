# Changelog

All notable project changes are documented in this file.

This changelog is backfilled from git history and will be maintained going forward.

## [Unreleased]

### Added

- Independent recovery boundaries for every lazy public route and workspace
  tool. A failed chunk now preserves the surrounding app and exposes executing
  retry, reload, and close/back actions with sanitized diagnostics. The seven
  core workspace dialogs share initial focus, contained Tab navigation, safe
  Escape handling, body scroll lock, unsaved/busy close guards, and trigger
  focus restoration.
- Versioned starter-pack package inclusions with stable menu, add-on, and
  rental references. Quote builders explicitly select covered items at no
  added charge; client previews and server-authoritative pricing prevent a
  second charge, and quote, proposal, and portal snapshots retain only the
  selected inclusions with authoritative catalog labels.
- A quote-scoped staff/customer conversation for provider-accepted current
  portals. Callable-only reads and sends derive actor identity and timestamps
  on the server, bind every request to the tenant, quote, portal issuance, and
  current delivery evidence, preserve canonical history across safe token
  rotation, and provide bounded, idempotent retry with explicit loading,
  success, failure, refresh, and declined-read-only states.
- Real email/password sign-in, invite-aware account guidance, and password-reset
  request handling, with Firebase Auth emulator coverage at the OOB issuance
  boundary rather than an inbox-delivery claim.
- A saved-draft handoff that focuses the exact quote, keeps inactive draft
  portal links hidden, and routes provider delivery or approval through the
  existing staff authority boundaries.
- Retryable Step 2 menu loading with accessible loading, event-specific empty,
  error, and admin Catalog Admin deep-link states; stale event-type responses
  cannot replace the current request or erase selections during retry.
- Searchable, locally filtered Quotes history with quote-number, event-name,
  customer-name, and email matching, visible result counts, unified short dates,
  three-row loading skeletons, and clear-filter recovery.
- Responsive workspace navigation with New quote, Quotes, Workflow,
  Operations, Account, and mobile More entry points; menus are exclusive and
  support outside-click dismissal, Escape, ARIA menu semantics, and focus
  restoration.
- Customer-safe portal recovery callable with bounded token validation,
  delivery-activation checks, tenant activity checks, per-requester throttling,
  and a whitelisted caterer contact response for known active or expired links.
- Playwright axe contrast coverage at desktop and mobile widths, computed 12px
  workspace type-floor checks, 44px target checks, and document font-loading
  assertions.
- First-party, tenant-scoped quote-wizard analytics for anonymous funnel
  completion and add-on selection/removal trends. Events use allow-listed
  non-customer dimensions, deterministic retry IDs, callable-only writes, and
  a 30-day summary in the existing reporting dashboard.
- Admin Operations Audit in Integrations Ops now summarizes delivery retry and
  manual-review candidates, seven-day recorded sync health, current staff-role
  counts, and recent server-owned approval, delivery-reconciliation, and
  catalog-confirmation actions.
- Server-authoritative electronic proposal acceptance with typed signer name,
  versioned consent text, server timestamp, exact delivery-revision and portal
  issuance preconditions, integer minor-unit totals, a SHA-256 signed proposal
  snapshot, and an immutable tenant-scoped receipt record.
- Customer-facing acceptance receipts now show signer, timestamp, receipt ID,
  and signed revision while continuing to state that payment and booking are
  separate outcomes.
- A staff-only Kitchen sheet export for saved quotes with event timing,
  staffing, kitchen checkpoints, menu selections, production-checklist state,
  revision and generation stamps, day-of contacts, allergen callouts, and
  prepared-by and chef sign-off lines plus day-of notes.
- Exact-SHA release evidence, versioned target-specific UAT, deterministic
  credential-free Firebase/Vercel payload manifests, and rollback ancestry
  checks for a separately authorized trusted deployer. Repository preparation
  workflows do not receive provider mutation credentials or change production.
- Separate server-authoritative Stripe deposit and final-balance collection
  rails with exact approval scope, private-before-provider-acceptance link
  handling, signed-event payment truth, replay-safe reconciliation, and
  customer-safe projections that omit provider identifiers.
- A disabled-by-default public Stripe test-invoice buyer path with fixed Starter
  pricing, Turnstile abuse controls, durable rate limits, exact-request retry,
  signed invoice lifecycle handling, audited terminal-unpaid recovery, paid
  workspace preparation, and verified-email invitation activation.
- Trusted customer projection during server-authoritative quote create and edit:
  matching organization customer records are updated in the same transaction,
  imported notes and nonblank optional details are preserved, duplicate emails
  reuse the existing record, and browser writes cannot forge projected history.
- Four named customer-portal theme presets in Catalog Admin: Midnight Amber,
  Warm Linen, Garden Sage, and Coastal Blue. Selecting a preset immediately
  updates an accessible preview and the existing tenant brand color fields;
  the normal revision-guarded catalog save remains the persistence boundary.

### Changed

- QuotePilot email now supports the approved interim sender
  `QuotePilot by MBMApps <quotepilot@leaguepilot.us>`, reusing the existing
  provider-verified Resend domain without deleting or disrupting that domain.
  The restricted production key is held in Firebase Secret Manager; live email
  remains disabled until the governed Functions release and accepted,
  delivered, and inbox evidence are complete.
- Twilio owner-alert delivery now keeps the auth token in Firebase Secret
  Manager, routes sends through the configured Messaging Service SID, and binds
  the secret only to Functions that inspect or send SMS. SMS remains disabled
  until registration, release, and live-delivery acceptance are complete.
- The JavaScript bundle baseline now reflects the fully converged clean `main`
  build, and its forward-growth allowance is tightened from 15% to 5%, closing
  the temporary performance-baseline exception.
- Catalog Import Studio writes and rolls back package, add-on, rental, and menu
  batches through same-organization admin callables. Each operation is a
  revision-preconditioned transaction that stores prices in integer minor
  units, advances each real catalog mutation exactly once, clears pricing
  confirmation only when records change, supports stable-batch retry, and
  protects edited or still-referenced records from rollback; customer CSV
  imports retain their existing direct path.
- Catalog activation and authoritative pricing now require an attributed
  pricing-confirmation receipt whose confirmed revision exactly matches the
  current catalog revision. Server confirmation validates guided-selling and
  event-template package, add-on, rental, menu, event-type, tax, season,
  bartender, and staffing references (including active availability), and
  malformed pricing arrays fail with a controlled precondition.
- Standardized the customer-facing product identity to `QuotePilot by MBMApps`
  across public marketing, sign-in and workspace states, the authenticated app
  header, portal attribution, proposal metadata/footer, install metadata,
  onboarding sender configuration, and operator documentation.
- Separated the fixed QuotePilot product lockup from tenant-controlled business
  branding in the workspace header and Catalog Admin. Tenant names, logos,
  colors, and taglines remain available for customer proposals and portals,
  while legacy `tonicatering` Firebase project/site identifiers remain
  infrastructure-only and are explicitly labeled as such in operator guidance.
- Customer proposal branding now resolves configured brand name, then the
  organization profile name, then neutral catering copy across authoritative
  quote creation/edit, local quotes, portal snapshots, proposal email, and PDF.
- Portal snapshots add optional organization branding/contact fields and the
  applied service-charge percentage. Legacy snapshots remain valid and show a
  rate-free `Service charge` label when no percentage was stored.
- New quote and recovery projections snapshot all six existing tenant brand
  colors alongside the existing logo reference, so a saved proposal keeps its
  customer portal appearance without changing pricing or delivery authority.
- Customer PDFs use tenant or neutral metadata and plain-language staffing and
  service-charge labels while retaining pricing internals only in persisted
  staff data. Real PDF extraction rejects internal ids, rate lists, abbreviated
  staffing, portal tokens, and QuotePilot fallback metadata.
- Valid customer portals display caterer name, logo, email, phone, safe colors,
  humanized values, and acceptance next steps. URL-token entry stays hidden on
  loaded links, and Staff sign in remains a footer action.
- Stripe `payment=success` and `payment=cancelled` returns are both consumed.
  Success only polls stored webhook-backed state; cancellation leaves payment
  evidence unchanged and offers a truthful retry path.
- Workspace typography uses a 1.5 body line height, 1.15–1.25 heading rhythm,
  a 12px minimum text size, fixed high-contrast dark-gold CTAs, stronger header
  surfaces, and 44px primary, ghost, and quantity-stepper targets.
- Bodoni Moda, Manrope, DM Mono, and Inter now load from preconnected,
  `display=swap` document stylesheet links instead of CSS `@import` rules.
- Release-critical workflows use immutable action pins, reproducible workflow
  linting, read-only repository permissions, and checkout steps that do not
  persist the GitHub token before repository-controlled checks execute.
- Target-scoped release UAT now exposes a read-only command that prints all and
  only the checklist ids applicable to one selected profile. Operator guidance,
  PR evidence, workflow input copy, and receipt validation use that exact set,
  while release workflows share the current immutable action pins and the
  retired customer-hosting deploy entrypoint remains classified as high risk.
- Generic Resend and quote-payment Stripe credentials use least-privilege
  Firebase Secret Manager bindings. The generic webhook receives only its
  signing secret, and bounded old/new webhook-secret overlap supports rotation.
- The legacy organization-wide deleted-quote purge fails closed and its browser
  control is removed. Retained organizations use the existing exact-approved,
  audited one-quote deletion path; separately governed tenant teardown remains
  outside that operation.

### Fixed

- Starter-pack setup now retries the retained version 1 manifest only when an
  older deployed callable explicitly rejects the current manifest version. The
  compatibility retry preserves the exact catalog-revision precondition,
  remains single-attempt, and does not retry authorization, revision, network,
  or other catalog failures.
- The normal local-fallback Playwright suite now excludes the Firebase-only
  blank-owner starter-catalog scenario; that scenario continues to execute in
  its dedicated Auth, Firestore, and Functions emulator lane.
- Starter-pack replacement now treats owner-deactivated packages and missing
  generated records as divergence, and managed menu removal fails closed when
  package or event-template dependency containers are malformed. Historical
  manifest hashing remains compatible with catalogs already staged from older
  pack versions.
- Catalog, menu, and pricing browser writes now require the same atomic
  catalog-revision advance and pricing-confirmation reset used by the normal
  save workflow. Starter-pack provenance and staged-pack settings remain
  callable-owned, preventing a direct client write from bypassing replacement
  or confirmation authority.
- Import Studio now refreshes catalog revisions in the background after import,
  rollback, or revision-conflict recovery, so the receipt, Undo action, and
  visible error remain mounted. Authoritative menu deactivate/delete actions
  refuse to run while unrelated Catalog Admin drafts are pending, and lazy-tool
  workspace reload requires confirmation before discarding an unsaved quote;
  closing the failed tool keeps that quote intact.
- Catalog interactions now keep quote and admin event-type choices isolated,
  refresh the active menu immediately after a managed-menu mutation, and focus
  the selected production event from Staffing Board. Catalog reconciliation
  removes unavailable package, add-on, rental, and menu selections with a
  visible unsaved-work warning; inactive package choices persist and stay out
  of quote/template/recommendation decisions; dependency-aware deletion fails
  closed when advanced event-template JSON is malformed.
- Browser interaction coverage now executes the staff Kitchen sheet action and
  verifies that it produces a BEO PDF download from the saved quote row.
- Menu-item deactivation and deletion now use a same-organization admin
  callable with an exact catalog-revision precondition. Referenced items are
  rejected transactionally, successful removals advance the revision and
  reopen pricing review, stale clients reload instead of overwriting, and
  direct browser deletes or active-to-inactive writes are denied by rules.
- Quote creation now requires at least one selected menu item in Step 2, local
  persistence, authoritative server creation, proposal acceptance, and contract
  conversion. Validation returns staff to the first menu choice, while a
  revision-guarded additive recovery pack can repair a historically confirmed
  catalog that has no menu without replacing existing records or pricing.
- Local development catalog fallback now supports persistent event-type,
  category, and menu-item create, edit, and delete operations. Menu prices are
  stored in integer minor units and every mutation advances the catalog revision
  and clears pricing confirmation for another owner review.
- Portal rotation now reconciles both deposit and material final-balance payment
  rails, tolerates a concurrent terminal Stripe expiration, invalidates stale
  old-portal payment approvals, and keeps in-progress dispatches fail-closed.
  Accepted quotes can deliver a newly rotated portal, stale approval actions are
  visibly non-executable, and Workflow handoffs focus the exact Quotes action.
- Sensitive-action requests are limited to operations with a real execution
  path; stale duplicate approvals no longer hide recovery. Catalog and
  integration surfaces also stop presenting editable CRM settings when no
  outbound connector exists, and failed schedule checkpoint resets restore the
  prior local values.
- Catalog Admin now refreshes event types and menu records after an
  authoritative starter-pack load, reconciles uncertain save/confirmation
  responses against the exact server revision, offers a refresh recovery when
  that read also fails, removes the disabled Starter Packs decision after
  pricing confirmation, and prevents Enter-plus-blur menu edits from saving
  twice.
- New quote confirmation appears only for user-originated unsaved changes;
  automatic catalog/template defaults stay clean, and reset returns all quote,
  event, customer, pricing, and selection fields to the canonical initial state.
- New quotes now store the same one-hour minimum shown by both duration
  controls and select the first valid package from the loaded tenant catalog,
  including after New quote resets. Template clearing tracks field and
  item-level provenance so package, menu, staffing, travel, and pricing
  defaults are restored without rolling back later user edits.
- Tenant resolution, verified-but-pending staff access, unavailable catalogs,
  and sales catalog-setup waits now expose executing retry or support paths.
  Booking conflicts show the overlapping event details and route staff to the
  schedule or directly back to date, time, duration, and venue correction.
- Step 1 click and Enter validation expose all seven required-field errors,
  provide one summary, and move focus to the first invalid control.
- The idempotent `sent` to `viewed` customer-visit transition and the rule that
  browser payment returns never establish `paid` remain intact.
- Buyer-invoice emulator recovery now recognizes only Cloudflare's published
  loopback test credential, deterministic callable-emulator request identity,
  loopback HTTP activation, and Stripe test restricted-key fixtures without
  weakening deployed hostname, HTTPS, request-source, or live-key checks.
- Portal projection backfill dry runs can again use an authenticated Firebase
  CLI cache when Application Default Credentials are unavailable; the token
  reader now uses a defined synchronous filesystem dependency with focused
  injection coverage and does not place the token in evidence.

### Security

- Hardened authenticated tenant switching so principal, organization, role, or
  authority-resolution changes remount the complete workspace boundary before
  the next scope renders. Unsaved customer details, quote edit state, open or
  sticky modal state, event selection, and catalog state can no longer carry
  across sign-out and re-authentication; the Firebase browser lane now proves a
  configured owner -> blank second organization -> original owner transition.

- Raw product analytics records cannot be read or written from the browser;
  same-tenant staff receive only a server-derived summary, and analytics
  failures never block quote creation or dashboard quote reporting.
- Operations Audit is produced by an admin-only same-tenant callable. Its
  sensitive-action rows are limited to server-owned evidence and remain
  distinct from operator-recorded integration sync notes.
- Direct browser writes can no longer create an accepted proposal. The
  acceptance callable independently validates the active organization, portal
  expiry, matching quote/portal content, provider-accepted delivery evidence,
  complete proposal fields, signer consent, and current revision in one
  transaction; stale tabs and forged receipt writes fail closed.

## [0.2.3] - 2026-08-05

### Added

- Owner-onboarding starter catalog packs for Wedding & events, Corporate
  drop-off, BBQ / Southern, and Church & community. Packs populate the existing
  Catalog Admin setup gate with versioned menu, package, add-on, rental, and
  staffing drafts while leaving pricing unconfirmed until owner review.
- Blank catalog setup now presents only clearly described industry choices,
  populates immediately from the selected pack without a second save step, and
  opens the resulting menu for review; manual build-from-scratch remains one
  explicit secondary path instead of a row of empty configuration tabs.
- Server-authoritative starter-pack apply, safe staged replacement, and pricing
  confirmation transactions with catalog revision preconditions, generated vs
  modified record hashing, actor/timestamp/revision confirmation evidence,
  historical manifest lookup, complete catalog validation, and integer
  minor-unit money storage.
- Dry-run-first `seed:menu:firestore -- --pack <pack-id>` support for applying
  the same versioned starter manifests through the existing tenant seed tool.

### Fixed

- Firebase Functions production packaging now declares the Firebase App and
  App Compat peers required by Firebase Admin's database compatibility layer,
  preventing Node.js 22 cold-start failures after a clean cloud install.
- Customer portal visits now record the first valid `sent` to `viewed`
  transition atomically, preserving the original view timestamp on reload so
  lifecycle timelines and reporting can reflect actual portal views.
- Stripe checkout success returns now trigger bounded portal snapshot refreshes
  and show a secure confirmation state until the signature-verified webhook's
  paid status is visible; the browser return itself never marks a deposit paid.

### Added
- Tenant-scoped Workflow Attention queue for active quotes, with a post-idle
  header count, due/overdue follow-ups, pending approvals, new and acknowledged
  customer change requests, request-ID-bound current handling records, and
  responsive keyboard-accessible operator controls. The queue is in-app only;
  it does not send email or SMS or alter customer decision evidence.
- Dry-run-first, tenant-scoped customer portal projection backfill tooling for
  active legacy links, with canonical customer-safe quote projection, guarded
  preservation of decision/payment/booking evidence, transactional apply-time
  revalidation, pre-reserved count-only private evidence, and Firestore
  emulator acceptance.
- Server-authoritative quote approval request and resolution callables with
  same-tenant staff enforcement, admin-only resolution, transaction-backed
  duplicate/replay protection, and server-owned actor/timestamp audit fields.
- Exact approval-to-execution enforcement for payment-request email, contract
  conversion, portal-link rotation, and permanent quote deletion, including
  server-owned execution outcomes, durable org-scoped audit records, and
  idempotent replay behavior for completed operations.
- Server-authoritative contract conversion planning and callable execution,
  including conflict/capacity evidence and server-generated contract identity.
- Focused approval workflow coverage across pure server planning, Firebase
  client delegation, Firestore direct-write denial, and the full
  Auth/Firestore/Functions emulator acceptance matrix.
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

- The final quote action now says `Save draft`, opens Quote History on the exact
  saved quote, and states that customer delivery has not occurred. The targeted
  handoff offers a provider-send action only to Firebase admins with a complete,
  supported email-provider configuration, and offers sales staff a draft PDF
  without an unusable portal link. Copying an email template no longer changes
  a draft to sent, and the raw draft portal URL is no longer rendered as a
  shareable artifact.
- Quote email delivery is now server-owned and bound to both the saved content
  revision and current portal issuance. The callable preflights an existing
  tenant-matching portal with a future expiry, builds the customer email and
  portal URL on the server, and rejects browser-supplied attachments for quote
  and payment-request email. A durable lease and deterministic provider key
  suppress duplicate automatic attempts only inside a 23-hour retry window.
  Provider acceptance records the quote `sent` lifecycle and activates the
  portal only when the accepted revision still matches a valid current portal
  issuance. If acceptance is known after that portal becomes invalid or
  expires, the provider evidence is retained as `requires_rotation` while the
  portal remains inactive; guarded rotation creates a new issuance that must
  be sent separately before it is customer-visible. Unresolved outcomes lock
  edits, status/payment, checkout, contract, portal rotation, customer
  decisions, and deletion until safe retry or audited reconciliation. Definite
  failures may start a fresh delivery generation after the original retry
  window, while ambiguous outcomes require review. A server-observed provider
  acceptance can never be reconciled as not sent. Generic staff status writes
  cannot claim `sent` or `viewed` or rewrite provider/customer lifecycle
  evidence, and owner draft notifications omit the inactive portal token.
- Portal projection now carries explicit current-issuance delivery evidence.
  Copy Portal and portal links inside PDFs fail closed after draft save or
  portal rotation until the matching issuance has provider acceptance.
  Legacy projections without that evidence remain inactive and must be
  recovered through an approved resend or truthful provider reconciliation;
  migration/backfill tooling never fabricates delivery evidence. Configuration
  readiness and provider acceptance remain distinct from sender-domain,
  inbox-delivery, and bounce proof.
- Browser-driven quote expiry now updates the organization quote and matching
  portal status/lifecycle in one rules-enforced batch, so a stale public portal
  cannot survive a quote-only transition. Quote History exposes the trusted
  admin `Reopen` recovery for eligible expired records; it restores a draft with
  a new portal issuance, while portal rotation remains limited to draft, sent,
  and viewed records. Expiry persistence is deferred while delivery remains
  unresolved, keeping `Review Delivery` reachable; per-record persistence
  failures no longer blank the history list, and successful reconciliation
  reloads the row into the expiry/Reopen path.
- The GitHub `lane:firebase-auth-rules` job now invokes the matching package
  lane so Firestore authorization tests and the Firebase browser smoke run
  together instead of allowing the rules half to be omitted.
- The Firebase Auth/rules package lane now prepares and selects Java 21 before
  its first emulator command, so Firestore rules cannot bypass the existing
  local-JRE fallback on runners with an older system Java.
- Customer change-request acknowledgment and handling now use a narrow
  transaction that revalidates the exact portal request, derives the actor from
  the authenticated Firebase user, preserves the original customer decision,
  writes no quote version or portal snapshot, and requires an internal note
  before work can be marked handled. Firestore rules constrain the same
  tenant, actor, source-request, field, and state-transition boundaries.
- Step 1 now groups guest and role counts under Attendance & Staffing while
  keeping five exceptional staffing-rate fields inside the collapsed Advanced
  Pricing section. Saved or template-applied rate values remain visible through
  an active-pricing warning, and values survive collapse/reopen unchanged.
- Phone and tablet quote building now keeps Total and Deposit in a sticky
  summary throughout all five steps, exposes the single full breakdown as a
  focus-contained sheet with background isolation and Close/Escape recovery,
  recenters the active step after navigation or resize, and uses compact
  scrollable header actions without covering workflow controls.
- Authenticated operator workspaces now defer their lazy modal modules until
  first use, keep opened modules mounted after close, and show an accessible
  loading surface during the first chunk fetch instead of downloading every
  admin tool during initial `/app` startup.
- Firebase-backed Sales Workflow approval mutations now use trusted callables;
  direct browser writes to `workflow.approvalRequests` are denied for both
  sales and admin roles. A confirmed missing-callable response may use the
  existing rule-authorized path only during a Vercel-first rollout window; all
  other callable failures remain fail-closed. Local fallback mode retains its
  existing offline behavior.
- Firebase-backed sensitive actions now require the exact approved request id
  and record awaiting, in-progress, succeeded, or failed execution state.
  Failed provider delivery requires a new approval; completed atomic actions
  return their stored result on replay. Direct browser writes cannot create
  contract evidence or approval-execution audit records.
- The repository, CI, Docker image, and Firebase Functions now target Node.js
  22. Functions use Firebase Admin 14 modular app, Auth, and Firestore APIs
  across runtime, emulator seed, provisioning, tenant migration, and catalog
  seed paths. Production dependency audits for both the browser app and
  Functions now report zero known vulnerabilities.
- Playwright now runs admin and sales role acceptance against separate runtime
  servers, keeps Firebase-only specs in their emulator lanes, and aligns quote
  workflow coverage with future event dates, per-role staffing, configured-only
  payment links, portal lifecycle eligibility, and hardened sales authority.
- Playwright web servers now receive the canonical QuotePilot application URL
  explicitly, keeping customer handoff acceptance deterministic in clean CI
  environments without relying on a developer's local environment file.
- The canonical CWV command now pins Lighthouse to the installed Playwright
  Chromium when no explicit browser is configured, preventing a host Windows
  browser path from leaking into Linux validation regardless of which release
  wrapper invokes it.
- Lighthouse CI is updated to its current release with narrow patched `tmp` and
  `uuid` overrides, removing the remaining development-tool audit findings.
- The Firebase Auth/rules browser lane now starts Functions so it can validate
  authenticated organization bootstrap and catalog loading; trusted quote save
  behavior remains covered by the authoritative pricing lane.
- Quote History now states the actual sales boundary: sales may prepare
  proposal artifacts, while email send and payment, booking, portal, and delete
  state changes require admin authority.
- Firebase browser configuration now trims deployment-provider whitespace before
  SDK initialization, preventing malformed Google Auth iframe URLs while
  preserving the existing fail-closed behavior when configuration is missing.
- The default Playwright smoke lane now excludes Firebase emulator-only specs;
  those acceptance flows run only in their dedicated Auth/Firestore and
  authoritative-pricing lanes, avoiding fallback-mode retries in generic CI.
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
- Migration and seed CLIs now validate arguments and overwrite guards before
  loading Firebase Admin, while Firebase emulator lanes install the separately
  locked Functions dependencies explicitly.
- The core CI lane now fetches full Git history so documentation governance
  evaluates the real PR merge-base range instead of failing on a shallow
  checkout.
- Firebase emulator runners now detect system Java versions older than 21,
  provision a repository-local Java 21 runtime, and explicitly prefer it over
  stale runner-level `JAVA_HOME` settings.
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
- Quote History now uses the authenticated staff role to hide payment, booking,
  portal rotation, contract conversion, reopen, and delete controls from sales
  users while preserving proposal preparation. Neither sales nor admin users
  can claim `sent` or `viewed` through generic status writes: the delivery
  callable owns provider acceptance and the customer portal owns view evidence.
  Sales schedule updates remain limited to non-evidentiary staff lead,
  assignment time, kitchen checkpoint, and production checklist fields.
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
