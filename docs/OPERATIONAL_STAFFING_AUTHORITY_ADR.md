# Authoritative Operational Staffing ADR

Last updated: 2026-09-13 01:56:31 CDT

Status: deployed in exact `v0.15.0` behind independent presentation, server,
and tenant gates. The first two gates are deployed on; protected workflow run
`33282940451` verified the selected founder-pilot tenant false-to-true change
with readback. Deployment and tenant readback do not establish hosted behavior,
provider outcomes, or human acceptance.

The September 9 staffing refoundation and Fulfillment composition are a
source/local candidate on top of that deployed authority. They do not establish
a new deployment, tenant activation, hosted authenticated journey, provider
outcome, or human acceptance.

## Decision

QuotePilot will treat operational staffing as a tenant-isolated authority that
is separate from quoted labor, booking labels, BEO content, attendance,
payroll, and event readiness.

The authority records only three bounded facts:

1. An administrator configured a safe staff profile and operator-recorded
   availability windows.
2. An authorized administrator or sales operator recorded an exact person,
   role, quote revision, and event-window assignment as
   `operator_confirmed`.
3. The complete schedule-fence evidence available to that transaction did not
   contain an overlapping operator-confirmed assignment.

Those facts never establish that the staff member acknowledged the assignment,
attended, was paid, is qualified beyond the configured capability, or that the
event is booked or ready.

The administrator-only Staff workspace adds a paired private directory record,
but it does not widen assignment-plan authority. Contact, photo, qualification,
rate, travel, briefing, attendance-summary, reliability and note fields are
trusted operator records. They remain distinct from the safe profile consumed
by operational planning and from member acknowledgement, payroll, attendance,
provider delivery or event-readiness evidence.

A valid roster identity is intentionally smaller than that private record. An
administrator may create an active safe profile with a display name and at
least one role capability. The command sends `availabilityWindows: []` and
uses the existing replay-stable `configureOperationalStaffProfile` receipt;
it does not synthesize a private record. Contact, availability, rates,
qualifications, photos, and other HR enrichment can be recorded later when a
workflow actually needs them.

Recovery preserves the mutation boundary. A transport-uncertain roster save
keeps the exact command locked and reconciles with the same request identity.
A definitive rejection, including `aborted` or `data-loss`, keeps the entered
draft locked until an explicit local clear resets that matching attempt. Clear
performs no replay and preserves the draft; a later deliberate submit receives
a fresh request identity.

The first outbound communication slice is deliberately manual. An
administrator previews a message generated from one exact quote revision,
staffing-plan revision, operator-confirmed assignment, private-record revision,
and verified private email. Dispatch recomputes that scope before one
idempotent provider attempt. The response link is HMAC-signed and bearer-scoped
to the same immutable invitation. It can write only an accept or decline
acknowledgement and its immutable receipt.

## Why the Existing Fields Are Not Authority

The quote's server, chef, and bartender counts remain commercial pricing
inputs. Existing booking-assignment, schedule, proposal, portal, payment, and
Kitchen BEO fields serve their own evidence domains. None provides a
revision-fenced roster, explicit availability provenance, conflict-safe
concurrency, or an immutable operational assignment receipt.

The new authority copies exact quoted role counts only for comparison. It does
not change pricing or replace authoritative quote creation, repricing, or
version writes.

## Progressive Staff Maturity

Staff profile maturity is a derived presentation, not another authority or a
universal completeness score. QuotePilot evaluates independent facts:

- **Rostered**: active safe profile with a display name and at least one role;
- **Contactable**: a usable recorded email or phone with communications not
  disabled;
- **Schedulable**: at least one valid operator-recorded available window;
- **Cost-aware**: a positive recorded hourly or event rate;
- **Credential-aware**: at least one current recorded qualification; and
- **Enriched**: optional private operational context is present.

An absent optional fact is neutral: `Contact not recorded`, `Availability not
recorded`, `Rate not recorded`, or `Qualifications not recorded`. It becomes
attention only in the workflow that requires it—for example, an email before
invitation preview, availability before availability-backed scheduling, a rate
before individual labor-cost calculation, or a named qualification for a role.
None of these derived states grants permission or proves acknowledgement,
attendance, payroll, booking, or readiness.

