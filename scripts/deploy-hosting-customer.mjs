#!/usr/bin/env node
import { spawnSync } from "node:child_process";

function printUsage() {
  console.log(
    'Usage: npm run deploy:firebase:hosting:customer -- --site <siteId> --project <projectId> --confirm "DEPLOY <projectId> hosting:<siteId>"'
  );
}

function parseArgs(argv) {
  const args = { site: "", project: "", confirm: "" };
  for (let i = 0; i < argv.length; i += 1) {
    const token = argv[i];
    if (token === "--site") {
      args.site = String(argv[i + 1] || "").trim();
      i += 1;
      continue;
    }
    if (token === "--project") {
      args.project = String(argv[i + 1] || "").trim();
      i += 1;
      continue;
    }
    if (token === "--confirm") {
      args.confirm = String(argv[i + 1] || "").trim();
      i += 1;
      continue;
    }
    throw new Error(`Unknown argument: ${token}`);
  }
  return args;
}

function bin(name) {
  if (process.platform === "win32") return `${name}.cmd`;
  return name;
}

function run(cmd, args) {
  const result = spawnSync(cmd, args, {
    stdio: "inherit",
    shell: false
  });
  if (result.error) throw result.error;
  if (result.status !== 0) {
    process.exit(result.status || 1);
  }
}

function capture(cmd, args) {
  const result = spawnSync(cmd, args, {
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

function validatePublishedReleaseRevision() {
  if (capture("git", ["status", "--porcelain"])) {
    throw new Error("Refusing customer Hosting deployment from a dirty working tree.");
  }
  if (capture("git", ["branch", "--show-current"]) !== "main") {
    throw new Error("Refusing customer Hosting deployment from anything other than main.");
  }
  const head = capture("git", ["rev-parse", "HEAD"]);
  if (head !== capture("git", ["rev-parse", "@{upstream}"])) {
    throw new Error("Refusing customer Hosting deployment until HEAD matches its upstream.");
  }
  const remoteHead = capture(
    "git",
    ["ls-remote", "--heads", "origin", "refs/heads/main"]
  ).split(/\s+/)[0] || "";
  if (!remoteHead || head !== remoteHead) {
    throw new Error("Refusing customer Hosting deployment until HEAD matches origin/main.");
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
      "Refusing customer Hosting deployment until HEAD has a semantic release tag published to origin."
    );
  }
}

const parsed = parseArgs(process.argv.slice(2));
if (
  !/^[a-z0-9][a-z0-9-]{2,58}[a-z0-9]$/.test(parsed.site)
  || parsed.project !== "tonicatering"
  || parsed.site === parsed.project
) {
  printUsage();
  process.exit(1);
}

const expectedConfirmation = `DEPLOY ${parsed.project} hosting:${parsed.site}`;
if (parsed.confirm !== expectedConfirmation) {
  throw new Error(`Customer Hosting deployment requires --confirm "${expectedConfirmation}".`);
}
const projectArgs = ["--project", parsed.project];

validatePublishedReleaseRevision();
run(bin("npm"), ["run", "check:env"]);
run(bin("npm"), ["run", "build"]);
run(bin("npx"), [
  "firebase-tools",
  "target:apply",
  "hosting",
  "customer",
  parsed.site,
  ...projectArgs
]);

run(bin("npx"), [
  "firebase-tools",
  "deploy",
  "--only",
  "hosting:customer",
  ...projectArgs,
  "--non-interactive"
]);
