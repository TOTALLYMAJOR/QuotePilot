# Version Control Playbook

Last updated: July 27, 2026

## Goals
- Keep `main` stable and deployable.
- Treat `main` as release-only until staging sign-off is re-established.
- Preserve traceable, reviewable history.
- Keep canonical docs synchronized per merge.

## Daily Flow
1. Sync:
```bash
git checkout main
git pull origin main
```
2. Branch:
```bash
git checkout -b feature/<scope>-<topic>
```
3. Implement focused changes.
4. Run required checks (see `CONTRIBUTING.md`).
   - For CI workflow edits, confirm the CI gate steps are runnable in GitHub Actions and documented in `CHANGELOG.md`.
5. Update canonical docs per `docs/DOC_SYSTEM.md`.
6. Open PR with validation evidence and doc impact declaration.

## Release-Only Main Rule
- `main` is for production-intent merges only.
- Feature work lands in topic branches and merges only after required CI and pre-merge UAT evidence are complete.
- Production deployment is manual-only after the required `CI Quality` and UAT
  evidence; the deploy entrypoint accepts only a clean, remotely published,
  semantically tagged `main` revision.
- If branch protection is not enabled, `Mainline Safety Net (Auto-Revert Failed Pushes)` provides fallback protection by reverting failed `main` push heads after CI failure.

## Branch Naming
- `feature/<scope>-<topic>`
- `fix/<scope>-<topic>`
- `docs/<topic>`
- `chore/<topic>`
- `release/<version>`

## Commit Quality Rules
- Commit logical units only.
- Avoid mixing unrelated refactors and behavior changes.
- Never commit local state or secrets.

## Release Workflow
1. Create `release/<version>` from `main`.
2. Finalize `CHANGELOG.md` and `PROJECT_STATUS.md`.
3. Run release checks (CI must be green):
   - `lane:quick (Preflight + Secrets)`
     - runs before dependency installation, so its environment and secret
       checks must use only Node built-ins and repository scripts;
     - CI uses canonical non-secret Firebase test identifiers, including the
       production project ID, while host/provider secrets remain absent.
   - `lane:core (Unit + Build + Governance + Bundle)`
     - checks out full branch history so governance can compare the PR head
       against its actual `origin/main` merge base.
   - heavy lanes (`lane:firebase-auth-rules`, `lane:authoritative-pricing`, `lane:cwv-smoke`) when required by risk classifier or `main` push policy
     - Firebase heavy lanes install the independently locked `functions/`
       dependencies before starting emulators; root installation alone is not
       a Functions runtime proof;
     - Firebase emulator runners require Java 21 or newer and automatically
       select an isolated repository-local JRE when the runner's system Java is
       older.
     - The CWV lane builds a fresh production bundle and explicitly selects the
       installed Playwright Chromium binary before Lighthouse starts.
   - `Docker Build Smoke`
   - `lane:playwright-smoke`
4. Complete pre-merge 10-minute UAT checklist from `docs/LAUNCH_RUNBOOK.md`.
5. Set/confirm rollback target:
   - Preserve the previous production commit SHA.
   - Record current deployed "last known good" commit in `PROJECT_STATUS.md`.
6. Merge release PR to `main`.
7. Tag semantic version:
```bash
git tag v<major>.<minor>.<patch>
git push origin v<major>.<minor>.<patch>
```
8. Deploy from tagged `main` commit.

## Rollback Control
If a regression appears in production, roll back immediately to the prior known-good SHA documented in `PROJECT_STATUS.md` using the commands in `docs/LAUNCH_RUNBOOK.md`.

## Doc Sync Rule
`docs/DOC_SYSTEM.md` is the canonical ownership matrix.
If a topic changes, only update the owning doc and cross-link from others.

## Production Interface Controls
- GitHub variable: `ENABLE_FUNCTIONS_DEPLOY`
  - Default production value: `false`.
  - Set to `true` only for intentional, validated functions deploy windows, then return to `false`.
- Project-scoped Functions environment: `NOTIFICATIONS_SMS_PROVIDER`
  - Default production value: `none` unless buyer-approved SMS enablement is validated.

## Orchestration References
- Blueprint: `docs/ORCHESTRATION_BLUEPRINT.md`
- Runbook: `docs/ORCHESTRATION_RUNBOOK.md`
