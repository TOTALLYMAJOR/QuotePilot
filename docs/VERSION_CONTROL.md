# Version Control Playbook

Last updated: 2026-09-18 20:58:00 CDT

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

Run `npm run status:product` after sync/branch selection and
`npm run check:product-drift` before opening a PR. The generated digest is a
source-linked projection, not authority. Its CI job remains advisory until an
explicit owner promotion after real-run review.

## Release-Only Main Rule
- `main` is for production-intent merges only.
- Feature work lands in topic branches and merges only after required CI and pre-merge UAT evidence are complete.
- Primary production deployment is manual-workflow-only. Each provider
  entrypoint accepts only the exact remotely published, semantically tagged
  `main` SHA and verifies the matching successful main-push `CI Quality` run,
  target-specific rollback ancestor, canonical human dispatch, and current
  protected environment before dependency execution. It repeats that live
  evidence check after building and immediately before provider mutation.
- The v0.16.0 workflows additionally require the exact `safe-off` release
  profile. That profile is part of the immutable workflow title and verified
  arguments, not a descriptive label. It permits the reviewed product
  presentation while keeping public buyer entry, outbound email/SMS providers,
  Commercial Change, Revenue Autopilot, and the server staffing authority off.
  It preserves `STRIPE_MODE=live` solely for the established quote-payment
  rail; the separate buyer-invoice rail remains disabled with test mode bound.
- The `ragnakok-operations` profile is the only production profile that may
  enable the coupled Commercial Change and Event Spine gates together with
  `OPERATIONAL_STAFFING_AUTHORITY_ENABLED` and
  `INVENTORY_AUTHORITY_ENABLED`. It is restricted to a Functions-bearing
  Firebase deployment and binds `TENANT_WORKFLOW_ORGANIZATION_ID` to the exact
  founder-pilot organization. Every other profile keeps all four authorities
  off. After the successful tagged all-surface deploy,
  the Staffing, Inventory, and coupled Event/Commercial tenant workflows must
  each verify that deploy receipt, update only their declared setting fields,
  and prove provider readback. Do not substitute a console edit or direct
  Firestore write.
- The `ragnakok-realistic-v1` population may seed menu cost only from a
  complete, current same-tenant Inventory recipe-cost projection and only when
  the target menu row is explicitly fixture-owned and has no recorded cost.
  The guarded transaction must recheck the exact catalog revision and every
  projection digest, preserve selling prices and operator/unclassified rows,
  advance the revision once, record synthetic provenance, bind a fresh pricing
  confirmation to the resolved verified administrator, and prove provider
  readback. A successful dry run or source test does not authorize the provider
  mutation.
- The coordinated `all-qualified-features` profile supersedes the split
  founder-pilot release path only for an explicitly authorized full promotion.
  It is accepted exclusively by Firebase `all` and Vercel, pins the compiled
  and runtime organization to `mm05366-sandbox`, and enables the qualified
  staff workspace, Resend, Commercial Change, Event Spine, Staffing,
  Inventory, Guided Inquiry, and review-only Model Assist. It still keeps
  Buyer Access, SMS, Revenue Autopilot sends, test bypasses, and hard App Check
  enforcement off. The exact Inquiry Turnstile site key and Secret Manager
  bindings plus the tenant-scoped OpenAI provider configuration are required
  profile evidence, not optional post-deploy setup.
- Firebase Functions production mutation is quota-aware and fail-closed. The
  deployer derives the exact tracked export inventory, submits no more than 35
  function writes per batch, waits a complete provider quota window between
  batches, and rejects Firebase's textual create/update failure even if the CLI
  exits zero. A backend/all workflow succeeds only after `functions:list`
  proves the exact inventory active in `us-central1` with every function bound
  to the exact selected runtime profile and no disabled-provider residue.
  The dedicated deployer also requires `roles/iam.serviceAccountUser` on the
  exact Functions runtime service account and project-scoped
  `roles/cloudscheduler.admin` for scheduled-function lifecycle. Cloud
  Functions Admin does not include either authority; their provider readback is
  a release prerequisite, not an emergency bypass.
  Separately, every Function-bound Secret Manager value must grant
  `roles/secretmanager.secretAccessor` to the exact runtime service account
  before dispatch. Do not give the CI deployer broad secret-policy mutation
  authority to compensate for a missing runtime binding.
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
- Keep local tool scratch outside tracked source. Browser, Lighthouse, emulator,
  and cloud-runner temporary profiles belong under OS temp paths or ignored
  cache directories; they must not be committed or used as release evidence.
- For meaningful local implementation, process, release, or architecture work,
  use `npm run evidence:task` when a compact handoff record would save future
  agent/human reconstruction. Its `.cache/development-evidence/` output is
  ignored local task evidence only; it does not replace commit history, CI,
  hosted/provider receipts, production deployment proof, or human acceptance.
