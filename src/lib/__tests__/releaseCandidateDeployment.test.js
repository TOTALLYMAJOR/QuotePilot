import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { spawnSync } from "node:child_process";
import { describe, expect, test } from "vitest";
import {
  RELEASE_CANDIDATE_POLICY,
  RELEASE_CANDIDATE_PROVIDER_UAT_PROFILE,
  RELEASE_CANDIDATE_EVENT_SPINE_UAT_PROFILE,
  candidateEventSpineRequirements,
  RELEASE_CANDIDATE_STAFFING_UAT_PROFILE,
  RELEASE_CANDIDATE_UAT_PROFILE,
  CANDIDATE_REQUIRED_SECRET_METADATA,
  CANDIDATE_FUNCTIONS_RUNTIME_EXPECTED,
  candidateFunctionsRuntimeExpected,
  candidateConfirmation,
  requireCandidateProfileTarget,
  reserveCandidateReceipt,
  updateCandidateReceipt,
  validateCandidateCiEvidence,
  validateCandidateBrowserEnvironment,
  validateCandidateFunctionsEnvironment,
  validateFirebaseFunctionsReadback,
  validateFirebaseHostingReadback,
  validateFirebaseReceipt,
  validateFirebaseRulesReadback,
  validateVercelReceipt
} from "../../../scripts/release-candidate-policy.mjs";
import {
  buildVercelOutputConfig,
  writeCandidateManifest,
  collectVercelBuildFiles,
  isEnabledFirebaseSecretVersion,
  providerRequestHeaders,
  resolveGitHubToken,
  validateFunctionsDependencyInstall,
  validateHostedManifest,
  vercelAutomationBypassToken,
  vercelDeploymentPayload
} from "../../../scripts/deploy-release-candidate.mjs";

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
    ...overrides
  };
}

function reserveVercelCandidateReceipt(root, uatProfile = RELEASE_CANDIDATE_UAT_PROFILE) {
  return reserveCandidateReceipt({
    root,
    target: "vercel-preview",
    releaseSha: SHA,
    ci: { runId: 123, releaseSha: SHA },
    provider: {
      name: "vercel",
      ...RELEASE_CANDIDATE_POLICY.vercel,
      target: "preview"
    },
    uatProfile
  });
}

function readCandidateReceipt(reservation) {
  return JSON.parse(fs.readFileSync(reservation.receiptPath, "utf8"));
}

