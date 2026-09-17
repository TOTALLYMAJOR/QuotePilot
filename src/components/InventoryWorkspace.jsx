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
import {
  applyEventSupplyActionPlanCommand,
  buildEventSupplyActionPlanRequestId,
  getEventSupplyActionPlan
} from "../lib/eventSupplyActionPlanClient";
import {
  createInventoryCaptureDraft,
  discardInventoryCaptureDraft,
  listInventoryCaptureDrafts,
  submitInventoryCaptureDraft,
  updateInventoryCaptureDraft
} from "../lib/inventoryCaptureDraft";

const formGridStyle = Object.freeze({
  display: "grid",
  gridTemplateColumns: "repeat(auto-fit, minmax(min(100%, 14rem), 1fr))",
  gap: "var(--space-3, .75rem)"
});

const stackStyle = Object.freeze({
  display: "grid",
  gap: "var(--space-4, 1rem)"
});

const AXES = Object.freeze(["location", "ingredient", "stock", "stock_count", "receiving", "cost", "conversion"]);
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

const SEVEN_DAYS_MS = 7 * 24 * 60 * 60 * 1000;

export function buildInventoryExceptionCards(ingredients, { now = Date.now() } = {}) {
  const cards = [];
  const source = Array.isArray(ingredients) ? ingredients : [];
  source.forEach((ingredient) => {
    const stock = ingredient?.stock;
    const name = ingredient?.name || ingredient?.ingredientId || "Ingredient";
    if (stock?.state === "recorded" && stock.availableToAllocateMicros <= 0) {
      cards.push({ kind: "shortage", priority: 1, ingredientId: ingredient.ingredientId, title: `${name} has no uncommitted stock`, detail: `${stock.quantity} ${stock.unit} physical · ${stock.committedQuantity} ${stock.unit} committed · ${stock.availableToAllocateQuantity} ${stock.unit} available.` });
    }
    const observedAt = Date.parse(ingredient?.updatedAtISO || "");
    if (stock?.state === "recorded" && Number.isFinite(observedAt) && now - observedAt > SEVEN_DAYS_MS) {
      cards.push({ kind: "stale_count", priority: 2, ingredientId: ingredient.ingredientId, title: `${name} needs a fresh shelf count`, detail: `Last server projection ${displayInstant(ingredient.updatedAtISO)}. Review the physical quantity before relying on it.` });
    }
    if (ingredient?.cost?.state !== "recorded") {
      cards.push({ kind: "missing_cost", priority: 3, ingredientId: ingredient.ingredientId, title: `${name} has incomplete cost evidence`, detail: costText(ingredient) });
    }
    if (!Array.isArray(ingredient?.packConversions) || ingredient.packConversions.length === 0) {
      cards.push({ kind: "missing_conversion", priority: 4, ingredientId: ingredient.ingredientId, title: `${name} has no purchase-pack conversion`, detail: `Declare a supplier pack only from explicit pack evidence; do not infer case contents.` });
    }
    if (stock?.state === "recorded" && stock.committedMicros > 0) {
      cards.push({ kind: "contention", priority: 5, ingredientId: ingredient.ingredientId, title: `${name} is committed to event work`, detail: `${stock.committedQuantity} ${stock.unit} is committed. Physical and committed quantities remain separate.` });
    }
  });
  return cards.sort((left, right) => left.priority - right.priority || left.title.localeCompare(right.title));
}

