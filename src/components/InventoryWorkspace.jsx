import { Fragment, useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
  applyInventoryCommand,
  buildInventoryRequestId,
  getInventoryBrowserAccess,
  inventoryCommandAxis,
  inventoryMoneyInputToMinorUnits,
  inventoryProjectionConfirmsReceipt,
  isDefinitiveInventoryError,
  readPendingInventoryCommands,
  reconcileInventoryCommand,
  resetDefinitiveInventoryCommand,
  subscribeToInventoryIngredientProjections
} from "../lib/inventoryAuthorityClient";

const formGridStyle = Object.freeze({
  display: "grid",
  gridTemplateColumns: "repeat(auto-fit, minmax(min(100%, 14rem), 1fr))",
  gap: "var(--space-3, .75rem)"
});

const stackStyle = Object.freeze({
  display: "grid",
  gap: "var(--space-4, 1rem)"
});

const AXES = Object.freeze(["location", "ingredient", "stock", "receiving", "cost", "conversion"]);
const CANONICAL_QUANTITY = /^(?:0|[1-9]\d*)(?:\.\d{1,6})?$/u;
const STABLE_REFERENCE = /^[^\s/?#\\\u0000]{1,180}$/u;

function initialAttempt() {
  return { state: "ready", error: "", requestId: "", targetId: "", receipt: null, confirmation: null };
}

function initialAttempts() {
  return Object.fromEntries(AXES.map((axis) => [axis, initialAttempt()]));
}

function safeMessage(error, fallback = "Inventory evidence is unavailable.") {
  const message = typeof error?.message === "string" ? error.message.trim() : "";
  return (message || fallback).slice(0, 240);
}

function exactLocalInstant(value) {
  const candidate = String(value || "").trim();
  if (!candidate) return "";
  const parsed = new Date(candidate);
  return Number.isNaN(parsed.getTime()) ? "" : parsed.toISOString();
}

function displayInstant(value) {
  const parsed = new Date(String(value || ""));
  if (Number.isNaN(parsed.getTime())) return "Time unavailable";
  return new Intl.DateTimeFormat(undefined, {
    dateStyle: "medium",
    timeStyle: "short"
  }).format(parsed);
}

function displayMoneyMinorUnits(value, currency) {
  const minor = String(value ?? "");
  if (!/^-?\d+$/u.test(minor) || !/^[A-Z]{3}$/u.test(String(currency || ""))) {
    return "Recorded cost unavailable";
  }
  try {
    const integer = BigInt(minor);
    const sign = integer < 0n ? "-" : "";
    const absolute = integer < 0n ? -integer : integer;
    const major = absolute / 100n;
    const cents = String(absolute % 100n).padStart(2, "0");
    return `${sign}${currency} ${major}.${cents}`;
  } catch {
    return "Recorded cost unavailable";
  }
}

function sourceStateLabel(state) {
  if (state === "current") return "Server confirmed";
  if (state === "cached") return "Cached orientation only";
  if (state === "pending") return "Pending local metadata";
  if (state === "unavailable") return "Unavailable";
  return "Loading";
}

function axisLocked(attempt) {
  return ["submitting", "reconciliation", "uncertain", "receipt"].includes(attempt.state);
}

function currentSource(model, source) {
  return model?.sources?.[source]?.state === "current";
}

function readCapabilityState(access, read, model) {
  if (access?.readEnabled !== true) return "recovery";
  if (read.state === "loading") return "loading";
  if (read.state === "current") {
    if (model?.bounded === true) return "partial";
    return model?.ingredients?.length ? "success" : "empty";
  }
  if (["cached", "pending", "stale"].includes(read.state)) return "stale";
  return "error";
}

function stockText(ingredient) {
  const stock = ingredient.stock;
  if (!stock || stock.state === "not_recorded") return "Opening stock not recorded";
  if (stock.state !== "recorded") return "Stock evidence unavailable";
  return `${stock.quantity} ${stock.unit}`;
}

function committedStockText(ingredient) {
  const stock = ingredient.stock;
  if (!stock || stock.state !== "recorded") return "—";
  return `${stock.committedQuantity} ${stock.unit}`;
}

function availableStockText(ingredient) {
  const stock = ingredient.stock;
  if (!stock || stock.state !== "recorded") return "—";
  return `${stock.availableToAllocateQuantity} ${stock.unit}`;
}

function costText(ingredient) {
  const cost = ingredient.cost;
  if (!cost || cost.state === "not_recorded") return "Cost not recorded";
  const unavailableLabels = {
    missing: "Cost evidence missing",
    not_applicable: "Cost marked not applicable",
    not_yet_available: "Cost not yet available",
    blocked_by_integration: "Cost blocked by integration",
    contradictory: "Cost evidence contradictory",
    schema_drift: "Cost evidence needs schema review"
  };
  if (unavailableLabels[cost.state]) return unavailableLabels[cost.state];
  if (cost.state !== "recorded") return "Cost evidence unavailable";
  return `${displayMoneyMinorUnits(cost.totalMinorUnits, cost.currency)} for ${cost.basisQuantity} ${cost.basisUnit}`;
}

function EvidenceSourceState({ label, state, bounded = false }) {
  return (
    <li>
      <strong>{label}:</strong> {sourceStateLabel(state)}
      {bounded ? " · first 200 ingredients only" : ""}
    </li>
  );
}

function ReadBoundary({ state, model, error, onRetry }) {
  if (state === "current") return null;
  if (state === "loading") {
    return <div className="status-strip" data-capability-state="loading" role="status">Loading server-confirmed ingredient evidence…</div>;
  }
  if (state === "cached") {
    return (
      <div className="warning-note" data-capability-state="stale" data-inventory-freshness="cached" role="status">
        Cached ingredient evidence is shown for orientation. It is not confirmed current, so changes remain unavailable.
      </div>
    );
  }
  if (state === "pending") {
    return (
      <div className="warning-note" data-capability-state="stale" data-inventory-freshness="pending" role="status">
        Inventory projection metadata is pending. This view is not confirmed current.
      </div>
    );
  }
  if (state === "stale") {
    return (
      <div className="warning-note" data-capability-state="stale" role="alert">
        <p><strong>Retained server evidence is stale.</strong> {error || "Live projection updates stopped."}</p>
        <button className="ghost" type="button" onClick={onRetry}>Reconnect inventory</button>
      </div>
    );
  }
  return (
    <div className="error-note" data-capability-state="error" role="alert">
      <p>{error || "Inventory projections could not be confirmed."}</p>
      <button className="cta" type="button" onClick={onRetry}>Try inventory again</button>
      {model?.ingredients?.length > 0 && <p>Retained values are not presented as current.</p>}
    </div>
  );
}

function AttemptState({ axis, attempt, onReconcile, onReset }) {
  const label = axis === "stock"
    ? "Stock evidence"
    : axis === "receiving"
      ? "Receiving evidence"
    : axis === "cost"
      ? "Cost evidence"
      : axis === "conversion"
        ? "Purchase pack"
        : axis === "ingredient"
          ? "Ingredient"
          : "Location";
  if (attempt.state === "ready") return null;
  if (attempt.state === "submitting") {
    return <div className="status-strip" data-capability-state="submitting" role="status">{axis === "conversion" ? "Publishing purchase pack…" : `Recording ${label.toLowerCase()}…`}</div>;
  }
  if (attempt.state === "reconciliation") {
    return <div className="status-strip" data-capability-state="reconciliation" role="status">Checking the exact original {label.toLowerCase()} request…</div>;
  }
  if (attempt.state === "uncertain") {
    return (
      <div className="warning-note" data-capability-state="uncertain" role="alert" tabIndex={-1} aria-label={`${label} request outcome`}>
        <p>{attempt.error || `The ${label.toLowerCase()} request ended without a verified receipt.`}</p>
        <p className="source-note">Keep the original request identity. Starting another request could duplicate evidence.</p>
        <button className="ghost" type="button" onClick={() => onReconcile(axis)}>Check exact request</button>
      </div>
    );
  }
  if (attempt.state === "receipt") {
    return (
      <div className="status-strip" data-capability-state="receipt" role="status" tabIndex={-1} aria-label={`${label} request outcome`}>
        Receipt recorded. Waiting for the server-confirmed {axis === "ingredient" ? "ingredient" : axis === "conversion" ? "purchase-pack" : axis} projection.
        {attempt.receipt?.receiptId && <span className="source-note">Receipt {attempt.receipt.receiptId}</span>}
      </div>
    );
  }
  if (attempt.state === "committed") {
    return (
      <div className="status-strip" data-capability-state="committed" role="status" tabIndex={-1} aria-label={`${label} request outcome`}>
        {label} is confirmed in the current projection.
        {attempt.receipt?.recordedAtISO && <span className="source-note">Recorded {displayInstant(attempt.receipt.recordedAtISO)}</span>}
      </div>
    );
  }
  return (
    <div className="error-note" data-capability-state="error" role="alert" tabIndex={-1} aria-label={`${label} request outcome`}>
      <p>{attempt.error || `${label} was definitively rejected.`}</p>
      <button className="ghost" type="button" data-capability-state="recovery" onClick={() => onReset(axis)}>Review before a new request</button>
    </div>
  );
}

function PackConversionEditor({ ingredient, current, attempt, onSubmit, onReconcile, onReset, editorId }) {
  const packs = Array.isArray(ingredient.packConversions) ? ingredient.packConversions : [];
  const [packUnitId, setPackUnitId] = useState("");
  const [packLabel, setPackLabel] = useState("");
  const [baseQuantity, setBaseQuantity] = useState("");
  const [sourceLabel, setSourceLabel] = useState("");
  const [validationError, setValidationError] = useState("");
  const matchingPack = packs.find((entry) => entry.packUnitId === packUnitId.trim());
  const expectedRevision = matchingPack?.revision || 0;
  const disabled = !current || axisLocked(attempt) || !ingredient.active;

  const changePackReference = (value) => {
    setPackUnitId(value);
    setValidationError("");
    const declared = packs.find((entry) => entry.packUnitId === value.trim());
    if (!declared) return;
    setPackLabel(declared.packLabel);
    setBaseQuantity(declared.baseQuantity);
    setSourceLabel(declared.sourceLabel);
  };

  const submit = (event) => {
    event.preventDefault();
    const reference = packUnitId.trim();
    if (!STABLE_REFERENCE.test(reference) || reference === "." || reference === "..") {
      setValidationError("Enter a stable purchase-pack reference without spaces, slashes, or query characters.");
      return;
    }
    if (!CANONICAL_QUANTITY.test(baseQuantity.trim()) || /^0(?:\.0{1,6})?$/u.test(baseQuantity.trim())) {
      setValidationError("Enter a positive quantity with no more than six decimal places; exponent notation is not supported.");
      return;
    }
    setValidationError("");
    onSubmit("conversion", {
      kind: "publish_pack_conversion",
      ingredientId: ingredient.ingredientId,
      packUnitId: reference,
      packLabel: packLabel.trim(),
      baseUnitId: ingredient.baseUnitId,
      baseQuantity: baseQuantity.trim(),
      sourceLabel: sourceLabel.trim(),
      expectedRevision
    });
  };

  return (
    <div id={editorId} data-inventory-axis="conversion" data-capability-state={attempt.state} style={stackStyle}>
      <div>
        <p className="eyebrow">Purchase-pack declaration</p>
        <h3>{ingredient.name}</h3>
      </div>
        <form aria-label={`Declare purchase pack for ${ingredient.name}`} data-inventory-command="publish_pack_conversion" onSubmit={submit} style={stackStyle}>
          <p className="muted">Define how one supplier pack converts to the ingredient’s base unit. This does not change stock or cost evidence.</p>
          <label className="field">
            Purchase-pack reference
            <input required maxLength={180} value={packUnitId} disabled={disabled} onChange={(event) => changePackReference(event.target.value)} placeholder="case-40lb" />
          </label>
          <label className="field">
            Pack label
            <input required maxLength={80} value={packLabel} disabled={disabled} onChange={(event) => { setPackLabel(event.target.value); setValidationError(""); }} placeholder="40 lb case" />
          </label>
          <label className="field">
            Quantity in base unit ({ingredient.baseUnitId})
            <input required inputMode="decimal" value={baseQuantity} disabled={disabled} onChange={(event) => { setBaseQuantity(event.target.value); setValidationError(""); }} placeholder="40" />
          </label>
          <label className="field">
            Declaration source
            <input required maxLength={120} value={sourceLabel} disabled={disabled} onChange={(event) => { setSourceLabel(event.target.value); setValidationError(""); }} placeholder="Supplier pack specification" />
          </label>
          <p className="source-note" aria-live="polite">
            Expected revision: {expectedRevision}. Publishing creates revision {expectedRevision + 1} if the declaration is still current.
          </p>
          {validationError && <p className="error-note" role="alert">{validationError}</p>}
          <button className="ghost" type="submit" disabled={disabled || !packUnitId.trim() || !packLabel.trim() || !baseQuantity.trim() || !sourceLabel.trim()}>
            Publish purchase pack
          </button>
        </form>
      <AttemptState axis="conversion" attempt={attempt} onReconcile={onReconcile} onReset={onReset} />
    </div>
  );
}

function LocationSetup({ disabled, attempt, onSubmit, onReconcile, onReset }) {
  const [locationId, setLocationId] = useState("");
  const [name, setName] = useState("");
  const submit = (event) => {
    event.preventDefault();
    onSubmit("location", {
      kind: "upsert_location",
      locationId: locationId.trim(),
      name: name.trim(),
      active: true,
      expectedRevision: 0
    });
  };
  return (
    <section className="panel" aria-labelledby="inventory-location-title">
      <p className="eyebrow">Stock location</p>
      <h2 id="inventory-location-title">Create a stock location</h2>
      <p className="muted">A location is required before physical stock evidence can be recorded.</p>
      <form aria-label="Create stock location" onSubmit={submit} style={stackStyle}>
        <div style={formGridStyle}>
          <label className="field">
            Location reference
            <input required maxLength={180} value={locationId} disabled={disabled} onChange={(event) => setLocationId(event.target.value)} aria-describedby="inventory-location-id-help" />
            <span id="inventory-location-id-help" className="source-note">Stable internal reference, such as main-kitchen.</span>
          </label>
          <label className="field">
            Location name
            <input required maxLength={100} value={name} disabled={disabled} onChange={(event) => setName(event.target.value)} />
          </label>
        </div>
        <button className="cta" type="submit" disabled={disabled || !locationId.trim() || !name.trim()}>Create stock location</button>
      </form>
      <AttemptState axis="location" attempt={attempt} onReconcile={onReconcile} onReset={onReset} />
    </section>
  );
}

function IngredientSetup({ disabled, locations, attempt, onSubmit, onReconcile, onReset }) {
  const [itemId, setItemId] = useState("");
  const [name, setName] = useState("");
  const [category, setCategory] = useState("");
  const [baseUnit, setBaseUnit] = useState("lb");
  const submit = (event) => {
    event.preventDefault();
    onSubmit("ingredient", {
      kind: "upsert_ingredient",
      ingredientId: itemId.trim(),
      name: name.trim(),
      category: category.trim(),
      baseUnitId: baseUnit,
      active: true,
      expectedRevision: 0
    });
  };
  return (
    <section className="panel" aria-labelledby="inventory-add-ingredient-title">
      <p className="eyebrow">1 · Ingredient identity</p>
      <h2 id="inventory-add-ingredient-title">Add ingredient</h2>
      <p className="muted">Define what is stocked. Quantity and cost remain independent evidence added afterward.</p>
      <form aria-label="Add ingredient" data-inventory-command="upsert_ingredient" onSubmit={submit} style={stackStyle}>
        <div style={formGridStyle}>
          <label className="field">
            Ingredient reference
            <input required maxLength={180} value={itemId} disabled={disabled} onChange={(event) => setItemId(event.target.value)} aria-describedby="inventory-ingredient-id-help" />
            <span id="inventory-ingredient-id-help" className="source-note">Stable internal reference; do not reuse it for another ingredient.</span>
          </label>
          <label className="field">
            Ingredient name
            <input required maxLength={100} value={name} disabled={disabled} onChange={(event) => setName(event.target.value)} />
          </label>
          <label className="field">
            Category
            <input required maxLength={80} value={category} disabled={disabled} onChange={(event) => setCategory(event.target.value)} />
          </label>
          <label className="field">
            Base stock unit
            <select required value={baseUnit} disabled={disabled} onChange={(event) => setBaseUnit(event.target.value)} aria-describedby="inventory-base-unit-help">
              <optgroup label="Count"><option value="each">Each</option><option value="dozen">Dozen</option></optgroup>
              <optgroup label="Mass"><option value="g">Gram (g)</option><option value="kg">Kilogram (kg)</option><option value="oz">Ounce (oz)</option><option value="lb">Pound (lb)</option></optgroup>
              <optgroup label="Volume"><option value="ml">Milliliter (ml)</option><option value="l">Liter (l)</option><option value="fl_oz">Fluid ounce</option><option value="pt">Pint</option><option value="qt">Quart</option><option value="gal">Gallon</option></optgroup>
            </select>
            <span id="inventory-base-unit-help" className="source-note">The unit locks after the first stock movement.</span>
          </label>
        </div>
        <p className="source-note">The ingredient can be stocked at {locations.length === 1 ? locations[0].name : `${locations.length} active locations`}.</p>
        <button className="cta" type="submit" disabled={disabled || !itemId.trim() || !name.trim() || !category.trim() || !baseUnit}>Add ingredient</button>
      </form>
      <AttemptState axis="ingredient" attempt={attempt} onReconcile={onReconcile} onReset={onReset} />
    </section>
  );
}

function EvidenceForms({ ingredients, locations, current, attempts, onSubmit, onReconcile, onReset }) {
  const activeIngredients = ingredients.filter((entry) => entry.active);
  const receivingAttempt = attempts.receiving || initialAttempt();
  const [stockIngredientId, setStockIngredientId] = useState("");
  const [stockLocationId, setStockLocationId] = useState("");
  const [quantity, setQuantity] = useState("");
  const [stockOccurredAt, setStockOccurredAt] = useState("");
  const [stockNote, setStockNote] = useState("");
  const [receivingIngredientId, setReceivingIngredientId] = useState("");
  const [receivingLocationId, setReceivingLocationId] = useState("");
  const [receivingQuantity, setReceivingQuantity] = useState("");
  const [receivingOccurredAt, setReceivingOccurredAt] = useState("");
  const [receivingSource, setReceivingSource] = useState("");
  const [receivingNote, setReceivingNote] = useState("");
  const [receivingCostAvailability, setReceivingCostAvailability] = useState("available");
  const [receivingTotalCost, setReceivingTotalCost] = useState("");
  const [receivingCurrency, setReceivingCurrency] = useState("USD");
  const [receivingInputError, setReceivingInputError] = useState("");
  const [costIngredientId, setCostIngredientId] = useState("");
  const [costAvailability, setCostAvailability] = useState("available");
  const [totalCost, setTotalCost] = useState("");
  const [currency, setCurrency] = useState("USD");
  const [basisQuantity, setBasisQuantity] = useState("");
  const [costOccurredAt, setCostOccurredAt] = useState("");
  const [provenance, setProvenance] = useState("");
  const [costNote, setCostNote] = useState("");
  const [costInputError, setCostInputError] = useState("");

  useEffect(() => {
    if (!activeIngredients.some((entry) => entry.ingredientId === stockIngredientId)) {
      setStockIngredientId(activeIngredients[0]?.ingredientId || "");
    }
    if (!activeIngredients.some((entry) => entry.ingredientId === costIngredientId)) {
      setCostIngredientId(activeIngredients[0]?.ingredientId || "");
    }
    const receivable = activeIngredients.filter((entry) => entry.stock?.state === "recorded");
    if (!receivable.some((entry) => entry.ingredientId === receivingIngredientId)) {
      setReceivingIngredientId(receivable[0]?.ingredientId || "");
    }
  }, [activeIngredients, costIngredientId, receivingIngredientId, stockIngredientId]);

  useEffect(() => {
    if (!locations.some((entry) => entry.locationId === stockLocationId)) setStockLocationId(locations[0]?.locationId || "");
  }, [locations, stockLocationId]);

  const stockIngredient = activeIngredients.find((entry) => entry.ingredientId === stockIngredientId);
  const costIngredient = activeIngredients.find((entry) => entry.ingredientId === costIngredientId);
  const receivingIngredient = activeIngredients.find((entry) => entry.ingredientId === receivingIngredientId);
  useEffect(() => {
    const recordedLocationId = receivingIngredient?.stock?.locationId || "";
    if (recordedLocationId !== receivingLocationId) setReceivingLocationId(recordedLocationId);
  }, [receivingIngredient, receivingLocationId]);
  const stockDisabled = !current || axisLocked(attempts.stock);
  const costDisabled = !current || axisLocked(attempts.cost);
  const receivingDisabled = !current || axisLocked(receivingAttempt) || !receivingIngredient;

  const submitStock = (event) => {
    event.preventDefault();
    onSubmit("stock", {
      kind: "opening_balance",
      ingredientId: stockIngredientId,
      locationId: stockLocationId,
      quantity: quantity.trim(),
      baseUnitId: stockIngredient?.baseUnitId || "",
      occurredAtISO: exactLocalInstant(stockOccurredAt),
      note: stockNote.trim(),
      expectedStockRevision: stockIngredient?.stock?.revision || 0
    });
  };

  const submitCost = (event) => {
    event.preventDefault();
    let totalCostMinor = null;
    if (costAvailability === "available") {
      try {
        totalCostMinor = inventoryMoneyInputToMinorUnits(totalCost.trim());
      } catch (error) {
        setCostInputError(safeMessage(error, "Enter an exact purchase total."));
        return;
      }
    }
    setCostInputError("");
    const common = {
      kind: "record_ingredient_cost",
      ingredientId: costIngredientId,
      baseUnitId: costIngredient?.baseUnitId || "",
      availability: costAvailability,
      sourceLabel: provenance.trim(),
      observedAtISO: exactLocalInstant(costOccurredAt),
      note: costNote.trim(),
      expectedCostRevision: costIngredient?.cost?.revision || 0
    };
    onSubmit("cost", costAvailability === "available" ? {
      ...common,
      basisQuantity: basisQuantity.trim(),
      totalCostMinor,
      currency: currency.trim().toUpperCase()
    } : common);
  };

  const submitReceiving = (event) => {
    event.preventDefault();
    if (!CANONICAL_QUANTITY.test(receivingQuantity.trim()) || /^0(?:\.0{1,6})?$/u.test(receivingQuantity.trim())) {
      setReceivingInputError("Enter a positive received quantity with no more than six decimal places.");
      return;
    }
    let totalCostMinor;
    if (receivingCostAvailability === "available") {
      try {
        totalCostMinor = inventoryMoneyInputToMinorUnits(receivingTotalCost.trim());
      } catch (error) {
        setReceivingInputError(safeMessage(error, "Enter the exact recorded receipt total."));
        return;
      }
    }
    setReceivingInputError("");
    onSubmit("receiving", {
      kind: "receive_stock",
      ingredientId: receivingIngredientId,
      locationId: receivingLocationId,
      quantity: receivingQuantity.trim(),
      baseUnitId: receivingIngredient?.baseUnitId || "",
      occurredAtISO: exactLocalInstant(receivingOccurredAt),
      sourceLabel: receivingSource.trim(),
      note: receivingNote.trim(),
      expectedStockRevision: receivingIngredient?.stock?.revision || 0,
      expectedCostRevision: receivingIngredient?.cost?.revision || 0,
      cost: receivingCostAvailability === "available"
        ? { availability: "available", totalCostMinor, currency: receivingCurrency.trim().toUpperCase() }
        : { availability: "not_yet_available" }
    });
  };

  return (
    <section aria-labelledby="inventory-evidence-title">
      <p className="eyebrow">2 and 3 · Independent evidence</p>
      <h2 id="inventory-evidence-title">Record stock and cost separately</h2>
      <p className="muted">A valid stock record does not wait for cost. A valid cost record does not claim stock is available.</p>
      <div style={formGridStyle}>
        <div className="panel" data-inventory-axis="stock" data-capability-state={attempts.stock.state}>
          <h3>Opening stock</h3>
          <p className="muted">Record the physical count in the ingredient’s base unit.</p>
          <form aria-label="Record opening stock" data-inventory-command="opening_balance" onSubmit={submitStock} style={stackStyle}>
            <label className="field">
              Ingredient
              <select required value={stockIngredientId} disabled={stockDisabled} onChange={(event) => setStockIngredientId(event.target.value)}>
                {activeIngredients.map((entry) => <option key={entry.ingredientId} value={entry.ingredientId}>{entry.name} · {entry.baseUnitId}</option>)}
              </select>
            </label>
            <label className="field">
              Stock location
              <select required value={stockLocationId} disabled={stockDisabled} onChange={(event) => setStockLocationId(event.target.value)}>
                {locations.map((entry) => <option key={entry.locationId} value={entry.locationId}>{entry.name}</option>)}
              </select>
            </label>
            <label className="field">
              Opening quantity ({stockIngredient?.baseUnitId || "base unit"})
              <input required inputMode="decimal" placeholder="40" value={quantity} disabled={stockDisabled} onChange={(event) => setQuantity(event.target.value)} />
            </label>
            <label className="field">
              Count effective at
              <input required type="datetime-local" value={stockOccurredAt} disabled={stockDisabled} onChange={(event) => setStockOccurredAt(event.target.value)} />
            </label>
            <label className="field">
              Count note
              <textarea required rows="2" maxLength={240} value={stockNote} disabled={stockDisabled} onChange={(event) => setStockNote(event.target.value)} />
            </label>
            <button className="cta" type="submit" disabled={stockDisabled || !stockIngredientId || !stockLocationId || !quantity.trim() || !stockOccurredAt || !stockNote.trim()}>Record opening stock</button>
          </form>
          <AttemptState axis="stock" attempt={attempts.stock} onReconcile={onReconcile} onReset={onReset} />
        </div>

        <div className="panel" data-inventory-axis="receiving" data-capability-state={receivingAttempt.state}>
          <h3>Receive ingredient stock</h3>
          <p className="muted">Add a confirmed delivery to physical on-hand stock and record its observed total cost—or explicitly leave cost unknown.</p>
          {receivingIngredient ? (
            <form aria-label="Receive ingredient stock" data-inventory-command="receive_stock" onSubmit={submitReceiving} style={stackStyle}>
              <label className="field">
                Ingredient
                <select required value={receivingIngredientId} disabled={receivingDisabled} onChange={(event) => { setReceivingIngredientId(event.target.value); setReceivingInputError(""); }}>
                  {activeIngredients.filter((entry) => entry.stock?.state === "recorded").map((entry) => <option key={entry.ingredientId} value={entry.ingredientId}>{entry.name} · {entry.baseUnitId}</option>)}
                </select>
              </label>
              <label className="field">
                Receiving location
                <input readOnly value={locations.find((entry) => entry.locationId === receivingLocationId)?.name || receivingLocationId} />
              </label>
              <label className="field">
                Quantity received ({receivingIngredient.baseUnitId})
                <input required inputMode="decimal" value={receivingQuantity} disabled={receivingDisabled} onChange={(event) => { setReceivingQuantity(event.target.value); setReceivingInputError(""); }} placeholder="20" />
              </label>
              <label className="field">
                Received at
                <input required type="datetime-local" value={receivingOccurredAt} disabled={receivingDisabled} onChange={(event) => setReceivingOccurredAt(event.target.value)} />
              </label>
              <label className="field">
                Receipt or delivery source
                <input required maxLength={120} value={receivingSource} disabled={receivingDisabled} onChange={(event) => setReceivingSource(event.target.value)} placeholder="Vendor receipt 1842" />
              </label>
              <label className="field">
                Cost evidence
                <select value={receivingCostAvailability} disabled={receivingDisabled} onChange={(event) => { setReceivingCostAvailability(event.target.value); setReceivingInputError(""); }}>
                  <option value="available">Recorded total cost</option>
                  <option value="not_yet_available">Cost currently unknown</option>
                </select>
              </label>
              {receivingCostAvailability === "available" && (
                <div style={formGridStyle}>
                  <label className="field">
                    Recorded receipt total
                    <input required inputMode="decimal" value={receivingTotalCost} disabled={receivingDisabled} onChange={(event) => { setReceivingTotalCost(event.target.value); setReceivingInputError(""); }} placeholder="75.00" />
                  </label>
                  <label className="field">
                    Currency
                    <input required maxLength={3} value={receivingCurrency} disabled={receivingDisabled} onChange={(event) => setReceivingCurrency(event.target.value.toUpperCase())} />
                  </label>
                </div>
              )}
              <label className="field">
                Receiving note <span className="source-note">optional</span>
                <textarea rows="2" maxLength={240} value={receivingNote} disabled={receivingDisabled} onChange={(event) => setReceivingNote(event.target.value)} />
              </label>
              <p className="source-note">Receiving increases on-hand stock. It does not create or release an event allocation.</p>
              {receivingInputError && <p className="error-note" role="alert">{receivingInputError}</p>}
              <button className="cta" type="submit" disabled={receivingDisabled || !receivingLocationId || !receivingQuantity.trim() || !receivingOccurredAt || !receivingSource.trim() || (receivingCostAvailability === "available" && (!receivingTotalCost.trim() || !receivingCurrency.trim()))}>Record receiving</button>
            </form>
          ) : <p className="source-note" data-capability-state="empty">Record opening stock before receiving later deliveries.</p>}
          <AttemptState axis="receiving" attempt={receivingAttempt} onReconcile={onReconcile} onReset={onReset} />
        </div>

        <div className="panel" data-inventory-axis="cost" data-capability-state={attempts.cost.state}>
          <h3>Purchase-cost evidence <span className="source-note">optional</span></h3>
          <p className="muted">Record the exact observed purchase total and its quantity basis. Skipping this leaves cost unknown, never zero.</p>
          <form aria-label="Record purchase cost" data-inventory-command="record_ingredient_cost" onSubmit={submitCost} style={stackStyle}>
            <label className="field">
              Ingredient
              <select required value={costIngredientId} disabled={costDisabled} onChange={(event) => setCostIngredientId(event.target.value)}>
                {activeIngredients.map((entry) => <option key={entry.ingredientId} value={entry.ingredientId}>{entry.name} · {entry.baseUnitId}</option>)}
              </select>
            </label>
            <label className="field">
              Evidence state
              <select required value={costAvailability} disabled={costDisabled} onChange={(event) => setCostAvailability(event.target.value)}>
                <option value="available">Purchase cost recorded</option>
                <option value="not_yet_available">Not yet available</option>
                <option value="missing">Evidence missing</option>
                <option value="blocked_by_integration">Blocked by integration</option>
                <option value="contradictory">Contradictory evidence</option>
                <option value="schema_drift">Evidence schema changed</option>
                <option value="not_applicable">Not applicable</option>
              </select>
            </label>
            {costAvailability === "available" && (
              <>
                <div style={formGridStyle}>
                  <label className="field">
                    Purchase total
                    <input required inputMode="decimal" placeholder="120.00" value={totalCost} disabled={costDisabled} onChange={(event) => { setTotalCost(event.target.value); setCostInputError(""); }} />
                  </label>
                  <label className="field">
                    Currency
                    <input required inputMode="text" maxLength={3} value={currency} disabled={costDisabled} onChange={(event) => setCurrency(event.target.value.toUpperCase())} />
                  </label>
                </div>
                <label className="field">
                  Quantity purchased ({costIngredient?.baseUnitId || "base unit"})
                  <input required inputMode="decimal" placeholder="40" value={basisQuantity} disabled={costDisabled} onChange={(event) => setBasisQuantity(event.target.value)} />
                </label>
              </>
            )}
            <label className="field">
              Purchase effective at
              <input required type="datetime-local" value={costOccurredAt} disabled={costDisabled} onChange={(event) => setCostOccurredAt(event.target.value)} />
            </label>
            <label className="field">
              Evidence source
              <input required maxLength={120} placeholder="Opening invoice" value={provenance} disabled={costDisabled} onChange={(event) => setProvenance(event.target.value)} />
            </label>
            <label className="field">
              Evidence note <span className="source-note">optional</span>
              <textarea rows="2" maxLength={240} value={costNote} disabled={costDisabled} onChange={(event) => setCostNote(event.target.value)} />
            </label>
            {costInputError && <p className="error-note" role="alert">{costInputError}</p>}
            <button className="ghost" type="submit" disabled={costDisabled || !costIngredientId || !costOccurredAt || !provenance.trim() || (costAvailability === "available" && (!totalCost.trim() || !currency.trim() || !basisQuantity.trim()))}>Record cost evidence</button>
          </form>
          <AttemptState axis="cost" attempt={attempts.cost} onReconcile={onReconcile} onReset={onReset} />
        </div>
      </div>
    </section>
  );
}

function IngredientEvidenceTable({ ingredients, freshness, packsCurrent, canManagePacks, packAttempt, onSubmit, onReconcile, onReset }) {
  const [selectedIngredientId, setSelectedIngredientId] = useState(() => (
    ingredients.some((entry) => entry.ingredientId === packAttempt.targetId)
      ? packAttempt.targetId
      : ""
  ));
  useEffect(() => {
    if (packAttempt.targetId && ingredients.some((entry) => entry.ingredientId === packAttempt.targetId)) {
      setSelectedIngredientId(packAttempt.targetId);
    } else if (selectedIngredientId && !ingredients.some((entry) => entry.ingredientId === selectedIngredientId)) {
      setSelectedIngredientId("");
    }
  }, [ingredients, packAttempt.targetId, selectedIngredientId]);

  if (!ingredients.length) {
    return (
      <section className="panel" aria-labelledby="inventory-empty-title">
        <p className="eyebrow">Ingredient evidence</p>
        <h2 id="inventory-empty-title">No ingredients recorded</h2>
        <p className="muted">Add the first ingredient after a stock location is server confirmed.</p>
      </section>
    );
  }
  return (
    <section className="panel" aria-labelledby="inventory-list-title">
      <p className="eyebrow">Ingredient evidence</p>
      <h2 id="inventory-list-title">Stock and cost by ingredient</h2>
      <p id="inventory-list-description" className="source-note">
        {freshness === "current" ? "Server-confirmed projections." : "Retained projections for orientation only."} Stock and cost are separate evidence axes.
      </p>
      <div className="history-table-wrap">
        <table aria-describedby="inventory-list-description">
          <caption className="sr-only">Ingredient on-hand, committed, available-to-allocate, and independent purchase-cost evidence</caption>
          <thead>
            <tr><th scope="col">Ingredient</th><th scope="col">Physical on hand</th><th scope="col">Committed</th><th scope="col">Available to allocate</th><th scope="col">Cost evidence</th><th scope="col">Location</th><th scope="col">Purchase packs</th></tr>
          </thead>
          <tbody>
            {ingredients.map((ingredient, index) => {
              const packs = Array.isArray(ingredient.packConversions) ? ingredient.packConversions : [];
              const selected = selectedIngredientId === ingredient.ingredientId;
              const editorId = `inventory-pack-editor-${index}`;
              return (
                <Fragment key={ingredient.ingredientId}>
                  <tr>
                    <th scope="row">{ingredient.name}<span className="source-note"> · {ingredient.category}</span></th>
                    <td data-inventory-axis="stock">{stockText(ingredient)}</td>
                    <td data-inventory-axis="allocation">{committedStockText(ingredient)}</td>
                    <td data-inventory-axis="availability">{availableStockText(ingredient)}</td>
                    <td data-inventory-axis="cost">{costText(ingredient)}</td>
                    <td>{ingredient.locationName || ingredient.locationId || "No location evidence"}</td>
                    <td>
                      {packs.length ? (
                        <ul className="plain-list" aria-label={`Declared purchase packs for ${ingredient.name}`}>
                          {packs.map((pack) => (
                            <li key={pack.packUnitId}>
                              <strong>{pack.packLabel}</strong> · 1 {pack.packUnitId} = {pack.baseQuantity} {pack.baseUnitId}
                              <span className="source-note"> · {pack.sourceLabel} · revision {pack.revision}</span>
                            </li>
                          ))}
                        </ul>
                      ) : <p className="source-note">No purchase packs declared.</p>}
                      {canManagePacks && (
                        <button
                          className="ghost"
                          type="button"
                          aria-expanded={selected}
                          aria-controls={editorId}
                          disabled={!packsCurrent || !ingredient.active || (axisLocked(packAttempt) && !selected)}
                          onClick={() => setSelectedIngredientId(selected ? "" : ingredient.ingredientId)}
                        >
                          {selected ? "Close pack editor" : "Declare or revise pack"}
                        </button>
                      )}
                    </td>
                  </tr>
                  {selected && canManagePacks && (
                    <tr>
                      <td colSpan="7">
                        <PackConversionEditor
                          ingredient={ingredient}
                          current={packsCurrent}
                          attempt={packAttempt}
                          onSubmit={onSubmit}
                          onReconcile={onReconcile}
                          onReset={onReset}
                          editorId={editorId}
                        />
                      </td>
                    </tr>
                  )}
                </Fragment>
              );
            })}
          </tbody>
        </table>
      </div>
    </section>
  );
}

export function InventoryWorkspaceView({
  access,
  read,
  attempts,
  onRetry,
  onSubmit,
  onReconcile,
  onReset
}) {
  const model = read.model || { workspace: null, ingredients: [], sources: {} };
  const ingredients = model.ingredients || [];
  const locations = (model.workspace?.locations || []).filter((entry) => entry.active);
  const sourcesCurrent = currentSource(model, "workspace") && currentSource(model, "ingredients");
  const canConfigure = access?.mutationEnabled === true && sourcesCurrent;
  const hasCurrentLocation = locations.length > 0;
  const capabilityState = readCapabilityState(access, read, model);

  return (
    <main
      className="container workspace-route-main"
      data-capability-id="inventory-workspace"
      data-capability-state={capabilityState}
      data-inventory-freshness={access?.readEnabled ? read.state : "unavailable"}
      aria-labelledby="inventory-workspace-title"
    >
      <header className="workspace-route-head">
        <div>
          <p className="eyebrow">Operations</p>
          <h1 id="inventory-workspace-title" className="workspace-route-heading" tabIndex={-1}>Inventory</h1>
          <p className="muted">Create ingredients, receive physical stock, track event commitments, and independently retain purchase-cost evidence.</p>
        </div>
      </header>

      {!access?.readEnabled ? (
        <section className="panel" data-capability-state="recovery" aria-labelledby="inventory-access-title">
          <p className="eyebrow">Inventory unavailable</p>
          <h2 id="inventory-access-title">Authority gates are closed</h2>
          <p>{access?.reason || "Inventory requires the authorized organization, administrator role, and both feature gates."}</p>
        </section>
      ) : (
        <div style={stackStyle}>
          <ReadBoundary state={read.state} model={model} error={read.error} onRetry={onRetry} />
          <section className="panel" aria-labelledby="inventory-source-state-title">
            <p className="eyebrow">Projection evidence</p>
            <h2 id="inventory-source-state-title">Currentness by source</h2>
            <ul className="plain-list">
              <EvidenceSourceState label="Location setup" state={model.sources?.workspace?.state || "loading"} />
              <EvidenceSourceState label="Ingredient list" state={model.sources?.ingredients?.state || "loading"} bounded={model.bounded === true} />
            </ul>
          </section>

          <IngredientEvidenceTable
            ingredients={ingredients}
            freshness={read.state}
            packsCurrent={read.state === "current" && currentSource(model, "ingredients")}
            canManagePacks={access.mutationEnabled === true}
            packAttempt={attempts.conversion || initialAttempt()}
            onSubmit={onSubmit}
            onReconcile={onReconcile}
            onReset={onReset}
          />

          {access.mutationEnabled ? (
            <>
              {!hasCurrentLocation && (
                <LocationSetup
                  disabled={!currentSource(model, "workspace") || axisLocked(attempts.location)}
                  attempt={attempts.location}
                  onSubmit={onSubmit}
                  onReconcile={onReconcile}
                  onReset={onReset}
                />
              )}
              {hasCurrentLocation && (
                <IngredientSetup
                  disabled={!canConfigure || model.bounded === true || axisLocked(attempts.ingredient)}
                  locations={locations}
                  attempt={attempts.ingredient}
                  onSubmit={onSubmit}
                  onReconcile={onReconcile}
                  onReset={onReset}
                />
              )}
              {hasCurrentLocation && ingredients.some((entry) => entry.active) && (
                <EvidenceForms
                  ingredients={ingredients}
                  locations={locations}
                  current={sourcesCurrent}
                  attempts={attempts}
                  onSubmit={onSubmit}
                  onReconcile={onReconcile}
                  onReset={onReset}
                />
              )}
            </>
          ) : <p className="source-note">This projection is read-only. Only an authorized administrator may record ingredient evidence.</p>}

          <p className="source-note">
            Evidence boundary: a purchase cost does not prove stock, and a stock count does not prove cost. Neither changes menu pricing, quote totals, booking, or overall event readiness.
          </p>
        </div>
      )}
    </main>
  );
}

export default function InventoryWorkspace({
  organizationId,
  role = "customer",
  browserEnabled = false,
  tenantEnabled = false,
  subscribeProjections = subscribeToInventoryIngredientProjections,
  submitCommand = applyInventoryCommand,
  reconcileCommand = reconcileInventoryCommand,
  resetCommand = resetDefinitiveInventoryCommand,
  pendingCommands = readPendingInventoryCommands
}) {
  const access = useMemo(() => getInventoryBrowserAccess({
    organizationId,
    role,
    browserEnabled,
    tenantEnabled
  }), [browserEnabled, organizationId, role, tenantEnabled]);
  const scope = useMemo(() => ({ organizationId, role, browserEnabled, tenantEnabled }), [browserEnabled, organizationId, role, tenantEnabled]);
  const [read, setRead] = useState({ state: "loading", model: null, error: "" });
  const [attempts, setAttempts] = useState(initialAttempts);
  const [retryGeneration, setRetryGeneration] = useState(0);
  const readGenerationRef = useRef(0);
  const commandGenerationRef = useRef(0);

  useEffect(() => {
    const heading = document.getElementById("inventory-workspace-title");
    heading?.focus?.({ preventScroll: true });
  }, [access.readEnabled, organizationId]);

  useEffect(() => {
    const generation = commandGenerationRef.current + 1;
    commandGenerationRef.current = generation;
    setAttempts(initialAttempts());
    if (access.mutationEnabled) {
      try {
        const restored = pendingCommands(scope);
        setAttempts((current) => {
          const next = { ...current };
          restored.forEach((attempt) => {
            const axis = inventoryCommandAxis(attempt.commandKind);
            if (!AXES.includes(axis)) return;
            next[axis] = {
              state: attempt.definitive ? "error" : "uncertain",
              error: attempt.error || "This exact inventory request still needs reconciliation.",
              requestId: attempt.requestId,
              targetId: attempt.targetId || "",
              receipt: null
            };
          });
          return next;
        });
      } catch {
        // Closed gates render their own recovery state; no browser fallback is created.
      }
    }
    return () => {
      if (commandGenerationRef.current === generation) commandGenerationRef.current += 1;
    };
  }, [access.mutationEnabled, pendingCommands, scope]);

  useEffect(() => {
    const generation = readGenerationRef.current + 1;
    readGenerationRef.current = generation;
    setRead({ state: access.readEnabled ? "loading" : "unavailable", model: null, error: access.reason });
    if (!access.readEnabled) return () => { readGenerationRef.current += 1; };

    let unsubscribe = () => {};
    try {
      unsubscribe = subscribeProjections({
        ...scope,
        onData: (model) => {
          if (readGenerationRef.current !== generation) return;
          const nextState = ["current", "pending", "cached", "loading", "unavailable"].includes(model.freshness)
            ? model.freshness
            : "unavailable";
          setRead({ state: nextState, model, error: "" });
        },
        onError: (error) => {
          if (readGenerationRef.current !== generation) return;
          setRead((current) => ({
            state: current.model ? "stale" : "unavailable",
            model: error?.model || current.model,
            error: safeMessage(error, "Live inventory projections stopped.")
          }));
        }
      });
    } catch (error) {
      if (readGenerationRef.current === generation) {
        setRead({ state: "unavailable", model: null, error: safeMessage(error) });
      }
    }
    return () => {
      if (readGenerationRef.current === generation) readGenerationRef.current += 1;
      if (typeof unsubscribe === "function") unsubscribe();
    };
  }, [access.readEnabled, access.reason, retryGeneration, scope, subscribeProjections]);

  useEffect(() => {
    if (read.state !== "current" || !read.model) return;
    setAttempts((current) => {
      let changed = false;
      const next = { ...current };
      AXES.forEach((axis) => {
        const attempt = current[axis];
        if (attempt.state === "receipt" && inventoryProjectionConfirmsReceipt(read.model, attempt)) {
          next[axis] = { ...attempt, state: "committed" };
          changed = true;
        }
      });
      return changed ? next : current;
    });
  }, [read.model, read.state]);

  const setAttempt = useCallback((axis, value) => {
    setAttempts((current) => ({ ...current, [axis]: value }));
  }, []);

  const onSubmit = useCallback(async (axis, command) => {
    let requestId = "";
    const generation = commandGenerationRef.current;
    try {
      requestId = buildInventoryRequestId();
      const targetId = command.ingredientId || command.locationId || command.menuItemId || "";
      setAttempt(axis, { state: "submitting", error: "", requestId, targetId, receipt: null, confirmation: null });
      const result = await submitCommand({ ...scope, requestId, command });
      if (commandGenerationRef.current === generation) {
        setAttempt(axis, { state: "receipt", error: "", requestId, targetId, receipt: result.receipt, confirmation: result.confirmation });
      }
    } catch (error) {
      if (commandGenerationRef.current === generation) {
        setAttempt(axis, {
          state: isDefinitiveInventoryError(error) ? "error" : "uncertain",
          error: safeMessage(error, "Inventory did not return a verified receipt."),
          requestId,
          targetId: command.ingredientId || command.locationId || command.menuItemId || "",
          receipt: null,
          confirmation: null
        });
      }
    }
  }, [scope, setAttempt, submitCommand]);

  const onReconcile = useCallback(async (axis) => {
    const requestId = attempts[axis]?.requestId;
    if (!requestId) return;
    const generation = commandGenerationRef.current;
    setAttempt(axis, { ...attempts[axis], state: "reconciliation", error: "" });
    try {
      const result = await reconcileCommand({ ...scope, requestId });
      if (commandGenerationRef.current === generation) {
        setAttempt(axis, {
          state: "receipt",
          error: "",
          requestId,
          targetId: attempts[axis]?.targetId || result.confirmation?.ingredientId || "",
          receipt: result.receipt,
          confirmation: result.confirmation
        });
      }
    } catch (error) {
      if (commandGenerationRef.current === generation) {
        setAttempt(axis, {
          ...attempts[axis],
          state: isDefinitiveInventoryError(error) ? "error" : "uncertain",
          error: safeMessage(error)
        });
      }
    }
  }, [attempts, reconcileCommand, scope, setAttempt]);

  const onReset = useCallback((axis) => {
    const requestId = attempts[axis]?.requestId;
    if (requestId) {
      try {
        resetCommand({ ...scope, requestId });
      } catch {
        return;
      }
    }
    setAttempt(axis, initialAttempt());
  }, [attempts, resetCommand, scope, setAttempt]);

  return (
    <InventoryWorkspaceView
      access={access}
      read={read}
      attempts={attempts}
      onRetry={() => setRetryGeneration((value) => value + 1)}
      onSubmit={onSubmit}
      onReconcile={onReconcile}
      onReset={onReset}
    />
  );
}
