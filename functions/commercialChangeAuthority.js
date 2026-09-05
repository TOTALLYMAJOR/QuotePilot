"use strict";

const { createHash } = require("node:crypto");

const COMMERCIAL_CHANGE_AUTHORITY_VERSION = "commercial-change-authority-v1";
const COMMERCIAL_CHANGE_SIMULATION_RECEIPT_VERSION =
  "commercial-change-simulation-receipt-v1";
const COMMERCIAL_CHANGE_AUTHORIZATION_RECEIPT_VERSION =
  "commercial-change-authorization-receipt-v1";
const COMMERCIAL_CHANGE_APPLY_RECEIPT_VERSION =
  "commercial-change-apply-receipt-v1";
const COMMERCIAL_CHANGE_APPLY_OUTCOME_RECEIPT_VERSION =
  "commercial-change-apply-outcome-receipt-v1";
const COMMERCIAL_CHANGE_INVALIDATION_RECEIPT_VERSION =
  "commercial-change-invalidation-receipt-v1";
const COMMERCIAL_CHANGE_RECONCILIATION_RECEIPT_VERSION =
  "commercial-change-reconciliation-receipt-v1";
const COMMERCIAL_CHANGE_RECONCILIATION_EVIDENCE_VERSION =
  "commercial-change-reconciliation-evidence-v1";
const COMMERCIAL_CHANGE_PUBLISH_GATE_VERSION =
  "commercial-change-publish-gate-v1";

const WORKFLOW_RECEIPT_SCHEMAS = Object.freeze({
  simulation: "commercial-change-simulation-receipt-v2",
  authorization: "commercial-change-authorization-receipt-v2",
  apply: "commercial-change-apply-receipt-v2"
});

// Currency minor-unit conversion belongs to this authority, never a browser
// threshold evaluator. Decimal-string half-up rounding avoids binary 1.005
// becoming 100 cents and keeps existing dollar-valued pricing unchanged.
function authoritativeMoneyToCents(value) {
  if (typeof value !== "number" || !Number.isFinite(value) || value < 0 || value > 1e12) {
    fail("failed-precondition", "An explicit bounded authoritative USD total is required.");
  }
  const [coefficient, exponent = "0"] = String(value).toLowerCase().split("e");
  const fraction = (coefficient.split(".")[1] || "").length;
  const digits = BigInt(coefficient.replace(".", ""));
  const scale = Number(exponent) - fraction + 2;
  const denominator = scale < 0 ? 10n ** BigInt(-scale) : 1n;
  const cents = scale < 0 ? (digits + denominator / 2n) / denominator : digits * 10n ** BigInt(scale);
  if (cents > BigInt(Number.MAX_SAFE_INTEGER)) fail("failed-precondition", "Authoritative cents exceed safe integer bounds.");
  return Number(cents);
}
function workflowFields(value, fields, label) {
  if (!isRecord(value) || Object.keys(value).length !== fields.length || fields.some((key) => !Object.hasOwn(value, key))) {
    fail("failed-precondition", `${label} contains missing or unsupported fields.`);
  }
}
function workflowString(value, validator, label) {
  if (typeof value !== "string" || validator(value, label) !== value) fail("failed-precondition", `${label} must be an exact canonical string.`);
}
function normalizeWorkflowPolicy(value, organizationId) {
  if (value === null || value === undefined) return null;
  workflowFields(value, ["organizationId", "definitionPin", "approvalPolicy", "declaredBy", "declaredAtISO"], "Workflow approval policy");
  if (value.organizationId !== organizationId) fail("permission-denied", "Workflow policy belongs to another organization.");
  const pin = value.definitionPin;
  workflowFields(pin, ["workflowKind", "schemaVersion", "definitionId", "versionId", "version", "definitionDigest"], "Workflow definition pin");
  if (pin.workflowKind !== "quote_review" || pin.definitionId !== "quote_review" || pin.schemaVersion !== 2
    || !Number.isSafeInteger(pin.version) || pin.version < 1 || pin.version > 50 || pin.versionId !== `quote_review_v${pin.version}`) {
    fail("failed-precondition", "An exact tenant-published quote review version is required.");
  }
  workflowString(pin.definitionDigest, exactDigest, "Workflow definition digest");
  const policy = value.approvalPolicy;
  workflowFields(policy, ["basis", "thresholdCents", "allowedRoles"], "Workflow approval policy fields");
  if (policy.basis !== "absolute_total_delta_cents" || (policy.thresholdCents !== null
    && (!Number.isSafeInteger(policy.thresholdCents) || policy.thresholdCents < 0 || policy.thresholdCents > 1e9))
    || !Array.isArray(policy.allowedRoles) || !policy.allowedRoles.includes("admin") || policy.allowedRoles.length > 2
    || new Set(policy.allowedRoles).size !== policy.allowedRoles.length || policy.allowedRoles.some((role) => !["admin", "sales"].includes(role))) {
    fail("failed-precondition", "Workflow approval thresholds and roles must be explicitly bounded.");
  }
  workflowString(value.declaredBy, exactOpaqueId, "Workflow policy declaring actor");
  workflowString(value.declaredAtISO, exactISO, "Workflow policy declaration time");
  return { organizationId, definitionPin: { ...pin }, approvalPolicy: { ...policy, allowedRoles: [...policy.allowedRoles].sort() }, declaredBy: value.declaredBy, declaredAtISO: value.declaredAtISO };
}
function normalizeAttendanceBinding(value, scope, baseRevisionId) {
  if (value === null || value === undefined) return null;
  workflowFields(value, ["organizationId", "quoteId", "sourceVersionId", "acceptanceReceiptId", "submissionReceiptId", "submissionReceiptDigest", "count"], "Attendance submission binding");
  if (value.organizationId !== scope.organizationId || value.quoteId !== scope.quoteId) fail("permission-denied", "Attendance submission belongs to another quote or organization.");
  if (value.sourceVersionId !== baseRevisionId) fail("aborted", "Attendance submission does not match the exact commercial base revision.");
  for (const key of ["sourceVersionId", "acceptanceReceiptId", "submissionReceiptId"]) workflowString(value[key], exactOpaqueId, `Attendance ${key}`);
  workflowString(value.submissionReceiptDigest, exactDigest, "Attendance submission digest");
  if (!Number.isSafeInteger(value.count) || value.count < 1 || value.count > 400) fail("failed-precondition", "A submitted guest count from 1 to 400 is required.");
  return { ...value };
}
function workflowApprovalEvaluation(commercialValues, impact, policy) {
  if (commercialValues?.currency !== "USD" || commercialValues?.authoritativeTotal?.authority !== "server_authoritative"
    || !Number.isSafeInteger(impact?.counts?.total) || impact.counts.total < 0 || impact.counts.total > MAX_INVALIDATIONS) {
    fail("failed-precondition", "Workflow approval requires authoritative USD commercial values.");
  }
  const beforeTotalCents = authoritativeMoneyToCents(commercialValues.authoritativeTotal.before);
  const proposedTotalCents = authoritativeMoneyToCents(commercialValues.authoritativeTotal.proposedAfter);
  const absoluteTotalDeltaCents = Math.abs(proposedTotalCents - beforeTotalCents);
  const threshold = policy?.approvalPolicy.thresholdCents ?? null;
  return { currency: "USD", beforeTotalCents, proposedTotalCents, absoluteTotalDeltaCents,
    impactApprovalRequired: impact.counts.total > 0,
    thresholdApprovalRequired: threshold !== null && absoluteTotalDeltaCents >= threshold };
}
function workflowSeal(receipt) {
  return receipt.schemaVersion === WORKFLOW_RECEIPT_SCHEMAS[receipt.receiptType]
    ? { workflowPolicy: receipt.workflowPolicy, attendanceBinding: receipt.attendanceBinding, approvalEvaluation: receipt.approvalEvaluation }
    : {};
}
function validateWorkflowSeal(receipt, graphCore) {
  const v2 = receipt.schemaVersion === WORKFLOW_RECEIPT_SCHEMAS[receipt.receiptType];
  if (!v2) {
    if (["workflowPolicy", "attendanceBinding", "approvalEvaluation"].some((key) => Object.hasOwn(receipt, key))) fail("failed-precondition", "Version 1 receipts cannot assert workflow policy or attendance application.");
    return;
  }
  const policy = normalizeWorkflowPolicy(receipt.workflowPolicy, receipt.organizationId);
  const attendance = normalizeAttendanceBinding(receipt.attendanceBinding, receipt, receipt.baseRevisionId);
  if (!policy && !attendance) fail("failed-precondition", "Version 2 requires an explicit workflow or attendance binding.");
  if (!Object.hasOwn(receipt, "workflowPolicy") || !Object.hasOwn(receipt, "attendanceBinding")
    || graphCore.canonicalSerialize(policy) !== graphCore.canonicalSerialize(receipt.workflowPolicy)
    || graphCore.canonicalSerialize(attendance) !== graphCore.canonicalSerialize(receipt.attendanceBinding)) fail("failed-precondition", "Workflow bindings are not canonical.");
  const evaluation = receipt.approvalEvaluation;
  workflowFields(evaluation, ["currency", "beforeTotalCents", "proposedTotalCents", "absoluteTotalDeltaCents", "impactApprovalRequired", "thresholdApprovalRequired"], "Approval evaluation");
  if (evaluation.currency !== "USD" || [evaluation.beforeTotalCents, evaluation.proposedTotalCents].some((n) => !Number.isSafeInteger(n) || n < 0 || n > 1e14)
    || evaluation.absoluteTotalDeltaCents !== Math.abs(evaluation.proposedTotalCents - evaluation.beforeTotalCents)
    || typeof evaluation.impactApprovalRequired !== "boolean"
    || evaluation.thresholdApprovalRequired !== (policy?.approvalPolicy.thresholdCents !== null && policy !== null && evaluation.absoluteTotalDeltaCents >= policy.approvalPolicy.thresholdCents)) fail("failed-precondition", "Workflow approval evaluation is inconsistent.");
  const actor = receipt.simulatedBy || receipt.appliedBy || receipt.authorizedFor;
  if (policy && !policy.approvalPolicy.allowedRoles.includes(actor?.role)) fail("permission-denied", "The pinned workflow policy excludes this commercial participant role.");
  const at = receipt.simulatedAtISO || receipt.appliedAtISO || receipt.authorizedAtISO;
  if (policy && policy.declaredAtISO > at) fail("failed-precondition", "The workflow policy was not yet published.");
}
function assertWorkflowSealMatch(left, right, graphCore) {
  if (graphCore.canonicalSerialize(workflowSeal(left)) !== graphCore.canonicalSerialize(workflowSeal(right))) fail("failed-precondition", "Commercial receipts do not share the exact workflow and attendance binding.");
}

