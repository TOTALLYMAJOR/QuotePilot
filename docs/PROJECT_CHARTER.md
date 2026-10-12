# QuotePilot Project Charter

Last updated: 2026-09-24 01:57:41 CDT

Status: canonical working charter. Product targets remain proposed until the
owner records acceptance in the Product Intelligence release/experiment ledger.

## Why QuotePilot exists

Catering operators do not merely need to produce a quote. They need to turn
changing customer intent into sold, paid, deliverable work without losing
margin, overwriting a prior promise, hiding an operational constraint, or
reconstructing the engagement across email, spreadsheets, provider portals,
documents, and memory.

QuotePilot exists to make that commercial chain explainable and controllable
while preserving the distinct authorities for what was requested, proposed,
accepted, planned, executed, paid, and learned.

## Problem

The same event changes across sales, pricing, customer decisions, staffing,
production, Inventory, payments, and closeout. When those systems and people do
not share revision, evidence, ownership, and recovery context, teams repeat
entry, work from stale plans, make unsafe retries, discover cost or delivery
problems late, and cannot explain the final commercial result.

## Target users

The primary user is the catering owner-operator accountable for sales, margin,
delivery quality, cash collection, and customer relationships.

The product must also support distinct, role-safe work for sales and catalog
administrators, operations managers, kitchen or production leads, staffing
administrators and event leads, finance reviewers, and customer event contacts.
Their views may compose shared evidence, but their authority is not interchangeable.

## Desired outcomes

QuotePilot should enable the six governed outcomes in
[`product-intelligence/PRODUCT_OUTCOME_CONTRACT.md`](product-intelligence/PRODUCT_OUTCOME_CONTRACT.md):

- decision-ready inquiry;
- explainable commercial commitment;
- commitment-to-execution continuity;
- controlled execution and recovery;
- defensible financial closeout; and
- reusable relationship learning.

Success requires value, authority, quality, and learning together. Usage alone
is not product success.

## In scope

- Governed inquiry and staff intake.
- Catalog, offer, package, recipe, recorded-cost, and pricing preparation.
- Server-authoritative quote composition, revision, and proposal decisions.
- Customer-current proposal, conversation, acceptance, rejection, and expiry.
- Controlled post-acceptance change.
- Bounded handoffs to calendar, workflow, Staffing, production, Inventory, BEO,
  event execution, and closeout authorities.
- Deposit and final-balance evidence, reconciliation, and safe ambiguity.
- Read-only commercial reconciliation and evidence-honest reporting.
- Tenant, role, privacy, accessibility, audit, recovery, and release controls.

## Out of scope

- Automatic creation of price, availability, staffing, purchasing, production,
  attendance, settlement, or acceptance truth from suggestions or history.
- A universal event-readiness score that replaces domain authorities.
- Payroll, general accounting, supplier fulfillment, or physical Inventory truth
  without a separately accepted authority contract.
- Stripe Connect production promotion before its documented stopping gate.
- Autonomous model mutation, approval, assignment, provider send, or customer
  commitment.
- Treating synthetic fixtures, local checks, deployment, or provider
  configuration as customer adoption or commercial outcomes.

## Constraints

- Exact money, historical commercial revisions, tenant isolation, and role
  authorization fail closed.
- Missing, not applicable, not yet available, blocked, contradictory, and schema
  drift are distinct states.
- Customer surfaces cannot expose private margin, staffing, provider, or internal
  evidence without an explicit current contract.
- The evidence exporter and Truth Loop remain read-only, credential-free, and
  without network or policy authority.
- Vercel public delivery, Firebase backend/origin state, provider behavior,
  production data, human acceptance, and outcomes retain separate receipts.
- Safe local fallback must remain available when Firebase configuration is absent.

## Success policy

The metric definitions are canonical in
[`product-intelligence/SUCCESS_METRICS.md`](product-intelligence/SUCCESS_METRICS.md).
Baselines and thresholds live in
[`product-intelligence/BASELINES_AND_TARGETS.md`](product-intelligence/BASELINES_AND_TARGETS.md).

The proposed leading targets include faster authoritative quote creation, fewer
dead actions, faster supported recovery, complete cost evidence, timely
reconciliation, current operational handoff, safe rebooking, and operator
preference. Zero confirmed critical integrity breaches is a stop guardrail.

No target is an achieved result. The current baseline register is open and the
owner acceptance record is pending.

## Completion boundary

The core product release is `QPI-01` through `QPI-05`. Those packets cover a
trusted operator release, first trustworthy quote, customer decision, ordinary
payment and closeout, and controlled accepted change into current operations.

`QPI-06`–`QPI-07` are the operational learning expansion, `QPI-08` is commercial
proof, and `QPI-09` is optional bounded operator assistance. Their absence does
not redefine the core product release as unfinished; their own claims remain
open until their evidence exists.

## Decision rights

- Product owner: accepts charter changes, target policy, release boundary, and
  human/outcome claims.
- Domain authorities: own pricing, commercial revision, Staffing, Inventory,
  BEO, payment, provider, and evidence semantics.
- Repository governance: enforces structural traceability and validation but
  cannot grant product, provider, production, or human acceptance.
- Operators and customers: supply the human and outcome evidence that automation
  cannot establish.
