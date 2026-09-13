#!/usr/bin/env node

import fs from "node:fs";
import path from "node:path";

function readArg(name) {
  const index = process.argv.indexOf(name);
  return index >= 0 ? String(process.argv[index + 1] || "").trim() : "";
}

const validateOnly = process.argv.includes("--validate-only");
const replaceRequested = process.argv.includes("--replace");

const projectId = String(
  process.env.FIREBASE_PROJECT_ID
    || process.env.VITE_FIREBASE_PROJECT_ID
    || ""
).trim();

if (!/^[a-z0-9][a-z0-9-]{4,28}[a-z0-9]$/.test(projectId)) {
  throw new Error("FIREBASE_PROJECT_ID must be an explicit valid Firebase project id.");
}
if (projectId !== "tonicatering") {
  throw new Error("Firebase Functions deployment environment must target tonicatering.");
}

const required = (name) => {
  const value = String(process.env[name] || "").trim();
  if (!value) {
    throw new Error(`${name} is required when deploying Firebase Functions.`);
  }
  return value;
};

const optional = (name, fallback = "") => String(process.env[name] || fallback).trim();
const E164_PHONE_PATTERN = /^\+[1-9]\d{7,14}$/;
const SMS_CONFIGURATION_GENERATION_PATTERN = /^[a-z0-9][a-z0-9._-]{2,63}$/;
const PINGRAM_API_ORIGINS = new Set([
  "https://api.pingram.io",
  "https://api.ca.pingram.io",
  "https://api.eu.pingram.io"
]);
const assertSingleLine = (name, value) => {
  if (/[\r\n]/.test(value)) {
    throw new Error(`${name} must be a single-line value.`);
  }
  return value;
};
const assertEmailList = (name, value) => {
  const emails = value
    .split(",")
    .map((item) => item.trim().toLowerCase())
    .filter(Boolean);
  if (!emails.length || emails.some((email) => !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email))) {
    throw new Error(`${name} must contain one or more comma-separated email addresses.`);
  }
  if (emails.some((email) => email.endsWith("@example.com") || email.endsWith("@example.test"))) {
    throw new Error(`${name} cannot contain placeholder email addresses.`);
  }
  return [...new Set(emails)].join(",");
};
const BUYER_ACCESS_APPROVED_TURNSTILE_HOSTNAMES = [
  "quotepilot.mbmapps.com",
  "tonicatering.web.app"
];
const INQUIRY_APPROVED_TURNSTILE_HOSTNAMES = [
  "quotepilot.mbmapps.com",
  "tonicatering.web.app"
];
const assertBuyerAccessTurnstileHostnames = (value) => {
  const hostnames = value
    .split(",")
    .map((item) => item.trim().toLowerCase())
    .filter(Boolean);
  const approved = new Set(BUYER_ACCESS_APPROVED_TURNSTILE_HOSTNAMES);

  if (
    !hostnames.length
    || hostnames.some((hostname) => !/^[a-z0-9.-]+$/.test(hostname))
    || hostnames.some((hostname) => !approved.has(hostname))
    || BUYER_ACCESS_APPROVED_TURNSTILE_HOSTNAMES.some(
      (hostname) => !hostnames.includes(hostname)
    )
  ) {
    throw new Error(
      "BUYER_ACCESS_TURNSTILE_HOSTNAMES must contain only the exact approved QuotePilot production hosts: quotepilot.mbmapps.com,tonicatering.web.app."
    );
  }

  return [...new Set(hostnames)].join(",");
};
const assertInquiryTurnstileHostnames = (value) => {
  const hostnames = value
    .split(",")
    .map((item) => item.trim().toLowerCase())
    .filter(Boolean);
  const approved = new Set(INQUIRY_APPROVED_TURNSTILE_HOSTNAMES);

  if (
    !hostnames.length
    || hostnames.some((hostname) => !/^[a-z0-9.-]+$/.test(hostname))
    || hostnames.some((hostname) => !approved.has(hostname))
    || INQUIRY_APPROVED_TURNSTILE_HOSTNAMES.some(
      (hostname) => !hostnames.includes(hostname)
    )
  ) {
    throw new Error(
      "INQUIRY_TURNSTILE_HOSTNAMES must contain only the exact approved QuotePilot production hosts: quotepilot.mbmapps.com,tonicatering.web.app."
    );
  }

  return [...new Set(hostnames)].join(",");
};

