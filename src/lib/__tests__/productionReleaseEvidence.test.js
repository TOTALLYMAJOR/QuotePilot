import crypto from "node:crypto";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, describe, expect, test } from "vitest";
import {
  RELEASE_EVIDENCE_POLICY,
  getReleaseUatChecklist,
  parseAttesterIds,
  parseReleaseEvidenceCliArgs,
  parseReleaseUatRunTitle,
  validateCiJobs,
  validateCiRun,
  validateDeploymentRun,
  validateGitEvidence,
  validateProtectedEnvironment,
  validateUatJobs,
  validateUatRun,
  verifyProductionReleaseEvidence
} from "../../../scripts/production-release-evidence.mjs";
import {
  buildReleaseUatReceipt,
  parseReleaseUatArgs
} from "../../../scripts/release-uat-attestation.mjs";

const RELEASE_SHA = "a".repeat(40);
const ROLLBACK_SHA = "b".repeat(40);
const OTHER_SHA = "c".repeat(40);
const CI_RUN_ID = 101;
const UAT_RUN_ID = 202;
const ATTESTER_ID = 303;
const REVIEWER_ID = 404;
const DEPLOYMENT_RUN_ID = 505;
const OPERATOR_ID = 606;
const DEPLOYMENT_PROFILES = [
  "firebase-hosting",
  "firebase-backend",
  "firebase-all",
  "vercel"
];
const NOW = new Date("2026-08-04T12:00:00.000Z");
const CI_COMPLETED_AT = "2026-08-04T09:00:00.000Z";
const UAT_STARTED_AT = "2026-08-04T09:10:00.000Z";
const UAT_COMPLETED_AT = "2026-08-04T09:30:00.000Z";
const tempDirs = [];

const checklist = getReleaseUatChecklist(process.cwd());
const ATTESTER_ALLOWLIST_DIGEST = crypto
  .createHash("sha256")
  .update([ATTESTER_ID, REVIEWER_ID].sort((left, right) => left - right).join(","))
  .digest("hex");

function makeCiRun(overrides = {}) {
  return {
    id: CI_RUN_ID,
    repository: {
      id: RELEASE_EVIDENCE_POLICY.repository.id,
      full_name: RELEASE_EVIDENCE_POLICY.repository.fullName
    },
    workflow_id: RELEASE_EVIDENCE_POLICY.ciWorkflow.id,
    name: RELEASE_EVIDENCE_POLICY.ciWorkflow.name,
    path: `${RELEASE_EVIDENCE_POLICY.ciWorkflow.path}@refs/heads/main`,
    event: "push",
    head_branch: "main",
    head_sha: RELEASE_SHA,
    status: "completed",
    conclusion: "success",
    updated_at: CI_COMPLETED_AT,
    ...overrides
  };
}

function makeCiJobs() {
  return RELEASE_EVIDENCE_POLICY.requiredCiJobs.map((name) => ({
    name,
    status: "completed",
    conclusion: "success"
  }));
}

function makeDeploymentTitle({
  profile = "vercel",
  releaseSha = RELEASE_SHA,
  ciRunId = CI_RUN_ID,
  uatRunId = UAT_RUN_ID,
  rollbackSha = ROLLBACK_SHA
} = {}) {
  return [
    "deploy",
    "v1",
    profile,
    releaseSha,
    String(ciRunId),
    String(uatRunId),
    rollbackSha
  ].join("/");
}

function makeDeploymentRun(profile = "vercel", overrides = {}) {
  const workflow = RELEASE_EVIDENCE_POLICY.deployWorkflows[profile];
  return {
    id: DEPLOYMENT_RUN_ID,
    repository: {
      id: RELEASE_EVIDENCE_POLICY.repository.id,
      full_name: RELEASE_EVIDENCE_POLICY.repository.fullName
    },
    name: workflow?.name,
    path: `${workflow?.path}@refs/heads/main`,
    event: "workflow_dispatch",
    head_branch: "main",
    head_sha: RELEASE_SHA,
    status: "in_progress",
    conclusion: null,
    run_attempt: 1,
    display_title: makeDeploymentTitle({ profile }),
    actor: { id: OPERATOR_ID, type: "User", login: "release-operator" },
    triggering_actor: { id: OPERATOR_ID, type: "User", login: "release-operator" },
    ...overrides
  };
}

function makeDeploymentOptions(target = "vercel", overrides = {}) {
  return {
    releaseSha: RELEASE_SHA,
    rollbackSha: ROLLBACK_SHA,
    target,
    deploymentRunId: DEPLOYMENT_RUN_ID,
    ciRunId: CI_RUN_ID,
    uatRunId: UAT_RUN_ID,
    ...overrides
  };
}

