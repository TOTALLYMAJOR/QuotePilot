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
import { db, firebaseReady } from "./firebase";
import { getImportTypeDefinition, IMPORT_TYPES } from "./importStudio";
import { normalizeOrganizationId } from "./organizationService";

export const MAX_IMPORT_RECORDS = 350;
const MAX_DUPLICATE_SCAN_RECORDS = 2000;

function ensureImportReady(organizationId = "") {
  const resolvedOrganizationId = normalizeOrganizationId(organizationId);
  if (!firebaseReady || !db) throw new Error("Firebase is required to import records.");
  if (!resolvedOrganizationId) throw new Error("A destination organization is required.");
  return resolvedOrganizationId;
}

function normalizedKey(value = "") {
  return String(value || "").trim().toLowerCase().replace(/\s+/g, " ");
}

function duplicateKey(record = {}, importType = "customers") {
  if (importType === "customers") {
    return record.email ? `email:${normalizedKey(record.email)}` : `name:${normalizedKey(record.name)}`;
  }
  return `name:${normalizedKey(record.name)}`;
}

function cleanRecord(record = {}) {
  return Object.fromEntries(
    Object.entries(record).filter(([, value]) => value !== null && value !== undefined && value !== "")
  );
}

export async function createImportBatch({
  organizationId = "",
  organizationName = "",
  importType = "customers",
  fileName = "",
  records = [],
  actor = {}
} = {}) {
  const resolvedOrganizationId = ensureImportReady(organizationId);
  if (!IMPORT_TYPES.some((type) => type.id === importType)) {
    throw new Error("Choose a supported import record type.");
  }
  const definition = getImportTypeDefinition(importType);
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
    existingKeys.add(duplicateKey(snapshot.data(), importType));
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
    const key = duplicateKey(record, importType);
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
    importType,
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
    importType,
    createdCount: createdRecords.length,
    skippedCount: skippedRows.length,
    createdRecords,
    skippedRows,
    status: "completed"
  };
}

export async function rollbackImportBatch({ organizationId = "", importBatchId = "" } = {}) {
  const resolvedOrganizationId = ensureImportReady(organizationId);
  const normalizedBatchId = String(importBatchId || "").trim();
  if (!normalizedBatchId) throw new Error("Import batch id is required.");
  const batchRef = doc(db, "organizations", resolvedOrganizationId, "importBatches", normalizedBatchId);
  const batchSnapshot = await getDoc(batchRef);
  if (!batchSnapshot.exists()) throw new Error("Import receipt was not found.");
  const receipt = batchSnapshot.data() || {};
  if (receipt.organizationId !== resolvedOrganizationId) throw new Error("Import receipt organization mismatch.");
  if (receipt.status === "rolled_back") throw new Error("This import has already been rolled back.");

  const createdRecords = Array.isArray(receipt.createdRecords) ? receipt.createdRecords : [];
  const rollbackBatch = writeBatch(db);
  let deletedCount = 0;
  let protectedCount = 0;
  for (const record of createdRecords) {
    const collectionName = String(record?.collection || "").trim();
    const recordId = String(record?.id || "").trim();
    if (!collectionName || !recordId) continue;
    const recordRef = doc(db, "organizations", resolvedOrganizationId, collectionName, recordId);
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

  rollbackBatch.update(batchRef, {
    status: "rolled_back",
    rolledBackCount: deletedCount,
    rollbackProtectedCount: protectedCount,
    rolledBackAtISO: new Date().toISOString(),
    rolledBackAt: serverTimestamp(),
    updatedAtISO: new Date().toISOString(),
    updatedAt: serverTimestamp(),
    rollbackError: deleteField()
  });
  await rollbackBatch.commit();
  return { ok: true, importBatchId: normalizedBatchId, deletedCount, protectedCount, status: "rolled_back" };
}
