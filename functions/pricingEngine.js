const PRICING_VERSION = "pricing-v1";
const PRICING_AUTHORITY = "server_authoritative";
const PRICING_MODES = new Set(["per_person", "per_item", "per_event"]);
const STAFFING_CHARGE_MODES = new Set(["per_hour", "per_event_per_staff"]);
const MAX_RATE_MIX_CSV_LENGTH = 300;

const DEFAULT_SERVICE_FEE_TIERS = [
  { id: "tier-small", minGuests: 0, maxGuests: 99, pct: 0.2 },
  { id: "tier-mid", minGuests: 100, maxGuests: 249, pct: 0.18 },
  { id: "tier-large", minGuests: 250, maxGuests: 9999, pct: 0.16 }
];

const DEFAULT_TAX_REGIONS = [
  { id: "local", name: "Local", rate: 0.1 },
  { id: "reduced", name: "Reduced District", rate: 0.085 },
  { id: "out_of_state", name: "Out of State", rate: 0 }
];

const DEFAULT_SEASONAL_PROFILES = [
  {
    id: "standard",
    name: "Standard",
    startMonth: 1,
    startDay: 1,
    endMonth: 12,
    endDay: 31,
    packageMultiplier: 1,
    addonMultiplier: 1,
    rentalMultiplier: 1
  },
  {
    id: "summer_peak",
    name: "Summer Peak",
    startMonth: 5,
    startDay: 20,
    endMonth: 9,
    endDay: 5,
    packageMultiplier: 1.04,
    addonMultiplier: 1.03,
    rentalMultiplier: 1.02
  },
  {
    id: "holiday_peak",
    name: "Holiday Peak",
    startMonth: 11,
    startDay: 15,
    endMonth: 1,
    endDay: 7,
    packageMultiplier: 1.08,
    addonMultiplier: 1.05,
    rentalMultiplier: 1.04
  }
];

const DEFAULT_BARTENDER_RATE_TYPES = [
  { id: "standard", name: "Standard Bartender", rate: 30 },
  { id: "premium", name: "Premium Bartender", rate: 40 }
];

const DEFAULT_STAFFING_RATE_TYPES = [
  { id: "standard", name: "Standard Staffing", serverRate: 22, chefRate: 28 },
  { id: "senior", name: "Senior Staffing", serverRate: 26, chefRate: 34 }
];

const DEFAULT_PRICING_SETTINGS = {
  perMileRate: 0.7,
  longDistancePerMileRate: 1.1,
  deliveryThresholdMiles: 30,
  bartenderRate: 30,
  serverRate: 22,
  chefRate: 28,
  staffingChargeMode: "per_hour",
  staffingLaborEnabled: true,
  serviceFeePct: 0.2,
  serviceFeeTiers: DEFAULT_SERVICE_FEE_TIERS,
  taxRate: 0.1,
  taxRegions: DEFAULT_TAX_REGIONS,
  defaultTaxRegion: "local",
  depositPct: 0.3,
  seasonalProfiles: DEFAULT_SEASONAL_PROFILES,
  defaultSeasonProfile: "auto",
  bartenderRateTypes: DEFAULT_BARTENDER_RATE_TYPES,
  defaultBartenderRateType: "standard",
  staffingRateTypes: DEFAULT_STAFFING_RATE_TYPES,
  defaultStaffingRateType: "standard",
  menuSections: [],
  pricingSettingsVersion: 0,
  pricingSettingsUpdatedAtISO: ""
};

class PricingEngineError extends Error {
  constructor(code, message) {
    super(message);
    this.name = "PricingEngineError";
    this.code = code || "invalid-argument";
  }
}

function toText(value, fallback = "") {
  const text = String(value ?? "").trim();
  return text || fallback;
}

function toLowerText(value, fallback = "") {
  return toText(value, fallback).toLowerCase();
}

function toNumber(value, fallback = 0) {
  const n = Number(value);
  return Number.isFinite(n) ? n : fallback;
}

function fromMinorUnits(value, fallback = 0) {
  const minor = Number(value);
  return Number.isSafeInteger(minor) ? minor / 100 : fallback;
}

function moneyValue(source = {}, minorKey, legacyKey, fallback = 0) {
  return Object.prototype.hasOwnProperty.call(source || {}, minorKey)
    ? fromMinorUnits(source[minorKey], fallback)
    : toNumber(source?.[legacyKey], fallback);
}

function toInt(value, fallback = 0) {
  return Math.round(toNumber(value, fallback));
}

function toOptionalRate(value) {
  if (value === null || value === undefined) return null;
  const text = String(value).trim();
  if (!text) return null;
  const n = Number(text);
  if (!Number.isFinite(n) || n < 0) return null;
  return n;
}

function normalizeISO(value, fallback = "") {
  const text = toText(value);
  if (!text) return fallback;
  const parsed = new Date(text);
  return Number.isNaN(parsed.getTime()) ? fallback : parsed.toISOString();
}

function normalizeOrganizationId(value) {
  const raw = toLowerText(value);
  if (!raw) return "";
  return raw
    .replace(/[^\w-]+/g, "-")
    .replace(/-{2,}/g, "-")
    .replace(/^-|-$/g, "");
}

function normalizePricingType(value, fallback = "per_event") {
  const raw = toLowerText(value, fallback);
  return PRICING_MODES.has(raw) ? raw : fallback;
}

function normalizeAddonStaffRole(value) {
  const raw = toLowerText(value);
  if (raw === "server" || raw === "chef" || raw === "bartender") return raw;
  return "";
}

function resolveAddonStaffRole(item = {}) {
  const hasExplicitField = item && Object.prototype.hasOwnProperty.call(item, "staffRole");
  const explicit = normalizeAddonStaffRole(item?.staffRole);
  if (explicit) return explicit;
  if (hasExplicitField) return "";

  const source = `${toText(item?.id)} ${toText(item?.name)}`.trim().toLowerCase();
  if (!source) return "";
  if (source.includes("bartender") || source.includes("bar tender")) return "bartender";
  if (source.includes("chef")) return "chef";
  if (source.includes("server") || source.includes("event staff")) return "server";
  return "";
}

function addonSupportsQuantity(item = {}, pricingMode = "per_event") {
  if (pricingMode === "per_item") return true;
  if (pricingMode === "per_event" && resolveAddonStaffRole(item)) return true;
  return false;
}

function normalizeStaffingChargeMode(value, fallback = "per_hour") {
  const raw = toLowerText(value, fallback);
  return STAFFING_CHARGE_MODES.has(raw) ? raw : fallback;
}

function normalizeQuantityMap(input) {
  if (!input || typeof input !== "object") return {};
  return Object.entries(input).reduce((acc, [rawKey, rawValue]) => {
    const key = toText(rawKey);
    if (!key) return acc;
    acc[key] = Math.max(1, toInt(rawValue, 1));
    return acc;
  }, {});
}

function resolveLineQuantity(itemId, quantityMap, fallback = 1) {
  const id = toText(itemId);
  if (!id) return Math.max(1, toInt(fallback, 1));
  if (!Object.prototype.hasOwnProperty.call(quantityMap, id)) {
    return Math.max(1, toInt(fallback, 1));
  }
  return Math.max(1, toInt(quantityMap[id], fallback));
}

function dateParts(isoDate) {
  const parsed = isoDate ? new Date(isoDate) : new Date();
  if (Number.isNaN(parsed.getTime())) {
    const now = new Date();
    return { month: now.getMonth() + 1, day: now.getDate() };
  }
  return {
    month: parsed.getMonth() + 1,
    day: parsed.getDate()
  };
}

function seasonRangeContains(profile, month, day) {
  const target = month * 100 + day;
  const start = toNumber(profile?.startMonth, 1) * 100 + toNumber(profile?.startDay, 1);
  const end = toNumber(profile?.endMonth, 12) * 100 + toNumber(profile?.endDay, 31);

  if (start <= end) {
    return target >= start && target <= end;
  }
  return target >= start || target <= end;
}

function resolveServiceFeePct(guests, settings) {
  const tiers = Array.isArray(settings?.serviceFeeTiers) ? settings.serviceFeeTiers : [];
  const match = tiers.find((tier) => guests >= Number(tier.minGuests || 0) && guests <= Number(tier.maxGuests || 9999));
  if (match) return Number(match.pct || 0);
  return Number(settings?.serviceFeePct || 0);
}

