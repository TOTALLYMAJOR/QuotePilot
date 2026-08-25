# QuotePilot Canonical Project State

Last updated: 2026-08-25 15:46:40 CDT

## Identity

| Field | Evidence-backed value |
|---|---|
| Project | QuotePilot by MBMApps |
| Repository | `https://github.com/TOTALLYMAJOR/quoteflow` |
| Primary Purpose | Turn catering demand into governed quotes, customer decisions, payments, and event operations without blurring evidence boundaries. |
| Primary User / Actor | Catering owners and sales/event operators; customers participate in proposal, decision, and payment steps. |
| Economic Buyer | Catering business owner or operating administrator; direct buyer validation is `UNVERIFIED`. |
| Problem Solved | Replaces fragmented quote-to-event work with tenant-scoped pricing, exact revisions, customer decisions, payment evidence, and operational handoff. |
| Current Product Stage | Commercial SaaS with exact `v0.15.0` deployed; authenticated production use and commercial proof remain `UNVERIFIED`. |
| Primary Deployment Target | Vercel public edge plus Firebase Hosting, Functions, Firestore rules, and indexes. |
| Last Evidence Reconciliation | 2026-08-25 against runtime SHA `bc495c8c948d440b12363d5da34209a11ff151fd` and receipt-only `main` SHA `d40ec929e5d70142683966e872b6f91b4a508cad`. |

## Current State

Exact `v0.15.0` passed the required exact-main CI matrix and is recorded at
both governed production targets. The later receipt-only documentation commit
on `main` does not change the runtime artifact. Source, test, CI, deployment,
tenant activation, provider outcomes, recipient behavior, human acceptance,
usage, and commercial proof remain separate evidence classes. Tenant-250
provisioning/activation and the authenticated primary production journey are
still `UNVERIFIED`.

The machine-readable reconciliation is [`.project/state.json`](.project/state.json).
This page is a thin entry point, not a replacement for established authorities.

## North-Star Goal

QuotePilot succeeds when an authorized catering operator can move one real
event from inquiry through an exact authoritative quote, customer decision,
payment evidence, and operational handoff without hidden authority gaps, while
the business can demonstrate repeatable use and measurable economic value.

- Technical success: pricing, tenancy, identity, revisions, and provider
  effects remain server-authoritative and fail closed.
- User success: an operator completes the primary journey with explicit state,
  recovery, and evidence at each consequential transition.
- Operational success: release, deployment, provider, recipient, and acceptance
  evidence are independently inspectable and reproducible.
- Commercial success: validated buyers activate, repeatedly use the product,
  pay for it, retain it, and demonstrate a measurable outcome. Current
  commercial success is `UNVERIFIED`.

## Canonical Journey

Primary journey:

```text
Catering demand arrives
→ authorized sales operator
→ creates and saves an authoritative quote revision
→ tenant quote/version state changes
→ Firebase Functions, tenant catalog, exact revision, and immutable receipts
→ current proposal and customer-decision state
→ payment evidence and revision-bound BEO/staffing handoff
→ one governed event is ready for operator execution without inferred evidence
```

Supporting journey: an economic buyer requests access, completes the bounded
buyer flow, receives an exact-email tenant activation, configures pricing, and
creates a first quote. That journey is `TESTED`, not operationally or
commercially proven.

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
Missing required evidence is `UNVERIFIED`; source or test success never proves
deployment, provider behavior, human acceptance, use, or commercial value.

## NEXT PROOF EVENT

**Proof Event:** An authorized tenant-250 operator completes the exact
quote-to-operations journey on `v0.15.0` after reviewed tenant provisioning and
protected staffing activation.

**Why It Matters:** This single observable event reduces uncertainty across
quote lifecycle, proposal decision, event operations, staffing, and Ambient
presentation without pretending that provider or recipient evidence exists.

**Prerequisites:** Establish `organizations/250/settings/config` through the
reviewed tenant migration/provisioning path, then run the protected staffing
activation workflow and retain its verified readback.

**Acceptance Criteria:** The operator creates and saves an exact quote revision,
reopens it, issues its current proposal, records the customer decision, and
generates the revision-bound BEO. Role, cross-tenant, and invalid-portal paths
must fail closed.

**Required Evidence:** Exact release and deployment receipts; tenant setting
readback; authenticated role-safe UI receipts; exact saved-revision readback;
cross-tenant and invalid-portal denial; and explicit `UNVERIFIED` labels for any
missing provider, recipient, or human outcome.

**Current Blockers:** `block-tenant-250-provisioning`,
`block-authenticated-production-acceptance`, and `block-provider-acceptance` in
[`.project/state.json`](.project/state.json).

## Control Plane

Run `npm run check:project-state` to detect schema violations, invalid or
contradictory lifecycle states, placeholder claims, stale verification,
missing evidence paths, broken dependency/blocker references, invalid proof
verdicts, incomplete ledger records, and multiple or missing next proof events.
`lane:quick` runs the same check. A pass establishes repository consistency
only; it does not promote any runtime, provider, human, usage, or commercial
claim.
