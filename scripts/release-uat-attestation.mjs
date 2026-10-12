#!/usr/bin/env node

import fs from "node:fs";
import crypto from "node:crypto";
import net from "node:net";
import path from "node:path";
import { fileURLToPath } from "node:url";
import {
  getReleaseUatChecklist,
  getReleaseUatProfilePlan,
  parseAttesterIds,
  parseReleaseApprovalMode,
  parseReleaseSmsConfigurationGeneration,
  parseReleaseSmsProvider,
  parseSoloOperatorIds,
  RELEASE_EVIDENCE_POLICY
} from "./production-release-evidence.mjs";
import { RELEASE_CANDIDATE_POLICY } from "./release-candidate-policy.mjs";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const HOSTED_ROLE_QUALIFICATION_SCHEMA =
  "com.mbmapps.quotepilot.hosted-role-qualification/v1";
const REQUIRED_ROLE_OUTCOMES = Object.freeze({
  admin: "passed",
  sales: "passed",
  customer: "passed",
  "cross-tenant": "denied"
});

function attestationError(message) {
  return new Error(`Release UAT attestation rejected: ${message}`);
}

function requireFullSha(value, field) {
  const normalized = String(value || "").trim().toLowerCase();
  if (!/^[0-9a-f]{40}$/.test(normalized)) {
    throw attestationError(`${field} must be a full 40-character commit SHA.`);
  }
  return normalized;
}

function requireReleaseTarget(value) {
  const target = String(value || "").trim();
  if (!Object.hasOwn(RELEASE_EVIDENCE_POLICY.preparationWorkflows, target)) {
    throw attestationError(
      "--target must be firebase-hosting, firebase-backend, firebase-all, or vercel."
    );
  }
  return target;
}

function hasExactKeys(value, keys) {
  return value
    && typeof value === "object"
    && !Array.isArray(value)
    && JSON.stringify(Object.keys(value).sort()) === JSON.stringify([...keys].sort());
}

function requireOpaqueObservationId(value, field) {
  const observationId = String(value || "").trim();
  if (!/^[A-Za-z0-9][A-Za-z0-9._:-]{7,127}$/.test(observationId)) {
    throw attestationError(`${field} must be an opaque 8-128 character observation id.`);
  }
  return observationId;
}

function requireHostedOrigin(value, target) {
  const raw = String(value || "").trim();
  let parsed;
  try {
    parsed = new URL(raw);
  } catch {
    throw attestationError("role qualification deploymentOrigin must be a public HTTPS origin.");
  }
  const hostname = parsed.hostname.toLowerCase();
  if (
    parsed.protocol !== "https:"
    || raw !== parsed.origin
    || parsed.username
    || parsed.password
    || parsed.port
    || net.isIP(hostname) !== 0
    || hostname.includes(":")
    || !hostname.includes(".")
    || hostname === "localhost"
    || hostname.endsWith(".localhost")
    || hostname.endsWith(".local")
    || hostname.endsWith(".test")
    || hostname.endsWith(".invalid")
    || hostname.endsWith(".example")
  ) {
    throw attestationError("role qualification deploymentOrigin must be a public HTTPS origin.");
  }
  if (
    (target.startsWith("firebase-")
      && parsed.origin !== RELEASE_CANDIDATE_POLICY.firebase.hostingUrl)
    || (target === "vercel" && !hostname.endsWith(".vercel.app"))
  ) {
    throw attestationError(
      "role qualification deploymentOrigin does not match the selected candidate target."
    );
  }
  return parsed.origin;
}

