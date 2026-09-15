import { buildFulfillmentProjection } from "./fulfillmentProjection";

const EVIDENCE_STATES = Object.freeze({
  AVAILABLE: "available",
  NOT_YET_AVAILABLE: "not_yet_available",
  MISSING: "missing",
  STALE: "stale",
  BLOCKED: "blocked_by_integration",
  CONTRADICTORY: "contradictory",
  SCHEMA_DRIFT: "schema_drift",
  NOT_APPLICABLE: "not_applicable"
});
const SHA256_PATTERN = /^[a-f0-9]{64}$/u;
const STAFFING_ROLES = Object.freeze(["lead", "server", "chef", "bartender"]);

const PRESENTATION_BOUNDARY = [
  "This living commercial twin is a presentation-only projection composed from bounded source evidence.",
  "It does not price a quote, infer portions or staffing, reserve inventory, regenerate a BEO, authorize a change, or apply a revision."
].join(" ");

function text(value) {
  return String(value ?? "").trim();
}

function record(value) {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}

function exactGuestCount(value) {
  const parsed = typeof value === "number" ? value : Number(value);
  return Number.isSafeInteger(parsed) && parsed >= 0 ? parsed : null;
}

function finiteNumber(value) {
  return typeof value === "number" && Number.isFinite(value) ? value : null;
}

function exactNonNegativeInteger(value) {
  return Number.isSafeInteger(value) && value >= 0 ? value : null;
}

function exactPositiveInteger(value) {
  return Number.isSafeInteger(value) && value >= 1 ? value : null;
}

function deepFreeze(value, seen = new WeakSet()) {
  if (!value || typeof value !== "object" || seen.has(value)) return value;
  seen.add(value);
  Reflect.ownKeys(value).forEach((key) => deepFreeze(value[key], seen));
  return Object.freeze(value);
}

function menuItemNames(values) {
  if (!Array.isArray(values)) return [];
  const seen = new Set();
  return values.reduce((names, value) => {
    const name = text(value);
    if (name && !seen.has(name)) {
      seen.add(name);
      names.push(name);
    }
    return names;
  }, []);
}

function menuItems(values, legacyNames = []) {
  if (Array.isArray(values)) {
    const seen = new Set();
    const rows = values.flatMap((value) => {
      const menuItemId = text(value?.menuItemId || value?.id);
      const label = text(value?.label || value?.menuItemName || value?.name);
      if (!menuItemId || !label || seen.has(menuItemId)) return [];
      seen.add(menuItemId);
      return [{ menuItemId, label }];
    });
    if (rows.length) return rows;
  }
  return menuItemNames(legacyNames).map((label) => ({ menuItemId: null, label }));
}

function workbenchRequestEnvelope(value) {
  if (!record(value)) return null;
  const scenarioId = text(value.scenarioId);
  const inputDigest = text(value.inputDigest);
  const baseQuoteRevisionId = text(value.baseQuoteRevisionId);
  const guestCount = exactGuestCount(value.guestCount);
  const generation = Number(value.generation);
  if (
    !scenarioId
    || !inputDigest
    || !baseQuoteRevisionId
    || guestCount === null
    || !Number.isSafeInteger(generation)
    || generation < 0
  ) return null;
  return {
    scenarioId,
    generation,
    inputDigest,
    baseQuoteRevisionId,
    guestCount
  };
}

function stableComparableValue(value) {
  if (Array.isArray(value)) return value.map(stableComparableValue);
  if (!record(value)) return value;
  return Object.fromEntries(
    Object.keys(value).sort().map((key) => [key, stableComparableValue(value[key])])
  );
}

export function hasCommercialFormChanges({ currentForm = null, proposedForm = null } = {}) {
  if (!record(currentForm) || !record(proposedForm)) return true;
  const ignoredFields = new Set(["attendancePlanning"]);
  const keys = [...new Set([...Object.keys(currentForm), ...Object.keys(proposedForm)])]
    .filter((key) => !ignoredFields.has(key))
    .sort();
  return keys.some((key) => (
    JSON.stringify(stableComparableValue(currentForm[key]))
      !== JSON.stringify(stableComparableValue(proposedForm[key]))
  ));
}

export function isGuestCountOnlyProposal({ currentForm = null, proposedForm = null } = {}) {
  if (!record(currentForm) || !record(proposedForm)) return false;
  const currentGuestCount = exactGuestCount(currentForm.guests);
  const proposedGuestCount = exactGuestCount(proposedForm.guests);
  if (currentGuestCount === null || proposedGuestCount === null
    || currentGuestCount === proposedGuestCount) return false;
  const ignoredFields = new Set(["guests", "attendancePlanning"]);
  const keys = [...new Set([...Object.keys(currentForm), ...Object.keys(proposedForm)])]
    .filter((key) => !ignoredFields.has(key))
    .sort();
  return keys.every((key) => (
    JSON.stringify(stableComparableValue(currentForm[key]))
      === JSON.stringify(stableComparableValue(proposedForm[key]))
  ));
}

export function buildLivingCommercialTwinScenarioContextFingerprint({
  form = null,
  selections = []
} = {}) {
  const nonGuestForm = record(form)
    ? Object.fromEntries(
      Object.entries(form).filter(([key]) => !["guests", "attendancePlanning"].includes(key))
    )
    : {};
  return JSON.stringify(stableComparableValue({
    form: nonGuestForm,
    selections: Array.isArray(selections) ? selections : []
  }));
}

/**
 * Selects the still-current saved projection as read-only comparison evidence
 * while a draft is dirty. This does not change hook state or relax any record,
 * allocation, reconciliation, or apply guard.
 */
export function getSavedInventoryComparisonRead(read) {
  if (!record(read) || read.state !== "draft_not_evaluated") return read;
  if (read.sourceState !== "current"
    || read.savedProjectionState !== "recorded"
    || read.projection?.freshness !== "as_recorded") return read;
  return { ...read, state: "recorded" };
}

export function buildLivingCommercialTwinInventoryFingerprint({
  commercialFormFingerprint = "",
  selections = []
} = {}) {
  return JSON.stringify({
    commercialFormFingerprint: text(commercialFormFingerprint),
    selections: Array.isArray(selections) ? selections : []
  });
}

function dependencyNodes(commercialModel) {
  const nodes = commercialModel?.impact?.dependentNodes;
  if (!Array.isArray(nodes)) return [];
  return nodes.flatMap((node) => {
    const id = text(node?.id || node?.nodeId);
    if (!id) return [];
    const advisoryClass = text(node?.advisoryClass || node?.classification).toUpperCase();
    return [{
      id,
      advisoryClass: ["REVIEW", "STALE"].includes(advisoryClass) ? advisoryClass : "REVIEW",
      triggeredBy: Array.isArray(node?.triggeredBy)
        ? node.triggeredBy.map(text).filter(Boolean)
        : []
    }];
  });
}

function isStaffingDependency(node) {
  return /(^|[._-])staff(ing)?([._-]|$)/u.test(node.id.toLowerCase());
}

function isBeoDependency(node) {
  return /(^|[._-])beo([._-]|$)|banquet[._-]?event[._-]?order/u.test(node.id.toLowerCase());
}

