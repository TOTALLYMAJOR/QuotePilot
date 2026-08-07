# Version Control Playbook

Last updated: August 7, 2026

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
  fresh allowlisted-human UAT workflow result, a target-specific rollback
  ancestor, and the current configured approval policy before dependency
  execution. `independent-review` requires the exact run's recorded
  `production-uat` and `production` approvals. `solo-operator` requires the one
  allowlisted human to perform separate UAT and preparation dispatches at least
  15 minutes apart through protected-branch-only `production-uat-solo` and
  `production-solo` environments. Both modes bind the approval mode into the
  workflow title and evidence receipt. They stage a
  target-scoped payload with a deterministic manifest and never receive provider
  mutation credentials or Functions runtime secrets or mutate production.
- Protect `main` and configure exactly one release approval mode. Team-owned
  repositories use `production-uat` and `production`, each with a directly
  assigned independent reviewer and self-review prevention. Solo-owned
  repositories use reviewless `production-uat-solo` and `production-solo`
  environments plus a one-user `RELEASE_SOLO_OPERATOR_IDS` allowlist and the
  enforced 15-minute cooling period. Every environment disables administrator
  bypass and allows protected branches only. Changing modes is a reviewed
  release-policy change, not an ad hoc per-release bypass.
- `Mainline Safety Net (Auto-Revert Failed Pushes)` is recovery defense that
  reverts a failed current `main` push head. It does not substitute for branch
  protection, the configured approval policy, or release evidence; production
  release is blocked wherever those controls are unavailable.

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
   `docs/LAUNCH_RUNBOOK.md` for every intended production target and record the
   immutable candidate deployment. Portal projection backfill is separate
   source/data-operation acceptance, not deployment-target evidence.
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
   SHA, staging identifier, tracked checklist digest, all and only checklist
   item ids applicable to that target, and exact confirmation. Print the set
   with `npm run release:uat:items -- --target <profile>`. Independent mode
   requires a reviewer other than the attester; solo mode records the
   allowlisted operator and begins the mandatory cooling period.
9. Tag the same semantic version SHA:
```bash
git tag v<major>.<minor>.<patch>
git push origin v<major>.<minor>.<patch>
```
10. Dispatch the target prepare-only workflow with the release SHA, exact-SHA
    CI run id, UAT attestation run id, target rollback SHA, and the exact
    evidence-bound Firebase scope when applicable. Independent mode requires a
    separate `production` approval. Solo mode requires the same allowlisted
    operator, a separate dispatch, and at least 15 elapsed minutes after UAT.
    Record the uploaded payload, evidence
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
Checklist applicability limits each receipt to the selected payload surface and
observed compatibility; it does not prove an unbound dependency's SHA or
provider identity. A `firebase-all` staging receipt must bind Hosting,
Functions, and Firestore rules together before that profile can be operational.

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
