# Documentation System

Last updated: 2026-08-25 00:43:38 CDT

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

## Update Triggers
- Code or behavior changes: update `CHANGELOG.md`.
- Current-state/risk/near-term execution changes: update `PROJECT_STATUS.md`.
- Roadmap priority changes: update `DEV_TASKS.md`.
- Setup/process/deploy entrypoint changes: update `README.md`.
- Lifecycle, evidence, blocker, commercial-proof, or next-proof changes: update
  `.project/state.json` and the applicable thin index under `docs/project/`.

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
| backend capability | `functions/`, rules/indexes, data/provider clients, mutation/backfill source | `docs/capability-surfacing-contracts.json`, `docs/FEATURE_MATRIX.md`, and `docs/USER_MANUAL.md`, or a narrowly classified tested headless contract |
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
| Task classification, model tier, dependency reads, doc obligations, and validation mapping | `docs/task-orchestration-contracts.json` | Policy rationale lives in `docs/AGENT_GOVERNANCE.md`; commands live in the orchestration runbook. The external runner owns actual model switching. |
| Launch runbook details | `docs/LAUNCH_RUNBOOK.md` | `GO_LIVE_OPTION1.md` points here. |
| Staff/admin operating guide | `docs/USER_MANUAL.md` | Task-oriented usage instructions; avoids release/process policy duplication. |
| Workspace visual system and interaction contracts | `docs/DESIGN_SYSTEM.md` | The canonical staff-workspace visual grammar, motion, hierarchy, and scoped Ambient/customer extensions. |
| Product design principles and review lens | `docs/DESIGN_PRINCIPLES.md` | The review rubric for copy, hierarchy, story, incentive, and CTA decisions; surface-specific design docs may extend it but should not contradict it. |
| Package Workspace product and implementation program | `docs/PACKAGE_WORKSPACE.md` | Entry point for the QuotePilot Package Workspace audit, PRD, UI specification, ADR, technical design, and phased plan. Current implementation truth remains in the Feature Matrix; operational proof remains in `PROJECT_STATUS.md`. |
| Performance budgets and CWV policy | `docs/PERFORMANCE_GUARDRAILS.md` | The clean-main baseline lives in `docs/performance/bundle-budget.json`; any active temporary absolute ceilings live separately in `docs/performance/bundle-exception.json` and must match that baseline exactly. |
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
semantic call graph.

Headless work may use only the narrow `headless_operational`,
`security_private`, or `developer_infrastructure` classifications. Operational
headless work still needs a safe UI/Attention outcome and may declare helper
impacts, but it cannot own a callable export; security-private work may not
expose a frontend or callable; infrastructure work needs an operator/process
anchor. Private claims, tokens, secrets, raw provider records, and ledgers stay
hidden and require non-exposure/authority tests. This gate proves structural
traceability only—not semantic completeness, visual polish, hosted availability,
provider behavior, production promotion, or human acceptance.

## Merge Discipline
Per merge, contributors must review this order:
1. `CHANGELOG.md`
2. `PROJECT_STATUS.md` (if state changed)
3. `DEV_TASKS.md` (if priorities changed)
4. `README.md` (if setup/process/deploy entry points changed)

Automated governance checks in CI enforce these rules.
