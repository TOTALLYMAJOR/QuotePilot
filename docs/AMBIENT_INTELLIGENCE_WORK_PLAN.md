# QuotePilot Ambient Intelligence Work Plan

Last updated: 2026-08-28 10:28:54 CDT

Status: approved product direction and open implementation plan. The Pilot Slice
Alpha source implementation is included with this document behind a default-off
presentation gate; the broader 50-item program remains open. Local tests and
browser review establish only local implementation evidence, not deployment,
provider acceptance, production-data acceptance, or human acceptance.

Production checkpoint: the annotated `v0.7.0` tag resolves to
`fb0aacc1c5c9f6c4ba8733f87c98c7b58e1611bd`; governed Firebase and Vercel
deployment receipts are recorded in
[`PROJECT_STATUS.md`](../PROJECT_STATUS.md). Those receipts do not establish
authenticated hosted behavior, production-data correctness, provider outcomes,
or human acceptance. The current Ambient completion candidate starts from
`origin/main` at `2908fc281215ff9297645f7e05db91b65de04fdf`, nine commits after
tagged `v0.8.1`; neither branch position nor a tag proves deployment. Priority
and sequencing are owned by
[`DEV_TASKS.md`](../DEV_TASKS.md).

## AIUI-00 — Experience Constitution

The product promise is that, within the first 60 seconds, a user should feel:

> This app is paying attention.

The interface is the intelligence layer. Intelligence must not be confined to
a chatbot, assistant page, AI panel, or optional novelty. Every visible surface
must earn its existence by clarifying, advancing, resolving, simulating, or
revealing context.

### Non-negotiable interaction laws

- Prefer evidence-backed inference over input, recommendations over
  configuration, outcomes over navigation, and direct manipulation over forms.
- Inference and recommendations remain advisory until the applicable authority
  contract permits action.
- Every enabled interaction must produce visible acknowledgement: context,
  preview, progress, receipt, resolution, or truthful recovery.
- No primary interaction may terminate in a generic page, empty modal, unscoped
  settings screen, or contextless route.
- A primary-action destination must arrive with the relevant object, reason for
  arrival, consequence, and next available resolution.
- Navigation counts as an outcome only when it opens the exact relevant object
  and focused resolution state.
- Persistent navigation exists for orientation, not as the primary way work is
  advanced. Keep **Now, Opportunities, Clients, Library** visible and light;
  move deeper work through context.
- Empty states must offer the meaningful starting action or clearly communicate
  that the user is caught up.
- Slow operations must expose a contextual pending state within 250ms; latency
  cannot make a valid interaction appear dead.
- Content, controls, focus paint, and system feedback may not unintentionally
  overlap at supported viewport widths. Intentional overlays such as menus,
  inspectors, drawers, and sheets must declare that behavior, remain within
  their containment boundary, preserve the obscured object's context, and
  provide an accessible dismissal or resolution path.
- Recommendations must disclose a compact reason, consequence, do-nothing
  counterfactual, confidence, and provenance. Missing or weak evidence must be
  visible rather than disguised as certainty.
- Reversible actions must produce a receipt in a recoverable history/undo rail.
  Irreversible or authority-sensitive actions must say why undo is unavailable
  before execution.
- Color, motion, sound, and haptics are representations of one semantic event,
  never independent decoration. No meaning may depend on color, motion, sound,
  or haptics alone.
- Truthful authority and evidence boundaries outrank delight: sensory feedback
  may acknowledge only the state actually established by the underlying
  receipt.
- Treat every trustworthy detail as a potential interaction primitive. Before
  requesting more input or adding another surface, ask whether an existing detail
  can clarify a decision, remove a step, anticipate intent, or reveal a useful
  counterfactual. Every new use must retain its provenance, freshness, object
  scope, and authority boundary; re-expression must never become double
  counting, fabricated certainty, or distraction from quote-to-booking.
- Make the product feel alive through causal responsiveness: the interface may
  anticipate, reorganize, animate, or sonify only when that behavior helps the
  user perceive what changed, why it matters, and what can happen next. Novelty
  earns its place by making the core outcome smarter, faster, clearer, safer,
  or more emotionally legible.
- Keep visible language human, calm, observational, and close to the task at
  hand. Avoid sales-heavy metaphors, product anthropomorphism, and internal
  architecture language in the interface. Retain exact authority, evidence,
  payment, delivery, and recovery terms wherever softer wording could weaken a
  necessary boundary.
- Use a high-impact autonomy filter for opportunistic design decisions. Pursue
  an unplanned enhancement without another approval round only when the builder
  judges both its likely user impact and proposed execution quality at 9–10/10,
  can state how it strengthens the core deliverable, and can preserve testable
  truth, accessibility, authority, maintainability, and rollback boundaries.
  Pass over or backlog anything merely clever, decorative, marginal, or
  disproportionately complex. This product-decision autonomy never authorizes
  deployment, provider activation, tenant-gate promotion, production-data
  mutation, or a human-acceptance claim.

### Measurable experience contracts

Release targets for each promoted ambient slice:

- Surface-purpose contract coverage: **100%**.
- Primary-action arrival-contract coverage: **100%**.
- Generic primary destinations: **0**.
- Empty primary modals or drawers: **0**.
- Enabled actions without acknowledgement: **0**.
- Primary actions lacking object, reason, consequence, or next resolution:
  **0**.
- Automated dead-click rate: **0%**.
- Unintended layout or focus-paint collisions: **0** at 390, 768, and 1440px.

Top-level product metrics:

- `dead_click_rate`: primary-action activations that either produce no
  contextual result or pending acknowledgement within 250ms, or complete at a
  destination missing its arrival contract, divided by all enabled
  primary-action activations. Security denials, unavailable evidence, and
  failures are not dead clicks when they immediately explain the boundary and
  offer the next safe resolution.
- `time_to_priced_draft_ms`: elapsed time from the user's first recorded quote
  intent to the first exact server-authoritative Firebase saved priced-draft
  receipt observed by the client. Local previews, local saves, incomplete save
  outcomes, and pricing without the trusted storage receipt do not qualify.