function resolveTaxRegion(input, settings) {
  const regions = Array.isArray(settings?.taxRegions) ? settings.taxRegions : [];
  const fallbackRate = Number(settings?.taxRate || 0);
  const selectedId = toText(input?.taxRegionId || input?.taxRegion || settings?.defaultTaxRegion);
  const selected = regions.find((region) => toText(region?.id) === selectedId) || regions[0];

  if (selected) {
    return {
      id: toText(selected.id, "default"),
      name: toText(selected.name, "Default"),
      rate: toNumber(selected.rate, fallbackRate)
    };
  }

  return {
    id: "default",
    name: "Default",
    rate: fallbackRate
  };
}

function resolveSeasonProfile(input, settings) {
  const profiles = Array.isArray(settings?.seasonalProfiles) ? settings.seasonalProfiles : [];
  const explicit = toText(input?.seasonProfileId);
  const defaultProfileId = toText(settings?.defaultSeasonProfile, "auto");

  if (!profiles.length) {
    return {
      id: "standard",
      name: "Standard",
      packageMultiplier: 1,
      addonMultiplier: 1,
      rentalMultiplier: 1
    };
  }

  if (explicit && explicit !== "auto") {
    const chosen = profiles.find((profile) => toText(profile?.id) === explicit);
    if (chosen) return chosen;
  }

  if (defaultProfileId && defaultProfileId !== "auto") {
    const chosen = profiles.find((profile) => toText(profile?.id) === defaultProfileId);
    if (chosen) return chosen;
  }

  const { month, day } = dateParts(input?.date);
  const autoMatch = profiles.find((profile) => seasonRangeContains(profile, month, day));
  return autoMatch || profiles[0];
}

function resolveLaborRates(input, settings) {
  const baseBartenderRate = toNumber(settings?.bartenderRate, 0);
  const baseServerRate = toNumber(settings?.serverRate, 0);
  const baseChefRate = toNumber(settings?.chefRate, 0);

  const bartenderRateOverride = toOptionalRate(input?.labor?.bartenderRateOverride);
  const serverRateOverride = toOptionalRate(input?.labor?.serverRateOverride);
  const chefRateOverride = toOptionalRate(input?.labor?.chefRateOverride);

  return {
    bartenderRateApplied: bartenderRateOverride ?? baseBartenderRate,
    serverRateApplied: serverRateOverride ?? baseServerRate,
    chefRateApplied: chefRateOverride ?? baseChefRate,
    bartenderRateTypeId: "",
    bartenderRateTypeName: "",
    staffingRateTypeId: "",
    staffingRateTypeName: ""
  };
}

function roundCurrency(value) {
  return Math.round(toNumber(value, 0) * 100) / 100;
}

function normalizeRateMixCsv(value) {
  return String(value ?? "").trim().slice(0, MAX_RATE_MIX_CSV_LENGTH);
}

function parseRateMixCsv(value, maxEntries = 0) {
  const limit = Math.max(0, toInt(maxEntries, 0));
  if (limit <= 0) return [];
  const raw = normalizeRateMixCsv(value);
  if (!raw) return [];
  return raw.split(",").reduce((acc, token) => {
    if (acc.length >= limit) return acc;
    const text = toText(token);
    if (!text) return acc;
    const n = Number(text);
    if (!Number.isFinite(n) || n < 0) return acc;
    acc.push(roundCurrency(n));
    return acc;
  }, []);
}

function resolveRatesApplied(countValue, fallbackRateValue, rateMixCsv) {
  const count = Math.max(0, toInt(countValue, 0));
  if (count <= 0) return [];
  const fallbackRate = roundCurrency(Math.max(0, toNumber(fallbackRateValue, 0)));
  const parsed = parseRateMixCsv(rateMixCsv, count);
  if (!parsed.length) {
    return Array.from({ length: count }, () => fallbackRate);
  }
  return Array.from({ length: count }, (_, index) => {
    const resolved = parsed[index];
    if (resolved === undefined) return fallbackRate;
    return roundCurrency(Math.max(0, toNumber(resolved, fallbackRate)));
  });
}

function normalizeServerRateMixCsv(value) {
  return normalizeRateMixCsv(value);
}

function normalizeChefRateMixCsv(value) {
  return normalizeRateMixCsv(value);
}

function resolveServerRatesApplied(servers, fallbackServerRate, serverRateMixCsv) {
  return resolveRatesApplied(servers, fallbackServerRate, serverRateMixCsv);
}

function resolveChefRatesApplied(chefs, fallbackChefRate, chefRateMixCsv) {
  return resolveRatesApplied(chefs, fallbackChefRate, chefRateMixCsv);
}

function toCatalogId(value, fallback = "") {
  const raw = toLowerText(value, fallback);
  if (!raw) return "";
  return raw
    .replace(/[^\w-]+/g, "-")
    .replace(/-{2,}/g, "-")
    .replace(/^-|-$/g, "");
}

function normalizeSelectionEntry(entry, fallbackPricingMode = "per_event") {
  if (typeof entry === "string") {
    const id = toText(entry);
    if (!id) return null;
    return {
      id,
      name: id,
      pricingMode: fallbackPricingMode,
      unitPrice: 0,
      quantity: 1
    };
  }

  if (!entry || typeof entry !== "object") return null;
  const id = toText(entry.id);
  if (!id) return null;

  return {
    id,
    name: toText(entry.name, id),
    pricingMode: normalizePricingType(entry.pricingMode || entry.pricingType || entry.type, fallbackPricingMode),
    unitPrice: toNumber(entry.unitPrice, toNumber(entry.price, 0)),
    quantity: Math.max(1, toInt(entry.quantity, 1))
  };
}

function normalizeSelectionList(input, fallbackPricingMode) {
  const source = Array.isArray(input) ? input : [];
  return source
    .map((entry) => normalizeSelectionEntry(entry, fallbackPricingMode))
    .filter(Boolean);
}

function normalizeActor(source = {}, staff = {}) {
  return {
    uid: toText(source?.uid || staff?.uid),
    email: toLowerText(source?.email || staff?.email || ""),
    role: toText(source?.role || staff?.role)
  };
}

