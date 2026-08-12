import { createIntelligentObjectDescriptor } from "./ambientContracts";

export const AMBIENT_SELECTION_OBJECTS_MODEL = "ambient-selection-objects-v1";
export const AMBIENT_SELECTION_OBJECT_KINDS = Object.freeze([
  "addon",
  "rental",
  "bar",
  "service"
]);

export const AMBIENT_SELECTION_GESTURE_SEMANTICS = Object.freeze({
  minimumDistancePx: 48,
  left: "reduce_or_remove_local_scenario",
  right: "increase_or_restore_local_scenario",
  visibleButtonAlternativeRequired: true,
  keyboardButtonAlternativeRequired: true
});

const STAFF_ROLES = new Set(["admin", "sales"]);
const PRICING_TYPES = new Set(["per_person", "per_item", "per_event"]);
const STAFF_TYPES = new Set(["server", "chef", "bartender"]);
const SELECTION_BOUNDS = Object.freeze({
  catalogItems: 500,
  selectedItems: 100,
  quantity: 10_000,
  rules: 100
});
const GROUP_DEFINITIONS = Object.freeze({
  addon: Object.freeze({ label: "Add-ons", singular: "add-on" }),
  rental: Object.freeze({ label: "Rentals", singular: "rental" }),
  bar: Object.freeze({ label: "Bar", singular: "bar selection" }),
  service: Object.freeze({ label: "Services", singular: "service selection" })
});
const BAR_SIGNAL = /\b(bar|bartend(?:er|ing)?|cocktail|beer|wine|spirit|beverage)\b/iu;
const SERVICE_SIGNAL = /\b(service|server|chef|attendant|setup|set-up|cleanup|clean-up|delivery|station)\b/iu;

function text(value, maximum = 240) {
  const candidate = String(value ?? "").trim();
  if (!candidate || candidate.length > maximum || /[\u0000-\u001f\u007f]/u.test(candidate)) return "";
  return candidate;
}

