# Claim and Evidence Register

Last updated: 2026-08-24 20:18:29 CDT

## Evidence Rule

Each verdict is limited to the evidence type named. Missing evidence is
`UNVERIFIED`; it is never silently promoted from source, test, deployment, or
configuration evidence.

| Claim | Evidence currently present | Verdict |
|---|---|---|
| Exact `v0.11.0` source passed its recorded required CI matrix. | Exact SHA, tag, and CI run are recorded in [`PROJECT_STATUS.md`](../../PROJECT_STATUS.md). | `VERIFIED` for CI only |
| The public Vercel edge serves exact `v0.11.0`. | Governed deployment run and public `/` and `/app` HTTP 200 probes are recorded. | `DEPLOYED` at Vercel |
| Firebase Hosting and Functions serve exact `v0.11.0`. | The latest recorded successful all-scope Firebase deployment is `v0.9.0`; the later attempt failed before mutation. | `UNVERIFIED` and currently contradicted by the recorded release split |
| An authenticated operator can complete the current primary journey in production. | Source, tests, and older deployment history exist; the current authenticated acceptance pass is open. | `UNVERIFIED` |
| Proposal email was accepted, delivered, and received for an exact current portal issuance. | Resend configuration exists; the exact provider, webhook, and recipient sequence is open. | `UNVERIFIED` |
| Deposit and final-balance rails behave correctly with Stripe in the hosted environment. | Source/emulator evidence exists; coordinated hosted provider acceptance is open. | `UNVERIFIED` for hosted/provider behavior |
| Operational staffing is available for tenant 250. | Source/local tests exist; exact Firebase promotion and field activation are pending. | `UNVERIFIED` |
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