describe("governed release candidate deployment", () => {
  test("uses explicit GitHub tokens before the authenticated CLI fallback", () => {
    expect(resolveGitHubToken({
      env: { GITHUB_TOKEN: "github-token", GH_TOKEN: "gh-token" },
      readCliToken: () => {
        throw new Error("CLI must not be read when GITHUB_TOKEN exists");
      }
    })).toBe("github-token");
    expect(resolveGitHubToken({
      env: { GH_TOKEN: "gh-token" },
      readCliToken: () => {
        throw new Error("CLI must not be read when GH_TOKEN exists");
      }
    })).toBe("gh-token");
    expect(resolveGitHubToken({
      env: {},
      readCliToken: () => "cli-token"
    })).toBe("cli-token");
    expect(() => resolveGitHubToken({
      env: {},
      readCliToken: () => {
        throw new Error("provider-specific authentication output");
      }
    })).toThrow(/GITHUB_TOKEN, GH_TOKEN, or an authenticated GitHub CLI session/i);
  });

  test("rejects an incomplete Functions dependency install before provider work", () => {
    expect(validateFunctionsDependencyInstall({
      root: "/tmp/quotepilot-release-fixture",
      inspect: (_command, args) => ({
        status: 0,
        stdout: JSON.stringify({
          dependencies: {
            "firebase-functions": { version: "7.3.2" }
          }
        }),
        args
      })
    })).toMatchObject({
      source: "npm dependency tree",
      packageName: "firebase-functions",
      version: "7.3.2"
    });
    expect(() => validateFunctionsDependencyInstall({
      inspect: () => ({ status: 1, stdout: "{}" })
    })).toThrow(/npm ci --prefix functions/i);
    expect(() => validateFunctionsDependencyInstall({
      inspect: () => ({ status: 0, stdout: "{}" })
    })).toThrow(/firebase-functions is unavailable/i);
  });

  test("binds Firebase Rules user-ADC requests to the fixed staging quota project", () => {
    expect(providerRequestHeaders({
      token: "opaque-token",
      quotaProject: RELEASE_CANDIDATE_POLICY.firebase.projectId
    })).toMatchObject({
      Authorization: "Bearer opaque-token",
      "x-goog-user-project": "quotepilot-staging-20260804"
    });
    expect(providerRequestHeaders({ token: "vercel-token" }))
      .not.toHaveProperty("x-goog-user-project");
    expect(providerRequestHeaders({ protectionBypass: "opaque-bypass-secret" }))
      .toMatchObject({ "x-vercel-protection-bypass": "opaque-bypass-secret" });
  });

  test("binds protected preview reads to one existing automation bypass", () => {
    const secret = "vcp_opaque_existing_automation_secret";
    expect(vercelAutomationBypassToken({
      protectionBypass: {
        [secret]: { scope: "automation-bypass" }
      }
    })).toBe(secret);
    expect(() => vercelAutomationBypassToken({ protectionBypass: {} }))
      .toThrow(/exactly one automation protection bypass/i);
    expect(() => vercelAutomationBypassToken({
      protectionBypass: {
        [secret]: { scope: "email-invite" }
      }
    })).toThrow(/exactly one automation protection bypass/i);
  });

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
    expect(RELEASE_CANDIDATE_UAT_PROFILE).toBe("staging-safe-off");
    expect(RELEASE_CANDIDATE_STAFFING_UAT_PROFILE).toBe("staging-staffing-authority");
    expect(RELEASE_CANDIDATE_PROVIDER_UAT_PROFILE).toBe("staging-provider-acceptance");
    expect(candidateConfirmation(
      "firebase-all",
      SHA,
      RELEASE_CANDIDATE_PROVIDER_UAT_PROFILE
    )).toBe(
      `DEPLOY CANDIDATE quotepilot-staging-20260804 ${SHA} PROFILE staging-provider-acceptance`
    );
    expect(requireCandidateProfileTarget(
      "firebase-all",
      RELEASE_CANDIDATE_PROVIDER_UAT_PROFILE
    )).toEqual({
      target: "firebase-all",
      profile: RELEASE_CANDIDATE_PROVIDER_UAT_PROFILE
    });
    expect(() => requireCandidateProfileTarget(
      "vercel-preview",
      RELEASE_CANDIDATE_PROVIDER_UAT_PROFILE
    )).toThrow(/Firebase-only.*Turnstile hostname allowlist/i);
  });

  test("checks every bound staging secret by metadata without reading or creating values", () => {
    expect(CANDIDATE_REQUIRED_SECRET_METADATA).toEqual(expect.arrayContaining([
      "PINGRAM_API_KEY",
      "PINGRAM_WEBHOOK_SECRET",
      "RESEND_WEBHOOK_SECRET",
      "REVENUE_AUTOPILOT_TOKEN_SECRET",
      "SMS_CONTACT_DIGEST_SECRET",
      "STRIPE_SECRET_KEY",
      "TWILIO_AUTH_TOKEN",
      "INQUIRY_TURNSTILE_SECRET",
      "INQUIRY_RATE_LIMIT_SECRET"
    ]));
    const source = fs.readFileSync(SCRIPT, "utf8");
    expect(source).toContain('"functions:secrets:get"');
    expect(source).toContain('version?.state === "ENABLED"');
    expect(source).not.toContain("accessSecretVersion(");
    expect(source).not.toContain("createSecret(");
  });

  test("accepts the pinned Firebase CLI secret metadata shape and rejects disabled versions", () => {
    expect(isEnabledFirebaseSecretVersion({
      secret: {
        projectId: "844470813106",
        name: "STAFF_INVITATION_TOKEN_SECRET"
      },
      versionId: "1",
      state: "ENABLED"
    }, "STAFF_INVITATION_TOKEN_SECRET")).toBe(true);
    expect(isEnabledFirebaseSecretVersion({
      secret: "projects/844470813106/secrets/STAFF_INVITATION_TOKEN_SECRET",
      state: "ENABLED"
    }, "STAFF_INVITATION_TOKEN_SECRET")).toBe(true);
    expect(isEnabledFirebaseSecretVersion({
      secret: { name: "STAFF_INVITATION_TOKEN_SECRET" },
      state: "DISABLED"
    }, "STAFF_INVITATION_TOKEN_SECRET")).toBe(false);
  });

  test("prepares the checksum-verified Firebase binary before receipt reservation and mutation", () => {
    const source = fs.readFileSync(SCRIPT, "utf8");
    const prepareOffset = source.lastIndexOf("await prepareFirebaseToolsBinary()");
    const providerSafeOffOffset = source.lastIndexOf(
      "readFirebaseFunctions(firebaseCliPath, RELEASE_CANDIDATE_UAT_PROFILE)"
    );
    const rulesPreflightOffset = source.lastIndexOf("await readFirebaseRulesReleases(firebaseRulesAccessToken)");
    const vercelPreflightOffset = source.lastIndexOf("await validateVercelProjectAccess(vercelToken)");
    const functionsDependencyOffset = source.lastIndexOf("validateFunctionsDependencyInstall()");
    const reserveOffset = source.lastIndexOf("reservation = reserveCandidateReceipt");
    const mutationOffset = source.indexOf("attempt.providerMutationAttempted = true");
    const firebaseMutation = source.slice(mutationOffset, source.indexOf("response = parseJsonOutput", mutationOffset));

    expect(prepareOffset).toBeGreaterThan(0);
    expect(reserveOffset).toBeGreaterThan(prepareOffset);
    expect(providerSafeOffOffset).toBeGreaterThan(prepareOffset);
    expect(reserveOffset).toBeGreaterThan(providerSafeOffOffset);
    expect(reserveOffset).toBeGreaterThan(rulesPreflightOffset);
    expect(reserveOffset).toBeGreaterThan(vercelPreflightOffset);
    expect(functionsDependencyOffset).toBeGreaterThan(0);
    expect(reserveOffset).toBeGreaterThan(functionsDependencyOffset);
    expect(firebaseMutation).toContain("capture(firebaseCliPath");
    expect(firebaseMutation).not.toContain('capture("npx"');
    expect(firebaseMutation).not.toContain("FIREBASE_TOOLS");
    expect(firebaseMutation).toContain('"--force"');
  });

  test("binds operational staffing authority to the exact candidate profile", () => {
    expect(validateCandidateFunctionsEnvironment(functionsEnvironment()))
      .toMatchObject({
        AUTH_PLATFORM_ADMIN_EMAILS: "flightcontrol@quietpilot.us",
        OPERATIONAL_STAFFING_AUTHORITY_ENABLED: "false",
        INQUIRY_SHOWCASE_ENABLED: "false",
        platformAdminCount: 1
      });
    expect(() => validateCandidateFunctionsEnvironment(functionsEnvironment({
      AUTH_PLATFORM_ADMIN_EMAILS: "mm05366@gmail.com"
    }))).toThrow(/AUTH_PLATFORM_ADMIN_EMAILS.*flightcontrol@quietpilot\.us/i);
    expect(() => validateCandidateFunctionsEnvironment(functionsEnvironment({
      OPERATIONAL_STAFFING_AUTHORITY_ENABLED: "true"
    }))).toThrow(/explicitly false/i);
    expect(validateCandidateFunctionsEnvironment(functionsEnvironment({
      OPERATIONAL_STAFFING_AUTHORITY_ENABLED: "true"
    }), RELEASE_CANDIDATE_STAFFING_UAT_PROFILE)).toMatchObject({
      OPERATIONAL_STAFFING_AUTHORITY_ENABLED: "true"
    });
    expect(() => validateCandidateFunctionsEnvironment(functionsEnvironment(),
      RELEASE_CANDIDATE_STAFFING_UAT_PROFILE)).toThrow(/explicitly true/i);
    expect(() => validateCandidateFunctionsEnvironment(functionsEnvironment({
      STRIPE_SECRET_KEY: "plaintext-fixture"
    }))).toThrow(/Secret Manager/i);
    expect(() => validateCandidateFunctionsEnvironment(functionsEnvironment({
      APP_BASE_URL: "https://quotepilot.mbmapps.com/app"
    }))).toThrow(/APP_BASE_URL/i);
    expect(() => validateCandidateFunctionsEnvironment(functionsEnvironment({
      TWILIO_ACCOUNT_SID: "disabled-provider-residue"
    }))).toThrow(/must be empty/i);
    expect(() => validateCandidateFunctionsEnvironment(functionsEnvironment({
      INQUIRY_TURNSTILE_HOSTNAMES: "quotepilot-staging-20260804.web.app"
    }))).toThrow(/must be empty/i);
    expect(() => validateCandidateFunctionsEnvironment(functionsEnvironment({
      INQUIRY_TURNSTILE_SECRET: "plaintext-fixture"
    }))).toThrow(/Secret Manager/i);
  });

  test("opens only the controlled test-provider profile and rejects browser test keys", () => {
    const providerRuntime = candidateFunctionsRuntimeExpected(
      RELEASE_CANDIDATE_PROVIDER_UAT_PROFILE
    );
    expect(validateCandidateFunctionsEnvironment(
      providerRuntime,
      RELEASE_CANDIDATE_PROVIDER_UAT_PROFILE
    )).toMatchObject({
      NOTIFICATIONS_EMAIL_PROVIDER: "resend",
      STRIPE_MODE: "test",
      BUYER_ACCESS_ENABLED: "true",
      BUYER_ACCESS_TURNSTILE_HOSTNAMES: "quotepilot-staging-20260804.web.app",
      OPERATIONAL_STAFFING_AUTHORITY_ENABLED: "true"
    });
    expect(() => validateCandidateFunctionsEnvironment(
      { ...providerRuntime, STRIPE_MODE: "live" },
      RELEASE_CANDIDATE_PROVIDER_UAT_PROFILE
    )).toThrow(/STRIPE_MODE.*test/i);
    expect(() => validateCandidateFunctionsEnvironment(
      { ...providerRuntime, NOTIFICATIONS_EMAIL_PROVIDER: "none" },
      RELEASE_CANDIDATE_PROVIDER_UAT_PROFILE
    )).toThrow(/NOTIFICATIONS_EMAIL_PROVIDER.*resend/i);

    const browser = {
      VITE_FIREBASE_API_KEY: "provider-derived-browser-fixture",
      VITE_FIREBASE_AUTH_DOMAIN: RELEASE_CANDIDATE_POLICY.firebase.authDomain,
      VITE_FIREBASE_PROJECT_ID: RELEASE_CANDIDATE_POLICY.firebase.projectId,
      VITE_FIREBASE_STORAGE_BUCKET: RELEASE_CANDIDATE_POLICY.firebase.storageBucket,
      VITE_FIREBASE_MESSAGING_SENDER_ID: RELEASE_CANDIDATE_POLICY.firebase.messagingSenderId,
      VITE_FIREBASE_APP_ID: RELEASE_CANDIDATE_POLICY.firebase.appId,
      VITE_BUYER_ACCESS_TURNSTILE_SITE_KEY: "0x4AAAAAReviewedStagingKey123"
    };
    expect(validateCandidateBrowserEnvironment(
      browser,
      RELEASE_CANDIDATE_PROVIDER_UAT_PROFILE
    )).toMatchObject({
      VITE_BUYER_ACCESS_ENABLED: "true",
      VITE_BUYER_ACCESS_PUBLIC_CTA_ENABLED: "true",
      VITE_BUYER_ACCESS_TURNSTILE_SITE_KEY: "0x4AAAAAReviewedStagingKey123",
      VITE_INQUIRY_SHOWCASE_ENABLED: "false",
      VITE_INQUIRY_TURNSTILE_SITE_KEY: ""
    });
    expect(() => validateCandidateBrowserEnvironment({
      ...browser,
      VITE_BUYER_ACCESS_TURNSTILE_SITE_KEY: "1x00000000000000000000AA"
    }, RELEASE_CANDIDATE_PROVIDER_UAT_PROFILE)).toThrow(/non-test staging site key/i);
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

    const staffingFunctions = validateFirebaseFunctionsReadback({
      candidateProfile: RELEASE_CANDIDATE_STAFFING_UAT_PROFILE,
      response: {
        status: "success",
        result: [{
          id: "calculateQuotePricing",
          region: "us-central1",
          platform: "gcfv1",
          project: RELEASE_CANDIDATE_POLICY.firebase.projectId,
          state: "ACTIVE",
          hash: "c".repeat(40),
          environmentVariables: {
            ...CANDIDATE_FUNCTIONS_RUNTIME_EXPECTED,
            OPERATIONAL_STAFFING_AUTHORITY_ENABLED: "true"
          }
        }]
      }
    });
    expect(staffingFunctions.runtimeConfig.OPERATIONAL_STAFFING_AUTHORITY_ENABLED)
      .toBe("true");

    const providerFunctions = validateFirebaseFunctionsReadback({
      candidateProfile: RELEASE_CANDIDATE_PROVIDER_UAT_PROFILE,
      response: {
        status: "success",
        result: [{
          id: "calculateQuotePricing",
          region: "us-central1",
          platform: "gcfv1",
          project: RELEASE_CANDIDATE_POLICY.firebase.projectId,
          state: "ACTIVE",
          hash: "d".repeat(40),
          environmentVariables: candidateFunctionsRuntimeExpected(
            RELEASE_CANDIDATE_PROVIDER_UAT_PROFILE
          )
        }]
      }
    });
    expect(providerFunctions.runtimeConfig).toMatchObject({
      NOTIFICATIONS_EMAIL_PROVIDER: "resend",
      STRIPE_MODE: "test",
      BUYER_ACCESS_ENABLED: "true",
      OPERATIONAL_STAFFING_AUTHORITY_ENABLED: "true"
    });

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
    expect(validateFirebaseHostingReadback({
      providerDeploymentId: "projects/844470813106/sites/quotepilot-staging-20260804/versions/0123456789abcdef",
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

  test("reserves the receipt before mutation and rejects fields outside the update contract", () => {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), "quotepilot-candidate-receipt-"));
    try {
      const reservation = reserveVercelCandidateReceipt(root);
      const reservedReceipt = readCandidateReceipt(reservation);
      expect(reservedReceipt).toMatchObject({
        schema: "com.mbmapps.quotepilot.release-candidate-receipt/v3",
        status: "reserved",
        uatProfile: "staging-safe-off",
        providerMutationAttempted: false
      });
      expect(() => reserveCandidateReceipt({
        root,
        target: "vercel-preview",
        releaseSha: SHA,
        ci: { runId: 123 },
        provider: { name: "vercel" }
      })).toThrow(/EEXIST/i);
      const staffingReservation = reserveVercelCandidateReceipt(
        root,
        RELEASE_CANDIDATE_STAFFING_UAT_PROFILE
      );
      expect(staffingReservation.receiptPath).toContain(
        `vercel-preview.${RELEASE_CANDIDATE_STAFFING_UAT_PROFILE}.json`
      );
      expect(readCandidateReceipt(staffingReservation)).toMatchObject({
        uatProfile: RELEASE_CANDIDATE_STAFFING_UAT_PROFILE
      });
      expect(() => updateCandidateReceipt(reservation, { unexpected: true }))
        .toThrow(/unknown field unexpected/i);
      for (const field of [
        "schema",
        "reservationId",
        "target",
        "uatProfile",
        "sourceSha",
        "ci",
        "createdAt"
      ]) {
        expect(() => updateCandidateReceipt(reservation, { [field]: "forged" }))
          .toThrow(new RegExp(`${field} is immutable`, "i"));
      }
      expect(readCandidateReceipt(reservation)).toEqual(reservedReceipt);
    } finally {
      fs.rmSync(root, { recursive: true, force: true });
    }
  });

  test("enforces forward-only receipt lifecycle and mutation-attempt state", () => {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), "quotepilot-candidate-lifecycle-"));
    try {
      const reservation = reserveVercelCandidateReceipt(root);
      expect(() => updateCandidateReceipt(reservation, { status: "verified" }))
        .toThrow(/cannot transition from reserved to verified/i);
      updateCandidateReceipt(reservation, { status: "preparing" });
      updateCandidateReceipt(reservation, { status: "preparing" });
      updateCandidateReceipt(reservation, {
        status: "deploying",
        providerMutationAttempted: true,
        providerMutationAttemptedAt: "2026-08-12T00:00:00.000Z"
      });
      expect(() => updateCandidateReceipt(reservation, {
        status: "deploying",
        providerMutationAttempted: false
      })).toThrow(/cannot regress from true to false/i);
      expect(() => updateCandidateReceipt(reservation, { status: "preparing" }))
        .toThrow(/cannot transition from deploying to preparing/i);
      expect(readCandidateReceipt(reservation)).toMatchObject({
        status: "deploying",
        providerMutationAttempted: true
      });
    } finally {
      fs.rmSync(root, { recursive: true, force: true });
    }
  });

  test("allows two-step provider enrichment without replacing provider evidence", () => {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), "quotepilot-candidate-provider-"));
    try {
      const reservation = reserveVercelCandidateReceipt(root);
      updateCandidateReceipt(reservation, { status: "preparing" });
      updateCandidateReceipt(reservation, {
        status: "deploying",
        providerMutationAttempted: true
      });
      updateCandidateReceipt(reservation, {
        status: "provider_succeeded_unverified",
        provider: {
          name: "vercel",
          ...RELEASE_CANDIDATE_POLICY.vercel,
          target: "preview",
          deploymentUrl: "https://quoteflow-candidate-mbmapps.vercel.app"
        }
      });
      updateCandidateReceipt(reservation, {
        status: "provider_succeeded_unverified",
        provider: {
          name: "vercel",
          ...RELEASE_CANDIDATE_POLICY.vercel,
          target: "preview",
          deploymentId: "dpl_candidate123",
          deploymentUrl: "https://quoteflow-candidate-mbmapps.vercel.app"
        }
      });
      const enrichedReceipt = readCandidateReceipt(reservation);
      expect(enrichedReceipt.provider).toEqual({
        name: "vercel",
        projectId: RELEASE_CANDIDATE_POLICY.vercel.projectId,
        orgId: RELEASE_CANDIDATE_POLICY.vercel.orgId,
        projectName: "quoteflow",
        target: "preview",
        deploymentId: "dpl_candidate123",
        deploymentUrl: "https://quoteflow-candidate-mbmapps.vercel.app"
      });
      expect(() => updateCandidateReceipt(reservation, {
        status: "provider_succeeded_unverified",
        provider: { deploymentId: "dpl_conflicting" }
      })).toThrow(/deploymentId conflicts with existing evidence/i);
      expect(() => updateCandidateReceipt(reservation, {
        status: "provider_succeeded_unverified",
        provider: { deploymentUrl: "https://quoteflow-other-mbmapps.vercel.app" }
      })).toThrow(/deploymentUrl conflicts with existing evidence/i);
      expect(() => updateCandidateReceipt(reservation, {
        status: "provider_succeeded_unverified",
        provider: { name: "firebase" }
      })).toThrow(/provider identity field name is immutable/i);
      expect(() => updateCandidateReceipt(reservation, {
        status: "provider_succeeded_unverified",
        provider: { region: "us-central1" }
      })).toThrow(/provider patch contains unknown field region/i);
      expect(readCandidateReceipt(reservation)).toEqual(enrichedReceipt);

      const verified = updateCandidateReceipt(reservation, {
        status: "verified",
        providerMutationCompleted: true,
        verifiedAt: "2026-08-12T00:05:00.000Z"
      });
      expect(verified).toMatchObject({
        status: "verified",
        providerMutationAttempted: true,
        providerMutationCompleted: true
      });
      expect(() => updateCandidateReceipt(reservation, { status: "partial" }))
        .toThrow(/cannot transition from verified to partial/i);
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
      VITE_INVENTORY_AUTHORITY_ENABLED: "true",
      VITE_PILOT_MEMORY_ENABLED: "false",
      VITE_PILOT_MODEL_ENABLED: "false",
      VITE_BUYER_ACCESS_ENABLED: "false",
      VITE_BUYER_ACCESS_PUBLIC_CTA_ENABLED: "false",
      VITE_INQUIRY_SHOWCASE_ENABLED: "false",
      VITE_INQUIRY_TURNSTILE_SITE_KEY: "",
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
    const inquiryResidue = spawnSync(process.execPath, [path.join(ROOT, "scripts", "check-env.mjs")], {
      cwd: ROOT,
      env: {
        ...stagingEnv,
        VITE_INQUIRY_TURNSTILE_SITE_KEY: "public-inquiry-key-fixture"
      },
      encoding: "utf8"
    });
    expect(inquiryResidue.status).not.toBe(0);
    expect(inquiryResidue.stderr).toMatch(/must remain empty/i);
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
    expect(validateFirebaseReceipt({
      releaseSha: SHA,
      response: {
        status: "success",
        result: {
          hosting: "projects/844470813106/sites/quotepilot-staging-20260804/versions/0123456789abcdef"
        }
      }
    }).providerDeploymentId).toBe(
      "projects/844470813106/sites/quotepilot-staging-20260804/versions/0123456789abcdef"
    );
    expect(() => validateFirebaseReceipt({
      releaseSha: SHA,
      response: {
        status: "success",
        result: {
          hosting: "projects/999999999999/sites/quotepilot-staging-20260804/versions/0123456789abcdef"
        }
      }
    })).toThrow(/fixed staging Hosting version id/i);
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

  test("retries exact hosted manifest equality across bounded propagation", async () => {
    const expected = {
      schema: "com.mbmapps.quotepilot.release-candidate/v3",
      sourceSha: SHA,
      ciRunId: 123,
      uatProfile: RELEASE_CANDIDATE_STAFFING_UAT_PROFILE
    };
    let fetchCount = 0;
    let waitCount = 0;
    const manifestUrl = await validateHostedManifest("https://candidate.example", expected, {
      fetchManifest: async () => {
        fetchCount += 1;
        return fetchCount === 1 ? { ...expected, sourceSha: "b".repeat(40) } : expected;
      },
      wait: async () => { waitCount += 1; },
      attempts: 3,
      delayMs: 1
    });
    expect(manifestUrl).toBe("https://candidate.example/release-candidate.json");
    expect(fetchCount).toBe(2);
    expect(waitCount).toBe(1);
  });

  test("allows the default bounded window to absorb a one-minute Hosting propagation lag", async () => {
    const expected = {
      schema: "com.mbmapps.quotepilot.release-candidate/v3",
      sourceSha: SHA,
      ciRunId: 123,
      uatProfile: RELEASE_CANDIDATE_STAFFING_UAT_PROFILE
    };
    let fetchCount = 0;
    let waitCount = 0;
    const manifestUrl = await validateHostedManifest("https://candidate.example", expected, {
      fetchManifest: async () => {
        fetchCount += 1;
        return fetchCount === 31 ? expected : { ...expected, sourceSha: "b".repeat(40) };
      },
      wait: async () => { waitCount += 1; }
    });
    expect(manifestUrl).toBe("https://candidate.example/release-candidate.json");
    expect(fetchCount).toBe(31);
    expect(waitCount).toBe(30);
  });

  test("builds a deterministic Vercel Build Output v3 payload without a runtime CLI", () => {
    expect(buildVercelOutputConfig()).toEqual({
      version: 3,
      routes: [
        {
          src: "^(?:/(.*))$",
          headers: {
            "X-Content-Type-Options": "nosniff",
            "Referrer-Policy": "strict-origin-when-cross-origin"
          },
          continue: true
        },
        { handle: "filesystem" },
        { src: "^(?:/(.*))$", dest: "/index.html", check: true },
        { handle: "error" },
        { status: 404, src: "^(?!/api).*$", dest: "/404.html" }
      ],
      crons: []
    });
    const root = fs.mkdtempSync(path.join(os.tmpdir(), "quotepilot-vercel-output-"));
    const output = path.join(root, ".vercel", "output");
    try {
      fs.mkdirSync(path.join(output, "static", "assets"), { recursive: true });
      fs.writeFileSync(path.join(output, "config.json"), '{"version":3}\n');
      fs.writeFileSync(path.join(output, "static", "index.html"), "<main>candidate</main>\n");
      fs.writeFileSync(path.join(output, "static", "assets", "app.js"), "export default true;\n");
      const files = collectVercelBuildFiles(output, { root });
      expect(files.map((file) => file.file)).toEqual([
        ".vercel/output/config.json",
        ".vercel/output/static/assets/app.js",
        ".vercel/output/static/index.html"
      ]);
      expect(files.every((file) => /^[0-9a-f]{40}$/.test(file.sha))).toBe(true);
      const payload = vercelDeploymentPayload({ files, releaseSha: SHA, ciRunId: 123 });
      expect(payload).toMatchObject({
        name: "quoteflow",
        project: RELEASE_CANDIDATE_POLICY.vercel.projectId,
        version: 2,
        meta: { candidateSha: SHA, candidateCiRunId: "123" }
      });
      expect(payload.files).toHaveLength(3);
      expect(JSON.stringify(payload)).not.toContain("content");
      fs.symlinkSync(path.join(output, "config.json"), path.join(output, "static", "linked-config.json"));
      expect(() => collectVercelBuildFiles(output, { root })).toThrow(/symbolic links/i);
      expect(() => collectVercelBuildFiles(root, { root })).toThrow(/inside the repository/i);
    } finally {
      fs.rmSync(root, { recursive: true, force: true });
    }
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
    expect(source).toContain("uatProfile: candidateProfile");
    expect(source).toContain('com.mbmapps.quotepilot.release-candidate/v3');
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
    expect(source).not.toContain('capture("npx"');
    expect(source).not.toContain('run("npx"');
    expect(source).not.toContain("VERCEL_CLI");
    expect(source).not.toContain("locateFirebaseToolsRoot");
    expect(source).toContain('"https://api.vercel.com"');
    expect(source).toContain("https://firebaserules.googleapis.com/v1/");
    expect(source.indexOf("reserveCandidateReceipt({")).toBeLessThan(
      source.indexOf("await deployFirebase(context)")
    );
    expect(source).toContain('status: attempt.providerMutationAttempted ? "partial" : "failed"');
  });
});