function normalizePricingInputPayload(data = {}, staff = {}) {
  const root = data && typeof data === "object" ? data : {};
  const source = root.pricingInput && typeof root.pricingInput === "object" ? root.pricingInput : root;
  const event = source.event && typeof source.event === "object" ? source.event : {};
  const selection = source.selection && typeof source.selection === "object" ? source.selection : {};
  const rawForm = root.form && typeof root.form === "object"
    ? root.form
    : source.form && typeof source.form === "object"
      ? source.form
      : {};
  const rawQuantities = selection.quantities && typeof selection.quantities === "object" ? selection.quantities : {};

  const actor = normalizeActor(source.actor, staff);
  const requestedOrganizationId = normalizeOrganizationId(
    source.organizationId || root.organizationId || staff.organizationId
  );
  const staffOrganizationId = normalizeOrganizationId(staff.organizationId);

  if (staffOrganizationId && requestedOrganizationId && requestedOrganizationId !== staffOrganizationId) {
    throw new PricingEngineError("permission-denied", "Requested organization is outside your role scope.");
  }

  const organizationId = requestedOrganizationId || staffOrganizationId;
  const packageRef = selection.package && typeof selection.package === "object" ? selection.package : {};
  const packageId = toText(
    packageRef.id || selection.packageId || rawForm.pkg || source.packageId
  );

  if (!packageId) {
    throw new PricingEngineError("invalid-argument", "selection.package.id is required.");
  }

  const addonQuantities = normalizeQuantityMap(
    rawQuantities.addonQuantities || selection.addonQuantities || rawForm.addonQuantities
  );
  const rentalQuantities = normalizeQuantityMap(
    rawQuantities.rentalQuantities || selection.rentalQuantities || rawForm.rentalQuantities
  );
  const menuItemQuantities = normalizeQuantityMap(
    rawQuantities.menuItemQuantities || selection.menuItemQuantities || rawForm.menuItemQuantities
  );

  const addons = normalizeSelectionList(selection.addons || rawForm.addons || source.addons, "per_person");
  const rentals = normalizeSelectionList(selection.rentals || rawForm.rentals || source.rentals, "per_item");
  const menuItems = normalizeSelectionList(selection.menuItems || rawForm.menuItems || source.menuItems, "per_event");

  return {
    organizationId,
    quoteId: toText(source.quoteId || root.quoteId),
    quoteNumber: toText(source.quoteNumber || root.quoteNumber),
    actor,
    event: {
      name: toText(event.name || rawForm.eventName),
      eventTypeId: toText(event.eventTypeId || rawForm.eventTypeId),
      date: toText(event.date || rawForm.date),
      time: toText(event.time || rawForm.time),
      venue: toText(event.venue || rawForm.venue),
      venueAddress: toText(event.venueAddress || rawForm.venueAddress),
      guests: Math.max(0, toInt(event.guests ?? rawForm.guests, 0)),
      hours: Math.max(0, toNumber(event.hours ?? rawForm.hours, 0)),
      style: toText(event.style || rawForm.style, "Buffet"),
      servers: Math.max(0, toInt(event.servers ?? rawForm.servers, 0)),
      chefs: Math.max(0, toInt(event.chefs ?? rawForm.chefs, 0)),
      bartenders: Math.max(0, toInt(event.bartenders ?? rawForm.bartenders, 0)),
      milesRT: Math.max(0, toNumber(event.milesRT ?? selection.milesRT ?? rawForm.milesRT, 0)),
      taxRegionId: toText(event.taxRegionId || selection.taxRegion || rawForm.taxRegion),
      seasonProfileId: toText(event.seasonProfileId || selection.seasonProfileId || rawForm.seasonProfileId)
    },
    selection: {
      package: {
        id: packageId,
        name: toText(packageRef.name || selection.packageName || rawForm.packageName || packageId),
        pricingMode: normalizePricingType(packageRef.pricingMode || packageRef.pricingType || packageRef.type, "per_person"),
        unitPrice: toNumber(packageRef.unitPrice, toNumber(packageRef.price, 0)),
        quantity: Math.max(1, toInt(packageRef.quantity, 1))
      },
      addons,
      rentals,
      menuItems,
      quantities: {
        addonQuantities,
        rentalQuantities,
        menuItemQuantities
      }
    },
    labor: {
      bartenderRateOverride: source.labor?.bartenderRateOverride ?? rawForm.bartenderRateOverride ?? selection.bartenderRateOverride,
      serverRateOverride: source.labor?.serverRateOverride ?? rawForm.serverRateOverride ?? selection.serverRateOverride,
      chefRateOverride: source.labor?.chefRateOverride ?? rawForm.chefRateOverride ?? selection.chefRateOverride,
      serverRateMixCsv: normalizeServerRateMixCsv(
        source.labor?.serverRateMixCsv ?? rawForm.serverRateMixCsv ?? selection.serverRateMixCsv
      ),
      chefRateMixCsv: normalizeChefRateMixCsv(
        source.labor?.chefRateMixCsv ?? rawForm.chefRateMixCsv ?? selection.chefRateMixCsv
      )
    },
    metadata: {
      source: toText(source.metadata?.source || root.source || source.source),
      generatedAt: normalizeISO(source.metadata?.generatedAt || source.generatedAt || root.generatedAt || "", "")
    }
  };
}

function normalizeCatalogPackage(item = {}) {
  const stableIds = (value) => {
    if (value === undefined) return [];
    return Array.isArray(value) ? value.map((id) => toText(id)) : value;
  };
  return {
    id: toText(item.id),
    name: toText(item.name, toText(item.id)),
    ppp: moneyValue(item, "pppMinor", "ppp", 0),
    includedMenuItemIds: stableIds(item.includedMenuItemIds),
    includedAddonIds: stableIds(item.includedAddonIds),
    includedRentalIds: stableIds(item.includedRentalIds),
    active: item.active !== false
  };
}

function normalizeCatalogAddon(item = {}) {
  const pricingType = normalizePricingType(item.pricingType || item.type, "per_person");
  return {
    id: toText(item.id),
    name: toText(item.name, toText(item.id)),
    price: moneyValue(item, "priceMinor", "price", 0),
    pricingType,
    type: pricingType,
    staffRole: resolveAddonStaffRole(item),
    active: item.active !== false
  };
}

function normalizeCatalogRental(item = {}) {
  const pricingType = normalizePricingType(item.pricingType || item.type, "per_item");
  return {
    id: toText(item.id),
    name: toText(item.name, toText(item.id)),
    price: moneyValue(item, "priceMinor", "price", 0),
    qtyPerGuests: Math.max(1, toNumber(item.qtyPerGuests, 1)),
    pricingType,
    type: pricingType,
    active: item.active !== false
  };
}

function normalizeCatalogMenuItem(item = {}) {
  const pricingType = normalizePricingType(item.pricingType || item.type, "per_event");
  return {
    id: toText(item.id),
    name: toText(item.name, toText(item.id)),
    price: moneyValue(item, "priceMinor", "price", 0),
    pricingType,
    type: pricingType,
    eventTypeId: toText(item.eventTypeId),
    categoryId: toText(item.categoryId),
    active: item.active !== false
  };
}

function normalizeMenuSections(sections = []) {
  const source = Array.isArray(sections) ? sections : [];
  return source.map((section, idx) => {
    const sectionId = toCatalogId(section?.id, `menu-${idx + 1}`);
    const rawItems = Array.isArray(section?.items) ? section.items : [];
    const seen = new Set();
    const items = rawItems
      .map((item, itemIdx) => {
        if (typeof item === "string") {
          const name = toText(item);
          const id = toCatalogId(name, `${sectionId}-item-${itemIdx + 1}`);
          return {
            id,
            name: name || id,
            price: 0,
            pricingType: "per_event",
            type: "per_event",
            active: true
          };
        }

        const id = toCatalogId(item?.id, `${sectionId}-item-${itemIdx + 1}`);
        const name = toText(item?.name, id);
        const pricingType = normalizePricingType(item?.pricingType || item?.type, "per_event");
        return {
          id,
          name,
          price: moneyValue(item, "priceMinor", "price", 0),
          pricingType,
          type: pricingType,
          active: item?.active !== false
        };
      })
      .filter((item) => {
        if (!item.id || seen.has(item.id)) return false;
        seen.add(item.id);
        return true;
      });

    return {
      id: sectionId,
      name: toText(section?.name, `Menu ${idx + 1}`),
      items
    };
  });
}

function normalizeServiceFeeTiers(tiers) {
  const source = Array.isArray(tiers) ? tiers : DEFAULT_SERVICE_FEE_TIERS;
  return source.map((tier, idx) => {
    const minGuests = Math.max(0, toInt(tier?.minGuests, 0));
    const maxGuests = Math.max(minGuests, toInt(tier?.maxGuests, 9999));
    return {
      id: toCatalogId(tier?.id, `tier-${idx + 1}`),
      minGuests,
      maxGuests,
      pct: Math.max(0, toNumber(tier?.pct, 0))
    };
  });
}

function normalizeTaxRegions(regions, fallbackRate = 0.1) {
  const source = Array.isArray(regions) ? regions : DEFAULT_TAX_REGIONS;
  return source.map((region, idx) => ({
    id: toCatalogId(region?.id, `tax-${idx + 1}`),
    name: toText(region?.name, `Region ${idx + 1}`),
    rate: Math.max(0, toNumber(region?.rate, fallbackRate))
  }));
}

function normalizeSeasonalProfiles(profiles) {
  const source = Array.isArray(profiles) ? profiles : DEFAULT_SEASONAL_PROFILES;
  return source.map((profile, idx) => ({
    id: toCatalogId(profile?.id, `season-${idx + 1}`),
    name: toText(profile?.name, `Season ${idx + 1}`),
    startMonth: Math.min(12, Math.max(1, toInt(profile?.startMonth, 1))),
    startDay: Math.min(31, Math.max(1, toInt(profile?.startDay, 1))),
    endMonth: Math.min(12, Math.max(1, toInt(profile?.endMonth, 12))),
    endDay: Math.min(31, Math.max(1, toInt(profile?.endDay, 31))),
    packageMultiplier: Math.max(0.5, Math.min(2, toNumber(profile?.packageMultiplier, 1))),
    addonMultiplier: Math.max(0.5, Math.min(2, toNumber(profile?.addonMultiplier, 1))),
    rentalMultiplier: Math.max(0.5, Math.min(2, toNumber(profile?.rentalMultiplier, 1)))
  }));
}

