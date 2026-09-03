/**
 * Same-runtime presentation state for consequential staff actions.
 *
 * This contract can describe what the UI knows about an action, but it cannot
 * perform, retry, reconcile, authorize, or persist that action. In particular,
 * this module deliberately has no browser-storage, network, provider, or domain
 * mutation dependency.
 */

export const WORKSPACE_ACTION_FEEDBACK_MODEL = "workspace-action-feedback-v1";
export const WORKSPACE_ACTION_FEEDBACK_AUTHORITY = "presentation_only";
export const WORKSPACE_ACTION_FEEDBACK_PERSISTENCE = "same_runtime";
export const WORKSPACE_ACTION_FEEDBACK_MAX_RECORDS = 4;

export const WORKSPACE_ACTION_FEEDBACK_PHASES = /* @__PURE__ */ Object.freeze([
  "pending",
  "succeeded",
  "recovery",
  "uncertain",
  "cancelled"
]);

export const WORKSPACE_ACTION_FEEDBACK_NEXT_ACTION_IDS = /* @__PURE__ */ Object.freeze([
  "acknowledge",
  "inspect",
  "reconcile",
  "return"
]);

const UNCERTAIN_NEXT_ACTION_IDS = /* @__PURE__ */ Object.freeze([
  "inspect",
  "reconcile"
]);

export const WORKSPACE_ACTION_FEEDBACK_EVIDENCE_KINDS = /* @__PURE__ */ Object.freeze([
  "authoritative_readback",
  "authoritative_receipt",
  "authoritative_confirmation",
  "browser_local_readback"
]);

export const WORKSPACE_ACTION_FEEDBACK_DISPATCH_STATES = /* @__PURE__ */ Object.freeze([
  "not_dispatched",
  "dispatched"
]);

export const WORKSPACE_ACTION_FEEDBACK_MODES = /* @__PURE__ */ Object.freeze([
  "dispatch",
  "reconcile"
]);

export const WORKSPACE_ACTION_FEEDBACK_CANCELLATION_KINDS = /* @__PURE__ */ Object.freeze([
  "pre_dispatch",
  "authoritative_cancellation"
]);

const TERMINAL_PHASES = /* @__PURE__ */ Object.freeze([
  "succeeded",
  "recovery",
  "cancelled"
]);

const DISMISSIBLE_PHASES = /* @__PURE__ */ Object.freeze([
  ...TERMINAL_PHASES
]);

const UNRESOLVED_PHASES = /* @__PURE__ */ Object.freeze([
  "pending",
  "uncertain"
]);

const TRANSITIONS = /* @__PURE__ */ Object.freeze({
  pending: Object.freeze(["pending", "succeeded", "recovery", "uncertain", "cancelled"]),
  uncertain: Object.freeze(["pending", "succeeded", "cancelled"]),
  succeeded: Object.freeze([]),
  recovery: Object.freeze([]),
  cancelled: Object.freeze([])
});

const REGISTRY_KEYS = /* @__PURE__ */ Object.freeze([
  "modelId",
  "authority",
  "persistence",
  "scope",
  "records",
  "revision"
]);
const SCOPE_KEYS = /* @__PURE__ */ Object.freeze([
  "organizationId",
  "principalId",
  "role"
]);
const RECORD_KEYS = /* @__PURE__ */ Object.freeze([
  "phase",
  "actionId",
  "actionLabel",
  "attemptId",
  "generation",
  "object",
  "message",
  "changed",
  "unchanged",
  "dispatchState",
  "mode",
  "evidence",
  "cancellation",
  "nextAction",
  "startedAtISO",
  "updatedAtISO",
  "revision"
]);
const OBJECT_KEYS = /* @__PURE__ */ Object.freeze(["kind", "id", "label"]);
const EVIDENCE_KEYS = /* @__PURE__ */ Object.freeze(["kind", "id", "source"]);
const CANCELLATION_KEYS = /* @__PURE__ */ Object.freeze(["kind", "id", "source"]);
const NEXT_ACTION_KEYS = /* @__PURE__ */ Object.freeze(["id", "label"]);
const SELECTOR_KEYS = /* @__PURE__ */ Object.freeze([
  "scope",
  "attemptId",
  "actionId",
  "object",
  "generation",
  "recordRevision"
]);

