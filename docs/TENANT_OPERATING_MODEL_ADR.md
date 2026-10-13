# Tenant Operating Model: Versioned Execution and Event Operating Spine

Last updated: 2026-09-05 16:46:47 CDT

Status: accepted for bounded local implementation under the owner's delegated
"Approve for me" instruction, carried forward with the handoff on 2026-09-05.
Program: `QP-TOM-020`; first slice: `QP-TOM-020-A`.
Baseline: `7853aa4028b0fad9f7d6d7be8aca99d2460f3f04`.
Implementation branch: `feature/qp-tom-020-event-spine` in the isolated sibling
`/home/administrator/projects_new/quoteflow-tom-020`.

## Decision and scope

Deliver the Tenant Operating Model through the Event Operating Spine first.
Slice A initializes an operational record for an exact booked event and records
admin-directed phase changes with immutable receipts. It does not implement the
full four-to-six-week milestone or tenant-configurable workflow definitions.

This ADR extends the original [Event Workspace ADR](EVENT_WORKSPACE_ADR.md):
its presentation composition remains valid. The new ledger owns only newly
recorded operational facts. It must not copy or replace mutable commercial,
customer, pricing, acceptance, payment, staffing, BEO, or closeout authority.
Deleting the coordinator must leave those domain records and receipts intact.

## Identity and source fence

One ledger is keyed by a deterministic digest of the exact tuple:

`organizationId + quoteId + sourceVersionId + acceptanceReceiptId`.

Do not introduce an occurrence identity without a proved repeated-event need.
Use the existing private acceptance verification from
`functions/postEventCloseout.js#resolvePostEventCloseoutSource`: booked status,
current active immutable version, exact tenant/quote/customer/date, matching
private acceptance receipt and accepted snapshot digest. Its returned
commercial facts are verification inputs, not fields to duplicate into the
operational ledger.

The ledger pins schema version, built-in workflow kind, template/policy version,
and canonical digest. The initial policy is explicitly a QuotePilot-fixed
version, not a tenant-published definition or inferred historical policy.
Changing the active commercial source requires a separately reviewed successor
binding; never silently rekey, migrate, or overwrite an existing ledger.

## Fixed vocabulary and authority

The four reserved workflow kinds are `quote_review`, `final_guest_count`,
`event_execution`, and `closeout_follow_up`. Only `event_execution` executes in
Slice A. Other packs remain unimplemented; their domain-specific transitions
must be accepted in their own slice before runtime binding.

The operational transition vocabulary is:

| Command | Required current state | Result |
|---|---|---|
| `initialize` | No ledger; expected revision 0 | `prepared`, revision 1 |
| `transition` to `in_progress` | `prepared`, exact revision | `in_progress`, revision +1 |
| `transition` to `completed` | `in_progress`, exact revision | `completed`, revision +1 |

No skips, reopen, arbitrary state names, user code, or automatic transitions.
`prepared` records initialization; it is not a readiness verdict. `completed`
records an administrator's operational declaration; it does not complete
post-event review, prove attendance, satisfy payment, or establish actual costs.
A future correction/reopen protocol needs its own immutable receipt design.

The existing runtime has `admin`, `sales`, and `customer`, not operations or
finance roles. Current verified user-role documents, tenant membership and
active-tenant checks remain authoritative; token claims cannot widen them.

| Runtime actor | Slice A permission |
|---|---|
| Current tenant admin | Read, initialize, advance allowed phase |
| Current tenant sales | Bounded read only |
| Customer, unknown role, foreign tenant, unverified or removed user | Denied |
| Operations / finance persona | No implicit role grant; future role program |
| AI, scheduler, provider callback | No transition authority |

## Server protocol and recovery

Callables: `getEventOperatingSnapshot` and `applyEventOperatingCommand`.
The mutation binds organization, quote, exact accepted version and receipt,
request ID, command, expected ledger revision, and target phase. Server time and
current actor supply receipt identity; the browser cannot declare either.

