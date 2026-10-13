const SHA256_PATTERN = /^[a-f0-9]{64}$/u;
const INTEGER_STRING_PATTERN = /^(?:0|[1-9]\d*)$/u;
const COST_STATES = new Set(["complete", "partial", "unavailable", "invalid"]);
const AVAILABILITY_STATES = new Set(["available", "shortage", "unavailable", "invalid"]);
const MAX_INGREDIENT_CONTRIBUTIONS = 128;

function text(value) {
  return String(value ?? "").trim();
}

function isRecord(value) {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}

function deepFreeze(value) {
  if (!value || typeof value !== "object" || Object.isFrozen(value)) return value;
  Object.values(value).forEach(deepFreeze);
  return Object.freeze(value);
}

function exactSafeInteger(value) {
  return Number.isSafeInteger(value) && value >= 0;
}

function exactRational(value) {
  if (!isRecord(value)) return null;
  const numerator = text(value.numerator);
  const denominator = text(value.denominator);
  if (!INTEGER_STRING_PATTERN.test(numerator) || !/^[1-9]\d*$/u.test(denominator)
    || numerator.length > 32 || denominator.length > 32) return null;
  return { numerator, denominator };
}

function causalCommercialProvenance(value) {
  if (!isRecord(value)) return null;
  const kind = text(value.kind);
  const sourceId = text(value.sourceId);
  if (!sourceId || !["direct", "package_inclusion"].includes(kind)) return null;
  if (kind === "direct") return { kind, sourceId };
  const packageId = text(value.packageId);
  const inclusionId = text(value.inclusionId);
  return packageId && inclusionId ? { kind, sourceId, packageId, inclusionId } : null;
}

function causalContributions(value) {
  if (value === undefined) return [];
  if (!Array.isArray(value) || value.length > MAX_INGREDIENT_CONTRIBUTIONS) return null;
  const rows = [];
  const identities = new Set();
  for (const contribution of value) {
    const selectionId = text(contribution?.selectionId);
    const menuItemId = text(contribution?.menuItemId);
    const recipeRevisionId = text(contribution?.recipeRevisionId);
    const recipeDigest = text(contribution?.recipeDigest);
    const exactRequiredQuantityMicros = exactRational(contribution?.exactRequiredQuantityMicros);
    const commercialProvenance = causalCommercialProvenance(contribution?.commercialProvenance);
    const identity = `${selectionId}\u0000${menuItemId}`;
    if (!selectionId || !menuItemId || !recipeRevisionId || !SHA256_PATTERN.test(recipeDigest)
      || !exactRequiredQuantityMicros || !commercialProvenance || identities.has(identity)) return null;
    identities.add(identity);
    rows.push({
      selectionId,
      menuItemId,
      recipeRevisionId,
      recipeDigest,
      exactRequiredQuantityMicros,
      commercialProvenance
    });
  }
  return rows.sort((left, right) => left.menuItemId.localeCompare(right.menuItemId)
    || left.selectionId.localeCompare(right.selectionId));
}

function digest(value) {
  const normalized = text(value);
  return SHA256_PATTERN.test(normalized) ? normalized : "";
}

function canonicalSourceFingerprint(value) {
  if (!isRecord(value)) return "";
  const normalize = (entry) => {
    if (Array.isArray(entry)) return entry.map(normalize);
    if (isRecord(entry)) {
      return Object.fromEntries(Object.keys(entry).sort().map((key) => [key, normalize(entry[key])]));
    }
    if (["string", "number", "boolean"].includes(typeof entry) || entry === null) return entry;
    throw new TypeError("Inventory source revisions contain unsupported evidence.");
  };
  try {
    return JSON.stringify(normalize(value));
  } catch {
    return "";
  }
}

function exactProjectionIdentity(projection, { persisted }) {
  if (!isRecord(projection)) return null;
  const sourceRevisions = isRecord(projection.sourceRevisions) ? projection.sourceRevisions : null;
  const identity = {
    organizationId: text(projection.organizationId),
    quoteId: text(projection.quoteId),
    quoteRevisionId: text(projection.quoteRevisionId),
    eventRequirementRevisionId: text(projection.eventRequirementRevisionId),
    requirementRevision: projection.requirementRevision,
    requirementDigest: digest(projection.requirementDigest),
    projectionDigest: digest(projection.projectionDigest),
    projectionVersion: text(projection.projectionVersion),
    sourceFingerprint: canonicalSourceFingerprint(sourceRevisions)
  };
  if (!identity.organizationId || !identity.quoteId || !identity.quoteRevisionId
    || !identity.eventRequirementRevisionId
    || (persisted && (!Number.isSafeInteger(identity.requirementRevision) || identity.requirementRevision < 1))
    || (!persisted && identity.requirementRevision !== undefined)
    || !identity.requirementDigest || !identity.projectionDigest || !identity.projectionVersion
    || !identity.sourceFingerprint) return null;
  return identity;
}

