import StatusChip from "./StatusChip";
import StaffEvidenceRail from "./StaffEvidenceRail";
import { useWorkspaceRouteHeadingFocus } from "../hooks/useWorkspaceRouteHeadingFocus";
import { classifyQuoteStatus } from "../lib/statusSemantics";
import {
  formatWorkspaceDate,
  formatWorkspaceInteger,
  formatWorkspaceText,
  hasWorkspaceNumber
} from "../lib/workspacePresentation";

function acceptedEvents(quotes = []) {
  return (Array.isArray(quotes) ? quotes : [])
    .filter((quote) => ["accepted", "booked"].includes(String(quote?.status || "").toLowerCase()))
    .sort((a, b) => String(a?.event?.date || "").localeCompare(String(b?.event?.date || "")));
}

function eventTitle(quote = {}) {
  return formatWorkspaceText(quote.event?.name || quote.quoteNumber, { emptyLabel: "Untitled event" });
}

function findEvent(quotes = [], quoteId = "") {
  const id = String(quoteId || "").trim();
  return acceptedEvents(quotes).find((quote) => String(quote?.id || "") === id) || null;
}

function EvidenceRail({ snapshot, organizationName, organizationId }) {
  return (
    <StaffEvidenceRail
      organizationName={organizationName}
      organizationId={organizationId}
      source={snapshot?.source}
      loadedAt={snapshot?.loadedAt}
      loading={snapshot?.loading}
      error={snapshot?.error}
      partial={snapshot?.partial}
      stale={snapshot?.stale}
      truncated={snapshot?.truncated}
      truncationKnown={snapshot?.truncationKnown}
      reads={snapshot?.reads}
    />
  );
}

function LiveAuthorityNotice({ compact = false }) {
  return (
    <div className={compact ? "live-ops-authority live-ops-authority-compact" : "live-ops-authority"}>
      <strong>Live operations evidence not established</strong>
      <span>
        This surface reads accepted/booked planning records only. Current phase, pulse,
        issues, labor actuals, and replay require the server-owned event authority gate.
      </span>
    </div>
  );
}

