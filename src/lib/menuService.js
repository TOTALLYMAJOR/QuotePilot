import { doc, getDocs, query, runTransaction, where } from "firebase/firestore";
import { db, firebaseReady } from "./firebase";
import {
  getActiveOrganizationId,
  getOrganizationCollectionRef,
  getOrganizationSubDocRef,
  normalizeOrganizationId
} from "./organizationService";
import {
  DEFAULT_ADDONS,
  DEFAULT_PACKAGES,
  DEFAULT_RENTALS,
  DEFAULT_SETTINGS
} from "../data/mockCatalog";
import { buildCanonicalMenuForEventType } from "../data/canonicalMenuTemplate";
import { mutateManagedMenuItemAvailability } from "./catalogStarterPackService";

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
const LOCAL_CATALOG_KEY = "quoteWizard.catalog";
const LOCAL_MENU_KEY_PREFIX = "quoteWizard.menuCatalog";

function localStorageApi() {
  const storage = globalThis?.localStorage;
  if (!storage) throw new Error("Local menu storage is unavailable in this browser.");
  return storage;
}

function localMenuScope(organizationId = "") {
  return resolveScopedOrganizationId(organizationId) || "local";
}

function localMenuKey(organizationId = "") {
  return `${LOCAL_MENU_KEY_PREFIX}.${localMenuScope(organizationId)}`;
}

function buildLocalMenuSeed() {
  const categories = [];
  const items = [];
  LOCAL_EVENT_TYPES.forEach((eventType) => {
    const canonical = buildCanonicalMenuForEventType(eventType.id);
    categories.push(...canonical.categories.map((entry) => ({
      ...entry,
      source: "canonical-menu-local-seed"
    })));
    items.push(...canonical.items.map((entry) => ({
      ...entry,
      priceMinor: toMinorUnits(entry.price),
      source: "canonical-menu-local-seed"
    })));
  });
  return {
    revision: 0,
    eventTypes: LOCAL_EVENT_TYPES.map((item) => ({ ...item })),
    categories,
    items
  };
}

function readLocalMenuState(organizationId = "") {
  const storage = localStorageApi();
  const key = localMenuKey(organizationId);
  const cached = storage.getItem(key);
  if (!cached) {
    const seeded = buildLocalMenuSeed();
    storage.setItem(key, JSON.stringify(seeded));
    return seeded;
  }
  try {
    const parsed = JSON.parse(cached);
    return {
      revision: Math.max(0, Number(parsed?.revision || 0)),
      eventTypes: Array.isArray(parsed?.eventTypes) ? parsed.eventTypes : [],
      categories: Array.isArray(parsed?.categories) ? parsed.categories : [],
      items: Array.isArray(parsed?.items) ? parsed.items : []
    };
  } catch {
    const seeded = buildLocalMenuSeed();
    storage.setItem(key, JSON.stringify(seeded));
    return seeded;
  }
}

function writeLocalMenuState(organizationId, state) {
  localStorageApi().setItem(localMenuKey(organizationId), JSON.stringify(state));
}

function localId(prefix) {
  const uuid = globalThis?.crypto?.randomUUID?.().replace(/-/g, "");
  return `${prefix}-${uuid || `${Date.now()}-${Math.random().toString(16).slice(2)}`}`;
}

function updateLocalCatalogSettings(catalogRevision) {
  const storage = localStorageApi();
  let cached = null;
  try {
    cached = JSON.parse(storage.getItem(LOCAL_CATALOG_KEY) || "null");
  } catch {
    cached = null;
  }
  const source = cached && typeof cached === "object"
    ? cached
    : {
        packages: DEFAULT_PACKAGES,
        addons: DEFAULT_ADDONS,
        rentals: DEFAULT_RENTALS,
        settings: DEFAULT_SETTINGS
      };
  const catalogSettings = {
    ...DEFAULT_SETTINGS,
    ...(source.settings || {}),
    catalogRevision,
    pricingSetupConfirmed: false,
    pricingConfirmation: null,
    updatedAtISO: new Date().toISOString()
  };
  storage.setItem(LOCAL_CATALOG_KEY, JSON.stringify({
    ...source,
    settings: catalogSettings
  }));
  return catalogSettings;
}

function commitLocalMenuMutation(organizationId, mutate) {
  const current = readLocalMenuState(organizationId);
  const next = {
    revision: current.revision,
    eventTypes: current.eventTypes.map((item) => ({ ...item })),
    categories: current.categories.map((item) => ({ ...item })),
    items: current.items.map((item) => ({ ...item }))
  };
  const result = mutate(next) || {};
  next.revision = current.revision + 1;
  writeLocalMenuState(organizationId, next);
  return {
    ...result,
    catalogRevision: next.revision,
    catalogSettings: updateLocalCatalogSettings(next.revision)
  };
}

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

