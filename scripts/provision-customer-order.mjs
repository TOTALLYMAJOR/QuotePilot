#!/usr/bin/env node

import fs from "node:fs";
import path from "node:path";
import process from "node:process";
import { createRequire } from "node:module";

const require = createRequire(import.meta.url);
const {
  FEATURE_FLAG_KEYS,
  FEATURE_FLAG_LABELS,
  FEATURE_PLAN_PRESETS
} = require("../functions/featurePlans.js");

const DEFAULT_APP_URL = "https://quotepilot.mbmapps.com/app";
const VALUE_FLAGS = new Set([
  "--project",
  "--organization",
  "--org",
  "--name",
  "--owner-email",
  "--owner-name",
  "--owner-uid",
  "--plan",
  "--features",
  "--disable-features",
  "--app-url",
  "--support-email",
  "--order-id",
  "--email-out"
]);
const BOOLEAN_FLAGS = new Set(["--dry-run", "--apply", "--help"]);

function cleanText(value) {
  return String(value ?? "").trim();
}

function normalizeEmail(value) {
  return cleanText(value).toLowerCase();
}

function isValidEmail(value) {
  return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(normalizeEmail(value));
}

function normalizeId(value) {
  return cleanText(value)
    .toLowerCase()
    .replace(/[^\w-]+/g, "-")
    .replace(/-{2,}/g, "-")
    .replace(/^-|-$/g, "");
}

function normalizeUrl(value, fieldName) {
  const raw = cleanText(value);
  if (!raw) throw new Error(`${fieldName} is required.`);
  try {
    const parsed = new URL(raw);
    if (!["https:", "http:"].includes(parsed.protocol)) throw new Error("unsupported protocol");
    return parsed.toString();
  } catch {
    throw new Error(`${fieldName} must be a valid HTTP(S) URL.`);
  }
}

function parseList(value) {
  return cleanText(value)
    .split(",")
    .map((item) => item.trim())
    .filter(Boolean);
}

function takeValue(argv, index, flag) {
  const value = argv[index + 1];
  if (value === undefined || cleanText(value).startsWith("--")) {
    throw new Error(`${flag} requires a value.`);
  }
  return cleanText(value);
}

function parseArgs(argv) {
  const values = new Map();
  const booleans = new Set();
  for (let index = 0; index < argv.length; index += 1) {
    const token = cleanText(argv[index]);
    if (VALUE_FLAGS.has(token)) {
      values.set(token, takeValue(argv, index, token));
      index += 1;
      continue;
    }
    if (BOOLEAN_FLAGS.has(token)) {
      booleans.add(token);
      continue;
    }
    throw new Error(`Unknown argument: ${token || "(empty)"}`);
  }
  if (booleans.has("--apply")) {
    throw new Error(
      "Live CLI provisioning is disabled. Use Customer Provisioning (Admin) in /app."
    );
  }

  const organizationInput = values.get("--organization") || values.get("--org") || "";
  const configuredAppUrl = normalizeUrl(process.env.APP_BASE_URL || DEFAULT_APP_URL, "APP_BASE_URL");
  const requestedAppUrl = values.has("--app-url")
    ? normalizeUrl(values.get("--app-url"), "--app-url")
    : configuredAppUrl;
  if (requestedAppUrl !== configuredAppUrl) {
    throw new Error("--app-url must exactly match the canonical APP_BASE_URL.");
  }

  return {
    help: booleans.has("--help"),
    projectId: cleanText(values.get("--project")),
    organizationId: normalizeId(organizationInput),
    organizationName: cleanText(values.get("--name")),
    ownerEmail: normalizeEmail(values.get("--owner-email")),
    ownerName: cleanText(values.get("--owner-name")),
    ownerUid: cleanText(values.get("--owner-uid")),
    plan: cleanText(values.get("--plan")).toLowerCase(),
    features: cleanText(values.get("--features")),
    disableFeatures: cleanText(values.get("--disable-features")),
    appUrl: configuredAppUrl,
    supportEmail: normalizeEmail(values.get("--support-email")),
    orderId: normalizeId(values.get("--order-id")),
    emailOut: cleanText(values.get("--email-out"))
  };
}

function printUsage() {
  console.log("Preview an exact customer provisioning request (no provider writes):");
  console.log(
    "  npm run customer:provision -- --name <orgName> --organization <orgId> --owner-email <email> --plan <starter|growth|enterprise> --order-id <orderId> [options]"
  );
  console.log("");
  console.log("Options:");
  console.log("  --owner-name <name>          Owner name for the draft handoff");
  console.log("  --owner-uid <uid>            Existing Firebase Auth uid to request");
  console.log("  --features <a,b,c|all>       Explicit feature override");
  console.log("  --disable-features <a,b,c>   Explicit feature disables");
  console.log("  --support-email <email>      Tenant support contact");
  console.log("  --app-url <url>              Must exactly match APP_BASE_URL");
  console.log("  --email-out <path>           Create a new draft file; never overwrites");
  console.log("  --project <projectId>        Optional preview label only");
  console.log("  --dry-run                    Accepted for clarity; preview is always read-only");
  console.log("  --apply                      Rejected; use the audited in-app admin workflow");
}

function validateFeatureIds(featureIds, fieldName) {
  const invalid = featureIds.filter((id) => !FEATURE_FLAG_KEYS.includes(id));
  if (invalid.length) {
    throw new Error(
      `${fieldName} contains unknown feature id(s): ${invalid.join(", ")}. Allowed: ${FEATURE_FLAG_KEYS.join(", ")}`
    );
  }
}

