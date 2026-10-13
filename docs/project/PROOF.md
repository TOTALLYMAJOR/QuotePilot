# Claim and Evidence Register

Last updated: 2026-09-10 15:09:08 CDT

Missing evidence is `UNVERIFIED`. Source, test, CI, deployment, provider,
recipient, tenant readback, human acceptance, usage, and commercial evidence do
not substitute for one another.

| Claim | Evidence currently present | Verdict |
|---|---|---|
| The public Vercel edge serves exact `v0.16.6`. | SHA `a350b72a`, CI `33889897821`, deployment `33890996339`, and route probes are recorded in `PROJECT_STATUS.md`. | `DEPLOYED` at Vercel |
| Firebase Functions serve exact `v0.18.1`. | SHA `8bada8d1`, CI `34430375712`, production run `34431964494`, and 128-Function readback are recorded. | `DEPLOYED` backend only |
| The public browser and backend are one exact current release. | The recorded versions differ and Firebase Hosting remains `v0.16.3`. | `UNVERIFIED`; currently split |
| Founder Inventory/menu-cost records exist in both live targets. | Exact provider readbacks record staging 525/132/132/132/200 at revision 23 and production 538/132/132/132/200 at revision 60. | `VERIFIED` for synthetic population state |
| Those records prove physical stock, supplier action, or accepted pricing. | Records are explicitly synthetic and pricing confirmation is cleared. | `UNVERIFIED` |
| The larger founder operating twin is live. | Local source and focused tests exist; hosted assets and apply/readback do not. | `TESTED` source only |
| Inventory works for a hosted operator after the App Check fix. | Deployment and provider readback exist; successful retry is open. | `UNVERIFIED` |
| Living Opportunity, Operations, Inventory, and Library placement is implemented in current source. | Current route/component and feature-contract evidence exists. | `IMPLEMENTED` in source; public parity open |
| An authenticated operator can complete the current quote-to-operations journey. | Source/test and partial deployment evidence exist; current exact hosted acceptance does not. | `UNVERIFIED` |
| QuotePilot has paying customers, recurring use, revenue, retention, or measured outcomes. | No corresponding repository receipts are recorded. | `UNVERIFIED` |

The complete operational narrative belongs in
[`PROJECT_STATUS.md`](../../PROJECT_STATUS.md).
