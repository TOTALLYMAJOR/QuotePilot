# Evidence Ledger

Last updated: 2026-08-29 14:33:12 CDT

Checkpoint recorded: 2026-08-29T19:20:40.340Z

## Published candidate, exact CI, and deployment boundary

- File/path: Google Cloud project `tonicatering`; Workload Identity pool
  `quotepilot-github`; provider `quoteflow-main`; GitHub repository variables
- Evidence: The active provider admits only GitHub numeric owner `7169661`,
  numeric private repository `1167899098`, `refs/heads/main`, manual workflow
  dispatch, and the two exact production Firebase and staffing-tenant workflow
  refs. A mapped workflow attribute gives each workflow access only to its own
  keyless service account. The Firebase deployer has Cloud Functions Admin,
  Firebase Hosting Admin, Firebase Rules Admin, Datastore Index Admin, Secret
  Manager Viewer, Service Usage Consumer, and act-as only on the existing App
  Engine runtime service account. The staffing operator has a project custom
  role containing only `datastore.entities.get` and
  `datastore.entities.update`. The three required repository variables now
  exist. No service-account key was created.
- Why it matters: Protected production deploy and exact staffing-tenant
  operations now have distinct short-lived identities with repository,
  branch, event, and workflow trust fences.
- Confidence: High for provider and IAM readback plus repository variable-name
  readback.
- Unverified gaps: First workflow token exchange, effective Firebase deploy
  permission completeness, production deployment, tenant operation, rollback,
  and legacy-secret retirement.

- File/path: Firebase Auth and Firestore production readback; canonical
  `migrate:multi-tenant` dry run for organization `250`
- Evidence: The designated admin and sales/operator accounts both exist,
  are verified, enabled Firebase Auth users. The final release/UAT email has no
  Firebase Auth account and no discoverable GitHub user binding. Organization
  `250` and its `settings/config` document do not exist. The designated admin
  currently owns and holds admin role in `mm05366-sandbox`; the second account
  currently has customer role with no organization. Repository variable
  `VITE_DEFAULT_ORGANIZATION_ID` is `250`. A read-only canonical migration plan
  would create organization `250`, one settings document, 3 event types, 41
  menu categories, 373 menu items, 3 packages, 3 add-ons, 2 rentals, 25 quotes,
  and 15 quote versions from the legacy global source, with no portal patches.
- Why it matters: Tenant `250` is the intended production default, but
  activation cannot precede complete data provisioning and an explicit choice
  about transferring the existing sandbox owner identity; a sparse settings
  patch would be unsafe.
- Confidence: High for exact provider reads and dry-run counts.
- Unverified gaps: Migration apply, owner transfer/tombstone policy for the
  sandbox, sales-role mutation receipt, custom-claim synchronization, hosted
  login, and human acceptance.

- File/path: Branch `security/extract-zip-backport` at `204f0d2eefd72a8f2d41a6fbb4e7ec6728bd454c`; PR #112; CI runs `33246642372`, `33246642371`, and `33246642373`
- Evidence: The branch is clean, published, open, and mergeable. The narrow backport removes `extract-zip` from the resolved development graph through the Lighthouse 13.4.1 override; local package-lock install, clean install, root audit, 4,007 unit tests, 505-module build, docs governance, environment check, and unchanged CWV gate pass. Exact-head CI Quality run `33246642372` passes all eight jobs; both Stripe source-only workflows pass. No merge, default-branch change, alert closure, product deployment, or provider mutation occurred.
- Why it matters: The current production branch can receive the known security remediation independently of the blocked product release, without representing branch proof as default-branch or production proof.
- Confidence: High for exact Git/PR/CI identity and local dependency/validation results.
- Unverified gaps: Human review, merge to `main`, Dependabot alert closure, and any downstream exact-main validation.

