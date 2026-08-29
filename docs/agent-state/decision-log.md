# Decision Log

Last updated: 2026-08-29 02:05:00 CDT

Checkpoint recorded: 2026-08-29T07:05:00Z

## Decisions made

1. Preserve every intentional local hunk through capability-scoped commits; do not reset, stash, discard, or hide mixed work.
2. Superseded on 2026-08-29: the earlier local-only boundary is replaced by the owner's explicit authorization to pursue the governed bounded release deployment. This authorizes release publication and guarded deployment steps, not bypasses or separately gated provider/tenant activation.
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
13. Use `v0.16.0` as the next semantic release candidate because the 74-commit stack materially expands product, testing, documentation, and release-control surfaces beyond deployed `v0.15.0`.
14. Publish the whole reconciled stack as one release candidate rather than selectively cherry-picking interdependent commits; use feature/provider flags and the tracked `staging-safe-off` profile to preserve dormant boundaries.
15. Keep Stripe Connect deploy-empty/provider-disabled and Steward providerless/model-hidden. Keep buyer access, Commercial Change, Revenue Autopilot, and authoritative staffing off until their separate gates produce evidence.
16. Treat local green gates as permission to begin remote qualification, not as production qualification. Full production promotion still requires the complete pre-merge UAT contract, exact-main CI, same-SHA tag, rollback receipts, and protected deployments.
17. Reconcile the Ambient temporary exception to the larger literal exact-candidate measurement, 3,928,552 bytes, after exact-SHA CI exposed that the earlier ceiling described only a partial source checkpoint. Preserve the 391,901-byte largest-chunk ceiling and add no discretionary aggregate headroom.
18. Do not bypass the candidate prerequisite checker. An absent staging invitation-token placeholder and an unproven Commercial Change false readback are real deployment blockers, not permission to use direct provider CLIs.
19. Stop the autonomous promotion at the published/green-CI boundary. Creating a Secret Manager value requires separate authorization, and production promotion remains gated by complete positive-path hosted/human evidence.

## Unresolved decisions

1. Resolved: the owner approved the remote review/release path and requested promotion of every capability that can pass the governed gates.
2. Unresolved: Whether Product Truth Observability remains advisory or becomes a required CI gate after owner comprehension and freshness calibration.
3. Unresolved: Which named owners authorize and execute the Stripe Connect, Steward, tenant activation, hosted acceptance, production evidence, and manual accessibility gates.
4. Unresolved: Which production-authorized Truth Loop source bundle and evaluation instant should be evaluated first.