- Use `npm run evidence:index` to inspect local task-record trends before
  adding new process or automation. Repeated friction may justify a script,
  planner rule, skill, or check; one-off friction should stay as evidence.
- Successful qualifying `lane:playwright-smoke` runs retain a 90-day
  `quotepilot-visual-evidence-<GITHUB_SHA>` artifact. The dedicated synthetic
  proof cohort is rebuilt after the normal browser gates; its bundle records the
  actual checkout SHA, optional PR head/base SHAs, Playwright result metadata,
  per-image SHA-256 digests, and the manifest digest. CI fails the bundle step
  when no screenshots are produced or when the requested SHA disagrees with the
  checkout. This is CI evidence only and must not be promoted to hosted,
  provider, production, human-acceptance, or outcome evidence.

## Release Workflow

The latest target-specific deployment and tenant-population receipts belong in
`PROJECT_STATUS.md` and historical outcomes in `CHANGELOG.md`; this playbook
retains the process contract and must not become a competing current-state
ledger.

Tenant authority activation may bind separate tagged Firebase backend and
Vercel browser releases when those are the current deployed surfaces. The
protected operator must verify both exact workflow receipts, release profiles,
and compiled/runtime gates before changing the tenant setting; an older
all-surface receipt cannot stand in for a newer backend deployment.

1. Create `release/<version>` from `main`.
2. Finalize `CHANGELOG.md` and `PROJECT_STATUS.md`.
3. Run release checks (CI must be green):
   - Candidate secret preflight must accept the pinned Firebase CLI's structured
     `secret.name` metadata shape, require an enabled version for every exact
     bound name, and remain metadata-only. A parser mismatch is a fail-closed
     source defect; fix, republish, and rerun exact-SHA CI rather than bypassing
     the gate.
   - Firebase Rules release and ruleset readback must send the fixed staging
     project as `x-goog-user-project` when using user ADC. Do not mutate the
     operator's global ADC quota-project setting to compensate for a missing
     request header.
   - Before publishing a Firebase candidate, run checksum-pinned Functions
     manifest discovery in dry-run mode. Keep discovery free of eager optional
     renderer loads, retain an audited dependency graph compatible with the
     pinned analyzer, and pass the explicit retry-policy acknowledgement for
     tracked retry-enabled event functions. Firebase may enable a required API
     during preflight even under `--dry-run`; record that provider mutation.
   - Treat the pinned Firebase CLI Hosting result as an exact resource identity.
     It may use either `sites/<fixed-site>/versions/<id>` or
     `projects/<fixed-project-number>/sites/<fixed-site>/versions/<id>`; reject
     every other project, site, or empty version before provider readback.
     Normalize only the pinned numeric project to the pinned project ID when the
     live-channel API returns the same immutable version under project-ID form.
     Allow a short bounded propagation retry for the hosted source manifest,
     but require complete object equality before any provider-readback claim.
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
     - The CWV lane builds a fresh production bundle, explicitly selects the
       installed Playwright Chromium binary, and routes Chromium scratch
       profiles through Linux `/tmp` before Lighthouse starts. Those transient
       files are local runner artifacts, never repository or release evidence.
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
   `release/vX.Y.Z` head with its exact successful CI run. The command requires
   a complete root and Functions dependency install; Firebase-all preflight
   verifies the Functions production dependency tree before receipt reservation
   or provider mutation, with `npm ci --prefix functions` as the bounded repair.
   It is fixed to the isolated Firebase staging identity or the `quoteflow` Vercel preview
   project, requires a SHA-bound confirmation, and records a hosted source/gate
   manifest plus provider deployment id. The receipt path is reserved before
   mutation and retains failed or partial outcomes. Hosted manifest equality is
   retried every two seconds for at most one minute to absorb bounded provider
   propagation; source SHA, CI run, profile, and authority values must still
   match exactly. A partial provider-mutation receipt is immutable and is not
   retried; a corrected attempt requires a newly published, newly qualified
   source SHA. Firebase-all verification
   binds Hosting, active Functions revisions and fail-closed runtime readback,
   and the exact Firestore release/ruleset; Vercel requires the coordinated
   staging-Functions readback. It cannot promote an alias. Operational staffing
   authority may be enabled only in the fixed staging project through the
   explicit `staging-staffing-authority` profile; the separate tenant gate must
   still be authorized, enabled for one disposable tenant, exercised, and rolled
   back. The third `staging-provider-acceptance` profile is Firebase-only and
   may open a controlled Resend, test-only Stripe, public buyer, and staffing
   window only from verified safe-off readback. It keeps SMS, Commercial
   Change, and both Revenue Autopilot gates off, requires the profile name in
   its typed confirmation, and must close with same-SHA safe-off Firebase and
   Vercel receipts. All candidate profiles bind the staging platform-operator allowlist
   to the single verified `flightcontrol@quietpilot.us` identity. Candidate
   dotenv validation and active Functions readback reject an unavailable,
   additional, or substituted operator before the receipt can become verified.
   This staging identity does not change production platform administration.
   GitHub CI verification resolves authentication from
   `GITHUB_TOKEN`, then `GH_TOKEN`, then the authenticated local GitHub CLI; if
   none is available, the command stops before provider mutation and never
   prints credential material.
   Each candidate manifest and receipt binds exactly one tracked profile:
   `staging-safe-off`, `staging-staffing-authority`, or the Firebase-only
   `staging-provider-acceptance`. Run
   `npm run release:uat:plan -- --target <profile> --candidate-profile <candidate-profile>`
   to obtain the machine-readable applicable/blocked plan. Every target/SMS item
   is classified exactly once and every blocked item carries a reason. Applicable
   is not passed; blocked is not N/A and prevents production qualification.
   Candidate receipt filenames include both target and profile so same-SHA
   safe-off and bounded positive evidence cannot overwrite one another.
   Firebase candidate preflight must verify enabled metadata for every secret
   bound by the current Functions source before it reserves that immutable
   receipt; it never reads or creates secret values. If a reserved attempt
   becomes `partial`, preserve it without replacement or retry and correct the
   failure on a fresh source SHA with new exact-head CI evidence.
   `npm run release:uat:items -- --target <profile> --sms-provider <provider>`
   remains the all-positive target contract. The exact-main v4 attestation
   accepts only an eligible profile's complete set, binds the profile and its
   fixed SMS provider, and never accepts a blocked item, waiver, or partial
   result. Provider-enabled acceptance uses Firebase-all; immutable Vercel
   preview remains safe-off because its generated hostname is not an approved
   Turnstile hostname.
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
    the release SHA, exact-SHA CI run id, target rollback SHA, exact scope,
    release profile, and typed confirmation. `safe-off` is valid for every
    production target. `email-active` is valid only for an explicitly
    authorized Firebase `backend`/`all` deployment and changes only
    `NOTIFICATIONS_EMAIL_PROVIDER` from `none` to `resend`; Hosting-only and
    Vercel deployments reject it. SMS, buyer access, Commercial Change,
    staffing authority, and both Revenue Autopilot gates remain off. Firebase
    uses GitHub OIDC through the reviewed
    `FIREBASE_WORKLOAD_IDENTITY_PROVIDER` and
    `FIREBASE_DEPLOY_SERVICE_ACCOUNT` repository variables and rejects legacy
    token or static-key authentication. Its mutation client must be the
    repository-verified official v15.24.0 Linux artifact; Vercel retains its
    scoped token. The
    provider credential is available only to the final deploy step. Record
    provider acceptance/READY evidence and update the
    target-specific last-known-good receipt only after post-launch verification
    succeeds.