function InventoryExceptionWorkspace({ ingredients, current }) {
  const cards = useMemo(() => buildInventoryExceptionCards(ingredients), [ingredients]);
  return (
    <section className="panel inventory-exception-workspace" data-capability-id="inventory-exception-workspace" data-capability-state={!current ? "stale" : cards.length ? "ready" : "empty"} aria-labelledby="inventory-exceptions-title">
      <p className="eyebrow">Act first</p>
      <h2 id="inventory-exceptions-title">Inventory exceptions</h2>
      <p className="muted">Shortages lead, followed by old counts, incomplete cost, missing pack evidence, and competing commitments.</p>
      {cards.length ? (
        <div className="inventory-exception-grid">
          {cards.map((card) => (
            <article key={`${card.kind}:${card.ingredientId}`} className="inventory-exception-card" data-inventory-exception={card.kind}>
              <p className="eyebrow">Priority {card.priority}</p>
              <h3>{card.title}</h3>
              <p>{card.detail}</p>
            </article>
          ))}
        </div>
      ) : <p className="source-note">No exceptions are visible in the current bounded projection.</p>}
    </section>
  );
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
    <details className="panel staff-evidence-disclosure inventory-ledger-disclosure">
      <summary>Seven-axis inventory ledger</summary>
      <div aria-labelledby="inventory-list-title">
        <p className="eyebrow">Ingredient evidence</p>
        <h2 id="inventory-list-title">Stock and cost by ingredient</h2>
        <p id="inventory-list-description" className="source-note">
          {freshness === "current" ? "Server-confirmed projections." : "Retained projections for orientation only."} Physical, committed, available, cost, location, and conversion evidence remain independent.
        </p>
        <div className="history-table-wrap" data-layout-overflow="bounded">
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
                    <td data-inventory-axis="physical">{stockText(ingredient)}</td>
                    <td data-inventory-axis="committed">{committedStockText(ingredient)}</td>
                    <td data-inventory-axis="available">{availableStockText(ingredient)}</td>
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
      </div>
    </details>
  );
}

function eligibleSupplyEvents(events) {
  return (Array.isArray(events) ? events : []).filter((event) => (
    event?.id && ["accepted", "booked"].includes(String(event.status || "").toLowerCase())
  ));
}

function emptySupplyEdit(shortage) {
  return {
    ingredientId: shortage.ingredientId,
    locationId: shortage.locationId,
    baseUnitId: shortage.baseUnitId,
    shortageQuantity: shortage.shortageQuantity,
    supplierId: "",
    supplierLabel: "",
    purchaseQuantity: shortage.shortageQuantity,
    estimatedCost: "",
    note: "",
    conditionsText: "",
    policyFingerprint: "",
    offerFingerprint: ""
  };
}

function supplyEditFromPlan(edit) {
  return {
    ...edit,
    estimatedCost: edit.estimatedCostMinor === null ? "" : (edit.estimatedCostMinor / 100).toFixed(2),
    conditionsText: (edit.conditions || []).join("\n")
  };
}

function eventLabel(event) {
  return [event.quoteNumber, event.event?.name || event.eventName, event.customer?.name || event.customerName]
    .map((value) => String(value || "").trim()).filter(Boolean).join(" · ") || event.id;
}

function humanizeReference(value) {
  const text = String(value || "").replace(/[-_]+/gu, " ");
  return text ? `${text.charAt(0).toUpperCase()}${text.slice(1)}` : "Ingredient";
}

function moneyMinorOrNull(value) {
  const text = String(value || "").trim();
  if (!text) return null;
  if (!/^(?:0|[1-9]\d*)(?:\.\d{1,2})?$/u.test(text)) throw new Error("Estimated cost must be an exact nonnegative amount with at most two decimals.");
  const [major, fraction = ""] = text.split(".");
  const minor = Number(major) * 100 + Number(fraction.padEnd(2, "0"));
  if (!Number.isSafeInteger(minor)) throw new Error("Estimated cost is too large.");
  return minor;
}

