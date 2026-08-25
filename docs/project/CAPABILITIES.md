# Capability State Index

Last updated: 2026-08-25 15:46:40 CDT

## Authority

[`docs/FEATURE_MATRIX.md`](../FEATURE_MATRIX.md) remains the canonical complete
capability inventory and source chronology. [`.project/state.json`](../../.project/state.json)
holds the smaller lifecycle ledger used by the drift checker. This page is a
compatibility index, not a second feature register.

## Evidence Semantics

- Claimed: a document or stakeholder says the outcome should exist.
- Implemented: source exists.
- Verified: named evidence demonstrates bounded expected behavior.
- Operational: the exact artifact reached its target environment.
- Proven: real user or commercial evidence demonstrates the claimed outcome.

No row advances merely because a lower evidence class exists.

## Reconciled Cohorts

| Capability | Intended Outcome | State | Evidence | Missing Proof | Blocker |
|---|---|---|---|---|---|
| Tenant catalog and authoritative pricing | Produce tenant-scoped, server-owned quote totals from an exact catalog revision. | `DEPLOYED` | Feature Matrix pricing cohorts; exact `v0.15.0` CI and dual-target receipts in [`PROJECT_STATUS.md`](../../PROJECT_STATUS.md). | Current authenticated production calculation/readback. | `block-authenticated-production-acceptance` |
| Quote creation, revisions, and readback | Create, save, version, reopen, and export one exact tenant quote. | `DEPLOYED` | Trusted quote callables and Firestore revision contracts indexed by the Feature Matrix. | Current authenticated production journey and exact saved-revision readback. | `block-authenticated-production-acceptance` |
| Proposal and customer decision | Issue the current proposal and bind customer decisions to an exact portal issuance/revision. | `DEPLOYED` | Proposal, portal, and decision authorities indexed by the Feature Matrix and deployment record. | Exact provider acceptance, recipient behavior, and current customer decision receipt. | `block-provider-acceptance`; `block-authenticated-production-acceptance` |
| Deposit and final-balance rails | Keep both payment rails and their signed webhook evidence separate. | `DEPLOYED` | Stripe callable/webhook cohorts and local emulator evidence indexed by the Feature Matrix. | Coordinated hosted provider acceptance and settlement evidence. | `block-provider-acceptance` |
| Event Workspace and BEO operations | Present one exact event context and produce revision-bound operational artifacts. | `DEPLOYED` | [`docs/EVENT_WORKSPACE_ADR.md`](../EVENT_WORKSPACE_ADR.md), source/tests, and exact `v0.15.0` deployment. | Hosted canonical-data and human acceptance. | `block-authenticated-production-acceptance` |
| Operational staffing | Record tenant-scoped staffing profiles, plans, assignments, invitations, and separated acknowledgements. | `DEPLOYED` | Exact `v0.15.0` deployed the independently gated authority and presentation. | Tenant-250 settings/protected activation and authenticated hosted use. | `block-tenant-250-provisioning` |
| Ambient workspace presentation | Give role-safe operational context, exact arrivals, and bounded Pilot interactions over existing authority. | `DEPLOYED` | Exact `v0.15.0` Vercel/Firebase receipts and named local/browser suites in the Feature Matrix. | Authenticated production-data behavior and human acceptance. | `block-authenticated-production-acceptance` |
| Buyer onboarding | Move a verified buyer through test-mode invoice, exact-email owner activation, and workspace preparation. | `TESTED` | Source/emulator contracts and the gated acceptance plan in [`DEV_TASKS.md`](../../DEV_TASKS.md). | Restricted-key webhook/Turnstile checks and bounded hosted acceptance. | `block-buyer-safety` |
| Stripe Connect control plane | Isolate merchant onboarding and payment routing behind an approved Sandbox stopping gate. | `TESTED` | [`docs/STRIPE_CONNECT_PROGRAM.md`](../STRIPE_CONNECT_PROGRAM.md), unexported source, and focused tests. | Applied staging resources, runtime binding, provider object, and hosted Sandbox UAT. | `block-connect-hosted-sandbox` |
| Steward decision compiler | Produce policy-bounded, non-authoritative decision packets for explicit human review. | `TESTED` | Source/rules/UI/browser tests; exact `v0.15.0` carries only the unavailable-state UI. | Provider transport, private runtime/persistence, consenting pilot, and human comparison. | `block-steward-pilot-proof` |
| Canonical state control plane | Keep intent, lifecycle, decisions, proof, blockers, and next action machine-checkable. | `TESTED` | [`scripts/check-project-state.mjs`](../../scripts/check-project-state.mjs), focused validator tests, and `lane:quick`. | Continued semantic reconciliation by authorized humans/agents; the checker cannot infer external truth. | None |

Lifecycle state is the highest evidence-backed state, not a completion
percentage. No representative cohort is currently `USED` or
`COMMERCIALLY_PROVEN`.
