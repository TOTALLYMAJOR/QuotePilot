# Attendance Journey Research

Last updated: 2026-08-28 18:02:58 CDT

## Status

Mixed evidence. Repository behavior and current competitor documentation are
directly observed. Marketplace reviews and public practitioner discussions are
directional user evidence, not QuotePilot customer validation. Role emotions,
terminology preference, willingness to use a portal questionnaire, and the
commercial value of each proposed extra remain hypotheses until direct
interviews or product telemetry confirm them.

This document informs the architecture decision in
`docs/ATTENDANCE_STATE_ADR.md`. It does not claim that the proposed workflow is
implemented.

## Decisions this research informs

1. Whether QuotePilot needs a durable attendance model beyond the single saved
   `event.guests` integer.
2. Which count is allowed to drive pricing, staffing guidance, quantities,
   capacity checks, proposals, and Kitchen BEO output.
3. How a customer-supplied final count becomes a reviewed commercial change
   instead of an untracked overwrite.
4. Which actors may submit, review, apply, or consume attendance evidence.
5. Which first implementation slice creates visible user value without
   inventing confirmation or weakening current authority.

## Evidence boundary

### Repository facts

- `event.guests` is the current exact saved count used across pricing,
  proposal readiness, staffing guidance, capacity checks, exports, Kitchen BEO
  inputs, version comparison, and `fact.event.guest_count` dependency impact.
- CREATE already reads `exact`, `approximate`, and `range` guest-count phrasing.
  Approximate and ranged inputs produce a draft-only price band through the
  existing calculator, while saving still collapses to one exact
  `event.guests` value.
- Decision Debt already defines **Final guest count** as a constrained decision
  with a default seven-day lock window. It prioritizes an unresolved dependency;
  it is not the source of the count and does not prove customer confirmation.
- Commercial Change Authority already provides the safe mechanism for
  simulating, approving, applying, versioning, and receipting a guest-count
  change without splitting pricing authority.
- Kitchen BEO freshness already treats `fact.event.guest_count` as a named
  dependency. A changed count can invalidate the artifact, but the dependency
  graph itself does not prove that a count is final.
- The post-competitive design explicitly identified **uncertainty-typed facts**
  as missing product truth and described a future final-count due/true-up
  journey. That concept was partially implemented in CREATE and Decision Debt,
  but the durable bridge between them does not exist.

### Current external product patterns

- Tripleseat distinguishes anticipated `guest_count` from confirmed
  `guaranteed_guest_count`, exposes price per person, and uses expected count
  ahead of guaranteed count in its forecasting rules.
- Tripleseat's current task API uses `Confirm final guest count` as an example
  event task with an assignee, due date, priority, and completion evidence.
- Perfect Venue's pre-event questionnaire collects a confirmed final count and
  saves the response to the event instead of leaving it in an email thread.
- Caterease documentation distinguishes planned, guaranteed, and actual guest
  counts and can bind item quantities to the guaranteed count.
- Current review evidence consistently values ease of use, keeping event facts
  organized, quick client proposals, task support, and mobile usefulness. It
  also warns that high-detail products become costly when setup, navigation,
  message history, or mobile interaction is difficult.

Sources:

- Tripleseat Events API:
  https://support.tripleseat.com/hc/en-us/articles/212171807-API-Events-Endpoint
- Tripleseat Tasks API:
  https://support.tripleseat.com/hc/en-us/articles/40072031238807-API-Tasks-Endpoints
- Tripleseat closing workflow:
  https://support.tripleseat.com/hc/en-us/articles/28413029145623-Best-Practices-for-Closing-a-Booking
- Tripleseat menu pricing:
  https://support.tripleseat.com/hc/en-us/articles/34368534810775-Menus-Overview
- Perfect Venue pre-event questionnaire:
  https://help.perfectvenue.com/knowledge/pre-event-questionnaire-enterprise-feature
- Caterease setup/checklist guide:
  https://help.caterease.com/wp-content/uploads/2023/07/Program-Setup-Quick-Reference-Guide.pdf
- Current Capterra comparison and reviews:
  https://www.capterra.com/compare/2280-118047/Caterease-vs-Tripleseat
- Directional practitioner discussion:
  https://www.reddit.com/r/restaurant/comments/1m5jh5m/anyone_know_of_a_solid_largescale_catering/

## The actual user problem

The visible problem is not that QuotePilot lacks more guest-count labels. The
structural problem is that one integer currently carries several meanings:

