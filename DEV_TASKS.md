# QuotePilot Development Tasks

Last updated: 2026-09-24 17:39:10 CDT

This file contains open work only. Completed delivery belongs in
[`CHANGELOG.md`](CHANGELOG.md), current evidence in
[`PROJECT_STATUS.md`](PROJECT_STATUS.md), and full capability inventory in
[`docs/FEATURE_MATRIX.md`](docs/FEATURE_MATRIX.md).

## Actor-journey initiative delivery packets

These packets order the open work below around the actor journey in
[`docs/product-intelligence/USER_JOURNEY_FUNNELS.md`](docs/product-intelligence/USER_JOURNEY_FUNNELS.md).
They are a dependency and acceptance layer over the existing backlog, not a
second roadmap. A packet closes only when every acceptance criterion has a
linkable receipt in its named evidence class; source or local proof cannot stand
in for hosted, provider, production, human, or outcome proof.

The shared acceptance contract for every packet is: preserve tenant and role
denial, exact commercial revisions, server-authoritative pricing, explicit
missing/stale/ambiguous states, one safe recovery action, responsive keyboard
and assistive-technology behavior, and separate evidence-class receipts.

### `QPI-01` — Establish a trusted operator release

- **Actor journey:** owner-operator, administrator, sales operator;
  `JRN-02`, `JRN-04`, `JRN-06`–`JRN-08`; `CAP-06`, `CAP-12`.
- **Job:** enter the exact hosted workspace and act on the correct tenant,
  role, event, and revision without trusting stale or ambiguous state.
- **Depends on:** none; this is the release-proof prerequisite for downstream
  hosted packets.
- **Acceptance criteria:** exact source SHA and deployment are bound to the
  receipt; administrator and sales journeys pass with cross-tenant denial;
  Inventory recovery records App Check, command, and projection outcomes
  without an uncertain retry; 390/768/1440, keyboard, forced-colors,
  assistive-technology, and actor-comprehension evidence are recorded.
- **Evidence needed:** CI, hosted, production readback, security-denial, and
  human receipts. Outcome proof is not required to unlock the next packet.

### `QPI-02` — Reach the first trustworthy priced quote

- **Actor journey:** owner-operator and sales/catalog administrator;
  `JRN-02`–`JRN-04`; `CAP-02`, `CAP-03`, `CAP-06`.
- **Job:** turn realistic source material into a reviewed catalog and first
  server-priced, saved quote without losing provenance or work on interruption.
- **Depends on:** `QPI-01`.
- **Acceptance criteria:** a realistic spreadsheet/document import retains
  origin through staged review and publication; customer price, recorded cost,
  recipe/menu-cost, and physical Inventory readiness remain distinct; the first
  and repeat quote paths produce exact pricing and saved-version receipts;
  recovery resumes the same work; elapsed time, corrections, and blockers are
  captured before adopting a speed target.
- **Evidence needed:** local/CI, hosted role and recovery, human comprehension,
  and baseline observation receipts for `MET-01`–`MET-05` and `MET-08`.

### `QPI-03` — Convert governed intent into a customer decision

- **Actor journey:** customer event contact and sales operator; `JRN-03`,
  `JRN-05`; `CAP-01`, `CAP-04`, `CAP-12`.
- **Job:** submit incomplete intent, receive one current decision artifact, and
  make a decision without a draft or provider event being mistaken for consent.
- **Depends on:** `QPI-01`, `QPI-02`.
- **Acceptance criteria:** one curated Inquiry Showcase is published without
  auto-publication; fresh challenge, wrong-host/action, replay, quota, recovery,
  retention, and atomic conversion cases pass; proposal issuance, provider
  acceptance, portal view, customer decision, expiry, and revision remain
  separate receipts; customer and staff complete the journey accessibly.
- **Evidence needed:** local/CI, hosted, provider, production-data, accessibility,
  customer, and staff-human receipts. Conversion outcomes remain separate.

### `QPI-04` — Reconcile ordinary payment and closeout

- **Actor journey:** customer event contact, owner-operator, and finance
  reviewer; `JRN-05`, `JRN-09`; `CAP-07`–`CAP-09`.
- **Job:** request and reconcile the deposit/final balance and close the event
  without duplicating a payment or collapsing planned and actual evidence.
