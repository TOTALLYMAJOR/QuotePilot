import assert from "node:assert/strict";

export const PRODUCTION_FIREBASE_PROJECT_ID = "tonicatering";
export const STAGING_DEPLOY_SCOPE = "hosting,functions,firestore";
export const STAGING_CONFIG_FILE = "firebase.staging.json";
export const STAGING_PROJECT_PREFIX = "quotepilot-staging-";

export const REQUIRED_FIREBASE_BROWSER_KEYS = Object.freeze([
  "VITE_FIREBASE_API_KEY",
  "VITE_FIREBASE_AUTH_DOMAIN",
  "VITE_FIREBASE_PROJECT_ID",
  "VITE_FIREBASE_STORAGE_BUCKET",
  "VITE_FIREBASE_MESSAGING_SENDER_ID",
  "VITE_FIREBASE_APP_ID"
]);

export const EXPECTED_FIREBASE_STAGING_CONFIG = Object.freeze({
  functions: {
    source: "functions"
  },
  hosting: {
    public: "dist",
    ignore: [
      "firebase.staging.json",
      "**/.*",
      "**/node_modules/**"
    ],
    rewrites: [
      {
        source: "**",
        destination: "/index.html"
      }
    ],
    headers: [
      {
        source: "/index.html",
        headers: [
          {
            key: "Cache-Control",
            value: "no-cache"
          }
        ]
      },
      {
        source: "/assets/**",
        headers: [
          {
            key: "Cache-Control",
            value: "public,max-age=31536000,immutable"
          }
        ]
      },
      {
        source: "/brand/**",
        headers: [
          {
            key: "Cache-Control",
            value: "public,max-age=86400"
          }
        ]
      },
      {
        source: "/manifest.webmanifest",
        headers: [
          {
            key: "Cache-Control",
            value: "public,max-age=3600"
          }
        ]
      },
      {
        source: "/sw.js",
        headers: [
          {
            key: "Cache-Control",
            value: "no-cache"
          }
        ]
      },
      {
        source: "**",
        headers: [
          {
            key: "X-Content-Type-Options",
            value: "nosniff"
          },
          {
            key: "Referrer-Policy",
            value: "strict-origin-when-cross-origin"
          }
        ]
      }
    ]
  },
  firestore: {
    rules: "firestore.rules",
    indexes: "firestore.indexes.json"
  }
});

const SDK_TO_BROWSER_ENV = Object.freeze([
  ["apiKey", "VITE_FIREBASE_API_KEY"],
  ["authDomain", "VITE_FIREBASE_AUTH_DOMAIN"],
  ["projectId", "VITE_FIREBASE_PROJECT_ID"],
  ["storageBucket", "VITE_FIREBASE_STORAGE_BUCKET"],
  ["messagingSenderId", "VITE_FIREBASE_MESSAGING_SENDER_ID"],
  ["appId", "VITE_FIREBASE_APP_ID"]
]);

const BROWSER_UNSAFE_FLAGS = Object.freeze([
  "VITE_E2E_BYPASS_AUTH",
  "VITE_USE_FIREBASE_EMULATORS",
  "VITE_ALLOW_LOCAL_CATALOG_FALLBACK",
  "VITE_E2E_ALLOW_NON_AUTHORITATIVE_PRICING"
]);

const DISABLED_EMAIL_CREDENTIALS = Object.freeze([
  "RESEND_API_KEY"
]);

const DISABLED_SMS_CREDENTIALS = Object.freeze([
  "TWILIO_ACCOUNT_SID",
  "TWILIO_AUTH_TOKEN",
  "TWILIO_FROM_NUMBER",
  "NOTIFICATIONS_OWNER_PHONE"
]);

const AMBIENT_PROVIDER_CREDENTIALS = Object.freeze([
  "FIREBASE_TOKEN",
  "GOOGLE_APPLICATION_CREDENTIALS",
  "GOOGLE_GHA_CREDS_PATH",
  "GOOGLE_CREDENTIALS",
  "GCLOUD_SERVICE_KEY",
  "FIREBASE_SERVICE_ACCOUNT"
]);

const AMBIENT_RUNTIME_OVERRIDES = Object.freeze([
  "APP_BASE_URL",
  "APP_BASE_DOMAIN",
  "AUTH_PLATFORM_ADMIN_EMAILS",
  "BUYER_ACCESS_ENABLED",
  "STRIPE_MODE",
  "STRIPE_SECRET_KEY",
  "STRIPE_WEBHOOK_SECRET",
  "NOTIFICATIONS_EMAIL_PROVIDER",
  "RESEND_API_KEY",
  "NOTIFICATIONS_SMS_PROVIDER",
  "TWILIO_ACCOUNT_SID",
  "TWILIO_AUTH_TOKEN",
  "TWILIO_FROM_NUMBER",
  "NOTIFICATIONS_OWNER_PHONE"
]);

