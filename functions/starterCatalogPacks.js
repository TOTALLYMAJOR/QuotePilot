const { createHash } = require("node:crypto");
const starterCatalogPackData = require("./data/starterCatalogPacks.json");

const PACK_SOURCE = "starter-catalog-pack";
const MAX_TRANSACTION_WRITES = 450;
const MAX_CATALOG_MONEY_MINOR = 100_000_000;
const MAX_PACKAGE_INCLUSIONS_PER_TYPE = 100;
const PACKAGE_INCLUSION_KEYS = Object.freeze([
  "includedMenuItemIds",
  "includedAddonIds",
  "includedRentalIds"
]);
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
  "defaultSeasonProfile",
  "verticalPack",
  "eventTemplates",
  "configurationRules"
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

function materializeStarterCatalogPacks() {
  const manifests = (starterCatalogPackData.packs || []).map((pack) => ({ ...pack }));
  const byKey = new Map(manifests.map((pack) => [manifestKey(pack.id, pack.version), pack]));
  const inclusionVersions = [...(starterCatalogPackData.packageInclusionVersions || [])]
    .sort((left, right) => Number(left.version || 0) - Number(right.version || 0));

  inclusionVersions.forEach((version) => {
    const base = byKey.get(manifestKey(version.id, version.baseVersion));
    if (!base) {
      throw new StarterCatalogPackError(
        "failed-precondition",
        `Starter pack base manifest ${manifestKey(version.id, version.baseVersion)} is unavailable.`
      );
    }
    const inclusionByPackage = version.packages || {};
    const next = {
      ...base,
      version: Number(version.version || 0),
      packages: (base.packages || []).map((item) => {
        const inclusion = inclusionByPackage[item.id];
        if (!inclusion) {
          throw new StarterCatalogPackError(
            "failed-precondition",
            `Starter pack ${manifestKey(version.id, version.version)} is missing inclusions for package ${item.id}.`
          );
        }
        return {
          ...item,
          includedMenuItemIds: [...(inclusion.includedMenuItemIds || [])],
          includedAddonIds: [...(inclusion.includedAddonIds || [])],
          includedRentalIds: [...(inclusion.includedRentalIds || [])]
        };
      })
    };
    const key = manifestKey(next.id, next.version);
    if (!next.version || byKey.has(key)) {
      throw new StarterCatalogPackError(
        "failed-precondition",
        `Starter pack manifest ${key} is duplicated or invalid.`
      );
    }
    manifests.push(next);
    byKey.set(key, next);
  });
  return manifests;
}

const STARTER_CATALOG_PACK_MANIFESTS = Object.freeze(materializeStarterCatalogPacks());

function findStarterCatalogPack(packId = "", packVersion = null) {
  const normalizedPackId = slug(packId, "");
  const candidates = STARTER_CATALOG_PACK_MANIFESTS
    .filter((pack) => pack.id === normalizedPackId)
    .sort((left, right) => Number(right.version || 0) - Number(left.version || 0));
  if (packVersion === null || packVersion === undefined || packVersion === "") {
    return candidates[0] || null;
  }
  return candidates.find((pack) => Number(pack.version || 0) === Number(packVersion)) || null;
}

