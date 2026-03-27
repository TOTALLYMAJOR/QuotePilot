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
const STAFF_ROLES = new Set(["admin", "sales"]);
const ROLE_VALUES = new Set(["admin", "sales", "customer"]);
const BOOTSTRAP_ADMIN_EMAILS = new Set([
  "tonitastefultouch@yahoo.com"
]);
const SMS_PROVIDERS = new Set(["twilio", "none"]);
const EMAIL_PROVIDERS = new Set(["resend", "none"]);
const QUOTES_COLLECTION = "quotes";
const PORTAL_COLLECTION = "customerPortalQuotes";

let cachedFunctionsConfig = undefined;
let functionsConfigErrorLogged = false;

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

function slugify(value, fallback = "organization") {
  const raw = normalizeText(value).toLowerCase();
  const slug = raw
    .replace(/[^\w-]+/g, "-")
    .replace(/-{2,}/g, "-")
    .replace(/^-|-$/g, "");
  return slug || fallback;
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
    fromName: normalizeText(readConfig("email.from_name", "Tasteful Touch Catering")),
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

    const bootstrapAdmin = BOOTSTRAP_ADMIN_EMAILS.has(normalizedEmail);
    const existingRole = normalizeRole(roleSnap.data()?.role);
    const role = bootstrapAdmin ? "admin" : existingRole;
    const shouldHaveOrganization = role === "admin" || role === "sales";
    let organizationId = normalizeText(roleSnap.data()?.organizationId);

    if (shouldHaveOrganization && !organizationId) {
      organizationId = db.collection(ORGANIZATIONS_COLLECTION).doc().id;
    }

    let createdOrganization = false;
    if (organizationId) {
      const orgRef = db.collection(ORGANIZATIONS_COLLECTION).doc(organizationId);
      const orgSnap = await tx.get(orgRef);
      if (!orgSnap.exists) {
        const resolvedName = normalizeText(
          organizationName,
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

async function assertStaff(context) {
  if (!context.auth?.uid) {
    throw new functions.https.HttpsError("unauthenticated", "Sign in required.");
  }
  const roleRecord = await getUserRole(context.auth.uid);
  const role = roleRecord.role;
  if (!STAFF_ROLES.has(role)) {
    throw new functions.https.HttpsError("permission-denied", "Staff role required.");
  }
  return {
    uid: context.auth.uid,
    role,
    organizationId: roleRecord.organizationId
  };
}

function getQuoteDocRef(quoteId, organizationId = "") {
  const id = normalizeText(quoteId);
  const orgId = normalizeOrganizationId(organizationId);
  if (orgId) {
    return db.collection(ORGANIZATIONS_COLLECTION).doc(orgId).collection(QUOTES_COLLECTION).doc(id);
  }
  return db.collection(QUOTES_COLLECTION).doc(id);
}

async function readQuoteOrThrow(quoteId, { organizationId = "", allowLegacyGlobalFallback = true } = {}) {
  const id = normalizeText(quoteId);
  if (!id) {
    throw new functions.https.HttpsError("invalid-argument", "quoteId is required.");
  }

  const scopedOrganizationId = normalizeOrganizationId(organizationId);
  if (scopedOrganizationId) {
    const scopedRef = getQuoteDocRef(id, scopedOrganizationId);
    const scopedSnap = await scopedRef.get();
    if (scopedSnap.exists) {
      const quote = scopedSnap.data() || {};
      return {
        quoteId: id,
        quote,
        quoteRef: scopedRef,
        organizationId: scopedOrganizationId,
        quoteNumber: normalizeText(quote.quoteNumber) || id
      };
    }
    if (!allowLegacyGlobalFallback) {
      throw new functions.https.HttpsError("not-found", "Quote not found.");
    }
  }

  const quoteRef = getQuoteDocRef(id, "");
  const quoteSnap = await quoteRef.get();
  if (!quoteSnap.exists) {
    throw new functions.https.HttpsError("not-found", "Quote not found.");
  }
  const quote = quoteSnap.data() || {};
  const quoteOrganizationId = normalizeOrganizationId(quote.organizationId);
  if (scopedOrganizationId && quoteOrganizationId && quoteOrganizationId !== scopedOrganizationId) {
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
  const appBaseUrl = normalizeText(readConfig("app.base_url", "https://tonicatering.web.app"));
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

async function patchPaymentState({ quoteId, organizationId = "", portalKey = "", paymentPatch = {} }) {
  const nowISO = new Date().toISOString();
  const quoteUpdate = { updatedAtISO: nowISO };
  for (const [key, value] of Object.entries(paymentPatch)) {
    quoteUpdate[`payment.${key}`] = value;
  }
  await getQuoteDocRef(quoteId, organizationId).set(quoteUpdate, { merge: true });

  if (portalKey) {
    const portalUpdate = {
      updatedAtISO: nowISO,
      payment: {
        ...paymentPatch
      }
    };
    if (organizationId) {
      portalUpdate.organizationId = organizationId;
    }
    await db.collection(PORTAL_COLLECTION).doc(portalKey).set(
      portalUpdate,
      { merge: true }
    );
  }
}

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

  return {
    ok: true,
    role: bootstrap.role,
    organizationId: bootstrap.organizationId,
    createdOrganization: Boolean(bootstrap.createdOrganization)
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
  const brandName = normalizeText(quote?.quoteMeta?.brandName) || "Tasteful Touch Catering";

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
  const brandName = normalizeText(quote?.quoteMeta?.brandName) || "Tasteful Touch Catering";

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
  const defaultBase = appBaseUrl || "https://tonicatering.web.app";
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
        const quoteDetails = await readQuoteOrThrow(quoteId, {
          organizationId,
          allowLegacyGlobalFallback: true
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
          }
        });
        await sendOwnerSms(`Deposit paid for ${quoteNumber}. Amount ${currencyLabel(amountTotal)}.`);
      }
    } catch (err) {
      functions.logger.error("Failed processing checkout.session.completed", err);
      res.status(500).send("Failed to process checkout session.");
      return;
    }
  }

  res.json({ received: true });
});
