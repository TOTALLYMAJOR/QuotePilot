# Attendance State and Confirmation Architecture Decision

Last updated: 2026-09-12 14:51:07 CDT

Status: Accepted; Slices A–F implemented in current source with local automated evidence; deployment, connected hosted use, and human acceptance remain separate

## Context

QuotePilot currently stores one exact `event.guests` integer. That field is a
real commercial input: pricing, staffing guidance, quantities, proposal output,
capacity checks, Kitchen BEO inputs, versions, and dependency impact all rely on
it. It must not become approximate or silently switch meaning.

The repository also contains two incomplete halves of a stronger workflow:

- CREATE recognizes exact, approximate, and ranged guest-count language and
  prices a draft-only band through the existing calculator.
- Decision Debt defines **Final guest count** as a constrained, time-sensitive
  decision and the dependency graph knows what a count change affects.

What is missing is durable evidence connecting the early planning fact, the
exact count selected for pricing, the later customer response, the applied
commercial revision, and post-event actual attendance.

Research and evidence limits are recorded in
`docs/ATTENDANCE_JOURNEY_RESEARCH.md`.

## Decision

Adopt an evidence-led attendance model around the existing exact commercial
count. Do not replace or overload `event.guests`.

1. `event.guests` remains the exact **commercial pricing basis count** for every
   existing calculator, proposal, version, capacity, staffing, export, and BEO
   consumer.
2. A versioned `event.attendance` envelope will preserve planning uncertainty,
   source evidence, and the relationship between a submitted confirmation and
   the commercial revision that applied it.
3. Final-count timing remains a Decision Debt concern. Decision Debt may say a
   decision is due or unresolved; it may not claim that a count was confirmed.
4. A customer or staff-submitted count is a proposed fact. If it differs from
   `event.guests`, it must pass through the existing Commercial Change
   simulation/approval/apply/receipt path before becoming the pricing basis.
5. Actual attendance belongs to post-event closeout evidence. Recording it does
   not automatically reprice, invoice, refund, settle, republish, or rewrite the
   accepted commercial record.
6. User-facing status is derived from evidence. Do not persist a free-floating
   `attendanceStatus` string that can drift from sources and receipts.

Customer-facing terminology remains provisional until direct research. The
technical contract uses `planning`, `confirmation`, `commercialBasis`, and
`actual` to avoid treating industry-specific words as universal UX copy.

## Proposed data contract

The first persisted schema version is additive and backward compatible:

```js
event: {
  guests: 120, // unchanged: exact current commercial pricing basis
  attendance: {
    schemaVersion: 1,
    planning: {
      kind: "exact" | "approximate" | "range" | "unknown",
      value: 120 | null,
      min: 110 | null,
      max: 130 | null,
      sourceType: "staff_intake" | "customer_inquiry" | "import" | "legacy",
      sourceReferenceId: "opaque-id-or-empty",
      observedAtISO: "2026-08-28T10:25:12.000Z",
      recordedByUid: "opaque-user-id-or-empty"
    },
    confirmation: {
      state: "unknown" | "not_requested" | "requested" | "received" | "applied" | "superseded",
      requestedAtISO: "",
      dueDate: "2026-09-04",
      submittedCount: null,
      sourceType: "customer_portal" | "staff_recorded" | "import" | "",
      sourceReferenceId: "",
      submittedAtISO: "",
      submittedByRole: "customer" | "sales" | "admin" | "",
      appliedRevisionId: "",
      commercialChangeReceiptId: ""
    },
    commercialBasis: {
      source: "none" | "planning" | "confirmation" | "legacy",
      sourceReferenceId: "",
      appliedRevisionId: ""
    }
  }
}
```

The contract deliberately does not place `actual` inside the versioned quote
event. Actual attendance is recorded by the existing post-event closeout
authority with its own actor, time, source, and receipt.

### Invariants

- `event.guests` is always a positive bounded integer when present.
- A range requires `min <= value <= max`; an approximate fact requires one
  exact reviewed `value` if it becomes the commercial pricing basis.
- `confirmation.received` requires a source reference, actor role, timestamp,
  and submitted count. It still does not change `event.guests`.
- `confirmation.applied` requires the exact applied quote revision and trusted
  Commercial Change apply receipt. Its submitted count must equal
  `event.guests` on that revision.
- A later submission supersedes, but never deletes, prior immutable response
  evidence.
