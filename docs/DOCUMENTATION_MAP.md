# QuotePilot Documentation Authority Map

Last updated: 2026-09-24 01:57:41 CDT

## Purpose

This map answers where each system-level product question is decided. It is an
index, not a ninth source of product truth. Each authority below owns one class
of decision; subordinate documents add detail without replacing it.

## Eight required authorities

| # | Question | Canonical authority | Supporting detail | Completion signal |
|---|---|---|---|---|
| 1 | Why does QuotePilot exist? | [`PROJECT_CHARTER.md`](PROJECT_CHARTER.md) | [`product-intelligence/PRODUCT_OUTCOME_CONTRACT.md`](product-intelligence/PRODUCT_OUTCOME_CONTRACT.md) | Problem, actors, outcomes, scope, constraints, and success policy are explicit. |
| 2 | What must the product do? | [`PRODUCT_REQUIREMENTS.md`](PRODUCT_REQUIREMENTS.md) | [`product-intelligence/CAPABILITY_MAP.md`](product-intelligence/CAPABILITY_MAP.md), [`product-intelligence/USER_JOURNEY_FUNNELS.md`](product-intelligence/USER_JOURNEY_FUNNELS.md), feature PRDs | Core workflows, requirements, priorities, edge cases, and the release boundary are traceable. |
| 3 | How does the system work? | [`SYSTEM_ARCHITECTURE.md`](SYSTEM_ARCHITECTURE.md) | Domain ADRs, technical designs, `README.md` | Components, seams, data flows, dependencies, trust boundaries, deployment, and failure behavior are current. |
| 4 | What counts as done? | [`ACCEPTANCE_STANDARD.md`](ACCEPTANCE_STANDARD.md) | [`acceptance/`](acceptance/), [`product-intelligence/QUALITY_GUARDRAILS.md`](product-intelligence/QUALITY_GUARDRAILS.md) | Acceptance criteria and the standing Definition of Done pass with the required evidence classes. |
| 5 | Why were important choices made? | [`adr/README.md`](adr/README.md) | [`project/DECISIONS.md`](project/DECISIONS.md), individual ADRs | Every expensive, surprising trade-off has an accepted or explicitly proposed record and reconsideration trigger. |
| 6 | What may components exchange? | [`DATA_INTERFACE_CONTRACTS.md`](DATA_INTERFACE_CONTRACTS.md) | Canonical JSON contracts, authority ADRs, schemas, callable contracts | Data owner, schema, state, error, version, and compatibility rules are named. |
| 7 | What could invalidate the plan? | [`RISK_ASSUMPTION_REGISTER.md`](RISK_ASSUMPTION_REGISTER.md) | `PROJECT_STATUS.md`, [`project/BLOCKERS.md`](project/BLOCKERS.md) | High-impact assumptions have validation plans; open risks have owners, mitigations, and review triggers. |
| 8 | What work happens next? | [`../DEV_TASKS.md`](../DEV_TASKS.md) and GitHub Issues | [`plans/`](plans/), `PROJECT_STATE.md` | Work is dependency-ordered, acceptance-bound, and tied to validation and release criteria. |

## Meaning of finished

QuotePilot uses five independent completion levels:

1. **Defined** — the charter, system PRD, architecture, and applicable decision
   records agree on the intended boundary.
2. **Implemented** — the required source capability exists and its focused local
   checks pass.
3. **Release-ready** — exact-candidate CI, security, performance, documentation,
   rollback, and applicable hosted/provider gates pass.
4. **Accepted** — the required operators and customers complete the governed
   journey with role, accessibility, recovery, and comprehension evidence.
5. **Outcome-proven** — frozen metrics and eligible real-world samples support
   the claimed improvement without breaching a guardrail.

One level never implies another. “Implemented,” “deployed,” “accepted,” and
“successful” are different claims.

## Current release boundary

- **Core product release:** `QPI-01` through `QPI-05` in `DEV_TASKS.md`.
- **Operational learning expansion:** `QPI-06` and `QPI-07`.
- **Commercial proof:** `QPI-08`.
- **Optional bounded operator assistance:** `QPI-09`.

The later phases may start only when their declared dependencies hold. They are
not silently added to the definition of the core product release.

## Change routing

Update the owning authority first. Then update only affected indexes and
subordinate documents. Do not copy complete status, schema, backlog, or decision
records into this map.
