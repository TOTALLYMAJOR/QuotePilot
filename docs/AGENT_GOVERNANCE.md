# Agent Governance

Last updated: March 27, 2026

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
