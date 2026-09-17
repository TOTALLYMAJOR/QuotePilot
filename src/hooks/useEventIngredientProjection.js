import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
  applyInventoryCommand,
  buildInventoryRequestId,
  getInventoryMenuCostBrowserAccess,
  isDefinitiveInventoryError,
  previewEventInventory,
  reconcileInventoryCommand,
  resetDefinitiveInventoryCommand,
  subscribeToEventIngredientProjection
} from "../lib/inventoryAuthorityClient";
import { scheduleDeferredClientWork } from "../lib/deferredClientWork";

function text(value) {
  return String(value ?? "").trim();
}

export function buildEventIngredientSelectionInputs({
  quote,
  recipeProjectionsByMenuItemId = {}
} = {}) {
  const savedSelection = quote?.selection && typeof quote.selection === "object"
    ? quote.selection : {};
  const menuItemIds = Array.isArray(savedSelection.menuItems)
    ? savedSelection.menuItems.map(text).filter(Boolean) : [];
  const snapshots = Array.isArray(savedSelection.menuItemsSnapshot)
    ? savedSelection.menuItemsSnapshot : [];
  const snapshotsById = new Map(snapshots.map((item) => [text(item?.id), item]));
  const includedMenuItems = Array.isArray(savedSelection.packageInclusions?.menuItems)
    ? savedSelection.packageInclusions.menuItems : [];
  const includedIds = new Set(includedMenuItems.map((item) => text(item?.id)).filter(Boolean));
  const packageId = text(savedSelection.packageId);
  return menuItemIds.map((menuItemId) => {
    const snapshot = snapshotsById.get(menuItemId) || {};
    const recipeProjection = recipeProjectionsByMenuItemId?.[menuItemId] || null;
    const included = includedIds.has(menuItemId);
    return Object.freeze({
      selectionId: menuItemId,
      menuItemId,
      menuItemName: text(snapshot.name) || menuItemId,
      recipeRevisionId: text(recipeProjection?.recipeRevisionId) || null,
      requiredOutputQuantity: "",
      outputUnitId: recipeProjection ? text(recipeProjection?.recipeDefinition?.outputUnitId) : null,
      portionBasis: Object.freeze({
        kind: "explicit_output_quantity",
        evidenceId: menuItemId
      }),
      commercialProvenance: included ? Object.freeze({
        kind: "package_inclusion",
        sourceId: menuItemId,
        packageId,
        inclusionId: menuItemId
      }) : Object.freeze({ kind: "direct", sourceId: menuItemId })
    });
  });
}

function initialRead(quoteId = "") {
  return {
    quoteId,
    state: "not_evaluated",
    sourceState: "not_evaluated",
    exists: false,
    projection: null,
    retained: false,
    error: ""
  };
}

function initialOperation() {
  return { state: "idle", message: "", requestId: "", receipt: null, confirmation: null };
}

function wrappedAttemptError(error, requestId, fallback = "Event ingredient requirement did not return verified evidence.") {
  const wrapped = new Error(text(error?.message) || fallback, { cause: error });
  wrapped.code = error?.code;
  wrapped.inventoryDefinitive = error?.inventoryDefinitive;
  wrapped.inventoryAttempt = { requestId };
  return wrapped;
}

export function deriveEventIngredientReadState({
  model,
  savedQuoteRevisionId,
  draftDirty = false
}) {
  const sourceState = text(model?.freshness || model?.source?.state) || "unavailable";
  const projection = model?.projection || null;
  const exists = model?.exists === true && Boolean(projection);
  let state = sourceState;
  if (sourceState === "current" && !exists) state = "not_evaluated";
  if (sourceState === "current" && exists && projection.freshness === "as_recorded") {
    state = "recorded";
  }
  if (sourceState === "current" && exists
    && (projection.freshness === "stale" || projection.quoteRevisionId !== savedQuoteRevisionId)) {
    state = "stale";
  }
  if (draftDirty) state = "draft_not_evaluated";
  return {
    quoteId: text(model?.quoteId || projection?.quoteId),
    state,
    sourceState,
    exists,
    projection,
    retained: model?.retained === true || (sourceState === "unavailable" && exists),
    error: "",
    savedProjectionState: sourceState === "current" && exists
      && (projection.freshness === "stale" || projection.quoteRevisionId !== savedQuoteRevisionId)
      ? "stale"
      : sourceState === "current" && exists && projection.freshness === "as_recorded" ? "recorded"
      : sourceState === "current" && !exists ? "not_evaluated" : sourceState
  };
}

