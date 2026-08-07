import {
  collection,
  deleteField,
  doc,
  getDoc,
  getDocs,
  limit,
  query,
  serverTimestamp,
  writeBatch
} from "firebase/firestore";
import { httpsCallable } from "firebase/functions";
import { cloudFunctions, db, firebaseReady } from "./firebase";
import { getImportTypeDefinition, IMPORT_TYPES } from "./importStudio";
import { normalizeOrganizationId } from "./organizationService";

export const MAX_IMPORT_RECORDS = 350;
const MAX_DUPLICATE_SCAN_RECORDS = 2000;
const CUSTOMER_IMPORT_TYPE = "customers";
const CATALOG_IMPORT_TYPES = new Set(["packages", "addons", "rentals", "menuItems"]);
const CREATE_CATALOG_IMPORT_CALLABLE = "createCatalogImportBatch";
const ROLLBACK_CATALOG_IMPORT_CALLABLE = "rollbackCatalogImportBatch";
const E2E_FUNCTION_ADAPTER_ENABLED = ["1", "true", "yes", "on"].includes(
  String(import.meta.env.VITE_E2E_BYPASS_AUTH || "").trim().toLowerCase()
);

function ensureImportReady(organizationId = "") {
  const resolvedOrganizationId = normalizeOrganizationId(organizationId);
  if (!firebaseReady || !db) throw new Error("Firebase is required to import records.");
  if (!resolvedOrganizationId) throw new Error("A destination organization is required.");
  return resolvedOrganizationId;
}

function normalizedKey(value = "") {
  return String(value || "").trim().toLowerCase().replace(/\s+/g, " ");
}

function duplicateKey(record = {}) {
  return record.email ? `email:${normalizedKey(record.email)}` : `name:${normalizedKey(record.name)}`;
}

function cleanRecord(record = {}) {
  return Object.fromEntries(
    Object.entries(record).filter(([, value]) => value !== null && value !== undefined && value !== "")
  );
}

function normalizeImportType(importType = "") {
  const normalized = String(importType || "").trim();
  return IMPORT_TYPES.some((type) => type.id === normalized) ? normalized : "";
}

export function isCatalogImportType(importType = "") {
  return CATALOG_IMPORT_TYPES.has(String(importType || "").trim());
}

export function createImportBatchId(cryptoSource = globalThis.crypto) {
  const uuid = typeof cryptoSource?.randomUUID === "function"
    ? cryptoSource.randomUUID().replace(/-/g, "")
    : "";
  if (uuid) return `catalog_${uuid}`;
  const bytes = new Uint8Array(16);
  if (typeof cryptoSource?.getRandomValues === "function") {
    cryptoSource.getRandomValues(bytes);
  } else {
    for (let index = 0; index < bytes.length; index += 1) {
      bytes[index] = Math.floor(Math.random() * 256);
    }
  }
  const suffix = [...bytes].map((value) => value.toString(16).padStart(2, "0")).join("");
  return `catalog_${suffix}`;
}

async function callE2eAdapter(name, payload) {
  if (!E2E_FUNCTION_ADAPTER_ENABLED) return null;
  const adapter = globalThis.__quotePilotE2eFunctions;
  if (typeof adapter?.[name] !== "function") return null;
  return { handled: true, result: await adapter[name](payload) };
}

async function callCatalogImportFunction(name, payload) {
  const e2e = await callE2eAdapter(name, payload);
  if (e2e?.handled) return e2e.result;
  if (!firebaseReady || !cloudFunctions) {
    throw new Error("Cloud Functions unavailable. Configure Firebase before importing catalog records.");
  }
  const callable = httpsCallable(cloudFunctions, name);
  const response = await callable(payload);
  return response?.data || { ok: false };
}

