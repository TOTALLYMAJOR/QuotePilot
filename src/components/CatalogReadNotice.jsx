import "./catalogReadNotice.css";

export default function CatalogReadNotice({
  canContinue = true,
  loading = false,
  onRetry,
  headingLevel = 3,
  titleId = "catalog-read-notice-title"
}) {
  const Heading = `h${Math.min(6, Math.max(1, Number(headingLevel) || 3))}`;
  const title = canContinue
    ? "Catalog updates are unavailable."
    : "The catalog couldn’t load.";
  const description = canContinue
    ? "You can keep outlining this event, but package, menu, and pricing choices may be incomplete until the catalog reconnects."
    : "QuotePilot needs the organization catalog before quote creation can continue. Try again; no catalog or quote record changed.";

  return (
    <section
      className="catalog-read-notice"
      role="status"
      aria-live="polite"
      aria-labelledby={titleId}
      data-catalog-state="unavailable"
      data-catalog-continuation={canContinue ? "available" : "blocked"}
    >
      <p className="eyebrow">Catalog connection</p>
      <Heading id={titleId}>{title}</Heading>
      <p>{description}</p>
      {canContinue && (
        <p className="catalog-read-notice__authority">
          Nothing in this draft was saved or repriced by the failed read.
        </p>
      )}
      {typeof onRetry === "function" && (
        <button
          type="button"
          className="ghost catalog-read-notice__retry"
          onClick={onRetry}
          disabled={loading}
        >
          {loading ? "Checking catalog…" : "Try catalog again"}
        </button>
      )}
    </section>
  );
}
