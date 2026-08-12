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
if (emailFromEmail !== "quotepilot@leaguepilot.us") {
  throw new Error(
    "EMAIL_FROM_EMAIL must use the approved QuotePilot sender identity; enable Resend only after provider and DNS verification."
  );
}

const smsProvider = optional("NOTIFICATIONS_SMS_PROVIDER", "none").toLowerCase();
if (!["none", "twilio"].includes(smsProvider)) {
  throw new Error("NOTIFICATIONS_SMS_PROVIDER must be none or twilio.");
}

const twilioAccountSid = optional("TWILIO_ACCOUNT_SID");
const twilioMessagingServiceSid = optional("TWILIO_MESSAGING_SERVICE_SID");
const ownerPhone = optional("NOTIFICATIONS_OWNER_PHONE");
if (
  smsProvider === "twilio"
  && (!twilioAccountSid || !twilioMessagingServiceSid || !ownerPhone)
) {
  throw new Error(
    "TWILIO_ACCOUNT_SID, TWILIO_MESSAGING_SERVICE_SID, and NOTIFICATIONS_OWNER_PHONE are required when Twilio is enabled. Store TWILIO_AUTH_TOKEN in Firebase Secret Manager."
  );
}
if (
  smsProvider === "none"
  && (twilioAccountSid || twilioMessagingServiceSid || ownerPhone)
) {
  throw new Error(
    "Twilio credentials and owner phone must be unset while NOTIFICATIONS_SMS_PROVIDER is none."
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

const operationalStaffingAuthorityEnabled = optional(
  "OPERATIONAL_STAFFING_AUTHORITY_ENABLED",
  "false"
).toLowerCase();
if (!["true", "false"].includes(operationalStaffingAuthorityEnabled)) {
  throw new Error("OPERATIONAL_STAFFING_AUTHORITY_ENABLED must be true or false.");
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
for (const secretName of [
  "RESEND_API_KEY",
  "RESEND_WEBHOOK_SECRET",
  "TWILIO_AUTH_TOKEN",
  "STRIPE_SECRET_KEY",
  "STRIPE_WEBHOOK_SECRET",
  "REVENUE_AUTOPILOT_TOKEN_SECRET",
  "BUYER_ACCESS_STRIPE_SECRET_KEY",
  "BUYER_ACCESS_STRIPE_WEBHOOK_SECRET",
  "BUYER_ACCESS_TURNSTILE_SECRET",
  "BUYER_ACCESS_RATE_LIMIT_SECRET"
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
    NOTIFICATIONS_OWNER_PHONE: ownerPhone
  } : {}),
  STRIPE_MODE: stripeMode,
  COMMERCIAL_CHANGE_AUTHORITY_ENABLED: commercialChangeAuthorityEnabled,
  OPERATIONAL_STAFFING_AUTHORITY_ENABLED: operationalStaffingAuthorityEnabled,
  REVENUE_AUTOPILOT_ENABLED: revenueAutopilotEnabled,
  REVENUE_AUTOPILOT_SENDS_ENABLED: revenueAutopilotSendsEnabled,
  BUYER_ACCESS_ENABLED: buyerAccessEnabled,
  BUYER_ACCESS_STRIPE_MODE: buyerAccessStripeMode,
  BUYER_ACCESS_APP_BASE_URL: buyerAccessAppBaseUrl,
  ...(normalizedBuyerAccessTurnstileHostnames
    ? { BUYER_ACCESS_TURNSTILE_HOSTNAMES: normalizedBuyerAccessTurnstileHostnames }
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