function projectionRows(projection) {
  if (!Array.isArray(projection?.ingredients)) return null;
  const rows = [];
  const keys = new Set();
  for (const value of projection.ingredients) {
    const ingredientId = text(value?.ingredientId);
    const baseUnitId = text(value?.baseUnitId);
    const key = `${ingredientId}\u0000${baseUnitId}`;
    if (!ingredientId || !baseUnitId || keys.has(key)
      || !exactSafeInteger(value?.requiredQuantityMicros)
      || !AVAILABILITY_STATES.has(value?.availabilityState)) return null;
    const hasQuantities = ["available", "shortage"].includes(value.availabilityState);
    const contributions = causalContributions(value.contributions);
    if (contributions === null) return null;
    const quantities = {};
    for (const field of [
      "onHandQuantityMicros", "committedQuantityMicros",
      "availableToAllocateQuantityMicros", "shortageQuantityMicros"
    ]) {
      if (hasQuantities && !exactSafeInteger(value[field])) return null;
      quantities[field] = hasQuantities ? value[field] : null;
    }
    keys.add(key);
    rows.push({
      key,
      ingredientId,
      baseUnitId,
      requiredQuantityMicros: value.requiredQuantityMicros,
      availabilityState: value.availabilityState,
      ingredientName: text(value.ingredientName),
      contributions,
      ...quantities
    });
  }
  return rows.sort((left, right) => left.ingredientId.localeCompare(right.ingredientId)
    || left.baseUnitId.localeCompare(right.baseUnitId));
}

function costEvidence(projection) {
  const state = text(projection?.costState);
  if (!COST_STATES.has(state)) return { state: "invalid", currency: null, projectedCostMinor: null };
  const complete = state === "complete"
    && /^[A-Z]{3}$/u.test(text(projection.currency))
    && exactSafeInteger(projection.projectedCostMinor);
  return {
    state: complete ? "complete" : state,
    currency: complete ? projection.currency : null,
    projectedCostMinor: complete ? projection.projectedCostMinor : null
  };
}

function compareCost(beforeProjection, proposedProjection) {
  const before = costEvidence(beforeProjection);
  const proposedAfter = costEvidence(proposedProjection);
  if (before.state !== "complete" || proposedAfter.state !== "complete") {
    return { state: "incomplete", before, proposedAfter, deltaMinor: null };
  }
  if (before.currency !== proposedAfter.currency) {
    return { state: "currency_mismatch", before, proposedAfter, deltaMinor: null };
  }
  const deltaMinor = proposedAfter.projectedCostMinor - before.projectedCostMinor;
  return {
    state: deltaMinor === 0 ? "unchanged" : "changed",
    currency: before.currency,
    before,
    proposedAfter,
    deltaMinor
  };
}

function compareAvailability(beforeProjection, proposedProjection) {
  const beforeRows = projectionRows(beforeProjection);
  const proposedRows = projectionRows(proposedProjection);
  if (!beforeRows || !proposedRows) return { state: "invalid", ingredients: [] };
  const beforeByKey = new Map(beforeRows.map((row) => [row.key, row]));
  const proposedByKey = new Map(proposedRows.map((row) => [row.key, row]));
  const keys = [...new Set([...beforeByKey.keys(), ...proposedByKey.keys()])].sort();
  const ingredients = keys.map((key) => {
    const before = beforeByKey.get(key) || null;
    const proposedAfter = proposedByKey.get(key) || null;
    const exemplar = proposedAfter || before;
    const requiredDeltaMicros = (proposedAfter?.requiredQuantityMicros || 0)
      - (before?.requiredQuantityMicros || 0);
    const comparableShortage = before?.shortageQuantityMicros !== null
      && before?.shortageQuantityMicros !== undefined
      && proposedAfter?.shortageQuantityMicros !== null
      && proposedAfter?.shortageQuantityMicros !== undefined;
    return {
      ingredientId: exemplar.ingredientId,
      baseUnitId: exemplar.baseUnitId,
      before,
      proposedAfter,
      requiredDeltaMicros,
      shortageDeltaMicros: comparableShortage
        ? proposedAfter.shortageQuantityMicros - before.shortageQuantityMicros
        : null,
      changed: !before || !proposedAfter
        || requiredDeltaMicros !== 0
        || before.availabilityState !== proposedAfter.availabilityState
        || before.shortageQuantityMicros !== proposedAfter.shortageQuantityMicros
    };
  });
  const projectionStateValid = AVAILABILITY_STATES.has(beforeProjection.availabilityState)
    && AVAILABILITY_STATES.has(proposedProjection.availabilityState);
  if (!projectionStateValid) return { state: "invalid", ingredients };
  const complete = !["unavailable", "invalid"].includes(beforeProjection.availabilityState)
    && !["unavailable", "invalid"].includes(proposedProjection.availabilityState);
  return {
    state: !complete ? "incomplete" : ingredients.some((row) => row.changed) ? "changed" : "unchanged",
    beforeState: beforeProjection.availabilityState,
    proposedAfterState: proposedProjection.availabilityState,
    ingredients
  };
}

