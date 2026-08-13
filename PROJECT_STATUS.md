# Project Status

Last updated: August 13, 2026

## Current Production Release

- PR #78 merged the complete 50-item Ambient material source build into
  `main` at `dc6f0e7e4f7ce307bbcc772fd23c198dbd2e3ffd`; annotated tag `v0.9.0`
  resolves to that exact commit.
- Exact-main CI Quality run `31699316183` passed all eight required jobs.
- Governed Firebase `all` run `31701000896` and governed Vercel run
  `31701004013` both completed successfully from that tagged revision with
  deployed `v0.8.1` commit `31b7f8040667d6ae6158b5d16c1b3556193dde16`
  recorded as the target-specific rollback revision.
- Both public origins returned the same `index-rz2UsRhU.js` entry artifact,
  and each hosted workspace chunk contained the compiled `Living Opportunity`
  marker. This proves public artifact parity and reachability, not authenticated
  staff/portal behavior, production-data correctness, downstream provider
  outcomes, or recipient acceptance.
- Authenticated production acceptance subsequently completed the narrow quote
  lifecycle path in the disposable `mm05366-sandbox` organization: staff
  created and read back quote `Q-260813-1359-600681E8` at immutable revision
  `v0001`, exported its PDF, and observed the signed-out exact-token portal
  render and electronic acceptance receipt before exact cleanup. A controlled
  Resend attempt to a non-routable `.test` address was provider-accepted; this
  does not prove delivery, inbox receipt, or recipient viewing. A same-session
  cross-tenant read returned `403` while the owned record returned `200`.
  The disposable quote, version, portal projection, customer, receipt, role,
  claim, and Auth user were then deleted. This acceptance covers only that
  exercised path, not every staff role, provider, or production-data scenario.

## Current Release Candidate (Not Production)

- The Stripe Connect program has begun with a source-only organization
  authority prerequisite. New owner invitations are explicit, verified
  activation atomically binds one owner and leaves an immutable browser-private
  receipt, and browser principals can no longer create or rewrite role
  authority. The disposable provisioning emulator passes this owner path. No
  Accounts v2 connected account, Stripe API call, hosted onboarding, charge,
  payout, refund, dispute, provider evidence, deployment, or human acceptance
  exists from this slice; the current deposit, final-balance, and buyer-access
  rails are unchanged.
- A second source-only checkpoint names Firebase `default` and `connect`
  Functions codebases, pins the existing Stripe package to `16.12.0` and the
  isolated Connect package to `22.5.0`, records the Connect API contract as
  `2026-07-29.dahlia`, and makes all existing production/candidate selectors
  address `functions:default` explicitly. The tracked staging manifest is
  Sandbox-only, unbound, provider-disabled, and rejects every infrastructure or
  callable claim; `functions-connect` exports nothing. This is local source and
  test evidence only, not a Connect deployment or provider result.
- A third source-only checkpoint adds an exact organization-owner backfill.
  Dry-run is the default; zero, multiple, incomplete, unverified, or conflicting
  consumed-invite candidates return `ownership_required`. Apply requires the
  dry-run owner UID and an exact project/organization/UID confirmation, then
  transactionally revalidates Firestore evidence before binding the organization,
  provisioning order, and immutable receipt. No production dry-run or apply has
  been performed.
- A fourth source-only checkpoint adds canonical owner/admin Team access
  authority. The same administrator operations surface now exposes an in-flow,
  exact-email role review with current role, consequence, do-nothing outcome,
  provenance, recent identity confirmation, replay-stable reconciliation, and
  a receipt. Owners alone may change admin authority; same-organization admins
  may manage sales access. The trusted Functions transaction revalidates the
  actor, target, organization, and expected role, writes a browser-private
  immutable receipt, then synchronizes custom claims. Disposable
  Auth/Functions/Firestore emulator acceptance passed promotion, sales grant,
  replay, owner-demotion denial, cross-authority denial, and claims sync. App
  Check remains in monitoring mode: no reCAPTCHA Enterprise provider/site key
  was registered or bound, no limited-use token was consumed in a hosted
  environment, and no deployment, production role mutation, or human
  acceptance is claimed.
