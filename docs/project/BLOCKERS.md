# Critical Blocker Register

Last updated: 2026-08-25 15:46:40 CDT

[`DEV_TASKS.md`](../../DEV_TASKS.md) remains the canonical prioritized backlog,
and [`PROJECT_STATUS.md`](../../PROJECT_STATUS.md) remains operational truth.
This register contains only blockers to a lifecycle, proof, or commercial
claim. It authorizes no provider, tenant, production, or customer mutation.

Priority semantics: `P0` prevents safe system operation, `P1` prevents the
primary journey, `P2` prevents commercialization/production readiness, `P3`
materially degrades UX/operations, and `P4` is an enhancement gate.

| ID / Priority | Blocker | Evidence | Affected Goal | Affected Journey | Dependencies | Resolution Condition |
|---|---|---|---|---|---|---|
| `block-tenant-250-provisioning` / P1 | Tenant `250` lacks its canonical settings document; staffing activation failed closed. | Activation run `32425529671` in [`PROJECT_STATUS.md`](../../PROJECT_STATUS.md). | User; operational | Quote-to-operations | Firebase tenant migration and protected activation | Provision `organizations/250/settings/config` through the reviewed migration path, then retain exact activation readback. |
| `block-authenticated-production-acceptance` / P1 | No current authenticated end-to-end staff acceptance receipt exists. | Open production acceptance work in [`DEV_TASKS.md`](../../DEV_TASKS.md). | User; operational | Quote-to-operations | Tenant provisioning; Firebase; Vercel | One authorized operator passes the exact release role/tenant/quote/portal/BEO matrix with denial receipts. |
| `block-provider-acceptance` / P1 | Exact email and coordinated hosted payment-provider behavior are unverified. | Provider acceptance work in [`DEV_TASKS.md`](../../DEV_TASKS.md) and [`docs/project/PROOF.md`](PROOF.md). | User; operational | Quote-to-operations | Resend; Stripe | Record exact proposal-email provider acceptance and separate deposit/final-balance hosted receipts without inferring delivery or settlement. |
| `block-buyer-safety` / P2 | Buyer access lacks the complete restricted-key, webhook, Turnstile, and bounded-hosted safety evidence. | Buyer acceptance gates in [`DEV_TASKS.md`](../../DEV_TASKS.md). | Commercial; operational | Buyer activation | Stripe; Turnstile; Firebase | Pass restricted test credential, webhook inventory, both approved-hostname Turnstile, and bounded hosted acceptance checks. |
| `block-connect-hosted-sandbox` / P2 | Connect has no approved applied staging foundation, bound runtime, or hosted Sandbox proof. | [`docs/STRIPE_CONNECT_PROGRAM.md`](../STRIPE_CONNECT_PROGRAM.md). | Operational; commercial | Supporting Connect program | Stripe; Firebase; separately authorized staging apply | Apply/reconcile the approved isolated plan and complete authenticated hosted Sandbox UAT through the defined stopping gate. |
| `block-steward-pilot-proof` / P4 | Steward has no reviewed provider transport, private runtime, consented pilot, or human comparison. | [`docs/STEWARD_ADR.md`](../STEWARD_ADR.md). | User; operational | Supporting Steward exploration | Provider/consent/persistence protocol | Approve the four boundaries, then record a non-authoritative silent-pilot comparison without granting write authority. |
| `block-commercial-evidence` / P2 | Buyer, activation, paid-customer, usage, retention, revenue, and outcome evidence are absent. | [`docs/project/PROOF.md`](PROOF.md). | Commercial | Buyer activation and quote-to-operations | Buyer safety; authenticated production acceptance | Record direct evidence for each commercial category or leave that category `UNVERIFIED`. |

There is no active P0 blocker: the known missing preconditions fail closed
rather than making the deployed system unsafe. That does not promote any P1 or
P2 claim.
