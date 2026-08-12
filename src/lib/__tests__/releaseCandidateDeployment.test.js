import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { spawnSync } from "node:child_process";
import { describe, expect, test } from "vitest";
import {
  RELEASE_CANDIDATE_POLICY,
  CANDIDATE_REQUIRED_SECRET_METADATA,
  CANDIDATE_FUNCTIONS_RUNTIME_EXPECTED,
  candidateConfirmation,
  reserveCandidateReceipt,
  updateCandidateReceipt,
  validateCandidateCiEvidence,
  validateCandidateFunctionsEnvironment,
  validateFirebaseFunctionsReadback,
  validateFirebaseHostingReadback,
  validateFirebaseReceipt,
  validateFirebaseRulesReadback,
  validateVercelReceipt
} from "../../../scripts/release-candidate-policy.mjs";

const ROOT = process.cwd();
const SCRIPT = path.join(ROOT, "scripts", "deploy-release-candidate.mjs");
const SHA = "a".repeat(40);
const BRANCH = "release/v0.8.0";

function ciFixture(overrides = {}) {
  return {
    run: {
      id: 123,
      repository: {
        id: RELEASE_CANDIDATE_POLICY.repository.id,
        full_name: RELEASE_CANDIDATE_POLICY.repository.fullName
      },
      workflow_id: RELEASE_CANDIDATE_POLICY.ciWorkflow.id,
      name: RELEASE_CANDIDATE_POLICY.ciWorkflow.name,
      path: `${RELEASE_CANDIDATE_POLICY.ciWorkflow.path}@refs/heads/${BRANCH}`,
      event: "pull_request",
      head_branch: BRANCH,
      head_sha: SHA,
      status: "completed",
      conclusion: "success",
      ...overrides
    },
    jobs: RELEASE_CANDIDATE_POLICY.requiredCiJobs.map((name) => ({
      name,
      status: "completed",
      conclusion: "success"
    }))
  };
}

function functionsEnvironment(overrides = {}) {
  return {
    ...CANDIDATE_FUNCTIONS_RUNTIME_EXPECTED,
    AUTH_PLATFORM_ADMIN_EMAILS: "candidate-admin@mbmapps.com",
    ...overrides
  };
}

