import { execFileSync } from "node:child_process";
import fs from "node:fs";
import path from "node:path";
import { pathToFileURL } from "node:url";

const ARTIFACTS = Object.freeze({
  index: "docs/PRODUCT_INTELLIGENCE.md",
  outcomes: "docs/product-intelligence/PRODUCT_OUTCOME_CONTRACT.md",
  capabilities: "docs/product-intelligence/CAPABILITY_MAP.md",
  metrics: "docs/product-intelligence/SUCCESS_METRICS.md",
  schema: "docs/product-intelligence/event-schema.json",
  baselines: "docs/product-intelligence/BASELINES_AND_TARGETS.md",
  journey: "docs/product-intelligence/USER_JOURNEY_FUNNELS.md",
  guardrails: "docs/product-intelligence/QUALITY_GUARDRAILS.md",
  ledger: "docs/product-intelligence/RELEASE_EXPERIMENT_LEDGER.md"
});

const DEFINITION_SPECS = Object.freeze([
  { key: "outcomes", prefix: "OUT", label: "outcome" },
  { key: "capabilities", prefix: "CAP", label: "capability" },
  { key: "metrics", prefix: "MET", label: "metric" },
  { key: "baselines", prefix: "BASE", label: "baseline" },
  { key: "baselines", prefix: "TGT", label: "target" },
  { key: "guardrails", prefix: "GRD", label: "guardrail" },
  { key: "ledger", prefix: "LED", label: "ledger entry" },
  { key: "ledger", prefix: "EXP", label: "experiment entry" }
]);

const REQUIRED_EVENT_STATUSES = Object.freeze([
  "implemented",
  "derivable",
  "partial",
  "specified_not_implemented",
  "blocked"
]);

const LEDGER_DECISIONS = new Set([
  "planned",
  "observing",
  "adopt",
  "revise",
  "stop",
  "investigate",
  "no_outcome_claim"
]);

