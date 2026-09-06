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

export function catalogDraftOperatorPresentation(draftState = {}, {
  publishedCatalogAvailable = true
} = {}) {
  const status = draftState?.status || "idle";
  const changedRecordCount = Number(draftState?.changedRecordCount || 0);
  const unchangedOutcome = publishedCatalogAvailable
    ? "Published pricing remains active."
    : "No shared catalog or pricing changed.";
  if (status === "saving") {
    return {
      title: "Saving the Library draft",
      description: "Publication stays unavailable until the draft save finishes."
    };
  }
  if (status === "conflict") {
    return {
      title: "A newer Library version needs attention",
      description: "This draft was not published. Load the latest shared version and reconcile the changes before trying again."
    };
  }
  if (status === "saved" && draftState?.receipt) {
    return {
      title: publishedCatalogAvailable ? "Library published" : "Library update recorded locally",
      description: publishedCatalogAvailable
        ? "The published catalog is active for new quote calculations."
        : "Publishing is unavailable from this source. No shared catalog or pricing changed."
    };
  }
  if (status === "sync_failed" && draftState?.deviceOnly) {
    return {
      title: "Library changes are waiting to save",
      description: `The changes are preserved here, but they are not in the shared draft and cannot be published yet. ${unchangedOutcome}`
    };
  }
  if (status === "sync_failed" && changedRecordCount === 0) {
    return publishedCatalogAvailable
      ? {
          title: "Library draft is unavailable",
          description: "You can inspect the published Library, but changes cannot be checked or published right now. Published pricing remains active."
        }
      : {
          title: "Library is available in this workspace",
          description: "The shared draft cannot be reached from this source. Publishing remains unavailable, and no shared catalog or pricing changed."
        };
  }
  if (status === "recovery") {
    return {
      title: "Library needs to reconnect",
      description: `The draft cannot be checked or published right now. ${unchangedOutcome}`
    };
  }
  if (status === "error" || status === "sync_failed") {
    return {
      title: "The Library draft could not be saved",
      description: publishedCatalogAvailable
        ? "Nothing was published. The current published catalog and pricing remain active."
        : "Nothing was published. No shared catalog or pricing changed."
    };
  }
  if (!publishedCatalogAvailable) {
    return changedRecordCount > 0
      ? {
          title: "Library changes are in this workspace only",
          description: `${changedRecordCount} ${changedRecordCount === 1 ? "change is" : "changes are"} available here. Publishing is unavailable from this source. No shared catalog or pricing changed.`
        }
      : {
          title: "Library is available in this workspace",
          description: "Publishing is unavailable from this source. No shared catalog or pricing changed."
        };
  }
  if (changedRecordCount > 0) {
    return {
      title: "Draft ready to check",
      description: `${changedRecordCount} ${changedRecordCount === 1 ? "change is" : "changes are"} in the shared draft. ${unchangedOutcome}`
    };
  }
  return {
    title: "Published Library is active",
    description: "New quotes use the current published catalog and pricing."
  };
}

export default function CatalogDraftStateBar({
  draftState,
  publishedCatalogAvailable = true,
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
    && publishedCatalogAvailable
    && !draftState?.deviceOnly
    && status !== "conflict"
    && !busy;
  const showReviewAction = changedRecordCount > 0
    && publishedCatalogAvailable
    && !draftState?.deviceOnly
    && status !== "conflict"
    && (canReview || reviewing);
  const presentation = catalogDraftOperatorPresentation(draftState, {
    publishedCatalogAvailable
  });
  const technicalDetail = (
    error
    || draftState?.error
    || ["conflict", "sync_failed", "recovery", "error"].includes(status)
  )
    ? [draftState?.label, error || draftState?.error]
      .map((value) => String(value || "").trim())
      .filter(Boolean)
      .filter((value, index, values) => values.indexOf(value) === index)
      .join(" — ")
    : "";

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
      aria-label="Library draft status"
    >
      <div>
        <strong role="status" aria-live="polite">{presentation.title}</strong>
        <small>{presentation.description}</small>
        {technicalDetail && (
          <details className="admin-menu-disclosure catalog-draft-state-details">
            <summary>Technical details</summary>
            <div className="admin-menu-disclosure-body">
              <small>{technicalDetail}</small>
            </div>
          </details>
        )}
      </div>
      <div className="catalog-draft-state-actions">
        {!busy && (status === "sync_failed" || draftState?.deviceOnly) && (
          <button type="button" className="ghost" onClick={onRetry} disabled={disabled || busy}>
            {draftState?.deviceOnly ? "Try saving again" : "Try reconnecting"}
          </button>
        )}
        {review?.readyToPublish && publishedCatalogAvailable ? (
          <button type="button" className="cta" onClick={handlePublish} disabled={disabled || busy}>
            {publishing ? "Publishing…" : "Publish Library"}
          </button>
        ) : showReviewAction ? (
          <button type="button" className="cta" onClick={handleReview} disabled={disabled || !canReview}>
            {reviewing ? "Checking…" : "Check draft before publishing"}
          </button>
        ) : null}
      </div>
    </aside>
  );
}