Every mutation rechecks current authority and both gates. Within the atomic
transaction, check an exact prior request receipt before testing present source
freshness. Verify its payload/actor binding and integrity. This lets a response
lost before a later source change reconcile without executing again. A changed
payload or actor using the same request ID is rejected. A fresh command reloads
and verifies exact source evidence and compare-and-swap revision before any
write. Concurrent commands cannot both advance the same revision.

The browser freezes an uncertain request and reconciles the same request ID and
payload. It must not label an ambiguous transport error a rejected write or
create a new request to retry blindly. Old scope/principal responses cannot be
applied to a new screen. Offline mutation and durable browser mutation queues
are out of scope; local fallback remains non-authoritative.

Records live under
`organizations/{organizationId}/eventOperatingLedgers/{ledgerId}` with private
`receipts/{requestHash}` children. Browser get/list/create/update/delete is
denied even to same-tenant admins; callables expose bounded projections only.
Slice A shows the latest receipt, not full Replay history. Full Replay remains
unavailable until a separately bounded history read exists.

## Configuration and migration allowlist

| Class | Decision |
|---|---|
| Tenant-configurable now | None; fixed policy version 1 |
| Tenant configuration later | Named task templates, due/escalation offsets, existing-role ownership within platform ceilings, approved communication-template references; phase-specific review required |
| QuotePilot-fixed safety | Tenant/role checks, source and revision fences, receipt immutability, allowed commands, evidence availability, no direct client writes |
| Runtime / provider configuration | Independent default-off runtime and tenant gates; provider credentials remain outside workflow policy |
| Unsupported | Executable expressions, arbitrary states/graphs, cross-tenant data, inferred thresholds, autonomous approval/send/payment/assignment |

Publishing later versions affects new instances only. Existing instances retain
their exact policy and source pins. Slice A supports no active-instance
migration, backfill, legacy synthesis, or automatic upgrade. An explicit future
migration must preview compatibility and produce a separate receipt.

## Local cohort, offline decision, and pilot gate

The delegated decision authorizes online-only local development using synthetic
fixtures, including two isolated organizations, admin/sales/denied principals,
and exact synthetic accepted-event sources. No real tenant is selected or
activated here. Production and hosted writes remain unauthorized by this ADR.

`EVENT_OPERATING_SPINE_ENABLED`,
`organizations/{organizationId}/settings/config.eventOperatingSpineEnabled`, and
`VITE_EVENT_OPERATING_SPINE_ENABLED` default off. Both server gates must allow
access independently of the browser gate. Rollback disables the server gate,
preserves ledgers and receipts, and returns the UI to existing planning views.
Enabling a tenant or deploying requires its own governed release decision.

Handoff misses, closeout latency, actual-capture completeness, workflow age,
and reconstruction time have no measured baseline for this slice. They remain
explicitly unavailable until an approved real cohort is observed. Real pilot
selection, dependable dead-zone requirements, human acceptance and outcome
measurement are pilot gates, not claims produced by unit tests.

## Threat model and verification

| Threat | Required control and proof |
|---|---|
| Cross-tenant source/receipt substitution | Exact private-source binding and denied tests before projection/write |
| Role removal or claim escalation | Reload current authority, reject unverified/foreign/inactive access |
| Browser ledger or receipt tampering | Deny all direct collection access in Firestore emulator |
| Duplicate, changed-payload or changed-actor retry | Exact request and receipt digests; reject collision; one revision advance |
| Concurrent or stale command | Atomic revision fence, no partial receipt or ledger writes |
| Lost response after later source change | Return original verified receipt without replaying mutation |
| Retroactive policy changes or unknown schema | Pin and validate built-in version/digest; reject unsupported records |
| UI stale response or hidden retry | Principal/object-scoped results and frozen uncertain request; explicit reconciliation |
| Recorded phase misread as business proof | Outcome-specific copy; no mutations of existing domain authorities |
| Provider or customer data exposure | Bounded projection, no raw acceptance snapshot, no customer-facing ledger |

