# Claim and Evidence Register

Last updated: 2026-08-25 15:46:40 CDT

## Evidence Rule

Verdicts are `PROVEN`, `PARTIALLY_PROVEN`, `UNVERIFIED`, or `CONTRADICTED`.
Each verdict is scoped to the exact claim and evidence class shown. Source,
test, CI, deployment, provider, recipient, human, usage, and commercial
evidence never substitute for one another.

| Claim | Required Evidence | Current Evidence | Verdict |
|---|---|---|---|
| Exact `v0.15.0` source passed its required CI matrix. | Tag resolving to an exact SHA and a successful exact-head required CI run. | Tag/SHA `bc495c8c948d440b12363d5da34209a11ff151fd`; CI run `32817744859` in [`PROJECT_STATUS.md`](../../PROJECT_STATUS.md). | `PROVEN` for CI only |
| The public Vercel edge serves exact `v0.15.0`. | Successful governed deployment of the exact SHA plus public-edge readback. | Governed Vercel run `32819363438` and its public-edge probe. | `PROVEN` for Vercel deployment only |
| Firebase Hosting, Functions, rules, and indexes serve exact `v0.15.0`. | Successful all-scope deployment of the exact SHA plus origin readback. | Firebase run `32818605404` and its origin probe. | `PROVEN` for Firebase deployment only |
| The reconciled runtime candidate reached both governed production targets. | Matching successful Vercel and Firebase receipts for one exact release SHA. | Both receipts name exact `v0.15.0`; later receipt-only `main` documentation does not change runtime. | `PROVEN` for dual-target deployment |
| An authenticated operator can complete the primary journey in production. | Current exact-release role-safe browser receipts from quote creation through BEO, including tenant and denial cases. | Source, tests, CI, and deployment receipts; no current authenticated journey receipt. | `UNVERIFIED` |
| Proposal email was accepted, delivered, and received for one exact valid portal issuance. | Exact server attempt, provider acceptance, matching delivery/bounce event, and recipient evidence for the current issuance. | Resend configuration only; provider, webhook, and recipient sequence remain open. | `UNVERIFIED` |
| Deposit and final-balance rails behave correctly with Stripe in the hosted environment. | Separate exact hosted provider receipts and signed-webhook reconciliation for both rails. | Source and local emulator evidence only. | `UNVERIFIED` for hosted/provider behavior |
| Operational staffing authority is deployed and available for tenant `250`. | Exact code deployment plus canonical tenant settings, protected activation receipt, and authenticated role-safe use. | Code shipped in `v0.15.0`; activation run `32425529671` found no `organizations/250/settings/config` and made no mutation. | `PARTIALLY_PROVEN`: deployed code; tenant availability `UNVERIFIED` |
| Stripe Connect can onboard a merchant in Sandbox. | Applied isolated staging foundation, bound runtime, Stripe Sandbox object/Account Link evidence, and authenticated hosted UAT. | Tested source foundation remains unexported, unbound, and provider disabled. | `UNVERIFIED` |
| Steward improves operator decisions safely. | Reviewed provider transport, consenting private pilot, bounded runtime receipts, and digest-bound human comparison. | Tested source foundation and deployed unavailable-state UI only. | `UNVERIFIED` |
| The target buyer and buying trigger are validated. | Direct buyer research or purchase evidence tied to the stated problem and actor. | Repository-derived actor and problem hypothesis only. | `UNVERIFIED` |
| QuotePilot has qualified prospects or active design partners. | Prospect qualification or design-partner agreement/session evidence. | No repository-backed record. | `UNVERIFIED` |
| QuotePilot has paying customers and reconciled recurring revenue. | Billing/customer ledger plus reconciled transaction evidence. | No repository-backed record. | `UNVERIFIED` |
| Real buyers activate, repeatedly use, and retain QuotePilot. | Production activation, repeated primary-journey usage, and cohort/renewal evidence. | No production usage or retention evidence. | `UNVERIFIED` |
| QuotePilot measurably improves conversion, speed, margin, or operational quality. | Customer-specific baseline, post-use measurement, method, and acceptance. | No before-and-after outcome evidence. | `UNVERIFIED` |

## Evidence Classes

`source` proves an implementation exists. `test` proves a named assertion under
its fixture. `CI` proves the named revision passed the named automation.
`deployment` proves an exact artifact reached a named target. `provider` proves
the provider accepted or emitted a named event. `recipient` proves user receipt
or action. `human_acceptance` proves a recorded person completed an acceptance
protocol. `usage` and `commercial` require actual product and business evidence.
None substitutes for another.
