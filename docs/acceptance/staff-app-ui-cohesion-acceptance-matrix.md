# QuotePilot Staff-App UI Cohesion Acceptance Matrix

Last updated: 2026-09-02 21:29:22 CDT

## Purpose and verdict

This is the executable acceptance contract for the open recommendations in the
[staff-app UI cohesion audit](../design/staff-app-ui-cohesion-audit.md). It is a
  future-delivery gate, not evidence that recommendations 9, 10, 12, 13, or
  the unfinished portions of 15–24 are implemented.

Use only these verdicts:

- **PASS** — every applicable local automated criterion is tied to the exact
  candidate SHA and no required local criterion is missing;
- **BLOCKED** — an applicable criterion cannot be executed without a named
  missing dependency or decision;
- **HOSTED/MANUAL REQUIRED** — local criteria pass, but hosted data, an actual
  assistive technology, device behavior, or human comprehension still needs a
  separate receipt; and
- **NOT APPLICABLE** — the accepted design explicitly omits that behavior.

A screenshot can support visual review but cannot prove persistence,
authorization, delivery, payment, or save success.

## Formidable shared gate

Every implementation slice must satisfy all applicable shared criteria before
its commit is described as complete:

1. **Exact candidate:** record the immutable SHA, feature-gate profile, fixture
   revision, browser/project, command, result counts, and UTC timestamp.
2. **One fixture family:** use the same Rivera records across Now,
   Opportunities, Clients, detail, and Library, plus duplicate-name,
   contradictory-state, stale-read, invalid-time, maximum-copy, failed-image,
   admin, sales, and foreign-tenant variants as applicable.
3. **Responsive geometry:** exercise 390×844, 768×900, and 1440×1000. Document
   and audited surfaces have at most 1px unintended horizontal overflow;
   controls and focus paint stay contained; actionable targets are at least
   44×44px.
4. **Accessibility:** keyboard order, Escape/back behavior, focus arrival and
   return, labelled regions, live-region count, reduced motion, forced colors,
   and 200% zoom pass. Axe reports zero violations. Actual screen-reader
   comprehension remains **HOSTED/MANUAL REQUIRED** until performed.
5. **State truth:** navigation, inspection, formatting, disclosure, filtering,
   recovery display, and imagery perform zero quote, client, catalog, history,
   pricing, workflow, or provider writes. Persisted before/after snapshots and
   mutation spies prove zero rather than inferring it from the UI.
6. **Mutation truth:** where a slice invokes existing mutation authority,
   pending is single-flight, success requires the definitive receipt plus
   authoritative same-tenant readback, and ambiguous outcomes never render as
   success.
7. **Failure coverage:** missing ID, stale revision, deleted object,
   cross-tenant target, denied role, offline read, timeout, conflict, and
   malformed arrival recover without substitution, leakage, or draft loss.
8. **Immediate acknowledgement:** a deliberate action exposes visible and
   accessible acknowledgement within 250ms in the local fixture; final success
   may wait for authority.
9. **Same-state visual proof:** capture four routes × three widths after fonts,
   imagery, and paint settle. Inspect all accepted captures; a passing
   screenshot set remains supporting evidence, not the verdict by itself.
10. **Proof boundaries:** local source, local automated, local connected,
    hosted, production, provider, assistive-technology, and human evidence stay
    separate. No lower evidence class promotes a higher one.

## Open recommendation criteria

### 9. Normalize page frames — P2

- Now, Opportunities, Clients, and Library use one declared canvas-width,
  outer-edge, global-chrome offset, and masthead alignment contract at all
  three widths; route-specific composition may vary only inside that frame.
- Automated geometry compares the same named anchors across all four routes
  with a maximum 2px unexplained delta per breakpoint.
- Route heading focus paint, **New quote**, desktop rail/top bar, and mobile
  bottom navigation never overlap the frame or create horizontal overflow.
- Browser Back/Forward and role-filtered Library presence do not change the
  frame origin or cause a visible layout jump.

### 10. Moderate mobile editorial type — P2

- Longest event, client, and empty-state fixtures remain readable at 390px and
  200% zoom with no clipped glyphs, orphaned one-word lines, or horizontal
  scrolling.
- A route's identity and first useful action remain discoverable in the first
  useful viewport; typography never displaces required state or recovery.
- Headline sizing comes from shared tokens with a documented minimum and
  maximum, not per-record or per-route inline overrides.
- Reduced motion and delayed font loading produce no more than 1px audited
  horizontal movement and never reveal a partially clipped action label.

### 12. Unify search behavior — P2

