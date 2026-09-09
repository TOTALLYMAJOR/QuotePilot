# Documentation System

Last updated: 2026-09-09 06:49:55 CDT

## Purpose
This repository uses a layered canonical documentation model.
Each major topic has one source of truth. Other docs should link to that source instead of duplicating content.

## Canonical Documents
- `README.md`: product overview, architecture snapshot, setup, testing commands, and deployment entry points.
- `PROJECT_STATUS.md`: current operational state only (health, active risks, next actions).
- `DEV_TASKS.md`: prioritized backlog only (open work, grouped by priority).
- `CHANGELOG.md`: historical record of shipped/merged changes.
- `PROJECT_STATE.md`: human-readable reconciliation entry point and the single
  next proof event; it links to, rather than replaces, the authorities above.
- `.project/state.json`: machine-readable lifecycle, evidence, dependency,
  blocker, and proof-event ledger for representative cross-functional cohorts.
- `docs/COMMERCIAL_PLATFORM_PROGRAM.md`: commercial-kernel, vertical-pack,
  tenant-configuration, contextual-UX, migration, and delivery-slice authority.
- `docs/PRICING_CONSTITUTION.md`: pricing policy, version, exact-money,
  waterfall, historical-compatibility, and payment-provenance authority.
- `docs/INVENTORY_AUTHORITY_ADR.md`: ingredient stock and purchase-cost
  evidence, recipe, menu/event demand and cost, consumable allocation,
  consumption, and inventory-projection authority.
- `docs/field-state-contract.json`: canonical multi-axis field-state vocabulary,
  semantics, priority, accessibility, provenance, and 0/1/many choice contract.
- `docs/field-state-surface-contracts.json`: explicit registry of product
  surfaces and executable tests adopting the field-state contract.

## Update Triggers
- Code or behavior changes: update `CHANGELOG.md`.
- Current-state/risk/near-term execution changes: update `PROJECT_STATUS.md`.
- Roadmap priority changes: update `DEV_TASKS.md`.
- Setup/process/deploy entrypoint changes: update `README.md`.
- Product-truth observability contract or drift-policy changes: update the
  accepted ADR/design, orchestration workflow, and `PROJECT_STATUS.md`; do not
  copy a generated digest into another canonical status authority.
- Commercial kernel, offer, template, rule, vertical-pack, or migration changes:
  update `docs/COMMERCIAL_PLATFORM_PROGRAM.md` and its accepted ADR.
- Pricing policy, arithmetic, rounding, receipt, waterfall, or payment amount
  provenance changes: update `docs/PRICING_CONSTITUTION.md`.
- Ingredient definitions, stock/cost evidence, recipes, requirement mappings,
  consumable availability, allocations, consumption, or inventory projections: update
  `docs/INVENTORY_AUTHORITY_ADR.md`.
- Field, selector, imported/defaulted/suggested value, edit authority,
  save/publish state, or field-level failure/recovery changes: update the field-
  state surface registry and its exact tests; change the field-state contract
  itself only when the governing vocabulary or semantics change.

## Update Timestamps
Every changed canonical Markdown document, every Markdown file under `docs/`,
and `AGENTS.md` must include and advance this exact header format:

`Last updated: YYYY-MM-DD HH:MM:SS TZ`

Use the repository's local wall-clock timezone for document readability. Task
planning, status checkpoints, and completion handoffs separately use the
planner's exact ISO-8601 UTC `lifecycle.recordedAt`. Documentation governance
fails when a governed document lacks the header or changes without advancing
it.

## CI Change-Type Enforcement
`scripts/check-doc-governance.mjs` enforces these non-negotiable mappings:

| Change Type | Trigger Examples | Required Canonical Doc Update |
|---|---|---|
| code | `src/`, `functions/`, `e2e/`, `truthloop/`, `evidence/`, runtime behavior files | `CHANGELOG.md` |
| backend capability | `functions/`, rules/indexes, data/provider clients, realtime authority hooks, mutation/backfill source | `docs/capability-surfacing-contracts.json`, `docs/FEATURE_MATRIX.md`, and `docs/USER_MANUAL.md`, or a narrowly classified tested headless contract |
| process | `.github/`, `scripts/`, `.codex/skills/`, contributor/agent policy files | one of `README.md`, `CONTRIBUTING.md`, `docs/VERSION_CONTROL.md`, `docs/DOC_SYSTEM.md` |
| deploy | `Dockerfile`, `docker-compose.yml`, `docker/*`, deploy workflows/config | one of `README.md`, `docs/LAUNCH_RUNBOOK.md`, `docs/VERSION_CONTROL.md`, `docs/DOC_SYSTEM.md` |
| backlog | roadmap/backlog/task artifacts | `DEV_TASKS.md` |

