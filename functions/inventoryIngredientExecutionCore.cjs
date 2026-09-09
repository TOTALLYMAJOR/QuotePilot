"use strict";

const inventory = require("./inventoryIngredientCore.cjs");
const allocation = require("./inventoryIngredientAllocationCore.cjs");
const demand = require("./inventoryEventDemandCore.cjs");
const recipe = require("./inventoryRecipeCore.cjs");

const EXECUTION_VERSION = "ingredient-event-execution-v1";
// A closeout may write movement, stock, ingredient provenance, fence, and
// projection evidence per row. Keep the command safely below Firestore's
// transaction write ceiling after fixed authority documents are included.
const MAX_EXECUTION_INGREDIENTS = 75;
const MAX_EXECUTION_DOCUMENT_BYTES = 700_000;
const SHA256_PATTERN = /^[a-f0-9]{64}$/u;

class InventoryExecutionError extends Error {
  constructor(code, message, details = {}) {
    super(message);
    this.name = "InventoryExecutionError";
    this.code = code;
    this.details = details;
  }
}

function fail(code, message, details) {
  throw new InventoryExecutionError(code, message, details);
}

function isRecord(value) {
  if (!value || typeof value !== "object" || Array.isArray(value)) return false;
  const prototype = Object.getPrototypeOf(value);
  return prototype === Object.prototype || prototype === null;
}

function exact(value, keys, label, code = "invalid-argument") {
  if (!isRecord(value) || Object.keys(value).length !== keys.length
    || keys.some((key) => !Object.hasOwn(value, key))) {
    fail(code, `${label} contains missing or unsupported fields.`);
  }
}

function exactSupportedKeys(value, required, optional, label, code = "data-loss") {
  if (!isRecord(value)
    || required.some((key) => !Object.hasOwn(value, key))
    || Object.keys(value).some((key) => !required.includes(key) && !optional.includes(key))) {
    fail(code, `${label} contains missing or unsupported fields.`);
  }
}

function safeAdd(left, right, label) {
  if (!Number.isSafeInteger(left) || !Number.isSafeInteger(right)
    || left < 0 || right < 0 || left > Number.MAX_SAFE_INTEGER - right) {
    fail("out-of-range", `${label} exceeds the safe exact range.`);
  }
  return left + right;
}

function cleanText(value, label, maximum) {
  if (typeof value !== "string" || value !== value.trim()) {
    fail("invalid-argument", `${label} must be exact text.`);
  }
  const normalized = value.replace(/\s+/gu, " ");
  if (!normalized || normalized.length > maximum) {
    fail("invalid-argument", `${label} must be non-empty bounded text.`);
  }
  return normalized;
}

function bounded(value, label) {
  if (Buffer.byteLength(inventory.canonicalSerialize(value, label), "utf8") > MAX_EXECUTION_DOCUMENT_BYTES) {
    fail("resource-exhausted", `${label} exceeds the bounded Firestore document size.`);
  }
  return value;
}

function eventExecutionRevisionIdFor(organizationId, quoteId, executionRevision) {
  return `eiex_${inventory.digest({
    organizationId: inventory.opaqueId(organizationId, "organizationId"),
    quoteId: inventory.opaqueId(quoteId, "quoteId"),
    executionRevision: inventory.revision(executionRevision, "executionRevision", { allowZero: false })
  }, "event ingredient execution identity").slice(0, 48)}`;
}

