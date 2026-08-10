# Project Status

Last updated: August 9, 2026

## Operational Health
- Runtime: release `v0.2.3` is live from merged `main` commit
  `d2747c693e4d15d0efc66cb3bbd76b03f31009f4`. Main CI run `31059404835`
  passed every required lane. The public custom domain
  (`https://quotepilot.mbmapps.com`) is aliased to Vercel production deployment
  `dpl_DgDTcfpR411dXZ9x3hZhR6Gigf6Z`, which is provider-reported `READY`.
  Firebase Hosting remains the origin/fallback (`https://tonicatering.web.app`)
  and was released with the same tagged source revision.
- Release candidate: the customer-centered workspace convergence plus CWF-16
  stabilization is merged to `main` at
  `91528d945b29a95362366d5dcaf332f70fd57dd8`. Exact-main CI run
  `31344333805` passed all eight hard-gate jobs. Vercel preview deployment
  `dpl_4WFBtPSnzMgMbRmvCGS6cAEUBwR3` is provider-reported `READY` and binds
  that exact SHA. This is immutable staging evidence only;
  production aliases, Firebase Hosting, Functions, Firestore rules/indexes,
  runtime flags, hosted UAT, and human acceptance have not been promoted or
  claimed for this candidate.
- Current source product identity: public, authentication, workspace, customer
  portal, proposal, install metadata, integration, and onboarding surfaces use
  the exact `QuotePilot by MBMApps` identity. The workspace header now labels
  the tenant business separately, preserving customer-specific proposal and
  portal branding. The legacy `tonicatering` Firebase project, hosting site,
  environment filename, deployment confirmations, and service URLs remain
  unchanged infrastructure identifiers.
- The August 9 CWF-16 candidate checkpoint passed 177 unit files with 2,234
  tests (4 files / 65 tests skipped). Default Playwright passed 58
  tests with 20 intentionally flag-gated skips; the complete flag-on workspace
  and accessibility run passed 21/21. Firestore rules passed 61/61 on isolated
  ports, the Firebase staff/portal browser lane passed 4/4, and authoritative
  quote-write coverage passed 3/3. The Firebase lane exposed and then verified
  the fix for an invalid absent Attention-pointer delete sentinel during staff
  conversation send. The production build transformed 4,976 modules and emitted
  2,650,137 aggregate JavaScript bytes with a 390,494-byte largest chunk, within
  the exact named temporary exception. Environment, workflow, capability-
  surfacing, documentation-governance, secret, bundle, and diff checks passed.
  All of these are source/local/emulator results, not hosted tenant, provider,
  deployment, production-data, flag-promotion, or human-acceptance evidence.
- Functions runtime readiness: all 29 production Functions now run on Node.js
  22 with Firebase Admin 14 modular app, Auth, and Firestore APIs. The clean
  cloud install and each function update completed successfully from `v0.2.3`;
  the local authoritative and provisioning matrices also pass.
- Test coverage: unit + Playwright smoke suites are configured in CI.
- Current source uses a named temporary bundle exception while the
  customer-centered workspace convergence completes release qualification. Its
  no-headroom
  ceilings match the August 9 CWF-16 source/local candidate build at 2,650,137
  aggregate JavaScript bytes and a 390,494-byte largest chunk, versus
  unchanged pre-convergence main metrics of
  1,997,365 and 387,929 bytes. The normal allowance remains 5%, baseline updates
  are blocked while the exception is active, and closure requires the explicit
  optimization or reviewed clean-main recalibration path plus local bundle,
  browser, and CWV qualification. This is not hosted, production, or human-
  acceptance evidence. A targeted quote-store split reduced the authenticated
  route chunk from 448,190 to 310,102 bytes, leaving Firebase as the largest
  chunk at 390,494 bytes and under the normal per-chunk ceiling.
- Current source delivery governance includes a required no-orphan-capability
  check in `lane:core`. It reviews the whole branch/PR backend diff, requires a
  versioned capability-surfacing contract manifest plus real frontend/Feature
  Matrix/User Manual locators and assertion-bearing canonical per-state
  read/mutation tests,
  owns directly changed, new, or removed Firebase Functions by exact symbol,
  and records declared callable impacts from shared helpers. Git comparisons
  and merge-base resolution fail closed, deleted authority paths remain in
  scope, and narrow headless classifications require safe outcomes, executable
  authority tests, and no callable ownership. This is structural traceability
  evidence, not semantic completeness or proof of visual polish, hosted
  availability, provider behavior, production promotion, or human acceptance.
