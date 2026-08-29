// Deterministic presentation model for the Proposal Composer
// (docs/PROPOSAL_COMPOSER_PLAN.md). Every value shown by the composer comes
// from this module so it can be unit-tested without rendering: section
// summaries, completeness, the house staffing recommendation, rental quantity
// suggestions, guest-change consequences, the watching board, and the
// investment/pulse money rows. Nothing here estimates: figures come from
// calculateQuote totals or are declared unavailable, matching the fail-closed
// convention in marginPresentation.js.
import { STAFF_RULES } from "../data/mockCatalog";
import { calculateQuote, currency, serviceChargeLabel } from "../lib/quoteCalculator";
import { isValidEmail } from "../lib/wizardUi";

export const PROPOSAL_COMPOSER_MODEL = "proposal-composer-v1";

function text(value) {
  return String(value ?? "").trim();
}

function count(value) {
  const numeric = Number(value);
  return Number.isFinite(numeric) && numeric > 0 ? Math.round(numeric) : 0;
}

function money(value) {
  const numeric = Number(value);
  return Number.isFinite(numeric) ? Math.round(numeric * 100) / 100 : 0;
}

// ---------------------------------------------------------------------------
// What-if pricing (same client-preview boundary #83's package comparison uses:
// draft preview only; saving still re-prices against the approved catalog).

export function previewPatchImpact({ form, catalog, settings, totals, patch } = {}) {
  if (!form || !catalog || !settings || !totals || !patch) {
    return { delta: null, nextTotals: null };
  }
  try {
    const nextTotals = calculateQuote({ ...form, ...patch }, catalog, settings);
    const delta = money(Number(nextTotals.total || 0) - Number(totals.total || 0));
    return Number.isFinite(delta)
      ? { delta, nextTotals }
      : { delta: null, nextTotals: null };
  } catch {
    return { delta: null, nextTotals: null };
  }
}

export function impactPhrase(delta) {
  if (delta === null || delta === undefined) return "Impact shown after pricing";
  if (Math.abs(delta) < 0.005) return "No change to the total";
  return `${delta > 0 ? "+" : "−"}${currency(Math.abs(delta))}`;
}

// ---------------------------------------------------------------------------
// Staffing recommendation (house STAFF_RULES; mirrors the saved-quote math in
// decideStackPresentation.buildStaffingCard, applied to the live draft).

export function buildStaffingRecommendation(form = {}) {
  const style = text(form.style);
  const rule = STAFF_RULES[style];
  const guests = count(form.guests);
  const current = {
    servers: count(form.servers),
    chefs: count(form.chefs),
    bartenders: count(form.bartenders)
  };
  if (!rule || guests <= 0) {
    return {
      available: false,
      style,
      guests,
      current,
      basis: [],
      requiredServers: 0,
      requiredChefs: 0,
      serverGap: 0,
      chefGap: 0,
      meetsRule: true
    };
  }

  const requiredServers = Number.isFinite(rule.serverRatio)
    ? Math.max(rule.minServers || 0, Math.ceil(guests / rule.serverRatio))
    : (rule.minServers || 0);
  const requiredChefs = Number.isFinite(rule.chefRatio)
    ? Math.ceil(guests / rule.chefRatio)
    : 0;
  const serverGap = Math.max(0, requiredServers - current.servers);
  const chefGap = Math.max(0, requiredChefs - current.chefs);

  const basis = [`${guests} guests`, `${style} service`];
  if (Number.isFinite(rule.serverRatio)) {
    basis.push(`1 server per ${rule.serverRatio} guests, minimum ${rule.minServers || 0}`);
  } else {
    basis.push(`No server ratio for ${style}`);
  }
  if (Number.isFinite(rule.chefRatio)) {
    basis.push(`1 chef per ${rule.chefRatio} guests`);
  }

  return {
    available: true,
    style,
    guests,
    current,
    basis,
    requiredServers,
    requiredChefs,
    serverGap,
    chefGap,
    meetsRule: serverGap <= 0 && chefGap <= 0
  };
}

