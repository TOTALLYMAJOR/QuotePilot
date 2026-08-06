const { createHash } = require("node:crypto");
const starterCatalogPackData = require("./data/starterCatalogPacks.json");

const PACK_SOURCE = "starter-catalog-pack";
const MAX_TRANSACTION_WRITES = 450;
const COLLECTION_NAMES = Object.freeze([
  "catalogPackages",
  "catalogAddons",
  "catalogRentals",
  "eventTypes",
  "menuCategories",
  "menuItems"
]);
const PACK_PRICING_SETTING_KEYS = Object.freeze([
  "perMileRateMinor",
  "longDistancePerMileRateMinor",
  "deliveryThresholdMiles",
  "serviceFeePct",
  "serviceFeeTiers",
  "taxRate",
  "taxRegions",
  "defaultTaxRegion",
  "depositPct",
  "depositNotice",
  "quoteValidityDays",
  "staffingChargeMode",
  "staffingLaborEnabled",
  "bartenderRateMinor",
  "bartenderRateTypes",
  "defaultBartenderRateType",
  "serverRateMinor",
  "chefRateMinor",
  "staffingRateTypes",
  "defaultStaffingRateType",
  "seasonalProfiles",
  "defaultSeasonProfile"
]);
const UNCONFIGURED_PRICING_SETTINGS = Object.freeze({
  perMileRateMinor: 0,
  longDistancePerMileRateMinor: 0,
  deliveryThresholdMiles: 0,
  serviceFeePct: 0,
  serviceFeeTiers: [{ id: "unconfigured", minGuests: 0, maxGuests: 9999, pct: 0 }],
  taxRate: 0,
  taxRegions: [{ id: "unconfigured", name: "Not configured", rate: 0 }],
  defaultTaxRegion: "unconfigured",
  depositPct: 0,
  depositNotice: "No deposit rule has been configured.",
  quoteValidityDays: 30,
  staffingChargeMode: "per_hour",
  staffingLaborEnabled: false,
  bartenderRateMinor: 0,
  bartenderRateTypes: [{ id: "unconfigured", name: "Unconfigured bartender rate", rateMinor: 0 }],
  defaultBartenderRateType: "unconfigured",
  serverRateMinor: 0,
  chefRateMinor: 0,
  staffingRateTypes: [{
    id: "unconfigured",
    name: "Unconfigured staffing rate",
    serverRateMinor: 0,
    chefRateMinor: 0
  }],
  defaultStaffingRateType: "unconfigured",
  seasonalProfiles: [{
    id: "standard",
    name: "Standard pricing",
    startMonth: 1,
    startDay: 1,
    endMonth: 12,
    endDay: 31,
    packageMultiplier: 1,
    addonMultiplier: 1,
    rentalMultiplier: 1
  }],
  defaultSeasonProfile: "standard"
});

class StarterCatalogPackError extends Error {
  constructor(code, message, details = {}) {
    super(message);
    this.name = "StarterCatalogPackError";
    this.code = code;
    this.details = details;
  }
}

function text(value, fallback = "") {
  const normalized = String(value ?? "").trim();
  return normalized || fallback;
}

function slug(value, fallback = "item") {
  const normalized = text(value, fallback)
    .toLowerCase()
    .replace(/[^\w-]+/g, "-")
    .replace(/-{2,}/g, "-")
    .replace(/^-|-$/g, "");
  return normalized || fallback;
}

function normalizePricingType(value, fallback = "per_event") {
  const normalized = text(value, fallback).toLowerCase();
  return ["per_person", "per_item", "per_event"].includes(normalized)
    ? normalized
    : fallback;
}

function assertPricingType(value, label) {
  const normalized = text(value).toLowerCase();
  if (!["per_person", "per_item", "per_event"].includes(normalized)) {
    throw new StarterCatalogPackError(
      "failed-precondition",
      `${label} has an invalid pricing type.`
    );
  }
  return normalized;
}

function assertRatio(value, label) {
  const normalized = Number(value);
  if (!Number.isFinite(normalized) || normalized < 0 || normalized > 1) {
    throw new StarterCatalogPackError("failed-precondition", `${label} must be between 0 and 1.`);
  }
  return normalized;
}

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

function hashValue(value) {
  return createHash("sha256")
    .update(JSON.stringify(stableValue(value)))
    .digest("hex");
}

function manifestKey(packId, packVersion) {
  return `${slug(packId, "")}@${Number(packVersion || 0)}`;
}

function findStarterCatalogPack(packId = "", packVersion = null) {
  const normalizedPackId = slug(packId, "");
  const candidates = starterCatalogPackData.packs
    .filter((pack) => pack.id === normalizedPackId)
    .sort((left, right) => Number(right.version || 0) - Number(left.version || 0));
  if (packVersion === null || packVersion === undefined || packVersion === "") {
    return candidates[0] || null;
  }
  return candidates.find((pack) => Number(pack.version || 0) === Number(packVersion)) || null;
}

