import { httpsCallable } from "firebase/functions";
import { buildCatalogRecordChanges, buildSettingsPatch } from "../hooks/useCatalogData";
import { cloudFunctions, firebaseReady } from "./firebase";
import { addonWriteShape, packageWriteShape, rentalWriteShape } from "./catalogWriteShapes";
import { sha256CanonicalValue } from "./commercialDependencyGraph";

const E2E_FUNCTION_ADAPTER_ENABLED = ["1", "true", "yes", "on"].includes(
  String(import.meta.env.VITE_E2E_BYPASS_AUTH || "").trim().toLowerCase()
);

const COLLECTION_BY_CATALOG_KEY = Object.freeze({
  packages: "catalogPackages",
  addons: "catalogAddons",
  rentals: "catalogRentals",
  eventTypes: "eventTypes",
  menuCategories: "menuCategories"
});
const WRITE_SHAPE_BY_CATALOG_KEY = Object.freeze({
  packages: packageWriteShape,
  addons: addonWriteShape,
  rentals: rentalWriteShape
});

function stableValue(value) {
  if (Array.isArray(value)) return value.map(stableValue);
  if (value && typeof value === "object") {
    return Object.keys(value).sort().reduce((result, key) => {
      if (value[key] !== undefined && typeof value[key] !== "function") {
        result[key] = stableValue(value[key]);
      }
      return result;
    }, {});
  }
  return value;
}

function valuesMatch(left, right) {
  return JSON.stringify(stableValue(left)) === JSON.stringify(stableValue(right));
}

const RECORD_KEY_BY_COLLECTION = Object.freeze({
  catalogPackages: "packages",
  catalogAddons: "addons",
  catalogRentals: "rentals",
  eventTypes: "eventTypes",
  menuCategories: "categories",
  menuItems: "items"
});

const MAJOR_SETTING_BY_MINOR = Object.freeze({
  perMileRateMinor: "perMileRate",
  longDistancePerMileRateMinor: "longDistancePerMileRate",
  bartenderRateMinor: "bartenderRate",
  serverRateMinor: "serverRate",
  chefRateMinor: "chefRate"
});

function majorFromMinor(value) {
  return value === null || value === undefined ? null : Number(value) / 100;
}

function draftPayloadForEditor(collection, recordId, payload = {}, intent = "update") {
  const next = { ...payload, id: recordId };
  if (Object.prototype.hasOwnProperty.call(payload, "pppMinor")) next.ppp = majorFromMinor(payload.pppMinor);
  if (Object.prototype.hasOwnProperty.call(payload, "costPppMinor")) next.costPpp = majorFromMinor(payload.costPppMinor);
  if (Object.prototype.hasOwnProperty.call(payload, "priceMinor")) next.price = majorFromMinor(payload.priceMinor);
  if (Object.prototype.hasOwnProperty.call(payload, "costMinor")) next.cost = majorFromMinor(payload.costMinor);
  if (intent === "deactivate") next.active = false;
  return next;
}

function applySettingsDraft(settings = {}, patch = {}) {
  const next = { ...settings };
  Object.entries(patch || {}).forEach(([key, value]) => {
    if (!Object.prototype.hasOwnProperty.call(MAJOR_SETTING_BY_MINOR, key)) next[key] = value;
  });
  Object.entries(MAJOR_SETTING_BY_MINOR).forEach(([minorKey, majorKey]) => {
    if (Object.prototype.hasOwnProperty.call(patch, minorKey)) {
      next[majorKey] = majorFromMinor(patch[minorKey]);
    }
  });
  if (Array.isArray(patch.bartenderRateTypes)) {
    next.bartenderRateTypes = patch.bartenderRateTypes.map((item) => ({
      ...item,
      ...(Object.prototype.hasOwnProperty.call(item, "rateMinor")
        ? { rate: majorFromMinor(item.rateMinor) }
        : {})
    }));
  }
  if (Array.isArray(patch.staffingRateTypes)) {
    next.staffingRateTypes = patch.staffingRateTypes.map((item) => ({
      ...item,
      ...(Object.prototype.hasOwnProperty.call(item, "serverRateMinor")
        ? { serverRate: majorFromMinor(item.serverRateMinor) }
        : {}),
      ...(Object.prototype.hasOwnProperty.call(item, "chefRateMinor")
        ? { chefRate: majorFromMinor(item.chefRateMinor) }
        : {})
    }));
  }
  return next;
}