function previewEvidenceState({
  scenarioChanged,
  previewAvailable,
  previewRequested,
  previewLoading,
  previewError,
  previewScopeCurrent,
  commercialModel
}) {
  if (!scenarioChanged) return EVIDENCE_STATES.NOT_APPLICABLE;
  const hasPreview = record(commercialModel);
  const requested = previewRequested === true || previewLoading === true || hasPreview;
  if (previewLoading) {
    return hasPreview ? EVIDENCE_STATES.STALE : EVIDENCE_STATES.NOT_YET_AVAILABLE;
  }
  if (previewError) {
    return hasPreview ? EVIDENCE_STATES.STALE : EVIDENCE_STATES.BLOCKED;
  }
  if (previewAvailable !== true && !hasPreview) return EVIDENCE_STATES.BLOCKED;
  if (!requested) return EVIDENCE_STATES.NOT_YET_AVAILABLE;
  if (!hasPreview || !record(commercialModel)) return EVIDENCE_STATES.MISSING;
  if (previewScopeCurrent !== true) return EVIDENCE_STATES.STALE;
  if (!record(commercialModel.commercialValues) || !record(commercialModel.impact)) {
    return EVIDENCE_STATES.MISSING;
  }
  return EVIDENCE_STATES.AVAILABLE;
}

function moneyChange(value) {
  const before = finiteNumber(value?.before);
  const proposedAfter = finiteNumber(value?.proposedAfter);
  return {
    before,
    proposedAfter,
    delta: before !== null && proposedAfter !== null ? proposedAfter - before : null,
    changed: before !== null && proposedAfter !== null
      ? proposedAfter !== before
      : value?.changed === true,
    authority: text(value?.authority) || null
  };
}

function commercialRail(commercialModel, evidenceState) {
  const values = commercialModel?.commercialValues;
  const nodes = dependencyNodes(commercialModel);
  if (evidenceState !== EVIDENCE_STATES.AVAILABLE) {
    return {
      evidenceState,
      currency: null,
      total: moneyChange(null),
      depositRequirement: moneyChange(null),
      dependentCount: null,
      reviewCount: null,
      staleCount: null,
      boundary: "Authoritative commercial values are unavailable for this exact current scenario."
    };
  }
  return {
    evidenceState,
    currency: text(values?.currency).toUpperCase() || null,
    total: moneyChange(values?.authoritativeTotal),
    depositRequirement: moneyChange(values?.depositRequirement),
    dependentCount: nodes.length,
    reviewCount: nodes.filter((node) => node.advisoryClass === "REVIEW").length,
    staleCount: nodes.filter((node) => node.advisoryClass === "STALE").length,
    boundary: text(commercialModel?.boundary)
      || "Values are carried from the authoritative server preview; this projection performs no pricing."
  };
}

function inventoryEvidenceState({
  scenarioChanged,
  inventoryScenarioEligible,
  inventoryEnabled,
  inventoryInputReady,
  inventoryConsequences,
  inventoryPreview,
  inventoryInspection
}) {
  if (!scenarioChanged) return EVIDENCE_STATES.NOT_APPLICABLE;
  if (inventoryScenarioEligible !== true) return EVIDENCE_STATES.NOT_APPLICABLE;
  if (inventoryEnabled === false) return EVIDENCE_STATES.BLOCKED;
  if (inventoryEnabled !== true) return EVIDENCE_STATES.BLOCKED;
  if (inventoryInputReady !== true) return EVIDENCE_STATES.MISSING;
  if (inventoryConsequences?.state === "current") {
    return inventoryInspection?.evidenceState || EVIDENCE_STATES.SCHEMA_DRIFT;
  }
  if ([EVIDENCE_STATES.CONTRADICTORY, EVIDENCE_STATES.SCHEMA_DRIFT]
    .includes(text(inventoryConsequences?.state))) {
    return text(inventoryConsequences.state);
  }
  if (["pending", "loading"].includes(inventoryConsequences?.state)
    || ["pending", "loading"].includes(inventoryPreview?.state)) {
    return EVIDENCE_STATES.NOT_YET_AVAILABLE;
  }
  if (["stale", "mismatched"].includes(inventoryConsequences?.state)
    || inventoryPreview?.state === "stale") {
    return EVIDENCE_STATES.STALE;
  }
  if (inventoryConsequences?.state === "not_evaluated"
    || inventoryPreview?.state === "not_evaluated"
    || (!inventoryConsequences && !inventoryPreview)) {
    return EVIDENCE_STATES.NOT_YET_AVAILABLE;
  }
  return EVIDENCE_STATES.BLOCKED;
}

function inventoryProjectionIdentity(value, { persisted = false, proposed = false } = {}) {
  if (!record(value)) return null;
  const organizationId = text(value.organizationId);
  const quoteId = text(value.quoteId);
  const quoteRevisionId = text(value.quoteRevisionId);
  const eventRequirementRevisionId = text(value.eventRequirementRevisionId);
  const requirementRevision = persisted ? exactPositiveInteger(value.requirementRevision) : null;
  const requirementDigest = text(value.requirementDigest);
  const projectionDigest = text(value.projectionDigest);
  const projectionVersion = text(value.projectionVersion);
  const sourceFingerprint = text(value.sourceFingerprint);
  const scenarioFingerprint = proposed ? text(value.scenarioFingerprint) : null;
  if (!organizationId || !quoteId || !quoteRevisionId || !eventRequirementRevisionId
    || (persisted && requirementRevision === null)
    || !SHA256_PATTERN.test(requirementDigest) || !SHA256_PATTERN.test(projectionDigest)
    || !projectionVersion || !sourceFingerprint || (proposed && !scenarioFingerprint)) {
    return null;
  }
  return {
    organizationId,
    quoteId,
    quoteRevisionId,
    eventRequirementRevisionId,
    ...(persisted ? { requirementRevision } : {}),
    requirementDigest,
    projectionDigest,
    projectionVersion,
    sourceFingerprint,
    ...(proposed ? { scenarioFingerprint } : {})
  };
}

function inspectInventoryConsequences(
  inventoryConsequences,
  { organizationId, quoteId, quoteRevisionId, scenarioId } = {}
) {
  if (inventoryConsequences?.state !== "current") {
    return { evidenceState: null, provenance: null };
  }
  if (inventoryConsequences.schemaVersion !== "commercial-inventory-consequences-v1"
    || inventoryConsequences.authority !== "read_only_advisory"
    || !record(inventoryConsequences.expected)) {
    return { evidenceState: EVIDENCE_STATES.SCHEMA_DRIFT, provenance: null };
  }
  const before = inventoryProjectionIdentity(inventoryConsequences.provenance?.before, {
    persisted: true
  });
  const proposedAfter = inventoryProjectionIdentity(inventoryConsequences.provenance?.proposedAfter, {
    proposed: true
  });
  if (!before || !proposedAfter) {
    return { evidenceState: EVIDENCE_STATES.SCHEMA_DRIFT, provenance: null };
  }
  const expected = {
    organizationId: text(inventoryConsequences.expected.organizationId),
    quoteId: text(inventoryConsequences.expected.quoteId),
    quoteRevisionId: text(inventoryConsequences.expected.savedQuoteRevisionId),
    scenarioId: text(inventoryConsequences.expected.scenarioFingerprint)
  };
  if (!expected.organizationId || !expected.quoteId || !expected.quoteRevisionId || !expected.scenarioId) {
    return { evidenceState: EVIDENCE_STATES.SCHEMA_DRIFT, provenance: null };
  }
  if (before.organizationId !== proposedAfter.organizationId
    || before.quoteId !== proposedAfter.quoteId
    || before.quoteRevisionId !== proposedAfter.quoteRevisionId
    || proposedAfter.scenarioFingerprint !== expected.scenarioId
    || before.organizationId !== expected.organizationId
    || before.quoteId !== expected.quoteId
    || before.quoteRevisionId !== expected.quoteRevisionId) {
    return { evidenceState: EVIDENCE_STATES.CONTRADICTORY, provenance: null };
  }
  if (expected.organizationId !== text(organizationId)
    || expected.quoteId !== text(quoteId)
    || expected.quoteRevisionId !== text(quoteRevisionId)
    || expected.scenarioId !== text(scenarioId)) {
    return { evidenceState: EVIDENCE_STATES.STALE, provenance: null };
  }
  return {
    evidenceState: EVIDENCE_STATES.AVAILABLE,
    provenance: {
      quoteRevisionId: expected.quoteRevisionId,
      scenarioFingerprint: expected.scenarioId,
      before,
      proposedAfter
    }
  };
}

