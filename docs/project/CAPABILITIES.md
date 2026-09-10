# Capability State Index

Last updated: 2026-09-10 12:09:03 CDT

[`docs/FEATURE_MATRIX.md`](../FEATURE_MATRIX.md) is the complete capability
inventory. [`.project/state.json`](../../.project/state.json) is the smaller
machine-checked lifecycle ledger. This page is only a navigation index.

| Cohort | Highest supported state | Important boundary |
|---|---|---|
| Tenant catalog and authoritative pricing | `DEPLOYED` | Browser display, pricing confirmation, payment, and acceptance are separate. |
| Quote creation, revision, and readback | `DEPLOYED` | Current authenticated hosted acceptance remains open. |
| Proposal and customer decision | `DEPLOYED` | Provider, recipient, portal, and customer-decision evidence remain distinct. |
| Deposit and final-balance rails | `DEPLOYED` | Request, browser return, webhook settlement, and reconciliation are separate. |
| Event operations and Kitchen BEO | `DEPLOYED` | Planning/checklists do not prove readiness; BEO currentness binds exact document evidence. |
| Operational Staffing | `DEPLOYED` | Quoted roles, profiles, assignments, acknowledgements, and attendance are separate. |
| Ingredient Inventory and menu costing | `DEPLOYED` backend; live synthetic data populated | Public frontend parity, operator retry, physical counts, and human acceptance remain open. |
| Ambient/Living Opportunity presentation | `DEPLOYED` at the older public edge | Current source/backend parity and hosted role acceptance remain open. |
| Buyer onboarding | `TESTED` | Restricted-key and bounded hosted safety evidence remain open. |
| Stripe Connect control plane | `TESTED` | Provider-disabled and unpromoted. |
| Steward decision compiler | `TESTED` | Non-authoritative; no approved provider runtime or human comparison. |
| Canonical state control plane | `TESTED` | Internal consistency only. |

Lifecycle state is the highest evidence-backed state, never a completion score.