export function applyCatalogSetupDraftChanges(source = {}, changes = []) {
  const next = Object.fromEntries(Object.entries(source || {}).map(([key, value]) => [
    key,
    Array.isArray(value) ? value.map((item) => ({ ...item })) : value
  ]));
  (Array.isArray(changes) ? changes : []).forEach((change) => {
    const collection = String(change?.collection || "").trim();
    const recordId = String(change?.recordId || "").trim();
    if (collection === "settings" && recordId === "config") {
      next.settings = applySettingsDraft(next.settings || {}, change.payload || {});
      return;
    }
    const key = RECORD_KEY_BY_COLLECTION[collection];
    if (!key || !recordId || !Array.isArray(next[key])) return;
    const record = draftPayloadForEditor(collection, recordId, change.payload, change.intent);
    const index = next[key].findIndex((item) => String(item?.id || "").trim() === recordId);
    if (index >= 0) next[key][index] = { ...next[key][index], ...record };
    else next[key].push(record);
  });
  return next;
}

function minor(value) {
  if (value === "" || value === null || value === undefined) return null;
  return Math.round(Number(value) * 100);
}

function menuPayload(item = {}) {
  const pricingType = ["per_person", "per_item", "per_event"].includes(item.pricingType || item.type)
    ? item.pricingType || item.type
    : "per_event";
  return {
    name: String(item.name || "").trim() || "Untitled Item",
    eventTypeId: String(item.eventTypeId || "").trim(),
    categoryId: String(item.categoryId || "").trim(),
    priceMinor: Math.round(Number(item.price || 0) * 100),
    costMinor: minor(item.cost),
    pricingType,
    type: pricingType,
    active: item.active !== false
  };
}

function categoryPayload(item = {}) {
  return {
    name: String(item.name || "").trim() || "Untitled Menu section",
    eventTypeId: String(item.eventTypeId || "").trim(),
    active: item.active !== false
  };
}

function eventTypePayload(item = {}) {
  return {
    name: String(item.name || "").trim() || "Untitled Event type",
    active: item.active !== false
  };
}

function keyedRecords(records = []) {
  return new Map((Array.isArray(records) ? records : []).map((item) => [String(item?.id || "").trim(), item]));
}

function buildManagedChanges(collection, nextRecords = [], baselineRecords = [], payloadBuilder) {
  const nextById = keyedRecords(nextRecords);
  const baselineById = keyedRecords(baselineRecords);
  const ids = new Set([...nextById.keys(), ...baselineById.keys()]);
  const changes = [];
  ids.forEach((id) => {
    if (!id) return;
    const next = nextById.get(id);
    const baseline = baselineById.get(id);
    if (!next && baseline) {
      changes.push({
        collection,
        recordId: id,
        intent: "deactivate",
        payload: payloadBuilder({ ...baseline, active: false })
      });
      return;
    }
    const nextPayload = payloadBuilder(next);
    if (baseline && valuesMatch(nextPayload, payloadBuilder(baseline))) return;
    changes.push({
      collection,
      recordId: id,
      intent: baseline ? (next?.active === false ? "deactivate" : "update") : "create",
      payload: nextPayload
    });
  });
  return changes;
}

