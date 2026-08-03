# Dev Tasks

Last updated: July 27, 2026

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
- Re-establish staging sign-off workflow and release checklist enforcement before broadening `main` merge velocity.

## P1 - Performance and UX
- Reduce largest JavaScript chunk size (split proposal/export-heavy paths where practical).
- Improve wizard mobile layout for dense review/pricing states.
- Add intentional transition/motion polish for step changes and live breakdown updates.

## P1 - Product Capability
- Add automated notifications and escalation rules for due follow-ups and new customer change requests.
- Link each approved sensitive-action request to the matching separate admin
  execution and record the action outcome; request creation and admin
  resolution are already server-authoritative in the current source candidate.
- Refresh/backfill existing portal snapshots so older active links receive the new decision-center event, selection, and pricing fields.
- Add basic analytics events for funnel drop-off and add-on selection trends.
- Extend operations audit controls (retry dashboards, sync health trends, role-based action logs).

## P2 - Integrations
- Add CRM adapters (HubSpot/Salesforce or webhook bridge).
- Add accounting sync for invoicing and reconciliation flows.
- Add two-way owner/client SMS thread support.

## P2 - Configurability
- Move more pricing behavior to config-driven policies.
- Add feature flags for optional modules.
- Add finer role-based controls for approvals/report visibility.
