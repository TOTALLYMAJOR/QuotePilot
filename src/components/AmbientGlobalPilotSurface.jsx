import ContextSurface from "./ambient/ContextSurface";
import {
  AMBIENT_GLOBAL_PILOT_CHOOSE_ACTION,
  AMBIENT_GLOBAL_PILOT_DISMISS_ACTION
} from "../lib/ambientGlobalPilot";

const RECOVERY_TARGETS = new Set(["choose_opportunity", "recovery"]);

function text(value, fallback) {
  const normalized = typeof value === "string" ? value.trim() : "";
  return normalized || fallback;
}

/**
 * Presentation-only global Pilot context.
 *
 * Routing and authority stay with the caller. Missing context deliberately
 * becomes a populated recovery state instead of an empty global assistant.
 */
export function AmbientGlobalPilotSurface({
  open = false,
  model = null,
  anchorRef = null,
  returnFocusRef = null,
  onClose = null,
  onChooseOpportunity = null
}) {
  const target = text(model?.target, "recovery");
  const objectLabel = text(model?.object?.label, "No opportunity selected");
  const routeLabel = text(model?.routeLabel, "Current workspace");
  const reason = text(
    model?.reason,
    "Choose an opportunity to see guidance based on its saved details."
  );
  const consequence = text(
    model?.consequence,
    "No opportunity was selected. Nothing changed."
  );
  const nextResolution = text(
    model?.nextResolution?.label || model?.nextResolution,
    "Choose an opportunity to continue."
  );
  const chooseOpportunity = RECOVERY_TARGETS.has(target);
  const canChooseOpportunity = typeof onChooseOpportunity === "function";
  const chooseActionId = text(
    model?.nextResolution?.id,
    AMBIENT_GLOBAL_PILOT_CHOOSE_ACTION.id
  );

  const footer = chooseOpportunity ? (
    <button
      type="button"
      className="cta"
      onClick={() => onChooseOpportunity?.()}
      disabled={!canChooseOpportunity}
      title={canChooseOpportunity ? undefined : "Opportunity selection is unavailable in this workspace."}
      data-context-initial-focus={canChooseOpportunity ? true : undefined}
      data-ambient-action-id={chooseActionId || undefined}
    >
      Choose an opportunity
    </button>
  ) : null;

  return (
    <ContextSurface
      open={open}
      title="Pilot"
      description={`${objectLabel} · ${routeLabel}`}
      reason={reason}
      consequence={consequence}
      anchorRef={anchorRef}
      returnFocusRef={returnFocusRef}
      align="start"
      onClose={onClose}
      closeLabel="Close Pilot"
      closeActionId={text(
        model?.closeActionId,
        AMBIENT_GLOBAL_PILOT_DISMISS_ACTION.id
      )}
      footer={footer}
    >
      <section
        data-ambient-global-pilot-surface="recovery"
        data-ambient-global-pilot-target={target}
        data-surface-purpose="clarify reveal_context resolve"
      >
        <p className="eyebrow">Current context</p>
        <h3>{objectLabel}</h3>
        <p>{routeLabel}</p>
        <p>
          <strong>What you can do next</strong>
          <span> {nextResolution}</span>
        </p>
        <p className="source-note">
          Nothing in this quote, client, or connected service was changed.
        </p>
      </section>
    </ContextSurface>
  );
}

export default AmbientGlobalPilotSurface;
