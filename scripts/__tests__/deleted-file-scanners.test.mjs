import assert from "node:assert/strict";
import { execFileSync, spawnSync } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";

const scripts = fileURLToPath(new URL("../", import.meta.url));
const stamp = "Last updated: 2026-10-10 15:00:00 CDT\n";

function fixture(t) {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "qp-scanner-test-"));
  t.after(() => fs.rmSync(root, { recursive: true, force: true }));
  const write = (file, content) => {
    fs.mkdirSync(path.dirname(path.join(root, file)), { recursive: true });
    fs.writeFileSync(path.join(root, file), content);
  };
  const git = (...args) => execFileSync("git", args, { cwd: root, stdio: "pipe" });
  git("init", "-q");
  git("config", "user.name", "Scanner fixture");
  git("config", "user.email", "scanner@example.invalid");
  for (const file of ["AGENTS.md", "README.md", "PROJECT_STATUS.md", "DEV_TASKS.md", "CHANGELOG.md", "CONTRIBUTING.md", "docs/DOC_SYSTEM.md", "docs/AGENT_GOVERNANCE.md", "docs/ORCHESTRATION_BLUEPRINT.md", "docs/ORCHESTRATION_RUNBOOK.md", ".claude/agents/retired.md"]) write(file, stamp);
  write("package.json", JSON.stringify({ dependencies: { react: "18" }, devDependencies: { vite: "7" } }));
  write(".github/workflows/ci-quality.yml", "node-version: 22\n");
  write("Dockerfile", "FROM node:22\n");
  write(".codex/skills/catering-domain-intelligence/SKILL.md", "fixture\n");
  const contexts = ["commercial", "pricing", "proposal_revision", "payments", "customer_experience", "catalog_menu", "event_operations", "staffing", "beo_document_truth", "readiness", "reporting"];
  write("docs/task-orchestration-contracts.json", JSON.stringify({
    schemaVersion: 2, switchAuthority: "external_runner", timestampFormat: "iso8601_utc", lifecyclePhases: ["plan", "update", "complete"],
    modelTiers: Object.fromEntries(["economy", "balanced", "frontier"].map((id) => [id, { defaultModel: "fixture", reasoningEffort: "medium" }])),
    profiles: Object.fromEntries(["docs", "process", "ui", "core", "auth_rules", "deploy"].map((id) => [id, { modelTier: "balanced", riskLevel: "medium", validations: [], requiredSkills: ["design-language"], readFirst: ["docs/DESIGN_SYSTEM.md", "docs/DESIGN_PRINCIPLES.md"] }])),
    domainRouting: { skill: "catering-domain-intelligence", noneContext: "none", contextOrder: contexts, contexts: Object.fromEntries(contexts.map((id) => [id, { taskKeywords: [], pathFragments: [], authorityReads: [], referenceSlices: [] }])) }
  }));
  write("docs/AGENT_GOVERNANCE.md", stamp + "npm run plan:task; external runner; task-orchestration-contracts.json; design-language; domainClassification; catering-domain-intelligence; check:product-intelligence\n");
  git("add", ".");
  git("commit", "-qm", "fixture baseline");
  return { root, write, git, run: (script, extraEnv = {}) => {
    const env = { ...process.env, CI: "false", GITHUB_ACTIONS: "false", ...extraEnv };
    delete env.GITHUB_BASE_REF;
    delete env.DOC_GOVERNANCE_DIFF;
    return spawnSync(process.execPath, [path.join(scripts, script)], { cwd: root, env, encoding: "utf8" });
  } };
}

for (const script of ["check-secret-assets.mjs", "check-doc-governance.mjs"]) {
  test(`${script}: skips a Git-confirmed deleted file without losing content checks`, (t) => {
    const f = fixture(t);
    fs.unlinkSync(path.join(f.root, ".claude/agents/retired.md"));
    f.write("CHANGELOG.md", stamp.replace("15:00", "15:01"));
    const result = f.run(script);
    assert.equal(result.status, 0, result.stderr);
    assert.doesNotMatch(result.stderr, /ENOENT/);
  });

  test(`${script}: still rejects a staged secret beside a deleted file`, (t) => {
    const f = fixture(t);
    fs.unlinkSync(path.join(f.root, ".claude/agents/retired.md"));
    f.write("docs/new.md", stamp + ["sk", "live", "x".repeat(20)].join("_") + "\n");
    f.git("add", "docs/new.md");
    const result = f.run(script);
    assert.equal(result.status, 1);
    assert.match(result.stderr, /docs\/new.md:2 potential secret detected/);
  });

  test(`${script}: does not swallow a real file read failure`, (t) => {
    const f = fixture(t);
    f.git("rm", ".claude/agents/retired.md");
    fs.mkdirSync(path.join(f.root, ".claude/agents"), { recursive: true });
    fs.symlinkSync("missing-target", path.join(f.root, ".claude/agents/retired.md"));
    f.git("add", ".claude/agents/retired.md");
    const result = f.run(script);
    assert.equal(result.status, 1);
    assert.match(result.stderr, /ENOENT/);
  });
}

test("documentation scan rejects deletion of a required canonical document", (t) => {
  const f = fixture(t);
  fs.unlinkSync(path.join(f.root, "PROJECT_STATUS.md"));
  const result = f.run("check-doc-governance.mjs");
  assert.equal(result.status, 1);
  assert.match(result.stderr, /PROJECT_STATUS.md.*required.*missing/i);
});

test("committed code deletion still requires a changelog update in CI", (t) => {
  const f = fixture(t);
  f.write("src/retired.js", "export const retired = true;\n");
  f.git("add", ".");
  f.git("commit", "-qm", "add source");
  f.git("rm", "src/retired.js");
  f.git("commit", "-qm", "delete source");
  const result = f.run("check-doc-governance.mjs", { CI: "true" });
  assert.equal(result.status, 1);
  assert.match(result.stderr, /Code or behavior files changed without CHANGELOG.md update/);
});
