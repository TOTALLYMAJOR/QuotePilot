# Changelog

All notable project changes are documented in this file.

This changelog is backfilled from git history and will be maintained going forward.

## [Unreleased]

### Added

- Decidable-option portal projection (server, dormant): the canonical
  portal snapshot (`functions/quoteCreation.js#buildCanonicalPortalSnapshot`)
  now carries `decidableOptions` — a bounded (max 12), name-and-price-only
  list of staff-marked, active catalog options the quote does not already
  include (excluded by id and by name), built by the exported pure
  `buildPortalDecidableOptions`. Fail-closed everywhere: every existing
  call site builds without a catalog and projects an empty list, so no
  offer can appear until a later slice deliberately threads the org
  catalog into chosen snapshot moments. No new Firebase Function export,
  no call-site behavior change, no portal UI reads the field yet
  (`private-customer-authority` contract revision 2).

- Decidable-option marks in Catalog Admin (`VITE_PILOT_DECISION_ROOM_ENABLED`;
  first slice of the decided §4.7 direction): add-ons and rentals gain a
  strictly default-false `portalDecidable` boolean — normalize, storage,
  and both catalog write shapes accept only an explicit boolean `true`, so
  truthy junk from hand-edited JSON can never silently offer an option to
  customers — surfaced as a flag-gated "Portal offer" checkbox beside each
  add-on and rental row's Active toggle. Data model and staff opt-in only:
  the portal does not read these marks yet. The next slices project marked
  options into the customer portal with their price effect and let a tap
  pre-fill the existing Request Changes flow — every customer choice
  arriving as a staged request for staff approval, never a self-applying
  change, per the owner-decided direction recorded in DEV_TASKS.md.

- Per-block "Ask about this" in the customer portal
  (`VITE_PILOT_DECISION_ROOM_ENABLED`, default off in generic/local builds;
  by owner decision the production workflows now bind it to `true`
  alongside the other seven pilot gates, taking effect at the next
  release) — the
  conservative, invent-nothing subset of the design's decision room
  (docs/POST_COMPETITIVE_DESIGN.md §4.7 "Questions in place"): the three
  content sections the portal already renders (event details, package and
  menu, pricing) become addressable blocks (`data-portal-block`), each
  with a quiet "Ask about this" button that opens the existing quote
  conversation pre-seeded with the block's name in the ordinary message
  body. The block reference travels verbatim inside the message text the
  customer could already type — no new callable, no new message field, no
  new trust boundary, and nothing is sent until the customer sends it.
  `QuoteConversationPanel` gains an additive `prefill` prop with hard
  guards: a seeded draft never overwrites text the customer already typed
  and never disturbs an unresolved send attempt awaiting its exact
  reconciliation retry. The full §4.7 decision room (staff-marked
  decidable options, nine named blocks including content that does not
  exist yet, activity counsel) remains open in DEV_TASKS.md — this slice
  deliberately tags only what already exists.

### Changed

- Bound `VITE_PILOT_DECISION_ROOM_ENABLED` to `true` in both production
  deployment workflows and both CI production-flag steps, by owner
  decision (2026-08-11) — the eighth pilot gate, joining the seven bound
  since `v0.6.0`. Takes effect at the next release from this branch;
  generic/local builds keep it default-off for build-time rollback. The
  same decision round settled the remaining §4.7 scope (decidable options
  land as staged requests for staff approval, with no signature at the
  option tap; terms content becomes per-tenant; block tags stay
  message-body text; activity counsel is deferred), approved the
  AI-assisted intake lane with OpenAI and Anthropic providers behind the
  existing default-off ADR gates, and approved a post-merge clean-main
  bundle-baseline recalibration — all recorded in DEV_TASKS.md.

- Promoted `v0.6.0` to both production providers from exact tagged `main` commit
  `4f4e00d3829eb29a1ee90d7d8402b786344dd158`. Exact-main CI Quality run
  `31452570192` passed all eight jobs; Firebase `all` run `31452927999` and
  Vercel run `31452928296` completed successfully. Public `/`, `/app`, and
  `/app/messages` checks returned HTTP 200 on the Vercel edge, and Firebase
  origin `/` plus `/app` returned HTTP 200. Firebase now lists 75 Functions,
  including the new ACTIVE Node 22 `recordChangeRequestParse` callable.
- Prepared the complete post-competitive pilot for the governed `v0.6.0`
  production rollout. Both production deployment workflows now source-bind
  all seven `VITE_PILOT_*` gates to `true`: NOW, Event Room (including the
  cascade receipt chain), guided selling, CREATE with draft-only price bands,
  staged client change requests, the Pilot command bar, and fail-closed staff
  margins. Generic/local builds keep every gate default-off for rollback.
- Added a separate production-flag browser and bundle matrix to CI. The
  rollback-mode browser suite still runs first; the production matrix then
  exercises NOW, Event Room, deterministic CREATE, draft-only band pricing,
  staged customer changes, command preview/apply, and the margin rail under
  the exact gate combination used by both production providers.
- Raised the named temporary aggregate bundle ceiling only for the measured
  32-byte flag-on configuration delta, from the exact CI-confirmed 2,747,012
  default-off bytes to a provisional 2,747,044 production-flag ceiling. The
  largest-chunk ceiling remains 391,596 bytes. PR run `31452174098` and
  exact-main run `31452570192` both confirmed the production-flag build and
  browser matrix before deployment.

### Fixed

- Catalog Admin's "Refresh latest catalog" recovery button silently never
  appeared for the most common save/starter-pack-apply conflict outcome —
  a concurrent edit that the post-error reload successfully detected and
  reported. `useCatalogData.js`'s `saveCatalog` and `stageStarterPack` both
  returned `{ refreshed: true }` for that path, but `AdminCatalogModal.jsx`
  checks `result?.refreshRequired`; the key-name mismatch meant only the
  rarer case (the reload itself also failing) ever surfaced the button.
  Found while instrumenting Catalog Admin's save flow with literal
  `data-capability-state` markers for the `catalog-cost-and-pricing-data-entry`
  capability contract, registered separately, and fixed on its own once
  isolated. Not gated by any pilot flag — this is already-shipped,
  always-active behavior.

