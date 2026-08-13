import { createIntelligentObjectDescriptor } from "./ambientContracts";

/**
 * Pure Package + Menu intelligent-object model.
 *
 * Saved quote selection is the only source for what the quote contains. The
 * explicitly supplied, tenant-scoped catalog evidence describes only what the
 * current catalog records. This module performs no pricing, margin,
 * availability, persistence, or authority work.
 */
export const AMBIENT_PACKAGE_MENU_MODEL = "ambient-package-menu-objects-v1";
export const AMBIENT_PACKAGE_MENU_INTENT_SCHEMA_VERSION = "ambient-package-menu-draft-intent-v1";

export const AMBIENT_PACKAGE_MENU_OBJECT_KINDS = Object.freeze(["package", "menu"]);

export const AMBIENT_PACKAGE_MENU_BOUNDS = Object.freeze({
  packages: 100,
  menuSections: 40,
  menuItems: 500,
  selectedMenuItems: 100,
  packageInclusionsPerKind: 100,
  packageReplacementCandidates: 24,
  menuReplacementCandidates: 48,
  idCharacters: 160,
  labelCharacters: 240,
  sourceCharacters: 120,
  reasonCharacters: 500,
  quantity: 10_000
});

export const AMBIENT_MENU_REORDER_INTERACTION_SEMANTICS = Object.freeze({
  equivalence: "pointer_and_keyboard_produce_the_same_order_intent",
  pointer: Object.freeze({
    input: "drag",
    requiredFeedback: Object.freeze(["lift", "target_position", "drop_or_cancel"]),
    buttonAlternativeRequired: true
  }),
  keyboard: Object.freeze({
    input: "move_command",
    commands: Object.freeze(["move_previous", "move_next"]),
    requiredFeedback: Object.freeze(["lift", "position_announcement", "drop_or_cancel"]),
    visibleButtonAlternativeRequired: true
  })
});

const STAFF_ROLES = new Set(["admin", "sales"]);
const CATALOG_FRESHNESS_STATES = new Set(["fresh", "stale", "unknown"]);
const INCLUSION_KINDS = Object.freeze(["menuItems", "addons", "rentals"]);
const FORBIDDEN_RECORD_KEYS = new Set(["__proto__", "prototype", "constructor"]);

const OBJECT_DEFINITIONS = Object.freeze({
  package: Object.freeze({
    id: "package",
    label: "Package",
    inspectorSurfaceId: "package-context",
    inspectActionId: "inspect-package",
    replaceActionId: "replace-package-in-draft"
  }),
  menu: Object.freeze({
    id: "menu",
    label: "Menu",
    inspectorSurfaceId: "menu-context",
    inspectActionId: "inspect-menu",
    replaceActionId: "replace-menu-item-in-draft",
    reorderActionId: "reorder-menu-in-draft"
  })
});

function deepFreeze(value, seen = new WeakSet()) {
  if (!value || typeof value !== "object" || seen.has(value)) return value;
  seen.add(value);
  Reflect.ownKeys(value).forEach((key) => deepFreeze(value[key], seen));
  return Object.freeze(value);
}

function isRecord(value) {
  if (!value || typeof value !== "object" || Array.isArray(value)) return false;
  const prototype = Object.getPrototypeOf(value);
  return prototype === Object.prototype || prototype === null;
}

function safeRecord(value) {
  if (!isRecord(value)) return null;
  if (Object.keys(value).some((key) => FORBIDDEN_RECORD_KEYS.has(key))) return null;
  return value;
}

function boundedText(value, maximum, { optional = false } = {}) {
  if (value === undefined || value === null || value === "") {
    return optional ? "" : null;
  }
  if (typeof value !== "string") return null;
  const normalized = value.trim();
  if ((!normalized && !optional) || normalized.length > maximum) return null;
  return normalized;
}