export function EventPlanningView({
  snapshot,
  organizationName = "",
  organizationId = "",
  routeMode = "list",
  quoteId = "",
  onRefresh,
  onOpenEvent,
  onOpenQuote,
  onOpenLive,
  onOpenReplay,
  onOpenOperations
}) {
  const headingRef = useWorkspaceRouteHeadingFocus(true);
  const state = snapshot || { loading: true, error: "", quotes: [] };
  const events = acceptedEvents(state.quotes);
  const selected = routeMode === "list" ? null : findEvent(state.quotes, quoteId);
  const unavailableMode = routeMode === "live" || routeMode === "replay";
  const heading = routeMode === "live"
    ? "Control Room"
    : routeMode === "replay"
      ? "Replay"
      : selected
        ? "Event Focus"
        : "Events";

  return (
    <main className="container workspace-route-main live-ops-route">
      <section className="panel live-ops-panel" aria-labelledby="live-ops-heading">
        <div className="command-center-head">
          <div>
            <p className="eyebrow">{heading}</p>
            <h2
              ref={headingRef}
              id="live-ops-heading"
              className="workspace-route-heading"
              tabIndex={-1}
            >
              {selected ? eventTitle(selected) : "Accepted and booked events"}
            </h2>
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
            <button type="button" className="ghost" onClick={onOpenOperations}>Operations</button>
          </div>
        </div>

        <EvidenceRail snapshot={state} organizationName={organizationName} organizationId={organizationId} />
        {state.error && <p className="error-note" role="alert">{state.error}</p>}
        <LiveAuthorityNotice />

        {state.loading && !events.length && (
          <p className="source-note" role="status">Loading accepted and booked event records...</p>
        )}

        {!state.loading && !events.length && !state.error && (
          <p className="source-note">
            No accepted or booked events appear in this bounded snapshot. Earlier commercial work remains in Opportunities.
          </p>
        )}

        {selected && (
          <div className="live-ops-focus-grid">
            <section className="live-ops-focus-card" aria-label="Planning status">
              <h3>Planning signal</h3>
              <p className="source-note">
                Scheduled time may indicate planned work, but it does not change official event state.
              </p>
              <LiveAuthorityNotice compact />
              {unavailableMode && (
                <p className="error-note" role="status">
                  {routeMode === "live"
                    ? "Control Room is unavailable until live operations authority is enabled."
                    : "Replay is unavailable until immutable event ledger evidence exists."}
                </p>
              )}
            </section>
            <section className="live-ops-focus-card" aria-label="Event basics">
              <h3>Event basics</h3>
              <dl className="live-ops-facts">
                <div><dt>Date</dt><dd>{formatWorkspaceDate(selected.event?.date)}</dd></div>
                <div><dt>Guests</dt><dd>{formatWorkspaceInteger(selected.event?.guests, { emptyLabel: "Guest count not set" })}</dd></div>
                <div><dt>Venue</dt><dd>{formatWorkspaceText(selected.event?.venue, { emptyLabel: "Venue not set" })}</dd></div>
                <div><dt>Customer</dt><dd>{formatWorkspaceText(selected.customer?.name || selected.customer?.email, { emptyLabel: "Customer not set" })}</dd></div>
              </dl>
            </section>
          </div>
        )}

        {!selected && events.length > 0 && (
          <ul className="command-center-list live-ops-event-list" aria-label="Accepted and booked events">
            {events.map((quote) => {
              const { family, label } = classifyQuoteStatus(quote.status);
              return (
                <li key={quote.id} className="command-center-row">
                  <div className="command-center-row-main">
                    <p className="command-center-row-detail">
                      <strong>{eventTitle(quote)}</strong>
                      {" · "}{formatWorkspaceDate(quote.event?.date)}
                    </p>
                    <p className="command-center-row-meta">
                      {formatWorkspaceText(quote.customer?.name || quote.customer?.email, { emptyLabel: "Customer not set" })}
                      {" · "}{formatWorkspaceText(quote.event?.venue, { emptyLabel: "Venue not set" })}
                      {" · "}{formatWorkspaceInteger(quote.event?.guests, { emptyLabel: "Guest count not set" })}
                      {hasWorkspaceNumber(quote.event?.guests) ? " guests" : ""}
                    </p>
                    <StatusChip family={family} label={label} />
                  </div>
                  <div className="right-actions">
                    <button type="button" className="ghost" onClick={() => onOpenQuote?.(quote.id)}>Quote</button>
                    <button type="button" className="ghost" onClick={() => onOpenLive?.(quote.id)}>Control Room</button>
                    <button type="button" className="cta" onClick={() => onOpenEvent?.(quote.id)}>Event Focus</button>
                  </div>
                </li>
              );
            })}
          </ul>
        )}

        {selected && (
          <div className="live-ops-actions">
            <button type="button" className="ghost" onClick={() => onOpenQuote?.(selected.id)}>Open quote record</button>
            <button type="button" className="ghost" onClick={() => onOpenLive?.(selected.id)}>Control Room</button>
            <button type="button" className="ghost" onClick={() => onOpenReplay?.(selected.id)}>Replay</button>
          </div>
        )}
      </section>
    </main>
  );
}

