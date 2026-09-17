import { buildGovernedQuoteStarts } from "../lib/quoteConfidenceDecisionPacket";
export { scheduleGovernedTemplateDestinationFocus } from "./governedQuoteStartFocus";
import "./quoteConfidenceSurfaces.css";

export default function GovernedQuoteStarts({
  enabled = false,
  templates = [],
  onUseBlank,
  onReviewTemplate,
  onReviewPriorAccepted
}) {
  if (!enabled) return null;
  const starts = buildGovernedQuoteStarts({ templates });
  const handlers = {
    blank: onUseBlank,
    template: onReviewTemplate,
    prior_accepted: onReviewPriorAccepted
  };
  const labels = {
    blank: "Continue blank quote",
    template: "Review template in this draft",
    prior_accepted: "Choose exact accepted event"
  };
  return (
    <section
      className="governed-quote-starts"
      data-capability-id="governed-quote-starts"
      data-capability-state="ready"
      aria-labelledby="governed-quote-starts-title"
    >
      <header>
        <div>
          <p className="eyebrow">Start with known context</p>
          <h2 id="governed-quote-starts-title">Choose how this draft begins</h2>
        </div>
        <p>Every path enters the existing quote draft and keeps its normal review.</p>
      </header>
      <div className="governed-quote-starts__grid">
        {starts.map((start) => {
          const handler = handlers[start.id];
          const enabledAction = Boolean(start.action && typeof handler === "function");
          return (
            <article key={start.id} data-start-kind={start.id} data-evidence-state={start.availability}>
              <div className="governed-quote-starts__state">
                <span>{start.availability === "available" ? "Available" : start.availability === "review_required" ? "Exact source required" : "Unavailable"}</span>
              </div>
              <h3>{start.label}</h3>
              <dl>
                <div>
                  <dt>Source</dt>
                  <dd>{start.provenance}</dd>
                </div>
                <div>
                  <dt>Required review</dt>
                  <dd>{start.reviewBoundary}</dd>
                </div>
              </dl>
              {start.id === "template" && start.templates?.length ? (
                <p className="governed-quote-starts__detail">
                  {start.templates.length} current template{start.templates.length === 1 ? "" : "s"} available.
                </p>
              ) : null}
              {enabledAction ? (
                <button type="button" className="ghost compact" onClick={() => handler(start)}>
                  {labels[start.id]}
                </button>
              ) : (
                <p className="governed-quote-starts__detail">Use Library to make a reviewed template available.</p>
              )}
            </article>
          );
        })}
      </div>
      <p className="governed-quote-starts__boundary">
        No start saves, prices, sends, accepts, books, or charges. The existing quote, template, and exact-version rebook authorities remain unchanged.
      </p>
    </section>
  );
}