- **Depends on:** `QPI-01`, `QPI-03`.
- **Acceptance criteria:** hosted deposit and final-balance paths bind the exact
  commercial obligation; request, browser return, provider acceptance, webhook
  settlement, refund/failure, and reconciliation remain distinct; ambiguous
  outcomes recover by attempt identity before retry; actual attendance and its
  correction do not rewrite the commercial basis; Truth Loop output remains
  read-only and labels unavailable evidence honestly.
- **Evidence needed:** local/CI, hosted, Stripe-provider, production readback,
  finance-reviewer, and customer-human receipts. **Stripe Connect is excluded.**

### `QPI-05` — Carry accepted change into current operations

- **Actor journey:** sales operator, operations manager, kitchen lead, and
  staffing administrator/event lead; `JRN-06`, `JRN-07`; `CAP-04`–`CAP-06`.
- **Job:** change accepted work while preserving prior truth and identifying
  each affected owner, artifact, consequence, and recovery action.
- **Depends on:** `QPI-01`, `QPI-03`.
- **Acceptance criteria:** one accepted-work amendment completes simulation,
  grouped consequence review, authorization, atomic apply, exact readback, and
  immutable receipt; Event Preflight, Staffing, Inventory, schedule, production,
  and Kitchen BEO consumers show current/stale/unavailable independently; each
  affected owner has one safe next action; stale or uncertain apply outcomes
  reconcile before another mutation.
- **Evidence needed:** local/CI, hosted authorized-role and denial, production
  command/readback, and cross-role human receipts for `MET-07`, `MET-11`,
  `MET-12`, and `MET-17`.

### `QPI-06` — Pilot reviewable Delivery Planning

- **Actor journey:** owner-operator, operations manager, kitchen lead, and
  staffing administrator/event lead; `JRN-07`; `CAP-02`, `CAP-05`, `CAP-06`.
- **Job:** turn an accepted staffed-buffet promise into reviewable work,
  production, and purchasing proposals without inventing quantities or authority.
- **Depends on:** `QPI-02`, `QPI-05`.
- **Acceptance criteria:** five owner-operators review two recent comparable
  events each and freeze the baseline definitions; one real tenant binds an
  operator-reviewed Blueprint, quantity policy, and purchasing-pack revisions;
  Staffing, Production, and Purchasing each reread authority, reject stale
  input, obtain their own approval, and issue their own receipt; no inferred
  stock, staffing ratio, production quantity, supplier action, or blended
  readiness claim is introduced.
- **Evidence needed:** source/local, hosted role, connected tenant, cross-role
  human, baseline, and guarded pilot receipts for `MET-03`, `MET-11`, `MET-12`,
  and `MET-16`.

### `QPI-07` — Execute, recover, and close one controlled event

- **Actor journey:** operations manager, event lead, kitchen lead, and finance
  reviewer; `JRN-08`, `JRN-09`; `CAP-05`, `CAP-06`, `CAP-08`, `CAP-09`.
- **Job:** run the current event, recover from one realistic ambiguity, and
  explain closeout from current evidence.
- **Depends on:** `QPI-04`, `QPI-06`.
- **Acceptance criteria:** event-day surfaces preserve event and revision context;
  one unavailable, stale, or contradictory case reaches safe recovery without
  history loss or duplicate action; attendance, consumption, payment, cost,
  payout availability, and contribution stay separate; a finance reviewer can
  explain every finding and unresolved evidence state.
- **Evidence needed:** hosted/production operational receipts, provider evidence
  where applicable, cross-role human review, and outcome observation without
  granting the reconciler write authority.

### `QPI-08` — Prove safe reuse and commercial value

- **Actor journey:** owner-operator, sales operator, finance reviewer, and
  returning customer contact; `JRN-10`, `JRN-11`; `CAP-10`–`CAP-12`.
- **Job:** use prior relationship knowledge to accelerate a new engagement
  without cloning obsolete price, acceptance, payment, or provider authority.
- **Depends on:** `QPI-07`.
- **Acceptance criteria:** a provenance-preserving rebook carries only allowed
  context into a new draft; current authority is re-established before pricing,
  proposal, or payment; direct buyer validation, repeated production use,
  retention, referral, and commercial measures have denominators, freshness,
  exact cohorts, and owner decisions; `USED` and `COMMERCIALLY_PROVEN` remain
  unclaimed until their receipts exist.
- **Evidence needed:** hosted and human rebook acceptance plus usage, retention,
  referral, revenue, and outcome evidence.

### `QPI-09` — Evaluate bounded operator assistance

