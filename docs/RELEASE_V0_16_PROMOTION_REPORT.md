# QuotePilot v0.16.0 Promotion Report

Last updated: 2026-09-01 15:31:09 CDT

This is a point-in-time release decision record. Capability truth remains in
[`FEATURE_MATRIX.md`](FEATURE_MATRIX.md), current operational truth remains in
[`../PROJECT_STATUS.md`](../PROJECT_STATUS.md), and executable remaining work
remains in [`../DEV_TASKS.md`](../DEV_TASKS.md).

## Candidate Summary

- On 2026-09-01 the owner authorized the fail-closed `safe-off` production
  profile. It is now an exact workflow/evidence input for both production
  providers. The profile includes the Business Setup and Ambient presentation
  but holds public buyer entry, outbound email/SMS, Commercial Change, Revenue
  Autopilot, and server-authoritative staffing off. It does not disable the
  established live quote-payment Stripe rail. Focused release-control coverage
  passes 283 tests; full qualification and every remote/provider gate below
  still must pass before production can be claimed.

- Comparison range: `origin/main..303eec5237d143fc11398e23f24e86fcb28c2655`.
- Unpublished commits: 74.
- Files changed: 180 total; 178 text files and 2 binary brand assets.
- Text change volume: 12,313 insertions, 1,030 deletions, net +11,283 lines.
- Intended release: `v0.16.0`, assembled on `release/v0.16.0` from current
  `origin/main`. The 74-commit figures above are the original unpublished
  product-stack baseline; later commits on the release branch are bounded
  release-control hardening and do not rewrite that inventory.
- Pre-reconciliation published head
  `ed228c1e84218eabaa8b859378d84f5e2339c17b` passed all eight CI jobs in run
  `33280654199`. The verified Firebase `staging-staffing-authority` deployment
  remains bound to earlier exact head `17582da99ae9ace1ec6fb11fe224336faaf75410`.
  Current `main` then added the protected founder-pilot activation and receipt
  commits. PR #111 is being reconciled with those commits and requires a fresh
  exact-head CI result plus a new same-SHA candidate deployment before hosted
  UI judgment.
- Current production and rollback baseline: exact `v0.15.0`; target-specific
  provider receipts in `PROJECT_STATUS.md` remain authoritative until a newer
  promotion passes post-deploy verification.

| Cohort | Files | Insertions | Deletions | Net |
|---|---:|---:|---:|---:|
| Runtime product code | 52 | 3,255 | 511 | +2,744 |
| Tests | 55 | 3,388 | 54 | +3,334 |
| Product, architecture, and operating docs | 50 | 4,335 | 434 | +3,901 |
| Release/tooling controls | 8 | 1,151 | 3 | +1,148 |
| Other repository files | 13 | 184 | 28 | +156 |

## Capabilities Included in the Candidate

The following cohorts are suitable for bounded candidate promotion because
their source/local contracts pass the governed release lane. Promotion does
not by itself establish tenant activation, provider outcome, production-data
correctness, use, or human acceptance.

- Proposal Composer/control-room foundation, proposal branding and saved
  commercial snapshots, and mobile editing containment.
- Package Workspace MVP, catalog onboarding, starter-choice recovery, and
  dependency-aware package administration.
- Modernized staff and customer commercial workspaces, first-quote recovery,
  guided CREATE intake, and intentional portal decisions.
- Ambient workspace presentation, exact Payment/Proposal/Conversation
  arrivals, responsive inspectors, and release-qualification contracts.
- Attendance evidence/read model connected to opportunity context without
  changing the authoritative commercial guest-count basis.
- Safer portal, quote, workflow, and unavailable-state recovery.
- Installable PWA recovery shell with a deliberately non-authoritative offline
  boundary.
- Operations Audit receipts and bounded admin projection.
- Product Truth Observability, advisory drift detection, task orchestration,
  release UAT planning, capability surfacing, and evidence governance.
- Bundle/webfont performance work and Firebase `functions.config()` source
  migration.
- Deploy-dormant Steward and Stripe Connect foundations described below.