function getStarterCatalogPackSummaries() {
  const latestById = new Map();
  STARTER_CATALOG_PACK_MANIFESTS.forEach((pack) => {
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
    const businessData = { name: text(data.name), pppMinor: Number(data.pppMinor) };
    if (PACKAGE_INCLUSION_KEYS.some((key) => Object.prototype.hasOwnProperty.call(data, key))) {
      PACKAGE_INCLUSION_KEYS.forEach((key) => {
        businessData[key] = Array.isArray(data[key])
          ? data[key].map((value) => text(value))
          : data[key];
      });
    }
    return businessData;
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

function buildCommercialStarterConfiguration(pack, collections) {
  const eventTypeId = collections.eventTypes[0]?.id || "";
  const eventTemplates = collections.catalogPackages.map((entry) => ({
    id: `starter-${pack.id}-${entry.id}`,
    name: `${entry.data.name} starting point`,
    templateVersion: "commercial-template-v1",
    verticalType: "catering",
    eventTypeId,
    pkg: entry.id,
    addons: [...(entry.data.includedAddonIds || [])],
    rentals: [...(entry.data.includedRentalIds || [])],
    menuItems: [...(entry.data.includedMenuItemIds || [])],
    provenance: {
      source: PACK_SOURCE,
      starterPackId: pack.id,
      starterPackVersion: Number(pack.version || 1)
    }
  }));
  const configurationRules = collections.catalogPackages.length
    ? [{
        id: `starter-${pack.id}-offer-review`,
        ruleVersion: "configuration-rule-v1",
        type: "recommendation",
        conditions: [{ path: "event.demandQuantity", operator: "gte", value: 0 }],
        effect: {
          operator: "recommend",
          target: "selection.offerRef",
          value: collections.catalogPackages[0].id
        },
        reason: "Disabled starter example. Review the business policy before enabling any recommendation.",
        severity: "info",
        verticalScope: "catering",
        enabled: false,
        provenance: {
          source: PACK_SOURCE,
          starterPackId: pack.id,
          starterPackVersion: Number(pack.version || 1)
        }
      }]
    : [];
  return {
    verticalPack: {
      id: "catering",
      version: "vertical-pack-v1",
      starterPackId: pack.id,
      starterPackVersion: Number(pack.version || 1),
      offerRefs: collections.catalogPackages.map((entry) => entry.id),
      templateRefs: eventTemplates.map((template) => template.id),
      ruleRefs: configurationRules.map((rule) => rule.id),
      pricingPolicyRefs: ["catering-pricing-v2"],
      resourcePolicyRefs: ["catering-staffing"]
    },
    eventTemplates,
    configurationRules
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
    ...pack.settings,
    ...buildCommercialStarterConfiguration(pack, collections)
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
  // Package activity was not part of the original baseline hash schema. Keep
  // legacy staged manifests readable, but treat an explicit owner
  // deactivation as divergence so replacement can never restore it silently.
  if (collectionName === "catalogPackages" && docData?.active === false) {
    return "modified";
  }
  const baselineHash = text(docData?.starterPackBaselineHash);
  if (!baselineHash) return "modified";
  return baselineHash === hashValue(recordBusinessData(collectionName, docData))
    ? "generated"
    : "modified";
}

function assertIntegerMinor(value, label, { positive = false } = {}) {
  if (
    !Number.isSafeInteger(value)
    || value < 0
    || value > MAX_CATALOG_MONEY_MINOR
    || (positive && value <= 0)
  ) {
    throw new StarterCatalogPackError(
      "failed-precondition",
      `${label} must be stored as ${positive ? "a positive" : "a non-negative"} integer minor-unit value no greater than 100000000.`
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

function validatePackageInclusionIds(packageEntry, {
  addonById = new Map(),
  rentalById = new Map(),
  menuItemById = new Map()
} = {}) {
  const packageData = packageEntry?.data || {};
  const referenceMaps = {
    includedMenuItemIds: { records: menuItemById, label: "menu item" },
    includedAddonIds: { records: addonById, label: "add-on" },
    includedRentalIds: { records: rentalById, label: "rental" }
  };
  const result = {};

  PACKAGE_INCLUSION_KEYS.forEach((key) => {
    if (!Object.prototype.hasOwnProperty.call(packageData, key)) {
      result[key] = [];
      return;
    }
    if (!Array.isArray(packageData[key]) || packageData[key].length > MAX_PACKAGE_INCLUSIONS_PER_TYPE) {
      throw new StarterCatalogPackError(
        "failed-precondition",
        `Package ${packageEntry.id} ${key} must be an array of at most ${MAX_PACKAGE_INCLUSIONS_PER_TYPE} stable ids.`
      );
    }
    const seen = new Set();
    const normalized = packageData[key].map((value) => text(value));
    normalized.forEach((id) => {
      if (!id || !/^[A-Za-z0-9][A-Za-z0-9_-]{0,199}$/.test(id) || seen.has(id)) {
        throw new StarterCatalogPackError(
          "failed-precondition",
          `Package ${packageEntry.id} has an invalid or duplicate ${referenceMaps[key].label} inclusion.`
        );
      }
      seen.add(id);
      const referenced = referenceMaps[key].records.get(id);
      if (!referenced || referenced.data?.active === false) {
        throw new StarterCatalogPackError(
          "failed-precondition",
          `Package ${packageEntry.id} includes unavailable ${referenceMaps[key].label} ${id}.`
        );
      }
    });
    result[key] = normalized;
  });
  return result;
}

function assertAvailableReference(records, id, label, ownerLabel) {
  const referenced = records.get(id);
  if (!referenced || referenced.data?.active === false) {
    throw new StarterCatalogPackError(
      "failed-precondition",
      `${ownerLabel} references unavailable ${label} ${id}.`
    );
  }
  return referenced;
}

function validateReferenceList(values, {
  records,
  label,
  ownerLabel
}) {
  if (!Array.isArray(values) || values.length > MAX_PACKAGE_INCLUSIONS_PER_TYPE) {
    throw new StarterCatalogPackError(
      "failed-precondition",
      `${ownerLabel} ${label} references must be an array of at most ${MAX_PACKAGE_INCLUSIONS_PER_TYPE} stable ids.`
    );
  }
  const seen = new Set();
  return values.map((value) => {
    const id = text(value);
    if (!id || !/^[A-Za-z0-9][A-Za-z0-9_-]{0,199}$/.test(id) || seen.has(id)) {
      throw new StarterCatalogPackError(
        "failed-precondition",
        `${ownerLabel} has an invalid or duplicate ${label} reference.`
      );
    }
    seen.add(id);
    assertAvailableReference(records, id, label, ownerLabel);
    return id;
  });
}

function validateGuidedSellingAndEventTemplateReferences({
  settings,
  packageById,
  addonById,
  rentalById,
  menuItemById,
  eventTypeIds,
  taxRegionIds,
  seasonalProfileIds,
  bartenderTypeIds,
  staffingTypeIds
}) {
  const upsellRules = settings.upsellRules ?? [];
  if (!Array.isArray(upsellRules) || upsellRules.length > 100) {
    throw new StarterCatalogPackError(
      "failed-precondition",
      "Guided-selling rules must be an array of at most 100 entries."
    );
  }
  const upsellRuleIds = new Set();
  upsellRules.forEach((rule, index) => {
    if (!rule || typeof rule !== "object" || Array.isArray(rule)) {
      throw new StarterCatalogPackError("failed-precondition", `Guided-selling rule ${index + 1} is invalid.`);
    }
    const id = text(rule.id);
    const kind = text(rule.kind).toLowerCase();
    const targetId = text(rule.targetId);
    const ownerLabel = `Guided-selling rule ${id || index + 1}`;
    if (!id || upsellRuleIds.has(id) || !["addon", "rental", "package"].includes(kind)) {
      throw new StarterCatalogPackError("failed-precondition", `${ownerLabel} has an invalid id or type.`);
    }
    upsellRuleIds.add(id);
    if (!targetId && kind !== "package") {
      throw new StarterCatalogPackError("failed-precondition", `${ownerLabel} needs a target ${kind}.`);
    }
    if (!targetId) return;
    const reference = kind === "addon"
      ? { records: addonById, label: "add-on" }
      : kind === "rental"
        ? { records: rentalById, label: "rental" }
        : { records: packageById, label: "package" };
    assertAvailableReference(reference.records, targetId, reference.label, ownerLabel);
  });

  const eventTemplates = settings.eventTemplates ?? [];
  if (!Array.isArray(eventTemplates) || eventTemplates.length > 100) {
    throw new StarterCatalogPackError(
      "failed-precondition",
      "Event templates must be an array of at most 100 entries."
    );
  }
  const templateIds = new Set();
  eventTemplates.forEach((template, index) => {
    if (!template || typeof template !== "object" || Array.isArray(template)) {
      throw new StarterCatalogPackError("failed-precondition", `Event template ${index + 1} is invalid.`);
    }
    const id = text(template.id);
    const ownerLabel = `Event template ${id || index + 1}`;
    if (!id || templateIds.has(id)) {
      throw new StarterCatalogPackError("failed-precondition", `${ownerLabel} has an invalid or duplicate id.`);
    }
    templateIds.add(id);

    const packageId = text(template.pkg);
    if (!packageId) {
      throw new StarterCatalogPackError("failed-precondition", `${ownerLabel} needs a package reference.`);
    }
    assertAvailableReference(packageById, packageId, "package", ownerLabel);

    validateReferenceList(template.addons ?? [], {
      records: addonById,
      label: "add-on",
      ownerLabel
    });
    validateReferenceList(template.rentals ?? [], {
      records: rentalById,
      label: "rental",
      ownerLabel
    });
    const referencedMenuItemIds = validateReferenceList(template.menuItems ?? [], {
      records: menuItemById,
      label: "menu item",
      ownerLabel
    });

    const explicitEventTypeId = text(template.eventTypeId);
    const resolvedEventTypeId = explicitEventTypeId || id;
    if (!eventTypeIds.has(resolvedEventTypeId)) {
      throw new StarterCatalogPackError(
        "failed-precondition",
        `${ownerLabel} references unavailable event type ${resolvedEventTypeId}.`
      );
    }
    if (
      resolvedEventTypeId
      && referencedMenuItemIds.some(
        (menuItemId) => text(menuItemById.get(menuItemId)?.data?.eventTypeId) !== resolvedEventTypeId
      )
    ) {
      throw new StarterCatalogPackError(
        "failed-precondition",
        `${ownerLabel} includes a menu item from another event type.`
      );
    }

    const taxRegionId = text(template.taxRegion);
    if (taxRegionId && !taxRegionIds.has(taxRegionId)) {
      throw new StarterCatalogPackError(
        "failed-precondition",
        `${ownerLabel} references unavailable tax region ${taxRegionId}.`
      );
    }
    const seasonalProfileId = text(template.seasonProfileId);
    if (
      seasonalProfileId
      && seasonalProfileId !== "auto"
      && !seasonalProfileIds.has(seasonalProfileId)
    ) {
      throw new StarterCatalogPackError(
        "failed-precondition",
        `${ownerLabel} references unavailable seasonal profile ${seasonalProfileId}.`
      );
    }
    const bartenderRateTypeId = text(template.bartenderRateTypeId);
    if (bartenderRateTypeId && !bartenderTypeIds.has(bartenderRateTypeId)) {
      throw new StarterCatalogPackError(
        "failed-precondition",
        `${ownerLabel} references unavailable bartender rate ${bartenderRateTypeId}.`
      );
    }
    const staffingRateTypeId = text(template.staffingRateTypeId);
    if (staffingRateTypeId && !staffingTypeIds.has(staffingRateTypeId)) {
      throw new StarterCatalogPackError(
        "failed-precondition",
        `${ownerLabel} references unavailable staffing rate ${staffingRateTypeId}.`
      );
    }
  });
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
  if (!categories.length) {
    throw new StarterCatalogPackError("failed-precondition", "Add at least one menu category before confirming pricing.");
  }
  if (!menuItems.length) {
    throw new StarterCatalogPackError("failed-precondition", "Add at least one menu item before confirming pricing.");
  }
  const eventTypeIds = new Set(eventTypes.map((entry) => entry.id));
  const categoriesById = new Map(categories.map((entry) => [entry.id, entry.data || {}]));
  const packageById = new Map(packages.map((entry) => [entry.id, entry]));
  const addonById = new Map(addons.map((entry) => [entry.id, entry]));
  const rentalById = new Map(rentals.map((entry) => [entry.id, entry]));
  const menuItemById = new Map(menuItems.map((entry) => [entry.id, entry]));
  packages.forEach((entry) => {
    if (!text(entry.data?.name) || text(entry.data?.name).toLowerCase() === "new package") {
      throw new StarterCatalogPackError("failed-precondition", `Package ${entry.id} needs a customer-facing name.`);
    }
    resolveStoredMinor(entry.data, "pppMinor", "ppp", `Package ${entry.id} price`, {
      positive: true,
      requireMinor: isPackOwned(entry.data)
    });
    validatePackageInclusionIds(entry, { addonById, rentalById, menuItemById });
  });
  if (!packages.some((entry) => entry.data?.active !== false)) {
    throw new StarterCatalogPackError(
      "failed-precondition",
      "At least one active package is required before confirming pricing."
    );
  }
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

  [
    ["serviceFeeTiers", "Service fee tiers"],
    ["taxRegions", "Tax regions"],
    ["bartenderRateTypes", "Bartender rate types"],
    ["staffingRateTypes", "Staffing rate types"],
    ["seasonalProfiles", "Seasonal pricing profiles"]
  ].forEach(([key, label]) => {
    if (!Array.isArray(settings[key])) {
      throw new StarterCatalogPackError(
        "failed-precondition",
        `${label} must be configured as an array before confirming pricing.`
      );
    }
  });

  const requireMinorSettings = Boolean(text(settings?.starterCatalogPack?.id))
    && text(settings?.starterCatalogPack?.recoveryMode) !== "additive_missing_menu";
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
  const defaultSeasonProfile = text(settings.defaultSeasonProfile);
  if (defaultSeasonProfile !== "auto" && !seasonalProfileIds.has(defaultSeasonProfile)) {
    throw new StarterCatalogPackError("failed-precondition", "Default seasonal profile is unavailable.");
  }

  validateGuidedSellingAndEventTemplateReferences({
    settings,
    packageById,
    addonById,
    rentalById,
    menuItemById,
    eventTypeIds: new Set(
      eventTypes.filter((entry) => entry.data?.active !== false).map((entry) => entry.id)
    ),
    taxRegionIds: new Set(
      (settings.taxRegions || []).filter((entry) => entry?.active !== false).map((entry) => text(entry?.id))
    ),
    seasonalProfileIds: new Set(
      (settings.seasonalProfiles || [])
        .filter((entry) => entry?.active !== false)
        .map((entry) => text(entry?.id))
    ),
    bartenderTypeIds: new Set(
      (settings.bartenderRateTypes || [])
        .filter((entry) => entry?.active !== false)
        .map((entry) => text(entry?.id))
    ),
    staffingTypeIds: new Set(
      (settings.staffingRateTypes || [])
        .filter((entry) => entry?.active !== false)
        .map((entry) => text(entry?.id))
    )
  });

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
    if (resolved.needsMigration) settingsPatch[minorKey] = resolved.minor;
    if (deleteField && Object.prototype.hasOwnProperty.call(settings, legacyKey)) {
      settingsPatch[legacyKey] = deleteField();
    }
  });

  const bartenderRateTypes = settings.bartenderRateTypes || [];
  if (bartenderRateTypes.some((entry) => (
    !Number.isSafeInteger(entry?.rateMinor)
    || Object.prototype.hasOwnProperty.call(entry || {}, "rate")
  ))) {
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
    (entry) => (
      !Number.isSafeInteger(entry?.serverRateMinor)
      || !Number.isSafeInteger(entry?.chefRateMinor)
      || Object.prototype.hasOwnProperty.call(entry || {}, "serverRate")
      || Object.prototype.hasOwnProperty.call(entry || {}, "chefRate")
    )
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
    const confirmedMissingMenuRecovery = currentSettings.pricingSetupConfirmed === true
      && replaceStagedPack === true;
    if (currentSettings.pricingSetupConfirmed === true && !confirmedMissingMenuRecovery) {
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

    if (confirmedMissingMenuRecovery) {
      if (collections.menuCategories.length > 0 || collections.menuItems.length > 0) {
        throw new StarterCatalogPackError(
          "failed-precondition",
          "Confirmed-catalog recovery is available only when the organization has no menu categories or menu items."
        );
      }

      const existingKeys = new Set(
        existingDocs.map((entry) => `${entry.collectionName}/${entry.id}`)
      );
      const recoveryDocuments = COLLECTION_NAMES.flatMap((collectionName) => (
        plan.collections[collectionName]
          .filter((entry) => !existingKeys.has(`${collectionName}/${entry.id}`))
          .map((entry) => ({ ...entry, collectionName }))
      ));
      const writeCount = recoveryDocuments.length + 1;
      if (writeCount > MAX_TRANSACTION_WRITES) {
        throw new StarterCatalogPackError(
          "resource-exhausted",
          "Starter pack recovery is too large for one safe transaction."
        );
      }

      const nextRevision = revision + 1;
      recoveryDocuments.forEach((entry) => {
        transaction.set(collectionRefs[entry.collectionName].doc(entry.id), {
          ...entry.data,
          starterPackCatalogRevision: nextRevision,
          ...(serverTimestamp ? { updatedAt: serverTimestamp() } : {})
        });
      });
      transaction.set(settingsRef, {
        catalogRevision: nextRevision,
        pricingSetupConfirmed: false,
        pricingConfirmation: null,
        starterCatalogPack: {
          ...plan.settings.starterCatalogPack,
          appliedCatalogRevision: nextRevision,
          recoveryMode: "additive_missing_menu",
          replacementBlocked: true
        },
        updatedAtISO: nowISO,
        ...(serverTimestamp ? { updatedAt: serverTimestamp() } : {})
      }, { merge: true });

      const createdCounts = COLLECTION_NAMES.reduce((counts, collectionName) => ({
        ...counts,
        [collectionName]: recoveryDocuments.filter(
          (entry) => entry.collectionName === collectionName
        ).length
      }), {});
      return {
        ok: true,
        recoveredMissingMenu: true,
        replaced: false,
        preservedExistingRecords: existingDocs.length,
        organizationId: normalizedOrganizationId,
        catalogRevision: nextRevision,
        pack: plan.pack,
        counts: createdCounts
      };
    }

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
      const currentPlan = buildStarterCatalogPackDocuments(currentPackId, {
        packVersion: currentPackVersion,
        nowISO,
        actorUid
      });
      const existingKeys = new Set(existingDocs.map(
        (entry) => `${entry.collectionName}/${entry.id}`
      ));
      const missingGeneratedKeys = COLLECTION_NAMES.flatMap((collectionName) => (
        currentPlan.collections[collectionName]
          .map((entry) => `${collectionName}/${entry.id}`)
          .filter((key) => !existingKeys.has(key))
      ));
      const customCount = classifications.filter((entry) => entry.state === "custom").length;
      const modifiedCount = classifications.filter((entry) => entry.state === "modified").length;
      if (customCount || modifiedCount || missingGeneratedKeys.length) {
        throw new StarterCatalogPackError(
          "failed-precondition",
          "Replacement is blocked because the staged catalog contains custom, user-modified, or removed pack records.",
          {
            customCount,
            modifiedCount,
            missingGeneratedCount: missingGeneratedKeys.length,
            missingGeneratedKeys: missingGeneratedKeys.slice(0, 25)
          }
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
  const normalizedActorUid = text(actorUid);
  const normalizedActorEmail = text(actorEmail).toLowerCase();
  const parsedConfirmationTime = Date.parse(nowISO);
  const hasExactConfirmationTime = Number.isFinite(parsedConfirmationTime)
    && new Date(parsedConfirmationTime).toISOString() === nowISO;
  if (
    !db
    || !normalizedOrganizationId
    || !normalizedActorUid
    || !normalizedActorEmail
    || !hasExactConfirmationTime
  ) {
    throw new StarterCatalogPackError(
      "invalid-argument",
      "organizationId, confirming actor, and an exact ISO confirmation timestamp are required."
    );
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
        actorUid: normalizedActorUid,
        actorEmail: normalizedActorEmail,
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

async function mutateManagedMenuItemAvailability({
  db,
  organizationId = "",
  itemId = "",
  action = "",
  item = {},
  expectedCatalogRevision,
  actorUid = "",
  serverTimestamp = null,
  nowISO = new Date().toISOString()
} = {}) {
  const normalizedOrganizationId = slug(organizationId, "");
  const normalizedItemId = text(itemId);
  const normalizedAction = text(action).toLowerCase();
  if (!db || !normalizedOrganizationId || !normalizedItemId) {
    throw new StarterCatalogPackError(
      "invalid-argument",
      "organizationId and itemId are required."
    );
  }
  if (!["deactivate", "delete"].includes(normalizedAction)) {
    throw new StarterCatalogPackError(
      "invalid-argument",
      "Managed menu action must be deactivate or delete."
    );
  }

  const organizationRef = db.collection("organizations").doc(normalizedOrganizationId);
  const settingsRef = organizationRef.collection("settings").doc("config");
  const packagesRef = organizationRef.collection("catalogPackages");
  const itemRef = organizationRef.collection("menuItems").doc(normalizedItemId);
  return db.runTransaction(async (transaction) => {
    const [settingsSnap, packageSnapshot, itemSnapshot] = await Promise.all([
      transaction.get(settingsRef),
      transaction.get(packagesRef),
      transaction.get(itemRef)
    ]);
    if (!settingsSnap.exists) {
      throw new StarterCatalogPackError("failed-precondition", "Organization catalog settings are missing.");
    }
    const settings = settingsSnap.data() || {};
    const revision = assertExpectedRevision(settings, expectedCatalogRevision);
    if (!itemSnapshot.exists) {
      throw new StarterCatalogPackError("not-found", `Menu item ${normalizedItemId} was not found.`);
    }

    const malformedPackage = packageSnapshot.docs.find((snapshot) => {
      const packageData = snapshot.data() || {};
      return Object.prototype.hasOwnProperty.call(packageData, "includedMenuItemIds")
        && !Array.isArray(packageData.includedMenuItemIds);
    });
    if (malformedPackage) {
      throw new StarterCatalogPackError(
        "failed-precondition",
        `Package ${malformedPackage.id} has malformed menu item dependencies. Repair the package before changing menu availability.`,
        { itemId: normalizedItemId, malformedPackageId: malformedPackage.id }
      );
    }
    if (Object.prototype.hasOwnProperty.call(settings, "eventTemplates")
      && !Array.isArray(settings.eventTemplates)) {
      throw new StarterCatalogPackError(
        "failed-precondition",
        "Event template dependencies must be configured as an array before changing menu availability.",
        { itemId: normalizedItemId, malformedSetting: "eventTemplates" }
      );
    }
    const malformedTemplateIndex = (settings.eventTemplates || []).findIndex((template) => (
      template
      && Object.prototype.hasOwnProperty.call(template, "menuItems")
      && !Array.isArray(template.menuItems)
    ));
    if (malformedTemplateIndex >= 0) {
      throw new StarterCatalogPackError(
        "failed-precondition",
        `Event template ${text(settings.eventTemplates[malformedTemplateIndex]?.id, `template-${malformedTemplateIndex + 1}`)} has malformed menu item dependencies.`,
        { itemId: normalizedItemId, malformedTemplateIndex }
      );
    }

    const packageReferences = packageSnapshot.docs
      .filter((snapshot) => (
        Array.isArray(snapshot.data()?.includedMenuItemIds)
        && snapshot.data().includedMenuItemIds.map((id) => text(id)).includes(normalizedItemId)
      ))
      .map((snapshot) => ({ id: snapshot.id, name: text(snapshot.data()?.name, snapshot.id) }));
    const eventTemplateReferences = (Array.isArray(settings.eventTemplates) ? settings.eventTemplates : [])
      .filter((template) => (
        Array.isArray(template?.menuItems)
        && template.menuItems.map((id) => text(id)).includes(normalizedItemId)
      ))
      .map((template, index) => ({
        id: text(template?.id, `template-${index + 1}`),
        name: text(template?.name, text(template?.id, `Template ${index + 1}`))
      }));
    if (packageReferences.length || eventTemplateReferences.length) {
      const dependencies = [
        packageReferences.length
          ? `packages: ${packageReferences.map((entry) => entry.name).join(", ")}`
          : "",
        eventTemplateReferences.length
          ? `event templates: ${eventTemplateReferences.map((entry) => entry.name).join(", ")}`
          : ""
      ].filter(Boolean).join("; ");
      throw new StarterCatalogPackError(
        "failed-precondition",
        `Remove menu item ${normalizedItemId} from ${dependencies} and confirm that catalog revision before ${normalizedAction === "delete" ? "deleting" : "deactivating"} it.`,
        {
          itemId: normalizedItemId,
          packageReferences,
          eventTemplateReferences
        }
      );
    }

    if (normalizedAction === "delete") {
      transaction.delete(itemRef);
    } else {
      const name = text(item?.name, text(itemSnapshot.data()?.name));
      const priceMinor = Object.prototype.hasOwnProperty.call(item || {}, "priceMinor")
        ? Number(item.priceMinor)
        : resolveStoredMinor(
            itemSnapshot.data() || {},
            "priceMinor",
            "price",
            `Menu item ${normalizedItemId} price`
          ).minor;
      const pricingType = assertPricingType(
        item?.pricingType || item?.type || itemSnapshot.data()?.pricingType || itemSnapshot.data()?.type,
        `Menu item ${normalizedItemId}`
      );
      if (!name || !Number.isSafeInteger(priceMinor) || priceMinor < 0) {
        throw new StarterCatalogPackError(
          "invalid-argument",
          `Menu item ${normalizedItemId} needs a name and a non-negative integer minor-unit price.`
        );
      }
      transaction.set(itemRef, {
        name,
        priceMinor,
        pricingType,
        type: pricingType,
        active: false,
        updatedAtISO: nowISO,
        updatedByUid: text(actorUid),
        ...(serverTimestamp ? { updatedAt: serverTimestamp() } : {})
      }, { merge: true });
    }

    const nextRevision = revision + 1;
    const settingsPatch = {
      catalogRevision: nextRevision,
      pricingSetupConfirmed: false,
      pricingConfirmation: null,
      updatedAtISO: nowISO,
      ...(serverTimestamp ? { updatedAt: serverTimestamp() } : {})
    };
    transaction.set(settingsRef, settingsPatch, { merge: true });
    return {
      ok: true,
      action: normalizedAction,
      itemId: normalizedItemId,
      organizationId: normalizedOrganizationId,
      catalogRevision: nextRevision,
      catalogSettings: settingsPatch
    };
  });
}

module.exports = {
  COLLECTION_NAMES,
  MAX_TRANSACTION_WRITES,
  MAX_PACKAGE_INCLUSIONS_PER_TYPE,
  PACKAGE_INCLUSION_KEYS,
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
  mutateManagedMenuItemAvailability,
  recordBusinessData,
  validatePackageInclusionIds,
  validateCatalogForConfirmation
};
