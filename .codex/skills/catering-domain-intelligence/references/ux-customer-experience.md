# UX, Navigation, Customer, and Reporting Context

Last updated: 2026-09-08 15:04:45 CDT

QuotePilot's `docs/DESIGN_SYSTEM.md` and `docs/DESIGN_PRINCIPLES.md` remain the
implementation authority. This reference supplies domain considerations only.

## Governing Patterns

- `domain_pattern`: Global destinations provide stable orientation; object
  context preserves the active customer/event/opportunity; contextual actions
  serve the current object. Capability existence alone does not justify primary
  navigation.
- `domain_pattern`: Customer, sales, kitchen, operations, staffing, finance, and
  management views optimize different decisions and must not receive identical
  projections or private information.
- `design_implication`: Design around the job and next decision, not database
  organization. Keep status, consequence, and one useful next action visible;
  disclose provenance and secondary detail progressively.
- `design_implication`: Dashboards earn space by identifying evidence-backed
  exceptions, obligations, risks, and next actions. More passive metrics do not
  automatically improve control.
- `failure_pattern`: A route or modal that drops object context forces operators
  to reconcile the system manually and increases the chance of acting on the
  wrong event or version.
- `quotepilot_doctrine`: Customer-facing projections may not expose internal
  pricing, margin, staffing, evidence, provider, or operational authority unless
  a current contract explicitly permits it.

## Reconsideration Questions

1. What decision should this actor make next?
2. Is the capability global, object-contextual, or an action on the current
   object?
3. What context must remain visible across the transition?
4. What consequence and proof must appear beside the action?
5. Does the proposed surface reduce work, or merely add a destination, card, or
   metric?