- CWF-16 is merged/source complete behind the existing customer-centered
  workspace flag. `/app/quotes/:quoteId` is an event-first record over the
  existing bounded quote and Workflow contracts; `/app/quotes` remains quote
  administration and `/app/quotes/:quoteId/edit` remains the trusted editor.
  Exact identity, sold scope, lifecycle, attention, existing context routes,
  governed edit state, local/Firebase BEO boundaries, desktop/mobile layout,
  focus, and console-clean interaction have focused automated and same-state
  visual evidence. A central presentation-only deterministic selector now
  synthesizes exact Workflow Attention and proposal-readiness facts into
  Condition, proposal-scoped Readiness, and Needs You, with stable reason codes
  behind `Why?`; Flexibility and Alignment fail closed as `Unavailable`. It adds
  no backend/data authority and does not establish event-wide readiness,
  inventory, capacity, payment, booking, completion, deployment, hosted
  availability, flag promotion, or human acceptance. CWF-17 remains the next
  open source program for broader intelligence synthesis. No formal
  Flexibility/change-window contract, authoritative Operational Slack or
  Execution Fragility model, combined Alignment projection, or complete Change
  Impact synthesis exists yet.
- Main release governance supports the repository's actual solo-owner
  operating model without inventing an independent reviewer or second
  repository. The manual in-repository Firebase and Vercel paths retain exact
  tagged-main SHA, all-eight-job CI, one allowlisted human, protected-branch-only
  production environment, rollback ancestry, typed target confirmation, fixed
  provider identities, and a second live evidence check immediately before
  provider mutation. Provider tokens are scoped to the final deploy step.
  Vercel Git-triggered deployments remain disabled so merges cannot bypass the
  manual gate. Deployment and post-launch/provider/human acceptance remain
  distinct evidence.
- Current source workflow delivery: proposal readiness, Good/Better/Best
  scenarios, quote lifecycle timelines, lead follow-ups, sensitive-action
  approval requests, the customer decision center, and event production
  checklists are implemented and locally covered. A tenant-scoped Workflow
  Attention queue now consolidates due follow-ups, pending approvals, and
  current customer change requests. Its post-idle header count preserves the
  lazy workspace boundary; request-ID-bound acknowledge/handled state is internal
  only and never edits customer decision evidence or sends email/SMS.
- Current merged customer-centered workspace: a dependency-free History API
  route layer defines `/app` Home, Customers, Quotes, the sticky-mounted quote
  builder, focused quote/edit records, Workflow focus, Schedule, Reporting,
  Catalog, Imports, Integrations, Diagnostics, `/app/home` canonicalization,
  and authenticated in-shell 404 behavior. The six operational routes are
  recoverably lazy embedded views with their existing role/feature gates and
  sticky state continuity; contextual and legacy callers retain the guarded
  modal wrappers. The customer portal query remains route-preemptive. A
  temporary build flag defaults the new shell off pending exact hosted
  acceptance. Home and the attention badge consume one loading-aware,
  generation-guarded snapshot over the existing quote-history,
  workflow-attention, and bounded Revenue Autopilot operations contracts. The
  third existing read adds unread customer-reply Attention without introducing
  a new read contract, data source, or commercial write authority. Stable customer names in Home
  link to Customer 360, exact attention actions retain quote/type/request focus,
  and quote/payment actions retain exact quote focus. That focus now renders the
  CWF-16 Event Workspace instead of repeating the administration table while
  preserving existing Schedule, Customer, Workflow, BEO, PDF, conversation,
  role, lifecycle, and delivery boundaries. The neutral staff shell remains
  distinct from tenant-branded customer portal, proposal, and marketing
  surfaces. Covered desktop widths keep the action row contained; embedded
  operational routes plus Quotes and Workflow use route-appropriate return
  wording while true modals retain Close; accepted calendar facts stay distinct
  from booking holds; and Home, Customers, Quotes, Workflow, and operational
  routed headings have scoped visible focus. First-release staff surfaces use
  human-readable date, money, enum, source, identifier-fallback, and empty-state
  copy without changing canonical values. Home also exposes a read-only
  tenant/source/evidence rail over the same three existing reads, recording the
  last complete client read and distinguishing loading, refresh, incomplete,
  retained-stale, unavailable, latest-200 quote-history truncation, and
  latest-50 unread-reply Attention truncation states. The rail calls
  Home derived presentation and explicitly does not treat freshness as provider,
  customer, booking, payment, or completion evidence. The same surface-scoped
  trust pattern now covers Customer Directory and Customer 360 without retaining
  results across tenant/search/page/customer scope changes. The flagged shell
  also provides a recoverably lazy, staff-only `Ctrl`/`Command`+K search over six
  customer-prefix results and six matches from the latest 50 quotes. Search
  queries remain in memory, routes use opaque IDs, stale generations are ignored,
  and partial/error/retry/source/bounds states are explicit. Customer 360 adds a
  bounded `What matters next` briefing, a source-labeled recorded commercial
  timeline, and on-demand immutable-version comparison. The timeline omits
  provider delivery/bounce because the current DTO has no authoritative receipt
  fields for those milestones; version comparison reads stored version scope,
  schedule, server-pricing, and terms only and never recalculates history. This
  is current merged source. The closing qualification above covers this
  local convergence; hosted, deployment, production-data, and human-acceptance
  evidence remain separate and must not be inferred from the source claim.
