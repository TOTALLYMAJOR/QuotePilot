"use strict";

const { createHash } = require("node:crypto");

const MAX_IMPORT_RECORDS = 350;
const MAX_DUPLICATE_SCAN_RECORDS = 2000;
const MAX_TRANSACTION_WRITES = 450;
const MAX_MONEY_MINOR = 1_000_000_000;
const CATALOG_BATCH_KIND = "catalog";
const CATALOG_IMPORT_SOURCE = "import_studio";

const CATALOG_IMPORT_TYPES = Object.freeze({
  packages: Object.freeze({ collection: "catalogPackages", moneyMinorKey: "pppMinor", moneyMajorKey: "ppp" }),
  addons: Object.freeze({ collection: "catalogAddons", moneyMinorKey: "priceMinor", moneyMajorKey: "price" }),
  rentals: Object.freeze({ collection: "catalogRentals", moneyMinorKey: "priceMinor", moneyMajorKey: "price" }),
  menuItems: Object.freeze({ collection: "menuItems", moneyMinorKey: "priceMinor", moneyMajorKey: "price" })
});

const BUSINESS_METADATA_KEYS = new Set([
  "organizationId",
  "importBatchId",
  "importSource",
  "importBaselineHash",
  "importCatalogRevision",
  "createdAt",
  "updatedAt",
  "createdAtISO",
  "updatedAtISO"
]);

class CatalogImportError extends Error {
  constructor(code, message, details = undefined) {
    super(message);
    this.name = "CatalogImportError";
    this.code = code;
    this.details = details;
  }
}

function text(value, maxLength = 500) {
  return String(value ?? "").trim().slice(0, maxLength);
}

function normalizeOrganizationId(value) {
  return text(value, 160)
    .toLowerCase()
    .replace(/[^\w-]+/g, "-")
    .replace(/-{2,}/g, "-")
    .replace(/^-|-$/g, "");
}

function normalizeEmail(value) {
  return text(value, 320).toLowerCase();
}

function normalizeNameKey(value) {
  return text(value, 300).toLowerCase().replace(/\s+/g, " ");
}

function normalizeCatalogImportType(value) {
  const importType = text(value, 40);
  return Object.prototype.hasOwnProperty.call(CATALOG_IMPORT_TYPES, importType)
    ? importType
    : "";
}

function normalizeBatchId(value) {
  const batchId = text(value, 128);
  return /^[A-Za-z0-9_-]{20,128}$/.test(batchId) ? batchId : "";
}

function stableValue(value) {
  if (Array.isArray(value)) return value.map(stableValue);
  if (value && typeof value === "object") {
    return Object.keys(value)
      .sort()
      .reduce((result, key) => {
        if (value[key] !== undefined && typeof value[key] !== "function") {
          result[key] = stableValue(value[key]);
        }
        return result;
      }, {});
  }
  return value;
}

function hashValue(value) {
  return createHash("sha256").update(JSON.stringify(stableValue(value))).digest("hex");
}

function normalizeStableIds(value) {
  if (!Array.isArray(value)) return [];
  const seen = new Set();
  return value
    .map((entry) => text(entry, 256))
    .filter((entry) => {
      if (!entry || entry.includes("/") || seen.has(entry)) return false;
      seen.add(entry);
      return true;
    })
    .slice(0, 100);
}

function requireIdentifier(value, label) {
  const identifier = text(value, 256);
  if (!identifier || identifier.includes("/") || identifier === "." || identifier === "..") {
    throw new CatalogImportError("invalid-argument", `${label} is required and must be a valid document id.`);
  }
  return identifier;
}

function normalizePricingType(value, fallback = "per_event") {
  const normalized = text(value, 40).toLowerCase().replace(/[\s-]+/g, "_");
  if (["per_person", "person", "pp", "ppp"].includes(normalized)) return "per_person";
  if (["per_item", "item", "unit", "each"].includes(normalized)) return "per_item";
  if (["per_event", "event", "flat", "flat_fee"].includes(normalized)) return "per_event";
  return fallback;
}

