export function currency(n) {
  return `$${(Math.round(Number(n || 0) * 100) / 100).toFixed(2)}`;
}

export function serviceChargeLabel(rate) {
  if (rate === null || rate === undefined || String(rate).trim() === "") {
    return "Service charge";
  }
  const normalized = Number(rate);
  if (!Number.isFinite(normalized) || normalized < 0) return "Service charge";
  return `Service charge (${Math.round(normalized * 1000) / 10}%)`;
}

function toNumber(value, fallback = 0) {
  const n = Number(value);
  return Number.isNaN(n) ? fallback : n;
}

function toOptionalRate(value) {
  if (value === null || value === undefined) return null;
  const text = String(value).trim();
  if (text === "") return null;
  const n = Number(text);
  if (!Number.isFinite(n) || n < 0) return null;
  return n;
}

function normalizePricingType(value) {
  const raw = String(value || "").trim().toLowerCase();
  if (raw === "per_person" || raw === "per_item" || raw === "per_event") {
    return raw;
  }
  return "per_event";
}

function normalizeStaffingChargeMode(value) {
  const raw = String(value || "").trim().toLowerCase();
  if (raw === "per_event_per_staff") return "per_event_per_staff";
  return "per_hour";
}

function roundCurrency(value) {
  return Math.round(toNumber(value, 0) * 100) / 100;
}

function parseRateMixCsv(value, maxEntries = 0) {
  const limit = Math.max(0, Math.round(toNumber(maxEntries, 0)));
  if (limit <= 0) return [];
  const raw = String(value ?? "").trim();
  if (!raw) return [];
  return raw.split(",").reduce((acc, token) => {
    if (acc.length >= limit) return acc;
    const text = String(token || "").trim();
    if (!text) return acc;
    const n = Number(text);
    if (!Number.isFinite(n) || n < 0) return acc;
    acc.push(roundCurrency(n));
    return acc;
  }, []);
}

function resolveRatesApplied(countValue, fallbackRateValue, rateMixCsv) {
  const count = Math.max(0, Math.round(toNumber(countValue, 0)));
  if (count <= 0) return [];
  const fallbackRate = roundCurrency(Math.max(0, toNumber(fallbackRateValue, 0)));
  const parsedRates = parseRateMixCsv(rateMixCsv, count);
  if (!parsedRates.length) {
    return Array.from({ length: count }, () => fallbackRate);
  }
  return Array.from({ length: count }, (_, index) => {
    const resolved = parsedRates[index];
    if (resolved === undefined) return fallbackRate;
    return roundCurrency(Math.max(0, toNumber(resolved, fallbackRate)));
  });
}

function resolveServerRatesApplied(servers, fallbackServerRate, serverRateMixCsv) {
  return resolveRatesApplied(servers, fallbackServerRate, serverRateMixCsv);
}

function resolveChefRatesApplied(chefs, fallbackChefRate, chefRateMixCsv) {
  return resolveRatesApplied(chefs, fallbackChefRate, chefRateMixCsv);
}

function normalizeAddonStaffRole(value) {
  const raw = String(value || "").trim().toLowerCase();
  if (raw === "server" || raw === "chef" || raw === "bartender") return raw;
  return "";
}

function resolveAddonStaffRole(item) {
  const hasExplicitField = item && Object.prototype.hasOwnProperty.call(item, "staffRole");
  const explicit = normalizeAddonStaffRole(item?.staffRole);
  if (explicit) return explicit;
  if (hasExplicitField) return "";

  const source = `${String(item?.id || "")} ${String(item?.name || "")}`.trim().toLowerCase();
  if (!source) return "";
  if (source.includes("bartender") || source.includes("bar tender")) return "bartender";
  if (source.includes("chef")) return "chef";
  if (source.includes("server") || source.includes("event staff")) return "server";
  return "";
}

function addonSupportsQuantity(item, pricingType) {
  if (pricingType === "per_item") return true;
  if (pricingType === "per_event" && resolveAddonStaffRole(item)) return true;
  return false;
}

function normalizeQuantityMap(input) {
  if (!input || typeof input !== "object") return {};
  return Object.entries(input).reduce((acc, [key, value]) => {
    const id = String(key || "").trim();
    if (!id) return acc;
    const quantity = Math.max(1, Math.round(toNumber(value, 1)));
    acc[id] = quantity;
    return acc;
  }, {});
}

function resolveLineQuantity(itemId, quantityMap, fallback = 1) {
  const id = String(itemId || "").trim();
  if (!id) return Math.max(1, Math.round(toNumber(fallback, 1)));
  const quantity = quantityMap?.[id];
  if (quantity === undefined) {
    return Math.max(1, Math.round(toNumber(fallback, 1)));
  }
  return Math.max(1, Math.round(toNumber(quantity, fallback)));
}

