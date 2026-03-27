# Dev Tasks

Last updated: March 27, 2026

## P0 - Multi-Tenant Hardening (Post Rollout)
- In-progress execution track: harden cross-org denial coverage for org-scoped quote and catalog write paths.
- Evidence expectation: attach emulator denial matrix evidence (wrong-org deny + same-org allow controls) with command/test artifacts, plus migration dry-run evidence captured per `docs/ORCHESTRATION_RUNBOOK.md` ("Migration Dry-Run Evidence Standard (P0 Execution)").
- Completion criteria: quote/catalog org-scoped write paths deny cross-org access, same-org writes still pass, and no unresolved legacy global fallback bypass remains for protected writes.
- Run focused emulator tests for cross-org denial on org-scoped quotes/catalog writes.
- Execute migration script in production only after a dry-run is captured with the required command pattern, artifact naming/location, and PR evidence format from `docs/ORCHESTRATION_RUNBOOK.md`.
- Remove legacy global fallback (`VITE_ENABLE_LEGACY_GLOBAL_FALLBACK`) after migration verification.
- Remove remaining legacy global write paths once fallback retirement is complete.

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