- Current source quote-entry simplification: Step 1 keeps attendance and role
  counts in the primary flow while placing five exceptional staffing-rate
  values in Advanced Pricing. Existing saved/template values trigger a visible
  review warning and survive collapse/reopen; 1440px, 390px, and 320px layout
  containment is locally covered without changing pricing or persistence code.
- Current source draft handoff: the final wizard action explicitly saves a
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
- Current source interaction recovery: blank-catalog owners receive an
  executing starter-pack or manual-build path; catalog writes reconcile
  uncertain outcomes against the authoritative revision; tenant, menu, booking,
  and verification blockers expose retry, correction, schedule, or support
  actions; every lazy route and workspace tool has its own safe retry, reload,
  and close/back boundary; recovery reload protects unsaved quote work with a
  discard confirmation while Close tool preserves it; Import Studio catalog
  refreshes keep batch identity, receipts, Undo, and errors mounted while
  unresolved import controls stay locked; revisioned menu removal
  waits until unrelated Catalog Admin drafts are saved or discarded; and the
  contextual and legacy workspace dialogs share contained focus, safe Escape,
  body-scroll lock, close guards, and trigger restoration. In the flagged
  workspace, routed operational views use embedded-region focus and retain
  their busy/unsaved guards without applying dialog semantics.
  New-quote resets preserve canonical defaults without treating automatic
  values as unsaved user work. Focused unit, real chunk-failure browser, and
  dialog accessibility checks are local evidence only; these are not yet hosted
  human-acceptance guarantees.
- Current source quote conversation: same-tenant staff and the customer holding
  the exact current provider-accepted portal can load and exchange messages
  attached to the canonical quote. The server owns actor identity, display
  name, message ID, and timestamp; enforces a 1,200-character limit, total and
  rolling-window bounds, and client-request idempotency; and revalidates the
  quote, portal issuance, tenant, deletion, expiry, and delivery activation on
  every operation. Sent, viewed, accepted, and booked conversations remain
  writable, declined conversations are visibly read-only, and rotation makes
  the old token unusable while retaining history for a newly delivered current
  issuance. Direct browser access to conversation records is denied. Current
  source keeps unresolved send identity and unchanged body in bounded app
  memory across panel close/unmount, retains a global unload warning until an
  exact retry receipt or explicit safe reset, and writes neither value to
  browser storage. Focused unit/rules/emulator evidence is local only; this conversation source is not
  part of live `v0.2.3` and has no hosted staff/customer acceptance.
- Current source `CWF-15` authority candidate preserves the pure frozen
  Commercial Dependency Graph while adding separate server-owned simulation,
  sales request/admin authorization, gated atomic quote/version apply plus
  immutable invalidations, bounded dependency-state reconciliation, and
  deterministic Decision Debt. Workflow exposes the Debt factors/bounds and an
  admin-only versioned lock-policy editor; non-admin staff are read-only.
  Simulation presentation is reconstructed from the normalized immutable
  receipt and rejected client-side if scope or evidence diverges.
  `safeToPublish` is derived eligibility only and performs no publication.
  Both global and tenant enforcement gates default off. Transport-ambiguous
  governed apply now retains the exact request for a same-tenant reconciliation
  transaction: a committed outcome requires the deterministic apply receipt and
  immutable target version, while an absent apply writes a not-committed fence
  that the original transaction must observe before recovery. The UI never
  resubmits the edit and distinguishes reconciliation, committed receipt,
  fenced recovery, changed source, uncertainty, and definitive rejection.
  Refreshed local unit, rules, emulator, and browser qualification is complete;
  hosted role acceptance remains required before either gate may be enabled.
