import fs from "node:fs";
import path from "node:path";
import { execFileSync, execSync } from "node:child_process";

const ROOT = process.cwd();

const CANONICAL_DOCS = [
  "README.md",
  "PROJECT_STATUS.md",
  "DEV_TASKS.md",
  "CHANGELOG.md",
  "docs/DOC_SYSTEM.md"
];

const PROCESS_DOCS = [
  "README.md",
  "CONTRIBUTING.md",
  "docs/VERSION_CONTROL.md",
  "docs/DOC_SYSTEM.md"
];

const DEPLOY_DOCS = [
  "README.md",
  "docs/LAUNCH_RUNBOOK.md",
  "docs/VERSION_CONTROL.md",
  "docs/DOC_SYSTEM.md"
];

const TASK_ORCHESTRATION_IMPLEMENTATION = [
  "scripts/task-orchestration-plan.mjs",
  "docs/task-orchestration-contracts.json"
];

const TASK_ORCHESTRATION_GOVERNANCE_DOCS = [
  "docs/AGENT_GOVERNANCE.md",
  "docs/ORCHESTRATION_BLUEPRINT.md",
  "docs/ORCHESTRATION_RUNBOOK.md",
  "docs/DOC_SYSTEM.md"
];

const DOCUMENT_TIMESTAMP_PATTERN = /^Last updated: \d{4}-\d{2}-\d{2} \d{2}:\d{2}:\d{2} [A-Z]{2,5}$/m;

function run(command, options = {}) {
  return execSync(command, {
    cwd: ROOT,
    encoding: "utf8",
    stdio: ["ignore", "pipe", "pipe"],
    ...options
  }).trim();
}

function hasHeadParent() {
  try {
    run("git rev-parse --verify HEAD^");
    return true;
  } catch {
    return false;
  }
}

function resolveDiffRange() {
  const explicit = process.env.DOC_GOVERNANCE_DIFF;
  if (explicit) return explicit;

  const baseRef = process.env.GITHUB_BASE_REF;
  if (baseRef) {
    try {
      run(`git fetch --no-tags --depth=1 origin ${baseRef}`);
    } catch {
      // continue with local refs when fetch is unavailable
    }
    return `origin/${baseRef}...HEAD`;
  }

  if (hasHeadParent()) {
    return "HEAD^...HEAD";
  }

  return "";
}

function changedFilesFromRange(range) {
  if (!range) return [];
  const output = run(`git diff --name-only --diff-filter=ACMR ${range}`);
  if (!output) return [];
  return output
    .split(/\r?\n/)
    .map((line) => normalizePath(line.trim()))
    .filter(Boolean);
}

