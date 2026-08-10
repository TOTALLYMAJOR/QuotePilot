import crypto from "node:crypto";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, describe, expect, test } from "vitest";
import {
  RELEASE_EVIDENCE_POLICY,
  getReleaseUatChecklist,
  parseAttesterIds,
  parseReleaseApprovalMode,
  parseSoloOperatorIds,
  parseReleaseEvidenceCliArgs,
  parseReleaseUatRunTitle,
  validateCiJobs,
  validateCiRun,
  validateDirectDeploymentRun,
  validatePreparationDeploymentReviews,
  validatePreparationRun,
  validateSoloOperatorControls,
  validateGitEvidence,
  validateProtectedEnvironment,
  validateUatDeploymentReviews,
  validateUatJobs,
  validateUatRun,
  verifyProductionReleaseEvidence,
  writeProductionReleaseEvidenceReceipt
} from "../../../scripts/production-release-evidence.mjs";
import {
  buildReleaseUatReceipt,
  getReleaseUatItemIdsForTarget,
  parseReleaseUatArgs,
  writeReleaseUatReceipt
} from "../../../scripts/release-uat-attestation.mjs";

const RELEASE_SHA = "a".repeat(40);
const RELEASE_TAG = "v1.2.3";
const ROLLBACK_SHA = "b".repeat(40);
const OTHER_SHA = "c".repeat(40);
const CI_RUN_ID = 101;
const UAT_RUN_ID = 202;
const UAT_RUN_NODE_ID = "WFR_quotepilot-uat-202";
const PREPARATION_RUN_NODE_ID = "WFR_quotepilot-preparation-505";
const ATTESTER_ID = 303;
const REVIEWER_ID = 404;
const OTHER_REVIEWER_ID = 405;
const UAT_ENVIRONMENT_ID = 707;
const PRODUCTION_ENVIRONMENT_ID = 808;
const UAT_REVIEW_NODE_ID = "DR_quotepilot-uat-review-1";
const PRODUCTION_REVIEW_NODE_ID = "DR_quotepilot-production-review-1";
const PREPARATION_RUN_ID = 505;
const OPERATOR_ID = 606;
const DEPLOYMENT_PROFILES = [
  "firebase-hosting",
  "firebase-backend",
  "firebase-all",
  "vercel"
];
const EXPECTED_UAT_ITEM_IDS_BY_TARGET = Object.freeze({
  "firebase-hosting": [
    "staging.immutable-release",
    "security.provider-secret-cutover",
    "auth.password-recovery",
    "buyer.public-entry-turnstile",
    "buyer.verified-activation-surface",
    "quote.save",
    "quote.legacy-bulk-purge-ui-absent",
    "history.open",
    "portal.decision",
    "delivery.link-surface-gating",
    "payment.customer-surface",
    "proposal.pdf",
    "integrations.status",
    "sms.disabled-nonblocking"
  ],
  "firebase-backend": [
    "staging.immutable-release",
    "security.provider-secret-cutover",
    "buyer.public-initiation-controls",
    "buyer.hosted-invoice-lifecycle",
    "buyer.pending-invite-activation",
    "quote.save",
    "quote.authoritative-create",
    "quote.authoritative-edit",
    "quote.terminal-guards",
    "quote.legacy-bulk-purge-denied",
    "portal.decision",
    "delivery.current-issuance",
    "delivery.invalid-issuance",
    "approval.execution-audit-replay",
    "contract.approved-conversion",
    "payment.deposit-scoped-dispatch",
    "payment.final-balance-scoped-dispatch",
    "payment.webhook-reconciliation",
    "payment.cross-rail-isolation",
    "payment.customer-projection-privacy",
    "integrations.status",
    "sms.disabled-nonblocking"
  ],
  "firebase-all": [
    "staging.immutable-release",
    "security.provider-secret-cutover",
    "auth.password-recovery",
    "buyer.public-entry-turnstile",
    "buyer.public-initiation-controls",
    "buyer.hosted-invoice-lifecycle",
    "buyer.pending-invite-activation",
    "buyer.verified-activation-surface",
    "quote.save",
    "quote.authoritative-create",
    "quote.authoritative-edit",
    "quote.terminal-guards",
    "quote.legacy-bulk-purge-denied",
    "quote.legacy-bulk-purge-ui-absent",
    "history.open",
    "portal.decision",
    "delivery.current-issuance",
    "delivery.invalid-issuance",
    "delivery.link-surface-gating",
    "approval.execution-audit-replay",
    "contract.approved-conversion",
    "payment.deposit-scoped-dispatch",
    "payment.final-balance-scoped-dispatch",
    "payment.webhook-reconciliation",
    "payment.cross-rail-isolation",
    "payment.customer-projection-privacy",
    "payment.customer-surface",
    "proposal.pdf",
    "integrations.status",
    "sms.disabled-nonblocking"
  ],
  vercel: [
    "staging.immutable-release",
    "security.provider-secret-cutover",
    "auth.password-recovery",
    "buyer.public-entry-turnstile",
    "buyer.verified-activation-surface",
    "quote.save",
    "quote.legacy-bulk-purge-ui-absent",
    "history.open",
    "portal.decision",
    "delivery.link-surface-gating",
    "payment.customer-surface",
    "proposal.pdf",
    "integrations.status",
    "sms.disabled-nonblocking"
  ]
});
const CRITICAL_UAT_TARGETS = Object.freeze({
  "security.provider-secret-cutover": [
    "firebase-hosting",
    "firebase-backend",
    "firebase-all",
    "vercel"
  ],
  "auth.password-recovery": ["firebase-hosting", "firebase-all", "vercel"],
  "buyer.public-entry-turnstile": ["firebase-hosting", "firebase-all", "vercel"],
  "buyer.public-initiation-controls": ["firebase-backend", "firebase-all"],
  "buyer.hosted-invoice-lifecycle": ["firebase-backend", "firebase-all"],
  "buyer.pending-invite-activation": ["firebase-backend", "firebase-all"],
  "buyer.verified-activation-surface": ["firebase-hosting", "firebase-all", "vercel"],
  "payment.deposit-scoped-dispatch": ["firebase-backend", "firebase-all"],
  "payment.final-balance-scoped-dispatch": ["firebase-backend", "firebase-all"],
  "payment.webhook-reconciliation": ["firebase-backend", "firebase-all"],
  "payment.cross-rail-isolation": ["firebase-backend", "firebase-all"],
  "payment.customer-projection-privacy": ["firebase-backend", "firebase-all"],
  "payment.customer-surface": ["firebase-hosting", "firebase-all", "vercel"]
});
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

function makePreparationTitle({
  approvalMode = "independent-review",
  profile = "vercel",
  releaseSha = RELEASE_SHA,
  ciRunId = CI_RUN_ID,
  uatRunId = UAT_RUN_ID,
  rollbackSha = ROLLBACK_SHA
} = {}) {
  return [
    "prepare",
    "v2",
    approvalMode,
    profile,
    releaseSha,
    String(ciRunId),
    String(uatRunId),
    rollbackSha
  ].join("/");
}