- Decision Debt due dates are policy-derived in tenant-local time. A copied due
  date in the envelope is display/context metadata and cannot override policy
  authority without a versioned policy exception.
- Customer portal projections expose only the bounded request, current priced
  assumption, due date, and the customer's own submitted response. Internal
  approval, commercial exposure, staffing, cost, or Decision Debt scoring stays
  private.

## Derived user states

These states are presentation results, not writable lifecycle fields:

| Derived state | Minimum evidence | What the UI may say |
|---|---|---|
| `UNKNOWN` | No valid planning fact and no saved count | Guest count is not recorded |
| `PLANNING_ESTIMATE` | Approximate/range planning fact | Planning estimate; exact price basis is named separately |
| `PRICED_ASSUMPTION` | Valid `event.guests`; no applied confirmation | Priced at N guests; final confirmation not established |
| `CONFIRMATION_DUE` | Open Final guest count Decision Debt item | Final-count decision is due on/before the policy date |
| `CONFIRMATION_RECEIVED` | Source-backed received response | Customer/staff supplied N; review has not changed the quote |
| `CHANGE_REVIEW_REQUIRED` | Submitted count differs from `event.guests` | Review exact commercial and operational impact |
| `FINAL_APPLIED` | Matching receipt and applied revision | Final count N is applied to revision R |
| `ACTUAL_RECORDED` | Trusted post-event closeout fact | Actual attendance N was recorded after service |

Absence of Decision Debt is not proof of `FINAL_APPLIED`. A matching count
without confirmation evidence is still `PRICED_ASSUMPTION`.

## Actor, task, and authority model

| Actor | Object | Goal | Allowed action | Prohibited inference/action |
|---|---|---|---|---|
| Customer/contact | Final-count request | Confirm or revise | Submit one bounded response through guarded portal authority | Direct quote write, pricing claim, approval, BEO publication |
| Sales | Attendance fact | Keep customer and quote aligned | Record source, request confirmation, stage change, review impact | Claim customer confirmation without source evidence |
| Admin/approver | Commercial change | Protect commercial policy | Approve/reject exact request under current gate | Provider/payment/acceptance inference |
| Operations/kitchen | Applied count and dependencies | Plan from current evidence | Review staffing, quantities, capacity, BEO freshness | Change commercial basis or claim readiness |
| Finance | Commercial and provider records | Reconcile exact obligations | Read accepted basis, receipts, provider evidence | Treat actual attendance as settlement |
| Post-event operator | Actual attendance | Preserve operational reality | Record closeout fact with receipt | Rewrite accepted quote history or trigger money automatically |

## Transition contract

```text
planning fact
  -> reviewed exact commercial basis (`event.guests`)
  -> final-count request due (Decision Debt)
  -> response received (immutable source evidence)
  -> commercial impact simulation
  -> approval when required
  -> applied quote/version + receipt
  -> dependency invalidation/review
  -> post-event actual attendance
```

Every arrow requires its own evidence. Navigation, a submitted response, an
approval request, or a matching number cannot skip a transition.

## UI contract

Every attendance surface must answer, in this order:

1. **What is priced now?** Exact `event.guests` and source revision.
2. **What is the best attendance evidence now?** Planning, received, applied,
   or actual, with source and time.
3. **What decision is open?** Due date and why it matters.
4. **What should this actor do next?** One dominant, role-safe action.
5. **What will not happen automatically?** Pricing, staffing, quantities,
   reservation, BEO, proposal, payment, and provider boundaries.

Mobile shows the priced count, evidence state, due status, and dominant action
before methodology. Desktop may add dependency details alongside them. Color
never carries confirmation state alone. Every action has loading, recovery,
success, focus restoration, and exact-object arrival behavior.

## Integration with existing architecture

### CREATE and intent extraction

Preserve the current `kind`, range endpoints, applied midpoint, source excerpt,
and confidence after staff review. Saving an approximate/ranged draft still
requires one explicit exact basis count for current pricing.

### Decision Debt

Keep the existing `guest_count` policy, lock window, tenant-local date,
dependency/exposure factors, and deterministic scoring. Add evidence-aware
presentation later; do not turn the Debt snapshot into confirmation storage.

### Commercial Change Authority

Use the existing `fact.event.guest_count` root, authoritative repricing,
approval gates, immutable apply receipt, version creation, and invalidation
transaction. Do not create a second true-up calculator or direct portal write.

### Proposal and acceptance

