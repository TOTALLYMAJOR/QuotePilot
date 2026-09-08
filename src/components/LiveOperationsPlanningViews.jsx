import { useCallback, useEffect, useMemo, useRef, useState } from "react";
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
import { buildCommitmentExecutionPresentation } from "./eventWorkspacePresentation";
import { getKitchenBeoArtifactStatus } from "../lib/kitchenBeoClient";
import { getOperationalStaffingSnapshot } from "../lib/operationalStaffingClient";
import EventPreflightPanel from "./EventPreflightPanel";
import { buildEventPreflightPresentation } from "./eventPreflightPresentation";
import { buildScheduleConflictAssessment, buildScheduledEvents } from "./EventScheduleModal";
import {
  formatWorkspaceDate,
  formatWorkspaceInteger,
  formatWorkspaceMoney,
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

function formatEvidenceTime(value) {
  const raw = String(value || "").trim();
  if (!raw) return "Time not recorded";
  const parsed = new Date(raw);
  if (Number.isNaN(parsed.getTime())) return "Time not recorded";
  return new Intl.DateTimeFormat("en-US", {
    dateStyle: "medium",
    timeStyle: "short"
  }).format(parsed);
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
      headingLevel={2}
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
        Event details and the saved plan are available. Live phase, issues, labor actuals,
        and execution replay remain unavailable without server-owned event-session evidence.
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
  tenantTimeZone = "",
  scheduleAvailable = true,
  scheduleCapacityLimit = 400,
  routeMode = "list",
  quoteId = "",
  onRefresh,
  onOpenEvent,
  onOpenQuote,
  onOpenLive,
  onOpenReplay,
  onOpenCustomer,
  onOpenWorkflow,
  onOpenSchedule,
  onOpenOperations,
  onOpenEvents,
  onOpenOpportunities,
  onStartOpportunity
}) {
  const headingRef = useWorkspaceRouteHeadingFocus(true);
  useEffect(() => {
    headingRef.current?.focus({ preventScroll: true });
  }, [headingRef, quoteId, routeMode]);
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
  const execution = selected
    ? buildCommitmentExecutionPresentation(selected, {
        source: state.source,
        now: new Date(),
        tenantTimeZone,
        scheduleAvailable
      })
    : null;
  const currentRevisionId = String(selected?.activeVersionId || selected?.versionMeta?.versionId || "").trim();
  const authorityIdentity = `${organizationId}:${selected?.id || ""}:${currentRevisionId}:${state.loadedAt || ""}`;
  const [authorityReads, setAuthorityReads] = useState({
    identity: "",
    beo: { state: "idle", value: null },
    staffing: { state: "idle", value: null }
  });
  useEffect(() => {
    const identity = authorityIdentity;
    if (routeMode !== "live" || !selected?.id) {
      setAuthorityReads({ identity: "", beo: { state: "idle", value: null }, staffing: { state: "idle", value: null } });
      return undefined;
    }
    if (state.source !== "firebase" || !organizationId) {
      setAuthorityReads({
        identity,
        beo: { state: "unavailable", value: null },
        staffing: { state: "unavailable", value: null }
      });
      return undefined;
    }
    let current = true;
    setAuthorityReads({
      identity,
      beo: { state: "loading", value: null },
      staffing: { state: "loading", value: null }
    });
    getKitchenBeoArtifactStatus({ organizationId, quoteId: selected.id })
      .then((value) => current && setAuthorityReads((prior) => prior.identity === identity
        ? { ...prior, beo: { state: "current", value } }
        : prior))
      .catch(() => current && setAuthorityReads((prior) => prior.identity === identity
        ? { ...prior, beo: { state: "unavailable", value: null } }
        : prior));
    getOperationalStaffingSnapshot({ organizationId, quoteId: selected.id })
      .then((value) => current && setAuthorityReads((prior) => prior.identity === identity
        ? { ...prior, staffing: { state: String(value?.state || "unavailable"), value } }
        : prior))
      .catch(() => current && setAuthorityReads((prior) => prior.identity === identity
        ? { ...prior, staffing: { state: "unavailable", value: null } }
        : prior));
    return () => { current = false; };
  }, [authorityIdentity, organizationId, routeMode, selected?.id, state.source]);
  const scheduleAssessment = useMemo(() => {
    if (!selected?.id) return { state: "unknown", reasons: [] };
    const scheduled = buildScheduledEvents(state.quotes || [], { preserveUndated: true });
    return buildScheduleConflictAssessment(scheduled, selected.id, scheduleCapacityLimit);
  }, [scheduleCapacityLimit, selected?.id, state.quotes]);
  const preflight = useMemo(() => selected && execution
    ? buildEventPreflightPresentation({
        quote: selected,
        execution,
        authorityReads,
        authorityIdentity,
        organizationId,
        snapshot: state,
        scheduleAssessment,
        scheduleAvailable
      })
    : null, [authorityIdentity, authorityReads, execution, organizationId, scheduleAssessment, scheduleAvailable, selected, state]);
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
            <h1
              ref={headingRef}
              id="live-ops-heading"
              className="workspace-route-heading"
              tabIndex={-1}
            >
              {selected ? eventTitle(selected) : "Accepted and booked events"}
            </h1>
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

        {selected && routeMode === "live" && eventOperationsAvailable && <Suspense fallback={<p role="status">Loading event operations...</p>}><EventOperationsPanel organizationId={organizationId} quoteId={selected.id} principalId={principalId} role={role} source={state.source} enabled={eventOperationsEnabled} quoteStatus={selected.status} sourceVersionId={selected.activeVersionId || selected.versionMeta?.versionId || ""} acceptanceReceiptId={selected.acceptanceReceipt?.receiptId || ""} /></Suspense>}

        {selected && routeMode === "replay" && eventOperationsAvailable && <Suspense fallback={<p role="status">Loading Replay...</p>}><EventOperatingHistoryPanel organizationId={organizationId} quoteId={selected.id} principalId={principalId} role={role} source={state.source} enabled={eventOperationsEnabled} sourceVersionId={selected.activeVersionId || selected.versionMeta?.versionId || ""} acceptanceReceiptId={selected.acceptanceReceipt?.receiptId || ""} /></Suspense>}
        {selected && routeMode === "live" && eventOperationsAvailable && <Suspense fallback={<p role="status">Loading execution context...</p>}><EventExecutionContextPanel organizationId={organizationId} quote={selected} principalId={principalId} role={role} source={state.source} enabled={eventOperationsEnabled} onOpenQuote={onOpenQuote} onOpenCustomer={onOpenCustomer} /></Suspense>}
        {!selected && !expectsSelection && hasEvents && (
          <p className="live-ops-intro">
            Commercial commitments ready for operational planning. Open one event to carry its accepted scope into a bounded briefing.
          </p>
        )}

        {selected && execution && routeMode === "detail" && (
          <div className="commitment-execution" data-execution-surface="event-focus">
            <section className="execution-hero" aria-label="Current commitment">
              <div>
                <p className="eyebrow">Current commitment · {execution.timingLabel}</p>
                <h2>{execution.workspace.customerName}</h2>
                <p>{execution.workspace.eventDate} at {execution.workspace.eventTime} · {execution.workspace.venue}</p>
              </div>
              <StatusChip {...execution.workspace.status} />
              <dl className="execution-fact-strip">
                <div><dt>Guests</dt><dd>{execution.workspace.guests}</dd></div>
                <div><dt>Saved total</dt><dd>{execution.workspace.total}</dd></div>
                <div><dt>Commitment</dt><dd>{execution.runOfShow.quoteStatus === "booked" ? "Booked" : "Accepted"}</dd></div>
                <div><dt>Payment context</dt><dd>{execution.commercialEvidence.deposit}</dd></div>
              </dl>
            </section>

            <div className="execution-briefing-grid">
              <section className="execution-card" aria-labelledby="event-plan-title">
                <p className="eyebrow">Event plan</p>
                <h2 id="event-plan-title">The day as currently recorded</h2>
                <dl className="live-ops-facts">
                  <div><dt>Quote</dt><dd>{execution.workspace.quoteNumber}</dd></div>
                  <div><dt>Revision</dt><dd>{execution.commitment.revision}</dd></div>
                  <div><dt>Duration</dt><dd>{execution.commitment.duration}</dd></div>
                  <div><dt>Address</dt><dd>{execution.commitment.address}</dd></div>
                  <div><dt>Package</dt><dd>{execution.commitment.package}</dd></div>
                  <div><dt>Service</dt><dd>{execution.commitment.serviceStyle}</dd></div>
                  <div><dt>Staff lead</dt><dd>{formatWorkspaceText(execution.runOfShow.staffing.staffLead, { emptyLabel: "Not recorded" })}</dd></div>
                  <div><dt>Team</dt><dd>{execution.staffingSummary}</dd></div>
                  <div><dt>Run of show</dt><dd>{execution.runOfShow.timeline.length - execution.timingUnknownCount} of {execution.runOfShow.timeline.length} checkpoint times known</dd></div>
                  <div><dt>Production</dt><dd>{execution.runOfShow.productionChecklist.completedCount} of {execution.runOfShow.productionChecklist.totalCount} checklist items recorded complete</dd></div>
                  <div><dt>Final balance</dt><dd>{execution.commercialEvidence.finalBalance}</dd></div>
                  <div><dt>Acceptance</dt><dd>{execution.commitment.acceptance}</dd></div>
                </dl>
              </section>
              <section className="execution-card execution-attention" aria-labelledby="handoff-title">
                <p className="eyebrow">Handoff</p>
                <h2 id="handoff-title">{execution.attention.length ? "What needs attention" : "Continue into coordination"}</h2>
                <p>{execution.attention[0]?.title || "The accepted plan is ready to coordinate from its current evidence."}</p>
                <p className="source-note">{execution.proofBoundary}</p>
              </section>
            </div>

            <div className="live-ops-actions" aria-label="Event Focus actions">
              {eventOperationsAvailable && (
                <button
                  type="button"
                  className="cta"
                  data-event-operations-entry="control-room"
                  onClick={() => onOpenLive?.(selected.id)}
                >
                  Open Control Room
                </button>
              )}
              {!eventOperationsAvailable && (
                <button type="button" className="cta" onClick={() => onOpenLive?.(selected.id)}>
                  Enter Control Room
                </button>
              )}
              {eventOperationsAvailable && (
                <button
                  type="button"
                  className="ghost"
                  data-event-operations-entry="replay"
                  onClick={() => onOpenReplay?.(selected.id)}
                >
                  Open Replay
                </button>
              )}
              <button type="button" className="ghost" onClick={() => onOpenQuote?.(selected.id)}>Open commercial truth</button>
            </div>
          </div>
        )}

        {selected && execution && routeMode === "live" && (
          <div className="commitment-execution" data-execution-surface="control-room">
            {!eventOperationsAvailable && <LiveAuthorityNotice compact />}
            <section className="execution-hero execution-hero-compact" aria-label="Control Room event identity">
              <div>
                <p className="eyebrow">Coordinate · {execution.timingLabel}</p>
                <h2>{execution.workspace.eventName}</h2>
                <p>{execution.workspace.eventDate} at {execution.workspace.eventTime} · {execution.workspace.venue}</p>
              </div>
              <StatusChip {...execution.workspace.status} />
            </section>

            <EventPreflightPanel model={preflight} />

            <div className="execution-next" aria-label="Next valid action">
              <div><p className="eyebrow">Next</p><strong>{preflight.nextAction.label}</strong><span>{preflight.nextReason}</span></div>
              {preflight.nextAction.kind === "workflow" ? (
                <button type="button" className="cta" onClick={() => onOpenWorkflow?.(preflight.nextAction.target)}>{preflight.nextAction.label}</button>
              ) : preflight.nextAction.kind === "schedule" ? (
                <button type="button" className="cta" onClick={() => onOpenSchedule?.(selected.id)}>{preflight.nextAction.label}</button>
              ) : preflight.nextAction.kind === "refresh" ? (
                <button type="button" className="cta" onClick={() => onRefresh?.({ force: true })} disabled={state.loading}>{state.loading ? "Refreshing…" : preflight.nextAction.label}</button>
              ) : (
                <button type="button" className="cta" onClick={() => onOpenQuote?.(selected.id)}>{preflight.nextAction.label}</button>
              )}
            </div>

            <div className="execution-control-grid">
              <section className="execution-card" aria-labelledby="run-event-title">
                <p className="eyebrow">Run event</p>
                <h2 id="run-event-title">Planned sequence</h2>
                <ol className="execution-timeline">
                  {execution.runOfShow.timeline.map((item) => (
                    <li key={item.id} data-timing-state={item.timingState}>
                      <time>{item.timeLabel || "Time unknown"}</time>
                      <span><strong>{item.label}</strong><small>{item.timingBasis === "booking_override" ? "Saved booking time" : "Generated from event plan"}</small></span>
                    </li>
                  ))}
                </ol>
              </section>
              <section className="execution-card" aria-labelledby="production-title">
                <p className="eyebrow">Production</p>
                <h2 id="production-title">Recorded checklist</h2>
                <div className="execution-checklist-summary">
                  <strong>{execution.runOfShow.productionChecklist.completedCount}/{execution.runOfShow.productionChecklist.totalCount}</strong>
                  <span>items recorded complete</span>
                </div>
                {execution.runOfShow.productionChecklist.groups.map((group) => (
                  <details key={group.group} className="execution-checklist-group">
                    <summary>{group.group}</summary>
                    <ul>{group.items.map((item) => <li key={item.id} data-check-state={item.state}>{item.label}<span>{item.state === "completed" ? "Complete" : item.state === "not_completed" ? "Not complete" : "Not recorded"}</span></li>)}</ul>
                  </details>
                ))}
              </section>
              <section className="execution-card execution-unavailable" aria-labelledby="actuals-title">
                <p className="eyebrow">Actuals</p>
                <h2 id="actuals-title">{execution.actuals.title}</h2>
                <p>{execution.actuals.detail}</p>
              </section>
            </div>

          </div>
        )}

        {selected && execution && routeMode === "replay" && (
          <div className="commitment-execution" data-execution-surface="replay">
            <section className="execution-hero execution-hero-compact" aria-label="Replay event identity">
              <div><p className="eyebrow">Evidence review</p><h2>{execution.workspace.eventName}</h2><p>{execution.workspace.eventDate} · {execution.workspace.quoteNumber}</p></div>
              <StatusChip {...execution.workspace.status} />
            </section>
            <section className="execution-replay execution-unavailable" aria-labelledby="replay-evidence-title">
              <p className="eyebrow">Replay boundary</p>
              <h2 id="replay-evidence-title">{execution.replay.title}</h2>
              <p>{execution.replay.detail}</p>
              {execution.evidence.length > 0 && (
                <details className="execution-supporting-evidence">
                  <summary>Supporting record evidence</summary>
                  <p className="source-note">These current-record facts may support investigation. They are not a complete or immutable execution chronology.</p>
                  <ol>
                    {execution.evidence.map((item) => (
                      <li key={item.id}>
                        <time>{formatEvidenceTime(item.atISO)}</time>
                        <div><strong>{item.action}</strong><p>{item.transition}</p><small>{item.actor} · {item.channel} · {item.revision}</small></div>
                      </li>
                    ))}
                  </ol>
                </details>
              )}
            </section>
            <LiveAuthorityNotice compact />
          </div>
        )}

        {!expectsSelection && hasEvents && (
          <ul className="command-center-list live-ops-event-list" aria-label="Accepted and booked events">
            {events.map((quote) => {
              const { family, label } = classifyQuoteStatus(quote.status);
              const item = buildCommitmentExecutionPresentation(quote, {
                source: state.source,
                now: new Date(),
                tenantTimeZone,
                scheduleAvailable
              });
              return (
                <li key={quote.id} className="command-center-row">
                  <div className="command-center-row-main">
                    <p className="command-center-row-detail">
                      <strong>{eventTitle(quote)}</strong>
                      {" · "}{formatWorkspaceText(quote.quoteNumber, { emptyLabel: "Quote number not recorded" })}
                      {" · "}{formatWorkspaceDate(quote.event?.date)}
                    </p>
                    <p className="command-center-row-meta">
                      {item?.timingLabel || formatWorkspaceDate(quote.event?.date)}
                      {" · "}{formatWorkspaceText(quote.customer?.name || quote.customer?.email, { emptyLabel: "Customer not set" })}
                      {" · "}{formatWorkspaceText(quote.event?.venue, { emptyLabel: "Venue not set" })}
                      {" · "}{formatWorkspaceInteger(quote.event?.guests, { emptyLabel: "Guest count not set" })}
                      {hasWorkspaceNumber(quote.event?.guests) ? " guests" : ""}
                    </p>
                    <div className="live-ops-event-commercial">
                      <StatusChip family={family} label={label} />
                      <span>{formatWorkspaceMoney(quote.totals?.total, { emptyLabel: "Total not recorded" })}</span>
                      <span>{item?.commercialEvidence.deposit}</span>
                    </div>
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

        {selected && unavailableMode && (
          <div className="live-ops-actions">
            {routeMode === "detail" && eventOperationsAvailable && <button type="button" className="cta" data-event-operations-entry="control-room" onClick={() => onOpenLive?.(selected.id)}>Open Control Room</button>}
            {routeMode !== "replay" && eventOperationsAvailable && <button type="button" className="ghost" data-event-operations-entry="replay" onClick={() => onOpenReplay?.(selected.id)}>Open Replay</button>}
            {routeMode === "replay" && eventOperationsAvailable && <button type="button" className="ghost" onClick={() => onOpenLive?.(selected.id)}>Open Control Room</button>}
            <button type="button" className="ghost" onClick={() => onOpenQuote?.(selected.id)}>Open quote record</button>
            <button type="button" className="ghost" onClick={() => onOpenEvent?.(selected.id)}>Back to Event Focus</button>
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