const MAX_IDENTIFIER_LENGTH = 160;
const MAX_LABEL_LENGTH = 160;
const MAX_MESSAGE_LENGTH = 320;
const MAX_SUMMARY_LENGTH = 180;
const MAX_SUMMARY_COUNT = 5;
const MAX_RECORD_SERIALIZED_LENGTH = 4096;

const UNSAFE_PRESENTATION_EMAIL = /\b[A-Z0-9._%+-]+@[A-Z0-9.-]+\b/iu;
const UNSAFE_PRESENTATION_CREDENTIAL = /\b(?:api[\s_-]*key|authorization|bearer|client[\s_-]*secret|credential|password|passwd|private[\s_-]*key|secret|token)\b/iu;
const UNSAFE_PRESENTATION_PROVIDER_ERROR = /(?:\b(?:firebase|firestore|provider|sendgrid|stripe|twilio)[a-z]*\s*(?:error|exception|failure|payload|response)\b|\b(?:error|exception)\s*:|\bat\s+\S+\s*\([^)]*:\d+:\d+\))/iu;
const UNSAFE_PRESENTATION_RAW_NOTE = /\b(?:customer|internal|private)\s+(?:note|message)\s*:/iu;
const UNSAFE_PRESENTATION_SECRET_PREFIX = /\b(?:pk|rk|sk)_(?:live|test)_[A-Za-z0-9_-]+\b/u;
const UNSAFE_PRESENTATION_OPAQUE_BLOB = /\b[A-Za-z0-9_-]{40,}={0,2}\b/u;
const UNSAFE_PRESENTATION_FORMATTING = /[\u061C\u200B-\u200F\u2028-\u202E\u2060-\u206F\uFEFF]/u;

let attemptSequence = 0;

class WorkspaceActionFeedbackError extends TypeError {
  constructor(code) {
    super(code);
    this.name = "WorkspaceActionFeedbackError";
    this.code = code;
  }
}

function fail(code) {
  throw new WorkspaceActionFeedbackError(code);
}

function deepFreeze(value, seen = new WeakSet()) {
  if (!value || typeof value !== "object" || seen.has(value)) return value;
  seen.add(value);
  Reflect.ownKeys(value).forEach((key) => deepFreeze(value[key], seen));
  return Object.freeze(value);
}

function isDeepFrozen(value, seen = new WeakSet()) {
  if (!value || typeof value !== "object" || seen.has(value)) return true;
  if (!Object.isFrozen(value)) return false;
  seen.add(value);
  return Reflect.ownKeys(value).every((key) => isDeepFrozen(value[key], seen));
}

function isPlainRecord(value) {
  if (!value || typeof value !== "object" || Array.isArray(value)) return false;
  const prototype = Object.getPrototypeOf(value);
  return prototype === Object.prototype || prototype === null;
}

function exactRecord(value, keys, code = "invalid_input") {
  if (!isPlainRecord(value)) fail(code);
  const actual = Object.keys(value);
  if (actual.length !== keys.length || actual.some((key) => !keys.includes(key))) fail(code);
  return value;
}

function allowedRecord(value, keys, code = "invalid_input") {
  if (!isPlainRecord(value)) fail(code);
  if (Object.keys(value).some((key) => !keys.includes(key))) fail(code);
  return value;
}

function requiredText(value, maximumLength, code = "invalid_input") {
  if (
    typeof value !== "string"
    || !value
    || value !== value.trim()
    || value.length > maximumLength
    || /[\u0000-\u001F\u007F-\u009F]/u.test(value)
  ) {
    fail(code);
  }
  return value;
}