function normalizeBoolean(value, fallback = true) {
  if (typeof value === "boolean") return value;
  const normalized = text(value, 20).toLowerCase();
  if (["false", "no", "n", "0", "inactive", "disabled", "unavailable"].includes(normalized)) {
    return false;
  }
  if (["true", "yes", "y", "1", "active", "enabled", "available"].includes(normalized)) {
    return true;
  }
  return fallback;
}

function resolveMoneyMinor(source, minorKey, majorKey, label) {
  const hasMinor = Object.prototype.hasOwnProperty.call(source, minorKey)
    && source[minorKey] !== ""
    && source[minorKey] !== null
    && source[minorKey] !== undefined;
  if (hasMinor) {
    const minor = Number(source[minorKey]);
    if (Number.isSafeInteger(minor) && minor >= 0 && minor <= MAX_MONEY_MINOR) return minor;
    throw new CatalogImportError("invalid-argument", `${label} must be an integer minor-unit amount.`);
  }
  const amount = Number(source[majorKey]);
  const scaled = Math.round(amount * 100);
  if (
    !Number.isFinite(amount)
    || amount < 0
    || !Number.isSafeInteger(scaled)
    || scaled > MAX_MONEY_MINOR
    || Math.abs((amount * 100) - scaled) > 0.000001
  ) {
    throw new CatalogImportError("invalid-argument", `${label} must be a non-negative amount with at most two decimals.`);
  }
  return scaled;
}

function resolveOptionalMoneyMinor(source, minorKey, majorKey, label) {
  const hasMinor = Object.prototype.hasOwnProperty.call(source, minorKey);
  const hasMajor = Object.prototype.hasOwnProperty.call(source, majorKey);
  if ((!hasMinor || source[minorKey] === "" || source[minorKey] === null || source[minorKey] === undefined)
    && (!hasMajor || source[majorKey] === "" || source[majorKey] === null || source[majorKey] === undefined)) return null;
  return resolveMoneyMinor(source, minorKey, majorKey, label);
}

function sanitizeCatalogImportRecord(importType, input = {}) {
  const definition = CATALOG_IMPORT_TYPES[importType];
  if (!definition) {
    throw new CatalogImportError("invalid-argument", "Choose a supported catalog import type.");
  }
  const source = input && typeof input === "object" ? input : {};
  const name = text(source.name, 300);
  if (!name) throw new CatalogImportError("invalid-argument", "Every catalog import row needs a name.");
  const moneyMinor = resolveMoneyMinor(
    source,
    definition.moneyMinorKey,
    definition.moneyMajorKey,
    importType === "packages" ? "Package price" : "Catalog price"
  );

  if (importType === "packages") {
    return {
      name,
      pppMinor: moneyMinor,
      costPppMinor: resolveOptionalMoneyMinor(source, "costPppMinor", "costPpp", "Package cost"),
      description: text(source.description, 1200),
      active: normalizeBoolean(source.active, true),
      includedMenuItemIds: [],
      includedAddonIds: [],
      includedRentalIds: []
    };
  }
  if (importType === "addons") {
    const pricingType = normalizePricingType(source.pricingType || source.type, "per_event");
    return {
      name,
      priceMinor: moneyMinor,
      costMinor: resolveOptionalMoneyMinor(source, "costMinor", "cost", "Add-on cost"),
      pricingType,
      type: pricingType,
      description: text(source.description, 1200),
      active: normalizeBoolean(source.active, true)
    };
  }
  if (importType === "rentals") {
    const rawQuantity = Number(source.qtyPerGuests || 1);
    const qtyPerGuests = Number.isFinite(rawQuantity) && rawQuantity > 0
      ? Math.min(100_000, rawQuantity)
      : 1;
    return {
      name,
      priceMinor: moneyMinor,
      costMinor: resolveOptionalMoneyMinor(source, "costMinor", "cost", "Rental cost"),
      qtyPerGuests,
      pricingType: "per_item",
      type: "per_item",
      description: text(source.description, 1200),
      active: normalizeBoolean(source.active, true)
    };
  }
  const pricingType = normalizePricingType(source.pricingType || source.type, "per_item");
  return {
    name,
    eventTypeId: requireIdentifier(source.eventTypeId, "eventTypeId"),
    categoryId: requireIdentifier(source.categoryId, "categoryId"),
    priceMinor: moneyMinor,
    costMinor: resolveOptionalMoneyMinor(source, "costMinor", "cost", "Menu item cost"),
    pricingType,
    type: pricingType,
    active: normalizeBoolean(source.active, true)
  };
}

