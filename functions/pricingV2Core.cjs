"use strict";

const {
  CommercialPlatformError,
  evaluateOfferConfiguration,
  validateConfigurableOffer
} = require("./commercialPlatformCore.cjs");

const PRICING_V2_VERSION = "pricing-v2";
const PRICING_V2_ROUNDING = "usd-positive-half-up-cent-v1";
const PRICING_V2_POLICY = "catering-pricing-v2";
const PRICING_V2_MAX_DEMAND_QUANTITY = 400;
const RATE_SCALE = 1_000_000;
const QUANTITY_SCALE = 1_000;

class PricingV2Error extends Error {
  constructor(code, message, details = {}) {
    super(message);
    this.name = "PricingV2Error";
    this.code = code;
    this.details = details;
  }
}

function text(value) {
  return String(value ?? "").trim();
}

function finite(value, fallback = 0) {
  const number = Number(value);
  return Number.isFinite(number) ? number : fallback;
}

function safeInteger(value, label) {
  const number = Number(value);
  if (!Number.isSafeInteger(number)) {
    throw new PricingV2Error("unsafe_integer", `${label} must be a safe integer.`);
  }
  return number;
}

function decimalToScaled(value, scale, label) {
  const number = Number(value);
  if (!Number.isFinite(number) || number < 0) {
    throw new PricingV2Error("invalid_decimal", `${label} must be a non-negative finite number.`);
  }
  const scaled = Math.floor((number * scale) + 0.5 + Number.EPSILON);
  return safeInteger(scaled, label);
}

function toMinor(value, label = "Amount") {
  return decimalToScaled(value, 100, label);
}

function moneyMinor(record, minorKey, majorKey, label) {
  if (Object.prototype.hasOwnProperty.call(record || {}, minorKey)) {
    const minor = safeInteger(record[minorKey], label);
    if (minor < 0) throw new PricingV2Error("negative_money", `${label} cannot be negative.`);
    return minor;
  }
  return toMinor(record?.[majorKey] || 0, label);
}

function fromMinor(value) {
  return safeInteger(value, "Money") / 100;
}

function multiplyDivideHalfUp(value, multiplier, divisor, label = "Money calculation") {
  const source = BigInt(safeInteger(value, label));
  const factor = BigInt(safeInteger(multiplier, `${label} multiplier`));
  const base = BigInt(safeInteger(divisor, `${label} divisor`));
  if (source < 0n || factor < 0n || base <= 0n) {
    throw new PricingV2Error("invalid_money_operation", `${label} accepts positive values only.`);
  }
  const result = ((source * factor) + (base / 2n)) / base;
  const number = Number(result);
  if (!Number.isSafeInteger(number)) {
    throw new PricingV2Error("money_overflow", `${label} exceeds safe minor-unit range.`);
  }
  return number;
}

function rateMicros(value, label) {
  return decimalToScaled(value, RATE_SCALE, label);
}

function quantityMillis(value, label) {
  return decimalToScaled(value, QUANTITY_SCALE, label);
}

function stableIds(value) {
  if (!Array.isArray(value)) return [];
  return [...new Set(value.map(text).filter(Boolean))].slice(0, 500);
}

function normalizePricingMode(value, fallback = "per_event") {
  const mode = text(value).toLowerCase();
  return ["per_person", "per_item", "per_event"].includes(mode) ? mode : fallback;
}

function dateParts(value) {
  const match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(text(value));
  if (!match) return null;
  const month = Number(match[2]);
  const day = Number(match[3]);
  const date = new Date(Date.UTC(Number(match[1]), month - 1, day));
  if (date.getUTCMonth() + 1 !== month || date.getUTCDate() !== day) return null;
  return { month, day };
}

function monthDayValue(month, day) {
  return (Number(month) * 100) + Number(day);
}

function seasonContains(profile, month, day) {
  const value = monthDayValue(month, day);
  const start = monthDayValue(profile.startMonth, profile.startDay);
  const end = monthDayValue(profile.endMonth, profile.endDay);
  return start <= end ? value >= start && value <= end : value >= start || value <= end;
}

