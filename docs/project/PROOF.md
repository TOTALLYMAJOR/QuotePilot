# Claim and Evidence Register

Last updated: 2026-08-25 00:43:38 CDT

## Evidence Rule

Each verdict is limited to the evidence type named. Missing evidence is
`UNVERIFIED`; it is never silently promoted from source, test, deployment, or
configuration evidence.

| Claim | Evidence currently present | Verdict |
|---|---|---|
| Exact `v0.14.0` source passed its recorded required CI matrix. | Exact SHA, tag, and CI run `32418251221` are recorded in [`PROJECT_STATUS.md`](../../PROJECT_STATUS.md). | `VERIFIED` for CI only |
| The public Vercel edge serves exact `v0.14.0`. | Governed deployment run `32419441612` and its public-edge probe are recorded. | `DEPLOYED` at Vercel |
| Firebase Hosting, Functions, rules, and indexes serve exact `v0.14.0`. | Governed all-scope run `32419577296` completed and its origin probe passed. | `DEPLOYED` at Firebase |
| The reconciled candidate is in production. | Remote `main` and this branch are newer than deployed `v0.14.0`; no governed candidate deployment receipt exists yet. | `UNVERIFIED` |
| An authenticated operator can complete the current primary journey in production. | Source, tests, and older deployment history exist; the current authenticated acceptance pass is open. | `UNVERIFIED` |
| Proposal email was accepted, delivered, and received for an exact current portal issuance. | Resend configuration exists; the exact provider, webhook, and recipient sequence is open. | `UNVERIFIED` |
| Deposit and final-balance rails behave correctly with Stripe in the hosted environment. | Source/emulator evidence exists; coordinated hosted provider acceptance is open. | `UNVERIFIED` for hosted/provider behavior |
| Operational staffing authority is deployed and available for tenant 250. | The authority shipped in `v0.14.0`, but activation run `32425529671` found no `organizations/250/settings/config` and stopped before mutation. | `DEPLOYED` code; tenant availability `UNVERIFIED` |
| Stripe Connect can onboard a merchant in Sandbox. | Tested source foundation exists, but runtime is unexported, unbound, and provider disabled. | `UNVERIFIED` |
| Steward improves operator decisions safely. | Synthetic corpus and source tests exist; no consenting pilot or human comparison exists. | `UNVERIFIED` |
| QuotePilot has validated buyers, paying customers, recurring usage, revenue, retention, or measurable outcomes. | No repository-backed commercial receipts or metrics were found in the reconciliation sources. | `UNVERIFIED` |

## Evidence Classes

`source` proves an implementation exists. `test` proves a named local or CI
assertion under its fixture. `deployment` proves an exact artifact reached a
named target. `provider` proves the provider accepted or emitted a named event.
`recipient` proves user receipt or action. `human_acceptance` proves a recorded
person completed an acceptance protocol. `usage` and `commercial` require
actual product and business evidence. None substitutes for another.
