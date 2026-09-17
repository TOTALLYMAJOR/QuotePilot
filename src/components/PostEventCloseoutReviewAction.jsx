import { lazy, Suspense, useEffect, useMemo, useState } from "react";
import {
  isDefinitivePostEventCloseoutError,
  readPendingPostEventActualAttendanceAttempt,
  readPendingPostEventCloseoutConfigurationAttempt,
  readPendingPostEventCloseoutAttempt,
  recordPostEventActualAttendance,
  recordPostEventCloseoutReview,
  refreshPostEventCloseoutConfiguration,
  resetDefinitivePostEventActualAttendanceAttempt,
  resetDefinitivePostEventCloseoutConfigurationAttempt,
  resetDefinitivePostEventCloseoutAttempt
} from "../lib/postEventCloseoutClient";
import AdaptiveChoiceField from "./AdaptiveChoiceField";
import StatusChip from "./StatusChip";
import PostEventLearningPanel from "./PostEventLearningPanel";
import "../styles/customer-closeout.css";
import {
  formatWorkspaceDate,
  formatWorkspaceDateTime,
  formatWorkspaceText
} from "../lib/workspacePresentation";

const WorkflowPackPolicyPanel = import.meta.env.VITE_EVENT_OPERATING_SPINE_ENABLED === "true"
  ? lazy(() => import("./WorkflowPackPolicyPanel")) : null;
const EventActualsCloseoutSummary = import.meta.env.VITE_EVENT_OPERATING_SPINE_ENABLED === "true"
  ? lazy(() => import("./EventActualsCloseoutSummary")) : null;
export function closeoutActualsSource(opportunity = {}) {
  const source = opportunity.reviewedAction || {};
  return { organizationId: opportunity.organizationId || "", quoteId: opportunity.quoteId || "", sourceVersionId: source.sourceVersionId || "", acceptanceReceiptId: source.acceptanceReceiptId || "" };
}
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
const ACTUAL_ATTENDANCE_SOURCE_OPTIONS = Object.freeze([
  { value: "staff_observed", label: "Staff observed" },
  { value: "customer_reported", label: "Customer reported" },
  { value: "venue_reported", label: "Venue reported" },
  { value: "imported_record", label: "Imported record" }
]);
const ACTUAL_ATTENDANCE_SOURCE_LABELS = Object.freeze(
  Object.fromEntries(ACTUAL_ATTENDANCE_SOURCE_OPTIONS.map((item) => [
    item.value,
    item.label
  ]))
);

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

