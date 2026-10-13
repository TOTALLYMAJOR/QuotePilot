"use strict";

const { createHash } = require("node:crypto");
const phase = require("./eventOperations");
const definitions = require("./workflowDefinitions");
const POLICY = Object.freeze({ schemaVersion: 1, executionPolicyVersion: 1, maxTasks: 12 });
const canonical = (value) => Array.isArray(value) ? value.map(canonical)
  : value && typeof value === "object" ? Object.fromEntries(Object.keys(value).sort().map((key) => [key, canonical(value[key])])) : value;
const digest = (value) => createHash("sha256").update(JSON.stringify(canonical(value))).digest("hex");
const POLICY_DIGEST = digest(POLICY);
const POLICY_V2 = Object.freeze({ schemaVersion: 2, executionPolicyVersion: 2, maxTasks: 12, observationSchemaVersion: 2 });
const POLICY_DIGEST_V2 = digest(POLICY_V2);
const ADAPTER_IDS = Object.freeze({ event_execution: "event_execution_v2", quote_review: "quote_review_v2", final_guest_count: "final_guest_count_v2", closeout_follow_up: "closeout_follow_up_v2" });
const policyFor = (source) => source.schemaVersion === 2 ? { schemaVersion: 2, executionPolicyVersion: 2, executionPolicyDigest: POLICY_DIGEST_V2 } : { schemaVersion: 1, executionPolicyVersion: 1, executionPolicyDigest: POLICY_DIGEST };
const clone = (value) => structuredClone(value);
function fail(code, message) { throw new phase.EventOperationsError(code, message); }
function exact(value, keys) {
  if (!value || typeof value !== "object" || Array.isArray(value)
    || Object.keys(value).length !== keys.length || keys.some((key) => !Object.hasOwn(value, key))) {
    fail("invalid-argument", "Workflow evidence contains missing or unsupported fields.");
  }
}
function id(value) {
  if (typeof value !== "string" || !/^[^\s/?#\\\u0000]{1,180}$/u.test(value) || [".", ".."].includes(value)) fail("invalid-argument", "An exact workflow identifier is required.");
  return value;
}
function time(value) {
  if (typeof value !== "string" || !Number.isFinite(Date.parse(value)) || new Date(value).toISOString() !== value) fail("invalid-argument", "An exact server timestamp is required.");
  return value;
}
function note(value) {
  if (typeof value !== "string" || !value.trim() || value !== value.trim() || value.length > 240 || /[\u0000-\u001f\u007f]/.test(value)) fail("invalid-argument", "A plain reason of 1 to 240 characters is required.");
  return value;
}
function revision(value, minimum = 0) {
  if (!Number.isSafeInteger(value) || value < minimum || value >= Number.MAX_SAFE_INTEGER) fail("invalid-argument", "A bounded workflow revision is required.");
}
function normalizeSource(value, { fixtureOnly = false } = {}) {
  if (value?.schemaVersion === 2) {
    exact(value, ["schemaVersion", "organizationId", "workflowKind", "subjectId", "sourceVersionId", "sourceReceiptId"]);
    Object.entries(value).filter(([key]) => key !== "schemaVersion").forEach(([, item]) => id(item));
    if (!Object.hasOwn(ADAPTER_IDS, value.workflowKind)) fail("invalid-argument", "Unsupported version two workflow kind.");
    return clone(value);
  }
  exact(value, ["organizationId", "workflowKind", "subjectId", "sourceVersionId", "sourceReceiptId"]);
  Object.values(value).forEach(id);
  if (value.workflowKind !== "event_execution" && !(fixtureOnly && value.workflowKind === "post_event_review")) fail("invalid-argument", "This workflow kind is unavailable.");
  return clone(value);
}
function instanceIdFor(source) { return `workflow_instance_${digest(source).slice(0, 48)}`; }
function receiptIdFor(source, requestId) { return `workflow_command_${digest({ source, requestId: id(requestId) }).slice(0, 48)}`; }
function definitionPin(value) {
  return definitions.definitionPin(value, { fixtureOnly: value.workflowKind === "post_event_review" });
}
function validateDefinition(value, source, options) {
  const result = definitions.validatePublishedVersion(value, { allowSeed: true, workflowKind: source.workflowKind, fixtureOnly: options.fixtureOnly === true });
  if ((source.schemaVersion === 2) !== (result.schemaVersion === 2)) fail("failed-precondition", "Workflow source and definition schemas must agree.");
  if (!result.seed && result.organizationId !== source.organizationId) fail("permission-denied", "The workflow definition belongs to another organization.");
  return clone(result);
}
function domainRef(value, source) {
  if (source.schemaVersion === 2) {
    exact(value, ["schemaVersion", "adapterId", "sourceDigest", "observationKind", "evidenceId", "evidenceDigest", "domainPolicyDigest", "stateCode", "recordedAtISO"]);
    id(value.evidenceId); time(value.recordedAtISO);
    if (value.schemaVersion !== 2 || value.adapterId !== ADAPTER_IDS[source.workflowKind] || value.sourceDigest !== digest(source)
      || !["immutable_receipt", "record_snapshot"].includes(value.observationKind) || !/^[a-z][a-z0-9_]{0,63}$/.test(value.stateCode)
      || !/^[a-f0-9]{64}$/.test(value.evidenceDigest) || !/^[a-f0-9]{64}$/.test(value.domainPolicyDigest)) fail("invalid-argument", "The version two domain observation is invalid.");
    return clone(value);
  }
  exact(value, ["kind", "revision", "receiptId", "policyDigest", "receiptDigest"]);
  revision(value.revision, 1); id(value.receiptId);
  if (value.kind !== (source.workflowKind === "event_execution" ? "event_phase" : "post_event_closeout")
    || !/^[a-f0-9]{64}$/.test(value.policyDigest) || !/^[a-f0-9]{64}$/.test(value.receiptDigest)) fail("invalid-argument", "The trusted domain receipt reference is invalid.");
  return clone(value);
}
function scheduleAnchor(value) {
  if (value?.kind === "instant") {
    exact(value, ["kind", "atISO"]); time(value.atISO);
  } else {
    exact(value, ["kind", "date", "timeZone"]);
    if (value.kind !== "tenant_calendar_date" || !/^\d{4}-\d{2}-\d{2}$/.test(value.date)
      || !Number.isFinite(Date.parse(`${value.date}T00:00:00.000Z`)) || new Date(`${value.date}T00:00:00.000Z`).toISOString().slice(0, 10) !== value.date
      || typeof value.timeZone !== "string" || value.timeZone.length > 80) fail("invalid-argument", "An exact tenant calendar anchor is required.");
    try { new Intl.DateTimeFormat("en-US", { timeZone: value.timeZone }).format(new Date(0)); }
    catch { fail("invalid-argument", "The tenant calendar timezone is invalid."); }
  }
  return clone(value);
}
function normalizeActor(value, source, request) {
  if (source.schemaVersion === 2 && value?.role === "customer") {
    exact(value, ["organizationId", "portalKeySha256", "portalIssuedAtISO", "role"]);
    if (source.workflowKind !== "final_guest_count" || request.command !== "observe_domain" || value.organizationId !== source.organizationId
      || !/^[a-f0-9]{64}$/.test(value.portalKeySha256)) fail("permission-denied", "Portal provenance may only observe its existing attendance workflow.");
    time(value.portalIssuedAtISO);
    return clone(value);
  }
  return phase.normalizeActor(value, source.organizationId);
}
function assertInternalPackRole(actor, config) {
  const roles = config.packPolicy.approval?.allowedRoles || config.packPolicy.responsibleRoles || ["admin"];
  if (!config.allowedRoles.includes(actor.role) || !roles.includes(actor.role)) fail("permission-denied", "The current role cannot perform this configured domain action.");
}
function actualsRef(value) {
  if (value === null) return null;
  exact(value, ["revision", "receiptId", "receiptDigest", "totalCostCents"]);
  revision(value.revision, 1);
  if (!/^event_actuals_command_[a-f0-9]{48}$/.test(value.receiptId) || !/^[a-f0-9]{64}$/.test(value.receiptDigest)
    || !Number.isSafeInteger(value.totalCostCents) || value.totalCostCents < 0 || value.totalCostCents > 50e9) fail("invalid-argument", "An exact actuals review reference is required.");
  return clone(value);
}
function normalizeRequest(value, { internal = false } = {}) {
  const base = ["requestId", "command", "expectedRevision"];
  const fields = {
    initialize: [], observe_domain: [], task_ack: ["taskKey", "note"], task_reopen: ["taskKey", "note"],
    review_ack: ["actualsRevision", "actualsReceiptId", "note"], migrate: ["previewDigest", "confirmation", "note"]
  };
  if (!fields[value?.command] || (!internal && ["initialize", "observe_domain"].includes(value.command))) fail("invalid-argument", "Unsupported workflow command.");
  exact(value, [...base, ...fields[value.command]]); id(value.requestId); revision(value.expectedRevision);
  if (!/^[A-Za-z0-9][A-Za-z0-9._:@-]{19,159}$/.test(value.requestId)) fail("invalid-argument", "A bounded opaque retry identity is required.");
  if (Object.hasOwn(value, "note")) note(value.note);
  if (value.taskKey) id(value.taskKey);
  if (value.command === "review_ack") { revision(value.actualsRevision, 1); id(value.actualsReceiptId); }
  if (value.command === "migrate" && (!/^[a-f0-9]{64}$/.test(value.previewDigest) || typeof value.confirmation !== "string" || value.confirmation.length > 180)) fail("invalid-argument", "An exact migration preview and confirmation are required.");
  return clone(value);
}
function validateState(value, source, options) {
  const v2 = source.schemaVersion === 2;
  const policy = policyFor(source);
  exact(value, ["schemaVersion", "executionPolicyVersion", "executionPolicyDigest", "source", "instanceId", "definition", "definitionPin", "revision", "tasks", "actualsReviewAck", "domainRef", "createdAtISO", "updatedAtISO", "lastReceiptId", ...(v2 ? ["scheduleAnchor"] : [])]);
  if (value.schemaVersion !== policy.schemaVersion || value.executionPolicyVersion !== policy.executionPolicyVersion || value.executionPolicyDigest !== policy.executionPolicyDigest
    || digest(value.source) !== digest(source) || value.instanceId !== instanceIdFor(source)) fail("data-loss", "Workflow identity or execution policy changed.");
  const definition = validateDefinition(value.definition, source, options);
  if (digest(value.definitionPin) !== digest(definitionPin(definition))) fail("data-loss", "The definition pin is inconsistent.");
  revision(value.revision, 1); time(value.createdAtISO); time(value.updatedAtISO);
  if (value.createdAtISO > value.updatedAtISO || !/^workflow_command_[a-f0-9]{48}$/.test(value.lastReceiptId)) fail("data-loss", "Workflow recording metadata is inconsistent.");
  if (!definition.seed && definition.publishedAtISO > value.updatedAtISO) fail("data-loss", "Workflow state precedes its definition publication.");
  domainRef(value.domainRef, source);
  if (v2) {
    scheduleAnchor(value.scheduleAnchor);
    if (value.domainRef.recordedAtISO > value.updatedAtISO) fail("data-loss", "Domain observation postdates coordinator evidence.");
  }
  if (!Array.isArray(value.tasks) || value.tasks.length !== definition.config.taskTemplates.length || value.tasks.length > 12) fail("data-loss", "The workflow task set is inconsistent.");
  value.tasks.forEach((task, index) => {
    exact(task, ["taskKey", "state", "note", "updatedAtISO", "lastReceiptId"]);
    if (task.taskKey !== definition.config.taskTemplates[index].taskKey || !["pending", "acknowledged"].includes(task.state)) fail("data-loss", "The workflow task identity is invalid.");
    if (task.updatedAtISO === "") {
      if (task.state !== "pending" || task.note !== "" || task.lastReceiptId !== "") fail("data-loss", "A pristine task contains fabricated acknowledgement.");
    } else {
      time(task.updatedAtISO); note(task.note);
      if (task.updatedAtISO < value.createdAtISO || task.updatedAtISO > value.updatedAtISO || !/^workflow_command_[a-f0-9]{48}$/.test(task.lastReceiptId)) fail("data-loss", "Task recording metadata is invalid.");
    }
  });
  if (value.actualsReviewAck !== null) {
    const ack = value.actualsReviewAck;
    exact(ack, ["actualsRef", "note", "recordedAtISO", "receiptId"]); actualsRef(ack.actualsRef); note(ack.note); time(ack.recordedAtISO);
    if (!ack.actualsRef || ack.recordedAtISO < value.createdAtISO || ack.recordedAtISO > value.updatedAtISO || !/^workflow_command_[a-f0-9]{48}$/.test(ack.receiptId)
      || definition.config.actualsReviewThresholdCents === null || ack.actualsRef.totalCostCents < definition.config.actualsReviewThresholdCents) fail("data-loss", "Actuals acknowledgement is inconsistent with its policy.");
  }
  return value;
}
function migrationPreview(state, target) {
  const old = state.definition.config;
  const next = target.config;
  const reasons = [];
  if (target.workflowKind !== state.definition.workflowKind || target.schemaVersion !== state.definition.schemaVersion) reasons.push("workflow_schema_changed");
  if (state.schemaVersion === 2 && digest(old.packPolicy) !== digest(next.packPolicy)) reasons.push("pack_policy_changed");
  if (digest(old.comparisonPolicy) !== digest(next.comparisonPolicy) || old.actualsReviewThresholdCents !== next.actualsReviewThresholdCents) reasons.push("threshold_policy_changed");
  for (const template of old.taskTemplates) {
    const replacement = next.taskTemplates.find((item) => item.taskKey === template.taskKey);
    if (!replacement) reasons.push(`task_removed:${template.taskKey}`);
    else if (state.tasks.find((task) => task.taskKey === template.taskKey).state === "acknowledged" && digest(template) !== digest(replacement)) reasons.push(`acknowledged_task_changed:${template.taskKey}`);
  }
  const body = { instanceId: state.instanceId, source: clone(state.source), expectedRevision: state.revision,
    currentDefinitionPin: clone(state.definitionPin), targetDefinitionPin: definitionPin(target),
    targetConfiguration: clone(target.config),
    domainRef: clone(state.domainRef), compatible: reasons.length === 0, reasons,
    confirmation: `MIGRATE ${target.versionId}` };
  return { ...body, previewDigest: digest(body) };
}
function reduce({ source, prior, request, actor, definition, domain, actuals, anchor = null, recordedAtISO, receiptId, options }) {
  const v2 = source.schemaVersion === 2;
  if (anchor !== null && (!v2 || request.command !== "initialize")) fail("invalid-argument", "A schedule anchor belongs only to version two initialization.");
  if (v2 && domain && domain.recordedAtISO > recordedAtISO) fail("failed-precondition", "Domain observation postdates command recording.");
  const expectsDefinition = ["initialize", "migrate"].includes(request.command);
  const expectsDomain = ["initialize", "observe_domain"].includes(request.command);
  const expectsActuals = request.command === "review_ack";
  if ((!expectsDefinition && definition !== null) || (!expectsDomain && domain !== null)
    || (!expectsActuals && actuals !== null)) fail("invalid-argument", "This command contains unrelated contextual evidence.");
  if (definition && !definition.seed && definition.publishedAtISO > recordedAtISO) fail("failed-precondition", "The workflow definition was not yet published at recording time.");
  const admin = () => { if (actor.role !== "admin") fail("permission-denied", "Administrator workflow authority is required."); };
  if (request.command === "initialize") {
    if (!v2) admin();
    else if (definition) assertInternalPackRole(actor, definition.config);
    if (prior || request.expectedRevision !== 0 || !definition || !domain) fail("failed-precondition", "Workflow initialization requires a new exact source and trusted domain receipt.");
    if (!v2 && source.workflowKind === "event_execution" && domain.revision !== 1) fail("failed-precondition", "A new event binding requires its original initialization receipt.");
    if (v2 && !anchor) fail("invalid-argument", "Version two initialization requires its domain-owned schedule anchor.");
    return { ...policyFor(source), ...(v2 ? { scheduleAnchor: scheduleAnchor(anchor) } : {}), source: clone(source), instanceId: instanceIdFor(source), definition: clone(definition), definitionPin: definitionPin(definition), revision: 1,
      tasks: definition.config.taskTemplates.map((task) => ({ taskKey: task.taskKey, state: "pending", note: "", updatedAtISO: "", lastReceiptId: "" })),
      actualsReviewAck: null, domainRef: clone(domain), createdAtISO: recordedAtISO, updatedAtISO: recordedAtISO, lastReceiptId: receiptId };
  }
  if (!prior) fail("failed-precondition", "This source has no configured workflow binding.");
  if (prior.revision !== request.expectedRevision) fail("aborted", "The workflow changed. Refresh before trying again.");
  if (actor.role !== "customer" && !prior.definition.config.allowedRoles.includes(actor.role)) fail("permission-denied", "This role is not enabled for the workflow.");
  const result = clone(prior);
  if (request.command === "observe_domain") {
    if (!v2) admin();
    else if (actor.role !== "customer") assertInternalPackRole(actor, prior.definition.config);
    if (v2) {
      if (!domain || digest(domain) === digest(prior.domainRef) || domain.recordedAtISO < prior.domainRef.recordedAtISO) fail("failed-precondition", "A fresh non-stale trusted domain observation is required.");
    } else if (!domain || domain.kind !== prior.domainRef.kind || domain.policyDigest !== prior.domainRef.policyDigest || domain.revision !== prior.domainRef.revision + 1) fail("failed-precondition", "Only the next trusted domain receipt can advance coordination.");
    result.domainRef = clone(domain);
  } else if (["task_ack", "task_reopen"].includes(request.command)) {
    const index = result.tasks.findIndex((task) => task.taskKey === request.taskKey);
    if (index < 0) fail("invalid-argument", "Unknown configured task.");
    if (actor.role !== "admin" && actor.role !== prior.definition.config.taskTemplates[index].ownerRole) fail("permission-denied", "Only the task owner role or administrator may record this acknowledgement.");
    const target = request.command === "task_ack" ? "acknowledged" : "pending";
    if (result.tasks[index].state === target) fail("failed-precondition", "The task is already in that state.");
    result.tasks[index] = { taskKey: request.taskKey, state: target, note: request.note, updatedAtISO: recordedAtISO, lastReceiptId: receiptId };
  } else if (request.command === "review_ack") {
    admin();
    if (!actuals || actuals.revision !== request.actualsRevision || actuals.receiptId !== request.actualsReceiptId) fail("aborted", "Actuals changed. Review the current exact receipt.");
    if (prior.definition.config.actualsReviewThresholdCents === null || actuals.totalCostCents < prior.definition.config.actualsReviewThresholdCents) fail("failed-precondition", "No actuals review is required by this definition.");
    result.actualsReviewAck = { actualsRef: clone(actuals), note: request.note, recordedAtISO, receiptId };
  } else if (request.command === "migrate") {
    admin();
    if (!definition) fail("invalid-argument", "The exact target definition is required.");
    const preview = migrationPreview(prior, definition);
    if (!preview.compatible) fail("failed-precondition", "This definition migration is incompatible.");
    if (request.previewDigest !== preview.previewDigest || request.confirmation !== preview.confirmation) fail("aborted", "The migration preview or typed confirmation changed.");
    result.definition = clone(definition); result.definitionPin = definitionPin(definition);
    result.tasks = definition.config.taskTemplates.map((template) => clone(prior.tasks.find((task) => task.taskKey === template.taskKey)
      || { taskKey: template.taskKey, state: "pending", note: "", updatedAtISO: "", lastReceiptId: "" }));
  }
  result.revision += 1; result.updatedAtISO = recordedAtISO; result.lastReceiptId = receiptId;
  return result;
}
function verifyReceipt(receipt, options = {}) {
  try {
    const v2 = receipt?.source?.schemaVersion === 2;
    const policy = policyFor(receipt?.source || {});
    exact(receipt, ["schemaVersion", "executionPolicyVersion", "executionPolicyDigest", "source", "instanceId", "receiptId", "request", "recordedBy", "recordedAtISO", "commandDigest", "priorRevision", "resultRevision", "definition", "domainRef", "actualsRef", "priorInstance", "resultInstance", "receiptDigest", ...(v2 ? ["scheduleAnchor"] : [])]);
    const { receiptDigest, ...body } = receipt;
    const source = normalizeSource(body.source, options);
    const request = normalizeRequest(body.request, { internal: true });
    exact(body.recordedBy, v2 && body.recordedBy?.role === "customer" ? ["organizationId", "portalKeySha256", "portalIssuedAtISO", "role"] : ["organizationId", "uid", "role"]);
    const actor = normalizeActor(body.recordedBy, source, request);
    time(body.recordedAtISO);
    if (body.schemaVersion !== policy.schemaVersion || body.executionPolicyVersion !== policy.executionPolicyVersion || body.executionPolicyDigest !== policy.executionPolicyDigest || digest(body) !== receiptDigest
      || body.instanceId !== instanceIdFor(source) || body.receiptId !== receiptIdFor(source, request.requestId)
      || body.commandDigest !== digest({ source, request, actor }) || body.priorRevision !== request.expectedRevision || body.resultRevision !== body.priorRevision + 1) fail("data-loss", "Workflow command receipt integrity failed.");
    const definition = body.definition === null ? null : validateDefinition(body.definition, source, options);
    const domain = body.domainRef === null ? null : domainRef(body.domainRef, source);
    const actuals = actualsRef(body.actualsRef);
    const prior = body.priorInstance;
    if (prior) validateState(prior, source, options);
    if (prior && body.recordedAtISO < prior.updatedAtISO) fail("data-loss", "Workflow receipt time precedes its prior state.");
    const reproduced = reduce({ source, prior, request, actor, definition, domain, actuals, anchor: v2 ? body.scheduleAnchor : null, recordedAtISO: body.recordedAtISO, receiptId: body.receiptId, options });
    validateState(body.resultInstance, source, options);
    if (digest(reproduced) !== digest(body.resultInstance)) fail("data-loss", "Workflow receipt result does not reproduce its command.");
    return receipt;
  } catch (error) {
    if (error.code === "data-loss") throw error;
    fail("data-loss", "Workflow stored evidence failed validation.");
  }
}
function verifyInstance(source, instance, receipt, options = {}) {
  normalizeSource(source, options);
  verifyReceipt(receipt, options);
  if (digest(receipt.source) !== digest(source) || digest(receipt.resultInstance) !== digest(instance)) fail("data-loss", "The workflow instance does not match its latest receipt.");
  return instance;
}
function planCommand({ source: sourceInput, request: requestInput, actor: actorInput, instance = null, currentReceipt = null, existingReceipt = null, definition: definitionInput = null, domainRef: domainInput = null, actualsRef: actualsInput = null, scheduleAnchor: anchorInput = null, nowISO, internal = false, fixtureOnly = false }) {
  const options = { fixtureOnly };
  const source = normalizeSource(sourceInput, options);
  const request = normalizeRequest(requestInput, { internal });
  const actor = normalizeActor(actorInput, source, request);
  const commandDigest = digest({ source, request, actor });
  if (existingReceipt) {
    verifyReceipt(existingReceipt, options);
    if (existingReceipt.commandDigest !== commandDigest || existingReceipt.receiptId !== receiptIdFor(source, request.requestId)) fail("already-exists", "This request identity belongs to another immutable workflow command.");
    return { idempotent: true, nextInstance: null, receipt: clone(existingReceipt) };
  }
  if (instance) verifyInstance(source, instance, currentReceipt, options);
  else if (currentReceipt) fail("data-loss", "Workflow receipts exist without their current instance.");
  if (instance?.revision === Number.MAX_SAFE_INTEGER - 1) fail("resource-exhausted", "The workflow revision bound has been reached.");
  const definition = definitionInput === null ? null : validateDefinition(definitionInput, source, options);
  const domain = domainInput === null ? null : domainRef(domainInput, source);
  const actuals = actualsRef(actualsInput);
  const recordedAtISO = time(nowISO);
  if (instance && recordedAtISO < instance.updatedAtISO) fail("failed-precondition", "Server recording time precedes current workflow state.");
  const receiptId = receiptIdFor(source, request.requestId);
  const nextInstance = reduce({ source, prior: instance, request, actor, definition, domain, actuals, anchor: anchorInput, recordedAtISO, receiptId, options });
  const body = { ...policyFor(source), ...(source.schemaVersion === 2 ? { scheduleAnchor: clone(anchorInput) } : {}), source, instanceId: instanceIdFor(source), receiptId, request, recordedBy: actor, recordedAtISO, commandDigest,
    priorRevision: request.expectedRevision, resultRevision: nextInstance.revision, definition, domainRef: domain, actualsRef: actuals, priorInstance: clone(instance), resultInstance: nextInstance };
  const receipt = { ...body, receiptDigest: digest(body) };
  verifyReceipt(receipt, options);
  return { idempotent: false, nextInstance, receipt };
}
function previewMigration({ source, instance, currentReceipt, targetDefinition, fixtureOnly = false }) {
  verifyInstance(source, instance, currentReceipt, { fixtureOnly });
  return migrationPreview(instance, validateDefinition(targetDefinition, source, { fixtureOnly }));
}
function projectSnapshot({ source, instance = null, receipt = null, actualsRef: actualsInput = null, observedAtISO, fixtureOnly = false }) {
  normalizeSource(source, { fixtureOnly }); time(observedAtISO);
  const base = { source: clone(source), instanceId: instanceIdFor(source), observedAtISO, historyCoverage: "latest_receipt_only" };
  if (!instance) {
    if (receipt) fail("data-loss", "Workflow history exists without a current binding.");
    return { ...base, ...(source.schemaVersion === 2 ? { schemaVersion: 2 } : {}), availability: "not_yet_available", reasonCode: source.schemaVersion === 2 ? "not_initialized" : "legacy_unbound", revision: 0, tasks: [], actualsReview: { state: "not_yet_available" } };
  }
  verifyInstance(source, instance, receipt, { fixtureOnly });
  if (observedAtISO < instance.updatedAtISO) fail("failed-precondition", "Observation time precedes current workflow evidence.");
  const config = instance.definition.config;
  const actuals = actualsRef(actualsInput);
  if (source.schemaVersion === 2) return projectSnapshotV2({ source, instance, base, config, actuals, observedAtISO });
  const offset = (minutes) => {
    const value = new Date(Date.parse(instance.createdAtISO) + minutes * 60000);
    if (!Number.isFinite(value.getTime())) fail("failed-precondition", "Workflow due time is outside the supported range.");
    return value.toISOString();
  };
  const tasks = config.taskTemplates.map((template, index) => {
    const task = instance.tasks[index];
    const dueAtISO = offset(template.dueOffsetMinutes);
    const escalationAtISO = offset(template.dueOffsetMinutes + config.escalationPolicy.afterMinutes);
    return { ...clone(template), ...clone(task), dueAtISO, escalationAtISO,
      communicationHandoff: template.communicationTemplateRef === null ? null : {
        reference: template.communicationTemplateRef, ...clone(definitions.HANDOFF_TEMPLATES[template.communicationTemplateRef])
      },
      urgency: task.state === "acknowledged" ? "acknowledged" : observedAtISO >= escalationAtISO ? "escalated" : observedAtISO >= dueAtISO ? "due" : "upcoming",
      escalationRole: config.escalationPolicy.role };
  });
  const required = actuals && config.actualsReviewThresholdCents !== null && actuals.totalCostCents >= config.actualsReviewThresholdCents;
  const acknowledged = required && instance.actualsReviewAck && digest(instance.actualsReviewAck.actualsRef) === digest(actuals);
  return { ...base, availability: "available", reasonCode: "", revision: instance.revision, definitionPin: clone(instance.definitionPin), definitionName: config.name,
    domainRef: clone(instance.domainRef), configuration: clone(config),
    definitionSource: instance.definition.seed ? "source_controlled_seed" : "tenant_published",
    publishedBy: { uid: instance.definition.publishedBy.uid, role: instance.definition.publishedBy.role },
    publishedAtISO: instance.definition.publishedAtISO,
    tasks, dueAtISO: offset(config.duePolicy.offsetMinutes),
    escalationAtISO: offset(config.duePolicy.offsetMinutes + config.escalationPolicy.afterMinutes),
    actualsReview: { state: config.actualsReviewThresholdCents === null ? "not_applicable" : !actuals ? "not_yet_available" : !required ? "not_required" : acknowledged ? "acknowledged" : "required",
      actualsRef: actuals, thresholdCents: config.actualsReviewThresholdCents },
    comparisonPolicy: config.comparisonPolicy === null ? null : { ...clone(config.comparisonPolicy), declaredBy: instance.definition.publishedBy.uid, declaredAtISO: instance.definition.publishedAtISO },
    lastReceiptId: instance.lastReceiptId, updatedAtISO: instance.updatedAtISO };
}
function projectSnapshotV2({ source, instance, base, config, actuals, observedAtISO }) {
  const anchor = scheduleAnchor(instance.scheduleAnchor);
  const calendarSerial = (iso, zone) => {
    const parts = Object.fromEntries(new Intl.DateTimeFormat("en-CA", { timeZone: zone, year: "numeric", month: "2-digit", day: "2-digit", hour: "2-digit", minute: "2-digit", hourCycle: "h23" }).formatToParts(new Date(iso)).map((part) => [part.type, part.value]));
    return Date.parse(`${parts.year}-${parts.month}-${parts.day}T${parts.hour}:${parts.minute}:00.000Z`);
  };
  const origin = anchor.kind === "instant" ? Date.parse(anchor.atISO) : Date.parse(`${anchor.date}T00:00:00.000Z`);
  const observed = anchor.kind === "instant" ? Date.parse(observedAtISO) : calendarSerial(observedAtISO, anchor.timeZone);
  const schedule = (minutes) => {
    const date = new Date(origin + minutes * 60_000);
    if (!Number.isFinite(date.getTime())) fail("failed-precondition", "The configured schedule is outside supported bounds.");
    return anchor.kind === "instant" ? { kind: "instant", atISO: date.toISOString() }
      : { kind: "tenant_calendar_date", date: date.toISOString().slice(0, 10), minuteOfDay: date.getUTCHours() * 60 + date.getUTCMinutes(), timeZone: anchor.timeZone };
  };
  const tasks = config.taskTemplates.map((template, index) => {
    const task = instance.tasks[index];
    const dueMinutes = template.dueOffsetMinutes;
    return { ...clone(template), ...clone(task), due: schedule(dueMinutes), escalation: schedule(dueMinutes + config.escalationPolicy.afterMinutes),
      urgency: task.state === "acknowledged" ? "acknowledged" : observed >= origin + (dueMinutes + config.escalationPolicy.afterMinutes) * 60_000 ? "escalated" : observed >= origin + dueMinutes * 60_000 ? "due" : "upcoming",
      escalationRole: "admin", communicationHandoff: template.communicationTemplateRef === null ? null : { reference: template.communicationTemplateRef, ...clone(definitions.HANDOFF_TEMPLATES[template.communicationTemplateRef]) } };
  });
  const required = actuals && config.actualsReviewThresholdCents !== null && actuals.totalCostCents >= config.actualsReviewThresholdCents;
  const acknowledged = required && instance.actualsReviewAck && digest(instance.actualsReviewAck.actualsRef) === digest(actuals);
  return { ...base, schemaVersion: 2, availability: "available", reasonCode: "", revision: instance.revision, definitionPin: clone(instance.definitionPin), definitionName: config.name,
    domainRef: clone(instance.domainRef), configuration: clone(config), definitionSource: "tenant_published", publishedBy: { uid: instance.definition.publishedBy.uid, role: instance.definition.publishedBy.role }, publishedAtISO: instance.definition.publishedAtISO,
    scheduleAnchor: anchor, due: schedule(config.duePolicy.offsetMinutes), escalation: schedule(config.duePolicy.offsetMinutes + config.escalationPolicy.afterMinutes), tasks,
    actualsReview: { state: config.actualsReviewThresholdCents === null ? "not_applicable" : !actuals ? "not_yet_available" : !required ? "not_required" : acknowledged ? "acknowledged" : "required", actualsRef: actuals, thresholdCents: config.actualsReviewThresholdCents },
    comparisonPolicy: definitions.comparisonPolicyEvidence(instance.definition), lastReceiptId: instance.lastReceiptId, updatedAtISO: instance.updatedAtISO };
}
module.exports = { POLICY_V2, POLICY_DIGEST_V2, ADAPTER_IDS, validateDomainRef: domainRef, validateScheduleAnchor: scheduleAnchor, POLICY, POLICY_DIGEST, digest, normalizeSource, normalizeRequest, instanceIdFor, receiptIdFor, verifyReceipt, verifyInstance, planCommand, previewMigration, projectSnapshot };