- A fifth source-only checkpoint adds a pinned, staging-only Terraform
  foundation and credential-free validation workflow. It defines—but has not
  planned or created—the named `connect-control` database, exact-database IAM,
  five isolated service accounts, seven empty secret containers, private
  serverless network, fixed NAT egress address, protected state bootstrap, and
  exact-repository/owner/branch/environment GitHub OIDC admission. A separate
  Firebase config targets only Connect functions and deny-all named-database
  browser rules. App Check registration remains structurally available but
  forced off, and no production Terraform root exists. Local pinned-provider
  `fmt`, offline-backend `init`, and `validate` pass for bootstrap and staging;
  the isolated Firestore emulator also compiles the named-database deny rules.
  This is source/local evidence only: no cloud-authenticated plan, apply, GCP
  resource, App Check key, Stripe binding, deployment, hosted verification, or
  human acceptance exists.
- A sixth source-only checkpoint defines—but does not export—the strict
  Connect status/onboarding and one-use same-tab handoff contracts. Browser
  payloads cannot name an organization; verified admin claims supply tenant
  scope, cached status is redacted, limiter storage accepts only a separately
  HMAC-hashed principal digest, and owner onboarding requires exact
  revision/generation/digest evidence, recent authentication, and an unused App
  Check token. Provider access remains behind injected, unbound adapters. The
  internal POST handoff keeps its token out of the URL/referrer, stores only an
  HMAC token digest, consumes before Account Link creation, never returns the
  Stripe URL to application JavaScript, and
  records only bounded expiry/attempt evidence. `functions-connect` still
  exports nothing. Focused local tests and a credential-free source policy
  pass; no callable, HTTP handoff export, provider request, deployment, hosted
  result, or human acceptance exists.
- A seventh source-only checkpoint implements, but does not instantiate, an
  exact `connect-control` repository, transactional durable limiter, and
  injected Accounts v2 Sandbox adapter. The repository reserves one immutable
  connection generation and stable 30-day provider idempotency identity before
  access, binds a platform/mode/account identity to only one organization and
  generation, quarantines collisions, preserves one-use handoffs, and stores
  redacted replay receipts. The limiter enforces fixed principal and
  organization windows in one transaction, stores neither raw UID nor
  organization ID, and denies access when state is unavailable. The adapter
  accepts only the approved US/USD merchant configuration with full Stripe
  Dashboard access, Stripe fee and negative-balance responsibility, direct-
  charge semantics, and Sandbox mode. Failure injection proves that a provider
  success followed by database interruption reuses the same idempotency key
  and converges on one binding and receipt. The staging manifest remains
  provider-disabled and unbound, and `functions-connect/index.js` still exports
  nothing. This is source/local evidence only: no applied database, credential,
  Stripe request, connected account, Account Link, callable/HTTP export,
  deployment, hosted result, or human acceptance exists.

- Current `main` is tagged `v0.8.1` at
  `31b7f8040667d6ae6158b5d16c1b3556193dde16`; the tag enables the Ambient
  presentation in both production workflow build environments. The live
  deployment receipts below still identify `v0.7.0`, so this source state is
  not evidence that `v0.8.1` was deployed or accepted.
- The work after `v0.7.0` is the proposed `v0.8.1` source candidate. This
  source snapshot does not itself establish a published candidate head, release
  tag, exact-candidate CI run, governed deployment receipt, or production
  acceptance; each requires its separate Git, CI, provider, or human evidence.
- The fixed Firebase staging project now has enabled placeholder versions for
  the two previously absent Secret Manager bindings required to deploy the
  complete Functions graph. No value was recorded, no production secret was
  changed, and the associated webhook and Revenue Autopilot authority gates
  remain explicitly disabled.
- The tracked v3 UAT checklist now binds the fixed candidate to the
  `staging-safe-off` profile and classifies every target item as applicable or
  blocked with an explicit reason. For the current checklist, Firebase-all is
  14 applicable / 19 blocked, each browser-only target is 9 / 7, and the narrow
  Firebase backend target is 10 / 14. These counts are profile classification,
  not passed UAT. Positive buyer, delivery, payment, contract-conversion, and
  authoritative-staffing paths remain blocked by the fixed fail-closed gates;
  the all-positive exact-main attestation still requires every target item.
  No candidate deployment, hosted pass, attestation, production promotion, or
  human acceptance is implied.
- The ordinary Ambient-off production-flag build now selects a dedicated
  v0.7-compatible workspace graph at build time while Ambient candidates select
  the replacement graph. Local mode-specific `.env` flags and explicit release
  shell overrides resolve consistently. The compatibility boundary retains
  portal-token isolation, unsaved quote/Catalog recovery, and privacy-bounded
  analytics, and passes the existing bundle ceiling without increasing it.
  This is local source/build qualification only; no hosted candidate or
  production runtime changed.
- The `v0.7.0` deployment receipts do not establish authenticated hosted-role
  behavior, production-data correctness, downstream provider acceptance,
  recipient evidence, or human acceptance.