- **Actor journey:** owner-operator and sales operator; `JRN-03`, `JRN-04`,
  `JRN-06`, `JRN-08`; `CAP-03`, `CAP-04`, `CAP-06`, `CAP-12`.
- **Job:** prepare a draft, summary, question list, or communication while the
  operator retains every pricing, commitment, approval, assignment, and send.
- **Depends on:** `QPI-02`, `QPI-03`, `QPI-05`.
- **Acceptance criteria:** reviewed provider transport, private context,
  consent, persistence, spend/timeout limits, deterministic fallback, and kill
  switch are proven before exposure; typed/manual operation remains available;
  model output is fact-by-fact reviewable and cannot mutate authority; at least
  100 representative/adversarial packets receive human comparison before any
  broader pilot decision.
- **Evidence needed:** security/local, hosted role and denial, provider, privacy,
  human-comparison, cost, latency, and correction receipts. No model-output or
  outcome claim is implied by the current dormant source foundation.

## NOW — v0.20 release publication

The bounded execution plan is
[`docs/plans/v0.20.0-release-publication-plan.md`](docs/plans/v0.20.0-release-publication-plan.md).
It classifies the current dirty checkout once, preserves unrelated work, and
orders publication, exact-head CI, deployment, and `QPI-01` proof without
turning GitHub issues or the plan into a competing roadmap.

- [ ] `QPR-003` — Review and package the catalog-import and first-quote cohort.
  Depends on completed `QPR-002` package commit `11391b7c`; content repair
  requires a separately planned task.
- [ ] `QPR-004` — Review and package the Ambient workspace and responsive
  Inventory cohort. Depends on `QPR-003`; content repair requires a separately
  planned task.
- [ ] `QPR-005` — Review and package the release-test and browser-harness cohort.
  Depends on `QPR-003` and `QPR-004`; local emulator proof remains local.
- [ ] `QPR-006` — Synchronize state, capability, performance, and release docs
  to the exact packaged source. Depends on `QPR-002`–`QPR-005`.
- [ ] `QPR-007` — Prove one clean exact-SHA release candidate. Depends on
  `QPR-006`; all required local lanes must pass from the clean candidate.
- [ ] `QPR-008` — Publish the candidate and obtain exact-head CI receipts.
  Depends on `QPR-007`; no provider deployment is implied.
- [ ] `QPR-009` — Run protected provider deployment and rollback/readback proof.
  Depends on `QPR-008`; Vercel, Firebase, and production-data receipts remain
  separate.
- [ ] `QPR-010` — Complete automated hosted `QPI-01` role, tenant-denial,
  Inventory-recovery, App Check monitoring, and responsive evidence. Depends on
  `QPR-009`; no human-acceptance claim is implied.
- [ ] `QPR-011` — Record assistive-technology, operator-comprehension, and owner
  acceptance receipts for `QPI-01`. Depends on `QPR-010`; this is explicitly
  `ready_for_human`, not agent-completable work.

## Deferred — excluded from the active dependency graph

- **Stripe Connect:** keep provider-disabled at its documented stopping point.
  It is not a dependency of `QPI-01`–`QPI-09` or ordinary deposit/final-balance
  acceptance. Re-entry requires a separate owner decision, reviewed isolated
  staging plan, and a new dependency/acceptance review.

## P0 — Reconcile the current release surface

- [ ] Review and ratify the Proofloom-generated intent index, standards
  profile, and capability-routing policy before enabling those control-plane
  planes. The installed manifest already binds `CHANGELOG.md` and the accepted
  ADR history; this review must not create parallel product or backlog
  authority.
- [ ] Run an authenticated `mm05366-sandbox` administrator acceptance journey
  across Living Opportunity, Quote administration, Operations, Inventory,
  Library pricing review, and exact readback. Include sales/non-admin and
  cross-tenant denial checks.
- [ ] Retry the Inventory operator workflow only through its displayed recovery
  path and record whether App Check monitoring, identity, role, tenant gates,
  command receipt, and projection readback agree. Do not repeat an uncertain
  write.
- [ ] Register and review the browser App Check provider before considering hard
  enforcement. Keep monitoring until hosted token evidence exists.

## P0 — Govern founder-pilot population

- [ ] Review `ragnakok-operations-v1` as a privileged exact-tenant fixture
  migration before any hosted apply. Explicitly approve or remove its ability
  to enable Inventory/Staffing settings and reconfirm the current catalog
  revision; those are authority transitions, not ordinary fixture writes.