const COMMERCIAL_CHANGE_AUTHORITY = "server_authoritative";
const COMMERCIAL_CHANGE_DERIVED_AUTHORITY = "server_derived";
const DEFAULT_SIMULATION_TTL_MS = 15 * 60 * 1000;
const MIN_SIMULATION_TTL_MS = 60 * 1000;
const MAX_SIMULATION_TTL_MS = 30 * 60 * 1000;
const MAX_RECEIPT_BYTES = 262_144;
const MAX_INVALIDATIONS = 64;
const MAX_RECONCILIATIONS = 64;

const COMMERCIAL_CHANGE_AUTHORITY_BOUNDARY =
  "This receipt records only the named server-side commercial change operation. It does not publish, regenerate, deliver, accept, book, charge, pay, or complete any dependent artifact or decision.";
const COMMERCIAL_CHANGE_PUBLISH_BOUNDARY =
  "safeToPublish is deterministic eligibility only. It does not publish a proposal, BEO, payment request, portal revision, provider message, or any other artifact.";
const COMMERCIAL_CHANGE_APPLY_OUTCOME_BOUNDARY =
  "This receipt proves only whether the exact governed quote apply committed. A not-committed receipt fences that request identity from any later apply; neither outcome publishes, delivers, accepts, books, charges, pays, regenerates, or completes dependent work.";

const REQUEST_PATTERNS = Object.freeze({
  simulation: /^change_sim_[a-f0-9]{32}$/u,
  authorization: /^change_auth_[a-f0-9]{32}$/u,
  apply: /^change_apply_[a-f0-9]{32}$/u,
  reconciliation: /^change_reconcile_[a-f0-9]{32}$/u
});

const RECEIPT_SCHEMAS = Object.freeze({
  simulation: COMMERCIAL_CHANGE_SIMULATION_RECEIPT_VERSION,
  authorization: COMMERCIAL_CHANGE_AUTHORIZATION_RECEIPT_VERSION,
  apply: COMMERCIAL_CHANGE_APPLY_RECEIPT_VERSION,
  outcome: COMMERCIAL_CHANGE_APPLY_OUTCOME_RECEIPT_VERSION,
  invalidation: COMMERCIAL_CHANGE_INVALIDATION_RECEIPT_VERSION,
  reconciliation: COMMERCIAL_CHANGE_RECONCILIATION_RECEIPT_VERSION
});

const RECEIPT_ID_PREFIXES = Object.freeze({
  simulation: "ccs",
  authorization: "cca",
  apply: "ccp",
  outcome: "ccor",
  invalidation: "cci",
  reconciliation: "ccr"
});

const ALLOWED_RESOLUTIONS = Object.freeze({
  artifact: new Set(["artifact_current", "artifact_not_generated"]),
  projection: new Set(["projection_current"]),
  output: new Set(["decision_resolved", "output_recomputed"]),
  fact: new Set(["fact_confirmed"])
});

class CommercialChangeAuthorityError extends Error {
  constructor(code, message, details = {}) {
    super(message);
    this.name = "CommercialChangeAuthorityError";
    this.code = code;
    this.details = details;
  }
}

function fail(code, message, details = {}) {
  throw new CommercialChangeAuthorityError(code, message, details);
}

function isRecord(value) {
  if (!value || typeof value !== "object" || Array.isArray(value)) return false;
  const prototype = Object.getPrototypeOf(value);
  return prototype === Object.prototype || prototype === null;
}

function compareText(left, right) {
  return left < right ? -1 : left > right ? 1 : 0;
}

function text(value) {
  return String(value ?? "").trim();
}

function deepFreeze(value, seen = new WeakSet()) {
  if (!value || typeof value !== "object" || seen.has(value)) return value;
  seen.add(value);
  Reflect.ownKeys(value).forEach((key) => deepFreeze(value[key], seen));
  return Object.freeze(value);
}