- The current post-`v0.8.1` candidate contains the Ambient Intelligence build.
  **All 50 stable AIUI items are materially implemented in local source, while
  0 of 50 are formally closed.** This now
  includes the compatibility inventory/browser baseline; extracted workspace
  shell and saved-draft hydration seams; canonical Ambient signal and action
  kernels; unified client/server `ImpactPreview`; the Living Opportunity;
  intelligent guest, event-logistics, Package/Menu, staffing, pricing, and
  selection objects; integrated Money, Proposal, and Conversation objects;
  sensory semantics; accessibility proof; bounded Pilot command classes,
  deterministic explanations and exact Package changes, and bounded under-
  budget/improve-margin scenarios with an explicit draft review; client-
  observed product metrics; and dead-click/layout recovery. The final material
  additions include AIUI-16 (lightweight persistent orientation plus one
  context-resolving global Pilot trigger), AIUI-17 (the bounded Ambient NOW
  briefing), AIUI-18 (the editorial Opportunities stream and exact Living
  Opportunity handoff), AIUI-19 (the lighter Clients directory, relationship
  overview, and exact client handoff), AIUI-20 (the role-safe Library, first-
  class Event Templates, and exact guarded editor arrivals), AIUI-40 (exact Workflow, Approval,
  Messages, Schedule, and Reporting arrivals), and AIUI-41 (the in-flow mobile
  Living Opportunity remote), and AIUI-46 (the content-first customer decision
  room), AIUI-43 (hold-to-capture Ambient Pilot voice with deterministic
  preview-before-apply), and AIUI-50 (the protected zero-dead-click Alpha
  browser gate plus its fail-closed configuration policy); AIUI-04 (the
  Opportunities/Event Room/role-safe action controller seam); AIUI-12 (the
  shared purpose-bearing editorial surface grammar); AIUI-35 (separate
  acceptance, contract, payment, BEO, staffing, and closeout receipt domains);
  AIUI-42 (shared pointer-gesture resolution with visible and keyboard
  equivalents); and AIUI-48 (Ambient-graph route retirement plus fail-closed
  rollback-retirement readiness). Ambient NOW
  preserves the existing ranked Workflow order but shows at most three
  priorities, withholds caught-up language for incomplete evidence or recorded
  payment steps, and limits quiet progress to timestamp-backed internal
  workflow receipts. All 50 remain partial against their complete acceptance
  contracts.
  The exact CI-equivalent production Ambient build passes locally with 3,714,204 total
  JavaScript bytes and a 391,901-byte largest chunk, inside the existing
  temporary ceiling without recalibration. Its selected graph excludes the
  replaced Command Center, redundant search palette, and legacy Clients table;
  those surfaces remain available through the compatibility build. The compatibility core lane passes
  3,570 unit tests with 74 intentional skips, and the production-equivalent
  Ambient browser proof passes the exact zero-dead-click contract plus all 80
  no-unintended-overlap cases across the supported widths and contained overlay
  states. This is local source, unit, build, and browser evidence only; no
  hosted candidate, production promotion, provider outcome, or human acceptance
  is established.
  The AIUI-18 stream is a presentation over the caller-owned, already tenant-
  scoped bounded quote read. It presents identity and four independent momentum
  domains, permits a percentage only for proposal completeness, and keeps quote
  lifecycle, booking confirmation, deposit, and final-balance evidence
  separate. Each row exposes one deterministic next action; opening an
  opportunity carries its exact opaque identity and focused arrival context to
  the canonical Living Opportunity. The complete legacy role-gated controls
  remain available under **Quote administration**, and browser-local fallback
  is labeled as local rather than server or provider confirmation. This adds no
  data, role, pricing, save, provider, or lifecycle authority.
  The AIUI-19 Clients presentation uses the caller-owned bounded directory and
  client relationship reads without adding a lookup, mutation, ranking claim,
  or new authority. The directory opens one exact opaque client identity. The
  relationship view leads with the client, active opportunities found in the
  completed read, recorded conversation context, and one supported next step;
  its exact arrival is resolved only after the matching client is loaded and
  focused. Mismatched or missing arrival context recovers without substituting
  another client. Existing history, rebook, communication, commercial, and
  role-gated controls remain available under **More client history and
  controls**, and local records remain labeled as browser-local rather than
  customer, provider, payment, booking, or delivery confirmation.
  The AIUI-20 Library is an administrator-only presentation over the existing
  organization-scoped catalog snapshot and save authority. It separates
  Catalog choices from first-class Event Templates, shows source, observation,
  **Catalog version**, and pricing-review boundaries, and chooses one
  deterministic next step. Incomplete event-specific menu inventory remains
  unavailable rather
  than being misreported as empty. Section and template actions acknowledge
  immediately, then open the exact existing guarded editor context; structured
  template changes preserve stable IDs and linked-item references and continue
  through the existing revision-conflict and save path. Catalog-setting and
  managed-menu dirty domains cannot advance together; one must be finished or
  explicitly discarded first. All seven managed-menu mutations require the
  loaded catalog revision and validate it inside the Firebase transaction or
  local commit before writing; local fallback compares the active
  organization's catalog revision. Unsaved editor work survives ordinary
  workspace navigation; unload, portal, and sign-out boundaries remain guarded;
  and fresher catalog evidence cannot silently replace a dirty draft. A portal
  provider remount waits for the App-level guard to accept the token transition,
  while direct initial portal precedence and token-to-token isolation remain.
  Invalid exact arrivals show a visible contextual recovery. Browser-local catalog
  caches are isolated by organization and remain explicitly local, and a sales
  user receives a contextual role boundary rather than a generic destination.
  This adds no read, role, pricing, mutation, provider, or new persistence
  authority.
  AIUI-46 now gives the combined Decision Room plus default-off Ambient
  exact-token customer portal a calmer,
  content-first reading order across Event, Menu and service, Pricing,
  assumptions, tenant terms, optional additions, response, and questions.
  Contextual question actions reuse the one existing conversation composer and
  acknowledge staged text, preserved drafts, unresolved sends, read-only
  threads, and unavailable conversations. Staff-marked additions prepare only
  reversible ordinary change-request lines; customer-authored text is never
  removed as generated content. Browser-local exact-token fallback mirrors the
  same bounded terms and option shape as the canonical projection. A focused
  local suite passes for helper, portal, conversation, and fallback behavior;
  a dedicated four-case Chromium lane passes at 390, 768, and 1440px with
  44px targets, axe, overflow, clipping, collision, and proposal-nonmutation
  checks. The local proof images are source evidence only. No new customer
  read, callable, direct quote mutation, pricing authority, payment, booking,
  or provider evidence is introduced; connected exact-token behavior,
  deployment, production data, provider outcomes, and human acceptance remain
  open.
  The production workflows intentionally omit `VITE_AMBIENT_UI_ENABLED` and
  `VITE_OPERATIONAL_STAFFING_ENABLED`. The proposed release therefore retains
  the `v0.7.0` Pilot command and customer decision-room behavior; AIUI-38/39,
  AIUI-46, the Ambient shell, hold-to-capture voice, and staffing presentation
  remain dormant. Firebase `all` may publish staffing endpoints and deny-only
  rules, but the generated Functions environment explicitly keeps
  `OPERATIONAL_STAFFING_AUTHORITY_ENABLED=false`, and the exact tenant gate
  remains independently required.
  Focused local proof for this Library slice passes 122 of 122 tests across its
  pure model, structured Event Templates editor, exact-arrival contract, route, role
  boundary, fallback isolation, and existing Catalog Admin tests. A dedicated
  Chromium-admin lane passes 7 of 7 cases across 390, 768, and 1440px with
  exact object focus, sub-250ms acknowledgement, preserved unsaved work,
  guarded focus restoration, 44px pointer targets, axe, overflow, and collision
  checks. Three overview images and one focused mobile template-editor image
  are local visual evidence only.
  Package/Menu replacement and equivalent pointer/keyboard reorder handoffs
  are accepted only against the exact parent opportunity revision and fresh
  same-tenant catalog evidence. They arrive in a populated editor review with
  human-readable saved/proposed values and explicit Apply or Keep outcomes;
  Apply changes only the isolated draft and still requires an outcome-named
  trusted save. Proposal preserves saved revision, authoritative pricing,
  customer projection, portal issuance, and provider evidence without
  performing prepare/send/rotate/recover mutations. Conversation keeps sent,
  provider-delivered, portal-viewed, replied, and inferred-engagement evidence
  independent; its inspector sends nothing and marks nothing read. Pilot's
  deterministic blocker, price, authorized-margin, and client-summary answers
  expose confidence and provenance. Scenario adoption binds the exact tenant,
  catalog observation, proposal, and changed draft fields into an immutable
  review before an explicit Apply or Keep; Apply remains in-memory, and trusted
  save retains authoritative repricing/version authority. The partial items
  retain explicit open boundaries: AIUI-18 lacks proved full legacy parity and
  retirement, universal cross-domain ranking/freshness, hosted behavior, and
  human acceptance; AIUI-19 has local responsive browser proof but still needs
  hosted role and production-data review, rollback-release evidence, and human
  acceptance; authentication and organization
  state have not fully left `App.jsx`, the draft runtime is not yet the complete
  reducer/command owner, event-logistics draft intent is not consumed by
  focused editor controls, Package/Menu price/margin and inclusion
  reconciliation remain open, the Money inspector remains read-only rather than
  owning governed request/settlement actions, Proposal and Conversation retain
  their existing governed action surfaces, and canonical signals now drive the
  bounded Ambient NOW priorities but are not yet integrated through every
  object. AIUI-16 still lacks complete
  interpreted-destination parity beyond its exact opportunity, draft-focus,
  and choose-an-opportunity outcomes. AIUI-40 now consumes exact supported
  Schedule event/conflict arrivals and three strict Reporting targets in
  addition to Workflow, Approval, and Messages. Authoritative operational
  staffing remains non-primary-ready in Schedule rather than being conflated
  with its legacy staff-lead field. AIUI-41 keeps its next action in normal flow to avoid covering content;
  sticky behavior and complete mobile parity remain open.
  The exact-arrival contract carries only allowlisted semantics and opaque
  identifiers, keeps exact customer-message identity out of the URL, and treats
  transport as pending until its supported destination proves the exact item
  was loaded and focused. A missing, stale, truncated, or unavailable item
  recovers without substituting another. The accepted source-only architecture
  decision is recorded in `docs/AMBIENT_WORKSPACE_ARRIVAL_ADR.md`.
  AIUI-29's independently gated operational authority covers tenant-isolated
  roster profiles, operator-recorded availability, conflict-safe assignments,
  explicit coverage gaps, and immutable receipts. AIUI-47 now has material
  local source: the existing product-event rail accepts privacy-bounded 250ms
  primary-action assessments, first intent paired only with an exact
  server-authoritative Firebase saved-draft receipt, and issue timing paired
  only by the same bounded category in the same staff session; Reporting labels
  these as client observations rather than server timing. AIUI-49's expanded
  browser audit is also material but not a permanent release gate. This
  candidate source is not part of `v0.7.0`; compatibility
  parity, hosted roles, rollback-release evidence, timed comprehension,
  production-data acceptance, and human acceptance remain open.