function normalizeBartenderRateTypes(rateTypes, fallbackRate = 30) {
  const source = Array.isArray(rateTypes) ? rateTypes : DEFAULT_BARTENDER_RATE_TYPES;
  return source.map((item, idx) => ({
    id: toCatalogId(item?.id, `bartender-rate-${idx + 1}`),
    name: toText(item?.name, `Bartender Type ${idx + 1}`),
    rate: Math.max(0, moneyValue(item, "rateMinor", "rate", fallbackRate))
  }));
}

function normalizeStaffingRateTypes(rateTypes, fallbackServerRate = 22, fallbackChefRate = 28) {
  const source = Array.isArray(rateTypes) ? rateTypes : DEFAULT_STAFFING_RATE_TYPES;
  return source.map((item, idx) => ({
    id: toCatalogId(item?.id, `staffing-rate-${idx + 1}`),
    name: toText(item?.name, `Staffing Type ${idx + 1}`),
    serverRate: Math.max(0, moneyValue(item, "serverRateMinor", "serverRate", fallbackServerRate)),
    chefRate: Math.max(0, moneyValue(item, "chefRateMinor", "chefRate", fallbackChefRate))
  }));
}

function isExactIsoTimestamp(value) {
  const normalized = toText(value);
  if (!normalized) return false;
  const timestamp = Date.parse(normalized);
  return Number.isFinite(timestamp) && new Date(timestamp).toISOString() === normalized;
}

function isCatalogPricingConfirmationCurrent(settings = {}) {
  if (settings?.pricingSetupConfirmed !== true) return false;
  const catalogRevision = Number(settings?.catalogRevision);
  const confirmation = settings?.pricingConfirmation;
  if (!Number.isSafeInteger(catalogRevision) || catalogRevision < 0) return false;
  if (!confirmation || typeof confirmation !== "object" || Array.isArray(confirmation)) return false;
  if (!toText(confirmation.actorUid) || !toText(confirmation.actorEmail)) return false;
  if (!isExactIsoTimestamp(confirmation.confirmedAtISO)) return false;
  return Number.isSafeInteger(Number(confirmation.confirmedCatalogRevision))
    && Number(confirmation.confirmedCatalogRevision) === catalogRevision;
}

function normalizePricingSettings(settings = {}) {
  const source = settings && typeof settings === "object" ? settings : {};
  const hasEmptyServiceFeeTiers = Array.isArray(source.serviceFeeTiers) && source.serviceFeeTiers.length === 0;
  const hasEmptyTaxRegions = Array.isArray(source.taxRegions) && source.taxRegions.length === 0;
  const hasEmptyBartenderRateTypes = Array.isArray(source.bartenderRateTypes)
    && source.bartenderRateTypes.length === 0;
  const hasEmptyStaffingRateTypes = Array.isArray(source.staffingRateTypes)
    && source.staffingRateTypes.length === 0;
  const taxRate = Math.max(0, toNumber(
    source.taxRate,
    hasEmptyTaxRegions ? 0 : DEFAULT_PRICING_SETTINGS.taxRate
  ));
  const bartenderRate = Math.max(0, toNumber(
    moneyValue(source, "bartenderRateMinor", "bartenderRate", hasEmptyBartenderRateTypes ? 0 : DEFAULT_PRICING_SETTINGS.bartenderRate),
    hasEmptyBartenderRateTypes ? 0 : DEFAULT_PRICING_SETTINGS.bartenderRate
  ));
  const serverRate = Math.max(0, toNumber(
    moneyValue(source, "serverRateMinor", "serverRate", hasEmptyStaffingRateTypes ? 0 : DEFAULT_PRICING_SETTINGS.serverRate),
    hasEmptyStaffingRateTypes ? 0 : DEFAULT_PRICING_SETTINGS.serverRate
  ));
  const chefRate = Math.max(0, toNumber(
    moneyValue(source, "chefRateMinor", "chefRate", hasEmptyStaffingRateTypes ? 0 : DEFAULT_PRICING_SETTINGS.chefRate),
    hasEmptyStaffingRateTypes ? 0 : DEFAULT_PRICING_SETTINGS.chefRate
  ));

  const normalized = {
    pricingSetupConfirmed: source.pricingSetupConfirmed === true,
    catalogRevision: Number.isSafeInteger(Number(source.catalogRevision))
      && Number(source.catalogRevision) >= 0
      ? Number(source.catalogRevision)
      : -1,
    pricingConfirmation: source.pricingConfirmation && typeof source.pricingConfirmation === "object"
      ? {
          actorUid: toText(source.pricingConfirmation.actorUid),
          actorEmail: toText(source.pricingConfirmation.actorEmail).toLowerCase(),
          confirmedAtISO: toText(source.pricingConfirmation.confirmedAtISO),
          confirmedCatalogRevision: Number(source.pricingConfirmation.confirmedCatalogRevision)
        }
      : null,
    perMileRate: Math.max(0, moneyValue(source, "perMileRateMinor", "perMileRate", DEFAULT_PRICING_SETTINGS.perMileRate)),
    longDistancePerMileRate: Math.max(0, moneyValue(
      source,
      "longDistancePerMileRateMinor",
      "longDistancePerMileRate",
      DEFAULT_PRICING_SETTINGS.longDistancePerMileRate
    )),
    deliveryThresholdMiles: Math.max(0, toNumber(source.deliveryThresholdMiles, DEFAULT_PRICING_SETTINGS.deliveryThresholdMiles)),
    bartenderRate,
    serverRate,
    chefRate,
    staffingChargeMode: normalizeStaffingChargeMode(
      source.staffingChargeMode,
      DEFAULT_PRICING_SETTINGS.staffingChargeMode
    ),
    staffingLaborEnabled: source.staffingLaborEnabled !== false,
    serviceFeePct: Math.max(0, toNumber(
      source.serviceFeePct,
      hasEmptyServiceFeeTiers ? 0 : DEFAULT_PRICING_SETTINGS.serviceFeePct
    )),
    serviceFeeTiers: normalizeServiceFeeTiers(source.serviceFeeTiers),
    taxRate,
    taxRegions: normalizeTaxRegions(source.taxRegions, taxRate),
    defaultTaxRegion: toText(
      source.defaultTaxRegion,
      hasEmptyTaxRegions ? "" : DEFAULT_PRICING_SETTINGS.defaultTaxRegion
    ),
    depositPct: Math.max(0, toNumber(source.depositPct, DEFAULT_PRICING_SETTINGS.depositPct)),
    seasonalProfiles: normalizeSeasonalProfiles(source.seasonalProfiles),
    defaultSeasonProfile: toText(source.defaultSeasonProfile, DEFAULT_PRICING_SETTINGS.defaultSeasonProfile),
    bartenderRateTypes: normalizeBartenderRateTypes(source.bartenderRateTypes, bartenderRate),
    defaultBartenderRateType: toText(
      source.defaultBartenderRateType,
      hasEmptyBartenderRateTypes ? "" : DEFAULT_PRICING_SETTINGS.defaultBartenderRateType
    ),
    staffingRateTypes: normalizeStaffingRateTypes(source.staffingRateTypes, serverRate, chefRate),
    defaultStaffingRateType: toText(
      source.defaultStaffingRateType,
      hasEmptyStaffingRateTypes ? "" : DEFAULT_PRICING_SETTINGS.defaultStaffingRateType
    ),
    menuSections: normalizeMenuSections(source.menuSections),
    pricingSettingsVersion: Math.max(0, toInt(source.pricingSettingsVersion, DEFAULT_PRICING_SETTINGS.pricingSettingsVersion)),
    pricingSettingsUpdatedAtISO: normalizeISO(
      source.pricingSettingsUpdatedAtISO || source.updatedAtISO || "",
      DEFAULT_PRICING_SETTINGS.pricingSettingsUpdatedAtISO
    )
  };

  return normalized;
}

