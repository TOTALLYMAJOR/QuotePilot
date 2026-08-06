const PRICING_MODES = new Set(["per_person", "per_item", "per_event"]);
const STAFFING_CHARGE_MODES = new Set(["per_hour", "per_event_per_staff"]);
const MAX_RATE_MIX_CSV_LENGTH = 300;

export const PRICING_VERSION = "pricing-v1";
export const CLIENT_PREVIEW_AUTHORITY = "client_preview";

function nowISO() {
  return new Date().toISOString();
}

function toNumber(value, fallback = 0) {
  const n = Number(value);
  return Number.isFinite(n) ? n : fallback;
}

function toInt(value, fallback = 0) {
  return Math.max(0, Math.round(toNumber(value, fallback)));
}

function toText(value, fallback = "") {
  const text = String(value ?? "").trim();
  return text || fallback;
}

function normalizeRateMixCsv(value) {
  return toText(value).slice(0, MAX_RATE_MIX_CSV_LENGTH);
}

function normalizeServerRateMixCsv(value) {
  return normalizeRateMixCsv(value);
}

function normalizeChefRateMixCsv(value) {
  return normalizeRateMixCsv(value);
}

function toRateArray(input) {
  if (!Array.isArray(input)) return [];
  return input
    .map((value) => Math.round(toNumber(value, 0) * 100) / 100)
    .filter((value) => Number.isFinite(value) && value >= 0);
}

function toOptionalNumberOrBlank(value) {
  if (value === null || value === undefined || value === "") return "";
  const n = Number(value);
  return Number.isFinite(n) ? n : "";
}

function normalizeISO(value, fallback = "") {
  const text = toText(value);
  if (!text) return fallback;
  const parsed = new Date(text);
  return Number.isNaN(parsed.getTime()) ? fallback : parsed.toISOString();
}

function normalizePricingMode(value, fallback = "per_event") {
  const mode = toText(value, fallback).toLowerCase();
  return PRICING_MODES.has(mode) ? mode : fallback;
}