- Two correctness bugs in pilot source (`VITE_PILOT_MARGINS_ENABLED`,
  `VITE_PILOT_CHANGE_REQUESTS_ENABLED`, `VITE_PILOT_COMMAND_ENABLED`),
  caught by automated PR review before merge:
  - `buildMarginPresentation` now caps its guest basis at 400 and gates
    labor cost behind `settings.staffingLaborEnabled`, exactly mirroring
    `calculateQuote`. Previously an uncapped guest count could cost more
    guests than the revenue side ever recognized once the calculator's own
    capacity cap applied, and labor cost was charged (or demanded as a
    missing rate) even in tenants where labor charging is disabled and
    revenue never bills it — both understated margin or falsely reported
    it unavailable.
  - `change-request-parse-v1` proposal and ambiguity ids are now anchored
    to each clause's fixed position in the original message instead of a
    running per-parse counter. `ChangeRequestPanel` and the Pilot command
    bar re-parse reactively as staging edits the draft form, and a clause
    that becomes satisfied (`set_guests`/`set_hours`) stops producing an
    artifact on the next parse; with counter-based ids this silently
    shifted every later clause's id, orphaning an already-staged
    proposal's tracked id and allowing its one-tap action to be triggered
    again — double-applying it (e.g. adding a second bartender when only
    one was requested). Five new regression tests cover both fixes,
    including the exact re-parse sequence that reproduced the id shift.

### Added

- Margin delta in the change-request impact preview (`VITE_PILOT_MARGINS_ENABLED`,
  still default off), extending the same fail-closed computation to the two
  surfaces that price a client-requested change before it's staged: the
  Pilot command bar and the client-request panel. `buildChangeImpact`
  (`changeRequestParse.js`) now also returns a `marginDelta` alongside its
  existing total/deposit delta, reusing `buildMarginPresentation` a fourth
  and fifth time — both surfaces already called `buildChangeImpact` for
  their impact line, so the change is additive to an existing computation
  rather than a new one. Fail-closed exactly like every other margin
  surface: `marginDelta` stays `null`, and no margin note renders, unless
  every selected line on both the before and after side of the proposed
  change has a recorded cost.

- Margin awareness in Scenario Compare (`VITE_PILOT_MARGINS_ENABLED`, still
  default off), matching design §4.6's own what-if mock ("margin 30.5% →
  31.2%"): each good/better/best preset card now shows its margin, and the
  current-vs-scenario table gains a Margin row with a points delta. Reuses
  `buildMarginPresentation` a third time against the exact `totals`
  Scenario Compare already computes for each side — no new pricing model.
  Fail-closed per side independently (a `MarginComparisonRow` renders
  "Unavailable" for whichever side lacks recorded costs, "—" for the delta
  only when both sides are unavailable, and nothing at all when neither
  side has anything to show), since a scenario's package swap can put it
  in cost-coverage a tenant's current draft never needed.

- Margin range in the CREATE intake band-pricing preview
  (`VITE_PILOT_MARGINS_ENABLED`, still default off), closing the Phase 5
  gap between the app's two pricing paths: `buildPricingBand` now prices
  margin at both band endpoints the exact same fail-closed way the applied-
  count margin strip already does, and shows a range only when costs are
  recorded at *both* ends — one end missing costs makes the whole range
  unavailable rather than implying false precision. Displayed low/high are
  sorted for display (margin % is not guaranteed to move the same
  direction as guest count the way totals do, since fixed costs amortize
  differently at different guest counts). `CreateIntake`/`pricingBand.js`
  is a staff-only surface — same trust boundary as the main pricing rail,
  not customer-facing — so this needed no different treatment than the
  cost-entry delivery already gave the applied-count strip.

- Structured change-request version linking (`functions/index.js#linkChangeRequestResolutionVersion`),
  completing the intent-to-version audit trail for the flag-gated
  client-request panel (`VITE_PILOT_CHANGE_REQUESTS_ENABLED`, still default
  off): after a staff member records a review (`recordChangeRequestParse`)
  and then saves the quote through the normal path, the resulting save is
  already fully complete on its own — linking is a best-effort follow-up
  call, fired right after, that binds the existing record to the version
  that actually resulted. Server-verified: the target version must exist
  for this exact quote and be numerically newer than the version on file
  when the record was made; a resolution links to exactly one version ever
  (idempotent replay of the same link, rejected relink to a different one).
  It never mutates the quote, portal, message, or the original attestation,
  never blocks the save it follows, and never surfaces its own failure to
  the operator — a missed link only means the audit trail stays one step
  short, not that anything was lost or corrupted. Browser writes remain
  fully rules-denied; only the create-only record and this one bounded
  update are permitted, both callable-only.

- Unit-economics cost entry and a commercial advisor card for the
  flag-gated margin pilot (`VITE_PILOT_MARGINS_ENABLED`, still default off;
  docs/POST_COMPETITIVE_DESIGN.md §4.5 and §1.3), completing the data-entry
  path the fail-closed margin strip needed to ever leave "unavailable" for
  a real tenant:
  - Catalog Admin gains cost fields alongside the existing price fields —
    cost per person on packages, cost on add-ons and rentals — plus staff
    cost rates (server/chef/bartender) and a target margin % policy in
    Numeric Settings, all gated behind the same pilot flag. Blank always
    means "not recorded" and stays `null` through normalize, save, and
    reload; it is never coerced to $0, since an entered $0 cost and an
    unrecorded one are different facts and margin must stay unavailable
    for the latter. Item-level costs persist as nullable Minor-cents
    (`costPppMinor`/`costMinor`), matching the existing `ppp`/`price`
    convention; a `fromMinorUnits`-only read would have silently turned a
    cleared cost back into $0 (`Number(null)` is a safe integer 0), so the
    normalizer special-cases null before that conversion.
  - `buildMarginAdvisorCard` turns a below-target margin into a
    `decide-stack`-style decision card (claim, points-and-dollar gap,
    basis) rendered inline in the live pricing rail. It stays silent for
    on-target, no-target, and unavailable margins — restraint over
    dashboard noise; meeting a target is already confirmed inline by the
    existing strip text, not re-announced as a card.
  - Catalog Admin's save flow now carries a literal, derived
    `data-capability-state` marker (ready/submitting/receipt/error/
    reconciliation/uncertain/recovery) on every save outcome, covered by
    the new `catalog-cost-and-pricing-data-entry` capability contract
    (catalog version 10). Every one of the seven states is a real,
    pre-existing `useCatalogData.js` save outcome — a confirmed concurrent-
    edit conflict, a saved-but-pricing-unconfirmed revision, a reload-
    required recovery, and so on — now named instead of collapsing into
    one generic status line.
  - Source-only candidate work — not deployed, flag-promoted, or
    human-accepted.