describe("isolated Event Operating Spine candidate profile", () => {
  function browserEnvironment() {
    const firebase = RELEASE_CANDIDATE_POLICY.firebase;
    return { VITE_FIREBASE_API_KEY: "public-test-web-config", VITE_FIREBASE_PROJECT_ID: firebase.projectId,
      VITE_FIREBASE_AUTH_DOMAIN: firebase.authDomain, VITE_FIREBASE_STORAGE_BUCKET: firebase.storageBucket,
      VITE_FIREBASE_MESSAGING_SENDER_ID: firebase.messagingSenderId, VITE_FIREBASE_APP_ID: firebase.appId };
  }
  test("event candidate profile binds explicit server browser and separate tenant gates without changing old profiles", () => {
    const oldRuntime = candidateFunctionsRuntimeExpected(RELEASE_CANDIDATE_UAT_PROFILE);
    const staffing = candidateFunctionsRuntimeExpected(RELEASE_CANDIDATE_STAFFING_UAT_PROFILE);
    expect(staffing).toEqual({ ...oldRuntime, OPERATIONAL_STAFFING_AUTHORITY_ENABLED: "true" });
    expect(oldRuntime).not.toHaveProperty("EVENT_OPERATING_SPINE_ENABLED");
    expect(staffing).not.toHaveProperty("EVENT_OPERATING_SPINE_ENABLED");
    expect(candidateFunctionsRuntimeExpected(RELEASE_CANDIDATE_PROVIDER_UAT_PROFILE)).not.toHaveProperty("EVENT_OPERATING_SPINE_ENABLED");
    expect(() => validateCandidateFunctionsEnvironment({ ...candidateFunctionsRuntimeExpected(RELEASE_CANDIDATE_PROVIDER_UAT_PROFILE), EVENT_OPERATING_SPINE_ENABLED: "true" }, RELEASE_CANDIDATE_PROVIDER_UAT_PROFILE)).toThrow(/unreviewed variables/);
    expect(() => validateCandidateFunctionsEnvironment(functionsEnvironment({ EVENT_OPERATING_SPINE_ENABLED: "true" }))).toThrow(/unreviewed variables/);
    const runtime = candidateFunctionsRuntimeExpected(RELEASE_CANDIDATE_EVENT_SPINE_UAT_PROFILE);
    expect(runtime).toEqual({ ...oldRuntime, EVENT_OPERATING_SPINE_ENABLED: "true", COMMERCIAL_CHANGE_AUTHORITY_ENABLED: "true" });
    expect(runtime).toMatchObject({ NOTIFICATIONS_EMAIL_PROVIDER: "none", NOTIFICATIONS_SMS_PROVIDER: "none", REVENUE_AUTOPILOT_SENDS_ENABLED: "false", BUYER_ACCESS_ENABLED: "false", COMMERCIAL_CHANGE_AUTHORITY_ENABLED: "true" });
    const oldBrowser = validateCandidateBrowserEnvironment(browserEnvironment());
    expect(validateCandidateBrowserEnvironment(browserEnvironment(), RELEASE_CANDIDATE_STAFFING_UAT_PROFILE)).toEqual(oldBrowser);
    expect(oldBrowser).not.toHaveProperty("VITE_EVENT_OPERATING_SPINE_ENABLED");
    expect(validateCandidateBrowserEnvironment(browserEnvironment(), RELEASE_CANDIDATE_EVENT_SPINE_UAT_PROFILE)).toEqual({ ...oldBrowser, VITE_EVENT_OPERATING_SPINE_ENABLED: "true" });
    expect(validateCandidateBrowserEnvironment(browserEnvironment(), RELEASE_CANDIDATE_EVENT_SPINE_UAT_PROFILE).VITE_AMBIENT_UI_ENABLED).toBe("true");
    expect(() => validateCandidateFunctionsEnvironment(functionsEnvironment(), RELEASE_CANDIDATE_EVENT_SPINE_UAT_PROFILE)).toThrow(/COMMERCIAL_CHANGE_AUTHORITY_ENABLED|EVENT_OPERATING_SPINE_ENABLED/);
    expect(validateCandidateFunctionsEnvironment(functionsEnvironment({ EVENT_OPERATING_SPINE_ENABLED: "true", COMMERCIAL_CHANGE_AUTHORITY_ENABLED: "true" }), RELEASE_CANDIDATE_EVENT_SPINE_UAT_PROFILE)).toMatchObject({ EVENT_OPERATING_SPINE_ENABLED: "true" });
    const requirements = candidateEventSpineRequirements(RELEASE_CANDIDATE_EVENT_SPINE_UAT_PROFILE);
    expect(requirements).toMatchObject({ tenantActivationIncluded: false, tenantSelectionRequired: true, operatorAcceptanceEstablished: false,
      tenantGate: { field: "eventOperatingSpineEnabled", requiredValue: true, availability: "not_yet_available", observedValue: null } });
    expect(requirements.commercialServerFlag).toEqual({ name: "COMMERCIAL_CHANGE_AUTHORITY_ENABLED", value: true });
    expect(requirements.commercialTenantGate).toMatchObject({ field: "commercialChangeAuthorityEnabled", requiredValue: true, observedValue: null, availability: "not_yet_available" });
    expect(oldRuntime.COMMERCIAL_CHANGE_AUTHORITY_ENABLED).toBe("false");
    expect(staffing.COMMERCIAL_CHANGE_AUTHORITY_ENABLED).toBe("false");
    expect(() => validateCandidateFunctionsEnvironment(functionsEnvironment({ EVENT_OPERATING_SPINE_ENABLED: "true" }), RELEASE_CANDIDATE_EVENT_SPINE_UAT_PROFILE)).toThrow(/COMMERCIAL_CHANGE_AUTHORITY_ENABLED/);
    expect(candidateEventSpineRequirements(RELEASE_CANDIDATE_UAT_PROFILE)).toBeNull();
  });
  test("event candidate manifest and reserved receipt keep rollout requirements separate from activation proof", () => {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), "event-profile-test-"));
    try {
      const runtime = candidateFunctionsRuntimeExpected(RELEASE_CANDIDATE_EVENT_SPINE_UAT_PROFILE);
      const manifest = writeCandidateManifest(path.join(root, "output"), SHA, 123, RELEASE_CANDIDATE_EVENT_SPINE_UAT_PROFILE, runtime);
      expect(manifest).toMatchObject({ sourceSha: SHA, eventOperatingSpineBrowserEnabled: true, eventOperatingSpineAuthorityEnabled: true, rolloutRequirements: { tenantActivationIncluded: false } });
      expect(JSON.parse(fs.readFileSync(path.join(root, "output", "release-candidate.json"), "utf8"))).toEqual(manifest);
      const reservation = reserveVercelCandidateReceipt(root, RELEASE_CANDIDATE_EVENT_SPINE_UAT_PROFILE);
      const receipt = JSON.parse(fs.readFileSync(reservation.receiptPath, "utf8"));
      expect(receipt.rolloutRequirements.tenantGate.observedValue).toBeNull();
      expect(receipt.providerMutationAttempted).toBe(false);
      expect(() => updateCandidateReceipt(reservation, { rolloutRequirements: {} })).toThrow(/immutable/);
      const old = writeCandidateManifest(path.join(root, "old-output"), SHA, 123, RELEASE_CANDIDATE_UAT_PROFILE, candidateFunctionsRuntimeExpected());
      expect(old).not.toHaveProperty("eventOperatingSpineBrowserEnabled"); expect(old).not.toHaveProperty("rolloutRequirements");
      const source = fs.readFileSync(SCRIPT, "utf8");
      expect(source).toContain("candidateBrowserEnvironment(firebaseCliPath, candidateProfile)");
      expect(source).toMatch(/validateCandidateBrowserEnvironment\(\{[\s\S]*?\.\.\.providerConfig,[\s\S]*?\}, candidateProfile\)/);
      expect(source).toContain("VITE_EVENT_OPERATING_SPINE_ENABLED: true");
    } finally { fs.rmSync(root, { recursive: true, force: true }); }
  });
});
