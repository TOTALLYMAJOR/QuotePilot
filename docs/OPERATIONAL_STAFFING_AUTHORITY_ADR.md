# Authoritative Operational Staffing ADR

Last updated: August 11, 2026

Status: source implementation behind independent default-off presentation,
server, and tenant gates. This decision record does not establish deployment,
production data, provider behavior, or human acceptance.

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

## Why the Existing Fields Are Not Authority

The quote's server, chef, and bartender counts remain commercial pricing
inputs. Existing booking-assignment, schedule, proposal, portal, payment, and
Kitchen BEO fields serve their own evidence domains. None provides a
revision-fenced roster, explicit availability provenance, conflict-safe
concurrency, or an immutable operational assignment receipt.

The new authority copies exact quoted role counts only for comparison. It does
not change pricing or replace authoritative quote creation, repricing, or
version writes.

## Release Gates

All three gates must remain independent:

- `VITE_OPERATIONAL_STAFFING_ENABLED=true` exposes the staff presentation.
- `OPERATIONAL_STAFFING_AUTHORITY_ENABLED=true` enables the server authority.
- `settings.operationalStaffingAuthorityEnabled=true` enables one exact tenant.

The browser cannot promote either authority gate. A visible source surface,
successful local test, or enabled presentation flag is not authority when the
server or tenant gate is off. Production workflows do not bind these new gates
until a separately reviewed rollout.

## Roles and Tenant Scope

- Same-tenant administrators and sales staff may read the bounded operational
  staffing projection.
- Tenant administrators alone may create or revise staff profiles and
  operator-recorded availability.
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
- `eventStaffingPlans/{quoteId}`: exact quote revision, event window, copied
  commercial requirements, operator-confirmed assignments, coverage gaps, and
  plan revision.
- `eventStaffingPlans/{quoteId}/versions/{receiptId}`: immutable plan-command
  receipt.
- `staffingScheduleFences/{fenceId}`: complete bounded operator-confirmed
  assignment projections for one staff profile and UTC date.

Public projections exclude email, phone, token, provider, payment, portal,
message, payroll, attendance, and internal interval fields.

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
