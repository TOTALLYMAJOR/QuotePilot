import { createImpactPreview } from "./ambientContracts";
import { calculateQuote } from "./quoteCalculator";

export const CLIENT_CALCULATION_PREVIEW_BOUNDARY =
  "This deterministic browser calculation is advisory and partial. The trusted save path must reprice against the current server-owned catalog, policy, and quote revision.";

export const SERVER_SIMULATION_PREVIEW_BOUNDARY =
  "This immutable server simulation is advisory. It does not authorize, stage, save, invalidate, publish, accept, book, charge, or otherwise mutate the quote or its dependent evidence.";

const CLIENT_CALCULATOR_SOURCE_LABEL = "Deterministic client quote calculator";
const SERVER_RECEIPT_SCHEMA = "commercial-change-simulation-receipt-v1";
const SERVER_SIMULATION_SCHEMA = "commercial-change-impact-v1";
const MAX_FACT_DELTAS = 32;
const MAX_DEPENDENCIES = 64;

function isRecord(value) {
  if (!value || typeof value !== "object" || Array.isArray(value)) return false;
  const prototype = Object.getPrototypeOf(value);
  return prototype === Object.prototype || prototype === null;
}

function text(value) {
  return String(value ?? "").trim();
}

function finite(value) {
  return typeof value === "number" && Number.isFinite(value) && !Object.is(value, -0);
}

function nonNegativeNumber(value) {
  return finite(value) && value >= 0;
}

function exactIso(value) {
  if (typeof value !== "string" || !value) return null;
  const parsed = new Date(value);
  return Number.isNaN(parsed.getTime()) || parsed.toISOString() !== value ? null : value;
}

function uniqueStrings(values) {
  return [...new Set(values.map(text).filter(Boolean))];
}

function own(value, key) {
  return Object.prototype.hasOwnProperty.call(value, key);
}

function exactKeys(value, keys) {
  if (!isRecord(value)) return false;
  const actual = Object.keys(value).sort();
  const expected = [...keys].sort();
  return actual.length === expected.length
    && actual.every((key, index) => key === expected[index]);
}

function safeJsonValue(value, seen = new WeakSet()) {
  if (value === null || typeof value === "string" || typeof value === "boolean") return true;
  if (typeof value === "number") return Number.isFinite(value);
  if (Array.isArray(value)) {
    if (seen.has(value)) return false;
    seen.add(value);
    return value.every((entry) => safeJsonValue(entry, seen));
  }
  if (!isRecord(value) || seen.has(value)) return false;
  seen.add(value);
  return Object.entries(value).every(([key, entry]) => (
    !["__proto__", "prototype", "constructor"].includes(key)
    && entry !== undefined
    && safeJsonValue(entry, seen)
  ));
}

function stableSerialize(value) {
  if (Array.isArray(value)) return `[${value.map(stableSerialize).join(",")}]`;
  if (isRecord(value)) {
    return `{${Object.keys(value).sort().map((key) => (
      `${JSON.stringify(key)}:${stableSerialize(value[key])}`
    )).join(",")}}`;
  }
  return JSON.stringify(value);
}

function sameJson(left, right) {
  return safeJsonValue(left) && safeJsonValue(right) && stableSerialize(left) === stableSerialize(right);
}

function directSelectionIds(value) {
  return Array.isArray(value) ? value.map(text).filter(Boolean) : [];
}

function selectedItemMissing(ids, items) {
  const available = new Set((Array.isArray(items) ? items : [])
    .filter((item) => isRecord(item) && item.active !== false)
    .map((item) => text(item.id))
    .filter(Boolean));
  return ids.find((id) => !available.has(id)) || "";
}

function menuCatalog(settings) {
  if (!Array.isArray(settings?.menuSections)) return [];
  return settings.menuSections.flatMap((section) => (
    Array.isArray(section?.items) ? section.items : []
  ));
}