/**
 * Defense-in-depth boundary for prose rendered by the shared feedback rail.
 *
 * This rejects recognizable sensitive payloads and deceptive formatting. It
 * cannot prove that arbitrary otherwise-normal prose was not copied from a
 * customer note. A future categorical guarantee for raw prose therefore
 * requires coded copy/templates at the adapter boundary rather than a string
 * classifier.
 */
function presentationText(value, maximumLength, code = "invalid_input") {
  const text = requiredText(value, maximumLength, code);
  if (
    UNSAFE_PRESENTATION_EMAIL.test(text)
    || UNSAFE_PRESENTATION_CREDENTIAL.test(text)
    || UNSAFE_PRESENTATION_PROVIDER_ERROR.test(text)
    || UNSAFE_PRESENTATION_RAW_NOTE.test(text)
    || UNSAFE_PRESENTATION_SECRET_PREFIX.test(text)
    || UNSAFE_PRESENTATION_OPAQUE_BLOB.test(text)
    || UNSAFE_PRESENTATION_FORMATTING.test(text)
  ) {
    fail("unsafe_presentation_text");
  }
  return text;
}

function presentationLabel(value, code = "invalid_input") {
  const label = presentationText(value, MAX_LABEL_LENGTH, code);
  if (label.length < 2) fail(code);
  return label;
}

function presentationMessage(value, code = "invalid_input") {
  const message = presentationText(value, MAX_MESSAGE_LENGTH, code);
  if (message.length < 8) fail(code);
  return message;
}

function opaqueId(value, code = "unsafe_identifier") {
  const id = requiredText(value, MAX_IDENTIFIER_LENGTH, code);
  if (!/^[A-Za-z0-9][A-Za-z0-9._:()~-]*$/u.test(id)) fail(code);
  return id;
}

function canonicalInstant(value, code = "invalid_input") {
  const candidate = requiredText(value, 32, code);
  if (!/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/u.test(candidate)) fail(code);
  const parsed = Date.parse(candidate);
  if (!Number.isFinite(parsed) || new Date(parsed).toISOString() !== candidate) fail(code);
  return candidate;
}

function nonnegativeInteger(value, code = "invalid_input") {
  if (!Number.isSafeInteger(value) || value < 0) fail(code);
  return value;
}

function sameJson(left, right) {
  return JSON.stringify(left) === JSON.stringify(right);
}

function canonicalScope(value, code = "invalid_scope") {
  const input = exactRecord(value, SCOPE_KEYS, code);
  const role = opaqueId(input.role, code);
  if (role !== role.toLowerCase()) fail(code);
  return {
    organizationId: opaqueId(input.organizationId, code),
    principalId: opaqueId(input.principalId, code),
    role
  };
}

function canonicalObject(value, code = "invalid_input") {
  const input = exactRecord(value, OBJECT_KEYS, code);
  return {
    kind: opaqueId(input.kind, code),
    id: opaqueId(input.id, code),
    label: presentationLabel(input.label, code)
  };
}

function canonicalSummaries(value, code = "invalid_input") {
  if (!Array.isArray(value) || value.length > MAX_SUMMARY_COUNT) fail(code);
  return value.map((item) => presentationText(item, MAX_SUMMARY_LENGTH, code));
}

function canonicalEvidence(value, code = "invalid_input") {
  const input = exactRecord(value, EVIDENCE_KEYS, code);
  if (!WORKSPACE_ACTION_FEEDBACK_EVIDENCE_KINDS.includes(input.kind)) fail(code);
  return {
    kind: input.kind,
    id: opaqueId(input.id, code),
    source: opaqueId(input.source, code)
  };
}

function canonicalCancellation(value, code = "missing_cancellation_basis") {
  const input = exactRecord(value, CANCELLATION_KEYS, code);
  if (!WORKSPACE_ACTION_FEEDBACK_CANCELLATION_KINDS.includes(input.kind)) fail(code);
  return {
    kind: input.kind,
    id: opaqueId(input.id, code),
    source: opaqueId(input.source, code)
  };
}

