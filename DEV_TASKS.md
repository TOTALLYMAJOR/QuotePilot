# Dev Tasks

Last updated: March 26, 2026

## P0 - Multi-Tenant Hardening (Post Rollout)
- Run focused emulator tests for cross-org denial on org-scoped quotes/catalog writes.
- Execute migration script in production with audited dry-run/output capture.
- Remove legacy global fallback (`VITE_ENABLE_LEGACY_GLOBAL_FALLBACK`) after migration verification.
- Remove remaining legacy global write paths once fallback retirement is complete.

## P0 - Security and Reliability
- Re-establish staging sign-off workflow and release checklist enforcement before broadening `main` merge velocity.
- Add explicit portal token expiry/rotation policy and enforcement path.
- Add targeted E2E scenarios for booking conversion/confirmation edge cases.

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