function buildRulesSettingsSnapshot(settings = {}) {
  const serviceFeeTiers = Array.isArray(settings.serviceFeeTiers) ? settings.serviceFeeTiers : [];
  const taxRegions = Array.isArray(settings.taxRegions) ? settings.taxRegions : [];
  const seasonalProfiles = Array.isArray(settings.seasonalProfiles) ? settings.seasonalProfiles : [];
  const bartenderRateTypes = Array.isArray(settings.bartenderRateTypes) ? settings.bartenderRateTypes : [];
  const staffingRateTypes = Array.isArray(settings.staffingRateTypes) ? settings.staffingRateTypes : [];

  return {
    pricingSetupConfirmed: settings.pricingSetupConfirmed === true,
    catalogRevision: Number(settings.catalogRevision),
    pricingConfirmation: settings.pricingConfirmation,
    pricingSettingsVersion: Math.max(0, toInt(settings.pricingSettingsVersion, 0)),
    pricingSettingsUpdatedAtISO: normalizeISO(settings.pricingSettingsUpdatedAtISO, ""),
    serviceFeePct: toNumber(settings.serviceFeePct, 0),
    serviceFeeTiers: serviceFeeTiers.map((tier) => ({
      id: toText(tier.id),
      minGuests: Math.max(0, toInt(tier.minGuests, 0)),
      maxGuests: Math.max(0, toInt(tier.maxGuests, 0)),
      pct: toNumber(tier.pct, 0)
    })),
    taxRate: toNumber(settings.taxRate, 0),
    taxRegions: taxRegions.map((region) => ({
      id: toText(region.id),
      name: toText(region.name),
      rate: toNumber(region.rate, 0)
    })),
    defaultTaxRegion: toText(settings.defaultTaxRegion),
    depositPct: toNumber(settings.depositPct, 0),
    seasonalProfiles: seasonalProfiles.map((profile) => ({
      id: toText(profile.id),
      name: toText(profile.name),
      startMonth: Math.max(1, toInt(profile.startMonth, 1)),
      startDay: Math.max(1, toInt(profile.startDay, 1)),
      endMonth: Math.max(1, toInt(profile.endMonth, 12)),
      endDay: Math.max(1, toInt(profile.endDay, 31)),
      packageMultiplier: toNumber(profile.packageMultiplier, 1),
      addonMultiplier: toNumber(profile.addonMultiplier, 1),
      rentalMultiplier: toNumber(profile.rentalMultiplier, 1)
    })),
    defaultSeasonProfile: toText(settings.defaultSeasonProfile),
    staffingChargeMode: normalizeStaffingChargeMode(settings.staffingChargeMode, "per_hour"),
    staffingLaborEnabled: settings.staffingLaborEnabled !== false,
    perMileRate: toNumber(settings.perMileRate, 0),
    longDistancePerMileRate: toNumber(settings.longDistancePerMileRate, 0),
    deliveryThresholdMiles: toNumber(settings.deliveryThresholdMiles, 0),
    bartenderRateTypes: bartenderRateTypes.map((item) => ({
      id: toText(item.id),
      name: toText(item.name),
      rate: toNumber(item.rate, 0)
    })),
    defaultBartenderRateType: toText(settings.defaultBartenderRateType),
    staffingRateTypes: staffingRateTypes.map((item) => ({
      id: toText(item.id),
      name: toText(item.name),
      serverRate: toNumber(item.serverRate, 0),
      chefRate: toNumber(item.chefRate, 0)
    })),
    defaultStaffingRateType: toText(settings.defaultStaffingRateType)
  };
}

function normalizeCatalogBundle(bundle = {}) {
  const rawPackages = Array.isArray(bundle?.packages) ? bundle.packages : [];
  const rawAddons = Array.isArray(bundle?.addons) ? bundle.addons : [];
  const rawRentals = Array.isArray(bundle?.rentals) ? bundle.rentals : [];
  const rawMenuItems = Array.isArray(bundle?.menuItems) ? bundle.menuItems : [];

  const packages = rawPackages
    .map((item) => normalizeCatalogPackage(item))
    .filter((item) => item.id)
    .sort((a, b) => a.id.localeCompare(b.id));

  const addons = rawAddons
    .map((item) => normalizeCatalogAddon(item))
    .filter((item) => item.id)
    .sort((a, b) => a.id.localeCompare(b.id));

  const rentals = rawRentals
    .map((item) => normalizeCatalogRental(item))
    .filter((item) => item.id)
    .sort((a, b) => a.id.localeCompare(b.id));

  const menuItems = rawMenuItems
    .map((item) => normalizeCatalogMenuItem(item))
    .filter((item) => item.id)
    .sort((a, b) => a.id.localeCompare(b.id));

  const settings = normalizePricingSettings(bundle?.settings);

  return {
    packages,
    addons,
    rentals,
    menuItems,
    settings
  };
}

async function readCatalogBundle(db, organizationsCollection, organizationId = "") {
  const orgId = normalizeOrganizationId(organizationId);
  if (!orgId) {
    throw new PricingEngineError("invalid-argument", "organizationId is required for authoritative pricing.");
  }

  const [pkgSnap, addSnap, rentSnap, menuItemSnap, settingsSnap] = await Promise.all([
    db.collection(organizationsCollection).doc(orgId).collection("catalogPackages").get(),
    db.collection(organizationsCollection).doc(orgId).collection("catalogAddons").get(),
    db.collection(organizationsCollection).doc(orgId).collection("catalogRentals").get(),
    db.collection(organizationsCollection).doc(orgId).collection("menuItems").get(),
    db.collection(organizationsCollection).doc(orgId).collection("settings").doc("config").get()
  ]);

  return normalizeCatalogBundle({
    packages: pkgSnap.docs.map((doc) => ({ ...doc.data(), id: doc.id })),
    addons: addSnap.docs.map((doc) => ({ ...doc.data(), id: doc.id })),
    rentals: rentSnap.docs.map((doc) => ({ ...doc.data(), id: doc.id })),
    menuItems: menuItemSnap.docs.map((doc) => ({ ...doc.data(), id: doc.id })),
    settings: settingsSnap.exists ? settingsSnap.data() : {}
  });
}

async function loadCatalogAndSettings(db, organizationsCollection, {
  organizationId = ""
} = {}) {
  const scopedOrganizationId = normalizeOrganizationId(organizationId);
  if (!scopedOrganizationId) {
    throw new PricingEngineError("invalid-argument", "organizationId is required for authoritative pricing.");
  }

  const globalBundle = await readCatalogBundle(db, organizationsCollection, scopedOrganizationId);
  return {
    ...globalBundle,
    source: "firebase-org",
    organizationId: scopedOrganizationId
  };
}

function buildCatalogMaps(catalog = {}) {
  return {
    packageById: new Map((catalog.packages || []).map((item) => [item.id, item])),
    addonById: new Map((catalog.addons || []).map((item) => [item.id, item])),
    rentalById: new Map((catalog.rentals || []).map((item) => [item.id, item])),
    menuItemById: new Map((catalog.menuItems || []).map((item) => [item.id, item]))
  };
}

function flattenMenuItems(settings = {}, authoritativeMenuItems = new Map()) {
  const sections = Array.isArray(settings?.menuSections) ? settings.menuSections : [];
  const byId = new Map(authoritativeMenuItems);
  sections.forEach((section) => {
    const items = Array.isArray(section?.items) ? section.items : [];
    items.forEach((item) => {
      const id = toText(item?.id);
      if (!id || byId.has(id)) return;
      byId.set(id, {
        id,
        name: toText(item?.name, id),
        price: toNumber(item?.price, 0),
        pricingType: normalizePricingType(item?.pricingType || item?.type, "per_event"),
        active: item?.active !== false
      });
    });
  });
  return byId;
}

function buildLineItem({
  id,
  category,
  name,
  pricingMode,
  unitPrice,
  quantity,
  total,
  meta = {}
}) {
  return {
    id: toText(id),
    category: toText(category),
    name: toText(name, toText(id)),
    pricingMode: normalizePricingType(pricingMode, "per_event"),
    unitPrice: toNumber(unitPrice, 0),
    quantity: Math.max(0, toInt(quantity, 0)),
    total: toNumber(total, 0),
    meta: meta && typeof meta === "object" ? { ...meta } : {}
  };
}

function calculatePriceWithMode({
  pricingMode,
  unitPrice,
  guests,
  quantity,
  multiplier
}) {
  const price = toNumber(unitPrice, 0);
  const mode = normalizePricingType(pricingMode, "per_event");
  const appliedMultiplier = toNumber(multiplier, 1);

  if (mode === "per_person") {
    return {
      quantity: Math.max(0, toInt(guests, 0)),
      total: price * Math.max(0, toInt(guests, 0)) * appliedMultiplier
    };
  }
  if (mode === "per_item") {
    const resolvedQuantity = Math.max(1, toInt(quantity, 1));
    return {
      quantity: resolvedQuantity,
      total: price * resolvedQuantity * appliedMultiplier
    };
  }
  return {
    quantity: 1,
    total: price * appliedMultiplier
  };
}

