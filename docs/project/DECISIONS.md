# Material Decision Index

Last updated: 2026-08-24 20:18:29 CDT

This is an index of active cross-cutting decisions. The linked ADR or policy is
the authority; this page does not restate its full rationale.

| Decision | Status | Authority |
|---|---|---|
| Pricing, tenancy, provider effects, and readiness fail closed under server authority. | Accepted | [`docs/DOC_SYSTEM.md`](../DOC_SYSTEM.md), [`docs/COMMERCIAL_CHANGE_AUTHORITY_ADR.md`](../COMMERCIAL_CHANGE_AUTHORITY_ADR.md) |
| Customer and commercial actions bind to exact saved revisions and immutable receipts. | Accepted | [`docs/COMMERCIAL_CHANGE_AUTHORITY_ADR.md`](../COMMERCIAL_CHANGE_AUTHORITY_ADR.md) |
| Event work is organized around an exact tenant quote/event context. | Accepted for source implementation | [`docs/EVENT_WORKSPACE_ADR.md`](../EVENT_WORKSPACE_ADR.md) |
| Ambient exact arrival uses a bounded semantic URL/history hybrid plus destination focus proof. | Accepted for source implementation; default off | [`docs/AMBIENT_WORKSPACE_ARRIVAL_ADR.md`](../AMBIENT_WORKSPACE_ARRIVAL_ADR.md) |
| Operational staffing remains independent of pricing, booking, attendance, payroll, and readiness claims. | Source implementation; presentation/runtime gated | [`docs/OPERATIONAL_STAFFING_AUTHORITY_ADR.md`](../OPERATIONAL_STAFFING_AUTHORITY_ADR.md) |
| Stripe Connect uses a separate codebase, data plane, authority projection, and provider-disabled staging gate. | Fixed program decision | [`docs/STRIPE_CONNECT_PROGRAM.md`](../STRIPE_CONNECT_PROGRAM.md) |
| Steward is a private, bounded decision compiler, never pricing or commercial authority. | Accepted for implementation planning | [`docs/STEWARD_ADR.md`](../STEWARD_ADR.md) |
| Source, local tests, CI, deployment, provider results, recipient behavior, human acceptance, use, and commercial proof remain separate claims. | Accepted | [`PROJECT_STATUS.md`](../../PROJECT_STATUS.md), [`docs/project/PROOF.md`](PROOF.md) |

New or reversed architectural decisions belong in a dedicated ADR. This index
should change only when the active decision set changes.