function fullYear(profile) {
  return Number(profile?.startMonth) === 1
    && Number(profile?.startDay) === 1
    && Number(profile?.endMonth) === 12
    && Number(profile?.endDay) === 31;
}

function validateServiceFeeTiers(settings = {}) {
  const tiers = Array.isArray(settings.serviceFeeTiers) ? settings.serviceFeeTiers : [];
  const ids = new Set();
  const normalized = tiers.map((tier, index) => {
    const id = text(tier?.id);
    const minGuests = Number(tier?.minGuests);
    const maxGuests = Number(tier?.maxGuests);
    const pct = Number(tier?.pct);
    if (!id || ids.has(id)) throw new PricingV2Error("invalid_service_fee_tiers", `Service-fee tier ${index + 1} has a missing or duplicate ID.`);
    ids.add(id);
    if (!Number.isSafeInteger(minGuests) || !Number.isSafeInteger(maxGuests) || minGuests < 0 || maxGuests < minGuests) {
      throw new PricingV2Error("invalid_service_fee_tiers", `Service-fee tier ${id} has invalid bounds.`);
    }
    if (!Number.isFinite(pct) || pct < 0 || pct > 1) {
      throw new PricingV2Error("invalid_service_fee_tiers", `Service-fee tier ${id} has an invalid percentage.`);
    }
    return { id, minGuests, maxGuests, pct };
  }).sort((left, right) => left.minGuests - right.minGuests || left.maxGuests - right.maxGuests || left.id.localeCompare(right.id));
  for (let index = 1; index < normalized.length; index += 1) {
    if (normalized[index].minGuests <= normalized[index - 1].maxGuests) {
      throw new PricingV2Error("overlapping_service_fee_tiers", `Service-fee tiers ${normalized[index - 1].id} and ${normalized[index].id} overlap.`);
    }
  }
  return normalized;
}

function normalizeTaxRegions(settings = {}) {
  const regions = Array.isArray(settings.taxRegions) ? settings.taxRegions : [];
  const ids = new Set();
  return regions.map((region, index) => {
    const id = text(region?.id);
    const rate = Number(region?.rate);
    if (!id || ids.has(id)) throw new PricingV2Error("invalid_tax_regions", `Tax region ${index + 1} has a missing or duplicate ID.`);
    if (!Number.isFinite(rate) || rate < 0 || rate > 1) throw new PricingV2Error("invalid_tax_regions", `Tax region ${id} has an invalid rate.`);
    ids.add(id);
    return { id, name: text(region?.name) || id, rate };
  });
}

