import fs from "node:fs";
import path from "node:path";
import { describe, expect, test } from "vitest";
import {
  STAGING_DEPLOY_SCOPE,
  assertBrowserSourceSafety,
  assertExactStagingBrowserEnv,
  assertFirebaseStagingConfig,
  assertNoAmbientDeploymentCredentials,
  assertStagingConfirmation,
  assertStagingFunctionsEnv,
  assertStagingGitState,
  assertStagingProjectId,
  buildExactStagingBrowserEnv,
  firebaseStagingDeployArgs,
  stagingConfirmationToken
} from "../../../scripts/firebase-staging-contract.mjs";

const ROOT = process.cwd();
const PROJECT_ID = "quotepilot-staging-smoke";
const SHA = "a".repeat(40);
const SDK_CONFIG = Object.freeze({
  apiKey: "browser-api-key",
  authDomain: `${PROJECT_ID}.firebaseapp.com`,
  projectId: PROJECT_ID,
  storageBucket: `${PROJECT_ID}.firebasestorage.app`,
  messagingSenderId: "123456789012",
  appId: "1:123456789012:web:stagingfixture"
});

function functionsEnv(overrides = {}) {
  return {
    APP_BASE_URL: `https://${PROJECT_ID}.web.app/app`,
    APP_BASE_DOMAIN: `${PROJECT_ID}.web.app`,
    AUTH_PLATFORM_ADMIN_EMAILS: "operator@mbmapps.com",
    BUYER_ACCESS_ENABLED: "true",
    STRIPE_MODE: "test",
    STRIPE_SECRET_KEY: `rk_${"test"}_stagingfixture`,
    STRIPE_WEBHOOK_SECRET: `whsec_${"stagingfixture"}`,
    NOTIFICATIONS_EMAIL_PROVIDER: "none",
    RESEND_API_KEY: "",
    NOTIFICATIONS_SMS_PROVIDER: "none",
    TWILIO_ACCOUNT_SID: "",
    TWILIO_AUTH_TOKEN: "",
    TWILIO_FROM_NUMBER: "",
    NOTIFICATIONS_OWNER_PHONE: "",
    ...overrides
  };
}

describe("Firebase staging target boundary", () => {
  test("accepts only the QuotePilot staging project namespace and rejects production", () => {
    expect(assertStagingProjectId(PROJECT_ID)).toBe(PROJECT_ID);
    expect(() => assertStagingProjectId("tonicatering")).toThrow(/production.*forbidden/i);
    expect(() => assertStagingProjectId("quotepilot-preview-smoke")).toThrow(/must match/i);
    expect(() => assertStagingProjectId("quotepilot-staging-")).toThrow(/must match/i);
  });

  test("pins a staging-only config with Hosting, Functions, and Firestore rules/indexes", () => {
    const config = JSON.parse(
      fs.readFileSync(path.join(ROOT, "firebase.staging.json"), "utf8")
    );

    expect(assertFirebaseStagingConfig(config)).toBe(true);
    expect(Object.keys(config).sort()).toEqual(["firestore", "functions", "hosting"]);
    expect(config.firestore).toEqual({
      rules: "firestore.rules",
      indexes: "firestore.indexes.json"
    });
    expect(config.hosting.target).toBeUndefined();
    expect(config.hosting.site).toBeUndefined();

    expect(() => assertFirebaseStagingConfig({
      ...config,
      storage: { rules: "storage.rules" }
    })).toThrow(/only the reviewed staging/i);
  });
});