## Included but Not Ready for Runtime Activation

| Capability | Candidate treatment | Why activation is held |
|---|---|---|
| Stripe Connect | Include source, keep `functions-connect` exports empty and provider access disabled | Requires reviewed Terraform plan/digest, separately authorized apply, deployed identity reconciliation, App Check observation/enforcement, restricted Sandbox credential, hosted negative/replay UAT, and human acceptance. |
| Steward | Include validation/compiler/workbench foundation, keep provider runtime and model output unavailable | Requires provider/credential and privacy/billing review, canonical private reads/persistence, current consent, controlled silent execution, 100 actual human reviews, hosted rules proof, and acceptance. |
| Buyer onboarding/access | Keep server gate and public CTA off in the safe candidate | Dedicated restricted Stripe test key, exact test webhook, Turnstile/provider checks, bounded acceptance window, and close plan remain external. |
| Operational staffing authority | Preserve `staging-safe-off`; use the separate positive profile only for isolated staffing qualification | Production v0.15 tenant activation is verified for `mm05366-sandbox`; v0.16 still requires same-SHA candidate dispatch, authenticated hosted UAT, rollback rehearsal, production deployment, and final founder judgment. Tenant `250` will not be created. |
| Commercial Change and Revenue Autopilot | Keep authority/send gates off | Authenticated/provider evidence and named rollback remain incomplete. |
| SMS delivery | Preserve deployed configuration boundaries; do not infer delivery | Credential/endpoint registration, controlled send, provider lifecycle, opt-out, carrier, and recipient evidence remain separate. |
| Attendance persistence | Promote the read-only context only | Terminology/channel research and authority/migration decisions are unresolved. |

## Validation Evidence

- Environment, secret, project-state, workflow, Ambient release, Stripe
  isolation, capability-surfacing, and documentation-governance checks passed.
- Current full release lane: 364 files passed and 3 skipped; 4,099 tests passed
  and 78 skipped.
- Truth Loop: 127 tests passed.
- Vite production build passed with 503 modules.
- Bundle budget passed: 3,208,389 bytes total and 384,998 bytes largest asset,
  within the active temporary ceilings of 3,213,578 and 391,901 bytes.
- The exact-SHA production-equivalent Ambient build measured 3,928,479 /
  388,269 bytes in CI and 3,928,552 / 388,303 bytes in a CI-equivalent local
  rebuild. The Ambient aggregate exception is reconciled to the larger literal
  result with no discretionary growth headroom; a fresh exact-SHA CI pass is
  required before candidate deployment.
- Firestore rules: 76 tests passed.
- Owner-SMS emulator and full Firebase authenticated/rules browser lanes passed.
- Authoritative pricing browser lane: 3 tests passed.
- Lighthouse/Core Web Vitals gate passed.
- Documentation timestamps were advanced after the first governance run
  correctly rejected seven changed canonical/checkpoint documents.

These are local/source results. The exact remote receipts below establish CI
only; hosted candidates, production, provider, tenant, physical-device, and
human results remain separate.

## Promotion Execution Status

- Release branch `release/v0.16.0` is published in PR #111. Exact code-bearing
  candidate `e620ce80f096033abfdc420e649499f4ed92dff1` has successful Stripe
  Connect onboarding run `33245272566` and infrastructure run `33245272601`;
  both are source-only dormant contracts with no credential use, provider call,
  Terraform plan/apply, export, or deployment. Exact matching CI Quality run
  `33245272679` passed all eight required jobs.
- Positive staffing control is published through exact `5a0c55e`. CI Quality
  runs `33271755281`, `33272292112`, and `33272856057` each passed all eight
  jobs for their corresponding immutable heads; both Stripe source-only
  workflows also passed for each head.
- Latest validated release head `8b04582c371f8ccc5a4b5010c9a9800c0e68bfe0`
  is clean, matches the published branch, and is mergeable. Exact-head CI
  Quality run `33247137753` passed all eight required jobs and the Product
  Truth advisory; Stripe Connect source-only runs `33247137681` and
  `33247137700` also passed.
