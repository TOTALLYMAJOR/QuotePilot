import { createWorkspaceArrivalHandoff } from "./workspaceArrivalContract";
import { parseWorkspaceLocation, WORKSPACE_ROUTE_IDS } from "./workspaceRoutes";

/**
 * Session-only presentation state for a task that moves between workspace
 * routes. This module deliberately has no business-data write path. A journey
 * phase can describe what the UI is showing, but it cannot resolve a quote,
 * workflow item, message, approval, payment, or provider operation.
 */

export const WORKSPACE_TASK_JOURNEY_MODEL = "workspace-task-journey-v1";
export const WORKSPACE_TASK_JOURNEY_AUTHORITY = "presentation_only";
export const WORKSPACE_TASK_JOURNEY_PERSISTENCE = "session_only";
export const WORKSPACE_TASK_JOURNEY_MAX_SERIALIZED_LENGTH = 4096;

export const WORKSPACE_TASK_JOURNEY_PHASES = /* @__PURE__ */ Object.freeze([
  "in_progress",
  "resolved",
  "uncertain",
  "cancelled",
  "superseded"
]);

export const WORKSPACE_TASK_CONTEXT_STATES = /* @__PURE__ */ Object.freeze([
  "locating",
  "ready",
  "recovery"
]);

const STORAGE_PREFIX = "quotepilot.workspace-task-journey.v1";
const MAX_ID_LENGTH = 160;
const MAX_PATH_LENGTH = 768;

const JOURNEY_KEYS = /* @__PURE__ */ Object.freeze([
  "modelId",
  "authority",
  "persistence",
  "organizationId",
  "principal",
  "taskId",
  "phase",
  "contextState",
  "origin",
  "destination",
  "object",
  "focus",
  "intentId",
  "proof"
]);

const CREATE_KEYS = /* @__PURE__ */ Object.freeze([
  "organizationId",
  "principal",
  "taskId",
  "origin",
  "destination",
  "object",
  "focus",
  "intentId"
]);

const OUTCOME_TRANSITIONS = /* @__PURE__ */ Object.freeze({
  in_progress: Object.freeze(["resolved", "uncertain", "cancelled", "superseded"]),
  uncertain: Object.freeze(["in_progress", "resolved", "cancelled", "superseded"])
});

const RECOVERY_REASONS = /* @__PURE__ */ Object.freeze({
  invalid_input: "The task journey input is incomplete, malformed, or contains unsupported fields.",
  unsafe_identifier: "The task journey contains an unsafe or potentially sensitive identifier.",
  sensitive_value: "The task journey contains a value that resembles customer prose or a secret.",
  noncanonical_origin: "The task journey origin is not one canonical authenticated workspace route.",
  unsupported_destination: "The task journey destination is not a supported exact workspace arrival.",
  oversized_journey: "The task journey exceeds the bounded session transport size.",
  invalid_journey: "The stored task journey was altered or is not canonical.",
  organization_mismatch: "The task journey does not belong to the active organization.",
  invalid_transition: "The requested task journey transition is not supported.",
  missing_resolution_proof: "A resolved presentation phase requires a bounded verifier proof reference.",
  storage_unavailable: "Session storage is unavailable for this task journey.",
  storage_failure: "The task journey could not be safely read from or written to session storage."
});

class WorkspaceTaskJourneyError extends TypeError {
  constructor(code) {
    super(code);
    this.name = "WorkspaceTaskJourneyError";
    this.code = code;
  }
}

function fail(code) {
  throw new WorkspaceTaskJourneyError(code);
}