const appBaseUrl = required("APP_BASE_URL");
if (appBaseUrl !== "https://quotepilot.mbmapps.com/app") {
  throw new Error("APP_BASE_URL must be the canonical QuotePilot application URL.");
}

const appBaseDomain = required("APP_BASE_DOMAIN").toLowerCase();
if (appBaseDomain !== "mbmapps.com") {
  throw new Error("APP_BASE_DOMAIN must be mbmapps.com.");
}

const emailProvider = optional("NOTIFICATIONS_EMAIL_PROVIDER", "none").toLowerCase();
if (!["none", "resend"].includes(emailProvider)) {
  throw new Error("NOTIFICATIONS_EMAIL_PROVIDER must be none or resend.");
}

const emailFromName = required("EMAIL_FROM_NAME");
if (emailFromName !== "QuotePilot by MBMApps") {
  throw new Error("EMAIL_FROM_NAME must use the approved QuotePilot by MBMApps brand.");
}

const emailFromEmail = required("EMAIL_FROM_EMAIL").toLowerCase();
if (emailFromEmail !== "quotepilot@quietpilot.us") {
  throw new Error(
    "EMAIL_FROM_EMAIL must use the approved QuotePilot sender identity; enable Resend only after provider and DNS verification."
  );
}

const smsProvider = optional("NOTIFICATIONS_SMS_PROVIDER", "none").toLowerCase();
if (!["none", "twilio", "pingram"].includes(smsProvider)) {
  throw new Error("NOTIFICATIONS_SMS_PROVIDER must be none, twilio, or pingram.");
}

const twilioAccountSid = optional("TWILIO_ACCOUNT_SID");
const twilioMessagingServiceSid = optional("TWILIO_MESSAGING_SERVICE_SID");
const pingramApiOrigin = optional("PINGRAM_API_ORIGIN");
const pingramFromNumber = optional("PINGRAM_FROM_NUMBER");
const pingramConfigurationGeneration = optional(
  "PINGRAM_CONFIGURATION_GENERATION"
).toLowerCase();
const ownerPhone = optional("NOTIFICATIONS_OWNER_PHONE");
const ownerSmsConsent = optional("NOTIFICATIONS_OWNER_SMS_CONSENT").toLowerCase();
if (ownerPhone && !E164_PHONE_PATTERN.test(ownerPhone)) {
  throw new Error("NOTIFICATIONS_OWNER_PHONE must use E.164 format.");
}
if (pingramFromNumber && !E164_PHONE_PATTERN.test(pingramFromNumber)) {
  throw new Error("PINGRAM_FROM_NUMBER must use E.164 format.");
}
if (pingramApiOrigin && !PINGRAM_API_ORIGINS.has(pingramApiOrigin)) {
  throw new Error(
    "PINGRAM_API_ORIGIN must be an exact approved Pingram HTTPS API origin."
  );
}
if (
  pingramConfigurationGeneration
  && !SMS_CONFIGURATION_GENERATION_PATTERN.test(pingramConfigurationGeneration)
) {
  throw new Error(
    "PINGRAM_CONFIGURATION_GENERATION must be a 3-64 character lowercase deployment generation."
  );
}
if (smsProvider !== "none" && ownerSmsConsent !== "granted") {
  throw new Error(
    "NOTIFICATIONS_OWNER_SMS_CONSENT=granted is required before SMS can be enabled."
  );
}
if (
  smsProvider === "twilio"
  && (!twilioAccountSid || !twilioMessagingServiceSid || !ownerPhone)
) {
  throw new Error(
    "TWILIO_ACCOUNT_SID, TWILIO_MESSAGING_SERVICE_SID, and NOTIFICATIONS_OWNER_PHONE are required when Twilio is enabled. Store TWILIO_AUTH_TOKEN and SMS_CONTACT_DIGEST_SECRET in Firebase Secret Manager."
  );
}
if (
  smsProvider === "pingram"
  && (
    !pingramApiOrigin
    || !pingramFromNumber
    || !pingramConfigurationGeneration
    || !ownerPhone
  )
) {
  throw new Error(
    "PINGRAM_API_ORIGIN, PINGRAM_FROM_NUMBER, PINGRAM_CONFIGURATION_GENERATION, and NOTIFICATIONS_OWNER_PHONE are required when Pingram is enabled. Store PINGRAM_API_KEY, PINGRAM_WEBHOOK_SECRET, and SMS_CONTACT_DIGEST_SECRET in Firebase Secret Manager."
  );
}
if (smsProvider !== "twilio" && (twilioAccountSid || twilioMessagingServiceSid)) {
  throw new Error(
    "Twilio configuration must be unset unless NOTIFICATIONS_SMS_PROVIDER is twilio."
  );
}
if (
  smsProvider !== "pingram"
  && (pingramApiOrigin || pingramFromNumber || pingramConfigurationGeneration)
) {
  throw new Error(
    "Pingram configuration must be unset unless NOTIFICATIONS_SMS_PROVIDER is pingram."
  );
}
if (smsProvider === "none" && (ownerPhone || ownerSmsConsent)) {
  throw new Error(
    "Owner SMS destination and consent must be unset while NOTIFICATIONS_SMS_PROVIDER is none."
  );
}

