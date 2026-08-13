import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { spawnSync } from "node:child_process";
import { afterEach, describe, expect, test } from "vitest";

const SCRIPT_PATH = path.resolve(process.cwd(), "scripts/check-env.mjs");
const tempDirs = [];
const validEnv = {
  VITE_FIREBASE_API_KEY: "browser-app-key",
  VITE_FIREBASE_AUTH_DOMAIN: "tonicatering.firebaseapp.com",
  VITE_FIREBASE_PROJECT_ID: "tonicatering",
  VITE_FIREBASE_STORAGE_BUCKET: "tonicatering.firebasestorage.app",
  VITE_FIREBASE_MESSAGING_SENDER_ID: "1234567890",
  VITE_FIREBASE_APP_ID: "1:1234567890:web:test"
};
const productionUnsafeFlags = [
  "VITE_E2E_BYPASS_AUTH",
  "VITE_USE_FIREBASE_EMULATORS",
  "VITE_ALLOW_LOCAL_CATALOG_FALLBACK",
  "VITE_E2E_ALLOW_NON_AUTHORITATIVE_PRICING"
];

function serialize(values) {
  return `${Object.entries(values).map(([key, value]) => `${key}=${value}`).join("\n")}\n`;
}

function runCheck({
  env = validEnv,
  envLocal = null,
  envProduction = null,
  envProductionLocal = null
} = {}) {
  const cwd = fs.mkdtempSync(path.join(os.tmpdir(), "quotepilot-check-env-"));
  tempDirs.push(cwd);
  fs.writeFileSync(path.join(cwd, ".env"), serialize(env));
  if (envLocal) fs.writeFileSync(path.join(cwd, ".env.local"), serialize(envLocal));
  if (envProduction) {
    fs.writeFileSync(path.join(cwd, ".env.production"), serialize(envProduction));
  }
  if (envProductionLocal) {
    fs.writeFileSync(
      path.join(cwd, ".env.production.local"),
      serialize(envProductionLocal)
    );
  }
  const result = spawnSync(process.execPath, [SCRIPT_PATH], {
    cwd,
    env: { PATH: process.env.PATH || "" },
    encoding: "utf8"
  });
  return result;
}

afterEach(() => {
  while (tempDirs.length) {
    fs.rmSync(tempDirs.pop(), { recursive: true, force: true });
  }
});