- `time_to_issue_resolution_ms`: elapsed time from an issue's first visible
  ambient signal to a resolution receipt for the same issue instance. Dismissed,
  deferred, superseded, and unavailable outcomes remain separately classified.

Analytics must remain tenant-safe and privacy-safe. They may record bounded
action, surface, timing, and outcome identifiers, but not message bodies,
proposal content, or unsupported customer-engagement inference.

## Delivery Strategy

Use a strangler replacement: preserve tenant isolation, authoritative pricing,
immutable versions, role gates, payment and delivery evidence, portal
compatibility, and local fallback while progressively replacing the interaction
layer.

Disposition labels:

- **REPURPOSE:** expose an existing capability through a better interaction.
- **EVOLVE:** extend an existing seam or contract.
- **REPLACE:** supersede a named implementation while preserving compatibility.
- **RETIRE:** remove the old implementation only after parity and rollback
  evidence.

No new public data authority is implied. Any slice that adds user-relevant
backend or data authority must update the capability manifest, Feature Matrix,
User Manual, and executable state evidence under the repository's no-orphan-
capability contract.

## Core Interfaces

- `SurfacePurposeContract`: surface ID, object scopes, supported interaction
  purposes, entry reason, allowed empty state, and recovery behavior.
- `AmbientContextSnapshot`: organization, role, route, active opportunity,
  selected object, revision, source freshness, and pending preview.
- `AmbientSignal`: claim, evidence, availability, severity, consequence,
  freshness, and resolution actions.
- `AmbientAction`: outcome label, role, authority level, preview policy,
  execution target, receipt type, reversibility, and required arrival contract.
- `AmbientActionResult`: one of `context`, `preview`, `pending`, `receipt`,
  `resolved`, or `recovery`, carrying object, reason, consequence, and next
  resolutions.
- `AmbientHistoryEntry`: action and object identifiers, bounded before/after
  description, receipt, actor, timestamp, reversibility, undo deadline when
  applicable, and the truthful result of an undo attempt.
- `IntelligentObjectDescriptor`: summary, inspector, dependencies,
  recommendations, permissions, actions, and the required **why**,
  **consequence**, **do nothing**, **confidence**, and **provenance** fields for
  every recommendation or counterfactual.
- `RecommendationEvidence`: bounded confidence class and human-readable source
  provenance; confidence cannot be expressed as unjustified precision.
- `ImpactPreview`: base revision, preview source, before/after values,
  commercial deltas, affected dependencies, warnings, do-nothing consequence,
  and unavailable reasons.
- `OpportunityMomentum`: separate proposal, pricing/margin, customer, and
  operational dimensions plus one ranked next action—never a fabricated
  blended readiness score.
- `AmbientFeedbackEvent`: semantic kind (`add`, `resolve`, `ready`, `sent`,
  `accepted`, `warning`, `recalculated`, or `customer_activity`), originating
  object, evidence/receipt, intensity, and allowed visual, motion, sonic, and
  haptic representations. Representation policy must respect reduced-motion,
  sound, haptic, contrast, and sensory preferences and must never upgrade the
  event's evidence meaning.
- `AmbientCapabilityManifest`: ambient-shell gate plus compatibility mapping to
  existing presentation and server-authority gates.

## Pilot Slice Alpha — Prove the Vertical Experience First

Build the first proof slice before broad horizontal replacement. Its fixed
scope is **AIUI-06 + AIUI-08 + AIUI-09 + AIUI-13 + AIUI-14 + AIUI-21 +
AIUI-24 + AIUI-26 + AIUI-36 + AIUI-45**, governed by AIUI-00.

Source-progress checkpoint: **0 of the 50 items are formally closed** and
**50 of 50 are materially implemented in current source: AIUI-01 through
AIUI-50**.

This is a material-source count, not a claim that each full acceptance contract
is complete. AIUI-50 now binds the exact zero-dead-click Alpha proof into the
protected Playwright lane under production-equivalent Ambient presentation
flags, while a fast `lane:quick` policy check prevents the browser command,
zero-rate assertion, required presentation flags, production workflow binding,
or independent staffing-authority boundary from silently disappearing. The
same policy now also requires exactly one canonical definition for AIUI-01
through AIUI-50, the browser-target authenticated operator UAT item and its
safe-off applicability, and AIUI-48's fail-closed parity, rollback, accepted-
release, and promotion gates. This is repository contract coverage, not
evidence that any of those external gates passed. Preview
deployment, authenticated staff and portal acceptance, first-minute/timing
review, explicit promotion approval, and an exact rollback artifact remain
open, so the item is material rather than closed. AIUI-01 now has a
machine-readable route, role, flag, local-
fallback, portal-precedence, and 390/768/1440 browser baseline while its own
parity ledger still names the legacy opportunity controls not yet hosted by the
Ambient route. AIUI-02 extracts routing, navigation, lazy mounting, shell
orientation, and surface boundaries, but authentication and organization state
have not fully left `App.jsx`. AIUI-03 centralizes immutable saved-quote
hydration and exact-revision, bounded Ambient draft patches, but the complete
reducer-driven dirty/template/reconciliation/trusted-command runtime remains
open. AIUI-07 provides a pure fail-closed normalization kernel for the eight
existing evidence families and the Ambient NOW briefing now consumes its
bounded conclusions; integrating those canonical signals through every
intelligent object remains open. AIUI-10 and AIUI-31 bind local calculation
and connected Commercial Change simulation to the Pricing object through one
`ImpactPreview` shape, preserve saved-version versus current-catalog labels,
and fail margin closed when cost evidence is missing; discount adjustment and
broader commercial parity remain open. AIUI-27 adds saved date, time, duration,
and venue objects with evidence slots and draft-intent handoffs, but the quote
editor does not yet focus and consume those intents.