function normalizeSeasonalProfiles(settings = {}) {
  const profiles = Array.isArray(settings.seasonalProfiles) ? settings.seasonalProfiles : [];
  const ids = new Set();
  const normalized = profiles.map((profile, index) => {
    const id = text(profile?.id);
    if (!id || ids.has(id)) throw new PricingV2Error("invalid_season_profiles", `Season profile ${index + 1} has a missing or duplicate ID.`);
    ids.add(id);
    const result = {
      id,
      name: text(profile?.name) || id,
      startMonth: Number(profile?.startMonth),
      startDay: Number(profile?.startDay),
      endMonth: Number(profile?.endMonth),
      endDay: Number(profile?.endDay),
      priority: profile?.priority === undefined ? null : Number(profile.priority),
      packageMultiplier: Number(profile?.packageMultiplier ?? 1),
      addonMultiplier: Number(profile?.addonMultiplier ?? 1),
      rentalMultiplier: Number(profile?.rentalMultiplier ?? 1)
    };
    const datesValid = dateParts(`2024-${String(result.startMonth).padStart(2, "0")}-${String(result.startDay).padStart(2, "0")}`)
      && dateParts(`2024-${String(result.endMonth).padStart(2, "0")}-${String(result.endDay).padStart(2, "0")}`);
    if (!datesValid) throw new PricingV2Error("invalid_season_profiles", `Season profile ${id} has an invalid date range.`);
    if (result.priority !== null && (!Number.isSafeInteger(result.priority) || result.priority < 0)) {
      throw new PricingV2Error("invalid_season_profiles", `Season profile ${id} has an invalid priority.`);
    }
    ["packageMultiplier", "addonMultiplier", "rentalMultiplier"].forEach((field) => {
      if (!Number.isFinite(result[field]) || result[field] < 0.5 || result[field] > 2) {
        throw new PricingV2Error("invalid_season_profiles", `Season profile ${id} has an invalid ${field}.`);
      }
    });
    return result;
  });
  const specific = normalized.filter((profile) => !fullYear(profile));
  for (let leftIndex = 0; leftIndex < specific.length; leftIndex += 1) {
    for (let rightIndex = leftIndex + 1; rightIndex < specific.length; rightIndex += 1) {
      const left = specific[leftIndex];
      const right = specific[rightIndex];
      let overlaps = false;
      for (let month = 1; month <= 12 && !overlaps; month += 1) {
        for (let day = 1; day <= 31; day += 1) {
          if (dateParts(`2024-${String(month).padStart(2, "0")}-${String(day).padStart(2, "0")}`)
            && seasonContains(left, month, day)
            && seasonContains(right, month, day)) {
            overlaps = true;
            break;
          }
        }
      }
      if (overlaps && (left.priority === null || right.priority === null || left.priority === right.priority)) {
        throw new PricingV2Error("ambiguous_season_profiles", `Season profiles ${left.id} and ${right.id} overlap without unique priority.`);
      }
    }
  }
  return normalized;
}

function validatePricingV2Policy(settings = {}) {
  const serviceFeeTiers = validateServiceFeeTiers(settings);
  const taxRegions = normalizeTaxRegions(settings);
  const seasonalProfiles = normalizeSeasonalProfiles(settings);
  const defaultTaxRegion = text(settings.defaultTaxRegion);
  if (defaultTaxRegion && taxRegions.length && !taxRegions.some((region) => region.id === defaultTaxRegion)) {
    throw new PricingV2Error("invalid_default_tax_region", `Default tax region ${defaultTaxRegion} is unavailable.`);
  }
  const defaultSeasonProfile = text(settings.defaultSeasonProfile);
  if (defaultSeasonProfile && defaultSeasonProfile !== "auto" && !seasonalProfiles.some((profile) => profile.id === defaultSeasonProfile)) {
    throw new PricingV2Error("invalid_default_season_profile", `Default season profile ${defaultSeasonProfile} is unavailable.`);
  }
  ["serviceFeePct", "taxRate", "depositPct"].forEach((field) => {
    const value = Number(settings[field] ?? 0);
    if (!Number.isFinite(value) || value < 0 || value > 1) {
      throw new PricingV2Error("invalid_pricing_rate", `${field} must be between 0 and 1.`);
    }
  });
  return { serviceFeeTiers, taxRegions, seasonalProfiles };
}

function resolveServiceFeePctV2(guests, settings, policy) {
  const match = policy.serviceFeeTiers.find((tier) => guests >= tier.minGuests && guests <= tier.maxGuests);
  return match ? { id: match.id, pct: match.pct, source: "service_fee_tier" } : {
    id: "scalar-fallback",
    pct: Number(settings.serviceFeePct || 0),
    source: "service_fee_scalar"
  };
}

function resolveTaxRegionV2(form, settings, policy) {
  const explicit = text(form?.taxRegion || form?.taxRegionId);
  const requested = explicit || text(settings.defaultTaxRegion);
  if (requested) {
    const found = policy.taxRegions.find((region) => region.id === requested);
    if (!found) {
      throw new PricingV2Error("invalid_tax_region", `${explicit ? "Selected" : "Default"} tax region ${requested} is unavailable.`);
    }
    return { ...found, source: explicit ? "explicit" : "configured_default" };
  }
  return { id: "scalar", name: "Configured tax rate", rate: Number(settings.taxRate || 0), source: "scalar_fallback" };
}