function normalizeExecutionRequest(value) {
  exact(value, [
    "kind", "quoteId", "eventRequirementRevisionId", "expectedExecutionRevision",
    "expectedAllocationRevision", "occurredAtISO", "reason", "ingredients"
  ], "event ingredient execution command");
  if (!["record_event_ingredient_execution", "correct_event_ingredient_execution"].includes(value.kind)) {
    fail("invalid-argument", "Event ingredient execution command is invalid.");
  }
  if (!Array.isArray(value.ingredients) || !value.ingredients.length
    || value.ingredients.length > MAX_EXECUTION_INGREDIENTS) {
    fail("invalid-argument", `Execution requires 1-${MAX_EXECUTION_INGREDIENTS} ingredient rows.`);
  }
  const ids = new Set();
  let priorIdentity = "";
  const ingredients = value.ingredients.map((line) => {
    exact(line, [
      "ingredientId", "locationId", "baseUnitId", "consumedQuantity", "wasteQuantity",
      "expectedStockRevision"
    ], "event ingredient execution line");
    const normalized = {
      ingredientId: inventory.opaqueId(line.ingredientId, "execution ingredientId"),
      locationId: inventory.opaqueId(line.locationId, "execution locationId"),
      baseUnitId: inventory.baseUnitId(line.baseUnitId),
      consumedQuantity: inventory.formatQuantityMicros(inventory.parseQuantityMicros(
        line.consumedQuantity, "consumedQuantity", { allowZero: true }
      )),
      consumedQuantityMicros: inventory.parseQuantityMicros(
        line.consumedQuantity, "consumedQuantity", { allowZero: true }
      ),
      wasteQuantity: inventory.formatQuantityMicros(inventory.parseQuantityMicros(
        line.wasteQuantity, "wasteQuantity", { allowZero: true }
      )),
      wasteQuantityMicros: inventory.parseQuantityMicros(
        line.wasteQuantity, "wasteQuantity", { allowZero: true }
      ),
      expectedStockRevision: inventory.revision(line.expectedStockRevision, "expectedStockRevision", { allowZero: false })
    };
    const identity = `${normalized.ingredientId}\u0000${normalized.locationId}`;
    if (ids.has(identity) || (priorIdentity && priorIdentity >= identity)) {
      fail("invalid-argument", "Execution ingredient rows must be unique and deterministically sorted.");
    }
    ids.add(identity);
    priorIdentity = identity;
    safeAdd(normalized.consumedQuantityMicros, normalized.wasteQuantityMicros, "actual depletion quantity");
    return Object.freeze(normalized);
  });
  const expectedExecutionRevision = inventory.revision(value.expectedExecutionRevision, "expectedExecutionRevision");
  if ((value.kind === "record_event_ingredient_execution") !== (expectedExecutionRevision === 0)) {
    fail("invalid-argument", "Initial and corrective execution commands require the matching expected execution revision.");
  }
  return Object.freeze({
    kind: value.kind,
    quoteId: inventory.opaqueId(value.quoteId, "quoteId"),
    eventRequirementRevisionId: inventory.opaqueId(value.eventRequirementRevisionId, "eventRequirementRevisionId"),
    expectedExecutionRevision,
    expectedAllocationRevision: inventory.revision(value.expectedAllocationRevision, "expectedAllocationRevision", { allowZero: false }),
    occurredAtISO: inventory.exactISO(value.occurredAtISO, "occurredAtISO"),
    reason: cleanText(value.reason, "execution reason", 240),
    ingredients: Object.freeze(ingredients)
  });
}

function parseStoredRational(value, label) {
  exact(value, ["numerator", "denominator"], label, "data-loss");
  if (!/^(0|[1-9]\d*)$/u.test(value.numerator)
    || !/^[1-9]\d*$/u.test(value.denominator)) {
    fail("data-loss", `${label} is not a non-negative exact rational.`);
  }
  const parsed = recipe.rational(BigInt(value.numerator), BigInt(value.denominator));
  const canonical = recipe.serializeRational(parsed);
  if (canonical.numerator !== value.numerator || canonical.denominator !== value.denominator) {
    fail("data-loss", `${label} is not canonical.`);
  }
  return parsed;
}

