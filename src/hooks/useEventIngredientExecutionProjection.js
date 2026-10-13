import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
  applyInventoryCommand,
  buildInventoryRequestId,
  getInventoryMenuCostBrowserAccess,
  isDefinitiveInventoryError,
  reconcileInventoryCommand,
  resetDefinitiveInventoryCommand,
  subscribeToEventIngredientExecutionProjection,
  subscribeToEventIngredientProjection
} from "../lib/inventoryAuthorityClient";

function text(value) {
  return String(value ?? "").trim();
}

function emptyRead(quoteId, state = "loading") {
  return { quoteId, state, sourceState: state, exists: false, projection: null, retained: false, error: "" };
}

function idleOperation() {
  return { state: "idle", message: "", requestId: "", receipt: null, confirmation: null };
}

function readFromModel(model, missingState) {
  const sourceState = text(model?.source?.state || model?.freshness) || "unavailable";
  const exists = model?.exists === true && Boolean(model?.projection);
  return {
    quoteId: text(model?.quoteId),
    state: sourceState === "current" && !exists ? missingState : sourceState,
    sourceState,
    exists,
    projection: exists ? model.projection : null,
    retained: model?.retained === true || (sourceState === "unavailable" && exists),
    error: ""
  };
}

function attemptError(error, requestId) {
  const wrapped = new Error(text(error?.message) || "Event ingredient usage did not return verified evidence.", { cause: error });
  wrapped.code = error?.code;
  wrapped.inventoryDefinitive = error?.inventoryDefinitive;
  wrapped.inventoryAttempt = { requestId };
  return wrapped;
}

