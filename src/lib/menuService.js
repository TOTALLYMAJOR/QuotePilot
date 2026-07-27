import {
  addDoc,
  deleteDoc,
  doc,
  getDocs,
  query,
  updateDoc,
  writeBatch,
  where
} from "firebase/firestore";
import { db, firebaseReady } from "./firebase";
import {
  getActiveOrganizationId,
  getOrganizationCollectionRef,
  getOrganizationSubDocRef,
  normalizeOrganizationId
} from "./organizationService";
import { DEFAULT_SETTINGS } from "../data/mockCatalog";
import { buildCanonicalMenuForEventType } from "../data/canonicalMenuTemplate";

const LOCAL_EVENT_TYPES = (() => {
  const templates = Array.isArray(DEFAULT_SETTINGS?.eventTemplates)
    ? DEFAULT_SETTINGS.eventTemplates
    : [];
  const seen = new Set();
  const items = [];
  templates.forEach((template) => {
    const id = asText(template?.id);
    if (!id || seen.has(id)) return;
    seen.add(id);
    items.push({
      id,
      name: asText(template?.name, id)
    });
  });
  return sortByName(items);
})();

function ensureReady() {
  if (!firebaseReady || !db) {
    throw new Error("Firebase is not configured.");
  }
}

function asText(value, fallback = "") {
  const text = String(value ?? "").trim();
  return text || fallback;
}

function asNumber(value, fallback = 0) {
  const n = Number(value);
  return Number.isFinite(n) ? n : fallback;
}

function normalizePriceType(value) {
  if (value === "per_person" || value === "per_item" || value === "per_event") {
    return value;
  }
  return "per_event";
}

function normalizeActive(value, fallback = true) {
  if (typeof value === "boolean") return value;
  return fallback;
}

function mapDocs(snapshot) {
  return snapshot.docs.map((docSnap) => ({
    id: docSnap.id,
    ...docSnap.data()
  }));
}

function sortByName(items) {
  return [...items].sort((a, b) => asText(a?.name).localeCompare(asText(b?.name)));
}

function resolveScopedOrganizationId(organizationId = "") {
  return normalizeOrganizationId(organizationId || getActiveOrganizationId());
}

function orgCollectionRef(collectionName, organizationId) {
  return getOrganizationCollectionRef(collectionName, organizationId);
}

function orgDocRef(collectionName, docId, organizationId) {
  return getOrganizationSubDocRef(collectionName, docId, organizationId);
}

function resolveWritableCollectionRef(collectionName, organizationId = "", action = "menu operation") {
  const resolvedOrgId = resolveScopedOrganizationId(organizationId);
  if (resolvedOrgId) {
    return orgCollectionRef(collectionName, resolvedOrgId);
  }
  throw new Error(`organizationId is required for ${action}.`);
}

function resolveWritableDocRef(collectionName, docId, organizationId = "", action = "menu operation") {
  const entryId = asText(docId);
  if (!entryId) {
    throw new Error("docId is required.");
  }
  const resolvedOrgId = resolveScopedOrganizationId(organizationId);
  if (resolvedOrgId) {
    return orgDocRef(collectionName, entryId, resolvedOrgId);
  }
  throw new Error(`organizationId is required for ${action}.`);
}

export async function getEventTypes({ organizationId = "" } = {}) {
  if (!firebaseReady || !db) return [...LOCAL_EVENT_TYPES];
  const resolvedOrgId = resolveScopedOrganizationId(organizationId);
  const mapEventType = (item) => ({
    ...item,
    name: asText(item.name, "Untitled Event Type")
  });

  if (!resolvedOrgId) {
    throw new Error("organizationId is required for getEventTypes.");
  }

  const scopedSnap = await getDocs(query(orgCollectionRef("eventTypes", resolvedOrgId)));
  return sortByName(mapDocs(scopedSnap).map(mapEventType));
}