Slice A requires focused authority/client/component tests, all applicable
canonical capability-state assertions, current role/tenant denial tests,
Firestore rules, unit suite, build/environment, capability/document governance,
project-state consistency, and responsive keyboard/overflow verification.
Source/local proof, hosted behavior, provider evidence, production, human
acceptance, adoption, and customer outcomes remain separate.

## Next dependencies

After Slice A review, independently plan checkpoints/issues, operational actuals,
closeout composition, bounded Replay, and read-only `actualConsumption` export.
Only after the Event Operating Spine and a second workflow demonstrate shared
needs should execution mechanics be extracted. Tenant policy publication and
configuration belong to later phases of the [program plan](plans/20260905-tenant-operating-model.md).

## Slice B — Operator checkpoints and issue journal

The owner's request to continue to the next slice authorizes this bounded local
extension. The Control Room is the execution workspace for one booked event:
current recorded phase, next permitted action, operator checkpoints and open
exceptions. Now remains cross-event attention; Event Focus supplies event
context; full Replay remains a later historical-evidence surface.

### Separate authority and compatibility

The phase `POLICY`, its digest, schema, records, and immutable receipts remain
unchanged. A separate fixed work policy version 1 binds an operational journal
to the same exact accepted-source ledger identity. It has its own revision and
immutable receipts. A phase transition cannot create checkpoint evidence or
resolve an issue; a work command cannot advance or reopen the phase.

Persistence adds only private children of the existing ledger:

- `workState/current`: bounded current checkpoint and issue state;
- `workReceipts/{requestHash}`: immutable request, actor, time, source, policy,
  before/after work revision, observed phase receipt and result-state evidence.

Every new work command rechecks current tenant/admin authority and existing
server/tenant gates, reloads exact accepted source, verifies an initialized
phase ledger against its trusted receipt, verifies the current work state and
receipt, and atomically compare-and-swaps the independent work revision.
Recorded work stays valid when the phase later advances. It is never rewritten
to match a newer phase receipt or policy. Sales gets bounded reads; no new
runtime role, provider action, customer projection or browser write is added.

### Fixed checkpoint and issue vocabulary

| Command | Requirement | Recorded result |
|---|---|---|
| `checkpoint_record` | Fixed checkpoint is not recorded or is reopened; optional note | `recorded` |
| `checkpoint_reopen` | Checkpoint is recorded; required reason | `reopened` |
| `issue_open` | Required description and normal/urgent severity; fewer than 25 retained issues | New server-identified `open` issue |
| `issue_resolve` | Exact open issue; required resolution note | `resolved` |
| `issue_reopen` | Exact resolved issue; required reason | `open` |

The four checkpoint codes are `venue_access`, `team_briefing`,
`service_handoff`, and `pack_down`. They describe operator-recorded activities,
not universal catering readiness criteria. Unrecorded checkpoints explicitly
remain `not_recorded`. Reopening preserves prior receipt history rather than
erasing or silently editing a declaration.

All notes/descriptions are plain bounded text, maximum 240 characters. Required
notes reject whitespace-only values. Unknown command fields and states fail
closed. Issue IDs are derived server-side from the exact request identity;
severity and original description are immutable. The cap is 25 retained issues,
including resolved issues, so reads and receipt snapshots stay bounded. Hitting
the cap blocks another issue opening, not resolution or checkpoint updates.
There is no delete, arbitrary checklist builder, assignment, automatic
escalation, notification, occurrence backdating or tenant-authored expression.

Work may be recorded or corrected in any initialized phase, including
`completed`. Server timestamps state when an operator recorded it, not when an
unobserved activity happened. Completing the phase does not resolve open issues.
This is not staffing attendance, payment, customer delivery, readiness, actual
labor/purchasing, or authoritative closeout evidence.

### Read, mutation and ambiguous outcome contract

`getEventOperatingWorkSnapshot` reads an exact organization and quote.
`applyEventOperatingWorkCommand` binds that scope, accepted version and receipt,
request ID, `workPolicyVersion: 1`, `expectedWorkRevision`, the named command and
its typed fields. Existing phase callables and response shapes remain intact.

