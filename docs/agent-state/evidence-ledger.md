# Evidence Ledger

Last updated: 2026-08-28 20:46:47 CDT

Checkpoint recorded: 2026-08-29T01:46:47Z

## Current Git identity and reconciliation

- File/path: Git branch history; merge commit `0731ef26556b011c64904a103438bf326872b705`
- Evidence: `feature/landing-document-hero` is 72 commits ahead and 0 behind `origin/main` at `24b61cfd013c6c88130479faabd597e22af2e33d`. An isolated `-X ours` merge candidate was validated before the same merge was applied to the branch, preserving newer local conflicting hunks and accepting non-conflicting v0.15/Commercial Truth Loop additions. The real merge tree matched validated candidate tree `0da3d3c9f4629aa738e53f0a78fc04a0db17cb9f` exactly.
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