export function validateHostedRoleQualification(
  value,
  { releaseSha, target, candidateProfile, stagingId }
) {
  const raw = String(value || "");
  if (!raw.trim() || Buffer.byteLength(raw, "utf8") > 20_000) {
    throw attestationError("--role-qualification-json must contain bounded JSON evidence.");
  }
  let evidence;
  try {
    evidence = JSON.parse(raw);
  } catch {
    throw attestationError("--role-qualification-json must be valid JSON.");
  }
  const evidenceKeys = [
    "schema",
    "releaseSha",
    "target",
    "candidateProfile",
    "stagingId",
    "deploymentOrigin",
    "executionContext",
    "fixtureMode",
    "authBypass",
    "emulator",
    "featureGateProfiles",
    "roleResults"
  ];
  if (!hasExactKeys(evidence, evidenceKeys)) {
    throw attestationError("hosted role qualification fields do not match the v1 contract.");
  }
  if (evidence.schema !== HOSTED_ROLE_QUALIFICATION_SCHEMA) {
    throw attestationError("hosted role qualification schema is not supported.");
  }
  if (
    String(evidence.releaseSha || "").toLowerCase() !== releaseSha
    || evidence.target !== target
    || evidence.candidateProfile !== candidateProfile
    || evidence.stagingId !== stagingId
  ) {
    throw attestationError(
      "hosted role qualification is bound to a different release candidate."
    );
  }
  if (
    evidence.executionContext !== "hosted"
    || evidence.fixtureMode !== false
    || evidence.authBypass !== false
    || evidence.emulator !== false
  ) {
    throw attestationError(
      "hosted role qualification cannot use a local fixture, auth bypass, or emulator."
    );
  }
  const deploymentOrigin = requireHostedOrigin(evidence.deploymentOrigin, target);
  if (!Array.isArray(evidence.featureGateProfiles) || evidence.featureGateProfiles.length !== 1) {
    throw attestationError(
      "hosted role qualification must declare the one exact candidate feature-gate profile."
    );
  }
  const profile = evidence.featureGateProfiles[0];
  if (
    !hasExactKeys(profile, ["id", "outcome", "observationId"])
    || profile.id !== candidateProfile
    || profile.outcome !== "passed"
  ) {
    throw attestationError(
      "hosted role qualification feature-gate profile must pass the exact candidate profile."
    );
  }
  const profileObservationId = requireOpaqueObservationId(
    profile.observationId,
    "feature-gate profile observationId"
  );

  if (!Array.isArray(evidence.roleResults) || evidence.roleResults.length !== 4) {
    throw attestationError(
      "hosted role qualification requires exactly admin, sales, customer, and cross-tenant results."
    );
  }
  const rolesByName = new Map();
  const observationIds = new Set([profileObservationId]);
  for (const result of evidence.roleResults) {
    if (!hasExactKeys(result, ["role", "outcome", "featureGateProfileId", "observationId"])) {
      throw attestationError("a hosted role result does not match the v1 contract.");
    }
    const expectedOutcome = REQUIRED_ROLE_OUTCOMES[result.role];
    if (!expectedOutcome || result.outcome !== expectedOutcome) {
      throw attestationError(
        "hosted role qualification must pass admin, sales, and customer and deny cross-tenant access."
      );
    }
    if (result.featureGateProfileId !== candidateProfile) {
      throw attestationError("every hosted role result must use the exact candidate profile.");
    }
    const observationId = requireOpaqueObservationId(
      result.observationId,
      `${result.role} observationId`
    );
    if (observationIds.has(observationId)) {
      throw attestationError("hosted role qualification observation ids must be unique.");
    }
    observationIds.add(observationId);
    if (rolesByName.has(result.role)) {
      throw attestationError(
        "hosted role qualification results must list admin, sales, customer, and cross-tenant exactly once."
      );
    }
    rolesByName.set(result.role, Object.freeze({
      role: result.role,
      outcome: result.outcome,
      featureGateProfileId: result.featureGateProfileId
    }));
  }
  if (Object.keys(REQUIRED_ROLE_OUTCOMES).some((role) => !rolesByName.has(role))) {
    throw attestationError(
      "hosted role qualification results must list admin, sales, customer, and cross-tenant exactly once."
    );
  }

  const normalizedEvidence = {
    schema: HOSTED_ROLE_QUALIFICATION_SCHEMA,
    releaseSha,
    target,
    candidateProfile,
    stagingId,
    deploymentOrigin,
    executionContext: "hosted",
    fixtureMode: false,
    authBypass: false,
    emulator: false,
    featureGateProfiles: [{
      id: candidateProfile,
      outcome: "passed",
      observationId: profileObservationId
    }],
    roleResults: Object.keys(REQUIRED_ROLE_OUTCOMES).map((role) => {
      const result = evidence.roleResults.find((candidate) => candidate.role === role);
      return {
        role,
        outcome: result.outcome,
        featureGateProfileId: result.featureGateProfileId,
        observationId: result.observationId.trim()
      };
    })
  };
  return Object.freeze({
    schema: HOSTED_ROLE_QUALIFICATION_SCHEMA,
    digest: crypto.createHash("sha256")
      .update(JSON.stringify(normalizedEvidence))
      .digest("hex"),
    deploymentOrigin,
    featureGateProfileIds: Object.freeze([candidateProfile]),
    roleResults: Object.freeze(
      Object.keys(REQUIRED_ROLE_OUTCOMES).map((role) => rolesByName.get(role))
    )
  });
}

