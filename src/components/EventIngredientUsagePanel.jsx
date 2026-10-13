import { useEffect, useMemo, useState } from "react";
import "./eventIngredientUsagePanel.css";

const DECIMAL_INPUT_PATTERN = /^(0|[1-9]\d*)(?:\.(\d{1,6}))?$/u;

function text(value) {
  return String(value ?? "").trim();
}

function quantityFromMicros(value) {
  if (!Number.isSafeInteger(value) || value < 0) return "";
  const whole = Math.floor(value / 1_000_000);
  const fraction = String(value % 1_000_000).padStart(6, "0").replace(/0+$/u, "");
  return fraction ? `${whole}.${fraction}` : String(whole);
}

function displayQuantity(value) {
  const formatted = quantityFromMicros(value);
  return formatted || "Not recorded";
}

function inputRows(planProjection, executionProjection) {
  const executed = Array.isArray(executionProjection?.ingredients) ? executionProjection.ingredients : [];
  const executedById = new Map(executed.map((entry) => [text(entry?.ingredientId), entry]));
  const planned = Array.isArray(planProjection?.allocation?.ingredients)
    ? planProjection.allocation.ingredients : [];
  return planned.map((entry) => {
    const current = executedById.get(text(entry.ingredientId));
    return {
      ingredientId: text(entry.ingredientId),
      ingredientName: text(current?.name) || text(entry.ingredientName) || text(entry.ingredientId),
      locationId: text(entry.locationId),
      baseUnitId: text(entry.baseUnitId),
      expectedStockRevision: current?.resultStockRevision || entry.stockRevision,
      plannedQuantityMicros: current?.plannedQuantityMicros ?? entry.requiredQuantityMicros,
      allocatedQuantityMicros: current?.allocatedQuantityMicros ?? entry.allocatedQuantityMicros,
      consumedQuantity: current ? quantityFromMicros(current.consumedQuantityMicros) : "",
      wasteQuantity: current ? quantityFromMicros(current.wasteQuantityMicros) : ""
    };
  });
}

function money(minor, currency) {
  if (!Number.isSafeInteger(minor) || !currency) return "Unknown";
  return new Intl.NumberFormat("en-US", { style: "currency", currency }).format(minor / 100);
}

function feedback(operation, { onReconcile, onReset }) {
  if (!operation || operation.state === "idle") return null;
  const label = operation.state === "submitting" ? "Recording ingredient usage…"
    : operation.state === "receipt" ? "Receipt returned; waiting for the exact execution projection…"
      : operation.state === "committed" ? "Ingredient usage is confirmed in the current execution projection."
        : operation.state === "uncertain" ? "The outcome is uncertain. Reconcile this exact request before entering another one."
          : operation.state === "error" ? "The request was rejected. Review it before resetting."
            : operation.message;
  return (
    <div className="event-ingredient-usage__feedback" role={["uncertain", "error"].includes(operation.state) ? "alert" : "status"} data-usage-operation={operation.state}>
      <p>{operation.message || label}</p>
      {operation.requestId && <code>{operation.requestId}</code>}
      {operation.state === "uncertain" && (
        <button type="button" className="ghost compact" onClick={() => onReconcile?.({ requestId: operation.requestId })}>
          Reconcile exact request
        </button>
      )}
      {operation.state === "error" && (
        <button type="button" className="ghost compact" onClick={() => onReset?.({ requestId: operation.requestId })}>
          Reset rejected request
        </button>
      )}
    </div>
  );
}

