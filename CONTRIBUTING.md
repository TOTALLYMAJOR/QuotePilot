# Contributing to QuotePilot

Last updated: March 27, 2026

## Setup
1. Use Node.js 20+.
2. Run `npm install`.
3. Create `.env` from `.env.example`.
4. Validate setup with `npm run check:env`.

## Branching
- `main`: release-only, production-ready branch.
- `feature/<scope>-<topic>`
- `fix/<scope>-<topic>`
- `docs/<topic>`
- `chore/<topic>`

## Commit Convention
Use Conventional Commits.
Examples:
- `feat(quote): add event template presets`
- `fix(store): guard portal status update path`
- `docs(governance): add canonical doc ownership matrix`
- `chore(ci): enforce bundle and cwv gates`

## PR Requirements
1. Keep scope focused.
2. Include verification evidence.
3. Complete the Change Intent Contract + lane evidence + doc impact declaration in PR template.
4. Keep canonical docs in sync using `docs/DOC_SYSTEM.md`.

## Change Intent Contract (PR Template)
Every PR must declare:
- `change_type`: `docs` / `process` / `ui` / `core` / `auth_rules` / `deploy`
- `risk_level`: `low` / `medium` / `high`
- `tenant_impact`: `none` / `read` / `write` / `rules`
- `required_lanes`: `auto` or manual override with rationale
- `doc_impact`: canonical docs touched and why

## Validation Checklist
Run before merge:
```bash
npm run lane:quick
npm run lane:core
```

When auth/rules/Firestore access paths are changed, also run high-risk lanes:
```bash
npm run lane:firebase-auth-rules
npm run lane:authoritative-pricing
```

Notes:
- Heavy CI lanes (Playwright/Firebase/CWV) are advisory on feature branches unless elevated by classifier risk rules.
- `main` pushes enforce full hard-gate CI matrix.
- `test:e2e` uses the Playwright wrapper (`scripts/run-playwright.sh`) and auto-prepares Linux runtime libs in `.cache/playwright-libs`.
- `test:e2e:firebase` runs browser flow against Firebase emulators with seeded org/user fixtures.
- `test:e2e:firebase:authoritative` adds Functions emulator and enforces authoritative pricing callable success in browser flow.

## Documentation Discipline
Canonical ownership is defined in `docs/DOC_SYSTEM.md`.
Update only the owning docs for changed topics; link instead of duplicating narrative.

## Release Discipline
Follow `docs/VERSION_CONTROL.md` for branch/tag/release policy.
Production-triggering merges to `main` require a completed 10-minute UAT checklist in `docs/LAUNCH_RUNBOOK.md`.

## GitHub Safety Baseline
- Keep repository visibility set to **Private** for production/customer code.
- Branch protection on `main` is strongly recommended, but not required for this orchestration model.
- If branch protection is not enabled, keep `.github/workflows/mainline-safety-net.yml` active so failed `main` pushes are auto-reverted after `CI Quality` failures.
- Keep Dependabot enabled for npm and GitHub Actions dependency updates.
- Use `Security` tab private advisories for vulnerability intake.
