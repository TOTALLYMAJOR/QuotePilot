import test from "node:test";
import assert from "node:assert/strict";
import path from "node:path";
import { fileURLToPath } from "node:url";

let core = {};
try {
  core = await import("../layered-eval-core.mjs");
} catch {
  // The first TDD run intentionally reaches this branch before the core exists.
}
let runner = {};
try {
  runner = await import("../run-layered-evals.mjs");
} catch {
  // The CLI is introduced by the second TDD cycle.
}

const validManifest = {
  schemaVersion: "quotepilot-layered-eval-manifest-v1",
  corpusVersion: "2026-09-19",
  decisionPolicy: {
    compositeScore: "prohibited",
    ownerDecisionRequired: true
  },
  evaluations: [
    {
      id: "EVAL-001",
      name: "Authority and integrity",
      dimension: "authority_integrity",
      execution: "automated",
      releaseBlocking: true,
      evidenceClass: "local",
      capabilityIds: ["CAP-03"],
      journeyIds: ["JRN-04"],
      metricIds: ["MET-17"],
      guardrailIds: ["GRD-03"],
      thresholds: { criticalFailuresAllowed: 0 },
      ownerDecision: "pending",
      checks: [
        {
          id: "authority-unit",
          command: ["node", "--test", "example.test.mjs"]
        }
      ]
    }
  ]
};

test("rejects a manifest that permits a composite quality score", () => {
  assert.equal(typeof core.validateManifest, "function");
  assert.throws(
    () => core.validateManifest({
      ...validManifest,
      decisionPolicy: { ...validManifest.decisionPolicy, compositeScore: "allowed" }
    }),
    /compositeScore must be prohibited/
  );
});

test("rejects governed IDs that are absent from canonical definitions", () => {
  assert.equal(typeof core.validateGovernedReferences, "function");
  assert.throws(
    () => core.validateGovernedReferences(validManifest, {
      capabilityIds: new Set(["CAP-03"]),
      journeyIds: new Set(["JRN-04"]),
      metricIds: new Set(["MET-01"]),
      guardrailIds: new Set(["GRD-03"])
    }),
    /unknown metric ID MET-17/
  );
});

test("builds a receipt with independent evaluation results and no aggregate score", () => {
  assert.equal(typeof core.buildEvaluationReceipt, "function");
  const receipt = core.buildEvaluationReceipt({
    manifest: validManifest,
    candidate: {
      sha: "0123456789abcdef0123456789abcdef01234567",
      branch: "test-branch",
      dirty: false
    },
    environment: "local",
    recordedAt: "2026-09-19T18:00:00.000Z",
    results: [
      {
        evaluationId: "EVAL-001",
        status: "passed",
        checks: [{ id: "authority-unit", status: "passed", exitCode: 0 }]
      }
    ]
  });

  assert.equal(receipt.schemaVersion, "quotepilot-layered-eval-receipt-v1");
  assert.equal(receipt.candidate.sha, "0123456789abcdef0123456789abcdef01234567");
  assert.equal(receipt.results[0].dimension, "authority_integrity");
  assert.deepEqual(receipt.failures, []);
  assert.equal("score" in receipt, false);
  assert.equal("aggregateScore" in receipt, false);
});

test("keeps a failed blocking dimension explicit in the receipt", () => {
  const receipt = core.buildEvaluationReceipt({
    manifest: validManifest,
    candidate: {
      sha: "0123456789abcdef0123456789abcdef01234567",
      branch: "test-branch",
      dirty: true
    },
    environment: "local",
    recordedAt: "2026-09-19T18:00:00.000Z",
    results: [
      {
        evaluationId: "EVAL-001",
        status: "failed",
        checks: [{ id: "authority-unit", status: "failed", exitCode: 1 }]
      }
    ]
  });

  assert.deepEqual(receipt.failures, [
    {
      evaluationId: "EVAL-001",
      dimension: "authority_integrity",
      checkId: "authority-unit",
      exitCode: 1
    }
  ]);
  assert.equal(receipt.results[0].releaseBlocking, true);
});

test("dry-run emits a receipt without executing evaluation commands", () => {
  const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../..");
  assert.equal(typeof runner.createDryRunReceipt, "function");
  const receipt = runner.createDryRunReceipt({ root, environment: "local" });
  assert.equal(receipt.schemaVersion, "quotepilot-layered-eval-receipt-v1");
  assert.equal(receipt.results.every((result) => result.status === "not_run"), true);
  assert.equal(receipt.failures.length, 0);
});

test("first-slice receipts cannot claim a higher evidence environment", () => {
  const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../..");
  assert.throws(
    () => runner.createDryRunReceipt({ root, environment: "production" }),
    /Unsupported environment: production/
  );
});
