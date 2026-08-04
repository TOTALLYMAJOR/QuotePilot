# Feature Matrix

Last updated: August 4, 2026

This matrix maps the master feature checklist to current implementation and source locations.

## Status Legend
- `Implemented`: shipped and wired in the app.
- `Implemented (branch)`: present in the current branch with local
  implementation evidence, but not yet deployed or production-accepted;
  release-gate status remains in `PROJECT_STATUS.md`.
- `Partial`: present but not complete against all desired behaviors.
- `Optional`: optional capability tracked but not required for core flow.

## Master Checklist Mapping

| # | Feature Area | Status | Primary Evidence |
|---|---|---|---|
| 1 | Data + architecture collections/model | Implemented | `src/lib/organizationService.js`, `src/context/OrganizationContext.jsx`, `firestore.rules`, `functions/index.js`, `scripts/seed-firestore-menu.mjs`, `scripts/migrate-to-multi-tenant.mjs` |
| 2 | Dynamic menu system (Firestore + event filtering + grouping + active items) | Implemented | `src/hooks/useCatalogData.js` (changed-record transactions + conflict detection), `src/lib/menuService.js`, `src/components/WizardSteps.jsx` |
| 3 | Pricing engine (`per_item`, `per_person`, `per_event`) | Implemented | `src/lib/quoteCalculator.js`, `functions/pricingEngine.js` (confirmed-setup gate), `src/lib/commerceOps.js`, `src/components/LiveBreakdown.jsx` |
| 4 | 5-step quote builder wizard | Implemented | `src/lib/wizardUi.js` (`WIZARD_STEP_DEFINITIONS`), `src/components/WizardSteps.jsx`, `src/App.jsx`, `src/components/__tests__/wizardVisualSnapshots.test.jsx`, `e2e/quote-wizard.smoke.spec.js` |
| 5 | Live sticky summary panel with real-time totals | Implemented (local mobile acceptance) | `src/components/LiveBreakdown.jsx`, `src/App.jsx` (`MobilePricingSummary`), `src/styles.css` (`.breakdown-panel`, `.mobile-pricing-summary`), `e2e/quote-wizard.smoke.spec.js` |
| 6 | Quote system (trusted create/duplicate/edit, snapshots, statuses) | Implemented (branch) | `functions/index.js` (`createQuoteDraft`, `duplicateQuoteDraft`, `updateQuoteDraft`), `functions/quoteCreation.js`, `src/lib/quoteStore.js` (`submitQuote`, `duplicateQuote`, `updateQuote`), `src/components/QuoteHistoryModal.jsx` |
| 7 | Quote history + versioning | Implemented | `src/lib/quoteStore.js` (`saveQuoteVersion`, `getQuoteHistory`), `firestore.rules` (`organizations/{orgId}/quotes/{quoteId}/versions/{versionId}`) |
| 8 | Quote management UI (list, sort, filters, exact draft-save handoff, role-safe actions, revision-bound email delivery, evidence-gated portal sharing, isolated Stripe deposit and final-balance request/reconciliation rails, provider-owned payment status) | Implemented (branch) | `src/components/QuoteHistoryModal.jsx`, `src/lib/quoteStore.js` (`duplicateQuote`, `reopenQuote`, `hardDeleteQuote`), `src/lib/commerceOps.js`, `src/lib/proposalExport.js`, `functions/quoteDelivery.js`, `functions/paymentApprovalScope.js`, `functions/paymentDispatchState.js`, `functions/paymentSafety.js`, `functions/paymentLedger.js`, `functions/finalBalancePayment.js`, `functions/stripeProviderState.js`, `functions/index.js` (`sendQuoteToCustomer`, `resolveQuoteDeliveryOutcome`, `sendPaymentRequestEmail`, `sendFinalBalanceRequestEmail`, `reconcileDepositCheckout`, `reconcileFinalBalanceCheckout`, `stripeWebhook`, disabled direct `createDepositCheckout`, `rotateQuotePortalKey`, `reopenQuote`, `hardDeleteQuote`; the legacy bulk purge callable fails closed), `firestore.rules` (`privatePaymentDispatches` is server-only) |
| 9 | Admin panel tabbed UX + hierarchical menu management | Implemented | `src/components/AdminCatalogModal.jsx`, `src/styles.css` (`.admin-tabs`) |
| 10 | Inline editing with blur/enter persistence | Implemented | `src/components/AdminCatalogModal.jsx` (`handleManagedMenuItemBlur`, `handleManagedMenuItemKeyDown`) |
| 11 | Booking lifecycle (availability checks, contract conversion, confirmations, staff assignments) | Implemented (contract callable deploy pending) | `functions/contractWorkflow.js`, `functions/index.js` (`convertQuoteToContract`), `src/lib/quoteStore.js` (`checkEventAvailability`, `convertQuoteToContract`, `updateQuoteBookingConfirmation`, `updateQuoteBookingAssignment`), `src/components/EventScheduleModal.jsx`, `src/components/QuoteHistoryModal.jsx` |
| 12 | Customer decision center (scope/pricing + accept/change request/decline + evidence-bound token lifecycle) | Implemented (branch; delivery-evidence rules deploy pending) | `src/components/CustomerPortalView.jsx`, `src/lib/quoteStore.js` (`getPortalQuote`, `updatePortalDecision`, `rotateQuotePortalKey`), `functions/quoteDelivery.js`, `functions/index.js`, `firestore.rules` (`customerPortalQuotes`) |
| 13 | Admin-only provider operations + scoped integration audit logging | Implemented (branch; provider activation pending) | `src/components/IntegrationOpsModal.jsx`, `src/lib/quoteStore.js` (`recordQuoteIntegrationSync`; browser CRM sends fail closed), `src/lib/commerceOps.js`, `functions/index.js` (admin-only provider callables) |
| 14 | Reporting dashboard (pipeline, conversion, revenue metrics) | Implemented | `src/components/ReportingDashboardModal.jsx`, `src/lib/quoteStore.js` (`getQuoteHistory`) |
| 15 | Event schedule board (month/week, conflicts, assignments, production checklist) | Implemented | `src/components/EventScheduleModal.jsx`, `src/lib/quoteStore.js` (`getQuoteHistory`, `updateQuoteBookingAssignment`, `updateQuoteProductionChecklist`) |
| 16 | Session diagnostics (runtime capture + staff export/clear tools) | Implemented | `src/lib/sessionDiagnostics.js`, `src/components/DiagnosticsModal.jsx`, `src/main.jsx`, `src/App.jsx` |
| 17 | Global event + organization context across surfaces | Implemented | `src/context/EventTypeContext.jsx`, `src/context/OrganizationContext.jsx`, `src/main.jsx`, `src/App.jsx`, `src/components/AdminCatalogModal.jsx` |
| 18 | Verified-email auth, email/password recovery with same-confirmation UI and QuotePilot return URL, org bootstrap, and role-gated controls | Implemented (branch; hosted Auth configuration pending) | `src/lib/authClient.js`, `src/hooks/useAuthSession.js`, `src/components/AuthGate.jsx`, `e2e/firebase-auth-rules.smoke.spec.js`, `functions/index.js` (`ensureOrganizationBootstrap`), `firestore.rules` |
| 19 | Optional guided selling recommendations + rules | Implemented / Optional | `src/lib/recommendations.js`, `src/components/AdminCatalogModal.jsx`, `src/data/mockCatalog.js` |
| 20 | Good/Better/Best scenario compare workflow | Implemented / Optional | `src/lib/quoteWorkflow.js` (`buildQuoteScenarios`), `src/components/QuoteCompareModal.jsx`, `src/App.jsx` |
| 21 | Optional admin security/audit depth (beyond role gating) | Partial / Optional | Role-gated access and rules are shipped in `src/hooks/useAuthSession.js`, `src/components/AuthGate.jsx`, `firestore.rules`; sync log audit trail exists in `src/lib/quoteStore.js`, but full cross-surface audit pipeline remains limited |
| 22 | QA acceptance tests and checks | Implemented (core) | Unit tests under `src/lib/__tests__/`, UI snapshots under `src/components/__tests__/`, Firestore rules tests under `src/rules/__tests__/`, Playwright smoke lanes under `e2e/`, `scripts/provisioning-emulator-acceptance.mjs`, and CI scripts in `package.json` |
| 23 | Sales workflow (attention queue/count, readiness, follow-ups, request-ID-bound current change handling, lifecycle, approval queue and exact action execution) | Implemented (branch; approval callables and workflow rules deploy pending) | `src/App.jsx`, `src/lib/quoteWorkflow.js`, `src/components/SalesWorkflowModal.jsx`, `src/components/QuoteHistoryModal.jsx`, `src/lib/quoteStore.js`, `functions/approvalWorkflow.js`, `functions/contractWorkflow.js`, `functions/index.js` (approval and governed-action callables), `firestore.rules` |
| 24 | Tenant Import Studio (customer/catalog CSV recognition, validation, receipts, rollback) | Implemented (branch) | `src/components/ImportStudioModal.jsx`, `src/lib/importStudio.js`, `src/lib/importBatchService.js`, `firestore.rules` (`importBatches`) |
| 25 | Platform tenant provisioning (verified owner, neutral defaults, atomic create, explicit entitlements, repair, cleanup) | Implemented (branch; production acceptance pending) | `functions/index.js` (`preflightCustomerOrder`, `provisionCustomerOrder`, `repairCustomerProvisioningOrder`, cleanup callables), `src/components/IntegrationOpsModal.jsx`, `scripts/provisioning-emulator-acceptance.mjs` |