export function isMenuCatalogRevisionConflict(error) {
  const code = String(error?.code || "").trim().toLowerCase().split("/").at(-1);
  const message = String(error?.message || "").toLowerCase();
  return code === "aborted" || message.includes("catalog revision changed");
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
  if (!firebaseReady || !db) {
    return sortByName(readLocalMenuState(organizationId).eventTypes.map((item) => ({
      ...item,
      name: asText(item.name, "Untitled Event Type")
    })));
  }
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
  if (!nextEventTypeId) return [];
  if (!firebaseReady || !db) {
    return sortByName(readLocalMenuState(organizationId).categories
      .filter((item) => asText(item.eventTypeId) === nextEventTypeId)
      .map((item) => ({
        ...item,
        eventTypeId: nextEventTypeId,
        name: asText(item.name, "Untitled Category")
      })));
  }
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
  if (!nextEventTypeId) return [];
  if (!firebaseReady || !db) {
    const mapped = readLocalMenuState(organizationId).items
      .filter((item) => asText(item.eventTypeId) === nextEventTypeId)
      .map((item) => {
        const pricingType = normalizePriceType(item.pricingType || item.type);
        return {
          ...item,
          eventTypeId: nextEventTypeId,
          categoryId: asText(item.categoryId),
          name: asText(item.name, "Untitled Item"),
          price: fromStoredMoney(item),
          pricingType,
          type: pricingType,
          active: normalizeActive(item.active, true)
        };
      });
    return sortByName(includeInactive ? mapped : mapped.filter((item) => item.active !== false));
  }
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
  const organizationId = resolveScopedOrganizationId(data.organizationId);
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
  if (!firebaseReady || !db) {
    const id = localId("menu-item");
    const mutation = commitLocalMenuMutation(data.organizationId, (state) => {
      if (!state.eventTypes.some((item) => item.id === payload.eventTypeId)) {
        throw new Error("Event type no longer exists. Refresh the menu and try again.");
      }
      if (!state.categories.some((item) => (
        item.id === payload.categoryId && item.eventTypeId === payload.eventTypeId
      ))) {
        throw new Error("Category no longer exists. Refresh the menu and try again.");
      }
      state.items.push({ id, ...payload, source: "local-custom" });
      return { id, ...payload, price: asNumber(data.price, 0) };
    });
    return mutation;
  }
  ensureReady();
  const targetCollectionRef = resolveWritableCollectionRef("menuItems", organizationId, "createMenuItem");
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

  if (!firebaseReady || !db) {
    return commitLocalMenuMutation(data.organizationId, (state) => {
      const itemIndex = state.items.findIndex((item) => item.id === itemId);
      if (itemIndex < 0) throw new Error("Menu item no longer exists. Refresh and try again.");
      const current = state.items[itemIndex];
      const next = { ...current, ...payload };
      if (!state.eventTypes.some((item) => item.id === next.eventTypeId)) {
        throw new Error("Event type no longer exists. Refresh and try again.");
      }
      if (!state.categories.some((item) => (
        item.id === next.categoryId && item.eventTypeId === next.eventTypeId
      ))) {
        throw new Error("Category no longer exists. Refresh and try again.");
      }
      state.items[itemIndex] = next;
      return {
        id: itemId,
        ...payload,
        ...(Object.prototype.hasOwnProperty.call(data, "price")
          ? { price: asNumber(data.price, 0) }
          : {})
      };
    });
  }
  ensureReady();

  const organizationId = resolveScopedOrganizationId(data.organizationId);
  if (payload.active === false) {
    const authorityResult = await mutateManagedMenuItemAvailability({
      organizationId,
      itemId,
      action: "deactivate",
      item: {
        name: payload.name,
        ...(Object.prototype.hasOwnProperty.call(payload, "priceMinor")
          ? { priceMinor: payload.priceMinor }
          : {}),
        pricingType: payload.pricingType || payload.type
      },
      expectedCatalogRevision: Number(data.expectedCatalogRevision)
    });
    return {
      id: itemId,
      ...payload,
      ...(Object.prototype.hasOwnProperty.call(data, "price") ? { price: asNumber(data.price, 0) } : {}),
      ...authorityResult,
      authoritativeMutation: true
    };
  }
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

export async function deleteMenuItem(id, {
  organizationId = "",
  expectedCatalogRevision
} = {}) {
  const itemId = asText(id);
  if (!itemId) {
    throw new Error("Menu item id is required.");
  }
  if (!firebaseReady || !db) {
    return commitLocalMenuMutation(organizationId, (state) => {
      const itemIndex = state.items.findIndex((item) => item.id === itemId);
      if (itemIndex < 0) throw new Error("Menu item no longer exists. Refresh and try again.");
      state.items.splice(itemIndex, 1);
      return { ok: true, id: itemId };
    });
  }
  ensureReady();
  const resolvedOrganizationId = resolveScopedOrganizationId(organizationId);
  const authorityResult = await mutateManagedMenuItemAvailability({
    organizationId: resolvedOrganizationId,
    itemId,
    action: "delete",
    expectedCatalogRevision: Number(expectedCatalogRevision)
  });
  return {
    ok: true,
    id: itemId,
    ...authorityResult,
    authoritativeMutation: true
  };
}

export async function createCategory(data = {}) {
  const organizationId = resolveScopedOrganizationId(data.organizationId);
  const payload = {
    eventTypeId: asText(data.eventTypeId),
    name: asText(data.name, "New Category"),
    createdAtISO: new Date().toISOString()
  };
  if (!payload.eventTypeId) {
    throw new Error("eventTypeId is required.");
  }
  if (!firebaseReady || !db) {
    const id = localId("menu-category");
    return commitLocalMenuMutation(data.organizationId, (state) => {
      if (!state.eventTypes.some((item) => item.id === payload.eventTypeId)) {
        throw new Error("Event type no longer exists. Refresh the menu and try again.");
      }
      state.categories.push({ id, ...payload, source: "local-custom" });
      return { id, ...payload };
    });
  }
  ensureReady();
  const targetCollectionRef = resolveWritableCollectionRef("menuCategories", organizationId, "createCategory");
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

  if (!firebaseReady || !db) {
    return commitLocalMenuMutation(data.organizationId, (state) => {
      const categoryIndex = state.categories.findIndex((item) => item.id === categoryId);
      if (categoryIndex < 0) throw new Error("Category no longer exists. Refresh and try again.");
      const current = state.categories[categoryIndex];
      const next = { ...current, ...payload };
      if (!state.eventTypes.some((item) => item.id === next.eventTypeId)) {
        throw new Error("Event type no longer exists. Refresh the menu and try again.");
      }
      state.categories[categoryIndex] = next;
      if (next.eventTypeId !== current.eventTypeId) {
        state.items = state.items.map((item) => (
          item.categoryId === categoryId
            ? { ...item, eventTypeId: next.eventTypeId, updatedAtISO: payload.updatedAtISO }
            : item
        ));
      }
      return { id: categoryId, ...payload };
    });
  }
  ensureReady();

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
  const organizationId = resolveScopedOrganizationId(data.organizationId);
  const createdAtISO = new Date().toISOString();
  const seedCanonical = data.seedCanonical === true;
  if (!firebaseReady || !db) {
    const eventTypeId = localId("event-type");
    const canonicalSeed = seedCanonical
      ? buildCanonicalMenuForEventType(eventTypeId)
      : { categories: [], items: [] };
    const payload = {
      name: asText(data.name, "New Event Type"),
      createdAtISO
    };
    return commitLocalMenuMutation(data.organizationId, (state) => {
      state.eventTypes.push({ id: eventTypeId, ...payload, source: "local-custom" });
      state.categories.push(...canonicalSeed.categories.map((entry) => ({
        ...entry,
        source: "canonical-menu-local-seed",
        createdAtISO
      })));
      state.items.push(...canonicalSeed.items.map((entry) => ({
        ...entry,
        priceMinor: toMinorUnits(entry.price),
        source: "canonical-menu-local-seed",
        createdAtISO
      })));
      return {
        id: eventTypeId,
        ...payload,
        seeded: {
          categories: canonicalSeed.categories.length,
          items: canonicalSeed.items.length
        }
      };
    });
  }
  ensureReady();
  const targetCollectionRef = resolveWritableCollectionRef("eventTypes", organizationId, "createEventType");
  const categoryCollectionRef = resolveWritableCollectionRef("menuCategories", organizationId, "createEventType");
  const itemCollectionRef = resolveWritableCollectionRef("menuItems", organizationId, "createEventType");
  const eventTypeRef = doc(targetCollectionRef);
  const eventTypeId = eventTypeRef.id;
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
  const eventTypeId = asText(id);
  if (!eventTypeId) {
    throw new Error("Event type id is required.");
  }

  const payload = {};
  if (Object.prototype.hasOwnProperty.call(data, "name")) {
    payload.name = asText(data.name, "New Event Type");
  }
  payload.updatedAtISO = new Date().toISOString();

  if (!firebaseReady || !db) {
    return commitLocalMenuMutation(data.organizationId, (state) => {
      const eventTypeIndex = state.eventTypes.findIndex((item) => item.id === eventTypeId);
      if (eventTypeIndex < 0) throw new Error("Event type no longer exists. Refresh and try again.");
      state.eventTypes[eventTypeIndex] = {
        ...state.eventTypes[eventTypeIndex],
        ...payload
      };
      return { id: eventTypeId, ...payload };
    });
  }
  ensureReady();

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
