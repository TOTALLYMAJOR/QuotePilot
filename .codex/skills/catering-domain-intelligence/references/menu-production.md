# Menu, Catalog, and Production Context

Last updated: 2026-09-08 15:04:45 CDT

## Governing Patterns

- `domain_pattern`: Menu choices can connect customer preference and commercial
  scope to price, cost, margin, dietary risk, production, equipment, service
  style, staffing, and documents.
- `failure_pattern`: Replacing an item after acceptance can leave a proposal,
  BEO, kitchen instruction, cost basis, or customer approval out of sync.
- `design_implication`: Before applying a consequential substitution, show only
  the supported commercial and operational deltas, name stale artifacts, and
  preserve the prior accepted version.
- `quotepilot_doctrine`: Current catalog authority, pricing confirmation,
  revision fencing, and server pricing govern QuotePilot. Generic source-pack
  objects do not create runtime features.
- `hypothesis`: Recipe decomposition, allergen propagation, procurement, and
  cross-event purchasing could deepen production intelligence. They must remain
  hypotheses until canonical product decisions and executable contracts exist.

## Reconsideration Questions

1. Is the change a catalog edit, quote selection, accepted revision, or
   operational substitution?
2. Which existing price, cost, margin, and policy evidence is authoritative?
3. Are dietary, recipe, procurement, or equipment effects established or merely
   plausible?
4. Which customer and internal documents become stale?
5. Is new approval or a governed commercial change required?
