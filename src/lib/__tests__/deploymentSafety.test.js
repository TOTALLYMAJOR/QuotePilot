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
  ])("binds the %s production build to explicit workspace and public buyer configuration", (_provider, workflow) => {
    const source = fs.readFileSync(workflow, "utf8");
    const stepsOffset = source.indexOf("\n    steps:");
    const jobConfiguration = source.slice(0, stepsOffset);

    expect(source).toMatch(/^\s+VITE_APP_URL:\s*\$\{\{ vars\.APP_BASE_URL \}\}\s*$/m);
    expect(source).toMatch(/^\s+VITE_APP_HOST:\s*quotepilot\.mbmapps\.com\s*$/m);
    expect(source).toMatch(/^\s+VITE_BASE_DOMAIN:\s*\$\{\{ vars\.APP_BASE_DOMAIN \}\}\s*$/m);
    expect(source).toMatch(
      /^\s+VITE_DEFAULT_ORGANIZATION_ID:\s*\$\{\{ vars\.VITE_DEFAULT_ORGANIZATION_ID \}\}\s*$/m
    );
    expect(source).toMatch(/^\s+VITE_CUSTOMER_CENTERED_WORKSPACE_ENABLED:\s*"true"\s*$/m);
    expect(source).toMatch(/^\s+VITE_BUYER_ACCESS_ENABLED:\s*"true"\s*$/m);
    expect(source).toMatch(/^\s+VITE_BUYER_ACCESS_PUBLIC_CTA_ENABLED:\s*"true"\s*$/m);
    expect(source).toMatch(
      /^\s+VITE_BUYER_ACCESS_TURNSTILE_SITE_KEY:\s*\$\{\{ vars\.VITE_BUYER_ACCESS_TURNSTILE_SITE_KEY \}\}\s*$/m
    );
    expect(source).not.toMatch(/vars\.VITE_BUYER_ACCESS_(?:ENABLED|PUBLIC_CTA_ENABLED)/);
    expect(source).not.toMatch(/BUYER_ACCESS_TURNSTILE_SECRET/);
    expect(stepsOffset).toBeGreaterThan(0);
    expect(jobConfiguration).not.toContain("VITE_APP_URL");
    expect(jobConfiguration).not.toContain("VITE_APP_HOST");
    expect(jobConfiguration).not.toContain("VITE_BASE_DOMAIN");
    expect(jobConfiguration).not.toContain("VITE_DEFAULT_ORGANIZATION_ID");
    expect(jobConfiguration).not.toContain("VITE_CUSTOMER_CENTERED_WORKSPACE_ENABLED");
    expect(jobConfiguration).not.toContain("VITE_BUYER_ACCESS_ENABLED");
    expect(jobConfiguration).not.toContain("VITE_BUYER_ACCESS_PUBLIC_CTA_ENABLED");
    expect(jobConfiguration).not.toContain("VITE_BUYER_ACCESS_TURNSTILE_SITE_KEY");
    expect(source.match(/VITE_CUSTOMER_CENTERED_WORKSPACE_ENABLED:/g)).toHaveLength(1);
    expect(source.match(/VITE_APP_URL:/g)).toHaveLength(1);
    expect(source.match(/VITE_APP_HOST:/g)).toHaveLength(1);
    expect(source.match(/VITE_BASE_DOMAIN:/g)).toHaveLength(1);
    expect(source.match(/VITE_DEFAULT_ORGANIZATION_ID:/g)).toHaveLength(1);
    expect(source.match(/VITE_BUYER_ACCESS_ENABLED:/g)).toHaveLength(1);
    expect(source.match(/VITE_BUYER_ACCESS_PUBLIC_CTA_ENABLED:/g)).toHaveLength(1);
    expect(source.match(/VITE_BUYER_ACCESS_TURNSTILE_SITE_KEY:/g)).toHaveLength(1);
  });

  test.each([
    ["Firebase", FIREBASE_WORKFLOW],
    ["Vercel", VERCEL_WORKFLOW]
  ])("binds the %s Ambient and staffing production flags once", (_provider, workflow) => {
    const source = fs.readFileSync(workflow, "utf8");
    const envExample = fs.readFileSync(path.join(ROOT, ".env.example"), "utf8");
    const quoteHistory = fs.readFileSync(
      path.join(ROOT, "src", "components", "QuoteHistoryModal.jsx"),
      "utf8"
    );
    const app = fs.readFileSync(path.join(ROOT, "src", "App.jsx"), "utf8");
    const portal = fs.readFileSync(
      path.join(ROOT, "src", "components", "CustomerPortalView.jsx"),
      "utf8"
    );

    expect(source.match(/VITE_AMBIENT_UI_ENABLED: "true"/g)).toHaveLength(1);
    expect(source.match(/VITE_AMBIENT_UI_ENABLED/g)).toHaveLength(1);
    expect(source.match(/VITE_OPERATIONAL_STAFFING_ENABLED: "true"/g)).toHaveLength(1);
    expect(source.match(/VITE_OPERATIONAL_STAFFING_ENABLED/g)).toHaveLength(1);
    expect(envExample).toMatch(/^VITE_AMBIENT_UI_ENABLED=false$/m);
    expect(envExample).toMatch(/^VITE_OPERATIONAL_STAFFING_ENABLED=false$/m);
    expect(envExample).toMatch(/^VITE_PILOT_DECISION_ROOM_ENABLED=false$/m);
    expect(quoteHistory).toMatch(
      /const AMBIENT_UI_ENABLED = import\.meta\.env\.VITE_AMBIENT_UI_ENABLED === "1"[\s\S]*const AmbientLivingOpportunityRoute = AMBIENT_UI_ENABLED[\s\S]*\? lazy/
    );
    expect(app).not.toMatch(/^import AmbientGlobalPilotSurface from/m);
    expect(app).not.toMatch(/^import PilotCommandBar from/m);
    expect(app).toMatch(
      /const AmbientGlobalPilotSurface = AMBIENT_UI_ENABLED[\s\S]*import\("\.\/components\/AmbientGlobalPilotSurface"\)/
    );
    expect(app).toMatch(
      /const loadAmbientGlobalPilotTarget = AMBIENT_UI_ENABLED[\s\S]*import\("\.\/lib\/ambientGlobalPilotTarget"\)/
    );
    expect(app).toMatch(
      /const PilotCommandBar = PILOT_COMMAND_ENABLED[\s\S]*import\("\.\/components\/PilotCommandBar"\)/
    );
    expect(app).toMatch(
      /const AMBIENT_PILOT_COMMANDS_ENABLED = AMBIENT_UI_ENABLED && PILOT_COMMAND_ENABLED/
    );
    expect(portal).toMatch(
      /const AMBIENT_DECISION_ROOM_ENABLED = PILOT_DECISION_ROOM_ENABLED && AMBIENT_UI_ENABLED/
    );
    expect(app).toMatch(
      /const AmbientNowView = AMBIENT_NOW_ENABLED[\s\S]*import\("\.\/components\/AmbientNowView"\)/
    );
    expect(app).toMatch(
      /const NowView = LEGACY_NOW_ENABLED[\s\S]*import\("\.\/components\/NowView"\)/
    );
  });

  test("promotes authoritative operational staffing only through exact production bindings", () => {
    const firebaseWorkflow = fs.readFileSync(FIREBASE_WORKFLOW, "utf8");
    const vercelWorkflow = fs.readFileSync(VERCEL_WORKFLOW, "utf8");
    const functionsExample = fs.readFileSync(
      path.join(ROOT, "functions", ".env.example"),
      "utf8"
    );

    expect(firebaseWorkflow.match(/OPERATIONAL_STAFFING_AUTHORITY_ENABLED: "true"/g)).toHaveLength(1);
    expect(vercelWorkflow).not.toContain("OPERATIONAL_STAFFING_AUTHORITY_ENABLED");
    expect(functionsExample).toMatch(/^OPERATIONAL_STAFFING_AUTHORITY_ENABLED=false$/m);
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

  test("pulls fixed production project settings before the Vercel prebuilt build", () => {
    const source = fs.readFileSync(VERCEL_STUB, "utf8");
    const pullOffset = source.indexOf('"pull"');
    const revalidateOffset = source.indexOf("validateVercelProjectLink();", pullOffset);
    const buildOffset = source.indexOf('"build"', pullOffset);
    const deployOffset = source.indexOf("deployAndBindProductionDomain(headSha);", buildOffset);

    expect(pullOffset).toBeGreaterThan(0);
    expect(source.slice(pullOffset, buildOffset)).toMatch(/--environment=production/);
    expect(revalidateOffset).toBeGreaterThan(pullOffset);
    expect(buildOffset).toBeGreaterThan(revalidateOffset);
    expect(deployOffset).toBeGreaterThan(buildOffset);
  });

  test("binds the exact Vercel deployment to the public custom domain", () => {
    const source = fs.readFileSync(VERCEL_STUB, "utf8");
    const deployOffset = source.indexOf('"deploy"');
    const aliasOffset = source.indexOf('"alias"', deployOffset);

    expect(deployOffset).toBeGreaterThan(0);
    expect(source.slice(deployOffset, aliasOffset)).toContain("deploymentUrl");
    expect(aliasOffset).toBeGreaterThan(deployOffset);
    expect(source.slice(aliasOffset)).toContain("PRODUCTION_DOMAIN");
    expect(source).toContain('const PRODUCTION_DOMAIN = "quotepilot.mbmapps.com";');
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