- Five bounded release-control commits follow the original inventory:
  Lighthouse dependency remediation (`60b0b119`), production Firebase WIF
  enforcement (`49fe2a7e`), distinct least-privilege tenant-operation WIF
  enforcement (`5dad0467`), checksum-verified Firebase mutation tooling
  (`a096d20c`), and locked candidate provider clients (`e620ce80`). Each passed
  its exact remote CI before the next slice was
  published; the final code-bearing candidate also passes the full local
  release lane.
- Production and tenant workflows no longer accept `FIREBASE_TOKEN` or a
  service-account key. They require GitHub OIDC/WIF with separate deploy and
  tenant-operator identities. Firebase production and candidate mutation use
  the official v15.24.0 Linux binary only after SHA-256 verification.
- Candidate provider-client locking is repository-complete: Firebase Web
  config, Functions, Hosting, secret metadata, and mutation all execute through
  the verified binary; Rules content is read from the public Firebase Rules API
  through exact `google-auth-library` 10.5.0 ADC; Vercel preview uses a
  deterministic Build Output API v3 artifact and narrow REST
  upload/deploy/readback. The candidate command contains no `npx`, local/global
  Firebase-module search, or runtime-resolved Vercel CLI. The added dependency
  graph audits at zero findings. Hosted execution remains unproven.
- The owner-authorized staging prerequisite pass created enabled staging-only
  versions for the four names that remained absent or were newly discovered as
  bound Functions secrets: `STAFF_INVITATION_TOKEN_SECRET`, `PINGRAM_API_KEY`,
  `PINGRAM_WEBHOOK_SECRET`, and `SMS_CONTACT_DIGEST_SECRET`. Values were random,
  were not printed or committed, and do not activate SMS or another provider;
  all corresponding runtime authorities remain off.
- Three later positive-profile candidate attempts failed at distinct boundaries.
  Exact `178e1bf` and `50c044f` stopped before receipt reservation on Firebase
  secret-response parsing and Rules quota-project handling, respectively.
  Exact `5a0c55e` passed preflight and reserved a receipt, then Firebase Functions
  analysis failed before deployment on an Admin/JWKS ESM incompatibility. Its
  receipt is correctly `partial`; no completed Functions, Hosting, or Rules
  deployment is claimed.
- The local repair pins Firebase Admin 13.6.0, defers `jspdf` loading until BEO
  rendering, enumerates all bound secret metadata, and passes `--force` for the
  tracked retry-enabled event functions. The checksum-pinned Firebase 15.24.0
  Functions dry run now completes with a full manifest and a zero-finding
  Functions audit. The full local release lane, high-risk emulator profile, and
  Lighthouse/CWV gate also pass with this repair. Firebase enabled Cloud
  Scheduler API in staging during this preflight; no code deployment was
  established by the dry run.
- Exact `815c38f` and CI Quality run `33274213339` then passed every repository
  gate and executed the full staging provider operation. Firebase reported 95
  Functions deployed with zero errors, released Firestore Rules, and finalized
  and released Hosting version `0915b89d0813002a`. The governed receipt remains
  `partial`, not verified: Firebase 15.24.0 returned the Hosting version under
  `projects/844470813106/...`, while the source validator admitted only the
  shorter `sites/...` representation and therefore stopped before hosted
  manifest and provider readback. The current repair admits only those two
  exact fixed-project resource forms; it does not broaden the allowed project,
  site, or version boundary.
- Exact `bb4a99e` and CI Quality run `33275291013` proved that deploy-result
  correction, verified the hosted source manifest, and persisted Hosting
  deployment id `554998a5eec25402`. Its receipt remains `partial` because the
  live-channel API represents the same fixed-site version under project ID
  `quotepilot-staging-20260804`, while the deploy result uses numeric project
  `844470813106`. The next repair normalizes only those two already-pinned
  identifiers before comparing the unchanged version id.
