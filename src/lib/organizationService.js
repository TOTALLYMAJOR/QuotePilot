import { collection, doc, getDoc } from "firebase/firestore";
import { httpsCallable } from "firebase/functions";
import { cloudFunctions, db, firebaseReady } from "./firebase";

export const ORGANIZATIONS_COLLECTION = "organizations";
export const DEFAULT_ORGANIZATION_ID = String(import.meta.env.VITE_DEFAULT_ORGANIZATION_ID || "default-org").trim();

let activeOrganizationId = "";
const PROVISION_CUSTOMER_ORDER_CALLABLE = "provisionCustomerOrder";
const ARCHIVE_ORGANIZATION_CALLABLE = "archiveOrganizationWorkspace";
const DELETE_ORGANIZATION_CALLABLE = "deleteOrganizationWorkspace";

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
  if (!cloudFunctions) {
    throw new Error("Cloud Functions are not configured.");
  }
  const call = httpsCallable(cloudFunctions, PROVISION_CUSTOMER_ORDER_CALLABLE);
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
