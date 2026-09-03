# QuotePilot Staff-App UI Cohesion Acceptance Matrix

Last updated: 2026-09-03 02:54:22 CDT

## Purpose and verdict

This is the executable acceptance contract for the recommendations in the
[staff-app UI cohesion audit](../design/staff-app-ui-cohesion-audit.md). It is a
delivery gate, not evidence by itself. In the current commit, only
recommendation 17 changes: it adds the same-runtime foundation and the tracked
Workflow follow-up adapter. Recommendations 15 and 16 are prior branch work;
9, 10, 12, 13, and 18–24 receive no runtime implementation in this commit.
Recommendation 17 therefore remains open until the other consequential staff
mutations are migrated in later bounded commits.

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
   and 200% zoom pass. Axe reports zero violations inside every changed or
   audited surface; whole-page scans report no serious or critical violations,
   and any lower-impact pre-existing finding is recorded with no regression.
   Actual screen-reader comprehension remains **HOSTED/MANUAL REQUIRED** until
   performed.
5. **State truth:** the new presentation or return layer adds no quote, client,
   catalog, history, pricing, workflow, or provider write authority. Ordinary
   non-expiry fixtures retain byte-equivalent persisted snapshots and issue no
   unexpected non-GET request. If an existing read owns a lifecycle mutation—
   currently the admin quote-history read's automatic expiry reconciliation—
   including local-fallback normalization/versioning, isolate and disclose it,
   prove its authority is unchanged, and never relabel the overall read path as
   universally write-free.
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
11. **Post-change freshness:** execute every claimed automated gate after the
    last source, test, and contract edit. Earlier green runs and screenshots are
    superseded; they may explain history but cannot confer **PASS** on the final
    candidate.
12. **Atomic scope:** the commit contains only the named recommendation slice
    and its tests/contracts. A partially migrated family cannot be described as
    the completed recommendation, and unrelated working-tree changes remain
    outside the candidate.

Any failed or unexecuted applicable criterion blocks **PASS**. A prose review,
visual approval, broad suite pass, or exact happy-path result cannot waive a
missing race, failure, authorization, privacy, responsive, or accessibility
gate.

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
destination readiness and completion. The resolved branch is unit-covered only
after a Firebase result and exact server-only same-organization readback match
the returned follow-up, yield one bounded internal completion confirmation, and
remove the exact item from fresh Attention. The failure branch is proofless and
never retries the write.

Five focused Chromium cases exercise Now at 390px, Opportunities at 768px,
Client 360 at 1440px, a desktop dirty-draft guard, and one intentional
browser-local completion. The first four verify source-specific action IDs,
one exact Rivera Workflow focus tuple, acknowledgement within 250ms,
principal-bound session reload, Back/Forward continuity, 44px controls, no
chrome collision or horizontal overflow, and byte-equivalent browser-local
quote/history/catalog state with no non-GET request. The fifth proves the named
local quote/version-history save becomes **Needs confirmation**, retains null
proof and exact task identity, offers a read-only retry, changes no catalog or
provider state, and never renders **Completed**. The full
three-source-by-three-viewport matrix, connected authorization/provider proof,
real authoritative readback, cross-route source invalidation, remaining
failure fixtures, and assistive-technology comprehension remain open.

- Start exact ranked tasks from Now, Opportunities, and Client 360; each lands
  on the expected opaque object ID and exposes **in progress** within 250ms.
- Open, cancel, Back, Forward, and inspect produce zero business writes. A task
  resolves only after the existing authoritative receipt or confirmation
  appropriate to that capability plus same-tenant readback; all source
  projections then update consistently.
- The exact follow-up adapter accepts only the matching source task, focus,
  organization, three-field confirmation proof, and a current signed-in
  principal. Local, failed, denied, stale, mismatched, or malformed readback
  keeps null proof and **Needs confirmation**. Its retry performs a read only;
  a second write requires a separate deliberate operator action.
- Confirmation remains bound to the exact successful Firebase write fields and
  task generation across retries. A later matching record cannot promote a
  browser-local save, and a delayed readback cannot resurrect a task after
  **Stop tracking** or replace the newer task that superseded it.
- A deferred write/readback owns an immutable attempt selector. Restarting the
  same task with a new generation, changing focus, switching an authorized
  workspace branch, unmounting Workflow, or changing organization/principal/
  role cannot retarget its transition or task callback. Late work settles only
  its original attempt when that provider/scope still exists; otherwise it is
  ignored without readback, task completion, or new-scope feedback.
- Timeout, conflict, offline, permission, cross-tenant, malformed, and stale
  task fixtures retain the task/draft and show the next safe recovery action.
- Destination heading focus occurs only after exact-object resolution; one
  assistive announcement names the task and target. Mobile action/focus targets
  remain clear of fixed navigation.