function makeUatTitle({
  releaseSha = RELEASE_SHA,
  target = "vercel",
  rollbackSha = ROLLBACK_SHA,
  stagingId = "dpl_immutable-123",
  checklistDigest = checklist.digest
} = {}) {
  return [
    "release-uat",
    "v1",
    releaseSha,
    target,
    rollbackSha,
    stagingId,
    checklistDigest
  ].join("/");
}

function makeUatRun(overrides = {}) {
  return {
    id: UAT_RUN_ID,
    repository: {
      id: RELEASE_EVIDENCE_POLICY.repository.id,
      full_name: RELEASE_EVIDENCE_POLICY.repository.fullName
    },
    name: RELEASE_EVIDENCE_POLICY.uatWorkflow.name,
    path: `${RELEASE_EVIDENCE_POLICY.uatWorkflow.path}@refs/heads/main`,
    event: "workflow_dispatch",
    head_branch: "main",
    head_sha: RELEASE_SHA,
    status: "completed",
    conclusion: "success",
    run_attempt: 1,
    actor: { id: ATTESTER_ID, type: "User", login: "release-attester" },
    triggering_actor: { id: ATTESTER_ID, type: "User", login: "release-attester" },
    display_title: makeUatTitle(),
    run_started_at: UAT_STARTED_AT,
    created_at: UAT_STARTED_AT,
    updated_at: UAT_COMPLETED_AT,
    ...overrides
  };
}

function makeUatOptions(overrides = {}) {
  return {
    releaseSha: RELEASE_SHA,
    rollbackSha: ROLLBACK_SHA,
    target: "vercel",
    uatRunId: UAT_RUN_ID,
    checklistDigest: checklist.digest,
    attesterIds: new Set([ATTESTER_ID]),
    ciCompletedAt: CI_COMPLETED_AT,
    now: NOW,
    maximumAttestationAgeHours: 24,
    ...overrides
  };
}

function makeUatJobs() {
  return [{
    name: RELEASE_EVIDENCE_POLICY.uatWorkflow.jobName,
    status: "completed",
    conclusion: "success"
  }];
}

function makeEnvironment(name, { reviewerIds = [REVIEWER_ID], ...overrides } = {}) {
  return {
    name,
    protection_rules: [{
      type: "required_reviewers",
      prevent_self_review: true,
      reviewers: reviewerIds.map((id) => ({ reviewer: { id } }))
    }],
    deployment_branch_policy: {
      protected_branches: true,
      custom_branch_policies: false
    },
    ...overrides
  };
}

function makeGit({
  origin = "https://github.com/TOTALLYMAJOR/quoteflow.git",
  fail = ""
} = {}) {
  const calls = [];
  const git = (args, root) => {
    const command = args.join(" ");
    calls.push({ args, root });
    if (command === fail) return { status: 1, stdout: "", stderr: "rejected" };
    if (command === "remote get-url origin") {
      return { status: 0, stdout: `${origin}\n`, stderr: "" };
    }
    if (command === `cat-file -e ${ROLLBACK_SHA}^{commit}`) {
      return { status: 0, stdout: "", stderr: "" };
    }
    if (command === `merge-base --is-ancestor ${ROLLBACK_SHA} ${RELEASE_SHA}`) {
      return { status: 0, stdout: "", stderr: "" };
    }
    return { status: 77, stdout: "", stderr: `unexpected git command: ${command}` };
  };
  return { git, calls };
}

function makeReceiptArgs(overrides = {}) {
  return {
    "release-sha": RELEASE_SHA,
    target: "vercel",
    "rollback-sha": ROLLBACK_SHA,
    "staging-id": "dpl_immutable-123",
    "checklist-digest": checklist.digest,
    "checked-item-ids": checklist.itemIds.join(","),
    confirmation: `ATTEST UAT ${RELEASE_SHA}`,
    output: "artifacts/release/uat-attestation.json",
    ...overrides
  };
}

function makeReceiptEnv(overrides = {}) {
  return {
    GITHUB_ACTIONS: "true",
    GITHUB_EVENT_NAME: "workflow_dispatch",
    GITHUB_REF: "refs/heads/main",
    GITHUB_SHA: RELEASE_SHA,
    GITHUB_ACTOR: "release-attester",
    GITHUB_ACTOR_ID: String(ATTESTER_ID),
    GITHUB_RUN_ID: String(UAT_RUN_ID),
    GITHUB_RUN_ATTEMPT: "1",
    GITHUB_REPOSITORY: RELEASE_EVIDENCE_POLICY.repository.fullName,
    RELEASE_UAT_ATTESTER_IDS: `${REVIEWER_ID},${ATTESTER_ID}`,
    ...overrides
  };
}