function recordBusinessData(data = {}) {
  return Object.keys(data)
    .sort()
    .reduce((result, key) => {
      if (!BUSINESS_METADATA_KEYS.has(key) && data[key] !== undefined && typeof data[key] !== "function") {
        result[key] = stableValue(data[key]);
      }
      return result;
    }, {});
}

function recordBaselineHash(data = {}) {
  return hashValue(recordBusinessData(data));
}

function normalizeImportRows(importType, records = []) {
  if (!Array.isArray(records) || records.length === 0) {
    throw new CatalogImportError("invalid-argument", "No valid catalog records are ready to import.");
  }
  if (records.length > MAX_IMPORT_RECORDS) {
    throw new CatalogImportError(
      "resource-exhausted",
      `Catalog import batches are limited to ${MAX_IMPORT_RECORDS} records.`
    );
  }
  return records.map((entry, index) => {
    const source = entry?.record && typeof entry.record === "object" ? entry.record : entry;
    const data = sanitizeCatalogImportRecord(importType, source);
    return {
      rowNumber: Number.isSafeInteger(Number(entry?.rowNumber))
        ? Number(entry.rowNumber)
        : index + 2,
      data,
      duplicateKey: normalizeNameKey(data.name)
    };
  });
}

function currentCatalogRevision(settings = {}) {
  const revision = Number(settings.catalogRevision || 0);
  return Number.isSafeInteger(revision) && revision >= 0 ? revision : 0;
}

function assertExpectedRevision(settings, expectedCatalogRevision) {
  if (!Number.isSafeInteger(expectedCatalogRevision) || expectedCatalogRevision < 0) {
    throw new CatalogImportError("invalid-argument", "expectedCatalogRevision is required.");
  }
  const currentRevision = currentCatalogRevision(settings);
  if (currentRevision !== expectedCatalogRevision) {
    throw new CatalogImportError(
      "aborted",
      `Catalog revision changed from ${expectedCatalogRevision} to ${currentRevision}. Reload before continuing.`,
      { expectedCatalogRevision, currentCatalogRevision }
    );
  }
  return currentRevision;
}

function requestHash({ importType, fileName, rows }) {
  return hashValue({
    importType,
    fileName: text(fileName, 240),
    rows: rows.map((row) => ({ rowNumber: row.rowNumber, data: row.data }))
  });
}

function deterministicRecordId(importBatchId, importType, row, index) {
  return `imp_${hashValue({ importBatchId, importType, rowNumber: row.rowNumber, index, key: row.duplicateKey }).slice(0, 36)}`;
}

function serverTimeFields(serverTimestamp, nowISO, { created = false } = {}) {
  return {
    ...(created && serverTimestamp ? { createdAt: serverTimestamp() } : {}),
    ...(serverTimestamp ? { updatedAt: serverTimestamp() } : {}),
    ...(created ? { createdAtISO: nowISO } : {}),
    updatedAtISO: nowISO
  };
}

function assertReceiptIdentity(receipt, { organizationId, importBatchId, importType, operationHash }) {
  if (
    receipt.batchKind !== CATALOG_BATCH_KIND
    || receipt.organizationId !== organizationId
    || receipt.importBatchId !== importBatchId
    || receipt.importType !== importType
    || receipt.requestHash !== operationHash
  ) {
    throw new CatalogImportError(
      "already-exists",
      "This import batch identity is already bound to different catalog input. Start a new import."
    );
  }
}

