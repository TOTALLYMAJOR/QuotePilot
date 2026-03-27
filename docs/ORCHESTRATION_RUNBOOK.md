# Orchestration Runbook

Last updated: March 27, 2026

## Purpose
Operational usage guide for orchestration lanes, CI behavior, and release evidence expectations.

## Local Command Profiles
Preflight:
```bash
npm run lane:quick
```

Core:
```bash
npm run lane:core
```

Tenant/auth/rules high-risk:
```bash
npm run lane:firebase-auth-rules
npm run lane:authoritative-pricing
```

Release readiness:
```bash
npm run lane:release
```

Release readiness with CWV:
```bash
npm run lane:release:cwv
```

## Skill Entry Points
Maintainer checks:
```bash
bash .codex/skills/quote-wizard-maintainer/scripts/run-maintainer-checks.sh
```

Maintainer high-risk checks:
```bash
bash .codex/skills/quote-wizard-maintainer/scripts/run-maintainer-checks.sh --high-risk
```

Release checks:
```bash
bash .codex/skills/quote-wizard-release-manager/scripts/release-readiness.sh
```

Release checks (high-risk + CWV):
```bash
bash .codex/skills/quote-wizard-release-manager/scripts/release-readiness.sh --high-risk --with-cwv
```

## CI Behavior by Change Type
Docs-only:
- Required: `lane:quick`, `lane:core`
- Heavy lanes skipped.

UI/core low-risk on branches:
- Required: `lane:quick`, `lane:core`
- Heavy lanes run advisory.

Auth/rules/store high-risk:
- Required: `lane:quick`, `lane:core`, heavy Firebase lanes, and CWV as classified.

`main` pushes:
- Full hard-gate matrix required.
- Deploy workflow triggers only from successful `CI Quality` run.
- If `CI Quality` fails on a `main` push, `Mainline Safety Net (Auto-Revert Failed Pushes)` reverts the failed head commit when it is still current `main` head.

## PR Evidence Checklist
- Complete Change Intent Contract in PR template.
- Provide lane evidence and note any advisory failures.
- Include residual risk statement.
- Include rollback path/SHA for high-risk or release-intent changes.

## Migration Dry-Run Evidence Standard (P0 Execution)
Required command pattern:
```bash
mkdir -p .cache/migration-dry-runs
STAMP="$(date -u +%Y%m%dT%H%M%SZ)"
LOG_PATH=".cache/migration-dry-runs/${STAMP}--<firebaseProjectId>--<orgId>--dry-run.log"
JSON_PATH=".cache/migration-dry-runs/${STAMP}--<firebaseProjectId>--<orgId>--dry-run.json"
npm run migrate:multi-tenant -- --project <firebaseProjectId> --organization <orgId> --dry-run --evidence-out "${JSON_PATH}" 2>&1 | tee "${LOG_PATH}"
```

Artifact file naming/location:
- Path: `.cache/migration-dry-runs/`
- Log filename pattern: `<YYYYMMDDTHHMMSSZ>--<projectId>--<orgId>--dry-run.log` (stdout/stderr transcript).
- JSON filename pattern: `<YYYYMMDDTHHMMSSZ>--<projectId>--<orgId>--dry-run.json` (structured totals/collection evidence).

PR evidence expectation for migration-intent changes:
- Include the exact dry-run command used (with concrete `--project` and `--organization` values).
- Upload both generated files as PR evidence (artifact or attachment) and include filenames/paths.
- Include a one-line dry-run outcome summary citing migration totals (`wouldCreate`, `wouldPatch`) and whether any blockers were found.

## Failure Triage
- Use uploaded CI artifacts (`playwright-report`, `test-results`) first.
- If Firebase lane fails:
  - verify emulator startup and fixture seeding logs
  - verify auth/rules assumptions against changed paths
- If CWV fails:
  - inspect largest chunk and bundle drift
  - validate if threshold exception workflow is required
