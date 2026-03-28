# Dev Tasks

Last updated: March 28, 2026

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
- Add lead/client follow-up workflow stages with reminder prompts.
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