- Current source trusted Kitchen BEO authority reloads canonical data,
  generates server PDF bytes, records immutable actor/time/revision/schema/
  fingerprint/byte evidence, reports `CURRENT`, `STALE`, `REVIEW`,
  `NOT_GENERATED`, or `UNKNOWN`, and supports exact current and prior receipt
  download through `downloadKitchenBeoReceipt`. Generation replay, final
  response, status, and download validate strict base64 plus exact retained byte
  length/SHA-256. `CURRENT` follows the exact current-receipt pointer and
  revalidates its stored bytes. A successful current generation atomically
  resolves only qualifying open Kitchen BEO invalidations and exposes that exact
  reconciliation receipt; other commercial decisions remain open. The pointer
  retains a validated bounded history of the current and up to nine prior exact
  receipts for separate download. This proves declared-input freshness only—not
  kitchen review, publication, customer acceptance, booking, payment, delivery,
  or completion. The source/local invariant is not deployed or hosted-operator
  accepted.
- Decision Debt no longer assigns a fallback exposure multiplier when canonical
  commercial cents are unavailable. Those items remain visible with `UNKNOWN`
  score state and null factor/raw score/score/urgency; known-exposure items keep
  the same deterministic versioned formula and ordering.
- Current source authoritative-pricing consistency: the server now owns pricing
  actor identity and calculation time, fingerprints the confirmed tenant
  settings around the catalog read, and rechecks that authority at the trusted
  quote-create, duplicate, edit, rebook, and Change Impact boundary. A catalog
  revision, confirmation, or settings change aborts the operation with a
  recalculate-and-retry outcome instead of committing or presenting a stale
  authoritative result. This is source/local authority hardening, not a
  Functions deployment or hosted quote-write acceptance claim.
- Production marketing delivery: a hospitality-first prospect page is live at `/`, the prior dark product overview is live at `/system`, and the authenticated workspace resolves at `/app`; customer portal query routes retain precedence in the client router.
- Current source tenant onboarding delivery: admin-only Import Studio supports
  tenant-locked CSV preview/import for customers, packages, add-ons, rentals,
  and menu items. Customer create/rollback now joins catalog imports behind
  trusted callables; new customer records receive opaque stable IDs and
  server-owned normalized directory keys. Duplicate/collision decisions,
  actor receipts, exact-input replay, and modified-record rollback protection
  are emulator-covered. While submission or reconciliation is unresolved, the
  UI keeps the batch identity and locks Close/reset/source/file replacement;
  catalog-source recovery retries in place without clearing that identity.
  This callable change is source/local evidence and is
  not yet deployed or hosted-smoke-accepted.
- Current source starter-pack package scope: version 2 manifests add typed menu,
  add-on, and rental inclusion references without changing the addressable
  version 1 manifests. Inclusions remain explicit quote-builder choices labeled
  `Included at no added charge — select to add`; only selected refs reach
  server-derived quote, proposal, and portal snapshots, and authoritative
  pricing prevents a selected inclusion from being charged twice. This is
  source/local evidence and is not yet deployed or owner-accepted.
- Current candidate customer continuity and Internal Customer 360:
  authoritative create, duplicate, and edit transactions bind a server-owned
  stable `customerId` to new canonical quotes and immutable versions. New
  quote-projected customers receive generated opaque IDs; a private,
  browser-inaccessible normalized-email claim serializes same-tenant ownership
  for trusted quote and import transactions. Edits retain identity and reject
  a claim or record collision rather than silently reassigning it. Customer
  list rules require same-tenant staff plus an explicit limit of at most 101,
  matching the 100-record maximum page plus one pagination sentinel. Bounded
  Customer 360 reads derive Overview, Quotes & Proposals, Events, Money,
  Conversations, attention, and next-action projections without a persisted
  `commercialSummary` cache. They include up to 25 current quote summaries, up
  to 10 most-recent immutable versions per quote with explicit truncation, and
  server-owned per-quote conversation count/latest-actor summaries when
  available; histories remain quote-scoped. Customer IDs and email claims
  remain absent from the public portal projection, and staff preview does not
  establish `viewed`. Canonical quotes are staff-readable only, and browser
  self-creation of a customer role is retired while exact-token portal behavior
  remains intact. A dry-run-first legacy binding tool is present, but apply is
  limited to loopback emulators and `demo-*` projects. This is working-tree
  candidate source and is neither a production data operation nor deployment/
  hosted acceptance evidence.
