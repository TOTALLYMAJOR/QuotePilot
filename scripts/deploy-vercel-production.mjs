#!/usr/bin/env node

import fs from "node:fs";
import path from "node:path";
import { spawnSync } from "node:child_process";
import { fileURLToPath, pathToFileURL } from "node:url";
import {
  validateProductionReleaseProfileTarget,
  verifyDirectProductionReleaseEvidence
} from "./production-release-evidence.mjs";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const CONFIRMATION = "DEPLOY quotepilot.mbmapps.com via vercel";
const PRODUCTION_DOMAIN = "quotepilot.mbmapps.com";
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
  const allowed = new Set([
    "--confirm",
    "--release-sha",
    "--ci-run-id",
    "--rollback-sha",
    "--release-profile"
  ]);
  const args = process.argv.slice(2);
  const seen = new Set();
  for (let index = 0; index < args.length; index += 2) {
    const name = args[index];
    const value = args[index + 1];
    if (!allowed.has(name)) throw new Error(`Unknown argument: ${name || "<blank>"}`);
    if (seen.has(name)) throw new Error(`Duplicate argument: ${name}`);
    if (!value || String(value).startsWith("--")) throw new Error(`${name} requires a value.`);
    seen.add(name);
  }
  if (seen.size !== allowed.size) {
    throw new Error("Vercel deployment requires confirmation, release SHA, CI run, rollback SHA, and release profile.");
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
  const result = spawnSync(command, args, { cwd: ROOT, stdio: "inherit", shell: false });
  if (result.error) throw result.error;
  if (result.status !== 0) process.exit(result.status || 1);
}

export function validateProductionBrowserEnvironment(environment, releaseProfileValue) {
  const releaseProfile = validateProductionReleaseProfileTarget(
    releaseProfileValue,
    "vercel"
  );
  const allQualified = releaseProfile === "all-qualified-features";
  const expected = {
    VITE_INQUIRY_SHOWCASE_ENABLED: allQualified ? "true" : "false",
    VITE_INQUIRY_TURNSTILE_SITE_KEY: allQualified
      ? String(environment.VITE_INQUIRY_TURNSTILE_SITE_KEY || "").trim()
      : "",
    VITE_PILOT_MODEL_ENABLED: allQualified ? "true" : "false",
    ...(allQualified
      ? { VITE_DEFAULT_ORGANIZATION_ID: "mm05366-sandbox" }
      : {})
  };
  for (const [name, value] of Object.entries(expected)) {
    if (String(environment[name] || "").trim() !== value) {
      throw new Error(`${name} must be explicitly ${value || "empty"} for ${releaseProfile}.`);
    }
  }
  if (
    allQualified
    && (
      !/^[A-Za-z0-9_-]{10,100}$/.test(expected.VITE_INQUIRY_TURNSTILE_SITE_KEY)
      || /(?:placeholder|example|changeme|test[_-]?key)/i.test(
        expected.VITE_INQUIRY_TURNSTILE_SITE_KEY
      )
    )
  ) {
    throw new Error(
      "VITE_INQUIRY_TURNSTILE_SITE_KEY must be a reviewed non-placeholder production site key."
    );
  }
  for (const forbidden of [
    "VITE_INQUIRY_TURNSTILE_SECRET",
    "VITE_INQUIRY_RATE_LIMIT_SECRET",
    "VITE_INTENT_PARSER_OPENAI_KEY"
  ]) {
    if (String(environment[forbidden] || "").trim()) {
      throw new Error(`${forbidden} is forbidden from browser-visible production configuration.`);
    }
  }
  return Object.freeze({ releaseProfile, ...expected });
}

