import { useMemo, useState } from "react";
import StatusChip from "./StatusChip";
import StaffEvidenceRail from "./StaffEvidenceRail";
import { useWorkspaceRouteHeadingFocus } from "../hooks/useWorkspaceRouteHeadingFocus";
import { getWorkflowAttentionFocusId } from "../lib/quoteWorkflow";
import {
  classifyAttentionItem,
  classifyQuoteStatus
} from "../lib/statusSemantics";
import {
  buildMoneyRows,
  selectUpcomingEvents,
  summarizeMoneyRows,
  UPCOMING_WINDOW_DAYS
} from "../lib/commandCenterEvidence";
import {
  formatWorkspaceDate,
  formatWorkspaceInteger,
  formatWorkspaceMoney,
  formatWorkspaceText,
  hasWorkspaceNumber
} from "../lib/workspacePresentation";

const ATTENTION_ROW_LIMIT = 8;

export { buildMoneyRows, selectUpcomingEvents, summarizeMoneyRows } from "../lib/commandCenterEvidence";

export function attentionRowCopy(item) {
  const customerName = String(item.quote?.customer?.name || item.quote?.customer?.email || "Customer").trim();
  const quoteLabel = formatWorkspaceText(item.quote?.quoteNumber, { emptyLabel: "Quote number pending" });
  const meta = [customerName, quoteLabel].filter(Boolean).join(" · ");

  if (item.type === "change_request") {
    const message = String(item.sourceMessage || "").trim();
    return { detail: message || "The customer request has no readable message.", meta, customerName, quoteLabel };
  }
  if (item.type === "follow_up") {
    const overdueLabel = item.daysOverdue > 0
      ? `${item.daysOverdue} day${item.daysOverdue === 1 ? "" : "s"} overdue`
      : "Due today";
    return { detail: overdueLabel, meta, customerName, quoteLabel };
  }
  if (item.type === "post_event_closeout") {
    const detail = item.state === "blocked_source"
      ? "This booked legacy record needs accepted-source review before authoritative closeout actions are available."
      : item.state === "blocked_configuration"
      ? "Set a valid business time zone before internal closeout review can be recorded."
      : item.daysOverdue > 0
        ? `${item.daysOverdue} day${item.daysOverdue === 1 ? "" : "s"} overdue`
        : "Due today";
    return { detail, meta, customerName, quoteLabel };
  }
  if (item.type === "unread_customer_reply") {
    return {
      detail: "A customer reply is waiting in the quote conversation.",
      meta,
      customerName,
      quoteLabel
    };
  }
  if (item.type === "anniversary_rebooking") {
    const eventName = formatWorkspaceText(item.eventName, { emptyLabel: "Prior event" });
    const boundWarning = item.sourceBound?.truncated
      ? " The latest quote-history scan is incomplete; check the client overview for older or matching records."
      : "";
    const calendarWarning = item.calendarContext?.source === "tenant"
      ? ""
      : ` ${formatWorkspaceText(item.calendarContext?.label, { emptyLabel: "Fallback anniversary calendar" })}.`;
    return {
      detail: `${eventName} was booked this week last year. Review the exact accepted source before creating or resuming a rebook draft.${boundWarning}${calendarWarning}`,
      meta,
      customerName,
      quoteLabel
    };
  }
  const count = Array.isArray(item.pendingRequests) ? item.pendingRequests.length : 0;
  return { detail: `${count} pending approval${count === 1 ? "" : "s"}`, meta, customerName, quoteLabel };
}