function ingredientRows(inventoryConsequences) {
  const rows = inventoryConsequences?.availability?.ingredients;
  if (!Array.isArray(rows)) return [];
  return rows.flatMap((row) => {
    const ingredientId = text(row?.ingredientId);
    const baseUnitId = text(row?.baseUnitId);
    if (!ingredientId || !baseUnitId) return [];
    const beforeRequired = exactNonNegativeInteger(row?.before?.requiredQuantityMicros);
    const proposedRequired = exactNonNegativeInteger(row?.proposedAfter?.requiredQuantityMicros);
    const beforeShortage = exactNonNegativeInteger(row?.before?.shortageQuantityMicros);
    const proposedShortage = exactNonNegativeInteger(row?.proposedAfter?.shortageQuantityMicros);
    const contributionReferences = (value) => {
      if (!Array.isArray(value)) return [];
      const seen = new Set();
      return value.flatMap((entry) => {
        const selectionId = text(entry?.selectionId);
        const menuItemId = text(entry?.menuItemId);
        const recipeRevisionId = text(entry?.recipeRevisionId);
        const recipeDigest = text(entry?.recipeDigest);
        const numerator = text(entry?.exactRequiredQuantityMicros?.numerator);
        const denominator = text(entry?.exactRequiredQuantityMicros?.denominator);
        const provenanceKind = text(entry?.commercialProvenance?.kind);
        const provenanceSourceId = text(entry?.commercialProvenance?.sourceId);
        const provenancePackageId = text(entry?.commercialProvenance?.packageId);
        const provenanceInclusionId = text(entry?.commercialProvenance?.inclusionId);
        const commercialProvenance = provenanceKind === "direct" && provenanceSourceId
          ? { kind: provenanceKind, sourceId: provenanceSourceId }
          : provenanceKind === "package_inclusion" && provenanceSourceId
            && provenancePackageId && provenanceInclusionId
            ? {
                kind: provenanceKind,
                sourceId: provenanceSourceId,
                packageId: provenancePackageId,
                inclusionId: provenanceInclusionId
              }
            : null;
        const identity = `${selectionId}\u0000${menuItemId}`;
        if (!selectionId || !menuItemId || !recipeRevisionId
          || !SHA256_PATTERN.test(recipeDigest)
          || !/^(?:0|[1-9]\d*)$/u.test(numerator)
          || !/^[1-9]\d*$/u.test(denominator)
          || !commercialProvenance
          || seen.has(identity)) return [];
        seen.add(identity);
        return [{
          selectionId,
          menuItemId,
          recipeRevisionId,
          recipeDigest,
          exactRequiredQuantityMicros: { numerator, denominator },
          commercialProvenance
        }];
      });
    };
    return [{
      ingredientId,
      ingredientName: text(row?.proposedAfter?.ingredientName || row?.before?.ingredientName) || null,
      baseUnitId,
      requiredQuantityMicros: {
        before: beforeRequired,
        proposedAfter: proposedRequired,
        delta: Number.isSafeInteger(row?.requiredDeltaMicros)
          ? row.requiredDeltaMicros
          : beforeRequired !== null && proposedRequired !== null
            ? proposedRequired - beforeRequired
            : null
      },
      shortageQuantityMicros: {
        before: beforeShortage,
        proposedAfter: proposedShortage,
        delta: Number.isSafeInteger(row?.shortageDeltaMicros)
          ? row.shortageDeltaMicros
          : beforeShortage !== null && proposedShortage !== null
            ? proposedShortage - beforeShortage
            : null
      },
      contributions: {
        before: contributionReferences(row?.before?.contributions),
        proposedAfter: contributionReferences(row?.proposedAfter?.contributions)
      },
      proposedAvailabilityState: text(row?.proposedAfter?.availabilityState) || null,
      changed: row?.changed === true
    }];
  });
}

function inventoryRail(
  inventoryConsequences,
  evidenceState,
  {
    proposalChanged = false,
    guestCountChanged = false,
    inventoryScenarioEligible = false
  } = {}
) {
  if (evidenceState !== EVIDENCE_STATES.AVAILABLE) {
    const applicability = evidenceState === EVIDENCE_STATES.NOT_APPLICABLE
      ? proposalChanged && guestCountChanged && !inventoryScenarioEligible
        ? "mixed_proposal_outside_slice"
        : proposalChanged && !guestCountChanged
          ? "outside_guest_count_slice"
          : "no_guest_count_proposal"
      : "applicable";
    return {
      evidenceState,
      completenessState: "unavailable",
      applicability,
      cost: {
        state: "unavailable",
        currency: null,
        beforeMinor: null,
        proposedAfterMinor: null,
        deltaMinor: null
      },
      availability: { state: "unavailable", beforeState: null, proposedAfterState: null },
      ingredients: [],
      shortages: [],
      boundary: evidenceState === EVIDENCE_STATES.MISSING
        ? "Exact menu-output quantities and their declared portion basis are required; guest count is never used to infer portions."
        : applicability === "outside_guest_count_slice"
          ? "This foundation slice does not evaluate inventory consequences for non-guest draft edits; no no-effect conclusion is made."
          : applicability === "mixed_proposal_outside_slice"
            ? "This proposal changes guest count and other commercial inputs. Inventory is not evaluated from saved menu evidence, so no current or no-effect conclusion is made."
          : applicability === "no_guest_count_proposal"
            ? "There is no guest-count proposal to compare. Saved ingredient evaluation remains available in the detailed evidence disclosure."
            : "Inventory remains an independent read-only projection and is not evidence of reservation or allocation."
    };
  }
  const cost = inventoryConsequences.cost || {};
  const availability = inventoryConsequences.availability || {};
  const rows = ingredientRows(inventoryConsequences);
  const shortages = rows.filter((row) => (
    row.proposedAvailabilityState === "shortage"
    || (row.shortageQuantityMicros.proposedAfter ?? 0) > 0
  ));
  return {
    evidenceState,
    completenessState: ["changed", "unchanged"].includes(cost.state)
      && ["changed", "unchanged"].includes(availability.state)
      ? "complete"
      : "partial",
    applicability: "applicable",
    cost: {
      state: text(cost.state) || "unavailable",
      currency: text(cost.currency || cost.before?.currency || cost.proposedAfter?.currency).toUpperCase() || null,
      beforeMinor: exactNonNegativeInteger(cost.before?.projectedCostMinor),
      proposedAfterMinor: exactNonNegativeInteger(cost.proposedAfter?.projectedCostMinor),
      deltaMinor: Number.isSafeInteger(cost.deltaMinor) ? cost.deltaMinor : null
    },
    availability: {
      state: text(availability.state) || "unavailable",
      beforeState: text(availability.beforeState) || null,
      proposedAfterState: text(availability.proposedAfterState) || null
    },
    ingredients: rows,
    shortages,
    boundary: "Exact server projection evidence only; no portion, stock, allocation, or purchase-policy inference is added here."
  };
}

function fulfillmentShortages(inventory, key) {
  return inventory.ingredients.flatMap((row) => {
    const shortageQuantityMicros = exactNonNegativeInteger(row?.shortageQuantityMicros?.[key]);
    if (shortageQuantityMicros === null || shortageQuantityMicros <= 0) return [];
    return [{
      resourceId: row.ingredientId,
      resourceLabel: row.ingredientName || row.ingredientId,
      shortageQuantityMicros,
      unitId: row.baseUnitId
    }];
  });
}