- The global search and Clients search share query normalization, submission,
  clear, loading, empty, partial, error, and retry language while retaining
  their different result scopes.
- The same client query returns the same ordered client identities in both
  surfaces; the global surface may add exact opportunities but cannot reorder
  or rename the matching client records.
- Empty query, no result, unavailable read, and cleared filter are four
  distinct states. No surface reports **no results** before a completed read.
- Free text remains session-only, is absent from durable URLs/storage, and
  produces zero writes. Results remain tenant- and role-scoped under duplicate
  names and foreign-tenant fixtures.
- Enter, Escape, clear, result arrival, Back, and focus restoration pass by
  keyboard at every width with one live announcement per state change.

### 13. Standardize evidence disclosures — P2

- **About this view**, browser-local state, freshness, and source notes use one
  disclosure anatomy, vocabulary, icon policy, and focus behavior across the
  four routes.
- Critical recovery, authorization denial, dirty-draft protection, and the
  dominant next action never live only inside a collapsed evidence disclosure.
- Each disclosure exposes a unique accessible name tied to its route/object;
  expanded state is programmatic and focus remains on the trigger unless the
  user deliberately enters its content.
- Long source/freshness copy wraps without overflow at all widths and 200%
  zoom. Formatting or toggling a disclosure performs zero reads or writes.

### 15. Close the cross-route task loop — P1

Implementation checkpoint: pure contract and component coverage verifies exact
source identity, principal/role/tenant binding, full-focus matching, visible
**In progress** presentation, context recovery, and the distinction between
destination readiness and completion. Four focused Chromium cases now exercise
Now at 390px, Opportunities at 768px, Client 360 at 1440px, and a desktop
dirty-draft guard. They verify source-specific action IDs, one exact Rivera
Workflow focus tuple, acknowledgement within 250ms, principal-bound session
reload, Back/Forward continuity, 44px controls, no chrome collision or
horizontal overflow, and byte-equivalent browser-local quote/history/catalog
state with no non-GET request. The full three-source-by-three-viewport matrix,
connected authorization/provider proof, authoritative outcome/readback and
source invalidation, failure fixtures, and assistive-technology comprehension
remain open.

- Start exact ranked tasks from Now, Opportunities, and Client 360; each lands
  on the expected opaque object ID and exposes **in progress** within 250ms.
- Open, cancel, Back, Forward, and inspect produce zero business writes. A task
  resolves only after the existing authoritative outcome receipt and
  same-tenant readback; all source projections then update consistently.
- Timeout, conflict, offline, permission, cross-tenant, malformed, and stale
  task fixtures retain the task/draft and show the next safe recovery action.
- Destination heading focus occurs only after exact-object resolution; one
  assistive announcement names the task and target. Mobile action/focus targets
  remain clear of fixed navigation.

### 16. Preserve the operator's place — P1

- Round trips from Opportunities, Clients, and Library restore safe structured
  filters, ordering, disclosure, focus target, and scroll within 8px.
- Browser Forward reopens the same exact detail; reload preserves only
  allowlisted URL-safe enums/dates and clears free text with a quiet
  explanation.
- Invalid or foreign origin context falls back to the canonical route and is
  announced once; it never selects a nearby record.
- Dirty drafts invoke the existing guard before navigation and restore the
  exact origin after **Keep editing**. All return controls meet the 44px,
  keyboard, 200% zoom, and focus-paint gates.

### 17. Use one durable action-feedback contract — P1

- Every applicable mutation renders `pending`, `succeeded`, `recovery`,
  `uncertain`, or `cancelled` within 250ms and marks its affected region
  `aria-busy` during a single-flight request.
- Success appears only after definitive receipt/readback. Conflict, offline,
  timeout, permission, and ambiguous fixtures never use success styling or
  copy.
- Recovery preserves entered values, names what did not change, and keeps one
  safe retry or return action beside the message.
- Route-changing handoffs retain the feedback until acknowledged or resolved;
  one atomic live announcement fires and focus moves only when task completion
  requires it.

### 18. Preserve independent commercial evidence rails — P1

- Fixture matrices render quote lifecycle, provider acceptance, delivery,
  portal view, customer decision, payment, booking, and operations readiness
  in the same label/order grammar across applicable routes.
- A contradictory fixture can show **accepted**, **deposit unpaid**,
  **follow-up overdue**, and **read evidence stale** simultaneously; no summary
  collapses these to **ready**, **paid**, or another invented conclusion.
- Every transition review names before, requested after, declaring source, and
  unchanged rails. Unavailable states retain their exact reason instead of
  becoming null or a generic warning.
