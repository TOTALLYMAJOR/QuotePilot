# ADR-0003: Commercial Kernel and Vertical Pack Boundary

Last updated: 2026-09-04 13:06:37 CDT

- Status: Accepted for implementation on the UX convergence branch
- Decision date: 2026-09-04

## Context

QuotePilot already has strong catering-specific commercial mechanisms:
packages, event templates, menu and rental components, staffing guidance,
revision-fenced catalogs, server-authoritative pricing, immutable quote
versions, and payment evidence. Adding broader commercial capability as new
parallel systems would duplicate quote, catalog, and pricing authority.

## Decision

Use four explicit layers:

1. The Commercial / Operations Kernel defines vertical-neutral deterministic
   contracts and authority invariants.
2. A Vertical Pack supplies terminology, governed starter data, default
   offers/templates/rules, pricing-policy defaults, and resource-policy
   references.
3. Tenant Configuration supplies organization-scoped records and operator
   declarations under existing revision, role, and confirmation gates.
4. Contextual UX presents the resulting capability in language natural to the
   operator's vertical.

Catering is the only complete pack. Package and Event Template remain the
visible catering terms and are adapted to Configurable Offer and Commercial
Template kernel contracts. No second quote draft, catalog, pricing engine, or
payment authority is introduced.

## Authority ownership

- The browser calculator is preview-only.
- Firebase server pricing remains the commercial authority.
- Catalog publication remains organization-scoped, revision-fenced, and tied
  to current pricing confirmation.
- Templates stage defaults and never price or save independently.
- Rules evaluate and explain. They cannot execute code or silently mutate a
  quote.
- Vertical packs and tenant settings are data inputs; neither may redefine
  server authority.
- Saved quote revisions retain the exact pricing version, rules snapshot, and
  waterfall used at certification time.

## Compatibility and migration

Existing packages adapt to simple offers with included components and no
advanced choice groups. Existing Event Templates adapt to Commercial Templates
with one base configuration. Existing upsell rules adapt to recommendation
rules. Existing pricing-v1 receipts remain pricing-v1 forever. No destructive
migration or historical repricing is permitted.

Compatibility adapters may be retired only when repository and tenant-readback
evidence show every supported record has a native version and rollback no
longer depends on the legacy shape.

## Consequences

- Shared concepts can support a future vertical without copying catering code.
- Catering UX remains natural and deep.
- Publication validators must reject unknown operators, missing authoritative
  references, conflicting mandatory rules, invalid fee tiers, ambiguous
  seasons, and invalid explicit tax regions.
- Exact-money pricing-v2 is additive to historical v1 evidence and must pass
  deterministic differential and payment-reconciliation gates before release.