function getStarterCatalogPackSummaries() {
  const latestById = new Map();
  starterCatalogPackData.packs.forEach((pack) => {
    const current = latestById.get(pack.id);
    if (!current || Number(pack.version || 0) > Number(current.version || 0)) {
      latestById.set(pack.id, pack);
    }
  });
  return Array.from(latestById.values()).map((pack) => ({
    id: pack.id,
    version: Number(pack.version || 1),
    name: pack.name,
    description: pack.description,
    counts: {
      eventTypes: pack.eventTypes.length,
      packages: pack.packages.length,
      addons: pack.addons.length,
      rentals: pack.rentals.length,
      menuSections: pack.eventTypes.reduce((sum, eventType) => sum + eventType.sections.length, 0),
      menuItems: pack.eventTypes.reduce(
        (sum, eventType) => sum + eventType.sections.reduce(
          (sectionSum, section) => sectionSum + section.items.length,
          0
        ),
        0
      )
    }
  }));
}

function recordBusinessData(collectionName, data = {}) {
  if (collectionName === "catalogPackages") {
    return { name: text(data.name), pppMinor: Number(data.pppMinor) };
  }
  if (collectionName === "catalogAddons") {
    const pricingType = normalizePricingType(data.pricingType || data.type, "per_person");
    return {
      name: text(data.name),
      pricingType,
      type: pricingType,
      priceMinor: Number(data.priceMinor),
      staffRole: text(data.staffRole).toLowerCase(),
      active: data.active !== false
    };
  }
  if (collectionName === "catalogRentals") {
    const pricingType = normalizePricingType(data.pricingType || data.type, "per_item");
    return {
      name: text(data.name),
      pricingType,
      type: pricingType,
      priceMinor: Number(data.priceMinor),
      qtyPerGuests: Math.max(1, Number(data.qtyPerGuests || 1)),
      active: data.active !== false
    };
  }
  if (collectionName === "eventTypes") {
    return { name: text(data.name) };
  }
  if (collectionName === "menuCategories") {
    return { eventTypeId: text(data.eventTypeId), name: text(data.name) };
  }
  if (collectionName === "menuItems") {
    const pricingType = normalizePricingType(data.pricingType || data.type, "per_event");
    return {
      eventTypeId: text(data.eventTypeId),
      categoryId: text(data.categoryId),
      name: text(data.name),
      pricingType,
      type: pricingType,
      priceMinor: Number(data.priceMinor || 0),
      active: data.active !== false
    };
  }
  return {};
}

function withPackProvenance(collectionName, data, pack, nowISO) {
  const businessData = recordBusinessData(collectionName, data);
  return {
    ...businessData,
    source: PACK_SOURCE,
    starterPackId: pack.id,
    starterPackVersion: Number(pack.version || 1),
    starterPackBaselineHash: hashValue(businessData),
    createdAtISO: nowISO,
    updatedAtISO: nowISO
  };
}

function buildStarterCatalogPackDocuments(packId, {
  packVersion = null,
  nowISO = new Date().toISOString(),
  actorUid = ""
} = {}) {
  const pack = findStarterCatalogPack(packId, packVersion);
  if (!pack) {
    throw new StarterCatalogPackError("invalid-argument", "Choose a supported starter catalog pack version.");
  }

  const collections = Object.fromEntries(COLLECTION_NAMES.map((name) => [name, []]));
  pack.packages.forEach((item) => {
    collections.catalogPackages.push({
      id: slug(item.id || item.name, "package"),
      data: withPackProvenance("catalogPackages", item, pack, nowISO)
    });
  });
  pack.addons.forEach((item) => {
    collections.catalogAddons.push({
      id: slug(item.id || item.name, "addon"),
      data: withPackProvenance("catalogAddons", item, pack, nowISO)
    });
  });
  pack.rentals.forEach((item) => {
    collections.catalogRentals.push({
      id: slug(item.id || item.name, "rental"),
      data: withPackProvenance("catalogRentals", item, pack, nowISO)
    });
  });
  pack.eventTypes.forEach((eventType) => {
    const eventTypeId = slug(eventType.id || eventType.name, "event");
    collections.eventTypes.push({
      id: eventTypeId,
      data: withPackProvenance("eventTypes", { name: eventType.name }, pack, nowISO)
    });
    eventType.sections.forEach((section, sectionIndex) => {
      const sectionId = slug(section.id || section.name, `category-${sectionIndex + 1}`);
      const categoryId = `${eventTypeId}__${sectionId}`;
      collections.menuCategories.push({
        id: categoryId,
        data: withPackProvenance("menuCategories", {
          eventTypeId,
          name: text(section.name, `Category ${sectionIndex + 1}`)
        }, pack, nowISO)
      });
      section.items.forEach((item, itemIndex) => {
        const itemData = typeof item === "string" ? { name: item } : item;
        const itemName = text(itemData?.name, `Item ${itemIndex + 1}`);
        const itemId = `${categoryId}__${slug(itemData?.id || itemName, `item-${itemIndex + 1}`)}`;
        collections.menuItems.push({
          id: itemId,
          data: withPackProvenance("menuItems", {
            eventTypeId,
            categoryId,
            name: itemName,
            pricingType: itemData?.pricingType || itemData?.type || "per_event",
            priceMinor: Number(itemData?.priceMinor || 0),
            active: itemData?.active !== false
          }, pack, nowISO)
        });
      });
    });
  });

  const allIds = new Set();
  COLLECTION_NAMES.forEach((collectionName) => {
    collections[collectionName].forEach((entry) => {
      const scopedId = `${collectionName}/${entry.id}`;
      if (allIds.has(scopedId)) {
        throw new StarterCatalogPackError(
          "failed-precondition",
          `Starter pack contains duplicate record ${scopedId}.`
        );
      }
      allIds.add(scopedId);
    });
  });

  const controlledSettings = {
    ...starterCatalogPackData.commonSettings,
    ...pack.settings
  };
  const settingsBaselineHashes = Object.fromEntries(
    PACK_PRICING_SETTING_KEYS.map((key) => [key, hashValue(controlledSettings[key])])
  );
  return {
    pack: {
      id: pack.id,
      version: Number(pack.version || 1),
      name: pack.name,
      manifestKey: manifestKey(pack.id, pack.version),
      manifestHash: hashValue(pack)
    },
    collections,
    controlledSettings,
    settingsBaselineHashes,
    settings: {
      ...controlledSettings,
      pricingSetupConfirmed: false,
      pricingSettingsUpdatedAtISO: nowISO,
      starterCatalogPack: {
        id: pack.id,
        version: Number(pack.version || 1),
        manifestKey: manifestKey(pack.id, pack.version),
        manifestHash: hashValue(pack),
        name: pack.name,
        appliedAtISO: nowISO,
        appliedByUid: text(actorUid),
        settingsBaselineHashes
      },
      updatedAtISO: nowISO
    },
    counts: Object.fromEntries(
      COLLECTION_NAMES.map((collectionName) => [collectionName, collections[collectionName].length])
    ),
    totalRecords: allIds.size
  };
}

