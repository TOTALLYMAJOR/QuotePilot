export const DEFAULT_PACKAGES = [
  { id: "classic", name: "Classic", ppp: 18, includedMenuItemIds: [], includedAddonIds: [], includedRentalIds: [] },
  { id: "premium", name: "Premium", ppp: 24, includedMenuItemIds: [], includedAddonIds: [], includedRentalIds: [] },
  { id: "deluxe", name: "Deluxe", ppp: 32, includedMenuItemIds: [], includedAddonIds: [], includedRentalIds: [] }
];

export const DEFAULT_ADDONS = [
  { id: "dessert", name: "Dessert", type: "per_person", price: 3 },
  { id: "tea", name: "Sweet Tea", type: "per_person", price: 1.5 },
  { id: "coffee", name: "Coffee Station", type: "per_event", price: 95 }
];

export const DEFAULT_RENTALS = [
  { id: "linens", name: "Linens", price: 8, qtyPerGuests: 8 },
  { id: "chafers", name: "Chafers", price: 12, qtyPerGuests: 40 }
];

export const DEFAULT_MENU_SECTIONS = [
  {
    id: "appetizers",
    name: "Appetizers",
    items: [
      "Cocktail Meatballs",
      "Assorted Sliders",
      "Finger Sandwiches",
      "Fresh Fruit Kabobs",
      "Assorted Meat Kabobs",
      "Shrimp Kabobs",
      "Assorted Meat Croissants",
      "Veggie Croissants",
      "Veggie Sliders",
      "Heavenly Eggs"
    ]
  },
  {
    id: "meats",
    name: "Meats",
    items: [
      "Roasted Chicken",
      "Beef/Pork Ribs",
      "Roast Beef",
      "Blackened/Grill Fish",
      "Blackened/Grill Shrimp",
      "Teriyaki Glazed Chicken",
      "Smoked Brisket",
      "Pulled Pork/Chicken",
      "Baked Ham",
      "Smothered Chicken",
      "Smothered Pork Chops",
      "Grilled Steak",
      "Roasted Lamb Chops",
      "Roasted/Fried Turkey",
      "Smothered Turkey Wings",
      "Smothered Beef Tips",
      "Meatloaf"
    ]
  },
  {
    id: "salads",
    name: "Salads",
    items: [
      "Classic Caesar",
      "Chicken Caesar",
      "Garden Salad",
      "Strawberry Fields",
      "Classic Greek",
      "Potato Salad",
      "Chicken Salad",
      "Egg Salad",
      "Coleslaw"
    ]
  },
  {
    id: "pastas",
    name: "Pastas",
    items: [
      "Creole Chicken Pasta",
      "Seafood Pasta",
      "Million Dollar Spaghetti",
      "Veggie Alfredo Pasta",
      "Chicken Alfredo Pasta",
      "Shrimp Alfredo Pasta",
      "Beef Alfredo Pasta",
      "Baked Spaghetti",
      "Mac & Cheese"
    ]
  },
  {
    id: "specialty_bars",
    name: "Specialty Bars",
    items: [
      "Taco Bar",
      "Soup Bar",
      "Pasta Bar",
      "Potato Bar",
      "Salad Bar"
    ]
  },
  {
    id: "soups",
    name: "Soups",
    items: [
      "Veggie Beef",
      "Veggie Chicken",
      "Chicken Noodle",
      "Seafood Gumbo",
      "Chicken & Sausage Gumbo",
      "Creamy Potato",
      "Creamy Tomato",
      "Cyakaemen",
      "Red Beans",
      "Pinto Beans",
      "White Beans"
    ]
  },
  {
    id: "sides",
    name: "Sides",
    items: [
      "Jambalaya",
      "Mashed Potatoes",
      "Dirty Rice",
      "Creamy Rice Pilaf",
      "Collards",
      "Cabbage",
      "Green Beans",
      "Glazed Carrots",
      "Roasted Brussel Sprouts",
      "Corn",
      "Creole Corn",
      "Veggie Medley",
      "Creamed Spinach",
      "Etouffee",
      "Baked Beans"
    ]
  },
  {
    id: "desserts",
    name: "Desserts",
    items: [
      "Bread Pudding",
      "Banana Pudding",
      "Assorted Cobblers",
      "Assorted Cakes",
      "Assorted Brownies",
      "Assorted Pies"
    ]
  },
  {
    id: "beverages",
    name: "Beverages",
    items: [
      "Fruit Punch",
      "Assorted Lemonade",
      "Assorted Teas",
      "Coffee",
      "Assorted Juices",
      "Still/Sparkling Water"
    ]
  },
  {
    id: "breads",
    name: "Breads",
    items: [
      "Cornbread Muffins",
      "Hawaiian Rolls",
      "Yeast Rolls",
      "French Bread",
      "Garlic Bread or Knots"
    ]
  }
];

export const DEFAULT_SERVICE_FEE_TIERS = [
  { id: "tier-small", minGuests: 0, maxGuests: 99, pct: 0.2 },
  { id: "tier-mid", minGuests: 100, maxGuests: 249, pct: 0.18 },
  { id: "tier-large", minGuests: 250, maxGuests: 9999, pct: 0.16 }
];

export const DEFAULT_TAX_REGIONS = [
  { id: "local", name: "Local", rate: 0.1 },
  { id: "reduced", name: "Reduced District", rate: 0.085 },
  { id: "out_of_state", name: "Out of State", rate: 0 }
];

export const DEFAULT_EVENT_TEMPLATES = [
  {
    id: "wedding",
    name: "Wedding",
    style: "Plated",
    hours: 6,
    pkg: "deluxe",
    addons: ["dessert", "coffee"],
    rentals: ["linens", "chafers"],
    milesRT: 28,
    payMethod: "card",
    taxRegion: "local",
    seasonProfileId: "auto"
  },
  {
    id: "corporate",
    name: "Corporate",
    style: "Buffet",
    hours: 4,
    pkg: "premium",
    addons: ["tea", "coffee"],
    rentals: ["linens"],
    milesRT: 18,
    payMethod: "ach",
    taxRegion: "reduced",
    seasonProfileId: "standard"
  },
  {
    id: "birthday",
    name: "Birthday",
    style: "Stations",
    hours: 4,
    pkg: "classic",
    addons: ["dessert"],
    rentals: ["linens"],
    milesRT: 16,
    payMethod: "card",
    taxRegion: "local",
    seasonProfileId: "standard"
  },
  {
    id: "church",
    name: "Church",
    style: "Drop-off",
    hours: 2,
    pkg: "classic",
    addons: ["tea"],
    rentals: [],
    milesRT: 14,
    payMethod: "ach",
    taxRegion: "out_of_state",
    seasonProfileId: "standard"
  }
];