- Exact `d3e39ea` and CI Quality run `33276172442` then passed that identity
  boundary and deployed Hosting version `51c59ac877bdf597`, but the immediate
  hosted source-manifest read observed propagation lag. Three no-cache reads
  seconds later matched the exact SHA, CI run, positive profile, and both
  staffing gates. The source repair retries the same strict equality for at
  most ten seconds; it never accepts a stale or mismatched manifest.
- The governed Vercel preview command for all three exact heads also stopped before
  mutation and receipt
  reservation because the current staging `acceptQuoteProposal` Functions
  readback does not prove `COMMERCIAL_CHANGE_AUTHORITY_ENABLED=false`.
- Release-candidate CI authentication is hardened: the tool uses
  `GITHUB_TOKEN`, then `GH_TOKEN`, then the authenticated local GitHub CLI, and
  otherwise fails clearly before provider mutation. An exact-SHA Firebase
  candidate run with both token environment variables explicitly unset used
  the CLI successfully, verified CI, then stopped before receipt reservation
  or provider mutation on the same missing staging secret. This removes the
  misleading unauthenticated GitHub API 404 without weakening any staging,
  secret, UAT, or production prerequisite.
- The maximum safe promotion now includes a verified Firebase positive-profile
  staging deployment at exact `17582da`, production v0.15 staffing activation
  for `mm05366-sandbox`, and green pre-reconciliation release head `ed228c1`.
  Vercel preview, v0.16 merge/tag/production, hosted human acceptance, Stripe,
  Steward, SMS, and buyer-access activation remain unproven or intentionally
  dormant.
- Default-branch Dependabot alert #139 remains open for development-only
  `extract-zip` path traversal. The candidate removes that dependency and
  audits clean. A separate narrow backport is published as PR #112 at exact
  `204f0d2eefd72a8f2d41a6fbb4e7ec6728bd454c`; CI Quality run `33246642372`
  passes all eight jobs and Stripe source-only runs `33246642371` and
  `33246642373` pass. It does not change this release candidate, and closing
  the alert still requires reviewed merge to `main`, not dismissal based on a
  branch result.

The owner has authorized the fastest governed v0.16 march and prefers to judge
the UI after dispatch. The next executable dependency chain is therefore:
publish the main-reconciled release head; require exact-head CI; redeploy that
same SHA to isolated Firebase and Vercel preview under the explicit staffing
profile; execute the available hosted operator and denial checks; then merge,
tag, and promote only after the remaining all-positive release gates have real
evidence. This approval authorizes execution but does not manufacture provider,
hosted, accessibility, or human outcomes.

## Candidate UAT Boundary

The machine UAT planner classifies both tracked profiles item by item. The
original `staging-safe-off` profile remains the disabled-authority boundary.
The new `staging-staffing-authority` profile makes
`staffing.authoritative-plan` and `staffing.authoritative-surface` applicable,
but keeps the disabled-authority check and unrelated provider paths blocked
until separately proven:

- Firebase-all: 17 applicable items and 21 blocked positive-path items.
- Vercel preview: 11 applicable items and 7 blocked positive-path items.

Applicable means eligible to test; it does not mean passed. Blocked is not
`not-applicable` and cannot be converted into a full production attestation.

## Governed Promotion Sequence

1. Publish `release/v0.16.0`, open the release PR, and require the exact
   release-branch `CI Quality` run.
2. Deploy the immutable branch SHA to isolated Firebase staging and Vercel
   preview with the same explicit `staging-staffing-authority` profile after
   provider prerequisites pass and matching Functions readback is possible.
3. Enable one disposable staging tenant separately; record exact admin,
   sales/operator, denied-role, cross-tenant, responsive/accessibility,
   conflict/replay, immutable-receipt, and rollback evidence; then obtain the
   designated release/UAT approval.
4. Only after the complete pre-merge qualification is satisfied, merge the
   reviewed PR to `main`, wait for all eight exact-main hard gates, tag that same
   SHA `v0.16.0`, and dispatch the target-specific production workflows.
5. Preserve target-specific rollback receipts and verify public edge, Firebase
   origin, active Functions/rules, and post-deploy product truth before
   replacing the v0.15 last-known-good records.