### 16. Preserve the operator's place — P1

Implementation checkpoint: **17/17** local Chromium-admin scenarios exercise
the exact Opportunities, Clients, and Library round trip at 390×844, 768×900,
and 1440×1000, plus real Clients pagination, Client 360, nested contextual
Library, a three-second delayed quote read, two reload boundaries, invalid and
foreign recovery, and an adversarial dirty-Library-editor sequence. The nine
responsive cases assert the exact native Back/Forward entry, opaque object/
editor identity, originating focus target, disclosure state, settled scroll
within 8px, allowlisted URL filters, 44px controls, at most 1px horizontal
overflow, one `main`/H1 with ordered group headings, and zero scoped Axe
violations on each restored route surface. Destination pages have no serious
or critical Axe violation.

The reload case proves Clients retains only its allowlisted `view` enum while
free-text search is absent from the URL, native history token, and non-business
local/session storage and clears with a quiet explanation. Unit coverage rejects
forged, non-adjacent, stale-runtime, cross-organization, cross-principal,
unknown-route, and invalid-query tokens. The Library guard case proves a direct
browser Back plus **Keep editing** retains the exact editor, entry, and private
draft; accepted discard returns to Library without a write; Forward reopens the
exact template from persisted data; and the discarded draft never enters
history state. Owner-keyed guard coverage proves a temporary overlay cannot
silently remove the underlying Library guard.

Non-expiry fixtures retain byte-equivalent quote/history/catalog state and issue
no unexpected non-GET request. The return-context layer adds no write authority;
the pre-existing admin quote-history read may still persist automatic expiry
under its existing lifecycle authority, including local-fallback normalization
and versioning. This checkpoint is local Chromium evidence only. The 200% zoom,
forced-colors, Firefox, WebKit, real assistive-technology, authenticated hosted-
data, deployment, and human-comprehension portions of the shared gate remain
**HOSTED/MANUAL REQUIRED** and are not promoted by these results.

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

Implementation boundary: the current candidate establishes the pure
presentation contract, scope-bound provider, Calm Four visual region, shared
continuity stack, and the first adapter for exact tracked Workflow follow-up
completion. It does **not** migrate Quick Updates, Catalog, or the remaining
staff mutations, so recommendation 17 remains open.

Current post-runtime-edit local evidence is green: the six focused registry,
provider, presentation, Workflow, authorized-route, and App recovery files pass
**127/127** assertions; the full unit suite passes **4,360** assertions with 78
intentional skips; and the dedicated Chromium-admin matrix passes **3/3** cases
at 390×844, 768×900, and 1440×1000 with
`VITE_E2E_LOCAL_REVIEW_FIXTURES=false`. Now, Opportunities, and Client 360 are
the three exact task sources. Twelve fresh state captures and three matching
before/after comparison boards were inspected after fonts and paint settled;
the final visual review found no blockers after tablet focus clearance,
desktop header overlap, focus paint, and disabled-action hierarchy were
corrected. The immutable SHA, completion-plan timestamp, and post-contract
repository checks belong to the completion handoff, so this paragraph is not a
self-referential commit claim. Connected Firebase, hosted/provider,
production, cross-browser, maximum-copy, 200% zoom, forced colors, reduced
transparency, actual assistive technology, and human comprehension remain
separate open evidence classes. Recommendation 17 remains partial until the
other consequential staff mutations are migrated.

Current verdict: **PARTIAL — local automated candidate only**. The executed
source, unit, Chromium, visual-comparison, governance, and build gates may be
reported individually after their final rerun. Under the shared rule above,
the unexecuted zoom, forced-color, reduced-transparency, cross-browser,
assistive-technology, hosted, production, and human gates block an overall
**PASS** and cannot be waived by this commit.

- Starting the adapted follow-up action publishes `pending` synchronously and
  makes visible plus accessible acknowledgement available within 250ms. The
  affected Workflow region and shared feedback region expose `aria-busy` while
  the request is single-flight; a second write cannot start.
- Invalid stage/date preflight fails before feedback creation and before write
  dispatch, focuses or identifies the invalid field, and emits exactly one
  bounded local error. If the shared registry cannot begin, the adapter retains
  one accessible local feedback path, never renders the thrown provider text,
  and cannot duplicate the shared announcement.
- Every registry record and transition must match the exact organization,
  principal, role, action ID, attempt ID, generation, object kind, and object
  ID. Acknowledgement additionally carries the exact record revision. A
  mismatch, stale generation or revision, duplicate attempt, malformed
  selector, or foreign scope leaves the current record unchanged and never
  updates a nearby action.
