# Work Plan: QuotePilot Steward

Last updated: 2026-08-21 00:06:22 CDT

Status: Phase 0 source controls implemented; remaining validation and runtime work stays separately scoped
Created: August 15, 2026
Type: High-risk full-stack feature
Approach: Security foundation followed by vertical slices

## Related documents

- `docs/STEWARD_COMPETITIVE_RESEARCH.md`
- `docs/STEWARD_PRD.md`
- `docs/STEWARD_ADR.md`
- `docs/STEWARD_UI_SPEC.md`
- `docs/STEWARD_DESIGN.md`
- `docs/STEWARD_THREAT_MODEL.md`

## Objective

Deliver a paid, useful second hand for menu/workflow setup, provider readiness,
quote preparation, margin protection, client advice, difficult questions, and
strategy without creating a second pricing, catalog, configuration, quote,
messaging, payment, provider, or customer authority.

## Planned test skeletons

- `src/lib/__tests__/stewardContracts.server.test.js`
- `src/lib/__tests__/stewardPolicy.server.test.js`
- `src/lib/__tests__/stewardContext.server.test.js`
- `src/lib/__tests__/stewardDecisionPacket.server.test.js`
- `src/lib/__tests__/stewardUsage.server.test.js`
- `src/lib/__tests__/stewardEntitlement.server.test.js`
- `src/lib/__tests__/stewardConfiguration.server.test.js`
- `src/lib/__tests__/stewardMargin.server.test.js`
- `src/lib/__tests__/stewardClientMemory.server.test.js`
- `src/lib/__tests__/stewardClient.test.js`
- `src/components/__tests__/stewardWorkspace.test.jsx`
- `src/components/__tests__/stewardDecisionPacket.test.jsx`
- `src/components/__tests__/stewardSetupStudio.test.jsx`
- `src/components/__tests__/stewardConfigurationReadiness.test.jsx`
- `src/components/__tests__/stewardClientAdvisor.test.jsx`
- `src/components/__tests__/stewardMarginAdvisor.test.jsx`
- `src/rules/__tests__/firestore.rules.test.js`
- `e2e/steward-governance.smoke.spec.js`

## Phase 0: Agreement and security foundation

- [x] Confirm the three threat-model context questions.
- [x] Accept the PRD, ADR, UI specification, technical design, threat model,
  and work plan for implementation planning.
- [x] Finish the versioned policy set: sensitive-claim, prohibited-tactic,
  prompt-attack, role, US-pilot, no-secret, provider-action, retention,
  redaction, deletion, and kill/rollback policy.
- [x] Build packet/source canonicalization and validators with no provider.
- [x] Build the synthetic adversarial eval corpus and redacted fixture policy.
- [x] Add private record rules and browser-denial tests before exports exist.
- [x] Define incident, provider kill, organization kill, model rollback, and
  content deletion runbooks.
- [ ] Close the two branch-wide validation blockers. Focused Steward tests,
  Firestore rules, environment, build, capability, documentation, and secret
  checks pass. The full unit gate still has the pre-existing
  `quoteStore.versioning` pricing-authority assertion, while the auth/rules and
  authoritative-pricing orchestration lanes stop before browser proof because
  Node cannot resolve the extensionless `src/lib/brandLogoUrl` import from
  `src/data/mockCatalog.js`.

Completion gate: Pure code rejects foreign sources, unsupported tasks,
forbidden claims, malformed output, stale revisions, unsafe rendering values,
and packet tampering with 100% expected negative-test coverage.

## Phase 1: Difficult Question Desk shadow mode

- [ ] Implement fixed `draft_response` context and provider adapter with no
  tools, no writes, no packet reload, and no customer send.
- [ ] Implement strict schema, claim inventory, policy/source validation, and
  provider failure behavior.
- [ ] Add read-only workbench states and ordinary-composer handoff disabled.
- [ ] Run packets silently for consenting internal/pilot users; compare with
  human responses without showing model output in production work.
- [ ] Review at least 100 representative and adversarial packets.

Completion gate: No unauthorized source or sensitive unsupported claim passes;
manual communication remains fully available during provider outage.

## Phase 2: Quote Partner, Margin Advisor, and Decision Packet

- [ ] Add `prepare_quote` candidates restricted to approved catalog IDs and
  bounded quantities.
- [ ] Integrate existing authoritative pricing and exact source revisions.
- [ ] Integrate Commercial Change simulation for committed quotes without
  authorization or apply.
- [ ] Render complete Fact and Consequence Ledgers.
- [ ] Enable exact-current-revision local staging behind an independent tenant
  gate after shadow acceptance.
- [ ] Add stage diff, discard, correction, expiry, and stale regeneration.
- [ ] Reuse the deterministic recorded-cost margin presentation and bounded
  Pilot scenario contracts; do not introduce model calculations or estimates.
- [ ] Add read-only exact-quote and bounded portfolio margin attention with
  complete, below-target, missing-coverage, stale, and unavailable states.

Completion gate: 100% of displayed commercial numerics originate from trusted
adapters; missing cost coverage produces no estimate; packet staging performs
no persistence and fails on any drift.

## Phase 3: Setup and Configuration Studio

- [ ] Accept text and CSV only with bounded parsing and formula neutralization.
- [ ] Propose menu normalization and duplicate candidates.
- [ ] Block unknown pricing, unit, tax, allergen, and dietary authority.
- [ ] Convert reviewed candidates into the existing catalog import preview.
- [ ] Preserve existing admin, conflict, receipt, confirmation, and rollback
  behavior.
