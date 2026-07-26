# Feature Matrix

Last updated: July 21, 2026

This matrix maps the master feature checklist to current implementation and source locations.

## Status Legend
- `Implemented`: shipped and wired in the app.
- `Partial`: present but not complete against all desired behaviors.
- `Optional`: optional capability tracked but not required for core flow.

## Master Checklist Mapping

| # | Feature Area | Status | Primary Evidence |
|---|---|---|---|
| 1 | Data + architecture collections/model | Implemented | `src/lib/organizationService.js`, `src/context/OrganizationContext.jsx`, `firestore.rules`, `functions/index.js`, `scripts/seed-firestore-menu.mjs`, `scripts/migrate-to-multi-tenant.mjs` |
| 2 | Dynamic menu system (Firestore + event filtering + grouping + active items) | Implemented | `src/hooks/useCatalogData.js`, `src/lib/menuService.js`, `src/components/WizardSteps.jsx` |
| 3 | Pricing engine (`per_item`, `per_person`, `per_event`) | Implemented | `src/lib/quoteCalculator.js`, `functions/pricingEngine.js`, `src/lib/commerceOps.js`, `src/components/LiveBreakdown.jsx` |
| 4 | 5-step quote builder wizard | Implemented | `src/lib/wizardUi.js` (`WIZARD_STEP_DEFINITIONS`), `src/components/WizardSteps.jsx`, `src/App.jsx` |
| 5 | Live sticky summary panel with real-time totals | Implemented | `src/components/LiveBreakdown.jsx`, `src/styles.css` (`.breakdown-panel`) |
| 6 | Quote system (create/update, snapshots, statuses) | Implemented | `src/lib/quoteStore.js` (`submitQuote`, `updateQuote`), `src/components/QuoteHistoryModal.jsx` |
| 7 | Quote history + versioning | Implemented | `src/lib/quoteStore.js` (`saveQuoteVersion`, `getQuoteHistory`), `firestore.rules` (`organizations/{orgId}/quotes/{quoteId}/versions/{versionId}`) |
| 8 | Quote management UI (list, sort, filters, actions) | Implemented | `src/components/QuoteHistoryModal.jsx`, `src/lib/quoteStore.js` (`duplicateQuote`, `reopenQuote`, `updateQuotePaymentStatus`) |
| 9 | Admin panel tabbed UX + hierarchical menu management | Implemented | `src/components/AdminCatalogModal.jsx`, `src/styles.css` (`.admin-tabs`) |
| 10 | Inline editing with blur/enter persistence | Implemented | `src/components/AdminCatalogModal.jsx` (`handleManagedMenuItemBlur`, `handleManagedMenuItemKeyDown`) |
| 11 | Booking lifecycle (availability checks, contract conversion, confirmations, staff assignments) | Implemented | `src/lib/quoteStore.js` (`checkEventAvailability`, `convertQuoteToContract`, `updateQuoteBookingConfirmation`, `updateQuoteBookingAssignment`), `src/components/EventScheduleModal.jsx`, `src/components/QuoteHistoryModal.jsx` |
| 12 | Customer decision center (scope/pricing + accept/change request/decline + token lifecycle) | Implemented | `src/components/CustomerPortalView.jsx`, `src/lib/quoteStore.js` (`getPortalQuote`, `updatePortalDecision`, `rotateQuotePortalKey`), `firestore.rules` (`customerPortalQuotes`) |
| 13 | Integrations ops + CRM sync logging + setup assistant | Implemented | `src/components/IntegrationOpsModal.jsx`, `src/lib/quoteStore.js` (`recordQuoteIntegrationSync`, `syncQuoteToCrm`), `src/lib/commerceOps.js`, `functions/index.js` |
| 14 | Reporting dashboard (pipeline, conversion, revenue metrics) | Implemented | `src/components/ReportingDashboardModal.jsx`, `src/lib/quoteStore.js` (`getQuoteHistory`) |
| 15 | Event schedule board (month/week, conflicts, assignments, production checklist) | Implemented | `src/components/EventScheduleModal.jsx`, `src/lib/quoteStore.js` (`getQuoteHistory`, `updateQuoteBookingAssignment`, `updateQuoteProductionChecklist`) |
| 16 | Session diagnostics (runtime capture + staff export/clear tools) | Implemented | `src/lib/sessionDiagnostics.js`, `src/components/DiagnosticsModal.jsx`, `src/main.jsx`, `src/App.jsx` |
| 17 | Global event + organization context across surfaces | Implemented | `src/context/EventTypeContext.jsx`, `src/context/OrganizationContext.jsx`, `src/main.jsx`, `src/App.jsx`, `src/components/AdminCatalogModal.jsx` |
| 18 | Auth, org bootstrap, and role-gated controls | Implemented | `src/hooks/useAuthSession.js`, `src/components/AuthGate.jsx`, `functions/index.js` (`ensureOrganizationBootstrap`), `firestore.rules` |
| 19 | Optional guided selling recommendations + rules | Implemented / Optional | `src/lib/recommendations.js`, `src/components/AdminCatalogModal.jsx`, `src/data/mockCatalog.js` |
| 20 | Good/Better/Best scenario compare workflow | Implemented / Optional | `src/lib/quoteWorkflow.js` (`buildQuoteScenarios`), `src/components/QuoteCompareModal.jsx`, `src/App.jsx` |
| 21 | Optional admin security/audit depth (beyond role gating) | Partial / Optional | Role-gated access and rules are shipped in `src/hooks/useAuthSession.js`, `src/components/AuthGate.jsx`, `firestore.rules`; sync log audit trail exists in `src/lib/quoteStore.js`, but full cross-surface audit pipeline remains limited |
| 22 | QA acceptance tests and checks | Implemented (core) | Unit tests under `src/lib/__tests__/`, UI snapshots under `src/components/__tests__/`, Firestore rules tests under `src/rules/__tests__/`, Playwright smoke lanes under `e2e/`, and CI scripts in `package.json` |
| 23 | Sales workflow (readiness, follow-ups, lifecycle, approval queue) | Implemented | `src/lib/quoteWorkflow.js`, `src/components/SalesWorkflowModal.jsx`, `src/lib/quoteStore.js` (`updateQuoteFollowUp`, `requestQuoteApproval`, `resolveQuoteApprovalRequest`) |
| 24 | Tenant Import Studio (customer/catalog CSV recognition, validation, receipts, rollback) | Implemented (branch) | `src/components/ImportStudioModal.jsx`, `src/lib/importStudio.js`, `src/lib/importBatchService.js`, `firestore.rules` (`importBatches`) |

## Guided Flow (Where It Lives)
- Wizard flow entry and steps: `src/App.jsx`
- Wizard step model + validation + template defaults: `src/lib/wizardUi.js`
- Step components: `src/components/WizardSteps.jsx`
- Guided recommendation engine: `src/lib/recommendations.js`
- Guided selling toggle and rules config: `src/components/AdminCatalogModal.jsx`
- Default guided rules and normalization: `src/data/mockCatalog.js`

## Notes
- Non-dev fail-fast catalog behavior is implemented in `src/hooks/useCatalogData.js` and surfaced by blocking UI in `src/App.jsx`.
- Menu backfill for `pricingType` + `active` is implemented in `scripts/seed-firestore-menu.mjs`.
- Multi-tenant org scoping is live in additive mode; protected catalog/quote writes require org context, and legacy global quotes are auto-migrated into org-scoped paths during Firebase write/version flows while limited legacy read fallback remains configurable.
- Feature flags for optional surfaces (portal/schedule/integrations/diagnostics/reporting/compare/guided selling) are normalized in `src/App.jsx` and managed in `src/components/AdminCatalogModal.jsx`.
- Firebase browser smoke coverage now includes both auth+rules and authoritative-pricing lanes under `e2e/`.
