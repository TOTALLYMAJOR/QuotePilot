# Feature Matrix

Last updated: August 9, 2026

This matrix maps the master feature checklist to current implementation and source locations.

## Status Legend
- `Implemented`: shipped and wired in the app.
- `Implemented (source)`: present in the current source with local
  implementation evidence, but not yet deployed or production-accepted;
  release-gate status remains in `PROJECT_STATUS.md`.
- `Implemented (deployed)`: present in the verified production revision; any
  remaining hosted or human-acceptance boundary is stated in the row and in
  `PROJECT_STATUS.md`.
- `Partial`: present but not complete against all desired behaviors.
- `Optional`: optional capability tracked but not required for core flow.

## Master Checklist Mapping

| # | Feature Area | Status | Primary Evidence |
|---|---|---|---|
| 1 | Data + architecture collections/model | Implemented | `src/lib/organizationService.js`, `src/context/OrganizationContext.jsx`, `firestore.rules`, `functions/index.js`, `scripts/seed-firestore-menu.mjs`, `scripts/migrate-to-multi-tenant.mjs` |
| 2 | Dynamic menu system (Firestore + event filtering + grouping + active items) | Implemented | `src/hooks/useCatalogData.js` (changed-record transactions + conflict detection), `src/lib/menuService.js`, `src/components/WizardSteps.jsx` |
| 3 | Pricing engine (`per_item`, `per_person`, `per_event`, selected package inclusions without double charge) | Implemented (source) | `src/lib/quoteCalculator.js`, `functions/pricingEngine.js` (confirmed-setup gate and authoritative inclusion refs), `src/lib/pricingContracts.js`, `src/lib/commerceOps.js`, `src/components/LiveBreakdown.jsx` |
| 4 | 5-step quote builder wizard | Implemented | `src/lib/wizardUi.js` (`WIZARD_STEP_DEFINITIONS`), `src/components/WizardSteps.jsx`, `src/App.jsx`, `src/components/__tests__/wizardVisualSnapshots.test.jsx`, `e2e/quote-wizard.smoke.spec.js` |
| 5 | Live sticky summary panel with real-time totals | Implemented (local mobile acceptance) | `src/components/LiveBreakdown.jsx`, `src/App.jsx` (`MobilePricingSummary`), `src/styles.css` (`.breakdown-panel`, `.mobile-pricing-summary`), `e2e/quote-wizard.smoke.spec.js` |
| 6 | Quote system (trusted create/duplicate/edit, snapshots, statuses) | Implemented (source) | `functions/index.js` (`createQuoteDraft`, `duplicateQuoteDraft`, `updateQuoteDraft`), `functions/quoteCreation.js`, `src/lib/quoteStore.js` (`submitQuote`, `duplicateQuote`, `updateQuote`), `src/components/QuoteHistoryModal.jsx` |
| 7 | Quote history + versioning | Implemented | `src/lib/quoteStore.js` (`saveQuoteVersion`, `getQuoteHistory`), `firestore.rules` (`organizations/{orgId}/quotes/{quoteId}/versions/{versionId}`) |
| 8 | Quote management UI (list, sort, filters, exact draft-save handoff, role-safe actions, revision-bound email delivery, evidence-gated portal sharing and conversation with bounded same-session unresolved-request restoration, isolated Stripe deposit and final-balance request/reconciliation rails, provider-owned payment status) | Implemented (source) | `src/components/QuoteHistoryModal.jsx`, `src/components/QuoteConversationPanel.jsx`, `src/lib/quoteStore.js` (`duplicateQuote`, `reopenQuote`, `hardDeleteQuote`), `src/lib/portalConversationClient.js`, `src/lib/commerceOps.js`, `src/lib/proposalExport.js`, `functions/quoteDelivery.js`, `functions/portalConversation.js`, `functions/paymentApprovalScope.js`, `functions/paymentDispatchState.js`, `functions/paymentSafety.js`, `functions/paymentLedger.js`, `functions/finalBalancePayment.js`, `functions/stripeProviderState.js`, `functions/index.js` (`getQuotePortalConversation`, `sendQuotePortalConversationMessage`, `sendQuoteToCustomer`, `resolveQuoteDeliveryOutcome`, `sendPaymentRequestEmail`, `sendFinalBalanceRequestEmail`, `reconcileDepositCheckout`, `reconcileFinalBalanceCheckout`, `stripeWebhook`, disabled direct `createDepositCheckout`, `rotateQuotePortalKey`, `reopenQuote`, `hardDeleteQuote`; the legacy bulk purge callable fails closed), `firestore.rules` (`privatePaymentDispatches` and quote conversation records are server-only) |
| 9 | Admin panel tabbed UX + hierarchical menu management | Implemented | `src/components/AdminCatalogModal.jsx`, `src/styles.css` (`.admin-tabs`) |
| 10 | Inline editing with blur/enter persistence | Implemented | `src/components/AdminCatalogModal.jsx` (`handleManagedMenuItemBlur`, `handleManagedMenuItemKeyDown`) |
| 11 | Booking lifecycle (availability checks, approval-bound contract conversion with receipt-safe uncertainty/reconciliation/recovery states, customer-linked immutable source version, confirmations, staff assignments) | Implemented (deployed baseline; new mutation-state UI and customer-linked immutable-version projection are source/local only; coordinated deployment and hosted acceptance pending) | `functions/contractWorkflow.js`, `functions/quoteCreation.js` (`projectCustomerIdentityToImmutableVersion`), `functions/index.js` (`convertQuoteToContract`), `src/lib/quoteStore.js` (`checkEventAvailability`, `convertQuoteToContract`, `updateQuoteBookingConfirmation`, `updateQuoteBookingAssignment`), `src/components/EventScheduleModal.jsx`, `src/components/QuoteHistoryModal.jsx`, `src/components/CustomerWorkspaceView.jsx`, `src/components/__tests__/quoteHistoryContractConversion.test.jsx`, `scripts/provisioning-emulator-acceptance.mjs` |
| 12 | Customer decision center (tenant theme presets + snapshotted portal branding + scope/pricing + evidence-bound quote conversation + callable-owned electronic acceptance receipt + change request/decline + evidence-bound token lifecycle) | Implemented (source; conversation and acceptance callable/rules deploy pending) | `src/data/portalThemePresets.js`, `src/components/AdminCatalogModal.jsx`, `src/components/CustomerPortalView.jsx`, `src/components/QuoteConversationPanel.jsx`, `src/lib/quoteStore.js` (`getPortalQuote`, `updatePortalDecision`, `rotateQuotePortalKey`), `src/lib/portalConversationClient.js`, `functions/quoteCreation.js`, `functions/proposalAcceptance.js`, `functions/quoteDelivery.js`, `functions/portalConversation.js`, `functions/index.js` (`getQuotePortalConversation`, `sendQuotePortalConversationMessage`, `acceptQuoteProposal`), `firestore.rules` (`customerPortalQuotes`, `portalConversationMessages`, `proposalAcceptanceReceipts`) |
| 13 | Admin-only provider operations + scoped integration audit logging | Implemented (source; provider activation pending) | `src/components/IntegrationOpsModal.jsx`, `src/lib/quoteStore.js` (`recordQuoteIntegrationSync`; browser CRM sends fail closed), `src/lib/commerceOps.js`, `functions/index.js` (admin-only provider callables) |
| 14 | Reporting dashboard (pipeline, conversion, accepted/booked quote value, and separately verified paid-deposit totals; not accounting revenue) | Implemented (source labels; existing metrics capability deployed) | `src/components/ReportingDashboardModal.jsx`, `src/lib/quoteStore.js` (`getQuoteHistory`) |
| 15 | Event schedule board (month/week, conflicts, assignments, production checklist, and separately labeled quote/booking-confirmation states) | Implemented (source semantics; existing schedule capability deployed) | `src/components/EventScheduleModal.jsx`, `src/lib/statusSemantics.js`, `src/lib/quoteStore.js` (`getQuoteHistory`, `updateQuoteBookingAssignment`, `updateQuoteProductionChecklist`) |
| 16 | Session diagnostics (runtime capture + staff export/clear tools) | Implemented | `src/lib/sessionDiagnostics.js`, `src/components/DiagnosticsModal.jsx`, `src/main.jsx`, `src/App.jsx` |
| 17 | Global event + organization context across surfaces | Implemented | `src/context/EventTypeContext.jsx`, `src/context/OrganizationContext.jsx`, `src/main.jsx`, `src/App.jsx`, `src/components/AdminCatalogModal.jsx` |
| 18 | Verified-email auth, email/password recovery with same-confirmation UI and QuotePilot return URL, org bootstrap, and role-gated controls | Implemented (source; hosted Auth configuration pending) | `src/lib/authClient.js`, `src/hooks/useAuthSession.js`, `src/components/AuthGate.jsx`, `e2e/firebase-auth-rules.smoke.spec.js`, `functions/index.js` (`ensureOrganizationBootstrap`), `firestore.rules` |
| 19 | Optional guided selling recommendations + rules | Implemented / Optional | `src/lib/recommendations.js`, `src/components/AdminCatalogModal.jsx`, `src/data/mockCatalog.js` |
| 20 | Good/Better/Best scenario compare workflow | Implemented / Optional | `src/lib/quoteWorkflow.js` (`buildQuoteScenarios`), `src/components/QuoteCompareModal.jsx`, `src/App.jsx` |
| 21 | Optional admin security/audit depth (beyond role gating) | Partial / Optional | Role-gated access and rules are shipped in `src/hooks/useAuthSession.js`, `src/components/AuthGate.jsx`, `firestore.rules`; sync log audit trail exists in `src/lib/quoteStore.js`, but full cross-surface audit pipeline remains limited |
| 22 | QA acceptance tests and checks, including independent lazy-surface recovery, embedded-route semantics, and focus-contained contextual/legacy dialogs | Implemented (core) | Unit tests under `src/lib/__tests__/`, UI snapshots and recovery contracts under `src/components/__tests__/`, Firestore rules tests under `src/rules/__tests__/`, Playwright smoke and real chunk-failure accessibility lanes under `e2e/`, `scripts/provisioning-emulator-acceptance.mjs`, and CI scripts in `package.json` |
| 23 | Sales workflow (attention queue/count, readiness, follow-ups, request-ID-bound current change handling, lifecycle, approval queue and exact action execution) | Implemented (deployed; hosted acceptance pending) | `src/App.jsx`, `src/lib/quoteWorkflow.js`, `src/components/SalesWorkflowModal.jsx`, `src/components/QuoteHistoryModal.jsx`, `src/lib/quoteStore.js`, `functions/approvalWorkflow.js`, `functions/contractWorkflow.js`, `functions/index.js` (approval and governed-action callables), `firestore.rules` |
| 24 | Tenant Import Studio (customer/catalog CSV recognition, validation, receipts, rollback) with stable unresolved batch identity and locked reconciliation controls | Implemented (catalog path deployed; trusted customer callable source, coordinated deploy and hosted smoke pending) | `src/components/ImportStudioModal.jsx`, `src/lib/importStudio.js`, `src/lib/importBatchService.js`, `functions/index.js` (`createCustomerImportBatch`, `rollbackCustomerImportBatch`), `firestore.rules` (`customers`, `importBatches`) |
| 25 | Platform tenant provisioning (verified owner, neutral defaults, atomic create, explicit entitlements, repair, cleanup) | Implemented (deployed; owner acceptance pending) | `functions/index.js` (`preflightCustomerOrder`, `provisionCustomerOrder`, `repairCustomerProvisioningOrder`, cleanup callables), `src/components/IntegrationOpsModal.jsx`, `scripts/provisioning-emulator-acceptance.mjs` |
| 26 | Public $1 invoice-first buyer onboarding on `tonicatering` (Turnstile, pre-identity HMAC-keyed create reservation and status abuse controls, request-scoped exact retry plus signed or audited operator provider-void replacement, Stripe API `2024-06-20` Hosted Invoice Page and signed invoice lifecycle, terminal unpaid Invoice recovery, paid workspace preparation, pending invite, optional provider-accepted activation instructions, exact verified-email user activation, quote-rail isolation) | Implemented (source; deployment, provider, hosted acceptance, and live launch pending) | `src/components/BuyerAccessPage.jsx`, `src/lib/buyerAccess.js`, `functions/buyerAccess.js`, `functions/index.js` (`repairBuyerAccessInvoice`, `createBuyerAccessInvoice`, `getBuyerAccessInvoiceStatus`, `buyerAccessStripeWebhook`), `src/components/IntegrationOpsModal.jsx`, Firebase Secret Manager bindings, `firestore.rules` (`buyerAccessOrders`), `e2e/buyer-access.spec.js`, `scripts/provisioning-emulator-acceptance.mjs` |
| 27 | Staff Kitchen BEO export (timing, staffing, checkpoints, selections, checklist, revision/generated stamps, day-of contacts, allergens, prepared-by/chef sign-off, day-of notes) | Implemented (source; hosted operator acceptance pending) | `src/components/QuoteHistoryModal.jsx`, `src/lib/beoPayload.js`, `src/lib/beoExport.js`, `src/lib/quoteWorkflow.js`, `src/lib/__tests__/beoPayload.test.js`, `src/lib/__tests__/quoteWorkflow.test.js` |
| 28 | Trusted customer projection from quote create/edit (organization scoped, duplicate-safe, import-preserving, browser-forgery denied) | Implemented (source; Functions/rules deploy and hosted acceptance pending) | `functions/index.js`, `functions/quoteCreation.js`, `firestore.rules` (`customers`), `src/lib/__tests__/quoteCreation.server.test.js`, `src/rules/__tests__/firestore.rules.test.js` |
| 29 | Temporary-flagged customer-centered staff shell and Commercial Command Center: dependency-free `/app` route parsing/navigation, Home default, sticky in-memory quote builder, direct/deep routes, customer-name-to-360 links, exact quote/payment and Workflow focus, authenticated 404, portal-query precedence, one generation-guarded Home/header snapshot over existing read contracts/data sources, a Home-scoped tenant/read/source/last-complete-read evidence rail with incomplete/stale/truncation truth, human-readable first-release staff formatting, primary-route heading focus, route-versus-modal return language, shared semantic status chips, and staff-scoped neutral chrome | Implemented (source/local qualified; exact hosted acceptance, wider evidence-rail expansion, and flag removal pending) | `src/lib/workspaceRoutes.js`, `src/lib/workspacePresentation.js`, `src/hooks/useBrowserLocation.js`, `src/hooks/useWorkspaceRouteHeadingFocus.js`, `src/context/WorkspaceNavigationContext.jsx`, `src/components/WorkspaceRoute.jsx`, `src/hooks/useCommercialWorkspaceSnapshot.js`, `src/components/CommandCenterHome.jsx`, `src/components/StaffEvidenceRail.jsx`, `src/components/StatusChip.jsx`, `src/components/WorkspaceNotFound.jsx`, `src/components/QuoteHistoryModal.jsx`, `src/components/SalesWorkflowModal.jsx`, `src/lib/statusSemantics.js`, `src/App.jsx`, `src/styles.css`, focused tests under `src/lib/__tests__`, `src/hooks/__tests__`, `src/context/__tests__`, and `src/components/__tests__` |
| 30 | Stable same-tenant customer identity and Internal Customer 360: generated server-owned `customerId` on trusted new quote/version writes, private server-only normalized-email ownership claims, collision-safe edits, normalized customer search, rules-bounded paginated directory, bounded derived Overview/Quotes & Proposals/Events/Money/Conversations, most-recent version/truncation metadata, per-quote conversation summaries, portal-safe staff preview, emulator-only legacy binding apply, canonical quote staff-only reads, and retired browser customer-role self-bootstrap | Implemented (source; production normalization/backfill, deployment, hosted staff acceptance, and persistent customer accounts excluded) | `functions/quoteCreation.js`, `functions/index.js`, `src/lib/customerWorkspace.js`, `src/components/CustomerDirectoryView.jsx`, `src/components/CustomerWorkspaceView.jsx`, `scripts/customer-id-backfill-plan.mjs`, `scripts/backfill-customer-ids.mjs`, `firestore.rules`, `src/lib/__tests__/quoteCreation.server.test.js`, `src/lib/__tests__/customerWorkspace.test.js`, `src/lib/__tests__/customerIdBackfill.test.js`, `src/lib/__tests__/customerIdBackfill.emulator.test.js`, `src/rules/__tests__/firestore.rules.test.js` |
| 31 | Routed operational workspaces for Schedule, Reporting, Catalog, Imports, Integrations, and Diagnostics with recoverable lazy loading, sticky route state, embedded-region focus, retained role/feature gates, and compatible contextual/legacy modal wrappers | Implemented (source/local qualified; hosted flag-on acceptance pending) | `src/App.jsx`, `src/components/EventScheduleModal.jsx` (`EventScheduleView`), `src/components/ReportingDashboardModal.jsx` (`ReportingDashboardView`), `src/components/AdminCatalogModal.jsx` (`AdminCatalogView`), `src/components/ImportStudioModal.jsx` (`ImportStudioView`), `src/components/IntegrationOpsModal.jsx` (`IntegrationOpsView`), `src/components/DiagnosticsModal.jsx` (`DiagnosticsView`), `src/components/__tests__/operationalWorkspaceViews.test.jsx`, `src/components/__tests__/adminCatalogStarterChoice.test.jsx`, `src/components/__tests__/importStudioPresentation.test.jsx`, `src/components/__tests__/uiRecovery.test.jsx` |
| 32 | Mechanical no-orphan-capability delivery gate: fail-closed branch/PR/push authority-path review including deletions, same-upstream fallback, broad runtime-client authority discovery, chained/modular Firestore writes, exact ownership for directly changed/new/removed Firebase Function exports, shared-helper affected-export review across every classification, real frontend/manual/matrix locators, assertion-bearing tests, canonical per-state read/mutation markers, one narrow stale-read exception, and tested non-callable headless outcomes | Implemented (source; structural traceability only, not semantic/visual/hosted acceptance) | `scripts/check-capability-surfacing.mjs`, `docs/capability-surfacing-contracts.json`, `src/lib/__tests__/capabilitySurfacingGate.test.js`, `scripts/orchestration-lanes.sh` (`lane:core`), `package.json` (`check:capability-surfaces`) |

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
  rail. This source has no hosted Stripe test/live acceptance. Refund
  initiation/status and dispute handling remain manual or unimplemented.
