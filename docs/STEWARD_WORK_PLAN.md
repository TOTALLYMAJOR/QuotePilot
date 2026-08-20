# Work Plan: QuotePilot Steward

Last updated: 2026-08-20 14:47:39 CDT

Status: Proposed; execution requires PRD/ADR/threat-context approval
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

Deliver a paid, useful second hand for menu setup, quote preparation, difficult
questions, and strategy without creating a second pricing, catalog, quote,
messaging, payment, or customer authority.

## Planned test skeletons

- `src/lib/__tests__/stewardContracts.server.test.js`
- `src/lib/__tests__/stewardPolicy.server.test.js`
- `src/lib/__tests__/stewardContext.server.test.js`
- `src/lib/__tests__/stewardDecisionPacket.server.test.js`
- `src/lib/__tests__/stewardUsage.server.test.js`
- `src/lib/__tests__/stewardEntitlement.server.test.js`
- `src/lib/__tests__/stewardClient.test.js`
- `src/components/__tests__/stewardWorkspace.test.jsx`
- `src/components/__tests__/stewardDecisionPacket.test.jsx`
- `src/components/__tests__/stewardSetupStudio.test.jsx`
- `src/rules/__tests__/firestore.rules.test.js`
- `e2e/steward-governance.smoke.spec.js`

## Phase 0: Agreement and security foundation

- [ ] Confirm the three threat-model context questions.
- [ ] Accept or revise PRD and ADR.
- [ ] Define sensitive-claim, prohibited-tactic, role, retention, and provider
  policies as versioned contracts.
- [ ] Build packet/source canonicalization and validators with no provider.
- [ ] Build the adversarial eval corpus and redacted fixture policy.
- [ ] Add private record rules and browser-denial tests before exports exist.
- [ ] Define incident, provider kill, organization kill, model rollback, and
  content deletion runbooks.
- [ ] Run the quick/core, auth-rules, pricing, capability, and security checks
  appropriate to the touched foundation.

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

## Phase 2: Quote Partner and Decision Packet

- [ ] Add `prepare_quote` candidates restricted to approved catalog IDs and
  bounded quantities.
- [ ] Integrate existing authoritative pricing and exact source revisions.
- [ ] Integrate Commercial Change simulation for committed quotes without
  authorization or apply.
- [ ] Render complete Fact and Consequence Ledgers.
- [ ] Enable exact-current-revision local staging behind an independent tenant
  gate after shadow acceptance.
- [ ] Add stage diff, discard, correction, expiry, and stale regeneration.

Completion gate: 100% of displayed commercial numerics originate from trusted
adapters; packet staging performs no persistence and fails on any drift.

## Phase 3: Setup Studio

- [ ] Accept text and CSV only with bounded parsing and formula neutralization.
- [ ] Propose menu normalization and duplicate candidates.
- [ ] Block unknown pricing, unit, tax, allergen, and dietary authority.
- [ ] Convert reviewed candidates into the existing catalog import preview.
- [ ] Preserve existing admin, conflict, receipt, confirmation, and rollback
  behavior.

Completion gate: Steward cannot directly create, overwrite, confirm, or roll
back catalog records; every import remains attributable to the existing admin
path.

## Phase 4: Strategy Table

- [ ] Add discovery, option framing, objection planning, and negotiation
  boundary output with no executable proposed changes.
- [ ] Add explicit transition to a new Quote Partner packet when an operator
  wants to price a strategy.
- [ ] Test discrimination, deception, fabricated scarcity, and unsupported
  competitor claims.

Completion gate: Strategy output remains advisory and cannot inherit stale
context or bypass a new quote packet's verification.

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

## Stop conditions

Stop the program before the next phase if a current phase cannot preserve the
security invariants in `docs/STEWARD_THREAT_MODEL.md`. Do not compensate for a
failed validator, role check, stale fence, provider control, or billing receipt
by adding warning copy or a broad exception.
