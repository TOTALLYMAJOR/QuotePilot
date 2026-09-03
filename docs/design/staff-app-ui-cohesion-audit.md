# QuotePilot Staff-App UI Cohesion Audit

Last updated: 2026-09-02 22:15:58 CDT

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
  cases, **4/4** focused task-journey browser cases, **73/73** focused
  task-journey/component tests, and **4,227/4,227** executed unit tests passing;
  and
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
| 15 | P1 | Close the cross-route task loop | Follow-up closure adapter implemented in the current local slice; 5/5 focused Chromium cases prove three-source continuity plus fail-closed browser-local completion. Connected Firebase readback and cross-route invalidation proof remain open. |

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

Observed seam: exact-object arrival is strong, but list filters, disclosure,
scroll, and focus do not yet share one return-context contract.

Design contract: distinguish object/task context from view context. Preserve
only safe structured filter, ordering, disclosure, scroll, and focus state.
Free-text search remains session-only and never enters a durable URL or
cross-session record.

### 17. P1 — Use one durable action-feedback contract

Observed seam: acknowledgements, inline messages, and recovery surfaces use
related language but do not yet expose one state machine across mutations.

Design contract: share `pending`, `succeeded`, `recovery`, `uncertain`, and
`cancelled` feedback. Feedback stays attached to the affected object, states
what changed and what did not, and presents the next safe action. Toasts remain
for low-consequence confirmation only.

### 18. P1 — Preserve independent commercial evidence rails

Observed seam: lifecycle, delivery, customer view, decision, payment, booking,
and operations readiness can appear near one another without a cross-route
promise that they will remain independent.

Design contract: present these as separate evidence rails. Every transition
names the before state, requested after state, declaring source, and unchanged
rails. Provider acceptance never means delivery; customer acceptance never
means booked; payment request never means paid; attention cleared never means
event-ready.

### 19. P2 — Add a selected-object relationship spine

Observed seam: deep routes do not always answer, in one quiet place, which
client, event, and quote the operator is working on and which layer is current.

Design contract: exact routes expose a compact verified relationship spine
using opaque IDs for navigation and human labels for orientation. Missing,
deleted, stale, or unauthorized links remain explicitly unavailable rather
than inferred from names or neighboring records.

### 20. P1 — Establish a canonical object signature

Observed seam: the same Rivera quote changes identity emphasis across Now,
Opportunities, Clients, detail, and contextual Library.

Design contract: introduce a presentation-only object signature carrying
organization ID, object kind and ID, event name, client name, and quote number.
Each route may compress it, but names never become identity and exact arrival
always resolves by opaque ID.

### 21. P1 — Use one operator-facing date and time grammar

Observed seam: current captures mix `18:00`, `5:30 PM`, `2026-09-12`, and
`17:30` for staff-facing representations of related event facts.

Design contract: centralize date-only, local event-clock, and absolute
timestamp formatting in workspace presentation helpers. Human task surfaces
use friendly dates and 12-hour clocks; raw stored values appear only when
clearly labeled as saved-record evidence. Date-only and local event-clock
values never pass through timezone conversion.

### 22. P1 — Label lifecycle, attention, relationship, and availability domains

Observed seam: **Needs you**, quote lifecycle chips, **Upcoming event on
file**, and read freshness are truthful but visually adjacent state types with
no shared semantic domain label.

Design contract: every status declares one domain: `quote-lifecycle`,
`task-attention`, `relationship-context`, `payment`, or `view-availability`.
Extend shared status semantics instead of creating route-local meanings. Color
may support a state but never carries it alone.

### 23. P1 — Extend one read-state and recovery contract to every Calm Four route

Observed seam: Now and Opportunities use the common recovery surface, Library
has a separate state component, and the Clients error/stale path can describe
refresh without placing the recovery control beside the consequence.

Design contract: all four routes share `loading`, `refreshing`, `empty`,
`partial`, `stale`, `unavailable`, and `success`. Empty is a completed result;
unavailable is not empty. A failed refresh preserves the last complete view
when one exists and offers one outcome-led retry in place.

### 24. P2 — Give imagery a truthful route role

Observed seam: the same wedding-table asset is the primary image on Now,
Clients, and an exact opportunity. Repetition weakens route identity and can
make decorative hospitality art look like recorded event media.

Design contract: every image declares a media role and kind. Generic
hospitality art is decorative atmosphere. Exact-event imagery appears only
with tenant-scoped source evidence; otherwise remove it from object-specific
identity or label it illustrative. All imagery reserves intrinsic space and
meaningful work remains complete when images fail.

## Delivery order

1. Implement 15–18 first: task continuity, return context, durable feedback,
   and independent evidence rails form the operational spine.
2. Implement 20–23 next: canonical identity, temporal grammar, state domains,
   and recovery make that spine legible across all four routes.
3. Complete 9, 10, 12, 13, 19, and 24 as the presentation-cohesion pass once
   the underlying contracts are stable.

Each numbered item is one bounded, independently reviewable commit unless a
planner proves two items share one inseparable contract. The executable gates
live in
[`staff-app-ui-cohesion-acceptance-matrix.md`](../acceptance/staff-app-ui-cohesion-acceptance-matrix.md).
