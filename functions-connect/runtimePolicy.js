"use strict";

const STRIPE_CONNECT_SDK_VERSION = "22.5.0";
const STRIPE_CONNECT_API_VERSION = "2026-07-29.dahlia";
const LEGACY_STRIPE_SDK_VERSION = "16.12.0";
const LEGACY_STRIPE_API_VERSION = "2024-06-20";
const CONNECT_DATABASE_ID = "connect-control";
const CONNECT_CODEBASE = "connect";

const FOUNDATION_MANIFEST_FIELDS = Object.freeze([
  "schemaVersion",
  "stage",
  "projectId",
  "projectNumber",
  "stripeMode",
  "stripePlatformBinding",
  "canonicalReturnOrigin",
  "stripeSdkVersion",
  "stripeApiVersion",
  "legacyStripeSdkVersion",
  "legacyStripeApiVersion",
  "databaseId",
  "functionsCodebase",
  "providerCallsEnabled",
  "accountOnboardingEnabled",
  "callableExports",
  "serviceAccounts",
  "egressIps",
  "webhookDestinations",
  "keyPolicies",
  "minimumRollbackSha"
]);

function fail(message) {
  const error = new Error(`Stripe Connect foundation manifest rejected: ${message}`);
  error.code = "failed-precondition";
  throw error;
}

function exactKeys(value, expected, label) {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    fail(`${label} must be an object.`);
  }
  const actual = Object.keys(value).sort();
  const required = [...expected].sort();
  if (actual.length !== required.length || actual.some((key, index) => key !== required[index])) {
    fail(`${label} must contain only the exact foundation fields.`);
  }
}

function requireEmptyArray(value, label) {
  if (!Array.isArray(value) || value.length !== 0) fail(`${label} must remain empty before infrastructure binding.`);
}

function validateStripeConnectFoundationManifest(value = {}) {
  exactKeys(value, FOUNDATION_MANIFEST_FIELDS, "manifest");
  if (value.schemaVersion !== 1) fail("schemaVersion must be 1.");
  if (value.stage !== "staging_foundation") fail("stage must remain staging_foundation.");
  if (value.projectId !== "quotepilot-staging-20260804") fail("projectId does not match isolated staging.");
  if (value.projectNumber !== "844470813106") fail("projectNumber does not match isolated staging.");
  if (value.stripeMode !== "sandbox") fail("stripeMode must remain sandbox.");
  if (value.stripePlatformBinding !== "unbound") fail("the Stripe platform must remain unbound in foundation source.");
  if (value.canonicalReturnOrigin !== "https://quotepilot-staging-20260804.web.app") {
    fail("canonicalReturnOrigin does not match isolated staging.");
  }
  if (value.stripeSdkVersion !== STRIPE_CONNECT_SDK_VERSION) fail("Stripe SDK version mismatch.");
  if (value.stripeApiVersion !== STRIPE_CONNECT_API_VERSION) fail("Stripe API version mismatch.");
  if (value.legacyStripeSdkVersion !== LEGACY_STRIPE_SDK_VERSION) fail("legacy Stripe SDK version mismatch.");
  if (value.legacyStripeApiVersion !== LEGACY_STRIPE_API_VERSION) fail("legacy Stripe API version mismatch.");
  if (value.databaseId !== CONNECT_DATABASE_ID) fail("databaseId must be connect-control.");
  if (value.functionsCodebase !== CONNECT_CODEBASE) fail("functionsCodebase must be connect.");
  if (value.providerCallsEnabled !== false || value.accountOnboardingEnabled !== false) {
    fail("provider calls and account onboarding must remain disabled.");
  }
  requireEmptyArray(value.callableExports, "callableExports");
  requireEmptyArray(value.serviceAccounts, "serviceAccounts");
  requireEmptyArray(value.egressIps, "egressIps");
  requireEmptyArray(value.webhookDestinations, "webhookDestinations");
  requireEmptyArray(value.keyPolicies, "keyPolicies");
  if (value.minimumRollbackSha !== "") fail("minimumRollbackSha remains empty until a connected payment exists.");
  return Object.freeze({ ...value });
}

module.exports = {
  CONNECT_CODEBASE,
  CONNECT_DATABASE_ID,
  FOUNDATION_MANIFEST_FIELDS,
  LEGACY_STRIPE_API_VERSION,
  LEGACY_STRIPE_SDK_VERSION,
  STRIPE_CONNECT_API_VERSION,
  STRIPE_CONNECT_SDK_VERSION,
  validateStripeConnectFoundationManifest
};