function resolveSeasonProfileV2(form, settings, policy) {
  const explicit = text(form?.seasonProfileId);
  if (explicit && explicit !== "auto") {
    const found = policy.seasonalProfiles.find((profile) => profile.id === explicit);
    if (!found) throw new PricingV2Error("invalid_season_profile", `Selected season profile ${explicit} is unavailable.`);
    return { ...found, source: "explicit" };
  }
  const fixed = text(settings.defaultSeasonProfile);
  if (fixed && fixed !== "auto") {
    const found = policy.seasonalProfiles.find((profile) => profile.id === fixed);
    if (!found) throw new PricingV2Error("invalid_season_profile", `Default season profile ${fixed} is unavailable.`);
    return { ...found, source: "configured_default" };
  }
  const date = dateParts(form?.date);
  if (date) {
    const matches = policy.seasonalProfiles
      .filter((profile) => !fullYear(profile) && seasonContains(profile, date.month, date.day))
      .sort((left, right) => Number(right.priority ?? -1) - Number(left.priority ?? -1) || left.id.localeCompare(right.id));
    if (matches.length) return { ...matches[0], source: "matching_specific" };
  }
  const standard = policy.seasonalProfiles.find((profile) => profile.id === "standard")
    || policy.seasonalProfiles.find(fullYear);
  return standard ? { ...standard, source: "standard_fallback" } : {
    id: "standard",
    name: "Standard",
    packageMultiplier: 1,
    addonMultiplier: 1,
    rentalMultiplier: 1,
    source: "neutral_fallback"
  };
}

function lineQuantity(pricingMode, guests, requestedQuantity, qtyPerGuests = 1) {
  if (pricingMode === "per_person") return guests;
  if (pricingMode === "per_item") {
    const fallback = Math.max(1, Math.ceil(guests / Math.max(1, finite(qtyPerGuests, 1))));
    const quantity = requestedQuantity === undefined ? fallback : Number(requestedQuantity);
    if (!Number.isSafeInteger(quantity) || quantity < 1) throw new PricingV2Error("invalid_quantity", "Component quantity must be a positive integer.");
    return quantity;
  }
  return 1;
}

function buildWaterfallLine({ id, category, name, pricingMode, unitPriceMinor, quantity, multiplier, multiplierPolicyId, included, inclusionPolicyId = "" }) {
  const quantityScaled = quantityMillis(quantity, `${name} quantity`);
  const baseMinor = multiplyDivideHalfUp(unitPriceMinor, quantityScaled, QUANTITY_SCALE, `${name} base line`);
  const multiplierScaled = rateMicros(multiplier, `${name} multiplier`);
  const contextAfterMinor = multiplyDivideHalfUp(baseMinor, multiplierScaled, RATE_SCALE, `${name} contextual line`);
  const effectiveMinor = included ? 0 : contextAfterMinor;
  const adjustments = [];
  if (contextAfterMinor !== baseMinor) {
    adjustments.push({
      type: "context_adjustment",
      sourcePolicyId: multiplierPolicyId,
      basis: "rounded_line_extension",
      beforeMinor: baseMinor,
      adjustmentMinor: contextAfterMinor - baseMinor,
      afterMinor: contextAfterMinor,
      factorMicros: multiplierScaled,
      reason: "Declared contextual pricing policy applied.",
      authority: "server_authoritative"
    });
  }
  if (included) {
    adjustments.push({
      type: "bundle_inclusion",
      sourcePolicyId: inclusionPolicyId,
      basis: "configured_offer_inclusion",
      beforeMinor: contextAfterMinor,
      adjustmentMinor: -contextAfterMinor,
      afterMinor: 0,
      reason: "Component is included in the authoritative configured offer.",
      authority: "server_authoritative"
    });
  }
  return {
    id,
    category,
    name,
    pricingMode,
    catalogUnitPriceMinor: unitPriceMinor,
    baseLineMinor: baseMinor,
    effectiveUnitPriceMinor: included ? 0 : multiplyDivideHalfUp(unitPriceMinor, multiplierScaled, RATE_SCALE, `${name} unit`),
    unitPriceMinor: included ? 0 : unitPriceMinor,
    quantity,
    lineTotalMinor: effectiveMinor,
    totalMinor: effectiveMinor,
    unitPrice: fromMinor(included ? 0 : unitPriceMinor),
    total: fromMinor(effectiveMinor),
    adjustments,
    meta: { includedInPackage: included, multiplier, packageId: included ? inclusionPolicyId : "" }
  };
}