function resolveAuthoritativePackageInclusions(selectedPkg, maps, menuItemById) {
  const resolve = (value, records, label, fallbackPricingMode) => {
    if (!Array.isArray(value) || value.length > 100) {
      throw new PricingEngineError(
        "failed-precondition",
        `Package ${selectedPkg.id} ${label} inclusions are invalid.`
      );
    }
    const seen = new Set();
    return value.map((rawId) => {
      const id = toText(rawId);
      if (!id || !/^[A-Za-z0-9][A-Za-z0-9_-]{0,199}$/.test(id) || seen.has(id)) {
        throw new PricingEngineError(
          "failed-precondition",
          `Package ${selectedPkg.id} has an invalid or duplicate ${label} inclusion.`
        );
      }
      seen.add(id);
      const item = records.get(id);
      if (!item || item.active === false) {
        throw new PricingEngineError(
          "failed-precondition",
          `Package ${selectedPkg.id} includes unavailable ${label} ${id}.`
        );
      }
      return {
        id,
        name: toText(item.name, id),
        pricingMode: normalizePricingType(item.pricingType || item.type, fallbackPricingMode),
        unitPrice: 0,
        quantity: 1,
        includedInPackage: true
      };
    });
  };

  return {
    menuItems: resolve(selectedPkg.includedMenuItemIds, menuItemById, "menu item", "per_event"),
    addons: resolve(selectedPkg.includedAddonIds, maps.addonById, "add-on", "per_person"),
    rentals: resolve(selectedPkg.includedRentalIds, maps.rentalById, "rental", "per_item")
  };
}