function canonicalDispatchState(value, code = "invalid_dispatch_state") {
  if (!WORKSPACE_ACTION_FEEDBACK_DISPATCH_STATES.includes(value)) fail(code);
  return value;
}

function canonicalMode(value, code = "invalid_mode") {
  if (!WORKSPACE_ACTION_FEEDBACK_MODES.includes(value)) fail(code);
  return value;
}

function canonicalNextAction(value, code = "unsafe_next_action") {
  const input = exactRecord(value, NEXT_ACTION_KEYS, code);
  if (!WORKSPACE_ACTION_FEEDBACK_NEXT_ACTION_IDS.includes(input.id)) fail(code);
  return {
    id: input.id,
    label: presentationLabel(input.label, code)
  };
}

function canonicalGeneration(value, code = "invalid_input") {
  return opaqueId(value, code);
}

function canonicalPhaseFields({ phase, evidence, cancellation, nextAction }, code = "invalid_input") {
  if (!WORKSPACE_ACTION_FEEDBACK_PHASES.includes(phase)) fail("unsupported_phase");
  if (phase === "succeeded") {
    if (evidence == null) fail("missing_evidence");
    if (cancellation != null || nextAction != null) fail(code);
    return {
      evidence: canonicalEvidence(evidence, "missing_evidence"),
      cancellation: null,
      nextAction: null
    };
  }
  if (phase === "recovery" || phase === "uncertain") {
    if (evidence != null || cancellation != null || nextAction == null) fail("unsafe_next_action");
    const safeNextAction = canonicalNextAction(nextAction);
    if (phase === "uncertain" && !UNCERTAIN_NEXT_ACTION_IDS.includes(safeNextAction.id)) {
      fail("unsafe_next_action");
    }
    return {
      evidence: null,
      cancellation: null,
      nextAction: safeNextAction
    };
  }
  if (phase === "cancelled") {
    if (evidence != null || nextAction != null || cancellation == null) {
      fail("missing_cancellation_basis");
    }
    return {
      evidence: null,
      cancellation: canonicalCancellation(cancellation),
      nextAction: null
    };
  }
  if (evidence != null || cancellation != null || nextAction != null) fail(code);
  return { evidence: null, cancellation: null, nextAction: null };
}

function requireSemanticFacts(phase, changed, unchanged, code = "invalid_input") {
  if (phase === "succeeded" && changed.length < 1) fail("missing_changed_summary");
  if (["recovery", "uncertain", "cancelled"].includes(phase) && unchanged.length < 1) {
    fail("missing_unchanged_summary");
  }
}

function canonicalRecord(value, code = "invalid_registry") {
  const input = exactRecord(value, RECORD_KEYS, code);
  const phaseFields = canonicalPhaseFields(input, code);
  const changed = canonicalSummaries(input.changed, code);
  const unchanged = canonicalSummaries(input.unchanged, code);
  requireSemanticFacts(input.phase, changed, unchanged, code);
  const record = {
    phase: input.phase,
    actionId: opaqueId(input.actionId, code),
    actionLabel: presentationLabel(input.actionLabel, code),
    attemptId: opaqueId(input.attemptId, code),
    generation: canonicalGeneration(input.generation, code),
    object: canonicalObject(input.object, code),
    message: presentationMessage(input.message, code),
    changed,
    unchanged,
    dispatchState: canonicalDispatchState(input.dispatchState, code),
    mode: canonicalMode(input.mode, code),
    evidence: phaseFields.evidence,
    cancellation: phaseFields.cancellation,
    nextAction: phaseFields.nextAction,
    startedAtISO: canonicalInstant(input.startedAtISO, code),
    updatedAtISO: canonicalInstant(input.updatedAtISO, code),
    revision: nonnegativeInteger(input.revision, code)
  };
  if (["succeeded", "uncertain"].includes(record.phase) && record.dispatchState !== "dispatched") {
    fail(code);
  }
  if (
    record.phase === "cancelled"
    && (
      (record.cancellation.kind === "pre_dispatch" && record.dispatchState !== "not_dispatched")
      || (
        record.cancellation.kind === "authoritative_cancellation"
        && record.dispatchState !== "dispatched"
      )
    )
  ) {
    fail(code);
  }
  if (Date.parse(record.updatedAtISO) < Date.parse(record.startedAtISO)) fail(code);
  if (JSON.stringify(record).length > MAX_RECORD_SERIALIZED_LENGTH) fail(code);
  if (!sameJson(input, record)) fail(code);
  return record;
}

