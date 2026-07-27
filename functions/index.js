const functions = require("firebase-functions/v1");
const admin = require("firebase-admin");
const { randomUUID } = require("node:crypto");
const { FieldValue } = require("firebase-admin/firestore");
const Stripe = require("stripe");
const twilio = require("twilio");
const {
  PricingEngineError,
  calculateQuotePricingAuthoritative
} = require("./pricingEngine");
const {
  QuoteCreationError,
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
  buildStripeCheckoutIdempotencyKey,
  normalizeCheckoutTransitionState,
  planDepositCheckout,
  validateStripeCheckoutScope,
  validateStripeCheckoutCompletion
} = require("./paymentSafety");

admin.initializeApp();

const db = admin.firestore();
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
const PORTAL_COLLECTION = "customerPortalQuotes";
const PROVISIONING_ORDERS_COLLECTION = "provisioningOrders";
const WEBHOOK_EVENTS_COLLECTION = "webhookEvents";
let cachedFunctionsConfig = undefined;
let functionsConfigErrorLogged = false;
const CLAIMS_VERSION = 1;
const PROVISIONING_EMAIL_LEASE_MS = 2 * 60 * 1000;
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
    pricingSetupConfirmed: false
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
  const stripeConfigured = stripeMissingFields.length === 0;
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
      missingFields: stripeMissingFields
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
        const user = await admin.auth().getUser(roleSnap.id);
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
  return new Stripe(secretKey);
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
  const currentRecord = await admin.auth().getUser(normalizedUid);
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
  await admin.auth().setCustomUserClaims(normalizedUid, nextClaims);
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

function normalizeAttachment(attachmentInput) {
  if (!attachmentInput || typeof attachmentInput !== "object") return null;

  const filenameRaw = normalizeText(attachmentInput.filename || "quote-proposal.pdf");
  const filename = filenameRaw.endsWith(".pdf") ? filenameRaw : `${filenameRaw}.pdf`;
  const mimeType = normalizeText(attachmentInput.mimeType || "application/pdf").toLowerCase();
  if (mimeType !== "application/pdf") {
    throw new functions.https.HttpsError("invalid-argument", "Only PDF attachments are supported.");
  }

  const base64Source = normalizeText(attachmentInput.base64)
    .replace(/^data:application\/pdf;base64,/i, "")
    .replace(/\s+/g, "");
  if (!base64Source) return null;
  if (!/^[A-Za-z0-9+/=]+$/.test(base64Source)) {
    throw new functions.https.HttpsError("invalid-argument", "Attachment payload is not valid base64.");
  }

  const approxByteSize = Math.floor((base64Source.length * 3) / 4);
  if (approxByteSize > 7 * 1024 * 1024) {
    throw new functions.https.HttpsError("invalid-argument", "Attachment is too large (max 7 MB).");
  }

  return {
    filename,
    content: base64Source
  };
}

async function sendEmailViaResend({
  apiKey,
  from,
  to,
  subject,
  text,
  html = "",
  attachments = [],
  idempotencyKey = ""
}) {
  const normalizedIdempotencyKey = normalizeText(idempotencyKey).slice(0, 256);
  const response = await fetch("https://api.resend.com/emails", {
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
      html: html || undefined,
      attachments: attachments.length ? attachments : undefined
    })
  });

  let payload = null;
  try {
    payload = await response.json();
  } catch {
    payload = null;
  }

  if (!response.ok) {
    const message = normalizeText(payload?.message || payload?.error || response.statusText || "Email provider error.");
    throw new Error(message);
  }

  return {
    id: normalizeText(payload?.id)
  };
}