6. Treat tenant activation and every provider enablement as a separate,
   reversible, receipt-bound action.

## Owner Review or Input Required

| Decision/input | Current observed boundary | Evidence required to proceed | Unlocks |
|---|---|---|---|
| Production Google Cloud identity | WIF provider, distinct deploy and tenant-operator service accounts, workflow-specific trust bindings, scoped deploy roles, two-permission tenant custom role, and all three repository variables now have provider readback; no key exists | First exact workflow token exchange and governed deployment plus tenant rollback/readback receipts | Governed production Firebase and protected tenant operations; only then safe legacy-secret retirement |
| Staging secret prerequisites | Enabled-version metadata now exists for every bound name enumerated by the candidate, including four random staging-only placeholders; unrelated authorities remain off | Fresh exact-SHA preflight must re-read all metadata without exposing values | Firebase candidate attempt under the selected tracked profile |
| Firebase candidate review | Exact `17582da` has a verified positive-profile Firebase-all receipt; the main-reconciled head does not | Fresh exact-head CI, then verified Hosting, Functions revisions/runtime flags, Firestore release/ruleset, and hosted manifest receipt for the reconciled SHA | Same-SHA Vercel preview precondition |
| Vercel preview and hosted acceptance | No preview upload/deployment was attempted because the Firebase safe-off prerequisite failed | Same-SHA immutable READY preview receipt plus applicable hosted checks and authenticated operator journey | Pre-merge release decision |
| Human review governance | The owner designated tenant-admin, sales/operator, and final release/UAT roles, but their provider and GitHub account bindings are not yet proven; branch protection still requires zero approvals | Verify each identity in the relevant provider and bind the final reviewer through the selected independent-review or explicitly accepted solo-operator control | Truthful human acceptance and merge authorization |
| Default-branch dependency remediation | Dependabot alert #139 remains open; narrow PR #112 is mergeable and exact-CI green but unreviewed/unmerged | Review PR #112 and merge it to `main`, or let the same remediation arrive through a later reviewed v0.16 merge; confirm alert closure afterward | Removes the known development-tool advisory from the current default branch without promoting unqualified product features |
| Device/accessibility acceptance | Automated responsive/accessibility evidence exists; physical devices and assistive technology remain untested | Approve and execute the required PWA/device/AT matrix | Human UI/PWA acceptance |
| Founder-pilot staffing | Protected run `33282940451` verified production v0.15 tenant activation for `mm05366-sandbox`; tenant `250` is not being created | Dispatch the reconciled v0.16 candidate, execute hosted admin/sales/denial and accessibility checks, rehearse rollback, then record the founder's UI judgment | Production v0.16 staffing qualification without inventing an additional tenant |
| Provider-backed capabilities | Buyer, email, payment, SMS, and Stripe Connect positive paths are blocked in the safe-off plan | Named Stripe, Resend/Pingram, Turnstile, and Connect evidence owners; reviewed credentials/dashboard configuration, controlled windows, provider receipts, and rollback | Capability-specific hosted/provider qualification; not blanket activation |
| Stripe Connect | Foundation remains deploy-empty/provider-disabled | Review and authorize the exact Terraform plan digest, reconcile applied identity, observe/promote App Check, bind restricted Sandbox credential, then hosted Sandbox UAT | Consider runtime exports; no production payment authority is implied |
| Steward | Provider runtime and model output remain unavailable | Privacy/billing/provider approval, private context/persistence, current consent, controlled silent execution, 100 actual human packet reviews, hosted rules, and acceptance | Consider private runtime activation while model output remains governed |
| Product Truth and attendance decisions | Product Truth is advisory; attendance persistence terminology/channel/authority is unresolved | Owner calibration/enforcement decision for Product Truth; separate attendance terminology/channel/authority decision | Optional future enforcement/persistence slices, not this release |

Until those receipts exist, the safe release boundary is: publish and deploy
the fail-closed candidate for review, promote only the fully qualified product
surface, and leave every named dormant capability dormant.