function importResultFromReceipt(receipt = {}) {
  return {
    ok: true,
    importBatchId: text(receipt.importBatchId, 128),
    organizationId: normalizeOrganizationId(receipt.organizationId),
    importType: normalizeCatalogImportType(receipt.importType),
    createdCount: Math.max(0, Number(receipt.createdCount || 0)),
    skippedCount: Math.max(0, Number(receipt.skippedCount || 0)),
    createdRecords: Array.isArray(receipt.createdRecords) ? receipt.createdRecords : [],
    skippedRows: Array.isArray(receipt.skippedRows) ? receipt.skippedRows : [],
    status: text(receipt.status, 40) || "completed",
    catalogRevisionBefore: Math.max(0, Number(receipt.catalogRevisionBefore || 0)),
    catalogRevision: Math.max(0, Number(receipt.catalogRevisionAfter || receipt.catalogRevision || 0)),
    catalogRevisionAfter: Math.max(0, Number(receipt.catalogRevisionAfter || receipt.catalogRevision || 0)),
    idempotentReplay: true
  };
}

function rollbackResultFromReceipt(receipt = {}) {
  return {
    ok: true,
    importBatchId: text(receipt.importBatchId, 128),
    organizationId: normalizeOrganizationId(receipt.organizationId),
    importType: normalizeCatalogImportType(receipt.importType),
    status: "rolled_back",
    deletedCount: Math.max(0, Number(receipt.rolledBackCount || 0)),
    protectedCount: Math.max(0, Number(receipt.rollbackProtectedCount || 0)),
    missingCount: Math.max(0, Number(receipt.rollbackMissingCount || 0)),
    protectedRecords: Array.isArray(receipt.rollbackProtectedRecords)
      ? receipt.rollbackProtectedRecords
      : [],
    catalogRevisionBefore: Math.max(0, Number(receipt.rollbackCatalogRevisionBefore || 0)),
    catalogRevision: Math.max(0, Number(receipt.rollbackCatalogRevisionAfter || receipt.catalogRevision || 0)),
    catalogRevisionAfter: Math.max(0, Number(receipt.rollbackCatalogRevisionAfter || receipt.catalogRevision || 0)),
    idempotentReplay: true
  };
}

function validateMenuReferences(rows, eventTypeSnapshot, categorySnapshot) {
  const eventTypeIds = new Set(eventTypeSnapshot.docs.map((snapshot) => snapshot.id));
  const categories = new Map(categorySnapshot.docs.map((snapshot) => [snapshot.id, snapshot.data() || {}]));
  rows.forEach((row) => {
    const category = categories.get(row.data.categoryId);
    if (!eventTypeIds.has(row.data.eventTypeId)) {
      throw new CatalogImportError(
        "failed-precondition",
        `Menu row ${row.rowNumber} references missing event type ${row.data.eventTypeId}.`
      );
    }
    if (!category || text(category.eventTypeId, 256) !== row.data.eventTypeId) {
      throw new CatalogImportError(
        "failed-precondition",
        `Menu row ${row.rowNumber} has an invalid category or event-type boundary.`
      );
    }
  });
}