A missing phase ledger returns `not_yet_available / phase_ledger_missing`.
A verified phase with no work record returns
`not_yet_available / journal_empty`, revision 0. Static checkpoint labels in
that view are available choices, not inferred completion evidence. The first
valid work mutation creates revision 1 and its receipt atomically. Existing
journal state returns `available` with an exact latest receipt. A bounded
receipt-existence check distinguishes a genuinely empty journal from missing
current state with retained history; orphaned state or receipts fail closed as
`data-loss` instead of resetting revision or capacity. Full history is
not claimed; coverage remains `latest_receipt_only`.

Request and receipt integrity covers the complete typed payload, current actor,
policy pin, exact source, before/after work revision and resulting bounded
state. Replay verifies the original receipt before current source freshness,
while still enforcing present authorization and gates. Changed payload or actor
cannot reuse a request identity. A recovered receipt is historical command
success; current journal evidence must be refreshed before another action.

Both browser clients share a synchronous, principal/tenant/quote-scoped mutation
exclusion guard. Pending or uncertain phase work blocks a new journal command,
and vice versa. The original request remains reconcilable by its owning
channel. Duplicate in-flight calls for that exact request share one transport
completion, so a late duplicate cannot resurrect unresolved state after success.
A later authorization or gate denial cannot turn an earlier ambiguous
result into a known rejection. Route remounts and accepted-source changes retain
the original unresolved request and prevent a new request from replacing it.
The guard coordinates browser interaction; server transactions retain authority
across tabs and users. Offline queues remain unsupported.

### Slice B verification and stopping boundary

Required local proof includes prior phase-policy compatibility, immutable
phase/commercial records before and after work commands, work concurrency and
rollback, missing/tampered source and receipt denial, strict field/text/capacity
bounds, current role/tenant/gate denial, historical replay and cross-channel
browser exclusion. Direct browser access to work state and receipt paths is
denied for every principal. All applicable capability states need executable
component assertions, and the enabled Control Room needs responsive keyboard,
long-content and uncertainty checks.

Slice A's inherited bundle overrun remains recorded in the program plan.
Separate Slice A source copies and digests were captured locally before Slice B
edits for review and LOC measurement; neither that snapshot nor local source
progress is a commit, release exception, deployment or tenant activation.
Operational actuals, closeout adapters, full Replay, tenant configuration and
Truth Loop export remain subsequent work.

## Slice C — Declared operational actuals

The authorized continuation through Configuration Studio adds a separate
`event_actuals` journal under the exact accepted event ledger. Policy version 1
pins the original phase policy; phase/work modules, ledgers and receipts remain
unchanged. Private children are `actualsState/current` and
`actualsReceipts/{requestHash}`. Every new command validates current admin and
tenant authority/gates, exact accepted source, initialized verified phase,
current actuals state/receipt and the independent actuals revision in one
transaction. Missing current state with retained receipts and parentless
actuals fail closed. Exact original request replay precedes present source
freshness after present authorization. No history scan is required for writes.

### Amounts, categories and limits

Capture categories are `labor`, `purchasing`, and `other`. Every active entry
records an operator description and explicitly declared nonnegative integer
`costCents`, in fixed server-policy USD. Labor also records integer
`durationMinutes` and a fixed `laborRole`: lead, server, chef, bartender or other.
These are recorded costs and durations, not inferred wages, attendance, payroll,
payment, inventory movement, physical consumption or provider evidence.
Staffing attachment is deferred to a trusted by-reference adapter.

Unknown costs are omitted entries with category capture still undeclared or
partial. Zero is an explicitly entered amount, never a fallback for missing
information. Maximum cost per entry is 1,000,000,000 cents; labor duration is
1–10,080 minutes. The journal retains at most 50 entries including voided
entries. Description, declaration note and correction/void reason are bounded
to 240 characters. All required text rejects blank values, unsupported fields
and unsupported enums. Non-labor entries reject labor fields.

