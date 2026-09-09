"use strict";

const ingredientCore = require("./inventoryIngredientCore.cjs");
const recipeCore = require("./inventoryRecipeCore.cjs");

const EVENT_DEMAND_SCHEMA_VERSION = 1;
const EVENT_REQUIREMENT_VERSION = "ingredient-event-requirement-v1";
const EVENT_PROJECTION_VERSION = "ingredient-event-projection-v1";
const MAX_EVENT_SELECTIONS = 100;
const MAX_EVENT_INGREDIENTS = 500;
const MAX_EVENT_CONTRIBUTIONS = 1_000;
// Firestore rejects documents at 1 MiB. Keep enough headroom for field-name,
// index, wrapper, and future compatible metadata overhead.
const MAX_EVENT_DOCUMENT_BYTES = 700_000;
const SHA256_PATTERN = /^[a-f0-9]{64}$/u;
const PORTION_BASIS_KINDS = Object.freeze(["explicit_output_quantity"]);

class InventoryEventDemandError extends Error {
  constructor(code, message, details = {}) {
    super(message);
    this.name = "InventoryEventDemandError";
    this.code = code;
    this.details = details;
  }
}

function fail(code, message, details) {
  throw new InventoryEventDemandError(code, message, details);
}

function isRecord(value) {
  if (!value || typeof value !== "object" || Array.isArray(value)) return false;
  const prototype = Object.getPrototypeOf(value);
  return prototype === Object.prototype || prototype === null;
}

function exact(value, keys, label) {
  if (!isRecord(value)
    || Object.keys(value).length !== keys.length
    || keys.some((key) => !Object.hasOwn(value, key))) {
    fail("invalid-argument", `${label} contains missing or unsupported fields.`);
  }
}

function deepFreeze(value) {
  if (!value || typeof value !== "object" || Object.isFrozen(value)) return value;
  for (const child of Object.values(value)) deepFreeze(child);
  return Object.freeze(value);
}

function compareIssue(left, right) {
  return String(left.code).localeCompare(String(right.code))
    || String(left.ingredientId || "").localeCompare(String(right.ingredientId || ""))
    || String(left.menuItemId || "").localeCompare(String(right.menuItemId || ""))
    || String(left.selectionId || "").localeCompare(String(right.selectionId || ""))
    || String(left.allocationId || "").localeCompare(String(right.allocationId || ""));
}

function deserializeRational(value, label, { allowZero = true } = {}) {
  exact(value, ["numerator", "denominator"], label);
  if (!/^(?:0|[1-9]\d*)$/u.test(value.numerator)
    || !/^[1-9]\d*$/u.test(value.denominator)) {
    fail("data-loss", `${label} is not a canonical non-negative rational.`);
  }
  const result = recipeCore.rational(BigInt(value.numerator), BigInt(value.denominator));
  if (!allowZero && result.numerator === 0n) fail("data-loss", `${label} must be positive.`);
  return result;
}

function ceilRationalToSafeInteger(value, label) {
  if (value.numerator < 0n) fail("data-loss", `${label} cannot be negative.`);
  const result = (value.numerator + value.denominator - 1n) / value.denominator;
  if (result > BigInt(Number.MAX_SAFE_INTEGER)) fail("out-of-range", `${label} exceeds the safe quantity range.`);
  return Number(result);
}

function safeIntegerSum(left, right, label) {
  if (!Number.isSafeInteger(left) || !Number.isSafeInteger(right) || left < 0 || right < 0
    || left > Number.MAX_SAFE_INTEGER - right) {
    fail("out-of-range", `${label} exceeds the safe integer range.`);
  }
  return left + right;
}

function normalizePortionBasis(value) {
  exact(value, ["kind", "evidenceId"], "portionBasis");
  if (!PORTION_BASIS_KINDS.includes(value.kind)) {
    fail("invalid-argument", "portionBasis.kind is unsupported.");
  }
  return {
    kind: value.kind,
    evidenceId: ingredientCore.opaqueId(value.evidenceId, "portionBasis.evidenceId")
  };
}

function normalizeCommercialProvenance(value) {
  if (!isRecord(value) || !["direct", "package_inclusion"].includes(value.kind)) {
    fail("invalid-argument", "commercialProvenance.kind is unsupported.");
  }
  if (value.kind === "direct") {
    exact(value, ["kind", "sourceId"], "direct commercialProvenance");
    return { kind: value.kind, sourceId: ingredientCore.opaqueId(value.sourceId, "commercialProvenance.sourceId") };
  }
  exact(value, ["kind", "sourceId", "packageId", "inclusionId"], "package commercialProvenance");
  return {
    kind: value.kind,
    sourceId: ingredientCore.opaqueId(value.sourceId, "commercialProvenance.sourceId"),
    packageId: ingredientCore.opaqueId(value.packageId, "commercialProvenance.packageId"),
    inclusionId: ingredientCore.opaqueId(value.inclusionId, "commercialProvenance.inclusionId")
  };
}

