const functions = require("firebase-functions/v1");
const { initializeApp } = require("firebase-admin/app");
const { getAuth } = require("firebase-admin/auth");
const { createHash, randomInt, randomUUID } = require("node:crypto");
const { FieldValue, getFirestore } = require("firebase-admin/firestore");
const Stripe = require("stripe");
const twilio = require("twilio");
const {
  PricingEngineError,
  calculateQuotePricingAuthoritative
} = require("./pricingEngine");
const {
  QuoteCreationError,
  buildCanonicalPortalSnapshot,
  buildDuplicateQuoteForm,
  buildPortalRotationDocuments,
  buildQuoteReopenDocuments,
  buildServerQuoteNumber,
  buildTrustedQuoteCreationDocuments,
  buildTrustedQuoteEditDocuments,
  sanitizeQuoteCreationRequest
} = require("./quoteCreation");
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
  buildApprovalExecutionOutcome,
  buildApprovalExecutionStart,
  buildApprovalRequest,
  buildApprovalResolution
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
const {
  ContractWorkflowError,
  planContractConversion
} = require("./contractWorkflow");
const {
  StarterCatalogPackError,
  applyStarterCatalogPack: applyStarterCatalogPackInternal,
  confirmCatalogPricing: confirmCatalogPricingInternal
} = require("./starterCatalogPacks");
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
const APPROVED_EMAIL_FROM_NAME = "QuotePilot by MBMapps";
const APPROVED_EMAIL_FROM_EMAIL = "onboarding@quotepilot.mbmapps.com";
const QUOTES_COLLECTION = "quotes";
const QUOTE_APPROVAL_EXECUTIONS_COLLECTION = "quoteApprovalExecutions";
const PRIVATE_PAYMENT_DISPATCHES_COLLECTION = "privatePaymentDispatches";
const PORTAL_COLLECTION = "customerPortalQuotes";
const PROVISIONING_ORDERS_COLLECTION = "provisioningOrders";
const WEBHOOK_EVENTS_COLLECTION = "webhookEvents";
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
    organizationName: normalizeText(invite.organizationName)
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
  ownerUid = ""
} = {}) {
  const greetingName = normalizeText(ownerName, "there");
  const roleLine = ownerUid
    ? "Your admin access is already linked to your account."
    : "Your admin access is pre-authorized for this email and will activate on first sign-in.";
  const supportLine = supportEmail
    ? `If you need help, reply to this message or contact ${supportEmail}.`
    : "If you need help, reply to this message and we will assist right away.";

  const lines = [
    `Hi ${greetingName},`,
    "",
    `Your ${organizationName} workspace is ready.`,
    "",
    "Getting started:",
    `1. Open ${appUrl}`,
    `2. Sign in (or create an account) using ${ownerEmail}`,
    `3. Confirm you are in organization "${organizationName}" (${organizationId})`,
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
  const html = `
    <p>Hi ${escapeHtml(greetingName)},</p>
    <p>Your <strong>${escapeHtml(organizationName)}</strong> workspace is ready.</p>
    <p><strong>Getting started</strong><br/>
    1. Open <a href="${escapeHtml(appUrl)}">${escapeHtml(appUrl)}</a><br/>
    2. Sign in (or create an account) using <strong>${escapeHtml(ownerEmail)}</strong><br/>
    3. Confirm your organization is <strong>${escapeHtml(organizationName)}</strong> (${escapeHtml(organizationId)})</p>
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
    authToken: readConfig("twilio.auth_token"),
    fromNumber: readConfig("twilio.from_number"),
    toNumber: readConfig("notifications.owner_phone")
  };
}

function getStripeConfig() {
  return {
    mode: readConfig("stripe.mode"),
    secretKey: readConfig("stripe.secret_key"),
    webhookSecret: readConfig("stripe.webhook_secret")
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
    resendApiKey: normalizeText(readConfig("resend.api_key")),
    senderApproved:
      fromName === APPROVED_EMAIL_FROM_NAME
      && fromEmail === APPROVED_EMAIL_FROM_EMAIL
  };
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
    { name: "TWILIO_FROM_NUMBER", value: twilioConfig.fromNumber },
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
  const secretKey = readConfig("stripe.secret_key");
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

async function ensureOrganizationBootstrapInternal({
  uid,
  email
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

    const platformAdmin = isPlatformAdminEmail(normalizedEmail);
    const existingRole = normalizeRole(roleSnap.data()?.role);
    const role = pendingInvite?.role || (platformAdmin ? "admin" : existingRole);
    let organizationId = normalizeOrganizationId(pendingInvite?.organizationId || roleSnap.data()?.organizationId);

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
    }

    const rolePayload = {
      role,
      email: normalizedEmail,
      organizationId: organizationId || "",
      updatedAt: FieldValue.serverTimestamp()
    };
    if (!roleSnap.exists) {
      rolePayload.createdAt = FieldValue.serverTimestamp();
    }

    tx.set(roleRef, rolePayload, { merge: true });

    return {
      role,
      organizationId: organizationId || "",
      createdOrganization: false
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
  if (!normalizeEmail(quote?.customer?.email)) {
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
  if (!normalizeEmail(quote?.customer?.email)) {
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
  const brandName = normalizeText(quote?.quoteMeta?.brandName) || "QuotePilot";
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
      subject: `${brandName} Contract ${contractNumber} - portal access renewed`,
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
    subject: `${brandName} Quote ${quoteNumber} - ${eventDate}`,
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
      to,
      subject: normalizeText(subject),
      error: normalizeText(error?.message)
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
  existingEmail = null
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
    ownerUid
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
  const persistedEmail = {
    ...(dispatchLease?.email || {}),
    ...emailResult,
    auditPersisted: true,
    toEmail: ownerEmail,
    subject: emailPayload.subject,
    ...(emailResult.sent
      ? { sentAtISO: existingSentAtISO || completedAtISO }
      : sendEmail
        ? { failedAtISO: existingFailedAtISO || completedAtISO }
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
    { name: "twilio.from_number", value: twilioConfig.fromNumber },
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
      from: twilioConfig.fromNumber,
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

  const bootstrap = await ensureOrganizationBootstrapInternal({
    uid,
    email
  });

  await syncPrincipalClaims({
    uid,
    role: bootstrap.role,
    organizationId: bootstrap.organizationId,
    platformAdmin: isPlatformAdminEmail(email)
  });

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

exports.provisionCustomerOrder = functions.region(REGION).https.onCall(async (data, context) => {
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

exports.repairCustomerProvisioningOrder = functions.region(REGION).https.onCall(async (data, context) => {
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

  const requestedLimit = Number(data?.limit || 100);
  const limit = Math.max(1, Math.min(300, Number.isFinite(requestedLimit) ? Math.round(requestedLimit) : 100));
  const quotesRef = db.collection(ORGANIZATIONS_COLLECTION).doc(organizationId).collection(QUOTES_COLLECTION);
  const deletedSnap = await quotesRef.where("status", "==", "deleted").limit(limit).get();

  let deletedQuotes = 0;
  let portalSnapshotsDeleted = 0;
  for (const docSnap of deletedSnap.docs) {
    const quoteData = docSnap.data() || {};
    const quoteOrganizationId = normalizeOrganizationId(quoteData.organizationId || organizationId);
    if (quoteOrganizationId !== organizationId) {
      continue;
    }
    const quoteId = docSnap.id;
    const portalCleanup = await deletePortalSnapshotsForQuote({
      quoteId,
      organizationId,
      fallbackPortalKey: quoteData?.portalKey
    });
    portalSnapshotsDeleted += portalCleanup.deleted;
    await db.recursiveDelete(docSnap.ref);
    deletedQuotes += 1;
  }

  return {
    ok: true,
    organizationId,
    scanned: deletedSnap.size,
    deletedQuotes,
    portalSnapshotsDeleted,
    limitApplied: limit,
    hasMore: deletedSnap.size === limit,
    completedAtISO: new Date().toISOString()
  };
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

exports.calculateQuotePricing = functions.region(REGION).https.onCall(async (data, context) => {
  const staff = await assertStaff(context);
  const actorEmail = normalizeEmail(context?.auth?.token?.email || "");
  const pricingStaff = {
    ...staff,
    email: actorEmail
  };

  try {
    const result = await calculateQuotePricingAuthoritative({
      db,
      data,
      staff: pricingStaff,
      organizationsCollection: ORGANIZATIONS_COLLECTION
    });
    return {
      ok: true,
      organizationId: result.organizationId,
      catalogSource: result.catalogSource,
      pricing: result.pricing
    };
  } catch (err) {
    if (err instanceof PricingEngineError) {
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

async function createTrustedQuoteDraftInternal({
  organizationId,
  staff,
  form,
  creationReason = "initial_quote_create",
  sourceQuoteId = ""
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
          source: creationReason,
          generatedAt: nowISO
        }
      }
    },
    staff: {
      ...staff,
      email: normalizeEmail(staff.email)
    },
    organizationsCollection: ORGANIZATIONS_COLLECTION
  });

  const settingsRef = db
    .collection(ORGANIZATIONS_COLLECTION)
    .doc(organizationId)
    .collection("settings")
    .doc("config");
  const settingsSnap = await settingsRef.get();
  if (!settingsSnap.exists) {
    throw new QuoteCreationError(
      "failed-precondition",
      "Pricing settings must exist before a quote can be created."
    );
  }

  const quoteRef = db
    .collection(ORGANIZATIONS_COLLECTION)
    .doc(organizationId)
    .collection(QUOTES_COLLECTION)
    .doc();
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
    settings: settingsSnap.data() || {},
    nowISO,
    creationReason,
    sourceQuoteId
  });
  const portalRef = db.collection(PORTAL_COLLECTION).doc(portalKey);
  const versionRef = quoteRef.collection("versions").doc(documents.version.versionId);

  await db.runTransaction(async (tx) => {
    const [quoteSnap, portalSnap, versionSnap] = await Promise.all([
      tx.get(quoteRef),
      tx.get(portalRef),
      tx.get(versionRef)
    ]);
    if (quoteSnap.exists || portalSnap.exists || versionSnap.exists) {
      throw new QuoteCreationError(
        "already-exists",
        "A generated quote identity collided. Retry quote creation."
      );
    }

    tx.create(quoteRef, {
      ...documents.quote,
      createdAt: FieldValue.serverTimestamp(),
      updatedAt: FieldValue.serverTimestamp()
    });
    tx.create(portalRef, {
      ...documents.portal,
      createdAt: FieldValue.serverTimestamp(),
      updatedAt: FieldValue.serverTimestamp()
    });
    tx.create(versionRef, {
      ...documents.version,
      createdAt: FieldValue.serverTimestamp()
    });
  });

  return {
    ok: true,
    organizationId,
    storage: "firebase",
    ...documents.result
  };
}

async function updateTrustedQuoteDraftInternal({
  organizationId,
  quoteId,
  staff,
  form
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
    organizationsCollection: ORGANIZATIONS_COLLECTION
  });
  const settingsRef = db
    .collection(ORGANIZATIONS_COLLECTION)
    .doc(organizationId)
    .collection("settings")
    .doc("config");
  const settingsSnap = await settingsRef.get();
  if (!settingsSnap.exists) {
    throw new QuoteCreationError(
      "failed-precondition",
      "Pricing settings must exist before a quote can be edited."
    );
  }

  const quoteRef = getQuoteDocRef(quoteId, organizationId);
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
    assertQuoteEditNotDispatching({ ...quote, id: quoteId }, nowISO);
    assertNoInProgressPaymentDispatch(quote, "editing the quote");

    const documents = buildTrustedQuoteEditDocuments({
      quoteId,
      quote,
      staff,
      form: sanitized.form,
      pricing: pricingResult.pricing,
      catalogSource: pricingResult.catalogSource,
      settings: settingsSnap.data() || {},
      nowISO
    });
    const portalRef = db.collection(PORTAL_COLLECTION).doc(documents.result.portalKey);
    const versionRef = quoteRef
      .collection("versions")
      .doc(documents.version.versionId);
    const [portalSnap, versionSnap] = await Promise.all([
      tx.get(portalRef),
      tx.get(versionRef)
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

    tx.update(quoteRef, {
      ...documents.quotePatch,
      updatedAt: FieldValue.serverTimestamp()
    });
    tx.set(portalRef, {
      ...documents.portal,
      updatedAt: FieldValue.serverTimestamp(),
      ...(portalSnap.exists
        ? {}
        : { createdAt: FieldValue.serverTimestamp() })
    });
    tx.create(versionRef, {
      ...documents.version,
      createdAt: FieldValue.serverTimestamp()
    });
    return documents.result;
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
    || err instanceof PricingEngineError
    || err instanceof ApprovalWorkflowError
    || err instanceof ContractWorkflowError
    || err instanceof QuoteDeliveryError
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
      form: data?.form
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
    const settingsRef = db
      .collection(ORGANIZATIONS_COLLECTION)
      .doc(organizationId)
      .collection("settings")
      .doc("config");
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
        approvalRequests: completed.approvalRequests
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
        versionMeta
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
        versionId,
        versionNumber: nextVersionNumber
      };

      tx.create(versionRef, {
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
      });
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

exports.rotateQuotePortalKey = functions.region(REGION).https.onCall(async (data, context) => {
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
        if (normalizeText(quote.status).toLowerCase() === "booked") {
          const ledger = projectQuotePaymentLedger(quote);
          if (ledger.byKind.finalBalance.state !== "paid") {
            const finalBalancePlan = planDepositCheckout(
              normalizeFinalBalanceCheckoutPayment(quote.payment)
            );
            if (finalBalancePlan.action !== "create") {
              throw new PaymentSafetyError(
                "Resolve or expire the active final-balance checkout before renewing the portal link."
              );
            }
          }
        } else {
          const paymentPlan = planDepositCheckout(quote.payment);
          if (paymentPlan.action !== "create") {
            throw new PaymentSafetyError(
              "Resolve or expire the active Stripe checkout before rotating the portal link."
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
      const started = buildApprovalExecutionStart({
        workflow: quote.workflow,
        requestId: approvalRequestId,
        action: "rotate_portal_link",
        actorEmail: staff.email,
        nowISO: rotatedAtISO,
        operationId: approvalRequestId
      });
      const completed = buildApprovalExecutionOutcome({
        workflow: {
          ...(quote.workflow || {}),
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
        ...(quote.workflow || {}),
        approvalRequests: completed.approvalRequests
      };
      const response = {
        ...documents.result,
        approvalRequest: completed.request
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
    return quoteCreationFailure(err, {
      operation: "rotateQuotePortalKey",
      staff,
      organizationId,
      failureMessage: "Failed to rotate portal link."
    });
  }
});

exports.notifyOwnerNewQuote = functions.region(REGION).https.onCall(async (data, context) => {
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

exports.sendQuoteToCustomer = functions.region(REGION).https.onCall(async (data, context) => {
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
  const attemptId = randomUUID();
  const startedAtISO = new Date().toISOString();
  const attemptProvider = getEmailProvider();

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
    if (err instanceof QuoteDeliveryError) {
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
    const brandName = normalizeText(claimedQuote?.quoteMeta?.brandName) || "QuotePilot";
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
        subject: `${brandName} ${flow.title} - ${quoteNumber}`,
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

exports.sendPaymentRequestEmail = functions.region(REGION).https.onCall((data, context) => (
  sendApprovedPaymentRequestEmail(data, context, "deposit")
));

exports.sendFinalBalanceRequestEmail = functions.region(REGION).https.onCall((data, context) => (
  sendApprovedPaymentRequestEmail(data, context, "final_balance")
));

exports.getIntegrationSetupStatus = functions.region(REGION).https.onCall(async (_data, context) => {
  assertAdminStaff(await assertStaff(context));
  return {
    ok: true,
    status: buildIntegrationSetupStatus()
  };
});

exports.sendIntegrationTestSms = functions.region(REGION).https.onCall(async (data, context) => {
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

exports.reconcileDepositCheckout = functions.region(REGION).https.onCall((data, context) => (
  reconcileCheckout(data, context, "deposit")
));

exports.reconcileFinalBalanceCheckout = functions.region(REGION).https.onCall((data, context) => (
  reconcileCheckout(data, context, "final_balance")
));

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

exports.stripeWebhook = functions.region(REGION).https.onRequest(async (req, res) => {
  if (req.method !== "POST") {
    res.status(405).send("Method Not Allowed");
    return;
  }
  const requestHost = getRequestHostnameFromHttp(req);
  const requestIp = getRequestIpFromHttp(req);

  const webhookSecret = readConfig("stripe.webhook_secret");
  if (!webhookSecret) {
    res.status(500).send("Stripe webhook secret not configured.");
    return;
  }

  const signature = req.headers["stripe-signature"];
  if (!signature) {
    res.status(400).send("Missing stripe-signature header.");
    return;
  }

  let stripe;
  try {
    stripe = getStripeClient();
  } catch (err) {
    res.status(500).send(`Stripe configuration failed: ${err.message}`);
    return;
  }
  let event;
  try {
    event = stripe.webhooks.constructEvent(req.rawBody, signature, webhookSecret);
  } catch (err) {
    res.status(400).send(`Webhook verification failed: ${err.message}`);
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

  const session = event.data?.object || {};
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
