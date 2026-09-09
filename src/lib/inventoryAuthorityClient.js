import { collection, doc, limit, onSnapshot, orderBy, query } from "firebase/firestore";
import { httpsCallable } from "firebase/functions";
import { auth, cloudFunctions, db, firebaseReady } from "./firebase";

export const INVENTORY_AUTHORITY_SCHEMA_VERSION = 2;
export const INVENTORY_AUTHORITY_VERSION = "inventory-ingredient-authority-v2";
export const INVENTORY_INGREDIENT_PROJECTION_LIMIT = 200;
export const INVENTORY_MENU_COST_PROJECTION_LIMIT = 200;
export const INVENTORY_MAX_PUBLISHED_RECIPE_LINES = 50;
export const INVENTORY_AUTHORITY_CALLABLES = Object.freeze({
  applyCommand: "applyInventoryCommand"
});
export const INVENTORY_COMMAND_KINDS = Object.freeze([
  "upsert_location",
  "upsert_ingredient",
  "opening_balance",
  "record_ingredient_cost",
  "publish_pack_conversion",
  "publish_menu_recipe"
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

function normalizeRecipeCommand(value) {
  exactKeys(value, [
    "kind", "menuItemId", "expectedCatalogRevision", "expectedRecipeRevision",
    "outputYield", "outputUnitId", "lines"
  ], "Menu recipe publication command");
  if (value.kind !== "publish_menu_recipe" || !Array.isArray(value.lines)
    || value.lines.length > INVENTORY_MAX_PUBLISHED_RECIPE_LINES) {
    throw clientError("invalid-argument", `Menu recipes support at most ${INVENTORY_MAX_PUBLISHED_RECIPE_LINES} ingredient lines.`);
  }
  if (value.outputYield !== null) parseQuantityMicros(value.outputYield, "recipe output yield");
  const lines = value.lines.map(normalizeRecipeLine);
  if (new Set(lines.map((line) => line.lineId)).size !== lines.length) {
    throw clientError("invalid-argument", "Recipe line identities must be unique.");
  }
  return {
    kind: value.kind,
    menuItemId: identifier(value.menuItemId, "menuItemId"),
    expectedCatalogRevision: exactRevision(value.expectedCatalogRevision, "catalog expected revision"),
    expectedRecipeRevision: exactRevision(value.expectedRecipeRevision, "recipe expected revision"),
    outputYield: value.outputYield,
    outputUnitId: identifier(value.outputUnitId, "recipe output unit"),
    lines
  };
}

function normalizeCommand(value) {
  if (!isRecord(value) || typeof value.kind !== "string" || !COMMAND_KINDS.has(value.kind)) {
    throw clientError("invalid-argument", "A supported schema-v2 inventory command is required.");
  }
  if (value.kind === "upsert_location") return deepFreeze(normalizeLocationCommand(value));
  if (value.kind === "upsert_ingredient") return deepFreeze(normalizeIngredientCommand(value));
  if (value.kind === "opening_balance") return deepFreeze(normalizeOpeningBalanceCommand(value));
  if (value.kind === "record_ingredient_cost") return deepFreeze(normalizeCostCommand(value));
  if (value.kind === "publish_pack_conversion") return deepFreeze(normalizePackConversionCommand(value));
  return deepFreeze(normalizeRecipeCommand(value));
}

export function inventoryCommandAxis(kind) {
  if (kind === "upsert_location") return "location";
  if (kind === "upsert_ingredient") return "ingredient";
  if (kind === "opening_balance") return "stock";
  if (kind === "record_ingredient_cost") return "cost";
  if (kind === "publish_pack_conversion") return "conversion";
  if (kind === "publish_menu_recipe") return "recipe";
  return "";
}

function targetIdentity(command) {
  return command.locationId || command.ingredientId || command.menuItemId || "authority";
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
  const ingredient = Array.isArray(model.ingredients)
    ? model.ingredients.find((entry) => entry.ingredientId === result.ingredientId) : null;
  if (!ingredient) return false;
  if (commandKind === "upsert_ingredient") return ingredient.ingredientRevision === result.revision;
  if (commandKind === "opening_balance") return ingredient.stock.revision === result.stockRevision && ingredient.stock.lastMovementId === result.movementId;
  if (commandKind === "record_ingredient_cost") return ingredient.cost.revision === result.costRevision && ingredient.cost.lastCostEvidenceId === result.costEvidenceId;
  if (commandKind === "publish_pack_conversion") {
    return ingredient.packConversions.some((entry) => entry.packConversionRevisionId === result.packConversionRevisionId
      && entry.revision === result.revision);
  }
  return false;
}
