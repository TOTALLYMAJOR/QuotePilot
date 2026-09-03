# QuotePilot Staff-App UI Cohesion Audit

Last updated: 2026-09-03 02:54:22 CDT

Status: point-in-time design recommendation register. This document records
observations and proposed contracts; it does not grant runtime, persistence,
deployment, provider, or release authority.

## Consequential finding

QuotePilot already has a recognizable Calm Four visual language. The largest
remaining opportunity is not another visual restyle. It is to make identity,
task continuity, status meaning, recovery, and feedback behave like one system
as an operator moves between **Now**, **Opportunities**, **Clients**, and
**Library**.

The recommended sequence therefore treats cross-route continuity as the design
problem. Typography, frames, imagery, and disclosures support that system; they
do not substitute for it.

## Scope and evidence boundary

This audit covers the authenticated staff/admin application. It excludes the
marketing site, customer portal, and generated proposal documents except where
a staff handoff must preserve their evidence boundary.

Evidence inspected in this run:

- all 27 fresh Chromium-admin images under
  `output/playwright/v16-calm-four-current/`, captured from the same local
  fixture family by the ten-scenario Calm Four suite;
- the current implementations of the four Calm Four routes, exact opportunity,
  Workspace & tools, global search, contextual Library, status semantics,
  recovery surfaces, and presentation helpers;
- **10/10** fresh Calm Four browser scenarios, **81/81** cross-app layout
  cases, **5/5** focused task-journey browser cases, **73/73** focused
  task-journey/component tests, **17/17** local Chromium return-context cases,
  the focused action-feedback registry, provider, presentation, Workflow, and
  authorized-route test surfaces (**127/127** focused assertions), **3/3**
  responsive Chromium-admin action-feedback cases, and **4,360/4,360** unit
  assertions passing (78 skipped) after the last runtime change;
- all twelve action-feedback state captures and three controlled before/after
  comparison boards were inspected at 390, 768, and 1440px. The final review
  found no blockers after correcting tablet identity wrapping and focus
  clearance, desktop header-control overlap, exact destination focus paint,
  and disabled-action hierarchy; and
