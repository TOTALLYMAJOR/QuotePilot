import { quoteCatalogReviewCapabilityState } from "../lib/quoteCatalogRevisionReview";

const FIELD_LABELS = Object.freeze({
  name: "Name",
  availability: "Availability",
  price_basis: "Price basis",
  price: "Price",
  quantity_rule: "Rental quantity rule",
  server_rate: "Server rate",
  chef_rate: "Chef rate",
  bartender_rate: "Bartender rate",
  staffing_charge_mode: "Staffing policy"
});

function value(value) {
  if (value === null || value === undefined || value === "") return "Not available";
  if (value === true) return "Available";
  if (value === false) return "Unavailable";
  return String(value);
}

export default function QuoteCatalogRevisionReviewPanel({
  review = null,
  loading = false,
  error = "",
  submitting = false,
  resolvedOutcome = "",
  receipt = null,
  onRetry,
  onKeepQuotedValues,
  onReviewAndUpdate
}) {
  const state = quoteCatalogReviewCapabilityState({ loading, error, review, submitting, receipt });
  return (
    <section
      className="quote-catalog-revision-review"
      data-capability-id="quote-catalog-revision-review"
      data-capability-state={state}
      aria-labelledby="quote-catalog-review-title"
    >
      <div className="quote-catalog-revision-review__head">
        <div>
          <p className="eyebrow">Catalog revision</p>
          <h3 id="quote-catalog-review-title">{review?.headline || "Checking saved quote pricing…"}</h3>
          <p className="source-note">
            {review?.state === "current" && "This quote uses the current confirmed catalog."}
            {review?.state === "newer_catalog_no_selected_impact" && "The catalog is newer, but none of this quote’s selected commercial inputs changed."}
            {review?.state === "review_required" && "Nothing was silently repriced. Choose whether to preserve the saved commercial plan or review it against today’s catalog."}
            {review?.state === "legacy_unknown" && "This legacy quote has no trustworthy historical catalog revision. Saved values remain visible and unchanged."}
            {review?.state === "unavailable" && "Current catalog authority is unavailable, so QuotePilot cannot claim a comparison."}
          </p>
        </div>
        {review?.quotedCatalogRevision !== null && review?.quotedCatalogRevision !== undefined && (
          <span className="status-chip status-chip-pending">Quoted at revision {review.quotedCatalogRevision}</span>
        )}
      </div>

      {error && <p className="warning-note" role="alert">{error}</p>}
      {loading && <p role="status">Loading authoritative revision review…</p>}
      {Array.isArray(review?.diffs) && review.diffs.length > 0 && (
        <ul className="quote-catalog-revision-review__diffs" aria-label="Catalog changes affecting this quote">
          {review.diffs.map((diff) => (
            <li key={diff.id}>
              <strong>{diff.label}</strong>
              <span>{FIELD_LABELS[diff.field] || diff.field}</span>
              <small>Quoted: {value(diff.quotedValue)} → Current: {value(diff.currentValue)}</small>
            </li>
          ))}
        </ul>
      )}
      {review?.rateProvenance && (
        <dl className="quote-catalog-revision-review__rates">
          <div><dt>Server</dt><dd>{review.rateProvenance.server}</dd></div>
          <div><dt>Chef</dt><dd>{review.rateProvenance.chef}</dd></div>
          <div><dt>Bartender</dt><dd>{review.rateProvenance.bartender}</dd></div>
        </dl>
      )}
      {receipt?.receiptId && (
        <p className="success-note" role="status">
          {resolvedOutcome === "keep_quoted_values"
            ? "Quoted values preserved for this saved version."
            : "Current-catalog review recorded; authoritative Change Impact is required before save."}
        </p>
      )}
      <div className="quote-catalog-revision-review__actions">
        {error && <button type="button" className="ghost" onClick={onRetry}>Retry review</button>}
        {!resolvedOutcome && !review?.terminal && ["review_required", "legacy_unknown"].includes(review?.state) && (
          <>
            <button type="button" className="ghost" onClick={onKeepQuotedValues} disabled={submitting}>
              Keep quoted values
            </button>
            <button type="button" className="cta" onClick={onReviewAndUpdate} disabled={submitting || review?.state === "unavailable"}>
              Review and update
            </button>
          </>
        )}
        {review?.terminal && <p className="source-note">Terminal quotes stay immutable. Duplicate or reopen this quote to make a new commercial plan.</p>}
      </div>
    </section>
  );
}