11. When a reviewed deployed release requires the operational-staffing tenant
    gate, dispatch `Set Operational Staffing Tenant` from current `main` only
    after the deployed tagged commit's matching Firebase `all` run succeeds.
    Bind the deployed release SHA and run id, use the exact
    state-and-organization confirmation, and retain verified readback. The
    workflow proves the semantic tag, exact deploy run, and both staffing
    bindings before its distinct least-privilege WIF identity changes the one
    existing tenant field. The PATCH carries `currentDocument.exists=true`, so
    the operator cannot convert its update into document creation. This
    reversible data mutation is separate from application deployment and
    operator-workflow publication. Workflow inputs remain mapped through step
    environment variables rather than interpolated into credential-bearing
    shell bodies. The organization input has no default and accepts only the
    existing bounded numeric form or `mm05366-sandbox`.

If Firebase and Vercel have different last-known-good SHAs, use separate
target-specific deployment runs. Allowed deployment profiles
are `firebase-hosting`, `firebase-backend`, `firebase-all`, and `vercel`;
there is no cross-provider `all` profile with an ambiguous rollback target.
Checklist applicability limits each receipt to the selected payload surface and
observed compatibility; it does not prove an unbound dependency's SHA or
provider identity. A `firebase-all` staging receipt must bind Hosting,
Functions, and Firestore rules together before that profile can be operational.
Candidate provider clients are fixed as part of this contract: all Firebase CLI
operations use the checksum-verified official v15.24.0 binary, Rules content
readback uses exact `google-auth-library` 10.5.0 ADC against the public API, and
Vercel preview uses a deterministic Build Output API v3 artifact plus narrow
REST upload/deploy/readback. Protected preview manifest reads use exactly one
existing automation-bypass credential returned by the fixed project preflight;
the credential remains memory-only and is never persisted in receipts or logs.
Missing or ambiguous bypass configuration stops before reservation. Both Rules
and Vercel project access are proven by read-only preflight before receipt
reservation or provider mutation. Runtime
`npx`, provider-client discovery, and Git-triggered Vercel deployment are not
valid release paths.