AIUI-04 now separates the caller-owned opportunity collection, exact Event
Room selection, and the complete current role/source-gated quote-action matrix
through a dedicated read/controller seam. Opportunities and Living Opportunity
receive that controller identity while provider, payment, portal, booking, BEO,
and lifecycle execution continues through the existing trusted handlers.
AIUI-12 now registers a shared purpose-bearing editorial grammar across Now,
Opportunities, Clients, Library, and Living Opportunity, with open grouping,
hairlines, restrained nesting, and consistent focus treatment. AIUI-35 now
shows accepted/booked work as six deliberately separate receipt domains:
customer acceptance, contract/booking, provider-confirmed payment, Kitchen BEO,
authoritative staffing, and post-event closeout. Missing evidence remains
unavailable, lifecycle labels do not fabricate receipts, and one next unresolved
operational domain is ranked without adding authority. AIUI-42 now routes
selection swipes and Menu reordering through one axis/dominance/cancellation
contract; every gesture retains a visible native button and keyboard
equivalent and produces the same staged, unsaved review. AIUI-48 now removes
duplicated route implementations from the Ambient build graph while the
separate compatibility build remains the rollback boundary. An executable
retirement manifest keeps the stepper, Command Center, table fallback, older
search, and presentation flags in place until parity, exact rollback, accepted
release, and promotion evidence all exist. This is material strangler progress,
not authorization to delete the rollback implementations.

AIUI-16 now reduces the default-off shell to lightweight **Now**,
**Opportunities**, **Clients**, and role-safe **Library** orientation while
preserving canonical routes, portal precedence, role gates, Search, New quote,
and rollback behavior. One global **Pilot** trigger now resolves to the active
Living Opportunity explanation, the existing draft command field without
running it, or one populated opportunity-choice recovery. Complete interpreted-
destination parity remains open, so the item is material rather than complete.
AIUI-17 now replaces the flag-on NOW dashboard with an open briefing that
shows at most three priorities from the existing deterministic Workflow order,
one exact outcome for each, bounded quiet progress, a compact evidence
disclosure, and an honest caught-up state that is withheld for incomplete
evidence or recorded payment work. This is the top of the current bounded
snapshot rather than a claim of globally optimized commercial value. Broader
cross-domain ranking, rollout evidence, and hosted or human acceptance remain
open, so the item is material rather than formally complete.
AIUI-18 now projects the existing tenant-scoped bounded quote read into an
editorial **Opportunities** stream. Each row keeps identity plus proposal,
commercial, customer, and operational momentum separate; only proposal
completeness may use a percentage. Quote lifecycle, booking confirmation,
deposit, and final-balance evidence remain exact independent facts, and one
deterministically ranked next action carries the exact opportunity, reason,
consequence, and next resolution into its canonical Living Opportunity or
existing role-safe Workflow destination. The complete legacy control set
remains available under **Quote administration**, and browser-local fallback
is labeled as local rather than server or provider confirmation. Full legacy
parity and retirement, universal cross-domain ranking/freshness, hosted
behavior, and human acceptance remain open, so AIUI-18 is material rather than
formally complete.
AIUI-19 now gives the default-off **Clients** routes a lighter directory and
relationship-first top layer over the existing bounded, tenant-scoped reads.
The directory helps staff find and open an exact client without inventing
relationship ranking from list data. The selected client opens with identity,
active opportunities in the completed read, recorded conversation context, and
one supported next step. Its arrival contract carries the exact opaque client
identity, reason, consequence, and next resolution, then resolves only after
the matching client heading is focused. Missing or mismatched context recovers
without substituting another client. Existing history, rebook, communication,
commercial, and role-gated controls remain available under **More client
history and controls**. The projection adds no read, write, role, pricing,
message, payment, booking, or provider authority. A dedicated local browser
lane now proves the directory and exact relationship handoff at 390, 768, and
1440px with 44px controls, axe, overflow, and overlap checks. Hosted behavior,
rollback-release evidence, and human acceptance remain open, so AIUI-19 is
material rather than formally complete.
AIUI-20 now replaces the default-off administrator `/app/catalog` landing with
a role-safe **Library** over the existing organization-scoped catalog snapshot.
Its open editorial view separates Catalog choices from first-class Event
Templates, exposes source, observation time, **Catalog version**, and pricing-
review context, and ranks one evidence-backed next step without treating an
unloaded event-specific menu inventory as empty. Every section and exact
template opens in the existing guarded editor with object, reason,
consequence, immediate pending acknowledgement, and a next resolution. The
structured template editor preserves stable IDs and saved linked-item
references, keeps incomplete menu evidence explicit, and saves only through
the existing catalog revision/reconciliation path. The seven managed-menu
mutations require the loaded `expectedCatalogRevision`; both Firebase and local
commit paths compare it before any record write, and local fallback uses the
active organization's catalog revision. Catalog-setting and managed-menu dirty
domains cannot advance together. Unsaved work remains mounted across ordinary
workspace navigation; unload and workspace-exit transitions are guarded; newer
catalog evidence cannot overwrite a dirty draft; and failed
exact arrivals show reason, consequence, and a safe next step. Browser-local
data is keyed to the active organization and remains labeled as local, sales-
role access resolves to a contextual boundary, and the flag-off Catalog Admin
remains the rollback path. Portal-token provider remounts occur only after the
App-level draft guard accepts the transition; a direct initial token keeps
portal precedence, and token A-to-B navigation receives a distinct public
scope. Dedicated local browser proof passes at 390, 768,
and 1440px with axe, 44px pointer targets, overflow, collision, draft-
preservation, focus-restoration, exact-arrival, and 250ms acknowledgement checks.
Hosted role behavior, production-data review, rollback-release evidence, and
human acceptance remain open, so AIUI-20 is material rather than formally
complete.
AIUI-41 adds an in-flow, non-overlay mobile Living Opportunity remote whose
first viewport answers identity, state, what matters, and next action, then
offers exact Event, Menu, Pricing, and Proposal controls. The desktop hero and
glance are not duplicated at 390px. Sticky-next-action behavior and complete
mobile parity remain open, so the item is not formally closed.