function normalizeSelection(value) {
  exact(value, [
    "selectionId", "menuItemId", "recipeRevisionId", "requiredOutputQuantity",
    "outputUnitId", "portionBasis", "commercialProvenance"
  ], "event menu selection");
  if (value.recipeRevisionId === null && value.outputUnitId !== null) {
    fail("invalid-argument", "A selection without a recipe cannot claim a recipe output unit.");
  }
  return {
    selectionId: ingredientCore.opaqueId(value.selectionId, "selectionId"),
    menuItemId: ingredientCore.opaqueId(value.menuItemId, "menuItemId"),
    recipeRevisionId: value.recipeRevisionId === null
      ? null
      : ingredientCore.opaqueId(value.recipeRevisionId, "recipeRevisionId"),
    requiredOutputQuantity: ingredientCore.formatQuantityMicros(
      ingredientCore.parseQuantityMicros(value.requiredOutputQuantity, "requiredOutputQuantity")
    ),
    outputUnitId: value.recipeRevisionId === null && value.outputUnitId === null
      ? null
      : ingredientCore.opaqueId(value.outputUnitId, "outputUnitId"),
    portionBasis: normalizePortionBasis(value.portionBasis),
    commercialProvenance: normalizeCommercialProvenance(value.commercialProvenance)
  };
}

function assertFirestoreDocumentSize(value, label) {
  const bytes = Buffer.byteLength(ingredientCore.canonicalSerialize(value, label), "utf8");
  if (bytes > MAX_EVENT_DOCUMENT_BYTES) {
    fail("resource-exhausted", `${label} exceeds the bounded Firestore document size.`);
  }
  return bytes;
}

function indexUnique(records, key, label, maximum) {
  if (!Array.isArray(records) || records.length > maximum) {
    fail("invalid-argument", `${label} must be a bounded list of at most ${maximum}.`);
  }
  const result = new Map();
  for (const record of records) {
    const id = record?.[key];
    if (typeof id !== "string" || result.has(id)) {
      fail("invalid-argument", `${label} contains a missing or duplicate identity.`);
    }
    result.set(id, record);
  }
  return result;
}

function verifyRecipeCostResult(value, recipeRevision) {
  if (!isRecord(value) || typeof value.resultDigest !== "string" || !SHA256_PATTERN.test(value.resultDigest)) {
    fail("data-loss", "Recipe cost result lacks a valid deterministic digest.");
  }
  const { resultDigest, ...body } = value;
  if (resultDigest !== ingredientCore.digest(body, "ingredient recipe cost")
    || value.organizationId !== recipeRevision.organizationId
    || value.menuItemId !== recipeRevision.menuItemId
    || value.recipeRevisionId !== recipeRevision.recipeRevisionId
    || value.recipeDigest !== recipeRevision.recipeDigest
    || value.costingVersion !== recipeCore.RECIPE_COST_VERSION
    || !["complete", "partial", "unavailable", "invalid"].includes(value.status)
    || !Array.isArray(value.ingredients)
    || !Array.isArray(value.issues)) {
    fail("data-loss", "Recipe cost result digest or pinned recipe identity is inconsistent.");
  }
  return value;
}

function normalizeActiveAllocation(value) {
  exact(value, [
    "allocationId", "organizationId", "eventPlanId", "ingredientId", "locationId",
    "baseUnitId", "quantityMicros", "revision", "sourceRequirementRevisionId"
  ], "active ingredient allocation");
  const allocation = {
    allocationId: ingredientCore.opaqueId(value.allocationId, "allocationId"),
    organizationId: ingredientCore.opaqueId(value.organizationId, "allocation.organizationId"),
    eventPlanId: ingredientCore.opaqueId(value.eventPlanId, "allocation.eventPlanId"),
    ingredientId: ingredientCore.opaqueId(value.ingredientId, "allocation.ingredientId"),
    locationId: ingredientCore.opaqueId(value.locationId, "allocation.locationId"),
    baseUnitId: ingredientCore.baseUnitId(value.baseUnitId),
    quantityMicros: value.quantityMicros,
    revision: ingredientCore.revision(value.revision, "allocation revision", { allowZero: false }),
    sourceRequirementRevisionId: ingredientCore.opaqueId(
      value.sourceRequirementRevisionId,
      "allocation.sourceRequirementRevisionId"
    )
  };
  if (!Number.isSafeInteger(allocation.quantityMicros) || allocation.quantityMicros <= 0) {
    fail("invalid-argument", "allocation.quantityMicros must be a positive safe fixed-point quantity.");
  }
  return allocation;
}

function costStateFor({ normalizedIngredientCount, costedIngredientCount, knownCostIngredientCount = costedIngredientCount, invalid, currencies }) {
  if (invalid || currencies.size > 1) return "invalid";
  if (normalizedIngredientCount > 0 && costedIngredientCount === normalizedIngredientCount) return "complete";
  if (knownCostIngredientCount > 0) return "partial";
  return "unavailable";
}