function classifyPackRecord(collectionName, docData = {}, packId = "", packVersion = 0) {
  if (
    docData?.source !== PACK_SOURCE
    || text(docData?.starterPackId) !== packId
    || Number(docData?.starterPackVersion || 0) !== Number(packVersion || 0)
  ) {
    return "custom";
  }
  const baselineHash = text(docData?.starterPackBaselineHash);
  if (!baselineHash) return "modified";
  return baselineHash === hashValue(recordBusinessData(collectionName, docData))
    ? "generated"
    : "modified";
}

function assertIntegerMinor(value, label, { positive = false } = {}) {
  if (!Number.isSafeInteger(value) || value < 0 || (positive && value <= 0)) {
    throw new StarterCatalogPackError(
      "failed-precondition",
      `${label} must be stored as ${positive ? "a positive" : "a non-negative"} integer minor-unit value.`
    );
  }
}

function resolveStoredMinor(data = {}, minorKey, legacyKey, label, {
  positive = false,
  requireMinor = false
} = {}) {
  if (Object.prototype.hasOwnProperty.call(data || {}, minorKey)) {
    assertIntegerMinor(data[minorKey], label, { positive });
    return { minor: data[minorKey], needsMigration: false };
  }
  if (requireMinor) {
    throw new StarterCatalogPackError(
      "failed-precondition",
      `${label} is pack-owned and must use integer minor units.`
    );
  }
  const legacyValue = Number(data?.[legacyKey]);
  const minor = Math.round(legacyValue * 100);
  if (
    !Number.isFinite(legacyValue)
    || Math.abs((legacyValue * 100) - minor) > 1e-8
  ) {
    throw new StarterCatalogPackError(
      "failed-precondition",
      `${label} must be a valid amount with no more than two decimal places.`
    );
  }
  assertIntegerMinor(minor, label, { positive });
  return { minor, needsMigration: true };
}

function isPackOwned(data = {}) {
  return data?.source === PACK_SOURCE;
}