- File/path: Branch `release/v0.16.0` at `8b04582c371f8ccc5a4b5010c9a9800c0e68bfe0`; PR #111; CI runs `33247137753`, `33247137681`, and `33247137700`; fixed provider preflights
- Evidence: Fresh fetch proves local HEAD equals the published branch, `origin/main` remains `d40ec929e5d70142683966e872b6f91b4a508cad`, and PR #111 is open and mergeable with every current check green. CI Quality passed all eight required jobs plus Product Truth advisory; both Stripe source-only checks passed. The Firebase and Vercel candidate commands were repeated for exact `8b04582` with CI run `33247137753`; both again stopped before receipt reservation or provider mutation on the same eleven missing enabled staging secret versions and unproven Commercial Change false readback. No candidate evidence artifact or working-tree change was produced.
- Why it matters: The release boundary is current external evidence, not a stale inference from the preceding code-bearing commit.
- Confidence: High for exact Git, GitHub, Firebase metadata/readback, and fail-before-mutation behavior.
- Unverified gaps: Secret authorization/creation, ADC Rules access, Firebase/Vercel deployment, hosted behavior, provider outcomes, production, and human acceptance.

- File/path: GitHub repository variables/branch protection; production Google Cloud project `tonicatering`
- Evidence: Required WIF variables are absent; no workload identity pool or matching deploy/tenant service account was returned; legacy `FIREBASE_TOKEN` remains named. Branch protection requires all eight CI jobs but zero approving reviews. Release variables set `RELEASE_APPROVAL_MODE=solo-operator` with one attester/operator id.
- Why it matters: Green CI and mergeability do not establish deploy credentials, independent review, or human UAT. The exact owner decision is whether to retain governed solo operation or add an enforceable independent reviewer boundary.
- Confidence: High for current read-only provider and repository configuration-name evidence.
- Unverified gaps: Human ownership, reviewed IAM design/apply, environment protection reviewers, authenticated operator identity, and acceptance execution.

- File/path: GitHub Dependabot alert #139; `origin/main:package-lock.json`; candidate `package-lock.json`
- Evidence: Alert #139 is open at high severity for development-scope `extract-zip` symlink path traversal on the default branch. `origin/main` still references `extract-zip`; the release candidate does not, its root audit is clean, and exact remote CWV passes.
- Why it matters: Candidate remediation is real but does not close default-branch exposure until merged or separately backported.
- Confidence: High for alert metadata and exact lockfile comparison.
- Unverified gaps: GitHub alert closure after the remediation reaches `main`.

- File/path: Release PR #111; branch `release/v0.16.0`; code-bearing candidate `e620ce80f096033abfdc420e649499f4ed92dff1`
- Evidence: Stripe Connect onboarding run `33245272566` and infrastructure run `33245272601` completed successfully for the exact candidate; CI Quality run `33245272679` passed all eight matching main-lane jobs. The clean local candidate passes 364 test files with 3 skipped, 4,099 tests with 78 skipped, a 503-module build, 127 Truth Loop tests, and the full governed release lane.
- Why it matters: Release-control hardening is evaluated on one exact published source identity rather than being inferred from earlier candidate receipts.
- Confidence: High for Git, local validation, and the named remote receipts.
- Unverified gaps: Deployment, cloud identity configuration, hosted behavior, provider outcome, production data, human acceptance, use, and outcome remain separate.

- File/path: `.github/workflows/deploy-firebase-hosting.yml`; `.github/workflows/set-operational-staffing-tenant.yml`; `scripts/deploy-firebase-production.mjs`; `scripts/set-operational-staffing-tenant.mjs`
- Evidence: Production deploy and tenant-gate source reject `FIREBASE_TOKEN` and service-account keys. Both use commit-pinned Google authentication with one provider and distinct deploy/tenant-operator repository variables; the tenant path requests only a short-lived Datastore-scoped token for its exact read/patch/readback step. Production-project inspection found no workload identity pool or matching service accounts, the required repository variables are absent, and the legacy secret name remains configured.
- Why it matters: Source is prepared for keyless least privilege, but production cannot be honestly called deploy-ready until external IAM and repository configuration are reviewed and proven.
- Confidence: High for source, read-only cloud inventory, and GitHub configuration-name evidence.
- Unverified gaps: Approved IAM plan, created pool/provider, service-account bindings, variable values, governed deploy receipt, tenant rollback/readback, and safe legacy-secret retirement.