export async function getMenuCategories(eventTypeId, { organizationId = "" } = {}) {
  const nextEventTypeId = asText(eventTypeId);
  if (!nextEventTypeId || !firebaseReady || !db) return [];
  const resolvedOrgId = resolveScopedOrganizationId(organizationId);
  const mapCategory = (item) => ({
    ...item,
    eventTypeId: asText(item.eventTypeId),
    name: asText(item.name, "Untitled Category")
  });

  if (!resolvedOrgId) {
    throw new Error("organizationId is required for getMenuCategories.");
  }

  const scopedSnap = await getDocs(
    query(orgCollectionRef("menuCategories", resolvedOrgId), where("eventTypeId", "==", nextEventTypeId))
  );
  return sortByName(mapDocs(scopedSnap).map(mapCategory));
}

export async function getMenuItems(eventTypeId, { includeInactive = false, organizationId = "" } = {}) {
  const nextEventTypeId = asText(eventTypeId);
  if (!nextEventTypeId || !firebaseReady || !db) return [];
  const resolvedOrgId = resolveScopedOrganizationId(organizationId);

  const mapItem = (item) => {
    const pricingType = normalizePriceType(item.pricingType || item.type);
    return {
      ...item,
      eventTypeId: asText(item.eventTypeId),
      categoryId: asText(item.categoryId),
      name: asText(item.name, "Untitled Item"),
      price: asNumber(item.price, 0),
      pricingType,
      type: pricingType,
      active: normalizeActive(item.active, true)
    };
  };

  if (!resolvedOrgId) {
    throw new Error("organizationId is required for getMenuItems.");
  }

  const scopedSnap = await getDocs(
    query(orgCollectionRef("menuItems", resolvedOrgId), where("eventTypeId", "==", nextEventTypeId))
  );
  const scopedMapped = mapDocs(scopedSnap).map(mapItem);
  return sortByName(includeInactive ? scopedMapped : scopedMapped.filter((item) => item.active !== false));
}

export async function createMenuItem(data = {}) {
  ensureReady();
  const targetCollectionRef = resolveWritableCollectionRef("menuItems", data.organizationId, "createMenuItem");
  const pricingType = normalizePriceType(data.pricingType || data.type);
  const payload = {
    eventTypeId: asText(data.eventTypeId),
    categoryId: asText(data.categoryId),
    name: asText(data.name, "New Menu Item"),
    price: asNumber(data.price, 0),
    pricingType,
    type: pricingType,
    active: normalizeActive(data.active, true),
    createdAtISO: new Date().toISOString()
  };
  if (!payload.eventTypeId) {
    throw new Error("eventTypeId is required.");
  }
  if (!payload.categoryId) {
    throw new Error("categoryId is required.");
  }
  const ref = await addDoc(targetCollectionRef, payload);
  return {
    id: ref.id,
    ...payload
  };
}

export async function updateMenuItem(id, data = {}) {
  ensureReady();
  const itemId = asText(id);
  if (!itemId) {
    throw new Error("Menu item id is required.");
  }

  const payload = {};
  if (Object.prototype.hasOwnProperty.call(data, "name")) {
    payload.name = asText(data.name, "New Menu Item");
  }
  if (Object.prototype.hasOwnProperty.call(data, "price")) {
    payload.price = asNumber(data.price, 0);
  }
  if (Object.prototype.hasOwnProperty.call(data, "categoryId")) {
    payload.categoryId = asText(data.categoryId);
  }
  if (Object.prototype.hasOwnProperty.call(data, "eventTypeId")) {
    payload.eventTypeId = asText(data.eventTypeId);
  }
  if (Object.prototype.hasOwnProperty.call(data, "type")) {
    const pricingType = normalizePriceType(data.type);
    payload.pricingType = pricingType;
    payload.type = pricingType;
  }
  if (Object.prototype.hasOwnProperty.call(data, "pricingType")) {
    const pricingType = normalizePriceType(data.pricingType);
    payload.pricingType = pricingType;
    payload.type = pricingType;
  }
  if (Object.prototype.hasOwnProperty.call(data, "active")) {
    payload.active = normalizeActive(data.active, true);
  }
  payload.updatedAtISO = new Date().toISOString();

  await updateDoc(resolveWritableDocRef("menuItems", itemId, data.organizationId, "updateMenuItem"), payload);
  return {
    id: itemId,
    ...payload
  };
}