function canonicalRegistry(value) {
  const input = exactRecord(value, REGISTRY_KEYS, "invalid_registry");
  if (
    input.modelId !== WORKSPACE_ACTION_FEEDBACK_MODEL
    || input.authority !== WORKSPACE_ACTION_FEEDBACK_AUTHORITY
    || input.persistence !== WORKSPACE_ACTION_FEEDBACK_PERSISTENCE
    || !Array.isArray(input.records)
    || input.records.length > WORKSPACE_ACTION_FEEDBACK_MAX_RECORDS
  ) {
    fail("invalid_registry");
  }
  const registry = {
    modelId: WORKSPACE_ACTION_FEEDBACK_MODEL,
    authority: WORKSPACE_ACTION_FEEDBACK_AUTHORITY,
    persistence: WORKSPACE_ACTION_FEEDBACK_PERSISTENCE,
    scope: canonicalScope(input.scope, "invalid_registry"),
    records: input.records.map((record) => canonicalRecord(record)),
    revision: nonnegativeInteger(input.revision, "invalid_registry")
  };
  const identityKeys = registry.records.map((record) => `${record.attemptId}\u0000${record.generation}`);
  if (new Set(identityKeys).size !== identityKeys.length || !sameJson(input, registry)) {
    fail("invalid_registry");
  }
  return isDeepFrozen(input) ? input : deepFreeze(registry);
}

function initialRegistry(scope, revision = 0) {
  return deepFreeze({
    modelId: WORKSPACE_ACTION_FEEDBACK_MODEL,
    authority: WORKSPACE_ACTION_FEEDBACK_AUTHORITY,
    persistence: WORKSPACE_ACTION_FEEDBACK_PERSISTENCE,
    scope: canonicalScope(scope),
    records: [],
    revision: nonnegativeInteger(revision)
  });
}

function resultError(registry, reason) {
  return deepFreeze({
    ok: false,
    status: "rejected",
    reason,
    registry: registry && Object.isFrozen(registry) ? registry : null,
    record: null,
    selector: null,
    announcement: null
  });
}

function resultSuccess(status, registry, record = null, announcement = null) {
  const selector = record ? selectorFor(registry.scope, record) : null;
  return deepFreeze({
    ok: true,
    status,
    reason: null,
    registry,
    record,
    selector,
    announcement
  });
}

function selectorFor(scope, record) {
  return {
    scope: { ...scope },
    attemptId: record.attemptId,
    actionId: record.actionId,
    object: {
      kind: record.object.kind,
      id: record.object.id,
      label: record.object.label
    },
    generation: record.generation,
    recordRevision: record.revision
  };
}

function canonicalSelector(value, { requireRecordRevision = false } = {}) {
  const input = allowedRecord(value, SELECTOR_KEYS, "invalid_selector");
  const recordRevision = input.recordRevision == null
    ? null
    : nonnegativeInteger(input.recordRevision, "invalid_selector");
  if (requireRecordRevision && recordRevision == null) fail("missing_record_revision");
  const selector = {
    scope: canonicalScope(input.scope, "invalid_selector"),
    attemptId: opaqueId(input.attemptId, "invalid_selector"),
    actionId: opaqueId(input.actionId, "invalid_selector"),
    object: canonicalObject(input.object, "invalid_selector"),
    generation: canonicalGeneration(input.generation, "invalid_selector")
  };
  if (recordRevision != null) selector.recordRevision = recordRevision;
  return selector;
}

