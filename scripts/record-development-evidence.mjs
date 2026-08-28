import { execFileSync } from "node:child_process";
import fs from "node:fs";
import path from "node:path";

const OUTPUT_DIR = path.join(".cache", "development-evidence");
const SECRET_PATTERNS = [
  /sk-[A-Za-z0-9_-]{20,}/,
  /gh[pousr]_[A-Za-z0-9_]{20,}/,
  /xox[baprs]-[A-Za-z0-9-]{20,}/,
  /-----BEGIN [A-Z ]*PRIVATE KEY-----/,
  /Bearer\s+[A-Za-z0-9._-]{20,}/i
];

function runGit(args) {
  try {
    return execFileSync("git", args, {
      encoding: "utf8",
      stdio: ["ignore", "pipe", "ignore"]
    }).trim();
  } catch {
    return "";
  }
}

function parseArgs(argv) {
  const parsed = {
    task: "",
    phase: "complete",
    plannerRecordedAt: "",
    preChangeSha: "",
    files: [],
    validations: [],
    evidence: {
      source: [],
      local: [],
      ci: [],
      hosted: [],
      provider: [],
      production: [],
      human: [],
      outcome: []
    },
    humanDecision: "",
    residualRisks: [],
    nextAction: "",
    dryRun: false
  };

  const evidenceFlags = new Map([
    ["--source-proof", "source"],
    ["--local-proof", "local"],
    ["--ci-proof", "ci"],
    ["--hosted-proof", "hosted"],
    ["--provider-proof", "provider"],
    ["--production-proof", "production"],
    ["--human-proof", "human"],
    ["--outcome", "outcome"]
  ]);

  for (let index = 0; index < argv.length; index += 1) {
    const token = argv[index];
    if (token === "--dry-run") {
      parsed.dryRun = true;
      continue;
    }

    const expectsValue = [
      "--task",
      "--phase",
      "--planner-recorded-at",
      "--pre-change-sha",
      "--files",
      "--validation",
      "--human-decision",
      "--residual-risk",
      "--next-action",
      ...evidenceFlags.keys()
    ];
    if (!expectsValue.includes(token)) {
      throw new Error(`Unknown argument: ${token}`);
    }

    const value = argv[index + 1];
    if (!value || value.startsWith("--")) {
      throw new Error(`${token} requires a value.`);
    }
    index += 1;

    if (token === "--task") parsed.task = value.trim();
    else if (token === "--phase") parsed.phase = value.trim();
    else if (token === "--planner-recorded-at") parsed.plannerRecordedAt = value.trim();
    else if (token === "--pre-change-sha") parsed.preChangeSha = value.trim();
    else if (token === "--files") parsed.files.push(...value.split(",").map((item) => item.trim()).filter(Boolean));
    else if (token === "--validation") parsed.validations.push(parseValidation(value));
    else if (token === "--human-decision") parsed.humanDecision = value.trim();
    else if (token === "--residual-risk") parsed.residualRisks.push(value.trim());
    else if (token === "--next-action") parsed.nextAction = value.trim();
    else parsed.evidence[evidenceFlags.get(token)].push(value.trim());
  }

  if (!parsed.task) throw new Error("--task is required.");
  return parsed;
}

function parseValidation(value) {
  const [command = "", outcome = "", notes = ""] = value.split("|").map((part) => part.trim());
  if (!command || !outcome) {
    throw new Error('--validation must use "command | outcome | optional notes".');
  }
  return { command, outcome, notes };
}

function assertNoSecrets(record) {
  const serialized = JSON.stringify(record);
  for (const pattern of SECRET_PATTERNS) {
    if (pattern.test(serialized)) {
      throw new Error("Evidence record appears to contain a secret-like value. Store only proof type, status, and opaque receipt ids.");
    }
  }
}

function slugify(value) {
  return String(value)
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 80) || "task";
}

function buildRecord(parsed) {
  const status = runGit(["status", "--short"]);
  const postChangeSha = runGit(["rev-parse", "HEAD"]) || "unknown";
  return {
    schemaVersion: 1,
    recordedAt: new Date().toISOString(),
    task: parsed.task,
    phase: parsed.phase,
    branch: runGit(["branch", "--show-current"]) || "unknown",
    preChangeSha: parsed.preChangeSha || null,
    postChangeSha,
    dirty: Boolean(status),
    plannerRecordedAt: parsed.plannerRecordedAt || null,
    files: [...new Set(parsed.files)].sort(),
    validations: parsed.validations,
    evidence: parsed.evidence,
    humanDecision: parsed.humanDecision || null,
    residualRisks: parsed.residualRisks,
    nextAction: parsed.nextAction || null
  };
}

function main() {
  const parsed = parseArgs(process.argv.slice(2));
  const record = buildRecord(parsed);
  assertNoSecrets(record);

  const serialized = `${JSON.stringify(record, null, 2)}\n`;
  if (parsed.dryRun) {
    process.stdout.write(serialized);
    return;
  }

  fs.mkdirSync(OUTPUT_DIR, { recursive: true });
  const stamp = record.recordedAt.replace(/[-:]/g, "").replace(/\.\d{3}Z$/, "Z");
  const outputPath = path.join(OUTPUT_DIR, `${stamp}--${slugify(record.task)}.json`);
  fs.writeFileSync(outputPath, serialized, { flag: "wx" });
  console.log(outputPath);
}

try {
  main();
} catch (error) {
  console.error(`Development evidence record failed: ${error.message}`);
  process.exit(1);
}
