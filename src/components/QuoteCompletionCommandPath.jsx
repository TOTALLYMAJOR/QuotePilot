import { useEffect, useRef } from "react";
import {
  recordQuoteCompletionActionResolved,
  recordQuoteCompletionActionShown,
  recordQuoteCompletionSendableReached
} from "../lib/productAnalytics";
import "./quoteCompletionCommandPath.css";

const STATE_LABELS = Object.freeze({
  blocked: "Needs attention",
  review_required: "Review required",
  sendable: "Ready to send",
  sent: "Sent",
  accepted: "Accepted"
});

function completionResult(value) {
  const state = String(value?.status || value?.state || value || "").trim().toLowerCase();
  if (["success", "saved", "sent", "resolved", "accepted"].includes(state)) return "success";
  if (["stale", "conflict"].includes(state)) return "stale";
  if (["failure", "failed", "error"].includes(state)) return "failure";
  return "recovery";
}

export default function QuoteCompletionCommandPath({
  enabled = false,
  projection = null,
  surface = "review",
  onAction = null,
  className = ""
}) {
  const shownKeyRef = useRef("");
  const sendableRef = useRef(false);
  const state = projection?.state || "review_required";
  const action = projection?.nextAction;
  const command = projection?.command || { state: "idle", message: "" };
  const shownKey = `${state}:${action?.kind || "unknown"}:${surface}`;

  useEffect(() => {
    if (!enabled || !action?.enabled || shownKeyRef.current === shownKey) return;
    shownKeyRef.current = shownKey;
    recordQuoteCompletionActionShown({
      completionState: state,
      actionKind: action.kind,
      surface
    });
  }, [action?.enabled, action?.kind, enabled, shownKey, state, surface]);

  useEffect(() => {
    if (!enabled || state !== "sendable" || sendableRef.current) return;
    sendableRef.current = true;
    recordQuoteCompletionSendableReached({ surface });
  }, [enabled, state, surface]);

  if (!enabled || !projection || !action) return null;

  const runAction = async () => {
    let result = "recovery";
    try {
      result = completionResult(await onAction?.(action));
    } catch {
      result = "failure";
    }
    recordQuoteCompletionActionResolved({
      completionState: state,
      actionKind: action.kind,
      surface,
      result
    });
  };
  const commandBusy = command.state === "loading";
  const blockers = projection.blockerGroups || [];

  return (
    <section
      className={`quote-completion-command ${className}`.trim()}
      data-capability-id="quote-completion-command-path"
      data-capability-state={state}
      data-command-state={command.state}
      aria-labelledby={`quote-completion-${surface}`}
    >
      <div className="quote-completion-command__summary">
        <div>
          <p className="quote-completion-command__eyebrow">Quote completion</p>
          <h3 id={`quote-completion-${surface}`}>{STATE_LABELS[state] || "Review required"}</h3>
        </div>
        <span className="quote-completion-command__state">{STATE_LABELS[state] || state}</span>
      </div>

      {blockers.map((group) => (
        <div className="quote-completion-command__group" key={group.id}>
          <strong>{group.label}</strong>
          <ul>
            {group.blockers.map((blocker) => <li key={blocker.id}>{blocker.label}</li>)}
          </ul>
        </div>
      ))}

      {command.message ? (
        <p
          className="quote-completion-command__message"
          role={["failure", "stale"].includes(command.state) ? "alert" : "status"}
        >
          {command.message}
        </p>
      ) : null}

      <button
        type="button"
        className="quote-completion-command__action"
        disabled={!action.enabled || commandBusy}
        onClick={runAction}
        data-quote-completion-action={action.id}
      >
        {commandBusy ? "Working…" : action.label}
      </button>

      {projection.compatibility?.percentage !== null ? (
        <details className="quote-completion-command__compatibility">
          <summary>Compatibility details</summary>
          <p>
            Legacy proposal completeness: {projection.compatibility.percentage}%.
            This percentage is compatibility data, not completion authority.
          </p>
        </details>
      ) : null}
    </section>
  );
}