const stripeMode = required("STRIPE_MODE").toLowerCase();
if (stripeMode !== "live") {
  throw new Error("Production Firebase Functions deployment requires STRIPE_MODE=live.");
}

const commercialChangeAuthorityEnabled = optional(
  "COMMERCIAL_CHANGE_AUTHORITY_ENABLED",
  "false"
).toLowerCase();
if (!["true", "false"].includes(commercialChangeAuthorityEnabled)) {
  throw new Error("COMMERCIAL_CHANGE_AUTHORITY_ENABLED must be true or false.");
}

const tenantWorkflowOrganizationId = optional("TENANT_WORKFLOW_ORGANIZATION_ID", "");
if (tenantWorkflowOrganizationId && tenantWorkflowOrganizationId !== "mm05366-sandbox") {
  throw new Error("TENANT_WORKFLOW_ORGANIZATION_ID must be the approved RagnaKoK organization.");
}
const eventOperatingSpineEnabled = optional(
  "EVENT_OPERATING_SPINE_ENABLED",
  "false"
).toLowerCase();
if (!["true", "false"].includes(eventOperatingSpineEnabled)) {
  throw new Error("EVENT_OPERATING_SPINE_ENABLED must be true or false.");
}
if (commercialChangeAuthorityEnabled !== eventOperatingSpineEnabled) {
  throw new Error("Commercial Change and Event Operating Spine production authority must be enabled or disabled together.");
}
if (
  commercialChangeAuthorityEnabled === "true"
  && tenantWorkflowOrganizationId !== "mm05366-sandbox"
) {
  throw new Error("Commercial Change and Event Operating Spine production authority requires the exact RagnaKoK organization fence.");
}

const operationalStaffingAuthorityEnabled = optional(
  "OPERATIONAL_STAFFING_AUTHORITY_ENABLED",
  "false"
).toLowerCase();
if (!["true", "false"].includes(operationalStaffingAuthorityEnabled)) {
  throw new Error("OPERATIONAL_STAFFING_AUTHORITY_ENABLED must be true or false.");
}

const inventoryAuthorityEnabled = optional(
  "INVENTORY_AUTHORITY_ENABLED",
  "false"
).toLowerCase();
if (!["true", "false"].includes(inventoryAuthorityEnabled)) {
  throw new Error("INVENTORY_AUTHORITY_ENABLED must be true or false.");
}
if (
  eventOperatingSpineEnabled === "true"
  && (
    operationalStaffingAuthorityEnabled !== "true"
    || inventoryAuthorityEnabled !== "true"
  )
) {
  throw new Error("The RagnaKoK Event Operating Spine profile requires Staffing and Inventory server authority.");
}

