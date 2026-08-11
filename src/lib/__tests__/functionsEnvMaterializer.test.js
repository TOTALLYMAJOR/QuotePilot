import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { spawnSync } from "node:child_process";
import { afterEach, describe, expect, test } from "vitest";

const SCRIPT_PATH = path.resolve(process.cwd(), "scripts/materialize-functions-env.mjs");
const INTEGRATION_OPS_SOURCE = fs.readFileSync(
  path.resolve(process.cwd(), "src/components/IntegrationOpsModal.jsx"),
  "utf8"
);
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
    EMAIL_FROM_NAME: "QuotePilot by MBMApps",
    EMAIL_FROM_EMAIL: "quotepilot@leaguepilot.us",
    NOTIFICATIONS_SMS_PROVIDER: "none",
    STRIPE_MODE: "live",
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
  test("keeps operator guidance aligned with dotenv and Secret Manager ownership", () => {
    expect(INTEGRATION_OPS_SOURCE).toContain(
      "local validation of the production deploy configuration only"
    );
    expect(INTEGRATION_OPS_SOURCE).toContain(
      "disposable emulator configuration must use STRIPE_MODE=test"
    );
    expect(INTEGRATION_OPS_SOURCE).toContain(
      "fixtures only in the separately ignored functions/.secret.local"
    );
    expect(INTEGRATION_OPS_SOURCE).toContain(
      "production provider credentials belong only in Firebase Secret Manager bindings"
    );
    expect(INTEGRATION_OPS_SOURCE).toContain("PINGRAM_API_ORIGIN=https://api.pingram.io");
    expect(INTEGRATION_OPS_SOURCE).toContain("PINGRAM_FROM_NUMBER=");
    expect(INTEGRATION_OPS_SOURCE).toContain("PINGRAM_CONFIGURATION_GENERATION=");
    expect(INTEGRATION_OPS_SOURCE).toContain("NOTIFICATIONS_OWNER_SMS_CONSENT=granted");
    expect(INTEGRATION_OPS_SOURCE).not.toContain("TWILIO_FROM_NUMBER=");
    expect(INTEGRATION_OPS_SOURCE).not.toContain('"TWILIO_AUTH_TOKEN=",');
    expect(INTEGRATION_OPS_SOURCE).not.toContain('"PINGRAM_API_KEY=",');
    expect(INTEGRATION_OPS_SOURCE).not.toContain('"PINGRAM_WEBHOOK_SECRET=",');
    expect(INTEGRATION_OPS_SOURCE).not.toContain(
      "Use placeholders or non-production provider values only; never commit or paste secrets here"
    );
  });

  test("writes a project-scoped env file while providers remain disabled", () => {
    const { cwd, result } = runMaterializer();
    expect(result.status).toBe(0);

    const outputPath = path.join(cwd, "functions", ".env.tonicatering");
    const output = fs.readFileSync(outputPath, "utf8");
    expect(output).toContain("APP_BASE_URL=https://quotepilot.mbmapps.com/app");
    expect(output).toContain("NOTIFICATIONS_EMAIL_PROVIDER=none");
    expect(output).toContain("NOTIFICATIONS_SMS_PROVIDER=none");
    expect(output).toContain("STRIPE_MODE=live");
    expect(output).toContain("COMMERCIAL_CHANGE_AUTHORITY_ENABLED=false");
    expect(output).toContain("REVENUE_AUTOPILOT_ENABLED=false");
    expect(output).toContain("REVENUE_AUTOPILOT_SENDS_ENABLED=false");
    expect(output).toContain("BUYER_ACCESS_ENABLED=false");
    expect(output).toContain("BUYER_ACCESS_STRIPE_MODE=test");
    expect(output).toContain(
      "BUYER_ACCESS_APP_BASE_URL=https://quotepilot.mbmapps.com/app"
    );
    expect(output).not.toContain("BUYER_ACCESS_ALLOWED_EMAILS");
    expect(output).not.toContain("BUYER_ACCESS_TURNSTILE_HOSTNAMES");
    expect(output).not.toContain("BUYER_ACCESS_STRIPE_SECRET_KEY");
    expect(output).not.toContain("BUYER_ACCESS_STRIPE_WEBHOOK_SECRET");
    expect(output).not.toContain("BUYER_ACCESS_TURNSTILE_SECRET");
    expect(output).not.toContain("BUYER_ACCESS_RATE_LIMIT_SECRET");
    expect(output).not.toContain("RESEND_API_KEY");
    expect(output).not.toContain("RESEND_WEBHOOK_SECRET");
    expect(output).not.toContain("STRIPE_SECRET_KEY");
    expect(output).not.toContain("STRIPE_WEBHOOK_SECRET");
    expect(output).not.toContain("TWILIO_ACCOUNT_SID");
    expect(output).not.toContain("TWILIO_AUTH_TOKEN");
    expect(output).not.toContain("REVENUE_AUTOPILOT_TOKEN_SECRET");
    expect(output).not.toContain("TWILIO_MESSAGING_SERVICE_SID");
    expect(output).not.toContain("NOTIFICATIONS_OWNER_PHONE");
    expect(output).not.toContain("NOTIFICATIONS_OWNER_SMS_CONSENT");
    expect(output).not.toContain("PINGRAM_API_ORIGIN");
    expect(output).not.toContain("PINGRAM_FROM_NUMBER");
    expect(output).not.toContain("PINGRAM_CONFIGURATION_GENERATION");
    expect(output).not.toContain("PINGRAM_API_KEY");
    expect(output).not.toContain("PINGRAM_WEBHOOK_SECRET");
    expect(output).not.toContain("SMS_CONTACT_DIGEST_SECRET");
    expect(result.stdout).not.toContain("test_only_secret");
  });

  test("rejects test Stripe mode for production", () => {
    const testMode = runMaterializer({
      STRIPE_MODE: "test"
    }).result;
    expect(testMode.status).not.toBe(0);
    expect(testMode.stderr).toMatch(/requires STRIPE_MODE=live/i);
  });

  test("keeps Commercial Change Authority enforcement explicit and fail closed", () => {
    const enabled = runMaterializer({
      COMMERCIAL_CHANGE_AUTHORITY_ENABLED: "true"
    });
    expect(enabled.result.status).toBe(0);
    expect(fs.readFileSync(
      path.join(enabled.cwd, "functions", ".env.tonicatering"),
      "utf8"
    )).toContain("COMMERCIAL_CHANGE_AUTHORITY_ENABLED=true");

    const invalid = runMaterializer({
      COMMERCIAL_CHANGE_AUTHORITY_ENABLED: "enabled"
    }).result;
    expect(invalid.status).not.toBe(0);
    expect(invalid.stderr).toMatch(/COMMERCIAL_CHANGE_AUTHORITY_ENABLED must be true or false/i);
  });

  test("keeps Revenue Autopilot activation and outbound sends independently fail closed", () => {
    const enabledOnly = runMaterializer({
      REVENUE_AUTOPILOT_ENABLED: "true"
    });
    expect(enabledOnly.result.status).toBe(0);
    const enabledOnlyOutput = fs.readFileSync(
      path.join(enabledOnly.cwd, "functions", ".env.tonicatering"),
      "utf8"
    );
    expect(enabledOnlyOutput).toContain("REVENUE_AUTOPILOT_ENABLED=true");
    expect(enabledOnlyOutput).toContain("REVENUE_AUTOPILOT_SENDS_ENABLED=false");

    const sendsWithoutRuntime = runMaterializer({
      REVENUE_AUTOPILOT_SENDS_ENABLED: "true",
      NOTIFICATIONS_EMAIL_PROVIDER: "resend"
    }).result;
    expect(sendsWithoutRuntime.status).not.toBe(0);
    expect(sendsWithoutRuntime.stderr).toMatch(/cannot be true while REVENUE_AUTOPILOT_ENABLED is false/i);

    const sendsWithoutProvider = runMaterializer({
      REVENUE_AUTOPILOT_ENABLED: "true",
      REVENUE_AUTOPILOT_SENDS_ENABLED: "true"
    }).result;
    expect(sendsWithoutProvider.status).not.toBe(0);
    expect(sendsWithoutProvider.stderr).toMatch(/require NOTIFICATIONS_EMAIL_PROVIDER=resend/i);

    const outboundReady = runMaterializer({
      REVENUE_AUTOPILOT_ENABLED: "true",
      REVENUE_AUTOPILOT_SENDS_ENABLED: "true",
      NOTIFICATIONS_EMAIL_PROVIDER: "resend"
    });
    expect(outboundReady.result.status).toBe(0);
    const outboundOutput = fs.readFileSync(
      path.join(outboundReady.cwd, "functions", ".env.tonicatering"),
      "utf8"
    );
    expect(outboundOutput).toContain("REVENUE_AUTOPILOT_SENDS_ENABLED=true");
    expect(outboundOutput).not.toContain("REVENUE_AUTOPILOT_TOKEN_SECRET");

    for (const [name, value] of [
      ["REVENUE_AUTOPILOT_ENABLED", "enabled"],
      ["REVENUE_AUTOPILOT_SENDS_ENABLED", "enabled"]
    ]) {
      const invalid = runMaterializer({ [name]: value }).result;
      expect(invalid.status).not.toBe(0);
      expect(invalid.stderr).toContain(`${name} must be true or false`);
    }
  });

  test("rejects placeholder platform authority", () => {
    const { result } = runMaterializer({
      AUTH_PLATFORM_ADMIN_EMAILS: "platform-owner@example.com"
    });
    expect(result.status).not.toBe(0);
    expect(result.stderr).toMatch(/placeholder email/i);
  });

  test("materializes only approved non-secret configuration for public buyer access", () => {
    const { cwd, result } = runMaterializer({
      BUYER_ACCESS_ENABLED: "true",
      BUYER_ACCESS_TURNSTILE_HOSTNAMES:
        "quotepilot.mbmapps.com, tonicatering.web.app"
    });
    expect(result.status).toBe(0);

    const output = fs.readFileSync(
      path.join(cwd, "functions", ".env.tonicatering"),
      "utf8"
    );
    expect(output).toContain("BUYER_ACCESS_ENABLED=true");
    expect(output).toContain("BUYER_ACCESS_STRIPE_MODE=test");
    expect(output).toContain(
      "BUYER_ACCESS_TURNSTILE_HOSTNAMES=quotepilot.mbmapps.com,tonicatering.web.app"
    );
    expect(output).not.toContain("BUYER_ACCESS_ALLOWED_EMAILS");
    expect(output).not.toContain("BUYER_ACCESS_STRIPE_SECRET_KEY");
    expect(output).not.toContain("BUYER_ACCESS_STRIPE_WEBHOOK_SECRET");
    expect(output).not.toContain("BUYER_ACCESS_TURNSTILE_SECRET");
    expect(output).not.toContain("BUYER_ACCESS_RATE_LIMIT_SECRET");
  });

  test("fails closed for missing Turnstile hosts or a non-test buyer mode", () => {
    const missingHostnames = runMaterializer({
      BUYER_ACCESS_ENABLED: "true"
    }).result;
    expect(missingHostnames.status).not.toBe(0);
    expect(missingHostnames.stderr).toMatch(/BUYER_ACCESS_TURNSTILE_HOSTNAMES is required/i);

    const wrongMode = runMaterializer({
      BUYER_ACCESS_STRIPE_MODE: "live"
    }).result;
    expect(wrongMode.status).not.toBe(0);
    expect(wrongMode.stderr).toMatch(/must remain test/i);
  });

  test("rejects legacy allowlists and unapproved Turnstile hostnames", () => {
    const legacyAllowlist = runMaterializer({
      BUYER_ACCESS_ALLOWED_EMAILS: "buyer@mbmapps.com"
    }).result;
    expect(legacyAllowlist.status).not.toBe(0);
    expect(legacyAllowlist.stderr).toMatch(/obsolete/i);

    for (const hostnames of [
      "quotepilot.mbmapps.com",
      "quotepilot.mbmapps.com,evil.example",
      "https://quotepilot.mbmapps.com,tonicatering.web.app"
    ]) {
      const result = runMaterializer({
        BUYER_ACCESS_ENABLED: "true",
        BUYER_ACCESS_TURNSTILE_HOSTNAMES: hostnames
      }).result;
      expect(result.status).not.toBe(0);
      expect(result.stderr).toMatch(/exact approved QuotePilot production hosts/i);
    }
  });

  test("rejects generic provider secrets in dotenv because Secret Manager owns them", () => {
    for (const [name, value] of [
      ["RESEND_API_KEY", "re_secret_fixture"],
      ["RESEND_WEBHOOK_SECRET", "resend-webhook-secret-fixture"],
      ["TWILIO_AUTH_TOKEN", "twilio-secret-fixture"],
      ["PINGRAM_API_KEY", "pingram-secret-fixture"],
      ["PINGRAM_WEBHOOK_SECRET", "pingram-webhook-secret-fixture"],
      ["SMS_CONTACT_DIGEST_SECRET", "sms-digest-secret-fixture"],
      ["STRIPE_SECRET_KEY", "rk_live_secret_fixture"],
      ["STRIPE_WEBHOOK_SECRET", "whsec_secret_fixture"],
      ["REVENUE_AUTOPILOT_TOKEN_SECRET", "autopilot-token-secret-fixture"]
    ]) {
      const { result } = runMaterializer({ [name]: value });
      expect(result.status).not.toBe(0);
      expect(result.stderr).toMatch(/Firebase Secret Manager/i);
      expect(result.stderr).toContain(name);
    }
  });

  test("rejects buyer provider secrets in dotenv because Secret Manager owns them", () => {
    const secretKey = runMaterializer({
      BUYER_ACCESS_STRIPE_SECRET_KEY: `rk_${"test"}_fixture`
    }).result;
    expect(secretKey.status).not.toBe(0);
    expect(secretKey.stderr).toMatch(/Firebase Secret Manager/i);

    const webhookSecret = runMaterializer({
      BUYER_ACCESS_STRIPE_WEBHOOK_SECRET: `whsec_${"fixture"}`
    }).result;
    expect(webhookSecret.status).not.toBe(0);
    expect(webhookSecret.stderr).toMatch(/Firebase Secret Manager/i);

    const turnstileSecret = runMaterializer({
      BUYER_ACCESS_TURNSTILE_SECRET: "turnstile-secret-fixture"
    }).result;
    expect(turnstileSecret.status).not.toBe(0);
    expect(turnstileSecret.stderr).toMatch(/Firebase Secret Manager/i);

    const rateLimitSecret = runMaterializer({
      BUYER_ACCESS_RATE_LIMIT_SECRET: "rate-limit-secret-fixture"
    }).result;
    expect(rateLimitSecret.status).not.toBe(0);
    expect(rateLimitSecret.stderr).toMatch(/Firebase Secret Manager/i);
  });

  test("enables Resend without materializing its Secret Manager credential", () => {
    const { cwd, result } = runMaterializer({
      NOTIFICATIONS_EMAIL_PROVIDER: "resend"
    });
    expect(result.status).toBe(0);
    const output = fs.readFileSync(
      path.join(cwd, "functions", ".env.tonicatering"),
      "utf8"
    );
    expect(output).toContain("NOTIFICATIONS_EMAIL_PROVIDER=resend");
    expect(output).not.toContain("RESEND_API_KEY");
  });

  test("rejects retained Twilio credentials while SMS delivery is disabled", () => {
    const { result } = runMaterializer({
      TWILIO_ACCOUNT_SID: "test-only-disabled-provider-account"
    });
    expect(result.status).not.toBe(0);
    expect(result.stderr).toMatch(/must be unset/i);
  });

  test("enables Twilio with a Messaging Service and without materializing its secret", () => {
    const { cwd, result } = runMaterializer({
      NOTIFICATIONS_SMS_PROVIDER: "twilio",
      TWILIO_ACCOUNT_SID: `AC${"1".repeat(32)}`,
      TWILIO_MESSAGING_SERVICE_SID: `MG${"2".repeat(32)}`,
      NOTIFICATIONS_OWNER_PHONE: "+13125550123",
      NOTIFICATIONS_OWNER_SMS_CONSENT: "granted"
    });
    expect(result.status).toBe(0);

    const output = fs.readFileSync(
      path.join(cwd, "functions", ".env.tonicatering"),
      "utf8"
    );
    expect(output).toContain("NOTIFICATIONS_SMS_PROVIDER=twilio");
    expect(output).toContain(`TWILIO_ACCOUNT_SID=AC${"1".repeat(32)}`);
    expect(output).toContain(`TWILIO_MESSAGING_SERVICE_SID=MG${"2".repeat(32)}`);
    expect(output).toContain("NOTIFICATIONS_OWNER_PHONE=+13125550123");
    expect(output).toContain("NOTIFICATIONS_OWNER_SMS_CONSENT=granted");
    expect(output).not.toContain("TWILIO_AUTH_TOKEN");
    expect(output).not.toContain("TWILIO_FROM_NUMBER");
  });

  test("enables Pingram only with an approved origin, dedicated sender, consent, and no materialized secrets", () => {
    const { cwd, result } = runMaterializer({
      NOTIFICATIONS_SMS_PROVIDER: "pingram",
      PINGRAM_API_ORIGIN: "https://api.pingram.io",
      PINGRAM_FROM_NUMBER: "+13125550124",
      PINGRAM_CONFIGURATION_GENERATION: "sandbox-2026-08-11-01",
      NOTIFICATIONS_OWNER_PHONE: "+13125550123",
      NOTIFICATIONS_OWNER_SMS_CONSENT: "granted"
    });
    expect(result.status).toBe(0);

    const output = fs.readFileSync(
      path.join(cwd, "functions", ".env.tonicatering"),
      "utf8"
    );
    expect(output).toContain("NOTIFICATIONS_SMS_PROVIDER=pingram");
    expect(output).toContain("PINGRAM_API_ORIGIN=https://api.pingram.io");
    expect(output).toContain("PINGRAM_FROM_NUMBER=+13125550124");
    expect(output).toContain(
      "PINGRAM_CONFIGURATION_GENERATION=sandbox-2026-08-11-01"
    );
    expect(output).toContain("NOTIFICATIONS_OWNER_PHONE=+13125550123");
    expect(output).toContain("NOTIFICATIONS_OWNER_SMS_CONSENT=granted");
    expect(output).not.toContain("PINGRAM_API_KEY");
    expect(output).not.toContain("PINGRAM_WEBHOOK_SECRET");
    expect(output).not.toContain("SMS_CONTACT_DIGEST_SECRET");
    expect(output).not.toContain("TWILIO_ACCOUNT_SID");
  });

  test("rejects incomplete, unapproved, or cross-provider Pingram configuration", () => {
    const base = {
      NOTIFICATIONS_SMS_PROVIDER: "pingram",
      PINGRAM_API_ORIGIN: "https://api.pingram.io",
      PINGRAM_FROM_NUMBER: "+13125550124",
      PINGRAM_CONFIGURATION_GENERATION: "sandbox-2026-08-11-01",
      NOTIFICATIONS_OWNER_PHONE: "+13125550123",
      NOTIFICATIONS_OWNER_SMS_CONSENT: "granted"
    };
    for (const key of [
      "PINGRAM_API_ORIGIN",
      "PINGRAM_FROM_NUMBER",
      "PINGRAM_CONFIGURATION_GENERATION",
      "NOTIFICATIONS_OWNER_PHONE",
      "NOTIFICATIONS_OWNER_SMS_CONSENT"
    ]) {
      const result = runMaterializer({ ...base, [key]: "" }).result;
      expect(result.status, key).not.toBe(0);
    }

    const unapprovedOrigin = runMaterializer({
      ...base,
      PINGRAM_API_ORIGIN: "https://api.example.com"
    }).result;
    expect(unapprovedOrigin.status).not.toBe(0);
    expect(unapprovedOrigin.stderr).toMatch(/exact approved Pingram HTTPS API origin/i);

    const invalidSender = runMaterializer({
      ...base,
      PINGRAM_FROM_NUMBER: "3125550124"
    }).result;
    expect(invalidSender.status).not.toBe(0);
    expect(invalidSender.stderr).toMatch(/E\.164/i);

    const invalidGeneration = runMaterializer({
      ...base,
      PINGRAM_CONFIGURATION_GENERATION: "Production Generation"
    }).result;
    expect(invalidGeneration.status).not.toBe(0);
    expect(invalidGeneration.stderr).toMatch(/configuration_generation/i);

    const crossProvider = runMaterializer({
      ...base,
      TWILIO_ACCOUNT_SID: `AC${"1".repeat(32)}`
    }).result;
    expect(crossProvider.status).not.toBe(0);
    expect(crossProvider.stderr).toMatch(/Twilio configuration must be unset/i);
  });

  test("rejects owner destination or consent while SMS is disabled", () => {
    for (const overrides of [
      { NOTIFICATIONS_OWNER_PHONE: "+13125550123" },
      { NOTIFICATIONS_OWNER_SMS_CONSENT: "granted" },
      { PINGRAM_API_ORIGIN: "https://api.pingram.io" },
      { PINGRAM_FROM_NUMBER: "+13125550124" },
      { PINGRAM_CONFIGURATION_GENERATION: "sandbox-2026-08-11-01" }
    ]) {
      const result = runMaterializer(overrides).result;
      expect(result.status).not.toBe(0);
      expect(result.stderr).toMatch(/must be unset/i);
    }
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
