function stableIds(value) {
  return (Array.isArray(value) ? value : [])
    .map((id) => String(id || "").trim())
    .filter(Boolean)
    .slice(0, 100);
}

export function normalizePricingType(value) {
  const raw = String(value || "").trim().toLowerCase();
  if (raw === "per_person" || raw === "per_item" || raw === "per_event") {
    return raw;
  }
  return "per_event";
}

export function normalizeAddonStaffRole(value) {
  const raw = String(value || "").trim().toLowerCase();
  if (raw === "server" || raw === "chef" || raw === "bartender") return raw;
  return "";
}

// Cost fields are optional, staff-only, and must preserve "not recorded" as
// null rather than coercing it to 0 the way always-present revenue fields do.
export function toNullableMinor(value) {
  if (value === "" || value === null || value === undefined) return null;
  const numeric = Number(value);
  return Number.isFinite(numeric) ? Math.round(numeric * 100) : null;
}

export function packageWriteShape(item = {}) {
  return {
    name: String(item.name || ""),
    pppMinor: Math.round(Number(item.ppp || 0) * 100),
    costPppMinor: toNullableMinor(item.costPpp),
    includedMenuItemIds: stableIds(item.includedMenuItemIds),
    includedAddonIds: stableIds(item.includedAddonIds),
    includedRentalIds: stableIds(item.includedRentalIds),
    active: item.active !== false
  };
}

export function addonWriteShape(item = {}) {
  const pricingType = normalizePricingType(item.pricingType || item.type || "per_person");
  return {
    name: String(item.name || ""),
    pricingType,
    type: pricingType,
    priceMinor: Math.round(Number(item.price || 0) * 100),
    costMinor: toNullableMinor(item.cost),
    staffRole: normalizeAddonStaffRole(item.staffRole),
    active: item.active !== false,
    portalDecidable: item.portalDecidable === true
  };
}

export function rentalWriteShape(item = {}) {
  const pricingType = normalizePricingType(item.pricingType || item.type || "per_item");
  return {
    name: String(item.name || ""),
    priceMinor: Math.round(Number(item.price || 0) * 100),
    costMinor: toNullableMinor(item.cost),
    qtyPerGuests: Number(item.qtyPerGuests || 1),
    pricingType,
    type: pricingType,
    active: item.active !== false,
    portalDecidable: item.portalDecidable === true
  };
}
