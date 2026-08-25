# QuotePilot Canonical Project State

Last updated: 2026-08-25 00:43:38 CDT

## Current State

QuotePilot is a deployed commercial SaaS product with a broad, tested source
surface. Exact `v0.14.0` is recorded at both the Vercel public edge and the
Firebase Hosting, Functions, rules, and indexes target. Remote `main` is four
green-CI commits newer than that release, and this reconciled branch contains
additional source-only work. The primary operating journey exists, but current
candidate deployment, tenant-250 provisioning/activation, authenticated
production, provider, recipient, human-acceptance, adoption, and revenue
evidence are incomplete or UNVERIFIED.

The machine-readable reconciliation is [`.project/state.json`](.project/state.json).
This page is an entry point, not a replacement for established authorities.

## Canonical Authority Map

| Question | Canonical source |
|---|---|
| What capabilities exist in source? | [`docs/FEATURE_MATRIX.md`](docs/FEATURE_MATRIX.md) |
| What is deployed or operational now? | [`PROJECT_STATUS.md`](PROJECT_STATUS.md) |
| What work remains and in what order? | [`DEV_TASKS.md`](DEV_TASKS.md) |
| What changed historically? | [`CHANGELOG.md`](CHANGELOG.md) |
| How does an operator use the product? | [`docs/USER_MANUAL.md`](docs/USER_MANUAL.md) |
| What claim has what evidence? | [`docs/project/PROOF.md`](docs/project/PROOF.md) |
| What decisions and explorations shape the work? | [`docs/project/DECISIONS.md`](docs/project/DECISIONS.md) and [`docs/project/EXPLORATIONS.md`](docs/project/EXPLORATIONS.md) |

## Lifecycle Vocabulary

`IDEA`, `SPECIFIED`, `DESIGNED`, `IMPLEMENTED`, `TESTED`, `VERIFIED`,
`DEPLOYED`, `USED`, `COMMERCIALLY_PROVEN`, `DEPRECATED`, and `BLOCKED` are
distinct states. A higher state is recorded only when its own evidence exists.
Source or local test success never proves deployment, provider behavior, human
acceptance, use, or commercial value.

## Reconciled Product View

- Primary user: catering owners and sales/event operators; customers act in the
  proposal, decision, and payment portions of the journey.
- Economic buyer: a catering business owner or operating administrator. Actual
  buyer validation remains UNVERIFIED.
- Primary journey: demand intake → authoritative quote → exact saved revision →
  proposal → customer decision → payment evidence → BEO/staffing handoff.
- Strongest current evidence: source inventory, focused/local tests, exact-main
  CI, exact `v0.14.0` dual-target deployment, and public-edge reachability.
- Largest uncertainty: the exact current authenticated production journey and
  the commercial adoption/revenue layer.

## NEXT PROOF EVENT

After the reconciled candidate passes exact-SHA CI, is published and promoted
to both governed production targets, and tenant `250` is established through a
reviewed provisioning/migration path before the protected staffing activation
workflow succeeds, one authorized tenant-250 operator completes the exact
quote-to-operations journey: create and save a quote revision, reopen it, issue
its current proposal, record the customer decision, and generate the
revision-bound BEO. The proof must include the exact release/deployment
receipts, tenant setting readback, exact revision readback, role-safe UI
evidence, cross-tenant and invalid-portal denial, and honest separation of any
missing provider or recipient outcome.

This is the only designated next proof event. It reduces uncertainty across the
quote, proposal, event-operations, staffing, and Ambient presentation cohorts.

## Control Plane

Run `npm run check:project-state` to detect invalid lifecycle values, missing or
stale evidence, broken repository references, contradictory blocked states,
duplicate IDs, and multiple or missing next proof events. `lane:quick` runs the
same check. A passing check establishes internal consistency only; it does not
promote any product or commercial claim.
