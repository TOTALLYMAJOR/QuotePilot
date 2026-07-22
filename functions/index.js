const functions = require("firebase-functions/v1");
const admin = require("firebase-admin");
const { FieldValue } = require("firebase-admin/firestore");
const Stripe = require("stripe");
const twilio = require("twilio");
const {
  PricingEngineError,
  calculateQuotePricingAuthoritative
} = require("./pricingEngine");

admin.initializeApp();

const db = admin.firestore();
const REGION = "us-central1";
const ROLES_COLLECTION = "userRoles";
const ORGANIZATIONS_COLLECTION = "organizations";
const TENANT_DOMAINS_COLLECTION = "tenantDomains";
const STAFF_ROLES = new Set(["admin", "sales"]);
const ROLE_VALUES = new Set(["admin", "sales", "customer"]);
const INVITES_COLLECTION = "organizationInvites";
const SMS_PROVIDERS = new Set(["twilio", "none"]);
const EMAIL_PROVIDERS = new Set(["resend", "none"]);
const QUOTES_COLLECTION = "quotes";
const PORTAL_COLLECTION = "customerPortalQuotes";
const PROVISIONING_ORDERS_COLLECTION = "provisioningOrders";
const WEBHOOK_EVENTS_COLLECTION = "webhookEvents";
let cachedFunctionsConfig = undefined;
let functionsConfigErrorLogged = false;
const CLAIMS_VERSION = 1;
const AUTH_CLAIMS_MODE = normalizeText(readConfig("auth.claims_mode", "dual")).toLowerCase() || "dual";
const BOOTSTRAP_ADMIN_EMAILS = new Set(
  normalizeText(readConfig("auth.bootstrap_admin_emails", ""))
    .split(",")
    .map((value) => normalizeEmail(value))
    .filter(Boolean)
);
const SHARED_APP_HOSTS = new Set(
  normalizeText(readConfig("app.shared_hosts", "app.mbmapps.com,quotepilot.mbmapps.com"))
    .split(",")
    .map((value) => normalizeHostname(value))
    .filter(Boolean)
);
const RESERVED_SUBDOMAINS = new Set(["www", "app", "api", "admin"]);
const UNKNOWN_HOST_WINDOW_MS = Math.max(1_000, Number(readConfig("security.unknown_host_window_ms", "300000")) || 300000);
const UNKNOWN_HOST_LIMIT = Math.max(1, Number(readConfig("security.unknown_host_limit", "20")) || 20);
const unknownHostCounter = new Map();
const FEATURE_FLAG_KEYS = [
  "customerPortal",
  "eventSchedule",
  "integrationsOps",
  "diagnostics",
  "reportingDashboard",
  "quoteCompare",
  "crmSync",
  "guidedSelling",
  "aiAssist",
  "aiAutopilot"
];
const FEATURE_FLAG_LABELS = {
  customerPortal: "Customer Portal",
  eventSchedule: "Event Schedule",
  integrationsOps: "Integrations Ops",
  diagnostics: "Diagnostics",
  reportingDashboard: "Reporting Dashboard",
  quoteCompare: "Quote Compare",
  crmSync: "CRM Sync",
  guidedSelling: "Guided Selling",
  aiAssist: "AI Assist (Suggestions)",
  aiAutopilot: "AI Autopilot (Auto Apply)"
};
const FEATURE_PLAN_PRESETS = {
  starter: ["customerPortal", "eventSchedule", "guidedSelling", "aiAssist"],
  growth: ["customerPortal", "eventSchedule", "guidedSelling", "quoteCompare", "reportingDashboard", "aiAssist"],
  enterprise: [...FEATURE_FLAG_KEYS]
};
const NEUTRAL_CATALOG_SKELETON = {
  packages: [
    { id: "starter-package", name: "Starter Package", ppp: 0 },
    { id: "standard-package", name: "Standard Package", ppp: 0 },
    { id: "signature-package", name: "Signature Package", ppp: 0 }
  ],
  addons: [
    { id: "custom-addon", name: "Custom Add-on", pricingType: "per_event", type: "per_event", price: 0, active: true }
  ],
  rentals: [
    { id: "custom-rental", name: "Custom Rental", pricingType: "per_item", type: "per_item", price: 0, qtyPerGuests: 10, active: true }
  ]
};

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
  if (!envKey) return "";
  return normalizeText(process.env[envKey]);
}

function readConfig(path, fallback = "") {
  const config = getFunctionsConfigSnapshot();
  const value = path.split(".").reduce((acc, key) => (acc && acc[key] !== undefined ? acc[key] : undefined), config);
  if (value !== undefined && value !== null && String(value).trim()) {
    return String(value).trim();
  }
  const envValue = readEnvConfig(path);
  if (envValue) return envValue;
  return fallback;
}

