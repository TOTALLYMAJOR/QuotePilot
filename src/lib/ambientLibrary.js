import {
  createAmbientAction,
  createIntelligentObjectDescriptor,
  createSurfacePurposeContract
} from "./ambientContracts";
import { isCatalogPricingConfirmationCurrent } from "./catalogPricingConfirmation";

/**
 * Pure, fail-closed projection for the role-safe Ambient Library.
 *
 * The caller owns authentication, organization scoping, catalog reads, and
 * every mutation. This module performs no I/O and grants no authority. It
 * withholds catalog records until the caller supplies an exact organization,
 * an admin role, a recognized completed source, and a completion timestamp.
 */
export const AMBIENT_LIBRARY_MODEL = "ambient-library-v1";

export const AMBIENT_LIBRARY_SURFACE_CONTRACT = createSurfacePurposeContract({
  id: "ambient-library",
  objectScopes: [
    "tenant-catalog",
    "catalog-section",
    "event-template",
    "pricing-settings",
    "configuration-rules"
  ],
  purposes: ["clarify", "advance", "resolve", "reveal_context"],
  entryReason: "Show an administrator what the current catalog contains, what its templates depend on, and the next exact place that needs review.",
  allowedEmptyState: {
    kind: "starting_action",
    message: "This completed organization-scoped catalog has no usable starting records yet.",
    actionId: "start-library-setup"
  },
  recoveryBehavior: {
    message: "Keep the last completed organization-scoped catalog visible and refresh that same Library context.",
    nextActionIds: ["refresh-library"]
  }
});

export const AMBIENT_LIBRARY_BOUNDS = Object.freeze({
  packages: 500,
  menuSections: 100,
  menuItems: 2_000,
  addons: 500,
  rentals: 500,
  templates: 250,
  rules: 500,
  referencesPerTemplate: 500,
  idCharacters: 160,
  labelCharacters: 240,
  issueCharacters: 500
});

export const AMBIENT_LIBRARY_SECTION_ORDER = Object.freeze([
  "packages",
  "menu",
  "addons",
  "rentals",
  "templates",
  "pricing",
  "rules"
]);

const SECTION_DEFINITIONS = Object.freeze({
  packages: Object.freeze({ label: "Packages", singular: "package", targetId: "packages" }),
  menu: Object.freeze({ label: "Menu", singular: "menu item", targetId: "menu" }),
  addons: Object.freeze({ label: "Add-ons", singular: "add-on", targetId: "addons" }),
  rentals: Object.freeze({ label: "Rentals", singular: "rental", targetId: "rentals" }),
  pricing: Object.freeze({ label: "Pricing", singular: "pricing setting", targetId: "pricing" }),
  templates: Object.freeze({ label: "Templates", singular: "event template", targetId: "eventTemplates" }),
  rules: Object.freeze({ label: "Rules", singular: "configuration rule", targetId: "rules" })
});

const RECOGNIZED_FIREBASE_SOURCES = new Set([
  "firebase",
  "firebase-org",
  "firebase-org-empty"
]);
const RECOGNIZED_LOCAL_SOURCES = new Set([
  "local-cache",
  "local-defaults",
  "fallback-defaults"
]);
const UNAVAILABLE_SOURCES = new Set(["auth-required", "firebase-required"]);
const FORBIDDEN_RECORD_KEYS = new Set(["__proto__", "prototype", "constructor"]);

function deepFreeze(value, seen = new WeakSet()) {
  if (!value || typeof value !== "object" || seen.has(value)) return value;
  seen.add(value);
  Reflect.ownKeys(value).forEach((key) => deepFreeze(value[key], seen));
  return Object.freeze(value);
}

function isRecord(value) {
  if (!value || typeof value !== "object" || Array.isArray(value)) return false;
  const prototype = Object.getPrototypeOf(value);
  return (prototype === Object.prototype || prototype === null)
    && !Object.keys(value).some((key) => FORBIDDEN_RECORD_KEYS.has(key));
}

function text(value, maximum = AMBIENT_LIBRARY_BOUNDS.issueCharacters) {
  if (typeof value !== "string") return "";
  return value.trim().slice(0, maximum);
}

