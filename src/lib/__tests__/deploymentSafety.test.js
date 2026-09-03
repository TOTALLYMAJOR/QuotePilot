import fs from "node:fs";
import path from "node:path";
import { spawnSync } from "node:child_process";
import { describe, expect, test } from "vitest";
import {
  FUNCTIONS_DEPLOY_BATCH_SIZE,
  functionsDeployOutputHasFailure,
  listExpectedFunctionIds,
  planFunctionDeployBatches,
  validateProductionFunctionsReadback
} from "../../../scripts/deploy-firebase-production.mjs";

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
const STAFFING_TENANT_WORKFLOW = path.join(
  ROOT,
  ".github",
  "workflows",
  "set-operational-staffing-tenant.yml"
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
    expect(source).toMatch(provider === "Firebase"
      ? /run-name: deploy\/v3\/.+inputs\.release_profile.+inputs\.sms_provider.+inputs\.sms_configuration_generation/
      : /run-name: deploy\/v2\/.+inputs\.release_profile/);
    expect(source).toMatch(/workflow_dispatch:/);
    expect(source).toMatch(/github\.sha == inputs\.release_sha/);
    expect(source).toMatch(/environment:.*production-solo/);
    expect(source).toMatch(/persist-credentials:\s*false/);
    expect(source).toMatch(/scripts\/verify-direct-production-release\.mjs/);
    expect(source).toMatch(/scripts\/deploy-(?:firebase|vercel)-production\.mjs/);
    expect(source).toMatch(/--release-profile "\$\{RELEASE_PROFILE\}"/);
    expect(source).toMatch(/inputs\.release_profile == 'safe-off'/);
    if (provider === "Firebase") {
      expect(source).toMatch(/--sms-provider "\$\{SMS_PROVIDER\}"/);
      expect(source).toMatch(/--sms-configuration-generation "\$\{SMS_CONFIGURATION_GENERATION\}"/);
      expect(source).toMatch(/EXPECTED_SMS_PROVIDER:\s*\$\{\{ inputs\.sms_provider \}\}/);
      expect(source).toMatch(/EXPECTED_SMS_CONFIGURATION_GENERATION:\s*\$\{\{ inputs\.sms_configuration_generation \}\}/);
      expect(source).toMatch(/id-token:\s*write/);
      expect(source).toMatch(/google-github-actions\/auth@7c6bc770dae815cd3e89ee6cdf493a5fab2cc093/);
      expect(source).toMatch(/workload_identity_provider:\s*\$\{\{ vars\.FIREBASE_WORKLOAD_IDENTITY_PROVIDER \}\}/);
      expect(source).toMatch(/service_account:\s*\$\{\{ vars\.FIREBASE_DEPLOY_SERVICE_ACCOUNT \}\}/);
      expect(source).toMatch(/export_environment_variables:\s*false/);
      expect(source).toMatch(/GOOGLE_APPLICATION_CREDENTIALS:\s*\$\{\{ steps\.google_auth\.outputs\.credentials_file_path \}\}/);
      expect(source).not.toContain("secrets.FIREBASE_TOKEN");
      const authOffset = source.indexOf("- name: Authenticate to Google Cloud for Firebase deployment");
      const deployOffset = source.indexOf("- name: Deploy selected Firebase surface");
      expect(authOffset).toBeGreaterThan(0);
      expect(deployOffset).toBeGreaterThan(authOffset);
    } else {
      expect(source).toMatch(/VERCEL_TOKEN:\s*\$\{\{ secrets\.VERCEL_TOKEN \}\}/);
      const tokenOffset = source.indexOf("VERCEL_TOKEN:");
      const deployStepOffset = source.indexOf("- name: Build and deploy exact release");
      expect(tokenOffset).toBeGreaterThan(deployStepOffset);
    }
  });

  test.each([
    ["Firebase", FIREBASE_WORKFLOW],
    ["Vercel", VERCEL_WORKFLOW]
  ])("binds the %s production build to explicit workspace and safe-off buyer configuration", (_provider, workflow) => {
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
    expect(source).toMatch(/^\s+VITE_BUYER_ACCESS_ENABLED:\s*"false"\s*$/m);
    expect(source).toMatch(/^\s+VITE_BUYER_ACCESS_PUBLIC_CTA_ENABLED:\s*"false"\s*$/m);
    expect(source).not.toContain("VITE_BUYER_ACCESS_TURNSTILE_SITE_KEY");
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
    expect(source.match(/VITE_BUYER_ACCESS_TURNSTILE_SITE_KEY:/g)).toBeNull();
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

  test("keeps operational staffing authority safe-off in production", () => {
    const firebaseWorkflow = fs.readFileSync(FIREBASE_WORKFLOW, "utf8");
    const vercelWorkflow = fs.readFileSync(VERCEL_WORKFLOW, "utf8");
    const functionsExample = fs.readFileSync(
      path.join(ROOT, "functions", ".env.example"),
      "utf8"
    );

    expect(firebaseWorkflow.match(/OPERATIONAL_STAFFING_AUTHORITY_ENABLED: "false"/g)).toHaveLength(1);
    expect(vercelWorkflow).not.toContain("OPERATIONAL_STAFFING_AUTHORITY_ENABLED");
    expect(functionsExample).toMatch(/^OPERATIONAL_STAFFING_AUTHORITY_ENABLED=false$/m);
  });

  test("materializes the exact safe-off Functions authority profile", () => {
    const source = fs.readFileSync(FIREBASE_WORKFLOW, "utf8");

    for (const binding of [
      'NOTIFICATIONS_EMAIL_PROVIDER: none',
      'NOTIFICATIONS_SMS_PROVIDER: none',
      'STRIPE_MODE: live',
      'COMMERCIAL_CHANGE_AUTHORITY_ENABLED: "false"',
      'OPERATIONAL_STAFFING_AUTHORITY_ENABLED: "false"',
      'REVENUE_AUTOPILOT_ENABLED: "false"',
      'REVENUE_AUTOPILOT_SENDS_ENABLED: "false"',
      'BUYER_ACCESS_ENABLED: "false"',
      'BUYER_ACCESS_STRIPE_MODE: test'
    ]) {
      expect(source).toContain(binding);
    }
    expect(source).not.toContain("BUYER_ACCESS_TURNSTILE_HOSTNAMES");
    expect(source).not.toContain("NOTIFICATIONS_OWNER_PHONE");
    expect(source).not.toContain("NOTIFICATIONS_OWNER_SMS_CONSENT");
  });

  test("explicitly acknowledges retry-policy changes only for batched Functions deployments", () => {
    const source = fs.readFileSync(FIREBASE_STUB, "utf8");
    const allowedArguments = source.slice(
      source.indexOf("const allowed = new Set"),
      source.indexOf("const args = process.argv.slice")
    );

    expect(source).toContain('batch.map((id) => `functions:${id}`).join(",")');
    expect(source).toContain('"--force"');
    expect(allowedArguments).not.toContain('"--force"');
  });

  test("keeps each Functions deployment below the production write-quota ceiling", () => {
    const ids = listExpectedFunctionIds(
      fs.readFileSync(path.join(ROOT, "functions", "index.js"), "utf8")
    );
    const batches = planFunctionDeployBatches(ids);

    expect(ids).toHaveLength(101);
    expect(FUNCTIONS_DEPLOY_BATCH_SIZE).toBe(35);
    expect(batches.map((batch) => batch.length)).toEqual([35, 35, 31]);
    expect(batches.flat()).toEqual(ids);
    expect(Math.max(...batches.map((batch) => batch.length))).toBeLessThan(50);
    expect(fs.readFileSync(FIREBASE_STUB, "utf8")).toContain(
      "Waiting ${FUNCTIONS_DEPLOY_PAUSE_MS / 1000} seconds for the provider write-quota window."
    );
    expect(functionsDeployOutputHasFailure(
      "functions: failed to create function projects/tonicatering/locations/us-central1/functions/getCatalogSetupDraft"
    )).toBe(true);
    expect(functionsDeployOutputHasFailure(
      "Failed to update function projects/tonicatering/locations/us-central1/functions/saveCatalogSetupDraft"
    )).toBe(true);
    expect(functionsDeployOutputHasFailure("Deploy complete!")).toBe(false);
  });

  test("fails closed unless every Function is active on the exact safe-off runtime profile", () => {
    const expectedIds = ["getCatalogSetupDraft", "saveCatalogSetupDraft"];
    const runtime = {
      NOTIFICATIONS_EMAIL_PROVIDER: "none",
      NOTIFICATIONS_SMS_PROVIDER: "none",
      STRIPE_MODE: "live",
      COMMERCIAL_CHANGE_AUTHORITY_ENABLED: "false",
      OPERATIONAL_STAFFING_AUTHORITY_ENABLED: "false",
      REVENUE_AUTOPILOT_ENABLED: "false",
      REVENUE_AUTOPILOT_SENDS_ENABLED: "false",
      BUYER_ACCESS_ENABLED: "false",
      BUYER_ACCESS_STRIPE_MODE: "test"
    };
    const entry = (id, environmentVariables = runtime) => ({
      id,
      project: "tonicatering",
      region: "us-central1",
      state: "ACTIVE",
      platform: "gcfv1",
      environmentVariables
    });
    const response = {
      status: "success",
      result: expectedIds.map((id) => entry(id))
    };

    expect(validateProductionFunctionsReadback(response, expectedIds)).toEqual({
      functionCount: 2,
      profile: "safe-off"
    });
    expect(() => validateProductionFunctionsReadback({
      ...response,
      result: [entry(expectedIds[0])]
    }, expectedIds)).toThrow(/inventory mismatch.*saveCatalogSetupDraft/i);
    expect(() => validateProductionFunctionsReadback({
      ...response,
      result: [
        entry(expectedIds[0]),
        entry(expectedIds[1], { ...runtime, OPERATIONAL_STAFFING_AUTHORITY_ENABLED: "true" })
      ]
    }, expectedIds)).toThrow(/does not prove safe-off OPERATIONAL_STAFFING_AUTHORITY_ENABLED/i);
    expect(() => validateProductionFunctionsReadback({
      ...response,
      result: [
        entry(expectedIds[0]),
        entry(expectedIds[1], { ...runtime, BUYER_ACCESS_TURNSTILE_HOSTNAMES: "example.invalid" })
      ]
    }, expectedIds)).toThrow(/disabled runtime residue BUYER_ACCESS_TURNSTILE_HOSTNAMES/i);
  });

  test("requires ephemeral workload identity credentials for Firebase production", () => {
    const source = fs.readFileSync(FIREBASE_STUB, "utf8");
    const workflow = fs.readFileSync(FIREBASE_WORKFLOW, "utf8");

    expect(source).toContain("GOOGLE_APPLICATION_CREDENTIALS");
    expect(source).toContain('credentials?.type !== "external_account"');
    expect(source).toContain("forbids legacy FIREBASE_TOKEN authentication");
    expect(source).not.toMatch(/["']--token["']/u);
    expect(source).toContain("validateFirebaseToolsBinary(process.env.FIREBASE_CLI_PATH)");
    expect(source).not.toMatch(/run\("npx"/u);
    expect(workflow).toContain("node ./scripts/firebase-tools-binary.mjs --print-path");
    expect(workflow).toMatch(/FIREBASE_CLI_PATH:\s*\$\{\{ steps\.firebase_cli\.outputs\.path \}\}/u);
  });

  test("does not persist checkout credentials in the UAT attestation job", () => {
    const source = fs.readFileSync(UAT_WORKFLOW, "utf8");
    expect(source).toMatch(/persist-credentials:\s*false/);
    expect(source).toMatch(/run-name: release-uat\/v4\/.+inputs\.candidate_profile/);
    expect(source).toMatch(/candidate_profile:/);
    expect(source).toMatch(/--candidate-profile "\$\{CANDIDATE_PROFILE\}"/);
  });

  test("keeps tenant activation inputs out of executable workflow text", () => {
    const source = fs.readFileSync(STAFFING_TENANT_WORKFLOW, "utf8");
    const runLines = [];
    let runIndent = -1;
    for (const line of source.split("\n")) {
      const runStart = line.match(/^(\s*)run:\s*\|\s*$/u);
      if (runStart) {
        runIndent = runStart[1].length;
        continue;
      }
      const contentIndent = line.match(/^\s*/u)?.[0]?.length || 0;
      if (runIndent >= 0 && line.trim() && contentIndent <= runIndent) runIndent = -1;
      if (runIndent >= 0) runLines.push(line);
    }
    const runSteps = runLines.join("\n");

    expect(runSteps).not.toContain("${{ inputs.");
    expect(source).toMatch(/ORGANIZATION_ID:\s*\$\{\{ inputs\.organization_id \}\}/u);
    expect(source).toMatch(/TENANT_CONFIRMATION:\s*\$\{\{ inputs\.confirmation \}\}/u);
    expect(source).toMatch(/id-token:\s*write/u);
    expect(source).toMatch(/google-github-actions\/auth@7c6bc770dae815cd3e89ee6cdf493a5fab2cc093/u);
    expect(source).toMatch(/service_account:\s*\$\{\{ vars\.FIREBASE_TENANT_OPERATOR_SERVICE_ACCOUNT \}\}/u);
    expect(source).toMatch(/GOOGLE_OAUTH_ACCESS_TOKEN:\s*\$\{\{ steps\.google_auth\.outputs\.access_token \}\}/u);
    expect(source).toMatch(/access_token_scopes:\s*https:\/\/www\.googleapis\.com\/auth\/datastore/u);
    expect(source).toMatch(/create_credentials_file:\s*false/u);
    expect(source).toMatch(/export_environment_variables:\s*false/u);
    expect(source).toContain("ref: ${{ github.sha }}");
    expect(source).toContain("DEPLOYED_RELEASE_SHA: ${{ inputs.deployed_release_sha }}");
    expect(source).toContain('git tag --points-at "${DEPLOYED_RELEASE_SHA}"');
    expect(source).toContain("OPERATIONAL_STAFFING_AUTHORITY_ENABLED");
    expect(source).toContain("VITE_OPERATIONAL_STAFFING_ENABLED");
    expect(source).not.toContain("github.sha == inputs.deployed_release_sha");
    expect(source).not.toContain("git merge-base --is-ancestor");
    expect(source).not.toContain("secrets.FIREBASE_TOKEN");
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
