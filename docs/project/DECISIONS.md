# Material Decision Ledger

Last updated: 2026-08-25 15:46:40 CDT

The linked ADR or policy remains authoritative. This ledger makes current
decision status and revisit conditions discoverable without copying full ADRs.

## QP-DEC-001 — Server authority fails closed

- Decision ID: `QP-DEC-001`
- Date: `UNVERIFIED` (policy predates the reconciled Git decision records)
- Context: Browser state cannot prove pricing, tenancy, identity, provider
  effects, settlement, or operational readiness.
- Decision: Keep consequential authority on trusted server paths and fail closed
  when required evidence is absent.
- Alternatives Considered: Browser-derived authority; optimistic local fallback
  as production truth. Both are rejected.
- Why Chosen: Tenant isolation and external evidence cannot be established by
  untrusted client state.
- Authority: QuotePilot maintainers.
- Affected Components: Firebase Functions, Firestore rules, quote/payment/
  delivery projections, and role-gated UI.
- Evidence: [`docs/DOC_SYSTEM.md`](../DOC_SYSTEM.md),
  [`docs/COMMERCIAL_CHANGE_AUTHORITY_ADR.md`](../COMMERCIAL_CHANGE_AUTHORITY_ADR.md).
- Reversible: No, not without replacing the core trust model.
- Supersedes: None recorded.
- Status: `ACCEPTED`.
- Revisit Trigger: A reviewed authority architecture provides equivalent tenant,
  revision, replay, and external-evidence guarantees.

## QP-DEC-002 — Exact-revision commercial changes

- Decision ID: `QP-DEC-002`
- Date: 2026-08-09
- Context: A quote edit can invalidate proposals, payments, bookings, BEOs, and
  other downstream evidence.
- Decision: Use server-authoritative simulation, authorization, atomic apply,
  named invalidation, and immutable reconciliation receipts bound to the exact
  revision.
- Alternatives Considered: Ordinary save with implicit freshness; browser-owned
  impact calculation; selected receipt protocol.
- Why Chosen: It preserves one pricing/write authority and prevents silent
  downstream validity claims.
- Authority: QuotePilot maintainers.
- Affected Components: Quote update, dependency graph, BEO authority, Decision
  Debt, Firestore rules, and staff change-impact surfaces.
- Evidence: [`docs/COMMERCIAL_CHANGE_AUTHORITY_ADR.md`](../COMMERCIAL_CHANGE_AUTHORITY_ADR.md).
- Reversible: Yes; enforcement gates can return to dormant without rewriting
  immutable evidence.
- Supersedes: Ordinary save semantics for governed consequential edits only.
- Status: `ACCEPTED`; runtime enforcement remains gated.
- Revisit Trigger: Partial writes, cross-tenant scope, terminal-evidence rewrite,
  or invalidation resolution without exact trusted evidence.

## QP-DEC-003 — Event Workspace is a presentation composition

- Decision ID: `QP-DEC-003`
- Date: 2026-08-09
- Context: The exact quote detail route needed event-first hierarchy without a
  second mutable event aggregate.
- Decision: Compose `EventWorkspaceView` over existing bounded quote, workflow,
  proposal-readiness, and authority contracts.
- Alternatives Considered: New Event collection/read model; restyled full
  table; manufactured event-wide scores.
- Why Chosen: It preserves existing reads and mutation gates while improving
  event context and mobile scanability.
- Authority: QuotePilot maintainers.
- Affected Components: Quote detail routing, `QuoteHistoryView`,
  `EventWorkspaceView`, Workflow, Customer 360, and BEO presentation.
- Evidence: [`docs/EVENT_WORKSPACE_ADR.md`](../EVENT_WORKSPACE_ADR.md).
- Reversible: Yes; the route can fall back to the existing Quotes surface.
- Supersedes: The full routed Quotes table as the primary exact-detail
  presentation, not as the administrative surface.
- Status: `ACCEPTED` for source implementation and deployed presentation.
- Revisit Trigger: A justified server-owned event detail contract replaces the
  bounded history-resolution seam.

## QP-DEC-004 — Bounded semantic Ambient arrival

- Decision ID: `QP-DEC-004`
- Date: 2026-08-12
- Context: Generic navigation recreated dead clicks and could falsely imply that
  a requested item was ready.
- Decision: Use `workspace-arrival-contract-v1`: opaque route focus plus bounded
  same-app history state, canonical semantics, and destination focus proof.
- Alternatives Considered: Generic route/caller prose; full URL contract;
  history-only contract; selected bounded hybrid.
- Why Chosen: It prevents context leakage and reserves “ready” for exact
  destination consumption evidence.
- Authority: QuotePilot maintainers.
- Affected Components: Ambient actions, workspace routes, history state,
  destination consumers, focus notices, and recovery behavior.
- Evidence: [`docs/AMBIENT_WORKSPACE_ARRIVAL_ADR.md`](../AMBIENT_WORKSPACE_ARRIVAL_ADR.md).
- Reversible: Yes; disable Ambient primary arrivals and retain canonical routes.
- Supersedes: Generic Ambient destination navigation.
- Status: `ACCEPTED`; exact `v0.15.0` deploys the presentation.
- Revisit Trigger: Prohibited-content leakage, altered canonical state,
  substitution, or a “ready” result without exact focus proof.

