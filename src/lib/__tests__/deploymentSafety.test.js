import fs from "node:fs";
import path from "node:path";
import { spawnSync } from "node:child_process";
import { describe, expect, test } from "vitest";

const ROOT = process.cwd();
const FIREBASE_WORKFLOW = path.join(
  ROOT,
  ".github",
  "workflows",
  "deploy-firebase-hosting.yml"
);
const VERCEL_WORKFLOW = path.join(
  ROOT,
  ".github",
  "workflows",
  "deploy-vercel-production.yml"
);
const UAT_WORKFLOW = path.join(
  ROOT,
  ".github",
  "workflows",
  "release-uat-attestation.yml"
);
const FIREBASE_STUB = path.join(ROOT, "scripts", "deploy-firebase-production.mjs");
const VERCEL_STUB = path.join(ROOT, "scripts", "deploy-vercel-production.mjs");
const CUSTOMER_DEPLOY_SCRIPT = path.join(ROOT, "scripts", "deploy-hosting-customer.mjs");
const CI_LANE_CLASSIFIER = path.join(ROOT, "scripts", "ci-lane-classifier.mjs");
const VERCEL_CONFIG = path.join(ROOT, "vercel.json");

describe("direct production deployment safety", () => {
  test.each([
    ["Firebase", FIREBASE_STUB],
    ["Vercel", VERCEL_STUB]
  ])("keeps the %s command fail-closed outside its exact workflow contract", (_provider, script) => {
    const result = spawnSync(process.execPath, [script, "--force"], {
      cwd: ROOT,
      encoding: "utf8"
    });

    expect(result.status).not.toBe(0);
    expect(result.stderr).toMatch(/Unknown argument: --force/i);
    const source = fs.readFileSync(script, "utf8");
    expect(source).toMatch(/GITHUB_ACTIONS/);
    expect(source).toMatch(/workflow_dispatch/);
    expect(source).toMatch(/refs\/heads\/main/);
    expect(source).toMatch(/verifyDirectProductionReleaseEvidence/);
  });

  test.each([
    ["Firebase", FIREBASE_WORKFLOW],
    ["Vercel", VERCEL_WORKFLOW]
  ])("keeps the %s workflow manual, exact-SHA, protected, and credential-scoped", (provider, workflow) => {
    const source = fs.readFileSync(workflow, "utf8");

    expect(source).toMatch(/name: Deploy .* Production/i);
    expect(source).toMatch(/run-name: deploy\/v1\//);
    expect(source).toMatch(/workflow_dispatch:/);
    expect(source).toMatch(/github\.sha == inputs\.release_sha/);
    expect(source).toMatch(/environment:.*production-solo/);
    expect(source).toMatch(/persist-credentials:\s*false/);
    expect(source).toMatch(/scripts\/verify-direct-production-release\.mjs/);
    expect(source).toMatch(/scripts\/deploy-(?:firebase|vercel)-production\.mjs/);
    expect(source).toMatch(new RegExp(`${provider.toUpperCase()}_TOKEN:\\s*\\$\\{\\{ secrets\\.${provider.toUpperCase()}_TOKEN \\}\\}`));
    const tokenOffset = source.indexOf(`${provider.toUpperCase()}_TOKEN:`);
    const deployStepOffset = source.indexOf(provider === "Firebase"
      ? "- name: Deploy selected Firebase surface"
      : "- name: Build and deploy exact release");
    expect(tokenOffset).toBeGreaterThan(deployStepOffset);
  });

  test.each([
    ["Firebase", FIREBASE_WORKFLOW],
    ["Vercel", VERCEL_WORKFLOW]
  ])("binds the %s production build to explicit public buyer configuration", (_provider, workflow) => {
    const source = fs.readFileSync(workflow, "utf8");
    const stepsOffset = source.indexOf("\n    steps:");
    const jobConfiguration = source.slice(0, stepsOffset);

    expect(source).toMatch(/^\s+VITE_BUYER_ACCESS_ENABLED:\s*"true"\s*$/m);
    expect(source).toMatch(/^\s+VITE_BUYER_ACCESS_PUBLIC_CTA_ENABLED:\s*"true"\s*$/m);
    expect(source).toMatch(
      /^\s+VITE_BUYER_ACCESS_TURNSTILE_SITE_KEY:\s*\$\{\{ vars\.VITE_BUYER_ACCESS_TURNSTILE_SITE_KEY \}\}\s*$/m
    );
    expect(source).not.toMatch(/vars\.VITE_BUYER_ACCESS_(?:ENABLED|PUBLIC_CTA_ENABLED)/);
    expect(source).not.toMatch(/BUYER_ACCESS_TURNSTILE_SECRET/);
    expect(stepsOffset).toBeGreaterThan(0);
    expect(jobConfiguration).not.toContain("VITE_BUYER_ACCESS_ENABLED");
    expect(jobConfiguration).not.toContain("VITE_BUYER_ACCESS_PUBLIC_CTA_ENABLED");
    expect(jobConfiguration).not.toContain("VITE_BUYER_ACCESS_TURNSTILE_SITE_KEY");
    expect(source.match(/VITE_BUYER_ACCESS_ENABLED:/g)).toHaveLength(1);
    expect(source.match(/VITE_BUYER_ACCESS_PUBLIC_CTA_ENABLED:/g)).toHaveLength(1);
    expect(source.match(/VITE_BUYER_ACCESS_TURNSTILE_SITE_KEY:/g)).toHaveLength(1);
  });

  test("does not persist checkout credentials in the UAT attestation job", () => {
    expect(fs.readFileSync(UAT_WORKFLOW, "utf8")).toMatch(/persist-credentials:\s*false/);
  });

  test("keeps one canonical deploy command per production target", () => {
    const rootPackage = JSON.parse(fs.readFileSync(path.join(ROOT, "package.json"), "utf8"));
    const functionsPackage = JSON.parse(
      fs.readFileSync(path.join(ROOT, "functions", "package.json"), "utf8")
    );

    expect(rootPackage.scripts["deploy:vercel:build"]).toBeUndefined();
    expect(rootPackage.scripts["deploy:vercel"]).toBe(
      "node ./scripts/deploy-vercel-production.mjs"
    );
    expect(functionsPackage.scripts.deploy).toBe(
      "node ../scripts/deploy-firebase-production.mjs"
    );
    expect(rootPackage.scripts["release:uat:items"]).toBe(
      "node ./scripts/release-uat-attestation.mjs --print-items"
    );
  });

  test("disables Vercel Git auto-deployments so governed promotion is the only production path", () => {
    const config = JSON.parse(fs.readFileSync(VERCEL_CONFIG, "utf8"));

    expect(config.git).toEqual({ deploymentEnabled: false });
  });
});

describe("customer-site mutation retirement", () => {
  test("classifies the retired customer-site entrypoint as high risk", () => {
    expect(fs.readFileSync(CI_LANE_CLASSIFIER, "utf8")).toContain(
      '"scripts/deploy-hosting-customer.mjs"'
    );
  });

  test("keeps the customer-site command fail-closed without a provider runner", () => {
    const source = fs.readFileSync(CUSTOMER_DEPLOY_SCRIPT, "utf8");
    const result = spawnSync(process.execPath, [CUSTOMER_DEPLOY_SCRIPT, "--force"], {
      cwd: ROOT,
      encoding: "utf8"
    });

    expect(result.status).not.toBe(0);
    expect(result.stderr).toMatch(/Customer Hosting deployment is retired/i);
    expect(source).not.toMatch(/node:child_process|\bnpx\b|firebase-tools|spawnSync|execSync/);
  });
});
