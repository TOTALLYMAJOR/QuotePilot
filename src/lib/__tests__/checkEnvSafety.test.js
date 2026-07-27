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