describe("Firebase browser environment safety", { timeout: 30_000 }, () => {
  test("the pre-install CI check uses only Node built-ins", () => {
    expect(fs.readFileSync(SCRIPT_PATH, "utf8")).not.toMatch(
      /from\s+["'](?:vite|dotenv)["']/
    );
  });

  test("accepts the canonical production project", () => {
    expect(runCheck().status).toBe(0);
  });

  test("accepts opt-in App Check only with an environment-specific public site key", () => {
    expect(runCheck({
      envProductionLocal: {
        VITE_FIREBASE_APP_CHECK_ENABLED: "true",
        VITE_FIREBASE_APP_CHECK_RECAPTCHA_ENTERPRISE_SITE_KEY: "staging_public_site_key_123"
      }
    }).status).toBe(0);
  });

  test.each(["", "replace_me", "invalid key!"])(
    "rejects enabled App Check with an unusable public site key: %s",
    (siteKey) => {
      const result = runCheck({
        envProductionLocal: {
          VITE_FIREBASE_APP_CHECK_ENABLED: "true",
          VITE_FIREBASE_APP_CHECK_RECAPTCHA_ENTERPRISE_SITE_KEY: siteKey
        }
      });
      expect(result.status).not.toBe(0);
      expect(result.stderr).toContain("VITE_FIREBASE_APP_CHECK_RECAPTCHA_ENTERPRISE_SITE_KEY");
    }
  );

  test("rejects ambiguous App Check flag aliases", () => {
    const result = runCheck({
      envProductionLocal: { VITE_FIREBASE_APP_CHECK_ENABLED: "yes" }
    });
    expect(result.status).not.toBe(0);
    expect(result.stderr).toMatch(/exact value true or false/i);
  });

  test("allows a public buyer artifact with coherent non-placeholder Turnstile syntax", () => {
    expect(runCheck({
      envProductionLocal: {
        VITE_BUYER_ACCESS_ENABLED: "true",
        VITE_BUYER_ACCESS_PUBLIC_CTA_ENABLED: "true",
        VITE_BUYER_ACCESS_TURNSTILE_SITE_KEY: "1x00000000000000000000AA"
      }
    }).status).toBe(0);
  });

  test("allows a direct buyer route only when its Turnstile site key is configured", () => {
    expect(runCheck({
      envProductionLocal: {
        VITE_BUYER_ACCESS_ENABLED: "true",
        VITE_BUYER_ACCESS_PUBLIC_CTA_ENABLED: "false",
        VITE_BUYER_ACCESS_TURNSTILE_SITE_KEY: "1x00000000000000000000AA"
      }
    }).status).toBe(0);
  });

  test("rejects a public CTA without the buyer route", () => {
    const result = runCheck({
      envProductionLocal: {
        VITE_BUYER_ACCESS_ENABLED: "false",
        VITE_BUYER_ACCESS_PUBLIC_CTA_ENABLED: "true",
        VITE_BUYER_ACCESS_TURNSTILE_SITE_KEY: "1x00000000000000000000AA"
      }
    });
    expect(result.error).toBeUndefined();
    expect(result.status).not.toBe(0);
    expect(result.stderr).toMatch(/cannot be enabled unless/i);
  });

  test.each(["", "replace_me", "invalid key!"])(
    "rejects buyer access with an unusable Turnstile site key: %s",
    (siteKey) => {
      const result = runCheck({
        envProductionLocal: {
          VITE_BUYER_ACCESS_ENABLED: "true",
          VITE_BUYER_ACCESS_PUBLIC_CTA_ENABLED: "true",
          VITE_BUYER_ACCESS_TURNSTILE_SITE_KEY: siteKey
        }
      });
      expect(result.status).not.toBe(0);
      expect(result.stderr).toContain("VITE_BUYER_ACCESS_TURNSTILE_SITE_KEY");
      expect(result.stderr).toMatch(/provider setup and human review are separate/i);
    }
  );

  test("rejects a Turnstile secret exposed through the browser environment", () => {
    const result = runCheck({
      envProductionLocal: {
        VITE_BUYER_ACCESS_TURNSTILE_SECRET: "secret-fixture"
      }
    });
    expect(result.status).not.toBe(0);
    expect(result.stderr).toMatch(/browser-visible/i);
  });

  test.each([
    "VITE_PINGRAM_API_KEY",
    "VITE_PINGRAM_WEBHOOK_SECRET",
    "VITE_SMS_CONTACT_DIGEST_SECRET",
    "VITE_PINGRAM_FROM_NUMBER",
    "VITE_NOTIFICATIONS_OWNER_PHONE"
  ])("rejects server-owned Pingram and SMS values exposed through %s", (name) => {
    const result = runCheck({
      envProductionLocal: { [name]: "provider-value-fixture" }
    });
    expect(result.status).not.toBe(0);
    expect(result.stderr).toContain(name);
    expect(result.stderr).toMatch(/server-owned/i);
  });

  test("rejects ambiguous buyer-access flag values", () => {
    const result = runCheck({
      envProductionLocal: {
        VITE_BUYER_ACCESS_ENABLED: "maybe"
      }
    });
    expect(result.status).not.toBe(0);
    expect(result.stderr).toMatch(/explicit boolean/i);
  });

  test("rejects a conflicting .env.local project override", () => {
    const result = runCheck({
      envLocal: {
        VITE_FIREBASE_PROJECT_ID: "another-project"
      }
    });

    expect(result.status).not.toBe(0);
    expect(result.stderr).toMatch(/project mismatch/i);
  });

  test("rejects placeholder Firebase values", () => {
    const result = runCheck({
      env: {
        ...validEnv,
        VITE_FIREBASE_API_KEY: "your_api_key"
      }
    });

    expect(result.status).not.toBe(0);
    expect(result.stderr).toMatch(/placeholder/i);
  });

  test.each(productionUnsafeFlags)("rejects production-unsafe %s", (flagName) => {
    for (const value of ["true", '"true"']) {
      const result = runCheck({
        envProductionLocal: {
          [flagName]: value
        }
      });

      expect(result.status).not.toBe(0);
      expect(result.stderr).toContain(flagName);
      expect(result.stderr).toMatch(/production-unsafe/i);
    }
  });
});