function calculateAuthoritativePricing(input, catalog, settings, catalogSource = "") {
  const maps = buildCatalogMaps(catalog);
  const menuItemById = flattenMenuItems(settings, maps.menuItemById);
  const missingReferences = new Set();

  const guests = Math.min(400, Math.max(0, toNumber(input.event.guests, 0)));
  const hours = Math.max(0, toNumber(input.event.hours, 0));
  const serversInput = Math.max(0, toInt(input.event.servers, 0));
  const chefsInput = Math.max(0, toInt(input.event.chefs, 0));
  const bartenders = Math.max(0, toNumber(input.event.bartenders, 0));
  const style = toText(input.event.style, "Buffet");
  const milesRT = Math.max(0, toNumber(input.event.milesRT, 0));

  const selectedPkg = maps.packageById.get(input.selection.package.id) || catalog.packages[0] || null;
  if (!selectedPkg) {
    throw new PricingEngineError("failed-precondition", "No catalog packages are available for pricing.");
  }

  if (!maps.packageById.has(input.selection.package.id)) {
    throw new PricingEngineError(
      "failed-precondition",
      `Package ${input.selection.package.id} is unavailable in the authoritative catalog.`
    );
  }
  if (selectedPkg.active === false) {
    throw new PricingEngineError("failed-precondition", `Package ${selectedPkg.id} is inactive.`);
  }
  const packageInclusions = resolveAuthoritativePackageInclusions(selectedPkg, maps, menuItemById);
  const includedAddonIds = new Set(packageInclusions.addons.map((item) => item.id));
  const includedRentalIds = new Set(packageInclusions.rentals.map((item) => item.id));
  const includedMenuItemIds = new Set(packageInclusions.menuItems.map((item) => item.id));
  const selectedPackageInclusions = {
    addons: packageInclusions.addons.filter((item) => input.selection.addons.some((selected) => selected.id === item.id)),
    rentals: packageInclusions.rentals.filter((item) => input.selection.rentals.some((selected) => selected.id === item.id)),
    menuItems: packageInclusions.menuItems.filter((item) => input.selection.menuItems.some((selected) => selected.id === item.id))
  };

  const serviceFeePctApplied = resolveServiceFeePct(guests, settings);
  const taxRegion = resolveTaxRegion({
    taxRegionId: input.event.taxRegionId
  }, settings);
  const seasonProfile = resolveSeasonProfile({
    seasonProfileId: input.event.seasonProfileId,
    date: input.event.date
  }, settings);

  const packageMultiplier = toNumber(seasonProfile?.packageMultiplier, 1);
  const addonMultiplier = toNumber(seasonProfile?.addonMultiplier, 1);
  const rentalMultiplier = toNumber(seasonProfile?.rentalMultiplier, 1);
  const staffingLaborEnabled = settings?.staffingLaborEnabled !== false;
  const staffingChargeMode = normalizeStaffingChargeMode(settings?.staffingChargeMode, "per_hour");
  const serverRateMixCsv = normalizeServerRateMixCsv(input?.labor?.serverRateMixCsv);
  const chefRateMixCsv = normalizeChefRateMixCsv(input?.labor?.chefRateMixCsv);

  const thresholdMiles = toNumber(settings?.deliveryThresholdMiles, 0);
  const standardTravelRate = toNumber(settings?.perMileRate, 0);
  const longDistanceRate = toNumber(settings?.longDistancePerMileRate, standardTravelRate);
  const baseMiles = Math.min(milesRT, thresholdMiles);
  const longDistanceMiles = Math.max(0, milesRT - thresholdMiles);

  const laborRates = resolveLaborRates(input, settings);

  const addonQuantityMap = normalizeQuantityMap(input.selection.quantities.addonQuantities);
  const rentalQuantityMap = normalizeQuantityMap(input.selection.quantities.rentalQuantities);
  const menuItemQuantityMap = normalizeQuantityMap(input.selection.quantities.menuItemQuantities);

  let base = 0;
  let addons = 0;
  let rentals = 0;
  let menu = 0;
  const lineItems = [];

  if (guests > 0) {
    base = toNumber(selectedPkg?.ppp, 0) * guests * packageMultiplier;

    lineItems.push(buildLineItem({
      id: selectedPkg.id,
      category: "package",
      name: selectedPkg.name,
      pricingMode: "per_person",
      unitPrice: toNumber(selectedPkg.ppp, 0),
      quantity: guests,
      total: base,
      meta: {
        packageMultiplier
      }
    }));

    input.selection.addons.forEach((itemRef) => {
      const found = maps.addonById.get(itemRef.id);
      if (!found || found.active === false) {
        throw new PricingEngineError(
          "failed-precondition",
          `Add-on ${itemRef.id} is unavailable in the authoritative catalog.`
        );
      }
      const includedInPackage = includedAddonIds.has(itemRef.id);
      const pricingMode = normalizePricingType(found?.pricingType || itemRef.pricingMode, "per_person");
      const quantityEnabled = addonSupportsQuantity(found || itemRef, pricingMode);
      const effectivePricingMode = pricingMode === "per_event" && quantityEnabled ? "per_item" : pricingMode;
      const resolvedQuantity = quantityEnabled
        ? resolveLineQuantity(itemRef.id, addonQuantityMap, itemRef.quantity || 1)
        : 1;
      const unitPrice = includedInPackage ? 0 : toNumber(found?.price, 0);
      const active = true;
      const result = active
        ? calculatePriceWithMode({
          pricingMode: effectivePricingMode,
          unitPrice,
          guests,
          quantity: resolvedQuantity,
          multiplier: addonMultiplier
        })
        : {
          quantity: pricingMode === "per_person" ? Math.max(0, toInt(guests, 0)) : Math.max(1, resolvedQuantity),
          total: 0
        };
      addons += result.total;
      lineItems.push(buildLineItem({
        id: itemRef.id,
        category: "addon",
        name: toText(found?.name, itemRef.name || itemRef.id),
        pricingMode: effectivePricingMode,
        unitPrice,
        quantity: result.quantity,
        total: result.total,
        meta: {
          active,
          includedInPackage,
          packageId: includedInPackage ? selectedPkg.id : "",
          addonMultiplier
        }
      }));
    });

    input.selection.rentals.forEach((itemRef) => {
      const found = maps.rentalById.get(itemRef.id);
      if (!found || found.active === false) {
        throw new PricingEngineError(
          "failed-precondition",
          `Rental ${itemRef.id} is unavailable in the authoritative catalog.`
        );
      }
      const includedInPackage = includedRentalIds.has(itemRef.id);
      const pricingMode = normalizePricingType(found?.pricingType || itemRef.pricingMode, "per_item");
      const unitPrice = includedInPackage ? 0 : toNumber(found?.price, 0);
      const active = true;
      const defaultQty = pricingMode === "per_item"
        ? Math.max(1, Math.ceil(guests / Math.max(1, toNumber(found?.qtyPerGuests, 1))))
        : 1;
      const result = active
        ? calculatePriceWithMode({
          pricingMode,
          unitPrice,
          guests,
          quantity: resolveLineQuantity(itemRef.id, rentalQuantityMap, defaultQty),
          multiplier: rentalMultiplier
        })
        : {
          quantity: pricingMode === "per_person" ? Math.max(0, toInt(guests, 0)) : Math.max(1, defaultQty),
          total: 0
        };

      rentals += result.total;
      lineItems.push(buildLineItem({
        id: itemRef.id,
        category: "rental",
        name: toText(found?.name, itemRef.name || itemRef.id),
        pricingMode,
        unitPrice,
        quantity: result.quantity,
        total: result.total,
        meta: {
          active,
          includedInPackage,
          packageId: includedInPackage ? selectedPkg.id : "",
          qtyPerGuests: toNumber(found?.qtyPerGuests, 1),
          rentalMultiplier
        }
      }));
    });

    input.selection.menuItems.forEach((itemRef) => {
      const found = menuItemById.get(itemRef.id);
      if (!found || found.active === false) {
        throw new PricingEngineError(
          "failed-precondition",
          `Menu item ${itemRef.id} is unavailable in the authoritative catalog.`
        );
      }
      const includedInPackage = includedMenuItemIds.has(itemRef.id);
      const pricingMode = normalizePricingType(found?.pricingType || itemRef.pricingMode, "per_event");
      const unitPrice = includedInPackage ? 0 : toNumber(found?.price, 0);
      const active = true;
      const result = active
        ? calculatePriceWithMode({
          pricingMode,
          unitPrice,
          guests,
          quantity: resolveLineQuantity(itemRef.id, menuItemQuantityMap, itemRef.quantity || 1),
          multiplier: addonMultiplier
        })
        : {
          quantity: pricingMode === "per_person" ? Math.max(0, toInt(guests, 0)) : Math.max(1, toInt(itemRef.quantity, 1)),
          total: 0
        };

      menu += result.total;
      lineItems.push(buildLineItem({
        id: itemRef.id,
        category: "menu_item",
        name: toText(found?.name, itemRef.name || itemRef.id),
        pricingMode,
        unitPrice,
        quantity: result.quantity,
        total: result.total,
        meta: {
          active,
          includedInPackage,
          packageId: includedInPackage ? selectedPkg.id : "",
          addonMultiplier
        }
      }));
    });
  } else {
    lineItems.push(buildLineItem({
      id: selectedPkg.id,
      category: "package",
      name: selectedPkg.name,
      pricingMode: "per_person",
      unitPrice: toNumber(selectedPkg?.ppp, 0),
      quantity: 0,
      total: 0,
      meta: {
        packageMultiplier
      }
    }));
  }

  const baseServers = staffingLaborEnabled ? serversInput : 0;
  const baseChefs = staffingLaborEnabled ? chefsInput : 0;
  const baseBartenders = staffingLaborEnabled ? bartenders : 0;
  const appliedAddonServers = 0;
  const appliedAddonChefs = 0;
  const appliedAddonBartenders = 0;
  const servers = baseServers + appliedAddonServers;
  const chefs = baseChefs + appliedAddonChefs;
  const displayBartenders = baseBartenders + appliedAddonBartenders;
  const serverRatesApplied = staffingLaborEnabled
    ? resolveServerRatesApplied(baseServers, laborRates.serverRateApplied, serverRateMixCsv)
    : [];
  const chefRatesApplied = staffingLaborEnabled
    ? resolveChefRatesApplied(baseChefs, laborRates.chefRateApplied, chefRateMixCsv)
    : [];

  const laborHourFactor = staffingChargeMode === "per_event_per_staff" ? 1 : hours;
  const serverLabor = staffingLaborEnabled
    ? serverRatesApplied.reduce((sum, rate) => sum + toNumber(rate, 0), 0) * laborHourFactor
    : 0;
  const chefLabor = staffingLaborEnabled
    ? chefRatesApplied.reduce((sum, rate) => sum + toNumber(rate, 0), 0) * laborHourFactor
    : 0;
  const bartenderLabor = staffingLaborEnabled ? laborRates.bartenderRateApplied * baseBartenders * laborHourFactor : 0;
  const labor = staffingLaborEnabled ? serverLabor + chefLabor + bartenderLabor : 0;

  const travel = baseMiles * standardTravelRate + longDistanceMiles * longDistanceRate;

  const subtotal = base + addons + rentals + menu + labor + travel;
  const serviceFee = guests > 0 ? subtotal * serviceFeePctApplied : 0;
  const tax = guests > 0 ? (base + addons + rentals + menu + serviceFee) * toNumber(taxRegion.rate, 0) : 0;
  const grandTotal = subtotal + serviceFee + tax;
  const depositAmount = grandTotal * toNumber(settings.depositPct, 0);

  lineItems.push(
    buildLineItem({
      id: "labor",
      category: "labor",
      name: "Labor",
      pricingMode: "per_event",
      unitPrice: labor,
      quantity: 1,
      total: labor,
      meta: {
        staffingLaborEnabled,
        staffingChargeMode,
        servers,
        chefs,
        bartenders: displayBartenders,
        baseServers,
        baseChefs,
        baseBartenders,
        addonServers: appliedAddonServers,
        addonChefs: appliedAddonChefs,
        addonBartenders: appliedAddonBartenders,
        serverRatesApplied,
        chefRatesApplied,
        serverLabor,
        chefLabor,
        hours,
        ...laborRates
      }
    }),
    buildLineItem({
      id: "travel",
      category: "travel",
      name: "Travel",
      pricingMode: "per_event",
      unitPrice: travel,
      quantity: 1,
      total: travel,
      meta: {
        milesRT,
        thresholdMiles,
        baseMiles,
        longDistanceMiles,
        standardTravelRate,
        longDistanceRate
      }
    }),
    buildLineItem({
      id: "service_fee",
      category: "service_fee",
      name: "Service Fee",
      pricingMode: "per_event",
      unitPrice: serviceFee,
      quantity: 1,
      total: serviceFee,
      meta: {
        serviceFeePctApplied
      }
    }),
    buildLineItem({
      id: "tax",
      category: "tax",
      name: "Tax",
      pricingMode: "per_event",
      unitPrice: tax,
      quantity: 1,
      total: tax,
      meta: {
        taxRateApplied: toNumber(taxRegion.rate, 0),
        taxRegionId: taxRegion.id,
        taxRegionName: taxRegion.name
      }
    }),
    buildLineItem({
      id: "deposit",
      category: "deposit",
      name: "Deposit",
      pricingMode: "per_event",
      unitPrice: depositAmount,
      quantity: 1,
      total: depositAmount,
      meta: {
        depositPct: toNumber(settings.depositPct, 0)
      }
    })
  );

  const normalizedInputs = {
    organizationId: input.organizationId,
    quoteId: input.quoteId,
    quoteNumber: input.quoteNumber,
    actor: {
      uid: input.actor.uid,
      email: toLowerText(input.actor.email),
      role: input.actor.role
    },
    event: {
      name: input.event.name,
      eventTypeId: input.event.eventTypeId,
      date: input.event.date,
      time: input.event.time,
      venue: input.event.venue,
      venueAddress: input.event.venueAddress,
      guests: Math.max(0, toInt(input.event.guests, 0)),
      hours: Math.max(0, toNumber(input.event.hours, 0)),
      style,
      servers: Math.max(0, toInt(input.event.servers, 0)),
      chefs: Math.max(0, toInt(input.event.chefs, 0)),
      bartenders: Math.max(0, toInt(input.event.bartenders, 0)),
      milesRT,
      taxRegionId: toText(input.event.taxRegionId, taxRegion.id),
      seasonProfileId: toText(input.event.seasonProfileId, toText(seasonProfile?.id))
    },
    selection: {
      package: {
        id: selectedPkg.id,
        name: selectedPkg.name,
        pricingMode: "per_person",
        unitPrice: toNumber(selectedPkg.ppp, 0),
        quantity: 1,
        inclusions: selectedPackageInclusions
      },
      addons: input.selection.addons.map((itemRef) => {
        const found = maps.addonById.get(itemRef.id);
        const includedInPackage = includedAddonIds.has(itemRef.id);
        const pricingMode = normalizePricingType(found?.pricingType || itemRef.pricingMode, "per_person");
        const quantityEnabled = addonSupportsQuantity(found || itemRef, pricingMode);
        const effectivePricingMode = pricingMode === "per_event" && quantityEnabled ? "per_item" : pricingMode;
        return {
          id: itemRef.id,
          name: toText(found?.name, itemRef.name || itemRef.id),
          pricingMode: effectivePricingMode,
          unitPrice: includedInPackage ? 0 : toNumber(found?.price, 0),
          quantity: quantityEnabled
            ? resolveLineQuantity(itemRef.id, addonQuantityMap, itemRef.quantity || 1)
            : 1,
          includedInPackage
        };
      }),
      rentals: input.selection.rentals.map((itemRef) => {
        const found = maps.rentalById.get(itemRef.id);
        const includedInPackage = includedRentalIds.has(itemRef.id);
        const pricingMode = normalizePricingType(found?.pricingType || itemRef.pricingMode, "per_item");
        const defaultQty = pricingMode === "per_item"
          ? Math.max(1, Math.ceil(guests / Math.max(1, toNumber(found?.qtyPerGuests, 1))))
          : 1;
        return {
          id: itemRef.id,
          name: toText(found?.name, itemRef.name || itemRef.id),
          pricingMode,
          unitPrice: includedInPackage ? 0 : toNumber(found?.price, 0),
          quantity: resolveLineQuantity(itemRef.id, rentalQuantityMap, defaultQty),
          includedInPackage
        };
      }),
      menuItems: input.selection.menuItems.map((itemRef) => {
        const found = menuItemById.get(itemRef.id);
        const includedInPackage = includedMenuItemIds.has(itemRef.id);
        return {
          id: itemRef.id,
          name: toText(found?.name, itemRef.name || itemRef.id),
          pricingMode: normalizePricingType(found?.pricingType || itemRef.pricingMode, "per_event"),
          unitPrice: includedInPackage ? 0 : toNumber(found?.price, 0),
          quantity: resolveLineQuantity(itemRef.id, menuItemQuantityMap, itemRef.quantity || 1),
          includedInPackage
        };
      }),
      quantities: {
        addonQuantities: addonQuantityMap,
        rentalQuantities: rentalQuantityMap,
        menuItemQuantities: menuItemQuantityMap
      }
    },
    labor: {
      bartenderRateOverride: input.labor?.bartenderRateOverride ?? "",
      serverRateOverride: input.labor?.serverRateOverride ?? "",
      chefRateOverride: input.labor?.chefRateOverride ?? "",
      serverRateMixCsv,
      chefRateMixCsv
    },
    pricingModes: {
      package: "per_person",
      addonsDefault: "per_person",
      rentalsDefault: "per_item",
      menuDefault: "per_event"
    },
    settings: {
      serviceFeePct: toNumber(settings.serviceFeePct, 0),
      taxRate: toNumber(settings.taxRate, 0),
      depositPct: toNumber(settings.depositPct, 0),
      defaultTaxRegion: toText(settings.defaultTaxRegion),
      defaultSeasonProfile: toText(settings.defaultSeasonProfile),
      staffingChargeMode: normalizeStaffingChargeMode(settings.staffingChargeMode, "per_hour"),
      pricingSettingsVersion: Math.max(0, toInt(settings.pricingSettingsVersion, 0)),
      pricingSettingsUpdatedAtISO: normalizeISO(settings.pricingSettingsUpdatedAtISO, "")
    },
    metadata: {
      source: toText(input.metadata.source),
      generatedAt: normalizeISO(input.metadata.generatedAt, "")
    }
  };

  return {
    pricingVersion: PRICING_VERSION,
    calculatedAt: normalizedInputs.metadata.generatedAt,
    authority: PRICING_AUTHORITY,
    inputs: normalizedInputs,
    lineItems,
    fees: {
      labor,
      serverLabor,
      chefLabor,
      travel,
      bartenderLabor,
      serviceFee
    },
    tax: {
      rate: toNumber(taxRegion.rate, 0),
      amount: tax,
      regionId: toText(taxRegion.id),
      regionName: toText(taxRegion.name)
    },
    discountTotal: 0,
    deposit: {
      pct: toNumber(settings.depositPct, 0),
      amount: depositAmount
    },
    subtotal,
    grandTotal,
    rulesSnapshot: {
      catalogSource,
      serviceFeePctApplied,
      taxRateApplied: toNumber(taxRegion.rate, 0),
      taxRegionId: toText(taxRegion.id),
      taxRegionName: toText(taxRegion.name),
      seasonProfileId: toText(seasonProfile?.id),
      seasonProfileName: toText(seasonProfile?.name),
      packageMultiplier,
      addonMultiplier,
      rentalMultiplier,
      depositPct: toNumber(settings.depositPct, 0),
      pricingSettingsVersion: Math.max(0, toInt(settings.pricingSettingsVersion, 0)),
      pricingSettingsUpdatedAtISO: normalizeISO(settings.pricingSettingsUpdatedAtISO, ""),
      settingsSnapshot: buildRulesSettingsSnapshot(settings),
      staffingChargeMode,
      staffingLaborEnabled,
      laborRateSnapshot: {
        bartenderRateApplied: laborRates.bartenderRateApplied,
        serverRateApplied: laborRates.serverRateApplied,
        serverRatesApplied,
        serverLabor,
        chefRateApplied: laborRates.chefRateApplied,
        chefRatesApplied,
        chefLabor,
        bartenderRateTypeId: laborRates.bartenderRateTypeId,
        bartenderRateTypeName: laborRates.bartenderRateTypeName,
        staffingRateTypeId: laborRates.staffingRateTypeId,
        staffingRateTypeName: laborRates.staffingRateTypeName
      },
      staffing: {
        style,
        servers,
        chefs,
        bartenders: displayBartenders,
        baseServers,
        baseChefs,
        baseBartenders,
        addonServers: appliedAddonServers,
        addonChefs: appliedAddonChefs,
        addonBartenders: appliedAddonBartenders,
        serverRateMixCsv,
        chefRateMixCsv,
        staffingChargeMode,
        hours
      },
      travel: {
        milesRT,
        thresholdMiles,
        baseMiles,
        longDistanceMiles,
        standardTravelRate,
        longDistanceRate
      },
      missingReferences: Array.from(missingReferences),
      pricingModeDefaults: {
        package: "per_person",
        addons: "per_person",
        rentals: "per_item",
        menuItems: "per_event"
      }
    }
  };
}

