import { useEffect, useMemo, useState } from "react";
import "./eventIngredientProjectionPanel.css";

function text(value) {
  return String(value ?? "").trim();
}

function directProvenance(selection) {
  return selection?.commercialProvenance || {
    kind: "direct",
    sourceId: text(selection?.sourceId || selection?.selectionId || selection?.menuItemId)
  };
}

function selectionDraft(selection, index) {
  const selectionId = text(selection?.selectionId || selection?.id || `menu-selection-${index + 1}`);
  const recipeRevisionId = selection?.recipeRevisionId ?? null;
  return {
    selectionId,
    menuItemId: text(selection?.menuItemId || selection?.id),
    menuItemName: text(selection?.menuItemName || selection?.name) || "Selected menu item",
    recipeRevisionId,
    requiredOutputQuantity: text(selection?.requiredOutputQuantity),
    outputUnitId: recipeRevisionId === null ? null : text(selection?.outputUnitId),
    portionBasis: selection?.portionBasis || { kind: "explicit_output_quantity", evidenceId: selectionId },
    commercialProvenance: directProvenance(selection)
  };
}

function commandSelection(selection) {
  return {
    selectionId: selection.selectionId,
    menuItemId: selection.menuItemId,
    recipeRevisionId: selection.recipeRevisionId,
    requiredOutputQuantity: selection.requiredOutputQuantity,
    outputUnitId: selection.outputUnitId,
    portionBasis: selection.portionBasis,
    commercialProvenance: selection.commercialProvenance
  };
}

function positiveQuantity(value) {
  return /^(?:0|[1-9]\d*)(?:\.\d{1,6})?$/u.test(value) && Number(value) > 0;
}

function formatQuantityMicros(value) {
  if (!Number.isSafeInteger(value) || value < 0) return "—";
  const whole = Math.floor(value / 1_000_000);
  const fraction = String(value % 1_000_000).padStart(6, "0").replace(/0+$/u, "");
  return fraction ? `${whole}.${fraction}` : String(whole);
}

function formatMoney(minor, currency) {
  if (!Number.isSafeInteger(minor) || !/^[A-Z]{3}$/u.test(text(currency))) return "—";
  try {
    return new Intl.NumberFormat("en-US", { style: "currency", currency }).format(minor / 100);
  } catch {
    return "—";
  }
}

function railState(value, supported) {
  const normalized = text(value).toLowerCase();
  return supported.includes(normalized) ? normalized : "unavailable";
}

function DemandRail({ projection }) {
  const state = railState(projection?.demandState, ["complete", "incomplete", "invalid"]);
  const selected = projection?.coverage?.selectedMenuItemCount;
  const compiled = projection?.coverage?.compiledMenuItemCount;
  return (
    <article className="event-ingredient-panel__rail" data-ingredient-demand-state={state}>
      <span>Physical demand</span>
      <strong>{state === "complete" ? "Calculated" : state === "incomplete" ? "Needs portion or recipe evidence" : state === "invalid" ? "Invalid evidence" : "Not evaluated"}</strong>
      {Number.isSafeInteger(selected) && <small>{compiled}/{selected} selected menu items compiled</small>}
    </article>
  );
}

function CostRail({ projection }) {
  const state = railState(projection?.costState, ["complete", "partial", "unavailable", "invalid"]);
  const amount = state === "complete" ? projection?.projectedCostMinor : projection?.knownCostMinor;
  return (
    <article className="event-ingredient-panel__rail" data-ingredient-cost-state={state}>
      <span>Projected ingredient cost</span>
      <strong>{formatMoney(amount, projection?.currency)}</strong>
      <small>{state === "complete" ? "Fully costed" : state === "partial" ? "Known contribution only · missing costs remain" : state === "invalid" ? "Cost evidence conflicts" : "Cost evidence unavailable"}</small>
    </article>
  );
}

