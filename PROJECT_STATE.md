# QuotePilot Canonical Project State

Last updated: 2026-09-24 22:00:00 CDT

QuotePilot is a deployed catering commercial and operations system. The public
Vercel edge, Firebase Functions, and Firebase Hosting fallback are coordinated
at `v0.19.0`, exact SHA `bf9f48a00547e305fdf155c8d64bf3646198b705`,
but their provider receipts, tenant configuration, production behavior, and
human acceptance remain separate evidence classes. A 2026-09-16 authenticated
administrator journey is partial read-only evidence, not full role-safe or
human acceptance.

The current local v0.20 source candidate is anchored at QPR-005 source head
`dc3cdb1a33c6f75c3cff993f4a4bd9db382bf6c6`. It is not pushed, exact-head CI
verified, deployed, hosted-accepted, provider-accepted, or human-accepted.

The machine-readable reconciliation is [`.project/state.json`](.project/state.json).
This page is only its human entry point.

## Canonical authority map

| Question | Canonical source |
|---|---|
| What capabilities exist in source? | [`docs/FEATURE_MATRIX.md`](docs/FEATURE_MATRIX.md) |
| What is deployed, populated, or operational now? | [`PROJECT_STATUS.md`](PROJECT_STATUS.md) |
| What work remains and in what order? | [`DEV_TASKS.md`](DEV_TASKS.md) |
| What changed historically? | [`CHANGELOG.md`](CHANGELOG.md) |
| How does an operator use the product? | [`docs/USER_MANUAL.md`](docs/USER_MANUAL.md) |
| What claim has what evidence? | [`docs/project/PROOF.md`](docs/project/PROOF.md) |
| What decisions govern the system? | [`docs/project/DECISIONS.md`](docs/project/DECISIONS.md) |

## Lifecycle vocabulary

`IDEA`, `SPECIFIED`, `DESIGNED`, `IMPLEMENTED`, `TESTED`, `VERIFIED`,
`DEPLOYED`, `USED`, `COMMERCIALLY_PROVEN`, `DEPRECATED`, and `BLOCKED` are
distinct. Source, tests, CI, deployment, provider results, tenant activation,
human acceptance, usage, and commercial outcomes require their own evidence.

## Reconciled product view

- Primary actors are catering owners, administrators, sales operators, event
  operators, staff, and customers at their authorized projection.
- The primary journey is demand intake → authoritative quote → exact saved
  revision → proposal → customer decision → payment evidence → event planning,
  Staffing, Inventory, and BEO handoff.
- Exact quote context belongs to Living Opportunity; authoritative provider and
  commercial controls stay in Quote administration and governed edit; event
  planning belongs to Operations; ingredient stock/cost belongs to Inventory;
  recipes and menu cost belong to Library.
- The strongest current proof is source and test coverage, exact v0.19.0
  CI/deployment and provider readback, exact founder-pilot population readback,
  and the partial authenticated production administrator read journey.
  Ordinary admin/sales role behavior, cross-tenant denial, browser App Check,
  receipt-backed commands, assistive-technology use, and human acceptance remain
  open.

## NEXT PROOF EVENT

Complete an authenticated `mm05366-sandbox` journey against the coordinated
v0.19.0 deployment using ordinary administrator and sales identities plus a
separate cross-tenant denial identity. Bind the receipt to the exact SHA and
immutable deployments, record browser App Check behavior, exercise one eligible
Inventory recovery/command and the governed Commercial Change and Event Spine
commands without retrying an uncertain write, and read back their exact
receipts and projections. Provider, recipient, assistive-technology, human,
usage, and commercial outcomes remain separate claims.

Run `npm run check:project-state` to validate ledger consistency. A pass proves
the control plane only; it does not promote runtime or outcome evidence.