function opaqueId(value, { optional = false } = {}) {
  const normalized = boundedText(value, AMBIENT_PACKAGE_MENU_BOUNDS.idCharacters, { optional });
  if (normalized === "" && optional) return "";
  if (!normalized || /[\u0000-\u001f\u007f/?#\\]/u.test(normalized)) return null;
  return normalized;
}

function exactIso(value) {
  const normalized = boundedText(value, 64, { optional: true });
  if (!normalized) return null;
  const parsed = new Date(normalized);
  if (Number.isNaN(parsed.getTime()) || parsed.toISOString() !== normalized) return null;
  return normalized;
}

function quoteRevisionId(quote) {
  return opaqueId(quote?.activeVersionId || quote?.versionMeta?.versionId, { optional: true }) || "";
}

function quoteIdentity(quote = {}) {
  return deepFreeze({
    quoteId: opaqueId(quote?.id, { optional: true }) || "",
    organizationId: opaqueId(quote?.organizationId, { optional: true }) || "",
    revisionId: quoteRevisionId(quote),
    observedAt: exactIso(quote?.updatedAtISO || quote?.createdAtISO)
  });
}

function unavailableCatalogEvidence(reason) {
  return deepFreeze({
    state: "unavailable",
    reason,
    organizationId: null,
    sourceLabel: null,
    catalogRevision: null,
    freshness: {
      state: "unknown",
      observedAt: null,
      reason: "No usable tenant catalog evidence was normalized."
    },
    packages: [],
    menuItems: []
  });
}

function exactUniqueIds(value, label, maximum) {
  if (!Array.isArray(value)) throw new TypeError(`${label} must be an array.`);
  if (value.length > maximum) throw new TypeError(`${label} exceeds its evidence bound.`);
  const ids = value.map((entry) => {
    const id = opaqueId(entry);
    if (!id) throw new TypeError(`${label} contains an invalid id.`);
    return id;
  });
  if (new Set(ids).size !== ids.length) throw new TypeError(`${label} contains duplicate ids.`);
  return ids;
}

function normalizePackageCatalogRecord(value, index) {
  const input = safeRecord(value);
  if (!input) throw new TypeError(`packages[${index}] is not a plain catalog record.`);
  const id = opaqueId(input.id);
  const name = boundedText(input.name, AMBIENT_PACKAGE_MENU_BOUNDS.labelCharacters);
  if (!id || !name || typeof input.active !== "boolean") {
    throw new TypeError(`packages[${index}] lacks an exact id, name, or active flag.`);
  }
  return {
    id,
    name,
    catalogActive: input.active,
    declaredInclusionIds: {
      menuItems: exactUniqueIds(
        input.includedMenuItemIds ?? [],
        `packages[${index}].includedMenuItemIds`,
        AMBIENT_PACKAGE_MENU_BOUNDS.packageInclusionsPerKind
      ),
      addons: exactUniqueIds(
        input.includedAddonIds ?? [],
        `packages[${index}].includedAddonIds`,
        AMBIENT_PACKAGE_MENU_BOUNDS.packageInclusionsPerKind
      ),
      rentals: exactUniqueIds(
        input.includedRentalIds ?? [],
        `packages[${index}].includedRentalIds`,
        AMBIENT_PACKAGE_MENU_BOUNDS.packageInclusionsPerKind
      )
    },
    operationalAvailability: "not_evaluated"
  };
}

function normalizeMenuCatalogRecord(value, section, sectionIndex, itemIndex) {
  const input = safeRecord(value);
  if (!input) throw new TypeError(`menuSections[${sectionIndex}].items[${itemIndex}] is not a plain catalog record.`);
  const id = opaqueId(input.id);
  const name = boundedText(input.name, AMBIENT_PACKAGE_MENU_BOUNDS.labelCharacters);
  if (!id || !name || typeof input.active !== "boolean") {
    throw new TypeError(`menuSections[${sectionIndex}].items[${itemIndex}] lacks an exact id, name, or active flag.`);
  }
  return {
    id,
    name,
    catalogActive: input.active,
    section: { id: section.id, label: section.label, orderIndex: sectionIndex },
    catalogOrderIndex: itemIndex,
    operationalAvailability: "not_evaluated"
  };
}

function normalizeCatalogFreshness(input) {
  const freshness = safeRecord(input);
  if (!freshness) throw new TypeError("Catalog freshness must be a plain record.");
  const state = boundedText(freshness.state, 16);
  if (!CATALOG_FRESHNESS_STATES.has(state)) throw new TypeError("Catalog freshness state is unsupported.");
  const observedAt = exactIso(freshness.observedAtISO || freshness.observedAt);
  const reason = boundedText(
    freshness.reason,
    AMBIENT_PACKAGE_MENU_BOUNDS.reasonCharacters,
    { optional: true }
  );
  if (state === "fresh" && !observedAt) {
    throw new TypeError("Fresh catalog evidence requires an exact observation time.");
  }
  if (state === "stale" && (!observedAt || !reason)) {
    throw new TypeError("Stale catalog evidence requires an exact observation time and reason.");
  }
  if (state === "unknown" && !reason) {
    throw new TypeError("Unknown catalog freshness requires a reason.");
  }
  return { state, observedAt, reason: reason || null };
}

function normalizeCatalogEvidence(input, expectedOrganizationId) {
  try {
    const value = safeRecord(input);
    if (!value) throw new TypeError("Tenant catalog evidence was not supplied as a plain record.");
    const organizationId = opaqueId(value.organizationId);
    const sourceLabel = boundedText(value.sourceLabel, AMBIENT_PACKAGE_MENU_BOUNDS.sourceCharacters);
    const catalogRevision = value.catalogRevision;
    if (!organizationId || !sourceLabel || !Number.isSafeInteger(catalogRevision) || catalogRevision < 0) {
      throw new TypeError("Tenant catalog scope, source, or revision is invalid.");
    }
    if (!expectedOrganizationId || organizationId !== expectedOrganizationId) {
      throw new TypeError("Tenant catalog evidence does not match the selected quote organization.");
    }
    const freshness = normalizeCatalogFreshness(value.freshness);
    if (!Array.isArray(value.packages) || value.packages.length > AMBIENT_PACKAGE_MENU_BOUNDS.packages) {
      throw new TypeError("Package catalog evidence is missing or exceeds its bound.");
    }
    if (!Array.isArray(value.menuSections) || value.menuSections.length > AMBIENT_PACKAGE_MENU_BOUNDS.menuSections) {
      throw new TypeError("Menu-section catalog evidence is missing or exceeds its bound.");
    }
    const packages = value.packages.map(normalizePackageCatalogRecord);
    if (new Set(packages.map((record) => record.id)).size !== packages.length) {
      throw new TypeError("Package catalog evidence contains duplicate ids.");
    }
    let itemCount = 0;
    const menuItems = value.menuSections.flatMap((sectionValue, sectionIndex) => {
      const sectionInput = safeRecord(sectionValue);
      if (!sectionInput) throw new TypeError(`menuSections[${sectionIndex}] is not a plain record.`);
      const section = {
        id: opaqueId(sectionInput.id),
        label: boundedText(sectionInput.name || sectionInput.label, AMBIENT_PACKAGE_MENU_BOUNDS.labelCharacters)
      };
      if (!section.id || !section.label || !Array.isArray(sectionInput.items)) {
        throw new TypeError(`menuSections[${sectionIndex}] lacks an exact id, label, or item list.`);
      }
      itemCount += sectionInput.items.length;
      if (itemCount > AMBIENT_PACKAGE_MENU_BOUNDS.menuItems) {
        throw new TypeError("Menu catalog evidence exceeds its item bound.");
      }
      return sectionInput.items.map((item, itemIndex) => (
        normalizeMenuCatalogRecord(item, section, sectionIndex, itemIndex)
      ));
    });
    if (new Set(menuItems.map((record) => record.id)).size !== menuItems.length) {
      throw new TypeError("Menu catalog evidence contains duplicate ids.");
    }
    return deepFreeze({
      state: freshness.state === "fresh"
        ? "current"
        : freshness.state === "stale"
          ? "stale"
          : "unknown",
      reason: freshness.state === "fresh"
        ? null
        : freshness.reason,
      organizationId,
      sourceLabel,
      catalogRevision,
      freshness,
      packages,
      menuItems
    });
  } catch (error) {
    return unavailableCatalogEvidence(
      `${error?.message || "Tenant catalog evidence is invalid"} No catalog record or draft candidate is used.`
    );
  }
}

function normalizeInclusionEntry(value, kind, index) {
  if (typeof value === "string") {
    const name = boundedText(value, AMBIENT_PACKAGE_MENU_BOUNDS.labelCharacters);
    return name
      ? {
          kind,
          id: null,
          name,
          state: "partial",
          reason: "This legacy saved inclusion has a name but no stable item id. No catalog match is inferred."
        }
      : null;
  }
  const input = safeRecord(value);
  if (!input) return null;
  const id = opaqueId(input.id, { optional: true }) || null;
  const name = boundedText(input.name, AMBIENT_PACKAGE_MENU_BOUNDS.labelCharacters);
  if (!name) return null;
  return {
    kind,
    id,
    name,
    state: id ? "available" : "partial",
    reason: id ? null : `Saved ${kind} inclusion ${index + 1} lacks a stable id. No catalog match is inferred.`
  };
}

function normalizeSavedInclusions(selection) {
  const source = safeRecord(selection?.packageInclusions);
  if (!source) {
    return deepFreeze({
      state: "missing",
      reason: "The saved quote does not contain a structured package-inclusion snapshot.",
      menuItems: [],
      addons: [],
      rentals: []
    });
  }
  let partial = false;
  const normalized = {};
  for (const kind of INCLUSION_KINDS) {
    if (!Array.isArray(source[kind])) {
      partial = true;
      normalized[kind] = [];
      continue;
    }
    if (source[kind].length > AMBIENT_PACKAGE_MENU_BOUNDS.packageInclusionsPerKind) {
      return deepFreeze({
        state: "partial",
        reason: `Saved ${kind} inclusions exceed the safe evidence bound; no truncated inclusions are presented.`,
        menuItems: [],
        addons: [],
        rentals: []
      });
    }
    const entries = source[kind].map((entry, index) => normalizeInclusionEntry(entry, kind, index));
    if (entries.some((entry) => !entry) || entries.some((entry) => entry?.state !== "available")) partial = true;
    const usable = entries.filter(Boolean);
    const stableIds = usable.map((entry) => entry.id).filter(Boolean);
    if (new Set(stableIds).size !== stableIds.length) partial = true;
    normalized[kind] = usable;
  }
  return deepFreeze({
    state: partial ? "partial" : "available",
    reason: partial
      ? "At least one saved inclusion list or stable inclusion identity is incomplete. No missing inclusion is inferred from the current catalog."
      : null,
    ...normalized
  });
}

function packageCatalogMatch(saved, catalog) {
  if (!saved.packageId) {
    return { state: "unavailable", record: null, reason: "The saved package has no stable id." };
  }
  if (catalog.state === "unavailable") {
    return { state: "unavailable", record: null, reason: catalog.reason };
  }
  const match = catalog.packages.find((record) => record.id === saved.packageId) || null;
  if (!match) {
    return {
      state: "missing",
      record: null,
      reason: "The exact saved package id is not present in the supplied tenant catalog evidence."
    };
  }
  if (saved.packageName && match.name !== saved.packageName) {
    return {
      state: "name_changed",
      record: match,
      reason: "The current catalog name differs from the saved quote snapshot; both are retained without replacing either."
    };
  }
  return {
    state: catalog.state === "current" ? "matched_current" : `matched_${catalog.state}`,
    record: match,
    reason: catalog.state === "current" ? null : catalog.reason
  };
}

function normalizeSavedPackage(quote, catalog) {
  const selection = safeRecord(quote?.selection) || {};
  const packageId = opaqueId(selection.packageId, { optional: true }) || "";
  const packageName = boundedText(
    selection.packageName,
    AMBIENT_PACKAGE_MENU_BOUNDS.labelCharacters,
    { optional: true }
  ) || "";
  const state = packageId && packageName
    ? "available"
    : packageId || packageName
      ? "partial"
      : "missing";
  const reason = state === "available"
    ? null
    : state === "partial"
      ? "The saved package identity is incomplete; both a stable id and saved name are required."
      : "The saved quote does not record a package id or name.";
  const inclusions = normalizeSavedInclusions(selection);
  const saved = { state, reason, packageId, packageName, inclusions };
  return deepFreeze({ ...saved, catalogMatch: packageCatalogMatch(saved, catalog) });
}

function normalizeQuantity(value) {
  if (!Number.isSafeInteger(value) || value < 1 || value > AMBIENT_PACKAGE_MENU_BOUNDS.quantity) {
    return null;
  }
  return value;
}

function snapshotMenuMap(selection) {
  const source = Array.isArray(selection.menuItemsSnapshot)
    ? selection.menuItemsSnapshot
    : Array.isArray(selection.menuItemDetails)
      ? selection.menuItemDetails
      : [];
  const map = new Map();
  let malformed = false;
  for (const entry of source) {
    const record = safeRecord(entry);
    const id = opaqueId(record?.id, { optional: true }) || "";
    if (!record || !id || map.has(id)) {
      malformed = true;
      continue;
    }
    const name = boundedText(record.name, AMBIENT_PACKAGE_MENU_BOUNDS.labelCharacters, { optional: true }) || "";
    map.set(id, {
      id,
      name,
      quantity: normalizeQuantity(record.quantity),
      includedInPackage: typeof record.includedInPackage === "boolean"
        ? record.includedInPackage
        : null
    });
  }
  return { map, malformed };
}

function selectedMenuIds(selection, snapshots) {
  const explicit = Array.isArray(selection.menuItems) ? selection.menuItems : null;
  if (explicit) {
    return {
      ids: explicit.map((entry) => opaqueId(
        typeof entry === "string" ? entry : safeRecord(entry)?.id,
        { optional: true }
      ) || ""),
      source: "selection.menuItems",
      malformed: false
    };
  }
  return {
    ids: [...snapshots.map.keys()],
    source: "selection.menuItemsSnapshot",
    malformed: snapshots.map.size === 0
  };
}

function normalizeQuantityMap(selection) {
  const source = safeRecord(selection.menuItemQuantities);
  if (!source) return { values: new Map(), malformed: false };
  const entries = Object.entries(source);
  if (entries.length > AMBIENT_PACKAGE_MENU_BOUNDS.selectedMenuItems) {
    return { values: new Map(), malformed: true };
  }
  const values = new Map();
  let malformed = false;
  for (const [rawId, rawQuantity] of entries) {
    const id = opaqueId(rawId, { optional: true }) || "";
    const quantity = normalizeQuantity(rawQuantity);
    if (!id || quantity === null) {
      malformed = true;
      continue;
    }
    values.set(id, quantity);
  }
  return { values, malformed };
}

function normalizeSavedMenu(quote, catalog, packageSelection) {
  const selection = safeRecord(quote?.selection) || {};
  const snapshots = snapshotMenuMap(selection);
  const selected = selectedMenuIds(selection, snapshots);
  const quantityMap = normalizeQuantityMap(selection);
  const nameList = Array.isArray(selection.menuItemNames) ? selection.menuItemNames : [];
  if (selected.ids.length > AMBIENT_PACKAGE_MENU_BOUNDS.selectedMenuItems) {
    return deepFreeze({
      state: "partial",
      reason: "The saved menu exceeds the safe evidence bound; no truncated menu is presented.",
      source: selected.source,
      items: [],
      order: [],
      allCatalogMatched: false,
      quantitiesComplete: false
    });
  }
  const inclusionIds = new Set(
    packageSelection.inclusions.menuItems.map((entry) => entry.id).filter(Boolean)
  );
  let partial = selected.malformed || snapshots.malformed || quantityMap.malformed;
  const seen = new Set();
  const items = selected.ids.map((id, orderIndex) => {
    if (!id || seen.has(id)) partial = true;
    if (id) seen.add(id);
    const snapshot = id ? snapshots.map.get(id) : null;
    const savedName = snapshot?.name
      || boundedText(nameList[orderIndex], AMBIENT_PACKAGE_MENU_BOUNDS.labelCharacters, { optional: true })
      || "";
    const quantity = id && quantityMap.values.has(id)
      ? quantityMap.values.get(id)
      : snapshot?.quantity ?? null;
    if (!savedName || quantity === null) partial = true;
    const catalogRecord = id
      ? catalog.menuItems.find((record) => record.id === id) || null
      : null;
    const catalogMatch = !id
      ? { state: "unavailable", reason: "The saved menu item has no stable id." }
      : catalog.state === "unavailable"
        ? { state: "unavailable", reason: catalog.reason }
        : !catalogRecord
          ? { state: "missing", reason: "The exact saved menu item id is not present in the supplied catalog evidence." }
          : savedName && catalogRecord.name !== savedName
            ? { state: "name_changed", reason: "The current catalog name differs from the saved quote snapshot." }
            : { state: catalog.state === "current" ? "matched_current" : `matched_${catalog.state}`, reason: catalog.reason };
    if (!["matched_current", "matched_stale", "matched_unknown"].includes(catalogMatch.state)) partial = true;
    const explicitIncluded = snapshot?.includedInPackage;
    const includedByPackageSnapshot = Boolean(id && inclusionIds.has(id));
    const inclusionConflict = explicitIncluded === false && includedByPackageSnapshot;
    if (inclusionConflict) partial = true;
    const includedInPackage = inclusionConflict
      ? null
      : explicitIncluded === true || includedByPackageSnapshot
        ? true
        : explicitIncluded === false
          ? false
          : null;
    return {
      id: id || null,
      savedName: savedName || null,
      quantity,
      quantityState: quantity === null ? "missing" : "available",
      orderIndex,
      includedInPackage,
      packageInclusionEvidence: inclusionConflict
        ? "conflicting_saved_evidence"
        : includedInPackage === null
          ? "not_recorded"
          : snapshot?.includedInPackage === includedInPackage
            ? "saved_menu_snapshot"
            : "saved_package_inclusion_snapshot",
      packageInclusionReason: inclusionConflict
        ? "The saved menu snapshot says this item is not package-included while the saved package-inclusion snapshot contains its exact id. No precedence is inferred."
        : null,
      catalogMatch,
      currentCatalogRecord: catalogRecord
        ? {
            id: catalogRecord.id,
            name: catalogRecord.name,
            section: catalogRecord.section,
            catalogActive: catalogRecord.catalogActive,
            operationalAvailability: "not_evaluated"
          }
        : null
    };
  });
  const state = items.length === 0
    ? "missing"
    : partial
      ? "partial"
      : "available";
  return deepFreeze({
    state,
    reason: state === "missing"
      ? "The saved quote does not record a menu selection."
      : state === "partial"
        ? "At least one saved menu identity, name, quantity, order, inclusion link, or current catalog match is incomplete. No missing value is inferred."
        : null,
    source: selected.source,
    items,
    order: items.map((item) => item.id).filter(Boolean),
    allCatalogMatched: items.length > 0 && items.every((item) => item.catalogMatch.state === "matched_current"),
    quantitiesComplete: items.length > 0 && items.every((item) => item.quantity !== null)
  });
}

function boundedCandidates(records, maximum, mapRecord) {
  const candidates = records.map(mapRecord);
  return deepFreeze({
    total: candidates.length,
    returned: Math.min(candidates.length, maximum),
    truncated: candidates.length > maximum,
    items: candidates.slice(0, maximum)
  });
}

function packageReplacementCandidates(saved, catalog) {
  if (catalog.state === "unavailable") return boundedCandidates([], AMBIENT_PACKAGE_MENU_BOUNDS.packageReplacementCandidates, (item) => item);
  return boundedCandidates(
    catalog.packages.filter((record) => record.id !== saved.packageId),
    AMBIENT_PACKAGE_MENU_BOUNDS.packageReplacementCandidates,
    (record) => ({
      id: record.id,
      name: record.name,
      catalogActive: record.catalogActive,
      draftReplacementEligible: catalog.state === "current" && record.catalogActive === true,
      declaredInclusionIds: record.declaredInclusionIds,
      operationalAvailability: "not_evaluated"
    })
  );
}

function menuReplacementCandidates(saved, catalog) {
  if (catalog.state === "unavailable") return boundedCandidates([], AMBIENT_PACKAGE_MENU_BOUNDS.menuReplacementCandidates, (item) => item);
  const selectedIds = new Set(saved.order);
  return boundedCandidates(
    catalog.menuItems.filter((record) => !selectedIds.has(record.id)),
    AMBIENT_PACKAGE_MENU_BOUNDS.menuReplacementCandidates,
    (record) => ({
      id: record.id,
      name: record.name,
      section: record.section,
      catalogActive: record.catalogActive,
      draftReplacementEligible: catalog.state === "current" && record.catalogActive === true,
      operationalAvailability: "not_evaluated"
    })
  );
}

function catalogDependency(catalog, objectId) {
  return {
    object: {
      id: `${objectId}-tenant-catalog`,
      type: "catalog-evidence",
      label: "Current tenant catalog evidence"
    },
    relationship: `${objectId}_references_current_tenant_catalog`,
    consequence: catalog.state === "current"
      ? `Catalog revision ${catalog.catalogRevision} from ${catalog.sourceLabel} was explicitly supplied as fresh evidence. Its active flags do not establish operational availability.`
      : `Catalog evidence is ${catalog.state}: ${catalog.reason || "no current-catalog claim is available"} No replacement authority or availability is inferred.`
  };
}

function packageDependencies(saved, catalog) {
  return [
    catalogDependency(catalog, "package"),
    {
      object: { id: "package-inclusions", type: "saved-quote-evidence", label: "Recorded package inclusions" },
      relationship: "package_contains_recorded_inclusions",
      consequence: saved.inclusions.state === "available"
        ? "The inspector can show the exact inclusion snapshots stored with this quote."
        : `${saved.inclusions.reason} Today's catalog is not used to reconstruct the saved inclusion list.`
    },
    {
      object: { id: "menu", type: "intelligent-object", label: "Saved menu" },
      relationship: "package_can_change_menu_dependencies",
      consequence: "A package replacement may affect the menu and service plan. This view does not calculate pricing or operational effects."
    }
  ];
}

function menuDependencies(saved, packageSaved, catalog) {
  return [
    catalogDependency(catalog, "menu"),
    {
      object: { id: "package", type: "intelligent-object", label: "Saved package" },
      relationship: "menu_may_reference_saved_package_inclusions",
      consequence: packageSaved.inclusions.state === "available"
        ? "Package-inclusion labels are attached only by exact saved ids or explicit saved menu flags."
        : "Package-inclusion evidence is incomplete; no inclusion relationship is inferred by name."
    },
    {
      object: { id: "menu-order-and-quantity", type: "saved-quote-evidence", label: "Menu order and quantities" },
      relationship: "menu_preserves_saved_order_and_explicit_quantities",
      consequence: saved.state === "available"
        ? "The exact saved order and explicit quantities can seed draft-only manipulation intents."
        : `${saved.reason} Missing quantities or item identities stay unresolved.`
    }
  ];
}

function catalogProvenance(catalog, objectId) {
  const state = catalog.state === "current"
    ? "available"
    : catalog.state === "stale"
      ? "stale"
      : "unavailable";
  return {
    sourceId: `${objectId}:tenant-catalog`,
    label: catalog.sourceLabel || "Tenant catalog evidence unavailable",
    type: "tenant-catalog-evidence",
    state,
    observedAt: catalog.freshness.observedAt,
    ...(state === "available" ? {} : { reason: catalog.reason || catalog.freshness.reason })
  };
}

function savedProvenance(identity, objectId, label, state, reason) {
  return {
    sourceId: `quote:${identity.quoteId || "selected"}:${objectId}`,
    label,
    type: "saved-quote-selection",
    state: state === "available" ? "available" : "unavailable",
    observedAt: identity.observedAt,
    ...(state === "available" ? {} : { reason })
  };
}

function packageConfidence(saved, catalog, staffRole) {
  if (!staffRole || saved.state === "missing") {
    return {
      level: "unavailable",
      basis: !staffRole
        ? "Staff role is required to inspect internal package and catalog evidence."
        : saved.reason
    };
  }
  const exact = saved.state === "available"
    && saved.inclusions.state === "available"
    && saved.catalogMatch.state === "matched_current";
  return {
    level: exact ? "high" : catalog.state === "unavailable" ? "low" : "medium",
    basis: exact
      ? "The saved package identity and inclusion snapshots are exact, and the explicitly supplied same-tenant catalog evidence is fresh. This confidence does not cover price, margin, or availability."
      : `${saved.reason || saved.inclusions.reason || saved.catalogMatch.reason || catalog.reason} Confidence applies only to evidence that is explicitly present.`
  };
}

function menuConfidence(saved, catalog, staffRole) {
  if (!staffRole || saved.state === "missing") {
    return {
      level: "unavailable",
      basis: !staffRole
        ? "Staff role is required to inspect internal menu and catalog evidence."
        : saved.reason
    };
  }
  const exact = saved.state === "available" && saved.allCatalogMatched && saved.quantitiesComplete;
  return {
    level: exact ? "high" : catalog.state === "unavailable" ? "low" : "medium",
    basis: exact
      ? "Every saved menu item has an exact identity, explicit quantity and order, and a match in fresh same-tenant catalog evidence. This confidence does not cover price, margin, or availability."
      : `${saved.reason || catalog.reason || "Some menu evidence is incomplete."} Confidence applies only to explicit saved and catalog evidence.`
  };
}

function commonIntentContext(identity, catalog) {
  return {
    quoteId: identity.quoteId,
    organizationId: identity.organizationId,
    baseRevisionId: identity.revisionId,
    catalogRevision: catalog.catalogRevision,
    catalogSourceLabel: catalog.sourceLabel,
    catalogObservedAt: catalog.freshness.observedAt
  };
}

function packageIntentContract({ allowed, reason, identity, catalog, candidates }) {
  return deepFreeze({
    actionId: OBJECT_DEFINITIONS.package.replaceActionId,
    kind: "replace_package",
    enabled: allowed,
    reason,
    authority: "draft_only",
    commit: false,
    target: {
      objectId: "package",
      fieldPaths: ["selection.packageId", "selection.packageName"],
      trustedReconciliationRequired: ["selection.packageInclusions"]
    },
    candidateIds: candidates.items
      .filter((candidate) => candidate.draftReplacementEligible)
      .map((candidate) => candidate.id),
    baseContext: allowed ? commonIntentContext(identity, catalog) : null,
    consequencePreviewRequired: true,
    requiresOutcomeNamedSave: true
  });
}

function menuIntentContracts({ replaceAllowed, reorderAllowed, reasons, identity, catalog, candidates }) {
  return deepFreeze({
    replace: {
      actionId: OBJECT_DEFINITIONS.menu.replaceActionId,
      kind: "replace_menu_item",
      enabled: replaceAllowed,
      reason: reasons.replace,
      authority: "draft_only",
      commit: false,
      target: {
        objectId: "menu",
        fieldPaths: ["selection.menuItems", "selection.menuItemQuantities"],
        trustedReconciliationRequired: [
          "selection.menuItemsSnapshot",
          "selection.menuItemNames",
          "selection.packageInclusions"
        ]
      },
      candidateIds: candidates.items
        .filter((candidate) => candidate.draftReplacementEligible)
        .map((candidate) => candidate.id),
      baseContext: replaceAllowed ? commonIntentContext(identity, catalog) : null,
      consequencePreviewRequired: true,
      requiresOutcomeNamedSave: true
    },
    reorder: {
      actionId: OBJECT_DEFINITIONS.menu.reorderActionId,
      kind: "reorder_menu",
      enabled: reorderAllowed,
      reason: reasons.reorder,
      authority: "draft_only",
      commit: false,
      target: {
        objectId: "menu",
        fieldPaths: ["selection.menuItems"],
        trustedReconciliationRequired: [
          "selection.menuItemsSnapshot",
          "selection.menuItemNames"
        ]
      },
      baseContext: reorderAllowed ? commonIntentContext(identity, catalog) : null,
      interactionSemantics: AMBIENT_MENU_REORDER_INTERACTION_SEMANTICS,
      consequencePreviewRequired: true,
      requiresOutcomeNamedSave: true
    }
  });
}

function roleBoundary(role, ordinaryEditAllowed, stageAllowed) {
  const staffRole = STAFF_ROLES.has(role);
  return deepFreeze({
    role: staffRole ? role : "non_staff",
    staffRole,
    ordinaryEditAllowed: ordinaryEditAllowed === true,
    draftIntentAllowed: stageAllowed
  });
}

function buildPackageObject(quote, options, identity, catalog) {
  const role = boundedText(options.role, 32, { optional: true })?.toLowerCase() || "non_staff";
  const staffRole = STAFF_ROLES.has(role);
  const saved = staffRole
    ? normalizeSavedPackage(quote, catalog)
    : deepFreeze({
        state: "unavailable",
        reason: "Staff role is required; saved package and catalog details are withheld.",
        packageId: "",
        packageName: "",
        inclusions: { state: "missing", reason: "Withheld for non-staff role.", menuItems: [], addons: [], rentals: [] },
        catalogMatch: { state: "unavailable", record: null, reason: "Withheld for non-staff role." }
      });
  const candidates = staffRole
    ? packageReplacementCandidates(saved, catalog)
    : boundedCandidates([], AMBIENT_PACKAGE_MENU_BOUNDS.packageReplacementCandidates, (item) => item);
  const eligibleCandidates = candidates.items.filter((candidate) => candidate.draftReplacementEligible);
  const intentAllowed = staffRole
    && options.ordinaryEditAllowed === true
    && Boolean(identity.quoteId && identity.organizationId && identity.revisionId)
    && saved.state === "available"
    && catalog.state === "current"
    && eligibleCandidates.length > 0;
  const intentReason = intentAllowed
    ? "This current catalog option can be reviewed as a draft replacement; nothing is saved or repriced here."
    : !staffRole
      ? "Staff role is required to inspect or stage package changes."
      : options.ordinaryEditAllowed !== true
        ? "The selected quote lifecycle or role is view-only."
        : !identity.revisionId
          ? "Draft replacement requires an exact saved quote revision."
          : saved.state !== "available"
            ? saved.reason
            : catalog.state !== "current"
              ? `Draft replacement requires explicitly fresh same-tenant catalog evidence; catalog state is ${catalog.state}.`
              : "No active replacement is available in the catalog options reviewed here.";
  const intentContract = packageIntentContract({
    allowed: intentAllowed,
    reason: intentReason,
    identity,
    catalog,
    candidates
  });
  const permissions = {
    view: staffRole,
    simulate: false,
    stage: intentAllowed,
    commit: false,
    reason: intentAllowed
      ? "Only a draft replacement intent is available; simulation and commit authority remain unavailable."
      : intentReason
  };
  const descriptor = createIntelligentObjectDescriptor({
    id: "package",
    type: "intelligent-object",
    label: "Package",
    summary: saved.state === "available"
      ? `${saved.packageName} is recorded as the selected package.`
      : `Package evidence is ${saved.state}: ${saved.reason}`,
    inspectorSurfaceId: OBJECT_DEFINITIONS.package.inspectorSurfaceId,
    dependencies: packageDependencies(saved, catalog),
    why: saved.state === "available"
      ? `The saved quote records package ${saved.packageName} (${saved.packageId}). Its recorded inclusions and current catalog match are shown separately so today's catalog never rewrites the saved quote.`
      : `The package object remains visible to clarify why exact saved selection evidence is unavailable. ${saved.reason}`,
    consequence: "Replacing the package can affect the menu, service plan, pricing, and operations. This action only prepares a draft change; it does not calculate price or margin, confirm availability or reservations, or save anything.",
    doNothing: saved.state === "available"
      ? `${saved.packageName} remains the saved package. Current-catalog differences and incomplete inclusion evidence remain unresolved without changing the quote.`
      : "The saved quote remains unchanged; no package is guessed from its name, current catalog order, or another quote.",
    confidence: packageConfidence(saved, catalog, staffRole),
    provenance: [
      savedProvenance(identity, "package", "Selected saved quote package", saved.state, saved.reason),
      savedProvenance(
        identity,
        "package-inclusions",
        "Saved package-inclusion snapshot",
        saved.inclusions.state,
        saved.inclusions.reason
      ),
      catalogProvenance(catalog, "package")
    ],
    recommendation: null,
    permissions,
    actionIds: intentAllowed
      ? [OBJECT_DEFINITIONS.package.inspectActionId, OBJECT_DEFINITIONS.package.replaceActionId]
      : [OBJECT_DEFINITIONS.package.inspectActionId]
  });
  return deepFreeze({
    ...descriptor,
    modelId: AMBIENT_PACKAGE_MENU_MODEL,
    savedSelection: saved,
    recordedInclusions: saved.inclusions,
    currentCatalogRecord: saved.catalogMatch.record,
    replacementCandidates: candidates,
    intentContract,
    presentationAuthority: "advisory",
    operationalAvailability: {
      state: "not_evaluated",
      reason: "Catalog membership and active flags do not establish inventory, venue, service, or event availability."
    },
    roleBoundary: roleBoundary(role, options.ordinaryEditAllowed, intentAllowed)
  });
}

function buildMenuObject(quote, options, identity, catalog, packageObject) {
  const role = boundedText(options.role, 32, { optional: true })?.toLowerCase() || "non_staff";
  const staffRole = STAFF_ROLES.has(role);
  const saved = staffRole
    ? normalizeSavedMenu(quote, catalog, packageObject.savedSelection)
    : deepFreeze({
        state: "unavailable",
        reason: "Staff role is required; saved menu and catalog details are withheld.",
        source: null,
        items: [],
        order: [],
        allCatalogMatched: false,
        quantitiesComplete: false
      });
  const candidates = staffRole
    ? menuReplacementCandidates(saved, catalog)
    : boundedCandidates([], AMBIENT_PACKAGE_MENU_BOUNDS.menuReplacementCandidates, (item) => item);
  const commonAllowed = staffRole
    && options.ordinaryEditAllowed === true
    && Boolean(identity.quoteId && identity.organizationId && identity.revisionId)
    && catalog.state === "current";
  const replaceAllowed = commonAllowed
    && saved.state === "available"
    && saved.quantitiesComplete
    && candidates.items.some((candidate) => candidate.draftReplacementEligible);
  const reorderAllowed = commonAllowed
    && saved.state === "available"
    && saved.allCatalogMatched
    && saved.order.length >= 2;
  const commonReason = !staffRole
    ? "Staff role is required to inspect or stage menu changes."
    : options.ordinaryEditAllowed !== true
      ? "The selected quote lifecycle or role is view-only."
      : !identity.revisionId
        ? "Draft manipulation requires an exact saved quote revision."
        : catalog.state !== "current"
          ? `Draft manipulation requires explicitly fresh same-tenant catalog evidence; catalog state is ${catalog.state}.`
          : "";
  const replaceReason = replaceAllowed
    ? "An exact selected item, explicit quantity, and fresh catalog candidate can form a draft-only replacement intent."
    : commonReason || (!saved.quantitiesComplete
        ? "Every replaced menu item requires an explicit saved quantity; no default quantity is inferred."
        : saved.state !== "available"
          ? saved.reason
          : "No active replacement is available in the catalog options reviewed here.");
  const reorderReason = reorderAllowed
    ? "The exact saved order can form equivalent pointer or keyboard draft-only reorder intents."
    : commonReason || (!saved.allCatalogMatched
        ? "Every reordered item must have an exact match in fresh same-tenant catalog evidence."
        : saved.state !== "available"
          ? saved.reason
          : "At least two exact saved menu items are required for reorder intent metadata.");
  const intentContracts = menuIntentContracts({
    replaceAllowed,
    reorderAllowed,
    reasons: { replace: replaceReason, reorder: reorderReason },
    identity,
    catalog,
    candidates
  });
  const stageAllowed = replaceAllowed || reorderAllowed;
  const permissions = {
    view: staffRole,
    simulate: false,
    stage: stageAllowed,
    commit: false,
    reason: stageAllowed
      ? "Only draft replacement or reordering is available here; pricing and saved changes remain unavailable."
      : `${replaceReason} ${reorderReason}`
  };
  const descriptor = createIntelligentObjectDescriptor({
    id: "menu",
    type: "intelligent-object",
    label: "Menu",
    summary: saved.state === "available"
      ? `${saved.items.length} saved menu ${saved.items.length === 1 ? "item" : "items"} retain exact order and explicit quantities.`
      : `Menu evidence is ${saved.state}: ${saved.reason}`,
    inspectorSurfaceId: OBJECT_DEFINITIONS.menu.inspectorSurfaceId,
    dependencies: menuDependencies(saved, packageObject.savedSelection, catalog),
    why: saved.state === "available"
      ? "The menu object exposes the exact saved item order, quantities, package-inclusion links, and current catalog matches. It never resolves an item by name or silently substitutes today's catalog record."
      : `The menu object remains visible to clarify incomplete saved selection evidence. ${saved.reason}`,
    consequence: "Replacing or reordering menu items can affect the package, service plan, pricing, and operations. This action only prepares a draft change; it does not calculate price or margin, confirm availability or preparation, or save anything.",
    doNothing: saved.state === "available"
      ? "The saved menu order, explicit quantities, and package-inclusion evidence remain unchanged."
      : "The saved quote remains unchanged; no missing menu identity, quantity, order, or catalog record is invented.",
    confidence: menuConfidence(saved, catalog, staffRole),
    provenance: [
      savedProvenance(identity, "menu", "Selected saved quote menu", saved.state, saved.reason),
      savedProvenance(
        identity,
        "menu-quantities-order",
        "Saved menu quantities and order",
        saved.state,
        saved.reason
      ),
      catalogProvenance(catalog, "menu")
    ],
    recommendation: null,
    permissions,
    actionIds: [
      OBJECT_DEFINITIONS.menu.inspectActionId,
      ...(replaceAllowed ? [OBJECT_DEFINITIONS.menu.replaceActionId] : []),
      ...(reorderAllowed ? [OBJECT_DEFINITIONS.menu.reorderActionId] : [])
    ]
  });
  return deepFreeze({
    ...descriptor,
    modelId: AMBIENT_PACKAGE_MENU_MODEL,
    savedSelection: saved,
    items: saved.items,
    order: saved.order,
    replacementCandidates: candidates,
    intentContracts,
    presentationAuthority: "advisory",
    operationalAvailability: {
      state: "not_evaluated",
      reason: "Catalog membership and active flags do not establish inventory, venue, service, or event availability."
    },
    roleBoundary: roleBoundary(role, options.ordinaryEditAllowed, stageAllowed)
  });
}

export function buildAmbientPackageMenuObjects(quote = {}, options = {}) {
  const identity = quoteIdentity(quote);
  const catalog = normalizeCatalogEvidence(options.catalogEvidence, identity.organizationId);
  const packageObject = buildPackageObject(quote, options, identity, catalog);
  const menuObject = buildMenuObject(quote, options, identity, catalog, packageObject);
  return deepFreeze({
    modelId: AMBIENT_PACKAGE_MENU_MODEL,
    quoteIdentity: identity,
    catalogEvidence: catalog,
    package: packageObject,
    menu: menuObject
  });
}

export function buildAmbientPackageMenuObject(kind, quote = {}, options = {}) {
  if (!AMBIENT_PACKAGE_MENU_OBJECT_KINDS.includes(kind)) {
    throw new TypeError(`Unsupported ambient package/menu object kind: ${String(kind)}`);
  }
  return buildAmbientPackageMenuObjects(quote, options)[kind];
}

function unavailableIntent(kind, code, reason) {
  return deepFreeze({
    ok: false,
    schemaVersion: AMBIENT_PACKAGE_MENU_INTENT_SCHEMA_VERSION,
    kind,
    code,
    reason,
    consequence: "No draft field, saved quote, catalog record, price, margin, or availability evidence changed."
  });
}

function exactIntentObject(value, expectedId) {
  return value
    && value.id === expectedId
    && value.presentationAuthority === "advisory"
    && value.permissions?.commit === false
    ? value
    : null;
}

export function createAmbientPackageReplacementIntent(packageObject, replacementPackageId) {
  const object = exactIntentObject(packageObject, "package");
  if (!object?.intentContract?.enabled) {
    return unavailableIntent("replace_package", "intent_unavailable", object?.intentContract?.reason || "Package intent metadata is unavailable.");
  }
  const replacementId = opaqueId(replacementPackageId, { optional: true }) || "";
  const candidate = object.replacementCandidates.items.find((entry) => (
    entry.id === replacementId && entry.draftReplacementEligible
  ));
  if (!candidate) {
    return unavailableIntent("replace_package", "candidate_unavailable", "The requested package does not exactly match an eligible catalog choice available here.");
  }
  return deepFreeze({
    ok: true,
    schemaVersion: AMBIENT_PACKAGE_MENU_INTENT_SCHEMA_VERSION,
    kind: "replace_package",
    actionId: object.intentContract.actionId,
    authority: "draft_only",
    commit: false,
    baseContext: object.intentContract.baseContext,
    target: object.intentContract.target,
    before: { packageId: object.savedSelection.packageId },
    proposed: { packageId: candidate.id, packageName: candidate.name },
    candidate: {
      id: candidate.id,
      name: candidate.name,
      catalogActive: candidate.catalogActive,
      operationalAvailability: "not_evaluated"
    },
    consequencePreviewRequired: true,
    requiresOutcomeNamedSave: true
  });
}

export function createAmbientMenuReplacementIntent(menuObject, input = {}) {
  const object = exactIntentObject(menuObject, "menu");
  if (!object?.intentContracts?.replace?.enabled) {
    return unavailableIntent("replace_menu_item", "intent_unavailable", object?.intentContracts?.replace?.reason || "Menu replacement intent metadata is unavailable.");
  }
  const selectedItemId = opaqueId(input.selectedItemId, { optional: true }) || "";
  const replacementItemId = opaqueId(input.replacementItemId, { optional: true }) || "";
  const selected = object.items.find((entry) => entry.id === selectedItemId) || null;
  const candidate = object.replacementCandidates.items.find((entry) => (
    entry.id === replacementItemId && entry.draftReplacementEligible
  )) || null;
  if (!selected || !candidate || selected.quantity === null) {
    return unavailableIntent(
      "replace_menu_item",
      "selection_or_candidate_unavailable",
      "Menu replacement needs the exact selected item, its saved quantity, and an exact eligible catalog choice available here."
    );
  }
  return deepFreeze({
    ok: true,
    schemaVersion: AMBIENT_PACKAGE_MENU_INTENT_SCHEMA_VERSION,
    kind: "replace_menu_item",
    actionId: object.intentContracts.replace.actionId,
    authority: "draft_only",
    commit: false,
    baseContext: object.intentContracts.replace.baseContext,
    target: object.intentContracts.replace.target,
    before: {
      itemId: selected.id,
      orderIndex: selected.orderIndex,
      quantity: selected.quantity
    },
    proposed: {
      itemId: candidate.id,
      orderIndex: selected.orderIndex,
      quantity: selected.quantity,
      quantityPolicy: "preserve_explicit_saved_quantity"
    },
    candidate: {
      id: candidate.id,
      name: candidate.name,
      section: candidate.section,
      catalogActive: candidate.catalogActive,
      operationalAvailability: "not_evaluated"
    },
    consequencePreviewRequired: true,
    requiresOutcomeNamedSave: true
  });
}

export function createAmbientMenuReorderIntent(menuObject, input = {}) {
  const object = exactIntentObject(menuObject, "menu");
  if (!object?.intentContracts?.reorder?.enabled) {
    return unavailableIntent("reorder_menu", "intent_unavailable", object?.intentContracts?.reorder?.reason || "Menu reorder intent metadata is unavailable.");
  }
  const itemId = opaqueId(input.itemId, { optional: true }) || "";
  const interaction = boundedText(input.interaction, 16, { optional: true }) || "";
  const toIndex = input.toIndex;
  const fromIndex = object.order.indexOf(itemId);
  if (
    !["pointer", "keyboard"].includes(interaction)
    || fromIndex < 0
    || !Number.isSafeInteger(toIndex)
    || toIndex < 0
    || toIndex >= object.order.length
    || toIndex === fromIndex
  ) {
    return unavailableIntent(
      "reorder_menu",
      "reorder_target_invalid",
      "Reorder intent requires one exact saved item, a different in-range destination, and an explicit pointer or keyboard interaction."
    );
  }
  const proposedOrder = [...object.order];
  const [moved] = proposedOrder.splice(fromIndex, 1);
  proposedOrder.splice(toIndex, 0, moved);
  return deepFreeze({
    ok: true,
    schemaVersion: AMBIENT_PACKAGE_MENU_INTENT_SCHEMA_VERSION,
    kind: "reorder_menu",
    actionId: object.intentContracts.reorder.actionId,
    authority: "draft_only",
    commit: false,
    baseContext: object.intentContracts.reorder.baseContext,
    target: object.intentContracts.reorder.target,
    itemId,
    fromIndex,
    toIndex,
    beforeOrder: [...object.order],
    proposedOrder,
    interaction,
    interactionSemantics: object.intentContracts.reorder.interactionSemantics,
    consequencePreviewRequired: true,
    requiresOutcomeNamedSave: true
  });
}