- Role, tenant, revision, and receipt gates are rechecked at execution. The
  presentation layer has no mutation authority and cannot promote sent to
  delivered, accepted to booked, requested to paid, or cleared to event-ready.

### 19. Add a selected-object relationship spine — P2

- Exact quote/client/event routes display the verified relationship in no more
  than two compact mobile lines plus a clearly named current surface.
- Same-name fixtures link only by opaque IDs. Missing, deleted, stale, or
  unauthorized relationships render unavailable and never infer from prose,
  email, list order, or proximity.
- The spine is a labelled navigation/region, uses `aria-current`, exposes 44px
  interactive targets, and remains complete at all widths and 200% zoom.
- Return behavior obeys recommendation 16 and navigation/inspection produces
  zero writes.

### 20. Establish a canonical object signature — P1

- Two same-tenant quotes with identical event names but different IDs are
  captured on all applicable routes and always expose the same
  `data-workspace-object-id` and `data-workspace-object-kind`.
- Event name plus at least one human disambiguator remains visible without
  clipping. Quote number may be visually quiet on mobile but remains in the
  accessible description and arrival contract.
- Every action's accessible name identifies its target; destination focus
  resolves only after the requested opaque ID loads.
- Missing-ID, stale, duplicate-name, cross-tenant, and denied-role fixtures
  recover rather than selecting by name or position. Navigation leaves quote,
  history, client, and catalog snapshots byte-equivalent.

### 21. Use one date and time grammar — P1

- A fixture storing `date: "2026-09-12"` and `time: "17:30"` renders semantic
  equivalents of **Sep 12, 2026** and **5:30 PM** across the four routes and
  exact detail at all widths.
- Compact tiles may omit the year visually, but their `<time>` accessible name
  exposes the full date; clock values use valid machine-readable `dateTime`.
- The matrix passes under UTC and America/Chicago, including DST boundaries.
  Date-only values cannot move a day and local event clocks cannot move an
  hour.
- Invalid or missing values say **Not recorded** and never guess a timezone.
  Persisted source strings remain byte-equivalent and formatting triggers no
  save, normalization, repricing, or scheduling mutation.

### 22. Label state domains — P1

- `draft`, `sent`, `viewed`, `accepted`, `booked`, `declined`, and unknown
  fixtures produce the same lifecycle label/family wherever lifecycle appears.
- Every displayed state exposes a machine-readable `data-status-domain` and
  raw state. Unknown values say **Not recorded** or **Needs review**, never an
  inferred classification.
- Lifecycle, task attention, relationship context, payment, and view
  availability remain understandable with color disabled, in forced colors,
  at 200% zoom, and in monochrome captures.
- Presentation changes no record, authorization check, recommendation, or
  lifecycle transition.

### 23. Extend one read-state and recovery contract — P1

- Exercise `loading`, `refreshing`, `empty`, `partial`, `stale`, `unavailable`,
  and `success` for Now, Opportunities, Clients, and Library at all widths.
- An unavailable first read shows title, consequence, unchanged-state
  boundary, and one enabled 44px retry in the first useful viewport.
- Failed refresh retains the last complete objects and labels them stale or
  partial; it never flashes an empty or caught-up claim and never substitutes
  another tenant's record.
- Loading announces once with `role=status`; failure announces once with
  `role=alert`; retry receives predictable keyboard focus without duplicate
  speech or raw provider error text.
- Retry invokes only the existing tenant-scoped read; all mutation spies remain
  zero.

### 24. Give imagery a truthful route role — P2

- Now, Clients, and exact opportunity captures cannot use one generic asset as
  an unlabeled primary hero on multiple routes.
- Every image declares `data-media-role` and `data-media-kind` and reserves
  intrinsic space through `width`/`height` or `aspect-ratio`; decoded imagery
  moves audited geometry no more than 1px.
- Decorative images use empty alt text and carry no unique identity or state.
  Recorded images use concise alt text plus a tenant-scoped source marker and
  never fall back to a public/untrusted URL.
- Slow-load, disabled-image, and 404 fixtures show no broken-image chrome,
  preserve complete identity/state/action content, and create no overflow.
- Selecting, failing, or replacing presentation media performs no upload,
  quote/client mutation, readiness inference, or provider call.

## Completion record required per slice

Each implementation commit must update this matrix with its verdict and exact
evidence, update the design contract and changelog, and run its focused tests,
the current Calm Four browser suite, `npm run test:unit`, `npm run check:env`,
`npm run build`, `npm run check:docs:governance`, and
`npm run check:project-state`. The completion handoff must record the planner's
exact UTC `recordedAt`, changed files, test counts, screenshots inspected,
unproven evidence classes, and residual risks.
