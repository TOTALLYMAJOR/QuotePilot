import { useMemo } from "react";
import StatusChip from "./StatusChip";
import { currency } from "../lib/quoteCalculator";
import {
  classifyAttentionItem,
  classifyDepositStatus,
  classifyFinalBalanceDisplayStatus,
  classifyQuoteStatus,
  getFinalBalanceDisplayStatus
} from "../lib/statusSemantics";

const UPCOMING_WINDOW_DAYS = 7;
const ATTENTION_ROW_LIMIT = 8;

function localDateIso(value = new Date()) {
  const year = value.getFullYear();
  const month = String(value.getMonth() + 1).padStart(2, "0");
  const day = String(value.getDate()).padStart(2, "0");
  return `${year}-${month}-${day}`;
}

export function attentionRowCopy(item) {
  const customerName = String(item.quote?.customer?.name || item.quote?.customer?.email || "Customer").trim();
  const quoteLabel = String(item.quote?.quoteNumber || item.quoteId || "").trim();
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
  const count = Array.isArray(item.pendingRequests) ? item.pendingRequests.length : 0;
  return { detail: `${count} pending approval${count === 1 ? "" : "s"}`, meta, customerName, quoteLabel };
}

export function selectUpcomingEvents(quotes = [], { nowDate = new Date(), windowDays = UPCOMING_WINDOW_DAYS } = {}) {
  const todayISO = localDateIso(nowDate);
  const windowEndDate = new Date(nowDate);
  windowEndDate.setDate(windowEndDate.getDate() + windowDays);
  const windowEndISO = localDateIso(windowEndDate);
  return (Array.isArray(quotes) ? quotes : [])
    .filter((quote) => ["accepted", "booked"].includes(quote?.status))
    .filter((quote) => {
      const eventDate = String(quote?.event?.date || "").trim();
      return /^\d{4}-\d{2}-\d{2}$/.test(eventDate) && eventDate >= todayISO && eventDate <= windowEndISO;
    })
    .sort((a, b) => String(a?.event?.date || "").localeCompare(String(b?.event?.date || "")));
}

export function buildMoneyRows(quotes = []) {
  const rows = [];
  (Array.isArray(quotes) ? quotes : []).forEach((quote) => {
    const depositStatus = String(quote?.payment?.depositStatus || "unpaid").toLowerCase();
    if (["accepted", "booked"].includes(quote?.status) && ["unpaid", "sent"].includes(depositStatus)) {
      rows.push({
        quoteId: quote.id,
        quoteNumber: quote.quoteNumber,
        customerName: quote.customer?.name || quote.customer?.email || "Customer",
        kind: "Deposit",
        amount: Number(quote.totals?.deposit || 0),
        ...classifyDepositStatus(depositStatus)
      });
    }
    if (quote?.status === "booked" && quote.booking?.contractNumber) {
      const displayStatus = getFinalBalanceDisplayStatus(quote.payment?.finalBalance);
      const amountCents = Number(quote.payment?.finalBalance?.amountCents || 0);
      // A never-requested ("unpaid") balance is only actionable once the
      // deposit is paid — mirrors the send_final_balance_request eligibility
      // gate so this row is never shown as actionable before it really is.
      const eligibleToShow = displayStatus !== "unpaid" || depositStatus === "paid";
      if (amountCents > 0 && eligibleToShow && ["unpaid", "sent", "prepared", "processing"].includes(displayStatus)) {
        rows.push({
          quoteId: quote.id,
          quoteNumber: quote.quoteNumber,
          customerName: quote.customer?.name || quote.customer?.email || "Customer",
          kind: "Final balance",
          amount: amountCents / 100,
          ...classifyFinalBalanceDisplayStatus(displayStatus)
        });
      }
    }
  });
  return rows;
}

export function summarizeMoneyRows(rows = []) {
  return {
    requested: rows.filter((row) => row.family === "pending").reduce((sum, row) => sum + row.amount, 0),
    outstanding: rows.filter((row) => row.family === "action").reduce((sum, row) => sum + row.amount, 0)
  };
}

