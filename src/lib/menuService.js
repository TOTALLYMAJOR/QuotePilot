import { doc, getDocs, query, runTransaction, where } from "firebase/firestore";
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

function toMinorUnits(value) {
  return Math.round(asNumber(value, 0) * 100);
}

function fromStoredMoney(data = {}, minorKey = "priceMinor", legacyKey = "price") {
  if (Object.prototype.hasOwnProperty.call(data, minorKey)) {
    const minor = Number(data[minorKey]);
    return Number.isSafeInteger(minor) ? minor / 100 : 0;
  }
  return asNumber(data[legacyKey], 0);
}

async function commitCatalogMutation(organizationId, updatedAtISO, applyWrites) {
  const settingsRef = orgDocRef("settings", "config", organizationId);
  return runTransaction(db, async (transaction) => {
    const settingsSnapshot = await transaction.get(settingsRef);
    if (!settingsSnapshot.exists()) {
      throw new Error("Catalog settings are missing. Reload before editing the menu.");
    }
    const currentSettings = settingsSnapshot.data() || {};
    const currentRevision = Math.max(0, Number(currentSettings.catalogRevision || 0));
    const settingsPatch = {
      catalogRevision: currentRevision + 1,
      pricingSetupConfirmed: false,
      pricingConfirmation: null,
      updatedAtISO
    };
    applyWrites(transaction);
    transaction.set(settingsRef, settingsPatch, { merge: true });
    return {
      catalogRevision: currentRevision + 1,
      catalogSettings: { ...currentSettings, ...settingsPatch }
    };
  });
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
      price: fromStoredMoney(item),
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
  const organizationId = resolveScopedOrganizationId(data.organizationId);
  const targetCollectionRef = resolveWritableCollectionRef("menuItems", organizationId, "createMenuItem");
  const pricingType = normalizePriceType(data.pricingType || data.type);
  const payload = {
    eventTypeId: asText(data.eventTypeId),
    categoryId: asText(data.categoryId),
    name: asText(data.name, "New Menu Item"),
    priceMinor: toMinorUnits(data.price),
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
  const ref = doc(targetCollectionRef);
  const catalogMutation = await commitCatalogMutation(organizationId, payload.createdAtISO, (transaction) => {
    transaction.set(ref, payload);
  });
  return {
    id: ref.id,
    ...payload,
    price: asNumber(data.price, 0),
    ...catalogMutation
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
    payload.priceMinor = toMinorUnits(data.price);
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

  const organizationId = resolveScopedOrganizationId(data.organizationId);
  const ref = resolveWritableDocRef("menuItems", itemId, organizationId, "updateMenuItem");
  const catalogMutation = await commitCatalogMutation(organizationId, payload.updatedAtISO, (transaction) => {
    transaction.update(ref, payload);
  });
  return {
    id: itemId,
    ...payload,
    ...(Object.prototype.hasOwnProperty.call(data, "price") ? { price: asNumber(data.price, 0) } : {}),
    ...catalogMutation
  };
}

export async function deleteMenuItem(id, { organizationId = "" } = {}) {
  ensureReady();
  const itemId = asText(id);
  if (!itemId) {
    throw new Error("Menu item id is required.");
  }
  const resolvedOrganizationId = resolveScopedOrganizationId(organizationId);
  const updatedAtISO = new Date().toISOString();
  const ref = resolveWritableDocRef("menuItems", itemId, resolvedOrganizationId, "deleteMenuItem");
  const catalogMutation = await commitCatalogMutation(resolvedOrganizationId, updatedAtISO, (transaction) => {
    transaction.delete(ref);
  });
  return { ok: true, id: itemId, ...catalogMutation };
}

export async function createCategory(data = {}) {
  ensureReady();
  const organizationId = resolveScopedOrganizationId(data.organizationId);
  const targetCollectionRef = resolveWritableCollectionRef("menuCategories", organizationId, "createCategory");
  const payload = {
    eventTypeId: asText(data.eventTypeId),
    name: asText(data.name, "New Category"),
    createdAtISO: new Date().toISOString()
  };
  if (!payload.eventTypeId) {
    throw new Error("eventTypeId is required.");
  }
  const ref = doc(targetCollectionRef);
  const catalogMutation = await commitCatalogMutation(organizationId, payload.createdAtISO, (transaction) => {
    transaction.set(ref, payload);
  });
  return {
    id: ref.id,
    ...payload,
    ...catalogMutation
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

  const organizationId = resolveScopedOrganizationId(data.organizationId);
  const ref = resolveWritableDocRef("menuCategories", categoryId, organizationId, "updateCategory");
  const catalogMutation = await commitCatalogMutation(organizationId, payload.updatedAtISO, (transaction) => {
    transaction.update(ref, payload);
  });
  return {
    id: categoryId,
    ...payload,
    ...catalogMutation
  };
}

export async function createEventType(data = {}) {
  ensureReady();
  const organizationId = resolveScopedOrganizationId(data.organizationId);
  const targetCollectionRef = resolveWritableCollectionRef("eventTypes", organizationId, "createEventType");
  const categoryCollectionRef = resolveWritableCollectionRef("menuCategories", organizationId, "createEventType");
  const itemCollectionRef = resolveWritableCollectionRef("menuItems", organizationId, "createEventType");

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

  const catalogMutation = await commitCatalogMutation(organizationId, createdAtISO, (transaction) => {
    transaction.set(eventTypeRef, payload);
    canonicalSeed.categories.forEach((entry) => {
      transaction.set(doc(categoryCollectionRef, entry.id), {
        ...entry,
        source: "canonical-menu-seed",
        createdAtISO
      });
    });
    canonicalSeed.items.forEach((entry) => {
      const { price, ...entryWithoutLegacyPrice } = entry;
      transaction.set(doc(itemCollectionRef, entry.id), {
        ...entryWithoutLegacyPrice,
        priceMinor: toMinorUnits(price),
        source: "canonical-menu-seed",
        createdAtISO
      });
    });
  });

  return {
    id: eventTypeId,
    ...payload,
    ...catalogMutation,
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

  const organizationId = resolveScopedOrganizationId(data.organizationId);
  const ref = resolveWritableDocRef("eventTypes", eventTypeId, organizationId, "updateEventType");
  const catalogMutation = await commitCatalogMutation(organizationId, payload.updatedAtISO, (transaction) => {
    transaction.update(ref, payload);
  });
  return {
    id: eventTypeId,
    ...payload,
    ...catalogMutation
  };
}