export default function CommandCenterHome({
  snapshot,
  organizationName = "",
  organizationId = "",
  onRefresh,
  onOpenWorkflow,
  onOpenQuote,
  onOpenCustomer,
  onNewQuote,
  ambientMode = false
}) {
  const state = snapshot || {
    loading: true,
    error: "",
    attentionSummary: null,
    quotes: [],
    truncated: false
  };
  const attentionItems = state.attentionSummary?.items || [];
  const [additionalAttentionVisible, setAdditionalAttentionVisible] = useState(false);
  const hiddenAttentionCount = Math.max(0, attentionItems.length - ATTENTION_ROW_LIMIT);
  const visibleAttentionItems = ambientMode && additionalAttentionVisible
    ? attentionItems
    : attentionItems.slice(0, ATTENTION_ROW_LIMIT);
  const attentionOverflow = Math.max(0, attentionItems.length - visibleAttentionItems.length);
  const hasAnyAttention = attentionItems.length > 0;

  const upcomingEvents = useMemo(
    () => selectUpcomingEvents(state.quotes),
    [state.quotes]
  );
  const hasAnyEvents = upcomingEvents.length > 0;

  const moneyRows = useMemo(() => buildMoneyRows(state.quotes), [state.quotes]);
  const moneyTotals = useMemo(() => summarizeMoneyRows(moneyRows), [moneyRows]);
  const headingRef = useWorkspaceRouteHeadingFocus(true);

  const isRefreshing = state.loading;

  const openWorkflowItem = (item) => {
    onOpenWorkflow?.({
      quoteId: item.quoteId,
      attentionType: item.type,
      requestId: getWorkflowAttentionFocusId(item)
    });
  };

  const customerLabel = (quote) => {
    const label = quote?.customer?.name || quote?.customer?.email || "Customer";
    if (!quote?.customerId || typeof onOpenCustomer !== "function") return label;
    return (
      <button
        type="button"
        className="command-center-customer-link"
        onClick={() => onOpenCustomer(quote.customerId)}
      >
        {label}
      </button>
    );
  };

  return (
    <section className="panel command-center" aria-labelledby="command-center-heading">
      <div className="command-center-head">
        <div>
          <p className="eyebrow">Now</p>
          <h2
            ref={headingRef}
            id="command-center-heading"
            className="workspace-route-heading"
            tabIndex={-1}
          >
            What needs your attention
          </h2>
        </div>
        <div className="right-actions">
          <button
            type="button"
            className="ghost"
            onClick={() => onRefresh?.({ force: true })}
            disabled={isRefreshing}
          >
            {isRefreshing ? "Refreshing..." : "Refresh"}
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

      <div className="command-center-grid">
        <div
          className="command-center-inbox"
          data-capability-id="cwf-12-central-attention"
        >
          <h3>Needs your attention</h3>
          {state.loading && !state.attentionSummary && (
            <p className="source-note">Loading attention items...</p>
          )}
          {!state.loading && !hasAnyAttention && !state.error && (
            <p className="source-note">
              {state.truncated
                ? "No attention appears in this bounded snapshot. Additional records may remain outside the completed reads."
                : "Nothing needs you right now. New customer replies, change requests, overdue follow-ups, post-event closeouts, repeat-event opportunities, and pending approvals will appear here."}
            </p>
          )}
          {hasAnyAttention && (
            <ul className="command-center-list" id="command-center-attention-items">
              {visibleAttentionItems.map((item) => {
                const { family, label } = classifyAttentionItem(item.type, item.state);
                const attentionQuote = state.quotes.find((quote) => quote.id === item.quoteId) || item.quote || {};
                const { detail, customerName, quoteLabel } = attentionRowCopy({ ...item, quote: attentionQuote });
                return (
                  <li
                    key={item.id}
                    className="command-center-row"
                    {...(item.type === "anniversary_rebooking" ? {
                      "data-capability-id": "cwf-11-central-anniversary-attention",
                      "data-capability-state": "verification_required"
                    } : {})}
                  >
                    <div className="command-center-row-main">
                      <StatusChip family={family} label={label} />
                      <p className="command-center-row-detail">{detail}</p>
                      <p className="command-center-row-meta">
                        {attentionQuote.customerId ? customerLabel(attentionQuote) : customerName}
                        {quoteLabel ? <> · {quoteLabel}</> : null}
                      </p>
                    </div>
                    <button
                      type="button"
                      className="ghost"
                      data-capability-action={item.type === "anniversary_rebooking"
                        ? "open-exact-version-rebook-review"
                        : undefined}
                      onClick={() => {
                        if (
                          item.type === "anniversary_rebooking"
                          && attentionQuote.customerId
                          && typeof onOpenCustomer === "function"
                        ) {
                          onOpenCustomer(attentionQuote.customerId);
                          return;
                        }
                        openWorkflowItem(item);
                      }}
                    >
                      {item.type === "anniversary_rebooking" ? "Review rebook" : "Open in Workflow"}
                    </button>
                  </li>
                );
              })}
            </ul>
          )}
          {(ambientMode ? hiddenAttentionCount > 0 : attentionOverflow > 0) && (
            <button
              type="button"
              className="ghost command-center-more"
              aria-controls={ambientMode ? "command-center-attention-items" : undefined}
              aria-expanded={ambientMode ? additionalAttentionVisible : undefined}
              onClick={ambientMode
                ? () => setAdditionalAttentionVisible((visible) => !visible)
                : () => onOpenWorkflow?.({})}
            >
              {ambientMode
                ? additionalAttentionVisible
                  ? "Show fewer attention items"
                  : `Show ${hiddenAttentionCount} more here`
                : `View ${attentionOverflow} more in Workflow`}
            </button>
          )}
        </div>

        <div className="command-center-rail">
          <div className="command-center-rail-section">
            <h3>Next {UPCOMING_WINDOW_DAYS} days</h3>
            {state.loading && !hasAnyEvents && <p className="source-note">Loading events...</p>}
            {!state.loading && !hasAnyEvents && !state.error && (
              <p className="source-note">No accepted or booked events in the next {UPCOMING_WINDOW_DAYS} days.</p>
            )}
            {hasAnyEvents && (
              <ul className="command-center-list">
                {upcomingEvents.slice(0, 5).map((quote) => {
                  const { family, label } = classifyQuoteStatus(quote.status);
                  return (
                    <li key={quote.id} className="command-center-row">
                      <div className="command-center-row-main">
                        <p className="command-center-row-detail">
                          <strong>{formatWorkspaceText(quote.event?.name || quote.quoteNumber, { emptyLabel: "Untitled event" })}</strong>
                          {" · "}{formatWorkspaceDate(quote.event?.date)}
                        </p>
                        <p className="command-center-row-meta">
                          {customerLabel(quote)} · {formatWorkspaceText(quote.event?.venue, { emptyLabel: "Venue not set" })}
                          {" · "}{formatWorkspaceInteger(quote.event?.guests, { emptyLabel: "Guest count not set" })}
                          {hasWorkspaceNumber(quote.event?.guests) ? " guests" : ""}
                        </p>
                        <StatusChip family={family} label={label} />
                      </div>
                      <button type="button" className="ghost" onClick={() => onOpenQuote(quote.id)}>
                        Open
                      </button>
                    </li>
                  );
                })}
              </ul>
            )}
          </div>

          <div className="command-center-rail-section">
            <h3>Money at a glance</h3>
            {!state.loading && !moneyRows.length && !state.error && (
              <p className="source-note">No payments awaiting action. Requests become available after a proposal is accepted.</p>
            )}
            {moneyRows.length > 0 && (
              <>
                <div className="command-center-money-summary">
                  <div>
                    <span>Requested, awaiting customer</span>
                    <strong>
                      {formatWorkspaceMoney(moneyTotals.requested)}{moneyTotals.requestedUnknown > 0 ? " known" : ""}
                    </strong>
                    {moneyTotals.requestedUnknown > 0 && (
                      <small>{moneyTotals.requestedUnknown} amount{moneyTotals.requestedUnknown === 1 ? "" : "s"} not recorded</small>
                    )}
                  </div>
                  <div>
                    <span>Not yet requested</span>
                    <strong>
                      {formatWorkspaceMoney(moneyTotals.outstanding)}{moneyTotals.outstandingUnknown > 0 ? " known" : ""}
                    </strong>
                    {moneyTotals.outstandingUnknown > 0 && (
                      <small>{moneyTotals.outstandingUnknown} amount{moneyTotals.outstandingUnknown === 1 ? "" : "s"} not recorded</small>
                    )}
                  </div>
                </div>
                <ul className="command-center-list">
                  {moneyRows.slice(0, 5).map((row, index) => (
                    <li key={`${row.quoteId}-${row.kind}-${index}`} className="command-center-row">
                      <div className="command-center-row-main">
                        <p className="command-center-row-detail">{row.kind} · {formatWorkspaceMoney(row.amount)}</p>
                        <p className="command-center-row-meta">
                          {customerLabel(state.quotes.find((quote) => quote.id === row.quoteId))}
                          {" · "}{formatWorkspaceText(row.quoteNumber, { emptyLabel: "Quote number pending" })}
                        </p>
                        <StatusChip family={row.family} label={row.label} />
                      </div>
                      <button type="button" className="ghost" onClick={() => onOpenQuote(row.quoteId)}>
                        Open
                      </button>
                    </li>
                  ))}
                </ul>
              </>
            )}
          </div>
        </div>
      </div>
    </section>
  );
}
