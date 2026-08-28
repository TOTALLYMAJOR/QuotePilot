# Agent Governance

Last updated: 2026-08-28 17:25:14 CDT

## Scope
This document defines governance for repository-managed agent and skill assets under `.codex/skills/`.

## Approved Skills
- `quote-wizard-maintainer`: implementation, fixes, safe refactors, and required documentation updates.
- `quote-wizard-release-manager`: release readiness, changelog curation, and operational handoff quality.

## Canonical Locations
- Skill definitions: `.codex/skills/*/SKILL.md`
- Agent interface metadata: `.codex/skills/*/agents/openai.yaml`
- Skill references/scripts: `.codex/skills/*/references/`, `.codex/skills/*/scripts/`
- Index only: `docs/SKILLS.md`

## Validation Requirements
- Maintainer skill checks:
  - `bash .codex/skills/quote-wizard-maintainer/scripts/run-maintainer-checks.sh`
- Release manager checks:
  - `bash .codex/skills/quote-wizard-release-manager/scripts/release-readiness.sh`
- Orchestration lane entrypoints:
  - `npm run lane:quick`
  - `npm run lane:core`
  - `npm run lane:firebase-auth-rules`
  - `npm run lane:authoritative-pricing`
  - `npm run lane:release`
- Governance controls:
  - `npm run plan:task -- --task "<work>" --files <path,...>`
  - `npm run evidence:task -- --task "<work>" --phase complete ...`
  - `npm run evidence:index`
  - `npm run status:product`
  - `npm run check:product-drift`
  - `npm run check:docs:governance`
  - `npm run check:perf:bundle`
  - `npm run check:perf:cwv`

## Ownership and Review
- Repository owner (`@TOTALLYMAJOR`) approves skill behavior changes.
- Any update to `.codex/skills/` must include:
  - summary of expected behavior change,
  - verification commands run,
  - risk notes if execution scope expanded.

## Stable-First Dependency Policy
Default: prefer stable/LTS versions for core runtime and build dependencies.

Major-version upgrades require an exception record in `docs/TECH_EXCEPTIONS.md` including:
- rationale,
- risk and compatibility impact,
- performance impact expectation,
- rollback plan,
- validation evidence.

No exception record means no major upgrade merge.

## Task Model Routing and Token Discipline
`docs/task-orchestration-contracts.json` is the machine-readable task-routing
contract. `npm run plan:task` classifies a bounded task and explicit file set,
then emits the recommended model, reasoning effort, read-first dependencies,
canonical documentation obligations, ordered validation commands, and task
dependency graph. Use explicit `--files` for dirty worktrees so unrelated work
does not inflate the task or model tier.

The UI profile also emits `design-language` in `dependencies.requiredSkills`
and places `docs/DESIGN_SYSTEM.md` plus `docs/DESIGN_PRINCIPLES.md` in the
read-first set. Agents must load that skill before UI analysis or edits, then
preserve QuotePilot's canonical visual, interaction, copy, accessibility, and
proof-boundary rules rather than introducing a parallel design language.

The planner recommends `economy`, `balanced`, or `frontier` work and resolves
those tiers to runner model defaults. `TASK_MODEL_ECONOMY`,
`TASK_MODEL_BALANCED`, and `TASK_MODEL_FRONTIER` may override those defaults at
the runner boundary. The repository does not claim that a running agent can
replace its own model: the external runner owns the actual switch and must
consume `modelRouting.selectedModel` and `modelRouting.reasoningEffort` before
starting the task.

Every planner result includes `lifecycle.phase` and an exact ISO-8601 UTC
`lifecycle.recordedAt`. Use `plan` before work, `update` for a material status
checkpoint, and `complete` for the final report. Completion reports must carry
the emitted `recordedAt`; do not substitute an approximate conversational time.

To minimize tokens, read only `dependencies.readFirst` plus task-owned files,
execute `taskGraph` in dependency order, and run the narrowest relevant check
before global checks. Changes to the planner or its contract fail documentation
governance unless this policy, the orchestration blueprint and runbook, and the
documentation ownership map move together.

## Task Evidence Loop
For meaningful implementation, process, release, or architecture work, agents
may record a local ignored task evidence file with `npm run evidence:task`.
The command is not a replacement for `plan:task --phase complete`; it captures
the surrounding proof, residual risks, human decision, and later outcome signal
described in `docs/DEVELOPMENT_EVIDENCE_COMPILER.md`.

Use `npm run evidence:index` to inspect repeated development-system friction
before adding new process, skills, checks, or planner rules.

Use `npm run status:product` for the read-only owner projection and
`npm run check:product-drift` before PR or release preparation. The CI job is
advisory until an explicit owner promotion; a generated digest never replaces
canonical documents, exact receipts, or human acceptance.