- Flag-gated, fail-closed margin strip (`VITE_PILOT_MARGINS_ENABLED`,
  default off; docs/POST_COMPETITIVE_DESIGN.md §4.5 and §1.3). The live
  pricing rail gains a staff-only `margin-presentation-v1` strip that
  computes margin ONLY when every selected revenue line has a
  tenant-recorded cost counterpart — `costPpp` on the selected package,
  `cost` on each selected add-on, rental, and menu item (mode defaults
  mirror the pricing calculator), and role cost rates in settings when
  staff are quoted. Any gap renders "Margins unavailable" naming the exact
  missing pieces; nothing is ever estimated. Travel and tax are excluded
  from both revenue and cost, the service charge counts as revenue, an
  optional `targetMarginPct` policy adds a meets/below note, and costs
  never reach any customer-facing projection. Purely presentational;
  source-only candidate work — not deployed, flag-promoted, or
  human-accepted.

- Flag-gated Pilot command bar in the quote builder
  (`VITE_PILOT_COMMAND_ENABLED`, default off). One input over the draft:
  plain-words commands ("add another bartender", "switch to buffet",
  "what if we are at 150 guests") are parsed by the same deterministic
  `change-request-parse-v1` grammar used for client requests, and every
  parsed proposal previews with its live fee-and-tax-cascade delta BEFORE
  anything can be applied — the preview-confirm contract. Applying stages
  ordinary editable draft edits through the existing touched-field-safe
  handler; ambiguous references ask instead of guessing; unreadable
  commands say so and change nothing; and saving remains the sole
  re-pricing and versioning authority. Voice dictation appears only when
  the browser itself provides speech recognition and degrades to typing
  otherwise. Purely presentational; source-only candidate work — not
  deployed, flag-promoted, or human-accepted.

- Cascade receipts panel in the flag-gated pilot Event Room
  (`VITE_PILOT_EVENT_ROOM_ENABLED`). For accepted or booked quotes, the
  Event Workspace side rail renders the commercial afterlife as a receipt
  chain from a new deterministic `cascade-receipts-v1` presentation
  selector in which every step reports only its own recorded evidence on
  the quote document: the electronic acceptance receipt, the retained
  immutable version, contract conversion, the deposit rail with request and
  provider-confirmed payment kept as separate truths, booking confirmation
  (including a blocked cancelled state), the recorded availability check,
  staff lead, and — for booked quotes — the final-balance rail (gated in
  copy on the provider-confirmed deposit) and the governed post-event
  review. Pending steps name the existing role-gated surface that owns the
  action; no step infers across evidence, invents a timestamp, or claims
  delivery, payment, or readiness beyond its recorded state, and the panel
  carries that bounds note visibly. Purely presentational: no reads,
  writes, or authority are added, and flag-off rendering is unchanged.
  Source-only candidate work; not deployed, flag-promoted, or
  human-accepted.

- Structured change-request record (callable-only). A new
  `recordChangeRequestParse` Firebase Function lets same-tenant staff, from
  the flag-gated client-request panel after staging at least one parsed
  proposal, create an internal audit record binding the exact stored
  customer request (id, submission time, and server-computed message hash),
  the validated parsed proposals (bounded kinds, counts, and text), the
  staged subset, the acting verified staff identity, and the quote's active
  version at record time. Validation and shaping live in a pure
  `functions/changeRequestRecord.js` core; the record identity is
  deterministic over the request and payload hash, so the create-only
  transaction is replay-stable — repeating the same review returns the
  existing record instead of duplicating it. New
  `organizations/{org}/quotes/{quote}/changeRequestResolutions` documents
  are readable by same-tenant staff and browser-write-denied by rules, with
  new rules tests for both boundaries. The panel gains a full
  ready/submitting/receipt/uncertain/reconciliation/recovery/error record
  boundary: definitive server rejection is terminal with honest copy, an
  ambiguous outcome reconciles safely via the replay-stable identity, and
  every failure path states that the staged draft is unchanged. The record
  never replies to the customer, never mutates the quote, portal, or
  versions, and the ordinary save path remains the sole versioning
  authority. Capability-surfacing contract
  `structured-change-request-record` (catalog version 9) binds the
  callable, entry point, states, Feature Matrix row 49, and the new
  "Client Change Requests (Structured Record)" User Manual section.
  The isolated Firestore rules lane passes locally (63/63 including the two
  new record boundaries). Emulator/hosted execution of the callable itself
  is not claimed: this is source evidence with always-on unit/component
  coverage plus local rules-lane evidence; Functions deployment, rules
  promotion, and hosted staff acceptance remain pending.

- Flag-gated client-request panel in the quote editor
  (`VITE_PILOT_CHANGE_REQUESTS_ENABLED`, default off). When staff edit a
  quote whose portal decision is `changes_requested`, the stored customer
  message renders verbatim and a new deterministic
  `change-request-parse-v1` selector splits it into clauses and parses
  explicit change language into stageable proposals: guest-count changes,
  staff additions, hour extensions (builder-bounded), house service-style
  switches, and add/remove/swap of items resolved only against the quote's
  own selections and the tenant's active catalog, with a bounded
  token-window fallback for natural filler phrasing. Each proposal card
  carries a preview delta priced by the same client calculator (fee and tax
  cascade included) and Why? provenance; an ambiguous item reference
  becomes an explicit choice, never a guess; clauses that change nothing or
  cannot be read are listed as the customer's own text with nothing staged.
  Staging applies the proposal to the draft form with ordinary
  touched-field protection; the ordinary save path remains the sole
  versioning and re-pricing authority, and no customer-facing state
  changes. The panel and parser add 10,011 aggregate JavaScript bytes,
  recorded by raising the active temporary bundle ceiling to 2,731,349
  bytes (largest-chunk ceiling and clean-main baseline unchanged).
  Source-only candidate work; not deployed, flag-promoted, or
  human-accepted.

- Draft-only band pricing for uncertain guest counts. When the CREATE
  intake canvas (`VITE_PILOT_CREATE_ENABLED`) applies a count the operator
  stated as approximate (±10%) or as a range, the live pricing rail shows a
  new deterministic `pricing-band-v1` strip: estimated-total and deposit
  ranges priced at the band's exact ends by the same client preview
  calculator the rail already uses — never a second pricing model — with
  the note that saving always prices the exact recorded count. The band
  lives only in draft session state: it never persists, never reaches the
  authoritative pricing callable or any payment rail, and typing any
  different exact guest count resolves it immediately. The strip adds 2,279
  aggregate JavaScript bytes, recorded by raising the active temporary
  bundle ceiling to 2,721,338 bytes (largest-chunk ceiling and clean-main
  baseline unchanged). Source-only candidate work; not deployed,
  flag-promoted, or human-accepted.

