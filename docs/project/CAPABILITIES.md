# Capability State Index

Last updated: 2026-08-24 20:18:29 CDT

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
| Operational staffing | `TESTED` | Exact Firebase promotion and tenant activation remain open. |
| Ambient workspace presentation | `DEPLOYED` | Vercel/public-edge proof does not establish authenticated acceptance. |
| Buyer onboarding | `TESTED` | Restricted-key and bounded hosted safety evidence remain open. |
| Stripe Connect control plane | `TESTED` | Unexported, uninstantiated, and provider disabled. |
| Steward decision compiler | `TESTED` | No provider runtime, background execution, or production authority. |
| Canonical state control plane | `TESTED` | Internal consistency only; no product or commercial claim is promoted. |

Lifecycle state is the highest evidence-backed state, not a percentage of
completion. Detailed files, caveats, and implementation cohorts remain in the
Feature Matrix.
