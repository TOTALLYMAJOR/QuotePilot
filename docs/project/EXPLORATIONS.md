# Active Exploration Register

Last updated: 2026-08-25 15:46:40 CDT

Explorations are bounded learning programs, not requirements or shipped-
capability claims. Allowed states are `OPEN`, `INVESTIGATING`, `DECIDED`,
`PARKED`, `REJECTED`, and `SUPERSEDED`.

## Ambient compatibility retirement

- Exploration: Remove replaced compatibility workspace surfaces.
- Question: Does exact `v0.15.0` Ambient behavior have sufficient hosted role,
  mobile, recovery, and rollback parity to authorize deletion?
- Why It Matters: Carrying two graphs increases bundle and maintenance cost;
  premature deletion removes the accepted rollback.
- Hypothesis: The Ambient graph can replace compatibility after explicit hosted
  parity and rollback acceptance.
- Evidence Gathered: Large local/browser cohorts, bundle gates, exact v0.15.0
  deployment, and governed reachability receipts.
- Alternatives: Retain both graphs; delete only proven-dead modules; complete
  wholesale retirement.
- Current Conclusion: Deployment is not human parity or retirement authority.
- Decision Required: Accept a named hosted parity matrix and rollback artifact.
- Status: `INVESTIGATING`.

## Stripe Connect runtime

- Exploration: Bind the isolated Connect control plane in staging.
- Question: Can the unexported foundation safely reach authenticated Stripe
  Sandbox UAT without touching existing payment rails?
- Why It Matters: Connect could enable merchant-owned routing, but expands
  provider, IAM, network, and recovery risk.
- Hypothesis: The isolated codebase/data-plane design contains that risk.
- Evidence Gathered: Source/tests, provider-disabled manifests, staging plan,
  and fixed Sandbox stopping contract.
- Alternatives: Keep Connect parked; extend the default payment codebase;
  proceed through the isolated staging sequence.
- Current Conclusion: No provider or hosted claim exists until an approved plan
  is applied and reconciled.
- Decision Required: Separately authorize the exact staging apply and UAT.
- Status: `PARKED`.

## Steward silent pilot

- Exploration: Evaluate Steward drafts without granting operational authority.
- Question: Does the bounded compiler improve difficult-question responses under
  consent and private human comparison?
- Why It Matters: Source safety does not establish decision quality or operator
  value.
- Hypothesis: Fixed tasks plus deterministic validation can improve drafts
  without creating a parallel authority.
- Evidence Gathered: Policy/compiler contracts, fixed synthetic corpus, source
  tests, private-rules checks, and unavailable-state UI.
- Alternatives: Rules-only assistance; bounded silent pilot; generic chatbot or
  autonomous tools (rejected by ADR).
- Current Conclusion: Provider transport, private runtime, consent, and human
  comparison remain absent.
- Decision Required: Approve those four boundaries before runtime binding.
- Status: `PARKED`.

## Buyer acquisition and activation

- Exploration: Open the gated buyer-access journey to a bounded hosted test.
- Question: Can a real buyer safely activate without exposing live payment or
  tenant authority?
- Why It Matters: A commercial product needs repeatable activation, not only a
  staff-operated deployment.
- Hypothesis: Restricted test credentials, signed webhooks, Turnstile, and exact
  email activation can create a safe acceptance window.
- Evidence Gathered: Source/emulator contracts and a staged acceptance plan.
- Alternatives: Keep operator-provisioned onboarding; run bounded test-mode
  activation; open public live-mode access (rejected).
- Current Conclusion: Current credentials and provider checks do not satisfy the
  bounded window.
- Decision Required: Approve restricted credentials and hosted acceptance after
  all safety checks pass.
- Status: `INVESTIGATING`.

## Commercial value proof

- Exploration: Validate buyer, usage, retention, revenue, and measured outcome.
- Question: Does QuotePilot create enough repeatable economic value for a buyer
  to activate, pay, retain, and recommend it?
- Why It Matters: Working and deployed software is not commercially proven.
- Hypothesis: The governed quote-to-operations journey improves conversion,
  speed, margin visibility, or operational quality.
- Evidence Gathered: Product workflow, likely buyer, source/test evidence, and
  production deployment; no direct commercial receipts.
- Alternatives: Buyer interviews/design partners; bounded paid pilots;
  instrumented cohort evidence; remain hypothesis-only.
- Current Conclusion: Every customer, revenue, retention, and outcome claim is
  `UNVERIFIED`.
- Decision Required: Select the first authorized direct commercial evidence
  program after the primary production proof event.
- Status: `OPEN`.

An exploration graduates only when the decision authority and its evidence are
recorded in the Feature Matrix, Project Status, decision ledger, and proof
register as applicable.