export function ClearDeckView({
  snapshot,
  organizationName = "",
  organizationId = "",
  onRefresh,
  onOpenWorkflow
}) {
  const headingRef = useWorkspaceRouteHeadingFocus(true);
  const items = snapshot?.attentionSummary?.items || [];
  const decisionItems = items.filter((item) => ["approval", "decision_debt"].includes(item.type)).slice(0, 3);

  return (
    <main className="container workspace-route-main live-ops-route">
      <section className="panel live-ops-panel" aria-labelledby="clear-deck-heading">
        <div className="command-center-head">
          <div>
            <p className="eyebrow">Clear the Deck</p>
            <h2 ref={headingRef} id="clear-deck-heading" className="workspace-route-heading" tabIndex={-1}>
              Decisions needing explicit review
            </h2>
          </div>
          <button type="button" className="ghost" onClick={() => onRefresh?.({ force: true })} disabled={snapshot?.loading}>
            {snapshot?.loading ? "Refreshing..." : "Refresh"}
          </button>
        </div>
        <EvidenceRail snapshot={snapshot} organizationName={organizationName} organizationId={organizationId} />
        <LiveAuthorityNotice />
        {!decisionItems.length && !snapshot?.loading && !snapshot?.error && (
          <p className="source-note">
            No decision items appear in this bounded snapshot. Clear the Deck will stay review-only until durable decision receipts ship.
          </p>
        )}
        {decisionItems.map((item) => (
          <article key={item.id} className="live-ops-decision">
            <StatusChip family="warning" label={item.type === "approval" ? "Approval" : "Decision"} />
            <h3>{formatWorkspaceText(item.quote?.quoteNumber || item.quoteId, { emptyLabel: "Quote decision" })}</h3>
            <p className="source-note">
              Review the current source evidence in Workflow. Skip/defer does not resolve this item in this slice.
            </p>
            <button type="button" className="cta" onClick={() => onOpenWorkflow?.({
              quoteId: item.quoteId,
              attentionType: item.type,
              requestId: item.sourceRequestId || item.id
            })}>
              Review in Workflow
            </button>
          </article>
        ))}
      </section>
    </main>
  );
}

export function OperationsSwitchboardView({
  snapshot,
  organizationName = "",
  organizationId = "",
  onRefresh,
  onOpenEvents,
  onOpenWorkflow,
  onOpenSchedule,
  onOpenReporting,
  onOpenCatalog,
  onOpenDiagnostics
}) {
  const headingRef = useWorkspaceRouteHeadingFocus(true);
  const events = acceptedEvents(snapshot?.quotes);
  const openAttention = snapshot?.attentionSummary?.items?.length || 0;

  return (
    <main className="container workspace-route-main live-ops-route">
      <section className="panel live-ops-panel" aria-labelledby="operations-heading">
        <div className="command-center-head">
          <div>
            <p className="eyebrow">Operations</p>
            <h2 ref={headingRef} id="operations-heading" className="workspace-route-heading" tabIndex={-1}>
              Daily, business, and system workspaces
            </h2>
          </div>
          <button type="button" className="ghost" onClick={() => onRefresh?.({ force: true })} disabled={snapshot?.loading}>
            {snapshot?.loading ? "Refreshing..." : "Refresh"}
          </button>
        </div>
        <EvidenceRail snapshot={snapshot} organizationName={organizationName} organizationId={organizationId} />
        <div className="live-ops-switchboard">
          <button type="button" onClick={onOpenEvents}>
            <strong>Events</strong>
            <span>{events.length} accepted/booked in the bounded read</span>
          </button>
          <button type="button" onClick={() => onOpenWorkflow?.({})}>
            <strong>Workflow</strong>
            <span>{openAttention} attention item{openAttention === 1 ? "" : "s"}</span>
          </button>
          <button type="button" onClick={onOpenSchedule}>
            <strong>Schedule</strong>
            <span>Calendar and capacity planning</span>
          </button>
          <button type="button" onClick={onOpenReporting}>
            <strong>Reporting</strong>
            <span>Existing commercial reporting surface</span>
          </button>
          <button type="button" onClick={onOpenCatalog} disabled={!onOpenCatalog}>
            <strong>Library</strong>
            <span>{onOpenCatalog ? "Catalog choices and event templates" : "Admin access required"}</span>
          </button>
          <button type="button" onClick={onOpenDiagnostics}>
            <strong>System</strong>
            <span>Session diagnostics and integration health</span>
          </button>
        </div>
      </section>
    </main>
  );
}