function explicitRate(settings, key) {
  if (!own(settings, key)) return false;
  const raw = settings[key];
  if (raw === null || raw === undefined || String(raw).trim() === "") return false;
  return nonNegativeNumber(Number(raw));
}

function validateClientScenario(form, catalog, settings, label) {
  const reasons = [];
  if (!isRecord(form)) return [`${label} form evidence is unavailable.`];
  if (!isRecord(catalog)) return ["The client catalog evidence is unavailable."];
  if (!isRecord(settings)) return ["The client pricing settings evidence is unavailable."];
  if (!Array.isArray(catalog.packages) || !catalog.packages.length) {
    reasons.push("The client package catalog is unavailable.");
  }
  if (!Array.isArray(catalog.addons) || !Array.isArray(catalog.rentals)) {
    reasons.push("The client add-on or rental catalog is unavailable.");
  }

  const packageId = text(form.pkg);
  const selectedPackage = Array.isArray(catalog.packages)
    ? catalog.packages.find((entry) => text(entry?.id) === packageId && entry?.active !== false)
    : null;
  if (
    !packageId
    || !selectedPackage
    || selectedPackage.ppp === null
    || selectedPackage.ppp === undefined
    || String(selectedPackage.ppp).trim() === ""
    || !nonNegativeNumber(Number(selectedPackage.ppp))
  ) {
    reasons.push(`${label} package pricing evidence is incomplete.`);
  }

  const numericFields = ["guests", "hours", "servers", "chefs", "bartenders", "milesRT"];
  numericFields.forEach((field) => {
    const number = Number(form[field] ?? 0);
    if (!Number.isFinite(number) || number < 0) {
      reasons.push(`${label} ${field} is not a supported non-negative number.`);
    }
  });
  const guests = Number(form.guests ?? 0);
  if (Number.isFinite(guests) && guests > 400) {
    reasons.push(`${label} guest count exceeds the client-calculation bound of 400.`);
  }
  ["servers", "chefs", "bartenders"].forEach((field) => {
    const count = Number(form[field] ?? 0);
    if (Number.isFinite(count) && !Number.isSafeInteger(count)) {
      reasons.push(`${label} ${field} count must be a whole number.`);
    }
  });

  if (!explicitRate(settings, "depositPct") || Number(settings.depositPct) > 1) {
    reasons.push("The client deposit policy is unavailable or invalid.");
  }
  if (!explicitRate(settings, "serviceFeePct")) {
    reasons.push("The client service-fee fallback is unavailable or invalid.");
  }
  const taxRegions = Array.isArray(settings.taxRegions) ? settings.taxRegions : [];
  const selectedTaxRegionId = text(form.taxRegion || settings.defaultTaxRegion);
  if (taxRegions.length) {
    const taxRegion = taxRegions.find((entry) => text(entry?.id) === selectedTaxRegionId)
      || (!selectedTaxRegionId ? taxRegions[0] : null);
    if (!taxRegion || !explicitRate(taxRegion, "rate")) {
      reasons.push(`${label} tax-region pricing evidence is unavailable or invalid.`);
    }
  } else if (!explicitRate(settings, "taxRate")) {
    reasons.push("The client tax fallback is unavailable or invalid.");
  }

  if (settings.staffingLaborEnabled !== false) {
    const roleSettings = [
      ["servers", "serverRate", "serverRateOverride"],
      ["chefs", "chefRate", "chefRateOverride"],
      ["bartenders", "bartenderRate", "bartenderRateOverride"]
    ];
    roleSettings.forEach(([countField, settingsField, overrideField]) => {
      if (
        Number(form[countField] ?? 0) > 0
        && !explicitRate(settings, settingsField)
        && !explicitRate(form, overrideField)
      ) {
        reasons.push(`${label} ${countField} labor-rate evidence is unavailable.`);
      }
    });
    if (
      text(settings.staffingChargeMode) !== "per_event_per_staff"
      && Number(form.servers ?? 0) + Number(form.chefs ?? 0) + Number(form.bartenders ?? 0) > 0
      && !(Number(form.hours) > 0)
    ) {
      reasons.push(`${label} event duration is required for hourly staffing.`);
    }
  }

  const selectedAddOn = selectedItemMissing(directSelectionIds(form.addons), catalog.addons);
  const selectedRental = selectedItemMissing(directSelectionIds(form.rentals), catalog.rentals);
  const selectedMenu = selectedItemMissing(directSelectionIds(form.menuItems), menuCatalog(settings));
  if (selectedAddOn) reasons.push(`${label} add-on ${selectedAddOn} is absent from the active client catalog.`);
  if (selectedRental) reasons.push(`${label} rental ${selectedRental} is absent from the active client catalog.`);
  if (selectedMenu) reasons.push(`${label} menu item ${selectedMenu} is absent from the active client catalog.`);

  const seasonalProfiles = Array.isArray(settings.seasonalProfiles) ? settings.seasonalProfiles : [];
  if (seasonalProfiles.length) {
    const selectedSeason = text(form.seasonProfileId || settings.defaultSeasonProfile || "auto");
    if (selectedSeason === "auto") {
      if (!exactIso(`${text(form.date)}T00:00:00.000Z`)) {
        reasons.push(`${label} event date is required for automatic seasonal pricing.`);
      }
    } else if (!seasonalProfiles.some((profile) => text(profile?.id) === selectedSeason)) {
      reasons.push(`${label} seasonal profile is absent from the client settings.`);
    }
  }

  return uniqueStrings(reasons);
}