export function EventSupplyActionPlanPanel({
  enabled = false,
  organizationId,
  role = "customer",
  events = [],
  getPlan = getEventSupplyActionPlan,
  applyPlan = applyEventSupplyActionPlanCommand
}) {
  const choices = useMemo(() => eligibleSupplyEvents(events), [events]);
  const [quoteId, setQuoteId] = useState("");
  const [read, setRead] = useState({ state: "empty", value: null, error: "" });
  const [edits, setEdits] = useState([]);
  const [attempt, setAttempt] = useState({ state: "ready", error: "", receipt: null });
  const [approvalChecked, setApprovalChecked] = useState(false);
  const [cancelReason, setCancelReason] = useState("");
  const generation = useRef(0);

  const load = useCallback(async (selectedQuoteId) => {
    if (!selectedQuoteId) {
      setRead({ state: "empty", value: null, error: "" });
      setEdits([]);
      return;
    }
    const current = generation.current + 1;
    generation.current = current;
    setRead({ state: "loading", value: null, error: "" });
    try {
      const value = await getPlan({ organizationId, quoteId: selectedQuoteId, role });
      if (generation.current !== current) return;
      setRead({ state: value.stale ? "stale" : "current", value, error: "" });
      const planned = Array.isArray(value.plan?.edits) && value.plan.edits.length
        ? value.plan.edits.map(supplyEditFromPlan)
        : (value.source?.shortages || []).map(emptySupplyEdit);
      setEdits(planned);
    } catch (error) {
      if (generation.current === current) setRead({ state: "error", value: null, error: safeMessage(error, "The exact supply plan could not be loaded.") });
    }
  }, [getPlan, organizationId, role]);

  useEffect(() => () => { generation.current += 1; }, []);

  if (!enabled) return null;
  const value = read.value;
  const plan = value?.plan;
  const source = value?.source;
  const canEdit = role === "admin" && read.state === "current" && source?.eligible === true;
  const editReady = edits.length > 0 && edits.every((edit) => (
    edit.supplierId.trim() && edit.supplierLabel.trim() && CANONICAL_QUANTITY.test(edit.purchaseQuantity.trim())
    && /^[a-f0-9]{64}$/u.test(edit.policyFingerprint) && /^[a-f0-9]{64}$/u.test(edit.offerFingerprint)
  ));

  const updateEdit = (index, field, nextValue) => setEdits((current) => current.map((edit, editIndex) => (
    editIndex === index ? { ...edit, [field]: nextValue } : edit
  )));

  const commandEdits = () => edits.map((edit) => {
    const estimatedCostMinor = moneyMinorOrNull(edit.estimatedCost);
    return {
      ingredientId: edit.ingredientId,
      locationId: edit.locationId,
      baseUnitId: edit.baseUnitId,
      shortageQuantity: edit.shortageQuantity,
      supplierId: edit.supplierId.trim(),
      supplierLabel: edit.supplierLabel.trim(),
      purchaseQuantity: edit.purchaseQuantity.trim(),
      estimatedCostMinor,
      currency: estimatedCostMinor === null ? null : "USD",
      note: edit.note.trim(),
      conditions: edit.conditionsText.split("\n").map((entry) => entry.trim()).filter(Boolean),
      policyFingerprint: edit.policyFingerprint.trim(),
      offerFingerprint: edit.offerFingerprint.trim()
    };
  });

  const submit = async (kind) => {
    if (!quoteId || !source) return;
    setAttempt({ state: "submitting", error: "", receipt: null });
    try {
      const common = {
        kind,
        quoteId,
        expectedPlanRevision: plan?.planRevision || 0,
        expectedAllocationFingerprint: source.allocationFingerprint,
        expectedShortageFingerprint: source.shortageFingerprint,
        expectedSourceFingerprint: source.sourceFingerprint
      };
      const command = kind === "approve"
        ? { ...common, confirmation: "approve_internal_supply_plan" }
        : kind === "cancel"
          ? { kind, quoteId, expectedPlanRevision: plan?.planRevision || 0, reason: cancelReason.trim() }
          : { ...common, edits: commandEdits() };
      const result = await applyPlan({ organizationId, quoteId, role, requestId: buildEventSupplyActionPlanRequestId(), command });
      setAttempt({ state: "receipt", error: "", receipt: result.receipt });
      setApprovalChecked(false);
      await load(quoteId);
    } catch (error) {
      setAttempt({ state: "error", error: safeMessage(error, "The internal supply plan was not changed."), receipt: null });
    }
  };

  return (
    <section className="panel inventory-supply-plan" data-capability-id="event-supply-action-plan" data-capability-state={attempt.state === "submitting" ? "submitting" : attempt.state === "receipt" ? "receipt" : attempt.state === "error" ? "error" : read.state === "current" ? "ready" : read.state} aria-labelledby="inventory-supply-title">
      <p className="eyebrow">Event shortage response</p>
      <h2 id="inventory-supply-title">Internal supply action plan</h2>
      <p className="muted"><strong>Internal plan only.</strong> This surface does not contact a vendor, create a purchase order or reservation, change stock, or authorize commercial scope.</p>
      <label className="field">
        Accepted or booked event
        <select aria-label="Event supply plan" value={quoteId} onChange={(event) => { const next = event.target.value; setQuoteId(next); setAttempt({ state: "ready", error: "", receipt: null }); load(next); }}>
          <option value="">Select exact event</option>
          {choices.map((event) => <option key={event.id} value={event.id}>{eventLabel(event)}</option>)}
        </select>
      </label>
      {!choices.length && <p className="source-note" data-capability-state="empty">No accepted or booked event is available for internal supply planning.</p>}
      {read.state === "loading" && <p className="status-strip" role="status">Loading exact shortage and plan evidence…</p>}
      {read.state === "error" && <div className="error-note" role="alert"><p>{read.error}</p><button type="button" className="ghost" onClick={() => load(quoteId)}>Try exact plan again</button></div>}
      {value && (
        <div className="inventory-supply-plan-body">
          <div className={value.stale ? "warning-note" : "status-strip"} data-supply-truth={value.stale ? "stale" : value.resolution} role="status">
            Plan: {plan?.status || "not started"} · Resolution: {value.resolution.replaceAll("_", " ")}.
            {value.stale && " Source evidence changed. Rebase before approval."}
          </div>
          {edits.map((edit, index) => (
            <fieldset key={`${edit.ingredientId}:${edit.locationId}`} className="inventory-supply-edit" disabled={!canEdit}>
              <legend>{humanizeReference(edit.ingredientId)} · shortage {edit.shortageQuantity} {edit.baseUnitId}</legend>
              <div style={formGridStyle}>
                <label className="field">Supplier reference<input value={edit.supplierId} onChange={(event) => updateEdit(index, "supplierId", event.target.value)} /></label>
                <label className="field">Supplier label<input value={edit.supplierLabel} onChange={(event) => updateEdit(index, "supplierLabel", event.target.value)} /></label>
                <label className="field">Planned quantity ({edit.baseUnitId})<input inputMode="decimal" value={edit.purchaseQuantity} onChange={(event) => updateEdit(index, "purchaseQuantity", event.target.value)} /></label>
                <label className="field">Estimated cost (USD)<input inputMode="decimal" value={edit.estimatedCost} onChange={(event) => updateEdit(index, "estimatedCost", event.target.value)} /></label>
              </div>
              <label className="field">Internal note<textarea maxLength={500} value={edit.note} onChange={(event) => updateEdit(index, "note", event.target.value)} /></label>
              <label className="field">Conditions, one per line<textarea maxLength={1800} value={edit.conditionsText} onChange={(event) => updateEdit(index, "conditionsText", event.target.value)} /></label>
              <details className="staff-evidence-disclosure"><summary>Exact policy and offer evidence</summary>
                <label className="field">Policy fingerprint<input maxLength={64} value={edit.policyFingerprint} onChange={(event) => updateEdit(index, "policyFingerprint", event.target.value)} /></label>
                <label className="field">Offer fingerprint<input maxLength={64} value={edit.offerFingerprint} onChange={(event) => updateEdit(index, "offerFingerprint", event.target.value)} /></label>
              </details>
            </fieldset>
          ))}
          {canEdit && edits.length > 0 && (
            <div className="inventory-action-row" role="group" aria-label="Supply plan actions">
              <button type="button" className="ghost" data-supply-command={value.stale ? "rebase" : "save_draft"} disabled={!editReady || attempt.state === "submitting"} onClick={() => submit(value.stale ? "rebase" : "save_draft")}>{value.stale ? "Rebase reviewed plan" : "Save internal draft"}</button>
              <label className="inventory-approval-check"><input type="checkbox" checked={approvalChecked} disabled={plan?.status !== "draft" || value.stale} onChange={(event) => setApprovalChecked(event.target.checked)} /> I approve this internal plan for the exact current evidence.</label>
              <button type="button" className="cta" data-supply-command="approve" disabled={!approvalChecked || plan?.status !== "draft" || value.stale || attempt.state === "submitting"} onClick={() => submit("approve")}>Approve internal plan</button>
              {plan && plan.status !== "cancelled" && <><label className="field">Cancellation reason<input value={cancelReason} onChange={(event) => setCancelReason(event.target.value)} /></label><button type="button" className="ghost" data-supply-command="cancel" disabled={!cancelReason.trim() || attempt.state === "submitting"} onClick={() => submit("cancel")}>Cancel plan</button></>}
            </div>
          )}
          {attempt.state === "submitting" && <p className="status-strip" role="status">Submitting the exact internal-plan command…</p>}
          {attempt.state === "receipt" && <p className="status-strip" data-capability-state="receipt" role="status">Command receipt recorded. Refreshed plan truth is shown above.</p>}
          {attempt.state === "error" && <p className="error-note" role="alert">{attempt.error}</p>}
        </div>
      )}
    </section>
  );
}

