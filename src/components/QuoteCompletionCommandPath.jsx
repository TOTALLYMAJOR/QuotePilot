import { useEffect, useRef, useState } from "react";
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

function completionOutcome(value) {
  const state = String(value?.status || value?.state || value || "").trim().toLowerCase();
  const normalizedState = [
    "success",
    "saved",
    "sent",
    "resolved",
    "accepted",
    "opened",
    "pending",
    "navigated"
  ].includes(state)
    ? "success"
    : ["stale", "conflict"].includes(state)
      ? "stale"
      : ["failure", "failed", "error"].includes(state)
        ? "failure"
        : "recovery";
  return {
    state: normalizedState,
    message: String(value?.message || value?.reason || "").trim(),
    recovery: value?.recovery && typeof value.recovery === "object"
      ? value.recovery
      : null
  };
}

export default function QuoteCompletionCommandPath({
  enabled = false,
  projection = null,
  surface = "review",
  onAction = null,
  className = ""
}) {
  const shownKeyRef = useRef("");
  const sendableKeyRef = useRef("");
  const resolvedActionKeyRef = useRef("");
  const [runtimeCommand, setRuntimeCommand] = useState(null);
  const state = projection?.state || "review_required";
  const action = projection?.nextAction;
  const projectedCommand = projection?.command || { state: "idle", message: "" };
  const actionIdentity = [
    projection?.objectContext?.quoteId || "unknown-quote",
    projection?.objectContext?.revisionId || "unknown-revision",
    action?.id || "unknown-action",
    surface
  ].join(":");
  const runtimeOwnsCommand = runtimeCommand?.actionIdentity === actionIdentity;
  const command = runtimeOwnsCommand
    ? runtimeCommand
    : projectedCommand;
  const shownKey = `${actionIdentity}:${state}:${action?.kind || "unknown"}`;

  useEffect(() => {
    setRuntimeCommand(null);
  }, [actionIdentity, projectedCommand.message, projectedCommand.state]);

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
    if (!enabled || state !== "sendable" || sendableKeyRef.current === actionIdentity) return;
    sendableKeyRef.current = actionIdentity;
    recordQuoteCompletionSendableReached({ surface });
  }, [actionIdentity, enabled, state, surface]);

  if (!enabled || !projection || !action) return null;

  const runAction = async () => {
    if (command.state === "loading" || (runtimeOwnsCommand && command.state === "success")) return;
    setRuntimeCommand({
      actionIdentity,
      state: "loading",
      message: `Working on ${String(action.label || "this action").toLowerCase()}…`,
      recovery: null
    });
    let outcome;
    try {
      outcome = completionOutcome(await onAction?.(action));
    } catch (error) {
      outcome = {
        state: "failure",
        message: String(error?.userMessage || error?.message || "The action could not be completed."),
        recovery: { label: "Try again" }
      };
    }
    setRuntimeCommand({
      actionIdentity,
      state: outcome.state,
      message: outcome.message || {
        success: "The exact next step opened.",
        stale: "This quote changed. Refresh it before continuing.",
        failure: "The action could not be completed.",
        recovery: "That exact destination is not available right now."
      }[outcome.state],
      recovery: outcome.recovery
    });
    if (outcome.state === "success" && resolvedActionKeyRef.current !== actionIdentity) {
      resolvedActionKeyRef.current = actionIdentity;
      recordQuoteCompletionActionResolved({
        completionState: state,
        actionKind: action.kind,
        surface,
        result: "success"
      });
    }
  };
  const commandBusy = command.state === "loading";
  const commandComplete = runtimeOwnsCommand && command.state === "success";
  const retryLabel = command.recovery?.label
    || (["failure", "stale", "recovery"].includes(command.state)
      ? `Try ${String(action.label || "action").toLowerCase()} again`
      : action.label);
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
        disabled={!action.enabled || commandBusy || commandComplete}
        onClick={runAction}
        data-quote-completion-action={action.id}
      >
        {commandBusy ? "Working…" : commandComplete ? "Completed" : retryLabel}
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
