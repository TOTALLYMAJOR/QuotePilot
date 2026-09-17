import { buildDecisionPacketProjection } from "./quoteConfidenceDecisionPacket";

const STATES = new Set(["available", "missing", "not_applicable", "not_yet_available", "blocked_by_integration", "contradictory", "schema_drift", "unavailable", "stale", "partial", "loading"]);
const whole = (value) => Number.isSafeInteger(value) && value >= 0;
const text = (value) => typeof value === "string" ? value.trim() : "";
const freeze = (value) => { if (value && typeof value === "object") { Object.values(value).forEach(freeze); Object.freeze(value); } return value; };
const state = (value, fallback = "missing") => STATES.has(value) ? value : fallback;
const row = (id, label, availability, reason, extra = {}) => ({ id, label, availability, reason, sourceReferences: [], ...extra });

export function resolvePostEventLearningGate({ buildValue = "", tenantValue = false } = {}) {
  return ["true", "1", "yes", "on"].includes(String(buildValue).trim().toLowerCase()) && tenantValue === true;
}

function readState(read, scope) {
  if (!read) return "missing";
  if (!read.state && !read.source?.state) return "missing";
  if (read.state && !["current", "available"].includes(read.state)) return state(read.state, "unavailable");
  if (read.retained || read.source?.fromCache || read.source?.hasPendingWrites) return "stale";
  if (read.source && read.source.state !== "current") return state(read.source.state, "stale");
  const value = read.projection || read.snapshot;
  if (!value) return read.exists === false ? "not_yet_available" : "missing";
  if (value.organizationId !== scope.organizationId || value.quoteId !== scope.quoteId) return "contradictory";
  return "available";
}

