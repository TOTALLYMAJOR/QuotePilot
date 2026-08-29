# Next Actions

Last updated: 2026-08-29 04:32:10 CDT

Checkpoint recorded: 2026-08-29T09:32:04.918Z

1. Approve and provision the production WIF pool/provider, distinct least-privilege deploy and tenant-operator service accounts, and the three repository variables; retain reviewed IAM and binding evidence without creating a service-account key.
2. Authorize/create enabled staging versions for the eleven candidate-required secret names in the promotion report, then deploy the latest exact-CI SHA to Firebase under `staging-safe-off` and verify Hosting, Functions, rules, and every safe-off Functions environment readback.
3. Only after Firebase readback passes, deploy the same SHA to Vercel preview, execute all applicable hosted checks, and route blocked authenticated/provider/device items to named human owners. Merge, tag, and production-promote only after complete UAT and exact-main CI.

# Context Handoff Capsule

- Mission: Promote the 74 unpublished commits as the largest safe bounded v0.16.0 release candidate and leave only exact human/provider gates.
- Branch/SHA: `release/v0.16.0` at code-bearing candidate `e620ce80f096033abfdc420e649499f4ed92dff1` before this evidence-only documentation commit; published in PR #111.
- Scope: Release docs/commit, release branch/PR/CI, fixed staging and preview candidate deployment, read-only verification, and conditional governed production promotion. No bypass, secret disclosure, unauthorized Terraform/provider/tenant mutation, or false evidence promotion.
- Evidence used: Git identity/tree equality; `PROJECT_STATE.md`; `PROJECT_STATUS.md`; `docs/FEATURE_MATRIX.md`; `CHANGELOG.md`; Connect and Steward program docs; Product Truth Observability output; exact-candidate release, browser, CWV, connected-arrival, and Truth Loop results.
- Work completed: All product slices and reconciliation are committed; original 74-commit LOC/capability inventory complete; PR #111 published; exact candidate CI and Stripe source-only workflows recorded; Lighthouse dependency findings remediated; production and tenant legacy-token paths replaced with distinct WIF contracts; Firebase mutation checksum-locked; candidate Firebase/Vercel clients locked; governed candidate deploy attempts reached their fail-closed pre-mutation boundary.
- Files changed: Release work includes the promotion report, canonical status/backlog/performance records, release-gate test repair, and `docs/agent-state/*`; see branch history for exact slices.
- Commands run: Required task planner; Git identity and exact remote checks; high-risk/CWV release validation; focused/full Vitest and Playwright; bundle, project-state, environment, secret, workflow, capability, docs, Stripe-isolation and Ambient gates; CI observation; both governed `release:candidate:deploy` targets.
- Validation results: Code-bearing candidate `e620ce80` passes the full local release lane with 4,099 tests passed/78 skipped and all eight matching CI Quality jobs in run `33245272679`; exact Stripe source-only runs `33245272566`/`33245272601` are green. Governed Firebase/Vercel attempts for that SHA stopped before receipt reservation and mutation on eleven absent enabled staging secret versions and the unproven safe-off Functions readback. Current production remains v0.15.
- Risks/unknowns: Production WIF resources/variables and independent review; authorization and enabled versions for eleven staging secret names; Firebase safe-off deployment/readback; Vercel preview; full hosted UAT; provider evidence; physical-device/accessibility review; human acceptance. Stripe Connect, Steward, buyer access, authoritative staffing, Commercial Change, and Revenue Autopilot remain dormant.
- Next 3 actions: provision/review WIF; authorize the required staging secret versions and deploy/verify Firebase safe-off; deploy Vercel preview and execute applicable hosted/human UAT.
- Resume prompt: Continue the active v0.16.0 promotion from `docs/agent-state/*`. Verify the latest branch SHA is clean, published, and exact-CI green. Do not proceed to production until WIF identities/variables are reviewed and proven. Do not proceed to Firebase candidate deployment until the separately authorized enabled staging versions exist for every required secret name in the promotion report. Use only tracked deploy commands; require safe-off Functions readback before Vercel preview. Do not bypass blocked UAT or enable dormant capabilities.