function writeChecklistFixture(contents) {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "quotepilot-release-evidence-"));
  tempDirs.push(root);
  fs.mkdirSync(path.join(root, "docs"), { recursive: true });
  fs.writeFileSync(
    path.join(root, "docs", "release-uat-checklist.json"),
    typeof contents === "string" ? contents : JSON.stringify(contents)
  );
  return root;
}

afterEach(() => {
  while (tempDirs.length) {
    fs.rmSync(tempDirs.pop(), { recursive: true, force: true });
  }
});

describe("production release evidence CLI parsing", () => {
  const validArgs = [
    "--release-sha", RELEASE_SHA,
    "--ci-run-id", String(CI_RUN_ID),
    "--uat-run-id", String(UAT_RUN_ID),
    "--rollback-sha", ROLLBACK_SHA,
    "--target", "vercel"
  ];

  test("parses the complete exact-evidence contract", () => {
    expect(parseReleaseEvidenceCliArgs(validArgs)).toEqual({
      "release-sha": RELEASE_SHA,
      "ci-run-id": String(CI_RUN_ID),
      "uat-run-id": String(UAT_RUN_ID),
      "rollback-sha": ROLLBACK_SHA,
      target: "vercel"
    });
  });

  test.each([
    [[...validArgs, "--unknown", "value"], /unknown argument --unknown/i],
    [[...validArgs, "--target", "firebase"], /duplicate argument --target/i],
    [["--release-sha", "--ci-run-id"], /--release-sha requires a value/i],
    [validArgs.slice(0, -2), /--target is required/i]
  ])("rejects malformed evidence argv %#", (argv, expected) => {
    expect(() => parseReleaseEvidenceCliArgs(argv)).toThrow(expected);
  });
});

describe("tracked UAT checklist", () => {
  test("loads a versioned, deduplicated checklist and stable digest", () => {
    expect(checklist.checklist.schema).toBe(
      "com.mbmapps.quotepilot.release-uat-checklist/v1"
    );
    expect(checklist.itemIds).toHaveLength(checklist.checklist.items.length);
    expect(checklist.digest).toMatch(/^[0-9a-f]{64}$/);
    expect(checklist.maximumAttestationAgeHours).toBeGreaterThan(0);
  });

  test.each([
    ["not-json", /missing or invalid JSON/i],
    [{ schema: "wrong", maximumAttestationAgeHours: 24, items: [{ id: "one" }] }, /schema is not supported/i],
    [{ schema: "com.mbmapps.quotepilot.release-uat-checklist/v1", maximumAttestationAgeHours: 24, items: [] }, /no required items/i],
    [{ schema: "com.mbmapps.quotepilot.release-uat-checklist/v1", maximumAttestationAgeHours: 24, items: [{ id: "Bad ID" }] }, /invalid or duplicate item ids/i],
    [{ schema: "com.mbmapps.quotepilot.release-uat-checklist/v1", maximumAttestationAgeHours: 24, items: [{ id: "same" }, { id: "same" }] }, /invalid or duplicate item ids/i],
    [{ schema: "com.mbmapps.quotepilot.release-uat-checklist/v1", maximumAttestationAgeHours: 0, items: [{ id: "one" }] }, /invalid attestation age limit/i],
    [{ schema: "com.mbmapps.quotepilot.release-uat-checklist/v1", maximumAttestationAgeHours: 169, items: [{ id: "one" }] }, /invalid attestation age limit/i]
  ])("rejects invalid checklist fixture %#", (contents, expected) => {
    expect(() => getReleaseUatChecklist(writeChecklistFixture(contents))).toThrow(expected);
  });
});

describe("attester and UAT title parsing", () => {
  test("normalizes an explicit unique numeric attester allowlist", () => {
    expect([...parseAttesterIds("303, 404")]).toEqual([303, 404]);
  });

  test.each([
    ["", /must contain GitHub numeric user ids/i],
    ["303,user", /must contain GitHub numeric user ids/i],
    ["303,303", /invalid or duplicate id/i],
    ["999999999999999999999", /invalid or duplicate id/i]
  ])("rejects invalid attester ids %#", (value, expected) => {
    expect(() => parseAttesterIds(value)).toThrow(expected);
  });

  test("parses an exact release UAT run title", () => {
    expect(parseReleaseUatRunTitle(makeUatTitle())).toEqual({
      releaseSha: RELEASE_SHA,
      target: "vercel",
      rollbackSha: ROLLBACK_SHA,
      stagingId: "dpl_immutable-123",
      checklistDigest: checklist.digest
    });
  });

  test.each([
    ["release-uat/v2", /does not match the v1 evidence contract/i],
    [makeUatTitle({ releaseSha: "abc" }), /UAT release SHA must be a full/i],
    [makeUatTitle({ target: "all" }), /target is not firebase-hosting, firebase-backend, firebase-all, or vercel/i],
    [makeUatTitle({ target: "firebase-functions" }), /target is not firebase-hosting, firebase-backend, firebase-all, or vercel/i],
    [makeUatTitle({ stagingId: "x" }), /staging deployment id is invalid/i],
    [makeUatTitle({ checklistDigest: "abc" }), /checklist digest is invalid/i]
  ])("rejects malformed UAT title %#", (title, expected) => {
    expect(() => parseReleaseUatRunTitle(title)).toThrow(expected);
  });
});

