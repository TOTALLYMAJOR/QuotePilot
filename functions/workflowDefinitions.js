"use strict";

const { createHash } = require("node:crypto");
const { EventOperationsError } = require("./eventOperations");
const SCHEMA_VERSION = 1;
const MAX_VERSIONS = 50;
const RUNTIME_KINDS = ["event_execution", "quote_review", "final_guest_count", "closeout_follow_up"];
const CHECKPOINT_CODES = Object.freeze(["venue_access", "team_briefing", "service_handoff", "pack_down"]);
const FIXTURE_KIND = "post_event_review";
const HANDOFF_TEMPLATES = Object.freeze({
  internal_event_brief_v1: Object.freeze({ label: "Internal event brief", guidance: "Review the accepted event context with the team through an existing approved communication surface. This reference records no send or delivery." }),
  post_event_review_v1: Object.freeze({ label: "Post-event review", guidance: "Review the recorded event evidence and prepare a follow-up through an existing approved communication surface. This reference records no send or delivery." })
});
const CONFIG_KEYS = ["schemaVersion", "workflowKind", "name", "allowedRoles", "actualsReviewThresholdCents", "comparisonPolicy", "duePolicy", "escalationPolicy", "taskTemplates"];
const VERSION_KEYS = ["schemaVersion", "organizationId", "definitionId", "workflowKind", "versionId", "version", "config", "publishedBy", "publishedAtISO", "seed", "definitionDigest"];
const HEAD_KEYS = ["schemaVersion", "organizationId", "definitionId", "workflowKind", "revision", "draftRevision", "draftConfig", "draftDigest", "lifetimeVersionCount", "activeVersionId", "createdAtISO", "updatedAtISO", "lastReceiptId"];
const REQUEST_KEYS = ["organizationId", "workflowKind", "requestId", "expectedRevision", "command"];
const RECEIPT_PATTERN = /^workflow_definition_command_[a-f0-9]{48}$/;
const fail = (code, message) => { throw new EventOperationsError(code, message); };
const isRecord = (value) => Boolean(value) && typeof value === "object" && !Array.isArray(value);
const freeze = (value) => { if (isRecord(value) || Array.isArray(value)) { Object.values(value).forEach(freeze); Object.freeze(value); } return value; };
function canonical(value) {
  if (Array.isArray(value)) return value.map(canonical);
  return isRecord(value) ? Object.fromEntries(Object.keys(value).sort().map((key) => [key, canonical(value[key])])) : value;
}
const digest = (value) => createHash("sha256").update(JSON.stringify(canonical(value))).digest("hex");
const equal = (left, right) => digest(left) === digest(right);
function exact(value, keys, label) {
  if (!isRecord(value) || Object.keys(value).length !== keys.length || keys.some((key) => !Object.hasOwn(value, key))) fail("invalid-argument", `${label} contains missing or unsupported fields.`);
}
function identifier(value, label) {
  if (typeof value !== "string" || !/^[^\s/?#\\\u0000]{1,180}$/u.test(value) || [".", ".."].includes(value)) fail("invalid-argument", `${label} must be an exact identifier within the existing event authority bounds.`);
  return value;
}
function plainText(value, limit, label, blank = false) {
  if (typeof value !== "string" || value.length > limit || (!blank && !value.trim())
    || /[\u0000-\u0008\u000B\u000C\u000E-\u001F\u007F]/u.test(value)
    || /(?:[a-z][a-z0-9+.-]*:\/\/|javascript:|data:|<\/?[a-z]|=>|\$\{|[\w.+-]+@[\w.-]+\.[a-z]{2,})/i.test(value)) {
    fail("invalid-argument", `${label} must be plain operator text of at most ${limit} characters, without code, URLs or recipient addresses.`);
  }
  return value.trim();
}
function integer(value, maximum, label) {
  if (!Number.isSafeInteger(value) || value < 0 || value > maximum) fail("invalid-argument", `${label} must be an explicit integer from 0 to ${maximum}.`);
  return value;
}
function iso(value) {
  if (typeof value !== "string" || !Number.isFinite(Date.parse(value)) || new Date(value).toISOString() !== value) fail("invalid-argument", "An exact server recording timestamp is required.");
  return value;
}
function kind(value, { fixtureOnly = false } = {}) {
  if (!RUNTIME_KINDS.includes(value) && !(fixtureOnly && value === FIXTURE_KIND)) fail("failed-precondition", "This workflow kind is not available in the runtime definition catalog.");
  return value;
}
function scope(value, options) {
  return { organizationId: identifier(value?.organizationId, "organizationId"), workflowKind: kind(value?.workflowKind, options) };
}
function actorFor(value, organizationId, mutation = true) {
  if (!isRecord(value) || value.organizationId !== organizationId || (value.principalOrganizationId && value.principalOrganizationId !== organizationId)
    || !(mutation ? ["admin"] : ["admin", "sales"]).includes(value.role)) fail("permission-denied", "Current same-organization administrator authority is required for definition changes.");
  return { organizationId, uid: identifier(value.uid, "actor uid"), role: value.role };
}
function validateConfig(input, options = {}) {
  if (input?.schemaVersion === 2) return validateConfigV2(input);
  exact(input, CONFIG_KEYS, "Workflow definition config");
  if (input.schemaVersion !== 1) fail("failed-precondition", "The workflow definition schema is unsupported.");
  const workflowKind = kind(input.workflowKind, options);
  if (workflowKind !== "event_execution" && !(options.fixtureOnly && workflowKind === FIXTURE_KIND)) fail("failed-precondition", "This workflow requires a version two published definition.");
  if (!Array.isArray(input.allowedRoles) || input.allowedRoles.length < 1 || input.allowedRoles.length > 2
    || new Set(input.allowedRoles).size !== input.allowedRoles.length || !input.allowedRoles.includes("admin")
    || input.allowedRoles.some((role) => !["admin", "sales"].includes(role))) fail("invalid-argument", "Acknowledgment roles must include admin and may also include sales.");
  const allowedRoles = [...input.allowedRoles].sort();
  const actualsReviewThresholdCents = input.actualsReviewThresholdCents === null ? null : integer(input.actualsReviewThresholdCents, 1_000_000_000, "Operator actuals review threshold");
  let comparisonPolicy = null;
  if (input.comparisonPolicy !== null) {
    exact(input.comparisonPolicy, ["laborBasisPoints", "purchasingBasisPoints", "minimumCents"], "Comparison policy");
    comparisonPolicy = {
      laborBasisPoints: integer(input.comparisonPolicy.laborBasisPoints, 10_000, "Labor comparison tolerance"),
      purchasingBasisPoints: integer(input.comparisonPolicy.purchasingBasisPoints, 10_000, "Purchasing comparison tolerance"),
      minimumCents: integer(input.comparisonPolicy.minimumCents, 1_000_000_000, "Minimum comparison tolerance")
    };
  }
  exact(input.duePolicy, ["offsetMinutes"], "Due policy");
  exact(input.escalationPolicy, ["afterMinutes", "role"], "Escalation policy");
  if (input.escalationPolicy.role !== "admin") fail("invalid-argument", "Escalation ownership is restricted to admin.");
  if (!Array.isArray(input.taskTemplates) || input.taskTemplates.length > 12) fail("invalid-argument", "At most 12 named task templates are supported.");
  const keys = new Set();
  const taskTemplates = input.taskTemplates.map((task) => {
    exact(task, ["taskKey", "label", "instruction", "ownerRole", "dueOffsetMinutes", "communicationTemplateRef"], "Task template");
    if (typeof task.taskKey !== "string" || !/^[a-z][a-z0-9_]{0,47}$/.test(task.taskKey) || keys.has(task.taskKey)) fail("invalid-argument", "Task keys must be unique stable lowercase identifiers.");
    keys.add(task.taskKey);
    if (!allowedRoles.includes(task.ownerRole)) fail("invalid-argument", "Task ownership must use an enabled acknowledgment role.");
    if (task.communicationTemplateRef !== null && (typeof task.communicationTemplateRef !== "string" || !Object.hasOwn(HANDOFF_TEMPLATES, task.communicationTemplateRef))) fail("invalid-argument", "The communication handoff reference is unsupported.");
    return { taskKey: task.taskKey, label: plainText(task.label, 80, "Task label"), instruction: plainText(task.instruction, 240, "Task instruction", true), ownerRole: task.ownerRole, dueOffsetMinutes: integer(task.dueOffsetMinutes, 43_200, "Task due offset"), communicationTemplateRef: task.communicationTemplateRef };
  });
  return freeze({ schemaVersion: 1, workflowKind, name: plainText(input.name, 80, "Definition name"), allowedRoles, actualsReviewThresholdCents, comparisonPolicy, duePolicy: { offsetMinutes: integer(input.duePolicy.offsetMinutes, 43_200, "Due offset") }, escalationPolicy: { afterMinutes: integer(input.escalationPolicy.afterMinutes, 43_200, "Escalation offset"), role: "admin" }, taskTemplates });
}
function validateConfigV2(input) {
  exact(input, [...CONFIG_KEYS, "packPolicy"], "Version two workflow config");
  const workflowKind = kind(input.workflowKind);
  const { packPolicy, ...common } = input;
  const validated = validateConfig({ ...common, schemaVersion: 1, workflowKind: "event_execution" });
  if (workflowKind !== "event_execution" && (validated.actualsReviewThresholdCents !== null || validated.comparisonPolicy !== null)) fail("invalid-argument", "Actuals policy is available only for event execution.");
  const roles = (value) => {
    if (!Array.isArray(value) || value.length < 1 || value.length > 2 || !value.includes("admin") || new Set(value).size !== value.length || value.some((role) => !validated.allowedRoles.includes(role))) fail("invalid-argument", "Pack roles must include admin and stay within enabled roles.");
    return [...value].sort();
  };
  const checkpoints = (value) => {
    if (!Array.isArray(value) || value.length > 4 || new Set(value).size !== value.length || value.some((code) => !CHECKPOINT_CODES.includes(code))) fail("invalid-argument", "Checkpoint constraints must use unique fixed checkpoint codes.");
    return CHECKPOINT_CODES.filter((code) => value.includes(code));
  };
  let policy;
  if (workflowKind === "quote_review") {
    exact(packPolicy, ["approval"], "Quote approval policy");
    exact(packPolicy.approval, ["basis", "thresholdCents", "allowedRoles"], "Quote approval threshold");
    if (packPolicy.approval.basis !== "absolute_total_delta_cents") fail("invalid-argument", "The supported approval basis is absolute total delta cents.");
    policy = { approval: { basis: "absolute_total_delta_cents", thresholdCents: packPolicy.approval.thresholdCents === null ? null : integer(packPolicy.approval.thresholdCents, 1_000_000_000, "Approval threshold"), allowedRoles: roles(packPolicy.approval.allowedRoles) } };
  } else if (workflowKind === "event_execution") {
    exact(packPolicy, ["phaseConstraints", "checkpointPrerequisites"], "Event constraints");
    exact(packPolicy.phaseConstraints, ["in_progress", "completed"], "Phase constraints");
    const phaseConstraints = {};
    for (const target of ["in_progress", "completed"]) {
      const constraint = packPolicy.phaseConstraints[target];
      exact(constraint, ["requiredCheckpoints", "blockOpenUrgentIssues"], "Phase constraint");
      if (typeof constraint.blockOpenUrgentIssues !== "boolean") fail("invalid-argument", "Issue blocking must be explicitly declared.");
      phaseConstraints[target] = { requiredCheckpoints: checkpoints(constraint.requiredCheckpoints), blockOpenUrgentIssues: constraint.blockOpenUrgentIssues };
    }
    exact(packPolicy.checkpointPrerequisites, CHECKPOINT_CODES, "Checkpoint prerequisites");
    const prerequisites = Object.fromEntries(CHECKPOINT_CODES.map((code) => [code, checkpoints(packPolicy.checkpointPrerequisites[code])]));
    const visit = (code, ancestors) => {
      if (ancestors.has(code)) fail("invalid-argument", "Checkpoint prerequisites cannot contain cycles or self references.");
      for (const dependency of prerequisites[code]) visit(dependency, new Set([...ancestors, code]));
    };
    CHECKPOINT_CODES.forEach((code) => visit(code, new Set()));
    policy = { phaseConstraints, checkpointPrerequisites: prerequisites };
  } else if (workflowKind === "closeout_follow_up") {
    exact(packPolicy, ["responsibleRoles", "followUpOffsetDays"], "Closeout follow-up policy");
    policy = { responsibleRoles: roles(packPolicy.responsibleRoles), followUpOffsetDays: integer(packPolicy.followUpOffsetDays, 90, "Follow-up calendar offset") };
  } else {
    exact(packPolicy, ["responsibleRoles"], "Attendance coordination policy");
    policy = { responsibleRoles: roles(packPolicy.responsibleRoles) };
  }
  return freeze({ ...validated, schemaVersion: 2, workflowKind, packPolicy: policy });
}
function seedPublishedVersion(workflowKind = "event_execution", options = {}) {
  kind(workflowKind, options);
  if (workflowKind !== "event_execution" && !(options.fixtureOnly && workflowKind === FIXTURE_KIND)) fail("failed-precondition", "This pack requires explicit tenant publication; no seed exists.");
  const config = validateConfig({ schemaVersion: 1, workflowKind, name: workflowKind === "event_execution" ? "QuotePilot event coordination" : "QuotePilot post-event review fixture", allowedRoles: ["admin", "sales"], actualsReviewThresholdCents: null, comparisonPolicy: null, duePolicy: { offsetMinutes: 0 }, escalationPolicy: { afterMinutes: 60, role: "admin" }, taskTemplates: [{ taskKey: "review_event_context", label: "Review event context", instruction: "Review the accepted event context before recording operational work.", ownerRole: "admin", dueOffsetMinutes: 0, communicationTemplateRef: null }] }, options);
  const body = { schemaVersion: 1, organizationId: null, definitionId: workflowKind, workflowKind, versionId: `${workflowKind}_v0`, version: 0, config, publishedBy: { organizationId: null, uid: "quotepilot_source_seed", role: "system" }, publishedAtISO: "2026-09-05T00:00:00.000Z", seed: true };
  return freeze({ ...body, definitionDigest: digest(body) });
}
function validatePublishedVersion(value, { allowSeed = true, workflowKind = "event_execution", fixtureOnly = false } = {}) {
  try {
    exact(value, VERSION_KEYS, "Published workflow definition");
    if (![1, 2].includes(value.schemaVersion)) fail("failed-precondition", "The published definition schema is unsupported.");
    kind(workflowKind, { fixtureOnly });
    if (value.workflowKind !== workflowKind || value.definitionId !== workflowKind || value.versionId !== `${workflowKind}_v${value.version}`) fail("data-loss", "Published definition identity is invalid.");
    if (value.seed === true) {
      if (value.schemaVersion !== 1) fail("data-loss", "Version two definitions cannot claim seed provenance.");
      if (!allowSeed || !equal(value, seedPublishedVersion(workflowKind, { fixtureOnly }))) fail("data-loss", "The source-controlled seed definition is not exact.");
      return seedPublishedVersion(workflowKind, { fixtureOnly });
    }
    if (value.seed !== false || value.version < 1) fail("data-loss", "A tenant-published definition must have a positive version.");
    integer(value.version, MAX_VERSIONS, "Published version");
    const organizationId = identifier(value.organizationId, "Published organization");
    exact(value.publishedBy, ["organizationId", "uid", "role"], "Definition publisher");
    actorFor(value.publishedBy, organizationId);
    iso(value.publishedAtISO);
    const config = validateConfig(value.config, { fixtureOnly });
    if (config.schemaVersion !== value.schemaVersion || config.workflowKind !== workflowKind || !equal(config, value.config)) fail("data-loss", "Published configuration is not canonical.");
    const { definitionDigest, ...body } = value;
    if (definitionDigest !== digest(body)) fail("data-loss", "The published definition failed integrity validation.");
    return freeze(structuredClone(value));
  } catch (error) {
    if (["data-loss", "failed-precondition"].includes(error.code)) throw error;
    fail("data-loss", "Stored published definition evidence is malformed.");
  }
}
function definitionPin(value, { fixtureOnly = false } = {}) {
  const validated = validatePublishedVersion(value, { workflowKind: value?.workflowKind, fixtureOnly });
  return freeze(Object.fromEntries(["workflowKind", "schemaVersion", "definitionId", "versionId", "version", "definitionDigest"].map((key) => [key, validated[key]])));
}
function emptyHead(refs) {
  return { schemaVersion: 1, ...refs, definitionId: refs.workflowKind, revision: 0, draftRevision: 0, draftConfig: null, draftDigest: "", lifetimeVersionCount: 0, activeVersionId: "", createdAtISO: "", updatedAtISO: "", lastReceiptId: "" };
}
function validateHead(value, refs, allowEmpty = false) {
  exact(value, HEAD_KEYS, "Definition head");
  if (value.schemaVersion !== 1) fail("failed-precondition", "The definition head schema is unsupported.");
  if (value.organizationId !== refs.organizationId || value.workflowKind !== refs.workflowKind || value.definitionId !== refs.workflowKind) fail("data-loss", "Definition head identity does not match this organization and kind.");
  integer(value.revision, Number.MAX_SAFE_INTEGER - 1, "Head revision");
  integer(value.draftRevision, value.revision, "Draft revision");
  integer(value.lifetimeVersionCount, Math.min(value.revision, MAX_VERSIONS), "Published lifetime version count");
  if (!value.revision) {
    if (!allowEmpty || !equal(value, emptyHead(refs))) fail("data-loss", "Empty definition head contains fabricated evidence.");
    return value;
  }
  if (!value.draftRevision || !value.draftConfig || !equal(validateConfig(value.draftConfig), value.draftConfig)
    || value.draftConfig.workflowKind !== refs.workflowKind || value.draftDigest !== digest(value.draftConfig)) fail("data-loss", "The stored definition draft is invalid.");
  if (value.activeVersionId !== "" && value.activeVersionId !== `${refs.workflowKind}_v${value.lifetimeVersionCount}`) fail("data-loss", "The active definition version is inconsistent.");
  if (!value.lifetimeVersionCount && value.activeVersionId) fail("data-loss", "A never-published head cannot claim a tenant version.");
  iso(value.createdAtISO); iso(value.updatedAtISO);
  if (value.createdAtISO > value.updatedAtISO || !RECEIPT_PATTERN.test(value.lastReceiptId)) fail("data-loss", "The definition recording evidence is inconsistent.");
  return value;
}
function normalizeRequest(value) {
  if (!isRecord(value) || !["save_draft", "publish", "retire"].includes(value.command)) fail("invalid-argument", "A supported definition lifecycle command is required.");
  const fields = value.command === "save_draft" ? ["config"] : value.command === "publish" ? ["previewDigest", "confirmationText"] : ["versionId", "reason"];
  exact(value, [...REQUEST_KEYS, ...fields], "Definition command");
  const refs = scope(value);
  if (typeof value.requestId !== "string" || !/^[A-Za-z0-9][A-Za-z0-9._:@-]{19,159}$/.test(value.requestId)) fail("invalid-argument", "A stable opaque request ID is required.");
  const output = { ...refs, requestId: value.requestId, expectedRevision: integer(value.expectedRevision, Number.MAX_SAFE_INTEGER - 2, "Expected head revision"), command: value.command };
  if (value.command === "save_draft") {
    output.config = validateConfig(value.config);
    if (output.config.workflowKind !== refs.workflowKind) fail("invalid-argument", "Draft kind does not match its definition.");
  } else if (value.command === "publish") {
    if (typeof value.previewDigest !== "string" || !/^[a-f0-9]{64}$/.test(value.previewDigest)) fail("invalid-argument", "An exact publication preview digest is required.");
    output.previewDigest = value.previewDigest;
    output.confirmationText = plainText(value.confirmationText, 160, "Publication confirmation");
  } else {
    output.versionId = identifier(value.versionId, "Retiring version ID");
    output.reason = plainText(value.reason, 240, "Retirement reason");
  }
  return freeze(output);
}
function receiptIdFor(request) {
  return `workflow_definition_command_${digest({ organizationId: request.organizationId, workflowKind: request.workflowKind, requestId: request.requestId }).slice(0, 48)}`;
}
function previewFor(head, actor) {
  if (!head.draftConfig || head.lifetimeVersionCount >= MAX_VERSIONS) fail("failed-precondition", "A valid draft and remaining lifetime publication capacity are required.");
  const candidateVersion = head.lifetimeVersionCount + 1;
  const body = { schemaVersion: 1, organizationId: head.organizationId, workflowKind: head.workflowKind, definitionId: head.definitionId, headRevision: head.revision, draftRevision: head.draftRevision, draftDigest: head.draftDigest, headDigest: digest(head), candidateVersion, candidateVersionId: `${head.workflowKind}_v${candidateVersion}`, actor };
  const previewDigest = digest(body);
  return freeze({ ...body, previewDigest, confirmationText: `PUBLISH ${body.candidateVersionId} ${previewDigest.slice(0, 12)}`, config: structuredClone(head.draftConfig) });
}
function reduce(head, request, actor, nowISO) {
  if (request.expectedRevision !== head.revision) fail("aborted", "The definition head changed. Reload and preview again.");
  iso(nowISO);
  if (head.updatedAtISO && nowISO < head.updatedAtISO) fail("failed-precondition", "Server recording time precedes the current definition evidence.");
  const next = structuredClone(head);
  let publishedVersion = null;
  if (request.command === "save_draft") {
    if (head.draftConfig?.schemaVersion === 2 && request.config.schemaVersion !== 2) fail("failed-precondition", "A version two catalog cannot downgrade its policy schema.");
    next.draftRevision += 1;
    next.draftConfig = structuredClone(request.config);
    next.draftDigest = digest(request.config);
  } else if (request.command === "publish") {
    const preview = previewFor(head, actor);
    if (request.previewDigest !== preview.previewDigest || request.confirmationText !== preview.confirmationText) fail("failed-precondition", "Publication requires the exact current preview and typed confirmation.");
    const body = { schemaVersion: head.draftConfig.schemaVersion, organizationId: request.organizationId, definitionId: request.workflowKind, workflowKind: request.workflowKind, versionId: preview.candidateVersionId, version: preview.candidateVersion, config: structuredClone(head.draftConfig), publishedBy: actor, publishedAtISO: nowISO, seed: false };
    publishedVersion = { ...body, definitionDigest: digest(body) };
    next.lifetimeVersionCount = publishedVersion.version;
    next.activeVersionId = publishedVersion.versionId;
  } else {
    if (!head.activeVersionId || request.versionId !== head.activeVersionId) fail("failed-precondition", "Retirement must name the exact currently active tenant version.");
    next.activeVersionId = "";
  }
  Object.assign(next, { revision: head.revision + 1, createdAtISO: head.createdAtISO || nowISO, updatedAtISO: nowISO, lastReceiptId: receiptIdFor(request) });
  return { nextHead: next, publishedVersion };
}
function verifyLifecycleReceipt(value) {
  try {
    exact(value, ["schemaVersion", "organizationId", "workflowKind", "receiptId", "requestId", "request", "recordedBy", "recordedAtISO", "commandDigest", "priorHead", "resultHead", "publishedVersion", "receiptDigest"], "Definition lifecycle receipt");
    if (value.schemaVersion !== 1) fail("failed-precondition", "The definition receipt schema is unsupported.");
    const request = normalizeRequest(value.request);
    exact(value.recordedBy, ["organizationId", "uid", "role"], "Definition lifecycle actor");
    const actor = actorFor(value.recordedBy, request.organizationId);
    const refs = scope(request);
    const { receiptDigest, ...body } = value;
    if (value.organizationId !== refs.organizationId || value.workflowKind !== refs.workflowKind || value.requestId !== request.requestId
      || value.receiptId !== receiptIdFor(request) || receiptDigest !== digest(body) || value.commandDigest !== digest({ request, actor })) fail("data-loss", "The definition receipt failed identity or integrity validation.");
    validateHead(value.priorHead, refs, true);
    validateHead(value.resultHead, refs);
    const planned = reduce(value.priorHead, request, actor, value.recordedAtISO);
    if (!equal(planned.nextHead, value.resultHead) || !equal(planned.publishedVersion, value.publishedVersion)) fail("data-loss", "The lifecycle receipt does not match its exact deterministic transition.");
    if (value.publishedVersion) validatePublishedVersion(value.publishedVersion, { allowSeed: false, workflowKind: refs.workflowKind });
    return freeze(structuredClone(value));
  } catch (error) {
    if (["data-loss", "failed-precondition"].includes(error.code)) throw error;
    fail("data-loss", "Stored definition lifecycle evidence is malformed.");
  }
}
function checkedHead(refs, head, currentReceipt) {
  if (!head) {
    if (currentReceipt) fail("data-loss", "A lifecycle receipt has no current definition head.");
    return emptyHead(refs);
  }
  validateHead(head, refs);
  const receipt = verifyLifecycleReceipt(currentReceipt);
  if (!equal(receipt.resultHead, head) || receipt.receiptId !== head.lastReceiptId) fail("data-loss", "The definition head differs from its latest immutable receipt.");
  return head;
}
function previewPublish({ organizationId, workflowKind = "event_execution", actor, head = null, currentReceipt = null }) {
  const refs = scope({ organizationId, workflowKind });
  const trusted = actorFor(actor, organizationId);
  return previewFor(checkedHead(refs, head, currentReceipt), trusted);
}
function planCommand({ request: input, actor, head = null, currentReceipt = null, existingReceipt = null, nowISO }) {
  const request = normalizeRequest(input);
  const trusted = actorFor(actor, request.organizationId);
  const commandDigest = digest({ request, actor: trusted });
  if (existingReceipt) {
    const receipt = verifyLifecycleReceipt(existingReceipt);
    if (receipt.commandDigest !== commandDigest || receipt.receiptId !== receiptIdFor(request)) fail("already-exists", "This request belongs to another immutable definition command.");
    return freeze({ idempotent: true, nextHead: null, publishedVersion: null, receipt });
  }
  const current = checkedHead(scope(request), head, currentReceipt);
  const planned = reduce(current, request, trusted, nowISO);
  const body = { schemaVersion: 1, organizationId: request.organizationId, workflowKind: request.workflowKind, receiptId: receiptIdFor(request), requestId: request.requestId, request, recordedBy: trusted, recordedAtISO: nowISO, commandDigest, priorHead: structuredClone(current), resultHead: planned.nextHead, publishedVersion: planned.publishedVersion };
  const receipt = { ...body, receiptDigest: digest(body) };
  verifyLifecycleReceipt(receipt);
  return freeze({ idempotent: false, ...planned, receipt });
}
const planSaveDraft = (args) => { if (args?.request?.command !== "save_draft") fail("invalid-argument", "A save_draft command is required."); return planCommand(args); };
const planPublish = (args) => { if (args?.request?.command !== "publish") fail("invalid-argument", "A publish command is required."); return planCommand(args); };
const planRetire = (args) => { if (args?.request?.command !== "retire") fail("invalid-argument", "A retire command is required."); return planCommand(args); };
function projectDefinitionSnapshot({ organizationId, workflowKind = "event_execution", head = null, currentReceipt = null, activeVersion = null }) {
  const refs = scope({ organizationId, workflowKind });
  if (!head && activeVersion) fail("data-loss", "A published version has no current definition head; seed fallback is forbidden.");
  if (head?.schemaVersion !== undefined && head.schemaVersion !== 1) return freeze({ ...refs, availability: "schema_drift", reasonCode: "definition_schema_unsupported", revision: null, draft: null, activeVersion: null });
  const current = checkedHead(refs, head, currentReceipt);
  let version = null;
  if (!current.lifetimeVersionCount && workflowKind === "event_execution") version = seedPublishedVersion(workflowKind);
  else if (current.activeVersionId) {
    version = validatePublishedVersion(activeVersion, { allowSeed: false, workflowKind });
    if (version.organizationId !== organizationId || version.versionId !== current.activeVersionId || version.version !== current.lifetimeVersionCount) fail("data-loss", "The active published version does not match its tenant head.");
  }
  return freeze({ ...refs, availability: "available", revision: current.revision, draftRevision: current.draftRevision, draft: current.draftConfig ? structuredClone(current.draftConfig) : null, lifetimeVersionCount: current.lifetimeVersionCount, activeVersion: version, state: !current.lifetimeVersionCount ? (version ? "seed" : "unpublished") : version ? "published" : "retired", newInstanceEligible: Boolean(version), lastReceiptId: current.lastReceiptId, updatedAtISO: current.updatedAtISO });
}
function comparisonPolicyEvidence(version) {
  const definition = validatePublishedVersion(version, { workflowKind: version?.workflowKind });
  if (!definition.config.comparisonPolicy || definition.seed) return null;
  return freeze({ ...definition.config.comparisonPolicy, declaredBy: definition.publishedBy.uid, declaredAtISO: definition.publishedAtISO });
}

module.exports = { RUNTIME_KINDS, CHECKPOINT_CODES, SCHEMA_VERSION, MAX_VERSIONS, HANDOFF_TEMPLATES, validateConfig, seedPublishedVersion, validatePublishedVersion, definitionPin, normalizeRequest, receiptIdFor, previewPublish, planCommand, planSaveDraft, planPublish, planRetire, verifyLifecycleReceipt, projectDefinitionSnapshot, comparisonPolicyEvidence };