- Working-tree candidate `CWF-11` rebooking continuation: Home and Workflow now
  derive tenant-calendar anniversary Attention from the latest-200 canonical
  quote-history read, expose source/display incompleteness, and hand one click
  to the stable Customer 360 record without creating a draft or claiming a
  verified accepted source. Customer 360's bounded Revenue opportunities view
  can identify a same-week anniversary from recorded booked events and offer an
  exact-version rebook only when the booked quote, stable
  customer, acceptance receipt, and retained accepted immutable version all
  match. The trusted callable derives a deterministic identity, overlays current
  customer contact, and creates a current-catalog, server-authoritatively priced
  draft. The edit flow records staff review only after a new current-or-future
  event date later than the source event is saved, and delivery fails closed
  before that evidence exists. The action sends nothing and proves no lead,
  acceptance, booking, payment, or revenue. The disposable
  Auth/Firestore/Functions emulator lane locally covers same-tenant denial,
  source-version drift, deterministic collision refusal, concurrent retry
  convergence, atomic initial records, current-catalog repricing, and the trusted
  staff-review transition. The same source now creates one deterministic
  post-event closeout record atomically with an eligible governed booking,
  bound to the exact accepted immutable version, private acceptance-receipt
  snapshot hash, and stable customer. A legacy booking that lacks that newer
  authority remains booked with a visible source-review block. A missing tenant
  IANA time zone records a visible configuration block without blocking booking;
  otherwise the four-item internal review becomes actionable seven tenant-
  calendar days after the event. Customer 360 and Workflow consume the bounded
  canonical-quote projection, while an exact idempotent callable owns review and
  reopen receipts, a separate exact configuration-refresh receipt recovers a
  repaired time-zone block without reviewing an item, and the private record remains browser-inaccessible and absent
  from the token portal. The UI covers scheduled, due, overdue, blocked,
  completed, uncertain, reconciliation, receipt, definitive error, and recovery
  outcomes. These are internal-review facts only, not outbound contact or
  provider evidence. Functions/rules deployment, hosted staff review, and
  consent/provider-gated thank-you/review delivery remain pending.
- Working-tree candidate `CWF-13` commercial measures: Customer 360 Overview
  derives quoted, exact-state accepted/booked, payment, and repeat-event measures from
  the bounded customer DTO. Deposit and final-balance values become
  provider-confirmed only when the DTO reports an exclusively Firebase-backed
  read and each record has the matching paid state plus a valid provider
  confirmation timestamp. Browser-local, mixed, and unknown-source payment
  fields remain unavailable even when they contain paid statuses or timestamps.
  Each card exposes its eligible/known/missing-evidence denominator;
  truncated or unreported bounds are labeled `Displayed-record`, while
  `Lifetime` appears only when the bounded quote read reports complete. Loading,
  refresh, empty, partial, retained-stale, error, and retry presentation is
  source-covered. These values are read-only operational measures, not
  accounting revenue, cash reconciliation, forecasts, or a persisted rollup.
  Deployment and hosted staff acceptance are pending.
- Working-tree `CWF-12` Revenue Autopilot authority candidate now includes
  tenant policy and Customer 360 controls, deterministic idempotent jobs, four
  reminder lanes plus completed-closeout post-event review requests, unread-
  reply Attention escalation with latest-message supersession, staff-reply
  resolution, and scheduled repair, a 15-minute UTC scheduler evaluated on tenant-
  local calendar rules, bounded Workflow operations with four explicit gates and
  per-lane preparation receipts, durable signed/hash-bound
  no-expiry customer unsubscribe, and raw Resend webhook verification through
  `standardwebhooks@1.0.0`. The API key, webhook secret, and unsubscribe-token
  secret have isolated Secret Manager ownership; the webhook binds only its
  webhook secret. `REVENUE_AUTOPILOT_ENABLED`,
  `REVENUE_AUTOPILOT_SENDS_ENABLED`, and email provider activation remain off.
  With runtime and tenant policy enabled, deterministic records can be prepared
  while sends/provider remain off; dispatch does not run. Stop evidence no longer
  overwrites sending, provider-accepted, or ambiguous evidence, and ambiguous
  reconciliation rechecks current authority before any provider call. The
  staff receipt now exposes a withheld retry as a distinct non-provider outcome
  rather than presenting every successful record mutation as provider accepted.
  No deployment, scheduler execution, secret provisioning, provider acceptance/
  delivery/bounce/complaint, hosted behavior, recovered value, or human
  acceptance is established by this source/local candidate.