### Typed command and correction contract

Both callables use the established exact organization/quote envelope:
`getEventOperatingActualsSnapshot` and `applyEventOperatingActualsCommand`.
Mutation additionally binds exact source version/acceptance receipt, opaque
request ID, `actualsPolicyVersion: 1`, `expectedActualsRevision` and one command:

| Command | Typed payload | Effect |
|---|---|---|
| `record` | Category, description, cost cents; labor-only role/minutes | Server-derived entry identity and new active entry |
| `correct` | Exact entry ID, full same-category fields and required reason | Replace current declaration while retaining prior immutable receipt evidence |
| `void` | Exact active entry ID and required reason | Terminal void; retains lifetime capacity and original entry identity |
| `declare_category` | Category, complete/not_applicable/partial and required note | Explicit operator statement about capture completeness |

Category cannot change through correction. Every entry change resets that
category to partial and clears its current completeness declaration; the
previous declaration remains in its immutable receipt. `not_applicable`
requires no active entries. `complete` can explicitly declare confirmed zero
with a required note. `partial` lets an operator record what remains missing.
Completing the event phase never declares capture complete.

### Projection and evidence boundaries

The bounded snapshot carries exact source/policy identity, fixed USD currency,
independent revision, up to 50 current entries, three category declarations,
provisional captured totals, `captureComplete`, and the exact latest receipt.
Totals cover recorded active entries only and are never sufficient completeness
evidence. All three categories must explicitly be complete or not applicable
before `captureComplete` becomes true. This flag is operator-declared capture
completeness, not proof of delivery or cost verification.

Availability is `not_yet_available / phase_ledger_missing` before valid phase
initialization, `not_yet_available / actuals_empty` before any actuals receipt,
and `available` for a verified journal. Snapshot entries expose only the bounded
recorded values and safe receipt/time references. Private receipts also bind
actor, request, result-state digest and observed phase revision/receipt. Current
projections must match the full latest receipt result; recomputing a digest
cannot make structurally invalid states acceptable.

The shared browser guard now excludes phase, work and actuals commands for the
same principal/tenant/event. Exact in-flight retries share one promise. Unknown
outcomes freeze the original command across remount, source change and later
authorization denial. Historical success refreshes current evidence before
another action. Sales reads; only current admins record or declare. Browser
collection access remains denied to every principal.

### Follow-on export requirements

The existing actual-consumption producer must not be activated unchanged:
it currently defaults absent categories to zero and lacks the exact operational
receipt binding. Slice D must validate exact organization, quote, accepted
version/receipt, actuals revision/receipt and explicit category declarations.
Neither a past event date nor the recorded completed phase proves delivery.
Overrun tolerance requires separately declared policy with actor/time evidence;
capture alone does not establish a trustworthy within-tolerance verdict.
The exporter and Python reconciler remain read-only, credential-free and
network-free. Monetary capture does not create quantity-consumption evidence.


## Slice D — Operational Replay and declared-cost evidence

Accepted for local implementation under the existing delegated design decision.
The three original pure phase, work, and actuals policies remain unchanged.

`getEventOperatingHistory` reads the current exact accepted source and merges
verified phase, work, and actuals receipts. Each first page pins three channel
heads. Each page emits at most 20 rows from bounded per-channel reads, ordered
by recorded time, channel, and revision. Subsequent pages retain those anchors;
new writes are reported as newer evidence requiring a refresh. Source changes,
missing revisions, invalid receipts, or contradictory ordering fail closed.
The bounded cursor is pagination position, not signed authority or proof of
unbroken user traversal. Every call rechecks current tenant, role, and rollout
authority. Reads never resolve an uncertain mutation automatically.

Public rows expose only bounded command, actor identifier/role, time, target,
and typed before/after evidence. Private receipt bodies, email addresses, and
provider data remain hidden. Full operational Replay covers these three
channels for the exact current accepted source; current staffing, BEO,
dependency, and run-of-show references retain their own domain meaning.
Missing parent ledgers with any retained phase/work/actuals evidence cannot be
recreated. Existing exact request receipts remain replayable after current
role and tenant authorization, before source freshness checks.