async function createCatalogImportBatch({
  db,
  organizationId = "",
  organizationName = "",
  importType = "",
  fileName = "",
  records = [],
  importBatchId = "",
  expectedCatalogRevision,
  actorUid = "",
  actorEmail = "",
  serverTimestamp = null,
  nowISO = new Date().toISOString()
} = {}) {
  const normalizedOrganizationId = normalizeOrganizationId(organizationId);
  const normalizedImportType = normalizeCatalogImportType(importType);
  const normalizedBatchId = normalizeBatchId(importBatchId);
  if (!db || !normalizedOrganizationId) {
    throw new CatalogImportError("invalid-argument", "organizationId is required.");
  }
  if (!normalizedImportType) {
    throw new CatalogImportError("invalid-argument", "Choose a supported catalog import type.");
  }
  if (!normalizedBatchId) {
    throw new CatalogImportError("invalid-argument", "A stable importBatchId is required.");
  }
  const rows = normalizeImportRows(normalizedImportType, records);
  const operationHash = requestHash({ importType: normalizedImportType, fileName, rows });
  const definition = CATALOG_IMPORT_TYPES[normalizedImportType];
  const organizationRef = db.collection("organizations").doc(normalizedOrganizationId);
  const settingsRef = organizationRef.collection("settings").doc("config");
  const receiptRef = organizationRef.collection("importBatches").doc(normalizedBatchId);
  const targetCollectionRef = organizationRef.collection(definition.collection);

  return db.runTransaction(async (transaction) => {
    const receiptSnapshot = await transaction.get(receiptRef);
    if (receiptSnapshot.exists) {
      const receipt = receiptSnapshot.data() || {};
      assertReceiptIdentity(receipt, {
        organizationId: normalizedOrganizationId,
        importBatchId: normalizedBatchId,
        importType: normalizedImportType,
        operationHash
      });
      if (receipt.status === "completed") return importResultFromReceipt(receipt);
      throw new CatalogImportError(
        "failed-precondition",
        "This catalog import was already rolled back. Start a new import batch."
      );
    }

    const baseReads = [transaction.get(settingsRef), transaction.get(targetCollectionRef)];
    if (normalizedImportType === "menuItems") {
      baseReads.push(
        transaction.get(organizationRef.collection("eventTypes")),
        transaction.get(organizationRef.collection("menuCategories"))
      );
    }
    const [settingsSnapshot, targetSnapshot, eventTypeSnapshot, categorySnapshot] = await Promise.all(baseReads);
    if (!settingsSnapshot.exists) {
      throw new CatalogImportError(
        "failed-precondition",
        "Organization catalog settings are missing. Repair the workspace before importing."
      );
    }
    const settings = settingsSnapshot.data() || {};
    const revision = assertExpectedRevision(settings, expectedCatalogRevision);
    if (targetSnapshot.docs.length > MAX_DUPLICATE_SCAN_RECORDS) {
      throw new CatalogImportError(
        "resource-exhausted",
        `This catalog has more than ${MAX_DUPLICATE_SCAN_RECORDS} ${normalizedImportType} records. Use a managed migration.`
      );
    }
    const existingKeys = new Set();
    const existingIds = new Set();
    targetSnapshot.docs.forEach((snapshot) => {
      existingIds.add(snapshot.id);
      existingKeys.add(normalizeNameKey(snapshot.data()?.name));
    });
    const seenKeys = new Set(existingKeys);
    const createdRecords = [];
    const skippedRows = [];
    const plannedRows = [];

    rows.forEach((row, index) => {
      if (seenKeys.has(row.duplicateKey)) {
        skippedRows.push({ rowNumber: row.rowNumber, reason: "duplicate" });
        return;
      }
      seenKeys.add(row.duplicateKey);
      plannedRows.push({ row, index });
    });
    if (normalizedImportType === "menuItems") {
      validateMenuReferences(plannedRows.map((entry) => entry.row), eventTypeSnapshot, categorySnapshot);
    }
    const nextRevision = revision + (plannedRows.length > 0 ? 1 : 0);

    plannedRows.forEach(({ row, index }) => {
      const recordId = deterministicRecordId(normalizedBatchId, normalizedImportType, row, index);
      if (existingIds.has(recordId)) {
        throw new CatalogImportError(
          "aborted",
          `Catalog record identity ${recordId} was claimed concurrently. Reload before importing.`
        );
      }
      const baselineHash = recordBaselineHash(row.data);
      const recordRef = targetCollectionRef.doc(recordId);
      transaction.set(recordRef, {
        ...row.data,
        organizationId: normalizedOrganizationId,
        importBatchId: normalizedBatchId,
        importSource: CATALOG_IMPORT_SOURCE,
        importBaselineHash: baselineHash,
        importCatalogRevision: nextRevision,
        ...serverTimeFields(serverTimestamp, nowISO, { created: true })
      });
      createdRecords.push({
        collection: definition.collection,
        id: recordId,
        rowNumber: row.rowNumber,
        baselineHash
      });
    });

    if (createdRecords.length + 1 + (createdRecords.length > 0 ? 1 : 0) > MAX_TRANSACTION_WRITES) {
      throw new CatalogImportError(
        "resource-exhausted",
        "This catalog import is too large for one safe transaction."
      );
    }
    if (createdRecords.length > 0) {
      transaction.set(settingsRef, {
        catalogRevision: nextRevision,
        pricingSetupConfirmed: false,
        pricingConfirmation: null,
        ...serverTimeFields(serverTimestamp, nowISO)
      }, { merge: true });
    }
    transaction.set(receiptRef, {
      schemaVersion: 2,
      batchKind: CATALOG_BATCH_KIND,
      operation: "catalog_import",
      importBatchId: normalizedBatchId,
      organizationId: normalizedOrganizationId,
      organizationName: text(organizationName, 300),
      importType: normalizedImportType,
      targetCollection: definition.collection,
      fileName: text(fileName, 240),
      requestHash: operationHash,
      status: "completed",
      sourceRows: rows.length,
      createdCount: createdRecords.length,
      skippedCount: skippedRows.length,
      createdRecords,
      skippedRows,
      catalogRevisionBefore: revision,
      catalogRevisionAfter: nextRevision,
      catalogRevision: nextRevision,
      actor: {
        uid: text(actorUid, 160),
        email: normalizeEmail(actorEmail)
      },
      ...serverTimeFields(serverTimestamp, nowISO, { created: true })
    });
    return {
      ok: true,
      importBatchId: normalizedBatchId,
      organizationId: normalizedOrganizationId,
      importType: normalizedImportType,
      createdCount: createdRecords.length,
      skippedCount: skippedRows.length,
      createdRecords,
      skippedRows,
      status: "completed",
      catalogRevisionBefore: revision,
      catalogRevision: nextRevision,
      catalogRevisionAfter: nextRevision,
      idempotentReplay: false
    };
  });
}

