import { useId } from "react";
import { buildFieldStatePresentation } from "../lib/fieldState";
import "./fieldState.css";

function RecoveryAction({ action }) {
  if (!action) return null;
  if (action.href) {
    return (
      <a className="field-state-indicator__recovery" href={action.href}>
        {action.label}
      </a>
    );
  }
  return (
    <button
      className="field-state-indicator__recovery"
      type="button"
      onClick={action.onClick}
    >
      {action.label}
    </button>
  );
}

export default function FieldStateIndicator({
  state,
  label = "Field state",
  primaryState,
  reason = "",
  reasons,
  provenance = "",
  supportingDetail = "",
  recoveryAction,
  className = ""
}) {
  const detailId = useId();
  const presentation = buildFieldStatePresentation(state, {
    primaryState,
    reason,
    reasons,
    provenance,
    recoveryAction
  });
  const { primary, supporting } = presentation;
  const supportingLabels = supporting.map((entry) => entry.label);
  const hasDetail = Boolean(
    reason
      || provenance
      || supportingDetail
      || supportingLabels.length > 0
  );
  const liveRole = primary.announce === "assertive"
    ? "alert"
    : primary.announce === "polite"
      ? "status"
      : undefined;

  return (
    <div
      className={`field-state-indicator ${className}`.trim()}
      data-field-state-primary={primary.id}
      data-field-state-axes={Object.keys(presentation.axes).join(" ")}
      data-field-state-live={primary.announce}
    >
      <span
        className="field-state-indicator__primary"
        data-field-state-tone={primary.tone}
        aria-label={`${label}: ${primary.label}`}
        aria-describedby={hasDetail ? detailId : undefined}
      >
        <span className="field-state-indicator__dot" aria-hidden="true" />
        {primary.label}
      </span>

      {hasDetail ? (
        <span className="field-state-indicator__details" id={detailId}>
          {reason ? <span>{reason}</span> : null}
          {provenance ? (
            <span data-field-state-provenance="true">Source: {provenance}</span>
          ) : null}
          {supportingLabels.length > 0 ? (
            <span>Also applies: {supportingLabels.join(" · ")}</span>
          ) : null}
          {supportingDetail ? <span>{supportingDetail}</span> : null}
        </span>
      ) : null}

      <RecoveryAction action={recoveryAction} />

      {liveRole ? (
        <span
          className="field-state-indicator__announcement"
          role={liveRole}
          aria-live={primary.announce}
          aria-atomic="true"
        >
          {label}: {primary.label}{reason ? `. ${reason}` : ""}
        </span>
      ) : null}
    </div>
  );
}