function exactSupportedKeys(value, requiredKeys, optionalKeys, label) {
  if (!isRecord(value)
    || requiredKeys.some((key) => !Object.hasOwn(value, key))
    || Object.keys(value).some((key) => !requiredKeys.includes(key) && !optionalKeys.includes(key))) {
    fail("data-loss", `${label} contains missing or unsupported fields.`);
  }
}

function verifyMoneyEnvelope(value, label) {
  const moneyKeys = ["currency", "exactKnownCostMinor", "knownCostMinor", "projectedCostMinor"];
  const present = moneyKeys.filter((key) => Object.hasOwn(value, key));
  if (!present.length) {
    if (value.costState === "complete") fail("data-loss", `${label} omits complete projected cost evidence.`);
    return;
  }
  if (!["currency", "exactKnownCostMinor", "knownCostMinor"].every((key) => Object.hasOwn(value, key))
    || !/^[A-Z]{3}$/u.test(value.currency)
    || !Number.isSafeInteger(value.knownCostMinor)
    || value.knownCostMinor < 0) {
    fail("data-loss", `${label} contains inconsistent known cost evidence.`);
  }
  deserializeRational(value.exactKnownCostMinor, `${label}.exactKnownCostMinor`);
  if (value.costState === "complete") {
    if (!Number.isSafeInteger(value.projectedCostMinor) || value.projectedCostMinor < 0) {
      fail("data-loss", `${label} contains invalid projected cost evidence.`);
    }
  } else if (Object.hasOwn(value, "projectedCostMinor")) {
    fail("data-loss", `${label} claims complete cost while its cost state is not complete.`);
  }
}

function verifyEventIngredientRequirement(value) {
  const requiredKeys = [
    "authorityVersion", "schemaVersion", "requirementVersion", "organizationId", "quoteId",
    "quoteRevisionId", "requiredByISO", "demandState", "costState", "selections", "ingredients",
    "coverage", "issues", "eventRequirementRevisionId", "requirementDigest"
  ];
  const optionalMoneyKeys = ["currency", "exactKnownCostMinor", "knownCostMinor", "projectedCostMinor"];
  exactSupportedKeys(value, requiredKeys, optionalMoneyKeys, "event ingredient requirement");
  if (value.authorityVersion !== ingredientCore.INVENTORY_AUTHORITY_VERSION
    || value.schemaVersion !== EVENT_DEMAND_SCHEMA_VERSION
    || value.requirementVersion !== EVENT_REQUIREMENT_VERSION
    || !["complete", "incomplete", "invalid"].includes(value.demandState)
    || !["complete", "partial", "unavailable", "invalid"].includes(value.costState)
    || !Array.isArray(value.selections) || value.selections.length > MAX_EVENT_SELECTIONS
    || !Array.isArray(value.ingredients) || value.ingredients.length > MAX_EVENT_INGREDIENTS
    || !Array.isArray(value.issues)
    || typeof value.requirementDigest !== "string" || !SHA256_PATTERN.test(value.requirementDigest)) {
    fail("data-loss", "Event ingredient requirement schema is unsupported or inconsistent.");
  }
  ingredientCore.opaqueId(value.organizationId, "requirement.organizationId");
  ingredientCore.opaqueId(value.quoteId, "requirement.quoteId");
  ingredientCore.opaqueId(value.quoteRevisionId, "requirement.quoteRevisionId");
  ingredientCore.exactISO(value.requiredByISO, "requirement.requiredByISO");
  const { requirementDigest, ...withId } = value;
  if (requirementDigest !== ingredientCore.digest(withId, "event ingredient requirement")) {
    fail("data-loss", "Event ingredient requirement digest is inconsistent.");
  }
  const { eventRequirementRevisionId, ...identityBody } = withId;
  const expectedId = `eir_${ingredientCore.digest(identityBody, "event ingredient requirement identity").slice(0, 48)}`;
  if (eventRequirementRevisionId !== expectedId) {
    fail("data-loss", "Event ingredient requirement identity is inconsistent.");
  }
  verifyMoneyEnvelope(value, "event ingredient requirement");
  return value;
}

