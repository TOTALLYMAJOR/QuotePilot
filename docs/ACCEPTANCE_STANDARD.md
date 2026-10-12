# QuotePilot Acceptance Standard and Definition of Done

Last updated: 2026-09-24 01:57:41 CDT

## Purpose

Acceptance criteria answer whether a specific requirement works. This standing
Definition of Done answers whether the increment is finished to QuotePilot's
standard. Both are required.

## Evidence classes

| Evidence class | What it may prove | What it cannot prove |
|---|---|---|
| Source | Required code, contract, and documentation exist | Execution, deployment, acceptance, or outcome |
| Focused local | Named behavior passes in a bounded local test | Repository-wide health, hosted behavior, or human acceptance |
| Repository/CI | Required checks pass on the exact candidate SHA | Deployment, provider state, production data, or outcomes |
| Hosted/deployment | Exact artifact is active at a named target | Correct provider outcome, ordinary-role behavior, or human acceptance |
| Provider | Provider accepted or later reported an exact action | Recipient behavior, customer consent, or commercial value |
| Production readback | Exact tenant/runtime/data state exists | Safe ordinary use, comprehension, adoption, or outcomes |
| Human acceptance | Named actors completed and understood the governed journey | Broad adoption, retention, or commercial impact |
| Outcome | Frozen eligible measures support the claimed improvement | Causality unless the design and evidence justify it |

No evidence class substitutes for another.

## Standing Definition of Done

### Correctness

- Applicable PRD acceptance criteria pass.
- Authoritative state, historical versions, exact money, and receipts remain
  consistent across the affected workflow.
- Happy path, denial, stale input, duplicate/retry, ambiguity, recovery, and
  empty/error states are tested where applicable.
- New tests would fail without the change and pass with it.
- Required focused, unit, integration, and end-to-end checks pass.

### Security and privacy

- Tenant and role denial are exercised at the owning server/rules seam.
- Customer projections disclose only explicitly contracted fields.
- Secrets, tokens, private evidence, free text, and unbounded identifiers do not
  enter source, logs, analytics, or customer payloads.
- Consequential operations bind exact request and revision identities and remain
  idempotent or safely reconcilable.
- Any confirmed `GRD-01`–`GRD-10`, `GRD-14`, or `GRD-15` stop breach blocks the
  release regardless of speed or conversion gains.

### User experience and accessibility

- Default, loading, empty, partial, stale, blocked, error, unknown, success, and
  recovery states are represented as applicable.
- Keyboard, focus, zoom, forced-colors, responsive containment, and accessible
  names pass the governed checks.
- Release-critical journeys target WCAG 2.2 AA and record assistive-technology
  and human evidence separately from automation.
- Copy identifies the state, owner, consequence, and safe next action without
  implying authority or evidence that does not exist.

### Performance and reliability

- Applicable bundle and runtime budgets in `PERFORMANCE_GUARDRAILS.md` pass or
  have a bounded, time-limited exception.
- Consequential asynchronous actions expose pending/unknown state, exact receipt,
  reconciliation, timeout behavior, and rollback or safe-off path.
- No product-wide latency or availability claim is made without an eligible
  production telemetry source and frozen SLO.

### Integration and compatibility

- Public contracts, schemas, receipts, and stored versions are compatible or
  have an explicit migration and rollback plan.
- Backend user capability changes are bound to a discoverable role-safe surface,
  UI-state tests, Feature Matrix, User Manual, and capability-surfacing contract.
- External provider behavior is verified separately from local simulation.
- Independent domain authorities remain independent; no new blended readiness or
  client-side authority is introduced.

### Documentation and decisions

- The relevant charter, PRD, architecture, contract, risk, ADR, backlog, status,
  manual, and changelog authorities are updated according to `DOC_SYSTEM.md`.
- Significant trade-offs have an ADR with alternatives, consequences, and a
  reconsideration trigger.
- Current-state prose is not copied into historical or index documents.

### Release and review

- Required checks pass on the exact candidate SHA.
- Deployment target, artifact, runtime configuration, tenant gates, and rollback
  receipt are explicit where release is in scope.
- Residual risks and open proof classes are stated.
- The product owner or delegated reviewer accepts the change before merge or
  production promotion when human approval is required.

## Core product release gate

The core product release closes only when `QPI-01` through `QPI-05` satisfy their
own acceptance criteria and required evidence classes:

1. trusted operator release;
2. first trustworthy priced quote;
3. governed customer decision;
4. ordinary payment and closeout; and
5. controlled accepted change into current operations.

This gate does not require commercial proof (`QPI-08`) or optional model
assistance (`QPI-09`). It does require every stop guardrail to remain clear.

## Required failure scenarios

- Unauthenticated, unverified, wrong-role, and cross-tenant access.
- Stale revision, catalog, proposal, operational basis, or imported receipt.
- Duplicate request, submission, webhook, payment, or command.
- Provider timeout before or after dispatch and late outcome arrival.
- Partial write, incomplete receipt pair, and interrupted recovery.
- Missing, not applicable, not yet available, blocked, contradictory, and schema
  drift evidence.
- Unsupported configuration, feature off, provider unavailable, and safe local
  fallback.
- Narrow viewport, zoom, keyboard-only, forced-colors, and assistive technology.

## Validation floor

Repository workflow selects the exact lanes. At minimum, every material change
runs `npm run check:env`, `npm run build`, the relevant focused tests, and the
governance checks selected by `npm run plan:task`. Passing focused checks must be
reported as focused evidence, not as a repository-green claim.
