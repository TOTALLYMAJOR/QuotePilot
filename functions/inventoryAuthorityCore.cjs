"use strict";

const { createHash } = require("node:crypto");

const INVENTORY_SCHEMA_VERSION = 1;
const INVENTORY_AUTHORITY_VERSION = "inventory-authority-v1";
const INVENTORY_MOVEMENT_VERSION = "inventory-movement-v1";
const INVENTORY_BUCKETS = Object.freeze(["usable", "checked_out", "damaged"]);
const INVENTORY_MOVEMENT_KINDS = Object.freeze([
  "opening_balance",
  "adjustment",
  "transfer",
  "checkout",
  "return",
  "damage",
  "repair",
  "loss",
  "retire"
]);
const INVENTORY_ADJUSTMENT_REASONS = Object.freeze([
  "acquisition",
  "count_correction",
  "donation",
  "other"
]);
const INVENTORY_EVIDENCE_BOUNDARY =
  "Inventory movements record operator-authorized physical state transitions. They do not establish commercial scope, customer acceptance, event readiness, or provider evidence.";

const BUCKET_SET = new Set(INVENTORY_BUCKETS);
const KIND_SET = new Set(INVENTORY_MOVEMENT_KINDS);
const ADJUSTMENT_REASON_SET = new Set(INVENTORY_ADJUSTMENT_REASONS);
const OPAQUE_ID_PATTERN = /^[^\s/?#\\\u0000]{1,180}$/u;
const REQUEST_ID_PATTERN = /^[A-Za-z0-9][A-Za-z0-9._:@-]{15,159}$/u;
const UNIT_PATTERN = /^[A-Za-z][A-Za-z0-9 _-]{0,39}$/u;
const MAX_QUANTITY = 1_000_000;
const MAX_REVISION = 1_000_000_000;
const MAX_CANONICAL_BYTES = 262_144;

class InventoryAuthorityError extends Error {
  constructor(code, message, details = {}) {
    super(message);
    this.name = "InventoryAuthorityError";
    this.code = code;
    this.details = details;
  }
}

function fail(code, message, details = {}) {
  throw new InventoryAuthorityError(code, message, details);
}

function isRecord(value) {
  if (!value || typeof value !== "object" || Array.isArray(value)) return false;
  const prototype = Object.getPrototypeOf(value);
  return prototype === Object.prototype || prototype === null;
}

function text(value) {
  return String(value ?? "").trim();
}

function compareText(left, right) {
  return left < right ? -1 : left > right ? 1 : 0;
}

function deepFreeze(value, seen = new WeakSet()) {
  if (!value || typeof value !== "object" || seen.has(value)) return value;
  seen.add(value);
  Reflect.ownKeys(value).forEach((key) => deepFreeze(value[key], seen));
  return Object.freeze(value);
}

function assertAllowedKeys(value, allowed, label) {
  if (!isRecord(value)) fail("invalid-argument", `${label} must be an object.`);
  const unknown = Object.keys(value).filter((key) => !allowed.has(key));
  if (unknown.length) fail("invalid-argument", `${label} contains unsupported fields.`, { fields: unknown.sort(compareText) });
}

function canonicalize(value, seen = new WeakSet()) {
  if (value === null || typeof value === "string" || typeof value === "boolean") return value;
  if (typeof value === "number") {
    if (!Number.isFinite(value)) fail("failed-precondition", "Inventory evidence contains a non-finite number.");
    return Object.is(value, -0) ? 0 : value;
  }
  if (!value || typeof value !== "object" || seen.has(value)) {
    fail("failed-precondition", "Inventory evidence must be an acyclic JSON value.");
  }
  seen.add(value);
  if (Array.isArray(value)) {
    const normalized = value.map((entry) => canonicalize(entry, seen));
    seen.delete(value);
    return normalized;
  }
  if (!isRecord(value)) fail("failed-precondition", "Inventory evidence must use plain JSON records.");
  const normalized = Object.create(null);
  Object.keys(value).sort(compareText).forEach((key) => {
    if (typeof value[key] === "undefined") fail("failed-precondition", "Inventory evidence cannot contain undefined values.");
    normalized[key] = canonicalize(value[key], seen);
  });
  seen.delete(value);
  return normalized;
}

function canonicalSerialize(value, label = "Inventory evidence") {
  const serialized = JSON.stringify(canonicalize(value));
  const bytes = Buffer.byteLength(serialized, "utf8");
  if (bytes > MAX_CANONICAL_BYTES) {
    fail("resource-exhausted", `${label} exceeds the bounded authority size.`, { bytes, maximum: MAX_CANONICAL_BYTES });
  }
  return serialized;
}

function canonicalClone(value, label) {
  return JSON.parse(canonicalSerialize(value, label));
}

function digest(value, label) {
  return createHash("sha256").update(canonicalSerialize(value, label)).digest("hex");
}

function opaqueId(value, label) {
  const normalized = text(value);
  if (!OPAQUE_ID_PATTERN.test(normalized)
    || [".", "..", "__proto__", "prototype", "constructor"].includes(normalized.toLowerCase())
    || /^[^@\s]+@[^@\s]+$/u.test(normalized)) {
    fail("invalid-argument", `${label} must be a stable opaque identifier.`);
  }
  return normalized;
}

function requestId(value) {
  const normalized = text(value);
  if (!REQUEST_ID_PATTERN.test(normalized)) fail("invalid-argument", "requestId must be a stable bounded retry identifier.");
  return normalized;
}

function displayText(value, label, maximum = 100) {
  const normalized = text(value).replace(/\s+/gu, " ");
  if (!normalized || normalized.length > maximum || /[\u0000-\u001f\u007f<>]/u.test(normalized)) {
    fail("invalid-argument", `${label} must be safe bounded display text.`);
  }
  return normalized;
}

function optionalNote(value, label = "note", maximum = 500) {
  const normalized = text(value).replace(/\s+/gu, " ");
  if (normalized.length > maximum || /[\u0000-\u0008\u000b\u000c\u000e-\u001f\u007f<>]/u.test(normalized)) {
    fail("invalid-argument", `${label} must be safe bounded text.`);
  }
  return normalized;
}

function exactISO(value, label, code = "invalid-argument") {
  const normalized = text(value);
  const parsed = new Date(normalized);
  if (!normalized || Number.isNaN(parsed.getTime()) || parsed.toISOString() !== normalized) fail(code, `${label} must be an exact ISO timestamp.`);
  return normalized;
}

function wholeQuantity(value, label = "quantity") {
  const quantity = value;
  if (!Number.isSafeInteger(quantity) || quantity < 1 || quantity > MAX_QUANTITY) {
    fail("invalid-argument", `${label} must be a positive bounded whole number.`);
  }
  return quantity;
}

function revision(value, label, { allowZero = true } = {}) {
  const normalized = value;
  const minimum = allowZero ? 0 : 1;
  if (!Number.isSafeInteger(normalized) || normalized < minimum || normalized > MAX_REVISION) {
    fail("invalid-argument", `${label} must be a bounded integer revision.`);
  }
  return normalized;
}

function normalizeActor(value, organizationId, { mutation = false } = {}) {
  if (!isRecord(value) || value.organizationId !== organizationId || (value.principalOrganizationId && value.principalOrganizationId !== organizationId)) {
    fail("permission-denied", "Inventory authority requires the same organization.");
  }
  const allowed = mutation ? ["admin"] : ["admin", "sales"];
  if (!allowed.includes(value.role)) fail("permission-denied", mutation ? "Inventory changes require administrator authority." : "Inventory reads require staff authority.");
  return Object.freeze({ organizationId, uid: opaqueId(value.uid, "actor uid"), role: value.role });
}

function assertEnabled(globalEnabled, settings) {
  if (globalEnabled !== true || settings?.inventoryAuthorityEnabled !== true) {
    fail("failed-precondition", "Inventory authority is not enabled for this environment and organization.");
  }
}

function emptyBuckets() {
  return { usable: 0, checked_out: 0, damaged: 0 };
}

function normalizeBuckets(value, label = "stock buckets") {
  const input = value ?? emptyBuckets();
  if (!isRecord(input)
    || Object.keys(input).length !== INVENTORY_BUCKETS.length
    || Object.keys(input).some((key) => !BUCKET_SET.has(key))
    || INVENTORY_BUCKETS.some((key) => !Object.hasOwn(input, key))) {
    fail("data-loss", `${label} must contain the exact supported state buckets.`);
  }
  const buckets = {};
  INVENTORY_BUCKETS.forEach((bucket) => {
    const quantity = input[bucket];
    if (!Number.isSafeInteger(quantity) || quantity < 0 || quantity > MAX_QUANTITY) fail("data-loss", `${label} contain an invalid quantity.`);
    buckets[bucket] = quantity;
  });
  return buckets;
}

function stockStateId(itemId, locationId) {
  return `iss_${digest({ itemId: opaqueId(itemId, "itemId"), locationId: opaqueId(locationId, "locationId") }).slice(0, 48)}`;
}

function movementIdFor(organizationId, retryId) {
  return `imv_${digest({ organizationId: opaqueId(organizationId, "organizationId"), requestId: requestId(retryId) }).slice(0, 48)}`;
}

function createEmptyStockState({ organizationId, itemId, locationId }) {
  const normalized = {
    authorityVersion: INVENTORY_AUTHORITY_VERSION,
    schemaVersion: INVENTORY_SCHEMA_VERSION,
    organizationId: opaqueId(organizationId, "organizationId"),
    itemId: opaqueId(itemId, "itemId"),
    locationId: opaqueId(locationId, "locationId"),
    stockStateId: stockStateId(itemId, locationId),
    revision: 0,
    buckets: emptyBuckets(),
    lastMovementId: "",
    updatedAtISO: ""
  };
  return normalized;
}

function normalizeStockState(value, identity) {
  const empty = createEmptyStockState(identity);
  if (value == null) return empty;
  try {
    assertAllowedKeys(value, new Set([
      "authorityVersion", "schemaVersion", "organizationId", "itemId", "locationId",
      "stockStateId", "revision", "buckets", "lastMovementId", "updatedAtISO",
      "createdAt", "updatedAt"
    ]), "Inventory stock state");
  } catch {
    fail("data-loss", "Inventory stock state contains unsupported evidence.");
  }
  if (!isRecord(value)
    || value.authorityVersion !== INVENTORY_AUTHORITY_VERSION
    || value.schemaVersion !== INVENTORY_SCHEMA_VERSION
    || value.organizationId !== empty.organizationId
    || value.itemId !== empty.itemId
    || value.locationId !== empty.locationId
    || value.stockStateId !== empty.stockStateId) {
    fail("data-loss", "Inventory stock state identity or schema is invalid.");
  }
  const normalizedRevision = revision(value.revision, "stock revision");
  const buckets = normalizeBuckets(value.buckets);
  const lastMovementId = text(value.lastMovementId);
  const updatedAtISO = text(value.updatedAtISO);
  if (normalizedRevision === 0) {
    if (lastMovementId || updatedAtISO || Object.values(buckets).some((quantity) => quantity !== 0)) {
      fail("data-loss", "Revision-zero inventory stock must be an empty ledger genesis.");
    }
  } else if (!/^imv_[a-f0-9]{48}$/u.test(lastMovementId)) {
    fail("data-loss", "Inventory stock revision lacks canonical movement evidence.");
  }
  return {
    ...empty,
    revision: normalizedRevision,
    buckets,
    lastMovementId,
    updatedAtISO: normalizedRevision ? exactISO(updatedAtISO, "stock update time", "data-loss") : ""
  };
}

function publicStockState(value) {
  const normalized = normalizeStockState(value, {
    organizationId: value?.organizationId,
    itemId: value?.itemId,
    locationId: value?.locationId
  });
  const buckets = normalized.buckets;
  return Object.freeze({
    stockStateId: normalized.stockStateId,
    itemId: normalized.itemId,
    locationId: normalized.locationId,
    revision: normalized.revision,
    owned: buckets.usable + buckets.checked_out + buckets.damaged,
    usable: buckets.usable,
    out: buckets.checked_out,
    unavailable: buckets.damaged,
    lastMovementId: normalized.lastMovementId,
    updatedAtISO: normalized.updatedAtISO
  });
}

function normalizeEndpoint(value, label, organizationId, itemId, { terminalAllowed = false } = {}) {
  if (value == null) return null;
  if (!isRecord(value)) fail("invalid-argument", `${label} must be a physical stock endpoint.`);
  assertAllowedKeys(value, new Set(["locationId", "bucket"]), label);
  const bucket = text(value.bucket).toLowerCase();
  if (!BUCKET_SET.has(bucket) && !(terminalAllowed && ["lost", "retired"].includes(bucket))) {
    fail("invalid-argument", `${label} uses an unsupported inventory bucket.`);
  }
  const endpoint = { locationId: opaqueId(value.locationId, `${label} locationId`), bucket };
  return endpoint;
}

function normalizeMovementRequest(value = {}) {
  if (!isRecord(value)) fail("invalid-argument", "Inventory command must be an object.");
  assertAllowedKeys(value, new Set([
    "organizationId", "itemId", "requestId", "kind", "quantity", "from", "to",
    "eventPlanId", "sourceMovementId", "adjustmentReason", "note", "occurredAtISO",
    "expectedStockRevisions"
  ]), "Inventory movement request");
  const organizationId = opaqueId(value.organizationId, "organizationId");
  const itemId = opaqueId(value.itemId, "itemId");
  const kind = text(value.kind).toLowerCase();
  if (!KIND_SET.has(kind)) fail("invalid-argument", "Inventory movement kind is unsupported.");
  const normalized = {
    organizationId,
    itemId,
    requestId: requestId(value.requestId),
    kind,
    quantity: wholeQuantity(value.quantity),
    from: normalizeEndpoint(value.from, "from", organizationId, itemId),
    to: normalizeEndpoint(value.to, "to", organizationId, itemId, { terminalAllowed: true }),
    eventPlanId: value.eventPlanId ? opaqueId(value.eventPlanId, "eventPlanId") : "",
    sourceMovementId: value.sourceMovementId ? opaqueId(value.sourceMovementId, "sourceMovementId") : "",
    adjustmentReason: text(value.adjustmentReason).toLowerCase(),
    note: optionalNote(value.note),
    occurredAtISO: exactISO(value.occurredAtISO, "occurredAtISO"),
    expectedStockRevisions: {}
  };
  const locations = new Set([normalized.from?.locationId, normalized.to?.locationId].filter(Boolean));
  if (!isRecord(value.expectedStockRevisions) || Object.keys(value.expectedStockRevisions).some((key) => !locations.has(key))) {
    fail("invalid-argument", "Expected stock revisions must exactly address the movement locations.");
  }
  for (const locationId of locations) {
    if (!Object.hasOwn(value.expectedStockRevisions, locationId)) fail("invalid-argument", "Every movement location requires an expected stock revision.");
    normalized.expectedStockRevisions[locationId] = revision(value.expectedStockRevisions[locationId], `Expected revision for ${locationId}`);
  }
  if (Object.keys(normalized.expectedStockRevisions).length !== locations.size) fail("invalid-argument", "Expected stock revisions must be unique by location.");
  assertMovementShape(normalized);
  return normalized;
}

function assertSameLocation(request) {
  if (!request.from || !request.to || request.from.locationId !== request.to.locationId) fail("invalid-argument", `${request.kind} must remain within one inventory location.`);
}

function assertMovementShape(request) {
  const { kind, from, to } = request;
  if (kind === "opening_balance") {
    if (from || !to || to.bucket !== "usable") fail("invalid-argument", "Opening balance must introduce usable stock at one location.");
  } else if (kind === "adjustment") {
    if ((from == null) === (to == null)) fail("invalid-argument", "Adjustment must add to or remove from one stock bucket.");
    const endpoint = from || to;
    if (!BUCKET_SET.has(endpoint.bucket)) fail("invalid-argument", "Adjustment must address a current stock bucket.");
    if (!ADJUSTMENT_REASON_SET.has(request.adjustmentReason)) fail("invalid-argument", "Adjustment requires a supported reason.");
    if (request.adjustmentReason === "other" && !request.note) fail("invalid-argument", "Other adjustments require an explanatory note.");
  } else if (kind === "transfer") {
    if (!from || !to || from.locationId === to.locationId || from.bucket !== to.bucket || !BUCKET_SET.has(from.bucket)) {
      fail("invalid-argument", "Transfer must move the same stock bucket between two different locations.");
    }
  } else if (kind === "checkout") {
    assertSameLocation(request);
    if (from.bucket !== "usable" || to.bucket !== "checked_out" || !request.eventPlanId) fail("invalid-argument", "Checkout moves allocated usable stock to checked out.");
  } else if (kind === "return") {
    assertSameLocation(request);
    if (from.bucket !== "checked_out" || to.bucket !== "usable" || !request.eventPlanId || !request.sourceMovementId) fail("invalid-argument", "Return must reference an event checkout.");
  } else if (kind === "damage") {
    assertSameLocation(request);
    if (!["usable", "checked_out"].includes(from.bucket) || to.bucket !== "damaged") fail("invalid-argument", "Damage moves usable or checked-out stock to damaged.");
  } else if (kind === "repair") {
    assertSameLocation(request);
    if (from.bucket !== "damaged" || to.bucket !== "usable") fail("invalid-argument", "Repair restores damaged stock to usable.");
  } else if (kind === "loss") {
    if (!from || !to || from.locationId !== to.locationId || !BUCKET_SET.has(from.bucket) || to.bucket !== "lost") fail("invalid-argument", "Loss removes stock from a known current bucket.");
  } else if (kind === "retire") {
    if (!from || !to || from.locationId !== to.locationId || !["usable", "damaged"].includes(from.bucket) || to.bucket !== "retired") fail("invalid-argument", "Retirement removes usable or damaged stock.");
  }
  if (kind !== "adjustment" && request.adjustmentReason) fail("invalid-argument", "Only adjustments may declare an adjustment reason.");
}

function movementLocations(request) {
  return [...new Set([request.from?.locationId, request.to?.locationId].filter(Boolean))].sort(compareText);
}

function applyEndpointDelta(states, endpoint, delta, movementId, recordedAtISO) {
  if (!endpoint || !BUCKET_SET.has(endpoint.bucket)) return;
  const current = states.get(endpoint.locationId);
  const nextQuantity = current.buckets[endpoint.bucket] + delta;
  if (!Number.isSafeInteger(nextQuantity) || nextQuantity < 0 || nextQuantity > MAX_QUANTITY) {
    fail("failed-precondition", `Movement would make ${endpoint.bucket} stock invalid at ${endpoint.locationId}.`);
  }
  current.buckets[endpoint.bucket] = nextQuantity;
}

function movementStockOutcomes({ request, statesBefore, statesAfter }) {
  return movementLocations(request).map((locationId) => ({
    locationId,
    stockStateId: stockStateId(request.itemId, locationId),
    priorRevision: statesBefore[locationId].revision,
    resultRevision: statesAfter[locationId].revision,
    beforeBuckets: normalizeBuckets(statesBefore[locationId].buckets, "Movement prior stock buckets"),
    afterBuckets: normalizeBuckets(statesAfter[locationId].buckets, "Movement resulting stock buckets"),
    resultStockState: canonicalClone(statesAfter[locationId], "Movement result stock state")
  }));
}

function assertMovementOutcomes(value, request, movementId, recordedAtISO) {
  if (!Array.isArray(value) || value.length !== movementLocations(request).length) {
    fail("data-loss", "Inventory movement stock outcome coverage is incomplete.");
  }
  const byLocation = new Map();
  value.forEach((outcome) => {
    if (!isRecord(outcome)) fail("data-loss", "Inventory movement stock outcome is invalid.");
    try {
      assertAllowedKeys(outcome, new Set([
        "locationId", "stockStateId", "priorRevision", "resultRevision",
        "beforeBuckets", "afterBuckets", "resultStockState"
      ]), "Inventory movement stock outcome");
    } catch {
      fail("data-loss", "Inventory movement stock outcome contains unsupported evidence.");
    }
    const locationId = opaqueId(outcome.locationId, "outcome locationId");
    if (byLocation.has(locationId)) fail("data-loss", "Inventory movement stock outcome locations must be unique.");
    const expectedRevision = request.expectedStockRevisions[locationId];
    if (typeof expectedRevision === "undefined"
      || outcome.stockStateId !== stockStateId(request.itemId, locationId)
      || outcome.priorRevision !== expectedRevision
      || outcome.resultRevision !== expectedRevision + 1
      || outcome.resultRevision > MAX_REVISION) {
      fail("data-loss", "Inventory movement stock outcome revisions are inconsistent.");
    }
    const beforeBuckets = normalizeBuckets(outcome.beforeBuckets, "Movement prior stock buckets");
    const afterBuckets = normalizeBuckets(outcome.afterBuckets, "Movement resulting stock buckets");
    const expectedAfter = { ...beforeBuckets };
    if (request.from?.locationId === locationId && BUCKET_SET.has(request.from.bucket)) expectedAfter[request.from.bucket] -= request.quantity;
    if (request.to?.locationId === locationId && BUCKET_SET.has(request.to.bucket)) expectedAfter[request.to.bucket] += request.quantity;
    if (Object.values(expectedAfter).some((quantity) => !Number.isSafeInteger(quantity) || quantity < 0 || quantity > MAX_QUANTITY)
      || INVENTORY_BUCKETS.some((bucket) => expectedAfter[bucket] !== afterBuckets[bucket])) {
      fail("data-loss", "Inventory movement stock outcome does not match its transition.");
    }
    const result = normalizeStockState(outcome.resultStockState, {
      organizationId: request.organizationId,
      itemId: request.itemId,
      locationId
    });
    if (result.revision !== outcome.resultRevision
      || result.lastMovementId !== movementId
      || result.updatedAtISO !== recordedAtISO
      || INVENTORY_BUCKETS.some((bucket) => result.buckets[bucket] !== afterBuckets[bucket])) {
      fail("data-loss", "Inventory movement retained result state is inconsistent.");
    }
    byLocation.set(locationId, outcome);
  });
  if (movementLocations(request).some((locationId) => !byLocation.has(locationId))) fail("data-loss", "Inventory movement stock outcome identity is incomplete.");
  return byLocation;
}

function verifyMovement(value) {
  if (!isRecord(value)) fail("data-loss", "Inventory movement evidence is unavailable.");
  const { movementDigest, createdAt: _createdAt, updatedAt: _updatedAt, ...body } = value;
  try {
    assertAllowedKeys(value, new Set([
      "authorityVersion", "schemaVersion", "movementVersion", "evidenceBoundary",
      "organizationId", "itemId", "movementId", "requestId", "requestDigest",
      "kind", "quantity", "from", "to", "eventPlanId", "sourceMovementId",
      "adjustmentReason", "note", "occurredAtISO", "recordedAtISO", "recordedBy",
      "sequence", "stockOutcomes", "request", "movementDigest", "createdAt", "updatedAt"
    ]), "Inventory movement");
  } catch {
    fail("data-loss", "Inventory movement contains unsupported evidence.");
  }
  if (body.authorityVersion !== INVENTORY_AUTHORITY_VERSION
    || body.schemaVersion !== INVENTORY_SCHEMA_VERSION
    || body.movementVersion !== INVENTORY_MOVEMENT_VERSION
    || body.evidenceBoundary !== INVENTORY_EVIDENCE_BOUNDARY
    || movementDigest !== digest(body, "Inventory movement")) fail("data-loss", "Inventory movement failed integrity validation.");
  let request;
  let recordedBy;
  try {
    request = normalizeMovementRequest(body.request);
    recordedBy = normalizeActor(body.recordedBy, request.organizationId, { mutation: true });
  } catch {
    fail("data-loss", "Inventory movement retained request or actor evidence is invalid.");
  }
  if (body.movementId !== movementIdFor(request.organizationId, request.requestId)
    || body.requestDigest !== digest(request, "Inventory movement request")
    || body.organizationId !== request.organizationId
    || body.itemId !== request.itemId
    || body.requestId !== request.requestId
    || body.kind !== request.kind
    || body.quantity !== request.quantity
    || digest(body.from) !== digest(request.from)
    || digest(body.to) !== digest(request.to)
    || body.eventPlanId !== request.eventPlanId
    || body.sourceMovementId !== request.sourceMovementId
    || body.adjustmentReason !== request.adjustmentReason
    || body.note !== request.note
    || body.occurredAtISO !== request.occurredAtISO
    || !Number.isSafeInteger(body.sequence) || body.sequence < 1
    || exactISO(body.recordedAtISO, "movement recorded time", "data-loss") !== body.recordedAtISO) {
    fail("data-loss", "Inventory movement evidence is inconsistent.");
  }
  if (digest(recordedBy) !== digest(body.recordedBy)) fail("data-loss", "Inventory movement actor evidence is inconsistent.");
  const outcomes = assertMovementOutcomes(body.stockOutcomes, request, body.movementId, body.recordedAtISO);
  const locations = movementLocations(request);
  const retainedOrder = body.stockOutcomes.map((outcome) => outcome.locationId);
  const maximumResultRevision = Math.max(...body.stockOutcomes.map((outcome) => outcome.resultRevision));
  if (retainedOrder.some((locationId, index) => locationId !== locations[index])
    || body.sequence !== maximumResultRevision
    || body.sequence > MAX_REVISION
    || Date.parse(body.occurredAtISO) > Date.parse(body.recordedAtISO)) {
    fail("data-loss", "Inventory movement derived evidence is inconsistent.");
  }
  for (const locationId of locations) {
    const outcome = outcomes.get(locationId);
    if (outcome.priorRevision === 0 && INVENTORY_BUCKETS.some((bucket) => outcome.beforeBuckets[bucket] !== 0)) {
      fail("data-loss", "Inventory movement begins from impossible genesis stock.");
    }
  }
  return deepFreeze(canonicalClone({ ...body, movementDigest }, "Verified inventory movement"));
}

function planMovement({ request: input, actor, currentStockStates = {}, existingMovement = null, nowISO }) {
  const request = normalizeMovementRequest(input);
  const trustedActor = normalizeActor(actor, request.organizationId, { mutation: true });
  if (!isRecord(currentStockStates)) fail("invalid-argument", "Current inventory stock states must be an identity-keyed object.");
  const movementId = movementIdFor(request.organizationId, request.requestId);
  const requestDigest = digest(request, "Inventory movement request");
  if (existingMovement) {
    const verified = verifyMovement(existingMovement);
    if (verified.movementId !== movementId || verified.requestDigest !== requestDigest || digest(verified.recordedBy) !== digest(trustedActor)) {
      fail("already-exists", "This request identity belongs to a different immutable inventory movement.");
    }
    return {
      idempotent: true,
      movement: verified,
      nextStockStates: Object.fromEntries(verified.stockOutcomes.map((outcome) => [outcome.locationId, canonicalClone(outcome.resultStockState)]))
    };
  }
  const recordedAtISO = exactISO(nowISO, "Trusted server time", "failed-precondition");
  if (Date.parse(request.occurredAtISO) > Date.parse(recordedAtISO)) fail("failed-precondition", "Movement occurrence time cannot be in the future.");
  const states = new Map();
  const statesBefore = {};
  for (const locationId of movementLocations(request)) {
    const current = normalizeStockState(
      Object.hasOwn(currentStockStates, locationId) ? currentStockStates[locationId] : null,
      { organizationId: request.organizationId, itemId: request.itemId, locationId }
    );
    if (current.revision !== request.expectedStockRevisions[locationId]) fail("aborted", `Inventory changed at ${locationId}. Refresh before trying again.`);
    states.set(locationId, canonicalClone(current, "Inventory stock state"));
    statesBefore[locationId] = canonicalClone(current, "Inventory prior stock state");
  }
  if (request.kind === "opening_balance") {
    const state = states.get(request.to.locationId);
    if (state.revision !== 0 || Object.values(state.buckets).some(Boolean)) fail("failed-precondition", "Opening balance is allowed only before location stock history begins.");
  }
  applyEndpointDelta(states, request.from, -request.quantity, movementId, recordedAtISO);
  applyEndpointDelta(states, request.to, request.quantity, movementId, recordedAtISO);
  for (const state of states.values()) {
    if (state.revision >= MAX_REVISION) fail("resource-exhausted", "Inventory stock revision limit was reached.");
    state.revision += 1;
    state.lastMovementId = movementId;
    state.updatedAtISO = recordedAtISO;
  }
  const sequence = Math.max(...[...states.values()].map((state) => state.revision));
  const nextStockStates = Object.fromEntries([...states.entries()].map(([locationId, state]) => [locationId, state]));
  const stockOutcomes = movementStockOutcomes({ request, statesBefore, statesAfter: nextStockStates });
  const body = {
    authorityVersion: INVENTORY_AUTHORITY_VERSION,
    schemaVersion: INVENTORY_SCHEMA_VERSION,
    movementVersion: INVENTORY_MOVEMENT_VERSION,
    evidenceBoundary: INVENTORY_EVIDENCE_BOUNDARY,
    organizationId: request.organizationId,
    itemId: request.itemId,
    movementId,
    requestId: request.requestId,
    requestDigest,
    kind: request.kind,
    quantity: request.quantity,
    from: request.from,
    to: request.to,
    eventPlanId: request.eventPlanId,
    sourceMovementId: request.sourceMovementId,
    adjustmentReason: request.adjustmentReason,
    note: request.note,
    occurredAtISO: request.occurredAtISO,
    recordedAtISO,
    recordedBy: trustedActor,
    sequence,
    stockOutcomes,
    request
  };
  const movement = deepFreeze({ ...body, movementDigest: digest(body, "Inventory movement") });
  return deepFreeze({
    idempotent: false,
    movement,
    nextStockStates
  });
}

function replayMovements({ organizationId, itemId, movements }) {
  if (!Array.isArray(movements) || movements.length > 10_000) fail("resource-exhausted", "Movement replay must be a bounded list.");
  organizationId = opaqueId(organizationId, "organizationId");
  itemId = opaqueId(itemId, "itemId");
  const pending = movements.map(verifyMovement);
  if (new Set(pending.map((movement) => movement.movementId)).size !== pending.length) fail("data-loss", "Movement replay contains duplicate immutable identities.");
  pending.forEach((movement) => {
    if (movement.organizationId !== organizationId || movement.itemId !== itemId) fail("data-loss", "Movement replay crossed inventory identity.");
  });
  const states = Object.create(null);
  while (pending.length) {
    pending.sort((left, right) => compareText(left.movementId, right.movementId));
    const readyIndex = pending.findIndex((movement) => movementLocations(movement.request).every((locationId) => (
      (states[locationId]?.revision || 0) === movement.request.expectedStockRevisions[locationId]
    )));
    if (readyIndex < 0) fail("data-loss", "Movement replay contains a revision gap, conflicting branch, or cycle.");
    const [movement] = pending.splice(readyIndex, 1);
    const request = canonicalClone(movement.request, "Retained inventory movement request");
    const current = {};
    for (const locationId of movementLocations(request)) {
      current[locationId] = states[locationId] || createEmptyStockState({ organizationId, itemId, locationId });
    }
    const result = planMovement({ request, actor: movement.recordedBy, currentStockStates: current, nowISO: movement.recordedAtISO });
    if (result.movement.movementDigest !== movement.movementDigest) fail("data-loss", "Movement replay does not reproduce retained evidence.");
    Object.assign(states, result.nextStockStates);
  }
  return states;
}

function normalizeLocation(value = {}, current = null) {
  assertAllowedKeys(value, new Set(["organizationId", "locationId", "expectedRevision", "name", "active"]), "Inventory location input");
  const organizationId = opaqueId(value.organizationId, "organizationId");
  const locationId = opaqueId(value.locationId, "locationId");
  const expectedRevision = revision(value.expectedRevision, "location expectedRevision");
  if (current && (!isRecord(current)
    || current.authorityVersion !== INVENTORY_AUTHORITY_VERSION
    || current.schemaVersion !== INVENTORY_SCHEMA_VERSION
    || current.organizationId !== organizationId
    || current.locationId !== locationId)) fail("data-loss", "Inventory location identity or schema changed.");
  const priorRevision = current ? revision(current.revision, "current location revision", { allowZero: false }) : 0;
  if (priorRevision !== expectedRevision) fail("aborted", "Inventory location changed. Refresh before trying again.");
  if (priorRevision >= MAX_REVISION) fail("resource-exhausted", "Inventory location revision limit was reached.");
  if (typeof value.active !== "boolean") fail("invalid-argument", "Inventory location active state must be boolean.");
  return {
    authorityVersion: INVENTORY_AUTHORITY_VERSION,
    schemaVersion: INVENTORY_SCHEMA_VERSION,
    organizationId,
    locationId,
    name: displayText(value.name, "Location name", 80),
    active: value.active,
    revision: priorRevision + 1
  };
}

function normalizeItem(value = {}, current = null, { hasMovements = false } = {}) {
  assertAllowedKeys(value, new Set(["organizationId", "itemId", "expectedRevision", "name", "category", "unit", "active", "turnaroundMinutes"]), "Inventory item input");
  const organizationId = opaqueId(value.organizationId, "organizationId");
  const itemId = opaqueId(value.itemId, "itemId");
  const expectedRevision = revision(value.expectedRevision, "item expectedRevision");
  if (current && (!isRecord(current)
    || current.authorityVersion !== INVENTORY_AUTHORITY_VERSION
    || current.schemaVersion !== INVENTORY_SCHEMA_VERSION
    || current.organizationId !== organizationId
    || current.itemId !== itemId)) fail("data-loss", "Inventory item identity or schema changed.");
  const priorRevision = current ? revision(current.revision, "current item revision", { allowZero: false }) : 0;
  if (priorRevision !== expectedRevision) fail("aborted", "Inventory item changed. Refresh before trying again.");
  if (priorRevision >= MAX_REVISION) fail("resource-exhausted", "Inventory item revision limit was reached.");
  const unit = text(value.unit).replace(/\s+/gu, " ");
  if (!UNIT_PATTERN.test(unit)) fail("invalid-argument", "Inventory unit must be safe bounded text.");
  if (hasMovements && current?.unit !== unit) fail("failed-precondition", "Inventory unit cannot change after physical movement history exists.");
  const turnaroundMinutes = value.turnaroundMinutes;
  if (!Number.isSafeInteger(turnaroundMinutes) || turnaroundMinutes < 0 || turnaroundMinutes > 43_200) fail("invalid-argument", "turnaroundMinutes must be a bounded whole number.");
  if (typeof value.active !== "boolean") fail("invalid-argument", "Inventory item active state must be boolean.");
  return {
    authorityVersion: INVENTORY_AUTHORITY_VERSION,
    schemaVersion: INVENTORY_SCHEMA_VERSION,
    organizationId,
    itemId,
    name: displayText(value.name, "Inventory item name", 100),
    category: displayText(value.category, "Inventory category", 60),
    unit,
    active: value.active,
    turnaroundMinutes,
    revision: priorRevision + 1
  };
}

function verifyLocation(value) {
  try {
    assertAllowedKeys(value, new Set([
      "authorityVersion", "schemaVersion", "organizationId", "locationId", "name",
      "active", "revision", "createdAtISO", "updatedAtISO", "createdAt", "updatedAt"
    ]), "Inventory location");
    if (value.authorityVersion !== INVENTORY_AUTHORITY_VERSION || value.schemaVersion !== INVENTORY_SCHEMA_VERSION) {
      fail("data-loss", "Inventory location schema is invalid.");
    }
    const normalized = {
      authorityVersion: value.authorityVersion,
      schemaVersion: value.schemaVersion,
      organizationId: opaqueId(value.organizationId, "location organizationId"),
      locationId: opaqueId(value.locationId, "locationId"),
      name: displayText(value.name, "Location name", 80),
      active: value.active,
      revision: revision(value.revision, "location revision", { allowZero: false }),
      createdAtISO: exactISO(value.createdAtISO, "location createdAtISO", "data-loss"),
      updatedAtISO: exactISO(value.updatedAtISO, "location updatedAtISO", "data-loss")
    };
    if (typeof normalized.active !== "boolean" || Date.parse(normalized.updatedAtISO) < Date.parse(normalized.createdAtISO)) {
      fail("data-loss", "Inventory location state is inconsistent.");
    }
    return deepFreeze(normalized);
  } catch (error) {
    if (error instanceof InventoryAuthorityError && error.code === "data-loss") throw error;
    fail("data-loss", "Inventory location evidence is invalid.");
  }
}

function verifyItem(value) {
  try {
    assertAllowedKeys(value, new Set([
      "authorityVersion", "schemaVersion", "organizationId", "itemId", "name", "category",
      "unit", "active", "turnaroundMinutes", "revision", "movementCount", "firstMovementId",
      "lastMovementId", "physicalUpdatedAtISO", "createdAtISO", "updatedAtISO", "createdAt", "updatedAt"
    ]), "Inventory item");
    if (value.authorityVersion !== INVENTORY_AUTHORITY_VERSION || value.schemaVersion !== INVENTORY_SCHEMA_VERSION) {
      fail("data-loss", "Inventory item schema is invalid.");
    }
    const unit = text(value.unit).replace(/\s+/gu, " ");
    if (!UNIT_PATTERN.test(unit)) fail("data-loss", "Inventory item unit evidence is invalid.");
    const turnaroundMinutes = value.turnaroundMinutes;
    if (!Number.isSafeInteger(turnaroundMinutes) || turnaroundMinutes < 0 || turnaroundMinutes > 43_200) {
      fail("data-loss", "Inventory item turnaround evidence is invalid.");
    }
    const movementCount = revision(value.movementCount ?? 0, "item movement count");
    const firstMovementId = value.firstMovementId ? opaqueId(value.firstMovementId, "firstMovementId") : "";
    const lastMovementId = value.lastMovementId ? opaqueId(value.lastMovementId, "lastMovementId") : "";
    const physicalUpdatedAtISO = value.physicalUpdatedAtISO
      ? exactISO(value.physicalUpdatedAtISO, "item physicalUpdatedAtISO", "data-loss")
      : "";
    if ((movementCount === 0 && (firstMovementId || lastMovementId || physicalUpdatedAtISO))
      || (movementCount > 0 && (!firstMovementId || !lastMovementId || !physicalUpdatedAtISO))) {
      fail("data-loss", "Inventory item movement markers are inconsistent.");
    }
    if (movementCount > 0 && (!/^imv_[a-f0-9]{48}$/u.test(firstMovementId) || !/^imv_[a-f0-9]{48}$/u.test(lastMovementId))) {
      fail("data-loss", "Inventory item movement markers are not canonical movement identities.");
    }
    const normalized = {
      authorityVersion: value.authorityVersion,
      schemaVersion: value.schemaVersion,
      organizationId: opaqueId(value.organizationId, "item organizationId"),
      itemId: opaqueId(value.itemId, "itemId"),
      name: displayText(value.name, "Inventory item name", 100),
      category: displayText(value.category, "Inventory category", 60),
      unit,
      active: value.active,
      turnaroundMinutes,
      revision: revision(value.revision, "item revision", { allowZero: false }),
      movementCount,
      firstMovementId,
      lastMovementId,
      physicalUpdatedAtISO,
      createdAtISO: exactISO(value.createdAtISO, "item createdAtISO", "data-loss"),
      updatedAtISO: exactISO(value.updatedAtISO, "item updatedAtISO", "data-loss")
    };
    if (typeof normalized.active !== "boolean" || Date.parse(normalized.updatedAtISO) < Date.parse(normalized.createdAtISO)) {
      fail("data-loss", "Inventory item state is inconsistent.");
    }
    return deepFreeze(normalized);
  } catch (error) {
    if (error instanceof InventoryAuthorityError && error.code === "data-loss") throw error;
    fail("data-loss", "Inventory item evidence is invalid.");
  }
}

module.exports = {
  INVENTORY_SCHEMA_VERSION,
  INVENTORY_AUTHORITY_VERSION,
  INVENTORY_MOVEMENT_VERSION,
  INVENTORY_BUCKETS,
  INVENTORY_MOVEMENT_KINDS,
  INVENTORY_ADJUSTMENT_REASONS,
  INVENTORY_EVIDENCE_BOUNDARY,
  InventoryAuthorityError,
  canonicalSerialize,
  canonicalClone,
  digest,
  opaqueId,
  requestId,
  exactISO,
  wholeQuantity,
  revision,
  normalizeActor,
  assertEnabled,
  stockStateId,
  movementIdFor,
  createEmptyStockState,
  normalizeStockState,
  publicStockState,
  normalizeMovementRequest,
  verifyMovement,
  planMovement,
  replayMovements,
  normalizeLocation,
  normalizeItem,
  verifyLocation,
  verifyItem
};