function id(value) {
  const candidate = text(value, 160);
  return candidate && !/[/?#\\]/u.test(candidate) ? candidate : "";
}

function record(value) {
  if (!value || typeof value !== "object" || Array.isArray(value)) return false;
  const prototype = Object.getPrototypeOf(value);
  return prototype === Object.prototype || prototype === null;
}

function exactIso(value) {
  const candidate = text(value, 64);
  if (!candidate) return "";
  const parsed = new Date(candidate);
  return !Number.isNaN(parsed.getTime()) && parsed.toISOString() === candidate
    ? candidate
    : "";
}

function immutable(value, seen = new WeakSet()) {
  if (!value || typeof value !== "object" || Object.isFrozen(value) || seen.has(value)) return value;
  seen.add(value);
  Reflect.ownKeys(value).forEach((key) => immutable(value[key], seen));
  return Object.freeze(value);
}

function exactQuantity(value, fallback = 1) {
  const number = Number(value);
  return Number.isSafeInteger(number) && number >= 1 && number <= SELECTION_BOUNDS.quantity
    ? number
    : fallback;
}

function uniqueIds(value) {
  const source = Array.isArray(value) ? value : [];
  const seen = new Set();
  return source
    .slice(0, SELECTION_BOUNDS.selectedItems)
    .map(id)
    .filter((itemId) => {
      if (!itemId || seen.has(itemId)) return false;
      seen.add(itemId);
      return true;
    });
}

function pricingType(value, fallback) {
  const candidate = text(value, 24).toLowerCase();
  return PRICING_TYPES.has(candidate) ? candidate : fallback;
}

function pricingLabel(value) {
  if (value === "per_person") return "Per person";
  if (value === "per_item") return "Per item";
  return "Per event";
}

function money(value) {
  const amount = Number(value);
  if (!Number.isFinite(amount) || amount < 0) return "Price unavailable";
  return new Intl.NumberFormat("en-US", {
    style: "currency",
    currency: "USD",
    minimumFractionDigits: 2,
    maximumFractionDigits: 2
  }).format(amount);
}

function normalizedCatalogRecord(value, sourceKind) {
  if (!record(value)) return null;
  const recordId = id(value.id);
  const name = text(value.name, 160);
  if (!recordId || !name) return null;
  const fallbackPricingType = sourceKind === "rental" ? "per_item" : "per_person";
  const resolvedPricingType = pricingType(value.pricingType || value.type, fallbackPricingType);
  const staffRole = STAFF_TYPES.has(text(value.staffRole, 24).toLowerCase())
    ? text(value.staffRole, 24).toLowerCase()
    : "";
  const qtyPerGuests = Number(value.qtyPerGuests);
  return {
    id: recordId,
    name,
    sourceKind,
    pricingType: resolvedPricingType,
    staffRole,
    catalogActive: value.active !== false,
    price: Number.isFinite(Number(value.price)) && Number(value.price) >= 0
      ? Number(value.price)
      : null,
    qtyPerGuests: Number.isFinite(qtyPerGuests) && qtyPerGuests > 0
      ? qtyPerGuests
      : null
  };
}

function normalizedRule(value) {
  if (!record(value)) return null;
  const ruleId = id(value.id);
  const kind = text(value.kind, 24).toLowerCase();
  const targetId = id(value.targetId);
  if (!ruleId || !["addon", "rental"].includes(kind) || !targetId) return null;
  return {
    id: ruleId,
    name: text(value.name, 160) || ruleId,
    kind,
    targetId,
    enabled: value.enabled === true,
    minGuests: Math.max(0, Number(value.minGuests) || 0),
    minHours: Math.max(0, Number(value.minHours) || 0),
    reason: text(value.reason, 500) || "The tenant's recorded guided-selling rule matched this event."
  };
}

function unavailableCatalogContext(reason) {
  return immutable({
    state: "unknown",
    reason,
    organizationId: "",
    sourceLabel: "catalog-source-unavailable",
    catalogRevision: null,
    observedAt: null,
    addons: [],
    rentals: [],
    upsellRules: []
  });
}

function normalizeCatalogContext(value, expectedOrganizationId) {
  if (!record(value)) {
    return unavailableCatalogContext("The current tenant catalog evidence was not supplied.");
  }
  const organizationId = id(value.organizationId);
  const sourceLabel = text(value.sourceLabel, 120);
  const catalogRevision = value.catalogRevision;
  const freshness = record(value.freshness) ? value.freshness : {};
  const observedAt = exactIso(freshness.observedAtISO || freshness.observedAt);
  const freshnessState = text(freshness.state, 16).toLowerCase();
  const reason = text(freshness.reason, 500);
  if (!organizationId || organizationId !== expectedOrganizationId) {
    return unavailableCatalogContext("The catalog evidence does not match the selected quote organization.");
  }
  if (!sourceLabel || !Number.isSafeInteger(catalogRevision) || catalogRevision < 0) {
    return unavailableCatalogContext("The catalog source or exact revision is unavailable.");
  }
  if (freshnessState !== "fresh" || !observedAt) {
    return immutable({
      ...unavailableCatalogContext(reason || "The catalog evidence is not fresh."),
      state: freshnessState === "stale" ? "stale" : "unknown",
      organizationId,
      sourceLabel,
      catalogRevision,
      observedAt: observedAt || null
    });
  }
  if (
    !Array.isArray(value.addons)
    || value.addons.length > SELECTION_BOUNDS.catalogItems
    || !Array.isArray(value.rentals)
    || value.rentals.length > SELECTION_BOUNDS.catalogItems
    || (value.upsellRules !== undefined && !Array.isArray(value.upsellRules))
  ) {
    return unavailableCatalogContext("The catalog lacks bounded add-on, rental, or recommendation collections.");
  }
  const addons = value.addons.map((item) => normalizedCatalogRecord(item, "addon"));
  const rentals = value.rentals.map((item) => normalizedCatalogRecord(item, "rental"));
  const rules = (value.upsellRules || [])
    .slice(0, SELECTION_BOUNDS.rules)
    .map(normalizedRule)
    .filter(Boolean);
  if (
    addons.some((item) => !item)
    || rentals.some((item) => !item)
    || new Set(addons.map((item) => item.id)).size !== addons.length
    || new Set(rentals.map((item) => item.id)).size !== rentals.length
  ) {
    return unavailableCatalogContext("The catalog selection evidence contains invalid or duplicate records.");
  }
  return immutable({
    state: "current",
    reason: "",
    organizationId,
    sourceLabel,
    catalogRevision,
    observedAt,
    addons,
    rentals,
    upsellRules: rules
  });
}

function snapshotMap(selection, sourceKind) {
  const candidates = sourceKind === "rental"
    ? selection.rentalSnapshots
    : selection.addonSnapshots;
  const output = new Map();
  for (const item of Array.isArray(candidates) ? candidates.slice(0, SELECTION_BOUNDS.selectedItems) : []) {
    if (!record(item)) continue;
    const itemId = id(item.id);
    if (!itemId || output.has(itemId)) continue;
    output.set(itemId, {
      id: itemId,
      name: text(item.name, 160),
      pricingType: pricingType(
        item.pricingType || item.type,
        sourceKind === "rental" ? "per_item" : "per_person"
      ),
      quantity: exactQuantity(item.quantity, 1),
      price: Number.isFinite(Number(item.price)) && Number(item.price) >= 0
        ? Number(item.price)
        : null
    });
  }
  return output;
}

function inclusionMap(selection, sourceKind) {
  const source = record(selection.packageInclusions)
    ? selection.packageInclusions[sourceKind === "rental" ? "rentals" : "addons"]
    : [];
  return new Map((Array.isArray(source) ? source : [])
    .slice(0, SELECTION_BOUNDS.selectedItems)
    .map((item) => [id(item?.id), text(item?.name, 160)])
    .filter(([itemId]) => itemId));
}

function quantityMap(selection, sourceKind) {
  const source = selection[sourceKind === "rental" ? "rentalQuantities" : "addonQuantities"];
  return record(source) ? source : {};
}

function classifyAddon(catalogRecord, savedName) {
  const signal = `${catalogRecord?.id || ""} ${catalogRecord?.name || savedName || ""}`.trim();
  if (catalogRecord?.staffRole === "bartender") {
    return {
      kind: "bar",
      method: "recorded_staff_role",
      confidence: "high",
      reason: "The current tenant catalog records bartender as this add-on's staff role."
    };
  }
  if (BAR_SIGNAL.test(signal)) {
    return {
      kind: "bar",
      method: "bounded_name_signal",
      confidence: "medium",
      reason: "A bounded bar or beverage term appears in the saved or current-catalog identity."
    };
  }
  if (["server", "chef"].includes(catalogRecord?.staffRole)) {
    return {
      kind: "service",
      method: "recorded_staff_role",
      confidence: "high",
      reason: `The current tenant catalog records ${catalogRecord.staffRole} as this add-on's staff role.`
    };
  }
  if (SERVICE_SIGNAL.test(signal)) {
    return {
      kind: "service",
      method: "bounded_name_signal",
      confidence: "medium",
      reason: "A bounded service term appears in the saved or current-catalog identity."
    };
  }
  return {
    kind: "addon",
    method: "canonical_selection_rail",
    confidence: "high",
    reason: "The saved quote records this item on the canonical add-on selection rail."
  };
}

function quantityDisplay({ quantity, pricingType: type, staffRole }) {
  if (type === "per_person") return `${quantity} ${quantity === 1 ? "guest" : "guests"} covered`;
  if (type === "per_item") return `${quantity} ${quantity === 1 ? "unit" : "units"} selected`;
  if (staffRole) return `${quantity} ${quantity === 1 ? staffRole : `${staffRole}s`} selected`;
  return quantity > 0 ? "Selected for this event" : "Not selected";
}

function matchingRule(catalog, sourceKind, itemId, quote) {
  if (catalog.state !== "current") return null;
  const guests = Math.max(0, Number(quote?.event?.guests) || 0);
  const hours = Math.max(0, Number(quote?.event?.hours) || 0);
  return catalog.upsellRules.find((rule) => (
    rule.enabled
    && rule.kind === sourceKind
    && rule.targetId === itemId
    && guests >= rule.minGuests
    && hours >= rule.minHours
  )) || null;
}

function selectionDependencies({
  sourceKind,
  kind,
  itemId,
  itemName,
  selectedPackageId,
  includedInPackage,
  type,
  staffRole,
  guests,
  serviceStyle
}) {
  const dependencies = [
    {
      object: { id: "pricing", type: "intelligent-object", label: "Pricing" },
      relationship: "pricing_uses",
      consequence: `${itemName} uses ${pricingLabel(type).toLowerCase()} pricing. Any local quantity or selection change still requires the current calculator and trusted save path.`
    },
    {
      object: { id: "package", type: "intelligent-object", label: "Package" },
      relationship: includedInPackage ? "package_includes" : "package_may_constrain",
      consequence: includedInPackage
        ? `${itemName} is recorded among the selected package inclusions${selectedPackageId ? ` for ${selectedPackageId}` : ""}.`
        : `${itemName} is not recorded as included in the selected package.`
    },
    {
      object: { id: "guest-count", type: "intelligent-object", label: "Guest count" },
      relationship: type === "per_person" ? "quantity_tracks" : "quantity_may_depend_on",
      consequence: guests > 0
        ? `${guests} saved guests are relevant to coverage and repricing.`
        : "A usable saved guest count is unavailable."
    }
  ];
  if (kind === "bar" || kind === "service" || staffRole) {
    dependencies.push({
      object: { id: "staffing", type: "intelligent-object", label: "Staffing" },
      relationship: "operations_review",
      consequence: staffRole
        ? `${itemName} records a ${staffRole} catalog role, but add-ons do not themselves prove assignments, availability, or operational coverage.`
        : `${itemName} is grouped as ${GROUP_DEFINITIONS[kind].singular}; staffing availability and assignments remain separate evidence.`
    });
  }
  if (kind === "service") {
    dependencies.push({
      object: { id: "service-style", type: "operational-fact", label: "Service style" },
      relationship: "contextualized_by",
      consequence: serviceStyle
        ? `The saved event style is ${serviceStyle}; this does not prove the selected service is sufficient.`
        : "The saved service style is unavailable."
    });
  }
  return dependencies.map((item) => ({ ...item, object: { ...item.object } }));
}

function buildSelectionObject({
  quote,
  source,
  sourceKind,
  itemId,
  snapshot,
  inclusionName,
  explicitQuantity,
  catalog,
  catalogRecord,
  ordinaryEditAllowed,
  staffRoleAllowed
}) {
  const savedName = snapshot?.name || inclusionName || catalogRecord?.name || itemId;
  const classification = sourceKind === "rental"
    ? {
        kind: "rental",
        method: "canonical_selection_rail",
        confidence: "high",
        reason: "The saved quote records this item on the canonical rental selection rail."
      }
    : classifyAddon(catalogRecord, savedName);
  const type = snapshot?.pricingType
    || catalogRecord?.pricingType
    || (sourceKind === "rental" ? "per_item" : "per_person");
  const savedQuantity = exactQuantity(
    explicitQuantity,
    exactQuantity(snapshot?.quantity, type === "per_person"
      ? Math.max(1, Number(quote?.event?.guests) || 1)
      : 1)
  );
  const includedInPackage = Boolean(inclusionName);
  const currentCatalogMatch = Boolean(
    catalog.state === "current"
    && catalogRecord
    && catalogRecord.catalogActive
  );
  const canStage = Boolean(
    staffRoleAllowed
    && ordinaryEditAllowed
    && currentCatalogMatch
    && id(quote?.id)
    && id(quote?.organizationId)
    && id(quote?.activeVersionId || quote?.versionMeta?.versionId || quote?.updatedAtISO)
  );
  const quantityMutable = type === "per_item"
    || (sourceKind === "addon" && type === "per_event" && Boolean(catalogRecord?.staffRole));
  const objectId = `selection:${classification.kind}:${sourceKind}:${itemId}`;
  const rule = matchingRule(catalog, sourceKind, itemId, quote);
  const guests = Math.max(0, Number(quote?.event?.guests) || 0);
  const hours = Math.max(0, Number(quote?.event?.hours) || 0);
  const selectedPackageId = id(quote?.selection?.packageId);
  const dependencies = selectionDependencies({
    sourceKind,
    kind: classification.kind,
    itemId,
    itemName: savedName,
    selectedPackageId,
    includedInPackage,
    type,
    staffRole: catalogRecord?.staffRole || "",
    guests,
    serviceStyle: text(quote?.event?.style, 120)
  });
  const actionStem = `selection-${classification.kind}-${sourceKind}-${itemId}`;
  const actionIds = {
    reduce: `reduce-${actionStem}`,
    increase: `increase-${actionStem}`,
    keep: `keep-${actionStem}`,
    undo: `undo-${actionStem}`
  };
  const provenance = [
    {
      sourceId: `quote-selection:${id(quote?.id) || "selected"}:${sourceKind}:${itemId}`,
      label: `Saved quote ${sourceKind} selection`,
      type: text(source, 80) || "saved-record",
      state: "available"
    },
    currentCatalogMatch
      ? {
          sourceId: `tenant-catalog:${catalog.catalogRevision}:${sourceKind}:${itemId}`,
          label: `Current tenant catalog revision ${catalog.catalogRevision}`,
          type: catalog.sourceLabel,
          state: "available",
          observedAt: catalog.observedAt
        }
      : {
          sourceId: `tenant-catalog:${sourceKind}:${itemId}`,
          label: "Current tenant catalog match",
          type: catalog.sourceLabel,
          state: catalog.state === "stale" ? "stale" : "unavailable",
          ...(catalog.observedAt ? { observedAt: catalog.observedAt } : {}),
          reason: catalog.state !== "current"
            ? catalog.reason
            : catalogRecord?.catalogActive === false
              ? "The matching catalog record is inactive."
              : "No exact matching catalog record is available."
        }
  ];
  if (rule) {
    provenance.push({
      sourceId: `tenant-rule:${rule.id}`,
      label: rule.name,
      type: "tenant-guided-selling-rule",
      state: "available",
      observedAt: catalog.observedAt
    });
  }
  const consequence = quantityMutable
    ? `Changing ${savedName} in the unsaved preview can change its line amount, fees, tax, deposit, margin, package reconciliation, and operational preparation. No saved value changes on this surface.`
    : `Removing or restoring ${savedName} in the unsaved preview can change scope, price, fees, tax, deposit, margin, package reconciliation, and operational preparation. No saved value changes on this surface.`;
  const doNothing = `${savedName} remains ${quantityDisplay({
    quantity: savedQuantity,
    pricingType: type,
    staffRole: catalogRecord?.staffRole || ""
  }).toLowerCase()} on the saved quote. No reprice, reservation, assignment, customer communication, or save occurs.`;
  const why = rule
    ? `${rule.reason} The rule matches ${guests} guests and ${hours} saved hours, but it does not prove necessity, availability, or price authority.`
    : `${classification.reason} No matching tenant recommendation rule is treated as evidence for changing it.`;
  const confidenceLevel = !currentCatalogMatch
    ? "low"
    : classification.confidence;
  const confidenceBasis = !currentCatalogMatch
    ? "The saved selection is available, but current catalog classification and quantity policy are incomplete."
    : `${classification.reason} The exact current catalog record matches the saved selection id.`;
  const descriptor = createIntelligentObjectDescriptor({
    id: objectId,
    type: "selection-intelligent-object",
    label: savedName,
    summary: `${GROUP_DEFINITIONS[classification.kind].singular}: ${quantityDisplay({
      quantity: savedQuantity,
      pricingType: type,
      staffRole: catalogRecord?.staffRole || ""
    })}.`,
    inspectorSurfaceId: "selection-context",
    dependencies,
    why,
    consequence,
    doNothing,
    confidence: {
      level: confidenceLevel,
      basis: confidenceBasis
    },
    provenance,
    recommendation: rule
      ? {
          summary: `${rule.name} supports keeping this selection under its current saved thresholds.`,
          actionId: actionIds.keep
        }
      : null,
    permissions: {
      view: staffRoleAllowed,
      simulate: canStage,
      stage: canStage,
      commit: false,
      reason: canStage
        ? "Changes remain a reversible unsaved preview; the trusted editor and save path retain authority."
        : !staffRoleAllowed
          ? "Selection details are restricted to staff roles."
          : !ordinaryEditAllowed
            ? "This role cannot edit the selected quote."
            : catalog.state !== "current"
              ? catalog.reason
              : "An exact active current-catalog match and saved revision are required."
    },
    actionIds: canStage
      ? [actionIds.reduce, actionIds.increase, actionIds.keep, actionIds.undo]
      : [actionIds.keep]
  });
  return immutable({
    id: objectId,
    itemId,
    sourceKind,
    kind: classification.kind,
    groupLabel: GROUP_DEFINITIONS[classification.kind].label,
    label: savedName,
    descriptor,
    classification,
    current: {
      selected: true,
      quantity: savedQuantity,
      quantityDisplay: quantityDisplay({
        quantity: savedQuantity,
        pricingType: type,
        staffRole: catalogRecord?.staffRole || ""
      }),
      pricingType: type,
      pricingLabel: pricingLabel(type),
      priceLabel: catalogRecord?.price !== null && catalogRecord?.price !== undefined
        ? `${money(catalogRecord.price)} ${pricingLabel(type).toLowerCase()}`
        : snapshot?.price !== null && snapshot?.price !== undefined
          ? `${money(snapshot.price)} saved unit evidence`
          : "Price evidence unavailable",
      includedInPackage,
      packageId: selectedPackageId || null
    },
    adjustment: {
      enabled: canStage,
      quantityMutable,
      minimum: 0,
      maximum: SELECTION_BOUNDS.quantity,
      step: 1,
      gestureSemantics: AMBIENT_SELECTION_GESTURE_SEMANTICS,
      reason: descriptor.permissions.reason
    },
    recommendationEvidence: rule
      ? {
          summary: descriptor.recommendation.summary,
          reason: rule.reason,
          confidence: "high",
          provenanceLabel: `${rule.name}, tenant catalog revision ${catalog.catalogRevision}`
        }
      : null,
    actionIds
  });
}

export function buildAmbientSelectionObjects(quote = {}, {
  source = "",
  role = "non_staff",
  ordinaryEditAllowed = false,
  catalogEvidence = null
} = {}) {
  const selection = record(quote.selection) ? quote.selection : {};
  const organizationId = id(quote.organizationId);
  const quoteId = id(quote.id || quote.quoteId);
  const revisionId = id(
    quote.activeVersionId
    || quote.versionMeta?.versionId
    || quote.updatedAtISO
  );
  const normalizedRole = text(role, 32).toLowerCase() || "non_staff";
  const staffRoleAllowed = STAFF_ROLES.has(normalizedRole);
  const catalog = normalizeCatalogContext(catalogEvidence, organizationId);
  const objects = [];

  for (const sourceKind of ["addon", "rental"]) {
    const plural = sourceKind === "rental" ? "rentals" : "addons";
    const snapshots = snapshotMap(selection, sourceKind);
    const inclusions = inclusionMap(selection, sourceKind);
    const quantities = quantityMap(selection, sourceKind);
    const records = new Map(catalog[plural].map((item) => [item.id, item]));
    for (const itemId of uniqueIds(selection[plural])) {
      objects.push(buildSelectionObject({
        quote,
        source,
        sourceKind,
        itemId,
        snapshot: snapshots.get(itemId) || null,
        inclusionName: inclusions.get(itemId) || "",
        explicitQuantity: quantities[itemId],
        catalog,
        catalogRecord: records.get(itemId) || null,
        ordinaryEditAllowed,
        staffRoleAllowed
      }));
    }
  }

  const groups = AMBIENT_SELECTION_OBJECT_KINDS.map((kind) => immutable({
    kind,
    label: GROUP_DEFINITIONS[kind].label,
    items: objects.filter((item) => item.kind === kind)
  })).filter((group) => group.items.length > 0);
  const stageableCount = objects.filter((item) => item.adjustment.enabled).length;
  const evidenceGapCount = objects.filter((item) => item.descriptor.confidence.level === "low").length;

  return immutable({
    modelId: AMBIENT_SELECTION_OBJECTS_MODEL,
    quoteIdentity: {
      quoteId,
      organizationId,
      revisionId
    },
    catalogContext: catalog,
    objects: staffRoleAllowed ? objects : [],
    groups: staffRoleAllowed ? groups : [],
    populated: staffRoleAllowed && objects.length > 0,
    summary: staffRoleAllowed && objects.length > 0
      ? `${objects.length} saved ${objects.length === 1 ? "selection" : "selections"} across ${groups.length} ${groups.length === 1 ? "group" : "groups"}.`
      : staffRoleAllowed
        ? "No saved add-on or rental selections are recorded."
        : "Selection details are restricted to staff roles.",
    stageableCount,
    evidenceGapCount,
    permissions: {
      view: staffRoleAllowed,
      simulate: stageableCount > 0,
      stage: stageableCount > 0,
      commit: false,
      reason: !staffRoleAllowed
        ? "Selection details are restricted to staff roles."
        : stageableCount > 0
          ? "Selection changes remain reversible unsaved previews and do not save the quote."
          : catalog.reason || "No exact current-catalog selection is available for a preview."
    }
  });
}

export function selectionScenarioQuantity(selectionObject, scenario = {}) {
  if (!selectionObject?.id) return 0;
  const candidate = scenario[selectionObject.id];
  if (candidate === undefined) return selectionObject.current?.quantity || 0;
  const quantity = Number(candidate);
  return Number.isSafeInteger(quantity)
    && quantity >= 0
    && quantity <= SELECTION_BOUNDS.quantity
      ? quantity
      : selectionObject.current?.quantity || 0;
}

export function applyAmbientSelectionScenarioStep(selectionObject, currentQuantity, direction) {
  const current = Number(currentQuantity);
  if (
    !selectionObject?.adjustment?.enabled
    || !Number.isSafeInteger(current)
    || current < 0
    || current > SELECTION_BOUNDS.quantity
    || !["increase", "reduce"].includes(direction)
  ) {
    return immutable({
      ok: false,
      quantity: Number.isSafeInteger(current) ? current : 0,
      reason: selectionObject?.adjustment?.reason || "This selection preview is unavailable."
    });
  }
  let next = current;
  if (selectionObject.adjustment.quantityMutable) {
    next = direction === "increase"
      ? Math.min(selectionObject.adjustment.maximum, current + selectionObject.adjustment.step)
      : Math.max(selectionObject.adjustment.minimum, current - selectionObject.adjustment.step);
  } else {
    next = direction === "increase"
      ? selectionObject.current.quantity
      : 0;
  }
  if (next === current) {
    return immutable({
      ok: false,
      quantity: current,
      reason: direction === "increase"
        ? "The unsaved preview is already at its supported maximum."
        : "The selection is already removed from the unsaved preview."
    });
  }
  return immutable({
    ok: true,
    quantity: next,
    selected: next > 0,
    changedFromSaved: next !== selectionObject.current.quantity,
    reason: next === 0
      ? `${selectionObject.label} is removed from the unsaved preview.`
      : `${selectionObject.label} is set to quantity ${next} in the unsaved preview.`,
    consequence: selectionObject.descriptor.consequence,
    nextResolution: "Review what this affects, undo this change, or keep adjusting the preview."
  });
}