The read-only actuals projection validates private acceptance, phase and
actuals receipts, plus each retained category declaration. It emits an
allowlisted aggregate only when labor, purchasing, and other are each
explicitly complete or not applicable. Partial categories, unknown costs, and
invalid evidence never become zero. Recorded costs may exist before the event
has occurred; an elapsed event date never proves capture or delivery.
Labor is operator-declared cost/duration rather than attendance or payroll;
purchasing is declared cost rather than physical consumption or payment.

Overrun comparison requires explicit numeric tolerance, declaring actor, and
declaration time. Missing policy stays unverifiable and is included in the
coverage blockers. No comparison rate is inferred from historical costs, and
neither the pure producer nor the Python reconciler gains credentials,
network access, or a state write path. The existing explicitly invoked,
tenant-scoped Firestore reader supplies private evidence to the pure verifier
and discards private details before export.


## Slices E and F — Versioned coordination and Configuration Studio

Accepted for bounded local implementation. This section defines the contract;
completion remains a separate validation checkpoint. The existing delegated authorization permits routine local design review;
human usability acceptance remains separate.

A tenant definition is separate from the fixed phase, work and actuals
policies. Its exact schema permits only a name, task roles, named task
templates, due offsets, escalation timing, an optional actual-cost review
threshold, optional declared comparison tolerances, and fixed manual handoff
references. Unknown fields, code, conditions, URLs, recipients, or cross-domain
field paths are rejected. Admin remains a required task role; sales may be
allowed for assigned coordinator tasks. Configuration cannot grant sales the
existing administrator-only phase, work or actuals commands.

At most 12 task templates have stable keys, bounded labels/instructions,
enabled owner roles, bounded due offsets, and an optional fixed reference to
`internal_event_brief_v1` or `post_event_review_v1`. Those references expose
source-defined operator handoff guidance; they do not send communication.
Global and task due offsets, and escalation after a due time, are bounded to
0–43,200 minutes and derive from immutable instance creation time plus explicit
server observation time. Escalation points to an administrator and creates no
notification, background write, or new domain authority.

The optional actual-cost review threshold is an integer from 0 to 1 billion
USD cents. Complete declared capture at or above that threshold requires a
separate administrator acknowledgement of the exact actuals revision and
receipt. Incomplete capture remains unavailable for this review decision.
Any subsequent actuals revision makes that acknowledgement historical rather
than current, including correction, void, or a new completeness declaration.
This is an internal review obligation, not approval to spend or a block on
recording facts. Optional comparison policy carries all three explicit
labor/purchasing basis-point and minimum-cent values; publication supplies its
declaring actor and timestamp. Missing policy remains missing.

Definitions use a CAS-protected draft/head, immutable published versions, and
immutable lifecycle receipts. Publication previews the exact draft, head
revision, candidate version and digest before requiring typed confirmation.
There are at most 50 tenant versions over the definition's lifetime. Retiring
an active definition prevents new bindings without rewriting published bytes;
existing bound instances retain their version. A new publication never changes
an existing instance.

An explicit, source-controlled QuotePilot seed version is used for new
instances only while the tenant has never published. Its fixed provenance and
digest are validated as seed evidence; callers cannot manufacture a seed by
setting a flag. The seed declares no review threshold or comparison tolerance.
Retirement does not silently fall back to the seed. Pre-existing phase ledgers
without a coordinator binding remain honestly labeled legacy fixed-policy
records, with no invented tenant-definition history.

A separate workflow instance pins the exact tenant, workflow kind, subject
revision and source receipt, plus the immutable definition. Its own revisions
and receipts retain task acknowledgements and trusted domain outcome
references. The event adapter calls the unchanged phase authority and records
the phase outcome reference in the same transaction; it does not copy quote,
price, payment, staffing, or cost-entry state. Task acknowledgement means the
operator checked a named obligation. It does not prove a domain action was
performed. Reopening requires a reason. Assigned enabled staff or an
administrator may acknowledge a task; cost review remains administrator-only.

