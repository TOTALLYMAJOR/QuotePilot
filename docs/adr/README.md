# QuotePilot Architecture Decision Index

Last updated: 2026-09-24 01:57:41 CDT

## Purpose

This is the canonical entry point for system-level architecture decisions.
Individual ADRs remain authoritative. [`../project/DECISIONS.md`](../project/DECISIONS.md)
is a compatibility summary and must link back here or to the owning decision.

## Decision standard

Create an ADR only when the decision is:

1. expensive to reverse;
2. surprising without its context; and
3. the result of a real trade-off among alternatives.

Each ADR records status, context, decision, alternatives, rationale,
consequences, affected authorities, and the condition that should trigger
reconsideration. Do not delete accepted history. A changed decision receives a
new ADR that supersedes the prior record.

Lifecycle: `Proposed` → `Accepted` → `Superseded`, `Deprecated`, or `Rejected`.

## Numbered system decisions

| ADR | Decision area |
|---|---|
| [`ADR-0001-package-workspace-state-and-persistence.md`](ADR-0001-package-workspace-state-and-persistence.md) | Package Workspace state and persistence |
| [`ADR-0002-product-truth-observability.md`](ADR-0002-product-truth-observability.md) | Product truth observability and drift policy |
| [`ADR-0003-commercial-platform-vertical-pack.md`](ADR-0003-commercial-platform-vertical-pack.md) | Commercial platform and vertical-pack architecture |

## Established domain decisions

These predate or sit outside the numbered series. They remain authoritative and
must not be renumbered merely for consistency.

| Decision | Authority |
|---|---|
| Ambient workspace arrival | [`../AMBIENT_WORKSPACE_ARRIVAL_ADR.md`](../AMBIENT_WORKSPACE_ARRIVAL_ADR.md) |
| Attendance state | [`../ATTENDANCE_STATE_ADR.md`](../ATTENDANCE_STATE_ADR.md) |
| Commercial Change authority | [`../COMMERCIAL_CHANGE_AUTHORITY_ADR.md`](../COMMERCIAL_CHANGE_AUTHORITY_ADR.md) |
| Commercial dependency graph | [`../COMMERCIAL_DEPENDENCY_GRAPH_ADR.md`](../COMMERCIAL_DEPENDENCY_GRAPH_ADR.md) |
| Commercial Truth Loop | [`../COMMERCIAL_TRUTH_LOOP_ADR.md`](../COMMERCIAL_TRUTH_LOOP_ADR.md) |
| Event Workspace | [`../EVENT_WORKSPACE_ADR.md`](../EVENT_WORKSPACE_ADR.md) |
| Intent intake | [`../INTENT_INTAKE_ADR.md`](../INTENT_INTAKE_ADR.md) |
| Ingredient Inventory | [`../INVENTORY_AUTHORITY_ADR.md`](../INVENTORY_AUTHORITY_ADR.md) |
| Operational Staffing | [`../OPERATIONAL_STAFFING_AUTHORITY_ADR.md`](../OPERATIONAL_STAFFING_AUTHORITY_ADR.md) |
| Revenue Autopilot | [`../REVENUE_AUTOPILOT_ADR.md`](../REVENUE_AUTOPILOT_ADR.md) |
| Steward | [`../STEWARD_ADR.md`](../STEWARD_ADR.md) |
| Tenant operating model | [`../TENANT_OPERATING_MODEL_ADR.md`](../TENANT_OPERATING_MODEL_ADR.md) |

## Review rule

Architecture work starts by locating the existing decision here. If none owns
the trade-off, create one in the repository's current numbered format under this
directory unless a scoped program already has an established ADR convention.
Conflicting decisions are surfaced and reconciled; a new document does not
silently override an accepted decision.