- File/path: `scripts/firebase-tools-binary.mjs`; `scripts/deploy-release-candidate.mjs`; `src/lib/__tests__/releaseCandidateDeployment.test.js`; `package.json`; `package-lock.json`
- Evidence: Firebase mutation, Web config, Functions, Hosting, and secret-metadata reads resolve the official v15.24.0 Linux release artifact, verify SHA-256 `bf964987f095a5fb991cf1c709f640526a4e1b4f9eb1f271f5c09bc693263d33`, revalidate cached bytes, and execute only the verified path. Rules release/source readback uses the public Rules API through exact `google-auth-library` 10.5.0 and ADC. Vercel preview creates a deterministic Build Output API v3 artifact, hashes and uploads unique regular-file bytes, creates the preview, polls the exact deployment, and verifies immutable host/project plus the hosted candidate manifest through narrow REST calls. Source contains no `npx`, runtime Firebase-module search, or runtime Vercel CLI. Focused deployment tests pass 17/17; root audit has zero findings.
- Why it matters: Every candidate provider client is explicit, pinned, and testable; read-only access and safe-off proof fail before receipt reservation or provider mutation.
- Confidence: High for source, focused/full validation, real Firebase artifact verification, audit output, and exact-SHA remote CI.
- Unverified gaps: Successful provider authentication, staging deployment/readback, Vercel upload/deployment, hosted behavior, and human acceptance remain external.

- File/path: Release PR #111; branch `release/v0.16.0`; CI runs `33240762183`, `33240762176`, and `33240762182`
- Evidence: Exact candidate `7f6d40bec472a82ce6e0b9ead063410a23ca154b` is clean and published. CI Quality passed all eight jobs. The dedicated Ambient route-handoff journey and production flag matrix passed; both bundle graphs, Firebase auth/rules, authoritative pricing, Core Web Vitals, Docker, and Product Truth Digest passed. Stripe Connect onboarding and infrastructure source-only workflows passed without provider action.
- Why it matters: The assembled product candidate has immutable remote source/CI proof and the prior Ambient test and budget drift are repaired without weakening dormant capability boundaries.
- Confidence: High for exact Git and CI evidence.
- Unverified gaps: Hosted candidates, production, tenant/provider behavior, physical devices, human acceptance, use, and outcomes remain separate.

- File/path: `scripts/deploy-release-candidate.mjs`; governed Firebase candidate attempt at exact `e620ce80f096033abfdc420e649499f4ed92dff1`
- Evidence: With `GITHUB_TOKEN` and `GH_TOKEN` explicitly unset, the authenticated local GitHub CLI verified exact green run `33245272679`; the verified Firebase binary then read secret metadata and rejected the candidate before receipt reservation or provider mutation. No enabled staging version exists for `BUYER_ACCESS_RATE_LIMIT_SECRET`, `BUYER_ACCESS_STRIPE_SECRET_KEY`, `BUYER_ACCESS_STRIPE_WEBHOOK_SECRET`, `BUYER_ACCESS_TURNSTILE_SECRET`, `RESEND_API_KEY`, `RESEND_WEBHOOK_SECRET`, `REVENUE_AUTOPILOT_TOKEN_SECRET`, `STAFF_INVITATION_TOKEN_SECRET`, `STRIPE_SECRET_KEY`, `STRIPE_WEBHOOK_SECRET`, or `TWILIO_AUTH_TOKEN`. The command did not create or inspect values, and no evidence artifact or working-tree change was produced.
- Why it matters: Firebase staging remains fail-closed at the exact provider prerequisite boundary; absence is recorded precisely rather than compressed into one stale secret claim.
- Confidence: High; the live failure occurred in the prerequisite sequence before reservation and mutation.
- Unverified gaps: Secret-creation authorization, enabled-version receipts, ADC Rules permission, Firebase candidate deploy, Functions/rules/Hosting readback, and hosted UAT.

- File/path: `scripts/deploy-release-candidate.mjs`; governed Vercel preview attempt at exact `e620ce80f096033abfdc420e649499f4ed92dff1`
- Evidence: Exact CI and workspace verification passed through the locked clients, then the command stopped before Vercel access, receipt reservation, upload, or deployment because the staging `us-central1/acceptQuoteProposal` Functions readback does not prove `COMMERCIAL_CHANGE_AUTHORITY_ENABLED=false`. No evidence artifact or working-tree change was produced.
- Why it matters: Vercel preview correctly depends on a safe-off staging backend and cannot be promoted independently against unqualified Functions state.
- Confidence: High; the failure is a deterministic prerequisite rejection before the deploy path.
- Unverified gaps: Exact Firebase staging deployment/readback, Vercel preview receipt, preview reachability, and hosted/human UAT.