describe("governed release candidate deployment", () => {
  test("accepts only exact successful release-branch CI evidence", () => {
    const fixture = ciFixture();
    expect(validateCandidateCiEvidence({ ...fixture, releaseSha: SHA, branch: BRANCH }))
      .toMatchObject({ releaseSha: SHA, branch: BRANCH, runId: 123 });

    expect(() => validateCandidateCiEvidence({
      ...ciFixture({ head_sha: "b".repeat(40) }),
      releaseSha: SHA,
      branch: BRANCH
    })).toThrow(/head SHA/i);
    const failed = ciFixture();
    failed.jobs.at(-1).conclusion = "failure";
    expect(() => validateCandidateCiEvidence({ ...failed, releaseSha: SHA, branch: BRANCH }))
      .toThrow(/required CI job/i);
  });

  test("uses fixed provider identities and SHA-bound confirmations", () => {
    expect(RELEASE_CANDIDATE_POLICY.firebase.projectId).toBe("quotepilot-staging-20260804");
    expect(RELEASE_CANDIDATE_POLICY.vercel.projectName).toBe("quoteflow");
    expect(candidateConfirmation("firebase-all", SHA)).toContain(`quotepilot-staging-20260804 ${SHA}`);
    expect(candidateConfirmation("vercel-preview", SHA)).toContain(`quoteflow PREVIEW ${SHA}`);
  });

  test("checks every bound staging secret by metadata without reading or creating values", () => {
    expect(CANDIDATE_REQUIRED_SECRET_METADATA).toEqual(expect.arrayContaining([
      "RESEND_WEBHOOK_SECRET",
      "REVENUE_AUTOPILOT_TOKEN_SECRET",
      "STRIPE_SECRET_KEY",
      "TWILIO_AUTH_TOKEN"
    ]));
    const source = fs.readFileSync(SCRIPT, "utf8");
    expect(source).toContain("getSecretMetadata(project, name, \"latest\")");
    expect(source).not.toContain("accessSecretVersion(");
    expect(source).not.toContain("createSecret(");
  });

  test("keeps operational staffing authority explicitly off", () => {
    expect(validateCandidateFunctionsEnvironment(functionsEnvironment()))
      .toMatchObject({ OPERATIONAL_STAFFING_AUTHORITY_ENABLED: "false" });
    expect(() => validateCandidateFunctionsEnvironment(functionsEnvironment({
      OPERATIONAL_STAFFING_AUTHORITY_ENABLED: "true"
    }))).toThrow(/explicitly false/i);
    expect(() => validateCandidateFunctionsEnvironment(functionsEnvironment({
      STRIPE_SECRET_KEY: "plaintext-fixture"
    }))).toThrow(/Secret Manager/i);
    expect(() => validateCandidateFunctionsEnvironment(functionsEnvironment({
      APP_BASE_URL: "https://quotepilot.mbmapps.com/app"
    }))).toThrow(/APP_BASE_URL/i);
    expect(() => validateCandidateFunctionsEnvironment(functionsEnvironment({
      TWILIO_ACCOUNT_SID: "disabled-provider-residue"
    }))).toThrow(/must be empty/i);
  });

  test("binds Firebase Functions, Hosting, and Firestore Rules provider evidence", () => {
    const functions = validateFirebaseFunctionsReadback({
      response: {
        status: "success",
        result: [{
          id: "calculateQuotePricing",
          region: "us-central1",
          platform: "gcfv1",
          project: RELEASE_CANDIDATE_POLICY.firebase.projectId,
          state: "ACTIVE",
          hash: "b".repeat(40),
          environmentVariables: { ...CANDIDATE_FUNCTIONS_RUNTIME_EXPECTED }
        }]
      }
    });
    expect(functions).toMatchObject({ functionCount: 1 });
    expect(functions.revisions[0].hash).toBe("b".repeat(40));

    const providerDeploymentId = "sites/quotepilot-staging-20260804/versions/0123456789abcdef";
    expect(validateFirebaseHostingReadback({
      providerDeploymentId,
      channel: {
        name: "projects/quotepilot-staging-20260804/sites/quotepilot-staging-20260804/channels/live",
        release: {
          name: "projects/quotepilot-staging-20260804/sites/quotepilot-staging-20260804/channels/live/releases/123",
          type: "DEPLOY",
          releaseTime: "2026-08-12T00:00:00Z",
          version: {
            name: "projects/quotepilot-staging-20260804/sites/quotepilot-staging-20260804/versions/0123456789abcdef",
            status: "FINALIZED"
          }
        }
      }
    }).version).toContain("0123456789abcdef");

    const rulesSource = "rules_version = '2';\nservice cloud.firestore { match /databases/{database}/documents {} }\n";
    const rules = validateFirebaseRulesReadback({
      localRulesSource: rulesSource,
      release: {
        name: "projects/quotepilot-staging-20260804/releases/cloud.firestore",
        rulesetName: "projects/quotepilot-staging-20260804/rulesets/ruleset-123",
        updateTime: "2026-08-12T00:00:00Z"
      },
      files: [{ name: "firestore.rules", content: rulesSource }]
    });
    expect(rules.sourceSha256).toBe(rules.providerSourceSha256);
  });

  test("reserves the receipt before mutation and preserves journal outcomes", () => {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), "quotepilot-candidate-receipt-"));
    try {
      const reservation = reserveCandidateReceipt({
        root,
        target: "vercel-preview",
        releaseSha: SHA,
        ci: { runId: 123, releaseSha: SHA },
        provider: { name: "vercel", projectName: "quoteflow", target: "preview" }
      });
      expect(JSON.parse(fs.readFileSync(reservation.receiptPath, "utf8")))
        .toMatchObject({ status: "reserved", providerMutationAttempted: false });
      expect(() => reserveCandidateReceipt({
        root,
        target: "vercel-preview",
        releaseSha: SHA,
        ci: { runId: 123 },
        provider: { name: "vercel" }
      })).toThrow(/EEXIST/i);
      updateCandidateReceipt(reservation, {
        status: "partial",
        providerMutationAttempted: true,
        failure: { name: "Error", message: "provider verification failed" }
      });
      expect(JSON.parse(fs.readFileSync(reservation.receiptPath, "utf8")))
        .toMatchObject({
          status: "partial",
          providerMutationAttempted: true,
          failure: { message: "provider verification failed" }
        });
    } finally {
      fs.rmSync(root, { recursive: true, force: true });
    }
  });

  test("allows the exact staging build profile without weakening production validation", () => {
    const stagingEnv = {
      PATH: process.env.PATH,
      QUOTEPILOT_BUILD_PROFILE: "release-candidate",
      FIREBASE_PROJECT_ID: RELEASE_CANDIDATE_POLICY.firebase.projectId,
      VITE_FIREBASE_API_KEY: "provider-derived-browser-fixture",
      VITE_FIREBASE_AUTH_DOMAIN: RELEASE_CANDIDATE_POLICY.firebase.authDomain,
      VITE_FIREBASE_PROJECT_ID: RELEASE_CANDIDATE_POLICY.firebase.projectId,
      VITE_FIREBASE_STORAGE_BUCKET: RELEASE_CANDIDATE_POLICY.firebase.storageBucket,
      VITE_FIREBASE_MESSAGING_SENDER_ID: RELEASE_CANDIDATE_POLICY.firebase.messagingSenderId,
      VITE_FIREBASE_APP_ID: RELEASE_CANDIDATE_POLICY.firebase.appId,
      VITE_APP_URL: `${RELEASE_CANDIDATE_POLICY.firebase.hostingUrl}/app`,
      VITE_APP_HOST: "quotepilot-staging-20260804.web.app",
      VITE_CUSTOMER_CENTERED_WORKSPACE_ENABLED: "true",
      VITE_PILOT_NOW_ENABLED: "true",
      VITE_PILOT_EVENT_ROOM_ENABLED: "true",
      VITE_PILOT_GUIDED_SELLING_ENABLED: "true",
      VITE_PILOT_CREATE_ENABLED: "true",
      VITE_PILOT_CHANGE_REQUESTS_ENABLED: "true",
      VITE_PILOT_COMMAND_ENABLED: "true",
      VITE_PILOT_MARGINS_ENABLED: "true",
      VITE_PILOT_DECISION_ROOM_ENABLED: "true",
      VITE_AMBIENT_UI_ENABLED: "true",
      VITE_OPERATIONAL_STAFFING_ENABLED: "true",
      VITE_PILOT_MEMORY_ENABLED: "false",
      VITE_PILOT_MODEL_ENABLED: "false",
      VITE_BUYER_ACCESS_ENABLED: "false",
      VITE_BUYER_ACCESS_PUBLIC_CTA_ENABLED: "false",
      VITE_E2E_BYPASS_AUTH: "false",
      VITE_USE_FIREBASE_EMULATORS: "false",
      VITE_ALLOW_LOCAL_CATALOG_FALLBACK: "false",
      VITE_E2E_ALLOW_NON_AUTHORITATIVE_PRICING: "false"
    };
    const candidate = spawnSync(process.execPath, [path.join(ROOT, "scripts", "check-env.mjs")], {
      cwd: ROOT,
      env: stagingEnv,
      encoding: "utf8"
    });
    expect(candidate.status).toBe(0);
    const defaultProfile = spawnSync(process.execPath, [path.join(ROOT, "scripts", "check-env.mjs")], {
      cwd: ROOT,
      env: { ...stagingEnv, QUOTEPILOT_BUILD_PROFILE: "" },
      encoding: "utf8"
    });
    expect(defaultProfile.status).not.toBe(0);
    expect(defaultProfile.stderr).toMatch(/must target tonicatering/i);
  });

  test("validates immutable provider deployment ids", () => {
    expect(validateFirebaseReceipt({
      releaseSha: SHA,
      response: {
        status: "success",
        result: { hosting: "sites/quotepilot-staging-20260804/versions/0123456789abcdef" }
      }
    }).providerDeploymentId).toContain("/versions/");
    expect(validateVercelReceipt({
      releaseSha: SHA,
      deployment: {
        id: "dpl_candidate123",
        name: "quoteflow",
        target: "preview",
        readyState: "READY",
        url: "quoteflow-candidate-mbmapps.vercel.app"
      }
    }).providerDeploymentId).toBe("dpl_candidate123");
  });

  test("fails closed before provider access and contains no production promotion command", () => {
    const result = spawnSync(process.execPath, [SCRIPT, "--force"], {
      cwd: ROOT,
      encoding: "utf8"
    });
    expect(result.status).not.toBe(0);
    expect(result.stderr).toMatch(/requires target|Unknown argument/i);
    const source = fs.readFileSync(SCRIPT, "utf8");
    expect(source).not.toMatch(/["']--prod["']/);
    expect(source).not.toMatch(/["']alias["']/);
    expect(source).not.toContain("quotepilot.mbmapps.com");
    expect(source).not.toContain('PROJECT_ID = "tonicatering"');
    expect(source).toContain('VITE_AMBIENT_UI_ENABLED: "true"');
    expect(source).toContain('VITE_OPERATIONAL_STAFFING_ENABLED: "true"');
    expect(source).not.toMatch(/"--token",\s*\.\.\.tokenArgs/);
    for (const flag of [
      "VITE_PILOT_NOW_ENABLED",
      "VITE_PILOT_EVENT_ROOM_ENABLED",
      "VITE_PILOT_GUIDED_SELLING_ENABLED",
      "VITE_PILOT_CREATE_ENABLED",
      "VITE_PILOT_CHANGE_REQUESTS_ENABLED",
      "VITE_PILOT_COMMAND_ENABLED",
      "VITE_PILOT_MARGINS_ENABLED",
      "VITE_PILOT_DECISION_ROOM_ENABLED"
    ]) {
      expect(source).toContain(`${flag}: "true"`);
    }
    expect(source).toContain('VITE_PILOT_MEMORY_ENABLED: "false"');
    expect(source).toContain('VITE_PILOT_MODEL_ENABLED: "false"');
    expect(source).toContain('QUOTEPILOT_BUILD_PROFILE: "release-candidate"');
    expect(source).toContain('"apps:sdkconfig"');
    expect(source.indexOf("reserveCandidateReceipt({")).toBeLessThan(
      source.indexOf("await deployFirebase(context)")
    );
    expect(source).toContain('status: attempt.providerMutationAttempted ? "partial" : "failed"');
  });
});