function pathParts(path) {
  const normalized = text(path);
  if (!normalized || normalized.length > 256) return null;
  const parts = normalized.split(".");
  if (parts.some((part) => !part || ["__proto__", "prototype", "constructor"].includes(part))) {
    return null;
  }
  return parts;
}

function readOwnPath(value, path) {
  const parts = pathParts(path);
  if (!parts) return { found: false, value: undefined };
  let cursor = value;
  for (const part of parts) {
    if (!isRecord(cursor) || !own(cursor, part)) return { found: false, value: undefined };
    cursor = cursor[part];
  }
  return { found: true, value: cursor };
}

function normalizeClientFactDeltas(value, currentForm, proposedForm) {
  if (!Array.isArray(value) || value.length === 0 || value.length > MAX_FACT_DELTAS) {
    return { deltas: [], beforeFacts: {}, afterFacts: {}, reason: "Explicit changed-fact evidence is unavailable." };
  }
  const seen = new Set();
  const deltas = [];
  const beforeFacts = {};
  const afterFacts = {};
  for (const candidate of value) {
    if (!exactKeys(candidate, ["field", "before", "after"])) {
      return { deltas: [], beforeFacts: {}, afterFacts: {}, reason: "Changed-fact evidence is not exact." };
    }
    const field = text(candidate.field);
    const before = readOwnPath(currentForm, field);
    const after = readOwnPath(proposedForm, field);
    if (
      !field
      || seen.has(field)
      || !before.found
      || !after.found
      || !sameJson(candidate.before, before.value)
      || !sameJson(candidate.after, after.value)
      || sameJson(candidate.before, candidate.after)
    ) {
      return { deltas: [], beforeFacts: {}, afterFacts: {}, reason: "Changed-fact evidence does not match the two client scenarios." };
    }
    seen.add(field);
    beforeFacts[field] = candidate.before;
    afterFacts[field] = candidate.after;
    deltas.push({
      field,
      before: candidate.before,
      after: candidate.after,
      authority: "client_input"
    });
  }
  return { deltas, beforeFacts, afterFacts, reason: "" };
}

function commercialSnapshot(totals, currency) {
  return {
    currency,
    total: totals.total,
    deposit: totals.deposit
  };
}

function commercialDeltas(before, after, currency) {
  return {
    currency,
    total: {
      before: before.total,
      after: after.total,
      delta: after.total - before.total
    },
    deposit: {
      before: before.deposit,
      after: after.deposit,
      delta: after.deposit - before.deposit
    }
  };
}