- Generic Resend and quote Stripe API/webhook credentials are strict Firebase
  Secret Manager bindings on only their consuming Functions; the generic
  webhook does not receive the API key. The Functions dotenv materializer
  rejects all three values. Fresh provider rotation, ordered webhook overlap,
  exact hosted UAT, and revocation of the known exposed/cached values remain a
  hard release blocker.
- The public `/start` path uses the existing `tonicatering` Firebase project but
  remains an independently disabled Stripe test rail. Browser route and CTA
  flags require a syntactically valid non-placeholder public Turnstile site key;
  Cloudflare setup and human review remain separate evidence. The server
  separately verifies exact hosts/actions, reserves a request-scoped HMAC-keyed
  create lease before identity/order reads, consumes the public status network
  lease once per request before its first buyer-order read, and holds its
  Turnstile, buyer Stripe, and rate-limit secrets in Firebase Secret Manager.
  Exact create retries recharge
  network capacity without a duplicate email charge during the 24-hour
  reservation; only a prior signed-void order may be superseded after that
  email window.
  `createBuyerAccessInvoice` creates a true fixed $1 Hosted Invoice Page, and
  the dedicated buyer API client and webhook endpoint are pinned to Stripe API
  version `2024-06-20`; the generic quote Stripe client remains unchanged. Only
  the four supported signed, deduplicated invoice events may establish payment
  state. `invoice.paid` prepares the organization, neutral settings, Starter
  workspace plan entitlements, provisioning record, and pending invitation, but
  no user membership, admin role, claims, or access. `activation_sent` requires
  durably recorded onboarding-email provider acceptance. Independently,
  token-bound `provisioning` with `workspaceReady=true` offers a manual `/app`
  exact-email Firebase verification path and stops automatic polling without
  claiming Resend acceptance, membership, claims, or access. Only an exact
  matching verified Firebase email may consume the invite, and only `active`
  is access-ready.
  Controlled test-mode markers require exclusion from live revenue and paid-
  customer reporting. The quote-payment mode, credentials, `stripeWebhook`,
  deposit, and final-balance rails remain isolated. This is branch/source
  evidence, not Turnstile, Stripe, Firebase-delivery, hosted, or live-launch
  acceptance.
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
- Proposal acceptance is callable-owned and revision-preconditioned. The server
  requires the displayed portal projection to match the complete saved quote,
  records typed signer and versioned consent evidence, stores all receipt money
  in integer USD minor units, hashes the signed proposal snapshot, and creates
  a tenant-readable/server-write-only receipt. Firestore denies direct browser
  acceptance; payment and booking remain separate states.
- Menu backfill for `pricingType` + `active` is implemented in `scripts/seed-firestore-menu.mjs`.
- Multi-tenant org scoping is authoritative for protected catalog and quote
  writes. Direct quote creation is denied in Firestore; trusted Functions
  create canonical drafts, and existing write/version flows require an
  org-scoped quote instead of auto-migrating legacy global data.
- Feature flags for optional surfaces (portal/schedule/integrations/diagnostics/reporting/compare/guided selling) are normalized in `src/App.jsx` and managed in `src/components/AdminCatalogModal.jsx`.
- Firebase browser smoke coverage now includes both auth+rules and authoritative-pricing lanes under `e2e/`.