function plannedBasisFor(requirementRow, depletedQuantityMicros) {
  if (requirementRow.costState !== "complete") {
    return Object.freeze({ state: "unavailable" });
  }
  if (typeof requirementRow.currency !== "string" || !/^[A-Z]{3}$/u.test(requirementRow.currency)
    || !Number.isSafeInteger(requirementRow.projectedCostMinor)
    || requirementRow.projectedCostMinor < 0) {
    fail("data-loss", "Complete pinned requirement cost evidence is inconsistent.");
  }
  const exactRequired = parseStoredRational(
    requirementRow.exactRequiredQuantityMicros,
    "requirement exactRequiredQuantityMicros"
  );
  if (exactRequired.numerator === 0n) fail("data-loss", "Pinned ingredient demand cannot be zero.");
  const roundedRequired = (exactRequired.numerator + exactRequired.denominator - 1n) / exactRequired.denominator;
  if (roundedRequired > BigInt(Number.MAX_SAFE_INTEGER)
    || Number(roundedRequired) !== requirementRow.requiredQuantityMicros) {
    fail("data-loss", "Pinned exact and rounded ingredient demand are inconsistent.");
  }
  const exactPlannedCost = parseStoredRational(
    requirementRow.exactKnownCostMinor,
    "requirement exactKnownCostMinor"
  );
  const roundedPlannedCost = recipe.roundRationalHalfUp(exactPlannedCost);
  if (roundedPlannedCost !== requirementRow.knownCostMinor
    || roundedPlannedCost !== requirementRow.projectedCostMinor) {
    fail("data-loss", "Pinned exact and rounded ingredient cost are inconsistent.");
  }
  const exactUsageCost = recipe.divideRational(
    recipe.multiplyRational(exactPlannedCost, recipe.rational(BigInt(depletedQuantityMicros))),
    exactRequired
  );
  const usageCostMinor = recipe.roundRationalHalfUp(exactUsageCost);
  return Object.freeze({
    state: "complete",
    currency: requirementRow.currency,
    exactUsageCostMinor: recipe.serializeRational(exactUsageCost),
    usageCostMinor,
    plannedProjectedCostMinor: requirementRow.projectedCostMinor,
    varianceMinor: usageCostMinor - requirementRow.projectedCostMinor
  });
}

function buildCostSummary(rows) {
  const costed = rows.filter((row) => row.plannedBasisCostState === "complete");
  const currencies = new Set(costed.map((row) => row.currency));
  const plannedBasisState = currencies.size > 1 ? "invalid"
    : costed.length === rows.length ? "complete"
      : costed.length ? "partial" : "unavailable";
  const result = {
    actualCogsState: "unavailable",
    actualCogsReason: "valuation_policy_unresolved",
    plannedBasisState,
    expectedIngredientCount: rows.length,
    costedIngredientCount: costed.length
  };
  if (costed.length && currencies.size === 1) {
    let exactKnownUsage = recipe.rational(0n);
    let plannedProjectedCostMinor = 0;
    for (const row of costed) {
      exactKnownUsage = recipe.addRational(
        exactKnownUsage,
        parseStoredRational(row.exactPlannedBasisUsageCostMinor, "execution exactPlannedBasisUsageCostMinor")
      );
      plannedProjectedCostMinor = safeAdd(
        plannedProjectedCostMinor,
        row.plannedProjectedCostMinor,
        "planned projected ingredient cost"
      );
    }
    const knownUsageCostMinor = recipe.roundRationalHalfUp(exactKnownUsage);
    Object.assign(result, {
      currency: costed[0].currency,
      exactKnownUsageCostMinor: recipe.serializeRational(exactKnownUsage),
      knownUsageCostMinor
    });
    if (plannedBasisState === "complete") Object.assign(result, {
      plannedProjectedCostMinor,
      plannedBasisVarianceMinor: knownUsageCostMinor - plannedProjectedCostMinor
    });
  }
  return Object.freeze(result);
}