## v0.16.0 release inventory and qualification

- File/path: Git range `origin/main..303eec5237d143fc11398e23f24e86fcb28c2655`; `docs/RELEASE_V0_16_PROMOTION_REPORT.md`
- Evidence: The unpublished range contains 74 commits changing 180 files: 12,313 insertions, 1,030 deletions, net +11,283. Cohorts are 52 runtime files (+3,255/-511), 55 test files (+3,388/-54), 50 docs (+4,335/-434), 8 tooling files (+1,151/-3), and 13 other files (+184/-28); two changes are binary brand assets.
- Why it matters: The owner can evaluate release size and capability breadth without confusing gross repository work with runtime code alone.
- Confidence: High; exact Git range and numstat classification from the fresh, zero-behind branch.
- Unverified gaps: This baseline inventory predates later release-control hardening; current remote identity and CI are recorded above.

- File/path: Complete repository; release-manager high-risk plus CWV profile
- Evidence: Environment, secrets, project state, workflow, Ambient, Connect isolation, capability surfaces, documentation governance, build, bundle, Truth Loop, Firestore rules, owner-SMS emulator, Firebase authenticated/rules browser, authoritative pricing browser, and Lighthouse/CWV gates pass. Unit results are 363 files passed/3 skipped and 4,091 tests passed/78 skipped; Truth Loop has 127 passes; Firestore rules has 76 passes; authoritative pricing has 3 passes; the build contains 503 modules.
- Why it matters: The complete candidate is locally qualified for remote release-candidate evaluation.
- Confidence: High for source/local evidence.
- Unverified gaps: CI, hosted, provider, production-data, human, use, and outcome proof remain distinct.

- File/path: `scripts/release-uat-plan.mjs`; Firebase-all and Vercel `staging-safe-off` plans
- Evidence: Firebase-all classifies 17 items applicable and 21 blocked; Vercel preview classifies 11 applicable and 7 blocked. Buyer, portal positive paths, payment/provider paths, authoritative staffing, and related external evidence are among the blocked groups.
- Why it matters: A safe candidate may be deployed for bounded review, but the partial plan cannot qualify production or be mislabeled as full UAT.
- Confidence: High; deterministic tracked planner output.
- Unverified gaps: Applicable items have not yet been executed against immutable hosted candidates.

## Current Git identity and reconciliation

- File/path: Git branch history; merge commit `0731ef26556b011c64904a103438bf326872b705`
- Evidence: A fresh `git fetch origin main` left `origin/main` at `d40ec929e5d70142683966e872b6f91b4a508cad`. At completion-audit base `8c8ea0d2f9bda6c00580e4fc6bbf768eacd76204`, `feature/landing-document-hero` is 73 commits ahead and 0 behind, and `origin/main` is an ancestor. An isolated `-X ours` merge candidate was validated before the same merge was applied to the branch, preserving newer local conflicting hunks and accepting non-conflicting v0.15/Commercial Truth Loop additions. The real merge tree matched validated candidate tree `0da3d3c9f4629aa738e53f0a78fc04a0db17cb9f` exactly.
- Why it matters: The local product stack is no longer based on a stale mainline and did not silently lose the newer local implementation during reconciliation.
- Confidence: High; exact Git identities, ancestry, divergence, and tree equality were checked locally.
- Unverified gaps: The branch has not been pushed, reviewed in a remote pull request, or exercised by hosted CI after this reconciliation.

## Exact release-candidate validation

- File/path: Complete repository at candidate tree `a1219853194e63721953aa065b1d65ae8fb3f154`
- Evidence: `npm run lane:release` passed 363 JavaScript test files with 3 skipped, 4,091 tests with 78 skipped, a 501-module Vite build, 127 Truth Loop tests, project-state, environment, secret, Ambient release, Stripe Connect isolation, workflow, capability-surfacing, documentation-governance, and bundle-budget gates.
- Why it matters: The final product/docs state was validated as one immutable tree rather than inferred from separately successful dirty-worktree commands.
- Confidence: High for local source and deterministic gates.
- Unverified gaps: Hosted CI, deployment providers, production data, and human acceptance remain outside local validation.

## Product truth and current release identity