## Operational Health

- Production runtime: `v0.7.0` is live from commit
  `fb0aacc1c5c9f6c4ba8733f87c98c7b58e1611bd`, tagged `v0.7.0`.
- Exact-main CI: run `31528176575` passed all eight required jobs.
- Firebase: `all` deployment run `31529170963` updated Hosting, Firestore rules,
  indexes, and Functions, then verified `https://tonicatering.web.app`.
- Vercel: deployment run `31530050353` promoted immutable deployment
  `quoteflow-duqhsqfau-mbmapps.vercel.app` and rebound
  `https://quotepilot.mbmapps.com`.
- Public reachability: `/`, `/app`, and `/app/messages` returned HTTP 200 on
  the production edge; `/` and `/app` also returned HTTP 200 on the Firebase
  origin.
- Runtime inventory: Firebase lists 75 Functions. The newly deployed callable
  `recordChangeRequestParse` reports `ACTIVE` on Node.js 22 in `us-central1`.
- `v0.7.0` release-receipt parity: both production workflows checked out that
  exact tagged release SHA. This documentation correction does not change the
  deployed runtime.
- Credential health: local Firebase CLI access to `tonicatering` and the
  protected GitHub Firebase deployment credential were renewed and
  authenticated on August 10. No credential values are stored in tracked files.

