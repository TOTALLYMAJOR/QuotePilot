# Work Plan: QuotePilot Tenant Operating Model

Last updated: 2026-09-05 17:42:26 CDT

Status: source through Phase 4 and Phase 5 local qualification complete; real tenant pilot and promotion decision pending
Related task: `QP-TOM-020`
Type: staged product, architecture, data-authority, and workflow program
Estimated duration: 14–22 engineer-weeks for source/local completion and one
bounded tenant pilot; hosted, production, provider, and human gates remain
separate
First material customer value: 4–6 engineer-weeks through the Event Operating
Spine
Review scope: the program and its future independently planned slices; this
document records the program; the delegated local implementation decision is
bound in [the accepted ADR](../TENANT_OPERATING_MODEL_ADR.md). Deployment, tenant
activation, provider mutation, migration, and production-data access remain separate

## Objective

Make QuotePilot reflect how each catering organization runs its business while
preserving the existing sources of truth for pricing, proposals, acceptance,
staffing, payment, BEOs, communication, and reconciliation.

The destination is a layered operating model:

```text
customer business
  -> tenant-owned workflow definitions and policy versions
  -> catering workflow packs and domain semantics
  -> reusable state, authority, evidence, transition, task,
     communication, payment, and resource capabilities
  -> QuotePilot tenancy, security, audit, and financial truth
```

This is an ownership model, not the implementation order. Delivery proceeds
through customer-visible vertical slices. Shared capability contracts are
extracted only after more than one workflow proves the same abstraction.

## Outcome

An organization administrator can configure and publish bounded versions of
four named catering workflows:

1. quote review and commercially consequential change approval;
2. final guest-count request, response, and reviewed true-up;
3. accepted-event readiness, live execution, issues, and actuals; and
4. post-event closeout, review follow-up, and rebooking.

Every running workflow is pinned to the exact tenant policy version, template
version, subject revision, actor authority, and transition receipts that govern
it. A later policy edit affects new instances only unless an administrator
explicitly previews and authorizes a compatible migration.

## Why This Sequence Fits the Current System

QuotePilot already has strong lower-layer foundations:

- tenant isolation and role-gated server authorities;
- exact-revision simulation, approval, apply, invalidation, and reconciliation;
- idempotent requests and immutable mutation receipts;
- authoritative operational staffing with availability and conflict fences;
- Workflow Attention, Decision Debt, messaging, payment, BEO, and closeout
  capabilities with separate evidence domains;
- a read-only Commercial Truth Loop that preserves unavailable evidence; and
- capability-surfacing governance that prevents user-relevant backend work from
  becoming unreachable.

The missing product layer is not another generic engine. It is durable,
versioned tenant ownership of sequencing, roles, thresholds, tasks, and
templates across those existing capabilities.

## Non-Goals

- No unconstrained drag-and-drop workflow builder.
- No tenant-authored code, expressions, queries, webhooks, or arbitrary state
  names.
- No second calculator, payment ledger, staffing authority, BEO authority,
  customer-message authority, or commercial truth store.
- No new mutable event aggregate that copies quote, customer, acceptance,
  payment, staffing, or BEO facts.
- No inference that a task completion proves customer contact, delivery,
  attendance, payment, settlement, readiness, or acceptance.
- No autonomous AI transition, approval, send, booking, charge, assignment, or
  policy authority.
- No cross-tenant policy learning or hidden tenant-specific defaults.
- No dependency on Stripe Connect, payroll, accounting sync, or a new inventory
  authority for the first program release.

## Architectural Invariants

### Existing authorities remain authoritative

The workflow layer may coordinate an existing domain command and record its
receipt. It may not replace the domain command or reinterpret its outcome. For
example, a final-count response remains a proposed fact until Commercial Change
Authority applies a repriced version and returns its trusted receipt.

### Every instance binds a versioned execution contract

Each workflow instance must bind at least:

```text
organizationId
workflowKind
workflowDefinitionId
workflowDefinitionVersion
workflowDefinitionDigest
subjectType + subjectId
subjectRevisionRefs
instanceRevision
currentState
openTaskRefs
lastTransitionReceiptId
createdAtISO + createdByUid
```

This binding is the cross-layer membrane. It makes later replay defensible even
after a tenant changes its operating policy.

### Published policy is immutable

Workflow definitions move through `draft -> published -> retired`. Publishing
creates an immutable version. Editing a published definition creates a new
draft version. Retiring a version prevents new instances but never rewrites an
active or historical instance.

### Transitions are server-owned protocols

Every consequential transition follows:

```text
eligibility -> exact source reload -> role and tenant authorization
  -> policy-version validation -> domain command when required
  -> atomic workflow transition -> immutable receipt -> bounded projection
  -> uncertain-outcome reconciliation when transport is ambiguous
```