function deepFreeze(value, seen = new WeakSet()) {
  if (!value || typeof value !== "object" || seen.has(value)) return value;
  seen.add(value);
  Reflect.ownKeys(value).forEach((key) => deepFreeze(value[key], seen));
  return Object.freeze(value);
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

function requiredString(value, code = "invalid_input") {
  if (typeof value !== "string" || !value || value !== value.trim()) fail(code);
  return value;
}

function looksLikeEmail(value) {
  return /(?:^|[^A-Za-z0-9._%+-])[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Za-z]{2,}(?:$|[^A-Za-z0-9.-])/u
    .test(` ${value} `);
}

function looksLikeSecret(value) {
  return /^(?:(?:sk|rk|pk)[_-](?:live|test)[_-]|ghp_|github_pat_|xox[a-z]?-)[A-Za-z0-9_-]{8,}$/iu.test(value)
    || /^AKIA[A-Z0-9]{16}$/u.test(value)
    || /^eyJ[A-Za-z0-9_-]{12,}\.[A-Za-z0-9_-]{12,}\.[A-Za-z0-9_-]{12,}$/u.test(value);
}

function opaqueId(value) {
  const id = requiredString(value, "unsafe_identifier");
  if (
    id.length > MAX_ID_LENGTH
    || id === "."
    || id === ".."
    || looksLikeEmail(id)
    || looksLikeSecret(id)
    || !/^[A-Za-z0-9][A-Za-z0-9._:()~-]*$/u.test(id)
  ) {
    fail("unsafe_identifier");
  }
  return id;
}

function serialized(value, code = "invalid_journey") {
  let output;
  try {
    output = JSON.stringify(value);
  } catch {
    fail(code);
  }
  if (typeof output !== "string") fail(code);
  if (output.length > WORKSPACE_TASK_JOURNEY_MAX_SERIALIZED_LENGTH) fail("oversized_journey");
  return output;
}

function sameJson(left, right) {
  return JSON.stringify(left) === JSON.stringify(right);
}

function cloneJson(value, code = "invalid_input") {
  try {
    return JSON.parse(JSON.stringify(value));
  } catch {
    fail(code);
  }
}

function normalizedOrigin(value) {
  const input = exactRecord(value, ["routeId", "pathname"]);
  const routeId = opaqueId(input.routeId);
  const pathname = requiredString(input.pathname, "noncanonical_origin");
  if (
    pathname.length > MAX_PATH_LENGTH
    || !pathname.startsWith("/")
    || /[\s?#\\\u0000]/u.test(pathname)
  ) {
    fail("noncanonical_origin");
  }

  let decodedPathname = pathname;
  try {
    decodedPathname = decodeURIComponent(pathname);
  } catch {
    fail("noncanonical_origin");
  }
  if (looksLikeEmail(decodedPathname) || looksLikeSecret(decodedPathname.split("/").pop() || "")) {
    fail("sensitive_value");
  }

  const parsed = parseWorkspaceLocation({ pathname, search: "", hash: "" });
  if (
    parsed.surface !== "workspace"
    || !parsed.isKnown
    || parsed.routeId === WORKSPACE_ROUTE_IDS.PORTAL
    || parsed.routeId !== routeId
    || parsed.pathname !== pathname
    || parsed.canonicalPath !== pathname
    || parsed.redirectTo
  ) {
    fail("noncanonical_origin");
  }
  return { routeId, pathname };
}

function normalizedPrincipal(value, code = "invalid_input") {
  const input = exactRecord(value, ["id", "role"], code);
  const role = opaqueId(input.role);
  if (role !== role.toLowerCase()) fail(code);
  return {
    id: opaqueId(input.id),
    role
  };
}

function normalizedDestination(input) {
  const arrival = createWorkspaceArrivalHandoff({
    destination: input.destination,
    object: input.object,
    focus: input.focus,
    intentId: input.intentId
  });
  if (!arrival.ok) fail("unsupported_destination");

  const focus = arrival.contract.destination === "approval"
    ? {
        quoteId: arrival.contract.focus.quoteId,
        requestId: arrival.contract.focus.requestId
      }
    : cloneJson(arrival.contract.focus);

  return {
    destination: arrival.contract.destination,
    object: {
      id: arrival.contract.object.id,
      type: arrival.contract.object.type
    },
    focus,
    intentId: arrival.contract.intentId
  };
}

function normalizedProof(value, code = "invalid_journey") {
  const proof = exactRecord(value, ["verifierId", "proofId", "proofType"], code);
  return {
    verifierId: opaqueId(proof.verifierId),
    proofId: opaqueId(proof.proofId),
    proofType: opaqueId(proof.proofType)
  };
}

function canonicalJourney(value) {
  const input = exactRecord(value, JOURNEY_KEYS, "invalid_journey");
  if (
    input.modelId !== WORKSPACE_TASK_JOURNEY_MODEL
    || input.authority !== WORKSPACE_TASK_JOURNEY_AUTHORITY
    || input.persistence !== WORKSPACE_TASK_JOURNEY_PERSISTENCE
  ) {
    fail("invalid_journey");
  }

  const organizationId = opaqueId(input.organizationId);
  const principal = normalizedPrincipal(input.principal, "invalid_journey");
  const taskId = opaqueId(input.taskId);
  if (!WORKSPACE_TASK_JOURNEY_PHASES.includes(input.phase)) fail("invalid_journey");
  if (!WORKSPACE_TASK_CONTEXT_STATES.includes(input.contextState)) fail("invalid_journey");
  const origin = normalizedOrigin(input.origin);
  const destination = normalizedDestination(input);

  let proof = null;
  if (input.phase === "resolved") {
    if (input.proof == null) fail("missing_resolution_proof");
    proof = normalizedProof(input.proof);
  } else if (input.proof !== null) {
    fail("invalid_journey");
  }

  const journey = {
    modelId: WORKSPACE_TASK_JOURNEY_MODEL,
    authority: WORKSPACE_TASK_JOURNEY_AUTHORITY,
    persistence: WORKSPACE_TASK_JOURNEY_PERSISTENCE,
    organizationId,
    principal,
    taskId,
    phase: input.phase,
    contextState: input.contextState,
    origin,
    ...destination,
    proof
  };
  serialized(journey);
  if (!sameJson(input, journey)) fail("invalid_journey");
  return deepFreeze(journey);
}

function buildJourney(value) {
  const input = exactRecord(value, CREATE_KEYS);
  const destination = normalizedDestination(input);
  const journey = {
    modelId: WORKSPACE_TASK_JOURNEY_MODEL,
    authority: WORKSPACE_TASK_JOURNEY_AUTHORITY,
    persistence: WORKSPACE_TASK_JOURNEY_PERSISTENCE,
    organizationId: opaqueId(input.organizationId),
    principal: normalizedPrincipal(input.principal),
    taskId: opaqueId(input.taskId),
    phase: "in_progress",
    contextState: "locating",
    origin: normalizedOrigin(input.origin),
    ...destination,
    proof: null
  };
  serialized(journey, "invalid_input");
  return deepFreeze(journey);
}

function success(journey) {
  return deepFreeze({ ok: true, journey });
}

function recovery(error) {
  const code = error instanceof WorkspaceTaskJourneyError && RECOVERY_REASONS[error.code]
    ? error.code
    : "invalid_input";
  return deepFreeze({
    ok: false,
    journey: null,
    recovery: {
      kind: "recovery",
      code,
      reason: RECOVERY_REASONS[code],
      consequence: "No business record or provider state was changed by the task journey.",
      nextResolution: "Keep the authoritative task open and recover from current organization evidence."
    }
  });
}

function expectedOrganization(value) {
  return opaqueId(value);
}

function storageKey(organizationId) {
  return `${STORAGE_PREFIX}:${encodeURIComponent(organizationId)}`;
}

function sessionStorageFor(storage) {
  if (storage !== undefined) return storage;
  try {
    return globalThis.sessionStorage || null;
  } catch {
    return null;
  }
}

function requireStorage(storage) {
  const candidate = sessionStorageFor(storage);
  if (
    !candidate
    || typeof candidate.getItem !== "function"
    || typeof candidate.setItem !== "function"
    || typeof candidate.removeItem !== "function"
  ) {
    fail("storage_unavailable");
  }
  return candidate;
}

/**
 * Starts one bounded presentation journey. The caller cannot provide a phase;
 * every new journey starts in progress while its destination is being located.
 */
export function createWorkspaceTaskJourney(input) {
  try {
    return success(buildJourney(input));
  } catch (error) {
    return recovery(error);
  }
}

/** Rejects same-organization restoration across a different signed-in identity or role. */
export function workspaceTaskJourneyBelongsToPrincipal(journey, principal) {
  try {
    const current = canonicalJourney(journey);
    return sameJson(current.principal, normalizedPrincipal(principal));
  } catch {
    return false;
  }
}

/** Matches the complete canonical destination, object, intent, and focus. */
export function workspaceTaskJourneyMatchesArrival(journey, arrivalContext) {
  try {
    const current = canonicalJourney(journey);
    if (!isPlainRecord(arrivalContext)) return false;
    const focus = arrivalContext.destination === "approval"
      ? {
          quoteId: arrivalContext.focus?.quoteId,
          requestId: arrivalContext.focus?.requestId
        }
      : arrivalContext.focus;
    const candidate = normalizedDestination({
      destination: arrivalContext.destination,
      object: {
        id: arrivalContext.object?.id,
        type: arrivalContext.object?.type
      },
      focus,
      intentId: arrivalContext.intentId
    });
    return current.destination === candidate.destination
      && sameJson(current.object, candidate.object)
      && current.intentId === candidate.intentId
      && sameJson(current.focus, candidate.focus);
  } catch {
    return false;
  }
}

/**
 * Changes destination-location presentation without changing the task phase.
 */
export function transitionWorkspaceTaskContext(journey, contextState) {
  try {
    const current = canonicalJourney(journey);
    if (!WORKSPACE_TASK_CONTEXT_STATES.includes(contextState)) fail("invalid_transition");
    if (current.contextState === contextState) return success(current);
    return success(canonicalJourney({ ...current, contextState }));
  } catch (error) {
    return recovery(error);
  }
}

/**
 * Changes only the presentation outcome. `resolved` is syntactically gated on
 * a verifier/proof reference. The module does not decide whether that proof is
 * authoritative; the existing business authority must do that before calling.
 */
export function transitionWorkspaceTaskOutcome(journey, transition) {
  try {
    const current = canonicalJourney(journey);
    const input = allowedRecord(transition, ["phase", "proof"], "invalid_transition");
    const phase = requiredString(input.phase, "invalid_transition");
    if (!OUTCOME_TRANSITIONS[current.phase]?.includes(phase)) fail("invalid_transition");

    let proof = null;
    if (phase === "resolved") {
      if (!Object.prototype.hasOwnProperty.call(input, "proof")) fail("missing_resolution_proof");
      proof = normalizedProof(input.proof, "missing_resolution_proof");
    } else if (Object.prototype.hasOwnProperty.call(input, "proof")) {
      fail("invalid_transition");
    }

    return success(canonicalJourney({ ...current, phase, proof }));
  } catch (error) {
    return recovery(error);
  }
}

/** Reads only the active organization's bounded session journey. */
export function readWorkspaceTaskJourney(organizationId, storage) {
  try {
    const expected = expectedOrganization(organizationId);
    const target = requireStorage(storage);
    let raw;
    try {
      raw = target.getItem(storageKey(expected));
    } catch {
      fail("storage_failure");
    }
    if (raw === null) return success(null);
    if (typeof raw !== "string") fail("storage_failure");
    if (raw.length > WORKSPACE_TASK_JOURNEY_MAX_SERIALIZED_LENGTH) fail("oversized_journey");

    let parsed;
    try {
      parsed = JSON.parse(raw);
    } catch {
      fail("invalid_journey");
    }
    const journey = canonicalJourney(parsed);
    if (journey.organizationId !== expected) fail("organization_mismatch");
    return success(journey);
  } catch (error) {
    return recovery(error);
  }
}

/** Writes no business data; it stores one journey in organization-scoped session storage. */
export function writeWorkspaceTaskJourney(organizationId, journey, storage) {
  try {
    const expected = expectedOrganization(organizationId);
    const canonical = canonicalJourney(journey);
    if (canonical.organizationId !== expected) fail("organization_mismatch");
    const target = requireStorage(storage);
    const raw = serialized(canonical);
    try {
      target.setItem(storageKey(expected), raw);
    } catch {
      fail("storage_failure");
    }
    return success(canonical);
  } catch (error) {
    return recovery(error);
  }
}

/** Clears only the active organization's presentation journey. */
export function clearWorkspaceTaskJourney(organizationId, storage) {
  try {
    const expected = expectedOrganization(organizationId);
    const target = requireStorage(storage);
    try {
      target.removeItem(storageKey(expected));
    } catch {
      fail("storage_failure");
    }
    return success(null);
  } catch (error) {
    return recovery(error);
  }
}
