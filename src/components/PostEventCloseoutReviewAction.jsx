import { useMemo, useState } from "react";
import {
  isDefinitivePostEventCloseoutError,
  readPendingPostEventCloseoutConfigurationAttempt,
  readPendingPostEventCloseoutAttempt,
  recordPostEventCloseoutReview,
  refreshPostEventCloseoutConfiguration,
  resetDefinitivePostEventCloseoutConfigurationAttempt,
  resetDefinitivePostEventCloseoutAttempt
} from "../lib/postEventCloseoutClient";
import StatusChip from "./StatusChip";
import PostEventProfitReview from "./PostEventProfitReview";
import {
  formatWorkspaceDate,
  formatWorkspaceDateTime,
  formatWorkspaceText
} from "../lib/workspacePresentation";

const CLOSEOUT_STATE_PRESENTATION = Object.freeze({
  scheduled: { family: "info", label: "Scheduled" },
  due: { family: "action", label: "Due today" },
  overdue: { family: "action", label: "Overdue" },
  blocked_configuration: { family: "blocked", label: "Configuration blocked" },
  completed: { family: "confirmed", label: "Closeout complete" },
  read_only_cue: { family: "info", label: "Read-only cue" }
});

const MUTATION_COPY = Object.freeze({
  ready: "Ready for an explicit internal review action.",
  submitting: "Submitting this exact closeout action and waiting for its server receipt.",
  uncertain: "No receipt returned. The action is not assumed complete; reconcile the unchanged request.",
  reconciliation: "Reconciling the exact prior action request without creating a second action.",
  receipt: "The server receipt confirms this internal closeout operation. It does not claim that customer email was sent or delivered.",
  error: "The server definitively rejected this action. Reset it before creating a revised request.",
  recovery: "The rejected request was reset. Review the input before starting a new action."
});

function text(value) {
  return String(value ?? "").trim();
}

function mutationInput(opportunity, item, action, note = "") {
  return {
    organizationId: opportunity.organizationId,
    quoteId: opportunity.quoteId,
    closeoutId: opportunity.reviewedAction?.closeoutId,
    itemCode: item.code,
    action,
    note
  };
}

function configurationInput(opportunity) {
  return {
    organizationId: opportunity.organizationId,
    quoteId: opportunity.quoteId,
    closeoutId: opportunity.reviewedAction?.closeoutId
  };
}

export function buildPostEventCloseoutPresentation(opportunity = {}, available = true) {
  const state = text(opportunity?.reviewedAction?.state) || "read_only_cue";
  const authoritative = Boolean(text(opportunity?.reviewedAction?.closeoutId));
  const due = ["due", "overdue", "completed"].includes(state);
  const actionable = available && authoritative && due;
  return {
    state,
    authoritative,
    actionable,
    presentation: CLOSEOUT_STATE_PRESENTATION[state] || CLOSEOUT_STATE_PRESENTATION.read_only_cue,
    detail: state === "blocked_configuration"
      ? text(opportunity?.reviewedAction?.policy?.blockedReason)
        || "Set a valid tenant business time zone, then check configuration before closeout review."
      : state === "scheduled"
        ? `Internal closeout becomes due ${formatWorkspaceDate(opportunity?.reviewedAction?.dueDate)}.`
        : state === "completed"
          ? `Completed ${formatWorkspaceDateTime(opportunity?.reviewedAction?.completedAtISO)} by ${formatWorkspaceText(opportunity?.reviewedAction?.completedBy, { emptyLabel: "recorded staff" })}.`
          : authoritative
            ? "Review each item explicitly. Outbound delivery remains a separate consent- and provider-gated action."
            : "This local or legacy cue has no server closeout record and cannot record completion."
  };
}