function validateCatalogForConfirmation({ settings = {}, collections = {} } = {}) {
  const packages = collections.catalogPackages || [];
  const addons = collections.catalogAddons || [];
  const rentals = collections.catalogRentals || [];
  const eventTypes = collections.eventTypes || [];
  const categories = collections.menuCategories || [];
  const menuItems = collections.menuItems || [];
  if (!packages.length) {
    throw new StarterCatalogPackError("failed-precondition", "Add at least one package before confirming pricing.");
  }
  if (!eventTypes.length) {
    throw new StarterCatalogPackError("failed-precondition", "Add at least one event type before confirming pricing.");
  }

  const eventTypeIds = new Set(eventTypes.map((entry) => entry.id));
  const categoriesById = new Map(categories.map((entry) => [entry.id, entry.data || {}]));
  packages.forEach((entry) => {
    if (!text(entry.data?.name) || text(entry.data?.name).toLowerCase() === "new package") {
      throw new StarterCatalogPackError("failed-precondition", `Package ${entry.id} needs a customer-facing name.`);
    }
    resolveStoredMinor(entry.data, "pppMinor", "ppp", `Package ${entry.id} price`, {
      positive: true,
      requireMinor: isPackOwned(entry.data)
    });
  });
  [...addons, ...rentals, ...menuItems].forEach((entry) => {
    if (!text(entry.data?.name)) {
      throw new StarterCatalogPackError("failed-precondition", `${entry.id} needs a customer-facing name.`);
    }
    resolveStoredMinor(entry.data, "priceMinor", "price", `${entry.id} price`, {
      requireMinor: isPackOwned(entry.data)
    });
    assertPricingType(entry.data?.pricingType || entry.data?.type, entry.id);
  });
  rentals.forEach((entry) => {
    if (!Number.isFinite(Number(entry.data?.qtyPerGuests)) || Number(entry.data.qtyPerGuests) <= 0) {
      throw new StarterCatalogPackError("failed-precondition", `Rental ${entry.id} needs a positive guest quantity rule.`);
    }
  });
  categories.forEach((entry) => {
    if (!text(entry.data?.name)) {
      throw new StarterCatalogPackError("failed-precondition", `Category ${entry.id} needs a name.`);
    }
    if (!eventTypeIds.has(text(entry.data?.eventTypeId))) {
      throw new StarterCatalogPackError("failed-precondition", `Category ${entry.id} references a missing event type.`);
    }
  });
  eventTypes.forEach((entry) => {
    if (!text(entry.data?.name)) {
      throw new StarterCatalogPackError("failed-precondition", `Event type ${entry.id} needs a name.`);
    }
  });
  menuItems.forEach((entry) => {
    const category = categoriesById.get(text(entry.data?.categoryId));
    if (
      !eventTypeIds.has(text(entry.data?.eventTypeId))
      || !category
      || text(category.eventTypeId) !== text(entry.data?.eventTypeId)
    ) {
      throw new StarterCatalogPackError("failed-precondition", `Menu item ${entry.id} has an invalid menu reference.`);
    }
  });

  const requireMinorSettings = Boolean(text(settings?.starterCatalogPack?.id));
  [
    ["perMileRateMinor", "perMileRate"],
    ["longDistancePerMileRateMinor", "longDistancePerMileRate"],
    ["bartenderRateMinor", "bartenderRate"],
    ["serverRateMinor", "serverRate"],
    ["chefRateMinor", "chefRate"]
  ].forEach(([minorKey, legacyKey]) => resolveStoredMinor(
    settings,
    minorKey,
    legacyKey,
    minorKey,
    { requireMinor: requireMinorSettings }
  ));
  (settings.bartenderRateTypes || []).forEach((entry) =>
    resolveStoredMinor(
      entry,
      "rateMinor",
      "rate",
      `Bartender rate ${text(entry?.id, "unknown")}`,
      { requireMinor: requireMinorSettings }
    )
  );
  (settings.staffingRateTypes || []).forEach((entry) => {
    resolveStoredMinor(
      entry,
      "serverRateMinor",
      "serverRate",
      `Server rate ${text(entry?.id, "unknown")}`,
      { requireMinor: requireMinorSettings }
    );
    resolveStoredMinor(
      entry,
      "chefRateMinor",
      "chefRate",
      `Chef rate ${text(entry?.id, "unknown")}`,
      { requireMinor: requireMinorSettings }
    );
  });
  ["serviceFeePct", "taxRate", "depositPct"].forEach((key) => assertRatio(settings[key], key));
  if (!(settings.serviceFeeTiers || []).length || !(settings.taxRegions || []).length) {
    throw new StarterCatalogPackError("failed-precondition", "Fee tiers and tax regions must be configured.");
  }
  const serviceFeeTierIds = new Set();
  (settings.serviceFeeTiers || []).forEach((entry, index) => {
    const id = text(entry?.id);
    const minGuests = Number(entry?.minGuests);
    const maxGuests = Number(entry?.maxGuests);
    if (
      !id
      || serviceFeeTierIds.has(id)
      || !Number.isSafeInteger(minGuests)
      || !Number.isSafeInteger(maxGuests)
      || minGuests < 0
      || maxGuests < minGuests
    ) {
      throw new StarterCatalogPackError("failed-precondition", `Service fee tier ${index + 1} is invalid.`);
    }
    serviceFeeTierIds.add(id);
    assertRatio(entry?.pct, `Service fee tier ${id}`);
  });
  const taxRegionIds = new Set();
  (settings.taxRegions || []).forEach((entry, index) => {
    const id = text(entry?.id);
    if (!id || !text(entry?.name) || taxRegionIds.has(id)) {
      throw new StarterCatalogPackError("failed-precondition", `Tax region ${index + 1} is invalid.`);
    }
    taxRegionIds.add(id);
    assertRatio(entry?.rate, `Tax region ${id}`);
  });
  if (!taxRegionIds.has(text(settings.defaultTaxRegion))) {
    throw new StarterCatalogPackError("failed-precondition", "Default tax region is unavailable.");
  }
  if (
    !Number.isFinite(Number(settings.deliveryThresholdMiles))
    || Number(settings.deliveryThresholdMiles) < 0
    || !Number.isSafeInteger(Number(settings.quoteValidityDays ?? 30))
    || Number(settings.quoteValidityDays ?? 30) <= 0
  ) {
    throw new StarterCatalogPackError(
      "failed-precondition",
      "Delivery threshold and quote validity must be valid non-negative values."
    );
  }
  if (!["per_hour", "per_event_per_staff"].includes(text(settings.staffingChargeMode, "per_hour"))) {
    throw new StarterCatalogPackError("failed-precondition", "Staffing charge mode is invalid.");
  }
  if (typeof settings.staffingLaborEnabled !== "boolean") {
    throw new StarterCatalogPackError("failed-precondition", "Staffing labor setting must be confirmed.");
  }
  const bartenderTypeIds = new Set();
  (settings.bartenderRateTypes || []).forEach((entry, index) => {
    const id = text(entry?.id);
    if (!id || !text(entry?.name) || bartenderTypeIds.has(id)) {
      throw new StarterCatalogPackError("failed-precondition", `Bartender rate ${index + 1} is invalid.`);
    }
    bartenderTypeIds.add(id);
  });
  if (!bartenderTypeIds.size || !bartenderTypeIds.has(text(settings.defaultBartenderRateType))) {
    throw new StarterCatalogPackError("failed-precondition", "Default bartender rate type is unavailable.");
  }
  const staffingTypeIds = new Set();
  (settings.staffingRateTypes || []).forEach((entry, index) => {
    const id = text(entry?.id);
    if (!id || !text(entry?.name) || staffingTypeIds.has(id)) {
      throw new StarterCatalogPackError("failed-precondition", `Staffing rate ${index + 1} is invalid.`);
    }
    staffingTypeIds.add(id);
  });
  if (!staffingTypeIds.size || !staffingTypeIds.has(text(settings.defaultStaffingRateType))) {
    throw new StarterCatalogPackError("failed-precondition", "Default staffing rate type is unavailable.");
  }
  if (!(settings.seasonalProfiles || []).length) {
    throw new StarterCatalogPackError("failed-precondition", "At least one seasonal pricing profile is required.");
  }
  const seasonalProfileIds = new Set();
  (settings.seasonalProfiles || []).forEach((entry, index) => {
    const id = text(entry?.id);
    const numericKeys = [
      "startMonth",
      "startDay",
      "endMonth",
      "endDay",
      "packageMultiplier",
      "addonMultiplier",
      "rentalMultiplier"
    ];
    if (
      !id
      || !text(entry?.name)
      || seasonalProfileIds.has(id)
      || numericKeys.some((key) => !Number.isFinite(Number(entry?.[key])))
      || Number(entry.startMonth) < 1
      || Number(entry.startMonth) > 12
      || Number(entry.endMonth) < 1
      || Number(entry.endMonth) > 12
      || Number(entry.startDay) < 1
      || Number(entry.startDay) > 31
      || Number(entry.endDay) < 1
      || Number(entry.endDay) > 31
      || Number(entry.packageMultiplier) < 0
      || Number(entry.addonMultiplier) < 0
      || Number(entry.rentalMultiplier) < 0
    ) {
      throw new StarterCatalogPackError("failed-precondition", `Seasonal profile ${index + 1} is invalid.`);
    }
    seasonalProfileIds.add(id);
  });
  if (!seasonalProfileIds.has(text(settings.defaultSeasonProfile))) {
    throw new StarterCatalogPackError("failed-precondition", "Default seasonal profile is unavailable.");
  }

  const stagedPack = settings.starterCatalogPack || {};
  const referencedManifest = text(stagedPack.id)
    ? findStarterCatalogPack(stagedPack.id, stagedPack.version)
    : null;
  if (text(stagedPack.id) && !referencedManifest) {
    throw new StarterCatalogPackError(
      "failed-precondition",
      `Referenced starter manifest ${manifestKey(stagedPack.id, stagedPack.version)} is unavailable.`
    );
  }
  if (
    referencedManifest
    && text(stagedPack.manifestHash) !== hashValue(referencedManifest)
  ) {
    throw new StarterCatalogPackError(
      "failed-precondition",
      `Referenced starter manifest ${manifestKey(stagedPack.id, stagedPack.version)} changed after staging.`
    );
  }
  return {
    packages: packages.length,
    addons: addons.length,
    rentals: rentals.length,
    eventTypes: eventTypes.length,
    menuCategories: categories.length,
    menuItems: menuItems.length
  };
}

