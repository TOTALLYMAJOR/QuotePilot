# QuotePilot Development Tasks

Last updated: 2026-09-14 02:59:23 CDT

This file contains open work only. Completed delivery belongs in
[`CHANGELOG.md`](CHANGELOG.md), current evidence in
[`PROJECT_STATUS.md`](PROJECT_STATUS.md), and full capability inventory in
[`docs/FEATURE_MATRIX.md`](docs/FEATURE_MATRIX.md).

## P0 — Reconcile the current release surface

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
  workflow against that evidence. Keep interview preference, observed behavior,
  product usage, and commercial outcome as separate proof classes.
- [ ] Create and execute a quote-acceleration plan. Measure the current path
  from inquiry to usable priced draft and customer-ready quote, identify the
  highest-cost waits, repeated entry, navigation, and correction loops, then
  test the smallest improvements through reusable Offers/templates, staged
  imports, contextual defaults, progressive disclosure, and faster pricing
  feedback. Set the speed target only after the baseline is recorded, and prove
  that improvement without weakening exact pricing, imported/defaulted
  provenance, revision history, approval gates, responsive accessibility, or
  customer-facing accuracy.
- [ ] Converge the caterer operating experience through the existing Now,
  Opportunity, Library, Workflow, and Operations surfaces rather than adding
  more primary modules. Now must distinguish **Act now**, **Waiting on
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
  import, provide a downloadable canonical CSV template, preserve imported
  provenance through staged review, and return the confirmed batch to the exact
  Menu Builder and cost-gap review. Keep imported, saved, published, customer
  price, recorded item cost, recipe/menu-cost evidence, and physical Inventory
  readiness as distinct states; require focused tests plus 390/768/1440 and
  human-comprehension acceptance.
- [ ] Run the exact current candidate at 390, 768, and 1440 pixels for admin and
  sales roles, then record overflow, focus, reduced-motion, forced-colors,
  assistive-technology, and human comprehension evidence separately.
- [ ] Finish terminology cleanup where internal names such as Decision Debt or
  Revenue Autopilot appear in ordinary operator copy without helping a decision.
- [ ] Preserve the canonical route hierarchy: global orientation, exact-object
  context, and contextual action. Do not promote capability existence into a
  permanent destination without a recurring user job.

## P1 — Bounded future programs

- [ ] Keep Stripe Connect provider-disabled until an exact isolated staging plan
  is reviewed and separately authorized.
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