describe("CI evidence validators", () => {
  test("accepts only the canonical successful main-push run for the release SHA", () => {
    expect(() => validateCiRun(makeCiRun(), {
      releaseSha: RELEASE_SHA,
      ciRunId: CI_RUN_ID
    })).not.toThrow();
  });

  test.each([
    [{ repository: { id: 1, full_name: "other/repo" } }, /different repository/i],
    [{ id: 999 }, /response id does not match/i],
    [{ workflow_id: 1 }, /not the canonical CI Quality workflow/i],
    [{ name: "Other CI" }, /not the canonical CI Quality workflow/i],
    [{ path: ".github/workflows/other.yml" }, /not the canonical CI Quality workflow/i],
    [{ event: "pull_request" }, /not a main-branch push run/i],
    [{ head_branch: "feature" }, /not a main-branch push run/i],
    [{ head_sha: OTHER_SHA }, /not bound to the exact release SHA/i],
    [{ status: "in_progress" }, /not completed successfully/i],
    [{ conclusion: "failure" }, /not completed successfully/i]
  ])("rejects invalid CI run evidence %#", (overrides, expected) => {
    expect(() => validateCiRun(makeCiRun(overrides), {
      releaseSha: RELEASE_SHA,
      ciRunId: CI_RUN_ID
    })).toThrow(expected);
  });

  test("requires every hard-gate job to complete successfully", () => {
    expect(() => validateCiJobs(makeCiJobs())).not.toThrow();
  });

  test.each([
    [[], /returned no jobs/i],
    [makeCiJobs().slice(1), /required CI job Classify Changes \+ Lane Plan is missing/i],
    [[...makeCiJobs(), makeCiJobs()[0]], /duplicate job name/i],
    [makeCiJobs().map((job, index) => index === 0 ? { ...job, conclusion: "failure" } : job), /did not complete successfully/i],
    [[...makeCiJobs(), { name: "advisory", status: "completed", conclusion: "skipped" }], /did not complete successfully/i]
  ])("rejects incomplete CI job evidence %#", (jobs, expected) => {
    expect(() => validateCiJobs(jobs)).toThrow(expected);
  });
});

describe("current deployment workflow validator", () => {
  test.each(DEPLOYMENT_PROFILES)(
    "accepts the active first-attempt human %s workflow dispatch",
    (profile) => {
      expect(validateDeploymentRun(
        makeDeploymentRun(profile),
        makeDeploymentOptions(profile)
      )).toEqual({ operatorId: OPERATOR_ID });
    }
  );

  test.each([
    [{ repository: { id: 1, full_name: "other/repo" } }, /different repository/i],
    [{ id: 999 }, /response id does not match the current run/i],
    [{ name: "Deploy Something Else" }, /not the canonical target deployment workflow/i],
    [{ path: ".github/workflows/other.yml" }, /not the canonical target deployment workflow/i],
    [{ event: "push" }, /not a main-branch manual dispatch/i],
    [{ head_branch: "feature" }, /not a main-branch manual dispatch/i],
    [{ head_sha: OTHER_SHA }, /not bound to the exact release SHA/i],
    [{ status: "queued" }, /not actively in progress/i],
    [{ status: "completed", conclusion: "success" }, /not actively in progress/i],
    [{ conclusion: "failure" }, /not actively in progress/i],
    [{ run_attempt: 2 }, /workflow reruns are not accepted/i],
    [{ actor: { id: OPERATOR_ID, type: "Bot" } }, /not dispatched by one human operator/i],
    [{ actor: { id: 0, type: "User" }, triggering_actor: { id: 0 } }, /not dispatched by one human operator/i],
    [{ triggering_actor: { id: REVIEWER_ID, type: "User" } }, /not dispatched by one human operator/i]
  ])("rejects spoofable deployment-run evidence %#", (overrides, expected) => {
    expect(() => validateDeploymentRun(
      makeDeploymentRun("vercel", overrides),
      makeDeploymentOptions("vercel")
    )).toThrow(expected);
  });

  test("rejects an unsupported deployment profile", () => {
    expect(() => validateDeploymentRun(
      makeDeploymentRun("vercel"),
      makeDeploymentOptions("all")
    )).toThrow(/not the canonical target deployment workflow/i);
  });

  test("rejects a deployment title bound to a different profile", () => {
    expect(() => validateDeploymentRun(
      makeDeploymentRun("firebase-hosting"),
      makeDeploymentOptions("firebase-backend")
    )).toThrow(/title is not bound to the supplied evidence/i);
  });

  test.each([
    ["profile", makeDeploymentTitle({ profile: "firebase-hosting" })],
    ["release SHA", makeDeploymentTitle({ releaseSha: OTHER_SHA })],
    ["CI run", makeDeploymentTitle({ ciRunId: 999 })],
    ["UAT run", makeDeploymentTitle({ uatRunId: 999 })],
    ["rollback SHA", makeDeploymentTitle({ rollbackSha: OTHER_SHA })],
    ["format", "deploy/v1/tampered"]
  ])("rejects a deployment title with tampered %s", (_field, displayTitle) => {
    expect(() => validateDeploymentRun(
      makeDeploymentRun("vercel", { display_title: displayTitle }),
      makeDeploymentOptions("vercel")
    )).toThrow(/title is not bound to the supplied evidence/i);
  });
});