function buildCatalogMoneyMigrations({ settings = {}, collections = {}, deleteField = null } = {}) {
  const documentMigrations = [];
  const addDocumentMigration = (entry, minorKey, legacyKey, label, positive = false) => {
    const resolved = resolveStoredMinor(entry.data, minorKey, legacyKey, label, {
      positive,
      requireMinor: isPackOwned(entry.data)
    });
    if (!resolved.needsMigration) return;
    documentMigrations.push({
      ref: entry.ref,
      data: {
        [minorKey]: resolved.minor,
        ...(deleteField ? { [legacyKey]: deleteField() } : {})
      }
    });
  };
  (collections.catalogPackages || []).forEach((entry) =>
    addDocumentMigration(entry, "pppMinor", "ppp", `Package ${entry.id} price`, true)
  );
  [
    ...(collections.catalogAddons || []),
    ...(collections.catalogRentals || []),
    ...(collections.menuItems || [])
  ].forEach((entry) =>
    addDocumentMigration(entry, "priceMinor", "price", `${entry.id} price`)
  );

  const settingsPatch = {};
  [
    ["perMileRateMinor", "perMileRate"],
    ["longDistancePerMileRateMinor", "longDistancePerMileRate"],
    ["bartenderRateMinor", "bartenderRate"],
    ["serverRateMinor", "serverRate"],
    ["chefRateMinor", "chefRate"]
  ].forEach(([minorKey, legacyKey]) => {
    const resolved = resolveStoredMinor(settings, minorKey, legacyKey, minorKey, {
      requireMinor: Boolean(text(settings?.starterCatalogPack?.id))
    });
    if (!resolved.needsMigration) return;
    settingsPatch[minorKey] = resolved.minor;
    if (deleteField) settingsPatch[legacyKey] = deleteField();
  });

  const bartenderRateTypes = settings.bartenderRateTypes || [];
  if (bartenderRateTypes.some((entry) => !Number.isSafeInteger(entry?.rateMinor))) {
    settingsPatch.bartenderRateTypes = bartenderRateTypes.map((entry) => {
      const resolved = resolveStoredMinor(
        entry,
        "rateMinor",
        "rate",
        `Bartender rate ${text(entry?.id, "unknown")}`
      );
      const { rate: _legacyRate, ...rest } = entry;
      return { ...rest, rateMinor: resolved.minor };
    });
  }
  const staffingRateTypes = settings.staffingRateTypes || [];
  if (staffingRateTypes.some(
    (entry) => !Number.isSafeInteger(entry?.serverRateMinor) || !Number.isSafeInteger(entry?.chefRateMinor)
  )) {
    settingsPatch.staffingRateTypes = staffingRateTypes.map((entry) => {
      const server = resolveStoredMinor(
        entry,
        "serverRateMinor",
        "serverRate",
        `Server rate ${text(entry?.id, "unknown")}`
      );
      const chef = resolveStoredMinor(
        entry,
        "chefRateMinor",
        "chefRate",
        `Chef rate ${text(entry?.id, "unknown")}`
      );
      const { serverRate: _legacyServerRate, chefRate: _legacyChefRate, ...rest } = entry;
      return { ...rest, serverRateMinor: server.minor, chefRateMinor: chef.minor };
    });
  }
  return { documentMigrations, settingsPatch };
}