// Applying the recommendation only raises counts to meet the house rule; a
// deliberate over-staff is the user's call and is never lowered.
export function buildStaffingRecommendationPatch(form = {}) {
  const recommendation = buildStaffingRecommendation(form);
  if (!recommendation.available || recommendation.meetsRule) return null;
  const patch = {};
  if (recommendation.serverGap > 0) patch.servers = recommendation.requiredServers;
  if (recommendation.chefGap > 0) patch.chefs = recommendation.requiredChefs;
  return patch;
}

// ---------------------------------------------------------------------------
// Rental quantity suggestions. Pricing already floats un-overridden rental
// quantities with the guest count via each item's qtyRule, so the only
// honest suggestion is for explicitly set quantities that now lag the house
// rule after a guest change.

function ruleQuantity(item, guests) {
  if (typeof item?.qtyRule === "function") {
    const viaRule = Number(item.qtyRule(guests));
    if (Number.isFinite(viaRule) && viaRule > 0) return Math.round(viaRule);
  }
  const perGuests = Number(item?.qtyPerGuests || 0);
  if (Number.isFinite(perGuests) && perGuests > 0) {
    return Math.max(1, Math.ceil(guests / perGuests));
  }
  return null;
}

export function buildRentalSuggestions({ form = {}, catalog = {} } = {}) {
  const guests = count(form.guests);
  if (guests <= 0) return [];
  const selected = Array.isArray(form.rentals) ? form.rentals : [];
  const quantities = form.rentalQuantities || {};
  const source = Array.isArray(catalog.rentals) ? catalog.rentals : [];

  return selected
    .map((id) => {
      const item = source.find((entry) => entry?.id === id);
      if (!item) return null;
      const explicit = Number(quantities[id]);
      if (!Number.isFinite(explicit) || explicit <= 0) return null;
      const suggested = ruleQuantity(item, guests);
      if (suggested === null || suggested === Math.round(explicit)) return null;
      return {
        id,
        name: item.name || id,
        currentQty: Math.round(explicit),
        suggestedQty: suggested
      };
    })
    .filter(Boolean);
}

export function buildRentalSuggestionPatch(form = {}, suggestions = []) {
  if (!Array.isArray(suggestions) || !suggestions.length) return null;
  const nextQuantities = { ...(form.rentalQuantities || {}) };
  suggestions.forEach((suggestion) => {
    if (!suggestion?.id) return;
    nextQuantities[suggestion.id] = suggestion.suggestedQty;
  });
  return { rentalQuantities: nextQuantities };
}

// ---------------------------------------------------------------------------
// Guest-change consequences: assembled when a guest edit commits so the
// composer can show what else the change affects instead of changing it
// silently. `previousForm`/`previousTotals` are the pre-edit snapshot.

export function buildGuestChangeConsequences({
  previousForm,
  previousTotals,
  form,
  totals,
  catalog
} = {}) {
  const from = count(previousForm?.guests);
  const to = count(form?.guests);
  if (!form || from === to) return null;

  const staffing = buildStaffingRecommendation(form);
  const staffingShortfall = staffing.available && !staffing.meetsRule ? staffing : null;
  const rentalSuggestions = buildRentalSuggestions({ form, catalog });

  return {
    from,
    to,
    totalBefore: money(previousTotals?.total),
    totalAfter: money(totals?.total),
    totalDelta: money(Number(totals?.total || 0) - Number(previousTotals?.total || 0)),
    staffing: staffingShortfall,
    rentalSuggestions,
    hasFollowUps: Boolean(staffingShortfall || rentalSuggestions.length)
  };
}

// ---------------------------------------------------------------------------
// Watching board. States: ok | watch | risk. Risk is reserved for conditions
// that block saving a proposal; watch marks advisory gaps.

