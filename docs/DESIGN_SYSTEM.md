# QuotePilot Staff Workspace Design System

Last updated: 2026-09-05 12:05:00 CDT

Status: shipped in v0.5.0 (PR #50). This records the visual system, its
contracts, and the intentional decisions so future work extends it instead of
rediscovering it.

## Agent UI Workflow

Before UI analysis or implementation, run the repository task planner and load
its required `design-language` skill. Treat this document and
`DESIGN_PRINCIPLES.md` as the product-specific authority: the skill may sharpen
composition and review, but it may not replace QuotePilot's established
typography, calm hierarchy, hospitality treatment, accessibility, responsive
behavior, or evidence language.

Start from the real route and current implementation. For material UI changes,
capture or inspect the existing surface first, preserve authorization and data
authority, and validate the affected interaction at the relevant 390, 768, and
1440 pixel widths. Overflow, clipped actions, covered focus targets, awkward
wrapping, broken reduced-motion behavior, and unreadable dense panels are
defects. Local rendering and screenshots remain local evidence, not hosted or
human visual acceptance.

## Principles

- Calm neutral workspace: hierarchy comes from typography and spacing, not
  color or decoration. One restrained brand accent.
- Progressive disclosure: governance and evidence detail stays available but
  collapsed; screens lead with state and next action.
- Library is the business-facing definition surface: group Offers with their
  components, then show Templates, Pricing, and Rules as distinct concepts.
  Keep catering-native nouns in ordinary UI and reserve kernel/version terms
  for evidence or administration detail.
- Re-express trustworthy data before collecting more: one recorded detail may
  orient, explain, rank, preview, or animate another decision only when its
  provenance, freshness, scope, and authority remain explicit. A novel use must
  make the quote-to-booking outcome smarter, faster, clearer, safer, or more
  emotionally legible; decoration and duplicated metrics do not qualify.
- Opportunistic enhancements use a 9–10/10 impact-and-execution threshold. If a
  proposed flourish cannot materially improve the core outcome while retaining
  accessible, testable, maintainable, and rollback-safe behavior, leave it out
  or return it to the backlog.
- Visible language is human, calm, observational, and close to the task. Avoid
  sales-heavy metaphors, product anthropomorphism, and internal architecture
  language. Keep exact authority, evidence, payment, delivery, and recovery
  terms wherever softer language would blur a consequential boundary.
- Customer-facing surfaces (portal, proposal PDFs, marketing) keep their
  tenant-branded hospitality treatment and are NOT covered by this system.

## Governing field-state and interaction contract

Every field or field-like control must preserve separate truths for
availability, origin, edit authority, persistence, and evidence. The canonical
machine-readable definitions live in `docs/field-state-contract.json`; exact
adopted surfaces live in `docs/field-state-surface-contracts.json`. UI work that
adds or changes a field, choice control, save state, recommendation, imported
value, or evidence state must update the registry and pass
`npm run check:field-states`. The gate scans explicit component roots for direct
imports of the shared state primitives and fails when an adopter lacks a
registered marker and assertion-bearing test; it does not guess field semantics
from unrelated repository text.

| Axis | States | Question answered |
|---|---|---|
| Availability | Unknown, Not provided, Not applicable, Unavailable | Do we have a value, and can it be obtained? |
| Origin | Defaulted, Suggested, Prepopulated, Historical/imported | Where did this value come from, and has QuotePilot established it? |
| Editability | Draft, Blocked, Read-only, Protected | May this user change it here, and has a local edit been persisted? |
| Persistence | Saving, Saved, Published | Has the authoritative write completed, and is the configuration active? |
| Evidence | Pending, Confirmed, Failed, Stale | What outcome or revision does authoritative evidence establish? |

Axes may coexist; their meanings may not be flattened into one status enum.
Render exactly one outcome-led primary state and express other active axes as
supporting detail rather than a competing row of badges. Every origin state
shows provenance. **Failed**, **Unavailable**, **Stale**, and **Blocked** always
show both the reason and one recovery action beside the affected field or
initiating control. Dynamic state changes use the contract's polite/assertive
live-region policy. Text or an icon carries meaning; color is supplemental.

State words are evidence claims. **Saved** means the server confirmed
persistence; it never means **Published**. **Published** means the configuration
is active for the stated scope. **Confirmed** requires authoritative evidence
for the exact claim. **Pending** preserves uncertainty and never authorizes a
blind retry. **Historical/imported** preserves source truth without implying
that QuotePilot established it.

Choice controls follow a strict 0/1/many contract through
`AdaptiveChoiceField`:

- Zero options renders **Blocked** or **Unavailable**, the reason, and one
  recovery action. It does not render an empty dropdown.
- One option renders static **Confirmed** and **Read-only** context without a
  dropdown chevron. It may be selected automatically only when the relationship
  is exact and the source remains visible.
- Two or more options render a labeled select with focus-visible, validation,
  disabled, and error states. A stale selected value remains visible until the
  operator resolves it; the UI never silently chooses a nearby value.

Buttons and button-like links must visibly answer four questions: can I act,
did activation begin, what outcome occurred, and how do I recover? Hover and
pressed movement lasts about 140ms where motion is useful; `focus-visible`,
readable disabled treatment, forced-colors behavior, and reduced-motion
fallbacks are mandatory. A caught user-triggered failure may not disappear into
console diagnostics or leave the initiating control looking idle.

## UX Convergence surfaces (source candidate)

- **Commercial Workbench:** retain the sheet-on-bone proposal as the living
  object. Desktop uses Quote Plan / proposal / Commercial Truth; tablet and
  phone progressively collapse the same regions. Domain summaries stay visible
  in Quote Plan while only one domain body is expanded. Guided mode, client
  Preview, and saved-proposal continuations remain part of the same object.
- **Calendar-first Operations:** retain the established scheduled-event,
  conflict, capacity, staffing, checklist, kitchen-checkpoint, and run-of-show
  models. Month gives the full horizontal canvas to the calendar, then reveals
  the selected day, focused event, conflict consequence, and collapsed
  operational domains in a contextual workspace beneath it. Week is a true
  seven-day time grid: vertical position encodes start time, height encodes
  duration, and collision lanes make overlapping events visible before their
  warning copy is read. Its focused context remains a secondary rail. These are
  two presentations of one workspace, not separate modes or engines.
  At 390, use an agenda derived from the identical day, event, and conflict
  models; never shrink the calendar into an unusable miniature. Selected state
  and conflict meaning need text, exact event identity stays stable, and
  planning language must not imply live actuals.
- **Operational disclosure:** event identity, timing, recorded lifecycle, and
  the next consequential action lead. Staffing, production checklist, kitchen
  checkpoints, and run-of-show detail begin collapsed and remain available in
  the focused event. Tools is a secondary disclosure, not a competing page
  destination.
- **Derived conflicts:** overlap, unknown-time, and capacity findings are
  observations recomputed from existing authoritative inputs. Never offer a
  manual **Mark as resolved** action or persist a second resolution state.
  Conflict comparison belongs inside the conflict workflow and identifies the
  exact affected events; resolution routes the operator to the affected
  Opportunity's authoritative date, time, duration, venue, guest-count, or
  lifecycle control. Calendar then recomputes the finding.
- **Visible Operations language:** use event, conflict, schedule, staffing,
  production, kitchen, and run-of-show language. Provider/source identifiers,
  design-system terminology, component names, model names, and evidence
  plumbing stay out of the ordinary task surface unless they are necessary for
  honest recovery.
- **Converged navigation:** when the existing Calendar capability is enabled,
  the local candidate uses five persistent primary destinations in this order:
  Now, Opportunities, Operations, Clients, and role-gated Library. Operations
  opens the reused Calendar capability directly; it is not duplicated as a
  header menu. Workspace & tools retains Operations, Clear the Deck, and Staff
  as the compact daily-execution group. When Calendar is disabled, Operations
  is absent from both layers, its direct and compatibility routes do not render
  Calendar, and contextual Calendar handoffs are withheld. Reporting remains
  independently capability-gated and People retains the existing
  administrator/staffing gate. At 390 the enabled five destinations wrap
  through the established automatic grid without horizontal overflow; at 768
  and 1440 they remain a stable orientation rail. Exact-head CI, hosted
  role/reachability proof, and human acceptance remain separate qualification
  boundaries.

## Ambient Intelligence extension (source proof, release-profile enabled)

Pilot Slice Alpha extends this system behind `VITE_AMBIENT_UI_ENABLED`. The
gate remains default-off outside governed release profiles and changes no data
or provider authority. The v0.16 candidate and production release profiles
bind it on. When off, the connected Quote Workspace remains the ordinary
exact-quote rollback presentation.

The Alpha visual grammar is an open editorial instrument rather than a card
dashboard: the selected opportunity leads with identity, lifecycle state,
bounded risk, and one ranked next action; intelligent objects read as content;
context appears temporarily in an anchored desktop inspector or mobile bottom
sheet; and hairlines do most grouping work. The top layer must expose identity,
state, risk, and next action inside the first viewport at 390, 768, and 1440px.
Desktop inspectors align to their invoking object when space allows and clamp
both horizontal edges to a 16px viewport inset when the anchor sits too close
to either edge. Anchoring may not clip the title, arrival context, evidence, or
persistent outcome controls.

### v0.16 Calm Four application contract (historical release contract)

Calm Four applies one information architecture across the authenticated staff
workspace. It distinguishes three layers and does not trade one for another:

1. **Global destinations:** **Now**, **Opportunities**, **Clients**, and
   role-safe **Library** are the only persistent primary navigation. **New
   quote** is a global action into the established opportunity/quote flow, not
   a fifth destination.
2. **Contextual workspace tools:** **Quick Updates** and opportunity-specific
   menu, staffing, pricing, proposal, activity, and event actions stay attached
   to the opportunity in view. They never become permanent navigation.
3. **Secondary administration:** Search, Operations, current workspace identity,
   account settings, sound preference, and sign-out remain quiet and reachable.
   Desktop uses the secondary header/bottom controls. Mobile uses the standard
   workspace/avatar trigger to open the focus-contained **Workspace & tools**
   sheet; it does not add another bottom-nav item.

The **Workspace & tools** sheet follows a stable task hierarchy: current
workspace, frequent tools, operations, administration, then account. Search,
Workflow, Messages, and Pilot stay exposed as frequent tools; live-event work
stays exposed under Operations. Reporting, integrations, import, and diagnostics
are conditionally rendered only after the user expands Administration, so a
collapsed section cannot leak gated controls into keyboard order. Closing the
sheet resets that secondary disclosure without changing any route or authority.

### UX convergence primary-navigation overlay (local source candidate)

The later frozen UX convergence contract promotes the qualified Calendar-first
**Operations** surface into a five-destination primary set: **Now**,
**Opportunities**, **Operations**, **Clients**, and **Library**. This supersedes
only the v0.16 four-item presentation rule; it does not replace any route,
business authority, role gate, or tenant capability. When `eventSchedule` is
enabled, Operations opens `/app/operations` directly and uses the same
Calendar/schedule authority. When it is disabled, Operations and its Calendar
handoffs are not offered and `/app/operations` plus `/app/schedule` fail closed
without mounting Calendar.

The former secondary Ambient Operations header menu is removed to avoid two
same-name destinations. **Workspace & tools** remains the one secondary
switchboard: Search plus Workflow, Messages, and Pilot under Frequent tools;
Operations, Clear the Deck, and role-gated Staff under Operations when Calendar
is enabled; Reporting,
Integrations, Import, and Diagnostics under progressive Administration; then
account controls. Reporting is independently hidden when its own capability is
disabled. New quote remains a global action. At phone width the enabled five
primary destinations share the safe-area-aware bottom rail; at wider widths
they remain the existing vertical orientation rail. Exact-head CI, hosted role
exercise, assistive-technology acceptance, and human acceptance remain separate
evidence gates.

v0.16 authorizes one organization per signed-in principal. It therefore does
not present a same-account **Switch workspace** control that the identity and
tenant model cannot honor. A person who needs another authorized principal uses
the existing sign-out/sign-in path; multi-organization membership would require
a separate authority design before it could enter this surface.

Active primary state follows the canonical route. In the Ambient-enabled v0.16
profile, `/app/quotes/:quoteId` opens the approved Opportunity workspace and
keeps Opportunities active rather than presenting quote detail as a separate
destination. Back and Forward preserve the actual history entry and its
application state; an unsaved contextual draft may temporarily restore the
current entry only to present its dismissal guard, then replay the exact
requested traversal after discard.

#### Staff-route return context

Native browser history remains the sole navigation authority; QuotePilot does
not maintain a second route stack. Each eligible Opportunities, Clients, or
Library round trip may add a bounded return token to its native history entry.
That token contains only canonical paths, allowlisted enum query values, opaque
surface IDs, and runtime, organization, and principal scope. Search text,
cursor positions, disclosures, scroll, focus, exact Library editor targets,
and draft values remain in tab memory and never enter a URL, durable browser
storage, or the history token.

Restoration is exact or it does not happen. The destination accepts only the
adjacent entry from the same runtime, organization, principal, and supported
route pair, with an exact key/path/query match. A copied, reloaded, expired,
malformed, or foreign token falls back to the canonical route, announces that
fallback once, and never selects a nearby record by name, position, or stale
memory. When valid, the route restores its structured filter, disclosure,
focus target, and settled scroll position within 8px; Forward reopens the same
exact object or runtime-only Library target.

Library gives each editor opening its own same-URL native history entry. Moving
among staff routes may suspend the mounted editor so its runtime-only draft is
still present on return. Leaving the editor itself uses one busy/dirty
dismissal authority for **Back to Library**, browser Back, browser Forward,
and other guarded exits. **Keep editing** retains the exact editor, history
entry, focus context, and draft. An accepted discard clears only that transient
draft, performs the originally requested traversal, and makes a later Forward
open the target from current persisted data rather than resurrecting discarded
values. Owner-keyed navigation guards ensure a temporary overlay can close
without removing the underlying Library guard.

Reload deliberately clears transient return context, free text, cursors,
disclosures, focus, scroll, exact runtime-only Library targets, and unsaved
drafts. Only route-approved URL enums such as an Opportunities status/event
type or Clients view may survive. The visible recovery status is a single live
announcement. At 390, 768, and 1440px, restored surfaces retain one `main`
landmark, an H1 followed by ordered H2 groups, AA text/chip contrast, 44px
targets, contained focus paint, and no unintended horizontal overflow.

Local evidence is 17/17 Chromium-admin cases. The nine responsive restored-
source checks report zero Axe violations inside the audited Opportunities,
Clients, or Library surface; destination pages report no serious or critical
whole-page violations, and the dirty-editor case has a clean whole-page scan.
Cross-browser, forced-colors, 200% zoom, actual assistive technology, hosted,
and human acceptance remain open.

**Now** is an editorial decision ledger, not a KPI dashboard or another work
queue. Its masthead promotes the highest-pressure condition supported by the
current bounded evidence. **Needs you** preserves the existing deterministic
Workflow order and caps the visible set at three; urgency is a presentation of
recorded overdue, blocked, invalid, due-today, warning, or blocking evidence,
not a decorative numeric rank. Each item states the recorded situation, the
exact consequence the source supports, and one existing continuation. A
secondary column projects a compact seven-day horizon and accepted/booked event
context from the existing Calendar inputs without becoming another Calendar.
The full-width **Quiet progress** band adapts to available evidence: internal
completion receipts appear as **Recently handled**; only existing pending or
provider payment states appear as **Waiting on others**. Operator-owned money
actions remain separately named Commercial steps. No customer contact,
delivery, collection, staffing, readiness, conflict, or live-operational state
may be inferred to fill the composition. At tablet and phone widths the same
semantic order stacks, the seven-day projection may scroll within its own
bounded region, and exact action/state continuity is preserved.

**Opportunities** is a
meaningful index on desktop and mobile; groups and ordering come from actual
attention/current-work state and recorded dates, never fixture position.
Opening a row preserves the exact opportunity identity and its event, menu,
staffing, pricing, proposal/activity, and evidence context.

Each populated Opportunities row is one open editorial work-queue line: exact
identity, lifecycle, recorded event context, one concise state-specific summary,
one outcome-named primary action, and one plainly named **Details** disclosure.
The concise summary is a presentation projection only; navigation continues to
carry the fuller exact-object arrival reason, consequence, and next resolution.
Desktop and tablet may align summary and action beside identity when space
allows. At 620px and below they stack in that order so neither copy nor action is
squeezed into a competing column. Duplicate disclosure labels, generic repeated
“There isn’t…” paragraphs, and a second equally weighted row action are not part
of this contract.

**Clients** keeps the approved hierarchy: eyebrow, editorial headline, short
explanation, hospitality image, opportunity story/action, three relationship
steps, then a quiet About disclosure. Its empty state contains no zero-value
metrics, search, refresh, or source-dashboard chrome. Search and filtering
appear only when records justify them. Populated Clients leads with identity,
current/recent recorded event, recorded contact details, current status, and one
next action before the larger directory. The v0.16 candidate renders no
AI-derived relationship memory. If that capability is introduced later, it
must be source-labelled, tenant-scoped, and correctable through an authoritative
Client 360 write path before it may appear as fact.

At 760px and below, the featured populated-client summary uses the same semantic
and visual order: identity and recorded event, recorded contact details, current
status, the one supported action, then the auxiliary hospitality image. Contact
and status become separate full-width rows, long email addresses wrap within
their own row, and decorative imagery may not narrow or precede the decision.
Desktop may align the action beside identity while keeping the same source order.

**Library** uses the same organization catalog in two modes. Standalone mode
contains no opportunity fiction. Contextual mode names the exact opportunity
and uses an explicit **Return to opportunity** or **Return to [event]** action.
The return-context layer adds no write authority; only existing guarded catalog
or quote authorities may persist a change. Ordinary non-expiry browsing and
restoration retain byte-equivalent business state. The existing administrator
quote-history read remains separately authorized to persist automatic quote
expiry, including local-fallback normalization and versioning, and is not
widened or reclassified by this contract. Library editor Back/Forward behavior
follows the shared native-history and dirty-draft contract above rather than
introducing a route-local dismissal rule.

### Quick Updates drawer and sheet

Quick Updates is the same editorial surface as the opportunity underneath it,
not a miniature administration dashboard. On desktop it is a narrow right-side
drawer over the still-visible workspace; on mobile it is a full-height sheet.
Opening, expanding, collapsing, and closing are write-free. Focus enters the
surface, remains trapped while it is modal, and returns to the invoking Quick
Updates control after clean dismissal.

On desktop and tablet, the exact opportunity breadcrumb and the outlined Quick
Updates launcher share a sticky contextual action bar below the global chrome.
The bar names the opportunity for assistive technology, remains attached to the
selected object while its page scrolls, and does not become global navigation or
compete with the ranked primary next action. At 620px and below, the context bar
returns to ordinary document flow and hides its launcher; the mobile opportunity
remote owns the one visible, full-width Quick Updates launcher so neither the
content nor the fixed bottom navigation is covered.

The mobile sheet's scroll region reserves at least 24px below its last task
target and applies matching scroll padding and target margin. Keyboard focus or
programmatic reveal of **Open full Library** must place the complete 44px target
above the fixed action footer, including its focus outline; a partly covered
label or icon is a failed layout state, not a cue that more content exists.

The common change is progressive: Menu exposes the supported service-style
control; Staffing and Pricing expose their current summaries and outcome-named
handoffs; **Open full Library** opens the exact contextual catalog. A changed
control produces a visibly unsaved local draft. For a Firebase-backed draft,
Review asks the existing server authority to project the exact persisted
**Before**, requested **After**, and material total, deposit, staffing,
draft-status/version, proposal, portal, lifecycle, and dependency effects. No
underlying quote, staffing, pricing, proposal, client, or catalog value changes
before explicit save.

Every destructive dismissal path—X, Cancel, Escape, backdrop, contextual
handoff, primary navigation, browser Back/Forward, and the applicable mobile
back action—uses the same guard. **Keep editing** restores the intact draft;
**Discard draft** removes only local draft state and then performs the original
intent. Saving is single-flight and blocks duplicate submission and dismissal.
The host binds the save to the reviewed simulation, active revision, catalog
digest, and policy, then uses the existing calculation and trusted quote-save
path. Success appears only after the exact write receipt, a server-only read of
the same tenant, quote, saved revision, and supported field, and a refresh of
the underlying opportunity list. Browser-local, sent, and viewed records
browse in place but hand off to the full editor instead of claiming the compact
save is authoritative. A rejection, conflict, ambiguous result, or failed
reread preserves a recoverable draft and never masquerades as success.

Service style does not currently carry a separate presentation-owned rule that
derives staffing or pricing values. The panel reports the server authority's
projected effects and offers the existing deeper workflows. It must not invent
a parallel staffing, pricing, tax, margin, proposal, portal, lifecycle, or
dependency calculator in order to make the compact interaction appear more
consequential.

### Behavioral chromatic and sensory semantics

Color, motion, sound, and haptics are representations of one
`AmbientFeedbackEvent`. They never establish state and never replace explicit
text, receipts, focus, or recovery:

- **Gold** identifies a recommendation or ready attention state.
- **Teal** appears briefly while supported deterministic reasoning or
  recalculation settles.
- **Coral** acknowledges recoverable warning or risk.
- **Mint** settles into the affected surface after resolution or acceptance.
- **Lavender** identifies customer-originated activity.
- **Blue** acknowledges contextual addition or outbound movement.

The semantic router supports `add`, `calculating`, `recalculated`, `resolve`,
`ready`, `sent`, `accepted`, `warning`, `failure`, and `customer_activity`.
Each event carries causal text, bounded evidence and receipt context, intensity,
and an allowlist of visual, announcement, sound, and haptic representations. It
reuses the existing workspace sound preference, leaves haptics opt-in,
suppresses movement and haptics for reduced-motion or reduced-sensory
preferences, and always keeps a non-sensory textual acknowledgement. Tenant
portal themes remain separate.

Anchored inspectors enter from their trigger origin in 240ms, dependent values
settle in 200ms, and a replaced next action settles in 180ms. The
`prefers-reduced-motion` branch removes those transitions without removing the
causal text or focus change. The `forced-colors` branch restores explicit
system-color borders, controls, and focus outlines. The executable contract is
`e2e/ambient-intelligence-accessibility.spec.js`; it runs the default-off slice
only when `VITE_AMBIENT_UI_ENABLED=true`.

### Ambient primitives

- `InlineValue`: content-first pointer, keyboard, and assistive-technology
  activation with explicit apply/cancel, validation, pending, recovery, and
  focus restoration.
- `ContextSurface`: refuses empty content, carries reason and consequence,
  optionally demotes repeated arrival explanation behind the native **Why this
  view** disclosure, traps and restores focus, and constrains its evidence body
  so the outcome footer remains visible on mobile.
- `AmbientUndoRail`: bounded newest-first history with asynchronous undo and
  retryable failure recovery.
- `AmbientContextSnapshot`: one immutable selected-object context for the
  ambient surface; it grants no authority.

### Orientation, mobile remote, and exact arrival

The default-off shell uses **Now**, **Opportunities**, **Clients**, and role-safe
**Library** as quiet persistent orientation. Search and New quote remain clear
utilities; deeper work should begin from the object that explains why the user
is moving. One global **Pilot** trigger now resolves to the active Living
Opportunity explanation, the already-mounted draft command field, or one
populated opportunity-choice recovery. Complete interpreted-destination parity
remains open AIUI-16 scope.

In the Ambient-enabled v0.16 profile, the approved Opportunity workspace owns
ordinary authenticated `/app/quotes/:quoteId` arrival. Its editorial event
composition keeps the exact opportunity identity and event, menu, staffing,
pricing, proposal/activity, evidence, next-action, and contextual Quick Updates
surface together under Opportunities.

The connected dinner-table Quote Workspace remains available at
`/app/quote-workspace` and `/app/quote-workspace-concept` as a compatibility
presentation with its event-table image, quote identity, saved-state evidence,
object tabs, commercial summary, and Activity & Save Health drawer. The same
presentation also owns ordinary exact-quote rollback when Ambient is off. Its
rail follows the same light orientation: **Now**, **Opportunities**,
**Clients**, and role-safe **Library** are primary; **New quote** and
**Operations** are utilities, while Event, Staffing, Proposal, Payment,
Conversation, and other deep work begins from the selected object.

Neither presentation absorbs new mutation authority. Quick Updates delegates
its explicit reviewed save to the existing trusted quote calculation and save
path; editing routes to the trusted quote editor, conversation routes to the
exact quote-scoped thread, and proposal/payment/lifecycle/delivery/recovery
controls remain in the full Quote administration surface through an explicit
continuation or a governed exact-arrival handoff. Compatibility and rollback
preserve authority without becoming a second Ambient primary quote design.

At 390px, the Living Opportunity begins with one in-flow remote, not a floating
or sticky layer. It must answer identity, state, what matters, and next action
within the first viewport, then expose 44px Event, Menu, Pricing, and Proposal
controls. The duplicate desktop hero and glance are hidden at that width so the
top layer is not repeated and no remote covers content. Sticky-next-action
behavior and complete mobile parity remain open AIUI-41 scope.

Cross-surface Ambient actions follow `workspace-arrival-contract-v1` and the
source-only [exact-arrival ADR](AMBIENT_WORKSPACE_ARRIVAL_ADR.md). A valid route
and history-state handoff can render **Finding**, never **ready**. Workflow,
Approval, or Messages may mark the item ready only after its destination has
loaded and focused the exact requested item. Exact customer-message identity
stays in bounded same-app history state rather than the URL. Missing, stale,
truncated, mismatched, or unavailable evidence recovers in context and may not
substitute a nearby item. Schedule and Reporting remain non-primary-ready until
equivalent consumers exist.

Ranked cross-route actions additionally use `workspace-task-journey-v1` as one
organization-, signed-in-principal-, and role-scoped session-only presentation
thread. It carries only the source action's opaque task ID, canonical source
route, exact destination object/focus, and allowlisted intent; event names,
customer names, notes,
search text, and other prose do not enter that record. Tracking begins only
when the guarded navigation actually commits. It performs no quote, client,
workflow, history, catalog, payment, or provider write, and replacing or
stopping it changes only browser-session presentation state.

Task phase and route context are independent. `locating`, `ready`, and
`recovery` describe exact-arrival context; **ready** never changes the task's
**In progress** phase. `review_follow_up` is the first closure adapter. An exact
completion attempt may show **Completed** only when the existing Firebase write
returns successfully, a server-only read of the same organization and quote
matches every returned follow-up field, the stored internal completion
confirmation is present, and that exact follow-up is absent from fresh
Attention. Its bounded proof is a confirmation reference, not an immutable
provider receipt. Browser-local saves, unavailable reads, field mismatches,
foreign scope, invalid timestamps, and ambiguous outcomes become **Needs
confirmation** with null proof; the recovery control retries only the readback
and never repeats the write. The retry retains the exact successful Firebase
write fingerprint; without it, later matching state cannot become confirmation.
Stopping or replacing the task invalidates every pending readback so an older
async result cannot restore or overwrite session presentation. A confirmed transition forces the shared
commercial snapshot to refresh so Now and other consumers cannot retain the
old due-work projection. The persistent task surface is a labelled region, not
another live announcement: the source acknowledgement, pending confirmation,
and destination arrival retain announcement ownership. It stays sticky inside
the desktop and tablet workspace, returns to document flow on mobile, exposes
44px controls, and remains clear of fixed navigation.

#### Durable action feedback foundation

The first recommendation-17 slice introduces
`workspace-action-feedback-v1`, a presentation-only, same-runtime contract for
consequential staff actions. It does not perform, authorize, retry, reconcile,
or persist a mutation. Each attempt is fenced to the exact organization,
signed-in principal, role, action, attempt, generation, and affected object.
Changing organization, principal, or role invalidates the registry. Ordinary
staff-route changes across both authorized workspace branches retain it; a full
page reload deliberately clears it. Portal, unresolved-auth, customer, and
denied-role branches never mount its provider.

Privacy is enforced first at the adapter boundary. The tracked Workflow adapter
supplies product-owned fixed action, message, and outcome copy, a bounded
quote-number object label, and opaque identifiers; it does not pass its
follow-up note, customer or staff email, thrown provider text, token-like
material, or raw record to the registry. The generic registry additionally
rejects unexpected fields, recognizable sensitive/error patterns, control or
bidirectional characters, oversized values, and opaque blobs. That classifier
is defense in depth, not proof that arbitrary otherwise-normal prose was not
copied from free text. Every later adapter must therefore establish the same
fixed-copy provenance before it can join the shared contract.

The contract has five states with deliberately different authority:

- `pending` means one exact request or read-only confirmation is in flight. The
  affected region is busy and duplicate submission remains unavailable.
- `succeeded` requires bounded definitive evidence already accepted by the
  owning capability. The feedback layer cannot manufacture a receipt or turn a
  browser-local observation into connected proof.
- `recovery` means the outcome is definitive enough to name what changed or did
  not change and offer one safe acknowledgement, return, inspection, or
  reconciliation action.
- `uncertain` means dispatch may have occurred but exact proof is missing or
  mismatched. The original write remains frozen; any offered action remains
  presentation-only or read-only. The Workflow adapter uses exact inspection or
  reconciliation. Uncertainty cannot be dismissed or acknowledged away, and it
  cannot transition directly to evidence-free `recovery`; authoritative
  reconciliation or cancellation must resolve the duplicate-write fence.
- `cancelled` requires either a pre-dispatch cancellation or an authoritative
  cancellation record. Stopping presentation-only task tracking is not a
  mutation cancellation.

The visual surface is a compact Calm Four continuity rail attached to the
affected object. It states the action, object, outcome, changed facts, unchanged
facts, and at most one safe next action. It joins the existing Current task rail
inside one sticky desktop/tablet continuity stack so the rails cannot overlap;
both return to document flow on mobile. The rails remain semantically
independent: action feedback describes one mutation attempt, while Current task
describes cross-route task continuity. The feedback region exposes exact
`data-action-feedback-*` markers and `aria-busy`; one separate atomic polite
announcer owns the state transition. When the shared announcer is available,
component-local consequential live regions and success/error toasts are
suppressed. Terminal acknowledgement carries the exact record revision, clears
only its exact stale announcement, rejects late controls, and cannot re-announce
a queued record or erase a newer announcement. Low-consequence toast
acknowledgement remains allowed. Canonical capability markers translate the
presentation phases into `ready`, `submitting`, `uncertain`, `reconciliation`,
`receipt`, `error`, and `recovery` without changing their business authority.

The exact tracked Workflow follow-up completion is the first adapter. It begins
feedback before the existing save, preserves the entered follow-up values, and
may transition to `succeeded` only after the existing Firebase result and exact
same-organization server-only readback. When the attempt still owns the exact
Current task, App must also persist closure before Workflow renders
**Confirmed**; rejection leaves task tracking open and renders recovery or
uncertainty without repeating the write. An older feedback attempt may confirm
the exact follow-up independently after authoritative reconciliation, but it
must leave a newer or missing Current task unchanged and omit the
task-completion fact. Timeout, offline, permission, stale, foreign-scope,
malformed, or field-mismatch outcomes never become success.

Preflight validation runs before feedback creation or write dispatch and returns
focus to the invalid field. If required shared feedback cannot begin, the write
is not sent and Workflow presents one bounded local recovery alert without raw
error text. Once dispatched, the save owns an immutable operation and feedback
selector: a task restart, focus change, authorized branch switch, or late
promise cannot retarget its transition to a newer generation. If Workflow
unmounts while its scoped provider survives, cleanup leaves the exact dispatched
attempt `uncertain` and the eventual promise cannot perform readback or call
task-completion authority. A staff-email change inside the retained provider
also leaves that exact attempt uncertain and clears its abandoned busy key. A
full scope teardown clears the registry and likewise prevents late work from
entering the next scope. The bounded registry
never evicts `pending` or `uncertain` work; capacity or an unresolved attempt for
the same action/object fails closed, so a second write cannot begin.

An uncertain feedback record owns its exact Workflow return even after the
operator selects **Stop tracking** on the independent task rail. **Review exact
follow-up** must focus the exact completed follow-up record with visible focus
clearance below the continuity stack. Only then may the shared return action
become inactive; the uncertain record and duplicate-write fence remain. The
local read-only **Retry confirmation** is then the sole resolution control and
never repeats the save.

This is a foundation, not recommendation-17 completion. Quick Updates, Catalog,
and the remaining staff mutations still use their existing local feedback
contracts until later bounded adapters are designed and verified.

Focused contract, provider, presentation, Workflow, and route tests cover exact
identity, strict transitions, unresolved-capacity refusal, late-promise cleanup,
scope invalidation, announcement ownership, and duplicate-write prevention. The
dedicated Chromium-admin matrix exercises Now at 390×844, Opportunities at
768×900, and Client 360 at 1440×1000 with
`VITE_E2E_LOCAL_REVIEW_FIXTURES=false`: visible `pending` acknowledgement within
250ms, exact uncertain identity, same-runtime route retention, exact return after
task tracking stops, reload clearing, intended browser-local quote/history
change, unchanged Catalog state, 44px controls, at most 1px horizontal overflow,
and no continuity-stack/global-chrome collision. All six same-context
before/after captures are part of the acceptance evidence; the tablet identity
grid stacks at 761–900px to prevent the observed mid-word wrap. Final result
counts belong to the immutable candidate completion handoff and must be rerun
after the last lifecycle change. This evidence does not establish 200% zoom,
forced colors, other browsers, actual assistive technology, connected or hosted
authority, production behavior, or human comprehension.

Ambient read failures use one calm, outcome-led recovery grammar. **Now**,
**Opportunities**, and **Events** must withhold raw provider text, avoid empty
or caught-up claims, name what remained unchanged, and present one dominant
retry with at most one productive continuation. Source and bounded-read detail
stays available through a collapsed **About this view** disclosure when it is
useful to staff, but it may not compete with the recovery decision. A completed
empty read remains distinct from an unavailable read, and an exact route may
never substitute a nearby opportunity or event. Recovery actions retain a
named group, 44px targets, and a single-column phone layout.

For a general Conversation handoff, the canonical object is the exact quote ID
typed as customer communication, while the event name stays on the loaded page
rather than entering browser history state. The arrival rail therefore says
**Finding Conversation** during canonical-body loading and **Conversation
ready** only after the exact event heading receives focus. A just-completed,
error-free quote-history read may establish the caller's observation as fresh;
an in-progress refresh or retained snapshot after a failed read remains stale,
and a missing observation remains unknown. A normalized but otherwise untouched
`followUp.stage = "new"` shell is not scheduled work; a due date, note,
completion, non-default stage, actor, or update timestamp is required before a
follow-up may outrank the Conversation handoff.

User-facing language stays observational and human: **Connected details** and
**Details affecting this quote** introduce the object layer; **Current picture**
and **Status by area** introduce momentum; **Pricing and margin** uses
direct plain language; and **Customer update** marks customer-origin activity.
Avoid sales-heavy metaphors or claims that the interface owns multiple
“truths.” Do not describe the product as thinking, knowing, watching, or acting
unless a bounded receipt supports that exact statement. Use proof terminology
only where it prevents an unsupported claim; everywhere else, prefer the
user's object, outcome, and next step. Internal
contract names such as `consequence`, `provenance`, and `authorityLevel` remain
exact even when the interface says **What this affects**, **Sources**, or
**What you can do next**.

Ambient Pilot voice follows the same causal grammar. A press receives an
immediate in-flow acknowledgement, browser `onstart` establishes **Listening**,
release becomes **Preparing your preview**, and recognition end may produce a
deterministic preview or an exact recovery. Pointer and Space/Enter are
equivalent; cancellation, Escape, focus loss, hidden document, timeout, and
unmount discard the capture. The 44px control and status stay in normal flow so
neither can cover the input or preview. Teal may settle a completed preview
through `AmbientFeedbackEvent`; microphone capture itself is not calculation,
and no sound, haptic, color, or motion can substitute for the textual receipt.
Typed input remains the availability floor and **Apply to draft** remains an
explicit separate choice.

Pilot preserves outcome hierarchy after preview. A command that already has a
current result offers a quiet **Refresh preview** control; its exact proposal
keeps **Apply to draft** as the primary next action. Editing the command makes
**Preview** primary again until the displayed result has been recalculated.

### Customer decision room

The default-off customer room is the customer-facing half of Client 360. It
keeps the tenant's hospitality identity and reads as one open proposal, not a
staff dashboard. At desktop, the event story owns the broad canvas and one
secondary decision rail holds the current decision state, total, required
deposit, expiry, response choices, mutation feedback, and authority-gated
question continuation. It must not inherit the staff navigation offset or
introduce another portal shell.

The event story orders identity, date, guests, venue, service, package/menu,
and compact optional additions before quiet planning and terms disclosures.
Price detail, planning assumptions, and tenant terms begin collapsed. Use plain
labels such as **Package & menu**, **Optional additions**, and **Your response**;
avoid sales euphemisms, urgency cues, or claims that the application is making
the customer's decision. **Required deposit** is the safe label: payment alone
must not imply that the date is secured or the event is booked.

Contextual question and addition controls must acknowledge immediately and
lead to the existing exact conversation or decision object. At 390, 768, and
1440px, the two desktop regions become one intentional sequence: proposal
identity, decision state, event story, commercial summary, response, additions,
and disclosures. Headings, tenant terms, controls, feedback, focus paint, and
the shared conversation may wrap but may not cover one another. Optional
additions are visually inviting without implying inclusion: the customer
prepares a note, staff reviews it, and only the trusted quote save can establish
revised price or scope. Tenant colors remain separate from staff Ambient
semantics.

### Clients presentation

The default-off Ambient Clients directory reuses the existing bounded,
tenant-scoped client page. It leads with names and recorded contact or latest-
opportunity context, then offers one direct **Review client** outcome. It does
not infer relationship quality, urgency, or a ranked client order from the
directory's partial evidence. Loading, stale, partial, truncated, unavailable,
and browser-local states remain explicit.

The selected client view is a relationship ledger, not a record dashboard. It
opens with the client identity and recorded contact details, then pairs one
evidence-supported next decision with a four-stage **Client → Opportunity →
Proposal → Event** spine. The active opportunity remains the living object;
recent history below it uses only recorded lifecycle, request, and conversation
evidence. When a customer request and its quote-scoped conversation summary
describe the same exact timestamp, the ledger presents the request once rather
than manufacturing two activities. It does not call general waiting urgent or
invent a consequence that is absent from authority.

Client navigation follows the exact-arrival contract: carry the opaque client
identity, reason, consequence, and next resolution; resolve only after the
matching heading is focused; and recover without substituting a nearby client.
Additional active opportunities, quote-scoped conversations, source detail,
and the full record begin collapsed. Opening a conversation sends nothing and
marks nothing read. At phone width the decision remains before the relationship
spine, stages become a compact two-column sequence, and history becomes a
vertical ledger without changing state or authority.

Existing history, rebook, communication, commercial, and role-gated controls
remain available under **More client history and controls**. Progressive
disclosure changes hierarchy, not authority or parity. The Ambient presentation
adds no read, mutation, relationship-ranking, pricing, message, payment,
booking, provider, or lifecycle authority, and browser-local records may not
borrow connected-workspace or provider-confirmed language.

### Library presentation

The role-safe Library treats the organization catalog as a quiet commercial
reference surface, not a settings dashboard. Its selected desktop composition
uses one broad inventory ledger and one quieter readiness rail at an approximate
67/33 relationship. The primary ledger groups **Offers**, **Components**,
**Templates**, and **Pricing & Rules**. It uses hairlines and open rows rather
than a process strip, dashboard card grid, or repeated `Review` controls. One
ranked setup action may appear only when its evidence is explicit and may not be
duplicated in the inventory.

Existing Packages appear as Offers without changing their stored record type,
IDs, inclusions, pricing, or save path. **Your bundle** remains the derived
composition of the one quote draft; Library may explain its ingredients but may
not create a Bundle record, route, lifecycle, save path, or pricing authority.
Menu, Services/Add-ons, and Rentals appear as Components, while Event Templates
remain reusable quote starting points.

Readiness follows uncertainty: unresolved setup expands and healthy evidence
compresses under disclosure. Standalone Library does not treat absent quote or
proposal context as a setup problem. Administrators retain the existing edit,
draft, review, and publication actions. Sales can inspect the same objects,
relationships, and readiness outcomes, then receives one administrator-managed
permission boundary instead of repeated disabled controls.

The Offer editor uses two desktop zones: a compact Offer navigator and one broad
selected-Offer workspace. Identity, selling price, quoting availability,
included components, derived margin, and the next decision lead. Detailed cost
and contribution evidence, readiness evidence, immutable IDs, catalog revision,
pricing confirmation, and quote behavior remain available under secondary
disclosures instead of a permanent health rail. Recorded choice groups may be
projected read-only with their attention state; the browser does not author them
or promise end-to-end quote selection. Mobile preserves the same semantic order,
compact switching, and full-viewport inclusion picker.

Add-ons and Rentals use named commercial-object summaries with business fields
first, visible derived Offer/Template Usage, and stable identity under
**Technical details**. Menu retains its existing managed editor and device-only
buffer boundary. Templates are independently collapsible and use this normal
group order: Starting Offer; Event context; Preselected components; Service and
rental defaults; Staffing and resource defaults; Pricing and policy defaults;
What remains open; Advanced identity and source. Partial Menu-inventory evidence
stays beside Preselected components, while only true identity/source/version/
vertical/starter provenance is Advanced.

Configuration Rules lead with the actual **WHEN / THEN / WHY**, enabled state,
and safe structured controls when the rule can be represented without loss.
Raw JSON remains available under **Advanced rule source**, opens for invalid or
non-structurable records, and continues through the same validation and
publication path. Pricing leads with readiness/consequence, then separates Base
pricing, Adjustments & context, Fees, Tax, and Deposit; cost/margin evidence and
technical policy sources remain under Advanced policy. Failure and recovery copy first states what cannot happen,
what remains active or unchanged, and the next safe action; raw errors and
provenance remain available under technical disclosure.

Incomplete event-specific menu inventory is **unavailable**, never empty.
Saved template references remain visible until the existing catalog validation
can classify them. Each section or template acknowledges immediately, then
opens the exact existing editor in normal flow with its object, reason,
consequence, and next resolution. The editor uses the exact focus as its title,
routes its single **Back to Library** action through the unsaved-change guard,
and restores Library orientation after closing. It may not open as an empty
overlay, paint over neighboring content, or replace the existing catalog save,
revision, role, or fallback boundary.

The right readiness rail may use restrained semantic icons, but adjacent text
is always the authority for state and action. Ordinary rendered Library text is
at least 12px. Save failure or source recovery exposes one owning **Save** or
**Try again** action, never competing duplicates. Changing the active tab inside
the embedded editor synchronizes the Library breadcrumb and editor title while
preserving the mounted draft, staged values, and save authority.

### Package/Menu evidence and draft review

Package and Menu behave as evidence objects before they behave as form fields.
Their inspectors lead with the exact saved selection, package-inclusion links,
explicit menu quantities and order, then disclose current same-tenant catalog
candidates, dependencies, why, consequence, do-nothing outcome, confidence,
and provenance. Human-readable names must stay paired with stable record IDs;
the interface may use names to explain an order but may never use a name or
catalog position to infer identity.

Replacement and reorder controls are available only from a fresh, exact tenant
catalog observation and the selected opportunity's exact saved revision. A
stale, partial, unknown, or cross-tenant observation remains inspectable and
explains recovery, but offers no draft mutation. Pointer drag and visible
keyboard move controls must produce equivalent single-move intent semantics.

The editor handoff is not a generic route. Its arrival context retains the
parent opportunity plus the selected object, reason, consequence, and next
resolution. The destination repeats the human-readable opportunity context and
opens a populated review showing saved versus proposed values. Menu-order rows
show readable names, stable IDs, and ordinal position so comprehension does not
trade away exact identity. The user must choose an outcome-named **Apply** or
**Keep** control; saving is blocked while that review is pending.

Apply may update only the isolated in-memory editor draft, preserve applicable
menu quantities/order, mark the exact fields dirty, and move focus to the
affected editor control. Keep applies nothing. Neither result persists,
reprices, updates the proposal, proves availability, or reconciles package
inclusions. Only the subsequent outcome-named trusted save may cross the
existing authoritative pricing/version boundary. The review's comparison,
evidence, status, and action groups wrap without horizontal overflow and remain
subject to the no-unintended-overlap invariant below.

### Interaction acknowledgement runtime

Every enabled Living Opportunity Alpha button carries a registered
`data-ambient-action-id`. Activation starts a monotonic observation, and the
control must produce a valid `AmbientActionResult` plus any required populated
destination contract within the inclusive 250ms acknowledgement window. Route
handoffs may show `pending` immediately, but the runtime validates their exact
surface only after the host callback returns. Missing, throwing, cancelled,
invalid, empty, generic, or silent paths leave the current work intact and
produce contextual recovery; silence becomes visible recovery at 251ms.

The local runtime emits `quotepilot:ambient-interaction` with aggregate-only
purpose, timing, result-kind, and primary dead-click fields. It excludes quote
and customer identifiers, labels, reasons, consequences, destinations, and
payloads. The existing product-event rail consumes the same bounded assessment
as a client observation and pairs two additional durations: first intent only
to an exact server-authoritative Firebase saved-draft receipt, and issue
surfaced only to resolution of the same bounded category in the same staff
session. Those events exclude quote/customer identifiers and free text. The
Reporting representation must show local fallback and zero samples as
`Not available`, and must label the values as client observations rather than
server timing, comprehension, or successful-outcome evidence.

### Deterministic object and Pilot policy boundary

Add-on, rental, bar, and service objects may manipulate only a reversible
browser-memory scenario until the existing priced editor and trusted save
establish a stronger result. Swipe is an optional representation; equally
visible button outcomes are mandatory. Money retains five separate evidence
domains—deposit policy, deposit request, provider-confirmed deposit, balance
request, and final settlement—and neither a request nor a browser return may
resolve into paid feedback. Pilot classifies navigation, query, draft mutation,
simulation, trusted mutation, communication, bulk action, and destructive
action separately; v1 executes only the first four through already-existing
handlers. These pure adapters perform no I/O and grant no authority.

### Guest count, Package, Menu, Selection, Pricing, Staffing, Proposal, and Conversation evidence grammar

Guest count, Package, Menu, Selection, Pricing, Staffing, Proposal, and Conversation join Money as evidence-first
objects, not miniature administration panels. Their Living Opportunity rows
show one concise current conclusion and open a populated `ContextSurface` whose
header repeats the exact opportunity. In the long Guest count, Package, Menu,
Selection, Pricing, Staffing, Payment, Proposal, and Conversation inspectors, the repeated entry reason and
consequence remain immediately
available behind **Why this view** so current state receives the first useful
viewport; the same reason copy is not repeated again in the visible evidence
body. Shorter contexts may keep the entry explanation expanded when it still
improves orientation.

Guest count must distinguish the saved record from an unsaved preview wherever
the value is shown. A saved value is labeled **Saved guest count**; a changed
value is labeled **Unsaved guest-count preview** and keeps the saved count
adjacent. Price/scope, staffing, and quantity-rule dependencies precede repeated
methodology. QuotePilot does not infer expected, guaranteed, or actual attendance
states unless the source record establishes those states explicitly. Previewing
or inspecting guest count does not reprice, resize quantities, change staffing,
reserve capacity, alter the draft, or save the quote.

When `attendance-state-v1` evidence exists, the Guest-count inspector leads
with three open rows in this order: **Saved priced count**, **Best attendance
evidence**, and a source-backed **Open decision** when one exists. A fresh exact-
quote Decision Debt read may supply final-count timing through the already-
mounted quote panel; stale, failed, incomplete, mismatched, or absent reads make
no due claim. Legacy quotes say that separate attendance evidence is not
recorded. Malformed future envelopes keep the saved priced count visible but
fall back to **Attendance evidence needs review**. Only an exact loaded Decision
Debt item may replace the ordinary priced-editor footer with **Review final-
count task**; that route handoff confirms, resolves, prices, staffs, reserves,
saves, or changes nothing.

Package and Menu keep the saved selection summary, exact recorded inclusions
or order, quantities, package-inclusion labels, catalog-match state, and
draft-only replacement or reorder controls ahead of repeated methodology.
Disclosure changes hierarchy only: it does not infer catalog identity, grant
replacement authority, reprice, confirm availability or preparation, alter
the draft, or save the quote.

Selection keeps its saved multi-group summary and the first quantity-aware
object ahead of arrival methodology. The complete add-on, rental, bar, and
service evidence, unsaved reversible previews, dependencies, counterfactuals,
confidence, provenance, and advisory boundary remain available. Disclosure
changes hierarchy only: it does not alter a selection, price or save a preview,
reserve inventory or staff, confirm availability, contact a customer, or grant
catalog, role, tenant, or provider authority.

Proposal keeps saved immutable revision, authoritative pricing, exact customer
projection, portal issuance, and provider evidence visually distinct. It may
name proposal-completeness gaps and descriptive prepare, send, rotate, or
recovery resolutions, but the inspector itself performs none of them. It must
never promote issuance or provider acceptance into delivered, viewed, accepted,
booked, or paid feedback.

Conversation uses exactly five ordered rails: sent, provider-reported delivery,
portal view, latest reply, and bounded inferred engagement. Change-request and
internal follow-up evidence remain separate supporting regions. Lavender may
identify customer-originated activity, but it cannot imply that staff read,
acknowledged, or resolved it. The inspector provides no send or mark-read
control; only a populated Messaging or Workflow handoff may continue the work.
The five rails and current next action precede the repeated arrival explanation;
**Why this view** keeps that explanation available without repeating it later
in the body. Dismissal restores the exact inspect trigger and changes no saved,
message, or workflow state.

Payment and Proposal continuation uses the same exact-arrival grammar. Browser
history carries a canonical quote-scoped `Payment` or `Proposal` object and the
destination remains **Finding Payment** or **Finding Proposal** while Quote
History is loading. It becomes ready only after the completed read contains the
exact quote and the open **Quote administration** summary receives focus. During
that exact arrival, adjacent saved-quote, commercial-dependency, Decision Debt,
and general Ambient panels stay out of the destination so the promised controls
lead the first useful viewport. Navigation itself requests, sends, settles,
reconciles, rotates, recovers, or changes nothing.

The last completed local flag-enabled intelligent-object browser lane passes 40
of 40 cases.
At 390, 768, and 1440px it verifies Event Logistics, Package/Menu, Selection,
Money, Proposal, Conversation, and global Pilot contexts plus the exact draft
handoffs and recovery boundaries. This is responsive source evidence, not hosted, provider,
production-data, or human acceptance. The fresh lane includes strict invalid-
arrival recovery and the single-layer mobile Event disclosure.

### Deterministic Pilot answers and scenario review

Pilot's query presentation is embedded in the ordinary editor flow. Proposal-
blocker, price-composition, authorized recorded-cost margin, and client-safe
summary answers use known details followed by consequence, do-nothing state,
confidence, provenance, and authority language. Unknown evidence remains
unavailable. Margin receives no healthy treatment unless both staff
authorization and complete recorded-cost coverage exist.

Under-budget and improve-margin scenarios use the same evidence grammar. The
result must visibly distinguish available, already satisfied, no bounded match,
and unavailable states; only an available scenario may expose `Adopt in draft
review`. The review is a normal-flow surface—not a floating confirmation
modal—and shows goal, saved/proposed values, every direct compromise, locked
scope, commercial effect, why, consequence, do-nothing state, confidence,
provenance, and the draft-only authority boundary. Its two outcomes are
`Apply scenario to draft` and `Keep current draft`. Apply is valid only while
the bound organization, catalog observation and revision, proposal fingerprint,
and affected draft-field snapshot still match. It changes only the isolated
draft; a later outcome-named trusted save owns repricing and persistence.

### Operational staffing authority surface

The independently gated Operational Staffing panel is nested inside the
Staffing intelligent object's populated context surface. Its color and motion
remain secondary to literal authority language and canonical
`data-capability-state` markers: current evidence, gaps, stale/partial reads,
submitting, uncertainty, reconciliation, immutable receipt, rejection, and
recovery are never collapsed into a decorative success treatment. Commercial
quoted counts and operator-confirmed coverage occupy separate groups. Local
fallback uses the explicit `local_draft` boundary and may not borrow mint,
receipt, or coverage-confirmed semantics. An unresolved command freezes changed
inputs and exposes only exact replay or reviewed reset; its bounded memory-only
retention never crosses organization, quote, source, role, or gate identity.

## Tokens (src/styles.css `:root`)

- Surfaces: app background `#f6f6f4`, cards `#ffffff`, inset `#f4f4f2`.
- Ink: primary `#1f2023` (`--tone-ink-1`), secondary `#3b3d42`, muted
  `#5f6268`/`#6b6e74`. Muted text on white must use `#6b6e74` or darker
  (WCAG AA 4.5:1 — verified by e2e/accessibility.spec.js axe checks at
  1440px and 390px).
- Accent: gold `#8d611a` (`--tone-gold-3`) for primary actions, active
  states, and focus rings. White-on-`#8d611a` passes AA. No gradients.
- Hairlines: `#e4e4e0` borders, `#efefec` row separators.
- Radii: 8/10/14 (`--radius-sm/md/lg`). Shadows are soft and small
  (`--shadow-soft/panel/elevated`).
- Type: Manrope everywhere in the staff workspace (`--font-ui`,
  `--font-display`). Bodoni Moda serif is reserved for editorial/brand
  moments via `--font-editorial` (brand lockup, portal h1, event title,
  quote-summary total). 12px minimum font size.

## Layout contracts

- No-unintended-overlap invariant: visible content, enabled controls, and focus
  paint must not collide at 390, 768, or 1440px. Related siblings declare a
  shared `data-layout-audit-group`; the audit reserves two pixels around the
  active element so a focus indicator cannot silently cover adjacent copy.
  Shared route, modal, recovery, command-center, and event heading wrappers are
  enrolled through the reusable audit vocabulary; a bespoke composition must
  declare its own peer group instead of relying on visual similarity.
  Purposeful menus, inspectors, drawers, and sheets may overlap only when they
  declare `data-layout-overlap-allowed="true"`, remain geometrically contained,
  preserve a clear object context, and provide keyboard-accessible dismissal
  with focus restoration. The marker records intent; it is not proof of
  containment, dismissal, or focus restoration, which must be exercised while
  the layer is visibly open. Horizontal scrolling is permitted only inside an
  explicitly bounded overflow region. Do not remove visible focus to satisfy
  the audit; use contained focus paint and sufficient spacing.
- Workspace feedback and toast acknowledgements remain in normal document flow
  (`data-layout-audit-surface="workspace-feedback"`) rather than floating over
  active work. They must wrap long content, create no horizontal overflow, and
  remain geometrically separate from the draft review, Live Breakdown, and
  other adjacent resolution surfaces. A transient message may be visually
  elevated, but it is not an intentional overlay and may not declare the
  overlap exemption.
- The expanded Chromium-admin layout lane passes 81 of 81 local cases with 0
  failed or skipped in 3.1 minutes across 390×844, 768×900, and 1440×1000. Its
  matrix contains one fail-closed route-contract drift guard; 45 route cases;
  three Library template-editor cases; 27 header, search, context, and Pilot
  cases; two mobile Live Breakdown cases; and three editor review/feedback
  cases. At that v0.16 checkpoint, the four Calm Four primary destinations were
  derived from the same frozen navigation contract used by the shell; the later
  UX convergence overlay adds Operations as the fifth destination. Every
  declared route must resolve at least one current visible audit peer. The lane covers Workspace &
  tools, declared header popovers, Workspace search, Package, Money, Proposal,
  and Conversation contexts, deterministic Pilot answers, the normal-flow Pilot
  scenario review, and draft-review/feedback states. Every geometry assertion
  keeps collisions, overflow, escaped controls, escaped focus paint, and
  undeclared overlays empty; document overflow is at most 1px. Mobile exact
  opportunity headings reserve an internal focus-paint perimeter, and the
  intentional Workspace-tools-to-search transition replaces the first modal
  before opening the second without weakening other modal guards. The Messages
  heading additionally preserves at least 8px between focused title paint and
  its subtitle; the redundant eyebrow has been removed. Passing this lane is
  not a universal no-overlap claim: sales-role geometry, Firefox/WebKit, zoom
  and safe-area behavior,
  connected portal conversation/Ask states, maximum-result search states,
  hosted provider behavior, and human acceptance remain explicit open
  qualifications.
- Sidebar shell: at `min-width: 1181px` the `.site-header` renders as a
  fixed 236px dark rail (`#17181c`); below that it is the light top bar.
  This is CSS-only — the header DOM is identical in both modes. e2e asserts
  same-column nav alignment at >=1181px and same-row below
  (customer-centered-workspace.spec.js "nearby widths" test).
- Focus: interactive focus rings are gold; route-heading and modal-card
  focus outlines are `2px solid rgba(141, 97, 26, 0.55)` (e2e asserts 2px).
  Never dim text with opacity to indicate disabled/locked state — use
  AA-safe muted colors instead (opacity dimming broke axe checks).
- Disclosure pattern: `.staff-evidence-disclosure` (native `<details>`)
  is the standard for demoting evidence/methodology copy — used by the
  staff evidence rail ("Data freshness"), the Quotes sheet ("Workspace
  data details"), and Reporting ("How these numbers are read"). Keep the
  status chip and one-sentence outcome visible; collapse the rest.
- Alert notes: `.error-note`/`.warning-note` are tinted bordered cards,
  not bare colored text.
- Event workspace (quote page): `.event-workspace-body` = main column +
  304px sticky side rail (quote summary from `quote.totals`, lifecycle).
  Readiness donut is a conic-gradient driven by the `--readiness-score`
  inline variable.

## Feature flag

`VITE_CUSTOMER_CENTERED_WORKSPACE_ENABLED` defaults ON (App.jsx); only an
explicit false/0/no/off restores the legacy modal shell. The default e2e
lane pins it off to keep the legacy contract tested; the flag-on suite
covers the production default.

## Known follow-ups

Tracked in DEV_TASKS.md: promote Catalog into primary sidebar nav
(admin-gated), a first-class Templates surface for event-type presets,
inline editing on the event workspace (requires simulate-pricing round
trips and change-authority integration), and a terminology pass on the
remaining expert labels (e.g. Decision Debt, Revenue Autopilot).