- [ ] If separately authorized, publish the generated staff assets, run the
  staging dry-run/apply/readback first, then repeat for production with exact
  target, organization, counts, revisions, receipts, and rollback evidence.
- [ ] Replace synthetic stock, costs, availability, qualifications, customer
  decisions, and provider states through their normal governed workflows before
  relying on the operating twin for a live event.
- [ ] Complete a human Catalog pricing review for revisions 23 and 60 before
  authoritative quote saves use the populated catalogs.

## P0 — Provider and customer safety

- [ ] Complete ordinary proposal-email provider, webhook, recipient, and human
  acceptance without treating provider acceptance as inbox receipt.
- [ ] Complete coordinated hosted Stripe deposit and final-balance acceptance;
  preserve request, browser return, webhook settlement, and reconciliation as
  separate evidence.
- [ ] Keep buyer access closed until restricted test credentials, webhook
  checks, Turnstile checks, and a bounded hosted acceptance plan pass.
- [ ] Qualify Guided Inquiry without auto-publication: curate and preview one
  customer-safe Showcase, publish one reviewed slug, then prove a fresh browser
  challenge plus wrong-host/action and replay rejection, durable submission and
  recovery, notification isolation, authenticated conversion, and one actual
  scheduled retention deletion. Preserve source/local, CI, hosted, provider,
  production-data, accessibility, human, and commercial-outcome receipts
  separately.
- [ ] Add emulator acceptance for anonymous direct-Firestore denial, tenant
  isolation, exact-slug lookup, IP/tenant quotas, replay/recovery, stale
  publication rejection, concurrent duplicate conversion, and atomic
  quote/customer/portal/version/Converted-receipt creation before production
  tenant activation.

## P1 — Operational coherence

- [ ] Replace the phone-width Inventory evidence table with a legible
  responsive record layout or clearly signposted contained scroll treatment.
  Preserve ingredient, physical on-hand, committed, available-to-allocate,
  cost-evidence, location, and purchase-pack axes without clipped headers or
  collapsing distinct stock and cost evidence.
- [ ] Run the Delivery Planning evidence baseline with at least five owner-
  operators and two recent staffed-buffet events each; freeze the reviewable-
  quote-plus-proposal milestone, 30% median-time target, and material-
  correction definition before pilot acceptance.
- [ ] Use **Library → Delivery** to enter and bind one real operator-reviewed
  tenant `delivery-blueprint-v1`, bounded `quantity-policy-v1` set, and exact
  purchasing-pack revisions; capture the connected catalog-save and pricing-
  confirmation receipt, then connect exact saved-revision Staffing and
  Inventory projections without inferring missing stock, role ratios, or
  production quantities. The source/local activation editor is implemented;
  no tenant declaration or connected activation receipt exists yet.
- [ ] Connect `delivery-handoff-v1` to role-safe Staffing, Production, and
  Purchasing workflows only after each target rereads current authority,
  rejects stale inputs, obtains its own approval, issues its own receipt, and
  returns current/stale/rejected/pending evidence without losing the quote's
  session proposal.
- [ ] Specify separate Staffing work-block authority, Inventory prepared-batch
  semantics, purchasing-provider authority, and approved-Blueprint alternative
  comparison before activating those later Delivery Planning phases.
- [ ] Verify Commercial Change and Event Spine tenant activation only through
  their protected coupled workflow; Inventory or Staffing activation must not
  imply either mutation authority.
- [ ] Exercise accepted/booked changes through quote amendment, Event Preflight,
  Staffing, Inventory, Schedule conflicts, and Kitchen BEO freshness. Confirm
  that each stale or unavailable result owns one safe recovery action.
- [ ] Add cursor-based Inventory navigation before any organization exceeds the
  current bounded ingredient/location or menu-projection limits.
- [ ] Decide whether the legacy CWF-16 Event Workspace should remain as a
  compatibility surface after hosted Living Opportunity parity and rollback
  evidence are accepted.

## P1 — Product and design acceptance