function verifyEventIngredientProjection(value) {
  const requiredKeys = [
    "authorityVersion", "schemaVersion", "projectionVersion", "organizationId", "quoteId",
    "quoteRevisionId", "eventRequirementRevisionId", "requirementDigest", "requiredByISO",
    "demandState", "costState", "availabilityState", "selections", "ingredients", "coverage",
    "sourceRevisions", "issues", "projectionDigest"
  ];
  const optionalMoneyKeys = ["currency", "exactKnownCostMinor", "knownCostMinor", "projectedCostMinor"];
  exactSupportedKeys(value, requiredKeys, optionalMoneyKeys, "event ingredient projection");
  if (value.authorityVersion !== ingredientCore.INVENTORY_AUTHORITY_VERSION
    || value.schemaVersion !== EVENT_DEMAND_SCHEMA_VERSION
    || value.projectionVersion !== EVENT_PROJECTION_VERSION
    || !["complete", "incomplete", "invalid"].includes(value.demandState)
    || !["complete", "partial", "unavailable", "invalid"].includes(value.costState)
    || !["available", "shortage", "unavailable", "invalid"].includes(value.availabilityState)
    || !Array.isArray(value.selections) || value.selections.length > MAX_EVENT_SELECTIONS
    || !Array.isArray(value.ingredients) || value.ingredients.length > MAX_EVENT_INGREDIENTS
    || !Array.isArray(value.issues)
    || !isRecord(value.sourceRevisions)
    || typeof value.requirementDigest !== "string" || !SHA256_PATTERN.test(value.requirementDigest)
    || typeof value.projectionDigest !== "string" || !SHA256_PATTERN.test(value.projectionDigest)) {
    fail("data-loss", "Event ingredient projection schema is unsupported or inconsistent.");
  }
  ingredientCore.opaqueId(value.organizationId, "projection.organizationId");
  ingredientCore.opaqueId(value.quoteId, "projection.quoteId");
  ingredientCore.opaqueId(value.quoteRevisionId, "projection.quoteRevisionId");
  ingredientCore.opaqueId(value.eventRequirementRevisionId, "projection.eventRequirementRevisionId");
  ingredientCore.exactISO(value.requiredByISO, "projection.requiredByISO");
  const { projectionDigest, ...body } = value;
  if (projectionDigest !== ingredientCore.digest(body, "event ingredient projection")) {
    fail("data-loss", "Event ingredient projection digest is inconsistent.");
  }
  verifyMoneyEnvelope(value, "event ingredient projection");
  return value;
}