export function buildWatchingList({ form = {}, totals = {}, readiness = null, staffing = null } = {}) {
  const items = [];
  const recommendation = staffing || buildStaffingRecommendation(form);

  if (recommendation.available) {
    if (recommendation.meetsRule) {
      items.push({
        id: "staffing",
        label: "Staffing",
        state: "ok",
        detail: "Meets the house ratio"
      });
    } else {
      const parts = [];
      if (recommendation.serverGap > 0) {
        parts.push(`${recommendation.serverGap} server${recommendation.serverGap === 1 ? "" : "s"}`);
      }
      if (recommendation.chefGap > 0) {
        parts.push(`${recommendation.chefGap} chef${recommendation.chefGap === 1 ? "" : "s"}`);
      }
      items.push({
        id: "staffing",
        label: "Staffing",
        state: "watch",
        detail: `${parts.join(" and ")} below the house ratio`
      });
    }
  } else {
    items.push({
      id: "staffing",
      label: "Staffing",
      state: "watch",
      detail: "Set guests and service style to check the house ratio"
    });
  }

  const email = text(form.email);
  items.push({
    id: "client-email",
    label: "Client email",
    state: email && isValidEmail(email) ? "ok" : "risk",
    detail: email
      ? (isValidEmail(email) ? "Present" : "Not a valid address")
      : "Needed before saving"
  });

  const miles = Number(form.milesRT);
  items.push({
    id: "travel",
    label: "Travel",
    state: Number.isFinite(miles) && miles > 0 ? "ok" : "watch",
    detail: Number.isFinite(miles) && miles > 0
      ? `${miles} miles round trip`
      : "Not entered"
  });

  // Saving rejects a draft with no menu selections, so an empty menu is a
  // blocking risk, not an advisory watch.
  const menuSelected = Array.isArray(form.menuItems) ? form.menuItems.length : 0;
  items.push({
    id: "menu",
    label: "Menu",
    state: menuSelected > 0 ? "ok" : "risk",
    detail: menuSelected > 0
      ? `${menuSelected} selection${menuSelected === 1 ? "" : "s"}`
      : "Needed before saving"
  });

  if (readiness && Number.isFinite(Number(readiness.score))) {
    items.push({
      id: "readiness",
      label: "Proposal readiness",
      state: readiness.complete ? "ok" : readiness.score >= 80 ? "watch" : "risk",
      detail: `${readiness.score}/100 · ${readiness.status?.label || "Needs details"}`
    });
  }

  return items;
}

// ---------------------------------------------------------------------------
// Investment + pulse money.

export function buildInvestmentModel({ form = {}, totals = {}, catalog = {}, settings = {} } = {}) {
  const guests = count(totals.guests ?? form.guests);
  const total = money(totals.total);
  const packageName = text(totals.selectedPkg?.name)
    || text((catalog.packages || []).find((item) => item?.id === form.pkg)?.name);

  const rows = [];
  const pushRow = (id, label, amount, { keepZero = false } = {}) => {
    const value = money(amount);
    if (!keepZero && Math.abs(value) < 0.005) return;
    rows.push({ id, label, amount: value });
  };

  pushRow("base", packageName ? `${packageName} package` : "Package", totals.base, { keepZero: true });
  pushRow("menu", "Menu selections", totals.menu);
  pushRow("labor", "Staffing", totals.labor);
  pushRow("rentals", "Rentals", totals.rentals);
  pushRow("addons", "Enhancements", totals.addons);
  pushRow("travel", "Travel", totals.travel);
  pushRow("serviceFee", serviceChargeLabel(totals.serviceFeePctApplied), totals.serviceFee, { keepZero: true });
  pushRow("tax", totals.taxRegionName ? `Tax · ${totals.taxRegionName}` : "Tax", totals.tax, { keepZero: true });

  const depositPct = Number(settings.depositPct);
  return {
    total,
    guests,
    perGuest: guests > 0 ? money(total / guests) : null,
    deposit: money(totals.deposit),
    depositLabel: Number.isFinite(depositPct) && depositPct > 0
      ? `Deposit (${Math.round(depositPct * 100)}%)`
      : "Deposit",
    rows
  };
}

// Flat map fed to detectBreakdownValueChanges so the pulse can flash exactly
// the rows whose values moved.
export function buildPulseValueMap(totals = {}) {
  return {
    total: money(totals.total),
    deposit: money(totals.deposit),
    base: money(totals.base),
    menu: money(totals.menu),
    labor: money(totals.labor),
    rentals: money(totals.rentals),
    addons: money(totals.addons),
    travel: money(totals.travel),
    serviceFee: money(totals.serviceFee),
    tax: money(totals.tax)
  };
}