- Flag-gated CREATE intake canvas (`VITE_PILOT_CREATE_ENABLED`, default
  off) and the intent-intake architecture record
  (`docs/INTENT_INTAKE_ADR.md`). On the new-quote surface, free text —
  typed or pasted — is structured by a new deterministic, browser-only
  `intent-extraction-v1` extractor into reviewable facts: guest counts with
  the operator's own uncertainty phrasing (exact, approximate, or range
  with a midpoint draft value and a preserved band note), dates with
  forward year inference, times, builder-bounded durations, contact
  details, service styles matched to the house list, tenant event types by
  name or keyword, dietary clauses, and title-case event names. Every fact
  carries its source excerpt and confidence tier; low-confidence venue and
  address guesses require one-tap confirmation and are never auto-applied;
  budget mentions surface as an honest note because the builder has no
  budget field; unreadable text changes nothing and says so. Applying
  prefills the ordinary editable draft form through the canonical
  event-type template path (extracted facts are marked touched with the
  same protection ordinary typing gets), and quote creation authority is
  unchanged — the extractor performs no I/O and the trusted create path
  remains the sole creation authority. The ADR also fixes the default-off
  server posture (`INTENT_PARSER_ENABLED=false`, provider `none`) for the
  future model-assisted lane. The canvas and extractor add 11,518 aggregate
  JavaScript bytes, recorded by raising the active temporary bundle ceiling
  to 2,719,059 bytes (largest-chunk ceiling and clean-main baseline
  unchanged). Source-only candidate work; not deployed, flag-promoted, or
  human-accepted.

- Flag-gated pilot guided-selling decide cards
  (`VITE_PILOT_GUIDED_SELLING_ENABLED`, default off). When enabled, the
  quote builder's existing upsell recommendations render through a new
  deterministic `guided-selling-cards-v1` presentation selector as
  decision-grammar cards: the rule's own reason as the claim, an explicit
  catalog-settings basis line, the existing live-preview impact label, a
  Why? provenance disclosure (model id, rule reason, and the statement that
  saving re-prices authoritatively on the server), and a one-tap Take it
  action that calls the existing apply handler. Autopilot semantics are
  preserved as a disabled Auto action. The shared `DecisionCard` gains the
  optional Why? disclosure and disabled-action support. The recommendation
  engine, tenant guided-selling/AI-assist gates, and flag-off rendering are
  unchanged; the surface adds no reads, writes, evidence, or authority. The
  cards add 1,560 aggregate JavaScript bytes, recorded by raising the active
  `workspace-convergence-pilot-phase1-2026-08-10` ceiling to 2,707,541
  bytes (largest-chunk ceiling and clean-main baseline unchanged).
  Source-only candidate work; not deployed, flag-promoted, or
  human-accepted.

- Flag-gated pilot Event Room dressing (`VITE_PILOT_EVENT_ROOM_ENABLED`,
  default off). When enabled, the Event Workspace renders the existing
  `proposal-readiness-v1` score as an accessible readiness ring (completion
  marked only at exactly 100, reduced-motion safe) and adds an advisory
  decide stack from a new deterministic `decide-stack-v1` presentation
  selector: a staffing card comparing quoted counts against the static house
  staffing ratios — priced only from the quote's own recorded labor totals,
  with an explicit not-derivable statement otherwise — plus up to two
  heaviest proposal-completeness gap cards. Cards are advisory-labelled,
  suppressed entirely for accepted/booked/terminal quotes, keep the
  "not operational event readiness" scope language, and route only to the
  existing role-gated edit or quote-administration surfaces. The shared
  `DecisionCard` gains optional basis/impact lines. Flag-off rendering is
  unchanged, and the surface adds no reads, writes, evidence, or authority.
  The dressing adds 5,544 aggregate JavaScript bytes, recorded by
  superseding the temporary bundle ceiling with
  `workspace-convergence-pilot-phase1-2026-08-10` (2,705,981 bytes;
  largest-chunk ceiling and clean-main baseline unchanged). Source-only
  candidate work; not deployed, flag-promoted, or human-accepted.

- Flag-gated NOW home surface candidate (`VITE_PILOT_NOW_ENABLED`, default
  off, additive to the customer-centered workspace flag). When enabled, the
  `/app` Home route renders the same bounded commercial workspace snapshot as
  interpreted decision cards — one sentence of interpretation per tracked
  attention item plus the exact existing Workflow/quote/Customer 360
  resolution target — through a new deterministic
  `now-presentation-v1` selector, a reusable `DecisionCard` presentation
  component, and condensed Next-7-days and Money evidence rails. The surface
  adds no reads, writes, evidence, or authority: it consumes the existing
  Command Center snapshot, preserves the staff evidence rail, bounded
  truncation language, and blocked-closeout copy verbatim, and the Command
  Center remains the default and the flag-off rendering. The lazy NOW chunk
  adds 9,093 aggregate JavaScript bytes, recorded by superseding the active
  temporary bundle ceiling with `workspace-convergence-pilot-now-2026-08-10`
  (2,700,437 bytes; largest-chunk ceiling and clean-main baseline unchanged)
  in `docs/TECH_EXCEPTIONS.md` and `docs/performance/bundle-exception.json`.
  This is source-only candidate work; it is not deployed, flag-promoted, or
  human-accepted.
### Documentation

- Reconciled canonical operational state after the `v0.5.0` coordinated
  Firebase/Vercel release. `PROJECT_STATUS.md` now distinguishes deployed and
  enabled capabilities from dormant global/tenant gates, hosted acceptance,
  provider evidence, production data operations, and human acceptance.
- Rebuilt `DEV_TASKS.md` as an open-work-only backlog. Completed runtime
  promotion work was removed; buyer test-credential repair, authenticated
  acceptance, Revenue Autopilot preparation-only promotion, Commercial Change
  tenant enforcement, Resend evidence, A2P, data dry runs, CWF-17, performance,
  and release-auth modernization remain explicit.
- Corrected README and launch-runbook claims that still described merged
  `v0.5.0` payment, provisioning, Commercial Change, Revenue Autopilot, and
  Resend runtime state as undeployed or used obsolete activation prerequisites.

### Fixed

- The flag-gated client-request panel now actually receives the stored
  customer request in the real edit flow: `handleEditQuote` carries the
  quote's `portalDecision` snapshot into the editing context (presentation
  context only — staging and the trusted save path are unchanged).
  Previously the panel's mount condition could never be satisfied because
  the editing context stored only identity fields; caught during a
  full-app screenshot walkthrough rather than by the panel's prop-driven
  unit tests.

## [0.5.0] - 2026-08-10

### Released