The browser cannot directly write a workflow instance, transition receipt,
task authority, or published definition.

### Missing evidence stays missing

Workflow presentation preserves `missing`, `not_applicable`,
`not_yet_available`, `blocked_by_integration`, `contradictory`, and
`schema_drift`. A workflow cannot advance merely because a required fact is
absent, a task was dismissed, or a UI route was visited.

### AI stays advisory

AI may summarize evidence, identify a blocked step, draft operator-facing text,
or propose a configuration diff. Deterministic validation and authorized humans
retain policy publication and every consequential transition.

## Planned Contracts

Slice A names and persistence paths are bound by the
[accepted ADR](../TENANT_OPERATING_MODEL_ADR.md). Later-phase contracts remain
provisional. The responsibilities below remain binding.

| Contract | Responsibility | Must not become |
|---|---|---|
| Tenant workflow definition | Versioned roles, policies, allowed transitions, task templates, escalation rules, and communication-template references | Executable tenant code or a replacement for domain rules |
| Workflow instance | Exact subject, pinned definition version, derived current state, open tasks, and last trusted transition | A denormalized copy of the quote/event/customer record |
| Transition receipt | Request identity, before/after revisions, actor/role/time, policy digest, domain receipt references, and bounded outcome | Evidence for payment, delivery, attendance, or acceptance beyond the owning authority |
| Operational event ledger | Event phase, checkpoints, live issues, actual labor/purchasing, and replayable operations history keyed to exact accepted sources | A second commercial event or accepted-quote aggregate |
| Task projection | Role-safe next action, due/escalation state, owning object, and completion receipt | Proof that the downstream business outcome happened |
| Communication intent | Approved template reference, eligibility, and requested handoff | Provider acceptance, delivery, reading, or response evidence |
| Resource adapter | Bounded reference to staffing, run-of-show, package, BEO, or future inventory authority | A parallel resource reservation or availability system |

## Initial Actor and Authority Model

| Actor | Definition authority | Instance authority | Explicit boundary |
|---|---|---|---|
| Organization administrator | Draft, preview, publish, retire, and explicitly migrate compatible workflow definitions | Perform all tenant-authorized operator transitions | Cannot bypass pricing, payment, staffing, provider, or accepted-version authority |
| Sales | Read the active workflow and perform allowed sales transitions | Quote follow-up, request preparation, and existing commercially governed actions | Cannot publish policy or bypass approval thresholds |
| Operations | Read the active event workflow and record allowed checkpoints, issues, and operational actuals | Event execution and closeout actions | Cannot rewrite the accepted commercial promise or provider evidence |
| Finance | Read bounded commercial and actual evidence; perform separately authorized finance actions | No implicit operational completion authority | Cannot infer settlement from a charge or operational actual |
| Customer/contact | Submit only a bounded response through existing token/callable authority | No direct instance or quote mutation | Cannot approve, publish, reprice, assign, or mark ready |
| AI/advisory process | Prepare summaries or typed proposed diffs | None | Cannot publish policy or execute a transition |

Phase 0 must reconcile this model with current production roles before any
schema or callable is implemented.

## Delivery Strategy

Each numbered slice receives its own planner run, exact owned file list,
separate reviewable commit, capability/doc mapping, focused validation, and
completion receipt. Implementation starts from a fresh sibling worktree based
on the owner-approved current baseline; it must not begin in the existing dirty
integration checkout.

The phase estimates overlap only where the work is independently reviewable.
The total critical-path estimate remains 14–22 engineer-weeks.

## Phase 0 — Decisions, Baseline, and Accepted Contracts (1 week)

Purpose: resolve the decisions that would otherwise force expensive schema or
authority rework.

### Local implementation decision

The owner delegated the pending decision with "Approve for me" and resumed it
through the supplied handoff. The [accepted ADR](../TENANT_OPERATING_MODEL_ADR.md)
records the exact source identity, fixed Slice A vocabulary, no-current-tenant-
configuration allowlist, current admin/sales role mapping, no-retroactive-change
rule, synthetic local cohort, online-only decision, and threat model.

- [x] Accept the operational-only ledger and versioned execution boundary for
  local Slice A development.
- [x] Bind ledger identity to organization + quote + immutable accepted version
  + private acceptance receipt, preserving existing commercial authorities.
- [x] Fix initialize and monotonic prepared/in-progress/completed transitions;
  reserve other workflow kinds without implementing their domain transitions.
- [x] Classify settings and keep tenant policy publication in its later phase.
- [x] Preserve pinned history; no migration or legacy synthesis in Slice A.
- [x] Map admin to operational writes and admin/sales to bounded reads; no new
  operations or finance role grants.
