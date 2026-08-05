# Version Control Playbook

Last updated: August 3, 2026

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
- Primary production preparation is manual-workflow-only. The prepare
  entrypoints accept only the exact remotely published, semantically tagged
  `main` SHA and verify the matching successful main-push `CI Quality` run, a
  fresh allowlisted-human UAT workflow result, the exact run's recorded
  `production-uat` approval, the exact preparation run's independent
  `production` approval, a target-specific rollback ancestor, and current
  protected environment policy before dependency execution. They stage a
  target-scoped payload with a deterministic manifest and never receive provider
  mutation credentials or Functions runtime secrets or mutate production.
- Protect `main` and both GitHub environments (`production-uat`, `production`).
  Each environment must prevent self-review, require a directly assigned
  independent user reviewer, disable administrator bypass, and allow protected
  branches only. Release-critical changes require
  independent review; same-repository scripts are not an external attestation
  authority.
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
   - If GitHub does not enqueue the normal `pull_request` run, manually
     dispatch `CI Quality` against the exact published PR head and retain that
     run as the CI evidence. Do not substitute a run from another commit.
   - `Classify Changes + Lane Plan`
   - `lane:quick (Preflight + Secrets)`
     - runs before dependency installation, so its environment and secret
       checks plus the checksum-pinned GitHub workflow lint must use only Node
       built-ins and repository scripts;
     - workflow lint downloads an exact actionlint v1.7.12 platform archive,
       verifies its tracked SHA-256, and checks every workflow while disabling
       runner-dependent shellcheck/pyflakes integrations;
     - CI uses canonical non-secret Firebase test identifiers, including the
       production project ID, while host/provider secrets remain absent.
   - `lane:core (Unit + Build + Governance + Bundle)`
     - checks out full branch history so governance can compare the PR head
       against its actual `origin/main` merge base.
   - heavy lanes (`lane:firebase-auth-rules`, `lane:authoritative-pricing`, `lane:cwv-smoke`) when required by risk classifier or `main` push policy
     - Firebase heavy lanes install the independently locked `functions/`
       dependencies before starting emulators; root installation alone is not
       a Functions runtime proof;
     - Firebase emulator lanes require Java 21 or newer. The package lane
       prepares and selects an isolated repository-local JRE before its first
       emulator command when the runner's system Java is older.
     - The CWV lane builds a fresh production bundle and explicitly selects the
       installed Playwright Chromium binary before Lighthouse starts.
   - `Docker Build Smoke`
   - `lane:playwright-smoke`
   - Every `CI Quality` job receives only `contents: read`; checkout credentials
     are never persisted into local Git configuration before repository code
     runs. Write-capable recovery remains isolated to the separately reviewed
     mainline safety-net workflow.
4. Complete the pre-merge release-candidate UAT checklist from
   `docs/LAUNCH_RUNBOOK.md` and record the immutable candidate deployment.
5. Set/confirm rollback target:
   - Preserve the current target-specific signed provider receipt, including
     deployment id, source SHA, artifact/configuration digests, and health
     evidence.
   - Do not replace that last-known-good receipt until the new promotion passes
     post-launch verification.
6. Merge the reviewed release PR to `main`.
7. Wait for all eight hard-gate jobs in the exact `main` push `CI Quality` run.
8. Exercise the exact main SHA on an immutable non-production deployment, then
   dispatch `Release UAT Attestation` with the release SHA, target, rollback
   SHA, staging identifier, tracked checklist digest, all checklist item ids,
   and exact confirmation. A reviewer other than the attester must approve the
   `production-uat` environment gate.
9. Tag the same semantic version SHA:
```bash
git tag v<major>.<minor>.<patch>
git push origin v<major>.<minor>.<patch>
```
10. Dispatch the target prepare-only workflow with the release SHA, exact-SHA
    CI run id, UAT attestation run id, target rollback SHA, and the exact
    evidence-bound Firebase scope when applicable. A separate `production`
    environment approval by a current direct reviewer other than the dispatcher
    and UAT attester is required. Record the uploaded payload, evidence
    receipt, and deterministic manifest; this step does not deploy.
11. Only after it is implemented and qualified, promote through a separately
    owned trusted deployer that revalidates the GitHub run/artifact identity and
    every payload file against the manifest and holds the
    provider mutation credential outside this repository. Record provider
    acceptance/READY evidence and update the target-specific last-known-good
    receipt only after post-launch verification succeeds.

If Firebase and Vercel have different last-known-good SHAs, use separate
target-specific UAT attestations and preparation runs. Allowed UAT/preparation profiles
are `firebase-hosting`, `firebase-backend`, `firebase-all`, and `vercel`;
there is no cross-provider `all` profile with an ambiguous rollback target.

## Rollback Control
If a regression appears in production, use the target-specific signed
last-known-good provider receipt and the credential-isolated trusted-deployer
sequence in `docs/LAUNCH_RUNBOOK.md`. Do not rebuild from a Git SHA or run a
repository provider command during the incident.

## Doc Sync Rule
`docs/DOC_SYSTEM.md` is the canonical ownership matrix.
If a topic changes, only update the owning doc and cross-link from others.

## Production Interface Controls
- Firebase workflow input: `firebase_scope`
  - Default operator selection: `hosting`.
  - `backend` prepares `firestore,functions`; `backend` and `all` must each use
    a matching target-specific UAT attestation. The selected scope is bound
    into the current workflow title and revalidated before artifact upload.
- Project-scoped Functions environment: `NOTIFICATIONS_SMS_PROVIDER`
  - Default trusted runtime value: `none` unless buyer-approved SMS enablement
    is validated; local ignored Functions files are validation-only.

## Orchestration References
- Blueprint: `docs/ORCHESTRATION_BLUEPRINT.md`
- Runbook: `docs/ORCHESTRATION_RUNBOOK.md`