These receipts prove source promotion, provider acceptance of the deployments,
and public route reachability. They do not prove authenticated staff behavior,
production-data correctness, external provider delivery, recipient receipt, or
human acceptance.

## Production Capability State

### Enabled and deployed

- Customer-centered staff workspace, including the Command Center, routed
  Quotes, CWF-16 Event Workspace, Customer Directory, Internal Customer 360,
  Event Messaging Station, Workflow, Schedule, Reporting, Catalog, Imports,
  Integrations, and Diagnostics.
- Deterministic event intelligence and proposal-completeness presentation. The
  UI continues to return `Unavailable` for unsupported Flexibility or Alignment
  evidence instead of manufacturing a score.
- Trusted quote creation, update, duplicate, reopen, exact-version rebook,
  lifecycle history, proposal export, and server-authoritative pricing.
- Exact-token customer proposal portal, authoritative proposal acceptance,
  request-changes/decline paths, portal recovery, portal rotation, and
  quote-scoped staff/customer conversation exchange.
- Customer and catalog CSV import/rollback, blank-catalog onboarding, starter
  catalog packs, reviewed pricing confirmation, and conflict-safe catalog
  revision handling.
- Workflow Attention, approvals, post-event closeout, bounded schedule/run-of-
  show, bounded reporting, product analytics, and Operations Audit surfaces.
