const UNCERTAIN_READ_STATES = new Set([
  "cached",
  "idle",
  "loading",
  "pending",
  "unavailable"
]);

const AXIS_ACTION = Object.freeze({
  physical: "inventory_plan",
  cost: "menu_costing",
  execution: "ingredient_execution"
});

function text(value) {
  return String(value ?? "").trim();
}

function stateOf(value) {
  return text(value).toLowerCase();
}

function frozenAxis(state, title, detail, evidence, actionKind, extra = {}) {
  return Object.freeze({ state, title, detail, evidence, actionKind, ...extra });
}

function readIsCurrent(read) {
  const state = stateOf(read?.state);
  const sourceState = stateOf(read?.sourceState);
  return sourceState === "current" && !UNCERTAIN_READ_STATES.has(state);
}

function currentProjection(read) {
  return readIsCurrent(read) && read?.projection && typeof read.projection === "object"
    ? read.projection
    : null;
}

function identityMatches(plan, activeQuoteRevisionId) {
  const activeRevision = text(activeQuoteRevisionId);
  return Boolean(activeRevision && text(plan?.quoteRevisionId) === activeRevision);
}

function planIsStale(plan, allocation = null) {
  const freshness = plan?.freshnessState || {};
  return stateOf(plan?.freshness) === "stale"
    || stateOf(freshness.demand?.state) === "stale"
    || (allocation && stateOf(freshness.allocation?.state) === "stale");
}

function executionMatchesPlan(execution, plan, allocation) {
  return stateOf(execution?.state) === "settled"
    && text(execution?.quoteId) === text(plan?.quoteId)
    && text(execution?.eventPlanId) === text(allocation?.eventPlanId)
    && text(execution?.eventRequirementRevisionId) === text(allocation?.eventRequirementRevisionId)
    && Number.isSafeInteger(execution?.allocationRevision)
    && execution.allocationRevision === allocation?.allocationRevision
    && Number.isSafeInteger(execution?.executionRevision)
    && execution.executionRevision > 0
    && text(execution?.eventExecutionRevisionId)
    && text(execution?.settlementExecutionRevisionId);
}

function safeMicros(value) {
  return Number.isSafeInteger(value) && value >= 0 ? value : null;
}

function addMicros(left, right) {
  if (left === null || right === null) return null;
  const sum = left + right;
  return Number.isSafeInteger(sum) && sum >= 0 ? sum : null;
}

function buildBaseUnitMetrics(ingredients) {
  if (!Array.isArray(ingredients) || ingredients.length === 0) return null;
  const groups = new Map();
  for (const ingredient of ingredients) {
    const baseUnitId = text(ingredient?.baseUnitId);
    const values = {
      plannedQuantityMicros: safeMicros(ingredient?.plannedQuantityMicros),
      allocatedQuantityMicros: safeMicros(ingredient?.allocatedQuantityMicros),
      consumedQuantityMicros: safeMicros(ingredient?.consumedQuantityMicros),
      wasteQuantityMicros: safeMicros(ingredient?.wasteQuantityMicros),
      depletedQuantityMicros: safeMicros(ingredient?.depletedQuantityMicros)
    };
    if (!baseUnitId || Object.values(values).some((value) => value === null)
      || values.depletedQuantityMicros !== values.consumedQuantityMicros + values.wasteQuantityMicros) {
      return null;
    }
    const prior = groups.get(baseUnitId) || {
      baseUnitId,
      ingredientCount: 0,
      plannedQuantityMicros: 0,
      allocatedQuantityMicros: 0,
      consumedQuantityMicros: 0,
      wasteQuantityMicros: 0,
      depletedQuantityMicros: 0
    };
    prior.ingredientCount += 1;
    for (const key of Object.keys(values)) prior[key] = addMicros(prior[key], values[key]);
    if (Object.values(prior).some((value) => value === null)) return null;
    groups.set(baseUnitId, prior);
  }
  return Object.freeze([...groups.values()]
    .sort((left, right) => left.baseUnitId < right.baseUnitId ? -1 : left.baseUnitId > right.baseUnitId ? 1 : 0)
    .map((group) => Object.freeze(group)));
}

function unavailablePlannedBasis(state = "unavailable") {
  return Object.freeze({
    state,
    currency: null,
    knownUsageCostMinor: null,
    plannedProjectedCostMinor: null,
    varianceMinor: null
  });
}

