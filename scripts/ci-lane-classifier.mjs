import { execSync } from "node:child_process";
import fs from "node:fs";

const FALLBACK_RETIREMENT_SENSITIVE = [
  "src/context/OrganizationContext.jsx",
  "src/hooks/useCatalogData.js",
  "src/lib/menuService.js",
  "src/lib/organizationService.js"
];

const HIGH_RISK_EXACT = new Set([
  ...FALLBACK_RETIREMENT_SENSITIVE,
  "src/lib/quoteStore.js",
  "src/lib/firebase.js",
  "src/lib/authClient.js",
  "src/hooks/useAuthSession.js",
  "firestore.rules",
  "firestore.indexes.json",
  "scripts/migrate-to-multi-tenant.mjs",
  ".github/workflows/ci-quality.yml",
  ".github/workflows/deploy-firebase-hosting.yml"
]);

const HIGH_RISK_PREFIXES = [
  "functions/"
];

const AUTH_RULES_PATHS = new Set([
  "src/lib/firebase.js",
  "src/lib/authClient.js",
  "src/hooks/useAuthSession.js",
  "firestore.rules",
  "firestore.indexes.json"
]);

const TENANT_WRITE_HINTS = [
  "src/lib/quoteStore.js",
  "src/lib/menuService.js",
  "src/hooks/useCatalogData.js",
  "src/lib/organizationService.js",
  "scripts/migrate-to-multi-tenant.mjs",
  "functions/index.js"
];

function run(command) {
  return execSync(command, {
    encoding: "utf8",
    stdio: ["ignore", "pipe", "pipe"]
  }).trim();
}

function readEventPayload() {
  const eventPath = process.env.GITHUB_EVENT_PATH;
  if (!eventPath || !fs.existsSync(eventPath)) return {};
  try {
    return JSON.parse(fs.readFileSync(eventPath, "utf8"));
  } catch {
    return {};
  }
}