function safeDependencies(value) {
  return Array.isArray(value) ? value : [];
}

function clientUnavailable(input, reasons, calculatedAt) {
  const unavailableReasons = uniqueStrings(reasons);
  const primaryReason = unavailableReasons[0] || "The client calculation evidence is unavailable.";
  const source = {
    sourceId: text(input.sourceId) || `client-calculator:${text(input.baseRevision) || "unknown-revision"}`,
    label: text(input.sourceLabel) || CLIENT_CALCULATOR_SOURCE_LABEL,
    type: "client_calculator",
    state: "unavailable",
    observedAt: null,
    reason: primaryReason
  };
  return createImpactPreview({
    id: input.id,
    object: input.object,
    previewKind: "client_calculation",
    evidenceAuthority: "client_calculated",
    status: "unavailable",
    baseRevision: input.baseRevision,
    source,
    provenance: [source],
    freshness: { state: "unknown", reason: primaryReason },
    confidence: { level: "unavailable", basis: primaryReason },
    why: input.why,
    consequence: input.consequence,
    doNothing: input.doNothing,
    before: null,
    after: null,
    deltas: [],
    commercialDeltas: null,
    affectedDependencies: safeDependencies(input.affectedDependencies),
    warnings: uniqueStrings(input.warnings || []),
    unavailableReasons,
    receipt: null,
    calculatedAt
  });
}

/**
 * Adapts two deterministic `calculateQuote` scenarios without strengthening
 * them into pricing, revision, or save authority.
 */
export function buildClientCalculationImpactPreview(input = {}) {
  const calculatedAt = exactIso(input.calculatedAt);
  const reasons = [
    ...validateClientScenario(input.currentForm, input.catalog, input.settings, "Current"),
    ...validateClientScenario(input.proposedForm, input.catalog, input.settings, "Proposed")
  ];
  if (!calculatedAt) reasons.push("The client calculation timestamp is unavailable or invalid.");
  const currency = text(input.currency || "USD").toUpperCase();
  if (!/^[A-Z]{3}$/u.test(currency)) reasons.push("The client calculation currency is invalid.");
  const facts = normalizeClientFactDeltas(input.factDeltas, input.currentForm, input.proposedForm);
  if (facts.reason) reasons.push(facts.reason);
  if (reasons.length) return clientUnavailable(input, reasons, calculatedAt);

  let beforeTotals;
  let afterTotals;
  try {
    beforeTotals = calculateQuote(input.currentForm, input.catalog, input.settings);
    afterTotals = calculateQuote(input.proposedForm, input.catalog, input.settings);
  } catch {
    return clientUnavailable(input, ["The deterministic client calculator could not evaluate both scenarios."], calculatedAt);
  }
  if (
    !isRecord(beforeTotals)
    || !isRecord(afterTotals)
    || !nonNegativeNumber(beforeTotals.total)
    || !nonNegativeNumber(beforeTotals.deposit)
    || !nonNegativeNumber(afterTotals.total)
    || !nonNegativeNumber(afterTotals.deposit)
  ) {
    return clientUnavailable(input, ["The deterministic client calculator returned incomplete commercial evidence."], calculatedAt);
  }

  const beforeCommercial = commercialSnapshot(beforeTotals, currency);
  const afterCommercial = commercialSnapshot(afterTotals, currency);
  const source = {
    sourceId: text(input.sourceId) || `client-calculator:${text(input.baseRevision)}`,
    label: text(input.sourceLabel) || CLIENT_CALCULATOR_SOURCE_LABEL,
    type: "client_calculator",
    state: "available",
    observedAt: calculatedAt
  };
  return createImpactPreview({
    id: input.id,
    object: input.object,
    previewKind: "client_calculation",
    evidenceAuthority: "client_calculated",
    status: "partial",
    baseRevision: input.baseRevision,
    source,
    provenance: [source, ...(Array.isArray(input.provenance) ? input.provenance : [])],
    freshness: { state: "fresh", observedAt: calculatedAt },
    confidence: input.confidence || {
      level: "medium",
      basis: "Both scenarios used the same loaded client catalog and deterministic calculator."
    },
    why: input.why,
    consequence: input.consequence,
    doNothing: input.doNothing,
    before: { facts: facts.beforeFacts, commercial: beforeCommercial },
    after: { facts: facts.afterFacts, commercial: afterCommercial },
    deltas: facts.deltas,
    commercialDeltas: commercialDeltas(beforeCommercial, afterCommercial, currency),
    affectedDependencies: safeDependencies(input.affectedDependencies),
    warnings: uniqueStrings([...(input.warnings || []), CLIENT_CALCULATION_PREVIEW_BOUNDARY]),
    unavailableReasons: uniqueStrings([
      ...(input.unavailableReasons || []),
      "Exact authoritative repricing and current-revision confirmation remain unavailable until trusted save."
    ]),
    receipt: null
  });
}