- [ ] Add `configure_workflow` against allowlisted current Revenue Autopilot,
  Workflow, and other reviewed policy projections; prepare a typed diff only.
- [ ] Add `guide_provider_setup` against bounded non-secret Integration Ops and
  Stripe Connect readiness; reject secret-shaped input before provider use.
- [ ] Route each proposed configuration to one existing role-safe editor or
  provider-hosted surface with current state, missing evidence, consequence,
  do-nothing outcome, required role, and no completion claim.

Completion gate: Steward cannot directly create, overwrite, confirm, or roll
back catalog records, change a workflow/gate, receive a credential, create a
provider object, or alter routing; every mutation remains attributable to its
existing authority and receipt path.

## Phase 4: Client Advisor, governed memory, and Strategy Table

- [ ] Build one exact-client context from same-tenant canonical records,
  accepted/booked history, separately evidenced interaction states, explicit
  preferences, and operator-reviewed memory facts.
- [ ] Add memory source, freshness, review, dispute, correction, expiry,
  deletion, and tenant-cleanup contracts before any provider-backed client
  advice.
- [ ] Reject sensitive/protected traits, raw relationship history, sentiment,
  personality, vulnerability, wealth, willingness-to-pay, approximate client
  identity, and cross-tenant patterns.
- [ ] Keep client advice inside an expiring packet with no contact, pricing,
  send, or implicit memory write.
- [ ] Add discovery, option framing, objection planning, and negotiation
  boundary output with no executable proposed changes.
- [ ] Add explicit transition to a new Quote Partner packet when an operator
  wants to price a strategy.
- [ ] Test discrimination, deception, fabricated scarcity, and unsupported
  competitor claims.

Completion gate: Every client-memory fact is exact-client, source-labeled,
fresh, reviewable, and deletable; sensitive/protected and disputed facts are
absent; strategy output remains advisory and cannot inherit stale context or
bypass a new quote packet's verification.

## Phase 5: Paid entitlement and controls

- [ ] Create a distinct Stripe Product/Price in test mode and dedicated
  restricted key/webhook secret.
- [ ] Implement subscription Checkout, Customer Portal, signed webhook state
  machine, reconciliation, dedupe, order handling, and organization binding.
- [ ] Implement allowance reservation/completion/release, concurrency, hard
  caps, and admin usage projection.
- [ ] Implement policy configuration, recent admin authority, audit projection,
  retention deletion, and global/provider/tenant/task/model kill switches.
- [ ] Prove no overlap with deposit, final balance, buyer access, or Connect.

Completion gate: Browser return cannot grant access; all entitlement states are
backed by signed evidence or trusted reconciliation; no surprise overage.

## Phase 6: Limited pilot

- [ ] Run source/local validation and record it separately from provider and
  hosted evidence.
- [ ] Verify provider project, exact pinned model, data controls, terms,
  retention, deletion, region, spend caps, and secret isolation.
- [ ] Verify Stripe test-mode provider behavior and hosted return/reconciliation
  paths.
- [ ] Run authenticated hosted same-tenant and cross-tenant matrices.
- [ ] Pilot with three consenting organizations and at least 200 reviewed
  packets.
- [ ] Review corrections, unsafe blocks, cost, latency, operator trust, quote
  speed, and downstream rework.
- [ ] Obtain explicit owner approval before any broader tenant promotion.

Completion gate: PRD metrics and design promotion thresholds pass with zero
critical/high unresolved findings and a tested rollback/kill receipt.

## Final phase: Quality assurance and documentation

- [ ] Verify every PRD acceptance criterion.
- [ ] Re-run the complete threat model against as-built source and hosted
  boundaries.
- [ ] Run environment, build, unit, E2E, capability-surface, Firebase
  auth/rules, authoritative-pricing, governance, accessibility, and release
  lanes.
- [ ] Update `CHANGELOG.md`, `PROJECT_STATUS.md`, `docs/FEATURE_MATRIX.md`,
  `docs/USER_MANUAL.md`, `docs/capability-surfacing-contracts.json`, README
  entry points, and launch/incident runbooks as triggered.
- [ ] Keep source/local, CI, hosted, provider, production-data, billing, and
  human-acceptance evidence separate.
- [ ] Record residual risk, exact enabled gates/tenants, rollback, and kill
  ownership.

## Failure-mode coverage

| Category | Applies | Covering phase |
|---|---:|---|
| Same-value/no-op | Yes | 2, 3 |
| Empty or incomplete input | Yes | 0, 1, 2, 3, 4 |
| Invalid task/option | Yes | 0 |
| Missing provider/config | Yes | 1, 5, 6 |
| Unavailable provider boundary | Yes | 1, 2, 6 |
| Shared-state/revision drift | Yes | 2 |
| Rollback-only visibility | Yes | 3, 5, 6 |
| Missing ordering/event replay | Yes | 5 |
| Duplicate/ambiguous request | Yes | 0, 1, 2, 5 |
| Cross-tenant resource | Yes | Every backend phase |
| Secret-shaped provider input | Yes | 0, 3, 6 |
| Stale/disputed client memory | Yes | 0, 4, 6 |
| Incomplete margin evidence | Yes | 0, 2, 6 |
| Background model invocation | Yes | 0, 2, 3, 4, 6 |

## Stop conditions

Stop the program before the next phase if a current phase cannot preserve the
security invariants in `docs/STEWARD_THREAT_MODEL.md`. Do not compensate for a
failed validator, role check, stale fence, provider control, or billing receipt
by adding warning copy or a broad exception.