async function createCustomerImportBatch({
  organizationId = "",
  organizationName = "",
  fileName = "",
  records = [],
  actor = {}
} = {}) {
  const resolvedOrganizationId = ensureImportReady(organizationId);
  const definition = getImportTypeDefinition(CUSTOMER_IMPORT_TYPE);
  if (!Array.isArray(records) || !records.length) throw new Error("No valid records are ready to import.");
  if (records.length > MAX_IMPORT_RECORDS) {
    throw new Error(`Import batches are limited to ${MAX_IMPORT_RECORDS} records.`);
  }

  const targetCollection = collection(db, "organizations", resolvedOrganizationId, definition.collection);
  const existingSnapshot = await getDocs(query(targetCollection, limit(MAX_DUPLICATE_SCAN_RECORDS + 1)));
  if (existingSnapshot.docs.length > MAX_DUPLICATE_SCAN_RECORDS) {
    throw new Error(
      `This destination has more than ${MAX_DUPLICATE_SCAN_RECORDS} ${definition.label.toLowerCase()} records. `
      + "Use a managed migration so duplicate checks can remain complete."
    );
  }
  const existingKeys = new Set();
  existingSnapshot.docs.forEach((snapshot) => {
    existingKeys.add(duplicateKey(snapshot.data()));
  });

  const batchRef = doc(collection(db, "organizations", resolvedOrganizationId, "importBatches"));
  const importBatchId = batchRef.id;
  const createdRecords = [];
  const skippedRows = [];
  const seenKeys = new Set(existingKeys);
  const batch = writeBatch(db);
  const nowISO = new Date().toISOString();

  records.forEach((entry) => {
    const record = cleanRecord(entry.record || entry);
    const key = duplicateKey(record);
    if (!key || !key.split(":").slice(1).join(":")) {
      throw new Error(`Import row ${entry.rowNumber || "unknown"} is missing its required identity field.`);
    }
    if (seenKeys.has(key)) {
      skippedRows.push({ rowNumber: entry.rowNumber || 0, reason: "duplicate" });
      return;
    }
    seenKeys.add(key);
    const recordRef = doc(targetCollection);
    batch.set(recordRef, {
      ...record,
      organizationId: resolvedOrganizationId,
      importBatchId,
      importSource: "import_studio",
      createdAtISO: nowISO,
      updatedAtISO: nowISO,
      createdAt: serverTimestamp(),
      updatedAt: serverTimestamp()
    });
    createdRecords.push({ collection: definition.collection, id: recordRef.id });
  });

  batch.set(batchRef, {
    importBatchId,
    organizationId: resolvedOrganizationId,
    organizationName: String(organizationName || "").trim(),
    importType: CUSTOMER_IMPORT_TYPE,
    fileName: String(fileName || "").trim(),
    status: "completed",
    sourceRows: records.length,
    createdCount: createdRecords.length,
    skippedCount: skippedRows.length,
    createdRecords,
    skippedRows,
    actor: {
      uid: String(actor.uid || "").trim(),
      email: String(actor.email || "").trim().toLowerCase()
    },
    createdAtISO: nowISO,
    updatedAtISO: nowISO,
    createdAt: serverTimestamp(),
    updatedAt: serverTimestamp()
  });

  await batch.commit();
  return {
    ok: true,
    importBatchId,
    organizationId: resolvedOrganizationId,
    importType: CUSTOMER_IMPORT_TYPE,
    createdCount: createdRecords.length,
    skippedCount: skippedRows.length,
    createdRecords,
    skippedRows,
    status: "completed"
  };
}