function buildFulfillmentSupplyInput({
  inventory,
  inventoryProvenance,
  inventoryObservedAtISO,
  inventoryHeadroomEvidence,
  organizationId,
  quoteId,
  quoteRevisionId,
  scenarioId,
  currentGuestCount,
  proposedGuestCount
}) {
  const available = inventory.evidenceState === EVIDENCE_STATES.AVAILABLE;
  const currentShortages = available ? fulfillmentShortages(inventory, "before") : [];
  const proposedShortages = available ? fulfillmentShortages(inventory, "proposedAfter") : [];
  const availabilityExact = available
    && ["changed", "unchanged"].includes(inventory.availability.state);
  const coverageState = (shortages, declaredState) => {
    if (shortages.length) return "shortage";
    return availabilityExact && ["available", "covered"].includes(text(declaredState).toLowerCase())
      ? "covered"
      : "unknown";
  };
  const projectedCost = (amountMinor) => ({
    amountMinor,
    currency: inventory.cost.currency
  });
  return {
    state: inventory.evidenceState,
    evidenceState: inventory.evidenceState,
    freshness: available ? "current" : inventory.evidenceState === EVIDENCE_STATES.STALE ? "stale" : "unavailable",
    completeness: inventory.completenessState === "complete" ? "complete" : "partial",
    organizationId,
    quoteId,
    quoteRevisionId,
    scenarioId,
    truncated: false,
    current: {
      guestCount: currentGuestCount,
      coverageState: coverageState(currentShortages, inventory.availability.beforeState),
      shortages: currentShortages,
      projectedCost: projectedCost(inventory.cost.beforeMinor)
    },
    proposed: {
      guestCount: proposedGuestCount,
      coverageState: coverageState(proposedShortages, inventory.availability.proposedAfterState),
      shortages: proposedShortages,
      projectedCost: projectedCost(inventory.cost.proposedAfterMinor)
    },
    inventoryHeadroom: inventoryHeadroomEvidence,
    sourceRevisions: inventoryProvenance ? {
      ...inventoryProvenance,
      observedAtISO: text(inventoryObservedAtISO) || null
    } : null
  };
}

function buildFulfillmentPeopleInput(staffingRead) {
  const envelope = record(staffingRead?.envelope) ? staffingRead.envelope : {};
  const readState = text(staffingRead?.state) || "not_evaluated";
  const exactEmpty = readState === "empty" && envelope.snapshot == null;
  return {
    ...envelope,
    state: readState,
    ...(exactEmpty ? { evidenceState: EVIDENCE_STATES.AVAILABLE, assignments: [] } : {}),
    freshness: ["current", "empty", "partial"].includes(readState)
      ? "current"
      : readState === "stale" ? "stale" : "unavailable",
    quoteRevisionId: text(envelope.activeQuoteRevisionId || envelope.snapshot?.quoteRevisionId) || null,
    sourceRevisions: {
      authorityVersion: text(envelope.authorityVersion) || null,
      planRevision: envelope.snapshot?.planRevision,
      observedAtISO: text(staffingRead?.observedAtISO || envelope.observedAtISO) || null
    }
  };
}

function dependencyRail({ evidenceState, nodes, kind }) {
  if (evidenceState !== EVIDENCE_STATES.AVAILABLE) {
    return {
      evidenceState,
      effect: null,
      dependentNodeIds: [],
      inferredQuantity: null,
      boundary: kind === "staffing"
        ? "No staffing quantity or labor requirement is inferred from guest count."
        : "No BEO state is inferred without a current dependency preview."
    };
  }
  const matching = nodes.filter(kind === "staffing" ? isStaffingDependency : isBeoDependency);
  if (!matching.length) {
    return {
      evidenceState: EVIDENCE_STATES.NOT_APPLICABLE,
      effect: "no_declared_dependency",
      dependentNodeIds: [],
      inferredQuantity: null,
      boundary: kind === "staffing"
        ? "The current dependency graph declared no staffing consequence; no labor quantity is inferred."
        : "The current dependency graph declared no BEO consequence; no document state is inferred."
    };
  }
  const hasStale = matching.some((node) => node.advisoryClass === "STALE");
  return {
    evidenceState: EVIDENCE_STATES.AVAILABLE,
    effect: hasStale ? "stale" : "review_required",
    dependentNodeIds: matching.map((node) => node.id),
    inferredQuantity: null,
    boundary: kind === "staffing"
      ? "Dependency review only; this does not calculate staffing levels or operational readiness."
      : "Dependency staleness/review only; this does not regenerate or approve a BEO."
  };
}

function explicitHeadroomEvidence(commercialModel, inventoryConsequences, inventoryPreview, currentGuestCount) {
  const candidates = [
    commercialModel?.guestCountHeadroom,
    inventoryConsequences?.guestCountHeadroom,
    inventoryPreview?.guestCountHeadroom
  ];
  for (const candidate of candidates) {
    if (!record(candidate) || !["available", "verified"].includes(text(candidate.evidenceState || candidate.state))) {
      continue;
    }
    const safeThroughGuestCount = exactGuestCount(candidate.safeThroughGuestCount);
    const firstBoundaryGuestCount = exactGuestCount(candidate.firstBoundaryGuestCount);
    const source = text(candidate.source || candidate.sourceAuthority || candidate.authority);
    if (safeThroughGuestCount === null || safeThroughGuestCount < currentGuestCount || !source) continue;
    return {
      evidenceState: EVIDENCE_STATES.AVAILABLE,
      verificationState: "evidence_backed",
      safeThroughGuestCount,
      firstBoundaryGuestCount,
      remainingGuests: safeThroughGuestCount - currentGuestCount,
      limitingRail: text(candidate.limitingRail) || null,
      source,
      boundary: "Headroom is carried from explicit bounded evidence; this presentation projection did not derive a capacity threshold."
    };
  }
  return null;
}

function headroomRail(commercialModel, inventoryConsequences, inventoryPreview, currentGuestCount) {
  return explicitHeadroomEvidence(
    commercialModel,
    inventoryConsequences,
    inventoryPreview,
    currentGuestCount
  ) || {
    evidenceState: EVIDENCE_STATES.NOT_YET_AVAILABLE,
    verificationState: "unverified",
    safeThroughGuestCount: null,
    firstBoundaryGuestCount: null,
    remainingGuests: null,
    limitingRail: null,
    source: null,
    boundary: "Guest-count headroom is unverified because no explicit capacity threshold evidence was supplied; no threshold is fabricated from inventory, staffing, or history."
  };
}

