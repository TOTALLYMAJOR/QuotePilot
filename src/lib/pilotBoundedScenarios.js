import { buildMarginPresentation } from "../components/marginPresentation";
import { calculateQuote } from "./quoteCalculator";
import { authorizePilotV1Command } from "./pilotCommandPolicy";

/**
 * Deterministic, source-only scenario generation for Pilot.
 *
 * The generator deliberately has no persistence, provider, Firebase, portal,
 * communication, or authoritative-pricing dependency. It evaluates a bounded
 * set of active tenant-catalog and tenant-rule alternatives with the existing
 * client calculator, then returns frozen proposals that still require an
 * explicit draft-review adoption. A trusted save remains responsible for
 * current-revision checks, authoritative repricing, and versioned writes.
 */
export const PILOT_BOUNDED_SCENARIO_MODEL = "pilot-bounded-scenarios-v1";

export const PILOT_BOUNDED_SCENARIO_INTENTS = Object.freeze([
  "under_budget",
  "improve_margin"
]);

export const PILOT_BOUNDED_SCENARIO_LOCKS = Object.freeze([
  "package",
  "event_template",
  "addons",
  "rentals",
  "menu",
  "staffing"
]);

export const PILOT_BOUNDED_SCENARIO_LIMITS = Object.freeze({
  catalogRecords: 500,
  menuSections: 100,
  staffingRules: 50,
  atomicAlternatives: 36,
  candidates: 72,
  results: 5,
  runtimeMs: 50
});

const DEFAULT_LIMITS = Object.freeze({
  atomicAlternatives: 28,
  candidates: 48,
  results: 3,
  runtimeMs: 40
});

const CURRENT_CATALOG_SOURCES = new Set(["firebase-org", "local-cache"]);
const POOL_DEFINITIONS = Object.freeze([
  Object.freeze({
    dimension: "addons",
    singular: "add-on",
    selectionField: "addons",
    quantityField: "addonQuantities",
    catalogField: "addons",
    defaultPricingType: "per_event"
  }),
  Object.freeze({
    dimension: "rentals",
    singular: "rental",
    selectionField: "rentals",
    quantityField: "rentalQuantities",
    catalogField: "rentals",
    defaultPricingType: "per_item"
  }),
  Object.freeze({
    dimension: "menu",
    singular: "menu item",
    selectionField: "menuItems",
    quantityField: "menuItemQuantities",
    catalogField: "menuItems",
    defaultPricingType: "per_event"
  })
]);

const BOUNDARY =
  "Read-only deterministic client simulation. It does not mutate or save a draft, reprice authoritatively, version a quote, send a communication, publish a proposal, book an event, collect payment, or change provider state.";
const ADOPTION_BOUNDARY =
  "Explicit adoption may stage only the listed patch in the existing draft review. The trusted save must still reprice against the current tenant catalog, confirm the exact base revision, and create the authoritative version.";

function isRecord(value) {
  if (!value || typeof value !== "object" || Array.isArray(value)) return false;
  const prototype = Object.getPrototypeOf(value);
  return prototype === Object.prototype || prototype === null;
}

function safeText(value, maximum = 180) {
  const candidate = String(value ?? "").trim();
  if (!candidate || candidate.length > maximum || /[\u0000-\u001f\u007f]/u.test(candidate)) return "";
  return candidate;
}