const RESULT_KEYS = Object.freeze([
  "ok",
  "storage",
  "organizationId",
  "quoteId",
  "idempotent",
  "authorityState",
  "simulationReceipt",
  "simulation"
]);
const RECEIPT_KEYS = Object.freeze([
  "schemaVersion",
  "authority",
  "receiptType",
  "receiptId",
  "requestId",
  "organizationId",
  "quoteId",
  "baseRevisionId",
  "proposedRevisionId",
  "proposalDigest",
  "impactDigest",
  "catalogAuthorityDigest",
  "policyVersion",
  "graph",
  "factDiffs",
  "commercialValues",
  "impact",
  "authorizationRequired",
  "simulatedAtISO",
  "expiresAtISO",
  "simulatedBy",
  "boundary",
  "receiptDigest"
]);
const SIMULATION_KEYS = Object.freeze([
  "schemaVersion",
  "advisory",
  "receiptId",
  "receiptDigest",
  "authorizationRequired",
  "expiresAtISO",
  "identity",
  "sources",
  "graph",
  "factDiffs",
  "commercialValues",
  "impact",
  "bounds",
  "boundary"
]);

function exactServerCommercialValues(value) {
  if (!exactKeys(value, ["currency", "authoritativeTotal", "depositRequirement"])) return false;
  if (!/^[A-Z]{3}$/u.test(value.currency)) return false;
  return [value.authoritativeTotal, value.depositRequirement].every((entry) => (
    exactKeys(entry, [
      "before",
      "proposedAfter",
      "changed",
      "beforeSourceLabel",
      "proposedAfterSourceLabel",
      "authority"
    ])
    && nonNegativeNumber(entry.before)
    && nonNegativeNumber(entry.proposedAfter)
    && entry.changed === (entry.before !== entry.proposedAfter)
    && entry.authority === "server_authoritative"
    && Boolean(text(entry.beforeSourceLabel))
    && Boolean(text(entry.proposedAfterSourceLabel))
  ));
}

function exactServerFactDiffs(value) {
  return Array.isArray(value)
    && value.length <= MAX_FACT_DELTAS
    && new Set(value.map((entry) => text(entry?.nodeId))).size === value.length
    && value.every((entry) => (
      exactKeys(entry, ["nodeId", "before", "proposedAfter"])
      && Boolean(text(entry.nodeId))
      && safeJsonValue(entry.before)
      && safeJsonValue(entry.proposedAfter)
      && !sameJson(entry.before, entry.proposedAfter)
    ));
}