describe("protected GitHub environment validator", () => {
  test("accepts a protected environment with an independent reviewer", () => {
    expect(() => validateProtectedEnvironment(
      makeEnvironment("production-uat"),
      { name: "production-uat", attesterId: ATTESTER_ID }
    )).not.toThrow();
  });

  test("accepts GitHub's case-insensitive canonical environment name", () => {
    expect(() => validateProtectedEnvironment(
      makeEnvironment("Production"),
      { name: "production" }
    )).not.toThrow();
  });

  test.each([
    [makeEnvironment("other"), /production-uat GitHub environment is missing/i],
    [{ name: "production-uat", protection_rules: [], deployment_branch_policy: {} }, /must require reviewers/i],
    [makeEnvironment("production-uat", { protection_rules: [{ type: "required_reviewers", prevent_self_review: false, reviewers: [{ reviewer: { id: REVIEWER_ID } }] }] }), /must require reviewers and prevent self-review/i],
    [makeEnvironment("production-uat", { reviewerIds: [] }), /has no valid required reviewer/i],
    [makeEnvironment("production-uat", { reviewerIds: [ATTESTER_ID] }), /needs a reviewer other than the UAT attester/i],
    [makeEnvironment("production-uat", { deployment_branch_policy: { protected_branches: false, custom_branch_policies: true } }), /limited to protected branches/i]
  ])("rejects an unsafe environment policy %#", (environment, expected) => {
    expect(() => validateProtectedEnvironment(environment, {
      name: "production-uat",
      attesterId: ATTESTER_ID
    })).toThrow(expected);
  });
});

describe("UAT workflow evidence validators", () => {
  test.each(DEPLOYMENT_PROFILES)(
    "accepts a fresh exact-SHA %s UAT dispatch after CI",
    (profile) => {
      expect(validateUatRun(
        makeUatRun({ display_title: makeUatTitle({ target: profile }) }),
        makeUatOptions({ target: profile })
      )).toEqual({
        actorId: ATTESTER_ID,
        stagingId: "dpl_immutable-123",
        attestedTarget: profile
      });
    }
  );

  test.each([
    [{ repository: { id: 1, full_name: "other/repo" } }, {}, /different repository/i],
    [{ id: 999 }, {}, /response id does not match/i],
    [{ name: "Other UAT" }, {}, /not the canonical attestation workflow/i],
    [{ path: ".github/workflows/other.yml" }, {}, /not the canonical attestation workflow/i],
    [{ event: "push" }, {}, /not a main-branch manual dispatch/i],
    [{ head_branch: "feature" }, {}, /not a main-branch manual dispatch/i],
    [{ head_sha: OTHER_SHA }, {}, /not bound to the exact release SHA/i],
    [{ status: "queued" }, {}, /did not complete successfully/i],
    [{ conclusion: "failure" }, {}, /did not complete successfully/i],
    [{ run_attempt: 2 }, {}, /rerun UAT attestations are not accepted/i],
    [{ actor: { id: ATTESTER_ID, type: "Bot" } }, {}, /not an allowed human attester/i],
    [{ actor: { id: REVIEWER_ID, type: "User" }, triggering_actor: { id: REVIEWER_ID } }, {}, /not an allowed human attester/i],
    [{ triggering_actor: { id: REVIEWER_ID } }, {}, /not an allowed human attester/i],
    [{ display_title: makeUatTitle({ releaseSha: OTHER_SHA }) }, {}, /different release or rollback SHA/i],
    [{ display_title: makeUatTitle({ rollbackSha: OTHER_SHA }) }, {}, /different release or rollback SHA/i],
    [{ display_title: makeUatTitle({ target: "firebase-hosting" }) }, {}, /does not cover this deployment target/i],
    [{ display_title: makeUatTitle({ checklistDigest: "d".repeat(64) }) }, {}, /different checklist digest/i],
    [{ run_started_at: "invalid" }, {}, /timestamps are invalid/i],
    [{ run_started_at: "2026-08-04T08:59:59.000Z" }, {}, /started before exact-SHA CI completed/i],
    [{ updated_at: "2026-08-04T12:06:00.000Z" }, {}, /timestamp is in the future/i],
    [{ updated_at: "2026-08-02T09:30:00.000Z" }, { maximumAttestationAgeHours: 24 }, /attestation is stale/i]
  ])("rejects invalid UAT run evidence %#", (runOverrides, optionOverrides, expected) => {
    expect(() => validateUatRun(
      makeUatRun(runOverrides),
      makeUatOptions(optionOverrides)
    )).toThrow(expected);
  });

  test("requires exactly one successful attestation job", () => {
    expect(() => validateUatJobs(makeUatJobs())).not.toThrow();
  });

  test.each([
    [[], /returned no jobs/i],
    [[{ ...makeUatJobs()[0], conclusion: "failure" }], /did not succeed/i],
    [[{ name: "other", status: "completed", conclusion: "success" }], /exactly one attestation job/i],
    [[...makeUatJobs(), ...makeUatJobs()], /exactly one attestation job/i]
  ])("rejects invalid UAT jobs %#", (jobs, expected) => {
    expect(() => validateUatJobs(jobs)).toThrow(expected);
  });
});

