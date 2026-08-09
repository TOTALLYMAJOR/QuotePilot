import { httpsCallable } from "firebase/functions";
import { cloudFunctions, firebaseReady } from "./firebase";
import { IMPORT_TYPES } from "./importStudio";
import { normalizeOrganizationId } from "./organizationService";

export const MAX_IMPORT_RECORDS = 350;
const CUSTOMER_IMPORT_TYPE = "customers";
const CATALOG_IMPORT_TYPES = new Set(["packages", "addons", "rentals", "menuItems"]);
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
  importBatchId = ""
} = {}) {
  const resolvedOrganizationId = ensureImportReady(organizationId);
  if (!Array.isArray(records) || !records.length) throw new Error("No valid records are ready to import.");
  if (records.length > MAX_IMPORT_RECORDS) {
    throw new Error(`Import batches are limited to ${MAX_IMPORT_RECORDS} records.`);
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
    importBatchId: stableBatchId
  }, "Cloud Functions unavailable. Configure Firebase before importing customer records.");
  if (!suppliedBatchId && result?.ok === true) pendingCustomerBatchIds.delete(records);
  return result;
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

export async function createImportBatch({
  organizationId = "",
  organizationName = "",
  importType = CUSTOMER_IMPORT_TYPE,
  fileName = "",
  records = [],
  importBatchId = "",
  expectedCatalogRevision
} = {}) {
  const normalizedImportType = normalizeImportType(importType);
  if (!normalizedImportType) throw new Error("Choose a supported import record type.");
  if (normalizedImportType === CUSTOMER_IMPORT_TYPE) {
    return createCustomerImportBatch({
      organizationId,
      organizationName,
      fileName,
      records,
      importBatchId
    });
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
  importType = CUSTOMER_IMPORT_TYPE,
  expectedCatalogRevision
} = {}) {
  const normalizedImportType = normalizeImportType(importType);
  if (!normalizedImportType) throw new Error("Choose a supported import record type.");
  if (normalizedImportType === CUSTOMER_IMPORT_TYPE) {
    return rollbackCustomerImportBatch({ organizationId, importBatchId });
  }
  const resolvedOrganizationId = ensureImportReady(organizationId);
  return callImportFunction(ROLLBACK_CATALOG_IMPORT_CALLABLE, {
    organizationId: resolvedOrganizationId,
    importBatchId: String(importBatchId || "").trim(),
    expectedCatalogRevision
  }, "Cloud Functions unavailable. Configure Firebase before rolling back catalog imports.");
}