function normalizeStaffingChargeMode(value, fallback = "per_hour") {
  const mode = toText(value, fallback).toLowerCase();
  return STAFFING_CHARGE_MODES.has(mode) ? mode : fallback;
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

function normalizeLineItem(item, index = 0) {
  const source = item && typeof item === "object" ? item : {};
  const id = toText(source.id, `line-${index + 1}`);
  const category = toText(source.category, "misc");
  const pricingMode = normalizePricingMode(source.pricingMode || source.type, "per_event");
  const quantity = Math.max(0, toInt(source.quantity, 1));
  const unitPrice = toNumber(source.unitPrice, toNumber(source.price, 0));
  const total = toNumber(source.total, unitPrice * quantity);
  return {
    id,
    category,
    name: toText(source.name, id),
    pricingMode,
    unitPrice,
    quantity,
    total,
    meta: source.meta && typeof source.meta === "object" ? { ...source.meta } : {}
  };
}

function normalizeLineItems(input) {
  const source = Array.isArray(input) ? input : [];
  return source.map((item, idx) => normalizeLineItem(item, idx));
}

function normalizeSelectedItems(input, fallbackPricingMode) {
  const source = Array.isArray(input) ? input : [];
  return source
    .map((item) => {
      if (typeof item === "string") {
        const id = toText(item);
        if (!id) return null;
        return {
          id,
          name: id,
          pricingMode: fallbackPricingMode,
          unitPrice: 0,
          quantity: 1,
          includedInPackage: false
        };
      }
      const id = toText(item?.id);
      if (!id) return null;
      const pricingMode = normalizePricingMode(item.pricingMode || item.pricingType || item.type, fallbackPricingMode);
      return {
        id,
        name: toText(item.name, id),
        pricingMode,
        unitPrice: toNumber(item.unitPrice, toNumber(item.price, 0)),
        quantity: Math.max(1, toInt(item.quantity, 1)),
        includedInPackage: item.includedInPackage === true
      };
    })
    .filter(Boolean);
}

function buildDefaultLineItems(totals = {}) {
  const normalizedTotals = {
    base: toNumber(totals.base, 0),
    addons: toNumber(totals.addons, 0),
    rentals: toNumber(totals.rentals, 0),
    menu: toNumber(totals.menu, 0),
    labor: toNumber(totals.labor, 0),
    travel: toNumber(totals.travel, 0),
    serviceFee: toNumber(totals.serviceFee, 0),
    tax: toNumber(totals.tax, 0),
    deposit: toNumber(totals.deposit, 0)
  };
  return normalizeLineItems([
    { id: "package", category: "package", name: "Package", pricingMode: "per_person", unitPrice: normalizedTotals.base, quantity: 1, total: normalizedTotals.base },
    { id: "addons", category: "addons", name: "Add-ons", pricingMode: "per_event", unitPrice: normalizedTotals.addons, quantity: 1, total: normalizedTotals.addons },
    { id: "rentals", category: "rentals", name: "Rentals", pricingMode: "per_event", unitPrice: normalizedTotals.rentals, quantity: 1, total: normalizedTotals.rentals },
    { id: "menu_items", category: "menu_items", name: "Menu Items", pricingMode: "per_event", unitPrice: normalizedTotals.menu, quantity: 1, total: normalizedTotals.menu },
    { id: "labor", category: "labor", name: "Labor", pricingMode: "per_event", unitPrice: normalizedTotals.labor, quantity: 1, total: normalizedTotals.labor },
    { id: "travel", category: "travel", name: "Travel", pricingMode: "per_event", unitPrice: normalizedTotals.travel, quantity: 1, total: normalizedTotals.travel },
    { id: "service_fee", category: "service_fee", name: "Service Fee", pricingMode: "per_event", unitPrice: normalizedTotals.serviceFee, quantity: 1, total: normalizedTotals.serviceFee },
    { id: "tax", category: "tax", name: "Tax", pricingMode: "per_event", unitPrice: normalizedTotals.tax, quantity: 1, total: normalizedTotals.tax },
    { id: "deposit", category: "deposit", name: "Deposit", pricingMode: "per_event", unitPrice: normalizedTotals.deposit, quantity: 1, total: normalizedTotals.deposit }
  ]);
}

export function normalizePricingInput(payload = {}) {
  const source = payload && typeof payload === "object" ? payload : {};
  const event = source.event && typeof source.event === "object" ? source.event : {};
  const selection = source.selection && typeof source.selection === "object" ? source.selection : {};
  const labor = source.labor && typeof source.labor === "object" ? source.labor : {};
  const packageInput = selection.package && typeof selection.package === "object"
    ? selection.package
    : {
        id: selection.packageId || source.packageId || "",
        name: selection.packageName || source.packageName || "",
        unitPrice: selection.packagePrice || source.packagePrice || 0
      };

  return {
    organizationId: toText(source.organizationId),
    quoteId: toText(source.quoteId),
    quoteNumber: toText(source.quoteNumber),
    actor: {
      uid: toText(source.actor?.uid || source.ownerUid || source.uid),
      email: toText(source.actor?.email || source.ownerEmail || source.email).toLowerCase(),
      role: toText(source.actor?.role || source.role)
    },
    event: {
      name: toText(event.name || source.eventName),
      eventTypeId: toText(event.eventTypeId || source.eventTypeId),
      date: toText(event.date || source.eventDate),
      time: toText(event.time || source.eventTime),
      venue: toText(event.venue || source.venue),
      venueAddress: toText(event.venueAddress || source.venueAddress),
      guests: Math.max(0, toInt(event.guests || source.guests, 0)),
      hours: toNumber(event.hours || source.hours, 0),
      style: toText(event.style || source.style),
      servers: Math.max(0, toInt(event.servers || source.servers, 0)),
      chefs: Math.max(0, toInt(event.chefs || source.chefs, 0)),
      bartenders: Math.max(0, toInt(event.bartenders || source.bartenders, 0)),
      milesRT: Math.max(0, toNumber(selection.milesRT ?? source.milesRT ?? event.milesRT, 0)),
      taxRegionId: toText(selection.taxRegion || source.taxRegion || event.taxRegion),
      seasonProfileId: toText(selection.seasonProfileId || source.seasonProfileId || event.seasonProfileId)
    },
    selection: {
      package: {
        id: toText(packageInput.id),
        name: toText(packageInput.name, toText(packageInput.id)),
        pricingMode: normalizePricingMode(packageInput.pricingMode || packageInput.pricingType || packageInput.type, "per_person"),
        unitPrice: toNumber(packageInput.unitPrice, toNumber(packageInput.price, 0)),
        quantity: Math.max(1, toInt(packageInput.quantity, 1)),
        inclusions: {
          menuItems: normalizeSelectedItems(
            packageInput.inclusions?.menuItems || selection.packageInclusions?.menuItems,
            "per_event"
          ),
          addons: normalizeSelectedItems(
            packageInput.inclusions?.addons || selection.packageInclusions?.addons,
            "per_person"
          ),
          rentals: normalizeSelectedItems(
            packageInput.inclusions?.rentals || selection.packageInclusions?.rentals,
            "per_item"
          )
        }
      },
      addons: normalizeSelectedItems(selection.addons || source.addons, "per_person"),
      rentals: normalizeSelectedItems(selection.rentals || source.rentals, "per_item"),
      menuItems: normalizeSelectedItems(selection.menuItems || source.menuItems, "per_event"),
      quantities: {
        addonQuantities: normalizeQuantityMap(selection.addonQuantities || source.addonQuantities),
        rentalQuantities: normalizeQuantityMap(selection.rentalQuantities || source.rentalQuantities),
        menuItemQuantities: normalizeQuantityMap(selection.menuItemQuantities || source.menuItemQuantities)
      }
    },
    labor: {
      bartenderRateOverride: toOptionalNumberOrBlank(
        labor.bartenderRateOverride ?? selection.bartenderRateOverride ?? source.bartenderRateOverride
      ),
      serverRateOverride: toOptionalNumberOrBlank(
        labor.serverRateOverride ?? selection.serverRateOverride ?? source.serverRateOverride
      ),
      chefRateOverride: toOptionalNumberOrBlank(
        labor.chefRateOverride ?? selection.chefRateOverride ?? source.chefRateOverride
      ),
      serverRateMixCsv: normalizeServerRateMixCsv(
        labor.serverRateMixCsv ?? selection.serverRateMixCsv ?? source.serverRateMixCsv
      ),
      chefRateMixCsv: normalizeChefRateMixCsv(
        labor.chefRateMixCsv ?? selection.chefRateMixCsv ?? source.chefRateMixCsv
      )
    },
    pricingModes: {
      package: normalizePricingMode(packageInput.pricingMode || packageInput.pricingType || packageInput.type, "per_person"),
      addonsDefault: "per_person",
      rentalsDefault: "per_item",
      menuDefault: "per_event"
    },
    settings: {
      serviceFeePct: toNumber(source.settings?.serviceFeePct, 0),
      taxRate: toNumber(source.settings?.taxRate, 0),
      depositPct: toNumber(source.settings?.depositPct, 0),
      defaultTaxRegion: toText(source.settings?.defaultTaxRegion),
      defaultSeasonProfile: toText(source.settings?.defaultSeasonProfile),
      staffingChargeMode: normalizeStaffingChargeMode(source.settings?.staffingChargeMode, "per_hour"),
      pricingSettingsVersion: Math.max(0, toInt(source.settings?.pricingSettingsVersion, 0)),
      pricingSettingsUpdatedAtISO: normalizeISO(source.settings?.pricingSettingsUpdatedAtISO, "")
    },
    metadata: {
      source: toText(source.source),
      generatedAt: normalizeISO(source.generatedAt || source.calculatedAt || source.createdAtISO, "")
    }
  };
}

export function normalizePricingOutput(payload = {}) {
  const source = payload && typeof payload === "object" ? payload : {};
  const rawTax = source.tax && typeof source.tax === "object" ? source.tax : {};
  const rawDeposit = source.deposit && typeof source.deposit === "object" ? source.deposit : {};
  const rawFees = source.fees && typeof source.fees === "object" ? source.fees : {};
  const normalizedInputs = normalizePricingInput(source.inputs || {});

  return {
    pricingVersion: toText(source.pricingVersion, PRICING_VERSION),
    calculatedAt: normalizeISO(source.calculatedAt, ""),
    authority: toText(source.authority),
    inputs: normalizedInputs,
    lineItems: normalizeLineItems(source.lineItems),
    fees: {
      labor: toNumber(rawFees.labor, 0),
      serverLabor: toNumber(rawFees.serverLabor, 0),
      chefLabor: toNumber(rawFees.chefLabor, 0),
      travel: toNumber(rawFees.travel, 0),
      bartenderLabor: toNumber(rawFees.bartenderLabor, 0),
      serviceFee: toNumber(rawFees.serviceFee, 0)
    },
    tax: {
      rate: toNumber(rawTax.rate ?? source.taxRate, 0),
      amount: toNumber(rawTax.amount ?? source.taxAmount, 0),
      regionId: toText(rawTax.regionId || source.taxRegionId),
      regionName: toText(rawTax.regionName || source.taxRegionName)
    },
    discountTotal: toNumber(source.discountTotal, 0),
    deposit: {
      pct: toNumber(rawDeposit.pct, 0),
      amount: toNumber(rawDeposit.amount, toNumber(source.depositAmount, 0))
    },
    subtotal: toNumber(source.subtotal, 0),
    grandTotal: toNumber(source.grandTotal, 0),
    rulesSnapshot: source.rulesSnapshot && typeof source.rulesSnapshot === "object"
      ? { ...source.rulesSnapshot }
      : {}
  };
}

export function buildPricingSnapshotFromClientTotals({
  form = {},
  totals = {},
  settings = {},
  selection = {},
  organizationId = "",
  quoteId = "",
  quoteNumber = "",
  actor = {},
  reason = "",
  lineItems = []
} = {}) {
  const normalizedTotals = {
    base: toNumber(totals.base, 0),
    addons: toNumber(totals.addons, 0),
    rentals: toNumber(totals.rentals, 0),
    menu: toNumber(totals.menu, 0),
    labor: toNumber(totals.labor, 0),
    serverLabor: toNumber(totals.serverLabor, 0),
    chefLabor: toNumber(totals.chefLabor, 0),
    bartenderLabor: toNumber(totals.bartenderLabor, 0),
    travel: toNumber(totals.travel, 0),
    serviceFee: toNumber(totals.serviceFee, 0),
    tax: toNumber(totals.tax, 0),
    total: toNumber(totals.total, 0),
    deposit: toNumber(totals.deposit, 0)
  };
  const subtotal = normalizedTotals.base
    + normalizedTotals.addons
    + normalizedTotals.rentals
    + normalizedTotals.menu
    + normalizedTotals.labor
    + normalizedTotals.travel;

  const normalizedInput = normalizePricingInput({
    organizationId,
    quoteId,
    quoteNumber,
    actor,
    event: {
      name: form.eventName,
      eventTypeId: form.eventTypeId,
      date: form.date,
      time: form.time,
      venue: form.venue,
      venueAddress: form.venueAddress,
      guests: form.guests,
      hours: form.hours,
      style: form.style,
      servers: form.servers,
      chefs: form.chefs,
      bartenders: form.bartenders
    },
    selection: {
      ...selection,
      packageId: selection.packageId || form.pkg,
      packageName: selection.packageName || totals.selectedPkg?.name || "",
      packageInclusions: selection.packageInclusions || totals.packageInclusions,
      addons: Array.isArray(selection.addons) ? selection.addons : form.addons,
      rentals: Array.isArray(selection.rentals) ? selection.rentals : form.rentals,
      menuItems: Array.isArray(selection.menuItems) ? selection.menuItems : form.menuItems,
      addonQuantities: selection.addonQuantities || form.addonQuantities,
      rentalQuantities: selection.rentalQuantities || form.rentalQuantities,
      menuItemQuantities: selection.menuItemQuantities || form.menuItemQuantities,
      milesRT: selection.milesRT ?? form.milesRT,
      taxRegion: selection.taxRegion || form.taxRegion,
      seasonProfileId: selection.seasonProfileId || form.seasonProfileId,
      serverRateMixCsv: normalizeServerRateMixCsv(selection.serverRateMixCsv ?? form.serverRateMixCsv),
      chefRateMixCsv: normalizeChefRateMixCsv(selection.chefRateMixCsv ?? form.chefRateMixCsv)
    },
    labor: {
      bartenderRateOverride: selection.bartenderRateOverride ?? form.bartenderRateOverride,
      serverRateOverride: selection.serverRateOverride ?? form.serverRateOverride,
      chefRateOverride: selection.chefRateOverride ?? form.chefRateOverride,
      serverRateMixCsv: normalizeServerRateMixCsv(selection.serverRateMixCsv ?? form.serverRateMixCsv),
      chefRateMixCsv: normalizeChefRateMixCsv(selection.chefRateMixCsv ?? form.chefRateMixCsv)
    },
    settings
  });

  const resolvedLineItems = Array.isArray(lineItems) && lineItems.length
    ? normalizeLineItems(lineItems)
    : buildDefaultLineItems(normalizedTotals);

  const pricing = normalizePricingOutput({
    pricingVersion: PRICING_VERSION,
    calculatedAt: nowISO(),
    authority: CLIENT_PREVIEW_AUTHORITY,
    inputs: normalizedInput,
    lineItems: resolvedLineItems,
    fees: {
      labor: normalizedTotals.labor,
      serverLabor: normalizedTotals.serverLabor,
      chefLabor: normalizedTotals.chefLabor,
      travel: normalizedTotals.travel,
      bartenderLabor: normalizedTotals.bartenderLabor,
      serviceFee: normalizedTotals.serviceFee
    },
    tax: {
      rate: toNumber(totals.taxRateApplied, 0),
      amount: normalizedTotals.tax,
      regionId: toText(totals.taxRegionId, toText(form.taxRegion)),
      regionName: toText(totals.taxRegionName)
    },
    discountTotal: 0,
    deposit: {
      pct: toNumber(settings.depositPct, 0),
      amount: normalizedTotals.deposit
    },
    subtotal,
    grandTotal: normalizedTotals.total,
    rulesSnapshot: {
      reason: toText(reason),
      serviceFeePctApplied: toNumber(totals.serviceFeePctApplied, 0),
      taxRateApplied: toNumber(totals.taxRateApplied, 0),
      taxRegionId: toText(totals.taxRegionId),
      taxRegionName: toText(totals.taxRegionName),
      seasonProfileId: toText(totals.seasonProfileId),
      seasonProfileName: toText(totals.seasonProfileName),
      packageMultiplier: toNumber(totals.packageMultiplier, 1),
      addonMultiplier: toNumber(totals.addonMultiplier, 1),
      rentalMultiplier: toNumber(totals.rentalMultiplier, 1),
      depositPct: toNumber(settings.depositPct, 0),
      pricingSettingsVersion: Math.max(0, toInt(settings.pricingSettingsVersion, 0)),
      pricingSettingsUpdatedAtISO: normalizeISO(settings.pricingSettingsUpdatedAtISO, ""),
      staffingChargeMode: normalizeStaffingChargeMode(
        totals.staffingChargeMode || settings.staffingChargeMode,
        "per_hour"
      ),
      settingsSnapshot: {
        serviceFeePct: toNumber(settings.serviceFeePct, 0),
        serviceFeeTiers: Array.isArray(settings.serviceFeeTiers) ? [...settings.serviceFeeTiers] : [],
        taxRate: toNumber(settings.taxRate, 0),
        taxRegions: Array.isArray(settings.taxRegions) ? [...settings.taxRegions] : [],
        defaultTaxRegion: toText(settings.defaultTaxRegion),
        depositPct: toNumber(settings.depositPct, 0),
        seasonalProfiles: Array.isArray(settings.seasonalProfiles) ? [...settings.seasonalProfiles] : [],
        defaultSeasonProfile: toText(settings.defaultSeasonProfile),
        staffingChargeMode: normalizeStaffingChargeMode(settings.staffingChargeMode, "per_hour"),
        staffingLaborEnabled: settings.staffingLaborEnabled !== false,
        perMileRate: toNumber(settings.perMileRate, 0),
        longDistancePerMileRate: toNumber(settings.longDistancePerMileRate, 0),
        deliveryThresholdMiles: toNumber(settings.deliveryThresholdMiles, 0),
        bartenderRateTypes: Array.isArray(settings.bartenderRateTypes) ? [...settings.bartenderRateTypes] : [],
        defaultBartenderRateType: toText(settings.defaultBartenderRateType),
        staffingRateTypes: Array.isArray(settings.staffingRateTypes) ? [...settings.staffingRateTypes] : [],
        defaultStaffingRateType: toText(settings.defaultStaffingRateType)
      },
      laborRateSnapshot: {
        bartenderRateApplied: toNumber(totals.bartenderRateApplied, 0),
        serverRateApplied: toNumber(totals.serverRateApplied, 0),
        serverRatesApplied: toRateArray(totals.serverRatesApplied),
        serverLabor: toNumber(totals.serverLabor, 0),
        chefRateApplied: toNumber(totals.chefRateApplied, 0),
        chefRatesApplied: toRateArray(totals.chefRatesApplied),
        chefLabor: toNumber(totals.chefLabor, 0),
        bartenderRateTypeId: toText(totals.bartenderRateTypeId),
        bartenderRateTypeName: toText(totals.bartenderRateTypeName),
        staffingRateTypeId: toText(totals.staffingRateTypeId),
        staffingRateTypeName: toText(totals.staffingRateTypeName)
      },
      pricingModeDefaults: {
        package: "per_person",
        addons: "per_person",
        rentals: "per_item",
        menuItems: "per_event"
      },
      staffing: {
        style: toText(form.style),
        servers: Math.max(0, toInt(totals.servers, 0)),
        chefs: Math.max(0, toInt(totals.chefs, 0)),
        bartenders: Math.max(0, toInt(totals.bartenders, 0)),
        serverRateMixCsv: normalizeServerRateMixCsv(form.serverRateMixCsv),
        chefRateMixCsv: normalizeChefRateMixCsv(form.chefRateMixCsv),
        staffingChargeMode: normalizeStaffingChargeMode(
          totals.staffingChargeMode || settings.staffingChargeMode,
          "per_hour"
        ),
        hours: toNumber(form.hours, 0)
      }
    }
  });

  return pricing;
}

export function deriveLegacyPricingSnapshot(quote = {}) {
  const source = quote && typeof quote === "object" ? quote : {};
  if (source.pricing && typeof source.pricing === "object") {
    return normalizePricingOutput(source.pricing);
  }

  const totals = source.totals && typeof source.totals === "object" ? source.totals : {};
  const selection = source.selection && typeof source.selection === "object" ? source.selection : {};
  const event = source.event && typeof source.event === "object" ? source.event : {};
  const meta = source.quoteMeta && typeof source.quoteMeta === "object" ? source.quoteMeta : {};
  const subtotal = toNumber(
    totals.base,
    0
  ) + toNumber(totals.addons, 0) + toNumber(totals.rentals, 0) + toNumber(totals.menu, 0) + toNumber(totals.labor, 0) + toNumber(totals.travel, 0);
  const total = toNumber(totals.total, subtotal + toNumber(totals.serviceFee, 0) + toNumber(totals.tax, 0));
  const deposit = toNumber(totals.deposit, 0);
  const inferredDepositPct = total > 0 ? deposit / total : 0;

  return normalizePricingOutput({
    pricingVersion: toText(source.pricingVersion || totals.pricingVersion, PRICING_VERSION),
    calculatedAt: source.updatedAtISO || source.createdAtISO || source.createdAt || nowISO(),
    authority: "legacy_derived",
    inputs: normalizePricingInput({
      organizationId: source.organizationId,
      quoteId: source.id,
      quoteNumber: source.quoteNumber,
      ownerUid: source.ownerUid,
      ownerEmail: source.ownerEmail,
      event,
      selection,
      settings: {
        serviceFeePct: toNumber(totals.serviceFeePctApplied, 0),
        taxRate: toNumber(totals.taxRateApplied, 0),
        depositPct: toNumber(meta.depositPct, inferredDepositPct),
        defaultTaxRegion: toText(selection.taxRegion),
        defaultSeasonProfile: toText(selection.seasonProfileId)
      },
      source: source.source,
      calculatedAt: source.updatedAtISO || source.createdAtISO || nowISO()
    }),
    lineItems: buildDefaultLineItems({
      base: totals.base,
      addons: totals.addons,
      rentals: totals.rentals,
      menu: totals.menu,
      labor: totals.labor,
      travel: totals.travel,
      serviceFee: totals.serviceFee,
      tax: totals.tax,
      deposit: totals.deposit
    }),
    fees: {
      labor: toNumber(totals.labor, 0),
      serverLabor: toNumber(totals.serverLabor, 0),
      chefLabor: toNumber(totals.chefLabor, 0),
      travel: toNumber(totals.travel, 0),
      bartenderLabor: toNumber(totals.bartenderLabor, 0),
      serviceFee: toNumber(totals.serviceFee, 0)
    },
    tax: {
      rate: toNumber(totals.taxRateApplied, 0),
      amount: toNumber(totals.tax, 0),
      regionId: toText(totals.taxRegionId, toText(selection.taxRegion)),
      regionName: toText(totals.taxRegionName)
    },
    discountTotal: 0,
    deposit: {
      pct: toNumber(meta.depositPct, inferredDepositPct),
      amount: deposit
    },
    subtotal,
    grandTotal: total,
    rulesSnapshot: {
      serviceFeePctApplied: toNumber(totals.serviceFeePctApplied, 0),
      taxRateApplied: toNumber(totals.taxRateApplied, 0),
      taxRegionId: toText(totals.taxRegionId),
      taxRegionName: toText(totals.taxRegionName),
      seasonProfileId: toText(totals.seasonProfileId, toText(selection.seasonProfileId)),
      seasonProfileName: toText(totals.seasonProfileName),
      packageMultiplier: toNumber(totals.packageMultiplier, 1),
      addonMultiplier: toNumber(totals.addonMultiplier, 1),
      rentalMultiplier: toNumber(totals.rentalMultiplier, 1),
      staffingChargeMode: normalizeStaffingChargeMode(totals.staffingChargeMode, "per_hour"),
      pricingSettingsVersion: Math.max(0, toInt(meta.pricingSettingsVersion, 0)),
      pricingSettingsUpdatedAtISO: normalizeISO(meta.pricingSettingsUpdatedAtISO || meta.updatedAtISO, ""),
      laborRateSnapshot:
        selection.laborRateSnapshot && typeof selection.laborRateSnapshot === "object"
          ? { ...selection.laborRateSnapshot }
          : {
              bartenderRateApplied: toNumber(totals.bartenderRateApplied, 0),
              serverRateApplied: toNumber(totals.serverRateApplied, 0),
              serverRatesApplied: toRateArray(totals.serverRatesApplied),
              serverLabor: toNumber(totals.serverLabor, 0),
              chefRateApplied: toNumber(totals.chefRateApplied, 0),
              chefRatesApplied: toRateArray(totals.chefRatesApplied),
              chefLabor: toNumber(totals.chefLabor, 0),
              bartenderRateTypeId: toText(totals.bartenderRateTypeId),
              bartenderRateTypeName: toText(totals.bartenderRateTypeName),
              staffingRateTypeId: toText(totals.staffingRateTypeId),
              staffingRateTypeName: toText(totals.staffingRateTypeName)
            }
    }
  });
}

export function normalizeVersionMetadata(payload = {}) {
  const source = payload && typeof payload === "object" ? payload : {};
  const createdBy = source.createdBy && typeof source.createdBy === "object" ? source.createdBy : {};
  return {
    versionNumber: Math.max(1, toInt(source.versionNumber, 1)),
    createdAt: normalizeISO(source.createdAt, ""),
    createdBy: {
      uid: toText(createdBy.uid || source.ownerUid || source.uid),
      email: toText(createdBy.email || source.ownerEmail || source.email).toLowerCase(),
      role: toText(createdBy.role || source.role)
    },
    reason: toText(source.reason, "unspecified")
  };
}