describe("Git release and rollback evidence", () => {
  test.each([
    "https://github.com/TOTALLYMAJOR/quoteflow",
    "https://github.com/TOTALLYMAJOR/quoteflow.git",
    "git@github.com:TOTALLYMAJOR/quoteflow.git"
  ])("accepts canonical origin %s with an ancestor rollback", (origin) => {
    const { git, calls } = makeGit({ origin });
    expect(() => validateGitEvidence({
      releaseSha: RELEASE_SHA,
      rollbackSha: ROLLBACK_SHA,
      headSha: RELEASE_SHA.toUpperCase()
    }, { git, root: "/fixture" })).not.toThrow();
    expect(calls.map(({ args }) => args)).toEqual([
      ["remote", "get-url", "origin"],
      ["cat-file", "-e", `${ROLLBACK_SHA}^{commit}`],
      ["merge-base", "--is-ancestor", ROLLBACK_SHA, RELEASE_SHA]
    ]);
  });

  test("rejects a checked-out head other than the release SHA before Git calls", () => {
    const { git, calls } = makeGit();
    expect(() => validateGitEvidence({
      releaseSha: RELEASE_SHA,
      rollbackSha: ROLLBACK_SHA,
      headSha: OTHER_SHA
    }, { git })).toThrow(/does not match the checked-out HEAD/i);
    expect(calls).toEqual([]);
  });

  test("rejects using the release SHA as its own rollback", () => {
    expect(() => validateGitEvidence({
      releaseSha: RELEASE_SHA,
      rollbackSha: RELEASE_SHA,
      headSha: RELEASE_SHA
    }, { git: makeGit().git })).toThrow(/rollback SHA must differ/i);
  });

  test.each([
    [{ origin: "https://github.com/other/repo.git" }, /origin is not the canonical/i],
    [{ fail: "remote get-url origin" }, /origin remote cannot be resolved/i],
    [{ fail: `cat-file -e ${ROLLBACK_SHA}^{commit}` }, /rollback SHA is not an available commit/i],
    [{ fail: `merge-base --is-ancestor ${ROLLBACK_SHA} ${RELEASE_SHA}` }, /rollback SHA is not an ancestor/i]
  ])("fails closed for invalid Git evidence %#", (gitOptions, expected) => {
    expect(() => validateGitEvidence({
      releaseSha: RELEASE_SHA,
      rollbackSha: ROLLBACK_SHA,
      headSha: RELEASE_SHA
    }, { git: makeGit(gitOptions).git })).toThrow(expected);
  });
});

