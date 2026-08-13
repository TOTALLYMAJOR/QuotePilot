import { collection, doc, getDoc } from "firebase/firestore";
import { httpsCallable } from "firebase/functions";
import {
  appCheckInitialization,
  appCheckReady,
  cloudFunctions,
  db,
  firebaseReady
} from "./firebase";

export const ORGANIZATIONS_COLLECTION = "organizations";
export const DEFAULT_ORGANIZATION_ID = String(import.meta.env.VITE_DEFAULT_ORGANIZATION_ID || "").trim();

let activeOrganizationId = "";
const PREFLIGHT_CUSTOMER_ORDER_CALLABLE = "preflightCustomerOrder";
const PROVISION_CUSTOMER_ORDER_CALLABLE = "provisionCustomerOrder";
const REPAIR_CUSTOMER_PROVISIONING_CALLABLE = "repairCustomerProvisioningOrder";
const SYNC_USER_CLAIMS_CALLABLE = "syncUserClaimsFromRole";
const ARCHIVE_ORGANIZATION_CALLABLE = "archiveOrganizationWorkspace";
const DELETE_ORGANIZATION_CALLABLE = "deleteOrganizationWorkspace";
const GET_ORGANIZATION_ROLE_ROSTER_CALLABLE = "getOrganizationRoleRoster";
const MUTATE_ORGANIZATION_ROLE_CALLABLE = "mutateOrganizationRole";
const E2E_FUNCTION_ADAPTER_ENABLED = ["1", "true", "yes", "on"].includes(
  String(import.meta.env.VITE_E2E_BYPASS_AUTH || "").trim().toLowerCase()
);

async function ensureRoleAuthorityAppCheck() {
  if (!appCheckReady) return;
  const initialized = await appCheckInitialization;
  if (!initialized) {
    throw new Error("App verification could not start. Refresh and try again.");
  }
}

async function callE2eFunctionAdapter(name, payload) {
  if (!E2E_FUNCTION_ADAPTER_ENABLED) return null;
  const adapter = globalThis.__quotePilotE2eFunctions;
  if (typeof adapter?.[name] !== "function") return null;
  return {
    handled: true,
    result: await adapter[name](payload)
  };
}

export function normalizeOrganizationId(value, fallback = "") {
  const raw = String(value || "").trim();
  if (!raw) return String(fallback || "").trim();
  return raw
    .toLowerCase()
    .replace(/[^\w-]+/g, "-")
    .replace(/-{2,}/g, "-")
    .replace(/^-|-$/g, "");
}

export function resolveOrganizationId(value = "", fallback = DEFAULT_ORGANIZATION_ID) {
  const normalized = normalizeOrganizationId(value);
  if (normalized) return normalized;
  return normalizeOrganizationId(fallback);
}

function normalizeText(value, fallback = "") {
  const text = String(value || "").trim();
  return text || fallback;
}

export function buildOrganizationProfile({
  organizationId = "",
  name = "",
  slug = "",
  ownerUid = "",
  ownerEmail = ""
} = {}) {
  const resolvedOrganizationId = resolveOrganizationId(organizationId, "");
  const resolvedName = normalizeText(name, "Organization");
  return {
    id: resolvedOrganizationId,
    name: resolvedName,
    slug: normalizeOrganizationId(slug || resolvedName || resolvedOrganizationId),
    ownerUid: normalizeText(ownerUid),
    ownerEmail: normalizeText(ownerEmail).toLowerCase(),
    updatedAtISO: new Date().toISOString()
  };
}

export async function loadOrganizationProfile(organizationId = "") {
  if (!firebaseReady || !db) {
    return null;
  }
  const resolvedOrganizationId = resolveOrganizationId(organizationId, "");
  if (!resolvedOrganizationId) {
    return null;
  }
  const snapshot = await getDoc(doc(db, ORGANIZATIONS_COLLECTION, resolvedOrganizationId));
  if (!snapshot.exists()) {
    return null;
  }
  return {
    id: snapshot.id,
    ...snapshot.data()
  };
}

export function setActiveOrganizationId(orgId = "") {
  activeOrganizationId = normalizeOrganizationId(orgId);
}

export function getActiveOrganizationId() {
  return activeOrganizationId;
}

export function getOrganizationDocRef(orgId = "") {
  if (!firebaseReady || !db) {
    throw new Error("Firebase is not configured.");
  }
  const resolvedOrgId = resolveOrganizationId(orgId);
  if (!resolvedOrgId) {
    throw new Error("organizationId is required.");
  }
  return doc(db, ORGANIZATIONS_COLLECTION, resolvedOrgId);
}