export async function deleteMenuItem(id, { organizationId = "" } = {}) {
  ensureReady();
  const itemId = asText(id);
  if (!itemId) {
    throw new Error("Menu item id is required.");
  }
  await deleteDoc(resolveWritableDocRef("menuItems", itemId, organizationId, "deleteMenuItem"));
  return { ok: true, id: itemId };
}

export async function createCategory(data = {}) {
  ensureReady();
  const targetCollectionRef = resolveWritableCollectionRef("menuCategories", data.organizationId, "createCategory");
  const payload = {
    eventTypeId: asText(data.eventTypeId),
    name: asText(data.name, "New Category"),
    createdAtISO: new Date().toISOString()
  };
  if (!payload.eventTypeId) {
    throw new Error("eventTypeId is required.");
  }
  const ref = await addDoc(targetCollectionRef, payload);
  return {
    id: ref.id,
    ...payload
  };
}

export async function updateCategory(id, data = {}) {
  ensureReady();
  const categoryId = asText(id);
  if (!categoryId) {
    throw new Error("Category id is required.");
  }

  const payload = {};
  if (Object.prototype.hasOwnProperty.call(data, "name")) {
    payload.name = asText(data.name, "New Category");
  }
  if (Object.prototype.hasOwnProperty.call(data, "eventTypeId")) {
    payload.eventTypeId = asText(data.eventTypeId);
  }
  payload.updatedAtISO = new Date().toISOString();

  await updateDoc(resolveWritableDocRef("menuCategories", categoryId, data.organizationId, "updateCategory"), payload);
  return {
    id: categoryId,
    ...payload
  };
}

export async function createEventType(data = {}) {
  ensureReady();
  const targetCollectionRef = resolveWritableCollectionRef("eventTypes", data.organizationId, "createEventType");
  const categoryCollectionRef = resolveWritableCollectionRef("menuCategories", data.organizationId, "createEventType");
  const itemCollectionRef = resolveWritableCollectionRef("menuItems", data.organizationId, "createEventType");

  const createdAtISO = new Date().toISOString();
  const eventTypeRef = doc(targetCollectionRef);
  const eventTypeId = eventTypeRef.id;
  const seedCanonical = data.seedCanonical === true;
  const canonicalSeed = seedCanonical
    ? buildCanonicalMenuForEventType(eventTypeId)
    : { categories: [], items: [] };
  const payload = {
    name: asText(data.name, "New Event Type"),
    createdAtISO
  };

  const batch = writeBatch(db);
  batch.set(eventTypeRef, payload);
  canonicalSeed.categories.forEach((entry) => {
    batch.set(doc(categoryCollectionRef, entry.id), {
      ...entry,
      source: "canonical-menu-seed",
      createdAtISO
    });
  });
  canonicalSeed.items.forEach((entry) => {
    batch.set(doc(itemCollectionRef, entry.id), {
      ...entry,
      source: "canonical-menu-seed",
      createdAtISO
    });
  });

  await batch.commit();

  return {
    id: eventTypeId,
    ...payload,
    seeded: {
      categories: canonicalSeed.categories.length,
      items: canonicalSeed.items.length
    }
  };
}

export async function updateEventType(id, data = {}) {
  ensureReady();
  const eventTypeId = asText(id);
  if (!eventTypeId) {
    throw new Error("Event type id is required.");
  }

  const payload = {};
  if (Object.prototype.hasOwnProperty.call(data, "name")) {
    payload.name = asText(data.name, "New Event Type");
  }
  payload.updatedAtISO = new Date().toISOString();

  await updateDoc(resolveWritableDocRef("eventTypes", eventTypeId, data.organizationId, "updateEventType"), payload);
  return {
    id: eventTypeId,
    ...payload
  };
}