## Rollback Control
If a regression appears in production, use the target-specific signed
last-known-good provider receipt and provider-native rollback sequence in
`docs/LAUNCH_RUNBOOK.md`. Do not guess a rollback target during the incident.

## Doc Sync Rule
`docs/DOC_SYSTEM.md` is the canonical ownership matrix.
If a topic changes, only update the owning doc and cross-link from others.

## Production Interface Controls
- Production release profile: `release_profile`
  - `safe-off` remains the universal default and proves the email provider is
    `none` in Firebase Functions readback.
  - `email-active` is restricted to Firebase `backend`/`all`, materializes the
    approved Resend provider from the immutable dispatch profile, and requires
    every active Function to report that exact profile after deployment. The
    source allowlist and repository configuration must identify
    `QuotePilot by MBMApps <quotepilot@quietpilot.us>`, matching the verified
    `quietpilot.us` domain returned by the configured Resend account.
  - A new Secret Manager version, repository variable, source merge, or green
    deployment alone is not message-delivery evidence. One separately
    authorized controlled send must keep QuotePilot provider acceptance,
    Resend delivery/bounce, recipient inbox receipt, and human review distinct.
  - `all-qualified-features` is restricted to `firebase-all` and `vercel` and
    must be used for both targets when coordinating this release. It does not
    create a cross-provider rollback unit: each dispatch retains its own
    target-specific last-known-good ancestor and provider receipt. The profile
    is blocked unless the Inquiry Turnstile public key is reviewed and every
    required Firebase secret has an enabled metadata version. An enabled
    OpenAI key version does not prove usable provider credit or a successful
    model request.
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
    workflows. The v0.16.0 `safe-off` profile deliberately materializes
    `OPERATIONAL_STAFFING_AUTHORITY_ENABLED=false`, so the browser may explain
    staffing readiness without receiving server pricing/write authority. The
    trusted tenant setting, role checks, direct-browser denials, provider
    prerequisites, and immutable receipts remain independent. The
    `.env.example` local default for both presentation flags remains off.

## Orchestration References
- Blueprint: `docs/ORCHESTRATION_BLUEPRINT.md`
- Runbook: `docs/ORCHESTRATION_RUNBOOK.md`
- Product truth decision: `docs/adr/ADR-0002-product-truth-observability.md`
- Product truth design: `docs/design/product-truth-observability-design.md`
- Product truth work plan: `docs/plans/20260828-feature-product-truth-observability.md`

## Time-bound browser fixtures

Release-gate fixtures that represent active portal or provider-bound access must
derive their issuance and bounded expiry from the test execution clock. A fixed
historical issuance can cross QuotePilot's authoritative validity window and
silently turn an active-path test into an expired-path test. Explicit expiry
fixtures remain fixed and separate so terminal recovery behavior is still
deterministic. Changing fixture time does not change production validity policy.

Shared emulator seeders that can create Auth or Firestore records must fail
closed before Firebase Admin initialization unless the requested project uses
the `demo-*` namespace and every required emulator endpoint is loopback. Runner
configuration alone is not an adequate production-write boundary. These
seeders belong to a headless developer-infrastructure capability contract even
when their only functional change is test-fixture freshness.

## RagnaKoK workflow activation profile

The `ragnakok-workflows` profile is restricted to Firebase backend/all and the
exact approved runtime tenant `mm05366-sandbox` (brand `RagnaKoK Inc`). It retains
Resend, sets a tenant-scoped runtime override, and leaves global authority flags
off. The same exact-tag, main CI, protected environment, rollback and per-Function
readback gates apply. Other organizations cannot use the override. Hosting and
Vercel retain their safe-off deployment profile and include role/tenant-gated
workflow presentation. Follow [the activation and rollback procedure](LAUNCH_RUNBOOK.md#ragnakok-tenant-workflow-release)
only after successful backend deployment. Source publication is not activation
or policy publication.


RagnaKoK test access also admits operational staffing and Revenue Autopilot
preparation through the same exact-tenant runtime guard. The staffing tenant
setting remains required. Revenue policy configuration remains explicit; no
outreach policy is invented or published during activation. The global scheduler
receives no tenant scope and stays disabled, and the outbound-send gate stays
off. Other tenants cannot use these scoped authorities. Existing explicit
operator email actions retain their normal authorization and confirmations.