function exactServerImpact(value) {
  if (!exactKeys(value, ["rootNodeIds", "dependentNodes", "counts"])) return false;
  if (
    !Array.isArray(value.rootNodeIds)
    || !Array.isArray(value.dependentNodes)
    || value.dependentNodes.length > MAX_DEPENDENCIES
    || !exactKeys(value.counts, ["total", "review", "stale"])
  ) return false;
  const rootIdsValid = value.rootNodeIds.length <= MAX_FACT_DELTAS
    && new Set(value.rootNodeIds.map(text)).size === value.rootNodeIds.length
    && value.rootNodeIds.every((entry) => Boolean(text(entry)));
  const nodesValid = value.dependentNodes.every((entry) => (
    exactKeys(entry, ["nodeId", "nodeKind", "distance", "triggeredBy", "classification"])
    && Boolean(text(entry.nodeId))
    && ["fact", "output", "artifact", "projection"].includes(entry.nodeKind)
    && Number.isSafeInteger(entry.distance)
    && entry.distance >= 0
    && Array.isArray(entry.triggeredBy)
    && entry.triggeredBy.every((trigger) => Boolean(text(trigger)))
    && new Set(entry.triggeredBy.map(text)).size === entry.triggeredBy.length
    && ["REVIEW", "STALE"].includes(entry.classification)
    && entry.classification === (["artifact", "projection"].includes(entry.nodeKind) ? "STALE" : "REVIEW")
  ));
  if (!rootIdsValid || !nodesValid || new Set(value.dependentNodes.map((entry) => entry.nodeId)).size !== value.dependentNodes.length) {
    return false;
  }
  const review = value.dependentNodes.filter((entry) => entry.classification === "REVIEW").length;
  const stale = value.dependentNodes.filter((entry) => entry.classification === "STALE").length;
  return value.counts.total === value.dependentNodes.length
    && value.counts.review === review
    && value.counts.stale === stale;
}

function exactActor(value) {
  return exactKeys(value, ["uid", "email", "role"])
    && Boolean(text(value.uid))
    && /^[^\s@]+@[^\s@]+\.[^\s@]+$/u.test(text(value.email))
    && ["admin", "sales"].includes(value.role);
}

function exactBounds(value) {
  return exactKeys(value, [
    "declaredFactCount",
    "changedFactLimit",
    "dependentNodeLimit",
    "outputByteLimit"
  ]) && Object.values(value).every((entry) => Number.isSafeInteger(entry) && entry >= 0);
}

function exactServerSimulation(result) {
  if (!exactKeys(result, RESULT_KEYS)) return null;
  const receipt = result.simulationReceipt;
  const simulation = result.simulation;
  if (!exactKeys(receipt, RECEIPT_KEYS) || !exactKeys(simulation, SIMULATION_KEYS)) return null;
  if (
    result.ok !== true
    || result.storage !== "firebase"
    || typeof result.idempotent !== "boolean"
    || !["dormant", "enforced"].includes(result.authorityState)
    || receipt.schemaVersion !== SERVER_RECEIPT_SCHEMA
    || receipt.authority !== "server_authoritative"
    || receipt.receiptType !== "simulation"
    || simulation.schemaVersion !== SERVER_SIMULATION_SCHEMA
    || simulation.advisory !== true
    || receipt.organizationId !== result.organizationId
    || receipt.quoteId !== result.quoteId
    || simulation.receiptId !== receipt.receiptId
    || simulation.receiptDigest !== receipt.receiptDigest
    || simulation.authorizationRequired !== receipt.authorizationRequired
    || simulation.expiresAtISO !== receipt.expiresAtISO
    || !exactIso(receipt.simulatedAtISO)
    || !exactIso(receipt.expiresAtISO)
    || Date.parse(receipt.expiresAtISO) < Date.parse(receipt.simulatedAtISO)
    || !/^ccs_[a-f0-9]{48}$/u.test(receipt.receiptId)
    || !/^change_sim_[a-f0-9]{32}$/u.test(receipt.requestId)
    || !/^[a-f0-9]{64}$/u.test(receipt.receiptDigest)
    || !exactKeys(simulation.identity, ["organizationId", "quoteId", "beforeRevisionId", "proposedRevisionId"])
    || simulation.identity.organizationId !== result.organizationId
    || simulation.identity.quoteId !== result.quoteId
    || simulation.identity.beforeRevisionId !== receipt.baseRevisionId
    || simulation.identity.proposedRevisionId !== receipt.proposedRevisionId
    || !text(receipt.organizationId)
    || !text(receipt.quoteId)
    || !text(receipt.baseRevisionId)
    || !text(receipt.proposedRevisionId)
    || !["proposalDigest", "impactDigest", "catalogAuthorityDigest", "receiptDigest"]
      .every((field) => /^[a-f0-9]{64}$/u.test(receipt[field]))
    || !text(receipt.policyVersion)
    || !exactActor(receipt.simulatedBy)
    || typeof receipt.authorizationRequired !== "boolean"
    || receipt.authorizationRequired !== (receipt.impact?.counts?.total > 0)
    || !text(receipt.boundary)
    || !text(simulation.boundary)
    || !exactBounds(simulation.bounds)
    || !exactKeys(simulation.sources, ["before", "proposedAfter"])
    || !Object.values(simulation.sources).every((source) => (
      exactKeys(source, ["label", "authority"])
      && source.authority === "server_authoritative"
      && Boolean(text(source.label))
    ))
    || !exactServerFactDiffs(receipt.factDiffs)
    || !exactServerCommercialValues(receipt.commercialValues)
    || !exactServerImpact(receipt.impact)
    || !sameJson(simulation.factDiffs, receipt.factDiffs)
    || !sameJson(simulation.commercialValues, receipt.commercialValues)
    || !sameJson(simulation.impact, receipt.impact)
    || !sameJson(simulation.graph, receipt.graph)
  ) return null;
  return { receipt, simulation };
}