function makePreparationRun(profile = "vercel", overrides = {}) {
  const workflow = RELEASE_EVIDENCE_POLICY.preparationWorkflows[profile];
  return {
    id: PREPARATION_RUN_ID,
    node_id: PREPARATION_RUN_NODE_ID,
    repository: {
      id: RELEASE_EVIDENCE_POLICY.repository.id,
      full_name: RELEASE_EVIDENCE_POLICY.repository.fullName
    },
    workflow_id: workflow?.id,
    name: makePreparationTitle({ profile }),
    path: `${workflow?.path}@refs/heads/main`,
    event: "workflow_dispatch",
    head_branch: "main",
    head_sha: RELEASE_SHA,
    status: "in_progress",
    conclusion: null,
    run_attempt: 1,
    display_title: makePreparationTitle({ profile }),
    actor: { id: OPERATOR_ID, type: "User", login: "release-operator" },
    triggering_actor: { id: OPERATOR_ID, type: "User", login: "release-operator" },
    created_at: "2026-08-04T10:00:00.000Z",
    ...overrides
  };
}

function makePreparationOptions(target = "vercel", overrides = {}) {
  return {
    releaseSha: RELEASE_SHA,
    rollbackSha: ROLLBACK_SHA,
    target,
    preparationRunId: PREPARATION_RUN_ID,
    ciRunId: CI_RUN_ID,
    uatRunId: UAT_RUN_ID,
    ...overrides
  };
}

function makeDirectDeploymentTitle({
  approvalMode = "solo-operator",
  profile = "vercel",
  releaseSha = RELEASE_SHA,
  ciRunId = CI_RUN_ID,
  rollbackSha = ROLLBACK_SHA
} = {}) {
  return [
    "deploy",
    "v1",
    approvalMode,
    profile,
    releaseSha,
    String(ciRunId),
    rollbackSha
  ].join("/");
}

function makeDirectDeploymentRun(profile = "vercel", overrides = {}) {
  return makePreparationRun(profile, {
    name: "Deploy Production",
    display_title: makeDirectDeploymentTitle({ profile }),
    ...overrides
  });
}

function makeDirectDeploymentOptions(target = "vercel", overrides = {}) {
  return {
    releaseSha: RELEASE_SHA,
    rollbackSha: ROLLBACK_SHA,
    target,
    deploymentRunId: PREPARATION_RUN_ID,
    ciRunId: CI_RUN_ID,
    approvalMode: "solo-operator",
    ...overrides
  };
}