export function getReleaseUatItemIdsForTarget(
  targetValue,
  smsProviderValue,
  root = ROOT
) {
  const target = requireReleaseTarget(targetValue);
  const smsProvider = parseReleaseSmsProvider(smsProviderValue);
  return getReleaseUatChecklist(root).itemIdsByTargetAndSmsProvider[target][smsProvider];
}

export function getReleaseUatPlanForTarget(
  targetValue,
  candidateProfileValue,
  root = ROOT
) {
  const target = requireReleaseTarget(targetValue);
  return getReleaseUatProfilePlan(target, candidateProfileValue, root);
}

export function parseReleaseUatArgs(argv) {
  if (argv.length === 1 && argv[0] === "--print-digest") {
    return { printDigest: true };
  }
  if (argv[0] === "--print-items") {
    if (
      argv.length !== 5
      || argv[1] !== "--target"
      || !argv[2]
      || argv[3] !== "--sms-provider"
      || !argv[4]
    ) {
      throw attestationError(
        "--print-items requires --target, one deployment target, --sms-provider, and one SMS provider."
      );
    }
    return {
      printItems: true,
      target: requireReleaseTarget(argv[2]),
      smsProvider: parseReleaseSmsProvider(argv[4])
    };
  }
  if (argv[0] === "--print-plan") {
    if (
      argv.length !== 5
      || argv[1] !== "--target"
      || !argv[2]
      || argv[3] !== "--candidate-profile"
      || !argv[4]
    ) {
      throw attestationError(
        "--print-plan requires --target and --candidate-profile."
      );
    }
    return {
      printPlan: true,
      target: requireReleaseTarget(argv[2]),
      candidateProfile: String(argv[4]).trim()
    };
  }
  const allowed = new Set([
    "--release-sha",
    "--target",
    "--candidate-profile",
    "--sms-provider",
    "--sms-configuration-generation",
    "--rollback-sha",
    "--staging-id",
    "--checklist-digest",
    "--checked-item-ids",
    "--role-qualification-json",
    "--confirmation",
    "--output"
  ]);
  const values = new Map();
  for (let index = 0; index < argv.length; index += 2) {
    const name = argv[index];
    const value = argv[index + 1];
    if (!allowed.has(name)) throw attestationError(`unknown argument ${name || "<blank>"}.`);
    if (values.has(name)) throw attestationError(`duplicate argument ${name}.`);
    if (!value || String(value).startsWith("--")) {
      throw attestationError(`${name} requires a value.`);
    }
    values.set(name, String(value).trim());
  }
  for (const name of allowed) {
    if (!values.has(name)) throw attestationError(`${name} is required.`);
  }
  return Object.fromEntries([...values].map(([name, value]) => [name.slice(2), value]));
}