export function buildCatalogSetupChanges({
  catalog = {},
  baselineCatalog = {},
  serverFingerprints = {},
  menu = {},
  baselineMenu = {}
} = {}) {
  const catalogChanges = buildCatalogRecordChanges({
    catalog,
    baselineCatalog,
    serverFingerprints
  }).map((change) => {
    const baselineItem = (baselineCatalog?.[change.key] || [])
      .find((item) => String(item?.id || "").trim() === change.id);
    return {
      collection: COLLECTION_BY_CATALOG_KEY[change.key],
      recordId: change.id,
      intent: change.nextItem
        ? (change.expectedFingerprint ? (change.nextItem.active === false ? "deactivate" : "update") : "create")
        : "deactivate",
      payload: change.nextItem
        ? change.writeData
        : WRITE_SHAPE_BY_CATALOG_KEY[change.key]({ ...baselineItem, active: false })
    };
  });
  const settingsPatch = buildSettingsPatch(catalog.settings || {}, baselineCatalog.settings || {});
  const changes = [
    ...catalogChanges,
    ...(Object.keys(settingsPatch).length > 0
      ? [{ collection: "settings", recordId: "config", intent: "update", payload: settingsPatch }]
      : []),
    ...buildManagedChanges("eventTypes", menu.eventTypes, baselineMenu.eventTypes, eventTypePayload),
    ...buildManagedChanges("menuCategories", menu.categories, baselineMenu.categories, categoryPayload),
    ...buildManagedChanges("menuItems", menu.items, baselineMenu.items, menuPayload)
  ];
  const byId = new Map();
  changes.forEach((change) => byId.set(`${change.collection}:${change.recordId}`, change));
  return [...byId.values()].sort((left, right) => (
    `${left.collection}:${left.recordId}`.localeCompare(`${right.collection}:${right.recordId}`)
  ));
}

export function createCatalogSetupRequestId(prefix = "catalog") {
  const random = globalThis.crypto?.randomUUID?.()
    || `${Date.now()}-${Math.random().toString(36).slice(2)}`;
  return `${String(prefix || "catalog").replace(/[^A-Za-z0-9_-]/g, "_")}_${random.replace(/-/g, "")}`;
}

function importRecordId(batchId, row, index) {
  const rowNumber = Number.isSafeInteger(Number(row?.rowNumber)) ? Number(row.rowNumber) : index + 1;
  return `imp_${String(batchId || "catalog").replace(/[^A-Za-z0-9_-]/g, "_").slice(0, 180)}_${rowNumber}_${index}`;
}

const IMPORT_MONEY_MAX_MINOR = 100_000_000;
const IMPORT_RELATIONSHIP_LIMIT = 100;

function importText(value, {
  label = "Value",
  maxLength = 300,
  required = false,
  rowNumber = "unknown"
} = {}) {
  const normalized = String(value || "").trim();
  if (required && !normalized) {
    throw new Error(`Catalog import row ${rowNumber} needs ${label.toLowerCase()}.`);
  }
  if (normalized.length > maxLength) {
    throw new Error(`Catalog import row ${rowNumber} ${label.toLowerCase()} exceeds ${maxLength} characters.`);
  }
  return normalized;
}

function importMoney(value, {
  label = "Amount",
  required = false,
  positive = false,
  rowNumber = "unknown"
} = {}) {
  if (value === "" || value === null || value === undefined) {
    if (required) throw new Error(`Catalog import row ${rowNumber} needs ${label.toLowerCase()}.`);
    return null;
  }
  const numeric = Number(value);
  const scaled = numeric * 100;
  const rounded = Math.round(scaled);
  if (
    !Number.isFinite(numeric)
    || numeric < 0
    || (positive && numeric <= 0)
    || Math.abs(scaled - rounded) > 1e-8
    || rounded > IMPORT_MONEY_MAX_MINOR
  ) {
    throw new Error(`Catalog import row ${rowNumber} has an invalid ${label.toLowerCase()}.`);
  }
  return rounded;
}