function safeId(value) {
  const normalized = text(value, AMBIENT_LIBRARY_BOUNDS.idCharacters);
  if (
    !normalized
    || /[\u0000-\u001f\u007f/?#\\]/u.test(normalized)
    || normalized === "."
    || normalized === ".."
  ) return "";
  return normalized;
}

function exactIso(value) {
  const normalized = text(value, 64);
  if (!normalized) return null;
  const parsed = new Date(normalized);
  return Number.isNaN(parsed.getTime()) || parsed.toISOString() !== normalized
    ? null
    : normalized;
}

function nonNegativeInteger(value) {
  const parsed = Number(value);
  return Number.isSafeInteger(parsed) && parsed >= 0 ? parsed : null;
}

function normalizeCapabilities(value) {
  const input = isRecord(value) ? value : {};
  return {
    openSection: input.openSection === true,
    openTemplate: input.openTemplate === true,
    refresh: input.refresh === true
  };
}

function sourceKind(rawSource) {
  if (RECOGNIZED_FIREBASE_SOURCES.has(rawSource)) return "firebase";
  if (RECOGNIZED_LOCAL_SOURCES.has(rawSource)) return "local";
  if (UNAVAILABLE_SOURCES.has(rawSource)) return "unavailable";
  return "unknown";
}

function sourceLabel(kind, rawSource) {
  if (kind === "firebase") return "Organization staff catalog";
  if (rawSource === "local-cache") return "Catalog saved in this browser";
  if (rawSource === "local-defaults") return "Local development catalog";
  if (rawSource === "fallback-defaults") return "Local recovery catalog";
  if (rawSource === "auth-required") return "Signed-in administrator required";
  if (rawSource === "firebase-required") return "Organization catalog connection required";
  return "Catalog source not confirmed";
}

function sourceBoundary(kind, rawSource) {
  if (kind === "firebase") {
    return "These records came from the selected organization’s staff catalog. This projection does not save changes, reprice quotes, or prove operational availability.";
  }
  if (kind === "local") {
    return "These records are available only in this browser or local development fallback. They are not proof of the organization’s server catalog, current pricing authority, or operational availability.";
  }
  if (rawSource === "auth-required") {
    return "Catalog records are withheld because an authenticated administrator context was not supplied.";
  }
  if (rawSource === "firebase-required") {
    return "Catalog records are withheld because this environment requires the organization catalog connection.";
  }
  return "Catalog records are withheld because their source could not be confirmed.";
}

function normalizeBoundary(state, organizationId, roleAllowed) {
  const rawSource = text(state.source, 80).toLowerCase();
  const kind = sourceKind(rawSource);
  const observedAt = exactIso(state.observedAtISO || state.loadedAtISO || state.observedAt);
  const loading = state.loading === true;
  const error = text(state.error);
  const explicitStale = state.stale === true;
  const organizationKnown = Boolean(organizationId);
  const sourceRecognized = kind === "firebase" || kind === "local";
  const completed = Boolean(observedAt);
  const recordsUsable = roleAllowed && organizationKnown && sourceRecognized && completed;
  const freshnessState = !completed
    ? "unknown"
    : explicitStale || Boolean(error)
      ? "stale"
      : "fresh";
  const freshnessReason = freshnessState === "fresh"
    ? null
    : !completed
      ? loading
        ? "The organization-scoped catalog read has not completed yet."
        : "No exact catalog read-completion time was supplied."
      : explicitStale
        ? "The caller marked this completed catalog snapshot as stale."
        : "The latest catalog refresh reported an error, so the last completed snapshot may be out of date.";
  const notes = [];

  if (!roleAllowed) notes.push("Library records are available only to organization staff.");
  if (!organizationKnown) notes.push("No exact organization scope was supplied.");
  if (!sourceRecognized) notes.push(sourceBoundary(kind, rawSource));
  if (!completed) notes.push("No completed organization-scoped catalog observation is available.");
  if (loading) notes.push(completed
    ? "A refresh is in progress; the last completed catalog remains visible."
    : "The organization catalog is still loading.");
  if (error) notes.push(completed
    ? "The latest refresh did not finish; the last completed catalog remains visible."
    : "The catalog read did not finish.");
  if (kind === "local") notes.push("Local records remain browser-only and do not establish server authority.");

  return {
    rawSource: rawSource || "unknown",
    kind,
    label: sourceLabel(kind, rawSource),
    sourceBoundary: sourceBoundary(kind, rawSource),
    organizationId: organizationId || null,
    organizationKnown,
    observedAt,
    loading,
    error: error || null,
    freshness: {
      state: freshnessState,
      observedAt,
      reason: freshnessReason
    },
    recordsUsable,
    serverScoped: recordsUsable && kind === "firebase",
    notes
  };
}

function explicitOrganizationMismatch(entry, organizationId) {
  if (!Object.prototype.hasOwnProperty.call(entry, "organizationId")) return false;
  return safeId(entry.organizationId) !== organizationId;
}

function normalizeNamedRecords(
  value,
  key,
  bound,
  issues,
  { section = "", organizationId = "" } = {}
) {
  if (!Array.isArray(value)) {
    issues.push(`${key} was not supplied as an array.`);
    return [];
  }
  if (value.length > bound) {
    issues.push(`${key} exceeded the ${bound}-record presentation bound; later records are withheld.`);
  }
  const seen = new Set();
  const normalized = [];
  value.slice(0, bound).forEach((entry, index) => {
    if (!isRecord(entry)) {
      issues.push(`${key}[${index}] is not a plain record.`);
      return;
    }
    if (explicitOrganizationMismatch(entry, organizationId)) {
      issues.push(`${key}[${index}] declares a different or invalid organization scope.`);
      return;
    }
    const id = safeId(entry.id);
    const name = text(entry.name, AMBIENT_LIBRARY_BOUNDS.labelCharacters);
    if (!id || !name || typeof entry.active !== "boolean") {
      issues.push(`${key}[${index}] lacks an exact id, name, or active flag.`);
      return;
    }
    if (seen.has(id)) {
      issues.push(`${key} contains duplicate id ${id}.`);
      return;
    }
    seen.add(id);
    normalized.push({ id, name, active: entry.active, ...(section ? { section } : {}) });
  });
  return normalized;
}

function normalizeMenu(settings, issues, organizationId) {
  const sections = settings.menuSections;
  if (!Array.isArray(sections)) {
    issues.push("settings.menuSections was not supplied as an array.");
    return { sections: [], items: [] };
  }
  if (sections.length > AMBIENT_LIBRARY_BOUNDS.menuSections) {
    issues.push(`settings.menuSections exceeded the ${AMBIENT_LIBRARY_BOUNDS.menuSections}-section presentation bound; later sections are withheld.`);
  }
  const sectionSeen = new Set();
  const itemSeen = new Set();
  const normalizedSections = [];
  const items = [];
  let itemLimitReached = false;

  sections.slice(0, AMBIENT_LIBRARY_BOUNDS.menuSections).forEach((entry, sectionIndex) => {
    if (!isRecord(entry)) {
      issues.push(`settings.menuSections[${sectionIndex}] is not a plain record.`);
      return;
    }
    if (explicitOrganizationMismatch(entry, organizationId)) {
      issues.push(`settings.menuSections[${sectionIndex}] declares a different or invalid organization scope.`);
      return;
    }
    const id = safeId(entry.id);
    const name = text(entry.name, AMBIENT_LIBRARY_BOUNDS.labelCharacters);
    if (!id || !name || !Array.isArray(entry.items)) {
      issues.push(`settings.menuSections[${sectionIndex}] lacks an exact id, name, or item list.`);
      return;
    }
    if (sectionSeen.has(id)) {
      issues.push(`settings.menuSections contains duplicate id ${id}.`);
      return;
    }
    sectionSeen.add(id);
    normalizedSections.push({ id, name });

    entry.items.forEach((item, itemIndex) => {
      if (items.length >= AMBIENT_LIBRARY_BOUNDS.menuItems) {
        itemLimitReached = true;
        return;
      }
      if (!isRecord(item)) {
        issues.push(`settings.menuSections[${sectionIndex}].items[${itemIndex}] is not a plain record.`);
        return;
      }
      if (explicitOrganizationMismatch(item, organizationId)) {
        issues.push(`settings.menuSections[${sectionIndex}].items[${itemIndex}] declares a different or invalid organization scope.`);
        return;
      }
      const itemId = safeId(item.id);
      const itemName = text(item.name, AMBIENT_LIBRARY_BOUNDS.labelCharacters);
      if (!itemId || !itemName || typeof item.active !== "boolean") {
        issues.push(`settings.menuSections[${sectionIndex}].items[${itemIndex}] lacks an exact id, name, or active flag.`);
        return;
      }
      if (itemSeen.has(itemId)) {
        issues.push(`Menu items contain duplicate id ${itemId}.`);
        return;
      }
      itemSeen.add(itemId);
      items.push({ id: itemId, name: itemName, active: item.active, sectionId: id, sectionName: name });
    });
  });

  if (itemLimitReached) {
    issues.push(`Menu items exceeded the ${AMBIENT_LIBRARY_BOUNDS.menuItems}-record presentation bound; later items are withheld.`);
  }
  return { sections: normalizedSections, items };
}

function normalizeReferenceList(value, path, issues) {
  if (value === undefined) return [];
  if (!Array.isArray(value)) {
    issues.push(`${path} was not supplied as an array.`);
    return null;
  }
  if (value.length > AMBIENT_LIBRARY_BOUNDS.referencesPerTemplate) {
    issues.push(`${path} exceeded the reference bound.`);
    return null;
  }
  const seen = new Set();
  const references = [];
  value.forEach((entry, index) => {
    const id = safeId(entry);
    if (!id) {
      issues.push(`${path}[${index}] is not an exact id.`);
      return;
    }
    if (seen.has(id)) {
      issues.push(`${path} contains duplicate id ${id}.`);
      return;
    }
    seen.add(id);
    references.push(id);
  });
  return references;
}

function dependencyState(id, lookup, kind, { evidenceAvailable = true } = {}) {
  if (!id) return { id: null, kind, state: "missing_reference", label: `${kind} not selected` };
  if (!evidenceAvailable) {
    return {
      id,
      kind,
      state: "evidence_unavailable",
      label: id,
      reason: "The full menu is not available in this view, so this saved reference stays unclassified until the current menu is reviewed."
    };
  }
  const record = lookup.get(id);
  if (!record) return { id, kind, state: "missing", label: id };
  if (record.active === false) return { id, kind, state: "inactive", label: record.name };
  return { id, kind, state: "available", label: record.name };
}

function settingsDependencyState(id, records, kind, { virtualIds = [] } = {}) {
  if (!id) return null;
  if (virtualIds.includes(id)) return { id, kind, state: "available", label: id };
  const record = records.find((candidate) => safeId(candidate?.id) === id);
  if (!record) return { id, kind, state: "missing", label: id };
  return {
    id,
    kind,
    state: record.active === false ? "inactive" : "available",
    label: text(record.name, AMBIENT_LIBRARY_BOUNDS.labelCharacters) || id
  };
}

function normalizeTemplates(
  settings,
  eventTypes,
  lookups,
  issues,
  { menuInventoryComplete = false, organizationId = "" } = {}
) {
  const source = settings.eventTemplates;
  if (!Array.isArray(source)) {
    issues.push("settings.eventTemplates was not supplied as an array.");
    return [];
  }
  if (source.length > AMBIENT_LIBRARY_BOUNDS.templates) {
    issues.push(`settings.eventTemplates exceeded the ${AMBIENT_LIBRARY_BOUNDS.templates}-record presentation bound; later templates are withheld.`);
  }
  const seen = new Set();
  const templates = [];

  source.slice(0, AMBIENT_LIBRARY_BOUNDS.templates).forEach((entry, index) => {
    if (!isRecord(entry)) {
      issues.push(`settings.eventTemplates[${index}] is not a plain record.`);
      return;
    }
    if (explicitOrganizationMismatch(entry, organizationId)) {
      issues.push(`settings.eventTemplates[${index}] declares a different or invalid organization scope.`);
      return;
    }
    const id = safeId(entry.id);
    const name = text(entry.name, AMBIENT_LIBRARY_BOUNDS.labelCharacters);
    if (!id || !name) {
      issues.push(`settings.eventTemplates[${index}] lacks an exact id or name.`);
      return;
    }
    if (seen.has(id)) {
      issues.push(`settings.eventTemplates contains duplicate id ${id}.`);
      return;
    }
    seen.add(id);

    const templateIssues = [];
    const packageId = safeId(entry.pkg);
    const addonIds = normalizeReferenceList(entry.addons, `template ${id} add-ons`, templateIssues);
    const rentalIds = normalizeReferenceList(entry.rentals, `template ${id} rentals`, templateIssues);
    const menuItemIds = normalizeReferenceList(entry.menuItems, `template ${id} menu items`, templateIssues);
    const dependencies = [dependencyState(packageId, lookups.packages, "package")];

    if (addonIds) addonIds.forEach((referenceId) => dependencies.push(dependencyState(referenceId, lookups.addons, "add-on")));
    if (rentalIds) rentalIds.forEach((referenceId) => dependencies.push(dependencyState(referenceId, lookups.rentals, "rental")));
    if (menuItemIds) menuItemIds.forEach((referenceId) => dependencies.push(dependencyState(
      referenceId,
      lookups.menu,
      "menu item",
      { evidenceAvailable: menuInventoryComplete }
    )));

    const optionalSettingsDependencies = [
      settingsDependencyState(safeId(entry.taxRegion), settings.taxRegions || [], "tax region"),
      settingsDependencyState(safeId(entry.seasonProfileId), settings.seasonalProfiles || [], "season profile", { virtualIds: ["auto"] }),
      settingsDependencyState(safeId(entry.bartenderRateTypeId), settings.bartenderRateTypes || [], "bartender rate type"),
      settingsDependencyState(safeId(entry.staffingRateTypeId), settings.staffingRateTypes || [], "staffing rate type"),
      settingsDependencyState(safeId(entry.eventTypeId), eventTypes, "event type")
    ].filter(Boolean);
    dependencies.push(...optionalSettingsDependencies);

    const unresolved = dependencies.filter((dependency) => dependency.state !== "available");
    const complete = templateIssues.length === 0 && unresolved.length === 0;
    templates.push({
      id,
      name,
      style: text(entry.style, 80) || null,
      dependencyState: complete ? "resolved" : "attention",
      dependencies,
      unresolvedDependencies: unresolved,
      issues: templateIssues,
      referenceCount: dependencies.length,
      resolvedReferenceCount: dependencies.length - unresolved.length
    });
    issues.push(...templateIssues.map((issue) => `Template ${name}: ${issue}`));
  });
  return templates;
}

function recordsSummary(records) {
  const activeCount = records.filter((record) => record.active === true).length;
  return {
    totalCount: records.length,
    activeCount,
    inactiveCount: records.length - activeCount
  };
}

function normalizeRules(settings, issues) {
  const source = settings.configurationRules;
  if (source === undefined) return { records: [], issueCount: 0 };
  if (!Array.isArray(source)) {
    issues.push("settings.configurationRules was not supplied as an array.");
    return { records: [], issueCount: 1 };
  }
  const seen = new Set();
  let issueCount = 0;
  const records = source.slice(0, AMBIENT_LIBRARY_BOUNDS.rules).flatMap((entry, index) => {
    if (!isRecord(entry)) {
      issues.push(`settings.configurationRules[${index}] is not a plain record.`);
      issueCount += 1;
      return [];
    }
    const id = safeId(entry.id);
    if (!id || seen.has(id)) {
      issues.push(`settings.configurationRules[${index}] has a missing or duplicate id.`);
      issueCount += 1;
      return [];
    }
    seen.add(id);
    return [{
      id,
      name: text(entry.name || entry.reason, AMBIENT_LIBRARY_BOUNDS.labelCharacters) || id,
      active: entry.enabled !== false
    }];
  });
  if (source.length > AMBIENT_LIBRARY_BOUNDS.rules) {
    issues.push(`settings.configurationRules exceeded the ${AMBIENT_LIBRARY_BOUNDS.rules}-record presentation bound; later rules are withheld.`);
    issueCount += 1;
  }
  return { records, issueCount };
}

function pricingState(settings, boundary) {
  const catalogRevision = nonNegativeInteger(settings.catalogRevision);
  const confirmationCurrent = isCatalogPricingConfirmationCurrent(settings);
  const pricingSetupConfirmed = settings.pricingSetupConfirmed === true;
  const confirmation = isRecord(settings.pricingConfirmation) ? settings.pricingConfirmation : null;
  const confirmedAt = exactIso(confirmation?.confirmedAtISO);
  let state = "needs_review";
  let reason = "Pricing has not been confirmed for the current catalog revision.";
  let authority = "none";

  if (!boundary.recordsUsable || catalogRevision === null) {
    state = "unavailable";
    reason = !boundary.recordsUsable
      ? "Pricing state is withheld until the organization-scoped catalog snapshot is usable."
      : "The catalog revision is missing or invalid, so current pricing confirmation cannot be established.";
  } else if (confirmationCurrent && boundary.kind === "firebase" && boundary.freshness.state === "fresh") {
    state = "confirmed";
    authority = "server_recorded";
    reason = `A current pricing confirmation receipt is recorded for catalog revision ${catalogRevision}.`;
  } else if (confirmationCurrent && boundary.kind === "local") {
    state = "local_only";
    authority = "browser_only";
    reason = `Pricing is marked confirmed for local catalog revision ${catalogRevision}, but this browser-only record does not establish server authority.`;
  } else if (confirmationCurrent && boundary.freshness.state === "stale") {
    state = "recorded_confirmation_stale";
    authority = "stale_server_record";
    reason = `A pricing confirmation is recorded for catalog revision ${catalogRevision}, but the catalog snapshot is stale.`;
  } else if (pricingSetupConfirmed) {
    reason = `Pricing is marked confirmed, but no current confirmation receipt matches catalog revision ${catalogRevision}.`;
  }

  return {
    state,
    authority,
    catalogRevision,
    pricingSetupConfirmed,
    confirmationCurrent,
    confirmedAt,
    reason
  };
}

function provenance(boundary, sectionId) {
  const state = !boundary.recordsUsable
    ? "unavailable"
    : boundary.freshness.state === "stale"
      ? "stale"
      : "available";
  return [{
    sourceId: `library:${sectionId}:${boundary.kind}`,
    label: boundary.label,
    type: boundary.kind === "firebase" ? "tenant-catalog-read" : "browser-catalog-read",
    state,
    observedAt: boundary.observedAt,
    ...(state === "available" ? {} : {
      reason: boundary.freshness.reason || boundary.sourceBoundary
    })
  }];
}

function confidence(boundary, issueCount) {
  if (!boundary.recordsUsable) {
    return {
      level: "unavailable",
      basis: "No usable administrator and organization-scoped catalog evidence was supplied."
    };
  }
  if (boundary.kind === "firebase" && boundary.freshness.state === "fresh" && issueCount === 0) {
    return {
      level: "high",
      score: 1,
      basis: "The section comes from a completed, fresh organization-scoped staff catalog read with exact record identities."
    };
  }
  return {
    level: issueCount > 0 || boundary.freshness.state === "stale" ? "low" : "medium",
    score: issueCount > 0 || boundary.freshness.state === "stale" ? 0.35 : 0.65,
    basis: boundary.kind === "local"
      ? "The records are exact inside this completed browser snapshot, but local fallback does not establish the organization’s server catalog."
      : "The completed catalog snapshot has stale or incomplete section evidence, so no stronger conclusion is made."
  };
}

function sectionDependencies(sectionId, summaries, pricing, templates) {
  if (sectionId === "templates") {
    return ["packages", "menu", "addons", "rentals", "pricing"].map((dependencyId) => ({
      object: {
        id: dependencyId,
        type: dependencyId === "pricing" ? "pricing-settings" : "catalog-section",
        label: SECTION_DEFINITIONS[dependencyId].label
      },
      relationship: "template_references_library_section",
      consequence: dependencyId === "pricing"
        ? pricing.reason
        : summaries[dependencyId].availability === "unavailable"
          ? summaries[dependencyId].reason
          : `${summaries[dependencyId].activeCount} of ${summaries[dependencyId].totalCount} ${SECTION_DEFINITIONS[dependencyId].label.toLowerCase()} records are active in this snapshot.`
    }));
  }
  if (sectionId === "pricing") {
    return [{
      object: { id: "catalog-revision", type: "catalog-revision", label: "Catalog version" },
      relationship: "pricing_confirmation_targets_catalog_revision",
      consequence: pricing.catalogRevision === null
        ? "No exact catalog version is available."
        : `Pricing review applies only to catalog version ${pricing.catalogRevision}.`
    }, {
      object: { id: "rules", type: "configuration-rules", label: "Rules" },
      relationship: "pricing_evaluates_bounded_rules",
      consequence: `${summaries.rules.activeCount} active configuration rules are recorded for review.`
    }];
  }
  if (sectionId === "rules") {
    return [{
      object: { id: "pricing", type: "pricing-settings", label: "Pricing" },
      relationship: "rules_may_affect_pricing_context",
      consequence: "Rules remain bounded configuration inputs; authoritative pricing and save paths retain final authority."
    }];
  }
  if (sectionId === "packages") {
    return ["menu", "addons", "rentals"].map((dependencyId) => ({
      object: { id: dependencyId, type: "catalog-section", label: SECTION_DEFINITIONS[dependencyId].label },
      relationship: "package_may_reference_catalog_section",
      consequence: summaries[dependencyId].availability === "unavailable"
        ? summaries[dependencyId].reason
        : `${summaries[dependencyId].activeCount} active ${SECTION_DEFINITIONS[dependencyId].label.toLowerCase()} records are available for exact package references.`
    }));
  }
  if (sectionId === "menu") {
    return [{
      object: { id: "templates", type: "catalog-section", label: "Templates" },
      relationship: "menu_items_may_be_referenced_by_templates",
      consequence: `${templates.filter((template) => template.dependencies.some((dependency) => dependency.kind === "menu item")).length} templates record at least one menu-item reference.`
    }];
  }
  return [{
    object: { id: "templates", type: "catalog-section", label: "Templates" },
    relationship: `${sectionId}_may_be_referenced_by_templates`,
    consequence: `${templates.filter((template) => template.dependencies.some((dependency) => dependency.kind === SECTION_DEFINITIONS[sectionId].singular)).length} templates record at least one ${SECTION_DEFINITIONS[sectionId].singular} reference.`
  }];
}

function actionDefinition({
  id,
  outcomeLabel,
  targetId,
  surfaceId,
  object,
  reason,
  consequence,
  nextResolutionIds,
  capability,
  purpose = "reveal_context"
}) {
  return {
    id,
    outcomeLabel,
    purpose,
    targetId,
    surfaceId,
    object,
    reason,
    consequence,
    nextResolutionIds,
    capability
  };
}

function ambientAction(definition, primary, enabled, disabledReason) {
  return createAmbientAction({
    id: definition.id,
    outcomeLabel: definition.outcomeLabel,
    purpose: definition.purpose,
    roles: ["admin"],
    authorityLevel: "presentation",
    previewPolicy: "none",
    executionTarget: {
      kind: definition.id === "refresh-library" ? "command" : "context",
      targetId: definition.targetId,
      surfaceId: definition.surfaceId
    },
    receiptType: "none",
    reversibility: { kind: "none" },
    arrivalContract: {
      object: definition.object,
      reason: definition.reason,
      consequence: definition.consequence,
      nextResolutionIds: definition.nextResolutionIds
    },
    primary,
    enabled,
    ...(!enabled ? { disabledReason } : {})
  });
}

function buildSectionDescriptor({
  sectionId,
  summary,
  sectionIssueCount,
  actionId,
  boundary,
  capabilities,
  dependencies,
  recommendation
}) {
  const definition = SECTION_DEFINITIONS[sectionId];
  const openAllowed = capabilities.openSection && boundary.recordsUsable;
  const health = sectionIssueCount > 0 || summary.totalCount === 0 ? "attention" : "healthy";
  const summaryText = sectionId === "pricing"
    ? summary.reason
    : sectionId === "templates"
      ? `${summary.totalCount} templates, ${summary.attentionCount} with linked items to review.`
      : summary.availability === "unavailable"
        ? summary.reason
      : `${summary.activeCount} active of ${summary.totalCount} recorded ${definition.label.toLowerCase()}.`;
  return createIntelligentObjectDescriptor({
    id: sectionId,
    type: sectionId === "pricing" ? "pricing-settings" : sectionId === "rules" ? "configuration-rules" : "catalog-section",
    label: definition.label,
    summary: summaryText,
    inspectorSurfaceId: sectionId === "templates" ? "library-templates" : "catalog-admin-section",
    dependencies,
    why: summary.availability === "unavailable"
      ? "This view does not include the full organization menu, so an item missing here is not treated as missing from the menu."
      : sectionId === "templates"
      ? "Templates show the package, menu, add-on, rental, rate, tax, season, and event-type details they use so missing links are visible before use."
      : `This section reflects the current records in ${boundary.label.toLowerCase()}.`,
    consequence: sectionId === "pricing"
      ? summary.reason
      : summary.availability === "unavailable"
        ? summary.reason
        : health === "healthy"
        ? `The recorded ${definition.label.toLowerCase()} can be opened in their exact administration context.`
        : `This section needs review before its records should be treated as a complete Library choice set.`,
    doNothing: sectionId === "pricing"
      ? "No pricing authority changes. Quotes continue to rely on the existing authoritative pricing and save contracts."
      : `The catalog remains unchanged. Missing, inactive, or malformed ${definition.label.toLowerCase()} records are not guessed or repaired.`,
    confidence: summary.availability === "unavailable"
      ? { level: "unavailable", basis: summary.reason }
      : confidence(boundary, sectionIssueCount),
    provenance: summary.availability === "unavailable"
      ? [{
          sourceId: `library:${sectionId}:inventory`,
          label: "Full menu availability",
          type: "tenant-menu-inventory",
          state: "unavailable",
          observedAt: boundary.observedAt,
          reason: summary.reason
        }]
      : provenance(boundary, sectionId),
    recommendation: recommendation
      ? { summary: recommendation, actionId }
      : null,
    permissions: {
      view: boundary.recordsUsable,
      simulate: false,
      stage: false,
      commit: false,
      reason: openAllowed
        ? "This projection is read-only; use the existing admin surface and trusted save contract for changes."
        : !boundary.recordsUsable
          ? boundary.notes[0] || boundary.sourceBoundary
          : "The host did not provide an exact section-opening capability."
    },
    actionIds: [actionId]
  });
}

function dependencyObjectType(kind) {
  if (kind === "package") return "catalog-package";
  if (kind === "menu item") return "catalog-menu-item";
  if (kind === "add-on") return "catalog-addon";
  if (kind === "rental") return "catalog-rental";
  return `catalog-${kind.replace(/[^a-z0-9]+/giu, "-").replace(/^-|-$/gu, "")}-setting`;
}

function dependencyRelationship(kind) {
  return `event_template_references_${kind.replace(/[^a-z0-9]+/giu, "_").replace(/^_|_$/gu, "")}`;
}

function buildTemplateDescriptor(template, boundary, actionId) {
  const attentionCount = template.unresolvedDependencies.length + template.issues.length;
  const descriptorDependencies = template.dependencies.map((dependency, index) => ({
    object: {
      id: dependency.id || `${template.id}:${dependency.kind}:${index + 1}`,
      type: dependencyObjectType(dependency.kind),
      label: dependency.label
    },
    relationship: dependencyRelationship(dependency.kind),
    consequence: dependency.state === "available"
      ? `The exact active ${dependency.kind} reference is present in the supplied Library evidence.`
      : dependency.reason || `The recorded ${dependency.kind} reference is ${dependency.state.replace(/_/gu, " ")}.`
  }));
  return createIntelligentObjectDescriptor({
    id: template.id,
    type: "event-template",
    label: template.name,
    summary: attentionCount === 0
      ? `${template.referenceCount} linked details are available in this Library view.`
      : `${attentionCount} linked ${attentionCount === 1 ? "item needs" : "items need"} review.`,
    inspectorSurfaceId: "library-template",
    dependencies: descriptorDependencies,
    why: "This template keeps its package, menu, add-on, rental, rate, tax, season, and event-type details visible instead of relying on its name alone.",
    consequence: attentionCount === 0
      ? "The template can be reviewed here. Opening it does not apply defaults to a quote."
      : "Using this template before reviewing its linked items may leave draft defaults incomplete; QuotePilot does not guess replacements.",
    doNothing: "The template and every quote remain unchanged. Items needing review stay visible, and nothing is substituted automatically.",
    confidence: attentionCount === 0 && boundary.kind === "firebase" && boundary.freshness.state === "fresh"
      ? {
          level: "high",
          score: 1,
          basis: "Every recorded reference has an exact active match in the completed, fresh organization-scoped Library evidence."
        }
      : {
          level: "low",
          score: 0.35,
          basis: attentionCount > 0
            ? "At least one recorded dependency is missing, inactive, malformed, or cannot be classified with the supplied evidence."
            : "The template is exact in this snapshot, but the source is local or stale and does not support a stronger conclusion."
        },
    provenance: provenance(boundary, `template:${template.id}`),
    recommendation: attentionCount > 0
      ? { summary: "Review the linked template items that need attention.", actionId }
      : null,
    permissions: {
      view: true,
      simulate: false,
      stage: false,
      commit: false,
      reason: "This Library projection is read-only; applying template defaults remains a separate draft action."
    },
    actionIds: [actionId]
  });
}

function candidatePriority(candidate) {
  const priorities = {
    refresh: 0,
    pricing: 10,
    template_dependency: 20,
    menu_evidence: 25,
    start: 30,
    empty_template: 40,
    empty_menu: 50,
    empty_addons: 60,
    empty_rentals: 70,
    routine: 100
  };
  return priorities[candidate.kind] ?? 999;
}

/**
 * Projects a caller-owned useCatalogData-like snapshot into the Ambient
 * Library. Pass `organizationId` inside `state`; catalog records are withheld
 * if it is missing or if currentUserRole is not an organization staff role.
 */
export function buildAmbientLibrary({
  state = {},
  currentUserRole = "staff",
  capabilities = {}
} = {}) {
  const input = isRecord(state) ? state : {};
  const role = text(currentUserRole, 40).toLowerCase() || "staff";
  const roleAllowed = role === "admin" || role === "sales" || role === "staff";
  const editAllowed = role === "admin";
  const organizationId = safeId(input.organizationId);
  const normalizedCapabilities = normalizeCapabilities(capabilities);
  if (!editAllowed) {
    normalizedCapabilities.openSection = false;
    normalizedCapabilities.openTemplate = false;
  }
  const boundary = normalizeBoundary(input, organizationId, roleAllowed);

  if (!boundary.recordsUsable) {
    const refreshDefinition = actionDefinition({
      id: "refresh-library",
      outcomeLabel: "Refresh Library",
      targetId: organizationId || "current-organization",
      surfaceId: "ambient-library",
      object: { id: organizationId || "unscoped-library", type: "tenant-catalog", label: "Library" },
      reason: boundary.notes[0] || "The organization catalog is not available yet.",
      consequence: "A refresh can request the same organization-scoped catalog again; no catalog record changes here.",
      nextResolutionIds: ["review-library-context"],
      capability: "refresh",
      purpose: "resolve"
    });
    const canRefresh = roleAllowed && Boolean(organizationId) && normalizedCapabilities.refresh;
    const refreshAction = ambientAction(
      refreshDefinition,
      canRefresh,
      canRefresh,
      !roleAllowed
        ? "Library records and controls are available only to administrators."
        : !organizationId
          ? "An exact organization is required before refreshing Library."
          : "Library refresh is unavailable in this host."
    );
    const stateName = !roleAllowed
      ? "unauthorized"
      : boundary.loading && !boundary.observedAt
        ? "loading"
        : "unavailable";
    return deepFreeze({
      modelId: AMBIENT_LIBRARY_MODEL,
      surfaceContract: AMBIENT_LIBRARY_SURFACE_CONTRACT,
      state: stateName,
      roleBoundary: {
        role,
        allowed: roleAllowed,
        editAllowed,
        reason: roleAllowed ? null : "Library is restricted to organization staff."
      },
      readBoundary: boundary,
      revision: {
        state: "unavailable",
        catalogRevision: null,
        reason: "Catalog version is unavailable until this organization’s Library can be loaded."
      },
      pricing: {
        state: "unavailable",
        authority: "none",
        catalogRevision: null,
        pricingSetupConfirmed: false,
        confirmationCurrent: false,
        confirmedAt: null,
        reason: "Pricing state is withheld until the organization-scoped catalog snapshot is usable."
      },
      sections: [],
      templates: [],
      omittedEvidence: [],
      actions: { [refreshAction.id]: refreshAction },
      nextAction: canRefresh ? refreshAction : null,
      caughtUp: {
        eligible: false,
        reason: "Caught-up language is withheld because current administrator, organization, source, and completion evidence is incomplete."
      },
      capabilities: normalizedCapabilities,
      evidenceBoundary: "Caller-supplied catalog snapshot only. No catalog read, cross-tenant lookup, mutation, repricing, provider action, or authority grant occurs in this projection."
    });
  }

  const settings = isRecord(input.settings) ? input.settings : {};
  const issues = [];
  const packages = normalizeNamedRecords(
    input.packages,
    "packages",
    AMBIENT_LIBRARY_BOUNDS.packages,
    issues,
    { organizationId }
  );
  const addons = normalizeNamedRecords(
    input.addons,
    "addons",
    AMBIENT_LIBRARY_BOUNDS.addons,
    issues,
    { organizationId }
  );
  const rentals = normalizeNamedRecords(
    input.rentals,
    "rentals",
    AMBIENT_LIBRARY_BOUNDS.rentals,
    issues,
    { organizationId }
  );
  const menuInventoryComplete = input.menuInventoryComplete === true;
  const menu = menuInventoryComplete
    ? normalizeMenu(settings, issues, organizationId)
    : { sections: [], items: [] };
  const eventTypes = Array.isArray(input.eventTypes) ? input.eventTypes : [];
  const templates = normalizeTemplates(settings, eventTypes, {
    packages: new Map(packages.map((record) => [record.id, record])),
    addons: new Map(addons.map((record) => [record.id, record])),
    rentals: new Map(rentals.map((record) => [record.id, record])),
    menu: new Map(menu.items.map((record) => [record.id, record]))
  }, issues, { menuInventoryComplete, organizationId });
  const rules = normalizeRules(settings, issues);
  const pricing = pricingState(settings, boundary);
  const revision = pricing.catalogRevision === null
    ? {
        state: "unavailable",
        catalogRevision: null,
        reason: "The catalog version is missing or invalid."
      }
    : {
        state: boundary.kind === "local" ? "browser_only" : "available",
        catalogRevision: pricing.catalogRevision,
        reason: boundary.kind === "local"
          ? "This version is recorded only in this browser’s Library snapshot."
          : `Catalog version ${pricing.catalogRevision} came from the completed organization Library read.`
      };
  const summaries = {
    packages: recordsSummary(packages),
    menu: menuInventoryComplete
      ? {
          availability: "available",
          ...recordsSummary(menu.items),
          sectionCount: menu.sections.length,
          reason: null
        }
      : {
          availability: "unavailable",
          totalCount: null,
          activeCount: null,
          inactiveCount: null,
          sectionCount: null,
          reason: "The full menu is not available in this view yet, so QuotePilot will not assume there are no event menu records."
        },
    addons: recordsSummary(addons),
    rentals: recordsSummary(rentals),
    pricing,
    rules: recordsSummary(rules.records),
    templates: {
      totalCount: templates.length,
      activeCount: templates.filter((template) => template.dependencyState === "resolved").length,
      inactiveCount: templates.filter((template) => template.dependencyState !== "resolved").length,
      resolvedCount: templates.filter((template) => template.dependencyState === "resolved").length,
      attentionCount: templates.filter((template) => template.dependencyState !== "resolved").length
    }
  };

  const sectionDefinitions = AMBIENT_LIBRARY_SECTION_ORDER.map((sectionId) => {
    const definition = SECTION_DEFINITIONS[sectionId];
    const sectionObject = {
      id: sectionId,
      type: sectionId === "pricing" ? "pricing-settings" : sectionId === "rules" ? "configuration-rules" : "catalog-section",
      label: definition.label
    };
    return actionDefinition({
      id: `review-library-${sectionId}`,
      outcomeLabel: sectionId === "pricing"
        ? "Review pricing settings"
        : sectionId === "templates"
          ? "Review event templates"
          : `Review ${definition.label.toLowerCase()}`,
      targetId: definition.targetId,
      surfaceId: sectionId === "templates" ? "library-templates" : "catalog-admin-section",
      object: sectionObject,
      reason: sectionId === "pricing"
        ? pricing.reason
        : sectionId === "menu" && summaries.menu.availability === "unavailable"
          ? summaries.menu.reason
        : `Open the current ${definition.label.toLowerCase()} section in this Library view.`,
      consequence: sectionId === "templates"
        ? "The template list opens with linked details and items needing review visible; no template changes automatically."
        : sectionId === "menu" && summaries.menu.availability === "unavailable"
          ? "The current organization's menu opens for review. Library does not treat this partial view as the full menu."
        : "The existing administration context opens at this section; nothing is saved or repriced by this action.",
      nextResolutionIds: sectionId === "templates"
        ? ["review-library-template-context"]
        : ["return-to-library"],
      capability: "openSection",
      purpose: sectionId === "pricing" && !["confirmed", "local_only"].includes(pricing.state)
        ? "resolve"
        : "reveal_context"
    });
  });
  const starterDefinition = actionDefinition({
    id: "start-library-setup",
    outcomeLabel: "Set up Library",
    targetId: pricing.pricingSetupConfirmed ? "packages" : "starter",
    surfaceId: "catalog-admin-section",
    object: { id: "library-setup", type: "catalog-section", label: "Library setup" },
    reason: "This completed organization-scoped catalog has no active package to use as a starting point.",
    consequence: "Library setup opens; no starter records or prices are adopted automatically.",
    nextResolutionIds: ["return-to-library"],
    capability: "openSection",
    purpose: "advance"
  });
  const refreshDefinition = actionDefinition({
    id: "refresh-library",
    outcomeLabel: "Refresh Library",
    targetId: organizationId,
    surfaceId: "ambient-library",
    object: { id: organizationId, type: "tenant-catalog", label: "Library" },
    reason: boundary.error || boundary.freshness.reason || "Check the selected organization catalog again.",
    consequence: "The same organization-scoped catalog is requested again; the last completed snapshot stays visible while it loads.",
    nextResolutionIds: ["review-library-context"],
    capability: "refresh",
    purpose: "resolve"
  });
  const templateDefinitions = templates.map((template) => actionDefinition({
    id: `review-library-template:${template.id}`,
    outcomeLabel: `Review ${template.name}`,
    targetId: template.id,
    surfaceId: "library-template",
    object: { id: template.id, type: "event-template", label: template.name },
    reason: template.dependencyState === "resolved"
      ? `${template.name} has all of its linked details available in this Library view.`
      : `${template.name} has ${template.unresolvedDependencies.length + template.issues.length} linked items needing review.`,
    consequence: "This template opens with its linked details; no quote, catalog record, or pricing setting changes.",
    nextResolutionIds: ["return-to-library-templates"],
    capability: "openTemplate",
    purpose: template.dependencyState === "resolved" ? "reveal_context" : "resolve"
  }));
  const definitions = [
    ...sectionDefinitions,
    starterDefinition,
    refreshDefinition,
    ...templateDefinitions
  ];

  const candidates = [];
  if (boundary.error || boundary.freshness.state === "stale") {
    candidates.push({ kind: "refresh", actionId: "refresh-library", reason: boundary.error || boundary.freshness.reason });
  }
  if (!["confirmed", "local_only"].includes(pricing.state)) {
    candidates.push({ kind: "pricing", actionId: "review-library-pricing", reason: pricing.reason });
  }
  const firstTemplateIssue = templates.find((template) => (
    template.issues.length > 0
    || template.unresolvedDependencies.some(
      (dependency) => dependency.state !== "evidence_unavailable"
    )
  ));
  if (firstTemplateIssue) {
    candidates.push({
      kind: "template_dependency",
      actionId: `review-library-template:${firstTemplateIssue.id}`,
      reason: `${firstTemplateIssue.name} has linked Library items to review.`
    });
  }
  if (summaries.menu.availability === "unavailable") {
    candidates.push({
      kind: "menu_evidence",
      actionId: "review-library-menu",
      reason: summaries.menu.reason
    });
  }
  if (summaries.packages.activeCount === 0) {
    candidates.push({ kind: "start", actionId: "start-library-setup", reason: "No active package is recorded." });
  }
  if (summaries.templates.totalCount === 0) {
    candidates.push({ kind: "empty_template", actionId: "review-library-templates", reason: "No event template is recorded." });
  }
  if (summaries.menu.availability === "available" && summaries.menu.activeCount === 0) {
    candidates.push({ kind: "empty_menu", actionId: "review-library-menu", reason: "No active menu item is recorded." });
  }
  if (summaries.addons.activeCount === 0) {
    candidates.push({ kind: "empty_addons", actionId: "review-library-addons", reason: "No active add-on is recorded." });
  }
  if (summaries.rentals.activeCount === 0) {
    candidates.push({ kind: "empty_rentals", actionId: "review-library-rentals", reason: "No active rental is recorded." });
  }
  if (candidates.length === 0) {
    candidates.push({ kind: "routine", actionId: "review-library-templates", reason: "Nothing in the current Library needs review." });
  }
  candidates.sort((left, right) => (
    candidatePriority(left) - candidatePriority(right)
    || left.actionId.localeCompare(right.actionId)
  ));
  const chosenCandidate = candidates.find((candidate) => {
    const definition = definitions.find((entry) => entry.id === candidate.actionId);
    if (!definition) return false;
    return normalizedCapabilities[definition.capability] === true;
  }) || candidates[0];
  const actions = Object.fromEntries(definitions.map((definition) => {
    const capabilityAvailable = normalizedCapabilities[definition.capability] === true;
    const disabledReason = !capabilityAvailable
      ? definition.capability === "openTemplate"
        ? "This host cannot open an exact event template."
        : definition.capability === "refresh"
          ? "Library refresh is unavailable in this host."
          : "This host cannot open an exact Library section."
      : "";
    const action = ambientAction(
      definition,
      definition.id === chosenCandidate.actionId,
      capabilityAvailable,
      disabledReason
    );
    return [action.id, action];
  }));

  const templateRows = templates.map((template) => ({
    ...template,
    actionId: `review-library-template:${template.id}`,
    primaryAction: actions[`review-library-template:${template.id}`],
    descriptor: buildTemplateDescriptor(
      template,
      boundary,
      `review-library-template:${template.id}`
    )
  }));
  const sectionIssueCounts = {
    packages: summaries.packages.totalCount === 0 ? 1 : 0,
    menu: summaries.menu.availability === "unavailable"
      ? 1
      : summaries.menu.totalCount === 0 ? 1 : 0,
    addons: summaries.addons.totalCount === 0 ? 1 : 0,
    rentals: summaries.rentals.totalCount === 0 ? 1 : 0,
    pricing: ["confirmed", "local_only"].includes(pricing.state) ? 0 : 1,
    rules: rules.issueCount,
    templates: summaries.templates.attentionCount + (summaries.templates.totalCount === 0 ? 1 : 0)
  };
  const sections = AMBIENT_LIBRARY_SECTION_ORDER.map((sectionId) => {
    const sectionActionId = `review-library-${sectionId}`;
    const recommendation = chosenCandidate.actionId === sectionActionId
      ? chosenCandidate.reason
      : null;
    return {
      id: sectionId,
      label: SECTION_DEFINITIONS[sectionId].label,
      health: sectionIssueCounts[sectionId] > 0 ? "attention" : "healthy",
      summary: summaries[sectionId],
      issueCount: sectionIssueCounts[sectionId],
      descriptor: buildSectionDescriptor({
        sectionId,
        summary: summaries[sectionId],
        sectionIssueCount: sectionIssueCounts[sectionId],
        actionId: sectionActionId,
        boundary,
        capabilities: normalizedCapabilities,
        dependencies: sectionDependencies(sectionId, summaries, pricing, templateRows),
        recommendation
      }),
      primaryAction: actions[sectionActionId]
    };
  });
  const materialCounts = [
    summaries.packages.totalCount,
    summaries.menu.availability === "available" ? summaries.menu.totalCount : null,
    summaries.addons.totalCount,
    summaries.rentals.totalCount,
    summaries.templates.totalCount
  ];
  const empty = materialCounts.every((count) => count === 0);
  const attentionCount = Object.values(sectionIssueCounts).reduce((total, count) => total + count, 0)
    + issues.length;
  const caughtUpEligible = attentionCount === 0
    && boundary.kind === "firebase"
    && boundary.freshness.state === "fresh"
    && pricing.state === "confirmed";
  const outputState = empty
    ? "empty"
    : boundary.kind === "local"
      ? "local"
      : attentionCount > 0 || revision.state !== "available"
        ? "bounded"
        : "ready";

  return deepFreeze({
    modelId: AMBIENT_LIBRARY_MODEL,
    surfaceContract: AMBIENT_LIBRARY_SURFACE_CONTRACT,
    state: outputState,
    roleBoundary: { role, allowed: true, editAllowed, reason: null },
    readBoundary: boundary,
    revision,
    pricing,
    sections,
    templates: templateRows,
    omittedEvidence: issues,
    actions,
    nextAction: actions[chosenCandidate.actionId] || null,
    nextActionReason: chosenCandidate.reason,
    rankedCandidates: candidates,
    caughtUp: {
      eligible: caughtUpEligible,
      reason: caughtUpEligible
        ? "Nothing in the current Library needs review. Item availability and event readiness are checked separately."
        : "Caught-up language is withheld because the source, pricing confirmation, catalog starting records, dependency evidence, or normalized record boundary needs review."
    },
    capabilities: normalizedCapabilities,
    evidenceBoundary: "Caller-supplied, already organization-scoped catalog records only. This projection performs no read, cross-tenant lookup, mutation, repricing, provider action, availability check, or authority grant."
  });
}
