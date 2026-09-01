import { useState } from "react";

export function catalogDraftCapabilityState(draftState = {}) {
  const status = draftState?.status || "idle";
  if (status === "saving") return "submitting";
  if (status === "conflict") return "reconciliation";
  if (status === "saved" && draftState?.receipt) return "receipt";
  if (status === "sync_failed" && draftState?.deviceOnly) return "uncertain";
  if (status === "recovery") return "recovery";
  if (status === "error" || status === "sync_failed") return "error";
  return "ready";
}

export default function CatalogDraftStateBar({
  draftState,
  disabled = false,
  onRetry,
  onReview,
  onPublish
}) {
  const [reviewing, setReviewing] = useState(false);
  const [publishing, setPublishing] = useState(false);
  const [review, setReview] = useState(null);
  const [error, setError] = useState("");
  const status = draftState?.status || "idle";
  const changedRecordCount = Number(draftState?.changedRecordCount || 0);
  const busy = status === "saving" || reviewing || publishing;
  const canReview = changedRecordCount > 0
    && !draftState?.deviceOnly
    && status !== "conflict"
    && !busy;

  const handleReview = async () => {
    setReviewing(true);
    setError("");
    try {
      const result = await onReview?.();
      setReview(result || null);
    } catch (nextError) {
      setReview(null);
      setError(nextError?.message || "Catalog review failed.");
    } finally {
      setReviewing(false);
    }
  };

  const handlePublish = async () => {
    setPublishing(true);
    setError("");
    try {
      await onPublish?.();
      setReview(null);
    } catch (nextError) {
      setError(nextError?.message || "Catalog publication failed.");
    } finally {
      setPublishing(false);
    }
  };

  return (
    <aside
      className="catalog-draft-state-bar"
      data-capability-id="catalog-draft-publish-authority"
      data-capability-state={catalogDraftCapabilityState(draftState)}
      aria-label="Catalog draft status"
    >
      <div>
        <strong role="status" aria-live="polite">{draftState?.label || "Draft saved"}</strong>
        <small>
          {draftState?.deviceOnly
            ? "These edits remain on this device until synchronization succeeds."
            : changedRecordCount > 0
              ? `${changedRecordCount} changed ${changedRecordCount === 1 ? "record" : "records"}; active pricing is unchanged.`
              : "The published catalog is the active pricing authority."}
        </small>
        {(error || draftState?.error) && <span className="field-error">{error || draftState.error}</span>}
      </div>
      <div className="catalog-draft-state-actions">
        {(status === "sync_failed" || draftState?.deviceOnly) && (
          <button type="button" className="ghost" onClick={onRetry} disabled={disabled || busy}>
            Retry sync
          </button>
        )}
        {review?.readyToPublish ? (
          <button type="button" className="cta" onClick={handlePublish} disabled={disabled || busy}>
            {publishing ? "Publishing…" : "Publish reviewed catalog"}
          </button>
        ) : (
          <button type="button" className="cta" onClick={handleReview} disabled={disabled || !canReview}>
            {reviewing ? "Reviewing…" : "Review and publish catalog"}
          </button>
        )}
      </div>
    </aside>
  );
}