const revenueAutopilotEnabled = optional(
  "REVENUE_AUTOPILOT_ENABLED",
  "false"
).toLowerCase();
const revenueAutopilotSendsEnabled = optional(
  "REVENUE_AUTOPILOT_SENDS_ENABLED",
  "false"
).toLowerCase();
if (!["true", "false"].includes(revenueAutopilotEnabled)) {
  throw new Error("REVENUE_AUTOPILOT_ENABLED must be true or false.");
}
if (!["true", "false"].includes(revenueAutopilotSendsEnabled)) {
  throw new Error("REVENUE_AUTOPILOT_SENDS_ENABLED must be true or false.");
}
if (revenueAutopilotSendsEnabled === "true" && revenueAutopilotEnabled !== "true") {
  throw new Error(
    "REVENUE_AUTOPILOT_SENDS_ENABLED cannot be true while REVENUE_AUTOPILOT_ENABLED is false."
  );
}
if (revenueAutopilotSendsEnabled === "true" && emailProvider !== "resend") {
  throw new Error(
    "Revenue Autopilot sends require NOTIFICATIONS_EMAIL_PROVIDER=resend and its separately bound Secret Manager credential."
  );
}

const buyerAccessEnabled = optional("BUYER_ACCESS_ENABLED", "false").toLowerCase();
if (!["true", "false"].includes(buyerAccessEnabled)) {
  throw new Error("BUYER_ACCESS_ENABLED must be true or false.");
}
const buyerAccessStripeMode = optional("BUYER_ACCESS_STRIPE_MODE", "test").toLowerCase();
if (buyerAccessStripeMode !== "test") {
  throw new Error("BUYER_ACCESS_STRIPE_MODE must remain test for the buyer invoice rail.");
}
const buyerAccessAppBaseUrl = optional(
  "BUYER_ACCESS_APP_BASE_URL",
  "https://quotepilot.mbmapps.com/app"
);
if (buyerAccessAppBaseUrl !== "https://quotepilot.mbmapps.com/app") {
  throw new Error("BUYER_ACCESS_APP_BASE_URL must be the canonical QuotePilot application URL.");
}
if (optional("BUYER_ACCESS_ALLOWED_EMAILS")) {
  throw new Error(
    "BUYER_ACCESS_ALLOWED_EMAILS is obsolete; public buyer access must be protected by Turnstile, rate limits, Stripe invoice state, and verified activation."
  );
}
const buyerAccessTurnstileHostnames = optional("BUYER_ACCESS_TURNSTILE_HOSTNAMES");
if (buyerAccessEnabled === "true" && !buyerAccessTurnstileHostnames) {
  throw new Error(
    "BUYER_ACCESS_TURNSTILE_HOSTNAMES is required while public buyer access is enabled."
  );
}
const normalizedBuyerAccessTurnstileHostnames = buyerAccessTurnstileHostnames
  ? assertBuyerAccessTurnstileHostnames(buyerAccessTurnstileHostnames)
  : "";
const inquiryShowcaseEnabled = optional("INQUIRY_SHOWCASE_ENABLED", "false").toLowerCase();
if (!["true", "false"].includes(inquiryShowcaseEnabled)) {
  throw new Error("INQUIRY_SHOWCASE_ENABLED must be true or false.");
}
const inquiryTurnstileHostnames = optional("INQUIRY_TURNSTILE_HOSTNAMES");
if (inquiryTurnstileHostnames && inquiryShowcaseEnabled !== "true") {
  throw new Error(
    "INQUIRY_TURNSTILE_HOSTNAMES is allowed only while INQUIRY_SHOWCASE_ENABLED=true."
  );
}
if (inquiryShowcaseEnabled === "true" && !inquiryTurnstileHostnames) {
  throw new Error(
    "INQUIRY_TURNSTILE_HOSTNAMES is required while the Inquiry Showcase is enabled."
  );
}
if (
  inquiryShowcaseEnabled === "true"
  && tenantWorkflowOrganizationId !== "mm05366-sandbox"
) {
  throw new Error(
    "Production Inquiry Showcase activation requires TENANT_WORKFLOW_ORGANIZATION_ID=mm05366-sandbox."
  );
}
const normalizedInquiryTurnstileHostnames = inquiryTurnstileHostnames
  ? assertInquiryTurnstileHostnames(inquiryTurnstileHostnames)
  : "";
