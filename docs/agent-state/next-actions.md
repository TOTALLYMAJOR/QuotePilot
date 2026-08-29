# Next Actions

Last updated: 2026-08-29 03:43:26 CDT

Checkpoint recorded: 2026-08-29T08:49:48.059Z

1. Approve and provision the production WIF pool/provider, distinct least-privilege deploy and tenant-operator service accounts, and the three repository variables; retain reviewed IAM and binding evidence without creating a service-account key.
2. Authorize/create the staging `STAFF_INVITATION_TOKEN_SECRET` placeholder, then deploy the latest exact-CI SHA to Firebase under `staging-safe-off` and verify Hosting, Functions, rules, and every safe-off Functions environment readback.
3. Only after Firebase readback passes, deploy the same SHA to Vercel preview, execute all applicable hosted checks, and route blocked authenticated/provider/device items to named human owners. Merge, tag, and production-promote only after complete UAT and exact-main CI.

# Context Handoff Capsule

- Mission: Promote the 74 unpublished commits as the largest safe bounded v0.16.0 release candidate and leave only exact human/provider gates.
- Branch/SHA: `release/v0.16.0` at code-bearing candidate `a096d20c34d6ba018c34653387ca30673f6039ef` before this evidence-only documentation commit; published in PR #111.
- Scope: Release docs/commit, release branch/PR/CI, fixed staging and preview candidate deployment, read-only verification, and conditional governed production promotion. No bypass, secret disclosure, unauthorized Terraform/provider/tenant mutation, or false evidence promotion.
- Evidence used: Git identity/tree equality; `PROJECT_STATE.md`; `PROJECT_STATUS.md`; `docs/FEATURE_MATRIX.md`; `CHANGELOG.md`; Connect and Steward program docs; Product Truth Observability output; exact-candidate release, browser, CWV, connected-arrival, and Truth Loop results.
- Work completed: All product slices and reconciliation are committed; original 74-commit LOC/capability inventory complete; PR #111 published; exact candidate CI and Stripe source-only workflows recorded; Lighthouse dependency findings remediated; production and tenant legacy-token paths replaced with distinct WIF contracts; Firebase mutation checksum-locked; governed candidate deploy attempts reached their fail-closed pre-mutation boundary.
- Files changed: Release work includes the promotion report, canonical status/backlog/performance records, release-gate test repair, and `docs/agent-state/*`; see branch history for exact slices.
- Commands run: Required task planner; Git identity and exact remote checks; high-risk/CWV release validation; focused/full Vitest and Playwright; bundle, project-state, environment, secret, workflow, capability, docs, Stripe-isolation and Ambient gates; CI observation; both governed `release:candidate:deploy` targets.
- Validation results: Code-bearing candidate `a096d20c` passes the full local release lane and all eight matching CI Quality jobs in run `33243677607`; exact Stripe source-only runs `33243677627`/`33243677615` are green. Earlier governed Firebase/Vercel candidate attempts stopped before mutation on the missing staging secret and safe-off Functions readback. Current production remains v0.15.
- Risks/unknowns: Production WIF resources/variables and independent review; staging invitation-token placeholder authorization/existence; remaining provider-client locking; Firebase safe-off deployment/readback; Vercel preview; full hosted UAT; provider evidence; physical-device/accessibility review; human acceptance. Stripe Connect, Steward, buyer access, authoritative staffing, Commercial Change, and Revenue Autopilot remain dormant.
- Next 3 actions: provision/review WIF; authorize the staging placeholder and deploy/verify Firebase safe-off; deploy Vercel preview and execute applicable hosted/human UAT.
- Resume prompt: Continue the active v0.16.0 promotion from `docs/agent-state/*`. Verify the latest branch SHA is clean, published, and exact-CI green. Do not proceed to production until WIF identities/variables are reviewed and proven. Do not proceed to candidate deployment until the separately authorized staging invitation-token placeholder exists. Use only tracked deploy commands; require safe-off Functions readback before Vercel preview. Do not bypass blocked UAT or enable dormant capabilities.