function receiptRecordKey(collectionName, id) {
  return `${text(collectionName, 80)}/${text(id, 256)}`;
}

function settingsDependencyReferences(settings = {}) {
  const references = [];
  const templates = Array.isArray(settings.eventTemplates) ? settings.eventTemplates : [];
  templates.forEach((template) => {
    const packageId = text(template?.pkg || template?.packageId, 256);
    if (packageId) references.push(["catalogPackages", packageId, "event_template"]);
    normalizeStableIds(template?.addons).forEach((id) => references.push(["catalogAddons", id, "event_template"]));
    normalizeStableIds(template?.rentals).forEach((id) => references.push(["catalogRentals", id, "event_template"]));
    normalizeStableIds(template?.menuItems).forEach((id) => references.push(["menuItems", id, "event_template"]));
  });
  const upsellRules = Array.isArray(settings.upsellRules) ? settings.upsellRules : [];
  upsellRules.forEach((rule) => {
    const targetId = text(rule?.targetId, 256);
    const targetType = text(rule?.targetType || rule?.type || rule?.kind, 40).toLowerCase();
    if (!targetId) return;
    if (targetType.includes("package")) references.push(["catalogPackages", targetId, "upsell_rule"]);
    if (targetType.includes("addon") || targetType.includes("add-on")) {
      references.push(["catalogAddons", targetId, "upsell_rule"]);
    }
    if (targetType.includes("rental")) references.push(["catalogRentals", targetId, "upsell_rule"]);
  });
  return references;
}

function packageDependencyReferences(data = {}) {
  return [
    ...normalizeStableIds(data.includedMenuItemIds).map((id) => ["menuItems", id, "package_inclusion"]),
    ...normalizeStableIds(data.includedAddonIds).map((id) => ["catalogAddons", id, "package_inclusion"]),
    ...normalizeStableIds(data.includedRentalIds).map((id) => ["catalogRentals", id, "package_inclusion"])
  ];
}