function serverDependencies(nodes) {
  return nodes.map((node) => ({
    object: {
      id: node.nodeId,
      type: node.nodeKind,
      label: node.nodeId
        .replace(/^(?:fact|output|artifact|projection)\./u, "")
        .replaceAll(/[._]+/gu, " ")
    },
    relationship: node.triggeredBy.length
      ? `Triggered by ${node.triggeredBy.join(", ")} at dependency distance ${node.distance}.`
      : `Named by the Commercial Dependency Graph at dependency distance ${node.distance}.`,
    consequence: node.classification === "STALE"
      ? "The simulation marks this dependent evidence stale pending governed reconciliation."
      : "The simulation marks this dependency for review before governed adoption."
  }));
}

function serverReceiptSummary(receipt) {
  return {
    schemaVersion: receipt.schemaVersion,
    type: "simulation",
    id: receipt.receiptId,
    digest: receipt.receiptDigest,
    requestId: receipt.requestId,
    baseRevision: receipt.baseRevisionId,
    proposedRevision: receipt.proposedRevisionId,
    simulatedAt: receipt.simulatedAtISO,
    expiresAt: receipt.expiresAtISO,
    authorizationRequired: receipt.authorizationRequired
  };
}

function serverUnavailable(input, reason, { receipt = null, stale = false } = {}) {
  const sourceId = receipt?.receiptId || `server-simulation:${text(input.baseRevision) || "unknown-revision"}`;
  const source = {
    sourceId,
    label: receipt ? "Immutable server simulation receipt" : "Commercial Change simulation",
    type: "server_simulation_receipt",
    state: stale ? "stale" : "unavailable",
    observedAt: receipt?.simulatedAtISO || null,
    reason
  };
  return createImpactPreview({
    id: input.id,
    object: input.object,
    previewKind: "server_simulation",
    evidenceAuthority: "server_authoritative",
    status: "unavailable",
    baseRevision: receipt?.baseRevisionId || input.baseRevision,
    source,
    provenance: [source],
    freshness: stale
      ? { state: "stale", observedAt: receipt.simulatedAtISO, reason }
      : { state: "unknown", reason },
    confidence: { level: "unavailable", basis: reason },
    why: input.why,
    consequence: input.consequence,
    doNothing: input.doNothing,
    before: null,
    after: null,
    deltas: [],
    commercialDeltas: null,
    affectedDependencies: [],
    warnings: uniqueStrings(input.warnings || []),
    unavailableReasons: [reason],
    receipt: receipt ? serverReceiptSummary(receipt) : null
  });
}