function normalizePath(file) {
  return String(file || "").replace(/\\/g, "/").replace(/^\.\//, "").trim();
}

function listChangedFiles() {
  const eventName = String(process.env.GITHUB_EVENT_NAME || "").trim();
  const ref = String(process.env.GITHUB_REF || "").trim();
  const payload = readEventPayload();
  let baseSha = "";
  let headSha = "";

  if (eventName === "pull_request") {
    baseSha = String(payload?.pull_request?.base?.sha || "").trim();
    headSha = String(payload?.pull_request?.head?.sha || "").trim();
  } else if (eventName === "push") {
    baseSha = String(payload?.before || "").trim();
    headSha = String(payload?.after || process.env.GITHUB_SHA || "").trim();
    if (!headSha) {
      headSha = run("git rev-parse HEAD");
    }
    if (!baseSha || /^0+$/.test(baseSha)) {
      try {
        baseSha = run("git rev-parse HEAD^");
      } catch {
        baseSha = "";
      }
    }
  } else {
    try {
      baseSha = run("git rev-parse HEAD^");
      headSha = run("git rev-parse HEAD");
    } catch {
      baseSha = "";
      headSha = "";
    }
  }

  let diffOutput = "";
  if (baseSha && headSha) {
    diffOutput = run(`git diff --name-only --diff-filter=ACMR ${baseSha}...${headSha}`);
  }

  if (!diffOutput) {
    try {
      diffOutput = run("git diff --name-only --diff-filter=ACMR HEAD^...HEAD");
    } catch {
      diffOutput = "";
    }
  }

  const files = diffOutput
    ? diffOutput.split(/\r?\n/).map(normalizePath).filter(Boolean)
    : [];

  const deduped = [...new Set(files)].sort();
  const isMainPush = eventName === "push" && ref === "refs/heads/main";
  return { files: deduped, isMainPush };
}

function isMarkdownPath(file) {
  return file.toLowerCase().endsWith(".md");
}

function isDocsOnlyChange(files = []) {
  if (!files.length) return false;
  return files.every((file) => isMarkdownPath(file));
}

function matchesHighRisk(file) {
  if (HIGH_RISK_EXACT.has(file)) return true;
  return HIGH_RISK_PREFIXES.some((prefix) => file.startsWith(prefix));
}

function inferChangeType(files = []) {
  if (!files.length) return "docs";
  if (files.every((file) => isMarkdownPath(file))) return "docs";
  if (files.some((file) => file.startsWith(".github/workflows/deploy-") || ["firebase.json", "vercel.json", "Dockerfile", "docker-compose.yml"].includes(file))) {
    return "deploy";
  }
  if (files.some((file) => AUTH_RULES_PATHS.has(file))) {
    return "auth_rules";
  }
  if (files.some((file) => file.startsWith(".github/") || file.startsWith("scripts/") || file.startsWith(".codex/skills/"))) {
    return "process";
  }
  if (files.some((file) => file.startsWith("src/components/") || file === "src/styles.css")) {
    return "ui";
  }
  return "core";
}

function inferTenantImpact(files = []) {
  if (!files.length) return "none";
  if (files.some((file) => file === "firestore.rules" || file === "firestore.indexes.json")) {
    return "rules";
  }
  if (files.some((file) => TENANT_WRITE_HINTS.includes(file) || file.startsWith("functions/"))) {
    return "write";
  }
  if (files.some((file) => file.startsWith("src/context/OrganizationContext") || file.startsWith("src/lib/organizationService"))) {
    return "read";
  }
  return "none";
}

function formatList(value = []) {
  return value.length ? value.join(",") : "none";
}

function writeOutput(name, value) {
  const outputPath = process.env.GITHUB_OUTPUT;
  if (!outputPath) return;
  fs.appendFileSync(outputPath, `${name}=${value}\n`);
}

const { files, isMainPush } = listChangedFiles();
const docsOnly = isDocsOnlyChange(files);
const highRisk = files.some(matchesHighRisk);
const runHeavyLanes = isMainPush || !docsOnly;
const heavyRequired = isMainPush || highRisk;
const firebaseRequired = heavyRequired;
const cwvRequired = heavyRequired;
const changeType = inferChangeType(files);
const tenantImpact = inferTenantImpact(files);
const lanes = ["lane:quick", "lane:core"];

if (runHeavyLanes) {
  lanes.push("lane:firebase-auth-rules", "lane:authoritative-pricing");
}
if (isMainPush) {
  lanes.push("lane:release");
}

writeOutput("changed_count", String(files.length));
writeOutput("changed_files_csv", formatList(files));
writeOutput("docs_only", String(docsOnly));
writeOutput("high_risk", String(highRisk));
writeOutput("is_main_push", String(isMainPush));
writeOutput("run_heavy_lanes", String(runHeavyLanes));
writeOutput("heavy_required", String(heavyRequired));
writeOutput("firebase_required", String(firebaseRequired));
writeOutput("cwv_required", String(cwvRequired));
writeOutput("change_type", changeType);
writeOutput("tenant_impact", tenantImpact);
writeOutput("recommended_lanes_csv", lanes.join(","));

console.log("Lane classification summary");
console.log(`- changed_count: ${files.length}`);
console.log(`- docs_only: ${docsOnly}`);
console.log(`- high_risk: ${highRisk}`);
console.log(`- is_main_push: ${isMainPush}`);
console.log(`- run_heavy_lanes: ${runHeavyLanes}`);
console.log(`- heavy_required: ${heavyRequired}`);
console.log(`- firebase_required: ${firebaseRequired}`);
console.log(`- cwv_required: ${cwvRequired}`);
console.log(`- change_type: ${changeType}`);
console.log(`- tenant_impact: ${tenantImpact}`);
console.log(`- recommended_lanes: ${lanes.join(", ")}`);
if (files.length) {
  console.log("- changed_files:");
  files.forEach((file) => console.log(`  - ${file}`));
}
