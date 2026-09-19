#!/usr/bin/env node

import crypto from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import { execFileSync } from "node:child_process";
import { pathToFileURL } from "node:url";

const IMAGE_EXTENSIONS = new Set([".png", ".jpg", ".jpeg", ".webp"]);
const DEFAULT_SOURCE_ROOTS = ["output/playwright", "test-results"];
const DEFAULT_OUTPUT_ROOT = ".cache/visual-evidence";

function parseArgs(argv) {
  const options = {
    sourceRoots: [],
    validations: [],
    playwrightJson: null,
    outputRoot: DEFAULT_OUTPUT_ROOT,
    requireScreenshots: false,
    repositoryRoot: process.cwd()
  };

  for (let index = 0; index < argv.length; index += 1) {
    const arg = argv[index];
    const value = argv[index + 1];
    if (arg === "--source-root") {
      if (!value) throw new Error("--source-root requires a value");
      options.sourceRoots.push(value);
      index += 1;
    } else if (arg === "--out") {
      if (!value) throw new Error("--out requires a value");
      options.outputRoot = value;
      index += 1;
    } else if (arg === "--validation") {
      if (!value) throw new Error("--validation requires a value");
      options.validations.push(value);
      index += 1;
    } else if (arg === "--playwright-json") {
      if (!value) throw new Error("--playwright-json requires a value");
      options.playwrightJson = value;
      index += 1;
    } else if (arg === "--require-screenshots") {
      options.requireScreenshots = true;
    } else if (arg === "--root") {
      if (!value) throw new Error("--root requires a value");
      options.repositoryRoot = value;
      index += 1;
    } else {
      throw new Error(`Unknown argument: ${arg}`);
    }
  }

  if (options.sourceRoots.length === 0) options.sourceRoots = [...DEFAULT_SOURCE_ROOTS];
  return options;
}

function sha256File(filePath) {
  const hash = crypto.createHash("sha256");
  hash.update(fs.readFileSync(filePath));
  return hash.digest("hex");
}

function resolveGitSha(repositoryRoot) {
  try {
    return execFileSync("git", ["rev-parse", "HEAD"], {
      cwd: repositoryRoot,
      encoding: "utf8",
      stdio: ["ignore", "pipe", "ignore"]
    }).trim();
  } catch {
    return null;
  }
}

function walkImages(rootPath) {
  if (!fs.existsSync(rootPath)) return [];
  const stack = [rootPath];
  const files = [];

  while (stack.length > 0) {
    const current = stack.pop();
    for (const entry of fs.readdirSync(current, { withFileTypes: true })) {
      const absolutePath = path.join(current, entry.name);
      if (entry.isDirectory()) {
        stack.push(absolutePath);
      } else if (entry.isFile() && IMAGE_EXTENSIONS.has(path.extname(entry.name).toLowerCase())) {
        files.push(absolutePath);
      }
    }
  }

  return files.sort((left, right) => left.localeCompare(right));
}

function captureStage(relativePath) {
  const normalized = relativePath.toLowerCase().replaceAll("\\", "/");
  if (/(^|[\/_-])before([\/_.-]|$)/.test(normalized)) return "before";
  if (/(^|[\/_-])after([\/_.-]|$)/.test(normalized)) return "after";
  if (/(^|[\/_-])current([\/_.-]|$)/.test(normalized)) return "current";
  return "proof";
}

function parseValidation(value) {
  const parts = value.split("::");
  if (parts.length !== 3 || parts.some((part) => part.trim() === "")) {
    throw new Error("--validation must use label::command::status");
  }
  return {
    label: parts[0].trim(),
    command: parts[1].trim(),
    status: parts[2].trim()
  };
}