async function rollbackCatalogImportBatch({
  db,
  organizationId = "",
  importBatchId = "",
  expectedCatalogRevision,
  actorUid = "",
  actorEmail = "",
  serverTimestamp = null,
  nowISO = new Date().toISOString()
} = {}) {
  const normalizedOrganizationId = normalizeOrganizationId(organizationId);
  const normalizedBatchId = normalizeBatchId(importBatchId);
  if (!db || !normalizedOrganizationId) {
    throw new CatalogImportError("invalid-argument", "organizationId is required.");
  }
  if (!normalizedBatchId) {
    throw new CatalogImportError("invalid-argument", "A valid importBatchId is required.");
  }
  const organizationRef = db.collection("organizations").doc(normalizedOrganizationId);
  const settingsRef = organizationRef.collection("settings").doc("config");
  const receiptRef = organizationRef.collection("importBatches").doc(normalizedBatchId);
  const packagesRef = organizationRef.collection("catalogPackages");

  return db.runTransaction(async (transaction) => {
    const receiptSnapshot = await transaction.get(receiptRef);
    if (!receiptSnapshot.exists) {
      throw new CatalogImportError("not-found", "Catalog import receipt was not found.");
    }
    const receipt = receiptSnapshot.data() || {};
    if (
      receipt.batchKind !== CATALOG_BATCH_KIND
      || receipt.operation !== "catalog_import"
      || receipt.organizationId !== normalizedOrganizationId
      || receipt.importBatchId !== normalizedBatchId
    ) {
      throw new CatalogImportError("failed-precondition", "Import receipt does not describe this catalog batch.");
    }
    if (receipt.status === "rolled_back") return rollbackResultFromReceipt(receipt);
    if (receipt.status !== "completed") {
      throw new CatalogImportError("failed-precondition", "Catalog import is not eligible for rollback.");
    }
    const importType = normalizeCatalogImportType(receipt.importType);
    const definition = CATALOG_IMPORT_TYPES[importType];
    if (!definition || receipt.targetCollection !== definition.collection) {
      throw new CatalogImportError("failed-precondition", "Catalog import receipt target is invalid.");
    }
    const createdRecords = Array.isArray(receipt.createdRecords) ? receipt.createdRecords : [];
    if (createdRecords.length > MAX_IMPORT_RECORDS) {
      throw new CatalogImportError("resource-exhausted", "Catalog import receipt exceeds the safe rollback limit.");
    }
    if (createdRecords.some((entry) => text(entry?.collection, 80) !== definition.collection)) {
      throw new CatalogImportError("failed-precondition", "Catalog import receipt crosses collection boundaries.");
    }

    const targetCollectionRef = organizationRef.collection(definition.collection);
    const [settingsSnapshot, packageSnapshot, ...recordSnapshots] = await Promise.all([
      transaction.get(settingsRef),
      transaction.get(packagesRef),
      ...createdRecords.map((entry) => transaction.get(targetCollectionRef.doc(text(entry?.id, 256))))
    ]);
    if (!settingsSnapshot.exists) {
      throw new CatalogImportError("failed-precondition", "Organization catalog settings are missing.");
    }
    const settings = settingsSnapshot.data() || {};
    const revision = assertExpectedRevision(settings, expectedCatalogRevision);
    const deletable = new Set();
    const candidates = new Map();
    const protectedByKey = new Map();
    let missingCount = 0;

    const protect = (collectionName, id, reason) => {
      const key = receiptRecordKey(collectionName, id);
      if (!candidates.has(key)) return false;
      const wasDeletable = deletable.delete(key);
      if (!protectedByKey.has(key)) {
        protectedByKey.set(key, { collection: collectionName, id, reason });
      }
      return wasDeletable;
    };

    createdRecords.forEach((entry, index) => {
      const id = text(entry?.id, 256);
      const key = receiptRecordKey(definition.collection, id);
      const snapshot = recordSnapshots[index];
      candidates.set(key, { entry, snapshot });
      if (!snapshot.exists) {
        missingCount += 1;
        return;
      }
      const data = snapshot.data() || {};
      const baselineHash = text(entry?.baselineHash, 128);
      if (
        data.organizationId !== normalizedOrganizationId
        || data.importSource !== CATALOG_IMPORT_SOURCE
        || data.importBatchId !== normalizedBatchId
        || !baselineHash
        || data.importBaselineHash !== baselineHash
        || recordBaselineHash(data) !== baselineHash
      ) {
        protectedByKey.set(key, {
          collection: definition.collection,
          id,
          reason: "record_modified"
        });
        return;
      }
      deletable.add(key);
    });

    settingsDependencyReferences(settings).forEach(([collectionName, id, reason]) => {
      protect(collectionName, id, reason);
    });

    let dependencyChanged = true;
    while (dependencyChanged) {
      dependencyChanged = false;
      packageSnapshot.docs.forEach((snapshot) => {
        const packageKey = receiptRecordKey("catalogPackages", snapshot.id);
        if (deletable.has(packageKey)) return;
        packageDependencyReferences(snapshot.data() || {}).forEach(([collectionName, id, reason]) => {
          if (protect(collectionName, id, reason)) dependencyChanged = true;
        });
      });
    }

    if (deletable.size + 1 + (deletable.size > 0 ? 1 : 0) > MAX_TRANSACTION_WRITES) {
      throw new CatalogImportError("resource-exhausted", "Catalog rollback is too large for one safe transaction.");
    }
    deletable.forEach((key) => {
      const candidate = candidates.get(key);
      if (candidate?.snapshot?.ref) transaction.delete(candidate.snapshot.ref);
    });
    const nextRevision = revision + (deletable.size > 0 ? 1 : 0);
    const protectedRecords = [...protectedByKey.values()]
      .sort((left, right) => receiptRecordKey(left.collection, left.id).localeCompare(
        receiptRecordKey(right.collection, right.id)
      ));
    if (deletable.size > 0) {
      transaction.set(settingsRef, {
        catalogRevision: nextRevision,
        pricingSetupConfirmed: false,
        pricingConfirmation: null,
        ...serverTimeFields(serverTimestamp, nowISO)
      }, { merge: true });
    }
    transaction.set(receiptRef, {
      status: "rolled_back",
      rolledBackCount: deletable.size,
      rollbackProtectedCount: protectedRecords.length,
      rollbackMissingCount: missingCount,
      rollbackProtectedRecords: protectedRecords,
      rollbackCatalogRevisionBefore: revision,
      rollbackCatalogRevisionAfter: nextRevision,
      catalogRevision: nextRevision,
      rolledBackAtISO: nowISO,
      ...(serverTimestamp ? { rolledBackAt: serverTimestamp() } : {}),
      rollbackActor: {
        uid: text(actorUid, 160),
        email: normalizeEmail(actorEmail)
      },
      ...serverTimeFields(serverTimestamp, nowISO)
    }, { merge: true });
    return {
      ok: true,
      importBatchId: normalizedBatchId,
      organizationId: normalizedOrganizationId,
      importType,
      status: "rolled_back",
      deletedCount: deletable.size,
      protectedCount: protectedRecords.length,
      missingCount,
      protectedRecords,
      catalogRevisionBefore: revision,
      catalogRevision: nextRevision,
      catalogRevisionAfter: nextRevision,
      idempotentReplay: false
    };
  });
}

module.exports = {
  CATALOG_BATCH_KIND,
  CATALOG_IMPORT_SOURCE,
  CATALOG_IMPORT_TYPES,
  CatalogImportError,
  MAX_DUPLICATE_SCAN_RECORDS,
  MAX_IMPORT_RECORDS,
  createCatalogImportBatch,
  hashValue,
  normalizeCatalogImportType,
  recordBaselineHash,
  recordBusinessData,
  rollbackCatalogImportBatch,
  sanitizeCatalogImportRecord
};