function dateParts(isoDate) {
  const raw = isoDate ? new Date(isoDate) : new Date();
  if (Number.isNaN(raw.getTime())) {
    const now = new Date();
    return { month: now.getMonth() + 1, day: now.getDate() };
  }
  return { month: raw.getMonth() + 1, day: raw.getDate() };
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

export function resolveServiceFeePct(guests, settings) {
  const tiers = Array.isArray(settings?.serviceFeeTiers) ? settings.serviceFeeTiers : [];
  const match = tiers.find((tier) => guests >= Number(tier.minGuests || 0) && guests <= Number(tier.maxGuests || 9999));
  if (match) return Number(match.pct || 0);
  return Number(settings?.serviceFeePct || 0);
}

export function resolveTaxRegion(form, settings) {
  const regions = Array.isArray(settings?.taxRegions) ? settings.taxRegions : [];
  const fallbackRate = Number(settings?.taxRate || 0);
  const defaultRegionId = form?.taxRegion || settings?.defaultTaxRegion;
  const selected = regions.find((region) => region.id === defaultRegionId) || regions[0];

  if (selected) {
    return {
      id: selected.id,
      name: selected.name,
      rate: Number(selected.rate || 0)
    };
  }

  return {
    id: "default",
    name: "Default",
    rate: fallbackRate
  };
}

export function resolveSeasonProfile(form, settings) {
  const profiles = Array.isArray(settings?.seasonalProfiles) ? settings.seasonalProfiles : [];
  const explicit = form?.seasonProfileId;
  const defaultProfileId = settings?.defaultSeasonProfile || "auto";

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
    const chosen = profiles.find((profile) => profile.id === explicit);
    if (chosen) return chosen;
  }

  if (defaultProfileId && defaultProfileId !== "auto") {
    const chosen = profiles.find((profile) => profile.id === defaultProfileId);
    if (chosen) return chosen;
  }

  const { month, day } = dateParts(form?.date);
  const autoMatch = profiles.find((profile) => seasonRangeContains(profile, month, day));
  return autoMatch || profiles[0];
}