export function buildReleaseUatReceipt(
  args,
  { env = process.env, root = ROOT, now = new Date() } = {}
) {
  const checklist = getReleaseUatChecklist(root);
  const releaseSha = requireFullSha(args["release-sha"], "--release-sha");
  const rollbackSha = requireFullSha(args["rollback-sha"], "--rollback-sha");
  if (releaseSha === rollbackSha) {
    throw attestationError("the rollback SHA must differ from the release SHA.");
  }
  const target = requireReleaseTarget(args.target);
  const candidateProfile = String(args["candidate-profile"] || "").trim();
  const candidatePlan = getReleaseUatProfilePlan(target, candidateProfile, root);
  if (candidatePlan.qualification !== "eligible_for_attestation") {
    throw attestationError(
      `candidate profile ${candidateProfile || "<blank>"} has blocked checklist items and cannot be attested.`
    );
  }
  const smsProvider = parseReleaseSmsProvider(args["sms-provider"]);
  if (candidatePlan.candidateProfile.smsProvider !== smsProvider) {
    throw attestationError(
      `--sms-provider must match candidate profile ${candidateProfile}: ${candidatePlan.candidateProfile.smsProvider}.`
    );
  }
  const smsConfigurationGeneration = parseReleaseSmsConfigurationGeneration(
    args["sms-configuration-generation"],
    smsProvider
  );
  const stagingId = String(args["staging-id"] || "");
  if (!/^[A-Za-z0-9][A-Za-z0-9._:-]{2,79}$/.test(stagingId)) {
    throw attestationError("--staging-id is invalid.");
  }
  if (String(args["checklist-digest"] || "") !== checklist.digest) {
    throw attestationError("--checklist-digest does not match the tracked checklist.");
  }
  if (String(args.confirmation || "") !== `ATTEST UAT ${releaseSha}`) {
    throw attestationError(`--confirmation must equal "ATTEST UAT ${releaseSha}".`);
  }

  const checkedItemIds = String(args["checked-item-ids"] || "")
    .split(",")
    .map((itemId) => itemId.trim())
    .filter(Boolean);
  const requiredItemIds = candidatePlan.applicableItemIds;
  if (
    !Array.isArray(requiredItemIds)
    || requiredItemIds.length === 0
    || checkedItemIds.length !== requiredItemIds.length
    || new Set(checkedItemIds).size !== checkedItemIds.length
    || requiredItemIds.some((itemId) => !checkedItemIds.includes(itemId))
  ) {
    throw attestationError(
      `--checked-item-ids must contain every ${target} checklist item applicable to ${smsProvider} exactly once and no non-applicable items.`
    );
  }
  const roleQualification = validateHostedRoleQualification(
    args["role-qualification-json"],
    { releaseSha, target, candidateProfile, stagingId }
  );

  if (
    env.GITHUB_ACTIONS !== "true"
    || env.GITHUB_EVENT_NAME !== "workflow_dispatch"
    || env.GITHUB_REF !== "refs/heads/main"
    || String(env.GITHUB_SHA || "").toLowerCase() !== releaseSha
  ) {
    throw attestationError("attestation must run by manual dispatch on the exact main SHA.");
  }
  const actorId = Number(env.GITHUB_ACTOR_ID);
  const runId = Number(env.GITHUB_RUN_ID);
  const runAttempt = Number(env.GITHUB_RUN_ATTEMPT);
  if (
    !env.GITHUB_ACTOR
    || !Number.isSafeInteger(actorId)
    || actorId <= 0
    || !Number.isSafeInteger(runId)
    || runId <= 0
    || runAttempt !== 1
  ) {
    throw attestationError("GitHub actor or run identity is invalid.");
  }
  let attesterIds;
  try {
    attesterIds = parseAttesterIds(env.RELEASE_UAT_ATTESTER_IDS);
  } catch (error) {
    throw attestationError(String(error?.message || "the attester allowlist is invalid."));
  }
  if (!attesterIds.has(actorId)) {
    throw attestationError("the GitHub actor is not allowlisted to attest release UAT.");
  }
  let approvalMode;
  try {
    approvalMode = parseReleaseApprovalMode(env.RELEASE_APPROVAL_MODE);
  } catch (error) {
    throw attestationError(String(error?.message || "the approval mode is invalid."));
  }
  if (approvalMode === "solo-operator") {
    let soloOperatorIds;
    try {
      soloOperatorIds = parseSoloOperatorIds(env.RELEASE_SOLO_OPERATOR_IDS);
    } catch (error) {
      throw attestationError(String(error?.message || "the solo operator allowlist is invalid."));
    }
    if (soloOperatorIds.size !== 1 || !soloOperatorIds.has(actorId)) {
      throw attestationError(
        "solo-operator UAT requires the one allowlisted human operator."
      );
    }
  }
  const attesterAllowlistDigest = crypto
    .createHash("sha256")
    .update([...attesterIds].sort((left, right) => left - right).join(","))
    .digest("hex");

  const recordedAt = now instanceof Date ? now : new Date(now);
  if (!Number.isFinite(recordedAt.getTime())) {
    throw attestationError("the attestation timestamp is invalid.");
  }

  return Object.freeze({
    schema: "com.mbmapps.quotepilot.release-uat-attestation/v5",
    approvalMode,
    releaseSha,
    target,
    candidateProfile,
    smsProvider,
    smsConfigurationGeneration,
    rollbackSha,
    stagingId,
    checklist: {
      schema: checklist.checklist.schema,
      version: checklist.checklist.version,
      digest: checklist.digest,
      checkedItemIds: requiredItemIds
    },
    roleQualification,
    github: {
      repository: env.GITHUB_REPOSITORY,
      ref: env.GITHUB_REF,
      actor: env.GITHUB_ACTOR,
      actorId,
      runId,
      runAttempt,
      attesterAllowlistDigest
    },
    recordedAt: recordedAt.toISOString()
  });
}

