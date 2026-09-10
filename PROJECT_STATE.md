# QuotePilot Canonical Project State

Last updated: 2026-09-10 12:09:03 CDT

QuotePilot is a deployed catering commercial and operations system with a split
current evidence surface: the public Vercel browser is `v0.16.6`, Firebase
Functions are `v0.18.1`, Firebase Hosting remains `v0.16.3`, and the local
founder-population branch contains two later unmerged commits. These artifacts
must not be collapsed into one production-version claim.

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
- The strongest current proof is source and test coverage, exact CI/deployment
  receipts, v0.18.1 Functions readback, and exact founder Inventory population
  readback. Current public-browser parity and human acceptance remain open.

## NEXT PROOF EVENT

Promote an exact frontend candidate compatible with the v0.18.1 backend and
record one authenticated `mm05366-sandbox` administrator journey through the
canonical surfaces with exact role, tenant, App Check, revision, and readback
evidence. Provider, recipient, human, usage, and commercial outcomes remain
separate claims.

Run `npm run check:project-state` to validate ledger consistency. A pass proves
the control plane only; it does not promote runtime or outcome evidence.
