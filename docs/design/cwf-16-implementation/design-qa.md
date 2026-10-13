# CWF-16 Design QA

Last updated: 2026-09-04 23:41:46 CDT

## Inputs

- Source concept: `docs/design/cwf-16-event-workspace-concept.png`
- Implemented desktop viewport: `docs/design/cwf-16-implementation/desktop.png`
- Implemented desktop full view: `docs/design/cwf-16-implementation/desktop-full.png`
- Implemented mobile viewport: `docs/design/cwf-16-implementation/mobile.png`
- Combined comparison input: `docs/design/cwf-16-implementation/source-vs-implementation.png`

## Render conditions

- Source pixels: 1672 x 941.
- Desktop CSS viewport and output pixels: 1440 x 900 at device scale factor 1.
- Desktop full-page output pixels: 1440 x 1365 at device scale factor 1.
- Mobile CSS viewport and output pixels: 390 x 844 at device scale factor 1.
- Route/state: `/app/quotes/home-money-quote`, browser-local accepted quote, admin E2E session, customer-centered workspace flag on.
- Density: desktop Chrome and mobile responsive layout, no display scaling.

## Comparison

The implemented route preserves the selected concept's event-first hierarchy:
event identity and lifecycle status, the bounded current condition, one explicit
next action, five operational context cards, sold scope, and lifecycle. The
merged intelligence direction adds one calm decision-support band without
turning raw deterministic signals into a second dashboard. It also preserves
QuotePilot's production staff shell and existing typography, neutral surface,
gold action, sage status, spacing, border, and radius language.

Intentional source-to-build differences:

- The concept's fabricated guest-count task was replaced by the real bounded Workflow/quote condition. An empty queue explicitly says it is not evidence of event readiness or completion.
- The intelligence band reuses existing proposal completeness and Workflow
  facts. Flexibility and Alignment are explicitly unavailable because their
  required authority contracts do not exist; the collapsed `Why?` disclosure
  keeps stable reason codes and evidence bounds available without overwhelming
  the first scan.
- Notes and attachments were omitted because CWF-16 adds no new data authority for them.
- Accepted/booked records omit ordinary Edit and route to existing quote administration; draft/sent/viewed records retain the existing role and delivery-lock edit gate.
- Production/BEO copy identifies browser-local output as having no server receipt, while Firebase-backed records retain the authoritative BEO status surface.
- The real QuotePilot header and workspace status strip remain in place instead of the concept-only navigation.

## Findings and iteration history

- P1 fixed: the initial focused render could place the event title under the sticky header. Added route scroll margin and verified a top-of-page capture.
- P1 fixed: an accepted quote with no recorded sent timestamp displayed a completed marker with `Pending`. It now displays `Date not recorded`.
- P2 fixed: repeated `More quote actions` labels created an ambiguous accessible locator. The persistent top action is now `Quote administration`; the next-action link retains the workflow-derived label.
- P2 fixed: rental quantities were initially described as selected items. They now distinguish line items from quoted units.
- P2 fixed: generic BEO copy did not expose the local authority boundary. The local context card now says `Download browser-local BEO — no receipt`.
- P2 fixed: intelligence initially risked overstating proposal completeness as
  event readiness. The dimension is now titled `Proposal readiness`, carries a
  `Proposal completeness only` boundary, and keeps unsupported conclusions
  unavailable.
- P2 fixed: raw intelligence evidence could have competed with the event record.
  It now lives behind one native, keyboard-operable `Why?` disclosure.
- Final combined visual review found no remaining P0, P1, or P2 mismatch against the approved direction.

## Interaction and runtime checks

- Back to Quotes returns to `/app/quotes`.
- Draft Edit quote uses the existing edit callback and permission/delivery-lock boundary.
- Schedule and Customer shortcuts route through existing workspace callbacks.
- Rentals focuses sold scope; Production/BEO and PDF reuse existing artifact handlers.
- Exact Workflow attention opens the existing Workflow target.
- `Why?` expands the deterministic reason codes and evidence bounds, then
  collapses without changing the quote or triggering a network action.
- Accepted quote does not expose ordinary Edit.
- Mobile viewport has no document-level horizontal overflow.
- Playwright recorded no page errors or console errors during the full route interaction.

Final result: passed

## Client 360 presentation convergence addendum

The selected relationship-led composition is implemented over the existing
Customer 360 DTO and exact-arrival behavior. Identity and the supported next
decision lead; existing Client, Opportunity, Proposal, and Event facts form the
relationship spine; and recorded lifecycle/request history follows. A
same-quote, same-timestamp request and conversation summary is presented once.
Conversations, source detail, additional opportunities, and the detailed record
remain progressively disclosed. Focused unit coverage passes 16/16 and the
390/768/1440 Chromium-admin matrix passes 3/3 with no persisted quote/history
change, no horizontal overflow, 44px targets, layout containment, and zero
scoped axe violations. The selected visual and exact implementation were
inspected together at a local 9.5/10. No customer, activity, urgency, route,
lifecycle, message, payment, booking, provider, or mutation authority changed.
