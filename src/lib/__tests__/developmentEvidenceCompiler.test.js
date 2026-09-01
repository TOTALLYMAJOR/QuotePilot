import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { spawnSync } from "node:child_process";
import { afterEach, describe, expect, test } from "vitest";

const ROOT = process.cwd();
const RECORD_SCRIPT = path.join(ROOT, "scripts", "record-development-evidence.mjs");
const SUMMARY_SCRIPT = path.join(ROOT, "scripts", "summarize-development-evidence.mjs");
const tempDirs = [];

function run(script, args, options = {}) {
  return spawnSync(process.execPath, [script, ...args], {
    cwd: options.cwd || ROOT,
    env: { ...process.env, ...(options.env || {}) },
    encoding: "utf8"
  });
}

function makeTempDir() {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "quotepilot-development-evidence-"));
  tempDirs.push(dir);
  return dir;
}

afterEach(() => {
  while (tempDirs.length) {
    fs.rmSync(tempDirs.pop(), { recursive: true, force: true });
  }
});

describe("development evidence recorder", () => {
  test("prints a proof-bounded record without inventing a pre-change SHA", () => {
    const result = run(RECORD_SCRIPT, [
      "--task", "compiler-contract",
      "--phase", "complete",
      "--planner-recorded-at", "2026-08-28T22:18:58.276Z",
      "--files", "package.json,scripts/record-development-evidence.mjs,package.json",
      "--validation", "npm run build | passed | local build",
      "--local-proof", "CLI contract exercised locally",
      "--human-decision", "pending",
      "--residual-risk", "Hosted behavior remains unverified",
      "--dry-run"
    ]);

    expect(result.status).toBe(0);
    const record = JSON.parse(result.stdout);
    expect(record).toMatchObject({
      schemaVersion: 1,
      task: "compiler-contract",
      phase: "complete",
      preChangeSha: null,
      plannerRecordedAt: "2026-08-28T22:18:58.276Z",
      humanDecision: "pending"
    });
    expect(record.postChangeSha).toMatch(/^[0-9a-f]{40}$/);
    expect(record.files).toEqual([
      "package.json",
      "scripts/record-development-evidence.mjs"
    ]);
    expect(record.validations).toEqual([{
      command: "npm run build",
      outcome: "passed",
      notes: "local build"
    }]);
    expect(record.evidence.local).toEqual(["CLI contract exercised locally"]);
  });

  test("preserves an explicitly supplied pre-change SHA", () => {
    const preChangeSha = "1".repeat(40);
    const result = run(RECORD_SCRIPT, [
      "--task", "compiler-contract",
      "--pre-change-sha", preChangeSha,
      "--dry-run"
    ]);

    expect(result.status).toBe(0);
    expect(JSON.parse(result.stdout).preChangeSha).toBe(preChangeSha);
  });

  test("rejects secret-like evidence values", () => {
    const result = run(RECORD_SCRIPT, [
      "--task", "compiler-contract",
      "--provider-proof", `sk-${"a".repeat(24)}`,
      "--dry-run"
    ]);

    expect(result.status).toBe(1);
    expect(result.stderr).toMatch(/secret-like value/i);
    expect(result.stdout).toBe("");
  });
});

describe("development evidence index", () => {
  test("summarizes valid records and reports malformed records", () => {
    const dir = makeTempDir();
    fs.writeFileSync(path.join(dir, "valid.json"), JSON.stringify({
      recordedAt: "2026-08-28T22:00:00.000Z",
      task: "compiler-contract",
      phase: "complete",
      branch: "feature/evidence",
      dirty: true,
      plannerRecordedAt: null,
      validations: [{ command: "npm run build", outcome: "failed", notes: "fixture" }],
      evidence: { local: ["fixture"] },
      humanDecision: null,
      residualRisks: ["Human review remains"],
      nextAction: "Request review"
    }));
    fs.writeFileSync(path.join(dir, "invalid.json"), "{not-json}\n");

    const result = run(SUMMARY_SCRIPT, ["--dir", dir, "--json"]);

    expect(result.status).toBe(0);
    const summary = JSON.parse(result.stdout);
    expect(summary.totals).toMatchObject({
      records: 1,
      invalidRecords: 1,
      dirtyRecords: 1,
      failedValidations: 1,
      missingPlannerTimestamp: 1,
      missingHumanDecision: 1
    });
    expect(summary.evidenceClassRecords.local).toBe(1);
    expect(summary.failedValidations[0]).toMatchObject({
      task: "compiler-contract",
      command: "npm run build",
      outcome: "failed"
    });
    expect(summary.recommendations).toEqual(expect.arrayContaining([
      expect.stringMatching(/malformed evidence records/i),
      expect.stringMatching(/failed validation commands/i)
    ]));
  });
});
