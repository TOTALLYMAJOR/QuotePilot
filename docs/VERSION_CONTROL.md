# Version Control Playbook

Last updated: August 11, 2026

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
- Primary production deployment is manual-workflow-only. Each provider
  entrypoint accepts only the exact remotely published, semantically tagged
  `main` SHA and verifies the matching successful main-push `CI Quality` run,
  target-specific rollback ancestor, canonical human dispatch, and current
  protected environment before dependency execution. It repeats that live
  evidence check after building and immediately before provider mutation.
- Protect `main` and configure exactly one release approval mode. Team-owned
  repositories use `production` with a directly assigned independent reviewer
  and self-review prevention. Solo-owned repositories use the reviewless
  `production-solo` environment plus a one-user `RELEASE_SOLO_OPERATOR_IDS`
  allowlist. Every environment disables administrator bypass and allows
  protected branches only. Changing modes is a reviewed release-policy change,
  not an ad hoc per-release bypass.
- Keep Vercel Git auto-deployments disabled through the reviewed
  `vercel.json` `git.deploymentEnabled: false` setting. Git publication and
  production mutation are separate events; only the manual evidence-gated
  workflow may promote a release.
- `Mainline Safety Net (Recovery PR for Failed Pushes)` is recovery defense
  that prepares a revert only when the failed commit remains current `main`,
  publishes it to a dedicated branch, opens a PR, and dispatches CI against
  that exact recovery head. It never bypasses protected `main` and does not
  substitute for the configured approval policy or release evidence.

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
   - heavy lanes (`lane:firebase-auth-rules`, `lane:authoritative-pricing`,
     `lane:cwv-smoke`) when required by risk classifier or `main` push policy;
     protected `main` requires all eight named contexts, including
     classification and all three heavy lanes
     - Firebase heavy lanes install the independently locked `functions/`
       dependencies before starting emulators; root installation alone is not
       a Functions runtime proof;
     - Firebase emulator lanes require Java 21 or newer. The package lane
       prepares and selects an isolated repository-local JRE before its first
       emulator command when the runner's system Java is older.
     - `lane:firebase-auth-rules` runs Firestore rules, the disposable owner-SMS
       transaction and signed-event acceptance matrix, and the Firebase browser
       smoke as one indivisible CI path.
     - The CWV lane builds a fresh production bundle and explicitly selects the
       installed Playwright Chromium binary before Lighthouse starts.
   - `Docker Build Smoke`
   - `lane:playwright-smoke`
   - Every `CI Quality` job receives only `contents: read`; checkout credentials
     are never persisted into local Git configuration before repository code
     runs. Write-capable recovery remains isolated to the separately reviewed
     mainline safety-net workflow and can create only a branch/PR for ordinary
     protected-main review.
4. Complete the pre-merge release-candidate UAT checklist from
   `docs/LAUNCH_RUNBOOK.md` for every intended production target and record the
   immutable candidate deployment. Bind the attestation to the exact
   deployment-owned SMS provider and configuration generation; use
   `not-applicable` for `none` or Twilio. Portal projection backfill is separate
   source/data-operation acceptance, not deployment-target evidence.
   Use `npm run release:candidate:deploy` only from the clean, published
   `release/vX.Y.Z` head with its exact successful CI run. The command is fixed
   to the isolated Firebase staging identity or the `quoteflow` Vercel preview
   project, requires a SHA-bound confirmation, and records a hosted source/gate
   manifest plus provider deployment id. The receipt path is reserved before
   mutation and retains failed or partial outcomes. Firebase-all verification
   binds Hosting, active Functions revisions and fail-closed runtime readback,
   and the exact Firestore release/ruleset; Vercel requires the coordinated
   staging-Functions readback. It cannot promote an alias or enable operational
   staffing authority.
   Each candidate manifest and receipt binds the tracked `staging-safe-off`
   UAT profile. Run
   `npm run release:uat:plan -- --target <profile> --candidate-profile staging-safe-off`
   to obtain the machine-readable applicable/blocked plan. Every target item is
   classified exactly once and every blocked item carries a reason. Applicable
   is not passed; blocked is not N/A and prevents production qualification.
   `npm run release:uat:items -- --target <profile>` remains the all-positive
   target contract. The exact-main attestation accepts only that complete set
   and never accepts a profile plan, blocked item, waiver, or partial result.
5. Set/confirm rollback target:
   - Preserve the current target-specific signed provider receipt, including
     deployment id, source SHA, artifact/configuration digests, and health
     evidence.
   - Do not replace that last-known-good receipt until the new promotion passes
     post-launch verification.
6. Merge the reviewed release PR to `main`.
7. Wait for all eight hard-gate jobs in the exact `main` push `CI Quality` run.
8. Exercise the exact main SHA on an immutable non-production deployment when
   the release risk calls for it. `Release UAT Attestation` remains available
   for separately recorded human acceptance but is not a normal deploy input.
   It runs only from exact `main` after exact-main CI and is distinct from the
   pre-merge candidate assessment.
9. Tag the same semantic version SHA:
```bash
git tag v<major>.<minor>.<patch>
git push origin v<major>.<minor>.<patch>
```
10. Dispatch `Deploy Firebase Production` or `Deploy Vercel Production` with
    the release SHA, exact-SHA CI run id, target rollback SHA, exact scope, and
    typed confirmation. The provider credential is available only to the final
    deploy step. Record provider acceptance/READY evidence and update the
    target-specific last-known-good receipt only after post-launch verification
    succeeds.
