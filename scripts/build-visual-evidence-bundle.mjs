#!/usr/bin/env node
import fs from "node:fs";
import path from "node:path";
import { execFileSync } from "node:child_process";
import { createHash } from "node:crypto";
import { pathToFileURL } from "node:url";

const digest = (bytes) => createHash("sha256").update(bytes).digest("hex");

function generatedPath(root, relative) {
  if (!/^(?:\.cache|output|test-results)\/.+/.test(relative)
    || relative.split(/[\\/]/).some((part) => ["..", ".", ""].includes(part))) {
    throw new Error(`Expected a repository-relative generated path: ${relative}`);
  }
  const absolute = path.resolve(root, relative);
  for (let current = absolute; current !== root; current = path.dirname(current)) {
    if (fs.existsSync(current) && fs.lstatSync(current).isSymbolicLink()) throw new Error(`Refusing symlink: ${relative}`);
  }
  return absolute;
}

export function buildVisualEvidenceBundle({
  repositoryRoot = process.cwd(),
  captureRoot = ".cache/playwright-evidence/captures",
  playwrightJson = ".cache/playwright-evidence/results.json",
  outputRoot = ".cache/visual-evidence",
  env = process.env
} = {}) {
  const root = fs.realpathSync(repositoryRoot);
  const git = (...args) => execFileSync("git", args, { cwd: root, encoding: "utf8", stdio: ["ignore", "pipe", "pipe"] }).trim();
  const checkoutSha = git("rev-parse", "HEAD");
  if (!/^[a-f0-9]{40}$/.test(checkoutSha) || (env.GITHUB_SHA && env.GITHUB_SHA !== checkoutSha)) {
    throw new Error("Evidence SHA does not match checkout SHA");
  }
  if (git("status", "--porcelain", "--untracked-files=normal")) throw new Error("Exact-SHA evidence requires a clean checkout");
  const output = generatedPath(root, outputRoot);
  const capturesRoot = generatedPath(root, captureRoot);
  const reportPath = generatedPath(root, playwrightJson);
  if (fs.existsSync(output)) throw new Error("Evidence output already exists; choose a new output path");
  const reportBytes = fs.readFileSync(reportPath);
  const report = JSON.parse(reportBytes);
  const stats = report.stats;
  if (!stats || !Number.isInteger(stats.expected) || stats.expected <= 0
    || [stats.skipped, stats.unexpected, stats.flaky].some((count) => count !== 0)
    || !Array.isArray(report.errors) || report.errors.length
    || !Number.isFinite(Date.parse(stats.startTime)) || !Number.isFinite(stats.duration) || stats.duration <= 0) {
    throw new Error("Visual evidence requires a successful complete Playwright cohort with no skips, flakes or errors");
  }
  const started = Date.parse(stats.startTime);
  const finished = started + stats.duration;
  const images = [];
  function walk(directory) {
    for (const entry of fs.readdirSync(directory, { withFileTypes: true })) {
      const file = path.join(directory, entry.name);
      if (entry.isSymbolicLink()) throw new Error("Refusing capture symlink");
      if (entry.isDirectory()) walk(file);
      else if (entry.isFile() && path.extname(file).toLowerCase() === ".png") {
        const stat = fs.statSync(file);
        if (stat.mtimeMs < started || stat.mtimeMs > finished + 1000) throw new Error("Screenshot was captured outside the report run");
        const bytes = fs.readFileSync(file);
        if (!bytes.subarray(0, 8).equals(Buffer.from("89504e470d0a1a0a", "hex"))) throw new Error("Invalid PNG capture");
        images.push({ file, bytes });
      }
    }
  }
  walk(capturesRoot);
  if (!images.length) throw new Error("No screenshot evidence found");
  images.sort((a, b) => a.file.localeCompare(b.file));
  const captures = images.map(({ file, bytes }) => {
    const relative = path.relative(capturesRoot, file).replaceAll("\\", "/");
    return {
      sourcePath: path.relative(root, file).replaceAll("\\", "/"),
      bundledPath: `captures/${relative}`,
      stage: relative.match(/(?:^|[/_.-])(before|after|current)(?=[/_.-]|$)/i)?.[1].toLowerCase() || "proof",
      bytes: bytes.length,
      sha256: digest(bytes)
    };
  });
  const manifest = {
    schemaVersion: "quotepilot-visual-evidence-v1",
    evidenceClass: env.GITHUB_ACTIONS === "true" ? "ci" : "local",
    recordedAt: new Date().toISOString(),
    checkoutSha,
    workflowSha: env.GITHUB_SHA || null,
    pullRequestHeadSha: env.VISUAL_EVIDENCE_PR_HEAD_SHA || null,
    pullRequestBaseSha: env.VISUAL_EVIDENCE_PR_BASE_SHA || null,
    repository: env.GITHUB_REPOSITORY || null,
    runId: env.GITHUB_RUN_ID || null,
    runAttempt: env.GITHUB_RUN_ATTEMPT || null,
    screenshotCount: captures.length,
    captures,
    playwright: { reportPath: "playwright-results.json", sha256: digest(reportBytes), stats },
    boundary: {
      proves: "Retained image and reporter bytes from the named clean checkout and synthetic browser cohort.",
      doesNotProve: ["hosted deployment", "provider acceptance", "production behavior", "human visual acceptance", "product outcomes"]
    }
  };
  // Validate everything before writing. Never remove or replace prior evidence.
  fs.mkdirSync(path.dirname(output), { recursive: true });
  fs.mkdirSync(output);
  for (let index = 0; index < captures.length; index += 1) {
    const destination = path.join(output, captures[index].bundledPath);
    fs.mkdirSync(path.dirname(destination), { recursive: true });
    fs.writeFileSync(destination, images[index].bytes, { flag: "wx" });
  }
  fs.writeFileSync(path.join(output, "playwright-results.json"), reportBytes, { flag: "wx" });
  const manifestBytes = `${JSON.stringify(manifest, null, 2)}\n`;
  fs.writeFileSync(path.join(output, "manifest.json"), manifestBytes, { flag: "wx" });
  fs.writeFileSync(path.join(output, "manifest.sha256"), `${digest(manifestBytes)}  manifest.json\n`, { flag: "wx" });
  return { output, manifest };
}

if (process.argv[1] && pathToFileURL(path.resolve(process.argv[1])).href === import.meta.url) {
  if (process.argv.length > 2) throw new Error("This cohort command takes no arguments; use the exported function for isolated fixture tests");
  const result = buildVisualEvidenceBundle();
  console.log(`Retained ${result.manifest.screenshotCount} screenshots for ${result.manifest.checkoutSha}: ${result.output}`);
}
