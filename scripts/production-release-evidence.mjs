#!/usr/bin/env node

import crypto from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import { spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const GITHUB_API = "https://api.github.com";
const GITHUB_API_VERSION = "2026-03-10";
const GITHUB_REQUEST_TIMEOUT_MS = 15_000;

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
  deployWorkflows: Object.freeze({
    "firebase-hosting": Object.freeze({
      name: "Deploy Firebase Hosting / Backend",
      path: ".github/workflows/deploy-firebase-hosting.yml"
    }),
    "firebase-backend": Object.freeze({
      name: "Deploy Firebase Hosting / Backend",
      path: ".github/workflows/deploy-firebase-hosting.yml"
    }),
    "firebase-all": Object.freeze({
      name: "Deploy Firebase Hosting / Backend",
      path: ".github/workflows/deploy-firebase-hosting.yml"
    }),
    vercel: Object.freeze({
      name: "Deploy Vercel Production",
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

  if (checklist?.schema !== "com.mbmapps.quotepilot.release-uat-checklist/v1") {
    throw evidenceError("the release UAT checklist schema is not supported.");
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
  const maximumAttestationAgeHours = Number(checklist.maximumAttestationAgeHours);
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
    itemIds,
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
  if (!Object.hasOwn(RELEASE_EVIDENCE_POLICY.deployWorkflows, target)) {
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
  const reviewerIds = reviewers
    .map((entry) => Number(entry?.reviewer?.id))
    .filter((id) => Number.isSafeInteger(id) && id > 0);
  if (reviewerIds.length === 0) {
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

export function validateDeploymentRun(
  run,
  { releaseSha, rollbackSha, target, deploymentRunId, ciRunId, uatRunId }
) {
  validateCanonicalRepository(run, "the deployment run");
  if (Number(run?.id) !== deploymentRunId) {
    throw evidenceError("the deployment response id does not match the current run.");
  }
  const expectedWorkflow = RELEASE_EVIDENCE_POLICY.deployWorkflows[target];
  if (
    !expectedWorkflow
    || String(run?.name || "") !== expectedWorkflow.name
    || normalizeWorkflowPath(run?.path) !== expectedWorkflow.path
  ) {
    throw evidenceError("the current run is not the canonical target deployment workflow.");
  }
  if (run?.event !== "workflow_dispatch" || run?.head_branch !== "main") {
    throw evidenceError("the current deployment is not a main-branch manual dispatch.");
  }
  if (String(run?.head_sha || "").toLowerCase() !== releaseSha) {
    throw evidenceError("the current deployment is not bound to the exact release SHA.");
  }
  const expectedTitle = [
    "deploy",
    "v1",
    target,
    releaseSha,
    String(ciRunId),
    String(uatRunId),
    rollbackSha
  ].join("/");
  if (String(run?.display_title || "") !== expectedTitle) {
    throw evidenceError("the current deployment title is not bound to the supplied evidence.");
  }
  if (run?.status !== "in_progress" || run?.conclusion !== null) {
    throw evidenceError("the current deployment run is not actively in progress.");
  }
  if (Number(run?.run_attempt) !== 1) {
    throw evidenceError("deployment workflow reruns are not accepted; dispatch a fresh run.");
  }
  const actorId = Number(run?.actor?.id);
  if (
    run?.actor?.type !== "User"
    || !Number.isSafeInteger(actorId)
    || actorId <= 0
    || Number(run?.triggering_actor?.id) !== actorId
  ) {
    throw evidenceError("the deployment workflow was not dispatched by one human operator.");
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
  requireGitSuccess(
    git(["cat-file", "-e", `${rollbackSha}^{commit}`], root),
    "the rollback SHA is not an available commit."
  );
  requireGitSuccess(
    git(["merge-base", "--is-ancestor", rollbackSha, releaseSha], root),
    "the rollback SHA is not an ancestor of the release SHA."
  );
}

async function fetchGitHubJson(url, { token, fetchImpl }) {
  let response;
  try {
    response = await fetchImpl(url, {
      redirect: "error",
      signal: AbortSignal.timeout(GITHUB_REQUEST_TIMEOUT_MS),
      headers: {
        Accept: "application/vnd.github+json",
        Authorization: `Bearer ${token}`,
        "X-GitHub-Api-Version": GITHUB_API_VERSION,
        "User-Agent": "quotepilot-release-evidence"
      }
    });
  } catch {
    throw evidenceError("GitHub evidence could not be reached.");
  }
  if (!response?.ok) {
    throw evidenceError(`GitHub evidence request failed with HTTP ${response?.status || "unknown"}.`);
  }
  try {
    return await response.json();
  } catch {
    throw evidenceError("GitHub evidence returned invalid JSON.");
  }
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
    deploymentRunId: deploymentRunIdValue,
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
  const deploymentRunId = requireRunId(deploymentRunIdValue, "GITHUB_RUN_ID");
  if (!Object.hasOwn(RELEASE_EVIDENCE_POLICY.deployWorkflows, target)) {
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

  validateGitEvidence({ releaseSha, rollbackSha, headSha }, { git, root });

  const requestOptions = { token: normalizedToken, fetchImpl };
  const [deploymentRun, ciRun, ciJobs, uatRun, uatJobs, uatEnvironment, deployEnvironment] =
    await Promise.all([
      fetchGitHubJson(
        `${GITHUB_API}/repos/TOTALLYMAJOR/quoteflow/actions/runs/${deploymentRunId}`,
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

  const deployment = validateDeploymentRun(deploymentRun, {
    releaseSha,
    rollbackSha,
    target,
    deploymentRunId,
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
  validateProtectedEnvironment(uatEnvironment, {
    name: RELEASE_EVIDENCE_POLICY.environments.uat,
    attesterId: uat.actorId
  });
  validateProtectedEnvironment(deployEnvironment, {
    name: RELEASE_EVIDENCE_POLICY.environments.deploy
  });

  return Object.freeze({
    schema: "com.mbmapps.quotepilot.production-release-evidence/v1",
    releaseSha,
    rollbackSha,
    target,
    ciRunId,
    uatRunId,
    deploymentRunId,
    stagingId: uat.stagingId,
    attesterId: uat.actorId,
    operatorId: deployment.operatorId,
    checklistDigest: checklist.digest,
    verifiedAt: (now instanceof Date ? now : new Date(Number(now))).toISOString()
  });
}

export function parseReleaseEvidenceCliArgs(argv) {
  const allowed = new Set([
    "--release-sha",
    "--ci-run-id",
    "--uat-run-id",
    "--rollback-sha",
    "--target"
  ]);
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
  for (const name of allowed) {
    if (!values.has(name)) throw evidenceError(`${name} is required.`);
  }
  return Object.fromEntries([...values].map(([name, value]) => [name.slice(2), value]));
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
    deploymentRunId: process.env.GITHUB_RUN_ID,
    token: process.env.GITHUB_TOKEN || process.env.GH_TOKEN,
    attesterIds: process.env.RELEASE_UAT_ATTESTER_IDS,
    root: ROOT
  });
  process.stdout.write(
    `Release evidence verified for ${result.target} at ${result.releaseSha} (CI ${result.ciRunId}, UAT ${result.uatRunId}).\n`
  );
}

const isDirectExecution = process.argv[1]
  && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url);
if (isDirectExecution) {
  await main();
}
