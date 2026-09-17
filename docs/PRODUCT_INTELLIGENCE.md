# QuotePilot Product Intelligence System

Last updated: 2026-09-17 12:09:23 CDT

## Quote-to-Confidence measurement extension

The local, default-off candidate adds `MET-19`–`MET-21`, categorical completion
and learning signals `SIG-017`–`SIG-021`, five named operator journeys, and
`BASE-09` with a 14-day pre-exposure baseline. Fewer than 50 eligible observations
per compared cohort are informational only. `LED-006` records source/local
implementation without adoption or outcome claims. No baseline has been collected.
Reporting retains proposed and receipt-confirmed counts separately for recipe,
template, pack-conversion and workflow categories. A zero completion-action
denominator yields an unavailable (`null`) resolution rate, not zero performance.
Presentation-only capability contracts are export-free: callable ownership and
complete read/mutation lifecycles remain with existing authority contracts.
Final integration corrections stop new shelf-count requests after scope changes,
retain original attempt outcomes, allow backend-derived supply resolution after
an empty-shortage rebase, and align Legacy recorded-cost comparisons. These are
local reliability corrections under `LED-006`; no metric or exposure changes.

## Purpose

This is the canonical entry point for deciding whether QuotePilot creates
measurable catering value. It connects product intent, user capabilities,
metrics, observation, targets, journeys, guardrails, and release causality.

It does not replace the Feature Matrix, Product Status, backlog, ADRs, PRDs,
test plans, or release receipts. Those sources answer different questions.

## Governing product question

Does QuotePilot help a catering team move from uncertain customer intent to an
explainable commercial commitment, a current operational plan, a controlled
event, and a defensible financial closeout with less avoidable rework and risk?

There is intentionally no blended event-readiness or business-success score.
Commercial, operational, document, payment, human, and outcome evidence remain
separate so strength in one area cannot hide failure in another.

## Required artifacts

| # | Artifact | Governing question | Current state |
|---:|---|---|---|
| 1 | [Product Outcome Contract](product-intelligence/PRODUCT_OUTCOME_CONTRACT.md) | Why does QuotePilot exist, for whom, and what should improve? | Furnished; owner acceptance required for proposed portfolio outcomes. |
| 2 | [Capability / Functional Map](product-intelligence/CAPABILITY_MAP.md) | What must users be able to do? | Furnished from the current Feature Matrix and authority docs. |
| 3 | [Success Metric Specification](product-intelligence/SUCCESS_METRICS.md) | Which measures distinguish product value from activity? | Furnished; observability is explicit per metric. |
| 4 | [Instrumentation / Event Schema](product-intelligence/event-schema.json) | Can the measures actually be observed without corrupting authority or privacy? | Furnished; implemented, derivable, partial, and missing signals are distinguished. |
| 5 | [Baselines + Targets](product-intelligence/BASELINES_AND_TARGETS.md) | Compared with what, and how good is good enough? | Baseline protocol and proposed targets furnished; production baselines remain uncollected. |
| 6 | [User Journey / Funnel Model](product-intelligence/USER_JOURNEY_FUNNELS.md) | Where does value creation succeed or fail? | Furnished for owner-operator and customer-event-contact journeys. |
| 7 | [Quality / Reliability Guardrails](product-intelligence/QUALITY_GUARDRAILS.md) | Could apparent growth hide a broken or unsafe product? | Furnished from existing authority and quality gates. |
| 8 | [Release / Experiment Ledger](product-intelligence/RELEASE_EXPERIMENT_LEDGER.md) | What changed that might explain a result? | Furnished with historical seeds and a prospective decision protocol. |

## Catering-value declaration

Every substantive product, UX, architecture, experiment, and governance task
must be expressible in this compact form:

```text
Catering value
- Actor:
- Job or decision:
- Expected improvement:
- Outcome or metric IDs:
- Guardrail IDs:
- Evidence needed:
```

An enabling task may name indirect value. Mechanical work may state
`not_applicable` rather than inventing a catering benefit.

## Traceability rule

A material product change is outcome-traceable only when it links:

```text
OUTCOME -> CAPABILITY -> METRIC -> SIGNAL -> TARGET -> JOURNEY STAGE
        -> GUARDRAIL -> RELEASE OR EXPERIMENT ENTRY -> OWNER DECISION
```

Missing links remain `unknown` or `not_observable`; they are never silently
treated as zero, success, or not applicable.

## Enforcement

`npm run check:product-intelligence` is the fail-closed structural gate. It
validates required artifacts, unique identifiers, cross-artifact references,
event status/capture vocabulary, signal source paths, declaration fields,
ledger decision vocabulary, and the rule that `adopt` requires explicit
outcome evidence. It also checks Git change impact:

- product-intelligence artifact changes require this index to move;
- product-analytics implementation changes require the event schema, metric
  specification, ledger, and index to move together;
- Feature Matrix or capability-surfacing authority changes require the
  capability map, ledger, and index; and
- user-visible component changes require the index and ledger.

The task planner emits `productIntelligence.disposition`, the required
catering-value fields, documentation obligations, and this validation. Purely
mechanical work may use `not_applicable`, but the pull request must explain why.
`lane:core` runs the gate in CI. For pull requests, the gate reads the Product
Intelligence Contract from the PR body, rejects missing or unknown governed IDs,
requires a rationale for `not_applicable`, and rejects `not_applicable` when the
diff contains a product-intelligence artifact, analytics implementation,
capability authority, or user-visible product source.

A passing gate proves structural traceability only. It does not prove that a
target is commercially correct, that production telemetry is complete, or that
a caterer experienced the intended outcome. Owner acceptance and outcome
evidence remain separate controls.

## Evidence classes

Keep these claims separate:

- `source`: the contract or implementation exists.
- `local`: a local check exercised it.
- `ci`: the exact candidate passed CI.
- `hosted`: a deployed surface was reached.
- `provider`: an external provider returned bounded evidence.
- `production`: the intended production system produced the evidence.
- `human`: the intended actor understood and accepted the experience.
- `outcome`: the intended business or operational result changed.

Only `outcome` evidence can establish product success. Earlier classes explain
whether the system was capable of producing and observing that outcome.

## Maintenance triggers

Update this system when any of the following changes:

- the product's intended catering outcome or primary actor;
- a user-relevant capability is added, retired, or materially changed;
- a metric definition, denominator, target, segment, or decision rule changes;
- an analytics event or authoritative evidence source changes;
- a journey stage or moment of truth changes;
- a quality or authority boundary changes; or
- a release or experiment could plausibly move a governed metric.

Backlog priority, roadmap timing, architecture rationale, and test procedures
remain in their existing canonical owners.