- Working-tree candidates `CWF-07` and `CWF-08`: Workflow exposes bounded
  timestamp-derived due-today, overdue, upcoming, and aging cues alongside exact
  stored internal completion receipts, while Schedule exposes a bounded,
  expandable run of show derived from recorded event, booking, staffing,
  checklist, and BEO inputs. Both surfaces identify source, bounds, stale or
  partial evidence, unknown timing, and retry behavior. They remain read-only
  projections: internal receipts do not prove customer/provider/commercial
  outcomes, and the run of show does not prove attendance, inventory, payment,
  booking, or readiness. Persisted ownership/SLA escalation, collaborative event
  operations, deployment, and hosted acceptance remain pending.
- Working-tree candidate `CWF-09` bounded commercial intelligence: Reporting
  caps its same-tenant quote snapshot at 500 displayed records, labels source,
  last complete client read, truncation, explicit denominators, missing money,
  stale/partial/error/retry states, and UTC six-month trends. Accepted/booked
  quote value remains separate from a verified paid-deposit total. A deposit is
  included only when the read is exclusively Firebase-backed and the displayed
  record has a paid state, valid provider-confirmation timestamp, and amount;
  local or incomplete evidence is excluded rather than coerced to zero. The
  measures are not accounting revenue and are not tenant-wide when truncated.
  Deployment and hosted staff acceptance remain pending.
- Working-tree candidate `CWF-10` portal decision recovery: the existing
  exact-token decision center now presents submitting, uncertain, same-attempt
  reconciliation, exact receipt, changed-source review, definitive error, and
  recovery states for acceptance and requested changes. Missing typed signer or
  consent input receives focused validation, and decision motion honors reduced
  motion. The browser does not auto-retry a decision, and acceptance remains
  separate from payment and booking. This source is not deployed and has no
  hosted customer acceptance.
- Production `v0.2.3` starter catalog delivery: the existing post-login blank-catalog
  gate now offers four one-click industry drafts in Catalog Admin. Versioned
  manifests populate tenant-scoped catalog and menu records with suggested
  minor-unit prices, provenance hashes, and unconfirmed pricing. Server
  transactions enforce revision preconditions for apply, untouched staged
  replacement, and confirmation; replacement detects custom records,
  pack-record divergence, and pricing-setting edits, while confirmation checks
  the complete catalog and records actor, timestamp, and catalog revision. The
  frontend, Firestore rules, and both catalog callables are deployed; `/app`
  returns HTTP 200 and unauthenticated callable probes fail closed with HTTP 401.
  A signed-in owner pack application and pricing confirmation remain pending
  tenant acceptance rather than being inferred from route reachability.
- Current source starter-pack release compatibility retries the retained
  version 1 manifest exactly once only when an older deployed callable
  explicitly rejects the newer manifest version. The retry preserves the same
  catalog-revision precondition; authorization, revision, network, and other
  catalog failures remain fail-closed, and the server still owns every write
  and divergence check. Hosted owner acceptance remains pending.
- Current source starter-catalog hardening detects owner-deactivated or removed
  generated records before replacement, rejects malformed dependency data
  before menu removal, and requires browser catalog/pricing edits to advance
  the catalog revision atomically while reopening pricing review. Pack
  provenance and staged-pack metadata remain server-owned. These additions are
  locally validated source changes and are not part of deployed `v0.2.3`.
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
- Current source tenant identity fix: explicit blank tenant logo/contact/address/crew values no longer fall back to the legacy customer profile, and Catalog Admin branding edits retain their draft through parent rerenders with persistent save/discard affordances.
- Current source portal themes: Catalog Admin offers four named, contrast-safe
  presets that update only the existing tenant color fields, show an immediate
  preview, and persist through the existing revision-preconditioned catalog
  save. New authoritative and local quote snapshots carry the full six-color
  palette plus the existing logo reference into the customer portal; legacy
  snapshots continue through safe visual fallbacks. This is source/local
  evidence only and is not deployed or hosted-accepted.