## QP-DEC-005 — Staffing is an independent authority

- Decision ID: `QP-DEC-005`
- Date: 2026-08-12
- Context: Quoted labor, booking labels, BEO content, attendance, and payroll do
  not establish a revision-fenced operational roster.
- Decision: Keep tenant-isolated staffing profiles, availability, assignments,
  invitations, and acknowledgements independent from pricing and readiness.
- Alternatives Considered: Reuse quote role counts, legacy booking assignments,
  or BEO fields as staffing authority; all are rejected.
- Why Chosen: The separate authority can record exact operator actions and
  conflicts without inventing acknowledgement, attendance, payroll, or event
  readiness.
- Authority: QuotePilot maintainers.
- Affected Components: Staffing Functions, Staff workspace, private directory,
  invitations, rules, and tenant/global/presentation gates.
- Evidence: [`docs/OPERATIONAL_STAFFING_AUTHORITY_ADR.md`](../OPERATIONAL_STAFFING_AUTHORITY_ADR.md).
- Reversible: Yes; disable independent gates while preserving immutable records.
- Supersedes: Legacy staffing-like fields as operational authority.
- Status: `ACCEPTED`; code is deployed but tenant-250 activation is unverified.
- Revisit Trigger: A replacement preserves exact revision, availability,
  conflict, role, acknowledgement, and evidence separation.

## QP-DEC-006 — Stripe Connect remains isolated

- Decision ID: `QP-DEC-006`
- Date: 2026-08-13
- Context: Connect merchant authority and newer Stripe contracts must not alter
  existing deposit, final-balance, or buyer-access rails.
- Decision: Use a separate codebase, data plane, identities, staging foundation,
  and provider-disabled Sandbox stopping gate.
- Alternatives Considered: Extend the default Functions/payment codebase;
  directly bind production Connect; selected isolated program.
- Why Chosen: It creates independent rollback and evidence boundaries and
  protects existing payment authorities.
- Authority: QuotePilot owner and maintainers.
- Affected Components: `functions-connect/`, `connect-control`, staging
  infrastructure, IAM/egress, provider adapters, and release workflows.
- Evidence: [`docs/STRIPE_CONNECT_PROGRAM.md`](../STRIPE_CONNECT_PROGRAM.md).
- Reversible: Yes; the current program is unexported, unbound, and provider
  disabled.
- Supersedes: None; existing payment rails remain authoritative.
- Status: `FIXED_PROGRAM_DECISION` with hosted Sandbox gate open.
- Revisit Trigger: Completion of the approved Sandbox evidence package or a
  security/authority contradiction.

## QP-DEC-007 — Steward is a bounded decision compiler

- Decision ID: `QP-DEC-007`
- Date: 2026-08-20
- Context: An AI assistant could otherwise create a parallel pricing,
  configuration, provider, or customer-contact authority.
- Decision: Treat the model as an untrusted proposal generator inside a fixed,
  tool-free server workflow that emits expiring packets for human review.
- Alternatives Considered: Generic chatbot; autonomous tool-using agent;
  deterministic rules only; selected bounded compiler.
- Why Chosen: It combines useful drafting with deterministic authority,
  minimized context, and explicit human staging.
- Authority: QuotePilot owner.
- Affected Components: Steward policy/compiler/evaluation modules, private
  records, pricing/consequence adapters, and unavailable-state workspace UI.
- Evidence: [`docs/STEWARD_ADR.md`](../STEWARD_ADR.md).
- Reversible: Yes; keep provider/runtime/tenant gates off and retain ordinary
  manual workflows.
- Supersedes: Any proposal for an autonomous QuotePilot agent with direct tools.
- Status: `ACCEPTED` for implementation planning; compiler runtime is absent.
- Revisit Trigger: Any cross-tenant packet, model-owned commercial number,
  direct side effect, stale staging, or unsafe content/logging.

## QP-DEC-008 — Evidence classes never substitute

- Decision ID: `QP-DEC-008`
- Date: 2026-08-24
- Context: Source breadth and tests were repeatedly easy to misread as
  deployment, provider success, customer use, or commercial validation.
- Decision: Keep source, test, CI, deployment, provider, recipient, human,
  usage, and commercial evidence as independent claims; missing proof is
  `UNVERIFIED`.
- Alternatives Considered: One completion percentage; optimistic promotion from
  lower evidence; selected typed evidence boundaries.
- Why Chosen: It makes current truth auditable and prevents internal intent from
  becoming external fact.
- Authority: Repository documentation governance.
- Affected Components: Project state, release status, proof register, agent
  completion reports, deployment records, and commercial claims.
- Evidence: [`PROJECT_STATUS.md`](../../PROJECT_STATUS.md),
  [`docs/project/PROOF.md`](PROOF.md), [`.project/state.json`](../../.project/state.json).
- Reversible: No, not without weakening the repository truth model.
- Supersedes: Unqualified “done” reporting.
- Status: `ACCEPTED`.
- Revisit Trigger: A stricter evidence ontology is adopted without collapsing
  any existing boundary.

New or reversed architectural decisions require a dedicated ADR. If current
implementation contradicts a decision, record the contradiction and leave both
sides open until the relevant authority resolves it.