- Promoted the event-first customer workspace, CWF-16 quote detail,
  deterministic quote insights, routed draft-save handoff, and Event Messaging
  Station to production from tagged `main` commit
  `3cca8cc4bb985de6ec08c9d62094cfe81b1d2a43`. Exact-SHA CI run
  `31420931622` passed all eight required jobs. Firebase `all` deployment run
  `31421511861` updated Hosting, Firestore rules, and Functions; Vercel run
  `31422418387` promoted deployment
  `dpl_ykXq9U7wt2aZDg4zUR4hc8CCNMKq` and rebound
  `quotepilot.mbmapps.com`. Public `/`, `/app`, `/app/messages`, and quote-detail
  deep links returned HTTP 200 on the production edge. These receipts establish
  deployment and public route reachability, not authenticated staff acceptance,
  production message exchange, provider email delivery, or human acceptance.

### Fixed

- Clean CI installs now declare the `jsdom` test runtime required by Vitest
  component suites, removing reliance on a previously populated local
  `node_modules` tree.

### Added

- Source-branch Event Messaging Station candidate. The temporary-flagged staff
  shell now routes `/app/messages` to one central inbox segregated by canonical
  quote/event, with search, `Needs reply`/`Active` filters, event-oriented
  groups, selected-thread context, and direct Event Workspace and Customer 360
  actions. A bounded same-tenant listener watches up to 50 recently active quote
  documents ordered by their body-free conversation summary and normalizes the
  event/thread fields used by the inbox; the selected staff
  quote or exact customer portal document emits a small summary signal, and a
  higher-count or distinct non-older signal causes the existing access-validating
  callable to reload canonical message bodies, including reconciliation when a
  concurrent message precedes the local sender's latest receipt. New sends atomically project the same
  body-free summary to the canonical quote and exact current portal document
  in one transaction. Idempotent retries return the existing receipt before any
  new projection write. This is a best-effort near-real-time refresh path: the
  UI distinguishes `Catching up`, `Live updates`, `May be stale`, and `Updates
  paused`, retains manual refresh, and makes no read-receipt, typing, presence,
  external-delivery, guaranteed-latency, payment, or acceptance claim. Existing
  callable ownership, limits, lifecycle checks, and receipt-safe retry behavior
  are unchanged. Mobile thread selection now follows browser history, clears
  its focused URL on return, and restores focus to the selected event row.
  Organization-scoped inbox state and complete access-identity panel remounts
  clear prior-tenant rows, bodies, and drafts before a new scope can render. This
  source is deployed in `v0.5.0`; public deep-link reachability is verified,
  while authenticated hosted use, production-data behavior, and human
  acceptance remain unverified. Draft,
  expired, deleted, and provider-unaccepted
  portal records fail closed as unavailable instead of opening a callable thread.

- The governed Firebase Hosting and Vercel production builds explicitly enable
  the reviewed customer-centered workspace, including the CWF-16 Event
  Workspace, in the credential-scoped deploy step. This keeps the source flag
  available for rollback while preventing production behavior from depending
  on an untracked operator shell or mutable repository variable.
- Source/local `CWF-16` Event Workspace. The flagged `/app/quotes/:quoteId`
  route now presents one quote as an event-first commercial record with exact
  event/customer identity, bounded Workflow condition and next action, existing
  Schedule/Customer/BEO/PDF/conversation entry points, sold scope, and
  Draft/Sent/Accepted/Booked lifecycle. One presentation-only deterministic
  selector now reuses exact Workflow Attention and proposal-readiness facts for
  `Condition`, proposal-scoped `Readiness`, and `Needs You`, exposes stable
  reason codes behind one `Why?` disclosure, and returns explicit `Unavailable`
  states for Flexibility and Alignment instead of guessing from Decision Debt
  or other partial evidence. `/app/quotes` remains the complete
  role-gated administration table and `/app/quotes/:quoteId/edit` remains the
  trusted editor. Accepted/booked records do not expose ordinary Edit, empty
  attention explicitly does not claim readiness/completion, and local BEO output
  remains labeled as having no server receipt. Deterministic model, component,
  integration, responsive browser, console-error, deterministic-repeat, and
  same-state visual QA are covered. This adds no backend/data authority. It is
  deployed from tagged `main` commit
  `3cca8cc4bb985de6ec08c9d62094cfe81b1d2a43` with the governed production
  workspace flag enabled. Public route reachability is verified, but
  authenticated hosted use and human acceptance remain unverified.
- Source/local `CWF-11` authoritative post-event closeout. A governed booking
  with a verified private acceptance receipt now atomically creates one
  deterministic, same-tenant closeout record bound to the exact accepted
  immutable proposal version and stable customer. Legacy bookings whose source
  cannot meet that newer authority contract remain bookable and enter a visible
  source-review block rather than manufacturing a closeout receipt.
  The record becomes due seven calendar days after the event, fails safely into
  `blocked_configuration` when the tenant IANA time zone is missing, and projects
  only bounded internal review state onto the canonical quote. A separate exact
  configuration-refresh receipt makes a repaired time-zone block recoverable
  without reviewing an item. Customer 360 and
  Workflow expose scheduled, due, overdue, blocked, completed, uncertainty,
  reconciliation, exact receipt, rejection, and recovery states. Four explicit
  staff-only review items can be reviewed or reopened through one idempotent
  callable; the private record and action receipts remain browser-inaccessible
  and absent from the token portal. These receipts prove internal review only:
  the closeout itself proves no thank-you, review request, follow-up email,
  delivery, open, reply, lead, booking, payment, or revenue outcome. The newer
  default-off Revenue Autopilot source may materialize an exact completed-
  closeout review-request job under separate consent/provider authority;
  deployment, hosted staff acceptance, and outbound provider proof remain
  separate release work.
- Source/local/emulator-qualified `CWF-11` exact-version rebooking in Customer
  360. Home and Workflow now derive a tenant-calendar, latest-200 quote-history
  anniversary cue for recorded booked events and identify source/display
  truncation before one click opens the stable Customer 360 record. That
  central cue performs no mutation and does not claim that the accepted source
  is verified. In Customer 360, the bounded anniversary cue can invoke a
  same-tenant callable that revalidates the
  booked quote, matching acceptance receipt, stable customer, and exact retained
  immutable version before creating one deterministic draft. The draft overlays
  current customer contact and is repriced from the current trusted catalog;
  delivery remains blocked until staff saves a new current-or-future event date
  later than the source event. Creation, uncertainty, same-identity
  reconciliation, definitive failure, recovery, and required-review states are
  visible. This action sends no message and establishes no acceptance, booking,
  payment, or revenue fact. A disposable Auth/Firestore/Functions emulator lane
  covers same-tenant denial, source-version drift, deterministic-identity
  collision refusal, concurrent retry convergence, atomic initial writes,
  current-catalog repricing, and the trusted staff-review transition. Functions
  deployment and hosted staff acceptance are pending.
