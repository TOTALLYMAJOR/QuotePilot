import { httpsCallable } from "firebase/functions";
import { buildCatalogRecordChanges, buildSettingsPatch } from "../hooks/useCatalogData";
import { cloudFunctions, firebaseReady } from "./firebase";
import { addonWriteShape, packageWriteShape, rentalWriteShape } from "./catalogWriteShapes";

const E2E_FUNCTION_ADAPTER_ENABLED = ["1", "true", "yes", "on"].includes(
  String(import.meta.env.VITE_E2E_BYPASS_AUTH || "").trim().toLowerCase()
);

const COLLECTION_BY_CATALOG_KEY = Object.freeze({
  packages: "catalogPackages",
  addons: "catalogAddons",
  rentals: "catalogRentals"
});
const WRITE_SHAPE_BY_CATALOG_KEY = Object.freeze({
  packages: packageWriteShape,
  addons: addonWriteShape,
  rentals: rentalWriteShape
});

function stableValue(value) {
  if (Array.isArray(value)) return value.map(stableValue);
  if (value && typeof value === "object") {
    return Object.keys(value).sort().reduce((result, key) => {
      if (value[key] !== undefined && typeof value[key] !== "function") {
        result[key] = stableValue(value[key]);
      }
      return result;
    }, {});
  }
  return value;
}

function valuesMatch(left, right) {
  return JSON.stringify(stableValue(left)) === JSON.stringify(stableValue(right));
}

function minor(value) {
  if (value === "" || value === null || value === undefined) return null;
  return Math.round(Number(value) * 100);
}

function menuPayload(item = {}) {
  const pricingType = ["per_person", "per_item", "per_event"].includes(item.pricingType || item.type)
    ? item.pricingType || item.type
    : "per_event";
  return {
    name: String(item.name || "").trim() || "Untitled Item",
    eventTypeId: String(item.eventTypeId || "").trim(),
    categoryId: String(item.categoryId || "").trim(),
    priceMinor: Math.round(Number(item.price || 0) * 100),
    costMinor: minor(item.cost),
    pricingType,
    type: pricingType,
    active: item.active !== false
  };
}

function categoryPayload(item = {}) {
  return {
    name: String(item.name || "").trim() || "Untitled Menu section",
    eventTypeId: String(item.eventTypeId || "").trim(),
    active: item.active !== false
  };
}

function eventTypePayload(item = {}) {
  return {
    name: String(item.name || "").trim() || "Untitled Event type",
    active: item.active !== false
  };
}

function keyedRecords(records = []) {
  return new Map((Array.isArray(records) ? records : []).map((item) => [String(item?.id || "").trim(), item]));
}

function buildManagedChanges(collection, nextRecords = [], baselineRecords = [], payloadBuilder) {
  const nextById = keyedRecords(nextRecords);
  const baselineById = keyedRecords(baselineRecords);
  const ids = new Set([...nextById.keys(), ...baselineById.keys()]);
  const changes = [];
  ids.forEach((id) => {
    if (!id) return;
    const next = nextById.get(id);
    const baseline = baselineById.get(id);
    if (!next && baseline) {
      changes.push({
        collection,
        recordId: id,
        intent: "deactivate",
        payload: payloadBuilder({ ...baseline, active: false })
      });
      return;
    }
    const nextPayload = payloadBuilder(next);
    if (baseline && valuesMatch(nextPayload, payloadBuilder(baseline))) return;
    changes.push({
      collection,
      recordId: id,
      intent: baseline ? (next?.active === false ? "deactivate" : "update") : "create",
      payload: nextPayload
    });
  });
  return changes;
}

export function buildCatalogSetupChanges({
  catalog = {},
  baselineCatalog = {},
  serverFingerprints = {},
  menu = {},
  baselineMenu = {}
} = {}) {
  const catalogChanges = buildCatalogRecordChanges({
    catalog,
    baselineCatalog,
    serverFingerprints
  }).map((change) => {
    const baselineItem = (baselineCatalog?.[change.key] || [])
      .find((item) => String(item?.id || "").trim() === change.id);
    return {
      collection: COLLECTION_BY_CATALOG_KEY[change.key],
      recordId: change.id,
      intent: change.nextItem
        ? (change.expectedFingerprint ? (change.nextItem.active === false ? "deactivate" : "update") : "create")
        : "deactivate",
      payload: change.nextItem
        ? change.writeData
        : WRITE_SHAPE_BY_CATALOG_KEY[change.key]({ ...baselineItem, active: false })
    };
  });
  const settingsPatch = buildSettingsPatch(catalog.settings || {}, baselineCatalog.settings || {});
  const changes = [
    ...catalogChanges,
    ...(Object.keys(settingsPatch).length > 0
      ? [{ collection: "settings", recordId: "config", intent: "update", payload: settingsPatch }]
      : []),
    ...buildManagedChanges("eventTypes", menu.eventTypes, baselineMenu.eventTypes, eventTypePayload),
    ...buildManagedChanges("menuCategories", menu.categories, baselineMenu.categories, categoryPayload),
    ...buildManagedChanges("menuItems", menu.items, baselineMenu.items, menuPayload)
  ];
  const byId = new Map();
  changes.forEach((change) => byId.set(`${change.collection}:${change.recordId}`, change));
  return [...byId.values()].sort((left, right) => (
    `${left.collection}:${left.recordId}`.localeCompare(`${right.collection}:${right.recordId}`)
  ));
}

export function createCatalogSetupRequestId(prefix = "catalog") {
  const random = globalThis.crypto?.randomUUID?.()
    || `${Date.now()}-${Math.random().toString(36).slice(2)}`;
  return `${String(prefix || "catalog").replace(/[^A-Za-z0-9_-]/g, "_")}_${random.replace(/-/g, "")}`;
}

async function callCatalogSetup(name, payload) {
  if (E2E_FUNCTION_ADAPTER_ENABLED) {
    const adapter = globalThis.__quotePilotE2eFunctions;
    if (typeof adapter?.[name] === "function") return adapter[name](payload);
  }
  if (!firebaseReady || !cloudFunctions) {
    throw new Error("Cloud Functions unavailable. Configure Firebase before editing the catalog draft.");
  }
  const callable = httpsCallable(cloudFunctions, name);
  const result = await callable(payload);
  return result?.data || { ok: false };
}

export function getCatalogSetupDraft({ organizationId = "" } = {}) {
  return callCatalogSetup("getCatalogSetupDraft", { organizationId });
}

export function saveCatalogSetupDraft({
  organizationId = "",
  requestId = createCatalogSetupRequestId("draft"),
  expectedGeneration = 0,
  baseCatalogRevision = 0,
  patches = []
} = {}) {
  return callCatalogSetup("saveCatalogSetupDraft", {
    organizationId,
    requestId,
    expectedGeneration,
    baseCatalogRevision,
    patches
  });
}

export function reviewCatalogSetupDraft({
  organizationId = "",
  expectedGeneration = 0,
  baseCatalogRevision = 0
} = {}) {
  return callCatalogSetup("reviewCatalogSetupDraft", {
    organizationId,
    expectedGeneration,
    baseCatalogRevision
  });
}

export function publishCatalogSetupDraft({
  organizationId = "",
  requestId = createCatalogSetupRequestId("publish"),
  expectedGeneration = 0,
  baseCatalogRevision = 0
} = {}) {
  return callCatalogSetup("publishCatalogSetupDraft", {
    organizationId,
    requestId,
    expectedGeneration,
    baseCatalogRevision
  });
}