export default function CommandCenterHome({
  snapshot,
  onRefresh,
  onOpenWorkflow,
  onOpenQuote,
  onOpenCustomer,
  onNewQuote
}) {
  const state = snapshot || {
    loading: true,
    error: "",
    attentionSummary: null,
    quotes: [],
    truncated: false
  };
  const attentionItems = state.attentionSummary?.items || [];
  const visibleAttentionItems = attentionItems.slice(0, ATTENTION_ROW_LIMIT);
  const attentionOverflow = attentionItems.length - visibleAttentionItems.length;
  const hasAnyAttention = attentionItems.length > 0;

  const upcomingEvents = useMemo(
    () => selectUpcomingEvents(state.quotes),
    [state.quotes]
  );
  const hasAnyEvents = upcomingEvents.length > 0;

  const moneyRows = useMemo(() => buildMoneyRows(state.quotes), [state.quotes]);
  const moneyTotals = useMemo(() => summarizeMoneyRows(moneyRows), [moneyRows]);

  const isRefreshing = state.loading;

  const openWorkflowItem = (item) => {
    onOpenWorkflow?.({
      quoteId: item.quoteId,
      attentionType: item.type,
      requestId: item.sourceRequestId || item.pendingRequests?.[0]?.id || ""
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
          <p className="eyebrow">Home</p>
          <h2 id="command-center-heading">What needs your attention</h2>
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

      {state.error && <p className="error-note" role="alert">{state.error}</p>}
      {state.truncated && (
        <p className="source-note">Home uses the 200 most recent quote records. Open Quotes for the complete history.</p>
      )}

      <div className="command-center-grid">
        <div className="command-center-inbox">
          <h3>Needs your attention</h3>
          {state.loading && !state.attentionSummary && (
            <p className="source-note">Loading attention items...</p>
          )}
          {!state.loading && !hasAnyAttention && !state.error && (
            <p className="source-note">
              Nothing needs you right now. New change requests, overdue follow-ups, and pending approvals will appear here.
            </p>
          )}
          {hasAnyAttention && (
            <ul className="command-center-list">
              {visibleAttentionItems.map((item) => {
                const { family, label } = classifyAttentionItem(item.type, item.state);
                const attentionQuote = state.quotes.find((quote) => quote.id === item.quoteId) || item.quote || {};
                const { detail, customerName, quoteLabel } = attentionRowCopy({ ...item, quote: attentionQuote });
                return (
                  <li key={item.id} className="command-center-row">
                    <div className="command-center-row-main">
                      <StatusChip family={family} label={label} />
                      <p className="command-center-row-detail">{detail}</p>
                      <p className="command-center-row-meta">
                        {attentionQuote.customerId ? customerLabel(attentionQuote) : customerName}
                        {quoteLabel ? <> · {quoteLabel}</> : null}
                      </p>
                    </div>
                    <button type="button" className="ghost" onClick={() => openWorkflowItem(item)}>
                      Open in Workflow
                    </button>
                  </li>
                );
              })}
            </ul>
          )}
          {attentionOverflow > 0 && (
            <button type="button" className="ghost command-center-more" onClick={() => onOpenWorkflow?.({})}>
              View {attentionOverflow} more in Workflow
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
                          <strong>{quote.event?.name || quote.quoteNumber}</strong> · {quote.event?.date}
                        </p>
                        <p className="command-center-row-meta">
                          {customerLabel(quote)} · {quote.event?.venue || "Venue TBD"} · {Number(quote.event?.guests || 0)} guests
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
                    <strong>{currency(moneyTotals.requested)}</strong>
                  </div>
                  <div>
                    <span>Not yet requested</span>
                    <strong>{currency(moneyTotals.outstanding)}</strong>
                  </div>
                </div>
                <ul className="command-center-list">
                  {moneyRows.slice(0, 5).map((row, index) => (
                    <li key={`${row.quoteId}-${row.kind}-${index}`} className="command-center-row">
                      <div className="command-center-row-main">
                        <p className="command-center-row-detail">{row.kind} · {currency(row.amount)}</p>
                        <p className="command-center-row-meta">{customerLabel(state.quotes.find((quote) => quote.id === row.quoteId))} · {row.quoteNumber}</p>
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
