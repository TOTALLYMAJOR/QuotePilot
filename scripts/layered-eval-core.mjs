const MANIFEST_SCHEMA = "quotepilot-layered-eval-manifest-v1";
const RECEIPT_SCHEMA = "quotepilot-layered-eval-receipt-v1";
const EVIDENCE_CLASSES = new Set([
  "source",
  "local",
  "ci",
  "hosted",
  "provider",
  "production",
  "human",
  "outcome"
]);
const EXECUTION_MODES = new Set(["automated", "manual"]);
const OWNER_DECISIONS = new Set(["pending", "adopt", "revise", "stop", "investigate"]);

function fail(message) {
  throw new Error(`Layered evaluation manifest: ${message}`);
}

function assertIdList(evaluation, key, pattern) {
  const values = evaluation[key];
  if (!Array.isArray(values) || !values.length || values.some((value) => !pattern.test(value))) {
    fail(`${evaluation.id}.${key} must contain governed IDs`);
  }
}

export function validateManifest(manifest) {
  if (!manifest || typeof manifest !== "object" || Array.isArray(manifest)) fail("root must be an object");
  if (manifest.schemaVersion !== MANIFEST_SCHEMA) fail(`schemaVersion must be ${MANIFEST_SCHEMA}`);
  if (!/^\d{4}-\d{2}-\d{2}(?:\.\d+)?$/.test(manifest.corpusVersion || "")) {
    fail("corpusVersion must be a dated version");
  }
  if (manifest.decisionPolicy?.compositeScore !== "prohibited") {
    fail("decisionPolicy.compositeScore must be prohibited");
  }
  if (manifest.decisionPolicy?.ownerDecisionRequired !== true) {
    fail("decisionPolicy.ownerDecisionRequired must be true");
  }
  if (!Array.isArray(manifest.evaluations) || !manifest.evaluations.length) fail("evaluations must not be empty");

  const ids = new Set();
  for (const evaluation of manifest.evaluations) {
    if (!/^EVAL-\d{3}$/.test(evaluation?.id || "")) fail("every evaluation needs an EVAL-### id");
    if (ids.has(evaluation.id)) fail(`duplicate evaluation id ${evaluation.id}`);
    ids.add(evaluation.id);
    if (!evaluation.name || !evaluation.dimension) fail(`${evaluation.id} needs a name and dimension`);
    if (!EXECUTION_MODES.has(evaluation.execution)) fail(`${evaluation.id}.execution is invalid`);
    if (typeof evaluation.releaseBlocking !== "boolean") fail(`${evaluation.id}.releaseBlocking must be boolean`);
    if (!EVIDENCE_CLASSES.has(evaluation.evidenceClass)) fail(`${evaluation.id}.evidenceClass is invalid`);
    if (!OWNER_DECISIONS.has(evaluation.ownerDecision)) fail(`${evaluation.id}.ownerDecision is invalid`);
    if (!evaluation.thresholds || typeof evaluation.thresholds !== "object" || Array.isArray(evaluation.thresholds)) {
      fail(`${evaluation.id}.thresholds must be an object`);
    }
    assertIdList(evaluation, "capabilityIds", /^CAP-\d{2,3}$/);
    assertIdList(evaluation, "journeyIds", /^JRN-\d{2,3}$/);
    assertIdList(evaluation, "metricIds", /^MET-\d{2,3}$/);
    assertIdList(evaluation, "guardrailIds", /^GRD-\d{2,3}$/);

    if (evaluation.execution === "automated") {
      if (!Array.isArray(evaluation.checks) || !evaluation.checks.length) {
        fail(`${evaluation.id}.checks must not be empty for automated evaluations`);
      }
      for (const check of evaluation.checks) {
        if (!check?.id || !Array.isArray(check.command) || !check.command.length
          || check.command.some((token) => typeof token !== "string" || !token)) {
          fail(`${evaluation.id} has an invalid automated check`);
        }
      }
    } else if (!Array.isArray(evaluation.acceptanceCriteria) || !evaluation.acceptanceCriteria.length) {
      fail(`${evaluation.id}.acceptanceCriteria must not be empty for manual evaluations`);
    }
  }

  return manifest;
}

export function validateGovernedReferences(manifest, definitions) {
  validateManifest(manifest);
  const fields = [
    ["capabilityIds", "capability"],
    ["journeyIds", "journey"],
    ["metricIds", "metric"],
    ["guardrailIds", "guardrail"]
  ];
  for (const evaluation of manifest.evaluations) {
    for (const [field, label] of fields) {
      const known = definitions[field];
      if (!(known instanceof Set)) throw new Error(`Missing canonical ${label} definitions.`);
      for (const id of evaluation[field]) {
        if (!known.has(id)) throw new Error(`${evaluation.id} references unknown ${label} ID ${id}`);
      }
    }
  }
  return manifest;
}

export function buildEvaluationReceipt({ manifest, candidate, environment, recordedAt, results }) {
  validateManifest(manifest);
  const byId = new Map(manifest.evaluations.map((evaluation) => [evaluation.id, evaluation]));
  const normalizedResults = results.map((result) => {
    const evaluation = byId.get(result.evaluationId);
    if (!evaluation) throw new Error(`Unknown evaluation result: ${result.evaluationId}`);
    return {
      evaluationId: evaluation.id,
      name: evaluation.name,
      dimension: evaluation.dimension,
      releaseBlocking: evaluation.releaseBlocking,
      evidenceClass: evaluation.evidenceClass,
      status: result.status,
      checks: result.checks || [],
      ownerDecision: evaluation.ownerDecision
    };
  });
  const failures = normalizedResults.flatMap((result) => result.checks
    .filter((check) => check.status === "failed")
    .map((check) => ({
      evaluationId: result.evaluationId,
      dimension: result.dimension,
      checkId: check.id,
      exitCode: check.exitCode
    })));

  return {
    schemaVersion: RECEIPT_SCHEMA,
    manifestSchemaVersion: manifest.schemaVersion,
    corpusVersion: manifest.corpusVersion,
    recordedAt,
    environment,
    candidate,
    results: normalizedResults,
    blockingDimensions: normalizedResults
      .filter((result) => result.releaseBlocking)
      .map(({ evaluationId, dimension, status }) => ({ evaluationId, dimension, status })),
    failures,
    ownerDecisionRequired: manifest.decisionPolicy.ownerDecisionRequired,
    evidenceBoundary: "Evaluation receipts are evidence in their declared class, not deployment, human acceptance, or outcome proof."
  };
}