export default function PostEventCloseoutReviewAction({
  opportunity,
  available = true,
  profitReviewEnabled = false,
  isAdmin = false,
  onReceipt
}) {
  const view = useMemo(
    () => buildPostEventCloseoutPresentation(opportunity, available),
    [available, opportunity]
  );
  const [notes, setNotes] = useState({});
  const [mutation, setMutation] = useState({
    state: "ready",
    itemCode: "",
    action: "",
    error: "",
    receipt: null
  });
  const busy = ["submitting", "reconciliation"].includes(mutation.state);

  const run = async (item, action, { reconcile = false } = {}) => {
    const base = mutationInput(opportunity, item, action, notes[item.code] || "");
    const pending = readPendingPostEventCloseoutAttempt(base);
    const input = pending || base;
    setMutation({
      state: reconcile || pending ? "reconciliation" : "submitting",
      itemCode: item.code,
      action,
      error: "",
      receipt: null
    });
    try {
      const result = await recordPostEventCloseoutReview(input);
      setMutation({
        state: "receipt",
        itemCode: item.code,
        action,
        error: "",
        receipt: result.receipt
      });
      onReceipt?.(result);
    } catch (error) {
      setMutation({
        state: isDefinitivePostEventCloseoutError(error) ? "error" : "uncertain",
        itemCode: item.code,
        action,
        error: error?.message || "The closeout action did not return a server receipt.",
        receipt: null
      });
    }
  };

  const reset = (item) => {
    const base = mutationInput(opportunity, item, mutation.action, notes[item.code] || "");
    if (!resetDefinitivePostEventCloseoutAttempt(base)) return;
    setMutation({ state: "recovery", itemCode: item.code, action: "", error: "", receipt: null });
  };

  const runConfigurationRefresh = async ({ reconcile = false } = {}) => {
    const base = configurationInput(opportunity);
    const pending = readPendingPostEventCloseoutConfigurationAttempt(base);
    const input = pending || base;
    setMutation({
      state: reconcile || pending ? "reconciliation" : "submitting",
      itemCode: "configuration",
      action: "refresh_configuration",
      error: "",
      receipt: null
    });
    try {
      const result = await refreshPostEventCloseoutConfiguration(input);
      setMutation({
        state: "receipt",
        itemCode: "configuration",
        action: "refresh_configuration",
        error: "",
        receipt: result.receipt
      });
      onReceipt?.(result);
    } catch (error) {
      setMutation({
        state: isDefinitivePostEventCloseoutError(error) ? "error" : "uncertain",
        itemCode: "configuration",
        action: "refresh_configuration",
        error: error?.message || "The configuration refresh did not return a server receipt.",
        receipt: null
      });
    }
  };

  const resetConfigurationRefresh = () => {
    if (!resetDefinitivePostEventCloseoutConfigurationAttempt(configurationInput(opportunity))) {
      return;
    }
    setMutation({
      state: "recovery",
      itemCode: "configuration",
      action: "",
      error: "",
      receipt: null
    });
  };

  return (
    <section
      className="post-event-closeout-action"
      aria-labelledby={`post-event-closeout-${text(opportunity.quoteId)}-title`}
      data-capability-id="cwf-11-authoritative-post-event-closeout"
      data-capability-state={mutation.state}
      data-closeout-state={view.state}
    >
      <div className="workflow-attention-head">
        <div>
          <h4 id={`post-event-closeout-${text(opportunity.quoteId)}-title`}>Closeout review record</h4>
          <p className="source-note">{view.detail}</p>
        </div>
        <StatusChip {...view.presentation} />
      </div>

      {view.state === "blocked_configuration" && view.authoritative && available && (
        <div className="post-event-closeout-configuration" data-closeout-item="configuration">
          <div>
            <strong>Tenant calendar configuration</strong>
            <p className="source-note">
              Save a valid Business time zone in Catalog Administration, then ask the server to recheck this exact closeout. This does not review any item.
            </p>
          </div>
          <div className="right-actions">
            {mutation.itemCode === "configuration" && mutation.state === "uncertain" ? (
              <button type="button" className="cta compact" onClick={() => void runConfigurationRefresh({ reconcile: true })}>
                Reconcile configuration check
              </button>
            ) : mutation.itemCode === "configuration" && mutation.state === "error" ? (
              <button type="button" className="ghost compact" onClick={resetConfigurationRefresh}>
                Reset rejected check
              </button>
            ) : (
              <button
                type="button"
                className="cta compact"
                disabled={busy}
                aria-busy={busy && mutation.itemCode === "configuration"}
                onClick={() => void runConfigurationRefresh()}
              >
                {busy && mutation.itemCode === "configuration"
                  ? "Checking configuration..."
                  : "Check configuration"}
              </button>
            )}
          </div>
        </div>
      )}

      <div className="post-event-closeout-items">
        {(Array.isArray(opportunity.reviewItems) ? opportunity.reviewItems : []).map((item) => {
          const reviewed = item.state === "reviewed";
          const itemBusy = busy && mutation.itemCode === item.code;
          const needsReconcile = mutation.state === "uncertain" && mutation.itemCode === item.code;
          const needsReset = mutation.state === "error" && mutation.itemCode === item.code;
          return (
            <article className="post-event-closeout-item" key={item.code} data-closeout-item={item.code}>
              <div>
                <strong>{item.label}</strong>
                <p className="source-note">
                  {reviewed
                    ? `Reviewed ${formatWorkspaceDateTime(item.reviewedAtISO)} by ${formatWorkspaceText(item.reviewedBy, { emptyLabel: "recorded staff" })}.`
                    : "Pending explicit internal review."}
                </p>
              </div>
              <label className="field compact-field">
                <span>Internal note (optional)</span>
                <input
                  value={notes[item.code] || ""}
                  maxLength={800}
                  disabled={busy || needsReconcile}
                  onChange={(event) => setNotes((current) => ({
                    ...current,
                    [item.code]: event.target.value
                  }))}
                />
              </label>
              <div className="right-actions">
                {needsReconcile ? (
                  <button type="button" className="cta compact" onClick={() => void run(item, mutation.action, { reconcile: true })}>
                    Reconcile exact action
                  </button>
                ) : needsReset ? (
                  <button type="button" className="ghost compact" onClick={() => reset(item)}>
                    Reset rejected action
                  </button>
                ) : (
                  <button
                    type="button"
                    className={reviewed ? "ghost compact" : "cta compact"}
                    disabled={!view.actionable || busy}
                    title={!view.actionable ? view.detail : ""}
                    aria-busy={itemBusy}
                    onClick={() => void run(item, reviewed ? "reopen" : "review")}
                  >
                    {itemBusy ? "Waiting for receipt..." : reviewed ? "Reopen review" : "Mark reviewed"}
                  </button>
                )}
              </div>
            </article>
          );
        })}
      </div>

      {mutation.state !== "ready" && (
        <div
          className={new Set(["uncertain", "error", "recovery"]).has(mutation.state) ? "warning-note" : "source-note"}
          role={new Set(["uncertain", "error"]).has(mutation.state) ? "alert" : "status"}
          data-mutation-state={mutation.state}
        >
          <strong>{mutation.state === "receipt" ? "Receipt recorded." : "Closeout action."}</strong>{" "}
          {MUTATION_COPY[mutation.state] || MUTATION_COPY.ready}
          {mutation.error ? ` ${mutation.error}` : ""}
          {mutation.receipt?.requestId ? <> Request <code>{mutation.receipt.requestId}</code>.</> : null}
        </div>
      )}
      <PostEventProfitReview
        opportunity={opportunity}
        enabled={profitReviewEnabled && available}
        isAdmin={isAdmin}
        onReceipt={onReceipt}
      />
    </section>
  );
}
