export const COMMERCIAL_SNAPSHOT_VERSION = "commercial-snapshot-v1";
export const COMMERCIAL_SNAPSHOT_BOUNDARY =
  "Saved commercial snapshots are staff-only recorded cost evidence. They are never customer output, accounting truth, authoritative repricing, or permission to charge, accept, book, or settle.";

const MARGIN_MODEL = "margin-presentation-v1";
const MAX_MISSING_NAMED = 6;

function text(value, fallback = "") {
  const normalized = String(value ?? "").trim();
  return normalized || fallback;
}

function finiteNumber(value, fallback = 0) {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : fallback;
}

function nullableNumber(value) {
  if (value === "" || value === null || value === undefined) return null;
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : null;
}

function record(value) {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}

function pricingMode(value, fallback = "per_event") {
  const normalized = text(value, fallback).toLowerCase();
  if (normalized === "per_person" || normalized === "per_item" || normalized === "per_event") {
    return normalized;
  }
  return fallback;
}

function roundedMoney(value) {
  return Math.round(finiteNumber(value, 0) * 100) / 100;
}

function menuCatalogItems(catalog) {
  return (catalog?.settings?.menuSections || []).flatMap((section) => section?.items || []);
}

function resolveQuantity({ guests, rawQuantity, item }) {
  const explicit = Number(rawQuantity);
  if (Number.isFinite(explicit) && explicit > 0) return Math.max(1, Math.round(explicit));
  const perGuests = Number(item?.qtyPerGuests);
  if (Number.isFinite(perGuests) && perGuests > 0) {
    return Math.max(1, Math.ceil(guests / perGuests));
  }
  return 1;
}

function lineExtendedCost({ mode, guests, quantity, unitCost }) {
  if (unitCost === null) return null;
  if (mode === "per_person") return roundedMoney(unitCost * guests);
  if (mode === "per_item") return roundedMoney(unitCost * quantity);
  return roundedMoney(unitCost);
}

function buildCatalogLineSnapshot({
  id,
  item,
  guests,
  quantity,
  defaultMode
} = {}) {
  const fallbackId = text(id, text(item?.id));
  const name = text(item?.name, fallbackId || "Selected item");
  const mode = pricingMode(item?.pricingType || item?.type, defaultMode);
  const resolvedQuantity = Math.max(1, Math.round(Number(quantity) || 1));
  const unitCost = nullableNumber(item?.cost);
  return {
    id: fallbackId,
    name,
    pricingMode: mode,
    quantity: resolvedQuantity,
    unitCost,
    extendedCost: lineExtendedCost({
      mode,
      guests,
      quantity: resolvedQuantity,
      unitCost
    }),
    missingReason: unitCost === null ? "cost_missing" : ""
  };
}

function buildMissingCatalogLineSnapshot({
  id,
  name,
  quantity,
  defaultMode
} = {}) {
  const fallbackId = text(id, "unknown");
  return {
    id: fallbackId,
    name: text(name, fallbackId),
    pricingMode: pricingMode(defaultMode, "per_event"),
    quantity: Math.max(1, Math.round(Number(quantity) || 1)),
    unitCost: null,
    extendedCost: null,
    missingReason: "catalog_item_unavailable"
  };
}

function buildGroupSnapshots({
  ids = [],
  source = [],
  namesById = {},
  quantities = {},
  guests = 0,
  defaultMode = "per_event"
} = {}) {
  return (Array.isArray(ids) ? ids : []).map((rawId) => {
    const id = text(rawId);
    if (!id) return null;
    const item = (Array.isArray(source) ? source : []).find((entry) => text(entry?.id) === id);
    const quantity = resolveQuantity({
      guests,
      rawQuantity: quantities?.[id],
      item
    });
    if (!item) {
      return buildMissingCatalogLineSnapshot({
        id,
        name: namesById?.[id],
        quantity,
        defaultMode
      });
    }
    return buildCatalogLineSnapshot({
      id,
      item,
      guests,
      quantity,
      defaultMode
    });
  }).filter(Boolean);
}

