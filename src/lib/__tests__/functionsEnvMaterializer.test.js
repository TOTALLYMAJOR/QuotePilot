import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { spawnSync } from "node:child_process";
import { afterEach, describe, expect, test } from "vitest";

const SCRIPT_PATH = path.resolve(process.cwd(), "scripts/materialize-functions-env.mjs");
const tempDirs = [];

function runMaterializer(overrides = {}, { existing = "", args = [] } = {}) {
  const cwd = fs.mkdtempSync(path.join(os.tmpdir(), "quotepilot-functions-env-"));
  tempDirs.push(cwd);
  fs.mkdirSync(path.join(cwd, "functions"));
  if (existing) {
    fs.writeFileSync(
      path.join(cwd, "functions", ".env.tonicatering"),
      existing,
      { mode: 0o600 }
    );
  }
  const env = {
    PATH: process.env.PATH || "",
    FIREBASE_PROJECT_ID: "tonicatering",
    APP_BASE_URL: "https://quotepilot.mbmapps.com/app",
    APP_BASE_DOMAIN: "mbmapps.com",
    AUTH_PLATFORM_ADMIN_EMAILS: "operator@mbmapps.com",
    NOTIFICATIONS_EMAIL_PROVIDER: "none",
    EMAIL_FROM_NAME: "QuotePilot by MBMapps",
    EMAIL_FROM_EMAIL: "onboarding@quotepilot.mbmapps.com",
    NOTIFICATIONS_SMS_PROVIDER: "none",
    STRIPE_MODE: "live",
    STRIPE_SECRET_KEY: `rk_${"live"}_test_only_secret`,
    STRIPE_WEBHOOK_SECRET: `whsec_${"test_only_webhook_secret"}`,
    ...overrides
  };
  const result = spawnSync(process.execPath, [SCRIPT_PATH, ...args], {
    cwd,
    env,
    encoding: "utf8"
  });
  return { cwd, result };
}

afterEach(() => {
  while (tempDirs.length) {
    fs.rmSync(tempDirs.pop(), { recursive: true, force: true });
  }
});

describe("Firebase Functions env materializer", { timeout: 30_000 }, () => {
  test("writes a project-scoped env file while providers remain disabled", () => {
    const { cwd, result } = runMaterializer();
    expect(result.status).toBe(0);

    const outputPath = path.join(cwd, "functions", ".env.tonicatering");
    const output = fs.readFileSync(outputPath, "utf8");
    expect(output).toContain("APP_BASE_URL=https://quotepilot.mbmapps.com/app");
    expect(output).toContain("NOTIFICATIONS_EMAIL_PROVIDER=none");
    expect(output).toContain("NOTIFICATIONS_SMS_PROVIDER=none");
    expect(output).toContain("STRIPE_MODE=live");
    expect(output).not.toContain("RESEND_API_KEY");
    expect(output).not.toContain("TWILIO_ACCOUNT_SID");
    expect(output).not.toContain("TWILIO_AUTH_TOKEN");
    expect(output).not.toContain("TWILIO_FROM_NUMBER");
    expect(output).not.toContain("NOTIFICATIONS_OWNER_PHONE");
    expect(result.stdout).not.toContain("test_only_secret");
  });

  test("rejects test mode and mismatched Stripe key prefixes for production", () => {
    const testMode = runMaterializer({
      STRIPE_MODE: "test",
      STRIPE_SECRET_KEY: `sk_${"test"}_fixture`
    }).result;
    expect(testMode.status).not.toBe(0);
    expect(testMode.stderr).toMatch(/requires STRIPE_MODE=live/i);

    const mismatchedKey = runMaterializer({
      STRIPE_SECRET_KEY: `sk_${"test"}_fixture`
    }).result;
    expect(mismatchedKey.status).not.toBe(0);
    expect(mismatchedKey.stderr).toMatch(/live-mode secret or restricted key/i);
  });

  test("rejects placeholder platform authority", () => {
    const { result } = runMaterializer({
      AUTH_PLATFORM_ADMIN_EMAILS: "platform-owner@example.com"
    });
    expect(result.status).not.toBe(0);
    expect(result.stderr).toMatch(/placeholder email/i);
  });

  test("requires a provider key before Resend can be enabled", () => {
    const { result } = runMaterializer({
      NOTIFICATIONS_EMAIL_PROVIDER: "resend",
      RESEND_API_KEY: ""
    });
    expect(result.status).not.toBe(0);
    expect(result.stderr).toMatch(/RESEND_API_KEY is required/i);
  });

  test("rejects retained Resend credentials while email delivery is disabled", () => {
    const { result } = runMaterializer({
      RESEND_API_KEY: "test-only-disabled-provider-secret"
    });
    expect(result.status).not.toBe(0);
    expect(result.stderr).toMatch(/must be unset/i);
  });

  test("rejects retained Twilio credentials while SMS delivery is disabled", () => {
    const { result } = runMaterializer({
      TWILIO_ACCOUNT_SID: "test-only-disabled-provider-account"
    });
    expect(result.status).not.toBe(0);
    expect(result.stderr).toMatch(/must be unset/i);
  });

  test("rejects a Functions environment for a different Firebase project", () => {
    const { result } = runMaterializer({
      FIREBASE_PROJECT_ID: "another-project"
    });

    expect(result.status).not.toBe(0);
    expect(result.stderr).toMatch(/must target tonicatering/i);
  });

  test("refuses to overwrite an existing project environment by default", () => {
    const existing = "USER_OWNED_SECRET=preserve-me\n";
    const { cwd, result } = runMaterializer({}, { existing });

    expect(result.status).not.toBe(0);
    expect(result.stderr).toMatch(/refusing to overwrite/i);
    expect(
      fs.readFileSync(path.join(cwd, "functions", ".env.tonicatering"), "utf8")
    ).toBe(existing);
  });

  test("validates without rewriting an existing project environment", () => {
    const existing = "USER_OWNED_SECRET=preserve-me\n";
    const { cwd, result } = runMaterializer({}, {
      existing,
      args: ["--validate-only"]
    });

    expect(result.status).toBe(0);
    expect(
      fs.readFileSync(path.join(cwd, "functions", ".env.tonicatering"), "utf8")
    ).toBe(existing);
  });
});