function buildPlannedBasisCost(execution) {
  const summary = execution?.costSummary || {};
  const rows = Array.isArray(execution?.ingredients) ? execution.ingredients : [];
  const state = stateOf(summary.plannedBasisState);
  if (state !== "complete") {
    return unavailablePlannedBasis(["partial", "invalid", "unavailable"].includes(state) ? state : "unavailable");
  }
  const currency = text(summary.currency);
  const currencies = new Set(rows.map((row) => text(row?.currency)).filter(Boolean));
  const knownUsageCostMinor = summary.knownUsageCostMinor;
  const plannedProjectedCostMinor = summary.plannedProjectedCostMinor;
  const varianceMinor = summary.plannedBasisVarianceMinor;
  const complete = /^[A-Z]{3}$/u.test(currency)
    && currencies.size === 1
    && currencies.has(currency)
    && rows.every((row) => stateOf(row?.plannedBasisCostState) === "complete")
    && Number.isSafeInteger(knownUsageCostMinor)
    && knownUsageCostMinor >= 0
    && Number.isSafeInteger(plannedProjectedCostMinor)
    && plannedProjectedCostMinor >= 0
    && Number.isSafeInteger(varianceMinor)
    && varianceMinor === knownUsageCostMinor - plannedProjectedCostMinor;
  return complete ? Object.freeze({
    state: "complete",
    currency,
    knownUsageCostMinor,
    plannedProjectedCostMinor,
    varianceMinor
  }) : unavailablePlannedBasis("invalid");
}

function buildExecutionMetrics(execution) {
  const baseUnits = buildBaseUnitMetrics(execution?.ingredients);
  const actualCogsState = stateOf(execution?.costSummary?.actualCogsState);
  const actualCogsReason = text(execution?.costSummary?.actualCogsReason);
  if (!baseUnits || actualCogsState !== "unavailable" || actualCogsReason !== "valuation_policy_unresolved") {
    return null;
  }
  return Object.freeze({
    ingredientCount: execution.ingredients.length,
    baseUnits,
    plannedBasisCost: buildPlannedBasisCost(execution),
    actualCogs: Object.freeze({
      state: "unavailable",
      reason: "valuation_policy_unresolved"
    })
  });
}