function AvailabilityRail({ projection }) {
  const state = railState(projection?.availabilityState, ["available", "shortage", "unavailable", "invalid"]);
  const shortageCount = projection?.coverage?.shortageIngredientCount;
  return (
    <article className="event-ingredient-panel__rail" data-ingredient-availability-state={state}>
      <span>Stock availability</span>
      <strong>{state === "available" ? "Available to allocate" : state === "shortage" ? "Shortage" : state === "invalid" ? "Stock evidence conflicts" : "Stock not evaluated"}</strong>
      {Number.isSafeInteger(shortageCount) && <small>{shortageCount} ingredient{shortageCount === 1 ? "" : "s"} short</small>}
    </article>
  );
}

function IngredientTable({ projection }) {
  const rows = Array.isArray(projection?.ingredients) ? projection.ingredients : [];
  if (!rows.length) return null;
  return (
    <div className="event-ingredient-panel__table-wrap" tabIndex={0} role="region" aria-label="Event ingredient requirements">
      <table>
        <thead><tr><th>Ingredient</th><th>Required</th><th>On hand</th><th>Committed</th><th>Available</th><th>Shortage</th></tr></thead>
        <tbody>
          {rows.map((row) => (
            <tr key={row.ingredientId} data-ingredient-row-state={row.availabilityState}>
              <th scope="row">{text(row.ingredientName) || row.ingredientId}</th>
              <td>{formatQuantityMicros(row.requiredQuantityMicros)} {row.baseUnitId}</td>
              <td>{formatQuantityMicros(row.onHandQuantityMicros)} {row.baseUnitId}</td>
              <td>{formatQuantityMicros(row.committedQuantityMicros)} {row.baseUnitId}</td>
              <td>{formatQuantityMicros(row.availableToAllocateQuantityMicros)} {row.baseUnitId}</td>
              <td>{formatQuantityMicros(row.shortageQuantityMicros)} {row.baseUnitId}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

function allocationCapabilityState(state) {
  if (state === "reserved") return "success";
  if (state === "shortage") return "partial";
  if (state === "settled") return "success";
  if (state === "released" || !state) return "empty";
  return "error";
}

function AllocationSummary({ allocation, evidenceCurrent }) {
  if (!allocation) {
    return (
      <p className="event-ingredient-panel__allocation-empty" data-ingredient-allocation-state="not_allocated" data-capability-state={evidenceCurrent ? "empty" : "stale"}>
        {evidenceCurrent
          ? "No ingredient allocation is recorded for this saved requirement."
          : "No allocation is visible in the retained projection; refresh current evidence before relying on it."}
      </p>
    );
  }
  const state = railState(allocation.state, ["reserved", "shortage", "released", "settled"]);
  const headline = state === "reserved" ? "Fully allocated"
    : state === "shortage" ? "Partially allocated"
      : state === "released" ? "Allocation released"
        : state === "settled" ? "Allocation settled through recorded usage" : "Allocation evidence unavailable";
  return (
    <div className="event-ingredient-panel__allocation-summary" data-ingredient-allocation-state={state} data-allocation-capacity-state={allocationCapabilityState(state)} data-capability-state={evidenceCurrent ? allocationCapabilityState(state) : "stale"}>
      <div>
        <strong>{headline}</strong>
        <p>
          {allocation.fullyAllocatedIngredientCount} of {allocation.ingredientCount} ingredient lines fully allocated
          {allocation.shortageIngredientCount > 0 ? ` · ${allocation.shortageIngredientCount} short` : ""}.
        </p>
      </div>
      <span className="event-ingredient-panel__source">{evidenceCurrent ? "Current" : "Retained · not current"} · revision {allocation.allocationRevision}</span>
      {Array.isArray(allocation.ingredients) && allocation.ingredients.length > 0 && (
        <div className="event-ingredient-panel__table-wrap" tabIndex={0} role="region" aria-label="Current event ingredient allocation">
          <table>
            <thead><tr><th>Ingredient</th><th>Required</th><th>Allocated</th><th>Shortage</th><th>Location</th></tr></thead>
            <tbody>
              {allocation.ingredients.map((row) => (
                <tr key={row.ingredientId}>
                  <th scope="row">{text(row.ingredientName) || row.ingredientId}</th>
                  <td>{formatQuantityMicros(row.requiredQuantityMicros)} {row.baseUnitId}</td>
                  <td>{formatQuantityMicros(row.allocatedQuantityMicros)} {row.baseUnitId}</td>
                  <td>{formatQuantityMicros(row.shortageQuantityMicros)} {row.baseUnitId}</td>
                  <td>{row.locationId}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}

function readMessage(read, quoteDirty) {
  if (quoteDirty) return "Draft not evaluated. The result below, if present, belongs to the saved quote revision.";
  if (read?.state === "loading") return "Loading current event ingredient evidence…";
  if (read?.state === "pending") return "Local projection writes are pending and are not confirmed current.";
  if (read?.state === "cached") return "Cached projection retained for orientation; reconnect before relying on it.";
  if (read?.state === "stale") return "The saved projection belongs to an earlier quote revision.";
  if (read?.state === "recorded") return "Recorded requirement snapshot. Preview again to evaluate current cost and stock evidence.";
  if (read?.state === "unavailable") return read.retained
    ? "Live projection unavailable. Retained evidence is explicitly stale."
    : "Event ingredient projection is unavailable.";
  if (read?.state === "not_evaluated") return "Availability and cost have not been evaluated for this saved quote revision.";
  return "Current server projection.";
}

function capabilityState(readState, quoteDirty) {
  if (quoteDirty || new Set(["cached", "stale", "recorded", "draft_not_evaluated"]).has(readState)) return "stale";
  if (new Set(["loading", "pending"]).has(readState)) return "loading";
  if (readState === "current") return "success";
  if (readState === "not_evaluated") return "empty";
  return "error";
}

export default function EventIngredientProjectionPanel({
  selectedMenuItems = [],
  read = { state: "not_evaluated", projection: null },
  preview = { state: "not_evaluated", projection: null },
  operation = { state: "idle" },
  allocationOperation = { state: "idle" },
  quoteDirty = false,
  canPreview = false,
  canRecord = false,
  controlsLocked = false,
  allocationControlsLocked = false,
  recordBlockedReason = "",
  allocationBlockedReason = "",
  canAllocate = false,
  canRelease = false,
  canReconcilePlan = false,
  canManageAllocation = false,
  onPreview,
  onRecord,
  onReconcile,
  onReset,
  onAllocate,
  onRelease,
  onReconcilePlan,
  onReconcileAllocation,
  onResetAllocation,
  onPreviewInputChange,
  showPreviewAction = true,
  title = "Ingredient impact"
}) {
  const sourceFingerprint = useMemo(() => JSON.stringify(selectedMenuItems.map((item, index) => selectionDraft(item, index))), [selectedMenuItems]);
  const [selections, setSelections] = useState(() => selectedMenuItems.map(selectionDraft));
  const [actionError, setActionError] = useState("");
  const [allocationLocationId, setAllocationLocationId] = useState("");
  const [releaseReason, setReleaseReason] = useState("");
  const [reconcileReason, setReconcileReason] = useState("");
  const [previewedFingerprint, setPreviewedFingerprint] = useState(() => preview.state === "current"
    ? JSON.stringify(selectedMenuItems.map(selectionDraft).map(commandSelection))
    : "");

  useEffect(() => {
    const nextSelections = selectedMenuItems.map(selectionDraft);
    setSelections(nextSelections);
    setActionError("");
    setPreviewedFingerprint(preview.state === "current"
      ? JSON.stringify(nextSelections.map(commandSelection))
      : "");
  }, [sourceFingerprint]);

  const issues = [];
  selections.forEach((selection) => {
    if (!selection.menuItemId) issues.push(`${selection.menuItemName} is not bound to a saved menu item.`);
    if (!positiveQuantity(selection.requiredOutputQuantity)) issues.push(`${selection.menuItemName} needs an explicit required recipe output quantity.`);
    if (selection.recipeRevisionId !== null && !selection.outputUnitId) {
      issues.push(`${selection.menuItemName} needs the output unit from its versioned recipe.`);
    }
  });
  const commandSelections = selections.map(commandSelection);
  const currentFingerprint = JSON.stringify(commandSelections);
  const valid = selections.length > 0 && issues.length === 0;
  const exactPreviewInputFingerprint = text(preview.inputFingerprint) || previewedFingerprint;
  useEffect(() => {
    if (preview.state === "current" && text(preview.inputFingerprint)) {
      setPreviewedFingerprint(text(preview.inputFingerprint));
    }
  }, [preview.inputFingerprint, preview.state]);
  useEffect(() => {
    onPreviewInputChange?.({
      valid,
      selections: commandSelections
    });
  }, [currentFingerprint, onPreviewInputChange, valid]);
  const previewMatchesInputs = preview.state === "current"
    && exactPreviewInputFingerprint === currentFingerprint;
  const projection = preview.state === "current" ? preview.projection : read.projection;
  const shownKind = preview.state === "current"
    ? (previewMatchesInputs ? "preview" : "prior_preview")
    : "saved";
  const allocation = read.projection?.allocation || null;
  const currentAllocationLocationId = text(allocation?.ingredients?.[0]?.locationId);
  const allocationEvidenceCurrent = !quoteDirty && read.state === "recorded"
    && (read.sourceState === undefined || read.sourceState === "current")
    && read.projection?.freshness !== "stale"
    && read.projection?.freshnessState?.allocation?.state !== "stale";
  const allocationLocations = useMemo(() => [...new Set((read.projection?.sourceRevisions?.stockRevisions || [])
    .map((entry) => text(entry.locationId)).filter(Boolean))].sort(), [read.projection]);
  useEffect(() => {
    if (!allocationLocations.includes(allocationLocationId)) {
      setAllocationLocationId(allocationLocations.length === 1 ? allocationLocations[0] : "");
    }
  }, [allocationLocationId, allocationLocations]);
  const busy = controlsLocked || allocationControlsLocked
    || operation.state === "pending" || operation.state === "reconciliation";

  const run = async (action) => {
    setActionError("");
    try {
      await action();
      return true;
    } catch (error) {
      setActionError(text(error?.message) || "Ingredient intelligence could not be updated.");
      return false;
    }
  };
  const previewCurrentInputs = async () => {
    if (await run(() => onPreview({ selections: commandSelections }))) {
      setPreviewedFingerprint(currentFingerprint);
    }
  };
  const recordCurrentInputs = async () => {
    await run(() => onRecord({ selections: commandSelections }));
  };
  const allocateCurrentRequirement = async () => {
    await run(() => onAllocate({
      locationId: allocation?.state === "shortage" ? currentAllocationLocationId : allocationLocationId
    }));
  };
  const releaseCurrentAllocation = async () => {
    if (!releaseReason.trim()) {
      setActionError("Enter why this ingredient allocation is being released.");
      return;
    }
    if (await run(() => onRelease({ reason: releaseReason.trim() }))) setReleaseReason("");
  };
  const reconcileCurrentAllocation = async () => {
    if (!reconcileReason.trim()) {
      setActionError("Enter why the retained allocation is being reconciled.");
      return;
    }
    if (await run(() => onReconcilePlan({
      locationId: currentAllocationLocationId,
      reason: reconcileReason.trim()
    }))) setReconcileReason("");
  };
  return (
    <section className="event-ingredient-panel" aria-labelledby="event-ingredient-panel-title" data-event-ingredient-panel data-capability-state={capabilityState(read.state, quoteDirty)}>
      <header>
        <div>
          <p className="event-ingredient-panel__eyebrow">Commercial consequence</p>
          <h2 id="event-ingredient-panel-title">{title}</h2>
          <p>Menu demand, projected food cost, and stock availability are independent evidence rails.</p>
        </div>
        <span className="event-ingredient-panel__source" data-projection-kind={shownKind}>{shownKind === "preview" ? "Read-only preview" : shownKind === "prior_preview" ? "Prior preview · inputs changed" : "Saved requirement"}</span>
      </header>

      <p className="event-ingredient-panel__read-state" role="status" data-event-ingredient-read-state={quoteDirty ? "draft_not_evaluated" : read.state}>
        {readMessage(read, quoteDirty)}
      </p>

      <fieldset disabled={busy}>
        <legend>Required recipe output by selected menu item</legend>
        <p>Enter the actual menu-choice or portion requirement. QuotePilot does not infer this from guests or billing quantity.</p>
        {selections.length === 0 ? <p data-capability-state="empty">No saved menu selections are available to evaluate.</p> : (
          <ol>
            {selections.map((selection, index) => (
              <li key={selection.selectionId}>
                <strong>{selection.menuItemName}</strong>
                <label>
                  <span>Required recipe output quantity</span>
                  <input
                    inputMode="decimal"
                    value={selection.requiredOutputQuantity}
                    onChange={(event) => setSelections((current) => current.map((entry, row) => row === index
                      ? { ...entry, requiredOutputQuantity: event.target.value.trim() }
                      : entry))}
                    aria-describedby={`ingredient-output-help-${index}`}
                  />
                </label>
                <label>
                  <span>Recipe output unit</span>
                  <input
                    value={selection.outputUnitId ?? ""}
                    onChange={(event) => setSelections((current) => current.map((entry, row) => row === index
                      ? { ...entry, outputUnitId: event.target.value.trim() }
                      : entry))}
                    placeholder="portion, tray, batch…"
                    disabled={selection.recipeRevisionId === null}
                  />
                </label>
                <small id={`ingredient-output-help-${index}`}>Required output is explicit; no guest-count default is applied.</small>
                {selection.recipeRevisionId === null && <small role="status">Recipe missing. Demand remains incomplete until a versioned recipe exists.</small>}
              </li>
            ))}
          </ol>
        )}
      </fieldset>

      {issues.length > 0 && <div className="event-ingredient-panel__issues" role="alert" data-capability-state="partial"><strong>Input needed</strong><ul>{issues.map((issue) => <li key={issue}>{issue}</li>)}</ul></div>}

      <div className="event-ingredient-panel__rails" aria-label="Independent event ingredient results">
        <DemandRail projection={projection} />
        <CostRail projection={projection} />
        <AvailabilityRail projection={projection} />
      </div>
      <IngredientTable projection={projection} />

      <section className="event-ingredient-panel__allocation" aria-labelledby="event-ingredient-allocation-title">
        <div>
          <p className="event-ingredient-panel__eyebrow">Operational commitment</p>
          <h3 id="event-ingredient-allocation-title">Ingredient allocation</h3>
          <p>An allocation reduces stock available to other events. It does not reduce physical on-hand stock.</p>
        </div>
        <AllocationSummary allocation={allocation} evidenceCurrent={allocationEvidenceCurrent} />
        {allocationOperation.state !== "idle" && (
          <p
            className="event-ingredient-panel__operation"
            role={new Set(["uncertain", "rejected"]).has(allocationOperation.state) ? "alert" : "status"}
            data-ingredient-allocation-operation-state={allocationOperation.state}
            data-capability-state={allocationOperation.state === "pending" ? "submitting"
              : allocationOperation.state === "committed" ? "success" : allocationOperation.state}
          >
            {allocationOperation.message || (allocationOperation.state === "pending"
              ? "Updating ingredient allocation…" : allocationOperation.state)}
          </p>
        )}
        {canManageAllocation && (onAllocate || onRelease) && (
          <fieldset disabled={busy} className="event-ingredient-panel__allocation-controls">
            <legend>Allocation action</legend>
            {!allocation || allocation.state === "released" ? (
              <>
                {allocationLocations.length === 0 ? (
                  <p data-capability-state="recovery">No exact stock location is available from the saved requirement.</p>
                ) : allocationLocations.length === 1 ? (
                  <p><strong>Stock location</strong><br />{allocationLocations[0]}</p>
                ) : (
                  <label>
                    <span>Stock location</span>
                    <select value={allocationLocationId} onChange={(event) => setAllocationLocationId(event.target.value)}>
                      <option value="">Select a stock location</option>
                      {allocationLocations.map((locationId) => <option key={locationId} value={locationId}>{locationId}</option>)}
                    </select>
                  </label>
                )}
                <button type="button" onClick={() => void allocateCurrentRequirement()} disabled={!canAllocate || !onAllocate || !allocationLocationId}>
                  Allocate ingredients
                </button>
              </>
            ) : (
              <>
                {allocation.state === "shortage"
                  && read.projection?.freshnessState?.allocation?.state !== "stale" && (
                  <div className="event-ingredient-panel__allocation-top-up">
                    <p><strong>Stock location</strong><br />{currentAllocationLocationId || "Location evidence unavailable"}</p>
                    <button type="button" onClick={() => void allocateCurrentRequirement()} disabled={!canAllocate || !onAllocate || !currentAllocationLocationId}>
                      Allocate remaining
                    </button>
                  </div>
                )}
                {read.projection?.freshnessState?.allocation?.state === "stale" && (
                  <div className="event-ingredient-panel__allocation-top-up" data-allocation-reconciliation="required">
                    <p><strong>Retained hold needs reconciliation</strong><br />The prior allocation remains active until an administrator explicitly reconciles or releases it.</p>
                    <label>
                      <span>Reconciliation reason</span>
                      <input maxLength={160} value={reconcileReason} onChange={(event) => setReconcileReason(event.target.value)} placeholder="Commercial or recipe requirement changed" />
                    </label>
                    <button type="button" onClick={() => void reconcileCurrentAllocation()} disabled={!canReconcilePlan || !onReconcilePlan || !currentAllocationLocationId || !reconcileReason.trim()}>
                      Reconcile retained allocation
                    </button>
                  </div>
                )}
                <label>
                  <span>Release reason</span>
                  <input maxLength={160} value={releaseReason} onChange={(event) => setReleaseReason(event.target.value)} placeholder="Event cancelled or allocation replaced" />
                </label>
                <button type="button" className="ghost" onClick={() => void releaseCurrentAllocation()} disabled={!canRelease || !onRelease || !releaseReason.trim()}>
                  Release allocation
                </button>
              </>
            )}
          </fieldset>
        )}
        {allocationOperation.state === "uncertain" && <button type="button" className="ghost" onClick={() => void run(onReconcileAllocation)} disabled={!onReconcileAllocation || allocationOperation.state === "reconciliation"} data-capability-state="recovery">Reconcile allocation request</button>}
        {allocationOperation.state === "rejected" && <button type="button" className="ghost" onClick={() => void run(onResetAllocation)} disabled={!onResetAllocation} data-capability-state="recovery">Review and reset allocation</button>}
        {allocationBlockedReason && canManageAllocation && (onAllocate || onRelease || onReconcilePlan) && !canAllocate && !canRelease && !canReconcilePlan && (
          <p className="event-ingredient-panel__hint">{allocationBlockedReason}</p>
        )}
      </section>

      {actionError && <p className="event-ingredient-panel__operation" role="alert" data-capability-state="error">{actionError}</p>}
      {operation.state !== "idle" && <p className="event-ingredient-panel__operation" role={new Set(["uncertain", "rejected"]).has(operation.state) ? "alert" : "status"} data-ingredient-operation-state={operation.state} data-capability-state={operation.state === "committed" ? "receipt" : operation.state === "pending" ? "submitting" : operation.state}>{operation.message || (operation.state === "pending" ? "Recording requirement…" : operation.state)}</p>}

      <div className="event-ingredient-panel__actions" data-capability-state={!busy && valid ? "ready" : undefined}>
        {operation.state === "uncertain" && <button type="button" onClick={() => void run(onReconcile)} disabled={!onReconcile || operation.state === "reconciliation"} data-capability-state="recovery">Reconcile request</button>}
        {operation.state === "rejected" && <button type="button" onClick={() => void run(onReset)} disabled={!onReset} data-capability-state="recovery">Review and reset</button>}
        {showPreviewAction && (
          <button type="button" className="ghost" onClick={() => void previewCurrentInputs()} disabled={!canPreview || !valid || busy || !onPreview}>Preview ingredient impact</button>
        )}
        {onRecord && <button type="button" onClick={() => void recordCurrentInputs()} disabled={!canRecord || !previewMatchesInputs || busy} title={!canRecord || !previewMatchesInputs ? (recordBlockedReason || "Preview the currently displayed quantities before recording.") : ""}>Record requirement</button>}
      </div>
      {!canRecord && recordBlockedReason && onRecord && <p className="event-ingredient-panel__hint">{recordBlockedReason}</p>}
    </section>
  );
}
