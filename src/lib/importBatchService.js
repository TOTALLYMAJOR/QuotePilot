import { httpsCallable } from "firebase/functions";
import { cloudFunctions, firebaseReady } from "./firebase";
import { IMPORT_TYPES } from "./importWorkbenchModel";
import { normalizeOrganizationId } from "./organizationService";
import { sha256CanonicalValue } from "./commercialDependencyGraph";

export const MAX_IMPORT_RECORDS = 350;
export const MAX_IMPORT_SESSION_RECORDS = 1500;
const CUSTOMER_IMPORT_TYPE = "customers";
const CATALOG_IMPORT_TYPES = new Set(["packages", "addons", "rentals", "eventTypes", "menuCategories", "menuItems"]);
const CUSTOMER_IMPORT_FIXED_TRANSACTION_WRITES = 2;
const PREFLIGHT_CUSTOMER_IMPORT_CALLABLE = "preflightCustomerImportBatch";
const CREATE_CUSTOMER_IMPORT_CALLABLE = "createCustomerImportBatch";
const ROLLBACK_CUSTOMER_IMPORT_CALLABLE = "rollbackCustomerImportBatch";
const CREATE_CATALOG_IMPORT_CALLABLE = "createCatalogImportBatch";
const ROLLBACK_CATALOG_IMPORT_CALLABLE = "rollbackCatalogImportBatch";
const E2E_FUNCTION_ADAPTER_ENABLED = ["1", "true", "yes", "on"].includes(
  String(import.meta.env.VITE_E2E_BYPASS_AUTH || "").trim().toLowerCase()
);
const pendingCustomerBatchIds = new WeakMap();