A proposal may name a planning/final-count assumption and its true-up rule, but
the accepted receipt binds the exact revision and exact priced count. A later
confirmation is a new commercial-change proposal until applied.

### Kitchen BEO and operations

An applied count change can stale the BEO through existing dependency evidence.
The UI may expose the affected state; it may not regenerate, publish, assign,
reserve, or mark operations ready without the owning authority.

### Post-event closeout

Store actual attendance with closeout actor/time/source evidence. Tenant-only
analytics may compare actual to planning/final after a minimum sample threshold;
the comparison is learning evidence, not an automatic future default.

## Migration

Existing records remain valid without `event.attendance`:

- derive a read-only legacy planning fact from `event.guests`;
- label its source `legacy` and its confirmation state unknown;
- never backfill customer confirmation, due-date completion, or actual
  attendance from the mere existence of a number;
- populate the envelope only on a future reviewed write or explicit migration;
- retain all existing quote/version/pricing behavior during rollout.

## Failure and recovery

- Duplicate customer submissions use one idempotent request identity; later
  materially different submissions supersede rather than overwrite.
- Transport uncertainty preserves the pending request and reconciles before a
  retry can create another response.
- A quote revision change between response and apply returns changed-source
  recovery and requires a new simulation.
- Capacity failure, unavailable catalog/pricing, or missing approval blocks
  apply while preserving the response evidence.
- If Decision Debt or confirmation evidence cannot be loaded, show `Unknown`
  and the last known source separately; do not infer `final` from `event.guests`.
- If BEO/staffing refresh fails after apply, the applied quote remains valid but
  operational review stays explicit and unresolved.

## Privacy and security

- All attendance evidence is tenant-scoped.
- Customer access uses a bounded portal token/callable, not direct quote write.
- Internal actor identifiers, exposure, approval, cost, and provider records do
  not enter the customer portal projection.
- Source excerpts must be bounded and must not copy full email/message bodies
  into the quote.
- Immutable submission/apply/closeout receipts remain server-owned.

## Phased implementation

### Slice A — Read model and compatibility adapter (implemented source/local)

Create a pure `attendance-state-v1` normalizer that derives the current exact
commercial basis and honest legacy/unknown evidence state. Add exhaustive unit
tests. It must perform no I/O and introduce no writable authority.

Current source: `src/components/attendanceState.js` with direct regression
coverage in `src/components/__tests__/attendanceState.test.js`. The module accepts the legacy quote,
an optional future envelope, a bounded Decision Debt snapshot, and optional
trusted closeout evidence; validates exact keys, schema, counts, ranges, source,
timestamps, receipt/revision consistency, and commercial-basis invariants;
returns a deeply frozen presentation model; and changes no quote. This
foundation commit adds no user-facing consumer or persistence path, so new
planning/confirmation envelopes and their presentation still require later
slices.

### Slice B — Persist reviewed planning evidence (implemented source/local)

CREATE's reviewed exact/approximate/range metadata now enters the existing
trusted draft write through five bounded planning fields. The server stamps
actor, observation time and immutable version identity; clients cannot claim
customer confirmation. Approximate counts may have both bounds null. Explicit
ranges must contain the exact reviewed pricing count. An unchanged draft edit
can preserve source evidence; duplicate creation does not carry old confirmation.
Local fallback is separately labeled by local provenance. Quote versioning,
forged field, source/count, legacy and fallback regressions are covered locally.

### Slice C — Living Opportunity attendance strip (implemented source/local)

Combine the commercial basis, planning evidence, and Decision Debt due state in
the Guest-count inspector. Provide one dominant action and exact focus recovery.

Current source renders the exact saved priced count, best supported attendance
evidence, and an open-decision row only when request or fresh Decision Debt
evidence supports it. It shares the already-mounted exact-quote Decision Debt
read, adds no callable or duplicate I/O, rejects stale, error, loading, and
mismatched timing evidence, and routes only an exact task to its existing
Workflow destination. Navigation does not resolve the task or alter the quote.
Malformed future envelopes retain the priced count and render a bounded review
state. The implemented planning and confirmation paths are described below.

### Slice D — Customer confirmation request and response (implemented source/local)

The callable-owned private journal stores exact accepted-source requests and
customer/staff response receipts. The current activated portal exposes the
bounded questionnaire; staff record responses through the Guest count inspector.
Request creation does not send a message. Receipt replay preserves the original
identity; source replacement, wrong tenant and stale portal issuance fail closed.
The response does not mutate the quote or establish actual attendance.