- [x] Select online-only local operation; dependable offline sync is a separate
  program if a real pilot requires it.
- [x] Define a two-tenant synthetic local fixture boundary; no real tenant
  activation or production-data access.
- [x] Record the customer-impact baseline as unavailable, rather than invented.
- [x] Bind threat cases and local verification to the ADR.

### Remaining pilot decisions

- [ ] Select the approved real founder-pilot tenant and bounded event cohort.
- [ ] Confirm connectivity needs with that cohort before event-day pilot use.
- [ ] Capture real impact baselines or explicitly retain unavailable evidence.

### Exit Gate

The delegated decision opens bounded local implementation of Slice A. Real
pilot selection and observed baselines remain pilot gates. No slice may create
a second commercial, staffing, payment, or event aggregate authority.

## Phase 1 — Event Operating Spine Vertical Slice (4–6 weeks)

Purpose: create the first customer-visible operational workflow and the factual
foundation for later reuse.

### Tasks

- [x] Add a server-owned operational event ledger bound to one exact tenant,
  quote, accepted/booked source, and immutable source revision.
- [x] Implement controlled event phases, checkpoints, issues, actual labor,
  and actual purchasing with exact actor/time/source evidence.
- [x] Preserve submitting, uncertain, reconciliation, receipt, rejection, and
  recovery states for every mutation.
- [x] Compose current run-of-show, operational staffing, BEO freshness,
  Commercial Dependency State, and closeout evidence by reference rather than
  copying their mutable facts.
- [x] Replace Control Room and Replay unavailable placeholders only for facts
  the new ledger establishes. Unsupported attendance, inventory, payroll,
  provider, and settlement states remain unavailable.
- [x] Extend post-event closeout with bounded operational actuals while keeping
  actuals unable to reprice, refund, invoice, settle, or rewrite acceptance.
- [x] Implement the `actualConsumption` producer from trusted records and run
  cross-tier coverage/reconciliation tests. The producer and reconciler remain
  read-only.
- [x] Add discoverable role-safe UI, canonical capability markers, state tests,
  Feature Matrix, User Manual, and capability-surfacing contracts in the same
  slice as each user-relevant authority.

### Exit Gate

- [x] One exact event can move through its allowed operational phases with
  replay-stable receipts and zero duplicate commercial facts.
- [x] Control Room and Replay distinguish planned, recorded, unavailable, and
  contradictory evidence.
- [x] Actual labor/purchasing can feed Truth Loop evaluation without giving the
  loop write or policy authority.
- [x] The owner reviews the vertical slice before generalized workflow
  contracts are extracted.

## Phase 2 — Extract the Versioned Execution Contract (2–3 weeks)

Purpose: extract only the state/authority/evidence/transition mechanics proven
by Phase 1.

### Tasks

- [x] Introduce deterministic validation for workflow definitions, instances,
  task projections, and transition receipts.
- [x] Add draft/publish/retire definition lifecycle with immutable published
  versions and canonical digests.
- [x] Bind every new instance to one exact published version and the exact
  subject revisions required by its workflow kind.
- [x] Add stable request IDs, payload digests, idempotent receipt identity,
  changed-payload rejection, and ambiguous-outcome reconciliation.
- [x] Implement one adapter boundary through which workflow coordination calls
  an existing domain authority and records only its trusted outcome reference.
- [x] Prove that changing a definition does not alter an active or historical
  instance and that an explicit compatible migration produces its own receipt.
- [x] Keep unsupported definition schema versions unavailable rather than
  optimistically interpreted.

### Exit Gate

- [x] The Event Operating Spine runs through the extracted contract without
  changing its behavior or authority.
- [x] At least one second thin workflow fixture uses the same contract before
  the contract is called reusable.
- [x] Removing the workflow coordinator would leave each existing domain
  authority and its historical receipts intact.

## Phase 3 — Tenant Workflow Configuration Studio (2–3 weeks)

Purpose: let an authorized tenant administrator own bounded policy without
exposing unsafe programmability.

### Tasks

- [x] Add an administrator-only workflow configuration entry point through the
  existing role-safe Library/Setup architecture.
- [x] Provide fixed editors for allowed roles, approval thresholds, due-date
  policy, escalation timing, named task templates, and communication-template
  references.
- [x] Show draft, validation, preview diff, publish, published version, retired,
  conflict, and recovery states.
- [x] Preview the exact new-instance effect and any compatible active-instance
  migration separately.
- [x] Require typed confirmation for publication and migration; neither action
  enables a provider, runtime program, or production tenant automatically.
