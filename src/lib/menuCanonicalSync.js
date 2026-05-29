import {
  buildCanonicalMenuForEventType,
  CANONICAL_MENU_CATEGORY_COUNT,
  CANONICAL_MENU_ITEM_COUNT
} from "../data/canonicalMenuTemplate.js";

function toText(value, fallback = "") {
  const text = String(value || "").trim();
  return text || fallback;
}

function hasUnexpectedKeys(existing = {}, allowedKeys = []) {
  const allowed = new Set(allowedKeys);
  return Object.keys(existing || {}).some((key) => !allowed.has(key));
}

function categoryNeedsUpdate(existingData = {}, desiredData = {}) {
  const comparableChanged =
    toText(existingData.eventTypeId) !== desiredData.eventTypeId
    || toText(existingData.name) !== desiredData.name;
  const hasLegacyKeys = hasUnexpectedKeys(existingData, [
    "eventTypeId",
    "name",
    "source",
    "createdAtISO",
    "updatedAtISO"
  ]);
  return comparableChanged || hasLegacyKeys;
}

function itemNeedsUpdate(existingData = {}, desiredData = {}) {
  const comparableChanged =
    toText(existingData.eventTypeId) !== desiredData.eventTypeId
    || toText(existingData.categoryId) !== desiredData.categoryId
    || toText(existingData.name) !== desiredData.name
    || toText(existingData.pricingType) !== desiredData.pricingType
    || toText(existingData.type) !== desiredData.type
    || Number(existingData.price || 0) !== Number(desiredData.price || 0)
    || (existingData.active !== false) !== desiredData.active;
  const hasLegacyKeys = hasUnexpectedKeys(existingData, [
    "eventTypeId",
    "categoryId",
    "name",
    "pricingType",
    "type",
    "price",
    "active",
    "source",
    "createdAtISO",
    "updatedAtISO"
  ]);
  return comparableChanged || hasLegacyKeys;
}

export function buildCanonicalMenuExpectedDocs(eventTypeIds = [], nowISO = "") {
  const categories = [];
  const items = [];

  eventTypeIds.forEach((eventTypeId) => {
    const scoped = buildCanonicalMenuForEventType(eventTypeId);
    scoped.categories.forEach((entry) => {
      categories.push({
        id: entry.id,
        data: {
          eventTypeId: entry.eventTypeId,
          name: entry.name,
          source: "canonical-menu-sync",
          createdAtISO: nowISO,
          updatedAtISO: nowISO
        }
      });
    });
    scoped.items.forEach((entry) => {
      items.push({
        id: entry.id,
        data: {
          eventTypeId: entry.eventTypeId,
          categoryId: entry.categoryId,
          name: entry.name,
          pricingType: entry.pricingType,
          type: entry.type,
          price: Number(entry.price || 0),
          active: entry.active !== false,
          source: "canonical-menu-sync",
          createdAtISO: nowISO,
          updatedAtISO: nowISO
        }
      });
    });
  });

  return { categories, items };
}

export function buildCanonicalMenuSyncPlan({
  eventTypeIds = [],
  existingCategories = [],
  existingItems = [],
  nowISO = ""
}) {
  const expected = buildCanonicalMenuExpectedDocs(eventTypeIds, nowISO);
  const expectedCategoriesById = new Map(expected.categories.map((entry) => [entry.id, entry]));
  const expectedItemsById = new Map(expected.items.map((entry) => [entry.id, entry]));
  const existingCategoriesById = new Map(existingCategories.map((entry) => [entry.id, entry]));
  const existingItemsById = new Map(existingItems.map((entry) => [entry.id, entry]));
  const expectedCategoryIds = new Set(expected.categories.map((entry) => entry.id));
  const knownEventTypeIds = new Set(eventTypeIds.map((id) => toText(id)).filter(Boolean));

  const categoryCreates = [];
  const categoryUpdates = [];
  const categoryDeletes = [];
  const itemCreates = [];
  const itemUpdates = [];
  const itemDeletes = [];

  expected.categories.forEach((entry) => {
    const existing = existingCategoriesById.get(entry.id);
    if (!existing) {
      categoryCreates.push(entry);
      return;
    }
    if (categoryNeedsUpdate(existing.data, entry.data)) {
      categoryUpdates.push({
        id: entry.id,
        data: {
          ...entry.data,
          createdAtISO: toText(existing.data.createdAtISO) || nowISO
        }
      });
    }
  });

  expected.items.forEach((entry) => {
    const existing = existingItemsById.get(entry.id);
    if (!existing) {
      itemCreates.push(entry);
      return;
    }
    if (itemNeedsUpdate(existing.data, entry.data)) {
      itemUpdates.push({
        id: entry.id,
        data: {
          ...entry.data,
          createdAtISO: toText(existing.data.createdAtISO) || nowISO
        }
      });
    }
  });

  let categoryOrphanDeletes = 0;
  existingCategories.forEach((entry) => {
    if (expectedCategoriesById.has(entry.id)) return;
    const eventTypeId = toText(entry.data?.eventTypeId);
    if (!eventTypeId || !knownEventTypeIds.has(eventTypeId)) {
      categoryOrphanDeletes += 1;
    }
    categoryDeletes.push(entry);
  });

  let itemOrphanDeletes = 0;
  existingItems.forEach((entry) => {
    if (expectedItemsById.has(entry.id)) return;
    const eventTypeId = toText(entry.data?.eventTypeId);
    const categoryId = toText(entry.data?.categoryId);
    if (
      !eventTypeId
      || !knownEventTypeIds.has(eventTypeId)
      || !categoryId
      || !expectedCategoryIds.has(categoryId)
    ) {
      itemOrphanDeletes += 1;
    }
    itemDeletes.push(entry);
  });

  return {
    expectedCounts: {
      eventTypes: knownEventTypeIds.size,
      categoriesPerEventType: CANONICAL_MENU_CATEGORY_COUNT,
      itemsPerEventType: CANONICAL_MENU_ITEM_COUNT,
      categoriesTotal: expected.categories.length,
      itemsTotal: expected.items.length
    },
    categories: {
      existing: existingCategories.length,
      create: categoryCreates,
      update: categoryUpdates,
      delete: categoryDeletes,
      orphanDeletes: categoryOrphanDeletes
    },
    items: {
      existing: existingItems.length,
      create: itemCreates,
      update: itemUpdates,
      delete: itemDeletes,
      orphanDeletes: itemOrphanDeletes
    }
  };
}