- Source-only `CWF-13` bounded Customer 360 commercial measures. The Overview
  now derives quoted, exact-state accepted/booked, payment, and repeat-event
  measures from the customer-scoped DTO with visible denominators,
  missing-evidence counts, bounds, and loading/empty/partial/stale/error/retry
  states. Deposit and final-balance values are promoted as provider-confirmed
  only for an exclusively Firebase-backed read with the matching paid state and
  a valid provider confirmation timestamp; browser-local, mixed, and
  unknown-source fields fail closed as unavailable. It says `Lifetime` only
  after the bounded quote read reports complete and otherwise says
  `Displayed-record`; it is not an accounting ledger, cash reconciliation,
  forecast, recognized revenue, or persisted `commercialSummary`. Deployment
  and hosted staff acceptance are pending.
- Source/local `CWF-12` Revenue Autopilot authority and operations. Tenant policy
  plus Customer 360 controls drive deterministic idempotent quote, deposit,
  event-minus-14/7/3 final-balance, completed-closeout review-request, and unread-
  reply Attention lanes. A 15-minute UTC scheduler evaluates tenant-local
  calendar/quiet-hour rules; Workflow exposes bounded job/provider states and
  the public route supports a durable signed-and-hash-bound no-expiry
  unsubscribe receipt. Resend raw webhook verification uses
  `standardwebhooks@1.0.0`; `RESEND_API_KEY`, `RESEND_WEBHOOK_SECRET`, and
  `REVENUE_AUTOPILOT_TOKEN_SECRET` have separate Secret Manager ownership, and
  the webhook binds only its webhook secret. The scheduler can now materialize
  deterministic records while the separate outbound-send/provider gates remain
  off, and Workflow shows those four gates plus bounded per-lane preparation
  results. One evidence-preserving stop path covers manual expiry, scheduled
  expiry, and dispatch inactivity; sending, provider-accepted, and ambiguous
  evidence is suppressed without being rewritten. Ambiguous retry reloads
  current authority before any provider call, and its strict client/UI receipt
  now distinguishes `Dispatch withheld` from `Provider accepted`. Latest-message unread-reply
  Attention now supersedes older customer replies, resolves on staff reply, and
  is repaired by bounded scheduled reconciliation. Runtime/send/provider gates remain
  off. No deployment, scheduled execution, provider acceptance/delivery/
  bounce/complaint, production data, recovered revenue, or hosted/human
  acceptance is claimed.
- Source/local Commercial Change Authority over the pure `CWF-15A` graph.
  Exact-revision authoritative-pricing simulations now support sales request,
  tenant-admin authorization, gated atomic quote/version apply with immutable
  apply/invalidation receipts, bounded named dependency reconciliation, and
  deterministic Decision Debt with an admin-only policy editor. The staff
  simulation projection is reconstructed from the normalized immutable receipt,
  so reordered pre-normalization impact data cannot diverge from the evidence
  the browser validates. Transport-ambiguous governed apply now retains its
  exact request for reconciliation: the server validates the deterministic
  apply receipt and immutable target revision when committed, or atomically
  records a not-committed fence that prevents the timed-out request from
  committing after recovery. The UI never resubmits the quote edit and exposes
  committed receipt, changed-source, fenced recovery, repeated uncertainty, and
  definitive-error states. Both global and tenant enforcement gates default
  off, and `safeToPublish` remains eligibility only.
- Source/local trusted Kitchen BEO generation and freshness. The server reloads
  canonical source, generates retained PDF bytes plus immutable actor/time/
  revision/schema/fingerprint evidence, reports five distinct freshness states,
  and supports exact current and prior receipt downloads through
  `downloadKitchenBeoReceipt`. Replay, final response, status, and download use
  strict base64 plus exact retained length/SHA-256 validation; `CURRENT` follows
  the current-artifact pointer to the exact receipt and revalidates bytes.
  Current generation atomically resolves only its qualifying Kitchen BEO
  invalidations, exposes the exact reconciliation receipt, and retains a bounded
  current-plus-prior receipt history for separate downloads. Decision Debt now
  leaves score, urgency, and exposure factor unknown when canonical commercial
  cents are unavailable instead of applying a guessed multiplier. This
  is declared-input freshness, not publication, kitchen review, commercial,
  provider, or completion evidence.
- Source/local `CWF-02`, `CWF-04`, `CWF-05`, and `CWF-06` workspace slices.
  The flagged neutral staff shell now has a recoverably lazy `Ctrl`/`Command`+K
  palette over six same-tenant customer-prefix results and six matches from the
  latest 50 quotes, with transient queries, opaque navigation, source/bounds,
  stale-generation rejection, focus restoration, and explicit partial/error/
  retry states. Customer Directory and Customer 360 now expose surface-scoped
  read-context rails; Customer 360 adds a bounded relationship briefing, a
  source-labeled recorded commercial timeline, and an on-demand advisory
  comparison of the two latest retained immutable versions. The timeline and
  comparison omit rather than infer missing provider-delivery/bounce, lifecycle,
  payment, booking, or other authority. Hosted keyboard/mobile/long-data and
  human acceptance remain separate gates.
- Source/local `CWF-07` Workflow timing cues and `CWF-08` Schedule run of show.
  Workflow now separates timestamp-derived due-today, overdue, upcoming, and
  aging guidance from exact stored internal completion receipts, with bounded
  source, stale, partial, error, and retry presentation. Schedule now derives a
  bounded, expandable event-day sequence from recorded event, booking, staffing,
  checklist, and BEO inputs while labeling timing sources and unknowns. Neither
  surface invents provider delivery, customer contact, payment, booking,
  attendance, inventory, or operational-readiness evidence; persisted ownership,
  SLA/escalation, collaborative event operations, and hosted acceptance remain
  separate work.
- Source/local `CWF-09` bounded commercial intelligence in Reporting. The
  same-tenant quote read is capped at 500 displayed records and exposes source,
  last complete client read, truncation, explicit denominators, missing-money
  evidence, retained-stale/error/retry states, and UTC six-month trend context.
  Accepted/booked quote value remains separate from the paid-deposit total. A
  deposit amount qualifies for that verified total only from a Firebase-backed
  read with a paid state, valid provider-confirmation timestamp, and recorded
  amount; local, missing, or ambiguous evidence is excluded rather than treated
  as zero. These are operational measures, not tenant-wide totals when
  truncated and never accounting revenue.
- Source/local `CWF-10` decision-reconciliation and interaction polish in the
  existing exact-token customer decision center. Acceptance and requested-change
  attempts now distinguish submitting, uncertain, same-attempt reconciliation,
  exact receipt, changed-source review, definitive failure, and explicit
  recovery; typed-signature validation returns focus to the missing signer or
  consent control, and motion honors the customer's reduced-motion preference.
  The flow never auto-retries a decision or promotes acceptance into payment or
  booking evidence. Hosted customer acceptance remains pending.