- The adapter stores one immutable operation identity per dispatch. Task/focus
  restart cannot replace that selector or unlock another save while it is in
  flight. A delayed result may update only its originating attempt and may not
  close, announce, or focus a newer task generation.
- The only phases are `pending`, `succeeded`, `recovery`, `uncertain`, and
  `cancelled`. Terminal records cannot be reopened. Only `uncertain` may return
  to `pending`, and only for read-only reconciliation of the same exact attempt
  and generation. `uncertain` cannot be acknowledged, dismissed, evicted, or
  converted directly to evidence-free `recovery`; only authoritative
  reconciliation or cancellation can remove its duplicate-write fence.
- The bounded registry may evict only the oldest terminal presentation record.
  It preserves every `pending` or `uncertain` record; four unresolved records
  make the next begin fail explicitly. An unresolved `pending` or `uncertain`
  attempt for the same action/object blocks a new generation and the mutation
  spy remains at one call.
- `succeeded` requires the existing capability's bounded definitive evidence.
  For the first adapter that means the successful Firebase result, matching
  same-organization server-only follow-up readback, and fresh Attention
  absence. If the attempt still owns the exact Current task, App must persist
  its closure before Workflow renders **Confirmed**. An older feedback attempt
  may reconcile independently after exact proof, but it cannot mutate a newer
  or missing Current task or claim **Current task marked completed**. A
  receipt/readback for a different object, task, tenant, generation, or field
  set is rejected.
- Timeout, offline, permission denial, conflict, stale or deleted object,
  mismatched readback, invalid proof, late response, provider-shaped error, and
  ambiguous dispatch never use success styling or copy. If dispatch may have
  occurred, the state is `uncertain`, the original write stays frozen, entered
  values remain intact, and the one offered resolution is a read-only exact
  inspection or reconciliation—not automatic or manual duplicate submission.
- If Workflow unmounts while a dispatched attempt is pending but the scoped
  provider survives, cleanup moves that exact attempt to `uncertain` before the
  surface disappears. Its eventual promise cannot perform readback or invoke a
  task callback. A staff-email/actor change inside the retained provider does
  the same and clears that abandoned attempt's exact busy key before another UI
  action is considered. If the provider/scope also unmounts, the late promise
  is simply ignored and cannot leak into the next authenticated scope.
- `recovery` names what changed and what remained unchanged, preserves the
  operator's values, and renders at most one safe acknowledge, inspect,
  reconcile, or return action beside the message. `cancelled` is accepted only
  for a pre-dispatch cancellation or an authoritative cancellation basis;
  **Stop tracking** of the independent task rail cannot create cancelled
  mutation feedback.
- Same-runtime route changes retain the exact feedback across both authorized
  workspace branches. Terminal feedback remains until an exact
  revision-matched acknowledgement; uncertainty remains until authoritative
  reconciliation or cancellation and cannot be cleared as presentation state.
  Full reload clears same-runtime feedback. Organization, principal, or role
  change invalidates the entire prior scope before the new workspace renders,
  while portal, unresolved-auth, customer, and denied-role branches never mount
  the provider.
- An `uncertain` record may expose only `inspect` or `reconcile`; missing or
  acknowledgement-shaped actions fail closed. A malformed `recovery` without
  its safe next action also renders no fallback Dismiss. Successful terminal
  dismissal requires the exact record revision and restores focus to the prior
  connected control or a stable active workspace target rather than dropping
  focus to the document body.
- When an uncertain follow-up is already complete and therefore absent from
  Attention, **Review exact follow-up** still returns to and focuses its exact
  `data-follow-up-record-id`, including after the operator chose **Stop
  tracking**. It never substitutes an Attention row or first visible record.
  At least 44px of that focused record and its focus paint remain visible below
  the sticky continuity stack. Only after this exact route, record, and focus
  resolve may the shared return action become inactive; the unresolved record
  and duplicate-write fence remain, and the local read-only **Retry
  confirmation** becomes the sole resolution control.
- Exactly one `aria-live="polite"`, `aria-atomic="true"` shared announcement is
  emitted for each accepted state change. The visual feedback region itself is
  not live, identical transitions deduplicate, and adapted component-local
  consequential toasts/status/alerts do not repeat the message. The independent
  Current task rail remains non-live. Exact revision-matched acknowledgement
  clears its own stale announcement without re-announcing a queued record or
  erasing a newer live announcement; a late acknowledgement is rejected.
- The region exposes exact `data-action-feedback-phase`,
  `data-action-feedback-action-id`, `data-action-feedback-attempt-id`,
  `data-action-feedback-object-kind`, and `data-action-feedback-object-id`
  markers. Tests assert the marker identity and `aria-busy` state rather than
  relying on color or prose alone.
