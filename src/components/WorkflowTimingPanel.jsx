import StatusChip from "./StatusChip";
import {
  formatWorkspaceDate,
  formatWorkspaceDateTime,
  formatWorkspaceSource,
  formatWorkspaceText,
  humanizeWorkspaceValue
} from "../lib/workspacePresentation";

export const WORKFLOW_TIMING_PANEL_ITEM_LIMIT = 4;

const STATE_PRESENTATION = Object.freeze({
  loading: { family: "info", label: "Loading evidence" },
  refreshing: { family: "pending", label: "Refreshing" },
  error: { family: "failed", label: "Unavailable" },
  stale: { family: "action", label: "Last snapshot retained" },
  partial: { family: "action", label: "Bounded snapshot" },
  empty: { family: "info", label: "No recorded work" },
  success: { family: "confirmed", label: "Current snapshot" }
});

function text(value) {
  return String(value ?? "").trim();
}

function hasSnapshot(loadedAtISO, model) {
  if (!model || typeof model !== "object") return false;
  const parsed = Date.parse(text(loadedAtISO));
  return Number.isFinite(parsed);
}

export function buildWorkflowTimingPanelState({
  loading = false,
  error = "",
  loadedAtISO = "",
  sourceTruncated = false,
  model = null
} = {}) {
  const snapshotAvailable = hasSnapshot(loadedAtISO, model);
  const itemCount = (Array.isArray(model?.cues) ? model.cues.length : 0)
    + (Array.isArray(model?.receipts) ? model.receipts.length : 0);
  let state = "success";
  let displayState = "success";
  if (loading && !snapshotAvailable) state = "loading";
  else if (loading) {
    state = "loading";
    displayState = "refreshing";
  }
  else if (text(error) && snapshotAvailable) state = "stale";
  else if (text(error) || !snapshotAvailable) state = "error";
  else if (sourceTruncated || model?.status === "partial") state = "partial";
  else if (itemCount === 0) state = "empty";

  if (displayState !== "refreshing") displayState = state;
  const detail = {
    loading: "Reading tenant-scoped workflow timestamps.",
    refreshing: "Refreshing now; the last successful timing snapshot remains visible.",
    error: "No successful timing snapshot is available.",
    stale: "The latest refresh failed; the last successful timing snapshot remains visible.",
    partial: "The snapshot is usable, but one or more source or result bounds were reached.",
    empty: "No timestamp-backed cues or internal completion receipts were recorded in this snapshot.",
    success: "Timestamp-backed cues and internal completion receipts are derived from the successful snapshot."
  }[displayState];

  return {
    state,
    displayState,
    detail,
    snapshotAvailable,
    presentation: STATE_PRESENTATION[displayState]
  };
}

function cueTone(cue) {
  if (cue?.timingState === "overdue") return "Overdue";
  if (cue?.timingState === "due_today") return "Due today";
  if (cue?.timingState === "upcoming") return "Upcoming";
  if (cue?.ageBand === "long_waiting") return "Long waiting";
  if (cue?.ageBand === "aging") return "Aging";
  if (cue?.ageBand === "recent") return "Recent";
  return humanizeWorkspaceValue(cue?.timingState, { emptyLabel: "Recorded" });
}

function modelBounds(model, sourceTruncated) {
  const cueInfo = model?.cuePageInfo || {};
  const receiptInfo = model?.receiptPageInfo || {};
  const cueReturned = Number(cueInfo.returned || 0);
  const cueCandidates = Number(cueInfo.candidateCount || 0);
  const receiptReturned = Number(receiptInfo.returned || 0);
  const receiptCandidates = Number(receiptInfo.candidateCount || 0);
  const sourceBounded = sourceTruncated
    || cueInfo.sourceScanTruncated === true
    || receiptInfo.sourceScanTruncated === true;
  return [
    `Model returned ${cueReturned} of ${cueCandidates} scanned cue candidates and ${receiptReturned} of ${receiptCandidates} scanned receipt candidates.`,
    `This panel shows at most ${WORKFLOW_TIMING_PANEL_ITEM_LIMIT} of each.`,
    sourceBounded ? "At least one source scan was bounded, so this is not a complete history." : "The supplied source snapshot was not scan-truncated."
  ].join(" ");
}

function hiddenCount(items) {
  return Math.max(0, items.length - WORKFLOW_TIMING_PANEL_ITEM_LIMIT);
}

function quoteLabel(record) {
  return formatWorkspaceText(record?.quoteNumber, {
    emptyLabel: "Quote number pending"
  });
}

