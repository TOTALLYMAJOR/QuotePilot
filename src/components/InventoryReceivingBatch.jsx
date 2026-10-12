import { useEffect, useMemo, useRef, useState } from "react";
import { inventoryMoneyInputToMinorUnits } from "../lib/inventoryAuthorityClient";
import {
  INVENTORY_RECEIVING_BATCH_LIMIT,
  buildInventoryReceivingLineId,
  confirmInventoryReceivingReceipts,
  createInventoryReceivingLine,
  isInventoryReceivingLineLocked
} from "../lib/inventoryReceivingBatch";

const CANONICAL_QUANTITY = /^(?:0|[1-9]\d*)(?:\.\d{1,6})?$/u;

function firstIngredientId(ingredients, lines) {
  const used = new Set(lines.map((line) => line.ingredientId).filter(Boolean));
  return ingredients.find((ingredient) => !used.has(ingredient.ingredientId))?.ingredientId
    || ingredients[0]?.ingredientId
    || "";
}

function draftLine(lineId, ingredients, lines = []) {
  return {
    ...createInventoryReceivingLine({ lineId }),
    ingredientId: firstIngredientId(ingredients, lines),
    unitId: "base",
    quantity: "",
    occurredAt: "",
    sourceLabel: "",
    costAvailability: "available",
    totalCost: "",
    currency: "USD",
    note: ""
  };
}

function quantityMicros(value) {
  const candidate = String(value || "").trim();
  if (!CANONICAL_QUANTITY.test(candidate) || /^0(?:\.0{1,6})?$/u.test(candidate)) {
    throw new Error("Enter a positive received quantity with no more than six decimal places.");
  }
  const [whole, fraction = ""] = candidate.split(".");
  return (BigInt(whole) * 1_000_000n) + BigInt(fraction.padEnd(6, "0"));
}

function displayQuantity(value) {
  const whole = value / 1_000_000n;
  const fraction = String(value % 1_000_000n).padStart(6, "0").replace(/0+$/u, "");
  return fraction ? `${whole}.${fraction}` : String(whole);
}

function baseQuantity(line, ingredient) {
  const received = quantityMicros(line.quantity);
  if (line.unitId === "base") return displayQuantity(received);
  const pack = ingredient.packConversions?.find((entry) => entry.packUnitId === line.unitId);
  if (!pack) throw new Error("Choose a current receiving unit for this ingredient.");
  const product = received * quantityMicros(pack.baseQuantity);
  if (product % 1_000_000n !== 0n) {
    throw new Error("This pack conversion exceeds six decimal places in the base unit.");
  }
  return displayQuantity(product / 1_000_000n);
}

function safeMessage(error, fallback) {
  const message = typeof error?.message === "string" ? error.message.trim() : "";
  return (message || fallback).slice(0, 240);
}

function prepareLine(line, ingredients) {
  const ingredient = ingredients.find((entry) => entry.ingredientId === line.ingredientId);
  if (!ingredient || ingredient.active !== true || ingredient.stock?.state !== "recorded") {
    throw new Error("Choose an active ingredient with recorded opening stock.");
  }
  const locationId = ingredient.stock?.locationId || "";
  if (!locationId) throw new Error("This ingredient has no recorded receiving location.");
  const occurredAt = new Date(String(line.occurredAt || "").trim());
  if (Number.isNaN(occurredAt.getTime())) throw new Error("Enter when this delivery was received.");
  const sourceLabel = String(line.sourceLabel || "").trim();
  if (!sourceLabel) throw new Error("Name the receipt or delivery source.");
  let cost;
  if (line.costAvailability === "available") {
    cost = {
      availability: "available",
      totalCostMinor: inventoryMoneyInputToMinorUnits(String(line.totalCost || "").trim()),
      currency: String(line.currency || "").trim().toUpperCase()
    };
    if (!/^[A-Z]{3}$/u.test(cost.currency)) throw new Error("Enter a three-letter currency code.");
  } else {
    cost = { availability: "not_yet_available" };
  }
  return {
    ...line,
    error: "",
    command: {
      kind: "receive_stock",
      ingredientId: ingredient.ingredientId,
      locationId,
      quantity: baseQuantity(line, ingredient),
      baseUnitId: ingredient.baseUnitId,
      occurredAtISO: occurredAt.toISOString(),
      sourceLabel,
      note: String(line.note || "").trim(),
      expectedStockRevision: ingredient.stock?.revision || 0,
      expectedCostRevision: ingredient.cost?.revision || 0,
      cost
    }
  };
}

function lineStatus(line) {
  if (line.state === "submitting") return "Recording this line…";
  if (line.state === "reconciliation") return "Checking the original request…";
  if (line.state === "uncertain") return line.error || "The outcome needs confirmation.";
  if (line.state === "definitive_failure") return line.error || "This line was rejected and can be retried safely.";
  if (line.state === "receipt") return "Receipt confirmed for this line. Waiting for the current stock and cost projections.";
  if (line.state === "committed") return "Current stock and cost projections confirm this line.";
  return line.error || "Ready to record.";
}

