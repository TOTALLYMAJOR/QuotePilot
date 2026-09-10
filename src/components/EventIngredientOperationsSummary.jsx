import { createElement, useId, useMemo } from "react";
import { buildEventIngredientOperationalPresentation } from "../lib/eventIngredientOperationalPresentation";
import "./eventIngredientOperationsSummary.css";

function quantityFromMicros(value) {
  if (!Number.isSafeInteger(value) || value < 0) return "Unknown";
  const whole = Math.floor(value / 1_000_000);
  const fraction = String(value % 1_000_000).padStart(6, "0").replace(/0+$/u, "");
  return fraction ? `${whole}.${fraction}` : String(whole);
}

function money(minor, currency) {
  if (!Number.isSafeInteger(minor) || !/^[A-Z]{3}$/u.test(String(currency || ""))) return "Unknown";
  try {
    return new Intl.NumberFormat("en-US", { style: "currency", currency }).format(minor / 100);
  } catch {
    return "Unknown";
  }
}

function Axis({ kind, axis }) {
  return (
    <article className="event-ingredient-operations__axis" data-ingredient-operations-axis={kind} data-axis-state={axis.state}>
      <span>{kind === "physical" ? "Physical stock" : kind === "cost" ? "Menu cost" : "Event usage"}</span>
      <strong>{axis.title}</strong>
      <p>{axis.detail}</p>
      <small>{axis.evidence}</small>
    </article>
  );
}

function ExecutionMetrics({ metrics }) {
  if (!metrics) return null;
  return (
    <div className="event-ingredient-operations__metrics" aria-label="Ingredient execution quantities by base unit">
      {metrics.baseUnits.map((group) => (
        <section key={group.baseUnitId} aria-label={`Ingredient usage in ${group.baseUnitId}`}>
          <strong>{group.baseUnitId}</strong>
          <dl>
            <div><dt>Planned</dt><dd>{quantityFromMicros(group.plannedQuantityMicros)}</dd></div>
            <div><dt>Allocated</dt><dd>{quantityFromMicros(group.allocatedQuantityMicros)}</dd></div>
            <div><dt>Consumed</dt><dd>{quantityFromMicros(group.consumedQuantityMicros)}</dd></div>
            <div><dt>Waste</dt><dd>{quantityFromMicros(group.wasteQuantityMicros)}</dd></div>
          </dl>
        </section>
      ))}
      <section className="event-ingredient-operations__cost-comparison" aria-label="Planned-basis ingredient cost comparison">
        <strong>Planned-basis cost</strong>
        {metrics.plannedBasisCost.state === "complete" ? (
          <dl>
            <div><dt>Saved estimate</dt><dd>{money(metrics.plannedBasisCost.plannedProjectedCostMinor, metrics.plannedBasisCost.currency)}</dd></div>
            <div><dt>Usage at saved basis</dt><dd>{money(metrics.plannedBasisCost.knownUsageCostMinor, metrics.plannedBasisCost.currency)}</dd></div>
            <div><dt>Difference</dt><dd>{money(metrics.plannedBasisCost.varianceMinor, metrics.plannedBasisCost.currency)}</dd></div>
          </dl>
        ) : <p>{metrics.plannedBasisCost.state === "partial" ? "Partially costed; known contributions are not a complete total." : "Planned-basis cost is unavailable."}</p>}
        <small>Actual COGS is unavailable until an inventory valuation policy is declared.</small>
      </section>
    </div>
  );
}

function primaryAxis(model) {
  return [model.physical, model.execution, model.cost].find((axis) => axis.state !== "satisfied") || model.physical;
}

function actionLabel(actionKind) {
  if (actionKind === "ingredient_execution") return "Review ingredient usage";
  if (actionKind === "menu_costing") return "Review menu costing";
  return "Review ingredient plan";
}

function liveStatus(model) {
  return [
    `Physical stock: ${model.physical.title}`,
    `Menu cost: ${model.cost.title}`,
    `Event usage: ${model.execution.title}`
  ].join(". ");
}

export default function EventIngredientOperationsSummary({
  planRead = {},
  executionRead = {},
  activeQuoteRevisionId = "",
  onOpenPlan,
  headingLevel = 2
}) {
  const titleId = useId();
  const model = useMemo(() => buildEventIngredientOperationalPresentation({
    planRead,
    executionRead,
    activeQuoteRevisionId
  }), [activeQuoteRevisionId, executionRead, planRead]);
  const action = primaryAxis(model);
  const capabilityState = [model.physical, model.cost, model.execution].some((axis) => axis.state === "attention")
    ? "partial"
    : [model.physical, model.cost, model.execution].some((axis) => axis.state === "unknown") ? "unavailable" : "success";
  const safeHeadingLevel = Number.isInteger(headingLevel) && headingLevel >= 2 && headingLevel <= 6 ? headingLevel : 2;

  return (
    <section
      className="event-ingredient-operations execution-card"
      data-event-ingredient-operations-summary
      data-capability-state={capabilityState}
      aria-labelledby={titleId}
    >
      <header>
        <div>
          <p className="eyebrow">Ingredient operations</p>
          {createElement(`h${safeHeadingLevel}`, { id: titleId }, "Stock, cost, and usage")}
          <p role="status" aria-live="polite" aria-atomic="true">{liveStatus(model)}</p>
        </div>
        {typeof onOpenPlan === "function" && (
          <button type="button" className="ghost compact" onClick={() => onOpenPlan({ actionKind: action.actionKind })}>
            {actionLabel(action.actionKind)}
          </button>
        )}
      </header>
      <div className="event-ingredient-operations__axes">
        <Axis kind="physical" axis={model.physical} />
        <Axis kind="cost" axis={model.cost} />
        <Axis kind="execution" axis={model.execution} />
      </div>
      <ExecutionMetrics metrics={model.execution.metrics} />
      <p className="event-ingredient-operations__boundary">{model.boundary}</p>
    </section>
  );
}
