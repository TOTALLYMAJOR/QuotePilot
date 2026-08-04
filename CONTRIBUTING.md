# Contributing to QuotePilot

Last updated: August 3, 2026

## Setup
1. Use Node.js 22+.
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
Production-triggering merges to `main` require the tracked release-candidate
UAT and exact target-applicable attestation described in
`docs/LAUNCH_RUNBOOK.md`.
Production promotion additionally requires successful exact-main CI, a fresh
protected UAT attestation, and protected production-environment approval.
Changes to release evidence scripts or deploy workflows require review by a
person other than the author.

## GitHub Safety Baseline
- Keep repository visibility set to **Private** for production/customer code.
- Branch protection on `main` is required for the production release model.
- Configure `production-uat` and `production` as protected GitHub environments,
  prevent self-review, require an independent reviewer, and restrict
  deployments to protected branches. Disable administrator bypass.
- Confirm the repository plan/ownership supports required reviewers for this
  private repository; otherwise transfer/upgrade the repository or use an
  approved external deployment protection rule before release.
- Keep `.github/workflows/mainline-safety-net.yml` active as recovery defense;
  it does not replace branch protection or pre-deployment evidence.
- Keep Dependabot enabled for npm and GitHub Actions dependency updates.
- Use `Security` tab private advisories for vulnerability intake.