## Fulfillment Projection Boundary

Staffing and Inventory compose only in the Commercial Scenario Workbench's
`fulfillmentProjection-v1` read model. They are not merged into a universal
`event` document or a shared mutation authority:

- Commercial continues to own quote/version, guest count, selected menu,
  price, and acceptance state.
- Staffing continues to own safe staff identity, capabilities, availability,
  assignments, and schedule fences.
- Inventory continues to own ingredient identity, stock movements, cost
  evidence, recipes, allocations, consumption, and waste.

The projection is deterministic, privacy-safe, deeply immutable, and
rebuildable from exact source revisions. It may compare the active quote
revision's operator-confirmed assignments with proposed commercial role counts,
but that comparison does not confirm a proposed staffing plan. Independent
People and Supply evidence retain their own `missing`, `not_applicable`,
`not_yet_available`, `stale`, `blocked_by_integration`, `contradictory`,
`schema_drift`, and current states. Only `available` and `not_applicable` can
support a verdict; one failed domain cannot erase a current result from the
other.

The saved **Current** commitment and its Staffing source remain immutable in
the workbench. Temporary **Scenario A** and **Scenario B** are session-only
commercial experiments bound to the same exact base quote revision; switching,
duplicating, editing, or discarding them performs no Staffing write. The
operational Staffing snapshot loads once for the exact organization, quote, and
saved revision and is reused across those scenario views rather than reread for
each guest-count edit. A new Staffing scope generation rejects a late result.
Scenario projection caching does not promote that read into a plan, assignment,
availability confirmation, or new Staffing revision.

The proposed comparison also preserves the saved event-window boundary. The
Commercial Change simulation can request a versioned, response-only Staffing
observation. Inside the same transaction, the server derives event timing and
role requirements from the actual private prospective quote revision and reads
the existing plan before any simulation receipt write. The observation is
bound independently to the base revision, prospective revision, simulation
receipt identity, and receipt digest. It returns aggregate role counts only;
person, assignment, availability, rate, and private staff records do not cross
the Commercial response.

When date, start time, or duration changes, QuotePilot continues to show the
recorded current coverage but the server observation withholds any proposed
coverage or zero-gap conclusion. The proposed requirement remains visible,
while availability and schedule conflicts are labeled not evaluated for the
new window and direct the operator back to event staffing. A stale plan also
withholds the comparison. An exact absent plan establishes zero confirmed
assignments without synthesizing a plan or person. This is read-only change
intelligence, not a proposed Staffing plan, assignment, invitation, or quote
mutation.

An exact current Staffing response with no plan is affirmative zero-assignment
evidence for that saved revision, not `not_yet_available`. Fulfillment composes
it with `assignments: []`, so People reports `0 / required` and the exact gap,
or `not_required` when all role requirements are zero. It keeps the absent plan
and receipt absent; a stale, mismatched, truncated, blocked, or failed read
remains unknown and must never be converted into zero assignments.

People may show current authoritative role requirements, current
operator-confirmed assignments, explicit coverage gaps, and evidence-backed
eligible backups or zero-backup fragility. Proposed role counts remain explicit
commercial inputs; guest count alone does not derive them. A retained prior
scenario projection stays visibly retained while exact consequences recompute
and cannot be called current until its scenario ID, generation, input digest,
and base revision match. No workbench comparison labels a scenario best or
chooses a staffing option automatically.

Numeric staffing headroom requires a complete, current, versioned
`staffing-requirement-policy-v1` that is explicitly operator-declared with
tenant, source, revision, actor, and timestamp provenance and agrees with the
current authoritative role requirements. Existing mock-catalog `STAFF_RULES`
remain advisory UI data and are not eligible. Without that policy, staffing
headroom is **Not verified**. Exact backup capacity additionally requires
complete availability plus conflict-clear schedule evidence; the current
operational snapshot does not expose that combined evidence, so the browser
fails closed rather than counting apparently available people.

