import fs from "node:fs";
import path from "node:path";
import { parseEnv } from "node:util";

const REQUIRED = [
  "VITE_FIREBASE_API_KEY",
  "VITE_FIREBASE_AUTH_DOMAIN",
  "VITE_FIREBASE_PROJECT_ID",
  "VITE_FIREBASE_STORAGE_BUCKET",
  "VITE_FIREBASE_MESSAGING_SENDER_ID",
  "VITE_FIREBASE_APP_ID"
];
const EXPECTED_FIREBASE_PROJECT_ID = "tonicatering";
const PRODUCTION_UNSAFE_FLAGS = [
  "VITE_E2E_BYPASS_AUTH",
  "VITE_USE_FIREBASE_EMULATORS",
  "VITE_ALLOW_LOCAL_CATALOG_FALLBACK",
  "VITE_E2E_ALLOW_NON_AUTHORITATIVE_PRICING",
  "VITE_BUYER_ACCESS_PUBLIC_CTA_ENABLED"
];

const cwd = process.cwd();
const productionEnv = {};
for (const fileName of [
  ".env",
  ".env.local",
  ".env.production",
  ".env.production.local"
]) {
  const filePath = path.resolve(cwd, fileName);
  if (!fs.existsSync(filePath)) continue;
  Object.assign(productionEnv, parseEnv(fs.readFileSync(filePath, "utf8")));
}

function effectiveValue(key) {
  if (Object.prototype.hasOwnProperty.call(process.env, key)) {
    return String(process.env[key] || "").trim();
  }
  return String(productionEnv[key] || "").trim();
}

function isPlaceholder(value) {
  return /^your_/i.test(value)
    || /^replace_/i.test(value)
    || /^<[^>]+>$/.test(value)
    || /^changeme$/i.test(value);
}

function isTruthy(value) {
  return ["1", "true", "yes", "on"].includes(String(value || "").trim().toLowerCase());
}

const missing = REQUIRED.filter((key) => !effectiveValue(key));
const placeholders = REQUIRED.filter((key) => isPlaceholder(effectiveValue(key)));

if (missing.length) {
  console.error("Missing required Firebase env vars:");
  missing.forEach((key) => console.error(`- ${key}`));
  console.error("\nAdd them to .env.local, .env, or host environment settings (Vercel/GitHub Actions).");
  process.exit(1);
}

if (placeholders.length) {
  console.error("Placeholder Firebase env vars are not deployable:");
  placeholders.forEach((key) => console.error(`- ${key}`));
  process.exit(1);
}

const configuredProjectIds = [
  effectiveValue("VITE_FIREBASE_PROJECT_ID"),
  process.env.FIREBASE_PROJECT_ID
]
  .map((value) => String(value || "").trim())
  .filter(Boolean);

if (
  configuredProjectIds.some((projectId) => projectId !== EXPECTED_FIREBASE_PROJECT_ID)
  || effectiveValue("VITE_FIREBASE_PROJECT_ID") !== EXPECTED_FIREBASE_PROJECT_ID
) {
  console.error(
    `Firebase project mismatch. QuotePilot production configuration must target ${EXPECTED_FIREBASE_PROJECT_ID}.`
  );
  process.exit(1);
}

const enabledUnsafeFlags = PRODUCTION_UNSAFE_FLAGS.filter((key) => (
  isTruthy(effectiveValue(key))
));
if (enabledUnsafeFlags.length) {
  console.error("Production-unsafe browser flags must be disabled:");
  enabledUnsafeFlags.forEach((key) => console.error(`- ${key}`));
  process.exit(1);
}

console.log("Firebase env check passed.");