The GitHub job named `lane:firebase-auth-rules` must invoke the package lane of
the same name. That lane owns Firestore rule tests, the disposable owner-SMS
transaction and signed-event acceptance matrix, and the Firebase-backed browser
smoke, so CI cannot silently omit any part of the authorization contract.

The disposable matrix in `scripts/provisioning-emulator-acceptance.mjs` owns
local signed-webhook acceptance for both Stripe payment rails. It must keep
deposit and final-balance evidence separate, verify replay deduplication and
customer-safe portal projection, and exercise a late provider settlement after
a failed or expired observation. These emulator results are local evidence and
must not be described as hosted or Stripe-provider acceptance.

## Proof-Sensitive Delivery Language
Documentation about customer quote delivery must keep these states separate:
- email-provider configuration is present,
- the provider accepted an exact delivery attempt,
- that acceptance matches the exact current valid portal issuance,
- the provider later reports delivery or bounce, and
- the recipient actually received or viewed the message.

Only the server delivery callable or truthful audited provider reconciliation
may establish `sent`; only a real customer portal visit may establish `viewed`.
Generic staff status writes are never evidence for either state. Provider
acceptance for an invalid or expired portal issuance may be recorded, but must
be described as portal-inactive and `requires_rotation` until guarded rotation
and a separate accepted send establish evidence for the new issuance.

Projection migration or backfill must never be described as creating
`deliveryEvidence` or proving historical acceptance. Legacy projections without
that evidence fail closed and recover through an approved resend or truthful
provider reconciliation. Release docs must also keep local validation, hosted
verification, provider evidence, production deployment, and human acceptance
as separate claims.

