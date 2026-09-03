# QuotePilot Staff Workspace Design System

Last updated: 2026-09-02 18:55:27 CDT

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

### v0.16 Calm Four application contract (source candidate)

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

**Now** is an editorial home, not a KPI dashboard. It pairs the established
hospitality image with at most three priorities from existing Workflow order,
recorded upcoming work, and quiet internal progress. **Opportunities** is a
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
Browsing is read-only; only the existing guarded catalog or quote save
authority may persist a change.

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

The default-off customer room keeps the tenant's hospitality identity while
using the same calm hierarchy and no-overlap discipline. It reads as one open
proposal, not a staff dashboard: Event, Menu and service, Pricing, assumptions,
terms, optional additions, response, and questions follow a stable content
order. Use plain labels such as **Pricing**, **Optional**, and **Your response**;
avoid sales euphemisms, urgency cues, or claims that the application is making
the customer's decision.

Contextual question and addition controls must acknowledge immediately and
lead to the existing exact conversation or decision object. At 390, 768, and
1440px, headings, tenant terms, controls, feedback, focus paint, and the shared
conversation may wrap but may not cover one another. Optional additions are
visually inviting without implying inclusion: the customer prepares a note,
staff reviews it, and only the trusted quote save can establish revised price
or scope. Tenant colors remain separate from staff Ambient semantics.

### Clients presentation

The default-off Ambient Clients directory reuses the existing bounded,
tenant-scoped client page. It leads with names and recorded contact or latest-
opportunity context, then offers one direct **Review client** outcome. It does
not infer relationship quality, urgency, or a ranked client order from the
directory's partial evidence. Loading, stale, partial, truncated, unavailable,
and browser-local states remain explicit.

The selected client view must answer who this is, what current work appears in
the completed read, what needs review, and the next supported step before the
detailed record. Client navigation follows the exact-arrival contract: carry
the opaque client identity, reason, consequence, and next resolution; resolve
only after the matching heading is focused; and recover without substituting a
nearby client. Active opportunities and quote-scoped conversations remain
separate recorded contexts. Opening a conversation sends nothing and marks
nothing read.

Existing history, rebook, communication, commercial, and role-gated controls
remain available under **More client history and controls**. Progressive
disclosure changes hierarchy, not authority or parity. The Ambient presentation
adds no read, mutation, relationship-ranking, pricing, message, payment,
booking, provider, or lifecycle authority, and browser-local records may not
borrow connected-workspace or provider-confirmed language.

### Library presentation

The default-off administrator Library treats the organization catalog as a
quiet reference surface, not a settings dashboard. Its first view separates
Catalog choices from first-class Event Templates, uses hairlines and open rows
instead of nested cards, and keeps source, observation time, revision, and
pricing-review context visible without promoting them into large metrics. One
recommended next step may appear only when its evidence is explicit.

Incomplete event-specific menu inventory is **unavailable**, never empty.
Saved template references remain visible until the existing catalog validation
can classify them. Each section or template acknowledges immediately, then
opens the exact existing editor in normal flow with its object, reason,
consequence, and next resolution. The editor uses the exact focus as its title,
routes its single **Back to Library** action through the unsaved-change guard,
and restores Library orientation after closing. It may not open as an empty
overlay, paint over neighboring content, or replace the existing catalog save,
revision, role, or fallback boundary.

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
- The expanded Chromium-admin layout lane passes 80 of 80 local cases with 0
  failed or skipped in 6.3 minutes across 390×844, 768×900, and 1440×1000. Its
  matrix contains 45 route cases; three Library template-editor cases; 27
  header, search, context, and Pilot cases; two mobile Live Breakdown cases;
  and three editor review/feedback cases. It
  covers declared header popovers, Workspace search, Package, Money, Proposal,
  and Conversation contexts, deterministic Pilot answers, the normal-flow Pilot
  scenario review, and draft-review/feedback states. Every geometry assertion
  keeps collisions, overflow, escaped controls, escaped focus paint, and
  undeclared overlays empty; document overflow is at most 1px. The Messages
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