async function calculateQuotePricingAuthoritative({
  db,
  data = {},
  staff = {},
  organizationsCollection = "organizations"
} = {}) {
  if (!db) {
    throw new PricingEngineError("failed-precondition", "Firestore instance is required.");
  }

  const normalizedInput = normalizePricingInputPayload(data, staff);
  const catalogBundle = await loadCatalogAndSettings(db, organizationsCollection, {
    organizationId: normalizedInput.organizationId
  });
  if (!isCatalogPricingConfirmationCurrent(catalogBundle.settings)) {
    throw new PricingEngineError(
      "failed-precondition",
      "Pricing setup must be reviewed and confirmed for the current catalog revision before authoritative quotes can be calculated."
    );
  }

  const pricing = calculateAuthoritativePricing(
    normalizedInput,
    {
      packages: catalogBundle.packages,
      addons: catalogBundle.addons,
      rentals: catalogBundle.rentals,
      menuItems: catalogBundle.menuItems
    },
    catalogBundle.settings,
    catalogBundle.source
  );

  return {
    organizationId: catalogBundle.organizationId,
    catalogSource: catalogBundle.source,
    pricing
  };
}

module.exports = {
  PRICING_VERSION,
  PRICING_AUTHORITY,
  PricingEngineError,
  calculateQuotePricingAuthoritative,
  isCatalogPricingConfirmationCurrent
};
