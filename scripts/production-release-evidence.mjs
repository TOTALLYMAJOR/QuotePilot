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
    id: 328972920,
    name: "Release UAT Attestation",
    path: ".github/workflows/release-uat-attestation.yml",
    jobName: "release-uat-attestation"
  }),
  preparationWorkflows: Object.freeze({
    "firebase-hosting": Object.freeze({
      id: 244706943,
      name: "Prepare Firebase Production Artifact",
      path: ".github/workflows/deploy-firebase-hosting.yml"
    }),
    "firebase-backend": Object.freeze({
      id: 244706943,
      name: "Prepare Firebase Production Artifact",
      path: ".github/workflows/deploy-firebase-hosting.yml"
    }),
    "firebase-all": Object.freeze({
      id: 244706943,
      name: "Prepare Firebase Production Artifact",
      path: ".github/workflows/deploy-firebase-hosting.yml"
    }),
    vercel: Object.freeze({
      id: 328972919,
      name: "Prepare Vercel Production Artifact",
      path: ".github/workflows/deploy-vercel-production.yml"
    })
  }),
  environments: Object.freeze({
    uat: "production-uat",
    deploy: "production",
    soloUat: "production-uat-solo",
    soloDeploy: "production-solo"
  }),
  soloOperator: Object.freeze({
    minimumCooldownMinutes: 15
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

export const RELEASE_APPROVAL_MODES = Object.freeze([
  "independent-review",
  "solo-operator"
]);

const RELEASE_UAT_CHECKLIST_SCHEMA =
  "com.mbmapps.quotepilot.release-uat-checklist/v3";
const RELEASE_UAT_TARGETS = Object.freeze([
  "firebase-hosting",
  "firebase-backend",
  "firebase-all",
  "vercel"
]);
const RELEASE_UAT_CHECKLIST_KEYS = Object.freeze([
  "candidateProfiles",
  "items",
  "maximumAttestationAgeHours",
  "schema",
  "version"
]);
const RELEASE_UAT_ITEM_KEYS = Object.freeze(["id", "label", "targets"]);
const RELEASE_UAT_CONDITIONAL_ITEM_KEYS = Object.freeze([
  "id",
  "label",
  "smsProviders",
  "targets"
]);
const RELEASE_UAT_PROFILE_KEYS = Object.freeze(["id", "itemStates", "label"]);
const RELEASE_UAT_PROFILE_STATE_KEYS = Object.freeze({
  applicable: Object.freeze(["state"]),
  blocked: Object.freeze(["reason", "state"])
});
const RELEASE_UAT_PROFILE_PLAN_SCHEMA =
  "com.mbmapps.quotepilot.release-uat-profile-plan/v1";
export const RELEASE_SMS_PROVIDERS = Object.freeze(["none", "twilio", "pingram"]);
export const PRODUCTION_RELEASE_PROFILES = Object.freeze(["safe-off"]);

function evidenceError(message) {
  return new Error(`Release evidence rejected: ${message}`);
}

export function parseReleaseSmsProvider(value) {
  const provider = String(value || "").trim().toLowerCase();
  if (!RELEASE_SMS_PROVIDERS.includes(provider)) {
    throw evidenceError("the SMS provider must be none, twilio, or pingram.");
  }
  return provider;
}

export function parseProductionReleaseProfile(value) {
  const profile = String(value || "").trim().toLowerCase();
  if (!PRODUCTION_RELEASE_PROFILES.includes(profile)) {
    throw evidenceError("the production release profile must be safe-off.");
  }
  return profile;
}

export function parseReleaseSmsConfigurationGeneration(value, smsProviderValue) {
  const provider = parseReleaseSmsProvider(smsProviderValue);
  const generation = String(value || "").trim().toLowerCase();
  if (provider !== "pingram") {
    if (generation !== "not-applicable") {
      throw evidenceError(
        "the SMS configuration generation must be not-applicable unless Pingram is selected."
      );
    }
    return generation;
  }
  if (
    generation === "not-applicable"
    || !/^[a-z0-9][a-z0-9._-]{2,63}$/.test(generation)
  ) {
    throw evidenceError(
      "the Pingram SMS configuration generation must be a 3-64 character lowercase deployment generation."
    );
  }
  return generation;
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

  if (checklist?.schema !== RELEASE_UAT_CHECKLIST_SCHEMA) {
    throw evidenceError("the release UAT checklist schema is not supported.");
  }
  if (
    !checklist
    || typeof checklist !== "object"
    || Array.isArray(checklist)
    || JSON.stringify(Object.keys(checklist).sort())
      !== JSON.stringify(RELEASE_UAT_CHECKLIST_KEYS)
  ) {
    throw evidenceError("the release UAT checklist fields do not match the v3 contract.");
  }
  if (
    typeof checklist.version !== "string"
    || checklist.version !== checklist.version.trim()
    || !/^[A-Za-z0-9][A-Za-z0-9._-]{0,79}$/.test(checklist.version)
  ) {
    throw evidenceError("the release UAT checklist version is invalid.");
  }
  if (!Array.isArray(checklist.items) || checklist.items.length === 0) {
    throw evidenceError("the release UAT checklist has no required items.");
  }
  const itemIdsByTarget = Object.fromEntries(
    RELEASE_UAT_TARGETS.map((target) => [target, []])
  );
  const itemIdsByTargetAndSmsProvider = Object.fromEntries(
    RELEASE_UAT_TARGETS.map((target) => [
      target,
      Object.fromEntries(RELEASE_SMS_PROVIDERS.map((provider) => [provider, []]))
    ])
  );
  const itemIds = [];
  for (const item of checklist.items) {
    if (
      !item
      || typeof item !== "object"
      || Array.isArray(item)
      || ![
        JSON.stringify(RELEASE_UAT_ITEM_KEYS),
        JSON.stringify(RELEASE_UAT_CONDITIONAL_ITEM_KEYS)
      ].includes(JSON.stringify(Object.keys(item).sort()))
    ) {
      throw evidenceError("a release UAT checklist item does not match the v3 contract.");
    }
    const itemId = typeof item.id === "string" ? item.id : "";
    const label = typeof item.label === "string" ? item.label : "";
    if (
      itemId !== itemId.trim()
      || !/^[a-z0-9]+(?:[.-][a-z0-9]+)*$/.test(itemId)
    ) {
      throw evidenceError("the release UAT checklist contains invalid or duplicate item ids.");
    }
    if (!label || label !== label.trim() || label.length > 10_000) {
      throw evidenceError(`release UAT checklist item ${itemId} has an invalid label.`);
    }
    if (
      !Array.isArray(item.targets)
      || item.targets.length === 0
      || item.targets.some((target) => (
        typeof target !== "string" || !RELEASE_UAT_TARGETS.includes(target)
      ))
      || new Set(item.targets).size !== item.targets.length
    ) {
      throw evidenceError(`release UAT checklist item ${itemId} has invalid target applicability.`);
    }
    const smsProviders = Object.hasOwn(item, "smsProviders")
      ? item.smsProviders
      : RELEASE_SMS_PROVIDERS;
    if (
      !Array.isArray(smsProviders)
      || smsProviders.length === 0
      || smsProviders.some((provider) => (
        typeof provider !== "string" || !RELEASE_SMS_PROVIDERS.includes(provider)
      ))
      || new Set(smsProviders).size !== smsProviders.length
    ) {
      throw evidenceError(`release UAT checklist item ${itemId} has invalid SMS-provider applicability.`);
    }
    const appliesToFirebaseHosting = item.targets.includes("firebase-hosting");
    const appliesToFirebaseBackend = item.targets.includes("firebase-backend");
    const appliesToFirebaseAll = item.targets.includes("firebase-all");
    if (
      appliesToFirebaseAll !== (appliesToFirebaseHosting || appliesToFirebaseBackend)
    ) {
      throw evidenceError(
        `release UAT checklist item ${itemId} must keep firebase-all equal to its Firebase narrow-target applicability.`
      );
    }
    itemIds.push(itemId);
    for (const target of item.targets) {
      itemIdsByTarget[target].push(itemId);
      for (const provider of smsProviders) {
        itemIdsByTargetAndSmsProvider[target][provider].push(itemId);
      }
    }
  }
  if (
    new Set(itemIds).size !== itemIds.length
  ) {
    throw evidenceError("the release UAT checklist contains invalid or duplicate item ids.");
  }
  if (RELEASE_UAT_TARGETS.some((target) => itemIdsByTarget[target].length === 0)) {
    throw evidenceError("the release UAT checklist leaves a deployment target without required items.");
  }
  if (!Array.isArray(checklist.candidateProfiles) || checklist.candidateProfiles.length === 0) {
    throw evidenceError("the release UAT checklist has no candidate profiles.");
  }
  const candidateProfiles = new Map();
  for (const profile of checklist.candidateProfiles) {
    if (
      !profile
      || typeof profile !== "object"
      || Array.isArray(profile)
      || JSON.stringify(Object.keys(profile).sort()) !== JSON.stringify(RELEASE_UAT_PROFILE_KEYS)
    ) {
      throw evidenceError("a release UAT candidate profile does not match the v3 contract.");
    }
    const profileId = typeof profile.id === "string" ? profile.id : "";
    const label = typeof profile.label === "string" ? profile.label : "";
    if (
      profileId !== profileId.trim()
      || !/^[a-z0-9]+(?:[.-][a-z0-9]+)*$/.test(profileId)
      || candidateProfiles.has(profileId)
    ) {
      throw evidenceError("the release UAT checklist contains an invalid or duplicate candidate profile id.");
    }
    if (!label || label !== label.trim() || label.length > 500) {
      throw evidenceError(`release UAT candidate profile ${profileId} has an invalid label.`);
    }
    if (
      !profile.itemStates
      || typeof profile.itemStates !== "object"
      || Array.isArray(profile.itemStates)
      || JSON.stringify(Object.keys(profile.itemStates).sort())
        !== JSON.stringify([...itemIds].sort())
    ) {
      throw evidenceError(
        `release UAT candidate profile ${profileId} must classify every checklist item exactly once.`
      );
    }
    const itemStates = {};
    for (const itemId of itemIds) {
      const itemState = profile.itemStates[itemId];
      const state = typeof itemState?.state === "string" ? itemState.state : "";
      const expectedKeys = RELEASE_UAT_PROFILE_STATE_KEYS[state];
      if (
        !itemState
        || typeof itemState !== "object"
        || Array.isArray(itemState)
        || !expectedKeys
      ) {
        throw evidenceError(
          `release UAT candidate profile ${profileId} has an invalid state for ${itemId}.`
        );
      }
      if (
        state === "blocked"
        && (
          typeof itemState.reason !== "string"
          || itemState.reason !== itemState.reason.trim()
          || !itemState.reason
          || itemState.reason.length > 1_000
        )
      ) {
        throw evidenceError(
          `release UAT candidate profile ${profileId} must explain why ${itemId} is blocked.`
        );
      }
      if (JSON.stringify(Object.keys(itemState).sort()) !== JSON.stringify(expectedKeys)) {
        throw evidenceError(
          `release UAT candidate profile ${profileId} has an invalid state for ${itemId}.`
        );
      }
      itemStates[itemId] = Object.freeze({ ...itemState });
    }
    candidateProfiles.set(profileId, Object.freeze({
      id: profileId,
      label,
      itemStates: Object.freeze(itemStates)
    }));
  }
  const maximumAttestationAgeHours = checklist.maximumAttestationAgeHours;
  if (
    typeof maximumAttestationAgeHours !== "number"
    || !Number.isSafeInteger(maximumAttestationAgeHours)
    || maximumAttestationAgeHours < 1
    || maximumAttestationAgeHours > 168
  ) {
    throw evidenceError("the release UAT checklist has an invalid attestation age limit.");
  }

  return {
    raw,
    checklist,
    itemIds,
    itemIdsByTarget: Object.freeze(Object.fromEntries(
      RELEASE_UAT_TARGETS.map((target) => [
        target,
        Object.freeze([...itemIdsByTarget[target]])
      ])
    )),
    itemIdsByTargetAndSmsProvider: Object.freeze(Object.fromEntries(
      RELEASE_UAT_TARGETS.map((target) => [
        target,
        Object.freeze(Object.fromEntries(RELEASE_SMS_PROVIDERS.map((provider) => [
          provider,
          Object.freeze([...itemIdsByTargetAndSmsProvider[target][provider]])
        ])))
      ])
    )),
    candidateProfiles,
    digest: crypto.createHash("sha256").update(raw).digest("hex"),
    maximumAttestationAgeHours
  };
}

export function getReleaseUatChecklist(root = ROOT) {
  return readChecklist(root);
}

export function getReleaseUatProfilePlan(targetValue, candidateProfileValue, root = ROOT) {
  const target = String(targetValue || "").trim();
  if (!RELEASE_UAT_TARGETS.includes(target)) {
    throw evidenceError(
      "the UAT profile-plan target must be firebase-hosting, firebase-backend, firebase-all, or vercel."
    );
  }
  const candidateProfileId = String(candidateProfileValue || "").trim();
  const checklist = readChecklist(root);
  const candidateProfile = checklist.candidateProfiles.get(candidateProfileId);
  if (!candidateProfile) {
    throw evidenceError(`the UAT candidate profile ${candidateProfileId || "<blank>"} is not tracked.`);
  }
  const requiredItemIds = checklist.itemIdsByTarget[target];
  const applicableItemIds = [];
  const blockedItems = [];
  for (const itemId of requiredItemIds) {
    const itemState = candidateProfile.itemStates[itemId];
    if (itemState.state === "applicable") {
      applicableItemIds.push(itemId);
    } else {
      blockedItems.push(Object.freeze({ id: itemId, reason: itemState.reason }));
    }
  }
  return Object.freeze({
    schema: RELEASE_UAT_PROFILE_PLAN_SCHEMA,
    checklist: Object.freeze({
      schema: checklist.checklist.schema,
      version: checklist.checklist.version,
      digest: checklist.digest
    }),
    target,
    candidateProfile: Object.freeze({
      id: candidateProfile.id,
      label: candidateProfile.label
    }),
    qualification: blockedItems.length ? "blocked" : "eligible_for_attestation",
    applicableItemIds: Object.freeze(applicableItemIds),
    blockedItems: Object.freeze(blockedItems)
  });
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

export function parseReleaseApprovalMode(value) {
  const normalized = String(value || "independent-review").trim().toLowerCase();
  if (!RELEASE_APPROVAL_MODES.includes(normalized)) {
    throw evidenceError(
      "RELEASE_APPROVAL_MODE must be independent-review or solo-operator."
    );
  }
  return normalized;
}

export function parseSoloOperatorIds(value) {
  try {
    return parseAttesterIds(value);
  } catch {
    throw evidenceError("RELEASE_SOLO_OPERATOR_IDS must contain GitHub numeric user ids.");
  }
}

export function parseReleaseUatRunTitle(value) {
  const parts = String(value || "").split("/");
  if (parts.length !== 10 || parts[0] !== "release-uat" || parts[1] !== "v3") {
    throw evidenceError("the UAT workflow title does not match the v3 evidence contract.");
  }
  const [, , approvalModeValue, releaseShaValue, target, smsProviderValue,
    smsConfigurationGenerationValue, rollbackShaValue, stagingId, checklistDigest] = parts;
  const approvalMode = parseReleaseApprovalMode(approvalModeValue);
  const smsProvider = parseReleaseSmsProvider(smsProviderValue);
  const smsConfigurationGeneration = parseReleaseSmsConfigurationGeneration(
    smsConfigurationGenerationValue,
    smsProvider
  );
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
  return {
    approvalMode,
    releaseSha,
    target,
    smsProvider,
    smsConfigurationGeneration,
    rollbackSha,
    stagingId,
    checklistDigest
  };
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

export function validateProtectedEnvironment(
  environment,
  { name, attesterId = null, approvalMode = "independent-review" }
) {
  const normalizedApprovalMode = parseReleaseApprovalMode(approvalMode);
  if (
    String(environment?.name || "").toLowerCase()
    !== String(name || "").toLowerCase()
  ) {
    throw evidenceError(`the ${name} GitHub environment is missing.`);
  }
  const reviewerRule = Array.isArray(environment.protection_rules)
    ? environment.protection_rules.find((rule) => rule?.type === "required_reviewers")
    : null;
  const reviewers = Array.isArray(reviewerRule?.reviewers) ? reviewerRule.reviewers : [];
  let reviewerIds = [];
  if (normalizedApprovalMode === "independent-review") {
    if (!reviewerRule || reviewerRule.prevent_self_review !== true) {
      throw evidenceError(`${name} must require reviewers and prevent self-review.`);
    }
    if (reviewers.some((entry) => entry?.type !== "User" || entry?.reviewer?.type !== "User")) {
      throw evidenceError(`${name} must use directly assigned user reviewers.`);
    }
    reviewerIds = reviewers
      .map((entry) => Number(entry?.reviewer?.id))
      .filter((id) => Number.isSafeInteger(id) && id > 0);
    if (reviewerIds.length === 0 || new Set(reviewerIds).size !== reviewerIds.length) {
      throw evidenceError(`${name} has no valid required reviewer.`);
    }
    if (attesterId && !reviewerIds.some((id) => id !== attesterId)) {
      throw evidenceError(`${name} needs a reviewer other than the UAT attester.`);
    }
  } else if (reviewerRule || reviewers.length > 0) {
    throw evidenceError(`${name} solo-operator policy may not contain a reviewer gate.`);
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

  return Object.freeze({
    approvalMode: normalizedApprovalMode,
    environmentId,
    reviewerIds: new Set(reviewerIds)
  });
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
    smsProvider: smsProviderValue,
    smsConfigurationGeneration: smsConfigurationGenerationValue,
    uatRunId,
    checklistDigest,
    attesterIds,
    approvalMode = "independent-review",
    soloOperatorIds = new Set(),
    ciCompletedAt,
    now,
    maximumAttestationAgeHours
  }
) {
  const normalizedApprovalMode = parseReleaseApprovalMode(approvalMode);
  const smsProvider = parseReleaseSmsProvider(smsProviderValue);
  const smsConfigurationGeneration = parseReleaseSmsConfigurationGeneration(
    smsConfigurationGenerationValue,
    smsProvider
  );
  validateCanonicalRepository(run, "the UAT run");
  if (Number(run?.id) !== uatRunId) {
    throw evidenceError("the UAT response id does not match the requested run.");
  }
  if (
    Number(run?.workflow_id) !== RELEASE_EVIDENCE_POLICY.uatWorkflow.id
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
  if (
    normalizedApprovalMode === "solo-operator"
    && (!(soloOperatorIds instanceof Set) || !soloOperatorIds.has(actorId))
  ) {
    throw evidenceError("the UAT attestation actor is not an allowlisted solo operator.");
  }

  const title = parseReleaseUatRunTitle(run?.display_title);
  if (title.releaseSha !== releaseSha || title.rollbackSha !== rollbackSha) {
    throw evidenceError("the UAT title is bound to a different release or rollback SHA.");
  }
  if (title.target !== target) {
    throw evidenceError("the UAT attestation does not cover this deployment target.");
  }
  if (title.smsProvider !== smsProvider) {
    throw evidenceError("the UAT attestation covers a different SMS provider profile.");
  }
  if (title.smsConfigurationGeneration !== smsConfigurationGeneration) {
    throw evidenceError("the UAT attestation covers a different SMS configuration generation.");
  }
  if (title.approvalMode !== normalizedApprovalMode) {
    throw evidenceError("the UAT attestation used a different approval mode.");
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

  return {
    actorId,
    approvalMode: normalizedApprovalMode,
    completedAt: new Date(uatCompletedMs).toISOString(),
    stagingId: title.stagingId,
    attestedTarget: title.target,
    smsProvider,
    smsConfigurationGeneration
  };
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
  {
    releaseSha,
    rollbackSha,
    target,
    preparationRunId,
    ciRunId,
    uatRunId,
    approvalMode = "independent-review"
  }
) {
  const normalizedApprovalMode = parseReleaseApprovalMode(approvalMode);
  validateCanonicalRepository(run, "the preparation run");
  if (Number(run?.id) !== preparationRunId) {
    throw evidenceError("the preparation response id does not match the current run.");
  }
  const expectedWorkflow = RELEASE_EVIDENCE_POLICY.preparationWorkflows[target];
  if (
    !expectedWorkflow
    || Number(run?.workflow_id) !== expectedWorkflow.id
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
    "v2",
    normalizedApprovalMode,
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
  const createdAtMs = Date.parse(run?.created_at || run?.run_started_at);
  if (!Number.isFinite(createdAtMs)) {
    throw evidenceError("the preparation workflow creation timestamp is invalid.");
  }
  return {
    operatorId: actorId,
    createdAt: new Date(createdAtMs).toISOString()
  };
}

export function validateDirectDeploymentRun(
  run,
  {
    releaseSha,
    rollbackSha,
    target,
    deploymentRunId,
    ciRunId,
    smsProvider: smsProviderValue,
    smsConfigurationGeneration: smsConfigurationGenerationValue,
    approvalMode = "independent-review",
    releaseProfile: releaseProfileValue = "safe-off"
  }
) {
  const normalizedApprovalMode = parseReleaseApprovalMode(approvalMode);
  const releaseProfile = parseProductionReleaseProfile(releaseProfileValue);
  validateCanonicalRepository(run, "the deployment run");
  if (Number(run?.id) !== deploymentRunId) {
    throw evidenceError("the deployment response id does not match the current run.");
  }
  const expectedWorkflow = RELEASE_EVIDENCE_POLICY.preparationWorkflows[target];
  if (
    !expectedWorkflow
    || Number(run?.workflow_id) !== expectedWorkflow.id
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
  const firebaseDeployment = String(target).startsWith("firebase-");
  const smsProvider = firebaseDeployment
    ? parseReleaseSmsProvider(smsProviderValue)
    : "";
  const smsConfigurationGeneration = firebaseDeployment
    ? parseReleaseSmsConfigurationGeneration(
      smsConfigurationGenerationValue,
      smsProvider
    )
    : "";
  const expectedTitle = firebaseDeployment
    ? [
      "deploy",
      "v3",
      normalizedApprovalMode,
      releaseProfile,
      target,
      releaseSha,
      String(ciRunId),
      rollbackSha,
      smsProvider,
      smsConfigurationGeneration
    ].join("/")
    : [
      "deploy",
      "v2",
      normalizedApprovalMode,
      releaseProfile,
      target,
      releaseSha,
      String(ciRunId),
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
  const operatorId = Number(run?.actor?.id);
  if (
    run?.actor?.type !== "User"
    || !Number.isSafeInteger(operatorId)
    || operatorId <= 0
    || Number(run?.triggering_actor?.id) !== operatorId
  ) {
    throw evidenceError("the deployment workflow was not dispatched by one human operator.");
  }
  return Object.freeze({ operatorId });
}

export function validateSoloOperatorControls({
  attesterId,
  operatorId,
  soloOperatorIds,
  uatCompletedAt,
  preparationCreatedAt,
  minimumCooldownMinutes = RELEASE_EVIDENCE_POLICY.soloOperator.minimumCooldownMinutes
} = {}) {
  if (
    !(soloOperatorIds instanceof Set)
    || soloOperatorIds.size !== 1
    || !soloOperatorIds.has(attesterId)
    || operatorId !== attesterId
  ) {
    throw evidenceError(
      "solo-operator release requires one allowlisted human to attest and dispatch preparation."
    );
  }
  if (
    !Number.isSafeInteger(minimumCooldownMinutes)
    || minimumCooldownMinutes < 5
    || minimumCooldownMinutes > 1440
  ) {
    throw evidenceError("the solo-operator cooling period is invalid.");
  }
  const uatCompletedMs = Date.parse(uatCompletedAt);
  const preparationCreatedMs = Date.parse(preparationCreatedAt);
  if (![uatCompletedMs, preparationCreatedMs].every(Number.isFinite)) {
    throw evidenceError("the solo-operator release timestamps are invalid.");
  }
  const cooldownMs = minimumCooldownMinutes * 60 * 1000;
  if (preparationCreatedMs - uatCompletedMs < cooldownMs) {
    throw evidenceError(
      `solo-operator preparation must start at least ${minimumCooldownMinutes} minutes after UAT completes.`
    );
  }
  return Object.freeze({
    approvalMode: "solo-operator",
    controlId: `solo-cooldown-${minimumCooldownMinutes}m`,
    operatorId
  });
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
    smsProvider: smsProviderValue,
    smsConfigurationGeneration: smsConfigurationGenerationValue,
    headSha,
    preparationRunId: preparationRunIdValue,
    token,
    attesterIds: attesterIdsValue,
    approvalMode: approvalModeValue = "independent-review",
    soloOperatorIds: soloOperatorIdsValue = "",
    root = ROOT
  },
  { fetchImpl = globalThis.fetch, git = defaultGit, now = new Date() } = {}
) {
  const releaseSha = requireFullSha(releaseShaValue, "--release-sha");
  const rollbackSha = requireFullSha(rollbackShaValue, "--rollback-sha");
  const ciRunId = requireRunId(ciRunIdValue, "--ci-run-id");
  const uatRunId = requireRunId(uatRunIdValue, "--uat-run-id");
  const preparationRunId = requireRunId(preparationRunIdValue, "GITHUB_RUN_ID");
  const smsProvider = parseReleaseSmsProvider(smsProviderValue);
  const smsConfigurationGeneration = parseReleaseSmsConfigurationGeneration(
    smsConfigurationGenerationValue,
    smsProvider
  );
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
  const approvalMode = parseReleaseApprovalMode(approvalModeValue);
  const soloOperatorIds = approvalMode === "solo-operator"
    ? (soloOperatorIdsValue instanceof Set
      ? soloOperatorIdsValue
      : parseSoloOperatorIds(soloOperatorIdsValue))
    : new Set();
  const environmentNames = approvalMode === "solo-operator"
    ? {
      uat: RELEASE_EVIDENCE_POLICY.environments.soloUat,
      deploy: RELEASE_EVIDENCE_POLICY.environments.soloDeploy
    }
    : {
      uat: RELEASE_EVIDENCE_POLICY.environments.uat,
      deploy: RELEASE_EVIDENCE_POLICY.environments.deploy
    };
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
        `${GITHUB_API}/repos/TOTALLYMAJOR/quoteflow/environments/${environmentNames.uat}`,
        requestOptions
      ),
      fetchGitHubJson(
        `${GITHUB_API}/repos/TOTALLYMAJOR/quoteflow/environments/${environmentNames.deploy}`,
        requestOptions
      )
    ]);

  const preparation = validatePreparationRun(preparationRun, {
    releaseSha,
    rollbackSha,
    target,
    preparationRunId,
    ciRunId,
    uatRunId,
    approvalMode
  });
  validateCiRun(ciRun, { releaseSha, ciRunId });
  validateCiJobs(ciJobs);
  const uat = validateUatRun(uatRun, {
    releaseSha,
    rollbackSha,
    target,
    smsProvider,
    smsConfigurationGeneration,
    uatRunId,
    checklistDigest: checklist.digest,
    attesterIds,
    approvalMode,
    soloOperatorIds,
    ciCompletedAt: ciRun.updated_at,
    now,
    maximumAttestationAgeHours: checklist.maximumAttestationAgeHours
  });
  validateUatJobs(uatJobs);
  const uatEnvironmentPolicy = validateProtectedEnvironment(uatEnvironment, {
    name: environmentNames.uat,
    attesterId: uat.actorId,
    approvalMode
  });
  const deployEnvironmentPolicy = validateProtectedEnvironment(deployEnvironment, {
    name: environmentNames.deploy,
    approvalMode
  });
  let uatReview;
  let preparationReview;
  if (approvalMode === "solo-operator") {
    const control = validateSoloOperatorControls({
      attesterId: uat.actorId,
      operatorId: preparation.operatorId,
      soloOperatorIds,
      uatCompletedAt: uat.completedAt,
      preparationCreatedAt: preparation.createdAt
    });
    uatReview = {
      reviewId: `solo-uat:${uatRunId}`,
      reviewerId: control.operatorId
    };
    preparationReview = {
      reviewId: `${control.controlId}:${preparationRunId}`,
      reviewerId: control.operatorId
    };
  } else {
    const [uatReviewLog, preparationReviewLog] = await Promise.all([
      fetchDeploymentReviews(uatRun, "UAT", requestOptions),
      fetchDeploymentReviews(preparationRun, "preparation", requestOptions)
    ]);
    uatReview = validateUatDeploymentReviews(uatReviewLog, {
      uatRunId,
      uatNodeId: uatRun.node_id,
      environmentName: environmentNames.uat,
      environmentId: uatEnvironmentPolicy.environmentId,
      attesterId: uat.actorId,
      requiredReviewerIds: uatEnvironmentPolicy.reviewerIds
    });
    preparationReview = validatePreparationDeploymentReviews(preparationReviewLog, {
      preparationRunId,
      preparationNodeId: preparationRun.node_id,
      environmentName: environmentNames.deploy,
      environmentId: deployEnvironmentPolicy.environmentId,
      operatorId: preparation.operatorId,
      attesterId: uat.actorId,
      requiredReviewerIds: deployEnvironmentPolicy.reviewerIds
    });
  }

  return Object.freeze({
    schema: "com.mbmapps.quotepilot.production-release-evidence/v5",
    approvalMode,
    releaseSha,
    releaseTag: publishedRevision.releaseTag,
    rollbackSha,
    target,
    smsProvider,
    smsConfigurationGeneration,
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

export async function verifyDirectProductionReleaseEvidence(
  {
    releaseSha: releaseShaValue,
    ciRunId: ciRunIdValue,
    rollbackSha: rollbackShaValue,
    target,
    smsProvider: smsProviderValue,
    smsConfigurationGeneration: smsConfigurationGenerationValue,
    headSha,
    deploymentRunId: deploymentRunIdValue,
    token,
    approvalMode: approvalModeValue = "independent-review",
    releaseProfile: releaseProfileValue,
    soloOperatorIds: soloOperatorIdsValue = "",
    root = ROOT
  },
  { fetchImpl = globalThis.fetch, git = defaultGit, now = new Date() } = {}
) {
  const releaseSha = requireFullSha(releaseShaValue, "--release-sha");
  const rollbackSha = requireFullSha(rollbackShaValue, "--rollback-sha");
  const ciRunId = requireRunId(ciRunIdValue, "--ci-run-id");
  const deploymentRunId = requireRunId(deploymentRunIdValue, "GITHUB_RUN_ID");
  const releaseProfile = parseProductionReleaseProfile(releaseProfileValue);
  if (!Object.hasOwn(RELEASE_EVIDENCE_POLICY.preparationWorkflows, target)) {
    throw evidenceError(
      "the deployment target must be firebase-hosting, firebase-backend, firebase-all, or vercel."
    );
  }
  const firebaseDeployment = String(target).startsWith("firebase-");
  const smsProvider = firebaseDeployment
    ? parseReleaseSmsProvider(smsProviderValue)
    : "";
  const smsConfigurationGeneration = firebaseDeployment
    ? parseReleaseSmsConfigurationGeneration(
      smsConfigurationGenerationValue,
      smsProvider
    )
    : "";
  const normalizedToken = String(token || "").trim();
  if (!normalizedToken) {
    throw evidenceError("GITHUB_TOKEN or GH_TOKEN is required for live evidence verification.");
  }
  if (typeof fetchImpl !== "function") {
    throw evidenceError("the runtime does not provide a GitHub HTTP client.");
  }
  const approvalMode = parseReleaseApprovalMode(approvalModeValue);
  const soloOperatorIds = approvalMode === "solo-operator"
    ? (soloOperatorIdsValue instanceof Set
      ? soloOperatorIdsValue
      : parseSoloOperatorIds(soloOperatorIdsValue))
    : new Set();
  const environmentName = approvalMode === "solo-operator"
    ? RELEASE_EVIDENCE_POLICY.environments.soloDeploy
    : RELEASE_EVIDENCE_POLICY.environments.deploy;
  const gitEvidence = validateGitEvidence(
    { releaseSha, rollbackSha, headSha },
    { git, root }
  );
  const requestOptions = { token: normalizedToken, fetchImpl };
  const [publishedRevision, deploymentRun, ciRun, ciJobs, deployEnvironment] =
    await Promise.all([
      validatePublishedReleaseRevision({ releaseSha, ...gitEvidence }, requestOptions),
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
        `${GITHUB_API}/repos/TOTALLYMAJOR/quoteflow/environments/${environmentName}`,
        requestOptions
      )
    ]);

  const deployment = validateDirectDeploymentRun(deploymentRun, {
    releaseSha,
    rollbackSha,
    target,
    deploymentRunId,
    ciRunId,
    smsProvider,
    smsConfigurationGeneration,
    approvalMode,
    releaseProfile
  });
  validateCiRun(ciRun, { releaseSha, ciRunId });
  validateCiJobs(ciJobs);
  const environmentPolicy = validateProtectedEnvironment(deployEnvironment, {
    name: environmentName,
    approvalMode
  });

  let productionReviewId;
  let productionReviewerId;
  if (approvalMode === "solo-operator") {
    if (
      soloOperatorIds.size !== 1
      || !soloOperatorIds.has(deployment.operatorId)
    ) {
      throw evidenceError(
        "solo-operator deployment requires the one allowlisted human operator."
      );
    }
    productionReviewId = `solo-dispatch:${deploymentRunId}`;
    productionReviewerId = deployment.operatorId;
  } else {
    const reviewLog = await fetchDeploymentReviews(
      deploymentRun,
      "deployment",
      requestOptions
    );
    const review = validatePreparationDeploymentReviews(reviewLog, {
      preparationRunId: deploymentRunId,
      preparationNodeId: deploymentRun.node_id,
      environmentName,
      environmentId: environmentPolicy.environmentId,
      operatorId: deployment.operatorId,
      attesterId: deployment.operatorId,
      requiredReviewerIds: environmentPolicy.reviewerIds
    });
    productionReviewId = review.reviewId;
    productionReviewerId = review.reviewerId;
  }

  return Object.freeze({
    schema: "com.mbmapps.quotepilot.direct-production-release-evidence/v1",
    approvalMode,
    releaseProfile,
    releaseSha,
    releaseTag: publishedRevision.releaseTag,
    rollbackSha,
    target,
    ...(firebaseDeployment ? { smsProvider, smsConfigurationGeneration } : {}),
    ciRunId,
    deploymentRunId,
    operatorId: deployment.operatorId,
    productionReviewerId,
    productionReviewId,
    verifiedAt: (now instanceof Date ? now : new Date(Number(now))).toISOString()
  });
}

export function parseReleaseEvidenceCliArgs(argv) {
  const required = new Set([
    "--release-sha",
    "--ci-run-id",
    "--uat-run-id",
    "--rollback-sha",
    "--target",
    "--sms-provider",
    "--sms-configuration-generation"
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
    smsProvider: args["sms-provider"],
    smsConfigurationGeneration: args["sms-configuration-generation"],
    headSha: head,
    preparationRunId: process.env.GITHUB_RUN_ID,
    token: process.env.GITHUB_TOKEN || process.env.GH_TOKEN,
    attesterIds: process.env.RELEASE_UAT_ATTESTER_IDS,
    approvalMode: process.env.RELEASE_APPROVAL_MODE,
    soloOperatorIds: process.env.RELEASE_SOLO_OPERATOR_IDS,
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
