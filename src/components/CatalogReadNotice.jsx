import "./catalogReadNotice.css";

export default function CatalogReadNotice({
  canContinue = true,
  loading = false,
  onRetry,
  headingLevel = 3,
  titleId = "catalog-read-notice-title",
  technicalDetail = ""
}) {
  const Heading = `h${Math.min(6, Math.max(1, Number(headingLevel) || 3))}`;
  const title = canContinue
    ? "Library choices are temporarily unavailable."
    : "Library is required to start this quote.";
  const description = canContinue
    ? "You can keep recording event details, but offers, menus, rentals, and pricing choices cannot be confirmed until the Library reconnects."
    : "QuotePilot needs the organization Library before quote creation can continue. Try again; no Library or quote record changed.";

  return (
    <section
      className="catalog-read-notice"
      role="status"
      aria-live="polite"
      aria-labelledby={titleId}
      data-catalog-state="unavailable"
      data-catalog-continuation={canContinue ? "available" : "blocked"}
    >
      <p className="eyebrow">Library status</p>
      <Heading id={titleId}>{title}</Heading>
      <p>{description}</p>
      {canContinue && (
        <p className="catalog-read-notice__authority">
          The published Library remains unchanged. Nothing in this draft was saved or repriced by the failed read.
        </p>
      )}
      {String(technicalDetail || "").trim() && (
        <details className="catalog-read-notice__details">
          <summary>Technical details</summary>
          <p>{technicalDetail}</p>
        </details>
      )}
      {typeof onRetry === "function" && (
        <button
          type="button"
          className="ghost catalog-read-notice__retry"
          onClick={onRetry}
          disabled={loading}
        >
          {loading ? "Loading Library…" : "Try loading Library again"}
        </button>
      )}
    </section>
  );
}