function buildStaffRoleSnapshot({
  id,
  label,
  count,
  rate,
  units
} = {}) {
  const safeCount = Math.max(0, Math.round(Number(count) || 0));
  const safeUnits = Math.max(0, Number(units) || 0);
  const unitCostRate = nullableNumber(rate);
  return {
    id: text(id),
    label: text(label),
    count: safeCount,
    units: safeUnits,
    unitCostRate,
    extendedCost: safeCount > 0 && unitCostRate !== null
      ? roundedMoney(unitCostRate * safeCount * safeUnits)
      : safeCount > 0
        ? null
        : 0,
    missingReason: safeCount > 0 && unitCostRate === null ? "cost_rate_missing" : ""
  };
}

function missingLabelForSnapshotLine(line) {
  const name = text(line?.name, text(line?.id, "Selected item"));
  if (line?.missingReason === "catalog_item_unavailable") {
    return `${name} (saved cost evidence unavailable)`;
  }
  return `${name} (cost)`;
}

export function buildCommercialSnapshot({
  form = {},
  catalog = {},
  settings = {},
  selection = {}
} = {}) {
  if (!record(form) || !record(catalog) || !record(settings)) return null;

  const guests = Math.min(400, Math.max(0, Math.round(Number(form.guests) || 0)));
  const addonIds = Array.isArray(selection.addons) ? selection.addons : form.addons;
  const rentalIds = Array.isArray(selection.rentals) ? selection.rentals : form.rentals;
  const menuItemIds = Array.isArray(selection.menuItems) ? selection.menuItems : form.menuItems;
  const addonQuantities = record(selection.addonQuantities) ? selection.addonQuantities : (form.addonQuantities || {});
  const rentalQuantities = record(selection.rentalQuantities) ? selection.rentalQuantities : (form.rentalQuantities || {});
  const menuItemQuantities = record(selection.menuItemQuantities) ? selection.menuItemQuantities : (form.menuItemQuantities || {});
  const menuItemNames = Array.isArray(selection.menuItemNames)
    ? selection.menuItemNames
    : Array.isArray(form.menuItemNames)
      ? form.menuItemNames
      : [];
  const menuItemDetails = Array.isArray(selection.menuItemDetails) ? selection.menuItemDetails : [];
  const menuItemNamesById = menuItemDetails.reduce((acc, item) => {
    const id = text(item?.id);
    if (!id) return acc;
    acc[id] = text(item?.name, id);
    return acc;
  }, {});
  menuItemIds.forEach((rawId, index) => {
    const id = text(rawId);
    if (!id || menuItemNamesById[id]) return;
    menuItemNamesById[id] = text(menuItemNames[index], id);
  });

  const packageId = text(selection.packageId || form.pkg);
  const packageName = text(selection.packageName);
  const pkg = (catalog?.packages || []).find((item) => text(item?.id) === packageId);
  const packageCostPpp = nullableNumber(pkg?.costPpp);
  const resolvedPackageName = text(pkg?.name, packageName || packageId || "Package");
  const staffingChargeMode = text(settings?.staffingChargeMode, "per_hour");
  const hourFactor = staffingChargeMode === "per_event_per_staff"
    ? 1
    : Math.max(1, Number(form.hours) || 1);

  return {
    version: COMMERCIAL_SNAPSHOT_VERSION,
    capturedAtISO: new Date().toISOString(),
    boundary: COMMERCIAL_SNAPSHOT_BOUNDARY,
    guestCount: guests,
    targetMarginPct: nullableNumber(settings?.targetMarginPct),
    package: {
      id: packageId,
      name: resolvedPackageName,
      unitCostPpp: packageCostPpp,
      extendedCost: packageId && packageCostPpp !== null ? roundedMoney(packageCostPpp * guests) : null,
      missingReason: packageId && packageCostPpp === null
        ? (pkg ? "cost_missing" : "catalog_item_unavailable")
        : ""
    },
    addons: buildGroupSnapshots({
      ids: addonIds,
      source: catalog?.addons || [],
      quantities: addonQuantities,
      guests,
      defaultMode: "per_event"
    }),
    rentals: buildGroupSnapshots({
      ids: rentalIds,
      source: catalog?.rentals || [],
      quantities: rentalQuantities,
      guests,
      defaultMode: "per_item"
    }),
    menuItems: buildGroupSnapshots({
      ids: menuItemIds,
      source: menuCatalogItems(catalog),
      namesById: menuItemNamesById,
      quantities: menuItemQuantities,
      guests,
      defaultMode: "per_event"
    }),
    staffing: {
      enabled: settings?.staffingLaborEnabled !== false,
      chargeMode: staffingChargeMode === "per_event_per_staff" ? "per_event_per_staff" : "per_hour",
      hours: Math.max(1, Number(form.hours) || 1),
      roles: [
        buildStaffRoleSnapshot({
          id: "servers",
          label: "serverCostRate",
          count: form.servers,
          rate: settings?.serverCostRate,
          units: hourFactor
        }),
        buildStaffRoleSnapshot({
          id: "chefs",
          label: "chefCostRate",
          count: form.chefs,
          rate: settings?.chefCostRate,
          units: hourFactor
        }),
        buildStaffRoleSnapshot({
          id: "bartenders",
          label: "bartenderCostRate",
          count: form.bartenders,
          rate: settings?.bartenderCostRate,
          units: hourFactor
        })
      ]
    }
  };
}