async function readCatalogTransaction(transaction, organizationRef, settingsRef) {
  const collectionRefs = Object.fromEntries(
    COLLECTION_NAMES.map((collectionName) => [collectionName, organizationRef.collection(collectionName)])
  );
  const [settingsSnap, ...collectionSnapshots] = await Promise.all([
    transaction.get(settingsRef),
    ...COLLECTION_NAMES.map((collectionName) => transaction.get(collectionRefs[collectionName]))
  ]);
  const collections = Object.fromEntries(collectionSnapshots.map((snapshot, index) => [
    COLLECTION_NAMES[index],
    snapshot.docs.map((docSnap) => ({ id: docSnap.id, ref: docSnap.ref, data: docSnap.data() || {} }))
  ]));
  return { settingsSnap, collections, collectionRefs };
}

function currentCatalogRevision(settings = {}) {
  const revision = Number(settings.catalogRevision || 0);
  return Number.isSafeInteger(revision) && revision >= 0 ? revision : 0;
}

function assertExpectedRevision(settings, expectedCatalogRevision) {
  if (!Number.isSafeInteger(expectedCatalogRevision) || expectedCatalogRevision < 0) {
    throw new StarterCatalogPackError("invalid-argument", "expectedCatalogRevision is required.");
  }
  const currentRevision = currentCatalogRevision(settings);
  if (currentRevision !== expectedCatalogRevision) {
    throw new StarterCatalogPackError(
      "aborted",
      `Catalog revision changed from ${expectedCatalogRevision} to ${currentRevision}. Reload before continuing.`,
      { expectedCatalogRevision, currentCatalogRevision: currentRevision }
    );
  }
  return currentRevision;
}

function canonicalPricingSettingValue(settings = {}, key) {
  const legacyMoneyKeys = {
    perMileRateMinor: "perMileRate",
    longDistancePerMileRateMinor: "longDistancePerMileRate",
    bartenderRateMinor: "bartenderRate",
    serverRateMinor: "serverRate",
    chefRateMinor: "chefRate"
  };
  if (legacyMoneyKeys[key]) {
    if (Number.isSafeInteger(settings[key])) return settings[key];
    if (Number.isFinite(Number(settings[legacyMoneyKeys[key]]))) {
      return Math.round(Number(settings[legacyMoneyKeys[key]]) * 100);
    }
    return UNCONFIGURED_PRICING_SETTINGS[key];
  }
  if (key === "bartenderRateTypes") {
    const source = Array.isArray(settings[key])
      ? settings[key]
      : UNCONFIGURED_PRICING_SETTINGS[key];
    return source.map((entry) => ({
      id: entry.id,
      name: entry.name,
      rateMinor: Number.isSafeInteger(entry.rateMinor)
        ? entry.rateMinor
        : Math.round(Number(entry.rate || 0) * 100)
    }));
  }
  if (key === "staffingRateTypes") {
    const source = Array.isArray(settings[key])
      ? settings[key]
      : UNCONFIGURED_PRICING_SETTINGS[key];
    return source.map((entry) => ({
      id: entry.id,
      name: entry.name,
      serverRateMinor: Number.isSafeInteger(entry.serverRateMinor)
        ? entry.serverRateMinor
        : Math.round(Number(entry.serverRate || 0) * 100),
      chefRateMinor: Number.isSafeInteger(entry.chefRateMinor)
        ? entry.chefRateMinor
        : Math.round(Number(entry.chefRate || 0) * 100)
    }));
  }
  return settings[key] === undefined
    ? UNCONFIGURED_PRICING_SETTINGS[key]
    : settings[key];
}

