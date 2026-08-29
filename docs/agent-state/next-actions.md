# Next Actions

Last updated: 2026-08-29 02:34:41 CDT

Checkpoint recorded: 2026-08-29T07:34:41Z

1. Obtain separate authorization for a non-provider staging `STAFF_INVITATION_TOKEN_SECRET` placeholder, create/enable it through the governed secret process, and retain only existence/version evidence—never the value.
2. Re-run exact CI for the latest clean published release SHA if needed, deploy that SHA to Firebase staging under `staging-safe-off`, and verify Hosting, Functions, rules, and every safe-off Functions environment readback.
3. Only after Firebase readback passes, deploy the same SHA to Vercel preview, execute all applicable hosted checks, and route the blocked authenticated/provider/device items to their named human owners. Do not merge, tag, or production-promote before complete UAT.

# Context Handoff Capsule

- Mission: Promote the 74 unpublished commits as the largest safe bounded v0.16.0 release candidate and leave only exact human/provider gates.
- Branch/SHA: `release/v0.16.0` at exact green candidate `7f6d40bec472a82ce6e0b9ead063410a23ca154b` before this evidence-only documentation commit; published in PR #111.
- Scope: Release docs/commit, release branch/PR/CI, fixed staging and preview candidate deployment, read-only verification, and conditional governed production promotion. No bypass, secret disclosure, unauthorized Terraform/provider/tenant mutation, or false evidence promotion.
- Evidence used: Git identity/tree equality; `PROJECT_STATE.md`; `PROJECT_STATUS.md`; `docs/FEATURE_MATRIX.md`; `CHANGELOG.md`; Connect and Steward program docs; Product Truth Observability output; exact-candidate release, browser, CWV, connected-arrival, and Truth Loop results.
- Work completed: All product slices and reconciliation are committed; 74-commit LOC/capability inventory complete; PR #111 published; exact candidate CI and both Stripe Connect source-only workflows pass; stale Ambient route expectation and partial-source bundle ceiling repaired; the candidate tool now uses authenticated GitHub CLI fallback; governed candidate deploy attempts reached their fail-closed pre-mutation boundary.
- Files changed: Release work includes the promotion report, canonical status/backlog/performance records, release-gate test repair, and `docs/agent-state/*`; see branch history for exact slices.
- Commands run: Required task planner; Git identity and exact remote checks; high-risk/CWV release validation; focused/full Vitest and Playwright; bundle, project-state, environment, secret, workflow, capability, docs, Stripe-isolation and Ambient gates; CI observation; both governed `release:candidate:deploy` targets.
- Validation results: Exact candidate `7f6d40be` passes CI Quality `33240762183` and Stripe source-only runs `33240762176`/`33240762182`. A Firebase candidate command with `GITHUB_TOKEN` and `GH_TOKEN` unset verified CI through the authenticated CLI and stopped on the missing invitation-token secret before receipt reservation/provider mutation. Vercel remains blocked on safe-off Firebase Functions readback. Current production remains v0.15.
- Risks/unknowns: Staging invitation-token placeholder authorization/existence, Firebase safe-off deployment/readback, Vercel preview, full hosted UAT, provider evidence, physical-device/accessibility review, and human acceptance. Stripe Connect, Steward, buyer access, authoritative staffing, Commercial Change, and Revenue Autopilot remain dormant.
- Next 3 actions: authorize/create the staging placeholder; deploy and verify Firebase safe-off; deploy Vercel preview and execute applicable hosted/human UAT.
- Resume prompt: Continue the active v0.16.0 promotion from `docs/agent-state/*`. Verify the latest branch SHA is clean, published, and exact-CI green. Do not proceed until the separately authorized staging invitation-token placeholder exists. Then use only the tracked Firebase candidate command; require safe-off Functions readback before the tracked Vercel preview command. Do not bypass blocked UAT or enable dormant capabilities.