- [x] Add safe defaults only as explicitly versioned QuotePilot seed evidence.
  Never infer tenant policy from history.
- [x] Deny arbitrary code, free-form conditions, unbounded recipient selection,
  and cross-workflow field access.

### Exit Gate

- [x] An administrator can publish a new version without a code deployment.
- [x] New instances bind the new version; existing instances remain unchanged.
- [x] Existing sales/admin staff can see the pinned policy; sales cannot publish
  or silently widen authority. No new operations role is granted.

## Phase 4 — Four Bounded Catering Workflow Packs (4–6 weeks)

Purpose: prove that the operating model composes existing domain capabilities
across materially different workflows.

### Pack A: Quote Review and Commercial Change

- [x] Route tenant approval thresholds and allowed roles into the existing
  simulation/request/authorization/apply protocol.
- [x] Keep authoritative repricing, version creation, invalidation, and outcome
  reconciliation in Commercial Change Authority.
- [x] Treat the workflow task as routing evidence, not approval or applied
  change evidence.

### Pack B: Final Guest-Count Confirmation

- [x] Implement the accepted Attendance ADR persistence and customer-response
  slices through bounded request/submission receipts.
- [x] Route differing counts through existing Commercial Change Authority.
- [x] Keep planning, priced assumption, received response, applied final, and
  actual attendance distinct.

### Pack C: Accepted-Event Readiness and Live Execution

- [x] Bind the Event Operating Spine to tenant phase, checkpoint, issue,
  escalation, and responsible-role policy.
- [x] Compose staffing, BEO, run-of-show, and dependency evidence without
  collapsing them into one synthetic readiness score.
- [x] Preserve separately unavailable inventory, attendance, payroll, provider,
  and settlement evidence.

### Pack D: Closeout, Review Follow-Up, and Rebooking

- [x] Bind due dates, responsible roles, and escalation to the existing
  authoritative post-event closeout record.
- [x] Use the existing provider-safe communication authorities for any later
  send; intent, provider acceptance, delivered/bounced, recipient behavior,
  and customer response remain separate.
- [x] Keep rebooking as a reviewed draft handoff rather than an inferred sale.

### Exit Gate

- [x] At least three materially different packs reuse the same execution
  contract without introducing pack-specific exceptions into the kernel.
- [x] Each pack has its own capability contract, UI state evidence, role and
  tenant denial matrix, exact domain receipt binding, and rollback path.
- [x] A policy change can be explained through its definition diff and exact
  affected new instances.

## Phase 5 — Migration, Pilot, and Promotion Decision (1–3 weeks)

Purpose: prove operator value and safe tenant operation before wider rollout.

### Tasks

- [x] Implement and exercise a tenant-scoped offline inventory for all four
  packs using exact synthetic source and retained policy evidence.
- [ ] Run and review that dry-run inventory for the selected real tenant's
  eligible legacy events and active workflows.
- [x] Create no historical policy, confirmation, task completion, actual,
  provider, or acceptance evidence from field presence alone.
- [x] Verify initialization only from eligible exact current source facts and
  explicit legacy compatibility in local fixtures. Real pilot initialization
  requires the selected tenant/cohort and separate activation decision.
- [ ] Qualify one exact non-production or founder-pilot tenant with admin,
  sales, operations, finance-read, customer-token, denied-role, cross-tenant,
  replay, concurrency, and rollback cases.
- [ ] Run moderated operator acceptance for configuration, live-event use,
  recovery, and replay.
- [ ] Compare the pilot against the recorded baseline and document unknowns
  where no baseline exists.
- [ ] Request a separate decision to continue, revise, pause, or promote. A
  successful pilot does not authorize general tenant activation.

### Exit Gate

- [x] Local automated and emulator matrices show no cross-tenant,
  role-escalation, duplicate-transition, retroactive-policy or domain-authority
  violation. The selected real tenant still requires its own qualification.
- [x] Every locally exercised accepted consequential transition has a trusted
  receipt and exact policy/source binding.
- [ ] Operators can identify what happened, what did not happen, what evidence
  is missing, and the next safe action without reconstructing state elsewhere.
- [x] Customer/provider/production/human evidence remains separately labeled.

## Expected Implementation Ownership

Exact paths are finalized by each slice planner. The expected ownership seams
are:

| Area | Expected responsibility |
|---|---|
| `functions/` | Definition publication, instance transitions, operational ledger, role/tenant validation, idempotency, receipts, and domain adapters |
| `src/lib/` | Typed clients, pure presentation selectors, state normalization, and recovery contracts |
| `src/components/` | Configuration Studio, event Control Room, Replay, task/action presentation, and role-safe recovery |
| `evidence/` | Read-only actual-consumption projection with provenance and availability classification |
| `firestore.rules` / indexes | Browser denial or bounded projections, query containment, immutable/server-owned receipt protection |
| `docs/capability-surfacing-contracts.json` | Exact callable/helper ownership, UI states, locators, tests, and safe outcomes |
| Canonical docs | Feature Matrix and User Manual for implemented behavior; status/backlog/changelog only when their triggers apply |

