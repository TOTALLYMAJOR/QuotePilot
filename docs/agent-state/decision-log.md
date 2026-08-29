# Decision Log

Last updated: 2026-08-29 15:28:21 CDT

Checkpoint recorded: 2026-08-29T19:20:40.340Z

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
18. Do not bypass the candidate prerequisite checker. Absent enabled staging versions for the candidate-required secret names and an unproven Commercial Change false readback are real deployment blockers, not permission to use direct provider CLIs.
19. Stop the autonomous promotion at the published/green-CI boundary. Creating a Secret Manager value requires separate authorization, and production promotion remains gated by complete positive-path hosted/human evidence.
20. Treat an authenticated local GitHub CLI session as valid read-only CI proof input after explicit token variables, but never as broader provider or deployment authority. Preserve the candidate's independent secret, staging, UAT, and production gates.
21. Replace production and protected tenant-operation legacy Firebase tokens with GitHub OIDC/WIF source contracts using distinct least-privilege identities. Do not create service-account keys or infer cloud readiness from source completion.
22. Lock privileged Firebase mutation to the checksum-verified official v15.24.0 Linux artifact. Do not add the full Firebase CLI dependency graph to the root application after the attempted install produced new audit findings.
23. Preserve the original 74-commit LOC/capability inventory as the product-stack baseline and report later release-control commits separately.
24. Lock candidate Firebase inspection and mutation to the checksum-verified official binary plus the public Rules API through ADC, and lock Vercel preview to the Build Output API and narrow REST calls. Reject missing provider access or safe-off proof before receipt reservation and mutation; do not restore runtime CLI discovery or `npx` downloads.
25. Preserve the all-positive production UAT contract. Do not convert safe-off blocked items into N/A, waive them because CI is green, or merge/tag/deploy while hosted and human evidence is absent. Record the current solo-operator/zero-required-review configuration as observed governance, not independent review.
26. Isolate the default-branch `extract-zip` remediation in PR #112 so it can be reviewed and merged independently of the unqualified v0.16 product release. Exact green branch evidence does not close the default-branch alert; reviewed merge and readback do.
27. Mark the active promotion goal strictly blocked only after the same external condition recurred across three consecutive goal turns and latest exact-CI head `8b04582` reproduced both fail-before-mutation candidate rejections. Do not merge, tag, deploy production, create secret values, provision IAM, or manufacture human acceptance to keep autonomous work moving.
28. Superseded on 2026-08-29: the owner explicitly authorized the staffing operationalization path for tenant `250`, including preparation and execution of WIF/IAM, governed release, canonical provisioning, protected tenant activation, and rollback when their fail-closed prerequisites pass.
29. Bind positive non-production staffing proof to a separate `staging-staffing-authority` profile. Preserve `staging-safe-off`; require the selected profile to match CLI input, Functions dotenv, active-revision readback, hosted manifest, and receipt. A global staging gate never substitutes for the separate disposable-tenant gate.
30. Keep the three named humans in distinct duties: tenant administration/primary staffing operation, tenant sales/operator acceptance, and release/UAT review/final approval. Do not infer a GitHub reviewer identity from an email address.
31. Preserve the first successful WIF/IAM and repository-variable readbacks, but retain the legacy Firebase token until an exact protected workflow proves token exchange and deployment; configuration is not execution evidence.
32. Treat each failed candidate attempt according to its actual boundary. Preflight failures are not provider mutation; a reserved `partial` receipt after a Firebase call is not a completed deployment and must not be retried under the same immutable receipt identity.
33. Keep the pinned Firebase Functions graph compatible with the checksum-pinned Firebase analyzer and defer optional Kitchen BEO renderer loading until invocation. Require `--force` explicitly for the repository's tracked retry-enabled event functions instead of depending on an interactive acknowledgement.
34. Record Cloud Scheduler API enablement caused by Firebase preflight even though the command used `--dry-run`; dry-run is not a universal no-provider-mutation guarantee.

## Unresolved decisions

1. Resolved: the owner approved the remote review/release path and requested promotion of every capability that can pass the governed gates.
2. Unresolved: Whether Product Truth Observability remains advisory or becomes a required CI gate after owner comprehension and freshness calibration.
3. Partially resolved: Staffing now has owner-designated administrator, sales/operator, and release/UAT roles. Stripe Connect, Steward, provider-specific, and manual accessibility ownership remains unresolved, and provider/GitHub account bindings still require verification.
4. Unresolved: Which production-authorized Truth Loop source bundle and evaluation instant should be evaluated first.
5. Resolved for provisioning: the approved WIF provider, separate deploy and tenant-operator identities, least-privilege bindings, and repository variables now have provider readback and no service-account keys. First exact workflow token exchange, effective deployment proof, tenant-operation receipt, and safe legacy-secret retirement remain unresolved execution evidence.