function announcementFor(record) {
  const phaseText = {
    pending: "started",
    succeeded: "succeeded",
    recovery: "needs attention",
    uncertain: "has an uncertain outcome",
    cancelled: "was cancelled"
  }[record.phase];
  return deepFreeze({
    id: JSON.stringify([
      record.attemptId,
      record.generation,
      record.revision,
      record.phase
    ]),
    attemptId: record.attemptId,
    generation: record.generation,
    recordRevision: record.revision,
    phase: record.phase,
    text: `${record.actionLabel} ${phaseText} for ${record.object.label}. ${record.message}`
  });
}

function registryWithRecords(registry, records) {
  return deepFreeze({
    ...registry,
    records,
    revision: registry.revision + 1
  });
}

function readClock(clock) {
  const value = typeof clock === "function" ? clock() : new Date();
  const instant = value instanceof Date ? value.toISOString() : value;
  return canonicalInstant(instant, "invalid_clock");
}

function safeRegistry(value) {
  try {
    return { ok: true, registry: canonicalRegistry(value) };
  } catch (error) {
    return { ok: false, reason: error?.code || "invalid_registry", registry: null };
  }
}

function findSelectedRecord(registry, selector, { requireRecordRevision = false } = {}) {
  if (!sameJson(registry.scope, selector.scope)) return { ok: false, reason: "scope_mismatch" };
  const attemptMatches = registry.records.filter((record) => record.attemptId === selector.attemptId);
  if (!attemptMatches.length) return { ok: false, reason: "record_not_found" };
  const generationMatch = attemptMatches.find((record) => record.generation === selector.generation);
  if (!generationMatch) return { ok: false, reason: "stale_generation" };
  if (
    generationMatch.actionId !== selector.actionId
    || !sameJson(generationMatch.object, selector.object)
  ) {
    return { ok: false, reason: "identity_mismatch" };
  }
  if (requireRecordRevision && generationMatch.revision !== selector.recordRevision) {
    return { ok: false, reason: "stale_revision" };
  }
  return {
    ok: true,
    record: generationMatch,
    index: registry.records.indexOf(generationMatch)
  };
}

export function createWorkspaceActionFeedbackAttemptId() {
  attemptSequence += 1;
  const time = Date.now().toString(36);
  return `qpa_${time}_${attemptSequence.toString(36)}`;
}

export function createWorkspaceActionFeedbackRegistry(scope) {
  try {
    return resultSuccess("created", initialRegistry(scope));
  } catch (error) {
    return resultError(null, error?.code || "invalid_scope");
  }
}

export function setWorkspaceActionFeedbackScope(registryValue, scope) {
  const current = safeRegistry(registryValue);
  if (!current.ok) return resultError(null, current.reason);
  let nextScope;
  try {
    nextScope = canonicalScope(scope);
  } catch (error) {
    return resultError(current.registry, error?.code || "invalid_scope");
  }
  if (sameJson(current.registry.scope, nextScope)) {
    return resultSuccess("scope_unchanged", current.registry);
  }
  return resultSuccess(
    "scope_reset",
    initialRegistry(nextScope, current.registry.revision + 1)
  );
}

