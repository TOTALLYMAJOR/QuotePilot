import { useRef } from "react";
import {
  CheckCircle,
  HandSwipeLeft,
  Minus,
  Plus,
  WarningCircle
} from "@phosphor-icons/react";
import {
  AMBIENT_SELECTION_GESTURE_SEMANTICS,
  selectionScenarioQuantity
} from "../../lib/ambientSelectionObjects";
import "./ambientSelectionObjects.css";

function previewCopy(value) {
  return String(value || "")
    .replaceAll("local scenarios", "unsaved previews")
    .replaceAll("local scenario", "unsaved preview")
    .replaceAll("package reconciliation", "package fit");
}

function SelectionObject({
  item,
  scenario,
  actions,
  onAdjust,
  onKeep
}) {
  const pointerStartRef = useRef(null);
  const quantity = selectionScenarioQuantity(item, scenario);
  const scenarioChanged = quantity !== item.current.quantity;
  const canReduce = item.adjustment.enabled && quantity > item.adjustment.minimum;
  const canIncrease = item.adjustment.enabled && (
    item.adjustment.quantityMutable
      ? quantity < item.adjustment.maximum
      : quantity === 0
  );
  const displayQuantity = quantity === 0
    ? "Removed in unsaved preview"
    : item.adjustment.quantityMutable
      ? `${quantity} ${quantity === 1 ? "unit" : "units"} in unsaved preview`
      : item.current.quantityDisplay;

  const beginPointer = (event) => {
    if (
      !item.adjustment.enabled
      || (event.target instanceof Element && event.target.closest("button"))
    ) return;
    pointerStartRef.current = {
      pointerId: event.pointerId,
      x: event.clientX,
      y: event.clientY
    };
  };

  const finishPointer = (event) => {
    const start = pointerStartRef.current;
    pointerStartRef.current = null;
    if (!start || start.pointerId !== event.pointerId) return;
    const deltaX = event.clientX - start.x;
    const deltaY = event.clientY - start.y;
    if (
      Math.abs(deltaX) < AMBIENT_SELECTION_GESTURE_SEMANTICS.minimumDistancePx
      || Math.abs(deltaX) <= Math.abs(deltaY)
    ) return;
    const direction = deltaX > 0 ? "increase" : "reduce";
    if ((direction === "increase" && canIncrease) || (direction === "reduce" && canReduce)) {
      onAdjust?.(item, direction, "swipe");
    }
  };

  return (
    <article
      className="ambient-selection-object"
      data-intelligent-selection-object={item.id}
      data-selection-kind={item.kind}
      data-scenario-state={scenarioChanged ? "changed" : "saved"}
      data-current-quantity={quantity}
      onPointerDown={beginPointer}
      onPointerUp={finishPointer}
      onPointerCancel={() => { pointerStartRef.current = null; }}
    >
      <header className="ambient-selection-object__header">
        <div>
          <span>{item.groupLabel}</span>
          <h3>{item.label}</h3>
          <p>{item.current.pricingLabel}. {item.current.priceLabel}.</p>
        </div>
        <div className="ambient-selection-object__quantity">
          <span>{scenarioChanged ? "Unsaved preview" : "Saved selection"}</span>
          <strong>{displayQuantity}</strong>
          {scenarioChanged && <small>Saved: {item.current.quantityDisplay}</small>}
        </div>
      </header>

      {item.adjustment.enabled ? (
        <div className="ambient-selection-object__controls">
          <button
            type="button"
            onClick={() => onAdjust?.(item, "reduce", "button")}
            disabled={!canReduce}
            aria-label={item.adjustment.quantityMutable
              ? `Reduce ${item.label} preview quantity`
              : `Remove ${item.label} from unsaved preview`}
            data-ambient-action-id={actions?.reduce?.id}
          >
            <Minus size={17} aria-hidden="true" />
            {item.adjustment.quantityMutable ? "Reduce by one" : "Remove from preview"}
          </button>
          <button
            type="button"
            onClick={() => onAdjust?.(item, "increase", "button")}
            disabled={!canIncrease}
            aria-label={item.adjustment.quantityMutable
              ? `Increase ${item.label} preview quantity`
              : `Restore ${item.label} to unsaved preview`}
            data-ambient-action-id={actions?.increase?.id}
          >
            <Plus size={17} aria-hidden="true" />
            {item.adjustment.quantityMutable ? "Add one" : "Restore selection"}
          </button>
          <p>
            <HandSwipeLeft size={17} aria-hidden="true" />
            Swipe left to reduce or remove, and right to add or restore. The buttons provide the same outcomes.
          </p>
        </div>
      ) : (
        <p className="ambient-selection-object__boundary">{previewCopy(item.adjustment.reason)}</p>
      )}

      <dl className="ambient-selection-object__facts">
        <div>
          <dt>Included with package</dt>
          <dd>{item.current.includedInPackage ? "Yes" : "Not recorded"}</dd>
        </div>
        <div>
          <dt>Why this belongs here</dt>
          <dd>{item.classification.reason}</dd>
        </div>
      </dl>

      <section className="ambient-selection-object__dependencies">
        <h4>What this connects to</h4>
        <ul>
          {item.descriptor.dependencies.map((dependency) => (
            <li key={`${dependency.object.type}:${dependency.object.id}`}>
              <strong>{dependency.object.label}</strong>
              <span>{dependency.consequence}</span>
            </li>
          ))}
        </ul>
      </section>

      {item.recommendationEvidence && (
        <section className="ambient-selection-object__recommendation">
          <CheckCircle size={18} weight="fill" aria-hidden="true" />
          <div>
            <h4>Why this is recommended</h4>
            <p>{item.recommendationEvidence.reason}</p>
            <small>
              Confidence: {item.recommendationEvidence.confidence}. Source: {item.recommendationEvidence.provenanceLabel}.
            </small>
            <button
              type="button"
              onClick={() => onKeep?.(item)}
              data-ambient-action-id={actions?.keep?.id}
            >
              {scenarioChanged ? "Restore saved selection" : "Keep current selection"}
            </button>
          </div>
        </section>
      )}

      <section className="ambient-selection-object__counterfactuals">
        <div>
          <CheckCircle size={18} weight="fill" aria-hidden="true" />
          <h4>What this affects</h4>
          <p>{previewCopy(item.descriptor.consequence)}</p>
        </div>
        <div>
          <WarningCircle size={18} weight="fill" aria-hidden="true" />
          <h4>If you do nothing</h4>
          <p>{item.descriptor.doNothing}</p>
        </div>
      </section>

      <p className="ambient-selection-object__provenance">
        <strong>Confidence: {item.descriptor.confidence.level}.</strong>{" "}
        {item.descriptor.confidence.basis}{" "}
        Sources: {item.descriptor.provenance.map((entry) => entry.label).join("; ")}.
      </p>
    </article>
  );
}

export default function AmbientSelectionObjects({
  groups = [],
  scenario = {},
  actions = {},
  onAdjust,
  onKeep
}) {
  return (
    <div className="ambient-selection-groups" data-ambient-selection-groups={groups.length}>
      {groups.map((group) => (
        <section key={group.kind} className="ambient-selection-group" data-selection-group={group.kind}>
          <h3>{group.label}</h3>
          <div>
            {group.items.map((item) => (
              <SelectionObject
                key={item.id}
                item={item}
                scenario={scenario}
                actions={actions[item.id]}
                onAdjust={onAdjust}
                onKeep={onKeep}
              />
            ))}
          </div>
        </section>
      ))}
    </div>
  );
}
