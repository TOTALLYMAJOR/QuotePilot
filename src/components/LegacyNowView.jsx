import { useMemo } from "react";
import DecisionCard from "./DecisionCard";
import StatusChip from "./StatusChip";
import StaffEvidenceRail from "quotepilot-active-staff-evidence";
import { useWorkspaceRouteHeadingFocus } from "../hooks/useWorkspaceRouteHeadingFocus";
import {
  buildMoneyRows,
  selectUpcomingEvents,
  summarizeMoneyRows
} from "./LegacyCommandCenterHome";
import { buildNowCards, describeNowEmptyState } from "./nowPresentation";
import { classifyQuoteStatus } from "../lib/statusSemantics";
import {
  formatWorkspaceDate,
  formatWorkspaceInteger,
  formatWorkspaceMoney,
  formatWorkspaceText,
  hasWorkspaceNumber
} from "../lib/workspacePresentation";

// Flag-gated NOW surface: the same bounded commercial snapshot the Command
// Center consumes, re-presented as interpreted decision cards. It adds no
// reads, no new evidence, and no new authority — resolution targets are the
// exact Workflow/quote/customer routes the existing rows already use.
export default function NowView({
  snapshot,
  organizationName = "",
  organizationId = "",
  onRefresh,
  onOpenWorkflow,
  onOpenQuote,
  onOpenCustomer,
  onNewQuote,
  nowDate = null
}) {
  const state = snapshot || {
    loading: true,
    error: "",
    attentionSummary: null,
    quotes: [],
    truncated: false
  };
  const attentionItems = state.attentionSummary?.items || [];
  const { cards, overflowCount } = useMemo(
    () => buildNowCards({ items: attentionItems, quotes: state.quotes }),
    [attentionItems, state.quotes]
  );

  const today = nowDate instanceof Date ? nowDate : new Date();
  const upcomingEvents = useMemo(
    () => selectUpcomingEvents(state.quotes, { nowDate: today }),
    [state.quotes, today.toDateString()]
  );
  const moneyRows = useMemo(() => buildMoneyRows(state.quotes), [state.quotes]);
  const moneyTotals = useMemo(() => summarizeMoneyRows(moneyRows), [moneyRows]);
  const headingRef = useWorkspaceRouteHeadingFocus(true);

  const dayLabel = today.toLocaleDateString(undefined, { weekday: "long" });
  const dateLabel = today.toLocaleDateString(undefined, { month: "short", day: "numeric" });

  const runAction = (action) => {
    const target = action?.target || {};
    if (target.surface === "customer" && target.customerId && typeof onOpenCustomer === "function") {
      onOpenCustomer(target.customerId);
      return;
    }
    if (target.surface === "quote" && target.quoteId && typeof onOpenQuote === "function") {
      onOpenQuote(target.quoteId);
      return;
    }
    onOpenWorkflow?.({
      quoteId: target.quoteId,
      attentionType: target.attentionType,
      requestId: target.requestId || ""
    });
  };

  return (
    <section className="panel now-surface" aria-labelledby="now-heading">
      <div className="command-center-head">
        <div>
          <p className="eyebrow">Now</p>
          <h2
            ref={headingRef}
            id="now-heading"
            className="workspace-route-heading"
            tabIndex={-1}
          >
            What to review today
          </h2>
          <p className="now-date">{dayLabel} · {dateLabel}</p>
        </div>
        <div className="right-actions">
          <button
            type="button"
            className="ghost"
            onClick={() => onRefresh?.({ force: true })}
            disabled={state.loading}
          >
            {state.loading ? "Refreshing..." : "Refresh"}
          </button>
          <button type="button" className="cta" onClick={onNewQuote}>New quote</button>
        </div>
      </div>

      <StaffEvidenceRail
        organizationName={organizationName}
        organizationId={organizationId}
        source={state.source}
        loadedAt={state.loadedAt}
        loading={state.loading}
        error={state.error}
        partial={state.partial}
        stale={state.stale}
        truncated={state.truncated}
        truncationKnown={state.truncationKnown}
        reads={state.reads}
      />

      {state.error && <p className="error-note" role="alert">{state.error}</p>}

      <div className="now-grid">
        <div className="now-stream">
          {state.loading && !state.attentionSummary && (
            <p className="source-note">Loading attention items...</p>
          )}
          {!state.loading && !cards.length && !state.error && (
            <p className="source-note">{describeNowEmptyState({ truncated: state.truncated })}</p>
          )}
          {cards.map((card) => (
            <DecisionCard
              key={card.id}
              signal={card.signal}
              family={card.family}
              label={card.label}
              title={card.title}
              meta={card.meta}
              sentence={card.sentence}
              actions={[{ ...card.action, kind: "primary" }]}
              onAction={runAction}
            />
          ))}
          {overflowCount > 0 && (
            <button
              type="button"
              className="ghost command-center-more"
              onClick={() => onOpenWorkflow?.({})}
            >
              View {overflowCount} more in Workflow
            </button>
          )}
        </div>

        <div className="now-rail">
          <div className="command-center-rail-section">
            <h3>Next 7 days</h3>
            {!state.loading && !upcomingEvents.length && !state.error && (
              <p className="source-note">No accepted or booked events in the next 7 days.</p>
            )}
            {upcomingEvents.slice(0, 3).map((quote) => {
              const { family, label } = classifyQuoteStatus(quote.status);
              return (
                <div key={quote.id} className="now-rail-row">
                  <div>
                    <p className="now-rail-detail">
                      <strong>{formatWorkspaceText(quote.event?.name || quote.quoteNumber, { emptyLabel: "Untitled event" })}</strong>
                      {" · "}{formatWorkspaceDate(quote.event?.date)}
                    </p>
                    <p className="now-rail-meta">
                      {formatWorkspaceInteger(quote.event?.guests, { emptyLabel: "Guest count not set" })}
                      {hasWorkspaceNumber(quote.event?.guests) ? " guests" : ""}
                      {" · "}<StatusChip family={family} label={label} />
                    </p>
                  </div>
                  <button type="button" className="ghost" onClick={() => onOpenQuote?.(quote.id)}>Open</button>
                </div>
              );
            })}
          </div>

          <div className="command-center-rail-section">
            <h3>Money</h3>
            {!state.loading && !moneyRows.length && !state.error && (
              <p className="source-note">No payments awaiting action. Requests become available after a proposal is accepted.</p>
            )}
            {moneyRows.length > 0 && (
              <div className="command-center-money-summary">
                <div>
                  <span>Requested, awaiting customer</span>
                  <strong>{formatWorkspaceMoney(moneyTotals.requested)}{moneyTotals.requestedUnknown > 0 ? " known" : ""}</strong>
                  {moneyTotals.requestedUnknown > 0 && (
                    <small>{moneyTotals.requestedUnknown} amount{moneyTotals.requestedUnknown === 1 ? "" : "s"} not recorded</small>
                  )}
                </div>
                <div>
                  <span>Not yet requested</span>
                  <strong>{formatWorkspaceMoney(moneyTotals.outstanding)}{moneyTotals.outstandingUnknown > 0 ? " known" : ""}</strong>
                  {moneyTotals.outstandingUnknown > 0 && (
                    <small>{moneyTotals.outstandingUnknown} amount{moneyTotals.outstandingUnknown === 1 ? "" : "s"} not recorded</small>
                  )}
                </div>
              </div>
            )}
            {moneyRows.slice(0, 3).map((row, index) => (
              <div key={`${row.quoteId}-${row.kind}-${index}`} className="now-rail-row">
                <div>
                  <p className="now-rail-detail">{row.kind} · {formatWorkspaceMoney(row.amount)}</p>
                  <p className="now-rail-meta">
                    {row.customerName}
                    {" · "}<StatusChip family={row.family} label={row.label} />
                  </p>
                </div>
                <button type="button" className="ghost" onClick={() => onOpenQuote?.(row.quoteId)}>Open</button>
              </div>
            ))}
          </div>
        </div>
      </div>
    </section>
  );
}