function compileEventIngredientDemand({
  organizationId,
  quoteId,
  quoteRevisionId,
  requiredByISO,
  selections,
  recipeRevisions,
  recipeCostResults,
  stockStates,
  activeAllocations = [],
  excludedPlanId = ""
}) {
  const orgId = ingredientCore.opaqueId(organizationId, "organizationId");
  const eventQuoteId = ingredientCore.opaqueId(quoteId, "quoteId");
  const sourceQuoteRevisionId = ingredientCore.opaqueId(quoteRevisionId, "quoteRevisionId");
  const requiredAtISO = ingredientCore.exactISO(requiredByISO, "requiredByISO");
  if (excludedPlanId !== "") ingredientCore.opaqueId(excludedPlanId, "excludedPlanId");
  if (!Array.isArray(selections) || selections.length > MAX_EVENT_SELECTIONS) {
    fail("invalid-argument", `selections must contain at most ${MAX_EVENT_SELECTIONS} entries.`);
  }
  const normalizedSelections = selections.map(normalizeSelection).sort((left, right) =>
    left.menuItemId.localeCompare(right.menuItemId) || left.selectionId.localeCompare(right.selectionId));
  if (new Set(normalizedSelections.map(({ selectionId }) => selectionId)).size !== normalizedSelections.length
    || new Set(normalizedSelections.map(({ menuItemId }) => menuItemId)).size !== normalizedSelections.length) {
    fail("invalid-argument", "Each event menu item and selection identity must appear exactly once.");
  }

  const recipeById = indexUnique(recipeRevisions, "recipeRevisionId", "recipeRevisions", MAX_EVENT_SELECTIONS);
  const costByRecipeId = indexUnique(recipeCostResults, "recipeRevisionId", "recipeCostResults", MAX_EVENT_SELECTIONS);
  const issues = [];
  const aggregates = new Map();
  const compiledSelections = [];
  let contributionCount = 0;
  let demandInvalid = false;
  let costInvalid = false;

  for (const selection of normalizedSelections) {
    const recipeRevision = recipeById.get(selection.recipeRevisionId);
    if (!recipeRevision) {
      issues.push({ code: "missing_recipe_revision", menuItemId: selection.menuItemId, selectionId: selection.selectionId });
      compiledSelections.push({ ...selection, demandState: "incomplete", costState: "unavailable" });
      continue;
    }
    try {
      recipeCore.verifyRecipeRevision(recipeRevision);
    } catch {
      issues.push({ code: "invalid_recipe_revision", menuItemId: selection.menuItemId, selectionId: selection.selectionId });
      compiledSelections.push({ ...selection, demandState: "invalid", costState: "invalid" });
      demandInvalid = true;
      continue;
    }
    if (recipeRevision.organizationId !== orgId
      || recipeRevision.menuItemId !== selection.menuItemId
      || recipeRevision.outputUnitId !== selection.outputUnitId) {
      issues.push({ code: "recipe_selection_mismatch", menuItemId: selection.menuItemId, selectionId: selection.selectionId });
      compiledSelections.push({ ...selection, demandState: "invalid", costState: "invalid" });
      demandInvalid = true;
      continue;
    }
    if (recipeRevision.validity !== "valid" || recipeRevision.outputYield === null) {
      issues.push({ code: "invalid_recipe_definition", menuItemId: selection.menuItemId, selectionId: selection.selectionId });
      compiledSelections.push({ ...selection, demandState: "invalid", costState: "invalid" });
      demandInvalid = true;
      continue;
    }

    const recipeCost = costByRecipeId.get(selection.recipeRevisionId);
    if (!recipeCost) {
      issues.push({ code: "missing_recipe_normalization", menuItemId: selection.menuItemId, selectionId: selection.selectionId });
      compiledSelections.push({
        ...selection,
        recipeDigest: recipeRevision.recipeDigest,
        demandState: "incomplete",
        costState: "unavailable"
      });
      continue;
    }
    verifyRecipeCostResult(recipeCost, recipeRevision);
    for (const issue of recipeCost.issues) {
      issues.push({ ...issue, menuItemId: selection.menuItemId, selectionId: selection.selectionId });
    }

    const requiredOutput = recipeCore.rational(BigInt(ingredientCore.parseQuantityMicros(
      selection.requiredOutputQuantity,
      "requiredOutputQuantity"
    )));
    const recipeOutput = recipeCore.rational(BigInt(ingredientCore.parseQuantityMicros(
      recipeRevision.outputYield,
      "recipe outputYield"
    )));
    const scale = recipeCore.divideRational(requiredOutput, recipeOutput);
    const expectedIngredientIds = [...new Set(recipeRevision.lines.map(({ ingredientId }) => ingredientId))].sort();
    const normalizedRows = indexUnique(
      recipeCost.ingredients,
      "ingredientId",
      `recipeCostResults[${selection.recipeRevisionId}].ingredients`,
      recipeCore.MAX_RECIPE_LINES
    );
    const normalizedIngredientIds = [...normalizedRows.keys()].sort();
    const normalizationComplete = ingredientCore.canonicalSerialize(expectedIngredientIds, "expected ingredient IDs")
      === ingredientCore.canonicalSerialize(normalizedIngredientIds, "normalized ingredient IDs");
    if (!normalizationComplete) {
      issues.push({ code: "incomplete_recipe_normalization", menuItemId: selection.menuItemId, selectionId: selection.selectionId });
    }
    const expectedIngredientIdSet = new Set(expectedIngredientIds);
    const usableIngredientIds = normalizedIngredientIds.filter((ingredientId) => expectedIngredientIdSet.has(ingredientId));
    let selectionKnownCost = recipeCore.rational(0n);
    let selectionCostedCount = 0;
    const selectionCurrencies = new Set();

    for (const ingredientId of usableIngredientIds) {
      const row = normalizedRows.get(ingredientId);
      if (!isRecord(row)
        || typeof row.baseUnitId !== "string"
        || !isRecord(row.requiredBaseQuantityMicros)
        || !["available", "missing", "invalid", "not_applicable", "not_yet_available", "blocked_by_integration", "contradictory", "schema_drift"].includes(row.costAvailability)) {
        fail("data-loss", "Recipe cost result contains an invalid normalized ingredient row.");
      }
      ingredientCore.baseUnitId(row.baseUnitId);
      const batchQuantity = deserializeRational(row.requiredBaseQuantityMicros, "requiredBaseQuantityMicros", { allowZero: false });
      const exactRequired = recipeCore.multiplyRational(batchQuantity, scale);
      const contribution = {
        selectionId: selection.selectionId,
        menuItemId: selection.menuItemId,
        recipeRevisionId: selection.recipeRevisionId,
        recipeDigest: recipeRevision.recipeDigest,
        requiredOutputQuantity: selection.requiredOutputQuantity,
        outputUnitId: selection.outputUnitId,
        portionBasis: selection.portionBasis,
        commercialProvenance: selection.commercialProvenance,
        exactRequiredQuantityMicros: recipeCore.serializeRational(exactRequired)
      };
      if (row.costAvailability === "available") {
        const batchCost = deserializeRational(row.exactCostMinor, "exactCostMinor");
        const exactCost = recipeCore.multiplyRational(batchCost, scale);
        contribution.costAvailability = "available";
        contribution.currency = row.currency;
        contribution.costRevision = row.costRevision;
        contribution.costEvidenceId = row.costEvidenceId;
        contribution.exactCostMinor = recipeCore.serializeRational(exactCost);
        selectionKnownCost = recipeCore.addRational(selectionKnownCost, exactCost);
        selectionCostedCount += 1;
        selectionCurrencies.add(row.currency);
      } else {
        contribution.costAvailability = row.costAvailability;
      }
      const existing = aggregates.get(ingredientId);
      if (existing && existing.baseUnitId !== row.baseUnitId) {
        issues.push({ code: "ingredient_unit_mismatch", ingredientId, menuItemId: selection.menuItemId, selectionId: selection.selectionId });
        demandInvalid = true;
        continue;
      }
      const aggregate = existing || {
        ingredientId,
        baseUnitId: row.baseUnitId,
        exactRequired: recipeCore.rational(0n),
        exactKnownCost: recipeCore.rational(0n),
        currencies: new Set(),
        costedContributionCount: 0,
        contributions: []
      };
      aggregate.exactRequired = recipeCore.addRational(aggregate.exactRequired, exactRequired);
      if (contribution.costAvailability === "available") {
        aggregate.exactKnownCost = recipeCore.addRational(
          aggregate.exactKnownCost,
          deserializeRational(contribution.exactCostMinor, "contribution exactCostMinor")
        );
        aggregate.currencies.add(contribution.currency);
        aggregate.costedContributionCount += 1;
      }
      aggregate.contributions.push(contribution);
      aggregates.set(ingredientId, aggregate);
      contributionCount += 1;
      if (contributionCount > MAX_EVENT_CONTRIBUTIONS) {
        fail("resource-exhausted", `Event demand exceeds ${MAX_EVENT_CONTRIBUTIONS} ingredient contributions.`);
      }
    }

    const selectionCostState = costStateFor({
      normalizedIngredientCount: expectedIngredientIds.length,
      costedIngredientCount: selectionCostedCount,
      invalid: recipeCost.status === "invalid" || !normalizationComplete,
      currencies: selectionCurrencies
    });
    if (selectionCostState === "invalid") costInvalid = true;
    const compiled = {
      ...selection,
      recipeDigest: recipeRevision.recipeDigest,
      recipeOutputYield: recipeRevision.outputYield,
      demandState: normalizationComplete ? "complete" : "incomplete",
      costState: selectionCostState,
      recipeCostResultDigest: recipeCost.resultDigest
    };
    if (selectionCostedCount > 0 && selectionCurrencies.size === 1) {
      compiled.currency = [...selectionCurrencies][0];
      compiled.exactKnownCostMinor = recipeCore.serializeRational(selectionKnownCost);
      compiled.knownCostMinor = recipeCore.roundRationalHalfUp(selectionKnownCost);
      if (selectionCostState === "complete") compiled.projectedCostMinor = compiled.knownCostMinor;
    }
    compiledSelections.push(compiled);
  }

  if (aggregates.size > MAX_EVENT_INGREDIENTS) {
    fail("resource-exhausted", `Event demand exceeds ${MAX_EVENT_INGREDIENTS} ingredients.`);
  }
  const ingredientRequirements = [];
  let exactKnownCost = recipeCore.rational(0n);
  let costedIngredientCount = 0;
  let knownCostIngredientCount = 0;
  const currencies = new Set();
  for (const ingredientId of [...aggregates.keys()].sort()) {
    const aggregate = aggregates.get(ingredientId);
    aggregate.contributions.sort((left, right) =>
      left.menuItemId.localeCompare(right.menuItemId) || left.selectionId.localeCompare(right.selectionId));
    const row = {
      ingredientId,
      baseUnitId: aggregate.baseUnitId,
      exactRequiredQuantityMicros: recipeCore.serializeRational(aggregate.exactRequired),
      requiredQuantityMicros: ceilRationalToSafeInteger(aggregate.exactRequired, "required ingredient quantity"),
      contributions: aggregate.contributions
    };
    if (aggregate.costedContributionCount > 0) {
      row.exactKnownCostMinor = recipeCore.serializeRational(aggregate.exactKnownCost);
      row.knownCostMinor = recipeCore.roundRationalHalfUp(aggregate.exactKnownCost);
      exactKnownCost = recipeCore.addRational(exactKnownCost, aggregate.exactKnownCost);
      for (const currency of aggregate.currencies) currencies.add(currency);
      knownCostIngredientCount += 1;
    }
    const allContributionsCosted = aggregate.costedContributionCount === aggregate.contributions.length;
    row.costState = aggregate.currencies.size > 1
      ? "invalid"
      : allContributionsCosted ? "complete"
        : aggregate.costedContributionCount > 0 ? "partial" : "unavailable";
    if (row.costState === "complete") {
      row.currency = [...aggregate.currencies][0];
      row.projectedCostMinor = row.knownCostMinor;
      costedIngredientCount += 1;
    }
    ingredientRequirements.push(row);
  }

  const normalizedIngredientCount = ingredientRequirements.length;
  const completeSelectionCount = compiledSelections.filter(({ demandState }) => demandState === "complete").length;
  const demandState = demandInvalid ? "invalid"
    : completeSelectionCount === compiledSelections.length ? "complete" : "incomplete";
  if (currencies.size > 1) issues.push({ code: "currency_mismatch" });
  const costState = costStateFor({
    normalizedIngredientCount,
    costedIngredientCount,
    knownCostIngredientCount,
    invalid: costInvalid || currencies.size > 1,
    currencies
  });
  issues.sort(compareIssue);
  const requirementBody = {
    authorityVersion: ingredientCore.INVENTORY_AUTHORITY_VERSION,
    schemaVersion: EVENT_DEMAND_SCHEMA_VERSION,
    requirementVersion: EVENT_REQUIREMENT_VERSION,
    organizationId: orgId,
    quoteId: eventQuoteId,
    quoteRevisionId: sourceQuoteRevisionId,
    requiredByISO: requiredAtISO,
    demandState,
    costState,
    selections: compiledSelections,
    ingredients: ingredientRequirements,
    coverage: {
      selectedMenuItemCount: normalizedSelections.length,
      compiledMenuItemCount: completeSelectionCount,
      ingredientCount: normalizedIngredientCount,
      costedIngredientCount,
      knownCostIngredientCount
    },
    issues
  };
  if (knownCostIngredientCount > 0 && currencies.size === 1) {
    requirementBody.currency = [...currencies][0];
    requirementBody.exactKnownCostMinor = recipeCore.serializeRational(exactKnownCost);
    requirementBody.knownCostMinor = recipeCore.roundRationalHalfUp(exactKnownCost);
    if (costState === "complete") requirementBody.projectedCostMinor = requirementBody.knownCostMinor;
  }
  const identityDigest = ingredientCore.digest(requirementBody, "event ingredient requirement identity");
  const requirementWithId = {
    ...requirementBody,
    eventRequirementRevisionId: `eir_${identityDigest.slice(0, 48)}`
  };
  const requirementRevision = {
    ...requirementWithId,
    requirementDigest: ingredientCore.digest(requirementWithId, "event ingredient requirement")
  };
  assertFirestoreDocumentSize(requirementRevision, "event ingredient requirement");

  const stockByIngredient = new Map();
  const requiredIngredientIds = new Set(ingredientRequirements.map(({ ingredientId }) => ingredientId));
  const stockRevisions = [];
  if (!Array.isArray(stockStates) || stockStates.length > MAX_EVENT_INGREDIENTS * 10) {
    fail("invalid-argument", "stockStates must be a bounded list.");
  }
  const seenStockIds = new Set();
  const availabilityIssues = [];
  for (const state of stockStates) {
    if (typeof state?.stockStateId !== "string" || seenStockIds.has(state.stockStateId)) {
      fail("invalid-argument", "stockStates contains a missing or duplicate identity.");
    }
    seenStockIds.add(state.stockStateId);
    if (!requiredIngredientIds.has(state.ingredientId)) continue;
    try {
      ingredientCore.verifyStockState(state, {
        organizationId: orgId,
        ingredientId: state.ingredientId,
        locationId: state.locationId
      });
    } catch {
      availabilityIssues.push({ code: "invalid_stock_state", ingredientId: state?.ingredientId || "" });
      continue;
    }
    const current = stockByIngredient.get(state.ingredientId) || { onHandQuantityMicros: 0, baseUnitId: state.baseUnitId };
    if (current.baseUnitId !== state.baseUnitId) {
      availabilityIssues.push({ code: "stock_unit_mismatch", ingredientId: state.ingredientId });
      continue;
    }
    current.onHandQuantityMicros = safeIntegerSum(current.onHandQuantityMicros, state.onHandMicros, "on-hand quantity");
    stockByIngredient.set(state.ingredientId, current);
    stockRevisions.push({
      stockStateId: state.stockStateId,
      ingredientId: state.ingredientId,
      locationId: state.locationId,
      revision: state.revision
    });
  }

  const allocationByIngredient = new Map();
  const allocationRevisions = [];
  const normalizedAllocations = indexUnique(
    activeAllocations.map(normalizeActiveAllocation),
    "allocationId",
    "activeAllocations",
    MAX_EVENT_CONTRIBUTIONS
  );
  for (const allocation of normalizedAllocations.values()) {
    if (!requiredIngredientIds.has(allocation.ingredientId)) continue;
    if (allocation.organizationId !== orgId) {
      availabilityIssues.push({ code: "invalid_allocation_tenant", ingredientId: allocation.ingredientId, allocationId: allocation.allocationId });
      continue;
    }
    if (excludedPlanId && allocation.eventPlanId === excludedPlanId) continue;
    const current = allocationByIngredient.get(allocation.ingredientId) || {
      committedQuantityMicros: 0,
      baseUnitId: allocation.baseUnitId
    };
    if (current.baseUnitId !== allocation.baseUnitId) {
      availabilityIssues.push({ code: "allocation_unit_mismatch", ingredientId: allocation.ingredientId, allocationId: allocation.allocationId });
      continue;
    }
    current.committedQuantityMicros = safeIntegerSum(
      current.committedQuantityMicros,
      allocation.quantityMicros,
      "committed quantity"
    );
    allocationByIngredient.set(allocation.ingredientId, current);
    allocationRevisions.push({
      allocationId: allocation.allocationId,
      eventPlanId: allocation.eventPlanId,
      ingredientId: allocation.ingredientId,
      revision: allocation.revision,
      sourceRequirementRevisionId: allocation.sourceRequirementRevisionId
    });
  }

  const projectedIngredients = ingredientRequirements.map((requirement) => {
    const stock = stockByIngredient.get(requirement.ingredientId);
    const allocation = allocationByIngredient.get(requirement.ingredientId);
    const ingredientIssues = availabilityIssues.filter(({ ingredientId }) => ingredientId === requirement.ingredientId);
    const row = { ...requirement };
    if (!stock) {
      row.availabilityState = ingredientIssues.length ? "invalid" : "unavailable";
      if (!ingredientIssues.length) availabilityIssues.push({ code: "missing_stock_state", ingredientId: requirement.ingredientId });
      return row;
    }
    if (ingredientIssues.length) {
      row.availabilityState = "invalid";
      return row;
    }
    if (stock.baseUnitId !== requirement.baseUnitId
      || (allocation && allocation.baseUnitId !== requirement.baseUnitId)) {
      row.availabilityState = "invalid";
      availabilityIssues.push({ code: "availability_unit_mismatch", ingredientId: requirement.ingredientId });
      return row;
    }
    const onHand = stock.onHandQuantityMicros;
    const committed = allocation?.committedQuantityMicros || 0;
    const available = Math.max(0, onHand - committed);
    const shortage = Math.max(0, requirement.requiredQuantityMicros - available);
    row.onHandQuantityMicros = onHand;
    row.committedQuantityMicros = committed;
    row.availableToAllocateQuantityMicros = available;
    row.shortageQuantityMicros = shortage;
    row.availabilityState = shortage > 0 ? "shortage" : "available";
    if (committed > onHand) availabilityIssues.push({ code: "stock_overcommitted", ingredientId: requirement.ingredientId });
    return row;
  });
  availabilityIssues.sort(compareIssue);
  const availabilityStates = new Set(projectedIngredients.map(({ availabilityState }) => availabilityState));
  const calculatedAvailabilityState = availabilityStates.has("invalid") ? "invalid"
    : availabilityStates.has("unavailable") ? "unavailable"
      : availabilityStates.has("shortage") ? "shortage" : "available";
  // Availability cannot claim an event is clear when some or all demand could
  // not be compiled. Known ingredient rows remain visible, but the event-level
  // state fails closed until its complete physical requirement is known.
  const availabilityState = demandState === "invalid" ? "invalid"
    : demandState === "incomplete" ? "unavailable" : calculatedAvailabilityState;
  const combinedIssues = [...issues, ...availabilityIssues].sort(compareIssue);
  stockRevisions.sort((left, right) => left.ingredientId.localeCompare(right.ingredientId)
    || left.locationId.localeCompare(right.locationId));
  allocationRevisions.sort((left, right) => left.ingredientId.localeCompare(right.ingredientId)
    || left.allocationId.localeCompare(right.allocationId));
  const projectionBody = {
    authorityVersion: ingredientCore.INVENTORY_AUTHORITY_VERSION,
    schemaVersion: EVENT_DEMAND_SCHEMA_VERSION,
    projectionVersion: EVENT_PROJECTION_VERSION,
    organizationId: orgId,
    quoteId: eventQuoteId,
    quoteRevisionId: sourceQuoteRevisionId,
    eventRequirementRevisionId: requirementRevision.eventRequirementRevisionId,
    requirementDigest: requirementRevision.requirementDigest,
    requiredByISO: requiredAtISO,
    demandState,
    costState,
    availabilityState,
    selections: compiledSelections,
    ingredients: projectedIngredients,
    coverage: {
      ...requirementRevision.coverage,
      stockKnownIngredientCount: projectedIngredients.filter((row) => Object.hasOwn(row, "onHandQuantityMicros")).length,
      availableIngredientCount: projectedIngredients.filter(({ availabilityState: state }) => state === "available").length,
      shortageIngredientCount: projectedIngredients.filter(({ availabilityState: state }) => state === "shortage").length
    },
    sourceRevisions: {
      recipeRevisionIds: compiledSelections.map(({ recipeRevisionId }) => recipeRevisionId).filter(Boolean).sort(),
      recipeCostResultDigests: compiledSelections.map(({ recipeCostResultDigest }) => recipeCostResultDigest).filter(Boolean).sort(),
      stockRevisions,
      allocationRevisions
    },
    issues: combinedIssues
  };
  for (const key of ["currency", "exactKnownCostMinor", "knownCostMinor", "projectedCostMinor"]) {
    if (Object.hasOwn(requirementRevision, key)) projectionBody[key] = requirementRevision[key];
  }
  const projection = {
    ...projectionBody,
    projectionDigest: ingredientCore.digest(projectionBody, "event ingredient projection")
  };
  assertFirestoreDocumentSize(projection, "event ingredient projection");
  verifyEventIngredientRequirement(requirementRevision);
  verifyEventIngredientProjection(projection);
  return deepFreeze({ requirementRevision, projection });
}

module.exports = {
  EVENT_DEMAND_SCHEMA_VERSION,
  EVENT_PROJECTION_VERSION,
  EVENT_REQUIREMENT_VERSION,
  InventoryEventDemandError,
  MAX_EVENT_DOCUMENT_BYTES,
  MAX_EVENT_CONTRIBUTIONS,
  MAX_EVENT_INGREDIENTS,
  MAX_EVENT_SELECTIONS,
  PORTION_BASIS_KINDS,
  assertFirestoreDocumentSize,
  compileEventIngredientDemand,
  verifyEventIngredientProjection,
  verifyEventIngredientRequirement
};
