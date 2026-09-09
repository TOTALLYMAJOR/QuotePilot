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
const PRODUCTION_FIREBASE_PROJECT_ID = "tonicatering";
const RELEASE_CANDIDATE_BUILD_PROFILE = "release-candidate";
const RELEASE_CANDIDATE_FIREBASE = Object.freeze({
  VITE_FIREBASE_AUTH_DOMAIN: "quotepilot-staging-20260804.firebaseapp.com",
  VITE_FIREBASE_PROJECT_ID: "quotepilot-staging-20260804",
  VITE_FIREBASE_STORAGE_BUCKET: "quotepilot-staging-20260804.firebasestorage.app",
  VITE_FIREBASE_MESSAGING_SENDER_ID: "844470813106",
  VITE_FIREBASE_APP_ID: "1:844470813106:web:1b2137f26676ef780ca4ab",
  VITE_APP_URL: "https://quotepilot-staging-20260804.web.app/app",
  VITE_APP_HOST: "quotepilot-staging-20260804.web.app"
});
const RELEASE_CANDIDATE_ENABLED_FLAGS = Object.freeze([
  "VITE_CUSTOMER_CENTERED_WORKSPACE_ENABLED",
  "VITE_PILOT_NOW_ENABLED",
  "VITE_PILOT_EVENT_ROOM_ENABLED",
  "VITE_PILOT_GUIDED_SELLING_ENABLED",
  "VITE_PILOT_CREATE_ENABLED",
  "VITE_PILOT_CHANGE_REQUESTS_ENABLED",
  "VITE_PILOT_COMMAND_ENABLED",
  "VITE_PILOT_MARGINS_ENABLED",
  "VITE_PILOT_DECISION_ROOM_ENABLED",
  "VITE_AMBIENT_UI_ENABLED",
  "VITE_OPERATIONAL_STAFFING_ENABLED",
  "VITE_INVENTORY_AUTHORITY_ENABLED"
]);
const PRODUCTION_UNSAFE_FLAGS = [
  "VITE_E2E_BYPASS_AUTH",
  "VITE_USE_FIREBASE_EMULATORS",
  "VITE_ALLOW_LOCAL_CATALOG_FALLBACK",
  "VITE_E2E_ALLOW_NON_AUTHORITATIVE_PRICING"
];
const RELEASE_CANDIDATE_DISABLED_FLAGS = Object.freeze([
  "VITE_PILOT_MEMORY_ENABLED",
  "VITE_PILOT_MODEL_ENABLED",
  "VITE_BUYER_ACCESS_ENABLED",
  "VITE_BUYER_ACCESS_PUBLIC_CTA_ENABLED",
  ...PRODUCTION_UNSAFE_FLAGS
]);
const BUYER_ACCESS_ROUTE_FLAG = "VITE_BUYER_ACCESS_ENABLED";
const BUYER_ACCESS_CTA_FLAG = "VITE_BUYER_ACCESS_PUBLIC_CTA_ENABLED";
const BUYER_ACCESS_TURNSTILE_SITE_KEY = "VITE_BUYER_ACCESS_TURNSTILE_SITE_KEY";
const FORBIDDEN_BROWSER_PROVIDER_VALUES = Object.freeze([
  "VITE_BUYER_ACCESS_TURNSTILE_SECRET",
  "VITE_PINGRAM_API_KEY",
  "VITE_PINGRAM_WEBHOOK_SECRET",
  "VITE_SMS_CONTACT_DIGEST_SECRET",
  "VITE_PINGRAM_FROM_NUMBER",
  "VITE_NOTIFICATIONS_OWNER_PHONE"
]);
const APP_CHECK_ENABLED_FLAG = "VITE_FIREBASE_APP_CHECK_ENABLED";
const APP_CHECK_SITE_KEY = "VITE_FIREBASE_APP_CHECK_RECAPTCHA_ENTERPRISE_SITE_KEY";

const cwd = process.cwd();
const buildProfile = String(process.env.QUOTEPILOT_BUILD_PROFILE || "").trim();
if (buildProfile && buildProfile !== RELEASE_CANDIDATE_BUILD_PROFILE) {
  console.error(`Unknown QUOTEPILOT_BUILD_PROFILE: ${buildProfile}.`);
  process.exit(1);
}
const isReleaseCandidateBuild = buildProfile === RELEASE_CANDIDATE_BUILD_PROFILE;
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