No implementation slice may claim this entire table as one ownership scope.

## Verification Strategy

### Per-Slice Proof

- Pure contract and state-machine unit tests.
- Server authorization, stale-revision, changed-payload, idempotency,
  concurrency, rollback, and tenant-isolation tests.
- Firestore rules and Auth/Firestore/Functions emulator acceptance.
- Canonical component markers for every required read or mutation state.
- Responsive, keyboard, focus, reduced-motion, overflow, and recovery checks at
  390, 768, and 1440 pixels for changed UI.
- Exact-object navigation and return-context tests.
- Capability-surfacing, documentation-governance, environment, build, secret,
  workflow, bundle, and diff gates according to each slice's planner output.

### Program Gates

- `npm run test:unit`
- applicable Firestore rules and Firebase emulator lanes
- `npm run check:capability-surfaces`
- `npm run truthloop:coverage` and `npm run test:truthloop` when evidence or
  reconciliation contracts change
- `npm run check:env`
- `npm run build`
- `npm run check:docs:governance`
- `npm run check:project-state`
- exact scoped `git diff --check`

Passing these commands is source/local evidence. It is not deployment, hosted
role behavior, provider acceptance, production-data correctness, tenant
activation, operator comprehension, or customer outcome evidence.

## Customer-Impact Measurement

Phase 0 records a baseline where available. Phase 5 evaluates:

- event-day handoff or missed-checkpoint incidents per pilot event;
- operator time spent reconstructing current event state;
- percentage of delivered events with trusted actual labor and purchasing;
- time from event completion to reviewed closeout;
- percentage of workflow tasks completed within the tenant-declared policy;
- number of policy changes requiring a code deployment;
- number of ambiguous outcomes resolved without duplicate mutation; and
- moderated operator ability to identify current state and next action.

Non-negotiable technical thresholds are zero cross-tenant disclosures, zero
unauthorized transitions, zero invented evidence, and exact receipt coverage
for every accepted consequential transition. Commercial and usability targets
must be set after the baseline rather than invented in this plan.

## Risk Register

| Risk | Consequence | Countermeasure |
|---|---|---|
| Workflow layer becomes a second domain authority | Pricing, payment, staffing, or acceptance can drift | Adapter-only coordination; bind exact domain receipts; domain authority tests |
| Generic builder expands before workflows are understood | Large delay and brittle abstraction | Four fixed packs; extract only after a second and validate after a third workflow |
| Policy edits rewrite history | Replay and audit become indefensible | Immutable published versions; pinned instances; explicit migration receipts |
| Operational ledger duplicates the quote/event | Conflicting customer and commercial truth | Store exact references and operational-only facts; never copy mutable commercial fields |
| Tenant configuration grants hidden authority | Privilege escalation or unsafe automation | Fixed allowlist, server authorization, admin-only publish, denied-role/cross-tenant tests |
| Missing evidence is treated as completion | False readiness and unsafe transitions | Availability-gated transitions and explicit unavailable states |
| Event-day connectivity is assumed | Failed live operations | Phase 0 offline decision; separately designed sync program if required |
| Provider outcomes are collapsed into workflow state | False delivery or customer-response claims | Keep intent, provider acceptance, delivery, recipient, and response rails separate |
| Broad implementation lands in the dirty integration checkout | Unreviewable ownership and rollback | Fresh sibling worktree; one planner-bounded slice and commit at a time |
| Configuration complexity exceeds operator comprehension | Low adoption despite technical completeness | Fixed templates, preview diff, one next action, moderated acceptance, kill criteria |

## Kill and Pause Criteria

Pause expansion and revise the architecture if:

- a workflow transition must duplicate or bypass an existing domain authority;
- two workflow packs require incompatible kernel exceptions;
- an administrator cannot predict which instances a policy version affects;
- operators continue reconstructing event state in parallel tools despite a
  complete pilot slice;
- the policy editor needs tenant-authored executable logic to satisfy the first
  four workflows;
- actuals or task completion are presented as payment, delivery, attendance,
  readiness, or acceptance evidence; or
- hosted role/tenant denial, rollback, or human comprehension cannot be proven
  for the founder-pilot tenant.

## Completion Criteria

- [x] Phase 0 local implementation decisions and ADR are accepted; real pilot
  selection remains a Phase 5 prerequisite.