async function sendCustomerEmail({
  toEmail,
  subject,
  text,
  html = "",
  attachment = null,
  idempotencyKey = ""
}) {
  const emailConfig = getEmailConfig();
  if (emailConfig.provider === "none") {
    throw new functions.https.HttpsError(
      "failed-precondition",
      "Email provider is disabled. Configure NOTIFICATIONS_EMAIL_PROVIDER and the verified sender environment."
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
        attachments: attachment ? [attachment] : [],
        idempotencyKey
      });
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
    throw new functions.https.HttpsError("internal", normalizeText(error?.message || "Failed to send email."));
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
  checkoutTransition = null
}) {
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
  const quoteUpdate = { updatedAtISO: nowISO };
  for (const [key, value] of Object.entries(paymentPatch)) {
    quoteUpdate[`payment.${key}`] = value;
  }
  if (normalizeHostname(auditContext.host)) {
    quoteUpdate["payment.lastHost"] = normalizeHostname(auditContext.host);
  }
  if (normalizeText(auditContext.eventType)) {
    quoteUpdate["payment.lastEventType"] = normalizeText(auditContext.eventType).toLowerCase();
  }
  if (normalizeOrganizationId(auditContext.organizationId)) {
    quoteUpdate["payment.lastOrganizationId"] = normalizeOrganizationId(auditContext.organizationId);
  }

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
      if (stripeSession) {
        validateStripeCheckoutCompletion({
          session: stripeSession,
          quote: currentQuote,
          quoteId: normalizedQuoteId,
          organizationId: normalizedOrganizationId
        });
      }
      if (checkoutTransition) {
        const transition = assertCheckoutPaymentTransition({
          currentPayment: currentQuote.payment,
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

      transaction.update(quoteRef, quoteUpdate);

      if (portalRef) {
        const portalUpdate = {
          updatedAtISO: nowISO,
          payment: {
            ...paymentPatch
          }
        };
        if (normalizeHostname(auditContext.host)) {
          portalUpdate.payment.lastHost = normalizeHostname(auditContext.host);
        }
        if (normalizeText(auditContext.eventType)) {
          portalUpdate.payment.lastEventType = normalizeText(auditContext.eventType).toLowerCase();
        }
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
          status: "processed",
          processedAtISO: nowISO,
          createdAt: FieldValue.serverTimestamp()
        });
      }

      return {
        duplicate: false,
        alreadyApplied: false,
        eventId: webhookEventId
      };
    });
  } catch (err) {
    if (err instanceof PaymentSafetyError) {
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

async function advanceCheckoutGenerationIfUnchanged({
  quoteId,
  organizationId,
  expectedPayment,
  checkoutGeneration
}) {
  const targetGeneration = Number(checkoutGeneration);
  if (!Number.isSafeInteger(targetGeneration) || targetGeneration <= 0) {
    return false;
  }
  const quoteRef = getQuoteDocRef(quoteId, organizationId);
  return db.runTransaction(async (transaction) => {
    const quoteSnap = await transaction.get(quoteRef);
    if (!quoteSnap.exists) return false;
    const currentPayment = normalizeCheckoutTransitionState(
      quoteSnap.data()?.payment
    );
    const expectedState = normalizeCheckoutTransitionState(expectedPayment);
    if (
      targetGeneration !== expectedState.checkoutGeneration + 1
      || JSON.stringify(currentPayment) !== JSON.stringify(expectedState)
    ) {
      return false;
    }
    transaction.update(quoteRef, {
      "payment.checkoutGeneration": targetGeneration,
      updatedAtISO: new Date().toISOString()
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

  const targetUser = await admin.auth().getUser(targetUid);
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
    return await admin.auth().getUserByEmail(ownerEmail);
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
      uidUser = await admin.auth().getUser(ownerUid);
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
  if (!quoteId) {
    throw new functions.https.HttpsError("invalid-argument", "quoteId is required.");
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

  const { quote, quoteRef, organizationId } = await readQuoteOrThrow(quoteId, {
    organizationId: scopedOrganizationId
  });
  const portalCleanup = await deletePortalSnapshotsForQuote({
    quoteId,
    organizationId,
    fallbackPortalKey: quote?.portalKey
  });

  await db.recursiveDelete(quoteRef);

  return {
    ok: true,
    quoteId,
    organizationId,
    portalSnapshotsDeleted: portalCleanup.deleted,
    completedAtISO: new Date().toISOString()
  };
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
  if (err instanceof QuoteCreationError || err instanceof PricingEngineError) {
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
  if (staff.role !== "admin") {
    throw new functions.https.HttpsError(
      "permission-denied",
      "Admin role required to rotate portal links."
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
    const rotatedAtISO = new Date().toISOString();
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
      try {
        const paymentPlan = planDepositCheckout(quote.payment);
        if (paymentPlan.action !== "create") {
          throw new PaymentSafetyError(
            "Resolve or expire the active Stripe checkout before rotating the portal link."
          );
        }
      } catch (err) {
        if (err instanceof PaymentSafetyError) {
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
  const portalLink = resolvePortalLink(quote);

  const smsText =
    `New quote ${quoteNumber} saved for ${customerName}. ` +
    `Event ${eventDate}. Total ${total}.` +
    `${portalLink ? ` Portal: ${portalLink}` : ""}`;
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
  const { quoteId, quote, quoteNumber } = await readQuoteOrThrow(data?.quoteId, {
    organizationId: staff.organizationId
  });
  const customerEmail = normalizeEmail(quote.customer?.email);
  if (!customerEmail) {
    throw new functions.https.HttpsError("failed-precondition", "Quote customer email is missing.");
  }

  const customerName = normalizeText(quote.customer?.name) || "there";
  const eventName = normalizeText(quote.event?.name) || "your event";
  const eventDate = normalizeText(quote.event?.date) || "your event date";
  const venue = normalizeText(quote.event?.venue) || "your venue";
  const total = currencyLabel(quote.totals?.total);
  const deposit = currencyLabel(quote.totals?.deposit);
  const portalLink = resolvePortalLink(quote);
  const storedPaymentLink = normalizeText(quote?.payment?.depositLink);
  const paymentLink = storedPaymentLink
    ? parseStoredPaymentLinkOrThrow(storedPaymentLink)
    : "";
  const attachment = normalizeAttachment(data?.attachment);
  const brandName = normalizeText(quote?.quoteMeta?.brandName) || "QuotePilot";

  const lines = [
    `Hi ${customerName},`,
    "",
    `Your quote ${quoteNumber} is ready for ${eventName} on ${eventDate} at ${venue}.`,
    `Estimated total: ${total}.`,
    `Deposit due: ${deposit}.`,
    portalLink ? `Review and accept your quote: ${portalLink}` : "Reply if you need a portal acceptance link.",
    paymentLink ? `Deposit payment link: ${paymentLink}` : "Reply if you need a deposit payment link.",
    "",
    "Thank you."
  ];

  const email = await sendCustomerEmail({
    toEmail: customerEmail,
    subject: `${brandName} Quote ${quoteNumber} - ${eventDate}`,
    text: lines.join("\n"),
    html: `
      <p>Hi ${escapeHtml(customerName)},</p>
      <p>Your quote <strong>${escapeHtml(quoteNumber)}</strong> is ready for <strong>${escapeHtml(eventName)}</strong> on <strong>${escapeHtml(eventDate)}</strong> at <strong>${escapeHtml(venue)}</strong>.</p>
      <p>Estimated total: <strong>${escapeHtml(total)}</strong><br/>Deposit due: <strong>${escapeHtml(deposit)}</strong></p>
      ${portalLink ? `<p><a href="${escapeHtml(portalLink)}">Review and accept your quote</a></p>` : ""}
      ${paymentLink ? `<p><a href="${escapeHtml(paymentLink)}">Open deposit payment link</a></p>` : ""}
      <p>Thank you.</p>
    `,
    attachment
  });

  return {
    ok: true,
    quoteId,
    quoteNumber,
    portalLink,
    email
  };
});

exports.sendPaymentRequestEmail = functions.region(REGION).https.onCall(async (data, context) => {
  const staff = assertAdminStaff(await assertStaff(context));
  if (normalizeText(data?.paymentLink) || normalizeText(data?.portalLink)) {
    throw new functions.https.HttpsError(
      "invalid-argument",
      "Payment and portal links are server-derived and must not be supplied."
    );
  }
  const { quoteId, quote, quoteNumber } = await readQuoteOrThrow(data?.quoteId, {
    organizationId: staff.organizationId
  });
  const status = normalizeText(quote.status).toLowerCase();
  if (!["accepted", "booked"].includes(status)) {
    throw new functions.https.HttpsError(
      "failed-precondition",
      "Payment requests can be sent only after quote acceptance."
    );
  }

  const customerEmail = normalizeEmail(quote.customer?.email);
  if (!customerEmail) {
    throw new functions.https.HttpsError("failed-precondition", "Quote customer email is missing.");
  }

  const paymentLink = parseStoredPaymentLinkOrThrow(quote?.payment?.depositLink);
  const portalLink = resolvePortalLink(quote);
  const attachment = normalizeAttachment(data?.attachment);
  const customerName = normalizeText(quote.customer?.name) || "there";
  const eventName = normalizeText(quote.event?.name) || "your event";
  const deposit = currencyLabel(quote.totals?.deposit);
  const brandName = normalizeText(quote?.quoteMeta?.brandName) || "QuotePilot";

  const lines = [
    `Hi ${customerName},`,
    "",
    `Your quote ${quoteNumber} for ${eventName} has been accepted.`,
    `Please submit your deposit payment of ${deposit}: ${paymentLink}`,
    portalLink ? `You can also review your quote in the customer portal: ${portalLink}` : "",
    "",
    "Thank you."
  ].filter(Boolean);

  const email = await sendCustomerEmail({
    toEmail: customerEmail,
    subject: `${brandName} Deposit Request - ${quoteNumber}`,
    text: lines.join("\n"),
    html: `
      <p>Hi ${escapeHtml(customerName)},</p>
      <p>Your quote <strong>${escapeHtml(quoteNumber)}</strong> for <strong>${escapeHtml(eventName)}</strong> has been accepted.</p>
      <p>Please submit your deposit payment of <strong>${escapeHtml(deposit)}</strong>.</p>
      <p><a href="${escapeHtml(paymentLink)}">Pay deposit now</a></p>
      ${portalLink ? `<p><a href="${escapeHtml(portalLink)}">Open customer portal</a></p>` : ""}
      <p>Thank you.</p>
    `,
    attachment
  });

  return {
    ok: true,
    quoteId,
    quoteNumber,
    paymentLink,
    email
  };
});

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

exports.createDepositCheckout = functions.region(REGION).https.onCall(async (data, context) => {
  const staff = assertAdminStaff(await assertStaff(context));
  if (normalizeText(data?.successUrl) || normalizeText(data?.cancelUrl)) {
    throw new functions.https.HttpsError(
      "invalid-argument",
      "Checkout return URLs are server-derived and must not be supplied."
    );
  }
  const { quoteId, quote, quoteNumber, organizationId } = await readQuoteOrThrow(data?.quoteId, {
    organizationId: staff.organizationId
  });
  const quoteStatus = normalizeText(quote?.status).toLowerCase();
  if (!["accepted", "booked"].includes(quoteStatus)) {
    throw new functions.https.HttpsError(
      "failed-precondition",
      "Deposit checkout can be created only after quote acceptance."
    );
  }
  const depositValue = Number(quote?.totals?.deposit || 0);
  const depositCents = Math.round(depositValue * 100);
  if (!Number.isFinite(depositCents) || depositCents <= 0) {
    throw new functions.https.HttpsError("failed-precondition", "Quote deposit must be greater than 0.");
  }
  const quotePortalKey = normalizeText(quote.portalKey);
  if (!quotePortalKey) {
    throw new functions.https.HttpsError(
      "failed-precondition",
      "A customer portal must exist before creating a deposit checkout."
    );
  }
  let checkoutPlan;
  try {
    checkoutPlan = planDepositCheckout(quote?.payment);
  } catch (err) {
    if (err instanceof PaymentSafetyError) {
      throw new functions.https.HttpsError("failed-precondition", err.message);
    }
    throw err;
  }
  const stripe = getStripeClient();
  if (checkoutPlan.action === "inspect_existing") {
    const existingUrl = parseStoredPaymentLinkOrThrow(checkoutPlan.depositLink);
    const existingSession = await stripe.checkout.sessions.retrieve(
      checkoutPlan.stripeSessionId
    );
    try {
      validateStripeCheckoutScope({
        session: existingSession,
        quote,
        quoteId,
        organizationId
      });
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
        ok: true,
        reused: true,
        quoteId,
        quoteNumber,
        url: providerUrl,
        sessionId: checkoutPlan.stripeSessionId,
        sms: {
          sent: false,
          reason: "existing_checkout_reused"
        }
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

  const checkoutGeneration = checkoutPlan.nextCheckoutGeneration;
  const session = await stripe.checkout.sessions.create(
    {
      mode: "payment",
      success_url: successUrl.toString(),
      cancel_url: cancelUrl.toString(),
      customer_email: normalizeEmail(quote?.customer?.email) || undefined,
      metadata: {
        quoteId,
        quoteNumber,
        organizationId: organizationId || "",
        portalKey: quotePortalKey || ""
      },
      line_items: [
        {
          quantity: 1,
          price_data: {
            currency: "usd",
            unit_amount: depositCents,
            product_data: {
              name: `Deposit for ${quoteNumber}`,
              description: normalizeText(quote?.event?.name) || "Catering quote deposit"
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
        amountTotal: depositCents,
        checkoutGeneration
      })
    }
  );

  const sessionId = normalizeText(session.id);
  if (!sessionId) {
    throw new functions.https.HttpsError(
      "internal",
      "Stripe did not return a checkout session ID."
    );
  }
  let sessionUrl = "";
  try {
    const currentSession = await stripe.checkout.sessions.retrieve(sessionId);
    validateStripeCheckoutScope({
      session: currentSession,
      quote: {
        ...quote,
        payment: {
          ...(quote.payment || {}),
          stripeSessionId: sessionId
        }
      },
      quoteId,
      organizationId
    });
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
    try {
      neutralized = await neutralizeRejectedStripeCheckout(stripe, sessionId);
    } catch (expireError) {
      functions.logger.error("Failed to expire an invalid Stripe checkout session", {
        sessionId,
        errorMessage: normalizeText(expireError?.message).slice(0, 180)
      });
    }
    if (neutralized) {
      await advanceCheckoutGenerationIfUnchanged({
        quoteId,
        organizationId,
        expectedPayment: quote.payment || {},
        checkoutGeneration
      });
    }
    if (err instanceof PaymentSafetyError) {
      throw new functions.https.HttpsError("failed-precondition", err.message);
    }
    throw err;
  }
  const nowISO = new Date().toISOString();
  const nextPayment = {
    ...(quote.payment || {}),
    depositLink: sessionUrl,
    depositStatus: "sent",
    depositConfirmedAtISO: "",
    stripeSessionId: sessionId,
    checkoutGeneration
  };
  try {
    await patchPaymentState({
      quoteId,
      organizationId,
      portalKey: quotePortalKey,
      paymentPatch: {
        depositLink: sessionUrl,
        depositStatus: "sent",
        depositConfirmedAtISO: "",
        stripeSessionId: sessionId,
        checkoutGeneration,
        lastCheckoutCreatedAtISO: nowISO
      },
      auditContext: {
        host: staff.host,
        eventType: "checkout.session.created",
        organizationId
      },
      checkoutTransition: {
        expectedPayment: quote.payment || {},
        nextPayment
      }
    });
  } catch (err) {
    let neutralized = false;
    try {
      neutralized = await neutralizeRejectedStripeCheckout(stripe, sessionId);
    } catch (expireError) {
      functions.logger.error("Failed to expire a rejected Stripe checkout session", {
        sessionId,
        errorMessage: normalizeText(expireError?.message).slice(0, 180)
      });
    }
    if (neutralized) {
      await advanceCheckoutGenerationIfUnchanged({
        quoteId,
        organizationId,
        expectedPayment: quote.payment || {},
        checkoutGeneration
      });
    }
    throw err;
  }

  const smsResult = await sendOwnerSms(
    `Deposit checkout created for ${quoteNumber}. Deposit ${currencyLabel(depositValue)}.`
  );

  return {
    ok: true,
    reused: false,
    quoteId,
    quoteNumber,
    url: sessionUrl,
    sessionId,
    sms: smsResult
  };
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

  let event;
  try {
    const stripe = getStripeClient();
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

  const paymentEventTypes = new Set([
    "checkout.session.completed",
    "checkout.session.async_payment_succeeded"
  ]);
  if (!paymentEventTypes.has(normalizeText(event.type))) {
    res.json({ received: true, ignored: "unsupported_event_type" });
    return;
  }

  const session = event.data?.object || {};
  if (
    event.type === "checkout.session.completed"
    && normalizeText(session.payment_status).toLowerCase() !== "paid"
  ) {
    res.json({ received: true, ignored: "awaiting_payment" });
    return;
  }

  try {
    const quoteId = normalizeText(session?.metadata?.quoteId);
    const organizationId = normalizeOrganizationId(session?.metadata?.organizationId);
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

    const quoteDetails = await readQuoteOrThrow(quoteId, {
      organizationId
    });
    const quote = quoteDetails.quote || {};
    const quoteNumber = quoteDetails.quoteNumber || quoteId;
    const validatedSession = validateStripeCheckoutCompletion({
      session,
      quote,
      quoteId,
      organizationId: quoteDetails.organizationId
    });
    const paymentResult = await patchPaymentState({
      quoteId,
      organizationId: quoteDetails.organizationId,
      portalKey: normalizeText(quote.portalKey),
      paymentPatch: {
        depositStatus: "paid",
        depositConfirmedAtISO: new Date().toISOString(),
        stripeSessionId: validatedSession.sessionId
      },
      auditContext: {
        host: requestHost,
        eventType: event.type,
        organizationId: quoteDetails.organizationId
      },
      stripeSession: session,
      webhookEvent: {
        eventId,
        eventType: event.type,
        requestHost,
        requestIp
      }
    });
    if (paymentResult.duplicate) {
      res.json({ received: true, duplicate: true });
      return;
    }
    await sendOwnerSms(
      `Deposit paid for ${quoteNumber}. Amount ${currencyLabel(validatedSession.amountTotal / 100)}.`
    );
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
