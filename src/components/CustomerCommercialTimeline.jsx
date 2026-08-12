import { buildCustomerCommercialTimeline } from "../lib/customerCommercialTimeline";
import {
  formatWorkspaceDateTime,
  formatWorkspaceText
} from "../lib/workspacePresentation";

function timelineBoundsSummary(pageInfo = {}) {
  const notes = [];
  if (pageInfo.timelineTruncated) {
    notes.push(`Showing the latest ${pageInfo.returned} of ${pageInfo.candidateCount} recorded milestones.`);
  }
  if (pageInfo.quoteReadTruncated) {
    notes.push(`The client quote read reached its ${pageInfo.quoteReadLimit}-quote bound.`);
  }
  if (pageInfo.versionReadTruncated) {
    notes.push(
      `${pageInfo.versionReadTruncatedQuoteCount} displayed quote${pageInfo.versionReadTruncatedQuoteCount === 1 ? " has" : "s have"} older versions beyond the ${pageInfo.versionPerQuoteLimit}-version bound.`
    );
  }
  return notes.join(" ");
}

export function CustomerCommercialTimelinePresentation({ timeline, onOpenQuote }) {
  const state = timeline?.status || "empty";
  const items = Array.isArray(timeline?.items) ? timeline.items : [];
  const boundsSummary = timelineBoundsSummary(timeline?.pageInfo);

  return (
    <section
      className="customer-commercial-timeline"
      aria-labelledby="customer-commercial-timeline-title"
      data-capability-state={state}
    >
      <div className="workspace-route-head">
        <div>
          <p className="eyebrow">Client history</p>
          <h2 id="customer-commercial-timeline-title">Quotes, decisions, and payments</h2>
        </div>
        <span className="source-note">Source: {timeline?.sourceLabel || "Customer workspace source not confirmed"}</span>
      </div>
      <p className="source-note">{timeline?.evidenceBoundary || "Recorded milestones only."}</p>
      <p className="source-note">
        Provider-reported delivery and bounce milestones are not shown because this bounded client read does not include those receipts.
      </p>
      {state === "partial" && (
        <p className="warning-note" role="status" data-capability-state="partial">
          {boundsSummary || "This history is derived from a bounded client read."}
        </p>
      )}
      {items.length === 0 ? (
        <p className="source-note">No recorded quote, decision, booking, or payment activity is available in this bounded client view.</p>
      ) : (
        <ol className="customer-timeline-list">
          {items.map((item) => (
            <li key={item.id}>
              <div className="customer-timeline-marker" aria-hidden="true" />
              <div className="customer-timeline-content">
                <div className="customer-timeline-heading">
                  <strong>{item.label}</strong>
                  <time dateTime={item.atISO}>{formatWorkspaceDateTime(item.atISO)}</time>
                </div>
                <span className="source-note">{item.sourceLabel}</span>
                <button
                  type="button"
                  className="workspace-text-link"
                  onClick={() => onOpenQuote?.(item.quoteId)}
                >
                  {formatWorkspaceText(item.quoteNumber, { emptyLabel: "Open quote record" })}
                </button>
              </div>
            </li>
          ))}
        </ol>
      )}
    </section>
  );
}

export default function CustomerCommercialTimeline({ workspace, onOpenQuote }) {
  const timeline = buildCustomerCommercialTimeline(workspace);
  return <CustomerCommercialTimelinePresentation timeline={timeline} onOpenQuote={onOpenQuote} />;
}