function normalizePath(value) {
  return String(value || "").replace(/\\/g, "/").replace(/^\.\//, "").trim();
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

function linesToPaths(output) {
  return String(output || "")
    .split(/\r?\n/)
    .map(normalizePath)
    .filter(Boolean);
}

function listChangedFiles(root) {
  const explicitRange = process.env.PRODUCT_INTELLIGENCE_DIFF;
  const baseRef = process.env.GITHUB_BASE_REF;
  const range = explicitRange || (baseRef ? `origin/${baseRef}...HEAD` : "HEAD^...HEAD");
  return [...new Set([
    ...linesToPaths(runGit(root, ["diff", "--name-only", "--diff-filter=ACMRD", range])),
    ...linesToPaths(runGit(root, ["diff", "--name-only", "--diff-filter=ACMRD"])),
    ...linesToPaths(runGit(root, ["diff", "--name-only", "--cached", "--diff-filter=ACMRD"])),
    ...linesToPaths(runGit(root, ["ls-files", "--others", "--exclude-standard"]))
  ])].sort();
}

function readRequired(root, relativePath, errors) {
  const absolutePath = path.join(root, relativePath);
  if (!fs.existsSync(absolutePath)) {
    errors.push(`Required product-intelligence artifact is missing: ${relativePath}`);
    return "";
  }
  return fs.readFileSync(absolutePath, "utf8");
}

function collectTableDefinitions(text, prefix, label, errors) {
  const ids = [];
  const pattern = new RegExp(`^\\|\\s*\\\`(${prefix}-\\d{2,3})\\\`[^|]*\\|`, "gm");
  for (const match of text.matchAll(pattern)) ids.push(match[1]);

  const seen = new Set();
  for (const id of ids) {
    if (seen.has(id)) errors.push(`Duplicate ${label} ID: ${id}`);
    seen.add(id);
  }
  return seen;
}

function collectExplicitReferences(text) {
  return [...text.matchAll(/\b(?:OUT|CAP|MET|SIG|BASE|TGT|GRD|LED|EXP)-\d{2,3}\b/g)]
    .map((match) => match[0]);
}

function parseLedgerRows(text) {
  return text
    .split(/\r?\n/)
    .filter((line) => /^\|\s*`(?:LED|EXP)-\d{2,3}`\s*\|/.test(line))
    .map((line) => {
      const cells = line.split("|").slice(1, -1).map((cell) => cell.trim());
      return {
        id: cells[0]?.replaceAll("`", ""),
        evidence: cells[5] || "",
        decision: cells[6]?.replaceAll("`", "") || ""
      };
    });
}

function hasExplicitOutcomeEvidence(value) {
  return /\boutcome evidence\b/i.test(value)
    && !/\b(?:no|without|missing|absent|unproven)\b.{0,32}\boutcome evidence\b/i.test(value);
}

function requireChanged(changed, requiredPath, reason, errors) {
  if (!changed.has(requiredPath)) {
    errors.push(`${reason} without updating ${requiredPath}`);
  }
}

function escapeRegExp(value) {
  return String(value).replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

function readPrField(body, label) {
  const match = String(body || "").match(
    new RegExp(`^-[ \\t]*${escapeRegExp(label)}:[ \\t]*(.*)$`, "mi")
  );
  return String(match?.[1] || "").trim();
}

function isUserVisibleProductSource(file) {
  return file === "src/App.jsx"
    || file === "src/LegacyApp.jsx"
    || (file.startsWith("src/components/") && !file.includes("/__tests__/"))
    || file.startsWith("src/styles/")
    || /^src\/[^/]+\.css$/.test(file);
}

function isProductRelevantChange(file) {
  return file.startsWith("docs/product-intelligence/")
    || /^src\/lib\/productAnalytics(?:Core|Ambient|Legacy)?\.js$/.test(file)
    || file === "functions/productAnalytics.js"
    || file === "docs/FEATURE_MATRIX.md"
    || file === "docs/capability-surfacing-contracts.json"
    || isUserVisibleProductSource(file);
}

function validatePrDeclaration(body, definitions, changedFiles, errors) {
  const disposition = readPrField(body, "disposition").toLowerCase();
  if (!disposition || !["required", "not_applicable"].includes(disposition)) {
    errors.push("PR Product Intelligence disposition must be required or not_applicable");
    return;
  }

  if (disposition === "not_applicable") {
    if (!readPrField(body, "If `not_applicable`, rationale")) {
      errors.push("PR Product Intelligence not_applicable disposition requires a rationale");
    }
    if (changedFiles.some(isProductRelevantChange)) {
      errors.push("PR Product Intelligence disposition must be required for product-relevant changes");
    }
    return;
  }

  const requiredLabels = [
    "Actor",
    "Catering job or decision",
    "Expected improvement",
    "Outcome or metric IDs",
    "Guardrail IDs",
    "Evidence needed",
    "Release / experiment ledger entry"
  ];
  const values = new Map();
  for (const label of requiredLabels) {
    const value = readPrField(body, label);
    values.set(label, value);
    if (!value) errors.push(`PR Product Intelligence field is incomplete: ${label}`);
  }

  const outcomeOrMetricIds = collectExplicitReferences(values.get("Outcome or metric IDs"))
    .filter((id) => id.startsWith("OUT-") || id.startsWith("MET-"));
  if (values.get("Outcome or metric IDs") && !outcomeOrMetricIds.length) {
    errors.push("PR Product Intelligence outcome or metric field must name an OUT-* or MET-* ID");
  }
  for (const id of outcomeOrMetricIds) {
    const prefix = id.split("-")[0];
    if (!definitions.get(prefix)?.has(id)) {
      errors.push(`PR Product Intelligence references unknown ID: ${id}`);
    }
  }

  const guardrailIds = collectExplicitReferences(values.get("Guardrail IDs"))
    .filter((id) => id.startsWith("GRD-"));
  if (values.get("Guardrail IDs") && !guardrailIds.length) {
    errors.push("PR Product Intelligence guardrail field must name a GRD-* ID");
  }
  for (const id of guardrailIds) {
    if (!definitions.get("GRD")?.has(id)) {
      errors.push(`PR Product Intelligence references unknown ID: ${id}`);
    }
  }

  const ledgerIds = collectExplicitReferences(values.get("Release / experiment ledger entry"))
    .filter((id) => id.startsWith("LED-") || id.startsWith("EXP-"));
  if (values.get("Release / experiment ledger entry") && !ledgerIds.length) {
    errors.push("PR Product Intelligence ledger field must name a LED-* or EXP-* ID");
  }
  for (const id of ledgerIds) {
    const prefix = id.split("-")[0];
    if (!definitions.get(prefix)?.has(id)) {
      errors.push(`PR Product Intelligence references unknown ID: ${id}`);
    }
  }
}

function validateChangeImpact(changedFiles, errors) {
  const changed = new Set(changedFiles.map(normalizePath));
  if (!changed.size) return;

  const productArtifactChanged = [...changed].some((file) => file.startsWith("docs/product-intelligence/"));
  if (productArtifactChanged) {
    requireChanged(changed, ARTIFACTS.index, "Product-intelligence artifact changed", errors);
  }

  const analyticsChanged = [...changed].some((file) =>
    /^src\/lib\/productAnalytics(?:Core|Ambient|Legacy)?\.js$/.test(file)
      || file === "functions/productAnalytics.js"
  );
  if (analyticsChanged) {
    for (const requiredPath of [ARTIFACTS.index, ARTIFACTS.schema, ARTIFACTS.metrics, ARTIFACTS.ledger]) {
      requireChanged(changed, requiredPath, "Product analytics changed", errors);
    }
  }

  const capabilityAuthorityChanged = changed.has("docs/FEATURE_MATRIX.md")
    || changed.has("docs/capability-surfacing-contracts.json");
  if (capabilityAuthorityChanged) {
    for (const requiredPath of [ARTIFACTS.index, ARTIFACTS.capabilities, ARTIFACTS.ledger]) {
      requireChanged(changed, requiredPath, "Capability authority changed", errors);
    }
  }

  const userVisibleProductSourceChanged = [...changed].some(isUserVisibleProductSource);
  if (userVisibleProductSourceChanged) {
    for (const requiredPath of [ARTIFACTS.index, ARTIFACTS.ledger]) {
      requireChanged(changed, requiredPath, "User-visible product source changed", errors);
    }
  }
}

export function validateProductIntelligence({
  root = process.cwd(),
  changedFiles = [],
  staticOnly = false
} = {}) {
  const errors = [];
  const texts = {};
  for (const [key, relativePath] of Object.entries(ARTIFACTS)) {
    if (key === "schema") continue;
    texts[key] = readRequired(root, relativePath, errors);
  }

  let schema = null;
  const schemaText = readRequired(root, ARTIFACTS.schema, errors);
  if (schemaText) {
    try {
      schema = JSON.parse(schemaText);
    } catch (error) {
      errors.push(`${ARTIFACTS.schema} is not valid JSON: ${error.message}`);
    }
  }

  const definitions = new Map();
  const counts = {};
  for (const spec of DEFINITION_SPECS) {
    const found = collectTableDefinitions(texts[spec.key], spec.prefix, spec.label, errors);
    definitions.set(spec.prefix, found);
    counts[spec.prefix] = found.size;
    if (!found.size) errors.push(`No ${spec.label} IDs found in ${ARTIFACTS[spec.key]}`);
  }

  const signals = new Set();
  if (schema) {
    const vocabulary = new Set(schema.statusVocabulary || []);
    for (const status of REQUIRED_EVENT_STATUSES) {
      if (!vocabulary.has(status)) errors.push(`Event schema status vocabulary is missing: ${status}`);
    }
    const captureModes = new Set(schema.captureModes || []);
    for (const signal of schema.signals || []) {
      if (!/^SIG-\d{3}$/.test(signal.id || "")) {
        errors.push(`Invalid signal ID: ${signal.id || "<missing>"}`);
        continue;
      }
      if (signals.has(signal.id)) errors.push(`Duplicate signal ID: ${signal.id}`);
      signals.add(signal.id);
      if (!vocabulary.has(signal.status)) {
        errors.push(`${signal.id} uses unknown status: ${signal.status}`);
      }
      if (!captureModes.has(signal.captureMode)) {
        errors.push(`${signal.id} uses unknown capture mode: ${signal.captureMode}`);
      }
      if (!Array.isArray(signal.requiredFields)) {
        errors.push(`${signal.id} must declare requiredFields`);
      }
      for (const metricId of signal.metricIds || []) {
        if (!definitions.get("MET")?.has(metricId)) {
          errors.push(`${signal.id} references unknown metric ${metricId}`);
        }
      }
      for (const sourcePath of signal.sourcePaths || []) {
        if (!fs.existsSync(path.join(root, sourcePath))) {
          errors.push(`${signal.id} source path does not exist: ${sourcePath}`);
        }
      }
    }
  }
  definitions.set("SIG", signals);
  counts.SIG = signals.size;

  const allText = Object.values(texts).join("\n");
  for (const id of collectExplicitReferences(allText)) {
    const prefix = id.split("-")[0];
    if (!definitions.get(prefix)?.has(id)) {
      errors.push(`Product-intelligence corpus references unknown ID: ${id}`);
    }
  }

  for (const [key, relativePath] of Object.entries(ARTIFACTS)) {
    if (key === "index") continue;
    const expectedLink = relativePath.replace(/^docs\//, "");
    if (!texts.index.includes(expectedLink)) {
      errors.push(`${ARTIFACTS.index} does not link to ${relativePath}`);
    }
  }

  for (const field of [
    "Actor:",
    "Job or decision:",
    "Expected improvement:",
    "Outcome or metric IDs:",
    "Guardrail IDs:",
    "Evidence needed:"
  ]) {
    if (!texts.index.includes(field)) {
      errors.push(`${ARTIFACTS.index} catering-value declaration is missing field: ${field}`);
    }
  }

  for (const row of parseLedgerRows(texts.ledger)) {
    if (!LEDGER_DECISIONS.has(row.decision)) {
      errors.push(`${row.id} uses unknown ledger decision: ${row.decision}`);
    }
    if (row.decision === "adopt" && !hasExplicitOutcomeEvidence(row.evidence)) {
      errors.push(`${row.id} decision adopt requires explicit outcome evidence`);
    }
  }

  const effectiveChangedFiles = staticOnly
    ? []
    : (changedFiles.length ? changedFiles : listChangedFiles(root));

  if (process.env.PRODUCT_INTELLIGENCE_PR_ENFORCE === "true") {
    validatePrDeclaration(
      process.env.PRODUCT_INTELLIGENCE_PR_BODY || "",
      definitions,
      effectiveChangedFiles,
      errors
    );
  }

  if (!staticOnly) {
    validateChangeImpact(effectiveChangedFiles, errors);
  }

  return {
    errors: [...new Set(errors)],
    counts: {
      outcomes: counts.OUT || 0,
      capabilities: counts.CAP || 0,
      metrics: counts.MET || 0,
      signals: counts.SIG || 0,
      baselines: counts.BASE || 0,
      targets: counts.TGT || 0,
      guardrails: counts.GRD || 0,
      ledgerEntries: (counts.LED || 0) + (counts.EXP || 0)
    }
  };
}

function parseArgs(argv) {
  const parsed = { root: process.cwd(), changedFiles: [], staticOnly: false };
  for (let index = 0; index < argv.length; index += 1) {
    const token = argv[index];
    if (token === "--static-only") {
      parsed.staticOnly = true;
      continue;
    }
    if (token === "--root" || token === "--changed-file") {
      const value = argv[index + 1];
      if (!value || value.startsWith("--")) throw new Error(`${token} requires a value.`);
      index += 1;
      if (token === "--root") parsed.root = path.resolve(value);
      else parsed.changedFiles.push(normalizePath(value));
      continue;
    }
    throw new Error(`Unknown argument: ${token}`);
  }
  return parsed;
}

function main() {
  const args = parseArgs(process.argv.slice(2));
  const result = validateProductIntelligence(args);
  if (result.errors.length) {
    console.error("Product intelligence check failed:");
    for (const error of result.errors) console.error(`- ${error}`);
    process.exitCode = 1;
    return;
  }
  const counts = result.counts;
  console.log(
    `Product intelligence check passed: ${counts.outcomes} outcomes, `
      + `${counts.capabilities} capabilities, ${counts.metrics} metrics, `
      + `${counts.signals} signals, ${counts.baselines} baselines, `
      + `${counts.targets} targets, ${counts.guardrails} guardrails, `
      + `${counts.ledgerEntries} ledger entries.`
  );
}

if (process.argv[1] && pathToFileURL(path.resolve(process.argv[1])).href === import.meta.url) {
  try {
    main();
  } catch (error) {
    console.error(`Product intelligence check failed: ${error.message}`);
    process.exitCode = 1;
  }
}
