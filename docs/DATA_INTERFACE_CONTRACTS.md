# QuotePilot Data and Interface Contract Index

Last updated: 2026-09-24 01:57:41 CDT

## Purpose

This index identifies the owner of each critical contract. It does not duplicate
schemas or create a new aggregate data authority.

## Contract registry

| Contract area | Canonical authority | Interface or schema | Owner |
|---|---|---|---|
| Commercial pricing and receipts | [`PRICING_CONSTITUTION.md`](PRICING_CONSTITUTION.md) | Versioned exact-money policy, pricing receipt, waterfall, payment provenance | Pricing authority |
| Offer, template, rule, and vertical-pack model | [`COMMERCIAL_PLATFORM_PROGRAM.md`](COMMERCIAL_PLATFORM_PROGRAM.md) | Commercial kernel and compatibility/migration contracts | Commercial platform |
| Quote and accepted-change lifecycle | [`COMMERCIAL_CHANGE_AUTHORITY_ADR.md`](COMMERCIAL_CHANGE_AUTHORITY_ADR.md) | Current/proposed/difference/consequence/authorization/receipt/recovery | Commercial Change authority |
| Ingredient Inventory and menu cost | [`INVENTORY_AUTHORITY_ADR.md`](INVENTORY_AUTHORITY_ADR.md) | Ingredient, stock, cost, recipe, demand, allocation, consumption, projection | Inventory authority |
| Operational Staffing | [`OPERATIONAL_STAFFING_AUTHORITY_ADR.md`](OPERATIONAL_STAFFING_AUTHORITY_ADR.md) | Staff profiles, plans, assignments, conflicts, receipts | Staffing authority |
| Attendance state | [`ATTENDANCE_STATE_ADR.md`](ATTENDANCE_STATE_ADR.md) | Planned, confirmed, commercial-basis, and actual attendance | Attendance authority |
| Field state | [`field-state-contract.json`](field-state-contract.json) | Availability, origin, editability, persistence, evidence, choice cardinality | Field-state contract |
| Field-state adoption | [`field-state-surface-contracts.json`](field-state-surface-contracts.json) | Surface markers and assertion-bearing test bindings | Surface registry |
| Backend capability surfacing | [`capability-surfacing-contracts.json`](capability-surfacing-contracts.json) | Callable/helper ownership, UI states, docs, tests | Capability-surfacing contract |
| Truth Loop evidence | [`truthloop-evidence-contract.json`](truthloop-evidence-contract.json) | Rules, evidence, availability states, reason codes | Evidence exporter and Truth Loop shared contract |
| Product events and metrics | [`product-intelligence/event-schema.json`](product-intelligence/event-schema.json), [`product-intelligence/SUCCESS_METRICS.md`](product-intelligence/SUCCESS_METRICS.md) | Privacy-bounded events, eligibility, denominator, metric interpretation | Product Intelligence |
| Task orchestration | [`task-orchestration-contracts.json`](task-orchestration-contracts.json) | Risk profile, dependency reads, skills, docs, validation routing | Repository governance |
| Release/UAT checklist | [`release-uat-checklist.json`](release-uat-checklist.json) | Release acceptance states and evidence references | Release management |
| Customer-safe projection | Owning portal/proposal ADRs and server DTOs | Explicit allowlisted customer fields and current issuance | Customer projection authority |
| External providers | Owning server callable, ledger, provider reconciliation, and program doc | Request identity, dispatch, acceptance, webhook, settlement/delivery, recovery | Provider-specific authority |

## Interface rules

1. The caller supplies untrusted intent; the owning module validates identity,
   tenant, role, schema, lifecycle eligibility, revision, and idempotency.
2. Every consequential result returns or persists an exact receipt or an
   explicit unavailable/unknown outcome.
3. Client DTOs contain the minimum role-safe projection; internal records are
   not treated as public interfaces.
4. Provider request and outcome identities remain separate from browser-return
   state and client success responses.
5. Domain projections cite the exact source basis and currentness; they do not
   rewrite the source authority.
6. Evidence contracts distinguish `missing`, `not_applicable`,
   `not_yet_available`, `blocked_by_integration`, `contradictory`, and
   `schema_drift`. Only allowed states may reach a verdict.

## State-machine ownership

| State machine | Owner | Required invariant |
|---|---|---|
| Quote and proposal | Commercial and proposal authorities | Draft, issued, viewed, decided, expired, revised, and accepted history remain distinct. |
| Accepted change | Commercial Change authority | Simulation, authorization, apply, receipt, ambiguity, and recovery are revision-bound. |
| Payment | Payment ledger and provider reconciliation | Obligation, request, acceptance, settlement, refund/failure, and unknown remain distinct. |
| Catalog publication | Catalog authority | Draft, preflight, conflict, publication, active revision, and provenance are explicit. |
| Operational projection | Owning domain | Current, stale, missing, blocked, contradictory, and recovery reference an exact basis. |
| Evidence evaluation | Truth Loop contract | Availability state precedes verdict; findings never mutate policy or source data. |

## Error contract

Errors must be safe for their audience and stable enough for recovery:

- server logs and receipts may retain bounded internal diagnostics;
- clients receive category, safe message, retry/recovery eligibility, and exact
  correlation identity when disclosure is safe;
- customer surfaces never receive staff-only or provider-private detail;
- unknown provider or mutation outcome is not rewritten as failed or successful;
- validation errors create no partial authority artifacts.

## Versioning and compatibility

- Accepted commercial versions, signatures, receipts, and provider evidence are
  immutable.
- Contract changes use explicit schema/policy versions and preserve historical
  interpretation.
- Additive change is preferred. Breaking change requires an ADR, migration,
  compatibility/read strategy, rollback, and affected-consumer proof.
- Operator-declared values carry declaring actor and timestamp; history is not
  mined into policy.
- Fixtures and synthetic provenance remain identifiable and cannot impersonate
  real provider, customer, or operating evidence.

## Ownership rule

When two components disagree, the named domain authority decides its own truth.
Composition layers may present the disagreement and route recovery; they may not
silently choose, merge, or overwrite authorities.