export function buildCompositionLine({ form = {}, totals = {}, catalog = {} } = {}) {
  const parts = [];
  const guests = count(form.guests);
  if (guests > 0) parts.push(`${guests} guests`);
  const packageName = text(totals.selectedPkg?.name)
    || text((catalog.packages || []).find((item) => item?.id === form.pkg)?.name);
  if (packageName) parts.push(packageName);
  if (text(form.style)) parts.push(text(form.style));
  const servers = count(form.servers);
  const chefs = count(form.chefs);
  const bartenders = count(form.bartenders);
  if (servers > 0) parts.push(`${servers} server${servers === 1 ? "" : "s"}`);
  if (chefs > 0) parts.push(`${chefs} chef${chefs === 1 ? "" : "s"}`);
  if (bartenders > 0) parts.push(`${bartenders} bartender${bartenders === 1 ? "" : "s"}`);
  return parts;
}

// ---------------------------------------------------------------------------
// Experience section: the package + service style read as client-facing copy.
// Blurbs describe the service style only — factual, not menu claims.

const STYLE_EXPERIENCE = {
  Buffet: {
    title: "Generous buffet service",
    blurb: "Guests move through a styled buffet while staff keep every dish replenished."
  },
  Plated: {
    title: "Plated dinner service",
    blurb: "Coursed, seated dining with discreet, synchronized service."
  },
  Stations: {
    title: "Chef-attended stations",
    blurb: "Interactive stations where chefs finish and serve dishes to order."
  },
  "Drop-off": {
    title: "Drop-off catering",
    blurb: "Prepared and delivered ready to serve — no on-site staff required."
  }
};

export function buildExperienceModel({ form = {}, catalog = {} } = {}) {
  const style = text(form.style);
  const styleCopy = STYLE_EXPERIENCE[style] || null;
  const pkg = (catalog.packages || []).find((item) => item?.id === form.pkg) || null;
  const menuCount = Array.isArray(form.menuItems) ? form.menuItems.length : 0;

  const facts = [];
  if (pkg) {
    facts.push(pkg.name);
    const ppp = Number(pkg.ppp);
    if (Number.isFinite(ppp) && ppp > 0) facts.push(`${currency(ppp)} per guest`);
  }
  if (style) facts.push(style);
  if (menuCount > 0) facts.push(`${menuCount} menu selection${menuCount === 1 ? "" : "s"}`);

  return {
    packageId: text(form.pkg),
    packageName: text(pkg?.name),
    style,
    title: styleCopy?.title || (pkg ? pkg.name : "Choose the experience"),
    blurb: styleCopy?.blurb || "Pick a service style to describe how the event should feel.",
    facts
  };
}

export function buildPackageOptions({ form = {}, catalog = {}, settings = {}, totals = {} } = {}) {
  const packages = (Array.isArray(catalog.packages) ? catalog.packages : [])
    .filter((item) => item && item.active !== false && text(item.id) && text(item.name));
  return packages.map((pkg) => {
    const selected = pkg.id === form.pkg;
    const impact = selected
      ? { delta: 0 }
      : previewPatchImpact({ form, catalog, settings, totals, patch: { pkg: pkg.id } });
    return {
      id: pkg.id,
      name: pkg.name,
      ppp: money(pkg.ppp),
      selected,
      delta: impact.delta
    };
  });
}

export function buildStyleOptions({ form = {}, catalog = {}, settings = {}, totals = {} } = {}) {
  return Object.keys(STAFF_RULES).map((style) => {
    const selected = style === form.style;
    const impact = selected
      ? { delta: 0 }
      : previewPatchImpact({ form, catalog, settings, totals, patch: { style } });
    return { id: style, name: style, selected, delta: impact.delta };
  });
}

// ---------------------------------------------------------------------------
// Menu section: selections grouped by catalog menu section.

