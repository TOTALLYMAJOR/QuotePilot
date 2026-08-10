#!/usr/bin/env node

import { spawnSync } from "node:child_process";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { verifyDirectProductionReleaseEvidence } from "./production-release-evidence.mjs";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const allowed = new Set(["--release-sha", "--ci-run-id", "--rollback-sha", "--target"]);
const values = new Map();
const args = process.argv.slice(2);
for (let index = 0; index < args.length; index += 2) {
  const name = args[index];
  const value = args[index + 1];
  if (!allowed.has(name)) throw new Error(`Unknown argument: ${name || "<blank>"}`);
  if (values.has(name)) throw new Error(`Duplicate argument: ${name}`);
  if (!value || String(value).startsWith("--")) throw new Error(`${name} requires a value.`);
  values.set(name, String(value).trim());
}
for (const name of allowed) {
  if (!values.has(name)) throw new Error(`${name} is required.`);
}

const headResult = spawnSync("git", ["rev-parse", "HEAD"], {
  cwd: ROOT,
  encoding: "utf8",
  stdio: ["ignore", "pipe", "pipe"],
  shell: false
});
if (headResult.error || headResult.status !== 0) {
  throw new Error("The checked-out release SHA could not be resolved.");
}

const evidence = await verifyDirectProductionReleaseEvidence({
  releaseSha: values.get("--release-sha"),
  ciRunId: values.get("--ci-run-id"),
  rollbackSha: values.get("--rollback-sha"),
  target: values.get("--target"),
  headSha: String(headResult.stdout || "").trim(),
  deploymentRunId: process.env.GITHUB_RUN_ID,
  token: process.env.GITHUB_TOKEN || process.env.GH_TOKEN,
  approvalMode: process.env.RELEASE_APPROVAL_MODE,
  soloOperatorIds: process.env.RELEASE_SOLO_OPERATOR_IDS,
  root: ROOT
});

process.stdout.write(
  `Direct production evidence verified for ${evidence.target} at ${evidence.releaseSha}.\n`
);
