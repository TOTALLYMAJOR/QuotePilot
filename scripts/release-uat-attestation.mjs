#!/usr/bin/env node

import fs from "node:fs";
import crypto from "node:crypto";
import path from "node:path";
import { fileURLToPath } from "node:url";
import {
  getReleaseUatChecklist,
  parseAttesterIds,
  parseReleaseApprovalMode,
  parseSoloOperatorIds,
  RELEASE_EVIDENCE_POLICY
} from "./production-release-evidence.mjs";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");

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

export function getReleaseUatItemIdsForTarget(targetValue, root = ROOT) {
  const target = requireReleaseTarget(targetValue);
  return getReleaseUatChecklist(root).itemIdsByTarget[target];
}

export function parseReleaseUatArgs(argv) {
  if (argv.length === 1 && argv[0] === "--print-digest") {
    return { printDigest: true };
  }
  if (argv[0] === "--print-items") {
    if (argv.length !== 3 || argv[1] !== "--target" || !argv[2]) {
      throw attestationError("--print-items requires --target and one deployment target.");
    }
    return { printItems: true, target: requireReleaseTarget(argv[2]) };
  }
  const allowed = new Set([
    "--release-sha",
    "--target",
    "--rollback-sha",
    "--staging-id",
    "--checklist-digest",
    "--checked-item-ids",
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
  const requiredItemIds = checklist.itemIdsByTarget[target];
  if (
    !Array.isArray(requiredItemIds)
    || requiredItemIds.length === 0
    || checkedItemIds.length !== requiredItemIds.length
    || new Set(checkedItemIds).size !== checkedItemIds.length
    || requiredItemIds.some((itemId) => !checkedItemIds.includes(itemId))
  ) {
    throw attestationError(
      `--checked-item-ids must contain every ${target} checklist item exactly once and no non-applicable items.`
    );
  }

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
    schema: "com.mbmapps.quotepilot.release-uat-attestation/v2",
    approvalMode,
    releaseSha,
    target,
    rollbackSha,
    stagingId,
    checklist: {
      schema: checklist.checklist.schema,
      version: checklist.checklist.version,
      digest: checklist.digest,
      checkedItemIds: requiredItemIds
    },
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
    process.stdout.write(`${getReleaseUatItemIdsForTarget(args.target, ROOT).join(",")}\n`);
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
