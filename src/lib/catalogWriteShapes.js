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
    ...((Array.isArray(item.choiceGroups) && item.choiceGroups.length) ? {
      choiceGroups: item.choiceGroups.map((group) => ({
        id: String(group?.id || "").trim(),
        label: String(group?.label || group?.name || "").trim(),
        componentType: String(group?.componentType || group?.type || "").trim().toLowerCase(),
        componentIds: stableIds(group?.componentIds),
        minChoices: Number(group?.minChoices ?? (group?.required === true ? 1 : 0)),
        maxChoices: Number(group?.maxChoices ?? (Array.isArray(group?.componentIds) ? group.componentIds.length : 0))
      }))
    } : {}),
    ...(stableIds(item.quantityPolicyRefs).length ? { quantityPolicyRefs: stableIds(item.quantityPolicyRefs) } : {}),
    ...(stableIds(item.ruleRefs).length ? { ruleRefs: stableIds(item.ruleRefs) } : {}),
    ...(item.offerVersion && item.offerVersion !== "configurable-offer-v1" ? { offerVersion: String(item.offerVersion) } : {}),
    ...(item.verticalType && item.verticalType !== "catering" ? { verticalType: String(item.verticalType) } : {}),
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