/**
 * Adapts the already-normalized result returned by
 * `simulateCommercialQuoteChange`. The receipt and projection must agree
 * exactly before any simulated value is exposed.
 */
export function buildCommercialChangeSimulationImpactPreview(input = {}) {
  const normalized = exactServerSimulation(input.result);
  if (!normalized) {
    return serverUnavailable(
      input,
      "The server simulation response is incomplete or does not match its immutable receipt."
    );
  }
  const { receipt, simulation } = normalized;
  const evaluatedAt = exactIso(input.evaluatedAt);
  if (!evaluatedAt) {
    return serverUnavailable(input, "The simulation evaluation time is unavailable or invalid.", { receipt });
  }
  if (Date.parse(evaluatedAt) < Date.parse(receipt.simulatedAtISO)) {
    return serverUnavailable(
      input,
      "The simulation evaluation time precedes the immutable server receipt.",
      { receipt }
    );
  }
  if (Date.parse(evaluatedAt) > Date.parse(receipt.expiresAtISO)) {
    return serverUnavailable(
      input,
      "The immutable server simulation receipt has expired; refresh before relying on its values.",
      { receipt, stale: true }
    );
  }

  const beforeFacts = {};
  const afterFacts = {};
  const deltas = simulation.factDiffs.map((diff) => {
    beforeFacts[diff.nodeId] = diff.before;
    afterFacts[diff.nodeId] = diff.proposedAfter;
    return {
      field: diff.nodeId,
      before: diff.before,
      after: diff.proposedAfter,
      authority: "server_authoritative"
    };
  });
  const currency = simulation.commercialValues.currency;
  const beforeCommercial = {
    currency,
    total: simulation.commercialValues.authoritativeTotal.before,
    deposit: simulation.commercialValues.depositRequirement.before
  };
  const afterCommercial = {
    currency,
    total: simulation.commercialValues.authoritativeTotal.proposedAfter,
    deposit: simulation.commercialValues.depositRequirement.proposedAfter
  };
  const source = {
    sourceId: receipt.receiptId,
    label: "Immutable server simulation receipt",
    type: "server_simulation_receipt",
    state: "available",
    observedAt: receipt.simulatedAtISO
  };
  const beforeSource = {
    sourceId: `${receipt.receiptId}:before`,
    label: simulation.sources.before.label,
    type: "server_authoritative_snapshot",
    state: "available",
    observedAt: receipt.simulatedAtISO
  };
  const afterSource = {
    sourceId: `${receipt.receiptId}:proposed`,
    label: simulation.sources.proposedAfter.label,
    type: "server_authoritative_preview",
    state: "available",
    observedAt: receipt.simulatedAtISO
  };

  return createImpactPreview({
    id: input.id,
    object: input.object,
    previewKind: "server_simulation",
    evidenceAuthority: "server_authoritative",
    status: "available",
    baseRevision: receipt.baseRevisionId,
    source,
    provenance: [source, beforeSource, afterSource],
    freshness: { state: "fresh", observedAt: receipt.simulatedAtISO },
    confidence: {
      level: "high",
      basis: "The exact server projection matches its immutable simulation receipt."
    },
    why: input.why,
    consequence: input.consequence,
    doNothing: input.doNothing,
    before: { facts: beforeFacts, commercial: beforeCommercial },
    after: { facts: afterFacts, commercial: afterCommercial },
    deltas,
    commercialDeltas: commercialDeltas(beforeCommercial, afterCommercial, currency),
    affectedDependencies: serverDependencies(simulation.impact.dependentNodes),
    warnings: uniqueStrings([
      ...(input.warnings || []),
      simulation.boundary,
      SERVER_SIMULATION_PREVIEW_BOUNDARY
    ]),
    unavailableReasons: [],
    receipt: serverReceiptSummary(receipt)
  });
}