## Data Ownership Matrix
| Topic | Canonical Doc | Notes |
|---|---|---|
| Runtime stack versions (React/Vite/Firebase) | `README.md` | Other docs must not restate versions unless they directly link back. |
| Current delivery health and risk posture | `PROJECT_STATUS.md` | Includes what is working now and current blockers. |
| Priority backlog and sequencing | `DEV_TASKS.md` | Open items only; no progress narrative. |
| Historical shipped changes | `CHANGELOG.md` | Immutable history by date/version/merge period. |
| Cross-source state reconciliation and single next proof event | `PROJECT_STATE.md` and `.project/state.json` | Thin human and machine views. They must reference the canonical capability, operational, backlog, and history sources rather than copying them. |
| Claim/evidence verdicts and executive reconciliation | `docs/project/PROOF.md` and `docs/project/EXECUTIVE_STATE.md` | Missing evidence is `UNVERIFIED`; no evidence class substitutes for another. |
| Decision, exploration, capability, and blocker compatibility indexes | `docs/project/` | Index-only views. Feature Matrix, ADRs, Project Status, and Dev Tasks retain authority. |
| Feature inventory, function served, and implementation cohorts | `docs/FEATURE_MATRIX.md` | Current source mapping plus a Git-grounded chronology index. Detailed change history remains in `CHANGELOG.md`; operational/deployment truth remains in `PROJECT_STATUS.md`. |
| Release workflow/process policy | `docs/VERSION_CONTROL.md` | References this doc for ownership rules. |
| Agent policy and skill governance | `docs/AGENT_GOVERNANCE.md` | `docs/SKILLS.md` remains index-only. |
| Cloud/local orchestration policy and lane contracts | `docs/ORCHESTRATION_BLUEPRINT.md` | Operational commands and scenarios live in `docs/ORCHESTRATION_RUNBOOK.md`. |
| Repository operating-system maturity | `docs/REPOSITORY_OPERATING_SYSTEM_AUDIT.md` | Adapted solo-agent harness assessment and target architecture; it summarizes but does not replace the owning governance docs. |
| Portable Codex Desktop governance prompt series | `docs/PORTABLE_CODEX_GOVERNANCE_PROMPT_SERIES.md` | Transferable organization/repository bootstrap prompts for the Commanding Governance Overlay archetype. It is a template and does not govern QuotePilot runtime, release, provider, or product behavior. |
| Cross-repository architecture adoption evidence | `docs/QUIETPILOT_ARCHITECTURE_ADOPTION_REPORT.md` | Point-in-time, read-only comparison and bounded adoption recommendations. It is not runtime, release, provider, or product authority. |
| Development task evidence capture | `docs/DEVELOPMENT_EVIDENCE_COMPILER.md` | Local ignored evidence-record contract for request, validation, proof-boundary, residual-risk, and learning capture. |
| Product truth observability and drift policy | `docs/adr/ADR-0002-product-truth-observability.md`, `docs/design/product-truth-observability-design.md` | Accepted decision and implementation contract for the read-only owner digest and advisory drift gate. `PROJECT_STATUS.md`, the Feature Matrix, release receipts, and other named inputs retain authority; generated digests are projections only. |
| Commercial kernel, vertical packs, offers, templates, rules, and compatibility migration | `docs/COMMERCIAL_PLATFORM_PROGRAM.md` and `docs/adr/ADR-0003-commercial-platform-vertical-pack.md` | Catering remains the reference vertical and natural UX; shared contracts cannot replace quote, catalog, server-pricing, or payment authority. |
| Pricing policy, v1/v2 semantics, exact money, waterfalls, and payment amount provenance | `docs/PRICING_CONSTITUTION.md` | Historical v1 receipts stay immutable; v2 behavior changes require Golden Corpus and differential evidence. |
| Ingredient inventory, recorded purchase cost, versioned recipes, menu/event demand and food cost, consumable availability, allocation, consumption, and projections | `docs/INVENTORY_AUTHORITY_ADR.md` | Inventory owns ingredient stock/cost evidence and bounded operational consequences; Library owns recipe editing against the existing menu catalog, commercial revisions remain historical authority, menu cost and stock promise remain independent rails, and overall event readiness stays separate. |
| Execution/domain classification, model tier, dependency reads, domain-reference routing, doc obligations, and validation mapping | `docs/task-orchestration-contracts.json` | Policy rationale lives in `docs/AGENT_GOVERNANCE.md`; commands live in the orchestration runbook. Domain references remain advisory, and the external runner owns actual model switching. |
| Catering-domain agent reconsideration | `.codex/skills/catering-domain-intelligence/SKILL.md` | The skill owns the provisional-action reconsideration workflow and progressively disclosed expertise references. It does not own QuotePilot runtime, product policy, or human acceptance. |
| Launch runbook details | `docs/LAUNCH_RUNBOOK.md` | `GO_LIVE_OPTION1.md` points here. |
| Staff/admin operating guide | `docs/USER_MANUAL.md` | Task-oriented usage instructions; avoids release/process policy duplication. |
| Workspace visual system and interaction contracts | `docs/DESIGN_SYSTEM.md` | The canonical staff-workspace visual grammar, motion, hierarchy, and scoped Ambient/customer extensions. UI agents load `design-language` first, then preserve this repository-specific authority. |
| Product design principles and review lens | `docs/DESIGN_PRINCIPLES.md` | The review rubric for copy, hierarchy, story, incentive, and CTA decisions; surface-specific design docs may extend it but should not contradict it. |
| Field-state semantics and adopted UI surfaces | `docs/field-state-contract.json` and `docs/field-state-surface-contracts.json` | Separates availability, origin, editability, persistence, and evidence; the registry binds each adopted surface to exact runtime markers and tests. |
| Attendance planning, confirmation, commercial-basis, and actual-count boundaries | `docs/ATTENDANCE_STATE_ADR.md` | Accepted phased architecture and source/local Slice A–E contracts around the unchanged exact `event.guests` commercial basis. Role journeys, external patterns, hypotheses, interview guide, and measurement plan live in `docs/ATTENDANCE_JOURNEY_RESEARCH.md`; operational actual attendance remains a separate unfinished slice. |
| Package Workspace product and implementation program | `docs/PACKAGE_WORKSPACE.md` | Entry point for the QuotePilot Package Workspace audit, PRD, UI specification, ADR, technical design, and phased plan. Current implementation truth remains in the Feature Matrix; operational proof remains in `PROJECT_STATUS.md`. |
| Bounded acceptance evidence matrices | `docs/acceptance/` | Criterion-to-proof ladders for named journeys or workspaces. They must label source, local automated, local connected, hosted, production, assistive-technology, and human evidence separately and may not replace capability or operational truth. |
| Performance budgets, optional-tool assets, and CWV policy | `docs/PERFORMANCE_GUARDRAILS.md` | The clean-main baseline lives in `docs/performance/bundle-budget.json`; any active temporary absolute ceilings live separately in `docs/performance/bundle-exception.json` and must match that baseline exactly. Lazy non-`dist/assets` runtimes must be pinned by exact file, byte count, and SHA-256 in `docs/performance/optional-tool-budget.json`. |
| Backend-to-interface capability contracts | `docs/capability-surfacing-contracts.json` | Machine-checked structural traceability; current release evidence remains in `PROJECT_STATUS.md`. |
| Commercial Truth Loop rule/evidence contract shared by both tiers | `docs/truthloop-evidence-contract.json` | Machine-checked single definition of rules, required evidence, availability states, and reason codes. The JavaScript exporter and the Python reconciler both read it; a cross-tier test fails if either drifts from it. |
| Commercial Truth Loop reconciliation tier | `docs/COMMERCIAL_TRUTH_LOOP_ADR.md` | Authority boundary and binding decisions for the read-only Python tier. Rule catalog, evidence-bundle contract, and metrics live in `docs/COMMERCIAL_TRUTH_LOOP_DESIGN.md`; package usage lives in `truthloop/README.md`; operational truth remains in `PROJECT_STATUS.md`. |
| Stripe Connect architecture and staged program | `docs/STRIPE_CONNECT_PROGRAM.md` | Fixed commercial model, isolation boundaries, delivery sequence, and Sandbox stopping gate; operational truth remains in `PROJECT_STATUS.md`. |