Compatible migration has a separate preview, exact source and instance CAS,
old and target definition digests, typed confirmation, and immutable receipt.
Initially it requires the same workflow/schema/domain policy, no removed task
keys, unchanged acknowledged task templates, and unchanged review/comparison
policy. Changes to open tasks and added tasks are shown explicitly. Migration
never rewrites phase, work, actuals, or historical coordinator receipts.
A second thin post-event-review fixture must exercise the same generic
instance, task and receipt mechanics before reuse is claimed; this fixture
does not deliver a second commercial workflow pack.

Configuration Studio belongs in the existing administrator-only Library.
It exposes draft, validation, preview, publication, retirement, conflicts and
exact-request recovery. The event Control Room exposes the pinned policy and
coordinator obligations to eligible staff. Migration effects are previewed
separately from future-instance publication. Existing runtime and tenant gates
remain default off; publishing neither deploys code nor activates a tenant or
provider integration.


## Canonical domain state, tenant workflow and execution progress

The owner explicitly confirmed separating canonical state from configurable
workflow during Phase 4 integration. These are three distinct authorities:

| Layer | Owns | Must never imply |
|---|---|---|
| Canonical domain state | Exact commercial revisions, private acceptance receipts, provider payment facts, recorded operational actions and closeout records | A task acknowledgement or configured status is proof of a domain outcome |
| Tenant workflow definition | Immutable versions of responsibilities, prerequisites, approval thresholds, task instructions and timing | Publishing or editing policy changes an existing agreement or historical fact |
| Workflow execution progress | The exact definition/source pin, task acknowledgements, migration receipts and references to verified native observations | Progress can replace a canonical domain record or its receipt |

A workflow may require an approval before an action. The original domain owner
validates and performs that action and issues its native receipt. Coordination
records the verified result atomically; it cannot independently set accepted,
paid, applied, booked or completed business state. A recorded operational
completion remains an operator declaration, not inferred physical service proof.

Configuration publication, retirement, compatible migration and task updates
must preserve canonical domain bytes. Explicit domain commands may change only
their owned canonical records plus the paired coordination evidence. Existing
native policy and receipt schemas remain authoritative. Workflow labels and
progress are presented separately from domain state in the interface.

The attendance amendment is therefore a commercial-domain transition with
explicit renewed-acceptance semantics. Its meaning does not come from a tenant
workflow label. A new tenant configuration cannot make a proposed count applied,
carry old acceptance to a new agreement or mark a payment received.

## Phase 4 — Accepted domain pack contracts

The owner's instruction to proceed through the end extends local implementation
through all four packs and Phase 5 qualification. The server, client and
verification owners retain separate file responsibility in the same isolated
checkout. Deployment, real tenant activation, provider communication and
moderated operator acceptance remain explicit evidence boundaries.

Schema 2 adds a required, bounded `packPolicy` to immutable tenant definitions.
Schema 1 definitions, built-in event seed and receipts retain their original
meaning and digest. There is no schema 2 seed: quote review, final count and
closeout require an explicit tenant publication. Cross-schema migration is
incompatible. A later publication does not replace any existing instance pin.

| Pack | Existing domain authority | Additional tenant constraint |
|---|---|---|
| Quote review | Commercial Change simulation, authorization, apply and reconciliation | Allowed staff roles and an optional absolute total-change threshold in USD cents |
| Final guest count | Exact accepted source, private request/submission journal and Commercial Change apply | Responsible staff roles; due date uses the existing Decision Debt guest-count policy |
| Event execution | Original phase, checkpoint/issue and declared-actuals planners | Required checkpoints, prerequisite ordering and open urgent-issue blocks |
| Closeout follow-up | Original post-event closeout review planner and reviewed rebooking handoff | Responsible staff roles and calendar-day follow-up offset from the original closeout due date |