## Guided Flow (Where It Lives)
- Wizard flow entry and steps: `src/App.jsx`
- Wizard step model + validation + template defaults: `src/lib/wizardUi.js`
- Step components: `src/components/WizardSteps.jsx`
- Guided recommendation engine: `src/lib/recommendations.js`
- Guided selling toggle and rules config: `src/components/AdminCatalogModal.jsx`
- Default guided rules and normalization: `src/data/mockCatalog.js`

## Notes
- Non-dev fail-fast catalog behavior is implemented in `src/hooks/useCatalogData.js` and surfaced by blocking UI in `src/App.jsx`.
- New-tenant quote creation remains gated until a named positive-price package,
  an event type, and explicit pricing review are saved. Authoritative pricing
  rejects unconfirmed settings.
- Catalog persistence compares the originally loaded fingerprints and patches
  only changed records/settings; stale edits and identifier collisions require
  a reload instead of overwriting remote changes.
- Trusted Firebase edits re-price from current tenant configuration and
  atomically update quote/portal state with a new immutable version. Reopen and
  permanent cleanup are admin-callable operations; direct quote/portal deletes
  are denied, and terminal commercial evidence cannot be reopened or
  overwritten.
- Quote History derives expiry without a staff write for non-admin readers. An
  admin expiry persists only status, lifecycle, and update time to the quote and
  matching portal in one rules-enforced batch; a quote-only or portal-only
  transition is denied. Unresolved deliveries stay visible with persistence
  deferred until provider review, and one malformed legacy portal cannot blank
  the history list. The admin `Reopen` action restores an eligible expired quote
  as a draft with a new portal issuance.