function physicalAxis({ planRead, executionRead, activeQuoteRevisionId }) {
  if (!readIsCurrent(planRead)) {
    return frozenAxis("unknown", "Ingredient allocation is not current", "Refresh the exact event ingredient plan before relying on retained stock commitments.", "Current event ingredient plan unavailable", AXIS_ACTION.physical);
  }
  const plan = currentProjection(planRead);
  if (!plan) {
    return frozenAxis("attention", "Ingredient demand is not planned", "Record the event ingredient requirement and allocation before treating stock as committed.", "No saved event ingredient plan", AXIS_ACTION.physical);
  }
  if (!identityMatches(plan, activeQuoteRevisionId)) {
    return frozenAxis("unknown", "Ingredient plan identity does not match", "The projection belongs to a different commercial revision. Open the exact event plan before relying on it.", "Commercial revision mismatch", AXIS_ACTION.physical);
  }
  const allocation = plan.allocation || null;
  if (planIsStale(plan, allocation)) {
    return frozenAxis("attention", "Ingredient allocation needs reconciliation", "The saved plan is stale. Its historical hold is preserved until an authorized reconcile or release command changes it.", "Stale event ingredient plan", AXIS_ACTION.physical);
  }
  if (stateOf(plan.demandState) !== "complete") {
    return frozenAxis("attention", "Ingredient demand is incomplete", "Resolve missing portions, recipes, units, or conversions before relying on the event requirement.", "Incomplete ingredient demand", AXIS_ACTION.physical);
  }
  if (!allocation) {
    return frozenAxis("attention", "Ingredients are not allocated", "Saved availability is informational and does not commit stock for this event.", "No allocation receipt recorded", AXIS_ACTION.physical);
  }
  const allocationState = stateOf(allocation.state);
  if (allocationState === "reserved") {
    return frozenAxis("satisfied", "Ingredients are fully allocated", "The current event plan records a full physical allocation against authoritative stock.", `Allocation revision ${allocation.allocationRevision}`, AXIS_ACTION.physical);
  }
  if (allocationState === "settled") {
    if (!readIsCurrent(executionRead)) {
      return frozenAxis("unknown", "Settled allocation needs current usage evidence", "Refresh the exact execution projection before treating this settled allocation as physically complete.", "Current ingredient execution unavailable", AXIS_ACTION.physical);
    }
    const execution = currentProjection(executionRead);
    if (!execution) {
      return frozenAxis("attention", "Settled allocation lacks usage evidence", "The plan reports settlement, but no exact execution projection is recorded.", "Missing settlement execution", AXIS_ACTION.physical);
    }
    if (!executionMatchesPlan(execution, plan, allocation)) {
      return frozenAxis("unknown", "Settlement identity does not match", "The execution evidence does not match this event plan, requirement, and allocation revision.", "Execution identity mismatch", AXIS_ACTION.physical);
    }
    return frozenAxis("satisfied", "Ingredient settlement is recorded", "Current consumption and waste evidence closes the allocation without implying authoritative actual COGS.", `Execution revision ${execution.executionRevision}`, AXIS_ACTION.physical);
  }
  if (allocationState === "shortage") {
    return frozenAxis("attention", "Ingredient allocation has a shortage", "The allocation command preserved the available quantity and left unmet demand for operator resolution.", `${allocation.shortageIngredientCount || 0} ingredient line${allocation.shortageIngredientCount === 1 ? "" : "s"} short`, AXIS_ACTION.physical);
  }
  if (allocationState === "released") {
    return frozenAxis("attention", "Ingredient allocation was released", "No stock is currently committed to this event. Release changed the allocation, not physical on-hand stock.", "Released event allocation", AXIS_ACTION.physical);
  }
  return frozenAxis("unknown", "Ingredient allocation evidence is unsupported", "Open the exact ingredient plan before relying on this allocation state.", "Unclassified allocation evidence", AXIS_ACTION.physical);
}

function costAxis({ planRead, activeQuoteRevisionId }) {
  if (!readIsCurrent(planRead)) {
    return frozenAxis("unknown", "Projected ingredient cost is not current", "Refresh the exact saved projection before relying on retained cost evidence.", "Current menu-cost projection unavailable", AXIS_ACTION.cost);
  }
  const plan = currentProjection(planRead);
  if (!plan) {
    return frozenAxis("unknown", "Projected ingredient cost is not available", "Compile menu-item recipes for this event to establish a projected ingredient-cost basis.", "No saved event cost projection", AXIS_ACTION.cost);
  }
  if (!identityMatches(plan, activeQuoteRevisionId)) {
    return frozenAxis("unknown", "Projected cost identity does not match", "The saved estimate belongs to a different commercial revision and remains historical evidence.", "Commercial revision mismatch", AXIS_ACTION.cost);
  }
  const costFreshness = stateOf(plan?.freshnessState?.cost?.state);
  if (costFreshness === "stale") {
    return frozenAxis("attention", "Projected ingredient cost needs recalculation", "Recipe or commercial inputs changed. Preserve the prior estimate and compile a new current projection.", "Stale menu-cost projection", AXIS_ACTION.cost);
  }
  const costState = stateOf(plan.costState);
  if (costState === "complete") {
    if (!/^[A-Z]{3}$/u.test(text(plan.currency))
      || !Number.isSafeInteger(plan.projectedCostMinor)
      || plan.projectedCostMinor < 0) {
      return frozenAxis("unknown", "Projected ingredient cost evidence is invalid", "The projection claims complete costing without a safe amount and currency.", "Contradictory menu-cost evidence", AXIS_ACTION.cost);
    }
    return frozenAxis("satisfied", "Projected ingredient cost is complete", "Every required ingredient has recorded cost evidence for this saved estimate.", `Saved estimate for quote revision ${plan.quoteRevisionId}`, AXIS_ACTION.cost);
  }
  if (costState === "partial") {
    return frozenAxis("attention", "Projected ingredient cost is partial", "Known contributions remain visible, but missing cost evidence prevents a complete event ingredient total.", "Partial menu-cost coverage", AXIS_ACTION.cost);
  }
  if (costState === "invalid") {
    return frozenAxis("attention", "Projected ingredient cost has conflicting evidence", "Resolve invalid recipe or cost inputs before relying on the estimate.", "Invalid menu-cost evidence", AXIS_ACTION.cost);
  }
  return frozenAxis("unknown", "Projected ingredient cost is unknown", "Missing recorded cost remains unknown and is never converted to zero.", "Cost evidence unavailable", AXIS_ACTION.cost);
}