function importRelationshipIds(value, { label, rowNumber }) {
  if (!Array.isArray(value)) return [];
  const normalized = value.map((entry) => importText(entry, {
    label,
    maxLength: 256,
    required: true,
    rowNumber
  }));
  if (normalized.some((id) => id === "." || id === ".." || id.includes("/"))) {
    throw new Error(`Catalog import row ${rowNumber} has an invalid ${label.toLowerCase()}.`);
  }
  if (new Set(normalized).size !== normalized.length) {
    throw new Error(`Catalog import row ${rowNumber} repeats a ${label.toLowerCase()}.`);
  }
  if (normalized.length > IMPORT_RELATIONSHIP_LIMIT) {
    throw new Error(`Catalog import row ${rowNumber} has more than ${IMPORT_RELATIONSHIP_LIMIT} ${label.toLowerCase()} values.`);
  }
  return normalized;
}

export function buildCatalogImportDraftChanges({ importType = "", rows = [], importBatchId = "" } = {}) {
  const collection = COLLECTION_BY_CATALOG_KEY[importType] || (importType === "menuItems" ? "menuItems" : "");
  if (!collection) throw new Error("Choose a supported catalog import type.");
  return (Array.isArray(rows) ? rows : []).map((row, index) => {
    const record = row?.record || row?.data || row || {};
    const rowNumber = Number.isSafeInteger(Number(row?.rowNumber)) ? Number(row.rowNumber) : index + 1;
    const name = importText(record.name, { label: "Name", required: true, rowNumber });
    let payload;
    if (importType === "packages") {
      payload = {
        name,
        pppMinor: importMoney(record.ppp, { label: "Price per person", required: true, positive: true, rowNumber }),
        costPppMinor: importMoney(record.costPpp, { label: "Cost per person", rowNumber }),
        active: record.active !== false,
        includedMenuItemIds: importRelationshipIds(record.includedMenuItemIds, { label: "Included menu item", rowNumber }),
        includedAddonIds: importRelationshipIds(record.includedAddonIds, { label: "Included add-on", rowNumber }),
        includedRentalIds: importRelationshipIds(record.includedRentalIds, { label: "Included rental", rowNumber })
      };
    } else if (importType === "addons") {
      const basis = record.pricingType || record.type || "per_event";
      if (!["per_person", "per_item", "per_event"].includes(basis)) {
        throw new Error(`Catalog import row ${rowNumber} has an invalid pricing basis.`);
      }
      payload = {
        name,
        priceMinor: importMoney(record.price, { label: "Price", required: true, rowNumber }),
        costMinor: importMoney(record.cost, { label: "Cost", rowNumber }),
        pricingType: basis,
        type: basis,
        staffRole: "",
        active: record.active !== false,
        portalDecidable: false
      };
    } else if (importType === "rentals") {
      const qtyPerGuests = Number(record.qtyPerGuests);
      if (!Number.isSafeInteger(qtyPerGuests) || qtyPerGuests < 1 || qtyPerGuests > 100_000) {
        throw new Error(`Catalog import row ${rowNumber} needs a whole-number guests-per-unit ratio from 1 to 100000.`);
      }
      payload = {
        name,
        priceMinor: importMoney(record.price, { label: "Price", required: true, rowNumber }),
        costMinor: importMoney(record.cost, { label: "Cost", rowNumber }),
        qtyPerGuests,
        pricingType: "per_item",
        type: "per_item",
        active: record.active !== false,
        portalDecidable: false
      };
    } else if (importType === "eventTypes") {
      payload = {
        name,
        active: record.active !== false
      };
    } else if (importType === "menuCategories") {
      if (!String(record.eventTypeId || "").trim()) {
        throw new Error(`Catalog import row ${rowNumber} needs an event type.`);
      }
      payload = {
        name,
        eventTypeId: importText(record.eventTypeId, { label: "Event type ID", maxLength: 256, required: true, rowNumber }),
        active: record.active !== false
      };
    } else {
      const basis = record.pricingType || record.type || "per_item";
      const eventTypeId = importText(record.eventTypeId, { label: "Event type ID", maxLength: 256, rowNumber });
      const categoryId = importText(record.categoryId, { label: "Menu section ID", maxLength: 256, rowNumber });
      if (!eventTypeId || !categoryId) {
        throw new Error(`Catalog import row ${rowNumber} needs both an event type and menu section.`);
      }
      if (!["per_person", "per_item", "per_event"].includes(basis)) {
        throw new Error(`Catalog import row ${rowNumber} has an invalid pricing basis.`);
      }
      payload = { name, eventTypeId, categoryId, priceMinor: importMoney(record.price, { label: "Price", required: true, rowNumber }), costMinor: importMoney(record.cost, { label: "Cost", rowNumber }), pricingType: basis, type: basis, active: record.active !== false };
    }
    return { collection, recordId: importRecordId(importBatchId, row, index), intent: "create", payload };
  });
}