- an early estimate used to start a quote;
- the exact assumption currently priced and presented;
- a later customer-confirmed commitment;
- the operational quantity used for staffing, purchasing, and production; and
- the actual attendance known after service.

Those meanings can diverge. Treating them as one field hides uncertainty before
the event and erases learning after it. Treating every new value as immediately
authoritative would be worse: it could silently reprice the quote, stale the
BEO, alter staffing guidance, or imply customer confirmation without evidence.

## Role journeys

### Customer or event contact

- Job to be done: give the best-known count early, then provide a final count
  once invitations and responses settle.
- Current touchpoint: inquiry text, proposal/change request, email, or staff
  transcription into the quote.
- Current risk: the customer cannot see which count the proposal is priced on,
  when a final answer is due, or whether a later reply changed the commercial
  record.
- Moment of truth: the final-count request names the currently priced count,
  due date, effect of changing it, and what happens after submission.
- Churn trigger hypothesis: repeated email back-and-forth or a surprise true-up
  makes the system feel like another inbox rather than a source of truth.
- Desired next action: **Confirm or revise the count** from a bounded portal
  request; submission remains a proposal until staff review applies it.

### Sales or event manager

- Job to be done: price early without false precision, close the event, collect
  the final count on time, and keep the customer expectation aligned with the
  saved quote.
- Current touchpoints: CREATE uncertainty band, Living Opportunity Guest count,
  Quote editor, Workflow, Decision Debt, Commercial Change Impact.
- Current risk: uncertainty disappears when the quote is saved; the final-count
  task and the priced assumption live on separate surfaces; a customer answer
  may require manual comparison and re-entry.
- Moment of truth: one view answers **what is currently priced**, **what the
  customer last supplied**, **when final confirmation is due**, and **what will
  change if it is applied**.
- Churn trigger hypothesis: the user has to reconcile the same number across
  email, quote, task, and production documents.
- Desired next action: **Review count change** through existing Commercial
  Change Authority, not a direct uncontrolled save.

### Operations, kitchen, and staffing

- Job to be done: plan labor, purchasing, rentals, setup, and production from a
  count whose status and freshness are visible.
- Current touchpoints: Event workspace, staffing guidance, run of show,
  production checklist, Kitchen BEO, dependency state.
- Current risk: an exact-looking number may still be an early assumption;
  downstream teams cannot see whether it is awaiting confirmation or was
  confirmed against the current commercial revision.
- Moment of truth: the operational surface names the count, its evidence state,
  its source revision, and whether a later count has made the artifact stale.
- Churn trigger hypothesis: teams keep parallel spreadsheets or printed BEOs
  because the application does not make freshness obvious.
- Desired next action: **Review affected plan** after a confirmed change; do not
  auto-assign staff, republish a BEO, or claim readiness.

### Administrator or commercial approver

- Job to be done: protect pricing policy and margin while allowing normal
  final-count true-ups to move quickly.
- Current touchpoints: Commercial Change approval, Decision Debt policy,
  version history, retained receipts.
- Current risk: a seemingly routine count update can change price, deposit,
  taxes, staffing cost, service-fee tier, quantities, or capacity exposure.
- Moment of truth: the approval identifies the source count, proposed count,
  exact revision, financial delta, affected dependencies, and requester.
- Desired next action: **Approve or reject the exact change** when policy
  requires; approval does not send a proposal or regenerate artifacts.

### Finance and post-event reviewer

- Job to be done: reconcile the contracted basis, final guarantee, actual
  attendance, provider-confirmed money, and operational variance without
  treating one as proof of another.
- Current touchpoints: quote versions, proposal acceptance, payment ledger,
  post-event closeout.
- Current risk: actual attendance may be overwritten into the commercial count,
  corrupting historical interpretation or implying a provider settlement.
- Moment of truth: contracted/priced count, final applied count, and actual
  attendance remain distinct and timestamped.
- Desired next action: **Record actual attendance** in closeout evidence; never
  implicitly reprice, invoice, refund, or settle.

## Cross-role journey