function verifyExecution(value, { organizationId, quoteId, documentId = "" } = {}) {
  const requiredKeys = [
    "authorityVersion", "schemaVersion", "executionVersion", "model", "organizationId",
    "quoteId", "eventPlanId", "eventRequirementRevisionId", "requirementDigest",
    "executionRevision", "eventExecutionRevisionId", "priorEventExecutionRevisionId",
    "settlementExecutionRevisionId", "allocationRevision", "state", "occurredAtISO", "reason", "ingredients", "ingredientCount",
    "costSummary", "recordedAtISO", "actor", "executionDigest"
  ];
  exact(value, requiredKeys, "event ingredient execution", "data-loss");
  const expectedPriorExecutionRevisionId = value.executionRevision > 1
    ? eventExecutionRevisionIdFor(organizationId, quoteId, value.executionRevision - 1) : "";
  const expectedSettlementExecutionRevisionId = eventExecutionRevisionIdFor(organizationId, quoteId, 1);
  if (value.authorityVersion !== inventory.INVENTORY_AUTHORITY_VERSION
    || value.schemaVersion !== inventory.INVENTORY_SCHEMA_VERSION
    || value.executionVersion !== EXECUTION_VERSION
    || value.model !== "event-ingredient-execution-v1"
    || value.organizationId !== organizationId || value.quoteId !== quoteId
    || value.eventPlanId !== allocation.eventPlanIdFor(organizationId, quoteId)
    || value.eventExecutionRevisionId !== eventExecutionRevisionIdFor(
      organizationId, quoteId, value.executionRevision
    )
    || value.settlementExecutionRevisionId !== expectedSettlementExecutionRevisionId
    || value.priorEventExecutionRevisionId !== expectedPriorExecutionRevisionId
    || value.state !== "settled"
    || (documentId && documentId !== quoteId && documentId !== value.eventExecutionRevisionId)
    || !Array.isArray(value.ingredients)
    || value.ingredients.length !== value.ingredientCount
    || value.ingredients.length > MAX_EXECUTION_INGREDIENTS
    || !SHA256_PATTERN.test(value.requirementDigest)) {
    fail("data-loss", "Event ingredient execution identity or state is inconsistent.");
  }
  inventory.revision(value.executionRevision, "executionRevision", { allowZero: false });
  inventory.revision(value.allocationRevision, "allocationRevision", { allowZero: false });
  inventory.opaqueId(value.eventRequirementRevisionId, "eventRequirementRevisionId");
  if (value.priorEventExecutionRevisionId) {
    inventory.opaqueId(value.priorEventExecutionRevisionId, "priorEventExecutionRevisionId");
  }
  inventory.exactISO(value.occurredAtISO, "execution occurredAtISO");
  inventory.exactISO(value.recordedAtISO, "execution recordedAtISO");
  cleanText(value.reason, "execution reason", 240);
  inventory.normalizeActor(value.actor, organizationId);
  let priorIngredientId = "";
  const ids = new Set();
  for (const row of value.ingredients) {
    const common = [
      "ingredientId", "locationId", "baseUnitId", "plannedQuantityMicros",
      "allocatedQuantityMicros", "consumedQuantity", "consumedQuantityMicros", "wasteQuantity",
      "wasteQuantityMicros", "depletedQuantityMicros", "priorDepletedQuantityMicros",
      "stockEffectDirection", "stockEffectQuantityMicros", "allocationReleasedQuantityMicros",
      "priorStockRevision", "resultStockRevision", "priorOnHandMicros", "resultOnHandMicros",
      "plannedBasisCostState"
    ];
    const money = [
      "currency", "exactPlannedBasisUsageCostMinor", "plannedBasisUsageCostMinor",
      "plannedProjectedCostMinor", "plannedBasisVarianceMinor"
    ];
    exactSupportedKeys(row, common, money, "event ingredient execution row");
    if (ids.has(row.ingredientId) || (priorIngredientId && priorIngredientId >= row.ingredientId)) {
      fail("data-loss", "Event ingredient execution rows are not uniquely sorted.");
    }
    ids.add(row.ingredientId);
    priorIngredientId = row.ingredientId;
    inventory.opaqueId(row.ingredientId, "execution ingredientId");
    inventory.opaqueId(row.locationId, "execution locationId");
    inventory.baseUnitId(row.baseUnitId);
    for (const key of [
      "plannedQuantityMicros", "allocatedQuantityMicros", "consumedQuantityMicros", "wasteQuantityMicros",
      "depletedQuantityMicros", "priorDepletedQuantityMicros", "stockEffectQuantityMicros",
      "allocationReleasedQuantityMicros", "priorOnHandMicros", "resultOnHandMicros"
    ]) inventory.formatQuantityMicros(row[key], `execution ${key}`);
    inventory.revision(row.priorStockRevision, "priorStockRevision", { allowZero: false });
    inventory.revision(row.resultStockRevision, "resultStockRevision", { allowZero: false });
    if (inventory.parseQuantityMicros(row.consumedQuantity, "consumedQuantity", { allowZero: true }) !== row.consumedQuantityMicros
      || inventory.parseQuantityMicros(row.wasteQuantity, "wasteQuantity", { allowZero: true }) !== row.wasteQuantityMicros
      || row.depletedQuantityMicros !== safeAdd(row.consumedQuantityMicros, row.wasteQuantityMicros, "execution depletion")
      || !["decrease", "increase", "unchanged"].includes(row.stockEffectDirection)
      || row.stockEffectQuantityMicros !== Math.abs(row.depletedQuantityMicros - row.priorDepletedQuantityMicros)
      || row.stockEffectDirection !== (row.depletedQuantityMicros > row.priorDepletedQuantityMicros
        ? "decrease" : row.depletedQuantityMicros < row.priorDepletedQuantityMicros ? "increase" : "unchanged")
      || row.resultStockRevision !== row.priorStockRevision + (row.stockEffectDirection === "unchanged" ? 0 : 1)
      || row.resultOnHandMicros !== row.priorOnHandMicros
        + (row.stockEffectDirection === "increase" ? row.stockEffectQuantityMicros
          : row.stockEffectDirection === "decrease" ? -row.stockEffectQuantityMicros : 0)) {
      fail("data-loss", "Event ingredient execution quantities are inconsistent.");
    }
    if (row.plannedBasisCostState === "complete") {
      if (!money.every((key) => Object.hasOwn(row, key))
        || !/^[A-Z]{3}$/u.test(row.currency)
        || !Number.isSafeInteger(row.plannedBasisUsageCostMinor)
        || !Number.isSafeInteger(row.plannedProjectedCostMinor)
        || !Number.isSafeInteger(row.plannedBasisVarianceMinor)
        || row.plannedBasisUsageCostMinor < 0 || row.plannedProjectedCostMinor < 0
        || row.plannedBasisVarianceMinor !== row.plannedBasisUsageCostMinor - row.plannedProjectedCostMinor) {
        fail("data-loss", "Complete planned-basis execution cost is inconsistent.");
      }
      parseStoredRational(row.exactPlannedBasisUsageCostMinor, "execution exactPlannedBasisUsageCostMinor");
    } else if (row.plannedBasisCostState !== "unavailable"
      || money.some((key) => Object.hasOwn(row, key))) {
      fail("data-loss", "Unavailable planned-basis execution cost contains invented money.");
    }
  }
  exactSupportedKeys(value.costSummary, [
    "actualCogsState", "actualCogsReason", "plannedBasisState", "expectedIngredientCount",
    "costedIngredientCount"
  ], [
    "currency", "exactKnownUsageCostMinor", "knownUsageCostMinor", "plannedProjectedCostMinor",
    "plannedBasisVarianceMinor"
  ], "event ingredient execution cost summary");
  if (value.costSummary.actualCogsState !== "unavailable"
    || value.costSummary.actualCogsReason !== "valuation_policy_unresolved"
    || !["complete", "partial", "unavailable", "invalid"].includes(value.costSummary.plannedBasisState)
    || value.costSummary.expectedIngredientCount !== value.ingredients.length
    || value.costSummary.costedIngredientCount !== value.ingredients.filter(
      (row) => row.plannedBasisCostState === "complete"
    ).length) {
    fail("data-loss", "Event ingredient execution cost boundary is inconsistent.");
  }
  const recomputedCostSummary = buildCostSummary(value.ingredients);
  if (inventory.canonicalSerialize(recomputedCostSummary, "execution cost summary")
    !== inventory.canonicalSerialize(value.costSummary, "stored execution cost summary")) {
    fail("data-loss", "Event ingredient execution cost summary does not match its ingredient evidence.");
  }
  const { executionDigest, ...body } = value;
  if (executionDigest !== inventory.digest(body, "event ingredient execution")) {
    fail("data-loss", "Event ingredient execution digest is inconsistent.");
  }
  return bounded(value, "event ingredient execution");
}

