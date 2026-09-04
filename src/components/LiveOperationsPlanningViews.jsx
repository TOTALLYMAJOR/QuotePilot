import StatusChip from "./StatusChip";
import StaffEvidenceRail from "./StaffEvidenceRail";
import WorkspaceRecoveryState from "./WorkspaceRecoveryState";
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

function EvidenceRail({ snapshot, organizationName, organizationId, presentation = "standard" }) {
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
      presentation={presentation}
    />
  );
}

function EventReadBoundary({
  snapshot,
  organizationName,
  organizationId,
  summary = "About this view",
  status = "Source not confirmed"
}) {
  return (
    <details
      className="live-ops-evidence-disclosure"
      data-events-evidence="collapsed"
    >
      <summary>
        <span>{summary}</span>
        <strong>{status}</strong>
      </summary>
      <div className="live-ops-evidence-disclosure__body">
        <EvidenceRail
          snapshot={snapshot}
          organizationName={organizationName}
          organizationId={organizationId}
          presentation="compact"
        />
      </div>
    </details>
  );
}

function LiveAuthorityNotice({ compact = false }) {
  return (
    <div className={compact ? "live-ops-authority live-ops-authority-compact" : "live-ops-authority"}>
      <strong>Planning view only</strong>
      <span>
        Event details are available. Live phase, issues, labor actuals, and replay stay
        unavailable until live operations are enabled.
      </span>
    </div>
  );
}

function EventPlanningRecovery({
  kind,
  loading = false,
  onRefresh,
  onOpenEvents,
  onOpenOpportunities,
  onStartOpportunity
}) {
  const copy = kind === "unavailable"
    ? {
        eyebrow: "Events unavailable",
        heading: "We couldn’t load event records.",
        body: "Try again when you’re ready. No event status changed, and you can keep moving work forward from Opportunities."
      }
    : kind === "not_found"
      ? {
          eyebrow: "Event not found",
          heading: "This event isn’t in the current view.",
          body: "The event may be outside the bounded read or unavailable. QuotePilot did not open another event in its place."
        }
      : {
          eyebrow: "No accepted events yet",
          heading: "Nothing is ready for event planning yet.",
          body: "Accepted or booked opportunities appear here. Continue the next opportunity or start a new quote; this view does not change lifecycle status."
        };

  return (
    <WorkspaceRecoveryState
      className="live-ops-recovery"
      data-events-state={kind}
      eyebrow={copy.eyebrow}
      title={copy.heading}
      description={copy.body}
      titleId={`live-ops-${kind}-heading`}
      actionGroupLabel="Event recovery actions"
    >
      {kind === "unavailable" && (
        <button
          type="button"
          className="cta"
          onClick={() => onRefresh?.({ force: true })}
          disabled={loading}
        >
          {loading ? "Trying again..." : "Try again"}
        </button>
      )}
      {kind === "not_found" && (
        <button type="button" className="cta" onClick={onOpenEvents}>Back to Events</button>
      )}
      {kind === "empty" && (
        <button type="button" className="cta" onClick={onOpenOpportunities}>Review opportunities</button>
      )}
      {kind !== "empty" && (
        <button type="button" className="ghost" onClick={onOpenOpportunities}>Review opportunities</button>
      )}
      {kind === "empty" && (
        <button type="button" className="ghost" onClick={onStartOpportunity}>Start a quote</button>
      )}
    </WorkspaceRecoveryState>
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
  onOpenOperations,
  onOpenEvents,
  onOpenOpportunities,
  onStartOpportunity
}) {
  const headingRef = useWorkspaceRouteHeadingFocus(true);
  const state = snapshot || { loading: true, error: "", quotes: [] };
  const events = acceptedEvents(state.quotes);
  const selected = routeMode === "list" ? null : findEvent(state.quotes, quoteId);
  const expectsSelection = routeMode !== "list";
  const selectionMissing = expectsSelection && !selected;
  const hasEvents = events.length > 0;
  const showUnavailableRecovery = !state.loading && Boolean(state.error) && !hasEvents;
  const hasBoundedReadCaveat = hasEvents && Boolean(
    state.error
    || state.partial
    || state.stale
    || state.truncated
    || state.truncationKnown === false
  );
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
            {!showUnavailableRecovery && (
              <button
                type="button"
                className="ghost"
                onClick={() => onRefresh?.({ force: true })}
                disabled={state.loading}
              >
                {state.loading ? "Refreshing..." : "Refresh"}
              </button>
            )}
            <button type="button" className="ghost" onClick={onOpenOperations}>Operations</button>
          </div>
        </div>

        {!showUnavailableRecovery && !hasBoundedReadCaveat && (
          <EvidenceRail snapshot={state} organizationName={organizationName} organizationId={organizationId} />
        )}

        {hasBoundedReadCaveat && (
          <EventReadBoundary
            snapshot={state}
            organizationName={organizationName}
            organizationId={organizationId}
            summary="Some data may be out of date"
            status="Event records available"
          />
        )}

        {state.loading && !hasEvents && (
          <p className="source-note" role="status">Loading accepted and booked event records...</p>
        )}

        {showUnavailableRecovery && (
          <EventPlanningRecovery
            kind="unavailable"
            loading={state.loading}
            onRefresh={onRefresh}
            onOpenOpportunities={onOpenOpportunities}
          />
        )}

        {showUnavailableRecovery && (
          <EventReadBoundary
            snapshot={state}
            organizationName={organizationName}
            organizationId={organizationId}
          />
        )}

        {!state.loading && !state.error && selectionMissing && (
          <EventPlanningRecovery
            kind="not_found"
            onOpenEvents={onOpenEvents}
            onOpenOpportunities={onOpenOpportunities}
          />
        )}

        {!state.loading && !state.error && !expectsSelection && !hasEvents && (
          <EventPlanningRecovery
            kind="empty"
            onOpenOpportunities={onOpenOpportunities}
            onStartOpportunity={onStartOpportunity}
          />
        )}

        {!selected && !expectsSelection && hasEvents && <LiveAuthorityNotice />}

        {selected && (
          <div className="live-ops-focus-grid">
            <section className="live-ops-focus-card" aria-label="Event basics">
              <h3>Event basics</h3>
              <dl className="live-ops-facts">
                <div><dt>Date</dt><dd>{formatWorkspaceDate(selected.event?.date)}</dd></div>
                <div><dt>Guests</dt><dd>{formatWorkspaceInteger(selected.event?.guests, { emptyLabel: "Guest count not set" })}</dd></div>
                <div><dt>Venue</dt><dd>{formatWorkspaceText(selected.event?.venue, { emptyLabel: "Venue not set" })}</dd></div>
                <div><dt>Customer</dt><dd>{formatWorkspaceText(selected.customer?.name || selected.customer?.email, { emptyLabel: "Customer not set" })}</dd></div>
              </dl>
            </section>
            <section className="live-ops-focus-card" aria-label="Planning status">
              <h3>Planning status</h3>
              <p className="source-note">
                {classifyQuoteStatus(selected.status).label} is the recorded opportunity state. The scheduled date does not by itself confirm operational readiness.
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
          </div>
        )}

        {!expectsSelection && hasEvents && (
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
            {unavailableMode && (
              <button type="button" className="ghost" onClick={() => onOpenEvent?.(selected.id)}>Back to Event Focus</button>
            )}
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
