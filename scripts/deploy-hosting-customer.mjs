#!/usr/bin/env node
import { spawnSync } from "node:child_process";

function printUsage() {
  console.log("Usage: npm run deploy:firebase:hosting:customer -- --site <siteId> [--project <projectId>] [--skip-build]");
}

function parseArgs(argv) {
  const args = { site: "", project: "", skipBuild: false };
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
    if (token === "--skip-build") {
      args.skipBuild = true;
      continue;
    }
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

const parsed = parseArgs(process.argv.slice(2));
if (!parsed.site) {
  printUsage();
  process.exit(1);
}

const projectArgs = parsed.project ? ["--project", parsed.project] : [];

if (!parsed.skipBuild) {
  run(bin("npm"), ["run", "build"]);
}

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
  ...projectArgs
]);

