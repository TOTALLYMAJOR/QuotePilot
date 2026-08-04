import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { spawnSync } from "node:child_process";
import { parseEnv } from "node:util";
import { afterEach, describe, expect, test } from "vitest";
import {
  collectStagingFunctionsEnvironment,
  materializeStagingFunctionsEnvironment,
  stagingEnvironmentReplacementConfirmation
} from "../../../scripts/materialize-firebase-staging-env.mjs";

const PROJECT_ID = "quotepilot-staging-unit";
const tempDirs = [];

function makeRepository() {
  const cwd = fs.mkdtempSync(path.join(os.tmpdir(), "quotepilot-staging-env-"));
  tempDirs.push(cwd);
  fs.mkdirSync(path.join(cwd, "functions"));
  fs.writeFileSync(
    path.join(cwd, "functions", ".gitignore"),
    ".env.*\n!.env.example\n",
    "utf8"
  );
  const initialized = spawnSync("git", ["init", "--quiet"], {
    cwd,
    encoding: "utf8",
    env: { PATH: process.env.PATH || "" }
  });
  if (initialized.status !== 0) {
    throw new Error(`Unable to initialize materializer fixture: ${initialized.stderr}`);
  }
  return cwd;
}

function runtimeEnv(overrides = {}) {
  return {
    APP_BASE_URL: `https://${PROJECT_ID}.web.app/app`,
    APP_BASE_DOMAIN: `${PROJECT_ID}.web.app`,
    AUTH_PLATFORM_ADMIN_EMAILS: "Operator@mbmapps.com,operator@mbmapps.com",
    NOTIFICATIONS_EMAIL_PROVIDER: "none",
    RESEND_API_KEY: "",
    NOTIFICATIONS_SMS_PROVIDER: "none",
    TWILIO_ACCOUNT_SID: "",
    TWILIO_AUTH_TOKEN: "",
    TWILIO_FROM_NUMBER: "",
    NOTIFICATIONS_OWNER_PHONE: "",
    BUYER_ACCESS_ENABLED: "true",
    STRIPE_MODE: "test",
    STRIPE_SECRET_KEY: `rk_${"test"}_materializerfixture`,
    STRIPE_WEBHOOK_SECRET: `whsec_${"materializerfixture"}`,
    ...overrides
  };
}

function validatedEnv(overrides = {}) {
  return collectStagingFunctionsEnvironment(PROJECT_ID, runtimeEnv(overrides));
}

afterEach(() => {
  while (tempDirs.length) {
    fs.rmSync(tempDirs.pop(), { recursive: true, force: true });
  }
});

describe("Firebase staging Functions environment materializer", () => {
  test("creates one ignored mode-0600 test-only file and returns no credentials", () => {
    const root = makeRepository();
    const result = materializeStagingFunctionsEnvironment({
      root,
      projectId: PROJECT_ID,
      env: validatedEnv()
    });
    const outputPath = path.join(root, result.relativePath);

    expect(result).toEqual({
      relativePath: `functions/.env.${PROJECT_ID}`,
      replaced: false
    });
    expect(fs.existsSync(outputPath)).toBe(true);
    expect(fs.statSync(outputPath).mode & 0o777).toBe(0o600);
    const output = parseEnv(fs.readFileSync(outputPath, "utf8"));
    expect(output).toMatchObject({
      APP_BASE_URL: `https://${PROJECT_ID}.web.app/app`,
      APP_BASE_DOMAIN: `${PROJECT_ID}.web.app`,
      AUTH_PLATFORM_ADMIN_EMAILS: "operator@mbmapps.com",
      NOTIFICATIONS_EMAIL_PROVIDER: "none",
      NOTIFICATIONS_SMS_PROVIDER: "none",
      BUYER_ACCESS_ENABLED: "true",
      STRIPE_MODE: "test"
    });
    expect(output.STRIPE_SECRET_KEY).toMatch(/^rk_test_/);
    expect(output.STRIPE_WEBHOOK_SECRET).toMatch(/^whsec_/);
    expect(JSON.stringify(result)).not.toContain(output.STRIPE_SECRET_KEY);
    expect(JSON.stringify(result)).not.toContain(output.STRIPE_WEBHOOK_SECRET);
  });

  test("is create-only and requires the exact project-bound replacement token", () => {
    const root = makeRepository();
    materializeStagingFunctionsEnvironment({
      root,
      projectId: PROJECT_ID,
      env: validatedEnv()
    });
    const outputPath = path.join(root, "functions", `.env.${PROJECT_ID}`);
    const original = fs.readFileSync(outputPath, "utf8");
    const replacementEnv = validatedEnv({
      STRIPE_WEBHOOK_SECRET: `whsec_${"replacementfixture"}`
    });

    expect(() => materializeStagingFunctionsEnvironment({
      root,
      projectId: PROJECT_ID,
      env: replacementEnv
    })).toThrow(/refusing to overwrite/i);
    expect(fs.readFileSync(outputPath, "utf8")).toBe(original);

    expect(() => materializeStagingFunctionsEnvironment({
      root,
      projectId: PROJECT_ID,
      env: replacementEnv,
      replace: true,
      confirmation: `REPLACE functions/.env.${PROJECT_ID} FOR another-project`
    })).toThrow(/requires --confirm/i);
    expect(fs.readFileSync(outputPath, "utf8")).toBe(original);

    const confirmation = stagingEnvironmentReplacementConfirmation(PROJECT_ID);
    const replaced = materializeStagingFunctionsEnvironment({
      root,
      projectId: PROJECT_ID,
      env: replacementEnv,
      replace: true,
      confirmation
    });
    expect(replaced).toEqual({
      relativePath: `functions/.env.${PROJECT_ID}`,
      replaced: true
    });
    expect(parseEnv(fs.readFileSync(outputPath, "utf8")).STRIPE_WEBHOOK_SECRET)
      .toBe(replacementEnv.STRIPE_WEBHOOK_SECRET);
    expect(fs.statSync(outputPath).mode & 0o777).toBe(0o600);
  });

  test("rejects live Stripe settings before creating a file", () => {
    const root = makeRepository();

    expect(() => validatedEnv({
      STRIPE_MODE: "live",
      STRIPE_SECRET_KEY: `rk_${"live"}_materializerfixture`
    })).toThrow(/test.*required|live mode.*forbidden/i);
    expect(fs.existsSync(path.join(root, "functions", `.env.${PROJECT_ID}`))).toBe(false);
  });

  test("refuses a path that is not ignored by Git", () => {
    const root = makeRepository();
    fs.writeFileSync(path.join(root, "functions", ".gitignore"), "", "utf8");

    expect(() => materializeStagingFunctionsEnvironment({
      root,
      projectId: PROJECT_ID,
      env: validatedEnv()
    })).toThrow(/must be ignored by Git/i);
  });
});
