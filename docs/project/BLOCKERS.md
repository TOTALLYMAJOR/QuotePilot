# Critical Blocker Index

Last updated: 2026-08-25 02:06:28 CDT

[`DEV_TASKS.md`](../../DEV_TASKS.md) remains the canonical prioritized backlog,
and [`PROJECT_STATUS.md`](../../PROJECT_STATUS.md) remains operational truth.
This page indexes only blockers that prevent the reconciled proof or lifecycle
claims; it is not a second backlog.

| Priority | Blocker | Unlocks |
|---|---|---|
| P0 | Establish tenant `250` through the reviewed migration/provisioning path, then rerun the protected staffing activation workflow. | Verified tenant settings and authorized staffing availability; the prior activation attempt made no mutation. |
| P0 | Complete the authenticated production role, tenant, portal, quote, and BEO acceptance matrix. | Current production verification of the primary journey. |
| P0 | Capture exact Resend acceptance/delivery/recipient evidence and coordinated Stripe hosted payment evidence separately. | Provider-level proposal and payment claims. |
| P0 | Replace buyer access credentials with a dedicated restricted test key and pass webhook and Turnstile checks. | A bounded buyer activation acceptance window. |
| P1 | Apply and reconcile an explicitly approved isolated Connect staging plan before runtime/provider binding. | Hosted Stripe Connect Sandbox exploration. |
| P1 | Approve Steward transport, consent, private persistence, and human-comparison protocol. | A silent, non-authoritative Steward pilot. |
| P2 | Capture direct buyer, paid-customer, repeated usage, revenue, retention, and outcome evidence. | `USED` or `COMMERCIALLY_PROVEN` claims. |

Provider mutation, production deployment, tenant mutation, and customer
outreach remain separately authorized actions; this index grants none of them.