export function useEventIngredientExecutionProjection({
  active = false,
  organizationId = "",
  role = "customer",
  browserEnabled = false,
  tenantEnabled = false,
  quoteId = "",
  quoteStatus = "",
  injected = null
} = {}) {
  const access = useMemo(() => getInventoryMenuCostBrowserAccess({
    organizationId, role, browserEnabled, tenantEnabled
  }), [browserEnabled, organizationId, role, tenantEnabled]);
  const scope = useMemo(() => ({ organizationId, role, browserEnabled, tenantEnabled }), [
    browserEnabled, organizationId, role, tenantEnabled
  ]);
  const [planRead, setPlanRead] = useState(() => emptyRead(text(quoteId), "not_evaluated"));
  const [read, setRead] = useState(() => emptyRead(text(quoteId), "not_recorded"));
  const [operation, setOperation] = useState(idleOperation);
  const lifecycleRef = useRef(0);

  useEffect(() => {
    lifecycleRef.current += 1;
    const lifecycle = lifecycleRef.current;
    if (injected || !active || !access.readEnabled || !text(quoteId)) {
      setPlanRead(emptyRead(text(quoteId), "not_evaluated"));
      setRead(emptyRead(text(quoteId), "not_recorded"));
      return undefined;
    }
    let listening = true;
    const unsubscribers = [];
    setPlanRead(emptyRead(text(quoteId)));
    setRead(emptyRead(text(quoteId)));
    const onFailure = (setter, fallback) => (error) => {
      if (!listening || lifecycleRef.current !== lifecycle) return;
      setter((current) => ({
        ...current,
        state: "unavailable",
        sourceState: "unavailable",
        retained: Boolean(current.projection),
        error: text(error?.message) || fallback
      }));
    };
    try {
      unsubscribers.push(subscribeToEventIngredientProjection({
        ...scope,
        quoteId,
        onData: (model) => listening && lifecycleRef.current === lifecycle
          && setPlanRead(readFromModel(model, "not_evaluated")),
        onError: onFailure(setPlanRead, "The current event ingredient plan is unavailable.")
      }));
      unsubscribers.push(subscribeToEventIngredientExecutionProjection({
        ...scope,
        quoteId,
        onData: (model) => listening && lifecycleRef.current === lifecycle
          && setRead(readFromModel(model, "not_recorded")),
        onError: onFailure(setRead, "The current event ingredient execution is unavailable.")
      }));
    } catch (error) {
      onFailure(setPlanRead, "The current event ingredient plan is unavailable.")(error);
      onFailure(setRead, "The current event ingredient execution is unavailable.")(error);
    }
    return () => {
      listening = false;
      lifecycleRef.current += 1;
      unsubscribers.forEach((unsubscribe) => unsubscribe?.());
    };
  }, [access.readEnabled, active, injected, quoteId, scope]);

  useEffect(() => {
    setOperation(idleOperation());
  }, [access.readEnabled, active, organizationId, quoteId]);

  useEffect(() => {
    if (read.sourceState !== "current" || !read.projection) return;
    setOperation((current) => {
      if (current.state !== "receipt" || !current.confirmation) return current;
      const result = current.confirmation;
      return read.projection.executionRevision === result.executionRevision
        && read.projection.eventExecutionRevisionId === result.eventExecutionRevisionId
        && read.projection.eventRequirementRevisionId === result.eventRequirementRevisionId
        && read.projection.lastReceiptId === current.receipt?.receiptId
        && JSON.stringify(read.projection.movementIds || []) === JSON.stringify(result.movementIds || [])
        ? { ...current, state: "committed", message: "Ingredient usage confirmed in the current execution projection." }
        : current;
    });
  }, [read]);

  const plan = planRead.projection;
  const execution = read.projection;
  const commerciallyEligible = ["accepted", "booked"].includes(text(quoteStatus).toLowerCase());
  const sourceCurrent = planRead.state === "current" && planRead.sourceState === "current"
    && read.sourceState === "current" && !["cached", "pending", "unavailable"].includes(read.state);
  const operationLocked = ["submitting", "receipt", "uncertain", "error"].includes(operation.state);
  const canRecord = sourceCurrent && commerciallyEligible && access.mutationEnabled
    && !execution && ["reserved", "shortage"].includes(plan?.allocation?.state);
  const canCorrect = sourceCurrent && commerciallyEligible && access.mutationEnabled
    && execution?.state === "settled" && plan?.allocation?.state === "settled";
  const controlsLocked = !sourceCurrent || operationLocked || (!canRecord && !canCorrect);
  const blockedReason = !commerciallyEligible
    ? "Ingredient usage is recorded only for accepted or booked events."
    : !access.mutationEnabled
      ? access.reason || "An administrator must record ingredient usage."
      : !sourceCurrent
        ? "Wait for current plan and execution projections before changing usage."
        : operationLocked
          ? "Resolve the current request before changing usage."
          : !plan?.allocation
            ? "Allocate event ingredients before recording usage."
            : "The current plan state does not allow this ingredient usage command.";

  const execute = useCallback(async (kind, input) => {
    const currentPlan = planRead.projection;
    const currentExecution = read.projection;
    const allowed = kind === "record_event_ingredient_execution" ? canRecord : canCorrect;
    if (!allowed || !currentPlan?.allocation) throw new Error(blockedReason);
    const requestId = buildInventoryRequestId();
    setOperation({ state: "submitting", message: "Recording ingredient usage…", requestId, receipt: null, confirmation: null });
    const command = {
      kind,
      quoteId: text(quoteId),
      eventRequirementRevisionId: currentPlan.allocation.eventRequirementRevisionId,
      expectedExecutionRevision: Number(currentExecution?.executionRevision || 0),
      expectedAllocationRevision: currentPlan.allocation.allocationRevision,
      occurredAtISO: input.occurredAtISO,
      reason: input.reason,
      ingredients: [...input.ingredients].sort((left, right) => (
        left.ingredientId < right.ingredientId ? -1 : left.ingredientId > right.ingredientId ? 1 : 0
      ))
    };
    try {
      const result = await applyInventoryCommand({ ...scope, requestId, command });
      setOperation({
        state: "receipt",
        message: "Receipt returned; waiting for the exact execution projection…",
        requestId,
        receipt: result.receipt,
        confirmation: result.confirmation
      });
      return result;
    } catch (error) {
      const wrapped = attemptError(error, requestId);
      setOperation({
        state: isDefinitiveInventoryError(wrapped) ? "error" : "uncertain",
        message: wrapped.message,
        requestId,
        receipt: null,
        confirmation: null
      });
      throw wrapped;
    }
  }, [blockedReason, canCorrect, canRecord, planRead.projection, quoteId, read.projection, scope]);

  const record = useCallback((input) => execute("record_event_ingredient_execution", input), [execute]);
  const correct = useCallback((input) => execute("correct_event_ingredient_execution", input), [execute]);
  const reconcile = useCallback(async ({ requestId } = {}) => {
    setOperation((current) => ({ ...current, state: "submitting", message: "Reconciling the exact request…" }));
    try {
      const result = await reconcileInventoryCommand({ ...scope, requestId });
      setOperation({ state: "receipt", message: "Receipt returned; waiting for the exact execution projection…", requestId, receipt: result.receipt, confirmation: result.confirmation });
      return result;
    } catch (error) {
      const wrapped = attemptError(error, requestId);
      setOperation({ state: isDefinitiveInventoryError(wrapped) ? "error" : "uncertain", message: wrapped.message, requestId, receipt: null, confirmation: null });
      throw wrapped;
    }
  }, [scope]);
  const reset = useCallback(({ requestId } = {}) => {
    if (!resetDefinitiveInventoryCommand({ ...scope, requestId })) return false;
    setOperation(idleOperation());
    return true;
  }, [scope]);

  if (injected) return injected;
  return Object.freeze({
    access,
    planRead,
    read,
    operation,
    canRecord,
    canCorrect,
    controlsLocked,
    blockedReason,
    record,
    correct,
    reconcile,
    reset
  });
}

export default useEventIngredientExecutionProjection;
