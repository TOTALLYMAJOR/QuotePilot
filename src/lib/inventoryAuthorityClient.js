import { collection, doc, limit, onSnapshot, orderBy, query } from "firebase/firestore";
import { httpsCallable } from "firebase/functions";
import { auth, cloudFunctions, db, firebaseReady } from "./firebase";

export const INVENTORY_AUTHORITY_SCHEMA_VERSION = 2;
export const INVENTORY_AUTHORITY_VERSION = "inventory-ingredient-authority-v2";
export const INVENTORY_INGREDIENT_PROJECTION_LIMIT = 200;
export const INVENTORY_AUTHORITY_CALLABLES = Object.freeze({
  applyCommand: "applyInventoryCommand"
});
export const INVENTORY_COMMAND_KINDS = Object.freeze([
  "upsert_location",
  "upsert_ingredient",
  "opening_balance",
  "record_ingredient_cost"
]);
export const INVENTORY_COST_AVAILABILITY = Object.freeze([
  "available",
  "missing",
  "not_applicable",
  "not_yet_available",
  "blocked_by_integration",
  "contradictory",
  "schema_drift"
]);
export const INVENTORY_BASE_UNITS = Object.freeze({
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

const STAFF_ROLES = new Set(["admin", "sales"]);
const COST_AVAILABILITY = new Set(INVENTORY_COST_AVAILABILITY);
const COMMAND_KINDS = new Set(INVENTORY_COMMAND_KINDS);
const POISON_KEYS = new Set(["__proto__", "prototype", "constructor"]);
const IDENTIFIER_PATTERN = /^[^\s/?#\\\u0000]{1,180}$/u;
const REQUEST_ID_PATTERN = /^inventory_request_[a-f0-9]{32}$/u;
const RECEIPT_ID_PATTERN = /^iar_[a-f0-9]{48}$/u;
const MOVEMENT_ID_PATTERN = /^imv_[a-f0-9]{48}$/u;
const COST_EVIDENCE_ID_PATTERN = /^ice_[a-f0-9]{48}$/u;
const DECIMAL_PATTERN = /^(0|[1-9]\d*)(?:\.(\d{1,6}))?$/u;
const MONEY_INPUT_PATTERN = /^(0|[1-9]\d*)(?:\.(\d{1,2}))?$/u;
const CURRENCY_PATTERN = /^[A-Z]{3}$/u;
const MAX_REVISION = 1_000_000_000;
const MAX_JSON_BYTES = 262_144;
const MAX_PENDING_ATTEMPTS = 32;
const QUANTITY_SCALE = 1_000_000n;
const pendingAttempts = new Map();

function compareCodePoints(left, right) {
  return left < right ? -1 : left > right ? 1 : 0;
}

function clientError(code, message, definitive = true) {
  const error = new Error(message);
  error.code = code;
  error.inventoryDefinitive = definitive === true;
  return error;
}

function isRecord(value) {
  if (!value || typeof value !== "object" || Array.isArray(value)) return false;
  const prototype = Object.getPrototypeOf(value);
  return prototype === Object.prototype || prototype === null;
}

function exactKeys(value, keys, label, code = "invalid-argument") {
  if (!isRecord(value)) throw clientError(code, `${label} must be an object.`);
  const actual = Object.keys(value);
  if (
    actual.length !== keys.length
    || keys.some((key) => !Object.hasOwn(value, key))
    || actual.some((key) => POISON_KEYS.has(key))
  ) {
    throw clientError(code, `${label} contains missing or unsupported fields.`);
  }
  return value;
}

function identifier(value, label, code = "invalid-argument") {
  if (
    typeof value !== "string"
    || value !== value.trim()
    || !IDENTIFIER_PATTERN.test(value)
    || value === "."
    || value === ".."
    || POISON_KEYS.has(value.toLowerCase())
    || /^[^@\s]+@[^@\s]+$/u.test(value)
  ) {
    throw clientError(code, `${label} must be an exact stable opaque identifier.`);
  }
  return value;
}

function optionalIdentifier(value, label, code = "data-loss") {
  return value === "" ? "" : identifier(value, label, code);
}

function exactText(value, label, maximum, { allowEmpty = false, code = "invalid-argument" } = {}) {
  if (typeof value !== "string" || value !== value.trim()) {
    throw clientError(code, `${label} must be exact text.`);
  }
  const normalized = value.replace(/\s+/gu, " ");
  if ((!allowEmpty && !normalized) || normalized.length > maximum) {
    throw clientError(code, `${label} must be bounded${allowEmpty ? "" : " non-empty"} text.`);
  }
  return normalized;
}

function exactBoolean(value, label, code = "data-loss") {
  if (typeof value !== "boolean") throw clientError(code, `${label} must be boolean.`);
  return value;
}

function exactRevision(value, label, { allowZero = true, code = "invalid-argument" } = {}) {
  if (!Number.isSafeInteger(value) || value < (allowZero ? 0 : 1) || value > MAX_REVISION) {
    throw clientError(code, `${label} must be a bounded whole-number revision.`);
  }
  return value;
}

function exactSafeInteger(value, label, { minimum = 0, code = "data-loss" } = {}) {
  if (!Number.isSafeInteger(value) || value < minimum) {
    throw clientError(code, `${label} must be an exact safe integer.`);
  }
  return value;
}

function exactIso(value, label, code = "data-loss", { allowEmpty = false } = {}) {
  if (allowEmpty && value === "") return "";
  if (typeof value !== "string") throw clientError(code, `${label} must be an exact ISO timestamp.`);
  const parsed = new Date(value);
  if (!value || Number.isNaN(parsed.getTime()) || parsed.toISOString() !== value) {
    throw clientError(code, `${label} must be an exact ISO timestamp.`);
  }
  return value;
}

function parseQuantityMicros(value, label, { allowZero = false, code = "invalid-argument" } = {}) {
  if (typeof value !== "string" || !DECIMAL_PATTERN.test(value)) {
    throw clientError(code, `${label} must be a canonical decimal string with at most six places.`);
  }
  const [whole, fraction = ""] = value.split(".");
  const micros = BigInt(whole) * QUANTITY_SCALE + BigInt(fraction.padEnd(6, "0") || "0");
  if ((!allowZero && micros === 0n) || micros > BigInt(Number.MAX_SAFE_INTEGER)) {
    throw clientError(code, `${label} is outside the supported quantity range.`);
  }
  return Number(micros);
}

function formatQuantityMicros(value, label, code = "data-loss") {
  exactSafeInteger(value, label, { code });
  const whole = Math.floor(value / Number(QUANTITY_SCALE));
  const fraction = String(value % Number(QUANTITY_SCALE)).padStart(6, "0").replace(/0+$/u, "");
  return fraction ? `${whole}.${fraction}` : String(whole);
}

function baseUnit(value, label = "baseUnitId", code = "invalid-argument") {
  if (typeof value !== "string" || !Object.hasOwn(INVENTORY_BASE_UNITS, value)) {
    throw clientError(code, `${label} is unsupported.`);
  }
  return value;
}

function canonicalClone(value, label = "Inventory value") {
  const seen = new WeakSet();
  const normalize = (candidate) => {
    if (candidate === null || typeof candidate === "string" || typeof candidate === "boolean") return candidate;
    if (typeof candidate === "number") {
      if (!Number.isSafeInteger(candidate)) throw clientError("invalid-argument", `${label} contains unsafe numeric evidence.`);
      return candidate;
    }
    if (!candidate || typeof candidate !== "object" || seen.has(candidate)) {
      throw clientError("invalid-argument", `${label} must be an acyclic JSON value.`);
    }
    seen.add(candidate);
    if (Array.isArray(candidate)) {
      const result = candidate.map(normalize);
      seen.delete(candidate);
      return result;
    }
    if (!isRecord(candidate)) throw clientError("invalid-argument", `${label} must use plain JSON records.`);
    const result = Object.create(null);
    Object.keys(candidate).sort(compareCodePoints).forEach((key) => {
      if (POISON_KEYS.has(key)) throw clientError("invalid-argument", `${label} contains an unsafe field name.`);
      if (candidate[key] === undefined) throw clientError("invalid-argument", `${label} cannot contain undefined values.`);
      result[key] = normalize(candidate[key]);
    });
    seen.delete(candidate);
    return result;
  };
  const serialized = JSON.stringify(normalize(value));
  const bytes = typeof TextEncoder === "function" ? new TextEncoder().encode(serialized).byteLength : serialized.length;
  if (bytes > MAX_JSON_BYTES) throw clientError("resource-exhausted", `${label} exceeds the bounded authority size.`);
  return JSON.parse(serialized);
}

function canonical(value, label) {
  return JSON.stringify(canonicalClone(value, label));
}

function deepFreeze(value, seen = new WeakSet()) {
  if (!value || typeof value !== "object" || seen.has(value)) return value;
  seen.add(value);
  Reflect.ownKeys(value).forEach((key) => deepFreeze(value[key], seen));
  return Object.freeze(value);
}

function normalizeRole(value) {
  const role = typeof value === "string" ? value.trim().toLowerCase() : "";
  return STAFF_ROLES.has(role) ? role : "customer";
}

export function getInventoryBrowserAccess({
  organizationId = "",
  role = "customer",
  browserEnabled = false,
  tenantEnabled = false
} = {}) {
  let organization = "";
  try {
    organization = identifier(organizationId, "organizationId");
  } catch {
    organization = "";
  }
  const normalizedRole = normalizeRole(role);
  const exactBrowserGate = browserEnabled === true;
  const exactTenantGate = tenantEnabled === true;
  const administrator = normalizedRole === "admin";
  const readEnabled = exactBrowserGate && exactTenantGate && Boolean(organization) && administrator;
  const mutationEnabled = readEnabled;
  let reason = "";
  if (!exactBrowserGate) reason = "Inventory is not enabled in this QuotePilot build.";
  else if (!exactTenantGate) reason = "Inventory is not enabled for this organization.";
  else if (!organization) reason = "Restore the active organization before opening inventory.";
  else if (!administrator) reason = "Inventory is available only to an authorized administrator.";
  return Object.freeze({
    browserEnabled: exactBrowserGate,
    tenantEnabled: exactTenantGate,
    serverEnforced: true,
    organizationId: organization,
    role: normalizedRole,
    readEnabled,
    mutationEnabled,
    reason
  });
}

function requireReadAccess(input) {
  const access = getInventoryBrowserAccess(input);
  if (!access.readEnabled) throw clientError("permission-denied", access.reason || "Inventory read access is unavailable.");
  if (!firebaseReady || !db) throw clientError("failed-precondition", "Inventory requires a connected QuotePilot workspace.");
  return access;
}

function requireMutationAccess(input) {
  const access = getInventoryBrowserAccess(input);
  if (!access.mutationEnabled) throw clientError("permission-denied", access.reason || "Inventory changes require administrator authority.");
  if (!firebaseReady || !cloudFunctions) throw clientError("failed-precondition", "Inventory requires a connected QuotePilot workspace.");
  const uid = auth?.currentUser?.uid;
  if (typeof uid !== "string" || !uid.trim()) {
    throw clientError("unauthenticated", "Restore the signed-in administrator before changing inventory.");
  }
  return { access, uid: identifier(uid.trim(), "signed-in administrator", "unauthenticated") };
}

function normalizeRequestId(value) {
  if (typeof value !== "string" || value !== value.trim() || !REQUEST_ID_PATTERN.test(value)) {
    throw clientError("invalid-argument", "requestId must be an exact cryptographic inventory request identifier.");
  }
  return value;
}

export function buildInventoryRequestId(cryptoProvider = globalThis.crypto) {
  if (typeof cryptoProvider?.getRandomValues !== "function") {
    throw clientError("failed-precondition", "Secure inventory request identity generation is unavailable.");
  }
  const bytes = new Uint8Array(16);
  cryptoProvider.getRandomValues(bytes);
  return `inventory_request_${[...bytes].map((entry) => entry.toString(16).padStart(2, "0")).join("")}`;
}

export function inventoryMoneyInputToMinorUnits(value) {
  if (typeof value !== "string" || value !== value.trim() || !MONEY_INPUT_PATTERN.test(value)) {
    throw clientError("invalid-argument", "Purchase total must be canonical money with at most two decimal places.");
  }
  const [major, fraction = ""] = value.split(".");
  const minor = BigInt(major) * 100n + BigInt(fraction.padEnd(2, "0") || "0");
  if (minor > BigInt(Number.MAX_SAFE_INTEGER)) {
    throw clientError("invalid-argument", "Purchase total exceeds the supported exact money range.");
  }
  return Number(minor);
}

function normalizeLocationCommand(value) {
  exactKeys(value, ["kind", "locationId", "name", "active", "expectedRevision"], "Inventory location command");
  if (value.kind !== "upsert_location") throw clientError("invalid-argument", "Inventory location command is invalid.");
  return {
    kind: value.kind,
    locationId: identifier(value.locationId, "locationId"),
    name: exactText(value.name, "location name", 100),
    active: exactBoolean(value.active, "location active state", "invalid-argument"),
    expectedRevision: exactRevision(value.expectedRevision, "location expected revision")
  };
}

function normalizeIngredientCommand(value) {
  exactKeys(value, ["kind", "ingredientId", "name", "category", "baseUnitId", "active", "expectedRevision"], "Inventory ingredient command");
  if (value.kind !== "upsert_ingredient") throw clientError("invalid-argument", "Inventory ingredient command is invalid.");
  return {
    kind: value.kind,
    ingredientId: identifier(value.ingredientId, "ingredientId"),
    name: exactText(value.name, "ingredient name", 100),
    category: exactText(value.category, "ingredient category", 80),
    baseUnitId: baseUnit(value.baseUnitId),
    active: exactBoolean(value.active, "ingredient active state", "invalid-argument"),
    expectedRevision: exactRevision(value.expectedRevision, "ingredient expected revision")
  };
}

function normalizeOpeningBalanceCommand(value) {
  exactKeys(value, ["kind", "ingredientId", "locationId", "quantity", "baseUnitId", "occurredAtISO", "note", "expectedStockRevision"], "Inventory opening balance command");
  if (value.kind !== "opening_balance") throw clientError("invalid-argument", "Inventory opening balance command is invalid.");
  const quantity = value.quantity;
  parseQuantityMicros(quantity, "opening quantity");
  return {
    kind: value.kind,
    ingredientId: identifier(value.ingredientId, "ingredientId"),
    locationId: identifier(value.locationId, "locationId"),
    quantity,
    baseUnitId: baseUnit(value.baseUnitId),
    occurredAtISO: exactIso(value.occurredAtISO, "opening count effective time", "invalid-argument"),
    note: exactText(value.note, "opening balance note", 240),
    expectedStockRevision: exactRevision(value.expectedStockRevision, "stock expected revision")
  };
}

function normalizeCostCommand(value) {
  if (!isRecord(value) || value.kind !== "record_ingredient_cost" || !COST_AVAILABILITY.has(value.availability)) {
    throw clientError("invalid-argument", "Ingredient cost command is invalid.");
  }
  const common = ["kind", "ingredientId", "baseUnitId", "availability", "sourceLabel", "observedAtISO", "note", "expectedCostRevision"];
  exactKeys(value, value.availability === "available"
    ? [...common, "basisQuantity", "totalCostMinor", "currency"]
    : common, "Ingredient cost command");
  const result = {
    kind: value.kind,
    ingredientId: identifier(value.ingredientId, "ingredientId"),
    baseUnitId: baseUnit(value.baseUnitId),
    availability: value.availability,
    sourceLabel: exactText(value.sourceLabel, "cost source", 120),
    observedAtISO: exactIso(value.observedAtISO, "cost observation time", "invalid-argument"),
    note: exactText(value.note, "cost note", 240, { allowEmpty: true }),
    expectedCostRevision: exactRevision(value.expectedCostRevision, "cost expected revision")
  };
  if (value.availability === "available") {
    parseQuantityMicros(value.basisQuantity, "cost basis quantity");
    result.basisQuantity = value.basisQuantity;
    result.totalCostMinor = exactSafeInteger(value.totalCostMinor, "totalCostMinor", { code: "invalid-argument" });
    if (typeof value.currency !== "string" || !CURRENCY_PATTERN.test(value.currency)) {
      throw clientError("invalid-argument", "currency must be an uppercase ISO code.");
    }
    result.currency = value.currency;
  }
  return result;
}

function normalizeCommand(value) {
  if (!isRecord(value) || typeof value.kind !== "string" || !COMMAND_KINDS.has(value.kind)) {
    throw clientError("invalid-argument", "A supported schema-v2 inventory command is required.");
  }
  if (value.kind === "upsert_location") return deepFreeze(normalizeLocationCommand(value));
  if (value.kind === "upsert_ingredient") return deepFreeze(normalizeIngredientCommand(value));
  if (value.kind === "opening_balance") return deepFreeze(normalizeOpeningBalanceCommand(value));
  return deepFreeze(normalizeCostCommand(value));
}

export function inventoryCommandAxis(kind) {
  if (kind === "upsert_location") return "location";
  if (kind === "upsert_ingredient") return "ingredient";
  if (kind === "opening_balance") return "stock";
  if (kind === "record_ingredient_cost") return "cost";
  return "";
}

function targetIdentity(command) {
  return command.locationId || command.ingredientId || "authority";
}

function normalizeEnvelope(input) {
  const { access, uid } = requireMutationAccess(input);
  const command = normalizeCommand(input.command);
  return {
    uid,
    payload: deepFreeze({
      schemaVersion: INVENTORY_AUTHORITY_SCHEMA_VERSION,
      organizationId: access.organizationId,
      requestId: normalizeRequestId(input.requestId || buildInventoryRequestId()),
      command
    })
  };
}

function attemptKey(payload, uid) {
  return [payload.organizationId, uid, payload.command.kind, targetIdentity(payload.command)].join("\u0000");
}

function beginAttempt(input) {
  const { uid, payload } = normalizeEnvelope(input);
  const key = attemptKey(payload, uid);
  const current = pendingAttempts.get(key);
  const fingerprint = canonical(payload, "Inventory request");
  if (!current && pendingAttempts.size >= MAX_PENDING_ATTEMPTS) {
    throw clientError("resource-exhausted", "Resolve an earlier inventory request before starting another one.");
  }
  if (current?.definitive) {
    throw clientError("failed-precondition", "Review and reset the definitively rejected request before starting another one.");
  }
  if (current && (current.payload.requestId !== payload.requestId || current.fingerprint !== fingerprint)) {
    throw clientError("failed-precondition", "Reconcile the unresolved inventory request without changing its identity or contents.");
  }
  const attempt = {
    key,
    uid,
    payload,
    fingerprint,
    definitive: false,
    state: current ? "reconciliation" : "submitting",
    error: ""
  };
  pendingAttempts.set(key, attempt);
  return attempt;
}

function normalizedErrorCode(error) {
  const value = typeof error?.code === "string" ? error.code.trim().toLowerCase() : "";
  return value.includes("/") ? value.slice(value.lastIndexOf("/") + 1) : value;
}

const DEFINITIVE_ERROR_CODES = new Set([
  "aborted",
  "already-exists",
  "data-loss",
  "failed-precondition",
  "invalid-argument",
  "not-found",
  "permission-denied",
  "resource-exhausted",
  "unauthenticated"
]);

export function isDefinitiveInventoryError(error) {
  if (typeof error?.inventoryDefinitive === "boolean") return error.inventoryDefinitive;
  return DEFINITIVE_ERROR_CODES.has(normalizedErrorCode(error));
}

function markAttemptError(attempt, error) {
  const current = pendingAttempts.get(attempt.key);
  if (!current || current.uid !== attempt.uid || current.payload.requestId !== attempt.payload.requestId) return;
  const definitive = isDefinitiveInventoryError(error);
  pendingAttempts.set(attempt.key, {
    ...current,
    definitive,
    state: definitive ? "error" : "uncertain",
    error: String(error?.message || "Inventory did not return a verified receipt.").trim().slice(0, 240)
  });
}

function normalizeReceipt(value, attempt) {
  exactKeys(value, ["schemaVersion", "organizationId", "receiptId", "requestId", "commandKind", "recordedAtISO"], "Inventory receipt", "data-loss");
  if (
    value.schemaVersion !== INVENTORY_AUTHORITY_SCHEMA_VERSION
    || value.organizationId !== attempt.payload.organizationId
    || value.requestId !== attempt.payload.requestId
    || value.commandKind !== attempt.payload.command.kind
    || !RECEIPT_ID_PATTERN.test(value.receiptId)
  ) {
    throw clientError("data-loss", "Inventory receipt identity differs from the exact request.");
  }
  return {
    schemaVersion: value.schemaVersion,
    organizationId: value.organizationId,
    receiptId: value.receiptId,
    requestId: value.requestId,
    commandKind: value.commandKind,
    recordedAtISO: exactIso(value.recordedAtISO, "inventory receipt time")
  };
}

function normalizeMutationResult(value, attempt, receipt) {
  const command = attempt.payload.command;
  if (command.kind === "upsert_location") {
    exactKeys(value, ["schemaVersion", "locationId", "name", "active", "revision", "updatedAtISO"], "Inventory location result", "data-loss");
    if (value.schemaVersion !== INVENTORY_AUTHORITY_SCHEMA_VERSION
      || value.locationId !== command.locationId
      || value.name !== command.name
      || value.active !== command.active
      || value.revision !== command.expectedRevision + 1
      || value.updatedAtISO !== receipt.recordedAtISO) {
      throw clientError("data-loss", "Inventory location result differs from the exact request.");
    }
    return { ...value };
  }
  if (command.kind === "upsert_ingredient") {
    exactKeys(value, ["schemaVersion", "ingredientId", "revision", "baseUnitId", "active"], "Inventory ingredient result", "data-loss");
    if (value.schemaVersion !== INVENTORY_AUTHORITY_SCHEMA_VERSION
      || value.ingredientId !== command.ingredientId
      || value.revision !== command.expectedRevision + 1
      || value.baseUnitId !== command.baseUnitId
      || value.active !== command.active) {
      throw clientError("data-loss", "Inventory ingredient result differs from the exact request.");
    }
    return { ...value };
  }
  if (command.kind === "opening_balance") {
    exactKeys(value, ["schemaVersion", "ingredientId", "locationId", "movementId", "stockRevision", "onHandMicros", "onHandQuantity"], "Inventory opening result", "data-loss");
    const expectedMicros = parseQuantityMicros(command.quantity, "requested opening quantity");
    if (value.schemaVersion !== INVENTORY_AUTHORITY_SCHEMA_VERSION
      || value.ingredientId !== command.ingredientId
      || value.locationId !== command.locationId
      || !MOVEMENT_ID_PATTERN.test(value.movementId)
      || value.stockRevision !== command.expectedStockRevision + 1
      || value.onHandMicros !== expectedMicros
      || value.onHandQuantity !== command.quantity) {
      throw clientError("data-loss", "Inventory opening result differs from the exact request.");
    }
    return { ...value };
  }
  exactKeys(value, ["schemaVersion", "ingredientId", "costEvidenceId", "costRevision", "availability"], "Inventory cost result", "data-loss");
  if (value.schemaVersion !== INVENTORY_AUTHORITY_SCHEMA_VERSION
    || value.ingredientId !== command.ingredientId
    || !COST_EVIDENCE_ID_PATTERN.test(value.costEvidenceId)
    || value.costRevision !== command.expectedCostRevision + 1
    || value.availability !== command.availability) {
    throw clientError("data-loss", "Inventory cost result differs from the exact request.");
  }
  return { ...value };
}

function normalizeCommandResult(value, attempt) {
  exactKeys(value, ["ok", "schemaVersion", "organizationId", "commandKind", "idempotent", "receipt", "result"], "Inventory command result", "data-loss");
  if (
    value.ok !== true
    || value.schemaVersion !== INVENTORY_AUTHORITY_SCHEMA_VERSION
    || value.organizationId !== attempt.payload.organizationId
    || value.commandKind !== attempt.payload.command.kind
  ) {
    throw clientError("data-loss", "Inventory command result crossed its authority boundary.");
  }
  const receipt = normalizeReceipt(value.receipt, attempt);
  const confirmation = normalizeMutationResult(value.result, attempt, receipt);
  return deepFreeze({
    ok: true,
    schemaVersion: INVENTORY_AUTHORITY_SCHEMA_VERSION,
    organizationId: value.organizationId,
    commandKind: value.commandKind,
    idempotent: exactBoolean(value.idempotent, "inventory result idempotency"),
    confirmation: deepFreeze(confirmation),
    receipt: deepFreeze(receipt),
    mutationMode: attempt.state
  });
}

function normalizeResultOrUncertain(value, attempt) {
  try {
    return normalizeCommandResult(value, attempt);
  } catch (error) {
    throw clientError("unknown", error?.message || "Inventory did not return exact result evidence.", false);
  }
}

async function executeAttempt(attempt) {
  try {
    const call = httpsCallable(cloudFunctions, INVENTORY_AUTHORITY_CALLABLES.applyCommand);
    const response = await call(canonicalClone(attempt.payload, "Inventory callable request"));
    const result = normalizeResultOrUncertain(response?.data, attempt);
    pendingAttempts.delete(attempt.key);
    return result;
  } catch (error) {
    markAttemptError(attempt, error);
    throw error;
  }
}

export async function applyInventoryCommand(input = {}) {
  return executeAttempt(beginAttempt(input));
}

function pendingForScope(input) {
  const { access, uid } = requireMutationAccess(input);
  return { organizationId: access.organizationId, uid };
}

export function readPendingInventoryCommands(input = {}) {
  const scope = pendingForScope(input);
  return deepFreeze([...pendingAttempts.values()]
    .filter((attempt) => attempt.payload.organizationId === scope.organizationId && attempt.uid === scope.uid)
    .sort((left, right) => compareCodePoints(left.payload.requestId, right.payload.requestId))
    .map((attempt) => ({
      requestId: attempt.payload.requestId,
      commandKind: attempt.payload.command.kind,
      targetId: targetIdentity(attempt.payload.command),
      command: canonicalClone(attempt.payload.command, "Pending inventory command"),
      state: attempt.state,
      error: attempt.error,
      definitive: attempt.definitive
    })));
}

function findAttempt(input, { required = true } = {}) {
  const scope = pendingForScope(input);
  const requestId = normalizeRequestId(input.requestId);
  const matches = [...pendingAttempts.values()].filter((attempt) => (
    attempt.payload.organizationId === scope.organizationId
    && attempt.uid === scope.uid
    && attempt.payload.requestId === requestId
  ));
  if (matches.length !== 1) {
    if (!required && matches.length === 0) return null;
    throw clientError("failed-precondition", "There is no exact unresolved inventory request to reconcile.");
  }
  return matches[0];
}

export async function reconcileInventoryCommand(input = {}) {
  const current = findAttempt(input);
  if (current.definitive) {
    throw clientError("failed-precondition", "This inventory request was definitively rejected and cannot be reconciled.");
  }
  const next = { ...current, state: "reconciliation", error: "" };
  pendingAttempts.set(current.key, next);
  return executeAttempt(next);
}

export function resetDefinitiveInventoryCommand(input = {}) {
  const current = findAttempt(input, { required: false });
  if (!current) return false;
  if (!current.definitive) return false;
  pendingAttempts.delete(current.key);
  return true;
}

function sourceState(metadata) {
  if (metadata?.hasPendingWrites === true) return "pending";
  if (metadata?.fromCache === true) return "cached";
  return "current";
}

function normalizeLocationProjection(value, index) {
  const label = `Inventory workspace location ${index + 1}`;
  exactKeys(value, ["locationId", "name", "active", "revision"], label, "data-loss");
  return {
    locationId: identifier(value.locationId, `${label} identity`, "data-loss"),
    name: exactText(value.name, `${label} name`, 100, { code: "data-loss" }),
    active: exactBoolean(value.active, `${label} active state`),
    revision: exactRevision(value.revision, `${label} revision`, { allowZero: false, code: "data-loss" })
  };
}

export function normalizeInventoryWorkspaceProjection(value, expectedOrganizationId, expectedDocumentId = "current") {
  exactKeys(value, ["authorityVersion", "schemaVersion", "model", "organizationId", "projectionId", "workspaceRevision", "locations", "updatedAtISO"], "Inventory workspace projection", "data-loss");
  const organizationId = identifier(expectedOrganizationId, "expected organizationId");
  if (
    value.authorityVersion !== INVENTORY_AUTHORITY_VERSION
    || value.schemaVersion !== INVENTORY_AUTHORITY_SCHEMA_VERSION
    || value.model !== "inventory-workspace-projection-v2"
    || value.organizationId !== organizationId
    || value.projectionId !== expectedDocumentId
    || !Array.isArray(value.locations)
    || value.locations.length > INVENTORY_INGREDIENT_PROJECTION_LIMIT
  ) {
    throw clientError("data-loss", "Inventory workspace projection has an invalid authority scope.");
  }
  const locations = value.locations.map(normalizeLocationProjection);
  if (new Set(locations.map((entry) => entry.locationId)).size !== locations.length) {
    throw clientError("data-loss", "Inventory workspace projection contains duplicate locations.");
  }
  return deepFreeze({
    authorityVersion: INVENTORY_AUTHORITY_VERSION,
    schemaVersion: INVENTORY_AUTHORITY_SCHEMA_VERSION,
    model: value.model,
    organizationId,
    projectionId: value.projectionId,
    workspaceRevision: exactRevision(value.workspaceRevision, "workspace projection revision", { allowZero: false, code: "data-loss" }),
    locations,
    updatedAtISO: exactIso(value.updatedAtISO, "workspace projection update time")
  });
}

function normalizeStockProjection(value, ingredient) {
  exactKeys(value, ["availability", "stockRevision", "onHandMicros", "quantity", "locationId", "lastMovementId"], "Ingredient stock projection", "data-loss");
  if (!["current", "not_yet_available"].includes(value.availability)) {
    throw clientError("data-loss", "Ingredient stock projection availability is invalid.");
  }
  const revision = exactRevision(value.stockRevision, "stock projection revision", { code: "data-loss" });
  const onHandMicros = exactSafeInteger(value.onHandMicros, "stock on-hand micros");
  const quantity = formatQuantityMicros(onHandMicros, "stock on-hand micros");
  if (value.quantity !== quantity) throw clientError("data-loss", "Ingredient stock projection quantity contradicts its fixed-point evidence.");
  if (value.availability === "not_yet_available") {
    if (revision !== 0 || onHandMicros !== 0 || value.locationId !== "" || value.lastMovementId !== "") {
      throw clientError("data-loss", "Unavailable stock projection contains invented physical evidence.");
    }
  } else if (revision < 1 || !MOVEMENT_ID_PATTERN.test(value.lastMovementId)) {
    throw clientError("data-loss", "Current stock projection lacks movement evidence.");
  }
  return {
    state: value.availability === "current" ? "recorded" : "not_recorded",
    availability: value.availability,
    revision,
    onHandMicros,
    quantity,
    unit: ingredient.baseUnitId,
    locationId: value.availability === "current" ? identifier(value.locationId, "stock location", "data-loss") : "",
    lastMovementId: value.lastMovementId
  };
}

function normalizeCostProjection(value, ingredient) {
  const common = ["availability", "costRevision", "sourceLabel", "observedAtISO", "lastCostEvidenceId"];
  if (!isRecord(value) || !COST_AVAILABILITY.has(value.availability)) {
    throw clientError("data-loss", "Ingredient cost projection availability is invalid.");
  }
  exactKeys(value, value.availability === "available"
    ? [...common, "basisQuantityMicros", "totalCostMinor", "currency"]
    : common, "Ingredient cost projection", "data-loss");
  const revision = exactRevision(value.costRevision, "cost projection revision", { code: "data-loss" });
  if (revision === 0) {
    if (value.availability !== "not_yet_available" || value.sourceLabel !== "" || value.observedAtISO !== "" || value.lastCostEvidenceId !== "") {
      throw clientError("data-loss", "Unrecorded cost projection contains invented evidence.");
    }
    return {
      state: "not_recorded",
      availability: value.availability,
      revision,
      sourceLabel: "",
      observedAtISO: "",
      lastCostEvidenceId: ""
    };
  }
  const result = {
    state: value.availability === "available" ? "recorded" : value.availability,
    availability: value.availability,
    revision,
    sourceLabel: exactText(value.sourceLabel, "cost projection source", 120, { code: "data-loss" }),
    observedAtISO: exactIso(value.observedAtISO, "cost projection observation time"),
    lastCostEvidenceId: COST_EVIDENCE_ID_PATTERN.test(value.lastCostEvidenceId)
      ? value.lastCostEvidenceId
      : (() => { throw clientError("data-loss", "Cost projection evidence identity is invalid."); })()
  };
  if (value.availability === "available") {
    const basisQuantityMicros = exactSafeInteger(value.basisQuantityMicros, "cost basis quantity micros", { minimum: 1 });
    result.basisQuantityMicros = basisQuantityMicros;
    result.basisQuantity = formatQuantityMicros(basisQuantityMicros, "cost basis quantity micros");
    result.basisUnit = ingredient.baseUnitId;
    result.totalMinorUnits = exactSafeInteger(value.totalCostMinor, "recorded total cost minor");
    if (typeof value.currency !== "string" || !CURRENCY_PATTERN.test(value.currency)) {
      throw clientError("data-loss", "Recorded cost currency is invalid.");
    }
    result.currency = value.currency;
  }
  return result;
}

export function normalizeInventoryIngredientProjection(value, expectedOrganizationId, expectedDocumentId) {
  exactKeys(value, [
    "authorityVersion", "schemaVersion", "model", "organizationId", "ingredientId", "name", "nameSortKey",
    "category", "baseUnitId", "dimension", "active", "ingredientRevision", "stock", "cost", "updatedAtISO"
  ], "Inventory ingredient projection", "data-loss");
  const organizationId = identifier(expectedOrganizationId, "expected organizationId");
  const ingredientId = identifier(value.ingredientId, "ingredient projection identity", "data-loss");
  const unit = baseUnit(value.baseUnitId, "ingredient base unit", "data-loss");
  const name = exactText(value.name, "ingredient projection name", 100, { code: "data-loss" });
  if (
    value.authorityVersion !== INVENTORY_AUTHORITY_VERSION
    || value.schemaVersion !== INVENTORY_AUTHORITY_SCHEMA_VERSION
    || value.model !== "inventory-ingredient-projection-v2"
    || value.organizationId !== organizationId
    || ingredientId !== expectedDocumentId
    || value.nameSortKey !== name.toLocaleLowerCase("en-US")
    || value.dimension !== INVENTORY_BASE_UNITS[unit]
  ) {
    throw clientError("data-loss", "Inventory ingredient projection is internally inconsistent.");
  }
  const ingredient = {
    authorityVersion: INVENTORY_AUTHORITY_VERSION,
    schemaVersion: INVENTORY_AUTHORITY_SCHEMA_VERSION,
    model: value.model,
    organizationId,
    ingredientId,
    name,
    nameSortKey: value.nameSortKey,
    category: exactText(value.category, "ingredient projection category", 80, { code: "data-loss" }),
    baseUnitId: unit,
    dimension: value.dimension,
    active: exactBoolean(value.active, "ingredient projection active state"),
    ingredientRevision: exactRevision(value.ingredientRevision, "ingredient projection revision", { allowZero: false, code: "data-loss" })
  };
  ingredient.itemRevision = ingredient.ingredientRevision;
  ingredient.stock = normalizeStockProjection(value.stock, ingredient);
  ingredient.cost = normalizeCostProjection(value.cost, ingredient);
  ingredient.updatedAtISO = exactIso(value.updatedAtISO, "ingredient projection update time");
  ingredient.locationId = ingredient.stock.locationId;
  return deepFreeze(ingredient);
}

function combinedFreshness(sources) {
  const states = [sources.workspace.state, sources.ingredients.state];
  if (states.includes("pending")) return "pending";
  if (states.includes("unavailable")) return "unavailable";
  if (states.includes("loading")) return "loading";
  if (states.includes("cached")) return "cached";
  return "current";
}

function projectionModel(scope, state) {
  const locationById = new Map((state.workspace?.locations || []).map((entry) => [entry.locationId, entry.name]));
  if (state.sources.workspace.state === "current" && state.sources.ingredients.state === "current"
    && state.ingredients.some((entry) => entry.stock.state === "recorded" && !locationById.has(entry.stock.locationId))) {
    throw clientError("data-loss", "Ingredient stock projection references an unprojected location.");
  }
  const ingredients = state.ingredients.map((entry) => deepFreeze({
    ...entry,
    locationName: entry.locationId ? locationById.get(entry.locationId) || "" : ""
  }));
  return deepFreeze({
    schemaVersion: INVENTORY_AUTHORITY_SCHEMA_VERSION,
    organizationId: scope.organizationId,
    workspace: state.workspace,
    ingredients,
    sources: {
      workspace: { ...state.sources.workspace },
      ingredients: { ...state.sources.ingredients }
    },
    freshness: combinedFreshness(state.sources),
    bounded: state.bounded
  });
}

export function subscribeToInventoryIngredientProjections(input = {}) {
  const access = requireReadAccess(input);
  if (typeof input.onData !== "function") throw clientError("invalid-argument", "Inventory projection listener requires onData.");
  const scope = { organizationId: access.organizationId };
  let active = true;
  let workspaceUnsubscribe = null;
  let ingredientsUnsubscribe = null;
  const state = {
    workspace: null,
    ingredients: [],
    bounded: false,
    sources: {
      workspace: { state: "loading", fromCache: false, hasPendingWrites: false },
      ingredients: { state: "loading", fromCache: false, hasPendingWrites: false }
    }
  };
  const emit = () => {
    if (active) input.onData(projectionModel(scope, state));
  };
  const fail = (source) => () => {
    if (!active) return;
    state.sources[source] = { state: "unavailable", fromCache: false, hasPendingWrites: false };
    const model = projectionModel(scope, state);
    input.onError?.(Object.freeze({
      code: "inventory-projections-unavailable",
      message: `${source === "workspace" ? "Location" : "Ingredient"} projection updates are unavailable.`,
      source,
      model
    }));
  };

  const workspaceRef = doc(db, "organizations", scope.organizationId, "inventoryWorkspaceProjections", "current");
  const ingredientQuery = query(
    collection(db, "organizations", scope.organizationId, "inventoryIngredientProjections"),
    orderBy("nameSortKey", "asc"),
    limit(INVENTORY_INGREDIENT_PROJECTION_LIMIT)
  );
  try {
    workspaceUnsubscribe = onSnapshot(workspaceRef, { includeMetadataChanges: true }, (snapshot) => {
      if (!active) return;
      try {
        const metadata = snapshot?.metadata || {};
        state.sources.workspace = {
          state: sourceState(metadata),
          fromCache: metadata.fromCache === true,
          hasPendingWrites: metadata.hasPendingWrites === true
        };
        state.workspace = snapshot?.exists?.() === true
          ? normalizeInventoryWorkspaceProjection(snapshot.data(), scope.organizationId, snapshot.id)
          : null;
        emit();
      } catch {
        fail("workspace")();
      }
    }, fail("workspace"));
    ingredientsUnsubscribe = onSnapshot(ingredientQuery, { includeMetadataChanges: true }, (snapshot) => {
      if (!active) return;
      try {
        if (!Array.isArray(snapshot?.docs) || snapshot.docs.length > INVENTORY_INGREDIENT_PROJECTION_LIMIT) {
          throw clientError("data-loss", "Ingredient projection query exceeded its bounded contract.");
        }
        const ingredients = snapshot.docs.map((entry) => normalizeInventoryIngredientProjection(entry.data(), scope.organizationId, entry.id));
        const sortKeys = ingredients.map((entry) => entry.nameSortKey);
        if (sortKeys.some((key, index) => index > 0 && compareCodePoints(sortKeys[index - 1], key) > 0)
          || new Set(ingredients.map((entry) => entry.ingredientId)).size !== ingredients.length) {
          throw clientError("data-loss", "Ingredient projection query is not a stable ordered set.");
        }
        const metadata = snapshot?.metadata || {};
        state.sources.ingredients = {
          state: sourceState(metadata),
          fromCache: metadata.fromCache === true,
          hasPendingWrites: metadata.hasPendingWrites === true
        };
        state.ingredients = ingredients;
        state.bounded = ingredients.length === INVENTORY_INGREDIENT_PROJECTION_LIMIT;
        emit();
      } catch {
        fail("ingredients")();
      }
    }, fail("ingredients"));
  } catch (error) {
    active = false;
    if (typeof workspaceUnsubscribe === "function") workspaceUnsubscribe();
    if (typeof ingredientsUnsubscribe === "function") ingredientsUnsubscribe();
    throw error;
  }
  return () => {
    if (!active) return;
    active = false;
    if (typeof workspaceUnsubscribe === "function") workspaceUnsubscribe();
    if (typeof ingredientsUnsubscribe === "function") ingredientsUnsubscribe();
  };
}

export function inventoryProjectionConfirmsReceipt(model, attempt) {
  const receipt = attempt?.receipt;
  const result = attempt?.confirmation;
  if (!isRecord(model) || !isRecord(receipt) || model.organizationId !== receipt.organizationId || model.freshness !== "current") return false;
  const commandKind = receipt.commandKind;
  if (!isRecord(result)) return false;
  if (commandKind === "upsert_location") {
    return model.workspace?.locations.some((entry) => entry.locationId === result.locationId && entry.revision === result.revision) === true;
  }
  const ingredient = model.ingredients.find((entry) => entry.ingredientId === result.ingredientId);
  if (!ingredient) return false;
  if (commandKind === "upsert_ingredient") return ingredient.ingredientRevision === result.revision;
  if (commandKind === "opening_balance") return ingredient.stock.revision === result.stockRevision && ingredient.stock.lastMovementId === result.movementId;
  if (commandKind === "record_ingredient_cost") return ingredient.cost.revision === result.costRevision && ingredient.cost.lastCostEvidenceId === result.costEvidenceId;
  return false;
}
