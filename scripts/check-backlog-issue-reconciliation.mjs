import { execFileSync } from "node:child_process";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const TRIAGE_LABELS = new Set([
  "needs-triage",
  "needs-info",
  "ready-for-agent",
  "ready-for-human",
  "wontfix"
]);

const MIRRORED_BACKLOG_ID = "(?:GOV|QPR)-\\d{3}";

export function parseNowBacklogInitiatives(markdown) {
  const initiatives = [];
  const sections = [...String(markdown).matchAll(
    /^## NOW — .+\s*$([\s\S]*?)(?=^##\s|\Z)/gm
  )];

  for (const sectionMatch of sections) {
    const section = sectionMatch[1] || "";
    const entries = [...section.matchAll(new RegExp(
      "^(?:(?<heading>###)\\s+|- \\[(?<checked>[ xX])\\]\\s+)`(?<id>" +
        MIRRORED_BACKLOG_ID +
        ")` — (?<title>.+)$",
      "gm"
    ))];

    for (const [index, entry] of entries.entries()) {
      if (entry.groups.checked?.toLowerCase() === "x") continue;
      const start = entry.index + entry[0].length;
      const end = entries[index + 1]?.index ?? section.length;
      const body = section.slice(start, end);
      const status = entry.groups.heading
        ? body.match(/^- \*\*Status:\*\*\s+([a-z_]+)\s*$/m)?.[1] || "unspecified"
        : "open";
      initiatives.push({
        id: entry.groups.id,
        title: entry.groups.title.trim(),
        status
      });
    }
  }

  return initiatives;
}

export function parseNowGovernanceInitiatives(markdown) {
  return parseNowBacklogInitiatives(markdown)
    .filter((initiative) => initiative.id.startsWith("GOV-"));
}

function issueBacklogIds(issue) {
  return [...String(issue.body || "").matchAll(new RegExp(
    `^Backlog-ID:\\s*(${MIRRORED_BACKLOG_ID})\\s*$`,
    "gmi"
  ))]
    .map((match) => match[1].toUpperCase());
}

function issueLabels(issue) {
  return (issue.labels || []).map((label) =>
    typeof label === "string" ? label : label?.name
  ).filter(Boolean);
}

export function validateBacklogIssueReconciliation({ backlogMarkdown, issues }) {
  const initiatives = parseNowBacklogInitiatives(backlogMarkdown);
  const activeIds = new Set(initiatives.map((initiative) => initiative.id));
  const openIssues = (issues || []).filter((issue) =>
    String(issue.state || "OPEN").toUpperCase() === "OPEN"
  );
  const errors = [];
  const links = [];

  for (const initiative of initiatives) {
    const mirrors = openIssues.filter((issue) => issueBacklogIds(issue).includes(initiative.id));
    if (mirrors.length === 0) {
      errors.push(`${initiative.id} has no open GitHub issue`);
      continue;
    }
    if (mirrors.length !== 1) {
      errors.push(`${initiative.id} has ${mirrors.length} open GitHub issues; expected exactly 1`);
      continue;
    }

    const mirror = mirrors[0];
    if (!/^Authority:\s*DEV_TASKS\.md\s*$/mi.test(String(mirror.body || ""))) {
      errors.push(`GitHub issue #${mirror.number} for ${initiative.id} must declare Authority: DEV_TASKS.md`);
    }
    const triageLabels = issueLabels(mirror).filter((label) => TRIAGE_LABELS.has(label));
    if (triageLabels.length !== 1) {
      errors.push(`GitHub issue #${mirror.number} for ${initiative.id} must have exactly one canonical triage label`);
    }
    links.push({ backlogId: initiative.id, issueNumber: mirror.number });
  }

  for (const issue of openIssues) {
    for (const backlogId of issueBacklogIds(issue)) {
      if (!activeIds.has(backlogId)) {
        errors.push(
          `Open GitHub issue #${issue.number} references ${backlogId}, which is not active in a NOW backlog section`
        );
      }
    }
  }

  return { errors, links };
}

function argumentValue(name) {
  const index = process.argv.indexOf(name);
  return index === -1 ? "" : String(process.argv[index + 1] || "");
}

function loadIssues(root) {
  const issuesPath = argumentValue("--issues-json");
  if (issuesPath) {
    return JSON.parse(fs.readFileSync(path.resolve(root, issuesPath), "utf8"));
  }
  return JSON.parse(execFileSync("gh", [
    "issue",
    "list",
    "--state",
    "open",
    "--limit",
    "1000",
    "--json",
    "number,title,body,state,labels"
  ], { cwd: root, encoding: "utf8" }));
}

function main() {
  const root = process.cwd();
  const backlogPath = argumentValue("--backlog") || "DEV_TASKS.md";
  const backlogMarkdown = fs.readFileSync(path.resolve(root, backlogPath), "utf8");
  const result = validateBacklogIssueReconciliation({
    backlogMarkdown,
    issues: loadIssues(root)
  });

  if (result.errors.length) {
    for (const error of result.errors) console.error(`- ${error}`);
    process.exitCode = 1;
    return;
  }
  console.log(`Backlog issue reconciliation passed: ${result.links.length} link(s).`);
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  main();
}