describe("Firebase staging Stripe and buyer-access contract", () => {
  test("accepts explicit buyer access with a restricted Stripe test key and disabled messaging", () => {
    expect(assertStagingFunctionsEnv({
      projectId: PROJECT_ID,
      env: functionsEnv()
    })).toEqual({
      projectId: PROJECT_ID,
      stripeMode: "test",
      stripeKeyType: "restricted",
      buyerAccessEnabled: true,
      platformAdminCount: 1,
      emailProvider: "none",
      smsProvider: "none"
    });

    expect(assertStagingFunctionsEnv({
      projectId: PROJECT_ID,
      env: functionsEnv({ STRIPE_SECRET_KEY: `sk_${"test"}_stagingfixture` })
    }).stripeKeyType).toBe("secret");
  });

  test.each([
    ["live mode", { STRIPE_MODE: "live" }, /test.*required|live mode.*forbidden/i],
    ["live key", { STRIPE_SECRET_KEY: `rk_${"live"}_fixture` }, /live Stripe credentials.*forbidden/i],
    ["disabled buyer access", { BUYER_ACCESS_ENABLED: "false" }, /BUYER_ACCESS_ENABLED=true/i],
    ["missing platform admin", { AUTH_PLATFORM_ADMIN_EMAILS: "" }, /AUTH_PLATFORM_ADMIN_EMAILS/i],
    ["email provider", { NOTIFICATIONS_EMAIL_PROVIDER: "resend" }, /EMAIL_PROVIDER=none/i],
    ["email credential", { RESEND_API_KEY: "re_fixture" }, /email credentials must be absent/i],
    ["SMS provider", { NOTIFICATIONS_SMS_PROVIDER: "twilio" }, /SMS_PROVIDER=none/i],
    ["SMS credential", { TWILIO_ACCOUNT_SID: "ACfixture" }, /SMS credentials must be absent/i],
    ["production app URL", { APP_BASE_URL: "https://quotepilot.mbmapps.com/app" }, /APP_BASE_URL must be/i],
    ["emulator flag", { FIRESTORE_EMULATOR_HOST: "127.0.0.1:8080" }, /unsafe Functions staging flag/i]
  ])("rejects %s", (_label, overrides, message) => {
    expect(() => assertStagingFunctionsEnv({
      projectId: PROJECT_ID,
      env: functionsEnv(overrides)
    })).toThrow(message);
  });
});

describe("Firebase staging browser contract", () => {
  test("builds and validates the exact provider-derived Vite environment", () => {
    const env = buildExactStagingBrowserEnv({
      projectId: PROJECT_ID,
      sourceEnv: { VITE_BUYER_ACCESS_ENABLED: "true" },
      sdkConfig: SDK_CONFIG,
      sha: SHA
    });

    expect(env).toMatchObject({
      VITE_FIREBASE_PROJECT_ID: PROJECT_ID,
      VITE_FIREBASE_APP_ID: SDK_CONFIG.appId,
      VITE_BUYER_ACCESS_ENABLED: "true",
      VITE_APP_URL: `https://${PROJECT_ID}.web.app/app`,
      VITE_USE_FIREBASE_EMULATORS: "false",
      VITE_E2E_BYPASS_AUTH: "false",
      VITE_APP_VERSION: SHA
    });
    expect(assertExactStagingBrowserEnv({
      projectId: PROJECT_ID,
      env,
      sdkConfig: SDK_CONFIG
    })).toBe(true);
  });

  test("rejects mismatched Firebase config, missing enablement, unsafe flags, and client secrets", () => {
    expect(() => assertBrowserSourceSafety({
      projectId: PROJECT_ID,
      env: {
        VITE_BUYER_ACCESS_ENABLED: "true",
        VITE_FIREBASE_PROJECT_ID: "tonicatering"
      },
      sdkConfig: SDK_CONFIG,
      requireBuyerAccess: true
    })).toThrow(/does not match the exact Firebase Web SDK config/i);

    expect(() => assertBrowserSourceSafety({
      projectId: PROJECT_ID,
      env: {},
      sdkConfig: SDK_CONFIG,
      requireBuyerAccess: true
    })).toThrow(/VITE_BUYER_ACCESS_ENABLED=true/i);

    expect(() => assertBrowserSourceSafety({
      projectId: PROJECT_ID,
      env: {
        VITE_BUYER_ACCESS_ENABLED: "true",
        VITE_E2E_BYPASS_AUTH: "true"
      },
      sdkConfig: SDK_CONFIG,
      requireBuyerAccess: true
    })).toThrow(/safety flags must stay disabled/i);

    expect(() => assertBrowserSourceSafety({
      projectId: PROJECT_ID,
      env: {
        VITE_BUYER_ACCESS_ENABLED: "true",
        VITE_STRIPE_KEY: `sk_${"test"}_must_stay_server_side`
      },
      sdkConfig: SDK_CONFIG,
      requireBuyerAccess: true
    })).toThrow(/server-only Stripe credential/i);
  });
});