- [x] Event Operating Spine implements the first customer-visible slice in
  source/local evidence; real operator value remains a pilot question.
- [x] Published workflow definitions are immutable and every instance is pinned
  to an exact version and digest.
- [x] Four bounded catering packs compose current authorities through exact
  receipts; at least three prove the shared execution contract.
- [x] Configuration, transition, uncertainty, reconciliation, receipt, and
  recovery states are discoverable and executable for authorized roles.
- [x] Legacy records degrade honestly without invented policy or evidence.
- [x] Source/local, hosted, provider, production, human, adoption, and outcome
  evidence remain non-transitive and separately reported.
- [ ] One bounded tenant pilot produces an explicit continue/revise/pause
  decision.

## Historical Delivery Checkpoints

The following checkpoints preserve the evidence available at each delivery.
They are not the current completion summary; use the status above and Project
Status for the final candidate.

The ADR and local development authorization are recorded. `QP-TOM-020-A`
implements initialization, reads and recorded phases; `QP-TOM-020-B` adds fixed
operator checkpoints and a bounded issue journal in the same role-safe Control
Room. Both bind the exact accepted source and retain immutable receipts. The
built-in policy is not tenant workflow ownership. Actuals, full Replay, closeout
integration and Truth Loop export remain subsequent slices. No tenant
activation, deployment, provider action, production-data access or human
acceptance is established.

### Slice A validation checkpoint

The full unit lane passes 4,393 tests with 80 intentional skips. The separate
Auth/Firestore/Functions acceptance harness proves enabled-path authority,
concurrent transition isolation, immutable replay, domain non-mutation, and
runtime-disabled denial. Firestore rules, capability contracts, quick lane,
and documentation governance have local passing evidence. Responsive
production-component composition fixtures pass at 390, 768, and 1440 pixels
with keyboard progression, frozen uncertain requests, exact retry, and zero
horizontal overflow. These fixtures use synthetic transport; they are not a
connected full-App or hosted acceptance pass.

The compatibility build and the Ambient feature-enabled build both succeed.
The latter includes the Event Operations panel; it is not deployment evidence. Its exact pre-change baseline and Slice A
both measure 3,281,701 JavaScript bytes and a 401,792-byte largest chunk, over
existing limits of 3,221,176 and 391,901. The performance gate remains failed;
no budget was widened. This inherited failure keeps commit/release
qualification open. No commit, push, deployment or tenant activation has been
performed by this slice.

### Slice B — Bounded checkpoints and issues