export default function InventoryReceivingBatch({
  ingredients = [],
  locations = [],
  current = false,
  scopeKey = "",
  projectionModel = null,
  createLineId = buildInventoryReceivingLineId,
  onSubmitBatch,
  onReconcileLine,
  onRetryLine,
  confirmsReceipt
}) {
  const receivableIngredients = useMemo(
    () => ingredients.filter((entry) => entry.active === true && entry.stock?.state === "recorded"),
    [ingredients]
  );
  const [lines, setLines] = useState(() => [draftLine(createLineId(), receivableIngredients)]);
  const [batchError, setBatchError] = useState("");
  const scopeRef = useRef(scopeKey);

  useEffect(() => {
    if (scopeRef.current === scopeKey) return;
    scopeRef.current = scopeKey;
    setLines([draftLine(createLineId(), receivableIngredients)]);
    setBatchError("");
  }, [createLineId, receivableIngredients, scopeKey]);

  useEffect(() => {
    if (!projectionModel || typeof confirmsReceipt !== "function") return;
    setLines((currentLines) => confirmInventoryReceivingReceipts(currentLines, projectionModel, confirmsReceipt));
  }, [confirmsReceipt, projectionModel]);

  const updateLine = (lineId, change) => {
    setLines((currentLines) => currentLines.map((line) => {
      if (line.lineId !== lineId || isInventoryReceivingLineLocked(line)) return line;
      return { ...line, ...change, command: null, error: "" };
    }));
    setBatchError("");
  };
  const applyLineState = (next) => {
    setLines((currentLines) => currentLines.map((line) => line.lineId === next.lineId ? next : line));
  };
  const busy = lines.some((line) => ["submitting", "reconciliation"].includes(line.state));
  const draftCount = lines.filter((line) => line.state === "draft").length;
  const unusedIngredientExists = receivableIngredients.some((ingredient) => (
    !lines.some((line) => line.ingredientId === ingredient.ingredientId)
  ));

  const submit = async (event) => {
    event.preventDefault();
    const draftIngredients = lines.filter((line) => line.state === "draft").map((line) => line.ingredientId);
    if (new Set(draftIngredients).size !== draftIngredients.length) {
      setBatchError("Add each ingredient once per receiving batch. Record another delivery after this batch settles.");
      return;
    }
    let prepared;
    try {
      prepared = lines.map((line) => line.state === "draft" ? prepareLine(line, receivableIngredients) : line);
    } catch (error) {
      setBatchError(safeMessage(error, "Review the receiving lines before recording them."));
      return;
    }
    setLines(prepared);
    setBatchError("");
    try {
      await onSubmitBatch?.({ lines: prepared, onLineState: applyLineState });
    } catch (error) {
      setBatchError(safeMessage(error, "The receiving batch could not start."));
    }
  };

  if (!receivableIngredients.length) return null;

  return (
    <section data-inventory-receiving-batch aria-labelledby="inventory-receiving-batch-title">
      <p className="eyebrow">Multiple deliveries</p>
      <h4 id="inventory-receiving-batch-title">Receive several ingredients</h4>
      <p className="muted">Each line records separately. A failed or uncertain line does not hide successful receipts.</p>
      <form aria-label="Receive multiple ingredient lines" onSubmit={submit} style={{ display: "grid", gap: "var(--space-4, 1rem)" }}>
        {lines.map((line, index) => {
          const ingredient = receivableIngredients.find((entry) => entry.ingredientId === line.ingredientId) || receivableIngredients[0];
          const locked = !current || isInventoryReceivingLineLocked(line);
          const locationName = locations.find((entry) => entry.locationId === ingredient?.stock?.locationId)?.name
            || ingredient?.stock?.locationId
            || "Unavailable";
          const pack = ingredient?.packConversions?.find((entry) => entry.packUnitId === line.unitId);
          return (
            <fieldset
              key={line.lineId}
              data-receiving-batch-line={line.lineId}
              data-receiving-line-state={line.state}
              style={{ display: "grid", gap: "var(--space-3, .75rem)" }}
            >
              <legend>Receiving line {index + 1}</legend>
              {receivableIngredients.length === 1 ? (
                <div className="field" data-inventory-choice-state="one">
                  <span>Ingredient</span>
                  <strong>{ingredient.name}</strong>
                  <span className="source-note">Only one eligible choice is available.</span>
                </div>
              ) : (
                <label className="field">
                  Ingredient
                  <select
                    required
                    aria-label={`Line ${index + 1} ingredient`}
                    value={line.ingredientId}
                    disabled={locked}
                    onChange={(event) => updateLine(line.lineId, { ingredientId: event.target.value, unitId: "base" })}
                  >
                    {receivableIngredients.map((entry) => <option key={entry.ingredientId} value={entry.ingredientId}>{entry.name} · {entry.baseUnitId}</option>)}
                  </select>
                </label>
              )}
              <label className="field">
                Receiving location
                <input readOnly value={locationName} />
              </label>
              {ingredient?.packConversions?.length > 0 && (
                <label className="field" data-field-width="unit">
                  Receiving unit
                  <select value={line.unitId} disabled={locked} onChange={(event) => updateLine(line.lineId, { unitId: event.target.value })}>
                    <option value="base">{ingredient.baseUnitId} (base unit)</option>
                    {ingredient.packConversions.map((entry) => <option key={entry.packUnitId} value={entry.packUnitId}>{entry.packLabel}</option>)}
                  </select>
                </label>
              )}
              <label className="field" data-field-width="numeric">
                Quantity received ({pack?.packLabel || ingredient?.baseUnitId || "base unit"})
                <input required inputMode="decimal" aria-label={`Line ${index + 1} quantity received`} value={line.quantity} disabled={locked} onChange={(event) => updateLine(line.lineId, { quantity: event.target.value })} />
              </label>
              <label className="field" data-field-width="datetime">
                Received at
                <input required type="datetime-local" aria-label={`Line ${index + 1} received at`} value={line.occurredAt} disabled={locked} onChange={(event) => updateLine(line.lineId, { occurredAt: event.target.value })} />
              </label>
              <label className="field">
                Receipt or delivery source
                <input required maxLength={120} aria-label={`Line ${index + 1} receipt or delivery source`} value={line.sourceLabel} disabled={locked} onChange={(event) => updateLine(line.lineId, { sourceLabel: event.target.value })} />
              </label>
              <label className="field">
                Cost evidence
                <select aria-label={`Line ${index + 1} cost evidence`} value={line.costAvailability} disabled={locked} onChange={(event) => updateLine(line.lineId, { costAvailability: event.target.value })}>
                  <option value="available">Recorded total cost</option>
                  <option value="not_yet_available">Cost currently unknown</option>
                </select>
              </label>
              {line.costAvailability === "available" && (
                <div className="workspace-field-row">
                  <label className="field" data-field-width="numeric">
                    Recorded receipt total
                    <input required inputMode="decimal" value={line.totalCost} disabled={locked} onChange={(event) => updateLine(line.lineId, { totalCost: event.target.value })} />
                  </label>
                  <label className="field" data-field-width="code">
                    Currency
                    <input required maxLength={3} value={line.currency} disabled={locked} onChange={(event) => updateLine(line.lineId, { currency: event.target.value.toUpperCase() })} />
                  </label>
                </div>
              )}
              <label className="field" data-field-width="note">
                Receiving note <span className="source-note">optional</span>
                <textarea rows="2" maxLength={240} value={line.note} disabled={locked} onChange={(event) => updateLine(line.lineId, { note: event.target.value })} />
              </label>
              <div className={line.state === "definitive_failure" || line.state === "uncertain" ? "error-note" : "status-strip"} role={line.state === "definitive_failure" ? "alert" : "status"}>
                <p>{lineStatus(line)}</p>
                {line.requestId && (
                  <details>
                    <summary>Exact request identity</summary>
                    <code>{line.requestId}</code>
                    {line.receipt?.receiptId && <span className="source-note"> · receipt {line.receipt.receiptId}</span>}
                  </details>
                )}
                {line.state === "uncertain" && (
                  <button
                    className="ghost"
                    type="button"
                    data-reconcile-receiving-line={line.lineId}
                    onClick={() => onReconcileLine?.({ line, onLineState: applyLineState })}
                  >
                    Check exact request
                  </button>
                )}
                {line.state === "definitive_failure" && (
                  <button
                    className="ghost"
                    type="button"
                    data-retry-receiving-line={line.lineId}
                    onClick={() => onRetryLine?.({ line, onLineState: applyLineState })}
                  >
                    Retry this line
                  </button>
                )}
              </div>
              {line.state === "draft" && lines.length > 1 && (
                <button className="ghost" type="button" onClick={() => setLines((currentLines) => currentLines.filter((entry) => entry.lineId !== line.lineId))}>
                  Remove line {index + 1}
                </button>
              )}
            </fieldset>
          );
        })}
        {batchError && <p className="error-note" role="alert">{batchError}</p>}
        <div className="form-actions">
          <button
            className="ghost"
            type="button"
            data-add-receiving-line
            disabled={!current || busy || lines.length >= INVENTORY_RECEIVING_BATCH_LIMIT || !unusedIngredientExists}
            onClick={() => setLines((currentLines) => [...currentLines, draftLine(createLineId(), receivableIngredients, currentLines)])}
          >
            Add ingredient line
          </button>
          <button className="cta" type="submit" disabled={!current || busy || draftCount === 0}>
            Record unsubmitted lines
          </button>
        </div>
      </form>
      <p className="source-note">Receiving increases physical on-hand stock only. It does not create, release, or reconcile an event allocation.</p>
    </section>
  );
}