const DEFAULT_DRAFT_SERVICE = Object.freeze({
  create: createInventoryCaptureDraft,
  update: updateInventoryCaptureDraft,
  list: listInventoryCaptureDrafts,
  discard: discardInventoryCaptureDraft,
  submit: submitInventoryCaptureDraft
});

export function InventoryMobileCapturePanel({
  enabled = false,
  organizationId,
  userId,
  role = "customer",
  browserEnabled = false,
  tenantEnabled = false,
  locations = [],
  ingredients = [],
  submitCommand = applyInventoryCommand,
  draftService = DEFAULT_DRAFT_SERVICE
}) {
  const [online, setOnline] = useState(() => typeof navigator === "undefined" || navigator.onLine !== false);
  const [locationId, setLocationId] = useState(locations[0]?.locationId || "");
  const [draft, setDraft] = useState(null);
  const [queryText, setQueryText] = useState("");
  const [counts, setCounts] = useState({});
  const [notes, setNotes] = useState({});
  const [state, setState] = useState({ kind: "loading", message: "Loading device drafts…" });
  const [scanBusy, setScanBusy] = useState(false);
  const fileRef = useRef(null);
  const scopeReady = enabled && organizationId && userId && locationId;

  useEffect(() => {
    if (!locations.some((location) => location.locationId === locationId)) {
      setLocationId(locations[0]?.locationId || "");
    }
  }, [locationId, locations]);

  const refresh = useCallback(async () => {
    if (!scopeReady) return;
    setState({ kind: "loading", message: "Loading device drafts…" });
    try {
      const drafts = await draftService.list({ organizationId, userId, locationId });
      setDraft(drafts[0] || null);
      setState({ kind: drafts.length ? "draft" : "empty", message: drafts.length ? "Device draft loaded." : "No shelf-count draft at this location." });
    } catch (error) {
      setState({ kind: "error", message: safeMessage(error, "Durable device draft storage is unavailable.") });
    }
  }, [draftService, locationId, organizationId, scopeReady, userId]);

  useEffect(() => { refresh(); }, [refresh]);
  useEffect(() => {
    const handleOnline = () => setOnline(true);
    const handleOffline = () => setOnline(false);
    window.addEventListener("online", handleOnline);
    window.addEventListener("offline", handleOffline);
    return () => { window.removeEventListener("online", handleOnline); window.removeEventListener("offline", handleOffline); };
  }, []);

  if (!enabled) return null;
  const normalizedQuery = queryText.trim().toLocaleLowerCase("en-US");
  const results = ingredients.filter((ingredient) => ingredient.active !== false && ingredient.stock?.revision > 0 && (
    !normalizedQuery || ingredient.name.toLocaleLowerCase("en-US").includes(normalizedQuery)
    || ingredient.ingredientId.toLocaleLowerCase("en-US").includes(normalizedQuery)
  )).slice(0, 20);

  const saveLine = async (ingredient) => {
    const countedQuantity = String(counts[ingredient.ingredientId] || "").trim();
    if (!CANONICAL_QUANTITY.test(countedQuantity)) {
      setState({ kind: "error", message: "Enter a nonnegative count with no more than six decimal places." });
      return;
    }
    try {
      let current = draft;
      if (!current) {
        current = await draftService.create({ organizationId, userId, locationId, draftId: `shelf-${Date.now()}`, lines: [] });
      }
      const line = {
        lineId: `count-${ingredient.ingredientId}`,
        ingredientId: ingredient.ingredientId,
        ingredientName: ingredient.name,
        baseUnitId: ingredient.baseUnitId,
        countedQuantity,
        note: String(notes[ingredient.ingredientId] || "").trim(),
        occurredAtISO: new Date().toISOString(),
        expectedStockRevision: ingredient.stock?.revision || 0,
        state: "draft"
      };
      const lines = [...current.lines.filter((entry) => entry.ingredientId !== ingredient.ingredientId), line];
      current = await draftService.update({ organizationId, userId, locationId, draftId: current.draftId, lines });
      setDraft(current);
      setState({ kind: "draft", message: "Count saved on this device only." });
    } catch (error) {
      setState({ kind: "error", message: safeMessage(error, "The device draft could not be saved.") });
    }
  };

  const submit = async () => {
    if (!draft) return;
    setState({ kind: "submitting", message: "Comparing stock revisions and submitting clean lines…" });
    try {
      const current = await draftService.submit({
        organizationId,
        userId,
        locationId,
        draftId: draft.draftId,
        online,
        currentStockRevisions: Object.fromEntries(ingredients.map((ingredient) => [ingredient.ingredientId, ingredient.stock?.revision || 0])),
        submitLine: (command) => submitCommand({
          organizationId,
          role,
          browserEnabled,
          tenantEnabled,
          requestId: buildInventoryRequestId(),
          command
        })
      });
      setDraft(current);
      setState({ kind: current.status === "submitted" ? "receipt" : "partial", message: current.status === "submitted" ? "Every line has an authoritative receipt." : "Clean lines were submitted independently; conflicts and failures remain in this device draft." });
    } catch (error) {
      setState({ kind: error?.code === "offline" ? "offline" : "error", message: safeMessage(error, "The device draft was retained for recovery.") });
    }
  };

  const recoverLine = async (line) => {
    const ingredient = ingredients.find((entry) => entry.ingredientId === line.ingredientId);
    if (!ingredient || !draft) return;
    const lines = draft.lines.map((entry) => entry.lineId === line.lineId ? {
      ...entry,
      expectedStockRevision: ingredient.stock.revision,
      state: "draft",
      error: "",
      currentStockRevision: null
    } : entry);
    try {
      const current = await draftService.update({ organizationId, userId, locationId, draftId: draft.draftId, lines });
      setDraft(current);
      setState({ kind: "draft", message: `${ingredient.name} was rebased to the current stock revision. Review before submitting.` });
    } catch (error) {
      setState({ kind: "error", message: safeMessage(error) });
    }
  };

  const discard = async () => {
    if (!draft) return;
    try {
      await draftService.discard({ organizationId, userId, locationId, draftId: draft.draftId });
      setDraft(null);
      setState({ kind: "empty", message: "Device draft discarded." });
    } catch (error) {
      setState({ kind: "error", message: safeMessage(error) });
    }
  };

  const detectBarcode = async (file) => {
    if (!file || typeof globalThis.BarcodeDetector !== "function") return;
    setScanBusy(true);
    try {
      const detector = new globalThis.BarcodeDetector();
      const codes = await detector.detect(file);
      setQueryText(String(codes?.[0]?.rawValue || ""));
      setState({ kind: codes?.length ? "draft" : "empty", message: codes?.length ? "Barcode placed in search. Confirm the exact ingredient." : "No barcode was detected. Use manual search." });
    } catch {
      setState({ kind: "error", message: "Barcode capture was unavailable. Use manual search." });
    } finally {
      setScanBusy(false);
    }
  };

  return (
    <section className="panel inventory-mobile-capture" data-capability-id="inventory-mobile-capture" data-capability-state={state.kind === "draft" ? "ready" : state.kind === "partial" ? "recovery" : state.kind === "offline" ? "stale" : state.kind} aria-labelledby="inventory-capture-title">
      <p className="eyebrow">Walk the shelf</p>
      <h2 id="inventory-capture-title">Device stock-count draft</h2>
      <p className="muted">Manual search is always available. Drafts stay on this device for up to seven days and do not claim server persistence.</p>
      <label className="field">Stock location<select value={locationId} onChange={(event) => { setLocationId(event.target.value); setDraft(null); }}><option value="">Select location</option>{locations.map((location) => <option key={location.locationId} value={location.locationId}>{location.name}</option>)}</select></label>
      <div className={online ? "status-strip" : "warning-note"} role="status">{online ? state.message : "Offline: counts are local device truth only. Reconnect to compare stock revisions."}</div>
      <label className="field">Search first<input type="search" aria-label="Search shelf ingredients" value={queryText} onChange={(event) => setQueryText(event.target.value)} placeholder="Ingredient name or reference" /></label>
      {typeof globalThis.BarcodeDetector === "function" && <><input ref={fileRef} className="sr-only" type="file" accept="image/*" capture="environment" aria-label="Barcode image" onChange={(event) => detectBarcode(event.target.files?.[0])} /><button type="button" className="ghost" disabled={scanBusy} onClick={() => fileRef.current?.click()}>{scanBusy ? "Reading barcode…" : "Scan barcode"}</button></>}
      <div className="inventory-capture-results" aria-label="Shelf search results">
        {results.map((ingredient) => (
          <article key={ingredient.ingredientId} className="inventory-capture-row">
            <div><h3>{ingredient.name}</h3><p className="source-note">Current revision {ingredient.stock?.revision || "unavailable"} · {stockText(ingredient)}</p></div>
            <label className="field">Count ({ingredient.baseUnitId})<input inputMode="decimal" value={counts[ingredient.ingredientId] || ""} onChange={(event) => setCounts((current) => ({ ...current, [ingredient.ingredientId]: event.target.value }))} /></label>
            <label className="field">Note <span className="source-note">optional</span><input maxLength={240} value={notes[ingredient.ingredientId] || ""} onChange={(event) => setNotes((current) => ({ ...current, [ingredient.ingredientId]: event.target.value }))} /></label>
            <button type="button" className="ghost" onClick={() => saveLine(ingredient)}>Save count to device</button>
          </article>
        ))}
      </div>
      {draft?.lines?.length > 0 && <div className="inventory-capture-draft-lines"><h3>Draft lines</h3><ul className="plain-list">{draft.lines.map((line) => <li key={line.lineId} data-capture-line-state={line.state}><strong>{line.ingredientName}: {line.countedQuantity} {line.baseUnitId}</strong> · {line.state}{line.receiptId && ` · receipt ${line.receiptId}`}{line.error && <span> · {line.error}</span>}{["conflict", "error"].includes(line.state) && <button type="button" className="ghost" onClick={() => recoverLine(line)}>Review against current revision</button>}</li>)}</ul></div>}
      <div className="inventory-action-row"><button type="button" className="cta" disabled={!draft?.lines?.some((line) => line.state !== "submitted") || !online || state.kind === "submitting"} onClick={submit}>Submit clean counts</button><button type="button" className="ghost" disabled={!draft || state.kind === "submitting"} onClick={discard}>Discard device draft</button></div>
      <p className="source-note">No cold offline launch is promised. Successful lines record independent stock-count receipts; failures and conflicts remain local until reviewed.</p>
    </section>
  );
}

