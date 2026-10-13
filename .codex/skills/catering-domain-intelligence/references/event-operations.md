# Event Operations and Readiness Context

Last updated: 2026-09-08 15:04:45 CDT

## Governing Patterns

- `domain_pattern`: Catering work can move through inquiry, discovery, quote,
  proposal, revision, acceptance, planning, production, staffing, execution,
  settlement, closeout, and rebooking, but real work loops and branches. This is
  not a QuotePilot lifecycle enum.
- `domain_pattern`: Operational truth answers what must be prepared, staffed,
  transported, staged, timed, executed, and reconciled.
- `design_implication`: A unified event experience should compose authoritative
  commercial, staffing, document, workflow, and evidence projections rather
  than duplicate their state in an event-shaped container.
- `domain_pattern`: Readiness is useful only when it is decomposable,
  evidence-backed, and linked to the smallest authorized next action. Unknown
  evidence is not the same as incomplete work.
- `failure_pattern`: Date, venue, guest-count, menu, or service-style changes can
  invalidate timing, staffing, production, rental, transportation, or document
  assumptions even when the commercial promise remains historical truth.
- `quotepilot_doctrine`: `docs/EVENT_WORKSPACE_ADR.md` governs the current
  workspace projection and expressly prevents it from becoming new commercial
  or operational authority.

## Reconsideration Questions

1. Which operational projection consumes the changed fact?
2. What becomes stale, blocked, contradictory, or not yet available?
3. Who owns the next action, and is that role represented in current authority?
4. Does the proposed UI preserve event/task context without turning every job
   into a permanent destination?
5. What evidence proves the event is ready, current, or complete?

Do not promote rental availability, procurement, production quantities, or
actual attendance into current QuotePilot truth unless the repository already
owns those capabilities.