11. When a reviewed release requires the operational-staffing tenant gate,
    dispatch `Set Operational Staffing Tenant` only after the matching
    Firebase `all` deployment succeeds. Bind the exact release SHA and deploy
    run id, use the exact state-and-organization confirmation, and retain the
    verified readback. The reversible field mutation is a separate production
    action and is not implied by deployment. Workflow dispatch values must be
    mapped through step environment variables and never interpolated directly
    into executable shell bodies that can access provider credentials.

If Firebase and Vercel have different last-known-good SHAs, use separate
target-specific deployment runs. Allowed deployment profiles
are `firebase-hosting`, `firebase-backend`, `firebase-all`, and `vercel`;
there is no cross-provider `all` profile with an ambiguous rollback target.
Checklist applicability limits each receipt to the selected payload surface and
observed compatibility; it does not prove an unbound dependency's SHA or
provider identity. A `firebase-all` staging receipt must bind Hosting,
Functions, and Firestore rules together before that profile can be operational.

## Rollback Control
If a regression appears in production, use the target-specific signed
last-known-good provider receipt and provider-native rollback sequence in
`docs/LAUNCH_RUNBOOK.md`. Do not guess a rollback target during the incident.

## Doc Sync Rule
`docs/DOC_SYSTEM.md` is the canonical ownership matrix.
If a topic changes, only update the owning doc and cross-link from others.

## Production Interface Controls
- Firebase workflow input: `firebase_scope`
  - Default operator selection: `hosting`.
  - `backend` deploys `firestore,functions:default`; `backend` and `all` never
    separate the existing Functions codebase from its reviewed rules. The
    selected scope is bound into the workflow title and typed confirmation.
    The generic `functions` selector is prohibited. The credential-free Stripe
    Connect infrastructure workflow only formats and validates source; it has
    no OIDC permission, cloud plan, apply, or deployment step. A future
    protected `functions:connect` deployment workflow remains separately gated.
- Stripe Connect staging infrastructure:
  - `.github/workflows/stripe-connect-infra-validation.yml` is validation-only:
    it pins Terraform, runs the repository policy check, formats, initializes
    with the backend disabled, and validates bootstrap/staging roots.
  - It must never gain `id-token: write`, `terraform apply`, provider secrets,
    or a production target. An authenticated saved plan and an apply are two
    later approvals; an apply approval must name the exact plan digest.
  - Future keyless deployment must use the immutable repository and owner IDs,
    `main`, and protected `stripe-connect-staging` environment encoded in the
  Terraform WIF condition. It may not create or use a service-account key.
- Stripe Connect onboarding source:
  - `.github/workflows/stripe-connect-onboarding-validation.yml` is
    credential-free and proves only the dormant strict request/status/receipt
    contracts and one-use internal handoff. It must not gain provider secrets,
    OIDC permission, a function deployment, or a Stripe call.
  - `functions-connect/index.js` remains deploy-empty until the reviewed
    staging infrastructure bindings, App Check enforcement/replay evidence,
    named-database repository, fail-closed limiter, provider adapter, exact
    manifest inventory, and rollback artifact are approved together.
  - A future export must preserve same-tab navigation through the internal
    one-use POST handoff, keep its token out of URLs/referrers, and reject GET;
    application JavaScript may never receive, persist, log,
    copy, email, or analyze a Stripe Account Link URL.
- Project-scoped Functions environment: `NOTIFICATIONS_SMS_PROVIDER`
  - Default trusted runtime value: `none` unless buyer-approved SMS enablement
    is validated; local ignored Functions files are validation-only.
- Organization-owner repair: `npm run backfill:organization-owner`
  - The command is a no-write dry run unless `--apply` is supplied with the
    planned owner UID and the exact `BIND ORGANIZATION OWNER <project>
    <organization> <uid>` confirmation. A production dry run, reviewed
    candidate evidence, and separately authorized apply are distinct gates;
    source or local test evidence never proves a binding occurred.
- Organization role and App Check promotion:
  - Team access authority ships through the existing `functions:default`
    surface and must be rolled back with its matching Functions/rules/frontend
    artifact; never leave the UI enabled against missing callables or receipts.
  - `VITE_FIREBASE_APP_CHECK_ENABLED` remains off until the exact environment's
    reCAPTCHA Enterprise registration is reviewed. Callable monitoring precedes
    enforcement, and replay protection is promoted last with hosted
    limited-use-token evidence. Rollback disables callable enforcement first,
    then the browser flag; it never weakens role, tenant, recent-auth, or direct-
    browser-write denials.
- Production frontend flag: `VITE_AMBIENT_UI_ENABLED`
  - Both production deploy workflows bind exactly one `"true"` value into the
    frontend build environment, and the deployment-safety test enforces that
    single binding (previously it enforced the flag's absence). This was an
    explicit solo-operator promotion decision recorded in `CHANGELOG.md`;
    the hosted UAT acceptance pass was deliberately foregone.
  - The August 13, 2026 owner-approved operational-staffing test release binds
    `VITE_OPERATIONAL_STAFFING_ENABLED: "true"` exactly once in both production
    workflows. Firebase also materializes
    `OPERATIONAL_STAFFING_AUTHORITY_ENABLED=true`; the trusted tenant setting,
    role checks, direct-browser denials, provider prerequisites, and immutable
    receipts remain independent. The `.env.example` local default for both
    presentation flags remains off.

## Orchestration References
- Blueprint: `docs/ORCHESTRATION_BLUEPRINT.md`
- Runbook: `docs/ORCHESTRATION_RUNBOOK.md`