function resolveEntitlements({ plan, features, disableFeatures }) {
  if (!FEATURE_PLAN_PRESETS[plan]) {
    throw new Error(`--plan must be one of: ${Object.keys(FEATURE_PLAN_PRESETS).join(", ")}.`);
  }
  const featureFlags = Object.fromEntries(FEATURE_FLAG_KEYS.map((id) => [id, false]));
  FEATURE_PLAN_PRESETS[plan].forEach((id) => {
    featureFlags[id] = true;
  });

  const explicitFeatures = parseList(features);
  if (explicitFeatures.length) {
    if (explicitFeatures.length === 1 && explicitFeatures[0].toLowerCase() === "all") {
      FEATURE_FLAG_KEYS.forEach((id) => {
        featureFlags[id] = true;
      });
    } else {
      validateFeatureIds(explicitFeatures, "--features");
      FEATURE_FLAG_KEYS.forEach((id) => {
        featureFlags[id] = explicitFeatures.includes(id);
      });
    }
  }

  const explicitDisables = parseList(disableFeatures);
  validateFeatureIds(explicitDisables, "--disable-features");
  explicitDisables.forEach((id) => {
    featureFlags[id] = false;
  });
  if (!featureFlags.aiAssist) featureFlags.aiAutopilot = false;

  return {
    enabled: FEATURE_FLAG_KEYS.filter((id) => featureFlags[id]),
    disabled: FEATURE_FLAG_KEYS.filter((id) => !featureFlags[id])
  };
}

function buildDraftHandoff(args, entitlements) {
  const supportLine = args.supportEmail
    ? `Requested tenant support contact: ${args.supportEmail}`
    : "No separate tenant support contact was requested; the owner email will be used.";
  const lines = [
    "PREVIEW ONLY - DO NOT SEND",
    "",
    "This file does not prove that a workspace, role, domain, or email was created.",
    "Complete and verify the request in QuotePilot Customer Provisioning (Admin) before preparing an owner email.",
    "",
    `Organization: ${args.organizationName} (${args.organizationId})`,
    `Owner: ${args.ownerName || "(not supplied)"} <${args.ownerEmail}>`,
    `Requested owner UID: ${args.ownerUid || "(invite by exact email after provisioning)"}`,
    `Plan: ${args.plan}`,
    `Order ID: ${args.orderId}`,
    `Canonical application URL: ${args.appUrl}`,
    supportLine,
    "",
    "Requested enabled modules:",
    ...entitlements.enabled.map((id) => `- ${FEATURE_FLAG_LABELS[id]}`),
    "",
    "Requested disabled modules:",
    ...entitlements.disabled.map((id) => `- ${FEATURE_FLAG_LABELS[id]}`),
    "",
    "Required owner onboarding after provisioning:",
    "- Create one specifically named package with a positive price.",
    "- Create at least one event type.",
    "- Review and explicitly approve all pricing settings.",
    "- Save and reopen a quote before testing its customer acceptance link."
  ];
  return {
    subject: `[DRAFT - DO NOT SEND] Provisioning preview: ${args.organizationName}`,
    body: lines.join("\n")
  };
}

function validateRequiredArgs(args) {
  const missing = [];
  if (!args.organizationName) missing.push("--name");
  if (!args.organizationId) missing.push("--organization");
  if (!args.ownerEmail) missing.push("--owner-email");
  if (!args.plan) missing.push("--plan");
  if (!args.orderId) missing.push("--order-id");
  if (missing.length) throw new Error(`Missing required argument(s): ${missing.join(", ")}.`);
  if (!isValidEmail(args.ownerEmail)) throw new Error("--owner-email must be a valid email address.");
  if (args.supportEmail && !isValidEmail(args.supportEmail)) {
    throw new Error("--support-email must be a valid email address.");
  }
}

function writeDraftCreateOnly(outputPath, content) {
  const resolvedPath = path.resolve(process.cwd(), outputPath);
  fs.mkdirSync(path.dirname(resolvedPath), { recursive: true });
  try {
    fs.writeFileSync(resolvedPath, content, { encoding: "utf8", flag: "wx" });
  } catch (error) {
    if (error?.code === "EEXIST") {
      throw new Error(`Refusing to overwrite existing draft: ${resolvedPath}`);
    }
    throw error;
  }
  return resolvedPath;
}

function main() {
  const args = parseArgs(process.argv.slice(2));
  if (args.help) {
    printUsage();
    return;
  }
  validateRequiredArgs(args);
  const entitlements = resolveEntitlements(args);
  const draft = buildDraftHandoff(args, entitlements);
  const output = `Subject: ${draft.subject}\n\n${draft.body}\n`;

  console.log("Provisioning preview complete. No provider or Firebase writes were attempted.");
  if (args.projectId) console.log(`Project label: ${args.projectId}`);
  if (args.emailOut) {
    console.log(`Draft created: ${writeDraftCreateOnly(args.emailOut, output)}`);
  }
  console.log("");
  console.log("----- DRAFT HANDOFF START -----");
  console.log(output.trimEnd());
  console.log("----- DRAFT HANDOFF END -----");
}

try {
  main();
} catch (error) {
  console.error("Provisioning preview failed:", error?.message || error);
  process.exitCode = 1;
}