function deployAndBindProductionDomain(headSha, releaseProfile) {
  const output = capture("npx", [
    "--yes",
    "vercel@57.0.0",
    "deploy",
    "--prebuilt",
    "--prod",
    "--yes",
    "--meta",
    `releaseSha=${headSha}`,
    "--meta",
    `releaseProfile=${releaseProfile}`,
    "--token",
    process.env.VERCEL_TOKEN
  ]);
  const deploymentUrl = output
    .split(/\r?\n/)
    .map((line) => line.trim())
    .reverse()
    .find((line) => /^https:\/\//i.test(line)) || "";
  let parsedUrl;
  try {
    parsedUrl = new URL(deploymentUrl);
  } catch {
    throw new Error("Vercel deployment did not return a valid deployment URL.");
  }
  if (
    parsedUrl.protocol !== "https:"
    || parsedUrl.pathname !== "/"
    || !/^quoteflow-[a-z0-9-]+-mbmapps\.vercel\.app$/i.test(parsedUrl.hostname)
  ) {
    throw new Error("Vercel deployment returned an unexpected deployment URL.");
  }
  process.stdout.write(`${output}\n`);
  run("npx", [
    "--yes",
    "vercel@57.0.0",
    "alias",
    "set",
    deploymentUrl,
    PRODUCTION_DOMAIN,
    "--token",
    process.env.VERCEL_TOKEN
  ]);
}

function validateWorkflowContext() {
  if (
    process.env.GITHUB_ACTIONS !== "true"
    || process.env.GITHUB_EVENT_NAME !== "workflow_dispatch"
    || process.env.GITHUB_REF !== "refs/heads/main"
  ) {
    throw new Error("Vercel production deployment requires a main-branch manual GitHub workflow.");
  }
  const head = capture("git", ["rev-parse", "HEAD"]);
  if (String(process.env.GITHUB_SHA || "").toLowerCase() !== head.toLowerCase()) {
    throw new Error("Vercel production deployment refused because GITHUB_SHA does not match HEAD.");
  }
  return head;
}

function validateVercelProjectLink() {
  const linkPath = path.join(ROOT, ".vercel", "project.json");
  let linkedProject;
  try {
    linkedProject = JSON.parse(fs.readFileSync(linkPath, "utf8"));
  } catch {
    throw new Error("Vercel production deployment requires the approved project link.");
  }
  const mismatches = Object.entries(EXPECTED_VERCEL_LINK)
    .filter(([key, expected]) => String(linkedProject?.[key] || "") !== expected)
    .map(([key]) => key);
  if (mismatches.length) {
    throw new Error(`Vercel production deployment refused for mismatched ${mismatches.join(", ")}.`);
  }
}

async function verify(headSha) {
  return verifyDirectProductionReleaseEvidence({
    releaseSha: readArg("--release-sha"),
    ciRunId: readArg("--ci-run-id"),
    rollbackSha: readArg("--rollback-sha"),
    target: "vercel",
    headSha,
    deploymentRunId: process.env.GITHUB_RUN_ID,
    token: process.env.GITHUB_TOKEN || process.env.GH_TOKEN,
    approvalMode: process.env.RELEASE_APPROVAL_MODE,
    releaseProfile: readArg("--release-profile"),
    soloOperatorIds: process.env.RELEASE_SOLO_OPERATOR_IDS,
    root: ROOT
  });
}

export async function main() {
  validateArgs();
  const releaseProfile = validateProductionReleaseProfileTarget(
    readArg("--release-profile"),
    "vercel"
  );
  if (readArg("--confirm") !== CONFIRMATION) {
    throw new Error(`Vercel production deployment requires --confirm "${CONFIRMATION}".`);
  }
  if (!String(process.env.VERCEL_TOKEN || "").trim()) {
    throw new Error("Vercel production deployment requires VERCEL_TOKEN.");
  }
  validateVercelProjectLink();
  const headSha = validateWorkflowContext();
  await verify(headSha);
  validateProductionBrowserEnvironment(process.env, releaseProfile);
  run("npm", ["run", "check:env"]);
  run("npx", [
    "--yes",
    "vercel@57.0.0",
    "pull",
    "--yes",
    "--environment=production",
    "--token",
    process.env.VERCEL_TOKEN
  ]);
  validateVercelProjectLink();
  await verify(validateWorkflowContext());
  validateProductionBrowserEnvironment(process.env, releaseProfile);
  run("npm", ["run", "check:env"]);
  run("npx", ["--yes", "vercel@57.0.0", "build", "--prod", "--token", process.env.VERCEL_TOKEN]);
  await verify(validateWorkflowContext());
  deployAndBindProductionDomain(headSha, releaseProfile);
}

if (
  process.argv[1]
  && pathToFileURL(path.resolve(process.argv[1])).href === import.meta.url
) {
  main().catch((error) => {
    console.error(error?.message || error);
    process.exit(1);
  });
}