/** Pure observation only. No price, policy, recipe quantity, or adoption is inferred. */
export function buildPostEventLearningProjection({ organizationId, quote = {}, acceptedVersion = null, closeout = {}, source = "", planRead, executionRead, financialRead } = {}) {
  const packet = buildDecisionPacketProjection({ quote, source });
  const scope = { organizationId, quoteId: text(quote.id), sourceVersionId: packet.internalHandoff.acceptedRevisionId, acceptanceReceiptId: packet.internalHandoff.acceptanceReceiptId };
  let acceptedState = packet.internalHandoff.evidenceState;
  const snapshot = acceptedVersion?.snapshot;
  if (acceptedState === "available") {
    if (!acceptedVersion) acceptedState = "missing";
    else if (quote.organizationId !== organizationId || acceptedVersion.organizationId !== organizationId || acceptedVersion.quoteId !== scope.quoteId || snapshot?.organizationId !== organizationId || snapshot?.id !== scope.quoteId || acceptedVersion.legacySynthetic === true) acceptedState = "contradictory";
    else if ((acceptedVersion.versionId || acceptedVersion.id) !== scope.sourceVersionId || closeout.sourceVersionId !== scope.sourceVersionId || closeout.acceptanceReceiptId !== scope.acceptanceReceiptId) acceptedState = "stale";
    else if (!whole(snapshot.event?.guests) || snapshot.event.guests < 1) acceptedState = "schema_drift";
  }
  const sources = [scope.sourceVersionId, scope.acceptanceReceiptId].filter(Boolean);
  const result = { schemaVersion: "post-event-learning-proposal-v1", authority: "read_only_recommendation", scope, acceptedState, rows: [], proposals: [], boundary: "Review observations against this accepted event. Recommendations change nothing until an operator edits and applies them through the existing Library, Inventory, or setup-draft authority. Pricing, margins, rates, thresholds, and supplier policy are never inferred." };
  if (acceptedState !== "available") {
    result.rows.push(row("accepted_source", "Accepted event", acceptedState, "Refresh the exact accepted quote, immutable version, and closeout receipt before comparing this event."));
    return freeze(result);
  }
  const propose = (category, reason, references, targetIds = []) => result.proposals.push({
    proposalId: `${category}:${scope.quoteId}:${scope.sourceVersionId}:${references.join(":")}`,
    category, rationale: reason, sourceReferences: [...sources, ...references], targetIds: [...targetIds],
    adoption: "operator_review_required", suggestedValues: null,
    destination: category === "pack_conversion" ? "inventory" : "library"
  });
  const attendance = closeout.actualAttendance;
  let attendanceState = attendance ? "available" : "not_yet_available";
  if (attendance && (!whole(attendance.count) || !whole(attendance.revision) || attendance.revision < 1 || !text(attendance.lastReceiptId) || attendance.sourceReferenceId !== attendance.lastReceiptId)) attendanceState = "schema_drift";
  result.rows.push(row("attendance", "Attendance", attendanceState, "The accepted priced count and recorded attendance have separate authority.", attendanceState === "available" ? {
    planned: snapshot.event.guests, actual: attendance.count, difference: attendance.count - snapshot.event.guests, unit: "guests", sourceReferences: [...sources, attendance.lastReceiptId]
  } : {}));
  if (attendanceState === "available" && attendance.count !== snapshot.event.guests) propose("template", "Attendance differed from the accepted priced count. Review the next event's template questions; this does not change a guest count or portion rule.", [attendance.lastReceiptId]);

  const plan = planRead?.projection;
  let planState = readState(planRead, scope);
  if (planState === "available") {
    if (plan.quoteRevisionId !== scope.sourceVersionId || plan.freshnessState?.demand?.state === "stale") planState = "stale";
    else if (!text(plan.eventRequirementRevisionId) || !Array.isArray(plan.ingredients)) planState = "schema_drift";
    else if (plan.demandState !== "complete") planState = plan.demandState === "invalid" ? "schema_drift" : "partial";
  }
  result.rows.push(row("requirement", "Ingredient requirement", planState, "Saved ingredient requirements retain the accepted quote and recipe references.", planState === "available" ? { sourceReferences: [plan.eventRequirementRevisionId, ...(plan.sourceRevisions?.recipeRevisionIds || [])] } : {}));
  const allocation = plan?.allocation;
  let allocationState = planState;
  if (allocationState === "available") {
    if (!allocation) allocationState = "not_yet_available";
    else if (allocation.eventRequirementRevisionId !== plan.eventRequirementRevisionId || !["current", "settled"].includes(plan.freshnessState?.allocation?.state)) allocationState = "stale";
  }
  result.rows.push(row("allocation", "Ingredient allocation", allocationState, "A recorded allocation is separate from physical receiving and usage.", allocationState === "available" ? { sourceReferences: [allocation.eventPlanId, String(allocation.allocationRevision)], detail: allocation.state } : {}));
  // The existing event projection has no event-bound receiving journal. Never attribute warehouse receipts to this event.
  result.rows.push(row("receiving", "Receiving", "blocked_by_integration", "Event-bound receiving evidence is not exposed by the current projection. Review physical receipt evidence in Inventory; expected supply is not received stock."));

  const execution = executionRead?.projection;
  let executionState = readState(executionRead, scope);
  if (executionState === "available") {
    if (planState !== "available") executionState = planState;
    else if (allocationState !== "available") executionState = allocationState;
    else if (execution.eventRequirementRevisionId !== plan.eventRequirementRevisionId || execution.eventPlanId !== allocation?.eventPlanId || execution.allocationRevision !== allocation?.allocationRevision || execution.freshness?.state !== "current") executionState = "stale";
    else if (!whole(execution.executionRevision) || execution.executionRevision < 1 || !text(execution.lastReceiptId) || !Array.isArray(execution.ingredients)) executionState = "schema_drift";
    else if (new Set(plan.ingredients.map((item) => item.ingredientId)).size !== plan.ingredients.length || new Set(execution.ingredients.map((item) => item.ingredientId)).size !== execution.ingredients.length || execution.ingredients.length !== plan.ingredients.length || execution.ingredients.some((item) => {
      const planned = plan.ingredients.find((candidate) => candidate.ingredientId === item.ingredientId);
      return !planned || planned.baseUnitId !== item.baseUnitId || planned.requiredQuantityMicros !== item.plannedQuantityMicros || ![item.plannedQuantityMicros, item.consumedQuantityMicros, item.wasteQuantityMicros, item.depletedQuantityMicros].every(whole) || item.consumedQuantityMicros + item.wasteQuantityMicros !== item.depletedQuantityMicros;
    })) executionState = "contradictory";
  }
  result.rows.push(row("execution", "Ingredient usage", executionState, "Consumed and wasted quantities are compared per ingredient and base unit; unlike units are never summed.", executionState === "available" ? { sourceReferences: [execution.eventExecutionRevisionId, execution.lastReceiptId] } : {}));
  if (executionState === "available") {
    for (const item of execution.ingredients) {
      const refs = [plan.eventRequirementRevisionId, execution.eventExecutionRevisionId, execution.lastReceiptId, `ingredient:${item.ingredientId}`];
      result.rows.push(row(`ingredient:${item.ingredientId}`, item.name || item.ingredientId, "available", `Consumed ${(item.consumedQuantityMicros / 1e6).toString()}; waste ${(item.wasteQuantityMicros / 1e6).toString()}.`, { planned: item.plannedQuantityMicros / 1e6, actual: item.depletedQuantityMicros / 1e6, difference: (item.depletedQuantityMicros - item.plannedQuantityMicros) / 1e6, unit: item.baseUnitId, sourceReferences: refs }));
      if (item.depletedQuantityMicros !== item.plannedQuantityMicros || item.wasteQuantityMicros > 0) propose("recipe", "Recorded usage or waste differed from the saved requirement. Review the referenced recipes before the next event; no replacement quantity or yield is inferred.", refs, [...new Set((plan.ingredients.find((candidate) => candidate.ingredientId === item.ingredientId)?.contributions || []).map((contribution) => contribution.menuItemId).filter(Boolean))]);
    }
    result.rows.push(row("corrections", "Usage corrections", "available", "Only the latest immutable execution revision is loaded; this is not a complete correction history.", { detail: execution.executionRevision > 1 ? `Latest revision ${execution.executionRevision}; prior totals were corrected.` : "Initial execution revision", sourceReferences: [execution.eventExecutionRevisionId, execution.lastReceiptId] }));
    if (execution.executionRevision > 1) propose("workflow", "Usage was corrected after initial capture. Review the closeout checklist and recording practice; no workflow rule is changed.", [execution.eventExecutionRevisionId, execution.lastReceiptId]);
    const cost = execution.costSummary;
    if (cost?.plannedBasisState === "complete" && [cost.knownUsageCostMinor, cost.plannedProjectedCostMinor].every(whole) && cost.plannedBasisVarianceMinor === cost.knownUsageCostMinor - cost.plannedProjectedCostMinor) {
      result.rows.push(row("planned_basis_cost", "Usage at saved cost basis", "available", "Comparison at the saved planning basis only. Actual inventory COGS remains unavailable pending declared valuation policy.", { planned: cost.plannedProjectedCostMinor / 100, actual: cost.knownUsageCostMinor / 100, difference: cost.plannedBasisVarianceMinor / 100, unit: cost.currency, sourceReferences: [execution.eventExecutionRevisionId] }));
    } else {
      result.rows.push(row("planned_basis_cost", "Usage at saved cost basis", cost?.plannedBasisState === "complete" ? "schema_drift" : state(cost?.plannedBasisState, "unavailable"), "The saved cost basis is incomplete or unavailable. No actual COGS or missing cost is inferred."));
    }
  } else result.rows.push(row("corrections", "Usage corrections", executionState, "Exact execution evidence is required before identifying a correction."));
  if (planState === "partial" && plan?.quoteRevisionId === scope.sourceVersionId && (plan.issues || []).some((issue) => /conversion|pack/.test(text(issue.code)))) propose("pack_conversion", "The recorded requirement contains an unresolved conversion. Review an operator-declared pack conversion in Inventory; contents, density, or yield are not inferred.", [plan.eventRequirementRevisionId], [...new Set(plan.issues.filter((issue) => /conversion|pack/.test(text(issue.code))).map((issue) => issue.ingredientId).filter(Boolean))]);

  const financial = financialRead?.snapshot;
  let financialState = readState(financialRead, scope);
  if (financialState === "available") {
    if (financial.sourceVersionId !== scope.sourceVersionId || financial.acceptanceReceiptId !== scope.acceptanceReceiptId) financialState = "stale";
    else if (financial.availability !== "available") financialState = state(financial.availability, "unavailable");
    else if (!whole(financial.totals?.totalCostCents) || financial.currency !== "USD") financialState = "schema_drift";
  }
  result.rows.push(row("financial", "Recorded financial actuals", financialState, "Recorded costs are a subtotal until capture is explicitly declared complete. They do not establish payment, profit, or inventory valuation.", financialState === "available" ? { actual: financial.totals.totalCostCents / 100, unit: financial.currency, detail: financial.captureComplete ? "Capture declared complete" : "Provisional captured subtotal", sourceReferences: [financial.ledgerId, String(financial.revision), financial.lastReceiptId].filter(Boolean) } : {}));
  return freeze(result);
}