function attendanceDraftFrom(actualAttendance) {
  return {
    count: actualAttendance?.count ? String(actualAttendance.count) : "",
    sourceType: text(actualAttendance?.sourceType),
    note: text(actualAttendance?.note)
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
  workflowScope = null,
  learningContext = null,
  onReceipt
}) {
  const view = useMemo(
    () => buildPostEventCloseoutPresentation(opportunity, available),
    [available, opportunity]
  );
  const [notes, setNotes] = useState({});
  const [supportingDetailsOpen, setSupportingDetailsOpen] = useState(false);
  const projectedActualAttendance = opportunity?.reviewedAction?.actualAttendance || null;
  const [confirmedActualAttendance, setConfirmedActualAttendance] = useState(null);
  const actualAttendance = confirmedActualAttendance || projectedActualAttendance;
  const [attendanceDraft, setAttendanceDraft] = useState(
    attendanceDraftFrom(projectedActualAttendance)
  );
  const [mutation, setMutation] = useState({
    state: "ready",
    itemCode: "",
    action: "",
    error: "",
    receipt: null
  });
  const busy = ["submitting", "reconciliation"].includes(mutation.state);
  const attendanceMutation = mutation.itemCode === "actual_attendance";
  useEffect(() => {
    setConfirmedActualAttendance(null);
    setAttendanceDraft(attendanceDraftFrom(projectedActualAttendance));
  }, [
    opportunity?.reviewedAction?.closeoutId,
    projectedActualAttendance?.lastReceiptId
  ]);

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

  const runActualAttendance = async ({ reconcile = false } = {}) => {
    const base = {
      organizationId: opportunity.organizationId,
      quoteId: opportunity.quoteId,
      closeoutId: opportunity.reviewedAction?.closeoutId,
      action: actualAttendance ? "correct" : "record",
      expectedRevision: Number(actualAttendance?.revision || 0),
      count: Number(attendanceDraft.count),
      sourceType: attendanceDraft.sourceType,
      note: attendanceDraft.note
    };
    const pending = readPendingPostEventActualAttendanceAttempt(base);
    const input = pending || base;
    setMutation({
      state: reconcile || pending ? "reconciliation" : "submitting",
      itemCode: "actual_attendance",
      action: input.action,
      error: "",
      receipt: null
    });
    try {
      const result = await recordPostEventActualAttendance(input);
      const confirmed = result.postEventCloseout?.actualAttendance || null;
      setConfirmedActualAttendance(confirmed);
      setAttendanceDraft(attendanceDraftFrom(confirmed));
      setMutation({
        state: "receipt",
        itemCode: "actual_attendance",
        action: input.action,
        error: "",
        receipt: result.receipt
      });
      onReceipt?.(result);
    } catch (error) {
      setMutation({
        state: isDefinitivePostEventCloseoutError(error) ? "error" : "uncertain",
        itemCode: "actual_attendance",
        action: input.action,
        error: error?.message || "The actual-attendance action did not return a server receipt.",
        receipt: null
      });
    }
  };

  const resetActualAttendance = () => {
    if (!resetDefinitivePostEventActualAttendanceAttempt({
      organizationId: opportunity.organizationId,
      quoteId: opportunity.quoteId,
      closeoutId: opportunity.reviewedAction?.closeoutId
    })) return;
    setMutation({
      state: "recovery",
      itemCode: "actual_attendance",
      action: "",
      error: "",
      receipt: null
    });
  };

  const reviewItems = Array.isArray(opportunity.reviewItems) ? opportunity.reviewItems : [];
  const reviewedCount = reviewItems.filter((item) => item.state === "reviewed").length;
  const itemLabels = {
    internal_closeout: "Internal event review",
    thank_you: "Thank-you opportunity",
    review_request: "Review-request opportunity",
    operational_follow_up: "Operational follow-up"
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
          <h4 id={`post-event-closeout-${text(opportunity.quoteId)}-title`}>Review the event follow-up</h4>
          <p className="closeout-progress">{view.authoritative ? `${reviewedCount} of ${reviewItems.length} items reviewed` : "Review record unavailable"}</p>
          <p className="source-note">Internal review only. Sending a message is a separate action.</p>
          {["scheduled", "blocked_configuration", "completed", "read_only_cue"].includes(view.state) && <p className="source-note">{view.detail}</p>}
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

      <section
        className="post-event-actual-attendance"
        aria-labelledby={`post-event-attendance-${text(opportunity.quoteId)}-title`}
        data-attendance-record-state={actualAttendance ? "confirmed" : "not_recorded"}
      >
        <div className="post-event-actual-attendance__heading">
          <div>
            <p className="eyebrow">Attendance after service</p>
            <h5 id={`post-event-attendance-${text(opportunity.quoteId)}-title`}>
              {actualAttendance
                ? `${actualAttendance.count} guests recorded`
                : "Actual attendance not recorded"}
            </h5>
            {actualAttendance ? (
              <p className="source-note">
                {ACTUAL_ATTENDANCE_SOURCE_LABELS[actualAttendance.sourceType] || "Recorded source"}
                {" · "}{formatWorkspaceDateTime(actualAttendance.recordedAtISO)}
                {" · "}revision {actualAttendance.revision}
                {actualAttendance.recordedBy?.email
                  ? ` · ${actualAttendance.recordedBy.email}`
                  : ""}
              </p>
            ) : (
              <p className="source-note">
                Record the served headcount only when a named source supports it.
              </p>
            )}
          </div>
          <StatusChip
            family={actualAttendance ? "confirmed" : "info"}
            label={actualAttendance ? "Recorded" : "Not recorded"}
          />
        </div>

        {view.authoritative && (
          <form
            className="post-event-actual-attendance__form"
            data-choice-field="post-event-actual-attendance-source"
            onSubmit={(event) => {
              event.preventDefault();
              void runActualAttendance();
            }}
          >
            <label className="field compact-field">
              <span>Actual attendance</span>
              <input
                type="number"
                inputMode="numeric"
                min="1"
                max="400"
                step="1"
                required
                value={attendanceDraft.count}
                disabled={!view.actionable || busy}
                onChange={(event) => setAttendanceDraft((current) => ({
                  ...current,
                  count: event.target.value
                }))}
              />
            </label>
            <AdaptiveChoiceField
              id={`post-event-attendance-${text(opportunity.quoteId)}-source`}
              name="actual-attendance-source"
              label="Attendance source"
              description="Choose who or what established the served headcount."
              options={ACTUAL_ATTENDANCE_SOURCE_OPTIONS}
              value={attendanceDraft.sourceType}
              required
              disabled={!view.actionable || busy}
              onChange={(event) => setAttendanceDraft((current) => ({
                ...current,
                sourceType: event.target.value
              }))}
              placeholder="Choose a source"
            />
            <label className="field compact-field post-event-actual-attendance__note">
              <span>Source note</span>
              <input
                value={attendanceDraft.note}
                maxLength={240}
                required
                disabled={!view.actionable || busy}
                placeholder="Example: Lead server final headcount"
                onChange={(event) => setAttendanceDraft((current) => ({
                  ...current,
                  note: event.target.value
                }))}
              />
            </label>
            <div className="right-actions post-event-actual-attendance__actions">
              {attendanceMutation && mutation.state === "uncertain" ? (
                <button
                  type="button"
                  className="cta compact"
                  onClick={() => void runActualAttendance({ reconcile: true })}
                >
                  Reconcile attendance record
                </button>
              ) : attendanceMutation && mutation.state === "error" ? (
                <button type="button" className="ghost compact" onClick={resetActualAttendance}>
                  Reset rejected attendance
                </button>
              ) : (
                <button
                  type="submit"
                  className="cta compact"
                  disabled={!view.actionable || busy}
                  title={!view.actionable ? view.detail : ""}
                  aria-busy={busy && attendanceMutation}
                >
                  {busy && attendanceMutation
                    ? "Waiting for receipt..."
                    : actualAttendance
                      ? "Correct attendance record"
                      : "Record actual attendance"}
                </button>
              )}
            </div>
          </form>
        )}
        {actualAttendance?.note ? (
          <details className="closeout-item-detail">
            <summary>Attendance evidence</summary>
            <p className="source-note">{actualAttendance.note}</p>
            <p className="source-note">
              Receipt {actualAttendance.sourceReferenceId}. Accepted version{" "}
              {opportunity.reviewedAction?.sourceVersionId || "not available"}.
            </p>
          </details>
        ) : null}
        <p className="source-note">
          Recording attendance does not reprice, invoice, refund, settle payment,
          change staffing, regenerate the BEO, or complete this closeout.
        </p>
      </section>

      <div className="post-event-closeout-items">
        {reviewItems.map((item) => {
          const reviewed = item.state === "reviewed";
          const itemBusy = busy && mutation.itemCode === item.code;
          const needsReconcile = mutation.state === "uncertain" && mutation.itemCode === item.code;
          const needsReset = mutation.state === "error" && mutation.itemCode === item.code;
          return (
            <article className="post-event-closeout-item" key={item.code} data-closeout-item={item.code}>
              <div>
                <strong>{itemLabels[item.code] || item.label}</strong>
                <p className="source-note">{reviewed ? "Reviewed" : "Awaiting review"}</p>
              </div>
              <details className="closeout-item-detail">
                <summary>{notes[item.code] ? "Note added · details" : "Note and details"}</summary>
                <p className="source-note">{item.label}</p>
                <p className="source-note">{reviewed
                  ? `Reviewed ${formatWorkspaceDateTime(item.reviewedAtISO)} by ${formatWorkspaceText(item.reviewedBy, { emptyLabel: "recorded staff" })}.`
                  : "Pending explicit internal review."}</p>
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
              </details>
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
      <details className="staff-evidence-disclosure closeout-supporting-detail" onToggle={(event) => setSupportingDetailsOpen(event.currentTarget.open)}>
        <summary>{learningContext?.enabled ? "Review policy, recorded costs and event learning" : "Review policy and recorded costs"}</summary>
        <p className="source-note">{view.detail}</p>
      {WorkflowPackPolicyPanel && available && view.authoritative && workflowScope?.enabled && <Suspense fallback={<p role="status">Loading closeout coordination...</p>}><WorkflowPackPolicyPanel {...workflowScope} organizationId={opportunity.organizationId} quoteId={opportunity.quoteId} workflowKind="closeout_follow_up" sourceVersionId={opportunity.reviewedAction?.sourceVersionId || ""} sourceReceiptId={opportunity.reviewedAction?.acceptanceReceiptId || ""} domainRevision={mutation.receipt?.receiptId || opportunity.reviewedAction?.completedAtISO || ""} otherMutationBlocked={["submitting", "uncertain", "reconciliation", "error", "recovery"].includes(mutation.state)} /></Suspense>}
      {EventActualsCloseoutSummary && available && view.authoritative && ["due", "overdue", "completed"].includes(view.state) && <Suspense fallback={<p role="status">Loading closeout actuals...</p>}><EventActualsCloseoutSummary {...closeoutActualsSource(opportunity)} available={available} /></Suspense>}
      {supportingDetailsOpen && learningContext?.enabled && available && view.authoritative && ["due", "overdue", "completed"].includes(view.state) && <PostEventLearningPanel
        enabled organizationId={opportunity.organizationId}
        quote={learningContext.quotes?.find((quote) => quote.id === opportunity.quoteId) || {}}
        acceptedVersion={learningContext.versions?.filter((version) => version.quoteId === opportunity.quoteId && (version.versionId || version.id) === opportunity.reviewedAction?.sourceVersionId).length === 1 ? learningContext.versions.find((version) => version.quoteId === opportunity.quoteId && (version.versionId || version.id) === opportunity.reviewedAction?.sourceVersionId) : null}
        closeout={{ ...opportunity.reviewedAction, actualAttendance }} source={workflowScope?.source}
        role={workflowScope?.role} principalId={workflowScope?.principalId}
        inventoryEnabled={learningContext.inventoryEnabled} onReview={learningContext.onReview}
        onRefreshSource={learningContext.onRefreshSource}
      />}
      </details>
    </section>
  );
}