function safeId(value) {
  const candidate = safeText(value, 160);
  return candidate && !/[/?#\\]/u.test(candidate) ? candidate : "";
}

function finiteNumber(value) {
  const number = Number(value);
  return Number.isFinite(number) ? number : null;
}

function nonNegativeMoney(value) {
  const number = finiteNumber(value);
  return number !== null && number >= 0 ? Math.round(number * 100) / 100 : null;
}

function exactIso(value) {
  const candidate = safeText(value, 64);
  if (!candidate) return "";
  const parsed = new Date(candidate);
  return !Number.isNaN(parsed.getTime()) && parsed.toISOString() === candidate
    ? candidate
    : "";
}

function frozen(value, seen = new WeakSet()) {
  if (!value || typeof value !== "object" || Object.isFrozen(value) || seen.has(value)) return value;
  seen.add(value);
  Reflect.ownKeys(value).forEach((key) => frozen(value[key], seen));
  return Object.freeze(value);
}

function stableUniqueStrings(value) {
  const seen = new Set();
  return (Array.isArray(value) ? value : []).reduce((output, entry) => {
    const normalized = safeText(entry, 500);
    if (!normalized || seen.has(normalized)) return output;
    seen.add(normalized);
    output.push(normalized);
    return output;
  }, []);
}

function clampInteger(value, fallback, maximum) {
  const number = Number(value);
  if (!Number.isSafeInteger(number) || number < 1) return fallback;
  return Math.min(number, maximum);
}

function normalizedLimits(value = {}) {
  return {
    atomicAlternatives: clampInteger(
      value.atomicAlternatives,
      DEFAULT_LIMITS.atomicAlternatives,
      PILOT_BOUNDED_SCENARIO_LIMITS.atomicAlternatives
    ),
    candidates: clampInteger(
      value.candidates,
      DEFAULT_LIMITS.candidates,
      PILOT_BOUNDED_SCENARIO_LIMITS.candidates
    ),
    results: clampInteger(
      value.results,
      DEFAULT_LIMITS.results,
      PILOT_BOUNDED_SCENARIO_LIMITS.results
    ),
    runtimeMs: clampInteger(
      value.runtimeMs,
      DEFAULT_LIMITS.runtimeMs,
      PILOT_BOUNDED_SCENARIO_LIMITS.runtimeMs
    )
  };
}

function defaultClock() {
  return typeof globalThis.performance?.now === "function"
    ? globalThis.performance.now()
    : Date.now();
}

function normalizeIntent(value) {
  if (typeof value === "string") return parsePilotBoundedScenarioIntent(value);
  if (!isRecord(value)) return null;
  const kind = safeText(value.kind, 40).toLowerCase();
  if (!PILOT_BOUNDED_SCENARIO_INTENTS.includes(kind)) return null;
  if (kind === "under_budget") {
    const budget = nonNegativeMoney(value.budget);
    const currency = safeText(value.currency || "USD", 3).toUpperCase();
    if (budget === null || budget <= 0 || budget > 100_000_000 || currency !== "USD") return null;
    return { kind, budget, currency: "USD", targetMarginPct: null };
  }
  let targetMarginPct = null;
  if (value.targetMarginPct !== undefined && value.targetMarginPct !== null && value.targetMarginPct !== "") {
    targetMarginPct = finiteNumber(value.targetMarginPct);
    if (targetMarginPct === null || targetMarginPct < 0 || targetMarginPct > 1) return null;
  } else if (
    value.targetMarginPercent !== undefined
    && value.targetMarginPercent !== null
    && value.targetMarginPercent !== ""
  ) {
    const percent = finiteNumber(value.targetMarginPercent);
    if (percent === null || percent < 0 || percent > 100) return null;
    targetMarginPct = percent / 100;
  }
  return { kind, budget: null, currency: "USD", targetMarginPct };
}

/**
 * Recognizes only explicit USD budget and margin-improvement commands. It does
 * not infer a budget, currency, target, or broader commercial intent.
 */
export function parsePilotBoundedScenarioIntent(value) {
  const command = safeText(value, 500);
  if (!command) return null;
  const normalized = command.toLowerCase().replace(/\s+/gu, " ");
  if (/\b(?:improve|increase|raise|strengthen)\s+(?:the\s+)?(?:gross\s+)?margin\b/u.test(normalized)) {
    const targetMatch = normalized.match(/\b(?:to|target(?:ing)?|at)\s+(\d{1,3}(?:\.\d{1,2})?)\s*%/u);
    const percent = targetMatch ? finiteNumber(targetMatch[1]) : null;
    if (percent !== null && (percent < 0 || percent > 100)) return null;
    return frozen({
      kind: "improve_margin",
      budget: null,
      currency: "USD",
      targetMarginPct: percent === null ? null : percent / 100
    });
  }
  const hasBudgetIntent = /\b(?:under|below|within)\b/u.test(normalized)
    && /(?:\$|\busd\b|\bbudget\b)/u.test(normalized);
  if (!hasBudgetIntent) return null;
  const budgetMatch = normalized.match(
    /\b(?:under|below|within)\s+(?:a\s+)?(?:budget\s+(?:of\s+)?)?(?:usd\s*)?\$?\s*(\d{1,3}(?:,\d{3})*(?:\.\d{1,2})?|\d+(?:\.\d{1,2})?)/u
  );
  if (!budgetMatch) return null;
  const budget = nonNegativeMoney(budgetMatch[1].replace(/,/gu, ""));
  if (budget === null || budget <= 0 || budget > 100_000_000) return null;
  return frozen({ kind: "under_budget", budget, currency: "USD", targetMarginPct: null });
}

function normalizeLocks(value) {
  if (!Array.isArray(value)) {
    return { locks: [], reason: "Locked scope must be an explicit array of supported dimensions." };
  }
  const locks = stableUniqueStrings(value.map((entry) => safeText(entry, 40).toLowerCase()));
  const unknown = locks.filter((entry) => !PILOT_BOUNDED_SCENARIO_LOCKS.includes(entry));
  if (unknown.length) {
    return { locks: [], reason: `Locked scope contains unsupported dimensions: ${unknown.join(", ")}.` };
  }
  return { locks: locks.sort(), reason: "" };
}

function normalizeCatalogRecord(value, { requireName = true } = {}) {
  if (!isRecord(value)) return null;
  const id = safeId(value.id);
  const name = safeText(value.name, 160);
  if (!id || (requireName && !name)) return null;
  const active = value.active !== false;
  return {
    ...value,
    id,
    name: name || id,
    active
  };
}

function normalizeCatalogRecords(value, maximum) {
  if (!Array.isArray(value) || value.length > maximum) return null;
  const records = value.map((entry) => normalizeCatalogRecord(entry));
  if (records.some((entry) => !entry)) return null;
  const ids = records.map((entry) => entry.id);
  if (new Set(ids).size !== ids.length) return null;
  return records;
}

function normalizeCatalogContext(organizationId, evidence, settings) {
  if (!safeId(organizationId)) {
    return { context: null, reason: "The active tenant scope is unavailable." };
  }
  if (!isRecord(evidence) || evidence.organizationId !== organizationId) {
    return { context: null, reason: "The catalog evidence does not match the active tenant scope." };
  }
  const sourceLabel = safeText(evidence.sourceLabel, 80).toLowerCase();
  const catalogRevision = Number(evidence.catalogRevision);
  const freshness = isRecord(evidence.freshness) ? evidence.freshness : {};
  const observedAtISO = exactIso(freshness.observedAtISO || freshness.observedAt);
  if (
    !CURRENT_CATALOG_SOURCES.has(sourceLabel)
    || !Number.isSafeInteger(catalogRevision)
    || catalogRevision < 0
    || safeText(freshness.state, 24).toLowerCase() !== "fresh"
    || !observedAtISO
  ) {
    return { context: null, reason: "A fresh, exact-revision tenant catalog snapshot is required." };
  }
  const packages = normalizeCatalogRecords(
    evidence.packages,
    PILOT_BOUNDED_SCENARIO_LIMITS.catalogRecords
  );
  const addons = normalizeCatalogRecords(
    evidence.addons,
    PILOT_BOUNDED_SCENARIO_LIMITS.catalogRecords
  );
  const rentals = normalizeCatalogRecords(
    evidence.rentals,
    PILOT_BOUNDED_SCENARIO_LIMITS.catalogRecords
  );
  const menuSections = Array.isArray(evidence.menuSections)
    && evidence.menuSections.length <= PILOT_BOUNDED_SCENARIO_LIMITS.menuSections
    ? evidence.menuSections
    : null;
  const upsellRules = Array.isArray(evidence.upsellRules)
    && evidence.upsellRules.length <= PILOT_BOUNDED_SCENARIO_LIMITS.catalogRecords
    ? evidence.upsellRules
    : null;
  if (!packages || !addons || !rentals || !menuSections || !upsellRules || !packages.length) {
    return { context: null, reason: "The tenant catalog collections are incomplete, invalid, or outside their bounds." };
  }
  const normalizedSections = [];
  const allMenuIds = [];
  for (const section of menuSections) {
    if (!isRecord(section) || !Array.isArray(section.items)) {
      return { context: null, reason: "The tenant menu catalog is incomplete or invalid." };
    }
    const items = normalizeCatalogRecords(
      section.items,
      PILOT_BOUNDED_SCENARIO_LIMITS.catalogRecords
    );
    if (!items) return { context: null, reason: "The tenant menu catalog is incomplete or invalid." };
    items.forEach((item) => allMenuIds.push(item.id));
    normalizedSections.push({ ...section, items });
  }
  if (new Set(allMenuIds).size !== allMenuIds.length) {
    return { context: null, reason: "The tenant menu catalog contains duplicate item identifiers." };
  }
  const normalizedRules = [];
  for (const rule of upsellRules) {
    if (!isRecord(rule)) continue;
    const kind = safeText(rule.kind, 24).toLowerCase();
    const targetId = safeId(rule.targetId);
    if (!rule.enabled || !["addon", "rental"].includes(kind) || !targetId) continue;
    normalizedRules.push({
      kind,
      targetId,
      minGuests: Math.max(0, finiteNumber(rule.minGuests) || 0),
      minHours: Math.max(0, finiteNumber(rule.minHours) || 0)
    });
  }
  const menuItems = normalizedSections.flatMap((section) => section.items);
  const pricingSettings = { ...settings, menuSections: normalizedSections };
  const pricingCatalog = {
    packages,
    addons,
    rentals,
    settings: pricingSettings
  };
  return {
    context: {
      sourceLabel,
      catalogRevision,
      observedAtISO,
      packages,
      addons,
      rentals,
      menuItems,
      menuSections: normalizedSections,
      upsellRules: normalizedRules,
      pricingCatalog,
      pricingSettings
    },
    reason: ""
  };
}

function normalizeStaffingEvidence(organizationId, value) {
  if (!isRecord(value)) {
    return { rules: [], reason: "Current tenant staffing-rule evidence was not supplied." };
  }
  if (value.organizationId !== organizationId || safeText(value.state, 24).toLowerCase() !== "current") {
    return { rules: [], reason: "Staffing-rule evidence does not match the active tenant or is not current." };
  }
  if (!Array.isArray(value.rules) || value.rules.length > PILOT_BOUNDED_SCENARIO_LIMITS.staffingRules) {
    return { rules: [], reason: "Staffing-rule evidence is invalid or outside its bound." };
  }
  const rules = [];
  for (const raw of value.rules) {
    if (!isRecord(raw) || raw.active !== true) continue;
    const style = safeText(raw.style, 80).toLowerCase();
    if (!style) continue;
    const recommended = isRecord(raw.recommended) ? raw.recommended : null;
    const normalized = {
      style,
      recommended: recommended
        ? {
            servers: boundedStaffCount(recommended.servers),
            chefs: boundedStaffCount(recommended.chefs),
            bartenders: boundedStaffCount(recommended.bartenders)
          }
        : null,
      serverRatio: positiveRatio(raw.serverRatio),
      minServers: boundedStaffCount(raw.minServers),
      chefRatio: positiveRatio(raw.chefRatio),
      minChefs: boundedStaffCount(raw.minChefs),
      bartenderRatio: positiveRatio(raw.bartenderRatio),
      minBartenders: boundedStaffCount(raw.minBartenders)
    };
    const hasRecommendation = normalized.recommended
      && Object.values(normalized.recommended).every((entry) => entry !== null);
    const hasRatio = normalized.serverRatio !== null
      || normalized.chefRatio !== null
      || normalized.bartenderRatio !== null;
    if (hasRecommendation || hasRatio) rules.push(normalized);
  }
  return {
    rules,
    reason: rules.length ? "" : "No active tenant staffing rule can produce a bounded recommendation."
  };
}

function boundedStaffCount(value) {
  const number = Number(value);
  return Number.isSafeInteger(number) && number >= 0 && number <= 100 ? number : null;
}

function positiveRatio(value) {
  const number = Number(value);
  return Number.isFinite(number) && number > 0 && number <= 10_000 ? number : null;
}

function currentStaffCount(value) {
  const number = Number(value);
  return Number.isFinite(number) && number >= 0 ? Math.min(100, Math.round(number)) : 0;
}

function recommendedStaffing(rule, form) {
  if (rule.recommended) return rule.recommended;
  const guests = Math.max(0, Math.min(400, Math.round(Number(form.guests) || 0)));
  if (!guests) return null;
  const countFor = (ratio, minimum) => {
    if (ratio === null) return minimum ?? 0;
    return Math.max(minimum ?? 0, Math.ceil(guests / ratio));
  };
  const result = {
    servers: countFor(rule.serverRatio, rule.minServers),
    chefs: countFor(rule.chefRatio, rule.minChefs),
    bartenders: countFor(rule.bartenderRatio, rule.minBartenders)
  };
  return Object.values(result).every((entry) => boundedStaffCount(entry) !== null)
    ? result
    : null;
}

function cloneArray(value) {
  return Array.isArray(value) ? [...value] : [];
}

function cloneMap(value) {
  return isRecord(value) ? { ...value } : {};
}

function selectedIds(form, field) {
  const seen = new Set();
  return cloneArray(form?.[field]).reduce((output, entry) => {
    const id = safeId(entry);
    if (!id || seen.has(id)) return output;
    seen.add(id);
    output.push(id);
    return output;
  }, []);
}

function normalizedPricingType(item, fallback) {
  const candidate = safeText(item?.pricingType || item?.type, 24).toLowerCase();
  return ["per_person", "per_item", "per_event"].includes(candidate) ? candidate : fallback;
}

function lineQuantity(form, definition, item) {
  const map = cloneMap(form?.[definition.quantityField]);
  const exact = Number(map[item.id]);
  if (Number.isSafeInteger(exact) && exact >= 1) return exact;
  const divisor = finiteNumber(item.qtyPerGuests);
  if (definition.dimension === "rentals" && divisor !== null && divisor > 0) {
    return Math.max(1, Math.ceil((Number(form.guests) || 0) / divisor));
  }
  return 1;
}

function approximateRevenue(item, definition, form, quantity = lineQuantity(form, definition, item)) {
  const price = Math.max(0, finiteNumber(item.price) || 0);
  const type = normalizedPricingType(item, definition.defaultPricingType);
  if (type === "per_person") return price * Math.max(0, Math.min(400, Number(form.guests) || 0));
  if (type === "per_item") return price * Math.max(1, quantity);
  return price;
}

function approximateCostRatio(item, definition, form) {
  const cost = finiteNumber(item.cost);
  const revenue = approximateRevenue(item, definition, form);
  if (cost === null || revenue <= 0) return Number.POSITIVE_INFINITY;
  const type = normalizedPricingType(item, definition.defaultPricingType);
  const quantity = lineQuantity(form, definition, item);
  const guests = Math.max(0, Math.min(400, Number(form.guests) || 0));
  const totalCost = type === "per_person"
    ? cost * guests
    : type === "per_item"
      ? cost * quantity
      : cost;
  return totalCost / revenue;
}

function formatMoney(value) {
  return new Intl.NumberFormat("en-US", {
    style: "currency",
    currency: "USD",
    minimumFractionDigits: 2,
    maximumFractionDigits: 2
  }).format(Number(value) || 0);
}

function formatStaffing(value) {
  return `${value.servers} servers, ${value.chefs} chefs, ${value.bartenders} bartenders`;
}

function hasCatalogPrice(item, field = "price") {
  const value = finiteNumber(item?.[field]);
  return value !== null && value >= 0;
}

function activeById(items) {
  return new Map(items
    .filter((item) => item.active && hasCatalogPrice(item))
    .map((item) => [item.id, item]));
}

function itemAlternativeSort(intent, definition, form) {
  return (left, right) => {
    if (intent.kind === "improve_margin") {
      const marginDelta = approximateCostRatio(left, definition, form)
        - approximateCostRatio(right, definition, form);
      if (Number.isFinite(marginDelta) && Math.abs(marginDelta) > 1e-9) return marginDelta;
    }
    const priceDelta = approximateRevenue(left, definition, form)
      - approximateRevenue(right, definition, form);
    if (Math.abs(priceDelta) > 1e-9) return priceDelta;
    return left.id.localeCompare(right.id);
  };
}

function packageAlternatives({ form, context, locks }) {
  if (locks.has("package") || locks.has("event_template")) return [];
  const current = context.packages.find((item) => item.id === form.pkg);
  if (!current) return [];
  return context.packages
    .filter((item) => item.active && hasCatalogPrice(item, "ppp") && item.id !== current.id)
    .sort((left, right) => (Number(left.ppp) || 0) - (Number(right.ppp) || 0) || left.id.localeCompare(right.id))
    .map((item) => {
      const patch = { pkg: item.id };
      const compromises = [{
        dimension: "package",
        label: "Package",
        before: current.name,
        after: item.name,
        why: "This is a named active package in the current tenant catalog."
      }];
      if (safeText(form.eventTemplateId, 160) && form.eventTemplateId !== "custom") {
        patch.eventTemplateId = "custom";
        compromises.push({
          dimension: "event_template",
          label: "Template ownership",
          before: "Recorded event template",
          after: "Custom draft",
          why: "A package replacement must not silently retain a mismatched template identity."
        });
      }
      return {
        key: `package:${item.id}`,
        dimensions: new Set(compromises.map((entry) => entry.dimension)),
        patch,
        compromises,
        basis: "active_tenant_catalog"
      };
    });
}

function itemAlternatives({ intent, form, context, locks }) {
  const alternatives = [];
  for (const definition of POOL_DEFINITIONS) {
    if (locks.has(definition.dimension)) continue;
    const items = context[definition.catalogField];
    const byId = activeById(items);
    const selected = selectedIds(form, definition.selectionField);
    const selectedSet = new Set(selected);
    for (const selectedId of selected) {
      const current = byId.get(selectedId);
      if (!current) continue;
      const without = selected.filter((id) => id !== selectedId);
      const quantities = cloneMap(form[definition.quantityField]);
      delete quantities[selectedId];
      alternatives.push({
        key: `${definition.dimension}:remove:${selectedId}`,
        dimensions: new Set([definition.dimension]),
        patch: {
          [definition.selectionField]: without,
          [definition.quantityField]: quantities
        },
        compromises: [{
          dimension: definition.dimension,
          label: current.name,
          before: `Selected ${definition.singular}`,
          after: "Removed from scenario",
          why: "The item is an active named record in the current tenant catalog."
        }],
        basis: "active_tenant_catalog"
      });

      const currentQuantity = lineQuantity(form, definition, current);
      const replacements = items
        .filter((item) => item.active && hasCatalogPrice(item) && !selectedSet.has(item.id))
        .sort(itemAlternativeSort(intent, definition, form))
        .slice(0, 3);
      for (const replacement of replacements) {
        const nextSelection = selected.map((id) => id === selectedId ? replacement.id : id);
        const nextQuantities = cloneMap(form[definition.quantityField]);
        delete nextQuantities[selectedId];
        if (normalizedPricingType(replacement, definition.defaultPricingType) === "per_item") {
          nextQuantities[replacement.id] = currentQuantity;
        }
        alternatives.push({
          key: `${definition.dimension}:swap:${selectedId}:${replacement.id}`,
          dimensions: new Set([definition.dimension]),
          patch: {
            [definition.selectionField]: nextSelection,
            [definition.quantityField]: nextQuantities
          },
          compromises: [{
            dimension: definition.dimension,
            label: `${current.name} → ${replacement.name}`,
            before: current.name,
            after: replacement.name,
            why: "Both records are active alternatives in the current tenant catalog."
          }],
          basis: "active_tenant_catalog"
        });
      }
    }

    if (intent.kind !== "improve_margin" || definition.dimension === "menu") continue;
    const matchingRules = context.upsellRules.filter((rule) => {
      const kindMatches = (definition.dimension === "addons" && rule.kind === "addon")
        || (definition.dimension === "rentals" && rule.kind === "rental");
      return kindMatches
        && Number(form.guests || 0) >= rule.minGuests
        && Number(form.hours || 0) >= rule.minHours
        && !selectedSet.has(rule.targetId)
        && byId.has(rule.targetId);
    });
    for (const rule of matchingRules) {
      const item = byId.get(rule.targetId);
      const quantities = cloneMap(form[definition.quantityField]);
      if (normalizedPricingType(item, definition.defaultPricingType) === "per_item") {
        quantities[item.id] = lineQuantity(form, definition, item);
      }
      alternatives.push({
        key: `${definition.dimension}:rule-add:${item.id}`,
        dimensions: new Set([definition.dimension]),
        patch: {
          [definition.selectionField]: [...selected, item.id],
          [definition.quantityField]: quantities
        },
        compromises: [{
          dimension: definition.dimension,
          label: item.name,
          before: "Not selected",
          after: `Added ${definition.singular}`,
          why: "An enabled tenant guided-selling rule matched this active catalog item."
        }],
        basis: "active_tenant_rule"
      });
    }
  }
  return alternatives;
}

function staffingAlternatives({ form, staffingRules, locks }) {
  if (locks.has("staffing")) return [];
  const style = safeText(form.style, 80).toLowerCase();
  if (!style) return [];
  const current = {
    servers: currentStaffCount(form.servers),
    chefs: currentStaffCount(form.chefs),
    bartenders: currentStaffCount(form.bartenders)
  };
  return staffingRules
    .filter((rule) => rule.style === style)
    .map((rule, index) => ({ rule, recommended: recommendedStaffing(rule, form), index }))
    .filter(({ recommended }) => recommended && Object.keys(current).some((key) => current[key] !== recommended[key]))
    .map(({ recommended, index }) => ({
      key: `staffing:rule:${index + 1}`,
      dimensions: new Set(["staffing"]),
      patch: {
        servers: recommended.servers,
        chefs: recommended.chefs,
        bartenders: recommended.bartenders
      },
      compromises: [{
        dimension: "staffing",
        label: "Quoted staffing",
        before: formatStaffing(current),
        after: formatStaffing(recommended),
        why: "An active current-tenant staffing rule for the recorded service style produced these exact counts."
      }],
      basis: "active_tenant_staffing_rule"
    }));
}

function mergeAlternatives(left, right) {
  if ([...left.dimensions].some((dimension) => right.dimensions.has(dimension))) return null;
  return {
    key: `${left.key}+${right.key}`,
    dimensions: new Set([...left.dimensions, ...right.dimensions]),
    patch: { ...left.patch, ...right.patch },
    compromises: [...left.compromises, ...right.compromises],
    basis: left.basis === right.basis ? left.basis : "bounded_combination"
  };
}

function patchSignature(patch) {
  return JSON.stringify(Object.keys(patch).sort().reduce((output, key) => {
    output[key] = patch[key];
    return output;
  }, {}));
}

function boundedAlternatives({ intent, form, context, staffingRules, locks, limits }) {
  const atomic = [
    ...packageAlternatives({ form, context, locks }),
    ...itemAlternatives({ intent, form, context, locks }),
    ...staffingAlternatives({ form, staffingRules, locks })
  ];
  const unique = [];
  const signatures = new Set();
  const atomicLimit = Math.min(limits.atomicAlternatives, limits.candidates);
  for (const alternative of atomic) {
    const signature = patchSignature(alternative.patch);
    if (signatures.has(signature)) continue;
    signatures.add(signature);
    unique.push(alternative);
    if (unique.length >= atomicLimit) break;
  }
  const candidates = unique.slice(0, limits.candidates);
  for (let left = 0; left < unique.length && candidates.length < limits.candidates; left += 1) {
    for (let right = left + 1; right < unique.length && candidates.length < limits.candidates; right += 1) {
      const combined = mergeAlternatives(unique[left], unique[right]);
      if (!combined) continue;
      const signature = patchSignature(combined.patch);
      if (signatures.has(signature)) continue;
      signatures.add(signature);
      candidates.push(combined);
    }
  }
  return {
    atomicCount: unique.length,
    candidates,
    truncated: atomic.length > unique.length || candidates.length >= limits.candidates
  };
}

function applyPatch(form, patch) {
  const next = { ...form };
  Object.entries(patch).forEach(([key, value]) => {
    next[key] = Array.isArray(value)
      ? [...value]
      : isRecord(value)
        ? { ...value }
        : value;
  });
  return next;
}

function safeTotals(value) {
  if (!isRecord(value)) return null;
  const fields = ["total", "deposit", "base", "addons", "rentals", "menu", "labor", "serviceFee", "tax"];
  if (fields.some((field) => finiteNumber(value[field]) === null || Number(value[field]) < 0)) return null;
  return value;
}

function calculateClientPreview(form, context) {
  try {
    return safeTotals(calculateQuote(form, context.pricingCatalog, context.pricingSettings));
  } catch {
    return null;
  }
}

function commercialPreview(totals) {
  return {
    currency: "USD",
    total: Math.round(Number(totals.total) * 100) / 100,
    deposit: Math.round(Number(totals.deposit) * 100) / 100,
    authority: "client_calculated_preview"
  };
}

function strictRecordedCost(value) {
  if (value === null || value === undefined || String(value).trim() === "") return null;
  const number = Number(value);
  return Number.isFinite(number) && number >= 0 ? number : null;
}

function strictMarginCoverageMissing(form, context) {
  const missing = [];
  const selectedPackage = context.packages.find((item) => item.id === form.pkg);
  if (!selectedPackage || strictRecordedCost(selectedPackage.costPpp) === null) {
    missing.push(`${selectedPackage?.name || "Selected package"} (costPpp)`);
  }
  const selectedInclusions = [
    ["includedAddonIds", "addons"],
    ["includedRentalIds", "rentals"],
    ["includedMenuItemIds", "menuItems"]
  ].some(([inclusionField, selectionField]) => {
    const included = new Set(selectedIds(selectedPackage || {}, inclusionField));
    return selectedIds(form, selectionField).some((id) => included.has(id));
  });
  if (selectedInclusions) {
    missing.push("Package inclusion cost allocation (not represented separately)");
  }
  for (const definition of POOL_DEFINITIONS) {
    const byId = new Map(context[definition.catalogField].map((item) => [item.id, item]));
    for (const selectedId of selectedIds(form, definition.selectionField)) {
      const item = byId.get(selectedId);
      if (!item || item.active !== true || strictRecordedCost(item.cost) === null) {
        missing.push(`${item?.name || "Selected item"} (cost)`);
      }
    }
  }
  if (context.pricingSettings.staffingLaborEnabled !== false) {
    const roles = [
      ["servers", "serverCostRate"],
      ["chefs", "chefCostRate"],
      ["bartenders", "bartenderCostRate"]
    ];
    roles.forEach(([countField, rateField]) => {
      if (currentStaffCount(form[countField]) > 0 && strictRecordedCost(context.pricingSettings[rateField]) === null) {
        missing.push(`Settings (${rateField})`);
      }
    });
  }
  return stableUniqueStrings(missing);
}

function selectedCatalogPricingReasons(form, context) {
  const reasons = [];
  const selectedPackage = context.packages.find((item) => item.id === form.pkg);
  if (!selectedPackage || !selectedPackage.active || !hasCatalogPrice(selectedPackage, "ppp")) {
    reasons.push("The selected package lacks a valid active tenant-catalog price.");
  }
  for (const definition of POOL_DEFINITIONS) {
    const active = activeById(context[definition.catalogField]);
    for (const selectedId of selectedIds(form, definition.selectionField)) {
      if (!active.has(selectedId)) {
        reasons.push(`A selected ${definition.singular} lacks a valid active tenant-catalog price.`);
      }
    }
  }
  return stableUniqueStrings(reasons);
}

function marginEvidence({ form, totals, context, marginEnabled, marginAuthorized }) {
  if (marginEnabled !== true || marginAuthorized !== true) {
    return {
      state: "unavailable",
      available: false,
      reason: marginEnabled !== true
        ? "Margin evidence is unavailable because its presentation gate is disabled."
        : "Margin evidence is unavailable without the caller's staff-commercial authorization.",
      missing: []
    };
  }
  const strictMissing = strictMarginCoverageMissing(form, context);
  if (strictMissing.length) {
    return {
      state: "unavailable",
      available: false,
      reason: `Margins unavailable because ${strictMissing.length} selected revenue or staffing cost ${strictMissing.length === 1 ? "field is" : "fields are"} missing or invalid. No zero-cost assumption was substituted.`,
      missing: strictMissing.slice(0, 6)
    };
  }
  const presentation = buildMarginPresentation({
    form,
    totals,
    catalog: context.pricingCatalog,
    settings: context.pricingSettings
  });
  if (!presentation?.available) {
    return {
      state: "unavailable",
      available: false,
      reason: presentation?.note || "Complete tenant-recorded cost coverage is unavailable.",
      missing: stableUniqueStrings(presentation?.missing || [])
    };
  }
  return {
    state: "available",
    available: true,
    revenue: Math.round(Number(presentation.revenue) * 100) / 100,
    cost: Math.round(Number(presentation.cost) * 100) / 100,
    marginPct: presentation.marginPct,
    targetMarginPct: presentation.target,
    reason: "Complete tenant-recorded cost coverage; travel and tax are excluded from both revenue and cost.",
    missing: []
  };
}

function marginDelta(before, after) {
  if (!before.available || !after.available) return null;
  return Math.round((after.marginPct - before.marginPct) * 10_000) / 100;
}

function safeLockedPatch(alternative, locks) {
  return ![...alternative.dimensions].some((dimension) => locks.has(dimension));
}

function scenarioQualifies(intent, baseline, proposed) {
  if (intent.kind === "under_budget") {
    return proposed.clientPreview.total <= intent.budget
      && proposed.clientPreview.total < baseline.clientPreview.total;
  }
  return baseline.margin.available
    && proposed.margin.available
    && proposed.margin.marginPct > baseline.margin.marginPct + 1e-9;
}

function scenarioSort(intent) {
  return (left, right) => {
    if (intent.kind === "under_budget") {
      const leftDistance = intent.budget - left.clientPreview.after.total;
      const rightDistance = intent.budget - right.clientPreview.after.total;
      return left.compromises.length - right.compromises.length
        || leftDistance - rightDistance
        || right.clientPreview.after.total - left.clientPreview.after.total
        || left.id.localeCompare(right.id);
    }
    const target = intent.targetMarginPct;
    if (target !== null) {
      const leftMeets = left.marginEvidence.after.available
        && left.marginEvidence.after.marginPct >= target;
      const rightMeets = right.marginEvidence.after.available
        && right.marginEvidence.after.marginPct >= target;
      if (leftMeets !== rightMeets) return leftMeets ? -1 : 1;
    }
    return (right.marginEvidence.deltaPercentagePoints || 0)
      - (left.marginEvidence.deltaPercentagePoints || 0)
      || left.compromises.length - right.compromises.length
      || left.id.localeCompare(right.id);
  };
}

function proposalFromEvaluation({ index, intent, alternative, baseline, proposed, context, locks }) {
  const totalDelta = Math.round((proposed.clientPreview.total - baseline.clientPreview.total) * 100) / 100;
  const depositDelta = Math.round((proposed.clientPreview.deposit - baseline.clientPreview.deposit) * 100) / 100;
  const deltaPercentagePoints = marginDelta(baseline.margin, proposed.margin);
  const goal = intent.kind === "under_budget"
    ? `${formatMoney(proposed.clientPreview.total)} is ${formatMoney(intent.budget - proposed.clientPreview.total)} under the stated ${formatMoney(intent.budget)} budget.`
    : `${deltaPercentagePoints.toFixed(2)} percentage points of recorded-cost margin improvement.`;
  const executionPolicy = authorizePilotV1Command({
    commandClass: "simulation",
    authorityLevel: "draft",
    confirmed: true
  });
  return {
    id: `pilot-bounded-scenario:${intent.kind}:${String(index + 1).padStart(2, "0")}`,
    modelId: PILOT_BOUNDED_SCENARIO_MODEL,
    kind: "simulation_proposal",
    commandClass: "simulation",
    authorityLevel: "draft",
    state: "available",
    title: intent.kind === "under_budget"
      ? `${alternative.compromises.length === 1 ? "One" : "Two"} explicit compromise${alternative.compromises.length === 1 ? "" : "s"} under budget`
      : `${alternative.compromises.length === 1 ? "One" : "Two"} explicit margin improvement${alternative.compromises.length === 1 ? "" : "s"}`,
    summary: goal,
    patch: alternative.patch,
    changedFields: Object.keys(alternative.patch).sort(),
    lockedScope: [...locks].sort(),
    compromises: alternative.compromises,
    clientPreview: {
      before: baseline.clientPreview,
      after: proposed.clientPreview,
      delta: { total: totalDelta, deposit: depositDelta }
    },
    marginEvidence: {
      before: baseline.margin,
      after: proposed.margin,
      deltaPercentagePoints
    },
    why: intent.kind === "under_budget"
      ? `The price preview reaches the stated budget using only ${alternative.compromises.length} visible current-catalog or organization-rule change${alternative.compromises.length === 1 ? "" : "s"}.`
      : "Complete recorded costs show a positive margin change for this preview.",
    consequence: `The client preview changes by ${formatMoney(totalDelta)} and the deposit preview changes by ${formatMoney(depositDelta)}. The listed compromises are the complete direct patch; package inclusions, fees, tax, staffing cost, and margin may move together in the preview.`,
    doNothing: `The in-memory draft stays at ${formatMoney(baseline.clientPreview.total)} with a ${formatMoney(baseline.clientPreview.deposit)} deposit preview; nothing is staged, saved, sent, or published.`,
    confidence: {
      level: "medium",
      basis: "Every alternative is from the exact fresh tenant evidence supplied by the caller and both sides use the same client calculator. Server repricing and current-revision confirmation remain unavailable."
    },
    provenance: [
      {
        source: alternative.basis,
        catalogRevision: context.catalogRevision,
        freshness: "fresh",
        observedAtISO: context.observedAtISO
      },
      {
        source: "quoteCalculator",
        authority: "client_calculated_preview"
      },
      ...(baseline.margin.available && proposed.margin.available
        ? [{ source: "margin-presentation-v1", authority: "recorded_cost_advisory" }]
        : [])
    ],
    unavailableReasons: [
      "Server-authoritative repricing is unavailable until trusted save.",
      "Current-revision conflict confirmation is unavailable until trusted save."
    ],
    adoption: {
      required: true,
      outcomeLabel: "Adopt in draft review",
      allowedAfterExplicitConfirmation: executionPolicy.allowed === true,
      boundary: ADOPTION_BOUNDARY
    },
    boundary: BOUNDARY
  };
}

function resultBase({ intent, locks, limits, state, unavailableReasons = [], baseline = null }) {
  return {
    modelId: PILOT_BOUNDED_SCENARIO_MODEL,
    kind: "bounded_simulation_result",
    commandClass: "simulation",
    authorityLevel: "draft",
    state,
    intent,
    lockedScope: locks,
    baseline,
    proposals: [],
    bounds: {
      atomicAlternativeLimit: limits.atomicAlternatives,
      candidateLimit: limits.candidates,
      resultLimit: limits.results,
      runtimeBudgetMs: limits.runtimeMs,
      atomicAlternativesEnumerated: 0,
      candidatesEvaluated: 0,
      truncated: false,
      deadlineReached: false
    },
    why: "Pilot evaluates only active exact-tenant catalog and rule alternatives inside the caller's declared lock boundary.",
    consequence: "No proposal changes state until a person explicitly adopts its exact patch into draft review, and trusted save authority remains separate.",
    doNothing: baseline
      ? `The in-memory draft stays at ${formatMoney(baseline.clientPreview.total)} with a ${formatMoney(baseline.clientPreview.deposit)} deposit preview.`
      : "The draft, saved quote, customer communication, and provider state remain unchanged.",
    confidence: {
      level: state === "unavailable" ? "unavailable" : "medium",
      basis: state === "unavailable"
        ? "A required explicit input or exact evidence contract failed closed."
        : "Deterministic bounded enumeration over the exact caller-supplied evidence; no authoritative repricing claim."
    },
    provenance: [],
    unavailableReasons: stableUniqueStrings(unavailableReasons),
    adoption: {
      required: true,
      boundary: ADOPTION_BOUNDARY
    },
    boundary: BOUNDARY
  };
}

/**
 * Generate up to `limits.results` deterministic simulation proposals.
 *
 * Required integration inputs:
 * - `organizationId`: current tenant scope (never returned)
 * - `catalogEvidence`: fresh exact-tenant evidence shaped like the Ambient
 *   Package/Menu catalog adapter
 * - `lockedScope`: explicit array from PILOT_BOUNDED_SCENARIO_LOCKS
 * - `intent`: an explicit intent object or strict text recognized by
 *   parsePilotBoundedScenarioIntent
 *
 * `clock` is injectable only to prove the runtime cutoff in unit tests. It is
 * read but never returned. No caller or customer identity is copied to output.
 */
export function generatePilotBoundedScenarios({
  intent: rawIntent,
  organizationId = "",
  form = {},
  catalogEvidence = null,
  settings = {},
  staffingEvidence = null,
  lockedScope = [],
  marginEnabled = false,
  marginAuthorized = false,
  limits: rawLimits = {},
  clock = defaultClock
} = {}) {
  const limits = normalizedLimits(rawLimits);
  const intent = normalizeIntent(rawIntent);
  const normalizedLock = normalizeLocks(lockedScope);
  const unavailable = (reasons) => frozen(resultBase({
    intent,
    locks: normalizedLock.locks,
    limits,
    state: "unavailable",
    unavailableReasons: reasons
  }));

  if (!intent) {
    return unavailable(["Use an explicit 'under <USD budget>' or 'improve margin' intent."]);
  }
  if (normalizedLock.reason) return unavailable([normalizedLock.reason]);
  if (!isRecord(form) || !isRecord(settings)) {
    return unavailable(["A complete in-memory draft and pricing settings object are required."]);
  }
  const catalog = normalizeCatalogContext(organizationId, catalogEvidence, settings);
  if (!catalog.context) return unavailable([catalog.reason]);
  const context = catalog.context;
  const selectedPackage = context.packages.find((item) => item.id === form.pkg);
  if (!selectedPackage || !selectedPackage.active) {
    return unavailable(["The draft's selected package is not an active exact record in the current tenant catalog."]);
  }
  const selectedPricingReasons = selectedCatalogPricingReasons(form, context);
  if (selectedPricingReasons.length) return unavailable(selectedPricingReasons);
  const baselineTotals = calculateClientPreview(form, context);
  if (!baselineTotals || !(baselineTotals.total > 0)) {
    return unavailable(["The deterministic client calculator could not produce a complete positive baseline preview."]);
  }
  const baseline = {
    clientPreview: commercialPreview(baselineTotals),
    margin: marginEvidence({
      form,
      totals: baselineTotals,
      context,
      marginEnabled,
      marginAuthorized
    })
  };
  if (intent.kind === "improve_margin" && !baseline.margin.available) {
    return frozen(resultBase({
      intent,
      locks: normalizedLock.locks,
      limits,
      state: "unavailable",
      baseline,
      unavailableReasons: [
        baseline.margin.reason,
        ...baseline.margin.missing,
        "Pilot cannot recommend a margin change without complete authorized recorded-cost evidence."
      ]
    }));
  }
  if (intent.kind === "under_budget" && baseline.clientPreview.total <= intent.budget) {
    const satisfied = resultBase({
      intent,
      locks: normalizedLock.locks,
      limits,
      state: "satisfied",
      baseline
    });
    satisfied.why = `The current ${formatMoney(baseline.clientPreview.total)} client preview is already within the stated ${formatMoney(intent.budget)} budget.`;
    satisfied.consequence = "No compromise is recommended because the bounded goal is already met; trusted save authority remains unchanged.";
    satisfied.confidence = {
      level: "medium",
      basis: "The same deterministic client calculator evaluated the current in-memory draft; server repricing remains separate."
    };
    satisfied.provenance = [
      { source: "active_tenant_catalog", catalogRevision: context.catalogRevision, freshness: "fresh", observedAtISO: context.observedAtISO },
      { source: "quoteCalculator", authority: "client_calculated_preview" }
    ];
    return frozen(satisfied);
  }
  if (
    intent.kind === "improve_margin"
    && intent.targetMarginPct !== null
    && baseline.margin.marginPct >= intent.targetMarginPct
  ) {
    const satisfied = resultBase({
      intent,
      locks: normalizedLock.locks,
      limits,
      state: "satisfied",
      baseline
    });
    satisfied.why = `The current recorded-cost margin already meets the explicit ${(intent.targetMarginPct * 100).toFixed(1)}% target.`;
    satisfied.consequence = "No compromise is recommended because the explicit target is already met.";
    satisfied.provenance = [
      { source: "active_tenant_catalog", catalogRevision: context.catalogRevision, freshness: "fresh", observedAtISO: context.observedAtISO },
      { source: "margin-presentation-v1", authority: "recorded_cost_advisory" }
    ];
    return frozen(satisfied);
  }

  const staffing = normalizeStaffingEvidence(organizationId, staffingEvidence);
  const locks = new Set(normalizedLock.locks);
  const alternatives = boundedAlternatives({
    intent,
    form,
    context,
    staffingRules: staffing.rules,
    locks,
    limits
  });
  const startedAt = typeof clock === "function" ? Number(clock()) : defaultClock();
  const evaluations = [];
  let candidatesEvaluated = 0;
  let deadlineReached = false;
  for (const alternative of alternatives.candidates) {
    const elapsed = (typeof clock === "function" ? Number(clock()) : defaultClock()) - startedAt;
    if (!Number.isFinite(elapsed) || elapsed > limits.runtimeMs) {
      deadlineReached = true;
      break;
    }
    if (!safeLockedPatch(alternative, locks)) continue;
    candidatesEvaluated += 1;
    const proposedForm = applyPatch(form, alternative.patch);
    const proposedTotals = calculateClientPreview(proposedForm, context);
    if (!proposedTotals) continue;
    const proposed = {
      clientPreview: commercialPreview(proposedTotals),
      margin: marginEvidence({
        form: proposedForm,
        totals: proposedTotals,
        context,
        marginEnabled,
        marginAuthorized
      })
    };
    if (!scenarioQualifies(intent, baseline, proposed)) continue;
    evaluations.push({ alternative, proposed });
  }

  const proposals = evaluations.map(({ alternative, proposed }, index) => proposalFromEvaluation({
    index,
    intent,
    alternative,
    baseline,
    proposed,
    context,
    locks
  })).sort(scenarioSort(intent)).slice(0, limits.results).map((proposal, index) => ({
    ...proposal,
    id: `pilot-bounded-scenario:${intent.kind}:${String(index + 1).padStart(2, "0")}`
  }));

  const state = proposals.length ? "available" : "no_match";
  const unavailableReasons = [
    locks.has("staffing") ? "" : staffing.reason,
    deadlineReached
      ? `The ${limits.runtimeMs}ms runtime budget ended before every bounded candidate was evaluated.`
      : "",
    !proposals.length
      ? intent.kind === "under_budget"
        ? "No bounded active alternative reached the stated budget while preserving the declared locked scope."
        : "No bounded active alternative produced a provable recorded-cost margin improvement."
      : ""
  ];
  const output = resultBase({
    intent,
    locks: normalizedLock.locks,
    limits,
    state,
    baseline,
    unavailableReasons
  });
  output.proposals = proposals;
  output.bounds = {
    ...output.bounds,
    atomicAlternativesEnumerated: alternatives.atomicCount,
    candidatesEvaluated,
    truncated: alternatives.truncated || evaluations.length > limits.results,
    deadlineReached
  };
  output.provenance = [
    { source: "active_tenant_catalog", catalogRevision: context.catalogRevision, freshness: "fresh", observedAtISO: context.observedAtISO },
    { source: "quoteCalculator", authority: "client_calculated_preview" },
    ...(baseline.margin.available
      ? [{ source: "margin-presentation-v1", authority: "recorded_cost_advisory" }]
      : [])
  ];
  output.why = proposals.length
    ? `${proposals.length} option${proposals.length === 1 ? "" : "s"} meet the requested goal without changing the details marked to stay fixed.`
    : output.why;
  return frozen(output);
}