function assertInitialSettingsUnmodified(settings = {}) {
  const changedKeys = PACK_PRICING_SETTING_KEYS.filter((key) => {
    const currentValue = canonicalPricingSettingValue(settings, key);
    return hashValue(currentValue) !== hashValue(UNCONFIGURED_PRICING_SETTINGS[key]);
  });
  if (changedKeys.length) {
    throw new StarterCatalogPackError(
      "failed-precondition",
      "Pricing settings were already edited. A starter pack will not overwrite them.",
      { changedPricingSettingKeys: changedKeys }
    );
  }
}

function assertStagedSettingsUnmodified(settings = {}) {
  const stagedPack = settings.starterCatalogPack || {};
  const baselineHashes = stagedPack.settingsBaselineHashes || {};
  const changedKeys = PACK_PRICING_SETTING_KEYS.filter(
    (key) => !text(baselineHashes[key])
      || baselineHashes[key] !== hashValue(canonicalPricingSettingValue(settings, key))
  );
  if (changedKeys.length) {
    throw new StarterCatalogPackError(
      "failed-precondition",
      "Starter pricing settings were modified. Replacement is blocked to preserve owner changes.",
      { changedPricingSettingKeys: changedKeys }
    );
  }
}

async function applyStarterCatalogPack({
  db,
  organizationId = "",
  packId = "",
  packVersion = null,
  replaceStagedPack = false,
  expectedCatalogRevision,
  actorUid = "",
  serverTimestamp = null,
  deleteField = null,
  nowISO = new Date().toISOString()
} = {}) {
  const normalizedOrganizationId = slug(organizationId, "");
  if (!db || !normalizedOrganizationId) {
    throw new StarterCatalogPackError("invalid-argument", "organizationId is required.");
  }
  const plan = buildStarterCatalogPackDocuments(packId, { packVersion, nowISO, actorUid });
  const organizationRef = db.collection("organizations").doc(normalizedOrganizationId);
  const settingsRef = organizationRef.collection("settings").doc("config");

  return db.runTransaction(async (transaction) => {
    const { settingsSnap, collections, collectionRefs } = await readCatalogTransaction(
      transaction,
      organizationRef,
      settingsRef
    );
    if (!settingsSnap.exists) {
      throw new StarterCatalogPackError(
        "failed-precondition",
        "Organization catalog settings are missing. Repair the workspace before applying a starter pack."
      );
    }
    const currentSettings = settingsSnap.data() || {};
    const revision = assertExpectedRevision(currentSettings, expectedCatalogRevision);
    if (currentSettings.pricingSetupConfirmed === true) {
      throw new StarterCatalogPackError(
        "failed-precondition",
        "Starter packs can only be applied before pricing setup is confirmed."
      );
    }

    const currentPack = currentSettings.starterCatalogPack || {};
    const currentPackId = text(currentPack.id);
    const currentPackVersion = Number(currentPack.version || 0);
    const existingDocs = COLLECTION_NAMES.flatMap((collectionName) =>
      collections[collectionName].map((entry) => ({ ...entry, collectionName }))
    );
    const classifications = existingDocs.map((entry) => ({
      ...entry,
      state: classifyPackRecord(entry.collectionName, entry.data, currentPackId, currentPackVersion)
    }));

    if (existingDocs.length === 0 && !currentPackId) {
      assertInitialSettingsUnmodified(currentSettings);
    } else {
      if (!replaceStagedPack) {
        throw new StarterCatalogPackError(
          "failed-precondition",
          "This organization already has catalog content. Choose replacement only for an untouched staged pack."
        );
      }
      if (!currentPackId || currentPackVersion <= 0) {
        throw new StarterCatalogPackError(
          "failed-precondition",
          "Existing catalog content is not attributable to a staged starter pack."
        );
      }
      if (!findStarterCatalogPack(currentPackId, currentPackVersion)) {
        throw new StarterCatalogPackError(
          "failed-precondition",
          `Referenced starter manifest ${manifestKey(currentPackId, currentPackVersion)} is unavailable.`
        );
      }
      const customCount = classifications.filter((entry) => entry.state === "custom").length;
      const modifiedCount = classifications.filter((entry) => entry.state === "modified").length;
      if (customCount || modifiedCount) {
        throw new StarterCatalogPackError(
          "failed-precondition",
          "Replacement is blocked because the staged catalog contains custom or user-modified records.",
          { customCount, modifiedCount }
        );
      }
      assertStagedSettingsUnmodified(currentSettings);
    }

    const targetKeys = new Set(COLLECTION_NAMES.flatMap((collectionName) =>
      plan.collections[collectionName].map((entry) => `${collectionName}/${entry.id}`)
    ));
    const obsoleteDocs = existingDocs.filter(
      (entry) => !targetKeys.has(`${entry.collectionName}/${entry.id}`)
    );
    const writeCount = obsoleteDocs.length + plan.totalRecords + 1;
    if (writeCount > MAX_TRANSACTION_WRITES) {
      throw new StarterCatalogPackError(
        "resource-exhausted",
        "Starter pack replacement is too large for one safe transaction."
      );
    }

    const nextRevision = revision + 1;
    obsoleteDocs.forEach((entry) => transaction.delete(entry.ref));
    COLLECTION_NAMES.forEach((collectionName) => {
      plan.collections[collectionName].forEach((entry) => {
        transaction.set(collectionRefs[collectionName].doc(entry.id), {
          ...entry.data,
          starterPackCatalogRevision: nextRevision,
          ...(serverTimestamp ? { updatedAt: serverTimestamp() } : {})
        });
      });
    });
    transaction.set(settingsRef, {
      ...plan.settings,
      ...(deleteField ? {
        perMileRate: deleteField(),
        longDistancePerMileRate: deleteField(),
        bartenderRate: deleteField(),
        serverRate: deleteField(),
        chefRate: deleteField()
      } : {}),
      catalogRevision: nextRevision,
      starterCatalogPack: {
        ...plan.settings.starterCatalogPack,
        appliedCatalogRevision: nextRevision
      },
      pricingConfirmation: null,
      ...(serverTimestamp ? { updatedAt: serverTimestamp() } : {})
    }, { merge: true });

    return {
      ok: true,
      replaced: existingDocs.length > 0,
      organizationId: normalizedOrganizationId,
      catalogRevision: nextRevision,
      pack: plan.pack,
      counts: plan.counts
    };
  });
}