describe("full production release verifier", () => {
  function makeFetch({ failStatus = 0 } = {}) {
    const calls = [];
    const fetchImpl = async (url, options) => {
      calls.push({ url, options });
      if (failStatus) {
        return { ok: false, status: failStatus, json: async () => ({}) };
      }
      let payload;
      if (url.endsWith(`/actions/runs/${DEPLOYMENT_RUN_ID}`)) {
        payload = makeDeploymentRun("vercel");
      } else if (url.endsWith(`/actions/runs/${CI_RUN_ID}`)) payload = makeCiRun();
      else if (url.includes(`/actions/runs/${CI_RUN_ID}/jobs?`)) {
        payload = { total_count: makeCiJobs().length, jobs: makeCiJobs() };
      } else if (url.endsWith(`/actions/runs/${UAT_RUN_ID}`)) payload = makeUatRun();
      else if (url.includes(`/actions/runs/${UAT_RUN_ID}/jobs?`)) {
        payload = { total_count: makeUatJobs().length, jobs: makeUatJobs() };
      } else if (url.endsWith("/environments/production-uat")) {
        payload = makeEnvironment("production-uat");
      } else if (url.endsWith("/environments/production")) {
        payload = makeEnvironment("production");
      } else {
        return { ok: false, status: 404, json: async () => ({}) };
      }
      return { ok: true, status: 200, json: async () => payload };
    };
    return { fetchImpl, calls };
  }

  function verifierInput(overrides = {}) {
    return {
      releaseSha: RELEASE_SHA,
      ciRunId: String(CI_RUN_ID),
      uatRunId: String(UAT_RUN_ID),
      rollbackSha: ROLLBACK_SHA,
      target: "vercel",
      headSha: RELEASE_SHA,
      deploymentRunId: String(DEPLOYMENT_RUN_ID),
      token: "test-token",
      attesterIds: new Set([ATTESTER_ID]),
      root: process.cwd(),
      ...overrides
    };
  }

  test("binds mocked Git, CI, jobs, UAT, and environments into one receipt", async () => {
    const { git, calls: gitCalls } = makeGit();
    const { fetchImpl, calls: fetchCalls } = makeFetch();

    const result = await verifyProductionReleaseEvidence(
      verifierInput(),
      { fetchImpl, git, now: NOW }
    );

    expect(result).toEqual({
      schema: "com.mbmapps.quotepilot.production-release-evidence/v1",
      releaseSha: RELEASE_SHA,
      rollbackSha: ROLLBACK_SHA,
      target: "vercel",
      ciRunId: CI_RUN_ID,
      uatRunId: UAT_RUN_ID,
      deploymentRunId: DEPLOYMENT_RUN_ID,
      stagingId: "dpl_immutable-123",
      attesterId: ATTESTER_ID,
      operatorId: OPERATOR_ID,
      checklistDigest: checklist.digest,
      verifiedAt: NOW.toISOString()
    });
    expect(Object.isFrozen(result)).toBe(true);
    expect(gitCalls).toHaveLength(3);
    expect(fetchCalls).toHaveLength(7);
    expect(fetchCalls.some(({ url }) =>
      url.endsWith(`/actions/runs/${DEPLOYMENT_RUN_ID}`)
    )).toBe(true);
    expect(fetchCalls.every(({ options }) =>
      options.headers.Authorization === "Bearer test-token"
      && options.headers.Accept === "application/vnd.github+json"
      && options.redirect === "error"
      && options.signal instanceof AbortSignal
    )).toBe(true);
  });

  test("fails closed when GitHub evidence is unavailable", async () => {
    const { fetchImpl } = makeFetch({ failStatus: 503 });
    await expect(verifyProductionReleaseEvidence(
      verifierInput(),
      { fetchImpl, git: makeGit().git, now: NOW }
    )).rejects.toThrow(/GitHub evidence request failed with HTTP 503/i);
  });

  test.each([
    [{ token: "" }, /GITHUB_TOKEN or GH_TOKEN is required/i],
    [{ target: "all" }, /deployment target must be firebase-hosting, firebase-backend, firebase-all, or vercel/i],
    [{ target: "firebase-functions" }, /deployment target must be firebase-hosting, firebase-backend, firebase-all, or vercel/i],
    [{ ciRunId: "0" }, /positive GitHub Actions run id/i],
    [{ uatRunId: "999999999999999999999" }, /outside the supported integer range/i],
    [{ deploymentRunId: "" }, /GITHUB_RUN_ID must be a positive GitHub Actions run id/i]
  ])("rejects malformed full-verifier input %#", async (overrides, expected) => {
    await expect(verifyProductionReleaseEvidence(
      verifierInput(overrides),
      { fetchImpl: makeFetch().fetchImpl, git: makeGit().git, now: NOW }
    )).rejects.toThrow(expected);
  });
});