- File/path: `PROJECT_STATUS.md`, `docs/FEATURE_MATRIX.md`, `CHANGELOG.md`; commit `24b61cfd013c6c88130479faabd597e22af2e33d`
- Evidence: Current production now consistently resolves to exact `v0.15.0` with governed CI run `32817744859`, Vercel run `32819363438`, and Firebase run `32818605404`. Retained v0.7 evidence is labeled historical/superseded. On a clean exact candidate, both `npm run status:product` and `npm run check:product-drift` reported resolved release v0.15.0 and `Drift: none`.
- Why it matters: A maintainer receives one current operational claim while preserving older receipts as history rather than contradictory runtime truth.
- Confidence: High for canonical repository claims and local reconciliation behavior.
- Unverified gaps: Reachability probes were disabled; no new hosted, provider, production-data, human, or outcome evidence was generated.

## Completion audit and canonical drift correction

- File/path: `DEV_TASKS.md`, `docs/FEATURE_MATRIX.md`, `docs/agent-state/*`; completion-audit candidate based on `8c8ea0d`
- Evidence: The audit removed stale dirty-worktree and 72-commit claims, preserved the clean v0.15/no-drift result, and reconciled the owner-SMS row with the governed deployment receipt: Pingram is selected in exact v0.15, while endpoint registration, credentials, provider acceptance, delivery, recipient receipt, and human acceptance remain unverified. The exact candidate passes the release manager's high-risk plus CWV readiness profile.
- Validation notes: Direct wrapper execution exited `126` because the tracked script is not executable. The first `bash` invocation stopped at `check:env` because the isolated worktree had no ignored local Firebase env files. After binding the existing ignored root env files by symlink without reading their values, the full run passed 363 test files / 4,091 tests, a 503-module build, 127 Truth Loop tests, both high-risk emulator lanes, and Lighthouse/CWV. During emulator discovery, Firebase attempted read-only Secret Manager lookups for the fake `demo-e2e` project; every lookup returned `403`, no secret was accessed, and the fail-closed emulator tests still passed. No provider send or production/provider mutation occurred.
- Why it matters: The durable handoff and active execution map now describe the actual committed branch and do not instruct a future operator to overwrite a deployed selection with stale `none` guidance.
- Confidence: High for local Git identity, canonical repository consistency, and deterministic validation.
- Unverified gaps: The branch remains local; remote CI, deployment, provider behavior, production data, and human acceptance were not exercised.

## Product Truth Observability control plane

- File/path: `scripts/product-truth-observability.mjs`, `docs/adr/ADR-0002-product-truth-observability.md`, `docs/design/product-truth-observability-design.md`, `docs/plans/20260828-feature-product-truth-observability.md`, `PROJECT_STATUS.md`
- Evidence: The read-only compiler reconciles Git identity/divergence, canonical production claims, capability inventory, local evidence coverage, optional reachability, stable drift findings, and owner decisions. The status command reports drift without failing; the gate fails closed for blocking conflicts. The Truth Loop coverage example now supplies `--source` and `--evaluated-at`; the bare command intentionally refuses to infer evidence inputs.
- Why it matters: Repository, release, provider, production, human, and outcome evidence remain distinct instead of being collapsed into a misleading readiness score.
- Confidence: High for local compiler contracts and current clean-candidate output.
- Unverified gaps: CI observation, owner comprehension review, freshness calibration, and promotion from advisory to required gate are human/external decisions.

## Beta-critical onboarding and guided creation

- File/path: commits `da69313` (first-quote state), `8d01fc4` (intentional portal decision), `a0528c3` (CREATE intake), and their source/tests/docs
- Evidence: Zero saved quotes routes users to one existing `Start a quote` action; fresh customer proposal rooms require an intentional response before response-specific controls appear; deterministic intake compresses after apply, preserves reversible source review, and does not replace server pricing or ordinary save authority. Focused real-route journeys and each slice's exact full release candidate passed before commit.
- Why it matters: A first-time beta user now receives a discoverable start, bounded guidance, and explicit decision semantics instead of a generic empty panel or prematurely active controls.
- Confidence: High for source/local UI behavior and automated browser coverage.
- Unverified gaps: Hosted authentication, real tenant catalogs/data/latency, comprehension, and human acceptance.

## Connected arrivals, recovery, and responsive evidence

