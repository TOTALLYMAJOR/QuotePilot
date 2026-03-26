# Contributing to Firebase Quote Wizard

Last updated: March 26, 2026

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
3. Complete doc impact declaration in PR template.
4. Keep canonical docs in sync using `docs/DOC_SYSTEM.md`.

## Validation Checklist
Run before merge:
```bash
npm run check:env
npm run test:unit
npm run test:rules:firestore
npm run test:e2e
npm run build
npm run check:secrets
npm run check:docs:governance
npm run check:perf:bundle
npm run check:perf:cwv
```

When auth/rules/Firestore access paths are changed, also run:
```bash
npm run test:e2e:firebase
npm run test:e2e:firebase:authoritative
```

Notes:
- `test:e2e` uses the Playwright wrapper (`scripts/run-playwright.sh`) and auto-prepares Linux runtime libs in `.cache/playwright-libs`.
- `test:e2e:firebase` runs browser flow against Firebase emulators with seeded org/user fixtures.
- `test:e2e:firebase:authoritative` adds Functions emulator and enforces authoritative pricing callable success in browser flow.
- CI (`.github/workflows/ci-quality.yml`) runs all Playwright lanes: default smoke, Firebase emulator smoke, and Firebase authoritative smoke.

## Documentation Discipline
Canonical ownership is defined in `docs/DOC_SYSTEM.md`.
Update only the owning docs for changed topics; link instead of duplicating narrative.

## Release Discipline
Follow `docs/VERSION_CONTROL.md` for branch/tag/release policy.
Production-triggering merges to `main` require a completed 10-minute UAT checklist in `docs/LAUNCH_RUNBOOK.md`.

## GitHub Safety Baseline
- Keep repository visibility set to **Private** for production/customer code.
- Enable branch protection on `main`:
  - require pull request before merge
  - require status checks to pass (`CI Quality`)
  - block force pushes/deletions
- Keep Dependabot enabled for npm and GitHub Actions dependency updates.
- Use `Security` tab private advisories for vulnerability intake.
