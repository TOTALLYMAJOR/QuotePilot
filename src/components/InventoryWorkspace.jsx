import { Fragment, useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from "react";
import {
  applyInventoryCommand,
  buildInventoryRequestId,
  getInventoryCostDependencyPreflight,
  getInventoryIngredientTrace,
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

const INVENTORY_EXCEPTION_BUILD_ENABLED = import.meta.env.MODE === "test"
  || import.meta.env.DEV
  || import.meta.env.VITE_INVENTORY_EXCEPTION_WORKSPACE_ENABLED === "true";
const EVENT_SUPPLY_PLAN_BUILD_ENABLED = import.meta.env.MODE === "test"
  || import.meta.env.DEV
  || import.meta.env.VITE_EVENT_SUPPLY_ACTION_PLAN_ENABLED === "true";
const INVENTORY_CAPTURE_BUILD_ENABLED = import.meta.env.MODE === "test"
  || import.meta.env.DEV
  || import.meta.env.VITE_INVENTORY_MOBILE_CAPTURE_ENABLED === "true";
const INVENTORY_CONFIDENCE_BUILD_ENABLED = INVENTORY_EXCEPTION_BUILD_ENABLED
  || EVENT_SUPPLY_PLAN_BUILD_ENABLED
  || INVENTORY_CAPTURE_BUILD_ENABLED;
import {
  reconcileInventoryReceivingLine,
  retryInventoryReceivingLine,
  submitInventoryReceivingBatch
} from "../lib/inventoryReceivingBatch";
import { markRouteStage } from "../lib/routePerformance";
import InventoryReceivingBatch from "./InventoryReceivingBatch";
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

function ingredientTraceFence(ingredient) {
  return [
    ingredient?.ingredientRevision || 0,
    ingredient?.stock?.revision || 0,
    ingredient?.stock?.allocationRevision || 0
  ].join(":");
}

function scaledQuantity(value) {
  const candidate = String(value || "").trim();
  if (!CANONICAL_QUANTITY.test(candidate)) throw new Error("Enter a quantity with no more than six decimal places.");
  const [whole, fraction = ""] = candidate.split(".");
  return (BigInt(whole) * 1_000_000n) + BigInt(fraction.padEnd(6, "0"));
}

function displayScaledQuantity(value) {
  const whole = value / 1_000_000n;
  const fraction = String(value % 1_000_000n).padStart(6, "0").replace(/0+$/u, "");
  return fraction ? `${whole}.${fraction}` : String(whole);
}

function multiplyCanonicalQuantities(left, right) {
  const product = scaledQuantity(left) * scaledQuantity(right);
  if (product % 1_000_000n !== 0n) {
    throw new Error("This pack conversion exceeds six decimal places in the base unit.");
  }
  return displayScaledQuantity(product / 1_000_000n);
}

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

function InventoryExceptionWorkspaceImpl({ ingredients, current }) {
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

function ingredientHasException(ingredient, exception) {
  const stockState = String(ingredient?.stock?.state || "not_recorded");
  const costState = String(ingredient?.cost?.state || "not_recorded");
  if (exception === "missing-stock") return stockState === "not_recorded";
  if (exception === "missing-cost") return costState === "not_recorded";
  if (exception === "unavailable") {
    return !["recorded", "not_recorded"].includes(stockState)
      || !["recorded", "not_recorded"].includes(costState);
  }
  return true;
}

function compareIngredientName(left, right) {
  return String(left?.name || "").localeCompare(String(right?.name || ""), undefined, { sensitivity: "base" })
    || String(left?.ingredientId || "").localeCompare(String(right?.ingredientId || ""));
}

function compareIngredientQuantity(left, right, direction) {
  const leftUnit = String(left?.stock?.unit || left?.baseUnitId || "");
  const rightUnit = String(right?.stock?.unit || right?.baseUnitId || "");
  const unitOrder = leftUnit.localeCompare(rightUnit);
  if (unitOrder) return unitOrder;
  const leftRecorded = left?.stock?.state === "recorded";
  const rightRecorded = right?.stock?.state === "recorded";
  if (leftRecorded !== rightRecorded) return leftRecorded ? -1 : 1;
  if (leftRecorded && rightRecorded) {
    try {
      const leftQuantity = scaledQuantity(left.stock.quantity);
      const rightQuantity = scaledQuantity(right.stock.quantity);
      if (leftQuantity !== rightQuantity) return (leftQuantity < rightQuantity ? -1 : 1) * direction;
    } catch {
      // Validated projections should be canonical; retained malformed evidence falls back to stable identity.
    }
  }
  return compareIngredientName(left, right);}

function EvidenceSourceState({ label, state, bounded = false }) {
  return (
    <li>
      <strong>{label}:</strong> {sourceStateLabel(state)}
      {bounded ? " · bounded page of up to 200 ingredients" : ""}
    </li>
  );
}

function movementSummaryText(movement) {
  if (movement.kind === "opening_balance") return `Opened with ${movement.quantity} ${movement.baseUnitId}`;
  if (movement.kind === "receive_stock") return `Received ${movement.quantity} ${movement.baseUnitId}`;
  if (movement.kind === "event_depletion") {
    return `Used ${movement.consumedQuantity} ${movement.baseUnitId}; waste ${movement.wasteQuantity} ${movement.baseUnitId}`;
  }
  return movement.direction === "increase"
    ? `Corrected stock up by ${movement.quantity} ${movement.baseUnitId}`
    : `Corrected stock down by ${movement.quantity} ${movement.baseUnitId}`;
}

function IngredientTraceDisclosure({ ingredient, trace, onOpen, onRetry, onLoadMore }) {
  const state = trace?.state || "idle";
  const data = trace?.data || null;
  const error = trace?.error || "";
  const retrying = state === "loading" && trace?.retrying === true;
  const loadMore = state === "loading" && trace?.loadingMore === true;
  return (
    <details
      data-inventory-trace={ingredient.ingredientId}
      onToggle={(event) => {
        if (event.currentTarget.open && state === "idle") onOpen?.(ingredient);
      }}
    >
      <summary>Movement history and commitments for {ingredient.name}</summary>
      {state === "loading" && !data && !retrying && (
        <p className="source-note" role="status">Loading movement history and event commitments…</p>
      )}
      {error && (
        <div className="error-note" role="alert">
          <p>{error}</p>
          <button
            className="ghost"
            type="button"
            aria-label={`Retry ${ingredient.name} movement history and commitments`}
            aria-disabled={retrying ? "true" : "false"}
            onClick={() => {
              if (!retrying) onRetry?.(ingredient, trace?.retryCursor || null);
            }}
          >
            {retrying ? "Retrying movement history and event commitments…" : "Retry this ingredient trace"}
          </button>
        </div>
      )}
      {data && (
        <div data-inventory-trace-state={state === "partial" ? "partial" : "current"}>
          <h3>Movement history</h3>
          {data.movements.length ? (
            <ol className="plain-list">
              {data.movements.map((movement) => (
                <li key={movement.movementId}>
                  <strong>{movementSummaryText(movement)}</strong>
                  <span className="source-note"> · occurred {displayInstant(movement.occurredAtISO)}</span>
                  {movement.sourceLabel && <span className="source-note"> · {movement.sourceLabel}</span>}
                  {movement.quoteId && <span className="source-note"> · event {movement.quoteId}</span>}
                  <details>
                    <summary>Exact receipt</summary>
                    <code>{movement.receiptId}</code>
                  </details>
                </li>
              ))}
            </ol>
          ) : <p className="source-note">No verified stock movements are recorded for this ingredient.</p>}
          {data.movementPage.hasNext && (
            <button
              className="ghost"
              type="button"
              aria-disabled={loadMore ? "true" : "false"}
              onClick={() => {
                if (!loadMore) onLoadMore?.(ingredient, data.movementPage.nextCursor);
              }}
            >
              {loadMore ? "Loading earlier movements…" : "Load earlier movements"}
            </button>
          )}
          <h3>Event commitments</h3>
          <p>
            <strong>{data.commitments.totalQuantity} {data.baseUnitId} committed across {data.commitments.rows.length} {data.commitments.rows.length === 1 ? "event" : "events"}</strong>
          </p>
          {data.commitments.rows.length ? (
            <ul className="plain-list">
              {data.commitments.rows.map((commitment) => (
                <li key={commitment.eventPlanId}>
                  <strong>{commitment.quoteId}</strong> · {commitment.allocatedQuantity} {data.baseUnitId} · required {displayInstant(commitment.requiredByISO)}
                  <details>
                    <summary>Exact event plan</summary>
                    <code>{commitment.eventPlanId}</code>
                    <span className="source-note"> · requirement {commitment.eventRequirementRevisionId}</span>
                  </details>
                </li>
              ))}
            </ul>
          ) : <p className="source-note">No event currently commits this ingredient.</p>}
          <p className="source-note">Commitment rows reconcile to {data.commitments.totalQuantity} {data.baseUnitId} in allocation fence revision {data.commitments.fenceRevision}.</p>
        </div>
      )}
    </details>
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

function attemptLabel(axis) {
  return axis === "stock"
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
}

function AttemptState({ axis, attempt, onReconcile, onReset }) {
  const label = attemptLabel(axis);
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

function InventoryRecoveryQueue({ attempts, onReconcile, onReset }) {
  const unresolved = AXES
    .map((axis) => ({ axis, attempt: attempts[axis] || initialAttempt() }))
    .filter(({ attempt }) => ["uncertain", "reconciliation", "error"].includes(attempt.state));
  if (!unresolved.length) return null;
  return (
    <section className="panel inventory-recovery-queue" data-inventory-recovery-queue aria-labelledby="inventory-recovery-title">
      <p className="eyebrow">Recovery queue</p>
      <h2 id="inventory-recovery-title">Resolve original inventory requests</h2>
      <p className="muted">Reconcile each exact request before submitting replacement evidence.</p>
      <ul className="plain-list">
        {unresolved.map(({ axis, attempt }) => (
          <li key={`${axis}:${attempt.requestId}`} data-inventory-recovery-axis={axis}>
            <div>
              <strong>{attemptLabel(axis)}</strong>
              <span>{attempt.error || "This request still needs review."}</span>
              {attempt.requestId && (
                <details>
                  <summary>Exact request identity</summary>
                  <code>{attempt.requestId}</code>
                </details>
              )}
            </div>
            {attempt.state === "reconciliation" ? (
              <span role="status">Checking original request…</span>
            ) : attempt.state === "uncertain" ? (
              <button className="ghost" type="button" onClick={() => onReconcile(axis)}>Check exact request</button>
            ) : (
              <button className="ghost" type="button" onClick={() => onReset(axis)}>Review before a new request</button>
            )}
          </li>
        ))}
      </ul>
    </section>
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

function InventoryChoiceField({
  label,
  ariaLabel,
  options,
  value,
  disabled,
  onChange,
  emptyMessage
}) {
  if (!options.length) {
    return (
      <div className="field inventory-choice" data-inventory-choice-state="zero">
        <span>{label}</span>
        <p className="source-note" role="note">{emptyMessage}</p>
      </div>
    );
  }
  if (options.length === 1) {
    return (
      <div className="field inventory-choice" data-inventory-choice-state="one" data-inventory-choice-value={options[0].value}>
        <span>{label}</span>
        <strong>{options[0].label}</strong>
        <span className="source-note">Only one eligible choice is available.</span>
      </div>
    );
  }
  return (
    <label className="field" data-inventory-choice-state="many">
      {label}
      <select required aria-label={ariaLabel} value={value} disabled={disabled} onChange={onChange}>
        {options.map((option) => <option key={option.value} value={option.value}>{option.label}</option>)}
      </select>
    </label>
  );
}

function EvidenceForms({
  ingredients,
  locations,
  current,
  attempts,
  activeTask = "browse",
  selectedEvidenceIngredientId = "",
  selectedReceivingIngredientId = "",
  onReceivingIngredientChange,
  onPreviewCostDependencies,
  onSubmit,
  onReconcile,
  onReset,
  receivingBatchScopeKey,
  projectionModel,
  onSubmitReceivingBatch,
  onReconcileReceivingLine,
  onRetryReceivingLine,
  receivingConfirmsReceipt
}) {
  const activeIngredients = ingredients.filter((entry) => entry.active);
  const activeIngredientOptions = activeIngredients.map((entry) => ({
    value: entry.ingredientId,
    label: `${entry.name} · ${entry.baseUnitId}`
  }));
  const locationOptions = locations.map((entry) => ({ value: entry.locationId, label: entry.name }));
  const receivableIngredients = activeIngredients.filter((entry) => entry.stock?.state === "recorded");
  const receivableIngredientOptions = receivableIngredients.map((entry) => ({
    value: entry.ingredientId,
    label: `${entry.name} · ${entry.baseUnitId}`
  }));
  const receivingAttempt = attempts.receiving || initialAttempt();
  const [stockIngredientId, setStockIngredientId] = useState("");
  const [stockLocationId, setStockLocationId] = useState("");
  const [quantity, setQuantity] = useState("");
  const [stockOccurredAt, setStockOccurredAt] = useState("");
  const [stockNote, setStockNote] = useState("");
  const [receivingIngredientId, setReceivingIngredientId] = useState(selectedReceivingIngredientId);
  const [receivingUnitId, setReceivingUnitId] = useState("base");
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
  const [costDependencyReview, setCostDependencyReview] = useState({ state: "idle", message: "" });
  const costDependencyRequestRef = useRef(0);
  const costDependencyFocusRef = useRef(null);

  useEffect(() => {
    if (!activeIngredients.some((entry) => entry.ingredientId === stockIngredientId)) {
      setStockIngredientId(activeIngredients[0]?.ingredientId || "");
    }
    if (!activeIngredients.some((entry) => entry.ingredientId === costIngredientId)) {
      setCostIngredientId(activeIngredients[0]?.ingredientId || "");
    }
    if (selectedReceivingIngredientId && receivableIngredients.some((entry) => entry.ingredientId === selectedReceivingIngredientId)) {
      if (receivingIngredientId !== selectedReceivingIngredientId) setReceivingIngredientId(selectedReceivingIngredientId);
    } else if (!receivableIngredients.some((entry) => entry.ingredientId === receivingIngredientId)) {
      setReceivingIngredientId(receivableIngredients[0]?.ingredientId || "");
    }
  }, [activeIngredients, costIngredientId, receivableIngredients, receivingIngredientId, selectedReceivingIngredientId, stockIngredientId]);

  useEffect(() => {
    if (!selectedEvidenceIngredientId || !activeIngredients.some((entry) => entry.ingredientId === selectedEvidenceIngredientId)) return;
    if (activeTask === "opening" && stockIngredientId !== selectedEvidenceIngredientId) {
      setStockIngredientId(selectedEvidenceIngredientId);
    }
    if (activeTask === "cost" && costIngredientId !== selectedEvidenceIngredientId) {
      setCostIngredientId(selectedEvidenceIngredientId);
    }
  }, [activeIngredients, activeTask, costIngredientId, selectedEvidenceIngredientId, stockIngredientId]);

  useEffect(() => {
    if (!locations.some((entry) => entry.locationId === stockLocationId)) setStockLocationId(locations[0]?.locationId || "");
  }, [locations, stockLocationId]);

  const stockIngredient = activeIngredients.find((entry) => entry.ingredientId === stockIngredientId);
  const costIngredient = activeIngredients.find((entry) => entry.ingredientId === costIngredientId);
  const receivingIngredient = activeIngredients.find((entry) => entry.ingredientId === receivingIngredientId);
  useEffect(() => {
    const recordedLocationId = receivingIngredient?.stock?.locationId || "";
    if (recordedLocationId !== receivingLocationId) setReceivingLocationId(recordedLocationId);
    if (receivingUnitId !== "base" && !receivingIngredient?.packConversions?.some((pack) => pack.packUnitId === receivingUnitId)) {
      setReceivingUnitId("base");
    }
  }, [receivingIngredient, receivingLocationId, receivingUnitId]);
  const receivingPack = receivingIngredient?.packConversions?.find((pack) => pack.packUnitId === receivingUnitId) || null;
  let receivingBaseQuantity = receivingQuantity.trim();
  let receivingConversionError = "";
  if (receivingPack && receivingBaseQuantity) {
    try {
      receivingBaseQuantity = multiplyCanonicalQuantities(receivingBaseQuantity, receivingPack.baseQuantity);
    } catch (error) {
      receivingConversionError = safeMessage(error, "This purchase pack cannot be converted exactly.");
    }
  }
  const stockDisabled = !current || axisLocked(attempts.stock);
  const costReviewBusy = costDependencyReview.state === "loading";
  const costDisabled = !current || axisLocked(attempts.cost) || costReviewBusy;
  const receivingDisabled = !current || axisLocked(receivingAttempt) || !receivingIngredient;
  const costDraftFingerprint = JSON.stringify({
    ingredientId: costIngredientId,
    ingredientRevision: costIngredient?.ingredientRevision || 0,
    baseUnitId: costIngredient?.baseUnitId || "",
    availability: costAvailability,
    totalCost,
    currency,
    basisQuantity,
    costOccurredAt,
    provenance,
    costNote,
    expectedCostRevision: costIngredient?.cost?.revision || 0
  });
  useEffect(() => {
    costDependencyRequestRef.current += 1;
    setCostDependencyReview({ state: "idle", message: "" });
  }, [costDraftFingerprint]);
  useEffect(() => {
    if (!new Set(["ready", "error", "stale"]).has(costDependencyReview.state)) return;
    costDependencyFocusRef.current?.focus();
  }, [costDependencyReview.state]);
  useEffect(() => {
    if (attempts.cost?.state === "error"
      && /dependency evidence changed/iu.test(attempts.cost.error || "")) {
      setCostDependencyReview({
        state: "stale",
        message: "Dependency evidence changed. Review the affected menu items again before recording cost evidence."
      });
    } else if (new Set(["receipt", "committed"]).has(attempts.cost?.state)) {
      setCostDependencyReview({ state: "idle", message: "" });
    }
  }, [attempts.cost?.error, attempts.cost?.state]);

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

  const submitCost = async (event) => {
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
    const command = costAvailability === "available" ? {
      ...common,
      basisQuantity: basisQuantity.trim(),
      totalCostMinor,
      currency: currency.trim().toUpperCase()
    } : common;
    if (costDependencyReview.state !== "ready"
      || costDependencyReview.draftFingerprint !== costDraftFingerprint) {
      const requestId = costDependencyRequestRef.current + 1;
      costDependencyRequestRef.current = requestId;
      setCostDependencyReview({ state: "loading", message: "Reviewing affected menu items…" });
      try {
        const result = await onPreviewCostDependencies({
          command,
          expectedIngredientRevision: costIngredient?.ingredientRevision || 0
        });
        if (costDependencyRequestRef.current !== requestId) return;
        setCostDependencyReview({
          state: "ready",
          message: result.affectedMenuItems.length
            ? "Review the exact menu items whose ingredient cost projections will be refreshed."
            : "No menu items currently use this ingredient.",
          evidence: result,
          draftFingerprint: costDraftFingerprint
        });
      } catch (error) {
        if (costDependencyRequestRef.current !== requestId) return;
        setCostDependencyReview({
          state: "error",
          message: safeMessage(error, "Affected menu items are unavailable. Retry before recording cost evidence.")
        });
      }
      return;
    }
    onSubmit("cost", {
      ...command,
      dependencyPreflightDigest: costDependencyReview.evidence.dependencyPreflightDigest
    });
  };

  const submitReceiving = (event) => {
    event.preventDefault();
    if (!CANONICAL_QUANTITY.test(receivingQuantity.trim()) || /^0(?:\.0{1,6})?$/u.test(receivingQuantity.trim())) {
      setReceivingInputError("Enter a positive received quantity with no more than six decimal places.");
      return;
    }
    if (receivingConversionError) {
      setReceivingInputError(receivingConversionError);
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
      quantity: receivingBaseQuantity,
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
        <div className="panel" data-inventory-task-panel="opening" hidden={activeTask !== "opening"} data-inventory-axis="stock" data-capability-state={attempts.stock.state}>
          <h3>Opening stock</h3>
          <p className="muted">Record the physical count in the ingredient’s base unit.</p>
          <form className="workspace-field-form" aria-label="Record opening stock" data-inventory-command="opening_balance" onSubmit={submitStock} style={stackStyle}>
            <InventoryChoiceField
              label="Ingredient"
              ariaLabel="Opening stock ingredient"
              options={activeIngredientOptions}
              value={stockIngredientId}
              disabled={stockDisabled}
              onChange={(event) => setStockIngredientId(event.target.value)}
              emptyMessage="Add an active ingredient before recording opening stock."
            />
            <InventoryChoiceField
              label="Stock location"
              ariaLabel="Opening stock location"
              options={locationOptions}
              value={stockLocationId}
              disabled={stockDisabled}
              onChange={(event) => setStockLocationId(event.target.value)}
              emptyMessage="Create a stock location before recording opening stock."
            />
            <label className="field" data-field-width="numeric">
              Opening quantity ({stockIngredient?.baseUnitId || "base unit"})
              <input id="inventory-opening-quantity" required inputMode="decimal" placeholder="40" value={quantity} disabled={stockDisabled} onChange={(event) => setQuantity(event.target.value)} />
            </label>
            <label className="field" data-field-width="datetime">
              Count effective at
              <input required type="datetime-local" value={stockOccurredAt} disabled={stockDisabled} onChange={(event) => setStockOccurredAt(event.target.value)} />
            </label>
            <label className="field" data-field-width="note">
              Count note
              <textarea required rows="2" maxLength={240} value={stockNote} disabled={stockDisabled} onChange={(event) => setStockNote(event.target.value)} />
            </label>
            <button className="cta" type="submit" disabled={stockDisabled || !stockIngredientId || !stockLocationId || !quantity.trim() || !stockOccurredAt || !stockNote.trim()}>Record opening stock</button>
          </form>
          <AttemptState axis="stock" attempt={attempts.stock} onReconcile={onReconcile} onReset={onReset} />
        </div>

        <div className="panel" data-inventory-task-panel="receiving" hidden={activeTask !== "receiving"} data-inventory-axis="receiving" data-capability-state={receivingAttempt.state}>
          <h3>Receive ingredient stock</h3>
          <p className="muted">Add a confirmed delivery to physical on-hand stock and record its observed total cost—or explicitly leave cost unknown.</p>
          {receivingIngredient ? (
            <form className="workspace-field-form" aria-label="Receive ingredient stock" data-inventory-command="receive_stock" onSubmit={submitReceiving} style={stackStyle}>
              <InventoryChoiceField
                label="Ingredient"
                ariaLabel="Receiving ingredient"
                options={receivableIngredientOptions}
                value={receivingIngredientId}
                disabled={receivingDisabled}
                onChange={(event) => { setReceivingIngredientId(event.target.value); onReceivingIngredientChange?.(event.target.value); setReceivingInputError(""); }}
                emptyMessage="Record opening stock before receiving later deliveries."
              />
              <label className="field">
                Receiving location
                <input readOnly value={locations.find((entry) => entry.locationId === receivingLocationId)?.name || receivingLocationId} />
              </label>
              {receivingIngredient.packConversions?.length > 0 && (
                <label className="field" data-field-width="unit">
                  Receiving unit
                  <select aria-label="Receiving unit" value={receivingUnitId} disabled={receivingDisabled} onChange={(event) => { setReceivingUnitId(event.target.value); setReceivingInputError(""); }}>
                    <option value="base">{receivingIngredient.baseUnitId} (base unit)</option>
                    {receivingIngredient.packConversions.map((pack) => (
                      <option key={pack.packUnitId} value={pack.packUnitId}>{pack.packLabel}</option>
                    ))}
                  </select>
                </label>
              )}
              <label className="field" data-field-width="numeric">
                Quantity received ({receivingPack?.packLabel || receivingIngredient.baseUnitId})
                <input id="inventory-receiving-quantity" required inputMode="decimal" value={receivingQuantity} disabled={receivingDisabled} onChange={(event) => { setReceivingQuantity(event.target.value); setReceivingInputError(""); }} placeholder="20" />
              </label>
              {receivingQuantity.trim() && !receivingConversionError && (
                <p className="source-note workspace-numeric-value" data-receiving-conversion>
                  Stock increase: {receivingQuantity.trim()} {receivingPack?.packLabel || receivingIngredient.baseUnitId} = {receivingBaseQuantity} {receivingIngredient.baseUnitId}.
                </p>
              )}
              {receivingConversionError && <p className="error-note" role="alert">{receivingConversionError}</p>}
              <label className="field" data-field-width="datetime">
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
                <div className="workspace-field-row">
                  <label className="field" data-field-width="numeric">
                    Recorded receipt total
                    <input required inputMode="decimal" value={receivingTotalCost} disabled={receivingDisabled} onChange={(event) => { setReceivingTotalCost(event.target.value); setReceivingInputError(""); }} placeholder="75.00" />
                  </label>
                  <label className="field" data-field-width="code">
                    Currency
                    <input required maxLength={3} value={receivingCurrency} disabled={receivingDisabled} onChange={(event) => setReceivingCurrency(event.target.value.toUpperCase())} />
                  </label>
                </div>
              )}
              <label className="field" data-field-width="note">
                Receiving note <span className="source-note">optional</span>
                <textarea rows="2" maxLength={240} value={receivingNote} disabled={receivingDisabled} onChange={(event) => setReceivingNote(event.target.value)} />
              </label>
              <p className="source-note">Receiving increases on-hand stock. It does not create or release an event allocation.</p>
              {receivingInputError && <p className="error-note" role="alert">{receivingInputError}</p>}
              <button className="cta" type="submit" disabled={receivingDisabled || !receivingLocationId || !receivingQuantity.trim() || !receivingOccurredAt || !receivingSource.trim() || (receivingCostAvailability === "available" && (!receivingTotalCost.trim() || !receivingCurrency.trim()))}>Record receiving</button>
            </form>
          ) : <p className="source-note" data-capability-state="empty">Record opening stock before receiving later deliveries.</p>}
          <AttemptState axis="receiving" attempt={receivingAttempt} onReconcile={onReconcile} onReset={onReset} />
          <InventoryReceivingBatch
            ingredients={ingredients}
            locations={locations}
            current={current}
            scopeKey={receivingBatchScopeKey}
            projectionModel={projectionModel}
            onSubmitBatch={onSubmitReceivingBatch}
            onReconcileLine={onReconcileReceivingLine}
            onRetryLine={onRetryReceivingLine}
            confirmsReceipt={receivingConfirmsReceipt}
          />
        </div>

        <div className="panel" data-inventory-task-panel="cost" hidden={activeTask !== "cost"} data-inventory-axis="cost" data-capability-state={attempts.cost.state}>
          <h3>Purchase-cost evidence <span className="source-note">optional</span></h3>
          <p className="muted">Record the exact observed purchase total and its quantity basis. Skipping this leaves cost unknown, never zero.</p>
          <form className="workspace-field-form" aria-label="Record purchase cost" data-inventory-command="record_ingredient_cost" onSubmit={submitCost} style={stackStyle}>
            <InventoryChoiceField
              label="Ingredient"
              ariaLabel="Cost evidence ingredient"
              options={activeIngredientOptions}
              value={costIngredientId}
              disabled={costDisabled}
              onChange={(event) => setCostIngredientId(event.target.value)}
              emptyMessage="Add an active ingredient before recording cost evidence."
            />
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
                <div className="workspace-field-row">
                  <label className="field" data-field-width="numeric">
                    Purchase total
                    <input required inputMode="decimal" placeholder="120.00" value={totalCost} disabled={costDisabled} onChange={(event) => { setTotalCost(event.target.value); setCostInputError(""); }} />
                  </label>
                  <label className="field" data-field-width="code">
                    Currency
                    <input required inputMode="text" maxLength={3} value={currency} disabled={costDisabled} onChange={(event) => setCurrency(event.target.value.toUpperCase())} />
                  </label>
                </div>
                <label className="field" data-field-width="numeric">
                  Quantity purchased ({costIngredient?.baseUnitId || "base unit"})
                  <input required inputMode="decimal" placeholder="40" value={basisQuantity} disabled={costDisabled} onChange={(event) => setBasisQuantity(event.target.value)} />
                </label>
              </>
            )}
            <label className="field" data-field-width="datetime">
              Purchase effective at
              <input required type="datetime-local" value={costOccurredAt} disabled={costDisabled} onChange={(event) => setCostOccurredAt(event.target.value)} />
            </label>
            <label className="field">
              Evidence source
              <input required maxLength={120} placeholder="Opening invoice" value={provenance} disabled={costDisabled} onChange={(event) => setProvenance(event.target.value)} />
            </label>
            <label className="field" data-field-width="note">
              Evidence note <span className="source-note">optional</span>
              <textarea rows="2" maxLength={240} value={costNote} disabled={costDisabled} onChange={(event) => setCostNote(event.target.value)} />
            </label>
            {costInputError && <p className="error-note" role="alert">{costInputError}</p>}
            {costDependencyReview.state !== "idle" && <div
              ref={costDependencyFocusRef}
              data-inventory-cost-dependency-review={costDependencyReview.state}
              data-capability-state={costDependencyReview.state === "ready" ? "success"
                : costDependencyReview.state === "loading" ? "loading"
                  : costDependencyReview.state === "stale" ? "stale" : "error"}
              role={costDependencyReview.state === "error" ? "alert" : "status"}
              tabIndex={-1}
            >
              <strong>{costDependencyReview.state === "ready" ? "Affected menu items reviewed" : "Affected menu review"}</strong>
              <p>{costDependencyReview.message}</p>
              {costDependencyReview.state === "ready" && <>
                {costDependencyReview.evidence.affectedMenuItems.length > 0 && <ul>
                  {costDependencyReview.evidence.affectedMenuItems.map((item) => (
                    <li key={item.menuItemId}>{item.name}</li>
                  ))}
                </ul>}
                <details>
                  <summary>Reviewed ingredient and dependency evidence</summary>
                  <p>Ingredient revision {costDependencyReview.evidence.reviewedIngredientRevision}</p>
                  <p>Cost revision {costDependencyReview.evidence.reviewedCostRevision}</p>
                  <p>Dependency scope digest {costDependencyReview.evidence.dependencyPreflightDigest}</p>
                </details>
              </>}
            </div>}
            <button className="ghost" type="submit" disabled={costDisabled || typeof onPreviewCostDependencies !== "function" || !costIngredientId || !costOccurredAt || !provenance.trim() || (costAvailability === "available" && (!totalCost.trim() || !currency.trim() || !basisQuantity.trim()))}>
              {costDependencyReview.state === "loading"
                ? "Reviewing affected menu items…"
                : costDependencyReview.state === "ready" && costDependencyReview.draftFingerprint === costDraftFingerprint
                  ? "Record reviewed cost evidence"
                  : "Review affected menu items"}
            </button>
          </form>
          <AttemptState axis="cost" attempt={attempts.cost} onReconcile={onReconcile} onReset={onReset} />
        </div>
      </div>
    </section>
  );
}

function IngredientEvidenceTable({
  ingredients,
  freshness,
  packsCurrent,
  canManagePacks,
  packAttempt,
  disclosed = false,
  page,
  traces,
  onOpenTrace,
  onRetryTrace,
  onLoadMoreTrace,
  onReceiveIngredient,
  onRecoverIngredient,
  onNextPage,
  onPreviousPage,
  focusIngredientId = "",
  onSubmit,
  onReconcile,
  onReset
}) {
  const [search, setSearch] = useState("");
  const [categoryFilter, setCategoryFilter] = useState("");
  const [locationFilter, setLocationFilter] = useState("");
  const [exceptionFilter, setExceptionFilter] = useState("");
  const [sortOrder, setSortOrder] = useState("name");  const [selectedIngredientId, setSelectedIngredientId] = useState(() => (
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
  useEffect(() => {
    if (!focusIngredientId) return;
    setSearch("");
    setCategoryFilter("");
    setLocationFilter("");
    setExceptionFilter("");
  }, [focusIngredientId]);

  const categories = [...new Set(ingredients.map((entry) => String(entry.category || "").trim()).filter(Boolean))]
    .sort((left, right) => left.localeCompare(right));
  const locations = [...new Map(ingredients.map((entry) => {
    const id = String(entry.locationId || "").trim();
    return [id, String(entry.locationName || id || "No location evidence").trim()];
  }).filter(([id]) => id)).entries()]
    .sort((left, right) => left[1].localeCompare(right[1]));
  const normalizedSearch = search.trim().toLocaleLowerCase();
  const visibleIngredients = ingredients.filter((ingredient) => (
    !normalizedSearch || [
      ingredient.name,
      ingredient.category,
      ingredient.locationName,
      ingredient.locationId
    ].some((value) => String(value || "").toLocaleLowerCase().includes(normalizedSearch))
  ) && (!categoryFilter || ingredient.category === categoryFilter)
    && (!locationFilter || ingredient.locationId === locationFilter)
    && ingredientHasException(ingredient, exceptionFilter))
    .slice()
    .sort((left, right) => {
      if (sortOrder === "on-hand-asc") return compareIngredientQuantity(left, right, 1);
      if (sortOrder === "on-hand-desc") return compareIngredientQuantity(left, right, -1);
      return compareIngredientName(left, right);
    });
  const scopeLabels = [
    normalizedSearch ? `search “${search.trim()}”` : "",
    categoryFilter ? `category ${categoryFilter}` : "",
    locationFilter ? `location ${locations.find(([id]) => id === locationFilter)?.[1] || locationFilter}` : "",
    exceptionFilter ? `exception ${exceptionFilter.replace(/-/g, " ")}` : ""
  ].filter(Boolean);

  if (!ingredients.length) {
    return (
      <section className="panel" aria-labelledby="inventory-empty-title">
        <p className="eyebrow">Ingredient evidence</p>
        <h2 id="inventory-empty-title">No ingredients recorded</h2>
        <p className="muted">Add the first ingredient after a stock location is server confirmed.</p>
      </section>
    );
  }
  const content = (
    <div aria-labelledby="inventory-list-title">
      <p className="eyebrow">Ingredient evidence</p>
      <h2 id="inventory-list-title">Stock and cost by ingredient</h2>
      <p id="inventory-list-description" className="source-note">
        {freshness === "current" ? "Server-confirmed projections." : "Retained projections for orientation only."} Stock and cost are separate evidence axes.
      </p>
      {(page?.hasPrevious || page?.hasNext) && (
        <nav className="inventory-page-navigation" aria-label="Ingredient pages">
          <button className="ghost" type="button" disabled={!page?.hasPrevious} onClick={onPreviousPage}>Previous ingredients</button>
          <span className="source-note">Showing a bounded page of {page?.size ?? ingredients.length} ingredients.</span>
          <button className="ghost" type="button" disabled={!page?.hasNext} onClick={onNextPage}>Next ingredients</button>
        </nav>
      )}
      <div className="inventory-ingredient-search">
        <label className="field">
          Search ingredients
          <input
            type="search"
            aria-label="Search ingredients"
            autoComplete="off"
            value={search}
            onChange={(event) => setSearch(event.target.value)}
            placeholder="Name, category, or location"
          />
        </label>
        <label className="field">
          Category
          <select aria-label="Filter ingredients by category" value={categoryFilter} onChange={(event) => setCategoryFilter(event.target.value)}>
            <option value="">All loaded categories</option>
            {categories.map((category) => <option key={category} value={category}>{category}</option>)}
          </select>
        </label>
        <label className="field">
          Location
          <select aria-label="Filter ingredients by location" value={locationFilter} onChange={(event) => setLocationFilter(event.target.value)}>
            <option value="">All loaded locations</option>
            {locations.map(([id, label]) => <option key={id} value={id}>{label}</option>)}
          </select>
        </label>
        <label className="field">
          Exception
          <select aria-label="Filter ingredient exceptions" value={exceptionFilter} onChange={(event) => setExceptionFilter(event.target.value)}>
            <option value="">All evidence states</option>
            <option value="missing-stock">Opening stock missing</option>
            <option value="missing-cost">Cost evidence missing</option>
            <option value="unavailable">Evidence unavailable</option>
          </select>
        </label>
        <label className="field">
          Sort
          <select aria-label="Sort ingredients" value={sortOrder} onChange={(event) => setSortOrder(event.target.value)}>
            <option value="name">Name</option>
            <option value="on-hand-asc">On hand, low to high within unit</option>
            <option value="on-hand-desc">On hand, high to low within unit</option>
          </select>
        </label>
        <p className="source-note" aria-live="polite">
          Showing {visibleIngredients.length} of {ingredients.length} loaded ingredients. Scope: {scopeLabels.length ? scopeLabels.join(", ") : "all ingredients on this loaded page"}.
          {sortOrder.startsWith("on-hand") ? " Quantities are grouped by base unit and compared only within the same unit." : ""}
        </p>
      </div>
      <p id="inventory-table-instruction" className="source-note inventory-table-instruction">
        Scroll horizontally to review all seven evidence columns.
      </p>
      <div
        className="history-table-wrap inventory-evidence-table-wrap"
        role="region"
        aria-label="Ingredient evidence table"
        aria-describedby="inventory-list-description inventory-table-instruction"
        tabIndex="0"
      >
        <table aria-describedby="inventory-list-description inventory-table-instruction">
          <caption className="sr-only">Ingredient on-hand, committed, available-to-allocate, and independent purchase-cost evidence</caption>
          <thead>
            <tr><th className="inventory-ingredient-identity" scope="col">Ingredient</th><th scope="col">Physical on hand</th><th scope="col">Committed</th><th scope="col">Available to allocate</th><th scope="col">Cost evidence</th><th scope="col">Location</th><th scope="col">Purchase packs</th></tr>
          </thead>
          <tbody>
            {visibleIngredients.map((ingredient, index) => {
              const packs = Array.isArray(ingredient.packConversions) ? ingredient.packConversions : [];
              const selected = selectedIngredientId === ingredient.ingredientId;
              const editorId = `inventory-pack-editor-${index}`;
              return (
                <Fragment key={ingredient.ingredientId}>
                  <tr
                    data-inventory-ingredient-row={ingredient.ingredientId}
                    data-inventory-base-unit={ingredient.baseUnitId}
                    tabIndex={-1}
                  >
                    <th className="inventory-ingredient-identity" scope="row">
                      <span>{ingredient.name}<span className="source-note"> · {ingredient.category}</span></span>
                      {typeof onReceiveIngredient === "function" && (
                        <button
                          className="ghost inventory-row-receive"
                          type="button"
                          aria-label={`Receive ${ingredient.name}`}
                          disabled={!ingredient.active || ingredient.stock?.state !== "recorded"}
                          onClick={() => onReceiveIngredient(ingredient.ingredientId)}
                        >
                          Receive
                        </button>
                      )}
                      {typeof onRecoverIngredient === "function" && exceptionFilter === "missing-stock" && ingredientHasException(ingredient, exceptionFilter) && (
                        <button className="ghost inventory-row-recovery" type="button" onClick={() => onRecoverIngredient(ingredient.ingredientId, "opening")}>Record opening stock</button>
                      )}
                      {typeof onRecoverIngredient === "function" && exceptionFilter === "missing-cost" && ingredientHasException(ingredient, exceptionFilter) && (
                        <button className="ghost inventory-row-recovery" type="button" onClick={() => onRecoverIngredient(ingredient.ingredientId, "cost")}>Record cost evidence</button>
                      )}
                      {typeof onRecoverIngredient === "function" && exceptionFilter === "unavailable" && ingredientHasException(ingredient, exceptionFilter) && (
                        <button
                          className="ghost inventory-row-recovery"
                          type="button"
                          onClick={() => onRecoverIngredient(ingredient.ingredientId, ingredient.stock?.state === "recorded" ? "cost" : "opening")}
                        >
                          Review unavailable evidence
                        </button>
                      )}
                      <IngredientTraceDisclosure
                        ingredient={ingredient}
                        trace={traces?.[ingredient.ingredientId]}
                        onOpen={onOpenTrace}
                        onRetry={onRetryTrace}
                        onLoadMore={onLoadMoreTrace}
                      />
                    </th>
                    <td data-inventory-axis="physical">
                      {stockText(ingredient)}
                      {ingredient.updatedAtISO && <span className="source-note">Stock checked {displayInstant(ingredient.updatedAtISO)}</span>}
                    </td>
                    <td data-inventory-axis="committed">{committedStockText(ingredient)}</td>
                    <td data-inventory-axis="available">
                      {availableStockText(ingredient)}
                      {ingredient.stock?.state === "recorded" && (
                        <span className="source-note">{ingredient.stock.quantity} − {ingredient.stock.committedQuantity} = {ingredient.stock.availableToAllocateQuantity} {ingredient.stock.unit}</span>
                      )}
                    </td>
                    <td data-inventory-axis="cost">
                      {costText(ingredient)}
                      {ingredient.cost?.observedAtISO && <span className="source-note">Cost observed {displayInstant(ingredient.cost.observedAtISO)} · {ingredient.cost.sourceLabel || "Source not recorded"}</span>}
                    </td>
                    <td>{ingredient.locationName || ingredient.locationId || "No location evidence"}</td>
                    <td>
                      {packs.length ? (
                        <details className="inventory-pack-list">
                          <summary>Show {packs.length} purchase {packs.length === 1 ? "pack" : "packs"}</summary>
                          <ul className="plain-list" aria-label={`Declared purchase packs for ${ingredient.name}`}>
                            {packs.map((pack) => (
                              <li key={pack.packUnitId}>
                                <strong>{pack.packLabel}</strong> · 1 {pack.packUnitId} = {pack.baseQuantity} {pack.baseUnitId}
                                <span className="source-note"> · {pack.sourceLabel} · revision {pack.revision}</span>
                              </li>
                            ))}
                          </ul>
                        </details>
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
      <ul className="inventory-phone-list" aria-label="Ingredient evidence cards">
        {visibleIngredients.map((ingredient) => {
          const packs = Array.isArray(ingredient.packConversions) ? ingredient.packConversions : [];
          return (
            <li
              key={ingredient.ingredientId}
              data-inventory-phone-row={ingredient.ingredientId}
              data-inventory-base-unit={ingredient.baseUnitId}
              tabIndex={-1}
            >
              <details>
                <summary>
                  <span><strong>{ingredient.name}</strong><small>{ingredient.category}</small></span>
                  <span><small>Available</small><strong>{availableStockText(ingredient)}</strong></span>
                </summary>
                <dl>
                  <div><dt>Physical on hand</dt><dd>{stockText(ingredient)}</dd></div>
                  <div><dt>Committed</dt><dd>{committedStockText(ingredient)}</dd></div>
                  <div>
                    <dt>Available to allocate</dt>
                    <dd>{availableStockText(ingredient)}</dd>
                    {ingredient.stock?.state === "recorded" && (
                      <dd className="source-note">{ingredient.stock.quantity} − {ingredient.stock.committedQuantity} = {ingredient.stock.availableToAllocateQuantity} {ingredient.stock.unit}</dd>
                    )}
                  </div>
                  <div><dt>Cost evidence</dt><dd>{costText(ingredient)}</dd></div>
                  <div><dt>Location</dt><dd>{ingredient.locationName || ingredient.locationId || "No location evidence"}</dd></div>
                  <div>
                    <dt>Purchase packs</dt>
                    <dd>{packs.length ? `${packs.length} declared` : "No purchase packs declared"}</dd>
                    {packs.length > 0 && (
                      <details className="inventory-pack-list">
                        <summary>Show purchase-pack conversions</summary>
                        <ul className="plain-list">
                          {packs.map((pack) => (
                            <li key={pack.packUnitId}>1 {pack.packLabel} = {pack.baseQuantity} {pack.baseUnitId}</li>
                          ))}
                        </ul>
                      </details>
                    )}
                  </div>
                </dl>
                <div className="right-actions">
                  {typeof onReceiveIngredient === "function" && (
                    <button
                      className="ghost"
                      type="button"
                      disabled={!ingredient.active || ingredient.stock?.state !== "recorded"}
                      onClick={() => onReceiveIngredient(ingredient.ingredientId)}
                    >
                      Receive {ingredient.name}
                    </button>
                  )}
                  {typeof onRecoverIngredient === "function" && exceptionFilter === "missing-stock" && ingredientHasException(ingredient, exceptionFilter) && (
                    <button className="ghost" type="button" onClick={() => onRecoverIngredient(ingredient.ingredientId, "opening")}>Record opening stock</button>
                  )}
                  {typeof onRecoverIngredient === "function" && exceptionFilter === "missing-cost" && ingredientHasException(ingredient, exceptionFilter) && (
                    <button className="ghost" type="button" onClick={() => onRecoverIngredient(ingredient.ingredientId, "cost")}>Record cost evidence</button>
                  )}
                </div>
                <IngredientTraceDisclosure
                  ingredient={ingredient}
                  trace={traces?.[ingredient.ingredientId]}
                  onOpen={onOpenTrace}
                  onRetry={onRetryTrace}
                  onLoadMore={onLoadMoreTrace}
                />
              </details>
            </li>
          );
        })}
      </ul>
    </div>
  );
  return disclosed ? (
    <details className="panel staff-evidence-disclosure inventory-ledger-disclosure">
      <summary>Seven-axis inventory ledger</summary>
      {content}
    </details>
  ) : <section className="panel">{content}</section>;
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

function staleSupplyEdit(shortage, prior) {
  const current = emptySupplyEdit(shortage);
  if (!prior) return current;
  return {
    ...current,
    supplierId: prior.supplierId,
    supplierLabel: prior.supplierLabel,
    purchaseQuantity: prior.purchaseQuantity,
    estimatedCost: prior.estimatedCost,
    note: prior.note,
    conditionsText: prior.conditionsText,
    policyFingerprint: prior.policyFingerprint,
    offerFingerprint: prior.offerFingerprint
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

function EventSupplyActionPlanPanelImpl({
  enabled = false,
  organizationId,
  role = "customer",
  principalId = "",
  events = [],
  getPlan = getEventSupplyActionPlan,
  applyPlan = applyEventSupplyActionPlanCommand
}) {
  const choices = useMemo(() => eligibleSupplyEvents(events), [events]);
  const [quoteId, setQuoteId] = useState("");
  const [read, setRead] = useState({ state: "empty", value: null, error: "" });
  const [edits, setEdits] = useState([]);
  const [savedSignature, setSavedSignature] = useState("");
  const [attempt, setAttempt] = useState({ state: "ready", error: "", receipt: null });
  const [approvalChecked, setApprovalChecked] = useState(false);
  const [cancelReason, setCancelReason] = useState("");
  const generation = useRef(0);
  const pendingSupplyRequest = useRef(null);

  const resetSelectionState = useCallback(() => {
    pendingSupplyRequest.current = null;
    generation.current += 1;
    setRead({ state: "empty", value: null, error: "" });
    setEdits([]);
    setSavedSignature("");
    setAttempt({ state: "ready", error: "", receipt: null });
    setApprovalChecked(false);
    setCancelReason("");
  }, []);

  const commandEditsFor = useCallback((sourceEdits) => sourceEdits.map((edit) => {
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
  }), []);

  const signatureFor = useCallback((sourceEdits) => {
    try { return JSON.stringify(commandEditsFor(sourceEdits)); } catch { return "invalid"; }
  }, [commandEditsFor]);

  const load = useCallback(async (selectedQuoteId, { preserveAttempt = false } = {}) => {
    if (!selectedQuoteId) {
      resetSelectionState();
      return;
    }
    const current = generation.current + 1;
    generation.current = current;
    if (!preserveAttempt) setAttempt({ state: "ready", error: "", receipt: null });
    setApprovalChecked(false);
    setCancelReason("");
    setRead({ state: "loading", value: null, error: "" });
    try {
      const value = await getPlan({ organizationId, quoteId: selectedQuoteId, role });
      if (generation.current !== current) return;
      setRead({ state: value.stale ? "stale" : "current", value, error: "" });
      const priorByShortage = new Map((value.plan?.edits || []).map((edit) => [`${edit.ingredientId}\u0000${edit.locationId}`, supplyEditFromPlan(edit)]));
      const planned = value.stale
        ? (value.source?.shortages || []).map((shortage) => staleSupplyEdit(shortage, priorByShortage.get(`${shortage.ingredientId}\u0000${shortage.locationId}`)))
        : Array.isArray(value.plan?.edits) && value.plan.edits.length
          ? value.plan.edits.map(supplyEditFromPlan)
          : (value.source?.shortages || []).map(emptySupplyEdit);
      setEdits(planned);
      setSavedSignature(!value.stale && value.plan?.status === "draft" ? signatureFor(planned) : "");
    } catch (error) {
      if (generation.current === current) setRead({ state: "error", value: null, error: safeMessage(error, "The exact supply plan could not be loaded.") });
    }
  }, [getPlan, organizationId, resetSelectionState, role, signatureFor]);

  useEffect(() => {
    setQuoteId("");
    resetSelectionState();
    return () => { generation.current += 1; };
  }, [enabled, organizationId, principalId, resetSelectionState, role]);
  useEffect(() => {
    if (quoteId && !choices.some((event) => event.id === quoteId)) {
      setQuoteId("");
      resetSelectionState();
    }
  }, [choices, quoteId, resetSelectionState]);

  if (!enabled) return null;
  const value = read.value;
  const plan = value?.plan;
  const source = value?.source;
  const unresolvedSupply = ["submitting", "uncertain", "reconciliation", "error"].includes(attempt.state);
  const canEdit = role === "admin" && !unresolvedSupply && ["current", "stale"].includes(read.state) && source?.eligible === true;
  const canCancel = role === "admin" && !unresolvedSupply && ["current", "stale"].includes(read.state) && plan && plan.status !== "cancelled";
  const editSignature = signatureFor(edits);
  const dirty = plan?.status === "draft" ? editSignature !== savedSignature : edits.length > 0;
  const emptyRebase = value?.stale === true && Boolean(plan) && Array.isArray(source?.shortages) && source.shortages.length === 0 && edits.length === 0;
  const editReady = emptyRebase || (edits.length > 0 && edits.every((edit) => (
    edit.supplierId.trim() && edit.supplierLabel.trim() && CANONICAL_QUANTITY.test(edit.purchaseQuantity.trim())
    && /^[a-f0-9]{64}$/u.test(edit.policyFingerprint) && /^[a-f0-9]{64}$/u.test(edit.offerFingerprint)
  )));

  const updateEdit = (index, field, nextValue) => {
    generation.current += 1;
    setApprovalChecked(false);
    setAttempt({ state: "ready", error: "", receipt: null });
    setEdits((current) => current.map((edit, editIndex) => (
      editIndex === index ? { ...edit, [field]: nextValue } : edit
    )));
  };

  const submit = async (kind, reconcile = false) => {
    if (!quoteId || !source) return;
    const current = generation.current + 1;
    generation.current = current;
    setAttempt({ state: reconcile ? "reconciliation" : "submitting", error: "", receipt: null });
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
          : { ...common, edits: commandEditsFor(edits) };
      const input = reconcile ? pendingSupplyRequest.current : { organizationId, quoteId, role, requestId: buildEventSupplyActionPlanRequestId(), command };
      if (!input) throw Object.assign(new Error("The exact prior request is unavailable. Refresh source evidence before continuing."), { code: "failed-precondition" });
      pendingSupplyRequest.current = input;
      const result = await applyPlan(input);
      if (generation.current !== current) return;
      pendingSupplyRequest.current = null;
      setAttempt({ state: "receipt", error: "", receipt: result.receipt });
      setApprovalChecked(false);
      await load(quoteId, { preserveAttempt: true });
    } catch (error) {
      if (generation.current === current) {
        const definitive = ["invalid-argument", "permission-denied", "unauthenticated", "failed-precondition", "aborted", "not-found", "already-exists"].includes(String(error?.code || "").replace(/^functions\//u, ""));
        setAttempt({ state: definitive ? "error" : "uncertain", error: safeMessage(error, definitive ? "The command was rejected. Review source evidence before a new request." : "No matching receipt returned. Check this exact request; completion is unknown."), receipt: null });
      }
    }
  };

  return (
    <section className="panel inventory-supply-plan" data-capability-id="event-supply-action-plan" data-capability-state={attempt.state !== "ready" ? attempt.state : read.state === "current" ? "ready" : read.state} aria-labelledby="inventory-supply-title">
      <p className="eyebrow">Event shortage response</p>
      <h2 id="inventory-supply-title">Internal supply action plan</h2>
      <p className="muted"><strong>Internal plan only.</strong> This surface does not contact a vendor, create a purchase order or reservation, change stock, or authorize commercial scope.</p>
      <label className="field">
        Accepted or booked event
        <select aria-label="Event supply plan" value={quoteId} disabled={unresolvedSupply} onChange={(event) => { const next = event.target.value; setQuoteId(next); resetSelectionState(); if (next) load(next); }}>
          <option value="">Select exact event</option>
          {choices.map((event) => <option key={event.id} value={event.id}>{eventLabel(event)}</option>)}
        </select>
      </label>
      {!choices.length && <p className="source-note" data-capability-state="empty">No accepted or booked event is available for internal supply planning.</p>}
      {read.state === "loading" && <p className="status-strip" role="status">Loading exact shortage and plan evidence…</p>}
      {read.state === "error" && <div className="error-note" role="alert"><p>{read.error}</p><button type="button" className="ghost" data-capability-state="recovery" onClick={() => load(quoteId)}>Try exact plan again</button></div>}
      {value && (
        <div className="inventory-supply-plan-body">
          <div className={value.stale ? "warning-note" : "status-strip"} data-capability-state={value.stale ? "stale" : source?.eligible ? "success" : "partial"} data-supply-truth={value.stale ? "stale" : value.resolution} role="status">
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
          {((canEdit && (edits.length > 0 || emptyRebase)) || canCancel) && (
            <div className="inventory-action-row" role="group" aria-label="Supply plan actions">
              {canEdit && (edits.length > 0 || emptyRebase) && <>
              {emptyRebase && <p className="source-note">Refreshed allocation evidence has no shortages. Rebase the reviewed plan to check its current resolution.</p>}
              <button type="button" className="ghost" data-supply-command={value.stale ? "rebase" : "save_draft"} disabled={!editReady || (!value.stale && !dirty) || attempt.state === "submitting"} onClick={() => submit(value.stale ? "rebase" : "save_draft")}>{value.stale ? "Rebase reviewed plan" : "Save internal draft"}</button>
              {dirty && !value.stale && <p className="source-note">Save this reviewed change before approval.</p>}
              <label className="inventory-approval-check"><input type="checkbox" checked={approvalChecked} disabled={plan?.status !== "draft" || value.stale || dirty} onChange={(event) => setApprovalChecked(event.target.checked)} /> I approve this internal plan for the exact saved revision and current evidence.</label>
              <button type="button" className="cta" data-supply-command="approve" disabled={!approvalChecked || dirty || plan?.status !== "draft" || value.stale || attempt.state === "submitting"} onClick={() => submit("approve")}>Approve internal plan</button>
              </>}
              {canCancel && <><label className="field">Cancellation reason<input value={cancelReason} onChange={(event) => { generation.current += 1; setCancelReason(event.target.value); setApprovalChecked(false); setAttempt({ state: "ready", error: "", receipt: null }); }} /></label><button type="button" className="ghost" data-supply-command="cancel" disabled={!cancelReason.trim() || attempt.state === "submitting"} onClick={() => submit("cancel")}>Cancel plan</button></>}
            </div>
          )}
          {attempt.state === "submitting" && <p className="status-strip" role="status">Submitting the exact internal-plan command…</p>}
          {attempt.state === "receipt" && <p className="status-strip" data-capability-state="receipt" role="status">Command receipt recorded. Refreshed plan truth is shown above.</p>}
          {attempt.state === "uncertain" && <div data-capability-state="uncertain"><p role="alert">{attempt.error}</p><button type="button" className="ghost" onClick={() => submit(pendingSupplyRequest.current?.command.kind, true)}>Check exact supply request</button></div>}
          {attempt.state === "reconciliation" && <p data-capability-state="reconciliation" role="status">Checking the unchanged request for its immutable receipt…</p>}
          {attempt.state === "error" && <div className="error-note" role="alert"><p>{attempt.error}</p><button type="button" className="ghost" data-capability-state="recovery" onClick={() => { pendingSupplyRequest.current = null; setAttempt({ state: "recovery", error: "", receipt: null }); setApprovalChecked(false); void load(quoteId, { preserveAttempt: true }); }}>Reset rejected supply request</button></div>}
        </div>
      )}    </section>
  );
}

const DEFAULT_DRAFT_SERVICE = INVENTORY_CAPTURE_BUILD_ENABLED
  ? Object.freeze({
      create: createInventoryCaptureDraft,
      update: updateInventoryCaptureDraft,
      list: listInventoryCaptureDrafts,
      discard: discardInventoryCaptureDraft,
      submit: submitInventoryCaptureDraft
    })
  : null;

function InventoryMobileCapturePanelImpl({
  enabled = false,
  organizationId,
  userId,
  role = "customer",
  browserEnabled = false,
  tenantEnabled = false,
  locations = [],
  ingredients = [],
  submitCommand = applyInventoryCommand,
  reconcileCommand = reconcileInventoryCommand,
  resetCommand = resetDefinitiveInventoryCommand,
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
  const scopeEpoch = useRef(0);
  const scopeIdentity = useRef("");
  const uiFreshness = useRef(0);
  const scopeReady = enabled && organizationId && userId && locationId;

  const beginOperation = () => ({ scope: scopeEpoch.current, freshness: ++uiFreshness.current });
  const scopeIsCurrent = (operation) => scopeEpoch.current === operation.scope;
  const operationIsCurrent = (operation) => scopeIsCurrent(operation) && uiFreshness.current === operation.freshness;
  const acceptDraft = (nextDraft, operation) => {
    if (!scopeIsCurrent(operation)) return;
    setDraft((current) => !current || (nextDraft?.draftRevision || 0) >= (current.draftRevision || 0) ? nextDraft : current);
  };

  useEffect(() => {
    if (!locations.some((location) => location.locationId === locationId)) {
      setLocationId(locations[0]?.locationId || "");
    }
  }, [locationId, locations]);

  useLayoutEffect(() => {
    const identity = JSON.stringify([enabled, organizationId, userId, locationId, browserEnabled, tenantEnabled, role]);
    if (scopeIdentity.current === identity) return;
    scopeIdentity.current = identity;
    scopeEpoch.current += 1;
    uiFreshness.current += 1;
    setDraft(null);
    setQueryText("");
    setCounts({});
    setNotes({});
    setState({ kind: enabled ? "loading" : "empty", message: enabled ? "Loading device drafts…" : "Device capture is unavailable." });
    setScanBusy(false);
  }, [browserEnabled, enabled, locationId, organizationId, role, tenantEnabled, userId]);
  useEffect(() => () => { scopeEpoch.current += 1; uiFreshness.current += 1; }, []);

  const refresh = useCallback(async () => {
    const operation = beginOperation();
    setDraft(null);
    if (!scopeReady) {
      setState({ kind: "empty", message: "Select an exact stock location." });
      return;
    }
    setState({ kind: "loading", message: "Loading device drafts…" });
    try {
      const drafts = await draftService.list({ organizationId, userId, locationId });
      if (!scopeIsCurrent(operation)) return;
      acceptDraft(drafts[0] || null, operation);
      if (operationIsCurrent(operation)) setState({ kind: drafts.length ? "draft" : "empty", message: drafts.length ? "Device draft loaded." : "No shelf-count draft at this location." });
    } catch (error) {
      if (operationIsCurrent(operation)) setState({ kind: "error", message: safeMessage(error, "Durable device draft storage is unavailable.") });
    }
  }, [browserEnabled, draftService, locationId, organizationId, role, scopeReady, tenantEnabled, userId]);

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
  const locationIngredients = ingredients.filter((ingredient) => ingredient.active !== false && ingredient.stock?.revision > 0
    && ingredient.baseUnitId === ingredient.stock?.unit
    && ingredient.stock?.locationId === locationId
    && (!ingredient.locationId || ingredient.locationId === locationId));
  const results = locationIngredients.filter((ingredient) => (
    !normalizedQuery || ingredient.name.toLocaleLowerCase("en-US").includes(normalizedQuery)
    || ingredient.ingredientId.toLocaleLowerCase("en-US").includes(normalizedQuery)
  )).slice(0, 20);

  const saveLine = async (ingredient) => {
    if (!locationIngredients.some((entry) => entry.ingredientId === ingredient.ingredientId)) {
      setState({ kind: "error", message: "This ingredient is not current at the exact selected stock location." });
      return;
    }
    const countedQuantity = String(counts[ingredient.ingredientId] || "").trim();
    if (!CANONICAL_QUANTITY.test(countedQuantity)) {
      setState({ kind: "error", message: "Enter a nonnegative count with no more than six decimal places." });
      return;
    }
    const operation = beginOperation();
    try {
      let activeDraft = draft;
      if (!activeDraft) {
        try {
          activeDraft = await draftService.create({ organizationId, userId, locationId, draftId: "active-shelf-count", lines: [] });
        } catch (error) {
          if (error?.code !== "already-exists") throw error;
          const existing = await draftService.list({ organizationId, userId, locationId });
          activeDraft = existing.find((entry) => entry.draftId === "active-shelf-count") || existing[0] || null;
          if (!activeDraft) throw error;
        }
      }
      if (!scopeIsCurrent(operation)) return;
      const occurredAtISO = new Date().toISOString();
      const requestId = buildInventoryRequestId();
      const existingLine = activeDraft.lines.find((line) => line.ingredientId === ingredient.ingredientId
        && line.baseUnitId === ingredient.baseUnitId && line.command?.locationId === locationId);
      const line = {
        lineId: `count-${ingredient.ingredientId}`,
        ingredientId: ingredient.ingredientId,
        ingredientName: ingredient.name,
        baseUnitId: ingredient.baseUnitId,
        countedQuantity,
        note: String(notes[ingredient.ingredientId] || "").trim(),
        occurredAtISO,
        expectedStockRevision: ingredient.stock?.revision || 0,
        requestId,
        command: {
          kind: "record_stock_count",
          ingredientId: ingredient.ingredientId,
          locationId,
          countedQuantity,
          baseUnitId: ingredient.baseUnitId,
          occurredAtISO,
          note: String(notes[ingredient.ingredientId] || "").trim(),
          expectedStockRevision: ingredient.stock?.revision || 0
        },
        state: "draft"
      };
      activeDraft = await draftService.update({
        organizationId,
        userId,
        locationId,
        draftId: activeDraft.draftId,
        expectedDraftRevision: activeDraft.draftRevision,
        expectedLineRevision: existingLine?.lineRevision,
        line
      });
      if (!scopeIsCurrent(operation)) return;
      acceptDraft(activeDraft, operation);
      if (operationIsCurrent(operation)) setState({ kind: "draft", message: "Count saved on this device only." });
    } catch (error) {
      if (operationIsCurrent(operation)) setState({ kind: "error", message: safeMessage(error, "The device draft could not be saved.") });
    }
  };

  const submit = async ({ lineIds, reconcileUncertain = false } = {}) => {
    if (!draft) return;
    const operation = beginOperation();
    setState({ kind: "submitting", message: "Comparing stock revisions and submitting clean lines…" });
    try {
      const nextDraft = await draftService.submit({
        organizationId,
        userId,
        locationId,
        draftId: draft.draftId,
        online,
        lineIds,
        reconcileUncertain,
        scopeIsCurrent: () => scopeIsCurrent(operation),
        currentInventory: locationIngredients.map((ingredient) => ({
          ingredientId: ingredient.ingredientId,
          locationId,
          baseUnitId: ingredient.baseUnitId,
          stockRevision: ingredient.stock.revision
        })),
        submitLine: ({ requestId, command }) => submitCommand({
          organizationId,
          role,
          browserEnabled,
          tenantEnabled,
          requestId,
          command
        }),
        reconcileLine: async ({ requestId, command }) => {
          try {
            return await reconcileCommand({ organizationId, role, browserEnabled, tenantEnabled, requestId });
          } catch (error) {
            const code = String(error?.code || "");
            if (!code.endsWith("failed-precondition")) throw error;
            if (!scopeIsCurrent(operation)) throw new Error("The capture scope changed before replay. Check the saved request from its original workspace and account.");
            return submitCommand({ organizationId, role, browserEnabled, tenantEnabled, requestId, command });
          }
        }
      });
      if (!scopeIsCurrent(operation)) return;
      acceptDraft(nextDraft, operation);
      if (operationIsCurrent(operation)) setState({ kind: nextDraft.status === "submitted" ? "receipt" : "partial", message: nextDraft.status === "submitted" ? "Every line has an authoritative receipt." : "Clean lines were submitted independently; conflicts and uncertain outcomes remain in this device draft." });
    } catch (error) {
      if (operationIsCurrent(operation)) setState({ kind: error?.code === "offline" ? "offline" : "error", message: safeMessage(error, "The device draft was retained for recovery.") });
    }
  };

  const recoverLine = async (line) => {
    const ingredient = locationIngredients.find((entry) => entry.ingredientId === line.ingredientId
      && entry.baseUnitId === line.baseUnitId && entry.stock?.locationId === locationId);
    if (!ingredient || !draft) return;
    const operation = beginOperation();
    try {
      if (line.state === "error" && line.definitive) {
        await resetCommand({ organizationId, role, browserEnabled, tenantEnabled, requestId: line.requestId });
        if (!scopeIsCurrent(operation)) return;
      }
      const requestId = buildInventoryRequestId();
      const replacement = {
        ...line,
        requestId,
        expectedStockRevision: ingredient.stock.revision,
        command: {
          ...line.command,
          ingredientId: ingredient.ingredientId,
          locationId,
          baseUnitId: ingredient.baseUnitId,
          expectedStockRevision: ingredient.stock.revision
        },
        state: "draft",
        error: "",
        receiptId: "",
        stockRevision: null,
        currentStockRevision: null,
        definitive: false,
        inFlight: false,
        attemptedAtISO: ""
      };
      const nextDraft = await draftService.update({
        organizationId,
        userId,
        locationId,
        draftId: draft.draftId,
        expectedDraftRevision: draft.draftRevision,
        expectedLineRevision: line.lineRevision,
        resolution: "reset",
        line: replacement
      });
      if (!scopeIsCurrent(operation)) return;
      acceptDraft(nextDraft, operation);
      if (operationIsCurrent(operation)) setState({ kind: "draft", message: `${ingredient.name} was reset against the current stock revision. Review before submitting.` });
    } catch (error) {
      if (operationIsCurrent(operation)) setState({ kind: "error", message: safeMessage(error) });
    }
  };

  const discard = async () => {
    if (!draft) return;
    const operation = beginOperation();
    try {
      await draftService.discard({ organizationId, userId, locationId, draftId: draft.draftId, expectedDraftRevision: draft.draftRevision });
      if (!scopeIsCurrent(operation)) return;
      setDraft(null);
      if (operationIsCurrent(operation)) setState({ kind: "empty", message: "Device draft discarded." });
    } catch (error) {
      if (operationIsCurrent(operation)) setState({ kind: "error", message: safeMessage(error) });
    }
  };

  const detectBarcode = async (file) => {
    if (!file || typeof globalThis.BarcodeDetector !== "function") return;
    const operation = beginOperation();
    setScanBusy(true);
    let bitmap = null;
    try {
      if (typeof globalThis.createImageBitmap !== "function") throw new Error("Image decoding is unavailable.");
      bitmap = await globalThis.createImageBitmap(file);
      const detector = new globalThis.BarcodeDetector();
      const codes = await detector.detect(bitmap);
      if (!scopeIsCurrent(operation)) return;
      setQueryText(String(codes?.[0]?.rawValue || ""));
      if (operationIsCurrent(operation)) setState({ kind: codes?.length ? "draft" : "empty", message: codes?.length ? "Barcode placed in search. Confirm the exact ingredient." : "No barcode was detected. Use manual search." });
    } catch {
      if (operationIsCurrent(operation)) setState({ kind: "error", message: "Barcode capture was unavailable. Use manual search." });
    } finally {
      bitmap?.close?.();
      if (scopeIsCurrent(operation)) setScanBusy(false);
    }
  };

  return (
    <section className="panel inventory-mobile-capture" data-capability-id="inventory-mobile-capture" data-capability-state={!online ? "stale" : state.kind === "draft" ? "ready" : state.kind === "partial" ? "recovery" : state.kind === "offline" ? "stale" : state.kind} aria-labelledby="inventory-capture-title">
      <p className="eyebrow">Walk the shelf</p>
      <h2 id="inventory-capture-title">Device stock-count draft</h2>
      <p className="muted">Manual search is always available. Drafts stay on this device for up to seven days and do not claim server persistence.</p>
      <label className="field">Stock location<select value={locationId} onChange={(event) => { const nextLocationId = event.target.value; scopeEpoch.current += 1; uiFreshness.current += 1; scopeIdentity.current = JSON.stringify([enabled, organizationId, userId, nextLocationId, browserEnabled, tenantEnabled, role]); setLocationId(nextLocationId); setDraft(null); setQueryText(""); setCounts({}); setNotes({}); setState({ kind: "loading", message: "Loading device drafts…" }); }}><option value="">Select location</option>{locations.map((location) => <option key={location.locationId} value={location.locationId}>{location.name}</option>)}</select></label>
      <div className={online ? "status-strip" : "warning-note"} role="status">{online ? state.message : "Offline: counts are local device truth only. Reconnect to compare stock revisions."}</div>
      <label className="field">Search first<input type="search" aria-label="Search shelf ingredients" value={queryText} onChange={(event) => setQueryText(event.target.value)} placeholder="Ingredient name or reference" /></label>
      {typeof globalThis.BarcodeDetector === "function" && <><input ref={fileRef} className="sr-only" type="file" accept="image/*" capture="environment" aria-label="Barcode image" onChange={(event) => detectBarcode(event.target.files?.[0])} /><button type="button" className="ghost" disabled={scanBusy} onClick={() => fileRef.current?.click()}>{scanBusy ? "Reading barcode…" : "Scan barcode"}</button></>}
      <div className="inventory-capture-results" aria-label="Shelf search results">
        {results.map((ingredient) => {
          const savedLine = draft?.lines?.find((line) => line.ingredientId === ingredient.ingredientId
            && line.baseUnitId === ingredient.baseUnitId && line.command?.locationId === locationId);
          const saveFenced = state.kind === "submitting" || (savedLine && (savedLine.inFlight || savedLine.state !== "draft"));
          return <article key={ingredient.ingredientId} className="inventory-capture-row">
            <div><h3>{ingredient.name}</h3><p className="source-note">Current revision {ingredient.stock?.revision || "unavailable"} · {stockText(ingredient)}</p></div>
            <label className="field">Count ({ingredient.baseUnitId})<input inputMode="decimal" disabled={saveFenced} value={counts[ingredient.ingredientId] || ""} onChange={(event) => setCounts((current) => ({ ...current, [ingredient.ingredientId]: event.target.value }))} /></label>
            <label className="field">Note <span className="source-note">optional</span><input maxLength={240} disabled={saveFenced} value={notes[ingredient.ingredientId] || ""} onChange={(event) => setNotes((current) => ({ ...current, [ingredient.ingredientId]: event.target.value }))} /></label>
            <button type="button" className="ghost" disabled={saveFenced} onClick={() => saveLine(ingredient)}>Save count to device</button>
            {saveFenced && savedLine && <p className="source-note inventory-capture-fence">Resolve the saved request before replacing this count.</p>}
          </article>;
        })}
      </div>
      {draft?.lines?.length > 0 && <div className="inventory-capture-draft-lines"><h3>Draft lines</h3><ul className="plain-list">{draft.lines.map((line) => <li key={line.lineId} data-capture-line-state={line.state}><strong>{line.ingredientName}: {line.countedQuantity} {line.baseUnitId}</strong> · {line.state}{line.receiptId && ` · receipt ${line.receiptId}`}{line.error && <span> · {line.error}</span>}{line.previousAttempts?.length > 0 && <span> · {line.previousAttempts.length} prior attempt retained</span>}{line.state === "uncertain" && <button type="button" className="ghost" onClick={() => submit({ lineIds: [line.lineId], reconcileUncertain: true })}>Check exact request</button>}{["conflict", "error"].includes(line.state) && <button type="button" className="ghost" onClick={() => recoverLine(line)}>Review against current revision</button>}{line.state === "submitted" && <button type="button" className="ghost" onClick={() => recoverLine(line)}>Start another count</button>}</li>)}</ul></div>}
      <div className="inventory-action-row"><button type="button" className="cta" disabled={!draft?.lines?.some((line) => line.state === "draft") || !online || state.kind === "submitting"} onClick={() => submit()}>Submit clean counts</button><button type="button" className="ghost" disabled={!draft || state.kind === "submitting"} onClick={discard}>Discard device draft</button></div>
      <p className="source-note">No cold offline launch is promised. Successful lines record independent stock-count receipts; failures and conflicts remain local until reviewed.</p>
    </section>
  );
}

export const InventoryExceptionWorkspace = import.meta.env.MODE === "test"
  ? InventoryExceptionWorkspaceImpl
  : null;
export const EventSupplyActionPlanPanel = import.meta.env.MODE === "test"
  ? EventSupplyActionPlanPanelImpl
  : null;
export const InventoryMobileCapturePanel = import.meta.env.MODE === "test"
  ? InventoryMobileCapturePanelImpl
  : null;

function InventoryWorkspaceViewCore({
  access,
  read,
  attempts,
  detailedTableDisclosed = false,
  renderExtensions = null,
  onRetry,
  onNextPage,
  onPreviousPage,
  focusIngredientId = "",
  traces,
  onOpenTrace,
  onRetryTrace,
  onLoadMoreTrace,
  onPreviewCostDependencies,
  onSubmit,
  onReconcile,
  onReset,
  receivingBatchScopeKey,
  onSubmitReceivingBatch,
  onReconcileReceivingLine,
  onRetryReceivingLine,
  receivingConfirmsReceipt
}) {
  const [activeTask, setActiveTask] = useState("browse");
  const [selectedEvidenceIngredientId, setSelectedEvidenceIngredientId] = useState("");
  const [selectedReceivingIngredientId, setSelectedReceivingIngredientId] = useState("");
  const model = read.model || { workspace: null, ingredients: [], sources: {} };
  const ingredients = model.ingredients || [];
  const locations = (model.workspace?.locations || []).filter((entry) => entry.active);
  const sourcesCurrent = currentSource(model, "workspace") && currentSource(model, "ingredients");
  const canConfigure = access?.mutationEnabled === true && sourcesCurrent;
  const hasCurrentLocation = locations.length > 0;
  const capabilityState = readCapabilityState(access, read, model);
  useEffect(() => {
    if (activeTask !== "receiving" || !selectedReceivingIngredientId) return;
    document.getElementById("inventory-receiving-quantity")?.focus({ preventScroll: false });
  }, [activeTask, selectedReceivingIngredientId]);

  useEffect(() => {
    if (!selectedEvidenceIngredientId) return;
    if (activeTask === "opening") {
      document.getElementById("inventory-opening-quantity")?.focus({ preventScroll: false });
    } else if (activeTask === "cost") {
      document.querySelector('form[aria-label="Record purchase cost"] select')?.focus({ preventScroll: false });
    }
  }, [activeTask, selectedEvidenceIngredientId]);

  const startReceiving = (ingredientId) => {
    setSelectedReceivingIngredientId(ingredientId);
    setActiveTask("receiving");
  };
  const startEvidenceRecovery = (ingredientId, task) => {
    setSelectedEvidenceIngredientId(ingredientId);
    setActiveTask(task);
  };

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
          {renderExtensions?.({ ingredients, locations, sourcesCurrent })}
          <InventoryRecoveryQueue attempts={attempts} onReconcile={onReconcile} onReset={onReset} />          <section className="panel" aria-labelledby="inventory-source-state-title">
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
            disclosed={detailedTableDisclosed}
            packsCurrent={read.state === "current" && currentSource(model, "ingredients")}
            canManagePacks={access.mutationEnabled === true}
            packAttempt={attempts.conversion || initialAttempt()}
            page={model.page}
            traces={traces}
            onOpenTrace={onOpenTrace}
            onRetryTrace={onRetryTrace}
            onLoadMoreTrace={onLoadMoreTrace}
            onReceiveIngredient={access.mutationEnabled === true ? startReceiving : undefined}
            onRecoverIngredient={access.mutationEnabled === true ? startEvidenceRecovery : undefined}
            onNextPage={onNextPage}
            onPreviousPage={onPreviousPage}
            focusIngredientId={focusIngredientId}
            onSubmit={onSubmit}
            onReconcile={onReconcile}
            onReset={onReset}
          />

          {access.mutationEnabled ? (
            <>
              {hasCurrentLocation && (
                <nav className="inventory-task-chooser" aria-label="Inventory tasks">
                  <button className="ghost" type="button" aria-pressed={activeTask === "receiving"} onClick={() => setActiveTask("receiving")}>Receive stock</button>
                  <button className="ghost" type="button" aria-pressed={activeTask === "opening"} onClick={() => setActiveTask("opening")}>Record opening stock</button>
                  <button className="ghost" type="button" aria-pressed={activeTask === "cost"} onClick={() => setActiveTask("cost")}>Record cost evidence</button>
                  <button className="ghost" type="button" aria-pressed={activeTask === "setup"} onClick={() => setActiveTask("setup")}>Set up ingredients</button>
                </nav>
              )}
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
                <div data-inventory-task-panel="setup" hidden={activeTask !== "setup"}>
                  <IngredientSetup
                    disabled={!canConfigure || model.bounded === true || axisLocked(attempts.ingredient)}
                    locations={locations}
                    attempt={attempts.ingredient}
                    onSubmit={onSubmit}
                    onReconcile={onReconcile}
                    onReset={onReset}
                  />
                </div>
              )}
              {hasCurrentLocation && ingredients.some((entry) => entry.active) && (
                <EvidenceForms
                  ingredients={ingredients}
                  locations={locations}
                  current={sourcesCurrent}
                  attempts={attempts}
                  activeTask={activeTask}
                  selectedEvidenceIngredientId={selectedEvidenceIngredientId}
                  selectedReceivingIngredientId={selectedReceivingIngredientId}
                  onReceivingIngredientChange={setSelectedReceivingIngredientId}
                  onPreviewCostDependencies={onPreviewCostDependencies}
                  onSubmit={onSubmit}
                  onReconcile={onReconcile}
                  onReset={onReset}
                  receivingBatchScopeKey={receivingBatchScopeKey}
                  projectionModel={model}
                  onSubmitReceivingBatch={onSubmitReceivingBatch}
                  onReconcileReceivingLine={onReconcileReceivingLine}
                  onRetryReceivingLine={onRetryReceivingLine}
                  receivingConfirmsReceipt={receivingConfirmsReceipt}
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

function buildInventoryExtensionsRenderer({
  exceptionWorkspaceEnabled,
  eventSupplyActionPlanEnabled,
  inventoryMobileCaptureEnabled,
  supplyPlanProps,
  mobileCaptureProps
}) {
  if (!INVENTORY_CONFIDENCE_BUILD_ENABLED) return null;
  return ({ ingredients, locations, sourcesCurrent }) => <>
    {INVENTORY_EXCEPTION_BUILD_ENABLED && exceptionWorkspaceEnabled ? (
      <InventoryExceptionWorkspaceImpl ingredients={ingredients} current={sourcesCurrent} />
    ) : null}
    {EVENT_SUPPLY_PLAN_BUILD_ENABLED && eventSupplyActionPlanEnabled ? (
      <EventSupplyActionPlanPanelImpl key={JSON.stringify([supplyPlanProps.organizationId, supplyPlanProps.principalId, supplyPlanProps.role])} enabled {...supplyPlanProps} />
    ) : null}
    {INVENTORY_CAPTURE_BUILD_ENABLED && inventoryMobileCaptureEnabled ? (
      <InventoryMobileCapturePanelImpl enabled locations={locations} ingredients={ingredients} {...mobileCaptureProps} />
    ) : null}
  </>;
}

export function InventoryWorkspaceView({
  exceptionWorkspaceEnabled = false,
  eventSupplyActionPlanEnabled = false,
  inventoryMobileCaptureEnabled = false,
  supplyPlanProps = {},
  mobileCaptureProps = {},
  ...props
}) {
  return <InventoryWorkspaceViewCore
    {...props}
    detailedTableDisclosed={INVENTORY_EXCEPTION_BUILD_ENABLED && exceptionWorkspaceEnabled}
    renderExtensions={buildInventoryExtensionsRenderer({
      exceptionWorkspaceEnabled,
      eventSupplyActionPlanEnabled,
      inventoryMobileCaptureEnabled,
      supplyPlanProps,
      mobileCaptureProps
    })}
  />;
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
  getSupplyPlan = EVENT_SUPPLY_PLAN_BUILD_ENABLED ? getEventSupplyActionPlan : undefined,
  applySupplyPlan = EVENT_SUPPLY_PLAN_BUILD_ENABLED ? applyEventSupplyActionPlanCommand : undefined,
  draftService = DEFAULT_DRAFT_SERVICE,
  subscribeProjections = subscribeToInventoryIngredientProjections,
  readIngredientTrace = getInventoryIngredientTrace,
  readCostDependencyPreflight = getInventoryCostDependencyPreflight,
  submitCommand = applyInventoryCommand,
  reconcileCommand = reconcileInventoryCommand,
  resetCommand = resetDefinitiveInventoryCommand,
  createRequestId = buildInventoryRequestId,
  pendingCommands = readPendingInventoryCommands,
  arrivalContext = null,
  onArrivalResolution = null
}) {
  const access = useMemo(() => getInventoryBrowserAccess({
    organizationId,
    role,
    browserEnabled,
    tenantEnabled
  }), [browserEnabled, organizationId, role, tenantEnabled]);
  const scope = useMemo(() => ({ organizationId, role, browserEnabled, tenantEnabled }), [browserEnabled, organizationId, role, tenantEnabled]);
  const [read, setRead] = useState({ state: "loading", model: null, error: "" });
  const [ingredientPageCursors, setIngredientPageCursors] = useState([null]);
  const [ingredientTraces, setIngredientTraces] = useState({});
  const [attempts, setAttempts] = useState(initialAttempts);
  const [retryGeneration, setRetryGeneration] = useState(0);
  const readGenerationRef = useRef(0);
  const commandGenerationRef = useRef(0);
  const traceRequestsRef = useRef(new Map());
  const traceStatesRef = useRef({});
  const traceIngredientsRef = useRef(new Map());
  const traceScopeRef = useRef("");
  const reportedPerformanceStagesRef = useRef(new Set());
  const arrivalReportRef = useRef("");
  const arrivalPagingRef = useRef(new Set());
  const traceScopeKey = `${access.organizationId}:${access.role}:${access.readEnabled ? "open" : "closed"}`;
  traceScopeRef.current = traceScopeKey;
  traceIngredientsRef.current = new Map((read.model?.ingredients || [])
    .map((ingredient) => [ingredient.ingredientId, ingredient]));

  useEffect(() => {
    reportedPerformanceStagesRef.current = new Set();
    arrivalPagingRef.current = new Set();
    setIngredientPageCursors([null]);
  }, [organizationId]);

  const inventoryArrival = arrivalContext?.surfaceId === "inventory"
    && arrivalContext?.destination === "inventory"
    && arrivalContext?.intentId === "review_inventory_ingredient_consequence"
    ? arrivalContext
    : null;
  const arrivalIngredientId = String(inventoryArrival?.focus?.ingredientId || "").trim();
  const arrivalBaseUnitId = String(inventoryArrival?.focus?.baseUnitId || "").trim();
  const arrivalKey = inventoryArrival ? [
    inventoryArrival.object?.id,
    arrivalIngredientId,
    arrivalBaseUnitId,
    inventoryArrival.focus?.quoteId,
    inventoryArrival.focus?.sourceRevisionId,
    inventoryArrival.focus?.proposedRevisionId
  ].join(":") : "";
  const reportArrivalResolution = useCallback((resolution) => {
    if (!arrivalKey || typeof onArrivalResolution !== "function") return;
    const signature = JSON.stringify({ arrivalKey, ...resolution });
    if (arrivalReportRef.current === signature) return;
    arrivalReportRef.current = signature;
    onArrivalResolution(resolution);
  }, [arrivalKey, onArrivalResolution]);

  useEffect(() => {
    arrivalReportRef.current = "";
    arrivalPagingRef.current = new Set();
    if (inventoryArrival) {
      setIngredientPageCursors([null]);
      reportArrivalResolution({ status: "pending" });
    }
  }, [arrivalKey]);

  useEffect(() => {
    traceRequestsRef.current = new Map();
    traceStatesRef.current = {};
    setIngredientTraces({});
  }, [traceScopeKey]);

  const traceEvidenceSignature = (read.model?.ingredients || [])
    .map((ingredient) => `${ingredient.ingredientId}:${ingredientTraceFence(ingredient)}`)
    .join("|");
  useEffect(() => {
    const currentIngredients = traceIngredientsRef.current;
    setIngredientTraces((current) => {
      let changed = false;
      const next = { ...current };
      Object.entries(current).forEach(([ingredientId, trace]) => {
        const ingredient = currentIngredients.get(ingredientId);
        if (!ingredient || trace.fence === ingredientTraceFence(ingredient)) return;
        traceRequestsRef.current.set(ingredientId, (traceRequestsRef.current.get(ingredientId) || 0) + 1);
        delete next[ingredientId];
        changed = true;
      });
      if (!changed) return current;
      traceStatesRef.current = next;
      return next;
    });
  }, [traceEvidenceSignature]);
  const activeIngredientCursor = ingredientPageCursors.at(-1) || null;

  useEffect(() => {
    const settled = ["current", "cached", "unavailable", "stale"].includes(read.state);
    if (!settled || reportedPerformanceStagesRef.current.has("usable-core")) return;
    reportedPerformanceStagesRef.current.add("usable-core");
    const outcome = read.state === "current"
      ? "ready"
      : read.model
        ? "partial"
        : "unavailable";
    markRouteStage({ routeId: "inventory", stage: "usable-core", outcome });
    markRouteStage({ routeId: "inventory", stage: "supplemental-complete", outcome });
    reportedPerformanceStagesRef.current.add("supplemental-complete");
  }, [read.model, read.state]);

  useEffect(() => {
    if (inventoryArrival) return;
    const heading = document.getElementById("inventory-workspace-title");
    heading?.focus?.({ preventScroll: true });
  }, [access.readEnabled, inventoryArrival, organizationId]);

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
        cursor: activeIngredientCursor,
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
  }, [access.readEnabled, access.reason, activeIngredientCursor, retryGeneration, scope, subscribeProjections]);

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
      requestId = createRequestId();
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
  }, [createRequestId, scope, setAttempt, submitCommand]);

  const onSubmitReceivingBatch = useCallback(({ lines, onLineState }) => (
    submitInventoryReceivingBatch({
      lines,
      scope,
      submitCommand,
      createRequestId,
      isDefinitiveError: isDefinitiveInventoryError,
      onLineState
    })
  ), [createRequestId, scope, submitCommand]);

  const onReconcileReceivingLine = useCallback(({ line, onLineState }) => (
    reconcileInventoryReceivingLine({
      line,
      scope,
      reconcileCommand,
      isDefinitiveError: isDefinitiveInventoryError,
      onLineState
    })
  ), [reconcileCommand, scope]);

  const onRetryReceivingLine = useCallback(({ line, onLineState }) => (
    retryInventoryReceivingLine({
      line,
      scope,
      resetCommand,
      submitCommand,
      isDefinitiveError: isDefinitiveInventoryError,
      onLineState
    })
  ), [resetCommand, scope, submitCommand]);

  const previewCostDependencies = useCallback(async ({ command, expectedIngredientRevision }) => (
    readCostDependencyPreflight({
      ...scope,
      command,
      expectedIngredientRevision
    })
  ), [readCostDependencyPreflight, scope]);

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

  const onNextPage = useCallback(() => {
    const nextCursor = read.model?.page?.nextCursor;
    if (!nextCursor) return;
    setIngredientPageCursors((current) => [...current, nextCursor]);
  }, [read.model?.page?.nextCursor]);

  const onPreviousPage = useCallback(() => {
    setIngredientPageCursors((current) => current.length > 1 ? current.slice(0, -1) : current);
  }, []);

  useEffect(() => {
    if (!inventoryArrival) return undefined;
    const exactScope = inventoryArrival.focusConsumerState === "supported"
      && inventoryArrival.object?.type === "inventory-ingredient"
      && String(inventoryArrival.object?.id || "").trim() === arrivalIngredientId
      && arrivalIngredientId
      && arrivalBaseUnitId
      && String(inventoryArrival.focus?.quoteId || "").trim()
      && String(inventoryArrival.focus?.sourceRevisionId || "").trim()
      && String(inventoryArrival.focus?.proposedRevisionId || "").trim();
    if (!exactScope) {
      reportArrivalResolution({
        status: "recovery",
        reason: "The Inventory consequence is not bound to one exact ingredient, base unit, quote, and revision pair.",
        consequence: "No ingredient or nearby page was substituted and no Inventory evidence changed.",
        nextResolution: "Return to the commercial change review and choose a current exact ingredient consequence."
      });
      return undefined;
    }
    if (!access.readEnabled) {
      reportArrivalResolution({
        status: "recovery",
        reason: access.reason || "Inventory authority is unavailable for this tenant and role.",
        consequence: "No ingredient evidence was exposed or changed.",
        nextResolution: "Return to the commercial change review and keep this Inventory consequence unresolved."
      });
      return undefined;
    }
    if (["loading", "pending"].includes(read.state)) {
      reportArrivalResolution({ status: "pending" });
      return undefined;
    }
    if (read.state !== "current" || !read.model) {
      reportArrivalResolution({
        status: "recovery",
        reason: "Current Inventory evidence is unavailable, so the exact ingredient cannot be verified.",
        consequence: "Retained or nearby ingredient evidence was not treated as current and no Inventory record changed.",
        nextResolution: "Retry Inventory after a current server read, or return to the commercial change review."
      });
      return undefined;
    }
    const ingredient = (read.model.ingredients || [])
      .find((entry) => String(entry?.ingredientId || "").trim() === arrivalIngredientId);
    if (ingredient) {
      if (String(ingredient.baseUnitId || "").trim() !== arrivalBaseUnitId) {
        reportArrivalResolution({
          status: "recovery",
          reason: "The exact ingredient now uses a different base unit than the reviewed commercial consequence.",
          consequence: "No converted or similarly named ingredient was substituted and no Inventory record changed.",
          nextResolution: "Return to the commercial change review and refresh the affected ingredient evidence."
        });
        return undefined;
      }
      let frame = 0;
      let attempt = 0;
      const focusExactIngredient = () => {
        const phone = window.matchMedia?.("(max-width: 620px)")?.matches;
        const attribute = phone ? "inventoryPhoneRow" : "inventoryIngredientRow";
        const selector = phone ? "[data-inventory-phone-row]" : "[data-inventory-ingredient-row]";
        const target = Array.from(document.querySelectorAll(selector))
          .find((element) => element.dataset[attribute] === arrivalIngredientId);
        if (!target && attempt < 30) {
          attempt += 1;
          frame = window.requestAnimationFrame(focusExactIngredient);
          return;
        }
        if (!target || target.dataset.inventoryBaseUnit !== arrivalBaseUnitId) {
          reportArrivalResolution({
            status: "recovery",
            reason: "The exact Inventory ingredient loaded but could not receive focus.",
            consequence: "No other ingredient was focused and no Inventory record changed.",
            nextResolution: "Keep Inventory open and retry the exact consequence."
          });
          return;
        }
        target.focus({ preventScroll: true });
        target.scrollIntoView?.({ block: "nearest", inline: "nearest" });
        reportArrivalResolution({
          status: "resolved",
          ingredientId: arrivalIngredientId,
          baseUnitId: arrivalBaseUnitId
        });
      };
      focusExactIngredient();
      return () => window.cancelAnimationFrame(frame);
    }
    const nextCursor = read.model.page?.nextCursor;
    if (read.model.page?.hasNext && nextCursor) {
      if (!arrivalPagingRef.current.has(nextCursor)) {
        arrivalPagingRef.current.add(nextCursor);
        setIngredientPageCursors((current) => [...current, nextCursor]);
      }
      reportArrivalResolution({ status: "pending" });
      return undefined;
    }
    reportArrivalResolution({
      status: "recovery",
      reason: "The exact ingredient is not present in the complete paged Inventory read.",
      consequence: "No first-listed, similarly named, or neighboring ingredient was substituted and no Inventory record changed.",
      nextResolution: "Return to the commercial change review and refresh its Inventory consequence evidence."
    });
    return undefined;
  }, [
    access.readEnabled,
    access.reason,
    arrivalBaseUnitId,
    arrivalIngredientId,
    inventoryArrival,
    read.model,
    read.state,
    reportArrivalResolution
  ]);

  const loadIngredientTrace = useCallback(async (ingredient, {
    cursor = null,
    retrying = false,
    loadingMore = false
  } = {}) => {
    if (!ingredient?.ingredientId || !access.readEnabled) return;
    const ingredientId = ingredient.ingredientId;
    const fence = ingredientTraceFence(ingredient);
    const current = traceStatesRef.current[ingredientId];
    const pending = traceRequestsRef.current.get(ingredientId);
    if (pending?.active) return;
    if (!cursor && !retrying && current?.data && current.fence === fence) return;
    const token = (typeof pending === "object" ? pending.token : Number(pending || 0)) + 1;
    traceRequestsRef.current.set(ingredientId, { token, active: true });
    const scopeAtStart = traceScopeRef.current;
    const nextLoading = {
      fence,
      state: "loading",
      data: current?.data || null,
      error: retrying ? current?.error || "" : "",
      retryCursor: cursor,
      retrying,
      loadingMore
    };
    traceStatesRef.current = { ...traceStatesRef.current, [ingredientId]: nextLoading };
    setIngredientTraces(traceStatesRef.current);
    try {
      const result = await readIngredientTrace({
        ...scope,
        ingredientId,
        expectedIngredientRevision: ingredient.ingredientRevision,
        expectedStockRevision: ingredient.stock?.revision || 0,
        expectedAllocationRevision: ingredient.stock?.allocationRevision || 0,
        cursor
      });
      const request = traceRequestsRef.current.get(ingredientId);
      const latestIngredient = traceIngredientsRef.current.get(ingredientId);
      if (traceScopeRef.current !== scopeAtStart || request?.token !== token
        || !latestIngredient || ingredientTraceFence(latestIngredient) !== fence) return;
      const existing = traceStatesRef.current[ingredientId]?.data;
      const movements = cursor && existing
        ? [...existing.movements, ...result.movements.filter((movement) => (
          !existing.movements.some((retained) => retained.movementId === movement.movementId)
        ))]
        : result.movements;
      const data = cursor && existing ? { ...result, movements } : result;
      const next = { fence, state: "current", data, error: "", retryCursor: null, retrying: false, loadingMore: false };
      traceStatesRef.current = { ...traceStatesRef.current, [ingredientId]: next };
      setIngredientTraces(traceStatesRef.current);
    } catch (error) {
      const request = traceRequestsRef.current.get(ingredientId);
      if (traceScopeRef.current !== scopeAtStart || request?.token !== token) return;
      const retained = traceStatesRef.current[ingredientId]?.data || current?.data || null;
      const next = {
        fence,
        state: retained ? "partial" : "error",
        data: retained,
        error: safeMessage(error, "Ingredient movement history and commitments are unavailable."),
        retryCursor: cursor,
        retrying: false,
        loadingMore: false
      };
      traceStatesRef.current = { ...traceStatesRef.current, [ingredientId]: next };
      setIngredientTraces(traceStatesRef.current);
    } finally {
      const request = traceRequestsRef.current.get(ingredientId);
      if (request?.token === token) traceRequestsRef.current.set(ingredientId, { token, active: false });
    }
  }, [access.readEnabled, readIngredientTrace, scope]);

  return (
    <InventoryWorkspaceViewCore
      access={access}
      read={read}
      attempts={attempts}
      detailedTableDisclosed={INVENTORY_EXCEPTION_BUILD_ENABLED && exceptionWorkspaceEnabled}
      renderExtensions={buildInventoryExtensionsRenderer({
        exceptionWorkspaceEnabled,
        eventSupplyActionPlanEnabled: EVENT_SUPPLY_PLAN_BUILD_ENABLED && eventSupplyActionPlanEnabled && access.readEnabled,
        inventoryMobileCaptureEnabled: INVENTORY_CAPTURE_BUILD_ENABLED && inventoryMobileCaptureEnabled && access.mutationEnabled,
        supplyPlanProps: { organizationId, principalId: userId, role, events, getPlan: getSupplyPlan, applyPlan: applySupplyPlan },
        mobileCaptureProps: { organizationId, userId, role, browserEnabled, tenantEnabled, submitCommand, draftService }
      })}
      traces={ingredientTraces}      onRetry={() => setRetryGeneration((value) => value + 1)}
      onNextPage={onNextPage}
      onPreviousPage={onPreviousPage}
      focusIngredientId={arrivalIngredientId}
      onOpenTrace={(ingredient) => loadIngredientTrace(ingredient)}
      onRetryTrace={(ingredient, cursor) => loadIngredientTrace(ingredient, { cursor, retrying: true })}
      onLoadMoreTrace={(ingredient, cursor) => loadIngredientTrace(ingredient, { cursor, loadingMore: true })}
      onPreviewCostDependencies={access.mutationEnabled ? previewCostDependencies : undefined}
      onSubmit={onSubmit}
      onReconcile={onReconcile}
      onReset={onReset}
      receivingBatchScopeKey={traceScopeKey}
      onSubmitReceivingBatch={onSubmitReceivingBatch}
      onReconcileReceivingLine={onReconcileReceivingLine}
      onRetryReceivingLine={onRetryReceivingLine}
      receivingConfirmsReceipt={inventoryProjectionConfirmsReceipt}
    />
  );
}