## Redundancy Rules
- Do not duplicate full status snapshots across multiple docs.
- Do not duplicate command inventories when one canonical location exists.
- Prefer links to canonical docs instead of copied sections.

## Project-State Drift Gate

`npm run check:project-state` validates the machine ledger, portfolio record,
repository evidence paths, lifecycle vocabulary, verification freshness,
dependency and blocker references, and exactly one next proof event. It also
checks that compatibility indexes point back to their existing authorities.
The check runs in `lane:quick`. A pass proves control-plane consistency only,
not runtime, provider, production, human, usage, or commercial behavior.

## Security Scan Note
Documentation secret scanning blocks real token-like values and allows explicit placeholder values such as `<your_secret_here>`.

## No-Orphan-Capability Gate

User-relevant backend/data-authority delivery is incomplete until it is bound in
`docs/capability-surfacing-contracts.json` to a discoverable, role-safe frontend
entry point, exact UI test locator, Feature Matrix row, User Manual section, and
per-state executable test evidence for the applicable read or mutation profile.
Each claimed state must assert the canonical `data-capability-state` marker in
an always-on component/unit test; only a read surface's stale state may use the
narrow `separate_program` exception when cache-age authority is explicitly
deferred. The required
`npm run check:capability-surfaces` command runs in `lane:core`, compares the
whole branch/PR or push diff from a validated fail-closed baseline, includes
deleted authority paths, requires manifest and review-revision increments, and
owns changed, new, or removed Firebase Function exports by exact
`path#exportName` rather than file alone. Shared-helper changes must also list
the current callable exports they are declared to affect for every active
classification. Client authority review is fail-closed across runtime
`src/**` paths rather than limited to named hook/context/service folders;
reviewed presentation-only files remain excluded unless their source introduces
direct provider, Firebase, or network authority signals. Mutation inspection
includes chained Admin/Firestore writes and modular client writes. These are
explicit review contracts, not claims that the checker can infer a complete
semantic call graph. The checker provisions a bounded multi-megabyte Git output
buffer so the governed Functions entrypoint is compared in full rather than
failing before contract validation.

Headless work may use only the narrow `headless_operational`,
`security_private`, or `developer_infrastructure` classifications. Operational
headless work still needs a safe UI/Attention outcome and may declare helper
impacts, but it cannot own a callable export; security-private work may not
expose a frontend or callable; infrastructure work needs an operator/process
anchor. Private claims, tokens, secrets, raw provider records, and ledgers stay
hidden and require non-exposure/authority tests. This gate proves structural
traceability only—not semantic completeness, visual polish, hosted availability,
provider behavior, production promotion, or human acceptance.

## Field-State Drift Gate

`npm run check:field-states` validates the canonical 19-state vocabulary,
five-axis composition rules, presentation requirements, runtime definitions,
shared field/choice primitives, and every explicitly registered adoption
surface. It runs in `lane:core`. Any new or modified field-like surface must be
registered with an assertion-bearing test when the field-state contract is
relevant. A pass proves source-level contract alignment only; it does not prove
that every historical field has been migrated, that hosted data exercises each
state, or that assistive-technology and human acceptance are complete.

## Merge Discipline
Per merge, contributors must review this order:
1. `CHANGELOG.md`
2. `PROJECT_STATUS.md` (if state changed)
3. `DEV_TASKS.md` (if priorities changed)
4. `README.md` (if setup/process/deploy entry points changed)

Automated governance checks in CI enforce these rules.
