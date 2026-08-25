# QuotePilot Canonical Project State

Last updated: 2026-08-24 20:18:29 CDT

## Current State

QuotePilot is a deployed commercial SaaS product with a broad, tested source
surface and a split production release: exact `v0.11.0` is recorded at the
Vercel public edge, while Firebase Hosting and Functions remain at the latest
recorded successful `v0.9.0` promotion. The primary operating journey exists,
but current authenticated production, provider, recipient, human-acceptance,
adoption, and revenue evidence are incomplete or UNVERIFIED.

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
  CI, Vercel deployment, and public-edge reachability.
- Largest uncertainty: the exact current authenticated production journey and
  the commercial adoption/revenue layer.

## NEXT PROOF EVENT

After separately authorized Firebase credential rotation, exact `v0.11.0`
all-scope deployment, and tenant-250 staffing activation, one authorized
tenant-250 operator completes the exact quote-to-operations journey: create and
save a quote revision, reopen it, issue its current proposal, record the
customer decision, and generate the revision-bound BEO. The proof must include
the release/deployment receipt, exact revision readback, role-safe UI evidence,
cross-tenant and invalid-portal denial, and honest separation of any missing
provider or recipient outcome.

This is the only designated next proof event. It reduces uncertainty across the
quote, proposal, event-operations, staffing, and Ambient presentation cohorts.

## Control Plane

Run `npm run check:project-state` to detect invalid lifecycle values, missing or
stale evidence, broken repository references, contradictory blocked states,
duplicate IDs, and multiple or missing next proof events. `lane:quick` runs the
same check. A passing check establishes internal consistency only; it does not
promote any product or commercial claim.