| Stage | What is true | Dominant action | Authority boundary |
|---|---|---|---|
| Inquiry | Count may be exact, approximate, ranged, or unknown | Review the extracted planning fact | Browser extraction may prefill; it cannot claim customer confirmation |
| Quote planning | One exact count is selected as the commercial pricing basis | Price and save the reviewed assumption | Existing calculator and quote/version write remain authoritative |
| Awaiting final | A final-count decision has a policy-derived due date | Request confirmation | Decision Debt prioritizes; it does not contact the customer or prove receipt |
| Response received | A source-backed proposed count exists | Review count change | Portal/callable may record the response; it does not mutate the quote directly |
| Commercial review | Exact financial and dependency impact is known | Apply or reject | Existing Commercial Change Authority owns approval, apply, receipt, and version |
| Production review | Downstream plans may be stale | Review affected plan | No automatic staffing assignment, reservation, BEO publication, or readiness claim |
| Post-event | Actual attendance may be known | Record closeout fact | Actual count is operational evidence, not automatic commercial or payment authority |

## High-value extras, ranked

### P0 — Attendance confirmation bridge

Persist the uncertainty/evidence envelope that currently disappears between
CREATE and the saved quote. Show the exact priced count separately from the
customer-confirmation state. This unlocks every later improvement.

### P1 — One bounded final-count request

Use a customer-safe portal questionnaire with the current priced count, due
date, and a single confirm/revise action. Save the response as immutable source
evidence; do not write the quote directly.

### P1 — Receipt-backed true-up review

Feed a changed submitted count into the existing Commercial Change preview and
approval path. Present price, deposit, tax, staffing, quantity, capacity, and
artifact consequences together.

### P2 — Operational freshness strip

On staffing, Kitchen BEO, and run-of-show surfaces, show which count/revision
they use and whether a later applied count requires review.

### P2 — Actual-versus-planned learning

Record actual attendance during post-event closeout and use tenant-only,
minimum-sample aggregates to improve future ranges. Never train across tenants
or treat a single event as a default.

## Hypotheses to test directly

1. Users understand **Planning count**, **Final count**, and **Actual
   attendance** better than expected/guaranteed/actual terminology.
2. The final-count due date is normally a tenant policy relative to the event,
   but some event types or venues require an override.
3. Customers will use a portal confirmation if it is one question and clearly
   explains the priced assumption and deadline.
4. Sales wants the customer response to stage a review, while administrators
   want configurable auto-approval only for zero-price or bounded deltas.
5. Operations needs provenance and freshness more than another editable field.

## Interview guide

Recruit 5–8 people across small caterers, venue sales, event operations,
kitchen/production, and finance. Include at least two teams currently using
Tripleseat or Caterease and two using spreadsheets/email.

Ask each participant to walk through one recent event from inquiry to closeout:

1. When did the first guest count appear, and how certain was it?
2. Which number did the proposal price, and how was that communicated?
3. Who requests the final count, when, and through which channel?
4. What makes a customer response trustworthy enough to update the event?
5. What changes when the count moves by 5%, 15%, or across capacity?
6. Who must approve a price, staffing, rental, or BEO change?
7. Where do kitchen and operations verify they have the newest count?
8. Is actual attendance recorded? If so, who uses it later?
9. Show the last time this process failed. What was the cost or rework?
10. Which words would you use for the early, final, and actual numbers?

Record observed behavior, artifacts, timestamps, handoffs, and workarounds.
Do not promote feature requests without a repeated underlying job failure.

## Measurement plan

- Percentage of saved quotes whose uncertainty source remains visible.
- Median time from final-count due date to source-backed response.
- Percentage of responses applied through an exact commercial-change receipt.
- Number of count changes that invalidate staffing/BEO/quantity dependencies.
- Time from applied count to downstream review.
- Difference between priced, final, and actual counts by event type and guest
  band, only after minimum-sample privacy thresholds.
- Recovery rate for stale, conflicting, or superseded responses.
- Qualitative comprehension: can staff identify the priced count and next action
  within five seconds on mobile and desktop?

## Promotion threshold

The architecture direction is strong enough to implement the non-destructive
read model and evidence envelope. Customer-facing terminology, automatic
reminders, customer submission UX, auto-approval thresholds, and actual-count
analytics require direct evidence. Promote those behaviors only when at least
three independent participants in the affected role demonstrate the same job
failure, or production telemetry shows a comparable repeated breakdown.

## Canonical handoff

- Architecture and invariants: `docs/ATTENDANCE_STATE_ADR.md`
- Existing dependency authority: `docs/COMMERCIAL_DEPENDENCY_GRAPH_ADR.md`
- Existing design direction: `docs/POST_COMPETITIVE_DESIGN.md`
- Current implemented capability truth: `docs/FEATURE_MATRIX.md`
- Staff operating instructions after implementation: `docs/USER_MANUAL.md`
- Backend/UI traceability after implementation:
  `docs/capability-surfacing-contracts.json`