function normalizePath(file) {
  if (!file) return "";
  let normalized = file.replace(/\\/g, "/").replace(/^\.\//, "").trim();

  if (
    normalized.startsWith("github/") &&
    !normalized.startsWith(".github/") &&
    fs.existsSync(path.join(ROOT, ".github")) &&
    !fs.existsSync(path.join(ROOT, "github"))
  ) {
    normalized = `.${normalized}`;
  }

  return normalized;
}

function linesToPaths(output) {
  if (!output) return [];
  return output
    .split(/\r?\n/)
    .map((line) => normalizePath(line.trim()))
    .filter(Boolean);
}

function getWorkingTreeFiles() {
  const unstaged = linesToPaths(run("git diff --name-only"));
  const staged = linesToPaths(run("git diff --name-only --cached"));
  const untracked = linesToPaths(run("git ls-files --others --exclude-standard"));
  return [...new Set([...unstaged, ...staged, ...untracked])];
}

function getChangedFiles() {
  const range = resolveDiffRange();
  const fromRange = changedFilesFromRange(range);
  const fromWorkingTree = getWorkingTreeFiles();

  const isCi = process.env.CI === "true" || process.env.GITHUB_ACTIONS === "true";
  if (!isCi && fromWorkingTree.length) {
    return [...new Set(fromWorkingTree)].sort();
  }

  return [...new Set([...fromRange, ...fromWorkingTree])].sort();
}

function isMarkdown(file) {
  return file.toLowerCase().endsWith(".md");
}

function isCodeChange(file) {
  if (file.startsWith("src/") || file.startsWith("functions/") || file.startsWith("e2e/")) return true;
  if (file.endsWith(".js") || file.endsWith(".jsx") || file.endsWith(".mjs") || file.endsWith(".ts") || file.endsWith(".tsx")) return true;
  if (["firebase.json", "firestore.rules", "firestore.indexes.json"].includes(file)) return true;
  return false;
}

function isProcessChange(file) {
  if (file.startsWith(".github/")) return true;
  if (file.startsWith("scripts/")) return true;
  if (file.startsWith(".codex/skills/")) return true;
  if (["AGENTS.md", "CONTRIBUTING.md", "docs/AGENT_GOVERNANCE.md", "docs/SKILLS.md", "docs/VERSION_CONTROL.md"].includes(file)) {
    return true;
  }
  return false;
}

function isDeployChange(file) {
  if (file.startsWith("docker/")) return true;
  if (file.startsWith(".github/workflows/deploy-")) return true;
  if (["Dockerfile", "docker-compose.yml", ".dockerignore", "firebase.json", "vercel.json", "GO_LIVE_OPTION1.md", "docs/LAUNCH_RUNBOOK.md"].includes(file)) {
    return true;
  }
  return false;
}

function isBacklogChange(file) {
  if (file === "DEV_TASKS.md") return true;
  if (file === ".github/ISSUE_TEMPLATE/feature_request.md") return true;
  return /(^|\/)(backlog|roadmap|tasks)(\/|\.|$)/i.test(file);
}

function readJson(filePath) {
  return JSON.parse(fs.readFileSync(filePath, "utf8"));
}

function extractMajor(versionLike) {
  const match = String(versionLike || "").match(/(\d+)/);
  return match ? Number(match[1]) : NaN;
}

function checkVersionClaims(errors) {
  const pkg = readJson(path.join(ROOT, "package.json"));
  const viteMajor = extractMajor(pkg?.devDependencies?.vite);
  const reactMajor = extractMajor(pkg?.dependencies?.react);

  const agentsText = fs.readFileSync(path.join(ROOT, "AGENTS.md"), "utf8");
  const readmeText = fs.readFileSync(path.join(ROOT, "README.md"), "utf8");

  const agentsVite = extractMajor((agentsText.match(/Vite\s+(\d+)/i) || [])[1]);
  if (!Number.isNaN(agentsVite) && agentsVite !== viteMajor) {
    errors.push(`AGENTS.md Vite major (${agentsVite}) does not match package.json (${viteMajor}).`);
  }

  const readmeVite = extractMajor((readmeText.match(/-\s+Vite\s+(\d+)/i) || [])[1]);
  if (!Number.isNaN(readmeVite) && readmeVite !== viteMajor) {
    errors.push(`README.md Vite major (${readmeVite}) does not match package.json (${viteMajor}).`);
  }

  const readmeReact = extractMajor((readmeText.match(/-\s+React\s+(\d+)/i) || [])[1]);
  if (!Number.isNaN(readmeReact) && readmeReact !== reactMajor) {
    errors.push(`README.md React major (${readmeReact}) does not match package.json (${reactMajor}).`);
  }

  const readmeNode = extractMajor((readmeText.match(/Node\.js\s+(\d+)/i) || [])[1]);
  const contributingNode = extractMajor((fs.readFileSync(path.join(ROOT, "CONTRIBUTING.md"), "utf8").match(/Node\.js\s+(\d+)/i) || [])[1]);

  if (!Number.isNaN(readmeNode) && !Number.isNaN(contributingNode) && readmeNode !== contributingNode) {
    errors.push(`README.md Node major (${readmeNode}) does not match CONTRIBUTING.md (${contributingNode}).`);
  }

  const ciWorkflow = fs.readFileSync(path.join(ROOT, ".github/workflows/ci-quality.yml"), "utf8");
  const ciNode = extractMajor((ciWorkflow.match(/node-version:\s*(\d+)/i) || [])[1]);
  if (!Number.isNaN(readmeNode) && !Number.isNaN(ciNode) && ciNode !== readmeNode) {
    errors.push(`CI node-version (${ciNode}) does not match README.md Node major (${readmeNode}).`);
  }

  const dockerfileText = fs.readFileSync(path.join(ROOT, "Dockerfile"), "utf8");
  const dockerNode = extractMajor((dockerfileText.match(/FROM\s+node:(\d+)/i) || [])[1]);
  if (!Number.isNaN(readmeNode) && !Number.isNaN(dockerNode) && dockerNode !== readmeNode) {
    errors.push(`Dockerfile Node major (${dockerNode}) does not match README.md Node major (${readmeNode}).`);
  }
}

function checkSecretPatterns(errors) {
  const trackedMarkdown = run("git ls-files '*.md'")
    .split(/\r?\n/)
    .filter(Boolean)
    .filter((file) => !file.startsWith("node_modules/"));

  const patterns = [
    { re: /sk_(live|test)_[A-Za-z0-9]{16,}/, label: "Stripe secret key" },
    { re: /whsec_[A-Za-z0-9]{16,}/, label: "Stripe webhook secret" },
    { re: /AC[a-fA-F0-9]{32}/, label: "Twilio account SID" },
    { re: /(?<![A-Za-z0-9])AIza[0-9A-Za-z\-_]{20,}/, label: "Google API key" },
    { re: /twilio\.auth_token\s*=\s*"(?!<)[^"]+"/i, label: "Twilio auth token assignment" },
    { re: /^```\s*(sk_|whsec_|AC[a-fA-F0-9]{8,})/, label: "Malformed fenced secret block" }
  ];

  for (const file of trackedMarkdown) {
    const lines = fs.readFileSync(path.join(ROOT, file), "utf8").split(/\r?\n/);
    lines.forEach((line, idx) => {
      for (const pattern of patterns) {
        if (pattern.re.test(line)) {
          errors.push(`${file}:${idx + 1} potential secret detected (${pattern.label}).`);
          break;
        }
      }
    });
  }
}

function checkTaskOrchestrationContract(errors) {
  const contractPath = path.join(ROOT, "docs", "task-orchestration-contracts.json");
  let contract;
  try {
    contract = readJson(contractPath);
  } catch (error) {
    errors.push(`Task orchestration contract is unreadable: ${error.message}`);
    return;
  }

  if (contract.schemaVersion !== 1) {
    errors.push("Task orchestration contract schemaVersion must be 1.");
  }
  if (contract.switchAuthority !== "external_runner") {
    errors.push("Task orchestration model switching must remain external-runner authoritative.");
  }
  if (contract.timestampFormat !== "iso8601_utc"
    || JSON.stringify(contract.lifecyclePhases) !== JSON.stringify(["plan", "update", "complete"])) {
    errors.push("Task orchestration lifecycle timestamps must retain plan/update/complete ISO-8601 UTC authority.");
  }

  for (const tierName of ["economy", "balanced", "frontier"]) {
    const tier = contract.modelTiers?.[tierName];
    if (!tier?.defaultModel || !["low", "medium", "high"].includes(tier?.reasoningEffort)) {
      errors.push(`Task orchestration model tier ${tierName} is incomplete.`);
    }
  }

  for (const profileName of ["docs", "process", "ui", "core", "auth_rules", "deploy"]) {
    const profile = contract.profiles?.[profileName];
    if (!profile?.modelTier || !profile?.riskLevel || !Array.isArray(profile?.validations)) {
      errors.push(`Task orchestration profile ${profileName} is incomplete.`);
    }
  }

  const uiProfile = contract.profiles?.ui;
  if (!uiProfile?.requiredSkills?.includes("design-language")
    || !uiProfile?.readFirst?.includes("docs/DESIGN_SYSTEM.md")
    || !uiProfile?.readFirst?.includes("docs/DESIGN_PRINCIPLES.md")) {
    errors.push("The UI task profile must require design-language and both canonical design documents.");
  }

  const governedText = TASK_ORCHESTRATION_GOVERNANCE_DOCS
    .map((file) => fs.readFileSync(path.join(ROOT, file), "utf8"))
    .join("\n");
  for (const marker of ["npm run plan:task", "external runner", "task-orchestration-contracts.json", "design-language"]) {
    if (!governedText.toLowerCase().includes(marker.toLowerCase())) {
      errors.push(`Task orchestration governance docs are missing required marker: ${marker}`);
    }
  }
}

function baselineRef() {
  if (!(process.env.CI === "true" || process.env.GITHUB_ACTIONS === "true")) return "HEAD";
  const range = resolveDiffRange();
  return String(range).split(/\.\.\.?/)[0] || "HEAD";
}

function readBaselineFile(ref, file) {
  try {
    return execFileSync("git", ["show", `${ref}:${file}`], {
      cwd: ROOT,
      encoding: "utf8",
      stdio: ["ignore", "pipe", "ignore"]
    });
  } catch {
    return "";
  }
}

function checkDocumentationTimestamps(changedFiles, errors) {
  const ref = baselineRef();
  for (const file of changedFiles) {
    const requiresTimestamp = file === "AGENTS.md"
      || CANONICAL_DOCS.includes(file)
      || (file.startsWith("docs/") && file.toLowerCase().endsWith(".md"));
    const filePath = path.join(ROOT, file);
    if (!requiresTimestamp || !fs.existsSync(filePath)) continue;

    const current = fs.readFileSync(filePath, "utf8");
    const currentTimestamp = current.match(DOCUMENT_TIMESTAMP_PATTERN)?.[0] || "";
    if (!currentTimestamp) {
      errors.push(`${file} must include Last updated: YYYY-MM-DD HH:MM:SS TZ.`);
      continue;
    }

    const baseline = readBaselineFile(ref, file);
    const baselineTimestamp = baseline.match(/^Last updated:.*$/m)?.[0] || "";
    if (baseline && currentTimestamp === baselineTimestamp) {
      errors.push(`${file} changed without advancing its Last updated date and time.`);
    }
  }
}

function checkChangeDrivenDocs(changedFiles, errors) {
  if (!changedFiles.length) return;

  const changed = new Set(changedFiles);
  const hasCodeChange = changedFiles.some(isCodeChange);
  const hasProcessChange = changedFiles.some(isProcessChange);
  const hasDeployChange = changedFiles.some(isDeployChange);
  const hasBacklogChange = changedFiles.some(isBacklogChange);

  if (hasCodeChange && !changed.has("CHANGELOG.md")) {
    errors.push("Code or behavior files changed without CHANGELOG.md update.");
  }

  if (hasProcessChange) {
    const touchedProcessDoc = PROCESS_DOCS.some((doc) => changed.has(doc));
    if (!touchedProcessDoc) {
      errors.push(
        "Process/policy files changed without updating a process doc (README.md, CONTRIBUTING.md, docs/VERSION_CONTROL.md, or docs/DOC_SYSTEM.md)."
      );
    }
  }

  if (hasDeployChange) {
    const touchedDeployDoc = DEPLOY_DOCS.some((doc) => changed.has(doc));
    if (!touchedDeployDoc) {
      errors.push(
        "Deploy files changed without updating a deploy doc (README.md, docs/LAUNCH_RUNBOOK.md, docs/VERSION_CONTROL.md, or docs/DOC_SYSTEM.md)."
      );
    }
  }

  if (hasBacklogChange && !changed.has("DEV_TASKS.md")) {
    errors.push("Backlog/roadmap artifacts changed without DEV_TASKS.md update.");
  }

  if (TASK_ORCHESTRATION_IMPLEMENTATION.some((file) => changed.has(file))) {
    for (const requiredDoc of TASK_ORCHESTRATION_GOVERNANCE_DOCS) {
      if (!changed.has(requiredDoc)) {
        errors.push(`Task orchestration implementation changed without updating ${requiredDoc}.`);
      }
    }
  }

  const canonicalTouched = CANONICAL_DOCS.some((doc) => changed.has(doc));
  if (
    changedFiles.some((f) => isMarkdown(f) && !f.startsWith("docs/") && !CANONICAL_DOCS.includes(f)) &&
    !canonicalTouched
  ) {
    errors.push("Markdown changes detected without touching canonical docs. Ensure updates map to docs/DOC_SYSTEM.md ownership.");
  }
}

const errors = [];
const changedFiles = getChangedFiles();

checkChangeDrivenDocs(changedFiles, errors);
checkVersionClaims(errors);
checkSecretPatterns(errors);
checkTaskOrchestrationContract(errors);
checkDocumentationTimestamps(changedFiles, errors);

console.log("Doc governance check input changed files:");
for (const file of changedFiles) {
  console.log(`- ${file}`);
}

if (errors.length) {
  console.error("\nDoc governance check failed:");
  for (const error of errors) {
    console.error(`- ${error}`);
  }
  process.exit(1);
}

console.log("\nDoc governance check passed.");