- Authoritative pricing now owns actor identity and calculation time on the
  server and fingerprints the confirmed tenant pricing settings around catalog
  reads. Quote create, duplicate, edit, rebook, and Change Impact paths recheck
  that catalog authority at their trusted commit/read boundary and abort with a
  safe recalculate-and-retry outcome if the catalog revision, confirmation, or
  settings fingerprint changes. Browser-supplied actor/time remains
  non-authoritative, and no stale pricing result is silently committed.
- Source-complete `CWF-15A` Commercial Dependency Graph and Kitchen BEO
  download-time provenance. The frozen v1 registry validates node and edge
  contracts, rejects cycles and unknown dependencies, traverses downstream
  impact deterministically, and produces identical canonical bytes and SHA-256
  digests in browser and Node tests. The existing staff-only `Kitchen sheet`
  download now displays its exact source revision, graph/fingerprint/canonical
  schema versions, complete dependency digest, browser-local generated time,
  and an explicit non-freshness disclaimer. This slice performs no write,
  persists no generation record, and creates no `CURRENT`/`STALE`/`REVIEW`,
  actor, server-time, receipt, reconciliation, or publication evidence. It is
  source/local evidence only and is not deployed or hosted-operator accepted.
- A named temporary bundle exception for the unmerged customer-centered
  workspace convergence, with exact no-headroom ceilings of 2,650,137 aggregate
  JavaScript bytes and a 390,494-byte largest chunk. Targeted quote-store
  splitting reduced the authenticated route chunk from 448,190 to 310,102 bytes
  while preserving the unchanged clean-main baseline. The completed source/local
  checkpoint includes governed commercial-change, artifact-freshness, Decision
  Debt, Revenue Autopilot, central reply Attention, anniversary radar, and the
  CWF-16 Event Workspace
  surfaces. The machine-readable
  exception is pinned to the unchanged clean-main metrics and blocks baseline
  updates while active; normal 5% limits resume when the exception is removed.
  Passing this branch gate is not CWV, hosted, production, or human-acceptance
  evidence.

- A source-side `CWF-01`/`CWF-03` release-candidate slice for the flagged staff
  workspace. Home now exposes a compact read-context rail bound to the current
  tenant, the existing Workflow Attention, latest-200 quote-history, and bounded
  Revenue Autopilot operations contracts, each read outcome, the last complete
  client read, retained-stale or incomplete state, source, and quote-history/
  latest-50 unread-reply truncation. It explicitly labels Home as a
  derived presentation and says that freshness is not delivery, acceptance,
  booking, payment, or completion proof. The slice adds no read or write
  authority and never invokes the customer portal loader. First-release staff
  surfaces now use human-readable dates, money, enums, identifiers, sources,
  and semantic empty copy; routed Quotes and Workflow say **Back to Home** and
  receive visible heading focus, while their true modal wrappers retain
  **Close**. Hosted signed-in, contrast, long-data, branding-isolation, and
  human acceptance remain separate gates.
- The implemented governed customer-workspace tranche spans `CWF-01` through
  `CWF-15`,
  covering visual credibility, evidence/freshness, bounded search and timelines,
  proposal/workflow/event/reporting intelligence, post-event rebooking, email
  follow-up and payment dunning, Customer 360 activation, a no-orphan-capability
  gate, and a high-priority deterministic Commercial Dependency Graph for
  change blast radius, artifact freshness, and decision debt. The track pairs
  user-relevant backend contracts with polished, discoverable, role-safe
  frontend states and keeps provider, payment, booking, pricing, customer-view,
  and accounting authority distinct. CWF-15 now combines the source-complete
  registry/fingerprint and advisory simulation with separately governed server
  simulation/authorization/apply, invalidation/reconciliation, trusted Kitchen
  BEO generation and retained receipt download, and deterministic Decision Debt.
  Browser-supplied digest, source revision, actor, or time can never become
  receipt truth.
- A required diff-aware capability-surfacing check in `lane:core`, backed by a
  versioned capability-surfacing contract manifest. It inventories changed,
  new, or removed
  Firebase Functions by exact symbol, resolves PR/push comparisons fail-closed,
  falls back to `origin/main` when a branch upstream equals `HEAD`, includes
  deleted authority paths, records shared-helper affected exports, and requires
  assertion-bearing tests plus canonical per-state component markers for read
  and mutation profiles. Only the explicitly deferred stale-read state may use
  a narrow exception; callable exports cannot use any headless classification.
  The scanner now reviews runtime client paths fail-closed, promotes otherwise
  presentational files when direct authority signals appear, detects chained
  and modular Firestore writes, and requires affected callable exports for
  every active shared Functions helper contract.
  Reviewed entry, Feature Matrix, and User Manual locators remain
  mandatory while structural evidence stays distinct from semantic, visual,
  hosted, provider, production, and human acceptance.
- Receipt-safe live mutation states for trusted customer import, quote-scoped
  conversation send, and approval-bound contract conversion. Each surface now
  distinguishes ready, submitting, uncertain, same-identity reconciliation,
  trusted receipt, definitive error, and recovery without inferring outbound
  delivery, payment settlement, customer confirmation, or operational
  readiness. Contract conversion also preserves the canonical customer link on
  both the immutable version and its snapshot, with passing local emulator
  assertion coverage; coordinated deployment and hosted acceptance remain
  pending.
- Unresolved conversation sends now retain their exact request identity and
  unchanged body in bounded app memory across panel close/unmount, keep one
  unload warning active, and reconcile with that identity after reopen; no
  quote content is written to browser storage. Definitive rejection requires an
  explicit safe reset. Import Studio likewise locks Close/reset/source/file
  replacement while a batch is submitting or unresolved and keeps the same
  batch identity through catalog-source refresh recovery.
- A temporary-flagged, dependency-free staff route foundation for `/app`,
  Customers, Quotes, the five-step builder, focused quote/edit records,
  Workflow, Schedule, Reporting, Catalog, Imports, Integrations, and
  Diagnostics. The six operational tools use recoverably lazy embedded route
  views with their existing role and feature gates, while contextual and
  legacy callers retain the guarded modal wrappers. The browser History API
  preserves Back/Forward and mounted in-memory work; `/app/home` canonicalizes
  to `/app`, unknown staff paths receive an authenticated in-shell 404, and
  `?portal=<token>` retains precedence with canonical `/app?portal=...` links.
  Dirty quote drafts receive `beforeunload` protection and are not serialized
  into route state or storage.