export function beginWorkspaceActionFeedback(registryValue, value, options = {}) {
  const current = safeRegistry(registryValue);
  if (!current.ok) return resultError(null, current.reason);
  try {
    const input = allowedRecord(value, [
      "scope",
      "phase",
      "actionId",
      "actionLabel",
      "attemptId",
      "generation",
      "object",
      "message",
      "changed",
      "unchanged"
    ]);
    const scope = canonicalScope(input.scope);
    if (!sameJson(scope, current.registry.scope)) fail("scope_mismatch");
    if (input.phase != null && input.phase !== "pending") fail("unsupported_phase");
    const nowISO = readClock(options.clock);
    const actionId = opaqueId(input.actionId);
    const object = canonicalObject(input.object);
    const generation = canonicalGeneration(input.generation);
    const generatedAttemptId = input.attemptId || (
      typeof options.idFactory === "function"
        ? options.idFactory({ actionId, object, generation, nowISO })
        : createWorkspaceActionFeedbackAttemptId()
    );
    const attemptId = opaqueId(generatedAttemptId);
    if (current.registry.records.some((record) => record.attemptId === attemptId)) {
      fail("duplicate_attempt");
    }
    if (current.registry.records.some((record) => (
      UNRESOLVED_PHASES.includes(record.phase)
      && record.actionId === actionId
      && record.object.kind === object.kind
      && record.object.id === object.id
    ))) {
      fail("unresolved_feedback_exists");
    }
    let retained = current.registry.records;
    if (retained.length >= WORKSPACE_ACTION_FEEDBACK_MAX_RECORDS) {
      const evictionIndex = retained.findLastIndex((record) => TERMINAL_PHASES.includes(record.phase));
      if (evictionIndex < 0) {
        fail(
          retained.some((record) => record.phase === "uncertain")
            ? "unresolved_feedback_capacity"
            : "pending_feedback_capacity"
        );
      }
      retained = retained.filter((_record, index) => index !== evictionIndex);
    }
    const record = deepFreeze({
      phase: "pending",
      actionId,
      actionLabel: presentationLabel(input.actionLabel),
      attemptId,
      generation,
      object,
      message: presentationMessage(input.message),
      changed: canonicalSummaries(input.changed ?? []),
      unchanged: canonicalSummaries(input.unchanged ?? []),
      dispatchState: "not_dispatched",
      mode: "dispatch",
      evidence: null,
      cancellation: null,
      nextAction: null,
      startedAtISO: nowISO,
      updatedAtISO: nowISO,
      revision: 0
    });
    canonicalRecord(record);
    const registry = registryWithRecords(current.registry, [record, ...retained]);
    return resultSuccess("begun", registry, record, announcementFor(record));
  } catch (error) {
    return resultError(current.registry, error?.code || "invalid_input");
  }
}

