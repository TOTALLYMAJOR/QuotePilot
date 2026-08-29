# Evidence Ledger

Last updated: 2026-08-29 02:05:00 CDT

Checkpoint recorded: 2026-08-29T07:05:00Z

## Published candidate, exact CI, and deployment boundary

- File/path: Release PR #111; branch `release/v0.16.0`; CI runs `33239568701`, `33239568718`, and `33239568653`
- Evidence: Exact parent `55d37faa1cb266137f156037626c3266f71035f2` is clean and published. CI Quality passed all eight jobs. The dedicated Ambient route-handoff journey passed 1 of 1; the production flag matrix passed 2 of 2; compatibility measured 3,210,757 / 384,998 bytes in the production-profile job and Ambient measured 3,928,479 / 388,269 against ceilings 3,213,578 / 391,901 and 3,928,552 / 391,901. Stripe Connect onboarding and infrastructure source-only workflows passed without provider action.
- Why it matters: The assembled product candidate has immutable remote source/CI proof and the prior Ambient test and budget drift are repaired without weakening dormant capability boundaries.
- Confidence: High for exact Git and CI evidence.
- Unverified gaps: Hosted candidates, production, tenant/provider behavior, physical devices, human acceptance, use, and outcomes remain separate.

- File/path: `scripts/deploy-release-candidate.mjs`; governed Firebase candidate attempt
- Evidence: The first invocation without a GitHub token stopped at the read-only CI lookup with HTTP 404. Re-running with the existing authenticated CLI token cleared CI verification, then stopped before receipt reservation or provider mutation because staging Secret Manager has no enabled `STAFF_INVITATION_TOKEN_SECRET`. The command explicitly refuses to create or inspect secret values.
- Why it matters: Firebase staging is not deployable until a separately authorized, non-provider placeholder exists; no deployment or secret mutation occurred.
- Confidence: High; failure happened in the prerequisite sequence before reservation and mutation.
- Unverified gaps: Secret creation authorization, enabled-version receipt, Firebase candidate deploy, Functions/rules/Hosting readback, and hosted UAT.

- File/path: `scripts/deploy-release-candidate.mjs`; governed Vercel preview attempt
- Evidence: Exact CI and workspace verification passed, then the command stopped before receipt reservation or provider mutation because the staging `us-central1/acceptQuoteProposal` Functions readback does not prove `COMMERCIAL_CHANGE_AUTHORITY_ENABLED=false`.
- Why it matters: Vercel preview correctly depends on a safe-off staging backend and cannot be promoted independently against unqualified Functions state.
- Confidence: High; the failure is a deterministic prerequisite rejection before the deploy path.
- Unverified gaps: Exact Firebase staging deployment/readback, Vercel preview receipt, preview reachability, and hosted/human UAT.

## v0.16.0 release inventory and qualification

- File/path: Git range `origin/main..303eec5237d143fc11398e23f24e86fcb28c2655`; `docs/RELEASE_V0_16_PROMOTION_REPORT.md`
- Evidence: The unpublished range contains 74 commits changing 180 files: 12,313 insertions, 1,030 deletions, net +11,283. Cohorts are 52 runtime files (+3,255/-511), 55 test files (+3,388/-54), 50 docs (+4,335/-434), 8 tooling files (+1,151/-3), and 13 other files (+184/-28); two changes are binary brand assets.
- Why it matters: The owner can evaluate release size and capability breadth without confusing gross repository work with runtime code alone.
- Confidence: High; exact Git range and numstat classification from the fresh, zero-behind branch.
- Unverified gaps: Remote release-branch SHA, pull request, and CI do not exist yet.

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
