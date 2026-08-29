# Decision Log

Last updated: 2026-08-28 20:56:59 CDT

Checkpoint recorded: 2026-08-29T01:56:59Z

## Decisions made

1. Preserve every intentional local hunk through capability-scoped commits; do not reset, stash, discard, or hide mixed work.
2. Keep all work local. No push, deployment, Terraform apply, provider call, tenant mutation, credential binding, or runtime activation is authorized by this task.
3. Validate slices from exact candidate trees before committing; treat dirty-root success as supporting evidence, not final candidate proof.
4. Reconcile the complete committed local stack with `origin/main` only after product slices are separated. Use the isolated, validated `-X ours` merge result because newer local conflicting hunks must remain while non-conflicting v0.15 additions are accepted.
5. Treat `PROJECT_STATUS.md` as current operational authority and preserve older v0.7 receipts only as explicitly superseded history. Current production is exact v0.15.
6. Keep Product Truth Observability read-only and evidence-class aware. Do not infer reachability, hosted behavior, provider outcome, human acceptance, or business outcome from Git/source/local validation.
7. Keep Truth Loop coverage invocation explicit: a source bundle and evaluation instant are required; a bare command must not infer them.
8. Keep Stripe Connect row 65 `Partial` at the provider-disabled stopping point. No further source-only runtime work may bypass infrastructure, App Check, credential, provider, hosted-UAT, and human gates.
9. Keep Steward row 71 `Partial` at the deploy-dormant stopping point. Do not expose model prose or create provider/private-runtime placeholders to bypass privacy, billing, consent, hosted-proof, and human-evaluation gates.
10. Commit the five `docs/agent-state/*` files as the final local handoff slice so context compaction cannot erase exact identity, evidence, decisions, unknowns, or resume instructions.
11. Treat the deployed v0.15 Pingram selection and provider acceptance as separate facts. Correct stale `production remains none` guidance, but do not infer credential binding, endpoint registration, delivery, recipient receipt, or permission to send.
12. Require a fresh upstream fetch and the release manager's high-risk plus CWV readiness profile for the completion audit before closing the local goal.

## Unresolved decisions

1. Unresolved: Whether and when the owner approves pushing this branch and opening the remote review/release path.
2. Unresolved: Whether Product Truth Observability remains advisory or becomes a required CI gate after owner comprehension and freshness calibration.
3. Unresolved: Which named owners authorize and execute the Stripe Connect, Steward, tenant activation, hosted acceptance, production evidence, and manual accessibility gates.
4. Unresolved: Which production-authorized Truth Loop source bundle and evaluation instant should be evaluated first.
