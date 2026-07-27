#!/usr/bin/env node

import fs from "node:fs";
import path from "node:path";
import { spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";

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
  if (
    args.length !== 2
    || args[0] !== "--confirm"
    || !args[1]
    || args[1].startsWith("--")
  ) {
    throw new Error(`Vercel production deployment requires --confirm "${CONFIRMATION}".`);
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
  if (capture("git", ["branch", "--show-current"]) !== "main") {
    throw new Error("Refusing Vercel production deployment from anything other than main.");
  }
  const head = capture("git", ["rev-parse", "HEAD"]);
  if (head !== capture("git", ["rev-parse", "@{upstream}"])) {
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
}

validateArgs();
if (readArg("--confirm") !== CONFIRMATION) {
  throw new Error(`Vercel production deployment requires --confirm "${CONFIRMATION}".`);
}
validateVercelProjectLink();
validatePublishedReleaseRevision();
run("npm", ["run", "check:env"]);
run("npx", ["vercel", "build", "--prod"]);
run("npx", ["vercel", "deploy", "--prebuilt", "--prod", "--yes"]);
