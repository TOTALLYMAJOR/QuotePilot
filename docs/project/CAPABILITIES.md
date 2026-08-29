# Capability State Index

Last updated: 2026-08-25 02:06:28 CDT

## Authority

[`docs/FEATURE_MATRIX.md`](../FEATURE_MATRIX.md) remains the canonical complete
capability inventory and source chronology. [`.project/state.json`](../../.project/state.json)
holds a deliberately smaller cross-functional lifecycle ledger used by the
drift checker. This index does not create a second feature register.

## Reconciled Cohorts

| Cohort | Highest supported state | Important boundary |
|---|---|---|
| Tenant catalog and authoritative pricing | `DEPLOYED` | Browser totals are not settlement or acceptance evidence. |
| Quote creation, revisions, and readback | `DEPLOYED` | Current authenticated production acceptance remains open. |
| Proposal and customer decision | `DEPLOYED` | Provider acceptance, recipient behavior, and customer decision are separate. |
| Deposit and final-balance rails | `DEPLOYED` | Coordinated hosted provider acceptance remains open. |
| Event Workspace and BEO operations | `DEPLOYED` | Hosted canonical-data and human acceptance remain open. |
| Operational staffing | `DEPLOYED` | Exact `v0.15.0` deployed the default-off authority; tenant-250 provisioning and protected activation remain open. |
| Ambient workspace presentation | `DEPLOYED` | Exact `v0.15.0` dual-target proof does not establish authenticated acceptance. |
| Buyer onboarding | `TESTED` | Restricted-key and bounded hosted safety evidence remain open. |
| Stripe Connect control plane | `TESTED` | Unexported, uninstantiated, and provider disabled. |
| Steward decision compiler | `TESTED` | Exact `v0.15.0` carries the unavailable-state UI, but the compiler remains unimported and has no provider runtime, background execution, or production authority. |
| Canonical state control plane | `TESTED` | Internal consistency only; no product or commercial claim is promoted. |

Lifecycle state is the highest evidence-backed state, not a percentage of
completion. Detailed files, caveats, and implementation cohorts remain in the
Feature Matrix.