function operationalConstraint(inventory, staffing, beo, proposalChanged) {
  if (!proposalChanged) {
    return {
      evidenceState: EVIDENCE_STATES.NOT_APPLICABLE,
      kind: "none",
      label: "No proposed commercial change",
      requiresReview: false,
      commercialApplyBlocked: false,
      affectedIds: []
    };
  }
  if (inventory.evidenceState === EVIDENCE_STATES.AVAILABLE && inventory.shortages.length) {
    return {
      evidenceState: EVIDENCE_STATES.AVAILABLE,
      kind: "inventory_shortage",
      label: "Proposed ingredient demand includes a shortage",
      requiresReview: true,
      commercialApplyBlocked: false,
      affectedIds: inventory.shortages.map((row) => row.ingredientId)
    };
  }
  if (beo.evidenceState === EVIDENCE_STATES.AVAILABLE) {
    return {
      evidenceState: EVIDENCE_STATES.AVAILABLE,
      kind: "beo_freshness_review",
      label: "Any generated BEO requires freshness review after apply",
      requiresReview: true,
      commercialApplyBlocked: false,
      affectedIds: beo.dependentNodeIds
    };
  }
  if (staffing.evidenceState === EVIDENCE_STATES.AVAILABLE) {
    return {
      evidenceState: EVIDENCE_STATES.AVAILABLE,
      kind: "staffing_review",
      label: "The staffing plan requires review",
      requiresReview: true,
      commercialApplyBlocked: false,
      affectedIds: staffing.dependentNodeIds
    };
  }
  const unresolvedState = [inventory.evidenceState, staffing.evidenceState, beo.evidenceState]
    .find((state) => ![EVIDENCE_STATES.NOT_APPLICABLE, EVIDENCE_STATES.AVAILABLE].includes(state));
  return {
    evidenceState: unresolvedState || EVIDENCE_STATES.NOT_APPLICABLE,
    kind: "unverified_operational_consequence",
    label: "Operational constraint evidence is incomplete",
    requiresReview: Boolean(unresolvedState),
    commercialApplyBlocked: false,
    affectedIds: []
  };
}

function unavailableSourcingResolution(evidenceState = EVIDENCE_STATES.NOT_YET_AVAILABLE, reasonCode = "sourcing_evidence_missing") {
  return {
    evidenceState,
    selectionState: "none",
    supplierId: null,
    supplierLabel: null,
    ingredientId: null,
    unitId: null,
    coverageQuantityMicros: null,
    purchaseQuantityMicros: null,
    addedCostMinor: null,
    currency: null,
    policyRevisionId: null,
    offerRevisionId: null,
    basis: null,
    conditions: [],
    reasonCodes: [reasonCode],
    boundary: "No supplier, procurement, reservation, or stock-coverage claim is made without a current revision-bound Inventory sourcing preview and declared selection policy."
  };
}

function sourcingResolution(value, {
  organizationId,
  quoteId,
  quoteRevisionId,
  scenarioId,
  supplyConstraint
} = {}) {
  if (!record(value)) return unavailableSourcingResolution();
  const explicitState = text(value.evidenceState || value.state).toLowerCase();
  if (!["available", "current"].includes(explicitState)) {
    const mappedState = Object.values(EVIDENCE_STATES).includes(explicitState)
      ? explicitState
      : EVIDENCE_STATES.BLOCKED;
    return unavailableSourcingResolution(mappedState, `sourcing_evidence_${mappedState}`);
  }
  if (value.schemaVersion !== "inventory-sourcing-preview-v1"
    || value.authority !== "inventory_sourcing_read_model") {
    return unavailableSourcingResolution(EVIDENCE_STATES.SCHEMA_DRIFT, "sourcing_schema_invalid");
  }
  if (text(value.freshness) !== "current") {
    return unavailableSourcingResolution(EVIDENCE_STATES.STALE, "sourcing_evidence_stale");
  }
  if (text(value.organizationId) !== text(organizationId)
    || text(value.quoteId) !== text(quoteId)
    || text(value.quoteRevisionId) !== text(quoteRevisionId)
    || text(value.scenarioId) !== text(scenarioId)) {
    return unavailableSourcingResolution(EVIDENCE_STATES.STALE, "sourcing_scope_mismatch");
  }
  const basis = record(value.basis) ? value.basis : null;
  const basisEventRequirementRevisionId = text(basis?.eventRequirementRevisionId);
  const basisProjectionDigest = text(basis?.projectionDigest);
  const basisScenarioFingerprint = text(basis?.scenarioFingerprint);
  const basisShortageQuantityMicros = exactNonNegativeInteger(basis?.shortageQuantityMicros);
  if (!basisEventRequirementRevisionId
    || !/^[a-f0-9]{64}$/u.test(basisProjectionDigest)
    || !basisScenarioFingerprint
    || basisShortageQuantityMicros === null
    || basisShortageQuantityMicros === 0) {
    return unavailableSourcingResolution(EVIDENCE_STATES.SCHEMA_DRIFT, "sourcing_basis_invalid");
  }
  if (basisEventRequirementRevisionId !== text(supplyConstraint?.evidenceRefs?.eventRequirementRevisionId)
    || basisProjectionDigest !== text(supplyConstraint?.evidenceRefs?.projectionDigest)
    || basisScenarioFingerprint !== text(supplyConstraint?.evidenceRefs?.scenarioFingerprint)
    || basisShortageQuantityMicros !== exactNonNegativeInteger(supplyConstraint?.shortageQuantityMicros)) {
    return unavailableSourcingResolution(EVIDENCE_STATES.STALE, "sourcing_inventory_basis_mismatch");
  }
  const sourcingBasis = {
    eventRequirementRevisionId: basisEventRequirementRevisionId,
    projectionDigest: basisProjectionDigest,
    scenarioFingerprint: basisScenarioFingerprint,
    shortageQuantityMicros: basisShortageQuantityMicros
  };
  const selectionState = text(value.selectionState);
  if (["tie", "none", "policy_missing", "no_eligible_offer"].includes(selectionState)) {
    return {
      ...unavailableSourcingResolution(EVIDENCE_STATES.AVAILABLE, `sourcing_${selectionState}`),
      selectionState,
      basis: sourcingBasis
    };
  }
  if (selectionState !== "unique_policy_match" || !record(value.recommendation)) {
    return unavailableSourcingResolution(EVIDENCE_STATES.SCHEMA_DRIFT, "sourcing_selection_invalid");
  }
  const recommendation = value.recommendation;
  const supplierId = text(recommendation.supplierId);
  const supplierLabel = text(recommendation.supplierLabel);
  const ingredientId = text(recommendation.ingredientId);
  const unitId = text(recommendation.unitId);
  const coverageQuantityMicros = exactNonNegativeInteger(recommendation.coverageQuantityMicros);
  const purchaseQuantityMicros = exactNonNegativeInteger(recommendation.purchaseQuantityMicros);
  const addedCostMinor = recommendation.addedCostMinor === null
    ? null
    : exactNonNegativeInteger(recommendation.addedCostMinor);
  const currency = addedCostMinor === null ? null : text(recommendation.currency).toUpperCase();
  const policyRevisionId = text(value.policyRevisionId);
  const offerRevisionId = text(value.offerRevisionId);
  const constraintIngredientId = text(supplyConstraint?.ingredientId);
  const shortageQuantityMicros = exactNonNegativeInteger(supplyConstraint?.shortageQuantityMicros);
  if (!supplierId || !supplierLabel || !ingredientId || !unitId
    || coverageQuantityMicros === null || purchaseQuantityMicros === null
    || coverageQuantityMicros < (shortageQuantityMicros ?? 1)
    || purchaseQuantityMicros < coverageQuantityMicros
    || (addedCostMinor !== null && (!/^[A-Z]{3}$/u.test(currency)))
    || !policyRevisionId || !offerRevisionId) {
    return unavailableSourcingResolution(EVIDENCE_STATES.SCHEMA_DRIFT, "sourcing_recommendation_invalid");
  }
  if (!constraintIngredientId || ingredientId !== constraintIngredientId
    || unitId !== text(supplyConstraint?.unitId)) {
    return unavailableSourcingResolution(EVIDENCE_STATES.CONTRADICTORY, "sourcing_constraint_mismatch");
  }
  const conditions = Array.isArray(recommendation.conditions)
    ? recommendation.conditions.map(text).filter(Boolean).slice(0, 16)
    : [];
  return {
    evidenceState: EVIDENCE_STATES.AVAILABLE,
    selectionState,
    supplierId,
    supplierLabel,
    ingredientId,
    unitId,
    coverageQuantityMicros,
    purchaseQuantityMicros,
    addedCostMinor,
    currency,
    policyRevisionId,
    offerRevisionId,
    basis: sourcingBasis,
    conditions,
    reasonCodes: ["unique_current_policy_match"],
    boundary: "This recommendation is carried from a revision-bound Inventory sourcing preview. It is not stock, a reservation, a purchase order, supplier confirmation, or permission to apply the commercial change."
  };
}