- Firebase payment-request email, contract conversion, portal rotation, and
  permanent deletion require an exact approved request. Functions record the
  server-owned execution outcome in the quote workflow and in an admin-readable,
  server-write-only organization audit record.
- Stripe deposit and final-balance requests use separate exact approvals and
  payment rails. Deposit scope binds the quote revision, portal issuance,
  recipient, currency, and amount. Final balance additionally requires a
  booked contract and verified provider-paid deposit, derives the remainder
  from authoritative totals, and binds the contract and deposit evidence. A
  versioned ledger plus `payment.finalBalance` projection prevents one rail
  from rewriting the other.
  Both resumable server operations register a prepared Session with no
  browser-readable link, keep QuotePilot's URL copy only in a client-denied
  private dispatch record, and publish to the quote/portal only after durable
  email-provider acceptance. Ambiguous creation or send outcomes reuse the
  exact approval and executing-admin/provider identities; durable acceptance
  resumes publication without another send, while definite failure requires
  safe checkout neutralization before a new approval. Direct standalone
  checkout creation and browser payment-evidence writes fail closed.
  Explicit `STRIPE_MODE` must match the key and provider objects. Four signed
  Checkout Session events drive monotonic, payment-kind-isolated state, and
  same-tenant admins can reconcile the exact server-recorded Session for each
  rail. This source branch has no hosted Stripe test/live acceptance. Refund
  initiation/status and dispute handling remain manual or unimplemented.
- Firebase quote email is bound to the saved revision and portal issuance. Only
  server-recorded provider acceptance owns the `sent` transition, and only
  acceptance for the exact current valid issuance activates its portal. If the
  provider accepts a message whose issuance is invalid or expired, QuotePilot
  retains that evidence as `requires_rotation` while keeping the portal
  inactive; guarded rotation and a separate accepted send are required.
- A definite provider failure whose safe retry window has expired starts a
  fresh delivery generation. An ambiguous outcome remains locked for same-key
  retry or audited provider review, and known server-observed acceptance cannot
  be reconciled as no-send. Generic staff updates cannot claim `sent` or
  `viewed`; the customer portal owns actual view evidence.
- Copy Portal and the PDF portal link require evidence for the exact current
  issuance and remain withheld after rotation. Legacy portal projections
  without `deliveryEvidence` fail closed and must recover through an approved
  resend or truthful provider reconciliation; projection backfill never
  fabricates acceptance evidence.
- Menu backfill for `pricingType` + `active` is implemented in `scripts/seed-firestore-menu.mjs`.
- Multi-tenant org scoping is authoritative for protected catalog and quote
  writes. Direct quote creation is denied in Firestore; trusted Functions
  create canonical drafts, and existing write/version flows require an
  org-scoped quote instead of auto-migrating legacy global data.
- Feature flags for optional surfaces (portal/schedule/integrations/diagnostics/reporting/compare/guided selling) are normalized in `src/App.jsx` and managed in `src/components/AdminCatalogModal.jsx`.
- Firebase browser smoke coverage now includes both auth+rules and authoritative-pricing lanes under `e2e/`.