Overall headroom is available only when both People and Supply provide exact,
current guest-count boundaries. It is the smaller safe increase. `Safe through
167` from a current count of `125` means `+42 safe guests`; the first changed
requirement occurs at `168`, which is `43 guests away`. These values must not be
collapsed into one ambiguous number. A partial projection is an operator
instruction to complete or refresh evidence, never a zero-capacity conclusion.

## Release Gates

All three gates must remain independent:

- `VITE_OPERATIONAL_STAFFING_ENABLED=true` exposes the staff presentation.
- `OPERATIONAL_STAFFING_AUTHORITY_ENABLED=true` enables the server authority.
- `settings.operationalStaffingAuthorityEnabled=true` enables one exact tenant.

The browser cannot promote any authority gate. A visible source surface,
successful local test, or enabled presentation flag is not authority when the
server or tenant gate is off. The protected tenant operator runs from current
`main`, independently verifies the exact tagged Firebase-all production
runtime and both deployed global bindings, then uses a distinct
Datastore-scoped WIF identity to patch and read back only the approved tenant
field. The PATCH requires `currentDocument.exists=true`, so the custom identity
cannot convert the update into a document create. Run `33282940451` verified
that bounded operation for `mm05366-sandbox` from exact operator SHA
`8582e4ac4dc54c8c2eb60c09bd1b2176cf1cd125`, anchored to the exact `v0.15.0`
Firebase-all receipt. Operator publication, deployed runtime, tenant activation, hosted use,
and human acceptance remain separate evidence events.

The protected tenant operator never selects a tenant implicitly. It accepts the
existing bounded numeric identifier form or the single approved founder-pilot
organization `mm05366-sandbox`, requires the exact typed state-and-organization
confirmation, and still patches only the tenant gate with provider readback.
This exception does not authorize arbitrary slugs, create a tenant, or change
role, staffing, invitation, provider, or acceptance evidence.

## Roles and Tenant Scope

- Same-tenant administrators and sales staff may read the bounded operational
  staffing projection.
- Tenant administrators alone may create or revise staff profiles and
  operator-recorded availability.
- Tenant administrators alone may read or revise full private staff records and
  generate revision-bound staff briefing artifacts.
- Same-tenant administrators and sales staff may apply an assignment plan.
- Customer, unauthenticated, unverified-email, cross-tenant, and unscoped
  principals are denied.
- Platform cross-organization bypass does not apply. The authenticated
  principal's own authoritative organization must exactly match the command.
- Firestore rules deny all browser reads, queries, creates, updates, and
  deletes for the current records, nested receipts, and schedule fences.

## Canonical Inputs

Every read or plan command reloads the exact active immutable quote version.
The server derives:

- the event start from the version's `event.date` and `event.time` in the
  tenant's validated IANA `businessTimeZone`;
- the end from the exact bounded event duration;
- quoted `server`, `chef`, and `bartender` counts from that version; and
- `lead: 0`, because the commercial quote currently declares no lead count.

Missing, invalid, nonexistent daylight-saving, or ambiguous daylight-saving
wall times fail closed. Browser-supplied event windows and counts must exactly
match the server projection.

## Stored Records

All operational records live below the exact organization:

- `staffProfiles/{staffId}`: safe display name, active state, bounded role
  capabilities, operator-recorded availability, and revision.
- `staffProfiles/{staffId}/versions/{receiptId}`: immutable profile-command
  receipt.
- `staffRecords/{staffId}`: private contact/photo, role detail, qualifications,
  scheduling preferences, rates, travel, assignment/briefing defaults,
  attendance summary, reliability and administrative notes.
- `staffRecords/{staffId}/versions/{receiptId}`: immutable private-record
  command receipt paired to the safe-profile command identity.
- `staffInvitations/{invitationId}`: exact assignment and recipient digest,
  provider-acceptance/delivery state, expiry, and invitation acknowledgement.
- `staffInvitations/{invitationId}/staffInvitationReceipts/{receiptId}`:
  immutable manual-dispatch and acknowledgement receipts.
- `staffInvitationProviderEvents/{eventId}` and the global hashed provider
  message index: signed, replay-safe Resend delivery/bounce/complaint evidence.
