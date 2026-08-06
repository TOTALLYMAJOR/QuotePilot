import { currency } from "./quoteCalculator";

function amountLabel(value) {
  return value > 0 ? `~${currency(value)} impact` : "No pricing impact";
}

function toNumber(value, fallback = 0) {
  const n = Number(value);
  return Number.isNaN(n) ? fallback : n;
}

function hasSelection(form, key, id) {
  return Array.isArray(form?.[key]) && form[key].includes(id);
}

function meetsThreshold(rule, guests, hours) {
  const minGuests = Math.max(0, toNumber(rule?.minGuests, 0));
  const minHours = Math.max(0, toNumber(rule?.minHours, 0));
  return guests >= minGuests && hours >= minHours;
}

function resolvePricingType(target) {
  const raw = String(target?.pricingType || target?.type || "").trim().toLowerCase();
  if (raw === "per_person" || raw === "per_item" || raw === "per_event") return raw;
  return "per_event";
}

function buildAddonRecommendation({ rule, catalog, form, guests, addonMultiplier }) {
  const target = catalog.addons.find((item) => item.id === rule.targetId && item?.active !== false);
  if (!target || hasSelection(form, "addons", target.id)) return null;
  const pricingType = resolvePricingType(target);
  const estimate = (
    pricingType === "per_person"
      ? Number(target.price || 0) * guests
      : Number(target.price || 0)
  ) * addonMultiplier;
  return {
    key: `${rule.id || "rule"}-addon-${target.id}`,
    kind: "addon",
    id: target.id,
    label: `Add ${target.name}`,
    reason: rule.reason || "Upsell rule matched this quote.",
    impact: amountLabel(estimate)
  };
}

function buildRentalRecommendation({ rule, catalog, form, guests, rentalMultiplier }) {
  const target = catalog.rentals.find((item) => item.id === rule.targetId && item?.active !== false);
  if (!target || hasSelection(form, "rentals", target.id)) return null;
  const pricingType = resolvePricingType(target);
  const qty = pricingType === "per_person"
    ? guests
    : pricingType === "per_item"
      ? typeof target.qtyRule === "function" ? target.qtyRule(guests) : 1
      : 1;
  const estimate = Number(target.price || 0) * qty * rentalMultiplier;
  return {
    key: `${rule.id || "rule"}-rental-${target.id}`,
    kind: "rental",
    id: target.id,
    label: `Add ${target.name}`,
    reason: rule.reason || "Upsell rule matched this quote.",
    impact: amountLabel(estimate)
  };
}

function buildPackageRecommendation({ rule, catalog, form, guests, packageMultiplier }) {
  const sortedPackages = [...catalog.packages]
    .filter((item) => item?.active !== false)
    .sort((a, b) => Number(a.ppp || 0) - Number(b.ppp || 0));
  const currentIndex = sortedPackages.findIndex((item) => item.id === form.pkg);
  if (currentIndex < 0) return null;
  const current = sortedPackages[currentIndex];

  let target = null;
  if (rule.targetId) {
    target = sortedPackages.find((item) => item.id === rule.targetId) || null;
    if (target && Number(target.ppp || 0) <= Number(current.ppp || 0)) {
      target = null;
    }
  } else if (currentIndex < sortedPackages.length - 1) {
    target = sortedPackages[currentIndex + 1];
  }

  if (!target || target.id === current.id) return null;

  const estimate = Math.max(0, (Number(target.ppp || 0) - Number(current.ppp || 0)) * guests * packageMultiplier);
  return {
    key: `${rule.id || "rule"}-package-${target.id}`,
    kind: "package",
    id: target.id,
    label: `Upgrade to ${target.name}`,
    reason: rule.reason || "Upsell rule matched this quote.",
    impact: amountLabel(estimate)
  };
}

export function buildUpsellRecommendations({ form, catalog, totals, settings }) {
  if (!settings?.guidedSellingEnabled) return [];

  const rules = Array.isArray(settings?.upsellRules) ? settings.upsellRules : [];
  if (!rules.length) return [];

  const guests = Number(form?.guests || 0);
  const hours = Number(form?.hours || 0);
  const suggestions = [];
  const seen = new Set();
  const addonMultiplier = Number(totals?.addonMultiplier || 1);
  const rentalMultiplier = Number(totals?.rentalMultiplier || 1);
  const packageMultiplier = Number(totals?.packageMultiplier || 1);

  for (const rule of rules) {
    if (!rule?.enabled || !meetsThreshold(rule, guests, hours)) continue;

    const kind = String(rule.kind || "").toLowerCase();
    const suggestion =
      kind === "addon"
        ? buildAddonRecommendation({ rule, catalog, form, guests, addonMultiplier })
        : kind === "rental"
          ? buildRentalRecommendation({ rule, catalog, form, guests, rentalMultiplier })
          : kind === "package"
            ? buildPackageRecommendation({ rule, catalog, form, guests, packageMultiplier })
            : null;

    if (!suggestion) continue;

    const uniqueKey = `${suggestion.kind}:${suggestion.id}`;
    if (seen.has(uniqueKey)) continue;
    seen.add(uniqueKey);
    suggestions.push(suggestion);

    if (suggestions.length >= 4) break;
  }

  return suggestions;
}