function ensureImportReady(organizationId = "") {
  const resolvedOrganizationId = normalizeOrganizationId(organizationId);
  if (!resolvedOrganizationId) throw new Error("A destination organization is required.");
  if (!firebaseReady && !E2E_FUNCTION_ADAPTER_ENABLED) {
    throw new Error("Firebase is required to import records.");
  }
  return resolvedOrganizationId;
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

export function createCustomerImportBatchId(cryptoSource = globalThis.crypto) {
  const uuid = typeof cryptoSource?.randomUUID === "function"
    ? cryptoSource.randomUUID().replace(/-/g, "")
    : "";
  if (uuid) return `customer_${uuid}`;
  const bytes = new Uint8Array(16);
  if (typeof cryptoSource?.getRandomValues === "function") {
    cryptoSource.getRandomValues(bytes);
  } else {
    for (let index = 0; index < bytes.length; index += 1) {
      bytes[index] = Math.floor(Math.random() * 256);
    }
  }
  const suffix = [...bytes].map((value) => value.toString(16).padStart(2, "0")).join("");
  return `customer_${suffix}`;
}

async function callE2eAdapter(name, payload) {
  if (!E2E_FUNCTION_ADAPTER_ENABLED) return null;
  const adapter = globalThis.__quotePilotE2eFunctions;
  if (typeof adapter?.[name] !== "function") return null;
  return { handled: true, result: await adapter[name](payload) };
}

async function callImportFunction(name, payload, unavailableMessage) {
  const e2e = await callE2eAdapter(name, payload);
  if (e2e?.handled) return e2e.result;
  if (!firebaseReady || !cloudFunctions) {
    throw new Error(unavailableMessage || "Cloud Functions unavailable. Configure Firebase before importing records.");
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
  importBatchId = "",
  preflightId = "",
  preflightPlanHash = "",
  preflightRecords,
  preflightChunkIndex,
  preflightSessionId = ""
} = {}) {
  const resolvedOrganizationId = ensureImportReady(organizationId);
  if (!Array.isArray(records) || !records.length) throw new Error("No valid records are ready to import.");
  if (records.length > MAX_IMPORT_RECORDS) {
    throw new Error(`Import batches are limited to ${MAX_IMPORT_RECORDS} records.`);
  }
  if (
    !/^customer_preflight_[a-f0-9]{32}$/.test(String(preflightId || ""))
    || !String(preflightSessionId || "").trim()
    || !/^[a-f0-9]{64}$/.test(String(preflightPlanHash || ""))
    || !Array.isArray(preflightRecords)
    || !Number.isSafeInteger(preflightChunkIndex)
    || preflightChunkIndex < 0
  ) {
    throw new Error("Run server preflight again before importing these customer records.");
  }
  const suppliedBatchId = String(importBatchId || "").trim();
  const stableBatchId = suppliedBatchId
    || pendingCustomerBatchIds.get(records)
    || createCustomerImportBatchId();
  if (!suppliedBatchId) pendingCustomerBatchIds.set(records, stableBatchId);
  const result = await callImportFunction(CREATE_CUSTOMER_IMPORT_CALLABLE, {
    organizationId: resolvedOrganizationId,
    organizationName: String(organizationName || "").trim(),
    fileName: String(fileName || "").trim(),
    records,
    importBatchId: stableBatchId,
    preflightId,
    preflightPlanHash,
    preflightRecords,
    preflightChunkIndex,
    preflightSessionId
  }, "Cloud Functions unavailable. Configure Firebase before importing customer records.");
  if (!suppliedBatchId && result?.ok === true) pendingCustomerBatchIds.delete(records);
  return result;
}

function customerImportFingerprintValue({ organizationId = "", fileName = "", records = [] } = {}) {
  return {
    organizationId: normalizeOrganizationId(organizationId),
    fileName: String(fileName || "").trim(),
    records: (Array.isArray(records) ? records : []).map((entry, index) => ({
      rowNumber: Number.isSafeInteger(Number(entry?.rowNumber)) ? Number(entry.rowNumber) : index + 2,
      record: entry?.record && typeof entry.record === "object" ? entry.record : entry
    }))
  };
}

export function buildCustomerImportInputFingerprint(input = {}, options) {
  return sha256CanonicalValue(customerImportFingerprintValue(input), options);
}

function customerImportResultError(result, fallbackMessage) {
  const error = new Error(String(result?.error || result?.message || fallbackMessage).trim());
  error.name = "CustomerImportReceiptError";
  error.code = String(result?.code || "failed-precondition").trim();
  error.result = result;
  return error;
}

export function buildCustomerImportChunkPlan(records = []) {
  const chunks = [];
  let current = [];
  let emails = new Set();
  const flush = () => {
    if (current.length) chunks.push(current);
    current = [];
    emails = new Set();
  };
  (Array.isArray(records) ? records : []).forEach((entry) => {
    const email = String(entry?.record?.email || entry?.email || "").trim().toLowerCase();
    const nextEmails = new Set(emails);
    if (email) nextEmails.add(email);
    if (
      current.length
      && (
        current.length + 1 > MAX_IMPORT_RECORDS
        || current.length + 1 + nextEmails.size + CUSTOMER_IMPORT_FIXED_TRANSACTION_WRITES > 500
      )
    ) {
      flush();
    }
    current.push(entry);
    if (email) emails.add(email);
  });
  flush();
  return chunks;
}

function validateServerChunkPlan(records, chunks) {
  if (!Array.isArray(chunks) || !chunks.length) throw new Error("The server preflight did not return a safe import plan.");
  const seen = new Set();
  const resolved = chunks.map((chunk, index) => {
    const sourceIndexes = Array.isArray(chunk?.sourceIndexes) ? chunk.sourceIndexes : [];
    const childRecords = sourceIndexes.map((sourceIndex) => {
      if (!Number.isSafeInteger(sourceIndex) || sourceIndex < 0 || sourceIndex >= records.length || seen.has(sourceIndex)) {
        throw new Error("The server preflight returned an invalid customer chunk plan.");
      }
      seen.add(sourceIndex);
      return records[sourceIndex];
    });
    if (!childRecords.length || childRecords.length > MAX_IMPORT_RECORDS) throw new Error(`Customer import part ${index + 1} is outside the safe batch limit.`);
    const distinctEmails = new Set(childRecords
      .map((entry) => String(entry?.record?.email || entry?.email || "").trim().toLowerCase())
      .filter(Boolean));
    const computedMaximumWrites = childRecords.length
      + distinctEmails.size
      + CUSTOMER_IMPORT_FIXED_TRANSACTION_WRITES;
    const declaredMaximumWrites = Number(chunk?.maximumWrites ?? chunk?.projectedWriteCount);
    if (computedMaximumWrites > 500) {
      throw new Error(`Customer import part ${index + 1} exceeds the 500-write transaction budget.`);
    }
    if (Number.isFinite(declaredMaximumWrites) && declaredMaximumWrites !== computedMaximumWrites) {
      throw new Error(`Customer import part ${index + 1} does not match the server-declared write budget.`);
    }
    return childRecords;
  });
  if (seen.size !== records.length) throw new Error("The server preflight did not account for every customer row.");
  return resolved;
}

export async function preflightCustomerImport({
  organizationId = "",
  fileName = "",
  records = []
} = {}) {
  const resolvedOrganizationId = ensureImportReady(organizationId);
  if (!Array.isArray(records) || !records.length) throw new Error("No valid customer records are ready to preflight.");
  if (records.length > MAX_IMPORT_SESSION_RECORDS) {
    throw new Error(`Customer import sessions are limited to ${MAX_IMPORT_SESSION_RECORDS} ready records.`);
  }
  const result = await callImportFunction(PREFLIGHT_CUSTOMER_IMPORT_CALLABLE, {
    organizationId: resolvedOrganizationId,
    fileName: String(fileName || "").trim(),
    records
  }, "Cloud Functions unavailable. Configure Firebase before preflighting customer records.");
  if (
    result?.ok !== true
    || result?.status !== "ready"
    || result?.authority !== "server_preflight"
    || normalizeOrganizationId(result?.organizationId) !== resolvedOrganizationId
    || result?.importType !== CUSTOMER_IMPORT_TYPE
    || Number(result?.sourceCount) !== records.length
    || !/^customer_preflight_[a-f0-9]{32}$/.test(String(result?.preflightId || ""))
    || !/^[a-f0-9]{64}$/.test(String(result?.planHash || ""))
    || !Number.isFinite(Date.parse(String(result?.expiresAtISO || "")))
  ) {
    throw customerImportResultError(result, "The server did not return an accepted customer preflight receipt.");
  }
  validateServerChunkPlan(records, result?.chunks);
  return {
    ...result,
    inputFingerprint: await buildCustomerImportInputFingerprint({
      organizationId: resolvedOrganizationId,
      fileName,
      records
    })
  };
}

function childCustomerBatchId(parentBatchId, index, count) {
  return count === 1 ? parentBatchId : `${parentBatchId}_part_${String(index + 1).padStart(3, "0")}`;
}

function aggregateCustomerReceipts(parentBatchId, receipts, status = "completed") {
  return {
    ok: true,
    status,
    importType: CUSTOMER_IMPORT_TYPE,
    importBatchId: parentBatchId,
    childBatchIds: receipts.map((receipt) => receipt.importBatchId).filter(Boolean),
    childReceipts: receipts,
    createdCount: receipts.reduce((sum, receipt) => sum + Number(receipt.createdCount || 0), 0),
    skippedCount: receipts.reduce((sum, receipt) => sum + Number(receipt.skippedCount || 0), 0),
    createdRecords: receipts.flatMap((receipt) => receipt.createdRecords || []),
    skippedRows: receipts.flatMap((receipt) => receipt.skippedRows || [])
  };
}

export async function createCustomerImportSession({
  organizationId = "",
  organizationName = "",
  fileName = "",
  records = [],
  importBatchId = "",
  preflight = null
} = {}) {
  const resolvedOrganizationId = ensureImportReady(organizationId);
  if (
    preflight?.ok !== true
    || preflight?.status !== "ready"
    || preflight?.authority !== "server_preflight"
    || normalizeOrganizationId(preflight?.organizationId) !== resolvedOrganizationId
    || preflight?.importType !== CUSTOMER_IMPORT_TYPE
    || Number(preflight?.sourceCount) !== records.length
    || !/^customer_preflight_[a-f0-9]{32}$/.test(String(preflight?.preflightId || ""))
    || !/^[a-f0-9]{64}$/.test(String(preflight?.planHash || ""))
    || !Number.isFinite(Date.parse(String(preflight?.expiresAtISO || "")))
    || !/^[a-f0-9]{64}$/.test(String(preflight?.inputFingerprint || ""))
  ) {
    throw new Error("Run server preflight again before importing these customer records.");
  }
  const currentInputFingerprint = await buildCustomerImportInputFingerprint({
    organizationId: resolvedOrganizationId,
    fileName,
    records
  });
  if (currentInputFingerprint !== preflight.inputFingerprint) {
    throw new Error("The customer rows or source file changed after preflight. Run server preflight again.");
  }
  const parentBatchId = String(importBatchId || "").trim() || createCustomerImportBatchId();
  const chunks = validateServerChunkPlan(records, preflight?.chunks);
  const receipts = [];
  for (let index = 0; index < chunks.length; index += 1) {
    const childBatchId = childCustomerBatchId(parentBatchId, index, chunks.length);
    try {
      const receipt = await createCustomerImportBatch({
        organizationId: resolvedOrganizationId,
        organizationName,
        fileName,
        records: chunks[index],
        importBatchId: childBatchId,
        preflightId: preflight.preflightId,
        preflightPlanHash: preflight.planHash,
        preflightRecords: records,
        preflightChunkIndex: index,
        preflightSessionId: parentBatchId
      });
      if (
        receipt?.ok !== true
        || receipt?.status !== "completed"
        || receipt?.importBatchId !== childBatchId
        || normalizeOrganizationId(receipt?.organizationId) !== resolvedOrganizationId
        || receipt?.importType !== CUSTOMER_IMPORT_TYPE
        || receipt?.preflightId !== preflight.preflightId
        || receipt?.preflightPlanHash !== preflight.planHash
        || Number(receipt?.preflightChunkIndex) !== index
        || receipt?.preflightSessionId !== parentBatchId
      ) {
        throw customerImportResultError(
          receipt,
          `Customer import part ${index + 1} did not return an accepted server receipt.`
        );
      }
      receipts.push(receipt);
    } catch (error) {
      const wrapped = new Error(error?.message || `Customer import part ${index + 1} did not return a receipt.`);
      wrapped.name = "CustomerImportSessionError";
      wrapped.code = error?.code;
      wrapped.cause = error;
      wrapped.partialResult = aggregateCustomerReceipts(parentBatchId, receipts, "partial");
      wrapped.failedPart = index + 1;
      throw wrapped;
    }
  }
  return aggregateCustomerReceipts(parentBatchId, receipts);
}

async function rollbackCustomerImportBatch({ organizationId = "", importBatchId = "" } = {}) {
  const resolvedOrganizationId = ensureImportReady(organizationId);
  const normalizedBatchId = String(importBatchId || "").trim();
  if (!normalizedBatchId) throw new Error("Import batch id is required.");
  return callImportFunction(ROLLBACK_CUSTOMER_IMPORT_CALLABLE, {
    organizationId: resolvedOrganizationId,
    importBatchId: normalizedBatchId
  }, "Cloud Functions unavailable. Configure Firebase before rolling back customer imports.");
}

function validateCustomerRollbackReceipt(receipt, {
  organizationId,
  importBatchId
} = {}) {
  if (
    receipt?.ok !== true
    || receipt?.status !== "rolled_back"
    || receipt?.importType !== CUSTOMER_IMPORT_TYPE
    || normalizeOrganizationId(receipt?.organizationId) !== organizationId
    || receipt?.importBatchId !== importBatchId
  ) {
    throw customerImportResultError(
      receipt,
      `Customer import undo for ${importBatchId} did not return an accepted server receipt.`
    );
  }
  for (const field of ["deletedCount", "protectedCount", "missingCount"]) {
    if (!Number.isSafeInteger(Number(receipt[field])) || Number(receipt[field]) < 0) {
      throw customerImportResultError(
        receipt,
        `Customer import undo for ${importBatchId} returned an invalid ${field}.`
      );
    }
  }
  if (!Array.isArray(receipt.protectedRecords)) {
    throw customerImportResultError(
      receipt,
      `Customer import undo for ${importBatchId} returned invalid protected-record evidence.`
    );
  }
  return receipt;
}

function aggregateCustomerRollbackReceipts(parentBatchId, childBatchIds, receipts, status = "rolled_back") {
  return {
    ok: status === "rolled_back",
    status,
    importType: CUSTOMER_IMPORT_TYPE,
    importBatchId: parentBatchId,
    childBatchIds,
    childReceipts: receipts,
    deletedCount: receipts.reduce((sum, receipt) => sum + Number(receipt.deletedCount), 0),
    protectedCount: receipts.reduce((sum, receipt) => sum + Number(receipt.protectedCount), 0),
    missingCount: receipts.reduce((sum, receipt) => sum + Number(receipt.missingCount), 0),
    protectedRecords: receipts.flatMap((receipt) => receipt.protectedRecords)
  };
}

async function rollbackCustomerImportSession({ organizationId = "", importBatchId = "", childBatchIds = [] } = {}) {
  const resolvedOrganizationId = ensureImportReady(organizationId);
  const ids = (Array.isArray(childBatchIds) && childBatchIds.length ? childBatchIds : [importBatchId])
    .map((value) => String(value || "").trim());
  if (ids.some((value) => !value) || new Set(ids).size !== ids.length) {
    throw new Error("Customer import undo requires distinct, non-empty child batch identities.");
  }
  const receipts = [];
  for (const childBatchId of [...ids].reverse()) {
    try {
      const receipt = await rollbackCustomerImportBatch({
        organizationId: resolvedOrganizationId,
        importBatchId: childBatchId
      });
      receipts.push(validateCustomerRollbackReceipt(receipt, {
        organizationId: resolvedOrganizationId,
        importBatchId: childBatchId
      }));
    } catch (error) {
      const wrapped = new Error(error?.message || "A customer import undo part did not return a receipt.");
      wrapped.name = "CustomerImportSessionError";
      wrapped.code = error?.code;
      wrapped.cause = error;
      wrapped.failedBatchId = childBatchId;
      wrapped.partialResult = aggregateCustomerRollbackReceipts(
        importBatchId,
        ids,
        receipts,
        "partial"
      );
      throw wrapped;
    }
  }
  return aggregateCustomerRollbackReceipts(importBatchId, ids, receipts);
}

export async function createImportBatch({
  organizationId = "",
  organizationName = "",
  importType = CUSTOMER_IMPORT_TYPE,
  fileName = "",
  records = [],
  importBatchId = "",
  preflight = null,
  expectedCatalogRevision
} = {}) {
  const normalizedImportType = normalizeImportType(importType);
  if (!normalizedImportType) throw new Error("Choose a supported import record type.");
  if (normalizedImportType === CUSTOMER_IMPORT_TYPE) {
    const resolvedOrganizationId = ensureImportReady(organizationId);
    if (!Array.isArray(records) || !records.length) {
      throw new Error("No valid records are ready to import.");
    }
    const suppliedBatchId = String(importBatchId || "").trim();
    const stableBatchId = suppliedBatchId
      || pendingCustomerBatchIds.get(records)
      || createCustomerImportBatchId();
    if (!suppliedBatchId) pendingCustomerBatchIds.set(records, stableBatchId);
    const acceptedPreflight = preflight || await preflightCustomerImport({
      organizationId: resolvedOrganizationId,
      fileName,
      records
    });
    const result = await createCustomerImportSession({
      organizationId: resolvedOrganizationId,
      organizationName,
      fileName,
      records,
      importBatchId: stableBatchId,
      preflight: acceptedPreflight
    });
    if (!suppliedBatchId && result?.ok === true) pendingCustomerBatchIds.delete(records);
    return result;
  }
  const resolvedOrganizationId = ensureImportReady(organizationId);
  if (!Array.isArray(records) || !records.length) throw new Error("No valid records are ready to import.");
  if (records.length > MAX_IMPORT_RECORDS) {
    throw new Error(`Import batches are limited to ${MAX_IMPORT_RECORDS} records.`);
  }
  return callImportFunction(CREATE_CATALOG_IMPORT_CALLABLE, {
    organizationId: resolvedOrganizationId,
    organizationName: String(organizationName || "").trim(),
    importType: normalizedImportType,
    fileName: String(fileName || "").trim(),
    records,
    importBatchId: String(importBatchId || "").trim() || createImportBatchId(),
    expectedCatalogRevision
  }, "Cloud Functions unavailable. Configure Firebase before importing catalog records.");
}

export async function rollbackImportBatch({
  organizationId = "",
  importBatchId = "",
  childBatchIds = [],
  importType = CUSTOMER_IMPORT_TYPE,
  expectedCatalogRevision
} = {}) {
  const normalizedImportType = normalizeImportType(importType);
  if (!normalizedImportType) throw new Error("Choose a supported import record type.");
  if (normalizedImportType === CUSTOMER_IMPORT_TYPE) {
    return rollbackCustomerImportSession({ organizationId, importBatchId, childBatchIds });
  }
  const resolvedOrganizationId = ensureImportReady(organizationId);
  return callImportFunction(ROLLBACK_CATALOG_IMPORT_CALLABLE, {
    organizationId: resolvedOrganizationId,
    importBatchId: String(importBatchId || "").trim(),
    expectedCatalogRevision
  }, "Cloud Functions unavailable. Configure Firebase before rolling back catalog imports.");
}
