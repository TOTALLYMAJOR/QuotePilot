#!/usr/bin/env node

import crypto from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import { spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const GITHUB_API = "https://api.github.com";
const GITHUB_GRAPHQL_API = `${GITHUB_API}/graphql`;
const GITHUB_API_VERSION = "2026-03-10";
const GITHUB_REQUEST_TIMEOUT_MS = 15_000;
const DEPLOYMENT_REVIEWS_QUERY = `
  query WorkflowRunDeploymentReviews($runId: ID!, $after: String) {
    node(id: $runId) {
      __typename
      ... on WorkflowRun {
        id
        databaseId
        deploymentReviews(first: 100, after: $after) {
          totalCount
          nodes {
            id
            state
            user {
              databaseId
              login
            }
            environments(first: 100) {
              totalCount
              nodes {
                databaseId
                name
              }
              pageInfo {
                hasNextPage
                endCursor
              }
            }
          }
          pageInfo {
            hasNextPage
            endCursor
          }
        }
      }
    }
  }
`;

export const RELEASE_EVIDENCE_POLICY = Object.freeze({
  repository: Object.freeze({
    id: 1167899098,
    fullName: "TOTALLYMAJOR/quoteflow"
  }),
  ciWorkflow: Object.freeze({
    id: 244476596,
    name: "CI Quality",
    path: ".github/workflows/ci-quality.yml"
  }),
  uatWorkflow: Object.freeze({
    name: "Release UAT Attestation",
    path: ".github/workflows/release-uat-attestation.yml",
    jobName: "release-uat-attestation"
  }),
  preparationWorkflows: Object.freeze({
    "firebase-hosting": Object.freeze({
      name: "Prepare Firebase Production Artifact",
      path: ".github/workflows/deploy-firebase-hosting.yml"
    }),
    "firebase-backend": Object.freeze({
      name: "Prepare Firebase Production Artifact",
      path: ".github/workflows/deploy-firebase-hosting.yml"
    }),
    "firebase-all": Object.freeze({
      name: "Prepare Firebase Production Artifact",
      path: ".github/workflows/deploy-firebase-hosting.yml"
    }),
    vercel: Object.freeze({
      name: "Prepare Vercel Production Artifact",
      path: ".github/workflows/deploy-vercel-production.yml"
    })
  }),
  environments: Object.freeze({
    uat: "production-uat",
    deploy: "production"
  }),
  requiredCiJobs: Object.freeze([
    "Classify Changes + Lane Plan",
    "lane:quick (Preflight + Secrets)",
    "lane:core (Unit + Build + Governance + Bundle)",
    "Docker Build Smoke",
    "lane:playwright-smoke",
    "lane:firebase-auth-rules",
    "lane:authoritative-pricing",
    "lane:cwv-smoke"
  ])
});

function evidenceError(message) {
  return new Error(`Release evidence rejected: ${message}`);
}

function requireFullSha(value, field) {
  const normalized = String(value || "").trim().toLowerCase();
  if (!/^[0-9a-f]{40}$/.test(normalized)) {
    throw evidenceError(`${field} must be a full 40-character commit SHA.`);
  }
  return normalized;
}

function requireRunId(value, field) {
  const normalized = String(value || "").trim();
  if (!/^[1-9][0-9]*$/.test(normalized)) {
    throw evidenceError(`${field} must be a positive GitHub Actions run id.`);
  }
  const parsed = Number(normalized);
  if (!Number.isSafeInteger(parsed)) {
    throw evidenceError(`${field} is outside the supported integer range.`);
  }
  return parsed;
}

function normalizeWorkflowPath(value) {
  return String(value || "").split("@")[0];
}

function readChecklist(root = ROOT) {
  const checklistPath = path.join(root, "docs", "release-uat-checklist.json");
  let raw;
  let checklist;
  try {
    raw = fs.readFileSync(checklistPath);
    checklist = JSON.parse(raw.toString("utf8"));
  } catch {
    throw evidenceError("the tracked release UAT checklist is missing or invalid JSON.");
  }

  if (checklist?.schema !== "com.mbmapps.quotepilot.release-uat-checklist/v2") {
    throw evidenceError("the release UAT checklist schema is not supported.");
  }
  const checklistFields = Object.keys(checklist).sort();
  const expectedChecklistFields = ["items", "maximumAttestationAgeHours", "schema", "version"];
  if (
    checklistFields.length !== expectedChecklistFields.length
    || checklistFields.some((field, index) => field !== expectedChecklistFields[index])
  ) {
    throw evidenceError("the release UAT checklist contains unsupported fields.");
  }
  if (typeof checklist.version !== "string" || !checklist.version.trim()) {
    throw evidenceError("the release UAT checklist version is required.");
  }
  if (!Array.isArray(checklist.items) || checklist.items.length === 0) {
    throw evidenceError("the release UAT checklist has no required items.");
  }
  const itemIds = checklist.items.map((item) => String(item?.id || "").trim());
  if (
    itemIds.some((itemId) => !/^[a-z0-9]+(?:[.-][a-z0-9]+)*$/.test(itemId))
    || new Set(itemIds).size !== itemIds.length
  ) {
    throw evidenceError("the release UAT checklist contains invalid or duplicate item ids.");
  }
  const supportedTargets = Object.keys(RELEASE_EVIDENCE_POLICY.preparationWorkflows);
  const supportedTargetSet = new Set(supportedTargets);
  const itemIdsByTarget = Object.fromEntries(
    supportedTargets.map((target) => [target, []])
  );
  for (const [index, item] of checklist.items.entries()) {
    if (!item || typeof item !== "object" || Array.isArray(item)) {
      throw evidenceError(`release UAT checklist item ${index + 1} is invalid.`);
    }
    const fields = Object.keys(item).sort();
    const expectedFields = ["id", "label", "targets"];
    if (
      fields.length !== expectedFields.length
      || fields.some((field, fieldIndex) => field !== expectedFields[fieldIndex])
    ) {
      throw evidenceError(`release UAT checklist item ${itemIds[index]} contains unsupported fields.`);
    }
    if (typeof item.label !== "string" || !item.label.trim()) {
      throw evidenceError(`release UAT checklist item ${itemIds[index]} has an invalid label.`);
    }
    if (
      !Array.isArray(item.targets)
      || item.targets.length === 0
      || new Set(item.targets).size !== item.targets.length
      || item.targets.some((target) => (
        typeof target !== "string"
        || !supportedTargetSet.has(target)
      ))
    ) {
      throw evidenceError(`release UAT checklist item ${itemIds[index]} has invalid target applicability.`);
    }
    const appliesToFirebaseNarrowTarget = item.targets.some((target) => (
      target === "firebase-hosting" || target === "firebase-backend"
    ));
    if (appliesToFirebaseNarrowTarget && !item.targets.includes("firebase-all")) {
      throw evidenceError(
        `release UAT checklist item ${itemIds[index]} must apply to firebase-all when it applies to a narrower Firebase target.`
      );
    }
    if (item.targets.includes("firebase-all") && !appliesToFirebaseNarrowTarget) {
      throw evidenceError(
        `release UAT checklist item ${itemIds[index]} cannot apply only to the combined Firebase target.`
      );
    }
    for (const target of item.targets) itemIdsByTarget[target].push(itemIds[index]);
  }
  if (supportedTargets.some((target) => itemIdsByTarget[target].length === 0)) {
    throw evidenceError("the release UAT checklist leaves a deployment target without required items.");
  }
  const maximumAttestationAgeHours = checklist.maximumAttestationAgeHours;
  if (
    !Number.isInteger(maximumAttestationAgeHours)
    || maximumAttestationAgeHours < 1
    || maximumAttestationAgeHours > 168
  ) {
    throw evidenceError("the release UAT checklist has an invalid attestation age limit.");
  }

  return {
    raw,
    checklist,
    itemIds: Object.freeze([...itemIds]),
    itemIdsByTarget: Object.freeze(Object.fromEntries(
      supportedTargets.map((target) => [target, Object.freeze([...itemIdsByTarget[target]])])
    )),
    digest: crypto.createHash("sha256").update(raw).digest("hex"),
    maximumAttestationAgeHours
  };
}

export function getReleaseUatChecklist(root = ROOT) {
  return readChecklist(root);
}

export function parseAttesterIds(value) {
  const tokens = String(value || "")
    .split(",")
    .map((token) => token.trim())
    .filter(Boolean);
  if (tokens.length === 0 || tokens.some((token) => !/^[1-9][0-9]*$/.test(token))) {
    throw evidenceError("RELEASE_UAT_ATTESTER_IDS must contain GitHub numeric user ids.");
  }
  const ids = tokens.map(Number);
  if (ids.some((id) => !Number.isSafeInteger(id)) || new Set(ids).size !== ids.length) {
    throw evidenceError("RELEASE_UAT_ATTESTER_IDS contains an invalid or duplicate id.");
  }
  return new Set(ids);
}

export function parseReleaseUatRunTitle(value) {
  const parts = String(value || "").split("/");
  if (parts.length !== 7 || parts[0] !== "release-uat" || parts[1] !== "v1") {
    throw evidenceError("the UAT workflow title does not match the v1 evidence contract.");
  }
  const [, , releaseShaValue, target, rollbackShaValue, stagingId, checklistDigest] = parts;
  const releaseSha = requireFullSha(releaseShaValue, "UAT release SHA");
  const rollbackSha = requireFullSha(rollbackShaValue, "UAT rollback SHA");
  if (!Object.hasOwn(RELEASE_EVIDENCE_POLICY.preparationWorkflows, target)) {
    throw evidenceError(
      "the UAT target is not firebase-hosting, firebase-backend, firebase-all, or vercel."
    );
  }
  if (!/^[A-Za-z0-9][A-Za-z0-9._:-]{2,79}$/.test(stagingId)) {
    throw evidenceError("the UAT staging deployment id is invalid.");
  }
  if (!/^[0-9a-f]{64}$/.test(checklistDigest)) {
    throw evidenceError("the UAT checklist digest is invalid.");
  }
  return { releaseSha, target, rollbackSha, stagingId, checklistDigest };
}

function validateCanonicalRepository(run, label) {
  const actualId = Number(run?.repository?.id);
  const actualName = String(run?.repository?.full_name || "");
  if (
    actualId !== RELEASE_EVIDENCE_POLICY.repository.id
    || actualName !== RELEASE_EVIDENCE_POLICY.repository.fullName
  ) {
    throw evidenceError(`${label} belongs to a different repository.`);
  }
}

export function validateCiRun(run, { releaseSha, ciRunId }) {
  validateCanonicalRepository(run, "the CI run");
  if (Number(run?.id) !== ciRunId) {
    throw evidenceError("the CI response id does not match the requested run.");
  }
  if (
    Number(run?.workflow_id) !== RELEASE_EVIDENCE_POLICY.ciWorkflow.id
    || String(run?.name || "") !== RELEASE_EVIDENCE_POLICY.ciWorkflow.name
    || normalizeWorkflowPath(run?.path) !== RELEASE_EVIDENCE_POLICY.ciWorkflow.path
  ) {
    throw evidenceError("the CI run is not the canonical CI Quality workflow.");
  }
  if (run?.event !== "push" || run?.head_branch !== "main") {
    throw evidenceError("the CI run is not a main-branch push run.");
  }
  if (String(run?.head_sha || "").toLowerCase() !== releaseSha) {
    throw evidenceError("the CI run is not bound to the exact release SHA.");
  }
  if (run?.status !== "completed" || run?.conclusion !== "success") {
    throw evidenceError("the CI run is not completed successfully.");
  }
}

export function validateCiJobs(jobs) {
  if (!Array.isArray(jobs) || jobs.length === 0) {
    throw evidenceError("the CI run returned no jobs.");
  }
  const jobsByName = new Map();
  for (const job of jobs) {
    const name = String(job?.name || "");
    if (jobsByName.has(name)) {
      throw evidenceError(`the CI run contains duplicate job name ${name || "<blank>"}.`);
    }
    jobsByName.set(name, job);
    if (job?.status !== "completed" || job?.conclusion !== "success") {
      throw evidenceError(`CI job ${name || "<blank>"} did not complete successfully.`);
    }
  }
  for (const requiredName of RELEASE_EVIDENCE_POLICY.requiredCiJobs) {
    if (!jobsByName.has(requiredName)) {
      throw evidenceError(`required CI job ${requiredName} is missing.`);
    }
  }
}

export function validateProtectedEnvironment(environment, { name, attesterId = null }) {
  if (
    String(environment?.name || "").toLowerCase()
    !== String(name || "").toLowerCase()
  ) {
    throw evidenceError(`the ${name} GitHub environment is missing.`);
  }
  const reviewerRule = Array.isArray(environment.protection_rules)
    ? environment.protection_rules.find((rule) => rule?.type === "required_reviewers")
    : null;
  if (!reviewerRule || reviewerRule.prevent_self_review !== true) {
    throw evidenceError(`${name} must require reviewers and prevent self-review.`);
  }
  const reviewers = Array.isArray(reviewerRule.reviewers) ? reviewerRule.reviewers : [];
  if (reviewers.some((entry) => entry?.type !== "User" || entry?.reviewer?.type !== "User")) {
    throw evidenceError(`${name} must use directly assigned user reviewers.`);
  }
  const reviewerIds = reviewers
    .map((entry) => Number(entry?.reviewer?.id))
    .filter((id) => Number.isSafeInteger(id) && id > 0);
  if (reviewerIds.length === 0 || new Set(reviewerIds).size !== reviewerIds.length) {
    throw evidenceError(`${name} has no valid required reviewer.`);
  }
  if (attesterId && !reviewerIds.some((id) => id !== attesterId)) {
    throw evidenceError(`${name} needs a reviewer other than the UAT attester.`);
  }
  if (
    environment?.deployment_branch_policy?.protected_branches !== true
    || environment?.deployment_branch_policy?.custom_branch_policies !== false
  ) {
    throw evidenceError(`${name} must be limited to protected branches.`);
  }
  if (environment?.can_admins_bypass !== false) {
    throw evidenceError(`${name} must prevent administrators from bypassing protection rules.`);
  }

  const environmentId = Number(environment?.id);
  if (!Number.isSafeInteger(environmentId) || environmentId <= 0) {
    throw evidenceError(`${name} has no valid GitHub environment id.`);
  }

  return Object.freeze({ environmentId, reviewerIds: new Set(reviewerIds) });
}

function requireOpaqueNodeId(value, field) {
  const normalized = String(value || "").trim();
  if (!normalized || normalized.length > 512 || /\s/.test(normalized)) {
    throw evidenceError(`${field} is missing or invalid.`);
  }
  return normalized;
}

function validateDeploymentReviews(
  workflowRun,
  {
    runId,
    runNodeId,
    environmentName,
    environmentId,
    excludedActorIds,
    requiredReviewerIds,
    label
  }
) {
  const expectedNodeId = requireOpaqueNodeId(runNodeId, `the ${label} workflow node id`);
  if (
    workflowRun?.__typename !== "WorkflowRun"
    || requireOpaqueNodeId(workflowRun?.id, "the reviewed workflow node id") !== expectedNodeId
    || Number(workflowRun?.databaseId) !== runId
  ) {
    throw evidenceError(`deployment reviews belong to a different ${label} workflow run.`);
  }
  if (!(requiredReviewerIds instanceof Set) || requiredReviewerIds.size === 0) {
    throw evidenceError(`the ${label} reviewer allowlist is missing.`);
  }

  const connection = workflowRun?.deploymentReviews;
  const reviews = Array.isArray(connection?.nodes) ? connection.nodes : null;
  const totalCount = Number(connection?.totalCount);
  if (
    !reviews
    || !Number.isSafeInteger(totalCount)
    || totalCount < 0
    || totalCount !== reviews.length
    || connection?.pageInfo?.hasNextPage !== false
  ) {
    throw evidenceError(`the ${label} deployment review log is incomplete or invalid.`);
  }
  if (reviews.length !== 1) {
    throw evidenceError(`the exact ${label} run must have one recorded ${environmentName} review.`);
  }

  const seenReviewIds = new Set();
  const matchingReviews = [];
  for (const review of reviews) {
    const reviewId = requireOpaqueNodeId(review?.id, `a ${label} deployment review id`);
    if (seenReviewIds.has(reviewId)) {
      throw evidenceError(`the ${label} deployment review log contains duplicate reviews.`);
    }
    seenReviewIds.add(reviewId);

    const environments = review?.environments;
    const environmentNodes = Array.isArray(environments?.nodes) ? environments.nodes : null;
    const environmentCount = Number(environments?.totalCount);
    if (
      !environmentNodes
      || !Number.isSafeInteger(environmentCount)
      || environmentCount < 0
      || environmentCount !== environmentNodes.length
      || environmentNodes.length !== 1
      || environments?.pageInfo?.hasNextPage !== false
    ) {
      throw evidenceError(`a ${label} deployment review has incomplete environment evidence.`);
    }

    const namedEnvironments = environmentNodes.filter(
      (entry) => String(entry?.name || "").toLowerCase() === environmentName.toLowerCase()
    );
    if (namedEnvironments.some((entry) => Number(entry?.databaseId) !== environmentId)) {
      throw evidenceError(`a ${label} deployment review references the wrong environment id.`);
    }
    if (namedEnvironments.some((entry) => Number(entry?.databaseId) === environmentId)) {
      matchingReviews.push({ review, reviewId });
    }
  }

  if (matchingReviews.length !== 1) {
    throw evidenceError(`the exact ${label} run must have one recorded ${environmentName} review.`);
  }
  const [{ review, reviewId }] = matchingReviews;
  if (review?.state !== "APPROVED") {
    throw evidenceError(`the exact ${label} run was not approved through the ${environmentName} gate.`);
  }
  const reviewerId = Number(review?.user?.databaseId);
  if (
    !Number.isSafeInteger(reviewerId)
    || reviewerId <= 0
    || !(excludedActorIds instanceof Set)
    || excludedActorIds.has(reviewerId)
    || !requiredReviewerIds.has(reviewerId)
  ) {
    throw evidenceError(
      `the ${label} deployment review was not made by an independent required reviewer.`
    );
  }

  return Object.freeze({ reviewId, reviewerId });
}

export function validateUatDeploymentReviews(workflowRun, options) {
  return validateDeploymentReviews(workflowRun, {
    runId: options.uatRunId,
    runNodeId: options.uatNodeId,
    environmentName: options.environmentName,
    environmentId: options.environmentId,
    excludedActorIds: new Set([options.attesterId]),
    requiredReviewerIds: options.requiredReviewerIds,
    label: "UAT"
  });
}

export function validatePreparationDeploymentReviews(workflowRun, options) {
  return validateDeploymentReviews(workflowRun, {
    runId: options.preparationRunId,
    runNodeId: options.preparationNodeId,
    environmentName: options.environmentName,
    environmentId: options.environmentId,
    excludedActorIds: new Set([options.operatorId, options.attesterId]),
    requiredReviewerIds: options.requiredReviewerIds,
    label: "preparation"
  });
}

export function validateUatRun(
  run,
  {
    releaseSha,
    rollbackSha,
    target,
    uatRunId,
    checklistDigest,
    attesterIds,
    ciCompletedAt,
    now,
    maximumAttestationAgeHours
  }
) {
  validateCanonicalRepository(run, "the UAT run");
  if (Number(run?.id) !== uatRunId) {
    throw evidenceError("the UAT response id does not match the requested run.");
  }
  if (
    String(run?.name || "") !== RELEASE_EVIDENCE_POLICY.uatWorkflow.name
    || normalizeWorkflowPath(run?.path) !== RELEASE_EVIDENCE_POLICY.uatWorkflow.path
  ) {
    throw evidenceError("the UAT run is not the canonical attestation workflow.");
  }
  if (run?.event !== "workflow_dispatch" || run?.head_branch !== "main") {
    throw evidenceError("the UAT attestation is not a main-branch manual dispatch.");
  }
  if (String(run?.head_sha || "").toLowerCase() !== releaseSha) {
    throw evidenceError("the UAT attestation is not bound to the exact release SHA.");
  }
  if (run?.status !== "completed" || run?.conclusion !== "success") {
    throw evidenceError("the UAT attestation did not complete successfully.");
  }
  if (Number(run?.run_attempt) !== 1) {
    throw evidenceError("rerun UAT attestations are not accepted; create a fresh attestation.");
  }

  const actorId = Number(run?.actor?.id);
  if (
    run?.actor?.type !== "User"
    || !Number.isSafeInteger(actorId)
    || !attesterIds.has(actorId)
    || Number(run?.triggering_actor?.id) !== actorId
  ) {
    throw evidenceError("the UAT attestation actor is not an allowed human attester.");
  }

  const title = parseReleaseUatRunTitle(run?.display_title);
  if (title.releaseSha !== releaseSha || title.rollbackSha !== rollbackSha) {
    throw evidenceError("the UAT title is bound to a different release or rollback SHA.");
  }
  if (title.target !== target) {
    throw evidenceError("the UAT attestation does not cover this deployment target.");
  }
  if (title.checklistDigest !== checklistDigest) {
    throw evidenceError("the UAT attestation used a different checklist digest.");
  }

  const ciCompletedMs = Date.parse(ciCompletedAt);
  const uatStartedMs = Date.parse(run?.run_started_at || run?.created_at);
  const uatCompletedMs = Date.parse(run?.updated_at);
  const nowMs = now instanceof Date ? now.getTime() : Number(now);
  if (![ciCompletedMs, uatStartedMs, uatCompletedMs, nowMs].every(Number.isFinite)) {
    throw evidenceError("the CI or UAT timestamps are invalid.");
  }
  if (uatStartedMs < ciCompletedMs) {
    throw evidenceError("the UAT attestation started before exact-SHA CI completed.");
  }
  if (uatCompletedMs > nowMs + 5 * 60 * 1000) {
    throw evidenceError("the UAT attestation timestamp is in the future.");
  }
  const maximumAgeMs = maximumAttestationAgeHours * 60 * 60 * 1000;
  if (nowMs - uatCompletedMs > maximumAgeMs) {
    throw evidenceError("the UAT attestation is stale.");
  }

  return { actorId, stagingId: title.stagingId, attestedTarget: title.target };
}

export function validateUatJobs(jobs) {
  if (!Array.isArray(jobs) || jobs.length === 0) {
    throw evidenceError("the UAT run returned no jobs.");
  }
  for (const job of jobs) {
    if (job?.status !== "completed" || job?.conclusion !== "success") {
      throw evidenceError(`UAT job ${String(job?.name || "<blank>")} did not succeed.`);
    }
  }
  const attestations = jobs.filter(
    (job) => job?.name === RELEASE_EVIDENCE_POLICY.uatWorkflow.jobName
  );
  if (attestations.length !== 1) {
    throw evidenceError("the UAT run must contain exactly one attestation job.");
  }
}

export function validatePreparationRun(
  run,
  { releaseSha, rollbackSha, target, preparationRunId, ciRunId, uatRunId }
) {
  validateCanonicalRepository(run, "the preparation run");
  if (Number(run?.id) !== preparationRunId) {
    throw evidenceError("the preparation response id does not match the current run.");
  }
  const expectedWorkflow = RELEASE_EVIDENCE_POLICY.preparationWorkflows[target];
  if (
    !expectedWorkflow
    || String(run?.name || "") !== expectedWorkflow.name
    || normalizeWorkflowPath(run?.path) !== expectedWorkflow.path
  ) {
    throw evidenceError("the current run is not the canonical target preparation workflow.");
  }
  if (run?.event !== "workflow_dispatch" || run?.head_branch !== "main") {
    throw evidenceError("the current preparation is not a main-branch manual dispatch.");
  }
  if (String(run?.head_sha || "").toLowerCase() !== releaseSha) {
    throw evidenceError("the current preparation is not bound to the exact release SHA.");
  }
  const expectedTitle = [
    "prepare",
    "v1",
    target,
    releaseSha,
    String(ciRunId),
    String(uatRunId),
    rollbackSha
  ].join("/");
  if (String(run?.display_title || "") !== expectedTitle) {
    throw evidenceError("the current preparation title is not bound to the supplied evidence.");
  }
  if (run?.status !== "in_progress" || run?.conclusion !== null) {
    throw evidenceError("the current preparation run is not actively in progress.");
  }
  if (Number(run?.run_attempt) !== 1) {
    throw evidenceError("preparation workflow reruns are not accepted; dispatch a fresh run.");
  }
  const actorId = Number(run?.actor?.id);
  if (
    run?.actor?.type !== "User"
    || !Number.isSafeInteger(actorId)
    || actorId <= 0
    || Number(run?.triggering_actor?.id) !== actorId
  ) {
    throw evidenceError("the preparation workflow was not dispatched by one human operator.");
  }
  return { operatorId: actorId };
}

function defaultGit(args, root = ROOT) {
  return spawnSync("git", args, {
    cwd: root,
    encoding: "utf8",
    stdio: ["ignore", "pipe", "pipe"],
    shell: false
  });
}

function requireGitSuccess(result, message) {
  if (result?.error || result?.status !== 0) {
    throw evidenceError(message);
  }
  return String(result.stdout || "").trim();
}

export function validateGitEvidence(
  { releaseSha, rollbackSha, headSha },
  { git = defaultGit, root = ROOT } = {}
) {
  if (releaseSha !== requireFullSha(headSha, "current HEAD")) {
    throw evidenceError("--release-sha does not match the checked-out HEAD.");
  }
  if (rollbackSha === releaseSha) {
    throw evidenceError("the rollback SHA must differ from the release SHA.");
  }
  requireGitSuccess(
    git(["diff", "--quiet", "HEAD", "--"], root),
    "tracked checkout files changed after the release SHA was checked out."
  );
  const originUrl = requireGitSuccess(
    git(["remote", "get-url", "origin"], root),
    "the origin remote cannot be resolved."
  );
  if (
    !/^https:\/\/github\.com\/TOTALLYMAJOR\/quoteflow(?:\.git)?$/.test(originUrl)
    && !/^git@github\.com:TOTALLYMAJOR\/quoteflow(?:\.git)?$/.test(originUrl)
  ) {
    throw evidenceError("origin is not the canonical TOTALLYMAJOR/quoteflow repository.");
  }
  const releaseTags = requireGitSuccess(
    git(["tag", "--points-at", releaseSha, "--list", "v[0-9]*.[0-9]*.[0-9]*"], root),
    "semantic release tags cannot be resolved from the checkout."
  )
    .split(/\r?\n/)
    .map((tag) => tag.trim())
    .filter((tag) => /^v(?:0|[1-9]\d*)\.(?:0|[1-9]\d*)\.(?:0|[1-9]\d*)$/.test(tag))
    .sort((left, right) => left.localeCompare(right));
  if (releaseTags.length === 0) {
    throw evidenceError("the release SHA has no exact semantic vX.Y.Z tag in the checkout.");
  }
  requireGitSuccess(
    git(["cat-file", "-e", `${rollbackSha}^{commit}`], root),
    "the rollback SHA is not an available commit."
  );
  requireGitSuccess(
    git(["merge-base", "--is-ancestor", rollbackSha, releaseSha], root),
    "the rollback SHA is not an ancestor of the release SHA."
  );
  return Object.freeze({ releaseTags: Object.freeze(releaseTags) });
}

async function fetchGitHubJson(
  url,
  { token, fetchImpl },
  { method = "GET", body = undefined, allowNotFound = false } = {}
) {
  let response;
  try {
    const headers = {
      Accept: "application/vnd.github+json",
      Authorization: `Bearer ${token}`,
      "X-GitHub-Api-Version": GITHUB_API_VERSION,
      "User-Agent": "quotepilot-release-evidence"
    };
    if (body !== undefined) headers["Content-Type"] = "application/json";
    response = await fetchImpl(url, {
      redirect: "error",
      signal: AbortSignal.timeout(GITHUB_REQUEST_TIMEOUT_MS),
      method,
      headers,
      ...(body === undefined ? {} : { body: JSON.stringify(body) })
    });
  } catch {
    throw evidenceError("GitHub evidence could not be reached.");
  }
  if (!response?.ok && allowNotFound && response?.status === 404) return null;
  if (!response?.ok) {
    throw evidenceError(`GitHub evidence request failed with HTTP ${response?.status || "unknown"}.`);
  }
  try {
    return await response.json();
  } catch {
    throw evidenceError("GitHub evidence returned invalid JSON.");
  }
}

async function validatePublishedReleaseRevision(
  { releaseSha, releaseTags },
  requestOptions
) {
  const mainReference = await fetchGitHubJson(
    `${GITHUB_API}/repos/TOTALLYMAJOR/quoteflow/git/ref/heads/main`,
    requestOptions
  );
  if (
    mainReference?.ref !== "refs/heads/main"
    || mainReference?.object?.type !== "commit"
    || String(mainReference?.object?.sha || "").toLowerCase() !== releaseSha
  ) {
    throw evidenceError("the release SHA is not the current remotely published origin/main.");
  }

  for (const tag of releaseTags) {
    const tagReference = await fetchGitHubJson(
      `${GITHUB_API}/repos/TOTALLYMAJOR/quoteflow/git/ref/tags/${encodeURIComponent(tag)}`,
      requestOptions,
      { allowNotFound: true }
    );
    if (tagReference?.ref !== `refs/tags/${tag}`) continue;
    let object = tagReference.object;
    const seenTagObjects = new Set();
    for (let depth = 0; object?.type === "tag" && depth < 5; depth += 1) {
      const tagObjectSha = requireOpaqueNodeId(object?.sha, "an annotated tag object SHA");
      if (!/^[0-9a-f]{40}$/i.test(tagObjectSha) || seenTagObjects.has(tagObjectSha.toLowerCase())) {
        throw evidenceError(`the annotated semantic release tag ${tag} has an invalid tag chain.`);
      }
      seenTagObjects.add(tagObjectSha.toLowerCase());
      const tagObject = await fetchGitHubJson(
        `${GITHUB_API}/repos/TOTALLYMAJOR/quoteflow/git/tags/${tagObjectSha}`,
        requestOptions
      );
      if (depth === 0 && String(tagObject?.tag || "") !== tag) {
        throw evidenceError(`the annotated semantic release tag ${tag} has mismatched metadata.`);
      }
      object = tagObject?.object;
    }
    if (object?.type === "tag") {
      throw evidenceError(`the annotated semantic release tag ${tag} exceeds the tag-chain limit.`);
    }
    if (
      object?.type === "commit"
      && String(object?.sha || "").toLowerCase() === releaseSha
    ) {
      return Object.freeze({ releaseTag: tag });
    }
  }
  throw evidenceError("the release SHA has no exact semantic vX.Y.Z tag published to origin.");
}

async function fetchDeploymentReviews(run, label, options) {
  const runNodeId = requireOpaqueNodeId(run?.node_id, `the ${label} workflow node id`);
  const reviews = [];
  const seenCursors = new Set();
  let after = null;
  let expectedTotalCount = null;
  let workflowRun = null;

  while (true) {
    const result = await fetchGitHubJson(
      GITHUB_GRAPHQL_API,
      options,
      {
        method: "POST",
        body: {
          query: DEPLOYMENT_REVIEWS_QUERY,
          variables: { runId: runNodeId, after }
        }
      }
    );
    if (Object.hasOwn(result || {}, "errors")) {
      throw evidenceError(`GitHub GraphQL rejected the ${label} deployment review query.`);
    }
    const pageRun = result?.data?.node;
    const connection = pageRun?.deploymentReviews;
    const pageNodes = Array.isArray(connection?.nodes) ? connection.nodes : null;
    const totalCount = Number(connection?.totalCount);
    if (
      !pageRun
      || pageRun.__typename !== "WorkflowRun"
      || pageRun.id !== runNodeId
      || Number(pageRun.databaseId) !== Number(run?.id)
      || !pageNodes
      || !Number.isSafeInteger(totalCount)
      || totalCount < 0
      || (expectedTotalCount !== null && totalCount !== expectedTotalCount)
      || typeof connection?.pageInfo?.hasNextPage !== "boolean"
    ) {
      throw evidenceError(`GitHub returned invalid ${label} deployment review evidence.`);
    }
    expectedTotalCount = totalCount;
    workflowRun = pageRun;
    reviews.push(...pageNodes);

    if (connection?.pageInfo?.hasNextPage !== true) break;
    const endCursor = String(connection?.pageInfo?.endCursor || "").trim();
    if (!endCursor || seenCursors.has(endCursor) || pageNodes.length === 0) {
      throw evidenceError(`GitHub ${label} deployment review pagination ended early.`);
    }
    seenCursors.add(endCursor);
    after = endCursor;
  }

  if (reviews.length !== expectedTotalCount) {
    throw evidenceError(`GitHub ${label} deployment review pagination returned the wrong count.`);
  }
  return {
    ...workflowRun,
    deploymentReviews: {
      totalCount: expectedTotalCount,
      nodes: reviews,
      pageInfo: { hasNextPage: false, endCursor: null }
    }
  };
}

async function fetchRunJobs(runId, options) {
  const jobs = [];
  let page = 1;
  let totalCount = Number.POSITIVE_INFINITY;
  while (jobs.length < totalCount) {
    const result = await fetchGitHubJson(
      `${GITHUB_API}/repos/TOTALLYMAJOR/quoteflow/actions/runs/${runId}/jobs?filter=latest&per_page=100&page=${page}`,
      options
    );
    const pageJobs = Array.isArray(result?.jobs) ? result.jobs : [];
    totalCount = Number(result?.total_count);
    if (!Number.isSafeInteger(totalCount) || totalCount < 0) {
      throw evidenceError("GitHub returned an invalid workflow job count.");
    }
    jobs.push(...pageJobs);
    if (pageJobs.length === 0 && jobs.length < totalCount) {
      throw evidenceError("GitHub workflow job pagination ended early.");
    }
    page += 1;
  }
  return jobs;
}

export async function verifyProductionReleaseEvidence(
  {
    releaseSha: releaseShaValue,
    ciRunId: ciRunIdValue,
    uatRunId: uatRunIdValue,
    rollbackSha: rollbackShaValue,
    target,
    headSha,
    preparationRunId: preparationRunIdValue,
    token,
    attesterIds: attesterIdsValue,
    root = ROOT
  },
  { fetchImpl = globalThis.fetch, git = defaultGit, now = new Date() } = {}
) {
  const releaseSha = requireFullSha(releaseShaValue, "--release-sha");
  const rollbackSha = requireFullSha(rollbackShaValue, "--rollback-sha");
  const ciRunId = requireRunId(ciRunIdValue, "--ci-run-id");
  const uatRunId = requireRunId(uatRunIdValue, "--uat-run-id");
  const preparationRunId = requireRunId(preparationRunIdValue, "GITHUB_RUN_ID");
  if (!Object.hasOwn(RELEASE_EVIDENCE_POLICY.preparationWorkflows, target)) {
    throw evidenceError(
      "the deployment target must be firebase-hosting, firebase-backend, firebase-all, or vercel."
    );
  }
  const normalizedToken = String(token || "").trim();
  if (!normalizedToken) {
    throw evidenceError("GITHUB_TOKEN or GH_TOKEN is required for live evidence verification.");
  }
  if (typeof fetchImpl !== "function") {
    throw evidenceError("the runtime does not provide a GitHub HTTP client.");
  }
  const attesterIds = attesterIdsValue instanceof Set
    ? attesterIdsValue
    : parseAttesterIds(attesterIdsValue);
  const checklist = readChecklist(root);

  const gitEvidence = validateGitEvidence(
    { releaseSha, rollbackSha, headSha },
    { git, root }
  );

  const requestOptions = { token: normalizedToken, fetchImpl };
  const [publishedRevision, preparationRun, ciRun, ciJobs, uatRun, uatJobs, uatEnvironment,
    deployEnvironment] =
    await Promise.all([
      validatePublishedReleaseRevision({ releaseSha, ...gitEvidence }, requestOptions),
      fetchGitHubJson(
        `${GITHUB_API}/repos/TOTALLYMAJOR/quoteflow/actions/runs/${preparationRunId}`,
        requestOptions
      ),
      fetchGitHubJson(
        `${GITHUB_API}/repos/TOTALLYMAJOR/quoteflow/actions/runs/${ciRunId}`,
        requestOptions
      ),
      fetchRunJobs(ciRunId, requestOptions),
      fetchGitHubJson(
        `${GITHUB_API}/repos/TOTALLYMAJOR/quoteflow/actions/runs/${uatRunId}`,
        requestOptions
      ),
      fetchRunJobs(uatRunId, requestOptions),
      fetchGitHubJson(
        `${GITHUB_API}/repos/TOTALLYMAJOR/quoteflow/environments/${RELEASE_EVIDENCE_POLICY.environments.uat}`,
        requestOptions
      ),
      fetchGitHubJson(
        `${GITHUB_API}/repos/TOTALLYMAJOR/quoteflow/environments/${RELEASE_EVIDENCE_POLICY.environments.deploy}`,
        requestOptions
      )
    ]);

  const preparation = validatePreparationRun(preparationRun, {
    releaseSha,
    rollbackSha,
    target,
    preparationRunId,
    ciRunId,
    uatRunId
  });
  validateCiRun(ciRun, { releaseSha, ciRunId });
  validateCiJobs(ciJobs);
  const uat = validateUatRun(uatRun, {
    releaseSha,
    rollbackSha,
    target,
    uatRunId,
    checklistDigest: checklist.digest,
    attesterIds,
    ciCompletedAt: ciRun.updated_at,
    now,
    maximumAttestationAgeHours: checklist.maximumAttestationAgeHours
  });
  validateUatJobs(uatJobs);
  const uatEnvironmentPolicy = validateProtectedEnvironment(uatEnvironment, {
    name: RELEASE_EVIDENCE_POLICY.environments.uat,
    attesterId: uat.actorId
  });
  const deployEnvironmentPolicy = validateProtectedEnvironment(deployEnvironment, {
    name: RELEASE_EVIDENCE_POLICY.environments.deploy
  });
  const [uatReviewLog, preparationReviewLog] = await Promise.all([
    fetchDeploymentReviews(uatRun, "UAT", requestOptions),
    fetchDeploymentReviews(preparationRun, "preparation", requestOptions)
  ]);
  const uatReview = validateUatDeploymentReviews(uatReviewLog, {
    uatRunId,
    uatNodeId: uatRun.node_id,
    environmentName: RELEASE_EVIDENCE_POLICY.environments.uat,
    environmentId: uatEnvironmentPolicy.environmentId,
    attesterId: uat.actorId,
    requiredReviewerIds: uatEnvironmentPolicy.reviewerIds
  });
  const preparationReview = validatePreparationDeploymentReviews(preparationReviewLog, {
    preparationRunId,
    preparationNodeId: preparationRun.node_id,
    environmentName: RELEASE_EVIDENCE_POLICY.environments.deploy,
    environmentId: deployEnvironmentPolicy.environmentId,
    operatorId: preparation.operatorId,
    attesterId: uat.actorId,
    requiredReviewerIds: deployEnvironmentPolicy.reviewerIds
  });

  return Object.freeze({
    schema: "com.mbmapps.quotepilot.production-release-evidence/v4",
    releaseSha,
    releaseTag: publishedRevision.releaseTag,
    rollbackSha,
    target,
    ciRunId,
    uatRunId,
    preparationRunId,
    stagingId: uat.stagingId,
    attesterId: uat.actorId,
    uatReviewerId: uatReview.reviewerId,
    uatReviewId: uatReview.reviewId,
    operatorId: preparation.operatorId,
    productionReviewerId: preparationReview.reviewerId,
    productionReviewId: preparationReview.reviewId,
    checklistDigest: checklist.digest,
    verifiedAt: (now instanceof Date ? now : new Date(Number(now))).toISOString()
  });
}

export function parseReleaseEvidenceCliArgs(argv) {
  const required = new Set([
    "--release-sha",
    "--ci-run-id",
    "--uat-run-id",
    "--rollback-sha",
    "--target"
  ]);
  const allowed = new Set([...required, "--output"]);
  const values = new Map();
  for (let index = 0; index < argv.length; index += 2) {
    const name = argv[index];
    const value = argv[index + 1];
    if (!allowed.has(name)) throw evidenceError(`unknown argument ${name || "<blank>"}.`);
    if (values.has(name)) throw evidenceError(`duplicate argument ${name}.`);
    if (!value || String(value).startsWith("--")) {
      throw evidenceError(`${name} requires a value.`);
    }
    values.set(name, String(value).trim());
  }
  for (const name of required) {
    if (!values.has(name)) throw evidenceError(`${name} is required.`);
  }
  return Object.fromEntries([...values].map(([name, value]) => [name.slice(2), value]));
}

function ensureReceiptDirectory(root, directory) {
  const resolvedRoot = path.resolve(root);
  let rootStat;
  try {
    rootStat = fs.lstatSync(resolvedRoot);
  } catch {
    throw evidenceError("the repository root is unavailable for receipt output.");
  }
  if (!rootStat.isDirectory() || rootStat.isSymbolicLink()) {
    throw evidenceError("the repository root must be a real directory for receipt output.");
  }
  const relative = path.relative(resolvedRoot, directory);
  if (!relative || relative.startsWith("..") || path.isAbsolute(relative)) {
    throw evidenceError("the receipt directory must remain inside the repository root.");
  }
  let cursor = resolvedRoot;
  for (const segment of relative.split(path.sep)) {
    cursor = path.join(cursor, segment);
    if (!fs.existsSync(cursor)) fs.mkdirSync(cursor, { mode: 0o700 });
    const stat = fs.lstatSync(cursor);
    if (!stat.isDirectory() || stat.isSymbolicLink() || fs.realpathSync(cursor) !== cursor) {
      throw evidenceError("receipt output ancestors must be real repository directories.");
    }
  }
}

export function writeProductionReleaseEvidenceReceipt(receipt, outputValue, root = ROOT) {
  const resolvedRoot = path.resolve(root);
  const releaseDir = path.join(resolvedRoot, "artifacts", "release");
  const output = path.resolve(resolvedRoot, String(outputValue || ""));
  if (output === releaseDir || !output.startsWith(`${releaseDir}${path.sep}`)) {
    throw evidenceError("--output must be a JSON file inside artifacts/release.");
  }
  if (path.extname(output).toLowerCase() !== ".json") {
    throw evidenceError("--output must use a .json extension.");
  }
  ensureReceiptDirectory(resolvedRoot, path.dirname(output));
  const temporary = `${output}.${process.pid}.tmp`;
  try {
    fs.writeFileSync(temporary, `${JSON.stringify(receipt, null, 2)}\n`, {
      encoding: "utf8",
      mode: 0o600,
      flag: "wx"
    });
    fs.linkSync(temporary, output);
  } finally {
    if (fs.existsSync(temporary)) fs.unlinkSync(temporary);
  }
}

async function main() {
  const args = parseReleaseEvidenceCliArgs(process.argv.slice(2));
  const head = requireGitSuccess(
    defaultGit(["rev-parse", "HEAD"], ROOT),
    "the checked-out HEAD cannot be resolved."
  );
  const result = await verifyProductionReleaseEvidence({
    releaseSha: args["release-sha"],
    ciRunId: args["ci-run-id"],
    uatRunId: args["uat-run-id"],
    rollbackSha: args["rollback-sha"],
    target: args.target,
    headSha: head,
    preparationRunId: process.env.GITHUB_RUN_ID,
    token: process.env.GITHUB_TOKEN || process.env.GH_TOKEN,
    attesterIds: process.env.RELEASE_UAT_ATTESTER_IDS,
    root: ROOT
  });
  if (args.output) writeProductionReleaseEvidenceReceipt(result, args.output, ROOT);
  process.stdout.write(
    `Release evidence verified for ${result.target} at ${result.releaseSha} (CI ${result.ciRunId}, UAT ${result.uatRunId}).\n`
  );
}

const isDirectExecution = process.argv[1]
  && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url);
if (isDirectExecution) {
  await main();
}