export function transitionWorkspaceActionFeedback(registryValue, value, options = {}) {
  const current = safeRegistry(registryValue);
  if (!current.ok) return resultError(null, current.reason);
  try {
    const input = allowedRecord(value, [
      ...SELECTOR_KEYS,
      "phase",
      "message",
      "changed",
      "unchanged",
      "dispatchState",
      "evidence",
      "cancellation",
      "nextAction",
      "mode"
    ]);
    const selector = canonicalSelector({
      scope: input.scope,
      attemptId: input.attemptId,
      actionId: input.actionId,
      object: input.object,
      generation: input.generation,
      recordRevision: input.recordRevision
    });
    const selected = findSelectedRecord(current.registry, selector);
    if (!selected.ok) fail(selected.reason);
    if (!WORKSPACE_ACTION_FEEDBACK_PHASES.includes(input.phase)) fail("unsupported_phase");
    if (!TRANSITIONS[selected.record.phase].includes(input.phase)) fail("invalid_transition");
    if (
      selected.record.phase === "uncertain"
      && input.phase === "pending"
      && input.mode !== "reconcile"
    ) {
      fail("unsafe_retry");
    }
    if (input.mode != null && input.mode !== "reconcile") fail("invalid_input");
    if (input.mode === "reconcile" && !(selected.record.phase === "uncertain" && input.phase === "pending")) {
      fail("invalid_input");
    }
    const phaseFields = canonicalPhaseFields({
      phase: input.phase,
      evidence: input.evidence ?? null,
      cancellation: input.cancellation ?? null,
      nextAction: input.nextAction ?? null
    });
    const nextMessage = presentationMessage(input.message);
    const nextChanged = input.changed == null
      ? [...selected.record.changed]
      : canonicalSummaries(input.changed);
    const nextUnchanged = input.unchanged == null
      ? [...selected.record.unchanged]
      : canonicalSummaries(input.unchanged);
    requireSemanticFacts(input.phase, nextChanged, nextUnchanged);
    let nextDispatchState = input.dispatchState == null
      ? selected.record.dispatchState
      : canonicalDispatchState(input.dispatchState);
    const nextMode = input.mode === "reconcile"
      ? "reconcile"
      : selected.record.mode;
    if (selected.record.dispatchState === "dispatched" && nextDispatchState === "not_dispatched") {
      fail("invalid_dispatch_transition");
    }
    if (input.phase === "succeeded" || input.phase === "uncertain") {
      if (input.dispatchState != null && input.dispatchState !== "dispatched") {
        fail("invalid_dispatch_state");
      }
      nextDispatchState = "dispatched";
    }
    if (input.phase === "cancelled") {
      if (input.dispatchState == null) fail("missing_dispatch_state");
      if (
        phaseFields.cancellation.kind === "pre_dispatch"
        && (
          selected.record.dispatchState !== "not_dispatched"
          || nextDispatchState !== "not_dispatched"
        )
      ) {
        fail("invalid_cancellation_basis");
      }
      if (
        phaseFields.cancellation.kind === "authoritative_cancellation"
        && nextDispatchState !== "dispatched"
      ) {
        fail("invalid_cancellation_basis");
      }
    }
    if (
      input.phase === selected.record.phase
      && nextMessage === selected.record.message
      && sameJson(nextChanged, selected.record.changed)
      && sameJson(nextUnchanged, selected.record.unchanged)
      && nextDispatchState === selected.record.dispatchState
      && nextMode === selected.record.mode
      && sameJson(phaseFields.evidence, selected.record.evidence)
      && sameJson(phaseFields.cancellation, selected.record.cancellation)
      && sameJson(phaseFields.nextAction, selected.record.nextAction)
    ) {
      return resultSuccess("unchanged", current.registry, selected.record);
    }
    const nowISO = readClock(options.clock);
    const record = deepFreeze({
      ...selected.record,
      phase: input.phase,
      message: nextMessage,
      changed: nextChanged,
      unchanged: nextUnchanged,
      dispatchState: nextDispatchState,
      mode: nextMode,
      evidence: phaseFields.evidence,
      cancellation: phaseFields.cancellation,
      nextAction: phaseFields.nextAction,
      updatedAtISO: nowISO,
      revision: selected.record.revision + 1
    });
    canonicalRecord(record);
    const records = [
      record,
      ...current.registry.records.filter((_candidate, index) => index !== selected.index)
    ];
    const registry = registryWithRecords(current.registry, records);
    return resultSuccess("transitioned", registry, record, announcementFor(record));
  } catch (error) {
    return resultError(current.registry, error?.code || "invalid_input");
  }
}

export function acknowledgeWorkspaceActionFeedback(registryValue, selectorValue) {
  const current = safeRegistry(registryValue);
  if (!current.ok) return resultError(null, current.reason);
  try {
    const selector = canonicalSelector(selectorValue, { requireRecordRevision: true });
    const selected = findSelectedRecord(current.registry, selector, { requireRecordRevision: true });
    if (!selected.ok) fail(selected.reason);
    if (!DISMISSIBLE_PHASES.includes(selected.record.phase)) fail("feedback_not_dismissible");
    const records = current.registry.records.filter((_record, index) => index !== selected.index);
    const registry = registryWithRecords(current.registry, records);
    return resultSuccess("acknowledged", registry, selected.record);
  } catch (error) {
    return resultError(current.registry, error?.code || "invalid_selector");
  }
}

export function workspaceActionFeedbackSelector(record, scope) {
  try {
    return deepFreeze(canonicalSelector(selectorFor(canonicalScope(scope), canonicalRecord(record))));
  } catch {
    return null;
  }
}

export function workspaceActionFeedbackIsTerminal(record) {
  return TERMINAL_PHASES.includes(record?.phase);
}
