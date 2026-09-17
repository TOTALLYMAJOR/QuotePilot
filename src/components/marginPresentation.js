// Deterministic, fail-closed margin presentation
// (docs/POST_COMPETITIVE_DESIGN.md §4.5, §1.3): margin is computed ONLY when
// every selected revenue line has a tenant-recorded cost counterpart —
// `costPpp` on the selected package, `cost` on each selected add-on, rental,
// and menu item (same pricing mode as its price), and
// `serverCostRate`/`chefCostRate`/`bartenderCostRate` in settings when staff
// are quoted. Anything missing makes margin UNAVAILABLE with the missing
// pieces named; nothing is ever estimated. Travel and tax are excluded from
// both sides (pass-through and remittance, not margin); the service charge
// counts as revenue. Costs are tenant catalog data, staff-only, and never
// reach any customer-facing projection.
import { currency } from "../lib/quoteCalculator";

export const MARGIN_MODEL = "margin-presentation-v1";

const MAX_MISSING_NAMED = 6;

// Presentation-only disclosure rule: healthy recorded evidence stays compact,
// while missing evidence or a recorded target miss starts expanded for review.
export function marginRequiresExpandedEvidence(margin) {
  if (!margin) return false;
  if (!margin.available) return true;
  if (margin.target === null || margin.target === undefined) return false;
  return margin.marginPct < margin.target;
}

function num(value) {
  if (value === null || value === undefined || value === "") return null;
  const numeric = Number(value);
  return Number.isFinite(numeric) ? numeric : null;
}

function menuCatalogItems(catalog) {
  if (Array.isArray(catalog?.managedMenuItems) && catalog.managedMenuItems.length) {
    return catalog.managedMenuItems;
  }
  return (catalog?.settings?.menuSections || []).flatMap((section) => section?.items || []);
}

function itemCost(item, { guests, quantity, defaultMode }) {
  const cost = num(item?.cost);
  if (cost === null) return null;
  // Mode defaults mirror the pricing calculator: add-ons and menu items
  // default to per_event, rentals to per_item.
  const mode = String(item?.pricingType || item?.type || defaultMode).toLowerCase();
  if (mode === "per_person") return cost * guests;
  if (mode === "per_item") return cost * quantity;
  return cost;
}

export function buildMarginPresentation({ form, totals, catalog, settings } = {}) {
  if (!form || !totals || !catalog || !settings) return null;
  // Mirrors calculateQuote's capacity cap exactly (src/lib/quoteCalculator.js)
  // so cost and revenue are computed on the same guest basis; otherwise a
  // form carrying more than the capacity limit would cost more guests than
  // the revenue side ever recognized.
  const guests = Math.min(400, Math.max(0, Number(form.guests) || 0));
  if (guests <= 0 || !(Number(totals.total) > 0)) return null;

  const missing = [];
  let cost = 0;

  const pkg = (catalog.packages || []).find((item) => item?.id === form.pkg);
  if (!pkg) {
    missing.push(`Selected package ${String(form.pkg || "unknown")} (catalog item unavailable)`);
  } else {
    const costPpp = num(pkg.costPpp);
    if (costPpp === null) missing.push(`${pkg.name || "Package"} (costPpp)`);
    else cost += costPpp * guests;
  }

  const pools = [
    { ids: form.addons, source: catalog.addons || [], quantities: form.addonQuantities || {}, defaultMode: "per_event" },
    { ids: form.rentals, source: catalog.rentals || [], quantities: form.rentalQuantities || {}, defaultMode: "per_item" },
    { ids: form.menuItems, source: menuCatalogItems(catalog), quantities: form.menuItemQuantities || {}, defaultMode: "per_event" }
  ];
  for (const pool of pools) {
    for (const id of Array.isArray(pool.ids) ? pool.ids : []) {
      const item = pool.source.find((entry) => entry?.id === id);
      if (!item) {
        missing.push(`Selected item ${String(id || "unknown")} (catalog item unavailable)`);
        continue;
      }
      const qty = Number(pool.quantities[id])
        || (item.qtyPerGuests ? Math.ceil(guests / Number(item.qtyPerGuests)) : 1);
      const lineCost = itemCost(item, { guests, quantity: Math.max(1, qty), defaultMode: pool.defaultMode });
      if (lineCost === null) missing.push(`${item.name || id} (cost)`);
      else cost += lineCost;
    }
  }

  // calculateQuote zeroes labor entirely when staffing labor is disabled
  // (totals.labor === 0 in that mode); mirror that so cost never charges for
  // staff the revenue side never bills, and cost rates are never demanded
  // for a mode where no rate could possibly matter.
  const staffingLaborEnabled = settings.staffingLaborEnabled !== false;
  if (staffingLaborEnabled) {
    const hourFactor = String(settings.staffingChargeMode || "") === "per_event_per_staff"
      ? 1
      : Math.max(1, Number(form.hours) || 1);
    const staffRoles = [
      { count: Number(form.servers) || 0, rate: num(settings.serverCostRate), label: "serverCostRate" },
      { count: Number(form.chefs) || 0, rate: num(settings.chefCostRate), label: "chefCostRate" },
      { count: Number(form.bartenders) || 0, rate: num(settings.bartenderCostRate), label: "bartenderCostRate" }
    ];
    for (const role of staffRoles) {
      if (role.count <= 0) continue;
      if (role.rate === null) missing.push(`Settings (${role.label})`);
      else cost += role.rate * role.count * hourFactor;
    }
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
    .reduce((sum, key) => sum + (Number(totals[key]) || 0), 0);
  if (!(revenue > 0)) return null;
  const marginPct = (revenue - cost) / revenue;

  const target = num(settings.targetMarginPct);
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
    note: "Margin on the catering scope from your recorded costs; travel and tax are excluded, and costs never appear to customers."
  };
}

// Decision-grammar advisory (matches decideStackPresentation.js's card
// shape) surfaced only when there is an actual decision-worthy signal: a
// recorded target that this quote's recorded costs fall short of. Silent
// otherwise — meeting or beating a target is confirmed inline by
// targetNote above, not re-announced as a card, and an unavailable or
// untargeted margin has nothing decidable to advise on.
export function buildMarginAdvisorCard(margin) {
  if (!margin?.available) return null;
  if (margin.target === null || margin.target === undefined) return null;
  if (margin.marginPct >= margin.target) return null;

  const pct = (value) => (value * 100).toFixed(1);
  const gapDollars = margin.revenue * (margin.target - margin.marginPct);

  return {
    id: "margin-below-target",
    kind: "margin",
    signal: "attend",
    family: "info",
    label: "Advisory",
    title: "Below your margin target",
    meta: `${pct(margin.marginPct)}% margin · ${Math.round(margin.target * 100)}% target`,
    sentence: `This quote is at ${pct(margin.marginPct)}% margin, ${pct(margin.target - margin.marginPct)} points below your ${Math.round(margin.target * 100)}% target.`,
    basis: "Recorded package, add-on, rental, and staffing costs against this quote's revenue lines; travel and tax excluded.",
    impact: `≈ ${currency(gapDollars)} more margin needed to hit target at this price.`
  };
}
