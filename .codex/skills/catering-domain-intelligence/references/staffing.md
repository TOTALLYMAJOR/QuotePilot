# Staffing Context

Last updated: 2026-09-08 15:04:45 CDT

## Governing Patterns

- `domain_pattern`: Workforce administration and event-specific staffing are
  related but different jobs. The latter depends on event context such as date,
  attendance basis, service style, timing, and operational requirements.
- `domain_pattern`: Quoted labor, recommended staffing, a staffing plan,
  availability, assignment, invitation, acceptance, and completed shift are
  distinct meanings.
- `failure_pattern`: A guest-count or service change can make a prior staffing
  recommendation or plan stale without proving that any particular ratio or
  replacement policy applies.
- `design_implication`: Keep global workforce management available where its
  frequency and audience justify it, while preserving direct contextual access
  to event staffing work.
- `quotepilot_doctrine`: `docs/OPERATIONAL_STAFFING_AUTHORITY_ADR.md` owns the
  tenant-isolated staffing plan, assignment, invitation, concurrency, and
  recovery boundaries. It remains separate from quote, BEO, attendance,
  payment, and booking authority.
- `quotepilot_doctrine`: A recommendation or AI suggestion is advisory. It may
  be previewed with evidence and consequence, but cannot silently assign staff
  or become policy.

## Reconsideration Questions

1. Is this workforce administration or work on one event's staffing plan?
2. Which attendance and quote revision supply the comparison basis?
3. Does current code establish the proposed staffing policy, ratio, and role?
4. Who may plan, assign, invite, accept, or override?
5. How are conflicts, stale recommendations, unavailable staff, and retry
   handled?