export function buildMarginPresentationFromCommercialSnapshot({
  commercialSnapshot = null,
  totals = {}
} = {}) {
  if (!record(commercialSnapshot) || !record(totals)) return null;
  const missing = [];
  let cost = 0;

  const packageSnapshot = record(commercialSnapshot.package) ? commercialSnapshot.package : null;
  if (packageSnapshot?.id) {
    if (packageSnapshot.extendedCost === null) {
      if (packageSnapshot.missingReason === "catalog_item_unavailable") {
        missing.push(`${text(packageSnapshot.name, "Package")} (saved cost evidence unavailable)`);
      } else {
        missing.push(`${text(packageSnapshot.name, "Package")} (costPpp)`);
      }
    } else {
      cost += finiteNumber(packageSnapshot.extendedCost, 0);
    }
  }

  ["addons", "rentals", "menuItems"].forEach((key) => {
    (Array.isArray(commercialSnapshot[key]) ? commercialSnapshot[key] : []).forEach((line) => {
      if (line?.extendedCost === null) {
        missing.push(missingLabelForSnapshotLine(line));
        return;
      }
      cost += finiteNumber(line?.extendedCost, 0);
    });
  });

  const staffing = record(commercialSnapshot.staffing) ? commercialSnapshot.staffing : {};
  if (staffing.enabled !== false) {
    (Array.isArray(staffing.roles) ? staffing.roles : []).forEach((role) => {
      const count = Math.max(0, Math.round(Number(role?.count) || 0));
      if (count <= 0) return;
      if (role?.extendedCost === null) {
        missing.push(`Settings (${text(role?.label, text(role?.id, "staffCostRate"))})`);
        return;
      }
      cost += finiteNumber(role?.extendedCost, 0);
    });
  }

  if (missing.length) {
    const named = missing.slice(0, MAX_MISSING_NAMED);
    return {
      modelId: MARGIN_MODEL,
      available: false,
      missingCount: missing.length,
      missing: named,
      note: `Margins unavailable — record costs to unlock them: ${named.join(", ")}${missing.length > named.length ? ", …" : ""}.`
    };
  }

  const revenue = ["base", "addons", "rentals", "menu", "labor", "serviceFee"]
    .reduce((sum, key) => sum + (Number(totals?.[key]) || 0), 0);
  if (!(revenue > 0)) return null;

  const marginPct = (revenue - cost) / revenue;
  const target = nullableNumber(commercialSnapshot.targetMarginPct);
  const targetNote = target !== null
    ? (marginPct >= target
        ? `Meets your ${Math.round(target * 100)}% target.`
        : `${((target - marginPct) * 100).toFixed(1)} points below your ${Math.round(target * 100)}% target.`)
    : "";

  return {
    modelId: MARGIN_MODEL,
    available: true,
    revenue,
    cost,
    marginPct,
    target,
    targetNote,
    note: "Margin on the saved catering scope from recorded cost evidence captured with this quote; travel and tax are excluded, and costs never appear to customers."
  };
}