function planEventIngredientExecution({
  organizationId,
  requestId,
  request,
  pinnedRequirement,
  currentPlan,
  currentExecution = null,
  stockStates,
  fences,
  actor,
  nowISO
}) {
  const orgId = inventory.opaqueId(organizationId, "organizationId");
  const retryId = inventory.requestId(requestId);
  const normalized = normalizeExecutionRequest(request);
  const normalizedActor = inventory.normalizeActor(actor, orgId);
  const recordedAtISO = inventory.exactISO(nowISO, "nowISO");
  demand.verifyEventIngredientRequirement(pinnedRequirement);
  if (!currentPlan) fail("not-found", "The event has no ingredient allocation to execute.");
  allocation.verifyPlan(currentPlan, { organizationId: orgId, quoteId: normalized.quoteId });
  if (pinnedRequirement.organizationId !== orgId
    || pinnedRequirement.quoteId !== normalized.quoteId
    || pinnedRequirement.eventRequirementRevisionId !== normalized.eventRequirementRevisionId
    || currentPlan.eventRequirementRevisionId !== normalized.eventRequirementRevisionId
    || currentPlan.requirementDigest !== pinnedRequirement.requirementDigest) {
    fail("failed-precondition", "Execution requires the plan's exact immutable ingredient requirement.");
  }
  const priorExecutionRevision = currentExecution?.executionRevision || 0;
  if (priorExecutionRevision !== normalized.expectedExecutionRevision) {
    fail("aborted", "The event ingredient execution changed.");
  }
  const correction = priorExecutionRevision > 0;
  const executionRevision = priorExecutionRevision + 1;
  const eventExecutionRevisionId = eventExecutionRevisionIdFor(orgId, normalized.quoteId, executionRevision);
  if (correction) {
    verifyExecution(currentExecution, { organizationId: orgId, quoteId: normalized.quoteId });
    if (!allocation.isExecutionSettledPlan(currentPlan, currentExecution.settlementExecutionRevisionId)
      || currentExecution.eventPlanId !== currentPlan.eventPlanId
      || currentExecution.eventRequirementRevisionId !== normalized.eventRequirementRevisionId
      || currentExecution.allocationRevision !== currentPlan.allocationRevision) {
      fail("failed-precondition", "Execution correction requires the exact settled event allocation.");
    }
  } else if (!["reserved", "shortage"].includes(currentPlan.state)) {
    fail("failed-precondition", "Only an active event ingredient allocation can be executed.");
  }
  if (currentPlan.allocationRevision !== normalized.expectedAllocationRevision) {
    fail("aborted", "The event ingredient allocation changed.");
  }
  if (!Array.isArray(stockStates) || !Array.isArray(fences)) {
    fail("invalid-argument", "Execution stock states and fences must be bounded lists.");
  }
  const requirementById = new Map(pinnedRequirement.ingredients.map((row) => [row.ingredientId, row]));
  const planById = new Map(currentPlan.ingredients.map((row) => [row.ingredientId, row]));
  const priorById = new Map((currentExecution?.ingredients || []).map((row) => [row.ingredientId, row]));
  if (normalized.ingredients.length !== currentPlan.ingredients.length
    || normalized.ingredients.some((line) => !planById.has(line.ingredientId))
    || requirementById.size !== currentPlan.ingredients.length) {
    fail("failed-precondition", "Execution must exactly cover every planned ingredient once.");
  }
  const stockByIdentity = new Map(stockStates.map((state) => [`${state.ingredientId}\u0000${state.locationId}`, state]));
  if (stockByIdentity.size !== stockStates.length || stockStates.length !== currentPlan.ingredients.length
    || stockStates.length > MAX_EXECUTION_INGREDIENTS) {
    fail("invalid-argument", "Execution stock states contain duplicate or excessive identities.");
  }
  const fenceById = new Map(fences.map((fence) => [fence.fenceId, fence]));
  if (fenceById.size !== fences.length || fences.length !== currentPlan.ingredients.length
    || fences.length > MAX_EXECUTION_INGREDIENTS) {
    fail("invalid-argument", "Execution fences contain duplicate or excessive identities.");
  }

  const settlement = correction ? null : allocation.planEventSettlement({
    organizationId: orgId,
    currentPlan,
    fences,
    expectedAllocationRevision: normalized.expectedAllocationRevision,
    settlementExecutionRevisionId: eventExecutionRevisionId,
    nowISO: recordedAtISO
  });
  const resultingPlan = settlement?.plan || currentPlan;
  const resultingFences = settlement?.fences || Object.freeze(fences);
  const commandDigest = inventory.digest(normalized, "event ingredient execution request");
  const nextStockStates = [];
  const movements = [];
  const rows = [];

  for (const line of normalized.ingredients) {
    const planRow = planById.get(line.ingredientId);
    const requirementRow = requirementById.get(line.ingredientId);
    const priorRow = priorById.get(line.ingredientId) || null;
    if (!requirementRow || planRow.locationId !== line.locationId
      || planRow.baseUnitId !== line.baseUnitId || requirementRow.baseUnitId !== line.baseUnitId
      || planRow.requiredQuantityMicros !== requirementRow.requiredQuantityMicros
      || (correction && (!priorRow || priorRow.locationId !== line.locationId
        || priorRow.baseUnitId !== line.baseUnitId))) {
      fail("failed-precondition", "Execution line does not match its pinned plan and requirement.");
    }
    const stock = stockByIdentity.get(`${line.ingredientId}\u0000${line.locationId}`);
    if (!stock) fail("failed-precondition", "Execution requires current stock for every ingredient.");
    inventory.verifyStockState(stock, {
      organizationId: orgId,
      ingredientId: line.ingredientId,
      locationId: line.locationId
    });
    if (stock.baseUnitId !== line.baseUnitId || stock.revision !== line.expectedStockRevision) {
      fail("aborted", "Ingredient stock changed before event execution was recorded.");
    }
    const fence = fenceById.get(planRow.fenceId);
    if (!fence) fail("data-loss", "Execution is missing an ingredient allocation fence.");
    allocation.verifyFence(fence, {
      organizationId: orgId,
      ingredientId: line.ingredientId,
      locationId: line.locationId
    });
    const ownAllocation = fence.allocations.find(({ allocationId }) => allocationId === planRow.allocationId) || null;
    if (!correction && ((planRow.allocatedQuantityMicros > 0
      && (!ownAllocation || ownAllocation.quantityMicros !== planRow.allocatedQuantityMicros))
      || (planRow.allocatedQuantityMicros === 0 && ownAllocation))) {
      fail("data-loss", "Execution plan disagrees with its active contention fence.");
    }
    if (correction && ownAllocation) {
      fail("data-loss", "Settled execution unexpectedly retains an active allocation.");
    }
    const depletedQuantityMicros = safeAdd(
      line.consumedQuantityMicros,
      line.wasteQuantityMicros,
      "actual depletion quantity"
    );
    const priorDepletedQuantityMicros = priorRow?.depletedQuantityMicros || 0;
    const delta = depletedQuantityMicros - priorDepletedQuantityMicros;
    const stockEffectDirection = delta > 0 ? "decrease" : delta < 0 ? "increase" : "unchanged";
    const stockEffectQuantityMicros = Math.abs(delta);
    const resultOnHandMicros = stock.onHandMicros
      + (stockEffectDirection === "increase" ? stockEffectQuantityMicros
        : stockEffectDirection === "decrease" ? -stockEffectQuantityMicros : 0);
    if (!Number.isSafeInteger(resultOnHandMicros) || resultOnHandMicros < 0) {
      fail("failed-precondition", "Event execution cannot consume more ingredient stock than is physically on hand.");
    }
    const otherCommitments = correction
      ? fence.committedMicros
      : fence.committedMicros - planRow.allocatedQuantityMicros;
    if (otherCommitments < 0 || resultOnHandMicros < otherCommitments) {
      fail("failed-precondition", "Event execution must preserve stock committed to other events.");
    }
    const resultStockRevision = stock.revision + (stockEffectDirection === "unchanged" ? 0 : 1);
    const movementId = stockEffectDirection === "unchanged" ? ""
      : inventory.eventMovementIdFor(orgId, retryId, line.ingredientId, line.locationId);
    const nextStock = Object.freeze(stockEffectDirection === "unchanged" ? stock : {
      ...stock,
      revision: resultStockRevision,
      onHandMicros: resultOnHandMicros,
      lastMovementId: movementId,
      updatedAtISO: recordedAtISO
    });
    nextStockStates.push(nextStock);
    if (movementId) {
      const body = {
        authorityVersion: inventory.INVENTORY_AUTHORITY_VERSION,
        schemaVersion: inventory.INVENTORY_SCHEMA_VERSION,
        movementVersion: inventory.INVENTORY_MOVEMENT_VERSION,
        organizationId: orgId,
        movementId,
        requestId: retryId,
        requestDigest: commandDigest,
        kind: correction ? "event_depletion_correction" : "event_depletion",
        ingredientId: line.ingredientId,
        locationId: line.locationId,
        baseUnitId: line.baseUnitId,
        quantity: inventory.formatQuantityMicros(stockEffectQuantityMicros),
        quantityMicros: stockEffectQuantityMicros,
        priorStockRevision: stock.revision,
        resultStockRevision,
        priorOnHandMicros: stock.onHandMicros,
        resultOnHandMicros,
        occurredAtISO: normalized.occurredAtISO,
        recordedAtISO,
        note: normalized.reason,
        actor: normalizedActor,
        direction: stockEffectDirection,
        quoteId: normalized.quoteId,
        eventPlanId: currentPlan.eventPlanId,
        eventRequirementRevisionId: normalized.eventRequirementRevisionId,
        eventExecutionRevisionId,
        executionRevision,
        priorDepletedQuantityMicros,
        resultDepletedQuantityMicros: depletedQuantityMicros,
        consumedQuantityMicros: line.consumedQuantityMicros,
        wasteQuantityMicros: line.wasteQuantityMicros
      };
      const movement = Object.freeze({
        ...body,
        movementDigest: inventory.digest(body, "ingredient movement")
      });
      inventory.verifyMovement(movement);
      movements.push(movement);
    }
    const cost = plannedBasisFor(requirementRow, depletedQuantityMicros);
    const row = {
      ingredientId: line.ingredientId,
      locationId: line.locationId,
      baseUnitId: line.baseUnitId,
      plannedQuantityMicros: planRow.requiredQuantityMicros,
      allocatedQuantityMicros: planRow.allocatedQuantityMicros,
      consumedQuantity: line.consumedQuantity,
      consumedQuantityMicros: line.consumedQuantityMicros,
      wasteQuantity: line.wasteQuantity,
      wasteQuantityMicros: line.wasteQuantityMicros,
      depletedQuantityMicros,
      priorDepletedQuantityMicros,
      stockEffectDirection,
      stockEffectQuantityMicros,
      allocationReleasedQuantityMicros: correction ? 0 : planRow.allocatedQuantityMicros,
      priorStockRevision: stock.revision,
      resultStockRevision,
      priorOnHandMicros: stock.onHandMicros,
      resultOnHandMicros,
      plannedBasisCostState: cost.state
    };
    if (cost.state === "complete") Object.assign(row, {
      currency: cost.currency,
      exactPlannedBasisUsageCostMinor: cost.exactUsageCostMinor,
      plannedBasisUsageCostMinor: cost.usageCostMinor,
      plannedProjectedCostMinor: cost.plannedProjectedCostMinor,
      plannedBasisVarianceMinor: cost.varianceMinor
    });
    rows.push(Object.freeze(row));
  }
  const costSummary = buildCostSummary(rows);
  const body = {
    authorityVersion: inventory.INVENTORY_AUTHORITY_VERSION,
    schemaVersion: inventory.INVENTORY_SCHEMA_VERSION,
    executionVersion: EXECUTION_VERSION,
    model: "event-ingredient-execution-v1",
    organizationId: orgId,
    quoteId: normalized.quoteId,
    eventPlanId: currentPlan.eventPlanId,
    eventRequirementRevisionId: normalized.eventRequirementRevisionId,
    requirementDigest: pinnedRequirement.requirementDigest,
    executionRevision,
    eventExecutionRevisionId,
    priorEventExecutionRevisionId: currentExecution?.eventExecutionRevisionId || "",
    settlementExecutionRevisionId: currentExecution?.settlementExecutionRevisionId || eventExecutionRevisionId,
    allocationRevision: resultingPlan.allocationRevision,
    state: "settled",
    occurredAtISO: normalized.occurredAtISO,
    reason: normalized.reason,
    ingredients: Object.freeze(rows),
    ingredientCount: rows.length,
    costSummary,
    recordedAtISO,
    actor: normalizedActor
  };
  const execution = Object.freeze({
    ...body,
    executionDigest: inventory.digest(body, "event ingredient execution")
  });
  verifyExecution(execution, { organizationId: orgId, quoteId: normalized.quoteId });
  return Object.freeze({
    request: normalized,
    execution,
    executionRevision: execution,
    plan: resultingPlan,
    fences: Object.freeze(resultingFences),
    stockStates: Object.freeze(nextStockStates),
    movements: Object.freeze(movements)
  });
}

module.exports = {
  EXECUTION_VERSION,
  MAX_EXECUTION_DOCUMENT_BYTES,
  MAX_EXECUTION_INGREDIENTS,
  InventoryExecutionError,
  eventExecutionRevisionIdFor,
  normalizeExecutionRequest,
  planEventIngredientExecution,
  verifyEventIngredientExecution: verifyExecution,
  verifyExecution
};