function rateList(count, csv, fallback) {
  const requested = text(csv)
    .split(",")
    .map((value) => value.trim())
    .filter(Boolean)
    .map(Number)
    .filter((value) => Number.isFinite(value) && value >= 0);
  return Array.from({ length: count }, (_, index) => requested[index] ?? fallback);
}

function selectedRate(settings, form, kind) {
  if (kind === "bartender") {
    const override = form.bartenderRateOverride;
    if (override !== "" && override !== undefined && Number.isFinite(Number(override))) return Number(override);
    const id = text(form.bartenderRateTypeId || settings.defaultBartenderRateType);
    return Number((settings.bartenderRateTypes || []).find((item) => text(item?.id) === id)?.rate ?? settings.bartenderRate ?? 0);
  }
  const override = kind === "server" ? form.serverRateOverride : form.chefRateOverride;
  if (override !== "" && override !== undefined && Number.isFinite(Number(override))) return Number(override);
  const id = text(form.staffingRateTypeId || settings.defaultStaffingRateType);
  const selected = (settings.staffingRateTypes || []).find((item) => text(item?.id) === id);
  return Number(kind === "server" ? selected?.serverRate ?? settings.serverRate ?? 0 : selected?.chefRate ?? settings.chefRate ?? 0);
}

function sum(lines, categories = null) {
  return lines.reduce((total, line) => categories && !categories.has(line.category) ? total : total + line.lineTotalMinor, 0);
}