const MAX_CATALOG_DRAFT_CHANGES = 400;
const MAX_CATALOG_DRAFT_BYTES = 900_000;

function approximateUtf8Bytes(value) {
  return new TextEncoder().encode(JSON.stringify(value)).length;
}

function catalogImportFingerprintValue({ organizationId, importType, importBatchId, patches }) {
  return stableValue({
    schemaVersion: "catalog-import-input-v1",
    organizationId: String(organizationId || "").trim(),
    importType: String(importType || "").trim(),
    importBatchId: String(importBatchId || "").trim(),
    patches
  });
}

async function buildCatalogImportFingerprint(input) {
  return sha256CanonicalValue(catalogImportFingerprintValue(input));
}

async function buildCatalogImportPlanHash({ inputFingerprint, expectedGeneration, baseCatalogRevision, currentCatalogRevision, patches }) {
  return sha256CanonicalValue(stableValue({
    schemaVersion: "catalog-import-plan-v1",
    inputFingerprint,
    expectedGeneration: Number(expectedGeneration || 0),
    baseCatalogRevision: Number(baseCatalogRevision || 0),
    currentCatalogRevision: Number(currentCatalogRevision || 0),
    patches
  }));
}

function catalogImportError(code, message) {
  const error = new Error(message);
  error.code = code;
  return error;
}

function catalogImportReceiptMismatch(reason) {
  return catalogImportError(
    "failed-precondition",
    `The catalog draft save receipt did not match the reviewed import plan (${reason}). Refresh the shared draft and run preflight again.`
  );
}

const CATALOG_IMPORT_MUTATION_STATUSES = new Set(["staged", "published"]);

function compatibleCatalogImportIntent(requestedIntent, authoritativeIntent) {
  return requestedIntent === authoritativeIntent || authoritativeIntent === "create";
}

function isIsoInstant(value) {
  return typeof value === "string"
    && value.length > 0
    && Number.isFinite(Date.parse(value));
}