const intentParserEnabled = optional("INTENT_PARSER_ENABLED", "false").toLowerCase();
const intentParserProvider = optional("INTENT_PARSER_PROVIDER", "none").toLowerCase();
const intentParserModel = optional("INTENT_PARSER_MODEL");
const intentParserOrganizationId = optional("INTENT_PARSER_ORGANIZATION_ID");
if (!["true", "false"].includes(intentParserEnabled)) {
  throw new Error("INTENT_PARSER_ENABLED must be true or false.");
}
if (intentParserEnabled === "true") {
  if (
    intentParserProvider !== "openai"
    || intentParserModel !== "gpt-5-mini"
    || intentParserOrganizationId !== "mm05366-sandbox"
    || tenantWorkflowOrganizationId !== "mm05366-sandbox"
    || inquiryShowcaseEnabled !== "true"
  ) {
    throw new Error(
      "Production Model Assist activation requires Inquiry Showcase plus the exact openai/gpt-5-mini/mm05366-sandbox profile."
    );
  }
} else if (
  intentParserProvider !== "none"
  || intentParserModel
  || intentParserOrganizationId
) {
  throw new Error(
    "INTENT_PARSER_PROVIDER, INTENT_PARSER_MODEL, and INTENT_PARSER_ORGANIZATION_ID must remain inert while INTENT_PARSER_ENABLED=false."
  );
}
for (const secretName of [
  "RESEND_API_KEY",
  "RESEND_WEBHOOK_SECRET",
  "TWILIO_AUTH_TOKEN",
  "PINGRAM_API_KEY",
  "PINGRAM_WEBHOOK_SECRET",
  "SMS_CONTACT_DIGEST_SECRET",
  "STRIPE_SECRET_KEY",
  "STRIPE_WEBHOOK_SECRET",
  "REVENUE_AUTOPILOT_TOKEN_SECRET",
  "STAFF_INVITATION_TOKEN_SECRET",
  "BUYER_ACCESS_STRIPE_SECRET_KEY",
  "BUYER_ACCESS_STRIPE_WEBHOOK_SECRET",
  "BUYER_ACCESS_TURNSTILE_SECRET",
  "BUYER_ACCESS_RATE_LIMIT_SECRET",
  "INQUIRY_TURNSTILE_SECRET",
  "INQUIRY_RATE_LIMIT_SECRET",
  "INTENT_PARSER_OPENAI_KEY",
  "INTENT_PARSER_ANTHROPIC_KEY"
]) {
  if (optional(secretName)) {
    throw new Error(
      `${secretName} must be stored in Firebase Secret Manager, not the Functions dotenv file.`
    );
  }
}