export default function WorkflowTimingPanel({
  model = null,
  loading = false,
  error = "",
  loadedAtISO = "",
  source = "",
  sourceTruncated = false,
  onRetry,
  onReviewCue,
  onOpenReceipt
}) {
  const view = buildWorkflowTimingPanelState({
    loading,
    error,
    loadedAtISO,
    sourceTruncated,
    model
  });
  const cues = view.snapshotAvailable && Array.isArray(model?.cues) ? model.cues : [];
  const receipts = view.snapshotAvailable && Array.isArray(model?.receipts) ? model.receipts : [];
  const shownCues = cues.slice(0, WORKFLOW_TIMING_PANEL_ITEM_LIMIT);
  const shownReceipts = receipts.slice(0, WORKFLOW_TIMING_PANEL_ITEM_LIMIT);
  const canRetry = ["error", "stale"].includes(view.state) && typeof onRetry === "function";
  const stateRole = ["error", "stale"].includes(view.state) ? "alert" : "status";
  const visualState = view.displayState === "error" ? "unavailable" : view.displayState;

  return (
    <aside
      className={`staff-evidence-rail staff-evidence-${visualState}`}
      aria-labelledby="workflow-timing-title"
      data-capability-state={view.state}
      data-read-state={view.displayState}
      data-read-truncation={view.snapshotAvailable
        ? (sourceTruncated || model?.status === "partial" ? "truncated" : "complete")
        : "unknown"}
    >
      <div className="staff-evidence-head">
        <div>
          <p className="eyebrow">Decision timing</p>
          <h3 id="workflow-timing-title">Due cues & completion receipts</h3>
        </div>
        <div className="right-actions">
          <StatusChip {...view.presentation} />
          {canRetry && (
            <button
              type="button"
              className="ghost compact"
              onClick={onRetry}
              data-capability-state="recovery"
            >
              Retry read
            </button>
          )}
        </div>
      </div>

      <p className="staff-evidence-outcome" role={stateRole} aria-live="polite" aria-atomic="true">
        {view.detail}{text(error) ? " Retry to request a new tenant-scoped snapshot." : ""}
      </p>

      {view.snapshotAvailable && (
        <>
          <dl className="staff-evidence-details">
            <div>
              <dt>Source</dt>
              <dd>{formatWorkspaceSource(source)}</dd>
            </div>
            <div>
              <dt>Captured</dt>
              <dd><time dateTime={loadedAtISO}>{formatWorkspaceDateTime(loadedAtISO)}</time></dd>
            </div>
            <div>
              <dt>Calendar context</dt>
              <dd>{formatWorkspaceDate(model?.asOf?.todayISO)}<small>{formatWorkspaceText(model?.asOf?.timeZone, { emptyLabel: "Timezone unavailable" })}</small></dd>
            </div>
            <div>
              <dt>Recorded results</dt>
              <dd>{cues.length} cue{cues.length === 1 ? "" : "s"}<small>{receipts.length} internal receipt{receipts.length === 1 ? "" : "s"}</small></dd>
            </div>
          </dl>

          <p className="staff-evidence-bounds-note">{modelBounds(model, sourceTruncated)}</p>
          <p className="staff-evidence-caveat">{model?.cueEvidenceBoundary}</p>
          <p className="staff-evidence-caveat">{model?.receiptEvidenceBoundary}</p>

          {(shownCues.length > 0 || shownReceipts.length > 0) && (
            <div className="workflow-form-grid">
              <section className="workflow-form-section" aria-labelledby="workflow-derived-cues-title">
                <h4 id="workflow-derived-cues-title">Due & aging cues</h4>
                {shownCues.length === 0 ? (
                  <p className="muted">No current timing cue.</p>
                ) : (
                  <ol className="command-center-list">
                    {shownCues.map((cue) => {
                      const recordLabel = quoteLabel(cue);
                      const evidenceDate = cue.dueDate || cue.recordedAtISO;
                      return (
                        <li className="command-center-row" key={cue.id}>
                          <div className="command-center-row-main">
                            <strong>{recordLabel}</strong>
                            <p className="command-center-row-detail">{cue.label}</p>
                            <p className="command-center-row-meta">
                              {cueTone(cue)} · {cue.sourceLabel}
                            </p>
                            <time dateTime={evidenceDate} className="command-center-row-meta">
                              {cue.dueDate
                                ? formatWorkspaceDate(cue.dueDate)
                                : formatWorkspaceDateTime(cue.recordedAtISO)}
                            </time>
                          </div>
                          {typeof onReviewCue === "function" && (
                            <button
                              type="button"
                              className="ghost compact"
                              onClick={() => onReviewCue(cue)}
                              aria-label={`Review authoritative workflow item — ${recordLabel}`}
                            >
                              Review
                            </button>
                          )}
                        </li>
                      );
                    })}
                  </ol>
                )}
                {hiddenCount(cues) > 0 && (
                  <p className="source-note">
                    {hiddenCount(cues)} more cue{hiddenCount(cues) === 1 ? "" : "s"} {hiddenCount(cues) === 1 ? "remains" : "remain"} in this snapshot.
                  </p>
                )}
              </section>

              <section className="workflow-form-section" aria-labelledby="workflow-receipts-title">
                <h4 id="workflow-receipts-title">Recent internal receipts</h4>
                {shownReceipts.length === 0 ? (
                  <p className="muted">No timestamp-backed internal completion receipt.</p>
                ) : (
                  <ol className="command-center-list">
                    {shownReceipts.map((receipt) => {
                      const recordLabel = quoteLabel(receipt);
                      return (
                        <li className="command-center-row" key={receipt.id}>
                          <div className="command-center-row-main">
                            <strong>{recordLabel}</strong>
                            <p className="command-center-row-detail">{receipt.label}</p>
                            <p className="command-center-row-meta">{receipt.sourceLabel}</p>
                            <time dateTime={receipt.completedAtISO} className="command-center-row-meta">
                              {formatWorkspaceDateTime(receipt.completedAtISO)}
                            </time>
                          </div>
                          {typeof onOpenReceipt === "function" && (
                            <button
                              type="button"
                              className="ghost compact"
                              onClick={() => onOpenReceipt(receipt)}
                              aria-label={`Review authoritative workflow record — ${recordLabel}`}
                            >
                              Review
                            </button>
                          )}
                        </li>
                      );
                    })}
                  </ol>
                )}
                {hiddenCount(receipts) > 0 && (
                  <p className="source-note">
                    {hiddenCount(receipts)} more receipt{hiddenCount(receipts) === 1 ? "" : "s"} {hiddenCount(receipts) === 1 ? "remains" : "remain"} in this snapshot.
                  </p>
                )}
              </section>
            </div>
          )}
        </>
      )}
    </aside>
  );
}