function assertCatalogImportMutationReceipt({ result, plan, patches, organizationId, requestId }) {
  const expectedOrganizationId = String(organizationId || "").trim();
  const mutationStatus = String(result?.mutationStatus || "");
  const receipt = result?.mutationReceipt;
  if (!CATALOG_IMPORT_MUTATION_STATUSES.has(mutationStatus)) {
    throw catalogImportReceiptMismatch("unsupported mutation status");
  }
  if (!receipt || typeof receipt !== "object" || Array.isArray(receipt)) {
    throw catalogImportReceiptMismatch("missing durable mutation receipt");
  }
  if (receipt.schemaVersion !== 1) {
    throw catalogImportReceiptMismatch("schema version mismatch");
  }
  if (!receipt.actor || !String(receipt.actor.uid || "").trim()) {
    throw catalogImportReceiptMismatch("actor identity missing");
  }
  if (
    result?.organizationId !== expectedOrganizationId
    || receipt.organizationId !== expectedOrganizationId
  ) {
    throw catalogImportReceiptMismatch("organization mismatch");
  }
  if (receipt.requestId !== requestId) {
    throw catalogImportReceiptMismatch("request identity mismatch");
  }
  if (receipt.status !== mutationStatus) {
    throw catalogImportReceiptMismatch("mutation status mismatch");
  }
  if (!/^[a-f0-9]{64}$/.test(String(receipt.draftSessionId || ""))) {
    throw catalogImportReceiptMismatch("draft session identity mismatch");
  }

  const expectedBaseCatalogRevision = Number(plan.baseCatalogRevision);
  if (
    !Number.isSafeInteger(expectedBaseCatalogRevision)
    || !Number.isSafeInteger(receipt.baseCatalogRevision)
    || receipt.baseCatalogRevision !== expectedBaseCatalogRevision
  ) {
    throw catalogImportReceiptMismatch("base catalog revision mismatch");
  }

  const expectedGeneration = Number(plan.expectedGeneration);
  if (
    !Number.isSafeInteger(expectedGeneration)
    || !Number.isSafeInteger(receipt.expectedGeneration)
    || receipt.expectedGeneration !== expectedGeneration
  ) {
    throw catalogImportReceiptMismatch("expected generation mismatch");
  }
  if (
    !Number.isSafeInteger(receipt.draftGeneration)
    || receipt.draftGeneration !== expectedGeneration + 1
  ) {
    throw catalogImportReceiptMismatch("resulting draft generation mismatch");
  }

  const expectedDraftChangeCount = Number(plan.projectedDraftChangeCount);
  if (
    !Number.isSafeInteger(expectedDraftChangeCount)
    || !Number.isSafeInteger(receipt.resultingDraftChangedRecordCount)
    || receipt.resultingDraftChangedRecordCount !== expectedDraftChangeCount
  ) {
    throw catalogImportReceiptMismatch("resulting draft change projection mismatch");
  }
  if (
    !Number.isSafeInteger(receipt.requestedChangeCount)
    || receipt.requestedChangeCount !== patches.length
    || !Array.isArray(receipt.changes)
    || receipt.changes.length !== patches.length
  ) {
    throw catalogImportReceiptMismatch("requested patch count mismatch");
  }
  if (!isIsoInstant(receipt.stagedAtISO)) {
    throw catalogImportReceiptMismatch("staged receipt timestamp mismatch");
  }

  const authoritativeById = new Map();
  receipt.changes.forEach((change) => {
    const id = String(change?.id || "");
    if (!id || authoritativeById.has(id)) {
      throw catalogImportReceiptMismatch("duplicate or missing requested patch identity");
    }
    authoritativeById.set(id, change);
  });

  patches.forEach((patch) => {
    const expectedId = `${patch.collection}:${patch.recordId}`;
    const authoritative = authoritativeById.get(expectedId);
    if (
      !authoritative
      || authoritative.collection !== patch.collection
      || authoritative.recordId !== patch.recordId
      || authoritative.requestedIntent !== patch.intent
      || !compatibleCatalogImportIntent(patch.intent, authoritative.intent)
      || !valuesMatch(authoritative.payload, patch.payload)
    ) {
      throw catalogImportReceiptMismatch(`requested patch ${expectedId} mismatch`);
    }
  });

  if (mutationStatus === "published") {
    if (
      !/^[A-Za-z0-9_-]{16,128}$/.test(String(receipt.publicationReceiptId || ""))
      || !Number.isSafeInteger(receipt.catalogRevisionAfter)
      || receipt.catalogRevisionAfter !== expectedBaseCatalogRevision + 1
      || !isIsoInstant(receipt.publishedAtISO)
    ) {
      throw catalogImportReceiptMismatch("published receipt projection mismatch");
    }
  }

  return { mutationStatus, receipt };
}