export function InventoryWorkspaceView({
  access,
  read,
  attempts,
  exceptionWorkspaceEnabled = false,
  eventSupplyActionPlanEnabled = false,
  inventoryMobileCaptureEnabled = false,
  supplyPlanProps = {},
  mobileCaptureProps = {},
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
          {exceptionWorkspaceEnabled && (
            <InventoryExceptionWorkspace ingredients={ingredients} current={read.state === "current" && sourcesCurrent} />
          )}
          {eventSupplyActionPlanEnabled && <EventSupplyActionPlanPanel enabled {...supplyPlanProps} />}
          {inventoryMobileCaptureEnabled && (
            <InventoryMobileCapturePanel
              enabled
              locations={locations}
              ingredients={ingredients}
              {...mobileCaptureProps}
            />
          )}
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
  userId = "",
  role = "customer",
  browserEnabled = false,
  tenantEnabled = false,
  events = [],
  exceptionWorkspaceEnabled = false,
  eventSupplyActionPlanEnabled = false,
  inventoryMobileCaptureEnabled = false,
  getSupplyPlan = getEventSupplyActionPlan,
  applySupplyPlan = applyEventSupplyActionPlanCommand,
  draftService = DEFAULT_DRAFT_SERVICE,
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
      exceptionWorkspaceEnabled={exceptionWorkspaceEnabled}
      eventSupplyActionPlanEnabled={eventSupplyActionPlanEnabled && access.readEnabled}
      inventoryMobileCaptureEnabled={inventoryMobileCaptureEnabled && access.mutationEnabled}
      supplyPlanProps={{
        organizationId,
        role,
        events,
        getPlan: getSupplyPlan,
        applyPlan: applySupplyPlan
      }}
      mobileCaptureProps={{
        organizationId,
        userId,
        role,
        browserEnabled,
        tenantEnabled,
        submitCommand,
        draftService
      }}
      onRetry={() => setRetryGeneration((value) => value + 1)}
      onSubmit={onSubmit}
      onReconcile={onReconcile}
      onReset={onReset}
    />
  );
}