function makeUatTitle({
  approvalMode = "independent-review",
  releaseSha = RELEASE_SHA,
  target = "vercel",
  rollbackSha = ROLLBACK_SHA,
  stagingId = "dpl_immutable-123",
  checklistDigest = checklist.digest
} = {}) {
  return [
    "release-uat",
    "v2",
    approvalMode,
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
    node_id: UAT_RUN_NODE_ID,
    repository: {
      id: RELEASE_EVIDENCE_POLICY.repository.id,
      full_name: RELEASE_EVIDENCE_POLICY.repository.fullName
    },
    workflow_id: RELEASE_EVIDENCE_POLICY.uatWorkflow.id,
    name: makeUatTitle(),
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
  const environmentId = name.toLowerCase().includes("uat")
    ? UAT_ENVIRONMENT_ID
    : PRODUCTION_ENVIRONMENT_ID;
  return {
    id: environmentId,
    name,
    protection_rules: [{
      type: "required_reviewers",
      prevent_self_review: true,
      reviewers: reviewerIds.map((id) => ({
        type: "User",
        reviewer: { id, type: "User" }
      }))
    }],
    deployment_branch_policy: {
      protected_branches: true,
      custom_branch_policies: false
    },
    can_admins_bypass: false,
    ...overrides
  };
}

function makeUatReview({
  id = UAT_REVIEW_NODE_ID,
  state = "APPROVED",
  reviewerId = REVIEWER_ID,
  environmentId = UAT_ENVIRONMENT_ID,
  environmentName = "production-uat",
  environmentNodes = null,
  environmentPageInfo = { hasNextPage: false, endCursor: null }
} = {}) {
  const reviewedEnvironments = environmentNodes || [{
    databaseId: environmentId,
    name: environmentName
  }];
  return {
    id,
    state,
    user: { databaseId: reviewerId, login: "release-reviewer" },
    environments: {
      totalCount: reviewedEnvironments.length,
      nodes: reviewedEnvironments,
      pageInfo: environmentPageInfo
    }
  };
}

function makeUatReviewLog({
  nodeId = UAT_RUN_NODE_ID,
  runId = UAT_RUN_ID,
  reviews = [makeUatReview()],
  totalCount = reviews.length,
  pageInfo = { hasNextPage: false, endCursor: null }
} = {}) {
  return {
    __typename: "WorkflowRun",
    id: nodeId,
    databaseId: runId,
    deploymentReviews: { totalCount, nodes: reviews, pageInfo }
  };
}

function makePreparationReview(overrides = {}) {
  return makeUatReview({
    id: PRODUCTION_REVIEW_NODE_ID,
    environmentId: PRODUCTION_ENVIRONMENT_ID,
    environmentName: "production",
    ...overrides
  });
}

function makePreparationReviewLog({
  nodeId = PREPARATION_RUN_NODE_ID,
  runId = PREPARATION_RUN_ID,
  reviews = [makePreparationReview()],
  totalCount = reviews.length,
  pageInfo = { hasNextPage: false, endCursor: null }
} = {}) {
  return makeUatReviewLog({ nodeId, runId, reviews, totalCount, pageInfo });
}

function makeGit({
  origin = "https://github.com/TOTALLYMAJOR/quoteflow.git",
  tags = RELEASE_TAG,
  fail = ""
} = {}) {
  const calls = [];
  const git = (args, root) => {
    const command = args.join(" ");
    calls.push({ args, root });
    if (command === fail) return { status: 1, stdout: "", stderr: "rejected" };
    if (command === "diff --quiet HEAD --") {
      return { status: 0, stdout: "", stderr: "" };
    }
    if (command === "remote get-url origin") {
      return { status: 0, stdout: `${origin}\n`, stderr: "" };
    }
    if (command === `tag --points-at ${RELEASE_SHA} --list v[0-9]*.[0-9]*.[0-9]*`) {
      return { status: 0, stdout: `${tags}\n`, stderr: "" };
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
  const target = overrides.target || "vercel";
  const checkedItemIds = Object.hasOwn(overrides, "checked-item-ids")
    ? overrides["checked-item-ids"]
    : (checklist.itemIdsByTarget[target] || []).join(",");
  return {
    "release-sha": RELEASE_SHA,
    target,
    "rollback-sha": ROLLBACK_SHA,
    "staging-id": "dpl_immutable-123",
    "checklist-digest": checklist.digest,
    "checked-item-ids": checkedItemIds,
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

function validChecklistFixture(overrides = {}) {
  return {
    schema: "com.mbmapps.quotepilot.release-uat-checklist/v2",
    version: "fixture-v2",
    maximumAttestationAgeHours: 24,
    items: [{
      id: "one",
      label: "Required across every release target.",
      targets: [...DEPLOYMENT_PROFILES]
    }],
    ...overrides
  };
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

  test("accepts an optional release-artifact receipt path", () => {
    expect(parseReleaseEvidenceCliArgs([
      ...validArgs,
      "--output", "artifacts/release/evidence.json"
    ])).toEqual({
      "release-sha": RELEASE_SHA,
      "ci-run-id": String(CI_RUN_ID),
      "uat-run-id": String(UAT_RUN_ID),
      "rollback-sha": ROLLBACK_SHA,
      target: "vercel",
      output: "artifacts/release/evidence.json"
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

describe("production release evidence receipt writer", () => {
  test("atomically writes JSON only inside artifacts/release", () => {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), "quotepilot-release-receipt-"));
    tempDirs.push(root);
    const receipt = { schema: "fixture/v1", releaseSha: RELEASE_SHA };

    writeProductionReleaseEvidenceReceipt(
      receipt,
      "artifacts/release/evidence.json",
      root
    );

    expect(JSON.parse(fs.readFileSync(
      path.join(root, "artifacts", "release", "evidence.json"),
      "utf8"
    ))).toEqual(receipt);
    expect(fs.readdirSync(path.join(root, "artifacts", "release"))).toEqual([
      "evidence.json"
    ]);
  });

  test.each([
    ["../outside.json", /inside artifacts\/release/i],
    ["artifacts/release", /JSON file inside artifacts\/release/i],
    ["artifacts/release/evidence.txt", /use a \.json extension/i]
  ])("rejects unsafe receipt path %s", (output, expected) => {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), "quotepilot-release-receipt-"));
    tempDirs.push(root);
    expect(() => writeProductionReleaseEvidenceReceipt({}, output, root)).toThrow(expected);
  });

  test("rejects a symlinked receipt directory without writing outside the repository", () => {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), "quotepilot-release-receipt-"));
    const outside = fs.mkdtempSync(path.join(os.tmpdir(), "quotepilot-release-outside-"));
    tempDirs.push(root, outside);
    fs.mkdirSync(path.join(root, "artifacts"));
    fs.symlinkSync(outside, path.join(root, "artifacts", "release"));

    expect(() => writeProductionReleaseEvidenceReceipt(
      { schema: "fixture/v1" },
      "artifacts/release/evidence.json",
      root
    )).toThrow(/receipt output ancestors must be real/i);
    expect(fs.readdirSync(outside)).toEqual([]);
  });
});

describe("tracked UAT checklist", () => {
  test("loads a versioned, deduplicated checklist and stable digest", () => {
    expect(checklist.checklist.schema).toBe(
      "com.mbmapps.quotepilot.release-uat-checklist/v2"
    );
    expect(checklist.checklist.version).toBe("2026-08-04.10");
    expect(checklist.itemIds).toHaveLength(checklist.checklist.items.length);
    expect(checklist.digest).toMatch(/^[0-9a-f]{64}$/);
    expect(checklist.maximumAttestationAgeHours).toBeGreaterThan(0);
    expect(checklist.itemIdsByTarget).toEqual(EXPECTED_UAT_ITEM_IDS_BY_TARGET);
    expect(checklist.itemIds).not.toContain("portal.backfill-conflict-safety");
    for (const profile of DEPLOYMENT_PROFILES) {
      expect(checklist.itemIdsByTarget[profile]).not.toContain(
        "portal.backfill-conflict-safety"
      );
    }

    const combinedNarrowTargets = new Set([
      ...checklist.itemIdsByTarget["firebase-hosting"],
      ...checklist.itemIdsByTarget["firebase-backend"]
    ]);
    expect(checklist.itemIdsByTarget["firebase-all"]).toEqual(
      checklist.itemIds.filter((itemId) => combinedNarrowTargets.has(itemId))
    );
  });

  test("cannot silently drop or weaken critical auth, buyer-onboarding, or payment UAT coverage", () => {
    const targetsByItemId = new Map(
      checklist.checklist.items.map((item) => [item.id, item.targets])
    );
    const labelsByItemId = new Map(
      checklist.checklist.items.map((item) => [item.id, item.label])
    );

    for (const [itemId, expectedTargets] of Object.entries(CRITICAL_UAT_TARGETS)) {
      expect(targetsByItemId.get(itemId), itemId).toEqual(expectedTargets);
    }

    expect(labelsByItemId.get("buyer.hosted-invoice-lifecycle")).toMatch(
      /API version 2024-06-20/i
    );
    expect(labelsByItemId.get("buyer.hosted-invoice-lifecycle")).toMatch(
      /live quote client, API version/i
    );
    expect(labelsByItemId.get("buyer.public-initiation-controls")).toMatch(
      /each public status request.*60-request-per-five-minute.*before its first buyer-order read.*wrong-token.*later fulfillment reads.*TTL/is
    );
    expect(labelsByItemId.get("buyer.public-initiation-controls")).toMatch(
      /before any Auth.*request-scoped.*without duplicate email charge.*provider-verified void.*stale events/is
    );
    expect(labelsByItemId.get("buyer.public-initiation-controls")).toMatch(
      /open and payment-failed.*exact original creation request.*uncollectible or expired, paid, and activation.*reject automatic replacement.*platform-admin recovery.*terminal unpaid test Invoice.*voids an uncollectible Invoice.*no fulfillment artifacts.*operator audit.*paid, open, partially paid, fulfilled, superseded, and mismatched.*fail closed/is
    );
    expect(labelsByItemId.get("security.provider-secret-cutover")).toMatch(
      /buyer gate stayed off.*least-privilege Firebase Secret Manager.*new-plus-old overlap.*Turnstile.*HMAC-key rotation.*revoked only after exact hosted\/provider UAT/is
    );
    expect(labelsByItemId.get("buyer.pending-invite-activation")).toMatch(
      /Starter workspace plan entitlements/i
    );
    expect(labelsByItemId.get("buyer.pending-invite-activation")).toMatch(
      /activation_sent.*provider acceptance.*Firebase verification-email delivery/is
    );
    expect(labelsByItemId.get("buyer.pending-invite-activation")).toMatch(
      /workspaceReady=true.*manual exact-invoice-email/is
    );
    expect(labelsByItemId.get("buyer.verified-activation-surface")).toMatch(
      /does not claim onboarding-email provider acceptance/i
    );
    expect(labelsByItemId.get("buyer.verified-activation-surface")).toMatch(
      /stops automatic status polling.*manual Check again.*only active/is
    );
  });

  test("changes the checklist digest when only target applicability changes", () => {
    const base = {
      schema: "com.mbmapps.quotepilot.release-uat-checklist/v2",
      version: "fixture",
      maximumAttestationAgeHours: 24,
      items: [
        {
          id: "one",
          label: "One",
          targets: ["firebase-hosting", "firebase-backend", "firebase-all", "vercel"]
        },
        {
          id: "coverage",
          label: "Coverage",
          targets: ["firebase-hosting", "firebase-backend", "firebase-all", "vercel"]
        }
      ]
    };
    const first = getReleaseUatChecklist(writeChecklistFixture(base));
    const second = getReleaseUatChecklist(writeChecklistFixture({
      ...base,
      items: [
        {
          ...base.items[0],
          targets: ["firebase-hosting", "firebase-backend", "firebase-all"]
        },
        base.items[1]
      ]
    }));
    expect(first.digest).not.toBe(second.digest);
  });

  test.each([
    ["not-json", /missing or invalid JSON/i],
    [{ ...validChecklistFixture(), schema: "wrong" }, /schema is not supported/i],
    [{ ...validChecklistFixture(), schema: "com.mbmapps.quotepilot.release-uat-checklist/v1" }, /schema is not supported/i],
    [validChecklistFixture({ items: [] }), /no required items/i],
    [validChecklistFixture({ items: [{
      id: "Bad ID",
      label: "Bad id",
      targets: [...DEPLOYMENT_PROFILES]
    }] }), /invalid or duplicate item ids/i],
    [validChecklistFixture({ items: [
      { id: "same", label: "First", targets: [...DEPLOYMENT_PROFILES] },
      { id: "same", label: "Second", targets: [...DEPLOYMENT_PROFILES] }
    ] }), /invalid or duplicate item ids/i],
    [validChecklistFixture({ maximumAttestationAgeHours: 0 }), /invalid attestation age limit/i],
    [validChecklistFixture({ maximumAttestationAgeHours: 169 }), /invalid attestation age limit/i],
    [validChecklistFixture({ maximumAttestationAgeHours: "24" }), /invalid attestation age limit/i],
    [validChecklistFixture({ version: "" }), /version is invalid/i],
    [validChecklistFixture({ version: 2 }), /version is invalid/i],
    [validChecklistFixture({ items: [{
      id: "one",
      label: "",
      targets: [...DEPLOYMENT_PROFILES]
    }] }), /invalid label/i],
    [validChecklistFixture({ items: [{
      id: 1,
      label: "Numeric ids are not canonical.",
      targets: [...DEPLOYMENT_PROFILES]
    }] }), /invalid or duplicate item ids/i],
    [validChecklistFixture({ items: [{
      id: "one",
      label: 1,
      targets: [...DEPLOYMENT_PROFILES]
    }] }), /invalid label/i],
    [validChecklistFixture({ items: [{
      id: "one",
      label: "Missing applicability",
      targets: []
    }] }), /invalid target applicability/i],
    [validChecklistFixture({ items: [{
      id: "one",
      label: "Unknown target",
      targets: [...DEPLOYMENT_PROFILES, "all"]
    }] }), /invalid target applicability/i],
    [validChecklistFixture({ items: [{
      id: "one",
      label: "Duplicate target",
      targets: [...DEPLOYMENT_PROFILES, "vercel"]
    }] }), /invalid target applicability/i],
    [validChecklistFixture({ items: [{
      id: "one",
      label: "Firebase all was dropped",
      targets: ["firebase-hosting", "vercel"]
    }] }), /firebase-all equal to its Firebase narrow-target applicability/i],
    [validChecklistFixture({ items: [{
      id: "one",
      label: "Firebase all has no narrow owner",
      targets: ["firebase-all", "vercel"]
    }] }), /firebase-all equal to its Firebase narrow-target applicability/i],
    [validChecklistFixture({ unexpected: true }), /fields do not match the v2 contract/i],
    [validChecklistFixture({ items: [{
      id: "one",
      label: "Unexpected item field",
      targets: [...DEPLOYMENT_PROFILES],
      optional: true
    }] }), /item does not match the v2 contract/i]
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
      approvalMode: "independent-review",
      releaseSha: RELEASE_SHA,
      target: "vercel",
      rollbackSha: ROLLBACK_SHA,
      stagingId: "dpl_immutable-123",
      checklistDigest: checklist.digest
    });
  });

  test.each([
    ["release-uat/v2", /does not match the v2 evidence contract/i],
    [makeUatTitle({ releaseSha: "abc" }), /UAT release SHA must be a full/i],
    [makeUatTitle({ target: "all" }), /target is not firebase-hosting, firebase-backend, firebase-all, or vercel/i],
    [makeUatTitle({ target: "firebase-functions" }), /target is not firebase-hosting, firebase-backend, firebase-all, or vercel/i],
    [makeUatTitle({ stagingId: "x" }), /staging deployment id is invalid/i],
    [makeUatTitle({ checklistDigest: "abc" }), /checklist digest is invalid/i]
  ])("rejects malformed UAT title %#", (title, expected) => {
    expect(() => parseReleaseUatRunTitle(title)).toThrow(expected);
  });

  test("parses explicit approval modes and solo operator ids", () => {
    expect(parseReleaseApprovalMode("solo-operator")).toBe("solo-operator");
    expect([...parseSoloOperatorIds("303")]).toEqual([303]);
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

describe("current preparation workflow validator", () => {
  test.each(DEPLOYMENT_PROFILES)(
    "accepts the active first-attempt human %s workflow dispatch",
    (profile) => {
      expect(validatePreparationRun(
        makePreparationRun(profile),
        makePreparationOptions(profile)
      )).toEqual({
        operatorId: OPERATOR_ID,
        createdAt: "2026-08-04T10:00:00.000Z"
      });
    }
  );

  test.each([
    [{ repository: { id: 1, full_name: "other/repo" } }, /different repository/i],
    [{ id: 999 }, /response id does not match the current run/i],
    [{ workflow_id: 1 }, /not the canonical target preparation workflow/i],
    [{ path: ".github/workflows/other.yml" }, /not the canonical target preparation workflow/i],
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
  ])("rejects spoofable preparation-run evidence %#", (overrides, expected) => {
    expect(() => validatePreparationRun(
      makePreparationRun("vercel", overrides),
      makePreparationOptions("vercel")
    )).toThrow(expected);
  });

  test("rejects an unsupported preparation profile", () => {
    expect(() => validatePreparationRun(
      makePreparationRun("vercel"),
      makePreparationOptions("all")
    )).toThrow(/not the canonical target preparation workflow/i);
  });

  test("rejects a preparation title bound to a different profile", () => {
    expect(() => validatePreparationRun(
      makePreparationRun("firebase-hosting"),
      makePreparationOptions("firebase-backend")
    )).toThrow(/title is not bound to the supplied evidence/i);
  });

  test.each([
    ["profile", makePreparationTitle({ profile: "firebase-hosting" })],
    ["release SHA", makePreparationTitle({ releaseSha: OTHER_SHA })],
    ["CI run", makePreparationTitle({ ciRunId: 999 })],
    ["UAT run", makePreparationTitle({ uatRunId: 999 })],
    ["rollback SHA", makePreparationTitle({ rollbackSha: OTHER_SHA })],
    ["format", "prepare/v2/tampered"]
  ])("rejects a preparation title with tampered %s", (_field, displayTitle) => {
    expect(() => validatePreparationRun(
      makePreparationRun("vercel", { display_title: displayTitle }),
      makePreparationOptions("vercel")
    )).toThrow(/title is not bound to the supplied evidence/i);
  });
});

describe("direct deployment workflow validator", () => {
  test.each(DEPLOYMENT_PROFILES)(
    "accepts the active exact-evidence human %s dispatch",
    (profile) => {
      expect(validateDirectDeploymentRun(
        makeDirectDeploymentRun(profile),
        makeDirectDeploymentOptions(profile)
      )).toEqual({ operatorId: OPERATOR_ID });
    }
  );

  test.each([
    [{ repository: { id: 1, full_name: "other/repo" } }, /different repository/i],
    [{ id: 999 }, /response id does not match the current run/i],
    [{ workflow_id: 1 }, /not the canonical target deployment workflow/i],
    [{ event: "push" }, /not a main-branch manual dispatch/i],
    [{ head_branch: "feature" }, /not a main-branch manual dispatch/i],
    [{ head_sha: OTHER_SHA }, /not bound to the exact release SHA/i],
    [{ display_title: "deploy/v1/tampered" }, /title is not bound/i],
    [{ status: "completed", conclusion: "success" }, /not actively in progress/i],
    [{ run_attempt: 2 }, /reruns are not accepted/i],
    [{ actor: { id: OPERATOR_ID, type: "Bot" } }, /not dispatched by one human operator/i]
  ])("rejects invalid direct deployment evidence %#", (overrides, expected) => {
    expect(() => validateDirectDeploymentRun(
      makeDirectDeploymentRun("vercel", overrides),
      makeDirectDeploymentOptions("vercel")
    )).toThrow(expected);
  });
});

describe("protected GitHub environment validator", () => {
  test("accepts a protected environment with an independent reviewer", () => {
    expect(validateProtectedEnvironment(
      makeEnvironment("production-uat"),
      { name: "production-uat", attesterId: ATTESTER_ID }
    )).toEqual({
      approvalMode: "independent-review",
      environmentId: UAT_ENVIRONMENT_ID,
      reviewerIds: new Set([REVIEWER_ID])
    });
  });

  test("accepts GitHub's case-insensitive canonical environment name", () => {
    expect(() => validateProtectedEnvironment(
      makeEnvironment("Production"),
      { name: "production" }
    )).not.toThrow();
  });

  test("accepts a reviewless protected environment only for solo-operator mode", () => {
    expect(validateProtectedEnvironment(
      makeEnvironment("production-uat-solo", { protection_rules: [] }),
      {
        name: "production-uat-solo",
        attesterId: ATTESTER_ID,
        approvalMode: "solo-operator"
      }
    )).toEqual({
      approvalMode: "solo-operator",
      environmentId: UAT_ENVIRONMENT_ID,
      reviewerIds: new Set()
    });
  });

  test.each([
    [makeEnvironment("other"), /production-uat GitHub environment is missing/i],
    [{ name: "production-uat", protection_rules: [], deployment_branch_policy: {} }, /must require reviewers/i],
    [makeEnvironment("production-uat", { protection_rules: [{ type: "required_reviewers", prevent_self_review: false, reviewers: [{ reviewer: { id: REVIEWER_ID } }] }] }), /must require reviewers and prevent self-review/i],
    [makeEnvironment("production-uat", { reviewerIds: [] }), /has no valid required reviewer/i],
    [makeEnvironment("production-uat", { reviewerIds: [ATTESTER_ID] }), /needs a reviewer other than the UAT attester/i],
    [makeEnvironment("production-uat", { deployment_branch_policy: { protected_branches: false, custom_branch_policies: true } }), /limited to protected branches/i],
    [makeEnvironment("production-uat", { can_admins_bypass: true }), /prevent administrators from bypassing/i],
    [makeEnvironment("production-uat", { id: 0 }), /no valid GitHub environment id/i],
    [makeEnvironment("production-uat", { protection_rules: [{
      type: "required_reviewers",
      prevent_self_review: true,
      reviewers: [{ type: "Team", reviewer: { id: REVIEWER_ID, type: "Team" } }]
    }] }), /must use directly assigned user reviewers/i]
  ])("rejects an unsafe environment policy %#", (environment, expected) => {
    expect(() => validateProtectedEnvironment(environment, {
      name: "production-uat",
      attesterId: ATTESTER_ID
    })).toThrow(expected);
  });
});

describe("solo-operator compensating controls", () => {
  test("accepts one allowlisted human after the cooling period", () => {
    expect(validateSoloOperatorControls({
      attesterId: ATTESTER_ID,
      operatorId: ATTESTER_ID,
      soloOperatorIds: new Set([ATTESTER_ID]),
      uatCompletedAt: UAT_COMPLETED_AT,
      preparationCreatedAt: "2026-08-04T09:45:00.000Z"
    })).toEqual({
      approvalMode: "solo-operator",
      controlId: "solo-cooldown-15m",
      operatorId: ATTESTER_ID
    });
  });

  test.each([
    [{ soloOperatorIds: new Set([ATTESTER_ID, REVIEWER_ID]) }, /one allowlisted human/i],
    [{ operatorId: OPERATOR_ID }, /one allowlisted human/i],
    [{ preparationCreatedAt: "2026-08-04T09:44:59.000Z" }, /at least 15 minutes/i]
  ])("rejects an invalid solo-operator control %#", (overrides, expected) => {
    expect(() => validateSoloOperatorControls({
      attesterId: ATTESTER_ID,
      operatorId: ATTESTER_ID,
      soloOperatorIds: new Set([ATTESTER_ID]),
      uatCompletedAt: UAT_COMPLETED_AT,
      preparationCreatedAt: "2026-08-04T09:45:00.000Z",
      ...overrides
    })).toThrow(expected);
  });
});

describe("historical UAT deployment review validator", () => {
  const reviewOptions = {
    uatRunId: UAT_RUN_ID,
    uatNodeId: UAT_RUN_NODE_ID,
    environmentName: "production-uat",
    environmentId: UAT_ENVIRONMENT_ID,
    attesterId: ATTESTER_ID,
    requiredReviewerIds: new Set([REVIEWER_ID])
  };

  test("accepts one approved review for the exact run and current required reviewer", () => {
    expect(validateUatDeploymentReviews(makeUatReviewLog(), reviewOptions)).toEqual({
      reviewId: UAT_REVIEW_NODE_ID,
      reviewerId: REVIEWER_ID
    });
  });

  test.each([
    [makeUatReviewLog({ nodeId: "WFR_other" }), {}, /different UAT workflow run/i],
    [makeUatReviewLog({ runId: 999 }), {}, /different UAT workflow run/i],
    [makeUatReviewLog({ reviews: [] }), {}, /must have one recorded production-uat review/i],
    [makeUatReviewLog({ reviews: [makeUatReview({ state: "REJECTED" })] }), {}, /was not approved through the production-uat gate/i],
    [makeUatReviewLog({ reviews: [makeUatReview({ reviewerId: ATTESTER_ID })] }), {}, /not made by an independent required reviewer/i],
    [makeUatReviewLog({ reviews: [makeUatReview({ reviewerId: OTHER_REVIEWER_ID })] }), {}, /not made by an independent required reviewer/i],
    [makeUatReviewLog({ reviews: [makeUatReview({ environmentId: PRODUCTION_ENVIRONMENT_ID })] }), {}, /wrong environment id/i],
    [makeUatReviewLog({ reviews: [makeUatReview({ environmentName: "production" })] }), {}, /must have one recorded production-uat review/i],
    [makeUatReviewLog({ reviews: [makeUatReview(), makeUatReview({ id: "DR_second" })] }), {}, /must have one recorded production-uat review/i],
    [makeUatReviewLog({ totalCount: 2 }), {}, /review log is incomplete or invalid/i],
    [makeUatReviewLog({ pageInfo: { hasNextPage: true, endCursor: "cursor" } }), {}, /review log is incomplete or invalid/i],
    [makeUatReviewLog({ reviews: [makeUatReview({ environmentPageInfo: { hasNextPage: true, endCursor: "cursor" } })] }), {}, /incomplete environment evidence/i],
    [makeUatReviewLog({ reviews: [makeUatReview({ environmentNodes: [
      { databaseId: UAT_ENVIRONMENT_ID, name: "production-uat" },
      { databaseId: PRODUCTION_ENVIRONMENT_ID, name: "production" }
    ] })] }), {}, /incomplete environment evidence/i],
    [makeUatReviewLog({ reviews: [makeUatReview(), makeUatReview()] }), {}, /must have one recorded production-uat review/i],
    [{ ...makeUatReviewLog(), __typename: "Issue" }, {}, /different UAT workflow run/i],
    [makeUatReviewLog(), { requiredReviewerIds: new Set() }, /reviewer allowlist is missing/i]
  ])("rejects incomplete or spoofable deployment-review evidence %#", (run, overrides, expected) => {
    expect(() => validateUatDeploymentReviews(run, {
      ...reviewOptions,
      ...overrides
    })).toThrow(expected);
  });
});

describe("current preparation deployment review validator", () => {
  const reviewOptions = {
    preparationRunId: PREPARATION_RUN_ID,
    preparationNodeId: PREPARATION_RUN_NODE_ID,
    environmentName: "production",
    environmentId: PRODUCTION_ENVIRONMENT_ID,
    operatorId: OPERATOR_ID,
    attesterId: ATTESTER_ID,
    requiredReviewerIds: new Set([REVIEWER_ID])
  };

  test("accepts one approved production review by a current independent reviewer", () => {
    expect(validatePreparationDeploymentReviews(
      makePreparationReviewLog(),
      reviewOptions
    )).toEqual({
      reviewId: PRODUCTION_REVIEW_NODE_ID,
      reviewerId: REVIEWER_ID
    });
  });

  test.each([
    [makePreparationReviewLog({ nodeId: "WFR_other" }), {}, /different preparation workflow run/i],
    [makePreparationReviewLog({ reviews: [] }), {}, /one recorded production review/i],
    [makePreparationReviewLog({ reviews: [makePreparationReview({ reviewerId: OPERATOR_ID })] }), {}, /independent required reviewer/i],
    [makePreparationReviewLog({ reviews: [makePreparationReview({ reviewerId: ATTESTER_ID })] }), { requiredReviewerIds: new Set([ATTESTER_ID]) }, /independent required reviewer/i],
    [makePreparationReviewLog({ reviews: [makePreparationReview({ state: "REJECTED" })] }), {}, /not approved through the production gate/i]
  ])("rejects unsafe preparation approval evidence %#", (run, overrides, expected) => {
    expect(() => validatePreparationDeploymentReviews(run, {
      ...reviewOptions,
      ...overrides
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
        approvalMode: "independent-review",
        completedAt: UAT_COMPLETED_AT,
        stagingId: "dpl_immutable-123",
        attestedTarget: profile
      });
    }
  );

  test("accepts an allowlisted solo-operator UAT dispatch", () => {
    expect(validateUatRun(
      makeUatRun({
        display_title: makeUatTitle({ approvalMode: "solo-operator" })
      }),
      makeUatOptions({
        approvalMode: "solo-operator",
        soloOperatorIds: new Set([ATTESTER_ID])
      })
    )).toMatchObject({
      actorId: ATTESTER_ID,
      approvalMode: "solo-operator"
    });
  });

  test.each([
    [{ repository: { id: 1, full_name: "other/repo" } }, {}, /different repository/i],
    [{ id: 999 }, {}, /response id does not match/i],
    [{ workflow_id: 1 }, {}, /not the canonical attestation workflow/i],
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
    expect(validateGitEvidence({
      releaseSha: RELEASE_SHA,
      rollbackSha: ROLLBACK_SHA,
      headSha: RELEASE_SHA.toUpperCase()
    }, { git, root: "/fixture" })).toEqual({ releaseTags: [RELEASE_TAG] });
    expect(calls.map(({ args }) => args)).toEqual([
      ["diff", "--quiet", "HEAD", "--"],
      ["remote", "get-url", "origin"],
      ["tag", "--points-at", RELEASE_SHA, "--list", "v[0-9]*.[0-9]*.[0-9]*"],
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
    [{ fail: "diff --quiet HEAD --" }, /tracked checkout files changed/i],
    [{ fail: "remote get-url origin" }, /origin remote cannot be resolved/i],
    [{ tags: "" }, /no exact semantic vX.Y.Z tag in the checkout/i],
    [{ tags: "v01.2.3" }, /no exact semantic vX.Y.Z tag in the checkout/i],
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
  function makeFetch({
    failStatus = 0,
    graphQlPayloads = null,
    preparationGraphQlPayloads = null,
    annotatedTag = false,
    mainSha = RELEASE_SHA,
    tagSha = RELEASE_SHA,
    solo = false
  } = {}) {
    const calls = [];
    let graphQlPage = 0;
    let preparationGraphQlPage = 0;
    const fetchImpl = async (url, options) => {
      calls.push({ url, options });
      if (failStatus) {
        return { ok: false, status: failStatus, json: async () => ({}) };
      }
      let payload;
      if (url.endsWith("/git/ref/heads/main")) {
        payload = { ref: "refs/heads/main", object: { type: "commit", sha: mainSha } };
      } else if (url.endsWith(`/git/ref/tags/${RELEASE_TAG}`)) {
        payload = {
          ref: `refs/tags/${RELEASE_TAG}`,
          object: annotatedTag
            ? { type: "tag", sha: OTHER_SHA }
            : { type: "commit", sha: tagSha }
        };
      } else if (url.endsWith(`/git/tags/${OTHER_SHA}`)) {
        payload = {
          tag: RELEASE_TAG,
          object: { type: "commit", sha: tagSha }
        };
      } else if (url.endsWith(`/actions/runs/${PREPARATION_RUN_ID}`)) {
        payload = makePreparationRun("vercel", solo ? {
          actor: { id: ATTESTER_ID, type: "User", login: "release-attester" },
          triggering_actor: { id: ATTESTER_ID, type: "User", login: "release-attester" },
          display_title: makePreparationTitle({ approvalMode: "solo-operator" }),
          created_at: "2026-08-04T09:45:00.000Z"
        } : {});
      } else if (url.endsWith(`/actions/runs/${CI_RUN_ID}`)) payload = makeCiRun();
      else if (url.includes(`/actions/runs/${CI_RUN_ID}/jobs?`)) {
        payload = { total_count: makeCiJobs().length, jobs: makeCiJobs() };
      } else if (url.endsWith(`/actions/runs/${UAT_RUN_ID}`)) payload = makeUatRun(solo ? {
        display_title: makeUatTitle({ approvalMode: "solo-operator" })
      } : {});
      else if (url.includes(`/actions/runs/${UAT_RUN_ID}/jobs?`)) {
        payload = { total_count: makeUatJobs().length, jobs: makeUatJobs() };
      } else if (url.endsWith("/environments/production-uat")) {
        payload = makeEnvironment("production-uat");
      } else if (url.endsWith("/environments/production")) {
        payload = makeEnvironment("production");
      } else if (url.endsWith("/environments/production-uat-solo")) {
        payload = makeEnvironment("production-uat-solo", { protection_rules: [] });
      } else if (url.endsWith("/environments/production-solo")) {
        payload = makeEnvironment("production-solo", { protection_rules: [] });
      } else if (url.endsWith("/graphql")) {
        const variables = JSON.parse(options.body).variables;
        if (variables.runId === UAT_RUN_NODE_ID) {
          if (graphQlPayloads && graphQlPage >= graphQlPayloads.length) {
            return { ok: false, status: 404, json: async () => ({}) };
          }
          payload = graphQlPayloads
            ? graphQlPayloads[graphQlPage]
            : { data: { node: makeUatReviewLog() } };
          graphQlPage += 1;
        } else if (variables.runId === PREPARATION_RUN_NODE_ID) {
          if (
            preparationGraphQlPayloads
            && preparationGraphQlPage >= preparationGraphQlPayloads.length
          ) {
            return { ok: false, status: 404, json: async () => ({}) };
          }
          payload = preparationGraphQlPayloads
            ? preparationGraphQlPayloads[preparationGraphQlPage]
            : { data: { node: makePreparationReviewLog() } };
          preparationGraphQlPage += 1;
        } else {
          return { ok: false, status: 404, json: async () => ({}) };
        }
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
      preparationRunId: String(PREPARATION_RUN_ID),
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
      schema: "com.mbmapps.quotepilot.production-release-evidence/v5",
      approvalMode: "independent-review",
      releaseSha: RELEASE_SHA,
      releaseTag: RELEASE_TAG,
      rollbackSha: ROLLBACK_SHA,
      target: "vercel",
      ciRunId: CI_RUN_ID,
      uatRunId: UAT_RUN_ID,
      preparationRunId: PREPARATION_RUN_ID,
      stagingId: "dpl_immutable-123",
      attesterId: ATTESTER_ID,
      uatReviewerId: REVIEWER_ID,
      uatReviewId: UAT_REVIEW_NODE_ID,
      operatorId: OPERATOR_ID,
      productionReviewerId: REVIEWER_ID,
      productionReviewId: PRODUCTION_REVIEW_NODE_ID,
      checklistDigest: checklist.digest,
      verifiedAt: NOW.toISOString()
    });
    expect(Object.isFrozen(result)).toBe(true);
    expect(gitCalls).toHaveLength(5);
    expect(fetchCalls).toHaveLength(11);
    expect(fetchCalls.some(({ url }) =>
      url.endsWith(`/actions/runs/${PREPARATION_RUN_ID}`)
    )).toBe(true);
    expect(fetchCalls.every(({ options }) =>
      options.headers.Authorization === "Bearer test-token"
      && options.headers.Accept === "application/vnd.github+json"
      && options.redirect === "error"
      && options.signal instanceof AbortSignal
    )).toBe(true);
    const graphQlCall = fetchCalls.find(({ url, options }) => (
      url.endsWith("/graphql")
      && JSON.parse(options.body).variables.runId === UAT_RUN_NODE_ID
    ));
    expect(graphQlCall?.options.method).toBe("POST");
    expect(graphQlCall?.options.headers["Content-Type"]).toBe("application/json");
    expect(JSON.parse(graphQlCall?.options.body)).toMatchObject({
      variables: { runId: UAT_RUN_NODE_ID, after: null }
    });
    expect(JSON.parse(graphQlCall?.options.body).query).toContain(
      "deploymentReviews(first: 100, after: $after)"
    );
  });

  test("accepts an annotated semantic release tag resolved to the exact commit", async () => {
    const result = await verifyProductionReleaseEvidence(
      verifierInput(),
      { fetchImpl: makeFetch({ annotatedTag: true }).fetchImpl, git: makeGit().git, now: NOW }
    );
    expect(result.releaseTag).toBe(RELEASE_TAG);
  });

  test("binds solo-operator cooling-period evidence without a fabricated reviewer", async () => {
    const { fetchImpl, calls } = makeFetch({ solo: true });
    const result = await verifyProductionReleaseEvidence(
      verifierInput({
        approvalMode: "solo-operator",
        soloOperatorIds: new Set([ATTESTER_ID])
      }),
      { fetchImpl, git: makeGit().git, now: NOW }
    );

    expect(result).toMatchObject({
      schema: "com.mbmapps.quotepilot.production-release-evidence/v5",
      approvalMode: "solo-operator",
      attesterId: ATTESTER_ID,
      uatReviewerId: ATTESTER_ID,
      operatorId: ATTESTER_ID,
      productionReviewerId: ATTESTER_ID,
      uatReviewId: `solo-uat:${UAT_RUN_ID}`,
      productionReviewId: `solo-cooldown-15m:${PREPARATION_RUN_ID}`
    });
    expect(calls.some(({ url }) => url.endsWith("/graphql"))).toBe(false);
  });

  test.each([
    [{ mainSha: OTHER_SHA }, /not the current remotely published origin\/main/i],
    [{ tagSha: OTHER_SHA }, /no exact semantic vX.Y.Z tag published to origin/i]
  ])("rejects mismatched published release refs %#", async (fetchOptions, expected) => {
    await expect(verifyProductionReleaseEvidence(
      verifierInput(),
      { fetchImpl: makeFetch(fetchOptions).fetchImpl, git: makeGit().git, now: NOW }
    )).rejects.toThrow(expected);
  });

  test("fails closed when GitHub evidence is unavailable", async () => {
    const { fetchImpl } = makeFetch({ failStatus: 503 });
    await expect(verifyProductionReleaseEvidence(
      verifierInput(),
      { fetchImpl, git: makeGit().git, now: NOW }
    )).rejects.toThrow(/GitHub evidence request failed with HTTP 503/i);
  });

  test.each([
    [OPERATOR_ID, new Set([OPERATOR_ID]), /independent required reviewer/i],
    [ATTESTER_ID, new Set([ATTESTER_ID]), /independent required reviewer/i]
  ])("rejects a production approval by excluded actor %s", async (reviewerId, reviewerIds, expected) => {
    const { fetchImpl } = makeFetch({
      preparationGraphQlPayloads: [{
        data: { node: makePreparationReviewLog({
          reviews: [makePreparationReview({ reviewerId })]
        }) }
      }]
    });
    const originalMakeEnvironment = makeEnvironment;
    const wrappedFetch = async (url, options) => {
      if (url.endsWith("/environments/production")) {
        return {
          ok: true,
          status: 200,
          json: async () => originalMakeEnvironment("production", {
            reviewerIds: [...reviewerIds]
          })
        };
      }
      return fetchImpl(url, options);
    };
    await expect(verifyProductionReleaseEvidence(
      verifierInput(),
      { fetchImpl: wrappedFetch, git: makeGit().git, now: NOW }
    )).rejects.toThrow(expected);
  });

  test("collects every review page before rejecting a non-canonical review log", async () => {
    const firstReview = makeUatReview();
    const unrelatedReview = makeUatReview({
      id: "DR_unrelated-production-review",
      environmentId: PRODUCTION_ENVIRONMENT_ID,
      environmentName: "production"
    });
    const { fetchImpl, calls } = makeFetch({
      graphQlPayloads: [
        { data: { node: makeUatReviewLog({
          reviews: [firstReview],
          totalCount: 2,
          pageInfo: { hasNextPage: true, endCursor: "page-2" }
        }) } },
        { data: { node: makeUatReviewLog({
          reviews: [unrelatedReview],
          totalCount: 2,
          pageInfo: { hasNextPage: false, endCursor: null }
        }) } }
      ]
    });

    await expect(verifyProductionReleaseEvidence(
      verifierInput(),
      { fetchImpl, git: makeGit().git, now: NOW }
    )).rejects.toThrow(/must have one recorded production-uat review/i);

    const graphQlCalls = calls.filter(({ url, options }) => (
      url.endsWith("/graphql")
      && JSON.parse(options.body).variables.runId === UAT_RUN_NODE_ID
    ));
    expect(graphQlCalls).toHaveLength(2);
    expect(JSON.parse(graphQlCalls[1].options.body).variables.after).toBe("page-2");
  });

  test.each([
    [[{ errors: [{ message: "forbidden" }] }], /GraphQL rejected the UAT deployment review query/i],
    [[{ errors: [], data: { node: makeUatReviewLog() } }], /GraphQL rejected the UAT deployment review query/i],
    [[{ data: { node: null } }], /invalid UAT deployment review evidence/i],
    [[{ data: { node: makeUatReviewLog({ nodeId: "WFR_other" }) } }], /invalid UAT deployment review evidence/i],
    [[{ data: { node: { ...makeUatReviewLog(), __typename: "Issue" } } }], /invalid UAT deployment review evidence/i],
    [[{ data: { node: makeUatReviewLog({
      reviews: [],
      totalCount: 1,
      pageInfo: { hasNextPage: true, endCursor: "page-2" }
    }) } }], /pagination ended early/i],
    [[
      { data: { node: makeUatReviewLog({
        reviews: [makeUatReview()],
        totalCount: 2,
        pageInfo: { hasNextPage: true, endCursor: "page-2" }
      }) } },
      { data: { node: makeUatReviewLog({
        reviews: [makeUatReview({
          id: "DR_second",
          environmentId: PRODUCTION_ENVIRONMENT_ID,
          environmentName: "production"
        })],
        totalCount: 2,
        pageInfo: { hasNextPage: true, endCursor: "page-2" }
      }) } }
    ], /pagination ended early/i],
    [[
      { data: { node: makeUatReviewLog({
        reviews: [makeUatReview()],
        totalCount: 2,
        pageInfo: { hasNextPage: true, endCursor: "page-2" }
      }) } },
      { data: { node: makeUatReviewLog({
        reviews: [makeUatReview({ id: "DR_second" })],
        totalCount: 3
      }) } }
    ], /invalid UAT deployment review evidence/i],
    [[{ data: { node: makeUatReviewLog({
      reviews: [makeUatReview()],
      totalCount: 2
    }) } }], /pagination returned the wrong count/i]
  ])("fails closed for malformed GraphQL review evidence %#", async (graphQlPayloads, expected) => {
    await expect(verifyProductionReleaseEvidence(
      verifierInput(),
      {
        fetchImpl: makeFetch({ graphQlPayloads }).fetchImpl,
        git: makeGit().git,
        now: NOW
      }
    )).rejects.toThrow(expected);
  });

  test.each([
    [{ token: "" }, /GITHUB_TOKEN or GH_TOKEN is required/i],
    [{ target: "all" }, /deployment target must be firebase-hosting, firebase-backend, firebase-all, or vercel/i],
    [{ target: "firebase-functions" }, /deployment target must be firebase-hosting, firebase-backend, firebase-all, or vercel/i],
    [{ ciRunId: "0" }, /positive GitHub Actions run id/i],
    [{ uatRunId: "999999999999999999999" }, /outside the supported integer range/i],
    [{ preparationRunId: "" }, /GITHUB_RUN_ID must be a positive GitHub Actions run id/i]
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
    "--checked-item-ids", checklist.itemIdsByTarget.vercel.join(","),
    "--confirmation", `ATTEST UAT ${RELEASE_SHA}`,
    "--output", "artifacts/release/uat-attestation.json"
  ];

  test("supports read-only checklist modes and parses a complete attestation", () => {
    expect(parseReleaseUatArgs(["--print-digest"])).toEqual({ printDigest: true });
    expect(parseReleaseUatArgs(["--print-items", "--target", "firebase-backend"])).toEqual({
      printItems: true,
      target: "firebase-backend"
    });
    expect(getReleaseUatItemIdsForTarget("firebase-backend", process.cwd())).toEqual(
      EXPECTED_UAT_ITEM_IDS_BY_TARGET["firebase-backend"]
    );
    expect(parseReleaseUatArgs(validArgv)).toEqual(makeReceiptArgs());
  });

  test.each([
    [["--print-digest", "extra"], /unknown argument --print-digest/i],
    [["--print-items"], /requires --target/i],
    [["--print-items", "--target", "vercel", "extra"], /requires --target/i],
    [["--print-items", "--target", "all"], /--target must be firebase-hosting/i],
    [[...validArgv, "--target", "all"], /duplicate argument --target/i],
    [["--release-sha", "--target"], /--release-sha requires a value/i],
    [validArgv.slice(0, -2), /--output is required/i]
  ])("rejects malformed attestation argv %#", (argv, expected) => {
    expect(() => parseReleaseUatArgs(argv)).toThrow(expected);
  });

  test("builds an immutable receipt only for an exact first-attempt main dispatch", () => {
    const receipt = buildReleaseUatReceipt(makeReceiptArgs({
      "checked-item-ids": [...checklist.itemIdsByTarget.vercel].reverse().join(",")
    }), {
      env: makeReceiptEnv(),
      root: process.cwd(),
      now: NOW
    });

    expect(receipt).toEqual({
      schema: "com.mbmapps.quotepilot.release-uat-attestation/v2",
      approvalMode: "independent-review",
      releaseSha: RELEASE_SHA,
      target: "vercel",
      rollbackSha: ROLLBACK_SHA,
      stagingId: "dpl_immutable-123",
      checklist: {
        schema: checklist.checklist.schema,
        version: checklist.checklist.version,
        digest: checklist.digest,
        checkedItemIds: checklist.itemIdsByTarget.vercel
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

  test("records the explicit solo-operator approval mode", () => {
    const receipt = buildReleaseUatReceipt(makeReceiptArgs(), {
      env: makeReceiptEnv({
        RELEASE_APPROVAL_MODE: "solo-operator",
        RELEASE_SOLO_OPERATOR_IDS: String(ATTESTER_ID)
      }),
      root: process.cwd(),
      now: NOW
    });
    expect(receipt.approvalMode).toBe("solo-operator");
  });

  test("writes a create-only receipt and rejects symlinked output ancestors", () => {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), "quotepilot-uat-receipt-"));
    const outside = fs.mkdtempSync(path.join(os.tmpdir(), "quotepilot-uat-outside-"));
    tempDirs.push(root, outside);
    const receipt = { schema: "fixture/v1" };
    writeReleaseUatReceipt(receipt, "artifacts/release/uat.json", root);
    expect(JSON.parse(fs.readFileSync(
      path.join(root, "artifacts", "release", "uat.json"),
      "utf8"
    ))).toEqual(receipt);
    expect(() => writeReleaseUatReceipt(
      receipt,
      "artifacts/release/uat.json",
      root
    )).toThrow();

    const symlinkRoot = fs.mkdtempSync(path.join(os.tmpdir(), "quotepilot-uat-symlink-"));
    tempDirs.push(symlinkRoot);
    fs.mkdirSync(path.join(symlinkRoot, "artifacts"));
    fs.symlinkSync(outside, path.join(symlinkRoot, "artifacts", "release"));
    expect(() => writeReleaseUatReceipt(
      receipt,
      "artifacts/release/uat.json",
      symlinkRoot
    )).toThrow(/output ancestors must be real/i);
    expect(fs.readdirSync(outside)).toEqual([]);
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
      expect(receipt.checklist.checkedItemIds).toEqual(
        checklist.itemIdsByTarget[profile]
      );
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
    [{ "checked-item-ids": checklist.itemIdsByTarget.vercel.slice(1).join(",") }, {}, /every vercel checklist item exactly once/i],
    [{ "checked-item-ids": [...checklist.itemIdsByTarget.vercel, checklist.itemIdsByTarget.vercel[0]].join(",") }, {}, /every vercel checklist item exactly once/i],
    [{ "checked-item-ids": checklist.itemIds.join(",") }, {}, /no non-applicable items/i],
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