AIUI-43 now replaces Ambient Pilot's click-to-toggle dictation with accessible
hold-to-capture behavior while retaining the existing flag-off control. Pointer
or Space/Enter press receives an immediate contextual acknowledgement; release
stops capture, then the bounded transcript opens the same deterministic local
preview. Permission, device, service, network, no-speech, cancellation,
duplicate-event, lost-focus, hidden-document, timeout, and unmount paths retain
the previous command, preview, and draft with a specific recovery. **Apply to
draft** remains the only staging action and normal trusted save remains the
only pricing/version authority. Browser-support and injected runtime proof are
local only; real microphone permission, speech-service behavior, hosted use,
and human acceptance remain open, so AIUI-43 is material rather than formally
complete.

AIUI-46 now composes the existing exact-token customer projection, only when
both Decision Room and the default-off Ambient gate are enabled, into a calm,
content-first decision room: Event, Menu and service, Pricing, recorded
assumptions, tenant terms, optional additions, response, and questions. Each
contextual question reuses the one existing conversation composer and reports
whether its starter text was staged, a customer draft was preserved, an
earlier send still needs reconciliation, or the conversation is read-only or
unavailable. Staff-marked additions prepare reversible ordinary change-request
lines; the same control may remove only an exact line generated during that
browser session, never identical customer-authored words. Browser-local exact-
token fallback mirrors the canonical bounded terms and option shape. Dedicated
local proof covers 390, 768, and 1440px with axe, 44px targets, overflow,
clipping, collisions, and proposal-nonmutation checks. The slice introduces no
new customer read, callable, catalog exposure, direct quote mutation, pricing,
acceptance, payment, booking, or provider authority. Connected exact-token
behavior, deployment, production-data review, provider outcomes, rollback-
release evidence, and human acceptance remain open, so AIUI-46 is material
rather than formally complete.

AIUI-28 now exposes Package and Menu as populated intelligent objects with
exact saved identity, inclusion links, quantities, order, current catalog
candidates, dependencies, why, consequence, do-nothing outcome, confidence,
and provenance. Human-readable package and menu names remain paired with their
stable IDs, so the interface can explain an order without weakening identity
checks. Pointer drag and equally visible keyboard controls create the same
bounded reorder intent. A replacement or reorder may continue only from fresh
same-tenant catalog evidence and the exact saved opportunity revision; its
arrival contract keeps the parent opportunity in scope and opens a populated
editor review with saved and proposed values plus explicit **Apply** and
**Keep** outcomes. Apply changes only the isolated in-memory draft, preserves
the applicable menu quantity/order facts, marks the exact fields dirty, and
still requires an outcome-named trusted save; Keep leaves the editor draft and
saved quote unchanged. Neither outcome in this review surface reprices, saves,
proves availability, or reconciles package inclusions. Full price/margin effect
coverage, inline replacement parity, and authoritative reconciliation proof
remain open, so AIUI-28 is material rather than formally complete.

AIUI-30 now converts the saved add-on, rental, bar, and service rails into four
dependency-aware intelligent-object groups. Visible controls and equivalent
horizontal swipe gestures adjust only a bounded, reversible browser-memory
scenario; no change is priced, saved, reserved, communicated, or treated as
availability evidence. AIUI-32 has a tested five-domain Money descriptor and
context that keep deposit policy, deposit request, provider-confirmed deposit,
balance request, and final settlement separate and fail browser-return or
contradictory evidence closed. The populated Money inspector is mounted in the
Living Opportunity through registered inspect/dismiss actions, restores its
exact trigger, preserves the saved quote, and passes focused 390/768/1440
overflow proof. Governed request, reconciliation, and settlement actions remain
on their existing authority surfaces, so the item is material rather than full
interaction and lifecycle parity.

AIUI-33 mounts Proposal as a read-only intelligent object whose populated
context keeps the saved immutable revision, authoritative-pricing evidence,
customer projection, portal issuance, and provider evidence separate. It names
exact completeness gaps and descriptive prepare, send, rotate, and recovery
resolutions, then hands only to the existing editor or governed proposal
controls. It never infers delivered, viewed, accepted, booked, or paid state and
performs no proposal mutation. AIUI-34 similarly mounts one event-scoped
Conversation object with five independent rails: sent, provider-reported
delivery, portal view, latest reply, and bounded inferred engagement. Change
request and follow-up evidence remain distinct, and exact Messaging or Workflow
handoffs retain authority; the inspector contains no send or mark-read action.
Both objects carry object, reason, consequence, next resolution, confidence,
provenance, dependencies, and do-nothing context, restore their exact trigger,
and fail local or incomplete evidence closed.

AIUI-40 now has one bounded semantic exact-arrival contract plus consuming
destinations for Workflow, Approval, Messages, supported Schedule event and
conflict views, and three strict Reporting targets. The handoff carries an
allowlisted object, reason, consequence, and next resolution; exact customer-
reply identity stays in bounded same-app history state while the URL carries
only quote-scoped thread focus. A valid transport may say **Finding**, but only
the destination that loads and focuses the exact requested item may mark it
**ready**. Reporting keeps a targeted opportunity read outside its aggregate
denominators. Schedule may focus an exact accepted/booked event already present
in a bounded read, but it cannot infer absence from truncation or validate a
conflict from incomplete evidence. Missing, stale, truncated, mismatched, or
unavailable evidence recovers without selecting another item or mutating
read/send/workflow state. Authoritative operational staffing remains explicitly
non-primary-ready in Schedule rather than falling back to its legacy staff-lead
field, so the full item is not closed. The source-only decision and kill criteria are recorded in
[`AMBIENT_WORKSPACE_ARRIVAL_ADR.md`](AMBIENT_WORKSPACE_ARRIVAL_ADR.md).

AIUI-37 defines all eight Pilot command classes and applies the v1 policy to
the existing deterministic draft proposals: only navigation, query, draft
mutation, and simulation are executable classes; trusted mutation,
communication, bulk, destructive, malformed, and authority-mismatched commands
fail closed.

