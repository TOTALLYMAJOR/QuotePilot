#!/usr/bin/env node

import fs from "node:fs";
import path from "node:path";
import { spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";
import { verifyProductionReleaseEvidence } from "./production-release-evidence.mjs";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const CONFIRMATION = "DEPLOY quotepilot.mbmapps.com via vercel";
const EXPECTED_VERCEL_LINK = Object.freeze({
  projectId: "prj_epLi14LmBItwYkv25XZoAkWZf4Jk",
  orgId: "team_AW2QNNgYt5vESEO3eOTJXHp1",
  projectName: "quoteflow"
});

function readArg(name) {
  const index = process.argv.indexOf(name);
  return index >= 0 ? String(process.argv[index + 1] || "").trim() : "";
}

function validateArgs() {
  const args = process.argv.slice(2);
  const allowed = new Set([
    "--confirm",
    "--release-sha",
    "--ci-run-id",
    "--uat-run-id",
    "--rollback-sha"
  ]);
  const seen = new Set();
  for (let index = 0; index < args.length; index += 1) {
    const token = args[index];
    if (!allowed.has(token)) throw new Error(`Unknown argument: ${token}`);
    if (seen.has(token)) throw new Error(`Duplicate argument: ${token}`);
    seen.add(token);
    if (!args[index + 1] || args[index + 1].startsWith("--")) {
      throw new Error(`${token} requires a value.`);
    }
    index += 1;
  }
}

function capture(command, args) {
  const result = spawnSync(command, args, {
    cwd: ROOT,
    encoding: "utf8",
    stdio: ["ignore", "pipe", "pipe"],
    shell: false
  });
  if (result.error) throw result.error;
  if (result.status !== 0) {
    throw new Error(String(result.stderr || result.stdout || "Command failed.").trim());
  }
  return String(result.stdout || "").trim();
}

function run(command, args) {
  const result = spawnSync(command, args, {
    cwd: ROOT,
    stdio: "inherit",
    shell: false
  });
  if (result.error) throw result.error;
  if (result.status !== 0) process.exit(result.status || 1);
}

function validateVercelProjectLink() {
  const linkPath = path.join(ROOT, ".vercel", "project.json");
  if (!fs.existsSync(linkPath)) {
    throw new Error(
      "Refusing Vercel production deployment without the approved .vercel/project.json link."
    );
  }

  let linkedProject;
  try {
    linkedProject = JSON.parse(fs.readFileSync(linkPath, "utf8"));
  } catch {
    throw new Error(
      "Refusing Vercel production deployment because .vercel/project.json is invalid."
    );
  }

  const mismatchedFields = Object.entries(EXPECTED_VERCEL_LINK)
    .filter(([field, expected]) => String(linkedProject?.[field] || "") !== expected)
    .map(([field]) => field);
  if (mismatchedFields.length) {
    throw new Error(
      `Refusing Vercel production deployment from an unapproved project link (${mismatchedFields.join(", ")}).`
    );
  }
}

function validatePublishedReleaseRevision() {
  if (capture("git", ["status", "--porcelain"])) {
    throw new Error("Refusing Vercel production deployment from a dirty working tree.");
  }
  const branch = capture("git", ["branch", "--show-current"]);
  const isExactMainDispatch =
    process.env.GITHUB_ACTIONS === "true"
    && process.env.GITHUB_EVENT_NAME === "workflow_dispatch"
    && process.env.GITHUB_REF === "refs/heads/main";
  if (branch !== "main" && !(branch === "" && isExactMainDispatch)) {
    throw new Error("Refusing Vercel production deployment from anything other than main.");
  }
  const head = capture("git", ["rev-parse", "HEAD"]);
  if (!isExactMainDispatch) {
    throw new Error("Refusing Vercel production deployment outside an exact main workflow dispatch.");
  }
  if (String(process.env.GITHUB_SHA || "").toLowerCase() !== head.toLowerCase()) {
    throw new Error("Refusing Vercel production deployment because GITHUB_SHA does not match HEAD.");
  }
  if (branch === "main" && head !== capture("git", ["rev-parse", "@{upstream}"])) {
    throw new Error("Refusing Vercel production deployment until HEAD matches its upstream.");
  }
  const remoteHead = capture(
    "git",
    ["ls-remote", "--heads", "origin", "refs/heads/main"]
  ).split(/\s+/)[0] || "";
  if (!remoteHead || head !== remoteHead) {
    throw new Error("Refusing Vercel production deployment until HEAD matches origin/main.");
  }

  const releaseTags = capture("git", [
    "tag",
    "--points-at",
    "HEAD",
    "--list",
    "v[0-9]*.[0-9]*.[0-9]*"
  ])
    .split(/\r?\n/)
    .map((tag) => tag.trim())
    .filter((tag) => /^v\d+\.\d+\.\d+$/.test(tag));
  const publishedTag = releaseTags.find((tag) => {
    const output = capture(
      "git",
      ["ls-remote", "--tags", "origin", `refs/tags/${tag}`, `refs/tags/${tag}^{}`]
    );
    return output
      .split(/\r?\n/)
      .some((line) => line.split(/\s+/)[0] === head);
  });
  if (!publishedTag) {
    throw new Error(
      "Refusing Vercel production deployment until HEAD has a semantic release tag published to origin."
    );
  }
  return head;
}

validateArgs();
if (readArg("--confirm") !== CONFIRMATION) {
  throw new Error(`Vercel production deployment requires --confirm "${CONFIRMATION}".`);
}
validateVercelProjectLink();
async function verifyReleaseEvidence(headSha) {
  return verifyProductionReleaseEvidence({
    releaseSha: readArg("--release-sha"),
    ciRunId: readArg("--ci-run-id"),
    uatRunId: readArg("--uat-run-id"),
    rollbackSha: readArg("--rollback-sha"),
    target: "vercel",
    headSha,
    deploymentRunId: process.env.GITHUB_RUN_ID,
    token: process.env.GITHUB_TOKEN || process.env.GH_TOKEN,
    attesterIds: process.env.RELEASE_UAT_ATTESTER_IDS,
    root: ROOT
  });
}

await verifyReleaseEvidence(validatePublishedReleaseRevision());
run("npm", ["run", "check:env"]);
run("npx", ["vercel", "build", "--prod"]);
await verifyReleaseEvidence(validatePublishedReleaseRevision());
run("npx", ["vercel", "deploy", "--prebuilt", "--prod", "--yes"]);