function safeSourceKey(sourceRoot) {
  return sourceRoot
    .replaceAll("\\", "/")
    .replace(/^\.\//, "")
    .replace(/[^a-zA-Z0-9._/-]+/g, "-")
    .replaceAll("/", "__");
}

export function buildVisualEvidenceBundle({
  repositoryRoot = process.cwd(),
  sourceRoots = DEFAULT_SOURCE_ROOTS,
  outputRoot = DEFAULT_OUTPUT_ROOT,
  validations = [],
  playwrightJson = null,
  requireScreenshots = false,
  env = process.env,
  now = new Date()
} = {}) {
  const root = path.resolve(repositoryRoot);
  const output = path.resolve(root, outputRoot);
  fs.rmSync(output, { recursive: true, force: true });
  fs.mkdirSync(output, { recursive: true });

  const gitSha = resolveGitSha(root);
  const workflowSha = env.GITHUB_SHA || null;
  if (env.GITHUB_ACTIONS === "true" && !gitSha) {
    throw new Error("CI visual evidence requires a resolvable Git checkout SHA");
  }
  const requestedEvidenceSha = env.VISUAL_EVIDENCE_SHA || workflowSha || null;
  if (requestedEvidenceSha && gitSha && requestedEvidenceSha !== gitSha) {
    throw new Error(`Evidence SHA ${requestedEvidenceSha} does not match checkout SHA ${gitSha}`);
  }
  const evidenceSha = requestedEvidenceSha || gitSha || "unknown";
  const captures = [];

  for (const configuredSourceRoot of sourceRoots) {
    const absoluteSourceRoot = path.resolve(root, configuredSourceRoot);
    const sourceKey = safeSourceKey(configuredSourceRoot);
    for (const absoluteFile of walkImages(absoluteSourceRoot)) {
      const relativeToSource = path.relative(absoluteSourceRoot, absoluteFile);
      const repositoryRelative = path.relative(root, absoluteFile).replaceAll("\\", "/");
      const bundledRelative = path.join("captures", sourceKey, relativeToSource).replaceAll("\\", "/");
      const bundledAbsolute = path.join(output, bundledRelative);
      fs.mkdirSync(path.dirname(bundledAbsolute), { recursive: true });
      fs.copyFileSync(absoluteFile, bundledAbsolute);
      const stat = fs.statSync(absoluteFile);
      captures.push({
        sourcePath: repositoryRelative,
        bundledPath: bundledRelative,
        stage: captureStage(repositoryRelative),
        bytes: stat.size,
        sha256: sha256File(absoluteFile)
      });
    }
  }

  captures.sort((left, right) => left.sourcePath.localeCompare(right.sourcePath));
  if (requireScreenshots && captures.length === 0) {
    throw new Error(`No screenshot evidence found under: ${sourceRoots.join(", ")}`);
  }

  let playwright = null;
  if (playwrightJson) {
    const reportAbsolute = path.resolve(root, playwrightJson);
    if (!fs.existsSync(reportAbsolute)) {
      throw new Error(`Playwright JSON report not found: ${playwrightJson}`);
    }
    const reportBody = fs.readFileSync(reportAbsolute);
    const report = JSON.parse(reportBody.toString("utf8"));
    const reportRelative = path.join("attachments", "playwright-results.json").replaceAll("\\", "/");
    fs.mkdirSync(path.dirname(path.join(output, reportRelative)), { recursive: true });
    fs.writeFileSync(path.join(output, reportRelative), reportBody);
    playwright = {
      reportPath: reportRelative,
      sha256: crypto.createHash("sha256").update(reportBody).digest("hex"),
      stats: report.stats || null
    };
  }

  const manifest = {
    schemaVersion: "quotepilot-visual-evidence-v1",
    evidenceClass: env.GITHUB_ACTIONS === "true" ? "ci" : "local",
    recordedAt: now.toISOString(),
    repository: env.GITHUB_REPOSITORY || null,
    workflow: env.GITHUB_WORKFLOW || null,
    eventName: env.GITHUB_EVENT_NAME || null,
    ref: env.GITHUB_REF || null,
    runId: env.GITHUB_RUN_ID || null,
    runAttempt: env.GITHUB_RUN_ATTEMPT || null,
    evidenceSha,
    checkoutSha: gitSha,
    workflowSha,
    pullRequestHeadSha: env.VISUAL_EVIDENCE_PR_HEAD_SHA || null,
    pullRequestBaseSha: env.VISUAL_EVIDENCE_PR_BASE_SHA || null,
    sourceRoots: [...sourceRoots],
    validations: validations.map((value) => typeof value === "string" ? parseValidation(value) : value),
    playwright,
    screenshotCount: captures.length,
    totalBytes: captures.reduce((sum, capture) => sum + capture.bytes, 0),
    captures,
    boundary: {
      proves: "These image bytes were retained from the recorded CI checkout and validation run.",
      doesNotProve: [
        "hosted deployment behavior",
        "provider acceptance",
        "production data or production writes",
        "human visual acceptance",
        "product outcome impact"
      ]
    }
  };

  const manifestPath = path.join(output, "manifest.json");
  fs.writeFileSync(manifestPath, `${JSON.stringify(manifest, null, 2)}\n`);
  const manifestSha256 = sha256File(manifestPath);
  fs.writeFileSync(path.join(output, "manifest.sha256"), `${manifestSha256}  manifest.json\n`);
  fs.writeFileSync(
    path.join(output, "README.md"),
    [
      "# QuotePilot Visual Evidence Bundle",
      "",
      `Evidence SHA: \`${evidenceSha}\``,
      `Captured screenshots: **${captures.length}**`,
      "",
      "This bundle is CI evidence for the recorded checkout only. It does not establish hosted, provider, production, human-acceptance, or outcome evidence.",
      "",
      "See `manifest.json` for source paths, SHA-256 digests, byte sizes, run identity, and validation commands.",
      ""
    ].join("\n")
  );

  return { output, manifest, manifestSha256 };
}

function main() {
  const options = parseArgs(process.argv.slice(2));
  const result = buildVisualEvidenceBundle({
    repositoryRoot: options.repositoryRoot,
    sourceRoots: options.sourceRoots,
    outputRoot: options.outputRoot,
    validations: options.validations,
    playwrightJson: options.playwrightJson,
    requireScreenshots: options.requireScreenshots
  });
  process.stdout.write(
    `Visual evidence bundle: ${result.manifest.screenshotCount} screenshots, SHA ${result.manifest.evidenceSha}, manifest ${result.manifestSha256}\n`
  );
}

const invokedPath = process.argv[1] ? pathToFileURL(path.resolve(process.argv[1])).href : null;
if (invokedPath && import.meta.url === invokedPath) main();