function text(value) {
  return String(value ?? "").trim();
}

function lower(value) {
  return text(value).toLowerCase();
}

function isTruthy(value) {
  return ["1", "true", "yes", "on"].includes(lower(value));
}

function requireValue(env, key) {
  const value = text(env?.[key]);
  if (!value) {
    throw new Error(`${key} is required for the Firebase staging lane.`);
  }
  if (/\r|\n/.test(value)) {
    throw new Error(`${key} must be a single-line value.`);
  }
  return value;
}

export function assertStagingProjectId(projectId) {
  const value = text(projectId);
  if (value === PRODUCTION_FIREBASE_PROJECT_ID) {
    throw new Error(`Production Firebase project ${PRODUCTION_FIREBASE_PROJECT_ID} is forbidden in the staging lane.`);
  }
  if (
    value.length < 6
    || value.length > 30
    || !/^quotepilot-staging-[a-z0-9](?:[a-z0-9-]*[a-z0-9])?$/.test(value)
  ) {
    throw new Error(
      `Firebase staging project id must match ${STAGING_PROJECT_PREFIX}* and satisfy Firebase project-id syntax.`
    );
  }
  return value;
}

export function stagingAppHost(projectId) {
  return `${assertStagingProjectId(projectId)}.web.app`;
}

export function stagingAppUrl(projectId) {
  return `https://${stagingAppHost(projectId)}/app`;
}

export function assertFirebaseStagingConfig(config) {
  try {
    assert.deepStrictEqual(config, EXPECTED_FIREBASE_STAGING_CONFIG);
  } catch {
    throw new Error(
      `${STAGING_CONFIG_FILE} must contain only the reviewed staging Hosting, Functions, and Firestore rules/indexes configuration.`
    );
  }
  return true;
}

export function browserEnvFromSdkConfig({ projectId, sdkConfig }) {
  const target = assertStagingProjectId(projectId);
  if (text(sdkConfig?.projectId) !== target) {
    throw new Error("Firebase Web SDK config project does not match the explicit staging target.");
  }

  const output = {};
  for (const [sdkKey, envKey] of SDK_TO_BROWSER_ENV) {
    const value = text(sdkConfig?.[sdkKey]);
    if (!value) {
      throw new Error(`Firebase Web SDK config is missing ${sdkKey}.`);
    }
    output[envKey] = value;
  }
  return output;
}

export function assertBrowserSourceSafety({
  projectId,
  env = {},
  sdkConfig,
  requireBuyerAccess = false
}) {
  const target = assertStagingProjectId(projectId);
  const exactFirebaseEnv = browserEnvFromSdkConfig({ projectId: target, sdkConfig });

  for (const key of REQUIRED_FIREBASE_BROWSER_KEYS) {
    const configured = text(env[key]);
    if (configured && configured !== exactFirebaseEnv[key]) {
      throw new Error(`${key} does not match the exact Firebase Web SDK config for ${target}.`);
    }
  }

  const exactUrl = stagingAppUrl(target);
  const exactHost = stagingAppHost(target);
  for (const [key, expected] of [
    ["VITE_APP_URL", exactUrl],
    ["VITE_APP_HOST", exactHost],
    ["VITE_BASE_DOMAIN", exactHost]
  ]) {
    const configured = text(env[key]);
    if (configured && configured !== expected) {
      throw new Error(`${key} must target the isolated Firebase staging host ${exactHost}.`);
    }
  }

  if (requireBuyerAccess && lower(env.VITE_BUYER_ACCESS_ENABLED) !== "true") {
    throw new Error("VITE_BUYER_ACCESS_ENABLED=true is required for the buyer-access staging lane.");
  }

  const enabledUnsafe = BROWSER_UNSAFE_FLAGS.filter((key) => isTruthy(env[key]));
  if (enabledUnsafe.length) {
    throw new Error(`Browser staging safety flags must stay disabled: ${enabledUnsafe.join(", ")}.`);
  }

  const leakedSecretKey = Object.entries(env).find(([key, value]) => (
    key.startsWith("VITE_")
    && /^(?:sk|rk)_(?:test|live)_|^whsec_/i.test(text(value))
  ));
  if (leakedSecretKey) {
    throw new Error(`${leakedSecretKey[0]} contains a server-only Stripe credential.`);
  }

  return true;
}