function normalizeText(value) {
  return String(value || "").trim();
}

function withFallback(value, fallback = "") {
  const text = normalizeText(value);
  if (text) return text;
  return normalizeText(fallback);
}

function normalizeEmail(value) {
  return normalizeText(value).toLowerCase();
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
  if (SHARED_APP_HOSTS.has(normalizedHost)) return "app";

  const baseDomain = getBaseDomain();
  if (normalizedHost === baseDomain || normalizedHost === `www.${baseDomain}`) {
    return "marketing";
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
  if (expiresAtISO) {
    const expiresAtMs = Date.parse(expiresAtISO);
    if (Number.isFinite(expiresAtMs) && expiresAtMs <= Date.now()) {
      return null;
    }
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
  const plan = FEATURE_PLAN_PRESETS[requestedPlan] ? requestedPlan : "growth";
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
    brandTagline: "Powered by QuotePilot by MBMApps",
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
    menuSections: []
  };
}

async function buildNeutralCatalogSeedEntries({ organizationId = "", nowISO = "" } = {}) {
  const normalizedOrganizationId = normalizeOrganizationId(organizationId);
  if (!normalizedOrganizationId) return [];

  const orgRef = db.collection(ORGANIZATIONS_COLLECTION).doc(normalizedOrganizationId);
  const packagesCollection = orgRef.collection("catalogPackages");
  const addonsCollection = orgRef.collection("catalogAddons");
  const rentalsCollection = orgRef.collection("catalogRentals");

  const [packageSnap, addonSnap, rentalSnap] = await Promise.all([
    packagesCollection.limit(1).get(),
    addonsCollection.limit(1).get(),
    rentalsCollection.limit(1).get()
  ]);

  const entries = [];
  if (packageSnap.empty) {
    NEUTRAL_CATALOG_SKELETON.packages.forEach((item) => {
      entries.push({
        ref: packagesCollection.doc(item.id),
        data: {
          ...item,
          source: "provisioning-default",
          createdAtISO: nowISO
        }
      });
    });
  }

  if (addonSnap.empty) {
    NEUTRAL_CATALOG_SKELETON.addons.forEach((item) => {
      entries.push({
        ref: addonsCollection.doc(item.id),
        data: {
          ...item,
          source: "provisioning-default",
          createdAtISO: nowISO
        }
      });
    });
  }

  if (rentalSnap.empty) {
    NEUTRAL_CATALOG_SKELETON.rentals.forEach((item) => {
      entries.push({
        ref: rentalsCollection.doc(item.id),
        data: {
          ...item,
          source: "provisioning-default",
          createdAtISO: nowISO
        }
      });
    });
  }

  return entries;
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
    "Modules not included in this order are locked off. Paid modules can still be adjusted by your admin team.",
    "",
    supportLine,
    "",
    "Thank you."
  ].filter(Boolean);

  const text = lines.join("\n");
  const html = `
    <p>Hi ${greetingName},</p>
    <p>Your <strong>${organizationName}</strong> workspace is ready.</p>
    <p><strong>Getting started</strong><br/>
    1. Open <a href="${appUrl}">${appUrl}</a><br/>
    2. Sign in (or create an account) using <strong>${ownerEmail}</strong><br/>
    3. Confirm your organization is <strong>${organizationName}</strong> (${organizationId})</p>
    <p>${roleLine}</p>
    ${orderId ? `<p>Order reference: <strong>${orderId}</strong></p>` : ""}
    <p><strong>Enabled modules</strong><br/>${formatFeatureListForEmail(paidFeatureIds).join("<br/>")}</p>
    <p><strong>Not included in this order</strong><br/>${formatFeatureListForEmail(unpaidFeatureIds).join("<br/>")}</p>
    <p>Modules not included in this order are locked off. Paid modules can still be adjusted by your admin team.</p>
    <p>${supportLine}</p>
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
  const provider = normalizeText(readConfig("notifications.sms_provider", "twilio")).toLowerCase();
  if (!provider) return "twilio";
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
  return {
    provider: getEmailProvider(),
    fromEmail: normalizeEmail(readConfig("email.from_email", readConfig("notifications.owner_email"))),
    fromName: normalizeText(readConfig("email.from_name", "QuotePilot by MBMApps")),
    resendApiKey: normalizeText(readConfig("resend.api_key"))
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
    { name: "twilio.account_sid", value: twilioConfig.accountSid },
    { name: "twilio.auth_token", value: twilioConfig.authToken },
    { name: "twilio.from_number", value: twilioConfig.fromNumber },
    { name: "notifications.owner_phone", value: twilioConfig.toNumber }
  ]);
  const stripeMissingFields = listMissingFields([
    { name: "stripe.secret_key", value: stripeConfig.secretKey },
    { name: "stripe.webhook_secret", value: stripeConfig.webhookSecret }
  ]);
  const emailMissingFields = listMissingFields([
    { name: "email.from_email", value: emailConfig.fromEmail },
    ...(emailConfig.provider === "resend" ? [{ name: "resend.api_key", value: emailConfig.resendApiKey }] : [])
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

function getStripeClient() {
  const secretKey = readConfig("stripe.secret_key");
  if (!secretKey) {
    throw new functions.https.HttpsError(
      "failed-precondition",
      "Stripe is not configured. Set stripe.secret_key with firebase functions:config:set."
    );
  }
  return new Stripe(secretKey);
}

async function ensureOrganizationBootstrapInternal({
  uid,
  email,
  organizationName = "",
  organizationSlug = ""
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

    const bootstrapAdmin = BOOTSTRAP_ADMIN_EMAILS.has(normalizedEmail);
    const existingRole = normalizeRole(roleSnap.data()?.role);
    const role = pendingInvite?.role || (bootstrapAdmin ? "admin" : existingRole);
    const shouldHaveOrganization = role === "admin" || role === "sales";
    let organizationId = normalizeOrganizationId(pendingInvite?.organizationId || roleSnap.data()?.organizationId);

    if (shouldHaveOrganization && !organizationId) {
      organizationId = db.collection(ORGANIZATIONS_COLLECTION).doc().id;
    }

    let createdOrganization = false;
    if (organizationId) {
      const orgRef = db.collection(ORGANIZATIONS_COLLECTION).doc(organizationId);
      const orgSnap = await tx.get(orgRef);
      if (!orgSnap.exists) {
        const resolvedName = withFallback(
          organizationName || pendingInvite?.organizationName,
          bootstrapAdmin ? "Default Organization" : "Organization"
        );
        tx.set(orgRef, {
          name: resolvedName,
          slug: slugify(organizationSlug || resolvedName || organizationId, organizationId.slice(0, 12)),
          ownerUid: normalizedUid,
          ownerEmail: normalizedEmail,
          createdAt: FieldValue.serverTimestamp(),
          updatedAt: FieldValue.serverTimestamp()
        }, { merge: true });
        createdOrganization = true;
      } else {
        tx.set(orgRef, {
          updatedAt: FieldValue.serverTimestamp()
        }, { merge: true });
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
      createdOrganization
    };
  });
}

async function getUserRole(uid) {
  const roleSnap = await db.collection(ROLES_COLLECTION).doc(uid).get();
  const role = normalizeRole(roleSnap.data()?.role);
  const organizationId = normalizeOrganizationId(roleSnap.data()?.organizationId);
  return {
    role,
    organizationId
  };
}

function getRuntimeRoleOrgFromClaims(context) {
  const token = context?.auth?.token || {};
  return {
    role: normalizeRole(token.role),
    organizationId: normalizeOrganizationId(token.organizationId),
    claimsVersion: Number(token.claimsVersion || 0) || 0,
    email: normalizeEmail(token.email || "")
  };
}

function mergeRuntimePrincipal({ claimsRole = "customer", claimsOrg = "", roleDoc = { role: "customer", organizationId: "" } } = {}) {
  const roleDocRole = normalizeRole(roleDoc?.role);
  const roleDocOrg = normalizeOrganizationId(roleDoc?.organizationId);
  const claimRole = normalizeRole(claimsRole);
  const claimOrg = normalizeOrganizationId(claimsOrg);

  if (claimOrg && roleDocOrg && claimOrg !== roleDocOrg) {
    throw new functions.https.HttpsError("permission-denied", "Claim organization does not match role scope.");
  }

  if (AUTH_CLAIMS_MODE === "claims") {
    return {
      role: claimRole,
      organizationId: claimOrg
    };
  }

  if (AUTH_CLAIMS_MODE === "roles") {
    return {
      role: roleDocRole,
      organizationId: roleDocOrg
    };
  }

  return {
    role: claimRole !== "customer" ? claimRole : roleDocRole,
    organizationId: claimOrg || roleDocOrg
  };
}

function hasCrossOrgPolicyBypass({ role = "", email = "", hostType = "" } = {}) {
  const normalizedRole = normalizeRole(role);
  const normalizedEmail = normalizeEmail(email);
  if (BOOTSTRAP_ADMIN_EMAILS.has(normalizedEmail)) return true;
  if (hostType === "app" && normalizedRole === "admin") {
    return String(readConfig("auth.allow_app_cross_org_admin", "false")).toLowerCase() === "true";
  }
  return false;
}

async function syncPrincipalClaims({ uid = "", role = "customer", organizationId = "" } = {}) {
  const normalizedUid = normalizeText(uid);
  if (!normalizedUid) return;

  const normalizedRole = normalizeRole(role);
  const normalizedOrgId = normalizeOrganizationId(organizationId);
  const currentRecord = await admin.auth().getUser(normalizedUid);
  const existingClaims = currentRecord.customClaims && typeof currentRecord.customClaims === "object"
    ? currentRecord.customClaims
    : {};
  const nextClaims = {
    ...existingClaims,
    role: normalizedRole,
    organizationId: normalizedOrgId,
    claimsVersion: CLAIMS_VERSION
  };
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

async function assertStaff(context, { expectedOrganizationId = "", hostname = "" } = {}) {
  if (!context.auth?.uid) {
    throw new functions.https.HttpsError("unauthenticated", "Sign in required.");
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
    claimsRole: claimPrincipal.role,
    claimsOrg: claimPrincipal.organizationId,
    roleDoc: roleRecord
  });
  const role = mergedPrincipal.role;
  if (!STAFF_ROLES.has(role)) {
    throw new functions.https.HttpsError("permission-denied", "Staff role required.");
  }

  const principalOrg = normalizeOrganizationId(mergedPrincipal.organizationId);
  const tenantOrg = normalizeOrganizationId(hostResolution.organizationId);
  const requestedOrg = normalizeOrganizationId(expectedOrganizationId);
  const bypass = hasCrossOrgPolicyBypass({
    role,
    email: claimPrincipal.email,
    hostType: hostResolution.hostType
  });

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
  return {
    uid: context.auth.uid,
    role,
    organizationId: scopedOrganizationId,
    claimsVersion: claimPrincipal.claimsVersion,
    email: claimPrincipal.email,
    host: requestHost,
    hostType: hostResolution.hostType,
    resolvedHostOrg: tenantOrg
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
  const deletedKeys = new Set();

  if (normalizedQuoteId) {
    const portalSnap = await db
      .collection(PORTAL_COLLECTION)
      .where("quoteId", "==", normalizedQuoteId)
      .get();

    if (!portalSnap.empty) {
      const batch = db.batch();
      portalSnap.docs.forEach((docSnap) => {
        const data = docSnap.data() || {};
        const portalOrganizationId = normalizeOrganizationId(data.organizationId);
        if (normalizedOrganizationId && portalOrganizationId && portalOrganizationId !== normalizedOrganizationId) {
          return;
        }
        deletedKeys.add(docSnap.id);
        batch.delete(docSnap.ref);
      });

      if (deletedKeys.size) {
        await batch.commit();
      }
    }
  }

  const fallbackKey = normalizeText(fallbackPortalKey);
  if (fallbackKey && !deletedKeys.has(fallbackKey)) {
    await db.collection(PORTAL_COLLECTION).doc(fallbackKey).delete();
    deletedKeys.add(fallbackKey);
  }

  return {
    deleted: deletedKeys.size,
    keys: Array.from(deletedKeys)
  };
}

function resolvePortalLink(quote, fallbackPortalLink = "") {
  const provided = normalizeText(fallbackPortalLink);
  if (provided) {
    try {
      return parseUrlOrThrow(provided, "portalLink");
    } catch {
      return provided;
    }
  }
  const portalKey = normalizeText(quote?.portalKey);
  if (!portalKey) return "";
  const appBaseUrl = normalizeText(readConfig("app.base_url", "https://quotepilot.mbmapps.com"));
  if (!appBaseUrl) return "";
  return `${appBaseUrl}?portal=${encodeURIComponent(portalKey)}`;
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

async function sendEmailViaResend({ apiKey, from, to, subject, text, html = "", attachments = [] }) {
  const response = await fetch("https://api.resend.com/emails", {
    method: "POST",
    headers: {
      Authorization: `Bearer ${apiKey}`,
      "Content-Type": "application/json"
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

async function sendCustomerEmail({ toEmail, subject, text, html = "", attachment = null }) {
  const emailConfig = getEmailConfig();
  if (emailConfig.provider === "none") {
    throw new functions.https.HttpsError(
      "failed-precondition",
      "Email provider is disabled. Configure email.provider and credentials."
    );
  }
  if (!EMAIL_PROVIDERS.has(emailConfig.provider)) {
    throw new functions.https.HttpsError(
      "failed-precondition",
      `Unsupported email provider: ${emailConfig.provider}.`
    );
  }
  if (!emailConfig.fromEmail) {
    throw new functions.https.HttpsError("failed-precondition", "Missing email.from_email configuration.");
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
        throw new functions.https.HttpsError("failed-precondition", "Missing resend.api_key configuration.");
      }
      const result = await sendEmailViaResend({
        apiKey: emailConfig.resendApiKey,
        from,
        to,
        subject: normalizeText(subject),
        text: normalizeText(text),
        html,
        attachments: attachment ? [attachment] : []
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
  auditContext = {}
}) {
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
  await getQuoteDocRef(quoteId, organizationId).set(quoteUpdate, { merge: true });

  if (portalKey) {
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
    if (organizationId) {
      portalUpdate.organizationId = organizationId;
    }
    await db.collection(PORTAL_COLLECTION).doc(portalKey).set(
      portalUpdate,
      { merge: true }
    );
  }
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
  if (staff.role !== "admin" && !hasCrossOrgPolicyBypass({ role: staff.role, email: staff.email, hostType: staff.hostType })) {
    throw new functions.https.HttpsError("permission-denied", "Admin role required.");
  }

  const targetUid = normalizeText(data?.uid || context?.auth?.uid);
  if (!targetUid) {
    throw new functions.https.HttpsError("invalid-argument", "uid is required.");
  }

  const targetRole = await getUserRole(targetUid);
  if (
    targetRole.organizationId
    && staff.organizationId
    && targetRole.organizationId !== staff.organizationId
    && !hasCrossOrgPolicyBypass({ role: staff.role, email: staff.email, hostType: staff.hostType })
  ) {
    throw new functions.https.HttpsError("permission-denied", "Target user is outside your organization scope.");
  }

  await syncPrincipalClaims({
    uid: targetUid,
    role: targetRole.role,
    organizationId: targetRole.organizationId
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

  const email = normalizeEmail(context?.auth?.token?.email || data?.email);
  if (!email) {
    throw new functions.https.HttpsError("failed-precondition", "Authenticated account email is required.");
  }

  const organizationName = normalizeText(data?.organizationName);
  const organizationSlug = normalizeText(data?.organizationSlug);
  const bootstrap = await ensureOrganizationBootstrapInternal({
    uid,
    email,
    organizationName,
    organizationSlug
  });

  await syncPrincipalClaims({
    uid,
    role: bootstrap.role,
    organizationId: bootstrap.organizationId
  });

  return {
    ok: true,
    role: bootstrap.role,
    organizationId: bootstrap.organizationId,
    createdOrganization: Boolean(bootstrap.createdOrganization)
  };
});

exports.provisionCustomerOrder = functions.region(REGION).https.onCall(async (data, context) => {
  const staff = await assertStaff(context);
  const actorEmail = normalizeEmail(context?.auth?.token?.email || "");
  const ownerEmail = normalizeEmail(data?.ownerEmail);
  if (!ownerEmail) {
    throw new functions.https.HttpsError("invalid-argument", "ownerEmail is required.");
  }

  const ownerName = normalizeText(data?.ownerName);
  const ownerUid = normalizeText(data?.ownerUid);
  const organizationName = withFallback(data?.organizationName || data?.name, "Organization");
  const organizationId = normalizeOrganizationId(
    data?.organizationId || data?.organizationSlug || slugify(organizationName, "organization")
  );
  if (!organizationId) {
    throw new functions.https.HttpsError("invalid-argument", "organizationId is required.");
  }
  if (
    staff.resolvedHostOrg
    && organizationId !== staff.resolvedHostOrg
    && !hasCrossOrgPolicyBypass({ role: staff.role, email: staff.email, hostType: staff.hostType })
  ) {
    throw new functions.https.HttpsError("permission-denied", "Tenant host can only provision its own organization.");
  }

  const entitlements = resolveFeatureEntitlements(data);
  const appUrl = parseUrlOrThrow(
    normalizeText(data?.appUrl || readConfig("app.base_url", "https://quotepilot.mbmapps.com")),
    "appUrl"
  );
  const supportEmail = normalizeEmail(data?.supportEmail || readConfig("notifications.owner_email"));
  const sendEmail = data?.sendEmail !== false;
  const defaultOrderId = `${organizationId}-${Date.now()}`;
  const orderId = normalizeOrderId(data?.orderId, defaultOrderId) || defaultOrderId;
  const inviteId = inviteDocIdFromEmail(ownerEmail);
  if (!inviteId && !ownerUid) {
    throw new functions.https.HttpsError("invalid-argument", "ownerEmail or ownerUid must resolve to a valid invite id.");
  }

  const nowISO = new Date().toISOString();
  const now = FieldValue.serverTimestamp();
  const orderRef = db.collection(PROVISIONING_ORDERS_COLLECTION).doc(orderId);
  const orgRef = db.collection(ORGANIZATIONS_COLLECTION).doc(organizationId);
  const settingsRef = orgRef.collection("settings").doc("config");
  const neutralSettingsPatch = buildNeutralSettingsPatch({
    organizationName,
    ownerName,
    ownerEmail,
    supportEmail
  });
  const neutralCatalogEntries = await buildNeutralCatalogSeedEntries({
    organizationId,
    nowISO
  });
  const batch = db.batch();

  batch.set(orgRef, {
    name: organizationName,
    slug: slugify(organizationName, organizationId),
    ownerEmail,
    ownerUid: ownerUid || "",
    featureFlagsLocked: true,
    featureFlagsPaid: entitlements.paidFeatureIds,
    orderId,
    updatedAtISO: nowISO,
    updatedAt: now
  }, { merge: true });

  batch.set(settingsRef, {
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
  }, { merge: true });

  neutralCatalogEntries.forEach((entry) => {
    batch.set(entry.ref, entry.data, { merge: true });
  });

  batch.set(orderRef, {
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
      template: "neutral",
      recordsCreated: neutralCatalogEntries.length
    },
    sendEmail,
    requestedBy: {
      uid: staff.uid,
      email: actorEmail
    },
    updatedAtISO: nowISO,
    updatedAt: now,
    createdAt: now
  }, { merge: true });

  if (ownerUid) {
    const roleRef = db.collection(ROLES_COLLECTION).doc(ownerUid);
    batch.set(roleRef, {
      role: "admin",
      email: ownerEmail,
      organizationId,
      updatedAt: now,
      createdAt: now
    }, { merge: true });
  }

  if (inviteId) {
    const inviteRef = db.collection(INVITES_COLLECTION).doc(inviteId);
    if (ownerUid) {
      batch.set(inviteRef, {
        email: ownerEmail,
        ownerName,
        role: "admin",
        organizationId,
        organizationName,
        status: "consumed",
        consumedByUid: ownerUid,
        consumedByEmail: ownerEmail,
        consumedAtISO: nowISO,
        updatedAtISO: nowISO,
        consumedAt: now,
        updatedAt: now
      }, { merge: true });
    } else {
      batch.set(inviteRef, {
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
        createdAtISO: nowISO,
        updatedAtISO: nowISO,
        createdAt: now,
        updatedAt: now
      }, { merge: true });
    }
  }

  await batch.commit();

  if (ownerUid) {
    await syncPrincipalClaims({
      uid: ownerUid,
      role: "admin",
      organizationId
    });
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

  let emailResult = {
    sent: false,
    reason: "send_email_disabled"
  };

  if (sendEmail) {
    try {
      emailResult = await sendCustomerEmail({
        toEmail: ownerEmail,
        subject: emailPayload.subject,
        text: emailPayload.text,
        html: emailPayload.html
      });

      await orderRef.set({
        status: "completed",
        email: {
          ...emailResult,
          toEmail: ownerEmail,
          subject: emailPayload.subject,
          sentAtISO: new Date().toISOString()
        },
        updatedAtISO: new Date().toISOString(),
        updatedAt: FieldValue.serverTimestamp()
      }, { merge: true });
    } catch (err) {
      const errorMessage = normalizeText(err?.message || "Failed to send onboarding email.");
      await orderRef.set({
        status: "provisioned_email_failed",
        email: {
          sent: false,
          toEmail: ownerEmail,
          subject: emailPayload.subject,
          error: errorMessage,
          failedAtISO: new Date().toISOString()
        },
        updatedAtISO: new Date().toISOString(),
        updatedAt: FieldValue.serverTimestamp()
      }, { merge: true });
      emailResult = {
        sent: false,
        error: errorMessage
      };
    }
  } else {
    await orderRef.set({
      status: "completed",
      email: {
        sent: false,
        reason: "send_email_disabled",
        toEmail: ownerEmail,
        subject: emailPayload.subject
      },
      updatedAtISO: new Date().toISOString(),
      updatedAt: FieldValue.serverTimestamp()
    }, { merge: true });
  }

  return {
    ok: true,
    orderId,
    organizationId,
    organizationName,
    ownerEmail,
    plan: entitlements.plan,
    featureFlags: entitlements.featureFlags,
    featureFlagsPaid: entitlements.paidFeatureIds,
    featureFlagsUnpaid: entitlements.unpaidFeatureIds,
    catalogBootstrap: {
      template: "neutral",
      recordsCreated: neutralCatalogEntries.length
    },
    email: emailResult
  };
});

exports.archiveOrganizationWorkspace = functions.region(REGION).https.onCall(async (data, context) => {
  const organizationId = normalizeOrganizationId(data?.organizationId);
  if (!organizationId) {
    throw new functions.https.HttpsError("invalid-argument", "organizationId is required.");
  }

  const staff = await assertStaff(context, { expectedOrganizationId: organizationId });
  if (staff.role !== "admin" && !hasCrossOrgPolicyBypass({ role: staff.role, email: staff.email, hostType: staff.hostType })) {
    throw new functions.https.HttpsError("permission-denied", "Admin role required.");
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

  const staff = await assertStaff(context, { expectedOrganizationId: organizationId });
  if (staff.role !== "admin" && !hasCrossOrgPolicyBypass({ role: staff.role, email: staff.email, hostType: staff.hostType })) {
    throw new functions.https.HttpsError("permission-denied", "Admin role required.");
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
  const tenantDomainsDeleted = await updateTenantDomainMappingsForOrganization({
    organizationId,
    mode: "delete",
    actorUid: staff.uid,
    actorEmail: staff.email,
    nowISO
  });

  await db.recursiveDelete(orgRef);

  return {
    ok: true,
    organizationId,
    tenantDomainsDeleted,
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
  if (staff.role !== "admin" && !hasCrossOrgPolicyBypass({ role: staff.role, email: staff.email, hostType: staff.hostType })) {
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
  if (staff.role !== "admin" && !hasCrossOrgPolicyBypass({ role: staff.role, email: staff.email, hostType: staff.hostType })) {
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

exports.notifyOwnerNewQuote = functions.region(REGION).https.onCall(async (data, context) => {
  const staff = await assertStaff(context);
  const { quoteId, quote, quoteNumber } = await readQuoteOrThrow(data?.quoteId, {
    organizationId: staff.organizationId
  });
  const customerName = normalizeText(quote.customer?.name) || normalizeEmail(quote.customer?.email) || "Unknown customer";
  const eventDate = normalizeText(quote.event?.date) || "date not set";
  const total = currencyLabel(quote.totals?.total);
  const portalLink = normalizeText(data?.portalLink);

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
  const staff = await assertStaff(context);
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
  const portalLink = resolvePortalLink(quote, data?.portalLink);
  const paymentLink = normalizeText(quote?.payment?.depositLink);
  const attachment = normalizeAttachment(data?.attachment);
  const brandName = normalizeText(quote?.quoteMeta?.brandName) || "Catering Team";

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
      <p>Hi ${customerName},</p>
      <p>Your quote <strong>${quoteNumber}</strong> is ready for <strong>${eventName}</strong> on <strong>${eventDate}</strong> at <strong>${venue}</strong>.</p>
      <p>Estimated total: <strong>${total}</strong><br/>Deposit due: <strong>${deposit}</strong></p>
      ${portalLink ? `<p><a href="${portalLink}">Review and accept your quote</a></p>` : ""}
      ${paymentLink ? `<p><a href="${paymentLink}">Open deposit payment link</a></p>` : ""}
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
  const staff = await assertStaff(context);
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

  const paymentLink = parseUrlOrThrow(data?.paymentLink || quote?.payment?.depositLink, "paymentLink");
  const portalLink = resolvePortalLink(quote, data?.portalLink);
  const attachment = normalizeAttachment(data?.attachment);
  const customerName = normalizeText(quote.customer?.name) || "there";
  const eventName = normalizeText(quote.event?.name) || "your event";
  const deposit = currencyLabel(quote.totals?.deposit);
  const brandName = normalizeText(quote?.quoteMeta?.brandName) || "Catering Team";

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
      <p>Hi ${customerName},</p>
      <p>Your quote <strong>${quoteNumber}</strong> for <strong>${eventName}</strong> has been accepted.</p>
      <p>Please submit your deposit payment of <strong>${deposit}</strong>.</p>
      <p><a href="${paymentLink}">Pay deposit now</a></p>
      ${portalLink ? `<p><a href="${portalLink}">Open customer portal</a></p>` : ""}
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
  await assertStaff(context);
  return {
    ok: true,
    status: buildIntegrationSetupStatus()
  };
});

exports.sendIntegrationTestSms = functions.region(REGION).https.onCall(async (data, context) => {
  const staff = await assertStaff(context);
  const actorEmail = normalizeEmail(context?.auth?.token?.email || staff.uid);
  const customMessage = normalizeText(data?.message);
  const message =
    customMessage ||
    `Integration SMS test from Firebase Quote Wizard (${new Date().toISOString()}) sent by ${actorEmail}.`;
  const sms = await sendOwnerSms(message);

  return {
    ok: true,
    sms,
    status: buildIntegrationSetupStatus()
  };
});

exports.createDepositCheckout = functions.region(REGION).https.onCall(async (data, context) => {
  const staff = await assertStaff(context);
  const { quoteId, quote, quoteNumber, organizationId } = await readQuoteOrThrow(data?.quoteId, {
    organizationId: staff.organizationId
  });
  const depositValue = Number(quote?.totals?.deposit || 0);
  const depositCents = Math.round(depositValue * 100);
  if (!Number.isFinite(depositCents) || depositCents <= 0) {
    throw new functions.https.HttpsError("failed-precondition", "Quote deposit must be greater than 0.");
  }

  const quotePortalKey = normalizeText(quote.portalKey);
  const appBaseUrl = readConfig("app.base_url");
  const defaultBase = appBaseUrl || "https://quotepilot.mbmapps.com";
  const defaultSuccess = quotePortalKey
    ? `${defaultBase}?portal=${encodeURIComponent(quotePortalKey)}&payment=success`
    : `${defaultBase}?payment=success`;
  const defaultCancel = quotePortalKey
    ? `${defaultBase}?portal=${encodeURIComponent(quotePortalKey)}&payment=cancelled`
    : `${defaultBase}?payment=cancelled`;

  const successUrl = parseUrlOrThrow(data?.successUrl || defaultSuccess, "successUrl");
  const cancelUrl = parseUrlOrThrow(data?.cancelUrl || defaultCancel, "cancelUrl");

  const stripe = getStripeClient();
  const session = await stripe.checkout.sessions.create({
    mode: "payment",
    success_url: successUrl,
    cancel_url: cancelUrl,
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
  });

  const nowISO = new Date().toISOString();
  await patchPaymentState({
    quoteId,
    organizationId,
    portalKey: quotePortalKey,
    paymentPatch: {
      depositLink: session.url || "",
      depositStatus: "sent",
      depositConfirmedAtISO: "",
      stripeSessionId: session.id,
      lastCheckoutCreatedAtISO: nowISO
    },
    auditContext: {
      host: staff.host,
      eventType: "checkout.session.created",
      organizationId
    }
  });

  const smsResult = await sendOwnerSms(
    `Deposit checkout created for ${quoteNumber}. Deposit ${currencyLabel(depositValue)}.`
  );

  return {
    ok: true,
    quoteId,
    quoteNumber,
    url: session.url || "",
    sessionId: session.id,
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
  if (eventId) {
    const dedupeRef = db.collection(WEBHOOK_EVENTS_COLLECTION).doc(`stripe-${eventId}`);
    const dedupeSnap = await dedupeRef.get();
    if (dedupeSnap.exists) {
      res.json({ received: true, duplicate: true });
      return;
    }
    await dedupeRef.set({
      provider: "stripe",
      eventId,
      eventType: normalizeText(event?.type),
      requestHost,
      requestIp,
      receivedAtISO: new Date().toISOString(),
      createdAt: FieldValue.serverTimestamp()
    }, { merge: false });
  }

  if (event.type === "checkout.session.completed") {
    try {
      const session = event.data.object || {};
      const quoteId = normalizeText(session?.metadata?.quoteId);
      const sessionPortalKey = normalizeText(session?.metadata?.portalKey);
      let organizationId = normalizeOrganizationId(session?.metadata?.organizationId);
      if (!organizationId && sessionPortalKey) {
        const portalSnap = await db.collection(PORTAL_COLLECTION).doc(sessionPortalKey).get();
        organizationId = normalizeOrganizationId(portalSnap.data()?.organizationId);
      }
      if (quoteId) {
        if (!organizationId) {
          functions.logger.warn("checkout.session.completed ignored: missing organizationId", {
            quoteId,
            sessionId: normalizeText(session.id),
            portalKey: sessionPortalKey,
            requestHost
          });
          res.json({ received: true, ignored: "missing_organization_id" });
          return;
        }
        const quoteDetails = await readQuoteOrThrow(quoteId, {
          organizationId
        });
        const quote = quoteDetails.quote || {};
        const quoteNumber = quoteDetails.quoteNumber || quoteId;
        const amountTotal = Number(session.amount_total || 0) / 100;
        await patchPaymentState({
          quoteId,
          organizationId: quoteDetails.organizationId,
          portalKey: normalizeText(quote.portalKey),
          paymentPatch: {
            depositStatus: "paid",
            depositConfirmedAtISO: new Date().toISOString(),
            stripeSessionId: normalizeText(session.id),
            depositLink: normalizeText(session.url) || normalizeText(quote?.payment?.depositLink)
          },
          auditContext: {
            host: requestHost,
            eventType: event.type,
            organizationId: quoteDetails.organizationId
          }
        });
        await sendOwnerSms(`Deposit paid for ${quoteNumber}. Amount ${currencyLabel(amountTotal)}.`);
      }
    } catch (err) {
      functions.logger.error("Failed processing checkout.session.completed", {
        requestHost,
        requestIp,
        message: normalizeText(err?.message).slice(0, 240)
      });
      res.status(500).send("Failed to process checkout session.");
      return;
    }
  }

  res.json({ received: true });
});