function calculatePricingV2({ form = {}, catalog = {}, settings = {}, calculatedAt = "", authority = "client_preview", catalogSource = "" } = {}) {
  const policy = validatePricingV2Policy(settings);
  const guests = Math.min(PRICING_V2_MAX_DEMAND_QUANTITY, Math.max(0, Math.round(finite(form.guests, 0))));
  const packages = Array.isArray(catalog.packages) ? catalog.packages : [];
  const selectedPkg = packages.find((pkg) => text(pkg?.id) === text(form.pkg || form.packageId));
  if (!selectedPkg || selectedPkg.active === false) throw new PricingV2Error("unavailable_offer", "The selected configurable offer is unavailable.");
  const menuItems = Array.isArray(catalog.menuItems)
    ? catalog.menuItems
    : (settings.menuSections || []).flatMap((section) => section?.items || []);
  const completeCatalog = { ...catalog, menuItems, settings };
  let offer;
  let offerConfiguration;
  try {
    offer = validateConfigurableOffer(selectedPkg, completeCatalog);
    offerConfiguration = evaluateOfferConfiguration(selectedPkg, form.offerChoiceSelections, completeCatalog);
  } catch (error) {
    if (error instanceof CommercialPlatformError) throw new PricingV2Error("invalid_offer", error.message, error.details);
    throw error;
  }
  if (!offerConfiguration.valid) throw new PricingV2Error("invalid_offer_configuration", offerConfiguration.violations.map((item) => item.reason).join(" "));

  const selectedIds = {
    addon: new Set(stableIds(form.addons)),
    rental: new Set(stableIds(form.rentals)),
    menu_item: new Set(stableIds(form.menuItems)),
    resource: new Set()
  };
  offer.choiceGroups.forEach((group) => {
    (offerConfiguration.selections[group.id] || []).forEach((componentId) => {
      if (!selectedIds[group.componentType]?.has(componentId)) {
        throw new PricingV2Error("offer_choice_not_selected", `Offer choice ${componentId} is not present in the quote selection.`);
      }
    });
  });

  const taxRegion = resolveTaxRegionV2(form, settings, policy);
  const seasonProfile = resolveSeasonProfileV2(form, settings, policy);
  const serviceFeePolicy = resolveServiceFeePctV2(guests, settings, policy);
  const included = new Set(offer.includedComponents.map((ref) => `${ref.componentType}:${ref.componentId}`));
  const lines = [];
  lines.push(buildWaterfallLine({
    id: offer.id,
    category: "package",
    name: offer.name,
    pricingMode: "per_person",
    unitPriceMinor: moneyMinor(selectedPkg, "pppMinor", "ppp", `${offer.name} price`),
    quantity: guests,
    multiplier: seasonProfile.packageMultiplier,
    multiplierPolicyId: seasonProfile.id,
    included: false
  }));

  const quantities = {
    addon: form.addonQuantities || {},
    rental: form.rentalQuantities || {},
    menu_item: form.menuItemQuantities || {}
  };
  const groups = [
    ["addon", catalog.addons || [], "addonMultiplier", "priceMinor", "price", "per_person"],
    ["rental", catalog.rentals || [], "rentalMultiplier", "priceMinor", "price", "per_item"],
    ["menu_item", menuItems, "addonMultiplier", "priceMinor", "price", "per_event"]
  ];
  groups.forEach(([componentType, records, multiplierField, minorKey, majorKey, fallbackMode]) => {
    const lookup = new Map(records.map((item) => [text(item?.id), item]));
    selectedIds[componentType].forEach((id) => {
      const item = lookup.get(id);
      if (!item || item.active === false) throw new PricingV2Error("unavailable_component", `${componentType} ${id} is unavailable.`);
      const pricingMode = normalizePricingMode(item.pricingType || item.type, fallbackMode);
      const requested = quantities[componentType]?.[id];
      const quantity = lineQuantity(pricingMode, guests, requested, item.qtyPerGuests);
      lines.push(buildWaterfallLine({
        id,
        category: componentType,
        name: text(item.name) || id,
        pricingMode,
        unitPriceMinor: moneyMinor(item, minorKey, majorKey, `${text(item.name) || id} price`),
        quantity,
        multiplier: seasonProfile[multiplierField],
        multiplierPolicyId: seasonProfile.id,
        included: included.has(`${componentType}:${id}`),
        inclusionPolicyId: offer.id
      }));
    });
  });

  const staffingEnabled = settings.staffingLaborEnabled !== false;
  const staffingMode = text(settings.staffingChargeMode) === "per_event_per_staff" ? "per_event_per_staff" : "per_hour";
  const hours = Math.max(0, finite(form.hours, 0));
  const laborQuantity = staffingMode === "per_event_per_staff" ? 1 : hours;
  const servers = staffingEnabled ? Math.max(0, Math.round(finite(form.servers, 0))) : 0;
  const chefs = staffingEnabled ? Math.max(0, Math.round(finite(form.chefs, 0))) : 0;
  const bartenders = staffingEnabled ? Math.max(0, Math.round(finite(form.bartenders, 0))) : 0;
  const serverRates = rateList(servers, form.serverRateMixCsv, selectedRate(settings, form, "server"));
  const chefRates = rateList(chefs, form.chefRateMixCsv, selectedRate(settings, form, "chef"));
  const bartenderRate = selectedRate(settings, form, "bartender");
  const laborLines = [
    ["labor_servers", "labor", "Servers", serverRates.reduce((total, value) => total + toMinor(value, "Server rate"), 0)],
    ["labor_chefs", "labor", "Chefs", chefRates.reduce((total, value) => total + toMinor(value, "Chef rate"), 0)],
    ["labor_bartenders", "labor", "Bartenders", toMinor(bartenderRate, "Bartender rate") * bartenders]
  ];
  laborLines.forEach(([id, category, name, unitPriceMinor]) => {
    lines.push(buildWaterfallLine({ id, category, name, pricingMode: "per_event", unitPriceMinor, quantity: laborQuantity, multiplier: 1, multiplierPolicyId: "staffing", included: false }));
  });

  const miles = Math.max(0, finite(form.milesRT, 0));
  const threshold = Math.max(0, finite(settings.deliveryThresholdMiles, 0));
  const baseMiles = Math.min(miles, threshold);
  const longMiles = Math.max(0, miles - threshold);
  const travelMinor = multiplyDivideHalfUp(moneyMinor(settings, "perMileRateMinor", "perMileRate", "Travel rate"), quantityMillis(baseMiles, "Travel miles"), QUANTITY_SCALE, "Travel")
    + multiplyDivideHalfUp(moneyMinor(settings, "longDistancePerMileRateMinor", "longDistancePerMileRate", "Long-distance travel rate"), quantityMillis(longMiles, "Long-distance miles"), QUANTITY_SCALE, "Long-distance travel");
  lines.push(buildWaterfallLine({ id: "travel", category: "travel", name: "Travel", pricingMode: "per_event", unitPriceMinor: travelMinor, quantity: 1, multiplier: 1, multiplierPolicyId: "travel", included: false }));

  const subtotalMinor = sum(lines);
  const serviceFeeMinor = multiplyDivideHalfUp(subtotalMinor, rateMicros(serviceFeePolicy.pct, "Service fee rate"), RATE_SCALE, "Service fee");
  const taxableCategories = new Set(["package", "addon", "rental", "menu_item"]);
  const taxableBasisMinor = sum(lines, taxableCategories) + serviceFeeMinor;
  const taxMinor = multiplyDivideHalfUp(taxableBasisMinor, rateMicros(taxRegion.rate, "Tax rate"), RATE_SCALE, "Tax");
  const grandTotalMinor = subtotalMinor + serviceFeeMinor + taxMinor;
  const depositMinor = multiplyDivideHalfUp(grandTotalMinor, rateMicros(settings.depositPct || 0, "Deposit rate"), RATE_SCALE, "Deposit");
  const balanceMinor = grandTotalMinor - depositMinor;
  const serviceFeeLine = { id: "service_fee", category: "service_fee", name: "Service Fee", pricingMode: "per_event", catalogUnitPriceMinor: serviceFeeMinor, baseLineMinor: serviceFeeMinor, effectiveUnitPriceMinor: serviceFeeMinor, unitPriceMinor: serviceFeeMinor, quantity: 1, lineTotalMinor: serviceFeeMinor, totalMinor: serviceFeeMinor, unitPrice: fromMinor(serviceFeeMinor), total: fromMinor(serviceFeeMinor), adjustments: [], meta: { sourcePolicyId: serviceFeePolicy.id } };
  const taxLine = { id: "tax", category: "tax", name: "Tax", pricingMode: "per_event", catalogUnitPriceMinor: taxMinor, baseLineMinor: taxMinor, effectiveUnitPriceMinor: taxMinor, unitPriceMinor: taxMinor, quantity: 1, lineTotalMinor: taxMinor, totalMinor: taxMinor, unitPrice: fromMinor(taxMinor), total: fromMinor(taxMinor), adjustments: [], meta: { taxRegionId: taxRegion.id } };
  const chargeLines = [...lines, serviceFeeLine, taxLine];
  const laborMinor = sum(lines, new Set(["labor"]));
  const travelLineMinor = sum(lines, new Set(["travel"]));

  return {
    pricingVersion: PRICING_V2_VERSION,
    calculatedAt: text(calculatedAt),
    authority,
    roundingPolicy: PRICING_V2_ROUNDING,
    policyId: PRICING_V2_POLICY,
    lineItems: chargeLines,
    priceWaterfall: chargeLines.map((line) => ({ lineId: line.id, category: line.category, baseMinor: line.baseLineMinor, adjustments: line.adjustments, effectiveMinor: line.lineTotalMinor })),
    fees: {
      laborMinor,
      travelMinor: travelLineMinor,
      serviceFeeMinor,
      labor: fromMinor(laborMinor),
      serverLabor: fromMinor(lines.find((line) => line.id === "labor_servers")?.lineTotalMinor || 0),
      chefLabor: fromMinor(lines.find((line) => line.id === "labor_chefs")?.lineTotalMinor || 0),
      bartenderLabor: fromMinor(lines.find((line) => line.id === "labor_bartenders")?.lineTotalMinor || 0),
      travel: fromMinor(travelLineMinor),
      serviceFee: fromMinor(serviceFeeMinor)
    },
    tax: { rate: taxRegion.rate, amountMinor: taxMinor, amount: fromMinor(taxMinor), regionId: taxRegion.id, regionName: taxRegion.name },
    discountTotalMinor: 0,
    discountTotal: 0,
    subtotalMinor,
    subtotal: fromMinor(subtotalMinor),
    grandTotalMinor,
    grandTotal: fromMinor(grandTotalMinor),
    deposit: { pct: Number(settings.depositPct || 0), amountMinor: depositMinor, amount: fromMinor(depositMinor) },
    balance: { amountMinor: balanceMinor, amount: fromMinor(balanceMinor) },
    rulesSnapshot: {
      catalogSource,
      policyId: PRICING_V2_POLICY,
      roundingPolicy: PRICING_V2_ROUNDING,
      maximumDemandQuantity: PRICING_V2_MAX_DEMAND_QUANTITY,
      serviceFeeBasis: "rounded_subtotal",
      taxableBasis: "package_components_plus_service_fee",
      depositBasis: "grand_total_minor",
      serviceFeePctApplied: serviceFeePolicy.pct,
      serviceFeePolicyId: serviceFeePolicy.id,
      taxRateApplied: taxRegion.rate,
      taxRegionId: taxRegion.id,
      taxRegionName: taxRegion.name,
      seasonProfileId: seasonProfile.id,
      seasonProfileName: seasonProfile.name,
      seasonResolution: seasonProfile.source,
      packageMultiplier: seasonProfile.packageMultiplier,
      addonMultiplier: seasonProfile.addonMultiplier,
      rentalMultiplier: seasonProfile.rentalMultiplier,
      depositPct: Number(settings.depositPct || 0),
      offerConfiguration,
      settingsSnapshot: {
        serviceFeePct: Number(settings.serviceFeePct || 0),
        serviceFeeTiers: policy.serviceFeeTiers,
        taxRate: Number(settings.taxRate || 0),
        taxRegions: policy.taxRegions,
        defaultTaxRegion: text(settings.defaultTaxRegion),
        depositPct: Number(settings.depositPct || 0),
        seasonalProfiles: policy.seasonalProfiles,
        defaultSeasonProfile: text(settings.defaultSeasonProfile),
        staffingChargeMode: staffingMode,
        staffingLaborEnabled: staffingEnabled,
        perMileRateMinor: moneyMinor(settings, "perMileRateMinor", "perMileRate", "Travel rate"),
        longDistancePerMileRateMinor: moneyMinor(settings, "longDistancePerMileRateMinor", "longDistancePerMileRate", "Long-distance travel rate"),
        bartenderRateMinor: moneyMinor(settings, "bartenderRateMinor", "bartenderRate", "Bartender rate"),
        serverRateMinor: moneyMinor(settings, "serverRateMinor", "serverRate", "Server rate"),
        chefRateMinor: moneyMinor(settings, "chefRateMinor", "chefRate", "Chef rate")
      }
    },
    inputs: {
      event: { guests, hours, date: text(form.date), taxRegionId: taxRegion.id, seasonProfileId: seasonProfile.id },
      selection: { package: { id: offer.id, name: offer.name }, addons: [...selectedIds.addon], rentals: [...selectedIds.rental], menuItems: [...selectedIds.menu_item], offerChoiceSelections: offerConfiguration.selections }
    }
  };
}

module.exports = {
  PRICING_V2_MAX_DEMAND_QUANTITY,
  PRICING_V2_POLICY,
  PRICING_V2_ROUNDING,
  PRICING_V2_VERSION,
  PricingV2Error,
  calculatePricingV2,
  fromMinor,
  multiplyDivideHalfUp,
  resolveSeasonProfileV2,
  resolveServiceFeePctV2,
  resolveTaxRegionV2,
  toMinor,
  validatePricingV2Policy
};