Continue from the preserved Slice A source snapshot with the
[accepted work-journal contract](../TENANT_OPERATING_MODEL_ADR.md#slice-b--operator-checkpoints-and-issue-journal).
This slice adds four fixed operator checkpoints with explicit reopen receipts,
and a 25-issue bounded journal supporting open/resolve/reopen with reasons.
Independent work revisions and receipts preserve the phase policy and every
existing commercial authority. A shared browser mutation guard keeps phase and
work uncertainty from spawning competing requests.

- [x] Implement the separate work authority, exact source/policy binding and
  bounded callable projections.
- [x] Expose admin actions and sales reads in Control Room, with fixed choices,
  safe request recovery and responsive state evidence.
- [x] Prove concurrency, no phase/domain writes, receipt integrity, role/tenant
  denial, bounds, historical replay and shared browser exclusion.
- [x] Reconcile capability contracts, rules, documentation, and local checks.

This slice does not include actual consumption, attendance, resource assignment,
provider communication, full Replay, tenant-published workflows or real-tenant
activation. The prior bundle failure remains an explicit qualification blocker.

### Slice B validation checkpoint

The full unit lane passes 4,432 tests with 81 skips. The final keyboard-focus
correction additionally passes all 9 affected component tests. Separate rules pass 79
checks, and both enabled and disabled Auth/Firestore/Functions acceptance
matrices pass. These prove exact work concurrency and rollback, immutable phase
and source records, role/tenant/gate denial, the 25-retained-issue cap, orphan
history rejection and exact historical replay. Quick lane, capability and
documentation checks pass. Both compatibility and actual feature-enabled
Ambient builds pass; the inherited compatibility bundle failure above is
unchanged.

Responsive component/composition fixtures use the real clients and shared
guard with synthetic callable transport at 390, 768 and 1440 pixels. Pending
and uncertain requests freeze the other command channel; exact replay refreshes
current state, post-completion corrections remain possible, and long content
has zero horizontal overflow. This remains local fixture evidence, separate
from connected full-App, hosted, production and human acceptance.

## Authorized continuation through Configuration Studio

The owner's request on 2026-09-05 to continue until Configuration Studio is
complete authorizes dependency-ordered local implementation through Phase 3.
The established delegated review and agent rotation continue. Each bounded
slice is reconciled against its predecessor before the next begins. This does
not activate a tenant, deploy, migrate production records or implement the
Phase 4 domain packs or Phase 5 pilot by implication.

The next delivery checkpoints are:

- **C — Operational actuals:** exact-source labor and purchasing capture,
  independent correction/void receipts, declared units and costs, bounded
  records, role-safe Control Room actions, and unchanged phase/work histories.
- **D — Complete the operational spine:** bounded Replay and by-reference
  operational composition, closeout actuals, read-only actual-consumption
  export, cross-tier evidence and a complete local event journey.
- **E — Versioned execution contract:** extract proven validation, policy pins,
  immutable definition publication, instance/receipt coordination, compatible
  migration previews and trusted domain adapters. Prove a second thin workflow
  fixture before claiming reuse; preserve existing fixed-policy history.
- **F — Configuration Studio:** discoverable administrator configuration in
  Library/Setup, bounded editors, exact draft validation/preview/publication,
  retirement, separate migration preview/confirmation, authorized policy reads
  and new-instance version binding. No arbitrary tenant code or role escalation.

Completion of this continuation requires the Phase 1–3 local exit criteria,
canonical capability and documentation coverage, adversarial review, automated
checks and responsive keyboard/recovery evidence. Real operator acceptance,
pilot selection, external promotion and customer outcomes remain separately
unproven. The existing bundle blocker remains explicit until a separately
reviewed source fix passes its unchanged ceilings.

### Slice C validation checkpoint

Declared actuals are implemented locally. The full unit suite passes 4,467
tests with 82 skips; server-focused checks pass 51 and client/UI checks pass
62. Firestore rules pass 80 tests; capability, inventory, documentation, quick
lane and enabled Control Room build checks pass. Combined phase/work/actuals
Auth/Firestore/Functions matrices pass with the runtime gate enabled and
explicitly disabled. Phase and work policy modules remain byte-identical.

Responsive component/composition fixtures at 390/768/1440 use production
clients and the shared guard with synthetic transport. They pass all three
channels' pending/uncertain exclusion, exact replay/current refresh,
record/correct/void, explicit zero and category completeness invalidation,
keyboard focus and dense/expanded long-content overflow checks. Hosted,
production and human acceptance are not established. The inherited bundle
qualification blocker remains unchanged. Continue directly to Slice D under
the authorized through-Studio objective.


### Slice D local checkpoint

Bounded Replay, current domain references, exact-source closeout actuals, and
read-only declared-cost export have local implementation evidence. Focused
server checks pass 63 tests, evidence checks pass 97, and Python passes 132.
Both real emulator gate modes pass. UI checks pass 69 plus the final four
history label checks; browser fixtures pass 390/768/1440 with zero overflow.
The full current unit run passes 4,573 with 82 skips and the enabled Ambient
build passes. This includes early pure E foundation tests. E runtime/surface
contracts are still being bound; their pending capability classification does
not establish a released Studio. The preserved D source checkpoint precedes
E runtime wiring. No deployment, tenant activation or human acceptance is
claimed.

### Slices E/F local completion checkpoint

The versioned coordination contract and administrator Configuration Studio are
implemented through Phase 3. Library provides bounded draft editing, full
human-readable publication comparisons, typed publication and retirement. New
events bind the exact immutable seed or tenant publication; existing events
retain their pins. Explicit compatible migrations preview the complete target
configuration inside the confirmation digest and retain their own receipts.
Control Room exposes tasks, due/escalation observations, manual handoff guidance
and exact-revision actuals review. A sibling operational change immediately
invalidates prior review presentation until current evidence is refreshed.

The second thin post-event-review fixture exercises the same execution
contract; it is not a delivered second workflow pack. Original phase, work,
actuals and history policy modules remain byte-identical to the D checkpoint.
Declared comparison policy exports only from the exact validated instance pin;
missing policy remains an explicit unavailable prerequisite.

Local proof includes 4,624 full-suite tests passing with 83 skipped, 45 focused
UI/client/guard tests without skips, 81 rules tests, 136 Python tests, enabled
and disabled real workflow emulator scenarios, and responsive browser scenarios
at 390/768/1440 pixels with no overflow or browser errors. Browser scenarios use
real components/adapters and synthetic transport; real emulator authority
evidence is recorded separately. Default and feature-enabled Ambient builds
pass, as do capability, documentation and quick-lane checks.

The compatibility bundle remains above its unchanged ceilings: 3,281,790 total
JavaScript bytes and a 401,792-byte largest chunk versus 3,221,176 and 391,901.
The total is 89 bytes above the earlier program baseline; the largest chunk is
unchanged. This remains a release/commit qualification concern. All A–F source
changes remain uncommitted in the isolated worktree. Phase 4 workflow packs and
Phase 5 migration/pilot/promotion remain open; no tenant activation, provider
enablement, deployment, human acceptance or customer outcome is claimed.


## Authorized continuation through the program end

The owner subsequently instructed: “proceed through to the end.” This extends
the earlier Configuration Studio boundary to the four domain packs and all
locally executable migration, rollback and release preparation. Phase 4's
accepted schema 2 contract is recorded in the
[ADR](../TENANT_OPERATING_MODEL_ADR.md#phase-4--accepted-domain-pack-contracts).
The earlier A–F checkpoints remain historical evidence.

The inherited compatibility bundle blocker is resolved locally without widening
budgets: excluding unused optional jsPDF HTML/SVG renderers and separating the
legacy portal chunk produced 2,907,045 total JavaScript bytes and a 385,130-byte
largest chunk, within the existing 3,221,176/391,901 limits. Existing PDF tests
pass. Final pack qualification must rerun both release build profiles.

Phase 5's real tenant/event cohort and moderated acceptance operator are not yet
selected. The local inventory, emulator cohort and candidate profile do not
substitute for that decision or for customer impact evidence.


The owner's Phase 4 clarification explicitly separates canonical domain state,
immutable tenant workflow configuration and execution progress. Publication,
migration and task acknowledgement must preserve canonical domain records;
native domain actions retain their original authority and receipts. See the
[accepted separation](../TENANT_OPERATING_MODEL_ADR.md#canonical-domain-state-tenant-workflow-and-execution-progress).

## Phase 4 Source Completion and Pilot Handoff

All four bounded packs now share the schema 2 execution contract and have
role-safe UI, immutable native evidence bindings and explicit migration.
Canonical domain state, immutable tenant configuration and execution progress
remain separate. The original commercial policy survives later coordinator
migration. Reviewed attendance application creates a new draft and requires
renewed acceptance while retaining original booking/payment evidence.

The full suite passes 4,748 tests (83 skipped), rules pass 81, Python passes 136,
and both final builds and unchanged bundle budgets pass. Responsive four-pack
browser and original-operation recovery fixtures pass. The final all-four
emulator matrix passes enabled, imported global-disabled and restored runs with
identical source hashes and retained state. It proves native-owner composition,
canonical-preserving configuration/migration and exact replay after rollback. Offline inventory
and isolated staging configuration are implemented without application writes.

The [pilot matrix](../acceptance/tenant-operating-model.md) is ready for the exact
real tenant, cohort and operator. No baseline, customer/provider outcome,
production readiness or moderated human acceptance is inferred from local tests.
The full program remains open until that pilot yields an explicit decision.

Final local evidence is captured in `/tmp/qp-tom-studio-checkpoints/end/` with
source hashes, validation reports and LOC differences from the base and F.
Historical A–F checkpoints are preserved. The populated emulator artifacts
retain 5 workflow instances, 22 coordinator receipts and 2 phase ledgers across
all three modes; they establish no hosted, provider or human outcome.


## Local pilot continuation: slices I and J

The owner accepted local reconciliation, local commits and a hands-on rehearsal
before any push, and explicitly retained the same delivery contract. The prior
A–F/end checkpoints remain immutable historical evidence.

Slice I reconstructs the exact 140-file completed TOM delta on current main
`8f2d2dcf78d4512aa7d02495ee27cbeeea4ccc12` in
`feature/qp-tom-local-pilot-20260905`. Server ownership covers native authority
composition; client ownership covers current-main UI composition; verification
ownership covers release profiles and emulator evidence; the coordinator owns
canonical docs, capability mapping, integrated qualification and local commits.
Each owner runs its planner and focused checks; integrated validation includes
unit/rules/Python, read-only evidence coverage, both build budgets and governance.
The completion planner records the exact UTC timestamp and immutable hashes.

Slice J supplies a reproducible, disposable whole-app rehearsal using real local
Auth, Firestore and Functions with synthetic demo data. It retains normal login,
role checks and native actions. Library exposes Business workflows and all four
packs. Browser review and operator instructions follow actual startup validation.
Human comprehension, real customer behavior and hosted/provider outcomes remain
separate pending proof events. No push or deployment is authorized by this step.

Current-main catalog-review authority remains mandatory. The local cohort uses
fresh current-catalog confirmed quotes. Legacy/changed-catalog accepted or booked
quotes cannot be amended through this path because the native catalog-review
owner rejects terminal sources. Recovery requires separately reviewed policy or
a new agreement; rehearsal must neither bypass the gate nor invent its receipt.