- Current source tenant authorization hardening: Firestore denies unverified
  email authority and conflicting claim/role organization scopes, permits
  tenant-domain mapping changes only for same-organization admins, and keeps
  commercial entitlements server-owned. Direct quote and portal deletion is
  denied, generic staff status writes cannot create `sent` or `viewed` evidence
  or rewrite an existing provider/customer lifecycle, and sales schedule writes
  are limited to non-evidentiary staff/checklist fields.
- Current source provider authorization hardening: outbound quote email, owner
  SMS, payment requests, checkout creation, provider status, and provider tests
  require the current authoritative admin role. Disabled providers reject and
  omit retained credentials. Browser CRM networking is disabled; admins can
  record organization-scoped integration audit events without an outbound send.
- Workflow authority boundaries: approval resolution authorizes but does not
  itself execute a sensitive action; the matching Quote History operation must
  consume that exact approval. Customer acceptance does not prove payment or
  booking, and production checklist completion does not prove inventory
  availability.
- Current source proposal acceptance hardening: customer acceptance has moved
  from a rules-permitted browser batch to a server-authoritative transaction.
  The callable requires typed signer identity and versioned consent, revalidates
  the active organization, portal expiry, current delivery revision/issuance,
  complete proposal content, matching quote/portal projection, and integer
  minor-unit totals, then writes matching quote/portal evidence plus a
  server-write-only tenant receipt with a SHA-256 proposal snapshot. Direct
  browser acceptance is denied; request changes and declines retain their
  existing atomic portal path. This is local source/emulator evidence only and
  is not deployed or hosted-accepted.
- Current source product analytics: the quote wizard records only anonymous
  session, step, mode, and add-on identifiers through same-tenant staff
  callables. Deterministic event identities make retries idempotent, raw events
  remain browser-inaccessible, and the existing Dashboard shows a 30-day
  funnel plus add-on selection/removal trends. Analytics storage or summary
  failures do not block quote work or the dashboard's quote metrics. This is
  local source evidence only and is not deployed or production-accepted.
- Current source operations audit: organization admins can review server-
  derived delivery retry/review counts, a seven-day trend over recorded
  integration outcomes, current admin/sales role counts, and recent role-
  stamped sensitive actions in Integrations Ops. Retry candidates do not claim
  that a resend occurred, and operator sync notes are not promoted to server
  connector evidence. This is local source/unit evidence only and is not
  deployed or hosted-accepted.
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
  release tag published to `origin`, and has completed all eight required CI
  jobs. Target-specific UAT remains available as additional human-acceptance
  evidence but is not a normal solo-operator deploy input.
- Delivery controls: canonical doc ownership and governance checks are now enforced in CI.
- Commerce resilience: Twilio SMS failures are non-blocking for quote save and Stripe checkout.
- Buyer onboarding: admin-only Integrations Ops includes an in-app setup assistant for optional Twilio configuration.
- Production guardrail: `ENABLE_FUNCTIONS_DEPLOY=false` (default locked state).
- Production fail-safe integration mode:
  `NOTIFICATIONS_SMS_PROVIDER=none` in the ignored project-scoped Functions
  environment.
## Active Risks
- Commercial Change enforcement is default-off and must remain so. The source
  now has exact committed-versus-fenced-not-committed reconciliation for a
  transport-ambiguous governed apply. The refreshed local unit/rules/emulator/
  browser matrix is green; hosted role acceptance and a separately authorized
  release remain required before considering either the global or tenant gate.
- Revenue Autopilot evaluation and sends are independently default-off. The
  15-minute scheduler, Resend webhook, customer unsubscribe, post-event URL, and
  operations UI have source/local evidence only. `RESEND_API_KEY` and a unique
  `REVENUE_AUTOPILOT_TOKEN_SECRET` are isolated in Firebase Secret Manager. A
  fail-closed placeholder version exists for `RESEND_WEBHOOK_SECRET` so the
  disabled Function can be deployed without accepting an unconfigured provider
  signature; it must be replaced with the provider-issued signing secret before
  the Resend webhook is enabled. Provider/DNS/webhook, scheduler, hosted,
  production-data, and human acceptance remain unproven.
- The customer-centered staff shell is behind
  `VITE_CUSTOMER_CENTERED_WORKSPACE_ENABLED`, which defaults off. It still
  requires an exact hosted candidate plus signed-in deep-link, Back/Forward,
  mobile, portal-precedence, branding-isolation, and human acceptance before the
  flag can be removed or enabled for production. The current convergence has
  exact local/high-risk evidence, but no local result satisfies those hosted
  gates.