async function confirmCatalogPricing({
  db,
  organizationId = "",
  expectedCatalogRevision,
  actorUid = "",
  actorEmail = "",
  serverTimestamp = null,
  deleteField = null,
  nowISO = new Date().toISOString()
} = {}) {
  const normalizedOrganizationId = slug(organizationId, "");
  if (!db || !normalizedOrganizationId) {
    throw new StarterCatalogPackError("invalid-argument", "organizationId is required.");
  }
  const organizationRef = db.collection("organizations").doc(normalizedOrganizationId);
  const settingsRef = organizationRef.collection("settings").doc("config");
  return db.runTransaction(async (transaction) => {
    const { settingsSnap, collections } = await readCatalogTransaction(
      transaction,
      organizationRef,
      settingsRef
    );
    if (!settingsSnap.exists) {
      throw new StarterCatalogPackError("failed-precondition", "Organization catalog settings are missing.");
    }
    const settings = settingsSnap.data() || {};
    const revision = assertExpectedRevision(settings, expectedCatalogRevision);
    const counts = validateCatalogForConfirmation({ settings, collections });
    const moneyMigrations = buildCatalogMoneyMigrations({ settings, collections, deleteField });
    if (moneyMigrations.documentMigrations.length + 1 > MAX_TRANSACTION_WRITES) {
      throw new StarterCatalogPackError(
        "resource-exhausted",
        "Catalog has too many legacy money records to migrate during one safe confirmation."
      );
    }
    const pricingSettingsVersion = Math.max(0, Number(settings.pricingSettingsVersion || 0)) + 1;
    moneyMigrations.documentMigrations.forEach((migration) => {
      transaction.set(migration.ref, migration.data, { merge: true });
    });
    transaction.set(settingsRef, {
      ...moneyMigrations.settingsPatch,
      pricingSetupConfirmed: true,
      pricingSettingsVersion,
      pricingSettingsUpdatedAtISO: nowISO,
      pricingConfirmation: {
        actorUid: text(actorUid),
        actorEmail: text(actorEmail).toLowerCase(),
        confirmedAtISO: nowISO,
        confirmedCatalogRevision: revision
      },
      updatedAtISO: nowISO,
      ...(serverTimestamp ? { updatedAt: serverTimestamp() } : {})
    }, { merge: true });
    return {
      ok: true,
      organizationId: normalizedOrganizationId,
      confirmedCatalogRevision: revision,
      pricingSettingsVersion,
      counts
    };
  });
}

module.exports = {
  COLLECTION_NAMES,
  MAX_TRANSACTION_WRITES,
  PACK_PRICING_SETTING_KEYS,
  PACK_SOURCE,
  StarterCatalogPackError,
  applyStarterCatalogPack,
  buildStarterCatalogPackDocuments,
  buildCatalogMoneyMigrations,
  classifyPackRecord,
  confirmCatalogPricing,
  findStarterCatalogPack,
  getStarterCatalogPackSummaries,
  hashValue,
  manifestKey,
  recordBusinessData,
  validateCatalogForConfirmation
};