- the user-selected Linear benchmark for
  [contextual actions](https://linear.app/docs/select-issues),
  [adjacent details](https://linear.app/docs/project-overview), and
  [sticky grouping](https://linear.app/docs/display-options). The benchmark is
  structural only; QuotePilot retains its own hospitality language and visual
  identity.

This is local source and fixture evidence. It does not prove Firefox/WebKit,
safe-area devices, actual assistive-technology use, authenticated hosted data,
production behavior, provider outcomes, or human acceptance.

## Recommendation register

The first fourteen recommendations preserve the original numbering. Completed
items mean implemented on this local branch with local evidence, not deployed
or human-accepted.

Current-slice boundary: this commit changes only recommendation 17, and only as
a foundation plus the tracked Workflow follow-up adapter. Recommendations 15
and 16 are prior branch work (`b72fe19` through `b936264`, and `16862b2`
respectively) carried here as dependencies, not work delivered by this commit.
Recommendations 18–24 remain design backlog with no runtime claim.

Priority basis: P1 items protect task identity, mutation safety, evidence truth,
or recovery from an operational error. P2 items reduce orientation and scanning
cost after those authority-sensitive contracts are stable.

| # | Priority | Recommendation | Current disposition |
|---:|---|---|---|
| 1 | P1 | Persistent Quick Updates | Implemented locally in `ea76a0b`; one contextual sticky desktop/tablet launcher and one in-flow mobile launcher. |
| 2 | P1 | Stabilize New quote | Implemented locally in `6225e02`; current 390/768/1440 captures show the complete label. |
| 3 | P1 | Preserve one dominant action | Implemented locally in `6225e02`; Quick Updates remains secondary to the ranked next action. |
| 4 | P1 | Simplify opportunity rows | Implemented locally in `6225e02` with concise state-specific reasons. |
| 5 | P1 | Improve mobile opportunity rows | Implemented locally in `6225e02`; reason and action stack at phone width. |
| 6 | P1 | Reflow mobile Client summaries | Implemented locally in `8a05a32`. |
| 7 | P1 | Clear the Quick Updates footer | Implemented locally in `c171cf8`; focus clearance is executable, not screenshot-inferred. |
| 8 | P2 | Remove duplicate disclosures | Satisfied by the current single **About this opportunity** contract and guarded by the current layout/acceptance suite. |
| 9 | P2 | Normalize page frames | Open; acceptance contract below. |
| 10 | P2 | Moderate mobile editorial type | Open; acceptance contract below. |
| 11 | P2 | Structure Workspace & tools | Implemented locally in `ccc78cb` with progressive Administration disclosure. |
| 12 | P2 | Unify search behavior | Open; acceptance contract below. |
| 13 | P2 | Standardize evidence disclosures | Open; acceptance contract below. |
| 14 | P1 quality debt | Repair the broad layout gate | Implemented locally in `598d4dd`; current route contract and fail-closed selectors pass 81/81 cases. |
| 15 | P1 | Close the cross-route task loop | Implemented by earlier branch commits; 5/5 focused Chromium cases prove three-source continuity plus fail-closed browser-local completion. Connected Firebase readback and cross-route invalidation proof remain open. |
| 16 | P1 | Preserve the operator's place on every round trip | Implemented by prior commit `16862b2`; 17/17 Chromium-admin scenarios cover exact, privacy-bounded native Back/Forward at 390, 768, and 1440px, including Client 360, nested Library, delayed reads, reload/recovery boundaries, and the dirty Library guard. Hosted and human acceptance remain open. |
| 17 | P1 | Use one durable action-feedback contract | **Partially implemented by this commit:** same-runtime foundation plus the exact tracked Workflow follow-up adapter. Quick Updates, Catalog, and remaining mutations are not migrated, so the recommendation remains open even after this slice passes. |
| 18 | P1 | Preserve independent commercial evidence rails | Open; acceptance contract below. |
| 19 | P2 | Add a selected-object relationship spine | Open; acceptance contract below. |
| 20 | P1 | Establish a canonical object signature | Open; acceptance contract below. |
| 21 | P1 | Use one operator-facing date and time grammar | Open; acceptance contract below. |
| 22 | P1 | Label lifecycle, attention, relationship, and availability domains | Open; acceptance contract below. |
| 23 | P1 | Extend one read-state and recovery contract to every Calm Four route | Open; acceptance contract below. |
| 24 | P2 | Give imagery a truthful route role | Open; acceptance contract below. |

## Ten additional cohesion enhancements

### 15. P1 — Close the cross-route task loop

Observed seam: a ranked action can open the correct destination, but its
in-progress and resolved meaning is still mostly owned by the destination. The
source route cannot always distinguish opened, cancelled, completed, or
superseded work.

Design contract: every ranked action that leaves its source carries a bounded,
tenant-scoped task identity. Opening acknowledges **in progress** without
writing business state. Only the capability's existing authoritative outcome
plus same-tenant readback may resolve or replace the task across Now,
Opportunities, Client 360, and Workflow. When no immutable receipt exists, the
UI must call the readback evidence a confirmation rather than a receipt.

Observable operator outcome: from any ranked source, the operator can identify
the same task, continue to the same object, and see whether it is merely open,
needs confirmation, or is authoritatively resolved. No route may silently
translate destination readiness into business completion.

Implementation checkpoint: the current candidate carries the exact source
action ID into a principal-, role-, and tenant-bound session contract, matches
the complete canonical arrival focus, and keeps exact-context **ready**
separate from task completion. The first closure adapter is the exact Workflow
follow-up: only a successful Firebase result followed by a matching server-only
same-organization read, one bounded internal completion confirmation, and
absence from fresh Attention may resolve it. Every local, unavailable,
mismatched, invalid, or ambiguous result remains **Needs confirmation** with
null proof, retains the exact task, and offers a read-only confirmation retry.
The implementation never automatically repeats the write and forces the shared
commercial snapshot to refresh only after confirmation.

Five focused Chromium cases exercise Now at 390px, Opportunities at 768px,
Client 360 at 1440px, a desktop dirty-draft guard, and an intentional
browser-local completion. They prove each source-specific action ID converges
on the same exact Rivera Workflow focus, the task rail appears within 250ms,
reload and Back/Forward retain the session task, visible controls remain at
least 44px without chrome overlap or horizontal overflow, and the local save
changes only its named quote/version history while the task fails closed. This
is not a full three-by-three source/viewport matrix and does not prove a
connected Firebase readback, connected tenant authorization, provider
non-invocation, cross-route invalidation, the full failure fixture family,
assistive-technology comprehension, hosted behavior, or human acceptance;
those remain open.

### 16. P1 — Preserve the operator's place on every round trip

Former seam: exact-object arrival was strong, but list filters, disclosure,
scroll, and focus did not share one return-context contract.

Design contract: distinguish object/task context from view context. Preserve
only safe structured filter, ordering, disclosure, scroll, and focus state.
Free-text search remains session-only and never enters a durable URL or
cross-session record.

Observable operator outcome: Back returns to the exact initiating control and
settled list position; Forward reopens the exact object. Invalid or foreign
context returns to the canonical route with one explanation and never guesses
a nearby record.

Implementation checkpoint: the current candidate uses native browser history
as the only route stack. A minimal entry token carries canonical paths,
allowlisted enum queries, opaque surface IDs, and runtime/organization/
principal scope; free text, cursors, disclosures, scroll, focus, exact Library
targets, and drafts remain in tab memory. Only an adjacent exact entry from the
same scope can restore. Invalid, copied, reloaded, expired, or foreign context
falls back to the canonical route with one announcement and never substitutes
a nearby record.

Opportunities, Clients, and Library restore the exact initiating control and
settled scroll position within 8px; Forward reopens the exact object. Library
editors receive distinct same-URL entries, preserve route-suspended drafts, and
share one busy/dirty guard across explicit dismissal and native Back/Forward.
Declined discard keeps the editor, history entry, and draft; accepted discard
continues the original traversal, and Forward reads persisted data without
resurrecting the discarded draft. Seventeen local Chromium-admin scenarios
cover the three-route 390, 768, and 1440px matrix, real Clients pagination,
Client 360, nested contextual Library, delayed reads, reload privacy, invalid/
foreign recovery, 44px targets, semantic structure, and the adversarial dirty-
editor sequence. Restored route surfaces have zero scoped Axe violations;
destination pages have no serious or critical violation. Non-expiry fixtures
retain byte-equivalent quote/history/catalog state with no unexpected non-GET
request. The return-context layer adds no write authority; the existing admin
quote-history read may still persist automatic expiry under its pre-existing
lifecycle authority. This remains source/local Chromium evidence; forced
colors, 200% zoom, Firefox/WebKit, real assistive technology, hosted data,
deployment, and human acceptance remain open.

### 17. P1 — Use one durable action-feedback contract

Observed seam: acknowledgements, inline messages, and recovery surfaces use
related language but do not yet expose one state machine across mutations.

Design contract: share `pending`, `succeeded`, `recovery`, `uncertain`, and
`cancelled` feedback. Feedback stays attached to the affected object, states
what changed and what did not, and presents the next safe action. Toasts remain
for low-consequence confirmation only.

Observable operator outcome: after one consequential action, exactly one
feedback surface identifies the action, attempt, generation, and object; it
acknowledges promptly, never calls ambiguity success, and cannot invite a
second write while the first exact-object outcome is unresolved.

Implementation checkpoint: the current candidate establishes a
presentation-only, same-runtime registry fenced to exact organization,
principal, role, action, attempt, generation, and object identity. Staff-route
changes retain its bounded feedback; reload and any scope change clear it. The
compact feedback rail joins the independent Current task rail in one
non-overlapping continuity stack, reports exact changed/unchanged facts, exposes
one safe action, and uses one atomic shared announcer instead of duplicated
consequential component toasts or live regions. The exact Workflow adapter uses
product-owned bounded copy and never supplies its note, customer/staff email,
thrown provider text, token-like material, or raw record to the registry. The
registry's pattern rejection is defense in depth; it cannot prove the provenance
of arbitrary normal prose, so later adapters must also use product-owned copy
rather than forwarding free text.

The first adapter is the exact tracked Workflow follow-up completion. `pending`
is single-flight; `succeeded` requires the existing authoritative outcome. If
the attempt still owns the exact Current task, App must persist its closure
before Workflow can render **Confirmed**. An older feedback attempt may instead
reconcile independently after exact authoritative proof; it leaves any newer or
missing Current task unchanged and omits the task-completion fact. An ambiguous dispatched outcome
becomes `uncertain`, freezes duplicate write, preserves entered values, and
offers only read-only exact reconciliation. `recovery` names what changed and
what stayed unchanged; `cancelled` requires a pre-dispatch or authoritative
cancellation basis and is never inferred from **Stop tracking**.

Each dispatched attempt owns an immutable selector and operation identity.
Task restart, focus change, authorized branch change, component cleanup, or a
late promise may settle only that attempt. Cleanup inside the surviving provider
leaves a dispatched attempt `uncertain`; a staff-email change inside that
provider does the same and clears the abandoned busy action. A full scope change
clears it and stale work cannot call readback or task-completion authority in the
new scope. A second generation for the same object stays blocked while the
earlier outcome is `pending` or `uncertain`, and a full unresolved registry fails
closed instead of evicting ambiguity. Uncertainty cannot be dismissed or
laundered directly into evidence-free recovery; terminal acknowledgement is
revision-fenced so a late control cannot remove a newer result.

This is not the completed cross-mutation contract. Quick Updates, Catalog, and
other staff mutation surfaces retain their existing local feedback until later
adapters land. The dedicated Chromium-admin matrix covers 390×844, 768×900, and
1440×1000 with local review fixtures disabled. It exercises prompt pending
feedback, exact uncertain identity, one announcement, duplicate-write lock,
ordinary same-runtime staff-route retention, exact reconciliation return even
after **Stop tracking**, reload clearing, bounded
local state change, 44px actions, overflow bounds, and continuity-stack/chrome
separation. The route component suite separately proves continuity across the
authorized Ambient and compatibility branches, immediate provider removal while
auth is unresolved even if the prior identity remains in memory, and exact-
revision terminal dismissal from compatibility. Focus must land on the exact returned follow-up with at least 44px
visible below the sticky stack before the shared return action becomes inactive;
the unresolved fence remains and its local read-only retry then becomes the sole
resolution control. All six
same-context before/after captures were reviewed. Tablet identity now stacks at
761–900px, exact returned records retain visible teal focus paint below the
rail, desktop rails no longer partially cover Workflow controls, and disabled
Save no longer competes with the enabled Retry action. Post-runtime-edit
evidence is **127/127** focused assertions and **3/3** Chromium-admin cases;
the full unit suite is **4,360/4,360** passing with 78 intentional skips.
Connected authority, maximum-copy presentation, 200% zoom, forced colors,
reduced transparency, other browsers, actual assistive technology, hosted data,
production behavior, and human acceptance remain open.

### 18. P1 — Preserve independent commercial evidence rails

Observed seam: lifecycle, delivery, customer view, decision, payment, booking,
and operations readiness can appear near one another without a cross-route
promise that they will remain independent.

Design contract: present these as separate evidence rails. Every transition
names the before state, requested after state, declaring source, and unchanged
rails. Provider acceptance never means delivery; customer acceptance never
means booked; payment request never means paid; attention cleared never means
event-ready.

Observable operator outcome: one object can truthfully show several apparently
conflicting rail states at once, each with its own source and freshness, without
a synthetic **ready** summary hiding an unresolved commercial condition.

### 19. P2 — Add a selected-object relationship spine

Observed seam: deep routes do not always answer, in one quiet place, which
client, event, and quote the operator is working on and which layer is current.

Design contract: exact routes expose a compact verified relationship spine
using opaque IDs for navigation and human labels for orientation. Missing,
deleted, stale, or unauthorized links remain explicitly unavailable rather
than inferred from names or neighboring records.

Observable operator outcome: a two-line-or-less mobile spine answers **which
client, event, quote, and surface?** and each available relationship returns to
the exact opaque target with the recommendation 16 return contract.

### 20. P1 — Establish a canonical object signature

Observed seam: the same Rivera quote changes identity emphasis across Now,
Opportunities, Clients, detail, and contextual Library.

Design contract: introduce a presentation-only object signature carrying
organization ID, object kind and ID, event name, client name, and quote number.
Each route may compress it, but names never become identity and exact arrival
always resolves by opaque ID.

Observable operator outcome: duplicate-name fixtures remain distinguishable and
the same object presents the same identity order, target-aware accessible name,
and machine-readable kind/ID on every route without adding write authority.

### 21. P1 — Use one operator-facing date and time grammar

Observed seam: current captures mix `18:00`, `5:30 PM`, `2026-09-12`, and
`17:30` for staff-facing representations of related event facts.

Design contract: centralize date-only, local event-clock, and absolute
timestamp formatting in workspace presentation helpers. Human task surfaces
use friendly dates and 12-hour clocks; raw stored values appear only when
clearly labeled as saved-record evidence. Date-only and local event-clock
values never pass through timezone conversion.

Observable operator outcome: the same event date and clock read identically on
all four routes under UTC and the tenant timezone, while invalid values stay
explicitly **Not recorded** and source strings remain byte-equivalent.

### 22. P1 — Label lifecycle, attention, relationship, and evidence domains

Observed seam: **Needs you**, quote lifecycle chips, **Upcoming event on
file**, and read freshness are truthful but visually adjacent state types with
no shared semantic domain label.

Design contract: every status declares one domain from an extensible shared
registry. The minimum current set is `quote-lifecycle`, `task-attention`,
`relationship-context`, `provider-acceptance`, `message-delivery`,
`portal-view`, `customer-decision`, `payment`, `booking`,
`operations-readiness`, and `view-availability`. Extend shared status semantics
instead of creating route-local meanings. Color may support a state but never
carries it alone.

Observable operator outcome: staff can distinguish lifecycle from attention,
relationship, payment, and freshness in text, monochrome, forced colors, and
assistive output; an unknown raw state is never silently mapped to a known one.

### 23. P1 — Extend one read-state and recovery contract to every Calm Four route

Observed seam: Now and Opportunities use the common recovery surface, Library
has a separate state component, and the Clients error/stale path can describe
refresh without placing the recovery control beside the consequence.

Design contract: all four routes share `loading`, `refreshing`, `empty`,
`partial`, `stale`, `unavailable`, and `success`. Empty is a completed result;
unavailable is not empty. A failed refresh preserves the last complete view
when one exists and offers one outcome-led retry in place.

Observable operator outcome: every route answers whether data is still loading,
complete, incomplete, old, or unavailable; retry remains beside the consequence
and a failed refresh never erases a usable last-complete view or claims zero
work.

### 24. P2 — Give imagery a truthful route role

Observed seam: the same wedding-table asset is the primary image on Now,
Clients, and an exact opportunity. Repetition weakens route identity and can
make decorative hospitality art look like recorded event media.

Design contract: every image declares a media role and kind. Generic
hospitality art is decorative atmosphere. Exact-event imagery appears only
with tenant-scoped source evidence; otherwise remove it from object-specific
identity or label it illustrative. All imagery reserves intrinsic space and
meaningful work remains complete when images fail.

Observable operator outcome: disabling or failing imagery changes neither
identity nor the next useful action, and no decorative asset can be mistaken for
recorded evidence about the selected event.

## Delivery order

1. Treat prior recommendations 15 and 16 as dependencies; do not reopen their
   authority or count them as delivery in the recommendation 17 commit.
2. Complete recommendation 17 adapter-by-adapter, then implement 18 so task,
   return, feedback, and independent evidence form one operational spine.
3. Implement 20–23 next: canonical identity, temporal grammar, state domains,
   and recovery make that spine legible across all four routes.
4. Complete 9, 10, 12, 13, 19, and 24 as the presentation-cohesion pass once
   the underlying contracts are stable.

Each numbered item is one bounded, independently reviewable commit unless a
planner proves two items share one inseparable contract. The executable gates
live in
[`staff-app-ui-cohesion-acceptance-matrix.md`](../acceptance/staff-app-ui-cohesion-acceptance-matrix.md).