function unavailable(state, expected, issues = []) {
  return deepFreeze({
    schemaVersion: "commercial-inventory-consequences-v1",
    authority: "read_only_advisory",
    state,
    expected,
    provenance: null,
    cost: { state: "unavailable", before: null, proposedAfter: null, deltaMinor: null },
    availability: { state: "unavailable", ingredients: [] },
    issues
  });
}

/**
 * Compares immutable server evidence only. This function does not compile
 * requirements, price a quote, reserve stock, or authorize a commercial edit.
 */
export function buildCommercialInventoryConsequences({
  savedRead = null,
  scenarioPreview = null,
  organizationId = "",
  quoteId = "",
  savedQuoteRevisionId = "",
  proposedQuoteRevisionId = "",
  scenarioFingerprint = ""
} = {}) {
  const expected = {
    organizationId: text(organizationId),
    quoteId: text(quoteId),
    savedQuoteRevisionId: text(savedQuoteRevisionId),
    proposedQuoteRevisionId: text(proposedQuoteRevisionId),
    scenarioFingerprint: text(scenarioFingerprint)
  };
  if (scenarioPreview?.state === "not_evaluated") {
    return unavailable("not_evaluated", expected, ["scenario_preview_missing"]);
  }
  if (["pending", "loading"].includes(scenarioPreview?.state)) {
    return unavailable("pending", expected, ["scenario_preview_pending"]);
  }
  if (scenarioPreview?.state !== "current" || !scenarioPreview?.projection) {
    return unavailable("unavailable", expected, ["scenario_preview_unavailable"]);
  }
  if (text(scenarioPreview.scenarioFingerprint) !== expected.scenarioFingerprint) {
    return unavailable("stale", expected, ["scenario_fingerprint_changed"]);
  }
  if (savedRead?.sourceState !== "current" || savedRead?.state !== "recorded"
    || savedRead?.projection?.freshness !== "as_recorded") {
    return unavailable("stale", expected, ["saved_projection_not_server_current"]);
  }
  if (scenarioPreview.projection.freshness !== "preview") {
    return unavailable("mismatched", expected, ["scenario_projection_not_server_preview"]);
  }
  const before = exactProjectionIdentity(savedRead.projection, { persisted: true });
  const proposedAfter = exactProjectionIdentity(scenarioPreview.projection, { persisted: false });
  if (!before || !proposedAfter) {
    return unavailable("mismatched", expected, ["projection_provenance_invalid"]);
  }
  const identityMatches = before.organizationId === expected.organizationId
    && proposedAfter.organizationId === expected.organizationId
    && before.quoteId === expected.quoteId
    && proposedAfter.quoteId === expected.quoteId
    && before.quoteRevisionId === expected.savedQuoteRevisionId
    && proposedAfter.quoteRevisionId === expected.proposedQuoteRevisionId;
  if (!identityMatches) {
    return unavailable("mismatched", expected, ["projection_identity_mismatch"]);
  }
  return deepFreeze({
    schemaVersion: "commercial-inventory-consequences-v2",
    authority: "read_only_advisory",
    state: "current",
    expected,
    provenance: {
      before,
      proposedAfter: { ...proposedAfter, scenarioFingerprint: expected.scenarioFingerprint }
    },
    cost: compareCost(savedRead.projection, scenarioPreview.projection),
    availability: compareAvailability(savedRead.projection, scenarioPreview.projection),
    issues: []
  });
}

export default buildCommercialInventoryConsequences;