const values = {
  APP_BASE_URL: appBaseUrl,
  APP_BASE_DOMAIN: appBaseDomain,
  AUTH_PLATFORM_ADMIN_EMAILS: assertEmailList(
    "AUTH_PLATFORM_ADMIN_EMAILS",
    required("AUTH_PLATFORM_ADMIN_EMAILS")
  ),
  NOTIFICATIONS_EMAIL_PROVIDER: emailProvider,
  EMAIL_FROM_NAME: emailFromName,
  EMAIL_FROM_EMAIL: emailFromEmail,
  NOTIFICATIONS_SMS_PROVIDER: smsProvider,
  ...(smsProvider === "twilio" ? {
    TWILIO_ACCOUNT_SID: twilioAccountSid,
    TWILIO_MESSAGING_SERVICE_SID: twilioMessagingServiceSid,
    NOTIFICATIONS_OWNER_PHONE: ownerPhone,
    NOTIFICATIONS_OWNER_SMS_CONSENT: ownerSmsConsent
  } : {}),
  ...(smsProvider === "pingram" ? {
    PINGRAM_API_ORIGIN: pingramApiOrigin,
    PINGRAM_FROM_NUMBER: pingramFromNumber,
    PINGRAM_CONFIGURATION_GENERATION: pingramConfigurationGeneration,
    NOTIFICATIONS_OWNER_PHONE: ownerPhone,
    NOTIFICATIONS_OWNER_SMS_CONSENT: ownerSmsConsent
  } : {}),
  STRIPE_MODE: stripeMode,
  COMMERCIAL_CHANGE_AUTHORITY_ENABLED: commercialChangeAuthorityEnabled,
  EVENT_OPERATING_SPINE_ENABLED: eventOperatingSpineEnabled,
  ...(tenantWorkflowOrganizationId ? { TENANT_WORKFLOW_ORGANIZATION_ID: tenantWorkflowOrganizationId } : {}),
  OPERATIONAL_STAFFING_AUTHORITY_ENABLED: operationalStaffingAuthorityEnabled,
  INVENTORY_AUTHORITY_ENABLED: inventoryAuthorityEnabled,
  REVENUE_AUTOPILOT_ENABLED: revenueAutopilotEnabled,
  REVENUE_AUTOPILOT_SENDS_ENABLED: revenueAutopilotSendsEnabled,
  BUYER_ACCESS_ENABLED: buyerAccessEnabled,
  BUYER_ACCESS_STRIPE_MODE: buyerAccessStripeMode,
  BUYER_ACCESS_APP_BASE_URL: buyerAccessAppBaseUrl,
  ...(normalizedBuyerAccessTurnstileHostnames
    ? { BUYER_ACCESS_TURNSTILE_HOSTNAMES: normalizedBuyerAccessTurnstileHostnames }
    : {}),
  INQUIRY_SHOWCASE_ENABLED: inquiryShowcaseEnabled,
  ...(normalizedInquiryTurnstileHostnames
    ? { INQUIRY_TURNSTILE_HOSTNAMES: normalizedInquiryTurnstileHostnames }
    : {}),
  INTENT_PARSER_ENABLED: intentParserEnabled,
  INTENT_PARSER_PROVIDER: intentParserProvider,
  INTENT_PARSER_MODEL: intentParserModel,
  ...(intentParserOrganizationId
    ? { INTENT_PARSER_ORGANIZATION_ID: intentParserOrganizationId }
    : {})
};

const lines = [
  "# Generated during deployment. Do not commit.",
  ...Object.entries(values).map(([name, value]) => (
    `${name}=${assertSingleLine(name, value)}`
  )),
  ""
];
const outputPath = path.resolve(process.cwd(), "functions", `.env.${projectId}`);
const outputLabel = `functions/.env.${projectId}`;
const expectedConfirmation = `REPLACE ${outputLabel} FOR ${projectId}`;

if (validateOnly) {
  console.log(`Firebase Functions environment validated for project ${projectId}.`);
  process.exit(0);
}

if (fs.existsSync(outputPath)) {
  if (!replaceRequested) {
    throw new Error(
      `${outputLabel} already exists. Refusing to overwrite it; validate the existing file or use an explicit replacement confirmation.`
    );
  }
  if (readArg("--confirm") !== expectedConfirmation) {
    throw new Error(`Replacing ${outputLabel} requires --confirm "${expectedConfirmation}".`);
  }
}

fs.writeFileSync(outputPath, lines.join("\n"), {
  encoding: "utf8",
  mode: 0o600,
  flag: replaceRequested ? "w" : "wx"
});
fs.chmodSync(outputPath, 0o600);

console.log(`Firebase Functions environment materialized for project ${projectId}.`);