function isBooleanLike(value) {
  return ["", "0", "1", "true", "false", "yes", "no", "on", "off"].includes(
    String(value || "").trim().toLowerCase()
  );
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

const expectedFirebaseProjectId = isReleaseCandidateBuild
  ? RELEASE_CANDIDATE_FIREBASE.VITE_FIREBASE_PROJECT_ID
  : PRODUCTION_FIREBASE_PROJECT_ID;
if (
  configuredProjectIds.some((projectId) => projectId !== expectedFirebaseProjectId)
  || effectiveValue("VITE_FIREBASE_PROJECT_ID") !== expectedFirebaseProjectId
) {
  console.error(
    `Firebase project mismatch. QuotePilot ${isReleaseCandidateBuild ? "release candidate" : "production"} configuration must target ${expectedFirebaseProjectId}.`
  );
  process.exit(1);
}

if (isReleaseCandidateBuild) {
  const identityMismatches = Object.entries(RELEASE_CANDIDATE_FIREBASE)
    .filter(([name, expected]) => effectiveValue(name) !== expected)
    .map(([name]) => name);
  if (identityMismatches.length) {
    console.error("Release-candidate Firebase identity mismatch:");
    identityMismatches.forEach((key) => console.error(`- ${key}`));
    process.exit(1);
  }
  const disabledResidue = RELEASE_CANDIDATE_DISABLED_FLAGS.filter((name) => (
    isTruthy(effectiveValue(name))
  ));
  const missingPresentationFlags = RELEASE_CANDIDATE_ENABLED_FLAGS.filter((name) => (
    !isTruthy(effectiveValue(name))
  ));
  if (disabledResidue.length || missingPresentationFlags.length) {
    console.error("Release-candidate presentation and safety flags do not match the fixed profile:");
    disabledResidue.forEach((key) => console.error(`- ${key} must be false`));
    missingPresentationFlags.forEach((key) => console.error(`- ${key} must be true`));
    process.exit(1);
  }
}

const enabledUnsafeFlags = PRODUCTION_UNSAFE_FLAGS.filter((key) => (
  isTruthy(effectiveValue(key))
));
if (enabledUnsafeFlags.length) {
  console.error("Production-unsafe browser flags must be disabled:");
  enabledUnsafeFlags.forEach((key) => console.error(`- ${key}`));
  process.exit(1);
}

const buyerAccessRouteValue = effectiveValue(BUYER_ACCESS_ROUTE_FLAG);
const buyerAccessCtaValue = effectiveValue(BUYER_ACCESS_CTA_FLAG);
const invalidBuyerAccessFlags = [
  [BUYER_ACCESS_ROUTE_FLAG, buyerAccessRouteValue],
  [BUYER_ACCESS_CTA_FLAG, buyerAccessCtaValue]
]
  .filter(([, value]) => !isBooleanLike(value))
  .map(([name]) => name);
if (invalidBuyerAccessFlags.length) {
  console.error("Buyer-access browser flags must use an explicit boolean value:");
  invalidBuyerAccessFlags.forEach((key) => console.error(`- ${key}`));
  process.exit(1);
}

const buyerAccessRouteEnabled = isTruthy(buyerAccessRouteValue);
const buyerAccessCtaEnabled = isTruthy(buyerAccessCtaValue);
if (buyerAccessCtaEnabled && !buyerAccessRouteEnabled) {
  console.error(
    `${BUYER_ACCESS_CTA_FLAG} cannot be enabled unless ${BUYER_ACCESS_ROUTE_FLAG} is also enabled.`
  );
  process.exit(1);
}

const exposedProviderValues = FORBIDDEN_BROWSER_PROVIDER_VALUES.filter(
  (name) => effectiveValue(name)
);
if (exposedProviderValues.length) {
  console.error(
    `${exposedProviderValues.join(", ")} is forbidden because VITE_ values are browser-visible; keep provider credentials and SMS phone configuration server-owned.`
  );
  process.exit(1);
}

if (buyerAccessRouteEnabled || buyerAccessCtaEnabled) {
  const turnstileSiteKey = effectiveValue(BUYER_ACCESS_TURNSTILE_SITE_KEY);
  if (
    !turnstileSiteKey
    || isPlaceholder(turnstileSiteKey)
    || !/^[A-Za-z0-9_-]{10,100}$/.test(turnstileSiteKey)
  ) {
    console.error(
      `${BUYER_ACCESS_TURNSTILE_SITE_KEY} must be a syntactically valid non-placeholder public Turnstile site key whenever buyer access is compiled into a production artifact; provider setup and human review are separate release evidence.`
    );
    process.exit(1);
  }
}

const appCheckEnabledValue = effectiveValue(APP_CHECK_ENABLED_FLAG);
if (!["", "true", "false"].includes(appCheckEnabledValue.toLowerCase())) {
  console.error(`${APP_CHECK_ENABLED_FLAG} must use the exact value true or false.`);
  process.exit(1);
}
if (appCheckEnabledValue.toLowerCase() === "true") {
  const siteKey = effectiveValue(APP_CHECK_SITE_KEY);
  if (!siteKey || isPlaceholder(siteKey) || !/^[A-Za-z0-9_-]{10,100}$/.test(siteKey)) {
    console.error(
      `${APP_CHECK_SITE_KEY} must be a valid environment-specific public reCAPTCHA Enterprise site key when App Check is enabled.`
    );
    process.exit(1);
  }
}

console.log("Firebase env check passed.");