- At 390×844, 768×900, and 1440×1000, the feedback and Current task rails form
  one non-overlapping continuity stack; enabled controls and focus paint remain
  clear of the desktop rail, tablet header, mobile bottom navigation, and each
  other. The page has at most 1px unintended horizontal overflow, each action is
  at least 44×44px, long maximum-copy fixtures wrap without mid-word identity
  breaks, and the contract remains usable at 200% zoom, with forced colors and
  reduced motion/transparency. Desktop identity stays on one readable line;
  tablet uses the verified stacked identity treatment; mobile gives the
  feedback action hierarchy over the compact non-live task rail.
- The registry is presentation-only and same-runtime. It reads or writes no
  browser storage, business record, provider, or network endpoint. The Workflow
  adapter must pass only product-owned fixed labels/messages/facts and opaque
  IDs; source and rendered-output assertions keep its raw follow-up note,
  customer/staff email, thrown provider text, token-like values, and raw record
  absent. The generic registry additionally rejects unexpected fields,
  recognizable sensitive/error patterns, control/bidirectional characters,
  oversized values, and opaque blobs. That classifier is defense in depth, not
  a provenance proof for arbitrary normal prose; every later adapter must earn
  the same source-level fixed-copy evidence before migration.

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
- Each rendered rail exposes its domain, raw state, source, freshness, and
  availability through stable markers and an accessible group label. Pairwise
  fixture tests vary one rail at a time and assert every other rail and persisted
  record remains byte-equivalent.

### 19. Add a selected-object relationship spine — P2

- At the default 390px mobile viewport, exact quote/client/event routes display
  the verified relationship in no more than two compact lines plus a clearly
  named current surface. At 200% zoom the spine may reflow vertically without a
  line cap; identity, controls, and text must remain complete and unclipped.
- Same-name fixtures link only by opaque IDs. Missing, deleted, stale, or
  unauthorized relationships render unavailable and never infer from prose,
  email, list order, or proximity.
- The spine is a labelled navigation/region, uses `aria-current`, exposes 44px
  interactive targets, and remains complete at all widths and 200% zoom.
- Return behavior obeys recommendation 16 and navigation/inspection produces
  zero writes.
- Keyboard activation of each relationship resolves and focuses the exact
  opaque destination before announcing it. A delayed or failed relationship
  read keeps the current object's signature visible and provides one recovery
  action without shifting to a sibling record.

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
- One shared formatter/component contract owns field order, truncation, and
  accessible description. Snapshot plus browser assertions compare its exact
  signature across all route representations; route-local identity assembly is
  a failing condition.

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
- Unit fixtures cover date-only, local-clock, absolute-instant, leap-day, DST
  boundary, invalid, and absent values. Browser tests assert the accessible
  `<time>` value and visible grammar, not only a screenshot or locale-dependent
  substring.

### 22. Label state domains — P1

- `draft`, `sent`, `viewed`, `accepted`, `booked`, `declined`, and unknown
  fixtures produce the same lifecycle label/family wherever lifecycle appears.
- Every displayed state exposes a machine-readable `data-status-domain` and
  raw state. Unknown values say **Not recorded** or **Needs review**, never an
  inferred classification.
- The shared registry covers, at minimum, lifecycle, task attention,
  relationship context, provider acceptance, message delivery, portal view,
  customer decision, payment, booking, operations readiness, and view
  availability. Every domain remains understandable with color disabled, in
  forced colors, at 200% zoom, and in monochrome captures.
- Presentation changes no record, authorization check, recommendation, or
  lifecycle transition.
- A finite shared domain/state registry rejects unsupported combinations in
  component tests. Route-local labels cannot redefine a raw state, and one
  domain's severity styling cannot become another domain's meaning.

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
- Race fixtures resolve requests out of order, navigate during refresh, change
  scope, and unmount the route. An older or foreign response cannot overwrite a
  newer complete view, clear its recovery, announce into the next route, or
  substitute another tenant's data.

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
- A source-level allowlist distinguishes decorative, illustrative, and
  tenant-recorded media. Recorded media without a tenant-scoped source marker
  fails closed to the non-evidentiary fallback; CSS background art can never
  carry unique object identity or required alt content.

## Completion record required per slice

Each implementation commit must update this matrix with its verdict and exact
evidence, update the design contract and changelog, and run its focused tests,
the current Calm Four browser suite, `npm run test:unit`, `npm run check:env`,
`npm run build`, `npm run check:capability-surfaces`,
`npm run test:rules:firestore`, `npm run check:docs:governance`,
`npm run check:project-state`, and `git diff --check`. The completion handoff
must record the planner's exact UTC `recordedAt`, changed files, test counts,
screenshots inspected, unproven evidence classes, and residual risks. A check
run before the final source or contract edit must be rerun; a commit must not
inherit a green result from its predecessor.