- Commercial Change simulation/authorization/reconciliation callables, trusted
  Kitchen BEO receipts, deterministic dependency invalidation, and Decision
  Debt projection are deployed. Enforcement remains dormant unless both the
  global and exact tenant gates are enabled.
- Revenue Autopilot policy, customer-control, materialization, reconciliation,
  unsubscribe, scheduler, and signed Resend-webhook callables are deployed.
  Runtime and outbound gates remain off.
- Primary quote email configuration is deployed with the approved restricted
  Resend sender. Configuration presence is not provider-accepted delivery,
  delivered-event, or recipient-inbox proof.
- Primary quote Stripe runtime is configured for live mode. Deposit and final-
  balance code, signed webhook handling, reconciliation, and customer-safe
  projection are deployed; exact hosted/provider acceptance for each rail is
  still required before broad operational claims.

Authenticated hosted use and human acceptance remain separate for the listed
staff capabilities even where source, local/emulator, CI, deployment, and public
route evidence are complete.

### Deployed but intentionally dormant

| Capability | Current gate | Reason it remains off |
|---|---|---|
| Public buyer onboarding backend | `BUYER_ACCESS_ENABLED=false` | The browser route and Turnstile site key are live, but the bound buyer Stripe credential identifies as live mode while the buyer contract requires a dedicated test-mode key. The restricted key also cannot prove the required test webhook inventory. |
| Commercial Change enforcement | global `false`; all five observed tenant gates off | Simulation and evidence review remain usable. Enforcement requires authenticated admin-role acceptance and a separately authorized exact tenant gate. |
| Revenue Autopilot preparation | `REVENUE_AUTOPILOT_ENABLED=false`; no observed tenant policies | The complete local authority matrix passes, but an authenticated hosted admin acceptance is still required before the global preparation-only gate is promoted. |
| Revenue Autopilot outbound sends | `REVENUE_AUTOPILOT_SENDS_ENABLED=false` | The restricted Resend key can send but cannot independently verify webhook registration. Signed provider webhook, delivery/bounce/complaint, and recipient evidence remain open. |
| SMS | `NOTIFICATIONS_SMS_PROVIDER=none` | The Twilio Messaging Service has no approved US A2P registration. Repeated carrier-rejected tests are prohibited until approval. |
| CRM synchronization | disabled | No reviewed server-authorized connector with provider acceptance is deployed. |

## Current Validation Evidence

- The dormant Connect repository/limiter/adapter slice passes its credential-
  free source policy and 26 focused tests. Those tests cover exact named-
  database selection, stable generation reservation, 30-day Accounts v2
  idempotency recovery, unique provider-account binding, collision quarantine,
  replay receipts, one-use handoffs, multi-window transactional rate limits,
  limiter-state failure, exact Accounts v2 merchant payloads, Sandbox/mode/
  responsibility/origin denial, status projection, and interrupted-completion
  convergence. This is source/local evidence only and made no provider or cloud
  request.

- The Ambient zero-dead-click release contract now runs as a dedicated step in
  the protected Playwright CI lane with the production presentation flags and
  operational staffing explicitly disabled. A fail-closed `lane:quick` policy
  check protects the command, flags, workflow bindings, enabled-control mapping,
  and zero-rate assertion. Local proof passes 24 focused monitor/runtime/policy
  tests, the 1-of-1 Chromium-admin release-gate case, the current 301-file /
  3,518-test unit lane, capability-surfacing check,
  documentation governance, workflow lint, and its existing bundle budget.
  CI now has independent, graph-detected compatibility and Ambient production
  build steps. After the owner-provisioning recovery and owner/admin Team access
  authority, fresh local production-flag builds measure 2,784,674 / 391,901
  bytes for compatibility and 3,715,051 / 391,901 for Ambient. The exact
  quote-builder decision-flow candidate measures 2,791,568 / 391,901 for
  compatibility and 3,723,445 / 391,901 for Ambient. Its exact temporary
  ceilings are 2,791,699 and 3,723,748 aggregate bytes respectively,
  retaining only the previously observed per-profile CI offsets; both use the
  391,901-byte largest-chunk ceiling. App Check provider code is excluded while
  its browser flag is off. This remains an explicit temporary exception
  requiring optimization or reviewed recalibration and is source/local evidence;
  preview deployment, hosted roles and portal behavior, production timing,
  human acceptance, and rollback evidence remain open.

