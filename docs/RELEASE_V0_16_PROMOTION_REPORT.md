# QuotePilot v0.16.0 Promotion Report

Last updated: 2026-08-29 01:12:39 CDT

This is a point-in-time release decision record. Capability truth remains in
[`FEATURE_MATRIX.md`](FEATURE_MATRIX.md), current operational truth remains in
[`../PROJECT_STATUS.md`](../PROJECT_STATUS.md), and executable remaining work
remains in [`../DEV_TASKS.md`](../DEV_TASKS.md).

## Candidate Summary

- Comparison range: `origin/main..303eec5237d143fc11398e23f24e86fcb28c2655`.
- Unpublished commits: 74.
- Files changed: 180 total; 178 text files and 2 binary brand assets.
- Text change volume: 12,313 insertions, 1,030 deletions, net +11,283 lines.
- Intended release: `v0.16.0`, assembled on `release/v0.16.0` from current
  `origin/main`. The published release-branch and CI receipts, not this
  pre-publication document, identify the immutable candidate SHA.
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
| Operational staffing authority | Keep candidate backend authority off; presentation may be inspected without claiming activation | Tenant `250` lacks the canonical settings document; provisioning/migration review and protected activation receipt are required. |
| Commercial Change and Revenue Autopilot | Keep authority/send gates off | Authenticated/provider evidence and named rollback remain incomplete. |
| SMS delivery | Preserve deployed configuration boundaries; do not infer delivery | Credential/endpoint registration, controlled send, provider lifecycle, opt-out, carrier, and recipient evidence remain separate. |
| Attendance persistence | Promote the read-only context only | Terminology/channel research and authority/migration decisions are unresolved. |

## Validation Evidence

- Environment, secret, project-state, workflow, Ambient release, Stripe
  isolation, capability-surfacing, and documentation-governance checks passed.
- Unit lane: 363 files passed and 3 skipped; 4,091 tests passed and 78 skipped.
- Truth Loop: 127 tests passed.
- Vite production build passed with 503 modules.
- Bundle budget passed: 3,208,389 bytes total and 384,998 bytes largest asset,
  within the active temporary ceilings of 3,213,578 and 391,901 bytes.
- Firestore rules: 76 tests passed.
- Owner-SMS emulator and full Firebase authenticated/rules browser lanes passed.
- Authoritative pricing browser lane: 3 tests passed.
- Lighthouse/Core Web Vitals gate passed.
- Documentation timestamps were advanced after the first governance run
  correctly rejected seven changed canonical/checkpoint documents.

These are local/source results. Remote CI, hosted candidates, production,
provider, tenant, physical-device, and human results remain separate.

## Candidate UAT Boundary

The machine UAT planner classifies the tracked `staging-safe-off` profile as
blocked for full production qualification, while still allowing a bounded
candidate deployment for the applicable safe-off surface:

- Firebase-all: 17 applicable items and 21 blocked positive-path items.
- Vercel preview: 11 applicable items and 7 blocked positive-path items.

Applicable means eligible to test; it does not mean passed. Blocked is not
`not-applicable` and cannot be converted into a full production attestation.

## Governed Promotion Sequence

1. Publish `release/v0.16.0`, open the release PR, and require the exact
   release-branch `CI Quality` run.
2. Deploy the immutable branch SHA to the isolated Firebase staging target and
   Vercel preview with the `staging-safe-off` profile, if provider prerequisites
   pass.
3. Record hosted checks for the applicable matrix and obtain named human review
   for the authenticated operator, responsive/accessibility, and comprehension
   journeys.
4. Only after the complete pre-merge qualification is satisfied, merge the
   reviewed PR to `main`, wait for all eight exact-main hard gates, tag that same
   SHA `v0.16.0`, and dispatch the target-specific production workflows.
5. Preserve target-specific rollback receipts and verify public edge, Firebase
   origin, active Functions/rules, and post-deploy product truth before
   replacing the v0.15 last-known-good records.
6. Treat tenant activation and every provider enablement as a separate,
   reversible, receipt-bound action.

## Owner Review or Input Required

- Name the reviewer for the release PR and the authenticated tenant/operator
  who can execute the exact hosted journey.
- Confirm the required real-device/assistive-technology matrix for PWA and UI
  acceptance.
- Approve the tenant-250 provisioning/migration plan before any staffing
  activation retry.
- Provide or assign the Stripe, Resend/Pingram, Turnstile, and Stripe Connect
  provider/dashboard evidence owners; no credentials belong in this report.
- Review and authorize the exact Stripe Connect Terraform plan digest before
  any apply or runtime export.
- Decide whether Product Truth Observability stays advisory after its first
  remote observation or becomes a required gate after calibration.
- Decide the attendance terminology/channel and authority model before a
  persistence slice.
- Approve Steward privacy/billing/provider terms and the consenting 100-review
  evaluation before any private runtime activation.

Until those receipts exist, the safe release boundary is: publish and deploy
the fail-closed candidate for review, promote only the fully qualified product
surface, and leave every named dormant capability dormant.
