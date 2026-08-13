import fs from "node:fs";
import path from "node:path";
import { execSync } from "node:child_process";

const ROOT = process.cwd();

const TARGET_PREFIXES = [
  ".github/",
  ".devcontainer/",
  "config/stripe-connect/",
  "docker/",
  "functions-connect/",
  "infra/stripe-connect/",
  "scripts/"
];

const TARGET_FILES = new Set([
  ".env.example",
  ".firebaserc",
  ".firebaserc.example",
  "Dockerfile",
  "docker-compose.yml",
  "docs/capability-surfacing-contracts.json",
  "firebase.json",
  "firebase.connect.staging.json",
  "firestore.connect-control.indexes.json",
  "firestore.connect-control.rules",
  "firestore.indexes.json",
  "firestore.rules",
  "package-lock.json",
  "package.json",
  "vercel.json"
]);

const HIGH_CONFIDENCE_PATTERNS = [
  { re: /-----BEGIN (?:RSA |EC |OPENSSH |DSA |PGP )?PRIVATE KEY-----/, label: "Private key block" },
  { re: /\bgh[pousr]_[A-Za-z0-9]{30,}\b/, label: "GitHub token" },
  { re: /\bgithub_pat_[A-Za-z0-9_]{40,}\b/, label: "GitHub fine-grained token" },
  { re: /\bAKIA[0-9A-Z]{16}\b/, label: "AWS access key id" },
  { re: /\bAIza[0-9A-Za-z\-_]{20,}\b/, label: "Google API key" },
  { re: /\bsk_(?:live|test)_[A-Za-z0-9]{16,}\b/, label: "Stripe secret key" },
  { re: /\bwhsec_[A-Za-z0-9]{16,}\b/, label: "Stripe webhook secret" },
  { re: /\bSG\.[A-Za-z0-9_-]{16,}\.[A-Za-z0-9_-]{16,}\b/, label: "SendGrid API key" },
  { re: /\bxox(?:a|b|p|r|s)-[A-Za-z0-9-]{10,}\b/, label: "Slack token" },
  { re: /\bAC[a-fA-F0-9]{32}\b/, label: "Twilio account SID" }
];

const KEY_VALUE_ASSIGNMENT = /\b(api[_-]?key|access[_-]?key|secret|auth[_-]?token|token|password)\b\s*[:=]\s*["']([^"'\\\r\n]{12,})["']/i;

function run(command) {
  return execSync(command, {
    cwd: ROOT,
    encoding: "utf8",
    stdio: ["ignore", "pipe", "pipe"]
  }).trim();
}

function listTrackedFiles() {
  const output = run("git ls-files");
  if (!output) return [];
  return output.split(/\r?\n/).filter(Boolean);
}

function isTargetFile(file) {
  if (!file) return false;
  if (file.toLowerCase().endsWith(".md")) return false;
  if (file.startsWith("dist/")) return false;
  if (file.startsWith("node_modules/")) return false;
  if (TARGET_FILES.has(file)) return true;
  return TARGET_PREFIXES.some((prefix) => file.startsWith(prefix));
}

function isAllowedLiteral(value) {
  const normalized = String(value || "").trim();
  if (!normalized) return true;
  if (/^\$\{?[A-Z0-9_]+\}?$/.test(normalized)) return true;
  const shellFallback = normalized.match(/^\$\{([A-Z0-9_]+):-([^}]+)\}$/);
  if (shellFallback && shellFallback[1].startsWith("E2E_")) return true;
  if (/^<[^>]+>$/.test(normalized)) return true;
  if (/^(?:your_|YOUR_)/.test(normalized)) return true;
  if (/^(?:changeme|example|dummy|none|null|undefined|test|todo)$/i.test(normalized)) return true;
  if (/_HERE$/i.test(normalized)) return true;
  return false;
}

function scanFile(file, findings) {
  const fullPath = path.join(ROOT, file);
  const content = fs.readFileSync(fullPath, "utf8");
  if (content.includes("\u0000")) return;

  const lines = content.split(/\r?\n/);
  lines.forEach((line, idx) => {
    for (const pattern of HIGH_CONFIDENCE_PATTERNS) {
      if (pattern.re.test(line)) {
        findings.push(`${file}:${idx + 1} potential secret detected (${pattern.label}).`);
        return;
      }
    }

    const kvMatch = KEY_VALUE_ASSIGNMENT.exec(line);
    if (!kvMatch) return;

    const value = kvMatch[2];
    if (isAllowedLiteral(value)) return;
    findings.push(`${file}:${idx + 1} potential hardcoded ${kvMatch[1]} value.`);
  });
}

const targetFiles = listTrackedFiles().filter(isTargetFile).sort();
const findings = [];

for (const file of targetFiles) {
  scanFile(file, findings);
}

console.log("Secret asset scan target files:");
for (const file of targetFiles) {
  console.log(`- ${file}`);
}

if (findings.length) {
  console.error("\nSecret asset scan failed:");
  for (const finding of findings) {
    console.error(`- ${finding}`);
  }
  process.exit(1);
}

console.log("\nSecret asset scan passed.");