- The authoritative operational staffing source passes 77 focused
  server/runtime/client tests and 19 focused panel tests (96 focused tests
  combined), the now 70-test Firestore
  rules lane, and a disposable Auth/Firestore/Functions emulator matrix. The
  emulator proves global and exact-tenant gates, role and cross-tenant denial,
  immutable-revision derivation, DST/time/count validation, idempotent replay,
  revision conflicts, overlap exclusion, half-open adjacency, atomic rollback,
  and non-mutation of quote, portal, payment, booking, and BEO evidence. This is
  local/emulator evidence only; the feature is not deployed or tenant-enabled.
- The local default-off Ambient slice has focused contract/component proof. Its
  AIUI-19 Clients slice passes 15 of 15 client-model tests and 8 of 8 component
  tests (23 of 23 combined), 18 of 18 legacy Customer Directory/Customer 360
  tests, 19 of 19 exact-arrival contract tests, and the local production build.
  Its dedicated Chromium-admin lane passes 3 of 3 cases at 390, 768, and
  1440px with exact client arrival, 44px controls, zero axe violations, no
  horizontal overflow, and no audited overlap; six directory and relationship
  images were captured locally. The flag-off production build excludes the
  Ambient Clients chunk and passes the existing bundle ceiling without a new
  exception. These are source and local-test results only;
  hosted-role, production-data, provider, and human acceptance remain open. Its
  targeted 390px mobile comprehension and axe case passes after the top layer
  was reduced to one in-flow remote and its action contrast was corrected. The
  last completed full no-unintended-overlap Chromium-admin browser gate
  passes 80 of 80 local cases with 0 failed or skipped in 6.3 minutes across
  390×844, 768×900, and 1440×1000. Its matrix contains 45 route cases; three
  Library template-editor cases; 27 header, search, context, and Pilot cases;
  two mobile Live Breakdown cases; and three editor review/feedback cases. Its
  15 exact routes cover Now, Quotes (the
  current Opportunities proxy), Customer Directory and Customer 360, Catalog
  Admin (the current Library proxy), Messages, Living Opportunity, Workflow,
  Schedule, Reporting, Imports, Integrations, Diagnostics, not-found, and the
  exact-token customer portal. It
  also opens the header More, Operations, and Account popovers, Workspace
  search, Package, Money, Proposal, and Conversation contexts, mobile Live
  Breakdown, deterministic Pilot answers, the explicit Pilot scenario review,
  and the draft-review/feedback flow. The systemic audit reserves focus paint,
  rejects peer collisions and undeclared overlays, and walks visible controls
  to prove viewport, clipping, scroll, horizontal-overflow, and focus
  containment. Collisions, overflow, escaped controls, escaped focus paint, and
  undeclared overlays remain empty; document overflow is at most 1px, and the
  Messages focused title-to-subtitle clearance is at least 8px.
  Sales-role geometry, Firefox/WebKit, zoom and safe-area behavior, connected
  portal conversation/Ask states, maximum-result search states, and hosted/
  provider/human acceptance remain open; AIUI-49 is therefore material but not
  closed. The full post-hardening accessibility lane also passes 11 of 11 local
  cases. This is source/local browser evidence only.

- The last completed full flag-enabled local Ambient object-verification
  browser lane passes 40 of 40 cases. It covers responsive Event Logistics,
  Package/Menu, Selection, Money, Proposal, Conversation, and global Pilot context at 390, 768, and
  1440px; exact Package and keyboard-equivalent Menu handoffs; Package adoption
  into the draft with an outcome-named save; pending-review dead-save recovery;
  date, pricing, and mobile Staffing contexts; the focused Messages heading at
  all three widths; and transient editor feedback rendered in normal flow with
  zero collision against the Package/Menu review or Live Breakdown. Proposal
  and Conversation proof asserts populated arrival context, independent
  evidence rails, no inline send/mark-read authority, exact focus restoration,
  no horizontal overflow, and saved-quote non-mutation. This is local browser
  evidence only; it does not establish deployment, production-data behavior,
  provider outcomes, or human acceptance. The fresh run includes strict invalid-
  arrival recovery and the single-layer mobile Event disclosure.

