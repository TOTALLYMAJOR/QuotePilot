# Dev Tasks

Last updated: August 4, 2026

## P0 - Tenant Provisioning Release
- Deploy the reviewed role-authoritative Firestore rules and
  provisioning/repair/cleanup Functions from the merged `main` revision; the
  `/app` frontend is live on Vercel, but the coordinated Firebase runtime slice
  remains locked.
- Run a disposable second-tenant acceptance: platform-admin create, exact owner
  email verification/invite activation, cross-tenant denial, neutral default
  inspection, reviewed package/event/pricing setup, conflict-safe catalog save,
  trusted quote create/readback/version proof, signed-out portal acceptance,
  staff decision verification, and exact cleanup/tombstone proof.
- Verify `quotepilot.mbmapps.com` in Resend and authoritative DNS before
  activating `QuotePilot by MBMapps <onboarding@quotepilot.mbmapps.com>`;
  capture provider accepted, delivered-event, and recipient-inbox proof.

## P0 - Multi-Tenant Hardening (Post Rollout)
- Completed execution track: org-scoped quote/catalog write paths now enforce cross-org denial with migration evidence attached.
- Evidence captured (March 28, 2026):
  - Cross-org denial emulator matrix log: `.cache/p0-denial-matrix/20260328T001230Z--firestore-rules-cross-org-denial.log`
  - Portal expiry/deleted-state rule hardening emulator log: `.cache/p0-denial-matrix/20260328T022716Z--firestore-rules-portal-expiry-hardening.log`
  - Migration dry-run log/json: `.cache/migration-dry-runs/20260328T001210Z--tonicatering--250--dry-run.log` and `.cache/migration-dry-runs/20260328T001210Z--tonicatering--250--dry-run.json`
  - Portal expiry-ms dry-run log/json: `.cache/migration-dry-runs/20260328T022619Z--tonicatering--250--portal-ms-dry-run.log` and `.cache/migration-dry-runs/20260328T022619Z--tonicatering--250--portal-ms-dry-run.json`
  - Migration apply log/json: `.cache/migration-runs/20260328T001919Z--tonicatering--250--apply.log` and `.cache/migration-runs/20260328T001919Z--tonicatering--250--apply.json`
  - Portal expiry-ms apply log/json: `.cache/migration-runs/20260328T022640Z--tonicatering--250--portal-ms-apply.log` and `.cache/migration-runs/20260328T022640Z--tonicatering--250--portal-ms-apply.json`
- Remaining P0 action: deploy hardened portal rules to production and run post-deploy smoke verification (active portal token succeeds; expired/deleted tokens are denied).

## P0 - Security and Reliability
- Publish and remotely qualify the locally validated combined sell-readiness
  source candidate that converges product hardening with fail-closed exact-SHA
  release preparation; merge only after fresh exact-head CI and hosted Preview
  evidence.
- Configure all six non-secret Preview-scope `VITE_FIREBASE_*` variables, then
  reverify the exact candidate SHA and complete hosted owner/quote/portal
  acceptance. Source CI alone is not hosted proof.
- Verify Firebase email-enumeration protection is enabled and the canonical
  password-reset continue domain is authorized. Then replace public
  email/password self-registration with an invitation-bound flow or add
  equivalent App Check/reCAPTCHA abuse controls; generic reset copy does not
  prevent the registration endpoint from returning an existing-email result.
- Release the Stripe deposit and final-balance lifecycles only as one
  exact-revision frontend, Functions, and Firestore-rules rollout. In isolated
  hosted acceptance set explicit `STRIPE_MODE=test` with a matching test key and
  subscribe all four Checkout Session events; after that evidence, separately
  authorize live mode, configure a matching live key, and capture real webhook
  plus admin reconciliation evidence. Prove separately for each payment rail
  that prepared URLs remain absent from browser-readable quote/portal records,
  ambiguous checkout/email outcomes resume under the same executing admin with
  the same keys, durable provider acceptance resumes publication without
  another send, and definite failure does not publish an unsent checkout. Also
  prove that a final-balance request requires the booked contract and verified
  paid deposit, uses the server-derived remainder, and cannot rewrite deposit
  evidence. Local tests and emulator events are not provider acceptance.
- Strengthen the existing `main` protection from zero required approvals to an
  independently enforceable review policy with code-owner, stale-review, and
  last-push controls. Add a non-admin collaborator or separately owned gate;
  the current sole-admin collaborator model cannot provide independent review.
- Create `production-uat`; protect it and `Production` with self-review
  prevention, administrator bypass disabled, protected-branch policy, and an
  independent reviewer; set `RELEASE_UAT_ATTESTER_IDS` to approved human GitHub
  user ids. The August 3 audit found `production-uat` absent and `Production`
  unprotected. Confirm the private repository plan supports these controls or
  transfer/upgrade/use an external deployment protection gate.
- Prevent Vercel Git integration or any alternate provider entrypoint from
  bypassing the controlled production workflows.
- Replace credential-bearing `npx` provider execution with a separately locked,
  audited, checksum-verified Firebase/Vercel tool image or narrow provider API
  client; do not import the currently vulnerable CLI dependency trees into the
  application lockfile. Split preparation from mutation and expose the provider
  token only to the fixed, minimal final tool process—not repository build,
  verifier, npm, or application code.
- Bind UAT to provider-derived staging project/deployment id, source SHA, READY
  state, artifact/configuration digest, and timestamp. Validate the historical
  GitHub deployment review and absence of bypass instead of relying only on
  current environment policy.
- Replace rollback ancestry alone with a signed provider-specific successful
  deployment manifest and component-scoped last-known-good artifact.
- Rehearse an exact-main immutable staging pass, protected UAT attestation, and
  rejected invalid-evidence deploy without changing production; attach run ids
  and environment-policy evidence.
- Add a separately owned GitHub App/check or equivalent external verifier for
  release-critical source changes when stronger tamper independence is needed.

## P1 - Performance and UX
- Reduce largest JavaScript chunk size (split proposal/export-heavy paths where practical).
- Continue mobile-density cleanup beyond the implemented persistent pricing
  summary, active-step rail, compact operator action rail, and simplified
  Step 1 staffing-pricing boundary.
- Add intentional transition/motion polish for step changes and live breakdown updates.

## P1 - Product Capability
- Add opt-in, provider-backed notifications and configurable escalation rules
  for due follow-ups and new customer change requests; preserve the in-app
  Workflow Attention queue as operational tracking rather than delivery proof.
- Run and review the tenant-scoped production portal-projection dry run, resolve
  conflicts, then explicitly authorize the guarded apply so older active links
  receive the new decision-center event, selection, and pricing fields. The
  tool and emulator acceptance are complete; production execution is not.
- Add basic analytics events for funnel drop-off and add-on selection trends.
- Extend operations audit controls (retry dashboards, sync health trends, role-based action logs).
- Add server-authoritative refund and dispute workflows. The current source
  branch covers deposit and final-balance collection as separate payment rails,
  but neither rail proves or authorizes a refund or dispute outcome.

## P2 - Integrations
- Add CRM adapters (HubSpot/Salesforce or webhook bridge).
- Add accounting sync for invoicing and reconciliation flows.
- Add two-way owner/client SMS thread support.

## P2 - Configurability
- Move more pricing behavior to config-driven policies.
- Add feature flags for optional modules.
- Add finer role-based controls for approvals/report visibility.
