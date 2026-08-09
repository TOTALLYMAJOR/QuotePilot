const functions = require("firebase-functions/v1");
const { initializeApp } = require("firebase-admin/app");
const { getAuth } = require("firebase-admin/auth");
const { createHash, createHmac, randomInt, randomUUID, timingSafeEqual } = require("node:crypto");
const { FieldPath, FieldValue, Timestamp, getFirestore } = require("firebase-admin/firestore");
const Stripe = require("stripe");
const twilio = require("twilio");
const { Resend } = require("resend");
const { Webhook } = require("standardwebhooks");
const {
  PricingEngineError,
  assertPricingCatalogAuthorityCurrent,
  buildPricingCatalogAuthority,
  calculateQuotePricingAuthoritative
} = require("./pricingEngine");
const {
  CommercialChangeImpactPreviewError,
  buildCommercialChangeImpactPreviewSnapshots
} = require("./commercialChangeImpactPreview");
const {
  COMMERCIAL_CHANGE_RECONCILIATION_EVIDENCE_VERSION,
  CommercialChangeAuthorityError,
  createCommercialChangeAuthority
} = require("./commercialChangeAuthority");
const {
  createCommercialChangeImpactEvaluator
} = require("./commercialChangeImpactEvaluator");
const {
  QuoteCreationError,
  bindCustomerIdentityToQuoteDocuments,
  buildCanonicalPortalSnapshot,
  buildCustomerEmailClaim,
  buildCustomerProjection,
  buildDuplicateQuoteForm,
  buildPortalRotationDocuments,
  buildQuoteReopenDocuments,
  buildServerQuoteNumber,
  buildTrustedQuoteCreationDocuments,
  buildTrustedQuoteEditDocuments,
  customerEmailClaimDocumentId,
  customerProjectionDocumentId,
  projectCustomerIdentityToImmutableVersion,
  sanitizeQuoteCreationRequest
} = require("./quoteCreation");
const {
  RebookQuoteDraftError,
  assertRebookCurrentEventDate,
  assertRebookReviewComplete,
  buildRebookDraftId,
  buildRebookProvenance,
  matchesRebookDraft,
  normalizeRebookQuoteDraftRequest,
  overlayCurrentCustomerContact,
  resolveAcceptedRebookSource
} = require("./rebookQuoteDraft");
const {
  PostEventCloseoutError,
  addCalendarDaysDateOnly,
  assertPostEventCloseoutMatchesSource,
  buildPostEventCloseoutPolicySnapshot,
  buildPostEventCloseoutRecord,
  normalizePostEventCloseoutActionRequest,
  normalizePostEventCloseoutPolicyRefreshRequest,
  planPostEventCloseoutAction,
  planPostEventCloseoutPolicyRefresh,
  resolvePostEventCloseoutSource
} = require("./postEventCloseout");
const commercialDependencyGraphCore = require("./commercialDependencyGraphCore.cjs");
const {
  KITCHEN_BEO_FRESHNESS_STATES,
  KITCHEN_BEO_STATUS_SCHEMA_VERSION,
  KitchenBeoAuthorityError,
  createKitchenBeoAuthority
} = require("./kitchenBeoAuthority");
const { renderKitchenBeoPdf } = require("./kitchenBeoPdf");
const {
  DEFAULT_DECISION_DEBT_POLICY,
  DecisionDebtError,
  createDecisionDebtAuthority
} = require("./decisionDebt");
const {
  REVENUE_AUTOPILOT_JOB_STATES,
  RevenueAutopilotError,
  buildRevenueAutopilotAttentionIdentity,
  buildRevenueAutopilotOccurrences,
  claimRevenueAutopilotJob,
  evaluateRevenueAutopilotQuoteActivity,
  planRevenueAutopilotDispatchFailure,
  planRevenueAutopilotExecution,
  planRevenueAutopilotJobStops,
  planRevenueAutopilotMaterialization,
  planRevenueAutopilotOutcomeResolution,
  planRevenueAutopilotScheduleMode,
  planUnreadCustomerReplyAttentionTransition,
  recordRevenueAutopilotProviderAcceptance,
  recordRevenueAutopilotProviderEvent,
  tenantCalendarContext
} = require("./revenueAutopilot");
const {
  RevenueAutopilotTemplateError,
  renderRevenueAutopilotTemplate
} = require("./revenueAutopilotTemplates");
const {
  RevenueAutopilotAuthorityError,
  buildRevenueAutopilotConversationEvidence,
  buildRevenueAutopilotMaterializationInput,
  dormantRevenueAutopilotTenantPolicy,
  hashRevenueAutopilotUnsubscribeToken,
  normalizeRevenueAutopilotEmailControls,
  normalizeRevenueAutopilotTenantPolicy,
  planRevenueAutopilotAdminConfiguration,
  planRevenueAutopilotEmailControlUpdate,
  planRevenueAutopilotMaterializationFromCanonical,
  planRevenueAutopilotStaffAcknowledgementReceipt,
  projectRevenueAutopilotAuthorityForStaff,
  verifyRevenueAutopilotUnsubscribeToken
} = require("./revenueAutopilotAuthority");
const {
  buildExistingOrderMessage,
  buildExistingOrganizationMessage,
  canProvisionOrganization,
  findConflictingOrganizationScope,
  hasExistingProvisioningTarget,
  isAlreadyExistsError,
  isConfiguredAppHost
} = require("./provisioningPolicy");
const {
  FEATURE_FLAG_KEYS,
  FEATURE_FLAG_LABELS,
  FEATURE_PLAN_PRESETS
} = require("./featurePlans");
const {
  PaymentSafetyError,
  assertCheckoutPaymentTransition,
  assertPaymentPortalIdentity,
  assertPreparedCheckoutPublicationTransition,
  assertPreparedCheckoutRegistrationTransition,
  buildPreparedCheckoutState,
  buildPublishedCheckoutState,
  buildStripeCheckoutIdempotencyKey,
  isKnownStripeSessionId,
  normalizeCheckoutTransitionState,
  planDepositCheckout,
  validateStripeCheckoutScope,
  validateStripeCheckoutCompletion
} = require("./paymentSafety");
const {
  ApprovalWorkflowError,
  assertApprovalActionRequestable,
  buildApprovalExecutionOutcome,
  buildApprovalExecutionStart,
  buildApprovalRequest,
  buildApprovalResolution,
  invalidatePaymentApprovalsForPortalRotation
} = require("./approvalWorkflow");
const {
  PaymentApprovalScopeError,
  assertPaymentApprovalRequestScope,
  buildFinalBalanceApprovalScope,
  buildPaymentApprovalScope
} = require("./paymentApprovalScope");
const {
  StripeProviderStateError,
  assertStripeObjectMode,
  assertStripeSecretKeyMode,
  mapStripeCheckoutObservation,
  mapStripeCheckoutReconciliation,
  normalizeStripeMode,
  planStripeCheckoutTransition
} = require("./stripeProviderState");
const {
  constructStripeWebhookEvent,
  normalizeStripeWebhookSecrets
} = require("./stripeWebhookSecrets");
const {
  PaymentDispatchStateError,
  beginPaymentDispatchAttempt,
  normalizePaymentDispatch,
  planExpiredPortalPaymentDispatchRecovery,
  planPaymentDispatchFailure,
  planPaymentDispatchResume,
  recordPaymentDispatchProviderAcceptance
} = require("./paymentDispatchState");
const {
  buildFinalBalanceStripeScopeQuote,
  finalBalanceStoredState,
  ledgerStateForProviderState,
  normalizeFinalBalanceCheckoutPayment,
  planFinalBalanceLedgerTransition,
  projectQuotePaymentLedger,
  quotePaymentAmounts
} = require("./finalBalancePayment");
const { PaymentLedgerError } = require("./paymentLedger");
const { portalRotationPaymentKinds } = require("./portalRotationPayment");
const {
  ContractWorkflowError,
  planContractConversion
} = require("./contractWorkflow");
const {
  ACCEPTANCE_CONSENT_VERSION,
  ProposalAcceptanceError,
  matchesAcceptanceRetry,
  planProposalAcceptance
} = require("./proposalAcceptance");
const {
  ProductAnalyticsError,
  sanitizeAnalyticsBatch,
  summarizeAnalyticsEvents
} = require("./productAnalytics");
const { buildOperationsAuditSnapshot } = require("./operationsAudit");
const {
  StarterCatalogPackError,
  applyStarterCatalogPack: applyStarterCatalogPackInternal,
  confirmCatalogPricing: confirmCatalogPricingInternal,
  mutateManagedMenuItemAvailability: mutateManagedMenuItemAvailabilityInternal
} = require("./starterCatalogPacks");
const {
  CatalogImportError,
  createCatalogImportBatch: createCatalogImportBatchInternal,
  rollbackCatalogImportBatch: rollbackCatalogImportBatchInternal
} = require("./catalogImportBatches");
const {
  QuoteDeliveryError,
  assertNoConflictingQuoteExecution,
  assertQuoteDeliveryPortalActivation,
  assertQuoteDeliveryPortalSnapshot,
  assertQuoteDeliveryRevision,
  assertQuoteEditNotDispatching,
  buildQuoteDeliverySuccess,
  classifyQuoteDeliveryAttemptError,
  claimQuoteDelivery,
  normalizeProviderMessageId,
  planQuoteDeliveryAttemptFailure,
  planQuoteDeliveryOutcomeResolution,
  resolveQuoteDeliveryRevisionId
} = require("./quoteDelivery");
const {
  PORTAL_CONVERSATION_RATE_LIMIT,
  PORTAL_CONVERSATION_RATE_WINDOW_MS,
  PORTAL_CONVERSATION_TOTAL_MESSAGE_LIMIT,
  PortalConversationError,
  assertPortalConversationActivation,
  assertPortalConversationTotal,
  buildPortalConversationActor,
  buildPortalConversationMessage,
  buildPortalConversationRateKey,
  buildPortalConversationRequestKey,
  normalizePortalConversationRequest,
  planPortalConversationRate,
  projectPortalConversationMessage,
  sha256: portalConversationSha256
} = require("./portalConversation");
const {
  BUYER_ACCESS_AMOUNT_CENTS,
  BUYER_ACCESS_CURRENCY,
  BUYER_ACCESS_FLOW,
  BUYER_ACCESS_MODE,
  BUYER_ACCESS_PLAN,
  BUYER_ACCESS_STATUS_RATE_LIMIT,
  BUYER_ACCESS_STATUS_RATE_WINDOW_MS,
  BUYER_ACCESS_STRIPE_API_VERSION,
  CLOUDFLARE_TURNSTILE_ALWAYS_PASS_TEST_SECRET,
  BuyerAccessError,
  assertBuyerAccessInvoiceBinding,
  assertBuyerAccessRuntime,
  assertBuyerAccessTurnstileResult,
  authorizeBuyerAccessStatusRequest,
  buildBuyerAccessIdentifiers,
  buildBuyerAccessStripePlan,
  buyerAccessStripeIdempotencyKey,
  buyerAccessOrderIdForRequest,
  buyerAccessProviderStateForEvent,
  buyerAccessProviderStateForInvoice,
  buyerAccessRateLimitDocumentId,
  buyerAccessStatusResponse,
  buyerAccessStatusTokenMatches,
  hashBuyerAccessSecret,
  hasBuyerAccessReissuableVoidEvidence,
  isBuyerAccessInvoice,
  normalizeBuyerAccessRequest,
  normalizeBuyerAccessRepairRequest,
  normalizeBuyerAccessStatusRequest,
  normalizeBuyerAccessTurnstileHostnames,
  planBuyerAccessCreationReservation,
  planBuyerAccessRateLimit,
  planBuyerAccessTransition,
  resolveBuyerAccessBootstrapRecovery
} = require("./buyerAccess");
const {
  createPortalRecoveryThrottle,
  isPortalRecoveryToken,
  resolvePortalRecoveryContact
} = require("./portalRecovery");

initializeApp();

const auth = getAuth();
const db = getFirestore();
const REGION = "us-central1";
const ROLES_COLLECTION = "userRoles";
const ORGANIZATIONS_COLLECTION = "organizations";
const TENANT_DOMAINS_COLLECTION = "tenantDomains";
const STAFF_ROLES = new Set(["admin", "sales"]);
const ROLE_VALUES = new Set(["admin", "sales", "customer"]);
const INVITES_COLLECTION = "organizationInvites";
const ORGANIZATION_TOMBSTONES_COLLECTION = "organizationTombstones";
const SMS_PROVIDERS = new Set(["twilio", "none"]);
const EMAIL_PROVIDERS = new Set(["resend", "none"]);
const APPROVED_EMAIL_FROM_NAME = "QuotePilot by MBMApps";
const APPROVED_EMAIL_FROM_EMAIL = "quotepilot@leaguepilot.us";
const QUOTES_COLLECTION = "quotes";
const QUOTE_APPROVAL_EXECUTIONS_COLLECTION = "quoteApprovalExecutions";
const PRIVATE_PAYMENT_DISPATCHES_COLLECTION = "privatePaymentDispatches";
const PROPOSAL_ACCEPTANCE_RECEIPTS_COLLECTION = "proposalAcceptanceReceipts";
const PRODUCT_ANALYTICS_COLLECTION = "productAnalyticsEvents";
const PORTAL_COLLECTION = "customerPortalQuotes";
const CUSTOMER_EMAIL_CLAIMS_COLLECTION = "customerEmailClaims";
const CUSTOMER_IMPORT_BATCH_KIND = "customer";
const CUSTOMER_IMPORT_SOURCE = "import_studio";
const CUSTOMER_IMPORT_TYPE = "customers";
const CUSTOMER_IMPORT_MAX_RECORDS = 350;
const CUSTOMER_IMPORT_MAX_DUPLICATE_SCAN_RECORDS = 2000;
const CUSTOMER_IMPORT_MAX_TRANSACTION_WRITES = 500;
const PORTAL_CONVERSATION_MESSAGES_COLLECTION = "portalConversationMessages";
const PORTAL_CONVERSATION_REQUESTS_COLLECTION = "portalConversationRequests";
const PORTAL_CONVERSATION_RATE_LIMITS_COLLECTION = "portalConversationRateLimits";
const PORTAL_CONVERSATION_STATE_COLLECTION = "portalConversationState";
const POST_EVENT_CLOSEOUTS_COLLECTION = "postEventCloseouts";
const KITCHEN_BEO_ARTIFACTS_COLLECTION = "kitchenBeoArtifacts";
const KITCHEN_BEO_RECEIPTS_COLLECTION = "kitchenBeoGenerationReceipts";
const KITCHEN_BEO_RECEIPT_HISTORY_SCHEMA_VERSION = 1;
const KITCHEN_BEO_RECEIPT_HISTORY_LIMIT = 10;
const COMMERCIAL_CHANGE_SIMULATIONS_COLLECTION = "commercialChangeSimulations";
const COMMERCIAL_CHANGE_AUTHORIZATIONS_COLLECTION = "commercialChangeAuthorizations";
const COMMERCIAL_CHANGE_APPLY_RECEIPTS_COLLECTION = "commercialChangeApplyReceipts";
const COMMERCIAL_CHANGE_APPLY_OUTCOMES_COLLECTION = "commercialChangeApplyOutcomes";
const COMMERCIAL_CHANGE_RECONCILIATION_RECEIPTS_COLLECTION = "commercialChangeReconciliationReceipts";
const COMMERCIAL_CHANGE_APPROVAL_REQUESTS_COLLECTION = "commercialChangeApprovalRequests";
const COMMERCIAL_DEPENDENCY_STATE_COLLECTION = "commercialDependencyState";
const COMMERCIAL_DEPENDENCY_INVALIDATIONS_COLLECTION = "invalidations";
const DECISION_DEBT_POLICIES_COLLECTION = "decisionDebtPolicies";
const REVENUE_AUTOPILOT_TENANTS_COLLECTION = "revenueAutopilotTenants";
const REVENUE_AUTOPILOT_POLICY_COLLECTION = "revenueAutopilotPolicy";
const REVENUE_AUTOPILOT_TEMPLATES_COLLECTION = "revenueAutopilotTemplates";
const REVENUE_AUTOPILOT_JOBS_COLLECTION = "revenueAutopilotJobs";
const REVENUE_AUTOPILOT_ATTENTION_COLLECTION = "revenueAutopilotAttention";
const REVENUE_AUTOPILOT_RECEIPTS_COLLECTION = "revenueAutopilotReceipts";
const REVENUE_AUTOPILOT_PROVIDER_EVENTS_COLLECTION = "revenueAutopilotProviderEvents";
const REVENUE_AUTOPILOT_EMAIL_CONTROLS_COLLECTION = "revenueAutopilotEmailControls";
const REVENUE_AUTOPILOT_PROVIDER_MESSAGE_INDEX_COLLECTION = "revenueAutopilotProviderMessageIndex";
const REVENUE_AUTOPILOT_SCHEDULER_STATE_COLLECTION = "revenueAutopilotSchedulerState";
const PROVISIONING_ORDERS_COLLECTION = "provisioningOrders";
const WEBHOOK_EVENTS_COLLECTION = "webhookEvents";
const BUYER_ACCESS_ORDERS_COLLECTION = "buyerAccessOrders";
const BUYER_ACCESS_RATE_LIMITS_COLLECTION = "buyerAccessRateLimits";
const STRIPE_SECRET_NAME = "STRIPE_SECRET_KEY";
const STRIPE_WEBHOOK_SECRET_NAME = "STRIPE_WEBHOOK_SECRET";
const RESEND_API_KEY_SECRET_NAME = "RESEND_API_KEY";
const RESEND_WEBHOOK_SECRET_NAME = "RESEND_WEBHOOK_SECRET";
const REVENUE_AUTOPILOT_TOKEN_SECRET_NAME = "REVENUE_AUTOPILOT_TOKEN_SECRET";
const TWILIO_AUTH_TOKEN_SECRET_NAME = "TWILIO_AUTH_TOKEN";
const BUYER_ACCESS_STRIPE_SECRET_NAME = "BUYER_ACCESS_STRIPE_SECRET_KEY";
const BUYER_ACCESS_STRIPE_WEBHOOK_SECRET_NAME = "BUYER_ACCESS_STRIPE_WEBHOOK_SECRET";
const BUYER_ACCESS_TURNSTILE_SECRET_NAME = "BUYER_ACCESS_TURNSTILE_SECRET";
const BUYER_ACCESS_RATE_LIMIT_SECRET_NAME = "BUYER_ACCESS_RATE_LIMIT_SECRET";
const kitchenBeoAuthority = createKitchenBeoAuthority({
  graphCore: commercialDependencyGraphCore
});
const evaluateCommercialChangeImpact = createCommercialChangeImpactEvaluator({
  graphCore: commercialDependencyGraphCore
});
const commercialChangeAuthority = createCommercialChangeAuthority({
  graphCore: commercialDependencyGraphCore,
  buildPreviewSnapshots: buildCommercialChangeImpactPreviewSnapshots,
  simulateImpact: evaluateCommercialChangeImpact
});
const decisionDebtAuthority = createDecisionDebtAuthority({
  graphCore: commercialDependencyGraphCore
});
const PAYMENT_REQUEST_FLOWS = Object.freeze({
  deposit: Object.freeze({
    paymentKind: "deposit",
    action: "send_payment_request",
    label: "deposit",
    title: "Deposit Request",
    callableLabel: "payment request"
  }),
  final_balance: Object.freeze({
    paymentKind: "final_balance",
    action: "send_final_balance_request",
    label: "final balance",
    title: "Final Balance Request",
    callableLabel: "final-balance request"
  })
});
let cachedFunctionsConfig = undefined;
let functionsConfigErrorLogged = false;
const CLAIMS_VERSION = 1;
const PROVISIONING_EMAIL_LEASE_MS = 2 * 60 * 1000;
const QUOTE_DELIVERY_LEASE_MS = 2 * 60 * 1000;
const QUOTE_DELIVERY_RETRY_WINDOW_MS = 23 * 60 * 60 * 1000;
const PAYMENT_DISPATCH_RECOVERY_STALE_MS = 15 * 60 * 1000;
const PROVISIONING_INVITE_VALIDITY_MS = 7 * 24 * 60 * 60 * 1000;
const RESERVED_SUBDOMAINS = new Set(["www", "app", "api", "admin"]);
const UNKNOWN_HOST_WINDOW_MS = Math.max(1_000, Number(readConfig("security.unknown_host_window_ms", "300000")) || 300000);
const UNKNOWN_HOST_LIMIT = Math.max(1, Number(readConfig("security.unknown_host_limit", "20")) || 20);
const unknownHostCounter = new Map();
const recordPortalRecoveryAttempt = createPortalRecoveryThrottle();
function getFunctionsConfigSnapshot() {
  if (cachedFunctionsConfig !== undefined) {
    return cachedFunctionsConfig;
  }

  if (typeof functions.config !== "function") {
    cachedFunctionsConfig = {};
    return cachedFunctionsConfig;
  }

  try {
    const config = functions.config();
    cachedFunctionsConfig = config && typeof config === "object" ? config : {};
  } catch (err) {
    if (!functionsConfigErrorLogged) {
      functions.logger.warn("functions.config() unavailable; falling back to environment variables.", {
        message: normalizeText(err?.message).slice(0, 180)
      });
      functionsConfigErrorLogged = true;
    }
    cachedFunctionsConfig = {};
  }

  return cachedFunctionsConfig;
}

function readEnvConfig(path) {
  const envKey = String(path || "")
    .trim()
    .replace(/[^a-zA-Z0-9]+/g, "_")
    .replace(/^_+|_+$/g, "")
    .toUpperCase();
  if (!envKey) return { present: false, value: "" };
  return {
    present: Object.prototype.hasOwnProperty.call(process.env, envKey),
    value: normalizeText(process.env[envKey])
  };
}

function readConfig(path, fallback = "") {
  const envValue = readEnvConfig(path);
  if (envValue.present) return envValue.value;

  const config = getFunctionsConfigSnapshot();
  const value = path.split(".").reduce((acc, key) => (acc && acc[key] !== undefined ? acc[key] : undefined), config);
  if (value !== undefined && value !== null && String(value).trim()) {
    return String(value).trim();
  }
  return fallback;
}

function readBoundSecret(name) {
  const normalizedName = normalizeText(name).toUpperCase();
  if (!/^[A-Z][A-Z0-9_]{2,127}$/.test(normalizedName)) {
    throw new Error("Secret Manager binding name is invalid.");
  }
  const envValue = readEnvConfig(normalizedName);
  return envValue.present ? normalizeText(envValue.value) : "";
}

function readEmailSet(path) {
  return new Set(
    String(readConfig(path, "") || "")
      .split(",")
      .map((value) => normalizeEmail(value))
      .filter(Boolean)
  );
}

function isPlatformAdminEmail(email = "") {
  return readEmailSet("auth.platform_admin_emails").has(normalizeEmail(email));
}

function normalizeText(value) {
  return String(value || "").trim();
}

function getPaymentRequestFlow(paymentKind = "deposit") {
  const normalized = normalizeText(paymentKind).toLowerCase() || "deposit";
  const flow = PAYMENT_REQUEST_FLOWS[normalized];
  if (!flow) {
    throw new PaymentSafetyError("Stripe checkout payment kind is invalid.");
  }
  return flow;
}

function assertStripePaymentKindMetadata(session, paymentKind = "deposit") {
  const expected = getPaymentRequestFlow(paymentKind).paymentKind;
  const observed = normalizeText(session?.metadata?.paymentKind).toLowerCase();
  if ((observed || "deposit") !== expected) {
    throw new PaymentSafetyError(
      "Stripe checkout payment kind does not match the QuotePilot payment rail."
    );
  }
  return expected;
}

function checkoutPaymentForQuote(quote = {}, paymentKind = "deposit") {
  return paymentKind === "final_balance"
    ? normalizeFinalBalanceCheckoutPayment(quote?.payment)
    : normalizeCheckoutTransitionState(quote?.payment);
}

function paymentAmountCentsForQuote(quote = {}, paymentKind = "deposit") {
  if (paymentKind === "final_balance") {
    return quotePaymentAmounts(quote).finalBalanceCents;
  }
  const amount = Number(quote?.totals?.deposit);
  const cents = Math.round(amount * 100);
  if (!Number.isFinite(amount) || !Number.isSafeInteger(cents) || cents <= 0) {
    throw new PaymentSafetyError("Quote deposit must be greater than 0.");
  }
  return cents;
}

function stripeScopeQuoteForPayment(quote = {}, paymentKind = "deposit", checkoutPayment = null) {
  if (paymentKind === "final_balance") {
    return buildFinalBalanceStripeScopeQuote(quote, checkoutPayment);
  }
  if (!checkoutPayment) return quote;
  return {
    ...quote,
    payment: {
      ...(quote?.payment || {}),
      ...normalizeCheckoutTransitionState(checkoutPayment)
    }
  };
}

function storedPaymentStateForCheckout({
  paymentKind = "deposit",
  checkoutPayment,
  amountCents
} = {}) {
  const normalized = normalizeCheckoutTransitionState(checkoutPayment);
  return paymentKind === "final_balance"
    ? finalBalanceStoredState(normalized, {
      amountCents,
      currency: "usd"
    })
    : normalized;
}

function appendPaymentStateUpdate(update, {
  paymentKind = "deposit",
  checkoutPayment,
  amountCents,
  operationId,
  audit = {}
} = {}) {
  const stored = storedPaymentStateForCheckout({
    paymentKind,
    checkoutPayment,
    amountCents
  });
  if (paymentKind === "final_balance") {
    update["payment.finalBalance"] = stored;
    return stored;
  }
  for (const [key, value] of Object.entries(stored)) {
    update[`payment.${key}`] = value;
  }
  for (const [key, value] of Object.entries(audit)) {
    update[`payment.${key}`] = value;
  }
  return stored;
}

function portalPaymentState({
  paymentKind = "deposit",
  checkoutPayment,
  amountCents,
  operationId,
  audit = {}
} = {}) {
  const stored = storedPaymentStateForCheckout({
    paymentKind,
    checkoutPayment,
    amountCents
  });
  if (paymentKind === "final_balance") {
    const {
      stripeSessionId: _stripeSessionId,
      knownStripeSessionIds: _knownStripeSessionIds,
      ...customerSafe
    } = stored;
    return { finalBalance: customerSafe };
  }
  return { ...stored, ...audit };
}

function escapeHtml(value) {
  return String(value ?? "")
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
}

function withFallback(value, fallback = "") {
  const text = normalizeText(value);
  if (text) return text;
  return normalizeText(fallback);
}

function normalizeEmail(value) {
  return normalizeText(value).toLowerCase();
}

function isValidEmail(value) {
  return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(normalizeEmail(value));
}

function normalizeRole(value) {
  const role = normalizeText(value).toLowerCase();
  return ROLE_VALUES.has(role) ? role : "customer";
}

function normalizeOrganizationId(value) {
  const raw = normalizeText(value).toLowerCase();
  if (!raw) return "";
  return raw
    .replace(/[^\w-]+/g, "-")
    .replace(/-{2,}/g, "-")
    .replace(/^-|-$/g, "");
}

function isOrganizationRecordActive(data = {}) {
  const status = normalizeText(data?.status).toLowerCase();
  return data?.active !== false
    && data?.archived !== true
    && (status === "" || status === "active");
}

function normalizeHostname(value) {
  const raw = normalizeText(value).toLowerCase();
  if (!raw) return "";
  return raw
    .replace(/^https?:\/\//, "")
    .replace(/\/.*$/, "")
    .replace(/:\d+$/, "")
    .replace(/\.+$/, "");
}

function getBaseDomain() {
  const fromConfig = normalizeHostname(readConfig("app.base_domain", "mbmapps.com"));
  return fromConfig || "mbmapps.com";
}

function getHostType(hostname = "") {
  const normalizedHost = normalizeHostname(hostname);
  if (!normalizedHost) return "unknown";
  if (normalizedHost === "localhost" || normalizedHost.endsWith(".localhost")) return "local";
  if (normalizedHost === "127.0.0.1" || normalizedHost === "::1") return "local";
  if (normalizedHost.endsWith(".web.app") || normalizedHost.endsWith(".firebaseapp.com")) return "app";
  if (isConfiguredAppHost(
    normalizedHost,
    readConfig("app.base_url", "https://quotepilot.mbmapps.com/app")
  )) {
    return "app";
  }

  const baseDomain = getBaseDomain();
  if (normalizedHost === baseDomain || normalizedHost === `www.${baseDomain}`) {
    return "marketing";
  }
  if (normalizedHost === `app.${baseDomain}`) {
    return "app";
  }
  if (normalizedHost.endsWith(`.${baseDomain}`)) {
    const label = normalizedHost.slice(0, -1 * (`.${baseDomain}`.length)).split(".")[0];
    if (RESERVED_SUBDOMAINS.has(label)) {
      return "reserved";
    }
    return "tenant";
  }
  return "unknown";
}

function getRequestHostnameFromContext(context) {
  const rawRequest = context?.rawRequest;
  const originHost = normalizeHostname(rawRequest?.headers?.origin || rawRequest?.headers?.referer || "");
  if (originHost) return originHost;
  const forwardedHost = normalizeHostname(rawRequest?.headers?.["x-forwarded-host"] || "");
  if (forwardedHost) return forwardedHost;
  return normalizeHostname(rawRequest?.hostname || rawRequest?.headers?.host || "");
}

function getRequestHostnameFromHttp(req) {
  return normalizeHostname(req?.hostname || req?.headers?.host || "");
}

function getRequestIp(context) {
  const rawRequest = context?.rawRequest;
  return normalizeText(
    rawRequest?.headers?.["x-forwarded-for"]
      || rawRequest?.ip
      || rawRequest?.socket?.remoteAddress
      || ""
  ).split(",")[0].trim();
}

function getRequestIpFromHttp(req) {
  return normalizeText(
    req?.headers?.["x-forwarded-for"]
      || req?.ip
      || req?.socket?.remoteAddress
      || ""
  ).split(",")[0].trim();
}

function recordUnknownHostAttempt({ host = "", ip = "" } = {}) {
  const normalizedHost = normalizeHostname(host);
  const normalizedIp = normalizeText(ip);
  if (!normalizedHost) return { blocked: false, count: 0 };

  const key = `${normalizedIp}::${normalizedHost}`;
  const now = Date.now();
  const current = unknownHostCounter.get(key);
  const inWindow = current && current.expiresAt > now;
  const nextCount = inWindow ? current.count + 1 : 1;
  const expiresAt = inWindow ? current.expiresAt : now + UNKNOWN_HOST_WINDOW_MS;
  unknownHostCounter.set(key, { count: nextCount, expiresAt });

  return {
    blocked: nextCount > UNKNOWN_HOST_LIMIT,
    count: nextCount,
    expiresAt
  };
}

function slugify(value, fallback = "organization") {
  const raw = normalizeText(value).toLowerCase();
  const slug = raw
    .replace(/[^\w-]+/g, "-")
    .replace(/-{2,}/g, "-")
    .replace(/^-|-$/g, "");
  return slug || fallback;
}

function inviteDocIdFromEmail(value) {
  const email = normalizeEmail(value);
  if (!email) return "";
  return email
    .replace(/[^\w-]+/g, "_")
    .replace(/_{2,}/g, "_")
    .replace(/^_|_$/g, "");
}

async function readPendingOrganizationInvite(tx, email) {
  const normalizedEmail = normalizeEmail(email);
  const inviteId = inviteDocIdFromEmail(normalizedEmail);
  if (!normalizedEmail || !inviteId) return null;

  const inviteRef = db.collection(INVITES_COLLECTION).doc(inviteId);
  const inviteSnap = await tx.get(inviteRef);
  if (!inviteSnap.exists) return null;

  const invite = inviteSnap.data() || {};
  if (normalizeEmail(invite.email) !== normalizedEmail) return null;

  const status = normalizeText(invite.status).toLowerCase();
  if (status && status !== "pending" && status !== "active") return null;
  if (invite.consumedAt || normalizeText(invite.consumedAtISO)) return null;

  const expiresAtISO = normalizeText(invite.expiresAtISO);
  if (!expiresAtISO) return null;
  const expiresAtMs = Date.parse(expiresAtISO);
  if (!Number.isFinite(expiresAtMs) || expiresAtMs <= Date.now()) {
    return null;
  }

  const role = normalizeRole(invite.role);
  if (role !== "admin" && role !== "sales") return null;

  const organizationId = normalizeOrganizationId(invite.organizationId);
  if (!organizationId) return null;

  return {
    inviteRef,
    role,
    organizationId,
    organizationName: normalizeText(invite.organizationName),
    buyerAccessOrderId: normalizeText(invite.buyerAccessOrderId),
    buyerAccessMode: normalizeText(invite.buyerAccessMode)
  };
}

function normalizeOrderId(value, fallback = "") {
  const raw = normalizeText(value).toLowerCase();
  const normalized = raw
    .replace(/[^\w-]+/g, "-")
    .replace(/-{2,}/g, "-")
    .replace(/^-|-$/g, "");
  if (normalized) return normalized;
  const fallbackRaw = normalizeText(fallback).toLowerCase();
  const fallbackNormalized = fallbackRaw
    .replace(/[^\w-]+/g, "-")
    .replace(/-{2,}/g, "-")
    .replace(/^-|-$/g, "");
  return fallbackNormalized;
}

function normalizeFeatureList(input) {
  if (Array.isArray(input)) {
    return input
      .map((item) => normalizeText(item))
      .filter(Boolean);
  }
  return String(input || "")
    .split(",")
    .map((item) => normalizeText(item))
    .filter(Boolean);
}

function validateFeatureIds(featureIds, fieldName = "features") {
  const invalid = featureIds.filter((id) => !FEATURE_FLAG_KEYS.includes(id));
  if (!invalid.length) return;
  throw new functions.https.HttpsError(
    "invalid-argument",
    `${fieldName} contains unknown feature ids: ${invalid.join(", ")}.`
  );
}

function resolveFeatureEntitlements(data = {}) {
  const requestedPlan = normalizeText(data?.plan).toLowerCase();
  if (!requestedPlan || !FEATURE_PLAN_PRESETS[requestedPlan]) {
    throw new functions.https.HttpsError(
      "invalid-argument",
      `plan must be one of: ${Object.keys(FEATURE_PLAN_PRESETS).join(", ")}.`
    );
  }
  const plan = requestedPlan;
  const featureFlags = FEATURE_FLAG_KEYS.reduce((acc, key) => {
    acc[key] = false;
    return acc;
  }, {});

  FEATURE_PLAN_PRESETS[plan].forEach((key) => {
    featureFlags[key] = true;
  });

  const explicitFeatures = normalizeFeatureList(data?.features);
  if (explicitFeatures.length) {
    if (explicitFeatures.length === 1 && explicitFeatures[0].toLowerCase() === "all") {
      FEATURE_FLAG_KEYS.forEach((key) => {
        featureFlags[key] = true;
      });
    } else {
      validateFeatureIds(explicitFeatures, "features");
      FEATURE_FLAG_KEYS.forEach((key) => {
        featureFlags[key] = explicitFeatures.includes(key);
      });
    }
  }

  const disableFeatures = normalizeFeatureList(data?.disableFeatures);
  if (disableFeatures.length) {
    validateFeatureIds(disableFeatures, "disableFeatures");
    disableFeatures.forEach((key) => {
      featureFlags[key] = false;
    });
  }
  if (!featureFlags.aiAssist) {
    featureFlags.aiAutopilot = false;
  }

  const paidFeatureIds = FEATURE_FLAG_KEYS.filter((key) => featureFlags[key]);
  const unpaidFeatureIds = FEATURE_FLAG_KEYS.filter((key) => !featureFlags[key]);

  return {
    plan,
    featureFlags,
    paidFeatureIds,
    unpaidFeatureIds
  };
}

function formatFeatureListForEmail(featureIds = []) {
  return featureIds.map((id) => `- ${FEATURE_FLAG_LABELS[id] || id}`);
}

function buildNeutralSettingsPatch({
  organizationName = "",
  ownerName = "",
  ownerEmail = "",
  supportEmail = ""
} = {}) {
  const resolvedOrganizationName = withFallback(organizationName, "Organization Workspace");
  const resolvedSupportEmail = normalizeEmail(supportEmail) || normalizeEmail(ownerEmail);
  const resolvedPreparedBy = withFallback(ownerName, "Sales Team");
  return {
    quotePreparedBy: resolvedPreparedBy,
    brandName: resolvedOrganizationName,
    brandTagline: "",
    brandLogoUrl: "",
    brandPrimaryColor: "#1f2937",
    brandAccentColor: "#4b5563",
    brandDarkAccentColor: "#111827",
    brandBackgroundStart: "#f3f4f6",
    brandBackgroundMid: "#e5e7eb",
    brandBackgroundEnd: "#d1d5db",
    heroEyebrow: "Event Catering Workspace",
    heroHeadline: `${resolvedOrganizationName} Quote Operations`,
    heroDescription: "Build quotes, configure pricing, and manage proposals from one workspace.",
    brandCrew: [],
    businessPhone: "",
    businessEmail: resolvedSupportEmail,
    businessAddress: "",
    acceptanceEmail: resolvedSupportEmail,
    menuSections: [],
    perMileRate: 0,
    longDistancePerMileRate: 0,
    deliveryThresholdMiles: 0,
    bartenderRate: 0,
    bartenderRateTypes: [
      {
        id: "unconfigured",
        name: "Unconfigured bartender rate",
        rate: 0
      }
    ],
    defaultBartenderRateType: "unconfigured",
    serviceFeePct: 0,
    serviceFeeTiers: [
      {
        id: "unconfigured",
        minGuests: 0,
        maxGuests: 9999,
        pct: 0
      }
    ],
    taxRate: 0,
    taxRegions: [
      {
        id: "unconfigured",
        name: "Not configured",
        rate: 0
      }
    ],
    defaultTaxRegion: "unconfigured",
    depositPct: 0,
    depositNotice: "No deposit rule has been configured.",
    serverRate: 0,
    chefRate: 0,
    staffingRateTypes: [
      {
        id: "unconfigured",
        name: "Unconfigured staffing rate",
        serverRate: 0,
        chefRate: 0
      }
    ],
    defaultStaffingRateType: "unconfigured",
    staffingLaborEnabled: false,
    eventTemplates: [],
    upsellRules: [],
    seasonalProfiles: [
      {
        id: "standard",
        name: "Standard pricing",
        startMonth: 1,
        startDay: 1,
        endMonth: 12,
        endDay: 31,
        packageMultiplier: 1,
        addonMultiplier: 1,
        rentalMultiplier: 1
      }
    ],
    defaultSeasonProfile: "standard",
    pricingSetupConfirmed: false,
    catalogRevision: 0,
    pricingConfirmation: null
  };
}

function buildProvisioningEmailPayload({
  ownerName = "",
  ownerEmail = "",
  organizationName = "",
  organizationId = "",
  appUrl = "",
  paidFeatureIds = [],
  unpaidFeatureIds = [],
  supportEmail = "",
  orderId = "",
  ownerUid = "",
  requiresVerifiedSignIn = false
} = {}) {
  const greetingName = normalizeText(ownerName, "there");
  const roleLine = ownerUid
    ? "Your admin access is already linked to your account."
    : requiresVerifiedSignIn
      ? "Your admin access is pre-authorized for this exact email and activates only after email verification and a verified sign-in."
      : "Your admin access is pre-authorized for this email and will activate on first sign-in.";
  const supportLine = supportEmail
    ? `If you need help, reply to this message or contact ${supportEmail}.`
    : "If you need help, reply to this message and we will assist right away.";

  const gettingStartedLines = requiresVerifiedSignIn
    ? [
      `1. Open ${appUrl}`,
      `2. Create an account or sign in using exactly ${ownerEmail}`,
      "3. Complete the email verification message sent by Firebase",
      "4. Return to QuotePilot and sign in again with the verified email",
      `5. Confirm you are in organization "${organizationName}" (${organizationId})`
    ]
    : [
      `1. Open ${appUrl}`,
      `2. Sign in (or create an account) using ${ownerEmail}`,
      `3. Confirm you are in organization "${organizationName}" (${organizationId})`
    ];
  const lines = [
    `Hi ${greetingName},`,
    "",
    `Your ${organizationName} workspace is ready.`,
    "",
    "Getting started:",
    ...gettingStartedLines,
    "",
    roleLine,
    orderId ? `Order reference: ${orderId}` : "",
    "",
    "Enabled modules:",
    ...formatFeatureListForEmail(paidFeatureIds),
    "",
    "Not included in this order:",
    ...formatFeatureListForEmail(unpaidFeatureIds),
    "",
    "Modules not included in this order are locked off. Plan entitlements can only be changed through an authorized QuotePilot order update.",
    "",
    supportLine,
    "",
    "Thank you."
  ].filter(Boolean);

  const text = lines.join("\n");
  const escapedPaidFeatures = formatFeatureListForEmail(paidFeatureIds)
    .map((feature) => escapeHtml(feature))
    .join("<br/>");
  const escapedUnpaidFeatures = formatFeatureListForEmail(unpaidFeatureIds)
    .map((feature) => escapeHtml(feature))
    .join("<br/>");
  const gettingStartedHtml = requiresVerifiedSignIn
    ? `1. Open <a href="${escapeHtml(appUrl)}">${escapeHtml(appUrl)}</a><br/>
    2. Create an account or sign in using exactly <strong>${escapeHtml(ownerEmail)}</strong><br/>
    3. Complete the email verification message sent by Firebase<br/>
    4. Return to QuotePilot and sign in again with the verified email<br/>
    5. Confirm your organization is <strong>${escapeHtml(organizationName)}</strong> (${escapeHtml(organizationId)})`
    : `1. Open <a href="${escapeHtml(appUrl)}">${escapeHtml(appUrl)}</a><br/>
    2. Sign in (or create an account) using <strong>${escapeHtml(ownerEmail)}</strong><br/>
    3. Confirm your organization is <strong>${escapeHtml(organizationName)}</strong> (${escapeHtml(organizationId)})`;
  const html = `
    <p>Hi ${escapeHtml(greetingName)},</p>
    <p>Your <strong>${escapeHtml(organizationName)}</strong> workspace is ready.</p>
    <p><strong>Getting started</strong><br/>
    ${gettingStartedHtml}</p>
    <p>${escapeHtml(roleLine)}</p>
    ${orderId ? `<p>Order reference: <strong>${escapeHtml(orderId)}</strong></p>` : ""}
    <p><strong>Enabled modules</strong><br/>${escapedPaidFeatures}</p>
    <p><strong>Not included in this order</strong><br/>${escapedUnpaidFeatures}</p>
    <p>Modules not included in this order are locked off. Plan entitlements can only be changed through an authorized QuotePilot order update.</p>
    <p>${escapeHtml(supportLine)}</p>
    <p>Thank you.</p>
  `;

  return {
    subject: `Workspace Ready: ${organizationName}`,
    text,
    html
  };
}

function currencyLabel(amount) {
  const value = Number(amount || 0);
  if (!Number.isFinite(value)) return "$0.00";
  return `$${value.toFixed(2)}`;
}

function maskText(value, visibleTail = 4) {
  const text = normalizeText(value);
  if (!text) return "";
  if (text.length <= visibleTail) return text;
  return `${"*".repeat(Math.max(1, text.length - visibleTail))}${text.slice(-visibleTail)}`;
}

function getSmsProvider() {
  const provider = normalizeText(readConfig("notifications.sms_provider", "none")).toLowerCase();
  if (!provider) return "none";
  return provider;
}

function getTwilioConfig() {
  return {
    accountSid: readConfig("twilio.account_sid"),
    authToken: readBoundSecret(TWILIO_AUTH_TOKEN_SECRET_NAME),
    messagingServiceSid: readConfig("twilio.messaging_service_sid"),
    toNumber: readConfig("notifications.owner_phone")
  };
}

function getStripeConfig() {
  return {
    mode: readConfig("stripe.mode"),
    secretKey: readBoundSecret(STRIPE_SECRET_NAME),
    webhookSecret: readBoundSecret(STRIPE_WEBHOOK_SECRET_NAME)
  };
}

function getBuyerAccessStripeConfig() {
  return {
    mode: readConfig("buyer_access_stripe_mode"),
    secretKey: readBoundSecret(BUYER_ACCESS_STRIPE_SECRET_NAME)
  };
}

function getEmailProvider() {
  const provider = normalizeText(
    readConfig("notifications.email_provider", readConfig("email.provider", "none"))
  ).toLowerCase();
  if (!provider) return "none";
  return provider;
}

function getEmailConfig() {
  const fromEmail = normalizeEmail(readConfig("email.from_email"));
  const fromName = normalizeText(readConfig("email.from_name", APPROVED_EMAIL_FROM_NAME));
  return {
    provider: getEmailProvider(),
    fromEmail,
    fromName,
    resendApiKey: readBoundSecret(RESEND_API_KEY_SECRET_NAME),
    senderApproved:
      fromName === APPROVED_EMAIL_FROM_NAME
      && fromEmail === APPROVED_EMAIL_FROM_EMAIL
  };
}

function configBoolean(path, fallback = false) {
  const value = normalizeText(readConfig(path, fallback ? "true" : "false")).toLowerCase();
  return value === "true" || value === "1" || value === "yes";
}

function getRevenueAutopilotGlobalControl(nowISO = new Date().toISOString()) {
  const email = getEmailConfig();
  const providerConfigured = email.provider === "resend"
    && Boolean(email.resendApiKey)
    && email.senderApproved;
  return {
    enabled: configBoolean("revenue_autopilot.enabled", false),
    sendsEnabled: configBoolean("revenue_autopilot.sends_enabled", false),
    provider: {
      evidenceId: `provider_${createHash("sha256")
        .update(`${email.provider}|${email.fromName}|${email.fromEmail}|${providerConfigured}`)
        .digest("hex")
        .slice(0, 32)}`,
      providerId: email.provider,
      configurationId: providerConfigured ? "approved-global-sender-v1" : "",
      state: providerConfigured ? "configured" : "unconfigured",
      evaluatedAtISO: nowISO
    }
  };
}

function buildRevenueAutopilotUnsubscribeToken({ organizationId, customerId, secret }) {
  const normalizedOrganizationId = normalizeOrganizationId(organizationId);
  const normalizedCustomerId = normalizeText(customerId);
  const normalizedSecret = normalizeText(secret);
  if (!normalizedOrganizationId || !normalizedCustomerId || normalizedSecret.length < 32) {
    throw new RevenueAutopilotError(
      "failed-precondition",
      "Revenue Autopilot unsubscribe-token authority is not configured."
    );
  }
  const payload = Buffer.from(JSON.stringify({
    v: 1,
    o: normalizedOrganizationId,
    c: normalizedCustomerId
  }), "utf8").toString("base64url");
  const signature = createHmac("sha256", normalizedSecret)
    .update(`revenue-autopilot-unsubscribe-v1|${payload}`)
    .digest("base64url");
  const token = `${payload}_${signature}`;
  if (!/^[A-Za-z0-9_-]{20,256}$/.test(token)) {
    throw new RevenueAutopilotError(
      "failed-precondition",
      "Revenue Autopilot unsubscribe token exceeds its bounded contract."
    );
  }
  return token;
}

function parseRevenueAutopilotUnsubscribeToken(token, secret) {
  const normalizedToken = normalizeText(token);
  const normalizedSecret = normalizeText(secret);
  const separator = normalizedToken.lastIndexOf("_");
  if (
    !/^[A-Za-z0-9_-]{20,256}$/.test(normalizedToken)
    || separator < 1
    || normalizedSecret.length < 32
  ) {
    throw new RevenueAutopilotError("not-found", "Email preference link not found.");
  }
  const payload = normalizedToken.slice(0, separator);
  const signature = normalizedToken.slice(separator + 1);
  const expected = createHmac("sha256", normalizedSecret)
    .update(`revenue-autopilot-unsubscribe-v1|${payload}`)
    .digest("base64url");
  const observedBuffer = Buffer.from(signature, "utf8");
  const expectedBuffer = Buffer.from(expected, "utf8");
  if (
    observedBuffer.length !== expectedBuffer.length
    || !timingSafeEqual(observedBuffer, expectedBuffer)
  ) {
    throw new RevenueAutopilotError("not-found", "Email preference link not found.");
  }
  let decoded;
  try {
    decoded = JSON.parse(Buffer.from(payload, "base64url").toString("utf8"));
  } catch {
    throw new RevenueAutopilotError("not-found", "Email preference link not found.");
  }
  const organizationId = normalizeOrganizationId(decoded?.o);
  const customerId = normalizeText(decoded?.c);
  if (decoded?.v !== 1 || !organizationId || !customerId) {
    throw new RevenueAutopilotError("not-found", "Email preference link not found.");
  }
  const canonical = buildRevenueAutopilotUnsubscribeToken({
    organizationId,
    customerId,
    secret: normalizedSecret
  });
  if (canonical !== normalizedToken) {
    throw new RevenueAutopilotError("not-found", "Email preference link not found.");
  }
  return { organizationId, customerId, token: normalizedToken };
}

function defaultRevenueAutopilotTemplates() {
  return {
    quote_follow_up: {
      templateId: "quote-follow-up-v1",
      version: "v1",
      kind: "quote_follow_up",
      subject: "{{business_name}} · quote {{quote_number}}",
      text: [
        "Hi {{customer_name}},",
        "",
        "A quick reminder that quote {{quote_number}} for {{event_date}} is ready to review.",
        "Open your secure proposal: {{portal_url}}",
        "",
        "Manage automated reminder email: {{unsubscribe_url}}",
        "{{business_name}}"
      ].join("\n"),
      html: "<p>Hi {{customer_name}},</p><p>A quick reminder that quote <strong>{{quote_number}}</strong> for {{event_date}} is ready to review.</p><p><a href=\"{{portal_url}}\">Open your secure proposal</a></p><p><a href=\"{{unsubscribe_url}}\">Manage automated reminder email</a></p><p>{{business_name}}</p>"
    },
    deposit_reminder: {
      templateId: "deposit-reminder-v1",
      version: "v1",
      kind: "deposit_reminder",
      subject: "{{business_name}} · deposit reminder for {{quote_number}}",
      text: [
        "Hi {{customer_name}},",
        "",
        "Your accepted quote {{quote_number}} has a deposit of {{deposit_amount}} awaiting verified payment.",
        "Review the current payment state: {{portal_url}}",
        "Event date: {{event_date}}",
        "",
        "Manage automated reminder email: {{unsubscribe_url}}",
        "{{business_name}}"
      ].join("\n"),
      html: "<p>Hi {{customer_name}},</p><p>Your accepted quote <strong>{{quote_number}}</strong> has a deposit of <strong>{{deposit_amount}}</strong> awaiting verified payment.</p><p>Event date: {{event_date}}</p><p><a href=\"{{portal_url}}\">Review the current payment state</a></p><p><a href=\"{{unsubscribe_url}}\">Manage automated reminder email</a></p><p>{{business_name}}</p>"
    },
    final_balance_reminder: {
      templateId: "final-balance-reminder-v1",
      version: "v1",
      kind: "final_balance_reminder",
      subject: "{{business_name}} · final balance for {{quote_number}}",
      text: [
        "Hi {{customer_name}},",
        "",
        "The final balance of {{final_balance_amount}} for quote {{quote_number}} is awaiting verified payment before {{event_date}}.",
        "Review the current payment state: {{portal_url}}",
        "",
        "Manage automated reminder email: {{unsubscribe_url}}",
        "{{business_name}}"
      ].join("\n"),
      html: "<p>Hi {{customer_name}},</p><p>The final balance of <strong>{{final_balance_amount}}</strong> for quote <strong>{{quote_number}}</strong> is awaiting verified payment before {{event_date}}.</p><p><a href=\"{{portal_url}}\">Review the current payment state</a></p><p><a href=\"{{unsubscribe_url}}\">Manage automated reminder email</a></p><p>{{business_name}}</p>"
    },
    post_event_review_request: {
      templateId: "post-event-review-request-v1",
      version: "v1",
      kind: "post_event_review_request",
      subject: "Thank you from {{business_name}}",
      text: [
        "Hi {{customer_name}},",
        "",
        "Thank you for trusting {{business_name}} with your event on {{event_date}}.",
        "Share your experience: {{review_url}}",
        "",
        "Manage automated reminder email: {{unsubscribe_url}}",
        "{{business_name}}"
      ].join("\n"),
      html: "<p>Hi {{customer_name}},</p><p>Thank you for trusting {{business_name}} with your event on {{event_date}}.</p><p><a href=\"{{review_url}}\">Share your experience</a></p><p><a href=\"{{unsubscribe_url}}\">Manage automated reminder email</a></p><p>{{business_name}}</p>"
    }
  };
}

function revenueAutopilotRefs(organizationId, { quoteId = "", customerId = "" } = {}) {
  const organizationRef = db.collection(ORGANIZATIONS_COLLECTION).doc(organizationId);
  return {
    organizationRef,
    policyRef: organizationRef.collection(REVENUE_AUTOPILOT_POLICY_COLLECTION).doc("current"),
    jobsRef: organizationRef.collection(REVENUE_AUTOPILOT_JOBS_COLLECTION),
    attentionRef: organizationRef.collection(REVENUE_AUTOPILOT_ATTENTION_COLLECTION),
    receiptsRef: organizationRef.collection(REVENUE_AUTOPILOT_RECEIPTS_COLLECTION),
    controlsRef: organizationRef.collection(REVENUE_AUTOPILOT_EMAIL_CONTROLS_COLLECTION),
    customersRef: organizationRef.collection("customers"),
    quotesRef: organizationRef.collection(QUOTES_COLLECTION),
    quoteRef: quoteId ? organizationRef.collection(QUOTES_COLLECTION).doc(quoteId) : null,
    customerRef: customerId ? organizationRef.collection("customers").doc(customerId) : null,
    customerControlsRef: customerId
      ? organizationRef.collection(REVENUE_AUTOPILOT_EMAIL_CONTROLS_COLLECTION).doc(customerId)
      : null,
    tenantRegistryRef: db.collection(REVENUE_AUTOPILOT_TENANTS_COLLECTION).doc(organizationId)
  };
}

function throwRevenueAutopilotFailure(error, operation) {
  if (error instanceof functions.https.HttpsError) throw error;
  if (
    error instanceof RevenueAutopilotError
    || error instanceof RevenueAutopilotAuthorityError
    || error instanceof RevenueAutopilotTemplateError
  ) {
    throw new functions.https.HttpsError(error.code, error.message);
  }
  functions.logger.error(`${operation} failed`, {
    error: normalizeText(error?.message).slice(0, 240)
  });
  throw new functions.https.HttpsError(
    "internal",
    "The Revenue Autopilot operation did not complete."
  );
}

function clientPolicyToAuthorityRequest({ organizationId, requestId, policy, currentPolicy }) {
  const source = policy && typeof policy === "object" && !Array.isArray(policy) ? policy : {};
  const kinds = source.kinds && typeof source.kinds === "object" ? source.kinds : {};
  return {
    organizationId,
    requestId,
    expectedRevision: Number(currentPolicy?.revision || 0),
    enabled: source.enabled === true,
    timeZone: normalizeText(source.timeZone),
    reviewRequestUrl: normalizeText(source.reviewRequestUrl),
    quietHours: source.quietHours?.enabled === true
      ? {
          enabled: true,
          start: normalizeText(source.quietHours.start),
          end: normalizeText(source.quietHours.end)
        }
      : { enabled: false, start: "21:00", end: "08:00" },
    maxAttempts: Number(source.maxAttempts),
    kinds: {
      quote_follow_up: {
        enabled: kinds.quote_follow_up === true,
        dayOffsets: source.quoteFollowUpDayOffsets
      },
      deposit_reminder: {
        enabled: kinds.deposit_reminder === true,
        dayOffsets: source.depositReminderDayOffsets
      },
      final_balance_reminder: {
        enabled: kinds.final_balance_reminder === true,
        dayOffsets: source.finalBalanceReminderDayOffsets
      },
      post_event_review_request: {
        enabled: kinds.post_event_review_request === true
      },
      unread_customer_reply: {
        enabled: kinds.unread_customer_reply === true
      }
    },
    templates: defaultRevenueAutopilotTemplates()
  };
}

function revenueAutopilotReceipt({
  requestId,
  operation,
  organizationId = "",
  customerId = "",
  quoteId = "",
  jobId = "",
  attentionId = "",
  messageId = "",
  token = "",
  policyVersion = "",
  recordedAtISO
} = {}) {
  return {
    requestId,
    operation,
    ...(organizationId ? { organizationId } : {}),
    ...(customerId ? { customerId } : {}),
    ...(quoteId ? { quoteId } : {}),
    ...(jobId ? { jobId } : {}),
    ...(attentionId ? { attentionId } : {}),
    ...(messageId ? { messageId } : {}),
    ...(token ? { token } : {}),
    ...(policyVersion ? { policyVersion } : {}),
    recordedAtISO
  };
}

function revenueAutopilotTokenSecret() {
  return normalizeText(process.env[REVENUE_AUTOPILOT_TOKEN_SECRET_NAME]);
}

function revenueAutopilotRequestId(value) {
  const requestId = normalizeText(value).toLowerCase();
  if (!/^ra_request_[a-f0-9]{32}$/u.test(requestId)) {
    throw new RevenueAutopilotError(
      "invalid-argument",
      "A valid Revenue Autopilot request identity is required."
    );
  }
  return requestId;
}

function revenueAutopilotReceiptRef(refs, operation, requestId) {
  const id = `rarc_${createHash("sha256")
    .update(`${operation}|${requestId}`)
    .digest("hex")}`;
  return refs.receiptsRef.doc(id);
}

function revenueAutopilotSuppressionEvidence(rawControls = {}, {
  organizationId,
  customerId,
  recipientKey,
  nowISO
} = {}) {
  const stored = rawControls?.suppression && typeof rawControls.suppression === "object"
    ? rawControls.suppression
    : {};
  const state = new Set(["clear", "suppressed"]).has(normalizeText(stored.state).toLowerCase())
    ? normalizeText(stored.state).toLowerCase()
    : "clear";
  return {
    organizationId,
    customerId,
    recipientKey,
    evidenceId: normalizeText(stored.evidenceId)
      || `suppression_${createHash("sha256")
        .update(`${organizationId}|${customerId}|${recipientKey}|${state}`)
        .digest("hex")}`,
    state,
    evaluatedAtISO: normalizeText(stored.evaluatedAtISO) || nowISO
  };
}

function revenueAutopilotPublicPolicy(policy = {}, global = {}, providerProjection = {}) {
  const kinds = policy?.kinds && typeof policy.kinds === "object" ? policy.kinds : {};
  return {
    policyVersion: normalizeText(policy.policyVersion),
    version: normalizeText(policy.policyVersion),
    authorityState: normalizeText(policy.authorityState) || "unconfigured",
    global: {
      enabled: global.enabled === true,
      sendsEnabled: global.sendsEnabled === true
    },
    globalEnabled: global.enabled === true,
    tenant: { enabled: policy.enabled === true },
    tenantEnabled: policy.enabled === true,
    provider: {
      configured: providerProjection.configured === true,
      state: providerProjection.configured === true ? "configured" : "unconfigured",
      evaluatedAtISO: normalizeText(providerProjection.evaluatedAtISO)
    },
    providerConfigured: providerProjection.configured === true,
    timeZone: normalizeText(policy.timeZone),
    tenantTimeZone: normalizeText(policy.timeZone),
    reviewRequestUrl: normalizeText(policy.reviewRequestUrl),
    quietHours: policy.quietHours || { enabled: false, start: "21:00", end: "08:00" },
    maxAttempts: Number(policy.maxAttempts) || 3,
    kinds: Object.fromEntries([
      "quote_follow_up",
      "deposit_reminder",
      "final_balance_reminder",
      "post_event_review_request",
      "unread_customer_reply"
    ].map((kind) => [kind, {
      enabled: kinds[kind]?.enabled === true,
      ...(Array.isArray(kinds[kind]?.dayOffsets)
        ? { dayOffsets: [...kinds[kind].dayOffsets] }
        : {})
    }]))
  };
}

function projectRevenueAutopilotJobForStaff(job = {}) {
  return {
    jobId: normalizeText(job.jobId),
    quoteId: normalizeText(job.quoteId),
    customerId: normalizeText(job.customerId),
    kind: normalizeText(job.kind).toLowerCase(),
    state: normalizeText(job.state).toLowerCase(),
    dueTenantDate: normalizeText(job.dueTenantDate),
    occurrenceKey: normalizeText(job.occurrenceKey),
    quoteLabel: normalizeText(job.quoteLabel),
    customerLabel: normalizeText(job.customerLabel),
    attemptCount: Number(job.attemptCount) || 0,
    maxAttempts: Number(job.maxAttempts) || 0,
    nextAttemptAtISO: normalizeText(job.nextAttemptAtISO),
    providerAcceptedAtISO: normalizeText(job.providerAcceptedAtISO),
    deliveredAtISO: normalizeText(job.deliveredAtISO),
    bouncedAtISO: normalizeText(job.bouncedAtISO),
    complainedAtISO: normalizeText(job.complainedAtISO),
    outcomeReason: normalizeText(job.outcomeReason),
    dispatchSuppressedAtISO: normalizeText(job.dispatchSuppressedAtISO),
    dispatchSuppressionReason: normalizeText(job.dispatchSuppressionReason),
    createdAtISO: normalizeText(job.createdAtISO)
  };
}

function projectRevenueAutopilotAttentionForStaff(attention = {}) {
  return {
    attentionId: normalizeText(attention.attentionId),
    quoteId: normalizeText(attention.quoteId),
    customerId: normalizeText(attention.customerId),
    messageId: normalizeText(attention.messageId),
    kind: "unread_customer_reply",
    state: normalizeText(attention.state).toLowerCase() || "open",
    quoteLabel: normalizeText(attention.quoteLabel),
    customerLabel: normalizeText(attention.customerLabel),
    receivedAtISO: normalizeText(attention.receivedAtISO || attention.openedAtISO),
    openedAtISO: normalizeText(attention.openedAtISO),
    resolvedAtISO: normalizeText(attention.resolvedAtISO),
    resolutionReason: normalizeText(attention.resolutionReason)
  };
}

function revenueAutopilotPortalEvidence({ quote, portal, organizationId, quoteId } = {}) {
  const state = normalizeText(quote?.status).toLowerCase();
  const portalState = normalizeText(portal?.status).toLowerCase();
  const lifecycleField = `${state}AtISO`;
  const stateAtISO = normalizeText(
    quote?.lifecycle?.[lifecycleField]
      || (state === "booked" ? quote?.booking?.bookedAtISO : "")
  );
  const portalStateAtISO = normalizeText(
    portal?.lifecycle?.[lifecycleField]
      || (state === "booked" ? portal?.booking?.bookedAtISO : "")
  );
  const revisionId = normalizeText(quote?.workflow?.quoteDelivery?.revisionId);
  const portalIssuedAtISO = normalizeText(quote?.portalIssuedAtISO);
  if (
    state !== portalState
    || !new Set(["sent", "viewed", "accepted", "booked", "declined"]).has(state)
    || !stateAtISO
    || stateAtISO !== portalStateAtISO
    || revisionId !== normalizeText(portal?.deliveryEvidence?.revisionId)
    || portalIssuedAtISO !== normalizeText(portal?.portalIssuedAtISO)
  ) {
    throw new RevenueAutopilotAuthorityError(
      "aborted",
      "The canonical quote and customer portal evidence are not an exact current revision."
    );
  }
  return {
    source: "customer_portal_projection",
    organizationId,
    quoteId,
    revisionId,
    portalIssuedAtISO,
    state,
    stateAtISO,
    ...(["accepted", "booked"].includes(state)
      ? { acceptedAtISO: normalizeText(quote?.lifecycle?.acceptedAtISO) }
      : {})
  };
}

function revenueAutopilotAcceptanceEvidence({ receipt, organizationId, quoteId } = {}) {
  if (!receipt || typeof receipt !== "object") return null;
  return {
    source: "proposal_acceptance_receipt",
    organizationId,
    quoteId,
    quoteRevisionId: normalizeText(receipt.quoteRevisionId || receipt.revisionId),
    receiptId: normalizeText(receipt.receiptId),
    acceptedAtISO: normalizeText(receipt.acceptedAtISO)
  };
}

function revenueAutopilotDepositEvidence({
  quote,
  organizationId,
  quoteId,
  webhookEvents = [],
  observedAtISO
} = {}) {
  const storedState = normalizeText(quote?.payment?.depositStatus).toLowerCase() || "unpaid";
  const state = new Set(["paid", "refunded"]).has(storedState) ? storedState : "unpaid";
  const providerReference = normalizeText(quote?.payment?.stripeSessionId);
  if (state === "unpaid") {
    return {
      source: "verified_provider_webhooks",
      organizationId,
      quoteId,
      bounded: true,
      observedAtISO,
      state
    };
  }
  const matchingEvent = webhookEvents.find((event) => (
    normalizeOrganizationId(event.organizationId) === organizationId
    && normalizeText(event.quoteId) === quoteId
    && normalizeText(event.paymentKind).toLowerCase() === "deposit"
    && normalizeText(event.status).toLowerCase() === "processed"
    && normalizeText(event.stripeSessionId) === providerReference
    && normalizeText(event.providerState).toLowerCase() === state
  ));
  if (!matchingEvent) {
    throw new RevenueAutopilotAuthorityError(
      "failed-precondition",
      "Settled deposit state lacks an exact processed verified-webhook record."
    );
  }
  return {
    source: "verified_provider_webhooks",
    organizationId,
    quoteId,
    bounded: true,
    observedAtISO,
    state,
    signatureVerified: true,
    processingState: "processed",
    providerReference,
    processedAtISO: normalizeText(matchingEvent.processedAtISO)
  };
}

function revenueAutopilotFinalBalanceEvidence({
  quote,
  organizationId,
  quoteId,
  observedAtISO
} = {}) {
  const ledger = projectQuotePaymentLedger(quote);
  const projection = ledger.byKind.finalBalance || {};
  const storedState = normalizeText(projection.state).toLowerCase();
  const state = new Set(["sent", "processing", "paid", "refunded"]).has(storedState)
    ? storedState
    : "unpaid";
  const operationId = normalizeText(
    projection.settledOperationId
      || projection.activeOperationId
      || projection.latestOperationId
  ) || `final_balance_${createHash("sha256")
    .update(`${organizationId}|${quoteId}|${normalizeText(quote?.activeVersionId)}`)
    .digest("hex")}`;
  return {
    source: "canonical_payment_ledger",
    organizationId,
    quoteId,
    operationId,
    observedAtISO,
    state,
    ...(["paid", "refunded"].includes(state)
      ? {
          providerReference: normalizeText(projection.providerReference),
          providerSettledAtISO: normalizeText(projection.providerSettledAtISO)
        }
      : {})
  };
}

function revenueAutopilotUnsubscribeUrl({ organizationId, customerId, secret } = {}) {
  const token = buildRevenueAutopilotUnsubscribeToken({ organizationId, customerId, secret });
  const url = new URL(parseUrlOrThrow(
    readConfig("app.base_url", "https://quotepilot.mbmapps.com/app"),
    "app.base_url"
  ));
  url.search = "";
  url.hash = "";
  url.searchParams.set("unsubscribe", token);
  return url.toString();
}

function revenueAutopilotTemplateValues({
  quote,
  organization,
  portalUrl,
  reviewUrl,
  unsubscribeUrl,
  kind
} = {}) {
  const values = {
    business_name: normalizeText(
      quote?.quoteMeta?.brandName
        || quote?.quoteMeta?.organizationName
        || organization?.name
        || "QuotePilot"
    ),
    customer_name: normalizeText(quote?.customer?.name) || "there",
    event_date: normalizeText(quote?.event?.date) || "the event date on your proposal",
    quote_number: normalizeText(quote?.quoteNumber || quote?.id),
    unsubscribe_url: unsubscribeUrl,
    ...(kind === "post_event_review_request"
      ? { review_url: reviewUrl }
      : { portal_url: portalUrl })
  };
  if (kind === "deposit_reminder") {
    values.deposit_amount = currencyLabel(quote?.totals?.deposit);
  }
  if (kind === "final_balance_reminder") {
    const amounts = quotePaymentAmounts(quote);
    values.final_balance_amount = currencyLabel(amounts.finalBalanceCents / 100);
  }
  return values;
}

async function readRevenueAutopilotExecutionAuthority({
  organizationId,
  quoteId,
  kind,
  existingJobs = [],
  nowISO
} = {}) {
  const refs = revenueAutopilotRefs(organizationId, { quoteId });
  const quoteSnap = await refs.quoteRef.get();
  if (!quoteSnap.exists) {
    throw new RevenueAutopilotAuthorityError("not-found", "Quote not found.");
  }
  const quote = { id: quoteId, ...(quoteSnap.data() || {}) };
  const customerId = normalizeText(quote.customerId);
  const portalKey = normalizeText(quote.portalKey);
  if (
    normalizeOrganizationId(quote.organizationId) !== organizationId
    || !customerId
    || !/^[A-Za-z0-9_-]{20,128}$/u.test(portalKey)
  ) {
    throw new RevenueAutopilotAuthorityError(
      "failed-precondition",
      "Revenue Autopilot execution scope is incomplete."
    );
  }
  const controlsRef = refs.controlsRef.doc(customerId);
  const acceptanceReceiptId = normalizeText(quote.acceptanceReceipt?.receiptId);
  const acceptanceRef = acceptanceReceiptId
    ? refs.organizationRef.collection(PROPOSAL_ACCEPTANCE_RECEIPTS_COLLECTION).doc(acceptanceReceiptId)
    : null;
  const closeoutId = normalizeText(quote.workflow?.postEventCloseout?.closeoutId);
  const closeoutRef = (
    kind === "post_event_review_request"
    && /^[A-Za-z0-9][A-Za-z0-9_.:@-]{0,255}$/u.test(closeoutId)
  )
    ? refs.organizationRef.collection(POST_EVENT_CLOSEOUTS_COLLECTION).doc(closeoutId)
    : null;
  const reads = [
    db.collection(PORTAL_COLLECTION).doc(portalKey).get(),
    refs.policyRef.get(),
    controlsRef.get(),
    db.collection(WEBHOOK_EVENTS_COLLECTION)
      .where("organizationId", "==", organizationId)
      .limit(100)
      .get(),
    acceptanceRef ? acceptanceRef.get() : Promise.resolve(null),
    closeoutRef ? closeoutRef.get() : Promise.resolve(null)
  ];
  const [
    portalSnap,
    policySnap,
    controlsSnap,
    webhookSnap,
    acceptanceSnap,
    closeoutSnap
  ] = await Promise.all(reads);
  if (!portalSnap.exists) {
    throw new RevenueAutopilotAuthorityError(
      "failed-precondition",
      "The current customer portal projection is unavailable."
    );
  }
  const policy = normalizeRevenueAutopilotTenantPolicy(
    policySnap.exists ? policySnap.data() || {} : null
  );
  const controlsRaw = controlsSnap.exists ? controlsSnap.data() || {} : null;
  const controls = normalizeRevenueAutopilotEmailControls(controlsRaw, {
    organizationId,
    customerId
  });
  const global = getRevenueAutopilotGlobalControl(nowISO);
  const canonical = {
    quote,
    portal: revenueAutopilotPortalEvidence({
      quote,
      portal: portalSnap.data() || {},
      organizationId,
      quoteId
    })
  };
  if (kind !== "quote_follow_up") {
    if (!acceptanceSnap?.exists) {
      throw new RevenueAutopilotAuthorityError(
        "failed-precondition",
        "This Revenue Autopilot lane requires exact proposal acceptance evidence."
      );
    }
    canonical.acceptance = revenueAutopilotAcceptanceEvidence({
      receipt: acceptanceSnap.data() || {},
      organizationId,
      quoteId
    });
  }
  if (kind === "post_event_review_request") {
    if (!closeoutSnap?.exists) {
      throw new RevenueAutopilotAuthorityError(
        "failed-precondition",
        "Post-event review execution requires the exact private closeout record."
      );
    }
    canonical.postEventCloseout = {
      closeoutId: closeoutSnap.id,
      ...(closeoutSnap.data() || {})
    };
  }
  if (new Set(["deposit_reminder", "final_balance_reminder"]).has(kind)) {
    canonical.deposit = revenueAutopilotDepositEvidence({
      quote,
      organizationId,
      quoteId,
      webhookEvents: webhookSnap.docs.map((snapshot) => ({
        eventId: snapshot.id,
        ...(snapshot.data() || {})
      })),
      observedAtISO: nowISO
    });
  }
  if (kind === "final_balance_reminder") {
    canonical.finalBalance = revenueAutopilotFinalBalanceEvidence({
      quote,
      organizationId,
      quoteId,
      observedAtISO: nowISO
    });
  }
  const suppression = revenueAutopilotSuppressionEvidence(controlsRaw, {
    organizationId,
    customerId,
    recipientKey: controls.recipientKey,
    nowISO
  });
  const planned = planRevenueAutopilotMaterializationFromCanonical({
    request: { organizationId, quoteId, kind },
    canonical,
    policy,
    emailControls: controls,
    provider: { organizationId, ...global.provider },
    suppression,
    global: { enabled: global.enabled, sendsEnabled: global.sendsEnabled },
    existingJobs
  }, { nowISO });
  return {
    ...planned,
    quoteActivity: evaluateRevenueAutopilotQuoteActivity({
      quoteExists: true,
      quote,
      organizationId,
      nowISO,
      ignorePortalExpiry: kind === "post_event_review_request"
    })
  };
}

async function reconcileRevenueAutopilotReplyAttentionForQuote({
  organizationId,
  quote,
  tenantPolicy,
  nowISO
} = {}) {
  const quoteId = normalizeText(quote?.id || quote?.quoteId);
  const conversationRefs = portalConversationRefs(organizationId, quoteId);
  const attentionCollection = db.collection(ORGANIZATIONS_COLLECTION)
    .doc(organizationId)
    .collection(REVENUE_AUTOPILOT_ATTENTION_COLLECTION);
  return db.runTransaction(async (tx) => {
    const stateSnap = await tx.get(conversationRefs.stateRef);
    if (!stateSnap.exists) {
      return { state: "conversation_missing", createdCount: 0, updatedCount: 0 };
    }
    const state = stateSnap.data() || {};
    if (
      normalizeText(state.organizationId) !== organizationId
      || normalizeText(state.quoteId) !== quoteId
    ) {
      throw new RevenueAutopilotAuthorityError(
        "permission-denied",
        "Conversation Attention state is outside this quote scope."
      );
    }
    const latestMessageId = normalizeText(state.latestMessageId);
    if (!latestMessageId) {
      return { state: "message_missing", createdCount: 0, updatedCount: 0 };
    }
    const storedPointer = state.revenueAutopilotAttention || {};
    const activeMessageId = normalizeText(
      storedPointer.messageId
      || (normalizeText(state.latestActorType).toLowerCase() === "customer"
        ? latestMessageId
        : "")
    );
    const activeIdentity = activeMessageId
      ? buildRevenueAutopilotAttentionIdentity({ organizationId, quoteId, messageId: activeMessageId })
      : null;
    const latestIdentity = normalizeText(state.latestActorType).toLowerCase() === "customer"
      ? buildRevenueAutopilotAttentionIdentity({ organizationId, quoteId, messageId: latestMessageId })
      : null;
    const latestMessageRef = conversationRefs.messagesRef.doc(latestMessageId);
    const activeAttentionRef = activeIdentity
      ? attentionCollection.doc(activeIdentity.attentionId)
      : null;
    const latestAttentionRef = latestIdentity
      ? attentionCollection.doc(latestIdentity.attentionId)
      : null;
    const [latestMessageSnap, activeAttentionSnap, latestAttentionSnap] = await Promise.all([
      tx.get(latestMessageRef),
      activeAttentionRef ? tx.get(activeAttentionRef) : Promise.resolve(null),
      latestAttentionRef ? tx.get(latestAttentionRef) : Promise.resolve(null)
    ]);
    if (!latestMessageSnap.exists) {
      throw new RevenueAutopilotAuthorityError(
        "failed-precondition",
        "The exact latest quote conversation message is unavailable."
      );
    }
    const latestMessage = { id: latestMessageSnap.id, ...(latestMessageSnap.data() || {}) };
    const latestActorType = normalizeText(latestMessage.actorType).toLowerCase();
    const acknowledgement = state.staffAcknowledged || {};
    const evidence = buildRevenueAutopilotConversationEvidence({
      quote,
      conversationState: state,
      latestMessage,
      staffAcknowledgementReceipt: (
        latestActorType === "customer"
        && normalizeText(acknowledgement.latestMessageId) === latestMessageId
      ) ? {
          organizationId,
          quoteId,
          ...acknowledgement
        } : null
    });
    const transition = planUnreadCustomerReplyAttentionTransition({
      organizationId,
      quoteId,
      evidence: { conversation: evidence },
      global: getRevenueAutopilotGlobalControl(nowISO),
      tenantPolicy,
      activeAttention: activeAttentionSnap?.exists
        ? { attentionId: activeAttentionSnap.id, ...(activeAttentionSnap.data() || {}) }
        : null,
      latestAttention: latestAttentionSnap?.exists
        ? { attentionId: latestAttentionSnap.id, ...(latestAttentionSnap.data() || {}) }
        : null,
      nowISO
    });
    for (const update of transition.updates) {
      tx.set(attentionCollection.doc(update.attentionId), {
        ...update,
        updatedAtISO: nowISO,
        updatedAt: FieldValue.serverTimestamp()
      }, { merge: true });
    }
    let createdCount = 0;
    if (transition.create && latestAttentionRef && !latestAttentionSnap?.exists) {
      tx.create(latestAttentionRef, {
        ...transition.create,
        customerId: normalizeText(quote.customerId),
        quoteLabel: normalizeText(quote.quoteNumber) || quoteId,
        customerLabel: normalizeText(quote.customer?.name),
        receivedAtISO: evidence.latestMessageAtISO,
        createdAt: FieldValue.serverTimestamp(),
        updatedAt: FieldValue.serverTimestamp()
      });
      createdCount = 1;
    }
    tx.set(conversationRefs.stateRef, {
      revenueAutopilotAttention: transition.activePointer || FieldValue.delete(),
      updatedAt: FieldValue.serverTimestamp()
    }, { merge: true });
    return {
      state: transition.state,
      createdCount,
      updatedCount: transition.updates.length
    };
  });
}

async function dispatchRevenueAutopilotJob({ organizationId, jobId } = {}) {
  const refs = revenueAutopilotRefs(organizationId);
  const jobRef = refs.jobsRef.doc(jobId);
  const initialSnap = await jobRef.get();
  if (!initialSnap.exists) return { action: "missing" };
  const initialRaw = { jobId, ...(initialSnap.data() || {}) };
  const quoteId = normalizeText(initialRaw.quoteId);
  const jobKind = normalizeText(initialRaw.kind).toLowerCase();
  const nowISO = new Date().toISOString();
  if (
    !quoteId
    || normalizeText(initialRaw.organizationId) !== organizationId
    || normalizeText(initialRaw.deletedAtISO)
  ) {
    return { action: "invalid_scope" };
  }
  const canonicalQuoteSnap = await refs.quotesRef.doc(quoteId).get();
  const canonicalQuote = canonicalQuoteSnap.exists
    ? canonicalQuoteSnap.data() || {}
    : null;
  const quoteActivity = evaluateRevenueAutopilotQuoteActivity({
    quoteExists: canonicalQuoteSnap.exists,
    quote: canonicalQuote,
    organizationId,
    nowISO,
    ignorePortalExpiry: jobKind === "post_event_review_request"
  });
  if (!quoteActivity.active) {
    const [update] = planRevenueAutopilotJobStops({
      jobs: [initialRaw],
      reason: quoteActivity.reason,
      nowISO
    });
    if (update) {
      await jobRef.set({
        ...update,
        updatedAtISO: nowISO,
        updatedAt: FieldValue.serverTimestamp()
      }, { merge: true });
    }
    return {
      action: update?.state === REVENUE_AUTOPILOT_JOB_STATES.STOPPED
        ? "stop"
        : "suppress",
      reason: quoteActivity.reason
    };
  }
  const authority = await readRevenueAutopilotExecutionAuthority({
    organizationId,
    quoteId,
    kind: jobKind,
    existingJobs: [initialRaw],
    nowISO
  });
  const planned = planRevenueAutopilotExecution({
    job: initialRaw,
    global: authority.input.global,
    tenantPolicy: authority.input.tenantPolicy,
    controls: authority.input.controls,
    stopScope: authority.input.stopScope,
    evidence: authority.input.evidence,
    nowISO
  });
  if ([
    "none",
    "wait",
    "block",
    "reconcile",
    "reconcile_blocked",
    "wait_for_provider_event"
  ].includes(planned.action)) {
    if (planned.job && commercialDependencyGraphCore.canonicalSerialize(planned.job)
      !== commercialDependencyGraphCore.canonicalSerialize(initialRaw)) {
      await jobRef.set({
        ...initialRaw,
        ...planned.job,
        updatedAtISO: nowISO,
        updatedAt: FieldValue.serverTimestamp()
      }, { merge: true });
    }
    return { action: planned.action, reason: planned.reason };
  }
  if (planned.action === "stop") {
    await jobRef.set({
      ...initialRaw,
      ...planned.job,
      updatedAtISO: nowISO,
      updatedAt: FieldValue.serverTimestamp()
    }, { merge: true });
    return { action: "stop", reason: planned.reason };
  }
  if (planned.action !== "claim") return { action: planned.action || "blocked" };

  const attemptId = `attempt_${randomUUID().replace(/-/g, "")}`;
  const claimed = await db.runTransaction(async (tx) => {
    const snap = await tx.get(jobRef);
    if (!snap.exists) return null;
    const raw = { jobId, ...(snap.data() || {}) };
    const claim = claimRevenueAutopilotJob({ job: raw, attemptId, nowISO });
    tx.set(jobRef, {
      ...raw,
      ...claim,
      updatedAtISO: nowISO,
      updatedAt: FieldValue.serverTimestamp()
    });
    return { raw, job: claim };
  });
  if (!claimed) return { action: "missing" };

  try {
    const recheckedAtISO = new Date().toISOString();
    const recheckedAuthority = await readRevenueAutopilotExecutionAuthority({
      organizationId,
      quoteId,
      kind: claimed.job.kind,
      existingJobs: [claimed.job],
      nowISO: recheckedAtISO
    });
    const rechecked = planRevenueAutopilotExecution({
      job: claimed.job,
      global: recheckedAuthority.input.global,
      tenantPolicy: recheckedAuthority.input.tenantPolicy,
      controls: recheckedAuthority.input.controls,
      stopScope: recheckedAuthority.input.stopScope,
      evidence: recheckedAuthority.input.evidence,
      nowISO: recheckedAtISO,
      ownedAttemptId: attemptId
    });
    if (rechecked.action === "stop") {
      await jobRef.set({
        ...claimed.raw,
        ...rechecked.job,
        updatedAtISO: recheckedAtISO,
        updatedAt: FieldValue.serverTimestamp()
      });
      return { action: "stop", reason: rechecked.reason };
    }
    if (rechecked.action !== "wait" || rechecked.reason !== "active_send_lease") {
      throw Object.assign(
        new Error("Canonical execution evidence changed before provider dispatch."),
        { revenueAutopilotOutcome: "definite_failure", code: "aborted" }
      );
    }
    const payload = claimed.raw.frozenPayload || {};
    if (
      !isValidEmail(payload.toEmail)
      || !normalizeText(payload.subject)
      || !normalizeText(payload.text)
      || !normalizeText(payload.html)
    ) {
      throw Object.assign(
        new Error("The frozen Revenue Autopilot email payload is incomplete."),
        { revenueAutopilotOutcome: "definite_failure", code: "failed-precondition" }
      );
    }
    const emailConfig = getEmailConfig();
    if (
      emailConfig.provider !== "resend"
      || !emailConfig.resendApiKey
      || !emailConfig.senderApproved
    ) {
      throw Object.assign(
        new Error("The approved Revenue Autopilot email provider is unavailable."),
        { revenueAutopilotOutcome: "definite_failure", code: "failed-precondition" }
      );
    }
    const providerResult = await sendEmailViaResend({
      apiKey: emailConfig.resendApiKey,
      from: `${emailConfig.fromName} <${emailConfig.fromEmail}>`,
      to: payload.toEmail,
      subject: payload.subject,
      text: payload.text,
      html: payload.html,
      idempotencyKey: claimed.job.idempotencyKey
    });
    const acceptedAtISO = new Date().toISOString();
    const acceptance = recordRevenueAutopilotProviderAcceptance({
      job: claimed.job,
      provider: "resend",
      providerMessageId: providerResult.id,
      nowISO: acceptedAtISO
    });
    const messageIndexRef = db.collection(REVENUE_AUTOPILOT_PROVIDER_MESSAGE_INDEX_COLLECTION)
      .doc(createHash("sha256").update(`resend|${providerResult.id}`).digest("hex"));
    await db.runTransaction(async (tx) => {
      const [jobSnap, messageIndexSnap] = await Promise.all([
        tx.get(jobRef),
        tx.get(messageIndexRef)
      ]);
      if (!jobSnap.exists) {
        throw new RevenueAutopilotError("not-found", "Claimed Revenue Autopilot job disappeared.");
      }
      const current = { jobId, ...(jobSnap.data() || {}) };
      if (
        normalizeText(current.attemptId) !== attemptId
        || normalizeText(current.state) !== REVENUE_AUTOPILOT_JOB_STATES.SENDING
      ) {
        throw new RevenueAutopilotError(
          "aborted",
          "Revenue Autopilot dispatch lease changed before provider acceptance was recorded."
        );
      }
      tx.set(jobRef, {
        ...current,
        ...acceptance.job,
        updatedAtISO: acceptedAtISO,
        updatedAt: FieldValue.serverTimestamp()
      });
      if (!messageIndexSnap.exists) {
        tx.create(messageIndexRef, {
          provider: "resend",
          providerMessageId: providerResult.id,
          organizationId,
          quoteId,
          jobId,
          customerId: normalizeText(current.customerId),
          recipientKey: normalizeText(current.recipientKey),
          providerAcceptedAtISO: acceptedAtISO,
          createdAt: FieldValue.serverTimestamp()
        });
      }
    });
    return { action: "provider_accepted", providerMessageId: providerResult.id };
  } catch (error) {
    const failedAtISO = new Date().toISOString();
    const failure = planRevenueAutopilotDispatchFailure({
      job: claimed.job,
      error,
      nowISO: failedAtISO
    });
    await db.runTransaction(async (tx) => {
      const snap = await tx.get(jobRef);
      if (!snap.exists) return;
      const current = { jobId, ...(snap.data() || {}) };
      if (
        normalizeText(current.attemptId) !== attemptId
        || normalizeText(current.state) !== REVENUE_AUTOPILOT_JOB_STATES.SENDING
      ) return;
      tx.set(jobRef, {
        ...current,
        ...failure.job,
        updatedAtISO: failedAtISO,
        updatedAt: FieldValue.serverTimestamp()
      });
    });
    return {
      action: failure.requiresReconciliation ? "outcome_ambiguous" : failure.outcome,
      reason: failure.job.outcomeReason
    };
  }
}

async function materializeScheduledRevenueAutopilotQuote({
  organizationId,
  quoteId,
  nowISO
} = {}) {
  const refs = revenueAutopilotRefs(organizationId, { quoteId });
  const [quoteSnap, organizationSnap, existingSnap, policySnap] = await Promise.all([
    refs.quoteRef.get(),
    refs.organizationRef.get(),
    refs.jobsRef.where("quoteId", "==", quoteId).limit(100).get(),
    refs.policyRef.get()
  ]);
  if (!quoteSnap.exists || !organizationSnap.exists || !policySnap.exists) {
    return { createdCount: 0, updatedCount: 0, state: "source_missing" };
  }
  const quote = { id: quoteId, ...(quoteSnap.data() || {}) };
  if (
    normalizeOrganizationId(quote.organizationId) !== organizationId
    || normalizeText(quote.deletedAtISO)
  ) {
    return { createdCount: 0, updatedCount: 0, state: "inactive_quote" };
  }
  const portalExpiresAtISO = normalizeText(quote.portalExpiresAtISO || quote.expiresAtISO);
  const portalExpired = Boolean(portalExpiresAtISO && portalExpiresAtISO <= nowISO);
  let expiryStopsApplied = 0;
  if (portalExpired) {
    const expiringJobs = existingSnap.docs
      .map((snapshot) => ({ jobId: snapshot.id, ...(snapshot.data() || {}) }))
      .filter((job) => normalizeText(job.kind).toLowerCase() !== "post_event_review_request");
    const expiryUpdates = planRevenueAutopilotJobStops({
      jobs: expiringJobs,
      reason: "portal_expired",
      nowISO
    });
    const batch = db.batch();
    expiryUpdates.forEach((update) => batch.set(refs.jobsRef.doc(update.jobId), {
      ...update,
      updatedAtISO: nowISO,
      updatedAt: FieldValue.serverTimestamp()
    }, { merge: true }));
    if (expiryUpdates.length) await batch.commit();
    expiryStopsApplied = expiryUpdates.length;
  }
  const customerId = normalizeText(quote.customerId);
  if (!customerId) {
    return { createdCount: 0, updatedCount: expiryStopsApplied, state: "customer_missing" };
  }
  const [customerSnap, controlsSnap] = await Promise.all([
    refs.customersRef.doc(customerId).get(),
    refs.controlsRef.doc(customerId).get()
  ]);
  if (!customerSnap.exists) {
    return { createdCount: 0, updatedCount: expiryStopsApplied, state: "customer_missing" };
  }
  const customer = customerSnap.data() || {};
  const controls = normalizeRevenueAutopilotEmailControls(
    controlsSnap.exists ? controlsSnap.data() || {} : null,
    { organizationId, customerId }
  );
  const policy = normalizeRevenueAutopilotTenantPolicy(policySnap.data() || {});
  const existingJobs = existingSnap.docs.map((snapshot) => ({
    jobId: snapshot.id,
    ...(snapshot.data() || {})
  }));
  let attentionResult = {
    state: "not_observed",
    createdCount: 0,
    updatedCount: 0
  };
  try {
    attentionResult = await reconcileRevenueAutopilotReplyAttentionForQuote({
      organizationId,
      quote,
      tenantPolicy: policy,
      nowISO
    });
  } catch (error) {
    attentionResult = {
      state: "blocked",
      createdCount: 0,
      updatedCount: 0,
      reason: normalizeText(error?.code) || "attention_reconciliation_failed"
    };
    functions.logger.warn("Revenue Autopilot reply Attention reconciliation skipped", {
      organizationId,
      quoteId,
      error: normalizeText(error?.message).slice(0, 200)
    });
  }
  const portalUrl = resolvePortalLink(quote);
  let createdCount = 0;
  let updatedCount = expiryStopsApplied;
  const secret = revenueAutopilotTokenSecret();

  for (const kind of [
    "quote_follow_up",
    "deposit_reminder",
    "final_balance_reminder",
    "post_event_review_request"
  ]) {
    if (portalExpired && kind !== "post_event_review_request") continue;
    try {
      const authority = await readRevenueAutopilotExecutionAuthority({
        organizationId,
        quoteId,
        kind,
        existingJobs,
        nowISO
      });
      if (authority.plan.conflicts.length) continue;
      const unsubscribeUrl = revenueAutopilotUnsubscribeUrl({
        organizationId,
        customerId,
        secret
      });
      const rendered = authority.plan.create.length
        ? renderRevenueAutopilotTemplate(
          policy.templates[kind],
          revenueAutopilotTemplateValues({
            quote,
            organization: organizationSnap.data() || {},
            portalUrl,
            reviewUrl: policy.reviewRequestUrl,
            unsubscribeUrl,
            kind
          })
        )
        : null;
      const targetRefs = authority.plan.create.map((job) => refs.jobsRef.doc(job.jobId));
      const writeResult = await db.runTransaction(async (tx) => {
        const targetSnaps = await Promise.all(targetRefs.map((ref) => tx.get(ref)));
        let updatesApplied = 0;
        let createsApplied = 0;
        authority.plan.updates.forEach((update) => {
          tx.set(refs.jobsRef.doc(update.jobId), {
            ...update,
            updatedAtISO: nowISO,
            updatedAt: FieldValue.serverTimestamp()
          }, { merge: true });
          updatesApplied += 1;
        });
        authority.plan.create.forEach((job, index) => {
          if (targetSnaps[index]?.exists) return;
          tx.create(targetRefs[index], {
            ...job,
            customerId,
            quoteLabel: normalizeText(quote.quoteNumber) || quoteId,
            customerLabel: normalizeText(customer.name || quote.customer?.name),
            recipientKey: controls.recipientKey,
            frozenPayload: {
              toEmail: normalizeEmail(customer.emailKey || customer.email || quote.customer?.email),
              subject: rendered.subject,
              text: rendered.text,
              html: rendered.html,
              templateFingerprint: rendered.templateFingerprint
            },
            sourceRevisionId: normalizeText(quote.activeVersionId),
            createdAt: FieldValue.serverTimestamp(),
            updatedAt: FieldValue.serverTimestamp()
          });
          createsApplied += 1;
        });
        return { createsApplied, updatesApplied };
      });
      createdCount += writeResult.createsApplied;
      updatedCount += writeResult.updatesApplied;
    } catch (error) {
      if (
        error instanceof RevenueAutopilotError
        || error instanceof RevenueAutopilotAuthorityError
        || error instanceof RevenueAutopilotTemplateError
        || error instanceof PaymentLedgerError
      ) continue;
      throw error;
    }
  }
  return {
    createdCount,
    updatedCount,
    state: "materialized",
    attention: attentionResult
  };
}

function throwDecisionDebtFailure(error, operation) {
  if (error instanceof functions.https.HttpsError) throw error;
  if (error instanceof DecisionDebtError) {
    throw new functions.https.HttpsError(error.code, error.message);
  }
  functions.logger.error(`${operation} failed`, {
    error: normalizeText(error?.message).slice(0, 240)
  });
  throw new functions.https.HttpsError(
    "internal",
    "The Decision Debt operation did not complete."
  );
}

function decisionDebtRequestId(value) {
  const requestId = normalizeText(value).toLowerCase();
  if (!/^decision_debt_request_[a-f0-9]{32}$/u.test(requestId)) {
    throw new DecisionDebtError("invalid-argument", "A valid Decision Debt request identity is required.");
  }
  return requestId;
}

function decisionDebtPolicyRecord(raw = null) {
  if (!raw || typeof raw !== "object" || Number(raw.schemaVersion) !== 1) {
    return {
      policy: decisionDebtAuthority.validatePolicy(DEFAULT_DECISION_DEBT_POLICY),
      revision: 0,
      policyVersion: "",
      configuredAtISO: "",
      configuredBy: "",
      lastMutation: null
    };
  }
  return {
    policy: decisionDebtAuthority.validatePolicy({
      schemaVersion: raw.schemaVersion,
      maxEventHorizonDays: raw.maxEventHorizonDays,
      decisionTypes: raw.decisionTypes
    }),
    revision: Number.isSafeInteger(Number(raw.revision)) && Number(raw.revision) >= 0
      ? Number(raw.revision)
      : 0,
    policyVersion: normalizeText(raw.policyVersion),
    configuredAtISO: normalizeText(raw.configuredAtISO),
    configuredBy: normalizeText(raw.configuredBy),
    lastMutation: raw.lastMutation && typeof raw.lastMutation === "object"
      ? {
          requestId: normalizeText(raw.lastMutation.requestId),
          requestFingerprint: normalizeText(raw.lastMutation.requestFingerprint)
        }
      : null
  };
}

function decisionDebtCommercialExposureCents(simulationReceipt = {}) {
  const values = simulationReceipt?.commercialValues || {};
  const currency = normalizeText(values.currency).toUpperCase();
  const before = Number(values.authoritativeTotal?.before);
  const proposedAfter = Number(values.authoritativeTotal?.proposedAfter);
  if (currency !== "USD" || !Number.isFinite(before) || !Number.isFinite(proposedAfter)) {
    return null;
  }
  const cents = Math.round(Math.abs(proposedAfter - before) * 100);
  return Number.isSafeInteger(cents) && cents >= 0 ? cents : null;
}

function assertDecisionDebtDependencyState({
  organizationId,
  quoteId,
  quote,
  state,
  invalidations
}) {
  const activeRevisionId = normalizeText(quote?.activeVersionId || quote?.versionMeta?.versionId);
  const customerId = normalizeText(quote?.customerId);
  const eventDate = normalizeText(quote?.event?.date);
  const totalInvalidationCount = Number(state?.totalInvalidationCount);
  const openInvalidationCount = Number(state?.openInvalidationCount);
  const resolvedInvalidationCount = Number(state?.resolvedInvalidationCount);
  const complete = (
    Number(state?.schemaVersion) === COMMERCIAL_DEPENDENCY_STATE_SCHEMA_VERSION
    && state?.authority === "server_authoritative"
    && normalizeOrganizationId(state?.organizationId) === organizationId
    && normalizeText(state?.quoteId) === quoteId
    && normalizeText(state?.customerId) === customerId
    && normalizeText(state?.eventDate) === eventDate
    && normalizeText(state?.activeRevisionId) === activeRevisionId
    && /^\d{4}-\d{2}-\d{2}$/u.test(eventDate)
    && state?.bounds?.invalidationSetComplete === true
    && Number(state?.bounds?.invalidationLimit) === COMMERCIAL_CHANGE_INVALIDATION_LIMIT
    && Number.isSafeInteger(totalInvalidationCount)
    && totalInvalidationCount >= 0
    && totalInvalidationCount <= COMMERCIAL_CHANGE_INVALIDATION_LIMIT
    && Number.isSafeInteger(openInvalidationCount)
    && openInvalidationCount >= 0
    && Number.isSafeInteger(resolvedInvalidationCount)
    && resolvedInvalidationCount >= 0
    && openInvalidationCount + resolvedInvalidationCount === totalInvalidationCount
    && Array.isArray(invalidations)
    && invalidations.length === totalInvalidationCount
  );
  if (!complete) {
    throw new DecisionDebtError(
      "failed-precondition",
      "Decision Debt dependency evidence is incomplete or stale."
    );
  }
  const openCount = invalidations.filter((item) => (
    ["open", "reopened"].includes(normalizeText(item?.state).toLowerCase())
  )).length;
  if (
    openCount !== openInvalidationCount
    || invalidations.some((item) => (
      normalizeOrganizationId(item?.organizationId) !== organizationId
      || normalizeText(item?.quoteId) !== quoteId
      || normalizeText(item?.targetRevisionId) !== activeRevisionId
      || normalizeText(item?.applyReceiptId) !== normalizeText(state?.latestApplyReceiptId)
      || !["open", "reopened", "resolved"].includes(
        normalizeText(item?.state).toLowerCase()
      )
    ))
  ) {
    throw new DecisionDebtError(
      "failed-precondition",
      "Decision Debt invalidation evidence does not match its trusted dependency state."
    );
  }
  return { activeRevisionId, customerId, eventDate, openInvalidationCount };
}

function listMissingFields(fieldPairs) {
  return fieldPairs.filter((item) => !normalizeText(item.value)).map((item) => item.name);
}

function buildIntegrationSetupStatus() {
  const smsProvider = getSmsProvider();
  const emailConfig = getEmailConfig();
  const twilioConfig = getTwilioConfig();
  const stripeConfig = getStripeConfig();
  const appBaseUrl = readConfig("app.base_url");

  const twilioMissingFields = listMissingFields([
    { name: "TWILIO_ACCOUNT_SID", value: twilioConfig.accountSid },
    { name: "TWILIO_AUTH_TOKEN", value: twilioConfig.authToken },
    { name: "TWILIO_MESSAGING_SERVICE_SID", value: twilioConfig.messagingServiceSid },
    { name: "NOTIFICATIONS_OWNER_PHONE", value: twilioConfig.toNumber }
  ]);
  const stripeMissingFields = listMissingFields([
    { name: "STRIPE_MODE", value: stripeConfig.mode },
    { name: "STRIPE_SECRET_KEY", value: stripeConfig.secretKey },
    { name: "STRIPE_WEBHOOK_SECRET", value: stripeConfig.webhookSecret }
  ]);
  const emailMissingFields = listMissingFields([
    { name: "EMAIL_FROM_EMAIL", value: emailConfig.fromEmail },
    ...(emailConfig.provider === "resend" ? [
      { name: "RESEND_API_KEY", value: emailConfig.resendApiKey },
      { name: "APPROVED_EMAIL_SENDER", value: emailConfig.senderApproved ? "approved" : "" }
    ] : [])
  ]);
  const twilioConfigured = twilioMissingFields.length === 0;
  let stripeConfigurationError = "";
  if (stripeMissingFields.length === 0) {
    try {
      assertStripeSecretKeyMode(stripeConfig.secretKey, stripeConfig.mode);
      normalizeStripeWebhookSecrets(stripeConfig.webhookSecret);
    } catch (err) {
      stripeConfigurationError = normalizeText(err?.message);
    }
  }
  const stripeConfigured = stripeMissingFields.length === 0 && !stripeConfigurationError;
  const emailConfigured = emailConfig.provider !== "none" && emailMissingFields.length === 0;

  return {
    evaluatedAtISO: new Date().toISOString(),
    smsProvider,
    smsProviderSupported: SMS_PROVIDERS.has(smsProvider),
    appBaseUrlConfigured: Boolean(normalizeText(appBaseUrl)),
    twilio: {
      configured: twilioConfigured,
      canSend: smsProvider === "twilio" && twilioConfigured,
      missingFields: twilioMissingFields,
      accountSidHint: maskText(twilioConfig.accountSid),
      fromNumberHint: maskText(twilioConfig.fromNumber),
      ownerPhoneHint: maskText(twilioConfig.toNumber)
    },
    stripe: {
      configured: stripeConfigured,
      mode: normalizeText(stripeConfig.mode).toLowerCase(),
      missingFields: stripeMissingFields,
      configurationError: stripeConfigurationError
    },
    email: {
      provider: emailConfig.provider,
      providerSupported: EMAIL_PROVIDERS.has(emailConfig.provider),
      configured: emailConfigured,
      fromEmailHint: maskText(emailConfig.fromEmail, 6),
      missingFields: emailMissingFields
    }
  };
}

function parseUrlOrThrow(raw, fieldName) {
  const text = normalizeText(raw);
  if (!text) {
    throw new functions.https.HttpsError("invalid-argument", `${fieldName} is required.`);
  }
  try {
    const parsed = new URL(text);
    if (parsed.protocol !== "https:" && parsed.protocol !== "http:") {
      throw new Error("invalid protocol");
    }
    return parsed.toString();
  } catch (err) {
    throw new functions.https.HttpsError("invalid-argument", `${fieldName} must be a valid URL.`);
  }
}

function parseStoredPaymentLinkOrThrow(raw) {
  if (normalizeText(raw).length > 2_000) {
    throw new functions.https.HttpsError(
      "failed-precondition",
      "Stored payment link exceeds the approved length."
    );
  }
  const paymentLink = parseUrlOrThrow(raw, "stored paymentLink");
  const parsed = new URL(paymentLink);
  if (
    parsed.protocol !== "https:"
    || parsed.username
    || parsed.password
    || !["checkout.stripe.com", "buy.stripe.com"].includes(parsed.hostname.toLowerCase())
  ) {
    throw new functions.https.HttpsError(
      "failed-precondition",
      "Stored payment link must use an approved Stripe checkout host."
    );
  }
  return parsed.toString();
}

function assertAdminStaff(staff) {
  if (staff?.role !== "admin") {
    throw new functions.https.HttpsError("permission-denied", "Admin role required.");
  }
  return staff;
}

function buildCleanupConfirmationToken(action = "", organizationId = "") {
  const normalizedAction = normalizeText(action).toUpperCase();
  const normalizedOrgId = normalizeOrganizationId(organizationId);
  if (!normalizedAction || !normalizedOrgId) return "";
  return `${normalizedAction} ${normalizedOrgId}`;
}

function assertCleanupConfirmation({
  action = "",
  organizationId = "",
  confirmationToken = ""
} = {}) {
  const normalizedAction = normalizeText(action).toLowerCase();
  const normalizedOrgId = normalizeOrganizationId(organizationId);
  const expectedToken = buildCleanupConfirmationToken(normalizedAction, normalizedOrgId);
  const providedToken = normalizeText(confirmationToken);

  if (!normalizedAction || !normalizedOrgId) {
    throw new functions.https.HttpsError("invalid-argument", "action and organizationId are required.");
  }
  if (!providedToken) {
    throw new functions.https.HttpsError("invalid-argument", `confirmationToken is required. Expected: ${expectedToken}`);
  }
  if (providedToken !== expectedToken) {
    throw new functions.https.HttpsError("invalid-argument", `confirmationToken mismatch. Expected: ${expectedToken}`);
  }
}

async function updateTenantDomainMappingsForOrganization({
  organizationId = "",
  mode = "archive",
  actorUid = "",
  actorEmail = "",
  nowISO = ""
} = {}) {
  const normalizedOrganizationId = normalizeOrganizationId(organizationId);
  if (!normalizedOrganizationId) return 0;

  const snapshot = await db.collection(TENANT_DOMAINS_COLLECTION)
    .where("organizationId", "==", normalizedOrganizationId)
    .get();

  if (snapshot.empty) return 0;

  let batch = db.batch();
  let batchWrites = 0;
  let total = 0;

  for (const docSnap of snapshot.docs) {
    total += 1;
    batchWrites += 1;
    if (mode === "delete") {
      batch.delete(docSnap.ref);
    } else {
      batch.set(docSnap.ref, {
        active: false,
        updatedAtISO: nowISO,
        updatedAt: FieldValue.serverTimestamp(),
        cleanup: {
          lastAction: "archived",
          lastActionAtISO: nowISO,
          actorUid: normalizeText(actorUid),
          actorEmail: normalizeEmail(actorEmail)
        }
      }, { merge: true });
    }

    if (batchWrites >= 400) {
      await batch.commit();
      batch = db.batch();
      batchWrites = 0;
    }
  }

  if (batchWrites > 0) {
    await batch.commit();
  }

  return total;
}

async function deleteOrganizationScopedDocuments(collectionName, organizationId) {
  const normalizedOrganizationId = normalizeOrganizationId(organizationId);
  if (!normalizedOrganizationId) return 0;

  let deleted = 0;
  while (true) {
    const snapshot = await db.collection(collectionName)
      .where("organizationId", "==", normalizedOrganizationId)
      .limit(400)
      .get();
    if (snapshot.empty) return deleted;

    const batch = db.batch();
    snapshot.docs.forEach((docSnap) => batch.delete(docSnap.ref));
    await batch.commit();
    deleted += snapshot.size;
  }
}

async function deleteOrganizationPortalSnapshots(organizationId) {
  const normalizedOrganizationId = normalizeOrganizationId(organizationId);
  if (!normalizedOrganizationId) return 0;

  // Delete current snapshots by explicit tenant scope first.
  let deleted = await deleteOrganizationScopedDocuments(
    PORTAL_COLLECTION,
    normalizedOrganizationId
  );

  // Older snapshots may predate organizationId on the top-level portal copy.
  // Resolve their exact keys from the tenant-owned quotes before recursive
  // organization deletion so no still-valid public token survives cleanup.
  const quotesSnap = await db
    .collection(ORGANIZATIONS_COLLECTION)
    .doc(normalizedOrganizationId)
    .collection(QUOTES_COLLECTION)
    .get();
  const portalTargets = new Map();
  quotesSnap.docs.forEach((quoteSnap) => {
    const portalKey = normalizeText(quoteSnap.data()?.portalKey);
    if (!portalKey) return;
    const existingQuoteId = portalTargets.get(portalKey);
    portalTargets.set(
      portalKey,
      existingQuoteId && existingQuoteId !== quoteSnap.id
        ? ""
        : quoteSnap.id
    );
  });
  const provenTargets = Array.from(portalTargets.entries())
    .filter(([, quoteId]) => Boolean(quoteId));

  for (let index = 0; index < provenTargets.length; index += 200) {
    const chunk = provenTargets.slice(index, index + 200);
    const deletedInTransaction = await db.runTransaction(async (transaction) => {
      const snapshots = await Promise.all(
        chunk.map(([portalKey]) => transaction.get(
          db.collection(PORTAL_COLLECTION).doc(portalKey)
        ))
      );
      let count = 0;
      snapshots.forEach((snapshot, snapshotIndex) => {
        if (!snapshot.exists) return;
        const [portalKey, quoteId] = chunk[snapshotIndex];
        const data = snapshot.data() || {};
        const portalOrganizationId = normalizeOrganizationId(data.organizationId);
        if (
          snapshot.id !== portalKey
          || normalizeText(data.quoteId) !== quoteId
          || (
            portalOrganizationId
            && portalOrganizationId !== normalizedOrganizationId
          )
        ) {
          return;
        }
        transaction.delete(snapshot.ref);
        count += 1;
      });
      return count;
    });
    deleted += deletedInTransaction;
  }

  return deleted;
}

async function retireOrganizationRoleAssignments(organizationId) {
  const normalizedOrganizationId = normalizeOrganizationId(organizationId);
  if (!normalizedOrganizationId) {
    return {
      deleted: 0,
      claimFailures: []
    };
  }

  let deleted = 0;
  const claimFailures = [];
  while (true) {
    const snapshot = await db.collection(ROLES_COLLECTION)
      .where("organizationId", "==", normalizedOrganizationId)
      .limit(200)
      .get();
    if (snapshot.empty) {
      return {
        deleted,
        claimFailures
      };
    }

    await Promise.all(snapshot.docs.map(async (roleSnap) => {
      try {
        const user = await auth.getUser(roleSnap.id);
        await syncPrincipalClaims({
          uid: roleSnap.id,
          role: "customer",
          organizationId: "",
          platformAdmin: isPlatformAdminEmail(user.email)
        });
      } catch (error) {
        if (error?.code !== "auth/user-not-found") {
          claimFailures.push({
            uid: roleSnap.id,
            error: normalizeText(error?.message || "Auth claim retirement failed.").slice(0, 180)
          });
          functions.logger.error("Organization role claim retirement failed; authoritative role will still be removed", {
            organizationId: normalizedOrganizationId,
            uid: roleSnap.id,
            error: normalizeText(error?.message)
          });
        }
      }
    }));

    // The role document is the authorization source of truth. Remove it even
    // if Firebase Auth claim cleanup failed so an old token cannot retain access.
    const batch = db.batch();
    snapshot.docs.forEach((roleSnap) => batch.delete(roleSnap.ref));
    await batch.commit();
    deleted += snapshot.size;
  }
}

function getStripeClient() {
  const secretKey = readBoundSecret(STRIPE_SECRET_NAME);
  if (!secretKey) {
    throw new functions.https.HttpsError(
      "failed-precondition",
      "Stripe is not configured in the project-scoped Functions environment."
    );
  }
  try {
    assertStripeSecretKeyMode(secretKey, readConfig("stripe.mode"));
  } catch (err) {
    if (err instanceof StripeProviderStateError) {
      throw new functions.https.HttpsError(err.code, err.message);
    }
    throw err;
  }
  return new Stripe(secretKey);
}

function getStripeMode() {
  try {
    return normalizeStripeMode(readConfig("stripe.mode"));
  } catch (err) {
    if (err instanceof StripeProviderStateError) {
      throw new functions.https.HttpsError(err.code, err.message);
    }
    throw err;
  }
}

function getBuyerAccessStripeClient() {
  const { mode, secretKey } = getBuyerAccessStripeConfig();
  if (!secretKey) {
    throw new functions.https.HttpsError(
      "failed-precondition",
      "Buyer access Stripe invoicing is not configured."
    );
  }
  try {
    assertStripeSecretKeyMode(secretKey, mode);
    assertBuyerAccessRuntime({ enabled: "true", stripeMode: mode });
  } catch (err) {
    if (err instanceof StripeProviderStateError || err instanceof BuyerAccessError) {
      throw new functions.https.HttpsError(err.code, err.message);
    }
    throw err;
  }
  return new Stripe(secretKey, { apiVersion: BUYER_ACCESS_STRIPE_API_VERSION });
}

function assertBuyerAccessRuntimeEnabled() {
  try {
    return assertBuyerAccessRuntime({
      enabled: readConfig("buyer_access.enabled"),
      stripeMode: readConfig("buyer_access_stripe_mode")
    });
  } catch (err) {
    if (err instanceof BuyerAccessError) {
      throw new functions.https.HttpsError(err.code, err.message);
    }
    throw err;
  }
}

async function ensureOrganizationBootstrapInternal({
  uid,
  email,
  authenticatedClaims = {}
}) {
  const normalizedUid = normalizeText(uid);
  const normalizedEmail = normalizeEmail(email);
  if (!normalizedUid || !normalizedEmail) {
    throw new functions.https.HttpsError("invalid-argument", "Authenticated user and email are required.");
  }

  return db.runTransaction(async (tx) => {
    const roleRef = db.collection(ROLES_COLLECTION).doc(normalizedUid);
    const roleSnap = await tx.get(roleRef);
    const pendingInvite = await readPendingOrganizationInvite(tx, normalizedEmail);
    const roleData = roleSnap.data() || {};

    const platformAdmin = isPlatformAdminEmail(normalizedEmail);
    const existingRole = normalizeRole(roleData.role);
    const role = pendingInvite?.role || (platformAdmin ? "admin" : existingRole);
    let organizationId = normalizeOrganizationId(
      pendingInvite?.organizationId || roleData.organizationId
    );
    let buyerAccessOrderRef = null;
    let buyerAccessOrder = null;
    let resolvedBuyerAccessOrderId = "";
    const roleBuyerAccessOrderId = normalizeText(roleData.buyerAccessOrderId);
    const roleBuyerAccessMode = normalizeText(roleData.buyerAccessMode);
    const roleSource = normalizeText(roleData.source);
    const hasBuyerAccessRoleTag = Boolean(
      roleBuyerAccessOrderId
      || roleBuyerAccessMode
      || roleSource === BUYER_ACCESS_FLOW
    );

    if (pendingInvite?.buyerAccessOrderId) {
      const buyerAccessOrderId = normalizeText(pendingInvite.buyerAccessOrderId);
      if (
        !/^ba-[a-f0-9]{40}$/.test(buyerAccessOrderId)
        || pendingInvite.buyerAccessMode !== BUYER_ACCESS_MODE
        || hasBuyerAccessRoleTag
      ) {
        throw new functions.https.HttpsError(
          "failed-precondition",
          "The paid buyer invitation identity is invalid."
        );
      }
      resolvedBuyerAccessOrderId = buyerAccessOrderId;
      buyerAccessOrderRef = db.collection(BUYER_ACCESS_ORDERS_COLLECTION).doc(buyerAccessOrderId);
      const buyerAccessOrderSnap = await tx.get(buyerAccessOrderRef);
      if (!buyerAccessOrderSnap.exists) {
        throw new functions.https.HttpsError(
          "failed-precondition",
          "The paid buyer order for this invitation is missing."
        );
      }
      buyerAccessOrder = buyerAccessOrderSnap.data() || {};
      if (
        normalizeText(buyerAccessOrder.orderId) !== buyerAccessOrderId
        || normalizeText(buyerAccessOrder.flow) !== BUYER_ACCESS_FLOW
        || normalizeText(buyerAccessOrder.buyerAccessMode) !== BUYER_ACCESS_MODE
        || normalizeEmail(buyerAccessOrder.ownerEmail) !== normalizedEmail
        || normalizeOrganizationId(buyerAccessOrder.organizationId) !== organizationId
        || buyerAccessOrder.workspaceReady !== true
        || !["activation_pending", "activation_sent"].includes(
          normalizeText(buyerAccessOrder.status).toLowerCase()
        )
      ) {
        throw new functions.https.HttpsError(
          "failed-precondition",
          "The paid buyer invitation no longer matches its fulfillment record."
        );
      }
      const existingRoleOrganizationId = normalizeOrganizationId(
        roleData.organizationId
      );
      const existingRoleName = normalizeText(roleData.role).toLowerCase();
      const authenticatedOrganizationId = normalizeOrganizationId(
        authenticatedClaims.organizationId
      );
      const authenticatedRole = normalizeText(authenticatedClaims.role).toLowerCase();
      if (
        platformAdmin
        || existingRoleOrganizationId
        || (existingRoleName && existingRoleName !== "customer")
        || authenticatedOrganizationId
        || (authenticatedRole && authenticatedRole !== "customer")
      ) {
        throw new functions.https.HttpsError(
          "failed-precondition",
          "The paid buyer invitation cannot replace existing organization access."
        );
      }
    } else if (hasBuyerAccessRoleTag) {
      if (
        !/^ba-[a-f0-9]{40}$/.test(roleBuyerAccessOrderId)
        || roleBuyerAccessMode !== BUYER_ACCESS_MODE
        || roleSource !== BUYER_ACCESS_FLOW
      ) {
        throw new functions.https.HttpsError(
          "failed-precondition",
          "The paid buyer role recovery identity is invalid."
        );
      }
      buyerAccessOrderRef = db.collection(BUYER_ACCESS_ORDERS_COLLECTION)
        .doc(roleBuyerAccessOrderId);
      const buyerAccessOrderSnap = await tx.get(buyerAccessOrderRef);
      if (!buyerAccessOrderSnap.exists) {
        throw new functions.https.HttpsError(
          "failed-precondition",
          "The paid buyer order for this role is missing."
        );
      }
      buyerAccessOrder = buyerAccessOrderSnap.data() || {};
      try {
        const recovered = resolveBuyerAccessBootstrapRecovery({
          authenticatedClaims,
          buyerAccessOrder,
          email: normalizedEmail,
          roleRecord: roleData,
          uid: normalizedUid
        });
        resolvedBuyerAccessOrderId = recovered.buyerAccessOrderId;
        organizationId = recovered.organizationId;
      } catch (err) {
        throwBuyerAccessHttpsError(err);
      }
    }

    if ((role === "admin" || role === "sales") && !organizationId && !platformAdmin) {
      throw new functions.https.HttpsError(
        "failed-precondition",
        "Staff account is missing an explicitly provisioned organization scope."
      );
    }

    if (organizationId) {
      const orgRef = db.collection(ORGANIZATIONS_COLLECTION).doc(organizationId);
      const tombstoneRef = db.collection(ORGANIZATION_TOMBSTONES_COLLECTION).doc(organizationId);
      const [orgSnap, tombstoneSnap] = await Promise.all([
        tx.get(orgRef),
        tx.get(tombstoneRef)
      ]);
      if (tombstoneSnap.exists) {
        throw new functions.https.HttpsError(
          "failed-precondition",
          "This organization has been retired and cannot be restored by signing in."
        );
      }
      if (!orgSnap.exists) {
        throw new functions.https.HttpsError(
          "failed-precondition",
          "The assigned organization is missing. A platform administrator must provision it before sign-in."
        );
      }
      if (!isOrganizationRecordActive(orgSnap.data())) {
        throw new functions.https.HttpsError(
          "failed-precondition",
          "This organization is inactive or archived. Contact a platform administrator."
        );
      }
    }

    if (pendingInvite) {
      const nowISO = new Date().toISOString();
      tx.set(pendingInvite.inviteRef, {
        status: "consumed",
        consumedByUid: normalizedUid,
        consumedByEmail: normalizedEmail,
        consumedAt: FieldValue.serverTimestamp(),
        consumedAtISO: nowISO,
        updatedAt: FieldValue.serverTimestamp(),
        updatedAtISO: nowISO
      }, { merge: true });
      if (buyerAccessOrderRef && buyerAccessOrder) {
        tx.set(buyerAccessOrderRef, {
          status: "active",
          accessGranted: true,
          ownerUid: normalizedUid,
          activatedAtISO: nowISO,
          claimsSyncStatus: "pending",
          updatedAtISO: nowISO,
          updatedAt: FieldValue.serverTimestamp()
        }, { merge: true });
      }
    }

    const rolePayload = {
      role,
      email: normalizedEmail,
      organizationId: organizationId || "",
      updatedAt: FieldValue.serverTimestamp()
    };
    if (resolvedBuyerAccessOrderId) {
      rolePayload.buyerAccessOrderId = resolvedBuyerAccessOrderId;
      rolePayload.buyerAccessMode = BUYER_ACCESS_MODE;
      rolePayload.source = BUYER_ACCESS_FLOW;
    }
    if (!roleSnap.exists) {
      rolePayload.createdAt = FieldValue.serverTimestamp();
    }

    tx.set(roleRef, rolePayload, { merge: true });

    return {
      role,
      organizationId: organizationId || "",
      createdOrganization: false,
      buyerAccessOrderId: resolvedBuyerAccessOrderId
    };
  });
}

async function getUserRole(uid) {
  const roleSnap = await db.collection(ROLES_COLLECTION).doc(uid).get();
  const role = normalizeRole(roleSnap.data()?.role);
  const organizationId = normalizeOrganizationId(roleSnap.data()?.organizationId);
  return {
    exists: roleSnap.exists,
    role,
    organizationId,
    email: normalizeEmail(roleSnap.data()?.email)
  };
}

function getRuntimeRoleOrgFromClaims(context) {
  const token = context?.auth?.token || {};
  return {
    organizationId: normalizeOrganizationId(token.organizationId),
    claimsVersion: Number(token.claimsVersion || 0) || 0,
    email: normalizeEmail(token.email || ""),
    emailVerified: token.email_verified === true
  };
}

function mergeRuntimePrincipal({ claimsOrg = "", roleDoc = { role: "customer", organizationId: "" } } = {}) {
  const roleDocRole = normalizeRole(roleDoc?.role);
  const roleDocOrg = normalizeOrganizationId(roleDoc?.organizationId);
  const claimOrg = normalizeOrganizationId(claimsOrg);

  if (claimOrg && roleDocOrg && claimOrg !== roleDocOrg) {
    throw new functions.https.HttpsError("permission-denied", "Claim organization does not match role scope.");
  }

  // Privileged authorization is fail-closed on the current role document.
  // Token claims are a cache for UI/runtime convenience, never an elevation.
  return {
    role: roleDocRole,
    organizationId: roleDocOrg
  };
}

function hasCrossOrgPolicyBypass({
  role = "",
  roleEmail = "",
  authenticatedEmail = "",
  emailVerified = false
} = {}) {
  const normalizedRole = normalizeRole(role);
  const normalizedRoleEmail = normalizeEmail(roleEmail);
  const normalizedAuthenticatedEmail = normalizeEmail(authenticatedEmail);
  return normalizedRole === "admin"
    && emailVerified === true
    && Boolean(normalizedRoleEmail)
    && normalizedRoleEmail === normalizedAuthenticatedEmail
    && isPlatformAdminEmail(normalizedAuthenticatedEmail);
}

async function syncPrincipalClaims({
  uid = "",
  role = "customer",
  organizationId = "",
  rejectOrganizationReassignment = false,
  platformAdmin
} = {}) {
  const normalizedUid = normalizeText(uid);
  if (!normalizedUid) return;

  const normalizedRole = normalizeRole(role);
  const normalizedOrgId = normalizeOrganizationId(organizationId);
  const currentRecord = await auth.getUser(normalizedUid);
  const existingClaims = currentRecord.customClaims && typeof currentRecord.customClaims === "object"
    ? currentRecord.customClaims
    : {};
  const existingOrganizationId = normalizeOrganizationId(existingClaims.organizationId);
  if (
    rejectOrganizationReassignment
    && existingOrganizationId
    && existingOrganizationId !== normalizedOrgId
  ) {
    throw new functions.https.HttpsError(
      "failed-precondition",
      "Owner claims changed to a different organization during provisioning."
    );
  }
  const nextClaims = {
    ...existingClaims,
    role: normalizedRole,
    organizationId: normalizedOrgId,
    claimsVersion: CLAIMS_VERSION
  };
  if (typeof platformAdmin === "boolean") {
    nextClaims.platformAdmin = platformAdmin;
  }
  await auth.setCustomUserClaims(normalizedUid, nextClaims);
}

async function resolveTenantByHostInternal(hostname = "", { enforceActive = true, requestIp = "" } = {}) {
  const normalizedHost = normalizeHostname(hostname);
  const hostType = getHostType(normalizedHost);

  if (hostType === "app" || hostType === "marketing" || hostType === "local") {
    return {
      hostname: normalizedHost,
      hostType,
      organizationId: "",
      active: true,
      environment: hostType === "local" ? "local" : "prod",
      brandingRef: ""
    };
  }

  if (hostType !== "tenant") {
    const throttle = recordUnknownHostAttempt({ host: normalizedHost, ip: requestIp });
    functions.logger.warn("Tenant host resolution rejected: invalid host type", {
      hostname: normalizedHost,
      hostType,
      requestIp,
      count: throttle.count
    });
    if (throttle.blocked) {
      throw new functions.https.HttpsError("resource-exhausted", "Host resolution throttled.");
    }
    throw new functions.https.HttpsError("not-found", "Tenant host not found.");
  }

  const domainSnap = await db.collection(TENANT_DOMAINS_COLLECTION).doc(normalizedHost).get();
  if (!domainSnap.exists) {
    const throttle = recordUnknownHostAttempt({ host: normalizedHost, ip: requestIp });
    functions.logger.warn("Tenant host resolution rejected: host missing", {
      hostname: normalizedHost,
      requestIp,
      count: throttle.count
    });
    if (throttle.blocked) {
      throw new functions.https.HttpsError("resource-exhausted", "Host resolution throttled.");
    }
    throw new functions.https.HttpsError("not-found", "Tenant host not found.");
  }

  const domain = domainSnap.data() || {};
  const organizationId = normalizeOrganizationId(domain.organizationId);
  const active = domain.active !== false;
  const environment = normalizeText(domain.environment || "prod").toLowerCase() || "prod";
  const brandingRef = normalizeText(domain.brandingRef || "");

  if (!organizationId) {
    throw new functions.https.HttpsError("failed-precondition", "Tenant host has no organization mapping.");
  }
  if (enforceActive && !active) {
    throw new functions.https.HttpsError("not-found", "Tenant host is inactive.");
  }

  return {
    hostname: normalizedHost,
    hostType,
    organizationId,
    active,
    environment,
    brandingRef
  };
}

async function assertStaff(context, {
  expectedOrganizationId = "",
  hostname = "",
  allowInactiveOrganization = false
} = {}) {
  if (!context.auth?.uid) {
    throw new functions.https.HttpsError("unauthenticated", "Sign in required.");
  }
  if (context.auth?.token?.email_verified !== true) {
    throw new functions.https.HttpsError(
      "failed-precondition",
      "Verify the authenticated email address before using staff or platform authority."
    );
  }

  const requestHost = normalizeHostname(hostname || getRequestHostnameFromContext(context));
  const requestIp = getRequestIp(context);
  const hostResolution = await resolveTenantByHostInternal(requestHost, {
    enforceActive: true,
    requestIp
  });

  const roleRecord = await getUserRole(context.auth.uid);
  const claimPrincipal = getRuntimeRoleOrgFromClaims(context);
  const mergedPrincipal = mergeRuntimePrincipal({
    claimsOrg: claimPrincipal.organizationId,
    roleDoc: roleRecord
  });
  const role = mergedPrincipal.role;
  if (!STAFF_ROLES.has(role)) {
    throw new functions.https.HttpsError("permission-denied", "Staff role required.");
  }
  const authenticatedEmail = normalizeEmail(claimPrincipal.email);
  const roleEmail = normalizeEmail(roleRecord.email);
  if (!authenticatedEmail) {
    throw new functions.https.HttpsError(
      "failed-precondition",
      "The verified authenticated email is required for staff authority."
    );
  }
  if (roleEmail && roleEmail !== authenticatedEmail) {
    throw new functions.https.HttpsError(
      "permission-denied",
      "The authenticated email does not match the authoritative role assignment."
    );
  }

  const principalOrg = normalizeOrganizationId(mergedPrincipal.organizationId);
  const tenantOrg = normalizeOrganizationId(hostResolution.organizationId);
  const requestedOrg = normalizeOrganizationId(expectedOrganizationId);
  const bypass = hasCrossOrgPolicyBypass({
    role,
    roleEmail: roleRecord.email,
    authenticatedEmail: claimPrincipal.email,
    emailVerified: claimPrincipal.emailVerified
  });

  if ((requestedOrg || tenantOrg) && !principalOrg && !bypass) {
    throw new functions.https.HttpsError("permission-denied", "Staff account is missing organization scope.");
  }
  if (tenantOrg && principalOrg && tenantOrg !== principalOrg && !bypass) {
    throw new functions.https.HttpsError("permission-denied", "Tenant host is outside your organization scope.");
  }
  if (requestedOrg && principalOrg && requestedOrg !== principalOrg && !bypass) {
    throw new functions.https.HttpsError("permission-denied", "Requested organization is outside your role scope.");
  }
  if (requestedOrg && tenantOrg && requestedOrg !== tenantOrg && !bypass) {
    throw new functions.https.HttpsError("permission-denied", "Requested organization does not match tenant host.");
  }

  const scopedOrganizationId = requestedOrg || tenantOrg || principalOrg;
  if (scopedOrganizationId && !allowInactiveOrganization) {
    const orgRef = db.collection(ORGANIZATIONS_COLLECTION).doc(scopedOrganizationId);
    const tombstoneRef = db.collection(ORGANIZATION_TOMBSTONES_COLLECTION).doc(scopedOrganizationId);
    const [orgSnap, tombstoneSnap] = await Promise.all([
      orgRef.get(),
      tombstoneRef.get()
    ]);
    if (
      !orgSnap.exists
      || tombstoneSnap.exists
      || !isOrganizationRecordActive(orgSnap.data())
    ) {
      throw new functions.https.HttpsError(
        "failed-precondition",
        "Organization is missing, inactive, archived, or retired."
      );
    }
  }
  return {
    uid: context.auth.uid,
    role,
    organizationId: scopedOrganizationId,
    principalOrganizationId: principalOrg,
    claimsVersion: claimPrincipal.claimsVersion,
    email: authenticatedEmail,
    host: requestHost,
    hostType: hostResolution.hostType,
    resolvedHostOrg: tenantOrg,
    crossOrgBypass: bypass,
    platformAdmin: bypass
  };
}

function getQuoteDocRef(quoteId, organizationId = "") {
  const id = normalizeText(quoteId);
  if (!id) {
    throw new functions.https.HttpsError("invalid-argument", "quoteId is required.");
  }
  const orgId = normalizeOrganizationId(organizationId);
  if (!orgId) {
    throw new functions.https.HttpsError("invalid-argument", "organizationId is required.");
  }
  return db.collection(ORGANIZATIONS_COLLECTION).doc(orgId).collection(QUOTES_COLLECTION).doc(id);
}

function normalizeApprovalExecutionId(value) {
  const id = normalizeText(value);
  return /^[A-Za-z0-9_-]{1,160}$/.test(id) ? id : "";
}

function getQuoteApprovalExecutionDocRef(organizationId, approvalRequestId) {
  const orgId = normalizeOrganizationId(organizationId);
  const executionId = normalizeApprovalExecutionId(approvalRequestId);
  if (!orgId || !executionId) {
    throw new functions.https.HttpsError(
      "invalid-argument",
      "organizationId and a valid approvalRequestId are required."
    );
  }
  return db
    .collection(ORGANIZATIONS_COLLECTION)
    .doc(orgId)
    .collection(QUOTE_APPROVAL_EXECUTIONS_COLLECTION)
    .doc(executionId);
}

function getPrivatePaymentDispatchDocRef(organizationId, approvalRequestId) {
  const orgId = normalizeOrganizationId(organizationId);
  const executionId = normalizeApprovalExecutionId(approvalRequestId);
  if (!orgId || !executionId) {
    throw new functions.https.HttpsError(
      "invalid-argument",
      "organizationId and a valid approvalRequestId are required."
    );
  }
  return db
    .collection(ORGANIZATIONS_COLLECTION)
    .doc(orgId)
    .collection(PRIVATE_PAYMENT_DISPATCHES_COLLECTION)
    .doc(executionId);
}

function redactCheckoutPreparation(preparation = {}) {
  const source = preparation && typeof preparation === "object" ? preparation : {};
  const {
    privateDepositLink: _privateDepositLink,
    url: _url,
    ...safePreparation
  } = source;
  const redactPaymentLink = (payment) => (
    payment && typeof payment === "object" && !Array.isArray(payment)
      ? { ...payment, depositLink: "" }
      : payment
  );
  return {
    ...safePreparation,
    expectedPayment: redactPaymentLink(safePreparation.expectedPayment),
    preparedPayment: redactPaymentLink(safePreparation.preparedPayment),
    publishedPayment: redactPaymentLink(safePreparation.publishedPayment)
  };
}

function restorePrivateCheckoutPreparation(auditPreparation, privateDispatch, {
  organizationId = "",
  quoteId = "",
  approvalRequestId = ""
} = {}) {
  const audit = auditPreparation && typeof auditPreparation === "object"
    ? auditPreparation
    : null;
  const privateRecord = privateDispatch && typeof privateDispatch === "object"
    ? privateDispatch
    : null;
  if (!audit) return null;
  const privateDepositLink = normalizeText(privateRecord?.privateDepositLink);
  if (!privateDepositLink) {
    throw new PaymentSafetyError(
      "The private checkout preparation is missing. Request provider review before retrying."
    );
  }
  const auditPaymentKind = normalizeText(audit.paymentKind).toLowerCase() || "deposit";
  const privatePaymentKind = normalizeText(privateRecord.paymentKind).toLowerCase() || "deposit";
  if (
    auditPaymentKind !== privatePaymentKind
    || !PAYMENT_REQUEST_FLOWS[auditPaymentKind]
    || (
    normalizeOrganizationId(privateRecord.organizationId) !== normalizeOrganizationId(organizationId)
    || normalizeText(privateRecord.quoteId) !== normalizeText(quoteId)
    || normalizeApprovalExecutionId(privateRecord.approvalRequestId)
      !== normalizeApprovalExecutionId(approvalRequestId)
    || normalizeText(privateRecord.stripeSessionId) !== normalizeText(audit.stripeSessionId)
    || normalizeText(privateRecord.actionScopeDigest).toLowerCase()
      !== normalizeText(audit.actionScopeDigest).toLowerCase()
    )
  ) {
    throw new PaymentSafetyError("Private checkout preparation scope is invalid.");
  }
  const paymentAlreadyPublished = audit.paymentAlreadyPublished === true;
  const restorePaymentLink = (payment, { published = false } = {}) => (
    payment && typeof payment === "object" && !Array.isArray(payment)
      ? {
        ...payment,
        depositLink: published || paymentAlreadyPublished ? privateDepositLink : ""
      }
      : payment
  );
  return {
    ...audit,
    expectedPayment: restorePaymentLink(audit.expectedPayment),
    preparedPayment: restorePaymentLink(audit.preparedPayment),
    publishedPayment: restorePaymentLink(audit.publishedPayment, { published: true }),
    privateDepositLink,
    paymentKind: auditPaymentKind
  };
}

function buildApprovalExecutionAudit({
  organizationId,
  quoteId,
  approvalRequest,
  staff,
  state,
  startedAtISO,
  completedAtISO = "",
  result = {},
  error = ""
} = {}) {
  const actionScope = approvalRequest?.actionScope
    && typeof approvalRequest.actionScope === "object"
    && !Array.isArray(approvalRequest.actionScope)
    ? approvalRequest.actionScope
    : null;
  const actionScopeDigest = normalizeText(approvalRequest?.actionScopeDigest).toLowerCase();
  return {
    organizationId: normalizeOrganizationId(organizationId),
    quoteId: normalizeText(quoteId),
    approvalRequestId: normalizeApprovalExecutionId(approvalRequest?.id),
    action: normalizeText(approvalRequest?.action),
    ...(actionScope && actionScopeDigest
      ? {
        actionScope: { ...actionScope },
        actionScopeDigest
      }
      : {}),
    approvalResolvedAtISO: normalizeText(approvalRequest?.resolvedAtISO),
    approvalResolvedByEmail: normalizeEmail(approvalRequest?.resolvedByEmail),
    state: normalizeText(state).toLowerCase(),
    startedAtISO: normalizeText(startedAtISO),
    completedAtISO: normalizeText(completedAtISO),
    executedBy: {
      uid: normalizeText(staff?.uid),
      email: normalizeEmail(staff?.email),
      role: normalizeText(staff?.role).toLowerCase()
    },
    result: result && typeof result === "object" ? result : {},
    error: normalizeText(error).slice(0, 500),
    updatedAtISO: normalizeText(completedAtISO || startedAtISO),
    updatedAt: FieldValue.serverTimestamp()
  };
}

function findQuoteApprovalRequest(workflow, approvalRequestId) {
  const requestId = normalizeApprovalExecutionId(approvalRequestId);
  const requests = Array.isArray(workflow?.approvalRequests)
    ? workflow.approvalRequests
    : [];
  return requests.find((request) => (
    normalizeApprovalExecutionId(request?.id) === requestId
  )) || null;
}

function assertNoInProgressPaymentDispatch(quote, operationLabel = "this action") {
  const approvalRequests = Array.isArray(quote?.workflow?.approvalRequests)
    ? quote.workflow.approvalRequests
    : [];
  const paymentDispatch = approvalRequests.find((request) => (
    new Set(["send_payment_request", "send_final_balance_request"]).has(
      normalizeText(request?.action)
    )
    && normalizeText(request?.executionState).toLowerCase() === "in_progress"
  ));
  if (paymentDispatch) {
    throw new functions.https.HttpsError(
      "aborted",
      `Finish or reconcile the in-progress payment request before ${operationLabel}.`
    );
  }
}

function derivePaymentRequestApprovalScope({
  quote,
  quoteId,
  organizationId,
  portalSnapshot,
  nowISO,
  allowSettled = false,
  allowExpiredPortal = false
} = {}) {
  const status = normalizeText(quote?.status).toLowerCase();
  if (!["accepted", "booked"].includes(status)) {
    throw new functions.https.HttpsError(
      "failed-precondition",
      "Payment requests can be approved only after quote acceptance."
    );
  }
  if (!isValidEmail(quote?.customer?.email)) {
    throw new functions.https.HttpsError(
      "failed-precondition",
      "Quote customer email is missing."
    );
  }
  const paymentStatus = normalizeText(quote?.payment?.depositStatus).toLowerCase() || "unpaid";
  const providerTruthSettled = (
    ["paid", "refunded"].includes(paymentStatus)
    || normalizeText(quote?.payment?.depositConfirmedAtISO)
  );
  if (providerTruthSettled && !allowSettled) {
    throw new functions.https.HttpsError(
      "failed-precondition",
      "Paid or refunded deposit evidence cannot receive another payment request."
    );
  }
  if (!providerTruthSettled) {
    planDepositCheckout(quote?.payment);
  }
  if (normalizeText(quote?.payment?.depositLink)) {
    parseStoredPaymentLinkOrThrow(quote.payment.depositLink);
  }
  const portal = assertQuoteDeliveryPortalActivation({
    quote,
    quoteId,
    organizationId,
    portalSnapshot,
    nowISO,
    allowExpired: allowExpiredPortal
  });
  return buildPaymentApprovalScope({
    quote,
    quoteId,
    organizationId,
    quoteRevisionId: portal.revisionId || resolveQuoteDeliveryRevisionId(quote, quoteId),
    portalKey: portal.portalKey,
    portalIssuedAtISO: portal.portalIssuedAtISO,
    portalExpiresAtISO: portal.portalExpiresAtISO,
    currency: "usd"
  });
}

function deriveFinalBalanceRequestApprovalScope({
  quote,
  quoteId,
  organizationId,
  portalSnapshot,
  nowISO,
  allowSettled = false,
  allowExpiredPortal = false,
  reuseCurrentCheckoutGeneration = false
} = {}) {
  const status = normalizeText(quote?.status).toLowerCase();
  const contractNumber = normalizeText(quote?.booking?.contractNumber);
  const contractConvertedAtISO = normalizeText(quote?.booking?.contractConvertedAtISO);
  if (status !== "booked" || !contractNumber || !contractConvertedAtISO) {
    throw new functions.https.HttpsError(
      "failed-precondition",
      "Final-balance requests require a booked quote with an authoritative contract."
    );
  }
  if (!isValidEmail(quote?.customer?.email)) {
    throw new functions.https.HttpsError(
      "failed-precondition",
      "Quote customer email is missing."
    );
  }
  const ledgerProjection = projectQuotePaymentLedger(quote);
  const finalBalance = normalizeFinalBalanceCheckoutPayment(quote?.payment);
  const finalSettled = finalBalance.depositStatus === "paid"
    || Boolean(finalBalance.depositConfirmedAtISO)
    || ledgerProjection.byKind.finalBalance.state === "paid";
  if (finalSettled && !allowSettled) {
    throw new functions.https.HttpsError(
      "failed-precondition",
      "Paid final-balance evidence cannot receive another payment request."
    );
  }
  if (!finalSettled && !reuseCurrentCheckoutGeneration) {
    planDepositCheckout(finalBalance);
  }
  if (finalBalance.depositLink) {
    parseStoredPaymentLinkOrThrow(finalBalance.depositLink);
  }
  const portal = assertQuoteDeliveryPortalActivation({
    quote,
    quoteId,
    organizationId,
    portalSnapshot,
    nowISO,
    allowExpired: allowExpiredPortal
  });
  return buildFinalBalanceApprovalScope({
    quote,
    quoteId,
    organizationId,
    quoteRevisionId: portal.revisionId || resolveQuoteDeliveryRevisionId(quote, quoteId),
    portalKey: portal.portalKey,
    portalIssuedAtISO: portal.portalIssuedAtISO,
    portalExpiresAtISO: portal.portalExpiresAtISO,
    currency: "usd",
    reuseCurrentCheckoutGeneration
  });
}

function deriveApprovedPaymentRequestScope(options = {}, paymentKind = "deposit") {
  return paymentKind === "final_balance"
    ? deriveFinalBalanceRequestApprovalScope(options)
    : derivePaymentRequestApprovalScope(options);
}

function assertMatchingApprovalExecutionRecord(record, {
  organizationId,
  quoteId,
  approvalRequestId,
  action
} = {}) {
  if (
    normalizeOrganizationId(record?.organizationId) !== normalizeOrganizationId(organizationId)
    || normalizeText(record?.quoteId) !== normalizeText(quoteId)
    || normalizeApprovalExecutionId(record?.approvalRequestId) !== normalizeApprovalExecutionId(approvalRequestId)
    || normalizeText(record?.action) !== normalizeText(action)
  ) {
    throw new functions.https.HttpsError(
      "failed-precondition",
      "Approval execution audit identity does not match this action."
    );
  }
}

function sanitizePaymentRequestExecutionResult(result = {}) {
  const source = result && typeof result === "object" ? result : {};
  const emailResult = source.email && typeof source.email === "object"
    ? source.email
    : {};
  const approvalRequest = source.approvalRequest && typeof source.approvalRequest === "object"
    ? source.approvalRequest
    : null;
  const paymentKind = normalizeText(source.paymentKind).toLowerCase();
  const amountCents = Number(source.amountCents);
  return {
    quoteNumber: normalizeText(source.quoteNumber),
    email: {
      sent: emailResult.sent === true,
      provider: normalizeText(emailResult.provider),
      messageId: normalizeText(emailResult.messageId)
    },
    ...(approvalRequest ? { approvalRequest } : {}),
    stripeSessionId: normalizeText(source.stripeSessionId),
    checkoutGeneration: Number(source.checkoutGeneration || 0),
    published: source.published === true,
    ...(paymentKind === "final_balance" && Number.isSafeInteger(amountCents) && amountCents > 0
      ? { paymentKind, amountCents }
      : {})
  };
}

function paymentRequestEmailIdempotencyKey({ organizationId, quoteId, approvalRequestId }) {
  return `quote-approval/${normalizeOrganizationId(organizationId)}/${normalizeText(quoteId)}/${normalizeApprovalExecutionId(approvalRequestId)}`;
}

async function claimPaymentDispatchAttempt({
  executionRef,
  organizationId,
  quoteId,
  approvalRequestId,
  staff,
  actionScopeDigest,
  idempotencyKey,
  action = "send_payment_request"
}) {
  const attemptedAtISO = new Date().toISOString();
  return db.runTransaction(async (tx) => {
    const executionSnap = await tx.get(executionRef);
    if (!executionSnap.exists) {
      throw new ApprovalWorkflowError(
        "failed-precondition",
        "Payment-request execution disappeared before email dispatch."
      );
    }
    const execution = executionSnap.data() || {};
    assertMatchingApprovalExecutionRecord(execution, {
      organizationId,
      quoteId,
      approvalRequestId,
      action
    });
    if (normalizeText(execution.state).toLowerCase() !== "in_progress") {
      throw new ApprovalWorkflowError(
        "failed-precondition",
        "Payment-request execution is no longer in progress."
      );
    }
    const identity = {
      operationId: approvalRequestId,
      actorUid: staff.uid,
      actionScopeDigest,
      idempotencyKey
    };
    const existingDispatch = execution.paymentDispatch || null;
    if (existingDispatch) {
      const resume = planPaymentDispatchResume({
        executionState: execution.state,
        dispatch: existingDispatch,
        ...identity
      });
      if (resume.action === "complete_publication") {
        return {
          action: resume.action,
          dispatch: normalizePaymentDispatch(existingDispatch)
        };
      }
      if (resume.action === "expired_portal_recovery_in_progress") {
        throw new PaymentDispatchStateError(
          "aborted",
          "Expired-portal payment recovery is already in progress."
        );
      }
      if (resume.action !== "retry_provider_with_same_key") {
        throw new PaymentDispatchStateError(
          "failed-precondition",
          "This payment email dispatch requires a new approval."
        );
      }
    }
    const dispatch = beginPaymentDispatchAttempt({
      dispatch: existingDispatch,
      ...identity,
      nowISO: attemptedAtISO
    });
    tx.set(executionRef, {
      paymentDispatch: dispatch,
      lastAttemptedBy: {
        uid: staff.uid,
        email: staff.email
      },
      updatedAtISO: attemptedAtISO,
      updatedAt: FieldValue.serverTimestamp()
    }, { merge: true });
    return { action: "send_provider", dispatch };
  });
}

async function recordPaymentDispatchAcceptance({
  executionRef,
  organizationId,
  quoteId,
  approvalRequestId,
  staff,
  provider,
  providerMessageId,
  action = "send_payment_request"
}) {
  const acceptedAtISO = new Date().toISOString();
  return db.runTransaction(async (tx) => {
    const executionSnap = await tx.get(executionRef);
    if (!executionSnap.exists) {
      throw new ApprovalWorkflowError(
        "failed-precondition",
        "Payment-request execution disappeared after provider acceptance."
      );
    }
    const execution = executionSnap.data() || {};
    assertMatchingApprovalExecutionRecord(execution, {
      organizationId,
      quoteId,
      approvalRequestId,
      action
    });
    const currentDispatch = normalizePaymentDispatch(execution.paymentDispatch);
    if (currentDispatch.state === "provider_accepted") {
      if (
        currentDispatch.provider !== normalizeText(provider).toLowerCase()
        || currentDispatch.providerMessageId !== normalizeProviderMessageId(providerMessageId)
      ) {
        throw new PaymentDispatchStateError(
          "aborted",
          "Payment provider acceptance evidence changed during retry."
        );
      }
      return currentDispatch;
    }
    const accepted = recordPaymentDispatchProviderAcceptance({
      dispatch: currentDispatch,
      provider,
      providerMessageId,
      nowISO: acceptedAtISO
    });
    tx.set(executionRef, {
      paymentDispatch: accepted.dispatch,
      providerAcceptedByAttempt: {
        uid: staff.uid,
        email: staff.email
      },
      updatedAtISO: acceptedAtISO,
      updatedAt: FieldValue.serverTimestamp()
    }, { merge: true });
    return accepted.dispatch;
  });
}

async function recordPaymentDispatchFailure({
  executionRef,
  organizationId,
  quoteId,
  approvalRequestId,
  error,
  action = "send_payment_request"
}) {
  const observedAtISO = new Date().toISOString();
  return db.runTransaction(async (tx) => {
    const executionSnap = await tx.get(executionRef);
    if (!executionSnap.exists) return null;
    const execution = executionSnap.data() || {};
    assertMatchingApprovalExecutionRecord(execution, {
      organizationId,
      quoteId,
      approvalRequestId,
      action
    });
    if (normalizeText(execution.state).toLowerCase() !== "in_progress") return null;
    const dispatch = normalizePaymentDispatch(execution.paymentDispatch);
    if (dispatch.state === "provider_accepted") {
      return {
        outcome: "provider_accepted",
        executionState: "in_progress",
        dispatch,
        shouldNeutralizeCheckout: false
      };
    }
    const plan = planPaymentDispatchFailure({
      dispatch,
      error,
      nowISO: observedAtISO
    });
    tx.set(executionRef, {
      paymentDispatch: plan.dispatch,
      error: plan.outcome === "ambiguous"
        ? "Payment email outcome is uncertain; retry the same approved request."
        : "Payment request email could not be sent.",
      updatedAtISO: observedAtISO,
      updatedAt: FieldValue.serverTimestamp()
    }, { merge: true });
    return plan;
  });
}

async function claimExpiredPortalPaymentDispatchRecovery({
  executionRef,
  organizationId,
  quoteId,
  approvalRequestId,
  staff,
  action = "send_payment_request"
} = {}) {
  const claimedAtISO = new Date().toISOString();
  return db.runTransaction(async (tx) => {
    const executionSnap = await tx.get(executionRef);
    if (!executionSnap.exists) {
      throw new ApprovalWorkflowError(
        "failed-precondition",
        "Expired-portal payment execution disappeared before recovery."
      );
    }
    const execution = executionSnap.data() || {};
    assertMatchingApprovalExecutionRecord(execution, {
      organizationId,
      quoteId,
      approvalRequestId,
      action
    });
    if (
      normalizeText(execution.state).toLowerCase() !== "in_progress"
      || normalizeText(execution.executedBy?.uid) !== normalizeText(staff?.uid)
    ) {
      throw new ApprovalWorkflowError(
        "aborted",
        "Expired-portal payment recovery no longer owns the in-progress execution."
      );
    }
    const plan = planExpiredPortalPaymentDispatchRecovery({
      dispatch: execution.paymentDispatch,
      nowISO: claimedAtISO,
      staleAfterMs: PAYMENT_DISPATCH_RECOVERY_STALE_MS
    });
    if (plan.changed) {
      tx.set(executionRef, {
        paymentDispatch: plan.dispatch,
        error: "Portal expired after a stale email-provider attempt; provider outcome remains unknown while checkout recovery runs.",
        updatedAtISO: claimedAtISO,
        updatedAt: FieldValue.serverTimestamp()
      }, { merge: true });
    }
    return plan;
  });
}

async function readQuoteOrThrow(quoteId, { organizationId = "" } = {}) {
  const id = normalizeText(quoteId);
  if (!id) {
    throw new functions.https.HttpsError("invalid-argument", "quoteId is required.");
  }

  const scopedOrganizationId = normalizeOrganizationId(organizationId);
  if (!scopedOrganizationId) {
    throw new functions.https.HttpsError("invalid-argument", "organizationId is required.");
  }

  const quoteRef = getQuoteDocRef(id, scopedOrganizationId);
  const quoteSnap = await quoteRef.get();
  if (!quoteSnap.exists) {
    throw new functions.https.HttpsError("not-found", "Quote not found.");
  }
  const quote = quoteSnap.data() || {};
  const quoteOrganizationId = normalizeOrganizationId(quote.organizationId || scopedOrganizationId);
  if (quoteOrganizationId !== scopedOrganizationId) {
    throw new functions.https.HttpsError("permission-denied", "Quote is outside your organization.");
  }

  return {
    quoteId: id,
    quote,
    quoteRef,
    organizationId: quoteOrganizationId,
    quoteNumber: normalizeText(quote.quoteNumber) || id
  };
}

async function deletePortalSnapshotsForQuote({
  quoteId = "",
  organizationId = "",
  fallbackPortalKey = ""
} = {}) {
  const normalizedQuoteId = normalizeText(quoteId);
  const normalizedOrganizationId = normalizeOrganizationId(organizationId);
  if (!normalizedQuoteId || !normalizedOrganizationId) {
    throw new functions.https.HttpsError(
      "invalid-argument",
      "quoteId and organizationId are required for portal cleanup."
    );
  }

  const portalSnap = await db
    .collection(PORTAL_COLLECTION)
    .where("quoteId", "==", normalizedQuoteId)
    .get();
  const candidateRefs = new Map(
    portalSnap.docs.map((docSnap) => [docSnap.id, docSnap.ref])
  );
  const fallbackKey = normalizeText(fallbackPortalKey);
  if (fallbackKey && !candidateRefs.has(fallbackKey)) {
    candidateRefs.set(fallbackKey, db.collection(PORTAL_COLLECTION).doc(fallbackKey));
  }

  if (!candidateRefs.size) {
    return { deleted: 0, keys: [] };
  }

  const deletedKeys = await db.runTransaction(async (transaction) => {
    const snapshots = await Promise.all(
      Array.from(candidateRefs.values()).map((ref) => transaction.get(ref))
    );
    const keys = [];
    snapshots.forEach((docSnap) => {
      if (!docSnap.exists) return;
      const data = docSnap.data() || {};
      const portalQuoteId = normalizeText(data.quoteId);
      const portalOrganizationId = normalizeOrganizationId(data.organizationId);
      const exactOrganizationMatch = (
        portalQuoteId === normalizedQuoteId
        && portalOrganizationId === normalizedOrganizationId
      );
      const provenLegacyFallback = (
        docSnap.id === fallbackKey
        && portalQuoteId === normalizedQuoteId
        && !portalOrganizationId
      );
      if (
        !exactOrganizationMatch
        && !provenLegacyFallback
      ) {
        return;
      }
      transaction.delete(docSnap.ref);
      keys.push(docSnap.id);
    });
    return keys;
  });

  return {
    deleted: deletedKeys.length,
    keys: deletedKeys
  };
}

function resolvePortalLink(quote) {
  const portalKey = normalizeText(quote?.portalKey);
  if (!portalKey) return "";
  const appBaseUrl = parseUrlOrThrow(
    readConfig("app.base_url", "https://quotepilot.mbmapps.com/app"),
    "app.base_url"
  );
  const portalUrl = new URL(appBaseUrl);
  portalUrl.searchParams.set("portal", portalKey);
  return portalUrl.toString();
}

function assertQuoteDeliveryPortal({
  quote,
  quoteId,
  organizationId,
  portalSnapshot,
  nowISO
} = {}) {
  const portal = assertQuoteDeliveryPortalSnapshot({
    quote,
    quoteId,
    organizationId,
    portalSnapshot,
    nowISO
  });
  return {
    ...portal,
    portalLink: resolvePortalLink(quote)
  };
}

function buildQuoteDeliveryEmailPayload({ quote, quoteId, portalLink } = {}) {
  const customerEmail = normalizeEmail(quote?.customer?.email);
  if (!customerEmail) {
    throw new QuoteDeliveryError("failed-precondition", "Quote customer email is missing.");
  }
  if (!normalizeText(portalLink)) {
    throw new QuoteDeliveryError(
      "failed-precondition",
      "Customer portal URL is unavailable. Configure the application URL before sending."
    );
  }
  const quoteNumber = normalizeText(quote?.quoteNumber) || normalizeText(quoteId);
  const customerName = normalizeText(quote?.customer?.name) || "there";
  const eventName = normalizeText(quote?.event?.name) || "your event";
  const eventDate = normalizeText(quote?.event?.date) || "your event date";
  const venue = normalizeText(quote?.event?.venue) || "your venue";
  const total = currencyLabel(quote?.totals?.total);
  const deposit = currencyLabel(quote?.totals?.deposit);
  const storedPaymentLink = normalizeText(quote?.payment?.depositLink);
  const paymentLink = storedPaymentLink
    ? parseStoredPaymentLinkOrThrow(storedPaymentLink)
    : "";
  const brandName = normalizeText(
    quote?.quoteMeta?.brandName || quote?.quoteMeta?.organizationName
  );
  const bookedPortalRenewal = normalizeText(quote?.status).toLowerCase() === "booked";
  if (bookedPortalRenewal) {
    const contractNumber = normalizeText(quote?.booking?.contractNumber);
    const depositPaid = normalizeText(quote?.payment?.depositStatus).toLowerCase() === "paid"
      && normalizeText(quote?.payment?.depositConfirmedAtISO);
    if (!contractNumber || !depositPaid) {
      throw new QuoteDeliveryError(
        "failed-precondition",
        "Booked portal delivery requires an authoritative contract and provider-paid deposit."
      );
    }
    const renewalLines = [
      `Hi ${customerName},`,
      "",
      `Your secure portal access has been renewed for contract ${contractNumber}.`,
      `Your event remains booked for ${eventName} on ${eventDate} at ${venue}.`,
      `Contract total: ${total}.`,
      `Deposit received: ${deposit}.`,
      `Review your booked contract and payment status: ${portalLink}`,
      "",
      "Thank you."
    ];
    return {
      toEmail: customerEmail,
      subject: `${brandName ? `${brandName} ` : ""}Contract ${contractNumber} - portal access renewed`,
      text: renewalLines.join("\n"),
      html: `
        <p>Hi ${escapeHtml(customerName)},</p>
        <p>Your secure portal access has been renewed for contract <strong>${escapeHtml(contractNumber)}</strong>.</p>
        <p>Your event remains booked for <strong>${escapeHtml(eventName)}</strong> on <strong>${escapeHtml(eventDate)}</strong> at <strong>${escapeHtml(venue)}</strong>.</p>
        <p>Contract total: <strong>${escapeHtml(total)}</strong><br/>Deposit received: <strong>${escapeHtml(deposit)}</strong></p>
        <p><a href="${escapeHtml(portalLink)}">Review your booked contract and payment status</a></p>
        <p>Thank you.</p>
      `,
      quoteNumber
    };
  }
  const lines = [
    `Hi ${customerName},`,
    "",
    `Your quote ${quoteNumber} is ready for ${eventName} on ${eventDate} at ${venue}.`,
    `Estimated total: ${total}.`,
    `Deposit due: ${deposit}.`,
    `Review and accept your quote: ${portalLink}`,
    paymentLink ? `Deposit payment link: ${paymentLink}` : "Reply if you need a deposit payment link.",
    "",
    "Thank you."
  ];
  return {
    toEmail: customerEmail,
    subject: `${brandName ? `${brandName} ` : ""}Quote ${quoteNumber} - ${eventDate}`,
    text: lines.join("\n"),
    html: `
      <p>Hi ${escapeHtml(customerName)},</p>
      <p>Your quote <strong>${escapeHtml(quoteNumber)}</strong> is ready for <strong>${escapeHtml(eventName)}</strong> on <strong>${escapeHtml(eventDate)}</strong> at <strong>${escapeHtml(venue)}</strong>.</p>
      <p>Estimated total: <strong>${escapeHtml(total)}</strong><br/>Deposit due: <strong>${escapeHtml(deposit)}</strong></p>
      <p><a href="${escapeHtml(portalLink)}">Review and accept your quote</a></p>
      ${paymentLink ? `<p><a href="${escapeHtml(paymentLink)}">Open deposit payment link</a></p>` : ""}
      <p>Thank you.</p>
    `,
    quoteNumber
  };
}

function annotateQuoteDeliveryAttemptError(error, {
  outcome = "",
  reason = "",
  providerHttpStatus = 0
} = {}) {
  const annotated = error instanceof Error
    ? error
    : new Error(normalizeText(error) || "Email provider request failed.");
  if (normalizeText(outcome)) {
    annotated.quoteDeliveryOutcome = normalizeText(outcome).toLowerCase();
  }
  if (normalizeText(reason)) {
    annotated.quoteDeliveryReason = normalizeText(reason).toLowerCase();
  }
  const status = Number(providerHttpStatus);
  if (Number.isInteger(status) && status >= 100 && status <= 599) {
    annotated.providerHttpStatus = status;
  }
  return annotated;
}

async function sendEmailViaResend({
  apiKey,
  from,
  to,
  subject,
  text,
  html = "",
  idempotencyKey = ""
}) {
  const normalizedIdempotencyKey = normalizeText(idempotencyKey).slice(0, 256);
  let response;
  try {
    response = await fetch("https://api.resend.com/emails", {
      method: "POST",
      headers: {
        Authorization: `Bearer ${apiKey}`,
        "Content-Type": "application/json",
        ...(normalizedIdempotencyKey ? { "Idempotency-Key": normalizedIdempotencyKey } : {})
      },
      body: JSON.stringify({
        from,
        to: [to],
        subject,
        text,
        html: html || undefined
      })
    });
  } catch (error) {
    throw annotateQuoteDeliveryAttemptError(error, {
      outcome: "ambiguous",
      reason: "provider_network_error"
    });
  }

  let payload = null;
  try {
    payload = await response.json();
  } catch {
    payload = null;
  }

  if (!response.ok) {
    const message = normalizeText(payload?.message || payload?.error || response.statusText || "Email provider error.");
    throw annotateQuoteDeliveryAttemptError(new Error(message), {
      reason: `provider_http_${response.status}`,
      providerHttpStatus: response.status
    });
  }

  const id = normalizeProviderMessageId(payload?.id);
  if (!id) {
    throw annotateQuoteDeliveryAttemptError(
      new Error("Email provider response did not include a message identifier."),
      {
        outcome: "ambiguous",
        reason: "provider_2xx_missing_message_id",
        providerHttpStatus: response.status
      }
    );
  }
  return {
    id
  };
}

async function sendCustomerEmail({
  toEmail,
  subject,
  text,
  html = "",
  idempotencyKey = ""
}) {
  const emailConfig = getEmailConfig();
  if (emailConfig.provider === "none") {
    throw new functions.https.HttpsError(
      "failed-precondition",
      "Email provider is disabled. Configure NOTIFICATIONS_EMAIL_PROVIDER and the approved sender configuration."
    );
  }
  if (!EMAIL_PROVIDERS.has(emailConfig.provider)) {
    throw new functions.https.HttpsError(
      "failed-precondition",
      `Unsupported email provider: ${emailConfig.provider}.`
    );
  }
  if (!emailConfig.fromEmail) {
    throw new functions.https.HttpsError("failed-precondition", "Missing EMAIL_FROM_EMAIL configuration.");
  }
  if (!emailConfig.senderApproved) {
    throw new functions.https.HttpsError(
      "failed-precondition",
      `Email sender must be ${APPROVED_EMAIL_FROM_NAME} <${APPROVED_EMAIL_FROM_EMAIL}>.`
    );
  }

  const to = normalizeEmail(toEmail);
  if (!to) {
    throw new functions.https.HttpsError("invalid-argument", "Customer email is required.");
  }

  const from = emailConfig.fromName
    ? `${emailConfig.fromName} <${emailConfig.fromEmail}>`
    : emailConfig.fromEmail;

  try {
    if (emailConfig.provider === "resend") {
      if (!emailConfig.resendApiKey) {
        throw new functions.https.HttpsError("failed-precondition", "Missing RESEND_API_KEY configuration.");
      }
      const result = await sendEmailViaResend({
        apiKey: emailConfig.resendApiKey,
        from,
        to,
        subject: normalizeText(subject),
        text: normalizeText(text),
        html,
        idempotencyKey
      });
      if (!normalizeProviderMessageId(result.id)) {
        throw annotateQuoteDeliveryAttemptError(
          new Error("Email provider response did not include a message identifier."),
          {
            outcome: "ambiguous",
            reason: "provider_2xx_missing_message_id"
          }
        );
      }
      return {
        sent: true,
        provider: "resend",
        messageId: result.id
      };
    }
  } catch (error) {
    if (error instanceof functions.https.HttpsError) {
      throw error;
    }
    functions.logger.error("Customer email send failed", {
      provider: emailConfig.provider,
      operation: "transactional_email",
      errorCode: normalizeText(
        error?.code || error?.name || "email_send_failed"
      ).slice(0, 80)
    });
    const classification = classifyQuoteDeliveryAttemptError(error);
    const publicError = new functions.https.HttpsError(
      "internal",
      normalizeText(error?.message || "Failed to send email.")
    );
    publicError.quoteDeliveryOutcome = classification.outcome;
    publicError.quoteDeliveryReason = classification.reason;
    publicError.providerHttpStatus = classification.providerHttpStatus;
    throw publicError;
  }

  throw new functions.https.HttpsError("failed-precondition", "No supported email provider is configured.");
}

function provisioningCompletionStatus({ email = {}, claimsSync = {}, sendEmail = false } = {}) {
  if (email.sent) {
    return claimsSync.succeeded ? "completed" : "completed_claims_sync_failed";
  }
  if (email.dispatchState === "sending") return "provisioning_email_sending";
  if (sendEmail) {
    return claimsSync.succeeded
      ? "provisioned_email_failed"
      : "provisioned_email_and_claims_failed";
  }
  return claimsSync.succeeded ? "completed" : "completed_claims_sync_failed";
}

async function acquireProvisioningEmailDispatchLease({ orderRef, orderId }) {
  const attemptId = randomUUID();
  const startedAtISO = new Date().toISOString();
  const leaseExpiresAtISO = new Date(Date.now() + PROVISIONING_EMAIL_LEASE_MS).toISOString();
  return db.runTransaction(async (tx) => {
    const orderSnap = await tx.get(orderRef);
    if (!orderSnap.exists) {
      throw new functions.https.HttpsError(
        "failed-precondition",
        "Provisioning order disappeared before email dispatch."
      );
    }
    const currentEmail = orderSnap.data()?.email || {};
    if (currentEmail.sent) {
      return {
        state: "sent",
        email: currentEmail,
        attemptId: normalizeText(currentEmail.dispatchAttemptId)
      };
    }
    const currentLeaseExpiresAtMs = Date.parse(normalizeText(currentEmail.dispatchLeaseExpiresAtISO));
    if (
      currentEmail.dispatchState === "sending"
      && Number.isFinite(currentLeaseExpiresAtMs)
      && currentLeaseExpiresAtMs > Date.now()
    ) {
      return {
        state: "in_progress",
        email: currentEmail,
        attemptId: normalizeText(currentEmail.dispatchAttemptId)
      };
    }

    const leasedEmail = {
      ...currentEmail,
      sent: false,
      reason: "send_pending",
      auditPersisted: true,
      dispatchState: "sending",
      dispatchAttemptId: attemptId,
      dispatchStartedAtISO: startedAtISO,
      dispatchLeaseExpiresAtISO: leaseExpiresAtISO,
      idempotencyKey: `customer-onboarding/${orderId}`
    };
    tx.set(orderRef, {
      status: "provisioning_email_sending",
      email: leasedEmail,
      updatedAtISO: startedAtISO,
      updatedAt: FieldValue.serverTimestamp()
    }, { merge: true });
    return {
      state: "acquired",
      email: leasedEmail,
      attemptId
    };
  });
}

function assertProvisioningFinalizationPersisted(finalized) {
  if (finalized?.emailResult?.auditPersisted !== true) {
    throw new functions.https.HttpsError(
      "aborted",
      "Provisioning may have reached the email provider, but its canonical order audit is incomplete. Retry the exact order before handoff."
    );
  }
  if (
    finalized?.emailResult?.dispatchState === "sending"
    || finalized?.emailResult?.reason === "email_dispatch_in_progress"
  ) {
    throw new functions.https.HttpsError(
      "aborted",
      "Onboarding email dispatch is already in progress. Retry the exact order after the current dispatch lease finishes."
    );
  }
}

async function finalizeProvisioningOrder({
  orderRef,
  orderId,
  organizationId,
  organizationName,
  ownerEmail,
  ownerName,
  ownerUid,
  appUrl,
  supportEmail,
  entitlements,
  sendEmail,
  existingEmail = null,
  requiresVerifiedSignIn = false
}) {
  let claimsSync = {
    required: Boolean(ownerUid),
    succeeded: !ownerUid
  };
  if (ownerUid) {
    try {
      await syncPrincipalClaims({
        uid: ownerUid,
        role: "admin",
        organizationId,
        rejectOrganizationReassignment: true,
        platformAdmin: isPlatformAdminEmail(ownerEmail)
      });
      claimsSync = {
        required: true,
        succeeded: true
      };
    } catch (error) {
      const errorMessage = normalizeText(error?.message || "Owner claims synchronization failed.");
      claimsSync = {
        required: true,
        succeeded: false,
        error: errorMessage
      };
      functions.logger.error("Provisioned owner claims synchronization failed", {
        organizationId,
        orderId,
        ownerUid,
        error: errorMessage
      });
    }
  }

  const emailPayload = buildProvisioningEmailPayload({
    ownerName,
    ownerEmail,
    organizationName,
    organizationId,
    appUrl,
    paidFeatureIds: entitlements.paidFeatureIds,
    unpaidFeatureIds: entitlements.unpaidFeatureIds,
    supportEmail,
    orderId,
    ownerUid,
    requiresVerifiedSignIn
  });

  let dispatchLease = null;
  let emailResult = existingEmail?.sent
    ? { ...existingEmail }
    : {
      sent: false,
      reason: sendEmail ? "send_pending" : "send_email_disabled",
      dispatchState: sendEmail ? "pending" : "not_requested"
    };

  if (sendEmail && claimsSync.succeeded && !emailResult.sent) {
    dispatchLease = await acquireProvisioningEmailDispatchLease({
      orderRef,
      orderId
    });
    if (dispatchLease.state === "sent") {
      emailResult = { ...dispatchLease.email };
    } else if (dispatchLease.state === "in_progress") {
      emailResult = {
        ...dispatchLease.email,
        sent: false,
        reason: "email_dispatch_in_progress"
      };
    } else {
      try {
        emailResult = {
          ...await sendCustomerEmail({
            toEmail: ownerEmail,
            subject: emailPayload.subject,
            text: emailPayload.text,
            html: emailPayload.html,
            idempotencyKey: `customer-onboarding/${orderId}`
          }),
          dispatchState: "sent",
          dispatchAttemptId: dispatchLease.attemptId
        };
      } catch (error) {
        emailResult = {
          sent: false,
          reason: "send_failed",
          dispatchState: "failed",
          dispatchAttemptId: dispatchLease.attemptId,
          error: normalizeText(error?.message || "Failed to send onboarding email.")
        };
      }
    }
  } else if (sendEmail && !claimsSync.succeeded && !emailResult.sent) {
    emailResult = {
      sent: false,
      reason: "owner_claims_not_ready",
      dispatchState: "blocked",
      error: "Onboarding email was withheld because owner access claims are not ready."
    };
  }

  const completedAtISO = new Date().toISOString();
  const existingSentAtISO = normalizeText(existingEmail?.sentAtISO);
  const existingFailedAtISO = normalizeText(existingEmail?.failedAtISO);
  const existingCompletedAtISO = normalizeText(existingEmail?.completedAtISO);
  const failedAtISO = dispatchLease?.state === "acquired"
    ? completedAtISO
    : existingFailedAtISO || completedAtISO;
  const persistedEmail = {
    ...(dispatchLease?.email || {}),
    ...emailResult,
    auditPersisted: true,
    toEmail: ownerEmail,
    subject: emailPayload.subject,
    ...(emailResult.sent
      ? { sentAtISO: existingSentAtISO || completedAtISO }
      : sendEmail
        ? { failedAtISO }
        : { completedAtISO: existingCompletedAtISO || completedAtISO })
  };

  try {
    const committedEmail = await db.runTransaction(async (tx) => {
      const currentOrderSnap = await tx.get(orderRef);
      if (!currentOrderSnap.exists) {
        throw new functions.https.HttpsError(
          "failed-precondition",
          "Provisioning order disappeared before completion could be audited."
        );
      }
      const currentEmail = currentOrderSnap.data()?.email || {};
      let emailToPersist = currentEmail.sent ? currentEmail : persistedEmail;
      if (
        dispatchLease?.state === "acquired"
        && normalizeText(currentEmail.dispatchAttemptId) !== dispatchLease.attemptId
      ) {
        emailToPersist = currentEmail;
      } else if (dispatchLease?.state === "in_progress") {
        emailToPersist = currentEmail;
      }
      const status = provisioningCompletionStatus({
        email: emailToPersist,
        claimsSync,
        sendEmail
      });
      tx.set(orderRef, {
        status,
        claimsSync,
        email: emailToPersist,
        updatedAtISO: completedAtISO,
        updatedAt: FieldValue.serverTimestamp()
      }, { merge: true });
      return emailToPersist;
    });
    emailResult = {
      ...committedEmail,
      ...(dispatchLease?.state === "in_progress"
        ? { reason: "email_dispatch_in_progress" }
        : {}),
      auditPersisted: true
    };
  } catch (auditError) {
    functions.logger.error("Provisioning completion audit persistence failed", {
      organizationId,
      orderId,
      messageId: emailResult.messageId,
      error: normalizeText(auditError?.message)
    });
    emailResult = {
      ...emailResult,
      auditPersisted: false,
      ...(emailResult.sent
        ? { warning: "Email was accepted by Resend, but its provisioning audit update could not be saved." }
        : {})
    };
  }

  return {
    claimsSync,
    emailResult,
    emailPayload
  };
}

async function sendOwnerSms(message) {
  const smsProvider = getSmsProvider();
  if (smsProvider === "none") {
    return {
      sent: false,
      reason: "sms_disabled"
    };
  }

  if (!SMS_PROVIDERS.has(smsProvider)) {
    return {
      sent: false,
      reason: "sms_provider_unsupported",
      provider: smsProvider
    };
  }

  const twilioConfig = getTwilioConfig();
  const missingFields = listMissingFields([
    { name: "twilio.account_sid", value: twilioConfig.accountSid },
    { name: "twilio.auth_token", value: twilioConfig.authToken },
    { name: "twilio.messaging_service_sid", value: twilioConfig.messagingServiceSid },
    { name: "notifications.owner_phone", value: twilioConfig.toNumber }
  ]);
  if (missingFields.length) {
    return {
      sent: false,
      reason: "sms_not_configured",
      missingFields
    };
  }

  try {
    const client = twilio(twilioConfig.accountSid, twilioConfig.authToken);
    const payload = await client.messages.create({
      messagingServiceSid: twilioConfig.messagingServiceSid,
      to: twilioConfig.toNumber,
      body: normalizeText(message).slice(0, 1500)
    });

    return {
      sent: true,
      sid: payload.sid
    };
  } catch (err) {
    functions.logger.error("Twilio SMS send failed", err);
    return {
      sent: false,
      reason: "sms_send_failed",
      message: normalizeText(err?.message).slice(0, 180)
    };
  }
}

async function patchPaymentState({
  quoteId,
  organizationId = "",
  portalKey = "",
  paymentPatch = {},
  auditContext = {},
  stripeSession = null,
  webhookEvent = null,
  checkoutTransition = null,
  providerObservation = null,
  paymentKind = "deposit"
}) {
  const flow = getPaymentRequestFlow(paymentKind);
  const normalizedQuoteId = normalizeText(quoteId);
  const normalizedOrganizationId = normalizeOrganizationId(organizationId);
  const normalizedPortalKey = normalizeText(portalKey);
  const quoteRef = getQuoteDocRef(normalizedQuoteId, normalizedOrganizationId);
  const portalRef = normalizedPortalKey
    ? db.collection(PORTAL_COLLECTION).doc(normalizedPortalKey)
    : null;
  const webhookEventId = normalizeText(webhookEvent?.eventId);
  if (webhookEvent && !/^[a-zA-Z0-9_:-]+$/.test(webhookEventId)) {
    throw new functions.https.HttpsError(
      "invalid-argument",
      "A valid Stripe webhook event ID is required."
    );
  }
  const webhookRef = webhookEventId
    ? db.collection(WEBHOOK_EVENTS_COLLECTION).doc(`stripe-${webhookEventId}`)
    : null;
  const nowISO = new Date().toISOString();

  try {
    return await db.runTransaction(async (transaction) => {
      const reads = [transaction.get(quoteRef)];
      if (portalRef) reads.push(transaction.get(portalRef));
      if (webhookRef) reads.push(transaction.get(webhookRef));
      const snapshots = await Promise.all(reads);
      const quoteSnap = snapshots[0];
      const portalSnap = portalRef ? snapshots[1] : null;
      const webhookSnap = webhookRef
        ? snapshots[portalRef ? 2 : 1]
        : null;

      if (webhookSnap?.exists) {
        return {
          duplicate: true,
          eventId: webhookEventId
        };
      }
      if (!quoteSnap.exists) {
        throw new functions.https.HttpsError("not-found", "Quote not found.");
      }

      const currentQuote = quoteSnap.data() || {};
      if (
        (
          normalizeText(currentQuote.quoteId)
          && normalizeText(currentQuote.quoteId) !== normalizedQuoteId
        )
        || normalizeOrganizationId(currentQuote.organizationId) !== normalizedOrganizationId
      ) {
        throw new functions.https.HttpsError(
          "failed-precondition",
          "Quote payment identity does not match its organization scope."
        );
      }

      if (portalRef) {
        if (!portalSnap?.exists) {
          throw new functions.https.HttpsError(
            "failed-precondition",
            "The quote portal snapshot is missing."
          );
        }
        assertPaymentPortalIdentity({
          quoteId: normalizedQuoteId,
          organizationId: normalizedOrganizationId,
          portalKey: normalizedPortalKey,
          quote: {
            ...currentQuote,
            quoteId: normalizedQuoteId
          },
          portal: portalSnap.data() || {}
        });
      }
      let effectivePaymentPatch = { ...paymentPatch };
      let providerTransition = null;
      const currentCheckoutPayment = checkoutPaymentForQuote(currentQuote, flow.paymentKind);
      if (stripeSession && providerObservation) {
        validateStripeCheckoutScope({
          session: stripeSession,
          quote: stripeScopeQuoteForPayment(currentQuote, flow.paymentKind),
          quoteId: normalizedQuoteId,
          organizationId: normalizedOrganizationId
        });
        assertStripePaymentKindMetadata(stripeSession, flow.paymentKind);
        providerTransition = planStripeCheckoutTransition({
          currentPayment: currentCheckoutPayment,
          sessionId: normalizeText(stripeSession.id),
          providerState: providerObservation.providerState,
          confirmedAtISO: nowISO
        });
        effectivePaymentPatch = providerTransition.apply
          ? providerTransition.paymentPatch
          : {};
      } else if (stripeSession) {
        validateStripeCheckoutCompletion({
          session: stripeSession,
          quote: stripeScopeQuoteForPayment(currentQuote, flow.paymentKind),
          quoteId: normalizedQuoteId,
          organizationId: normalizedOrganizationId
        });
        assertStripePaymentKindMetadata(stripeSession, flow.paymentKind);
      }
      if (checkoutTransition) {
        const transition = assertCheckoutPaymentTransition({
          currentPayment: currentCheckoutPayment,
          expectedPayment: checkoutTransition.expectedPayment,
          nextPayment: checkoutTransition.nextPayment
        });
        if (transition.alreadyApplied) {
          return {
            duplicate: false,
            alreadyApplied: true,
            eventId: webhookEventId
          };
        }
      }

      const shouldUpdatePayment = Object.keys(effectivePaymentPatch).length > 0;
      const operationId = shouldUpdatePayment && flow.paymentKind === "final_balance"
        ? normalizeApprovalExecutionId(
          projectQuotePaymentLedger(currentQuote).byKind.finalBalance.latestOperationId
        )
        : "";
      if (shouldUpdatePayment) {
        const quoteUpdate = { updatedAtISO: nowISO };
        const audit = {
          ...(normalizeHostname(auditContext.host)
            ? { lastHost: normalizeHostname(auditContext.host) }
            : {}),
          ...(normalizeText(auditContext.eventType)
            ? { lastEventType: normalizeText(auditContext.eventType).toLowerCase() }
            : {}),
          ...(normalizeOrganizationId(auditContext.organizationId)
            ? { lastOrganizationId: normalizeOrganizationId(auditContext.organizationId) }
            : {})
        };
        appendPaymentStateUpdate(quoteUpdate, {
          paymentKind: flow.paymentKind,
          checkoutPayment: {
            ...currentCheckoutPayment,
            ...effectivePaymentPatch
          },
          amountCents: paymentAmountCentsForQuote(currentQuote, flow.paymentKind),
          operationId,
          audit
        });
        if (flow.paymentKind === "final_balance") {
          const ledgerPlan = planFinalBalanceLedgerTransition({
            quote: currentQuote,
            operationId,
            amountCents: paymentAmountCentsForQuote(currentQuote, flow.paymentKind),
            nextState: ledgerStateForProviderState(providerObservation?.providerState),
            providerReference: normalizeText(stripeSession?.id),
            providerSettledAtISO: normalizeText(providerObservation?.providerState).toLowerCase() === "paid"
              ? nowISO
              : ""
          });
          quoteUpdate["payment.ledger"] = ledgerPlan.ledger;
        }
        transaction.update(quoteRef, quoteUpdate);
      }

      if (portalRef && shouldUpdatePayment) {
        const portalUpdate = {
          updatedAtISO: nowISO,
          payment: portalPaymentState({
            paymentKind: flow.paymentKind,
            checkoutPayment: {
              ...currentCheckoutPayment,
              ...effectivePaymentPatch
            },
            amountCents: paymentAmountCentsForQuote(currentQuote, flow.paymentKind),
            operationId,
            audit: {
              ...(normalizeHostname(auditContext.host)
                ? { lastHost: normalizeHostname(auditContext.host) }
                : {}),
              ...(normalizeText(auditContext.eventType)
                ? { lastEventType: normalizeText(auditContext.eventType).toLowerCase() }
                : {}),
              lastOrganizationId: normalizedOrganizationId
            }
          })
        };
        portalUpdate.organizationId = normalizedOrganizationId;
        transaction.set(portalRef, portalUpdate, { merge: true });
      }

      if (webhookRef) {
        transaction.create(webhookRef, {
          provider: "stripe",
          eventId: webhookEventId,
          eventType: normalizeText(webhookEvent?.eventType),
          requestHost: normalizeHostname(webhookEvent?.requestHost),
          requestIp: normalizeText(webhookEvent?.requestIp),
          source: normalizeText(auditContext.source).toLowerCase() || "stripe_webhook",
          organizationId: normalizedOrganizationId,
          quoteId: normalizedQuoteId,
          actorUid: normalizeText(auditContext.actorUid),
          actorEmail: normalizeEmail(auditContext.actorEmail),
          providerEventCreatedAtISO: normalizeText(webhookEvent?.providerEventCreatedAtISO),
          stripeSessionId: normalizeText(stripeSession?.id),
          livemode: stripeSession?.livemode === true,
          providerState: normalizeText(providerObservation?.providerState),
          paymentKind: flow.paymentKind,
          status: shouldUpdatePayment ? "processed" : "ignored",
          result: providerTransition?.reason || "applied",
          processedAtISO: nowISO,
          createdAt: FieldValue.serverTimestamp()
        });
      }

      return {
        duplicate: false,
        alreadyApplied: false,
        applied: shouldUpdatePayment,
        ignored: shouldUpdatePayment ? "" : providerTransition?.reason || "",
        eventId: webhookEventId
      };
    });
  } catch (err) {
    if (err instanceof PaymentSafetyError || err instanceof StripeProviderStateError) {
      throw new functions.https.HttpsError("failed-precondition", err.message);
    }
    throw err;
  }
}

async function neutralizeRejectedStripeCheckout(stripe, sessionId) {
  const normalizedSessionId = normalizeText(sessionId);
  if (!normalizedSessionId) return false;
  const session = await stripe.checkout.sessions.retrieve(normalizedSessionId);
  const status = normalizeText(session.status).toLowerCase();
  const paymentStatus = normalizeText(session.payment_status).toLowerCase();
  if (status === "expired") return true;
  if (status === "open" && paymentStatus !== "paid") {
    await stripe.checkout.sessions.expire(normalizedSessionId);
    return true;
  }
  return false;
}

function annotatePaymentCheckoutOutcome(error, {
  outcome = "ambiguous",
  reason = "provider_outcome_ambiguous"
} = {}) {
  const annotated = error instanceof Error
    ? error
    : new Error(normalizeText(error) || "Stripe checkout outcome is uncertain.");
  annotated.paymentCheckoutOutcome = normalizeText(outcome).toLowerCase() || "ambiguous";
  annotated.paymentCheckoutReason = normalizeText(reason).toLowerCase()
    || "provider_outcome_ambiguous";
  return annotated;
}

function isAmbiguousStripeProviderError(error) {
  const stripeType = normalizeText(error?.type || error?.rawType).toLowerCase();
  const status = Number(error?.statusCode || error?.status || 0);
  return (
    [
      "stripeconnectionerror",
      "stripeapierror",
      "stripeidempotencyerror",
      "striperatelimiterror"
    ].includes(stripeType)
    || [408, 409, 425, 429].includes(status)
    || status >= 500
  );
}

function isDefiniteCheckoutPreparationPersistenceError(error) {
  return (
    error instanceof ApprovalWorkflowError
    || error instanceof PaymentApprovalScopeError
    || error instanceof PaymentSafetyError
    || error instanceof PaymentLedgerError
    || error instanceof StripeProviderStateError
    || (
      error instanceof functions.https.HttpsError
      && [
        "already-exists",
        "failed-precondition",
        "invalid-argument",
        "not-found",
        "permission-denied",
        "unauthenticated"
      ].includes(normalizeText(error.code).toLowerCase())
    )
  );
}

function isDefinitePaymentExecutionClaimError(error) {
  const code = normalizeText(error?.code).toLowerCase();
  const definiteCodes = new Set([
    "already-exists",
    "failed-precondition",
    "invalid-argument",
    "not-found",
    "permission-denied",
    "unauthenticated"
  ]);
  if (code === "aborted" || !definiteCodes.has(code)) return false;
  if (
    error instanceof PaymentApprovalScopeError
    || error instanceof PaymentSafetyError
    || error instanceof PaymentLedgerError
    || error instanceof StripeProviderStateError
    || error instanceof QuoteDeliveryError
  ) {
    return true;
  }
  if (error instanceof ApprovalWorkflowError) {
    return true;
  }
  return error instanceof functions.https.HttpsError;
}

async function advanceCheckoutGenerationIfUnchanged({
  quoteId,
  organizationId,
  expectedPayment,
  checkoutGeneration,
  paymentKind = "deposit",
  operationId = ""
}) {
  const flow = getPaymentRequestFlow(paymentKind);
  const targetGeneration = Number(checkoutGeneration);
  if (!Number.isSafeInteger(targetGeneration) || targetGeneration <= 0) {
    return false;
  }
  const quoteRef = getQuoteDocRef(quoteId, organizationId);
  return db.runTransaction(async (transaction) => {
    const quoteSnap = await transaction.get(quoteRef);
    if (!quoteSnap.exists) return false;
    const currentQuote = quoteSnap.data() || {};
    const currentPayment = checkoutPaymentForQuote(currentQuote, flow.paymentKind);
    const expectedState = normalizeCheckoutTransitionState(expectedPayment);
    if (
      targetGeneration !== expectedState.checkoutGeneration + 1
      || JSON.stringify(currentPayment) !== JSON.stringify(expectedState)
    ) {
      return false;
    }
    const quoteUpdate = {
      updatedAtISO: new Date().toISOString(),
      updatedAt: FieldValue.serverTimestamp()
    };
    if (flow.paymentKind === "final_balance") {
      appendPaymentStateUpdate(quoteUpdate, {
        paymentKind: flow.paymentKind,
        checkoutPayment: {
          ...currentPayment,
          checkoutGeneration: targetGeneration
        },
        amountCents: paymentAmountCentsForQuote(currentQuote, flow.paymentKind),
        operationId
      });
    } else {
      quoteUpdate["payment.checkoutGeneration"] = targetGeneration;
    }
    transaction.update(quoteRef, quoteUpdate);
    return true;
  });
}

async function markPreparedCheckoutExpiredIfUnchanged({
  quoteId,
  organizationId,
  preparedPayment,
  paymentKind = "deposit",
  operationId = ""
}) {
  const flow = getPaymentRequestFlow(paymentKind);
  const quoteRef = getQuoteDocRef(quoteId, organizationId);
  const expectedPrepared = normalizeCheckoutTransitionState(preparedPayment);
  return db.runTransaction(async (transaction) => {
    const quoteSnap = await transaction.get(quoteRef);
    if (!quoteSnap.exists) return false;
    const currentQuote = quoteSnap.data() || {};
    const currentPayment = checkoutPaymentForQuote(currentQuote, flow.paymentKind);
    if (JSON.stringify(currentPayment) !== JSON.stringify(expectedPrepared)) return false;
    const expiredPayment = {
      ...expectedPrepared,
      depositStatus: "unpaid",
      depositLink: "",
      depositConfirmedAtISO: "",
      stripeCheckoutState: "expired"
    };
    const quoteUpdate = {
      updatedAtISO: new Date().toISOString(),
      updatedAt: FieldValue.serverTimestamp()
    };
    appendPaymentStateUpdate(quoteUpdate, {
      paymentKind: flow.paymentKind,
      checkoutPayment: expiredPayment,
      amountCents: paymentAmountCentsForQuote(currentQuote, flow.paymentKind),
      operationId
    });
    if (flow.paymentKind === "final_balance") {
      const ledgerPlan = planFinalBalanceLedgerTransition({
        quote: currentQuote,
        operationId,
        amountCents: paymentAmountCentsForQuote(currentQuote, flow.paymentKind),
        nextState: "expired",
        providerReference: expectedPrepared.stripeSessionId
      });
      quoteUpdate["payment.ledger"] = ledgerPlan.ledger;
    }
    transaction.update(quoteRef, quoteUpdate);
    return true;
  });
}

async function isCheckoutCleanupStateResolved({
  quoteId,
  organizationId,
  preparedPayment,
  paymentKind = "deposit"
}) {
  const flow = getPaymentRequestFlow(paymentKind);
  const quoteSnap = await getQuoteDocRef(quoteId, organizationId).get();
  if (!quoteSnap.exists) return true;
  const expectedPrepared = normalizeCheckoutTransitionState(preparedPayment);
  const current = checkoutPaymentForQuote(quoteSnap.data() || {}, flow.paymentKind);
  if (
    ["paid", "refunded"].includes(current.depositStatus)
    || Boolean(current.depositConfirmedAtISO)
  ) {
    return true;
  }
  if (
    current.stripeSessionId === expectedPrepared.stripeSessionId
    && current.checkoutGeneration === expectedPrepared.checkoutGeneration
  ) {
    return (
      !current.depositLink
      && ["failed", "expired"].includes(current.stripeCheckoutState)
    );
  }
  return (
    current.checkoutGeneration >= expectedPrepared.checkoutGeneration
    && current.stripeSessionId !== expectedPrepared.stripeSessionId
  );
}

async function finalizeProviderAcceptedExpiredCheckout({
  quoteRef,
  executionRef,
  privateDispatchRef,
  quoteId,
  organizationId,
  approvalRequestId,
  staff,
  checkoutPreparation,
  paymentKind = "deposit"
} = {}) {
  const flow = getPaymentRequestFlow(paymentKind);
  const preparation = normalizeApprovedCheckoutPreparation(checkoutPreparation);
  const failedAtISO = new Date().toISOString();
  return db.runTransaction(async (tx) => {
    const [quoteSnap, executionSnap, privateDispatchSnap] = await Promise.all([
      tx.get(quoteRef),
      tx.get(executionRef),
      tx.get(privateDispatchRef)
    ]);
    if (!quoteSnap.exists || !executionSnap.exists) return false;
    const currentQuote = quoteSnap.data() || {};
    const execution = executionSnap.data() || {};
    assertMatchingApprovalExecutionRecord(execution, {
      organizationId,
      quoteId,
      approvalRequestId,
      action: flow.action
    });
    if (normalizeText(execution.state).toLowerCase() !== "in_progress") return false;
    const dispatch = normalizePaymentDispatch(execution.paymentDispatch);
    if (dispatch.state !== "provider_accepted") return false;

    const currentPayment = checkoutPaymentForQuote(currentQuote, flow.paymentKind);
    if (
      currentPayment.stripeSessionId !== preparation.stripeSessionId
      || currentPayment.checkoutGeneration !== preparation.checkoutGeneration
    ) {
      return false;
    }
    if (
      ["paid", "refunded"].includes(currentPayment.depositStatus)
      || currentPayment.depositConfirmedAtISO
    ) {
      throw new PaymentSafetyError(
        "Provider-settled payment evidence cannot be closed as an expired checkout."
      );
    }
    const transition = planStripeCheckoutTransition({
      currentPayment,
      sessionId: preparation.stripeSessionId,
      providerState: "expired",
      confirmedAtISO: failedAtISO
    });
    const expiredPayment = transition.apply
      ? { ...currentPayment, ...transition.paymentPatch }
      : currentPayment;
    if (expiredPayment.stripeCheckoutState !== "expired") return false;

    const portalKey = normalizeText(currentQuote.portalKey);
    const portalRef = portalKey
      ? db.collection(PORTAL_COLLECTION).doc(portalKey)
      : null;
    const portalSnap = portalRef ? await tx.get(portalRef) : null;
    const outcome = buildApprovalExecutionOutcome({
      workflow: currentQuote.workflow,
      requestId: approvalRequestId,
      action: flow.action,
      actorEmail: staff.email,
      nowISO: failedAtISO,
      operationId: approvalRequestId,
      state: "failed",
      error: "Email provider accepted the payment request, but the Stripe checkout expired before completion."
    });
    const quoteUpdate = {
      "workflow.approvalRequests": outcome.approvalRequests,
      updatedAtISO: failedAtISO,
      updatedAt: FieldValue.serverTimestamp()
    };
    appendPaymentStateUpdate(quoteUpdate, {
      paymentKind: flow.paymentKind,
      checkoutPayment: expiredPayment,
      amountCents: paymentAmountCentsForQuote(currentQuote, flow.paymentKind),
      operationId: approvalRequestId,
      audit: {
        lastHost: normalizeHostname(staff.host),
        lastEventType: "checkout.session.expired.provider_accepted_recovery",
        lastOrganizationId: organizationId
      }
    });
    if (flow.paymentKind === "final_balance") {
      const ledgerPlan = planFinalBalanceLedgerTransition({
        quote: currentQuote,
        operationId: approvalRequestId,
        amountCents: paymentAmountCentsForQuote(currentQuote, flow.paymentKind),
        nextState: "expired",
        providerReference: preparation.stripeSessionId
      });
      quoteUpdate["payment.ledger"] = ledgerPlan.ledger;
    }
    tx.update(quoteRef, quoteUpdate);

    if (portalRef && portalSnap?.exists) {
      const portal = portalSnap.data() || {};
      if (
        normalizeText(portal.quoteId) === quoteId
        && normalizeOrganizationId(portal.organizationId) === organizationId
      ) {
        tx.set(portalRef, {
          payment: portalPaymentState({
            paymentKind: flow.paymentKind,
            checkoutPayment: expiredPayment,
            amountCents: paymentAmountCentsForQuote(currentQuote, flow.paymentKind),
            operationId: approvalRequestId,
            audit: {
              lastHost: normalizeHostname(staff.host),
              lastEventType: "checkout.session.expired.provider_accepted_recovery",
              lastOrganizationId: organizationId
            }
          }),
          updatedAtISO: failedAtISO,
          updatedAt: FieldValue.serverTimestamp()
        }, { merge: true });
      }
    }
    tx.set(executionRef, {
      state: "failed",
      result: {
        paymentKind: flow.paymentKind,
        emailProviderAccepted: true,
        checkoutExpired: true,
        stripeSessionId: preparation.stripeSessionId
      },
      checkoutPreparation: {
        ...(execution.checkoutPreparation || {}),
        privateDepositLink: "",
        exposureState: "expired_after_provider_acceptance",
        failedAtISO
      },
      error: "Email provider accepted the payment request, but the Stripe checkout expired before completion.",
      completedAtISO: failedAtISO,
      updatedAtISO: failedAtISO,
      updatedAt: FieldValue.serverTimestamp()
    }, { merge: true });
    if (privateDispatchSnap.exists) {
      tx.set(privateDispatchRef, {
        privateDepositLink: "",
        exposureState: "expired_after_provider_acceptance",
        failedAtISO,
        updatedAtISO: failedAtISO,
        updatedAt: FieldValue.serverTimestamp()
      }, { merge: true });
    }
    return true;
  });
}

async function finalizeExpiredPortalAmbiguousDispatch({
  quoteRef,
  executionRef,
  privateDispatchRef,
  quoteId,
  organizationId,
  approvalRequestId,
  staff,
  checkoutPreparation,
  quote,
  paymentKind = "deposit"
} = {}) {
  const flow = getPaymentRequestFlow(paymentKind);
  const preparation = normalizeApprovedCheckoutPreparation(checkoutPreparation);
  let stripeSession = null;
  let providerObservation = {
    actionable: false,
    providerState: "unknown",
    reviewRequired: true
  };
  let providerResolutionError = "";

  try {
    const stripe = getStripeClient();
    const retrieveSession = async () => stripe.checkout.sessions.retrieve(
      preparation.stripeSessionId,
      { expand: ["payment_intent"] }
    );
    const validateSession = (session) => {
      assertStripeObjectMode({
        expectedMode: getStripeMode(),
        eventLivemode: session?.livemode,
        sessionLivemode: session?.livemode
      });
      validateStripeCheckoutScope({
        session,
        quote: stripeScopeQuoteForPayment(quote, flow.paymentKind, {
          ...preparation.publishedPayment,
          stripeSessionId: preparation.stripeSessionId
        }),
        quoteId,
        organizationId
      });
      assertStripePaymentKindMetadata(session, flow.paymentKind);
    };

    stripeSession = await retrieveSession();
    validateSession(stripeSession);
    providerObservation = mapStripeCheckoutReconciliation(stripeSession);
    if (
      normalizeText(stripeSession?.status).toLowerCase() === "open"
      && normalizeText(stripeSession?.payment_status).toLowerCase() !== "paid"
    ) {
      try {
        await stripe.checkout.sessions.expire(preparation.stripeSessionId);
      } catch (expireError) {
        functions.logger.warn("Expired-portal checkout could not be expired on the first attempt", {
          organizationId,
          quoteId,
          approvalRequestId,
          stripeSessionId: preparation.stripeSessionId,
          error: normalizeText(expireError?.message)
        });
      }
      stripeSession = await retrieveSession();
      validateSession(stripeSession);
      providerObservation = mapStripeCheckoutReconciliation(stripeSession);
    }
  } catch (providerError) {
    providerResolutionError = normalizeText(providerError?.message).slice(0, 500);
    functions.logger.error("Expired-portal ambiguous payment checkout requires reconciliation", {
      organizationId,
      quoteId,
      approvalRequestId,
      stripeSessionId: preparation.stripeSessionId,
      error: providerResolutionError
    });
  }

  const resolvedAtISO = new Date().toISOString();
  return db.runTransaction(async (tx) => {
    const [quoteSnap, executionSnap, privateDispatchSnap] = await Promise.all([
      tx.get(quoteRef),
      tx.get(executionRef),
      tx.get(privateDispatchRef)
    ]);
    if (!quoteSnap.exists || !executionSnap.exists) return null;
    const currentQuote = quoteSnap.data() || {};
    const execution = executionSnap.data() || {};
    assertMatchingApprovalExecutionRecord(execution, {
      organizationId,
      quoteId,
      approvalRequestId,
      action: flow.action
    });
    if (normalizeText(execution.state).toLowerCase() !== "in_progress") return null;
    const dispatch = normalizePaymentDispatch(execution.paymentDispatch);
    if (dispatch.state !== "recovery_claimed") return null;

    const portalKey = normalizeText(currentQuote.portalKey);
    const portalRef = portalKey
      ? db.collection(PORTAL_COLLECTION).doc(portalKey)
      : null;
    const portalSnap = portalRef ? await tx.get(portalRef) : null;

    const currentPayment = checkoutPaymentForQuote(currentQuote, flow.paymentKind);
    if (
      currentPayment.stripeSessionId !== preparation.stripeSessionId
      || currentPayment.checkoutGeneration !== preparation.checkoutGeneration
    ) {
      throw new PaymentSafetyError(
        "Expired-portal recovery no longer matches the active Stripe checkout."
      );
    }

    const providerTruthAlreadySettled = (
      ["paid", "refunded"].includes(currentPayment.depositStatus)
      || Boolean(currentPayment.depositConfirmedAtISO)
    );
    const observedProviderState = normalizeText(
      providerObservation?.providerState
    ).toLowerCase() || "unknown";
    let resolvedCheckoutState = currentPayment.depositStatus === "refunded"
      ? "refunded"
      : providerTruthAlreadySettled
        ? "paid"
        : normalizeText(currentPayment.stripeCheckoutState).toLowerCase() || "unknown";
    let nextPayment = currentPayment;
    let paymentChanged = false;
    if (
      !providerTruthAlreadySettled
      && stripeSession
      && providerObservation?.actionable === true
    ) {
      validateStripeCheckoutScope({
        session: stripeSession,
        quote: stripeScopeQuoteForPayment(currentQuote, flow.paymentKind),
        quoteId,
        organizationId
      });
      assertStripePaymentKindMetadata(stripeSession, flow.paymentKind);
      const transition = planStripeCheckoutTransition({
        currentPayment,
        sessionId: preparation.stripeSessionId,
        providerState: observedProviderState,
        confirmedAtISO: resolvedAtISO
      });
      if (transition.apply) {
        nextPayment = { ...currentPayment, ...transition.paymentPatch };
        paymentChanged = true;
        resolvedCheckoutState = nextPayment.depositStatus === "refunded"
          ? "refunded"
          : normalizeText(nextPayment.stripeCheckoutState).toLowerCase()
            || normalizeText(nextPayment.depositStatus).toLowerCase()
            || "unknown";
      }
    }

    let portalProjectionState = "not_needed";
    if (paymentChanged) {
      if (!portalRef || !portalSnap?.exists) {
        portalProjectionState = "missing";
      } else {
        try {
          assertPaymentPortalIdentity({
            quoteId,
            organizationId,
            portalKey,
            quote: { ...currentQuote, quoteId },
            portal: portalSnap.data() || {}
          });
          portalProjectionState = "ready";
        } catch (portalIdentityError) {
          if (!(portalIdentityError instanceof PaymentSafetyError)) {
            throw portalIdentityError;
          }
          portalProjectionState = "identity_mismatch";
        }
      }
    }
    const checkoutResolved = new Set([
      "paid",
      "refunded",
      "failed",
      "expired"
    ]).has(resolvedCheckoutState);
    const manualReviewRequired = (
      !checkoutResolved
      || (paymentChanged && portalProjectionState !== "ready")
    );
    const failureMessage = manualReviewRequired
      ? "The customer portal expired while the payment email outcome was unknown. Reconcile the recorded Stripe checkout before requesting another payment."
      : `The customer portal expired while the payment email outcome was unknown. Stripe checkout state ${resolvedCheckoutState} ${paymentChanged ? "was recorded" : "was preserved"} and the stale approval was closed.`;
    const outcome = buildApprovalExecutionOutcome({
      workflow: currentQuote.workflow,
      requestId: approvalRequestId,
      action: flow.action,
      actorEmail: staff.email,
      nowISO: resolvedAtISO,
      operationId: approvalRequestId,
      state: "failed",
      error: failureMessage
    });
    const quoteUpdate = {
      "workflow.approvalRequests": outcome.approvalRequests,
      updatedAtISO: resolvedAtISO,
      updatedAt: FieldValue.serverTimestamp()
    };
    if (paymentChanged) {
      appendPaymentStateUpdate(quoteUpdate, {
        paymentKind: flow.paymentKind,
        checkoutPayment: nextPayment,
        amountCents: paymentAmountCentsForQuote(currentQuote, flow.paymentKind),
        operationId: approvalRequestId,
        audit: {
          lastHost: normalizeHostname(staff.host),
          lastEventType: "checkout.session.expired_portal_ambiguous_email_recovery",
          lastOrganizationId: organizationId
        }
      });
      if (flow.paymentKind === "final_balance") {
        const ledgerPlan = planFinalBalanceLedgerTransition({
          quote: currentQuote,
          operationId: approvalRequestId,
          amountCents: paymentAmountCentsForQuote(currentQuote, flow.paymentKind),
          nextState: ledgerStateForProviderState(resolvedCheckoutState),
          providerReference: preparation.stripeSessionId,
          providerSettledAtISO: resolvedCheckoutState === "paid" ? resolvedAtISO : ""
        });
        quoteUpdate["payment.ledger"] = ledgerPlan.ledger;
      }
    }
    tx.update(quoteRef, quoteUpdate);

    if (paymentChanged && portalProjectionState === "ready") {
      tx.set(portalRef, {
        payment: portalPaymentState({
          paymentKind: flow.paymentKind,
          checkoutPayment: nextPayment,
          amountCents: paymentAmountCentsForQuote(currentQuote, flow.paymentKind),
          operationId: approvalRequestId,
          audit: {
            lastHost: normalizeHostname(staff.host),
            lastEventType: "checkout.session.expired_portal_ambiguous_email_recovery",
            lastOrganizationId: organizationId
          }
        }),
        updatedAtISO: resolvedAtISO,
        updatedAt: FieldValue.serverTimestamp()
      }, { merge: true });
    }

    tx.set(executionRef, {
      state: "failed",
      result: {
        paymentKind: flow.paymentKind,
        emailProviderOutcome: "unknown",
        portalExpired: true,
        checkoutProviderState: resolvedCheckoutState,
        checkoutResolved,
        manualReviewRequired,
        portalProjectionState,
        stripeSessionId: preparation.stripeSessionId,
        dispatchStateAtClosure: dispatch.state,
        providerResolutionFailed: Boolean(providerResolutionError)
      },
      checkoutPreparation: {
        ...(execution.checkoutPreparation || {}),
        privateDepositLink: "",
        exposureState: "expired_portal_email_outcome_unknown",
        failedAtISO: resolvedAtISO
      },
      error: failureMessage,
      completedAtISO: resolvedAtISO,
      updatedAtISO: resolvedAtISO,
      updatedAt: FieldValue.serverTimestamp()
    }, { merge: true });
    if (privateDispatchSnap.exists) {
      tx.set(privateDispatchRef, {
        privateDepositLink: "",
        exposureState: "expired_portal_email_outcome_unknown",
        failedAtISO: resolvedAtISO,
        updatedAtISO: resolvedAtISO,
        updatedAt: FieldValue.serverTimestamp()
      }, { merge: true });
    }
    return {
      providerState: resolvedCheckoutState,
      manualReviewRequired
    };
  });
}

async function finalizeUnpreparedPaymentExecutionFailure({
  quoteRef,
  executionRef,
  privateDispatchRef,
  quoteId,
  organizationId,
  approvalRequestId,
  staff,
  paymentKind = "deposit"
} = {}) {
  const flow = getPaymentRequestFlow(paymentKind);
  const failedAtISO = new Date().toISOString();
  const failureMessage = "Stripe checkout preparation was not durably recorded before the operation stopped.";
  return db.runTransaction(async (tx) => {
    const [quoteSnap, executionSnap, privateDispatchSnap] = await Promise.all([
      tx.get(quoteRef),
      tx.get(executionRef),
      tx.get(privateDispatchRef)
    ]);
    if (!quoteSnap.exists || privateDispatchSnap.exists) return false;
    const currentQuote = quoteSnap.data() || {};
    if (
      normalizeOrganizationId(currentQuote.organizationId) !== organizationId
      || (
        normalizeText(currentQuote.quoteId)
        && normalizeText(currentQuote.quoteId) !== quoteId
      )
    ) {
      return false;
    }
    // A missing durable preparation does not prove Stripe was never contacted;
    // it proves only that no checkout URL or email dispatch was recorded here.
    const executionResult = {
      paymentKind: flow.paymentKind,
      checkoutPreparationRecorded: false,
      stripeCheckoutOutcome: "unverified",
      emailProviderContacted: false
    };
    let outcome;
    if (executionSnap.exists) {
      const execution = executionSnap.data() || {};
      assertMatchingApprovalExecutionRecord(execution, {
        organizationId,
        quoteId,
        approvalRequestId,
        action: flow.action
      });
      if (
        normalizeText(execution.state).toLowerCase() !== "in_progress"
        || normalizeText(execution.executedBy?.uid) !== normalizeText(staff?.uid)
        || execution.checkoutPreparation
        || execution.paymentDispatch
      ) {
        return false;
      }
      outcome = buildApprovalExecutionOutcome({
        workflow: currentQuote.workflow,
        requestId: approvalRequestId,
        action: flow.action,
        actorEmail: staff.email,
        nowISO: failedAtISO,
        operationId: approvalRequestId,
        state: "failed",
        error: failureMessage
      });
      tx.set(executionRef, {
        state: "failed",
        result: executionResult,
        error: failureMessage,
        completedAtISO: failedAtISO,
        updatedAtISO: failedAtISO,
        updatedAt: FieldValue.serverTimestamp()
      }, { merge: true });
    } else {
      const approvalRequest = findQuoteApprovalRequest(
        currentQuote.workflow,
        approvalRequestId
      );
      if (
        normalizeText(approvalRequest?.action) !== flow.action
        || normalizeText(approvalRequest?.state).toLowerCase() !== "approved"
        || !["", "awaiting_execution"].includes(
          normalizeText(approvalRequest?.executionState).toLowerCase()
        )
      ) {
        return false;
      }
      const started = buildApprovalExecutionStart({
        workflow: currentQuote.workflow,
        requestId: approvalRequestId,
        action: flow.action,
        actorEmail: staff.email,
        nowISO: failedAtISO,
        operationId: approvalRequestId
      });
      outcome = buildApprovalExecutionOutcome({
        workflow: {
          ...(currentQuote.workflow || {}),
          approvalRequests: started.approvalRequests
        },
        requestId: approvalRequestId,
        action: flow.action,
        actorEmail: staff.email,
        nowISO: failedAtISO,
        operationId: approvalRequestId,
        state: "failed",
        error: failureMessage
      });
      tx.create(executionRef, buildApprovalExecutionAudit({
        organizationId,
        quoteId,
        approvalRequest: outcome.request,
        staff,
        state: "failed",
        startedAtISO: failedAtISO,
        completedAtISO: failedAtISO,
        result: executionResult,
        error: failureMessage
      }));
    }
    tx.update(quoteRef, {
      "workflow.approvalRequests": outcome.approvalRequests,
      updatedAtISO: failedAtISO,
      updatedAt: FieldValue.serverTimestamp()
    });
    return true;
  });
}

exports.resolveTenantByHost = functions.region(REGION).https.onCall(async (data, context) => {
  const hostname = normalizeHostname(data?.hostname || getRequestHostnameFromContext(context));
  const requestIp = getRequestIp(context);
  const tenant = await resolveTenantByHostInternal(hostname, {
    enforceActive: true,
    requestIp
  });
  return {
    ...tenant,
    resolvedAtISO: new Date().toISOString()
  };
});

exports.syncUserClaimsFromRole = functions.region(REGION).https.onCall(async (data, context) => {
  const staff = await assertStaff(context);
  if (staff.role !== "admin") {
    throw new functions.https.HttpsError("permission-denied", "Admin role required.");
  }

  const targetUid = normalizeText(data?.uid || context?.auth?.uid);
  if (!targetUid) {
    throw new functions.https.HttpsError("invalid-argument", "uid is required.");
  }

  const targetRole = await getUserRole(targetUid);
  if (!targetRole.exists) {
    throw new functions.https.HttpsError(
      "not-found",
      "Target user has no authoritative role document."
    );
  }
  if (
    !staff.crossOrgBypass
    && (
      !staff.organizationId
      || !targetRole.organizationId
      || targetRole.organizationId !== staff.organizationId
    )
  ) {
    throw new functions.https.HttpsError("permission-denied", "Target user is outside your organization scope.");
  }

  const targetUser = await auth.getUser(targetUid);
  await syncPrincipalClaims({
    uid: targetUid,
    role: targetRole.role,
    organizationId: targetRole.organizationId,
    platformAdmin: isPlatformAdminEmail(targetUser.email)
  });

  return {
    ok: true,
    uid: targetUid,
    role: targetRole.role,
    organizationId: targetRole.organizationId,
    claimsVersion: CLAIMS_VERSION
  };
});

async function markBuyerAccessClaimsSyncSucceeded({
  buyerAccessOrderId,
  email,
  organizationId,
  uid
} = {}) {
  const normalizedOrderId = normalizeText(buyerAccessOrderId);
  const normalizedUid = normalizeText(uid);
  const normalizedEmail = normalizeEmail(email);
  const normalizedOrganizationId = normalizeOrganizationId(organizationId);
  const claimsUser = await auth.getUser(normalizedUid);
  if (
    claimsUser.disabled === true
    || claimsUser.emailVerified !== true
    || normalizeEmail(claimsUser.email) !== normalizedEmail
  ) {
    throw new functions.https.HttpsError(
      "failed-precondition",
      "The paid buyer identity changed before claims completion."
    );
  }
  const roleRef = db.collection(ROLES_COLLECTION).doc(normalizedUid);
  const orderRef = db.collection(BUYER_ACCESS_ORDERS_COLLECTION).doc(normalizedOrderId);
  await db.runTransaction(async (tx) => {
    const [roleSnap, orderSnap] = await Promise.all([
      tx.get(roleRef),
      tx.get(orderRef)
    ]);
    if (!roleSnap.exists || !orderSnap.exists) {
      throw new functions.https.HttpsError(
        "failed-precondition",
        "The paid buyer role or order is missing during claims completion."
      );
    }
    let recovered;
    try {
      recovered = resolveBuyerAccessBootstrapRecovery({
        authenticatedClaims: claimsUser.customClaims || {},
        buyerAccessOrder: orderSnap.data() || {},
        email: normalizedEmail,
        roleRecord: roleSnap.data() || {},
        uid: normalizedUid
      });
    } catch (err) {
      throwBuyerAccessHttpsError(err);
    }
    if (
      recovered.buyerAccessOrderId !== normalizedOrderId
      || recovered.organizationId !== normalizedOrganizationId
    ) {
      throw new functions.https.HttpsError(
        "failed-precondition",
        "The paid buyer claims completion scope changed."
      );
    }
    tx.set(orderRef, {
      claimsSyncStatus: "succeeded",
      claimsSyncedAtISO: new Date().toISOString(),
      updatedAt: FieldValue.serverTimestamp()
    }, { merge: true });
  });
}

exports.ensureOrganizationBootstrap = functions.region(REGION).https.onCall(async (data, context) => {
  const uid = normalizeText(context?.auth?.uid);
  if (!uid) {
    throw new functions.https.HttpsError("unauthenticated", "Sign in required.");
  }

  const email = normalizeEmail(context?.auth?.token?.email);
  if (!email) {
    throw new functions.https.HttpsError("failed-precondition", "Authenticated account email is required.");
  }
  if (context?.auth?.token?.email_verified !== true) {
    throw new functions.https.HttpsError(
      "failed-precondition",
      "Verify your email address before organization access can be activated."
    );
  }
  const authenticatedUser = await auth.getUser(uid);
  if (
    authenticatedUser.disabled === true
    || authenticatedUser.emailVerified !== true
    || normalizeEmail(authenticatedUser.email) !== email
  ) {
    throw new functions.https.HttpsError(
      "failed-precondition",
      "The authenticated account is not eligible for organization activation."
    );
  }

  const bootstrap = await ensureOrganizationBootstrapInternal({
    uid,
    email,
    authenticatedClaims: authenticatedUser.customClaims || {}
  });

  await syncPrincipalClaims({
    uid,
    role: bootstrap.role,
    organizationId: bootstrap.organizationId,
    rejectOrganizationReassignment: Boolean(bootstrap.buyerAccessOrderId),
    platformAdmin: isPlatformAdminEmail(email)
  });

  if (bootstrap.buyerAccessOrderId) {
    await markBuyerAccessClaimsSyncSucceeded({
      buyerAccessOrderId: bootstrap.buyerAccessOrderId,
      email,
      organizationId: bootstrap.organizationId,
      uid
    });
  }

  return {
    ok: true,
    role: bootstrap.role,
    organizationId: bootstrap.organizationId,
    platformAdmin: isPlatformAdminEmail(email),
    createdOrganization: Boolean(bootstrap.createdOrganization)
  };
});

async function resolveCustomerProvisioningRequest(data, context) {
  const staff = await assertStaff(context);
  if (staff.role !== "admin") {
    throw new functions.https.HttpsError("permission-denied", "Admin role required.");
  }
  const actorEmail = normalizeEmail(staff.email);
  const updateExistingOrganization = data?.updateExistingOrganization === true;
  const ownerEmail = normalizeEmail(data?.ownerEmail);
  if (!updateExistingOrganization && !ownerEmail) {
    throw new functions.https.HttpsError("invalid-argument", "ownerEmail is required.");
  }
  if (!updateExistingOrganization && !isValidEmail(ownerEmail)) {
    throw new functions.https.HttpsError("invalid-argument", "ownerEmail must be a valid email address.");
  }

  const ownerName = normalizeText(data?.ownerName);
  const ownerUid = normalizeText(data?.ownerUid);
  const sendEmail = !updateExistingOrganization && data?.sendEmail === true;
  const configuredAppUrl = updateExistingOrganization
    ? ""
    : parseUrlOrThrow(
      readConfig("app.base_url", "https://quotepilot.mbmapps.com/app"),
      "app.base_url"
    );
  const requestedAppUrl = updateExistingOrganization || !normalizeText(data?.appUrl)
    ? configuredAppUrl
    : parseUrlOrThrow(data.appUrl, "appUrl");
  if (!updateExistingOrganization && requestedAppUrl !== configuredAppUrl) {
    throw new functions.https.HttpsError(
      "invalid-argument",
      "appUrl must match the server-configured QuotePilot application URL."
    );
  }
  const appUrl = configuredAppUrl;
  const supportEmail = updateExistingOrganization
    ? ""
    : normalizeEmail(data?.supportEmail);
  if (supportEmail && !isValidEmail(supportEmail)) {
    throw new functions.https.HttpsError("invalid-argument", "supportEmail must be a valid email address.");
  }
  const organizationName = updateExistingOrganization
    ? normalizeText(data?.organizationName || data?.name)
    : normalizeText(data?.organizationName || data?.name);
  if (!updateExistingOrganization && !organizationName) {
    throw new functions.https.HttpsError("invalid-argument", "organizationName is required.");
  }
  const explicitOrganizationId = normalizeOrganizationId(data?.organizationId || data?.organizationSlug);
  if (updateExistingOrganization && !explicitOrganizationId) {
    throw new functions.https.HttpsError(
      "invalid-argument",
      "An explicit organizationId is required for an existing-organization update."
    );
  }
  const organizationId = normalizeOrganizationId(
    explicitOrganizationId || slugify(organizationName, "organization")
  );
  if (!organizationId) {
    throw new functions.https.HttpsError("invalid-argument", "organizationId is required.");
  }
  const requestedOrderId = normalizeOrderId(data?.orderId);
  if (!requestedOrderId) {
    throw new functions.https.HttpsError(
      "invalid-argument",
      "orderId is required so provisioning can be retried and audited safely."
    );
  }
  const hasCrossOrganizationBypass = staff.crossOrgBypass === true;
  if (!hasCrossOrganizationBypass) {
    throw new functions.https.HttpsError(
      "permission-denied",
      "Platform administrator authority is required for customer provisioning."
    );
  }
  if (!canProvisionOrganization({
    targetOrganizationId: organizationId,
    principalOrganizationId: staff.principalOrganizationId,
    resolvedHostOrganizationId: staff.resolvedHostOrg,
    hasCrossOrganizationBypass
  })) {
    throw new functions.https.HttpsError(
      "permission-denied",
      staff.resolvedHostOrg
        ? "Tenant host can only provision its own organization."
        : "This admin is not authorized to provision the requested organization."
    );
  }

  return {
    staff,
    actorEmail,
    ownerEmail,
    ownerName,
    ownerUid,
    appUrl,
    supportEmail,
    sendEmail,
    organizationName,
    organizationId,
    requestedOrderId,
    updateExistingOrganization,
    entitlements: resolveFeatureEntitlements(data)
  };
}

function isAuthUserNotFoundError(err) {
  return err?.code === "auth/user-not-found";
}

async function findAuthUserByEmail(ownerEmail = "") {
  try {
    return await auth.getUserByEmail(ownerEmail);
  } catch (err) {
    if (isAuthUserNotFoundError(err)) return null;
    throw err;
  }
}

async function assertCustomerProvisioningOwnerAvailable({
  ownerEmail = "",
  ownerUid = "",
  organizationId = ""
} = {}) {
  let uidUser = null;
  if (ownerUid) {
    try {
      uidUser = await auth.getUser(ownerUid);
    } catch (err) {
      if (isAuthUserNotFoundError(err)) {
        throw new functions.https.HttpsError(
          "failed-precondition",
          "Owner UID does not match an existing Firebase Auth user."
        );
      }
      throw err;
    }
  }
  const emailUser = ownerEmail ? await findAuthUserByEmail(ownerEmail) : null;
  if (uidUser && normalizeEmail(uidUser.email) !== ownerEmail) {
    throw new functions.https.HttpsError(
      "failed-precondition",
      "Owner UID and owner email do not belong to the same Firebase Auth user."
    );
  }
  if (uidUser && emailUser && uidUser.uid !== emailUser.uid) {
    throw new functions.https.HttpsError(
      "failed-precondition",
      "Owner UID and owner email resolve to different Firebase Auth users."
    );
  }

  const resolvedUser = uidUser || emailUser;
  if (ownerUid && resolvedUser && resolvedUser.emailVerified !== true) {
    throw new functions.https.HttpsError(
      "failed-precondition",
      "Direct owner UID assignment requires a verified Firebase Auth email."
    );
  }
  let roleOrganizationId = "";
  let claimsOrganizationId = "";
  let roleRef = null;
  let roleSnap = null;
  if (resolvedUser) {
    roleRef = db.collection(ROLES_COLLECTION).doc(resolvedUser.uid);
    roleSnap = await roleRef.get();
    roleOrganizationId = normalizeOrganizationId(roleSnap.data()?.organizationId);
    claimsOrganizationId = normalizeOrganizationId(resolvedUser.customClaims?.organizationId);
  }

  const inviteId = inviteDocIdFromEmail(ownerEmail);
  const inviteRef = inviteId ? db.collection(INVITES_COLLECTION).doc(inviteId) : null;
  const inviteSnap = inviteRef ? await inviteRef.get() : null;
  const inviteOrganizationId = normalizeOrganizationId(inviteSnap?.data()?.organizationId);
  const conflictingOrganizationId = findConflictingOrganizationScope({
    targetOrganizationId: organizationId,
    roleOrganizationId,
    claimsOrganizationId,
    inviteOrganizationId
  });
  if (conflictingOrganizationId) {
    throw new functions.https.HttpsError(
      "failed-precondition",
      "Owner account or invite is already scoped to a different organization. No changes were made."
    );
  }
  if (inviteSnap?.exists) {
    throw new functions.https.HttpsError(
      "already-exists",
      "An invite already exists for the owner email. No changes were made."
    );
  }

  return {
    inviteRef,
    roleRef,
    roleExists: Boolean(roleSnap?.exists),
    roleUpdateTime: roleSnap?.updateTime || null
  };
}

async function readCustomerProvisioningTargetState(organizationId = "", orderId = "") {
  const orgRef = db.collection(ORGANIZATIONS_COLLECTION).doc(organizationId);
  const settingsRef = orgRef.collection("settings").doc("config");
  const orderRef = orderId ? db.collection(PROVISIONING_ORDERS_COLLECTION).doc(orderId) : null;
  const tombstoneRef = db.collection(ORGANIZATION_TOMBSTONES_COLLECTION).doc(organizationId);
  const [organizationSnap, settingsSnap, orderSnap, tombstoneSnap, domainSnap] = await Promise.all([
    orgRef.get(),
    settingsRef.get(),
    orderRef ? orderRef.get() : Promise.resolve(null),
    tombstoneRef.get(),
    db.collection(TENANT_DOMAINS_COLLECTION)
      .where("organizationId", "==", organizationId)
      .limit(1)
      .get()
  ]);
  let residualCollectionIds = [];
  if (!organizationSnap.exists) {
    const collectionRefs = await orgRef.listCollections();
    const collectionChecks = await Promise.all(
      collectionRefs.map(async (collectionRef) => ({
        id: collectionRef.id,
        snap: await collectionRef.limit(1).get()
      }))
    );
    residualCollectionIds = collectionChecks
      .filter((entry) => !entry.snap.empty)
      .map((entry) => entry.id);
  }
  const unsafeResidueReasons = [
    ...(tombstoneSnap.exists ? ["retired_organization_id"] : []),
    ...(organizationSnap.exists && !isOrganizationRecordActive(organizationSnap.data())
      ? ["archived_or_inactive_organization"]
      : []),
    ...(!organizationSnap.exists && !domainSnap.empty ? ["tenant_domain_mapping"] : []),
    ...(residualCollectionIds.length ? ["orphaned_subcollections"] : [])
  ];
  return {
    orgRef,
    settingsRef,
    orderRef,
    tombstoneRef,
    organizationExists: organizationSnap.exists,
    organizationUpdateTime: organizationSnap.updateTime || null,
    organizationData: organizationSnap.data() || null,
    settingsExists: settingsSnap.exists,
    settingsUpdateTime: settingsSnap.updateTime || null,
    settingsData: settingsSnap.data() || null,
    organizationName: normalizeText(organizationSnap.data()?.name),
    currentPlan: normalizeText(
      organizationSnap.data()?.plan
      || settingsSnap.data()?.plan
      || settingsSnap.data()?.onboarding?.plan
    ).toLowerCase(),
    orderExists: Boolean(orderSnap?.exists),
    orderData: orderSnap?.data() || null,
    unsafeResidue: unsafeResidueReasons.length > 0,
    unsafeResidueReasons
  };
}

function sameStringSet(left = [], right = []) {
  const leftValues = [...new Set((Array.isArray(left) ? left : []).map((value) => normalizeText(value)).filter(Boolean))].sort();
  const rightValues = [...new Set((Array.isArray(right) ? right : []).map((value) => normalizeText(value)).filter(Boolean))].sort();
  return leftValues.length === rightValues.length
    && leftValues.every((value, index) => value === rightValues[index]);
}

function featureFlagsMatch(left = {}, right = {}) {
  return FEATURE_FLAG_KEYS.every((key) => Boolean(left?.[key]) === Boolean(right?.[key]));
}

function entitlementsFromProvisioningOrder(orderData = {}) {
  const plan = normalizeText(orderData.plan).toLowerCase();
  if (!FEATURE_PLAN_PRESETS[plan]) {
    throw new functions.https.HttpsError(
      "failed-precondition",
      "Provisioning order has no valid plan and cannot be repaired automatically."
    );
  }
  const featureFlags = FEATURE_FLAG_KEYS.reduce((acc, key) => {
    acc[key] = Boolean(orderData.featureFlags?.[key]);
    return acc;
  }, {});
  return {
    plan,
    featureFlags,
    paidFeatureIds: FEATURE_FLAG_KEYS.filter((key) => featureFlags[key]),
    unpaidFeatureIds: FEATURE_FLAG_KEYS.filter((key) => !featureFlags[key])
  };
}

function provisioningOrderMatchesRequest(orderData = {}, {
  organizationId = "",
  ownerEmail = "",
  ownerUid = "",
  entitlements = {},
  updateExistingOrganization = false,
  sendEmail = false,
  appUrl = "",
  supportEmail = ""
} = {}) {
  if (!orderData || typeof orderData !== "object") return false;
  const expectedOperation = updateExistingOrganization ? "updated_entitlements" : "";
  const storedOperation = normalizeText(orderData.operation);
  if (expectedOperation && storedOperation !== expectedOperation) return false;
  if (!expectedOperation && storedOperation === "updated_entitlements") return false;
  if (normalizeOrganizationId(orderData.organizationId) !== normalizeOrganizationId(organizationId)) return false;
  if (normalizeText(orderData.plan).toLowerCase() !== normalizeText(entitlements.plan).toLowerCase()) return false;
  if (!FEATURE_FLAG_KEYS.every(
    (key) => Boolean(orderData.featureFlags?.[key]) === Boolean(entitlements.featureFlags?.[key])
  )) return false;
  if (updateExistingOrganization) return orderData.sendEmail !== true;
  return normalizeEmail(orderData.ownerEmail) === normalizeEmail(ownerEmail)
    && normalizeText(orderData.ownerUid) === normalizeText(ownerUid)
    && Boolean(orderData.sendEmail) === Boolean(sendEmail)
    && normalizeText(orderData.appUrl) === normalizeText(appUrl)
    && normalizeEmail(orderData.supportEmail) === normalizeEmail(supportEmail);
}

async function validateProvisioningResumeArtifacts({
  targetState,
  orderId = "",
  organizationId = "",
  ownerEmail = "",
  ownerUid = "",
  entitlements = {},
  updateExistingOrganization = false
} = {}) {
  const reasons = [];
  const organizationData = targetState?.organizationData || {};
  const settingsData = targetState?.settingsData || {};
  const normalizedOrganizationId = normalizeOrganizationId(organizationId);
  const normalizedOrderId = normalizeOrderId(orderId);

  if (!targetState?.organizationExists) reasons.push("organization_missing");
  if (targetState?.organizationExists && !isOrganizationRecordActive(organizationData)) {
    reasons.push("organization_archived_or_inactive");
  }
  if (!targetState?.settingsExists) reasons.push("settings_missing");
  if (normalizeOrderId(organizationData.orderId) !== normalizedOrderId) {
    reasons.push("organization_order_mismatch");
  }
  if (normalizeOrderId(settingsData.orderId) !== normalizedOrderId) {
    reasons.push("settings_order_mismatch");
  }
  if (normalizeText(organizationData.plan).toLowerCase() !== entitlements.plan) {
    reasons.push("organization_plan_mismatch");
  }
  if (normalizeText(settingsData.plan).toLowerCase() !== entitlements.plan) {
    reasons.push("settings_plan_mismatch");
  }
  if (!featureFlagsMatch(settingsData.featureFlags, entitlements.featureFlags)) {
    reasons.push("settings_entitlements_mismatch");
  }
  if (!sameStringSet(organizationData.featureFlagsPaid, entitlements.paidFeatureIds)) {
    reasons.push("organization_entitlements_mismatch");
  }

  if (updateExistingOrganization) {
    return {
      ok: reasons.length === 0,
      reasons
    };
  }

  if (normalizeEmail(organizationData.ownerEmail) !== normalizeEmail(ownerEmail)) {
    reasons.push("organization_owner_email_mismatch");
  }
  if (normalizeText(organizationData.ownerUid) !== normalizeText(ownerUid)) {
    reasons.push("organization_owner_uid_mismatch");
  }
  if (normalizeEmail(settingsData.onboarding?.ownerEmail) !== normalizeEmail(ownerEmail)) {
    reasons.push("settings_owner_email_mismatch");
  }

  const inviteId = inviteDocIdFromEmail(ownerEmail);
  const inviteRef = inviteId ? db.collection(INVITES_COLLECTION).doc(inviteId) : null;
  const inviteSnap = inviteRef ? await inviteRef.get() : null;
  const invite = inviteSnap?.data() || {};
  if (!inviteSnap?.exists) {
    reasons.push("owner_invite_missing");
  } else {
    if (normalizeEmail(invite.email) !== normalizeEmail(ownerEmail)) reasons.push("owner_invite_email_mismatch");
    if (normalizeOrganizationId(invite.organizationId) !== normalizedOrganizationId) {
      reasons.push("owner_invite_organization_mismatch");
    }
    if (normalizeRole(invite.role) !== "admin") reasons.push("owner_invite_role_mismatch");
    if (!ownerUid && normalizeOrderId(invite.orderId) !== normalizedOrderId) {
      reasons.push("owner_invite_order_mismatch");
    }
  }

  if (ownerUid) {
    const roleSnap = await db.collection(ROLES_COLLECTION).doc(ownerUid).get();
    const role = roleSnap.data() || {};
    if (!roleSnap.exists) {
      reasons.push("owner_role_missing");
    } else {
      if (normalizeRole(role.role) !== "admin") reasons.push("owner_role_mismatch");
      if (normalizeOrganizationId(role.organizationId) !== normalizedOrganizationId) {
        reasons.push("owner_role_organization_mismatch");
      }
      if (normalizeEmail(role.email) !== normalizeEmail(ownerEmail)) {
        reasons.push("owner_role_email_mismatch");
      }
    }
    if (normalizeText(invite.status).toLowerCase() !== "consumed") {
      reasons.push("owner_invite_not_consumed");
    }
    if (normalizeText(invite.consumedByUid) !== normalizeText(ownerUid)) {
      reasons.push("owner_invite_uid_mismatch");
    }
  } else if (!["pending", "active"].includes(normalizeText(invite.status).toLowerCase())) {
    reasons.push("owner_invite_not_pending");
  } else {
    const inviteExpiresAtMs = Date.parse(normalizeText(invite.expiresAtISO));
    if (!Number.isFinite(inviteExpiresAtMs) || inviteExpiresAtMs <= Date.now()) {
      reasons.push("owner_invite_expired");
    }
  }

  const expectedCatalogRecords = Math.max(
    0,
    Number(targetState?.orderData?.catalogBootstrap?.recordsCreated || 0) || 0
  );
  if (expectedCatalogRecords > 0 && targetState?.orgRef) {
    const [packagesSnap, addonsSnap, rentalsSnap] = await Promise.all([
      targetState.orgRef.collection("catalogPackages").get(),
      targetState.orgRef.collection("catalogAddons").get(),
      targetState.orgRef.collection("catalogRentals").get()
    ]);
    if (packagesSnap.size + addonsSnap.size + rentalsSnap.size < expectedCatalogRecords) {
      reasons.push("catalog_bootstrap_incomplete");
    }
  }

  return {
    ok: reasons.length === 0,
    reasons
  };
}

exports.preflightCustomerOrder = functions.region(REGION).https.onCall(async (data, context) => {
  const {
    organizationName,
    organizationId,
    ownerEmail,
    ownerUid,
    requestedOrderId,
    updateExistingOrganization,
    entitlements,
    sendEmail,
    appUrl,
    supportEmail
  } = await resolveCustomerProvisioningRequest(data, context);
  const targetState = await readCustomerProvisioningTargetState(organizationId, requestedOrderId);
  const orderMatches = targetState.orderExists && provisioningOrderMatchesRequest(
    targetState.orderData,
    {
      organizationId,
      ownerEmail,
      ownerUid,
      entitlements,
      updateExistingOrganization,
      sendEmail,
      appUrl,
      supportEmail
    }
  );
  const resumeArtifacts = orderMatches
    ? await validateProvisioningResumeArtifacts({
      targetState,
      orderId: requestedOrderId,
      organizationId,
      ownerEmail,
      ownerUid,
      entitlements,
      updateExistingOrganization
    })
    : { ok: false, reasons: [] };
  const canResume = orderMatches && resumeArtifacts.ok && !targetState.unsafeResidue;
  if (
    !updateExistingOrganization
    && !hasExistingProvisioningTarget(targetState)
    && !targetState.orderExists
    && !targetState.unsafeResidue
  ) {
    await assertCustomerProvisioningOwnerAvailable({
      ownerEmail,
      ownerUid,
      organizationId
    });
  }
  return {
    ok: true,
    preflight: true,
    organizationId,
    organizationName: targetState.organizationName || organizationName,
    currentPlan: targetState.currentPlan || "",
    exists: hasExistingProvisioningTarget(targetState) || targetState.unsafeResidue,
    orderExists: targetState.orderExists,
    orderStatus: normalizeText(targetState.orderData?.status),
    canResume,
    resumeBlockedReasons: orderMatches && !resumeArtifacts.ok ? resumeArtifacts.reasons : [],
    unsafeResidue: targetState.unsafeResidue,
    canCreate: !hasExistingProvisioningTarget(targetState)
      && !targetState.orderExists
      && !targetState.unsafeResidue
      && !updateExistingOrganization,
    canUpdate: targetState.organizationExists
      && !targetState.orderExists
      && !targetState.unsafeResidue
      && updateExistingOrganization
  };
});

exports.provisionCustomerOrder = functions
  .runWith({ secrets: [RESEND_API_KEY_SECRET_NAME] })
  .region(REGION)
  .https.onCall(async (data, context) => {
  const {
    staff,
    actorEmail,
    ownerEmail,
    ownerName,
    ownerUid,
    organizationName,
    organizationId,
    requestedOrderId,
    updateExistingOrganization,
    entitlements,
    appUrl,
    supportEmail,
    sendEmail
  } = await resolveCustomerProvisioningRequest(data, context);
  const orderId = requestedOrderId;
  const targetState = await readCustomerProvisioningTargetState(organizationId, orderId);
  if (targetState.unsafeResidue) {
    throw new functions.https.HttpsError(
      "failed-precondition",
      `Organization id "${organizationId}" has retired or orphaned state and cannot be provisioned automatically. No changes were made.`
    );
  }
  if (targetState.orderExists) {
    const orderMatches = provisioningOrderMatchesRequest(targetState.orderData, {
      organizationId,
      ownerEmail,
      ownerUid,
      entitlements,
      updateExistingOrganization,
      sendEmail,
      appUrl,
      supportEmail
    });
    if (!orderMatches) {
      throw new functions.https.HttpsError(
        "already-exists",
        buildExistingOrderMessage(orderId)
      );
    }
    const resumeArtifacts = await validateProvisioningResumeArtifacts({
      targetState,
      orderId,
      organizationId,
      ownerEmail,
      ownerUid,
      entitlements,
      updateExistingOrganization
    });
    if (!resumeArtifacts.ok) {
      throw new functions.https.HttpsError(
        "failed-precondition",
        `Provisioning order "${orderId}" cannot be resumed because its tenant artifacts are incomplete or no longer match. No email was sent.`
      );
    }

    if (updateExistingOrganization) {
      return {
        ok: true,
        resumed: true,
        operation: "updated_entitlements",
        orderId,
        organizationId,
        organizationName: targetState.organizationName || "",
        plan: entitlements.plan,
        featureFlags: entitlements.featureFlags,
        featureFlagsPaid: entitlements.paidFeatureIds,
        featureFlagsUnpaid: entitlements.unpaidFeatureIds,
        catalogBootstrap: {
          template: "unchanged",
          recordsCreated: 0
        },
        email: {
          sent: false,
          reason: "existing_org_update"
        },
        onboarding: null
      };
    }

    const finalized = await finalizeProvisioningOrder({
      orderRef: targetState.orderRef,
      orderId,
      organizationId,
      organizationName: normalizeText(targetState.orderData.organizationName) || targetState.organizationName,
      ownerEmail,
      ownerName: normalizeText(targetState.orderData.ownerName) || ownerName,
      ownerUid,
      appUrl,
      supportEmail,
      entitlements,
      sendEmail,
      existingEmail: targetState.orderData.email
    });
    assertProvisioningFinalizationPersisted(finalized);
    return {
      ok: true,
      resumed: true,
      operation: "created",
      orderId,
      organizationId,
      organizationName: normalizeText(targetState.orderData.organizationName) || targetState.organizationName,
      ownerEmail,
      ownerUid,
      plan: entitlements.plan,
      featureFlags: entitlements.featureFlags,
      featureFlagsPaid: entitlements.paidFeatureIds,
      featureFlagsUnpaid: entitlements.unpaidFeatureIds,
      catalogBootstrap: targetState.orderData.catalogBootstrap || {
        template: "blank",
        recordsCreated: 0
      },
      email: finalized.emailResult,
      claimsSync: finalized.claimsSync,
      onboarding: {
        appUrl,
        accessMode: ownerUid ? "direct_role" : "email_invite",
        emailSubject: finalized.emailPayload.subject,
        emailText: finalized.emailPayload.text
      }
    };
  }
  const targetExists = hasExistingProvisioningTarget(targetState);
  if (targetExists && !updateExistingOrganization) {
    throw new functions.https.HttpsError(
      "already-exists",
      buildExistingOrganizationMessage(organizationId)
    );
  }
  if (updateExistingOrganization && !targetState.organizationExists) {
    throw new functions.https.HttpsError(
      targetExists ? "failed-precondition" : "not-found",
      targetExists
        ? `Organization "${organizationId}" has incomplete persisted state and cannot be updated safely.`
        : `Organization "${organizationId}" does not exist. No changes were made.`
    );
  }
  const ownerIdentity = updateExistingOrganization
    ? null
    : await assertCustomerProvisioningOwnerAvailable({
      ownerEmail,
      ownerUid,
      organizationId
    });

  const nowISO = new Date().toISOString();
  const now = FieldValue.serverTimestamp();
  const { orgRef, settingsRef, orderRef } = targetState;

  if (updateExistingOrganization) {
    const batch = db.batch();
    batch.update(orgRef, {
      plan: entitlements.plan,
      featureFlagsLocked: true,
      featureFlagsPaid: entitlements.paidFeatureIds,
      orderId,
      updatedAtISO: nowISO,
      updatedAt: now
    }, { lastUpdateTime: targetState.organizationUpdateTime });
    const settingsPatch = {
      plan: entitlements.plan,
      featureFlags: entitlements.featureFlags,
      featureFlagsLocked: true,
      featureFlagsPaid: entitlements.paidFeatureIds,
      featureFlagsLockReason: "Unpaid modules are locked by ordered package.",
      featureFlagsLockUpdatedAtISO: nowISO,
      orderId,
      updatedAtISO: nowISO,
      updatedAt: now
    };
    if (targetState.settingsExists) {
      batch.update(settingsRef, settingsPatch, {
        lastUpdateTime: targetState.settingsUpdateTime
      });
    } else {
      batch.create(settingsRef, settingsPatch);
    }
    batch.create(orderRef, {
      orderId,
      status: "entitlements_updated",
      operation: "updated_entitlements",
      organizationId,
      organizationName: targetState.organizationName || "",
      plan: entitlements.plan,
      featureFlags: entitlements.featureFlags,
      featureFlagsPaid: entitlements.paidFeatureIds,
      featureFlagsUnpaid: entitlements.unpaidFeatureIds,
      sendEmail: false,
      requestedBy: {
        uid: staff.uid,
        email: actorEmail
      },
      updatedAtISO: nowISO,
      updatedAt: now,
      createdAt: now
    });
    try {
      await batch.commit();
    } catch (err) {
      if (isAlreadyExistsError(err)) {
        throw new functions.https.HttpsError(
          "already-exists",
          buildExistingOrderMessage(orderId)
        );
      }
      throw err;
    }
    return {
      ok: true,
      operation: "updated_entitlements",
      orderId,
      organizationId,
      organizationName: targetState.organizationName || "",
      plan: entitlements.plan,
      featureFlags: entitlements.featureFlags,
      featureFlagsPaid: entitlements.paidFeatureIds,
      featureFlagsUnpaid: entitlements.unpaidFeatureIds,
      catalogBootstrap: {
        template: "unchanged",
        recordsCreated: 0
      },
      email: {
        sent: false,
        reason: "existing_org_update"
      },
      onboarding: null
    };
  }

  const inviteId = inviteDocIdFromEmail(ownerEmail);
  if (!inviteId && !ownerUid) {
    throw new functions.https.HttpsError("invalid-argument", "ownerEmail or ownerUid must resolve to a valid invite id.");
  }

  const neutralSettingsPatch = buildNeutralSettingsPatch({
    organizationName,
    ownerName,
    ownerEmail,
    supportEmail
  });
  // A new tenant starts with an intentionally blank catalog. Zero-price
  // placeholder products can escape into customer quotes, so catalog data must
  // be configured or imported explicitly during owner onboarding.
  const catalogBootstrapEntries = [];
  const batch = db.batch();

  batch.create(orgRef, {
    name: organizationName,
    slug: slugify(organizationName, organizationId),
    ownerEmail,
    ownerUid: ownerUid || "",
    active: true,
    archived: false,
    status: "active",
    plan: entitlements.plan,
    featureFlagsLocked: true,
    featureFlagsPaid: entitlements.paidFeatureIds,
    orderId,
    updatedAtISO: nowISO,
    updatedAt: now
  });

  batch.create(settingsRef, {
    plan: entitlements.plan,
    featureFlags: entitlements.featureFlags,
    featureFlagsLocked: true,
    featureFlagsPaid: entitlements.paidFeatureIds,
    featureFlagsLockReason: "Unpaid modules are locked by ordered package.",
    featureFlagsLockUpdatedAtISO: nowISO,
    ...neutralSettingsPatch,
    orderId,
    onboarding: {
      status: "provisioned",
      plan: entitlements.plan,
      ownerEmail,
      ownerName,
      appUrl,
      supportEmail,
      provisionedAtISO: nowISO
    },
    updatedAtISO: nowISO,
    updatedAt: now
  });

  catalogBootstrapEntries.forEach((entry) => {
    batch.create(entry.ref, entry.data);
  });

  batch.create(orderRef, {
    orderId,
    status: "provisioned",
    organizationId,
    organizationName,
    ownerEmail,
    ownerName,
    ownerUid: ownerUid || "",
    plan: entitlements.plan,
    featureFlags: entitlements.featureFlags,
    featureFlagsPaid: entitlements.paidFeatureIds,
    featureFlagsUnpaid: entitlements.unpaidFeatureIds,
    appUrl,
    supportEmail,
    catalogBootstrap: {
      template: "blank",
      recordsCreated: catalogBootstrapEntries.length
    },
    sendEmail,
    requestedBy: {
      uid: staff.uid,
      email: actorEmail
    },
    updatedAtISO: nowISO,
    updatedAt: now,
    createdAt: now
  });

  if (ownerUid) {
    const rolePayload = {
      role: "admin",
      email: ownerEmail,
      organizationId,
      updatedAt: now
    };
    if (ownerIdentity?.roleExists) {
      batch.update(ownerIdentity.roleRef, rolePayload, {
        lastUpdateTime: ownerIdentity.roleUpdateTime
      });
    } else {
      batch.create(ownerIdentity.roleRef, {
        ...rolePayload,
        createdAt: now
      });
    }
  }

  if (inviteId) {
    const inviteRef = ownerIdentity?.inviteRef || db.collection(INVITES_COLLECTION).doc(inviteId);
    if (ownerUid) {
      batch.create(inviteRef, {
        email: ownerEmail,
        ownerName,
        role: "admin",
        organizationId,
        organizationName,
        orderId,
        status: "consumed",
        consumedByUid: ownerUid,
        consumedByEmail: ownerEmail,
        consumedAtISO: nowISO,
        updatedAtISO: nowISO,
        consumedAt: now,
        updatedAt: now
      });
    } else {
      const inviteExpiresAtISO = new Date(Date.parse(nowISO) + PROVISIONING_INVITE_VALIDITY_MS).toISOString();
      batch.create(inviteRef, {
        email: ownerEmail,
        ownerName,
        role: "admin",
        organizationId,
        organizationName,
        featureFlags: entitlements.featureFlags,
        featureFlagsLocked: true,
        featureFlagsPaid: entitlements.paidFeatureIds,
        plan: entitlements.plan,
        orderId,
        appUrl,
        supportEmail,
        status: "pending",
        expiresAtISO: inviteExpiresAtISO,
        createdAtISO: nowISO,
        updatedAtISO: nowISO,
        createdAt: now,
        updatedAt: now
      });
    }
  }

  try {
    await batch.commit();
  } catch (err) {
    if (isAlreadyExistsError(err)) {
      throw new functions.https.HttpsError(
        "already-exists",
        "The organization, provisioning order, owner role, or invite changed after preflight. No changes were made; run the check again."
      );
    }
    throw err;
  }

  const finalized = await finalizeProvisioningOrder({
    orderRef,
    orderId,
    organizationId,
    organizationName,
    ownerEmail,
    ownerName,
    ownerUid,
    appUrl,
    supportEmail,
    entitlements,
    sendEmail
  });
  assertProvisioningFinalizationPersisted(finalized);
  const claimsSync = finalized.claimsSync;
  const emailResult = finalized.emailResult;
  const emailPayload = finalized.emailPayload;

  return {
    ok: true,
    orderId,
    organizationId,
    organizationName,
    ownerEmail,
    ownerUid,
    plan: entitlements.plan,
    featureFlags: entitlements.featureFlags,
    featureFlagsPaid: entitlements.paidFeatureIds,
    featureFlagsUnpaid: entitlements.unpaidFeatureIds,
    catalogBootstrap: {
      template: "blank",
      recordsCreated: catalogBootstrapEntries.length
    },
    email: emailResult,
    claimsSync,
    onboarding: {
      appUrl,
      accessMode: ownerUid ? "direct_role" : "email_invite",
      emailSubject: emailPayload.subject,
      emailText: emailPayload.text
    }
  };
  });

exports.repairCustomerProvisioningOrder = functions
  .runWith({ secrets: [RESEND_API_KEY_SECRET_NAME] })
  .region(REGION)
  .https.onCall(async (data, context) => {
  const staff = await assertStaff(context);
  if (staff.role !== "admin" || !staff.platformAdmin) {
    throw new functions.https.HttpsError(
      "permission-denied",
      "Platform administrator authority is required for provisioning repair."
    );
  }

  const orderId = normalizeOrderId(data?.orderId);
  const requestedOrganizationId = normalizeOrganizationId(data?.organizationId);
  const requestedOwnerUid = normalizeText(data?.ownerUid);
  if (!orderId || !requestedOrganizationId || !requestedOwnerUid) {
    throw new functions.https.HttpsError(
      "invalid-argument",
      "orderId, organizationId, and ownerUid are required for provisioning repair."
    );
  }

  const orderRef = db.collection(PROVISIONING_ORDERS_COLLECTION).doc(orderId);
  const orderSnap = await orderRef.get();
  if (!orderSnap.exists) {
    throw new functions.https.HttpsError("not-found", "Provisioning order not found.");
  }
  const orderData = orderSnap.data() || {};
  const organizationId = normalizeOrganizationId(orderData.organizationId);
  const ownerUid = normalizeText(orderData.ownerUid);
  if (
    organizationId !== requestedOrganizationId
    || ownerUid !== requestedOwnerUid
    || normalizeText(orderData.operation) === "updated_entitlements"
  ) {
    throw new functions.https.HttpsError(
      "failed-precondition",
      "Provisioning repair target does not match the stored owner and organization."
    );
  }

  const ownerEmail = normalizeEmail(orderData.ownerEmail);
  const ownerName = normalizeText(orderData.ownerName);
  const organizationName = normalizeText(orderData.organizationName);
  const appUrl = parseUrlOrThrow(normalizeText(orderData.appUrl), "appUrl");
  const supportEmail = normalizeEmail(orderData.supportEmail);
  const sendEmail = orderData.sendEmail === true;
  const entitlements = entitlementsFromProvisioningOrder(orderData);
  const targetState = await readCustomerProvisioningTargetState(organizationId, orderId);
  const resumeArtifacts = await validateProvisioningResumeArtifacts({
    targetState,
    orderId,
    organizationId,
    ownerEmail,
    ownerUid,
    entitlements,
    updateExistingOrganization: false
  });
  if (!resumeArtifacts.ok) {
    throw new functions.https.HttpsError(
      "failed-precondition",
      "Provisioning repair is blocked because the stored tenant artifacts are incomplete or no longer match."
    );
  }

  const finalized = await finalizeProvisioningOrder({
    orderRef,
    orderId,
    organizationId,
    organizationName,
    ownerEmail,
    ownerName,
    ownerUid,
    appUrl,
    supportEmail,
    entitlements,
    sendEmail,
    existingEmail: orderData.email
  });
  assertProvisioningFinalizationPersisted(finalized);

  return {
    ok: true,
    resumed: true,
    repaired: finalized.claimsSync.succeeded,
    operation: "created",
    orderId,
    organizationId,
    organizationName,
    ownerEmail,
    ownerUid,
    plan: entitlements.plan,
    featureFlags: entitlements.featureFlags,
    featureFlagsPaid: entitlements.paidFeatureIds,
    featureFlagsUnpaid: entitlements.unpaidFeatureIds,
    catalogBootstrap: orderData.catalogBootstrap || {
      template: "blank",
      recordsCreated: 0
    },
    email: finalized.emailResult,
    claimsSync: finalized.claimsSync,
    onboarding: {
      appUrl,
      accessMode: "direct_role",
      emailSubject: finalized.emailPayload.subject,
      emailText: finalized.emailPayload.text
    }
  };
  });

exports.archiveOrganizationWorkspace = functions.region(REGION).https.onCall(async (data, context) => {
  const organizationId = normalizeOrganizationId(data?.organizationId);
  if (!organizationId) {
    throw new functions.https.HttpsError("invalid-argument", "organizationId is required.");
  }

  const staff = await assertStaff(context, { expectedOrganizationId: organizationId });
  if (staff.role !== "admin" || !staff.platformAdmin) {
    throw new functions.https.HttpsError("permission-denied", "Platform administrator authority is required.");
  }

  assertCleanupConfirmation({
    action: "archive",
    organizationId,
    confirmationToken: data?.confirmationToken
  });

  const orgRef = db.collection(ORGANIZATIONS_COLLECTION).doc(organizationId);
  const orgSnap = await orgRef.get();
  if (!orgSnap.exists) {
    throw new functions.https.HttpsError("not-found", "Organization not found.");
  }

  const nowISO = new Date().toISOString();
  await orgRef.set({
    active: false,
    archived: true,
    status: "archived",
    archivedAtISO: nowISO,
    archivedBy: {
      uid: staff.uid,
      email: staff.email
    },
    updatedAtISO: nowISO,
    updatedAt: FieldValue.serverTimestamp()
  }, { merge: true });

  const tenantDomainsUpdated = await updateTenantDomainMappingsForOrganization({
    organizationId,
    mode: "archive",
    actorUid: staff.uid,
    actorEmail: staff.email,
    nowISO
  });

  return {
    ok: true,
    organizationId,
    tenantDomainsUpdated,
    completedAtISO: nowISO
  };
});

exports.deleteOrganizationWorkspace = functions.region(REGION).https.onCall(async (data, context) => {
  const organizationId = normalizeOrganizationId(data?.organizationId);
  if (!organizationId) {
    throw new functions.https.HttpsError("invalid-argument", "organizationId is required.");
  }

  const staff = await assertStaff(context, {
    expectedOrganizationId: organizationId,
    allowInactiveOrganization: true
  });
  if (staff.role !== "admin" || !staff.platformAdmin) {
    throw new functions.https.HttpsError("permission-denied", "Platform administrator authority is required.");
  }

  assertCleanupConfirmation({
    action: "delete",
    organizationId,
    confirmationToken: data?.confirmationToken
  });

  const orgRef = db.collection(ORGANIZATIONS_COLLECTION).doc(organizationId);
  const orgSnap = await orgRef.get();
  if (!orgSnap.exists) {
    throw new functions.https.HttpsError("not-found", "Organization not found.");
  }

  const organizationData = orgSnap.data() || {};
  if (organizationData.archived !== true) {
    throw new functions.https.HttpsError("failed-precondition", "Organization must be archived before hard delete.");
  }

  const nowISO = new Date().toISOString();
  const tombstoneRef = db.collection(ORGANIZATION_TOMBSTONES_COLLECTION).doc(organizationId);
  await tombstoneRef.set({
    organizationId,
    state: "deleting",
    retiredAtISO: nowISO,
    retiredBy: {
      uid: staff.uid,
      email: staff.email
    },
    updatedAtISO: nowISO,
    updatedAt: FieldValue.serverTimestamp()
  }, { merge: true });
  let tenantDomainsDeleted = 0;
  let roleAssignmentsDeleted = 0;
  let roleClaimRetirementFailures = [];
  let invitesDeleted = 0;
  let portalSnapshotsDeleted = 0;
  try {
    tenantDomainsDeleted = await updateTenantDomainMappingsForOrganization({
      organizationId,
      mode: "delete",
      actorUid: staff.uid,
      actorEmail: staff.email,
      nowISO
    });
    const roleRetirement = await retireOrganizationRoleAssignments(organizationId);
    roleAssignmentsDeleted = roleRetirement.deleted;
    roleClaimRetirementFailures = roleRetirement.claimFailures;
    invitesDeleted = await deleteOrganizationScopedDocuments(INVITES_COLLECTION, organizationId);
    portalSnapshotsDeleted = await deleteOrganizationPortalSnapshots(organizationId);
    await db.recursiveDelete(orgRef);
  } catch (err) {
    await tombstoneRef.set({
      state: "delete_failed",
      error: normalizeText(err?.message || "Recursive organization deletion failed."),
      updatedAtISO: new Date().toISOString(),
      updatedAt: FieldValue.serverTimestamp()
    }, { merge: true });
    throw err;
  }
  await tombstoneRef.set({
    state: "deleted",
    deletedAtISO: new Date().toISOString(),
    error: FieldValue.delete(),
    updatedAtISO: new Date().toISOString(),
    updatedAt: FieldValue.serverTimestamp()
  }, { merge: true });

  return {
    ok: true,
    organizationId,
    tenantDomainsDeleted,
    roleAssignmentsDeleted,
    roleClaimRetirementFailures,
    invitesDeleted,
    portalSnapshotsDeleted,
    completedAtISO: nowISO
  };
});

exports.hardDeleteQuote = functions.region(REGION).https.onCall(async (data, context) => {
  const requestedOrganizationId = normalizeOrganizationId(data?.organizationId);
  const quoteId = normalizeText(data?.quoteId);
  const approvalRequestId = normalizeApprovalExecutionId(data?.approvalRequestId);
  if (!quoteId || !approvalRequestId) {
    throw new functions.https.HttpsError(
      "invalid-argument",
      "quoteId and approvalRequestId are required."
    );
  }

  const staff = await assertStaff(context, {
    expectedOrganizationId: requestedOrganizationId
  });
  if (staff.role !== "admin") {
    throw new functions.https.HttpsError("permission-denied", "Admin role required.");
  }

  const scopedOrganizationId = normalizeOrganizationId(requestedOrganizationId || staff.organizationId);
  if (!scopedOrganizationId) {
    throw new functions.https.HttpsError("invalid-argument", "organizationId is required.");
  }
  if (normalizeOrganizationId(staff.principalOrganizationId) !== scopedOrganizationId) {
    throw new functions.https.HttpsError(
      "permission-denied",
      "Quote deletion requires same-organization admin authority."
    );
  }

  const organizationId = scopedOrganizationId;
  const quoteRef = getQuoteDocRef(quoteId, organizationId);
  const executionRef = getQuoteApprovalExecutionDocRef(
    organizationId,
    approvalRequestId
  );
  const operationStartedAtISO = new Date().toISOString();
  try {
    const claim = await db.runTransaction(async (tx) => {
      const [quoteSnap, executionSnap] = await Promise.all([
        tx.get(quoteRef),
        tx.get(executionRef)
      ]);
      if (quoteSnap.exists) {
        const currentQuote = quoteSnap.data() || {};
        if (normalizeOrganizationId(currentQuote.organizationId) !== organizationId) {
          throw new functions.https.HttpsError(
            "permission-denied",
            "Quote is outside your organization."
          );
        }
        assertQuoteEditNotDispatching(
          { ...currentQuote, id: quoteId },
          operationStartedAtISO
        );
        assertNoInProgressPaymentDispatch(currentQuote, "deleting the quote");
      }
      if (executionSnap.exists) {
        const existingExecution = executionSnap.data() || {};
        assertMatchingApprovalExecutionRecord(existingExecution, {
          organizationId,
          quoteId,
          approvalRequestId,
          action: "delete_quote"
        });
        const executionState = normalizeText(existingExecution.state).toLowerCase();
        if (executionState === "succeeded") {
          return {
            completed: true,
            result: sanitizePaymentRequestExecutionResult(existingExecution.result)
          };
        }
        if (executionState !== "in_progress") {
          throw new ApprovalWorkflowError(
            "failed-precondition",
            "Quote deletion approval execution is not resumable."
          );
        }
        if (normalizeText(existingExecution.executedBy?.uid) !== staff.uid) {
          throw new ApprovalWorkflowError(
            "aborted",
            "Quote deletion is already owned by another administrator."
          );
        }
        return {
          completed: false,
          portalKey: normalizeText(existingExecution.result?.portalKey),
          startedAtISO: normalizeText(existingExecution.startedAtISO) || operationStartedAtISO
        };
      }
      if (!quoteSnap.exists) {
        throw new functions.https.HttpsError("not-found", "Quote not found.");
      }
      const quote = quoteSnap.data() || {};
      if (normalizeOrganizationId(quote.organizationId) !== organizationId) {
        throw new functions.https.HttpsError(
          "permission-denied",
          "Quote is outside your organization."
        );
      }
      const started = buildApprovalExecutionStart({
        workflow: quote.workflow,
        requestId: approvalRequestId,
        action: "delete_quote",
        actorEmail: staff.email,
        nowISO: operationStartedAtISO,
        operationId: approvalRequestId
      });
      const portalKey = normalizeText(quote.portalKey);
      tx.update(quoteRef, {
        "workflow.approvalRequests": started.approvalRequests,
        updatedAtISO: operationStartedAtISO,
        updatedAt: FieldValue.serverTimestamp()
      });
      tx.create(executionRef, buildApprovalExecutionAudit({
        organizationId,
        quoteId,
        approvalRequest: started.request,
        staff,
        state: "in_progress",
        startedAtISO: operationStartedAtISO,
        result: { portalKey }
      }));
      return {
        completed: false,
        portalKey,
        startedAtISO: operationStartedAtISO
      };
    });

    if (claim.completed) {
      return {
        ok: true,
        quoteId,
        organizationId,
        idempotent: true,
        ...(claim.result || {})
      };
    }

    const portalCleanup = await deletePortalSnapshotsForQuote({
      quoteId,
      organizationId,
      fallbackPortalKey: claim.portalKey
    });
    await db.recursiveDelete(quoteRef);
    const completedAtISO = new Date().toISOString();
    const result = {
      portalSnapshotsDeleted: portalCleanup.deleted,
      completedAtISO
    };
    await executionRef.set({
      state: "succeeded",
      result,
      error: "",
      completedAtISO,
      updatedAtISO: completedAtISO,
      updatedAt: FieldValue.serverTimestamp()
    }, { merge: true });

    return {
      ok: true,
      quoteId,
      organizationId,
      ...result
    };
  } catch (err) {
    if (err instanceof functions.https.HttpsError) throw err;
    if (err instanceof QuoteDeliveryError) {
      throw new functions.https.HttpsError(err.code, err.message);
    }
    if (err instanceof ApprovalWorkflowError) {
      throw new functions.https.HttpsError(err.code, err.message);
    }
    functions.logger.error("Hard quote deletion failed", {
      organizationId,
      quoteId,
      approvalRequestId,
      actorUid: staff.uid,
      error: normalizeText(err?.message)
    });
    throw new functions.https.HttpsError(
      "internal",
      "Failed to permanently delete quote. Retry the same approved action."
    );
  }
});

exports.purgeDeletedQuotesForOrganization = functions.region(REGION).https.onCall(async (data, context) => {
  const organizationId = normalizeOrganizationId(data?.organizationId);
  if (!organizationId) {
    throw new functions.https.HttpsError("invalid-argument", "organizationId is required.");
  }

  const staff = await assertStaff(context, { expectedOrganizationId: organizationId });
  if (staff.role !== "admin") {
    throw new functions.https.HttpsError("permission-denied", "Admin role required.");
  }

  throw new functions.https.HttpsError(
    "failed-precondition",
    "Bulk quote purge is retired. Permanently delete one quote at a time with an exact approved delete_quote request."
  );
});

function toStarterCatalogHttpsError(error, fallbackMessage) {
  if (error instanceof StarterCatalogPackError) {
    return new functions.https.HttpsError(error.code, error.message, error.details);
  }
  functions.logger.error(fallbackMessage, {
    error: normalizeText(error?.message)
  });
  return new functions.https.HttpsError("internal", fallbackMessage);
}

function toCatalogImportHttpsError(error, fallbackMessage) {
  if (error instanceof CatalogImportError) {
    return new functions.https.HttpsError(error.code, error.message, error.details);
  }
  functions.logger.error(fallbackMessage, {
    error: normalizeText(error?.message)
  });
  return new functions.https.HttpsError("internal", fallbackMessage);
}

class CustomerImportError extends Error {
  constructor(code, message, details = undefined) {
    super(message);
    this.name = "CustomerImportError";
    this.code = code;
    this.details = details;
  }
}

const CUSTOMER_IMPORT_METADATA_KEYS = new Set([
  "importBatchId",
  "importBaselineHash",
  "createdAt",
  "updatedAt",
  "createdAtISO",
  "updatedAtISO"
]);

function customerImportText(value, maxLength = 500) {
  return String(value ?? "").trim().slice(0, maxLength);
}

function customerImportNameKey(value) {
  return customerImportText(value, 160).toLowerCase().replace(/\s+/g, " ");
}

function normalizeCustomerImportBatchId(value) {
  const batchId = customerImportText(value, 128);
  return /^[A-Za-z0-9_-]{20,128}$/.test(batchId) ? batchId : "";
}

function stableCustomerImportValue(value) {
  if (Array.isArray(value)) return value.map(stableCustomerImportValue);
  if (value && typeof value === "object") {
    return Object.keys(value)
      .sort()
      .reduce((result, key) => {
        if (value[key] !== undefined && typeof value[key] !== "function") {
          result[key] = stableCustomerImportValue(value[key]);
        }
        return result;
      }, {});
  }
  return value;
}

function customerImportHash(value) {
  return createHash("sha256")
    .update(JSON.stringify(stableCustomerImportValue(value)))
    .digest("hex");
}

function customerImportBusinessData(data = {}) {
  return Object.keys(data || {})
    .sort()
    .reduce((result, key) => {
      if (
        !CUSTOMER_IMPORT_METADATA_KEYS.has(key)
        && data[key] !== undefined
        && typeof data[key] !== "function"
      ) {
        result[key] = stableCustomerImportValue(data[key]);
      }
      return result;
    }, {});
}

function customerImportBaselineHash(data = {}) {
  return customerImportHash(customerImportBusinessData(data));
}

function customerImportDuplicateKey(data = {}) {
  const emailKey = normalizeEmail(data.emailKey || data.email);
  if (emailKey) return `email:${emailKey}`;
  const nameKey = customerImportNameKey(data.nameKey || data.name);
  return nameKey ? `name:${nameKey}` : "";
}

function customerImportDocumentId(data = {}) {
  const emailKey = normalizeEmail(data.emailKey || data.email);
  if (emailKey) return customerProjectionDocumentId(emailKey);
  const nameKey = customerImportNameKey(data.nameKey || data.name);
  return nameKey ? `name_${customerImportHash(nameKey)}` : "";
}

function sanitizeCustomerImportRecord(input = {}, rowNumber = 0) {
  const source = input && typeof input === "object" ? input : {};
  const name = customerImportText(source.name, 160);
  const email = normalizeEmail(customerImportText(source.email, 254));
  if (!name && !email) {
    throw new CustomerImportError(
      "invalid-argument",
      `Customer import row ${rowNumber || "unknown"} needs a name or email.`
    );
  }
  if (email && !isValidEmail(email)) {
    throw new CustomerImportError(
      "invalid-argument",
      `Customer import row ${rowNumber || "unknown"} has an invalid email.`
    );
  }
  const data = {
    name,
    email,
    phone: customerImportText(source.phone, 80),
    company: customerImportText(source.company || source.organization, 160),
    notes: customerImportText(source.notes, 2_000),
    nameKey: customerImportNameKey(name),
    emailKey: email
  };
  return {
    data,
    duplicateKey: customerImportDuplicateKey(data),
    customerId: customerImportDocumentId(data)
  };
}

function normalizeCustomerImportRows(records = []) {
  if (!Array.isArray(records) || records.length === 0) {
    throw new CustomerImportError("invalid-argument", "No valid customer records are ready to import.");
  }
  if (records.length > CUSTOMER_IMPORT_MAX_RECORDS) {
    throw new CustomerImportError(
      "resource-exhausted",
      `Customer import batches are limited to ${CUSTOMER_IMPORT_MAX_RECORDS} records.`
    );
  }
  return records.map((entry, index) => {
    const rowNumber = Number.isSafeInteger(Number(entry?.rowNumber))
      ? Number(entry.rowNumber)
      : index + 2;
    const source = entry?.record && typeof entry.record === "object"
      ? entry.record
      : entry;
    return {
      rowNumber,
      ...sanitizeCustomerImportRecord(source, rowNumber)
    };
  });
}

function customerImportRequestHash({ fileName = "", rows = [] } = {}) {
  return customerImportHash({
    importType: CUSTOMER_IMPORT_TYPE,
    fileName: customerImportText(fileName, 240),
    rows: rows.map((row) => ({ rowNumber: row.rowNumber, data: row.data }))
  });
}

function customerImportResultFromReceipt(receipt = {}, { idempotentReplay = true } = {}) {
  return {
    ok: true,
    importBatchId: normalizeCustomerImportBatchId(receipt.importBatchId),
    organizationId: normalizeOrganizationId(receipt.organizationId),
    importType: CUSTOMER_IMPORT_TYPE,
    createdCount: Math.max(0, Number(receipt.createdCount || 0)),
    skippedCount: Math.max(0, Number(receipt.skippedCount || 0)),
    createdRecords: Array.isArray(receipt.createdRecords) ? receipt.createdRecords : [],
    skippedRows: Array.isArray(receipt.skippedRows) ? receipt.skippedRows : [],
    status: customerImportText(receipt.status, 40) || "completed",
    idempotentReplay
  };
}

function customerImportRollbackResultFromReceipt(receipt = {}, { idempotentReplay = true } = {}) {
  return {
    ok: true,
    importBatchId: normalizeCustomerImportBatchId(receipt.importBatchId),
    organizationId: normalizeOrganizationId(receipt.organizationId),
    importType: CUSTOMER_IMPORT_TYPE,
    status: "rolled_back",
    deletedCount: Math.max(0, Number(receipt.rolledBackCount || 0)),
    protectedCount: Math.max(0, Number(receipt.rollbackProtectedCount || 0)),
    missingCount: Math.max(0, Number(receipt.rollbackMissingCount || 0)),
    protectedRecords: Array.isArray(receipt.rollbackProtectedRecords)
      ? receipt.rollbackProtectedRecords
      : [],
    idempotentReplay
  };
}

function assertCustomerImportReceiptIdentity(receipt = {}, {
  organizationId,
  importBatchId,
  requestHash
} = {}) {
  if (
    receipt.batchKind !== CUSTOMER_IMPORT_BATCH_KIND
    || receipt.operation !== "customer_import"
    || receipt.organizationId !== organizationId
    || receipt.importBatchId !== importBatchId
    || receipt.importType !== CUSTOMER_IMPORT_TYPE
    || receipt.targetCollection !== "customers"
    || receipt.requestHash !== requestHash
  ) {
    throw new CustomerImportError(
      "already-exists",
      "This import batch identity is already bound to different customer input. Start a new import."
    );
  }
}

function assertExistingCustomerImportIdentity(snapshot, organizationId) {
  const data = snapshot.data() || {};
  const storedOrganizationId = normalizeOrganizationId(data.organizationId);
  const storedCustomerId = customerImportText(data.customerId, 500);
  const storedEmail = normalizeEmail(data.email);
  const storedEmailKey = normalizeEmail(data.emailKey);
  const storedName = customerImportNameKey(data.name);
  const storedNameKey = customerImportNameKey(data.nameKey);
  if (
    (storedOrganizationId && storedOrganizationId !== organizationId)
    || (storedCustomerId && storedCustomerId !== snapshot.id)
    || (storedEmail && storedEmailKey && storedEmail !== storedEmailKey)
    || (storedName && storedNameKey && storedName !== storedNameKey)
  ) {
    throw new CustomerImportError(
      "failed-precondition",
      "A customer record has conflicting identity or normalized search fields. Repair it before importing."
    );
  }
  return customerImportDuplicateKey(data);
}

async function createCustomerImportBatchInternal({
  organizationId = "",
  organizationName = "",
  fileName = "",
  records = [],
  importBatchId = "",
  actorUid = "",
  actorEmail = "",
  nowISO = new Date().toISOString()
} = {}) {
  const normalizedOrganizationId = normalizeOrganizationId(organizationId);
  const normalizedBatchId = normalizeCustomerImportBatchId(importBatchId);
  if (!normalizedOrganizationId) {
    throw new CustomerImportError("invalid-argument", "organizationId is required.");
  }
  if (!normalizedBatchId) {
    throw new CustomerImportError("invalid-argument", "A stable importBatchId is required.");
  }
  const rows = normalizeCustomerImportRows(records);
  const operationHash = customerImportRequestHash({ fileName, rows });
  const organizationRef = db.collection(ORGANIZATIONS_COLLECTION).doc(normalizedOrganizationId);
  const customerCollectionRef = organizationRef.collection("customers");
  const customerEmailClaimCollectionRef = organizationRef
    .collection(CUSTOMER_EMAIL_CLAIMS_COLLECTION);
  const receiptRef = organizationRef.collection("importBatches").doc(normalizedBatchId);
  const emailClaimRefs = new Map();
  rows.forEach((row) => {
    const emailKey = normalizeEmail(row.data.emailKey || row.data.email);
    if (!emailKey || emailClaimRefs.has(emailKey)) return;
    emailClaimRefs.set(
      emailKey,
      customerEmailClaimCollectionRef.doc(customerEmailClaimDocumentId(emailKey))
    );
  });
  return db.runTransaction(async (transaction) => {
    const receiptSnapshot = await transaction.get(receiptRef);
    if (receiptSnapshot.exists) {
      const receipt = receiptSnapshot.data() || {};
      assertCustomerImportReceiptIdentity(receipt, {
        organizationId: normalizedOrganizationId,
        importBatchId: normalizedBatchId,
        requestHash: operationHash
      });
      if (receipt.status === "completed") return customerImportResultFromReceipt(receipt);
      throw new CustomerImportError(
        "failed-precondition",
        "This customer import was already rolled back. Start a new import batch."
      );
    }
    if (rows.length + emailClaimRefs.size + 1 > CUSTOMER_IMPORT_MAX_TRANSACTION_WRITES) {
      throw new CustomerImportError(
        "resource-exhausted",
        "This customer import has too many email identities for one atomic batch. Split it into smaller files."
      );
    }

    const orderedEmailClaims = [...emailClaimRefs.entries()];
    const [existingSnapshot, ...emailClaimSnapshots] = await Promise.all([
      transaction.get(customerCollectionRef.limit(CUSTOMER_IMPORT_MAX_DUPLICATE_SCAN_RECORDS + 1)),
      ...orderedEmailClaims.map(([, claimRef]) => transaction.get(claimRef))
    ]);
    if (existingSnapshot.docs.length > CUSTOMER_IMPORT_MAX_DUPLICATE_SCAN_RECORDS) {
      throw new CustomerImportError(
        "resource-exhausted",
        `This destination has more than ${CUSTOMER_IMPORT_MAX_DUPLICATE_SCAN_RECORDS} customer records. Use a managed migration so duplicate checks remain complete.`
      );
    }

    const existingKeys = new Map();
    const existingIds = new Map();
    existingSnapshot.docs.forEach((snapshot) => {
      const duplicateKey = assertExistingCustomerImportIdentity(
        snapshot,
        normalizedOrganizationId
      );
      existingIds.set(snapshot.id, duplicateKey);
      if (!duplicateKey) return;
      const priorId = existingKeys.get(duplicateKey);
      if (priorId && priorId !== snapshot.id) {
        throw new CustomerImportError(
          "failed-precondition",
          "Multiple customer records already share the same normalized identity. Repair the collision before importing."
        );
      }
      existingKeys.set(duplicateKey, snapshot.id);
    });

    const emailClaimsByEmail = new Map();
    orderedEmailClaims.forEach(([emailKey], index) => {
      const binding = readCustomerEmailClaim(
        emailClaimSnapshots[index],
        normalizedOrganizationId,
        emailKey
      );
      if (!binding) return;
      const existingCustomerId = existingKeys.get(`email:${emailKey}`);
      if (!existingCustomerId || existingCustomerId !== binding.customerId) {
        throw new CustomerImportError(
          "failed-precondition",
          "A customer email claim does not match the existing customer directory. Repair it before importing."
        );
      }
      emailClaimsByEmail.set(emailKey, binding);
    });

    const seenKeys = new Set(existingKeys.keys());
    const createdRecords = [];
    const skippedRows = [];
    rows.forEach((row) => {
      if (seenKeys.has(row.duplicateKey)) {
        const emailKey = normalizeEmail(row.data.emailKey || row.data.email);
        const existingCustomerId = existingKeys.get(row.duplicateKey);
        if (emailKey && existingCustomerId && !emailClaimsByEmail.has(emailKey)) {
          const claim = buildCustomerEmailClaim({
            organizationId: normalizedOrganizationId,
            customerId: existingCustomerId,
            customerEmail: emailKey,
            nowISO,
            claimSource: "legacy_repair"
          });
          writeCustomerEmailClaim(
            transaction,
            emailClaimRefs.get(emailKey),
            claim
          );
          emailClaimsByEmail.set(emailKey, {
            customerId: existingCustomerId,
            data: claim.patch
          });
        }
        skippedRows.push({ rowNumber: row.rowNumber, reason: "duplicate" });
        return;
      }
      const collidingKey = existingIds.get(row.customerId);
      if (existingIds.has(row.customerId) && collidingKey !== row.duplicateKey) {
        throw new CustomerImportError(
          "failed-precondition",
          "A stable customer identity is already occupied by a different normalized customer."
        );
      }
      seenKeys.add(row.duplicateKey);
      const customerData = {
        customerId: row.customerId,
        organizationId: normalizedOrganizationId,
        ...row.data,
        recordSource: CUSTOMER_IMPORT_SOURCE,
        importSource: CUSTOMER_IMPORT_SOURCE
      };
      const baselineHash = customerImportBaselineHash(customerData);
      transaction.set(customerCollectionRef.doc(row.customerId), {
        ...customerData,
        importBatchId: normalizedBatchId,
        importBaselineHash: baselineHash,
        createdAtISO: nowISO,
        updatedAtISO: nowISO,
        createdAt: FieldValue.serverTimestamp(),
        updatedAt: FieldValue.serverTimestamp()
      });
      const emailKey = normalizeEmail(row.data.emailKey || row.data.email);
      let emailClaimId = "";
      if (emailKey) {
        const claim = buildCustomerEmailClaim({
          organizationId: normalizedOrganizationId,
          customerId: row.customerId,
          customerEmail: emailKey,
          nowISO,
          claimSource: CUSTOMER_IMPORT_SOURCE,
          importBatchId: normalizedBatchId
        });
        writeCustomerEmailClaim(
          transaction,
          emailClaimRefs.get(emailKey),
          claim
        );
        emailClaimsByEmail.set(emailKey, {
          customerId: row.customerId,
          data: claim.patch
        });
        emailClaimId = claim.claimId;
      }
      createdRecords.push({
        collection: "customers",
        id: row.customerId,
        rowNumber: row.rowNumber,
        baselineHash,
        ...(emailClaimId ? { emailClaimId, emailKey } : {})
      });
    });

    transaction.set(receiptRef, {
      schemaVersion: 3,
      batchKind: CUSTOMER_IMPORT_BATCH_KIND,
      operation: "customer_import",
      importBatchId: normalizedBatchId,
      organizationId: normalizedOrganizationId,
      organizationName: customerImportText(organizationName, 300),
      importType: CUSTOMER_IMPORT_TYPE,
      targetCollection: "customers",
      fileName: customerImportText(fileName, 240),
      requestHash: operationHash,
      status: "completed",
      sourceRows: rows.length,
      createdCount: createdRecords.length,
      skippedCount: skippedRows.length,
      createdRecords,
      skippedRows,
      actor: {
        uid: customerImportText(actorUid, 160),
        email: normalizeEmail(actorEmail)
      },
      createdAtISO: nowISO,
      updatedAtISO: nowISO,
      createdAt: FieldValue.serverTimestamp(),
      updatedAt: FieldValue.serverTimestamp()
    });
    return {
      ...customerImportResultFromReceipt({
        importBatchId: normalizedBatchId,
        organizationId: normalizedOrganizationId,
        createdCount: createdRecords.length,
        skippedCount: skippedRows.length,
        createdRecords,
        skippedRows,
        status: "completed"
      }, { idempotentReplay: false })
    };
  });
}

function isLegacyCustomerImportReceipt(receipt = {}, organizationId, importBatchId) {
  return !receipt.batchKind
    && !receipt.operation
    && receipt.organizationId === organizationId
    && receipt.importBatchId === importBatchId
    && receipt.importType === CUSTOMER_IMPORT_TYPE;
}

function legacyCustomerImportRecordUnchanged(data = {}, importBatchId) {
  return data.importSource === CUSTOMER_IMPORT_SOURCE
    && data.importBatchId === importBatchId
    && customerImportText(data.createdAtISO) !== ""
    && data.updatedAtISO === data.createdAtISO
    && !data.customerId
    && !data.nameKey
    && !data.emailKey
    && !data.recordSource
    && !data.lastQuoteId
    && !data.lastProjectedAtISO;
}

async function rollbackCustomerImportBatchInternal({
  organizationId = "",
  importBatchId = "",
  actorUid = "",
  actorEmail = "",
  nowISO = new Date().toISOString()
} = {}) {
  const normalizedOrganizationId = normalizeOrganizationId(organizationId);
  const normalizedBatchId = normalizeCustomerImportBatchId(importBatchId);
  if (!normalizedOrganizationId) {
    throw new CustomerImportError("invalid-argument", "organizationId is required.");
  }
  if (!normalizedBatchId) {
    throw new CustomerImportError("invalid-argument", "A valid importBatchId is required.");
  }
  const organizationRef = db.collection(ORGANIZATIONS_COLLECTION).doc(normalizedOrganizationId);
  const customerCollectionRef = organizationRef.collection("customers");
  const customerEmailClaimCollectionRef = organizationRef
    .collection(CUSTOMER_EMAIL_CLAIMS_COLLECTION);
  const receiptRef = organizationRef.collection("importBatches").doc(normalizedBatchId);

  return db.runTransaction(async (transaction) => {
    const receiptSnapshot = await transaction.get(receiptRef);
    if (!receiptSnapshot.exists) {
      throw new CustomerImportError("not-found", "Customer import receipt was not found.");
    }
    const receipt = receiptSnapshot.data() || {};
    const currentReceipt = receipt.batchKind === CUSTOMER_IMPORT_BATCH_KIND
      && receipt.operation === "customer_import"
      && receipt.organizationId === normalizedOrganizationId
      && receipt.importBatchId === normalizedBatchId
      && receipt.importType === CUSTOMER_IMPORT_TYPE
      && receipt.targetCollection === "customers";
    const legacyReceipt = isLegacyCustomerImportReceipt(
      receipt,
      normalizedOrganizationId,
      normalizedBatchId
    );
    if (!currentReceipt && !legacyReceipt) {
      throw new CustomerImportError(
        "failed-precondition",
        "Import receipt does not describe this customer batch."
      );
    }
    if (receipt.status === "rolled_back") {
      return customerImportRollbackResultFromReceipt(receipt);
    }
    if (receipt.status !== "completed") {
      throw new CustomerImportError(
        "failed-precondition",
        "Customer import is not eligible for rollback."
      );
    }
    const createdRecords = Array.isArray(receipt.createdRecords) ? receipt.createdRecords : [];
    if (createdRecords.length > CUSTOMER_IMPORT_MAX_RECORDS) {
      throw new CustomerImportError(
        "resource-exhausted",
        "Customer import receipt exceeds the safe rollback limit."
      );
    }
    if (createdRecords.some((entry) => (
      customerImportText(entry?.collection, 80) !== "customers"
      || !/^[^/]{1,500}$/.test(customerImportText(entry?.id, 500))
      || (
        customerImportText(entry?.emailClaimId, 500)
        && !/^[^/]{1,500}$/.test(customerImportText(entry.emailClaimId, 500))
      )
      || (
        customerImportText(entry?.emailKey, 254)
        && customerImportText(entry?.emailClaimId, 500)
          !== customerEmailClaimDocumentId(entry.emailKey)
      )
    ))) {
      throw new CustomerImportError(
        "failed-precondition",
        "Customer import receipt contains an invalid record target."
      );
    }

    const recordSnapshots = await Promise.all(createdRecords.map((entry) => (
      transaction.get(customerCollectionRef.doc(customerImportText(entry.id, 500)))
    )));
    const claimRefs = recordSnapshots.map((snapshot, index) => {
      if (!snapshot.exists) return null;
      const data = snapshot.data() || {};
      const emailKey = normalizeEmail(data.emailKey || data.email);
      if (!emailKey) return null;
      const claimId = customerEmailClaimDocumentId(emailKey);
      const receiptClaimId = customerImportText(createdRecords[index]?.emailClaimId, 500);
      if (receiptClaimId && receiptClaimId !== claimId) {
        throw new CustomerImportError(
          "failed-precondition",
          "Customer import receipt email claim no longer matches its customer record."
        );
      }
      return customerEmailClaimCollectionRef.doc(claimId);
    });
    const claimSnapshots = await Promise.all(claimRefs.map((claimRef) => (
      claimRef ? transaction.get(claimRef) : Promise.resolve(null)
    )));
    const protectedRecords = [];
    let deletedCount = 0;
    let missingCount = 0;
    createdRecords.forEach((entry, index) => {
      const snapshot = recordSnapshots[index];
      const id = customerImportText(entry.id, 500);
      if (!snapshot.exists) {
        missingCount += 1;
        return;
      }
      const data = snapshot.data() || {};
      const baselineHash = customerImportText(entry.baselineHash, 128);
      const currentRecordUnchanged = currentReceipt
        && data.organizationId === normalizedOrganizationId
        && data.customerId === id
        && data.importSource === CUSTOMER_IMPORT_SOURCE
        && data.importBatchId === normalizedBatchId
        && baselineHash.length === 64
        && data.importBaselineHash === baselineHash
        && customerImportBaselineHash(data) === baselineHash;
      const legacyRecordUnchanged = legacyReceipt
        && data.organizationId === normalizedOrganizationId
        && legacyCustomerImportRecordUnchanged(data, normalizedBatchId);
      if (!currentRecordUnchanged && !legacyRecordUnchanged) {
        protectedRecords.push({ collection: "customers", id, reason: "record_modified" });
        return;
      }
      const claimRef = claimRefs[index];
      const claimSnapshot = claimSnapshots[index];
      const expectedClaimId = customerImportText(entry.emailClaimId, 500);
      if (expectedClaimId && !claimSnapshot?.exists) {
        protectedRecords.push({ collection: "customers", id, reason: "email_claim_missing" });
        return;
      }
      if (claimSnapshot?.exists) {
        const emailKey = normalizeEmail(data.emailKey || data.email);
        let claimBinding;
        try {
          claimBinding = readCustomerEmailClaim(
            claimSnapshot,
            normalizedOrganizationId,
            emailKey
          );
        } catch {
          protectedRecords.push({ collection: "customers", id, reason: "email_claim_modified" });
          return;
        }
        const claimData = claimBinding?.data || {};
        const claimOwnedByImport = claimBinding?.customerId === id
          && claimData.createdBySource === CUSTOMER_IMPORT_SOURCE
          && claimData.importBatchId === normalizedBatchId;
        if (!claimOwnedByImport) {
          protectedRecords.push({ collection: "customers", id, reason: "email_claim_modified" });
          return;
        }
        transaction.delete(claimRef);
      }
      transaction.delete(snapshot.ref);
      deletedCount += 1;
    });

    transaction.set(receiptRef, {
      status: "rolled_back",
      rolledBackCount: deletedCount,
      rollbackProtectedCount: protectedRecords.length,
      rollbackMissingCount: missingCount,
      rollbackProtectedRecords: protectedRecords,
      rolledBackAtISO: nowISO,
      rolledBackAt: FieldValue.serverTimestamp(),
      rollbackActor: {
        uid: customerImportText(actorUid, 160),
        email: normalizeEmail(actorEmail)
      },
      updatedAtISO: nowISO,
      updatedAt: FieldValue.serverTimestamp(),
      rollbackError: FieldValue.delete()
    }, { merge: true });
    return customerImportRollbackResultFromReceipt({
      ...receipt,
      status: "rolled_back",
      rolledBackCount: deletedCount,
      rollbackProtectedCount: protectedRecords.length,
      rollbackMissingCount: missingCount,
      rollbackProtectedRecords: protectedRecords
    }, { idempotentReplay: false });
  });
}

function toCustomerImportHttpsError(error, fallbackMessage) {
  if (error instanceof CustomerImportError) {
    return new functions.https.HttpsError(error.code, error.message, error.details);
  }
  if (error instanceof QuoteCreationError) {
    return new functions.https.HttpsError(error.code, error.message);
  }
  functions.logger.error(fallbackMessage, {
    error: normalizeText(error?.message)
  });
  return new functions.https.HttpsError("internal", fallbackMessage);
}

exports.createCustomerImportBatch = functions.region(REGION).https.onCall(async (data, context) => {
  const organizationId = normalizeOrganizationId(data?.organizationId);
  const staff = assertAdminStaff(await assertStaff(context, {
    expectedOrganizationId: organizationId
  }));
  try {
    return await createCustomerImportBatchInternal({
      organizationId: staff.organizationId,
      organizationName: data?.organizationName,
      fileName: data?.fileName,
      records: data?.records,
      importBatchId: data?.importBatchId,
      actorUid: staff.uid,
      actorEmail: staff.email
    });
  } catch (error) {
    throw toCustomerImportHttpsError(error, "Failed to import customer records.");
  }
});

exports.rollbackCustomerImportBatch = functions.region(REGION).https.onCall(async (data, context) => {
  const organizationId = normalizeOrganizationId(data?.organizationId);
  const staff = assertAdminStaff(await assertStaff(context, {
    expectedOrganizationId: organizationId
  }));
  try {
    return await rollbackCustomerImportBatchInternal({
      organizationId: staff.organizationId,
      importBatchId: data?.importBatchId,
      actorUid: staff.uid,
      actorEmail: staff.email
    });
  } catch (error) {
    throw toCustomerImportHttpsError(error, "Failed to roll back customer import.");
  }
});

exports.createCatalogImportBatch = functions.region(REGION).https.onCall(async (data, context) => {
  const organizationId = normalizeOrganizationId(data?.organizationId);
  const staff = assertAdminStaff(await assertStaff(context, {
    expectedOrganizationId: organizationId
  }));
  try {
    return await createCatalogImportBatchInternal({
      db,
      organizationId: staff.organizationId,
      organizationName: data?.organizationName,
      importType: data?.importType,
      fileName: data?.fileName,
      records: data?.records,
      importBatchId: data?.importBatchId,
      expectedCatalogRevision: Number(data?.expectedCatalogRevision),
      actorUid: staff.uid,
      actorEmail: staff.email,
      serverTimestamp: FieldValue.serverTimestamp
    });
  } catch (error) {
    throw toCatalogImportHttpsError(error, "Failed to import catalog records.");
  }
});

exports.rollbackCatalogImportBatch = functions.region(REGION).https.onCall(async (data, context) => {
  const organizationId = normalizeOrganizationId(data?.organizationId);
  const staff = assertAdminStaff(await assertStaff(context, {
    expectedOrganizationId: organizationId
  }));
  try {
    return await rollbackCatalogImportBatchInternal({
      db,
      organizationId: staff.organizationId,
      importBatchId: data?.importBatchId,
      expectedCatalogRevision: Number(data?.expectedCatalogRevision),
      actorUid: staff.uid,
      actorEmail: staff.email,
      serverTimestamp: FieldValue.serverTimestamp
    });
  } catch (error) {
    throw toCatalogImportHttpsError(error, "Failed to roll back catalog import.");
  }
});

exports.applyStarterCatalogPack = functions.region(REGION).https.onCall(async (data, context) => {
  const organizationId = normalizeOrganizationId(data?.organizationId);
  const staff = assertAdminStaff(await assertStaff(context, {
    expectedOrganizationId: organizationId
  }));
  try {
    return await applyStarterCatalogPackInternal({
      db,
      organizationId: staff.organizationId,
      packId: data?.packId,
      packVersion: data?.packVersion,
      replaceStagedPack: data?.replaceStagedPack === true,
      expectedCatalogRevision: Number(data?.expectedCatalogRevision),
      actorUid: staff.uid,
      serverTimestamp: FieldValue.serverTimestamp,
      deleteField: FieldValue.delete
    });
  } catch (error) {
    throw toStarterCatalogHttpsError(error, "Failed to apply starter catalog pack.");
  }
});

exports.confirmCatalogPricing = functions.region(REGION).https.onCall(async (data, context) => {
  const organizationId = normalizeOrganizationId(data?.organizationId);
  const staff = assertAdminStaff(await assertStaff(context, {
    expectedOrganizationId: organizationId
  }));
  try {
    return await confirmCatalogPricingInternal({
      db,
      organizationId: staff.organizationId,
      expectedCatalogRevision: Number(data?.expectedCatalogRevision),
      actorUid: staff.uid,
      actorEmail: staff.email,
      serverTimestamp: FieldValue.serverTimestamp,
      deleteField: FieldValue.delete
    });
  } catch (error) {
    throw toStarterCatalogHttpsError(error, "Failed to confirm catalog pricing.");
  }
});

exports.mutateManagedMenuItemAvailability = functions.region(REGION).https.onCall(async (data, context) => {
  const organizationId = normalizeOrganizationId(data?.organizationId);
  const staff = assertAdminStaff(await assertStaff(context, {
    expectedOrganizationId: organizationId
  }));
  if (
    !organizationId
    || normalizeOrganizationId(staff.principalOrganizationId) !== organizationId
  ) {
    throw new functions.https.HttpsError(
      "permission-denied",
      "Managed menu availability changes require a same-organization admin."
    );
  }
  try {
    return await mutateManagedMenuItemAvailabilityInternal({
      db,
      organizationId,
      itemId: data?.itemId,
      action: data?.action,
      item: data?.item,
      expectedCatalogRevision: Number(data?.expectedCatalogRevision),
      actorUid: staff.uid,
      serverTimestamp: FieldValue.serverTimestamp
    });
  } catch (error) {
    throw toStarterCatalogHttpsError(error, "Failed to change managed menu item availability.");
  }
});

exports.acceptQuoteProposal = functions.region(REGION).https.onCall(async (data, context) => {
  const portalKey = normalizeText(data?.portalKey);
  const signerName = normalizeText(data?.signerName);
  const consentVersion = normalizeText(data?.consentVersion);
  const expectedRevisionId = normalizeText(data?.expectedRevisionId);
  const expectedPortalIssuedAtISO = normalizeText(data?.expectedPortalIssuedAtISO);
  const message = normalizeText(data?.message).slice(0, 1200);
  if (!/^[A-Za-z0-9_-]{20,128}$/.test(portalKey)) {
    throw new functions.https.HttpsError("invalid-argument", "A valid proposal link is required.");
  }
  if (!signerName || !expectedRevisionId || !expectedPortalIssuedAtISO) {
    throw new functions.https.HttpsError(
      "invalid-argument",
      "Signer name and the reviewed proposal revision are required."
    );
  }
  if (consentVersion !== ACCEPTANCE_CONSENT_VERSION) {
    throw new functions.https.HttpsError(
      "failed-precondition",
      "The acceptance terms changed. Reload the proposal before signing."
    );
  }

  try {
    const portalRef = db.collection(PORTAL_COLLECTION).doc(portalKey);
    const result = await db.runTransaction(async (tx) => {
      const portalSnap = await tx.get(portalRef);
      if (!portalSnap.exists) {
        throw new ProposalAcceptanceError("not-found", "Quote link is invalid or expired.");
      }
      const portal = portalSnap.data() || {};
      const organizationId = normalizeOrganizationId(portal.organizationId);
      const quoteId = normalizeText(portal.quoteId);
      if (!organizationId || !quoteId || normalizeText(portal.portalKey) !== portalKey) {
        throw new ProposalAcceptanceError("permission-denied", "Proposal portal identity is invalid.");
      }

      const organizationRef = db.collection(ORGANIZATIONS_COLLECTION).doc(organizationId);
      const tombstoneRef = db.collection(ORGANIZATION_TOMBSTONES_COLLECTION).doc(organizationId);
      const quoteRef = getQuoteDocRef(quoteId, organizationId);
      const roleRef = context?.auth?.uid
        ? db.collection(ROLES_COLLECTION).doc(context.auth.uid)
        : null;
      const reads = [
        tx.get(organizationRef),
        tx.get(tombstoneRef),
        tx.get(quoteRef)
      ];
      if (roleRef) reads.push(tx.get(roleRef));
      const [organizationSnap, tombstoneSnap, quoteSnap, roleSnap] = await Promise.all(reads);
      if (!organizationSnap.exists || tombstoneSnap.exists || !isOrganizationRecordActive(organizationSnap.data())) {
        throw new ProposalAcceptanceError("failed-precondition", "Quote link is invalid or expired.");
      }
      if (!quoteSnap.exists) {
        throw new ProposalAcceptanceError("not-found", "Quote link is invalid or expired.");
      }
      if (roleSnap?.exists && STAFF_ROLES.has(normalizeRole(roleSnap.data()?.role))) {
        throw new ProposalAcceptanceError(
          "permission-denied",
          "Staff accounts cannot sign through the customer proposal portal."
        );
      }
      const quote = quoteSnap.data() || {};
      if (matchesAcceptanceRetry({
        quote,
        portal,
        signerName,
        consentVersion,
        expectedRevisionId,
        expectedPortalIssuedAtISO
      })) {
        return {
          organizationId,
          quoteId,
          status: "accepted",
          portalDecision: quote.portalDecision,
          acceptanceReceipt: quote.acceptanceReceipt,
          idempotent: true
        };
      }

      const acceptedAtISO = new Date().toISOString();
      const receiptId = `acceptance-${randomUUID()}`;
      const plan = planProposalAcceptance({
        quoteId,
        quote,
        portal,
        portalKey,
        signerName,
        consentVersion,
        expectedRevisionId,
        expectedPortalIssuedAtISO,
        message,
        acceptedAtISO,
        receiptId,
        actor: {
          uid: context?.auth?.uid || "",
          email: context?.auth?.token?.email || ""
        }
      });
      const receiptRef = organizationRef
        .collection(PROPOSAL_ACCEPTANCE_RECEIPTS_COLLECTION)
        .doc(receiptId);
      tx.update(quoteRef, {
        ...plan.quotePatch,
        updatedAt: FieldValue.serverTimestamp()
      });
      tx.update(portalRef, {
        ...plan.portalPatch,
        updatedAt: FieldValue.serverTimestamp()
      });
      tx.create(receiptRef, {
        ...plan.receiptDocument,
        createdAt: FieldValue.serverTimestamp()
      });
      return {
        organizationId,
        quoteId,
        status: plan.status,
        portalDecision: plan.portalDecision,
        acceptanceReceipt: plan.acceptanceReceipt,
        idempotent: false
      };
    });

    return {
      ok: true,
      storage: "firebase",
      ...result
    };
  } catch (error) {
    if (error instanceof functions.https.HttpsError) throw error;
    if (error instanceof ProposalAcceptanceError) {
      throw new functions.https.HttpsError(error.code, error.message);
    }
    functions.logger.error("Proposal acceptance failed", {
      expectedRevisionId,
      error: normalizeText(error?.message)
    });
    throw new functions.https.HttpsError(
      "internal",
      "Proposal acceptance could not be recorded. Reload the proposal and try again."
    );
  }
});

exports.recordProductAnalyticsEvents = functions.region(REGION).https.onCall(async (data, context) => {
  const organizationId = normalizeOrganizationId(data?.organizationId);
  const staff = await assertStaff(context, { expectedOrganizationId: organizationId });
  const receivedAtISO = new Date().toISOString();
  let events;
  try {
    events = sanitizeAnalyticsBatch(data?.events, {
      organizationId: staff.organizationId,
      receivedAtISO
    });
  } catch (err) {
    if (err instanceof ProductAnalyticsError) {
      throw new functions.https.HttpsError(err.code, err.message);
    }
    throw err;
  }

  const collection = db.collection(ORGANIZATIONS_COLLECTION)
    .doc(staff.organizationId)
    .collection(PRODUCT_ANALYTICS_COLLECTION);
  const result = await db.runTransaction(async (transaction) => {
    const refs = events.map((event) => collection.doc(event.eventId));
    const snapshots = await transaction.getAll(...refs);
    let accepted = 0;
    snapshots.forEach((snapshot, index) => {
      if (snapshot.exists) return;
      const event = events[index];
      transaction.set(snapshot.ref, {
        ...event,
        actorUid: staff.uid,
        actorRole: staff.role,
        createdAt: FieldValue.serverTimestamp()
      });
      accepted += 1;
    });
    return { accepted, deduplicated: events.length - accepted };
  });
  return { ok: true, ...result };
});

exports.getProductAnalyticsSummary = functions.region(REGION).https.onCall(async (data, context) => {
  const organizationId = normalizeOrganizationId(data?.organizationId);
  const staff = await assertStaff(context, { expectedOrganizationId: organizationId });
  const requestedDays = Math.round(Number(data?.days || 30));
  const days = Math.min(90, Math.max(7, Number.isFinite(requestedDays) ? requestedDays : 30));
  const cutoffISO = new Date(Date.now() - days * 24 * 60 * 60 * 1000).toISOString();
  const snapshot = await db.collection(ORGANIZATIONS_COLLECTION)
    .doc(staff.organizationId)
    .collection(PRODUCT_ANALYTICS_COLLECTION)
    .where("receivedAtISO", ">=", cutoffISO)
    .orderBy("receivedAtISO", "desc")
    .limit(2500)
    .get();
  return {
    ok: true,
    source: "firebase",
    days,
    sampledEvents: snapshot.size,
    ...summarizeAnalyticsEvents(snapshot.docs.map((doc) => doc.data()))
  };
});

exports.getOperationsAuditSnapshot = functions.region(REGION).https.onCall(async (data, context) => {
  const organizationId = normalizeOrganizationId(data?.organizationId);
  const staff = assertAdminStaff(await assertStaff(context, { expectedOrganizationId: organizationId }));
  const organizationRef = db.collection(ORGANIZATIONS_COLLECTION).doc(staff.organizationId);
  const [quotesSnap, executionsSnap, rolesSnap, settingsSnap] = await Promise.all([
    organizationRef.collection(QUOTES_COLLECTION).limit(500).get(),
    organizationRef.collection(QUOTE_APPROVAL_EXECUTIONS_COLLECTION).limit(200).get(),
    db.collection(ROLES_COLLECTION).where("organizationId", "==", staff.organizationId).limit(200).get(),
    organizationRef.collection("settings").doc("config").get()
  ]);
  return {
    ok: true,
    source: "firebase",
    organizationId: staff.organizationId,
    sampledQuotes: quotesSnap.size,
    sampledExecutions: executionsSnap.size,
    ...buildOperationsAuditSnapshot({
      quotes: quotesSnap.docs.map((doc) => ({ id: doc.id, ...doc.data() })),
      executions: executionsSnap.docs.map((doc) => ({ id: doc.id, ...doc.data() })),
      roles: rolesSnap.docs.map((doc) => ({ uid: doc.id, ...doc.data() })),
      settings: settingsSnap.exists ? settingsSnap.data() : {},
      nowISO: new Date().toISOString()
    })
  };
});

exports.calculateQuotePricing = functions.region(REGION).https.onCall(async (data, context) => {
  const staff = await assertStaff(context);
  const actorEmail = normalizeEmail(context?.auth?.token?.email || "");
  const calculatedAtISO = new Date().toISOString();
  const pricingStaff = {
    ...staff,
    email: actorEmail
  };

  try {
    const result = await calculateQuotePricingAuthoritative({
      db,
      data,
      staff: pricingStaff,
      organizationsCollection: ORGANIZATIONS_COLLECTION,
      nowISO: calculatedAtISO
    });
    const quoteId = normalizeText(data?.pricingInput?.quoteId);
    let changeImpactPreview = null;
    if (quoteId && data?.includeChangeImpactPreview === true) {
      const expectedActiveVersionId = normalizeText(data?.expectedActiveVersionId);
      if (!expectedActiveVersionId) {
        throw new CommercialChangeImpactPreviewError(
          "invalid-argument",
          "The loaded canonical quote revision is required for change-impact preview."
        );
      }
      const sanitized = sanitizeQuoteCreationRequest({
        organizationId: result.organizationId,
        form: data?.pricingInput?.form || data?.form
      });
      const quoteRef = getQuoteDocRef(quoteId, result.organizationId);
      const settingsRef = db
        .collection(ORGANIZATIONS_COLLECTION)
        .doc(result.organizationId)
        .collection("settings")
        .doc("config");
      changeImpactPreview = await db.runTransaction(async (tx) => {
        const [quoteSnap, settingsSnap] = await Promise.all([
          tx.get(quoteRef),
          tx.get(settingsRef)
        ]);
        if (!quoteSnap.exists) {
          throw new CommercialChangeImpactPreviewError(
            "not-found",
            "Quote not found for change-impact preview."
          );
        }
        if (!settingsSnap.exists) {
          throw new CommercialChangeImpactPreviewError(
            "failed-precondition",
            "Pricing settings are unavailable for change-impact preview."
          );
        }
        const currentQuote = quoteSnap.data() || {};
        if (normalizeOrganizationId(currentQuote.organizationId) !== result.organizationId) {
          throw new CommercialChangeImpactPreviewError(
            "permission-denied",
            "Quote is outside this organization."
          );
        }
        assertPricingCatalogAuthorityCurrent(result.catalogAuthority, {
          organizationId: result.organizationId,
          catalogSource: result.catalogSource,
          settings: settingsSnap.data() || {}
        });
        return buildCommercialChangeImpactPreviewSnapshots({
          organizationId: result.organizationId,
          quoteId,
          expectedActiveVersionId,
          currentQuote,
          proposedForm: sanitized.form,
          proposedPricing: result.pricing
        });
      });
    }
    return {
      ok: true,
      organizationId: result.organizationId,
      catalogSource: result.catalogSource,
      pricing: result.pricing,
      ...(changeImpactPreview ? { changeImpactPreview } : {})
    };
  } catch (err) {
    if (
      err instanceof PricingEngineError
      || err instanceof CommercialChangeImpactPreviewError
      || err instanceof QuoteCreationError
    ) {
      throw new functions.https.HttpsError(err.code, err.message);
    }
    functions.logger.error("calculateQuotePricing failed", {
      actorUid: staff.uid,
      organizationId: staff.organizationId,
      error: normalizeText(err?.message)
    });
    throw new functions.https.HttpsError("internal", "Failed to calculate quote pricing.");
  }
});

exports.getPortalRecoveryContact = functions.region(REGION).https.onCall(async (data, context) => {
  const portalKey = normalizeText(data?.portalKey);
  if (!isPortalRecoveryToken(portalKey)) {
    return { ok: true, contact: null };
  }
  if (recordPortalRecoveryAttempt(getRequestIp(context))) {
    throw new functions.https.HttpsError(
      "resource-exhausted",
      "Too many recovery requests. Wait a few minutes and try again."
    );
  }

  return {
    ok: true,
    contact: await resolvePortalRecoveryContact({
      portalKey,
      readPortal: async (key) => {
        const snapshot = await db.collection(PORTAL_COLLECTION).doc(key).get();
        return snapshot.exists ? snapshot.data() || {} : null;
      },
      readOrganization: async (organizationId) => {
        const snapshot = await db.collection(ORGANIZATIONS_COLLECTION).doc(organizationId).get();
        return snapshot.exists ? snapshot.data() || {} : null;
      },
      readSettings: async (organizationId) => {
        const snapshot = await db.collection(ORGANIZATIONS_COLLECTION)
          .doc(organizationId)
          .collection("settings")
          .doc("config")
          .get();
        return snapshot.exists ? snapshot.data() || {} : {};
      },
      isOrganizationActive: isOrganizationRecordActive
    })
  };
});

function customerProjectionDocuments(...snapshots) {
  const byId = new Map();
  for (const snapshot of snapshots) {
    const docs = Array.isArray(snapshot?.docs)
      ? snapshot.docs
      : (snapshot && typeof snapshot.exists === "boolean" ? [snapshot] : []);
    for (const docSnapshot of docs) {
      const id = normalizeText(docSnapshot?.id);
      if (id && !byId.has(id)) byId.set(id, docSnapshot);
    }
  }
  return [...byId.values()].sort((left, right) => (
    String(left?.id || "").localeCompare(String(right?.id || ""))
  ));
}

function customerProjectionEmail(docSnapshot) {
  const data = docSnapshot?.data?.() || {};
  return normalizeEmail(data.emailKey || data.email);
}

function assertCustomerProjectionEmailConsistency(snapshots) {
  for (const docSnapshot of customerProjectionDocuments(...snapshots)) {
    const data = docSnapshot?.data?.() || {};
    const storedEmail = normalizeEmail(data.email);
    const storedEmailKey = normalizeEmail(data.emailKey);
    if (storedEmail && storedEmailKey && storedEmail !== storedEmailKey) {
      throw new QuoteCreationError(
        "failed-precondition",
        "A customer record has conflicting normalized email identity. Repair it before saving the quote."
      );
    }
  }
}

function selectCustomerProjectionDocument(snapshots, customerEmail) {
  const normalizedEmail = normalizeEmail(customerEmail);
  const matches = customerProjectionDocuments(...snapshots)
    .filter((docSnapshot) => customerProjectionEmail(docSnapshot) === normalizedEmail);
  if (matches.length > 1) {
    throw new QuoteCreationError(
      "already-exists",
      "Multiple customer records use this email. Resolve the customer collision before saving the quote."
    );
  }
  return matches[0] || null;
}

function assertNoCustomerProjectionCollision(snapshots, customerEmail, retainedCustomerId) {
  const retainedId = normalizeText(retainedCustomerId);
  const collision = customerProjectionDocuments(...snapshots).find((docSnapshot) => (
    customerProjectionEmail(docSnapshot) === normalizeEmail(customerEmail)
    && normalizeText(docSnapshot.id) !== retainedId
  ));
  if (collision) {
    throw new QuoteCreationError(
      "already-exists",
      "Another customer record already uses this email. Keep the current customer identity or resolve the collision first."
    );
  }
}

function readCustomerEmailClaim(snapshot, organizationId, customerEmail) {
  if (!snapshot?.exists) return null;
  const data = snapshot.data() || {};
  const normalizedOrganizationId = normalizeOrganizationId(organizationId);
  const normalizedEmail = normalizeEmail(customerEmail);
  const customerId = normalizeText(data.customerId);
  const claimOrganizationId = normalizeOrganizationId(data.organizationId);
  const claimEmail = normalizeEmail(data.emailKey || data.email);
  if (
    !/^[^/]{1,500}$/.test(customerId)
    || !claimOrganizationId
    || !claimEmail
    || claimOrganizationId !== normalizedOrganizationId
    || claimEmail !== normalizedEmail
    || normalizeText(snapshot.id) !== customerEmailClaimDocumentId(normalizedEmail)
  ) {
    throw new QuoteCreationError(
      "failed-precondition",
      "Customer email claim identity is inconsistent. Repair it before saving the customer."
    );
  }
  return { customerId, data };
}

function writeCustomerEmailClaim(transaction, claimRef, claim) {
  const data = {
    ...claim.patch,
    updatedAt: FieldValue.serverTimestamp(),
    ...(claim.isNew ? { createdAt: FieldValue.serverTimestamp() } : {})
  };
  if (claim.isNew) {
    transaction.create(claimRef, data);
  } else {
    transaction.set(claimRef, data, { merge: true });
  }
}

function normalizePortalConversationQuoteId(value) {
  const id = normalizeText(value);
  return /^[A-Za-z0-9][A-Za-z0-9_-]{0,159}$/.test(id) ? id : "";
}

function portalConversationRefs(organizationId, quoteId) {
  const quoteRef = getQuoteDocRef(quoteId, organizationId);
  return {
    quoteRef,
    messagesRef: quoteRef.collection(PORTAL_CONVERSATION_MESSAGES_COLLECTION),
    requestsRef: quoteRef.collection(PORTAL_CONVERSATION_REQUESTS_COLLECTION),
    rateLimitsRef: quoteRef.collection(PORTAL_CONVERSATION_RATE_LIMITS_COLLECTION),
    stateRef: quoteRef.collection(PORTAL_CONVERSATION_STATE_COLLECTION).doc("current")
  };
}

function throwPortalConversationFailure(err, operation, binding = {}) {
  if (err instanceof PortalConversationError || err instanceof QuoteDeliveryError) {
    throw new functions.https.HttpsError(err.code, err.message);
  }
  if (err instanceof functions.https.HttpsError) throw err;
  functions.logger.error(`${operation} failed`, {
    organizationId: normalizeOrganizationId(binding?.organizationId),
    quoteId: normalizeText(binding?.quoteId),
    error: normalizeText(err?.message)
  });
  throw new functions.https.HttpsError("internal", "Quote conversation is temporarily unavailable.");
}

async function resolvePortalConversationBinding(input, context) {
  if (input.accessMode === "staff") {
    const staff = await assertStaff(context, {
      expectedOrganizationId: input.organizationId
    });
    if (
      normalizeOrganizationId(staff.organizationId) !== input.organizationId
      || normalizeOrganizationId(staff.principalOrganizationId) !== input.organizationId
    ) {
      throw new PortalConversationError(
        "permission-denied",
        "Quote conversation requires same-organization staff authority."
      );
    }
    const quoteRef = getQuoteDocRef(input.quoteId, input.organizationId);
    const quoteSnap = await quoteRef.get();
    if (!quoteSnap.exists) {
      throw new PortalConversationError("not-found", "Quote conversation was not found.");
    }
    const portalKey = normalizeText(quoteSnap.data()?.portalKey);
    if (!/^[A-Za-z0-9_-]{20,128}$/.test(portalKey)) {
      throw new PortalConversationError(
        "failed-precondition",
        "Deliver the current quote portal before opening its conversation."
      );
    }
    return {
      accessMode: input.accessMode,
      organizationId: input.organizationId,
      quoteId: input.quoteId,
      portalKey,
      staff,
      authToken: context?.auth?.token || {}
    };
  }

  const portalSnap = await db.collection(PORTAL_COLLECTION).doc(input.portalKey).get();
  if (!portalSnap.exists) {
    throw new PortalConversationError("not-found", "Quote conversation was not found.");
  }
  const portal = portalSnap.data() || {};
  const organizationId = normalizeOrganizationId(portal.organizationId);
  const quoteId = normalizePortalConversationQuoteId(portal.quoteId);
  if (!organizationId || !quoteId || normalizeText(portal.portalKey) !== input.portalKey) {
    throw new PortalConversationError("permission-denied", "Quote conversation access is invalid.");
  }
  return {
    accessMode: input.accessMode,
    organizationId,
    quoteId,
    portalKey: input.portalKey,
    staff: null,
    authToken: {}
  };
}

async function readBoundPortalConversationScope({
  binding,
  transaction = null,
  nowISO,
  operation = "read"
} = {}) {
  const refs = portalConversationRefs(binding.organizationId, binding.quoteId);
  const portalRef = db.collection(PORTAL_COLLECTION).doc(binding.portalKey);
  const organizationRef = db.collection(ORGANIZATIONS_COLLECTION).doc(binding.organizationId);
  const tombstoneRef = db.collection(ORGANIZATION_TOMBSTONES_COLLECTION).doc(binding.organizationId);
  const read = (ref) => transaction ? transaction.get(ref) : ref.get();
  const [quoteSnap, portalSnap, organizationSnap, tombstoneSnap] = await Promise.all([
    read(refs.quoteRef),
    read(portalRef),
    read(organizationRef),
    read(tombstoneRef)
  ]);
  if (!quoteSnap.exists || !portalSnap.exists || !organizationSnap.exists) {
    throw new PortalConversationError("not-found", "Quote conversation was not found.");
  }
  const quote = quoteSnap.data() || {};
  const portalSnapshot = portalSnap.data() || {};
  const activation = assertPortalConversationActivation({
    quote,
    quoteId: binding.quoteId,
    organizationId: binding.organizationId,
    portalSnapshot,
    requestedPortalKey: binding.accessMode === "portal" ? binding.portalKey : "",
    organizationActive: isOrganizationRecordActive(organizationSnap.data() || {}),
    organizationTombstoned: tombstoneSnap.exists,
    operation,
    nowISO,
    assertPortalActivation: assertQuoteDeliveryPortalActivation
  });
  const actor = buildPortalConversationActor({
    accessMode: binding.accessMode,
    staff: binding.staff,
    authToken: binding.authToken,
    quote,
    portalSnapshot
  });
  return {
    refs,
    quote,
    portalSnapshot,
    activation,
    actor,
    readOnly: normalizeText(quote.status).toLowerCase() === "declined"
  };
}

function portalConversationResponse(scope, messages, extras = {}) {
  return {
    ok: true,
    organizationId: scope.activation.organizationId,
    quoteId: scope.activation.quoteId,
    portalIssuedAtISO: scope.activation.portalIssuedAtISO,
    readOnly: scope.readOnly,
    readOnlyReason: scope.readOnly
      ? "This proposal was declined. The conversation remains available to read, but new messages are closed."
      : "",
    messages,
    limits: {
      messageBodyCharacters: 1200,
      totalMessages: PORTAL_CONVERSATION_TOTAL_MESSAGE_LIMIT,
      messagesPerWindow: PORTAL_CONVERSATION_RATE_LIMIT,
      rateWindowSeconds: Math.round(PORTAL_CONVERSATION_RATE_WINDOW_MS / 1000)
    },
    ...extras
  };
}

exports.getQuotePortalConversation = functions.region(REGION).https.onCall(async (data, context) => {
  let binding = {};
  try {
    const input = normalizePortalConversationRequest(data);
    binding = await resolvePortalConversationBinding(input, context);
    const nowISO = new Date().toISOString();
    const firstScope = await readBoundPortalConversationScope({ binding, nowISO });
    const messagesSnap = await firstScope.refs.messagesRef
      .orderBy("createdAtMs", "asc")
      .limit(PORTAL_CONVERSATION_TOTAL_MESSAGE_LIMIT)
      .get();
    const messages = messagesSnap.docs
      .map((snapshot) => projectPortalConversationMessage(snapshot.data() || {}))
      .filter(Boolean);

    // A final authorization read prevents a token rotated while the message
    // query was in flight from receiving any quote-scoped history.
    const finalScope = await readBoundPortalConversationScope({ binding, nowISO });
    if (
      finalScope.activation.portalIssuedAtISO !== firstScope.activation.portalIssuedAtISO
      || finalScope.activation.revisionId !== firstScope.activation.revisionId
    ) {
      throw new PortalConversationError(
        "aborted",
        "The customer portal changed while the conversation loaded. Open the current link and try again."
      );
    }
    return portalConversationResponse(finalScope, messages);
  } catch (err) {
    return throwPortalConversationFailure(err, "getQuotePortalConversation", binding);
  }
});

exports.sendQuotePortalConversationMessage = functions.region(REGION).https.onCall(async (data, context) => {
  let binding = {};
  try {
    const input = normalizePortalConversationRequest(data, { requireBody: true });
    binding = await resolvePortalConversationBinding(input, context);
    const nowMs = Date.now();
    const nowISO = new Date(nowMs).toISOString();
    const generatedMessageId = `message_${randomUUID().replace(/-/g, "")}`;
    const result = await db.runTransaction(async (tx) => {
      const scope = await readBoundPortalConversationScope({
        binding,
        transaction: tx,
        nowISO,
        operation: "send"
      });
      const actorRateKey = buildPortalConversationRateKey({
        accessMode: binding.accessMode,
        organizationId: binding.organizationId,
        quoteId: binding.quoteId,
        staffUid: binding.staff?.uid
      });
      const requestKey = buildPortalConversationRequestKey({
        actorRateKey,
        clientRequestId: input.clientRequestId
      });
      const requestRef = scope.refs.requestsRef.doc(requestKey);
      const rateRef = scope.refs.rateLimitsRef.doc(actorRateKey);
      const generatedMessageRef = scope.refs.messagesRef.doc(generatedMessageId);
      const revenuePolicyRef = db.collection(ORGANIZATIONS_COLLECTION)
        .doc(binding.organizationId)
        .collection(REVENUE_AUTOPILOT_POLICY_COLLECTION)
        .doc("current");
      const [requestSnap, stateSnap, rateSnap, generatedMessageSnap, revenuePolicySnap] = await Promise.all([
        tx.get(requestRef),
        tx.get(scope.refs.stateRef),
        tx.get(rateRef),
        tx.get(generatedMessageRef),
        tx.get(revenuePolicyRef)
      ]);
      const portalKeySha256 = portalConversationSha256(scope.activation.portalKey);
      const bodySha256 = portalConversationSha256(input.body);

      if (requestSnap.exists) {
        const request = requestSnap.data() || {};
        if (
          normalizeText(request.organizationId) !== binding.organizationId
          || normalizeText(request.quoteId) !== binding.quoteId
          || normalizeText(request.actorRateKey) !== actorRateKey
          || normalizeText(request.bodySha256) !== bodySha256
          || normalizeText(request.portalKeySha256) !== portalKeySha256
          || normalizeText(request.portalIssuedAtISO) !== scope.activation.portalIssuedAtISO
        ) {
          throw new PortalConversationError(
            "already-exists",
            "This retry id was already used for a different message or portal issuance."
          );
        }
        const priorMessageId = normalizePortalConversationQuoteId(request.messageId);
        if (!priorMessageId) {
          throw new PortalConversationError(
            "failed-precondition",
            "The prior message receipt is incomplete. Reload the conversation before retrying."
          );
        }
        const priorMessageSnap = await tx.get(scope.refs.messagesRef.doc(priorMessageId));
        const priorMessage = priorMessageSnap.exists
          ? projectPortalConversationMessage(priorMessageSnap.data() || {})
          : null;
        if (!priorMessage) {
          throw new PortalConversationError(
            "failed-precondition",
            "The prior message is unavailable. Reload the conversation before retrying."
          );
        }
        return portalConversationResponse(scope, [priorMessage], {
          message: priorMessage,
          idempotent: true
        });
      }

      if (generatedMessageSnap.exists) {
        throw new PortalConversationError("aborted", "Message identity collided. Retry this message.");
      }
      const state = stateSnap.exists ? stateSnap.data() || {} : {};
      if (stateSnap.exists && (
        normalizeText(state.organizationId) !== binding.organizationId
        || normalizeText(state.quoteId) !== binding.quoteId
      )) {
        throw new PortalConversationError("failed-precondition", "Conversation state binding is invalid.");
      }
      const nextMessageCount = assertPortalConversationTotal(state.messageCount || 0);
      const rate = rateSnap.exists ? rateSnap.data() || {} : {};
      if (rateSnap.exists && (
        normalizeText(rate.organizationId) !== binding.organizationId
        || normalizeText(rate.quoteId) !== binding.quoteId
        || normalizeText(rate.actorRateKey) !== actorRateKey
      )) {
        throw new PortalConversationError("failed-precondition", "Conversation rate binding is invalid.");
      }
      const recentSendAtMs = planPortalConversationRate({
        recentSendAtMs: rate.recentSendAtMs,
        nowMs
      });
      const messageRecord = buildPortalConversationMessage({
        messageId: generatedMessageId,
        organizationId: binding.organizationId,
        quoteId: binding.quoteId,
        activation: scope.activation,
        actor: scope.actor,
        body: input.body,
        nowISO,
        nowMs
      });
      const message = projectPortalConversationMessage(messageRecord);
      let tenantPolicy;
      try {
        tenantPolicy = normalizeRevenueAutopilotTenantPolicy(
          revenuePolicySnap.exists ? revenuePolicySnap.data() || {} : null
        );
      } catch {
        tenantPolicy = dormantRevenueAutopilotTenantPolicy({
          organizationId: binding.organizationId,
          authorityState: "invalid_blocked"
        });
      }
      const storedAttentionPointer = state.revenueAutopilotAttention || {};
      const priorMessageId = normalizeText(
        storedAttentionPointer.messageId
        || (normalizeText(state.latestActorType).toLowerCase() === "customer"
          ? state.latestMessageId
          : "")
      );
      const priorAttentionIdentity = priorMessageId
        ? buildRevenueAutopilotAttentionIdentity({
            organizationId: binding.organizationId,
            quoteId: binding.quoteId,
            messageId: priorMessageId
          })
        : null;
      const latestAttentionIdentity = message.actorType === "customer"
        ? buildRevenueAutopilotAttentionIdentity({
            organizationId: binding.organizationId,
            quoteId: binding.quoteId,
            messageId: generatedMessageId
          })
        : null;
      const attentionCollection = db.collection(ORGANIZATIONS_COLLECTION)
        .doc(binding.organizationId)
        .collection(REVENUE_AUTOPILOT_ATTENTION_COLLECTION);
      const priorAttentionRef = priorAttentionIdentity
        ? attentionCollection.doc(priorAttentionIdentity.attentionId)
        : null;
      const latestAttentionRef = latestAttentionIdentity
        ? attentionCollection.doc(latestAttentionIdentity.attentionId)
        : null;
      const [priorAttentionSnap, latestAttentionSnap] = await Promise.all([
        priorAttentionRef ? tx.get(priorAttentionRef) : Promise.resolve(null),
        latestAttentionRef ? tx.get(latestAttentionRef) : Promise.resolve(null)
      ]);
      const conversationEvidence = {
        conversation: {
          source: "quote_conversation_attention_state",
          organizationId: binding.organizationId,
          quoteId: binding.quoteId,
          latestMessageId: generatedMessageId,
          latestMessageAtISO: nowISO,
          latestActorType: message.actorType,
          staffAcknowledged: {}
        }
      };
      const attentionPlan = planUnreadCustomerReplyAttentionTransition({
        organizationId: binding.organizationId,
        quoteId: binding.quoteId,
        evidence: conversationEvidence,
        global: getRevenueAutopilotGlobalControl(nowISO),
        tenantPolicy,
        activeAttention: priorAttentionSnap?.exists
          ? { attentionId: priorAttentionSnap.id, ...(priorAttentionSnap.data() || {}) }
          : null,
        latestAttention: latestAttentionSnap?.exists
          ? { attentionId: latestAttentionSnap.id, ...(latestAttentionSnap.data() || {}) }
          : null,
        nowISO
      });

      tx.create(generatedMessageRef, {
        ...messageRecord,
        createdAt: Timestamp.fromMillis(nowMs)
      });
      tx.create(requestRef, {
        requestKey,
        organizationId: binding.organizationId,
        quoteId: binding.quoteId,
        actorRateKey,
        bodySha256,
        portalKeySha256,
        portalIssuedAtISO: scope.activation.portalIssuedAtISO,
        messageId: generatedMessageId,
        createdAtISO: nowISO,
        createdAt: Timestamp.fromMillis(nowMs)
      });
      tx.set(rateRef, {
        organizationId: binding.organizationId,
        quoteId: binding.quoteId,
        actorRateKey,
        recentSendAtMs,
        updatedAtISO: nowISO,
        updatedAt: FieldValue.serverTimestamp()
      });
      tx.set(scope.refs.stateRef, {
        organizationId: binding.organizationId,
        quoteId: binding.quoteId,
        messageCount: nextMessageCount,
        latestMessageId: generatedMessageId,
        latestMessageAtISO: nowISO,
        latestActorType: message.actorType,
        ...(attentionPlan.activePointer ? {
          revenueAutopilotAttention: attentionPlan.activePointer
        } : {}),
        updatedAt: FieldValue.serverTimestamp()
      });
      tx.set(scope.refs.quoteRef, {
        conversationSummary: {
          schemaVersion: 1,
          messageCount: nextMessageCount,
          latestMessageId: generatedMessageId,
          latestMessageAtISO: nowISO,
          latestActorType: message.actorType,
          updatedAt: FieldValue.serverTimestamp()
        }
      }, { merge: true });
      for (const attentionUpdate of attentionPlan.updates) {
        tx.set(attentionCollection.doc(attentionUpdate.attentionId), {
          ...attentionUpdate,
          updatedAtISO: nowISO,
          updatedAt: FieldValue.serverTimestamp()
        }, { merge: true });
      }
      if (attentionPlan.create && latestAttentionRef && !latestAttentionSnap?.exists) {
        tx.create(latestAttentionRef, {
          ...attentionPlan.create,
          customerId: normalizeText(scope.quote.customerId),
          quoteLabel: normalizeText(scope.quote.quoteNumber) || binding.quoteId,
          customerLabel: normalizeText(scope.quote.customer?.name),
          receivedAtISO: nowISO,
          updatedAt: FieldValue.serverTimestamp(),
          createdAt: FieldValue.serverTimestamp()
        });
      }
      return portalConversationResponse(scope, [message], {
        message,
        idempotent: false
      });
    });
    return result;
  } catch (err) {
    return throwPortalConversationFailure(err, "sendQuotePortalConversationMessage", binding);
  }
});

const COMMERCIAL_CHANGE_POLICY_VERSION = "commercial-change-policy-v1";
const COMMERCIAL_CHANGE_INVALIDATION_LIMIT = 64;
const COMMERCIAL_DEPENDENCY_STATE_SCHEMA_VERSION = 1;
const COMMERCIAL_CHANGE_GLOBAL_ENFORCEMENT_ENABLED =
  normalizeText(process.env.COMMERCIAL_CHANGE_AUTHORITY_ENABLED).toLowerCase() === "true";

function commercialChangeEnforcementState(settings = {}) {
  const tenantEnabled = settings?.commercialChangeAuthorityEnabled === true;
  return {
    authorityState: COMMERCIAL_CHANGE_GLOBAL_ENFORCEMENT_ENABLED && tenantEnabled
      ? "enforced"
      : "dormant",
    globalEnabled: COMMERCIAL_CHANGE_GLOBAL_ENFORCEMENT_ENABLED,
    tenantEnabled
  };
}

function commercialChangeActor(staff = {}) {
  return {
    uid: normalizeText(staff.uid),
    email: normalizeEmail(staff.email),
    role: normalizeText(staff.role).toLowerCase()
  };
}

function commercialChangeCatalogAuthorityFromSettings(organizationId, settings = {}) {
  return buildPricingCatalogAuthority({
    organizationId,
    catalogSource: "firebase-org",
    settings
  });
}

function commercialChangeTrustedContext({ staff, nowISO, catalogAuthority }) {
  return {
    actor: commercialChangeActor(staff),
    nowISO,
    catalogAuthorityDigest: normalizeText(catalogAuthority?.settingsFingerprintSha256).toLowerCase(),
    policyVersion: COMMERCIAL_CHANGE_POLICY_VERSION
  };
}

function exactCommercialChangeReceiptId(value, kind) {
  const normalized = normalizeText(value).toLowerCase();
  const prefixes = {
    simulation: "ccs",
    authorization: "cca",
    apply: "ccp"
  };
  const prefix = prefixes[kind];
  if (!prefix || !new RegExp(`^${prefix}_[a-f0-9]{48}$`, "u").test(normalized)) {
    throw new functions.https.HttpsError(
      "invalid-argument",
      `A valid commercial change ${kind} receipt id is required.`
    );
  }
  return normalized;
}

function exactCommercialChangeApprovalRequestId(value) {
  const normalized = normalizeText(value).toLowerCase();
  if (!/^change_auth_request_[a-f0-9]{32}$/u.test(normalized)) {
    throw new functions.https.HttpsError(
      "invalid-argument",
      "A valid commercial change approval request identity is required."
    );
  }
  return normalized;
}

function exactCommercialChangeApplyRequestId(value) {
  const normalized = normalizeText(value).toLowerCase();
  if (!/^change_apply_[a-f0-9]{32}$/u.test(normalized)) {
    throw new functions.https.HttpsError(
      "invalid-argument",
      "A valid commercial change apply request identity is required."
    );
  }
  return normalized;
}

function commercialChangeApprovalId(simulationReceiptId) {
  return `ccar_${createHash("sha256")
    .update(`commercial-change-approval|${simulationReceiptId}`)
    .digest("hex")
    .slice(0, 48)}`;
}

function commercialChangeRefs(organizationId, quoteId = "") {
  const organizationRef = db.collection(ORGANIZATIONS_COLLECTION).doc(organizationId);
  return {
    organizationRef,
    settingsRef: organizationRef.collection("settings").doc("config"),
    quoteRef: quoteId
      ? organizationRef.collection(QUOTES_COLLECTION).doc(quoteId)
      : null,
    simulationsRef: organizationRef.collection(COMMERCIAL_CHANGE_SIMULATIONS_COLLECTION),
    authorizationsRef: organizationRef.collection(COMMERCIAL_CHANGE_AUTHORIZATIONS_COLLECTION),
    approvalRequestsRef: organizationRef.collection(COMMERCIAL_CHANGE_APPROVAL_REQUESTS_COLLECTION),
    applyReceiptsRef: organizationRef.collection(COMMERCIAL_CHANGE_APPLY_RECEIPTS_COLLECTION),
    applyOutcomesRef: organizationRef.collection(COMMERCIAL_CHANGE_APPLY_OUTCOMES_COLLECTION),
    reconciliationReceiptsRef: organizationRef
      .collection(COMMERCIAL_CHANGE_RECONCILIATION_RECEIPTS_COLLECTION),
    dependencyStateRef: quoteId
      ? organizationRef.collection(COMMERCIAL_DEPENDENCY_STATE_COLLECTION).doc(quoteId)
      : null,
    invalidationsRef: quoteId
      ? organizationRef
        .collection(COMMERCIAL_DEPENDENCY_STATE_COLLECTION)
        .doc(quoteId)
        .collection(COMMERCIAL_DEPENDENCY_INVALIDATIONS_COLLECTION)
      : null
  };
}

function assertCommercialChangeQuoteScope(quote, organizationId, quoteId) {
  if (!quote || typeof quote !== "object") {
    throw new CommercialChangeAuthorityError("not-found", "Quote not found.");
  }
  if (normalizeOrganizationId(quote.organizationId) !== organizationId) {
    throw new CommercialChangeAuthorityError(
      "permission-denied",
      "Quote is outside your organization."
    );
  }
  if (normalizeText(quote.id) && normalizeText(quote.id) !== quoteId) {
    throw new CommercialChangeAuthorityError(
      "failed-precondition",
      "Canonical quote identity does not match the commercial change scope."
    );
  }
}

function assertCommercialChangeSimulationCurrent({
  simulationReceipt,
  organizationId,
  quoteId,
  quote,
  catalogAuthority,
  nowISO
}) {
  const simulation = commercialChangeAuthority.validateSimulationReceipt(simulationReceipt);
  assertCommercialChangeQuoteScope(quote, organizationId, quoteId);
  if (
    simulation.organizationId !== organizationId
    || simulation.quoteId !== quoteId
  ) {
    throw new CommercialChangeAuthorityError(
      "permission-denied",
      "Commercial change simulation is outside this organization and quote scope."
    );
  }
  if (normalizeText(quote.activeVersionId || quote.versionMeta?.versionId) !== simulation.baseRevisionId) {
    throw new CommercialChangeAuthorityError(
      "aborted",
      "Commercial change simulation is stale and must be regenerated.",
      { driftReason: "quote_revision_changed" }
    );
  }
  if (
    normalizeText(catalogAuthority?.settingsFingerprintSha256).toLowerCase()
      !== simulation.catalogAuthorityDigest
  ) {
    throw new CommercialChangeAuthorityError(
      "aborted",
      "Commercial change simulation is stale and must be regenerated.",
      { driftReason: "catalog_authority_changed" }
    );
  }
  if (simulation.policyVersion !== COMMERCIAL_CHANGE_POLICY_VERSION) {
    throw new CommercialChangeAuthorityError(
      "aborted",
      "Commercial change simulation is stale and must be regenerated.",
      { driftReason: "policy_changed" }
    );
  }
  if (Date.parse(nowISO) > Date.parse(simulation.expiresAtISO)) {
    throw new CommercialChangeAuthorityError(
      "failed-precondition",
      "Commercial change simulation expired. Re-simulate before continuing.",
      { driftReason: "authorization_expired" }
    );
  }
  return simulation;
}

function projectCommercialChangeSimulation(receipt, evaluatedImpact) {
  const receiptImpact = receipt?.impact || {};
  return {
    schemaVersion: normalizeText(evaluatedImpact?.schemaVersion),
    advisory: evaluatedImpact?.advisory === true,
    receiptId: normalizeText(receipt?.receiptId),
    receiptDigest: normalizeText(receipt?.receiptDigest),
    authorizationRequired: receipt?.authorizationRequired === true,
    expiresAtISO: normalizeText(receipt?.expiresAtISO),
    identity: {
      organizationId: normalizeOrganizationId(receipt?.organizationId),
      quoteId: normalizeText(receipt?.quoteId),
      beforeRevisionId: normalizeText(receipt?.baseRevisionId),
      proposedRevisionId: normalizeText(receipt?.proposedRevisionId)
    },
    sources: evaluatedImpact?.sources || {},
    graph: receipt?.graph || {},
    factDiffs: Array.isArray(receipt?.factDiffs) ? receipt.factDiffs : [],
    commercialValues: receipt?.commercialValues || {},
    impact: {
      rootNodeIds: Array.isArray(receiptImpact.rootNodeIds)
        ? receiptImpact.rootNodeIds
        : [],
      dependentNodes: Array.isArray(receiptImpact.dependentNodes)
        ? receiptImpact.dependentNodes.map((node) => ({
          id: normalizeText(node?.nodeId),
          kind: normalizeText(node?.nodeKind),
          distance: Number(node?.distance),
          triggeredBy: Array.isArray(node?.triggeredBy) ? node.triggeredBy : [],
          advisoryClass: normalizeText(node?.classification)
        }))
        : [],
      counts: receiptImpact.counts || { total: 0, review: 0, stale: 0 }
    },
    bounds: evaluatedImpact?.bounds || {},
    boundary: normalizeText(evaluatedImpact?.boundary)
  };
}

function projectCommercialChangeApproval(raw = null) {
  if (!raw || typeof raw !== "object") return null;
  const state = normalizeText(raw.state).toLowerCase();
  if (!["pending", "authorized", "rejected", "expired"].includes(state)) return null;
  return {
    schemaVersion: Number(raw.schemaVersion) || 1,
    authority: "server_projection",
    approvalRequestId: normalizeText(raw.approvalRequestId),
    simulationReceiptId: normalizeText(raw.simulationReceiptId),
    state,
    requestedAtISO: normalizeText(raw.requestedAtISO),
    requestedBy: {
      email: normalizeEmail(raw.requestedBy?.email),
      role: normalizeText(raw.requestedBy?.role).toLowerCase()
    },
    resolvedAtISO: normalizeText(raw.resolvedAtISO),
    resolvedBy: {
      email: normalizeEmail(raw.resolvedBy?.email),
      role: normalizeText(raw.resolvedBy?.role).toLowerCase()
    },
    authorizationReceiptId: normalizeText(raw.authorizationReceiptId),
    expiresAtISO: normalizeText(raw.expiresAtISO)
  };
}

function projectCommercialChangeApplyCommit(applyReceipt = null) {
  const applied = commercialChangeAuthority.validateApplyReceipt(applyReceipt);
  const totalInvalidationCount = Array.isArray(applied.invalidationReceipts)
    ? applied.invalidationReceipts.length
    : 0;
  return {
    authorityState: "enforced",
    applyReceiptId: applied.receiptId,
    state: totalInvalidationCount === 0 ? "READY" : "BLOCKED",
    safeToPublish: totalInvalidationCount === 0,
    openInvalidationCount: totalInvalidationCount,
    totalInvalidationCount
  };
}

function throwCommercialChangeFailure(error, operation, context = {}) {
  if (error instanceof functions.https.HttpsError) throw error;
  if (
    error instanceof CommercialChangeAuthorityError
    || error instanceof CommercialChangeImpactPreviewError
    || error instanceof PricingEngineError
    || error instanceof QuoteCreationError
  ) {
    throw new functions.https.HttpsError(error.code, error.message);
  }
  functions.logger.error(`${operation} failed`, {
    organizationId: normalizeOrganizationId(context.organizationId),
    quoteId: normalizeText(context.quoteId),
    actorUid: normalizeText(context.actorUid),
    error: normalizeText(error?.message).slice(0, 240)
  });
  throw new functions.https.HttpsError(
    "internal",
    "The authoritative commercial change operation did not complete."
  );
}

exports.simulateCommercialQuoteChange = functions.region(REGION).https.onCall(async (data, context) => {
  const organizationId = normalizeOrganizationId(data?.organizationId);
  const quoteId = normalizeText(data?.quoteId);
  const expectedActiveVersionId = normalizeText(data?.expectedActiveVersionId);
  const requestId = normalizeText(data?.requestId).toLowerCase();
  const staff = await assertStaff(context, { expectedOrganizationId: organizationId });
  if (
    !organizationId
    || !quoteId
    || !expectedActiveVersionId
    || normalizeOrganizationId(staff.principalOrganizationId) !== organizationId
  ) {
    throw new functions.https.HttpsError(
      "permission-denied",
      "Commercial change simulation requires same-organization staff authority and exact quote scope."
    );
  }
  try {
    const sanitized = sanitizeQuoteCreationRequest({ organizationId, form: data?.form });
    const nowISO = new Date().toISOString();
    const pricingResult = await calculateQuotePricingAuthoritative({
      db,
      data: {
        organizationId,
        pricingInput: {
          organizationId,
          form: sanitized.form,
          metadata: { source: "commercial_change_simulation", generatedAt: nowISO }
        }
      },
      staff,
      organizationsCollection: ORGANIZATIONS_COLLECTION,
      nowISO
    });
    const refs = commercialChangeRefs(organizationId, quoteId);
    const result = await db.runTransaction(async (tx) => {
      const [quoteSnap, settingsSnap] = await Promise.all([
        tx.get(refs.quoteRef),
        tx.get(refs.settingsRef)
      ]);
      if (!quoteSnap.exists) {
        throw new CommercialChangeAuthorityError("not-found", "Quote not found.");
      }
      if (!settingsSnap.exists) {
        throw new CommercialChangeAuthorityError(
          "failed-precondition",
          "Pricing settings are unavailable for commercial change simulation."
        );
      }
      const quote = { id: quoteSnap.id, ...(quoteSnap.data() || {}) };
      assertCommercialChangeQuoteScope(quote, organizationId, quoteId);
      assertPricingCatalogAuthorityCurrent(pricingResult.catalogAuthority, {
        organizationId,
        catalogSource: pricingResult.catalogSource,
        settings: settingsSnap.data() || {}
      });
      const preview = buildCommercialChangeImpactPreviewSnapshots({
        organizationId,
        quoteId,
        expectedActiveVersionId,
        currentQuote: quote,
        proposedForm: sanitized.form,
        proposedPricing: pricingResult.pricing
      });
      const evaluatedImpact = evaluateCommercialChangeImpact(preview);
      const proposed = commercialChangeAuthority.simulate({
        request: { requestId, organizationId, quoteId, expectedActiveVersionId },
        canonicalQuote: quote,
        proposedForm: sanitized.form,
        proposedPricing: pricingResult.pricing,
        trustedContext: commercialChangeTrustedContext({
          staff,
          nowISO,
          catalogAuthority: pricingResult.catalogAuthority
        })
      });
      const receiptRef = refs.simulationsRef.doc(proposed.receipt.receiptId);
      const existingSnap = await tx.get(receiptRef);
      const planned = existingSnap.exists
        ? commercialChangeAuthority.simulate({
          request: { requestId, organizationId, quoteId, expectedActiveVersionId },
          canonicalQuote: quote,
          proposedForm: sanitized.form,
          proposedPricing: pricingResult.pricing,
          trustedContext: commercialChangeTrustedContext({
            staff,
            nowISO,
            catalogAuthority: pricingResult.catalogAuthority
          }),
          existingReceipt: existingSnap.data()?.receipt
        })
        : proposed;
      if (!existingSnap.exists) {
        tx.create(receiptRef, {
          organizationId,
          quoteId,
          requestId,
          receipt: planned.receipt,
          createdAtISO: planned.receipt.simulatedAtISO,
          createdAt: FieldValue.serverTimestamp()
        });
      }
      return {
        planned,
        evaluatedImpact,
        enforcement: commercialChangeEnforcementState(settingsSnap.data() || {})
      };
    });
    return {
      ok: true,
      storage: "firebase",
      organizationId,
      quoteId,
      idempotent: result.planned.idempotent,
      authorityState: result.enforcement.authorityState,
      simulationReceipt: result.planned.receipt,
      simulation: projectCommercialChangeSimulation(
        result.planned.receipt,
        result.evaluatedImpact
      )
    };
  } catch (error) {
    return throwCommercialChangeFailure(error, "simulateCommercialQuoteChange", {
      organizationId,
      quoteId,
      actorUid: staff.uid
    });
  }
});

exports.requestCommercialQuoteChangeAuthorization = functions.region(REGION).https.onCall(async (data, context) => {
  const organizationId = normalizeOrganizationId(data?.organizationId);
  const quoteId = normalizeText(data?.quoteId);
  const simulationReceiptId = exactCommercialChangeReceiptId(
    data?.simulationReceiptId,
    "simulation"
  );
  const requestId = exactCommercialChangeApprovalRequestId(data?.requestId);
  const staff = await assertStaff(context, { expectedOrganizationId: organizationId });
  if (
    !organizationId
    || !quoteId
    || normalizeOrganizationId(staff.principalOrganizationId) !== organizationId
  ) {
    throw new functions.https.HttpsError(
      "permission-denied",
      "Commercial change approval requests require same-organization staff authority."
    );
  }
  try {
    const refs = commercialChangeRefs(organizationId, quoteId);
    const approvalRequestId = commercialChangeApprovalId(simulationReceiptId);
    const approvalRef = refs.approvalRequestsRef.doc(approvalRequestId);
    const simulationRef = refs.simulationsRef.doc(simulationReceiptId);
    const requestedAtISO = new Date().toISOString();
    const result = await db.runTransaction(async (tx) => {
      const [simulationSnap, quoteSnap, settingsSnap, approvalSnap] = await Promise.all([
        tx.get(simulationRef),
        tx.get(refs.quoteRef),
        tx.get(refs.settingsRef),
        tx.get(approvalRef)
      ]);
      if (!simulationSnap.exists || !quoteSnap.exists || !settingsSnap.exists) {
        throw new CommercialChangeAuthorityError(
          "failed-precondition",
          "The exact current simulation, quote, and pricing settings are required."
        );
      }
      const quote = { id: quoteSnap.id, ...(quoteSnap.data() || {}) };
      const catalogAuthority = commercialChangeCatalogAuthorityFromSettings(
        organizationId,
        settingsSnap.data() || {}
      );
      const simulation = assertCommercialChangeSimulationCurrent({
        simulationReceipt: simulationSnap.data()?.receipt,
        organizationId,
        quoteId,
        quote,
        catalogAuthority,
        nowISO: requestedAtISO
      });
      if (!simulation.authorizationRequired) {
        throw new CommercialChangeAuthorityError(
          "failed-precondition",
          "This change has no governed dependency impact and does not require approval."
        );
      }
      if (approvalSnap.exists) {
        const existing = approvalSnap.data() || {};
        if (
          normalizeText(existing.requestId).toLowerCase() !== requestId
          || normalizeText(existing.simulationReceiptId) !== simulation.receiptId
          || normalizeText(existing.simulationDigest) !== simulation.receiptDigest
        ) {
          throw new CommercialChangeAuthorityError(
            "already-exists",
            "The approval identity is bound to a different request or immutable simulation evidence."
          );
        }
        return { record: existing, idempotent: true };
      }
      const record = {
        schemaVersion: 1,
        authority: "server_authoritative",
        approvalRequestId,
        requestId,
        organizationId,
        quoteId,
        simulationReceiptId: simulation.receiptId,
        simulationDigest: simulation.receiptDigest,
        proposalDigest: simulation.proposalDigest,
        baseRevisionId: simulation.baseRevisionId,
        state: "pending",
        requestedAtISO,
        requestedBy: commercialChangeActor(staff),
        resolvedAtISO: "",
        resolvedBy: null,
        authorizationReceiptId: "",
        expiresAtISO: simulation.expiresAtISO
      };
      tx.create(approvalRef, {
        ...record,
        createdAt: FieldValue.serverTimestamp(),
        updatedAt: FieldValue.serverTimestamp()
      });
      return { record, idempotent: false };
    });
    return {
      ok: true,
      storage: "firebase",
      organizationId,
      quoteId,
      idempotent: result.idempotent,
      approval: projectCommercialChangeApproval(result.record)
    };
  } catch (error) {
    return throwCommercialChangeFailure(error, "requestCommercialQuoteChangeAuthorization", {
      organizationId,
      quoteId,
      actorUid: staff.uid
    });
  }
});

exports.getCommercialQuoteChangeAuthorizationState = functions.region(REGION).https.onCall(async (data, context) => {
  const organizationId = normalizeOrganizationId(data?.organizationId);
  const quoteId = normalizeText(data?.quoteId);
  const simulationReceiptId = exactCommercialChangeReceiptId(
    data?.simulationReceiptId,
    "simulation"
  );
  const staff = await assertStaff(context, { expectedOrganizationId: organizationId });
  if (
    !organizationId
    || !quoteId
    || normalizeOrganizationId(staff.principalOrganizationId) !== organizationId
  ) {
    throw new functions.https.HttpsError(
      "permission-denied",
      "Commercial change authorization state requires same-organization staff authority."
    );
  }
  try {
    const refs = commercialChangeRefs(organizationId, quoteId);
    const approvalRequestId = commercialChangeApprovalId(simulationReceiptId);
    const [simulationSnap, approvalSnap] = await Promise.all([
      refs.simulationsRef.doc(simulationReceiptId).get(),
      refs.approvalRequestsRef.doc(approvalRequestId).get()
    ]);
    if (!simulationSnap.exists) {
      throw new CommercialChangeAuthorityError("not-found", "Commercial change simulation not found.");
    }
    const simulation = commercialChangeAuthority.validateSimulationReceipt(
      simulationSnap.data()?.receipt
    );
    if (simulation.organizationId !== organizationId || simulation.quoteId !== quoteId) {
      throw new CommercialChangeAuthorityError(
        "permission-denied",
        "Commercial change simulation is outside this organization and quote scope."
      );
    }
    return {
      ok: true,
      storage: "firebase",
      organizationId,
      quoteId,
      approval: approvalSnap.exists
        ? projectCommercialChangeApproval(approvalSnap.data() || {})
        : null
    };
  } catch (error) {
    return throwCommercialChangeFailure(error, "getCommercialQuoteChangeAuthorizationState", {
      organizationId,
      quoteId,
      actorUid: staff.uid
    });
  }
});

exports.authorizeCommercialQuoteChange = functions.region(REGION).https.onCall(async (data, context) => {
  const organizationId = normalizeOrganizationId(data?.organizationId);
  const quoteId = normalizeText(data?.quoteId);
  const simulationReceiptId = exactCommercialChangeReceiptId(
    data?.simulationReceiptId,
    "simulation"
  );
  const requestId = normalizeText(data?.requestId).toLowerCase();
  const staff = assertAdminStaff(await assertStaff(context, {
    expectedOrganizationId: organizationId
  }));
  if (
    !organizationId
    || !quoteId
    || normalizeOrganizationId(staff.principalOrganizationId) !== organizationId
  ) {
    throw new functions.https.HttpsError(
      "permission-denied",
      "Commercial change authorization requires same-organization administrator authority."
    );
  }
  try {
    const refs = commercialChangeRefs(organizationId, quoteId);
    const simulationRef = refs.simulationsRef.doc(simulationReceiptId);
    const approvalRequestId = commercialChangeApprovalId(simulationReceiptId);
    const approvalRef = refs.approvalRequestsRef.doc(approvalRequestId);
    const authorizedAtISO = new Date().toISOString();
    const result = await db.runTransaction(async (tx) => {
      const [simulationSnap, quoteSnap, settingsSnap, approvalSnap] = await Promise.all([
        tx.get(simulationRef),
        tx.get(refs.quoteRef),
        tx.get(refs.settingsRef),
        tx.get(approvalRef)
      ]);
      if (!simulationSnap.exists || !quoteSnap.exists || !settingsSnap.exists) {
        throw new CommercialChangeAuthorityError(
          "failed-precondition",
          "The exact current simulation, quote, and pricing settings are required."
        );
      }
      const quote = { id: quoteSnap.id, ...(quoteSnap.data() || {}) };
      const catalogAuthority = commercialChangeCatalogAuthorityFromSettings(
        organizationId,
        settingsSnap.data() || {}
      );
      const simulation = assertCommercialChangeSimulationCurrent({
        simulationReceipt: simulationSnap.data()?.receipt,
        organizationId,
        quoteId,
        quote,
        catalogAuthority,
        nowISO: authorizedAtISO
      });
      const proposed = commercialChangeAuthority.authorize({
        simulationReceipt: simulation,
        request: { requestId, organizationId, quoteId },
        trustedContext: commercialChangeTrustedContext({
          staff,
          nowISO: authorizedAtISO,
          catalogAuthority
        }),
        current: {
          activeRevisionId: normalizeText(quote.activeVersionId || quote.versionMeta?.versionId),
          catalogAuthorityDigest: normalizeText(catalogAuthority.settingsFingerprintSha256),
          policyVersion: COMMERCIAL_CHANGE_POLICY_VERSION
        }
      });
      const authorizationRef = refs.authorizationsRef.doc(proposed.receipt.receiptId);
      const authorizationSnap = await tx.get(authorizationRef);
      const planned = authorizationSnap.exists
        ? commercialChangeAuthority.authorize({
          simulationReceipt: simulation,
          request: { requestId, organizationId, quoteId },
          trustedContext: commercialChangeTrustedContext({
            staff,
            nowISO: authorizedAtISO,
            catalogAuthority
          }),
          current: {
            activeRevisionId: normalizeText(quote.activeVersionId || quote.versionMeta?.versionId),
            catalogAuthorityDigest: normalizeText(catalogAuthority.settingsFingerprintSha256),
            policyVersion: COMMERCIAL_CHANGE_POLICY_VERSION
          },
          existingReceipt: authorizationSnap.data()?.receipt
        })
        : proposed;
      if (!authorizationSnap.exists) {
        tx.create(authorizationRef, {
          organizationId,
          quoteId,
          simulationReceiptId,
          receipt: planned.receipt,
          createdAtISO: planned.receipt.authorizedAtISO,
          createdAt: FieldValue.serverTimestamp()
        });
      }
      if (approvalSnap.exists) {
        const approval = approvalSnap.data() || {};
        if (
          normalizeText(approval.simulationReceiptId) !== simulation.receiptId
          || normalizeText(approval.simulationDigest) !== simulation.receiptDigest
        ) {
          throw new CommercialChangeAuthorityError(
            "failed-precondition",
            "Pending approval does not match the exact simulation."
          );
        }
        tx.update(approvalRef, {
          state: "authorized",
          resolvedAtISO: planned.receipt.authorizedAtISO,
          resolvedBy: commercialChangeActor(staff),
          authorizationReceiptId: planned.receipt.receiptId,
          updatedAt: FieldValue.serverTimestamp()
        });
      }
      return {
        planned,
        approval: approvalSnap.exists
          ? {
            ...(approvalSnap.data() || {}),
            state: "authorized",
            resolvedAtISO: planned.receipt.authorizedAtISO,
            resolvedBy: commercialChangeActor(staff),
            authorizationReceiptId: planned.receipt.receiptId
          }
          : null
      };
    });
    return {
      ok: true,
      storage: "firebase",
      organizationId,
      quoteId,
      idempotent: result.planned.idempotent,
      authorizationReceipt: result.planned.receipt,
      approval: projectCommercialChangeApproval(result.approval)
    };
  } catch (error) {
    return throwCommercialChangeFailure(error, "authorizeCommercialQuoteChange", {
      organizationId,
      quoteId,
      actorUid: staff.uid
    });
  }
});

exports.reconcileCommercialQuoteChangeApplyOutcome = functions.region(REGION).https.onCall(async (data, context) => {
  const organizationId = normalizeOrganizationId(data?.organizationId);
  const quoteId = normalizeText(data?.quoteId);
  const simulationReceiptId = exactCommercialChangeReceiptId(
    data?.simulationReceiptId,
    "simulation"
  );
  const authorizationReceiptId = normalizeText(data?.authorizationReceiptId)
    ? exactCommercialChangeReceiptId(data.authorizationReceiptId, "authorization")
    : "";
  const applyRequestId = exactCommercialChangeApplyRequestId(data?.applyRequestId);
  const expectedBaseRevisionId = normalizeText(data?.expectedBaseRevisionId);
  const staff = await assertStaff(context, { expectedOrganizationId: organizationId });
  if (
    !organizationId
    || !quoteId
    || !expectedBaseRevisionId
    || normalizeOrganizationId(staff.principalOrganizationId) !== organizationId
  ) {
    throw new functions.https.HttpsError(
      "permission-denied",
      "Commercial change apply-outcome reconciliation requires same-organization staff authority and exact quote scope."
    );
  }

  try {
    const refs = commercialChangeRefs(organizationId, quoteId);
    const identity = commercialChangeAuthority.applyIdentity({
      requestId: applyRequestId,
      organizationId,
      quoteId
    });
    const simulationRef = refs.simulationsRef.doc(simulationReceiptId);
    const authorizationRef = authorizationReceiptId
      ? refs.authorizationsRef.doc(authorizationReceiptId)
      : null;
    const applyRef = refs.applyReceiptsRef.doc(identity.applyReceiptId);
    const outcomeRef = refs.applyOutcomesRef.doc(identity.outcomeReceiptId);
    const reconciledAtISO = new Date().toISOString();
    const result = await db.runTransaction(async (tx) => {
      const [simulationSnap, authorizationSnap, applySnap, outcomeSnap, quoteSnap] =
        await Promise.all([
          tx.get(simulationRef),
          authorizationRef ? tx.get(authorizationRef) : Promise.resolve(null),
          tx.get(applyRef),
          tx.get(outcomeRef),
          tx.get(refs.quoteRef)
        ]);
      if (!simulationSnap.exists || !quoteSnap.exists) {
        throw new CommercialChangeAuthorityError(
          "not-found",
          "The exact commercial change simulation or quote is unavailable."
        );
      }
      const quote = { id: quoteSnap.id, ...(quoteSnap.data() || {}) };
      assertCommercialChangeQuoteScope(quote, organizationId, quoteId);
      const simulationReceipt = commercialChangeAuthority.validateSimulationReceipt(
        simulationSnap.data()?.receipt
      );
      if (
        simulationReceipt.organizationId !== organizationId
        || simulationReceipt.quoteId !== quoteId
        || simulationReceipt.receiptId !== simulationReceiptId
        || simulationReceipt.baseRevisionId !== expectedBaseRevisionId
      ) {
        throw new CommercialChangeAuthorityError(
          "failed-precondition",
          "Apply-outcome reconciliation is outside the exact simulation and base revision."
        );
      }
      if (simulationReceipt.simulatedBy?.uid !== staff.uid && staff.role !== "admin") {
        throw new CommercialChangeAuthorityError(
          "permission-denied",
          "Only the simulation requester or an administrator may reconcile this apply outcome."
        );
      }
      if (simulationReceipt.authorizationRequired && !authorizationSnap?.exists) {
        throw new CommercialChangeAuthorityError(
          "failed-precondition",
          "The exact administrator authorization is required to reconcile this apply outcome."
        );
      }
      if (!simulationReceipt.authorizationRequired && authorizationReceiptId) {
        throw new CommercialChangeAuthorityError(
          "failed-precondition",
          "A no-impact apply outcome cannot consume unrelated authorization evidence."
        );
      }

      const applyReceipt = applySnap.exists ? applySnap.data()?.receipt : null;
      if (applyReceipt) {
        const applied = commercialChangeAuthority.validateApplyReceipt(applyReceipt);
        const versionSnap = await tx.get(
          refs.quoteRef.collection("versions").doc(applied.newRevisionId)
        );
        const version = versionSnap.exists ? versionSnap.data() || {} : null;
        if (
          !version
          || normalizeOrganizationId(version.organizationId) !== organizationId
          || normalizeText(version.quoteId) !== quoteId
          || normalizeText(version.versionId) !== applied.newRevisionId
          || normalizeText(version.snapshot?.activeVersionId) !== applied.newRevisionId
        ) {
          throw new CommercialChangeAuthorityError(
            "failed-precondition",
            "The committed apply receipt is missing its exact immutable quote revision."
          );
        }
      }

      const planned = commercialChangeAuthority.reconcileApplyOutcome({
        simulationReceipt,
        authorizationReceipt: authorizationSnap?.exists
          ? authorizationSnap.data()?.receipt
          : null,
        applyReceipt,
        request: {
          requestId: applyRequestId,
          organizationId,
          quoteId,
          simulationReceiptId,
          authorizationReceiptId,
          expectedBaseRevisionId
        },
        trustedContext: {
          actor: commercialChangeActor(staff),
          nowISO: reconciledAtISO
        },
        current: {
          activeRevisionId: normalizeText(
            quote.activeVersionId || quote.versionMeta?.versionId
          )
        },
        existingReceipt: outcomeSnap.exists ? outcomeSnap.data()?.receipt : null
      });
      if (!outcomeSnap.exists) {
        tx.create(outcomeRef, {
          organizationId,
          quoteId,
          requestId: applyRequestId,
          operationId: identity.operationId,
          simulationReceiptId,
          authorizationReceiptId,
          expectedBaseRevisionId,
          state: planned.receipt.state,
          receipt: planned.receipt,
          createdAtISO: planned.receipt.reconciledAtISO,
          createdAt: FieldValue.serverTimestamp()
        });
      }
      return {
        planned,
        commercialChange: applyReceipt
          ? projectCommercialChangeApplyCommit(applyReceipt)
          : null
      };
    });
    return {
      ok: true,
      storage: "firebase",
      organizationId,
      quoteId,
      idempotent: result.planned.idempotent,
      outcomeReceipt: result.planned.receipt,
      commercialChange: result.commercialChange
    };
  } catch (error) {
    return throwCommercialChangeFailure(
      error,
      "reconcileCommercialQuoteChangeApplyOutcome",
      { organizationId, quoteId, actorUid: staff.uid }
    );
  }
});

function commercialChangeDecisionMetadata(invalidation = {}, decisionOpening = null) {
  const directTypes = {
    "artifact.kitchen_beo": "beo_finalization",
    "output.plan.food_quantity": "menu",
    "output.plan.rental_quantity": "rentals",
    "output.plan.staffing_requirement": "staffing"
  };
  const rootTypes = {
    "fact.event.guest_count": "guest_count",
    "fact.selection.menu": "menu",
    "fact.selection.rentals": "rentals",
    "fact.staffing.counts": "staffing"
  };
  const nodeId = normalizeText(invalidation.nodeId);
  const triggeredBy = Array.isArray(invalidation.triggeredBy)
    ? invalidation.triggeredBy.map((value) => normalizeText(value)).filter(Boolean)
    : [];
  const uniqueRootTypes = [...new Set(
    triggeredBy.map((rootNodeId) => rootTypes[rootNodeId]).filter(Boolean)
  )];
  const decisionType = directTypes[nodeId]
    || (uniqueRootTypes.length === 1 ? uniqueRootTypes[0] : "");
  return {
    decisionId: normalizeText(decisionOpening?.decisionId)
      || (decisionType
        ? `dependency-${decisionType}-${normalizeText(invalidation.invalidationId).slice(-24)}`
        : ""),
    decisionType
  };
}

function projectCommercialDependencyInvalidation(raw = {}) {
  const state = normalizeText(raw.state).toLowerCase();
  return {
    invalidationId: normalizeText(raw.invalidationId || raw.id),
    operationId: normalizeText(raw.operationId),
    applyReceiptId: normalizeText(raw.applyReceiptId),
    sourceRevisionId: normalizeText(raw.sourceRevisionId),
    targetRevisionId: normalizeText(raw.targetRevisionId),
    nodeId: normalizeText(raw.nodeId),
    nodeKind: normalizeText(raw.nodeKind),
    classification: normalizeText(raw.classification).toUpperCase(),
    triggeredBy: Array.isArray(raw.triggeredBy)
      ? raw.triggeredBy.map((value) => normalizeText(value)).filter(Boolean).slice(0, 32)
      : [],
    decisionId: normalizeText(raw.decisionId),
    decisionType: normalizeText(raw.decisionType),
    state: ["open", "resolved"].includes(state) ? state : "unknown",
    createdAtISO: normalizeText(raw.createdAtISO),
    resolvedAtISO: normalizeText(raw.resolvedAtISO),
    resolution: normalizeText(raw.resolution),
    resolutionReceiptId: normalizeText(raw.resolutionReceiptId),
    evidenceId: normalizeText(raw.evidenceId)
  };
}

function projectCommercialDependencyState({
  organizationId,
  quoteId,
  quote,
  stateRecord = null,
  invalidationRecords = [],
  observedAtISO,
  truncated = false
}) {
  const base = {
    schemaVersion: 1,
    authority: "server_projection",
    source: "firebase_server_projection",
    organizationId,
    quoteId,
    customerId: normalizeText(quote?.customerId),
    eventDate: normalizeText(quote?.event?.date),
    activeRevisionId: normalizeText(quote?.activeVersionId || quote?.versionMeta?.versionId),
    observedAtISO,
    bounds: {
      invalidationLimit: COMMERCIAL_CHANGE_INVALIDATION_LIMIT,
      invalidationSetComplete: !truncated,
      returnedCount: truncated ? 0 : invalidationRecords.length,
      truncated
    }
  };
  if (truncated) {
    return {
      ...base,
      state: "UNKNOWN",
      safeToPublish: false,
      latestApplyReceiptId: normalizeText(stateRecord?.latestApplyReceiptId),
      totalInvalidationCount: Number(stateRecord?.totalInvalidationCount) || 0,
      openInvalidationCount: Number(stateRecord?.openInvalidationCount) || 0,
      resolvedInvalidationCount: Number(stateRecord?.resolvedInvalidationCount) || 0,
      invalidations: [],
      reasonCodes: ["invalidation_evidence_truncated"]
    };
  }
  if (!stateRecord) {
    const hasUnexpectedEvidence = invalidationRecords.length > 0;
    return {
      ...base,
      state: hasUnexpectedEvidence ? "UNKNOWN" : "NOT_GENERATED",
      // Absence of a governed apply receipt is not affirmative publication
      // authority, even when no orphan invalidations are present.
      safeToPublish: false,
      latestApplyReceiptId: "",
      totalInvalidationCount: invalidationRecords.length,
      openInvalidationCount: invalidationRecords.filter((item) => item.state === "open").length,
      resolvedInvalidationCount: invalidationRecords.filter((item) => item.state === "resolved").length,
      invalidations: hasUnexpectedEvidence ? [] : [],
      reasonCodes: hasUnexpectedEvidence
        ? ["dependency_state_missing"]
        : ["no_governed_change_applied"]
    };
  }
  const projectedInvalidations = invalidationRecords
    .map((item) => projectCommercialDependencyInvalidation(item))
    .sort((left, right) => left.invalidationId.localeCompare(right.invalidationId));
  const openCount = projectedInvalidations.filter((item) => item.state === "open").length;
  const resolvedCount = projectedInvalidations.filter((item) => item.state === "resolved").length;
  const expectedTotal = Number(stateRecord.totalInvalidationCount);
  const complete = Number(stateRecord.schemaVersion) === COMMERCIAL_DEPENDENCY_STATE_SCHEMA_VERSION
    && stateRecord.authority === "server_authoritative"
    && normalizeOrganizationId(stateRecord.organizationId) === organizationId
    && normalizeText(stateRecord.quoteId) === quoteId
    && normalizeText(stateRecord.activeRevisionId) === base.activeRevisionId
    && stateRecord.bounds?.invalidationSetComplete === true
    && Number(stateRecord.bounds?.invalidationLimit) === COMMERCIAL_CHANGE_INVALIDATION_LIMIT
    && Number.isSafeInteger(expectedTotal)
    && expectedTotal === projectedInvalidations.length
    && Number(stateRecord.openInvalidationCount) === openCount
    && Number(stateRecord.resolvedInvalidationCount) === resolvedCount
    && projectedInvalidations.every((item) => item.state !== "unknown");
  if (!complete) {
    return {
      ...base,
      bounds: { ...base.bounds, invalidationSetComplete: false },
      state: "UNKNOWN",
      safeToPublish: false,
      latestApplyReceiptId: normalizeText(stateRecord.latestApplyReceiptId),
      totalInvalidationCount: projectedInvalidations.length,
      openInvalidationCount: openCount,
      resolvedInvalidationCount: resolvedCount,
      invalidations: [],
      reasonCodes: ["dependency_state_incomplete"]
    };
  }
  const safeToPublish = openCount === 0 && stateRecord.safeToPublish === true;
  return {
    ...base,
    state: safeToPublish ? "READY" : "BLOCKED",
    safeToPublish,
    latestApplyReceiptId: normalizeText(stateRecord.latestApplyReceiptId),
    totalInvalidationCount: projectedInvalidations.length,
    openInvalidationCount: openCount,
    resolvedInvalidationCount: resolvedCount,
    invalidations: projectedInvalidations,
    reasonCodes: safeToPublish
      ? ["all_named_dependencies_reconciled"]
      : ["governed_dependencies_unresolved"]
  };
}

async function readCommercialDependencyState({ organizationId, quoteId, observedAtISO }) {
  const refs = commercialChangeRefs(organizationId, quoteId);
  const [quoteSnap, stateSnap, invalidationsSnap] = await Promise.all([
    refs.quoteRef.get(),
    refs.dependencyStateRef.get(),
    refs.invalidationsRef.orderBy(FieldPath.documentId())
      .limit(COMMERCIAL_CHANGE_INVALIDATION_LIMIT + 1)
      .get()
  ]);
  if (!quoteSnap.exists) {
    throw new CommercialChangeAuthorityError("not-found", "Quote not found.");
  }
  const quote = { id: quoteSnap.id, ...(quoteSnap.data() || {}) };
  assertCommercialChangeQuoteScope(quote, organizationId, quoteId);
  const truncated = invalidationsSnap.size > COMMERCIAL_CHANGE_INVALIDATION_LIMIT;
  return projectCommercialDependencyState({
    organizationId,
    quoteId,
    quote,
    stateRecord: stateSnap.exists ? stateSnap.data() || {} : null,
    invalidationRecords: truncated
      ? []
      : invalidationsSnap.docs.map((snapshot) => ({ id: snapshot.id, ...(snapshot.data() || {}) })),
    observedAtISO,
    truncated
  });
}

exports.getCommercialDependencyState = functions.region(REGION).https.onCall(async (data, context) => {
  const organizationId = normalizeOrganizationId(data?.organizationId);
  const quoteId = normalizeText(data?.quoteId);
  const staff = await assertStaff(context, { expectedOrganizationId: organizationId });
  if (
    !organizationId
    || !quoteId
    || normalizeOrganizationId(staff.principalOrganizationId) !== organizationId
  ) {
    throw new functions.https.HttpsError(
      "permission-denied",
      "Commercial dependency state requires same-organization staff authority."
    );
  }
  try {
    return {
      ok: true,
      storage: "firebase",
      organizationId,
      quoteId,
      dependencyState: await readCommercialDependencyState({
        organizationId,
        quoteId,
        observedAtISO: new Date().toISOString()
      })
    };
  } catch (error) {
    return throwCommercialChangeFailure(error, "getCommercialDependencyState", {
      organizationId,
      quoteId,
      actorUid: staff.uid
    });
  }
});

function exactCommercialReconciliationRequestId(value) {
  const requestId = normalizeText(value).toLowerCase();
  if (!/^change_reconcile_[a-f0-9]{32}$/u.test(requestId)) {
    throw new functions.https.HttpsError(
      "invalid-argument",
      "A valid commercial dependency reconciliation request identity is required."
    );
  }
  return requestId;
}

function commercialReconciliationRequestFingerprint({
  organizationId,
  quoteId,
  applyReceiptId,
  invalidationIds,
  resolutionNote
}) {
  return createHash("sha256")
    .update(commercialDependencyGraphCore.canonicalSerialize({
      schemaVersion: "commercial-change-reconciliation-request-v1",
      organizationId,
      quoteId,
      applyReceiptId,
      invalidationIds: [...invalidationIds].sort(),
      resolutionNote: normalizeText(resolutionNote)
    }))
    .digest("hex");
}

function normalizeCommercialInvalidationIds(values) {
  if (
    !Array.isArray(values)
    || !values.length
    || values.length > COMMERCIAL_CHANGE_INVALIDATION_LIMIT
  ) {
    throw new functions.https.HttpsError(
      "invalid-argument",
      "Reconciliation requires a bounded non-empty invalidation set."
    );
  }
  const normalized = values.map((value) => normalizeText(value).toLowerCase());
  if (
    normalized.some((value) => !/^cci_[a-f0-9]{48}$/u.test(value))
    || new Set(normalized).size !== normalized.length
  ) {
    throw new functions.https.HttpsError(
      "invalid-argument",
      "Reconciliation invalidation identities must be unique exact receipts."
    );
  }
  return normalized;
}

function noArtifactEvidence(invalidation, activeRevisionId) {
  return {
    schemaVersion: COMMERCIAL_CHANGE_RECONCILIATION_EVIDENCE_VERSION,
    authority: "server_authoritative",
    evidenceId: `not-generated-${normalizeText(invalidation.nodeId).replace(/[^a-z0-9-]/giu, "-")}-${activeRevisionId}`,
    invalidationId: invalidation.invalidationId,
    nodeId: invalidation.nodeId,
    sourceRevisionId: activeRevisionId,
    resolution: "artifact_not_generated",
    state: "NOT_GENERATED"
  };
}

exports.reconcileCommercialDependencyState = functions.region(REGION).https.onCall(async (data, context) => {
  const organizationId = normalizeOrganizationId(data?.organizationId);
  const quoteId = normalizeText(data?.quoteId);
  const applyReceiptId = exactCommercialChangeReceiptId(data?.applyReceiptId, "apply");
  const requestId = exactCommercialReconciliationRequestId(data?.requestId);
  const invalidationIds = normalizeCommercialInvalidationIds(data?.invalidationIds);
  const resolutionNote = normalizeText(data?.resolutionNote);
  const requestFingerprint = commercialReconciliationRequestFingerprint({
    organizationId,
    quoteId,
    applyReceiptId,
    invalidationIds,
    resolutionNote
  });
  const staff = await assertStaff(context, { expectedOrganizationId: organizationId });
  if (
    !organizationId
    || !quoteId
    || normalizeOrganizationId(staff.principalOrganizationId) !== organizationId
  ) {
    throw new functions.https.HttpsError(
      "permission-denied",
      "Commercial dependency reconciliation requires same-organization staff authority."
    );
  }
  try {
    const refs = commercialChangeRefs(organizationId, quoteId);
    const applyRef = refs.applyReceiptsRef.doc(applyReceiptId);
    const reconciliationRef = refs.reconciliationReceiptsRef.doc(requestId);
    const observedAtISO = new Date().toISOString();
    const result = await db.runTransaction(async (tx) => {
      const [
        quoteSnap,
        stateSnap,
        applySnap,
        reconciliationSnap,
        invalidationsSnap,
        priorReconciliationsSnap
      ] = await Promise.all([
        tx.get(refs.quoteRef),
        tx.get(refs.dependencyStateRef),
        tx.get(applyRef),
        tx.get(reconciliationRef),
        tx.get(refs.invalidationsRef.orderBy(FieldPath.documentId())
          .limit(COMMERCIAL_CHANGE_INVALIDATION_LIMIT + 1)),
        tx.get(refs.reconciliationReceiptsRef
          .where("applyReceiptId", "==", applyReceiptId)
          .limit(COMMERCIAL_CHANGE_INVALIDATION_LIMIT + 1))
      ]);
      if (!quoteSnap.exists || !stateSnap.exists || !applySnap.exists) {
        throw new CommercialChangeAuthorityError(
          "failed-precondition",
          "The exact quote, dependency state, and apply receipt are required."
        );
      }
      if (
        invalidationsSnap.size > COMMERCIAL_CHANGE_INVALIDATION_LIMIT
        || priorReconciliationsSnap.size > COMMERCIAL_CHANGE_INVALIDATION_LIMIT
      ) {
        throw new CommercialChangeAuthorityError(
          "resource-exhausted",
          "Commercial dependency evidence exceeds the bounded complete set."
        );
      }
      const quote = { id: quoteSnap.id, ...(quoteSnap.data() || {}) };
      assertCommercialChangeQuoteScope(quote, organizationId, quoteId);
      const stateRecord = stateSnap.data() || {};
      const applyReceipt = commercialChangeAuthority.validateApplyReceipt(
        applySnap.data()?.receipt
      );
      const activeRevisionId = normalizeText(quote.activeVersionId || quote.versionMeta?.versionId);
      if (
        applyReceipt.organizationId !== organizationId
        || applyReceipt.quoteId !== quoteId
        || applyReceipt.newRevisionId !== activeRevisionId
        || normalizeText(stateRecord.latestApplyReceiptId) !== applyReceipt.receiptId
        || normalizeText(stateRecord.activeRevisionId) !== activeRevisionId
        || stateRecord.bounds?.invalidationSetComplete !== true
      ) {
        throw new CommercialChangeAuthorityError(
          "aborted",
          "Commercial dependency state changed before reconciliation. Reload and retry."
        );
      }
      const allInvalidations = invalidationsSnap.docs.map((snapshot) => ({
        id: snapshot.id,
        ...(snapshot.data() || {})
      }));
      const invalidationById = new Map(allInvalidations.map((item) => [
        normalizeText(item.invalidationId || item.id),
        item
      ]));
      if (reconciliationSnap.exists) {
        const existing = commercialChangeAuthority.validateReconciliationReceipt(
          reconciliationSnap.data()?.receipt
        );
        if (
          existing.organizationId !== organizationId
          || existing.quoteId !== quoteId
          || existing.applyReceiptId !== applyReceiptId
          || normalizeText(reconciliationSnap.data()?.requestFingerprint) !== requestFingerprint
        ) {
          throw new CommercialChangeAuthorityError(
            "already-exists",
            "Reconciliation request identity is bound to different immutable evidence."
          );
        }
        return {
          receipt: existing,
          idempotent: true,
          stateRecord,
          invalidationRecords: allInvalidations
        };
      }
      const requestedInvalidations = invalidationIds.map((invalidationId) => {
        const invalidation = invalidationById.get(invalidationId);
        if (
          !invalidation
          || normalizeText(invalidation.applyReceiptId) !== applyReceiptId
          || normalizeText(invalidation.state).toLowerCase() !== "open"
        ) {
          throw new CommercialChangeAuthorityError(
            "failed-precondition",
            "Each reconciliation target must be an open invalidation from the active apply receipt."
          );
        }
        return invalidation;
      });

      const needsPortal = requestedInvalidations.some((item) => (
        normalizeText(item.nodeId) === "projection.customer_decision_center"
      ));
      const needsKitchenBeo = requestedInvalidations.some((item) => (
        normalizeText(item.nodeId) === "artifact.kitchen_beo"
      ));
      const portalKey = normalizeText(quote.portalKey);
      const [portalSnap, kitchenBeoSnap] = await Promise.all([
        needsPortal && portalKey
          ? tx.get(db.collection(PORTAL_COLLECTION).doc(portalKey))
          : Promise.resolve(null),
        needsKitchenBeo
          ? tx.get(refs.organizationRef.collection(KITCHEN_BEO_ARTIFACTS_COLLECTION).doc(quoteId))
          : Promise.resolve(null)
      ]);
      const evidenceByInvalidationId = {};
      for (const invalidation of requestedInvalidations) {
        const nodeId = normalizeText(invalidation.nodeId);
        if (normalizeText(invalidation.nodeKind) === "output") {
          if (!resolutionNote || resolutionNote.length > 800) {
            throw new CommercialChangeAuthorityError(
              "invalid-argument",
              "Resolving a dependent decision requires a staff note up to 800 characters."
            );
          }
          evidenceByInvalidationId[invalidation.invalidationId] = {
            schemaVersion: COMMERCIAL_CHANGE_RECONCILIATION_EVIDENCE_VERSION,
            authority: "server_authoritative",
            evidenceId: `staff-decision-${requestId}-${invalidation.invalidationId.slice(-16)}`,
            invalidationId: invalidation.invalidationId,
            nodeId,
            sourceRevisionId: activeRevisionId,
            resolution: "decision_resolved",
            state: "RESOLVED"
          };
          continue;
        }
        if (nodeId === "projection.customer_decision_center") {
          const portal = portalSnap?.exists ? portalSnap.data() || {} : null;
          if (
            !portal
            || normalizeOrganizationId(portal.organizationId) !== organizationId
            || normalizeText(portal.quoteId) !== quoteId
            || normalizeText(portal.activeVersionId) !== activeRevisionId
          ) {
            throw new CommercialChangeAuthorityError(
              "failed-precondition",
              "The customer decision-center projection is not current for this quote revision."
            );
          }
          evidenceByInvalidationId[invalidation.invalidationId] = {
            schemaVersion: COMMERCIAL_CHANGE_RECONCILIATION_EVIDENCE_VERSION,
            authority: "server_authoritative",
            evidenceId: `portal-projection-${activeRevisionId}`,
            invalidationId: invalidation.invalidationId,
            nodeId,
            sourceRevisionId: activeRevisionId,
            resolution: "projection_current",
            state: "CURRENT"
          };
          continue;
        }
        if (nodeId === "artifact.kitchen_beo") {
          if (!kitchenBeoSnap?.exists) {
            throw new CommercialChangeAuthorityError(
              "failed-precondition",
              "Generate a current Kitchen BEO before reconciling its invalidation."
            );
          }
          const remainingInvalidations = allInvalidations
            .filter((item) => !invalidationIds.includes(normalizeText(item.invalidationId || item.id)))
            .filter((item) => normalizeText(item.artifactNodeId || item.nodeId) === "artifact.kitchen_beo")
            .map((item) => ({
              id: normalizeText(item.invalidationId || item.id),
              artifactNodeId: normalizeText(item.artifactNodeId || item.nodeId),
              state: normalizeText(item.state),
              classification: normalizeText(item.classification)
            }));
          const status = kitchenBeoAuthority.deriveArtifactStatus({
            canonicalQuote: quote,
            trustedReceipt: kitchenBeoSnap.data()?.latestReceipt || null,
            invalidations: remainingInvalidations,
            sourceState: "available",
            trustedContext: { organizationId, quoteId, nowISO: observedAtISO }
          });
          if (status.state !== KITCHEN_BEO_FRESHNESS_STATES.CURRENT) {
            throw new CommercialChangeAuthorityError(
              "failed-precondition",
              "Generate a current Kitchen BEO before reconciling its invalidation."
            );
          }
          evidenceByInvalidationId[invalidation.invalidationId] = {
            schemaVersion: COMMERCIAL_CHANGE_RECONCILIATION_EVIDENCE_VERSION,
            authority: "server_authoritative",
            evidenceId: normalizeText(kitchenBeoSnap.data()?.latestReceiptId),
            invalidationId: invalidation.invalidationId,
            nodeId,
            sourceRevisionId: activeRevisionId,
            resolution: "artifact_current",
            state: "CURRENT"
          };
          continue;
        }
        if (nodeId === "artifact.contract") {
          if (normalizeText(quote.booking?.contractNumber)) {
            throw new CommercialChangeAuthorityError(
              "failed-precondition",
              "A generated contract needs a revision-bound regeneration receipt before reconciliation."
            );
          }
          evidenceByInvalidationId[invalidation.invalidationId] = noArtifactEvidence(
            invalidation,
            activeRevisionId
          );
          continue;
        }
        if (nodeId === "artifact.production_plan") {
          const hasProductionPlan = Array.isArray(quote.booking?.productionChecklist)
            && quote.booking.productionChecklist.length > 0;
          if (hasProductionPlan) {
            throw new CommercialChangeAuthorityError(
              "failed-precondition",
              "An existing production plan needs a revision-bound regeneration receipt before reconciliation."
            );
          }
          evidenceByInvalidationId[invalidation.invalidationId] = noArtifactEvidence(
            invalidation,
            activeRevisionId
          );
          continue;
        }
        throw new CommercialChangeAuthorityError(
          "failed-precondition",
          `No trusted reconciliation adapter is registered for ${nodeId}.`
        );
      }
      const planned = commercialChangeAuthority.reconcile({
        applyReceipt,
        request: { requestId, organizationId, quoteId, invalidationIds },
        evidenceByInvalidationId,
        priorReconciliationReceipts: priorReconciliationsSnap.docs
          .map((snapshot) => snapshot.data()?.receipt)
          .filter(Boolean),
        trustedContext: {
          actor: commercialChangeActor(staff),
          nowISO: observedAtISO,
          catalogAuthorityDigest: normalizeText(stateRecord.catalogAuthorityDigest),
          policyVersion: COMMERCIAL_CHANGE_POLICY_VERSION
        },
        current: { activeRevisionId }
      });
      const resolutionById = new Map(planned.receipt.resolutions.map((item) => [
        item.invalidationId,
        item
      ]));
      const resolvedBy = commercialChangeActor(staff);
      requestedInvalidations.forEach((invalidation) => {
        const resolution = resolutionById.get(invalidation.invalidationId);
        tx.update(refs.invalidationsRef.doc(invalidation.invalidationId), {
          state: "resolved",
          resolution: normalizeText(resolution?.resolution),
          resolutionReceiptId: planned.receipt.receiptId,
          resolutionReceiptDigest: planned.receipt.receiptDigest,
          evidenceId: normalizeText(resolution?.evidenceId),
          evidenceDigest: normalizeText(resolution?.evidenceDigest),
          resolutionNote,
          resolvedAtISO: observedAtISO,
          resolvedBy,
          updatedAt: FieldValue.serverTimestamp()
        });
      });
      tx.create(reconciliationRef, {
        organizationId,
        quoteId,
        applyReceiptId,
        requestFingerprint,
        receipt: planned.receipt,
        createdAtISO: observedAtISO,
        createdAt: FieldValue.serverTimestamp()
      });
      const nextInvalidations = allInvalidations.map((item) => (
        invalidationIds.includes(normalizeText(item.invalidationId || item.id))
          ? {
            ...item,
            state: "resolved",
            resolution: normalizeText(resolutionById.get(item.invalidationId)?.resolution),
            resolutionReceiptId: planned.receipt.receiptId,
            evidenceId: normalizeText(resolutionById.get(item.invalidationId)?.evidenceId),
            resolvedAtISO: observedAtISO
          }
          : item
      ));
      const openInvalidationCount = nextInvalidations
        .filter((item) => normalizeText(item.state).toLowerCase() === "open")
        .length;
      const nextState = {
        ...stateRecord,
        state: openInvalidationCount === 0 ? "READY" : "BLOCKED",
        safeToPublish: openInvalidationCount === 0,
        openInvalidationCount,
        resolvedInvalidationCount: nextInvalidations.length - openInvalidationCount,
        lastReconciliationReceiptId: planned.receipt.receiptId,
        updatedAtISO: observedAtISO
      };
      tx.update(refs.dependencyStateRef, {
        ...nextState,
        updatedAt: FieldValue.serverTimestamp()
      });
      return {
        receipt: planned.receipt,
        idempotent: planned.idempotent,
        stateRecord: nextState,
        invalidationRecords: nextInvalidations
      };
    });
    return {
      ok: true,
      storage: "firebase",
      organizationId,
      quoteId,
      idempotent: result.idempotent,
      reconciliationReceipt: result.receipt,
      dependencyState: projectCommercialDependencyState({
        organizationId,
        quoteId,
        quote: {
          organizationId,
          customerId: result.stateRecord.customerId,
          event: { date: result.stateRecord.eventDate },
          activeVersionId: result.stateRecord.activeRevisionId
        },
        stateRecord: result.stateRecord,
        invalidationRecords: result.invalidationRecords,
        observedAtISO
      })
    };
  } catch (error) {
    return throwCommercialChangeFailure(error, "reconcileCommercialDependencyState", {
      organizationId,
      quoteId,
      actorUid: staff.uid
    });
  }
});

async function createTrustedQuoteDraftInternal({
  organizationId,
  staff,
  form,
  creationReason = "initial_quote_create",
  sourceQuoteId = "",
  trustedQuoteId = "",
  expectedCustomerId = "",
  expectedCustomerContact = null,
  rebooking = null,
  rebookSourceRequest = null,
  requestedNowISO = ""
}) {
  const sanitized = sanitizeQuoteCreationRequest({
    organizationId,
    form
  });
  const requestedNow = requestedNowISO ? new Date(requestedNowISO) : new Date();
  if (Number.isNaN(requestedNow.getTime())) {
    throw new QuoteCreationError("invalid-argument", "Quote creation timestamp is invalid.");
  }
  const nowISO = requestedNow.toISOString();
  const pricingResult = await calculateQuotePricingAuthoritative({
    db,
    data: {
      organizationId,
      pricingInput: {
        organizationId,
        form: sanitized.form,
        metadata: {
          source: creationReason,
          generatedAt: nowISO
        }
      }
    },
    staff: {
      ...staff,
      email: normalizeEmail(staff.email)
    },
    organizationsCollection: ORGANIZATIONS_COLLECTION,
    nowISO
  });

  const settingsRef = db
    .collection(ORGANIZATIONS_COLLECTION)
    .doc(organizationId)
    .collection("settings")
    .doc("config");
  const organizationRef = db.collection(ORGANIZATIONS_COLLECTION).doc(organizationId);
  const [settingsSnap, organizationSnap] = await Promise.all([
    settingsRef.get(),
    organizationRef.get()
  ]);
  if (!settingsSnap.exists) {
    throw new QuoteCreationError(
      "failed-precondition",
      "Pricing settings must exist before a quote can be created."
    );
  }
  assertPricingCatalogAuthorityCurrent(pricingResult.catalogAuthority, {
    organizationId,
    catalogSource: pricingResult.catalogSource,
    settings: settingsSnap.data() || {}
  });

  const quoteCollectionRef = db
    .collection(ORGANIZATIONS_COLLECTION)
    .doc(organizationId)
    .collection(QUOTES_COLLECTION);
  const normalizedTrustedQuoteId = normalizeText(trustedQuoteId);
  if (normalizedTrustedQuoteId && /[\s/?#\\\u0000]/u.test(normalizedTrustedQuoteId)) {
    throw new QuoteCreationError("invalid-argument", "Trusted quote identity is invalid.");
  }
  const quoteRef = normalizedTrustedQuoteId
    ? quoteCollectionRef.doc(normalizedTrustedQuoteId)
    : quoteCollectionRef.doc();
  const portalKey = randomUUID().replace(/-/g, "");
  const quoteNumber = buildServerQuoteNumber(nowISO, randomUUID());
  const documents = buildTrustedQuoteCreationDocuments({
    quoteId: quoteRef.id,
    quoteNumber,
    portalKey,
    organizationId,
    staff,
    form: sanitized.form,
    pricing: pricingResult.pricing,
    catalogSource: pricingResult.catalogSource,
    settings: {
      ...(settingsSnap.data() || {}),
      organizationName: normalizeText(organizationSnap.data()?.name)
    },
    nowISO,
    creationReason,
    sourceQuoteId,
    rebooking
  });
  const portalRef = db.collection(PORTAL_COLLECTION).doc(portalKey);
  const versionRef = quoteRef.collection("versions").doc(documents.version.versionId);
  const customerCollectionRef = db
    .collection(ORGANIZATIONS_COLLECTION)
    .doc(organizationId)
    .collection("customers");
  const normalizedCustomerEmail = documents.quote.customerEmailKey;
  const customerEmailQuery = customerCollectionRef
    .where("email", "==", documents.quote.customer.email)
    .limit(25);
  const customerEmailKeyQuery = customerCollectionRef
    .where("emailKey", "==", normalizedCustomerEmail)
    .limit(25);
  const deterministicCustomerRef = customerCollectionRef.doc(
    customerProjectionDocumentId(normalizedCustomerEmail)
  );
  const generatedCustomerRef = customerCollectionRef.doc();
  const normalizedExpectedCustomerId = normalizeText(expectedCustomerId);
  if (normalizedExpectedCustomerId && /[\s/?#\\\u0000]/u.test(normalizedExpectedCustomerId)) {
    throw new QuoteCreationError("invalid-argument", "Expected customer identity is invalid.");
  }
  const expectedCustomerRef = normalizedExpectedCustomerId
    ? customerCollectionRef.doc(normalizedExpectedCustomerId)
    : null;
  const normalizedRebookSourceRequest = rebookSourceRequest
    ? normalizeRebookQuoteDraftRequest(rebookSourceRequest)
    : null;
  if (
    normalizedRebookSourceRequest
    && (
      normalizedRebookSourceRequest.organizationId !== organizationId
      || normalizeText(sourceQuoteId) !== normalizedRebookSourceRequest.sourceQuoteId
      || normalizeText(rebooking?.sourceQuoteId) !== normalizedRebookSourceRequest.sourceQuoteId
      || normalizeText(rebooking?.sourceVersionId) !== normalizedRebookSourceRequest.sourceVersionId
      || normalizeText(rebooking?.acceptanceReceiptId) !== normalizedRebookSourceRequest.acceptanceReceiptId
    )
  ) {
    throw new QuoteCreationError(
      "failed-precondition",
      "Rebook source request does not match the trusted creation scope."
    );
  }
  const rebookSourceQuoteRef = normalizedRebookSourceRequest
    ? getQuoteDocRef(normalizedRebookSourceRequest.sourceQuoteId, organizationId)
    : null;
  const rebookSourceVersionRef = rebookSourceQuoteRef
    ? rebookSourceQuoteRef.collection("versions").doc(normalizedRebookSourceRequest.sourceVersionId)
    : null;
  const normalizedExpectedCustomerContact = expectedCustomerContact
    && typeof expectedCustomerContact === "object"
    ? {
      name: normalizeText(expectedCustomerContact.name),
      email: normalizeEmail(expectedCustomerContact.emailKey || expectedCustomerContact.email),
      phone: normalizeText(expectedCustomerContact.phone),
      company: normalizeText(expectedCustomerContact.company || expectedCustomerContact.organization)
    }
    : null;
  if (
    normalizedExpectedCustomerContact
    && (
      !normalizedExpectedCustomerId
      || !normalizedExpectedCustomerContact.name
      || !isValidEmail(normalizedExpectedCustomerContact.email)
      || documents.quote.customer.name !== normalizedExpectedCustomerContact.name
      || documents.quote.customer.email !== normalizedExpectedCustomerContact.email
      || documents.quote.customer.phone !== normalizedExpectedCustomerContact.phone
      || documents.quote.customer.organization !== normalizedExpectedCustomerContact.company
    )
  ) {
    throw new QuoteCreationError(
      "failed-precondition",
      "Expected customer contact does not match the trusted quote form."
    );
  }
  const customerEmailClaimRef = organizationRef
    .collection(CUSTOMER_EMAIL_CLAIMS_COLLECTION)
    .doc(customerEmailClaimDocumentId(normalizedCustomerEmail));

  const result = await db.runTransaction(async (tx) => {
    const [
      quoteSnap,
      portalSnap,
      versionSnap,
      customerEmailSnapshot,
      customerEmailKeySnapshot,
      deterministicCustomerSnapshot,
      customerEmailClaimSnapshot,
      expectedCustomerSnapshot,
      rebookSourceQuoteSnapshot,
      rebookSourceVersionSnapshot,
      transactionPricingSettingsSnapshot
    ] = await Promise.all([
      tx.get(quoteRef),
      tx.get(portalRef),
      tx.get(versionRef),
      tx.get(customerEmailQuery),
      tx.get(customerEmailKeyQuery),
      tx.get(deterministicCustomerRef),
      tx.get(customerEmailClaimRef),
      expectedCustomerRef ? tx.get(expectedCustomerRef) : Promise.resolve(null),
      rebookSourceQuoteRef ? tx.get(rebookSourceQuoteRef) : Promise.resolve(null),
      rebookSourceVersionRef ? tx.get(rebookSourceVersionRef) : Promise.resolve(null),
      tx.get(settingsRef)
    ]);
    if (!transactionPricingSettingsSnapshot.exists) {
      throw new QuoteCreationError(
        "failed-precondition",
        "Pricing settings changed before the quote could be committed."
      );
    }
    assertPricingCatalogAuthorityCurrent(pricingResult.catalogAuthority, {
      organizationId,
      catalogSource: pricingResult.catalogSource,
      settings: transactionPricingSettingsSnapshot.data() || {}
    });
    if (quoteSnap.exists || portalSnap.exists || versionSnap.exists) {
      throw new QuoteCreationError(
        "already-exists",
        "A generated quote identity collided. Retry quote creation."
      );
    }
    if (normalizedRebookSourceRequest) {
      if (!rebookSourceQuoteSnapshot?.exists || !rebookSourceVersionSnapshot?.exists) {
        throw new QuoteCreationError(
          "failed-precondition",
          "The reviewed accepted source changed before the rebook draft could be committed."
        );
      }
      const transactionSource = resolveAcceptedRebookSource({
        request: normalizedRebookSourceRequest,
        sourceQuote: {
          id: rebookSourceQuoteSnapshot.id,
          ...(rebookSourceQuoteSnapshot.data() || {})
        },
        sourceVersion: {
          id: rebookSourceVersionSnapshot.id,
          ...(rebookSourceVersionSnapshot.data() || {})
        }
      });
      if (
        transactionSource.customerId !== normalizedExpectedCustomerId
        || transactionSource.sourceEventDate !== normalizeText(rebooking?.sourceEventDate)
        || transactionSource.acceptedAtISO !== normalizeText(rebooking?.sourceAcceptedAtISO)
      ) {
        throw new QuoteCreationError(
          "failed-precondition",
          "The reviewed accepted source no longer matches the rebook draft provenance."
        );
      }
    }
    const claimBinding = readCustomerEmailClaim(
      customerEmailClaimSnapshot,
      organizationId,
      normalizedCustomerEmail
    );
    const initialCustomerSnapshots = [
      customerEmailSnapshot,
      customerEmailKeySnapshot,
      deterministicCustomerSnapshot,
      expectedCustomerSnapshot
    ];
    const knownClaimedCustomerSnapshot = claimBinding
      ? customerProjectionDocuments(...initialCustomerSnapshots)
        .find((snapshot) => snapshot.id === claimBinding.customerId) || null
      : null;
    const claimedCustomerSnapshot = claimBinding && !knownClaimedCustomerSnapshot
      ? await tx.get(customerCollectionRef.doc(claimBinding.customerId))
      : knownClaimedCustomerSnapshot;
    const customerSnapshots = [
      ...initialCustomerSnapshots,
      ...(claimedCustomerSnapshot ? [claimedCustomerSnapshot] : [])
    ];
    assertCustomerProjectionEmailConsistency(customerSnapshots);
    const emailMatchedCustomerDoc = selectCustomerProjectionDocument(
      customerSnapshots,
      normalizedCustomerEmail
    );
    if (claimBinding && !claimedCustomerSnapshot?.exists) {
      throw new QuoteCreationError(
        "failed-precondition",
        "The customer email claim no longer resolves to a customer record."
      );
    }
    if (
      claimBinding
      && customerProjectionEmail(claimedCustomerSnapshot) !== normalizedCustomerEmail
    ) {
      throw new QuoteCreationError(
        "failed-precondition",
        "The claimed customer record no longer matches its normalized email."
      );
    }
    if (normalizedExpectedCustomerId) {
      if (!expectedCustomerSnapshot?.exists) {
        throw new QuoteCreationError(
          "failed-precondition",
          "The reviewed customer identity no longer exists."
        );
      }
      const expectedCustomer = expectedCustomerSnapshot.data() || {};
      const currentExpectedContact = {
        name: normalizeText(expectedCustomer.name),
        email: normalizeEmail(expectedCustomer.emailKey || expectedCustomer.email),
        phone: normalizeText(expectedCustomer.phone),
        company: normalizeText(expectedCustomer.company || expectedCustomer.organization)
      };
      if (
        normalizeOrganizationId(expectedCustomer.organizationId) !== organizationId
        || normalizeText(expectedCustomer.customerId || expectedCustomerSnapshot.id) !== normalizedExpectedCustomerId
        || normalizeEmail(expectedCustomer.emailKey || expectedCustomer.email) !== normalizedCustomerEmail
        || (
          normalizedExpectedCustomerContact
          && JSON.stringify(currentExpectedContact) !== JSON.stringify(normalizedExpectedCustomerContact)
        )
      ) {
        throw new QuoteCreationError(
          "failed-precondition",
          "The reviewed customer identity no longer matches the accepted proposal contact."
        );
      }
      if (claimBinding && claimBinding.customerId !== normalizedExpectedCustomerId) {
        throw new QuoteCreationError(
          "failed-precondition",
          "The customer email claim conflicts with the reviewed customer identity."
        );
      }
    }
    const existingCustomerDoc = normalizedExpectedCustomerId
      ? expectedCustomerSnapshot
      : claimBinding
        ? claimedCustomerSnapshot
        : emailMatchedCustomerDoc;
    assertNoCustomerProjectionCollision(
      customerSnapshots,
      normalizedCustomerEmail,
      existingCustomerDoc?.id || generatedCustomerRef.id
    );
    if (
      deterministicCustomerSnapshot.exists
      && customerProjectionEmail(deterministicCustomerSnapshot) !== normalizedCustomerEmail
    ) {
      throw new QuoteCreationError(
        "failed-precondition",
        "The deterministic customer identity is occupied by a different customer."
      );
    }
    const customerProjection = buildCustomerProjection({
      organizationId,
      quoteId: quoteRef.id,
      quoteNumber,
      customer: documents.quote.customer,
      event: documents.quote.event,
      nowISO,
      existingCustomer: existingCustomerDoc?.data() || null,
      existingCustomerId: existingCustomerDoc?.id || "",
      newCustomerId: generatedCustomerRef.id
    });
    if (
      normalizedExpectedCustomerId
      && customerProjection.customerId !== normalizedExpectedCustomerId
    ) {
      throw new QuoteCreationError(
        "failed-precondition",
        "Trusted quote creation did not preserve the reviewed customer identity."
      );
    }
    const customerRef = customerCollectionRef.doc(customerProjection.customerId);
    const customerEmailClaim = buildCustomerEmailClaim({
      organizationId,
      customerId: customerProjection.customerId,
      customerEmail: normalizedCustomerEmail,
      nowISO,
      existingClaim: claimBinding?.data || null,
      claimSource: "trusted_quote_projection"
    });
    const boundDocuments = bindCustomerIdentityToQuoteDocuments(
      documents,
      customerProjection.customerId
    );

    tx.create(quoteRef, {
      ...boundDocuments.quote,
      createdAt: FieldValue.serverTimestamp(),
      updatedAt: FieldValue.serverTimestamp()
    });
    tx.create(portalRef, {
      ...boundDocuments.portal,
      createdAt: FieldValue.serverTimestamp(),
      updatedAt: FieldValue.serverTimestamp()
    });
    tx.create(versionRef, {
      ...boundDocuments.version,
      createdAt: FieldValue.serverTimestamp()
    });
    writeCustomerEmailClaim(tx, customerEmailClaimRef, customerEmailClaim);
    tx.set(customerRef, {
      ...customerProjection.patch,
      updatedAt: FieldValue.serverTimestamp(),
      ...(customerProjection.isNew
        ? { createdAt: FieldValue.serverTimestamp() }
        : {})
    }, { merge: true });
    return boundDocuments.result;
  });

  return {
    ok: true,
    organizationId,
    storage: "firebase",
    ...result
  };
}

function normalizeCommercialChangeApplyEnvelope(raw = null) {
  if (raw === null || raw === undefined) return null;
  if (!raw || typeof raw !== "object" || Array.isArray(raw)) {
    throw new CommercialChangeAuthorityError(
      "invalid-argument",
      "Commercial change authority must be an exact receipt envelope."
    );
  }
  let applyRequestId;
  try {
    applyRequestId = exactCommercialChangeApplyRequestId(raw.applyRequestId);
  } catch (error) {
    throw new CommercialChangeAuthorityError(
      normalizeText(error?.code).replace(/^functions\//u, "") || "invalid-argument",
      error?.message || "A valid commercial change apply request identity is required."
    );
  }
  return {
    simulationReceiptId: exactCommercialChangeReceiptId(
      raw.simulationReceiptId,
      "simulation"
    ),
    authorizationReceiptId: normalizeText(raw.authorizationReceiptId)
      ? exactCommercialChangeReceiptId(raw.authorizationReceiptId, "authorization")
      : "",
    applyRequestId
  };
}

function implicitCommercialChangeRequestIds(preview = {}) {
  const digest = createHash("sha256")
    .update(commercialDependencyGraphCore.canonicalSerialize({
      schemaVersion: "implicit-commercial-change-request-v1",
      identity: preview.identity
    }))
    .digest("hex");
  return {
    simulationRequestId: `change_sim_${digest.slice(0, 32)}`,
    applyRequestId: `change_apply_${digest.slice(32, 64)}`
  };
}

function persistCommercialChangeApply({
  tx,
  organizationId,
  quoteId,
  customerId,
  eventDate,
  pricingCatalogAuthority,
  nowISO,
  plan
}) {
  if (plan.authorityState !== "enforced") {
    return {
      authorityState: "dormant",
      applyReceiptId: "",
      state: "DORMANT",
      safeToPublish: false,
      openInvalidationCount: 0,
      totalInvalidationCount: 0
    };
  }
  const applyReceipt = plan.apply?.receipt;
  if (!applyReceipt) {
    throw new CommercialChangeAuthorityError(
      "failed-precondition",
      "The server-authoritative apply receipt is unavailable."
    );
  }
  if (plan.persistSimulation) {
    tx.create(plan.simulationRef, {
      organizationId,
      quoteId,
      requestId: plan.simulation.receipt.requestId,
      receipt: plan.simulation.receipt,
      createdAtISO: plan.simulation.receipt.simulatedAtISO,
      createdAt: FieldValue.serverTimestamp()
    });
  }
  if (plan.persistApply) {
    tx.create(plan.applyRef, {
      organizationId,
      quoteId,
      simulationReceiptId: applyReceipt.simulationReceiptId,
      authorizationReceiptId: applyReceipt.authorizationReceiptId,
      receipt: applyReceipt,
      createdAtISO: applyReceipt.appliedAtISO,
      createdAt: FieldValue.serverTimestamp()
    });
  }
  plan.priorInvalidationDocs.forEach((snapshot) => tx.delete(snapshot.ref));
  const decisionOpeningByInvalidationId = new Map(
    (Array.isArray(applyReceipt.decisionOpenings) ? applyReceipt.decisionOpenings : [])
      .map((item) => [normalizeText(item.invalidationId), item])
  );
  const invalidationRecords = applyReceipt.invalidationReceipts.map((invalidation) => {
    const decision = commercialChangeDecisionMetadata(
      invalidation,
      decisionOpeningByInvalidationId.get(invalidation.invalidationId)
    );
    return {
      schemaVersion: 1,
      authority: "server_authoritative",
      organizationId,
      quoteId,
      invalidationId: invalidation.invalidationId,
      operationId: invalidation.operationId,
      applyReceiptId: invalidation.applyReceiptId,
      sourceRevisionId: invalidation.sourceRevisionId,
      targetRevisionId: invalidation.targetRevisionId,
      nodeId: invalidation.nodeId,
      nodeKind: invalidation.nodeKind,
      artifactNodeId: invalidation.nodeKind === "artifact" ? invalidation.nodeId : "",
      classification: invalidation.classification,
      triggeredBy: invalidation.triggeredBy,
      decisionId: decision.decisionId,
      decisionType: decision.decisionType,
      state: "open",
      initialState: invalidation.initialState,
      createdAtISO: invalidation.createdAtISO,
      createdBy: invalidation.createdBy,
      resolution: "",
      resolutionReceiptId: "",
      resolutionReceiptDigest: "",
      evidenceId: "",
      evidenceDigest: "",
      resolvedAtISO: "",
      resolvedBy: null,
      receipt: invalidation
    };
  });
  invalidationRecords.forEach((record) => {
    tx.create(plan.invalidationsRef.doc(record.invalidationId), {
      ...record,
      createdAt: FieldValue.serverTimestamp(),
      updatedAt: FieldValue.serverTimestamp()
    });
  });
  const openInvalidationCount = invalidationRecords.length;
  const dependencyState = {
    schemaVersion: COMMERCIAL_DEPENDENCY_STATE_SCHEMA_VERSION,
    authority: "server_authoritative",
    organizationId,
    quoteId,
    customerId,
    eventDate,
    activeRevisionId: applyReceipt.newRevisionId,
    latestApplyReceiptId: applyReceipt.receiptId,
    latestApplyReceiptDigest: applyReceipt.receiptDigest,
    catalogAuthorityDigest: normalizeText(
      pricingCatalogAuthority.settingsFingerprintSha256
    ),
    policyVersion: COMMERCIAL_CHANGE_POLICY_VERSION,
    graph: applyReceipt.graph,
    state: openInvalidationCount === 0 ? "READY" : "BLOCKED",
    safeToPublish: openInvalidationCount === 0,
    totalInvalidationCount: invalidationRecords.length,
    openInvalidationCount,
    resolvedInvalidationCount: 0,
    bounds: {
      invalidationLimit: COMMERCIAL_CHANGE_INVALIDATION_LIMIT,
      invalidationSetComplete: true
    },
    updatedAtISO: nowISO
  };
  tx.set(plan.dependencyStateRef, {
    ...dependencyState,
    updatedAt: FieldValue.serverTimestamp()
  });
  return {
    authorityState: "enforced",
    applyReceiptId: applyReceipt.receiptId,
    state: dependencyState.state,
    safeToPublish: dependencyState.safeToPublish,
    openInvalidationCount,
    totalInvalidationCount: invalidationRecords.length
  };
}

async function updateTrustedQuoteDraftInternal({
  organizationId,
  quoteId,
  staff,
  form,
  commercialChangeAuthorityInput = null
}) {
  const sanitized = sanitizeQuoteCreationRequest({
    organizationId,
    form
  });
  const nowISO = new Date().toISOString();
  const pricingResult = await calculateQuotePricingAuthoritative({
    db,
    data: {
      organizationId,
      pricingInput: {
        organizationId,
        form: sanitized.form,
        metadata: {
          source: "quote_edit",
          generatedAt: nowISO
        }
      }
    },
    staff: {
      ...staff,
      email: normalizeEmail(staff.email)
    },
    organizationsCollection: ORGANIZATIONS_COLLECTION,
    nowISO
  });
  const settingsRef = db
    .collection(ORGANIZATIONS_COLLECTION)
    .doc(organizationId)
    .collection("settings")
    .doc("config");
  const organizationRef = db.collection(ORGANIZATIONS_COLLECTION).doc(organizationId);
  const [settingsSnap, organizationSnap] = await Promise.all([
    settingsRef.get(),
    organizationRef.get()
  ]);
  if (!settingsSnap.exists) {
    throw new QuoteCreationError(
      "failed-precondition",
      "Pricing settings must exist before a quote can be edited."
    );
  }
  assertPricingCatalogAuthorityCurrent(pricingResult.catalogAuthority, {
    organizationId,
    catalogSource: pricingResult.catalogSource,
    settings: settingsSnap.data() || {}
  });

  const quoteRef = getQuoteDocRef(quoteId, organizationId);
  const result = await db.runTransaction(async (tx) => {
    const [quoteSnap, transactionPricingSettingsSnapshot] = await Promise.all([
      tx.get(quoteRef),
      tx.get(settingsRef)
    ]);
    if (!quoteSnap.exists) {
      throw new QuoteCreationError("not-found", "Quote not found.");
    }
    if (!transactionPricingSettingsSnapshot.exists) {
      throw new QuoteCreationError(
        "failed-precondition",
        "Pricing settings changed before the quote edit could be committed."
      );
    }
    assertPricingCatalogAuthorityCurrent(pricingResult.catalogAuthority, {
      organizationId,
      catalogSource: pricingResult.catalogSource,
      settings: transactionPricingSettingsSnapshot.data() || {}
    });
    const quote = quoteSnap.data() || {};
    if (normalizeOrganizationId(quote.organizationId) !== organizationId) {
      throw new QuoteCreationError(
        "permission-denied",
        "Quote is outside your organization."
      );
    }
    assertQuoteEditNotDispatching({ ...quote, id: quoteId }, nowISO);
    assertNoInProgressPaymentDispatch(quote, "editing the quote");

    const documents = buildTrustedQuoteEditDocuments({
      quoteId,
      quote,
      staff,
      form: sanitized.form,
      pricing: pricingResult.pricing,
      catalogSource: pricingResult.catalogSource,
      settings: {
        ...(transactionPricingSettingsSnapshot.data() || {}),
        organizationName: normalizeText(organizationSnap.data()?.name)
      },
      nowISO
    });
    const enforcement = commercialChangeEnforcementState(
      transactionPricingSettingsSnapshot.data() || {}
    );
    let commercialChangePlan = {
      authorityState: enforcement.authorityState,
      apply: null,
      simulation: null,
      simulationRef: null,
      persistSimulation: false,
      applyRef: null,
      persistApply: false,
      dependencyStateRef: null,
      priorInvalidationDocs: []
    };
    if (enforcement.authorityState === "enforced") {
      const canonicalQuote = { id: quoteId, ...quote };
      const preview = buildCommercialChangeImpactPreviewSnapshots({
        organizationId,
        quoteId,
        expectedActiveVersionId: normalizeText(
          quote.activeVersionId || quote.versionMeta?.versionId
        ),
        currentQuote: canonicalQuote,
        proposedForm: sanitized.form,
        proposedPricing: pricingResult.pricing
      });
      const evaluatedImpact = evaluateCommercialChangeImpact(preview);
      const envelope = normalizeCommercialChangeApplyEnvelope(
        commercialChangeAuthorityInput
      );
      if (evaluatedImpact.impact.counts.total > 0 && !envelope) {
        throw new CommercialChangeAuthorityError(
          "failed-precondition",
          "Simulate this commercial change and obtain administrator authorization before saving."
        );
      }
      const implicitIds = implicitCommercialChangeRequestIds(preview);
      const refs = commercialChangeRefs(organizationId, quoteId);
      const applyOutcomeIdentity = envelope
        ? commercialChangeAuthority.applyIdentity({
          requestId: envelope.applyRequestId,
          organizationId,
          quoteId
        })
        : null;
      const simulationRef = envelope
        ? refs.simulationsRef.doc(envelope.simulationReceiptId)
        : null;
      const [
        suppliedSimulationSnap,
        applyOutcomeSnap,
        dependencyStateSnap,
        priorInvalidationsSnap
      ] = await Promise.all([
        simulationRef ? tx.get(simulationRef) : Promise.resolve(null),
        applyOutcomeIdentity
          ? tx.get(refs.applyOutcomesRef.doc(applyOutcomeIdentity.outcomeReceiptId))
          : Promise.resolve(null),
        tx.get(refs.dependencyStateRef),
        tx.get(refs.invalidationsRef.orderBy(FieldPath.documentId())
          .limit(COMMERCIAL_CHANGE_INVALIDATION_LIMIT + 1))
      ]);
      if (priorInvalidationsSnap.size > COMMERCIAL_CHANGE_INVALIDATION_LIMIT) {
        throw new CommercialChangeAuthorityError(
          "resource-exhausted",
          "Commercial dependency evidence exceeds the bounded complete set."
        );
      }
      const priorInvalidationDocs = priorInvalidationsSnap.docs;
      const priorInvalidations = priorInvalidationDocs.map((snapshot) => ({
        id: snapshot.id,
        ...(snapshot.data() || {})
      }));
      if (applyOutcomeSnap?.exists) {
        const outcome = commercialChangeAuthority.validateApplyOutcomeReceipt(
          applyOutcomeSnap.data()?.receipt
        );
        if (
          outcome.organizationId !== organizationId
          || outcome.quoteId !== quoteId
          || outcome.requestId !== envelope.applyRequestId
          || outcome.operationId !== applyOutcomeIdentity.operationId
          || outcome.simulationReceiptId !== envelope.simulationReceiptId
          || outcome.authorizationReceiptId !== envelope.authorizationReceiptId
        ) {
          throw new CommercialChangeAuthorityError(
            "already-exists",
            "The apply request identity is fenced by different immutable outcome evidence."
          );
        }
        throw new CommercialChangeAuthorityError(
          "failed-precondition",
          outcome.state === "committed"
            ? "This exact commercial change apply already committed; reconcile its outcome instead of submitting it again."
            : "This exact commercial change apply was reconciled as not committed and is permanently fenced. Start a new simulation and apply request."
        );
      }
      const dependencyState = dependencyStateSnap.exists
        ? dependencyStateSnap.data() || {}
        : null;
      if (
        (!dependencyState && priorInvalidations.length > 0)
        || (
          dependencyState
          && (
            Number(dependencyState.schemaVersion) !== COMMERCIAL_DEPENDENCY_STATE_SCHEMA_VERSION
            || dependencyState.authority !== "server_authoritative"
            || normalizeOrganizationId(dependencyState.organizationId) !== organizationId
            || normalizeText(dependencyState.quoteId) !== quoteId
            || normalizeText(dependencyState.activeRevisionId)
              !== normalizeText(quote.activeVersionId || quote.versionMeta?.versionId)
            || dependencyState.bounds?.invalidationSetComplete !== true
            || Number(dependencyState.bounds?.invalidationLimit)
              !== COMMERCIAL_CHANGE_INVALIDATION_LIMIT
            || Number(dependencyState.totalInvalidationCount) !== priorInvalidations.length
            || Number(dependencyState.openInvalidationCount)
              !== priorInvalidations.filter((item) => (
                normalizeText(item.state).toLowerCase() === "open"
              )).length
          )
        )
      ) {
        throw new CommercialChangeAuthorityError(
          "failed-precondition",
          "Commercial dependency state is incomplete and requires repair before another edit."
        );
      }
      if (priorInvalidations.some((item) => normalizeText(item.state).toLowerCase() === "open")) {
        throw new CommercialChangeAuthorityError(
          "failed-precondition",
          "Reconcile the current quote dependency decisions before applying another edit."
        );
      }
      if (priorInvalidations.some((item) => normalizeText(item.state).toLowerCase() !== "resolved")) {
        throw new CommercialChangeAuthorityError(
          "failed-precondition",
          "Commercial dependency evidence contains an unknown state and requires repair."
        );
      }
      const trustedContext = commercialChangeTrustedContext({
        staff,
        nowISO,
        catalogAuthority: pricingResult.catalogAuthority
      });
      let simulationPlan;
      let authoritativeSimulationRef = simulationRef;
      let persistSimulation = false;
      if (envelope) {
        if (!suppliedSimulationSnap?.exists) {
          throw new CommercialChangeAuthorityError(
            "failed-precondition",
            "The exact persisted commercial change simulation is required."
          );
        }
        const existingSimulation = suppliedSimulationSnap.data()?.receipt;
        const validatedSimulation = commercialChangeAuthority.validateSimulationReceipt(
          existingSimulation
        );
        if (
          validatedSimulation.simulatedBy?.uid !== staff.uid
          && staff.role !== "admin"
        ) {
          throw new CommercialChangeAuthorityError(
            "permission-denied",
            "Only the simulation requester or an administrator may apply this change."
          );
        }
        simulationPlan = commercialChangeAuthority.simulate({
          request: {
            requestId: validatedSimulation.requestId,
            organizationId,
            quoteId,
            expectedActiveVersionId: validatedSimulation.baseRevisionId
          },
          canonicalQuote,
          proposedForm: sanitized.form,
          proposedPricing: pricingResult.pricing,
          trustedContext,
          existingReceipt: existingSimulation
        });
      } else {
        simulationPlan = commercialChangeAuthority.simulate({
          request: {
            requestId: implicitIds.simulationRequestId,
            organizationId,
            quoteId,
            expectedActiveVersionId: normalizeText(
              quote.activeVersionId || quote.versionMeta?.versionId
            )
          },
          canonicalQuote,
          proposedForm: sanitized.form,
          proposedPricing: pricingResult.pricing,
          trustedContext
        });
        authoritativeSimulationRef = refs.simulationsRef.doc(
          simulationPlan.receipt.receiptId
        );
        const implicitSimulationSnap = await tx.get(authoritativeSimulationRef);
        if (implicitSimulationSnap.exists) {
          simulationPlan = commercialChangeAuthority.simulate({
            request: {
              requestId: implicitIds.simulationRequestId,
              organizationId,
              quoteId,
              expectedActiveVersionId: normalizeText(
                quote.activeVersionId || quote.versionMeta?.versionId
              )
            },
            canonicalQuote,
            proposedForm: sanitized.form,
            proposedPricing: pricingResult.pricing,
            trustedContext,
            existingReceipt: implicitSimulationSnap.data()?.receipt
          });
        } else {
          persistSimulation = true;
        }
      }
      if (
        simulationPlan.receipt.authorizationRequired
          !== (evaluatedImpact.impact.counts.total > 0)
      ) {
        throw new CommercialChangeAuthorityError(
          "failed-precondition",
          "Server commercial change impact and authorization state do not match."
        );
      }
      let authorizationReceipt = null;
      if (simulationPlan.receipt.authorizationRequired) {
        if (!envelope?.authorizationReceiptId) {
          throw new CommercialChangeAuthorityError(
            "failed-precondition",
            "The exact administrator authorization receipt is required."
          );
        }
        const authorizationSnap = await tx.get(
          refs.authorizationsRef.doc(envelope.authorizationReceiptId)
        );
        if (!authorizationSnap.exists) {
          throw new CommercialChangeAuthorityError(
            "failed-precondition",
            "The exact persisted administrator authorization is required."
          );
        }
        authorizationReceipt = authorizationSnap.data()?.receipt;
      } else if (envelope?.authorizationReceiptId) {
        throw new CommercialChangeAuthorityError(
          "failed-precondition",
          "A no-impact edit must not consume an unrelated authorization receipt."
        );
      }
      const applyRequestId = envelope?.applyRequestId || implicitIds.applyRequestId;
      const applyInput = {
        simulationReceipt: simulationPlan.receipt,
        authorizationReceipt,
        request: {
          requestId: applyRequestId,
          organizationId,
          quoteId,
          newRevisionId: documents.version.versionId
        },
        trustedContext,
        current: {
          activeRevisionId: normalizeText(quote.activeVersionId || quote.versionMeta?.versionId),
          catalogAuthorityDigest: normalizeText(
            pricingResult.catalogAuthority.settingsFingerprintSha256
          ),
          policyVersion: COMMERCIAL_CHANGE_POLICY_VERSION
        }
      };
      let applyPlan = commercialChangeAuthority.buildApply(applyInput);
      const applyRef = refs.applyReceiptsRef.doc(applyPlan.receipt.receiptId);
      const existingApplySnap = await tx.get(applyRef);
      if (existingApplySnap.exists) {
        applyPlan = commercialChangeAuthority.buildApply({
          ...applyInput,
          existingReceipt: existingApplySnap.data()?.receipt
        });
      }
      commercialChangePlan = {
        authorityState: enforcement.authorityState,
        apply: applyPlan,
        simulation: simulationPlan,
        simulationRef: authoritativeSimulationRef,
        persistSimulation,
        applyRef,
        persistApply: !existingApplySnap.exists,
        dependencyStateRef: refs.dependencyStateRef,
        invalidationsRef: refs.invalidationsRef,
        priorInvalidationDocs
      };
    }
    const portalRef = db.collection(PORTAL_COLLECTION).doc(documents.result.portalKey);
    const versionRef = quoteRef
      .collection("versions")
      .doc(documents.version.versionId);
    const customerCollectionRef = db
      .collection(ORGANIZATIONS_COLLECTION)
      .doc(organizationId)
      .collection("customers");
    const desiredCustomerEmail = normalizeEmail(documents.quotePatch.customer.email);
    const sourceCustomerEmail = normalizeEmail(
      quote.customerEmailKey || quote.customer?.email
    );
    if (!sourceCustomerEmail) {
      throw new QuoteCreationError(
        "failed-precondition",
        "The quote needs a valid existing customer email before it can be edited."
      );
    }
    const storedCustomerId = normalizeText(quote.customerId);
    const fallbackCustomerId = customerProjectionDocumentId(sourceCustomerEmail);
    const retainedCustomerId = storedCustomerId || fallbackCustomerId;
    const retainedCustomerRef = customerCollectionRef.doc(retainedCustomerId);
    const customerEmailClaimCollectionRef = organizationRef
      .collection(CUSTOMER_EMAIL_CLAIMS_COLLECTION);
    const sourceCustomerEmailClaimRef = customerEmailClaimCollectionRef.doc(
      customerEmailClaimDocumentId(sourceCustomerEmail)
    );
    const desiredCustomerEmailClaimRef = customerEmailClaimCollectionRef.doc(
      customerEmailClaimDocumentId(desiredCustomerEmail)
    );
    const desiredCustomerEmailQuery = customerCollectionRef
      .where("email", "==", desiredCustomerEmail)
      .limit(25);
    const desiredCustomerEmailKeyQuery = customerCollectionRef
      .where("emailKey", "==", desiredCustomerEmail)
      .limit(25);
    const sourceCustomerEmailQuery = customerCollectionRef
      .where("email", "==", sourceCustomerEmail)
      .limit(25);
    const sourceCustomerEmailKeyQuery = customerCollectionRef
      .where("emailKey", "==", sourceCustomerEmail)
      .limit(25);
    const [
      portalSnap,
      versionSnap,
      retainedCustomerSnapshot,
      desiredCustomerEmailSnapshot,
      desiredCustomerEmailKeySnapshot,
      sourceCustomerEmailSnapshot,
      sourceCustomerEmailKeySnapshot,
      sourceCustomerEmailClaimSnapshot,
      desiredCustomerEmailClaimSnapshot
    ] = await Promise.all([
      tx.get(portalRef),
      tx.get(versionRef),
      tx.get(retainedCustomerRef),
      tx.get(desiredCustomerEmailQuery),
      tx.get(desiredCustomerEmailKeyQuery),
      tx.get(sourceCustomerEmailQuery),
      tx.get(sourceCustomerEmailKeyQuery),
      tx.get(sourceCustomerEmailClaimRef),
      tx.get(desiredCustomerEmailClaimRef)
    ]);
    if (versionSnap.exists) {
      throw new QuoteCreationError(
        "already-exists",
        "The next quote version already exists. Reload the quote before editing."
      );
    }
    if (portalSnap.exists) {
      const portal = portalSnap.data() || {};
      if (
        normalizeText(portal.portalKey) !== documents.result.portalKey
        || normalizeText(portal.quoteId) !== quoteId
        || normalizeOrganizationId(portal.organizationId) !== organizationId
      ) {
        throw new QuoteCreationError(
          "failed-precondition",
          "Existing portal identity does not match this quote."
        );
      }
    }
    const retainedCustomerEmail = retainedCustomerSnapshot.exists
      ? customerProjectionEmail(retainedCustomerSnapshot)
      : "";
    const identitySourceEmail = storedCustomerId && retainedCustomerEmail
      ? retainedCustomerEmail
      : sourceCustomerEmail;
    const identitySourceClaimRef = identitySourceEmail === sourceCustomerEmail
      ? sourceCustomerEmailClaimRef
      : customerEmailClaimCollectionRef.doc(
        customerEmailClaimDocumentId(identitySourceEmail)
      );
    const identitySourceClaimSnapshot = identitySourceEmail === sourceCustomerEmail
      ? sourceCustomerEmailClaimSnapshot
      : await tx.get(identitySourceClaimRef);
    const sourceClaimBinding = readCustomerEmailClaim(
      identitySourceClaimSnapshot,
      organizationId,
      identitySourceEmail
    );
    const desiredClaimBinding = desiredCustomerEmail === identitySourceEmail
      ? sourceClaimBinding
      : readCustomerEmailClaim(
        desiredCustomerEmailClaimSnapshot,
        organizationId,
        desiredCustomerEmail
      );
    const initialCustomerSnapshots = [
      retainedCustomerSnapshot,
      desiredCustomerEmailSnapshot,
      desiredCustomerEmailKeySnapshot,
      sourceCustomerEmailSnapshot,
      sourceCustomerEmailKeySnapshot
    ];
    const knownSourceClaimedCustomerSnapshot = sourceClaimBinding
      ? customerProjectionDocuments(...initialCustomerSnapshots)
        .find((snapshot) => snapshot.id === sourceClaimBinding.customerId) || null
      : null;
    const sourceClaimedCustomerSnapshot = sourceClaimBinding
      && !knownSourceClaimedCustomerSnapshot
      ? await tx.get(customerCollectionRef.doc(sourceClaimBinding.customerId))
      : knownSourceClaimedCustomerSnapshot;
    const customerSnapshots = [
      ...initialCustomerSnapshots,
      ...(sourceClaimedCustomerSnapshot ? [sourceClaimedCustomerSnapshot] : [])
    ];
    assertCustomerProjectionEmailConsistency(customerSnapshots);
    let existingCustomerDoc = retainedCustomerSnapshot.exists
      ? retainedCustomerSnapshot
      : null;
    if (storedCustomerId && !existingCustomerDoc) {
      throw new QuoteCreationError(
        "failed-precondition",
        "The quote customer identity no longer resolves to a customer record."
      );
    }
    if (!storedCustomerId) {
      if (sourceClaimBinding) {
        if (
          !sourceClaimedCustomerSnapshot?.exists
          || customerProjectionEmail(sourceClaimedCustomerSnapshot) !== identitySourceEmail
        ) {
          throw new QuoteCreationError(
            "failed-precondition",
            "The customer email claim no longer resolves to its customer record."
          );
        }
        existingCustomerDoc = sourceClaimedCustomerSnapshot;
      } else {
        existingCustomerDoc = selectCustomerProjectionDocument(
          customerSnapshots,
          identitySourceEmail
        );
      }
      if (
        retainedCustomerSnapshot.exists
        && customerProjectionEmail(retainedCustomerSnapshot) !== identitySourceEmail
      ) {
        throw new QuoteCreationError(
          "failed-precondition",
          "The deterministic customer identity is occupied by a different customer."
        );
      }
    }
    const resolvedCustomerId = existingCustomerDoc?.id || retainedCustomerId;
    if (sourceClaimBinding && sourceClaimBinding.customerId !== resolvedCustomerId) {
      throw new QuoteCreationError(
        "already-exists",
        "The current customer email is claimed by another customer identity."
      );
    }
    if (desiredClaimBinding && desiredClaimBinding.customerId !== resolvedCustomerId) {
      throw new QuoteCreationError(
        "already-exists",
        "Another customer identity already claims the requested email."
      );
    }
    assertNoCustomerProjectionCollision(
      customerSnapshots,
      desiredCustomerEmail,
      resolvedCustomerId
    );
    const customerProjection = buildCustomerProjection({
      organizationId,
      quoteId,
      quoteNumber: documents.quotePatch.quoteNumber,
      customer: documents.quotePatch.customer,
      event: documents.quotePatch.event,
      nowISO,
      existingCustomer: existingCustomerDoc?.data() || null,
      existingCustomerId: resolvedCustomerId,
      allowEmailChange: true
    });
    const customerRef = customerCollectionRef.doc(customerProjection.customerId);
    const desiredCustomerEmailClaim = buildCustomerEmailClaim({
      organizationId,
      customerId: customerProjection.customerId,
      customerEmail: desiredCustomerEmail,
      nowISO,
      existingClaim: desiredClaimBinding?.data || null,
      claimSource: "trusted_quote_projection"
    });
    const boundDocuments = bindCustomerIdentityToQuoteDocuments(
      documents,
      customerProjection.customerId
    );

    tx.update(quoteRef, {
      ...boundDocuments.quotePatch,
      updatedAt: FieldValue.serverTimestamp()
    });
    tx.set(portalRef, {
      ...boundDocuments.portal,
      updatedAt: FieldValue.serverTimestamp(),
      ...(portalSnap.exists
        ? {}
        : { createdAt: FieldValue.serverTimestamp() })
    });
    tx.create(versionRef, {
      ...boundDocuments.version,
      createdAt: FieldValue.serverTimestamp()
    });
    if (identitySourceEmail !== desiredCustomerEmail && sourceClaimBinding) {
      tx.delete(identitySourceClaimRef);
    }
    writeCustomerEmailClaim(
      tx,
      desiredCustomerEmailClaimRef,
      desiredCustomerEmailClaim
    );
    tx.set(customerRef, {
      ...customerProjection.patch,
      updatedAt: FieldValue.serverTimestamp(),
      ...(customerProjection.isNew
        ? { createdAt: FieldValue.serverTimestamp() }
        : {})
    }, { merge: true });
    const commercialChange = persistCommercialChangeApply({
      tx,
      organizationId,
      quoteId,
      customerId: customerProjection.customerId,
      eventDate: normalizeText(boundDocuments.quotePatch.event?.date),
      pricingCatalogAuthority: pricingResult.catalogAuthority,
      nowISO,
      plan: commercialChangePlan
    });
    return { ...boundDocuments.result, commercialChange };
  });

  return {
    ok: true,
    organizationId,
    storage: "firebase",
    ...result
  };
}

function quoteCreationFailure(err, {
  operation,
  staff,
  organizationId,
  failureMessage = "Failed to create quote."
}) {
  if (err instanceof functions.https.HttpsError) {
    throw err;
  }
  if (
    err instanceof QuoteCreationError
    || err instanceof RebookQuoteDraftError
    || err instanceof PostEventCloseoutError
    || err instanceof PricingEngineError
    || err instanceof ApprovalWorkflowError
    || err instanceof ContractWorkflowError
    || err instanceof QuoteDeliveryError
    || err instanceof CommercialChangeAuthorityError
    || err instanceof CommercialChangeImpactPreviewError
  ) {
    throw new functions.https.HttpsError(err.code, err.message);
  }
  functions.logger.error(`${operation} failed`, {
    actorUid: staff.uid,
    organizationId,
    error: normalizeText(err?.message)
  });
  throw new functions.https.HttpsError("internal", failureMessage);
}

exports.createQuoteDraft = functions.region(REGION).https.onCall(async (data, context) => {
  const requestedOrganizationId = normalizeOrganizationId(data?.organizationId);
  const staff = await assertStaff(context, {
    expectedOrganizationId: requestedOrganizationId
  });
  const organizationId = normalizeOrganizationId(
    requestedOrganizationId || staff.organizationId
  );
  if (!organizationId) {
    throw new functions.https.HttpsError(
      "failed-precondition",
      "An active organization scope is required to create a quote."
    );
  }

  try {
    return await createTrustedQuoteDraftInternal({
      organizationId,
      staff,
      form: data?.form
    });
  } catch (err) {
    return quoteCreationFailure(err, {
      operation: "createQuoteDraft",
      staff,
      organizationId
    });
  }
});

exports.duplicateQuoteDraft = functions.region(REGION).https.onCall(async (data, context) => {
  const requestedOrganizationId = normalizeOrganizationId(data?.organizationId);
  const staff = await assertStaff(context, {
    expectedOrganizationId: requestedOrganizationId
  });
  const organizationId = normalizeOrganizationId(
    requestedOrganizationId || staff.organizationId
  );
  const sourceQuoteId = normalizeText(data?.sourceQuoteId);
  if (!organizationId || !sourceQuoteId) {
    throw new functions.https.HttpsError(
      "invalid-argument",
      "organizationId and sourceQuoteId are required."
    );
  }

  try {
    const source = await readQuoteOrThrow(sourceQuoteId, {
      organizationId
    });
    return await createTrustedQuoteDraftInternal({
      organizationId,
      staff,
      form: buildDuplicateQuoteForm(source.quote),
      creationReason: "duplicate_quote_create",
      sourceQuoteId
    });
  } catch (err) {
    if (err instanceof functions.https.HttpsError) {
      throw err;
    }
    return quoteCreationFailure(err, {
      operation: "duplicateQuoteDraft",
      staff,
      organizationId
    });
  }
});

exports.createRebookQuoteDraft = functions.region(REGION).https.onCall(async (data, context) => {
  let request;
  try {
    request = normalizeRebookQuoteDraftRequest(data);
  } catch (err) {
    if (err instanceof RebookQuoteDraftError) {
      throw new functions.https.HttpsError(err.code, err.message);
    }
    throw err;
  }
  const staff = await assertStaff(context, {
    expectedOrganizationId: request.organizationId
  });
  if (normalizeOrganizationId(staff.organizationId) !== request.organizationId) {
    throw new functions.https.HttpsError(
      "permission-denied",
      "Rebook draft creation requires the active organization scope."
    );
  }

  const draftId = buildRebookDraftId(request);
  const draftRef = getQuoteDocRef(draftId, request.organizationId);
  const responseFromExistingDraft = async () => {
    const snapshot = await draftRef.get();
    if (!snapshot.exists) return null;
    const quote = { id: snapshot.id, ...(snapshot.data() || {}) };
    if (!matchesRebookDraft(quote, { request, expectedDraftId: draftId })) {
      throw new RebookQuoteDraftError(
        "already-exists",
        "The deterministic rebook identity is occupied by a different record."
      );
    }
    if (
      !normalizeText(quote.quoteNumber)
      || normalizeText(quote.portalKey).length < 20
      || !normalizeText(quote.activeVersionId)
      || normalizeText(quote.customerId) !== normalizeText(quote.rebooking?.sourceCustomerId)
    ) {
      throw new RebookQuoteDraftError(
        "failed-precondition",
        "The matching rebook record is incomplete and requires staff review."
      );
    }
    return {
      ok: true,
      organizationId: request.organizationId,
      storage: "firebase",
      id: draftId,
      quoteNumber: normalizeText(quote.quoteNumber),
      portalKey: normalizeText(quote.portalKey),
      portalIssuedAtISO: normalizeText(quote.portalIssuedAtISO),
      portalExpiresAtISO: normalizeText(quote.portalExpiresAtISO),
      activeVersionId: normalizeText(quote.activeVersionId),
      latestVersionNumber: Math.max(1, Number(quote.latestVersionNumber || 1)),
      customerId: normalizeText(quote.customerId),
      status: normalizeText(quote.status).toLowerCase(),
      rebooking: {
        sourceQuoteId: request.sourceQuoteId,
        sourceVersionId: request.sourceVersionId,
        sourceEventDate: normalizeText(quote.rebooking?.sourceEventDate),
        acceptanceReceiptId: request.acceptanceReceiptId,
        rebookingRequestId: request.rebookingRequestId,
        state: normalizeText(quote.rebooking?.state)
      },
      idempotent: true
    };
  };

  try {
    const existing = await responseFromExistingDraft();
    if (existing) return existing;

    const source = await readQuoteOrThrow(request.sourceQuoteId, {
      organizationId: request.organizationId
    });
    const versionSnap = await source.quoteRef
      .collection("versions")
      .doc(request.sourceVersionId)
      .get();
    if (!versionSnap.exists) {
      throw new RebookQuoteDraftError(
        "failed-precondition",
        "The reviewed accepted proposal version is no longer available."
      );
    }
    const resolved = resolveAcceptedRebookSource({
      request,
      sourceQuote: source.quote,
      sourceVersion: { id: versionSnap.id, ...(versionSnap.data() || {}) }
    });
    const currentCustomerRef = db
      .collection(ORGANIZATIONS_COLLECTION)
      .doc(request.organizationId)
      .collection("customers")
      .doc(resolved.customerId);
    const currentCustomerSnap = await currentCustomerRef.get();
    if (!currentCustomerSnap.exists) {
      throw new RebookQuoteDraftError(
        "failed-precondition",
        "The stable customer record is no longer available for rebooking."
      );
    }
    const currentCustomer = currentCustomerSnap.data() || {};
    const rebookForm = overlayCurrentCustomerContact({
      sourceForm: buildDuplicateQuoteForm(resolved.sourceSnapshot),
      currentCustomer,
      organizationId: request.organizationId,
      customerId: resolved.customerId
    });
    const createdAtISO = new Date().toISOString();
    const rebooking = buildRebookProvenance({
      request,
      customerId: resolved.customerId,
      sourceEventDate: resolved.sourceSnapshot?.event?.date,
      acceptedAtISO: resolved.acceptedAtISO,
      createdAtISO
    });
    try {
      const created = await createTrustedQuoteDraftInternal({
        organizationId: request.organizationId,
        staff,
        form: rebookForm,
        creationReason: "rebook_quote_create",
        sourceQuoteId: request.sourceQuoteId,
        trustedQuoteId: draftId,
        expectedCustomerId: resolved.customerId,
        expectedCustomerContact: currentCustomer,
        rebooking,
        rebookSourceRequest: request,
        requestedNowISO: createdAtISO
      });
      return {
        ...created,
        status: "draft",
        idempotent: false
      };
    } catch (err) {
      if (err instanceof QuoteCreationError && err.code === "already-exists") {
        const reconciled = await responseFromExistingDraft();
        if (reconciled) return reconciled;
      }
      throw err;
    }
  } catch (err) {
    if (err instanceof functions.https.HttpsError) throw err;
    if (err instanceof RebookQuoteDraftError) {
      throw new functions.https.HttpsError(err.code, err.message);
    }
    return quoteCreationFailure(err, {
      operation: "createRebookQuoteDraft",
      staff,
      organizationId: request.organizationId,
      failureMessage: "Failed to create the reviewed rebook draft."
    });
  }
});

exports.updateQuoteDraft = functions.region(REGION).https.onCall(async (data, context) => {
  const requestedOrganizationId = normalizeOrganizationId(data?.organizationId);
  const staff = await assertStaff(context, {
    expectedOrganizationId: requestedOrganizationId
  });
  const organizationId = normalizeOrganizationId(
    requestedOrganizationId || staff.organizationId
  );
  const quoteId = normalizeText(data?.quoteId);
  if (!organizationId || !quoteId) {
    throw new functions.https.HttpsError(
      "invalid-argument",
      "organizationId and quoteId are required."
    );
  }
  if (normalizeOrganizationId(staff.principalOrganizationId) !== organizationId) {
    throw new functions.https.HttpsError(
      "permission-denied",
      "Quote edits require same-organization staff authority."
    );
  }

  try {
    return await updateTrustedQuoteDraftInternal({
      organizationId,
      quoteId,
      staff,
      form: data?.form,
      commercialChangeAuthorityInput: data?.commercialChangeAuthority
    });
  } catch (err) {
    if (err instanceof functions.https.HttpsError) {
      throw err;
    }
    return quoteCreationFailure(err, {
      operation: "updateQuoteDraft",
      staff,
      organizationId,
      failureMessage: "Failed to edit quote."
    });
  }
});

exports.requestQuoteApproval = functions.region(REGION).https.onCall(async (data, context) => {
  const requestedOrganizationId = normalizeOrganizationId(data?.organizationId);
  const staff = await assertStaff(context, {
    expectedOrganizationId: requestedOrganizationId
  });
  const organizationId = normalizeOrganizationId(
    requestedOrganizationId || staff.organizationId
  );
  const quoteId = normalizeText(data?.quoteId);
  if (!organizationId || !quoteId) {
    throw new functions.https.HttpsError(
      "invalid-argument",
      "organizationId and quoteId are required."
    );
  }
  if (normalizeOrganizationId(staff.principalOrganizationId) !== organizationId) {
    throw new functions.https.HttpsError(
      "permission-denied",
      "Approval requests require same-organization staff authority."
    );
  }

  try {
    const quoteRef = getQuoteDocRef(quoteId, organizationId);
    const requestedAtISO = new Date().toISOString();
    const result = await db.runTransaction(async (tx) => {
      const quoteSnap = await tx.get(quoteRef);
      if (!quoteSnap.exists) {
        throw new functions.https.HttpsError("not-found", "Quote not found.");
      }
      const quote = quoteSnap.data() || {};
      if (normalizeOrganizationId(quote.organizationId || organizationId) !== organizationId) {
        throw new functions.https.HttpsError(
          "permission-denied",
          "Quote is outside your organization."
        );
      }
      if (normalizeText(quote.status).toLowerCase() === "deleted" || normalizeText(quote.deletedAtISO)) {
        throw new functions.https.HttpsError(
          "failed-precondition",
          "Deleted quotes cannot receive approval requests."
        );
      }

      const approvalAction = normalizeText(data?.action);
      assertApprovalActionRequestable({ quote, action: approvalAction });
      let paymentApprovalScope = {};
      if (new Set(["send_payment_request", "send_final_balance_request"]).has(approvalAction)) {
        const portalKey = normalizeText(quote.portalKey);
        const portalSnap = portalKey
          ? await tx.get(db.collection(PORTAL_COLLECTION).doc(portalKey))
          : null;
        paymentApprovalScope = deriveApprovedPaymentRequestScope({
          quote,
          quoteId,
          organizationId,
          portalSnapshot: portalSnap?.exists ? portalSnap.data() : null,
          nowISO: requestedAtISO
        }, approvalAction === "send_final_balance_request" ? "final_balance" : "deposit");
      }

      const planned = buildApprovalRequest({
        workflow: quote.workflow,
        action: approvalAction,
        note: data?.note,
        actorEmail: staff.email,
        nowISO: requestedAtISO,
        requestId: randomUUID().replace(/-/g, ""),
        ...paymentApprovalScope
      });
      tx.update(quoteRef, {
        "workflow.approvalRequests": planned.approvalRequests,
        updatedAtISO: requestedAtISO
      });
      return planned.request;
    });

    return {
      ok: true,
      storage: "firebase",
      organizationId,
      quoteId,
      request: result
    };
  } catch (err) {
    if (err instanceof functions.https.HttpsError) throw err;
    if (
      err instanceof ApprovalWorkflowError
      || err instanceof PaymentApprovalScopeError
      || err instanceof PaymentSafetyError
      || err instanceof PaymentLedgerError
      || err instanceof QuoteDeliveryError
    ) {
      throw new functions.https.HttpsError(err.code, err.message);
    }
    functions.logger.error("Approval request failed", {
      organizationId,
      quoteId,
      actorUid: staff.uid,
      error: normalizeText(err?.message)
    });
    throw new functions.https.HttpsError("internal", "Failed to request quote approval.");
  }
});

exports.resolveQuoteApprovalRequest = functions.region(REGION).https.onCall(async (data, context) => {
  const requestedOrganizationId = normalizeOrganizationId(data?.organizationId);
  const staff = await assertStaff(context, {
    expectedOrganizationId: requestedOrganizationId
  });
  assertAdminStaff(staff);
  const organizationId = normalizeOrganizationId(
    requestedOrganizationId || staff.organizationId
  );
  const quoteId = normalizeText(data?.quoteId);
  const requestId = normalizeText(data?.requestId);
  if (!organizationId || !quoteId || !requestId) {
    throw new functions.https.HttpsError(
      "invalid-argument",
      "organizationId, quoteId, and requestId are required."
    );
  }
  if (normalizeOrganizationId(staff.principalOrganizationId) !== organizationId) {
    throw new functions.https.HttpsError(
      "permission-denied",
      "Approval resolution requires same-organization admin authority."
    );
  }

  try {
    const quoteRef = getQuoteDocRef(quoteId, organizationId);
    const resolvedAtISO = new Date().toISOString();
    const result = await db.runTransaction(async (tx) => {
      const quoteSnap = await tx.get(quoteRef);
      if (!quoteSnap.exists) {
        throw new functions.https.HttpsError("not-found", "Quote not found.");
      }
      const quote = quoteSnap.data() || {};
      if (normalizeOrganizationId(quote.organizationId || organizationId) !== organizationId) {
        throw new functions.https.HttpsError(
          "permission-denied",
          "Quote is outside your organization."
        );
      }
      if (normalizeText(quote.status).toLowerCase() === "deleted" || normalizeText(quote.deletedAtISO)) {
        throw new functions.https.HttpsError(
          "failed-precondition",
          "Deleted quote approvals cannot be resolved."
        );
      }

      const targetRequest = findQuoteApprovalRequest(quote.workflow, requestId);
      if (!targetRequest) {
        throw new ApprovalWorkflowError("not-found", "Approval request not found.");
      }
      const resolutionState = normalizeText(data?.state).toLowerCase();
      if (resolutionState === "approved") {
        assertApprovalActionRequestable({
          quote,
          action: normalizeText(targetRequest.action)
        });
      }
      if (
        resolutionState === "approved"
        && new Set(["send_payment_request", "send_final_balance_request"]).has(
          normalizeText(targetRequest.action)
        )
      ) {
        const portalKey = normalizeText(quote.portalKey);
        const portalSnap = portalKey
          ? await tx.get(db.collection(PORTAL_COLLECTION).doc(portalKey))
          : null;
        const targetPaymentKind = normalizeText(targetRequest.action) === "send_final_balance_request"
          ? "final_balance"
          : "deposit";
        const expectedScope = deriveApprovedPaymentRequestScope({
          quote,
          quoteId,
          organizationId,
          portalSnapshot: portalSnap?.exists ? portalSnap.data() : null,
          nowISO: resolvedAtISO
        }, targetPaymentKind);
        assertPaymentApprovalRequestScope({
          approvalRequest: targetRequest,
          expected: expectedScope
        });
      }

      const planned = buildApprovalResolution({
        workflow: quote.workflow,
        requestId,
        state: resolutionState,
        resolutionNote: data?.resolutionNote,
        actorEmail: staff.email,
        nowISO: resolvedAtISO
      });
      tx.update(quoteRef, {
        "workflow.approvalRequests": planned.approvalRequests,
        updatedAtISO: resolvedAtISO
      });
      return planned.request;
    });

    return {
      ok: true,
      storage: "firebase",
      organizationId,
      quoteId,
      request: result
    };
  } catch (err) {
    if (err instanceof functions.https.HttpsError) throw err;
    if (
      err instanceof ApprovalWorkflowError
      || err instanceof PaymentApprovalScopeError
      || err instanceof PaymentSafetyError
      || err instanceof PaymentLedgerError
      || err instanceof QuoteDeliveryError
    ) {
      throw new functions.https.HttpsError(err.code, err.message);
    }
    functions.logger.error("Approval resolution failed", {
      organizationId,
      quoteId,
      requestId,
      actorUid: staff.uid,
      error: normalizeText(err?.message)
    });
    throw new functions.https.HttpsError("internal", "Failed to resolve quote approval.");
  }
});

function projectPostEventCloseoutToQuote(record = {}) {
  const reviewItems = record?.reviewItems && typeof record.reviewItems === "object"
    ? record.reviewItems
    : {};
  return {
    schemaVersion: Number(record.schemaVersion || 0),
    closeoutId: normalizeText(record.closeoutId),
    organizationId: normalizeOrganizationId(record.organizationId),
    quoteId: normalizeText(record.quoteId),
    customerId: normalizeText(record.customerId),
    sourceVersionId: normalizeText(record.sourceVersionId),
    acceptanceReceiptId: normalizeText(record.acceptanceReceiptId),
    eventDate: normalizeText(record.eventDate),
    dueDate: normalizeText(record.dueDate),
    policy: {
      version: Number(record.policy?.version || 0),
      state: normalizeText(record.policy?.state),
      source: normalizeText(record.policy?.source),
      timeZone: normalizeText(record.policy?.timeZone),
      dueBoundary: normalizeText(record.policy?.dueBoundary),
      offsetDays: Number(record.policy?.offsetDays || 0),
      blockedReason: normalizeText(record.policy?.blockedReason)
    },
    state: normalizeText(record.state),
    reviewItems: Object.fromEntries(Object.entries(reviewItems).map(([code, item]) => [
      code,
      {
        state: normalizeText(item?.state),
        reviewedAtISO: normalizeText(item?.reviewedAtISO),
        reviewedBy: item?.reviewedBy && typeof item.reviewedBy === "object"
          ? {
              email: normalizeEmail(item.reviewedBy.email),
              role: normalizeText(item.reviewedBy.role)
            }
          : null,
        lastActionReceiptId: normalizeText(item?.lastActionReceiptId)
      }
    ])),
    completedAtISO: normalizeText(record.completedAtISO),
    completedBy: record?.completedBy && typeof record.completedBy === "object"
      ? {
          email: normalizeEmail(record.completedBy.email),
          role: normalizeText(record.completedBy.role)
        }
      : null,
    createdAtISO: normalizeText(record.createdAtISO),
    updatedAtISO: normalizeText(record.updatedAtISO)
  };
}

function projectUnavailablePostEventCloseoutToQuote({
  organizationId,
  quoteId,
  quote,
  acceptedSourceVersionId,
  reason = "accepted_source_unavailable"
} = {}) {
  const eventDate = normalizeText(quote?.event?.date);
  let dueDate = "";
  try {
    dueDate = addCalendarDaysDateOnly(eventDate);
  } catch {
    dueDate = "";
  }
  return {
    schemaVersion: 1,
    closeoutId: "",
    organizationId: normalizeOrganizationId(organizationId),
    quoteId: normalizeText(quoteId),
    customerId: normalizeText(quote?.customerId),
    sourceVersionId: normalizeText(acceptedSourceVersionId),
    acceptanceReceiptId: normalizeText(quote?.acceptanceReceipt?.receiptId),
    eventDate,
    dueDate,
    policy: {
      version: 1,
      state: "blocked_source",
      source: "accepted_proposal_authority",
      timeZone: "",
      dueBoundary: "tenant_calendar_date",
      offsetDays: 7,
      blockedReason: reason
    },
    state: "blocked_source",
    reviewItems: {},
    completedAtISO: "",
    completedBy: null,
    createdAtISO: "",
    updatedAtISO: ""
  };
}

exports.convertQuoteToContract = functions.region(REGION).https.onCall(async (data, context) => {
  const requestedOrganizationId = normalizeOrganizationId(data?.organizationId);
  const staff = assertAdminStaff(await assertStaff(context, {
    expectedOrganizationId: requestedOrganizationId
  }));
  const organizationId = normalizeOrganizationId(
    requestedOrganizationId || staff.organizationId
  );
  const quoteId = normalizeText(data?.quoteId);
  const approvalRequestId = normalizeApprovalExecutionId(data?.approvalRequestId);
  if (!organizationId || !quoteId || !approvalRequestId) {
    throw new functions.https.HttpsError(
      "invalid-argument",
      "organizationId, quoteId, and approvalRequestId are required."
    );
  }
  if (normalizeOrganizationId(staff.principalOrganizationId) !== organizationId) {
    throw new functions.https.HttpsError(
      "permission-denied",
      "Contract conversion requires same-organization admin authority."
    );
  }

  try {
    const quoteRef = getQuoteDocRef(quoteId, organizationId);
    const executionRef = getQuoteApprovalExecutionDocRef(
      organizationId,
      approvalRequestId
    );
    const organizationRef = db.collection(ORGANIZATIONS_COLLECTION).doc(organizationId);
    const settingsRef = organizationRef.collection("settings").doc("config");
    const convertedAtISO = new Date().toISOString();
    const contractDate = convertedAtISO.slice(2, 10).replace(/-/g, "");
    const contractNumber = `C-${contractDate}-${String(randomInt(0, 100_000)).padStart(5, "0")}`;
    const result = await db.runTransaction(async (tx) => {
      const [quoteSnap, executionSnap, settingsSnap] = await Promise.all([
        tx.get(quoteRef),
        tx.get(executionRef),
        tx.get(settingsRef)
      ]);
      if (executionSnap.exists) {
        const existingExecution = executionSnap.data() || {};
        assertMatchingApprovalExecutionRecord(existingExecution, {
          organizationId,
          quoteId,
          approvalRequestId,
          action: "convert_to_contract"
        });
        if (normalizeText(existingExecution.state).toLowerCase() === "succeeded") {
          return {
            ...(existingExecution.result || {}),
            idempotent: true
          };
        }
        throw new ApprovalWorkflowError(
          "aborted",
          "Contract conversion is already in progress."
        );
      }
      if (!quoteSnap.exists) {
        throw new QuoteCreationError("not-found", "Quote not found.");
      }
      const quote = quoteSnap.data() || {};
      if (normalizeOrganizationId(quote.organizationId) !== organizationId) {
        throw new QuoteCreationError(
          "permission-denied",
          "Quote is outside your organization."
        );
      }
      assertQuoteEditNotDispatching({ ...quote, id: quoteId }, convertedAtISO);

      const acceptedSourceVersionId = normalizeText(
        quote.activeVersionId || quote.versionMeta?.versionId
      );
      const acceptedSourceVersionSnap = acceptedSourceVersionId
        ? await tx.get(quoteRef.collection("versions").doc(acceptedSourceVersionId))
        : null;
      const acceptanceReceiptId = normalizeText(quote.acceptanceReceipt?.receiptId);
      const acceptanceReceiptDocumentSnap = acceptanceReceiptId
        ? await tx.get(
            organizationRef
              .collection(PROPOSAL_ACCEPTANCE_RECEIPTS_COLLECTION)
              .doc(acceptanceReceiptId)
          )
        : null;
      const eventDate = normalizeText(quote.event?.date);
      const conflictQuery = quoteRef.parent.where("event.date", "==", eventDate || "__missing__");
      const conflictSnap = await tx.get(conflictQuery);
      const peerQuotes = conflictSnap.docs.map((docSnap) => ({
        id: docSnap.id,
        ...(docSnap.data() || {})
      }));
      const nextVersionNumber = Math.max(0, Number(quote.latestVersionNumber || 0)) + 1;
      const versionId = `v${String(nextVersionNumber).padStart(4, "0")}`;
      const versionRef = quoteRef.collection("versions").doc(versionId);
      const versionSnap = await tx.get(versionRef);
      if (versionSnap.exists) {
        throw new QuoteCreationError(
          "already-exists",
          "Contract conversion version identity collided. Retry the action."
        );
      }

      const started = buildApprovalExecutionStart({
        workflow: quote.workflow,
        requestId: approvalRequestId,
        action: "convert_to_contract",
        actorEmail: staff.email,
        nowISO: convertedAtISO,
        operationId: approvalRequestId
      });
      const conversion = planContractConversion({
        quoteId,
        quote,
        peerQuotes,
        actorEmail: staff.email,
        nowISO: convertedAtISO,
        contractNumber,
        capacityLimit: settingsSnap.data()?.capacityLimit || 400
      });
      const bookedSourceQuote = {
        ...quote,
        ...conversion.quotePatch,
        id: quoteId
      };
      let closeoutRecord = null;
      let closeoutRef = null;
      let closeoutSnap = null;
      let closeoutProjection = projectUnavailablePostEventCloseoutToQuote({
        organizationId,
        quoteId,
        quote: bookedSourceQuote,
        acceptedSourceVersionId
      });
      try {
        if (!acceptedSourceVersionSnap?.exists || !acceptanceReceiptDocumentSnap?.exists) {
          throw new PostEventCloseoutError(
            "failed-precondition",
            "The exact accepted proposal source is unavailable for closeout scheduling."
          );
        }
        const sourceVersion = {
          id: acceptedSourceVersionSnap.id,
          ...(acceptedSourceVersionSnap.data() || {})
        };
        const acceptanceReceiptDocument = acceptanceReceiptDocumentSnap.data() || {};
        const closeoutSource = resolvePostEventCloseoutSource({
          organizationId,
          quoteId,
          sourceQuote: bookedSourceQuote,
          sourceVersion,
          acceptanceReceiptDocument
        });
        closeoutRecord = buildPostEventCloseoutRecord({
          organizationId,
          quoteId,
          sourceQuote: bookedSourceQuote,
          sourceVersion,
          acceptanceReceiptDocument,
          settings: settingsSnap.exists ? settingsSnap.data() || {} : {},
          actor: staff,
          nowISO: convertedAtISO
        });
        closeoutRef = organizationRef
          .collection("postEventCloseouts")
          .doc(closeoutRecord.closeoutId);
        closeoutSnap = await tx.get(closeoutRef);
        if (closeoutSnap.exists) {
          assertPostEventCloseoutMatchesSource(closeoutSnap.data() || {}, closeoutSource);
        }
        closeoutProjection = projectPostEventCloseoutToQuote(
          closeoutSnap.exists ? closeoutSnap.data() || {} : closeoutRecord
        );
      } catch (error) {
        if (!(error instanceof PostEventCloseoutError)) throw error;
        if (closeoutSnap?.exists) throw error;
        closeoutRecord = null;
        closeoutRef = null;
        closeoutSnap = null;
      }
      const completed = buildApprovalExecutionOutcome({
        workflow: {
          ...(quote.workflow || {}),
          approvalRequests: started.approvalRequests
        },
        requestId: approvalRequestId,
        action: "convert_to_contract",
        actorEmail: staff.email,
        nowISO: convertedAtISO,
        operationId: approvalRequestId,
        state: "succeeded",
        reference: contractNumber
      });
      const workflow = {
        ...(quote.workflow || {}),
        approvalRequests: completed.approvalRequests,
        postEventCloseout: closeoutProjection
      };
      const versionMeta = {
        versionId,
        versionNumber: nextVersionNumber,
        createdAt: convertedAtISO,
        createdBy: {
          uid: staff.uid,
          email: staff.email,
          role: staff.role
        },
        reason: "convert_to_contract_before_update"
      };
      const quotePatch = {
        ...conversion.quotePatch,
        workflow,
        latestVersionNumber: nextVersionNumber,
        versionMeta,
        ...(acceptedSourceVersionId ? { activeVersionId: acceptedSourceVersionId } : {})
      };
      const convertedQuote = {
        ...quote,
        ...quotePatch,
        id: quoteId
      };
      const portalKey = normalizeText(quote.portalKey);
      if (!portalKey) {
        throw new QuoteCreationError(
          "failed-precondition",
          "Quote portal identity is required for contract conversion."
        );
      }
      const response = {
        status: conversion.status,
        booking: conversion.booking,
        lifecycle: conversion.lifecycle,
        contractNumber: conversion.contractNumber,
        availability: conversion.availability,
        approvalRequest: completed.request,
        postEventCloseout: closeoutProjection,
        versionId,
        versionNumber: nextVersionNumber
      };

      tx.create(versionRef, projectCustomerIdentityToImmutableVersion({
        versionId,
        quoteId,
        organizationId,
        versionNumber: nextVersionNumber,
        createdAtISO: convertedAtISO,
        reason: versionMeta.reason,
        createdBy: versionMeta.createdBy,
        status: normalizeText(quote.status).toLowerCase(),
        pricing: quote.pricing || {},
        snapshot: {
          ...quote,
          id: quoteId
        },
        createdAt: FieldValue.serverTimestamp()
      }, quote));
      tx.update(quoteRef, {
        ...quotePatch,
        updatedAt: FieldValue.serverTimestamp()
      });
      tx.set(db.collection(PORTAL_COLLECTION).doc(portalKey), {
        ...buildCanonicalPortalSnapshot(quoteId, convertedQuote),
        updatedAt: FieldValue.serverTimestamp()
      }, { merge: true });
      tx.create(executionRef, buildApprovalExecutionAudit({
        organizationId,
        quoteId,
        approvalRequest: completed.request,
        staff,
        state: "succeeded",
        startedAtISO: convertedAtISO,
        completedAtISO: convertedAtISO,
        result: response
      }));
      if (closeoutRecord && closeoutRef && closeoutSnap && !closeoutSnap.exists) {
        tx.create(closeoutRef, {
          ...closeoutRecord,
          createdAt: FieldValue.serverTimestamp(),
          updatedAt: FieldValue.serverTimestamp()
        });
      }
      return response;
    });

    return {
      ok: true,
      storage: "firebase",
      organizationId,
      quoteId,
      ...result
    };
  } catch (err) {
    return quoteCreationFailure(err, {
      operation: "convertQuoteToContract",
      staff,
      organizationId,
      failureMessage: "Failed to convert quote to contract."
    });
  }
});

exports.recordPostEventCloseoutReview = functions.region(REGION).https.onCall(async (data, context) => {
  let request;
  try {
    request = normalizePostEventCloseoutActionRequest(data);
  } catch (err) {
    if (err instanceof PostEventCloseoutError) {
      throw new functions.https.HttpsError(err.code, err.message);
    }
    throw err;
  }
  const staff = await assertStaff(context, {
    expectedOrganizationId: request.organizationId
  });
  if (normalizeOrganizationId(staff.principalOrganizationId) !== request.organizationId) {
    throw new functions.https.HttpsError(
      "permission-denied",
      "Closeout review requires same-organization staff authority."
    );
  }

  try {
    const nowISO = new Date().toISOString();
    const organizationRef = db
      .collection(ORGANIZATIONS_COLLECTION)
      .doc(request.organizationId);
    const quoteRef = organizationRef.collection(QUOTES_COLLECTION).doc(request.quoteId);
    const closeoutRef = organizationRef
      .collection("postEventCloseouts")
      .doc(request.closeoutId);
    const receiptRef = closeoutRef
      .collection("actionReceipts")
      .doc(request.receiptId);
    const settingsRef = organizationRef.collection("settings").doc("config");
    const result = await db.runTransaction(async (tx) => {
      const [quoteSnap, closeoutSnap, receiptSnap, settingsSnap] = await Promise.all([
        tx.get(quoteRef),
        tx.get(closeoutRef),
        tx.get(receiptRef),
        tx.get(settingsRef)
      ]);
      if (!quoteSnap.exists || !closeoutSnap.exists) {
        throw new PostEventCloseoutError(
          "not-found",
          "The authoritative booked quote or closeout record is unavailable."
        );
      }
      const quote = quoteSnap.data() || {};
      const closeout = closeoutSnap.data() || {};
      if (
        normalizeOrganizationId(quote.organizationId) !== request.organizationId
        || normalizeText(closeout.organizationId) !== request.organizationId
        || normalizeText(closeout.quoteId) !== request.quoteId
      ) {
        throw new PostEventCloseoutError(
          "permission-denied",
          "The closeout record is outside this organization or quote scope."
        );
      }
      const sourceVersionId = normalizeText(closeout.sourceVersionId);
      const acceptanceReceiptDocumentId = normalizeText(closeout.acceptanceReceiptId);
      if (!sourceVersionId || !acceptanceReceiptDocumentId) {
        throw new PostEventCloseoutError(
          "failed-precondition",
          "The closeout record is missing its accepted proposal source or receipt."
        );
      }
      const [sourceVersionSnap, acceptanceReceiptDocumentSnap] = await Promise.all([
        tx.get(quoteRef.collection("versions").doc(sourceVersionId)),
        tx.get(
          organizationRef
            .collection(PROPOSAL_ACCEPTANCE_RECEIPTS_COLLECTION)
            .doc(acceptanceReceiptDocumentId)
        )
      ]);
      if (!sourceVersionSnap.exists || !acceptanceReceiptDocumentSnap.exists) {
        throw new PostEventCloseoutError(
          "failed-precondition",
          "The closeout accepted proposal source or private receipt is unavailable."
        );
      }
      const source = resolvePostEventCloseoutSource({
        organizationId: request.organizationId,
        quoteId: request.quoteId,
        sourceQuote: { id: quoteSnap.id, ...quote },
        sourceVersion: {
          id: sourceVersionSnap.id,
          ...(sourceVersionSnap.data() || {})
        },
        acceptanceReceiptDocument: acceptanceReceiptDocumentSnap.data() || {}
      });
      assertPostEventCloseoutMatchesSource(closeout, source);

      const currentPolicy = buildPostEventCloseoutPolicySnapshot(
        settingsSnap.exists ? settingsSnap.data() || {} : {}
      );
      const policyRecovered = normalizeText(closeout.policy?.state) === "blocked_configuration"
        && currentPolicy.state === "configured";
      const workingRecord = policyRecovered
        ? {
            ...closeout,
            policy: currentPolicy,
            state: "pending",
            updatedAtISO: nowISO
          }
        : closeout;
      const planned = planPostEventCloseoutAction({
        request,
        record: workingRecord,
        source,
        actor: staff,
        nowISO,
        existingReceipt: receiptSnap.exists ? receiptSnap.data() || {} : null
      });
      const nextRecord = planned.nextRecord || workingRecord;
      const quoteProjection = projectPostEventCloseoutToQuote(nextRecord);

      if (!receiptSnap.exists) {
        tx.create(receiptRef, {
          ...planned.receipt,
          createdAt: FieldValue.serverTimestamp()
        });
      }
      if (planned.nextRecord || policyRecovered) {
        tx.set(closeoutRef, {
          ...nextRecord,
          updatedAt: FieldValue.serverTimestamp()
        }, { merge: true });
      }
      if (planned.nextRecord || policyRecovered) {
        tx.update(quoteRef, {
          "workflow.postEventCloseout": quoteProjection,
          updatedAtISO: nowISO,
          updatedAt: FieldValue.serverTimestamp()
        });
      }

      return {
        kind: planned.kind,
        idempotent: planned.idempotent,
        state: quoteProjection.state,
        postEventCloseout: quoteProjection,
        receipt: {
          receiptId: normalizeText(planned.receipt.receiptId),
          requestId: normalizeText(planned.receipt.requestId),
          itemCode: normalizeText(planned.receipt.itemCode),
          action: normalizeText(planned.receipt.action),
          applied: planned.receipt.applied === true,
          priorItemState: normalizeText(planned.receipt.priorItemState),
          resultItemState: normalizeText(planned.receipt.resultItemState),
          priorCloseoutState: normalizeText(planned.receipt.priorCloseoutState),
          resultCloseoutState: normalizeText(planned.receipt.resultCloseoutState),
          recordedAtISO: normalizeText(planned.receipt.recordedAtISO),
          recordedByEmail: normalizeEmail(planned.receipt.recordedBy?.email)
        }
      };
    });
    return {
      ok: true,
      storage: "firebase",
      organizationId: request.organizationId,
      quoteId: request.quoteId,
      closeoutId: request.closeoutId,
      ...result
    };
  } catch (err) {
    if (err instanceof functions.https.HttpsError) throw err;
    if (err instanceof PostEventCloseoutError) {
      throw new functions.https.HttpsError(err.code, err.message);
    }
    functions.logger.error("Post-event closeout review failed", {
      organizationId: request.organizationId,
      quoteId: request.quoteId,
      closeoutId: request.closeoutId,
      actorUid: staff.uid,
      error: normalizeText(err?.message)
    });
    throw new functions.https.HttpsError(
      "internal",
      "Failed to record the post-event closeout review."
    );
  }
});

exports.refreshPostEventCloseoutConfiguration = functions.region(REGION).https.onCall(async (data, context) => {
  let request;
  try {
    request = normalizePostEventCloseoutPolicyRefreshRequest(data);
  } catch (error) {
    if (error instanceof PostEventCloseoutError) {
      throw new functions.https.HttpsError(error.code, error.message);
    }
    throw error;
  }
  const staff = await assertStaff(context, {
    expectedOrganizationId: request.organizationId
  });
  if (normalizeOrganizationId(staff.principalOrganizationId) !== request.organizationId) {
    throw new functions.https.HttpsError(
      "permission-denied",
      "Closeout configuration refresh requires same-organization staff authority."
    );
  }

  try {
    const nowISO = new Date().toISOString();
    const organizationRef = db
      .collection(ORGANIZATIONS_COLLECTION)
      .doc(request.organizationId);
    const quoteRef = organizationRef.collection(QUOTES_COLLECTION).doc(request.quoteId);
    const closeoutRef = organizationRef
      .collection("postEventCloseouts")
      .doc(request.closeoutId);
    const receiptRef = closeoutRef
      .collection("actionReceipts")
      .doc(request.receiptId);
    const settingsRef = organizationRef.collection("settings").doc("config");
    const result = await db.runTransaction(async (tx) => {
      const [quoteSnap, closeoutSnap, receiptSnap, settingsSnap] = await Promise.all([
        tx.get(quoteRef),
        tx.get(closeoutRef),
        tx.get(receiptRef),
        tx.get(settingsRef)
      ]);
      if (!quoteSnap.exists || !closeoutSnap.exists) {
        throw new PostEventCloseoutError(
          "not-found",
          "The authoritative booked quote or closeout record is unavailable."
        );
      }
      const quote = quoteSnap.data() || {};
      const closeout = closeoutSnap.data() || {};
      if (
        normalizeOrganizationId(quote.organizationId) !== request.organizationId
        || normalizeText(closeout.organizationId) !== request.organizationId
        || normalizeText(closeout.quoteId) !== request.quoteId
      ) {
        throw new PostEventCloseoutError(
          "permission-denied",
          "The closeout record is outside this organization or quote scope."
        );
      }
      const sourceVersionId = normalizeText(closeout.sourceVersionId);
      const acceptanceReceiptDocumentId = normalizeText(closeout.acceptanceReceiptId);
      if (!sourceVersionId || !acceptanceReceiptDocumentId) {
        throw new PostEventCloseoutError(
          "failed-precondition",
          "The closeout record is missing its accepted proposal source or receipt."
        );
      }
      const [sourceVersionSnap, acceptanceReceiptDocumentSnap] = await Promise.all([
        tx.get(quoteRef.collection("versions").doc(sourceVersionId)),
        tx.get(
          organizationRef
            .collection(PROPOSAL_ACCEPTANCE_RECEIPTS_COLLECTION)
            .doc(acceptanceReceiptDocumentId)
        )
      ]);
      if (!sourceVersionSnap.exists || !acceptanceReceiptDocumentSnap.exists) {
        throw new PostEventCloseoutError(
          "failed-precondition",
          "The closeout accepted proposal source or private receipt is unavailable."
        );
      }
      const source = resolvePostEventCloseoutSource({
        organizationId: request.organizationId,
        quoteId: request.quoteId,
        sourceQuote: { id: quoteSnap.id, ...quote },
        sourceVersion: {
          id: sourceVersionSnap.id,
          ...(sourceVersionSnap.data() || {})
        },
        acceptanceReceiptDocument: acceptanceReceiptDocumentSnap.data() || {}
      });
      const planned = planPostEventCloseoutPolicyRefresh({
        request,
        record: closeout,
        source,
        settings: settingsSnap.exists ? settingsSnap.data() || {} : {},
        actor: staff,
        nowISO,
        existingReceipt: receiptSnap.exists ? receiptSnap.data() || {} : null
      });
      const nextRecord = planned.nextRecord || closeout;
      const quoteProjection = projectPostEventCloseoutToQuote(nextRecord);

      if (!receiptSnap.exists) {
        tx.create(receiptRef, {
          ...planned.receipt,
          createdAt: FieldValue.serverTimestamp()
        });
      }
      if (planned.nextRecord) {
        tx.set(closeoutRef, {
          ...planned.nextRecord,
          updatedAt: FieldValue.serverTimestamp()
        }, { merge: true });
        tx.update(quoteRef, {
          "workflow.postEventCloseout": quoteProjection,
          updatedAtISO: nowISO,
          updatedAt: FieldValue.serverTimestamp()
        });
      }

      return {
        kind: planned.kind,
        idempotent: planned.idempotent,
        state: quoteProjection.state,
        postEventCloseout: quoteProjection,
        receipt: {
          receiptId: normalizeText(planned.receipt.receiptId),
          requestId: normalizeText(planned.receipt.requestId),
          action: "refresh_configuration",
          applied: planned.receipt.applied === true,
          priorPolicyState: normalizeText(planned.receipt.priorPolicyState),
          resultPolicyState: normalizeText(planned.receipt.resultPolicyState),
          priorTimeZone: normalizeText(planned.receipt.priorTimeZone),
          resultTimeZone: normalizeText(planned.receipt.resultTimeZone),
          resultCloseoutState: normalizeText(planned.receipt.resultCloseoutState),
          recordedAtISO: normalizeText(planned.receipt.recordedAtISO),
          recordedByEmail: normalizeEmail(planned.receipt.recordedBy?.email)
        }
      };
    });
    return {
      ok: true,
      storage: "firebase",
      organizationId: request.organizationId,
      quoteId: request.quoteId,
      closeoutId: request.closeoutId,
      ...result
    };
  } catch (error) {
    if (error instanceof functions.https.HttpsError) throw error;
    if (error instanceof PostEventCloseoutError) {
      throw new functions.https.HttpsError(error.code, error.message);
    }
    functions.logger.error("Post-event closeout configuration refresh failed", {
      organizationId: request.organizationId,
      quoteId: request.quoteId,
      closeoutId: request.closeoutId,
      actorUid: staff.uid,
      error: normalizeText(error?.message)
    });
    throw new functions.https.HttpsError(
      "internal",
      "Failed to refresh post-event closeout configuration."
    );
  }
});

function kitchenBeoRefs(organizationId, quoteId, receiptId = "") {
  const organizationRef = db.collection(ORGANIZATIONS_COLLECTION).doc(organizationId);
  const artifactRef = organizationRef.collection(KITCHEN_BEO_ARTIFACTS_COLLECTION).doc(quoteId);
  const dependencyStateRef = organizationRef
    .collection(COMMERCIAL_DEPENDENCY_STATE_COLLECTION)
    .doc(quoteId);
  return {
    organizationRef,
    quoteRef: organizationRef.collection(QUOTES_COLLECTION).doc(quoteId),
    artifactRef,
    receiptsRef: organizationRef.collection(KITCHEN_BEO_RECEIPTS_COLLECTION),
    receiptRef: receiptId
      ? organizationRef.collection(KITCHEN_BEO_RECEIPTS_COLLECTION).doc(receiptId)
      : null,
    dependencyStateRef,
    invalidationsRef: dependencyStateRef.collection(COMMERCIAL_DEPENDENCY_INVALIDATIONS_COLLECTION),
    applyReceiptsRef: organizationRef.collection(COMMERCIAL_CHANGE_APPLY_RECEIPTS_COLLECTION),
    reconciliationReceiptsRef: organizationRef
      .collection(COMMERCIAL_CHANGE_RECONCILIATION_RECEIPTS_COLLECTION)
  };
}

function throwKitchenBeoFailure(error, operation) {
  if (error instanceof functions.https.HttpsError) throw error;
  if (
    error instanceof KitchenBeoAuthorityError
    || error instanceof CommercialChangeAuthorityError
  ) {
    throw new functions.https.HttpsError(error.code, error.message);
  }
  functions.logger.error(`${operation} failed`, {
    error: normalizeText(error?.message).slice(0, 240)
  });
  throw new functions.https.HttpsError(
    "internal",
    "The authoritative Kitchen BEO operation did not complete."
  );
}

function projectKitchenBeoStatus(status = {}) {
  const allowedStates = new Set(Object.values(KITCHEN_BEO_FRESHNESS_STATES));
  const state = allowedStates.has(status.state)
    ? status.state
    : KITCHEN_BEO_FRESHNESS_STATES.UNKNOWN;
  return {
    schemaVersion: normalizeText(status.schemaVersion),
    authority: status.authority === "server_derived" ? "server_derived" : "unknown",
    state,
    observedAtISO: normalizeText(status.observedAtISO),
    reasonCodes: Array.isArray(status.reasonCodes)
      ? status.reasonCodes.map((value) => normalizeText(value)).filter(Boolean).slice(0, 12)
      : [],
    currentDependencyFingerprint: normalizeText(status.currentDependencyFingerprint),
    receiptId: normalizeText(status.receiptId),
    receiptDependencyFingerprint: normalizeText(status.receiptDependencyFingerprint),
    commercialSourceRevisionId: normalizeText(status.commercialSourceRevisionId),
    unresolvedInvalidationIds: Array.isArray(status.unresolvedInvalidationIds)
      ? status.unresolvedInvalidationIds.map((value) => normalizeText(value)).filter(Boolean).slice(0, 100)
      : []
  };
}

function projectKitchenBeoReceipt(receipt = {}) {
  return {
    receiptId: normalizeText(receipt.receiptId),
    requestId: normalizeText(receipt.requestId),
    commercialSourceRevisionId: normalizeText(receipt.commercialSourceRevisionId),
    dependencyFingerprint: normalizeText(receipt.dependencyFingerprint),
    generatedAtISO: normalizeText(receipt.generatedAtISO),
    filename: normalizeText(receipt.filename),
    artifactByteLength: Number(receipt.artifactByteLength) || 0,
    generatedBy: {
      email: normalizeEmail(receipt.generatedBy?.email),
      role: normalizeText(receipt.generatedBy?.role).toLowerCase()
    }
  };
}

function projectStoredKitchenBeoArtifact(record = {}, {
  organizationId,
  quoteId,
  receiptId
} = {}) {
  const stored = kitchenBeoAuthority.validateStoredArtifact(record);
  const receipt = stored.receipt;
  if (
    receipt.organizationId !== organizationId
    || receipt.quoteId !== quoteId
    || receipt.receiptId !== receiptId
  ) {
    throw new KitchenBeoAuthorityError(
      "permission-denied",
      "The Kitchen BEO receipt is outside the requested quote scope."
    );
  }
  return {
    receipt: projectKitchenBeoReceipt(receipt),
    artifact: stored.artifact
  };
}

function projectKitchenBeoReceiptHistory({
  state = "UNKNOWN",
  receipts = [],
  truncated = false,
  reasonCodes = []
} = {}) {
  const normalizedState = new Set(["COMPLETE", "PARTIAL", "UNKNOWN"]).has(state)
    ? state
    : "UNKNOWN";
  const projectedReceipts = normalizedState === "UNKNOWN" ? [] : receipts.slice(0, 10);
  return {
    schemaVersion: KITCHEN_BEO_RECEIPT_HISTORY_SCHEMA_VERSION,
    authority: "server_projection",
    state: normalizedState,
    bounds: {
      limit: KITCHEN_BEO_RECEIPT_HISTORY_LIMIT,
      returnedCount: projectedReceipts.length,
      truncated: truncated === true
    },
    reasonCodes: reasonCodes.map((value) => normalizeText(value)).filter(Boolean).slice(0, 8),
    receipts: projectedReceipts
  };
}

function planKitchenBeoReceiptHistory(artifactPointer, newReceiptId) {
  const pointer = artifactPointer && typeof artifactPointer === "object"
    ? artifactPointer
    : null;
  if (!pointer) {
    return {
      receiptHistorySchemaVersion: KITCHEN_BEO_RECEIPT_HISTORY_SCHEMA_VERSION,
      recentReceiptIds: [newReceiptId],
      receiptHistoryTruncated: false
    };
  }
  const priorLatestReceiptId = normalizeText(pointer.latestReceiptId).toLowerCase();
  const embeddedLatestReceiptId = normalizeText(pointer.latestReceipt?.receiptId).toLowerCase();
  if (
    !/^beo_[a-f0-9]{48}$/u.test(priorLatestReceiptId)
    || embeddedLatestReceiptId !== priorLatestReceiptId
  ) {
    throw new KitchenBeoAuthorityError(
      "failed-precondition",
      "The existing Kitchen BEO pointer is invalid and must be repaired before generation."
    );
  }
  let priorReceiptIds;
  let truncated;
  if (Number(pointer.receiptHistorySchemaVersion) === KITCHEN_BEO_RECEIPT_HISTORY_SCHEMA_VERSION) {
    priorReceiptIds = Array.isArray(pointer.recentReceiptIds)
      ? pointer.recentReceiptIds.map((value) => normalizeText(value).toLowerCase())
      : [];
    if (
      !priorReceiptIds.length
      || priorReceiptIds.length > KITCHEN_BEO_RECEIPT_HISTORY_LIMIT
      || priorReceiptIds[0] !== priorLatestReceiptId
      || priorReceiptIds.some((value) => !/^beo_[a-f0-9]{48}$/u.test(value))
      || new Set(priorReceiptIds).size !== priorReceiptIds.length
      || typeof pointer.receiptHistoryTruncated !== "boolean"
    ) {
      throw new KitchenBeoAuthorityError(
        "failed-precondition",
        "The existing Kitchen BEO receipt history is invalid and must be repaired before generation."
      );
    }
    truncated = pointer.receiptHistoryTruncated;
  } else {
    if (
      pointer.receiptHistorySchemaVersion !== undefined
      || pointer.recentReceiptIds !== undefined
      || pointer.receiptHistoryTruncated !== undefined
    ) {
      throw new KitchenBeoAuthorityError(
        "failed-precondition",
        "The existing Kitchen BEO receipt history schema is unsupported."
      );
    }
    priorReceiptIds = [priorLatestReceiptId];
    // A legacy pointer proves only its latest receipt, not that older receipts
    // never existed. Preserve that evidence as an explicitly partial history.
    truncated = true;
  }
  const combined = [newReceiptId, ...priorReceiptIds.filter((value) => value !== newReceiptId)];
  return {
    receiptHistorySchemaVersion: KITCHEN_BEO_RECEIPT_HISTORY_SCHEMA_VERSION,
    recentReceiptIds: combined.slice(0, KITCHEN_BEO_RECEIPT_HISTORY_LIMIT),
    receiptHistoryTruncated: truncated || combined.length > KITCHEN_BEO_RECEIPT_HISTORY_LIMIT
  };
}

async function readKitchenBeoReceiptHistory({
  refs,
  artifactExists,
  artifactPointer,
  organizationId,
  quoteId
}) {
  if (!artifactExists) {
    return {
      trustedCurrentReceipt: null,
      projection: projectKitchenBeoReceiptHistory({
        state: "COMPLETE",
        receipts: [],
        truncated: false,
        reasonCodes: ["no_generation_receipts"]
      })
    };
  }
  const pointer = artifactPointer || {};
  const latestReceiptId = normalizeText(pointer.latestReceiptId).toLowerCase();
  const embeddedLatestReceiptId = normalizeText(pointer.latestReceipt?.receiptId).toLowerCase();
  const unknown = (reasonCode) => ({
    trustedCurrentReceipt: {},
    projection: projectKitchenBeoReceiptHistory({
      state: "UNKNOWN",
      receipts: [],
      truncated: true,
      reasonCodes: [reasonCode]
    })
  });
  if (
    !/^beo_[a-f0-9]{48}$/u.test(latestReceiptId)
    || embeddedLatestReceiptId !== latestReceiptId
  ) {
    return unknown("receipt_history_pointer_invalid");
  }
  const modern = Number(pointer.receiptHistorySchemaVersion)
    === KITCHEN_BEO_RECEIPT_HISTORY_SCHEMA_VERSION;
  let receiptIds;
  let truncated;
  if (modern) {
    receiptIds = Array.isArray(pointer.recentReceiptIds)
      ? pointer.recentReceiptIds.map((value) => normalizeText(value).toLowerCase())
      : [];
    truncated = pointer.receiptHistoryTruncated;
    if (
      !receiptIds.length
      || receiptIds.length > KITCHEN_BEO_RECEIPT_HISTORY_LIMIT
      || receiptIds[0] !== latestReceiptId
      || receiptIds.some((value) => !/^beo_[a-f0-9]{48}$/u.test(value))
      || new Set(receiptIds).size !== receiptIds.length
      || typeof truncated !== "boolean"
    ) {
      return unknown("receipt_history_contract_invalid");
    }
  } else {
    if (
      pointer.receiptHistorySchemaVersion !== undefined
      || pointer.recentReceiptIds !== undefined
      || pointer.receiptHistoryTruncated !== undefined
    ) {
      return unknown("receipt_history_schema_unsupported");
    }
    receiptIds = [latestReceiptId];
    truncated = true;
  }
  const receiptSnapshots = await Promise.all(
    receiptIds.map((receiptId) => refs.receiptsRef.doc(receiptId).get())
  );
  const projected = [];
  let trustedCurrentReceipt = null;
  try {
    receiptSnapshots.forEach((snapshot, index) => {
      if (!snapshot.exists) {
        throw new KitchenBeoAuthorityError(
          "failed-precondition",
          "A declared Kitchen BEO receipt is unavailable."
        );
      }
      const receiptId = receiptIds[index];
      const record = snapshot.data() || {};
      const stored = projectStoredKitchenBeoArtifact(record, {
        organizationId,
        quoteId,
        receiptId
      });
      if (index === 0) trustedCurrentReceipt = record;
      projected.push({ ...stored.receipt, current: index === 0 });
    });
  } catch {
    return unknown("receipt_history_evidence_invalid");
  }
  return {
    trustedCurrentReceipt,
    projection: projectKitchenBeoReceiptHistory({
      state: modern ? (truncated ? "PARTIAL" : "COMPLETE") : "PARTIAL",
      receipts: projected,
      truncated,
      reasonCodes: modern
        ? (truncated ? ["receipt_history_bound_reached"] : ["receipt_history_complete"])
        : ["prior_receipt_history_unavailable"]
    })
  };
}

async function readKitchenBeoStatus({ organizationId, quoteId, nowISO }) {
  const refs = kitchenBeoRefs(organizationId, quoteId);
  const [quoteSnap, artifactSnap, invalidationsSnap] = await Promise.all([
    refs.quoteRef.get(),
    refs.artifactRef.get(),
    refs.invalidationsRef.limit(101).get()
  ]);
  if (!quoteSnap.exists) {
    throw new functions.https.HttpsError("not-found", "Quote not found.");
  }
  const quote = { id: quoteId, ...(quoteSnap.data() || {}) };
  if (normalizeOrganizationId(quote.organizationId) !== organizationId) {
    throw new functions.https.HttpsError("permission-denied", "Quote is outside your organization.");
  }
  const artifactPointer = artifactSnap.exists ? artifactSnap.data() || {} : null;
  const receiptHistory = await readKitchenBeoReceiptHistory({
    refs,
    artifactExists: artifactSnap.exists,
    artifactPointer,
    organizationId,
    quoteId
  });
  if (invalidationsSnap.size > 100) {
    return {
      quote,
      status: projectKitchenBeoStatus({
        schemaVersion: KITCHEN_BEO_STATUS_SCHEMA_VERSION,
        authority: "server_derived",
        state: KITCHEN_BEO_FRESHNESS_STATES.UNKNOWN,
        observedAtISO: nowISO,
        reasonCodes: ["invalidation_evidence_truncated"],
        receiptId: normalizeText(receiptHistory.trustedCurrentReceipt?.receiptId),
        receiptDependencyFingerprint: normalizeText(
          receiptHistory.trustedCurrentReceipt?.dependencyFingerprint
        ),
        commercialSourceRevisionId: normalizeText(
          receiptHistory.trustedCurrentReceipt?.commercialSourceRevisionId
        )
      }),
      receiptHistory: receiptHistory.projection
    };
  }
  const status = kitchenBeoAuthority.deriveArtifactStatus({
    canonicalQuote: quote,
    trustedReceipt: receiptHistory.trustedCurrentReceipt,
    invalidations: invalidationsSnap.docs
      .map((snapshot) => ({ id: snapshot.id, ...(snapshot.data() || {}) }))
      .filter((item) => normalizeText(item.artifactNodeId || item.nodeId) === "artifact.kitchen_beo")
      .map((item) => ({
        id: item.id,
        artifactNodeId: "artifact.kitchen_beo",
        state: normalizeText(item.state),
        classification: normalizeText(item.classification)
      })),
    sourceState: "available",
    trustedContext: { organizationId, quoteId, nowISO }
  });
  return {
    quote,
    status: projectKitchenBeoStatus(status),
    receiptHistory: receiptHistory.projection
  };
}

exports.getKitchenBeoArtifactStatus = functions.region(REGION).https.onCall(async (data, context) => {
  const organizationId = normalizeOrganizationId(data?.organizationId);
  const quoteId = normalizeText(data?.quoteId);
  const staff = await assertStaff(context, { expectedOrganizationId: organizationId });
  if (!organizationId || !quoteId) {
    throw new functions.https.HttpsError(
      "invalid-argument",
      "organizationId and quoteId are required."
    );
  }
  if (normalizeOrganizationId(staff.principalOrganizationId) !== organizationId) {
    throw new functions.https.HttpsError(
      "permission-denied",
      "Kitchen BEO status requires same-organization staff authority."
    );
  }
  try {
    const observedAtISO = new Date().toISOString();
    const result = await readKitchenBeoStatus({ organizationId, quoteId, nowISO: observedAtISO });
    return {
      ok: true,
      storage: "firebase",
      organizationId,
      quoteId,
      status: result.status,
      receiptHistory: result.receiptHistory
    };
  } catch (error) {
    return throwKitchenBeoFailure(error, "getKitchenBeoArtifactStatus");
  }
});

exports.downloadKitchenBeoReceipt = functions.region(REGION).https.onCall(async (data, context) => {
  const organizationId = normalizeOrganizationId(data?.organizationId);
  const quoteId = normalizeText(data?.quoteId);
  const receiptId = normalizeText(data?.receiptId).toLowerCase();
  const staff = await assertStaff(context, { expectedOrganizationId: organizationId });
  if (
    !organizationId
    || !quoteId
    || !/^beo_[a-f0-9]{48}$/u.test(receiptId)
  ) {
    throw new functions.https.HttpsError(
      "invalid-argument",
      "organizationId, quoteId, and an exact Kitchen BEO receiptId are required."
    );
  }
  if (normalizeOrganizationId(staff.principalOrganizationId) !== organizationId) {
    throw new functions.https.HttpsError(
      "permission-denied",
      "Kitchen BEO receipt download requires same-organization staff authority."
    );
  }
  try {
    const refs = kitchenBeoRefs(organizationId, quoteId, receiptId);
    const [quoteSnap, receiptSnap] = await Promise.all([
      refs.quoteRef.get(),
      refs.receiptRef.get()
    ]);
    if (!quoteSnap.exists || !receiptSnap.exists) {
      throw new KitchenBeoAuthorityError(
        "not-found",
        "The exact Kitchen BEO receipt was not found."
      );
    }
    const quote = quoteSnap.data() || {};
    if (normalizeOrganizationId(quote.organizationId) !== organizationId) {
      throw new KitchenBeoAuthorityError(
        "permission-denied",
        "The Kitchen BEO receipt is outside the requested organization."
      );
    }
    const projected = projectStoredKitchenBeoArtifact(receiptSnap.data() || {}, {
      organizationId,
      quoteId,
      receiptId
    });
    return {
      ok: true,
      storage: "firebase",
      organizationId,
      quoteId,
      ...projected
    };
  } catch (error) {
    return throwKitchenBeoFailure(error, "downloadKitchenBeoReceipt");
  }
});

function kitchenBeoReconciliationRequestId({ receiptId, applyReceiptId, invalidationIds }) {
  const digest = createHash("sha256")
    .update(commercialDependencyGraphCore.canonicalSerialize({
      schemaVersion: "kitchen-beo-reconciliation-request-v1",
      receiptId,
      applyReceiptId,
      invalidationIds: [...invalidationIds].sort()
    }))
    .digest("hex");
  return `change_reconcile_${digest.slice(0, 32)}`;
}

exports.generateKitchenBeo = functions.region(REGION).https.onCall(async (data, context) => {
  const organizationId = normalizeOrganizationId(data?.organizationId);
  const quoteId = normalizeText(data?.quoteId);
  const requestId = normalizeText(data?.requestId);
  const staff = await assertStaff(context, { expectedOrganizationId: organizationId });
  if (!organizationId || !quoteId || !requestId) {
    throw new functions.https.HttpsError(
      "invalid-argument",
      "organizationId, quoteId, and requestId are required."
    );
  }
  if (normalizeOrganizationId(staff.principalOrganizationId) !== organizationId) {
    throw new functions.https.HttpsError(
      "permission-denied",
      "Kitchen BEO generation requires same-organization staff authority."
    );
  }

  try {
    const claimedAtISO = new Date().toISOString();
    const initialRefs = kitchenBeoRefs(organizationId, quoteId);
    const initialQuoteSnap = await initialRefs.quoteRef.get();
    if (!initialQuoteSnap.exists) {
      throw new functions.https.HttpsError("not-found", "Quote not found.");
    }
    const canonicalQuote = { id: quoteId, ...(initialQuoteSnap.data() || {}) };
    const trustedContext = {
      organizationId,
      quoteId,
      nowISO: claimedAtISO,
      actor: { uid: staff.uid, email: staff.email, role: staff.role }
    };
    const claim = kitchenBeoAuthority.buildGenerationClaim({
      canonicalQuote,
      request: { requestId },
      trustedContext
    });
    const refs = kitchenBeoRefs(organizationId, quoteId, claim.receiptId);
    const existingReceiptSnap = await refs.receiptRef.get();
    let generatedAtISO = "";
    let proposedRecord = null;
    if (!existingReceiptSnap.exists) {
      generatedAtISO = new Date().toISOString();
      const artifact = renderKitchenBeoPdf({
        payload: claim.payload,
        provenance: { ...claim, generatedAtISO }
      });
      const proposedReceipt = kitchenBeoAuthority.buildGenerationReceipt({
        claim,
        artifact,
        trustedCompletion: { generatedAtISO }
      });
      proposedRecord = {
        ...proposedReceipt,
        artifactBase64: artifact.bytes.toString("base64")
      };
    }

    const persisted = await db.runTransaction(async (tx) => {
      const [
        transactionQuoteSnap,
        transactionReceiptSnap,
        artifactSnap,
        dependencyStateSnap,
        invalidationsSnap
      ] = await Promise.all([
        tx.get(refs.quoteRef),
        tx.get(refs.receiptRef),
        tx.get(refs.artifactRef),
        tx.get(refs.dependencyStateRef),
        tx.get(refs.invalidationsRef.orderBy(FieldPath.documentId())
          .limit(COMMERCIAL_CHANGE_INVALIDATION_LIMIT + 1))
      ]);
      if (!transactionQuoteSnap.exists) {
        throw new KitchenBeoAuthorityError("not-found", "Quote not found.");
      }
      if (invalidationsSnap.size > COMMERCIAL_CHANGE_INVALIDATION_LIMIT) {
        throw new KitchenBeoAuthorityError(
          "resource-exhausted",
          "Kitchen BEO dependency evidence exceeds the bounded complete set."
        );
      }
      const transactionQuote = { id: quoteId, ...(transactionQuoteSnap.data() || {}) };
      if (normalizeOrganizationId(transactionQuote.organizationId) !== organizationId) {
        throw new KitchenBeoAuthorityError(
          "permission-denied",
          "The Kitchen BEO quote is outside the requested organization."
        );
      }
      const transactionClaim = kitchenBeoAuthority.buildGenerationClaim({
        canonicalQuote: transactionQuote,
        request: { requestId },
        trustedContext
      });
      let record;
      let idempotent = false;
      if (transactionReceiptSnap.exists) {
        record = transactionReceiptSnap.data() || {};
        if (normalizeText(record.requestId) !== requestId || !normalizeText(record.artifactBase64)) {
          throw new KitchenBeoAuthorityError(
            "already-exists",
            "Kitchen BEO request identity is already bound to different evidence."
          );
        }
        projectStoredKitchenBeoArtifact(record, {
          organizationId,
          quoteId,
          receiptId: claim.receiptId
        });
        idempotent = true;
      } else {
        if (
          !proposedRecord
          || commercialDependencyGraphCore.canonicalSerialize(transactionClaim)
            !== commercialDependencyGraphCore.canonicalSerialize(claim)
        ) {
          throw new KitchenBeoAuthorityError(
            "aborted",
            "The canonical quote changed while the Kitchen BEO was generated. Retry from the current record."
          );
        }
        projectStoredKitchenBeoArtifact(proposedRecord, {
          organizationId,
          quoteId,
          receiptId: claim.receiptId
        });
        record = proposedRecord;
      }

      const invalidationRecords = invalidationsSnap.docs.map((snapshot) => ({
        id: snapshot.id,
        ...(snapshot.data() || {})
      }));
      const dependencyStateRecord = dependencyStateSnap.exists
        ? dependencyStateSnap.data() || {}
        : null;
      const dependencyProjection = projectCommercialDependencyState({
        organizationId,
        quoteId,
        quote: transactionQuote,
        stateRecord: dependencyStateRecord,
        invalidationRecords,
        observedAtISO: generatedAtISO || claimedAtISO
      });
      if (
        (!dependencyStateRecord && invalidationRecords.length > 0)
        || (dependencyStateRecord && dependencyProjection.state === "UNKNOWN")
      ) {
        throw new KitchenBeoAuthorityError(
          "failed-precondition",
          "Kitchen BEO dependency evidence is incomplete and must be repaired before generation."
        );
      }
      const activeRevisionId = normalizeText(
        transactionQuote.activeVersionId || transactionQuote.versionMeta?.versionId
      );
      const openKitchenBeoInvalidations = invalidationRecords.filter((item) => (
        normalizeText(item.state).toLowerCase() === "open"
        && normalizeText(item.artifactNodeId || item.nodeId) === "artifact.kitchen_beo"
      ));
      const latestApplyReceiptId = normalizeText(dependencyStateRecord?.latestApplyReceiptId);
      const qualifyingInvalidations = openKitchenBeoInvalidations.filter((item) => (
        normalizeText(item.nodeId) === "artifact.kitchen_beo"
        && normalizeText(item.artifactNodeId) === "artifact.kitchen_beo"
        && normalizeText(item.nodeKind) === "artifact"
        && normalizeText(item.targetRevisionId) === activeRevisionId
        && normalizeText(item.applyReceiptId) === latestApplyReceiptId
      ));
      if (qualifyingInvalidations.length !== openKitchenBeoInvalidations.length) {
        throw new KitchenBeoAuthorityError(
          "failed-precondition",
          "An open Kitchen BEO invalidation is outside the exact active dependency scope."
        );
      }

      let dependencyReconciliation = null;
      let plannedReconciliation = null;
      let nextDependencyState = null;
      let resolutionById = new Map();
      let reconciliationRef = null;
      let reconciliationRequestFingerprint = "";
      let resolutionNote = "";
      if (qualifyingInvalidations.length > 0) {
        const pointerReceiptId = normalizeText(artifactSnap.data()?.latestReceiptId).toLowerCase();
        if (transactionReceiptSnap.exists && pointerReceiptId !== claim.receiptId) {
          throw new KitchenBeoAuthorityError(
            "failed-precondition",
            "Only the current Kitchen BEO receipt can resolve active dependency evidence."
          );
        }
        const remainingKitchenBeoInvalidations = invalidationRecords
          .filter((item) => !qualifyingInvalidations.some((candidate) => (
            normalizeText(candidate.invalidationId || candidate.id)
              === normalizeText(item.invalidationId || item.id)
          )))
          .filter((item) => (
            normalizeText(item.artifactNodeId || item.nodeId) === "artifact.kitchen_beo"
          ))
          .map((item) => ({
            id: normalizeText(item.invalidationId || item.id),
            artifactNodeId: "artifact.kitchen_beo",
            state: normalizeText(item.state),
            classification: normalizeText(item.classification)
          }));
        const postGenerationStatus = kitchenBeoAuthority.deriveArtifactStatus({
          canonicalQuote: transactionQuote,
          trustedReceipt: record,
          invalidations: remainingKitchenBeoInvalidations,
          sourceState: "available",
          trustedContext: { organizationId, quoteId, nowISO: generatedAtISO || claimedAtISO }
        });
        if (postGenerationStatus.state !== KITCHEN_BEO_FRESHNESS_STATES.CURRENT) {
          throw new KitchenBeoAuthorityError(
            "failed-precondition",
            "The generated Kitchen BEO does not establish current evidence for the active quote revision."
          );
        }
        const invalidationIds = qualifyingInvalidations
          .map((item) => normalizeText(item.invalidationId || item.id))
          .sort();
        const reconciliationRequestId = kitchenBeoReconciliationRequestId({
          receiptId: claim.receiptId,
          applyReceiptId: latestApplyReceiptId,
          invalidationIds
        });
        reconciliationRef = refs.reconciliationReceiptsRef.doc(reconciliationRequestId);
        const [applySnap, priorReconciliationsSnap, existingReconciliationSnap] = await Promise.all([
          tx.get(refs.applyReceiptsRef.doc(latestApplyReceiptId)),
          tx.get(refs.reconciliationReceiptsRef
            .where("applyReceiptId", "==", latestApplyReceiptId)
            .limit(COMMERCIAL_CHANGE_INVALIDATION_LIMIT + 1)),
          tx.get(reconciliationRef)
        ]);
        if (
          !applySnap.exists
          || existingReconciliationSnap.exists
          || priorReconciliationsSnap.size > COMMERCIAL_CHANGE_INVALIDATION_LIMIT
        ) {
          throw new KitchenBeoAuthorityError(
            "failed-precondition",
            "The exact bounded commercial apply evidence is unavailable for Kitchen BEO reconciliation."
          );
        }
        const applyReceipt = commercialChangeAuthority.validateApplyReceipt(
          applySnap.data()?.receipt
        );
        if (
          applyReceipt.organizationId !== organizationId
          || applyReceipt.quoteId !== quoteId
          || applyReceipt.receiptId !== latestApplyReceiptId
          || applyReceipt.newRevisionId !== activeRevisionId
          || applyReceipt.receiptDigest
            !== normalizeText(dependencyStateRecord?.latestApplyReceiptDigest)
        ) {
          throw new KitchenBeoAuthorityError(
            "failed-precondition",
            "The Kitchen BEO reconciliation apply receipt is stale or outside quote scope."
          );
        }
        const evidenceByInvalidationId = Object.fromEntries(
          qualifyingInvalidations.map((item) => {
            const invalidationId = normalizeText(item.invalidationId || item.id);
            return [invalidationId, {
              schemaVersion: COMMERCIAL_CHANGE_RECONCILIATION_EVIDENCE_VERSION,
              authority: "server_authoritative",
              evidenceId: claim.receiptId,
              invalidationId,
              nodeId: "artifact.kitchen_beo",
              sourceRevisionId: activeRevisionId,
              resolution: "artifact_current",
              state: "CURRENT"
            }];
          })
        );
        plannedReconciliation = commercialChangeAuthority.reconcile({
          applyReceipt,
          request: {
            requestId: reconciliationRequestId,
            organizationId,
            quoteId,
            invalidationIds
          },
          evidenceByInvalidationId,
          priorReconciliationReceipts: priorReconciliationsSnap.docs
            .map((snapshot) => snapshot.data()?.receipt)
            .filter(Boolean),
          trustedContext: {
            actor: commercialChangeActor(staff),
            nowISO: generatedAtISO || claimedAtISO,
            catalogAuthorityDigest: normalizeText(dependencyStateRecord.catalogAuthorityDigest),
            policyVersion: COMMERCIAL_CHANGE_POLICY_VERSION
          },
          current: { activeRevisionId }
        });
        resolutionById = new Map(plannedReconciliation.receipt.resolutions.map((item) => [
          item.invalidationId,
          item
        ]));
        resolutionNote = `Resolved automatically by exact current Kitchen BEO generation receipt ${claim.receiptId}.`;
        reconciliationRequestFingerprint = commercialReconciliationRequestFingerprint({
          organizationId,
          quoteId,
          applyReceiptId: latestApplyReceiptId,
          invalidationIds,
          resolutionNote
        });
        const nextInvalidations = invalidationRecords.map((item) => (
          invalidationIds.includes(normalizeText(item.invalidationId || item.id))
            ? { ...item, state: "resolved" }
            : item
        ));
        const openInvalidationCount = nextInvalidations.filter((item) => (
          normalizeText(item.state).toLowerCase() === "open"
        )).length;
        nextDependencyState = {
          ...dependencyStateRecord,
          state: openInvalidationCount === 0 ? "READY" : "BLOCKED",
          safeToPublish: openInvalidationCount === 0,
          openInvalidationCount,
          resolvedInvalidationCount: nextInvalidations.length - openInvalidationCount,
          lastReconciliationReceiptId: plannedReconciliation.receipt.receiptId,
          updatedAtISO: generatedAtISO || claimedAtISO
        };
        dependencyReconciliation = {
          receiptId: plannedReconciliation.receipt.receiptId,
          applyReceiptId: latestApplyReceiptId,
          resolvedInvalidationIds: invalidationIds,
          resolvedCount: invalidationIds.length
        };
      }

      if (!transactionReceiptSnap.exists) {
        const history = planKitchenBeoReceiptHistory(
          artifactSnap.exists ? artifactSnap.data() || {} : null,
          claim.receiptId
        );
        tx.create(refs.receiptRef, {
          ...record,
          createdAt: FieldValue.serverTimestamp()
        });
        tx.set(refs.artifactRef, {
          organizationId,
          quoteId,
          latestReceipt: kitchenBeoAuthority.validateGenerationReceipt(record),
          latestReceiptId: record.receiptId,
          ...history,
          updatedAtISO: generatedAtISO,
          updatedAt: FieldValue.serverTimestamp()
        }, { merge: true });
      }
      if (plannedReconciliation) {
        const resolvedBy = commercialChangeActor(staff);
        qualifyingInvalidations.forEach((invalidation) => {
          const invalidationId = normalizeText(invalidation.invalidationId || invalidation.id);
          const resolution = resolutionById.get(invalidationId);
          tx.update(refs.invalidationsRef.doc(invalidationId), {
            state: "resolved",
            resolution: normalizeText(resolution?.resolution),
            resolutionReceiptId: plannedReconciliation.receipt.receiptId,
            resolutionReceiptDigest: plannedReconciliation.receipt.receiptDigest,
            evidenceId: normalizeText(resolution?.evidenceId),
            evidenceDigest: normalizeText(resolution?.evidenceDigest),
            resolutionNote,
            resolvedAtISO: generatedAtISO || claimedAtISO,
            resolvedBy,
            updatedAt: FieldValue.serverTimestamp()
          });
        });
        tx.create(reconciliationRef, {
          organizationId,
          quoteId,
          applyReceiptId: latestApplyReceiptId,
          requestFingerprint: reconciliationRequestFingerprint,
          receipt: plannedReconciliation.receipt,
          createdAtISO: generatedAtISO || claimedAtISO,
          createdAt: FieldValue.serverTimestamp()
        });
        tx.update(refs.dependencyStateRef, {
          ...nextDependencyState,
          updatedAt: FieldValue.serverTimestamp()
        });
      }
      return { idempotent, record, dependencyReconciliation };
    });

    const current = await readKitchenBeoStatus({
      organizationId,
      quoteId,
      nowISO: new Date().toISOString()
    });
    const projected = projectStoredKitchenBeoArtifact(persisted.record, {
      organizationId,
      quoteId,
      receiptId: claim.receiptId
    });
    return {
      ok: true,
      storage: "firebase",
      organizationId,
      quoteId,
      idempotent: persisted.idempotent,
      receipt: projected.receipt,
      status: current.status,
      receiptHistory: current.receiptHistory,
      dependencyReconciliation: persisted.dependencyReconciliation,
      artifact: projected.artifact
    };
  } catch (error) {
    return throwKitchenBeoFailure(error, "generateKitchenBeo");
  }
});

exports.getDecisionDebtSnapshot = functions.region(REGION).https.onCall(async (data, context) => {
  const organizationId = normalizeOrganizationId(data?.organizationId);
  const quoteId = normalizeText(data?.quoteId);
  const limit = Number(data?.limit ?? 50);
  const staff = await assertStaff(context, { expectedOrganizationId: organizationId });
  if (
    !organizationId
    || normalizeOrganizationId(staff.principalOrganizationId) !== organizationId
    || (quoteId && /[\s/?#\\\u0000]/u.test(quoteId))
    || !Number.isSafeInteger(limit)
    || limit < 1
    || limit > 100
  ) {
    throw new functions.https.HttpsError(
      "invalid-argument",
      "Decision Debt requires same-organization staff and a result limit from 1 to 100."
    );
  }
  try {
    const organizationRef = db.collection(ORGANIZATIONS_COLLECTION).doc(organizationId);
    const policyRef = organizationRef.collection(DECISION_DEBT_POLICIES_COLLECTION).doc("current");
    const settingsRef = organizationRef.collection("settings").doc("config");
    const revenuePolicyRef = organizationRef.collection(REVENUE_AUTOPILOT_POLICY_COLLECTION).doc("current");
    const quotesRef = organizationRef.collection(QUOTES_COLLECTION);
    const dependencyStatesRef = organizationRef.collection(
      COMMERCIAL_DEPENDENCY_STATE_COLLECTION
    );
    const dependencyStateRead = quoteId
      ? dependencyStatesRef.doc(quoteId).get()
      : dependencyStatesRef.where("openInvalidationCount", ">", 0).limit(101).get();
    const exactQuoteRead = quoteId ? quotesRef.doc(quoteId).get() : Promise.resolve(null);
    const [
      policySnap,
      settingsSnap,
      revenuePolicySnap,
      dependencyStateReadSnap,
      exactQuoteSnap
    ] = await Promise.all([
      policyRef.get(),
      settingsRef.get(),
      revenuePolicyRef.get(),
      dependencyStateRead,
      exactQuoteRead
    ]);
    const policyRecord = decisionDebtPolicyRecord(
      policySnap.exists ? policySnap.data() || {} : null
    );
    const settings = settingsSnap.exists ? settingsSnap.data() || {} : {};
    const revenuePolicy = revenuePolicySnap.exists
      ? normalizeRevenueAutopilotTenantPolicy(revenuePolicySnap.data() || {})
      : dormantRevenueAutopilotTenantPolicy();
    const tenantTimeZone = normalizeText(
      settings.businessTimeZone
        || settings.timeZone
        || revenuePolicy.timeZone
    );
    if (!tenantTimeZone) {
      throw new DecisionDebtError(
        "failed-precondition",
        "Configure an explicit tenant IANA time zone before deriving Decision Debt."
      );
    }
    if (quoteId && !exactQuoteSnap?.exists) {
      throw new DecisionDebtError("not-found", "Quote not found for Decision Debt.");
    }
    if (
      quoteId
      && normalizeOrganizationId(exactQuoteSnap.data()?.organizationId) !== organizationId
    ) {
      throw new DecisionDebtError(
        "permission-denied",
        "Quote is outside the requested Decision Debt organization scope."
      );
    }
    const dependencyStateDocuments = quoteId
      ? (dependencyStateReadSnap.exists ? [dependencyStateReadSnap] : [])
      : dependencyStateReadSnap.docs;
    if (dependencyStateDocuments.length > 100) {
      throw new DecisionDebtError(
        "resource-exhausted",
        "Decision Debt unresolved dependency sources exceed the bounded read."
      );
    }
    const observedAtISO = new Date().toISOString();
    const candidates = [];
    for (const dependencyStateDoc of dependencyStateDocuments) {
      const scopedQuoteId = normalizeText(dependencyStateDoc.id);
      if (!scopedQuoteId || (quoteId && scopedQuoteId !== quoteId)) {
        throw new DecisionDebtError(
          "failed-precondition",
          "Decision Debt dependency state has invalid quote scope."
        );
      }
      const state = dependencyStateDoc.data() || {};
      const latestApplyReceiptId = normalizeText(state.latestApplyReceiptId);
      const invalidationsRef = dependencyStatesRef
        .doc(scopedQuoteId)
        .collection(COMMERCIAL_DEPENDENCY_INVALIDATIONS_COLLECTION);
      const [quoteSnap, invalidationsSnap, applySnap] = await Promise.all([
        quoteId ? Promise.resolve(exactQuoteSnap) : quotesRef.doc(scopedQuoteId).get(),
        invalidationsRef.orderBy(FieldPath.documentId())
          .limit(COMMERCIAL_CHANGE_INVALIDATION_LIMIT + 1)
          .get(),
        latestApplyReceiptId
          ? organizationRef.collection(COMMERCIAL_CHANGE_APPLY_RECEIPTS_COLLECTION)
            .doc(latestApplyReceiptId).get()
          : Promise.resolve(null)
      ]);
      if (!quoteSnap?.exists) {
        throw new DecisionDebtError(
          "failed-precondition",
          "Decision Debt canonical quote source is unavailable."
        );
      }
      if (invalidationsSnap.size > COMMERCIAL_CHANGE_INVALIDATION_LIMIT) {
        throw new DecisionDebtError(
          "resource-exhausted",
          "Decision Debt invalidation evidence exceeds the bounded complete set."
        );
      }
      const quote = { id: quoteSnap.id, ...(quoteSnap.data() || {}) };
      if (normalizeOrganizationId(quote.organizationId) !== organizationId) {
        throw new DecisionDebtError(
          "permission-denied",
          "Decision Debt canonical quote is outside the organization scope."
        );
      }
      const invalidations = invalidationsSnap.docs.map((snapshot) => ({
        id: snapshot.id,
        ...(snapshot.data() || {})
      }));
      const verifiedState = assertDecisionDebtDependencyState({
        organizationId,
        quoteId: scopedQuoteId,
        quote,
        state,
        invalidations
      });
      if (verifiedState.openInvalidationCount === 0) continue;
      if (
        normalizeText(state.state).toUpperCase() !== "BLOCKED"
        || state.safeToPublish !== false
        || !applySnap?.exists
      ) {
        throw new DecisionDebtError(
          "failed-precondition",
          "Decision Debt requires the exact blocked dependency state and apply receipt."
        );
      }
      const applyReceipt = commercialChangeAuthority.validateApplyReceipt(
        applySnap.data()?.receipt
      );
      if (
        applyReceipt.organizationId !== organizationId
        || applyReceipt.quoteId !== scopedQuoteId
        || applyReceipt.receiptId !== latestApplyReceiptId
        || applyReceipt.newRevisionId !== verifiedState.activeRevisionId
        || applyReceipt.receiptDigest !== normalizeText(state.latestApplyReceiptDigest)
      ) {
        throw new DecisionDebtError(
          "failed-precondition",
          "Decision Debt apply receipt does not match the active dependency state."
        );
      }
      const simulationSnap = await organizationRef
        .collection(COMMERCIAL_CHANGE_SIMULATIONS_COLLECTION)
        .doc(applyReceipt.simulationReceiptId)
        .get();
      if (!simulationSnap.exists) {
        throw new DecisionDebtError(
          "failed-precondition",
          "Decision Debt simulation evidence is unavailable."
        );
      }
      const simulationReceipt = commercialChangeAuthority.validateSimulationReceipt(
        simulationSnap.data()?.receipt
      );
      if (
        simulationReceipt.organizationId !== organizationId
        || simulationReceipt.quoteId !== scopedQuoteId
        || simulationReceipt.receiptDigest !== applyReceipt.simulationDigest
      ) {
        throw new DecisionDebtError(
          "failed-precondition",
          "Decision Debt simulation evidence does not match the active apply receipt."
        );
      }
      candidates.push(...decisionDebtAuthority.buildCandidatesFromInvalidations({
        quoteId: scopedQuoteId,
        customerId: verifiedState.customerId,
        eventDate: verifiedState.eventDate,
        invalidations,
        policy: policyRecord.policy,
        commercialExposureCents: decisionDebtCommercialExposureCents(simulationReceipt)
      }));
    }
    const snapshot = decisionDebtAuthority.deriveSnapshot({
      candidates,
      policy: policyRecord.policy,
      nowISO: observedAtISO,
      tenantTimeZone,
      limit
    });
    return {
      ok: true,
      storage: "firebase",
      organizationId,
      ...(quoteId ? { quoteId } : {}),
      ...(policyRecord.policyVersion ? { policyVersion: policyRecord.policyVersion } : {}),
      snapshot
    };
  } catch (error) {
    return throwDecisionDebtFailure(error, "getDecisionDebtSnapshot");
  }
});

exports.configureDecisionDebtPolicy = functions.region(REGION).https.onCall(async (data, context) => {
  const organizationId = normalizeOrganizationId(data?.organizationId);
  const requestId = decisionDebtRequestId(data?.requestId);
  const staff = assertAdminStaff(await assertStaff(context, {
    expectedOrganizationId: organizationId
  }));
  if (!organizationId || normalizeOrganizationId(staff.principalOrganizationId) !== organizationId) {
    throw new functions.https.HttpsError(
      "permission-denied",
      "Decision Debt policy requires same-organization administrator authority."
    );
  }
  try {
    const policy = decisionDebtAuthority.validatePolicy(data?.policy);
    const policyRef = db.collection(ORGANIZATIONS_COLLECTION)
      .doc(organizationId)
      .collection(DECISION_DEBT_POLICIES_COLLECTION)
      .doc("current");
    const requestFingerprint = createHash("sha256")
      .update(commercialDependencyGraphCore.canonicalSerialize({ organizationId, policy }))
      .digest("hex");
    const nowISO = new Date().toISOString();
    const result = await db.runTransaction(async (tx) => {
      const currentSnap = await tx.get(policyRef);
      const current = decisionDebtPolicyRecord(
        currentSnap.exists ? currentSnap.data() || {} : null
      );
      if (current.lastMutation?.requestId === requestId) {
        if (current.lastMutation.requestFingerprint !== requestFingerprint) {
          throw new DecisionDebtError(
            "already-exists",
            "Decision Debt request identity was reused with different policy content."
          );
        }
        return {
          idempotent: true,
          policy: current.policy,
          policyVersion: current.policyVersion,
          recordedAtISO: current.configuredAtISO
        };
      }
      const expectedPolicyVersion = normalizeText(data?.expectedPolicyVersion);
      if (expectedPolicyVersion && expectedPolicyVersion !== current.policyVersion) {
        throw new DecisionDebtError(
          "aborted",
          "Decision Debt policy changed after this form was loaded."
        );
      }
      const revision = current.revision + 1;
      const policyVersion = `decision-debt-policy-r${revision}`;
      tx.set(policyRef, {
        ...policy,
        authorityState: "configured",
        revision,
        policyVersion,
        configuredAtISO: nowISO,
        configuredBy: staff.uid,
        lastMutation: { requestId, requestFingerprint },
        updatedAt: FieldValue.serverTimestamp()
      });
      return {
        idempotent: false,
        policy,
        policyVersion,
        recordedAtISO: nowISO
      };
    });
    return {
      ok: true,
      storage: "firebase",
      organizationId,
      policyVersion: result.policyVersion,
      policy: result.policy,
      idempotent: result.idempotent,
      receipt: {
        requestId,
        operation: "configure_policy",
        organizationId,
        policyVersion: result.policyVersion,
        recordedAtISO: result.recordedAtISO
      }
    };
  } catch (error) {
    return throwDecisionDebtFailure(error, "configureDecisionDebtPolicy");
  }
});

exports.getRevenueAutopilotOperations = functions.region(REGION).https.onCall(async (data, context) => {
  const organizationId = normalizeOrganizationId(data?.organizationId);
  const quoteId = normalizeText(data?.quoteId);
  const jobLimit = Number(data?.jobLimit ?? 100);
  const attentionLimit = Number(data?.attentionLimit ?? 50);
  const staff = await assertStaff(context, { expectedOrganizationId: organizationId });
  if (!organizationId) {
    throw new functions.https.HttpsError("invalid-argument", "organizationId is required.");
  }
  if (
    normalizeOrganizationId(staff.principalOrganizationId) !== organizationId
    || !Number.isSafeInteger(jobLimit)
    || jobLimit < 1
    || jobLimit > 100
    || !Number.isSafeInteger(attentionLimit)
    || attentionLimit < 1
    || attentionLimit > 50
  ) {
    throw new functions.https.HttpsError(
      "invalid-argument",
      "Revenue Autopilot operations require same-organization staff and bounded read limits."
    );
  }

  try {
    const refs = revenueAutopilotRefs(organizationId, { quoteId });
    const observedAtISO = new Date().toISOString();
    let jobsQuery = refs.jobsRef;
    let attentionQuery = refs.attentionRef
      .where("type", "==", "unread_customer_reply")
      .where("state", "==", "open");
    if (quoteId) {
      jobsQuery = jobsQuery.where("quoteId", "==", quoteId);
      attentionQuery = attentionQuery.where("quoteId", "==", quoteId);
    }
    const [policySnap, jobsSnap, attentionSnap] = await Promise.all([
      refs.policyRef.get(),
      jobsQuery.limit(jobLimit + 1).get(),
      attentionQuery.limit(attentionLimit + 1).get()
    ]);
    const policy = normalizeRevenueAutopilotTenantPolicy(
      policySnap.exists ? policySnap.data() || {} : null
    );
    const global = getRevenueAutopilotGlobalControl(observedAtISO);
    const authority = projectRevenueAutopilotAuthorityForStaff({
      organizationId,
      policy,
      provider: global.provider,
      observedAtISO
    });
    const jobDocs = jobsSnap.docs.slice(0, jobLimit);
    const attentionDocs = attentionSnap.docs.slice(0, attentionLimit);
    const jobsTruncated = jobsSnap.docs.length > jobLimit;
    const attentionTruncated = attentionSnap.docs.length > attentionLimit;
    const jobs = jobDocs
      .map((snapshot) => projectRevenueAutopilotJobForStaff({
        jobId: snapshot.id,
        ...(snapshot.data() || {})
      }))
      .sort((left, right) => (
        String(right.createdAtISO).localeCompare(String(left.createdAtISO))
        || String(left.jobId).localeCompare(String(right.jobId))
      ));
    const attention = attentionDocs
      .map((snapshot) => projectRevenueAutopilotAttentionForStaff({
        attentionId: snapshot.id,
        ...(snapshot.data() || {})
      }))
      .sort((left, right) => (
        String(right.openedAtISO).localeCompare(String(left.openedAtISO))
        || String(left.attentionId).localeCompare(String(right.attentionId))
      ));
    const truncated = jobsTruncated || attentionTruncated;
    const providerOutcomes = Object.fromEntries([
      "provider_accepted",
      "delivered",
      "bounced",
      "complained"
    ].map((state) => [state, jobs.filter((job) => job.state === state).length]));
    return {
      ok: true,
      storage: "firebase",
      organizationId,
      ...(quoteId ? { quoteId } : {}),
      policy: revenueAutopilotPublicPolicy(policy, global, authority.provider),
      jobs,
      attention,
      bounds: {
        totalJobs: jobs.length + (jobsTruncated ? 1 : 0),
        maximumJobs: jobLimit,
        totalAttention: attention.length + (attentionTruncated ? 1 : 0),
        maximumAttention: attentionLimit,
        complete: !truncated,
        truncated
      },
      providerOutcomes,
      source: "firebase_server_projection",
      observedAtISO,
      readState: jobs.length || attention.length ? "success" : "empty"
    };
  } catch (error) {
    return throwRevenueAutopilotFailure(error, "getRevenueAutopilotOperations");
  }
});

function projectRevenueAutopilotCustomerControls({
  organizationId,
  customerId,
  controlsRaw = null,
  controlsExist = false,
  observedAtISO
} = {}) {
  if (controlsExist && (
    !controlsRaw
    || typeof controlsRaw !== "object"
    || Number(controlsRaw.schemaVersion) !== 1
    || normalizeText(controlsRaw.authorityState).toLowerCase() !== "configured"
  )) {
    throw new RevenueAutopilotAuthorityError(
      "failed-precondition",
      "Stored customer email controls do not satisfy the current authority contract."
    );
  }
  const controls = normalizeRevenueAutopilotEmailControls(
    controlsExist ? controlsRaw : null,
    { organizationId, customerId }
  );
  const configured = controls.authorityState === "configured";
  return {
    schemaVersion: 1,
    authority: "server_projection",
    source: "firebase_server_projection",
    organizationId,
    customerId,
    observedAtISO,
    authorityState: configured ? "configured" : "dormant",
    revision: configured ? controls.revision : 0,
    consent: configured
      ? {
          state: controls.consent.state,
          recordedAtISO: controls.consent.recordedAtISO
        }
      : { state: "unknown", recordedAtISO: "" },
    subscription: configured
      ? {
          state: controls.subscription.state,
          recordedAtISO: controls.subscription.recordedAtISO
        }
      : { state: "unknown", recordedAtISO: "" }
  };
}

exports.getRevenueAutopilotCustomerControls = functions.region(REGION).https.onCall(async (data, context) => {
  const organizationId = normalizeOrganizationId(data?.organizationId);
  const customerId = normalizeText(data?.customerId);
  const staff = await assertStaff(context, { expectedOrganizationId: organizationId });
  if (
    !organizationId
    || !customerId
    || /[\s/?#\\\u0000]/u.test(customerId)
    || normalizeOrganizationId(staff.principalOrganizationId) !== organizationId
  ) {
    throw new functions.https.HttpsError(
      "permission-denied",
      "Customer reminder controls require an exact same-organization staff scope."
    );
  }
  try {
    const refs = revenueAutopilotRefs(organizationId, { customerId });
    const observedAtISO = new Date().toISOString();
    const [customerSnap, controlsSnap] = await Promise.all([
      refs.customerRef.get(),
      refs.customerControlsRef.get()
    ]);
    if (!customerSnap.exists) {
      throw new RevenueAutopilotAuthorityError("not-found", "Customer not found.");
    }
    const customer = customerSnap.data() || {};
    if (
      normalizeOrganizationId(customer.organizationId || organizationId) !== organizationId
      || normalizeText(customer.customerId || customerSnap.id) !== customerId
    ) {
      throw new RevenueAutopilotAuthorityError(
        "permission-denied",
        "Customer is outside this organization."
      );
    }
    const controls = projectRevenueAutopilotCustomerControls({
      organizationId,
      customerId,
      controlsRaw: controlsSnap.exists ? controlsSnap.data() || {} : null,
      controlsExist: controlsSnap.exists,
      observedAtISO
    });
    return {
      ok: true,
      storage: "firebase",
      organizationId,
      customerId,
      controls
    };
  } catch (error) {
    return throwRevenueAutopilotFailure(error, "getRevenueAutopilotCustomerControls");
  }
});

exports.configureRevenueAutopilotPolicy = functions.region(REGION).https.onCall(async (data, context) => {
  const organizationId = normalizeOrganizationId(data?.organizationId);
  const requestId = revenueAutopilotRequestId(data?.requestId);
  const staff = assertAdminStaff(await assertStaff(context, {
    expectedOrganizationId: organizationId
  }));
  if (!organizationId || normalizeOrganizationId(staff.principalOrganizationId) !== organizationId) {
    throw new functions.https.HttpsError(
      "permission-denied",
      "Revenue Autopilot policy requires same-organization administrator authority."
    );
  }

  try {
    const refs = revenueAutopilotRefs(organizationId);
    const nowISO = new Date().toISOString();
    const receiptRef = revenueAutopilotReceiptRef(refs, "configure_policy", requestId);
    const result = await db.runTransaction(async (tx) => {
      const [policySnap, receiptSnap] = await Promise.all([
        tx.get(refs.policyRef),
        tx.get(receiptRef)
      ]);
      const currentPolicy = normalizeRevenueAutopilotTenantPolicy(
        policySnap.exists ? policySnap.data() || {} : null
      );
      const expectedPolicyVersion = normalizeText(data?.expectedPolicyVersion);
      if (expectedPolicyVersion && expectedPolicyVersion !== currentPolicy.policyVersion) {
        throw new RevenueAutopilotAuthorityError(
          "aborted",
          "Revenue Autopilot policy changed after this form was loaded."
        );
      }
      const planned = planRevenueAutopilotAdminConfiguration({
        request: clientPolicyToAuthorityRequest({
          organizationId,
          requestId,
          policy: data?.policy,
          currentPolicy
        }),
        currentPolicy,
        actor: { uid: staff.uid, role: staff.role, organizationId },
        nowISO
      });
      const recordedAtISO = normalizeText(planned.receipt.configuredAtISO) || nowISO;
      const publicReceipt = revenueAutopilotReceipt({
        requestId,
        operation: "configure_policy",
        organizationId,
        policyVersion: planned.policy.policyVersion,
        recordedAtISO
      });
      if (!receiptSnap.exists) {
        tx.create(receiptRef, {
          ...publicReceipt,
          authorityReceipt: planned.receipt,
          createdAt: FieldValue.serverTimestamp()
        });
      }
      if (!planned.idempotent) {
        tx.set(refs.policyRef, {
          ...planned.policy,
          updatedAt: FieldValue.serverTimestamp()
        });
        tx.set(refs.tenantRegistryRef, {
          organizationId,
          authorityState: planned.policy.authorityState,
          enabled: planned.policy.enabled === true,
          policyVersion: planned.policy.policyVersion,
          timeZone: planned.policy.timeZone,
          updatedAtISO: recordedAtISO,
          updatedAt: FieldValue.serverTimestamp()
        }, { merge: true });
      }
      return {
        idempotent: planned.idempotent || receiptSnap.exists,
        policyVersion: planned.policy.policyVersion,
        receipt: publicReceipt
      };
    });
    return {
      ok: true,
      storage: "firebase",
      organizationId,
      ...result
    };
  } catch (error) {
    return throwRevenueAutopilotFailure(error, "configureRevenueAutopilotPolicy");
  }
});

exports.configureRevenueAutopilotCustomerControls = functions
  .region(REGION)
  .runWith({ secrets: [REVENUE_AUTOPILOT_TOKEN_SECRET_NAME] })
  .https.onCall(async (data, context) => {
    const organizationId = normalizeOrganizationId(data?.organizationId);
    const customerId = normalizeText(data?.customerId);
    const requestId = revenueAutopilotRequestId(data?.requestId);
    const expectedRevision = Number(data?.expectedRevision);
    const staff = assertAdminStaff(await assertStaff(context, {
      expectedOrganizationId: organizationId
    }));
    if (!organizationId || !customerId) {
      throw new functions.https.HttpsError(
        "invalid-argument",
        "Customer reminder controls require organizationId and customerId."
      );
    }
    if (normalizeOrganizationId(staff.principalOrganizationId) !== organizationId) {
      throw new functions.https.HttpsError(
        "permission-denied",
        "Customer reminder controls require same-organization administrator authority."
      );
    }
    if (!Number.isSafeInteger(expectedRevision) || expectedRevision < 0) {
      throw new functions.https.HttpsError(
        "invalid-argument",
        "Customer reminder controls require the observed nonnegative revision."
      );
    }

    try {
      const secret = revenueAutopilotTokenSecret();
      const refs = revenueAutopilotRefs(organizationId, { customerId });
      const nowISO = new Date().toISOString();
      const receiptRef = revenueAutopilotReceiptRef(
        refs,
        "configure_customer_controls",
        requestId
      );
      const result = await db.runTransaction(async (tx) => {
        const [customerSnap, controlsSnap, receiptSnap] = await Promise.all([
          tx.get(refs.customerRef),
          tx.get(refs.customerControlsRef),
          tx.get(receiptRef)
        ]);
        if (!customerSnap.exists) {
          throw new RevenueAutopilotAuthorityError("not-found", "Customer not found.");
        }
        const customer = customerSnap.data() || {};
        if (normalizeOrganizationId(customer.organizationId || organizationId) !== organizationId) {
          throw new RevenueAutopilotAuthorityError(
            "permission-denied",
            "Customer is outside this organization."
          );
        }
        const currentRaw = controlsSnap.exists ? controlsSnap.data() || {} : null;
        const currentControls = normalizeRevenueAutopilotEmailControls(currentRaw, {
          organizationId,
          customerId
        });
        const planned = planRevenueAutopilotEmailControlUpdate({
          request: {
            organizationId,
            customerId,
            requestId,
            expectedRevision,
            consentState: normalizeText(data?.consentState).toLowerCase(),
            subscriptionState: normalizeText(data?.subscriptionState).toLowerCase()
          },
          currentControls,
          customer: {
            id: customerId,
            organizationId,
            normalizedEmail: normalizeEmail(
              customer.emailKey || customer.email || customer.contact?.email
            )
          },
          actor: { uid: staff.uid, role: staff.role, organizationId },
          nowISO,
          secret
        });
        const token = buildRevenueAutopilotUnsubscribeToken({
          organizationId,
          customerId,
          secret
        });
        const tokenHash = hashRevenueAutopilotUnsubscribeToken({
          token,
          organizationId,
          customerId,
          secret
        });
        const suppression = revenueAutopilotSuppressionEvidence(currentRaw, {
          organizationId,
          customerId,
          recipientKey: planned.controls.recipientKey,
          nowISO
        });
        const publicReceipt = revenueAutopilotReceipt({
          requestId,
          operation: "configure_customer_controls",
          organizationId,
          customerId,
          recordedAtISO: normalizeText(planned.receipt.recordedAtISO) || nowISO
        });
        if (!receiptSnap.exists) {
          tx.create(receiptRef, {
            ...publicReceipt,
            authorityReceipt: planned.receipt,
            createdAt: FieldValue.serverTimestamp()
          });
        }
        if (!planned.idempotent) {
          tx.set(refs.customerControlsRef, {
            ...planned.controls,
            unsubscribeTokenHash: tokenHash,
            suppression,
            updatedAt: FieldValue.serverTimestamp()
          });
        }
        return {
          idempotent: planned.idempotent || receiptSnap.exists,
          receipt: publicReceipt
        };
      });
      return {
        ok: true,
        storage: "firebase",
        organizationId,
        customerId,
        ...result
      };
    } catch (error) {
      return throwRevenueAutopilotFailure(error, "configureRevenueAutopilotCustomerControls");
    }
  });

exports.materializeRevenueAutopilotJobs = functions
  .region(REGION)
  .runWith({ secrets: [REVENUE_AUTOPILOT_TOKEN_SECRET_NAME] })
  .https.onCall(async (data, context) => {
    const organizationId = normalizeOrganizationId(data?.organizationId);
    const quoteId = normalizeText(data?.quoteId);
    const requestId = revenueAutopilotRequestId(data?.requestId);
    const staff = await assertStaff(context, { expectedOrganizationId: organizationId });
    if (
      !organizationId
      || !quoteId
      || normalizeOrganizationId(staff.principalOrganizationId) !== organizationId
    ) {
      throw new functions.https.HttpsError(
        "permission-denied",
        "Revenue Autopilot materialization requires same-organization staff authority."
      );
    }

    try {
      const secret = revenueAutopilotTokenSecret();
      const refs = revenueAutopilotRefs(organizationId, { quoteId });
      const receiptRef = revenueAutopilotReceiptRef(refs, "materialize_jobs", requestId);
      const nowISO = new Date().toISOString();
      const result = await db.runTransaction(async (tx) => {
        const [receiptSnap, quoteSnap, policySnap, organizationSnap] = await Promise.all([
          tx.get(receiptRef),
          tx.get(refs.quoteRef),
          tx.get(refs.policyRef),
          tx.get(refs.organizationRef)
        ]);
        if (receiptSnap.exists) {
          const prior = receiptSnap.data() || {};
          if (
            normalizeText(prior.organizationId) !== organizationId
            || normalizeText(prior.quoteId) !== quoteId
            || normalizeText(prior.requestId) !== requestId
          ) {
            throw new RevenueAutopilotAuthorityError(
              "already-exists",
              "Revenue Autopilot request identity is bound to different materialization evidence."
            );
          }
          return {
            idempotent: true,
            receipt: revenueAutopilotReceipt({
              requestId,
              operation: "materialize_jobs",
              organizationId,
              quoteId,
              recordedAtISO: normalizeText(prior.recordedAtISO)
            }),
            createdCount: Number.isSafeInteger(Number(prior.createdCount))
              ? Math.max(0, Number(prior.createdCount))
              : 0,
            updatedCount: Number.isSafeInteger(Number(prior.updatedCount))
              ? Math.max(0, Number(prior.updatedCount))
              : 0,
            laneResults: prior.laneResults && typeof prior.laneResults === "object"
              ? prior.laneResults
              : {}
          };
        }
        if (!quoteSnap.exists || !organizationSnap.exists) {
          throw new RevenueAutopilotAuthorityError("not-found", "Quote not found.");
        }
        const quote = { id: quoteId, ...(quoteSnap.data() || {}) };
        if (
          normalizeOrganizationId(quote.organizationId) !== organizationId
          || !normalizeText(quote.customerId)
        ) {
          throw new RevenueAutopilotAuthorityError(
            "failed-precondition",
            "Revenue Autopilot requires one stable same-organization customer identity."
          );
        }
        const customerId = normalizeText(quote.customerId);
        const portalKey = normalizeText(quote.portalKey);
        if (!/^[A-Za-z0-9_-]{20,128}$/u.test(portalKey)) {
          throw new RevenueAutopilotAuthorityError(
            "failed-precondition",
            "Deliver the current secure proposal before preparing reminder records."
          );
        }
        const portalRef = db.collection(PORTAL_COLLECTION).doc(portalKey);
        const customerRef = refs.customersRef.doc(customerId);
        const controlsRef = refs.controlsRef.doc(customerId);
        const acceptanceReceiptId = normalizeText(quote.acceptanceReceipt?.receiptId);
        const acceptanceRef = acceptanceReceiptId
          ? refs.organizationRef
            .collection(PROPOSAL_ACCEPTANCE_RECEIPTS_COLLECTION)
            .doc(acceptanceReceiptId)
          : null;
        const closeoutId = normalizeText(quote.workflow?.postEventCloseout?.closeoutId);
        const closeoutRef = /^[A-Za-z0-9][A-Za-z0-9_.:@-]{0,255}$/u.test(closeoutId)
          ? refs.organizationRef.collection(POST_EVENT_CLOSEOUTS_COLLECTION).doc(closeoutId)
          : null;
        const jobsQuery = refs.jobsRef.where("quoteId", "==", quoteId).limit(100);
        const webhookQuery = db.collection(WEBHOOK_EVENTS_COLLECTION)
          .where("organizationId", "==", organizationId)
          .limit(100);
        const reads = [
          tx.get(portalRef),
          tx.get(customerRef),
          tx.get(controlsRef),
          tx.get(jobsQuery),
          tx.get(webhookQuery),
          acceptanceRef ? tx.get(acceptanceRef) : Promise.resolve(null),
          closeoutRef ? tx.get(closeoutRef) : Promise.resolve(null)
        ];
        const [
          portalSnap,
          customerSnap,
          controlsSnap,
          jobsSnap,
          webhookSnap,
          acceptanceSnap,
          closeoutSnap
        ] = await Promise.all(reads);
        if (!portalSnap.exists || !customerSnap.exists) {
          throw new RevenueAutopilotAuthorityError(
            "failed-precondition",
            "The current proposal or customer projection is unavailable."
          );
        }
        const portal = portalSnap.data() || {};
        const customer = customerSnap.data() || {};
        if (
          normalizeOrganizationId(portal.organizationId) !== organizationId
          || normalizeText(portal.quoteId) !== quoteId
          || normalizeOrganizationId(customer.organizationId || organizationId) !== organizationId
        ) {
          throw new RevenueAutopilotAuthorityError(
            "permission-denied",
            "Revenue Autopilot source evidence is outside this quote scope."
          );
        }
        const policy = normalizeRevenueAutopilotTenantPolicy(
          policySnap.exists ? policySnap.data() || {} : null
        );
        const controlsRaw = controlsSnap.exists ? controlsSnap.data() || {} : null;
        const controls = normalizeRevenueAutopilotEmailControls(controlsRaw, {
          organizationId,
          customerId
        });
        const global = getRevenueAutopilotGlobalControl(nowISO);
        const provider = { organizationId, ...global.provider };
        const suppression = revenueAutopilotSuppressionEvidence(controlsRaw, {
          organizationId,
          customerId,
          recipientKey: controls.recipientKey,
          nowISO
        });
        const existingJobs = jobsSnap.docs.map((snapshot) => ({
          jobId: snapshot.id,
          ...(snapshot.data() || {})
        }));
        const webhookEvents = webhookSnap.docs.map((snapshot) => ({
          eventId: snapshot.id,
          ...(snapshot.data() || {})
        }));
        const canonicalBase = {
          quote,
          portal: revenueAutopilotPortalEvidence({
            quote,
            portal,
            organizationId,
            quoteId
          })
        };
        if (acceptanceSnap?.exists) {
          canonicalBase.acceptance = revenueAutopilotAcceptanceEvidence({
            receipt: acceptanceSnap.data() || {},
            organizationId,
            quoteId
          });
        }
        if (closeoutSnap?.exists) {
          canonicalBase.postEventCloseout = {
            closeoutId: closeoutSnap.id,
            ...(closeoutSnap.data() || {})
          };
        }
        const portalUrl = resolvePortalLink(quote);
        const unsubscribeUrl = revenueAutopilotUnsubscribeUrl({
          organizationId,
          customerId,
          secret
        });
        const customerEmail = normalizeEmail(
          customer.emailKey || customer.email || quote.customer?.email
        );
        if (!isValidEmail(customerEmail)) {
          throw new RevenueAutopilotAuthorityError(
            "failed-precondition",
            "Customer reminder email is unavailable."
          );
        }
        const laneResults = {};
        let createdCount = 0;
        let updatedCount = 0;
        const portalExpiresAtISO = normalizeText(quote.portalExpiresAtISO || quote.expiresAtISO);
        const portalExpired = Boolean(portalExpiresAtISO && portalExpiresAtISO <= nowISO);

        for (const kind of [
          "quote_follow_up",
          "deposit_reminder",
          "final_balance_reminder",
          "post_event_review_request"
        ]) {
          try {
            if (portalExpired && kind !== "post_event_review_request") {
              const expiryUpdates = planRevenueAutopilotJobStops({
                jobs: existingJobs.filter((job) => normalizeText(job.kind).toLowerCase() === kind),
                reason: "portal_expired",
                nowISO
              });
              laneResults[kind] = {
                state: "stopped",
                createCount: 0,
                updateCount: expiryUpdates.length,
                conflictCount: 0,
                reasonCodes: ["portal_expired"]
              };
              for (const update of expiryUpdates) {
                tx.set(refs.jobsRef.doc(update.jobId), {
                  ...update,
                  updatedAtISO: nowISO,
                  updatedAt: FieldValue.serverTimestamp()
                }, { merge: true });
                updatedCount += 1;
              }
              continue;
            }
            const canonical = { ...canonicalBase };
            if (new Set(["deposit_reminder", "final_balance_reminder"]).has(kind)) {
              canonical.deposit = revenueAutopilotDepositEvidence({
                quote,
                organizationId,
                quoteId,
                webhookEvents,
                observedAtISO: nowISO
              });
            }
            if (kind !== "quote_follow_up" && !canonical.acceptance) {
              throw new RevenueAutopilotAuthorityError(
                "failed-precondition",
                "This Revenue Autopilot lane requires exact proposal acceptance evidence."
              );
            }
            if (kind === "final_balance_reminder") {
              canonical.finalBalance = revenueAutopilotFinalBalanceEvidence({
                quote,
                organizationId,
                quoteId,
                observedAtISO: nowISO
              });
            }
            const planned = planRevenueAutopilotMaterializationFromCanonical({
              request: { organizationId, quoteId, kind },
              canonical,
              policy,
              emailControls: controls,
              provider,
              suppression,
              global: { enabled: global.enabled, sendsEnabled: global.sendsEnabled },
              existingJobs
            }, { nowISO });
            laneResults[kind] = {
              state: normalizeText(planned.plan.state),
              createCount: planned.plan.create.length,
              updateCount: planned.plan.updates.length,
              conflictCount: planned.plan.conflicts.length,
              reasonCodes: [
                ...(planned.plan.stop?.reasons || []),
                ...(planned.plan.gate?.reasons || [])
              ].map((reason) => normalizeText(reason?.code)).filter(Boolean).slice(0, 10)
            };
            if (planned.plan.conflicts.length) {
              throw new RevenueAutopilotAuthorityError(
                "aborted",
                `Frozen ${kind} job content conflicts with the current policy version.`
              );
            }
            for (const update of planned.plan.updates) {
              tx.set(refs.jobsRef.doc(update.jobId), {
                ...update,
                updatedAtISO: nowISO,
                updatedAt: FieldValue.serverTimestamp()
              }, { merge: true });
              updatedCount += 1;
            }
            for (const job of planned.plan.create) {
              const rendered = renderRevenueAutopilotTemplate(
                policy.templates[kind],
                revenueAutopilotTemplateValues({
                  quote,
                  organization: organizationSnap.data() || {},
                  portalUrl,
                  reviewUrl: policy.reviewRequestUrl,
                  unsubscribeUrl,
                  kind
                })
              );
              tx.create(refs.jobsRef.doc(job.jobId), {
                ...job,
                customerId,
                quoteLabel: normalizeText(quote.quoteNumber) || quoteId,
                customerLabel: normalizeText(customer.name || quote.customer?.name),
                recipientKey: controls.recipientKey,
                frozenPayload: {
                  toEmail: customerEmail,
                  subject: rendered.subject,
                  text: rendered.text,
                  html: rendered.html,
                  templateFingerprint: rendered.templateFingerprint
                },
                sourceRevisionId: normalizeText(quote.activeVersionId),
                createdAt: FieldValue.serverTimestamp(),
                updatedAt: FieldValue.serverTimestamp()
              });
              createdCount += 1;
            }
          } catch (laneError) {
            if (
              laneError instanceof RevenueAutopilotError
              || laneError instanceof RevenueAutopilotAuthorityError
              || laneError instanceof RevenueAutopilotTemplateError
              || laneError instanceof PaymentLedgerError
            ) {
              laneResults[kind] = {
                state: "blocked",
                createCount: 0,
                updateCount: 0,
                conflictCount: 0,
                reasonCodes: [normalizeText(laneError.code) || "failed_precondition"],
                detail: normalizeText(laneError.message).slice(0, 240)
              };
              continue;
            }
            throw laneError;
          }
        }
        const publicReceipt = revenueAutopilotReceipt({
          requestId,
          operation: "materialize_jobs",
          organizationId,
          quoteId,
          recordedAtISO: nowISO
        });
        tx.create(receiptRef, {
          ...publicReceipt,
          customerId,
          policyVersion: policy.policyVersion,
          laneResults,
          createdCount,
          updatedCount,
          createdAt: FieldValue.serverTimestamp()
        });
        return {
          idempotent: false,
          receipt: publicReceipt,
          createdCount,
          updatedCount,
          laneResults
        };
      });
      return {
        ok: true,
        storage: "firebase",
        organizationId,
        quoteId,
        ...result
      };
    } catch (error) {
      return throwRevenueAutopilotFailure(error, "materializeRevenueAutopilotJobs");
    }
  });

exports.acknowledgeRevenueAutopilotReply = functions.region(REGION).https.onCall(async (data, context) => {
  const organizationId = normalizeOrganizationId(data?.organizationId);
  const quoteId = normalizeText(data?.quoteId);
  const attentionId = normalizeText(data?.attentionId);
  const requestedMessageId = normalizeText(data?.messageId);
  const requestId = revenueAutopilotRequestId(data?.requestId);
  const staff = await assertStaff(context, { expectedOrganizationId: organizationId });
  if (
    !organizationId
    || !quoteId
    || !attentionId
    || !requestedMessageId
    || normalizeOrganizationId(staff.principalOrganizationId) !== organizationId
  ) {
    throw new functions.https.HttpsError(
      "permission-denied",
      "Manual reply acknowledgement requires same-organization staff authority and an exact message identity."
    );
  }
  try {
    const refs = revenueAutopilotRefs(organizationId, { quoteId });
    const attentionRef = refs.attentionRef.doc(attentionId);
    const conversationRefs = portalConversationRefs(organizationId, quoteId);
    const receiptRef = revenueAutopilotReceiptRef(refs, "acknowledge_reply", requestId);
    const nowISO = new Date().toISOString();
    const result = await db.runTransaction(async (tx) => {
      const [quoteSnap, attentionSnap, stateSnap, publicReceiptSnap] = await Promise.all([
        tx.get(refs.quoteRef),
        tx.get(attentionRef),
        tx.get(conversationRefs.stateRef),
        tx.get(receiptRef)
      ]);
      if (!quoteSnap.exists || !attentionSnap.exists || !stateSnap.exists) {
        throw new RevenueAutopilotAuthorityError(
          "not-found",
          "Unread customer-reply attention was not found."
        );
      }
      const quote = { id: quoteId, ...(quoteSnap.data() || {}) };
      const attention = { attentionId, ...(attentionSnap.data() || {}) };
      const state = stateSnap.data() || {};
      if (
        normalizeOrganizationId(quote.organizationId) !== organizationId
        || normalizeText(attention.organizationId) !== organizationId
        || normalizeText(attention.quoteId) !== quoteId
      ) {
        throw new RevenueAutopilotAuthorityError(
          "permission-denied",
          "Unread-reply attention is outside this quote scope."
        );
      }
      const messageId = normalizeText(attention.messageId);
      if (messageId !== requestedMessageId) {
        throw new RevenueAutopilotAuthorityError(
          "aborted",
          "Unread-reply attention changed after the conversation action was selected."
        );
      }
      const latestMessageRef = conversationRefs.messagesRef.doc(messageId);
      const latestMessageSnap = await tx.get(latestMessageRef);
      if (!latestMessageSnap.exists) {
        throw new RevenueAutopilotAuthorityError(
          "failed-precondition",
          "The exact latest customer message is unavailable."
        );
      }
      const latestMessage = { id: latestMessageSnap.id, ...(latestMessageSnap.data() || {}) };
      const exactState = {
        ...state,
        latestActorType: normalizeText(state.latestActorType)
          || normalizeText(latestMessage.actorType)
      };
      const existingAuthorityReceipt = publicReceiptSnap.exists
        ? publicReceiptSnap.data()?.authorityReceipt || null
        : null;
      const planned = planRevenueAutopilotStaffAcknowledgementReceipt({
        request: { organizationId, quoteId, messageId, requestId },
        quote,
        conversationState: exactState,
        latestMessage,
        existingReceipt: existingAuthorityReceipt,
        actor: { uid: staff.uid, role: staff.role, organizationId },
        nowISO
      });
      const recordedAtISO = normalizeText(planned.receipt.acknowledgedAtISO) || nowISO;
      const publicReceipt = revenueAutopilotReceipt({
        requestId,
        operation: "acknowledge_reply",
        organizationId,
        quoteId,
        attentionId,
        messageId,
        recordedAtISO
      });
      if (!publicReceiptSnap.exists) {
        tx.create(receiptRef, {
          ...publicReceipt,
          authorityReceipt: planned.receipt,
          createdAt: FieldValue.serverTimestamp()
        });
      }
      if (!planned.idempotent) {
        tx.set(conversationRefs.stateRef, {
          staffAcknowledged: {
            latestMessageId: messageId,
            latestMessageAtISO: normalizeText(latestMessage.createdAtISO),
            acknowledgedAtISO: recordedAtISO,
            acknowledgedBy: staff.uid,
            acknowledgedByRole: staff.role,
            receiptId: requestId
          },
          latestActorType: "customer",
          revenueAutopilotAttention: FieldValue.delete(),
          updatedAt: FieldValue.serverTimestamp()
        }, { merge: true });
        tx.set(attentionRef, {
          state: "resolved",
          resolvedAtISO: recordedAtISO,
          resolutionReason: "customer_reply_acknowledged",
          resolvedBy: staff.uid,
          updatedAtISO: recordedAtISO,
          updatedAt: FieldValue.serverTimestamp()
        }, { merge: true });
      }
      return { idempotent: planned.idempotent, receipt: publicReceipt };
    });
    return {
      ok: true,
      storage: "firebase",
      organizationId,
      quoteId,
      attentionId,
      messageId: requestedMessageId,
      ...result
    };
  } catch (error) {
    return throwRevenueAutopilotFailure(error, "acknowledgeRevenueAutopilotReply");
  }
});

exports.reconcileRevenueAutopilotJob = functions
  .region(REGION)
  .runWith({ secrets: [RESEND_API_KEY_SECRET_NAME] })
  .https.onCall(async (data, context) => {
    const organizationId = normalizeOrganizationId(data?.organizationId);
    const quoteId = normalizeText(data?.quoteId);
    const jobId = normalizeText(data?.jobId);
    const requestId = revenueAutopilotRequestId(data?.requestId);
    const staff = await assertStaff(context, { expectedOrganizationId: organizationId });
    if (
      !organizationId
      || !quoteId
      || !jobId
      || normalizeOrganizationId(staff.principalOrganizationId) !== organizationId
    ) {
      throw new functions.https.HttpsError(
        "permission-denied",
        "Revenue Autopilot reconciliation requires same-organization staff authority."
      );
    }
    try {
      const refs = revenueAutopilotRefs(organizationId, { quoteId });
      const jobRef = refs.jobsRef.doc(jobId);
      const receiptRef = revenueAutopilotReceiptRef(refs, "reconcile_job", requestId);
      const claimedAtISO = new Date().toISOString();
      const claimed = await db.runTransaction(async (tx) => {
        const [jobSnap, receiptSnap] = await Promise.all([
          tx.get(jobRef),
          tx.get(receiptRef)
        ]);
        if (receiptSnap.exists) {
          const prior = receiptSnap.data() || {};
          if (
            normalizeText(prior.organizationId) !== organizationId
            || normalizeText(prior.quoteId) !== quoteId
            || normalizeText(prior.jobId) !== jobId
          ) {
            throw new RevenueAutopilotAuthorityError(
              "already-exists",
              "Reconciliation request identity is bound to another job."
            );
          }
          return { idempotent: true, receipt: prior, raw: null };
        }
        if (!jobSnap.exists) {
          throw new RevenueAutopilotAuthorityError("not-found", "Revenue Autopilot job not found.");
        }
        const raw = { jobId, ...(jobSnap.data() || {}) };
        if (
          normalizeText(raw.organizationId) !== organizationId
          || normalizeText(raw.quoteId) !== quoteId
          || normalizeText(raw.state) !== REVENUE_AUTOPILOT_JOB_STATES.OUTCOME_AMBIGUOUS
        ) {
          throw new RevenueAutopilotAuthorityError(
            "failed-precondition",
            "Only this quote's ambiguous Revenue Autopilot outcome can be reconciled."
          );
        }
        const currentRequestId = normalizeText(raw.reconciliation?.requestId);
        const leaseExpiresAtISO = normalizeText(raw.reconciliation?.leaseExpiresAtISO);
        if (
          currentRequestId
          && currentRequestId !== requestId
          && leaseExpiresAtISO > claimedAtISO
        ) {
          throw new RevenueAutopilotAuthorityError(
            "aborted",
            "Another exact Revenue Autopilot reconciliation is in progress."
          );
        }
        tx.set(jobRef, {
          reconciliation: {
            requestId,
            claimedAtISO,
            leaseExpiresAtISO: new Date(Date.parse(claimedAtISO) + 2 * 60 * 1000).toISOString(),
            claimedBy: staff.uid
          },
          updatedAtISO: claimedAtISO,
          updatedAt: FieldValue.serverTimestamp()
        }, { merge: true });
        return { idempotent: false, receipt: null, raw };
      });
      if (claimed.idempotent) {
        const recordedAtISO = normalizeText(claimed.receipt.recordedAtISO);
        return {
          ok: true,
          storage: "firebase",
          organizationId,
          quoteId,
          jobId,
          idempotent: true,
          reconciliationState: normalizeText(claimed.receipt.reconciliationState)
            || "provider_accepted",
          receipt: revenueAutopilotReceipt({
            requestId,
            operation: "reconcile_job",
            organizationId,
            quoteId,
            jobId,
            recordedAtISO
          })
        };
      }
      let recheckedAuthority;
      let rechecked;
      const recheckedAtISO = new Date().toISOString();
      try {
        recheckedAuthority = await readRevenueAutopilotExecutionAuthority({
          organizationId,
          quoteId,
          kind: normalizeText(claimed.raw?.kind).toLowerCase(),
          existingJobs: [claimed.raw],
          nowISO: recheckedAtISO
        });
        if (!recheckedAuthority.quoteActivity.active) {
          const [suppressionUpdate] = planRevenueAutopilotJobStops({
            jobs: [claimed.raw],
            reason: recheckedAuthority.quoteActivity.reason,
            nowISO: recheckedAtISO
          });
          rechecked = {
            action: "reconcile_blocked",
            reason: recheckedAuthority.quoteActivity.reason,
            job: { ...claimed.raw, ...(suppressionUpdate || {}) }
          };
        } else {
          rechecked = planRevenueAutopilotExecution({
            job: claimed.raw,
            global: recheckedAuthority.input.global,
            tenantPolicy: recheckedAuthority.input.tenantPolicy,
            controls: recheckedAuthority.input.controls,
            stopScope: recheckedAuthority.input.stopScope,
            evidence: recheckedAuthority.input.evidence,
            nowISO: recheckedAtISO
          });
        }
      } catch (authorityError) {
        await db.runTransaction(async (tx) => {
          const currentSnap = await tx.get(jobRef);
          if (!currentSnap.exists) return;
          const current = currentSnap.data() || {};
          if (normalizeText(current.reconciliation?.requestId) !== requestId) return;
          tx.set(jobRef, {
            reconciliation: FieldValue.delete(),
            updatedAtISO: recheckedAtISO,
            updatedAt: FieldValue.serverTimestamp()
          }, { merge: true });
        });
        throw authorityError;
      }
      if (rechecked.action !== "reconcile") {
        const withheldAtISO = new Date().toISOString();
        const reason = normalizeText(rechecked.reason) || "reconciliation_authority_withheld";
        const publicReceipt = revenueAutopilotReceipt({
          requestId,
          operation: "reconcile_job",
          organizationId,
          quoteId,
          jobId,
          recordedAtISO: withheldAtISO
        });
        const withheld = await db.runTransaction(async (tx) => {
          const [jobSnap, receiptSnap] = await Promise.all([
            tx.get(jobRef),
            tx.get(receiptRef)
          ]);
          if (receiptSnap.exists) {
            return { idempotent: true, receipt: receiptSnap.data() || {} };
          }
          if (!jobSnap.exists) {
            throw new RevenueAutopilotAuthorityError(
              "not-found",
              "Revenue Autopilot job not found."
            );
          }
          const current = { jobId, ...(jobSnap.data() || {}) };
          if (
            normalizeText(current.state) !== REVENUE_AUTOPILOT_JOB_STATES.OUTCOME_AMBIGUOUS
            || normalizeText(current.reconciliation?.requestId) !== requestId
          ) {
            throw new RevenueAutopilotAuthorityError(
              "aborted",
              "Revenue Autopilot reconciliation authority changed before it was withheld."
            );
          }
          tx.set(jobRef, {
            ...current,
            ...(rechecked.job || {}),
            reconciliation: FieldValue.delete(),
            updatedAtISO: withheldAtISO,
            updatedAt: FieldValue.serverTimestamp()
          });
          tx.create(receiptRef, {
            ...publicReceipt,
            reconciliationState: "withheld",
            outcomeReason: reason,
            createdAt: FieldValue.serverTimestamp()
          });
          return { idempotent: false, receipt: publicReceipt };
        });
        return {
          ok: true,
          storage: "firebase",
          organizationId,
          quoteId,
          jobId,
          idempotent: withheld.idempotent,
          reconciliationState: "withheld",
          reason,
          receipt: revenueAutopilotReceipt({
            requestId,
            operation: "reconcile_job",
            organizationId,
            quoteId,
            jobId,
            recordedAtISO: normalizeText(withheld.receipt.recordedAtISO) || withheldAtISO
          })
        };
      }
      const payload = claimed.raw?.frozenPayload || {};
      if (
        !isValidEmail(payload.toEmail)
        || !normalizeText(payload.subject)
        || !normalizeText(payload.text)
        || !normalizeText(payload.html)
      ) {
        throw new RevenueAutopilotAuthorityError(
          "failed-precondition",
          "The frozen Revenue Autopilot provider request is unavailable."
        );
      }
      const emailConfig = getEmailConfig();
      if (
        emailConfig.provider !== "resend"
        || !emailConfig.resendApiKey
        || !emailConfig.senderApproved
      ) {
        throw new RevenueAutopilotAuthorityError(
          "failed-precondition",
          "The approved Revenue Autopilot provider is not configured."
        );
      }
      const providerResult = await sendEmailViaResend({
        apiKey: emailConfig.resendApiKey,
        from: `${emailConfig.fromName} <${emailConfig.fromEmail}>`,
        to: payload.toEmail,
        subject: payload.subject,
        text: payload.text,
        html: payload.html,
        idempotencyKey: normalizeText(claimed.raw.idempotencyKey)
      });
      const recordedAtISO = new Date().toISOString();
      const resolution = planRevenueAutopilotOutcomeResolution({
        job: claimed.raw,
        resolution: "provider_accepted",
        provider: "resend",
        providerMessageId: providerResult.id,
        providerAcceptedAtISO: recordedAtISO,
        nowISO: recordedAtISO
      });
      const publicReceipt = revenueAutopilotReceipt({
        requestId,
        operation: "reconcile_job",
        organizationId,
        quoteId,
        jobId,
        recordedAtISO
      });
      const messageIndexRef = db.collection(REVENUE_AUTOPILOT_PROVIDER_MESSAGE_INDEX_COLLECTION)
        .doc(createHash("sha256").update(`resend|${providerResult.id}`).digest("hex"));
      await db.runTransaction(async (tx) => {
        const [jobSnap, receiptSnap, indexSnap] = await Promise.all([
          tx.get(jobRef),
          tx.get(receiptRef),
          tx.get(messageIndexRef)
        ]);
        if (receiptSnap.exists) return;
        if (!jobSnap.exists) {
          throw new RevenueAutopilotAuthorityError("not-found", "Revenue Autopilot job not found.");
        }
        const current = { jobId, ...(jobSnap.data() || {}) };
        if (
          normalizeText(current.state) !== REVENUE_AUTOPILOT_JOB_STATES.OUTCOME_AMBIGUOUS
          || normalizeText(current.reconciliation?.requestId) !== requestId
        ) {
          throw new RevenueAutopilotAuthorityError(
            "aborted",
            "Revenue Autopilot reconciliation authority changed before completion."
          );
        }
        tx.set(jobRef, {
          ...current,
          ...resolution.job,
          reconciliation: FieldValue.delete(),
          updatedAtISO: recordedAtISO,
          updatedAt: FieldValue.serverTimestamp()
        });
        tx.create(receiptRef, {
          ...publicReceipt,
          reconciliationState: "provider_accepted",
          provider: "resend",
          providerMessageId: providerResult.id,
          createdAt: FieldValue.serverTimestamp()
        });
        if (!indexSnap.exists) {
          tx.create(messageIndexRef, {
            provider: "resend",
            providerMessageId: providerResult.id,
            organizationId,
            quoteId,
            jobId,
            customerId: normalizeText(current.customerId),
            recipientKey: normalizeText(current.recipientKey),
            providerAcceptedAtISO: recordedAtISO,
            createdAt: FieldValue.serverTimestamp()
          });
        }
      });
      return {
        ok: true,
        storage: "firebase",
        organizationId,
        quoteId,
        jobId,
        idempotent: false,
        reconciliationState: "provider_accepted",
        receipt: publicReceipt
      };
    } catch (error) {
      return throwRevenueAutopilotFailure(error, "reconcileRevenueAutopilotJob");
    }
  });

async function readRevenueAutopilotUnsubscribeContext(token) {
  const secret = revenueAutopilotTokenSecret();
  const scope = parseRevenueAutopilotUnsubscribeToken(token, secret);
  const refs = revenueAutopilotRefs(scope.organizationId, { customerId: scope.customerId });
  const [organizationSnap, customerSnap, controlsSnap] = await Promise.all([
    refs.organizationRef.get(),
    refs.customerRef.get(),
    refs.customerControlsRef.get()
  ]);
  if (
    !organizationSnap.exists
    || !customerSnap.exists
    || !controlsSnap.exists
    || !isOrganizationRecordActive(organizationSnap.data() || {})
  ) {
    throw new RevenueAutopilotAuthorityError("not-found", "Email preference link not found.");
  }
  const customer = customerSnap.data() || {};
  const controlsRaw = controlsSnap.data() || {};
  if (
    normalizeOrganizationId(customer.organizationId || scope.organizationId) !== scope.organizationId
    || !verifyRevenueAutopilotUnsubscribeToken({
      token: scope.token,
      organizationId: scope.organizationId,
      customerId: scope.customerId,
      secret,
      storedHash: controlsRaw.unsubscribeTokenHash
    })
  ) {
    throw new RevenueAutopilotAuthorityError("not-found", "Email preference link not found.");
  }
  const controls = normalizeRevenueAutopilotEmailControls(controlsRaw, {
    organizationId: scope.organizationId,
    customerId: scope.customerId
  });
  if (controls.authorityState !== "configured") {
    throw new RevenueAutopilotAuthorityError("not-found", "Email preference link not found.");
  }
  const email = normalizeEmail(customer.emailKey || customer.email || customer.contact?.email);
  const [local = "", domain = ""] = email.split("@");
  const recipientLabel = domain
    ? `${local.slice(0, 1) || "•"}${"•".repeat(Math.min(6, Math.max(3, local.length - 1)))}@${domain}`
    : "Customer email on the current relationship";
  return {
    scope,
    refs,
    controls,
    controlsRaw,
    context: {
      organizationName: normalizeText(organizationSnap.data()?.name) || "QuotePilot reminders",
      recipientLabel,
      subscriptionState: controls.subscription.state,
      consentState: controls.consent.state
    }
  };
}

exports.getRevenueAutopilotUnsubscribeContext = functions
  .region(REGION)
  .runWith({ secrets: [REVENUE_AUTOPILOT_TOKEN_SECRET_NAME] })
  .https.onCall(async (data) => {
    const token = normalizeText(data?.token);
    try {
      const result = await readRevenueAutopilotUnsubscribeContext(token);
      return {
        ok: true,
        storage: "firebase",
        token,
        context: result.context
      };
    } catch (error) {
      return throwRevenueAutopilotFailure(error, "getRevenueAutopilotUnsubscribeContext");
    }
  });

exports.unsubscribeRevenueAutopilotEmail = functions
  .region(REGION)
  .runWith({ secrets: [REVENUE_AUTOPILOT_TOKEN_SECRET_NAME] })
  .https.onCall(async (data) => {
    const token = normalizeText(data?.token);
    const requestId = revenueAutopilotRequestId(data?.requestId);
    try {
      const initial = await readRevenueAutopilotUnsubscribeContext(token);
      const { scope, refs } = initial;
      const nowISO = new Date().toISOString();
      const receiptRef = revenueAutopilotReceiptRef(refs, "unsubscribe_email", requestId);
      const result = await db.runTransaction(async (tx) => {
        const [controlsSnap, receiptSnap] = await Promise.all([
          tx.get(refs.customerControlsRef),
          tx.get(receiptRef)
        ]);
        if (!controlsSnap.exists) {
          throw new RevenueAutopilotAuthorityError("not-found", "Email preference link not found.");
        }
        const raw = controlsSnap.data() || {};
        const secret = revenueAutopilotTokenSecret();
        if (!verifyRevenueAutopilotUnsubscribeToken({
          token,
          organizationId: scope.organizationId,
          customerId: scope.customerId,
          secret,
          storedHash: raw.unsubscribeTokenHash
        })) {
          throw new RevenueAutopilotAuthorityError("not-found", "Email preference link not found.");
        }
        if (receiptSnap.exists) {
          const prior = receiptSnap.data() || {};
          if (
            normalizeText(prior.requestId) !== requestId
            || normalizeText(prior.tokenHash) !== normalizeText(raw.unsubscribeTokenHash)
          ) {
            throw new RevenueAutopilotAuthorityError(
              "already-exists",
              "This unsubscribe request identity is already bound to different evidence."
            );
          }
          return { idempotent: true, recordedAtISO: normalizeText(prior.recordedAtISO) };
        }
        const controls = normalizeRevenueAutopilotEmailControls(raw, {
          organizationId: scope.organizationId,
          customerId: scope.customerId
        });
        const alreadyUnsubscribed = controls.subscription.state === "unsubscribed";
        tx.set(refs.customerControlsRef, {
          ...controls,
          revision: controls.revision + (alreadyUnsubscribed ? 0 : 1),
          subscription: {
            evidenceId: alreadyUnsubscribed
              ? controls.subscription.evidenceId
              : `unsubscribe_${createHash("sha256")
                .update(`${scope.organizationId}|${scope.customerId}|${requestId}`)
                .digest("hex")}`,
            state: "unsubscribed",
            recordedAtISO: alreadyUnsubscribed ? controls.subscription.recordedAtISO : nowISO,
            source: alreadyUnsubscribed ? controls.subscription.source : "customer_unsubscribe_link"
          },
          unsubscribeTokenHash: normalizeText(raw.unsubscribeTokenHash),
          suppression: raw.suppression || null,
          updatedAt: FieldValue.serverTimestamp()
        });
        tx.create(receiptRef, {
          requestId,
          operation: "unsubscribe_email",
          organizationId: scope.organizationId,
          customerId: scope.customerId,
          tokenHash: normalizeText(raw.unsubscribeTokenHash),
          recordedAtISO: nowISO,
          createdAt: FieldValue.serverTimestamp()
        });
        return { idempotent: alreadyUnsubscribed, recordedAtISO: nowISO };
      });
      const receipt = revenueAutopilotReceipt({
        requestId,
        operation: "unsubscribe_email",
        token,
        recordedAtISO: result.recordedAtISO || nowISO
      });
      return {
        ok: true,
        storage: "firebase",
        token,
        idempotent: result.idempotent,
        receipt
      };
    } catch (error) {
      return throwRevenueAutopilotFailure(error, "unsubscribeRevenueAutopilotEmail");
    }
  });

async function readRevenueAutopilotSchedulerTenantPage({ limit: pageLimit = 25 } = {}) {
  const stateRef = db.collection(REVENUE_AUTOPILOT_SCHEDULER_STATE_COLLECTION).doc("current");
  const registryRef = db.collection(REVENUE_AUTOPILOT_TENANTS_COLLECTION);
  const stateSnap = await stateRef.get();
  const priorCursor = normalizeText(stateSnap.data()?.tenantCursor);
  const buildQuery = (cursor = "") => {
    let tenantQuery = registryRef
      .where("enabled", "==", true)
      .orderBy(FieldPath.documentId())
      .limit(pageLimit);
    if (cursor) tenantQuery = tenantQuery.startAfter(cursor);
    return tenantQuery;
  };
  let tenantSnap = await buildQuery(priorCursor).get();
  let wrapped = false;
  if (!tenantSnap.docs.length && priorCursor) {
    tenantSnap = await buildQuery().get();
    wrapped = true;
  }
  const nextCursor = tenantSnap.docs.length === pageLimit
    ? tenantSnap.docs.at(-1).id
    : "";
  return { stateRef, tenantSnap, priorCursor, nextCursor, wrapped };
}

async function readRevenueAutopilotTenantWorkPage({
  collectionRef,
  cursor = "",
  limit: pageLimit
} = {}) {
  const buildQuery = (startCursor = "") => {
    let workQuery = collectionRef
      .orderBy(FieldPath.documentId())
      .limit(pageLimit);
    if (startCursor) workQuery = workQuery.startAfter(startCursor);
    return workQuery;
  };
  let snapshot = await buildQuery(cursor).get();
  let wrapped = false;
  if (!snapshot.docs.length && cursor) {
    snapshot = await buildQuery().get();
    wrapped = true;
  }
  return {
    snapshot,
    wrapped,
    nextCursor: snapshot.docs.length === pageLimit
      ? snapshot.docs.at(-1).id
      : ""
  };
}

exports.runRevenueAutopilotSchedule = functions
  .region(REGION)
  .runWith({
    secrets: [RESEND_API_KEY_SECRET_NAME, REVENUE_AUTOPILOT_TOKEN_SECRET_NAME],
    timeoutSeconds: 540,
    memory: "512MB"
  })
  .pubsub.schedule("every 15 minutes")
  .timeZone("UTC")
  .onRun(async () => {
    const startedAtISO = new Date().toISOString();
    const global = getRevenueAutopilotGlobalControl(startedAtISO);
    const scheduleMode = planRevenueAutopilotScheduleMode(global);
    if (!scheduleMode.materialize) {
      functions.logger.info("Revenue Autopilot schedule remained dormant", {
        enabled: global.enabled,
        sendsEnabled: global.sendsEnabled,
        providerState: global.provider.state,
        reason: scheduleMode.reason
      });
      return { ok: true, state: "dormant", startedAtISO };
    }
    const tenantPage = await readRevenueAutopilotSchedulerTenantPage({ limit: 25 });
    const tenantSnap = tenantPage.tenantSnap;
    let quotesObserved = 0;
    let jobsCreated = 0;
    let jobsUpdated = 0;
    let attentionCreated = 0;
    let attentionUpdated = 0;
    let dispatchesObserved = 0;
    let failures = 0;
    const perTenantQuoteLimit = 10;
    const perTenantDispatchLimit = 4;

    for (const tenantDoc of tenantSnap.docs) {
      const organizationId = normalizeOrganizationId(
        tenantDoc.data()?.organizationId || tenantDoc.id
      );
      if (!organizationId) continue;
      try {
      const policyRef = db.collection(ORGANIZATIONS_COLLECTION)
        .doc(organizationId)
        .collection(REVENUE_AUTOPILOT_POLICY_COLLECTION)
        .doc("current");
      const policySnap = await policyRef.get();
      let policy;
      try {
        policy = normalizeRevenueAutopilotTenantPolicy(
          policySnap.exists ? policySnap.data() || {} : null
        );
      } catch (error) {
        failures += 1;
        functions.logger.warn("Revenue Autopilot skipped invalid tenant policy", {
          organizationId,
          error: normalizeText(error?.message).slice(0, 200)
        });
        continue;
      }
      if (policy.authorityState !== "configured" || policy.enabled !== true) continue;
      const tenantRegistry = tenantDoc.data() || {};
      const organizationRef = db.collection(ORGANIZATIONS_COLLECTION).doc(organizationId);
      const quotePage = await readRevenueAutopilotTenantWorkPage({
        collectionRef: organizationRef.collection(QUOTES_COLLECTION),
        cursor: normalizeText(tenantRegistry.schedulerQuoteCursor),
        limit: perTenantQuoteLimit
      });
      const quotesSnap = quotePage.snapshot;
      quotesObserved += quotesSnap.docs.length;
      for (const quoteDoc of quotesSnap.docs) {
        try {
          const materialized = await materializeScheduledRevenueAutopilotQuote({
            organizationId,
            quoteId: quoteDoc.id,
            nowISO: new Date().toISOString()
          });
          jobsCreated += materialized.createdCount;
          jobsUpdated += materialized.updatedCount;
          attentionCreated += Number(materialized.attention?.createdCount) || 0;
          attentionUpdated += Number(materialized.attention?.updatedCount) || 0;
        } catch (error) {
          failures += 1;
          functions.logger.warn("Revenue Autopilot quote materialization skipped", {
            organizationId,
            quoteId: quoteDoc.id,
            error: normalizeText(error?.message).slice(0, 200)
          });
        }
      }
      let jobPage = null;
      if (scheduleMode.dispatch) {
        jobPage = await readRevenueAutopilotTenantWorkPage({
          collectionRef: organizationRef.collection(REVENUE_AUTOPILOT_JOBS_COLLECTION),
          cursor: normalizeText(tenantRegistry.schedulerJobCursor),
          limit: perTenantDispatchLimit
        });
        const jobsSnap = jobPage.snapshot;
        for (const jobDoc of jobsSnap.docs) {
          try {
            const outcome = await dispatchRevenueAutopilotJob({
              organizationId,
              jobId: jobDoc.id
            });
            if (!new Set(["none", "wait", "block", "missing"]).has(outcome.action)) {
              dispatchesObserved += 1;
            }
          } catch (error) {
            failures += 1;
            functions.logger.warn("Revenue Autopilot job dispatch skipped", {
              organizationId,
              jobId: jobDoc.id,
              error: normalizeText(error?.message).slice(0, 200)
            });
          }
        }
      }
      await tenantDoc.ref.set({
        schedulerQuoteCursor: quotePage.nextCursor,
        ...(jobPage ? { schedulerJobCursor: jobPage.nextCursor } : {}),
        schedulerCursorUpdatedAtISO: new Date().toISOString(),
        schedulerCursorUpdatedAt: FieldValue.serverTimestamp()
      }, { merge: true });
      } catch (error) {
        failures += 1;
        functions.logger.warn("Revenue Autopilot tenant schedule page skipped", {
          organizationId,
          error: normalizeText(error?.message).slice(0, 200)
        });
      }
    }
    await tenantPage.stateRef.set({
      tenantCursor: tenantPage.nextCursor,
      priorTenantCursor: tenantPage.priorCursor,
      wrapped: tenantPage.wrapped,
      updatedAtISO: new Date().toISOString(),
      updatedAt: FieldValue.serverTimestamp()
    }, { merge: true });
    const completedAtISO = new Date().toISOString();
    functions.logger.info("Revenue Autopilot bounded schedule completed", {
      tenantCount: tenantSnap.docs.length,
      quotesObserved,
      jobsCreated,
      jobsUpdated,
      attentionCreated,
      attentionUpdated,
      dispatchesObserved,
      failures,
      startedAtISO,
      completedAtISO
    });
    return {
      ok: true,
      state: scheduleMode.state,
      tenantCount: tenantSnap.docs.length,
      quotesObserved,
      jobsCreated,
      jobsUpdated,
      attentionCreated,
      attentionUpdated,
      dispatchesObserved,
      failures,
      startedAtISO,
      completedAtISO
    };
  });

exports.revenueAutopilotResendWebhook = functions
  .region(REGION)
  .runWith({ secrets: [RESEND_WEBHOOK_SECRET_NAME] })
  .https.onRequest(async (req, res) => {
    if (req.method !== "POST") {
      res.status(405).send("Method not allowed.");
      return;
    }
    const webhookSecret = normalizeText(process.env[RESEND_WEBHOOK_SECRET_NAME]);
    const eventId = normalizeText(req.headers["svix-id"]);
    const timestamp = normalizeText(req.headers["svix-timestamp"]);
    const signature = normalizeText(req.headers["svix-signature"]);
    const rawPayload = Buffer.isBuffer(req.rawBody)
      ? req.rawBody.toString("utf8")
      : "";
    if (!webhookSecret || !eventId || !timestamp || !signature || !rawPayload) {
      res.status(400).send("Webhook verification evidence is incomplete.");
      return;
    }
    let event;
    try {
      event = new Webhook(webhookSecret).verify(rawPayload, {
        "webhook-id": eventId,
        "webhook-timestamp": timestamp,
        "webhook-signature": signature
      });
    } catch (error) {
      functions.logger.warn("Revenue Autopilot Resend webhook signature rejected", {
        eventId,
        error: normalizeText(error?.message).slice(0, 160)
      });
      res.status(400).send("Invalid webhook signature.");
      return;
    }
    const providerMessageId = normalizeText(event?.data?.email_id);
    if (!providerMessageId) {
      res.json({ received: true, ignored: "missing_provider_message_id" });
      return;
    }
    const messageIndexRef = db.collection(REVENUE_AUTOPILOT_PROVIDER_MESSAGE_INDEX_COLLECTION)
      .doc(createHash("sha256").update(`resend|${providerMessageId}`).digest("hex"));
    const messageIndexSnap = await messageIndexRef.get();
    if (!messageIndexSnap.exists) {
      res.json({ received: true, ignored: "unknown_provider_message" });
      return;
    }
    const index = messageIndexSnap.data() || {};
    const organizationId = normalizeOrganizationId(index.organizationId);
    const quoteId = normalizeText(index.quoteId);
    const jobId = normalizeText(index.jobId);
    const customerId = normalizeText(index.customerId);
    if (!organizationId || !quoteId || !jobId) {
      res.status(500).send("Provider-message authority index is invalid.");
      return;
    }
    const refs = revenueAutopilotRefs(organizationId, { quoteId, customerId });
    const providerEventRef = refs.organizationRef
      .collection(REVENUE_AUTOPILOT_PROVIDER_EVENTS_COLLECTION)
      .doc(createHash("sha256").update(`resend|${eventId}`).digest("hex"));
    const jobRef = refs.jobsRef.doc(jobId);
    const eventTypeMap = {
      "email.delivered": "delivered",
      "email.bounced": "bounced",
      "email.complained": "complained"
    };
    const providerEventType = normalizeText(event?.type).toLowerCase();
    const mappedType = eventTypeMap[providerEventType] || "";
    const observedAtISO = new Date().toISOString();
    try {
      const result = await db.runTransaction(async (tx) => {
        const readRefs = [tx.get(providerEventRef), tx.get(jobRef)];
        if (refs.customerControlsRef) readRefs.push(tx.get(refs.customerControlsRef));
        const [eventSnap, jobSnap, controlsSnap] = await Promise.all(readRefs);
        if (eventSnap.exists) return { duplicate: true, ignored: false };
        if (!jobSnap.exists) {
          tx.create(providerEventRef, {
            provider: "resend",
            eventId,
            providerMessageId,
            eventType: normalizeText(event?.type),
            organizationId,
            quoteId,
            jobId,
            signatureVerified: true,
            status: "ignored",
            result: "job_not_found",
            observedAtISO,
            createdAt: FieldValue.serverTimestamp()
          });
          return { duplicate: false, ignored: true };
        }
        const current = { jobId, ...(jobSnap.data() || {}) };
        if (
          normalizeText(current.organizationId) !== organizationId
          || normalizeText(current.quoteId) !== quoteId
          || normalizeText(current.provider) !== "resend"
          || normalizeText(current.providerMessageId) !== providerMessageId
        ) {
          throw new RevenueAutopilotAuthorityError(
            "permission-denied",
            "Provider event is outside the accepted Revenue Autopilot job scope."
          );
        }
        if (!mappedType) {
          tx.create(providerEventRef, {
            provider: "resend",
            eventId,
            providerMessageId,
            eventType: normalizeText(event?.type),
            organizationId,
            quoteId,
            jobId,
            signatureVerified: true,
            status: "ignored",
            result: new Set(["email.opened", "email.clicked"]).has(providerEventType)
              ? "engagement_event_never_establishes_portal_view"
              : "unsupported_event_type",
            observedAtISO,
            createdAt: FieldValue.serverTimestamp()
          });
          return { duplicate: false, ignored: true };
        }
        const recorded = recordRevenueAutopilotProviderEvent({
          job: current,
          event: {
            source: "verified_provider_webhook",
            signatureVerified: true,
            eventId,
            provider: "resend",
            providerMessageId,
            type: mappedType,
            occurredAtISO: normalizeText(event?.data?.created_at || event?.created_at)
          },
          nowISO: observedAtISO
        });
        tx.set(jobRef, {
          ...current,
          ...recorded.job,
          updatedAtISO: observedAtISO,
          updatedAt: FieldValue.serverTimestamp()
        });
        if (recorded.suppressionRecommended && refs.customerControlsRef && controlsSnap?.exists) {
          const controlsRaw = controlsSnap.data() || {};
          tx.set(refs.customerControlsRef, {
            suppression: {
              organizationId,
              customerId,
              recipientKey: normalizeText(current.recipientKey),
              evidenceId: `suppression_${createHash("sha256")
                .update(`${eventId}|${recorded.suppressionReason}`)
                .digest("hex")}`,
              state: "suppressed",
              reason: recorded.suppressionReason,
              evaluatedAtISO: observedAtISO
            },
            updatedAt: FieldValue.serverTimestamp()
          }, { merge: true });
        }
        tx.create(providerEventRef, {
          provider: "resend",
          eventId,
          providerMessageId,
          eventType: normalizeText(event?.type),
          mappedType,
          organizationId,
          quoteId,
          jobId,
          customerId,
          signatureVerified: true,
          status: "processed",
          suppressionRecommended: recorded.suppressionRecommended === true,
          observedAtISO,
          providerOccurredAtISO: normalizeText(event?.data?.created_at || event?.created_at),
          createdAt: FieldValue.serverTimestamp()
        });
        return { duplicate: false, ignored: false };
      });
      res.json({
        received: true,
        ...(result.duplicate ? { duplicate: true } : {}),
        ...(result.ignored ? { ignored: "unsupported_or_unbound_event" } : {})
      });
    } catch (error) {
      functions.logger.error("Revenue Autopilot Resend webhook processing failed", {
        eventId,
        providerMessageId,
        organizationId,
        quoteId,
        jobId,
        error: normalizeText(error?.message).slice(0, 240)
      });
      res.status(500).send("Failed to process provider event.");
    }
  });

exports.reopenQuote = functions.region(REGION).https.onCall(async (data, context) => {
  const requestedOrganizationId = normalizeOrganizationId(data?.organizationId);
  const staff = await assertStaff(context, {
    expectedOrganizationId: requestedOrganizationId
  });
  const organizationId = normalizeOrganizationId(
    requestedOrganizationId || staff.organizationId
  );
  const quoteId = normalizeText(data?.quoteId);
  if (staff.role !== "admin") {
    throw new functions.https.HttpsError(
      "permission-denied",
      "Admin role required to reopen quotes."
    );
  }
  if (!organizationId || !quoteId) {
    throw new functions.https.HttpsError(
      "invalid-argument",
      "organizationId and quoteId are required."
    );
  }

  try {
    const quoteRef = getQuoteDocRef(quoteId, organizationId);
    const newPortalKey = randomUUID().replace(/-/g, "");
    const newPortalRef = db.collection(PORTAL_COLLECTION).doc(newPortalKey);
    const reopenedAtISO = new Date().toISOString();
    const result = await db.runTransaction(async (tx) => {
      const quoteSnap = await tx.get(quoteRef);
      if (!quoteSnap.exists) {
        throw new QuoteCreationError("not-found", "Quote not found.");
      }
      const quote = quoteSnap.data() || {};
      if (normalizeOrganizationId(quote.organizationId) !== organizationId) {
        throw new QuoteCreationError(
          "permission-denied",
          "Quote is outside your organization."
        );
      }
      assertQuoteEditNotDispatching({ ...quote, id: quoteId }, reopenedAtISO);
      assertNoInProgressPaymentDispatch(quote, "reopening the quote");

      const activeVersionId = normalizeText(quote.activeVersionId);
      let activeSnapshot = null;
      if (activeVersionId) {
        if (!/^[A-Za-z0-9_-]{1,128}$/.test(activeVersionId)) {
          throw new QuoteCreationError(
            "failed-precondition",
            "Quote active version identity is invalid."
          );
        }
        const activeVersionSnap = await tx.get(
          quoteRef.collection("versions").doc(activeVersionId)
        );
        if (!activeVersionSnap.exists) {
          throw new QuoteCreationError(
            "failed-precondition",
            "Quote active version is missing."
          );
        }
        const storedSnapshot = activeVersionSnap.data()?.snapshot;
        if (!storedSnapshot || typeof storedSnapshot !== "object" || Array.isArray(storedSnapshot)) {
          throw new QuoteCreationError(
            "failed-precondition",
            "Quote active version snapshot is invalid."
          );
        }
        activeSnapshot = storedSnapshot;
      }

      const documents = buildQuoteReopenDocuments({
        quoteId,
        quote,
        activeSnapshot,
        newPortalKey,
        staff,
        nowISO: reopenedAtISO
      });
      const versionRef = quoteRef
        .collection("versions")
        .doc(documents.version.versionId);
      const previousPortalRef = documents.previousPortalKey
        ? db.collection(PORTAL_COLLECTION).doc(documents.previousPortalKey)
        : null;
      const [newPortalSnap, versionSnap, previousPortalSnap] = await Promise.all([
        tx.get(newPortalRef),
        tx.get(versionRef),
        previousPortalRef ? tx.get(previousPortalRef) : Promise.resolve(null)
      ]);
      if (newPortalSnap.exists || versionSnap.exists) {
        throw new QuoteCreationError(
          "already-exists",
          "A generated portal or version identity collided. Retry quote reopen."
        );
      }
      if (previousPortalSnap?.exists) {
        const previousPortal = previousPortalSnap.data() || {};
        if (
          normalizeText(previousPortal.portalKey) !== documents.previousPortalKey
          || normalizeText(previousPortal.quoteId) !== quoteId
          || normalizeOrganizationId(previousPortal.organizationId) !== organizationId
        ) {
          throw new QuoteCreationError(
            "failed-precondition",
            "Existing portal identity does not match the terminal quote."
          );
        }
      }

      tx.create(newPortalRef, {
        ...documents.portal,
        createdAt: FieldValue.serverTimestamp(),
        updatedAt: FieldValue.serverTimestamp()
      });
      tx.update(quoteRef, {
        ...documents.quotePatch,
        updatedAt: FieldValue.serverTimestamp()
      });
      tx.create(versionRef, {
        ...documents.version,
        createdAt: FieldValue.serverTimestamp()
      });
      if (previousPortalSnap?.exists && documents.previousPortalKey !== newPortalKey) {
        tx.delete(previousPortalRef);
      }

      return documents.result;
    });

    return {
      ok: true,
      organizationId,
      quoteId,
      storage: "firebase",
      ...result
    };
  } catch (err) {
    return quoteCreationFailure(err, {
      operation: "reopenQuote",
      staff,
      organizationId,
      failureMessage: "Failed to reopen quote."
    });
  }
});

async function resolveCheckoutRailBeforePortalRotation({
  quoteId,
  organizationId,
  quote,
  staff,
  paymentKind = "deposit"
} = {}) {
  const flow = getPaymentRequestFlow(paymentKind);
  const checkoutPayment = checkoutPaymentForQuote(quote, paymentKind);
  const settled = ["paid", "refunded"].includes(
    normalizeText(checkoutPayment.depositStatus).toLowerCase()
  ) || Boolean(normalizeText(checkoutPayment.depositConfirmedAtISO));
  if (settled) return { providerState: "settled", paymentKind };

  let plan;
  try {
    plan = planDepositCheckout(checkoutPayment);
  } catch (err) {
    if (err instanceof PaymentSafetyError) {
      throw new functions.https.HttpsError("failed-precondition", err.message);
    }
    throw err;
  }
  if (plan.action === "create") return { providerState: "clear", paymentKind };

  const stripeSessionId = normalizeText(checkoutPayment.stripeSessionId);
  if (!stripeSessionId) {
    throw new functions.https.HttpsError(
      "failed-precondition",
      `The stored ${flow.label} checkout is incomplete and requires reconciliation.`
    );
  }

  const stripe = getStripeClient();
  let session = await stripe.checkout.sessions.retrieve(stripeSessionId, {
    expand: ["payment_intent"]
  });
  assertStripeObjectMode({
    expectedMode: getStripeMode(),
    eventLivemode: session?.livemode,
    sessionLivemode: session?.livemode
  });
  validateStripeCheckoutScope({
    session,
    quote: stripeScopeQuoteForPayment(quote, paymentKind),
    quoteId,
    organizationId
  });
  assertStripePaymentKindMetadata(session, paymentKind);

  const sessionStatus = normalizeText(session?.status).toLowerCase();
  const paymentStatus = normalizeText(session?.payment_status).toLowerCase();
  if (sessionStatus === "open" && paymentStatus !== "paid") {
    try {
      await stripe.checkout.sessions.expire(stripeSessionId);
      session = await stripe.checkout.sessions.retrieve(stripeSessionId, {
        expand: ["payment_intent"]
      });
    } catch (expirationError) {
      const observedAfterConflict = await stripe.checkout.sessions.retrieve(stripeSessionId, {
        expand: ["payment_intent"]
      });
      const observedStatus = normalizeText(observedAfterConflict?.status).toLowerCase();
      const observedPaymentStatus = normalizeText(observedAfterConflict?.payment_status).toLowerCase();
      if (observedStatus === "open" && observedPaymentStatus !== "paid") {
        throw expirationError;
      }
      session = observedAfterConflict;
    }
  }

  const observation = mapStripeCheckoutReconciliation(session);
  if (observation.actionable) {
    const eventId = `portal-rotation-reconcile:${randomUUID()}`;
    await patchPaymentState({
      quoteId,
      organizationId,
      portalKey: normalizeText(quote.portalKey),
      auditContext: {
        host: staff.host,
        eventType: "checkout.session.portal_rotation_reconciled",
        organizationId,
        source: "portal_rotation_reconciliation",
        actorUid: staff.uid,
        actorEmail: staff.email
      },
      stripeSession: session,
      providerObservation: observation,
      paymentKind,
      webhookEvent: {
        eventId,
        eventType: "checkout.session.portal_rotation_reconciled",
        requestHost: staff.host,
        requestIp: ""
      }
    });
  }
  if (!["paid", "failed", "expired"].includes(observation.providerState)) {
    throw new functions.https.HttpsError(
      "failed-precondition",
      `The ${flow.label} checkout is ${observation.providerState}; reconcile it before portal renewal.`
    );
  }
  return { providerState: observation.providerState, paymentKind };
}

async function resolveCheckoutBeforePortalRotation(options = {}) {
  const results = [];
  for (const paymentKind of portalRotationPaymentKinds(options.quote)) {
    results.push(await resolveCheckoutRailBeforePortalRotation({
      ...options,
      paymentKind
    }));
  }
  return results;
}

exports.rotateQuotePortalKey = functions
  .runWith({ secrets: [STRIPE_SECRET_NAME] })
  .region(REGION)
  .https.onCall(async (data, context) => {
  const requestedOrganizationId = normalizeOrganizationId(data?.organizationId);
  const staff = await assertStaff(context, {
    expectedOrganizationId: requestedOrganizationId
  });
  const organizationId = normalizeOrganizationId(
    requestedOrganizationId || staff.organizationId
  );
  const quoteId = normalizeText(data?.quoteId);
  const approvalRequestId = normalizeApprovalExecutionId(data?.approvalRequestId);
  if (staff.role !== "admin") {
    throw new functions.https.HttpsError(
      "permission-denied",
      "Admin role required to rotate portal links."
    );
  }
  if (!organizationId || !quoteId || !approvalRequestId) {
    throw new functions.https.HttpsError(
      "invalid-argument",
      "organizationId, quoteId, and approvalRequestId are required."
    );
  }
  if (normalizeOrganizationId(staff.principalOrganizationId) !== organizationId) {
    throw new functions.https.HttpsError(
      "permission-denied",
      "Portal rotation requires same-organization admin authority."
    );
  }

  try {
    const quoteRef = getQuoteDocRef(quoteId, organizationId);
    const executionRef = getQuoteApprovalExecutionDocRef(
      organizationId,
      approvalRequestId
    );
    const newPortalKey = randomUUID().replace(/-/g, "");
    const newPortalRef = db.collection(PORTAL_COLLECTION).doc(newPortalKey);
    const rotatedAtISO = new Date().toISOString();
    const [preflightQuoteSnap, preflightExecutionSnap] = await Promise.all([
      quoteRef.get(),
      executionRef.get()
    ]);
    if (preflightExecutionSnap.exists) {
      const existingExecution = preflightExecutionSnap.data() || {};
      assertMatchingApprovalExecutionRecord(existingExecution, {
        organizationId,
        quoteId,
        approvalRequestId,
        action: "rotate_portal_link"
      });
      if (normalizeText(existingExecution.state).toLowerCase() === "succeeded") {
        return {
          ok: true,
          organizationId,
          quoteId,
          storage: "firebase",
          idempotent: true,
          ...(existingExecution.result || {})
        };
      }
      throw new ApprovalWorkflowError(
        "aborted",
        "Portal rotation is already in progress."
      );
    }
    if (!preflightQuoteSnap.exists) {
      throw new QuoteCreationError("not-found", "Quote not found.");
    }
    const preflightQuote = preflightQuoteSnap.data() || {};
    if (normalizeOrganizationId(preflightQuote.organizationId) !== organizationId) {
      throw new QuoteCreationError(
        "permission-denied",
        "Quote is outside your organization."
      );
    }
    assertQuoteEditNotDispatching({ ...preflightQuote, id: quoteId }, rotatedAtISO);
    assertNoInProgressPaymentDispatch(preflightQuote, "rotating the portal link");
    buildApprovalExecutionStart({
      workflow: preflightQuote.workflow,
      requestId: approvalRequestId,
      action: "rotate_portal_link",
      actorEmail: staff.email,
      nowISO: rotatedAtISO,
      operationId: approvalRequestId
    });
    await resolveCheckoutBeforePortalRotation({
      quoteId,
      organizationId,
      quote: preflightQuote,
      staff
    });
    const result = await db.runTransaction(async (tx) => {
      const [quoteSnap, executionSnap] = await Promise.all([
        tx.get(quoteRef),
        tx.get(executionRef)
      ]);
      if (executionSnap.exists) {
        const existingExecution = executionSnap.data() || {};
        assertMatchingApprovalExecutionRecord(existingExecution, {
          organizationId,
          quoteId,
          approvalRequestId,
          action: "rotate_portal_link"
        });
        if (normalizeText(existingExecution.state).toLowerCase() === "succeeded") {
          return {
            ...(existingExecution.result || {}),
            idempotent: true
          };
        }
        throw new ApprovalWorkflowError(
          "aborted",
          "Portal rotation is already in progress."
        );
      }
      if (!quoteSnap.exists) {
        throw new QuoteCreationError("not-found", "Quote not found.");
      }
      const quote = quoteSnap.data() || {};
      if (normalizeOrganizationId(quote.organizationId) !== organizationId) {
        throw new QuoteCreationError(
          "permission-denied",
          "Quote is outside your organization."
        );
      }
      assertQuoteEditNotDispatching({ ...quote, id: quoteId }, rotatedAtISO);
      assertNoInProgressPaymentDispatch(quote, "rotating the portal link");
      try {
        for (const paymentKind of portalRotationPaymentKinds(quote)) {
          const currentCheckout = checkoutPaymentForQuote(quote, paymentKind);
          const settled = ["paid", "refunded"].includes(
            normalizeText(currentCheckout.depositStatus).toLowerCase()
          ) || Boolean(normalizeText(currentCheckout.depositConfirmedAtISO));
          if (!settled && planDepositCheckout(currentCheckout).action !== "create") {
            throw new PaymentSafetyError(
              `The ${getPaymentRequestFlow(paymentKind).label} checkout changed during portal renewal. Retry after reconciliation.`
            );
          }
        }
      } catch (err) {
        if (err instanceof PaymentSafetyError || err instanceof PaymentLedgerError) {
          throw new QuoteCreationError("failed-precondition", err.message);
        }
        throw err;
      }

      const documents = buildPortalRotationDocuments({
        quoteId,
        quote,
        newPortalKey,
        staff,
        nowISO: rotatedAtISO
      });
      const invalidatedPaymentApprovals = invalidatePaymentApprovalsForPortalRotation({
        workflow: quote.workflow,
        actorEmail: staff.email,
        nowISO: rotatedAtISO,
        operationId: approvalRequestId
      });
      const workflowAfterInvalidation = {
        ...(quote.workflow || {}),
        approvalRequests: invalidatedPaymentApprovals.approvalRequests
      };
      const started = buildApprovalExecutionStart({
        workflow: workflowAfterInvalidation,
        requestId: approvalRequestId,
        action: "rotate_portal_link",
        actorEmail: staff.email,
        nowISO: rotatedAtISO,
        operationId: approvalRequestId
      });
      const completed = buildApprovalExecutionOutcome({
        workflow: {
          ...workflowAfterInvalidation,
          approvalRequests: started.approvalRequests
        },
        requestId: approvalRequestId,
        action: "rotate_portal_link",
        actorEmail: staff.email,
        nowISO: rotatedAtISO,
        operationId: approvalRequestId,
        state: "succeeded",
        reference: documents.result.versionId
      });
      documents.quotePatch.workflow = {
        ...workflowAfterInvalidation,
        approvalRequests: completed.approvalRequests
      };
      const response = {
        ...documents.result,
        approvalRequest: completed.request,
        invalidatedPaymentApprovalRequestIds: invalidatedPaymentApprovals.invalidatedRequestIds
      };
      const versionRef = quoteRef
        .collection("versions")
        .doc(documents.version.versionId);
      const [newPortalSnap, versionSnap] = await Promise.all([
        tx.get(newPortalRef),
        tx.get(versionRef)
      ]);
      if (newPortalSnap.exists || versionSnap.exists) {
        throw new QuoteCreationError(
          "already-exists",
          "A generated portal or version identity collided. Retry portal rotation."
        );
      }

      tx.create(newPortalRef, {
        ...documents.portal,
        createdAt: FieldValue.serverTimestamp(),
        updatedAt: FieldValue.serverTimestamp()
      });
      tx.update(quoteRef, {
        ...documents.quotePatch,
        updatedAt: FieldValue.serverTimestamp()
      });
      tx.create(versionRef, {
        ...documents.version,
        createdAt: FieldValue.serverTimestamp()
      });
      if (
        documents.previousPortalKey
        && documents.previousPortalKey !== newPortalKey
      ) {
        tx.delete(db.collection(PORTAL_COLLECTION).doc(documents.previousPortalKey));
      }

      tx.create(executionRef, buildApprovalExecutionAudit({
        organizationId,
        quoteId,
        approvalRequest: completed.request,
        staff,
        state: "succeeded",
        startedAtISO: rotatedAtISO,
        completedAtISO: rotatedAtISO,
        result: response
      }));

      return response;
    });

    return {
      ok: true,
      organizationId,
      quoteId,
      storage: "firebase",
      ...result
    };
  } catch (err) {
    if (
      err instanceof PaymentSafetyError
      || err instanceof StripeProviderStateError
      || err instanceof PaymentLedgerError
    ) {
      throw new functions.https.HttpsError(err.code, err.message);
    }
    return quoteCreationFailure(err, {
      operation: "rotateQuotePortalKey",
      staff,
      organizationId,
      failureMessage: "Failed to rotate portal link."
    });
  }
  });

exports.notifyOwnerNewQuote = functions
  .runWith({ secrets: [TWILIO_AUTH_TOKEN_SECRET_NAME] })
  .region(REGION)
  .https.onCall(async (data, context) => {
  const staff = assertAdminStaff(await assertStaff(context));
  if (normalizeText(data?.portalLink)) {
    throw new functions.https.HttpsError(
      "invalid-argument",
      "portalLink is server-derived and must not be supplied."
    );
  }
  const { quoteId, quote, quoteNumber } = await readQuoteOrThrow(data?.quoteId, {
    organizationId: staff.organizationId
  });
  const customerName = normalizeText(quote.customer?.name) || normalizeEmail(quote.customer?.email) || "Unknown customer";
  const eventDate = normalizeText(quote.event?.date) || "date not set";
  const total = currencyLabel(quote.totals?.total);

  const smsText =
    `New quote ${quoteNumber} saved for ${customerName}. ` +
    `Event ${eventDate}. Total ${total}.`;
  const smsResult = await sendOwnerSms(smsText);

  return {
    ok: true,
    quoteNumber,
    sms: smsResult
  };
});

exports.sendQuoteToCustomer = functions
  .runWith({ secrets: [RESEND_API_KEY_SECRET_NAME] })
  .region(REGION)
  .https.onCall(async (data, context) => {
  const staff = assertAdminStaff(await assertStaff(context));
  if (normalizeText(data?.portalLink)) {
    throw new functions.https.HttpsError(
      "invalid-argument",
      "portalLink is server-derived and must not be supplied."
    );
  }
  if (data?.attachment != null) {
    throw new functions.https.HttpsError(
      "invalid-argument",
      "Quote delivery attachments are server-controlled and are not accepted from the browser."
    );
  }
  const organizationId = normalizeOrganizationId(staff.organizationId);
  const quoteId = normalizeText(data?.quoteId);
  const expectedRevisionId = normalizeText(data?.quoteRevisionId);
  if (!organizationId || !quoteId || !expectedRevisionId) {
    throw new functions.https.HttpsError(
      "invalid-argument",
      "An organization-scoped quoteId and quoteRevisionId are required."
    );
  }
  const quoteRef = getQuoteDocRef(quoteId, organizationId);
  const deliverySettingsRef = db
    .collection(ORGANIZATIONS_COLLECTION)
    .doc(organizationId)
    .collection("settings")
    .doc("config");
  const attemptId = randomUUID();
  const startedAtISO = new Date().toISOString();

  let claim;
  try {
    claim = await db.runTransaction(async (tx) => {
      const quoteSnap = await tx.get(quoteRef);
      if (!quoteSnap.exists) {
        throw new QuoteDeliveryError("not-found", "Quote not found.");
      }
      const quote = quoteSnap.data() || {};
      if (normalizeOrganizationId(quote.organizationId) !== organizationId) {
        throw new QuoteDeliveryError("permission-denied", "Quote is outside your organization.");
      }
      assertQuoteDeliveryRevision(quote, expectedRevisionId, quoteId);
      assertRebookReviewComplete(quote);
      const attemptProvider = getEmailProvider();
      const existingDelivery = quote.workflow?.quoteDelivery || {};
      if (
        normalizeText(existingDelivery.revisionId) === expectedRevisionId
        && normalizeText(existingDelivery.state).toLowerCase() === "provider_accepted"
      ) {
        const planned = claimQuoteDelivery({
          quote,
          quoteId,
          organizationId,
          expectedRevisionId,
          actorEmail: staff.email,
          attemptId,
          attemptProvider,
          payloadSha256: "",
          nowISO: startedAtISO,
          leaseMs: QUOTE_DELIVERY_LEASE_MS,
          retryWindowMs: QUOTE_DELIVERY_RETRY_WINDOW_MS
        });
        return {
          ...planned,
          quote: { ...quote, id: quoteId },
          emailPayload: null,
          portalKey: normalizeText(quote.portalKey),
          portalLink: ""
        };
      }
      if (
        normalizeText(existingDelivery.revisionId) === expectedRevisionId
        && ["sending", "outcome_ambiguous", "outcome_unknown"].includes(
          normalizeText(existingDelivery.state).toLowerCase()
        )
      ) {
        const unresolvedPlan = claimQuoteDelivery({
          quote,
          quoteId,
          organizationId,
          expectedRevisionId,
          actorEmail: staff.email,
          attemptId,
          attemptProvider,
          payloadSha256: normalizeText(existingDelivery.payloadSha256),
          nowISO: startedAtISO,
          leaseMs: QUOTE_DELIVERY_LEASE_MS,
          retryWindowMs: QUOTE_DELIVERY_RETRY_WINDOW_MS
        });
        if (["in_progress", "manual_review"].includes(unresolvedPlan.state)) {
          if (unresolvedPlan.state === "manual_review") {
            tx.update(quoteRef, {
              workflow: {
                ...(quote.workflow || {}),
                quoteDelivery: unresolvedPlan.delivery
              },
              updatedAt: FieldValue.serverTimestamp()
            });
          }
          return {
            ...unresolvedPlan,
            quote: { ...quote, id: quoteId },
            emailPayload: null,
            portalKey: normalizeText(quote.portalKey),
            portalLink: ""
          };
        }
      }
      if (quote.rebooking && typeof quote.rebooking === "object") {
        const deliverySettingsSnap = await tx.get(deliverySettingsRef);
        assertRebookCurrentEventDate(quote, {
          nowISO: startedAtISO,
          tenantTimeZone: deliverySettingsSnap.data()?.businessTimeZone
        });
      }
      assertNoConflictingQuoteExecution(quote);
      const portalKey = normalizeText(quote.portalKey);
      const portalRef = portalKey
        ? db.collection(PORTAL_COLLECTION).doc(portalKey)
        : null;
      const portalSnap = portalRef ? await tx.get(portalRef) : null;
      const portal = assertQuoteDeliveryPortal({
        quote,
        quoteId,
        organizationId,
        portalSnapshot: portalSnap?.exists ? portalSnap.data() : null,
        nowISO: startedAtISO
      });
      const emailPayload = buildQuoteDeliveryEmailPayload({
        quote,
        quoteId,
        portalLink: portal.portalLink
      });
      const payloadSha256 = createHash("sha256")
        .update(JSON.stringify({
          toEmail: emailPayload.toEmail,
          subject: emailPayload.subject,
          text: emailPayload.text,
          html: emailPayload.html,
          portalKey: portal.portalKey,
          portalExpiresAtISO: portal.portalExpiresAtISO
        }))
        .digest("hex");
      const planned = claimQuoteDelivery({
        quote,
        quoteId,
        organizationId,
        expectedRevisionId,
        actorEmail: staff.email,
        attemptId,
        attemptProvider,
        payloadSha256,
        nowISO: startedAtISO,
        leaseMs: QUOTE_DELIVERY_LEASE_MS,
        retryWindowMs: QUOTE_DELIVERY_RETRY_WINDOW_MS
      });
      if (["acquired", "manual_review"].includes(planned.state)) {
        tx.update(quoteRef, {
          workflow: {
            ...(quote.workflow || {}),
            quoteDelivery: planned.delivery
          },
          updatedAt: FieldValue.serverTimestamp()
        });
      }
      return {
        ...planned,
        quote: { ...quote, id: quoteId },
        emailPayload,
        portalKey: portal.portalKey,
        portalLink: portal.portalLink
      };
    });
  } catch (err) {
    if (err instanceof QuoteDeliveryError || err instanceof RebookQuoteDraftError) {
      throw new functions.https.HttpsError(err.code, err.message);
    }
    throw err;
  }

  const quote = claim.quote;
  const quoteNumber = normalizeText(claim.emailPayload?.quoteNumber)
    || normalizeText(quote.quoteNumber)
    || quoteId;
  const portalLink = normalizeText(claim.portalLink);
  if (claim.state === "provider_accepted") {
    return {
      ok: true,
      organizationId,
      quoteId,
      quoteNumber,
      quoteRevisionId: claim.revisionId,
      portalLink,
      status: normalizeText(quote.status).toLowerCase() || "sent",
      lifecycle: quote.lifecycle || {},
      delivery: claim.delivery,
      email: {
        sent: true,
        provider: normalizeText(claim.delivery.provider),
        messageId: normalizeText(claim.delivery.providerMessageId)
      },
      idempotent: true
    };
  }
  if (claim.state === "in_progress") {
    throw new functions.https.HttpsError(
      "aborted",
      "Quote email delivery is already in progress. Retry this saved revision shortly."
    );
  }
  if (claim.state === "manual_review") {
    throw new functions.https.HttpsError(
      "failed-precondition",
      "This delivery requires provider-outcome reconciliation before changing or sending the quote again."
    );
  }

  let providerAccepted = false;
  let acceptedEmail = null;
  try {
    const email = await sendCustomerEmail({
      ...claim.emailPayload,
      idempotencyKey: claim.delivery.idempotencyKey
    });
    providerAccepted = true;
    acceptedEmail = email;
    const completedAtISO = new Date().toISOString();
    const completion = await db.runTransaction(async (tx) => {
      const portalRef = db.collection(PORTAL_COLLECTION).doc(claim.portalKey);
      const [quoteSnap, portalSnap] = await Promise.all([
        tx.get(quoteRef),
        tx.get(portalRef)
      ]);
      if (!quoteSnap.exists) {
        throw new QuoteDeliveryError("aborted", "Quote disappeared after provider delivery.");
      }
      const currentQuote = quoteSnap.data() || {};
      assertQuoteDeliveryRevision(currentQuote, claim.revisionId, quoteId);
      assertQuoteDeliveryPortal({
        quote: currentQuote,
        quoteId,
        organizationId,
        portalSnapshot: portalSnap.exists ? portalSnap.data() : null,
        nowISO: completedAtISO
      });
      const currentDelivery = currentQuote.workflow?.quoteDelivery || {};
      if (
        normalizeText(currentDelivery.revisionId) === claim.revisionId
        && normalizeText(currentDelivery.state).toLowerCase() === "provider_accepted"
      ) {
        return {
          status: normalizeText(currentQuote.status).toLowerCase() || "sent",
          lifecycle: currentQuote.lifecycle || {},
          delivery: currentDelivery,
          idempotent: true
        };
      }
      if (
        normalizeText(currentDelivery.revisionId) !== claim.revisionId
        || normalizeText(currentDelivery.attemptId) !== claim.delivery.attemptId
        || normalizeText(currentDelivery.state).toLowerCase() !== "sending"
      ) {
        throw new QuoteDeliveryError(
          "aborted",
          "Quote delivery audit changed before provider completion could be recorded."
        );
      }
      const delivery = buildQuoteDeliverySuccess({
        delivery: currentDelivery,
        email,
        nowISO: completedAtISO,
        portalKey: normalizeText(currentQuote.portalKey),
        portalIssuedAtISO: normalizeText(currentQuote.portalIssuedAtISO)
      });
      const currentStatus = normalizeText(currentQuote.status).toLowerCase() || "draft";
      const status = currentStatus === "draft" ? "sent" : currentStatus;
      const lifecycle = {
        ...(currentQuote.lifecycle || {}),
        sentAtISO: normalizeText(currentQuote.lifecycle?.sentAtISO) || completedAtISO
      };
      const workflow = {
        ...(currentQuote.workflow || {}),
        quoteDelivery: delivery
      };
      const updatedQuote = {
        ...currentQuote,
        status,
        lifecycle,
        workflow,
        updatedAtISO: completedAtISO
      };
      tx.update(quoteRef, {
        status,
        lifecycle,
        workflow,
        updatedAtISO: completedAtISO,
        updatedAt: FieldValue.serverTimestamp()
      });
      tx.update(portalRef, {
        ...buildCanonicalPortalSnapshot(quoteId, updatedQuote),
        updatedAt: FieldValue.serverTimestamp()
      });
      return {
        status,
        lifecycle,
        delivery,
        idempotent: false
      };
    });

    return {
      ok: true,
      organizationId,
      quoteId,
      quoteNumber,
      quoteRevisionId: claim.revisionId,
      portalLink,
      email,
      ...completion
    };
  } catch (err) {
    const outcomeAtISO = new Date().toISOString();
    const completionRequiresManualReview = providerAccepted
      && err instanceof QuoteDeliveryError
      && err.code === "failed-precondition";
    const auditError = providerAccepted
      ? annotateQuoteDeliveryAttemptError(err, {
        outcome: completionRequiresManualReview ? "manual_review" : "ambiguous",
        reason: completionRequiresManualReview
          ? "provider_accepted_portal_validation_failed"
          : "provider_accepted_completion_failed"
      })
      : err;
    try {
      await db.runTransaction(async (tx) => {
        const quoteSnap = await tx.get(quoteRef);
        if (!quoteSnap.exists) return;
        const currentQuote = quoteSnap.data() || {};
        const currentDelivery = currentQuote.workflow?.quoteDelivery || {};
        if (
          normalizeText(currentDelivery.revisionId) !== claim.revisionId
          || normalizeText(currentDelivery.attemptId) !== claim.delivery.attemptId
          || normalizeText(currentDelivery.state).toLowerCase() !== "sending"
        ) return;
        const failurePlan = planQuoteDeliveryAttemptFailure({
          delivery: currentDelivery,
          error: auditError,
          nowISO: outcomeAtISO,
          providerObservation: providerAccepted ? acceptedEmail : {}
        });
        tx.update(quoteRef, {
          workflow: {
            ...(currentQuote.workflow || {}),
            quoteDelivery: failurePlan.delivery
          },
          updatedAt: FieldValue.serverTimestamp()
        });
      });
    } catch (auditErr) {
      functions.logger.error("Quote email outcome audit could not be persisted", {
        organizationId,
        quoteId,
        revisionId: claim.revisionId,
        error: normalizeText(auditErr?.message)
      });
    }
    if (providerAccepted) {
      functions.logger.error("Quote email provider accepted but lifecycle completion failed", {
        organizationId,
        quoteId,
        revisionId: claim.revisionId,
        error: normalizeText(err?.message)
      });
      if (completionRequiresManualReview) {
        throw new functions.https.HttpsError(
          "failed-precondition",
          "The email provider accepted this quote after its portal became invalid. Reconcile the provider outcome manually before changing or sending the quote again."
        );
      }
      throw new functions.https.HttpsError(
        "aborted",
        "The email provider accepted this quote, but its lifecycle audit is incomplete. Retry this exact saved revision promptly; automatic retries stop before the provider idempotency window expires."
      );
    }
    if (err instanceof QuoteDeliveryError) {
      throw new functions.https.HttpsError(err.code, err.message);
    }
    throw err;
  }
  });

exports.resolveQuoteDeliveryOutcome = functions.region(REGION).https.onCall(async (data, context) => {
  const staff = assertAdminStaff(await assertStaff(context));
  const organizationId = normalizeOrganizationId(staff.organizationId);
  const quoteId = normalizeText(data?.quoteId);
  const expectedRevisionId = normalizeText(data?.quoteRevisionId);
  const resolution = normalizeText(data?.resolution).toLowerCase();
  const note = normalizeText(data?.note);
  const providerMessageId = data?.providerMessageId;
  if (!organizationId || !quoteId || !expectedRevisionId) {
    throw new functions.https.HttpsError(
      "invalid-argument",
      "An organization-scoped quoteId and quoteRevisionId are required."
    );
  }
  const quoteRef = getQuoteDocRef(quoteId, organizationId);
  const resolvedAtISO = new Date().toISOString();

  try {
    return await db.runTransaction(async (tx) => {
      const quoteSnap = await tx.get(quoteRef);
      if (!quoteSnap.exists) {
        throw new QuoteDeliveryError("not-found", "Quote not found.");
      }
      const quote = quoteSnap.data() || {};
      if (normalizeOrganizationId(quote.organizationId) !== organizationId) {
        throw new QuoteDeliveryError("permission-denied", "Quote is outside your organization.");
      }
      const portalKey = normalizeText(quote.portalKey);
      let portalRef = null;
      let portalSnap = null;
      let portalActivation = {
        active: false,
        portalKey,
        portalIssuedAtISO: normalizeText(quote.portalIssuedAtISO)
      };
      if (resolution === "provider_accepted" && portalKey) {
        portalRef = db.collection(PORTAL_COLLECTION).doc(portalKey);
        portalSnap = await tx.get(portalRef);
        try {
          assertQuoteDeliveryPortalSnapshot({
            quote,
            quoteId,
            organizationId,
            portalSnapshot: portalSnap.exists ? portalSnap.data() : null,
            nowISO: resolvedAtISO
          });
          portalActivation = {
            ...portalActivation,
            active: true
          };
        } catch (portalError) {
          if (!(portalError instanceof QuoteDeliveryError)) throw portalError;
        }
      }
      const resolutionPlan = planQuoteDeliveryOutcomeResolution({
        quote,
        quoteId,
        organizationId,
        expectedRevisionId,
        resolution,
        note,
        providerMessageId,
        portalActivation,
        actorUid: staff.uid,
        actorEmail: staff.email,
        nowISO: resolvedAtISO
      });
      const currentStatus = normalizeText(quote.status).toLowerCase() || "draft";
      let status = currentStatus;
      let lifecycle = quote.lifecycle || {};

      if (resolutionPlan.state === "provider_accepted") {
        status = currentStatus === "draft" ? "sent" : currentStatus;
        lifecycle = {
          ...(quote.lifecycle || {}),
          sentAtISO: normalizeText(quote.lifecycle?.sentAtISO) || resolvedAtISO
        };
        const workflow = {
          ...(quote.workflow || {}),
          quoteDelivery: resolutionPlan.delivery
        };
        const updatedQuote = {
          ...quote,
          status,
          lifecycle,
          workflow,
          updatedAtISO: resolvedAtISO
        };
        tx.update(quoteRef, {
          status,
          lifecycle,
          workflow,
          updatedAtISO: resolvedAtISO,
          updatedAt: FieldValue.serverTimestamp()
        });
        if (portalActivation.active && portalRef && portalSnap?.exists) {
          tx.update(portalRef, {
            ...buildCanonicalPortalSnapshot(quoteId, updatedQuote),
            updatedAt: FieldValue.serverTimestamp()
          });
        }
      } else if (!resolutionPlan.idempotent) {
        tx.update(quoteRef, {
          workflow: {
            ...(quote.workflow || {}),
            quoteDelivery: resolutionPlan.delivery
          },
          updatedAtISO: resolvedAtISO,
          updatedAt: FieldValue.serverTimestamp()
        });
      }

      return {
        ok: true,
        quoteId,
        quoteRevisionId: resolutionPlan.revisionId,
        resolution,
        status,
        lifecycle,
        delivery: resolutionPlan.delivery
      };
    });
  } catch (err) {
    if (err instanceof functions.https.HttpsError) throw err;
    if (err instanceof QuoteDeliveryError) {
      throw new functions.https.HttpsError(err.code, err.message);
    }
    functions.logger.error("Quote delivery outcome reconciliation failed", {
      organizationId,
      quoteId,
      revisionId: expectedRevisionId,
      resolution,
      error: normalizeText(err?.message)
    });
    throw new functions.https.HttpsError(
      "internal",
      "Failed to reconcile the quote delivery outcome."
    );
  }
});

async function sendApprovedPaymentRequestEmail(data, context, paymentKind = "deposit") {
  const flow = getPaymentRequestFlow(paymentKind);
  const staff = assertAdminStaff(await assertStaff(context));
  const approvalRequestId = normalizeApprovalExecutionId(data?.approvalRequestId);
  if (!approvalRequestId) {
    throw new functions.https.HttpsError(
      "invalid-argument",
      "approvalRequestId is required."
    );
  }
  if (normalizeText(data?.paymentLink) || normalizeText(data?.portalLink)) {
    throw new functions.https.HttpsError(
      "invalid-argument",
      "Payment and portal links are server-derived and must not be supplied."
    );
  }
  if (
    data?.amountCents != null
    || data?.currency != null
    || data?.paymentKind != null
    || data?.checkoutGeneration != null
  ) {
    throw new functions.https.HttpsError(
      "invalid-argument",
      "Payment amount, currency, kind, and checkout generation are server-derived."
    );
  }
  if (data?.attachment != null) {
    throw new functions.https.HttpsError(
      "invalid-argument",
      "Payment-request attachments are server-controlled and are not accepted from the browser."
    );
  }
  const organizationId = normalizeOrganizationId(staff.organizationId);
  const quoteId = normalizeText(data?.quoteId);
  if (!organizationId || !quoteId) {
    throw new functions.https.HttpsError(
      "invalid-argument",
      "An organization-scoped quoteId is required."
    );
  }
  if (normalizeOrganizationId(staff.principalOrganizationId) !== organizationId) {
    throw new functions.https.HttpsError(
      "permission-denied",
      "Payment requests require same-organization admin authority."
    );
  }

  const quoteRef = getQuoteDocRef(quoteId, organizationId);
  const executionRef = getQuoteApprovalExecutionDocRef(
    organizationId,
    approvalRequestId
  );
  const privateDispatchRef = getPrivatePaymentDispatchDocRef(
    organizationId,
    approvalRequestId
  );
  const startedAtISO = new Date().toISOString();
  let claimedQuote = null;
  let providerAccepted = false;
  let checkoutPreparation = null;
  let paymentDispatch = null;
  let paymentPortalExpired = false;
  try {
    const claim = await db.runTransaction(async (tx) => {
      const [quoteSnap, executionSnap, privateDispatchSnap] = await Promise.all([
        tx.get(quoteRef),
        tx.get(executionRef),
        tx.get(privateDispatchRef)
      ]);
      if (executionSnap.exists) {
        const existingExecution = executionSnap.data() || {};
        assertMatchingApprovalExecutionRecord(existingExecution, {
          organizationId,
          quoteId,
          approvalRequestId,
          action: flow.action
        });
        const executionState = normalizeText(existingExecution.state).toLowerCase();
        if (executionState === "succeeded") {
          return {
            completed: true,
            result: sanitizePaymentRequestExecutionResult(existingExecution.result)
          };
        }
        if (executionState !== "in_progress") {
          throw new ApprovalWorkflowError(
            "failed-precondition",
            "Failed payment-request execution requires a new approval."
          );
        }
        if (normalizeText(existingExecution.executedBy?.uid) !== staff.uid) {
          throw new ApprovalWorkflowError(
            "aborted",
            "Payment-request execution is already owned by another administrator."
          );
        }
      }
      if (!quoteSnap.exists) {
        throw new functions.https.HttpsError("not-found", "Quote not found.");
      }
      const quote = quoteSnap.data() || {};
      if (normalizeOrganizationId(quote.organizationId) !== organizationId) {
        throw new functions.https.HttpsError(
          "permission-denied",
          "Quote is outside your organization."
        );
      }
      assertQuoteEditNotDispatching({ ...quote, id: quoteId }, startedAtISO);
      const status = normalizeText(quote.status).toLowerCase();
      if (
        (flow.paymentKind === "deposit" && !["accepted", "booked"].includes(status))
        || (flow.paymentKind === "final_balance" && status !== "booked")
      ) {
        throw new functions.https.HttpsError(
          "failed-precondition",
          flow.paymentKind === "final_balance"
            ? "Final-balance requests require a booked quote."
            : "Payment requests can be sent only after quote acceptance."
        );
      }
      const portalKey = normalizeText(quote.portalKey);
      const portalRef = db.collection(PORTAL_COLLECTION).doc(portalKey);
      const portalSnap = await tx.get(portalRef);
      const hasPersistedCheckoutPreparation = Boolean(
        executionSnap.exists && executionSnap.data()?.checkoutPreparation
      );
      const expectedApprovalScope = deriveApprovedPaymentRequestScope({
        quote,
        quoteId,
        organizationId,
        portalSnapshot: portalSnap.exists ? portalSnap.data() : null,
        nowISO: startedAtISO,
        allowSettled: executionSnap.exists,
        allowExpiredPortal: hasPersistedCheckoutPreparation,
        reuseCurrentCheckoutGeneration: hasPersistedCheckoutPreparation
      }, flow.paymentKind);
      const approvalRequest = findQuoteApprovalRequest(
        quote.workflow,
        approvalRequestId
      );
      const verifiedApprovalScope = assertPaymentApprovalRequestScope({
        approvalRequest,
        expected: expectedApprovalScope
      });
      if (
        executionSnap.exists
        && normalizeText(executionSnap.data()?.actionScopeDigest).toLowerCase()
          !== verifiedApprovalScope.actionScopeDigest
      ) {
        throw new ApprovalWorkflowError(
          "failed-precondition",
          "Payment execution scope does not match the approved request."
        );
      }

      if (!executionSnap.exists) {
        const started = buildApprovalExecutionStart({
          workflow: quote.workflow,
          requestId: approvalRequestId,
          action: flow.action,
          actorEmail: staff.email,
          nowISO: startedAtISO,
          operationId: approvalRequestId
        });
        tx.update(quoteRef, {
          "workflow.approvalRequests": started.approvalRequests,
          updatedAtISO: startedAtISO,
          updatedAt: FieldValue.serverTimestamp()
        });
        tx.create(executionRef, buildApprovalExecutionAudit({
          organizationId,
          quoteId,
          approvalRequest: started.request,
          staff,
          state: "in_progress",
          startedAtISO
        }));
      }
      return {
        completed: false,
        quote,
        actionScopeDigest: verifiedApprovalScope.actionScopeDigest,
        checkoutPreparation: executionSnap.exists
          ? restorePrivateCheckoutPreparation(
            executionSnap.data()?.checkoutPreparation,
            privateDispatchSnap.exists ? privateDispatchSnap.data() : null,
            { organizationId, quoteId, approvalRequestId }
          )
          : null,
        paymentDispatch: executionSnap.exists
          ? executionSnap.data()?.paymentDispatch || null
          : null,
        portalExpired: Date.parse(expectedApprovalScope.actionScope.portalExpiresAtISO)
          <= Date.parse(startedAtISO)
      };
    });

    if (claim.completed) {
      return {
        ok: true,
        organizationId,
        quoteId,
        idempotent: true,
        ...(claim.result || {})
      };
    }

    claimedQuote = claim.quote;
    paymentDispatch = claim.paymentDispatch;
    paymentPortalExpired = claim.portalExpired === true;
    if (claim.checkoutPreparation) {
      checkoutPreparation = normalizeApprovedCheckoutPreparation(
        claim.checkoutPreparation
      );
      checkoutPreparation = await restoreApprovedCheckoutPreparation({
        preparation: checkoutPreparation,
        quote: claimedQuote,
        quoteId,
        organizationId,
        approvalRequestId,
        actionScopeDigest: claim.actionScopeDigest
      });
    } else {
      const prepared = await prepareCheckoutForApprovedSend({
        quoteId,
        quote: claimedQuote,
        quoteNumber: normalizeText(claimedQuote.quoteNumber) || quoteId,
        organizationId,
        approvalRequestId,
        actionScopeDigest: claim.actionScopeDigest,
        paymentKind: flow.paymentKind
      });
      checkoutPreparation = normalizeApprovedCheckoutPreparation({
        ...prepared,
        privateDepositLink: prepared.url,
        stripeSessionId: prepared.sessionId,
        actionScopeDigest: claim.actionScopeDigest,
        paymentKind: flow.paymentKind,
        operationId: approvalRequestId,
        exposureState: "prepared",
        preparedAtISO: new Date().toISOString()
      });
      let storedPreparation;
      try {
        storedPreparation = await persistApprovedCheckoutPreparation({
          quoteRef,
          executionRef,
          quoteId,
          organizationId,
          approvalRequestId,
          staff,
          expectedApprovalScopeDigest: claim.actionScopeDigest,
          prepared,
          paymentKind: flow.paymentKind
        });
      } catch (persistError) {
        let recoveredPreparation = null;
        let recoveryError = null;
        try {
          recoveredPreparation = await recoverPersistedApprovedCheckoutPreparation({
            executionRef,
            privateDispatchRef,
            organizationId,
            quoteId,
            approvalRequestId,
            staff,
            expectedApprovalScopeDigest: claim.actionScopeDigest,
            paymentKind: flow.paymentKind
          });
        } catch (error) {
          recoveryError = error;
        }
        if (recoveredPreparation) {
          storedPreparation = recoveredPreparation;
        } else if (recoveryError || !isDefiniteCheckoutPreparationPersistenceError(persistError)) {
          functions.logger.warn("Stripe checkout preparation persistence is unresolved", {
            organizationId,
            quoteId,
            approvalRequestId,
            persistError: normalizeText(persistError?.message),
            recoveryError: normalizeText(recoveryError?.message)
          });
          throw annotatePaymentCheckoutOutcome(persistError, {
            reason: "checkout_preparation_persistence_ambiguous"
          });
        } else {
          throw persistError;
        }
      }
      checkoutPreparation = await restoreApprovedCheckoutPreparation({
        preparation: storedPreparation,
        quote: claimedQuote,
        quoteId,
        organizationId,
        approvalRequestId,
        actionScopeDigest: claim.actionScopeDigest
      });
    }
    if (
      paymentPortalExpired
      && normalizeText(paymentDispatch?.state).toLowerCase() !== "provider_accepted"
    ) {
      throw new PaymentSafetyError(
        "The approved customer portal expired before payment-request delivery. The prepared checkout must be closed before a fresh portal and approval are used."
      );
    }
    const quoteNumber = normalizeText(claimedQuote.quoteNumber) || quoteId;
    const customerEmail = normalizeEmail(claimedQuote.customer?.email);
    const paymentLink = checkoutPreparation.privateDepositLink;
    const portalLink = resolvePortalLink(claimedQuote);
    const customerName = normalizeText(claimedQuote.customer?.name) || "there";
    const eventName = normalizeText(claimedQuote.event?.name) || "your event";
    const paymentAmountCents = paymentAmountCentsForQuote(claimedQuote, flow.paymentKind);
    const paymentAmount = currencyLabel(paymentAmountCents / 100);
    const paymentLabel = flow.paymentKind === "final_balance" ? "final balance" : "deposit";
    const scopeLabel = flow.paymentKind === "final_balance"
      ? `Your contract ${normalizeText(claimedQuote.booking?.contractNumber)} for ${eventName} is ready for final payment.`
      : `Your quote ${quoteNumber} for ${eventName} has been accepted.`;
    const brandName = normalizeText(
      claimedQuote?.quoteMeta?.brandName || claimedQuote?.quoteMeta?.organizationName
    );
    const emailIdempotencyKey = paymentRequestEmailIdempotencyKey({
      organizationId,
      quoteId,
      approvalRequestId
    });
    const lines = [
      `Hi ${customerName},`,
      "",
      scopeLabel,
      `Please submit your ${paymentLabel} payment of ${paymentAmount}: ${paymentLink}`,
      portalLink ? `You can also review your quote in the customer portal: ${portalLink}` : "",
      "",
      "Thank you."
    ].filter(Boolean);
    const dispatchAttempt = await claimPaymentDispatchAttempt({
      executionRef,
      organizationId,
      quoteId,
      approvalRequestId,
      staff,
      actionScopeDigest: claim.actionScopeDigest,
      idempotencyKey: emailIdempotencyKey,
      action: flow.action
    });
    paymentDispatch = dispatchAttempt.dispatch;
    let email;
    if (dispatchAttempt.action === "complete_publication") {
      email = {
        sent: true,
        provider: paymentDispatch.provider,
        messageId: paymentDispatch.providerMessageId
      };
      providerAccepted = true;
    } else {
      email = await sendCustomerEmail({
        toEmail: customerEmail,
        subject: `${brandName ? `${brandName} ` : ""}${flow.title} - ${quoteNumber}`,
        text: lines.join("\n"),
        html: `
          <p>Hi ${escapeHtml(customerName)},</p>
          <p>${escapeHtml(scopeLabel)}</p>
          <p>Please submit your ${escapeHtml(paymentLabel)} payment of <strong>${escapeHtml(paymentAmount)}</strong>.</p>
          <p><a href="${escapeHtml(paymentLink)}">Pay ${escapeHtml(paymentLabel)} now</a></p>
          ${portalLink ? `<p><a href="${escapeHtml(portalLink)}">Open customer portal</a></p>` : ""}
          <p>Thank you.</p>
        `,
        idempotencyKey: emailIdempotencyKey
      });
      providerAccepted = true;
      paymentDispatch = await recordPaymentDispatchAcceptance({
        executionRef,
        organizationId,
        quoteId,
        approvalRequestId,
        staff,
        provider: email.provider,
        providerMessageId: email.messageId,
        action: flow.action
      });
    }
    const completedAtISO = new Date().toISOString();
    const paymentPortalRef = db.collection(PORTAL_COLLECTION).doc(
      normalizeText(claimedQuote.portalKey)
    );
    const completed = await db.runTransaction(async (tx) => {
      const [quoteSnap, executionSnap, portalSnap, privateDispatchSnap] = await Promise.all([
        tx.get(quoteRef),
        tx.get(executionRef),
        tx.get(paymentPortalRef),
        tx.get(privateDispatchRef)
      ]);
      if (
        !quoteSnap.exists
        || !executionSnap.exists
        || !portalSnap.exists
        || !privateDispatchSnap.exists
      ) {
        throw new ApprovalWorkflowError(
          "failed-precondition",
          "Payment-request quote, portal, or execution audit disappeared before completion."
        );
      }
      const currentQuote = quoteSnap.data() || {};
      const execution = executionSnap.data() || {};
      assertMatchingApprovalExecutionRecord(execution, {
        organizationId,
        quoteId,
        approvalRequestId,
        action: flow.action
      });
      if (normalizeText(execution.state).toLowerCase() === "succeeded") {
        return sanitizePaymentRequestExecutionResult(execution.result);
      }
      if (normalizeText(execution.state).toLowerCase() !== "in_progress") {
        throw new ApprovalWorkflowError(
          "failed-precondition",
          "Payment-request execution is no longer in progress."
        );
      }
      const acceptedDispatch = normalizePaymentDispatch(execution.paymentDispatch);
      if (
        acceptedDispatch.state !== "provider_accepted"
        || acceptedDispatch.provider !== normalizeText(email.provider).toLowerCase()
        || acceptedDispatch.providerMessageId !== normalizeProviderMessageId(email.messageId)
      ) {
        throw new PaymentDispatchStateError(
          "failed-precondition",
          "Payment email provider acceptance was not durably recorded before publication."
        );
      }
      const currentApprovalScope = deriveApprovedPaymentRequestScope({
        quote: currentQuote,
        quoteId,
        organizationId,
        portalSnapshot: portalSnap.data() || {},
        nowISO: completedAtISO,
        allowSettled: true,
        allowExpiredPortal: paymentPortalExpired,
        reuseCurrentCheckoutGeneration: true
      }, flow.paymentKind);
      const currentApprovalRequest = findQuoteApprovalRequest(
        currentQuote.workflow,
        approvalRequestId
      );
      const verifiedScope = assertPaymentApprovalRequestScope({
        approvalRequest: currentApprovalRequest,
        expected: currentApprovalScope
      });
      if (
        verifiedScope.actionScopeDigest !== checkoutPreparation.actionScopeDigest
        || normalizeText(execution.actionScopeDigest).toLowerCase()
          !== checkoutPreparation.actionScopeDigest
      ) {
        throw new ApprovalWorkflowError(
          "failed-precondition",
          "Payment-request scope changed before publication."
        );
      }

      const currentPayment = checkoutPaymentForQuote(currentQuote, flow.paymentKind);
      const providerTruthAlreadySettled = (
        ["paid", "refunded"].includes(currentPayment.depositStatus)
        || Boolean(currentPayment.depositConfirmedAtISO)
      );
      const samePreparedSession = currentPayment.stripeSessionId === checkoutPreparation.stripeSessionId;
      const providerTruthAlreadyObserved = samePreparedSession && (
        providerTruthAlreadySettled
        || ["processing", "failed", "expired"].includes(currentPayment.stripeCheckoutState)
      );
      let publishPayment = false;
      if (providerTruthAlreadyObserved) {
        if (!samePreparedSession) {
          throw new PaymentSafetyError(
            "Payment evidence changed to a different Stripe session before request publication."
          );
        }
      } else if (!checkoutPreparation.paymentAlreadyPublished) {
        const transition = assertPreparedCheckoutPublicationTransition({
          currentPayment,
          expectedPreparedPayment: checkoutPreparation.preparedPayment,
          publishedPayment: checkoutPreparation.publishedPayment
        });
        publishPayment = !transition.alreadyApplied;
      } else if (
        !samePreparedSession
        || currentPayment.depositLink !== checkoutPreparation.privateDepositLink
      ) {
        throw new PaymentSafetyError(
          "The approved published checkout no longer matches the quote payment state."
        );
      }

      const outcome = buildApprovalExecutionOutcome({
        workflow: currentQuote.workflow,
        requestId: approvalRequestId,
        action: flow.action,
        actorEmail: staff.email,
        nowISO: completedAtISO,
        operationId: approvalRequestId,
        state: "succeeded",
        reference: email.messageId || "email-provider-accepted"
      });
      const response = {
        quoteNumber,
        email,
        approvalRequest: outcome.request,
        stripeSessionId: checkoutPreparation.stripeSessionId,
        checkoutGeneration: checkoutPreparation.checkoutGeneration,
        published: publishPayment || checkoutPreparation.paymentAlreadyPublished,
        ...(flow.paymentKind === "final_balance"
          ? {
            paymentKind: flow.paymentKind,
            amountCents: paymentAmountCentsForQuote(currentQuote, flow.paymentKind)
          }
          : {})
      };
      const quoteUpdate = {
        "workflow.approvalRequests": outcome.approvalRequests,
        updatedAtISO: completedAtISO,
        updatedAt: FieldValue.serverTimestamp()
      };
      if (publishPayment) {
        appendPaymentStateUpdate(quoteUpdate, {
          paymentKind: flow.paymentKind,
          checkoutPayment: checkoutPreparation.publishedPayment,
          amountCents: paymentAmountCentsForQuote(currentQuote, flow.paymentKind),
          operationId: approvalRequestId,
          audit: {
            lastCheckoutCreatedAtISO: completedAtISO,
            lastHost: normalizeHostname(staff.host),
            lastEventType: "checkout.session.published",
            lastOrganizationId: organizationId
          }
        });
        if (flow.paymentKind === "final_balance") {
          const ledgerPlan = planFinalBalanceLedgerTransition({
            quote: currentQuote,
            operationId: approvalRequestId,
            amountCents: paymentAmountCentsForQuote(currentQuote, flow.paymentKind),
            nextState: "sent",
            providerReference: checkoutPreparation.stripeSessionId
          });
          quoteUpdate["payment.ledger"] = ledgerPlan.ledger;
        }
      }
      tx.update(quoteRef, quoteUpdate);
      if (publishPayment) {
        tx.set(paymentPortalRef, {
          organizationId,
          updatedAtISO: completedAtISO,
          payment: portalPaymentState({
            paymentKind: flow.paymentKind,
            checkoutPayment: checkoutPreparation.publishedPayment,
            amountCents: paymentAmountCentsForQuote(currentQuote, flow.paymentKind),
            operationId: approvalRequestId,
            audit: {
              lastCheckoutCreatedAtISO: completedAtISO,
              lastHost: normalizeHostname(staff.host),
              lastEventType: "checkout.session.published",
              lastOrganizationId: organizationId
            }
          })
        }, { merge: true });
      }
      tx.set(executionRef, {
        state: "succeeded",
        result: sanitizePaymentRequestExecutionResult(response),
        checkoutPreparation: {
          ...execution.checkoutPreparation,
          privateDepositLink: "",
          exposureState: response.published ? "published" : "provider_accepted",
          publishedAtISO: completedAtISO
        },
        error: "",
        completedAtISO,
        updatedAtISO: completedAtISO,
        updatedAt: FieldValue.serverTimestamp()
      }, { merge: true });
      tx.set(privateDispatchRef, {
        privateDepositLink: "",
        exposureState: response.published ? "published" : "provider_accepted",
        completedAtISO,
        updatedAtISO: completedAtISO,
        updatedAt: FieldValue.serverTimestamp()
      }, { merge: true });
      return sanitizePaymentRequestExecutionResult(response);
    });

    return {
      ok: true,
      organizationId,
      quoteId,
      ...completed
    };
  } catch (err) {
    if (!claimedQuote && isDefinitePaymentExecutionClaimError(err)) {
      let unpreparedExecutionClosed = false;
      try {
        unpreparedExecutionClosed = await finalizeUnpreparedPaymentExecutionFailure({
          quoteRef,
          executionRef,
          privateDispatchRef,
          quoteId,
          organizationId,
          approvalRequestId,
          staff,
          paymentKind: flow.paymentKind
        });
      } catch (earlyFailureAuditError) {
        functions.logger.error("Unprepared payment execution could not be closed", {
          organizationId,
          quoteId,
          approvalRequestId,
          error: normalizeText(earlyFailureAuditError?.message)
        });
      }
      if (unpreparedExecutionClosed) {
        throw new functions.https.HttpsError(
          "failed-precondition",
          "The approved payment request stopped before Stripe checkout preparation was durably recorded. The operation is closed; request and approve a fresh payment request."
        );
      }
    }
    let executionStateUncertain = false;
    let executionAlreadyFinalized = false;
    if (claimedQuote) {
      try {
        const latestExecutionSnap = await executionRef.get();
        if (latestExecutionSnap.exists) {
          const latestExecution = latestExecutionSnap.data() || {};
          const latestState = normalizeText(latestExecution.state).toLowerCase();
          if (latestState === "succeeded") {
            return {
              ok: true,
              organizationId,
              quoteId,
              idempotent: true,
              ...sanitizePaymentRequestExecutionResult(latestExecution.result)
            };
          }
          executionAlreadyFinalized = Boolean(latestState && latestState !== "in_progress");
        }
      } catch (executionReadError) {
        executionStateUncertain = true;
        functions.logger.error("Payment-request execution state could not be rechecked after failure", {
          organizationId,
          quoteId,
          approvalRequestId,
          error: normalizeText(executionReadError?.message)
        });
      }
    }
    const expiredPortalUnknownDispatch = Boolean(
      claimedQuote
      && paymentPortalExpired
      && checkoutPreparation
      && new Set(["sending", "outcome_ambiguous", "recovery_claimed"]).has(
        normalizeText(paymentDispatch?.state).toLowerCase()
      )
    );
    if (expiredPortalUnknownDispatch && !executionAlreadyFinalized) {
      let recoveryClaim;
      try {
        recoveryClaim = await claimExpiredPortalPaymentDispatchRecovery({
          executionRef,
          organizationId,
          quoteId,
          approvalRequestId,
          staff,
          action: flow.action
        });
      } catch (recoveryClaimError) {
        functions.logger.error("Expired-portal payment dispatch recovery could not be claimed", {
          organizationId,
          quoteId,
          approvalRequestId,
          error: normalizeText(recoveryClaimError?.message)
        });
        throw new functions.https.HttpsError(
          "aborted",
          "The expired-portal payment recovery claim could not be recorded. Retry the exact approved request before changing payment state."
        );
      }
      paymentDispatch = recoveryClaim.dispatch;
      if (recoveryClaim.action === "wait_for_active_provider_attempt") {
        throw new functions.https.HttpsError(
          "aborted",
          "The original payment email attempt may still be active. Retry the exact approved request after its recovery boundary; QuotePilot will not expire Stripe while delivery may be in flight."
        );
      }
      if (recoveryClaim.action === "recover_provider_unknown") {
        let resolution = null;
        try {
          resolution = await finalizeExpiredPortalAmbiguousDispatch({
            quoteRef,
            executionRef,
            privateDispatchRef,
            quoteId,
            organizationId,
            approvalRequestId,
            staff,
            checkoutPreparation,
            quote: claimedQuote,
            paymentKind: flow.paymentKind
          });
        } catch (recoveryError) {
          functions.logger.error("Expired-portal ambiguous payment dispatch could not be closed", {
            organizationId,
            quoteId,
            approvalRequestId,
            error: normalizeText(recoveryError?.message)
          });
        }
        if (resolution) {
          throw new functions.https.HttpsError(
            "failed-precondition",
            resolution.manualReviewRequired
              ? "The portal expired while the payment email outcome was unknown. The stale approval is closed; reconcile the recorded Stripe checkout before requesting another payment."
              : `The portal expired while the payment email outcome was unknown. The recorded Stripe checkout is ${resolution.providerState} and the stale approval is closed; request and approve a fresh payment request if money remains due.`
          );
        }
        throw new functions.https.HttpsError(
          "aborted",
          "The expired-portal payment dispatch could not be closed safely. Reconcile the recorded Stripe checkout before retrying."
        );
      }
      // Provider acceptance or definite failure may have won the recovery race.
      // Fall through so the canonical dispatch-state handlers finish that state.
      if (!new Set(["provider_accepted", "definite_failure"]).has(
        normalizeText(paymentDispatch?.state).toLowerCase()
      )) {
        throw new functions.https.HttpsError(
          "aborted",
          "The expired-portal payment dispatch changed during recovery. Retry the exact approved request."
        );
      }
    }
    let dispatchFailurePlan = null;
    if (claimedQuote && !providerAccepted && paymentDispatch) {
      try {
        dispatchFailurePlan = await recordPaymentDispatchFailure({
          executionRef,
          organizationId,
          quoteId,
          approvalRequestId,
          error: err,
          action: flow.action
        });
      } catch (dispatchAuditError) {
        functions.logger.error("Payment email outcome audit could not be recorded", {
          organizationId,
          quoteId,
          approvalRequestId,
          error: normalizeText(dispatchAuditError?.message)
        });
        dispatchFailurePlan = {
          outcome: "ambiguous",
          executionState: "in_progress",
          shouldNeutralizeCheckout: false
        };
      }
    }
    const providerAcceptedCheckoutExpired = Boolean(
      err?.paymentCheckoutExpired
      && checkoutPreparation
      && dispatchFailurePlan?.outcome === "provider_accepted"
    );
    if (providerAcceptedCheckoutExpired && !executionAlreadyFinalized) {
      let finalized = false;
      try {
        finalized = await finalizeProviderAcceptedExpiredCheckout({
          quoteRef,
          executionRef,
          privateDispatchRef,
          quoteId,
          organizationId,
          approvalRequestId,
          staff,
          checkoutPreparation,
          paymentKind: flow.paymentKind
        });
      } catch (recoveryError) {
        functions.logger.error("Provider-accepted expired checkout could not be finalized", {
          organizationId,
          quoteId,
          approvalRequestId,
          error: normalizeText(recoveryError?.message)
        });
      }
      if (finalized) {
        throw new functions.https.HttpsError(
          "failed-precondition",
          "The payment email was accepted by the provider, but its Stripe checkout expired before publication completed. The operation is closed; request and approve a fresh payment request."
        );
      }
    }
    const checkoutPreparationAmbiguous = normalizeText(err?.paymentCheckoutOutcome).toLowerCase()
      === "ambiguous";
    if (claimedQuote && checkoutPreparationAmbiguous) {
      try {
        await db.runTransaction(async (tx) => {
          const executionSnap = await tx.get(executionRef);
          if (
            !executionSnap.exists
            || normalizeText(executionSnap.data()?.state).toLowerCase() !== "in_progress"
          ) {
            return;
          }
          tx.set(executionRef, {
            checkoutPreparationOutcome: "outcome_ambiguous",
            checkoutPreparationReason: normalizeText(err?.paymentCheckoutReason).slice(0, 160),
            error: "Stripe checkout preparation outcome is uncertain; retry this exact approval.",
            updatedAtISO: new Date().toISOString(),
            updatedAt: FieldValue.serverTimestamp()
          }, { merge: true });
        });
      } catch (checkoutAuditError) {
        functions.logger.error("Ambiguous Stripe checkout preparation could not be audited", {
          organizationId,
          quoteId,
          approvalRequestId,
          error: normalizeText(checkoutAuditError?.message)
        });
      }
    }
    let checkoutCleanupIncomplete = false;
    let keepExecutionResumable = providerAccepted
      || checkoutPreparationAmbiguous
      || executionStateUncertain
      || dispatchFailurePlan?.executionState === "in_progress";
    if (
      claimedQuote
      && !providerAccepted
      && !keepExecutionResumable
      && !executionAlreadyFinalized
    ) {
      const failedAtISO = new Date().toISOString();
      if (checkoutPreparation && !checkoutPreparation.paymentAlreadyPublished) {
        let cleanupResolved = false;
        try {
          const stripe = getStripeClient();
          const providerNeutralized = await neutralizeRejectedStripeCheckout(
            stripe,
            checkoutPreparation.stripeSessionId
          );
          if (providerNeutralized) {
            cleanupResolved = await markPreparedCheckoutExpiredIfUnchanged({
              quoteId,
              organizationId,
              preparedPayment: checkoutPreparation.preparedPayment,
              paymentKind: flow.paymentKind,
              operationId: approvalRequestId
            });
            if (!cleanupResolved) {
              cleanupResolved = await advanceCheckoutGenerationIfUnchanged({
                quoteId,
                organizationId,
                expectedPayment: checkoutPreparation.expectedPayment,
                checkoutGeneration: checkoutPreparation.checkoutGeneration,
                paymentKind: flow.paymentKind,
                operationId: approvalRequestId
              });
            }
            if (!cleanupResolved) {
              cleanupResolved = await isCheckoutCleanupStateResolved({
                quoteId,
                organizationId,
                preparedPayment: checkoutPreparation.preparedPayment,
                paymentKind: flow.paymentKind
              });
            }
          }
        } catch (neutralizeError) {
          functions.logger.error("Failed to neutralize an unsent approved checkout", {
            organizationId,
            quoteId,
            approvalRequestId,
            stripeSessionId: checkoutPreparation.stripeSessionId,
            error: normalizeText(neutralizeError?.message)
          });
        }
        checkoutCleanupIncomplete = !cleanupResolved;
      }
      if (checkoutCleanupIncomplete) {
        keepExecutionResumable = true;
        try {
          await executionRef.set({
            error: "Stripe checkout cleanup is unresolved; retry this exact approval or reconcile provider state.",
            updatedAtISO: failedAtISO,
            updatedAt: FieldValue.serverTimestamp()
          }, { merge: true });
        } catch (cleanupAuditError) {
          functions.logger.error("Unresolved Stripe checkout cleanup could not be audited", {
            organizationId,
            quoteId,
            approvalRequestId,
            error: normalizeText(cleanupAuditError?.message)
          });
        }
      } else try {
        await db.runTransaction(async (tx) => {
          const [quoteSnap, executionSnap, privateDispatchSnap] = await Promise.all([
            tx.get(quoteRef),
            tx.get(executionRef),
            tx.get(privateDispatchRef)
          ]);
          if (!quoteSnap.exists || !executionSnap.exists) return;
          const currentQuote = quoteSnap.data() || {};
          const execution = executionSnap.data() || {};
          if (normalizeText(execution.state).toLowerCase() !== "in_progress") return;
          const outcome = buildApprovalExecutionOutcome({
            workflow: currentQuote.workflow,
            requestId: approvalRequestId,
            action: flow.action,
            actorEmail: staff.email,
            nowISO: failedAtISO,
            operationId: approvalRequestId,
            state: "failed",
            error: "Payment request email could not be sent."
          });
          tx.update(quoteRef, {
            "workflow.approvalRequests": outcome.approvalRequests,
            updatedAtISO: failedAtISO,
            updatedAt: FieldValue.serverTimestamp()
          });
          tx.set(executionRef, {
            state: "failed",
            result: {},
            ...(execution.checkoutPreparation
              ? {
                checkoutPreparation: {
                  ...execution.checkoutPreparation,
                  privateDepositLink: "",
                  exposureState: "failed",
                  failedAtISO
                }
              }
              : {}),
            error: "Payment request email could not be sent.",
            completedAtISO: failedAtISO,
            updatedAtISO: failedAtISO,
            updatedAt: FieldValue.serverTimestamp()
          }, { merge: true });
          if (privateDispatchSnap.exists) {
            tx.set(privateDispatchRef, {
              privateDepositLink: "",
              exposureState: "failed",
              failedAtISO,
              updatedAtISO: failedAtISO,
              updatedAt: FieldValue.serverTimestamp()
            }, { merge: true });
          }
        });
      } catch (auditErr) {
        functions.logger.error("Payment-request failure audit could not be finalized", {
          organizationId,
          quoteId,
          approvalRequestId,
          error: normalizeText(auditErr?.message)
        });
      }
    }
    if (keepExecutionResumable && !providerAccepted) {
      throw new functions.https.HttpsError(
        "aborted",
        checkoutPreparationAmbiguous
          ? "Stripe checkout preparation is uncertain. Retry the same approved payment request; QuotePilot will reuse the same Stripe idempotency key and recover any durable preparation."
          : checkoutCleanupIncomplete
            ? "Stripe checkout cleanup is unresolved. Retry the same approved payment request or reconcile the recorded Stripe session."
          : "Payment email outcome is uncertain. Retry the same approved payment request; QuotePilot will reuse the same provider key and checkout."
      );
    }
    if (err instanceof functions.https.HttpsError) throw err;
    if (err instanceof QuoteDeliveryError) {
      throw new functions.https.HttpsError(err.code, err.message);
    }
    if (
      err instanceof ApprovalWorkflowError
      || err instanceof PaymentApprovalScopeError
      || err instanceof PaymentSafetyError
      || err instanceof PaymentDispatchStateError
      || err instanceof PaymentLedgerError
    ) {
      throw new functions.https.HttpsError(err.code, err.message);
    }
    functions.logger.error("Approved payment request failed", {
      organizationId,
      quoteId,
      approvalRequestId,
      actorUid: staff.uid,
      error: normalizeText(err?.message)
    });
    throw new functions.https.HttpsError(
      "internal",
      "Failed to send the approved payment request."
    );
  }
}

exports.sendPaymentRequestEmail = functions
  .runWith({ secrets: [STRIPE_SECRET_NAME, RESEND_API_KEY_SECRET_NAME] })
  .region(REGION)
  .https.onCall((data, context) => (
    sendApprovedPaymentRequestEmail(data, context, "deposit")
  ));

exports.sendFinalBalanceRequestEmail = functions
  .runWith({ secrets: [STRIPE_SECRET_NAME, RESEND_API_KEY_SECRET_NAME] })
  .region(REGION)
  .https.onCall((data, context) => (
    sendApprovedPaymentRequestEmail(data, context, "final_balance")
  ));

exports.getIntegrationSetupStatus = functions
  .runWith({
    secrets: [
      STRIPE_SECRET_NAME,
      STRIPE_WEBHOOK_SECRET_NAME,
      RESEND_API_KEY_SECRET_NAME,
      TWILIO_AUTH_TOKEN_SECRET_NAME
    ]
  })
  .region(REGION)
  .https.onCall(async (_data, context) => {
    assertAdminStaff(await assertStaff(context));
    return {
      ok: true,
      status: buildIntegrationSetupStatus()
    };
  });

exports.sendIntegrationTestSms = functions
  .runWith({
    secrets: [
      STRIPE_SECRET_NAME,
      STRIPE_WEBHOOK_SECRET_NAME,
      RESEND_API_KEY_SECRET_NAME,
      TWILIO_AUTH_TOKEN_SECRET_NAME
    ]
  })
  .region(REGION)
  .https.onCall(async (data, context) => {
    const staff = assertAdminStaff(await assertStaff(context));
    const actorEmail = normalizeEmail(context?.auth?.token?.email || staff.uid);
    const customMessage = normalizeText(data?.message);
    const message =
      customMessage ||
      `Integration SMS test from QuotePilot (${new Date().toISOString()}) sent by ${actorEmail}.`;
    const sms = await sendOwnerSms(message);

    return {
      ok: true,
      sms,
      status: buildIntegrationSetupStatus()
    };
  });

function normalizeApprovedCheckoutPreparation(input = {}) {
  const source = input && typeof input === "object" ? input : {};
  const paymentKind = normalizeText(source.paymentKind).toLowerCase() || "deposit";
  const flow = getPaymentRequestFlow(paymentKind);
  const operationId = normalizeApprovalExecutionId(source.operationId);
  const privateDepositLink = parseStoredPaymentLinkOrThrow(
    source.privateDepositLink || source.url
  );
  const stripeSessionId = normalizeText(source.stripeSessionId || source.sessionId);
  const checkoutGeneration = Number(source.checkoutGeneration);
  const actionScopeDigest = normalizeText(source.actionScopeDigest).toLowerCase();
  const expectedPayment = normalizeCheckoutTransitionState(source.expectedPayment);
  const preparedPayment = normalizeCheckoutTransitionState(
    source.preparedPayment || source.expectedPayment
  );
  const publishedPayment = normalizeCheckoutTransitionState(
    source.publishedPayment || source.nextPayment
  );
  const paymentAlreadyPublished = source.paymentAlreadyPublished === true;
  if (
    !/^cs_[A-Za-z0-9_]+$/.test(stripeSessionId)
    || !Number.isSafeInteger(checkoutGeneration)
    || checkoutGeneration < 0
    || !/^[a-f0-9]{64}$/.test(actionScopeDigest)
    || publishedPayment.stripeSessionId !== stripeSessionId
    || publishedPayment.checkoutGeneration !== checkoutGeneration
    || (paymentKind === "final_balance" && !operationId)
  ) {
    throw new PaymentSafetyError("Prepared Stripe checkout evidence is invalid.");
  }
  if (paymentAlreadyPublished) {
    if (
      publishedPayment.depositStatus !== "sent"
      || publishedPayment.depositLink !== privateDepositLink
      || publishedPayment.stripeCheckoutState !== "open"
    ) {
      throw new PaymentSafetyError("Published Stripe checkout evidence is invalid.");
    }
  } else {
    assertPreparedCheckoutRegistrationTransition({
      currentPayment: expectedPayment,
      expectedPayment,
      preparedPayment
    });
    assertPreparedCheckoutPublicationTransition({
      currentPayment: preparedPayment,
      expectedPreparedPayment: preparedPayment,
      publishedPayment
    });
    if (publishedPayment.depositLink !== privateDepositLink) {
      throw new PaymentSafetyError("Prepared checkout URL does not match publication evidence.");
    }
  }
  return {
    stripeSessionId,
    checkoutGeneration,
    privateDepositLink,
    expectedPayment,
    preparedPayment,
    publishedPayment,
    paymentAlreadyPublished,
    actionScopeDigest,
    paymentKind: flow.paymentKind,
    operationId: operationId || "",
    exposureState: normalizeText(source.exposureState).toLowerCase() || "prepared",
    preparedAtISO: normalizeText(source.preparedAtISO)
  };
}

async function restoreApprovedCheckoutPreparation({
  preparation,
  quote,
  quoteId,
  organizationId,
  approvalRequestId,
  actionScopeDigest
} = {}) {
  const normalized = normalizeApprovedCheckoutPreparation(preparation);
  const flow = getPaymentRequestFlow(normalized.paymentKind);
  const expectedScopeDigest = normalizeText(actionScopeDigest).toLowerCase();
  if (normalized.actionScopeDigest !== expectedScopeDigest) {
    throw new PaymentSafetyError(
      "Prepared checkout does not match the approved payment scope."
    );
  }
  const stripe = getStripeClient();
  const session = await stripe.checkout.sessions.retrieve(normalized.stripeSessionId);
  assertStripeObjectMode({
    expectedMode: getStripeMode(),
    eventLivemode: session?.livemode,
    sessionLivemode: session?.livemode
  });
  validateStripeCheckoutScope({
    session,
    quote: stripeScopeQuoteForPayment(quote, flow.paymentKind, {
      ...normalized.publishedPayment,
      stripeSessionId: normalized.stripeSessionId
    }),
    quoteId,
    organizationId
  });
  assertStripePaymentKindMetadata(session, flow.paymentKind);
  const sessionStatus = normalizeText(session.status).toLowerCase();
  const paymentStatus = normalizeText(session.payment_status).toLowerCase();
  const expiresAtMs = Number(session.expires_at || 0) * 1000;
  const checkoutExpired = paymentStatus !== "paid" && (
    sessionStatus === "expired"
    || (sessionStatus === "open" && Number.isFinite(expiresAtMs) && expiresAtMs <= Date.now())
  );
  if (checkoutExpired) {
    const expiredError = new PaymentSafetyError(
      "The approved Stripe checkout expired before the payment request completed."
    );
    expiredError.paymentCheckoutExpired = true;
    throw expiredError;
  }
  if (
    sessionStatus === "open"
    && (
      paymentStatus !== "unpaid"
      || !Number.isFinite(expiresAtMs)
      || expiresAtMs <= Date.now()
    )
  ) {
    throw new PaymentSafetyError("The prepared Stripe checkout is not safely payable.");
  }
  if (!["open", "complete"].includes(sessionStatus) && paymentStatus !== "paid") {
    throw new PaymentSafetyError("The prepared Stripe checkout is not safely reusable.");
  }
  const providerUrl = normalizeText(session.url)
    ? parseStoredPaymentLinkOrThrow(session.url)
    : normalized.privateDepositLink;
  if (providerUrl !== normalized.privateDepositLink) {
    throw new PaymentSafetyError(
      "The prepared checkout URL does not match the Stripe session."
    );
  }
  const metadataApprovalId = normalizeApprovalExecutionId(session?.metadata?.approvalRequestId);
  const metadataScopeDigest = normalizeText(session?.metadata?.actionScopeDigest).toLowerCase();
  if (
    !normalized.paymentAlreadyPublished
    && (
      metadataApprovalId !== normalizeApprovalExecutionId(approvalRequestId)
      || metadataScopeDigest !== normalized.actionScopeDigest
      || normalizeText(session?.metadata?.paymentKind).toLowerCase() !== flow.paymentKind
      || normalizeText(session?.metadata?.currency).toLowerCase() !== "usd"
      || Number(session?.metadata?.checkoutGeneration) !== normalized.checkoutGeneration
      || (
        flow.paymentKind === "final_balance"
        && normalized.operationId !== normalizeApprovalExecutionId(approvalRequestId)
      )
    )
  ) {
    throw new PaymentSafetyError(
      "Stripe checkout metadata does not match the approved payment request."
    );
  }
  if (
    normalized.paymentAlreadyPublished
    && metadataScopeDigest
    && metadataScopeDigest !== normalized.actionScopeDigest
  ) {
    throw new PaymentSafetyError(
      "The published Stripe checkout belongs to a different approval scope."
    );
  }
  return normalized;
}

async function recoverPersistedApprovedCheckoutPreparation({
  executionRef,
  privateDispatchRef,
  organizationId,
  quoteId,
  approvalRequestId,
  staff,
  expectedApprovalScopeDigest,
  paymentKind = "deposit"
} = {}) {
  const flow = getPaymentRequestFlow(paymentKind);
  const [executionSnap, privateDispatchSnap] = await Promise.all([
    executionRef.get(),
    privateDispatchRef.get()
  ]);
  if (!executionSnap.exists) return null;
  const execution = executionSnap.data() || {};
  assertMatchingApprovalExecutionRecord(execution, {
    organizationId,
    quoteId,
    approvalRequestId,
    action: flow.action
  });
  const hasAuditPreparation = Boolean(execution.checkoutPreparation);
  if (!hasAuditPreparation && !privateDispatchSnap.exists) return null;
  if (
    !hasAuditPreparation
    || !privateDispatchSnap.exists
    || normalizeText(execution.state).toLowerCase() !== "in_progress"
    || normalizeText(execution.executedBy?.uid) !== normalizeText(staff?.uid)
    || normalizeText(execution.actionScopeDigest).toLowerCase()
      !== normalizeText(expectedApprovalScopeDigest).toLowerCase()
  ) {
    throw new PaymentSafetyError(
      "Stripe checkout preparation persistence is incomplete and requires recovery."
    );
  }
  const normalized = normalizeApprovedCheckoutPreparation(
    restorePrivateCheckoutPreparation(
      execution.checkoutPreparation,
      privateDispatchSnap.data(),
      { organizationId, quoteId, approvalRequestId }
    )
  );
  if (normalized.paymentKind !== flow.paymentKind) {
    throw new PaymentSafetyError("Recovered checkout payment kind is invalid.");
  }
  return normalized;
}

async function persistApprovedCheckoutPreparation({
  quoteRef,
  executionRef,
  quoteId,
  organizationId,
  approvalRequestId,
  staff,
  expectedApprovalScopeDigest,
  prepared,
  paymentKind = "deposit"
} = {}) {
  const flow = getPaymentRequestFlow(paymentKind);
  const preparedAtISO = new Date().toISOString();
  const preparation = normalizeApprovedCheckoutPreparation({
    ...prepared,
    privateDepositLink: prepared?.url,
    stripeSessionId: prepared?.sessionId,
    actionScopeDigest: expectedApprovalScopeDigest,
    paymentKind: flow.paymentKind,
    operationId: approvalRequestId,
    exposureState: "prepared",
    preparedAtISO
  });
  const privateDispatchRef = getPrivatePaymentDispatchDocRef(
    organizationId,
    approvalRequestId
  );
  return db.runTransaction(async (tx) => {
    const [quoteSnap, executionSnap, privateDispatchSnap] = await Promise.all([
      tx.get(quoteRef),
      tx.get(executionRef),
      tx.get(privateDispatchRef)
    ]);
    if (!quoteSnap.exists || !executionSnap.exists) {
      throw new ApprovalWorkflowError(
        "failed-precondition",
        "Payment-request execution disappeared before checkout preparation."
      );
    }
    const currentQuote = quoteSnap.data() || {};
    const execution = executionSnap.data() || {};
    assertMatchingApprovalExecutionRecord(execution, {
      organizationId,
      quoteId,
      approvalRequestId,
      action: flow.action
    });
    if (
      normalizeText(execution.state).toLowerCase() !== "in_progress"
      || normalizeText(execution.executedBy?.uid) !== normalizeText(staff?.uid)
      || normalizeText(execution.actionScopeDigest).toLowerCase()
        !== preparation.actionScopeDigest
    ) {
      throw new ApprovalWorkflowError(
        "aborted",
        "Payment-request execution ownership or scope changed during checkout preparation."
      );
    }
    if (execution.checkoutPreparation) {
      return normalizeApprovedCheckoutPreparation(
        restorePrivateCheckoutPreparation(
          execution.checkoutPreparation,
          privateDispatchSnap.exists ? privateDispatchSnap.data() : null,
          { organizationId, quoteId, approvalRequestId }
        )
      );
    }
    const portalKey = normalizeText(currentQuote.portalKey);
    const portalSnap = await tx.get(db.collection(PORTAL_COLLECTION).doc(portalKey));
    const currentScope = deriveApprovedPaymentRequestScope({
      quote: currentQuote,
      quoteId,
      organizationId,
      portalSnapshot: portalSnap.exists ? portalSnap.data() : null,
      nowISO: preparedAtISO
    }, flow.paymentKind);
    const approvalRequest = findQuoteApprovalRequest(
      currentQuote.workflow,
      approvalRequestId
    );
    const verifiedScope = assertPaymentApprovalRequestScope({
      approvalRequest,
      expected: currentScope
    });
    if (verifiedScope.actionScopeDigest !== preparation.actionScopeDigest) {
      throw new ApprovalWorkflowError(
        "failed-precondition",
        "Payment approval scope changed while Stripe checkout was prepared."
      );
    }
    const currentPayment = checkoutPaymentForQuote(currentQuote, flow.paymentKind);
    if (
      JSON.stringify(currentPayment) !== JSON.stringify(preparation.expectedPayment)
      && JSON.stringify(currentPayment) !== JSON.stringify(preparation.preparedPayment)
      && JSON.stringify(currentPayment) !== JSON.stringify(preparation.publishedPayment)
    ) {
      throw new PaymentSafetyError(
        "Quote payment state changed while Stripe checkout was prepared."
      );
    }
    if (!preparation.paymentAlreadyPublished) {
      const registration = assertPreparedCheckoutRegistrationTransition({
        currentPayment,
        expectedPayment: preparation.expectedPayment,
        preparedPayment: preparation.preparedPayment
      });
      if (!registration.alreadyApplied) {
        const quotePaymentUpdate = {
          updatedAtISO: preparedAtISO,
          updatedAt: FieldValue.serverTimestamp()
        };
        appendPaymentStateUpdate(quotePaymentUpdate, {
          paymentKind: flow.paymentKind,
          checkoutPayment: preparation.preparedPayment,
          amountCents: paymentAmountCentsForQuote(currentQuote, flow.paymentKind),
          operationId: approvalRequestId,
          audit: {
            lastCheckoutCreatedAtISO: preparedAtISO,
            lastHost: normalizeHostname(staff.host),
            lastEventType: "checkout.session.prepared",
            lastOrganizationId: organizationId
          }
        });
        if (flow.paymentKind === "final_balance") {
          const ledgerPlan = planFinalBalanceLedgerTransition({
            quote: currentQuote,
            operationId: approvalRequestId,
            amountCents: paymentAmountCentsForQuote(currentQuote, flow.paymentKind),
            nextState: "prepared",
            providerReference: preparation.stripeSessionId
          });
          quotePaymentUpdate["payment.ledger"] = ledgerPlan.ledger;
        }
        tx.update(quoteRef, quotePaymentUpdate);
      }
    }
    tx.set(executionRef, {
      checkoutPreparation: redactCheckoutPreparation(preparation),
      updatedAtISO: preparedAtISO,
      updatedAt: FieldValue.serverTimestamp()
    }, { merge: true });
    tx.set(privateDispatchRef, {
      organizationId,
      quoteId,
      approvalRequestId,
      stripeSessionId: preparation.stripeSessionId,
      actionScopeDigest: preparation.actionScopeDigest,
      paymentKind: flow.paymentKind,
      operationId: approvalRequestId,
      privateDepositLink: preparation.privateDepositLink,
      exposureState: "prepared",
      createdAtISO: preparedAtISO,
      updatedAtISO: preparedAtISO,
      updatedAt: FieldValue.serverTimestamp()
    }, { merge: false });
    return preparation;
  });
}

async function prepareCheckoutForApprovedSend({
  quoteId,
  quote,
  quoteNumber,
  organizationId,
  approvalRequestId,
  actionScopeDigest,
  paymentKind = "deposit"
} = {}) {
  const flow = getPaymentRequestFlow(paymentKind);
  const normalizedApprovalRequestId = normalizeApprovalExecutionId(approvalRequestId);
  const normalizedScopeDigest = normalizeText(actionScopeDigest).toLowerCase();
  if (!normalizedApprovalRequestId || !/^[a-f0-9]{64}$/.test(normalizedScopeDigest)) {
    throw new functions.https.HttpsError(
      "failed-precondition",
      "An exact approved payment scope is required before preparing Stripe checkout."
    );
  }
  try {
    assertQuoteEditNotDispatching(
      { ...quote, id: quoteId },
      new Date().toISOString()
    );
  } catch (err) {
    if (err instanceof QuoteDeliveryError) {
      throw new functions.https.HttpsError(err.code, err.message);
    }
    throw err;
  }
  const quoteStatus = normalizeText(quote?.status).toLowerCase();
  if (
    (flow.paymentKind === "deposit" && !["accepted", "booked"].includes(quoteStatus))
    || (flow.paymentKind === "final_balance" && quoteStatus !== "booked")
  ) {
    throw new functions.https.HttpsError(
      "failed-precondition",
      flow.paymentKind === "final_balance"
        ? "Final-balance checkout requires a booked quote."
        : "Deposit checkout can be created only after quote acceptance."
    );
  }
  const amountCents = paymentAmountCentsForQuote(quote, flow.paymentKind);
  const quotePortalKey = normalizeText(quote.portalKey);
  if (!quotePortalKey) {
    throw new functions.https.HttpsError(
      "failed-precondition",
      "A customer portal must exist before creating a deposit checkout."
    );
  }
  let checkoutPlan;
  try {
    checkoutPlan = planDepositCheckout(checkoutPaymentForQuote(quote, flow.paymentKind));
  } catch (err) {
    if (err instanceof PaymentSafetyError) {
      throw new functions.https.HttpsError("failed-precondition", err.message);
    }
    throw err;
  }
  const stripe = getStripeClient();
  if (checkoutPlan.action === "inspect_prepared") {
    throw new functions.https.HttpsError(
      "failed-precondition",
      "A prepared Stripe checkout is awaiting its private dispatch record. Resume the existing approved payment request or request provider review."
    );
  }
  if (checkoutPlan.action === "inspect_existing") {
    const existingUrl = parseStoredPaymentLinkOrThrow(checkoutPlan.depositLink);
    const existingSession = await stripe.checkout.sessions.retrieve(
      checkoutPlan.stripeSessionId
    );
    assertStripeObjectMode({
      expectedMode: getStripeMode(),
      eventLivemode: existingSession?.livemode,
      sessionLivemode: existingSession?.livemode
    });
    try {
      validateStripeCheckoutScope({
        session: existingSession,
        quote: stripeScopeQuoteForPayment(quote, flow.paymentKind),
        quoteId,
        organizationId
      });
      assertStripePaymentKindMetadata(existingSession, flow.paymentKind);
    } catch (err) {
      if (err instanceof PaymentSafetyError) {
        throw new functions.https.HttpsError("failed-precondition", err.message);
      }
      throw err;
    }
    const providerPaymentStatus = normalizeText(existingSession.payment_status).toLowerCase();
    const providerSessionStatus = normalizeText(existingSession.status).toLowerCase();
    if (providerPaymentStatus === "paid") {
      throw new functions.https.HttpsError(
        "failed-precondition",
        "The existing Stripe checkout is already paid and is awaiting webhook reconciliation."
      );
    }
    if (providerSessionStatus === "complete") {
      throw new functions.https.HttpsError(
        "failed-precondition",
        "The existing Stripe checkout is complete and awaiting its final payment result."
      );
    }
    const expiresAtMs = Number(existingSession.expires_at || 0) * 1000;
    const activeOpenSession = providerSessionStatus === "open"
      && Number.isFinite(expiresAtMs)
      && expiresAtMs > Date.now();
    if (activeOpenSession) {
      const providerUrl = parseStoredPaymentLinkOrThrow(existingSession.url);
      if (providerUrl !== existingUrl) {
        throw new functions.https.HttpsError(
          "failed-precondition",
          "The stored checkout link does not match the active Stripe session."
        );
      }
      return {
        reused: true,
        quoteId,
        quoteNumber,
        url: providerUrl,
        sessionId: checkoutPlan.stripeSessionId,
        checkoutGeneration: checkoutPlan.checkoutGeneration,
        expectedPayment: checkoutPaymentForQuote(quote, flow.paymentKind),
        preparedPayment: checkoutPaymentForQuote(quote, flow.paymentKind),
        publishedPayment: checkoutPaymentForQuote(quote, flow.paymentKind),
        paymentAlreadyPublished: true
      };
    }
    if (providerSessionStatus === "open") {
      await stripe.checkout.sessions.expire(checkoutPlan.stripeSessionId);
    } else if (providerSessionStatus !== "expired") {
      throw new functions.https.HttpsError(
        "failed-precondition",
        "The existing Stripe checkout is not safely replaceable."
      );
    }
  }

  const defaultBase = parseUrlOrThrow(
    readConfig("app.base_url", "https://quotepilot.mbmapps.com/app"),
    "app.base_url"
  );
  const successUrl = new URL(defaultBase);
  const cancelUrl = new URL(defaultBase);
  if (quotePortalKey) {
    successUrl.searchParams.set("portal", quotePortalKey);
    cancelUrl.searchParams.set("portal", quotePortalKey);
  }
  successUrl.searchParams.set("payment", "success");
  cancelUrl.searchParams.set("payment", "cancelled");
  successUrl.searchParams.set("payment_kind", flow.paymentKind);
  cancelUrl.searchParams.set("payment_kind", flow.paymentKind);

  const checkoutGeneration = checkoutPlan.nextCheckoutGeneration;
  let session;
  try {
    session = await stripe.checkout.sessions.create(
      {
      mode: "payment",
      success_url: successUrl.toString(),
      cancel_url: cancelUrl.toString(),
      customer_email: normalizeEmail(quote?.customer?.email) || undefined,
      metadata: {
        quoteId,
        quoteNumber,
        organizationId: organizationId || "",
        portalKey: quotePortalKey || "",
        quoteRevisionId: resolveQuoteDeliveryRevisionId(quote, quoteId),
        approvalRequestId: normalizedApprovalRequestId,
        actionScopeDigest: normalizedScopeDigest,
        paymentKind: flow.paymentKind,
        currency: "usd",
        checkoutGeneration: String(checkoutGeneration)
      },
      line_items: [
        {
          quantity: 1,
          price_data: {
            currency: "usd",
            unit_amount: amountCents,
            product_data: {
              name: `${flow.paymentKind === "final_balance" ? "Final balance" : "Deposit"} for ${quoteNumber}`,
              description: normalizeText(quote?.event?.name)
                || (flow.paymentKind === "final_balance"
                  ? "Catering contract final balance"
                  : "Catering quote deposit")
            }
          }
        }
      ]
      },
      {
        idempotencyKey: buildStripeCheckoutIdempotencyKey({
          quoteId,
          organizationId,
          portalKey: quotePortalKey,
          amountTotal: amountCents,
          checkoutGeneration,
          paymentKind: flow.paymentKind
        })
      }
    );
  } catch (err) {
    if (!isAmbiguousStripeProviderError(err)) throw err;
    const stripeType = normalizeText(err?.type || err?.rawType).toLowerCase();
    const status = Number(err?.statusCode || err?.status || 0);
    throw annotatePaymentCheckoutOutcome(err, {
      reason: stripeType || `stripe_http_${status || "unknown"}`
    });
  }

  const sessionId = normalizeText(session.id);
  if (!sessionId) {
    throw new functions.https.HttpsError(
      "internal",
      "Stripe did not return a checkout session ID."
    );
  }
  let sessionUrl = "";
  try {
    const currentSession = session;
    assertStripeObjectMode({
      expectedMode: getStripeMode(),
      eventLivemode: currentSession?.livemode,
      sessionLivemode: currentSession?.livemode
    });
    validateStripeCheckoutScope({
      session: currentSession,
      quote: stripeScopeQuoteForPayment(quote, flow.paymentKind, {
        ...checkoutPaymentForQuote(quote, flow.paymentKind),
        stripeSessionId: sessionId
      }),
      quoteId,
      organizationId
    });
    assertStripePaymentKindMetadata(currentSession, flow.paymentKind);
    const currentSessionStatus = normalizeText(currentSession.status).toLowerCase();
    const currentPaymentStatus = normalizeText(currentSession.payment_status).toLowerCase();
    const currentExpiresAtMs = Number(currentSession.expires_at || 0) * 1000;
    if (
      currentSessionStatus !== "open"
      || currentPaymentStatus !== "unpaid"
      || !Number.isFinite(currentExpiresAtMs)
      || currentExpiresAtMs <= Date.now()
    ) {
      throw new PaymentSafetyError(
        "Stripe did not return a fresh open and unpaid checkout session."
      );
    }
    sessionUrl = parseStoredPaymentLinkOrThrow(currentSession.url);
  } catch (err) {
    let neutralized = false;
    let cleanupError = null;
    try {
      neutralized = await neutralizeRejectedStripeCheckout(stripe, sessionId);
    } catch (expireError) {
      cleanupError = expireError;
      functions.logger.error("Failed to expire an invalid Stripe checkout session", {
        sessionId,
        errorMessage: normalizeText(expireError?.message).slice(0, 180)
      });
    }
    if (neutralized) {
      let generationAdvanced = false;
      try {
        generationAdvanced = await advanceCheckoutGenerationIfUnchanged({
          quoteId,
          organizationId,
          expectedPayment: checkoutPaymentForQuote(quote, flow.paymentKind),
          checkoutGeneration,
          paymentKind: flow.paymentKind,
          operationId: approvalRequestId
        });
      } catch (generationError) {
        cleanupError = generationError;
      }
      if (!generationAdvanced) {
        throw annotatePaymentCheckoutOutcome(cleanupError || err, {
          reason: "post_create_generation_cleanup_ambiguous"
        });
      }
    } else {
      throw annotatePaymentCheckoutOutcome(cleanupError || err, {
        reason: "post_create_provider_cleanup_ambiguous"
      });
    }
    if (err instanceof PaymentSafetyError) {
      throw new functions.https.HttpsError("failed-precondition", err.message);
    }
    throw err;
  }
  const expectedPayment = checkoutPaymentForQuote(quote, flow.paymentKind);
  const preparedPayment = buildPreparedCheckoutState({
    expectedPayment,
    stripeSessionId: sessionId,
    checkoutGeneration
  });
  const publishedPayment = buildPublishedCheckoutState({
    preparedPayment,
    depositLink: sessionUrl
  });

  return {
    reused: false,
    quoteId,
    quoteNumber,
    url: sessionUrl,
    sessionId,
    checkoutGeneration,
    expectedPayment,
    preparedPayment,
    publishedPayment,
    paymentAlreadyPublished: false
  };
}

async function reconcileCheckout(data, context, paymentKind = "deposit") {
  const flow = getPaymentRequestFlow(paymentKind);
  if (
    normalizeText(data?.stripeSessionId)
    || data?.amountCents != null
    || data?.paymentKind != null
  ) {
    throw new functions.https.HttpsError(
      "invalid-argument",
      "Reconciliation payment identity and amount are server-derived."
    );
  }
  const staff = assertAdminStaff(await assertStaff(context));
  const { quoteId, quote, quoteNumber, organizationId } = await readQuoteOrThrow(data?.quoteId, {
    organizationId: staff.organizationId
  });
  if (normalizeOrganizationId(staff.principalOrganizationId) !== organizationId) {
    throw new functions.https.HttpsError(
      "permission-denied",
      "Payment reconciliation requires same-organization admin authority."
    );
  }
  const checkoutPayment = checkoutPaymentForQuote(quote, flow.paymentKind);
  const stripeSessionId = normalizeText(checkoutPayment.stripeSessionId);
  if (!stripeSessionId) {
    throw new functions.https.HttpsError(
      "failed-precondition",
      "This quote has no server-recorded Stripe checkout session to reconcile."
    );
  }
  try {
    const stripe = getStripeClient();
    const session = await stripe.checkout.sessions.retrieve(stripeSessionId, {
      expand: ["payment_intent"]
    });
    assertStripeObjectMode({
      expectedMode: getStripeMode(),
      eventLivemode: session?.livemode,
      sessionLivemode: session?.livemode
    });
    const validated = validateStripeCheckoutScope({
      session,
      quote: stripeScopeQuoteForPayment(quote, flow.paymentKind),
      quoteId,
      organizationId
    });
    assertStripePaymentKindMetadata(session, flow.paymentKind);
    const observation = mapStripeCheckoutReconciliation(session);
    const reconciliationEventId = `reconcile:${randomUUID()}`;
    let result = {
      duplicate: false,
      applied: false,
      ignored: observation.providerState,
      eventId: reconciliationEventId
    };
    if (observation.actionable) {
      result = await patchPaymentState({
        quoteId,
        organizationId,
        portalKey: normalizeText(quote.portalKey),
        auditContext: {
          host: staff.host,
          eventType: "checkout.session.reconciled",
          organizationId,
          source: "admin_reconciliation",
          actorUid: staff.uid,
          actorEmail: staff.email
        },
        stripeSession: session,
        providerObservation: observation,
        paymentKind: flow.paymentKind,
        webhookEvent: {
          eventId: reconciliationEventId,
          eventType: "checkout.session.reconciled",
          requestHost: staff.host,
          requestIp: ""
        }
      });
    } else {
      await db.collection(WEBHOOK_EVENTS_COLLECTION).doc(`stripe-${reconciliationEventId}`).create({
        provider: "stripe",
        eventId: reconciliationEventId,
        eventType: "checkout.session.reconciled",
        source: "admin_reconciliation",
        stripeSessionId: validated.sessionId,
        livemode: session?.livemode === true,
        providerState: observation.providerState,
        paymentKind: flow.paymentKind,
        status: observation.reviewRequired ? "review_required" : "observed",
        result: observation.reviewRequired ? "ambiguous_provider_state" : "no_change",
        actorUid: staff.uid,
        actorEmail: staff.email,
        organizationId,
        quoteId,
        processedAtISO: new Date().toISOString(),
        createdAt: FieldValue.serverTimestamp()
      });
    }
    return {
      ok: true,
      organizationId,
      quoteId,
      quoteNumber,
      stripeSessionId: validated.sessionId,
      providerState: observation.providerState,
      applied: result.applied === true,
      reviewRequired: observation.reviewRequired === true,
      auditEventId: reconciliationEventId,
      ...(flow.paymentKind === "final_balance"
        ? {
          paymentKind: flow.paymentKind,
          amountCents: paymentAmountCentsForQuote(quote, flow.paymentKind)
        }
        : {})
    };
  } catch (err) {
    if (err instanceof functions.https.HttpsError) throw err;
    if (
      err instanceof PaymentSafetyError
      || err instanceof StripeProviderStateError
      || err instanceof PaymentLedgerError
    ) {
      throw new functions.https.HttpsError(err.code, err.message);
    }
    functions.logger.error(`Stripe ${flow.label} reconciliation failed`, {
      organizationId,
      quoteId,
      stripeSessionId,
      actorUid: staff.uid,
      error: normalizeText(err?.message)
    });
    throw new functions.https.HttpsError(
      "internal",
      "Failed to reconcile the Stripe checkout session."
    );
  }
}

exports.reconcileDepositCheckout = functions
  .runWith({ secrets: [STRIPE_SECRET_NAME] })
  .region(REGION)
  .https.onCall((data, context) => (
    reconcileCheckout(data, context, "deposit")
  ));

exports.reconcileFinalBalanceCheckout = functions
  .runWith({ secrets: [STRIPE_SECRET_NAME] })
  .region(REGION)
  .https.onCall((data, context) => (
    reconcileCheckout(data, context, "final_balance")
  ));

function throwBuyerAccessHttpsError(err) {
  if (err instanceof functions.https.HttpsError) throw err;
  if (err instanceof BuyerAccessError) {
    throw new functions.https.HttpsError(err.code, err.message);
  }
  throw err;
}

function getTrustedBuyerAccessRequestIp(context) {
  const trustedRequestIp = normalizeText(
    context?.rawRequest?.ip
      || context?.rawRequest?.socket?.remoteAddress
      || ""
  ).slice(0, 128);
  if (trustedRequestIp) return trustedRequestIp;
  // The callable emulator does not consistently expose its loopback socket on
  // context.rawRequest. Keep local rate limiting deterministic without adding
  // a forwarded-header trust path or weakening deployed fail-closed behavior.
  return process.env.FUNCTIONS_EMULATOR === "true" ? "127.0.0.1" : "";
}

function getBuyerAccessRateLimitSecret() {
  const secretEnv = readEnvConfig("buyer_access_rate_limit_secret");
  const rateLimitSecret = secretEnv.present ? normalizeText(secretEnv.value) : "";
  try {
    buyerAccessRateLimitDocumentId({
      rateLimitSecret,
      scope: "config_probe",
      value: "configured"
    });
  } catch (err) {
    throwBuyerAccessHttpsError(err);
  }
  return rateLimitSecret;
}

function buyerAccessRateLimitDocumentIds({
  orderId,
  ownerEmail,
  requestIp,
  rateLimitSecret
} = {}) {
  const ids = {
    ip: buyerAccessRateLimitDocumentId({
      rateLimitSecret,
      scope: "invoice_ip",
      value: normalizeText(requestIp)
    }),
    statusIp: buyerAccessRateLimitDocumentId({
      rateLimitSecret,
      scope: "status_ip",
      value: normalizeText(requestIp)
    })
  };
  if (normalizeEmail(ownerEmail)) {
    ids.email = buyerAccessRateLimitDocumentId({
      rateLimitSecret,
      scope: "invoice_email",
      value: normalizeEmail(ownerEmail)
    });
  }
  if (normalizeText(orderId)) {
    ids.reservation = buyerAccessRateLimitDocumentId({
      rateLimitSecret,
      scope: "invoice_reservation",
      value: normalizeText(orderId)
    });
  }
  return ids;
}

async function reservePublicBuyerAccessCreation({
  input,
  rateLimitSecret,
  requestIp
} = {}) {
  const identifiers = buildBuyerAccessIdentifiers({
    ownerEmail: input.ownerEmail,
    organizationName: input.organizationName,
    randomUUID,
    requestId: input.requestId
  });
  const rateIds = buyerAccessRateLimitDocumentIds({
    orderId: identifiers.orderId,
    ownerEmail: input.ownerEmail,
    requestIp,
    rateLimitSecret
  });
  const rates = db.collection(BUYER_ACCESS_RATE_LIMITS_COLLECTION);
  const reservationRef = rates.doc(rateIds.reservation);
  const ipRateRef = rates.doc(rateIds.ip);
  const emailRateRef = rates.doc(rateIds.email);
  const nowMs = Date.now();
  try {
    return await db.runTransaction(async (tx) => {
      const reservationSnap = await tx.get(reservationRef);
      const [ipRateSnap, emailRateSnap] = await Promise.all([
        tx.get(ipRateRef),
        tx.get(emailRateRef)
      ]);
      const reservation = planBuyerAccessCreationReservation({
        currentEmailRate: emailRateSnap.exists ? emailRateSnap.data() : null,
        currentIpRate: ipRateSnap.exists ? ipRateSnap.data() : null,
        currentReservation: reservationSnap.exists ? reservationSnap.data() : null,
        nowMs,
        orderId: identifiers.orderId
      });
      if (reservation.blocked) {
        throw new functions.https.HttpsError(
          "resource-exhausted",
          "Buyer access invoice creation is temporarily limited."
        );
      }
      tx.set(ipRateRef, {
        scope: "ip_hour",
        ...reservation.ipRate.patch,
        expiresAt: Timestamp.fromMillis(reservation.ipRate.expiresAtMs),
        updatedAt: FieldValue.serverTimestamp()
      }, { merge: true });
      if (reservation.reused) {
        return { identifiers, reused: true };
      }
      tx.set(emailRateRef, {
        scope: "email_day",
        ...reservation.emailRate.patch,
        expiresAt: Timestamp.fromMillis(reservation.emailRate.expiresAtMs),
        updatedAt: FieldValue.serverTimestamp()
      }, { merge: true });
      tx.set(reservationRef, {
        ...reservation.reservationPatch,
        expiresAt: Timestamp.fromDate(
          new Date(reservation.reservationPatch.expiresAtISO)
        ),
        updatedAt: FieldValue.serverTimestamp()
      }, { merge: true });
      return { identifiers, reused: false };
    });
  } catch (err) {
    if (
      err instanceof functions.https.HttpsError
      && err.code === "resource-exhausted"
    ) {
      throw err;
    }
    functions.logger.warn("Buyer access creation reservation was unavailable", {
      errorCode: normalizeText(err?.code || "rate_limit_unavailable").slice(0, 80)
    });
    throw new functions.https.HttpsError(
      "unavailable",
      "Buyer access request is temporarily unavailable."
    );
  }
}

async function consumeBuyerAccessStatusRateLimit(context) {
  const requestIp = getTrustedBuyerAccessRequestIp(context);
  if (!requestIp) {
    throw new functions.https.HttpsError(
      "permission-denied",
      "Buyer access status is unavailable."
    );
  }
  const rateLimitSecret = getBuyerAccessRateLimitSecret();
  let rateRef;
  try {
    const rateIds = buyerAccessRateLimitDocumentIds({ requestIp, rateLimitSecret });
    rateRef = db.collection(BUYER_ACCESS_RATE_LIMITS_COLLECTION).doc(rateIds.statusIp);
  } catch (err) {
    throwBuyerAccessHttpsError(err);
  }

  const nowMs = Date.now();
  try {
    await db.runTransaction(async (tx) => {
      const rateSnap = await tx.get(rateRef);
      const rate = planBuyerAccessRateLimit({
        current: rateSnap.exists ? rateSnap.data() : null,
        limit: BUYER_ACCESS_STATUS_RATE_LIMIT,
        nowMs,
        windowMs: BUYER_ACCESS_STATUS_RATE_WINDOW_MS
      });
      if (rate.blocked) {
        throw new functions.https.HttpsError(
          "resource-exhausted",
          "Buyer access status checks are temporarily limited."
        );
      }
      tx.set(rateRef, {
        scope: "status_ip_5m",
        ...rate.patch,
        expiresAt: Timestamp.fromMillis(rate.expiresAtMs),
        updatedAt: FieldValue.serverTimestamp()
      }, { merge: true });
    });
  } catch (err) {
    if (err instanceof functions.https.HttpsError) throw err;
    functions.logger.warn("Buyer access status rate limiting was unavailable", {
      errorCode: normalizeText(err?.code || "rate_limit_unavailable").slice(0, 80)
    });
    throw new functions.https.HttpsError(
      "unavailable",
      "Buyer access status is temporarily unavailable."
    );
  }
}

async function verifyBuyerAccessTurnstile({ requestIp, token } = {}) {
  const secret = readBoundSecret(BUYER_ACCESS_TURNSTILE_SECRET_NAME);
  if (!secret) {
    throw new functions.https.HttpsError(
      "failed-precondition",
      "Buyer access verification is not configured."
    );
  }
  let response;
  try {
    const body = new URLSearchParams({
      secret,
      response: token,
      ...(requestIp ? { remoteip: requestIp } : {})
    });
    response = await fetch("https://challenges.cloudflare.com/turnstile/v0/siteverify", {
      method: "POST",
      headers: { "Content-Type": "application/x-www-form-urlencoded" },
      body,
      signal: AbortSignal.timeout(5_000)
    });
  } catch (err) {
    functions.logger.warn("Buyer access verification provider was unavailable", {
      errorCode: normalizeText(err?.name || err?.code || "verification_unavailable").slice(0, 80)
    });
    throw new functions.https.HttpsError(
      "unavailable",
      "Buyer access verification is temporarily unavailable."
    );
  }
  let result = null;
  try {
    result = await response.json();
  } catch {
    result = null;
  }
  if (!response.ok || !result) {
    throw new functions.https.HttpsError(
      "unavailable",
      "Buyer access verification is temporarily unavailable."
    );
  }
  try {
    return assertBuyerAccessTurnstileResult({
      allowedHostnames: normalizeBuyerAccessTurnstileHostnames(
        readConfig("buyer_access_turnstile_hostnames")
      ),
      allowOfficialLocalTestResult:
        secret === CLOUDFLARE_TURNSTILE_ALWAYS_PASS_TEST_SECRET,
      result
    });
  } catch (err) {
    throwBuyerAccessHttpsError(err);
  }
}

function assertBuyerAccessOrderRequest(order = {}, input = {}) {
  if (
    normalizeText(order.orderId) !== buyerAccessOrderIdForRequest({
      ownerEmail: input.ownerEmail,
      requestId: input.requestId
    })
    || normalizeEmail(order.ownerEmail) !== normalizeEmail(input.ownerEmail)
    || normalizeText(order.organizationName) !== normalizeText(input.organizationName)
    || normalizeText(order.ownerName) !== normalizeText(input.ownerName)
    || normalizeText(order.flow) !== BUYER_ACCESS_FLOW
    || normalizeText(order.buyerAccessMode) !== BUYER_ACCESS_MODE
    || !buyerAccessStatusTokenMatches({
      expectedHash: order.statusTokenHash,
      statusToken: input.requestId
    })
  ) {
    throw new functions.https.HttpsError(
      "permission-denied",
      "Buyer access request cannot be completed."
    );
  }
}

async function assertPublicBuyerIdentityAvailable(ownerEmail) {
  const email = normalizeEmail(ownerEmail);
  if (isPlatformAdminEmail(email)) {
    throw new functions.https.HttpsError(
      "permission-denied",
      "Buyer access request cannot be completed."
    );
  }
  const existingUser = await findAuthUserByEmail(email);
  const inviteRef = db.collection(INVITES_COLLECTION).doc(inviteDocIdFromEmail(email));
  const [inviteSnap, roleSnap] = await Promise.all([
    inviteRef.get(),
    existingUser
      ? db.collection(ROLES_COLLECTION).doc(existingUser.uid).get()
      : Promise.resolve(null)
  ]);
  const role = roleSnap?.data() || {};
  const claimsRole = normalizeText(existingUser?.customClaims?.role).toLowerCase();
  const roleName = normalizeText(role.role).toLowerCase();
  if (
    existingUser?.disabled === true
    || normalizeOrganizationId(existingUser?.customClaims?.organizationId)
    || (claimsRole && claimsRole !== "customer")
    || normalizeOrganizationId(role.organizationId)
    || (roleSnap?.exists && roleName && roleName !== "customer")
    || inviteSnap.exists
  ) {
    throw new functions.https.HttpsError(
      "permission-denied",
      "Buyer access request cannot be completed."
    );
  }
  return { existingUser, inviteRef };
}

async function preparePublicBuyerAccessOrder({
  identifiers,
  input,
  turnstileAudit
} = {}) {
  if (
    !identifiers
    || normalizeText(identifiers.orderId) !== buyerAccessOrderIdForRequest({
      ownerEmail: input.ownerEmail,
      requestId: input.requestId
    })
  ) {
    throw new functions.https.HttpsError(
      "permission-denied",
      "Buyer access request cannot be completed."
    );
  }
  const orderRef = db.collection(BUYER_ACCESS_ORDERS_COLLECTION).doc(identifiers.orderId);
  const statusTokenHash = hashBuyerAccessSecret(input.requestId);
  const nowMs = Date.now();
  const nowISO = new Date(nowMs).toISOString();
  return db.runTransaction(async (tx) => {
    const orderSnap = await tx.get(orderRef);
    if (orderSnap.exists) {
      const existing = orderSnap.data() || {};
      assertBuyerAccessOrderRequest(existing, input);
      return { ...existing, orderRef };
    }
    const priorOrdersSnap = await tx.get(
      db.collection(BUYER_ACCESS_ORDERS_COLLECTION)
        .where("ownerEmail", "==", normalizeEmail(input.ownerEmail))
    );
    const priorOrders = priorOrdersSnap.docs.filter(
      (docSnap) => docSnap.id !== identifiers.orderId
    );
    if (priorOrders.some(
      (docSnap) => !hasBuyerAccessReissuableVoidEvidence(docSnap.data() || {})
    )) {
      throw new functions.https.HttpsError(
        "permission-denied",
        "Buyer access request cannot be completed."
      );
    }
    for (const priorOrderSnap of priorOrders) {
      tx.set(priorOrderSnap.ref, {
        supersededByOrderId: identifiers.orderId,
        supersededAtISO: nowISO,
        updatedAtISO: nowISO,
        updatedAt: FieldValue.serverTimestamp()
      }, { merge: true });
    }
    const order = {
      orderId: identifiers.orderId,
      flow: BUYER_ACCESS_FLOW,
      buyerAccessMode: BUYER_ACCESS_MODE,
      status: "invoice_preparing",
      providerStep: "reserved",
      invoiceGeneration: 1,
      stripeCustomerId: "",
      stripeInvoiceId: "",
      stripeInvoiceItemId: "",
      hostedInvoiceUrl: "",
      organizationId: identifiers.organizationId,
      organizationName: input.organizationName,
      ownerUid: "",
      ownerEmail: input.ownerEmail,
      ownerName: input.ownerName,
      plan: BUYER_ACCESS_PLAN,
      amountCents: BUYER_ACCESS_AMOUNT_CENTS,
      currency: BUYER_ACCESS_CURRENCY,
      statusTokenHash,
      accessGranted: false,
      workspaceReady: false,
      activationEmailSent: false,
      signedVoidObserved: false,
      turnstile: {
        success: true,
        action: turnstileAudit.action,
        hostname: turnstileAudit.hostname,
        challengeTimestamp: turnstileAudit.challengeTimestamp,
        verifiedAtISO: nowISO
      },
      createdAtISO: nowISO,
      updatedAtISO: nowISO,
      createdAt: FieldValue.serverTimestamp(),
      updatedAt: FieldValue.serverTimestamp()
    };
    tx.create(orderRef, order);
    return { ...order, orderRef };
  });
}

async function persistBuyerAccessProviderStep({ input, order, patch } = {}) {
  return db.runTransaction(async (tx) => {
    const orderSnap = await tx.get(order.orderRef);
    if (!orderSnap.exists) {
      throw new functions.https.HttpsError("not-found", "Buyer access order not found.");
    }
    const current = orderSnap.data() || {};
    assertBuyerAccessOrderRequest(current, input);
    const idFields = ["stripeCustomerId", "stripeInvoiceId", "stripeInvoiceItemId"];
    for (const field of idFields) {
      if (
        normalizeText(current[field])
        && normalizeText(patch?.[field])
        && normalizeText(current[field]) !== normalizeText(patch[field])
      ) {
        throw new functions.https.HttpsError(
          "aborted",
          "Buyer access provider identity changed during creation."
        );
      }
    }
    const nowISO = new Date().toISOString();
    tx.set(order.orderRef, {
      ...patch,
      updatedAtISO: nowISO,
      updatedAt: FieldValue.serverTimestamp()
    }, { merge: true });
    return { ...current, ...patch, orderRef: order.orderRef };
  });
}

function assertBuyerAccessStripeCustomer(customer, order) {
  const id = normalizeText(customer?.id);
  if (
    !/^cus_[A-Za-z0-9]+$/.test(id)
    || customer?.livemode !== false
    || normalizeEmail(customer?.email) !== normalizeEmail(order.ownerEmail)
    || normalizeText(customer?.metadata?.flow) !== BUYER_ACCESS_FLOW
    || normalizeText(customer?.metadata?.buyerAccessOrderId) !== normalizeText(order.orderId)
  ) {
    throw new functions.https.HttpsError(
      "failed-precondition",
      "Stripe returned an invalid buyer access customer."
    );
  }
  return id;
}

async function createOrResumeBuyerAccessInvoice({ input, order } = {}) {
  const stripe = getBuyerAccessStripeClient();
  const plan = buildBuyerAccessStripePlan({
    generation: order.invoiceGeneration,
    orderId: order.orderId,
    organizationName: order.organizationName,
    ownerEmail: order.ownerEmail,
    ownerName: order.ownerName
  });

  if (!normalizeText(order.stripeCustomerId)) {
    let customer;
    try {
      customer = await stripe.customers.create(plan.customer.params, {
        idempotencyKey: plan.customer.idempotencyKey
      });
    } catch (err) {
      functions.logger.error("Buyer access Stripe Customer creation failed", {
        orderId: order.orderId,
        providerStep: "customer",
        errorCode: normalizeText(err?.code || err?.type || "creation_failed").slice(0, 80)
      });
      throw new functions.https.HttpsError("unavailable", "Stripe could not prepare the invoice.");
    }
    const stripeCustomerId = assertBuyerAccessStripeCustomer(customer, order);
    order = await persistBuyerAccessProviderStep({
      input,
      order,
      patch: { stripeCustomerId, providerStep: "customer_created" }
    });
  }

  if (!normalizeText(order.stripeInvoiceId)) {
    let invoice;
    try {
      invoice = await stripe.invoices.create({
        ...plan.invoice.params,
        customer: order.stripeCustomerId
      }, { idempotencyKey: plan.invoice.idempotencyKey });
    } catch (err) {
      functions.logger.error("Buyer access Stripe Invoice creation failed", {
        orderId: order.orderId,
        providerStep: "invoice",
        errorCode: normalizeText(err?.code || err?.type || "creation_failed").slice(0, 80)
      });
      throw new functions.https.HttpsError("unavailable", "Stripe could not prepare the invoice.");
    }
    if (
      !/^in_[A-Za-z0-9]+$/.test(normalizeText(invoice?.id))
      || invoice?.livemode !== false
      || normalizeText(invoice?.status).toLowerCase() !== "draft"
      || normalizeText(invoice?.customer) !== order.stripeCustomerId
      || normalizeText(invoice?.metadata?.buyerAccessOrderId) !== order.orderId
    ) {
      throw new functions.https.HttpsError(
        "failed-precondition",
        "Stripe returned an invalid buyer access Invoice."
      );
    }
    order = await persistBuyerAccessProviderStep({
      input,
      order,
      patch: { stripeInvoiceId: invoice.id, providerStep: "invoice_created" }
    });
  }

  if (!normalizeText(order.stripeInvoiceItemId)) {
    let invoiceItem;
    try {
      invoiceItem = await stripe.invoiceItems.create({
        ...plan.invoiceItem.params,
        customer: order.stripeCustomerId,
        invoice: order.stripeInvoiceId
      }, { idempotencyKey: plan.invoiceItem.idempotencyKey });
    } catch (err) {
      functions.logger.error("Buyer access Stripe Invoice Item creation failed", {
        orderId: order.orderId,
        providerStep: "invoice_item",
        errorCode: normalizeText(err?.code || err?.type || "creation_failed").slice(0, 80)
      });
      throw new functions.https.HttpsError("unavailable", "Stripe could not prepare the invoice.");
    }
    if (
      !/^ii_[A-Za-z0-9]+$/.test(normalizeText(invoiceItem?.id))
      || invoiceItem?.livemode !== false
      || normalizeText(invoiceItem?.invoice) !== order.stripeInvoiceId
      || normalizeText(invoiceItem?.customer) !== order.stripeCustomerId
      || Number(invoiceItem?.amount) !== BUYER_ACCESS_AMOUNT_CENTS
      || normalizeText(invoiceItem?.currency).toLowerCase() !== BUYER_ACCESS_CURRENCY
    ) {
      throw new functions.https.HttpsError(
        "failed-precondition",
        "Stripe returned an invalid buyer access Invoice Item."
      );
    }
    order = await persistBuyerAccessProviderStep({
      input,
      order,
      patch: { stripeInvoiceItemId: invoiceItem.id, providerStep: "invoice_item_created" }
    });
  }

  let invoice;
  try {
    invoice = await stripe.invoices.finalizeInvoice(
      order.stripeInvoiceId,
      plan.finalize.params,
      { idempotencyKey: plan.finalize.idempotencyKey }
    );
    const finalizedBinding = assertBuyerAccessInvoiceBinding({
      order,
      invoice,
      providerState: "open",
      stripeMode: "test"
    });
    order = await persistBuyerAccessProviderStep({
      input,
      order,
      patch: {
        hostedInvoiceUrl: finalizedBinding.hostedInvoiceUrl,
        providerStep: "invoice_finalized"
      }
    });
    invoice = await stripe.invoices.sendInvoice(
      order.stripeInvoiceId,
      plan.send.params,
      { idempotencyKey: plan.send.idempotencyKey }
    );
  } catch (err) {
    if (err instanceof BuyerAccessError || err instanceof functions.https.HttpsError) {
      throwBuyerAccessHttpsError(err);
    }
    functions.logger.error("Buyer access Stripe Invoice finalization or send failed", {
      orderId: order.orderId,
      providerStep: "finalize_or_send",
      errorCode: normalizeText(err?.code || err?.type || "provider_failed").slice(0, 80)
    });
    throw new functions.https.HttpsError(
      "unavailable",
      "Stripe could not finalize the invoice. Retry safely."
    );
  }
  const sentBinding = assertBuyerAccessInvoiceBinding({
    order,
    invoice,
    providerState: "open",
    stripeMode: "test"
  });
  return persistBuyerAccessProviderStep({
    input,
    order,
    patch: {
      status: "invoice_open",
      providerStep: "invoice_sent",
      hostedInvoiceUrl: sentBinding.hostedInvoiceUrl,
      invoiceSentAtISO: new Date().toISOString(),
      lastProviderState: "open"
    }
  });
}

function assertBuyerAccessRepairOrder(order = {}, orderId = "") {
  const normalizedOrderId = normalizeText(orderId).toLowerCase();
  const status = normalizeText(order.status).toLowerCase();
  if (
    normalizeText(order.orderId).toLowerCase() !== normalizedOrderId
    || !["invoice_open", "payment_processing", "payment_failed", "expired", "void"]
      .includes(status)
    || normalizeText(order.supersededByOrderId)
    || order.accessGranted === true
    || order.workspaceReady === true
    || order.activationEmailSent === true
    || normalizeText(order.ownerUid)
  ) {
    throw new functions.https.HttpsError(
      "failed-precondition",
      "Buyer access repair requires one unfulfilled order with a server-recorded Invoice."
    );
  }
  return order;
}

function buyerAccessRepairArtifactRefs(order = {}) {
  const organizationId = normalizeOrganizationId(order.organizationId);
  const ownerEmail = normalizeEmail(order.ownerEmail);
  if (!organizationId || !isValidEmail(ownerEmail)) {
    throw new functions.https.HttpsError(
      "failed-precondition",
      "Buyer access repair target identity is invalid."
    );
  }
  const organizationRef = db.collection(ORGANIZATIONS_COLLECTION).doc(organizationId);
  return {
    inviteRef: db.collection(INVITES_COLLECTION).doc(inviteDocIdFromEmail(ownerEmail)),
    organizationRef,
    provisioningOrderRef: db.collection(PROVISIONING_ORDERS_COLLECTION).doc(order.orderId),
    settingsRef: organizationRef.collection("settings").doc("config")
  };
}

async function assertBuyerAccessRepairArtifactsAbsent(order = {}) {
  const refs = buyerAccessRepairArtifactRefs(order);
  const snapshots = await Promise.all(Object.values(refs).map((ref) => ref.get()));
  if (snapshots.some((snapshot) => snapshot.exists)) {
    throw new functions.https.HttpsError(
      "failed-precondition",
      "Buyer access repair is blocked because fulfillment artifacts already exist."
    );
  }
  return refs;
}

exports.repairBuyerAccessInvoice = functions
  .runWith({ secrets: [BUYER_ACCESS_STRIPE_SECRET_NAME] })
  .region(REGION)
  .https.onCall(async (data, context) => {
    const staff = await assertStaff(context);
    if (staff.role !== "admin" || !staff.platformAdmin) {
      throw new functions.https.HttpsError(
        "permission-denied",
        "Platform administrator authority is required for buyer invoice repair."
      );
    }

    let input;
    try {
      input = normalizeBuyerAccessRepairRequest(data);
    } catch (err) {
      throwBuyerAccessHttpsError(err);
    }
    const orderRef = db.collection(BUYER_ACCESS_ORDERS_COLLECTION).doc(input.orderId);
    const orderSnap = await orderRef.get();
    if (!orderSnap.exists) {
      throw new functions.https.HttpsError("not-found", "Buyer access order not found.");
    }
    let order = assertBuyerAccessRepairOrder(orderSnap.data() || {}, input.orderId);
    await assertPublicBuyerIdentityAvailable(order.ownerEmail);
    let artifactRefs = await assertBuyerAccessRepairArtifactsAbsent(order);

    const stripe = getBuyerAccessStripeClient();
    let invoice;
    try {
      invoice = await stripe.invoices.retrieve(normalizeText(order.stripeInvoiceId));
    } catch (err) {
      functions.logger.error("Buyer access repair Invoice retrieval failed", {
        orderId: input.orderId,
        errorCode: normalizeText(err?.code || err?.type || "provider_unavailable").slice(0, 80)
      });
      throw new functions.https.HttpsError(
        "unavailable",
        "Stripe could not verify the buyer access Invoice."
      );
    }

    let providerState = buyerAccessProviderStateForInvoice(invoice);
    if (!["expired", "void"].includes(providerState)) {
      throw new functions.https.HttpsError(
        "failed-precondition",
        providerState === "paid"
          ? "Stripe reports this buyer access Invoice as paid; void repair is forbidden."
          : "Stripe does not report a terminal unpaid Invoice that can be repaired."
      );
    }
    try {
      assertBuyerAccessInvoiceBinding({
        invoice,
        order,
        providerState,
        stripeMode: "test"
      });
    } catch (err) {
      throwBuyerAccessHttpsError(err);
    }

    const providerMutation = providerState === "expired";
    if (providerMutation) {
      try {
        invoice = await stripe.invoices.voidInvoice(
          normalizeText(order.stripeInvoiceId),
          {},
          {
            idempotencyKey: buyerAccessStripeIdempotencyKey({
              generation: order.invoiceGeneration,
              orderId: input.orderId,
              step: "operator_void"
            })
          }
        );
        providerState = buyerAccessProviderStateForInvoice(invoice);
        assertBuyerAccessInvoiceBinding({
          invoice,
          order,
          providerState,
          stripeMode: "test"
        });
      } catch (err) {
        if (err instanceof BuyerAccessError || err instanceof functions.https.HttpsError) {
          throwBuyerAccessHttpsError(err);
        }
        functions.logger.error("Buyer access repair Invoice void failed", {
          orderId: input.orderId,
          errorCode: normalizeText(err?.code || err?.type || "provider_unavailable").slice(0, 80)
        });
        throw new functions.https.HttpsError(
          "unavailable",
          "Stripe could not void the terminal buyer access Invoice."
        );
      }
      if (providerState !== "void") {
        throw new functions.https.HttpsError(
          "failed-precondition",
          "Stripe did not return a void buyer access Invoice."
        );
      }
    }

    const auditEventId = `stripe-buyer-repair-${randomUUID()}`;
    const auditRef = db.collection(WEBHOOK_EVENTS_COLLECTION).doc(auditEventId);
    const nowISO = new Date().toISOString();
    await db.runTransaction(async (tx) => {
      const latestOrderSnap = await tx.get(orderRef);
      if (!latestOrderSnap.exists) {
        throw new functions.https.HttpsError(
          "failed-precondition",
          "Buyer access order disappeared during repair."
        );
      }
      const latestOrder = assertBuyerAccessRepairOrder(
        latestOrderSnap.data() || {},
        input.orderId
      );
      if (
        normalizeText(latestOrder.stripeInvoiceId) !== normalizeText(order.stripeInvoiceId)
        || normalizeText(latestOrder.stripeCustomerId) !== normalizeText(order.stripeCustomerId)
        || Number(latestOrder.invoiceGeneration) !== Number(order.invoiceGeneration)
      ) {
        throw new functions.https.HttpsError(
          "aborted",
          "Buyer access provider identity changed during repair."
        );
      }
      artifactRefs = buyerAccessRepairArtifactRefs(latestOrder);
      const artifactSnapshots = await Promise.all(
        Object.values(artifactRefs).map((ref) => tx.get(ref))
      );
      if (artifactSnapshots.some((snapshot) => snapshot.exists)) {
        throw new functions.https.HttpsError(
          "failed-precondition",
          "Buyer access repair is blocked because fulfillment artifacts now exist."
        );
      }
      assertBuyerAccessInvoiceBinding({
        invoice,
        order: latestOrder,
        providerState: "void",
        stripeMode: "test"
      });
      tx.create(auditRef, {
        provider: "stripe",
        flow: BUYER_ACCESS_FLOW,
        buyerAccessMode: BUYER_ACCESS_MODE,
        source: "admin_reconciliation",
        eventId: auditEventId,
        eventType: "invoice.voided.operator_repair",
        status: "processed",
        result: providerMutation ? "uncollectible_invoice_voided" : "void_invoice_reconciled",
        livemode: false,
        buyerAccessOrderId: input.orderId,
        stripeInvoiceId: normalizeText(invoice.id),
        stripeCustomerId: normalizeText(invoice.customer),
        invoiceGeneration: Number(latestOrder.invoiceGeneration),
        providerState: "void",
        actorUid: staff.uid,
        actorEmail: staff.email,
        requestHost: staff.host,
        processedAtISO: nowISO,
        createdAt: FieldValue.serverTimestamp()
      });
      tx.set(orderRef, {
        status: "void",
        accessGranted: false,
        workspaceReady: false,
        activationEmailSent: false,
        signedVoidObserved: latestOrder.signedVoidObserved === true,
        operatorVoidObserved: true,
        operatorVoidAuditEventId: auditEventId,
        lastProviderState: "void",
        lastProviderObservationSource: "admin_reconciliation",
        hostedInvoiceUrl: "",
        repairedAtISO: nowISO,
        repairedBy: {
          uid: staff.uid,
          email: staff.email
        },
        updatedAtISO: nowISO,
        updatedAt: FieldValue.serverTimestamp()
      }, { merge: true });
    });

    return {
      ok: true,
      orderId: input.orderId,
      status: "void",
      providerState: "void",
      providerVoidVerified: true,
      emailWindowStillApplies: true,
      providerMutation: providerMutation ? "voided" : "already_void",
      auditEventId
    };
  });

exports.createBuyerAccessInvoice = functions
  .runWith({
    secrets: [
      BUYER_ACCESS_STRIPE_SECRET_NAME,
      BUYER_ACCESS_TURNSTILE_SECRET_NAME,
      BUYER_ACCESS_RATE_LIMIT_SECRET_NAME
    ]
  })
  .region(REGION)
  .https.onCall(async (data, context) => {
    assertBuyerAccessRuntimeEnabled();
    let input;
    try {
      input = normalizeBuyerAccessRequest(data);
    } catch (err) {
      throwBuyerAccessHttpsError(err);
    }
    const requestIp = getTrustedBuyerAccessRequestIp(context);
    if (!requestIp) {
      throw new functions.https.HttpsError(
        "permission-denied",
        "Buyer access request cannot be completed."
      );
    }
    const rateLimitSecret = getBuyerAccessRateLimitSecret();
    const turnstileAudit = await verifyBuyerAccessTurnstile({
      requestIp,
      token: input.turnstileToken
    });
    const reservation = await reservePublicBuyerAccessCreation({
      input,
      rateLimitSecret,
      requestIp
    });
    await assertPublicBuyerIdentityAvailable(input.ownerEmail);
    let order = await preparePublicBuyerAccessOrder({
      identifiers: reservation.identifiers,
      input,
      turnstileAudit
    });

    const currentStatus = normalizeText(order.status).toLowerCase();
    if (["invoice_open", "payment_failed"].includes(currentStatus)) {
      return {
        orderId: order.orderId,
        statusToken: input.requestId,
        hostedInvoiceUrl: buyerAccessStatusResponse(order).hostedInvoiceUrl,
        status: currentStatus
      };
    }
    if (currentStatus !== "invoice_preparing") {
      throw new functions.https.HttpsError(
        "permission-denied",
        "Buyer access request cannot be completed."
      );
    }
    order = await createOrResumeBuyerAccessInvoice({ input, order });
    return {
      orderId: order.orderId,
      statusToken: input.requestId,
      hostedInvoiceUrl: buyerAccessStatusResponse(order).hostedInvoiceUrl,
      status: "invoice_open"
    };
  });

exports.getBuyerAccessInvoiceStatus = functions
  .runWith({
    secrets: [
      BUYER_ACCESS_RATE_LIMIT_SECRET_NAME,
      RESEND_API_KEY_SECRET_NAME
    ]
  })
  .region(REGION)
  .https.onCall(async (data, context) => {
    assertBuyerAccessRuntimeEnabled();
    let input;
    try {
      input = normalizeBuyerAccessStatusRequest(data);
    } catch (err) {
      throwBuyerAccessHttpsError(err);
    }
    let order;
    try {
      order = await authorizeBuyerAccessStatusRequest({
        input,
        consumeRateLimit: () => consumeBuyerAccessStatusRateLimit(context),
        readOrder: async (orderId) => {
          const orderSnap = await db.collection(BUYER_ACCESS_ORDERS_COLLECTION)
            .doc(orderId)
            .get();
          return orderSnap.exists ? (orderSnap.data() || {}) : null;
        }
      });
    } catch (err) {
      throwBuyerAccessHttpsError(err);
    }
    if (
      normalizeText(order.status).toLowerCase() === "activation_pending"
      && order.workspaceReady === true
    ) {
      try {
        await finalizeBuyerAccessActivation({ orderId: input.orderId });
        const refreshedOrderSnap = await db.collection(BUYER_ACCESS_ORDERS_COLLECTION)
          .doc(input.orderId)
          .get();
        if (refreshedOrderSnap.exists) {
          order = refreshedOrderSnap.data() || order;
        }
      } catch (err) {
        functions.logger.warn("Buyer access activation retry remains pending", {
          orderId: input.orderId,
          errorCode: normalizeText(err?.code || "activation_pending").slice(0, 80)
        });
      }
    }
    return buyerAccessStatusResponse(order);
  });

exports.createDepositCheckout = functions.region(REGION).https.onCall(async (data, context) => {
  assertAdminStaff(await assertStaff(context));
  if (normalizeText(data?.successUrl) || normalizeText(data?.cancelUrl)) {
    throw new functions.https.HttpsError(
      "invalid-argument",
      "Checkout return URLs are server-derived and must not be supplied."
    );
  }
  throw new functions.https.HttpsError(
    "failed-precondition",
    "Direct checkout creation is disabled. Approve and send the payment request as one operation."
  );
});

function isBuyerAccessStripeObject(value = {}) {
  return normalizeText(value?.metadata?.flow).toLowerCase() === BUYER_ACCESS_FLOW;
}

function buyerAccessWebhookAudit({
  binding = {},
  event,
  eventId,
  invoice = {},
  order = {},
  providerState = "",
  requestHost = "",
  result = "processed",
  status = "processed"
} = {}) {
  return {
    provider: "stripe",
    source: "stripe_webhook",
    flow: BUYER_ACCESS_FLOW,
    buyerAccessMode: BUYER_ACCESS_MODE,
    eventId,
    eventType: normalizeText(event?.type),
    requestHost,
    buyerAccessOrderId: normalizeText(
      order.orderId || invoice?.metadata?.buyerAccessOrderId
    ),
    organizationId: normalizeOrganizationId(order.organizationId),
    stripeCustomerId: normalizeText(
      typeof invoice?.customer === "string" ? invoice.customer : invoice?.customer?.id
    ),
    stripeInvoiceId: normalizeText(invoice?.id),
    stripePaymentIntentId: normalizeText(binding.paymentIntentId),
    livemode: invoice?.livemode === true,
    providerState: normalizeText(providerState),
    status,
    result,
    providerEventCreatedAtISO: Number.isFinite(Number(event?.created))
      ? new Date(Number(event.created) * 1000).toISOString()
      : "",
    processedAtISO: new Date().toISOString(),
    createdAt: FieldValue.serverTimestamp()
  };
}

async function recordIgnoredBuyerAccessWebhook({
  binding,
  dedupeRef,
  event,
  eventId,
  invoice,
  order,
  providerState,
  requestHost,
  result
} = {}) {
  return db.runTransaction(async (tx) => {
    const dedupeSnap = await tx.get(dedupeRef);
    if (dedupeSnap.exists) {
      return { duplicate: true, orderId: normalizeText(order?.orderId) };
    }
    tx.create(dedupeRef, buyerAccessWebhookAudit({
      binding,
      event,
      eventId,
      invoice,
      order,
      providerState,
      requestHost,
      result,
      status: "ignored"
    }));
    return {
      duplicate: false,
      ignored: result,
      orderId: normalizeText(order?.orderId)
    };
  });
}

function assertBuyerAccessProvisioningRecord(data = {}, {
  kind,
  orderId,
  organizationId,
  ownerEmail
} = {}) {
  const recordOrderId = normalizeText(data.orderId || data.buyerAccessOrderId);
  const recordOrganizationId = normalizeOrganizationId(
    data.organizationId || data.onboarding?.organizationId
  );
  const recordOwnerEmail = normalizeEmail(
    data.ownerEmail || data.onboarding?.ownerEmail
  );
  if (
    recordOrderId !== orderId
    || recordOrganizationId !== organizationId
    || recordOwnerEmail !== ownerEmail
    || normalizeText(data.buyerAccessMode) !== BUYER_ACCESS_MODE
  ) {
    throw new functions.https.HttpsError(
      "failed-precondition",
      "Existing " + kind + " record conflicts with the paid buyer access order."
    );
  }
}

function getBuyerAccessApplicationUrl() {
  const appUrl = parseUrlOrThrow(
    readConfig("buyer_access_app_base_url"),
    "buyer_access_app_base_url"
  );
  const parsed = new URL(appUrl);
  const isLoopbackEmulatorUrl = (
    process.env.FUNCTIONS_EMULATOR === "true"
    && parsed.protocol === "http:"
    && ["localhost", "127.0.0.1"].includes(parsed.hostname)
    && (parsed.pathname.replace(/\/+$/, "") || "/") === "/app"
    && !parsed.search
  );
  if (
    (parsed.protocol !== "https:" && !isLoopbackEmulatorUrl)
    || parsed.username
    || parsed.password
    || parsed.hash
  ) {
    throw new functions.https.HttpsError(
      "failed-precondition",
      "Buyer access application URL is invalid."
    );
  }
  return parsed.toString();
}

async function finalizeBuyerAccessActivation({ orderId } = {}) {
  const orderRef = db.collection(BUYER_ACCESS_ORDERS_COLLECTION).doc(orderId);
  const provisioningOrderRef = db.collection(PROVISIONING_ORDERS_COLLECTION).doc(orderId);
  const [orderSnap, provisioningOrderSnap] = await Promise.all([
    orderRef.get(),
    provisioningOrderRef.get()
  ]);
  if (!orderSnap.exists || !provisioningOrderSnap.exists) {
    throw new functions.https.HttpsError(
      "failed-precondition",
      "Buyer access fulfillment record is incomplete."
    );
  }
  const order = orderSnap.data() || {};
  const provisioningOrder = provisioningOrderSnap.data() || {};
  const currentStatus = normalizeText(order.status).toLowerCase();
  if (currentStatus === "active" || currentStatus === "activation_sent") {
    return {
      activationEmailSent: order.activationEmailSent === true,
      orderId,
      status: currentStatus
    };
  }
  if (currentStatus !== "activation_pending" || order.workspaceReady !== true) {
    return {
      activationEmailSent: false,
      orderId,
      status: currentStatus
    };
  }
  if (
    normalizeText(order.flow) !== BUYER_ACCESS_FLOW
    || normalizeText(order.buyerAccessMode) !== BUYER_ACCESS_MODE
    || normalizeText(order.plan).toLowerCase() !== BUYER_ACCESS_PLAN
    || Number(order.amountCents) !== BUYER_ACCESS_AMOUNT_CENTS
    || normalizeText(order.currency).toLowerCase() !== BUYER_ACCESS_CURRENCY
    || normalizeText(order.ownerUid)
  ) {
    throw new functions.https.HttpsError(
      "failed-precondition",
      "Buyer access activation scope is invalid."
    );
  }

  const organizationId = normalizeOrganizationId(order.organizationId);
  const ownerEmail = normalizeEmail(order.ownerEmail);
  assertBuyerAccessProvisioningRecord(provisioningOrder, {
    kind: "provisioning order",
    orderId,
    organizationId,
    ownerEmail
  });
  if (
    normalizeText(provisioningOrder.stripeInvoiceId) !== normalizeText(order.stripeInvoiceId)
    || normalizeText(provisioningOrder.stripePaymentIntentId)
      !== normalizeText(order.stripePaymentIntentId)
  ) {
    throw new functions.https.HttpsError(
      "failed-precondition",
      "Buyer access activation payment evidence is inconsistent."
    );
  }
  const priorEmail = provisioningOrder.email || {};
  const priorFailedAtMs = Date.parse(normalizeText(priorEmail.failedAtISO));
  if (
    normalizeText(priorEmail.dispatchState).toLowerCase() === "failed"
    && Number.isFinite(priorFailedAtMs)
    && Date.now() - priorFailedAtMs < 5 * 60 * 1000
  ) {
    return {
      activationEmailSent: false,
      orderId,
      status: "activation_pending"
    };
  }
  const entitlements = resolveFeatureEntitlements({ plan: BUYER_ACCESS_PLAN });
  const finalized = await finalizeProvisioningOrder({
    orderRef: provisioningOrderRef,
    orderId,
    organizationId,
    organizationName: normalizeText(order.organizationName),
    ownerEmail,
    ownerName: normalizeText(order.ownerName),
    ownerUid: "",
    appUrl: parseUrlOrThrow(provisioningOrder.appUrl, "buyer access appUrl"),
    supportEmail: normalizeEmail(provisioningOrder.supportEmail),
    entitlements,
    sendEmail: true,
    existingEmail: priorEmail,
    requiresVerifiedSignIn: true
  });
  const activationEmailSent = finalized.emailResult?.sent === true
    && finalized.emailResult?.auditPersisted === true;
  const nextStatus = activationEmailSent ? "activation_sent" : "activation_pending";
  const failedAtMs = Date.parse(normalizeText(finalized.emailResult?.failedAtISO));
  const activationEmailRetryAfterISO = Number.isFinite(failedAtMs)
    ? new Date(failedAtMs + 5 * 60 * 1000).toISOString()
    : "";
  const nowISO = new Date().toISOString();
  await db.runTransaction(async (tx) => {
    const latestOrderSnap = await tx.get(orderRef);
    if (!latestOrderSnap.exists) {
      throw new functions.https.HttpsError(
        "failed-precondition",
        "Buyer access order disappeared during activation finalization."
      );
    }
    const latest = latestOrderSnap.data() || {};
    if (normalizeText(latest.status).toLowerCase() === "active") return;
    if (!["activation_pending", "activation_sent"].includes(
      normalizeText(latest.status).toLowerCase()
    )) {
      throw new functions.https.HttpsError(
        "aborted",
        "Buyer access fulfillment state changed during activation finalization."
      );
    }
    tx.set(orderRef, {
      status: nextStatus,
      workspaceReady: true,
      accessGranted: false,
      activationEmailSent,
      activationEmailDispatchState: normalizeText(
        finalized.emailResult?.dispatchState
      ).slice(0, 40),
      activationEmailReason: normalizeText(
        finalized.emailResult?.reason
      ).slice(0, 80),
      ...(!activationEmailSent && activationEmailRetryAfterISO
        ? { activationEmailRetryAfterISO }
        : {}),
      ...(activationEmailSent ? { activationEmailSentAtISO: nowISO } : {}),
      updatedAtISO: nowISO,
      updatedAt: FieldValue.serverTimestamp()
    }, { merge: true });
  });
  return { activationEmailSent, orderId, status: nextStatus };
}

async function processBuyerAccessInvoiceWebhook({
  dedupeRef,
  event,
  eventId,
  invoice,
  providerState,
  requestHost
} = {}) {
  assertBuyerAccessRuntimeEnabled();
  const orderId = normalizeText(invoice?.metadata?.buyerAccessOrderId);
  if (!/^ba-[a-f0-9]{40}$/.test(orderId)) {
    return recordIgnoredBuyerAccessWebhook({
      dedupeRef,
      event,
      eventId,
      invoice,
      providerState,
      requestHost,
      result: "invalid_order_identity"
    });
  }
  const orderRef = db.collection(BUYER_ACCESS_ORDERS_COLLECTION).doc(orderId);
  const initialOrderSnap = await orderRef.get();
  if (!initialOrderSnap.exists) {
    return recordIgnoredBuyerAccessWebhook({
      dedupeRef,
      event,
      eventId,
      invoice,
      providerState,
      requestHost,
      result: "order_not_found"
    });
  }
  const initialOrder = initialOrderSnap.data() || {};
  try {
    assertBuyerAccessInvoiceBinding({
      eventLivemode: event?.livemode,
      invoice,
      order: initialOrder,
      providerState,
      stripeMode: "test"
    });
  } catch (err) {
    functions.logger.warn("Stripe buyer access Invoice binding was rejected", {
      eventId,
      orderId,
      errorCode: normalizeText(err?.code || "binding_failed").slice(0, 80)
    });
    return recordIgnoredBuyerAccessWebhook({
      dedupeRef,
      event,
      eventId,
      invoice,
      order: initialOrder,
      providerState,
      requestHost,
      result: "invalid_buyer_access_scope"
    });
  }

  if (normalizeText(initialOrder.supersededByOrderId)) {
    return recordIgnoredBuyerAccessWebhook({
      dedupeRef,
      event,
      eventId,
      invoice,
      order: initialOrder,
      providerState,
      requestHost,
      result: "superseded_order"
    });
  }

  const currentStatus = normalizeText(initialOrder.status).toLowerCase();
  const alreadyProvisioned = ["activation_pending", "activation_sent", "active"]
    .includes(currentStatus);
  const buyerIdentity = providerState === "paid" && !alreadyProvisioned
    ? await assertPublicBuyerIdentityAvailable(initialOrder.ownerEmail)
    : null;

  const organizationId = normalizeOrganizationId(initialOrder.organizationId);
  const ownerEmail = normalizeEmail(initialOrder.ownerEmail);
  const ownerName = normalizeText(initialOrder.ownerName);
  const organizationName = normalizeText(initialOrder.organizationName);
  if (
    !/^[a-z0-9][a-z0-9_-]*-[a-f0-9]{32}$/.test(organizationId)
    || !organizationName
    || !ownerName
    || !isValidEmail(ownerEmail)
  ) {
    throw new functions.https.HttpsError(
      "failed-precondition",
      "Buyer access order has invalid server-owned provisioning identity."
    );
  }

  const entitlements = resolveFeatureEntitlements({ plan: BUYER_ACCESS_PLAN });
  const orgRef = db.collection(ORGANIZATIONS_COLLECTION).doc(organizationId);
  const settingsRef = orgRef.collection("settings").doc("config");
  const inviteRef = db.collection(INVITES_COLLECTION).doc(inviteDocIdFromEmail(ownerEmail));
  const provisioningOrderRef = db.collection(PROVISIONING_ORDERS_COLLECTION).doc(orderId);
  const roleRef = buyerIdentity?.existingUser
    ? db.collection(ROLES_COLLECTION).doc(buyerIdentity.existingUser.uid)
    : null;
  const appUrl = providerState === "paid" && !alreadyProvisioned
    ? getBuyerAccessApplicationUrl()
    : "";
  const supportEmail = APPROVED_EMAIL_FROM_EMAIL;
  const neutralSettings = providerState === "paid" && !alreadyProvisioned
    ? buildNeutralSettingsPatch({
      organizationName,
      ownerName,
      ownerEmail,
      supportEmail
    })
    : {};

  return db.runTransaction(async (tx) => {
    const [dedupeSnap, orderSnap] = await Promise.all([
      tx.get(dedupeRef),
      tx.get(orderRef)
    ]);
    if (dedupeSnap.exists) {
      return {
        duplicate: true,
        orderId,
        shouldFinalizeActivation: providerState === "paid",
        status: normalizeText(orderSnap.data()?.status).toLowerCase()
      };
    }
    if (!orderSnap.exists) {
      throw new functions.https.HttpsError(
        "failed-precondition",
        "Buyer access order disappeared during webhook processing."
      );
    }
    const order = orderSnap.data() || {};
    const binding = assertBuyerAccessInvoiceBinding({
      eventLivemode: event?.livemode,
      invoice,
      order,
      providerState,
      stripeMode: "test"
    });
    if (normalizeText(order.supersededByOrderId)) {
      const supersededAudit = buyerAccessWebhookAudit({
        binding,
        event,
        eventId,
        invoice,
        order,
        providerState,
        requestHost,
        result: "superseded_order",
        status: "ignored"
      });
      tx.create(dedupeRef, supersededAudit);
      return {
        duplicate: false,
        ignored: "superseded_order",
        orderId,
        shouldFinalizeActivation: false,
        status: normalizeText(order.status).toLowerCase()
      };
    }
    const transition = planBuyerAccessTransition({
      currentStatus: order.status,
      providerState
    });
    const nowISO = new Date().toISOString();
    const audit = buyerAccessWebhookAudit({
      binding,
      event,
      eventId,
      invoice,
      order,
      providerState,
      requestHost,
      result: transition.reason,
      status: transition.apply ? "processed" : "ignored"
    });

    if (!transition.apply) {
      tx.create(dedupeRef, audit);
      return {
        duplicate: false,
        ignored: transition.reason,
        orderId,
        shouldFinalizeActivation: providerState === "paid"
          && normalizeText(order.status).toLowerCase() === "activation_pending",
        status: transition.status
      };
    }

    if (providerState !== "paid") {
      tx.set(orderRef, {
        status: transition.status,
        accessGranted: false,
        workspaceReady: false,
        activationEmailSent: false,
        signedVoidObserved: providerState === "void",
        hostedInvoiceUrl: providerState === "failed"
          ? binding.hostedInvoiceUrl
          : "",
        lastProviderState: providerState,
        lastStripeEventId: eventId,
        lastStripeEventType: normalizeText(event?.type),
        updatedAtISO: nowISO,
        updatedAt: FieldValue.serverTimestamp()
      }, { merge: true });
      tx.create(dedupeRef, audit);
      return {
        duplicate: false,
        orderId,
        shouldFinalizeActivation: false,
        status: transition.status
      };
    }

    if (!buyerIdentity || normalizeText(order.ownerUid)) {
      throw new functions.https.HttpsError(
        "failed-precondition",
        "Paid buyer access owner identity is not available for invitation fulfillment."
      );
    }
    if (
      normalizeText(order.plan).toLowerCase() !== BUYER_ACCESS_PLAN
      || normalizeText(order.buyerAccessMode) !== BUYER_ACCESS_MODE
      || Number(order.amountCents) !== BUYER_ACCESS_AMOUNT_CENTS
      || normalizeText(order.currency).toLowerCase() !== BUYER_ACCESS_CURRENCY
    ) {
      throw new functions.https.HttpsError(
        "failed-precondition",
        "Paid buyer access order scope is invalid."
      );
    }

    const [
      orgSnap,
      settingsSnap,
      inviteSnap,
      provisioningOrderSnap,
      roleSnap
    ] = await Promise.all([
      tx.get(orgRef),
      tx.get(settingsRef),
      tx.get(inviteRef),
      tx.get(provisioningOrderRef),
      roleRef ? tx.get(roleRef) : Promise.resolve(null)
    ]);
    if (orgSnap.exists || settingsSnap.exists || inviteSnap.exists || provisioningOrderSnap.exists) {
      throw new functions.https.HttpsError(
        "failed-precondition",
        "Paid buyer access fulfillment target already exists."
      );
    }
    if (roleSnap?.exists) {
      const existingRole = roleSnap.data() || {};
      const rawRole = normalizeText(existingRole.role).toLowerCase();
      const roleEmail = normalizeEmail(existingRole.email);
      if (
        normalizeOrganizationId(existingRole.organizationId)
        || (rawRole && rawRole !== "customer")
        || (roleEmail && roleEmail !== ownerEmail)
      ) {
        throw new functions.https.HttpsError(
          "failed-precondition",
          "Paid buyer access owner role is no longer available."
        );
      }
    }

    const commonBuyerScope = {
      orderId,
      buyerAccessOrderId: orderId,
      buyerAccessMode: BUYER_ACCESS_MODE
    };
    tx.create(orgRef, {
      ...commonBuyerScope,
      name: organizationName,
      slug: slugify(organizationName, organizationId),
      organizationId,
      ownerEmail,
      ownerUid: "",
      active: true,
      archived: false,
      status: "active",
      plan: entitlements.plan,
      featureFlagsLocked: true,
      featureFlagsPaid: entitlements.paidFeatureIds,
      stripeInvoiceId: binding.invoiceId,
      stripePaymentIntentId: binding.paymentIntentId,
      provisionedBy: BUYER_ACCESS_FLOW,
      createdAtISO: nowISO,
      updatedAtISO: nowISO,
      createdAt: FieldValue.serverTimestamp(),
      updatedAt: FieldValue.serverTimestamp()
    });
    tx.create(settingsRef, {
      ...commonBuyerScope,
      plan: entitlements.plan,
      featureFlags: entitlements.featureFlags,
      featureFlagsLocked: true,
      featureFlagsPaid: entitlements.paidFeatureIds,
      featureFlagsLockReason: "Unpaid modules are locked by ordered package.",
      featureFlagsLockUpdatedAtISO: nowISO,
      ...neutralSettings,
      organizationId,
      ownerUid: "",
      onboarding: {
        status: "provisioned",
        source: BUYER_ACCESS_FLOW,
        organizationId,
        plan: entitlements.plan,
        ownerEmail,
        ownerName,
        appUrl,
        provisionedAtISO: nowISO
      },
      createdAtISO: nowISO,
      updatedAtISO: nowISO,
      createdAt: FieldValue.serverTimestamp(),
      updatedAt: FieldValue.serverTimestamp()
    });
    const inviteExpiresAtISO = new Date(
      Date.parse(nowISO) + PROVISIONING_INVITE_VALIDITY_MS
    ).toISOString();
    tx.create(inviteRef, {
      ...commonBuyerScope,
      email: ownerEmail,
      ownerName,
      role: "admin",
      organizationId,
      organizationName,
      featureFlags: entitlements.featureFlags,
      featureFlagsLocked: true,
      featureFlagsPaid: entitlements.paidFeatureIds,
      plan: entitlements.plan,
      appUrl,
      supportEmail,
      status: "pending",
      expiresAtISO: inviteExpiresAtISO,
      createdAtISO: nowISO,
      updatedAtISO: nowISO,
      createdAt: FieldValue.serverTimestamp(),
      updatedAt: FieldValue.serverTimestamp()
    });
    tx.create(provisioningOrderRef, {
      ...commonBuyerScope,
      status: "provisioned",
      operation: "buyer_access_purchase",
      source: BUYER_ACCESS_FLOW,
      organizationId,
      organizationName,
      ownerEmail,
      ownerName,
      ownerUid: "",
      plan: entitlements.plan,
      featureFlags: entitlements.featureFlags,
      featureFlagsPaid: entitlements.paidFeatureIds,
      featureFlagsUnpaid: entitlements.unpaidFeatureIds,
      amountCents: BUYER_ACCESS_AMOUNT_CENTS,
      currency: BUYER_ACCESS_CURRENCY,
      stripeCustomerId: binding.customerId,
      stripeInvoiceId: binding.invoiceId,
      stripePaymentIntentId: binding.paymentIntentId,
      appUrl,
      supportEmail,
      sendEmail: true,
      requestedBy: { source: "signed_stripe_invoice" },
      createdAtISO: nowISO,
      updatedAtISO: nowISO,
      createdAt: FieldValue.serverTimestamp(),
      updatedAt: FieldValue.serverTimestamp()
    });
    tx.set(orderRef, {
      status: "activation_pending",
      accessGranted: false,
      workspaceReady: true,
      activationEmailSent: false,
      hostedInvoiceUrl: "",
      stripePaymentIntentId: binding.paymentIntentId,
      lastProviderState: "paid",
      lastStripeEventId: eventId,
      lastStripeEventType: normalizeText(event?.type),
      paidAtISO: nowISO,
      provisionedAtISO: nowISO,
      claimsSyncStatus: "not_started",
      updatedAtISO: nowISO,
      updatedAt: FieldValue.serverTimestamp()
    }, { merge: true });
    tx.create(dedupeRef, audit);
    return {
      duplicate: false,
      durablyProvisioned: true,
      orderId,
      shouldFinalizeActivation: true,
      status: "activation_pending"
    };
  });
}

exports.buyerAccessStripeWebhook = functions
  .runWith({
    secrets: [
      BUYER_ACCESS_STRIPE_WEBHOOK_SECRET_NAME,
      RESEND_API_KEY_SECRET_NAME
    ]
  })
  .region(REGION)
  .https.onRequest(async (req, res) => {
    if (req.method !== "POST") {
      res.status(405).send("Method Not Allowed");
      return;
    }
    const requestHost = getRequestHostnameFromHttp(req);
    const webhookSecret = readBoundSecret(BUYER_ACCESS_STRIPE_WEBHOOK_SECRET_NAME);
    if (!webhookSecret) {
      res.status(500).send("Buyer access Stripe webhook secret not configured.");
      return;
    }
    const signature = req.headers["stripe-signature"];
    if (!signature) {
      res.status(400).send("Missing stripe-signature header.");
      return;
    }

    let event;
    try {
      event = constructStripeWebhookEvent({
        rawBody: req.rawBody,
        signature,
        webhookSecret,
        webhooks: Stripe.webhooks
      });
    } catch (err) {
      functions.logger.warn("Buyer access Stripe webhook signature verification failed", {
        errorCode: normalizeText(
          err?.code || err?.type || "signature_verification_failed"
        ).slice(0, 80)
      });
      res.status(400).send("Webhook verification failed.");
      return;
    }
    // The event payload shape is payment evidence. Local tooling must adapt to
    // this pinned contract before signing instead of relaxing it here.
    if (normalizeText(event?.api_version) !== BUYER_ACCESS_STRIPE_API_VERSION) {
      functions.logger.warn("Buyer access Stripe webhook API version was rejected", {
        eventId: normalizeText(event?.id),
        errorCode: "api_version_mismatch"
      });
      res.status(400).send("Webhook API version mismatch.");
      return;
    }

    const invoice = event.data?.object || {};
    if (!isBuyerAccessInvoice(invoice)) {
      res.json({ received: true, ignored: "non_buyer_access_invoice" });
      return;
    }
    const providerState = buyerAccessProviderStateForEvent(event.type);
    if (!providerState) {
      res.json({ received: true, ignored: "unsupported_event_type" });
      return;
    }
    const eventId = normalizeText(event?.id);
    if (!/^[a-zA-Z0-9_:-]+$/.test(eventId)) {
      res.status(400).send("Stripe event ID is missing or invalid.");
      return;
    }
    const dedupeRef = db.collection(WEBHOOK_EVENTS_COLLECTION)
      .doc("stripe-buyer-" + eventId);

    try {
      const result = await processBuyerAccessInvoiceWebhook({
        dedupeRef,
        event,
        eventId,
        invoice,
        providerState,
        requestHost
      });
      let activation = null;
      if (
        providerState === "paid"
        && result.orderId
        && result.shouldFinalizeActivation
      ) {
        try {
          activation = await finalizeBuyerAccessActivation({
            orderId: result.orderId
          });
        } catch (err) {
          functions.logger.error("Buyer access activation email remains pending", {
            eventId,
            orderId: result.orderId,
            errorCode: normalizeText(err?.code || "activation_pending").slice(0, 80)
          });
        }
      }
      if (result.duplicate) {
        res.json({ received: true, duplicate: true });
        return;
      }
      if (result.ignored) {
        res.json({ received: true, ignored: result.ignored });
        return;
      }
      res.json({
        received: true,
        buyerAccessStatus: activation?.status || result.status
      });
    } catch (err) {
      functions.logger.error("Failed processing buyer access Stripe Invoice event", {
        eventId,
        eventType: normalizeText(event.type),
        requestHost,
        errorCode: normalizeText(err?.code || "processing_failed").slice(0, 80)
      });
      res.status(500).send("Failed to process buyer access Invoice.");
    }
  });

exports.stripeWebhook = functions
  .runWith({ secrets: [STRIPE_WEBHOOK_SECRET_NAME, TWILIO_AUTH_TOKEN_SECRET_NAME] })
  .region(REGION)
  .https.onRequest(async (req, res) => {
  if (req.method !== "POST") {
    res.status(405).send("Method Not Allowed");
    return;
  }
  const requestHost = getRequestHostnameFromHttp(req);
  const requestIp = getRequestIpFromHttp(req);

  const webhookSecret = readBoundSecret(STRIPE_WEBHOOK_SECRET_NAME);
  if (!webhookSecret) {
    res.status(500).send("Stripe webhook secret not configured.");
    return;
  }

  const signature = req.headers["stripe-signature"];
  if (!signature) {
    res.status(400).send("Missing stripe-signature header.");
    return;
  }

  let event;
  try {
    event = constructStripeWebhookEvent({
      rawBody: req.rawBody,
      signature,
      webhookSecret,
      webhooks: Stripe.webhooks
    });
  } catch (err) {
    functions.logger.warn("Stripe webhook signature verification failed", {
      errorCode: normalizeText(
        err?.code || err?.type || "signature_verification_failed"
      ).slice(0, 80)
    });
    res.status(400).send("Webhook verification failed.");
    return;
  }

  const session = event.data?.object || {};
  if (isBuyerAccessStripeObject(session)) {
    res.json({ received: true, ignored: "buyer_access_uses_dedicated_webhook" });
    return;
  }

  const eventId = normalizeText(event?.id);
  if (!/^[a-zA-Z0-9_:-]+$/.test(eventId)) {
    res.status(400).send("Stripe event ID is missing or invalid.");
    return;
  }
  const dedupeRef = db.collection(WEBHOOK_EVENTS_COLLECTION).doc(`stripe-${eventId}`);
  try {
    const dedupeSnap = await dedupeRef.get();
    if (dedupeSnap.exists) {
      res.json({ received: true, duplicate: true });
      return;
    }
  } catch (err) {
    functions.logger.error("Failed checking Stripe webhook deduplication state", {
      eventId,
      errorMessage: normalizeText(err?.message).slice(0, 240)
    });
    res.status(500).send("Failed to check webhook state.");
    return;
  }

  let providerObservation;
  try {
    providerObservation = mapStripeCheckoutObservation({
      eventType: event.type,
      session
    });
  } catch (err) {
    functions.logger.error("Invalid Stripe checkout observation", {
      eventId,
      eventType: normalizeText(event.type),
      message: normalizeText(err?.message)
    });
    res.status(500).send("Failed to validate checkout observation.");
    return;
  }
  if (!providerObservation.supported) {
    res.json({ received: true, ignored: "unsupported_event_type" });
    return;
  }

  try {
    assertStripeObjectMode({
      expectedMode: getStripeMode(),
      eventLivemode: event?.livemode,
      sessionLivemode: session?.livemode
    });
    const quoteId = normalizeText(session?.metadata?.quoteId);
    const organizationId = normalizeOrganizationId(session?.metadata?.organizationId);
    const paymentKind = normalizeText(session?.metadata?.paymentKind).toLowerCase() || "deposit";
    let flow;
    try {
      flow = getPaymentRequestFlow(paymentKind);
    } catch (paymentKindError) {
      const invalidKindAudit = await db.runTransaction(async (tx) => {
        const existingSnap = await tx.get(dedupeRef);
        if (existingSnap.exists) return { duplicate: true };
        tx.create(dedupeRef, {
          provider: "stripe",
          source: "stripe_webhook",
          eventId,
          eventType: normalizeText(event.type),
          requestHost,
          requestIp,
          organizationId,
          quoteId,
          stripeSessionId: normalizeText(session?.id),
          livemode: session?.livemode === true,
          providerState: providerObservation.providerState,
          paymentKind,
          status: "ignored",
          result: "invalid_payment_kind",
          processedAtISO: new Date().toISOString(),
          createdAt: FieldValue.serverTimestamp()
        });
        return { duplicate: false };
      });
      res.json({
        received: true,
        ...(invalidKindAudit.duplicate
          ? { duplicate: true }
          : { ignored: "invalid_payment_kind" })
      });
      return;
    }
    if (!quoteId || !organizationId) {
      functions.logger.warn("Stripe checkout event ignored: missing QuotePilot metadata", {
        eventId,
        eventType: normalizeText(event.type),
        sessionId: normalizeText(session.id),
        requestHost
      });
      res.json({ received: true, ignored: "missing_quote_metadata" });
      return;
    }

    let quoteDetails;
    try {
      quoteDetails = await readQuoteOrThrow(quoteId, { organizationId });
    } catch (lookupError) {
      const lookupCode = normalizeText(lookupError?.code).toLowerCase();
      if (!new Set(["not-found", "permission-denied"]).has(lookupCode)) {
        throw lookupError;
      }
      const missingAudit = await db.runTransaction(async (tx) => {
        const existingSnap = await tx.get(dedupeRef);
        if (existingSnap.exists) return { duplicate: true };
        tx.create(dedupeRef, {
          provider: "stripe",
          source: "stripe_webhook",
          eventId,
          eventType: normalizeText(event.type),
          requestHost,
          requestIp,
          organizationId,
          quoteId,
          stripeSessionId: normalizeText(session?.id),
          livemode: session?.livemode === true,
          providerState: providerObservation.providerState,
          paymentKind: flow.paymentKind,
          status: "ignored",
          result: lookupCode === "not-found" ? "quote_not_found" : "quote_scope_mismatch",
          providerEventCreatedAtISO: Number.isFinite(Number(event?.created))
            ? new Date(Number(event.created) * 1000).toISOString()
            : "",
          processedAtISO: new Date().toISOString(),
          createdAt: FieldValue.serverTimestamp()
        });
        return { duplicate: false };
      });
      res.json({
        received: true,
        ...(missingAudit.duplicate
          ? { duplicate: true }
          : { ignored: lookupCode === "not-found" ? "quote_not_found" : "quote_scope_mismatch" })
      });
      return;
    }
    const quote = quoteDetails.quote || {};
    const quoteNumber = quoteDetails.quoteNumber || quoteId;
    const checkoutPayment = checkoutPaymentForQuote(quote, flow.paymentKind);
    const activeStripeSessionId = normalizeText(checkoutPayment.stripeSessionId);
    const observedStripeSessionId = normalizeText(session?.id);
    if (observedStripeSessionId !== activeStripeSessionId) {
      let commercialScopeValid = true;
      let commercialScopeError = "";
      try {
        validateStripeCheckoutScope({
          session,
          quote: stripeScopeQuoteForPayment(quote, flow.paymentKind, {
            ...checkoutPayment,
            stripeSessionId: observedStripeSessionId
          }),
          quoteId,
          organizationId: quoteDetails.organizationId
        });
        assertStripePaymentKindMetadata(session, flow.paymentKind);
      } catch (scopeError) {
        commercialScopeValid = false;
        commercialScopeError = normalizeText(scopeError?.message).slice(0, 240);
      }
      const knownSession = isKnownStripeSessionId(checkoutPayment, observedStripeSessionId);
      const stalePaidReview = providerObservation.providerState === "paid";
      const staleResult = knownSession ? "stale_known_session" : "unrecognized_session";
      const staleScopeResult = commercialScopeValid
        ? staleResult
        : `${staleResult}_scope_mismatch`;
      const staleAudit = await db.runTransaction(async (tx) => {
        const existingSnap = await tx.get(dedupeRef);
        if (existingSnap.exists) return { duplicate: true };
        tx.create(dedupeRef, {
          provider: "stripe",
          source: "stripe_webhook",
          eventId,
          eventType: normalizeText(event.type),
          requestHost,
          requestIp,
          organizationId: quoteDetails.organizationId,
          quoteId,
          stripeSessionId: observedStripeSessionId,
          activeStripeSessionId,
          knownSession,
          commercialScopeValid,
          commercialScopeError,
          livemode: session?.livemode === true,
          providerState: providerObservation.providerState,
          paymentKind: flow.paymentKind,
          status: stalePaidReview ? "review_required" : "ignored",
          result: stalePaidReview ? `${staleScopeResult}_paid_review` : staleScopeResult,
          providerEventCreatedAtISO: Number.isFinite(Number(event?.created))
            ? new Date(Number(event.created) * 1000).toISOString()
            : "",
          processedAtISO: new Date().toISOString(),
          createdAt: FieldValue.serverTimestamp()
        });
        return { duplicate: false };
      });
      if (staleAudit.duplicate) {
        res.json({ received: true, duplicate: true });
        return;
      }
      if (stalePaidReview) {
        await sendOwnerSms(
          `Stripe reported a paid delayed checkout for ${quoteNumber}. Review event ${eventId} before changing payment evidence.`
        );
      }
      res.json({
        received: true,
        ignored: stalePaidReview ? "stale_paid_requires_review" : staleResult
      });
      return;
    }
    const validatedSession = validateStripeCheckoutScope({
      session,
      quote: stripeScopeQuoteForPayment(quote, flow.paymentKind),
      quoteId,
      organizationId: quoteDetails.organizationId
    });
    assertStripePaymentKindMetadata(session, flow.paymentKind);
    const paymentResult = await patchPaymentState({
      quoteId,
      organizationId: quoteDetails.organizationId,
      portalKey: normalizeText(quote.portalKey),
      auditContext: {
        host: requestHost,
        eventType: event.type,
        organizationId: quoteDetails.organizationId,
        source: "stripe_webhook"
      },
      stripeSession: session,
      providerObservation,
      paymentKind: flow.paymentKind,
      webhookEvent: {
        eventId,
        eventType: event.type,
        requestHost,
        requestIp,
        providerEventCreatedAtISO: Number.isFinite(Number(event?.created))
          ? new Date(Number(event.created) * 1000).toISOString()
          : ""
      }
    });
    if (paymentResult.duplicate) {
      res.json({ received: true, duplicate: true });
      return;
    }
    if (paymentResult.applied && providerObservation.providerState === "paid") {
      await sendOwnerSms(
        `${flow.paymentKind === "final_balance" ? "Final balance" : "Deposit"} paid for ${quoteNumber}. Amount ${currencyLabel(validatedSession.amountTotal / 100)}.`
      );
    }
    if (paymentResult.ignored) {
      res.json({ received: true, ignored: paymentResult.ignored });
      return;
    }
  } catch (err) {
    functions.logger.error("Failed processing Stripe checkout payment event", {
      eventId,
      eventType: normalizeText(event.type),
      requestHost,
      requestIp,
      message: normalizeText(err?.message).slice(0, 240)
    });
    res.status(500).send("Failed to process checkout session.");
    return;
  }

  res.json({ received: true });
});