async function rollbackCustomerImportBatch({ organizationId = "", importBatchId = "" } = {}) {
  const resolvedOrganizationId = ensureImportReady(organizationId);
  const normalizedBatchId = String(importBatchId || "").trim();
  if (!normalizedBatchId) throw new Error("Import batch id is required.");
  const batchRef = doc(db, "organizations", resolvedOrganizationId, "importBatches", normalizedBatchId);
  const batchSnapshot = await getDoc(batchRef);
  if (!batchSnapshot.exists()) throw new Error("Import receipt was not found.");
  const receipt = batchSnapshot.data() || {};
  if (receipt.organizationId !== resolvedOrganizationId) throw new Error("Import receipt organization mismatch.");
  if (receipt.importType !== CUSTOMER_IMPORT_TYPE) {
    throw new Error("Catalog imports must be rolled back through the authoritative server operation.");
  }
  if (receipt.status === "rolled_back") throw new Error("This import has already been rolled back.");

  const createdRecords = Array.isArray(receipt.createdRecords) ? receipt.createdRecords : [];
  if (createdRecords.some((record) => String(record?.collection || "").trim() !== "customers")) {
    throw new Error("Customer import receipt contains an invalid record target.");
  }
  const rollbackBatch = writeBatch(db);
  let deletedCount = 0;
  let protectedCount = 0;
  for (const record of createdRecords) {
    const recordId = String(record?.id || "").trim();
    if (!recordId) continue;
    const recordRef = doc(db, "organizations", resolvedOrganizationId, "customers", recordId);
    const recordSnapshot = await getDoc(recordRef);
    if (!recordSnapshot.exists()) continue;
    if (recordSnapshot.data()?.importBatchId !== normalizedBatchId) {
      protectedCount += 1;
      continue;
    }
    const recordData = recordSnapshot.data() || {};
    if (recordData.updatedAtISO && recordData.createdAtISO && recordData.updatedAtISO !== recordData.createdAtISO) {
      protectedCount += 1;
      continue;
    }
    rollbackBatch.delete(recordRef);
    deletedCount += 1;
  }

  const nowISO = new Date().toISOString();
  rollbackBatch.update(batchRef, {
    status: "rolled_back",
    rolledBackCount: deletedCount,
    rollbackProtectedCount: protectedCount,
    rolledBackAtISO: nowISO,
    rolledBackAt: serverTimestamp(),
    updatedAtISO: nowISO,
    updatedAt: serverTimestamp(),
    rollbackError: deleteField()
  });
  await rollbackBatch.commit();
  return {
    ok: true,
    importBatchId: normalizedBatchId,
    importType: CUSTOMER_IMPORT_TYPE,
    deletedCount,
    protectedCount,
    status: "rolled_back"
  };
}

export async function createImportBatch({
  organizationId = "",
  organizationName = "",
  importType = CUSTOMER_IMPORT_TYPE,
  fileName = "",
  records = [],
  actor = {},
  importBatchId = "",
  expectedCatalogRevision
} = {}) {
  const normalizedImportType = normalizeImportType(importType);
  if (!normalizedImportType) throw new Error("Choose a supported import record type.");
  if (normalizedImportType === CUSTOMER_IMPORT_TYPE) {
    return createCustomerImportBatch({ organizationId, organizationName, fileName, records, actor });
  }
  const resolvedOrganizationId = ensureImportReady(organizationId);
  if (!Array.isArray(records) || !records.length) throw new Error("No valid records are ready to import.");
  if (records.length > MAX_IMPORT_RECORDS) {
    throw new Error(`Import batches are limited to ${MAX_IMPORT_RECORDS} records.`);
  }
  return callCatalogImportFunction(CREATE_CATALOG_IMPORT_CALLABLE, {
    organizationId: resolvedOrganizationId,
    organizationName: String(organizationName || "").trim(),
    importType: normalizedImportType,
    fileName: String(fileName || "").trim(),
    records,
    importBatchId: String(importBatchId || "").trim() || createImportBatchId(),
    expectedCatalogRevision
  });
}

export async function rollbackImportBatch({
  organizationId = "",
  importBatchId = "",
  importType = CUSTOMER_IMPORT_TYPE,
  expectedCatalogRevision
} = {}) {
  const normalizedImportType = normalizeImportType(importType);
  if (!normalizedImportType) throw new Error("Choose a supported import record type.");
  if (normalizedImportType === CUSTOMER_IMPORT_TYPE) {
    return rollbackCustomerImportBatch({ organizationId, importBatchId });
  }
  const resolvedOrganizationId = ensureImportReady(organizationId);
  return callCatalogImportFunction(ROLLBACK_CATALOG_IMPORT_CALLABLE, {
    organizationId: resolvedOrganizationId,
    importBatchId: String(importBatchId || "").trim(),
    expectedCatalogRevision
  });
}