describe("release UAT attestation validator", () => {
  const validArgv = [
    "--release-sha", RELEASE_SHA,
    "--target", "vercel",
    "--rollback-sha", ROLLBACK_SHA,
    "--staging-id", "dpl_immutable-123",
    "--checklist-digest", checklist.digest,
    "--checked-item-ids", checklist.itemIds.join(","),
    "--confirmation", `ATTEST UAT ${RELEASE_SHA}`,
    "--output", "artifacts/release/uat-attestation.json"
  ];

  test("supports digest-only mode and parses a complete attestation", () => {
    expect(parseReleaseUatArgs(["--print-digest"])).toEqual({ printDigest: true });
    expect(parseReleaseUatArgs(validArgv)).toEqual(makeReceiptArgs());
  });

  test.each([
    [["--print-digest", "extra"], /unknown argument --print-digest/i],
    [[...validArgv, "--target", "all"], /duplicate argument --target/i],
    [["--release-sha", "--target"], /--release-sha requires a value/i],
    [validArgv.slice(0, -2), /--output is required/i]
  ])("rejects malformed attestation argv %#", (argv, expected) => {
    expect(() => parseReleaseUatArgs(argv)).toThrow(expected);
  });

  test("builds an immutable receipt only for an exact first-attempt main dispatch", () => {
    const receipt = buildReleaseUatReceipt(makeReceiptArgs({
      "checked-item-ids": [...checklist.itemIds].reverse().join(",")
    }), {
      env: makeReceiptEnv(),
      root: process.cwd(),
      now: NOW
    });

    expect(receipt).toEqual({
      schema: "com.mbmapps.quotepilot.release-uat-attestation/v1",
      releaseSha: RELEASE_SHA,
      target: "vercel",
      rollbackSha: ROLLBACK_SHA,
      stagingId: "dpl_immutable-123",
      checklist: {
        schema: checklist.checklist.schema,
        version: checklist.checklist.version,
        digest: checklist.digest,
        checkedItemIds: checklist.itemIds
      },
      github: {
        repository: RELEASE_EVIDENCE_POLICY.repository.fullName,
        ref: "refs/heads/main",
        actor: "release-attester",
        actorId: ATTESTER_ID,
        runId: UAT_RUN_ID,
        runAttempt: 1,
        attesterAllowlistDigest: ATTESTER_ALLOWLIST_DIGEST
      },
      recordedAt: NOW.toISOString()
    });
    expect(Object.isFrozen(receipt)).toBe(true);
  });

  test.each(DEPLOYMENT_PROFILES)(
    "builds a UAT receipt scoped to the %s profile",
    (profile) => {
      const receipt = buildReleaseUatReceipt(makeReceiptArgs({ target: profile }), {
        env: makeReceiptEnv(),
        root: process.cwd(),
        now: NOW
      });

      expect(receipt.target).toBe(profile);
      expect(receipt.github.attesterAllowlistDigest).toBe(ATTESTER_ALLOWLIST_DIGEST);
    }
  );

  test.each([
    [{ "release-sha": "abc" }, {}, /--release-sha must be a full/i],
    [{ "rollback-sha": RELEASE_SHA }, {}, /rollback SHA must differ/i],
    [{ target: "all" }, {}, /--target must be firebase-hosting, firebase-backend, firebase-all, or vercel/i],
    [{ target: "firebase-functions" }, {}, /--target must be firebase-hosting, firebase-backend, firebase-all, or vercel/i],
    [{ "staging-id": "x" }, {}, /--staging-id is invalid/i],
    [{ "checklist-digest": "d".repeat(64) }, {}, /does not match the tracked checklist/i],
    [{ confirmation: "ATTEST UAT wrong" }, {}, /--confirmation must equal/i],
    [{ "checked-item-ids": checklist.itemIds.slice(1).join(",") }, {}, /must contain every checklist item exactly once/i],
    [{ "checked-item-ids": [...checklist.itemIds, checklist.itemIds[0]].join(",") }, {}, /must contain every checklist item exactly once/i],
    [{}, { GITHUB_ACTIONS: "false" }, /manual dispatch on the exact main SHA/i],
    [{}, { GITHUB_EVENT_NAME: "push" }, /manual dispatch on the exact main SHA/i],
    [{}, { GITHUB_REF: "refs/heads/feature" }, /manual dispatch on the exact main SHA/i],
    [{}, { GITHUB_SHA: OTHER_SHA }, /manual dispatch on the exact main SHA/i],
    [{}, { GITHUB_ACTOR: "" }, /actor or run identity is invalid/i],
    [{}, { GITHUB_ACTOR_ID: "0" }, /actor or run identity is invalid/i],
    [{}, { GITHUB_RUN_ID: "not-a-number" }, /actor or run identity is invalid/i],
    [{}, { GITHUB_RUN_ATTEMPT: "2" }, /actor or run identity is invalid/i],
    [{}, { RELEASE_UAT_ATTESTER_IDS: String(REVIEWER_ID) }, /actor is not allowlisted to attest release UAT/i]
  ])("rejects invalid attestation evidence %#", (argOverrides, envOverrides, expected) => {
    expect(() => buildReleaseUatReceipt(makeReceiptArgs(argOverrides), {
      env: makeReceiptEnv(envOverrides),
      root: process.cwd(),
      now: NOW
    })).toThrow(expected);
  });

  test("rejects an invalid receipt timestamp", () => {
    expect(() => buildReleaseUatReceipt(makeReceiptArgs(), {
      env: makeReceiptEnv(),
      root: process.cwd(),
      now: "not-a-date"
    })).toThrow(/attestation timestamp is invalid/i);
  });
});