AIUI-38 adds deterministic read-only answers for proposal blockers, price
composition, authorized recorded-cost margin, and client-safe summaries, plus
an exact active-catalog Package draft command. Every answer exposes the known
details, consequence, do-nothing state, confidence, provenance, and the applicable
authority boundary; margin fails closed without both staff authorization and
complete cost evidence. AIUI-39 recognizes explicit under-budget and improve-
margin intents and produces bounded, deterministic current-catalog scenarios
only from fresh same-tenant evidence while preserving declared locked scope.
The surface distinguishes available, already satisfied, no-match, and
unavailable results. Adoption opens an immutable, populated draft review that
binds the organization, catalog observation and revision, proposal fingerprint,
and exact changed-field snapshot; **Apply scenario to draft** or **Keep current
draft** is required. Apply changes only the isolated editor draft, and any
organization, catalog, proposal, or draft drift fails closed. A later trusted
save still owns authoritative repricing, persistence, and versioning.

AIUI-25 remains material only for the default-off Living Opportunity boundary:
every enabled Alpha button has a registered action, starts a monotonic
observation, produces a visible result, and validates its exact contextual or
route destination or resolves through recovery. Silence after the inclusive
250ms deadline produces visible recovery at 251ms, and the surface exposes a
privacy-safe local primary-action dead-click rate. AIUI-29 binds the Staffing
object to an independently gated tenant-isolated roster, operator-recorded
availability, conflict-safe assignments, explicit coverage gaps, and immutable
receipts. That authority is source-only and default-off; tenant-history and
exact commercial impact stay explicitly unavailable. AIUI-47 now has material
source integration with the existing product-event rail and Reporting:
privacy-bounded 250ms primary-action assessments, first intent paired only with
an exact server-authoritative Firebase saved-draft receipt, and issue timing
paired only by the same bounded category in the same staff session. The UI
labels those values as client observations, not server timing or comprehension
proof, and local/zero-sample states infer no rate or duration. Deployment, full
legacy-capability parity, hosted role and accessibility acceptance, timed
comprehension, rollback-release evidence, production-data acceptance, and human
acceptance all remain open.

Local proof for this checkpoint includes focused contract/component tests and a
passing targeted 390px comprehension/axe case after the mobile top-layer and
contrast hardening. The flag-enabled
`e2e/ambient-intelligence-accessibility.spec.js` contract covers 390, 768, and
1440px first-viewport content, 44px targets, axe results, keyboard focus and
restoration, populated context, reduced motion, persisted mute preference,
forced colors, no horizontal overflow, causal motion hooks, enabled-button
action mapping, and an exact editor handoff. The full post-hardening lane passes
11 of 11 local cases. Focused unit proof also covers the inclusive deadline, timeout
recovery, route-destination validation, privacy filtering, React development
effect replay, inline validation, dismissal, undo, and history clearing. This
is not hosted, provider, production-data, or human-acceptance evidence.

Focused local proof for AIUI-19 includes 15 of 15 client-model tests and 8 of 8
Clients component tests (23 of 23 combined), 18 of 18 legacy Customer
Directory/Customer 360 tests, 19 of 19 exact-arrival contract tests, and a
passing production build. A dedicated Chromium-admin lane passes 3 of 3 local
cases at 390, 768, and 1440px with exact arrival, 44px controls, zero axe
violations, and no audited overflow or overlap, and captures six local proof
images. The ordinary flag-off production build excludes the Ambient Clients
chunk and passes the existing bundle ceiling without a new exception. These
results establish local source and browser behavior only;
hosted-role, production-data, provider, and human acceptance remain separate.

Focused local proof for AIUI-20 passes 122 of 122 tests covering the pure
Library model, structured Event Templates editor, exact-arrival contract,
Library route, role boundary,
organization-scoped local fallback, and legacy Catalog
Admin coverage, including stale-revision rejection and guarded portal-scope
transitions. Its dedicated Chromium-admin lane passes 7 of 7 cases: contextual
Library rendering at 390, 768, and 1440px, exact menu and template focus,
sub-250ms visible acknowledgement before the heavy editor mounts, guarded focus
restoration, preserved unsaved work across workspace history, and contextual
sales-role denial. The three overview captures and one focused mobile template
capture show no audited collision or horizontal overflow; axe reports no
violations on each overview. These results establish
local source and browser behavior only, not deployment, hosted-role behavior,
production-data correctness, provider outcomes, or human acceptance.

The last completed full flag-enabled local
`e2e/ambient-intelligence-object-verification.spec.js` lane passes 40 of 40
cases. It covers responsive Event Logistics, Package/Menu, Selection, Money,
Proposal, Conversation, and global Pilot contexts at 390, 768, and 1440px; exact Package
and keyboard-equivalent Menu handoffs; Package adoption into the editor draft
with an outcome-named save; pending-review save recovery; in-flow editor
feedback that does not cover the draft review or Live Breakdown; date and
pricing handoffs; the mobile Staffing sheet; and the focused Messages heading
at all three widths. Proposal and Conversation proof preserves their separate
evidence rails, populated arrival context, absence of inline authority controls,
focus restoration, and saved-quote non-mutation. The persisted quote remains
unchanged through every asserted draft-only handoff and adoption boundary. The
fresh lane also covers strict invalid-arrival recovery and the single-layer
mobile Event disclosure. This is local browser evidence, not hosted,
production-data, or human
acceptance.

The separate local `e2e/workspace-no-unintended-overlap.spec.js` foundation
passes 80 of 80 Chromium-admin cases with 0 failed or skipped in 6.3 minutes
across 390×844, 768×900, and 1440×1000. Its matrix contains 45 route cases;
three Library template-editor cases; 27 header, search, context, and Pilot
cases; two mobile Live Breakdown cases; and three editor review/feedback cases.
The 15 exact routes include Now, Quotes (the
current Opportunities proxy), Customer Directory and Customer 360, Catalog
Admin (the current Library proxy), Messages, Living Opportunity, Workflow,
Schedule, Reporting, Imports, Integrations, Diagnostics, not-found, and the
exact-token customer portal. It also opens header More/Operations/Account
popovers, Workspace search, Package, Money, Proposal, and Conversation
contexts, deterministic Pilot answers, the explicit Pilot scenario review, and
the draft-review/feedback flow. The systemic audit reserves focus paint, rejects
peer collisions and undeclared overlays, keeps ordinary feedback and review
surfaces in normal flow, and audits every visible control in deliberate
transient surfaces for viewport, clipping, scroll, and focus containment.
Collisions, overflow, escaped controls, escaped focus paint, and undeclared
overlays remain empty; document overflow is at most 1px, and the explicit
Messages title-to-subtitle clearance is at least 8px. Its source inventory
covers `App.jsx` plus
the registered staff components. This is material AIUI-49 progress, not
completion: sales-role geometry, Firefox/WebKit, zoom and safe-area states,
connected portal-conversation/Ask states, maximum-result search states, hosted
provider behavior, and human acceptance remain open.

