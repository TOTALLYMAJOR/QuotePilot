import fs from "node:fs";
import path from "node:path";
import { createRequire } from "node:module";
import { describe, expect, test } from "vitest";

const require = createRequire(import.meta.url);
const policy = require("../../../functions-connect/runtimePolicy.js");
const manifest = JSON.parse(fs.readFileSync(
  path.resolve(process.cwd(), "config/stripe-connect/staging-foundation.json"),
  "utf8"
));

describe("Stripe Connect foundation policy", () => {
  test("accepts only the exact provider-disabled staging foundation", () => {
    expect(policy.validateStripeConnectFoundationManifest(manifest)).toMatchObject({
      stage: "staging_foundation",
      stripeMode: "sandbox",
      providerCallsEnabled: false,
      accountOnboardingEnabled: false,
      callableExports: []
    });
  });

  test.each([
    ["provider calls", { providerCallsEnabled: true }],
    ["account onboarding", { accountOnboardingEnabled: true }],
    ["Stripe platform binding", { stripePlatformBinding: "acct_unreviewed" }],
    ["callable exports", { callableExports: ["beginStripeConnectOnboarding"] }],
    ["egress", { egressIps: ["203.0.113.10"] }],
    ["minimum rollback", { minimumRollbackSha: "a".repeat(40) }]
  ])("fails closed when %s appears before its gate", (_label, patch) => {
    expect(() => policy.validateStripeConnectFoundationManifest({ ...manifest, ...patch }))
      .toThrow(/foundation manifest rejected/i);
  });

  test("rejects undeclared manifest fields", () => {
    expect(() => policy.validateStripeConnectFoundationManifest({
      ...manifest,
      stripeSecretKey: "must-never-appear"
    })).toThrow(/exact foundation fields/i);
  });

  test("keeps Connect runtime and manifest paths in the high-risk CI inventory", () => {
    const source = fs.readFileSync(
      path.resolve(process.cwd(), "scripts/ci-lane-classifier.mjs"),
      "utf8"
    );
    expect(source).toContain('"functions-connect/"');
    expect(source).toContain('"config/stripe-connect/"');
  });

  test("keeps Connect runtime and manifest paths in the tracked secret scan", () => {
    const source = fs.readFileSync(
      path.resolve(process.cwd(), "scripts/check-secret-assets.mjs"),
      "utf8"
    );
    expect(source).toContain('"functions-connect/"');
    expect(source).toContain('"config/stripe-connect/"');
  });
});