export async function preflightCatalogImportDraft({
  organizationId = "",
  importType = "",
  rows = [],
  importBatchId = createCatalogSetupRequestId("import")
} = {}) {
  const current = await getCatalogSetupDraft({ organizationId });
  const draft = current?.draft || {};
  const patches = buildCatalogImportDraftChanges({ importType, rows, importBatchId });
  const expectedGeneration = Number(draft.state === "open" ? draft.generation || 0 : 0);
  const currentCatalogRevision = Number(current.currentCatalogRevision || 0);
  const baseCatalogRevision = Number(draft.state === "open" ? draft.baseCatalogRevision : currentCatalogRevision);
  if (draft.state === "open" && baseCatalogRevision !== currentCatalogRevision) {
    throw new Error(`The shared catalog draft is based on revision ${baseCatalogRevision}, but revision ${currentCatalogRevision} is active. Review, discard, or reconcile that draft in Library before importing.`);
  }
  const existingChanges = Array.isArray(draft.changes) ? draft.changes : [];
  const merged = new Map(existingChanges.map((change) => [
    String(change?.id || `${change?.collection}:${change?.recordId}`),
    change
  ]));
  patches.forEach((change) => {
    const id = `${change.collection}:${change.recordId}`;
    const projected = { id, ...change, baselineHash: "0".repeat(64) };
    if (approximateUtf8Bytes(projected) > 30_000) {
      throw new Error(`This source would make a shared catalog draft change too large for authoritative review. Split the source before importing ${id}.`);
    }
    merged.set(id, projected);
  });
  const projectedChanges = [...merged.values()];
  if (projectedChanges.length > MAX_CATALOG_DRAFT_CHANGES) {
    throw new Error(`This import would grow the shared catalog draft to ${projectedChanges.length} changes; publish or discard work before the ${MAX_CATALOG_DRAFT_CHANGES}-change limit.`);
  }
  if (approximateUtf8Bytes(projectedChanges) > MAX_CATALOG_DRAFT_BYTES) {
    throw new Error("This import would make the shared catalog draft too large. Split the source and publish smaller reviewed groups.");
  }
  const inputFingerprint = await buildCatalogImportFingerprint({ organizationId, importType, importBatchId, patches });
  const planHash = await buildCatalogImportPlanHash({
    inputFingerprint,
    expectedGeneration,
    baseCatalogRevision,
    currentCatalogRevision,
    patches
  });
  return {
    ok: true,
    status: "ready",
    authority: "catalog_draft_server_read",
    organizationId: String(organizationId || "").trim(),
    importType,
    importBatchId,
    stagedCount: patches.length,
    projectedDraftChangeCount: projectedChanges.length,
    expectedGeneration,
    baseCatalogRevision,
    currentCatalogRevision,
    inputFingerprint,
    planHash,
    observedAtISO: new Date().toISOString(),
    requestId: createCatalogSetupRequestId("import_sync"),
    patches
  };
}

export async function stageCatalogImportDraft({
  organizationId = "",
  importType = "",
  rows = [],
  importBatchId = createCatalogSetupRequestId("import"),
  preflight = null
} = {}) {
  const plan = preflight;
  const patches = buildCatalogImportDraftChanges({ importType, rows, importBatchId });
  if (
    plan?.ok !== true
    || plan?.status !== "ready"
    ||
    String(plan.organizationId || "").trim() !== String(organizationId || "").trim()
    || plan.importBatchId !== importBatchId
    || plan.importType !== importType
    || !Array.isArray(plan.patches)
    || !/^[a-f0-9]{64}$/.test(String(plan.inputFingerprint || ""))
    || !/^[a-f0-9]{64}$/.test(String(plan.planHash || ""))
  ) {
    throw catalogImportError("failed-precondition", "The catalog preflight no longer matches this import. Run preflight again.");
  }
  const currentInputFingerprint = await buildCatalogImportFingerprint({ organizationId, importType, importBatchId, patches });
  const currentPlanHash = await buildCatalogImportPlanHash({
    inputFingerprint: currentInputFingerprint,
    expectedGeneration: plan.expectedGeneration,
    baseCatalogRevision: plan.baseCatalogRevision,
    currentCatalogRevision: plan.currentCatalogRevision,
    patches
  });
  if (
    currentInputFingerprint !== plan.inputFingerprint
    || currentPlanHash !== plan.planHash
    || !valuesMatch(plan.patches, patches)
  ) {
    throw catalogImportError("failed-precondition", "The included catalog records changed after preflight. Run preflight again for this exact plan.");
  }
  const requestId = plan.requestId
    || `import_sync_${String(importBatchId).replace(/[^A-Za-z0-9_-]/g, "_")}`.slice(0, 128);
  const result = await saveCatalogSetupDraft({
    organizationId,
    requestId,
    expectedGeneration: Number(plan.expectedGeneration || 0),
    baseCatalogRevision: Number(plan.baseCatalogRevision || 0),
    patches
  });
  if (result?.ok !== true) {
    throw catalogImportError(
      String(result?.code || "failed-precondition"),
      String(result?.error || result?.message || "The catalog draft did not return an accepted durable mutation receipt.")
    );
  }
  const { mutationStatus, receipt } = assertCatalogImportMutationReceipt({
    result,
    plan,
    patches,
    organizationId,
    requestId
  });
  return {
    ok: true,
    status: mutationStatus,
    importBatchId,
    importType,
    stagedCount: patches.length,
    createdCount: 0,
    skippedCount: 0,
    catalogRevision: mutationStatus === "published"
      ? receipt.catalogRevisionAfter
      : Number(plan.currentCatalogRevision || 0),
    mutationReceipt: receipt,
    idempotentReplay: result.idempotentReplay === true,
    ...(mutationStatus === "published"
      ? {
          publicationReceiptId: receipt.publicationReceiptId,
          catalogRevisionAfter: receipt.catalogRevisionAfter,
          publishedAtISO: receipt.publishedAtISO
        }
      : { draft: result?.draft || null })
  };
}

