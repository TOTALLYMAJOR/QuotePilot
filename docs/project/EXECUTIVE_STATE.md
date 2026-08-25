# Executive Project State

Last updated: 2026-08-25 15:46:40 CDT

## What This Is

QuotePilot is a commercial SaaS system for tenant-scoped catering quotes,
customer decisions, payment evidence, and event operations. Its trust model
keeps pricing, tenancy, revisions, provider effects, and readiness on explicit
authorities rather than browser inference.

## North Star

An authorized operator should move one real event from inquiry through an exact
quote, customer decision, payment evidence, and operational handoff without an
authority gap; the business must then demonstrate repeatable activation, use,
retention, revenue, and measurable customer value.

## Current Reality

Exact `v0.15.0` (`bc495c8c948d440b12363d5da34209a11ff151fd`)
passed exact-main CI and reached the Vercel public edge plus Firebase Hosting,
Functions, rules, and indexes. Receipt-only `main` SHA
`d40ec929e5d70142683966e872b6f91b4a508cad` does not change runtime behavior.
Source/test governance is broad; current authenticated production use is not
recorded.

## Capability State

The representative ledger contains 11 cohorts: 7 `DEPLOYED` and 4 `TESTED`.
The highest-value deployed cohorts are authoritative pricing, quote revisions,
proposal/customer decision, both payment rails, Event Workspace/BEO,
operational staffing code, and Ambient presentation. No cohort is `USED` or
`COMMERCIALLY_PROVEN`.

## What Is Not Proven

- Tenant-250 provisioning and protected staffing activation.
- Current authenticated quote-to-operations production acceptance.
- Exact email provider acceptance, delivery/bounce, or recipient behavior.
- Hosted Stripe acceptance for both payment rails.
- Buyer activation, repeated production usage, retention, revenue, or measured
  outcomes.
- Stripe Connect Sandbox onboarding or a Steward provider-backed pilot.

## Primary Journey

Demand intake → authoritative quote → exact saved revision → current proposal
→ customer decision → payment evidence → revision-bound BEO/staffing handoff.
The source and runtime artifact exist, but the exact authenticated end-to-end
production journey remains `UNVERIFIED`.

## Critical Decisions

- Server authority fails closed; browser state never becomes pricing, tenant,
  provider, settlement, or readiness truth.
- Consequential commercial actions bind to exact revisions and immutable
  receipts.
- Staffing stays separate from quoted labor, attendance, payroll, and event
  readiness.
- Stripe Connect remains isolated and provider disabled through its Sandbox
  stopping gate.
- Every evidence class remains independent; missing proof is `UNVERIFIED`.

## Critical Blockers

There is no active P0 safety blocker. P1 blockers are tenant-250 provisioning,
the authenticated production matrix, and exact provider acceptance. P2 blockers
are buyer-access safety, Connect hosted Sandbox evidence, and direct commercial
evidence. See [`docs/project/BLOCKERS.md`](BLOCKERS.md) for resolution
conditions.

## Next Proof Event

After reviewed tenant-250 provisioning and protected staffing activation, one
authorized operator completes the exact `v0.15.0` quote-to-operations journey
with release, settings, role, revision, cross-tenant/portal-denial, and BEO
receipts. Missing provider or recipient evidence remains explicitly absent.

## Next Actions

1. Review and apply the tenant-250 canonical provisioning migration.
2. Run protected staffing activation and retain exact settings readback.
3. Complete the authenticated production role/tenant/quote/portal/BEO matrix.
4. Capture email and payment provider receipts as separate evidence classes.
5. Start a direct buyer/commercial evidence program only after the primary
   production proof event.

## Commercial / Operational Evidence

Operational evidence includes exact CI, dual-target deployment, governed edge/
origin readbacks, local/emulator suites, and the failed-closed activation
attempt. Target buyer and offer are documented hypotheses. Prospects, design
partners, paid customers, activation, usage, retention, revenue, and measured
outcomes remain `UNVERIFIED`.

## Confidence

`HIGH` for repository/source/CI/deployment reconciliation because exact paths,
SHAs, run IDs, and automated gates exist. `LOW` for adoption and commercial
state because no direct user, customer, usage, retention, or revenue evidence
is present. Overall canonical-state confidence is `MEDIUM`.