export default function EventIngredientUsagePanel({
  planRead = {},
  read = {},
  operation = {},
  access = {},
  controlsLocked = false,
  blockedReason = "",
  onRecord,
  onCorrect,
  onReconcile,
  onReset
}) {
  const plan = planRead.projection || null;
  const execution = read.projection || null;
  const revision = Number(execution?.executionRevision || 0);
  const correction = revision > 0;
  const sourceRows = useMemo(() => inputRows(plan, execution), [execution, plan]);
  const sourceIdentity = useMemo(() => JSON.stringify(sourceRows.map((entry) => [
    entry.ingredientId, entry.locationId, entry.baseUnitId, entry.expectedStockRevision,
    entry.consumedQuantity, entry.wasteQuantity
  ])), [sourceRows]);
  const [rows, setRows] = useState(sourceRows);
  const [occurredAtLocal, setOccurredAtLocal] = useState("");
  const [reason, setReason] = useState("");
  const [complete, setComplete] = useState(false);

  useEffect(() => {
    setRows(sourceRows);
    setOccurredAtLocal("");
    setReason("");
    setComplete(false);
  }, [sourceIdentity]);

  const invalidRows = rows.filter((row) => (
    !DECIMAL_INPUT_PATTERN.test(row.consumedQuantity)
    || !DECIMAL_INPUT_PATTERN.test(row.wasteQuantity)
  ));
  const readCurrent = read.sourceState === "current" && !["cached", "pending", "unavailable"].includes(read.state);
  const planCurrent = planRead.sourceState === "current" && planRead.state === "current";
  const canSubmit = access.mutationEnabled === true
    && !controlsLocked
    && planCurrent
    && readCurrent
    && rows.length > 0
    && invalidRows.length === 0
    && Boolean(occurredAtLocal)
    && Boolean(text(reason))
    && complete
    && Boolean(correction ? onCorrect : onRecord);
  const unavailable = !access.readEnabled || planRead.state === "unavailable" || read.state === "unavailable";
  const emptyPlan = planCurrent && !plan?.allocation;

  function updateRow(index, field, value) {
    setRows((current) => current.map((row, rowIndex) => rowIndex === index
      ? { ...row, [field]: value } : row));
    setComplete(false);
  }

  function submit(event) {
    event.preventDefault();
    if (!canSubmit) return;
    const occurredAtISO = new Date(occurredAtLocal).toISOString();
    const payload = {
      occurredAtISO,
      reason: text(reason),
      ingredients: rows.map((row) => ({
        ingredientId: row.ingredientId,
        locationId: row.locationId,
        baseUnitId: row.baseUnitId,
        expectedStockRevision: row.expectedStockRevision,
        consumedQuantity: row.consumedQuantity,
        wasteQuantity: row.wasteQuantity
      }))
    };
    void (correction ? onCorrect : onRecord)?.(payload);
  }

  return (
    <section
      className="event-ingredient-usage execution-card"
      data-event-ingredient-usage
      data-capability-state={unavailable ? "unavailable" : controlsLocked && access.mutationEnabled ? "pending" : correction ? "recorded" : emptyPlan ? "empty" : "ready"}
      aria-labelledby="event-ingredient-usage-title"
    >
      <header className="event-ingredient-usage__header">
        <div>
          <p className="eyebrow">Ingredient actuals</p>
          <h2 id="event-ingredient-usage-title">{correction ? "Correct recorded ingredient usage" : "Finish ingredient usage"}</h2>
          <p>
            {correction
              ? `Revision ${revision} is preserved. Submit complete replacement totals to create the next revision.`
              : "Record consumed and wasted quantities for every allocated ingredient. Blank values never mean zero."}
          </p>
        </div>
        <span className="event-ingredient-usage__read-state" data-execution-read-state={read.state || "not_recorded"}>
          {read.state === "current" ? "Current" : read.state === "not_recorded" ? "Not recorded" : text(read.state).replaceAll("_", " ") || "Unavailable"}
        </span>
      </header>

      {!access.readEnabled && <p className="source-note">{access.reason || "Ingredient execution is not available in this workspace."}</p>}
      {access.readEnabled && !access.mutationEnabled && (
        <p className="source-note">You can review ingredient usage. An administrator must record or correct it.</p>
      )}
      {unavailable && access.readEnabled && (
        <p className="warning-note">Current execution evidence is unavailable. Retained values are not editable until both exact projections recover.</p>
      )}
      {emptyPlan && <p className="source-note">Allocate event ingredients before recording consumption and waste.</p>}

      {rows.length > 0 && (
        <form onSubmit={submit} data-inventory-command={correction ? "correct_event_ingredient_execution" : "record_event_ingredient_execution"}>
          <div className="event-ingredient-usage__table-wrap">
            <table>
              <caption>Full ingredient usage totals for this event</caption>
              <thead>
                <tr><th scope="col">Ingredient</th><th scope="col">Planned</th><th scope="col">Allocated</th><th scope="col">Consumed</th><th scope="col">Waste</th></tr>
              </thead>
              <tbody>
                {rows.map((row, index) => (
                  <tr key={row.ingredientId}>
                    <th scope="row"><strong>{row.ingredientName}</strong><small>{row.baseUnitId}</small></th>
                    <td>{displayQuantity(row.plannedQuantityMicros)} {row.baseUnitId}</td>
                    <td>{displayQuantity(row.allocatedQuantityMicros)} {row.baseUnitId}</td>
                    <td><label><span className="sr-only">{row.ingredientName} consumed in {row.baseUnitId}</span><input inputMode="decimal" value={row.consumedQuantity} onChange={(event) => updateRow(index, "consumedQuantity", event.target.value)} disabled={!access.mutationEnabled || controlsLocked || !planCurrent || !readCurrent} aria-invalid={row.consumedQuantity !== "" && !DECIMAL_INPUT_PATTERN.test(row.consumedQuantity)} /></label></td>
                    <td><label><span className="sr-only">{row.ingredientName} waste in {row.baseUnitId}</span><input inputMode="decimal" value={row.wasteQuantity} onChange={(event) => updateRow(index, "wasteQuantity", event.target.value)} disabled={!access.mutationEnabled || controlsLocked || !planCurrent || !readCurrent} aria-invalid={row.wasteQuantity !== "" && !DECIMAL_INPUT_PATTERN.test(row.wasteQuantity)} /></label></td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          <div className="event-ingredient-usage__fields">
            <label>Usage effective time<input type="datetime-local" value={occurredAtLocal} onChange={(event) => { setOccurredAtLocal(event.target.value); setComplete(false); }} disabled={!access.mutationEnabled || controlsLocked} /></label>
            <label>Evidence reason<input value={reason} onChange={(event) => { setReason(event.target.value); setComplete(false); }} maxLength={240} disabled={!access.mutationEnabled || controlsLocked} placeholder={correction ? "Why these totals changed" : "Event closeout count"} /></label>
          </div>
          <label className="event-ingredient-usage__attestation">
            <input type="checkbox" checked={complete} onChange={(event) => setComplete(event.target.checked)} disabled={!access.mutationEnabled || controlsLocked} />
            <span>I finished recording consumed and wasted quantities for every ingredient, including explicit zeroes.</span>
          </label>
          <div className="event-ingredient-usage__actions">
            <button type="submit" className="cta" disabled={!canSubmit} title={!canSubmit ? blockedReason || "Complete every quantity, time, reason, and acknowledgement using current evidence." : ""}>
              {correction ? "Record corrected totals" : "Finish usage capture"}
            </button>
          </div>
        </form>
      )}

      {execution?.costSummary && (
        <section className="event-ingredient-usage__cost" aria-label="Planned-basis ingredient cost comparison">
          <p className="eyebrow">Planned-basis comparison</p>
          {execution.costSummary.plannedBasisState === "complete" ? (
            <dl>
              <div><dt>Saved projected ingredient cost</dt><dd>{money(execution.costSummary.plannedProjectedCostMinor, execution.costSummary.currency)}</dd></div>
              <div><dt>Usage at saved planned basis</dt><dd>{money(execution.costSummary.knownUsageCostMinor, execution.costSummary.currency)}</dd></div>
              <div><dt>Difference</dt><dd>{money(execution.costSummary.plannedBasisVarianceMinor, execution.costSummary.currency)}</dd></div>
            </dl>
          ) : (
            <p>Coverage is {execution.costSummary.plannedBasisState}. Known contributions are not presented as a complete event total.</p>
          )}
          <p className="source-note">Planned-basis comparison only—not authoritative actual COGS. Missing cost evidence remains unknown.</p>
        </section>
      )}
      {feedback(operation, { onReconcile, onReset })}
    </section>
  );
}