/**
 * Quote Edit consumes this hook as secondary commercial intelligence. The
 * initial projection listener yields to the editor's first browser work when
 * idle scheduling is available; explicit previews and inventory mutations stay
 * immediate and continue to use the existing Inventory authority.
 */
export function useEventIngredientProjection({
  active = false,
  organizationId = "",
  role = "customer",
  browserEnabled = false,
  tenantEnabled = false,
  quoteId = "",
  quoteStatus = "",
  savedQuoteRevisionId = "",
  selections = [],
  draftDirty = false,
  scenarioFingerprint = "",
  injected = null
} = {}) {
  const access = useMemo(() => getInventoryMenuCostBrowserAccess({
    organizationId, role, browserEnabled, tenantEnabled
  }), [browserEnabled, organizationId, role, tenantEnabled]);
  const scope = useMemo(() => ({ organizationId, role, browserEnabled, tenantEnabled }), [
    browserEnabled, organizationId, role, tenantEnabled
  ]);
  const inputFingerprint = useMemo(() => JSON.stringify({ selections }), [selections]);
  const exactScenarioFingerprint = text(scenarioFingerprint) || inputFingerprint;
  const allocationCommerciallyEligible = new Set(["accepted", "booked"]).has(text(quoteStatus).toLowerCase());
  const [read, setRead] = useState(() => initialRead(quoteId));
  const [preview, setPreview] = useState({
    state: "not_evaluated",
    projection: null,
    error: "",
    scenarioFingerprint: exactScenarioFingerprint,
    inputFingerprint: ""
  });
  const [operation, setOperation] = useState(initialOperation);
  const [allocationOperation, setAllocationOperation] = useState(initialOperation);
  const lifecycleRef = useRef(0);
  const previewGenerationRef = useRef(0);
  const scenarioFingerprintRef = useRef(exactScenarioFingerprint);
  scenarioFingerprintRef.current = exactScenarioFingerprint;

  useEffect(() => {
    lifecycleRef.current += 1;
    const lifecycle = lifecycleRef.current;
    if (injected || !active || !access.readEnabled || !text(quoteId)) {
      setRead(initialRead(text(quoteId)));
      return undefined;
    }
    let listening = true;
    let unsubscribe = () => {};
    const beginListening = () => {
      if (!listening || lifecycleRef.current !== lifecycle) return;
      setRead({ ...initialRead(text(quoteId)), state: "loading", sourceState: "loading" });
      try {
        unsubscribe = subscribeToEventIngredientProjection({
          ...scope,
          quoteId,
          onData: (model) => {
            if (!listening || lifecycleRef.current !== lifecycle) return;
            setRead(deriveEventIngredientReadState({ model, savedQuoteRevisionId, draftDirty }));
          },
          onError: (error) => {
            if (!listening || lifecycleRef.current !== lifecycle) return;
            setRead((current) => ({
              ...current,
              state: draftDirty ? "draft_not_evaluated" : "unavailable",
              sourceState: "unavailable",
              retained: Boolean(current.projection),
              error: text(error?.message) || "Event ingredient projection updates are unavailable."
            }));
          }
        });
      } catch (error) {
        setRead({
          ...initialRead(text(quoteId)),
          state: draftDirty ? "draft_not_evaluated" : "unavailable",
          sourceState: "unavailable",
          error: text(error?.message) || "Event ingredient projection updates are unavailable."
        });
      }
    };
    const cancelDeferredStart = scheduleDeferredClientWork(beginListening);
    return () => {
      listening = false;
      cancelDeferredStart();
      lifecycleRef.current += 1;
      unsubscribe();
    };
  }, [access.readEnabled, active, draftDirty, injected, quoteId, savedQuoteRevisionId, scope]);

  useEffect(() => {
    previewGenerationRef.current += 1;
    setPreview({
      state: "not_evaluated",
      projection: null,
      error: "",
      scenarioFingerprint: exactScenarioFingerprint,
      inputFingerprint: ""
    });
  }, [draftDirty, exactScenarioFingerprint, inputFingerprint, quoteId, savedQuoteRevisionId]);

  useEffect(() => {
    setOperation(initialOperation());
    setAllocationOperation(initialOperation());
  }, [access.readEnabled, access.role, active, organizationId, quoteId]);

  useEffect(() => {
    if (read.sourceState !== "current" || read.projection?.freshness !== "as_recorded") return;
    setOperation((current) => {
      if (current.state !== "receipt" || !current.confirmation) return current;
      const result = current.confirmation;
      return read.projection.quoteId === result.quoteId
        && read.projection.quoteRevisionId === result.quoteRevisionId
        && read.projection.requirementRevision === result.requirementRevision
        && read.projection.eventRequirementRevisionId === result.eventRequirementRevisionId
        && read.projection.requirementDigest === result.requirementDigest
        && read.projection.projectionDigest === result.projectionDigest
        ? { ...current, state: "committed", message: "Event ingredient requirement confirmed in the current projection." }
        : current;
    });
    setAllocationOperation((current) => {
      if (current.state !== "receipt" || !current.confirmation) return current;
      const allocation = read.projection.allocation;
      const result = current.confirmation;
      return allocation?.eventPlanId === result.eventPlanId
        && allocation.allocationRevision === result.allocationRevision
        && allocation.state === result.state
        && allocation.eventRequirementRevisionId === result.eventRequirementRevisionId
        && allocation.ingredientCount === result.ingredientCount
        && allocation.fullyAllocatedIngredientCount === result.fullyAllocatedIngredientCount
        && allocation.shortageIngredientCount === result.shortageIngredientCount
        ? { ...current, state: "committed", message: result.state === "released"
          ? "Allocation release confirmed in the current projection."
          : "Ingredient allocation confirmed in the current projection." }
        : current;
    });
  }, [allocationOperation.state, operation.state, read.projection, read.sourceState]);

  const previewCurrent = useCallback(async (overrides = {}) => {
    const lifecycle = lifecycleRef.current;
    const previewGeneration = previewGenerationRef.current + 1;
    previewGenerationRef.current = previewGeneration;
    const requestedScenarioFingerprint = scenarioFingerprintRef.current;
    const requestedSelections = Array.isArray(overrides.selections)
      ? overrides.selections
      : selections;
    const requestedInputFingerprint = JSON.stringify(requestedSelections);
    setPreview((current) => ({
      ...current,
      state: "pending",
      error: "",
      scenarioFingerprint: requestedScenarioFingerprint,
      inputFingerprint: requestedInputFingerprint
    }));
    try {
      const result = await previewEventInventory({
        ...scope,
        quoteId,
        quoteRevisionId: savedQuoteRevisionId,
        requiredByBasis: { kind: "quote_event_start" },
        selections: requestedSelections,
        ...overrides
      });
      if (lifecycleRef.current === lifecycle
        && previewGenerationRef.current === previewGeneration
        && scenarioFingerprintRef.current === requestedScenarioFingerprint) {
        setPreview({
          state: "current",
          projection: result.projection,
          error: "",
          scenarioFingerprint: requestedScenarioFingerprint,
          inputFingerprint: requestedInputFingerprint
        });
      }
      return result;
    } catch (error) {
      if (lifecycleRef.current === lifecycle
        && previewGenerationRef.current === previewGeneration
        && scenarioFingerprintRef.current === requestedScenarioFingerprint) {
        setPreview((current) => ({
          ...current,
          state: "unavailable",
          error: text(error?.message) || "Event ingredient preview is unavailable."
        }));
      }
      throw error;
    }
  }, [quoteId, savedQuoteRevisionId, scope, selections]);

  const recordCurrentPreview = useCallback(async ({ selections: requestedSelections = selections } = {}) => {
    if (role !== "admin" || !access.mutationEnabled) {
      throw new Error("Only an authorized administrator may record an event ingredient requirement.");
    }
    if (draftDirty || preview.state !== "current" || preview.projection?.quoteRevisionId !== savedQuoteRevisionId
      || preview.scenarioFingerprint !== scenarioFingerprintRef.current) {
      throw new Error("Record only a current preview for the unchanged saved quote revision.");
    }
    const requestId = buildInventoryRequestId();
    const compiledSelections = Array.isArray(preview.projection?.selections)
      ? preview.projection.selections.map((selection) => ({
        selectionId: selection.selectionId,
        menuItemId: selection.menuItemId,
        recipeRevisionId: selection.recipeRevisionId,
        requiredOutputQuantity: selection.requiredOutputQuantity,
        outputUnitId: selection.outputUnitId,
        portionBasis: selection.portionBasis,
        commercialProvenance: selection.commercialProvenance
      }))
      : selections;
    const selectionFingerprint = (value) => JSON.stringify([...value]
      .sort((left, right) => text(left.menuItemId).localeCompare(text(right.menuItemId))
        || text(left.selectionId).localeCompare(text(right.selectionId))));
    if (selectionFingerprint(requestedSelections) !== selectionFingerprint(compiledSelections)) {
      throw new Error("The displayed ingredient quantities changed after preview. Preview them again before recording.");
    }
    setOperation({ ...initialOperation(), state: "pending", requestId });
    const lifecycle = lifecycleRef.current;
    try {
      const result = await applyInventoryCommand({
        ...scope,
        requestId,
        command: {
          kind: "compile_event_ingredient_demand",
          quoteId,
          quoteRevisionId: savedQuoteRevisionId,
          requiredByBasis: { kind: "quote_event_start" },
          selections: compiledSelections,
          expectedRequirementRevision: Number.isInteger(read.projection?.requirementRevision)
            ? read.projection.requirementRevision
            : 0,
          expectedPreviewProjectionDigest: preview.projection.projectionDigest
        }
      });
      if (lifecycleRef.current === lifecycle) {
        setOperation({
          state: "receipt",
          message: "Requirement receipt recorded. Waiting for the exact current projection.",
          requestId,
          receipt: result.receipt,
          confirmation: result.confirmation
        });
      }
      return result;
    } catch (error) {
      const definitive = isDefinitiveInventoryError(error);
      if (lifecycleRef.current === lifecycle) {
        setOperation({
          state: definitive ? "rejected" : "uncertain",
          message: text(error?.message) || "Event ingredient requirement was not confirmed.",
          requestId,
          receipt: null,
          confirmation: null
        });
      }
      throw wrappedAttemptError(error, requestId);
    }
  }, [access.mutationEnabled, draftDirty, preview, quoteId, read.projection, role, savedQuoteRevisionId, scope, selections]);

  const reconcile = useCallback(async () => {
    if (!operation.requestId || operation.state !== "uncertain") {
      throw new Error("There is no uncertain event ingredient request to reconcile.");
    }
    const requestId = operation.requestId;
    const lifecycle = lifecycleRef.current;
    setOperation((current) => ({ ...current, state: "reconciliation", message: "" }));
    try {
      const result = await reconcileInventoryCommand({ ...scope, requestId });
      if (lifecycleRef.current === lifecycle) {
        setOperation({
          state: "receipt",
          message: "Requirement receipt reconciled. Waiting for the exact current projection.",
          requestId,
          receipt: result.receipt,
          confirmation: result.confirmation
        });
      }
      return result;
    } catch (error) {
      const definitive = isDefinitiveInventoryError(error);
      if (lifecycleRef.current === lifecycle) {
        setOperation((current) => ({
          ...current,
          state: definitive ? "rejected" : "uncertain",
          message: text(error?.message) || "Event ingredient reconciliation is unresolved."
        }));
      }
      throw error;
    }
  }, [operation.requestId, operation.state, scope]);

  const reset = useCallback(() => {
    if (!operation.requestId || operation.state !== "rejected") return false;
    const resetResult = resetDefinitiveInventoryCommand({ ...scope, requestId: operation.requestId });
    if (resetResult) setOperation(initialOperation());
    return resetResult;
  }, [operation.requestId, operation.state, scope]);

  const applyAllocation = useCallback(async ({ kind, locationId = "", reason = "" }) => {
    if (access.role !== "admin" || !access.mutationEnabled) {
      throw new Error("Only an authorized administrator may change ingredient allocations.");
    }
    if (!allocationCommerciallyEligible) {
      throw new Error("Ingredient allocation changes are available only for an accepted or booked quote.");
    }
    const release = kind === "release_event_ingredients";
    const reconcilePlan = kind === "reconcile_event_ingredients";
    const allocationFreshness = read.projection?.freshnessState?.allocation?.state;
    if (draftDirty || read.sourceState !== "current" || !read.projection) {
      throw new Error("Ingredient allocation requires current server evidence for the saved quote.");
    }
    if (!release && (read.projection.freshness !== "as_recorded"
      || read.projection.quoteRevisionId !== savedQuoteRevisionId)) {
      throw new Error("Ingredient allocation requires the exact current saved requirement projection.");
    }
    if (reconcilePlan && (allocationFreshness !== "stale"
      || read.projection.freshnessState?.demand?.state !== "current"
      || read.projection.freshnessState?.availability?.state !== "current")) {
      throw new Error("Record the revised ingredient requirement before reconciling its retained allocation.");
    }
    if (new Set(["pending", "receipt", "uncertain", "reconciliation", "rejected"]).has(allocationOperation.state)) {
      throw new Error("Resolve the existing ingredient allocation request before starting another.");
    }
    const requestId = buildInventoryRequestId();
    const currentAllocationRevision = read.projection.allocation?.allocationRevision || 0;
    const command = kind === "allocate_event_ingredients" ? {
      kind,
      quoteId,
      eventRequirementRevisionId: read.projection.eventRequirementRevisionId,
      locationId,
      expectedRequirementRevision: read.projection.requirementRevision,
      expectedAllocationRevision: currentAllocationRevision
    } : reconcilePlan ? {
      kind,
      quoteId,
      eventRequirementRevisionId: read.projection.eventRequirementRevisionId,
      locationId,
      expectedRequirementRevision: read.projection.requirementRevision,
      expectedAllocationRevision: currentAllocationRevision,
      reason
    } : {
      kind,
      quoteId,
      expectedAllocationRevision: currentAllocationRevision,
      reason
    };
    const lifecycle = lifecycleRef.current;
    setAllocationOperation({ ...initialOperation(), state: "pending", requestId });
    try {
      const result = await applyInventoryCommand({ ...scope, requestId, command });
      if (lifecycleRef.current === lifecycle) {
        setAllocationOperation({
          state: "receipt",
          message: result.confirmation.state === "released"
            ? "Release receipt recorded. Waiting for the exact current projection."
            : reconcilePlan
              ? "Reconciliation receipt recorded. Waiting for the exact current projection."
              : "Allocation receipt recorded. Waiting for the exact current projection.",
          requestId,
          receipt: result.receipt,
          confirmation: result.confirmation
        });
      }
      return result;
    } catch (error) {
      if (lifecycleRef.current === lifecycle) {
        setAllocationOperation({
          state: isDefinitiveInventoryError(error) ? "rejected" : "uncertain",
          message: text(error?.message) || "Ingredient allocation did not return verified evidence.",
          requestId,
          receipt: null,
          confirmation: null
        });
      }
      throw wrappedAttemptError(error, requestId, "Ingredient allocation did not return verified evidence.");
    }
  }, [access.mutationEnabled, access.role, allocationCommerciallyEligible, allocationOperation.state, draftDirty, quoteId, read.projection, read.sourceState, savedQuoteRevisionId, scope]);

  const allocate = useCallback(({ locationId }) => applyAllocation({
    kind: "allocate_event_ingredients", locationId: text(locationId)
  }), [applyAllocation]);

  const release = useCallback(({ reason }) => applyAllocation({
    kind: "release_event_ingredients", reason: text(reason)
  }), [applyAllocation]);

  const reconcileStaleAllocation = useCallback(({ locationId, reason }) => applyAllocation({
    kind: "reconcile_event_ingredients",
    locationId: text(locationId),
    reason: text(reason)
  }), [applyAllocation]);

  const reconcileAllocation = useCallback(async () => {
    if (!allocationOperation.requestId || allocationOperation.state !== "uncertain") {
      throw new Error("There is no uncertain ingredient allocation request to reconcile.");
    }
    const requestId = allocationOperation.requestId;
    const lifecycle = lifecycleRef.current;
    setAllocationOperation((current) => ({ ...current, state: "reconciliation", message: "" }));
    try {
      const result = await reconcileInventoryCommand({ ...scope, requestId });
      if (lifecycleRef.current === lifecycle) {
        setAllocationOperation({
          state: "receipt",
          message: "Allocation receipt reconciled. Waiting for the exact current projection.",
          requestId,
          receipt: result.receipt,
          confirmation: result.confirmation
        });
      }
      return result;
    } catch (error) {
      if (lifecycleRef.current === lifecycle) {
        setAllocationOperation((current) => ({
          ...current,
          state: isDefinitiveInventoryError(error) ? "rejected" : "uncertain",
          message: text(error?.message) || "Ingredient allocation reconciliation is unresolved."
        }));
      }
      throw error;
    }
  }, [allocationOperation.requestId, allocationOperation.state, scope]);

  const resetAllocation = useCallback(() => {
    if (!allocationOperation.requestId || allocationOperation.state !== "rejected") return false;
    const resetResult = resetDefinitiveInventoryCommand({ ...scope, requestId: allocationOperation.requestId });
    if (resetResult) setAllocationOperation(initialOperation());
    return resetResult;
  }, [allocationOperation.requestId, allocationOperation.state, scope]);

  if (injected) return injected;

  const previewMatchesSaved = preview.state === "current"
    && preview.projection?.quoteRevisionId === savedQuoteRevisionId
    && preview.scenarioFingerprint === exactScenarioFingerprint;
  const controlsLocked = new Set(["pending", "receipt", "uncertain", "reconciliation", "rejected"]).has(operation.state);
  const allocationControlsLocked = new Set(["pending", "receipt", "uncertain", "reconciliation", "rejected"])
    .has(allocationOperation.state);
  const requirementCurrent = read.sourceState === "current"
    && read.projection?.freshness === "as_recorded"
    && read.projection?.quoteRevisionId === savedQuoteRevisionId
    && read.state === "recorded";
  const allocationState = read.projection?.allocation?.state || "";
  const allocationActive = new Set(["reserved", "shortage"]).has(allocationState);
  const allocationFreshness = read.projection?.freshnessState?.allocation?.state
    || (requirementCurrent && allocationActive ? "current" : allocationActive ? "stale" : "not_allocated");
  const serverCurrentAllocationEvidence = read.sourceState === "current" && allocationActive
    && new Set(["current", "stale"]).has(allocationFreshness);
  const canRecord = access.role === "admin" && access.mutationEnabled && !draftDirty && previewMatchesSaved && !controlsLocked;
  const canAllocate = access.role === "admin" && access.mutationEnabled && !draftDirty
    && allocationCommerciallyEligible && requirementCurrent && read.projection?.demandState === "complete"
    && allocationFreshness !== "stale"
    && allocationState !== "reserved"
    && allocationState !== "settled"
    && !controlsLocked && !allocationControlsLocked;
  const canRelease = access.role === "admin" && access.mutationEnabled && !draftDirty
    && allocationCommerciallyEligible && serverCurrentAllocationEvidence
    && !controlsLocked && !allocationControlsLocked;
  const canReconcilePlan = access.role === "admin" && access.mutationEnabled && !draftDirty
    && allocationCommerciallyEligible && requirementCurrent && allocationActive
    && allocationFreshness === "stale"
    && read.projection?.freshnessState?.demand?.state === "current"
    && read.projection?.freshnessState?.availability?.state === "current"
    && !controlsLocked && !allocationControlsLocked;
  let recordBlockedReason = "";
  if (access.role !== "admin" || !access.mutationEnabled) recordBlockedReason = "Only an authorized administrator may record requirements.";
  else if (draftDirty) recordBlockedReason = "Save the quote revision before recording ingredient requirements.";
  else if (!previewMatchesSaved) recordBlockedReason = "Run a current preview for this saved quote revision first.";
  else if (controlsLocked) recordBlockedReason = "Resolve the existing requirement request before starting another.";

  return {
    access,
    read,
    preview,
    operation,
    allocationOperation,
    controlsLocked,
    allocationControlsLocked,
    // Scenario preview is read-only and may evaluate explicit output evidence
    // against the saved revision while a commercial draft is dirty. Recording,
    // allocation, and reconciliation remain fenced to an unchanged saved quote.
    canPreview: access.readEnabled && !controlsLocked && !allocationControlsLocked,
    canRecord,
    canManageAllocation: access.role === "admin" && access.mutationEnabled && allocationState !== "settled",
    canAllocate,
    canRelease,
    canReconcilePlan,
    allocationBlockedReason: !access.mutationEnabled || access.role !== "admin"
      ? "Only an authorized administrator may change ingredient allocations."
      : !allocationCommerciallyEligible ? "Ingredient allocation is available only for accepted or booked quotes."
      : draftDirty ? "Save the quote revision before changing ingredient allocations."
      : allocationFreshness === "stale" && !requirementCurrent
        ? "Record a current revised ingredient requirement before reconciling the retained hold. Release remains available."
      : allocationFreshness === "stale"
        ? "Reconcile the retained hold to the current recorded requirement, or release it."
      : !requirementCurrent ? "A server-current saved ingredient requirement is required before allocation."
      : read.projection?.demandState !== "complete" ? "Resolve missing recipe or portion evidence before allocation."
      : controlsLocked || allocationControlsLocked ? "Resolve the current inventory request before changing the allocation."
      : allocationState === "reserved" ? "The current ingredient requirement is already fully allocated."
      : "",
    recordBlockedReason,
    previewCurrent,
    recordCurrentPreview,
    reconcile,
    reset,
    allocate,
    release,
    reconcileStaleAllocation,
    reconcileAllocation,
    resetAllocation
  };
}

export default useEventIngredientProjection;