All additional constraints narrow original domain authority. Administrator
approval remains mandatory wherever Commercial Change already requires it,
even if a tenant threshold is higher. Threshold comparison is inclusive and
uses authoritative decimal money converted with half-up rounding to cents.
Null adds no threshold; zero requires approval for a known zero delta. The
simulation, authorization and apply receipts seal the same policy publication,
actor/time and evaluated before/after cents. Unknown or cross-tenant seals,
coerced identifiers, changed policies and mismatched replay receipts fail closed.

Schema 2 domain references distinguish immutable receipts from verified record
snapshots. They identify the adapter, exact source digest, evidence identity and
digest, native policy digest, state and observation time. The coordinator never
invents a domain revision. Bounded private observation proofs retain the exact
source and prior/result records needed to reproduce the existing owner planner;
they are immutable evidence, not a second mutable domain record. Missing,
orphaned or inconsistent proof prevents a transition or migration.

Staff can acknowledge only enabled tasks assigned to an allowed current role.
Tasks do not approve a price change, confirm a count, complete closeout or send
a message. Calendar dates retain tenant time zones and are never silently
converted to UTC instants. Operations and finance remain responsibilities;
unsupported platform roles receive no implicit grant.

### Attendance planning and customer response

Trusted quote creation accepts only reviewed planning kind, value, nullable
bounds and `staff_intake` source type. The value must equal the authoritative
priced count, within the new envelope's 1–400 bounds. Approximate evidence may
omit both numerical bounds; presentation-derived margins are not persisted as
observations. The server stamps actor, time and immutable version reference.
Normal forms cannot declare customer confirmation or a commercial apply receipt.
Omitted metadata preserves legacy behavior. Duplicating a quote does not copy
old confirmation evidence. Local fallback uses explicitly local provenance and
has no server authority.

Final-count requests and responses use a separate exact-source, compare-and-swap
journal. They do not overwrite the versioned quote's applied count. The due date
comes from the validated Decision Debt `guest_count.lockWindowDays` policy and
its tenant-calendar helper; `policyReferenceId` identifies that policy, not a
fabricated unresolved decision. Request creation is not delivery. Portal access
requires the current valid issuance, existing provider-accepted activation,
current tenant and exact source; its actor is the issued token, not a verified
person. The public availability flag is a display hint, never authorization.

A response binds its exact immutable submission receipt to Commercial Change.
Even a matching count requires an explicit no-impact apply and new version
before it is labeled applied. Pricing, payment and acceptance remain governed
by their original authorities. Actual attendance remains unavailable unless
separately recorded by its own accepted closeout contract; a received or applied
final count never stands in for actual attendance.

## Phase 5 — Local inventory and release preparation

The offline inventory consumes a bounded private source bundle and emits only
safe IDs, digests, pins, counts, explicit gate observations and classifications.
It performs no network access, credential lookup, mutation, bulk apply or
historical evidence creation. A dry run is advisory: initialization and every
migration recheck live authority, source, gates and publication.

The isolated `staging-event-operating-spine` release profile binds explicit
server and browser flags while retaining independent tenant activation. Existing
profiles retain their prior shapes and default-off behavior. An exact local
fixture or emulator cohort is not the real founder pilot. The tenant, event
cohort, operator walkthrough and impact baseline must be selected before hosted
pilot and promotion decisions can be completed.

### Native policy origin and migrated coordination

A quote simulation seals its original immutable approval publication. A later
compatible coordinator migration changes the instance publication only; reads
verify both the native origin publication and the current coordinator pin.
Simulation, authorization and apply receipts keep their original policy bytes.
The offline inventory reports the two pins independently. Publication, task
acknowledgement, retirement and migration never rewrite canonical domain facts.

An instance's calendar/timezone schedule anchor is fixed at initialization.
Later native timing changes are recorded as native evidence; they do not silently
reschedule the coordinator. Rescheduling existing tasks requires a separately
authorized future coordinator contract. Current owner eligibility and native
source freshness continue to be checked for every consequential operation.