function supplyDecisionConstraint(inventory, selectedMenuItems, inventoryProvenance) {
  const shortage = Array.isArray(inventory?.shortages) ? inventory.shortages[0] : null;
  const shortageQuantityMicros = exactNonNegativeInteger(
    shortage?.shortageQuantityMicros?.proposedAfter
  );
  if (!shortage || !text(shortage.ingredientId) || !text(shortage.baseUnitId)
    || shortageQuantityMicros === null || shortageQuantityMicros === 0) return null;
  const labelsById = new Map(
    selectedMenuItems
      .filter((item) => text(item.menuItemId))
      .map((item) => [text(item.menuItemId), text(item.label)])
  );
  const contributionRows = Array.isArray(shortage?.contributions?.proposedAfter)
    ? shortage.contributions.proposedAfter
    : [];
  const contributingMenuItems = contributionRows.map((entry) => ({
    menuItemId: text(entry.menuItemId),
    label: labelsById.get(text(entry.menuItemId)) || null,
    selectionId: text(entry.selectionId),
    recipeRevisionId: text(entry.recipeRevisionId),
    recipeDigest: text(entry.recipeDigest),
    exactRequiredQuantityMicros: entry.exactRequiredQuantityMicros
  }));
  const labelsComplete = contributingMenuItems.length > 0
    && contributingMenuItems.every((entry) => entry.menuItemId && entry.label);
  return {
    evidenceState: EVIDENCE_STATES.AVAILABLE,
    ingredientId: text(shortage.ingredientId),
    ingredientLabel: text(shortage.ingredientName || shortage.ingredientId),
    shortageQuantityMicros,
    unitId: text(shortage.baseUnitId),
    causalityState: labelsComplete ? "available" : EVIDENCE_STATES.NOT_YET_AVAILABLE,
    contributingMenuItems: labelsComplete ? contributingMenuItems : [],
    evidenceRefs: {
      eventRequirementRevisionId: text(inventoryProvenance?.proposedAfter?.eventRequirementRevisionId) || null,
      projectionDigest: text(inventoryProvenance?.proposedAfter?.projectionDigest) || null,
      scenarioFingerprint: text(inventoryProvenance?.scenarioFingerprint) || null
    }
  };
}

function staffingDecision(fulfillment, staffingRail) {
  const people = fulfillment?.people || {};
  const exactCoverage = people.evidenceState === EVIDENCE_STATES.AVAILABLE
    && people.completeness === "complete"
    && exactNonNegativeInteger(people?.proposed?.totalGap) !== null;
  if (!exactCoverage) {
    return {
      evidenceState: people.evidenceState || EVIDENCE_STATES.MISSING,
      effect: "unverified",
      assignmentGap: null,
      requirementDeltaByRole: [],
      reviewEffect: staffingRail?.effect || null,
      boundary: "No additional-staff conclusion is made without complete current People evidence."
    };
  }
  const requirementDeltaByRole = STAFFING_ROLES.flatMap((role) => {
    const current = exactNonNegativeInteger(people?.current?.byRole?.[role]?.required);
    const proposed = exactNonNegativeInteger(people?.proposed?.byRole?.[role]?.required);
    if (current === null || proposed === null || current === proposed) return [];
    return [{ role, before: current, proposedAfter: proposed, delta: proposed - current }];
  });
  const assignmentGap = people.proposed.totalGap;
  return {
    evidenceState: EVIDENCE_STATES.AVAILABLE,
    effect: assignmentGap > 0
      ? "additional_assignments_required"
      : "current_assignments_cover_proposed_requirement",
    assignmentGap,
    requirementDeltaByRole,
    reviewEffect: staffingRail?.effect || null,
    boundary: assignmentGap > 0
      ? "The gap compares proposed requirements with current-revision operator-confirmed assignments; it does not assign or contact anyone."
      : "Current operator-confirmed assignments cover the proposed role requirement; this does not waive any separately declared staffing review."
  };
}

function commercialValueDecision(commercial) {
  const amount = finiteNumber(commercial?.total?.proposedAfter);
  const currency = text(commercial?.currency).toUpperCase();
  if (commercial?.evidenceState !== EVIDENCE_STATES.AVAILABLE
    || amount === null || !/^[A-Z]{3}$/u.test(currency)) {
    return {
      evidenceState: commercial?.evidenceState || EVIDENCE_STATES.MISSING,
      kind: "proposed_quote_total",
      amount: null,
      currency: null,
      authority: null,
      boundary: "No commercial value is attributed without an exact authoritative pricing preview."
    };
  }
  return {
    evidenceState: EVIDENCE_STATES.AVAILABLE,
    kind: "proposed_quote_total",
    amount,
    currency,
    authority: text(commercial?.total?.authority) || null,
    boundary: "This is proposed quote value, not earned revenue, booked value, payment, or a guaranteed counterfactual amount preserved by a resolution."
  };
}

function buildDecisionAnswer({
  organizationId,
  quoteId,
  quoteRevisionId,
  scenarioId,
  proposedGuestCount,
  selectedMenuItems,
  commercial,
  inventory,
  staffing,
  beo,
  fulfillment,
  inventoryProvenance,
  inventorySourcingPreview
}) {
  const supplyConstraint = supplyDecisionConstraint(
    inventory,
    selectedMenuItems,
    inventoryProvenance
  );
  const sourcing = sourcingResolution(inventorySourcingPreview, {
    organizationId,
    quoteId,
    quoteRevisionId,
    scenarioId,
    supplyConstraint
  });
  const staffingResult = staffingDecision(fulfillment, staffing);
  const commercialValue = commercialValueDecision(commercial);
  const peopleCurrent = fulfillment?.people?.evidenceState === EVIDENCE_STATES.AVAILABLE
    && fulfillment?.people?.completeness === "complete"
    && staffingResult.evidenceState === EVIDENCE_STATES.AVAILABLE;
  const supplyCurrent = fulfillment?.supply?.evidenceState === EVIDENCE_STATES.AVAILABLE
    && fulfillment?.supply?.completeness === "complete";
  const state = commercial?.evidenceState !== EVIDENCE_STATES.AVAILABLE
    ? "unverifiable"
    : !peopleCurrent || !supplyCurrent
      ? "unverifiable"
      : supplyConstraint || staffingResult.assignmentGap > 0
      ? "conditional"
      : fulfillment?.constraintState === "clear"
        ? "supported"
        : "unverifiable";
  const reasonCodes = [
    supplyConstraint ? "supply_constraint_present" : "",
    staffingResult.assignmentGap > 0 ? "staffing_gap_present" : "",
    supplyConstraint && sourcing.selectionState !== "unique_policy_match"
      ? "sourcing_resolution_not_established"
      : "",
    !peopleCurrent ? "people_evidence_not_current" : "",
    !supplyCurrent ? "supply_evidence_not_current" : ""
  ].filter(Boolean);
  return {
    schemaVersion: "fulfillment-decision-answer-v1",
    authority: "presentation_only_projection",
    state,
    guestCount: proposedGuestCount,
    commercialReview: {
      evidenceState: commercial?.evidenceState || EVIDENCE_STATES.MISSING,
      state: commercial?.evidenceState === EVIDENCE_STATES.AVAILABLE
        ? "authoritative_preview_available"
        : "unverified",
      boundary: "An authoritative preview supports governed review only; it is not customer acceptance, booking, event readiness, or permission to apply."
    },
    supplyConstraint,
    sourcingResolution: sourcing,
    commercialValue,
    staffing: staffingResult,
    beo: {
      evidenceState: beo?.evidenceState || EVIDENCE_STATES.MISSING,
      effect: beo?.effect || null,
      dependentNodeIds: Array.isArray(beo?.dependentNodeIds) ? [...beo.dependentNodeIds] : [],
      boundary: beo?.boundary || "No BEO conclusion is available."
    },
    reasonCodes,
    boundary: "This answer composes revision-bound Commercial, Staffing, Inventory, and BEO evidence. Conditional means the scenario remains unresolved until the named authority records and refreshes the missing fact."
  };
}