export const DEFAULT_SEASONAL_PROFILES = [
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

export const DEFAULT_BRAND_CREW = [];

export const DEFAULT_BARTENDER_RATE_TYPES = [
  { id: "standard", name: "Standard Bartender", rate: 30 },
  { id: "premium", name: "Premium Bartender", rate: 40 }
];

export const DEFAULT_STAFFING_RATE_TYPES = [
  { id: "standard", name: "Standard Staffing", serverRate: 22, chefRate: 28 },
  { id: "senior", name: "Senior Staffing", serverRate: 26, chefRate: 34 }
];

export const DEFAULT_UPSELL_RULES = [
  {
    id: "upsell-dessert",
    name: "Dessert add-on",
    kind: "addon",
    targetId: "dessert",
    enabled: true,
    minGuests: 40,
    minHours: 0,
    reason: "Large guest counts convert better with dessert included."
  },
  {
    id: "upsell-beverage",
    name: "Beverage station",
    kind: "addon",
    targetId: "coffee",
    enabled: true,
    minGuests: 0,
    minHours: 4,
    reason: "Longer events usually need a beverage station or coffee closeout."
  },
  {
    id: "upsell-linens",
    name: "Linen rental",
    kind: "rental",
    targetId: "linens",
    enabled: true,
    minGuests: 80,
    minHours: 0,
    reason: "Linen coverage improves setup polish for larger guest counts."
  },
  {
    id: "upsell-package-upgrade",
    name: "Package upgrade",
    kind: "package",
    targetId: "",
    enabled: true,
    minGuests: 130,
    minHours: 0,
    reason: "High-capacity events often benefit from premium menu throughput."
  }
];

export const DEFAULT_FEATURE_FLAGS = {
  customerPortal: true,
  eventSchedule: true,
  integrationsOps: true,
  diagnostics: true,
  reportingDashboard: true,
  quoteCompare: true,
  crmSync: true,
  guidedSelling: true,
  aiAssist: true,
  aiAutopilot: false
};

export const DEFAULT_SETTINGS = {
  perMileRate: 0.7,
  longDistancePerMileRate: 1.1,
  deliveryThresholdMiles: 30,
  capacityLimit: 400,
  bartenderRate: 30,
  bartenderRateTypes: DEFAULT_BARTENDER_RATE_TYPES,
  defaultBartenderRateType: "standard",
  serviceFeePct: 0.2,
  serviceFeeTiers: DEFAULT_SERVICE_FEE_TIERS,
  taxRate: 0.1,
  taxRegions: DEFAULT_TAX_REGIONS,
  defaultTaxRegion: "local",
  menuSections: [],
  depositPct: 0.3,
  quoteValidityDays: 30,
  serverRate: 22,
  chefRate: 28,
  serverCostRate: null,
  chefCostRate: null,
  bartenderCostRate: null,
  targetMarginPct: null,
  staffingChargeMode: "per_hour",
  staffingRateTypes: DEFAULT_STAFFING_RATE_TYPES,
  defaultStaffingRateType: "standard",
  quotePreparedBy: "Sales Team",
  brandName: "QuotePilot",
  brandTagline: "Quote-to-event operations by MBMApps",
  brandLogoUrl: "",
  brandPrimaryColor: "#c99334",
  brandAccentColor: "#f0d29a",
  brandDarkAccentColor: "#8d611a",
  brandBackgroundStart: "#100d09",
  brandBackgroundMid: "#221a12",
  brandBackgroundEnd: "#ae7d2b",
  heroEyebrow: "Quote-to-Event Operations",
  heroHeadline: "Clearer quotes. Connected event operations.",
  heroDescription:
    "Build guided quotes, compare scenarios, send proposals, and keep customer decisions, payment state, and event production connected.",
  brandCrew: DEFAULT_BRAND_CREW,
  businessPhone: "",
  businessEmail: "",
  businessAddress: "",
  businessTimeZone: "",
  acceptanceEmail: "",
  disposablesNote: "All disposables are included in this quote.",
  depositNotice: "30% deposit is required to lock in your date.",
  crmEnabled: false,
  crmProvider: "webhook",
  crmWebhookUrl: "",
  crmWebhookBridgeUrl: "",
  crmHubspotBridgeUrl: "",
  crmSalesforceBridgeUrl: "",
  crmBridgeAuthToken: "",
  crmAutoSyncOnSent: true,
  crmAutoSyncOnBooked: true,
  integrationRetryLimit: 3,
  integrationAuditRetention: 50,
  pricingSettingsVersion: 0,
  pricingSettingsUpdatedAtISO: "",
  pricingSetupConfirmed: true,
  catalogRevision: 0,
  pricingConfirmation: null,
  featureFlags: { ...DEFAULT_FEATURE_FLAGS },
  guidedSellingEnabled: true,
  staffingLaborEnabled: true,
  upsellRules: DEFAULT_UPSELL_RULES,
  eventTemplates: DEFAULT_EVENT_TEMPLATES,
  seasonalProfiles: DEFAULT_SEASONAL_PROFILES,
  defaultSeasonProfile: "auto"
};

export const STAFF_RULES = {
  Buffet: { serverRatio: 25, minServers: 2, chefRatio: Number.POSITIVE_INFINITY },
  Plated: { serverRatio: 12, minServers: 3, chefRatio: 50 },
  Stations: { serverRatio: 20, minServers: 2, chefRatio: 75 },
  "Drop-off": { serverRatio: Number.POSITIVE_INFINITY, minServers: 0, chefRatio: Number.POSITIVE_INFINITY }
};

function toNumber(value, fallback = 0, min = Number.NEGATIVE_INFINITY, max = Number.POSITIVE_INFINITY) {
  const n = Number(value);
  if (Number.isNaN(n)) return fallback;
  return Math.min(max, Math.max(min, n));
}

// Tenant cost fields are optional and staff-only: blank must mean "not
// recorded" (margin stays unavailable), never a coerced 0, since a
// deliberate $0 cost is a distinct, valid input from silence.
function toNullableNumber(value) {
  if (value === "" || value === null || value === undefined) return null;
  const n = Number(value);
  return Number.isFinite(n) ? n : null;
}

// fromMinorUnits() alone cannot represent "not recorded": Number(null) is 0,
// a safe integer, so it silently returns 0/100 instead of the fallback.
// Cost-minor fields need the null case caught before it ever reaches that
// coercion.
function fromNullableMinorUnits(value) {
  if (value === null || value === undefined) return null;
  return fromMinorUnits(value, null);
}

function fromMinorUnits(value, fallback = 0) {
  const minor = Number(value);
  return Number.isSafeInteger(minor) ? minor / 100 : fallback;
}

function normalizeId(value, fallback) {
  const raw = String(value || fallback || "").trim().toLowerCase();
  const sanitized = raw.replace(/[^\w-]+/g, "-").replace(/-{2,}/g, "-").replace(/^-|-$/g, "");
  return sanitized || fallback;
}

function normalizeISO(value, fallback = "") {
  const raw = String(value || "").trim();
  if (!raw) return fallback;
  const parsed = new Date(raw);
  return Number.isNaN(parsed.getTime()) ? fallback : parsed.toISOString();
}

function normalizePricingType(value, fallback = "per_event") {
  const raw = String(value || fallback || "").trim().toLowerCase();
  if (raw === "per_person" || raw === "per_item" || raw === "per_event") {
    return raw;
  }
  return fallback;
}

function normalizeAddonStaffRole(value, fallback = "") {
  const raw = String(value || fallback || "").trim().toLowerCase();
  if (raw === "server" || raw === "chef" || raw === "bartender") return raw;
  return "";
}

function normalizeStableIdList(value) {
  const seen = new Set();
  return (Array.isArray(value) ? value : [])
    .map((item) => String(item || "").trim())
    .filter((item) => {
      if (!item || seen.has(item)) return false;
      seen.add(item);
      return true;
    })
    .slice(0, 100);
}

function inferAddonStaffRole(addon = {}) {
  const hasExplicitField = Object.prototype.hasOwnProperty.call(addon, "staffRole");
  const explicitRole = normalizeAddonStaffRole(addon?.staffRole);
  if (explicitRole) return explicitRole;
  if (hasExplicitField) return "";

  const source = `${String(addon?.id || "")} ${String(addon?.name || "")}`.trim().toLowerCase();
  if (!source) return "";
  if (source.includes("bartender") || source.includes("bar tender")) return "bartender";
  if (source.includes("chef")) return "chef";
  if (source.includes("server") || source.includes("event staff")) return "server";
  return "";
}

function normalizeStaffingChargeMode(value, fallback = "per_hour") {
  const raw = String(value || fallback).trim().toLowerCase();
  if (raw === "per_event_per_staff") return "per_event_per_staff";
  return "per_hour";
}

const CRM_PROVIDER_SET = new Set(["webhook", "webhook_bridge", "hubspot", "salesforce"]);

function normalizeCrmProvider(value, fallback = "webhook") {
  const raw = String(value || fallback).trim().toLowerCase();
  if (!raw || raw === "crm") return "webhook";
  if (raw === "webhook-bridge") return "webhook_bridge";
  return CRM_PROVIDER_SET.has(raw) ? raw : fallback;
}

function normalizeServiceFeeTiers(input) {
  const source = Array.isArray(input) ? input : DEFAULT_SERVICE_FEE_TIERS;
  return source
    .map((item, idx) => {
      const minGuests = toNumber(item.minGuests, 0, 0);
      const maxGuests = toNumber(item.maxGuests, 9999, minGuests);
      return {
        id: normalizeId(item.id, `tier-${idx + 1}`),
        minGuests,
        maxGuests,
        pct: toNumber(item.pct, 0.2, 0, 1)
      };
    })
    .sort((a, b) => a.minGuests - b.minGuests);
}

function normalizeTaxRegions(input) {
  const source = Array.isArray(input) ? input : DEFAULT_TAX_REGIONS;
  return source.map((item, idx) => ({
    id: normalizeId(item.id, `region-${idx + 1}`),
    name: String(item.name || `Region ${idx + 1}`),
    rate: toNumber(item.rate, 0.1, 0, 1)
  }));
}

function normalizeTemplate(item, idx) {
  return {
    id: normalizeId(item.id, `template-${idx + 1}`),
    name: String(item.name || `Template ${idx + 1}`),
    style: String(item.style || "Buffet"),
    hours: toNumber(item.hours, 4, 1, 12),
    bartenders: toNumber(item.bartenders, 0, 0, 20),
    pkg: String(item.pkg || "classic"),
    addons: Array.isArray(item.addons) ? item.addons.map((id) => String(id)) : [],
    rentals: Array.isArray(item.rentals) ? item.rentals.map((id) => String(id)) : [],
    menuItems: Array.isArray(item.menuItems) ? item.menuItems.map((id) => String(id)) : [],
    milesRT: toNumber(item.milesRT, 0, 0),
    payMethod: item.payMethod === "ach" ? "ach" : "card",
    taxRegion: String(item.taxRegion || ""),
    seasonProfileId: String(item.seasonProfileId || "auto"),
    eventTypeId: String(item.eventTypeId || ""),
    bartenderRateTypeId: String(item.bartenderRateTypeId || ""),
    staffingRateTypeId: String(item.staffingRateTypeId || ""),
    bartenderRateOverride:
      item.bartenderRateOverride === "" || item.bartenderRateOverride === null || item.bartenderRateOverride === undefined
        ? ""
        : toNumber(item.bartenderRateOverride, 0, 0),
    serverRateOverride:
      item.serverRateOverride === "" || item.serverRateOverride === null || item.serverRateOverride === undefined
        ? ""
        : toNumber(item.serverRateOverride, 0, 0),
    serverRateMixCsv: toText(item.serverRateMixCsv),
    chefRateMixCsv: toText(item.chefRateMixCsv),
    chefRateOverride:
      item.chefRateOverride === "" || item.chefRateOverride === null || item.chefRateOverride === undefined
        ? ""
        : toNumber(item.chefRateOverride, 0, 0)
  };
}

function normalizeEventTemplates(input) {
  const source = Array.isArray(input) ? input : DEFAULT_EVENT_TEMPLATES;
  return source.map((item, idx) => normalizeTemplate(item, idx));
}

function normalizeBartenderRateTypes(input, fallbackRate = DEFAULT_SETTINGS.bartenderRate) {
  const source = Array.isArray(input)
    ? input
    : [{ id: "default", name: "Default Bartender", rate: fallbackRate }];
  const seen = new Set();
  return source
    .map((item, idx) => ({
      id: normalizeId(item?.id, `bartender-rate-${idx + 1}`),
      name: toText(item?.name, `Bartender Type ${idx + 1}`),
      rate: Object.prototype.hasOwnProperty.call(item || {}, "rateMinor")
        ? fromMinorUnits(item.rateMinor, fallbackRate)
        : toNumber(item?.rate, fallbackRate, 0)
    }))
    .filter((item) => {
      if (!item.id || seen.has(item.id)) return false;
      seen.add(item.id);
      return true;
    });
}

function normalizeStaffingRateTypes(input, {
  fallbackServerRate = DEFAULT_SETTINGS.serverRate,
  fallbackChefRate = DEFAULT_SETTINGS.chefRate
} = {}) {
  const source = Array.isArray(input)
    ? input
    : [{ id: "default", name: "Default Staffing", serverRate: fallbackServerRate, chefRate: fallbackChefRate }];
  const seen = new Set();
  return source
    .map((item, idx) => ({
      id: normalizeId(item?.id, `staffing-rate-${idx + 1}`),
      name: toText(item?.name, `Staffing Type ${idx + 1}`),
      serverRate: Object.prototype.hasOwnProperty.call(item || {}, "serverRateMinor")
        ? fromMinorUnits(item.serverRateMinor, fallbackServerRate)
        : toNumber(item?.serverRate, fallbackServerRate, 0),
      chefRate: Object.prototype.hasOwnProperty.call(item || {}, "chefRateMinor")
        ? fromMinorUnits(item.chefRateMinor, fallbackChefRate)
        : toNumber(item?.chefRate, fallbackChefRate, 0)
    }))
    .filter((item) => {
      if (!item.id || seen.has(item.id)) return false;
      seen.add(item.id);
      return true;
    });
}

function normalizeMenuSections(input) {
  const source = Array.isArray(input) ? input : [];
  return source.map((section, idx) => {
    const sectionId = normalizeId(section.id, `menu-${idx + 1}`);
    const rawItems = Array.isArray(section.items) ? section.items : [];
    const seen = new Set();
    const items = rawItems
      .map((item, itemIdx) => {
        if (typeof item === "string") {
          const name = item.trim();
          const id = normalizeId(name, `${sectionId}-item-${itemIdx + 1}`);
          return { id, name, price: 0, pricingType: "per_event", type: "per_event", active: true };
        }
        const name = String(item?.name || "").trim();
        const id = normalizeId(item?.id, `${sectionId}-item-${itemIdx + 1}`);
        const pricingType = normalizePricingType(item?.pricingType || item?.type, "per_event");
        return {
          id,
          name,
          price: Object.prototype.hasOwnProperty.call(item || {}, "priceMinor")
            ? fromMinorUnits(item.priceMinor, 0)
            : toNumber(item?.price, 0, 0),
          pricingType,
          type: pricingType,
          active: item?.active !== false
        };
      })
      .filter((item) => {
        if (!item.name || !item.id || seen.has(item.id)) return false;
        seen.add(item.id);
        return true;
      });

    return {
      id: sectionId,
      name: String(section.name || `Menu ${idx + 1}`),
      items
    };
  });
}

function normalizeSeasonalProfiles(input) {
  const source = Array.isArray(input) ? input : DEFAULT_SEASONAL_PROFILES;
  return source.map((item, idx) => ({
    id: normalizeId(item.id, `season-${idx + 1}`),
    name: String(item.name || `Season ${idx + 1}`),
    startMonth: toNumber(item.startMonth, 1, 1, 12),
    startDay: toNumber(item.startDay, 1, 1, 31),
    endMonth: toNumber(item.endMonth, 12, 1, 12),
    endDay: toNumber(item.endDay, 31, 1, 31),
    packageMultiplier: toNumber(item.packageMultiplier, 1, 0.5, 2),
    addonMultiplier: toNumber(item.addonMultiplier, 1, 0.5, 2),
    rentalMultiplier: toNumber(item.rentalMultiplier, 1, 0.5, 2)
  }));
}

function normalizeBrandCrew(input) {
  const source = Array.isArray(input) ? input : DEFAULT_BRAND_CREW;
  return source
    .map((item, idx) => ({
      label: toText(item?.label, `Team Member ${idx + 1}`),
      imageUrl: toText(item?.imageUrl, "")
    }))
    .filter((item) => Boolean(item.label))
    .slice(0, 4);
}

function normalizeUpsellRuleKind(value, fallback = "addon") {
  const kind = String(value || fallback).trim().toLowerCase();
  if (kind === "addon" || kind === "rental" || kind === "package") return kind;
  return fallback;
}

function defaultUpsellReason(kind) {
  if (kind === "addon") return "Promote add-ons when quote conditions match.";
  if (kind === "rental") return "Promote rental upgrades when quote conditions match.";
  return "Recommend moving to a higher package for larger events.";
}

function defaultUpsellName(kind) {
  if (kind === "addon") return "Add-on recommendation";
  if (kind === "rental") return "Rental recommendation";
  return "Package recommendation";
}

function normalizeUpsellRules(input, { packages = [], addons = [], rentals = [] } = {}) {
  const source = Array.isArray(input) ? input : DEFAULT_UPSELL_RULES;
  const addonIds = new Set(addons.map((item) => String(item.id)));
  const rentalIds = new Set(rentals.map((item) => String(item.id)));
  const packageIds = new Set(packages.map((item) => String(item.id)));
  const fallbackAddonId = addons[0]?.id ? String(addons[0].id) : "";
  const fallbackRentalId = rentals[0]?.id ? String(rentals[0].id) : "";
  const fallbackPackageId = packages[0]?.id ? String(packages[0].id) : "";

  return source
    .map((item, idx) => {
      const kind = normalizeUpsellRuleKind(item?.kind, "addon");
      const rawTargetId = String(item?.targetId || "").trim();

      let targetId = "";
      if (kind === "addon") {
        targetId = addonIds.has(rawTargetId) ? rawTargetId : fallbackAddonId;
      } else if (kind === "rental") {
        targetId = rentalIds.has(rawTargetId) ? rawTargetId : fallbackRentalId;
      } else {
        targetId = packageIds.has(rawTargetId) ? rawTargetId : "";
      }

      if (kind === "package" && targetId === fallbackPackageId) {
        targetId = "";
      }

      return {
        id: normalizeId(item?.id, `upsell-rule-${idx + 1}`),
        name: toText(item?.name, defaultUpsellName(kind)),
        kind,
        targetId,
        enabled: toBoolean(item?.enabled, true),
        minGuests: toNumber(item?.minGuests, 0, 0, 400),
        minHours: toNumber(item?.minHours, 0, 0, 24),
        reason: toText(item?.reason, defaultUpsellReason(kind))
      };
    })
    .slice(0, 12);
}

function toText(value, fallback = "") {
  const text = String(value ?? "").trim();
  return text || fallback;
}

function hasOwnSetting(settings, key) {
  return Object.prototype.hasOwnProperty.call(settings || {}, key);
}

function toTenantText(settings, key, fallback = "") {
  if (!hasOwnSetting(settings, key)) return fallback;
  return String(settings?.[key] ?? "").trim();
}

function normalizeIanaTimeZone(value, fallback = "") {
  const requested = String(value || "").trim();
  if (!requested) return fallback;
  try {
    return new Intl.DateTimeFormat("en-US", { timeZone: requested })
      .resolvedOptions()
      .timeZone;
  } catch {
    return fallback;
  }
}

function toBoolean(value, fallback = false) {
  if (typeof value === "boolean") return value;
  if (typeof value === "number") return value !== 0;
  if (typeof value === "string") {
    const text = value.trim().toLowerCase();
    if (["true", "1", "yes", "on"].includes(text)) return true;
    if (["false", "0", "no", "off"].includes(text)) return false;
  }
  return fallback;
}

function normalizeFeatureFlags(input, legacySettings = {}) {
  const source = input && typeof input === "object" ? input : {};
  const aiAssist = toBoolean(source.aiAssist, DEFAULT_FEATURE_FLAGS.aiAssist);
  return {
    customerPortal: toBoolean(source.customerPortal, DEFAULT_FEATURE_FLAGS.customerPortal),
    eventSchedule: toBoolean(source.eventSchedule, DEFAULT_FEATURE_FLAGS.eventSchedule),
    integrationsOps: toBoolean(source.integrationsOps, DEFAULT_FEATURE_FLAGS.integrationsOps),
    diagnostics: toBoolean(source.diagnostics, DEFAULT_FEATURE_FLAGS.diagnostics),
    reportingDashboard: toBoolean(source.reportingDashboard, DEFAULT_FEATURE_FLAGS.reportingDashboard),
    quoteCompare: toBoolean(source.quoteCompare, DEFAULT_FEATURE_FLAGS.quoteCompare),
    crmSync: toBoolean(source.crmSync, toBoolean(legacySettings.crmEnabled, DEFAULT_FEATURE_FLAGS.crmSync)),
    guidedSelling: toBoolean(
      source.guidedSelling,
      toBoolean(legacySettings.guidedSellingEnabled, DEFAULT_FEATURE_FLAGS.guidedSelling)
    ),
    aiAssist,
    aiAutopilot: aiAssist && toBoolean(source.aiAutopilot, DEFAULT_FEATURE_FLAGS.aiAutopilot)
  };
}

function normalizeHexColor(value, fallback) {
  const raw = String(value || "").trim();
  if (/^#[\da-fA-F]{6}$/.test(raw)) {
    return raw.toLowerCase();
  }
  if (/^#[\da-fA-F]{3}$/.test(raw)) {
    const v = raw.slice(1).toLowerCase();
    return `#${v[0]}${v[0]}${v[1]}${v[1]}${v[2]}${v[2]}`;
  }
  return fallback;
}

export function normalizeRental(item) {
  const qtyPerGuests = Number(item.qtyPerGuests || 1);
  const pricingType = normalizePricingType(item.pricingType || item.type, "per_item");
  return {
    ...item,
    pricingType,
    type: pricingType,
    active: item.active !== false,
    qtyPerGuests,
    qtyRule: (guests) => Math.max(1, Math.ceil(guests / qtyPerGuests))
  };
}

export function normalizeCatalog(raw) {
  const inputSettings = raw.settings && typeof raw.settings === "object" ? raw.settings : {};
  const pricingSetupConfirmed = hasOwnSetting(inputSettings, "pricingSetupConfirmed")
    && toBoolean(inputSettings.pricingSetupConfirmed, false);
  const pricingValue = (key, confirmedFallback, unconfirmedFallback) => {
    if (hasOwnSetting(inputSettings, key)) return inputSettings[key];
    return pricingSetupConfirmed ? confirmedFallback : unconfirmedFallback;
  };
  const pricingMoneyValue = (legacyKey, minorKey, confirmedFallback, unconfirmedFallback) => {
    if (hasOwnSetting(inputSettings, minorKey)) {
      return fromMinorUnits(inputSettings[minorKey], unconfirmedFallback);
    }
    return pricingValue(legacyKey, confirmedFallback, unconfirmedFallback);
  };
  const hasEmptyServiceFeeTiers = Array.isArray(inputSettings.serviceFeeTiers)
    && inputSettings.serviceFeeTiers.length === 0;
  const hasEmptyTaxRegions = Array.isArray(inputSettings.taxRegions)
    && inputSettings.taxRegions.length === 0;
  const hasEmptyBartenderRateTypes = Array.isArray(inputSettings.bartenderRateTypes)
    && inputSettings.bartenderRateTypes.length === 0;
  const hasEmptyStaffingRateTypes = Array.isArray(inputSettings.staffingRateTypes)
    && inputSettings.staffingRateTypes.length === 0;
  const rawSettings = {
    ...DEFAULT_SETTINGS,
    ...inputSettings
  };
  const packages = (raw.packages || DEFAULT_PACKAGES).map((p) => ({
    id: p.id,
    name: p.name,
    ppp: Object.prototype.hasOwnProperty.call(p || {}, "pppMinor")
      ? fromMinorUnits(p.pppMinor, 0)
      : Number(p.ppp || 0),
    costPpp: Object.prototype.hasOwnProperty.call(p || {}, "costPppMinor")
      ? fromNullableMinorUnits(p.costPppMinor)
      : toNullableNumber(p.costPpp),
    includedMenuItemIds: normalizeStableIdList(p.includedMenuItemIds),
    includedAddonIds: normalizeStableIdList(p.includedAddonIds),
    includedRentalIds: normalizeStableIdList(p.includedRentalIds),
    active: p.active !== false
  }));
  const addons = (raw.addons || DEFAULT_ADDONS).map((a) => ({
    id: a.id,
    name: a.name,
    pricingType: normalizePricingType(a.pricingType || a.type, "per_person"),
    type: normalizePricingType(a.pricingType || a.type, "per_person"),
    price: Object.prototype.hasOwnProperty.call(a || {}, "priceMinor")
      ? fromMinorUnits(a.priceMinor, 0)
      : Number(a.price || 0),
    cost: Object.prototype.hasOwnProperty.call(a || {}, "costMinor")
      ? fromNullableMinorUnits(a.costMinor)
      : toNullableNumber(a.cost),
    staffRole: inferAddonStaffRole(a),
    active: a.active !== false
  }));
  const rentals = (raw.rentals || DEFAULT_RENTALS).map((r) =>
    normalizeRental({
      id: r.id,
      name: r.name,
      price: Object.prototype.hasOwnProperty.call(r || {}, "priceMinor")
        ? fromMinorUnits(r.priceMinor, 0)
        : Number(r.price || 0),
      cost: Object.prototype.hasOwnProperty.call(r || {}, "costMinor")
        ? fromNullableMinorUnits(r.costMinor)
        : toNullableNumber(r.cost),
      qtyPerGuests: Number(r.qtyPerGuests || 1),
      pricingType: normalizePricingType(r.pricingType || r.type, "per_item"),
      type: normalizePricingType(r.pricingType || r.type, "per_item"),
      active: r.active !== false
    })
  );
  const serviceFeeTiers = normalizeServiceFeeTiers(pricingValue(
    "serviceFeeTiers",
    DEFAULT_SERVICE_FEE_TIERS,
    [{ id: "unconfigured", minGuests: 0, maxGuests: 9999, pct: 0 }]
  ));
  const taxRegions = normalizeTaxRegions(pricingValue(
    "taxRegions",
    DEFAULT_TAX_REGIONS,
    [{ id: "unconfigured", name: "Not configured", rate: 0 }]
  ));
  const packageIds = new Set(packages.map((item) => String(item.id || "").trim()).filter(Boolean));
  const eventTemplates = normalizeEventTemplates(pricingValue(
    "eventTemplates",
    DEFAULT_EVENT_TEMPLATES,
    []
  ))
    .filter((template) => packageIds.has(String(template.pkg || "").trim()));
  const menuSections = normalizeMenuSections(rawSettings.menuSections);
  const seasonalProfiles = normalizeSeasonalProfiles(pricingValue(
    "seasonalProfiles",
    DEFAULT_SEASONAL_PROFILES,
    [{
      id: "standard",
      name: "Standard pricing",
      startMonth: 1,
      startDay: 1,
      endMonth: 12,
      endDay: 31,
      packageMultiplier: 1,
      addonMultiplier: 1,
      rentalMultiplier: 1
    }]
  ));
  const bartenderRate = toNumber(
    pricingMoneyValue(
      "bartenderRate",
      "bartenderRateMinor",
      hasEmptyBartenderRateTypes ? 0 : DEFAULT_SETTINGS.bartenderRate,
      0
    ),
    0,
    0
  );
  const serverRate = toNumber(
    pricingMoneyValue(
      "serverRate",
      "serverRateMinor",
      hasEmptyStaffingRateTypes ? 0 : DEFAULT_SETTINGS.serverRate,
      0
    ),
    0,
    0
  );
  const chefRate = toNumber(
    pricingMoneyValue(
      "chefRate",
      "chefRateMinor",
      hasEmptyStaffingRateTypes ? 0 : DEFAULT_SETTINGS.chefRate,
      0
    ),
    0,
    0
  );
  const bartenderRateTypes = normalizeBartenderRateTypes(pricingValue(
    "bartenderRateTypes",
    DEFAULT_BARTENDER_RATE_TYPES,
    [{ id: "unconfigured", name: "Unconfigured bartender rate", rate: 0 }]
  ), bartenderRate);
  const staffingRateTypes = normalizeStaffingRateTypes(pricingValue(
    "staffingRateTypes",
    DEFAULT_STAFFING_RATE_TYPES,
    [{
      id: "unconfigured",
      name: "Unconfigured staffing rate",
      serverRate: 0,
      chefRate: 0
    }]
  ), {
    fallbackServerRate: serverRate,
    fallbackChefRate: chefRate
  });
  const brandCrew = normalizeBrandCrew(rawSettings.brandCrew);
  const upsellRules = normalizeUpsellRules(pricingValue(
    "upsellRules",
    DEFAULT_UPSELL_RULES,
    []
  ), { packages, addons, rentals });
  const featureFlags = normalizeFeatureFlags(rawSettings.featureFlags, rawSettings);
  const requestedDefaultTaxRegion = String(pricingValue(
    "defaultTaxRegion",
    DEFAULT_SETTINGS.defaultTaxRegion,
    taxRegions[0]?.id || ""
  ) || "").trim();
  const defaultTaxRegion = taxRegions.some((region) => region.id === requestedDefaultTaxRegion)
    ? requestedDefaultTaxRegion
    : taxRegions[0]?.id || "";
  const requestedDefaultSeasonProfile = String(pricingValue(
    "defaultSeasonProfile",
    DEFAULT_SETTINGS.defaultSeasonProfile,
    seasonalProfiles[0]?.id || "auto"
  ) || "").trim();
  const defaultSeasonProfile =
    requestedDefaultSeasonProfile === "auto" ||
    seasonalProfiles.some((profile) => profile.id === requestedDefaultSeasonProfile)
      ? requestedDefaultSeasonProfile
      : seasonalProfiles[0]?.id || "auto";
  const fallbackTaxRate = taxRegions.find((region) => region.id === defaultTaxRegion)?.rate;
  const requestedDefaultBartenderRateType = toText(
    pricingValue(
      "defaultBartenderRateType",
      DEFAULT_SETTINGS.defaultBartenderRateType,
      bartenderRateTypes[0]?.id || ""
    ),
    bartenderRateTypes[0]?.id || ""
  );
  const requestedDefaultStaffingRateType = toText(
    pricingValue(
      "defaultStaffingRateType",
      DEFAULT_SETTINGS.defaultStaffingRateType,
      staffingRateTypes[0]?.id || ""
    ),
    staffingRateTypes[0]?.id || ""
  );
  const defaultBartenderRateType = bartenderRateTypes.some((item) => item.id === requestedDefaultBartenderRateType)
    ? requestedDefaultBartenderRateType
    : bartenderRateTypes[0]?.id || "";
  const defaultStaffingRateType = staffingRateTypes.some((item) => item.id === requestedDefaultStaffingRateType)
    ? requestedDefaultStaffingRateType
    : staffingRateTypes[0]?.id || "";

  // A provisioned tenant can intentionally leave identity fields blank. Only
  // missing fields should inherit the legacy single-tenant defaults.
  const customBrandName = toText(inputSettings.brandName, "");
  const tenantBrandFallbacks = customBrandName && customBrandName !== DEFAULT_SETTINGS.brandName
    ? {
        brandPrimaryColor: "#1f2937",
        brandAccentColor: "#4b5563",
        brandDarkAccentColor: "#111827",
        brandBackgroundStart: "#f3f4f6",
        brandBackgroundMid: "#e5e7eb",
        brandBackgroundEnd: "#d1d5db",
        heroEyebrow: "Event Catering Workspace",
        heroHeadline: `${customBrandName} Quote Operations`,
        heroDescription: "Build quotes, configure pricing, and manage proposals from one workspace."
      }
    : DEFAULT_SETTINGS;

  return {
    packages,
    addons,
    rentals,
    settings: {
      ...rawSettings,
      perMileRate: toNumber(
        pricingMoneyValue("perMileRate", "perMileRateMinor", DEFAULT_SETTINGS.perMileRate, 0),
        0,
        0
      ),
      longDistancePerMileRate: toNumber(
        pricingMoneyValue(
          "longDistancePerMileRate",
          "longDistancePerMileRateMinor",
          DEFAULT_SETTINGS.longDistancePerMileRate,
          0
        ),
        0,
        0
      ),
      deliveryThresholdMiles: toNumber(
        pricingValue("deliveryThresholdMiles", DEFAULT_SETTINGS.deliveryThresholdMiles, 0),
        0,
        0
      ),
      capacityLimit: toNumber(
        pricingValue("capacityLimit", DEFAULT_SETTINGS.capacityLimit, 1),
        1,
        1
      ),
      bartenderRate,
      bartenderRateTypes,
      defaultBartenderRateType,
      serviceFeePct: toNumber(
        pricingValue(
          "serviceFeePct",
          hasEmptyServiceFeeTiers ? 0 : DEFAULT_SETTINGS.serviceFeePct,
          0
        ),
        0,
        0,
        1
      ),
      serviceFeeTiers,
      taxRate: toNumber(
        pricingValue(
          "taxRate",
          hasEmptyTaxRegions ? 0 : fallbackTaxRate ?? DEFAULT_SETTINGS.taxRate,
          0
        ),
        0,
        0,
        1
      ),
      taxRegions,
      defaultTaxRegion,
      menuSections,
      depositPct: toNumber(
        pricingValue("depositPct", DEFAULT_SETTINGS.depositPct, 0),
        0,
        0,
        1
      ),
      quoteValidityDays: toNumber(
        pricingValue("quoteValidityDays", DEFAULT_SETTINGS.quoteValidityDays, 1),
        1,
        1
      ),
      serverRate,
      chefRate,
      serverCostRate: toNullableNumber(rawSettings.serverCostRate),
      chefCostRate: toNullableNumber(rawSettings.chefCostRate),
      bartenderCostRate: toNullableNumber(rawSettings.bartenderCostRate),
      targetMarginPct: toNullableNumber(rawSettings.targetMarginPct),
      staffingChargeMode: normalizeStaffingChargeMode(
        rawSettings.staffingChargeMode,
        DEFAULT_SETTINGS.staffingChargeMode
      ),
      staffingRateTypes,
      defaultStaffingRateType,
      quotePreparedBy: toTenantText(inputSettings, "quotePreparedBy", DEFAULT_SETTINGS.quotePreparedBy),
      brandName: toTenantText(inputSettings, "brandName", DEFAULT_SETTINGS.brandName),
      brandTagline: toTenantText(inputSettings, "brandTagline", DEFAULT_SETTINGS.brandTagline),
      brandLogoUrl: toTenantText(inputSettings, "brandLogoUrl", DEFAULT_SETTINGS.brandLogoUrl),
      brandPrimaryColor: normalizeHexColor(inputSettings.brandPrimaryColor, tenantBrandFallbacks.brandPrimaryColor),
      brandAccentColor: normalizeHexColor(inputSettings.brandAccentColor, tenantBrandFallbacks.brandAccentColor),
      brandDarkAccentColor: normalizeHexColor(inputSettings.brandDarkAccentColor, tenantBrandFallbacks.brandDarkAccentColor),
      brandBackgroundStart: normalizeHexColor(inputSettings.brandBackgroundStart, tenantBrandFallbacks.brandBackgroundStart),
      brandBackgroundMid: normalizeHexColor(inputSettings.brandBackgroundMid, tenantBrandFallbacks.brandBackgroundMid),
      brandBackgroundEnd: normalizeHexColor(inputSettings.brandBackgroundEnd, tenantBrandFallbacks.brandBackgroundEnd),
      heroEyebrow: toTenantText(inputSettings, "heroEyebrow", tenantBrandFallbacks.heroEyebrow),
      heroHeadline: toTenantText(inputSettings, "heroHeadline", tenantBrandFallbacks.heroHeadline),
      heroDescription: toTenantText(inputSettings, "heroDescription", tenantBrandFallbacks.heroDescription),
      brandCrew,
      businessPhone: toTenantText(inputSettings, "businessPhone", DEFAULT_SETTINGS.businessPhone),
      businessEmail: toTenantText(inputSettings, "businessEmail", DEFAULT_SETTINGS.businessEmail),
      businessAddress: toTenantText(inputSettings, "businessAddress", DEFAULT_SETTINGS.businessAddress),
      businessTimeZone: normalizeIanaTimeZone(
        toTenantText(inputSettings, "businessTimeZone", DEFAULT_SETTINGS.businessTimeZone),
        DEFAULT_SETTINGS.businessTimeZone
      ),
      acceptanceEmail: toTenantText(inputSettings, "acceptanceEmail", DEFAULT_SETTINGS.acceptanceEmail),
      disposablesNote: toTenantText(
        inputSettings,
        "disposablesNote",
        pricingSetupConfirmed ? DEFAULT_SETTINGS.disposablesNote : ""
      ),
      depositNotice: toTenantText(
        inputSettings,
        "depositNotice",
        pricingSetupConfirmed ? DEFAULT_SETTINGS.depositNotice : ""
      ),
      crmEnabled: toBoolean(rawSettings.crmEnabled, DEFAULT_SETTINGS.crmEnabled),
      crmProvider: normalizeCrmProvider(rawSettings.crmProvider, DEFAULT_SETTINGS.crmProvider),
      crmWebhookUrl: toText(rawSettings.crmWebhookUrl, DEFAULT_SETTINGS.crmWebhookUrl),
      crmWebhookBridgeUrl: toText(rawSettings.crmWebhookBridgeUrl, DEFAULT_SETTINGS.crmWebhookBridgeUrl),
      crmHubspotBridgeUrl: toText(rawSettings.crmHubspotBridgeUrl, DEFAULT_SETTINGS.crmHubspotBridgeUrl),
      crmSalesforceBridgeUrl: toText(rawSettings.crmSalesforceBridgeUrl, DEFAULT_SETTINGS.crmSalesforceBridgeUrl),
      crmBridgeAuthToken: toText(rawSettings.crmBridgeAuthToken, DEFAULT_SETTINGS.crmBridgeAuthToken),
      crmAutoSyncOnSent: toBoolean(rawSettings.crmAutoSyncOnSent, DEFAULT_SETTINGS.crmAutoSyncOnSent),
      crmAutoSyncOnBooked: toBoolean(rawSettings.crmAutoSyncOnBooked, DEFAULT_SETTINGS.crmAutoSyncOnBooked),
      integrationRetryLimit: toNumber(rawSettings.integrationRetryLimit, DEFAULT_SETTINGS.integrationRetryLimit, 1, 10),
      integrationAuditRetention: toNumber(
        rawSettings.integrationAuditRetention,
        DEFAULT_SETTINGS.integrationAuditRetention,
        10,
        200
      ),
      pricingSettingsVersion: Math.max(0, Math.round(toNumber(rawSettings.pricingSettingsVersion, 0))),
      pricingSettingsUpdatedAtISO: normalizeISO(rawSettings.pricingSettingsUpdatedAtISO, ""),
      pricingSetupConfirmed,
      featureFlags,
      guidedSellingEnabled:
        toBoolean(rawSettings.guidedSellingEnabled, DEFAULT_SETTINGS.guidedSellingEnabled) &&
        featureFlags.guidedSelling,
      staffingLaborEnabled: toBoolean(
        pricingValue("staffingLaborEnabled", DEFAULT_SETTINGS.staffingLaborEnabled, false),
        false
      ),
      upsellRules,
      eventTemplates,
      seasonalProfiles,
      defaultSeasonProfile
    }
  };
}

export function toStorageCatalog(catalog) {
  return {
    packages: catalog.packages.map(({
      id,
      name,
      ppp,
      costPpp,
      includedMenuItemIds,
      includedAddonIds,
      includedRentalIds,
      active
    }) => ({
      id,
      name,
      ppp,
      costPpp: toNullableNumber(costPpp),
      includedMenuItemIds: normalizeStableIdList(includedMenuItemIds),
      includedAddonIds: normalizeStableIdList(includedAddonIds),
      includedRentalIds: normalizeStableIdList(includedRentalIds),
      active: active !== false
    })),
    addons: catalog.addons.map(({ id, name, type, pricingType, price, cost, staffRole, active }) => ({
      id,
      name,
      type: normalizePricingType(pricingType || type, "per_person"),
      pricingType: normalizePricingType(pricingType || type, "per_person"),
      price,
      cost: toNullableNumber(cost),
      staffRole: normalizeAddonStaffRole(staffRole),
      active: active !== false
    })),
    rentals: catalog.rentals.map(({ id, name, price, cost, qtyPerGuests, type, pricingType, active }) => ({
      id,
      name,
      price,
      cost: toNullableNumber(cost),
      qtyPerGuests,
      type: normalizePricingType(pricingType || type, "per_item"),
      pricingType: normalizePricingType(pricingType || type, "per_item"),
      active: active !== false
    })),
    settings: catalog.settings
  };
}