### Slice E — Commercial true-up (implemented source/local)

The reviewed response binds an immutable submission receipt to existing
Commercial Change simulation, approval, apply, version and invalidation. Tenant
policy adds approval constraints without weakening the existing approval floor.
An explicit matching-count apply also creates a new version. An accepted/booked
attendance amendment becomes a draft requiring renewed customer acceptance and
administrator booking review; original acceptance, booking and payment evidence
remain historical and unchanged. The versioned attendance envelope records the
actual apply receipt. No automatic charge, send or new acceptance occurs.

### Slice F — Operational and actual attendance (implemented source/local)

Expose count/revision freshness on staffing/BEO/run-of-show surfaces and record
actual attendance through post-event closeout.

Current source adds one callable-owned actual-attendance journal under the
existing private post-event closeout. A staff command records or corrects one
bounded whole count with a required source type and source note. The command is
bound to the exact organization, quote, deterministic closeout, accepted
version, and acceptance receipt; it uses compare-and-set revision fencing,
idempotent request identity, server actor/time evidence, and an immutable
receipt that retains the prior fact on correction. It is unavailable before the
tenant-local closeout date or while closeout time-zone policy is unresolved.

Customer 360 owns the record/correct/reconcile interaction. Event Focus and
Control Room consume only the bounded quote projection when its accepted
version and acceptance receipt still match the current commercial source.
Mismatch is shown as stale source evidence and withholds the count. The
operational view keeps priced guests and actual attendance separate; staffing,
BEO, run-of-show, Event Preflight, event phase, issue, labor, purchasing,
payment, invoice, refund, settlement, customer communication, and accepted
history remain under their existing authorities. Local pure, client, component,
rules, and emulator fixtures cover the boundary; no deployment, production
record, provider outcome, or human acceptance is established here.

## Consequences

### Positive

- Preserves current calculator and version authority.
- Prevents early estimates from masquerading as confirmed facts.
- Connects customer communication, Decision Debt, commercial review, and
  operational freshness without duplicating their authorities.
- Creates a defensible path to reminders, true-ups, and tenant-only learning.

### Costs and risks

- Adds a new versioned metadata contract and migration burden.
- Requires careful projection and source-evidence privacy.
- Cross-surface state may be confusing unless the same derived-state adapter is
  used everywhere.
- Customer terminology and reminder behavior remain unvalidated.

## Rejected alternatives

- Replace `event.guests` with a range: rejected because current pricing,
  proposal, payment, capacity, and BEO consumers require one exact basis.
- Add `plannedGuests`, `guaranteedGuests`, and `actualGuests` as three unrelated
  integers: rejected because source, time, actor, revision, supersession, and
  authority would remain ambiguous.
- Treat a resolved Decision Debt item as final confirmation: rejected because
  priority/resolution evidence is not customer source evidence.
- Let a portal response update the quote directly: rejected because it bypasses
  pricing, approval, versions, dependency invalidation, and receipts.
- Store actual attendance on the accepted quote revision: rejected because
  post-event operational reality must not rewrite commercial history.
- Build a second final-count pricing calculator: rejected because the existing
  authoritative pricing and Commercial Change paths already own that decision.

## Acceptance standard for the completed program

- Staff can distinguish planning, priced, received, applied-final, and actual
  counts without opening multiple unrelated surfaces.
- Customer submission is source-backed, bounded, idempotent, and cannot mutate
  commercial truth directly.
- Every applied count change has exact repricing, approval when required,
  version, receipt, and dependency evidence.
- Staffing, quantities, capacity, proposal, Kitchen BEO, payment, reservation,
  provider, and closeout authorities remain separate.
- Legacy quotes degrade honestly without invented confirmation.
- Mobile/desktop, keyboard, screen-reader, hosted, provider, production, and
  human-acceptance evidence remain separately reported.


## Tenant Operating Model integration

The [Tenant Operating Model ADR](TENANT_OPERATING_MODEL_ADR.md#attendance-planning-and-customer-response)
owns the bounded request/response pack now being integrated. Pending responses
live in a separate immutable journal; the versioned envelope continues to
represent reviewed planning and applied commercial evidence. A policy reference
is not an unresolved Decision Debt item. Actual attendance and provider delivery
remain separate evidence domains, with missing evidence explicitly retained.
