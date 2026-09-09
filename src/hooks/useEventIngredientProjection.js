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

function wrappedAttemptError(error, requestId) {
  const wrapped = new Error(text(error?.message) || "Event ingredient requirement did not return verified evidence.", { cause: error });
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

export function useEventIngredientProjection({
  active = false,
  organizationId = "",
  role = "customer",
  browserEnabled = false,
  tenantEnabled = false,
  quoteId = "",
  savedQuoteRevisionId = "",
  selections = [],
  draftDirty = false,
  injected = null
} = {}) {
  const access = useMemo(() => getInventoryMenuCostBrowserAccess({
    organizationId, role, browserEnabled, tenantEnabled
  }), [browserEnabled, organizationId, role, tenantEnabled]);
  const scope = useMemo(() => ({ organizationId, role, browserEnabled, tenantEnabled }), [
    browserEnabled, organizationId, role, tenantEnabled
  ]);
  const inputFingerprint = useMemo(() => JSON.stringify({ selections }), [selections]);
  const [read, setRead] = useState(() => initialRead(quoteId));
  const [preview, setPreview] = useState({ state: "not_evaluated", projection: null, error: "" });
  const [operation, setOperation] = useState(initialOperation);
  const lifecycleRef = useRef(0);

  useEffect(() => {
    lifecycleRef.current += 1;
    const lifecycle = lifecycleRef.current;
    if (injected || !active || !access.readEnabled || !text(quoteId)) {
      setRead(initialRead(text(quoteId)));
      return undefined;
    }
    let listening = true;
    let unsubscribe = () => {};
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
    return () => {
      listening = false;
      lifecycleRef.current += 1;
      unsubscribe();
    };
  }, [access.readEnabled, active, draftDirty, injected, quoteId, savedQuoteRevisionId, scope]);

  useEffect(() => {
    setPreview({ state: "not_evaluated", projection: null, error: "" });
    setOperation(initialOperation());
  }, [access.readEnabled, access.role, active, draftDirty, inputFingerprint, organizationId, quoteId, savedQuoteRevisionId]);

  const previewCurrent = useCallback(async (overrides = {}) => {
    const lifecycle = lifecycleRef.current;
    setPreview((current) => ({ ...current, state: "pending", error: "" }));
    try {
      const result = await previewEventInventory({
        ...scope,
        quoteId,
        quoteRevisionId: savedQuoteRevisionId,
        requiredByBasis: { kind: "quote_event_start" },
        selections,
        ...overrides
      });
      if (lifecycleRef.current === lifecycle) {
        setPreview({ state: "current", projection: result.projection, error: "" });
      }
      return result;
    } catch (error) {
      if (lifecycleRef.current === lifecycle) {
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
    if (draftDirty || preview.state !== "current" || preview.projection?.quoteRevisionId !== savedQuoteRevisionId) {
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
          state: "committed",
          message: "Event ingredient requirement recorded.",
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
          state: "committed",
          message: "Event ingredient requirement reconciled.",
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

  if (injected) return injected;

  const previewMatchesSaved = preview.state === "current"
    && preview.projection?.quoteRevisionId === savedQuoteRevisionId;
  const controlsLocked = new Set(["pending", "uncertain", "reconciliation", "rejected"]).has(operation.state);
  const canRecord = access.role === "admin" && access.mutationEnabled && !draftDirty && previewMatchesSaved && !controlsLocked;
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
    controlsLocked,
    canPreview: access.readEnabled && !draftDirty && !controlsLocked,
    canRecord,
    recordBlockedReason,
    previewCurrent,
    recordCurrentPreview,
    reconcile,
    reset
  };
}

export default useEventIngredientProjection;
