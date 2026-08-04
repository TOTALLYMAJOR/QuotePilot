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

describe("production mutation retirement", () => {
  test.each([
    ["Firebase", FIREBASE_STUB],
    ["Vercel", VERCEL_STUB]
  ])("keeps the legacy %s command fail-closed", (_provider, script) => {
    const result = spawnSync(process.execPath, [script, "--force"], {
      cwd: ROOT,
      encoding: "utf8"
    });

    expect(result.status).not.toBe(0);
    expect(result.stderr).toMatch(/direct .* production mutation is retired/i);
    expect(result.stderr).toMatch(/separately owned trusted deployer/i);
    expect(fs.readFileSync(script, "utf8")).not.toMatch(/\bnpx\b|spawnSync|execSync/);
  });

  test.each([
    ["Firebase", FIREBASE_WORKFLOW],
    ["Vercel", VERCEL_WORKFLOW]
  ])("keeps the %s workflow provider-mutation-credential-free and prepare-only", (_provider, workflow) => {
    const source = fs.readFileSync(workflow, "utf8");

    expect(source).toMatch(/name: Prepare .* Production Artifact/i);
    expect(source).toMatch(/run-name: prepare\/v1\//);
    expect(source).not.toMatch(/FIREBASE_TOKEN|VERCEL_TOKEN/);
    expect(source).not.toMatch(/secrets\./);
    expect(source).not.toMatch(/\bnpx\b|firebase-tools|vercel\s+(?:build|deploy)/i);
    expect(source).not.toMatch(/scripts\/deploy-(?:firebase|vercel)-production\.mjs/);
    expect(source).toMatch(/persist-credentials:\s*false/);
  });

  test.each([
    ["Firebase", FIREBASE_WORKFLOW],
    ["Vercel", VERCEL_WORKFLOW]
  ])("binds the %s artifact to explicit public buyer configuration", (_provider, workflow) => {
    const source = fs.readFileSync(workflow, "utf8");

    expect(source).toMatch(/^\s+VITE_BUYER_ACCESS_ENABLED:\s*"true"\s*$/m);
    expect(source).toMatch(/^\s+VITE_BUYER_ACCESS_PUBLIC_CTA_ENABLED:\s*"true"\s*$/m);
    expect(source).toMatch(
      /^\s+VITE_BUYER_ACCESS_TURNSTILE_SITE_KEY:\s*\$\{\{ vars\.VITE_BUYER_ACCESS_TURNSTILE_SITE_KEY \}\}\s*$/m
    );
    expect(source).not.toMatch(/vars\.VITE_BUYER_ACCESS_(?:ENABLED|PUBLIC_CTA_ENABLED)/);
    expect(source).not.toMatch(/BUYER_ACCESS_TURNSTILE_SECRET/);
  });

  test("does not persist checkout credentials in the UAT attestation job", () => {
    expect(fs.readFileSync(UAT_WORKFLOW, "utf8")).toMatch(/persist-credentials:\s*false/);
  });

  test("retires the misleading Vercel build alias and legacy Functions scope", () => {
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
  });
});

describe("customer-site mutation retirement", () => {
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