function reversibility(appliedQuote, proposalChanged, guestCountChanged) {
  const applied = record(appliedQuote) && Boolean(
    text(appliedQuote.activeVersionId || appliedQuote.versionMeta?.versionId || appliedQuote.id)
  );
  if (applied) {
    return {
      state: "versioned_after_apply",
      changePending: false,
      canDiscardProposal: false,
      currentRevisionPreserved: true,
      undoMode: "new_governed_version",
      appliedRevisionId: text(appliedQuote.activeVersionId || appliedQuote.versionMeta?.versionId) || null,
      boundary: "The prior revision remains historical evidence. Any reversal requires another governed version; there is no silent undo."
    };
  }
  return {
    state: "before_apply",
    changePending: proposalChanged,
    canDiscardProposal: guestCountChanged,
    currentRevisionPreserved: true,
    undoMode: proposalChanged ? "discard_unapplied_proposal" : "none",
    appliedRevisionId: null,
    boundary: proposalChanged
      ? guestCountChanged
        ? "Discarding this unapplied guest-count proposal returns to the current revision without mutating authoritative evidence."
        : "This unapplied draft remains editable; no authoritative evidence changes until the governed apply succeeds."
      : "There is no proposed change to reverse."
  };
}

function nextAction({
  appliedQuote,
  proposalChanged,
  currentGuestCount,
  proposedGuestCount,
  previewLoading,
  previewError,
  previewAvailable,
  commercialEvidenceState,
  inventoryEvidenceState,
  inventoryApplicability,
  inventoryEnabled,
  inventoryInputReady,
  inventoryPreviewAvailable,
  inventoryPreviewState,
  authorityState,
  authorizationRequired,
  authorizationReceiptId
}) {
  if (record(appliedQuote)) {
    return { kind: "review_applied_revision", label: "Review updated quote", disabled: false };
  }
  if (currentGuestCount === null || proposedGuestCount === null) {
    return { kind: "complete_guest_count", label: "Enter a valid guest count", disabled: true };
  }
  if (!proposalChanged) {
    return { kind: "no_change", label: "No draft change to review", disabled: true };
  }
  if (previewAvailable !== true && commercialEvidenceState !== EVIDENCE_STATES.AVAILABLE) {
    return {
      kind: "preview_unavailable",
      label: "Authoritative preview unavailable",
      disabled: true
    };
  }
  if (previewLoading) {
    return { kind: "wait_for_preview", label: "Previewing consequences…", disabled: true };
  }
  if (previewError && commercialEvidenceState !== EVIDENCE_STATES.AVAILABLE) {
    return { kind: "retry_preview", label: "Retry consequence preview", disabled: false };
  }
  if ([
    EVIDENCE_STATES.NOT_YET_AVAILABLE,
    EVIDENCE_STATES.MISSING,
    EVIDENCE_STATES.STALE,
    EVIDENCE_STATES.BLOCKED
  ].includes(commercialEvidenceState)) {
    return {
      kind: commercialEvidenceState === EVIDENCE_STATES.STALE ? "refresh_preview" : "preview_consequences",
      label: commercialEvidenceState === EVIDENCE_STATES.STALE
        ? "Refresh consequence preview"
        : "Preview consequences",
      disabled: false
    };
  }
  const inventoryInScope = inventoryApplicability === "applicable";
  if (inventoryInScope && inventoryEnabled !== true) {
    return {
      kind: "inventory_unavailable",
      label: "Inventory evidence unavailable",
      disabled: true
    };
  }
  if (inventoryInScope
    && [EVIDENCE_STATES.CONTRADICTORY, EVIDENCE_STATES.SCHEMA_DRIFT]
      .includes(inventoryEvidenceState)) {
    return {
      kind: "resolve_inventory_evidence",
      label: "Resolve inventory evidence",
      disabled: true
    };
  }
  if (inventoryInScope && inventoryInputReady !== true) {
    return {
      kind: "complete_inventory_inputs",
      label: "Complete ingredient quantities",
      disabled: false
    };
  }
  if (inventoryInScope && ["pending", "loading"].includes(text(inventoryPreviewState))) {
    return { kind: "wait_for_inventory", label: "Checking ingredient evidence…", disabled: true };
  }
  if (inventoryInScope && inventoryPreviewAvailable === true
    && [EVIDENCE_STATES.NOT_YET_AVAILABLE, EVIDENCE_STATES.STALE, EVIDENCE_STATES.BLOCKED]
      .includes(inventoryEvidenceState)) {
    return {
      kind: inventoryEvidenceState === EVIDENCE_STATES.STALE
        ? "refresh_preview"
        : inventoryEvidenceState === EVIDENCE_STATES.BLOCKED
          ? "retry_preview"
          : "preview_consequences",
      label: inventoryEvidenceState === EVIDENCE_STATES.STALE
        ? "Refresh consequence preview"
        : inventoryEvidenceState === EVIDENCE_STATES.BLOCKED
          ? "Retry consequence preview"
          : "Preview consequences",
      disabled: false
    };
  }
  if (inventoryInScope && inventoryEvidenceState === EVIDENCE_STATES.BLOCKED
    && inventoryPreviewAvailable !== true) {
    return {
      kind: "inventory_unavailable",
      label: "Inventory evidence unavailable",
      disabled: true
    };
  }
  const enforced = text(authorityState).toLowerCase() === "enforced";
  if (enforced && authorizationRequired === true && !text(authorizationReceiptId)) {
    return { kind: "review_authorization", label: "Review authorization", disabled: false };
  }
  return { kind: "review_exact_change", label: "Review and apply exact change", disabled: false };
}

function overallState({ appliedQuote, proposalChanged, previewLoading, commercial, inventory, fulfillment }) {
  if (record(appliedQuote)) return "applied";
  if (!proposalChanged) return "unchanged";
  if (previewLoading) return "loading";
  if (commercial.evidenceState === EVIDENCE_STATES.STALE) return "stale";
  if (commercial.evidenceState !== EVIDENCE_STATES.AVAILABLE) return "awaiting_preview";
  if ([
    EVIDENCE_STATES.NOT_YET_AVAILABLE,
    EVIDENCE_STATES.MISSING,
    EVIDENCE_STATES.STALE,
    EVIDENCE_STATES.BLOCKED,
    EVIDENCE_STATES.CONTRADICTORY,
    EVIDENCE_STATES.SCHEMA_DRIFT
  ]
    .includes(inventory.evidenceState)) return "partial";
  if (inventory.evidenceState === EVIDENCE_STATES.AVAILABLE
    && inventory.completenessState !== "complete") return "partial";
  if (["outside_guest_count_slice", "mixed_proposal_outside_slice"]
    .includes(inventory.applicability)) return "partial";
  if (fulfillment?.state !== "complete") return "partial";
  return "ready";
}