function exactOpaqueId(value, label, maximum = 256) {
  const normalized = text(value);
  if (
    !normalized
    || normalized.length > maximum
    || /[\s/?#\\\u0000]/u.test(normalized)
    || normalized === "."
    || normalized === ".."
    || /^[^@\s]+@[^@\s]+$/u.test(normalized)
  ) {
    fail("invalid-argument", `${label} must be an exact opaque identifier.`);
  }
  return normalized;
}

function exactRequestId(value, kind) {
  const normalized = text(value).toLowerCase();
  if (!REQUEST_PATTERNS[kind]?.test(normalized)) {
    fail("invalid-argument", `${kind} requestId is invalid.`);
  }
  return normalized;
}

function exactDigest(value, label) {
  const normalized = text(value).toLowerCase();
  if (!/^[a-f0-9]{64}$/u.test(normalized)) {
    fail("failed-precondition", `${label} must be a trusted SHA-256 digest.`);
  }
  return normalized;
}

function exactISO(value, label) {
  const normalized = text(value);
  const parsed = new Date(normalized);
  if (!normalized || Number.isNaN(parsed.getTime()) || parsed.toISOString() !== normalized) {
    fail("failed-precondition", `${label} must be an exact server ISO timestamp.`);
  }
  return normalized;
}

function exactPositiveInteger(value, label, maximum = 1_000_000) {
  const number = Number(value);
  if (!Number.isSafeInteger(number) || number < 0 || number > maximum) {
    fail("failed-precondition", `${label} is invalid.`);
  }
  return number;
}

function normalizeActor(actor, { adminOnly = false } = {}) {
  if (!isRecord(actor)) {
    fail("failed-precondition", "A trusted staff actor is required.");
  }
  const uid = text(actor.uid);
  const email = text(actor.email).toLowerCase();
  const role = text(actor.role).toLowerCase();
  if (
    !uid
    || uid.length > 128
    || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/u.test(email)
    || !["admin", "sales"].includes(role)
  ) {
    fail("permission-denied", "A valid staff actor is required.");
  }
  if (adminOnly && role !== "admin") {
    fail("permission-denied", "Admin authority is required to authorize this commercial change.");
  }
  return { uid, email, role };
}

function normalizeTrustedContext(context, options = {}) {
  if (!isRecord(context)) {
    fail("failed-precondition", "Trusted commercial change context is required.");
  }
  return {
    actor: normalizeActor(context.actor, options),
    nowISO: exactISO(context.nowISO, "Commercial change server time"),
    catalogAuthorityDigest: exactDigest(
      context.catalogAuthorityDigest,
      "Catalog authority digest"
    ),
    policyVersion: exactOpaqueId(context.policyVersion, "policyVersion", 128)
  };
}

function canonicalDocument(value, graphCore, label, maximum = MAX_RECEIPT_BYTES) {
  let canonical;
  try {
    canonical = graphCore.canonicalSerialize(value);
  } catch {
    fail("failed-precondition", `${label} is not canonical JSON.`);
  }
  const byteLength = Buffer.byteLength(canonical, "utf8");
  if (byteLength > maximum) {
    fail("resource-exhausted", `${label} exceeds the bounded authority size.`, {
      byteLength,
      maximum
    });
  }
  return { canonical, byteLength };
}

function canonicalClone(value, graphCore, label, maximum = MAX_RECEIPT_BYTES) {
  const { canonical } = canonicalDocument(value, graphCore, label, maximum);
  return JSON.parse(canonical);
}

function sha256Canonical(value, graphCore, label) {
  const { canonical } = canonicalDocument(value, graphCore, label);
  return createHash("sha256").update(canonical).digest("hex");
}

function deterministicId(prefix, value, graphCore, label) {
  return `${prefix}_${sha256Canonical(value, graphCore, label).slice(0, 48)}`;
}

function receiptIdentity(type, { organizationId, quoteId, requestId, discriminator = "" }, graphCore) {
  return deterministicId(RECEIPT_ID_PREFIXES[type], {
    schemaVersion: RECEIPT_SCHEMAS[type],
    organizationId,
    quoteId,
    requestId,
    discriminator
  }, graphCore, `${type} receipt identity`);
}

function applyIdentity(request, graphCore) {
  const scope = requestScope(request, "apply");
  return deepFreeze({
    ...scope,
    applyReceiptId: receiptIdentity("apply", scope, graphCore),
    operationId: deterministicId("cco", {
      schemaVersion: COMMERCIAL_CHANGE_APPLY_RECEIPT_VERSION,
      organizationId: scope.organizationId,
      quoteId: scope.quoteId,
      requestId: scope.requestId
    }, graphCore, "Commercial change operation identity"),
    outcomeReceiptId: receiptIdentity("outcome", scope, graphCore)
  });
}

function addReceiptDigest(payload, graphCore) {
  const detached = canonicalClone(payload, graphCore, `${payload.receiptType} receipt`);
  const receiptDigest = sha256Canonical(detached, graphCore, `${payload.receiptType} receipt digest`);
  return deepFreeze({ ...detached, receiptDigest });
}

function assertReceiptIntegrity(receipt, type, graphCore) {
  if (
    !isRecord(receipt)
    || (receipt.schemaVersion !== RECEIPT_SCHEMAS[type] && !(Object.hasOwn(WORKFLOW_RECEIPT_SCHEMAS, type) && receipt.schemaVersion === WORKFLOW_RECEIPT_SCHEMAS[type]))
    || receipt.authority !== COMMERCIAL_CHANGE_AUTHORITY
    || receipt.receiptType !== type
    || !new RegExp(`^${RECEIPT_ID_PREFIXES[type]}_[a-f0-9]{48}$`, "u")
      .test(text(receipt.receiptId))
  ) {
    fail("failed-precondition", `Trusted ${type} receipt is invalid.`);
  }
  const suppliedDigest = exactDigest(receipt.receiptDigest, `${type} receipt digest`);
  const detached = { ...receipt };
  delete detached.receiptDigest;
  if (sha256Canonical(detached, graphCore, `${type} receipt digest`) !== suppliedDigest) {
    fail("failed-precondition", `Trusted ${type} receipt failed immutable digest validation.`);
  }
  canonicalDocument(receipt, graphCore, `${type} receipt`);
  if (["simulation", "authorization", "apply"].includes(type)) validateWorkflowSeal(receipt, graphCore);
  return deepFreeze(canonicalClone(receipt, graphCore, `${type} receipt`));
}

function requestScope(request, kind) {
  if (!isRecord(request)) fail("invalid-argument", `${kind} request is required.`);
  return {
    requestId: exactRequestId(request.requestId, kind),
    organizationId: exactOpaqueId(request.organizationId, "organizationId"),
    quoteId: exactOpaqueId(request.quoteId, "quoteId")
  };
}

function assertScope(receipt, scope, label) {
  if (
    text(receipt.organizationId) !== scope.organizationId
    || text(receipt.quoteId) !== scope.quoteId
  ) {
    fail("permission-denied", `${label} is outside the requested organization and quote scope.`);
  }
}

function translateDependencyError(error, fallback) {
  if (error instanceof CommercialChangeAuthorityError) throw error;
  const code = text(error?.code) || "failed-precondition";
  const allowedCode = new Set([
    "aborted",
    "already-exists",
    "failed-precondition",
    "invalid-argument",
    "permission-denied",
    "resource-exhausted"
  ]).has(code) ? code : "failed-precondition";
  fail(allowedCode, text(error?.message) || fallback);
}

function normalizeImpactResult({ impactResult, preview, graphCore }) {
  if (
    !isRecord(impactResult)
    || impactResult.schemaVersion !== "commercial-change-impact-v1"
    || impactResult.advisory !== true
    || !isRecord(impactResult.identity)
    || !isRecord(impactResult.graph)
    || !isRecord(impactResult.impact)
  ) {
    fail("failed-precondition", "Server commercial change simulation result is invalid.");
  }
  if (
    graphCore.canonicalSerialize(impactResult.identity)
      !== graphCore.canonicalSerialize(preview.identity)
    || impactResult.graph.graphId !== graphCore.COMMERCIAL_DEPENDENCY_GRAPH_ID
    || impactResult.graph.graphVersion !== graphCore.COMMERCIAL_DEPENDENCY_GRAPH_VERSION
  ) {
    fail("failed-precondition", "Server commercial change simulation identity or graph is invalid.");
  }
  const roots = Array.isArray(impactResult.impact.rootNodeIds)
    ? [...new Set(impactResult.impact.rootNodeIds.map((value) => text(value)))].sort(compareText)
    : null;
  if (!roots || roots.some((nodeId) => !nodeId)) {
    fail("failed-precondition", "Server commercial change simulation roots are invalid.");
  }
  let evaluated;
  try {
    evaluated = graphCore.evaluateCommercialDependencyImpact({
      registry: graphCore.COMMERCIAL_DEPENDENCY_GRAPH_V1,
      changedNodeIds: roots
    });
  } catch (error) {
    translateDependencyError(error, "Commercial dependency impact could not be verified.");
  }
  if (evaluated.affectedNodes.length > MAX_INVALIDATIONS) {
    fail("resource-exhausted", "Commercial dependency impact exceeds the invalidation bound.");
  }
  const suppliedNodes = Array.isArray(impactResult.impact.dependentNodes)
    ? [...impactResult.impact.dependentNodes]
    : [];
  const suppliedById = new Map(suppliedNodes.map((node) => [text(node?.id), node]));
  if (suppliedById.size !== suppliedNodes.length) {
    fail("failed-precondition", "Commercial dependency impact contains duplicate nodes.");
  }
  const dependentNodes = evaluated.affectedNodes.map((node) => {
    const supplied = suppliedById.get(node.id);
    const expectedClassification = ["artifact", "projection"].includes(node.kind)
      ? "STALE"
      : "REVIEW";
    if (
      !supplied
      || supplied.kind !== node.kind
      || Number(supplied.distance) !== node.distance
      || text(supplied.advisoryClass).toUpperCase() !== expectedClassification
      || graphCore.canonicalSerialize(supplied.triggeredBy)
        !== graphCore.canonicalSerialize(node.triggeredBy)
    ) {
      fail("failed-precondition", `Commercial dependency impact node ${node.id} is invalid.`);
    }
    return {
      nodeId: node.id,
      nodeKind: node.kind,
      distance: node.distance,
      triggeredBy: [...node.triggeredBy],
      classification: expectedClassification
    };
  });
  if (suppliedById.size !== dependentNodes.length) {
    fail("failed-precondition", "Commercial dependency impact contains undeclared nodes.");
  }
  const factDiffs = canonicalClone(
    Array.isArray(impactResult.factDiffs) ? impactResult.factDiffs : [],
    graphCore,
    "Commercial change fact differences"
  );
  const commercialValues = canonicalClone(
    impactResult.commercialValues || {},
    graphCore,
    "Commercial change values"
  );
  const normalized = {
    rootNodeIds: roots,
    dependentNodes,
    counts: {
      total: dependentNodes.length,
      review: dependentNodes.filter((node) => node.classification === "REVIEW").length,
      stale: dependentNodes.filter((node) => node.classification === "STALE").length
    }
  };
  return { factDiffs, commercialValues, impact: normalized };
}

function validateSimulationReceipt(receipt, graphCore) {
  const normalized = assertReceiptIntegrity(receipt, "simulation", graphCore);
  exactRequestId(normalized.requestId, "simulation");
  const organizationId = exactOpaqueId(normalized.organizationId, "organizationId");
  const quoteId = exactOpaqueId(normalized.quoteId, "quoteId");
  exactOpaqueId(normalized.baseRevisionId, "baseRevisionId");
  exactOpaqueId(normalized.proposedRevisionId, "proposedRevisionId");
  exactDigest(normalized.proposalDigest, "Proposed change digest");
  exactDigest(normalized.impactDigest, "Commercial impact digest");
  exactDigest(normalized.catalogAuthorityDigest, "Catalog authority digest");
  exactOpaqueId(normalized.policyVersion, "policyVersion", 128);
  exactISO(normalized.simulatedAtISO, "Simulation time");
  exactISO(normalized.expiresAtISO, "Simulation expiry");
  normalizeActor(normalized.simulatedBy);
  const evaluation = normalized.schemaVersion === WORKFLOW_RECEIPT_SCHEMAS.simulation
    ? workflowApprovalEvaluation(normalized.commercialValues, normalized.impact, normalized.workflowPolicy) : null;
  if (evaluation && graphCore.canonicalSerialize(evaluation) !== graphCore.canonicalSerialize(normalized.approvalEvaluation)) fail("failed-precondition", "Simulation approval evaluation does not match authoritative totals.");
  if (normalized.authorizationRequired !== (evaluation
    ? evaluation.impactApprovalRequired || evaluation.thresholdApprovalRequired : normalized.impact?.counts?.total > 0)) {
    fail("failed-precondition", "Simulation authorization gate is invalid.");
  }
  const expectedId = receiptIdentity("simulation", {
    organizationId,
    quoteId,
    requestId: normalized.requestId
  }, graphCore);
  if (normalized.receiptId !== expectedId) {
    fail("failed-precondition", "Simulation receipt identity is invalid.");
  }
  return normalized;
}

function validateAuthorizationReceipt(receipt, graphCore) {
  const normalized = assertReceiptIntegrity(receipt, "authorization", graphCore);
  exactRequestId(normalized.requestId, "authorization");
  const organizationId = exactOpaqueId(normalized.organizationId, "organizationId");
  const quoteId = exactOpaqueId(normalized.quoteId, "quoteId");
  exactOpaqueId(normalized.baseRevisionId, "baseRevisionId");
  exactOpaqueId(normalized.proposedRevisionId, "proposedRevisionId");
  exactOpaqueId(normalized.simulationReceiptId, "simulationReceiptId");
  exactDigest(normalized.simulationDigest, "Simulation digest");
  exactDigest(normalized.proposalDigest, "Proposed change digest");
  exactDigest(normalized.catalogAuthorityDigest, "Catalog authority digest");
  exactOpaqueId(normalized.policyVersion, "policyVersion", 128);
  exactISO(normalized.authorizedAtISO, "Authorization time");
  exactISO(normalized.expiresAtISO, "Authorization expiry");
  normalizeActor(normalized.authorizedBy, { adminOnly: true });
  normalizeActor(normalized.authorizedFor);
  if (normalized.state !== "authorized") {
    fail("failed-precondition", "Commercial change authorization state is invalid.");
  }
  const expectedId = receiptIdentity("authorization", {
    organizationId,
    quoteId,
    requestId: normalized.requestId
  }, graphCore);
  if (normalized.receiptId !== expectedId) {
    fail("failed-precondition", "Authorization receipt identity is invalid.");
  }
  return normalized;
}

function validateInvalidationReceipt(receipt, graphCore) {
  const normalized = assertReceiptIntegrity(receipt, "invalidation", graphCore);
  const organizationId = exactOpaqueId(normalized.organizationId, "organizationId");
  const quoteId = exactOpaqueId(normalized.quoteId, "quoteId");
  exactOpaqueId(normalized.operationId, "operationId");
  exactOpaqueId(normalized.applyReceiptId, "applyReceiptId");
  exactOpaqueId(normalized.sourceRevisionId, "sourceRevisionId");
  exactOpaqueId(normalized.targetRevisionId, "targetRevisionId");
  const nodeId = exactOpaqueId(normalized.nodeId, "nodeId");
  const graphNode = graphCore.COMMERCIAL_DEPENDENCY_GRAPH_V1.nodes
    .find((node) => node.id === nodeId);
  if (
    !graphNode
    || graphNode.kind !== normalized.nodeKind
    || !["STALE", "REVIEW"].includes(normalized.classification)
    || normalized.initialState !== "open"
    || !Array.isArray(normalized.triggeredBy)
  ) {
    fail("failed-precondition", "Commercial dependency invalidation receipt is invalid.");
  }
  exactISO(normalized.createdAtISO, "Invalidation time");
  normalizeActor(normalized.createdBy);
  const expectedId = deterministicId(RECEIPT_ID_PREFIXES.invalidation, {
    schemaVersion: COMMERCIAL_CHANGE_INVALIDATION_RECEIPT_VERSION,
    organizationId,
    quoteId,
    operationId: normalized.operationId,
    nodeId
  }, graphCore, "invalidation receipt identity");
  if (normalized.receiptId !== expectedId || normalized.invalidationId !== expectedId) {
    fail("failed-precondition", "Invalidation receipt identity is invalid.");
  }
  return normalized;
}

function validateApplyReceipt(receipt, graphCore) {
  const normalized = assertReceiptIntegrity(receipt, "apply", graphCore);
  const requestId = exactRequestId(normalized.requestId, "apply");
  const organizationId = exactOpaqueId(normalized.organizationId, "organizationId");
  const quoteId = exactOpaqueId(normalized.quoteId, "quoteId");
  const operationId = exactOpaqueId(normalized.operationId, "operationId");
  exactOpaqueId(normalized.baseRevisionId, "baseRevisionId");
  exactOpaqueId(normalized.newRevisionId, "newRevisionId");
  exactOpaqueId(normalized.simulationReceiptId, "simulationReceiptId");
  exactDigest(normalized.simulationDigest, "Simulation digest");
  exactDigest(normalized.proposalDigest, "Proposed change digest");
  const authorizationReceiptId = text(normalized.authorizationReceiptId);
  const authorizationReceiptDigest = text(normalized.authorizationReceiptDigest);
  if (authorizationReceiptId) {
    exactOpaqueId(authorizationReceiptId, "authorizationReceiptId");
    exactDigest(authorizationReceiptDigest, "Authorization receipt digest");
  } else if (authorizationReceiptDigest) {
    fail("failed-precondition", "Apply authorization evidence is inconsistent.");
  }
  exactISO(normalized.appliedAtISO, "Apply time");
  normalizeActor(normalized.appliedBy);
  if (!Array.isArray(normalized.invalidationReceipts)) {
    fail("failed-precondition", "Apply invalidation receipts are invalid.");
  }
  if (normalized.invalidationReceipts.length > MAX_INVALIDATIONS) {
    fail("resource-exhausted", "Apply invalidation receipts exceed the bound.");
  }
  normalized.invalidationReceipts.forEach((item) => {
    const invalidation = validateInvalidationReceipt(item, graphCore);
    if (
      invalidation.applyReceiptId !== normalized.receiptId
      || invalidation.operationId !== normalized.operationId
      || invalidation.organizationId !== organizationId
      || invalidation.quoteId !== quoteId
      || invalidation.sourceRevisionId !== normalized.baseRevisionId
      || invalidation.targetRevisionId !== normalized.newRevisionId
    ) {
      fail("failed-precondition", "Apply invalidation scope is invalid.");
    }
  });
  const invalidationIds = normalized.invalidationReceipts.map((item) => item.invalidationId);
  if (new Set(invalidationIds).size !== invalidationIds.length) {
    fail("failed-precondition", "Apply invalidation receipts contain duplicate identities.");
  }
  if (
    !Array.isArray(normalized.decisionOpenings)
    || normalized.decisionOpenings.length > MAX_INVALIDATIONS
  ) {
    fail("failed-precondition", "Apply decision openings are invalid.");
  }
  const reviewInvalidations = new Map(normalized.invalidationReceipts
    .filter((item) => item.classification === "REVIEW")
    .map((item) => [item.invalidationId, item]));
  const decisionIds = new Set();
  const decisionInvalidationIds = new Set();
  normalized.decisionOpenings.forEach((decision) => {
    const decisionId = exactOpaqueId(decision?.decisionId, "decisionId");
    const invalidationId = exactOpaqueId(decision?.invalidationId, "decision invalidationId");
    const nodeId = exactOpaqueId(decision?.nodeId, "decision nodeId");
    if (
      decision?.state !== "open"
      || !reviewInvalidations.has(invalidationId)
      || reviewInvalidations.get(invalidationId).nodeId !== nodeId
      || decisionIds.has(decisionId)
      || decisionInvalidationIds.has(invalidationId)
    ) {
      fail("failed-precondition", "Apply decision opening scope is invalid.");
    }
    decisionIds.add(decisionId);
    decisionInvalidationIds.add(invalidationId);
  });
  if (decisionInvalidationIds.size !== reviewInvalidations.size) {
    fail("failed-precondition", "Apply decision openings do not cover the exact REVIEW set.");
  }
  if (
    normalized.safeToPublish !== (normalized.invalidationReceipts.length === 0)
    || normalized.authorizationConsumed !== Boolean(normalized.authorizationReceiptId)
  ) {
    fail("failed-precondition", "Apply receipt gates are invalid.");
  }
  const expectedId = receiptIdentity("apply", {
    organizationId,
    quoteId,
    requestId
  }, graphCore);
  const expectedOperationId = deterministicId("cco", {
    schemaVersion: COMMERCIAL_CHANGE_APPLY_RECEIPT_VERSION,
    organizationId,
    quoteId,
    requestId
  }, graphCore, "Commercial change operation identity");
  if (normalized.receiptId !== expectedId || operationId !== expectedOperationId) {
    fail("failed-precondition", "Apply receipt identity is invalid.");
  }
  return normalized;
}

function validateApplyOutcomeReceipt(receipt, graphCore) {
  const normalized = assertReceiptIntegrity(receipt, "outcome", graphCore);
  const requestId = exactRequestId(normalized.requestId, "apply");
  const organizationId = exactOpaqueId(normalized.organizationId, "organizationId");
  const quoteId = exactOpaqueId(normalized.quoteId, "quoteId");
  const identity = applyIdentity({ requestId, organizationId, quoteId }, graphCore);
  exactOpaqueId(normalized.operationId, "operationId");
  exactOpaqueId(normalized.simulationReceiptId, "simulationReceiptId");
  exactDigest(normalized.simulationDigest, "Simulation digest");
  exactOpaqueId(normalized.baseRevisionId, "baseRevisionId");
  exactOpaqueId(normalized.activeRevisionId, "activeRevisionId");
  exactISO(normalized.reconciledAtISO, "Apply outcome reconciliation time");
  normalizeActor(normalized.reconciledBy);
  const authorizationReceiptId = text(normalized.authorizationReceiptId);
  const authorizationReceiptDigest = text(normalized.authorizationReceiptDigest);
  if (authorizationReceiptId) {
    exactOpaqueId(authorizationReceiptId, "authorizationReceiptId");
    exactDigest(authorizationReceiptDigest, "Authorization receipt digest");
  } else if (authorizationReceiptDigest) {
    fail("failed-precondition", "Apply outcome authorization evidence is inconsistent.");
  }
  if (
    normalized.receiptId !== identity.outcomeReceiptId
    || normalized.outcomeReceiptId !== identity.outcomeReceiptId
    || normalized.operationId !== identity.operationId
    || normalized.expectedApplyReceiptId !== identity.applyReceiptId
    || !["committed", "not_committed"].includes(normalized.state)
    || normalized.sourceChanged !== (normalized.activeRevisionId !== normalized.baseRevisionId)
  ) {
    fail("failed-precondition", "Apply outcome receipt identity or state is invalid.");
  }
  if (normalized.state === "committed") {
    if (
      normalized.applyReceiptId !== identity.applyReceiptId
      || !text(normalized.applyReceiptDigest)
      || !text(normalized.newRevisionId)
    ) {
      fail("failed-precondition", "Committed apply outcome evidence is incomplete.");
    }
    exactDigest(normalized.applyReceiptDigest, "Apply receipt digest");
    exactOpaqueId(normalized.newRevisionId, "newRevisionId");
    if (normalized.appliedRevisionIsActive !== (
      normalized.activeRevisionId === normalized.newRevisionId
    )) {
      fail("failed-precondition", "Committed apply outcome active-revision evidence is invalid.");
    }
  } else if (
    text(normalized.applyReceiptId)
    || text(normalized.applyReceiptDigest)
    || text(normalized.newRevisionId)
    || normalized.appliedRevisionIsActive !== false
  ) {
    fail("failed-precondition", "Not-committed apply outcome must not claim apply evidence.");
  }
  return normalized;
}

function validateReconciliationReceipt(receipt, graphCore) {
  const normalized = assertReceiptIntegrity(receipt, "reconciliation", graphCore);
  exactRequestId(normalized.requestId, "reconciliation");
  const organizationId = exactOpaqueId(normalized.organizationId, "organizationId");
  const quoteId = exactOpaqueId(normalized.quoteId, "quoteId");
  exactOpaqueId(normalized.applyReceiptId, "applyReceiptId");
  exactDigest(normalized.applyReceiptDigest, "Apply receipt digest");
  exactOpaqueId(normalized.activeRevisionId, "activeRevisionId");
  exactISO(normalized.reconciledAtISO, "Reconciliation time");
  normalizeActor(normalized.reconciledBy);
  if (
    !Array.isArray(normalized.resolutions)
    || !normalized.resolutions.length
    || normalized.resolutions.length > MAX_RECONCILIATIONS
  ) {
    fail("failed-precondition", "Commercial change reconciliation resolutions are invalid.");
  }
  const ids = normalized.resolutions.map((item) => text(item?.invalidationId));
  if (ids.some((id) => !id) || new Set(ids).size !== ids.length) {
    fail("failed-precondition", "Commercial change reconciliation contains duplicate invalidations.");
  }
  normalized.resolutions.forEach((item) => {
    exactOpaqueId(item.invalidationId, "invalidationId");
    exactOpaqueId(item.invalidationReceiptId, "invalidationReceiptId");
    exactOpaqueId(item.nodeId, "nodeId");
    exactOpaqueId(item.evidenceId, "evidenceId");
    exactDigest(item.evidenceDigest, "Reconciliation evidence digest");
    exactOpaqueId(item.resolution, "resolution", 80);
  });
  const expectedId = receiptIdentity("reconciliation", {
    organizationId,
    quoteId,
    requestId: normalized.requestId
  }, graphCore);
  if (normalized.receiptId !== expectedId) {
    fail("failed-precondition", "Reconciliation receipt identity is invalid.");
  }
  return normalized;
}

function staleReason(current, receipt) {
  if (current.activeRevisionId !== receipt.baseRevisionId) return "quote_revision_changed";
  if (current.catalogAuthorityDigest !== receipt.catalogAuthorityDigest) {
    return "catalog_authority_changed";
  }
  if (current.policyVersion !== receipt.policyVersion) return "policy_changed";
  return "";
}

function normalizeCurrentAuthority(current = {}) {
  return {
    activeRevisionId: exactOpaqueId(current.activeRevisionId, "current activeRevisionId"),
    catalogAuthorityDigest: exactDigest(
      current.catalogAuthorityDigest,
      "Current catalog authority digest"
    ),
    policyVersion: exactOpaqueId(current.policyVersion, "current policyVersion", 128)
  };
}

function assertUnexpired(receipt, nowISO, label) {
  if (Date.parse(nowISO) > Date.parse(receipt.expiresAtISO)) {
    fail("failed-precondition", `${label} expired. Re-simulate the current quote before continuing.`, {
      driftReason: "authorization_expired"
    });
  }
}

function reconcileReceiptReplay({ existingReceipt, proposedReceipt, type, graphCore }) {
  const existing = assertReceiptIntegrity(existingReceipt, type, graphCore);
  const proposed = assertReceiptIntegrity(proposedReceipt, type, graphCore);
  if (existing.receiptId !== proposed.receiptId) {
    fail("invalid-argument", `Existing ${type} receipt does not match this request identity.`);
  }
  if (graphCore.canonicalSerialize(existing) !== graphCore.canonicalSerialize(proposed)) {
    fail("already-exists", `${type} request identity is already bound to different immutable evidence.`);
  }
  return deepFreeze({ receipt: existing, idempotent: true });
}

function normalizeReconciliationEvidence(evidence, invalidation, targetRevisionId, graphCore) {
  if (
    !isRecord(evidence)
    || evidence.schemaVersion !== COMMERCIAL_CHANGE_RECONCILIATION_EVIDENCE_VERSION
    || evidence.authority !== COMMERCIAL_CHANGE_AUTHORITY
  ) {
    fail("failed-precondition", "Trusted reconciliation evidence is required.");
  }
  const normalized = {
    schemaVersion: COMMERCIAL_CHANGE_RECONCILIATION_EVIDENCE_VERSION,
    authority: COMMERCIAL_CHANGE_AUTHORITY,
    evidenceId: exactOpaqueId(evidence.evidenceId, "evidenceId", 180),
    invalidationId: exactOpaqueId(evidence.invalidationId, "invalidationId", 180),
    nodeId: exactOpaqueId(evidence.nodeId, "nodeId"),
    sourceRevisionId: exactOpaqueId(evidence.sourceRevisionId, "sourceRevisionId"),
    resolution: exactOpaqueId(evidence.resolution, "resolution", 80),
    state: text(evidence.state).toUpperCase()
  };
  if (
    normalized.invalidationId !== invalidation.invalidationId
    || normalized.nodeId !== invalidation.nodeId
    || normalized.sourceRevisionId !== targetRevisionId
    || !ALLOWED_RESOLUTIONS[invalidation.nodeKind]?.has(normalized.resolution)
  ) {
    fail("failed-precondition", `Reconciliation evidence does not resolve ${invalidation.invalidationId}.`);
  }
  const expectedState = invalidation.nodeKind === "artifact"
    && normalized.resolution === "artifact_not_generated"
    ? "NOT_GENERATED"
    : ["artifact", "projection"].includes(invalidation.nodeKind)
      ? "CURRENT"
      : "RESOLVED";
  if (normalized.state !== expectedState) {
    fail("failed-precondition", `Reconciliation evidence for ${invalidation.nodeId} is not ${expectedState}.`);
  }
  return {
    ...normalized,
    evidenceDigest: sha256Canonical(normalized, graphCore, "Reconciliation evidence")
  };
}

function createCommercialChangeAuthority({
  graphCore,
  buildPreviewSnapshots,
  simulateImpact,
  simulationTtlMs = DEFAULT_SIMULATION_TTL_MS
} = {}) {
  if (
    !isRecord(graphCore)
    || typeof graphCore.canonicalSerialize !== "function"
    || typeof graphCore.evaluateCommercialDependencyImpact !== "function"
    || !isRecord(graphCore.COMMERCIAL_DEPENDENCY_GRAPH_V1)
    || typeof buildPreviewSnapshots !== "function"
    || typeof simulateImpact !== "function"
  ) {
    fail(
      "failed-precondition",
      "Commercial Dependency Graph, preview, and impact evaluator dependencies are required."
    );
  }
  graphCore.validateCommercialDependencyGraph(graphCore.COMMERCIAL_DEPENDENCY_GRAPH_V1);
  if (
    !Number.isSafeInteger(simulationTtlMs)
    || simulationTtlMs < MIN_SIMULATION_TTL_MS
    || simulationTtlMs > MAX_SIMULATION_TTL_MS
  ) {
    fail("invalid-argument", "Commercial change simulation TTL is outside the bounded policy.");
  }

  const simulate = ({
    request,
    canonicalQuote,
    proposedForm,
    proposedPricing,
    trustedContext,
    existingReceipt = null
  } = {}) => {
    const scope = requestScope(request, "simulation");
    const expectedActiveVersionId = exactOpaqueId(
      request.expectedActiveVersionId,
      "expectedActiveVersionId"
    );
    const trusted = normalizeTrustedContext(trustedContext);
    let preview;
    let impactResult;
    try {
      preview = buildPreviewSnapshots({
        organizationId: scope.organizationId,
        quoteId: scope.quoteId,
        expectedActiveVersionId,
        currentQuote: canonicalQuote,
        proposedForm,
        proposedPricing
      });
      impactResult = simulateImpact(preview);
    } catch (error) {
      translateDependencyError(error, "Commercial change simulation failed.");
    }
    const normalized = normalizeImpactResult({ impactResult, preview, graphCore });
    const workflowPolicy = normalizeWorkflowPolicy(trustedContext.workflowPolicy, scope.organizationId);
    const attendanceBinding = normalizeAttendanceBinding(trustedContext.attendanceBinding, scope, expectedActiveVersionId);
    const v2 = Boolean(workflowPolicy || attendanceBinding);
    if (workflowPolicy && (!workflowPolicy.approvalPolicy.allowedRoles.includes(trusted.actor.role) || workflowPolicy.declaredAtISO > trusted.nowISO)) fail("permission-denied", "Current actor or publication time is outside the pinned workflow policy.");
    if (attendanceBinding && attendanceBinding.count !== preview.proposedAfterSnapshot.facts["fact.event.guest_count"]) fail("failed-precondition", "The proposed commercial count does not match its attendance submission.");
    const bindings = v2 ? { workflowPolicy, attendanceBinding } : {};
    const approvalEvaluation = v2 ? workflowApprovalEvaluation(normalized.commercialValues, normalized.impact, workflowPolicy) : null;
    const proposalDigest = sha256Canonical(
      v2 ? { snapshot: preview.proposedAfterSnapshot, ...bindings } : preview.proposedAfterSnapshot,
      graphCore,
      "Proposed commercial change"
    );
    const impactDigest = sha256Canonical({
      identity: preview.identity,
      graph: impactResult.graph,
      factDiffs: normalized.factDiffs,
      commercialValues: normalized.commercialValues,
      impact: normalized.impact,
      ...bindings
    }, graphCore, "Commercial change impact");
    const receiptId = receiptIdentity("simulation", {
      ...scope,
      requestId: scope.requestId
    }, graphCore);

    if (existingReceipt) {
      const existing = validateSimulationReceipt(existingReceipt, graphCore);
      assertScope(existing, scope, "Simulation receipt");
      if (
        existing.receiptId !== receiptId
        || existing.baseRevisionId !== preview.identity.beforeRevisionId
        || existing.proposedRevisionId !== preview.identity.proposedRevisionId
        || existing.proposalDigest !== proposalDigest
        || existing.impactDigest !== impactDigest
        || existing.catalogAuthorityDigest !== trusted.catalogAuthorityDigest
        || existing.policyVersion !== trusted.policyVersion
      ) {
        fail("already-exists", "Simulation request identity is already bound to different immutable evidence.");
      }
      return deepFreeze({ receipt: existing, idempotent: true });
    }

    const simulatedAtMs = Date.parse(trusted.nowISO);
    const payload = {
      schemaVersion: v2 ? WORKFLOW_RECEIPT_SCHEMAS.simulation : COMMERCIAL_CHANGE_SIMULATION_RECEIPT_VERSION,
      ...(v2 ? { ...bindings, approvalEvaluation } : {}),
      authority: COMMERCIAL_CHANGE_AUTHORITY,
      receiptType: "simulation",
      receiptId,
      requestId: scope.requestId,
      organizationId: scope.organizationId,
      quoteId: scope.quoteId,
      baseRevisionId: preview.identity.beforeRevisionId,
      proposedRevisionId: preview.identity.proposedRevisionId,
      proposalDigest,
      impactDigest,
      catalogAuthorityDigest: trusted.catalogAuthorityDigest,
      policyVersion: trusted.policyVersion,
      graph: {
        graphId: graphCore.COMMERCIAL_DEPENDENCY_GRAPH_ID,
        graphVersion: graphCore.COMMERCIAL_DEPENDENCY_GRAPH_VERSION
      },
      factDiffs: normalized.factDiffs,
      commercialValues: normalized.commercialValues,
      impact: normalized.impact,
      authorizationRequired: v2 ? approvalEvaluation.impactApprovalRequired || approvalEvaluation.thresholdApprovalRequired : normalized.impact.counts.total > 0,
      simulatedAtISO: trusted.nowISO,
      expiresAtISO: new Date(simulatedAtMs + simulationTtlMs).toISOString(),
      simulatedBy: trusted.actor,
      boundary: COMMERCIAL_CHANGE_AUTHORITY_BOUNDARY
    };
    return deepFreeze({ receipt: addReceiptDigest(payload, graphCore), idempotent: false });
  };

  const authorize = ({
    simulationReceipt,
    request,
    trustedContext,
    current,
    existingReceipt = null
  } = {}) => {
    const simulation = validateSimulationReceipt(simulationReceipt, graphCore);
    const scope = requestScope(request, "authorization");
    const trusted = normalizeTrustedContext(trustedContext, { adminOnly: true });
    assertScope(simulation, scope, "Simulation receipt");
    const currentAuthority = normalizeCurrentAuthority(current);
    const driftReason = staleReason(currentAuthority, simulation);
    if (driftReason) {
      fail("aborted", "Commercial change simulation is stale and must be regenerated.", {
        driftReason
      });
    }
    assertUnexpired(simulation, trusted.nowISO, "Commercial change simulation");
    if (!simulation.authorizationRequired) {
      fail("failed-precondition", "This simulation has no governed dependency impact and does not require authorization.");
    }
    const receiptId = receiptIdentity("authorization", {
      ...scope,
      requestId: scope.requestId
    }, graphCore);
    if (existingReceipt) {
      const existing = validateAuthorizationReceipt(existingReceipt, graphCore);
      assertScope(existing, scope, "Authorization receipt");
      assertWorkflowSealMatch(simulation, existing, graphCore);
      if (
        existing.receiptId !== receiptId
        || existing.simulationReceiptId !== simulation.receiptId
        || existing.simulationDigest !== simulation.receiptDigest
      ) {
        fail("already-exists", "Authorization request identity is already bound to different immutable evidence.");
      }
      return deepFreeze({ receipt: existing, idempotent: true });
    }
    const payload = {
      schemaVersion: simulation.schemaVersion === WORKFLOW_RECEIPT_SCHEMAS.simulation ? WORKFLOW_RECEIPT_SCHEMAS.authorization : COMMERCIAL_CHANGE_AUTHORIZATION_RECEIPT_VERSION,
      ...workflowSeal(simulation),
      authority: COMMERCIAL_CHANGE_AUTHORITY,
      receiptType: "authorization",
      receiptId,
      requestId: scope.requestId,
      organizationId: scope.organizationId,
      quoteId: scope.quoteId,
      simulationReceiptId: simulation.receiptId,
      simulationDigest: simulation.receiptDigest,
      baseRevisionId: simulation.baseRevisionId,
      proposedRevisionId: simulation.proposedRevisionId,
      proposalDigest: simulation.proposalDigest,
      catalogAuthorityDigest: simulation.catalogAuthorityDigest,
      policyVersion: simulation.policyVersion,
      state: "authorized",
      authorizedAtISO: trusted.nowISO,
      expiresAtISO: simulation.expiresAtISO,
      authorizedBy: trusted.actor,
      authorizedFor: simulation.simulatedBy,
      boundary: COMMERCIAL_CHANGE_AUTHORITY_BOUNDARY
    };
    return deepFreeze({ receipt: addReceiptDigest(payload, graphCore), idempotent: false });
  };

  const buildApply = ({
    simulationReceipt,
    authorizationReceipt = null,
    request,
    trustedContext,
    current,
    existingReceipt = null
  } = {}) => {
    const simulation = validateSimulationReceipt(simulationReceipt, graphCore);
    const scope = requestScope(request, "apply");
    const newRevisionId = exactOpaqueId(request.newRevisionId, "newRevisionId");
    const trusted = normalizeTrustedContext(trustedContext);
    assertScope(simulation, scope, "Simulation receipt");
    const currentAuthority = normalizeCurrentAuthority(current);
    if (simulation.workflowPolicy && !simulation.workflowPolicy.approvalPolicy.allowedRoles.includes(trusted.actor.role)) fail("permission-denied", "The pinned workflow policy excludes this apply role.");
    const identity = applyIdentity(scope, graphCore);
    const receiptId = identity.applyReceiptId;

    if (existingReceipt) {
      const existing = validateApplyReceipt(existingReceipt, graphCore);
      assertScope(existing, scope, "Apply receipt");
      assertWorkflowSealMatch(simulation, existing, graphCore);
      if (
        existing.receiptId !== receiptId
        || existing.simulationReceiptId !== simulation.receiptId
        || existing.newRevisionId !== newRevisionId
        || ![existing.baseRevisionId, existing.newRevisionId]
          .includes(currentAuthority.activeRevisionId)
      ) {
        fail("already-exists", "Apply request identity is already bound to different immutable evidence.");
      }
      return deepFreeze({
        receipt: existing,
        invalidationReceipts: existing.invalidationReceipts,
        decisionOpenings: existing.decisionOpenings,
        idempotent: true
      });
    }

    const driftReason = staleReason(currentAuthority, simulation);
    if (driftReason) {
      fail("aborted", "Commercial change authorization is stale and cannot be applied.", {
        driftReason
      });
    }
    assertUnexpired(simulation, trusted.nowISO, "Commercial change simulation");
    if (newRevisionId === simulation.baseRevisionId) {
      fail("invalid-argument", "Applied commercial change must create a new immutable quote revision.");
    }

    let authorization = null;
    if (simulation.authorizationRequired) {
      authorization = validateAuthorizationReceipt(authorizationReceipt, graphCore);
      assertScope(authorization, scope, "Authorization receipt");
      assertWorkflowSealMatch(simulation, authorization, graphCore);
      if (
        authorization.simulationReceiptId !== simulation.receiptId
        || authorization.simulationDigest !== simulation.receiptDigest
        || authorization.baseRevisionId !== simulation.baseRevisionId
        || authorization.proposedRevisionId !== simulation.proposedRevisionId
        || authorization.proposalDigest !== simulation.proposalDigest
        || authorization.catalogAuthorityDigest !== currentAuthority.catalogAuthorityDigest
        || authorization.policyVersion !== currentAuthority.policyVersion
      ) {
        fail("failed-precondition", "Authorization does not match the exact current simulation scope.");
      }
      assertUnexpired(authorization, trusted.nowISO, "Commercial change authorization");
      if (
        trusted.actor.role !== "admin"
        && trusted.actor.uid !== authorization.authorizedFor.uid
      ) {
        fail("permission-denied", "Only the authorized requester or an admin may apply this commercial change.");
      }
    } else if (authorizationReceipt) {
      fail("failed-precondition", "A no-impact commercial change must not consume an unrelated authorization.");
    }

    const operationId = identity.operationId;
    const invalidationReceipts = simulation.impact.dependentNodes.map((node) => {
      const invalidationId = deterministicId(RECEIPT_ID_PREFIXES.invalidation, {
        schemaVersion: COMMERCIAL_CHANGE_INVALIDATION_RECEIPT_VERSION,
        organizationId: scope.organizationId,
        quoteId: scope.quoteId,
        operationId,
        nodeId: node.nodeId
      }, graphCore, "Commercial dependency invalidation identity");
      return addReceiptDigest({
        schemaVersion: COMMERCIAL_CHANGE_INVALIDATION_RECEIPT_VERSION,
        authority: COMMERCIAL_CHANGE_AUTHORITY,
        receiptType: "invalidation",
        receiptId: invalidationId,
        invalidationId,
        operationId,
        applyReceiptId: receiptId,
        organizationId: scope.organizationId,
        quoteId: scope.quoteId,
        sourceRevisionId: simulation.baseRevisionId,
        targetRevisionId: newRevisionId,
        nodeId: node.nodeId,
        nodeKind: node.nodeKind,
        classification: node.classification,
        triggeredBy: [...node.triggeredBy],
        initialState: "open",
        createdAtISO: trusted.nowISO,
        createdBy: trusted.actor,
        boundary: COMMERCIAL_CHANGE_AUTHORITY_BOUNDARY
      }, graphCore);
    });
    const decisionOpenings = invalidationReceipts
      .filter((receipt) => receipt.classification === "REVIEW")
      .map((receipt) => ({
        decisionId: deterministicId("ccd", {
          operationId,
          nodeId: receipt.nodeId
        }, graphCore, "Commercial dependency decision identity"),
        invalidationId: receipt.invalidationId,
        nodeId: receipt.nodeId,
        state: "open"
      }));
    const payload = {
      schemaVersion: simulation.schemaVersion === WORKFLOW_RECEIPT_SCHEMAS.simulation ? WORKFLOW_RECEIPT_SCHEMAS.apply : COMMERCIAL_CHANGE_APPLY_RECEIPT_VERSION,
      ...workflowSeal(simulation),
      authority: COMMERCIAL_CHANGE_AUTHORITY,
      receiptType: "apply",
      receiptId,
      requestId: scope.requestId,
      operationId,
      organizationId: scope.organizationId,
      quoteId: scope.quoteId,
      simulationReceiptId: simulation.receiptId,
      simulationDigest: simulation.receiptDigest,
      authorizationReceiptId: authorization?.receiptId || "",
      authorizationReceiptDigest: authorization?.receiptDigest || "",
      authorizationConsumed: Boolean(authorization),
      baseRevisionId: simulation.baseRevisionId,
      newRevisionId,
      proposalDigest: simulation.proposalDigest,
      graph: simulation.graph,
      invalidationReceipts,
      decisionOpenings,
      safeToPublish: invalidationReceipts.length === 0,
      appliedAtISO: trusted.nowISO,
      appliedBy: trusted.actor,
      boundary: COMMERCIAL_CHANGE_AUTHORITY_BOUNDARY
    };
    const receipt = addReceiptDigest(payload, graphCore);
    validateApplyReceipt(receipt, graphCore);
    return deepFreeze({
      receipt,
      invalidationReceipts: receipt.invalidationReceipts,
      decisionOpenings: receipt.decisionOpenings,
      idempotent: false
    });
  };

  const reconcileApplyOutcome = ({
    simulationReceipt,
    authorizationReceipt = null,
    applyReceipt = null,
    request,
    trustedContext,
    current,
    existingReceipt = null
  } = {}) => {
    const simulation = validateSimulationReceipt(simulationReceipt, graphCore);
    const scope = requestScope(request, "apply");
    const identity = applyIdentity(scope, graphCore);
    const simulationReceiptId = exactOpaqueId(
      request?.simulationReceiptId,
      "simulationReceiptId"
    );
    const expectedBaseRevisionId = exactOpaqueId(
      request?.expectedBaseRevisionId,
      "expectedBaseRevisionId"
    );
    const requestedAuthorizationReceiptId = text(request?.authorizationReceiptId);
    const activeRevisionId = exactOpaqueId(
      current?.activeRevisionId,
      "current activeRevisionId"
    );
    const reconciledBy = normalizeActor(trustedContext?.actor);
    const reconciledAtISO = exactISO(
      trustedContext?.nowISO,
      "Apply outcome reconciliation time"
    );
    assertScope(simulation, scope, "Simulation receipt");
    if (
      simulation.receiptId !== simulationReceiptId
      || simulation.baseRevisionId !== expectedBaseRevisionId
    ) {
      fail(
        "failed-precondition",
        "Apply outcome request does not match the exact simulation and base revision."
      );
    }

    let authorization = null;
    if (simulation.authorizationRequired) {
      authorization = validateAuthorizationReceipt(authorizationReceipt, graphCore);
      assertScope(authorization, scope, "Authorization receipt");
      assertWorkflowSealMatch(simulation, authorization, graphCore);
      if (
        !requestedAuthorizationReceiptId
        || authorization.receiptId !== requestedAuthorizationReceiptId
        || authorization.simulationReceiptId !== simulation.receiptId
        || authorization.simulationDigest !== simulation.receiptDigest
        || authorization.baseRevisionId !== simulation.baseRevisionId
        || authorization.proposedRevisionId !== simulation.proposedRevisionId
        || authorization.proposalDigest !== simulation.proposalDigest
        || authorization.catalogAuthorityDigest !== simulation.catalogAuthorityDigest
        || authorization.policyVersion !== simulation.policyVersion
        || authorization.authorizedFor?.uid !== simulation.simulatedBy?.uid
        || authorization.authorizedFor?.email !== simulation.simulatedBy?.email
        || authorization.authorizedFor?.role !== simulation.simulatedBy?.role
      ) {
        fail(
          "failed-precondition",
          "Apply outcome authorization does not match the exact simulation."
        );
      }
    } else if (requestedAuthorizationReceiptId || authorizationReceipt) {
      fail(
        "failed-precondition",
        "A no-impact apply outcome must not consume unrelated authorization evidence."
      );
    }

    let applied = null;
    if (applyReceipt) {
      applied = validateApplyReceipt(applyReceipt, graphCore);
      assertScope(applied, scope, "Apply receipt");
      assertWorkflowSealMatch(simulation, applied, graphCore);
      if (
        applied.receiptId !== identity.applyReceiptId
        || applied.operationId !== identity.operationId
        || applied.requestId !== scope.requestId
        || applied.simulationReceiptId !== simulation.receiptId
        || applied.simulationDigest !== simulation.receiptDigest
        || applied.authorizationReceiptId !== (authorization?.receiptId || "")
        || applied.authorizationReceiptDigest !== (authorization?.receiptDigest || "")
        || applied.baseRevisionId !== simulation.baseRevisionId
        || applied.proposalDigest !== simulation.proposalDigest
      ) {
        fail(
          "failed-precondition",
          "Apply outcome receipt is not bound to the exact authorized request."
        );
      }
    }

    const payload = {
      schemaVersion: COMMERCIAL_CHANGE_APPLY_OUTCOME_RECEIPT_VERSION,
      authority: COMMERCIAL_CHANGE_AUTHORITY,
      receiptType: "outcome",
      receiptId: identity.outcomeReceiptId,
      outcomeReceiptId: identity.outcomeReceiptId,
      requestId: scope.requestId,
      operationId: identity.operationId,
      organizationId: scope.organizationId,
      quoteId: scope.quoteId,
      simulationReceiptId: simulation.receiptId,
      simulationDigest: simulation.receiptDigest,
      authorizationReceiptId: authorization?.receiptId || "",
      authorizationReceiptDigest: authorization?.receiptDigest || "",
      baseRevisionId: simulation.baseRevisionId,
      expectedApplyReceiptId: identity.applyReceiptId,
      state: applied ? "committed" : "not_committed",
      activeRevisionId,
      sourceChanged: activeRevisionId !== simulation.baseRevisionId,
      applyReceiptId: applied?.receiptId || "",
      applyReceiptDigest: applied?.receiptDigest || "",
      newRevisionId: applied?.newRevisionId || "",
      appliedRevisionIsActive: Boolean(applied && activeRevisionId === applied.newRevisionId),
      reconciledAtISO,
      reconciledBy,
      boundary: COMMERCIAL_CHANGE_APPLY_OUTCOME_BOUNDARY
    };
    const receipt = addReceiptDigest(payload, graphCore);
    validateApplyOutcomeReceipt(receipt, graphCore);

    if (existingReceipt) {
      const existing = validateApplyOutcomeReceipt(existingReceipt, graphCore);
      assertScope(existing, scope, "Apply outcome receipt");
      if (
        existing.receiptId !== receipt.receiptId
        || existing.operationId !== receipt.operationId
        || existing.simulationReceiptId !== receipt.simulationReceiptId
        || existing.simulationDigest !== receipt.simulationDigest
        || existing.authorizationReceiptId !== receipt.authorizationReceiptId
        || existing.authorizationReceiptDigest !== receipt.authorizationReceiptDigest
        || existing.baseRevisionId !== receipt.baseRevisionId
        || existing.expectedApplyReceiptId !== receipt.expectedApplyReceiptId
        || existing.state !== receipt.state
        || existing.applyReceiptId !== receipt.applyReceiptId
        || existing.applyReceiptDigest !== receipt.applyReceiptDigest
        || existing.newRevisionId !== receipt.newRevisionId
      ) {
        fail(
          "already-exists",
          "Apply outcome request identity is bound to different immutable evidence."
        );
      }
      return deepFreeze({ receipt: existing, idempotent: true });
    }

    return deepFreeze({ receipt, idempotent: false });
  };

  const reconcile = ({
    applyReceipt,
    request,
    evidenceByInvalidationId,
    priorReconciliationReceipts = [],
    trustedContext,
    current,
    existingReceipt = null
  } = {}) => {
    const applied = validateApplyReceipt(applyReceipt, graphCore);
    const scope = requestScope(request, "reconciliation");
    const trusted = normalizeTrustedContext(trustedContext);
    assertScope(applied, scope, "Apply receipt");
    const activeRevisionId = exactOpaqueId(current?.activeRevisionId, "current activeRevisionId");
    if (activeRevisionId !== applied.newRevisionId) {
      fail("aborted", "Commercial dependency reconciliation is stale for the active quote revision.", {
        driftReason: "quote_revision_changed"
      });
    }
    const requestedIds = Array.isArray(request.invalidationIds)
      ? request.invalidationIds.map((value) => exactOpaqueId(value, "invalidationId", 180))
      : [];
    if (
      !requestedIds.length
      || requestedIds.length > MAX_RECONCILIATIONS
      || new Set(requestedIds).size !== requestedIds.length
    ) {
      fail("invalid-argument", "Reconciliation must name a unique bounded invalidation set.");
    }
    const invalidationById = new Map(
      applied.invalidationReceipts.map((receipt) => [receipt.invalidationId, receipt])
    );
    const unknownIds = requestedIds.filter((id) => !invalidationById.has(id));
    if (unknownIds.length) {
      fail("failed-precondition", "Reconciliation names invalidations outside this apply receipt.", {
        invalidationIds: unknownIds
      });
    }
    const previouslyResolved = new Set();
    priorReconciliationReceipts.forEach((receipt) => {
      const prior = validateReconciliationReceipt(receipt, graphCore);
      if (
        prior.applyReceiptId !== applied.receiptId
        || prior.applyReceiptDigest !== applied.receiptDigest
        || prior.activeRevisionId !== applied.newRevisionId
      ) {
        fail("failed-precondition", "Prior reconciliation receipt is outside this apply scope.");
      }
      prior.resolutions.forEach((resolution) => previouslyResolved.add(resolution.invalidationId));
    });
    const duplicateResolutionIds = requestedIds.filter((id) => previouslyResolved.has(id));
    if (duplicateResolutionIds.length && !existingReceipt) {
      fail("failed-precondition", "One or more named invalidations are already reconciled.", {
        invalidationIds: duplicateResolutionIds
      });
    }
    if (!isRecord(evidenceByInvalidationId)) {
      fail("failed-precondition", "Trusted reconciliation evidence map is required.");
    }
    const resolutions = [...requestedIds].sort(compareText).map((invalidationId) => {
      const invalidation = invalidationById.get(invalidationId);
      const evidence = normalizeReconciliationEvidence(
        evidenceByInvalidationId[invalidationId],
        invalidation,
        applied.newRevisionId,
        graphCore
      );
      return {
        invalidationId,
        invalidationReceiptId: invalidation.receiptId,
        nodeId: invalidation.nodeId,
        evidenceId: evidence.evidenceId,
        evidenceDigest: evidence.evidenceDigest,
        resolution: evidence.resolution
      };
    });
    const receiptId = receiptIdentity("reconciliation", {
      ...scope,
      requestId: scope.requestId
    }, graphCore);
    if (existingReceipt) {
      const existing = validateReconciliationReceipt(existingReceipt, graphCore);
      assertScope(existing, scope, "Reconciliation receipt");
      if (
        existing.receiptId !== receiptId
        || existing.applyReceiptId !== applied.receiptId
        || graphCore.canonicalSerialize(existing.resolutions)
          !== graphCore.canonicalSerialize(resolutions)
      ) {
        fail("already-exists", "Reconciliation request identity is already bound to different immutable evidence.");
      }
      return deepFreeze({ receipt: existing, idempotent: true });
    }
    const payload = {
      schemaVersion: COMMERCIAL_CHANGE_RECONCILIATION_RECEIPT_VERSION,
      authority: COMMERCIAL_CHANGE_AUTHORITY,
      receiptType: "reconciliation",
      receiptId,
      requestId: scope.requestId,
      organizationId: scope.organizationId,
      quoteId: scope.quoteId,
      applyReceiptId: applied.receiptId,
      applyReceiptDigest: applied.receiptDigest,
      activeRevisionId: applied.newRevisionId,
      resolutions,
      reconciledAtISO: trusted.nowISO,
      reconciledBy: trusted.actor,
      boundary: COMMERCIAL_CHANGE_AUTHORITY_BOUNDARY
    };
    return deepFreeze({ receipt: addReceiptDigest(payload, graphCore), idempotent: false });
  };

  const evaluatePublishGate = ({
    applyReceipt,
    reconciliationReceipts = [],
    currentRevisionId
  } = {}) => {
    const applied = validateApplyReceipt(applyReceipt, graphCore);
    const activeRevisionId = exactOpaqueId(currentRevisionId, "current activeRevisionId");
    if (activeRevisionId !== applied.newRevisionId) {
      return deepFreeze({
        schemaVersion: COMMERCIAL_CHANGE_PUBLISH_GATE_VERSION,
        authority: COMMERCIAL_CHANGE_DERIVED_AUTHORITY,
        state: "STALE",
        safeToPublish: false,
        organizationId: applied.organizationId,
        quoteId: applied.quoteId,
        activeRevisionId,
        applyReceiptId: applied.receiptId,
        unresolvedInvalidations: applied.invalidationReceipts.map((item) => ({
          invalidationId: item.invalidationId,
          nodeId: item.nodeId,
          classification: item.classification
        })),
        resolvedCount: 0,
        reasonCodes: ["active_revision_changed"],
        boundary: COMMERCIAL_CHANGE_PUBLISH_BOUNDARY
      });
    }
    const invalidationById = new Map(
      applied.invalidationReceipts.map((item) => [item.invalidationId, item])
    );
    const resolved = new Set();
    const invalidReasonCodes = [];
    for (const receipt of reconciliationReceipts) {
      let reconciliationReceipt;
      try {
        reconciliationReceipt = validateReconciliationReceipt(receipt, graphCore);
      } catch {
        invalidReasonCodes.push("reconciliation_receipt_invalid");
        continue;
      }
      if (
        reconciliationReceipt.applyReceiptId !== applied.receiptId
        || reconciliationReceipt.applyReceiptDigest !== applied.receiptDigest
        || reconciliationReceipt.activeRevisionId !== applied.newRevisionId
      ) {
        invalidReasonCodes.push("reconciliation_scope_mismatch");
        continue;
      }
      for (const resolution of reconciliationReceipt.resolutions) {
        if (!invalidationById.has(resolution.invalidationId)) {
          invalidReasonCodes.push("reconciliation_invalidation_unknown");
        } else if (resolved.has(resolution.invalidationId)) {
          invalidReasonCodes.push("reconciliation_duplicate_resolution");
        } else {
          resolved.add(resolution.invalidationId);
        }
      }
    }
    const unresolvedInvalidations = applied.invalidationReceipts
      .filter((item) => !resolved.has(item.invalidationId))
      .map((item) => ({
        invalidationId: item.invalidationId,
        nodeId: item.nodeId,
        classification: item.classification
      }));
    const evidenceInvalid = invalidReasonCodes.length > 0;
    const safeToPublish = !evidenceInvalid && unresolvedInvalidations.length === 0;
    return deepFreeze({
      schemaVersion: COMMERCIAL_CHANGE_PUBLISH_GATE_VERSION,
      authority: COMMERCIAL_CHANGE_DERIVED_AUTHORITY,
      state: evidenceInvalid ? "UNKNOWN" : safeToPublish ? "READY" : "BLOCKED",
      safeToPublish,
      organizationId: applied.organizationId,
      quoteId: applied.quoteId,
      activeRevisionId,
      applyReceiptId: applied.receiptId,
      unresolvedInvalidations,
      resolvedCount: resolved.size,
      reasonCodes: evidenceInvalid
        ? [...new Set(invalidReasonCodes)].sort(compareText)
        : safeToPublish
          ? ["all_named_dependencies_reconciled"]
          : ["governed_dependencies_unresolved"],
      boundary: COMMERCIAL_CHANGE_PUBLISH_BOUNDARY
    });
  };

  return Object.freeze({
    simulate,
    authorize,
    buildApply,
    reconcileApplyOutcome,
    reconcile,
    evaluatePublishGate,
    applyIdentity: (request) => applyIdentity(request, graphCore),
    validateSimulationReceipt: (receipt) => validateSimulationReceipt(receipt, graphCore),
    validateAuthorizationReceipt: (receipt) => validateAuthorizationReceipt(receipt, graphCore),
    validateApplyReceipt: (receipt) => validateApplyReceipt(receipt, graphCore),
    validateApplyOutcomeReceipt: (receipt) => validateApplyOutcomeReceipt(receipt, graphCore),
    validateReconciliationReceipt: (receipt) => validateReconciliationReceipt(receipt, graphCore),
    reconcileReceiptReplay: (input) => reconcileReceiptReplay({ ...input, graphCore })
  });
}

module.exports = {
  authoritativeMoneyToCents,
  WORKFLOW_RECEIPT_SCHEMAS,
  COMMERCIAL_CHANGE_APPLY_RECEIPT_VERSION,
  COMMERCIAL_CHANGE_APPLY_OUTCOME_BOUNDARY,
  COMMERCIAL_CHANGE_APPLY_OUTCOME_RECEIPT_VERSION,
  COMMERCIAL_CHANGE_AUTHORITY,
  COMMERCIAL_CHANGE_AUTHORITY_BOUNDARY,
  COMMERCIAL_CHANGE_AUTHORITY_VERSION,
  COMMERCIAL_CHANGE_AUTHORIZATION_RECEIPT_VERSION,
  COMMERCIAL_CHANGE_INVALIDATION_RECEIPT_VERSION,
  COMMERCIAL_CHANGE_PUBLISH_BOUNDARY,
  COMMERCIAL_CHANGE_PUBLISH_GATE_VERSION,
  COMMERCIAL_CHANGE_RECONCILIATION_EVIDENCE_VERSION,
  COMMERCIAL_CHANGE_RECONCILIATION_RECEIPT_VERSION,
  COMMERCIAL_CHANGE_SIMULATION_RECEIPT_VERSION,
  CommercialChangeAuthorityError,
  DEFAULT_SIMULATION_TTL_MS,
  MAX_INVALIDATIONS,
  MAX_RECEIPT_BYTES,
  createCommercialChangeAuthority
};