export function buildMenuModel({ form = {}, menuSections = [], packageIncludedIds = [] } = {}) {
  const selectedIds = Array.isArray(form.menuItems) ? form.menuItems.map((id) => String(id)) : [];
  const selectedSet = new Set(selectedIds);
  const included = new Set((packageIncludedIds || []).map((id) => String(id)));
  const quantities = form.menuItemQuantities || {};

  const groups = (Array.isArray(menuSections) ? menuSections : [])
    .map((section) => {
      const items = (section?.items || [])
        .filter((item) => selectedSet.has(String(item?.id)))
        .map((item) => ({
          id: String(item.id),
          name: item.name || String(item.id),
          price: money(item.price),
          quantity: Number.isFinite(Number(quantities[item.id])) && Number(quantities[item.id]) > 0
            ? Math.round(Number(quantities[item.id]))
            : null,
          includedInPackage: included.has(String(item.id))
        }));
      return items.length
        ? { id: String(section.id ?? section.name ?? "section"), name: section.name || "Menu", items }
        : null;
    })
    .filter(Boolean);

  return {
    groups,
    selectedCount: selectedIds.length,
    empty: selectedIds.length === 0
  };
}

// ---------------------------------------------------------------------------
// Section completeness — quiet teal check when a section is genuinely
// resolvable from the record; optional sections never nag.

export function buildSectionCompleteness({ form = {}, totals = {}, catalog = {} } = {}) {
  const pkg = (catalog.packages || []).find((item) => item?.id === form.pkg);
  const packageMenuIncluded = Array.isArray(pkg?.includedMenuItemIds) && pkg.includedMenuItemIds.length > 0;
  const staffed = count(form.servers) + count(form.chefs) + count(form.bartenders) > 0;
  return {
    event: Boolean(
      text(form.eventTypeId)
      && text(form.date)
      && count(form.guests) > 0
      && text(form.venue)
      && text(form.eventName)
    ),
    client: Boolean(text(form.name) && isValidEmail(form.email)),
    experience: Boolean(text(form.pkg) && text(form.style)),
    menu: (Array.isArray(form.menuItems) ? form.menuItems.length : 0) > 0 || packageMenuIncluded,
    staffing: text(form.style) === "Drop-off" ? true : staffed,
    investment: money(totals.total) > 0
  };
}

export function buildExperienceSectionStatus({
  complete = false,
  saved = false,
  packageReviewed = false,
  styleReviewed = false
} = {}) {
  if (!complete) return null;
  if (saved || (packageReviewed && styleReviewed)) {
    return {
      id: "complete",
      label: "✓ Complete",
      ariaLabel: "Experience section complete"
    };
  }
  return {
    id: "preset",
    label: "Preset",
    ariaLabel: "Experience uses a preset; review the package and service style"
  };
}

// ---------------------------------------------------------------------------
// Header.

export function formatEventDateLong(value) {
  const raw = text(value);
  const match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(raw);
  if (!match) return "";
  const [, year, month, day] = match;
  const date = new Date(Number(year), Number(month) - 1, Number(day));
  if (Number.isNaN(date.getTime())) return "";
  return date.toLocaleDateString("en-US", { month: "long", day: "numeric", year: "numeric" });
}

export function buildHeaderModel({ form = {}, editingQuote = {}, quoteDirty = false, saving = false } = {}) {
  const editingNumber = text(editingQuote?.quoteNumber);
  const metaParts = [];
  const longDate = formatEventDateLong(form.date);
  if (longDate) metaParts.push(longDate);
  if (text(form.venue)) metaParts.push(text(form.venue));
  const guests = count(form.guests);
  if (guests > 0) metaParts.push(`${guests} guests`);

  const saveState = saving
    ? { id: "saving", label: "Saving…" }
    : quoteDirty
      ? { id: "dirty", label: "Unsaved changes" }
      : editingNumber
        ? { id: "saved", label: "Saved ✓" }
        : { id: "new", label: "New draft" };

  return {
    eyebrow: editingNumber ? `Editing quote ${editingNumber}` : "Current draft",
    title: text(form.eventName) || "Untitled event",
    metaParts,
    saveState
  };
}