Implementation order:

1. Establish shared context and action/object contracts (AIUI-06, AIUI-08,
   AIUI-09).
2. Build direct manipulation and the responsive context surface (AIUI-13,
   AIUI-14).
3. Compose one Living Opportunity with one ranked next action (AIUI-21,
   AIUI-24).
4. Make guest count the first dependency-aware intelligent object (AIUI-26).
5. Bind Pilot to the active object and embed one proactive Pilot sentence
   without requiring invocation (AIUI-36).
6. Prove the unified semantic feedback path on add, recalculated, warning, and
   resolve events (AIUI-45).

AIUI-01's compatibility baseline and AIUI-05's default-off ambient gate are
required before a hosted preview, even though they are not part of the
experience proof itself.

Alpha succeeds only when:

- The first viewport answers **what is this, where does it stand, what matters,
  and what should I do next** at 390px, 768px, and 1440px.
- In a timed comprehension review, a representative operator can answer those
  four questions after three seconds without opening another surface.
- Changing guest count reveals dependencies, recommendation basis, consequence,
  do-nothing outcome, confidence/provenance, and a reversible staged result
  without route navigation.
- Every enabled Alpha interaction satisfies its arrival contract, produces
  acknowledgement within 250ms, and leaves contextual recovery or undo.
- Teal calculation/recalculation, mint resolution, coral warning, and the other
  feedback representations remain accessible, preference-aware, and secondary
  to explicit text and receipts.
- The first-minute acceptance prompt elicits the intended response—"This app is
  paying attention"—without treating that human reaction as deployment proof.

## 50 Stable Action Items

All items below are open until implementation and the stated evidence gates
close. The IDs remain stable even if delivery is split into smaller slices.

### Wave 1 — Create a Replaceable Architecture

- **AIUI-01 [EVOLVE]** Establish a compatibility and dead-click baseline for
  every current surface, enabled action, route, role, pilot configuration,
  local fallback, and portal-token path at 390, 768, and 1440px.
- **AIUI-02 [REPLACE]** Extract authentication, organization context, portal
  precedence, routing, navigation, and lazy-surface mounting from the historical
  4,351-line `App.jsx` baseline into a dedicated workspace shell; acceptance is
  no observable route or authority change.
- **AIUI-03 [REPLACE]** Extract quote form state into a draft runtime with
  reducer-driven dirty state, previews, template ownership, reconciliation, and
  trusted save commands; preserve `quoteCalculator`, authoritative repricing,
  and versioned writes.
- **AIUI-04 [REPLACE]** Split the quote-history monolith into Opportunities,
  Event Room, and role-safe quote-action controllers; preserve every provider,
  payment, portal, booking, BEO, and lifecycle action through parity tests.
- **AIUI-05 [EVOLVE]** Introduce `VITE_AMBIENT_UI_ENABLED`, default off, and an
  ambient capability manifest; keep existing presentation flags as
  compatibility inputs and retain all independent server/provider gates.

### Wave 2 — Build the Ambient Intelligence Kernel

- **AIUI-06 [EVOLVE]** Add the `AmbientContextSnapshot` provider so every
  surface receives the current route, opportunity, selected object, role,
  revision, freshness, and pending change without duplicating state.
- **AIUI-07 [REPURPOSE]** Normalize NOW attention, proposal completeness,
  guided selling, margin, Decision Debt, change requests, and cascade evidence
  into `AmbientSignal`; unavailable, partial, stale, and truncated states remain
  explicit.
- **AIUI-08 [EVOLVE]** Create the `AmbientAction` registry with outcome-specific
  labels, authority levels, role checks, previews, exact targets, receipts, a
  mandatory arrival contract containing object/reason/consequence/next
  resolution, and an `AmbientHistoryEntry` for every reversible action.
- **AIUI-09 [EVOLVE]** Create the intelligent-object registry for guest count,
  date, venue, package, menu, staffing, extras, pricing, deposit, proposal, and
  client activity. Every object exposes dependencies and the counterfactuals
  **why**, **consequence**, and **do nothing**, with compact confidence and
  provenance for recommendations.
- **AIUI-10 [REPURPOSE]** Unify client calculation and Commercial Change
  simulation behind `ImpactPreview`; previews may stage changes but never bypass
  server repricing, authorization, or revision-conflict handling.

### Wave 3 — Replace the Heavy Visual Grammar

- **AIUI-11 [EVOLVE]** Version the staff design system as a behavioral chromatic
  system: gold marks ready/recommended attention, teal appears during supported
  calculation or reasoning and resolves after recalculation, coral marks
  recoverable warning/risk, mint settles into a surface when it becomes healthy
  or accepted, lavender identifies customer-originated activity, and blue marks
  contextual addition or outbound movement. Each behavior is driven by an
  `AmbientFeedbackEvent`, has a non-color equivalent, passes WCAG contrast, and
  remains separate from tenant portal themes.
- **AIUI-12 [REPLACE]** Replace nested panels, permanent borders, and oversized
  cards with registered purpose-bearing surfaces, open editorial layouts,
  hairlines, compact grouping, and temporary controls.
- **AIUI-13 [REPLACE]** Build an accessible `InlineValue` primitive that reads
  as content and becomes editable on pointer, keyboard, or assistive-technology
  activation; commercial edits remain staged until an outcome-named save.
- **AIUI-14 [REPLACE]** Build one `ContextSurface` primitive: anchored inspector
  on desktop, drawer on tablet, and bottom sheet on mobile. It may never open
  empty and must restore focus after resolution or dismissal.