- The Home trust/freshness rail is a first surface-scoped CWF-03 slice, not a
  global evidence ledger. Directory and Customer 360 still expose their own
  bounded/source states rather than sharing a cross-surface freshness contract.
  The rail's last-complete-read timestamp is client read evidence only and must
  not be described as an underlying-record update or commercial/provider event.
- The customer-ID backfill has no authorized production apply path in this
  release. A production mutation requires a separately approved, tenant-scoped
  dry-run artifact, exact confirmation contract, release record, and rollback
  review; emulator success is not production-data evidence.
- Firebase `functions.config()` compatibility remains temporary and must be
  migrated to environment parameters before the March 2027 shutdown.
- The Vercel deployment and custom-domain alias are provider-verified, but the authenticated production quote/save/export workflow still needs post-release browser acceptance.
- Provisioning hardening is deployed across the frontend, Functions, and rules,
  but a disposable second organization has not yet been created and activated
  through an authenticated platform-admin session. Do not treat deployment as
  owner onboarding or hosted tenant acceptance.
- The Resend account's existing `leaguepilot.us` domain is provider-verified and
  has been selected for the interim QuotePilot sender
  `QuotePilot by MBMApps <quotepilot@leaguepilot.us>`. A restricted send-only
  Resend key now has a Firebase Secret Manager version, and source plus local
  non-secret configuration are aligned. The currently deployed Functions still
  have email disabled; the exact Functions release, provider acceptance,
  delivered-event, and recipient-inbox proof remain outstanding. Migration to
  a dedicated QuotePilot domain remains a separate follow-up. The prior
  `onboarding@resend.dev` sandbox result is not production sender or inbox
  proof.
- The Twilio account is authenticated, a dedicated `QuotePilot Production`
  Messaging Service now reuses the account's existing SMS-capable number, and
  `TWILIO_AUTH_TOKEN` has a Firebase Secret Manager version. Source requires
  that bound secret and the Messaging Service SID instead of a raw sender
  number. Production SMS remains disabled because the Messaging Service has no
  US A2P registration; A2P approval, governed Functions release, provider
  acceptance, and destination-device receipt remain separate gates.
- The existing Import Studio frontend is deployed but not hosted-smoke-
  verified. The current branch replaces direct customer and receipt writes
  with admin-only callables and denies those browser writes; that coordinated
  Functions/rules/frontend change is not deployed. Excel intake,
  merge/update policies, saved import history UI, and active
  quote/payment/contract/booking imports are intentionally not included in this
  first slice.
- The customer decision frontend, `portalDecision` Firestore rules, and
  enriched portal snapshot support are deployed but not hosted-smoke-verified.
- The electronic acceptance callable, typed-signature UI, immutable receipt,
  and browser-write denial are implemented and locally validated in the current
  source but are not deployed. Production acceptance must wait for a coordinated
  frontend, Functions, and Firestore rules release plus a signed-out hosted
  acceptance test against an exact delivered revision.
- Approval request creation, admin resolution, and action-specific execution
  linkage are deployed server-authoritatively; hosted authenticated acceptance
  remains pending.
- Workflow Attention and its change-request handling rules are deployed and
  locally covered, but authenticated hosted acceptance has not been captured.
  Automated email and escalation authority now exists only in the current
  default-off source candidate; it is not deployed, provider-accepted, or
  enabled.
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
- Authenticated workspace route views and retained contextual/legacy modal
  wrappers load on first use instead of during initial `/app` startup. Current
  exact-source local coverage is qualified; hosted authenticated transfer
  evidence remains pending.
- Functions integrations (Stripe, Twilio, and Resend) remain optional and require secure runtime configuration plus provider-level acceptance/delivery proof; committed placeholder templates are not provider configuration.
- CRM outbound synchronization is intentionally disabled until a
  server-authorized connector with provider acceptance evidence is implemented.
- Staging sign-off routine must be re-established to keep `main` release-only under higher delivery velocity.

## Current Focus (Near-Term)
1. Sign in as an allowlisted platform admin, create and activate a disposable
   second organization, then run the hosted owner/quote/portal tenant acceptance
   checklist against the live `v0.2.3` frontend and backend.
2. Promote the restricted-key interim Resend sender
   `quotepilot@leaguepilot.us`, then capture accepted, delivered-event, and
   recipient-inbox proof from one controlled test.
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