export function resolveLaborRates(form, settings) {
  const baseBartenderRate = toNumber(settings?.bartenderRate, 0);
  const baseServerRate = toNumber(settings?.serverRate, 0);
  const baseChefRate = toNumber(settings?.chefRate, 0);

  const bartenderRateOverride = toOptionalRate(form?.bartenderRateOverride);
  const serverRateOverride = toOptionalRate(form?.serverRateOverride);
  const chefRateOverride = toOptionalRate(form?.chefRateOverride);

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

function stableIdSet(value) {
  return new Set((Array.isArray(value) ? value : [])
    .map((id) => String(id || "").trim())
    .filter(Boolean));
}

export function resolvePackageInclusions(selectedPkg = {}, catalog = {}, menuCatalog = [], selection = {}) {
  const resolve = (ids, items, selectedIds) => {
    const byId = new Map((Array.isArray(items) ? items : []).map((item) => [item.id, item]));
    const selected = stableIdSet(selectedIds);
    return [...stableIdSet(ids)].filter((id) => selected.has(id)).map((id) => {
      const item = byId.get(id);
      return {
        id,
        name: String(item?.name || id).trim(),
        active: item ? item.active !== false : false,
        includedInPackage: true
      };
    });
  };
  return {
    menuItems: resolve(selectedPkg?.includedMenuItemIds, menuCatalog, selection.menuItems),
    addons: resolve(selectedPkg?.includedAddonIds, catalog?.addons, selection.addons),
    rentals: resolve(selectedPkg?.includedRentalIds, catalog?.rentals, selection.rentals)
  };
}

export function calculateQuote(form, catalog, settings) {
  const guests = Math.min(400, Number(form.guests || 0));
  const hours = Number(form.hours || 0);
  const serversInput = Math.max(0, Number(form.servers || 0));
  const chefsInput = Math.max(0, Number(form.chefs || 0));
  const bartenders = Math.max(0, Number(form.bartenders || 0));
  const staffingLaborEnabled = settings?.staffingLaborEnabled !== false;
  const staffingChargeMode = normalizeStaffingChargeMode(settings?.staffingChargeMode);
  const selectedPkg = catalog.packages.find((p) => p.id === form.pkg) || catalog.packages[0];
  const taxRegion = resolveTaxRegion(form, settings);
  const seasonProfile = resolveSeasonProfile(form, settings);
  const packageMultiplier = Number(seasonProfile?.packageMultiplier || 1);
  const addonMultiplier = Number(seasonProfile?.addonMultiplier || 1);
  const rentalMultiplier = Number(seasonProfile?.rentalMultiplier || 1);
  const serviceFeePctApplied = resolveServiceFeePct(guests, settings);
  const taxRateApplied = Number(taxRegion?.rate ?? settings?.taxRate ?? 0);
  const milesRT = Number(form.milesRT || 0);
  const thresholdMiles = Number(settings?.deliveryThresholdMiles || 0);
  const standardTravelRate = Number(settings?.perMileRate || 0);
  const longDistanceRate = Number(settings?.longDistancePerMileRate || standardTravelRate);
  const baseMiles = Math.min(milesRT, thresholdMiles);
  const longDistanceMiles = Math.max(0, milesRT - thresholdMiles);
  const laborRates = resolveLaborRates(form, settings);
  const selectedAddonIds = new Set(Array.isArray(form.addons) ? form.addons : []);
  const selectedRentalIds = new Set(Array.isArray(form.rentals) ? form.rentals : []);
  const selectedMenuIds = new Set(Array.isArray(form.menuItems) ? form.menuItems : []);
  const addonQuantityMap = normalizeQuantityMap(form.addonQuantities);
  const rentalQuantityMap = normalizeQuantityMap(form.rentalQuantities);
  const menuItemQuantityMap = normalizeQuantityMap(form.menuItemQuantities);
  const menuCatalog = Array.isArray(settings?.menuSections)
    ? settings.menuSections.flatMap((section) => section.items || [])
    : [];
  const packageInclusions = resolvePackageInclusions(selectedPkg, catalog, menuCatalog, {
    menuItems: form.menuItems,
    addons: form.addons,
    rentals: form.rentals
  });
  const includedAddonIds = stableIdSet(selectedPkg?.includedAddonIds);
  const includedRentalIds = stableIdSet(selectedPkg?.includedRentalIds);
  const includedMenuItemIds = stableIdSet(selectedPkg?.includedMenuItemIds);

  if (guests <= 0) {
    const baseServers = staffingLaborEnabled ? serversInput : 0;
    const baseChefs = staffingLaborEnabled ? chefsInput : 0;
    const baseBartenders = staffingLaborEnabled ? bartenders : 0;
    const serverRatesApplied = staffingLaborEnabled
      ? resolveServerRatesApplied(baseServers, laborRates.serverRateApplied, form.serverRateMixCsv)
      : [];
    const chefRatesApplied = staffingLaborEnabled
      ? resolveChefRatesApplied(baseChefs, laborRates.chefRateApplied, form.chefRateMixCsv)
      : [];
    return {
      selectedPkg,
      guests: 0,
      base: 0,
      addons: 0,
      rentals: 0,
      menu: 0,
      servers: baseServers,
      chefs: baseChefs,
      bartenders,
      baseServers,
      baseChefs,
      baseBartenders,
      addonServers: 0,
      addonChefs: 0,
      addonBartenders: 0,
      serverLabor: 0,
      chefLabor: 0,
      bartenderLabor: 0,
      bartenderRateApplied: laborRates.bartenderRateApplied,
      serverRateApplied: laborRates.serverRateApplied,
      serverRatesApplied,
      chefRateApplied: laborRates.chefRateApplied,
      chefRatesApplied,
      bartenderRateTypeId: laborRates.bartenderRateTypeId,
      bartenderRateTypeName: laborRates.bartenderRateTypeName,
      staffingRateTypeId: laborRates.staffingRateTypeId,
      staffingRateTypeName: laborRates.staffingRateTypeName,
      labor: 0,
      travel: 0,
      serviceFee: 0,
      tax: 0,
      total: 0,
      deposit: 0,
      serviceFeePctApplied,
      taxRateApplied,
      taxRegionId: taxRegion.id,
      taxRegionName: taxRegion.name,
      seasonProfileId: seasonProfile.id,
      seasonProfileName: seasonProfile.name,
      staffingLaborEnabled,
      staffingChargeMode,
      packageMultiplier,
      addonMultiplier,
      rentalMultiplier,
      packageInclusions,
      addonQuantityMap,
      rentalQuantityMap,
      menuItemQuantityMap,
      travelBaseMiles: baseMiles,
      travelLongDistanceMiles: longDistanceMiles
    };
  }

  const base = (selectedPkg?.ppp || 0) * guests * packageMultiplier;

  const addonSummary = catalog.addons
    .filter((item) => selectedAddonIds.has(item.id) && item.active !== false)
    .reduce((acc, item) => {
      if (includedAddonIds.has(item.id)) return acc;
      const price = Number(item.price || 0);
      const pricingType = normalizePricingType(item.pricingType || item.type);
      const quantityEnabled = addonSupportsQuantity(item, pricingType);
      const quantity = quantityEnabled ? resolveLineQuantity(item.id, addonQuantityMap, 1) : 1;

      if (pricingType === "per_person") {
        acc.total += (price * guests * addonMultiplier);
      } else if (quantityEnabled) {
        acc.total += (price * quantity * addonMultiplier);
      } else {
        acc.total += (price * addonMultiplier);
      }
      return acc;
    }, {
      total: 0,
      addonServers: 0,
      addonChefs: 0,
      addonBartenders: 0
    });
  const addons = addonSummary.total;

  const rentals = catalog.rentals
    .filter((item) => selectedRentalIds.has(item.id) && item.active !== false)
    .reduce((sum, item) => {
      if (includedRentalIds.has(item.id)) return sum;
      const price = Number(item.price || 0);
      const pricingType = normalizePricingType(item.pricingType || item.type || "per_item");
      if (pricingType === "per_person") {
        return sum + (price * guests * rentalMultiplier);
      }
      if (pricingType === "per_event") {
        return sum + (price * rentalMultiplier);
      }
      const defaultQty = typeof item.qtyRule === "function" ? item.qtyRule(guests) : 1;
      const quantity = resolveLineQuantity(item.id, rentalQuantityMap, defaultQty);
      return sum + (price * quantity * rentalMultiplier);
    }, 0);

  const menu = menuCatalog
    .filter((item) => selectedMenuIds.has(item.id) && item.active !== false)
    .reduce((sum, item) => {
      if (includedMenuItemIds.has(item.id)) return sum;
      const price = Number(item.price || 0);
      const pricingType = normalizePricingType(item.pricingType || item.type);
      if (pricingType === "per_person") {
        return sum + (price * guests * addonMultiplier);
      }
      if (pricingType === "per_item") {
        const quantity = resolveLineQuantity(item.id, menuItemQuantityMap, 1);
        return sum + (price * quantity * addonMultiplier);
      }
      return sum + (price * addonMultiplier);
    }, 0);

  const baseServers = staffingLaborEnabled ? serversInput : 0;
  const baseChefs = staffingLaborEnabled ? chefsInput : 0;
  const baseBartenders = staffingLaborEnabled ? bartenders : 0;
  const addonServers = 0;
  const addonChefs = 0;
  const addonBartenders = 0;
  const servers = baseServers + addonServers;
  const chefs = baseChefs + addonChefs;
  const displayBartenders = baseBartenders + addonBartenders;
  const serverRatesApplied = staffingLaborEnabled
    ? resolveServerRatesApplied(baseServers, laborRates.serverRateApplied, form.serverRateMixCsv)
    : [];
  const chefRatesApplied = staffingLaborEnabled
    ? resolveChefRatesApplied(baseChefs, laborRates.chefRateApplied, form.chefRateMixCsv)
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
  const preFee = base + addons + rentals + menu + labor + travel;
  const serviceFee = preFee * serviceFeePctApplied;
  const tax = (base + addons + rentals + menu + serviceFee) * taxRateApplied;

  const total = preFee + serviceFee + tax;
  const deposit = total * settings.depositPct;

  return {
    selectedPkg,
    guests,
    base,
    addons,
    rentals,
    menu,
    servers,
    chefs,
    bartenders: displayBartenders,
    baseServers,
    baseChefs,
    baseBartenders,
    addonServers,
    addonChefs,
    addonBartenders,
    serverLabor,
    chefLabor,
    bartenderLabor,
    bartenderRateApplied: laborRates.bartenderRateApplied,
    serverRateApplied: laborRates.serverRateApplied,
    serverRatesApplied,
    chefRateApplied: laborRates.chefRateApplied,
    chefRatesApplied,
    bartenderRateTypeId: laborRates.bartenderRateTypeId,
    bartenderRateTypeName: laborRates.bartenderRateTypeName,
    staffingRateTypeId: laborRates.staffingRateTypeId,
    staffingRateTypeName: laborRates.staffingRateTypeName,
    labor,
    travel,
    serviceFee,
    tax,
    total,
    deposit,
    serviceFeePctApplied,
    taxRateApplied,
    taxRegionId: taxRegion.id,
    taxRegionName: taxRegion.name,
    seasonProfileId: seasonProfile.id,
    seasonProfileName: seasonProfile.name,
    staffingLaborEnabled,
    staffingChargeMode,
    packageMultiplier,
    addonMultiplier,
    rentalMultiplier,
    packageInclusions,
    addonQuantityMap,
    rentalQuantityMap,
    menuItemQuantityMap,
    travelBaseMiles: baseMiles,
    travelLongDistanceMiles: longDistanceMiles
  };
}
