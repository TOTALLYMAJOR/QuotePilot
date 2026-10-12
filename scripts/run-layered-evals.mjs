#!/usr/bin/env node

import { spawnSync } from "node:child_process";
import fs from "node:fs";
import path from "node:path";
import { pathToFileURL } from "node:url";
import {
  buildEvaluationReceipt,
  validateGovernedReferences,
  validateManifest
} from "./layered-eval-core.mjs";

const MANIFEST_PATH = "docs/product-intelligence/evaluation-manifest.json";
const DEFAULT_OUTPUT_DIR = ".cache/layered-evaluations";
const ENVIRONMENTS = new Set(["local", "ci"]);
const DEFINITION_FILES = Object.freeze({
  capabilityIds: ["docs/product-intelligence/CAPABILITY_MAP.md", /\bCAP-\d{2,3}\b/g],
  journeyIds: ["docs/product-intelligence/USER_JOURNEY_FUNNELS.md", /\bJRN-\d{2,3}\b/g],
  metricIds: ["docs/product-intelligence/SUCCESS_METRICS.md", /\bMET-\d{2,3}\b/g],
  guardrailIds: ["docs/product-intelligence/QUALITY_GUARDRAILS.md", /\bGRD-\d{2,3}\b/g]
});

function parseArgs(argv) {
  const parsed = {
    dryRun: false,
    environment: process.env.CI ? "ci" : "local",
    outputDir: DEFAULT_OUTPUT_DIR,
    evaluationIds: []
  };
  for (let index = 0; index < argv.length; index += 1) {
    const token = argv[index];
    if (token === "--dry-run") parsed.dryRun = true;
    else if (["--environment", "--output-dir", "--eval"].includes(token)) {
      const value = argv[index + 1];
      if (!value || value.startsWith("--")) throw new Error(`${token} requires a value.`);
      index += 1;
      if (token === "--environment") parsed.environment = value;
      else if (token === "--output-dir") parsed.outputDir = value;
      else parsed.evaluationIds.push(value);
    } else throw new Error(`Unknown argument: ${token}`);
  }
  if (!ENVIRONMENTS.has(parsed.environment)) throw new Error(`Unsupported environment: ${parsed.environment}`);
  return parsed;
}

function git(root, args) {
  const result = spawnSync("git", args, { cwd: root, encoding: "utf8" });
  return result.status === 0 ? result.stdout.trim() : "";
}

function candidate(root) {
  const sha = git(root, ["rev-parse", "HEAD"]);
  if (!/^[0-9a-f]{40}$/.test(sha)) throw new Error("Unable to resolve candidate SHA.");
  return {
    sha,
    branch: git(root, ["branch", "--show-current"]) || "detached",
    dirty: Boolean(git(root, ["status", "--short"]))
  };
}

function governedDefinitions(root) {
  return Object.fromEntries(Object.entries(DEFINITION_FILES).map(([key, [relativePath, pattern]]) => {
    const text = fs.readFileSync(path.join(root, relativePath), "utf8");
    return [key, new Set(text.match(pattern) || [])];
  }));
}

function loadManifest(root) {
  const manifest = validateManifest(JSON.parse(fs.readFileSync(path.join(root, MANIFEST_PATH), "utf8")));
  return validateGovernedReferences(manifest, governedDefinitions(root));
}

function runCheck(root, check) {
  const startedAt = Date.now();
  const [command, ...args] = check.command;
  const run = spawnSync(command, args, {
    cwd: root,
    encoding: "utf8",
    stdio: ["ignore", "pipe", "pipe"],
    timeout: 20 * 60 * 1000
  });
  return {
    id: check.id,
    command: check.command,
    status: run.status === 0 ? "passed" : "failed",
    exitCode: Number.isInteger(run.status) ? run.status : 1,
    durationMs: Date.now() - startedAt
  };
}

function selectEvaluations(manifest, ids) {
  if (!ids.length) return manifest.evaluations;
  const wanted = new Set(ids);
  const selected = manifest.evaluations.filter((evaluation) => wanted.has(evaluation.id));
  const missing = ids.filter((id) => !selected.some((evaluation) => evaluation.id === id));
  if (missing.length) throw new Error(`Unknown evaluation id: ${missing.join(", ")}`);
  return selected;
}

function receiptPath(outputDir, receipt) {
  const stamp = receipt.recordedAt.replace(/[-:]/g, "").replace(/\.\d{3}Z$/, "Z");
  return path.join(outputDir, `${stamp}--${receipt.candidate.sha.slice(0, 12)}.json`);
}

export function createDryRunReceipt({ root = process.cwd(), environment = "local", evaluationIds = [] } = {}) {
  if (!ENVIRONMENTS.has(environment)) throw new Error(`Unsupported environment: ${environment}`);
  const manifest = loadManifest(root);
  const evaluations = selectEvaluations(manifest, evaluationIds);
  return buildEvaluationReceipt({
    manifest: { ...manifest, evaluations },
    candidate: candidate(root),
    environment,
    recordedAt: new Date().toISOString(),
    results: evaluations.map((evaluation) => ({
      evaluationId: evaluation.id,
      status: "not_run",
      checks: []
    }))
  });
}

function main() {
  const root = process.cwd();
  const args = parseArgs(process.argv.slice(2));
  if (args.dryRun) {
    process.stdout.write(`${JSON.stringify(createDryRunReceipt({
      root,
      environment: args.environment,
      evaluationIds: args.evaluationIds
    }), null, 2)}\n`);
    return;
  }
  const manifest = loadManifest(root);
  const evaluations = selectEvaluations(manifest, args.evaluationIds);
  const results = evaluations.map((evaluation) => {
    if (evaluation.execution === "manual") {
      return { evaluationId: evaluation.id, status: "not_run", checks: [] };
    }
    const checks = evaluation.checks.map((check) => runCheck(root, check));
    return {
      evaluationId: evaluation.id,
      status: checks.every((check) => check.status === "passed") ? "passed" : "failed",
      checks
    };
  });
  const receipt = buildEvaluationReceipt({
    manifest: { ...manifest, evaluations },
    candidate: candidate(root),
    environment: args.environment,
    recordedAt: new Date().toISOString(),
    results
  });
  const serialized = `${JSON.stringify(receipt, null, 2)}\n`;
  const outputDir = path.resolve(root, args.outputDir);
  fs.mkdirSync(outputDir, { recursive: true });
  const outputPath = receiptPath(outputDir, receipt);
  fs.writeFileSync(outputPath, serialized, { flag: "wx" });
  console.log(path.relative(root, outputPath));
  if (receipt.blockingDimensions.some((result) => result.status === "failed")) process.exitCode = 1;
}

if (process.argv[1] && pathToFileURL(path.resolve(process.argv[1])).href === import.meta.url) {
  try {
    main();
  } catch (error) {
    console.error(`Layered evaluation failed: ${error.message}`);
    process.exit(1);
  }
}