async function callCatalogSetup(name, payload) {
  if (E2E_FUNCTION_ADAPTER_ENABLED) {
    const adapter = globalThis.__quotePilotE2eFunctions;
    if (typeof adapter?.[name] === "function") return adapter[name](payload);
  }
  if (!firebaseReady || !cloudFunctions) {
    throw new Error("Cloud Functions unavailable. Configure Firebase before editing the catalog draft.");
  }
  const callable = httpsCallable(cloudFunctions, name);
  const result = await callable(payload);
  return result?.data || { ok: false };
}

export function getCatalogSetupDraft({ organizationId = "" } = {}) {
  return callCatalogSetup("getCatalogSetupDraft", { organizationId });
}

export function saveCatalogSetupDraft({
  organizationId = "",
  requestId = createCatalogSetupRequestId("draft"),
  expectedGeneration = 0,
  baseCatalogRevision = 0,
  patches = [],
  setupPreset = null
} = {}) {
  return callCatalogSetup("saveCatalogSetupDraft", {
    organizationId,
    requestId,
    expectedGeneration,
    baseCatalogRevision,
    patches,
    ...(setupPreset ? { setupPreset } : {})
  });
}

export async function stageCatalogSetupPreset({ organizationId = "", packId = "", packVersion = null } = {}) {
  const current = await getCatalogSetupDraft({ organizationId });
  const draft = current?.draft || {};
  return saveCatalogSetupDraft({
    organizationId,
    requestId: createCatalogSetupRequestId("setup_preset"),
    expectedGeneration: Number(draft.generation || 0),
    baseCatalogRevision: Number(draft.state === "open" ? draft.baseCatalogRevision : current.currentCatalogRevision || 0),
    patches: [],
    setupPreset: { packId, packVersion }
  });
}

export function reviewCatalogSetupDraft({
  organizationId = "",
  expectedGeneration = 0,
  baseCatalogRevision = 0
} = {}) {
  return callCatalogSetup("reviewCatalogSetupDraft", {
    organizationId,
    expectedGeneration,
    baseCatalogRevision
  });
}

export function publishCatalogSetupDraft({
  organizationId = "",
  requestId = createCatalogSetupRequestId("publish"),
  expectedGeneration = 0,
  baseCatalogRevision = 0
} = {}) {
  return callCatalogSetup("publishCatalogSetupDraft", {
    organizationId,
    requestId,
    expectedGeneration,
    baseCatalogRevision
  });
}
