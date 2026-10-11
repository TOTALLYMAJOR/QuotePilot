import { collection, doc, documentId, limit, onSnapshot, orderBy, query, startAfter } from "firebase/firestore";
import { httpsCallable } from "firebase/functions";
import { auth, cloudFunctions, db, firebaseReady } from "./firebase";

export const INVENTORY_AUTHORITY_SCHEMA_VERSION = 2;
export const INVENTORY_AUTHORITY_VERSION = "inventory-ingredient-authority-v2";
export const INVENTORY_INGREDIENT_PROJECTION_LIMIT = 200;
export const INVENTORY_INGREDIENT_TRACE_LIMIT = 25;
export const INVENTORY_MENU_COST_PROJECTION_LIMIT = 200;
export const INVENTORY_MAX_PUBLISHED_RECIPE_LINES = 50;
export const INVENTORY_AUTHORITY_CALLABLES = Object.freeze({
  applyCommand: "applyInventoryCommand",
  readWorkspace: "getInventoryWorkspace",
  previewEvent: "previewEventInventory"
});
export const INVENTORY_EVENT_SELECTION_LIMIT = 100;
export const INVENTORY_COMMAND_KINDS = Object.freeze([
  "upsert_location",
  "upsert_ingredient",
  "opening_balance",
  "receive_stock",
  "record_ingredient_cost",
  "publish_pack_conversion",
  "publish_menu_recipe",
  "compile_event_ingredient_demand",
  "allocate_event_ingredients",
  "release_event_ingredients",
  "reconcile_event_ingredients",
  "record_event_ingredient_execution",
  "correct_event_ingredient_execution"
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
const RECIPE_REVISION_ID_PATTERN = /^irr_[a-f0-9]{48}$/u;
const PACK_CONVERSION_REVISION_ID_PATTERN = /^ipc_[a-f0-9]{48}$/u;
const EVENT_REQUIREMENT_REVISION_ID_PATTERN = /^eir_[a-f0-9]{48}$/u;
const EVENT_PLAN_ID_PATTERN = /^eip_[a-f0-9]{48}$/u;
const EVENT_EXECUTION_REVISION_ID_PATTERN = /^eiex_[a-f0-9]{48}$/u;
const SHA256_PATTERN = /^[a-f0-9]{64}$/u;
const DECIMAL_PATTERN = /^(0|[1-9]\d*)(?:\.(\d{1,6}))?$/u;
const MONEY_INPUT_PATTERN = /^(0|[1-9]\d*)(?:\.(\d{1,2}))?$/u;
const CURRENCY_PATTERN = /^[A-Z]{3}$/u;
const MAX_REVISION = 1_000_000_000;
const MAX_JSON_BYTES = 262_144;
const MAX_PENDING_ATTEMPTS = 32;
const PENDING_SESSION_STORAGE_KEY = "quotepilot.inventory.pending.v1";
const QUANTITY_SCALE = 1_000_000n;
const pendingAttempts = new Map();

function pendingSessionStorage() {
  try {
    return typeof globalThis.sessionStorage?.getItem === "function"
      && typeof globalThis.sessionStorage?.setItem === "function"
      ? globalThis.sessionStorage
      : null;
  } catch {
    return null;
  }
}

function storedPendingRecords() {
  const storage = pendingSessionStorage();
  if (!storage) return [];
  try {
    const parsed = JSON.parse(storage.getItem(PENDING_SESSION_STORAGE_KEY) || "[]");
    return Array.isArray(parsed) ? parsed : [];
  } catch {
    return [];
  }
}

function writeStoredPendingRecords(records) {
  const storage = pendingSessionStorage();
  if (!storage) return;
  try {
    if (records.length) {
      storage.setItem(PENDING_SESSION_STORAGE_KEY, JSON.stringify(records.slice(-MAX_PENDING_ATTEMPTS)));
    } else {
      storage.removeItem(PENDING_SESSION_STORAGE_KEY);
    }
  } catch {
    // Session recovery is best-effort; callable authority remains unchanged.
  }
}

function persistPendingAttempt(attempt) {
  const nextRecord = {
    schemaVersion: 1,
    uid: attempt.uid,
    payload: canonicalClone(attempt.payload, "Pending inventory request"),
    state: attempt.state,
    error: String(attempt.error || "").slice(0, 240),
    definitive: attempt.definitive === true
  };
  const records = storedPendingRecords().filter((record) => (
    record?.uid !== attempt.uid
    || record?.payload?.organizationId !== attempt.payload.organizationId
    || record?.payload?.requestId !== attempt.payload.requestId
  ));
  writeStoredPendingRecords([...records, nextRecord]);
}

function removeStoredPendingAttempt(attempt) {
  writeStoredPendingRecords(storedPendingRecords().filter((record) => (
    record?.uid !== attempt.uid
    || record?.payload?.organizationId !== attempt.payload.organizationId
    || record?.payload?.requestId !== attempt.payload.requestId
  )));
}

function hydratePendingAttempts(input, scope) {
  storedPendingRecords().forEach((record) => {
    if (!isRecord(record) || record.schemaVersion !== 1 || record.uid !== scope.uid) return;
    if (!isRecord(record.payload) || record.payload.organizationId !== scope.organizationId) return;
    try {
      const { uid, payload } = normalizeEnvelope({
        ...input,
        organizationId: scope.organizationId,
        requestId: record.payload.requestId,
        command: record.payload.command
      });
      if (uid !== scope.uid || canonical(payload, "Inventory request") !== canonical(record.payload, "Pending inventory request")) return;
      const key = attemptKey(payload, uid);
      if (pendingAttempts.has(key)) return;
      pendingAttempts.set(key, {
        key,
        uid,
        payload,
        fingerprint: canonical(payload, "Inventory request"),
        definitive: record.definitive === true,
        state: record.definitive === true ? "error" : "uncertain",
        error: String(record.error || "This exact inventory request was restored after a refresh and needs reconciliation.").slice(0, 240)
      });
    } catch {
      // Ignore malformed, stale, cross-scope, or no-longer-valid records.
    }
  });
}

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

function ingredientPageCursor(value) {
  if (value === null || value === undefined) return null;
  exactKeys(value, ["nameSortKey", "ingredientId"], "Inventory ingredient page cursor");
  return Object.freeze({
    nameSortKey: exactText(value.nameSortKey, "Inventory ingredient cursor sort key", 100),
    ingredientId: identifier(value.ingredientId, "Inventory ingredient cursor identity")
  });
}

function ingredientTraceCursor(value, code = "invalid-argument") {
  if (value === null || value === undefined) return null;
  exactKeys(value, ["recordedAtISO", "movementId"], "Ingredient movement page cursor", code);
  if (!MOVEMENT_ID_PATTERN.test(value.movementId)) {
    throw clientError(code, "Ingredient movement cursor identity is invalid.");
  }
  return Object.freeze({
    recordedAtISO: exactIso(value.recordedAtISO, "ingredient movement cursor time", code),
    movementId: value.movementId
  });
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

export function getInventoryMenuCostBrowserAccess({
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
  const readEnabled = browserEnabled === true && tenantEnabled === true
    && Boolean(organization) && STAFF_ROLES.has(normalizedRole);
  let reason = "";
  if (browserEnabled !== true) reason = "Ingredient costing is not enabled in this QuotePilot build.";
  else if (tenantEnabled !== true) reason = "Ingredient costing is not enabled for this organization.";
  else if (!organization) reason = "Restore the active organization before reading ingredient costs.";
  else if (!STAFF_ROLES.has(normalizedRole)) reason = "Ingredient cost intelligence is available only to authorized staff.";
  return Object.freeze({
    browserEnabled: browserEnabled === true,
    tenantEnabled: tenantEnabled === true,
    serverEnforced: true,
    organizationId: organization,
    role: normalizedRole,
    readEnabled,
    mutationEnabled: readEnabled && normalizedRole === "admin",
    reason
  });
}

function requireReadAccess(input) {
  const access = getInventoryBrowserAccess(input);
  if (!access.readEnabled) throw clientError("permission-denied", access.reason || "Inventory read access is unavailable.");
  if (!firebaseReady || !db) throw clientError("failed-precondition", "Inventory requires a connected QuotePilot workspace.");
  return access;
}

function requireMenuCostReadAccess(input) {
  const access = getInventoryMenuCostBrowserAccess(input);
  if (!access.readEnabled) throw clientError("permission-denied", access.reason || "Ingredient cost intelligence is unavailable.");
  if (!firebaseReady || !db) throw clientError("failed-precondition", "Ingredient costing requires a connected QuotePilot workspace.");
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

function requireAuthorityReadAccess(input) {
  const access = getInventoryBrowserAccess(input);
  if (!access.readEnabled) throw clientError("permission-denied", access.reason || "Inventory read access is unavailable.");
  if (!firebaseReady || !cloudFunctions) {
    throw clientError("failed-precondition", "Inventory trace requires a connected QuotePilot workspace.");
  }
  const uid = auth?.currentUser?.uid;
  if (typeof uid !== "string" || !uid.trim()) {
    throw clientError("unauthenticated", "Restore the signed-in administrator before reading inventory trace evidence.");
  }
  return { access, uid: identifier(uid.trim(), "signed-in administrator", "unauthenticated") };
}

function requirePreviewAccess(input) {
  const access = getInventoryMenuCostBrowserAccess(input);
  if (!access.readEnabled) {
    throw clientError("permission-denied", access.reason || "Event ingredient preview is unavailable.");
  }
  if (!firebaseReady || !cloudFunctions) {
    throw clientError("failed-precondition", "Event ingredient preview requires a connected QuotePilot workspace.");
  }
  const uid = auth?.currentUser?.uid;
  if (typeof uid !== "string" || !uid.trim()) {
    throw clientError("unauthenticated", "Restore the signed-in staff session before previewing event ingredients.");
  }
  return { access, uid: identifier(uid.trim(), "signed-in staff member", "unauthenticated") };
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

function normalizeReceivingCost(value) {
  if (!isRecord(value) || !COST_AVAILABILITY.has(value.availability)) {
    throw clientError("invalid-argument", "Receiving cost evidence state is invalid.");
  }
  exactKeys(value, value.availability === "available"
    ? ["availability", "totalCostMinor", "currency"]
    : ["availability"], "Receiving cost evidence");
  if (value.availability !== "available") return { availability: value.availability };
  if (typeof value.currency !== "string" || !CURRENCY_PATTERN.test(value.currency)) {
    throw clientError("invalid-argument", "Receiving currency must be an uppercase ISO code.");
  }
  return {
    availability: value.availability,
    totalCostMinor: exactSafeInteger(value.totalCostMinor, "receiving totalCostMinor", { code: "invalid-argument" }),
    currency: value.currency
  };
}

function normalizeReceiveStockCommand(value) {
  exactKeys(value, [
    "kind", "ingredientId", "locationId", "quantity", "baseUnitId", "occurredAtISO",
    "sourceLabel", "note", "expectedStockRevision", "expectedCostRevision", "cost"
  ], "Ingredient receiving command");
  if (value.kind !== "receive_stock") throw clientError("invalid-argument", "Ingredient receiving command is invalid.");
  parseQuantityMicros(value.quantity, "received quantity");
  return {
    kind: value.kind,
    ingredientId: identifier(value.ingredientId, "ingredientId"),
    locationId: identifier(value.locationId, "locationId"),
    quantity: value.quantity,
    baseUnitId: baseUnit(value.baseUnitId),
    occurredAtISO: exactIso(value.occurredAtISO, "receiving effective time", "invalid-argument"),
    sourceLabel: exactText(value.sourceLabel, "receiving source", 120),
    note: exactText(value.note, "receiving note", 240, { allowEmpty: true }),
    expectedStockRevision: exactRevision(value.expectedStockRevision, "receiving stock expected revision"),
    expectedCostRevision: exactRevision(value.expectedCostRevision, "receiving cost expected revision"),
    cost: normalizeReceivingCost(value.cost)
  };
}

function normalizeCostCommand(value) {
  if (!isRecord(value) || value.kind !== "record_ingredient_cost" || !COST_AVAILABILITY.has(value.availability)) {
    throw clientError("invalid-argument", "Ingredient cost command is invalid.");
  }
  const common = ["kind", "ingredientId", "baseUnitId", "availability", "sourceLabel", "observedAtISO", "note", "expectedCostRevision"];
  if (Object.hasOwn(value, "dependencyPreflightDigest")) common.push("dependencyPreflightDigest");
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
  if (Object.hasOwn(value, "dependencyPreflightDigest")) {
    if (!SHA256_PATTERN.test(value.dependencyPreflightDigest || "")) {
      throw clientError("invalid-argument", "Ingredient cost evidence requires a reviewed dependency preflight digest.");
    }
    result.dependencyPreflightDigest = value.dependencyPreflightDigest;
  }
  return result;
}

function normalizePackConversionCommand(value) {
  exactKeys(value, [
    "kind", "ingredientId", "packUnitId", "packLabel", "baseUnitId", "baseQuantity",
    "sourceLabel", "expectedRevision"
  ], "Ingredient pack conversion command");
  if (value.kind !== "publish_pack_conversion") {
    throw clientError("invalid-argument", "Ingredient pack conversion command is invalid.");
  }
  parseQuantityMicros(value.baseQuantity, "pack base quantity");
  return {
    kind: value.kind,
    ingredientId: identifier(value.ingredientId, "ingredientId"),
    packUnitId: identifier(value.packUnitId, "packUnitId"),
    packLabel: exactText(value.packLabel, "pack label", 80),
    baseUnitId: baseUnit(value.baseUnitId),
    baseQuantity: value.baseQuantity,
    sourceLabel: exactText(value.sourceLabel, "pack conversion source", 120),
    expectedRevision: exactRevision(value.expectedRevision, "pack conversion expected revision")
  };
}

function normalizeRecipeLine(value, index) {
  if (!isRecord(value) || !["standard", "ingredient_pack"].includes(value.unitKind)) {
    throw clientError("invalid-argument", `Recipe ingredient ${index + 1} has an unsupported unit kind.`);
  }
  const common = ["lineId", "ingredientId", "quantity", "unitKind", "quantityBasis", "usableYield"];
  exactKeys(value, value.unitKind === "standard"
    ? [...common, "unitId"] : [...common, "packConversionRevisionId"], `Recipe ingredient ${index + 1}`);
  if (!["as_purchased", "usable"].includes(value.quantityBasis)
    || (value.quantityBasis === "as_purchased" && value.usableYield !== null)
    || (value.quantityBasis === "usable" && value.usableYield !== null && typeof value.usableYield !== "string")) {
    throw clientError("invalid-argument", `Recipe ingredient ${index + 1} quantity basis is invalid.`);
  }
  parseQuantityMicros(value.quantity, `recipe ingredient ${index + 1} quantity`);
  if (value.usableYield !== null) {
    const yieldMicros = parseQuantityMicros(value.usableYield, `recipe ingredient ${index + 1} usable yield`);
    if (yieldMicros > Number(QUANTITY_SCALE)) {
      throw clientError("invalid-argument", `Recipe ingredient ${index + 1} usable yield cannot exceed 1.`);
    }
  }
  const line = {
    lineId: identifier(value.lineId, `recipe ingredient ${index + 1} lineId`),
    ingredientId: identifier(value.ingredientId, `recipe ingredient ${index + 1} ingredientId`),
    quantity: value.quantity,
    unitKind: value.unitKind,
    quantityBasis: value.quantityBasis,
    usableYield: value.usableYield
  };
  if (value.unitKind === "standard") line.unitId = identifier(value.unitId, `recipe ingredient ${index + 1} unitId`);
  else line.packConversionRevisionId = identifier(
    value.packConversionRevisionId, `recipe ingredient ${index + 1} pack conversion revision`
  );
  return line;
}

function normalizeRecipeCommand(value, { requireDependencyPreflight = true } = {}) {
  const keys = [
    "kind", "menuItemId", "expectedCatalogRevision", "expectedRecipeRevision",
    "outputYield", "outputUnitId", "lines"
  ];
  if (requireDependencyPreflight) keys.push("dependencyPreflightDigest");
  exactKeys(value, keys, requireDependencyPreflight
    ? "Menu recipe publication command"
    : "Menu recipe dependency preflight");
  if (value.kind !== "publish_menu_recipe" || !Array.isArray(value.lines)
    || value.lines.length > INVENTORY_MAX_PUBLISHED_RECIPE_LINES) {
    throw clientError("invalid-argument", `Menu recipes support at most ${INVENTORY_MAX_PUBLISHED_RECIPE_LINES} ingredient lines.`);
  }
  if (value.outputYield !== null) parseQuantityMicros(value.outputYield, "recipe output yield");
  const lines = value.lines.map(normalizeRecipeLine);
  if (new Set(lines.map((line) => line.lineId)).size !== lines.length) {
    throw clientError("invalid-argument", "Recipe line identities must be unique.");
  }
  const command = {
    kind: value.kind,
    menuItemId: identifier(value.menuItemId, "menuItemId"),
    expectedCatalogRevision: exactRevision(value.expectedCatalogRevision, "catalog expected revision"),
    expectedRecipeRevision: exactRevision(value.expectedRecipeRevision, "recipe expected revision"),
    outputYield: value.outputYield,
    outputUnitId: identifier(value.outputUnitId, "recipe output unit"),
    lines
  };
  if (requireDependencyPreflight) {
    if (!SHA256_PATTERN.test(value.dependencyPreflightDigest || "")) {
      throw clientError("invalid-argument", "Recipe publication requires a reviewed dependency preflight digest.");
    }
    command.dependencyPreflightDigest = value.dependencyPreflightDigest;
  }
  return command;
}

function normalizePortionBasis(value, index) {
  exactKeys(value, ["kind", "evidenceId"], `Event menu selection ${index + 1} portion basis`);
  if (value.kind !== "explicit_output_quantity") {
    throw clientError("invalid-argument", `Event menu selection ${index + 1} requires an explicit operator-entered output quantity.`);
  }
  return {
    kind: value.kind,
    evidenceId: identifier(value.evidenceId, `event menu selection ${index + 1} portion evidence`)
  };
}

function normalizeCommercialProvenance(value, index) {
  if (!isRecord(value) || !new Set(["direct", "package_inclusion"]).has(value.kind)) {
    throw clientError("invalid-argument", `Event menu selection ${index + 1} commercial provenance is invalid.`);
  }
  exactKeys(value, value.kind === "direct"
    ? ["kind", "sourceId"]
    : ["kind", "sourceId", "packageId", "inclusionId"],
  `Event menu selection ${index + 1} commercial provenance`);
  const result = {
    kind: value.kind,
    sourceId: identifier(value.sourceId, `event menu selection ${index + 1} commercial source`)
  };
  if (value.kind === "package_inclusion") {
    result.packageId = identifier(value.packageId, `event menu selection ${index + 1} package`);
    result.inclusionId = identifier(value.inclusionId, `event menu selection ${index + 1} package inclusion`);
  }
  return result;
}

function normalizeEventMenuSelection(value, index, code = "invalid-argument") {
  try {
    exactKeys(value, [
      "selectionId", "menuItemId", "recipeRevisionId", "requiredOutputQuantity",
      "outputUnitId", "portionBasis", "commercialProvenance"
    ], `Event menu selection ${index + 1}`, code);
    parseQuantityMicros(value.requiredOutputQuantity, `event menu selection ${index + 1} output quantity`, { code });
    if (value.recipeRevisionId !== null && !RECIPE_REVISION_ID_PATTERN.test(value.recipeRevisionId)) {
      throw clientError(code, `Event menu selection ${index + 1} recipe revision identity is invalid.`);
    }
    if (value.recipeRevisionId === null && value.outputUnitId !== null) {
      throw clientError(code, `Event menu selection ${index + 1} cannot claim an output unit without a recipe.`);
    }
    return {
      selectionId: identifier(value.selectionId, `event menu selection ${index + 1} identity`, code),
      menuItemId: identifier(value.menuItemId, `event menu selection ${index + 1} menu item`, code),
      recipeRevisionId: value.recipeRevisionId,
      requiredOutputQuantity: value.requiredOutputQuantity,
      outputUnitId: value.recipeRevisionId === null && value.outputUnitId === null
        ? null
        : identifier(value.outputUnitId, `event menu selection ${index + 1} output unit`, code),
      portionBasis: normalizePortionBasis(value.portionBasis, index),
      commercialProvenance: normalizeCommercialProvenance(value.commercialProvenance, index)
    };
  } catch (error) {
    if (code === "data-loss") throw clientError("data-loss", error?.message || `Event menu selection ${index + 1} is invalid.`);
    throw error;
  }
}

function normalizeEventSelections(value, code = "invalid-argument") {
  if (!Array.isArray(value) || value.length === 0 || value.length > INVENTORY_EVENT_SELECTION_LIMIT) {
    throw clientError(code, `Event ingredient demand supports at most ${INVENTORY_EVENT_SELECTION_LIMIT} menu selections.`);
  }
  const selections = value.map((entry, index) => normalizeEventMenuSelection(entry, index, code));
  if (new Set(selections.map((entry) => entry.selectionId)).size !== selections.length
    || new Set(selections.map((entry) => entry.menuItemId)).size !== selections.length) {
    throw clientError(code, "Event menu and selection identities must each be unique.");
  }
  return selections;
}

function normalizeCompileEventIngredientCommand(value) {
  exactKeys(value, [
    "kind", "quoteId", "quoteRevisionId", "requiredByBasis", "selections", "expectedRequirementRevision",
    "expectedPreviewProjectionDigest"
  ], "Event ingredient requirement command");
  if (value.kind !== "compile_event_ingredient_demand") {
    throw clientError("invalid-argument", "Event ingredient requirement command is invalid.");
  }
  return {
    kind: value.kind,
    quoteId: identifier(value.quoteId, "quoteId"),
    quoteRevisionId: identifier(value.quoteRevisionId, "quote revision identity"),
    requiredByBasis: normalizeEventRequiredByBasis(value.requiredByBasis),
    selections: normalizeEventSelections(value.selections),
    expectedRequirementRevision: exactRevision(value.expectedRequirementRevision, "event requirement expected revision"),
    expectedPreviewProjectionDigest: eventDigest(
      value.expectedPreviewProjectionDigest,
      "event ingredient preview projection digest"
    )
  };
}

function normalizeAllocateEventIngredientsCommand(value) {
  exactKeys(value, [
    "kind", "quoteId", "eventRequirementRevisionId", "locationId", "expectedRequirementRevision",
    "expectedAllocationRevision"
  ], "Event ingredient allocation command");
  if (value.kind !== "allocate_event_ingredients" || !EVENT_REQUIREMENT_REVISION_ID_PATTERN.test(value.eventRequirementRevisionId)
  ) {
    throw clientError("invalid-argument", "Event ingredient allocation command is invalid.");
  }
  return {
    kind: value.kind,
    quoteId: identifier(value.quoteId, "allocation quoteId"),
    eventRequirementRevisionId: value.eventRequirementRevisionId,
    locationId: identifier(value.locationId, "allocation locationId"),
    expectedRequirementRevision: exactRevision(value.expectedRequirementRevision, "allocation requirement expected revision", { allowZero: false }),
    expectedAllocationRevision: exactRevision(value.expectedAllocationRevision, "allocation expected revision")
  };
}

function normalizeReleaseEventIngredientsCommand(value) {
  exactKeys(value, ["kind", "quoteId", "expectedAllocationRevision", "reason"], "Event ingredient release command");
  if (value.kind !== "release_event_ingredients") {
    throw clientError("invalid-argument", "Event ingredient release command is invalid.");
  }
  return {
    kind: value.kind,
    quoteId: identifier(value.quoteId, "release quoteId"),
    expectedAllocationRevision: exactRevision(value.expectedAllocationRevision, "release expected allocation revision", { allowZero: false }),
    reason: exactText(value.reason, "release reason", 160)
  };
}

function normalizeReconcileEventIngredientsCommand(value) {
  exactKeys(value, [
    "kind", "quoteId", "eventRequirementRevisionId", "locationId",
    "expectedRequirementRevision", "expectedAllocationRevision", "reason"
  ], "Event ingredient reconciliation command");
  if (value.kind !== "reconcile_event_ingredients"
    || !EVENT_REQUIREMENT_REVISION_ID_PATTERN.test(value.eventRequirementRevisionId)) {
    throw clientError("invalid-argument", "Event ingredient reconciliation command is invalid.");
  }
  return {
    kind: value.kind,
    quoteId: identifier(value.quoteId, "reconciliation quoteId"),
    eventRequirementRevisionId: value.eventRequirementRevisionId,
    locationId: identifier(value.locationId, "reconciliation locationId"),
    expectedRequirementRevision: exactRevision(
      value.expectedRequirementRevision,
      "reconciliation requirement expected revision",
      { allowZero: false }
    ),
    expectedAllocationRevision: exactRevision(
      value.expectedAllocationRevision,
      "reconciliation allocation expected revision",
      { allowZero: false }
    ),
    reason: exactText(value.reason, "reconciliation reason", 160)
  };
}

function normalizeEventExecutionIngredient(value, index) {
  exactKeys(value, [
    "ingredientId", "locationId", "baseUnitId", "consumedQuantity", "wasteQuantity",
    "expectedStockRevision"
  ], `Event execution ingredient ${index + 1}`);
  parseQuantityMicros(value.consumedQuantity, `event execution ingredient ${index + 1} consumed quantity`, { allowZero: true });
  parseQuantityMicros(value.wasteQuantity, `event execution ingredient ${index + 1} waste quantity`, { allowZero: true });
  return {
    ingredientId: identifier(value.ingredientId, `event execution ingredient ${index + 1}`),
    locationId: identifier(value.locationId, `event execution ingredient ${index + 1} location`),
    baseUnitId: baseUnit(value.baseUnitId, `event execution ingredient ${index + 1} base unit`),
    consumedQuantity: value.consumedQuantity,
    wasteQuantity: value.wasteQuantity,
    expectedStockRevision: exactRevision(
      value.expectedStockRevision,
      `event execution ingredient ${index + 1} expected stock revision`,
      { allowZero: false }
    )
  };
}

function normalizeEventExecutionCommand(value) {
  exactKeys(value, [
    "kind", "quoteId", "eventRequirementRevisionId", "expectedExecutionRevision",
    "expectedAllocationRevision", "occurredAtISO", "reason", "ingredients"
  ], "Event ingredient execution command");
  if (!["record_event_ingredient_execution", "correct_event_ingredient_execution"].includes(value.kind)
    || !EVENT_REQUIREMENT_REVISION_ID_PATTERN.test(value.eventRequirementRevisionId)
    || !Array.isArray(value.ingredients)
    || value.ingredients.length === 0
    || value.ingredients.length > 75) {
    throw clientError("invalid-argument", "Event ingredient execution command is invalid.");
  }
  const correction = value.kind === "correct_event_ingredient_execution";
  const expectedExecutionRevision = exactRevision(
    value.expectedExecutionRevision,
    "event execution expected revision",
    { allowZero: !correction }
  );
  if ((!correction && expectedExecutionRevision !== 0) || (correction && expectedExecutionRevision < 1)) {
    throw clientError("invalid-argument", "Event execution revision does not match the command kind.");
  }
  const ingredients = value.ingredients.map(normalizeEventExecutionIngredient);
  if (new Set(ingredients.map(({ ingredientId }) => ingredientId)).size !== ingredients.length
    || ingredients.some((entry, index) => index > 0
      && compareCodePoints(ingredients[index - 1].ingredientId, entry.ingredientId) >= 0)) {
    throw clientError("invalid-argument", "Event execution ingredients must be a sorted unique set.");
  }
  return {
    kind: value.kind,
    quoteId: identifier(value.quoteId, "event execution quoteId"),
    eventRequirementRevisionId: value.eventRequirementRevisionId,
    expectedExecutionRevision,
    expectedAllocationRevision: exactRevision(
      value.expectedAllocationRevision,
      "event execution expected allocation revision",
      { allowZero: false }
    ),
    occurredAtISO: exactIso(value.occurredAtISO, "event execution occurrence time", "invalid-argument"),
    reason: exactText(value.reason, "event execution reason", 240),
    ingredients
  };
}

function normalizeEventRequiredByBasis(value) {
  exactKeys(value, ["kind"], "Event ingredient required-by basis");
  if (value.kind !== "quote_event_start") {
    throw clientError("invalid-argument", "Ingredient demand must use the immutable quote event start.");
  }
  return { kind: value.kind };
}

function normalizeCommand(value) {
  if (!isRecord(value) || typeof value.kind !== "string" || !COMMAND_KINDS.has(value.kind)) {
    throw clientError("invalid-argument", "A supported schema-v2 inventory command is required.");
  }
  if (value.kind === "upsert_location") return deepFreeze(normalizeLocationCommand(value));
  if (value.kind === "upsert_ingredient") return deepFreeze(normalizeIngredientCommand(value));
  if (value.kind === "opening_balance") return deepFreeze(normalizeOpeningBalanceCommand(value));
  if (value.kind === "receive_stock") return deepFreeze(normalizeReceiveStockCommand(value));
  if (value.kind === "record_ingredient_cost") return deepFreeze(normalizeCostCommand(value));
  if (value.kind === "publish_pack_conversion") return deepFreeze(normalizePackConversionCommand(value));
  if (value.kind === "publish_menu_recipe") return deepFreeze(normalizeRecipeCommand(value));
  if (value.kind === "compile_event_ingredient_demand") return deepFreeze(normalizeCompileEventIngredientCommand(value));
  if (value.kind === "allocate_event_ingredients") return deepFreeze(normalizeAllocateEventIngredientsCommand(value));
  if (value.kind === "reconcile_event_ingredients") return deepFreeze(normalizeReconcileEventIngredientsCommand(value));
  if (["record_event_ingredient_execution", "correct_event_ingredient_execution"].includes(value.kind)) {
    return deepFreeze(normalizeEventExecutionCommand(value));
  }
  return deepFreeze(normalizeReleaseEventIngredientsCommand(value));
}

export function inventoryCommandAxis(kind) {
  if (kind === "upsert_location") return "location";
  if (kind === "upsert_ingredient") return "ingredient";
  if (kind === "opening_balance") return "stock";
  if (kind === "receive_stock") return "receiving";
  if (kind === "record_ingredient_cost") return "cost";
  if (kind === "publish_pack_conversion") return "conversion";
  if (kind === "publish_menu_recipe") return "recipe";
  if (kind === "compile_event_ingredient_demand") return "event_requirement";
  if (["allocate_event_ingredients", "release_event_ingredients", "reconcile_event_ingredients"].includes(kind)) return "allocation";
  if (["record_event_ingredient_execution", "correct_event_ingredient_execution"].includes(kind)) return "execution";
  return "";
}

function targetIdentity(command) {
  return command.locationId || command.ingredientId || command.menuItemId || command.quoteId || "authority";
}

function normalizeEnvelope(input) {
  const { access, uid } = requireMutationAccess(input);
  const command = normalizeCommand(input.command);
  const requestId = normalizeRequestId(input.requestId || buildInventoryRequestId());
  return {
    uid,
    payload: deepFreeze({
      schemaVersion: INVENTORY_AUTHORITY_SCHEMA_VERSION,
      organizationId: access.organizationId,
      requestId,
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
  persistPendingAttempt(attempt);
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
  const next = {
    ...current,
    definitive,
    state: definitive ? "error" : "uncertain",
    error: String(error?.message || "Inventory did not return a verified receipt.").trim().slice(0, 240)
  };
  pendingAttempts.set(attempt.key, next);
  persistPendingAttempt(next);
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
    exactKeys(value, ["schemaVersion", "ingredientId", "revision", "baseUnitId", "active", "affectedMenuItemIds"], "Inventory ingredient result", "data-loss");
    if (value.schemaVersion !== INVENTORY_AUTHORITY_SCHEMA_VERSION
      || value.ingredientId !== command.ingredientId
      || value.revision !== command.expectedRevision + 1
      || value.baseUnitId !== command.baseUnitId
      || value.active !== command.active
      || !Array.isArray(value.affectedMenuItemIds)
      || value.affectedMenuItemIds.length > INVENTORY_MENU_COST_PROJECTION_LIMIT) {
      throw clientError("data-loss", "Inventory ingredient result differs from the exact request.");
    }
    return { ...value, affectedMenuItemIds: value.affectedMenuItemIds.map((entry) => identifier(entry, "affected menu item", "data-loss")) };
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
  if (command.kind === "receive_stock") {
    exactKeys(value, [
      "schemaVersion", "ingredientId", "locationId", "movementId", "costEvidenceId",
      "stockRevision", "costRevision", "onHandMicros", "onHandQuantity"
    ], "Ingredient receiving result", "data-loss");
    if (value.schemaVersion !== INVENTORY_AUTHORITY_SCHEMA_VERSION
      || value.ingredientId !== command.ingredientId
      || value.locationId !== command.locationId
      || !MOVEMENT_ID_PATTERN.test(value.movementId)
      || !COST_EVIDENCE_ID_PATTERN.test(value.costEvidenceId)
      || value.stockRevision !== command.expectedStockRevision + 1
      || !new Set([command.expectedCostRevision, command.expectedCostRevision + 1]).has(value.costRevision)
      || !Number.isSafeInteger(value.onHandMicros) || value.onHandMicros < 1
      || value.onHandQuantity !== formatQuantityMicros(value.onHandMicros, "received on-hand micros")) {
      throw clientError("data-loss", "Ingredient receiving result differs from the exact request.");
    }
    return { ...value };
  }
  if (command.kind === "publish_pack_conversion") {
    exactKeys(value, [
      "schemaVersion", "ingredientId", "packUnitId", "packConversionRevisionId", "revision", "affectedMenuItemIds"
    ], "Ingredient pack conversion result", "data-loss");
    if (value.schemaVersion !== INVENTORY_AUTHORITY_SCHEMA_VERSION
      || value.ingredientId !== command.ingredientId || value.packUnitId !== command.packUnitId
      || value.revision !== command.expectedRevision + 1
      || !PACK_CONVERSION_REVISION_ID_PATTERN.test(value.packConversionRevisionId)
      || !Array.isArray(value.affectedMenuItemIds)
      || value.affectedMenuItemIds.length > INVENTORY_MENU_COST_PROJECTION_LIMIT) {
      throw clientError("data-loss", "Ingredient pack conversion result differs from the exact request.");
    }
    return { ...value, affectedMenuItemIds: value.affectedMenuItemIds.map((entry) => identifier(entry, "affected menu item", "data-loss")) };
  }
  if (command.kind === "publish_menu_recipe") {
    exactKeys(value, [
      "schemaVersion", "menuItemId", "recipeRevisionId", "recipeRevision",
      "projectionSourceDigest", "status"
    ], "Menu recipe publication result", "data-loss");
    if (value.schemaVersion !== INVENTORY_AUTHORITY_SCHEMA_VERSION
      || value.menuItemId !== command.menuItemId
      || value.recipeRevision !== command.expectedRecipeRevision + 1
      || !RECIPE_REVISION_ID_PATTERN.test(value.recipeRevisionId)
      || typeof value.projectionSourceDigest !== "string"
      || !["complete", "partial", "invalid", "unavailable"].includes(value.status)) {
      throw clientError("data-loss", "Menu recipe publication result differs from the exact request.");
    }
    return { ...value };
  }
  if (command.kind === "compile_event_ingredient_demand") {
    exactKeys(value, [
      "schemaVersion", "quoteId", "quoteRevisionId", "eventRequirementRevisionId",
      "requirementRevision", "requirementDigest", "projectionDigest", "demandState",
      "costState", "availabilityState"
    ], "Event ingredient requirement result", "data-loss");
    if (value.schemaVersion !== INVENTORY_AUTHORITY_SCHEMA_VERSION
      || value.quoteId !== command.quoteId
      || value.quoteRevisionId !== command.quoteRevisionId
      || !EVENT_REQUIREMENT_REVISION_ID_PATTERN.test(value.eventRequirementRevisionId)
      || !Number.isSafeInteger(value.requirementRevision)
      || value.requirementRevision < 1
      || value.requirementRevision > MAX_REVISION
      || value.requirementRevision > command.expectedRequirementRevision + 1
      || value.requirementRevision < command.expectedRequirementRevision
      || !SHA256_PATTERN.test(value.requirementDigest)
      || !SHA256_PATTERN.test(value.projectionDigest)
      || !["complete", "incomplete", "invalid"].includes(value.demandState)
      || !["complete", "partial", "unavailable", "invalid"].includes(value.costState)
      || !["available", "shortage", "unavailable", "invalid"].includes(value.availabilityState)) {
      throw clientError("data-loss", "Event ingredient requirement result differs from the exact request.");
    }
    return { ...value };
  }
  if (["allocate_event_ingredients", "release_event_ingredients", "reconcile_event_ingredients"].includes(command.kind)) {
    const release = command.kind === "release_event_ingredients";
    const reconcile = command.kind === "reconcile_event_ingredients";
    exactKeys(value, [
      "schemaVersion", "quoteId", "eventPlanId", "allocationRevision", "state",
      "eventRequirementRevisionId", "ingredientCount", "fullyAllocatedIngredientCount",
      "shortageIngredientCount", ...(release ? ["releasedIngredientCount"] : []),
      ...(reconcile ? ["reconciledFromAllocationRevision"] : [])
    ], `Event ingredient ${release ? "release" : reconcile ? "reconciliation" : "allocation"} result`, "data-loss");
    if (value.schemaVersion !== INVENTORY_AUTHORITY_SCHEMA_VERSION
      || value.quoteId !== command.quoteId
      || !EVENT_PLAN_ID_PATTERN.test(value.eventPlanId)
      || value.allocationRevision !== command.expectedAllocationRevision + (reconcile ? 2 : 1)
      || !["reserved", "shortage", "released"].includes(value.state)
      || (release && value.state !== "released")
      || (!release && value.state === "released")
      || (!release && value.eventRequirementRevisionId !== command.eventRequirementRevisionId)
      || (release && !EVENT_REQUIREMENT_REVISION_ID_PATTERN.test(value.eventRequirementRevisionId))) {
      throw clientError("data-loss", `Event ingredient ${release ? "release" : reconcile ? "reconciliation" : "allocation"} result differs from the request.`);
    }
    if (reconcile && value.reconciledFromAllocationRevision !== command.expectedAllocationRevision) {
      throw clientError("data-loss", "Event ingredient reconciliation result does not identify the replaced allocation revision.");
    }
    exactSafeInteger(value.ingredientCount, "event ingredientCount", { minimum: 1 });
    for (const key of [
      "fullyAllocatedIngredientCount", "shortageIngredientCount", ...(release ? ["releasedIngredientCount"] : [])
    ]) exactSafeInteger(value[key], `event ${key}`);
    if (value.fullyAllocatedIngredientCount + value.shortageIngredientCount !== value.ingredientCount
      || (value.state === "reserved" && value.shortageIngredientCount !== 0)
      || (value.state === "shortage" && value.shortageIngredientCount === 0)
      || (release && value.releasedIngredientCount > value.ingredientCount)) {
      throw clientError("data-loss", `Event ingredient ${release ? "release" : reconcile ? "reconciliation" : "allocation"} result counts contradict its state.`);
    }
    return { ...value };
  }
  if (["record_event_ingredient_execution", "correct_event_ingredient_execution"].includes(command.kind)) {
    exactKeys(value, [
      "schemaVersion", "quoteId", "eventPlanId", "eventRequirementRevisionId",
      "executionRevision", "eventExecutionRevisionId", "state", "movementIds"
    ], "Event ingredient execution result", "data-loss");
    if (value.schemaVersion !== INVENTORY_AUTHORITY_SCHEMA_VERSION
      || value.quoteId !== command.quoteId
      || !EVENT_PLAN_ID_PATTERN.test(value.eventPlanId)
      || value.eventRequirementRevisionId !== command.eventRequirementRevisionId
      || value.executionRevision !== command.expectedExecutionRevision + 1
      || !EVENT_EXECUTION_REVISION_ID_PATTERN.test(value.eventExecutionRevisionId)
      || value.state !== "settled"
      || !Array.isArray(value.movementIds)
      || value.movementIds.length > command.ingredients.length
      || value.movementIds.some((entry) => !MOVEMENT_ID_PATTERN.test(entry))) {
      throw clientError("data-loss", "Event ingredient execution result differs from the exact request.");
    }
    return { ...value, movementIds: [...value.movementIds] };
  }
  exactKeys(value, [
    "schemaVersion", "ingredientId", "costEvidenceId", "costRevision", "availability", "affectedMenuItemIds"
  ], "Inventory cost result", "data-loss");
  if (value.schemaVersion !== INVENTORY_AUTHORITY_SCHEMA_VERSION
    || value.ingredientId !== command.ingredientId
    || !COST_EVIDENCE_ID_PATTERN.test(value.costEvidenceId)
    || value.costRevision !== command.expectedCostRevision + 1
    || value.availability !== command.availability
    || !Array.isArray(value.affectedMenuItemIds)
    || value.affectedMenuItemIds.length > INVENTORY_MENU_COST_PROJECTION_LIMIT) {
    throw clientError("data-loss", "Inventory cost result differs from the exact request.");
  }
  return { ...value, affectedMenuItemIds: value.affectedMenuItemIds.map((entry) => identifier(entry, "affected menu item", "data-loss")) };
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
    removeStoredPendingAttempt(attempt);
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
  hydratePendingAttempts(input, scope);
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
  hydratePendingAttempts(input, scope);
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
  persistPendingAttempt(next);
  return executeAttempt(next);
}

export function resetDefinitiveInventoryCommand(input = {}) {
  const current = findAttempt(input, { required: false });
  if (!current) return false;
  if (!current.definitive) return false;
  pendingAttempts.delete(current.key);
  removeStoredPendingAttempt(current);
  return true;
}

export function normalizeInventoryCostDependencyPreflightResult(
  value,
  expectedOrganizationId,
  expectedIngredientRevision,
  expectedCommand
) {
  exactKeys(value, [
    "schemaVersion", "organizationId", "ingredientId", "reviewedIngredientRevision",
    "reviewedCostRevision", "draftDigest", "dependencyEvidence", "affectedMenuItems",
    "complete", "limit", "dependencyPreflightDigest"
  ], "Ingredient cost dependency preflight result", "data-loss");
  const organizationId = identifier(expectedOrganizationId, "expected organizationId", "data-loss");
  const ingredientRevision = exactRevision(
    expectedIngredientRevision,
    "expected ingredient revision",
    { allowZero: false, code: "data-loss" }
  );
  const command = normalizeCostCommand(expectedCommand);
  const reviewedIngredientRevision = exactRevision(
    value.reviewedIngredientRevision,
    "reviewed ingredient revision",
    { allowZero: false, code: "data-loss" }
  );
  const reviewedCostRevision = exactRevision(
    value.reviewedCostRevision,
    "reviewed cost revision",
    { code: "data-loss" }
  );
  if (Object.hasOwn(command, "dependencyPreflightDigest")
    || value.schemaVersion !== INVENTORY_AUTHORITY_SCHEMA_VERSION
    || value.organizationId !== organizationId
    || value.ingredientId !== command.ingredientId
    || reviewedIngredientRevision !== ingredientRevision
    || reviewedCostRevision !== command.expectedCostRevision
    || value.complete !== true
    || value.limit !== INVENTORY_MENU_COST_PROJECTION_LIMIT
    || !SHA256_PATTERN.test(value.draftDigest || "")
    || !SHA256_PATTERN.test(value.dependencyPreflightDigest || "")) {
    throw clientError("data-loss", "Ingredient cost dependency preflight crossed its scope or revision fence.");
  }
  exactKeys(
    value.dependencyEvidence,
    ["revision", "updatedAtISO", "menuItemIds"],
    "Ingredient dependency evidence",
    "data-loss"
  );
  const dependencyRevision = exactRevision(
    value.dependencyEvidence.revision,
    "ingredient dependency revision",
    { code: "data-loss" }
  );
  if ((dependencyRevision === 0
    ? value.dependencyEvidence.updatedAtISO !== null
    : typeof value.dependencyEvidence.updatedAtISO !== "string")
    || !Array.isArray(value.dependencyEvidence.menuItemIds)
    || value.dependencyEvidence.menuItemIds.length > INVENTORY_MENU_COST_PROJECTION_LIMIT) {
    throw clientError("data-loss", "Ingredient dependency evidence is internally inconsistent.");
  }
  const menuItemIds = value.dependencyEvidence.menuItemIds.map((id) => identifier(
    id,
    "dependent menu item identity",
    "data-loss"
  ));
  if ([...menuItemIds].sort(compareCodePoints).join("\u0000") !== menuItemIds.join("\u0000")
    || new Set(menuItemIds).size !== menuItemIds.length) {
    throw clientError("data-loss", "Dependent menu item identities are not a stable unique set.");
  }
  if (!Array.isArray(value.affectedMenuItems)
    || value.affectedMenuItems.length !== menuItemIds.length
    || value.affectedMenuItems.length > INVENTORY_MENU_COST_PROJECTION_LIMIT) {
    throw clientError("data-loss", "Affected menu item evidence is incomplete.");
  }
  const affectedMenuItems = value.affectedMenuItems.map((entry, index) => {
    exactKeys(entry, ["menuItemId", "name", "identityDigest"], `Affected menu item ${index + 1}`, "data-loss");
    if (!SHA256_PATTERN.test(entry.identityDigest || "")) {
      throw clientError("data-loss", "Affected menu identity digest is invalid.");
    }
    return {
      menuItemId: identifier(entry.menuItemId, "affected menu item identity", "data-loss"),
      name: exactText(entry.name, "affected menu item name", 120, { code: "data-loss" }),
      identityDigest: entry.identityDigest
    };
  });
  if (new Set(affectedMenuItems.map((entry) => entry.menuItemId)).size !== affectedMenuItems.length
    || [...affectedMenuItems.map((entry) => entry.menuItemId)].sort(compareCodePoints).join("\u0000")
      !== menuItemIds.join("\u0000")) {
    throw clientError("data-loss", "Affected menu identities do not match the dependency index.");
  }
  return deepFreeze({
    schemaVersion: INVENTORY_AUTHORITY_SCHEMA_VERSION,
    organizationId,
    ingredientId: command.ingredientId,
    reviewedIngredientRevision,
    reviewedCostRevision,
    draftDigest: value.draftDigest,
    dependencyEvidence: {
      revision: dependencyRevision,
      updatedAtISO: dependencyRevision === 0
        ? null
        : exactIso(value.dependencyEvidence.updatedAtISO, "dependency evidence update time", "data-loss"),
      menuItemIds
    },
    affectedMenuItems,
    complete: true,
    limit: INVENTORY_MENU_COST_PROJECTION_LIMIT,
    dependencyPreflightDigest: value.dependencyPreflightDigest
  });
}

export async function getInventoryCostDependencyPreflight(input = {}) {
  const { access } = requireAuthorityReadAccess(input);
  const expectedIngredientRevision = exactRevision(
    input.expectedIngredientRevision,
    "expected ingredient revision",
    { allowZero: false }
  );
  const command = normalizeCostCommand(input.command);
  if (Object.hasOwn(command, "dependencyPreflightDigest")) {
    throw clientError("invalid-argument", "Cost dependency review requires an unreviewed cost command.");
  }
  const payload = {
    schemaVersion: INVENTORY_AUTHORITY_SCHEMA_VERSION,
    organizationId: access.organizationId,
    expectedIngredientRevision,
    costDependencyPreflight: command
  };
  const call = httpsCallable(cloudFunctions, INVENTORY_AUTHORITY_CALLABLES.readWorkspace);
  const response = await call(payload);
  return normalizeInventoryCostDependencyPreflightResult(
    response?.data,
    access.organizationId,
    expectedIngredientRevision,
    command
  );
}

export function normalizeInventoryRecipeDependencyPreflightResult(
  value,
  expectedOrganizationId,
  expectedCommand
) {
  exactKeys(value, [
    "schemaVersion", "organizationId", "menuItemId", "reviewedCatalogRevision",
    "reviewedRecipeRevision", "reviewedRecipeDigest", "draftDigest", "changedIngredientIds",
    "dependencyEvidence", "affectedMenuItems", "complete", "limit", "dependencyPreflightDigest"
  ], "Menu recipe dependency preflight result", "data-loss");
  const organizationId = identifier(expectedOrganizationId, "expected organizationId", "data-loss");
  const command = normalizeRecipeCommand(expectedCommand, { requireDependencyPreflight: false });
  const reviewedCatalogRevision = exactRevision(
    value.reviewedCatalogRevision, "reviewed catalog revision", { code: "data-loss" }
  );
  const reviewedRecipeRevision = exactRevision(
    value.reviewedRecipeRevision, "reviewed recipe revision", { code: "data-loss" }
  );
  if (value.schemaVersion !== INVENTORY_AUTHORITY_SCHEMA_VERSION
    || value.organizationId !== organizationId
    || value.menuItemId !== command.menuItemId
    || reviewedCatalogRevision !== command.expectedCatalogRevision
    || reviewedRecipeRevision !== command.expectedRecipeRevision
    || value.complete !== true
    || value.limit !== INVENTORY_MENU_COST_PROJECTION_LIMIT
    || !SHA256_PATTERN.test(value.draftDigest || "")
    || !SHA256_PATTERN.test(value.dependencyPreflightDigest || "")
    || (reviewedRecipeRevision === 0
      ? value.reviewedRecipeDigest !== null
      : !SHA256_PATTERN.test(value.reviewedRecipeDigest || ""))) {
    throw clientError("data-loss", "Menu recipe dependency preflight crossed its scope or revision fence.");
  }
  if (!Array.isArray(value.changedIngredientIds)
    || value.changedIngredientIds.length > INVENTORY_MAX_PUBLISHED_RECIPE_LINES) {
    throw clientError("data-loss", "Changed recipe ingredient evidence exceeds its bounded contract.");
  }
  const changedIngredientIds = value.changedIngredientIds.map((id) => identifier(
    id, "changed recipe ingredient identity", "data-loss"
  ));
  if ([...changedIngredientIds].sort(compareCodePoints).join("\u0000") !== changedIngredientIds.join("\u0000")
    || new Set(changedIngredientIds).size !== changedIngredientIds.length) {
    throw clientError("data-loss", "Changed recipe ingredients are not a stable unique set.");
  }
  if (!Array.isArray(value.dependencyEvidence)
    || value.dependencyEvidence.length !== changedIngredientIds.length) {
    throw clientError("data-loss", "Recipe dependency evidence is incomplete.");
  }
  const dependencyEvidence = value.dependencyEvidence.map((entry, index) => {
    exactKeys(entry, ["ingredientId", "revision", "updatedAtISO", "menuItemIds"],
      `Recipe dependency evidence ${index + 1}`, "data-loss");
    const ingredientId = identifier(entry.ingredientId, "dependency ingredient identity", "data-loss");
    const revision = exactRevision(entry.revision, "dependency revision", { code: "data-loss" });
    if (ingredientId !== changedIngredientIds[index]
      || (revision === 0 ? entry.updatedAtISO !== null : typeof entry.updatedAtISO !== "string")
      || !Array.isArray(entry.menuItemIds)
      || entry.menuItemIds.length > INVENTORY_MENU_COST_PROJECTION_LIMIT) {
      throw clientError("data-loss", "Recipe dependency evidence is internally inconsistent.");
    }
    const menuItemIds = entry.menuItemIds.map((id) => identifier(id, "dependent menu item identity", "data-loss"));
    if ([...menuItemIds].sort(compareCodePoints).join("\u0000") !== menuItemIds.join("\u0000")
      || new Set(menuItemIds).size !== menuItemIds.length) {
      throw clientError("data-loss", "Dependent menu item identities are not a stable unique set.");
    }
    return {
      ingredientId,
      revision,
      updatedAtISO: revision === 0 ? null : exactIso(entry.updatedAtISO, "dependency evidence update time"),
      menuItemIds
    };
  });
  if (!Array.isArray(value.affectedMenuItems)
    || value.affectedMenuItems.length === 0
    || value.affectedMenuItems.length > INVENTORY_MENU_COST_PROJECTION_LIMIT) {
    throw clientError("data-loss", "Affected menu items exceed their bounded complete contract.");
  }
  const affectedMenuItems = value.affectedMenuItems.map((entry, index) => {
    exactKeys(entry, ["menuItemId", "name", "identityDigest"], `Affected menu item ${index + 1}`, "data-loss");
    if (!SHA256_PATTERN.test(entry.identityDigest || "")) {
      throw clientError("data-loss", "Affected menu identity digest is invalid.");
    }
    return {
      menuItemId: identifier(entry.menuItemId, "affected menu item identity", "data-loss"),
      name: exactText(entry.name, "affected menu item name", 120, { code: "data-loss" }),
      identityDigest: entry.identityDigest
    };
  });
  if (!affectedMenuItems.some((entry) => entry.menuItemId === command.menuItemId)
    || new Set(affectedMenuItems.map((entry) => entry.menuItemId)).size !== affectedMenuItems.length) {
    throw clientError("data-loss", "Affected menu item evidence is incomplete or duplicated.");
  }
  return deepFreeze({
    schemaVersion: INVENTORY_AUTHORITY_SCHEMA_VERSION,
    organizationId,
    menuItemId: command.menuItemId,
    reviewedCatalogRevision,
    reviewedRecipeRevision,
    reviewedRecipeDigest: value.reviewedRecipeDigest,
    draftDigest: value.draftDigest,
    changedIngredientIds,
    dependencyEvidence,
    affectedMenuItems,
    complete: true,
    limit: INVENTORY_MENU_COST_PROJECTION_LIMIT,
    dependencyPreflightDigest: value.dependencyPreflightDigest
  });
}

export async function getInventoryRecipeDependencyPreflight(input = {}) {
  const { access } = requireAuthorityReadAccess(input);
  const command = normalizeRecipeCommand(input.command, { requireDependencyPreflight: false });
  const payload = {
    schemaVersion: INVENTORY_AUTHORITY_SCHEMA_VERSION,
    organizationId: access.organizationId,
    recipeDependencyPreflight: command
  };
  const call = httpsCallable(cloudFunctions, INVENTORY_AUTHORITY_CALLABLES.readWorkspace);
  const response = await call(payload);
  return normalizeInventoryRecipeDependencyPreflightResult(
    response?.data,
    access.organizationId,
    command
  );
}

function normalizeIngredientTraceMovement(value, baseUnitId) {
  const commonKeys = [
    "movementId", "receiptId", "commandKind", "kind", "quantityMicros", "quantity",
    "baseUnitId", "occurredAtISO", "recordedAtISO"
  ];
  const eventKeys = [
    "direction", "quoteId", "eventPlanId", "eventRequirementRevisionId",
    "eventExecutionRevisionId", "consumedQuantityMicros", "consumedQuantity",
    "wasteQuantityMicros", "wasteQuantity"
  ];
  const keys = value?.kind === "receive_stock" ? [...commonKeys, "sourceLabel"]
    : ["event_depletion", "event_depletion_correction"].includes(value?.kind)
      ? [...commonKeys, ...eventKeys]
      : commonKeys;
  exactKeys(value, keys, "Ingredient movement summary", "data-loss");
  const expectedCommandKind = value.kind === "opening_balance" ? "opening_balance"
    : value.kind === "receive_stock" ? "receive_stock"
      : value.kind === "event_depletion" ? "record_event_ingredient_execution"
        : value.kind === "event_depletion_correction" ? "correct_event_ingredient_execution"
          : "";
  const quantityMicros = exactSafeInteger(value.quantityMicros, "ingredient movement quantity", {
    minimum: 1, code: "data-loss"
  });
  if (!expectedCommandKind || value.commandKind !== expectedCommandKind
    || !MOVEMENT_ID_PATTERN.test(value.movementId)
    || !RECEIPT_ID_PATTERN.test(value.receiptId)
    || baseUnit(value.baseUnitId, "ingredient movement base unit", "data-loss") !== baseUnitId
    || parseQuantityMicros(value.quantity, "ingredient movement quantity", { code: "data-loss" }) !== quantityMicros) {
    throw clientError("data-loss", "Ingredient movement summary is inconsistent.");
  }
  const movement = {
    movementId: value.movementId,
    receiptId: value.receiptId,
    commandKind: value.commandKind,
    kind: value.kind,
    quantityMicros,
    quantity: value.quantity,
    baseUnitId,
    occurredAtISO: exactIso(value.occurredAtISO, "ingredient movement occurrence time"),
    recordedAtISO: exactIso(value.recordedAtISO, "ingredient movement record time")
  };
  if (value.kind === "receive_stock") {
    movement.sourceLabel = exactText(value.sourceLabel, "ingredient receiving source", 120, { code: "data-loss" });
  }
  if (["event_depletion", "event_depletion_correction"].includes(value.kind)) {
    const consumedQuantityMicros = exactSafeInteger(value.consumedQuantityMicros, "event consumed quantity");
    const wasteQuantityMicros = exactSafeInteger(value.wasteQuantityMicros, "event waste quantity");
    if (!EVENT_PLAN_ID_PATTERN.test(value.eventPlanId)
      || !EVENT_REQUIREMENT_REVISION_ID_PATTERN.test(value.eventRequirementRevisionId)
      || !EVENT_EXECUTION_REVISION_ID_PATTERN.test(value.eventExecutionRevisionId)
      || !["decrease", "increase"].includes(value.direction)
      || formatQuantityMicros(consumedQuantityMicros, "event consumed quantity") !== value.consumedQuantity
      || formatQuantityMicros(wasteQuantityMicros, "event waste quantity") !== value.wasteQuantity) {
      throw clientError("data-loss", "Event ingredient movement summary is inconsistent.");
    }
    Object.assign(movement, {
      direction: value.direction,
      quoteId: identifier(value.quoteId, "event movement quote identity", "data-loss"),
      eventPlanId: value.eventPlanId,
      eventRequirementRevisionId: value.eventRequirementRevisionId,
      eventExecutionRevisionId: value.eventExecutionRevisionId,
      consumedQuantityMicros,
      consumedQuantity: value.consumedQuantity,
      wasteQuantityMicros,
      wasteQuantity: value.wasteQuantity
    });
  }
  return movement;
}

export function normalizeInventoryIngredientTraceResult(
  value,
  expectedOrganizationId,
  expectedIngredientId,
  expectedRevisions,
  expectedCursor = undefined
) {
  exactKeys(value, [
    "schemaVersion", "organizationId", "ingredientId", "ingredientRevision", "stockRevision",
    "allocationRevision", "baseUnitId", "movements", "movementPage", "commitments"
  ], "Ingredient trace result", "data-loss");
  const organizationId = identifier(expectedOrganizationId, "expected organizationId", "data-loss");
  const ingredientId = identifier(expectedIngredientId, "expected ingredientId", "data-loss");
  exactKeys(expectedRevisions, ["ingredientRevision", "stockRevision", "allocationRevision"], "Expected ingredient trace revisions");
  const ingredientRevision = exactRevision(value.ingredientRevision, "ingredient trace ingredient revision", { allowZero: false, code: "data-loss" });
  const stockRevision = exactRevision(value.stockRevision, "ingredient trace stock revision", { code: "data-loss" });
  const allocationRevision = exactRevision(value.allocationRevision, "ingredient trace allocation revision", { code: "data-loss" });
  if (value.schemaVersion !== INVENTORY_AUTHORITY_SCHEMA_VERSION
    || value.organizationId !== organizationId || value.ingredientId !== ingredientId
    || ingredientRevision !== exactRevision(expectedRevisions.ingredientRevision, "expected ingredient revision", { allowZero: false })
    || stockRevision !== exactRevision(expectedRevisions.stockRevision, "expected stock revision")
    || allocationRevision !== exactRevision(expectedRevisions.allocationRevision, "expected allocation revision")) {
    throw clientError("data-loss", "Ingredient trace result crossed its authority scope or stale revision fence.");
  }
  const baseUnitId = baseUnit(value.baseUnitId, "ingredient trace base unit", "data-loss");
  if (!Array.isArray(value.movements) || value.movements.length > INVENTORY_INGREDIENT_TRACE_LIMIT) {
    throw clientError("data-loss", "Ingredient movement page exceeds its bounded contract.");
  }
  const movements = value.movements.map((movement) => normalizeIngredientTraceMovement(movement, baseUnitId));
  const movementIds = new Set();
  movements.forEach((movement, index) => {
    if (movementIds.has(movement.movementId) || (index > 0 && (
      movements[index - 1].recordedAtISO < movement.recordedAtISO
      || (movements[index - 1].recordedAtISO === movement.recordedAtISO
        && compareCodePoints(movements[index - 1].movementId, movement.movementId) <= 0)
    ))) {
      throw clientError("data-loss", "Ingredient movement page is not a stable ordered set.");
    }
    movementIds.add(movement.movementId);
  });
  exactKeys(value.movementPage, [
    "limit", "size", "bounded", "complete", "hasNext", "cursor", "nextCursor"
  ], "Ingredient movement page metadata", "data-loss");
  const cursor = ingredientTraceCursor(value.movementPage.cursor, "data-loss");
  const nextCursor = ingredientTraceCursor(value.movementPage.nextCursor, "data-loss");
  if (expectedCursor !== undefined) {
    const requestedCursor = ingredientTraceCursor(expectedCursor, "data-loss");
    if (cursor?.recordedAtISO !== requestedCursor?.recordedAtISO
      || cursor?.movementId !== requestedCursor?.movementId) {
      throw clientError("data-loss", "Ingredient movement page did not echo its requested stable cursor.");
    }
  }
  const hasNext = exactBoolean(value.movementPage.hasNext, "ingredient movement hasNext");
  const complete = exactBoolean(value.movementPage.complete, "ingredient movement completeness");
  if (value.movementPage.limit !== INVENTORY_INGREDIENT_TRACE_LIMIT
    || value.movementPage.size !== movements.length
    || value.movementPage.bounded !== true
    || complete === hasNext
    || hasNext !== Boolean(nextCursor)
    || (nextCursor && (!movements.length
      || nextCursor.recordedAtISO !== movements.at(-1).recordedAtISO
      || nextCursor.movementId !== movements.at(-1).movementId))) {
    throw clientError("data-loss", "Ingredient movement page metadata is inconsistent.");
  }
  exactKeys(value.commitments, [
    "complete", "fenceRevision", "totalQuantityMicros", "totalQuantity", "rows"
  ], "Ingredient commitment summary", "data-loss");
  const fenceRevision = exactRevision(value.commitments.fenceRevision, "ingredient commitment fence revision", { code: "data-loss" });
  const totalQuantityMicros = exactSafeInteger(value.commitments.totalQuantityMicros, "ingredient commitment total");
  if (value.commitments.complete !== true || fenceRevision !== allocationRevision
    || formatQuantityMicros(totalQuantityMicros, "ingredient commitment total") !== value.commitments.totalQuantity
    || !Array.isArray(value.commitments.rows) || value.commitments.rows.length > 300) {
    throw clientError("data-loss", "Ingredient commitment summary is incomplete or inconsistent.");
  }
  let reconciledMicros = 0;
  const rows = value.commitments.rows.map((row, index) => {
    exactKeys(row, [
      "quoteId", "eventPlanId", "eventRequirementRevisionId", "allocationRevision", "planState",
      "requiredByISO", "allocatedQuantityMicros", "allocatedQuantity"
    ], `Ingredient commitment row ${index + 1}`, "data-loss");
    const allocatedQuantityMicros = exactSafeInteger(row.allocatedQuantityMicros, "ingredient commitment quantity", {
      minimum: 1, code: "data-loss"
    });
    if (!EVENT_PLAN_ID_PATTERN.test(row.eventPlanId)
      || !EVENT_REQUIREMENT_REVISION_ID_PATTERN.test(row.eventRequirementRevisionId)
      || !["reserved", "shortage"].includes(row.planState)
      || formatQuantityMicros(allocatedQuantityMicros, "ingredient commitment quantity") !== row.allocatedQuantity) {
      throw clientError("data-loss", "Ingredient commitment row is inconsistent.");
    }
    reconciledMicros += allocatedQuantityMicros;
    return {
      quoteId: identifier(row.quoteId, "ingredient commitment quote identity", "data-loss"),
      eventPlanId: row.eventPlanId,
      eventRequirementRevisionId: row.eventRequirementRevisionId,
      allocationRevision: exactRevision(row.allocationRevision, "ingredient commitment allocation revision", { allowZero: false, code: "data-loss" }),
      planState: row.planState,
      requiredByISO: exactIso(row.requiredByISO, "ingredient commitment required time"),
      allocatedQuantityMicros,
      allocatedQuantity: row.allocatedQuantity
    };
  });
  if (reconciledMicros !== totalQuantityMicros) {
    throw clientError("data-loss", "Ingredient commitment rows do not reconcile to the displayed total.");
  }
  return deepFreeze({
    schemaVersion: INVENTORY_AUTHORITY_SCHEMA_VERSION,
    organizationId,
    ingredientId,
    ingredientRevision,
    stockRevision,
    allocationRevision,
    baseUnitId,
    movements,
    movementPage: {
      limit: INVENTORY_INGREDIENT_TRACE_LIMIT,
      size: movements.length,
      bounded: true,
      complete,
      hasNext,
      cursor,
      nextCursor
    },
    commitments: {
      complete: true,
      fenceRevision,
      totalQuantityMicros,
      totalQuantity: value.commitments.totalQuantity,
      rows
    }
  });
}

export async function getInventoryIngredientTrace(input = {}) {
  const { access } = requireAuthorityReadAccess(input);
  const ingredientId = identifier(input.ingredientId, "ingredientId");
  const expectedRevisions = {
    ingredientRevision: exactRevision(input.expectedIngredientRevision, "expected ingredient revision", { allowZero: false }),
    stockRevision: exactRevision(input.expectedStockRevision, "expected stock revision"),
    allocationRevision: exactRevision(input.expectedAllocationRevision, "expected allocation revision")
  };
  const payload = {
    schemaVersion: INVENTORY_AUTHORITY_SCHEMA_VERSION,
    organizationId: access.organizationId,
    ingredientId,
    expectedIngredientRevision: expectedRevisions.ingredientRevision,
    expectedStockRevision: expectedRevisions.stockRevision,
    expectedAllocationRevision: expectedRevisions.allocationRevision,
    cursor: ingredientTraceCursor(input.cursor)
  };
  const call = httpsCallable(cloudFunctions, INVENTORY_AUTHORITY_CALLABLES.readWorkspace);
  const response = await call(payload);
  return normalizeInventoryIngredientTraceResult(
    response?.data,
    access.organizationId,
    ingredientId,
    expectedRevisions,
    payload.cursor
  );
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
  exactKeys(value, [
    "availability", "stockRevision", "onHandMicros", "quantity", "locationId", "lastMovementId",
    "allocationRevision", "committedMicros", "committedQuantity", "availableToAllocateMicros",
    "availableToAllocateQuantity"
  ], "Ingredient stock projection", "data-loss");
  if (!["current", "not_yet_available"].includes(value.availability)) {
    throw clientError("data-loss", "Ingredient stock projection availability is invalid.");
  }
  const revision = exactRevision(value.stockRevision, "stock projection revision", { code: "data-loss" });
  const onHandMicros = exactSafeInteger(value.onHandMicros, "stock on-hand micros");
  const allocationRevision = exactRevision(value.allocationRevision, "stock allocation revision", { code: "data-loss" });
  const committedMicros = exactSafeInteger(value.committedMicros, "stock committed micros");
  const availableToAllocateMicros = exactSafeInteger(value.availableToAllocateMicros, "stock available-to-allocate micros");
  const quantity = formatQuantityMicros(onHandMicros, "stock on-hand micros");
  const committedQuantity = formatQuantityMicros(committedMicros, "stock committed micros");
  const availableToAllocateQuantity = formatQuantityMicros(availableToAllocateMicros, "stock available-to-allocate micros");
  if (value.quantity !== quantity || value.committedQuantity !== committedQuantity
    || value.availableToAllocateQuantity !== availableToAllocateQuantity
    || committedMicros > onHandMicros || availableToAllocateMicros !== onHandMicros - committedMicros) {
    throw clientError("data-loss", "Ingredient stock projection quantities contradict their fixed-point evidence.");
  }
  if (value.availability === "not_yet_available") {
    if (revision !== 0 || onHandMicros !== 0 || allocationRevision !== 0 || committedMicros !== 0
      || value.locationId !== "" || value.lastMovementId !== "") {
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
    allocationRevision,
    committedMicros,
    committedQuantity,
    availableToAllocateMicros,
    availableToAllocateQuantity,
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

function normalizePackConversionProjection(value, ingredient, index) {
  exactKeys(value, [
    "packUnitId", "packLabel", "revision", "packConversionRevisionId", "baseUnitId",
    "baseQuantity", "sourceLabel"
  ], `Ingredient pack conversion ${index + 1}`, "data-loss");
  if (value.baseUnitId !== ingredient.baseUnitId
    || !PACK_CONVERSION_REVISION_ID_PATTERN.test(value.packConversionRevisionId)) {
    throw clientError("data-loss", "Ingredient pack conversion projection has invalid provenance.");
  }
  parseQuantityMicros(value.baseQuantity, "projected pack base quantity", { code: "data-loss" });
  return {
    unitKind: "ingredient_pack",
    packUnitId: identifier(value.packUnitId, "projected pack unit", "data-loss"),
    packLabel: exactText(value.packLabel, "projected pack label", 80, { code: "data-loss" }),
    label: value.packLabel,
    revision: exactRevision(value.revision, "projected pack revision", { allowZero: false, code: "data-loss" }),
    packConversionRevisionId: value.packConversionRevisionId,
    baseUnitId: value.baseUnitId,
    baseQuantity: value.baseQuantity,
    sourceLabel: exactText(value.sourceLabel, "projected pack source", 120, { code: "data-loss" })
  };
}

export function normalizeInventoryIngredientProjection(value, expectedOrganizationId, expectedDocumentId) {
  exactKeys(value, [
    "authorityVersion", "schemaVersion", "model", "organizationId", "ingredientId", "name", "nameSortKey",
    "category", "baseUnitId", "dimension", "active", "ingredientRevision", "stock", "cost", "packConversions", "updatedAtISO"
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
  if (!Array.isArray(value.packConversions) || value.packConversions.length > INVENTORY_INGREDIENT_PROJECTION_LIMIT) {
    throw clientError("data-loss", "Ingredient pack conversion projection is not bounded.");
  }
  ingredient.packConversions = value.packConversions.map((entry, index) => normalizePackConversionProjection(entry, ingredient, index));
  const packKeys = ingredient.packConversions.map((entry) => `${entry.packLabel}\u0000${entry.packUnitId}`);
  if (packKeys.some((key, index) => index > 0 && compareCodePoints(packKeys[index - 1], key) > 0)
    || new Set(ingredient.packConversions.map((entry) => entry.packUnitId)).size !== ingredient.packConversions.length) {
    throw clientError("data-loss", "Ingredient pack conversion projection order is invalid.");
  }
  ingredient.supportedRecipeUnits = [
    ...Object.entries(INVENTORY_BASE_UNITS)
      .filter(([, dimension]) => dimension === ingredient.dimension)
      .map(([unitId]) => ({ unitKind: "standard", unitId })),
    ...ingredient.packConversions
  ];
  ingredient.updatedAtISO = exactIso(value.updatedAtISO, "ingredient projection update time");
  ingredient.locationId = ingredient.stock.locationId;
  return deepFreeze(ingredient);
}

function exactRational(value, label) {
  exactKeys(value, ["numerator", "denominator"], label, "data-loss");
  if (typeof value.numerator !== "string" || typeof value.denominator !== "string"
    || !/^(0|[1-9]\d*)$/u.test(value.numerator) || !/^[1-9]\d*$/u.test(value.denominator)) {
    throw clientError("data-loss", `${label} is not an exact non-negative rational value.`);
  }
  return { numerator: value.numerator, denominator: value.denominator };
}

function moneyDisplayFromRational(value, currency) {
  const numerator = BigInt(value.numerator);
  const denominator = BigInt(value.denominator);
  const minor = (numerator * 2n + denominator) / (denominator * 2n);
  if (minor > BigInt(Number.MAX_SAFE_INTEGER)) return "";
  return new Intl.NumberFormat("en-US", { style: "currency", currency }).format(Number(minor) / 100);
}

function normalizeStoredRecipeLine(value, index) {
  try {
    return normalizeRecipeLine(value, index);
  } catch (error) {
    throw clientError("data-loss", error?.message || `Projected recipe line ${index + 1} is invalid.`);
  }
}

function normalizeMenuCostResult(value, organizationId, menuItemId, recipeRevisionId) {
  if (!isRecord(value)) throw clientError("data-loss", "Menu cost result is unavailable.");
  const commonKeys = [
    "authorityVersion", "schemaVersion", "costingVersion", "organizationId", "menuItemId",
    "recipeRevisionId", "recipeDigest", "status", "outputYield", "outputUnitId", "ingredients",
    "coverage", "issues", "resultDigest"
  ];
  const optionalKeys = [
    "currency", "exactKnownCostMinor", "knownCostMinor", "projectedCostMinor", "exactCostPerOutputUnitMinor"
  ].filter((key) => Object.hasOwn(value, key));
  exactKeys(value, [...commonKeys, ...optionalKeys], "Menu cost result", "data-loss");
  if (value.authorityVersion !== INVENTORY_AUTHORITY_VERSION
    || value.schemaVersion !== INVENTORY_AUTHORITY_SCHEMA_VERSION
    || value.costingVersion !== "ingredient-recipe-cost-v2"
    || value.organizationId !== organizationId || value.menuItemId !== menuItemId
    || value.recipeRevisionId !== recipeRevisionId
    || !["complete", "partial", "invalid", "unavailable"].includes(value.status)
    || !Array.isArray(value.ingredients) || value.ingredients.length > INVENTORY_MAX_PUBLISHED_RECIPE_LINES
    || !Array.isArray(value.issues) || value.issues.length > (INVENTORY_MAX_PUBLISHED_RECIPE_LINES * 3) + 4
    || typeof value.resultDigest !== "string") {
    throw clientError("data-loss", "Menu cost result crossed its authority boundary.");
  }
  exactKeys(value.coverage, [
    "expectedIngredientCount", "normalizedIngredientCount", "costedIngredientCount", "missingCostIngredientCount"
  ], "Menu cost coverage", "data-loss");
  Object.values(value.coverage).forEach((count) => exactSafeInteger(count, "menu cost coverage count"));
  const ingredients = value.ingredients.map((row, index) => {
    if (!isRecord(row)) throw clientError("data-loss", `Menu cost ingredient ${index + 1} is invalid.`);
    const allowed = new Set([
      "ingredientId", "ingredientRevision", "baseUnitId", "requiredBaseQuantityMicros", "lineIds",
      "conversionProvenance", "costAvailability", "costRevision", "costEvidenceId", "currency", "exactCostMinor"
    ]);
    if (Object.keys(row).some((key) => !allowed.has(key))) {
      throw clientError("data-loss", `Menu cost ingredient ${index + 1} contains unsupported evidence.`);
    }
    const required = [
      "ingredientId", "ingredientRevision", "baseUnitId", "requiredBaseQuantityMicros", "lineIds",
      "conversionProvenance", "costAvailability"
    ];
    if (required.some((key) => !Object.hasOwn(row, key))) {
      throw clientError("data-loss", `Menu cost ingredient ${index + 1} is incomplete.`);
    }
    identifier(row.ingredientId, `menu cost ingredient ${index + 1}`, "data-loss");
    exactRevision(row.ingredientRevision, `menu cost ingredient ${index + 1} revision`, { allowZero: false, code: "data-loss" });
    baseUnit(row.baseUnitId, `menu cost ingredient ${index + 1} base unit`, "data-loss");
    exactRational(row.requiredBaseQuantityMicros, `menu cost ingredient ${index + 1} quantity`);
    if (!Array.isArray(row.lineIds) || !Array.isArray(row.conversionProvenance)) {
      throw clientError("data-loss", `Menu cost ingredient ${index + 1} provenance is invalid.`);
    }
    if (Object.hasOwn(row, "exactCostMinor")) exactRational(row.exactCostMinor, `menu cost ingredient ${index + 1} exact cost`);
    return canonicalClone(row, `Menu cost ingredient ${index + 1}`);
  });
  let currency = "";
  if (Object.hasOwn(value, "currency")) {
    if (typeof value.currency !== "string" || !CURRENCY_PATTERN.test(value.currency)) {
      throw clientError("data-loss", "Menu cost currency is invalid.");
    }
    currency = value.currency;
    exactRational(value.exactKnownCostMinor, "exact known recipe cost");
    exactSafeInteger(value.knownCostMinor, "known recipe cost");
  }
  if (value.status === "complete") {
    if (!currency || !Object.hasOwn(value, "projectedCostMinor") || !Object.hasOwn(value, "exactCostPerOutputUnitMinor")) {
      throw clientError("data-loss", "Complete menu cost lacks exact output-boundary money.");
    }
    exactSafeInteger(value.projectedCostMinor, "projected recipe cost");
    exactRational(value.exactCostPerOutputUnitMinor, "exact cost per recipe output unit");
  }
  return { ...canonicalClone(value, "Menu cost result"), ingredients, currency };
}

export function normalizeInventoryMenuCostProjection(value, expectedOrganizationId, expectedDocumentId) {
  exactKeys(value, [
    "authorityVersion", "schemaVersion", "model", "organizationId", "menuItemId", "menuItemName",
    "menuItemNameSortKey", "observedCatalogRevision", "menuIdentityDigest", "recipeRevision",
    "recipeRevisionId", "recipeDigest", "policyDigest", "recipeDefinition", "status", "freshness",
    "staleReason", "cost", "updatedAtISO", "sourceDigest"
  ], "Inventory menu cost projection", "data-loss");
  const organizationId = identifier(expectedOrganizationId, "expected organizationId");
  const menuItemId = identifier(value.menuItemId, "menu cost menuItemId", "data-loss");
  const name = exactText(value.menuItemName, "menu cost item name", 120, { code: "data-loss" });
  if (value.authorityVersion !== INVENTORY_AUTHORITY_VERSION
    || value.schemaVersion !== INVENTORY_AUTHORITY_SCHEMA_VERSION
    || value.model !== "inventory-menu-cost-projection-v2"
    || value.organizationId !== organizationId || menuItemId !== expectedDocumentId
    || value.menuItemNameSortKey !== name.toLocaleLowerCase("en-US")
    || !["complete", "partial", "invalid", "unavailable", "stale"].includes(value.status)
    || !["current", "stale"].includes(value.freshness)
    || (value.freshness === "current" && (value.staleReason !== "" || value.status === "stale"))
    || (value.freshness === "stale" && (typeof value.staleReason !== "string" || !value.staleReason || value.status !== "stale"))) {
    throw clientError("data-loss", "Inventory menu cost projection is internally inconsistent.");
  }
  const recipeRevision = exactRevision(value.recipeRevision, "menu cost recipe revision", { allowZero: false, code: "data-loss" });
  if (!RECIPE_REVISION_ID_PATTERN.test(value.recipeRevisionId)) {
    throw clientError("data-loss", "Menu cost recipe revision identity is invalid.");
  }
  exactKeys(value.recipeDefinition, [
    "revision", "recipeRevisionId", "recipeDigest", "outputYield", "outputUnitId", "lines", "definitionDigest"
  ], "Projected recipe definition", "data-loss");
  if (value.recipeDefinition.revision !== recipeRevision
    || value.recipeDefinition.recipeRevisionId !== value.recipeRevisionId
    || value.recipeDefinition.recipeDigest !== value.recipeDigest
    || !Array.isArray(value.recipeDefinition.lines)
    || value.recipeDefinition.lines.length > INVENTORY_MAX_PUBLISHED_RECIPE_LINES) {
    throw clientError("data-loss", "Projected recipe definition is inconsistent.");
  }
  const recipeDefinition = {
    revision: recipeRevision,
    recipeRevision,
    recipeRevisionId: value.recipeRevisionId,
    recipeDigest: value.recipeDigest,
    outputYield: value.recipeDefinition.outputYield,
    outputUnitId: identifier(value.recipeDefinition.outputUnitId, "projected recipe output unit", "data-loss"),
    lines: value.recipeDefinition.lines.map(normalizeStoredRecipeLine),
    definitionDigest: value.recipeDefinition.definitionDigest
  };
  const cost = normalizeMenuCostResult(value.cost, organizationId, menuItemId, value.recipeRevisionId);
  if (value.freshness === "current" && value.status !== cost.status) {
    throw clientError("data-loss", "Current menu cost status contradicts its calculation.");
  }
  const projection = {
    authorityVersion: INVENTORY_AUTHORITY_VERSION,
    schemaVersion: INVENTORY_AUTHORITY_SCHEMA_VERSION,
    model: value.model,
    organizationId,
    menuItemId,
    menuItemName: name,
    menuItemNameSortKey: value.menuItemNameSortKey,
    observedCatalogRevision: exactRevision(value.observedCatalogRevision, "observed catalog revision", { code: "data-loss" }),
    menuIdentityDigest: value.menuIdentityDigest,
    recipeRevision,
    recipeRevisionId: value.recipeRevisionId,
    recipeDigest: value.recipeDigest,
    policyDigest: value.policyDigest,
    recipeDefinition,
    status: value.status,
    freshness: value.freshness,
    staleReason: value.staleReason,
    cost,
    coverage: cost.coverage,
    issues: cost.issues,
    yieldLabel: `${recipeDefinition.outputYield || "Unknown"} ${recipeDefinition.outputUnitId}`,
    updatedAtISO: exactIso(value.updatedAtISO, "menu cost projection update time"),
    sourceDigest: value.sourceDigest
  };
  if (cost.currency && cost.exactCostPerOutputUnitMinor) {
    projection.costPerYieldUnitDisplay = moneyDisplayFromRational(cost.exactCostPerOutputUnitMinor, cost.currency);
  }
  if (cost.currency && Number.isSafeInteger(cost.projectedCostMinor ?? cost.knownCostMinor)) {
    const minor = cost.projectedCostMinor ?? cost.knownCostMinor;
    projection.projectedIngredientCostDisplay = new Intl.NumberFormat("en-US", {
      style: "currency", currency: cost.currency
    }).format(minor / 100);
  }
  return deepFreeze(projection);
}

function assertAllowedKeys(value, required, allowed, label, code = "data-loss") {
  if (!isRecord(value)
    || required.some((key) => !Object.hasOwn(value, key))
    || Object.keys(value).some((key) => !allowed.includes(key) || POISON_KEYS.has(key))) {
    throw clientError(code, `${label} contains missing or unsupported fields.`);
  }
}

function eventDigest(value, label) {
  if (typeof value !== "string" || !SHA256_PATTERN.test(value)) {
    throw clientError("data-loss", `${label} is invalid.`);
  }
  return value;
}

function normalizeCompiledEventSelection(value, index) {
  const baseKeys = [
    "selectionId", "menuItemId", "recipeRevisionId", "requiredOutputQuantity", "outputUnitId",
    "portionBasis", "commercialProvenance", "demandState", "costState"
  ];
  const optionalKeys = [
    "recipeDigest", "recipeOutputYield", "recipeCostResultDigest", "currency",
    "exactKnownCostMinor", "knownCostMinor", "projectedCostMinor"
  ];
  assertAllowedKeys(value, baseKeys, [...baseKeys, ...optionalKeys], `Compiled event menu selection ${index + 1}`);
  const normalized = normalizeEventMenuSelection(Object.fromEntries([
    "selectionId", "menuItemId", "recipeRevisionId", "requiredOutputQuantity", "outputUnitId",
    "portionBasis", "commercialProvenance"
  ].map((key) => [key, value[key]])), index, "data-loss");
  if (!["complete", "incomplete", "invalid"].includes(value.demandState)
    || !["complete", "partial", "unavailable", "invalid"].includes(value.costState)) {
    throw clientError("data-loss", `Compiled event menu selection ${index + 1} has invalid rail states.`);
  }
  const result = { ...normalized, demandState: value.demandState, costState: value.costState };
  if (Object.hasOwn(value, "recipeDigest")) result.recipeDigest = eventDigest(value.recipeDigest, "recipe digest");
  if (Object.hasOwn(value, "recipeOutputYield")) {
    parseQuantityMicros(value.recipeOutputYield, `compiled event menu selection ${index + 1} recipe yield`, { code: "data-loss" });
    result.recipeOutputYield = value.recipeOutputYield;
  }
  if (Object.hasOwn(value, "recipeCostResultDigest")) {
    result.recipeCostResultDigest = eventDigest(value.recipeCostResultDigest, "recipe cost result digest");
  }
  if (Object.hasOwn(value, "currency")) {
    if (typeof value.currency !== "string" || !CURRENCY_PATTERN.test(value.currency)) {
      throw clientError("data-loss", `Compiled event menu selection ${index + 1} currency is invalid.`);
    }
    result.currency = value.currency;
  }
  if (Object.hasOwn(value, "exactKnownCostMinor")) result.exactKnownCostMinor = exactRational(value.exactKnownCostMinor, "selection exact known cost");
  for (const key of ["knownCostMinor", "projectedCostMinor"]) {
    if (Object.hasOwn(value, key)) result[key] = exactSafeInteger(value[key], `selection ${key}`);
  }
  return result;
}

function normalizeEventContribution(value, index, selectionIds) {
  const baseKeys = [
    "selectionId", "menuItemId", "recipeRevisionId", "recipeDigest", "requiredOutputQuantity",
    "outputUnitId", "portionBasis", "commercialProvenance", "exactRequiredQuantityMicros", "costAvailability"
  ];
  const optionalKeys = ["currency", "costRevision", "costEvidenceId", "exactCostMinor"];
  assertAllowedKeys(value, baseKeys, [...baseKeys, ...optionalKeys], `Event ingredient contribution ${index + 1}`);
  if (!selectionIds.has(value.selectionId)) {
    throw clientError("data-loss", `Event ingredient contribution ${index + 1} references an unknown selection.`);
  }
  const normalizedSelection = normalizeEventMenuSelection({
    selectionId: value.selectionId,
    menuItemId: value.menuItemId,
    recipeRevisionId: value.recipeRevisionId,
    requiredOutputQuantity: value.requiredOutputQuantity,
    outputUnitId: value.outputUnitId,
    portionBasis: value.portionBasis,
    commercialProvenance: value.commercialProvenance
  }, index, "data-loss");
  const result = {
    ...normalizedSelection,
    recipeDigest: eventDigest(value.recipeDigest, "contribution recipe digest"),
    exactRequiredQuantityMicros: exactRational(value.exactRequiredQuantityMicros, "contribution exact quantity"),
    costAvailability: COST_AVAILABILITY.has(value.costAvailability)
      ? value.costAvailability
      : (() => { throw clientError("data-loss", "Contribution cost availability is invalid."); })()
  };
  if (Object.hasOwn(value, "currency")) {
    if (typeof value.currency !== "string" || !CURRENCY_PATTERN.test(value.currency)) {
      throw clientError("data-loss", "Contribution currency is invalid.");
    }
    result.currency = value.currency;
  }
  if (Object.hasOwn(value, "costRevision")) result.costRevision = exactRevision(value.costRevision, "contribution cost revision", { allowZero: false, code: "data-loss" });
  if (Object.hasOwn(value, "costEvidenceId")) {
    if (!COST_EVIDENCE_ID_PATTERN.test(value.costEvidenceId)) throw clientError("data-loss", "Contribution cost evidence identity is invalid.");
    result.costEvidenceId = value.costEvidenceId;
  }
  if (Object.hasOwn(value, "exactCostMinor")) result.exactCostMinor = exactRational(value.exactCostMinor, "contribution exact cost");
  const hasCostEvidence = ["currency", "costRevision", "costEvidenceId", "exactCostMinor"]
    .filter((key) => Object.hasOwn(value, key)).length;
  if ((result.costAvailability === "available" && hasCostEvidence !== 4)
    || (result.costAvailability !== "available" && hasCostEvidence !== 0)) {
    throw clientError("data-loss", "Contribution cost evidence contradicts its availability state.");
  }
  return result;
}

function normalizeEventIngredientRow(value, index, selectionIds) {
  const baseKeys = [
    "ingredientId", "baseUnitId", "exactRequiredQuantityMicros", "requiredQuantityMicros",
    "contributions", "costState", "availabilityState"
  ];
  const optionalKeys = [
    "exactKnownCostMinor", "knownCostMinor", "currency", "projectedCostMinor", "onHandQuantityMicros",
    "committedQuantityMicros", "availableToAllocateQuantityMicros", "shortageQuantityMicros"
  ];
  assertAllowedKeys(value, baseKeys, [...baseKeys, ...optionalKeys], `Event ingredient row ${index + 1}`);
  if (!Array.isArray(value.contributions) || value.contributions.length > 1_000) {
    throw clientError("data-loss", `Event ingredient row ${index + 1} contributions exceed the bounded contract.`);
  }
  const row = {
    ingredientId: identifier(value.ingredientId, `event ingredient ${index + 1}`, "data-loss"),
    baseUnitId: baseUnit(value.baseUnitId, `event ingredient ${index + 1} base unit`, "data-loss"),
    exactRequiredQuantityMicros: exactRational(value.exactRequiredQuantityMicros, "event exact required quantity"),
    requiredQuantityMicros: exactSafeInteger(value.requiredQuantityMicros, "event required quantity micros"),
    contributions: value.contributions.map((entry, contributionIndex) => normalizeEventContribution(entry, contributionIndex, selectionIds)),
    costState: value.costState,
    availabilityState: value.availabilityState
  };
  if (!["complete", "partial", "unavailable", "invalid"].includes(row.costState)
    || !["available", "shortage", "unavailable", "invalid"].includes(row.availabilityState)) {
    throw clientError("data-loss", `Event ingredient row ${index + 1} has invalid rail states.`);
  }
  if (Object.hasOwn(value, "exactKnownCostMinor")) row.exactKnownCostMinor = exactRational(value.exactKnownCostMinor, "ingredient exact known cost");
  if (Object.hasOwn(value, "currency")) {
    if (typeof value.currency !== "string" || !CURRENCY_PATTERN.test(value.currency)) throw clientError("data-loss", "Ingredient currency is invalid.");
    row.currency = value.currency;
  }
  for (const key of [
    "knownCostMinor", "projectedCostMinor", "onHandQuantityMicros", "committedQuantityMicros",
    "availableToAllocateQuantityMicros", "shortageQuantityMicros"
  ]) {
    if (Object.hasOwn(value, key)) row[key] = exactSafeInteger(value[key], `ingredient ${key}`);
  }
  const hasStockEvidence = [
    "onHandQuantityMicros", "committedQuantityMicros", "availableToAllocateQuantityMicros", "shortageQuantityMicros"
  ].filter((key) => Object.hasOwn(row, key)).length;
  if (new Set(["available", "shortage"]).has(row.availabilityState)) {
    if (hasStockEvidence !== 4) throw clientError("data-loss", "Ingredient availability lacks complete stock evidence.");
    const expectedAvailable = Math.max(0, row.onHandQuantityMicros - row.committedQuantityMicros);
    const expectedShortage = Math.max(0, row.requiredQuantityMicros - expectedAvailable);
    if (row.availableToAllocateQuantityMicros !== expectedAvailable
      || row.shortageQuantityMicros !== expectedShortage
      || (row.availabilityState === "shortage") !== (expectedShortage > 0)) {
      throw clientError("data-loss", "Ingredient availability quantities contradict their state.");
    }
  }
  return row;
}

function normalizeIngredientLabels(value) {
  if (!Array.isArray(value) || value.length > 500) {
    throw clientError("data-loss", "Event ingredient labels exceed the bounded read model.");
  }
  const labels = value.map((entry, index) => {
    exactKeys(entry, ["ingredientId", "name"], `Event ingredient label ${index + 1}`, "data-loss");
    return {
      ingredientId: identifier(entry.ingredientId, `event ingredient label ${index + 1} identity`, "data-loss"),
      name: exactText(entry.name, `event ingredient label ${index + 1} name`, 100, { code: "data-loss" })
    };
  });
  if (new Set(labels.map(({ ingredientId }) => ingredientId)).size !== labels.length
    || labels.some((entry, index) => index > 0 && compareCodePoints(labels[index - 1].ingredientId, entry.ingredientId) >= 0)) {
    throw clientError("data-loss", "Event ingredient labels are not a sorted unique set.");
  }
  return labels;
}

function normalizeEventAllocationSummary(value, projection, labelsById, allocationFreshness) {
  exactKeys(value, [
    "state", "eventPlanId", "allocationRevision", "eventRequirementRevisionId", "ingredientCount",
    "fullyAllocatedIngredientCount", "shortageIngredientCount", "ingredients"
  ], "Event ingredient allocation summary", "data-loss");
  if (!new Set(["reserved", "shortage", "released", "settled"]).has(value.state)
    || !EVENT_PLAN_ID_PATTERN.test(value.eventPlanId)
    || !Array.isArray(value.ingredients) || value.ingredients.length > 100) {
    throw clientError("data-loss", "Event ingredient allocation summary identity is invalid.");
  }
  const allocationRevision = exactRevision(value.allocationRevision, "event allocation revision", { allowZero: false, code: "data-loss" });
  const ingredientCount = exactSafeInteger(value.ingredientCount, "event allocation ingredient count", { minimum: 1 });
  const fullyAllocatedIngredientCount = exactSafeInteger(value.fullyAllocatedIngredientCount, "fully allocated ingredient count");
  const shortageIngredientCount = exactSafeInteger(value.shortageIngredientCount, "allocation shortage ingredient count");
  if (ingredientCount !== value.ingredients.length
    || fullyAllocatedIngredientCount + shortageIngredientCount !== ingredientCount
    || (value.state === "reserved" && shortageIngredientCount !== 0)
    || (value.state === "shortage" && shortageIngredientCount === 0)) {
    throw clientError("data-loss", "Event ingredient allocation counts contradict its state.");
  }
  const ingredients = value.ingredients.map((entry, index) => {
    exactKeys(entry, [
      "ingredientId", "locationId", "baseUnitId", "requiredQuantityMicros",
      "allocatedQuantityMicros", "shortageQuantityMicros", "stockRevision", "fenceRevision"
    ], `Allocated event ingredient ${index + 1}`, "data-loss");
    const requiredQuantityMicros = exactSafeInteger(entry.requiredQuantityMicros, "allocated ingredient required micros");
    const allocatedQuantityMicros = exactSafeInteger(entry.allocatedQuantityMicros, "allocated ingredient quantity micros");
    const shortageQuantityMicros = exactSafeInteger(entry.shortageQuantityMicros, "allocated ingredient shortage micros");
    if (allocatedQuantityMicros > requiredQuantityMicros
      || shortageQuantityMicros !== requiredQuantityMicros - allocatedQuantityMicros) {
      throw clientError("data-loss", "Allocated ingredient quantities contradict their requirement.");
    }
    return {
      ingredientId: identifier(entry.ingredientId, `allocated ingredient ${index + 1}`, "data-loss"),
      ingredientName: labelsById.get(entry.ingredientId) || "",
      locationId: identifier(entry.locationId, `allocated ingredient ${index + 1} location`, "data-loss"),
      baseUnitId: baseUnit(entry.baseUnitId, `allocated ingredient ${index + 1} base unit`, "data-loss"),
      stockRevision: exactRevision(entry.stockRevision, `allocated ingredient ${index + 1} stock revision`, { allowZero: false, code: "data-loss" }),
      fenceRevision: exactRevision(entry.fenceRevision, `allocated ingredient ${index + 1} fence revision`, { allowZero: false, code: "data-loss" }),
      requiredQuantityMicros,
      allocatedQuantityMicros,
      shortageQuantityMicros
    };
  });
  if (new Set(ingredients.map(({ ingredientId }) => ingredientId)).size !== ingredients.length
    || ingredients.some((entry, index) => index > 0
      && compareCodePoints(ingredients[index - 1].ingredientId, entry.ingredientId) >= 0)) {
    throw clientError("data-loss", "Allocated ingredients are not a sorted unique set.");
  }
  const projectedById = new Map(projection.ingredients.map((entry) => [entry.ingredientId, entry]));
  const locations = new Set(ingredients.map((entry) => entry.locationId));
  if (locations.size > 1 || (allocationFreshness === "current"
    && (value.eventRequirementRevisionId !== projection.eventRequirementRevisionId
      || ingredients.length !== projection.ingredients.length
      || ingredients.some((entry) => {
      const projected = projectedById.get(entry.ingredientId);
      return !projected || projected.baseUnitId !== entry.baseUnitId
        || projected.requiredQuantityMicros !== entry.requiredQuantityMicros;
      })))) {
    throw clientError("data-loss", "Event ingredient allocation does not match the saved requirement projection.");
  }
  return {
    state: value.state,
    eventPlanId: value.eventPlanId,
    allocationRevision,
    eventRequirementRevisionId: value.eventRequirementRevisionId,
    ingredientCount,
    fullyAllocatedIngredientCount,
    shortageIngredientCount,
    ingredients
  };
}

function normalizeEventProjection(value, expectedOrganizationId, expectedQuoteId, { persisted, ingredientLabels = [] }) {
  const baseKeys = [
    "authorityVersion", "schemaVersion", "projectionVersion", "organizationId", "quoteId", "quoteRevisionId",
    "eventRequirementRevisionId", "requirementDigest", "requiredByISO", "demandState", "costState",
    "availabilityState", "selections", "ingredients", "coverage", "sourceRevisions", "issues", "projectionDigest"
  ];
  const optionalKeys = ["currency", "exactKnownCostMinor", "knownCostMinor", "projectedCostMinor"];
  const persistedKeys = [
    "model", "requirementRevision", "ingredientLabels", "freshness", "staleReason",
    "freshnessState", "updatedAtISO"
  ];
  const persistedOptionalKeys = ["allocation"];
  assertAllowedKeys(value, persisted ? [...baseKeys, ...persistedKeys] : baseKeys,
    [...baseKeys, ...optionalKeys, ...(persisted ? [...persistedKeys, ...persistedOptionalKeys] : [])], "Event ingredient projection");
  const organizationId = identifier(expectedOrganizationId, "expected organizationId");
  const quoteId = identifier(expectedQuoteId, "expected quoteId");
  if (value.authorityVersion !== INVENTORY_AUTHORITY_VERSION
    || value.schemaVersion !== 1
    || value.projectionVersion !== "ingredient-event-projection-v1"
    || value.organizationId !== organizationId
    || value.quoteId !== quoteId
    || !EVENT_REQUIREMENT_REVISION_ID_PATTERN.test(value.eventRequirementRevisionId)) {
    throw clientError("data-loss", "Event ingredient projection crossed its authority boundary.");
  }
  if (!Array.isArray(value.selections)) {
    throw clientError("data-loss", "Event ingredient projection selections are invalid.");
  }
  const selections = value.selections.map(normalizeCompiledEventSelection);
  if (selections.length > INVENTORY_EVENT_SELECTION_LIMIT
    || new Set(selections.map(({ selectionId }) => selectionId)).size !== selections.length) {
    throw clientError("data-loss", "Event ingredient projection selections are not a bounded unique set.");
  }
  if (selections.some((entry, index) => index > 0
    && (compareCodePoints(selections[index - 1].menuItemId, entry.menuItemId) > 0
      || (selections[index - 1].menuItemId === entry.menuItemId
        && compareCodePoints(selections[index - 1].selectionId, entry.selectionId) >= 0)))) {
    throw clientError("data-loss", "Event ingredient projection selections are not deterministically sorted.");
  }
  const selectionIds = new Set(selections.map(({ selectionId }) => selectionId));
  if (!Array.isArray(value.ingredients) || value.ingredients.length > 500 || !Array.isArray(value.issues) || value.issues.length > 1_100) {
    throw clientError("data-loss", "Event ingredient projection exceeds its bounded read model.");
  }
  const normalizedLabels = normalizeIngredientLabels(persisted ? value.ingredientLabels : ingredientLabels);
  const labelsById = new Map(normalizedLabels.map((entry) => [entry.ingredientId, entry.name]));
  const ingredients = value.ingredients.map((entry, index) => {
    const row = normalizeEventIngredientRow(entry, index, selectionIds);
    return { ...row, ingredientName: labelsById.get(row.ingredientId) || "" };
  });
  if (new Set(ingredients.map(({ ingredientId }) => ingredientId)).size !== ingredients.length) {
    throw clientError("data-loss", "Event ingredient projection ingredients are not unique.");
  }
  if (ingredients.some((entry, index) => index > 0
    && compareCodePoints(ingredients[index - 1].ingredientId, entry.ingredientId) >= 0)) {
    throw clientError("data-loss", "Event ingredient projection ingredients are not deterministically sorted.");
  }
  if (ingredients.some((row) => row.contributions.some((entry, index) => index > 0
    && (compareCodePoints(row.contributions[index - 1].menuItemId, entry.menuItemId) > 0
      || (row.contributions[index - 1].menuItemId === entry.menuItemId
        && compareCodePoints(row.contributions[index - 1].selectionId, entry.selectionId) >= 0))))) {
    throw clientError("data-loss", "Event ingredient contributions are not deterministically sorted.");
  }
  if (!["complete", "incomplete", "invalid"].includes(value.demandState)
    || !["complete", "partial", "unavailable", "invalid"].includes(value.costState)
    || !["available", "shortage", "unavailable", "invalid"].includes(value.availabilityState)) {
    throw clientError("data-loss", "Event ingredient projection rail state is invalid.");
  }
  const projection = {
    ...canonicalClone(value, "Event ingredient projection"),
    organizationId,
    quoteId,
    quoteRevisionId: identifier(value.quoteRevisionId, "event source quote revision", "data-loss"),
    eventRequirementRevisionId: value.eventRequirementRevisionId,
    requirementDigest: eventDigest(value.requirementDigest, "event requirement digest"),
    requiredByISO: exactIso(value.requiredByISO, "event ingredient required-by time"),
    demandState: value.demandState,
    costState: value.costState,
    availabilityState: value.availabilityState,
    selections,
    ingredients,
    ingredientLabels: normalizedLabels,
    issues: canonicalClone(value.issues, "Event ingredient projection issues"),
    projectionDigest: eventDigest(value.projectionDigest, "event projection digest")
  };
  exactKeys(value.coverage, [
    "selectedMenuItemCount", "compiledMenuItemCount", "ingredientCount", "costedIngredientCount",
    "knownCostIngredientCount", "stockKnownIngredientCount", "availableIngredientCount", "shortageIngredientCount"
  ], "Event ingredient projection coverage", "data-loss");
  Object.values(value.coverage).forEach((entry) => exactSafeInteger(entry, "event ingredient coverage count"));
  exactKeys(value.sourceRevisions, [
    "recipeRevisionIds", "recipeCostResultDigests", "stockRevisions", "allocationRevisions"
  ], "Event ingredient projection source revisions", "data-loss");
  if (!Array.isArray(value.sourceRevisions.recipeRevisionIds)
    || !Array.isArray(value.sourceRevisions.recipeCostResultDigests)
    || !Array.isArray(value.sourceRevisions.stockRevisions)
    || !Array.isArray(value.sourceRevisions.allocationRevisions)) {
    throw clientError("data-loss", "Event ingredient source revisions are invalid.");
  }
  if (value.sourceRevisions.recipeRevisionIds.length > INVENTORY_EVENT_SELECTION_LIMIT
    || value.sourceRevisions.recipeRevisionIds.some((entry) => !RECIPE_REVISION_ID_PATTERN.test(entry))
    || value.sourceRevisions.recipeCostResultDigests.length > INVENTORY_EVENT_SELECTION_LIMIT
    || value.sourceRevisions.recipeCostResultDigests.some((entry) => !SHA256_PATTERN.test(entry))
    || value.sourceRevisions.stockRevisions.length > 5_000
    || value.sourceRevisions.allocationRevisions.length > 1_000) {
    throw clientError("data-loss", "Event ingredient source revisions exceed their bounded contracts.");
  }
  value.sourceRevisions.stockRevisions.forEach((entry, index) => {
    exactKeys(entry, ["stockStateId", "ingredientId", "locationId", "revision"], `Event stock revision ${index + 1}`, "data-loss");
    identifier(entry.stockStateId, `event stock revision ${index + 1} identity`, "data-loss");
    identifier(entry.ingredientId, `event stock revision ${index + 1} ingredient`, "data-loss");
    identifier(entry.locationId, `event stock revision ${index + 1} location`, "data-loss");
    exactRevision(entry.revision, `event stock revision ${index + 1}`, { allowZero: false, code: "data-loss" });
  });
  value.sourceRevisions.allocationRevisions.forEach((entry, index) => {
    exactKeys(entry, [
      "allocationId", "eventPlanId", "ingredientId", "revision", "sourceRequirementRevisionId"
    ], `Event allocation revision ${index + 1}`, "data-loss");
    identifier(entry.allocationId, `event allocation revision ${index + 1} identity`, "data-loss");
    identifier(entry.eventPlanId, `event allocation revision ${index + 1} plan`, "data-loss");
    identifier(entry.ingredientId, `event allocation revision ${index + 1} ingredient`, "data-loss");
    identifier(entry.sourceRequirementRevisionId, `event allocation revision ${index + 1} requirement`, "data-loss");
    exactRevision(entry.revision, `event allocation revision ${index + 1}`, { allowZero: false, code: "data-loss" });
  });
  if (normalizedLabels.length !== ingredients.length
    || ingredients.some((row, index) => normalizedLabels[index]?.ingredientId !== row.ingredientId)) {
    throw clientError("data-loss", "Event ingredient labels do not cover the projected ingredient set.");
  }
  if (persisted) {
    if (value.model !== "event-ingredient-projection-v1") {
      throw clientError("data-loss", "Event ingredient projection model is invalid.");
    }
    projection.requirementRevision = exactRevision(value.requirementRevision, "event requirement revision", { allowZero: false, code: "data-loss" });
    if (!new Set(["as_recorded", "stale"]).has(value.freshness)
      || (value.freshness === "as_recorded" && value.staleReason !== "")
      || (value.freshness === "stale" && !textValue(value.staleReason))) {
      throw clientError("data-loss", "Event ingredient projection freshness is inconsistent.");
    }
    projection.freshness = value.freshness;
    projection.staleReason = value.staleReason;
    exactKeys(value.freshnessState, ["demand", "cost", "availability", "allocation"], "Event ingredient freshness state", "data-loss");
    const freshnessState = {};
    for (const key of ["demand", "cost", "availability", "allocation"]) {
      exactKeys(value.freshnessState[key], ["state", "reason"], `Event ingredient ${key} freshness`, "data-loss");
      const allowed = key === "allocation"
        ? ["not_allocated", "current", "stale", "released", "settled"]
        : ["current", "stale"];
      const state = value.freshnessState[key].state;
      const rawReason = value.freshnessState[key].reason;
      const reason = textValue(rawReason);
      if (typeof rawReason !== "string" || rawReason !== reason
        || !allowed.includes(state) || (state === "stale") !== Boolean(reason)) {
        throw clientError("data-loss", `Event ingredient ${key} freshness is inconsistent.`);
      }
      freshnessState[key] = { state, reason };
    }
    if ((projection.freshness === "stale") !== (freshnessState.demand.state === "stale")
      || projection.staleReason !== freshnessState.demand.reason) {
      throw clientError("data-loss", "Event ingredient legacy freshness disagrees with demand freshness.");
    }
    projection.freshnessState = freshnessState;
    projection.updatedAtISO = exactIso(value.updatedAtISO, "event ingredient projection update time");
    projection.allocation = Object.hasOwn(value, "allocation")
      ? normalizeEventAllocationSummary(value.allocation, projection, labelsById, freshnessState.allocation.state)
      : null;
    if ((projection.allocation && freshnessState.allocation.state === "not_allocated")
      || (!projection.allocation && !["not_allocated", "released", "settled"].includes(freshnessState.allocation.state))
      || (projection.allocation?.state === "released") !== (freshnessState.allocation.state === "released")
      || (projection.allocation?.state === "settled") !== (freshnessState.allocation.state === "settled")) {
      throw clientError("data-loss", "Event ingredient allocation freshness contradicts its projection.");
    }
  } else {
    projection.freshness = "preview";
    projection.staleReason = "";
  }
  return deepFreeze(projection);
}

function textValue(value) {
  return typeof value === "string" ? value.trim() : "";
}

export function normalizeEventIngredientProjection(value, expectedOrganizationId, expectedQuoteId) {
  return normalizeEventProjection(value, expectedOrganizationId, expectedQuoteId, { persisted: true });
}

function normalizeExactRational(value, label) {
  exactKeys(value, ["numerator", "denominator"], label, "data-loss");
  if (typeof value.numerator !== "string" || !/^(0|[1-9]\d*)$/u.test(value.numerator)
    || typeof value.denominator !== "string" || !/^[1-9]\d*$/u.test(value.denominator)) {
    throw clientError("data-loss", `${label} is not an exact non-negative rational.`);
  }
  const numerator = BigInt(value.numerator);
  const denominator = BigInt(value.denominator);
  let left = numerator;
  let right = denominator;
  while (right !== 0n) [left, right] = [right, left % right];
  if ((numerator === 0n && denominator !== 1n) || (numerator !== 0n && left !== 1n)) {
    throw clientError("data-loss", `${label} is not canonical.`);
  }
  return { numerator: value.numerator, denominator: value.denominator };
}

function normalizeExecutionCostSummary(value, ingredientCount, costedIngredientCount) {
  const required = [
    "actualCogsState", "actualCogsReason", "plannedBasisState", "expectedIngredientCount",
    "costedIngredientCount"
  ];
  const optional = [
    "currency", "exactKnownUsageCostMinor", "knownUsageCostMinor", "plannedProjectedCostMinor",
    "plannedBasisVarianceMinor"
  ];
  assertAllowedKeys(value, required, [...required, ...optional], "Event ingredient execution cost summary");
  if (value.actualCogsState !== "unavailable"
    || value.actualCogsReason !== "valuation_policy_unresolved"
    || !["complete", "partial", "unavailable", "invalid"].includes(value.plannedBasisState)
    || value.expectedIngredientCount !== ingredientCount
    || value.costedIngredientCount !== costedIngredientCount) {
    throw clientError("data-loss", "Event ingredient execution cost boundary is inconsistent.");
  }
  const hasKnownCost = Object.hasOwn(value, "knownUsageCostMinor");
  if (hasKnownCost !== Object.hasOwn(value, "currency")
    || hasKnownCost !== Object.hasOwn(value, "exactKnownUsageCostMinor")
    || (value.plannedBasisState === "complete") !== Object.hasOwn(value, "plannedProjectedCostMinor")
    || (value.plannedBasisState === "complete") !== Object.hasOwn(value, "plannedBasisVarianceMinor")) {
    throw clientError("data-loss", "Event ingredient execution cost summary completeness is inconsistent.");
  }
  if (hasKnownCost) {
    if (typeof value.currency !== "string" || !CURRENCY_PATTERN.test(value.currency)) {
      throw clientError("data-loss", "Event ingredient execution currency is invalid.");
    }
    normalizeExactRational(value.exactKnownUsageCostMinor, "Event ingredient exact known usage cost");
    exactSafeInteger(value.knownUsageCostMinor, "event ingredient known usage cost");
  }
  if (value.plannedBasisState === "complete") {
    exactSafeInteger(value.plannedProjectedCostMinor, "event ingredient planned projected cost");
    if (!Number.isSafeInteger(value.plannedBasisVarianceMinor)
      || value.plannedBasisVarianceMinor !== value.knownUsageCostMinor - value.plannedProjectedCostMinor) {
      throw clientError("data-loss", "Event ingredient execution cost summary variance is invalid.");
    }
  }
  return canonicalClone(value, "Event ingredient execution cost summary");
}

export function normalizeEventIngredientExecutionProjection(value, expectedOrganizationId, expectedQuoteId) {
  exactKeys(value, [
    "authorityVersion", "schemaVersion", "model", "organizationId", "quoteId", "eventPlanId",
    "eventRequirementRevisionId", "allocationRevision", "state", "executionRevision",
    "eventExecutionRevisionId", "settlementExecutionRevisionId", "occurredAtISO", "recordedAtISO",
    "reason", "ingredients", "costSummary", "lastReceiptId", "movementIds", "freshness",
    "updatedAtISO", "projectionDigest"
  ], "Event ingredient execution projection", "data-loss");
  const organizationId = identifier(expectedOrganizationId, "expected organizationId");
  const quoteId = identifier(expectedQuoteId, "expected quoteId");
  if (value.authorityVersion !== INVENTORY_AUTHORITY_VERSION
    || value.schemaVersion !== INVENTORY_AUTHORITY_SCHEMA_VERSION
    || value.model !== "event-ingredient-execution-projection-v1"
    || value.organizationId !== organizationId
    || value.quoteId !== quoteId
    || !EVENT_PLAN_ID_PATTERN.test(value.eventPlanId)
    || !EVENT_REQUIREMENT_REVISION_ID_PATTERN.test(value.eventRequirementRevisionId)
    || !EVENT_EXECUTION_REVISION_ID_PATTERN.test(value.eventExecutionRevisionId)
    || !EVENT_EXECUTION_REVISION_ID_PATTERN.test(value.settlementExecutionRevisionId)
    || value.state !== "settled"
    || !RECEIPT_ID_PATTERN.test(value.lastReceiptId)
    || !Array.isArray(value.movementIds)
    || value.movementIds.length > 75
    || value.movementIds.some((entry) => !MOVEMENT_ID_PATTERN.test(entry))
    || value.movementIds.some((entry, index) => index > 0
      && compareCodePoints(value.movementIds[index - 1], entry) >= 0)
    || !SHA256_PATTERN.test(value.projectionDigest)
    || !Array.isArray(value.ingredients)
    || value.ingredients.length === 0
    || value.ingredients.length > 75) {
    throw clientError("data-loss", "Event ingredient execution projection crossed its authority boundary.");
  }
  const executionRevision = exactRevision(value.executionRevision, "event execution revision", { allowZero: false, code: "data-loss" });
  const allocationRevision = exactRevision(value.allocationRevision, "event execution allocation revision", { allowZero: false, code: "data-loss" });
  exactKeys(value.freshness, ["state", "reason"], "Event ingredient execution freshness", "data-loss");
  if (value.freshness.state !== "current" || value.freshness.reason !== "") {
    throw clientError("data-loss", "Event ingredient execution projection freshness is invalid.");
  }
  const ingredients = value.ingredients.map((entry, index) => {
    const common = [
      "ingredientId", "locationId", "baseUnitId", "plannedQuantityMicros", "allocatedQuantityMicros",
      "consumedQuantity", "consumedQuantityMicros", "wasteQuantity", "wasteQuantityMicros",
      "depletedQuantityMicros", "priorDepletedQuantityMicros", "stockEffectDirection",
      "stockEffectQuantityMicros", "allocationReleasedQuantityMicros", "priorStockRevision",
      "resultStockRevision", "priorOnHandMicros", "resultOnHandMicros", "plannedBasisCostState", "name"
    ];
    const money = [
      "currency", "exactPlannedBasisUsageCostMinor", "plannedBasisUsageCostMinor",
      "plannedProjectedCostMinor", "plannedBasisVarianceMinor"
    ];
    assertAllowedKeys(entry, common, [...common, ...money], `Event ingredient execution row ${index + 1}`);
    const row = canonicalClone(entry, `Event ingredient execution row ${index + 1}`);
    row.ingredientId = identifier(entry.ingredientId, `event execution ingredient ${index + 1}`, "data-loss");
    row.locationId = identifier(entry.locationId, `event execution ingredient ${index + 1} location`, "data-loss");
    row.baseUnitId = baseUnit(entry.baseUnitId, `event execution ingredient ${index + 1} base unit`, "data-loss");
    row.name = exactText(entry.name, `event execution ingredient ${index + 1} name`, 100, { code: "data-loss" });
    for (const key of [
      "plannedQuantityMicros", "allocatedQuantityMicros", "consumedQuantityMicros", "wasteQuantityMicros",
      "depletedQuantityMicros", "priorDepletedQuantityMicros", "stockEffectQuantityMicros",
      "allocationReleasedQuantityMicros", "priorOnHandMicros", "resultOnHandMicros"
    ]) exactSafeInteger(entry[key], `event execution row ${index + 1} ${key}`);
    parseQuantityMicros(entry.consumedQuantity, `event execution row ${index + 1} consumed`, { allowZero: true, code: "data-loss" });
    parseQuantityMicros(entry.wasteQuantity, `event execution row ${index + 1} waste`, { allowZero: true, code: "data-loss" });
    row.priorStockRevision = exactRevision(entry.priorStockRevision, `event execution row ${index + 1} prior stock revision`, { allowZero: false, code: "data-loss" });
    row.resultStockRevision = exactRevision(entry.resultStockRevision, `event execution row ${index + 1} result stock revision`, { allowZero: false, code: "data-loss" });
    const expectedDirection = entry.depletedQuantityMicros > entry.priorDepletedQuantityMicros ? "decrease"
      : entry.depletedQuantityMicros < entry.priorDepletedQuantityMicros ? "increase" : "unchanged";
    if (entry.consumedQuantityMicros + entry.wasteQuantityMicros !== entry.depletedQuantityMicros
      || entry.stockEffectDirection !== expectedDirection
      || entry.stockEffectQuantityMicros !== Math.abs(entry.depletedQuantityMicros - entry.priorDepletedQuantityMicros)
      || entry.resultStockRevision !== entry.priorStockRevision + (expectedDirection === "unchanged" ? 0 : 1)
      || entry.resultOnHandMicros !== entry.priorOnHandMicros
        + (expectedDirection === "increase" ? entry.stockEffectQuantityMicros
          : expectedDirection === "decrease" ? -entry.stockEffectQuantityMicros : 0)) {
      throw clientError("data-loss", "Event ingredient execution quantities are inconsistent.");
    }
    if (entry.plannedBasisCostState === "complete") {
      if (!money.every((key) => Object.hasOwn(entry, key))
        || typeof entry.currency !== "string" || !CURRENCY_PATTERN.test(entry.currency)
        || !Number.isSafeInteger(entry.plannedBasisUsageCostMinor) || entry.plannedBasisUsageCostMinor < 0
        || !Number.isSafeInteger(entry.plannedProjectedCostMinor) || entry.plannedProjectedCostMinor < 0
        || !Number.isSafeInteger(entry.plannedBasisVarianceMinor)
        || entry.plannedBasisVarianceMinor !== entry.plannedBasisUsageCostMinor - entry.plannedProjectedCostMinor) {
        throw clientError("data-loss", "Complete planned-basis execution cost is inconsistent.");
      }
      normalizeExactRational(entry.exactPlannedBasisUsageCostMinor, `Event execution row ${index + 1} exact planned-basis cost`);
    } else if (entry.plannedBasisCostState !== "unavailable"
      || money.some((key) => Object.hasOwn(entry, key))) {
      throw clientError("data-loss", "Unavailable planned-basis execution cost contains invented money.");
    }
    return row;
  });
  if (new Set(ingredients.map(({ ingredientId }) => ingredientId)).size !== ingredients.length
    || ingredients.some((entry, index) => index > 0
      && compareCodePoints(ingredients[index - 1].ingredientId, entry.ingredientId) >= 0)) {
    throw clientError("data-loss", "Event ingredient execution rows are not a sorted unique set.");
  }
  const costedIngredientCount = ingredients.filter((entry) => entry.plannedBasisCostState === "complete").length;
  const costSummary = normalizeExecutionCostSummary(value.costSummary, ingredients.length, costedIngredientCount);
  return deepFreeze({
    ...canonicalClone(value, "Event ingredient execution projection"),
    organizationId,
    quoteId,
    executionRevision,
    allocationRevision,
    occurredAtISO: exactIso(value.occurredAtISO, "event execution occurrence time"),
    recordedAtISO: exactIso(value.recordedAtISO, "event execution record time"),
    updatedAtISO: exactIso(value.updatedAtISO, "event execution projection update time"),
    reason: exactText(value.reason, "event execution reason", 240, { code: "data-loss" }),
    ingredients,
    costSummary
  });
}

function normalizeEventPreviewInput(input) {
  const { access } = requirePreviewAccess(input);
  const normalized = {
    schemaVersion: INVENTORY_AUTHORITY_SCHEMA_VERSION,
    organizationId: access.organizationId,
    quoteId: identifier(input.quoteId, "quoteId"),
    quoteRevisionId: identifier(input.quoteRevisionId, "quote revision identity"),
    requiredByBasis: normalizeEventRequiredByBasis(input.requiredByBasis),
    selections: normalizeEventSelections(input.selections)
  };
  return deepFreeze(normalized);
}

function normalizePreviewRequirement(value, projection) {
  const baseKeys = [
    "authorityVersion", "schemaVersion", "requirementVersion", "organizationId", "quoteId", "quoteRevisionId",
    "requiredByISO", "demandState", "costState", "selections", "ingredients", "coverage", "issues",
    "eventRequirementRevisionId", "requirementDigest"
  ];
  const optionalKeys = ["currency", "exactKnownCostMinor", "knownCostMinor", "projectedCostMinor"];
  assertAllowedKeys(value, baseKeys, [...baseKeys, ...optionalKeys], "Event ingredient preview requirement");
  if (value.authorityVersion !== INVENTORY_AUTHORITY_VERSION
    || value.schemaVersion !== 1
    || value.requirementVersion !== "ingredient-event-requirement-v1"
    || value.organizationId !== projection.organizationId
    || value.quoteId !== projection.quoteId
    || value.quoteRevisionId !== projection.quoteRevisionId
    || value.requiredByISO !== projection.requiredByISO
    || value.demandState !== projection.demandState
    || value.costState !== projection.costState
    || value.eventRequirementRevisionId !== projection.eventRequirementRevisionId
    || value.requirementDigest !== projection.requirementDigest
    || !Array.isArray(value.selections) || !Array.isArray(value.ingredients) || !Array.isArray(value.issues)) {
    throw clientError("data-loss", "Event ingredient preview requirement contradicts its projection.");
  }
  exactKeys(value.coverage, [
    "selectedMenuItemCount", "compiledMenuItemCount", "ingredientCount", "costedIngredientCount",
    "knownCostIngredientCount"
  ], "Event ingredient preview coverage", "data-loss");
  Object.values(value.coverage).forEach((entry) => exactSafeInteger(entry, "event ingredient preview coverage count"));
  if (canonical(value.selections, "Preview requirement selections")
      !== canonical(projection.selections.map((selection) => {
        const { ingredientName, ...clean } = selection;
        return clean;
      }), "Preview projection selections")) {
    throw clientError("data-loss", "Event ingredient preview selection evidence differs from its projection.");
  }
  const projectionRequirementRows = projection.ingredients.map((row) => {
    const clean = { ...row };
    delete clean.ingredientName;
    delete clean.availabilityState;
    delete clean.onHandQuantityMicros;
    delete clean.committedQuantityMicros;
    delete clean.availableToAllocateQuantityMicros;
    delete clean.shortageQuantityMicros;
    return clean;
  });
  if (canonical(value.ingredients, "Preview requirement ingredients")
      !== canonical(projectionRequirementRows, "Preview projection ingredients")) {
    throw clientError("data-loss", "Event ingredient preview requirement rows differ from its projection.");
  }
  for (const key of optionalKeys) {
    if (Object.hasOwn(value, key) !== Object.hasOwn(projection, key)
      || (Object.hasOwn(value, key) && canonical(value[key], `Preview ${key}`) !== canonical(projection[key], `Projection ${key}`))) {
      throw clientError("data-loss", "Event ingredient preview cost evidence differs from its projection.");
    }
  }
  return deepFreeze(canonicalClone(value, "Event ingredient preview requirement"));
}

export function normalizeEventInventoryPreviewResult(
  value,
  expectedOrganizationId,
  expectedQuoteId,
  expectedQuoteRevisionId
) {
  const organizationId = identifier(expectedOrganizationId, "expected organizationId", "data-loss");
  const quoteId = identifier(expectedQuoteId, "expected quoteId", "data-loss");
  const quoteRevisionId = identifier(expectedQuoteRevisionId, "expected quote revision", "data-loss");
  exactKeys(value, [
    "ok", "schemaVersion", "organizationId", "quoteId", "quoteRevisionId", "preview",
    "requirementRevision", "ingredientLabels", "projection"
  ], "Event ingredient preview result", "data-loss");
  if (value.ok !== true || value.schemaVersion !== INVENTORY_AUTHORITY_SCHEMA_VERSION
    || value.organizationId !== organizationId || value.quoteId !== quoteId
    || value.quoteRevisionId !== quoteRevisionId || value.preview !== true) {
    throw clientError("data-loss", "Event ingredient preview crossed its authority boundary.");
  }
  const projection = normalizeEventProjection(value.projection, organizationId, quoteId, {
    persisted: false,
    ingredientLabels: value.ingredientLabels
  });
  if (projection.quoteRevisionId !== quoteRevisionId) {
    throw clientError("data-loss", "Event ingredient preview returned a different quote revision.");
  }
  const requirementRevision = normalizePreviewRequirement(value.requirementRevision, projection);
  return deepFreeze({
    ok: true,
    schemaVersion: INVENTORY_AUTHORITY_SCHEMA_VERSION,
    organizationId,
    quoteId,
    quoteRevisionId,
    preview: true,
    requirementRevision,
    projection
  });
}

export async function previewEventInventory(input = {}) {
  const payload = normalizeEventPreviewInput(input);
  const call = httpsCallable(cloudFunctions, INVENTORY_AUTHORITY_CALLABLES.previewEvent);
  const response = await call(canonicalClone(payload, "Event ingredient preview request"));
  return normalizeEventInventoryPreviewResult(
    response?.data,
    payload.organizationId,
    payload.quoteId,
    payload.quoteRevisionId
  );
}

export function subscribeToEventIngredientProjection(input = {}) {
  const access = requireMenuCostReadAccess(input);
  const quoteId = identifier(input.quoteId, "quoteId");
  if (typeof input.onData !== "function") {
    throw clientError("invalid-argument", "Event ingredient projection listener requires onData.");
  }
  let active = true;
  let retained = null;
  const emit = (source, exists) => {
    if (!active) return;
    input.onData(deepFreeze({
      schemaVersion: 1,
      organizationId: access.organizationId,
      quoteId,
      exists,
      projection: retained,
      retained: source.state === "unavailable" && retained !== null,
      source,
      freshness: source.state
    }));
  };
  const unavailable = () => {
    if (!active) return;
    const source = { state: "unavailable", fromCache: false, hasPendingWrites: false };
    emit(source, retained !== null);
    input.onError?.(Object.freeze({
      code: "event-ingredient-projection-unavailable",
      message: "The event ingredient projection is unavailable. Retained evidence is explicitly stale.",
      quoteId,
      source
    }));
  };
  const projectionRef = doc(db, "organizations", access.organizationId, "eventIngredientProjections", quoteId);
  let unsubscribe;
  try {
    unsubscribe = onSnapshot(projectionRef, { includeMetadataChanges: true }, (snapshot) => {
      if (!active) return;
      try {
        const exists = snapshot.exists();
        retained = exists ? normalizeEventIngredientProjection(snapshot.data(), access.organizationId, quoteId) : null;
        const metadata = snapshot?.metadata || {};
        emit({
          state: sourceState(metadata),
          fromCache: metadata.fromCache === true,
          hasPendingWrites: metadata.hasPendingWrites === true
        }, exists);
      } catch {
        unavailable();
      }
    }, unavailable);
  } catch (error) {
    active = false;
    throw error;
  }
  return () => {
    if (!active) return;
    active = false;
    if (typeof unsubscribe === "function") unsubscribe();
  };
}

export function subscribeToEventIngredientExecutionProjection(input = {}) {
  const access = requireMenuCostReadAccess(input);
  const quoteId = identifier(input.quoteId, "quoteId");
  if (typeof input.onData !== "function") {
    throw clientError("invalid-argument", "Event ingredient execution listener requires onData.");
  }
  let active = true;
  let retained = null;
  const emit = (source, exists) => {
    if (!active) return;
    input.onData(deepFreeze({
      schemaVersion: INVENTORY_AUTHORITY_SCHEMA_VERSION,
      organizationId: access.organizationId,
      quoteId,
      exists,
      projection: retained,
      retained: source.state === "unavailable" && retained !== null,
      source,
      freshness: source.state
    }));
  };
  const unavailable = () => {
    if (!active) return;
    const source = { state: "unavailable", fromCache: false, hasPendingWrites: false };
    emit(source, retained !== null);
    input.onError?.(Object.freeze({
      code: "event-ingredient-execution-projection-unavailable",
      message: "The event ingredient execution projection is unavailable. Retained evidence is explicitly stale.",
      quoteId,
      source
    }));
  };
  const projectionRef = doc(
    db,
    "organizations",
    access.organizationId,
    "eventIngredientExecutionProjections",
    quoteId
  );
  let unsubscribe;
  try {
    unsubscribe = onSnapshot(projectionRef, { includeMetadataChanges: true }, (snapshot) => {
      if (!active) return;
      try {
        const exists = snapshot.exists();
        retained = exists
          ? normalizeEventIngredientExecutionProjection(snapshot.data(), access.organizationId, quoteId)
          : null;
        const metadata = snapshot?.metadata || {};
        emit({
          state: sourceState(metadata),
          fromCache: metadata.fromCache === true,
          hasPendingWrites: metadata.hasPendingWrites === true
        }, exists);
      } catch {
        unavailable();
      }
    }, unavailable);
  } catch (error) {
    active = false;
    throw error;
  }
  return () => {
    if (!active) return;
    active = false;
    if (typeof unsubscribe === "function") unsubscribe();
  };
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
    bounded: state.bounded,
    page: {
      size: ingredients.length,
      cursor: state.page.cursor ? { ...state.page.cursor } : null,
      nextCursor: state.page.nextCursor ? { ...state.page.nextCursor } : null,
      hasPrevious: state.page.cursor !== null,
      hasNext: state.page.nextCursor !== null
    }
  });
}

export function subscribeToInventoryIngredientProjections(input = {}) {
  const access = requireReadAccess(input);
  if (typeof input.onData !== "function") throw clientError("invalid-argument", "Inventory projection listener requires onData.");
  const scope = { organizationId: access.organizationId };
  const cursor = ingredientPageCursor(input.cursor);
  let active = true;
  let workspaceUnsubscribe = null;
  let ingredientsUnsubscribe = null;
  const state = {
    workspace: null,
    ingredients: [],
    bounded: false,
    page: { cursor, nextCursor: null },
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
  const ingredientQueryParts = [
    collection(db, "organizations", scope.organizationId, "inventoryIngredientProjections"),
    orderBy("nameSortKey", "asc"),
    orderBy(documentId(), "asc")
  ];
  if (cursor) ingredientQueryParts.push(startAfter(cursor.nameSortKey, cursor.ingredientId));
  ingredientQueryParts.push(limit(INVENTORY_INGREDIENT_PROJECTION_LIMIT + 1));
  const ingredientQuery = query(...ingredientQueryParts);
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
        if (!Array.isArray(snapshot?.docs) || snapshot.docs.length > INVENTORY_INGREDIENT_PROJECTION_LIMIT + 1) {
          throw clientError("data-loss", "Ingredient projection query exceeded its bounded contract.");
        }
        const received = snapshot.docs.map((entry) => normalizeInventoryIngredientProjection(entry.data(), scope.organizationId, entry.id));
        if (received.some((entry, index) => index > 0 && (
          compareCodePoints(received[index - 1].nameSortKey, entry.nameSortKey) > 0
          || (received[index - 1].nameSortKey === entry.nameSortKey
            && compareCodePoints(received[index - 1].ingredientId, entry.ingredientId) >= 0)
        )) || new Set(received.map((entry) => entry.ingredientId)).size !== received.length) {
          throw clientError("data-loss", "Ingredient projection query is not a stable ordered set.");
        }
        const hasNext = received.length > INVENTORY_INGREDIENT_PROJECTION_LIMIT;
        const ingredients = received.slice(0, INVENTORY_INGREDIENT_PROJECTION_LIMIT);
        const finalIngredient = ingredients.at(-1) || null;
        const metadata = snapshot?.metadata || {};
        state.sources.ingredients = {
          state: sourceState(metadata),
          fromCache: metadata.fromCache === true,
          hasPendingWrites: metadata.hasPendingWrites === true
        };
        state.ingredients = ingredients;
        state.page.nextCursor = hasNext && finalIngredient ? Object.freeze({
          nameSortKey: finalIngredient.nameSortKey,
          ingredientId: finalIngredient.ingredientId
        }) : null;
        state.bounded = cursor !== null || hasNext;
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

export function subscribeToInventoryMenuCostProjections(input = {}) {
  const access = requireMenuCostReadAccess(input);
  if (typeof input.onData !== "function") {
    throw clientError("invalid-argument", "Menu cost projection listener requires onData.");
  }
  let active = true;
  let retained = [];
  const emit = (source) => {
    if (!active) return;
    input.onData(deepFreeze({
      schemaVersion: INVENTORY_AUTHORITY_SCHEMA_VERSION,
      organizationId: access.organizationId,
      projections: retained,
      byMenuItemId: Object.fromEntries(retained.map((entry) => [entry.menuItemId, entry])),
      source,
      freshness: source.state,
      bounded: retained.length === INVENTORY_MENU_COST_PROJECTION_LIMIT
    }));
  };
  const unavailable = () => {
    if (!active) return;
    const source = { state: "unavailable", fromCache: false, hasPendingWrites: false };
    emit(source);
    input.onError?.(Object.freeze({
      code: "inventory-menu-cost-projections-unavailable",
      message: "Current menu cost projection updates are unavailable. Retained values are not confirmed current.",
      source
    }));
  };
  const projectionQuery = query(
    collection(db, "organizations", access.organizationId, "inventoryMenuCostProjections"),
    orderBy("menuItemNameSortKey", "asc"),
    limit(INVENTORY_MENU_COST_PROJECTION_LIMIT)
  );
  let unsubscribe;
  try {
    unsubscribe = onSnapshot(projectionQuery, { includeMetadataChanges: true }, (snapshot) => {
      if (!active) return;
      try {
        if (!Array.isArray(snapshot?.docs) || snapshot.docs.length > INVENTORY_MENU_COST_PROJECTION_LIMIT) {
          throw clientError("data-loss", "Menu cost projection query exceeded its bounded contract.");
        }
        const projections = snapshot.docs.map((entry) => normalizeInventoryMenuCostProjection(
          entry.data(), access.organizationId, entry.id
        ));
        if (new Set(projections.map((entry) => entry.menuItemId)).size !== projections.length
          || projections.some((entry, index) => index > 0
            && compareCodePoints(projections[index - 1].menuItemNameSortKey, entry.menuItemNameSortKey) > 0)) {
          throw clientError("data-loss", "Menu cost projections are not a stable ordered set.");
        }
        retained = projections;
        const metadata = snapshot?.metadata || {};
        emit({
          state: sourceState(metadata),
          fromCache: metadata.fromCache === true,
          hasPendingWrites: metadata.hasPendingWrites === true
        });
      } catch {
        unavailable();
      }
    }, unavailable);
  } catch (error) {
    active = false;
    throw error;
  }
  return () => {
    if (!active) return;
    active = false;
    if (typeof unsubscribe === "function") unsubscribe();
  };
}

export function subscribeToInventoryMenuCostProjection(input = {}) {
  const access = requireMenuCostReadAccess(input);
  const menuItemId = identifier(input.menuItemId, "menu item identity");
  if (typeof input.onData !== "function") {
    throw clientError("invalid-argument", "Exact menu cost projection listener requires onData.");
  }
  let active = true;
  let retained = null;
  const emit = (source, exists) => {
    if (!active) return;
    input.onData(deepFreeze({
      schemaVersion: INVENTORY_AUTHORITY_SCHEMA_VERSION,
      organizationId: access.organizationId,
      menuItemId,
      exists,
      projection: retained,
      source,
      freshness: source.state
    }));
  };
  const unavailable = () => {
    if (!active) return;
    const source = { state: "unavailable", fromCache: false, hasPendingWrites: false };
    emit(source, retained !== null);
    input.onError?.(Object.freeze({
      code: "inventory-menu-cost-projection-unavailable",
      message: "The exact menu cost projection is unavailable. Retained evidence is not confirmed current.",
      source,
      menuItemId
    }));
  };
  const projectionRef = doc(
    db,
    "organizations",
    access.organizationId,
    "inventoryMenuCostProjections",
    menuItemId
  );
  let unsubscribe;
  try {
    unsubscribe = onSnapshot(projectionRef, { includeMetadataChanges: true }, (snapshot) => {
      if (!active) return;
      try {
        const exists = snapshot.exists();
        retained = exists
          ? normalizeInventoryMenuCostProjection(snapshot.data(), access.organizationId, menuItemId)
          : null;
        const metadata = snapshot?.metadata || {};
        emit({
          state: sourceState(metadata),
          fromCache: metadata.fromCache === true,
          hasPendingWrites: metadata.hasPendingWrites === true
        }, exists);
      } catch {
        unavailable();
      }
    }, unavailable);
  } catch (error) {
    active = false;
    throw error;
  }
  return () => {
    if (!active) return;
    active = false;
    if (typeof unsubscribe === "function") unsubscribe();
  };
}

export function subscribeToInventoryRecipeIngredients(input = {}) {
  const access = requireReadAccess(input);
  if (typeof input.onData !== "function") {
    throw clientError("invalid-argument", "Recipe ingredient projection listener requires onData.");
  }
  let active = true;
  let retained = [];
  const emit = (source) => {
    if (!active) return;
    input.onData(deepFreeze({
      schemaVersion: INVENTORY_AUTHORITY_SCHEMA_VERSION,
      organizationId: access.organizationId,
      ingredients: retained,
      source,
      freshness: source.state,
      bounded: retained.length === INVENTORY_INGREDIENT_PROJECTION_LIMIT
    }));
  };
  const unavailable = () => {
    if (!active) return;
    const source = { state: "unavailable", fromCache: false, hasPendingWrites: false };
    emit(source);
    input.onError?.(Object.freeze({
      code: "inventory-recipe-ingredients-unavailable",
      message: "Current ingredient definitions are unavailable. Retained values cannot authorize recipe publication.",
      source
    }));
  };
  const ingredientQuery = query(
    collection(db, "organizations", access.organizationId, "inventoryIngredientProjections"),
    orderBy("nameSortKey", "asc"),
    limit(INVENTORY_INGREDIENT_PROJECTION_LIMIT)
  );
  let unsubscribe;
  try {
    unsubscribe = onSnapshot(ingredientQuery, { includeMetadataChanges: true }, (snapshot) => {
      if (!active) return;
      try {
        if (!Array.isArray(snapshot?.docs) || snapshot.docs.length > INVENTORY_INGREDIENT_PROJECTION_LIMIT) {
          throw clientError("data-loss", "Recipe ingredient projection query exceeded its bounded contract.");
        }
        retained = snapshot.docs.map((entry) => normalizeInventoryIngredientProjection(
          entry.data(), access.organizationId, entry.id
        ));
        const metadata = snapshot?.metadata || {};
        emit({
          state: sourceState(metadata),
          fromCache: metadata.fromCache === true,
          hasPendingWrites: metadata.hasPendingWrites === true
        });
      } catch {
        unavailable();
      }
    }, unavailable);
  } catch (error) {
    active = false;
    throw error;
  }
  return () => {
    if (!active) return;
    active = false;
    if (typeof unsubscribe === "function") unsubscribe();
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
  if (commandKind === "publish_menu_recipe") {
    const projection = model.byMenuItemId?.[result.menuItemId]
      || model.menuCostProjectionsByMenuItemId?.[result.menuItemId];
    return projection?.freshness === "current"
      && projection.recipeRevisionId === result.recipeRevisionId
      && projection.sourceDigest === result.projectionSourceDigest;
  }
  if (commandKind === "compile_event_ingredient_demand") {
    const projection = model.projection || model;
    return projection?.freshness === "as_recorded"
      && projection.quoteId === result.quoteId
      && projection.quoteRevisionId === result.quoteRevisionId
      && projection.requirementRevision === result.requirementRevision
      && projection.eventRequirementRevisionId === result.eventRequirementRevisionId
      && projection.requirementDigest === result.requirementDigest
      && projection.projectionDigest === result.projectionDigest;
  }
  const ingredient = Array.isArray(model.ingredients)
    ? model.ingredients.find((entry) => entry.ingredientId === result.ingredientId) : null;
  if (!ingredient) return false;
  if (commandKind === "upsert_ingredient") return ingredient.ingredientRevision === result.revision;
  if (commandKind === "opening_balance") return ingredient.stock.revision === result.stockRevision && ingredient.stock.lastMovementId === result.movementId;
  if (commandKind === "receive_stock") {
    return ingredient.stock.revision === result.stockRevision
      && ingredient.stock.lastMovementId === result.movementId
      && ingredient.cost.revision === result.costRevision;
  }
  if (commandKind === "record_ingredient_cost") return ingredient.cost.revision === result.costRevision && ingredient.cost.lastCostEvidenceId === result.costEvidenceId;
  if (commandKind === "publish_pack_conversion") {
    return ingredient.packConversions.some((entry) => entry.packConversionRevisionId === result.packConversionRevisionId
      && entry.revision === result.revision);
  }
  return false;
}
