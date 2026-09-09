"use strict";

const { createHash } = require("node:crypto");

const INVENTORY_AUTHORITY_VERSION = "inventory-ingredient-authority-v2";
const INVENTORY_SCHEMA_VERSION = 2;
const INVENTORY_MOVEMENT_VERSION = "ingredient-stock-movement-v2";
const INVENTORY_COST_VERSION = "ingredient-cost-evidence-v1";
const QUANTITY_SCALE = 1_000_000;
const MAX_REVISION = 1_000_000_000;
const MAX_QUANTITY_MICROS = Number.MAX_SAFE_INTEGER;
const ID_PATTERN = /^[^\s/?#\\\u0000]{1,180}$/u;
const DECIMAL_PATTERN = /^(0|[1-9]\d*)(?:\.(\d{1,6}))?$/u;
const CURRENCY_PATTERN = /^[A-Z]{3}$/u;
const MOVEMENT_ID_PATTERN = /^imv_[a-f0-9]{48}$/u;
const COST_EVIDENCE_ID_PATTERN = /^ice_[a-f0-9]{48}$/u;
const COST_AVAILABILITY = Object.freeze([
  "available",
  "missing",
  "not_applicable",
  "not_yet_available",
  "blocked_by_integration",
  "contradictory",
  "schema_drift"
]);
const BASE_UNITS = Object.freeze({
  each: "count",
  dozen: "count",
  g: "mass",
  kg: "mass",
  oz: "mass",
  lb: "mass",
  ml: "volume",
  l: "volume",
  fl_oz: "volume",
  pt: "volume",
  qt: "volume",
  gal: "volume"
});

class InventoryIngredientError extends Error {
  constructor(code, message, details = {}) {
    super(message);
    this.name = "InventoryIngredientError";
    this.code = code;
    this.details = details;
  }
}

function fail(code, message, details) {
  throw new InventoryIngredientError(code, message, details);
}

function isRecord(value) {
  if (!value || typeof value !== "object" || Array.isArray(value)) return false;
  const prototype = Object.getPrototypeOf(value);
  return prototype === Object.prototype || prototype === null;
}

function exact(value, keys, label, code = "invalid-argument") {
  if (!isRecord(value)
    || Object.keys(value).length !== keys.length
    || keys.some((key) => !Object.hasOwn(value, key))) {
    fail(code, `${label} contains missing or unsupported fields.`);
  }
}

function cleanText(value, label, maximum = 180, { allowEmpty = false } = {}) {
  if (typeof value !== "string" || value !== value.trim()) {
    fail("invalid-argument", `${label} must be exact text.`);
  }
  const normalized = value.replace(/\s+/gu, " ");
  if ((!allowEmpty && !normalized) || normalized.length > maximum) {
    fail("invalid-argument", `${label} must be ${allowEmpty ? "bounded" : "non-empty bounded"} text.`);
  }
  return normalized;
}

function opaqueId(value, label = "identifier") {
  if (typeof value !== "string" || value !== value.trim() || !ID_PATTERN.test(value)
    || value === "." || value === ".." || /^[^@\s]+@[^@\s]+$/u.test(value)) {
    fail("invalid-argument", `${label} must be a stable opaque identifier.`);
  }
  return value;
}

function requestId(value) {
  return opaqueId(value, "requestId");
}

function exactISO(value, label = "timestamp") {
  if (typeof value !== "string") fail("invalid-argument", `${label} must be an exact ISO timestamp.`);
  const parsed = new Date(value);
  if (Number.isNaN(parsed.getTime()) || parsed.toISOString() !== value) {
    fail("invalid-argument", `${label} must be an exact ISO timestamp.`);
  }
  return value;
}

function revision(value, label, { allowZero = true } = {}) {
  if (!Number.isSafeInteger(value) || value < (allowZero ? 0 : 1) || value > MAX_REVISION) {
    fail("invalid-argument", `${label} must be a bounded whole-number revision.`);
  }
  return value;
}

function parseQuantityMicros(value, label = "quantity", { allowZero = false } = {}) {
  if (typeof value !== "string" || !DECIMAL_PATTERN.test(value)) {
    fail("invalid-argument", `${label} must be a canonical decimal string with at most six places.`);
  }
  const [whole, fraction = ""] = value.split(".");
  const micros = BigInt(whole) * BigInt(QUANTITY_SCALE)
    + BigInt(fraction.padEnd(6, "0") || "0");
  if ((!allowZero && micros === 0n) || micros > BigInt(MAX_QUANTITY_MICROS)) {
    fail("invalid-argument", `${label} is outside the supported positive quantity range.`);
  }
  return Number(micros);
}

function formatQuantityMicros(value, label = "quantityMicros") {
  if (!Number.isSafeInteger(value) || value < 0 || value > MAX_QUANTITY_MICROS) {
    fail("data-loss", `${label} is not a safe fixed-point quantity.`);
  }
  const whole = Math.floor(value / QUANTITY_SCALE);
  const fraction = String(value % QUANTITY_SCALE).padStart(6, "0").replace(/0+$/u, "");
  return fraction ? `${whole}.${fraction}` : String(whole);
}

function baseUnitId(value) {
  if (!Object.hasOwn(BASE_UNITS, value)) fail("invalid-argument", "baseUnitId is unsupported.");
  return value;
}

function canonicalClone(value, label = "value") {
  if (value === null || typeof value === "string" || typeof value === "boolean") return value;
  if (typeof value === "number") {
    if (!Number.isSafeInteger(value)) fail("invalid-argument", `${label} contains unsafe numeric evidence.`);
    return value;
  }
  if (Array.isArray(value)) return value.map((entry, index) => canonicalClone(entry, `${label}[${index}]`));
  if (!isRecord(value)) fail("invalid-argument", `${label} must contain only canonical values.`);
  return Object.fromEntries(Object.keys(value).sort().map((key) => {
    if (value[key] === undefined) fail("invalid-argument", `${label}.${key} is undefined.`);
    return [key, canonicalClone(value[key], `${label}.${key}`)];
  }));
}

function canonicalSerialize(value, label) {
  return JSON.stringify(canonicalClone(value, label));
}

function digest(value, label = "value") {
  return createHash("sha256").update(canonicalSerialize(value, label)).digest("hex");
}

function normalizeActor(value, organizationId) {
  exact(value, ["uid", "email", "role", "organizationId"], "actor", "permission-denied");
  const actor = {
    uid: opaqueId(value.uid, "actor.uid"),
    email: cleanText(value.email, "actor.email", 254),
    role: cleanText(value.role, "actor.role", 24),
    organizationId: opaqueId(value.organizationId, "actor.organizationId")
  };
  if (actor.organizationId !== organizationId || actor.role !== "admin") {
    fail("permission-denied", "Inventory mutations require the same-tenant administrator.");
  }
  return actor;
}

function locationIdFor(organizationId, locationId) {
  return `iloc_${digest({ organizationId: opaqueId(organizationId), locationId: opaqueId(locationId) }).slice(0, 48)}`;
}

function stockStateId(ingredientId, locationId) {
  return `iss_${digest({ ingredientId: opaqueId(ingredientId), locationId: opaqueId(locationId) }).slice(0, 48)}`;
}

function movementIdFor(organizationId, retryId) {
  return `imv_${digest({ organizationId: opaqueId(organizationId), requestId: requestId(retryId) }).slice(0, 48)}`;
}

function costStateId(ingredientId) {
  return `ics_${digest({ ingredientId: opaqueId(ingredientId) }).slice(0, 48)}`;
}

function costEvidenceIdFor(organizationId, retryId) {
  return `ice_${digest({ organizationId: opaqueId(organizationId), requestId: requestId(retryId) }).slice(0, 48)}`;
}

function normalizeLocationRequest(value) {
  exact(value, ["kind", "locationId", "name", "active", "expectedRevision"], "location command");
  if (value.kind !== "upsert_location" || typeof value.active !== "boolean") fail("invalid-argument", "Location command is invalid.");
  return {
    kind: value.kind,
    locationId: opaqueId(value.locationId, "locationId"),
    name: cleanText(value.name, "location name", 100),
    active: value.active,
    expectedRevision: revision(value.expectedRevision, "expectedRevision")
  };
}

function planLocation({ organizationId, request, current = null, actor, nowISO }) {
  const orgId = opaqueId(organizationId, "organizationId");
  const normalized = normalizeLocationRequest(request);
  const normalizedActor = normalizeActor(actor, orgId);
  const recordedAtISO = exactISO(nowISO, "nowISO");
  const currentRevision = current ? revision(current.revision, "current location revision", { allowZero: false }) : 0;
  if (currentRevision !== normalized.expectedRevision) fail("aborted", "Location revision is stale.");
  const location = {
    authorityVersion: INVENTORY_AUTHORITY_VERSION,
    schemaVersion: INVENTORY_SCHEMA_VERSION,
    organizationId: orgId,
    locationId: normalized.locationId,
    name: normalized.name,
    active: normalized.active,
    revision: currentRevision + 1,
    createdAtISO: current?.createdAtISO || recordedAtISO,
    updatedAtISO: recordedAtISO,
    updatedBy: normalizedActor
  };
  return { request: normalized, location: Object.freeze(location) };
}

function normalizeIngredientRequest(value) {
  exact(value, ["kind", "ingredientId", "name", "category", "baseUnitId", "active", "expectedRevision"], "ingredient command");
  if (value.kind !== "upsert_ingredient" || typeof value.active !== "boolean") fail("invalid-argument", "Ingredient command is invalid.");
  return {
    kind: value.kind,
    ingredientId: opaqueId(value.ingredientId, "ingredientId"),
    name: cleanText(value.name, "ingredient name", 100),
    category: cleanText(value.category, "ingredient category", 80),
    baseUnitId: baseUnitId(value.baseUnitId),
    active: value.active,
    expectedRevision: revision(value.expectedRevision, "expectedRevision")
  };
}

function planIngredient({ organizationId, request, current = null, currentCostState = null, actor, nowISO }) {
  const orgId = opaqueId(organizationId, "organizationId");
  const normalized = normalizeIngredientRequest(request);
  const normalizedActor = normalizeActor(actor, orgId);
  const recordedAtISO = exactISO(nowISO, "nowISO");
  const currentRevision = current ? revision(current.revision, "current ingredient revision", { allowZero: false }) : 0;
  if (currentRevision !== normalized.expectedRevision) fail("aborted", "Ingredient revision is stale.");
  if (currentCostState && !current) {
    fail("data-loss", "Ingredient cost evidence exists without its ingredient authority.");
  }
  if ((current?.firstMovementId || currentCostState?.lastCostEvidenceId)
    && current.baseUnitId !== normalized.baseUnitId) {
    fail("failed-precondition", "An ingredient base unit is immutable after its first stock or cost evidence.");
  }
  if (currentCostState && (currentCostState.organizationId !== orgId
    || currentCostState.ingredientId !== normalized.ingredientId
    || currentCostState.baseUnitId !== current.baseUnitId)) {
    fail("data-loss", "The ingredient cost state is inconsistent with its ingredient authority.");
  }
  const ingredient = {
    authorityVersion: INVENTORY_AUTHORITY_VERSION,
    schemaVersion: INVENTORY_SCHEMA_VERSION,
    itemKind: "ingredient",
    organizationId: orgId,
    ingredientId: normalized.ingredientId,
    name: normalized.name,
    nameSortKey: normalized.name.toLocaleLowerCase("en-US"),
    category: normalized.category,
    baseUnitId: normalized.baseUnitId,
    dimension: BASE_UNITS[normalized.baseUnitId],
    active: normalized.active,
    revision: currentRevision + 1,
    firstMovementId: current?.firstMovementId || "",
    movementCount: current?.movementCount || 0,
    createdAtISO: current?.createdAtISO || recordedAtISO,
    updatedAtISO: recordedAtISO,
    updatedBy: normalizedActor
  };
  return { request: normalized, ingredient: Object.freeze(ingredient) };
}

function createEmptyStockState({ organizationId, ingredientId, locationId, baseUnitId: unit }) {
  return Object.freeze({
    authorityVersion: INVENTORY_AUTHORITY_VERSION,
    schemaVersion: INVENTORY_SCHEMA_VERSION,
    organizationId: opaqueId(organizationId, "organizationId"),
    ingredientId: opaqueId(ingredientId, "ingredientId"),
    locationId: opaqueId(locationId, "locationId"),
    stockStateId: stockStateId(ingredientId, locationId),
    baseUnitId: baseUnitId(unit),
    revision: 0,
    onHandMicros: 0,
    lastMovementId: "",
    updatedAtISO: ""
  });
}

function normalizeOpeningBalanceRequest(value) {
  exact(value, ["kind", "ingredientId", "locationId", "quantity", "baseUnitId", "occurredAtISO", "note", "expectedStockRevision"], "opening balance command");
  if (value.kind !== "opening_balance") fail("invalid-argument", "Opening balance command is invalid.");
  const unit = baseUnitId(value.baseUnitId);
  return {
    kind: value.kind,
    ingredientId: opaqueId(value.ingredientId, "ingredientId"),
    locationId: opaqueId(value.locationId, "locationId"),
    quantity: formatQuantityMicros(parseQuantityMicros(value.quantity)),
    quantityMicros: parseQuantityMicros(value.quantity),
    baseUnitId: unit,
    occurredAtISO: exactISO(value.occurredAtISO, "occurredAtISO"),
    note: cleanText(value.note, "opening balance note", 240),
    expectedStockRevision: revision(value.expectedStockRevision, "expectedStockRevision")
  };
}

function planOpeningBalance({ organizationId, requestId: retryId, request, ingredient, location, stockState, actor, nowISO }) {
  const orgId = opaqueId(organizationId, "organizationId");
  const normalized = normalizeOpeningBalanceRequest(request);
  const normalizedActor = normalizeActor(actor, orgId);
  const recordedAtISO = exactISO(nowISO, "nowISO");
  if (!ingredient || ingredient.organizationId !== orgId || ingredient.ingredientId !== normalized.ingredientId || ingredient.itemKind !== "ingredient" || !ingredient.active) {
    fail("failed-precondition", "Opening stock requires the active same-tenant ingredient.");
  }
  if (!location || location.organizationId !== orgId || location.locationId !== normalized.locationId || !location.active) {
    fail("failed-precondition", "Opening stock requires the active same-tenant location.");
  }
  if (ingredient.baseUnitId !== normalized.baseUnitId) fail("failed-precondition", "Opening quantity must use the ingredient base unit.");
  const current = stockState || createEmptyStockState({ organizationId: orgId, ...normalized });
  if (current.revision !== normalized.expectedStockRevision || current.revision !== 0 || current.onHandMicros !== 0 || current.lastMovementId) {
    fail("already-exists", "Opening stock can be recorded only once for an empty ingredient/location state.");
  }
  const id = movementIdFor(orgId, retryId);
  const nextStockState = Object.freeze({
    ...current,
    revision: 1,
    onHandMicros: normalized.quantityMicros,
    lastMovementId: id,
    updatedAtISO: recordedAtISO
  });
  const body = {
    authorityVersion: INVENTORY_AUTHORITY_VERSION,
    schemaVersion: INVENTORY_SCHEMA_VERSION,
    movementVersion: INVENTORY_MOVEMENT_VERSION,
    organizationId: orgId,
    movementId: id,
    requestId: requestId(retryId),
    requestDigest: digest(normalized, "opening request"),
    kind: "opening_balance",
    ingredientId: normalized.ingredientId,
    locationId: normalized.locationId,
    baseUnitId: normalized.baseUnitId,
    quantity: normalized.quantity,
    quantityMicros: normalized.quantityMicros,
    priorStockRevision: 0,
    resultStockRevision: 1,
    priorOnHandMicros: 0,
    resultOnHandMicros: normalized.quantityMicros,
    occurredAtISO: normalized.occurredAtISO,
    recordedAtISO,
    note: normalized.note,
    actor: normalizedActor
  };
  const movement = Object.freeze({ ...body, movementDigest: digest(body, "ingredient movement") });
  return { request: normalized, movement, nextStockState };
}

function verifyMovement(value) {
  exact(value, [
    "authorityVersion", "schemaVersion", "movementVersion", "organizationId", "movementId",
    "requestId", "requestDigest", "kind", "ingredientId", "locationId", "baseUnitId",
    "quantity", "quantityMicros", "priorStockRevision", "resultStockRevision",
    "priorOnHandMicros", "resultOnHandMicros", "occurredAtISO", "recordedAtISO", "note",
    "actor", "movementDigest"
  ], "ingredient movement", "data-loss");
  if (value.authorityVersion !== INVENTORY_AUTHORITY_VERSION || value.schemaVersion !== INVENTORY_SCHEMA_VERSION
    || value.movementVersion !== INVENTORY_MOVEMENT_VERSION || value.kind !== "opening_balance") {
    fail("data-loss", "Ingredient movement uses an unsupported schema.");
  }
  const { movementDigest, ...body } = value;
  if (movementDigest !== digest(body, "ingredient movement")) fail("data-loss", "Ingredient movement digest does not match.");
  const orgId = opaqueId(value.organizationId, "movement organizationId");
  const retryId = requestId(value.requestId);
  const normalized = normalizeOpeningBalanceRequest({
    kind: value.kind,
    ingredientId: value.ingredientId,
    locationId: value.locationId,
    quantity: value.quantity,
    baseUnitId: value.baseUnitId,
    occurredAtISO: value.occurredAtISO,
    note: value.note,
    expectedStockRevision: value.priorStockRevision
  });
  normalizeActor(value.actor, orgId);
  exactISO(value.recordedAtISO, "movement recordedAtISO");
  if (value.movementId !== movementIdFor(orgId, retryId)
    || value.requestDigest !== digest(normalized, "opening request")
    || parseQuantityMicros(value.quantity) !== value.quantityMicros
    || value.priorStockRevision !== 0 || value.resultStockRevision !== 1
    || value.priorOnHandMicros !== 0 || value.resultOnHandMicros !== value.quantityMicros) {
    fail("data-loss", "Ingredient opening movement is internally inconsistent.");
  }
  return value;
}

function replayMovements({ organizationId, ingredientId, locationId, baseUnitId: unit, movements }) {
  if (!Array.isArray(movements)) fail("invalid-argument", "movements must be a list.");
  let state = createEmptyStockState({ organizationId, ingredientId, locationId, baseUnitId: unit });
  for (const movement of movements) {
    verifyMovement(movement);
    if (state.revision !== 0 || movement.organizationId !== state.organizationId || movement.ingredientId !== state.ingredientId || movement.locationId !== state.locationId || movement.baseUnitId !== state.baseUnitId) {
      fail("data-loss", "Ingredient movement cannot follow this stock state.");
    }
    state = Object.freeze({ ...state, revision: 1, onHandMicros: movement.quantityMicros, lastMovementId: movement.movementId, updatedAtISO: movement.recordedAtISO });
  }
  return state;
}

function normalizeCostEvidenceRequest(value) {
  const common = ["kind", "ingredientId", "baseUnitId", "availability", "sourceLabel", "observedAtISO", "note", "expectedCostRevision"];
  if (!isRecord(value) || value.kind !== "record_ingredient_cost" || !COST_AVAILABILITY.includes(value.availability)) {
    fail("invalid-argument", "Ingredient cost command is invalid.");
  }
  const available = value.availability === "available";
  exact(value, available ? [...common, "basisQuantity", "totalCostMinor", "currency"] : common, "ingredient cost command");
  const normalized = {
    kind: value.kind,
    ingredientId: opaqueId(value.ingredientId, "ingredientId"),
    baseUnitId: baseUnitId(value.baseUnitId),
    availability: value.availability,
    sourceLabel: cleanText(value.sourceLabel, "cost source", 120),
    observedAtISO: exactISO(value.observedAtISO, "observedAtISO"),
    note: cleanText(value.note, "cost note", 240, { allowEmpty: true }),
    expectedCostRevision: revision(value.expectedCostRevision, "expectedCostRevision")
  };
  if (available) {
    if (!Number.isSafeInteger(value.totalCostMinor) || value.totalCostMinor < 0) fail("invalid-argument", "totalCostMinor must be exact non-negative minor-unit money.");
    if (typeof value.currency !== "string" || !CURRENCY_PATTERN.test(value.currency)) fail("invalid-argument", "currency must be an uppercase ISO code.");
    normalized.basisQuantity = formatQuantityMicros(parseQuantityMicros(value.basisQuantity));
    normalized.basisQuantityMicros = parseQuantityMicros(value.basisQuantity);
    normalized.totalCostMinor = value.totalCostMinor;
    normalized.currency = value.currency;
  }
  return normalized;
}

function planIngredientCostEvidence({ organizationId, requestId: retryId, request, ingredient, currentCostState = null, actor, nowISO }) {
  const orgId = opaqueId(organizationId, "organizationId");
  const normalized = normalizeCostEvidenceRequest(request);
  const normalizedActor = normalizeActor(actor, orgId);
  const recordedAtISO = exactISO(nowISO, "nowISO");
  if (!ingredient || ingredient.organizationId !== orgId || ingredient.ingredientId !== normalized.ingredientId || ingredient.baseUnitId !== normalized.baseUnitId || ingredient.itemKind !== "ingredient" || !ingredient.active) {
    fail("failed-precondition", "Cost evidence requires the active exact same-tenant ingredient and base unit.");
  }
  const priorRevision = currentCostState?.revision || 0;
  if (priorRevision !== normalized.expectedCostRevision) fail("aborted", "Ingredient cost revision is stale.");
  const id = costEvidenceIdFor(orgId, retryId);
  const resultRevision = priorRevision + 1;
  const state = {
    authorityVersion: INVENTORY_AUTHORITY_VERSION,
    schemaVersion: INVENTORY_SCHEMA_VERSION,
    costStateVersion: INVENTORY_COST_VERSION,
    organizationId: orgId,
    ingredientId: normalized.ingredientId,
    costStateId: costStateId(normalized.ingredientId),
    baseUnitId: normalized.baseUnitId,
    revision: resultRevision,
    availability: normalized.availability,
    sourceLabel: normalized.sourceLabel,
    observedAtISO: normalized.observedAtISO,
    lastCostEvidenceId: id,
    updatedAtISO: recordedAtISO
  };
  if (normalized.availability === "available") {
    state.basisQuantityMicros = normalized.basisQuantityMicros;
    state.totalCostMinor = normalized.totalCostMinor;
    state.currency = normalized.currency;
  }
  const evidenceBody = {
    authorityVersion: INVENTORY_AUTHORITY_VERSION,
    schemaVersion: INVENTORY_SCHEMA_VERSION,
    costEvidenceVersion: INVENTORY_COST_VERSION,
    organizationId: orgId,
    ingredientId: normalized.ingredientId,
    costEvidenceId: id,
    requestId: requestId(retryId),
    requestDigest: digest(normalized, "cost request"),
    priorCostRevision: priorRevision,
    resultCostRevision: resultRevision,
    availability: normalized.availability,
    sourceLabel: normalized.sourceLabel,
    observedAtISO: normalized.observedAtISO,
    recordedAtISO,
    note: normalized.note,
    actor: normalizedActor,
    resultCostState: state
  };
  if (normalized.availability === "available") {
    evidenceBody.basisQuantity = normalized.basisQuantity;
    evidenceBody.basisQuantityMicros = normalized.basisQuantityMicros;
    evidenceBody.totalCostMinor = normalized.totalCostMinor;
    evidenceBody.currency = normalized.currency;
  }
  return {
    request: normalized,
    nextCostState: Object.freeze(state),
    costEvidence: Object.freeze({ ...evidenceBody, costEvidenceDigest: digest(evidenceBody, "ingredient cost evidence") })
  };
}

function verifyCostEvidence(value) {
  const available = value?.availability === "available";
  const commonKeys = [
    "authorityVersion", "schemaVersion", "costEvidenceVersion", "organizationId", "ingredientId",
    "costEvidenceId", "requestId", "requestDigest", "priorCostRevision", "resultCostRevision",
    "availability", "sourceLabel", "observedAtISO", "recordedAtISO", "note", "actor",
    "resultCostState", "costEvidenceDigest"
  ];
  exact(value, available
    ? [...commonKeys, "basisQuantity", "basisQuantityMicros", "totalCostMinor", "currency"]
    : commonKeys, "ingredient cost evidence", "data-loss");
  if (value.authorityVersion !== INVENTORY_AUTHORITY_VERSION || value.schemaVersion !== INVENTORY_SCHEMA_VERSION
    || value.costEvidenceVersion !== INVENTORY_COST_VERSION || !COST_AVAILABILITY.includes(value.availability)) {
    fail("data-loss", "Ingredient cost evidence uses an unsupported schema.");
  }
  const { costEvidenceDigest, ...body } = value;
  if (costEvidenceDigest !== digest(body, "ingredient cost evidence")) fail("data-loss", "Ingredient cost evidence digest does not match.");
  const orgId = opaqueId(value.organizationId, "cost organizationId");
  const retryId = requestId(value.requestId);
  const priorRevision = revision(value.priorCostRevision, "priorCostRevision");
  if (revision(value.resultCostRevision, "resultCostRevision", { allowZero: false }) !== priorRevision + 1
    || value.costEvidenceId !== costEvidenceIdFor(orgId, retryId)) {
    fail("data-loss", "Ingredient cost evidence revision or identity is inconsistent.");
  }
  const request = {
    kind: "record_ingredient_cost",
    ingredientId: value.ingredientId,
    baseUnitId: value.resultCostState?.baseUnitId,
    availability: value.availability,
    sourceLabel: value.sourceLabel,
    observedAtISO: value.observedAtISO,
    note: value.note,
    expectedCostRevision: priorRevision
  };
  if (available) Object.assign(request, {
    basisQuantity: value.basisQuantity,
    totalCostMinor: value.totalCostMinor,
    currency: value.currency
  });
  const normalized = normalizeCostEvidenceRequest(request);
  normalizeActor(value.actor, orgId);
  exactISO(value.recordedAtISO, "cost recordedAtISO");
  if (value.requestDigest !== digest(normalized, "cost request")) {
    fail("data-loss", "Ingredient cost request provenance is inconsistent.");
  }
  verifyCostState(value.resultCostState, {
    organizationId: orgId,
    ingredientId: normalized.ingredientId,
    expectedEvidenceId: value.costEvidenceId
  });
  if (value.resultCostState.revision !== value.resultCostRevision
    || value.resultCostState.updatedAtISO !== value.recordedAtISO
    || value.resultCostState.availability !== value.availability
    || value.resultCostState.sourceLabel !== value.sourceLabel
    || value.resultCostState.observedAtISO !== value.observedAtISO) {
    fail("data-loss", "Ingredient cost evidence result state is inconsistent.");
  }
  if (available) {
    if (parseQuantityMicros(value.basisQuantity) !== value.basisQuantityMicros
      || value.resultCostState.basisQuantityMicros !== value.basisQuantityMicros
      || value.resultCostState.totalCostMinor !== value.totalCostMinor
      || value.resultCostState.currency !== value.currency) {
      fail("data-loss", "Available cost evidence is inconsistent.");
    }
  } else if (["basisQuantity", "basisQuantityMicros", "totalCostMinor", "currency"].some((key) => Object.hasOwn(value, key) || Object.hasOwn(value.resultCostState || {}, key))) {
    fail("data-loss", "Unavailable cost evidence must not contain invented money.");
  }
  return value;
}

function verifyLocation(value, { organizationId, locationId } = {}) {
  exact(value, [
    "authorityVersion", "schemaVersion", "organizationId", "locationId", "name", "active",
    "revision", "createdAtISO", "updatedAtISO", "updatedBy"
  ], "inventory location", "data-loss");
  if (value.authorityVersion !== INVENTORY_AUTHORITY_VERSION || value.schemaVersion !== INVENTORY_SCHEMA_VERSION
    || value.organizationId !== opaqueId(organizationId, "expected organizationId")
    || value.locationId !== opaqueId(locationId, "expected locationId")
    || cleanText(value.name, "location name", 100) !== value.name || typeof value.active !== "boolean") {
    fail("data-loss", "Stored inventory location is inconsistent.");
  }
  revision(value.revision, "location revision", { allowZero: false });
  exactISO(value.createdAtISO, "location createdAtISO");
  exactISO(value.updatedAtISO, "location updatedAtISO");
  normalizeActor(value.updatedBy, value.organizationId);
  return value;
}

function verifyIngredient(value, { organizationId, ingredientId } = {}) {
  exact(value, [
    "authorityVersion", "schemaVersion", "itemKind", "organizationId", "ingredientId", "name",
    "nameSortKey", "category", "baseUnitId", "dimension", "active", "revision", "firstMovementId",
    "movementCount", "createdAtISO", "updatedAtISO", "updatedBy"
  ], "inventory ingredient", "data-loss");
  const unit = baseUnitId(value.baseUnitId);
  if (value.authorityVersion !== INVENTORY_AUTHORITY_VERSION || value.schemaVersion !== INVENTORY_SCHEMA_VERSION
    || value.itemKind !== "ingredient"
    || value.organizationId !== opaqueId(organizationId, "expected organizationId")
    || value.ingredientId !== opaqueId(ingredientId, "expected ingredientId")
    || cleanText(value.name, "ingredient name", 100) !== value.name
    || value.nameSortKey !== value.name.toLocaleLowerCase("en-US")
    || cleanText(value.category, "ingredient category", 80) !== value.category
    || value.dimension !== BASE_UNITS[unit] || typeof value.active !== "boolean") {
    fail("data-loss", "Stored inventory ingredient is inconsistent.");
  }
  revision(value.revision, "ingredient revision", { allowZero: false });
  revision(value.movementCount, "ingredient movementCount");
  if ((value.movementCount === 0) !== (value.firstMovementId === "")
    || (value.firstMovementId && !MOVEMENT_ID_PATTERN.test(value.firstMovementId))) {
    fail("data-loss", "Stored inventory ingredient movement provenance is inconsistent.");
  }
  exactISO(value.createdAtISO, "ingredient createdAtISO");
  exactISO(value.updatedAtISO, "ingredient updatedAtISO");
  normalizeActor(value.updatedBy, value.organizationId);
  return value;
}

function verifyStockState(value, { organizationId, ingredientId, locationId } = {}) {
  exact(value, [
    "authorityVersion", "schemaVersion", "organizationId", "ingredientId", "locationId", "stockStateId",
    "baseUnitId", "revision", "onHandMicros", "lastMovementId", "updatedAtISO"
  ], "ingredient stock state", "data-loss");
  const orgId = opaqueId(organizationId, "expected organizationId");
  const itemId = opaqueId(ingredientId, "expected ingredientId");
  const stockLocationId = opaqueId(locationId, "expected locationId");
  if (value.authorityVersion !== INVENTORY_AUTHORITY_VERSION || value.schemaVersion !== INVENTORY_SCHEMA_VERSION
    || value.organizationId !== orgId || value.ingredientId !== itemId || value.locationId !== stockLocationId
    || value.stockStateId !== stockStateId(itemId, stockLocationId)) {
    fail("data-loss", "Stored ingredient stock state is inconsistent.");
  }
  baseUnitId(value.baseUnitId);
  const stockRevision = revision(value.revision, "stock revision");
  formatQuantityMicros(value.onHandMicros, "stock onHandMicros");
  if (stockRevision === 0) {
    if (value.onHandMicros !== 0 || value.lastMovementId !== "" || value.updatedAtISO !== "") {
      fail("data-loss", "Empty ingredient stock state contains invented evidence.");
    }
  } else if (!MOVEMENT_ID_PATTERN.test(value.lastMovementId)) {
    fail("data-loss", "Ingredient stock state lacks movement provenance.");
  } else exactISO(value.updatedAtISO, "stock updatedAtISO");
  return value;
}

function verifyCostState(value, { organizationId, ingredientId, expectedEvidenceId = "" } = {}) {
  const available = value?.availability === "available";
  const commonKeys = [
    "authorityVersion", "schemaVersion", "costStateVersion", "organizationId", "ingredientId",
    "costStateId", "baseUnitId", "revision", "availability", "sourceLabel", "observedAtISO",
    "lastCostEvidenceId", "updatedAtISO"
  ];
  exact(value, available
    ? [...commonKeys, "basisQuantityMicros", "totalCostMinor", "currency"]
    : commonKeys, "ingredient cost state", "data-loss");
  const orgId = opaqueId(organizationId, "expected organizationId");
  const itemId = opaqueId(ingredientId, "expected ingredientId");
  if (value.authorityVersion !== INVENTORY_AUTHORITY_VERSION || value.schemaVersion !== INVENTORY_SCHEMA_VERSION
    || value.costStateVersion !== INVENTORY_COST_VERSION || value.organizationId !== orgId
    || value.ingredientId !== itemId || value.costStateId !== costStateId(itemId)
    || !COST_AVAILABILITY.includes(value.availability)) {
    fail("data-loss", "Stored ingredient cost state is inconsistent.");
  }
  baseUnitId(value.baseUnitId);
  revision(value.revision, "cost revision", { allowZero: false });
  cleanText(value.sourceLabel, "cost source", 120);
  exactISO(value.observedAtISO, "cost observedAtISO");
  exactISO(value.updatedAtISO, "cost updatedAtISO");
  if (!COST_EVIDENCE_ID_PATTERN.test(value.lastCostEvidenceId)
    || (expectedEvidenceId && value.lastCostEvidenceId !== expectedEvidenceId)) {
    fail("data-loss", "Ingredient cost state lacks exact evidence provenance.");
  }
  if (available) {
    if (!Number.isSafeInteger(value.basisQuantityMicros) || value.basisQuantityMicros <= 0
      || !Number.isSafeInteger(value.totalCostMinor) || value.totalCostMinor < 0
      || typeof value.currency !== "string" || !CURRENCY_PATTERN.test(value.currency)) {
      fail("data-loss", "Available ingredient cost state is inconsistent.");
    }
  } else if (["basisQuantityMicros", "totalCostMinor", "currency"].some((key) => Object.hasOwn(value, key))) {
    fail("data-loss", "Unavailable ingredient cost state contains invented money.");
  }
  return value;
}

module.exports = {
  BASE_UNITS,
  COST_AVAILABILITY,
  INVENTORY_AUTHORITY_VERSION,
  INVENTORY_COST_VERSION,
  INVENTORY_MOVEMENT_VERSION,
  INVENTORY_SCHEMA_VERSION,
  InventoryIngredientError,
  QUANTITY_SCALE,
  baseUnitId,
  canonicalClone,
  canonicalSerialize,
  costEvidenceIdFor,
  costStateId,
  createEmptyStockState,
  digest,
  exactISO,
  formatQuantityMicros,
  locationIdFor,
  movementIdFor,
  normalizeActor,
  normalizeCostEvidenceRequest,
  normalizeIngredientRequest,
  normalizeLocationRequest,
  normalizeOpeningBalanceRequest,
  opaqueId,
  parseQuantityMicros,
  planIngredient,
  planIngredientCostEvidence,
  planLocation,
  planOpeningBalance,
  replayMovements,
  requestId,
  revision,
  stockStateId,
  verifyCostEvidence,
  verifyCostState,
  verifyIngredient,
  verifyLocation,
  verifyMovement,
  verifyStockState
};