Related execution map: [GitHub issue #149](https://github.com/TOTALLYMAJOR/quoteflow/issues/149)
ties the external solution-design review takeaways to the existing tasks below;
it does not create a parallel roadmap or product authority.

- [ ] Run a route-by-route **9.5 quality program** without manufacturing a
  score from source inspection alone. Grade task clarity/decision compression,
  speed and interruption recovery, truthful state/provenance/recovery,
  responsive accessibility, QuotePilot-specific hierarchy and language,
  performance/feedback, and rendered human evidence. Require at least 95/100,
  no category below 9/10, no unresolved safety defect, and representative
  admin/sales, 390/768/1440, keyboard, 200% zoom, forced-colors, and human-
  comprehension evidence before calling a page 9.5. Improve in this audited
  order: Quote creation/editing, first-run onboarding, Inventory, Import Studio,
  People/event Staffing, then Events/Operations integration. Re-score Now,
  Opportunities, Clients, Library, and Messaging only after their current
  uncommitted work is reconciled; preserve the strongest existing surfaces
  instead of restyling them for score theater.
- [ ] Validate the proposed Living Event Plan, Inventory quick-entry, menu-
  costing, and event Staffing direction against direct caterer evidence before
  treating the concepts as solved pain. Observe representative owners,
  salespeople, kitchen leads, and staffing coordinators doing real quote and
  event-planning work; rank problems by frequency, consequence, workaround,
  and willingness to change; then connect, revise, or reject each proposed
  workflow against that evidence. In the same sessions, test whether small
  owner-operated caterers recognize QuotePilot's core promise as a faster path
  from inquiry to a trustworthy proposal with a controlled operational handoff;
  preserve their own language, current workaround, and willingness to change or
  pay. Do not broaden into a generic service-business platform without evidence
  that the shared need outweighs the catering-specific advantage. Keep interview
  preference, observed behavior, product usage, and commercial outcome as
  separate proof classes.
- [ ] Create and execute a quote-acceleration plan. Measure the current path
  through two separate baselines: **cold-start activation** from realistic
  spreadsheet, document, or inquiry material through reviewed setup and a first
  customer-ready quote; and **repeat quoting** from a new inquiry in a configured
  tenant to an authoritative sendable quote. When Delivery Planning applies,
  measure quote-plus-reviewable-Delivery-Proposal time separately. Define the
  start and end events and record corrections, recovery, and customer-facing
  accuracy alongside elapsed time so speed cannot be bought by skipping gates.
  Identify the highest-cost waits, repeated entry, navigation, and correction
  loops, then test the smallest improvements through reusable Offers/templates,
  staged imports, contextual defaults, progressive disclosure, and faster
  pricing feedback. Set the speed target only after the baselines are recorded;
  treat a three-minute quote as a hypothesis rather than an adopted claim. Prove
  improvement without weakening exact pricing, imported/defaulted provenance,
  revision history, approval gates, responsive accessibility, or customer-facing
  accuracy.
- [ ] Converge the caterer operating experience through the existing Now,
  Opportunity, Library, Workflow, and Operations surfaces rather than adding
  more primary modules. Optimize for an owner-operator who may perform sales,
  scheduling, Inventory, and coordination work in one day: organize the
  experience around the current job, event context, and next action without
  merging authorization roles or business authorities. Now must distinguish
  **Act now**, **Waiting on
  someone**, and **Coming up**; group multiple downstream effects under their
  one underlying decision; preserve full Calendar/work-list access; ask for
  information only when its named transition needs it; support honest Unknown,
  Not applicable, and Awaiting client states; offer guided and batch modes over
  the same authority; use outcome-named actions and receipts; preserve mobile
  drafts/synchronization/resume; and retain revision-labeled printable outputs.
  The first real event should create selective reusable setup without turning
  one-off details into tenant defaults. Validate each slice against observed
  caterer work and its stated measure before promoting the next hypothesis.
- [ ] Add contextual Notes as typed, audience-safe event evidence instead of
  one unscoped text field. Distinguish internal working notes, customer-visible
  proposal language, venue/load-out facts, and published staff instructions;
  bind each persisted note to actor, time, tenant, event and applicable
  revision, preserve draft versus published state, and make changed
  instructions recoverable and acknowledgeable without exposing private notes
  in customer or staff artifacts.
- [ ] After each menu selection or quantity change, show the exact current
  **supportable portions remaining** only when the saved menu-output quantity,
  recipe revision, ingredient conversions, physical stock, active allocations,
  and projection freshness support that conclusion. Show the constraining
  ingredient and first unsupported boundary separately; otherwise say why the
  amount is unavailable or stale. This is planning evidence, not finished-menu
  stock, automatic procurement, permission to overbook, or a commercial save.
- [ ] Raise the customer proposal PDF to the same polished standard as the
  customer decision experience: tenant brand and logo, stronger event/menu
  narrative, clear pricing and deposit hierarchy, disciplined pagination,
  readable typography, terms and next action, and quiet quote/revision/
  generation provenance. Preserve exact saved proposal and pricing inputs,
  exclude staff-only cost/margin/private notes, label draft or snapshot state,
  and qualify print, download, portal-link, 390/768/1440 preview, accessibility,
  and human-comprehension behavior with representative short and long quotes.
- [ ] Complete the first-quote activation continuation: when Library sends an
  administrator to Import Studio for Offers and menu, orient the route to menu
  import, provide a downloadable canonical CSV template, and measure activation
  from the operator's real source material rather than an already configured
  catalog. Preserve imported provenance, interruption-safe resume, and recovery
  through staged review, then return the confirmed batch to the exact Menu
  Builder and cost-gap review. Keep imported, saved, published, customer price,
  recorded item cost, recipe/menu-cost evidence, and physical Inventory readiness
  as distinct states; require focused tests plus 390/768/1440 and human-
  comprehension acceptance.
- [ ] Run the exact current candidate at 390, 768, and 1440 pixels for admin and
  sales roles, then record overflow, focus, reduced-motion, forced-colors,
  assistive-technology, and human comprehension evidence separately.
- [ ] Finish terminology cleanup where internal names such as Decision Debt or
  Revenue Autopilot appear in ordinary operator copy without helping a decision.
- [ ] Preserve the canonical route hierarchy: global orientation, exact-object
  context, and contextual action. Do not promote capability existence into a
  permanent destination without a recurring user job.

## P1 — Bounded future programs

- [ ] Keep Steward non-authoritative and private until transport, consent,
  persistence, and human-comparison protocols are approved.
- [ ] Reconcile tenant operating-model and workflow-pack pilots against current
  authority before activation; do not infer usage or outcome from seeded data.
- [ ] Complete hosted acceptance for Customer 360 identity, structured change-
  request resolution, Workflow timing, run of show, Reporting intelligence,
  portal decision recovery, rebooking/closeout, and commercial measures. Treat
  this as proof work for existing capabilities, not reconstruction.
- [ ] Run tenant-scoped dry runs for portal projection and legacy customer
  identity binding. Review exact conflicts and counts before any separately
  authorized apply.
- [ ] Activate bounded model-assisted intake and workflow help after provider
  choice, secret binding, privacy review, cost/timeout limits, hosted role and
  denial cases, and deterministic fallback are accepted. Use AI inside existing
  work to prepare drafts, summarize changes, identify unanswered questions,
  suggest relevant prior events, and draft communications; require structured
  per-fact review before adoption. Keep typed/manual operation available and
  keep permissions, pricing, commitments, approvals, allocation, assignment,
  and publication outside free-form model judgment, with an independently
  reversible runtime kill switch.

## P1 — Release, performance, and recovery infrastructure

- [ ] Retire the remaining `functions.config()` compatibility only through an
  exact coordinated backend release and runtime readback before its platform
  deadline.
- [ ] Complete workload-identity deployment and tenant-operator proof before
  retiring any legacy deployment credential; never replace it with a service-
  account key.
- [ ] Close temporary bundle exceptions through reviewed graph optimization or
  clean-main baseline recalibration, then rerun both graph profiles, browser,
  and Core Web Vitals gates.
- [ ] Verify the installable recovery shell on supported hosted desktop/mobile
  browsers. Offline recovery must never present cached authenticated data or a
  trusted mutation as current.
- [ ] Complete hosted Package Workspace and Import Workbench role, revision-
  conflict, responsive, recovery, and human acceptance.

## P2 — Integrations and workspace cohesion

- [ ] Normalize route frames, mobile editorial type, search behavior, evidence
  disclosures, selected-object relationships, and truthful imagery using the
  existing staff-app cohesion acceptance matrix.
- [ ] Add CRM or webhook bridges only with tenant isolation, idempotency, audit,
  and provider acceptance. Add accounting export only against reconciled
  invoice/payment evidence, never operational quote measures as revenue.
- [ ] Specify two-way SMS only after sender/A2P, opt-out, inbound webhook,
  thread authority, privacy, and retention policy are settled.
- [ ] Move additional pricing and escalation behavior into reviewed tenant
  policy and add finer approval/reporting roles only with exact migration and
  denial evidence.

## P2 — Commercial proof

- [ ] Record direct buyer validation, paying customers, recurring production
  usage, revenue, retention, and measurable outcomes. Until receipts exist,
  leave `USED` and `COMMERCIALLY_PROVEN` unclaimed.