- **AIUI-15 [EVOLVE]** Make motion the temporal representation of
  `AmbientFeedbackEvent`: origin-aware inspectors, synchronized dependent-value
  transitions, and next-action replacement at 120–200ms or 200–280ms. Reduced
  motion removes movement while preserving causal explanation, state change,
  and focus continuity.

### Wave 4 — Reduce Navigation to Orientation

- **AIUI-16 [REPLACE]** Reduce persistent navigation to lightweight orientation
  through **Now, Opportunities, Clients, Library**, plus one global **Pilot**
  trigger; preserve spatial confidence and all current deep links while every
  entry opens an interpreted or object-focused state rather than a generic
  landing page.
- **AIUI-17 [REPLACE]** Rebuild NOW as an open briefing of the three
  highest-value conclusions, one primary resolution per conclusion, quiet wins,
  and an intelligent caught-up state; move freshness methodology into compact
  disclosure.
- **AIUI-18 [REPLACE]** Replace the quote administration table with an
  Opportunities stream showing identity, momentum, truthful lifecycle state,
  and the exact next action.
- **AIUI-19 [EVOLVE]** Recompose Customer Directory and Customer 360 into a
  lighter Clients surface with relationship context, active opportunities,
  rebook entry, conversation access, and one ranked next action.
- **AIUI-20 [EVOLVE]** Create Library as the role-safe home for Catalog and
  first-class Templates; contextual administration links must open the relevant
  setting or record rather than an unscoped settings screen.

### Wave 5 — Create the Living Opportunity

- **AIUI-21 [REPLACE]** Replace the separate Event Workspace and five-step edit
  experience with one Living Opportunity canvas; existing view and edit URLs
  resolve to the same object with authority-appropriate interaction. Its top
  layer must fit within one viewport and communicate identity, state, risk, and
  next action in a three-second comprehension test.
- **AIUI-22 [REPLACE]** Implement three-layer disclosure: identity/total/momentum
  first, event/menu/staffing/pricing second, and margin/history/activity/
  automation third.
- **AIUI-23 [EVOLVE]** Implement `OpportunityMomentum` with separate proposal
  completeness, pricing and margin, customer state, and operational evidence;
  only proposal completeness retains the existing percentage.
- **AIUI-24 [EVOLVE]** Add deterministic next-action ranking: authority or
  safety blockers, customer replies and approvals, deadlines, proposal gaps,
  then recommendations; ties expose one primary action and a “more” disclosure.
- **AIUI-25 [REPLACE]** Establish the dead-click elimination gate: replace
  generic actions and empty states with outcome verbs, immediate
  `AmbientActionResult` acknowledgement, exact destination context, recovery
  paths, and a visible history/undo rail for reversible ambient actions.

### Wave 6 — Make Operational Details Intelligent Objects

- **AIUI-26 [REPURPOSE]** Turn guest count into an inline object whose inspector
  previews supported food, staffing, rental, bar, total, deposit, and margin
  consequences before staging a change, and explains dependencies,
  recommendation basis, do-nothing outcome, confidence, and provenance.
- **AIUI-27 [REPURPOSE]** Turn date, time, duration, and venue into contextual
  objects that expose only evidence-backed availability, seasonal, travel,
  validity, and scheduling consequences, including what happens when the user
  makes no change.
- **AIUI-28 [REPURPOSE]** Turn package and menu selections into directly
  explorable objects with inclusion details, price and margin effects,
  dependency/counterfactual explanations, inline replacement, and
  pointer-plus-keyboard reordering.
- **AIUI-29 [REPURPOSE]** Turn staffing into an intelligent object using
  existing ratios, tenant history where enabled, cost impact, confidence,
  provenance, dependencies, and explicit “Use recommendation” or “Keep current”
  outcomes.
- **AIUI-30 [REPURPOSE]** Turn add-ons, rentals, bar, and service selections
  into quantity-aware objects with swipe actions, visible button alternatives,
  dependency previews, do-nothing consequences, and safe undo before save.

### Wave 7 — Make Commercial and Customer State Intelligent

- **AIUI-31 [REPURPOSE]** Turn pricing, discounts, and margin into an explorable
  commercial object with fail-closed cost coverage, role-safe controls,
  target-gap explanations, dependency/counterfactual views, and governed
  simulation for committed quotes.
- **AIUI-32 [REPURPOSE]** Separate deposit policy, deposit request,
  provider-confirmed deposit, balance request, and final settlement inside one
  money object without collapsing their evidence domains; show dependencies
  and the consequence of taking no action.
- **AIUI-33 [REPURPOSE]** Turn the proposal into an object that resolves
  completeness gaps inline, previews the exact customer projection, re-prices
  authoritatively, explains recommendation provenance, and offers truthful
  prepare, send, rotate, and recover actions.
- **AIUI-34 [EVOLVE]** Embed event-scoped conversation, change requests, and
  follow-up actions beside the opportunity while keeping sent, delivered,
  viewed, replied, and inferred engagement strictly distinct.
- **AIUI-35 [EVOLVE]** Recompose accepted and booked opportunities around
  immutable acceptance, payment, contract, BEO, staffing, and closeout receipts,
  with restrained completion feedback and the next unresolved operational
  action.

### Wave 8 — Make Pilot the Global Cognitive Center

- **AIUI-36 [EVOLVE]** Promote the existing Pilot command bar to a global,
  context-aware surface shared with ambient signals; it opens on the active
  opportunity rather than behaving like a generic chatbot, and may proactively
  surface a concise, provenance-bearing Pilot sentence inside the relevant
  object without waiting for invocation.
- **AIUI-37 [EVOLVE]** Define command classes for navigation, query, draft
  mutation, simulation, trusted mutation, communication, bulk action, and
  destructive action; v1 executes only navigation, query, draft mutation, and
  simulation.
- **AIUI-38 [REPURPOSE]** Add deterministic commands for blockers,
  guest/staffing/package/item changes, price explanations, margin explanations,
  and client-friendly summaries, with ambiguity and unread-clause handling.