function ensureReceiptDirectory(root, directory) {
  const rootStat = fs.lstatSync(root);
  if (!rootStat.isDirectory() || rootStat.isSymbolicLink()) {
    throw attestationError("the repository root must be a real directory.");
  }
  const relative = path.relative(root, directory);
  if (!relative || relative.startsWith("..") || path.isAbsolute(relative)) {
    throw attestationError("the receipt directory must remain inside the repository root.");
  }
  let cursor = root;
  for (const segment of relative.split(path.sep)) {
    cursor = path.join(cursor, segment);
    if (!fs.existsSync(cursor)) fs.mkdirSync(cursor, { mode: 0o700 });
    const stat = fs.lstatSync(cursor);
    if (!stat.isDirectory() || stat.isSymbolicLink() || fs.realpathSync(cursor) !== cursor) {
      throw attestationError("receipt output ancestors must be real repository directories.");
    }
  }
}

export function writeReleaseUatReceipt(receipt, outputValue, root = ROOT) {
  const resolvedRoot = path.resolve(root);
  const releaseDir = path.join(resolvedRoot, "artifacts", "release");
  const output = path.resolve(resolvedRoot, String(outputValue || ""));
  if (output === releaseDir || !output.startsWith(`${releaseDir}${path.sep}`)) {
    throw attestationError("--output must be a file inside artifacts/release.");
  }
  if (path.extname(output).toLowerCase() !== ".json") {
    throw attestationError("--output must use a .json extension.");
  }
  ensureReceiptDirectory(resolvedRoot, path.dirname(output));
  const temporary = `${output}.${process.pid}.${crypto.randomBytes(12).toString("hex")}.tmp`;
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

function main() {
  const args = parseReleaseUatArgs(process.argv.slice(2));
  if (args.printDigest) {
    process.stdout.write(`${getReleaseUatChecklist(ROOT).digest}\n`);
    return;
  }
  if (args.printItems) {
    process.stdout.write(
      `${getReleaseUatItemIdsForTarget(args.target, args.smsProvider, ROOT).join(",")}\n`
    );
    return;
  }
  if (args.printPlan) {
    process.stdout.write(`${JSON.stringify(
      getReleaseUatPlanForTarget(args.target, args.candidateProfile, ROOT),
      null,
      2
    )}\n`);
    return;
  }
  const receipt = buildReleaseUatReceipt(args, { root: ROOT });
  writeReleaseUatReceipt(receipt, args.output, ROOT);
  process.stdout.write(
    `Release UAT receipt recorded for ${receipt.target} at ${receipt.releaseSha}.\n`
  );
}

const isDirectExecution = process.argv[1]
  && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url);
if (isDirectExecution) main();