- `eventStaffingPlans/{quoteId}`: exact quote revision, event window, copied
  commercial requirements, operator-confirmed assignments, coverage gaps, and
  plan revision.
- `eventStaffingPlans/{quoteId}/versions/{receiptId}`: immutable plan-command
  receipt.
- `staffingScheduleFences/{fenceId}`: complete bounded operator-confirmed
  assignment projections for one staff profile and UTC date.

Public projections exclude email, phone, token, provider, payment, portal,
message, payroll, attendance, and internal interval fields.

The Staff directory callable returns private records only to an exact-tenant
administrator. Its event briefings join only an `operator_confirmed` assignment
with the named staffing-plan and immutable quote revisions. Role-specific
content excludes customer contact, pricing, margin, portal tokens and payment
details. Printing/downloading creates a local artifact; opening a `mailto:`
handoff does not prove send, provider acceptance, delivery or acknowledgement.

Manual provider dispatch is stronger than the mail-app handoff but keeps three
evidence domains separate: an accepted Resend API request is
`provider_accepted`; only a verified provider webhook establishes delivered,
bounced, or complained; only the signed response link establishes accepted or
declined. Opens and clicks are ignored for acknowledgement. A late provider
event cannot downgrade terminal bounce or complaint evidence. The invitation
provider ingress reuses the existing signed `revenueAutopilotResendWebhook`,
then routes only through the separate server-owned staff provider-message index.
One verified signature cannot cross-bind a Revenue Autopilot job and a staff
invitation.

## Availability and Assignments

Availability has provenance `operator_recorded` and an explicit `available` or
`unavailable` state. A selected profile must be active, advertise the assigned
role capability, match its expected revision, and have complete available
coverage over the exact event window with no unavailable conflict.

Assignments are intentionally `operator_confirmed`, never merely `planned`.
Partial plans are valid: they retain visible gaps and state `attention`. A plan
becomes `coverage_confirmed` only when every copied quoted count has a matching
operator-confirmed assignment. That state still is not overall readiness.

## Conflict and Concurrency Contract

Schedule fences use deterministic organization, staff, and UTC-date identity.
An apply transaction reads the candidate fences plus every old fence affected
by replacing the current plan, compares exact revisions, validates complete
bounded projections, rejects half-open interval overlap, and atomically writes
the plan, receipt, and all new fence revisions. Adjacent intervals are allowed.

Changing or clearing a plan removes only that quote's prior assignment
projections and preserves peer assignments. Concurrent overlapping commands
cannot both commit. Truncated profile, assignment, or fence evidence fails
closed. A schedule fence at the bounded maximum revision also fails closed
before the planner can emit an out-of-contract next revision.

## Idempotency and Recovery

Profile and plan requests carry stable request IDs. Deterministic receipt IDs
bind the request identity to organization and target. A lost-response retry
must reuse the identical request and payload; a changed payload with that ID is
rejected. Receipts contain canonical digests and bounded before/after evidence.

The interface distinguishes submitting, uncertain, reconciliation, receipt,
definitive rejection, and recovery. An uncertain command locks changed input
and offers only exact unchanged reconciliation. A receipt proves the stored
operational command and revisions—not acknowledgement, attendance, payment,
booking, or readiness.

## Local Fallback

Local fallback may retain an explicitly labeled `local_draft` command shape.
It receives no server receipt, conflict clearance, authoritative coverage, or
availability claim and cannot be promoted to Firebase evidence without a fresh
server read and command.

## Rollout and Rollback

The first release remains default-off. Qualification requires focused unit and
component tests, Firestore rules tests, Auth/Firestore/Functions emulator
acceptance, capability-surface evidence, environment checks, build, high-risk
lanes, and responsive/accessibility review. Hosted authenticated role testing,
one explicitly approved tenant gate, production-data acceptance, and human
acceptance remain later gates.

Rollback disables the presentation and global server gates while preserving
immutable operational records for a later exact read. Rollback must not rewrite
quotes, versions, portals, payments, BEOs, or prior staffing receipts.