- **AIUI-39 [EVOLVE]** Add bounded “under this budget” and “improve margin”
  scenario generation using existing pricing rules; preserve locked scope, show
  every proposed compromise, explain confidence/provenance, and require explicit
  adoption.
- **AIUI-40 [REPLACE]** Surface Workflow, approvals, Messages, Schedule, and
  Reporting through exact focused context. Navigation must carry the triggering
  object, reason, consequence, and intended resolution into the destination.

### Wave 9 — Build Mobile, Accessibility, and Joyful Utility

- **AIUI-41 [REPLACE]** Create a mobile remote-control shell with compact
  opportunity identity, momentum, sticky next action, and direct access to
  Event, Menu, Pricing, and Proposal objects.
- **AIUI-42 [REPLACE]** Use bottom sheets, pointer gestures, and drag reordering
  for mobile manipulation while providing equally visible tap and keyboard
  alternatives for every gesture.
- **AIUI-43 [EVOLVE]** Extend existing browser speech support into
  hold-to-capture voice input: releasing ends capture and opens a preview; an
  explicit confirmation remains required before staging anything.
- **AIUI-44 [EVOLVE]** Certify inline edit discoverability, focus order,
  screen-reader announcements, 44px targets, high contrast, reduced motion,
  muted sound, and non-color/non-gesture equivalents.
- **AIUI-45 [EVOLVE]** Replace one-off sensory effects with a single
  `AmbientFeedbackEvent` router shared by AIUI-11 and AIUI-15. `add`, `resolve`,
  `ready`, `sent`, `accepted`, `warning`, `recalculated`, and
  `customer_activity` receive coordinated visual, motion, sound, and optional
  haptic representations according to user preference; no state depends on
  feedback, and each event reflects only the underlying evidence receipt.

### Wave 10 — Finish the Replacement and Prove It

- **AIUI-46 [EVOLVE]** Finish the lighter customer decision room with
  content-first sections, proposal-total breakdown, assumptions, tenant terms,
  restrained cover/experience treatment, in-place questions, and staged
  decidable options.
- **AIUI-47 [EVOLVE]** Instrument the three top-level product metrics through
  the existing product-event rail: dead-click rate, time from first intent to a
  client-observed exact server-authoritative Firebase saved priced-draft
  receipt, and time from issue surfaced to same-issue resolution. A dead click
  is flagged when an enabled primary action emits
  no result or contextual pending state within 250ms, or when its completed
  destination lacks the required arrival context; never record message or
  proposal content.
- **AIUI-48 [RETIRE]** After parity and one accepted rollback-capable release,
  remove the legacy stepper, duplicated modal routes, Command Center, primary
  quote table, redundant search palette, and presentation-only pilot flags;
  preserve canonical URLs and previous-release rollback.
- **AIUI-49 [EVOLVE]** Establish a permanent automated interaction audit that
  inventories every visible surface and enabled action, validates purpose and
  arrival contracts, rejects empty overlays and generic destinations, detects
  unintended content/control/focus-paint collisions at 390, 768, and 1440px,
  verifies explicitly allowed overlays remain contained and dismissible, and
  runs alongside accessibility, visual, sensory-preference, bundle, and CWV
  checks. The current 80-case, 15-route, three-width browser foundation and
  shared source vocabulary do not close this item until the named browser/role/
  zoom/safe-area/connected-state exclusions are covered and the audit becomes a
  permanent release lane.
- **AIUI-50 [EVOLVE]** Make zero dead-click contract violations a release gate;
  roll out the ambient shell default-off in preview, complete authenticated
  staff and portal acceptance, validate the first-minute experience and timing
  metrics, promote only with explicit approval, and retain an exact rollback
  artifact. Current source binds the zero-rate Alpha browser proof to the
  protected Playwright lane and protects that binding with a fail-closed policy
  check; the named rollout and acceptance evidence remains open.

## Validation and Documentation Contract

Each implementation slice runs focused unit and browser tests,
`npm run check:env`, and `npm run build`. Authority-affecting slices also run
`npm run check:capability-surfaces` and the relevant Firebase, rules,
authoritative-pricing, and high-risk lanes.

The interaction audit must prove:

- Every visible surface has a `SurfacePurposeContract`.
- Every enabled control produces an `AmbientActionResult`.
- Every primary destination receives object, reason, consequence, and next
  resolution.
- Every slow operation acknowledges activation within 250ms.
- No enabled action opens an empty overlay or generic route.
- Every error leaves the user with contextual recovery.
- Every dismissal restores focus and preserves work.
- Every reversible ambient action produces an accurate history/undo entry.
- Every recommendation exposes why, consequence, do-nothing outcome,
  confidence, and provenance.
- Every feedback event preserves meaning with color, motion, sound, and haptics
  independently reduced or disabled.
- No audited content, control, or reserved focus-paint rectangle collides at
  390, 768, or 1440px; every intentional overlay is explicitly registered,
  contained, and dismissible without losing work or focus.

Code changes update `CHANGELOG.md`; current operational or rollout truth updates
`PROJECT_STATUS.md`; backlog state remains in `DEV_TASKS.md`. Hosted deployment,
provider evidence, production data acceptance, and human acceptance remain
separate gates.

## Assumptions and Boundaries

- Staff workspace and customer decision room are in scope; marketing pages are
  not.
- “Pilot” is the single intelligence-center name and command entry.
- Existing `v0.7.0` source capabilities are foundations, not work to recreate;
  their presence in source does not establish production deployment.
- Inline commercial edits are staged and intentionally saved; blanket autosave
  is excluded.
- Deterministic evidence is the default. Model assistance remains gated,
  low-confidence, provenance-labeled, and human-confirmed.
- Mobile means the responsive PWA, not a native application.
- Portal activity counsel and automatic bulk follow-up remain excluded pending
  separate privacy and provider-authority decisions.
- No blended event-readiness percentage will be introduced; `72%` is valid only
  when explicitly labeled proposal completeness.
- Security denials, unavailable evidence, and failed operations are not dead
  clicks when they immediately clarify the boundary and provide the next safe
  resolution.