describe("Firebase staging publication gate", () => {
  test("requires a clean branch exactly published to its origin upstream", () => {
    expect(assertStagingGitState({
      branch: "feature/paid-buyer-onboarding",
      upstream: "origin/feature/paid-buyer-onboarding",
      headSha: SHA,
      remoteSha: SHA,
      status: ""
    })).toEqual({
      branch: "feature/paid-buyer-onboarding",
      sha: SHA
    });

    expect(() => assertStagingGitState({
      branch: "feature/paid-buyer-onboarding",
      upstream: "origin/feature/paid-buyer-onboarding",
      headSha: SHA,
      remoteSha: "b".repeat(40),
      status: ""
    })).toThrow(/HEAD must exactly equal/i);

    expect(() => assertStagingGitState({
      branch: "feature/paid-buyer-onboarding",
      upstream: "origin/feature/paid-buyer-onboarding",
      headSha: SHA,
      remoteSha: SHA,
      status: "?? untracked.txt"
    })).toThrow(/clean tracked and untracked worktree/i);
  });

  test("binds confirmation to exact project, complete scope, and SHA", () => {
    const confirmation = stagingConfirmationToken({ projectId: PROJECT_ID, sha: SHA });
    expect(confirmation).toBe(
      `DEPLOY STAGING ${PROJECT_ID} ${STAGING_DEPLOY_SCOPE} ${SHA}`
    );
    expect(assertStagingConfirmation({
      projectId: PROJECT_ID,
      sha: SHA,
      confirmation
    })).toBe(true);
    expect(() => assertStagingConfirmation({
      projectId: PROJECT_ID,
      sha: SHA,
      confirmation: `DEPLOY STAGING ${PROJECT_ID} hosting ${SHA}`
    })).toThrow(/requires --confirm/i);
  });

  test("generates one fixed Firebase deploy command for all three surfaces", () => {
    expect(firebaseStagingDeployArgs(PROJECT_ID)).toEqual([
      "deploy",
      "--config",
      "firebase.staging.json",
      "--project",
      PROJECT_ID,
      "--only",
      "hosting,functions,firestore",
      "--non-interactive"
    ]);
  });

  test("rejects ambiguous provider credentials and ambient runtime secrets", () => {
    expect(() => assertNoAmbientDeploymentCredentials({
      FIREBASE_TOKEN: "legacy-token"
    })).toThrow(/FIREBASE_TOKEN is not accepted/i);
    expect(() => assertNoAmbientDeploymentCredentials({
      GOOGLE_APPLICATION_CREDENTIALS: "/tmp/service-account.json"
    })).toThrow(/GOOGLE_APPLICATION_CREDENTIALS is not accepted/i);
    expect(() => assertNoAmbientDeploymentCredentials({
      STRIPE_MODE: "test"
    })).toThrow(/must come only from the ignored project-scoped/i);
    expect(() => assertNoAmbientDeploymentCredentials({
      APP_BASE_URL: `https://${PROJECT_ID}.web.app/app`
    })).toThrow(/must come only from the ignored project-scoped/i);
  });

  test("keeps staging setup requirements in the command help", () => {
    const script = path.join(ROOT, "scripts", "deploy-firebase-staging.mjs");
    const source = fs.readFileSync(script, "utf8");

    expect(source).toMatch(/quotepilot-staging-<name>/i);
    expect(source).toContain("VITE_BUYER_ACCESS_ENABLED=true");
    expect(source).toContain("BUYER_ACCESS_ENABLED=true");
    expect(source).toContain("STRIPE_MODE=test");
    expect(source).toContain("STAGING_DEPLOY_SCOPE");
  });
});