export function getOrganizationCollectionRef(collectionName, orgId = "") {
  if (!firebaseReady || !db) {
    throw new Error("Firebase is not configured.");
  }
  const resolvedOrgId = resolveOrganizationId(orgId);
  if (!resolvedOrgId) {
    throw new Error("organizationId is required.");
  }
  const collectionId = String(collectionName || "").trim();
  if (!collectionId) {
    throw new Error("collectionName is required.");
  }
  return collection(db, ORGANIZATIONS_COLLECTION, resolvedOrgId, collectionId);
}

export function getOrganizationSubDocRef(collectionName, docId, orgId = "") {
  if (!firebaseReady || !db) {
    throw new Error("Firebase is not configured.");
  }
  const resolvedOrgId = resolveOrganizationId(orgId);
  if (!resolvedOrgId) {
    throw new Error("organizationId is required.");
  }
  const collectionId = String(collectionName || "").trim();
  const entryId = String(docId || "").trim();
  if (!collectionId) {
    throw new Error("collectionName is required.");
  }
  if (!entryId) {
    throw new Error("docId is required.");
  }
  return doc(db, ORGANIZATIONS_COLLECTION, resolvedOrgId, collectionId, entryId);
}

export async function provisionCustomerOrder(payload = {}) {
  const e2e = await callE2eFunctionAdapter("provisionCustomerOrder", payload);
  if (e2e?.handled) return e2e.result;
  if (!cloudFunctions) {
    throw new Error("Cloud Functions are not configured.");
  }
  const call = httpsCallable(cloudFunctions, PROVISION_CUSTOMER_ORDER_CALLABLE);
  const result = await call(payload);
  return result?.data || { ok: false };
}

export async function preflightCustomerOrder(payload = {}) {
  const e2e = await callE2eFunctionAdapter("preflightCustomerOrder", payload);
  if (e2e?.handled) return e2e.result;
  if (!cloudFunctions) {
    throw new Error("Cloud Functions are not configured.");
  }
  const call = httpsCallable(cloudFunctions, PREFLIGHT_CUSTOMER_ORDER_CALLABLE);
  const result = await call(payload);
  return result?.data || { ok: false, preflight: false, exists: false };
}

export async function repairCustomerProvisioningOrder(payload = {}) {
  const e2e = await callE2eFunctionAdapter("repairCustomerProvisioningOrder", payload);
  if (e2e?.handled) return e2e.result;
  if (!cloudFunctions) {
    throw new Error("Cloud Functions are not configured.");
  }
  const call = httpsCallable(cloudFunctions, REPAIR_CUSTOMER_PROVISIONING_CALLABLE);
  const result = await call(payload);
  return result?.data || { ok: false };
}

export async function syncUserClaimsFromRole(payload = {}) {
  const e2e = await callE2eFunctionAdapter("syncUserClaimsFromRole", payload);
  if (e2e?.handled) return e2e.result;
  if (!cloudFunctions) {
    throw new Error("Cloud Functions are not configured.");
  }
  const call = httpsCallable(cloudFunctions, SYNC_USER_CLAIMS_CALLABLE);
  const result = await call(payload);
  return result?.data || { ok: false };
}

export async function archiveOrganizationWorkspace(payload = {}) {
  if (!cloudFunctions) {
    throw new Error("Cloud Functions are not configured.");
  }
  const call = httpsCallable(cloudFunctions, ARCHIVE_ORGANIZATION_CALLABLE);
  const result = await call(payload);
  return result?.data || { ok: false };
}

export async function deleteOrganizationWorkspace(payload = {}) {
  if (!cloudFunctions) {
    throw new Error("Cloud Functions are not configured.");
  }
  const call = httpsCallable(cloudFunctions, DELETE_ORGANIZATION_CALLABLE);
  const result = await call(payload);
  return result?.data || { ok: false };
}

export async function getOrganizationRoleRoster() {
  const e2e = await callE2eFunctionAdapter("getOrganizationRoleRoster", {});
  if (e2e?.handled) return e2e.result;
  if (!cloudFunctions) {
    throw new Error("Cloud Functions are not configured.");
  }
  await ensureRoleAuthorityAppCheck();
  const call = httpsCallable(cloudFunctions, GET_ORGANIZATION_ROLE_ROSTER_CALLABLE);
  const result = await call({});
  return result?.data || { ok: false, roles: [] };
}

export async function mutateOrganizationRole(payload = {}) {
  const e2e = await callE2eFunctionAdapter("mutateOrganizationRole", payload);
  if (e2e?.handled) return e2e.result;
  if (!cloudFunctions) {
    throw new Error("Cloud Functions are not configured.");
  }
  await ensureRoleAuthorityAppCheck();
  const call = httpsCallable(
    cloudFunctions,
    MUTATE_ORGANIZATION_ROLE_CALLABLE,
    appCheckReady ? { limitedUseAppCheckTokens: true } : {}
  );
  const result = await call(payload);
  return result?.data || { ok: false };
}