function executionAxis({ planRead, executionRead, activeQuoteRevisionId }) {
  if (!readIsCurrent(planRead)) {
    return frozenAxis("unknown", "Ingredient usage cannot be confirmed", "Refresh the exact event plan before interpreting consumption and waste evidence.", "Current event ingredient plan unavailable", AXIS_ACTION.execution, { metrics: null });
  }
  const plan = currentProjection(planRead);
  if (!plan) {
    return frozenAxis("attention", "Ingredient usage is not ready to record", "Plan and allocate event ingredients before recording consumption or waste.", "No saved event ingredient plan", AXIS_ACTION.execution, { metrics: null });
  }
  if (!identityMatches(plan, activeQuoteRevisionId)) {
    return frozenAxis("unknown", "Ingredient usage identity does not match", "The plan belongs to a different commercial revision. Open the exact event context before relying on usage.", "Commercial revision mismatch", AXIS_ACTION.execution, { metrics: null });
  }
  const allocation = plan.allocation || null;
  if (planIsStale(plan, allocation)) {
    return frozenAxis("attention", "Ingredient usage plan is stale", "Reconcile the preserved allocation before recording or interpreting current usage.", "Stale event ingredient plan", AXIS_ACTION.execution, { metrics: null });
  }
  if (!allocation) {
    return frozenAxis("attention", "Ingredient usage is not ready to record", "Allocate event ingredients before recording consumption and waste.", "No event allocation", AXIS_ACTION.execution, { metrics: null });
  }
  if (stateOf(allocation.state) === "released") {
    return frozenAxis("attention", "Ingredient usage is not recorded", "The allocation was released, so there is no active event stock commitment to settle.", "Released event allocation", AXIS_ACTION.execution, { metrics: null });
  }
  if (!readIsCurrent(executionRead)) {
    return frozenAxis("unknown", "Ingredient usage evidence is not current", "Refresh the exact execution projection before relying on retained consumption or waste.", "Current ingredient execution unavailable", AXIS_ACTION.execution, { metrics: null });
  }
  const execution = currentProjection(executionRead);
  if (!execution) {
    return frozenAxis("attention", "Ingredient usage is not recorded", "Record consumed and wasted quantities after the event; allocation alone is not consumption.", "No ingredient execution revision", AXIS_ACTION.execution, { metrics: null });
  }
  if (stateOf(allocation.state) !== "settled" || !executionMatchesPlan(execution, plan, allocation)) {
    return frozenAxis("unknown", "Ingredient usage identity does not match", "The execution projection does not match the current settled plan, requirement, and allocation revision.", "Execution identity mismatch", AXIS_ACTION.execution, { metrics: null });
  }
  const metrics = buildExecutionMetrics(execution);
  if (!metrics) {
    return frozenAxis("unknown", "Ingredient usage evidence is invalid", "The exact execution projection contains quantities that cannot be safely summarized by base unit.", "Invalid execution quantities", AXIS_ACTION.execution, { metrics: null });
  }
  return frozenAxis("satisfied", "Ingredient usage is recorded", "Consumption and waste are recorded separately against the saved plan. Corrections create a new immutable revision.", `Execution revision ${execution.executionRevision} · receipt ${text(execution.lastReceiptId) || "recorded"}`, AXIS_ACTION.execution, { metrics });
}

export function buildEventIngredientOperationalPresentation({
  planRead = {},
  executionRead = {},
  activeQuoteRevisionId = ""
} = {}) {
  return Object.freeze({
    physical: physicalAxis({ planRead, executionRead, activeQuoteRevisionId }),
    cost: costAxis({ planRead, activeQuoteRevisionId }),
    execution: executionAxis({ planRead, executionRead, activeQuoteRevisionId }),
    boundary: "Physical allocation, projected ingredient cost, and recorded execution are independent evidence. None establishes overall event readiness or authoritative actual COGS."
  });
}

export default buildEventIngredientOperationalPresentation;
