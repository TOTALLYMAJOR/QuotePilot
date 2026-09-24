# QuotePilot System Architecture

Last updated: 2026-09-24 01:57:41 CDT

Status: present-tense system architecture. Domain ADRs and executable contracts
remain authoritative for their own invariants.

## System context

QuotePilot is a multi-tenant catering commercial-operations application. A React
and Vite browser client presents public, customer, and role-gated staff surfaces.
Firebase owns identity, tenant data, server-authoritative mutations, and the
origin/fallback deployment. Vercel is the public browser edge. Read-only evidence
and reconciliation tiers inspect exported records without gaining write or
business authority.

## Major modules and responsibilities

| Module | Responsibility | Must not own |
|---|---|---|
| Public and staff web client (`src/`) | Interaction, local draft state, role-safe projection, callable invocation, recovery presentation | Server pricing, privileged authorization, provider truth, settlement, or customer consent |
| Firebase Authentication | User identity, provider session, verification, token claims | Organization membership policy by itself |
| Firestore and Storage | Tenant-scoped durable records, versions, receipts, projections, and bounded assets | Client-derived authority or inferred evidence |
| Firebase Security Rules | Direct-client read/write enforcement at the data seam | Callable business logic or provider reconciliation |
| Firebase Functions (`functions/`) | Tenant/role authorization, exact validation, authoritative pricing, state transitions, provider dispatch, receipts, projections | Human acceptance, physical availability, or provider outcomes not read back |
| Domain libraries and contracts | Pricing, commercial revision, Staffing, Inventory, BEO, workflow, field-state, and evidence invariants | A universal readiness authority |
| Evidence exporter (`evidence/`) | Deterministic projection of already-read authoritative records into reconciliation bundles | Credentials, network access, writes, or policy inference |
| Commercial Truth Loop (`truthloop/`) | Deterministic read-only reconciliation and findings | Pricing, approval, mutation, customer presentation, or provider action |
| Product/release governance | Traceability, validation, evidence classification, and release receipts | Product-owner, provider, production, human, or outcome acceptance |

## Primary data flow

```mermaid
flowchart LR
    Customer[Customer contact] --> Public[Public inquiry or portal]
    Staff[Authorized staff] --> Web[React/Vite staff client]
    Public --> Functions[Firebase Functions]
    Web --> Auth[Firebase Auth]
    Auth --> Web
    Web --> Functions
    Functions --> Rules[Validated Firestore/Storage access]
    Rules --> Data[(Tenant records and receipts)]
    Functions --> Providers[Stripe, Resend, Turnstile, OpenAI, optional messaging]
    Providers --> Functions
    Data --> Exporter[Read-only evidence exporter]
    Exporter --> Bundle[Versioned evidence bundle]
    Bundle --> TruthLoop[Read-only Truth Loop]
    TruthLoop --> Reviewer[Operator review]
```

Client observation may describe interaction. It cannot establish pricing,
acceptance, delivery, settlement, or operational authority.

## Core seams

- **Identity seam:** Firebase Auth establishes the user; server and rules still
  validate organization, role, verification, gate, revision, and request context.
- **Commercial seam:** server-owned pricing and version receipts establish the
  saved commercial basis. Client arithmetic is explanatory only.
- **Customer seam:** customer-safe DTOs and current issuance determine what may
  be shown. Internal records are not sent directly to customer surfaces.
- **Provider seam:** dispatch, provider acceptance, delivery, settlement, and
  recipient behavior are separate states reconciled by exact identities.
- **Operational seam:** accepted commercial work is referenced by Staffing,
  Inventory, BEO, workflow, and event-operation modules; no consumer rewrites
  the accepted commercial record.
- **Evidence seam:** exporter and reconciler consume evidence without credentials,
  network access, writes, or authority to fix findings.

## Trust boundaries

1. Browser input is untrusted, including tenant identifiers, roles, totals,
   lifecycle state, provider outcomes, and imported files.
2. Authentication is necessary but insufficient; authorization is evaluated at
   the owning server or rules seam.
3. Every tenant-scoped operation binds the exact organization and eligible role.
4. Consequential mutations bind revision and request identities and fail closed
   on stale, duplicate, incomplete, or ambiguous state.
5. Customer projections exclude staff-only margin, staffing, provider, evidence,
   and internal commentary unless an explicit contract permits them.
6. Secrets remain in provider/runtime secret stores and never enter repository
   docs, browser payloads, analytics, or reconciliation bundles.
7. Generated suggestions, fixtures, simulations, and findings never become
   business authority by presentation alone.

Rule-level predicate claims are intentionally not duplicated here. The current
graph could not establish tracked freshness for `firestore.rules`; that affected
detail remains `GRAPH_COVERAGE_BLOCKED` until a fresh authorized source review
and the Firestore rules lane confirm it.

## Deployment topology

```mermaid
flowchart TB
    Users[Browser users] --> Edge[Vercel public edge]
    Users --> Fallback[Firebase Hosting origin/fallback]
    Edge --> Browser[Versioned browser assets]
    Fallback --> Browser
    Browser --> Auth[Firebase Auth]
    Browser --> Fn[Firebase Functions]
    Fn --> Db[(Firestore and Storage)]
    Fn --> External[External providers]
```

The public edge, Firebase Hosting, Functions, tenant configuration, provider
configuration, and production data are separately deployed and separately
proved. `README.md` owns runtime versions and entry points; `PROJECT_STATUS.md`
owns current deployment evidence.

## External dependencies

- Firebase Authentication, Firestore, Storage, Functions, and Hosting.
- Vercel public delivery.
- Stripe payment rails; Stripe Connect remains separately stopped.
- Resend transactional delivery.
- Turnstile for governed public inquiry protection.
- OpenAI for bounded model-assisted parsing where enabled.
- Optional messaging/calendar seams only where separately configured and gated.

Provider configuration or a successful health probe never proves a user outcome.

## Failure behavior

- Missing local Firebase configuration keeps the documented local fallback
  rather than fabricating connected authority.
- Authorization, tenant, revision, schema, and exact-money failures fail closed.
- Network/provider ambiguity remains unknown until reconciled; retry is not
  offered when it could duplicate a consequential action.
- Missing, not applicable, not yet available, blocked, contradictory, and schema
  drift remain distinct and produce different operator instructions.
- Stale downstream projections identify their exact basis, owner, and recovery
  action rather than mutating the accepted source.
- Analytics failure must not block the commercial workflow, but business
  authority remains closed and observable.
- Exporter or reconciler failure cannot mutate production records or establish a
  customer-facing verdict.

## Architecture change rule

A change to module responsibility, trust boundary, storage location, processing
order, public interface, or external dependency requires impact analysis and an
ADR when the decision is expensive to reverse, surprising without context, and
the result of a real trade-off.