export function buildExactStagingBrowserEnv({ projectId, sourceEnv = {}, sdkConfig, sha }) {
  const target = assertStagingProjectId(projectId);
  assertBrowserSourceSafety({
    projectId: target,
    env: sourceEnv,
    sdkConfig,
    requireBuyerAccess: true
  });
  const exactFirebaseEnv = browserEnvFromSdkConfig({ projectId: target, sdkConfig });

  return {
    ...exactFirebaseEnv,
    VITE_FIREBASE_FUNCTIONS_REGION: "us-central1",
    VITE_BUYER_ACCESS_ENABLED: "true",
    VITE_APP_URL: stagingAppUrl(target),
    VITE_APP_HOST: stagingAppHost(target),
    VITE_BASE_DOMAIN: stagingAppHost(target),
    VITE_ALLOW_LOCAL_CATALOG_FALLBACK: "false",
    VITE_USE_FIREBASE_EMULATORS: "false",
    VITE_E2E_BYPASS_AUTH: "false",
    VITE_E2E_ALLOW_NON_AUTHORITATIVE_PRICING: "false",
    VITE_APP_VERSION: text(sha)
  };
}

export function assertExactStagingBrowserEnv({ projectId, env, sdkConfig }) {
  const expected = buildExactStagingBrowserEnv({
    projectId,
    sourceEnv: env,
    sdkConfig,
    sha: env?.VITE_APP_VERSION
  });
  for (const [key, value] of Object.entries(expected)) {
    if (text(env?.[key]) !== value) {
      throw new Error(`${key} is not the exact staging build value.`);
    }
  }
  return true;
}

export function assertStagingFunctionsEnv({ projectId, env = {} }) {
  const target = assertStagingProjectId(projectId);
  const platformAdminEmails = normalizePlatformAdminAllowlist(
    requireValue(env, "AUTH_PLATFORM_ADMIN_EMAILS")
  );
  if (lower(requireValue(env, "STRIPE_MODE")) !== "test") {
    throw new Error("STRIPE_MODE=test is required; live mode is forbidden in Firebase staging.");
  }

  const stripeKey = requireValue(env, "STRIPE_SECRET_KEY");
  if (/^(?:sk|rk)_live_/i.test(stripeKey)) {
    throw new Error("Live Stripe credentials are forbidden in Firebase staging.");
  }
  if (!/^(?:sk|rk)_test_[A-Za-z0-9_]+$/.test(stripeKey)) {
    throw new Error("STRIPE_SECRET_KEY must be a Stripe test secret or restricted key (sk_test_ or rk_test_)." );
  }

  const webhookSecret = requireValue(env, "STRIPE_WEBHOOK_SECRET");
  if (!/^whsec_[A-Za-z0-9_]+$/.test(webhookSecret)) {
    throw new Error("STRIPE_WEBHOOK_SECRET must be a Stripe endpoint signing secret for the test endpoint.");
  }

  if (lower(requireValue(env, "BUYER_ACCESS_ENABLED")) !== "true") {
    throw new Error("BUYER_ACCESS_ENABLED=true is required for the buyer-access staging lane.");
  }

  if (lower(requireValue(env, "NOTIFICATIONS_EMAIL_PROVIDER")) !== "none") {
    throw new Error("NOTIFICATIONS_EMAIL_PROVIDER=none is required for the first staging smoke.");
  }
  const configuredEmailCredentials = DISABLED_EMAIL_CREDENTIALS.filter((key) => text(env[key]));
  if (configuredEmailCredentials.length) {
    throw new Error(`Email credentials must be absent while staging email is disabled: ${configuredEmailCredentials.join(", ")}.`);
  }

  if (lower(requireValue(env, "NOTIFICATIONS_SMS_PROVIDER")) !== "none") {
    throw new Error("NOTIFICATIONS_SMS_PROVIDER=none is required for the first staging smoke.");
  }
  const configuredSmsCredentials = DISABLED_SMS_CREDENTIALS.filter((key) => text(env[key]));
  if (configuredSmsCredentials.length) {
    throw new Error(`SMS credentials must be absent while staging SMS is disabled: ${configuredSmsCredentials.join(", ")}.`);
  }

  if (requireValue(env, "APP_BASE_URL") !== stagingAppUrl(target)) {
    throw new Error(`APP_BASE_URL must be ${stagingAppUrl(target)} for Firebase staging.`);
  }
  if (requireValue(env, "APP_BASE_DOMAIN").toLowerCase() !== stagingAppHost(target)) {
    throw new Error(`APP_BASE_DOMAIN must be ${stagingAppHost(target)} for Firebase staging.`);
  }

  const unsafeRuntimeFlag = Object.entries(env).find(([key, value]) => (
    key !== "BUYER_ACCESS_ENABLED"
    && /(?:BYPASS|EMULATOR|ALLOW_LOCAL|NON_AUTHORITATIVE)/i.test(key)
    && text(value)
    && lower(value) !== "false"
  ));
  if (unsafeRuntimeFlag) {
    throw new Error(`Unsafe Functions staging flag must be absent or false: ${unsafeRuntimeFlag[0]}.`);
  }

  return {
    projectId: target,
    stripeMode: "test",
    stripeKeyType: stripeKey.startsWith("rk_test_") ? "restricted" : "secret",
    buyerAccessEnabled: true,
    platformAdminCount: platformAdminEmails.split(",").length,
    emailProvider: "none",
    smsProvider: "none"
  };
}