- A recoverably lazy Commercial Command Center at `/app` when the temporary
  customer-centered workspace build flag is enabled. One generation-guarded
  quote/attention snapshot feeds Home and the header badge, including a bounded
  projection of unread customer-reply Attention from the existing Revenue
  Autopilot operations read, and exact Workflow
  actions carry quote ID, attention type, and request ID. Home introduces no
  new read contracts or data sources and no new commercial write authority. A
  shared status-semantics module and `StatusChip` keep quote lifecycle,
  acceptance, booking, deposit, final balance, readiness, and attention labels
  textually distinct even when they share a visual family. Customer names in
  attention rows open Customer 360 when a stable ID exists, while the row action
  retains its exact Workflow focus and quote/payment actions retain exact quote
  focus.
- A paginated same-tenant customer directory and Internal Customer 360 with
  Overview, Quotes & Proposals, Events, Money, and Conversations sections.
  Customer 360 derives bounded summaries from customer-scoped canonical quote
  reads, exposes quote/workflow/Schedule/BEO entry points, keeps payment states
  distinct from accounting revenue, and aggregates conversation links without
  merging quote-scoped message histories. It shows the bounded most-recent
  immutable proposal versions per quote, reports version truncation explicitly,
  and uses server-owned per-quote conversation counts/latest-actor summaries
  when available. Its keyboard-recoverable staff proposal preview adapts
  canonical data without calling the public portal loader or creating customer
  `viewed` evidence.
- Stable server-owned `customerId` bindings on trusted canonical quote writes
  and immutable versions, generated opaque IDs for new quote-projected
  customers, private server-only normalized-email ownership claims, normalized
  customer search keys, collision-safe edit behavior that retains the existing
  identity, and a dry-run-first legacy binding tool whose apply mode is
  restricted to loopback Firestore emulators and `demo-*` projects. Customer
  directory list reads require same-tenant staff and an explicit bounded query.
  No customer ID or email-claim record is added to the public portal projection,
  no persisted `commercialSummary` cache is introduced, and no production
  backfill is authorized.
- Customer CSV create and rollback now use admin-only trusted callables instead
  of direct browser writes. New imports receive opaque stable IDs and
  server-owned normalized directory keys, while receipts preserve exact-input
  replay, duplicate/collision refusal, modified-record rollback protection,
  and safe rollback compatibility for legacy customer-import receipts.
- Neutral staff chrome: the authenticated staff workspace now renders on a
  calm warm-neutral shell (flat paper background, charcoal header, white
  panels) instead of the tenant-tinted full-screen gold gradient and
  pinstripe overlay. The change is scoped by an `app-shell-neutral` class on
  staff shells only: tenant identity remains in the workspace header chip,
  and the customer portal, proposal artifacts, and marketing surfaces keep
  their tenant-branded hospitality treatment unchanged.
- Pre-host staff-shell polish keeps the full desktop action row contained at
  the covered 1440px, 1366px, 1280px, and 1024px widths without changing the
  mobile More menu. Embedded Schedule, Reporting, Catalog, Imports,
  Integrations, and Diagnostics routes now say **Back to Home**, while their
  true modal wrappers retain **Close**. Accepted calendar facts are labeled
  accepted rather than hold, and programmatically focused routed-workspace
  headings receive a scoped visible outline.
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
  checks. These evidence primitives remain available even though the normal
  solo release path now performs the final provider mutation in-repository.
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

- Production release operation now uses the existing repository's manual
  Firebase and Vercel workflows instead of requiring a second deployer
  repository. Each workflow binds the fixed provider target to an exact
  semantically tagged `main` SHA, successful eight-job main CI run, rollback
  ancestor, protected environment, allowlisted human dispatch, and typed
  confirmation; it repeats evidence verification immediately before the
  provider mutation and scopes each provider token to that deploy step.
- Workspace selection cues now use a short two-grain click-chirp while
  remaining behind the central sound preference and fail-silent Web Audio
  boundary.
- The full provisioning emulator acceptance runner now fails immediately unless
  both quote-payment and buyer-access Stripe rails are explicitly configured for
  test mode, both synthetic webhook secrets are present, the buyer-access server
  gate is enabled, and its application URL is supplied. No provider request or
  production secret is used by this lane.
- Browser navigation smoke coverage now recognizes the Workflow button's live
  accessible-status suffix, preventing a release check race after attention
  data loads.
- Quote History and Schedule now present quote/proposal lifecycle, booking
  confirmation, deposit, final balance, and delivery readiness as separately
  labeled facts. Reporting labels accepted/booked quote value separately from
  verified paid-deposit totals and explicitly avoids describing either as
  accounting revenue.
- Firebase backend/all artifact preparation now includes the reviewed
  versioned starter-pack manifest required by staged organizations while
  rejecting every other unapproved nested Functions data file.
- Production buyer-access browser flags are scoped to release configuration
  validation and frontend builds, so preparation unit tests retain their
  default-off environment while the prepared artifact keeps the approved
  public test-access configuration.
- Production preparation and UAT evidence now identify their canonical GitHub
  Actions workflows by immutable repository workflow ids and tracked paths,
  while complete evidence-bearing run titles remain independently validated.
  This accepts GitHub's dynamic `run-name` value in the API `name` field
  without weakening workflow identity checks.
- Vercel Git-triggered deployments are disabled in the reviewed project
  configuration. Merging or pushing a branch can no longer create or promote a
  Vercel deployment; production promotion remains a separate governed action
  against the deterministic release artifact.
- Release evidence supports an explicit solo-owner policy without fabricating
  a second reviewer. The initial two-dispatch UAT/preparation design is retained
  as an optional higher-assurance evidence path; the normal deploy path uses one
  allowlisted human dispatch, protected-branch-only environment, exact CI,
  rollback evidence, and typed target confirmation. Independent-review mode
  remains available for team-owned repositories.

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

- Quote-conversation staff sends now clear an absent Revenue Autopilot Attention
  pointer through the conversation-state replacement itself instead of passing
  an invalid nested Firestore delete sentinel. Customer-message pointers and
  staff-reply Attention resolution retain their exact latest-message binding.
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

- Canonical organization quote reads are now staff-only: the legacy
  verified-email customer grant is retired, and signed-in browsers can no
  longer self-create a `customer` role document. Exact-token customer-safe
  portal reads, expiry/rotation, server-authoritative acceptance, signed
  payment truth, and quote-scoped conversation behavior remain unchanged.
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

- Restored Kitchen sheet downloads in the Vite development and Playwright
  runtime by explicitly pre-bundling the reviewed CommonJS dependency-graph
  core for browser ESM interop. The Node `require()` parity entry and production
  bundle path remain unchanged.
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
