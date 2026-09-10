# Material Decision Index

Last updated: 2026-09-10 12:09:03 CDT

Linked ADRs and policies are authoritative; this page is an index.

| Decision | Status | Authority |
|---|---|---|
| Source, CI, deployment, provider, tenant, human, usage, and commercial evidence remain separate. | Accepted | [`DOC_SYSTEM.md`](../DOC_SYSTEM.md), [`PROOF.md`](PROOF.md) |
| Pricing, quote revisions, provider effects, and consequential changes fail closed under server authority. | Accepted | [`PRICING_CONSTITUTION.md`](../PRICING_CONSTITUTION.md), [`COMMERCIAL_CHANGE_AUTHORITY_ADR.md`](../COMMERCIAL_CHANGE_AUTHORITY_ADR.md) |
| Ingredient Inventory owns stock/cost/receipt evidence; Library owns recipes/menu cost; sold rentals remain commercial scope. | Accepted and deployed at the backend boundary | [`INVENTORY_AUTHORITY_ADR.md`](../INVENTORY_AUTHORITY_ADR.md) |
| Living Opportunity owns ordinary Ambient exact-quote context; Quote administration and governed edit retain mutation/provider authority. | Accepted for current source profile | [`DESIGN_SYSTEM.md`](../DESIGN_SYSTEM.md), [`DESIGN-CONTRACT.md`](../DESIGN-CONTRACT.md) |
| CWF-16 Event Workspace is historical foundation and compatibility provenance, not the current Ambient exact-route composition. | Reconciled | [`EVENT_WORKSPACE_ADR.md`](../EVENT_WORKSPACE_ADR.md) |
| Operations composes Schedule, preflight, Staffing, production, and BEO projections without becoming a universal Event authority. | Accepted | [`DESIGN_SYSTEM.md`](../DESIGN_SYSTEM.md), [`EVENT_WORKSPACE_ADR.md`](../EVENT_WORKSPACE_ADR.md) |
| Operational Staffing remains independent of pricing, booking, attendance, payroll, and readiness. | Accepted | [`OPERATIONAL_STAFFING_AUTHORITY_ADR.md`](../OPERATIONAL_STAFFING_AUTHORITY_ADR.md) |
| Commercial Truth Loop is a read-only reconciliation tier with no credential, network, write, pricing, approval, or customer-facing authority. | Accepted and implemented | [`COMMERCIAL_TRUTH_LOOP_ADR.md`](../COMMERCIAL_TRUTH_LOOP_ADR.md) |
| Stripe Connect and Steward remain separately bounded future programs. | Accepted | [`STRIPE_CONNECT_PROGRAM.md`](../STRIPE_CONNECT_PROGRAM.md), [`STEWARD_ADR.md`](../STEWARD_ADR.md) |

New or reversed architecture decisions require their own ADR.