export function normalizePlatformAdminAllowlist(value) {
  const emails = text(value)
    .split(",")
    .map((email) => email.trim().toLowerCase())
    .filter(Boolean);
  if (
    !emails.length
    || emails.some((email) => !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email))
    || emails.some((email) => /@example\.(?:com|org|net|test)$|\.test$/i.test(email))
  ) {
    throw new Error(
      "AUTH_PLATFORM_ADMIN_EMAILS must contain one or more real comma-separated operator emails."
    );
  }
  return [...new Set(emails)].join(",");
}

export function assertNoAmbientDeploymentCredentials(env = {}) {
  const configuredCredential = AMBIENT_PROVIDER_CREDENTIALS.find((key) => text(env[key]));
  if (configuredCredential) {
    throw new Error(
      `${configuredCredential} is not accepted by the staging lane; use an authenticated local Firebase CLI session scoped by --project.`
    );
  }

  const configuredOverride = AMBIENT_RUNTIME_OVERRIDES.find((key) => text(env[key]));
  if (configuredOverride) {
    throw new Error(
      `${configuredOverride} must come only from the ignored project-scoped Functions environment file.`
    );
  }
  return true;
}

export function assertStagingGitState({
  branch,
  upstream,
  headSha,
  remoteSha,
  status
}) {
  const normalizedBranch = text(branch);
  if (!normalizedBranch || normalizedBranch === "HEAD" || !/^[A-Za-z0-9._/-]+$/.test(normalizedBranch)) {
    throw new Error("Firebase staging validation requires a named Git branch.");
  }
  if (text(upstream) !== `origin/${normalizedBranch}`) {
    throw new Error(`Current branch must track origin/${normalizedBranch}.`);
  }
  if (text(status)) {
    throw new Error("Firebase staging validation requires a clean tracked and untracked worktree.");
  }
  const local = text(headSha).toLowerCase();
  const remote = text(remoteSha).toLowerCase();
  if (!/^[0-9a-f]{40}$/.test(local) || !/^[0-9a-f]{40}$/.test(remote)) {
    throw new Error("Firebase staging validation requires exact 40-character local and remote Git SHAs.");
  }
  if (local !== remote) {
    throw new Error("Local HEAD must exactly equal the currently published origin branch SHA.");
  }
  return { branch: normalizedBranch, sha: local };
}

export function stagingConfirmationToken({ projectId, sha }) {
  const target = assertStagingProjectId(projectId);
  const exactSha = text(sha).toLowerCase();
  if (!/^[0-9a-f]{40}$/.test(exactSha)) {
    throw new Error("A full 40-character Git SHA is required for staging confirmation.");
  }
  return `DEPLOY STAGING ${target} ${STAGING_DEPLOY_SCOPE} ${exactSha}`;
}

export function assertStagingConfirmation({ projectId, sha, confirmation }) {
  const expected = stagingConfirmationToken({ projectId, sha });
  if (text(confirmation) !== expected) {
    throw new Error(`Deploy requires --confirm "${expected}".`);
  }
  return true;
}

export function firebaseStagingDeployArgs(projectId) {
  const target = assertStagingProjectId(projectId);
  return [
    "deploy",
    "--config",
    STAGING_CONFIG_FILE,
    "--project",
    target,
    "--only",
    STAGING_DEPLOY_SCOPE,
    "--non-interactive"
  ];
}
