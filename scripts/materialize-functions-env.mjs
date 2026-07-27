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
if (emailFromName !== "QuotePilot by MBMapps") {
  throw new Error("EMAIL_FROM_NAME must use the approved QuotePilot by MBMapps brand.");
}

const emailFromEmail = required("EMAIL_FROM_EMAIL").toLowerCase();
if (emailFromEmail !== "onboarding@quotepilot.mbmapps.com") {
  throw new Error(
    "EMAIL_FROM_EMAIL must use the approved QuotePilot sender identity; enable Resend only after provider and DNS verification."
  );
}

const resendApiKey = optional("RESEND_API_KEY");
if (emailProvider === "resend" && !resendApiKey) {
  throw new Error("RESEND_API_KEY is required when Resend email is enabled.");
}
if (emailProvider === "none" && resendApiKey) {
  throw new Error(
    "RESEND_API_KEY must be unset while NOTIFICATIONS_EMAIL_PROVIDER is none."
  );
}

const smsProvider = optional("NOTIFICATIONS_SMS_PROVIDER", "none").toLowerCase();
if (!["none", "twilio"].includes(smsProvider)) {
  throw new Error("NOTIFICATIONS_SMS_PROVIDER must be none or twilio.");
}

const twilioAccountSid = optional("TWILIO_ACCOUNT_SID");
const twilioAuthToken = optional("TWILIO_AUTH_TOKEN");
const twilioFromNumber = optional("TWILIO_FROM_NUMBER");
const ownerPhone = optional("NOTIFICATIONS_OWNER_PHONE");
if (
  smsProvider === "twilio"
  && (!twilioAccountSid || !twilioAuthToken || !twilioFromNumber || !ownerPhone)
) {
  throw new Error(
    "TWILIO_ACCOUNT_SID, TWILIO_AUTH_TOKEN, TWILIO_FROM_NUMBER, and NOTIFICATIONS_OWNER_PHONE are required when Twilio is enabled."
  );
}
if (
  smsProvider === "none"
  && (twilioAccountSid || twilioAuthToken || twilioFromNumber || ownerPhone)
) {
  throw new Error(
    "Twilio credentials and owner phone must be unset while NOTIFICATIONS_SMS_PROVIDER is none."
  );
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
  ...(emailProvider === "resend" ? { RESEND_API_KEY: resendApiKey } : {}),
  NOTIFICATIONS_SMS_PROVIDER: smsProvider,
  ...(smsProvider === "twilio" ? {
    TWILIO_ACCOUNT_SID: twilioAccountSid,
    TWILIO_AUTH_TOKEN: twilioAuthToken,
    TWILIO_FROM_NUMBER: twilioFromNumber,
    NOTIFICATIONS_OWNER_PHONE: ownerPhone
  } : {}),
  STRIPE_SECRET_KEY: required("STRIPE_SECRET_KEY"),
  STRIPE_WEBHOOK_SECRET: required("STRIPE_WEBHOOK_SECRET")
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