/**
 * Composes already-bounded evidence for presentation. It performs no I/O and
 * owns no commercial, inventory, staffing, BEO, authorization, or apply truth.
 */
export function buildLivingCommercialTwinProjection({
  organizationId = "",
  quoteId = "",
  quoteRevisionId = "",
  scenarioId = "",
  commitment = null,
  proposedGuestCount = null,
  draftDirty = false,
  selectedMenuItemNames = [],
  selectedMenuItems = [],
  previewAvailable = false,
  previewRequested = false,
  previewLoading = false,
  previewError = null,
  previewScopeCurrent = false,
  commercialModel = null,
  authorityState = "",
  authorizationRequired = false,
  authorizationReceiptId = "",
  inventoryEnabled = false,
  inventoryScenarioEligible = false,
  inventoryPreviewAvailable = false,
  inventoryInputReady = false,
  inventoryConsequences = null,
  inventoryPreview = null,
  inventoryHeadroomEvidence = null,
  inventorySourcingPreview = null,
  staffingRead = null,
  proposedStaffingRequirements = null,
  proposedStaffingRequirementsSource = "proposed_commercial_and_canonical_counts",
  proposedStaffingEventWindowState = "current",
  staffingRequirementPolicy = null,
  appliedQuote = null,
  workbenchRequest = null
} = {}) {
  const currentGuestCount = exactGuestCount(commitment?.event?.guests);
  const proposed = exactGuestCount(proposedGuestCount);
  const resolvedMenuItems = menuItems(selectedMenuItems, selectedMenuItemNames);
  const scenarioChanged = currentGuestCount !== null
    && proposed !== null
    && currentGuestCount !== proposed;
  const proposalChanged = draftDirty === true || scenarioChanged;
  const resolvedQuoteRevisionId = text(
    quoteRevisionId
    || commitment?.revisionId
    || commitment?.versionMeta?.versionId
  );
  const resolvedScenarioId = text(
    scenarioId
    || inventoryConsequences?.provenance?.proposedAfter?.scenarioFingerprint
  );
  const inventoryInspection = inspectInventoryConsequences(inventoryConsequences, {
    organizationId,
    quoteId,
    quoteRevisionId: resolvedQuoteRevisionId,
    scenarioId: resolvedScenarioId
  });
  const commercialEvidenceState = previewEvidenceState({
    scenarioChanged: proposalChanged,
    previewAvailable,
    previewRequested,
    previewLoading,
    previewError,
    previewScopeCurrent,
    commercialModel
  });
  const commercial = commercialRail(commercialModel, commercialEvidenceState);
  const inventoryState = inventoryEvidenceState({
    scenarioChanged,
    inventoryScenarioEligible,
    inventoryEnabled,
    inventoryInputReady,
    inventoryConsequences,
    inventoryPreview,
    inventoryInspection
  });
  const inventory = inventoryRail(inventoryConsequences, inventoryState, {
    proposalChanged,
    guestCountChanged: scenarioChanged,
    inventoryScenarioEligible
  });
  const nodes = commercialEvidenceState === EVIDENCE_STATES.AVAILABLE
    ? dependencyNodes(commercialModel)
    : [];
  const staffing = dependencyRail({
    evidenceState: commercialEvidenceState,
    nodes,
    kind: "staffing"
  });
  const beo = dependencyRail({
    evidenceState: commercialEvidenceState,
    nodes,
    kind: "beo"
  });
  const fulfillment = buildFulfillmentProjection({
    organizationId,
    quoteId,
    quoteRevisionId: resolvedQuoteRevisionId,
    scenarioId: resolvedScenarioId,
    currentGuestCount,
    proposedGuestCount: proposed,
    people: buildFulfillmentPeopleInput(staffingRead),
    proposedRequirementsByRole: record(proposedStaffingRequirements)
      ? proposedStaffingRequirements
      : undefined,
    proposedRequirementsSource: text(proposedStaffingRequirementsSource),
    proposedEventWindowState: text(proposedStaffingEventWindowState) || "current",
    staffingPolicy: staffingRequirementPolicy,
    supply: buildFulfillmentSupplyInput({
      inventory,
      inventoryProvenance: inventoryInspection.provenance,
      inventoryObservedAtISO: inventoryConsequences?.observedAtISO,
      inventoryHeadroomEvidence,
      organizationId,
      quoteId,
      quoteRevisionId: resolvedQuoteRevisionId,
      scenarioId: resolvedScenarioId,
      currentGuestCount,
      proposedGuestCount: proposed
    })
  });
  const projection = {
    schemaVersion: "living-commercial-twin-v1",
    authority: "presentation_only_projection",
    state: overallState({
      appliedQuote,
      proposalChanged,
      previewLoading,
      commercial,
      inventory,
      fulfillment
    }),
    scenario: {
      currentGuestCount,
      proposedGuestCount: proposed,
      guestDelta: scenarioChanged ? proposed - currentGuestCount : 0,
      changed: scenarioChanged,
      proposalChanged,
      selectedMenuItemNames: resolvedMenuItems.map((item) => item.label),
      selectedMenuItems: resolvedMenuItems,
      workbenchRequest: workbenchRequestEnvelope(workbenchRequest)
    },
    consequences: { commercial, inventory, staffing, beo },
    fulfillment,
    decisionAnswer: buildDecisionAnswer({
      organizationId,
      quoteId,
      quoteRevisionId: resolvedQuoteRevisionId,
      scenarioId: resolvedScenarioId,
      proposedGuestCount: proposed,
      selectedMenuItems: resolvedMenuItems,
      commercial,
      inventory,
      staffing,
      beo,
      fulfillment,
      inventoryProvenance: inventoryInspection.provenance,
      inventorySourcingPreview
    }),
    operationalConstraint: operationalConstraint(inventory, staffing, beo, proposalChanged),
    guestCountHeadroom: headroomRail(
      commercialModel,
      inventoryConsequences,
      inventoryPreview,
      currentGuestCount
    ),
    reversibility: reversibility(appliedQuote, proposalChanged, scenarioChanged),
    authorization: {
      authorityState: text(authorityState).toLowerCase() || "unknown",
      required: authorizationRequired === true,
      receiptPresent: Boolean(text(authorizationReceiptId))
    },
    nextAction: nextAction({
      appliedQuote,
      proposalChanged,
      currentGuestCount,
      proposedGuestCount: proposed,
      previewLoading,
      previewError,
      previewAvailable,
      commercialEvidenceState,
      inventoryEvidenceState: inventory.evidenceState,
      inventoryApplicability: inventory.applicability,
      inventoryEnabled,
      inventoryInputReady,
      inventoryPreviewAvailable,
      inventoryPreviewState: inventoryPreview?.state,
      authorityState,
      authorizationRequired,
      authorizationReceiptId
    }),
    provenance: {
      commercial: commercialEvidenceState === EVIDENCE_STATES.AVAILABLE ? {
        beforeSourceLabel: text(commercialModel?.sources?.before?.label) || null,
        proposedAfterSourceLabel: text(commercialModel?.sources?.proposedAfter?.label) || null,
        authority: text(commercialModel?.sources?.proposedAfter?.authority) || null,
        graphId: text(commercialModel?.graph?.graphId) || null,
        graphVersion: text(commercialModel?.graph?.graphVersion) || null
      } : null,
      inventory: inventoryState === EVIDENCE_STATES.AVAILABLE ? {
        authority: text(inventoryConsequences?.authority) || null,
        ...inventoryInspection.provenance
      } : null,
      previewScopeCurrent: previewScopeCurrent === true,
      previewError: text(previewError) || null
    },
    boundary: PRESENTATION_BOUNDARY
  };
  return deepFreeze(projection);
}

export default buildLivingCommercialTwinProjection;