- The `v0.6.0` checkpoint passed 202 unit files with 2,390 tests (plus the
  documented skips), the full 59-test default browser suite, the exact
  production-flag matrix, 63 Firestore rules tests, Firebase Auth/rules and
  authoritative-pricing browser lanes, CWV, bundle, governance, Docker, and all
  exact-main CI gates.
- The August 10 customer-centered authority emulator acceptance passed against
  real Auth, Firestore, and Functions emulators with Commercial Change
  enforcement and Revenue Autopilot preparation enabled while outbound sends
  stayed off. It covered governed quote change, apply-outcome reconciliation,
  Kitchen BEO freshness, Decision Debt, Autopilot policy/customer controls,
  deterministic materialization, unread-reply Attention, acknowledgement, and
  signed Resend webhook tamper rejection.
- Production configuration inspection found five organization documents and
  four organization-scoped admin role documents. No observed organization had
  Commercial Change enforcement enabled, and no observed organization had a
  configured Revenue Autopilot policy.
- An attempted hosted app sign-in correctly rejected the Firebase CLI Google
  OAuth token because its audience is not the QuotePilot Firebase Auth client.
  That boundary was preserved; authenticated hosted acceptance still requires
  a real QuotePilot user session.

## Active Risks

1. Authenticated production acceptance is incomplete for quote save/readback,
   export, Event Workspace, Customer 360, Messaging Station, Commercial Change,
   Kitchen BEO, Decision Debt, Revenue Autopilot, and operational staffing.
2. Public buyer onboarding must not be enabled with the current live-mode buyer
   Stripe credential. Replace it with a dedicated test-mode restricted key,
   verify the exact webhook endpoint/events, then run the coordinated Turnstile,
   invoice, signed-webhook, activation, and negative-path acceptance window.
3. Resend configuration and historical domain verification do not prove an
   exact current provider acceptance, delivered event, or recipient inbox.
4. Commercial Change enforcement has no production tenant enabled. Keep it off
   until role-specific hosted acceptance and exact tenant authorization close.
5. Revenue Autopilot outbound sends lack independently verified provider webhook
   registration and hosted scheduler/provider acceptance. Keep sends off.
6. Twilio SMS lacks A2P approval. Keep SMS off and avoid additional carrier-
   rejected tests.
7. A disposable second-tenant create/activate/isolation/cleanup acceptance is
   still required. Existing organization documents do not substitute for that
   exact lifecycle proof.
8. Portal projection and legacy customer-identity normalization remain guarded
   data operations. Run tenant-scoped dry runs and review conflicts before any
   production apply.
9. The customer-centered convergence bundle still uses the named temporary
   no-headroom exception. Optimization or reviewed clean-main recalibration is
   required before removing it.
10. `functions.config()` compatibility remains in source and must migrate before
    Firebase removes the legacy API in March 2027.
11. The repository still lacks an independent human reviewer for stronger
    pre-merge and production UAT separation in the current solo-operator model.
12. Operational staffing is source-only and independently default-off. Do not
    bind or promote its presentation, server, or tenant gates until exact hosted
    admin/sales/customer denial, responsive accessibility, rollback, and one
    explicitly approved tenant acceptance are recorded.
13. The fixed `staging-safe-off` candidate cannot by itself satisfy the
    all-positive release checklist. Provider-backed buyer, delivery, payment,
    contract-conversion, and authoritative-staffing items need a separately
    reviewed immutable non-production acceptance window; blocked profile items
    cannot be omitted or attested as passed.

## Current Focus

1. Complete an authenticated production operator pass for quote create/save/
   readback/export and the customer-centered routes using an actual QuotePilot
   user session.
2. Replace and verify the buyer Stripe credential in test mode before opening a
   bounded buyer-access acceptance window.
3. Verify the Revenue Autopilot Resend webhook in the provider dashboard, then
   promote preparation-only mode first; keep outbound sends disabled until a
   separate provider-delivery acceptance.
4. Capture one controlled Resend quote-delivery attempt with provider accepted,
   delivered/bounced reconciliation, and recipient-inbox evidence kept distinct.
5. Run the disposable second-tenant lifecycle and hosted cross-tenant/portal
   denial matrix.
6. Complete the bundle-exception closure path and continue `functions.config()`
   migration planning.
7. Define and review an exact-SHA non-production acceptance profile for the
   currently blocked provider and authoritative-staffing UAT items before any
   all-positive attestation or production-intent merge.

Open work and priority sequencing live in [`DEV_TASKS.md`](DEV_TASKS.md).
Historical shipped changes live in [`CHANGELOG.md`](CHANGELOG.md).
