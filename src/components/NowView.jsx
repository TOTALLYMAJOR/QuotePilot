import { useEffect, useMemo, useRef, useState } from "react";
import DecisionCard from "./DecisionCard";
import StatusChip from "./StatusChip";
import StaffEvidenceRail from "./StaffEvidenceRail";
import { useWorkspaceRouteHeadingFocus } from "../hooks/useWorkspaceRouteHeadingFocus";
import {
  buildMoneyRows,
  selectUpcomingEvents,
  summarizeMoneyRows
} from "../lib/commandCenterEvidence";
import {
  NOW_CARD_LIMIT,
  buildNowCards,
  describeNowEmptyState
} from "./nowPresentation";
import { classifyQuoteStatus } from "../lib/statusSemantics";
import { getNowRoutePerformanceOutcomes, markRouteStage } from "../lib/routePerformance";
import { WorkspaceSectionLoading } from "./WorkspaceSurfaceBoundary";
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
  nowDate = null,
  ambientMode = false
}) {
  const state = snapshot || {
    loading: true,
    error: "",
    attentionSummary: null,
    quotes: [],
    truncated: false
  };
  const reportedStagesRef = useRef(new Set());
  const { core: coreOutcome, supplemental: supplementalOutcome } = getNowRoutePerformanceOutcomes(state);

  useEffect(() => {
    if (!coreOutcome || reportedStagesRef.current.has("usable-core")) return;
    reportedStagesRef.current.add("usable-core");
    markRouteStage({ routeId: "now", stage: "usable-core", outcome: coreOutcome });
  }, [coreOutcome]);

  useEffect(() => {
    if (!supplementalOutcome || reportedStagesRef.current.has("supplemental-complete")) return;
    reportedStagesRef.current.add("supplemental-complete");
    markRouteStage({ routeId: "now", stage: "supplemental-complete", outcome: supplementalOutcome });
  }, [supplementalOutcome]);
  const historyLoading = state.reads?.history?.status === "loading"
    || (state.loading && !["success", "error"].includes(state.reads?.history?.status));
  const historyError = state.reads?.history?.error || (!state.reads && state.error);
  const attentionLoading = state.loading;
  const attentionItems = state.attentionSummary?.items || [];
  const [additionalAttentionVisible, setAdditionalAttentionVisible] = useState(false);
  const hiddenAttentionCount = Math.max(0, attentionItems.length - NOW_CARD_LIMIT);
  const cardLimit = ambientMode && additionalAttentionVisible
    ? attentionItems.length
    : NOW_CARD_LIMIT;
  const { cards, overflowCount } = useMemo(
    () => buildNowCards({ items: attentionItems, quotes: state.quotes, limit: cardLimit }),
    [attentionItems, cardLimit, state.quotes]
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
    <section className="panel now-surface now-briefing" aria-labelledby="now-heading">
      <div className="command-center-head now-briefing__masthead">
        <div>
          <p className="eyebrow">Now</p>
          <h1
            ref={headingRef}
            id="now-heading"
            className="workspace-route-heading"
            tabIndex={-1}
          >
            What to review today
          </h1>
          <p className="now-date">{dayLabel} · {dateLabel}</p>
          <p className="now-briefing__intro">Your priorities, upcoming events, and recorded payment steps in one view.</p>
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
      {Object.entries(state.reads || {}).filter(([read, result]) => read !== "history" && result.status === "error").map(([read]) => (
        <button key={read} type="button" className="ghost" onClick={() => onRefresh?.({ force: true, read })}>
          Retry {read === "unreadReplies" ? "customer replies" : read === "decisionDebt" ? "pending decisions" : "attention"}
        </button>
      ))}

      <div className="now-grid">
        <div className="now-stream" id="now-attention-items">
          <div className="now-section-heading">
            <div>
              <p className="eyebrow">Requires you</p>
              <h3>{attentionLoading ? "Checking attention…" : state.error ? "Attention unavailable" : "What needs attention"}</h3>
            </div>
            {cards.length > 0 && <span>{cards.length} shown</span>}
          </div>
          {attentionLoading && !cards.length && (
            <WorkspaceSectionLoading label="Loading attention items..." rows={3} />
          )}
          {!state.loading && !cards.length && !state.error && (
            <div className="now-empty-state">
              <span className="now-empty-state__mark" aria-hidden="true">✓</span>
              <p className="source-note">{describeNowEmptyState({ truncated: state.truncated })}</p>
            </div>
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
          {(ambientMode ? hiddenAttentionCount > 0 : overflowCount > 0) && (
            <button
              type="button"
              className="ghost command-center-more"
              aria-controls={ambientMode ? "now-attention-items" : undefined}
              aria-expanded={ambientMode ? additionalAttentionVisible : undefined}
              onClick={ambientMode
                ? () => setAdditionalAttentionVisible((visible) => !visible)
                : () => onOpenWorkflow?.({})}
            >
              {ambientMode
                ? additionalAttentionVisible
                  ? "Show fewer attention items"
                  : `Show ${hiddenAttentionCount} more here`
                : `View ${overflowCount} more in Workflow`}
            </button>
          )}
        </div>

        <div className="now-rail">
          <div className="command-center-rail-section">
            <h3>Next 7 days</h3>
            {historyError && (
              <div>
                <p className="warning-note" role="alert">Events and payment steps are unavailable. Any retained records may be stale.</p>
                <button type="button" className="ghost" disabled={historyLoading} onClick={() => onRefresh?.({ force: true, read: "history" })}>
                  Retry events and payments
                </button>
              </div>
            )}
            {historyLoading && !upcomingEvents.length && (
              <WorkspaceSectionLoading label="Loading events…" rows={3} />
            )}
            {!historyLoading && !upcomingEvents.length && !historyError && (
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
            {historyLoading && !moneyRows.length && (
              <WorkspaceSectionLoading label="Loading payment steps…" rows={2} />
            )}
            {!historyLoading && !moneyRows.length && !historyError && (
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
