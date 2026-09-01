#!/usr/bin/env node

import { execFileSync } from "node:child_process";
import fs from "node:fs";
import path from "node:path";
import { pathToFileURL } from "node:url";
import {
  EVIDENCE_CLASSES,
  buildSummary as buildEvidenceSummary,
  readRecords as readEvidenceRecords
} from "./summarize-development-evidence.mjs";

export const PRODUCT_TRUTH_SCHEMA = "com.mbmapps.quotepilot.product-truth-digest/v1";
export const PRODUCT_TRUTH_STATUSES = Object.freeze([
  "verified",
  "attention",
  "drift",
  "unknown"
]);

const REQUIRED_FILES = Object.freeze([
  "PROJECT_STATUS.md",
  "docs/FEATURE_MATRIX.md",
  "docs/capability-surfacing-contracts.json"
]);
const PRODUCTION_ENDPOINTS = Object.freeze([
  { id: "vercel-edge", url: "https://quotepilot.mbmapps.com/" },
  { id: "firebase-origin", url: "https://tonicatering.web.app/" }
]);
const SECRET_PATTERNS = Object.freeze([
  /sk-[A-Za-z0-9_-]{20,}/,
  /gh[pousr]_[A-Za-z0-9_]{20,}/,
  /xox[baprs]-[A-Za-z0-9-]{20,}/,
  /-----BEGIN [A-Z ]*PRIVATE KEY-----/,
  /Bearer\s+[A-Za-z0-9._-]{20,}/i,
  /(?:api[_-]?key|secret|token|password)\s*[=:]\s*["']?[^\s,"']{12,}/i
]);
const SEVERITY_ORDER = Object.freeze({ blocking: 0, attention: 1, info: 2, unknown: 3 });

export class ProductTruthInputError extends Error {
  constructor(message, locator) {
    super(message);
    this.name = "ProductTruthInputError";
    this.locator = locator;
  }
}

function runGit(root, args) {
  try {
    return execFileSync("git", args, {
      cwd: root,
      encoding: "utf8",
      stdio: ["ignore", "pipe", "ignore"]
    }).trim();
  } catch {
    return "";
  }
}

function requiredText(root, relativePath) {
  const absolutePath = path.join(root, relativePath);
  if (!fs.existsSync(absolutePath)) {
    throw new ProductTruthInputError(`Required product-truth input is missing: ${relativePath}`, relativePath);
  }
  const stat = fs.statSync(absolutePath);
  if (!stat.isFile() || stat.size > 5_000_000) {
    throw new ProductTruthInputError(`Required product-truth input is not a bounded file: ${relativePath}`, relativePath);
  }
  return fs.readFileSync(absolutePath, "utf8");
}

function requiredJson(root, relativePath) {
  const text = requiredText(root, relativePath);
  try {
    return JSON.parse(text);
  } catch (error) {
    throw new ProductTruthInputError(`Malformed required JSON at ${relativePath}: ${error.message}`, relativePath);
  }
}

function lineLocator(relativePath, lines, index) {
  return `${relativePath}:${Math.max(1, Math.min(lines.length, index + 1))}`;
}

function addClaim(claims, relativePath, lines, index, match, claimType) {
  const version = match?.[1];
  if (!version) return;
  claims.push({
    claimType,
    version,
    evidenceClass: "source",
    sourceLocator: lineLocator(relativePath, lines, index)
  });
}

export function collectProductionClaims({ projectStatusText, featureMatrixText }) {
  const claims = [];
  const statusPath = "PROJECT_STATUS.md";
  const statusLines = projectStatusText.split(/\r?\n/);
  let section = "";
  statusLines.forEach((line, index) => {
    if (/^##\s+/.test(line)) section = line.replace(/^##\s+/, "").trim();
    if (section === "Current Production Release") {
      addClaim(claims, statusPath, statusLines, index, line.match(/(?:tag|deployed exact)\s+`?(v\d+\.\d+\.\d+)`?/i), "current-production-release");
    }
    addClaim(claims, statusPath, statusLines, index, line.match(/Production runtime:\s*`?(v\d+\.\d+\.\d+)`?\s+is live/i), "operational-runtime");
  });

  const matrixPath = "docs/FEATURE_MATRIX.md";
  const matrixLines = featureMatrixText.split(/\r?\n/);
  matrixLines.forEach((line, index) => {
    addClaim(claims, matrixPath, matrixLines, index, line.match(/recorded production is\s+`?(v\d+\.\d+\.\d+)`?/i), "feature-matrix-snapshot");
  });

  const seen = new Set();
  return claims
    .filter((claim) => {
      const key = `${claim.version}|${claim.sourceLocator}`;
      if (seen.has(key)) return false;
      seen.add(key);
      return true;
    })
    .sort((left, right) => left.sourceLocator.localeCompare(right.sourceLocator));
}

export function collectGitState(root, mainRef = "origin/main") {
  const headSha = runGit(root, ["rev-parse", "HEAD"]);
  if (!/^[0-9a-f]{40}$/.test(headSha)) {
    throw new ProductTruthInputError("Repository HEAD could not be resolved.", ".git/HEAD");
  }
  const mainSha = runGit(root, ["rev-parse", mainRef]);
  const divergenceRaw = mainSha
    ? runGit(root, ["rev-list", "--left-right", "--count", `${mainRef}...HEAD`])
    : "";
  const [behindRaw = "0", aheadRaw = "0"] = divergenceRaw.split(/\s+/);
  const behind = Number(behindRaw);
  const ahead = Number(aheadRaw);
  const status = runGit(root, ["status", "--short"]);
  const latestReleaseTag = runGit(root, ["tag", "--list", "v*", "--sort=-v:refname"]).split(/\r?\n/).filter(Boolean)[0] || null;

  return {
    branch: runGit(root, ["branch", "--show-current"]) || "detached",
    headSha,
    dirty: Boolean(status),
    mainRef,
    mainSha: /^[0-9a-f]{40}$/.test(mainSha) ? mainSha : null,
    ahead: Number.isFinite(ahead) ? ahead : 0,
    behind: Number.isFinite(behind) ? behind : 0,
    latestReleaseTag
  };
}

export function collectCapabilityInventory(featureMatrixText, contracts) {
  if (!contracts || typeof contracts !== "object" || Array.isArray(contracts)) {
    throw new ProductTruthInputError("Capability surfacing contracts must be a JSON object.", "docs/capability-surfacing-contracts.json");
  }
  const rows = featureMatrixText.split(/\r?\n/).filter((line) => /^\|\s*\d+\s*\|/.test(line));
  const stages = { deployed: 0, source: 0, partial: 0, other: 0 };
  for (const row of rows) {
    const columns = row.split("|").map((item) => item.trim()).filter(Boolean);
    const status = String(columns[2] || "").toLowerCase();
    if (status.includes("partial")) stages.partial += 1;
    else if (status.includes("source") || status.includes("candidate")) stages.source += 1;
    else if (status.includes("deployed")) stages.deployed += 1;
    else stages.other += 1;
  }
  const contractItems = Array.isArray(contracts.contracts)
    ? contracts.contracts
    : Array.isArray(contracts.capabilities)
      ? contracts.capabilities
      : [];
  return {
    matrixRows: rows.length,
    stages,
    surfacingContracts: contractItems.length,
    sourceLocator: "docs/FEATURE_MATRIX.md"
  };
}

export function collectEvidenceCoverage(root) {
  const dir = path.join(root, ".cache", "development-evidence");
  const { records, invalidRecords } = readEvidenceRecords(dir);
  const summary = buildEvidenceSummary({ dir, records, invalidRecords, limit: 10 });
  const classes = Object.fromEntries(EVIDENCE_CLASSES.map((name) => [name, {
    status: summary.evidenceClassRecords[name] > 0 ? "verified" : "unknown",
    recordCount: summary.evidenceClassRecords[name],
    meaning: summary.evidenceClassRecords[name] > 0 ? "recorded" : "unavailable"
  }]));
  return {
    classes,
    totals: summary.totals,
    sourceLocator: ".cache/development-evidence/"
  };
}

function boundedLines(value, limit = 6) {
  return String(value || "")
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter(Boolean)
    .filter((line) => !SECRET_PATTERNS.some((pattern) => pattern.test(line)))
    .slice(0, limit)
    .map((line) => line.slice(0, 240));
}

export function runCapabilityGate(root) {
  const script = path.join(root, "scripts", "check-capability-surfacing.mjs");
  if (!fs.existsSync(script)) {
    return {
      status: "unknown",
      command: "npm run check:capability-surfaces",
      messages: ["Capability-surfacing check script is unavailable."],
      sourceLocator: "scripts/check-capability-surfacing.mjs"
    };
  }
  try {
    const output = execFileSync(process.execPath, [script], {
      cwd: root,
      encoding: "utf8",
      stdio: ["ignore", "pipe", "pipe"],
      timeout: 15_000
    });
    return {
      status: "verified",
      command: "npm run check:capability-surfaces",
      messages: boundedLines(output),
      sourceLocator: "scripts/check-capability-surfacing.mjs"
    };
  } catch (error) {
    return {
      status: "drift",
      command: "npm run check:capability-surfaces",
      messages: boundedLines(`${error.stdout || ""}\n${error.stderr || ""}`),
      sourceLocator: "scripts/check-capability-surfacing.mjs"
    };
  }
}

async function probeEndpoint(endpoint, fetchImpl, timeoutMs = 3_000) {
  if (!fetchImpl) return { ...endpoint, status: "unknown", httpStatus: null, reason: "probe disabled" };
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    const response = await fetchImpl(endpoint.url, {
      method: "HEAD",
      redirect: "manual",
      signal: controller.signal
    });
    return {
      ...endpoint,
      status: response.status >= 200 && response.status < 500 ? "verified" : "attention",
      httpStatus: response.status,
      reason: "reachability only; deployed identity and authenticated behavior remain unverified"
    };
  } catch {
    return { ...endpoint, status: "unknown", httpStatus: null, reason: "probe unavailable" };
  } finally {
    clearTimeout(timer);
  }
}

export async function collectReachability({ enabled = false, fetchImpl = globalThis.fetch } = {}) {
  const probe = enabled ? fetchImpl : null;
  return Promise.all(PRODUCTION_ENDPOINTS.map((endpoint) => probeEndpoint(endpoint, probe)));
}

function finding({ id, category, status, severity, summary, details = [], sourceLocators }) {
  return {
    id,
    category,
    status,
    severity,
    blocking: severity === "blocking",
    summary,
    details,
    sourceLocators: [...new Set(sourceLocators)].sort()
  };
}

export function sortFindings(findings) {
  return [...findings].sort((left, right) => {
    return (SEVERITY_ORDER[left.severity] ?? 99) - (SEVERITY_ORDER[right.severity] ?? 99)
      || left.category.localeCompare(right.category)
      || left.id.localeCompare(right.id);
  });
}

function buildOwnerDecisions(findings, evidenceCoverage) {
  const decisions = [];
  const blocking = findings.find((item) => item.blocking);
  if (blocking) {
    decisions.push({
      id: "decision.resolve-blocking-drift",
      priority: 1,
      question: `Which authoritative correction resolves ${blocking.id}?`,
      sourceLocators: blocking.sourceLocators
    });
  }
  const dirty = findings.find((item) => item.id === "git.working-tree.dirty");
  if (dirty) {
    decisions.push({
      id: "decision.qualify-candidate",
      priority: 2,
      question: "Which bounded local slices must be committed and validated before candidate reconciliation?",
      sourceLocators: dirty.sourceLocators
    });
  }
  const unknownClasses = Object.entries(evidenceCoverage.classes)
    .filter(([, value]) => value.status === "unknown")
    .map(([name]) => name);
  if (unknownClasses.length) {
    decisions.push({
      id: "decision.plan-missing-proof",
      priority: 3,
      question: `Which owner or environment will supply the next missing proof (${unknownClasses.slice(0, 4).join(", ")})?`,
      sourceLocators: [evidenceCoverage.sourceLocator]
    });
  }
  return decisions.slice(0, 3);
}

export function reconcileProductTruth({
  generatedAt,
  git,
  productionClaims,
  reachability,
  capabilities,
  capabilityGate,
  evidenceCoverage
}) {
  const findings = [];
  const versions = [...new Set(productionClaims.map((claim) => claim.version))].sort();
  if (versions.length > 1) {
    findings.push(finding({
      id: "release.identity.conflict",
      category: "release",
      status: "drift",
      severity: "blocking",
      summary: `Canonical sources claim different production releases: ${versions.join(", ")}.`,
      details: productionClaims.map((claim) => `${claim.version} (${claim.claimType})`),
      sourceLocators: productionClaims.map((claim) => claim.sourceLocator)
    }));
  } else if (versions.length === 0) {
    findings.push(finding({
      id: "release.identity.unknown",
      category: "release",
      status: "unknown",
      severity: "unknown",
      summary: "No current production release claim could be resolved.",
      sourceLocators: ["PROJECT_STATUS.md", "docs/FEATURE_MATRIX.md"]
    }));
  }

  if (git.ahead > 0 && git.behind > 0) {
    findings.push(finding({
      id: "git.main.diverged",
      category: "candidate",
      status: "attention",
      severity: "attention",
      summary: `${git.branch} is ${git.ahead} ahead and ${git.behind} behind ${git.mainRef}.`,
      details: [`HEAD ${git.headSha}`, `${git.mainRef} ${git.mainSha || "unknown"}`],
      sourceLocators: [".git/HEAD", `.git/refs/remotes/${git.mainRef}`]
    }));
  } else if (!git.mainSha) {
    findings.push(finding({
      id: "git.main.unavailable",
      category: "candidate",
      status: "unknown",
      severity: "unknown",
      summary: `${git.mainRef} is unavailable; divergence is unknown.`,
      sourceLocators: [`.git/refs/remotes/${git.mainRef}`]
    }));
  }

  if (git.dirty) {
    findings.push(finding({
      id: "git.working-tree.dirty",
      category: "candidate",
      status: "attention",
      severity: "attention",
      summary: `Results describe dirty-worktree evidence at exact HEAD ${git.headSha}.`,
      sourceLocators: [".git/HEAD", "git status --short"]
    }));
  }

  if (capabilityGate.status === "drift") {
    findings.push(finding({
      id: "capability.surfacing.failed",
      category: "capability",
      status: "drift",
      severity: "blocking",
      summary: "The capability-surfacing gate failed for the inspected worktree.",
      details: [capabilityGate.command, ...capabilityGate.messages],
      sourceLocators: [capabilityGate.sourceLocator, "docs/capability-surfacing-contracts.json"]
    }));
  } else if (capabilityGate.status === "unknown") {
    findings.push(finding({
      id: "capability.surfacing.unknown",
      category: "capability",
      status: "unknown",
      severity: "unknown",
      summary: "Capability-surfacing validation was not available for this digest.",
      sourceLocators: [capabilityGate.sourceLocator]
    }));
  }

  const invalidRecords = evidenceCoverage.totals.invalidRecords || 0;
  if (invalidRecords > 0) {
    findings.push(finding({
      id: "evidence.records.malformed",
      category: "evidence",
      status: "attention",
      severity: "attention",
      summary: `${invalidRecords} development-evidence record(s) could not be parsed.`,
      sourceLocators: [evidenceCoverage.sourceLocator]
    }));
  }

  const sortedFindings = sortFindings(findings);
  const digest = {
    schemaVersion: PRODUCT_TRUTH_SCHEMA,
    generatedAt,
    projectionNotice: "Generated read-only projection; canonical sources and exact receipts retain authority.",
    production: {
      status: versions.length === 1 ? "verified" : versions.length > 1 ? "drift" : "unknown",
      resolvedRelease: versions.length === 1 ? versions[0] : null,
      claims: productionClaims,
      reachability
    },
    candidate: git,
    capabilities: { ...capabilities, gate: capabilityGate },
    evidenceCoverage,
    findings: sortedFindings,
    ownerDecisions: []
  };
  digest.ownerDecisions = buildOwnerDecisions(sortedFindings, evidenceCoverage);
  assertSecretSafe(digest);
  return digest;
}

export function assertSecretSafe(value) {
  const serialized = JSON.stringify(value);
  const matched = SECRET_PATTERNS.find((pattern) => pattern.test(serialized));
  if (matched) {
    throw new ProductTruthInputError("Product-truth output contained a secret-like value and was suppressed.", "generated-output");
  }
}

export async function buildProductTruthDigest({
  root = process.cwd(),
  now = new Date(),
  mainRef = "origin/main",
  capabilityCheck = true,
  probeReachability = false,
  fetchImpl = globalThis.fetch
} = {}) {
  const resolvedRoot = path.resolve(root);
  for (const requiredPath of REQUIRED_FILES) requiredText(resolvedRoot, requiredPath);
  const projectStatusText = requiredText(resolvedRoot, "PROJECT_STATUS.md");
  const featureMatrixText = requiredText(resolvedRoot, "docs/FEATURE_MATRIX.md");
  const contracts = requiredJson(resolvedRoot, "docs/capability-surfacing-contracts.json");
  const productionClaims = collectProductionClaims({ projectStatusText, featureMatrixText });
  const git = collectGitState(resolvedRoot, mainRef);
  const capabilities = collectCapabilityInventory(featureMatrixText, contracts);
  const evidenceCoverage = collectEvidenceCoverage(resolvedRoot);
  const capabilityGate = capabilityCheck
    ? runCapabilityGate(resolvedRoot)
    : {
        status: "unknown",
        command: "npm run check:capability-surfaces",
        messages: ["Capability check explicitly skipped."],
        sourceLocator: "scripts/check-capability-surfacing.mjs"
      };
  const reachability = await collectReachability({ enabled: probeReachability, fetchImpl });
  return reconcileProductTruth({
    generatedAt: now.toISOString(),
    git,
    productionClaims,
    reachability,
    capabilities,
    capabilityGate,
    evidenceCoverage
  });
}

function valueOrUnknown(value) {
  return value === null || value === undefined || value === "" ? "unknown" : String(value);
}

export function renderProductTruthText(digest) {
  const evidenceLines = EVIDENCE_CLASSES.map((name) => {
    const entry = digest.evidenceCoverage.classes[name];
    return `- ${name}: ${entry.status} (${entry.recordCount} record${entry.recordCount === 1 ? "" : "s"})`;
  });
  const findingLines = digest.findings.length
    ? digest.findings.map((item) => `- [${item.severity.toUpperCase()}] ${item.id}: ${item.summary} Sources: ${item.sourceLocators.join(", ")}`)
    : ["- none"];
  const decisionLines = digest.ownerDecisions.length
    ? digest.ownerDecisions.map((item) => `- ${item.priority}. ${item.question}`)
    : ["- none"];
  const claimLines = digest.production.claims.length
    ? digest.production.claims.map((claim) => `- ${claim.version} — ${claim.claimType} (${claim.sourceLocator})`)
    : ["- unknown"];
  const reachabilityLines = digest.production.reachability.map((item) => `- ${item.id}: ${item.status}${item.httpStatus ? ` (HTTP ${item.httpStatus})` : ""}; ${item.reason}`);

  return [
    "Product Truth Digest",
    digest.projectionNotice,
    "",
    "Production",
    `- resolved release: ${valueOrUnknown(digest.production.resolvedRelease)}`,
    "- independent claims:",
    ...claimLines.map((line) => `  ${line}`),
    "- reachability:",
    ...reachabilityLines.map((line) => `  ${line}`),
    "",
    "Candidate",
    `- branch: ${digest.candidate.branch}`,
    `- HEAD: ${digest.candidate.headSha}`,
    `- worktree: ${digest.candidate.dirty ? "dirty" : "clean"}`,
    `- ${digest.candidate.mainRef}: ${valueOrUnknown(digest.candidate.mainSha)}`,
    `- divergence: ${digest.candidate.ahead} ahead / ${digest.candidate.behind} behind`,
    `- latest local release tag: ${valueOrUnknown(digest.candidate.latestReleaseTag)}`,
    "",
    "Evidence coverage",
    ...evidenceLines,
    "",
    "Drift",
    ...findingLines,
    "",
    "Owner decisions",
    ...decisionLines
  ].join("\n");
}

export function productTruthExitCode(mode, digest) {
  if (mode === "status") return 0;
  if (mode === "gate") return digest.findings.some((item) => item.blocking) ? 1 : 0;
  throw new ProductTruthInputError(`Unsupported mode: ${mode}`, "cli:--mode");
}

export function parseProductTruthArgs(argv) {
  const parsed = {
    mode: "status",
    root: process.cwd(),
    mainRef: "origin/main",
    json: false,
    snapshot: null,
    capabilityCheck: true,
    probeReachability: false
  };
  for (let index = 0; index < argv.length; index += 1) {
    const token = argv[index];
    if (token === "--json") parsed.json = true;
    else if (token === "--skip-capability-check") parsed.capabilityCheck = false;
    else if (token === "--probe-reachability") parsed.probeReachability = true;
    else if (["--mode", "--root", "--main-ref", "--snapshot"].includes(token)) {
      const value = argv[index + 1];
      if (!value || value.startsWith("--")) throw new ProductTruthInputError(`${token} requires a value.`, `cli:${token}`);
      index += 1;
      if (token === "--mode") parsed.mode = value;
      else if (token === "--root") parsed.root = value;
      else if (token === "--main-ref") parsed.mainRef = value;
      else parsed.snapshot = value;
    } else {
      throw new ProductTruthInputError(`Unknown argument: ${token}`, `cli:${token}`);
    }
  }
  if (!["status", "gate"].includes(parsed.mode)) {
    throw new ProductTruthInputError(`Unsupported mode: ${parsed.mode}`, "cli:--mode");
  }
  return parsed;
}

function writeSnapshot(root, requestedPath, digest) {
  const snapshotRoot = path.resolve(root, ".cache", "product-truth");
  const target = path.resolve(root, requestedPath);
  if (target !== snapshotRoot && !target.startsWith(`${snapshotRoot}${path.sep}`)) {
    throw new ProductTruthInputError("Snapshots must stay under .cache/product-truth/.", "cli:--snapshot");
  }
  fs.mkdirSync(path.dirname(target), { recursive: true });
  fs.writeFileSync(target, `${JSON.stringify(digest, null, 2)}\n`, { flag: "w" });
}

async function main() {
  const args = parseProductTruthArgs(process.argv.slice(2));
  const digest = await buildProductTruthDigest(args);
  if (args.snapshot) writeSnapshot(args.root, args.snapshot, digest);
  process.stdout.write(`${args.json ? JSON.stringify(digest, null, 2) : renderProductTruthText(digest)}\n`);
  process.exitCode = productTruthExitCode(args.mode, digest);
}

if (process.argv[1] && pathToFileURL(path.resolve(process.argv[1])).href === import.meta.url) {
  main().catch((error) => {
    const locator = error?.locator ? ` (${error.locator})` : "";
    console.error(`Product truth digest failed${locator}: ${error.message}`);
    process.exitCode = error instanceof ProductTruthInputError ? 2 : 2;
  });
}