- File/path: commits `52eb60c`, `b3cb478`, `e7f2522`, `abf6173`, `56c6fae`; connected-arrival/accessibility matrix and focused browser/unit tests
- Evidence: Recovery leads with outcomes and safe next actions; exact connected arrivals preserve identity and do not substitute nearby records; long inspectors collapse repeated explanation without removing evidence; `/app/clients` aliases the existing customer authority; mobile priority uses a bounded suggested view. Connected Firebase arrival E2E passed 3 tests. Responsive inspector journeys and the complete release lane passed before their commits.
- Why it matters: Beta users can recover from unavailable or exact-link states without raw provider errors, false freshness, duplicated explanation, or a second client data source.
- Confidence: High for source/local semantics, emulator-connected identity, responsive containment, and automated accessibility.
- Unverified gaps: Hosted role/data behavior, production latency, manual assistive technology, and human acceptance.

## Landing hero performance stability

- File/path: `src/styles.css`, `scripts/run-lighthouse-cwv.sh`, `docs/PERFORMANCE_GUARDRAILS.md`; commit `c0a8164`
- Evidence: The first exact candidate reproduced mobile CLS `0.254095` from remote webfont swap. Metric-compatible local fallback faces and OS temp routing reduced exact-candidate CLS to `0.05533371896494158`; Lighthouse performance was `0.89`, LCP `2955.783 ms`, and TBT `0 ms`. Four landing-page Playwright tests and the full release lane passed.
- Why it matters: The marketing entry no longer visibly jumps beyond the governed CLS threshold while webfonts resolve.
- Confidence: High for the measured local candidate and identified causal geometry change.
- Unverified gaps: Real-user field data and post-deployment production monitoring.

## Stripe Connect stopping point

- File/path: `docs/STRIPE_CONNECT_PROGRAM.md`, `docs/FEATURE_MATRIX.md` row 65, `PROJECT_STATUS.md`, `functions-connect/`, `infra/stripe-connect/`
- Evidence: Repository foundation, infrastructure contracts, onboarding controls, replay-stable command bridge, quarantined provider identity handling, and read-only staging inventory are present. The release lane confirms the foundation remains isolated, deploy-empty, exactly pinned, and provider-disabled. `functions-connect/index.js` exports no runtime handlers.
- Why it matters: Connect is a mapped capability and its remaining `Partial` status truthfully represents external activation work, not a forgotten source slice.
- Confidence: High for repository preparation and non-activation.
- Unverified gaps: Reviewed Terraform plan/digest, explicit apply authorization, deployed identity reconciliation, App Check observation/promotion, restricted Sandbox credential, runtime exports, Stripe execution, hosted UAT, and human acceptance.

## Steward stopping point

- File/path: `docs/STEWARD_WORK_PLAN.md`, `docs/FEATURE_MATRIX.md` row 71, `PROJECT_STATUS.md`, Steward compiler/policy/tests/workbench
- Evidence: The deploy-dormant compiler, policy and validation controls, consent/evaluation contracts, synthetic corpus, hidden-output workbench, disabled handoff, and manual recovery route are repository-complete before private runtime. Runtime imports/exports, configured provider transport, model-output UI, customer send, and autonomous authority remain absent.
- Why it matters: Remaining `Partial` status records real provider/privacy/billing/human-review boundaries rather than an invitation to create an unsafe placeholder runtime.
- Confidence: High for source/local controls and dormancy.
- Unverified gaps: Provider/credential and privacy/billing review, canonical private context/persistence, current consent, controlled silent pilot, 100 human packet reviews, hosted rules, deployment, and acceptance.

## Commercial Truth Loop imported from v0.15 base

- File/path: `truthloop/`, `evidence/`, `.project/`, `PROJECT_STATE.md`; merge commit `0731ef2`
- Evidence: Project-state check reports 11 capabilities, 7 blockers, 1 proof event, and 5 commercial evidence records. All 127 standard-library Truth Loop tests pass. Coverage generation requires explicit source and evaluation time and performs no inferred evidence selection.
- Why it matters: Commercial evidence can be evaluated deterministically without turning missing provider/payout/consumption inputs into invented operational truth.
- Confidence: High for imported source, contracts, tests, and current project-state validation.
- Unverified gaps: A production-authorized evidence source, evaluation instant, runtime execution receipt, and owner interpretation are not supplied locally.
