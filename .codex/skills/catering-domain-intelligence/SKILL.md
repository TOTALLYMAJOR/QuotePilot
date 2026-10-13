---
name: catering-domain-intelligence
description: Reconsider substantive QuotePilot product, architecture, workflow, UX, commercial, payment, or operational work with the smallest relevant catering-domain context. Use when the task planner requires it or when catering expertise could materially change an intended action; do not use for mechanical repository work merely because QuotePilot serves caterers.
---

# Catering Domain Intelligence

Last updated: 2026-09-08 15:04:45 CDT

Improve the intended action, not the amount of domain commentary.

## Required Sequence

1. Reconstruct the user's objective and distinguish it from the proposed method.
2. Read the planner's `domainClassification.authorityReads`, the task-owned
   source, and other current executable evidence before consulting domain
   references.
3. Form a provisional intended action from that stronger authority.
4. Read only the files in `domainClassification.referenceSlices`. When the
   skill is invoked without a planner packet, choose the smallest relevant
   slices from the routing table below.
5. Reconcile **domain model x QuotePilot authority x current implementation**.
6. Classify the effect as exactly one of `RETAIN`, `REFINE`, `REPLACE`,
   `EXPAND`, `BOUND`, or `NO_MATERIAL_EFFECT`.
7. Carry every material consequence into the final action, risks, and
   validation. Do not manufacture a change to demonstrate expertise.

Do not implement before step 6 when domain reconsideration applies.

## Authority

Use this precedence:

1. Current runtime and executable repository evidence.
2. Current canonical QuotePilot product and architecture authority.
3. Accepted QuotePilot ADRs, contracts, invariants, and product decisions.
4. The user's governing objective and explicit task constraints.
5. Relevant catering-domain knowledge.
6. Dated external reference intelligence.
7. General model knowledge.

Domain material may challenge a method. It cannot silently redefine the
product, invent policy, or override a stronger authority. Surface a
consequential conflict instead.

## Reconsideration Record

Maintain this reasoning internally; persist it only when the task's evidence
contract requires that:

```text
applicable
domainContexts
provisionalAction
governingDomainModel
materialConsequences
decision
revisedAction
validationImplications
authorityConflicts
```

`RETAIN` means the domain review supports the provisional action.
`NO_MATERIAL_EFFECT` means no catering-specific implication changes the work.
Both are successful outcomes.

## Visible Behavior

Explain the reconsideration when a revision or authority conflict helps the
human understand the work. Keep routine `RETAIN` and `NO_MATERIAL_EFFECT`
reasoning implicit unless disclosure adds decision value. Never require a
canned heading, aphorism, or "domain insight" paragraph.

## Reference Routing

- Always start applicable review with
  [domain-model.md](references/domain-model.md).
- Quote, pricing, proposal, revision, or acceptance:
  [commercial.md](references/commercial.md).
- Payment or provider ambiguity:
  [payment-reconciliation.md](references/payment-reconciliation.md).
- Event work, scheduling, readiness, or execution:
  [event-operations.md](references/event-operations.md).
- Workforce or event assignments: [staffing.md](references/staffing.md).
- Catalog, menu, or production consequences:
  [menu-production.md](references/menu-production.md).
- BEOs and operational document currentness:
  [beo-document-truth.md](references/beo-document-truth.md).
- Navigation, portals, dashboards, or role projection:
  [ux-customer-experience.md](references/ux-customer-experience.md).
- Explicit failure, recovery, ambiguity, or adversarial validation:
  [failure-patterns.md](references/failure-patterns.md).
- Source classification and exclusions: [provenance.md](references/provenance.md).

When this skill, its routing, or its governing agent behavior changes, do not
claim unit tests prove reasoning quality. After deterministic checks, use the
separate [expertise evaluation](evals/catering-domain-reconsideration.md) in a
genuinely fresh agent session and report human acceptance separately.
