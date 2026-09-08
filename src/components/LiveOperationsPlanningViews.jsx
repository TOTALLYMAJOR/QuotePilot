import { useCallback, useEffect, useMemo, useRef } from "react";
import StatusChip from "./StatusChip";
import { lazy, Suspense } from "react";
const EventOperationsPanel = import.meta.env.VITE_EVENT_OPERATING_SPINE_ENABLED === "true"
  ? lazy(() => import("./EventOperationsPanel"))
  : () => null;
const EventOperatingHistoryPanel = import.meta.env.VITE_EVENT_OPERATING_SPINE_ENABLED === "true"
  ? lazy(() => import("./EventOperatingHistoryPanel")) : () => null;
const EventExecutionContextPanel = import.meta.env.VITE_EVENT_OPERATING_SPINE_ENABLED === "true"
  ? lazy(() => import("./EventExecutionContextPanel")) : () => null;
import StaffEvidenceRail from "./StaffEvidenceRail";
import WorkspaceRecoveryState from "./WorkspaceRecoveryState";
import { useWorkspaceRouteHeadingFocus } from "../hooks/useWorkspaceRouteHeadingFocus";
import { classifyQuoteStatus } from "../lib/statusSemantics";
import { useWorkspaceReturnContextAdapter } from "../context/WorkspaceNavigationContext";
import { restoreWorkspaceReturnViewport } from "../lib/workspaceReturnContext";
import { buildClearDeckDecisionPresentations } from "../lib/decisionResolutionPresentation";
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
  principalId = "",
  role = "customer",
  eventOperationsEnabled = false,
  routeMode = "list",
  quoteId = "",
  onRefresh,
  onOpenEvent,
  onOpenQuote,
  onOpenLive,
  onOpenReplay,
  onOpenCustomer,
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
  const eventOperationsAvailable = eventOperationsEnabled && state.source === "firebase" && ["admin", "sales"].includes(role) && selected?.status === "booked" && Boolean(principalId);
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
            {typeof onOpenOperations === "function" && (
              <button type="button" className="ghost" onClick={onOpenOperations}>Operations</button>
            )}
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

        {!selected && !expectsSelection && hasEvents && (eventOperationsEnabled && state.source === "firebase" && ["admin", "sales"].includes(role)
          ? <p className="source-note">Open a booked event to review its recorded phase, checkpoints, issues, and actuals. Replay reads operational receipts for the current accepted source.</p>
          : <LiveAuthorityNotice />)}

        {selected && routeMode === "live" && eventOperationsAvailable && <Suspense fallback={<p role="status">Loading event operations...</p>}><EventOperationsPanel organizationId={organizationId} quoteId={selected.id} principalId={principalId} role={role} source={state.source} enabled={eventOperationsEnabled} quoteStatus={selected.status} sourceVersionId={selected.activeVersionId || selected.versionMeta?.versionId || ""} acceptanceReceiptId={selected.acceptanceReceipt?.receiptId || ""} /></Suspense>}

        {selected && routeMode === "replay" && eventOperationsAvailable && <Suspense fallback={<p role="status">Loading Replay...</p>}><EventOperatingHistoryPanel organizationId={organizationId} quoteId={selected.id} principalId={principalId} role={role} source={state.source} enabled={eventOperationsEnabled} sourceVersionId={selected.activeVersionId || selected.versionMeta?.versionId || ""} acceptanceReceiptId={selected.acceptanceReceipt?.receiptId || ""} /></Suspense>}
        {selected && routeMode === "live" && eventOperationsAvailable && <Suspense fallback={<p role="status">Loading execution context...</p>}><EventExecutionContextPanel organizationId={organizationId} quote={selected} principalId={principalId} role={role} source={state.source} enabled={eventOperationsEnabled} onOpenQuote={onOpenQuote} onOpenCustomer={onOpenCustomer} /></Suspense>}
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
              {eventOperationsAvailable
                ? <p className="source-note">Control Room records event phases, checkpoints, issues, and actuals against the accepted source. Replay reads operational receipts for the current accepted source.</p>
                : <LiveAuthorityNotice compact />}
              {unavailableMode && !eventOperationsAvailable && (
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
            {routeMode === "detail" && eventOperationsAvailable && <button type="button" className="cta" data-event-operations-entry="control-room" onClick={() => onOpenLive?.(selected.id)}>Open Control Room</button>}
            {routeMode !== "replay" && eventOperationsAvailable && <button type="button" className="ghost" data-event-operations-entry="replay" onClick={() => onOpenReplay?.(selected.id)}>Open Replay</button>}
            {routeMode === "replay" && eventOperationsAvailable && <button type="button" className="ghost" onClick={() => onOpenLive?.(selected.id)}>Open Control Room</button>}
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
  const restoreCancelRef = useRef(null);
  const returnStateRef = useRef({ decisionItems: [], incompleteRead: true });
  const projection = useMemo(() => {
    try {
      const loadedAt = snapshot?.loadedAt;
      const parsed = typeof loadedAt === "number" ? new Date(loadedAt) : new Date(String(loadedAt || ""));
      const quoteById = new Map(
        (Array.isArray(snapshot?.quotes) ? snapshot.quotes : []).map((quote) => [
          String(quote?.id || "").trim(),
          quote
        ])
      );
      const decisionDebtItems = (Array.isArray(snapshot?.decisionDebtItems)
        ? snapshot.decisionDebtItems
        : []).map((item) => ({
          ...item,
          type: "decision_debt",
          quote: quoteById.get(String(item?.quoteId || "").trim()) || null
        }));
      const projectionSnapshot = decisionDebtItems.length
        ? {
            ...snapshot,
            items: [
              ...(Array.isArray(snapshot?.attentionSummary?.items)
                ? snapshot.attentionSummary.items
                : []),
              ...decisionDebtItems
            ]
          }
        : snapshot;
      return {
        decisions: buildClearDeckDecisionPresentations(projectionSnapshot, {
          nowISO: Number.isFinite(parsed.getTime()) ? parsed.toISOString() : ""
        }),
        error: ""
      };
    } catch (error) {
      return {
        decisions: [],
        error: error?.message || "Decision identity could not be verified."
      };
    }
  }, [snapshot]);
  const decisionItems = projection.decisions;
  const incompleteRead = Boolean(
    snapshot?.loading
    || snapshot?.error
    || snapshot?.partial
    || snapshot?.stale
    || snapshot?.truncated
    || projection.error
  );
  returnStateRef.current = { decisionItems, incompleteRead };

  const captureClearDeckReturnView = useCallback((hint = {}) => ({
    routeId: "clear-deck",
    structured: {},
    disclosureIds: [],
    scrollY: typeof window !== "undefined" ? window.scrollY : 0,
    focus: hint?.focus || { kind: "route-heading" }
  }), []);
  const restoreClearDeckReturnView = useCallback((view) => {
    restoreCancelRef.current?.();
    return new Promise((resolve) => {
      let active = true;
      let frameId = null;
      let attempt = 0;
      const finish = (status) => resolve({ status });
      const restore = () => {
        if (!active) return;
        const focus = view?.focus || {};
        const currentReturnState = returnStateRef.current;
        const root = headingRef.current?.closest("main");
        const target = focus.kind === "decision-action"
          ? Array.from(root?.querySelectorAll("[data-decision-action-id]") || []).find((element) => (
              element.dataset.decisionActionId === focus.actionId
              && element.closest("[data-decision-request-id]")?.dataset.decisionRequestId === focus.objectId
            ))
          : headingRef.current;
        const obligationReconciled = focus.kind === "decision-action"
          && !currentReturnState.incompleteRead
          && !currentReturnState.decisionItems.some((item) => item.requestId === focus.objectId);
        const targetIsCurrent = Boolean(target && !currentReturnState.incompleteRead);
        if (!targetIsCurrent && !obligationReconciled && attempt < 30) {
          attempt += 1;
          frameId = window.requestAnimationFrame(restore);
          return;
        }
        restoreCancelRef.current = null;
        restoreWorkspaceReturnViewport({
          focusTarget: targetIsCurrent ? target : headingRef.current,
          scrollY: view?.scrollY
        });
        finish(targetIsCurrent || obligationReconciled ? "restored" : "recovery");
      };
      restoreCancelRef.current = () => {
        active = false;
        if (frameId !== null) window.cancelAnimationFrame(frameId);
        finish("cancelled");
      };
      frameId = window.requestAnimationFrame(restore);
    });
  }, [headingRef]);
  useWorkspaceReturnContextAdapter({
    routeId: "clear-deck",
    capture: captureClearDeckReturnView,
    restore: restoreClearDeckReturnView
  });
  useEffect(() => () => restoreCancelRef.current?.(), []);

  return (
    <main className="container workspace-route-main live-ops-route">
      <section
        className="panel live-ops-panel"
        aria-labelledby="clear-deck-heading"
        data-capability-id="qp-uxr-002-decision-resolution"
        data-capability-state={projection.error
          ? "error"
          : incompleteRead
            ? "partial"
            : decisionItems.length
              ? "success"
              : "empty"}
      >
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
        {projection.error && (
          <div className="inline-alert" role="alert">
            <strong>Decision context is not safe to present.</strong>
            <span>{projection.error} Refresh before opening or resolving a request.</span>
          </div>
        )}
        {!decisionItems.length && !incompleteRead && (
          <p className="source-note">
            No pending approval decisions appear in this complete bounded snapshot.
          </p>
        )}
        {!decisionItems.length && incompleteRead && !projection.error && (
          <p className="source-note" role="status">
            No decisions are shown, but the bounded evidence is incomplete. Refresh before treating the deck as clear.
          </p>
        )}
        {decisionItems.map((item) => (
          <article
            key={item.stableId}
            className="live-ops-decision clear-deck-decision"
            data-decision-request-id={item.requestId}
          >
            <div className="clear-deck-decision__heading">
              <div>
                <StatusChip
                  family={item.reviewable ? "warning" : "muted"}
                  label={item.attentionType === "approval" ? "Approval" : "Decision"}
                />
                <h3>{item.title}</h3>
                <p>{item.eventLabel} · {item.customerLabel}</p>
              </div>
              <p className="clear-deck-decision__quote">{item.quoteLabel} · {item.lifecycleLabel}</p>
            </div>
            <p className="clear-deck-decision__request">{item.requestSummary}</p>
            <dl className="clear-deck-decision__facts">
              <div><dt>{item.stakeLabel}</dt><dd>{item.stakeValue}</dd></div>
              <div><dt>{item.timingLabel}</dt><dd>{item.timingValue}</dd></div>
              <div><dt>{item.requestAgeLabel}</dt><dd>{item.requestAgeValue}</dd></div>
              <div><dt>Requested by</dt><dd>{item.requesterLabel}</dd></div>
              <div><dt>{item.sourceRevisionTitle}</dt><dd>{item.sourceRevisionLabel}</dd></div>
              <div><dt>Evidence</dt><dd>{item.evidenceSourceLabel}</dd></div>
            </dl>
            <div className="clear-deck-decision__meaning">
              <p><strong>Dependencies</strong><span>{item.dependencySummary}</span></p>
              <p><strong>Authority</strong><span>{item.authoritySummary}</span></p>
              <p><strong>Evidence boundary</strong><span>{item.evidenceSummary}</span></p>
            </div>
            <p className="source-note">{item.nextStepSummary}</p>
            <button
              type="button"
              className="cta"
              data-decision-action-id={`review-workflow:${item.requestId}`}
              onClick={() => onOpenWorkflow?.({
                quoteId: item.quoteId,
                attentionType: item.attentionType,
                requestId: item.requestId,
                actionId: `review-workflow:${item.requestId}`
              }, {
                actionId: `review-workflow:${item.requestId}`,
                preserveReturnContext: true,
                returnContextSurfaceId: "decision-resolution",
                returnContextHint: {
                  focus: {
                    kind: "decision-action",
                    objectId: item.requestId,
                    actionId: `review-workflow:${item.requestId}`
                  }
                }
              })}
            >
              Review in Workflow
            </button>
          </article>
        ))}
      </section>
    </main>
  );
}
