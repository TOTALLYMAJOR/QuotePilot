import { useMemo, useRef, useState } from "react";
import StaffEvidenceRail from "./StaffEvidenceRail";
import WorkspaceRecoveryState from "./WorkspaceRecoveryState";
import { useWorkspaceRouteHeadingFocus } from "../hooks/useWorkspaceRouteHeadingFocus";
import {
  buildMoneyRows,
  selectUpcomingEvents
} from "../lib/commandCenterEvidence";
import {
  buildNowCard,
  buildNowDecisionSummary,
  buildNowHorizon,
  formatNowReceiptAge
} from "./nowPresentation";
import { buildAmbientNowBriefing } from "../lib/ambientNowBriefing";
import { getWorkflowAttentionFocusId } from "../lib/quoteWorkflow";
import { classifyQuoteStatus } from "../lib/statusSemantics";
import {
  createAmbientAction,
  createAmbientActionResult,
  createSurfacePurposeContract
} from "../lib/ambientContracts";
import {
  formatWorkspaceDate,
  formatWorkspaceInteger,
  formatWorkspaceMoney,
  formatWorkspaceText,
  hasWorkspaceNumber
} from "../lib/workspacePresentation";
import { CheckCircle, Clock, User, UsersThree, WarningCircle } from "./ProductIcons";
import "./ambientNowView.css";

const AMBIENT_NOW_SURFACE = createSurfacePurposeContract({
  id: "ambient-now-briefing",
  objectScopes: ["workflow-item", "opportunity", "staff-workflow-evidence"],
  purposes: ["clarify", "advance", "resolve", "reveal_context"],
  entryReason: "Help staff focus on the three highest-priority items in the current view.",
  allowedEmptyState: {
    kind: "caught_up",
    message: "No Workflow item in the complete current view needs attention right now."
  },
  recoveryBehavior: {
    message: "Keep the current view visible and offer a refresh or the exact Workflow action.",
    nextActionIds: ["refresh-ambient-now", "review-ambient-now-priority"]
  }
});

const WAITING_MONEY_FAMILIES = new Set(["pending", "provider"]);

const RECEIPT_LABELS = Object.freeze({
  follow_up_completed: "Follow-up completed",
  change_request_acknowledged: "Change request acknowledged",
  change_request_handled: "Change request handled",
  approval_decision_recorded: "Approval decision recorded"
});

function normalizeRole(value) {
  const role = String(value || "staff").trim().toLowerCase();
  return role || "staff";
}

function safeDateLabel(date, timeZone, options) {
  try {
    return date.toLocaleDateString(undefined, { ...options, timeZone: timeZone || "UTC" });
  } catch {
    return date.toLocaleDateString(undefined, options);
  }
}

function eventDateParts(value) {
  const source = String(value || "").trim();
  const match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(source);
  if (!match) {
    return {
      month: "Date",
      day: "—",
      label: formatWorkspaceDate(source, { emptyLabel: "Date not set" })
    };
  }
  const date = new Date(`${source}T12:00:00.000Z`);
  return {
    month: date.toLocaleDateString(undefined, { month: "short", timeZone: "UTC" }),
    day: String(Number(match[3])),
    label: formatWorkspaceDate(source)
  };
}

function quoteForPriority(priority, quotes) {
  const quoteId = String(priority?.item?.quoteId || "").trim();
  return Array.isArray(quotes)
    ? quotes.find((quote) => String(quote?.id || "").trim() === quoteId) || null
    : null;
}

function quoteForId(quoteId, quotes) {
  const id = String(quoteId || "").trim();
  return Array.isArray(quotes)
    ? quotes.find((quote) => String(quote?.id || "").trim() === id) || null
    : null;
}

function objectTitle(quote) {
  return formatWorkspaceText(
    quote?.event?.name || quote?.customer?.name || quote?.quoteNumber,
    { emptyLabel: "Recorded opportunity" }
  );
}

function priorityAction(priority, card, role, targetAvailable = true) {
  const itemId = String(priority?.item?.id || priority?.signal?.id || "workflow-item").trim();
  const quoteId = String(priority?.item?.quoteId || "").trim();
  const targetSurface = String(card?.action?.target?.surface || "workflow").trim();
  const targetId = targetSurface === "customer"
    ? String(card?.action?.target?.customerId || "").trim()
    : itemId;
  return createAmbientAction({
    id: `review-now-priority:${itemId}`,
    outcomeLabel: card.action.label,
    purpose: "resolve",
    roles: [normalizeRole(role)],
    authorityLevel: "presentation",
    previewPolicy: "none",
    executionTarget: {
      kind: "route",
      targetId,
      surfaceId: targetSurface
    },
    receiptType: "none",
    reversibility: { kind: "none" },
    arrivalContract: {
      object: { id: itemId, type: "workflow-item", label: card.title },
      reason: priority.signal.claim,
      consequence: priority.signal.consequence,
      nextResolutionIds: ["review-focused-workflow-outcome"]
    },
    primary: true,
    enabled: Boolean(quoteId && targetId && targetAvailable),
    ...(!quoteId || !targetId || !targetAvailable
      ? { disabledReason: "The exact destination for this item is unavailable in this context." }
      : {})
  });
}

function resultFor(action, kind, overrides = {}) {
  return createAmbientActionResult({
    kind,
    actionId: action.id,
    object: action.arrivalContract.object,
    reason: overrides.reason || action.arrivalContract.reason,
    consequence: overrides.consequence || action.arrivalContract.consequence,
    nextResolutions: [{
      actionId: overrides.nextActionId || action.arrivalContract.nextResolutionIds[0],
      label: overrides.nextResolution || "Review the focused item and choose the next available step."
    }]
  });
}

function PriorityRow({ priority, card, index, count, role, onResolve, targetAvailable }) {
  const action = priorityAction(priority, card, role, targetAvailable);
  const evidenceState = priority.signal.availability.state;

  return (
    <li
      className="ambient-now-priority"
      data-signal-severity={priority.signal.severity}
      data-evidence-state={evidenceState}
      data-attention-position={index + 1}
      data-attention-urgency={card.urgent ? "urgent" : "waiting"}
    >
      <div className="ambient-now-priority__body">
        <div className="ambient-now-priority__copy">
          <span className="sr-only">Attention item {index + 1} of {count}. </span>
          <p className="ambient-now-priority__type">{card.typeLabel}</p>
          <h4>{card.title}</h4>
          <p className="ambient-now-priority__context">{card.context}</p>
          <p className="ambient-now-priority__sentence">
            <Clock size={17} aria-hidden="true" />
            <span>{card.sentence}</span>
          </p>
          <p className="ambient-now-priority__consequence" data-attention-consequence>
            <WarningCircle size={17} aria-hidden="true" />
            <span>{card.consequence}</span>
          </p>
          {card.whyNow && (
            <p className="ambient-now-priority__why">Why now: {card.whyNow}.</p>
          )}
          {evidenceState !== "available" && (
            <p className="ambient-now-priority__boundary">
              This view is {evidenceState}; source details follow below.
            </p>
          )}
        </div>
        <button
          type="button"
          className="ambient-now-priority__action"
          data-ambient-action-id={action.id}
          data-workspace-task-id={action.id}
          disabled={!action.enabled}
          title={!action.enabled ? action.disabledReason : undefined}
          aria-label={`${action.outcomeLabel} for ${card.title}`}
          onClick={() => onResolve({ action, card, priority })}
        >
          {action.outcomeLabel}
          <span aria-hidden="true">→</span>
        </button>
      </div>
    </li>
  );
}

function QuietProgress({ receipts = [], waitingRows = [], quotes = [], nowISO }) {
  if (!receipts.length && !waitingRows.length) return null;
  return (
    <section
      className="ambient-now-progress"
      aria-labelledby="ambient-now-progress-title"
      data-testid="now-quiet-progress"
      data-progress-groups={[receipts.length ? "handled" : "", waitingRows.length ? "waiting" : ""]
        .filter(Boolean)
        .join(" ")}
    >
      <div className="ambient-now-progress__title-row">
        <p className="eyebrow">Quiet progress</p>
        <span aria-hidden="true" />
      </div>
      <h3 id="ambient-now-progress-title" className="sr-only">Recently handled and waiting on others</h3>
      <div className={`ambient-now-progress__groups${receipts.length && waitingRows.length ? " ambient-now-progress__groups--split" : ""}`}>
        {receipts.length > 0 && (
          <section className="ambient-now-progress__group" aria-labelledby="ambient-now-handled-title" data-progress-group="handled">
            <h4 id="ambient-now-handled-title">Recently handled</h4>
            <ul>
              {receipts.slice(0, 2).map((receipt) => {
                const quote = quoteForId(receipt.quoteId, quotes);
                return (
                  <li key={receipt.id}>
                    <CheckCircle size={20} weight="regular" aria-hidden="true" />
                    <strong>{objectTitle(quote)}</strong>
                    <span>{RECEIPT_LABELS[receipt.kind] || receipt.label}</span>
                    <time dateTime={receipt.completedAtISO}>{formatNowReceiptAge(receipt, nowISO)}</time>
                  </li>
                );
              })}
            </ul>
          </section>
        )}
        {waitingRows.length > 0 && (
          <section className="ambient-now-progress__group ambient-now-progress__group--waiting" aria-labelledby="ambient-now-waiting-title" data-progress-group="waiting">
            <h4 id="ambient-now-waiting-title">Waiting on others</h4>
            <ul>
              {waitingRows.slice(0, 2).map((row, index) => {
                const quote = quoteForId(row.quoteId, quotes);
                return (
                  <li key={`${row.quoteId}-${row.kind}-${index}`}>
                    <Clock size={20} aria-hidden="true" />
                    <strong>{objectTitle(quote)}</strong>
                    <span>{row.label}</span>
                    <span>{formatWorkspaceMoney(row.amount)}</span>
                  </li>
                );
              })}
            </ul>
          </section>
        )}
      </div>
    </section>
  );
}

function UpcomingEventRow({ quote, onOpenCalendar }) {
  const date = eventDateParts(quote?.event?.date);
  const detail = [
    String(quote?.event?.time || "").trim(),
    String(quote?.event?.venue || "").trim()
  ].filter(Boolean).join(" · ");
  const guestCopy = hasWorkspaceNumber(quote?.event?.guests)
    ? `${formatWorkspaceInteger(quote.event.guests)} guests`
    : "Guest count not set";
  const lifecycle = classifyQuoteStatus(quote?.status);

  return (
    <li className="ambient-now-coming__event">
      <time className="ambient-now-coming__date" dateTime={String(quote?.event?.date || "")} aria-label={date.label}>
        <span>{date.month}</span>
        <strong>{date.day}</strong>
      </time>
      <div className="ambient-now-coming__event-copy">
        <strong>{formatWorkspaceText(quote?.event?.name || quote?.quoteNumber, { emptyLabel: "Untitled event" })}</strong>
        <span><Clock size={15} aria-hidden="true" />{detail || "Time and venue not set"}</span>
        <span><UsersThree size={15} aria-hidden="true" />{guestCopy}</span>
        <span><User size={15} aria-hidden="true" />{formatWorkspaceText(quote?.customer?.name || quote?.customer?.email, { emptyLabel: "Client not set" })}</span>
        <span className={`ambient-now-coming__status ambient-now-coming__status--${lifecycle.family}`}>
          <CheckCircle size={15} aria-hidden="true" />{lifecycle.label}
        </span>
      </div>
      {typeof onOpenCalendar === "function" ? (
        <button
          type="button"
          className="ambient-now-coming__calendar"
          onClick={() => onOpenCalendar(String(quote?.id || ""))}
          data-exact-event-id={String(quote?.id || "")}
          aria-label={`Open ${formatWorkspaceText(quote?.event?.name || quote?.quoteNumber, { emptyLabel: "event" })} in Calendar`}
        >
          Open in Calendar
        </button>
      ) : null}
    </li>
  );
}

function TemporalHorizon({ days = [] }) {
  return (
    <section className="ambient-now-horizon" aria-labelledby="ambient-now-horizon-title" data-testid="now-temporal-horizon">
      <div className="ambient-now-support__heading">
        <p className="eyebrow">Next 7 days</p>
        <span aria-hidden="true" />
      </div>
      <h3 id="ambient-now-horizon-title" className="sr-only">Seven-day time and pressure horizon</h3>
      <ol className="ambient-now-horizon__days">
        {days.map((day) => (
          <li key={day.dateISO} data-horizon-state={day.state} data-horizon-date={day.dateISO}>
            <time dateTime={day.dateISO}>
              <span>{day.weekday}</span>
              <strong>{day.day}</strong>
            </time>
            <span className="ambient-now-horizon__marker" aria-hidden="true" />
            <small>
              {day.urgentCount > 0
                ? `${day.urgentCount} urgent`
                : day.eventLabel || <span className="sr-only">No recorded pressure</span>}
            </small>
          </li>
        ))}
      </ol>
    </section>
  );
}

function ComingUp({ upcomingEvents = [], onOpenCalendar }) {
  if (!upcomingEvents.length) return null;
  return (
    <section className="ambient-now-coming" aria-labelledby="ambient-now-coming-title">
      <div className="ambient-now-support__heading">
        <p className="eyebrow">Coming up</p>
        <span aria-hidden="true" />
      </div>
      <h3 id="ambient-now-coming-title" className="sr-only">Upcoming accepted or booked events</h3>
      <ul aria-label="Upcoming events">
        {upcomingEvents.slice(0, 2).map((quote) => (
          <UpcomingEventRow key={quote.id} quote={quote} onOpenCalendar={onOpenCalendar} />
        ))}
      </ul>
    </section>
  );
}

function CommercialSteps({ rows = [], quotes = [] }) {
  if (!rows.length) return null;
  return (
    <section className="ambient-now-commercial-steps" aria-labelledby="ambient-now-money-title">
      <div className="ambient-now-support__heading">
        <p className="eyebrow">Commercial steps</p>
        <span aria-hidden="true" />
      </div>
      <h3 id="ambient-now-money-title" className="sr-only">Recorded commercial steps</h3>
      <ul>
        {rows.slice(0, 2).map((row, index) => (
          <li key={`${row.quoteId}-${row.kind}-${index}`}>
            <div>
              <strong>{objectTitle(quoteForId(row.quoteId, quotes))}</strong>
              <span>{row.label}</span>
            </div>
            <span>{formatWorkspaceMoney(row.amount)}</span>
          </li>
        ))}
      </ul>
    </section>
  );
}

function incompleteViewCopy(briefing) {
  const state = briefing?.freshness?.state;
  if (state === "stale") {
    return "The earlier complete view is still here, but the latest refresh did not finish.";
  }
  if (state === "partial") {
    return "Some workspace information did not finish refreshing, so QuotePilot cannot confirm that you are caught up.";
  }
  if (state === "truncated") {
    return "This view may not include every tracked item, so QuotePilot cannot confirm that you are caught up.";
  }
  if (state === "loading" || state === "refreshing") {
    return "This view is still coming together. The last complete information stays visible while it refreshes.";
  }
  return "QuotePilot does not have enough current information to confirm that you are caught up.";
}

export default function AmbientNowView({
  snapshot,
  organizationName = "",
  organizationId = "",
  currentUserRole = "staff",
  tenantTimeZone = "UTC",
  onRefresh,
  onOpenWorkflow,
  onOpenCustomer,
  onOpenCalendar,
  onNewQuote,
  nowDate = null
}) {
  const state = snapshot || {
    loading: true,
    error: "",
    attentionSummary: null,
    quotes: [],
    truncated: false,
    truncationKnown: false
  };
  const headingRef = useWorkspaceRouteHeadingFocus(true);
  const acknowledgementRef = useRef(null);
  const [nowISO] = useState(() => (
    nowDate instanceof Date && !Number.isNaN(nowDate.getTime())
      ? nowDate.toISOString()
      : new Date().toISOString()
  ));
  const [acknowledgement, setAcknowledgement] = useState(null);
  const briefing = useMemo(() => buildAmbientNowBriefing({
    snapshot: state,
    nowISO,
    timeZone: tenantTimeZone || "UTC"
  }), [nowISO, state, tenantTimeZone]);
  const priorityRows = useMemo(() => briefing.priorities.map((priority) => {
    const sourceCard = buildNowCard(priority.item, state.quotes, {
      signal: priority.signal,
      timingCue: priority.timingCue
    });
    const quote = quoteForPriority(priority, state.quotes);
    const eventName = String(quote?.event?.name || "").trim();
    return {
      priority,
      card: {
        ...sourceCard,
        title: eventName || sourceCard.title,
        context: eventName
          ? `${sourceCard.title} · ${sourceCard.meta}`
          : sourceCard.meta
      }
    };
  }), [briefing.priorities, state.quotes]);
  const upcomingEvents = useMemo(
    () => selectUpcomingEvents(state.quotes, { nowDate: new Date(nowISO) }),
    [nowISO, state.quotes]
  );
  const moneyRows = useMemo(() => buildMoneyRows(state.quotes), [state.quotes]);
  const waitingRows = useMemo(
    () => moneyRows.filter((row) => WAITING_MONEY_FAMILIES.has(row.family)),
    [moneyRows]
  );
  const commercialStepRows = useMemo(
    () => moneyRows.filter((row) => !WAITING_MONEY_FAMILIES.has(row.family)),
    [moneyRows]
  );
  const day = new Date(nowISO);
  const fullDateLabel = safeDateLabel(day, tenantTimeZone, {
    weekday: "long",
    month: "long",
    day: "numeric",
    year: "numeric"
  });
  const trulyCaughtUp = briefing.caughtUp.eligible && moneyRows.length === 0;
  const unavailable = briefing.state === "unavailable";
  const decisionSummary = useMemo(() => buildNowDecisionSummary({
    cards: priorityRows.map(({ card }) => card),
    upcomingEvents,
    commercialStepCount: moneyRows.length,
    caughtUp: trulyCaughtUp,
    incomplete: !briefing.caughtUp.eligible
  }), [briefing.caughtUp.eligible, moneyRows.length, priorityRows, trulyCaughtUp, upcomingEvents]);
  const horizonDays = useMemo(() => buildNowHorizon({
    nowISO,
    timeZone: tenantTimeZone || "UTC",
    urgentCount: decisionSummary.urgentCount,
    upcomingEvents
  }), [decisionSummary.urgentCount, nowISO, tenantTimeZone, upcomingEvents]);

  const announce = (result, label) => {
    setAcknowledgement({ result, label });
    window.requestAnimationFrame?.(() => acknowledgementRef.current?.focus());
  };

  const resolvePriority = ({ action, card, priority }) => {
    const pending = resultFor(action, "pending", {
      consequence: "Opening the exact Workflow item changes no quote or customer state.",
      nextResolution: "Review the focused item and choose the next step available to your role."
    });
    announce(pending, `Opening ${action.outcomeLabel.toLowerCase()} with its opportunity and reason.`);
    const item = priority.item;
    const target = card.action.target;
    const result = target.surface === "customer"
      ? onOpenCustomer?.(target.customerId)
      : onOpenWorkflow?.({
          quoteId: item.quoteId,
          attentionType: item.type,
          requestId: getWorkflowAttentionFocusId(item),
          actionId: action.id
        });
    if (result?.status === "recovery") {
      announce(resultFor(action, "recovery", {
        reason: result.reason || "The exact Workflow arrival could not be prepared.",
        consequence: "The current view remains visible and no record changed.",
        nextActionId: "refresh-ambient-now",
        nextResolution: result.nextResolution || "Refresh this view and try the exact item again."
      }), result.reason || "The exact Workflow item could not be opened.");
    }
  };

  const refresh = () => {
    const action = createAmbientAction({
      id: "refresh-ambient-now",
      outcomeLabel: "Refresh view",
      purpose: "clarify",
      roles: [normalizeRole(currentUserRole)],
      authorityLevel: "presentation",
      previewPolicy: "none",
      executionTarget: { kind: "query", targetId: "commercial-workspace-snapshot", surfaceId: AMBIENT_NOW_SURFACE.id },
      receiptType: "none",
      reversibility: { kind: "none" },
      arrivalContract: {
        object: {
          id: organizationId || "current-organization",
          type: "staff-workflow-evidence",
          label: "Current workspace view"
        },
        reason: "The user requested updated information for the current workspace view.",
        consequence: "The current complete view stays visible until all required information finishes loading.",
        nextResolutionIds: ["review-refreshed-ambient-now"]
      },
      primary: false,
      enabled: !state.loading,
      ...(state.loading ? { disabledReason: "A refresh is already in progress." } : {})
    });
    if (!action.enabled) return;
    announce(resultFor(action, "pending", {
      nextResolution: "Review the updated priorities when the refresh finishes."
    }), "Refreshing this workspace view. The last complete view stays visible while it loads.");
    onRefresh?.({ force: true });
  };

  const startQuote = () => {
    const action = createAmbientAction({
      id: "start-new-quote",
      outcomeLabel: "Start a quote",
      purpose: "advance",
      roles: [normalizeRole(currentUserRole)],
      authorityLevel: "presentation",
      previewPolicy: "none",
      executionTarget: { kind: "route", targetId: "new-quote", surfaceId: "quote-create" },
      receiptType: "none",
      reversibility: { kind: "none" },
      arrivalContract: {
        object: {
          id: organizationId || "current-organization",
          type: "organization",
          label: organizationName || "Current organization"
        },
        reason: "The user chose to begin a new quote.",
        consequence: "A new editable quote flow opens; no customer proposal is sent.",
        nextResolutionIds: ["complete-new-quote-draft"]
      },
      primary: false,
      enabled: typeof onNewQuote === "function",
      ...(typeof onNewQuote !== "function" ? { disabledReason: "Quote creation is unavailable in this context." } : {})
    });
    if (!action.enabled) return;
    announce(resultFor(action, "pending", {
      nextResolution: "Add the event details needed for a priced draft."
    }), "Opening a new editable quote. Nothing has been sent.");
    onNewQuote?.();
  };

  return (
    <section
      className="now-surface ambient-now ambient-purpose-surface"
      aria-labelledby="now-heading"
      data-surface-contract-id={AMBIENT_NOW_SURFACE.id}
      data-surface-purpose="clarify advance resolve reveal_context"
      data-surface-density="editorial"
      data-briefing-state={briefing.state}
    >
      <header className="ambient-now__masthead">
        <p className="ambient-now__breadcrumb">
          <span className="ambient-now__breadcrumb-prefix">Now <span aria-hidden="true">/</span></span>
          <time dateTime={nowISO}>{fullDateLabel}</time>
        </p>
        <h2
          ref={headingRef}
          id="now-heading"
          className="workspace-route-heading"
          tabIndex={-1}
          data-testid="now-daily-brief"
        >
          {decisionSummary.headline}
        </h2>
        <p className="ambient-now__intro">
          {decisionSummary.supporting || "The current view is ready for review."}
        </p>
      </header>

      {acknowledgement && (
        <div
          ref={acknowledgementRef}
          className={`ambient-now__acknowledgement ambient-now__acknowledgement--${acknowledgement.result.kind}`}
          role={acknowledgement.result.kind === "recovery" ? "alert" : "status"}
          tabIndex={-1}
          aria-live={acknowledgement.result.kind === "recovery" ? "assertive" : "polite"}
        >
          <strong>{acknowledgement.result.kind === "recovery" ? "Needs attention" : "On it"}</strong>
          <span>{acknowledgement.label}</span>
        </div>
      )}

      {unavailable && (
        <WorkspaceRecoveryState
          className="ambient-now__recovery"
          data-now-state="unavailable"
          eyebrow="Today’s view is unavailable"
          title="We couldn’t load today’s priorities."
          description="Try again when you’re ready. No quote, customer, or workflow record changed, and you can still start a new quote."
          titleId="ambient-now-unavailable-title"
          actionGroupLabel="Today view recovery actions"
        >
          <button type="button" className="cta" onClick={refresh} disabled={state.loading}>
            {state.loading ? "Trying again..." : "Try again"}
          </button>
          {typeof onNewQuote === "function" && (
            <button type="button" className="ghost" onClick={startQuote}>Start a quote</button>
          )}
        </WorkspaceRecoveryState>
      )}

      {!unavailable && state.error && (
        <p className="ambient-now__error" role="alert">
          One part of this workspace view could not refresh. Review About this view, then try again.
        </p>
      )}

      {!unavailable && <div className="ambient-now__decision-grid">
        <section className="ambient-now__priorities" aria-labelledby="ambient-now-priorities-title">
          <div className="ambient-now__section-heading">
            <p className="eyebrow">Needs you</p>
            {priorityRows.length > 0 && (
              <p
                className="ambient-now__attention-summary"
                aria-label={`Showing ${decisionSummary.urgentCount} urgent and ${decisionSummary.waitingCount} waiting items`}
                data-now-urgency-count={decisionSummary.urgentCount}
                data-now-waiting-count={decisionSummary.waitingCount}
              >
                <span>{decisionSummary.urgentCount} urgent</span>
                <span aria-hidden="true">·</span>
                <span>{decisionSummary.waitingCount} waiting</span>
              </p>
            )}
            <h3
              id="ambient-now-priorities-title"
              className={priorityRows.length > 0 ? "sr-only" : undefined}
            >
              {trulyCaughtUp ? "A quieter moment" : "This view needs a little more context"}
            </h3>
            {briefing.overflowCount > 0 && (
              <p className="ambient-now__overflow">
                {briefing.overflowCount} more priorit{briefing.overflowCount === 1 ? "y remains" : "ies remain"} in Workflow.
              </p>
            )}
          </div>

          {state.loading && !state.attentionSummary && (
            <p className="ambient-now__loading" role="status">Gathering the latest workspace information...</p>
          )}

          {!state.loading && priorityRows.length > 0 && (
            <ol className="ambient-now-priority-list">
              {priorityRows.map(({ priority, card }, index) => (
                <PriorityRow
                  key={priority.signal.id}
                  priority={priority}
                  card={card}
                  index={index}
                  count={priorityRows.length}
                  role={currentUserRole}
                  onResolve={resolvePriority}
                  targetAvailable={card.action.target.surface === "customer"
                    ? typeof onOpenCustomer === "function"
                    : typeof onOpenWorkflow === "function"}
                />
              ))}
            </ol>
          )}

          {!state.loading && priorityRows.length === 0 && (
            <div
              className={`ambient-now__caught-up${trulyCaughtUp ? " ambient-now__caught-up--healthy" : ""}`}
              data-caught-up={trulyCaughtUp ? "true" : "false"}
            >
              <span aria-hidden="true">{trulyCaughtUp ? "✓" : "○"}</span>
              <div>
                <h4>{trulyCaughtUp ? "You are caught up on the work tracked here." : "This view cannot call you caught up yet."}</h4>
                <p>
                  {trulyCaughtUp
                    ? "Nothing tracked in this view currently needs you."
                    : moneyRows.length > 0 && briefing.caughtUp.eligible
                      ? "No Workflow item in this view needs attention, but recorded payment steps remain below."
                      : incompleteViewCopy(briefing)}
                </p>
              </div>
            </div>
          )}
        </section>

        <aside className="ambient-now__support" aria-label="What is coming next">
          <TemporalHorizon days={horizonDays} />
          <ComingUp upcomingEvents={upcomingEvents} onOpenCalendar={onOpenCalendar} />
          <CommercialSteps rows={commercialStepRows} quotes={state.quotes} />
        </aside>
      </div>}

      {!unavailable && (
        <QuietProgress
          receipts={briefing.quietProgress.items}
          waitingRows={waitingRows}
          quotes={state.quotes}
          nowISO={nowISO}
        />
      )}

      {!unavailable && <div className="ambient-now__about-row">
        <StaffEvidenceRail
          presentation="compact"
          title="About this view"
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
        <button
          type="button"
          className="ambient-now__refresh"
          data-ambient-action-id="refresh-ambient-now"
          onClick={refresh}
          disabled={state.loading}
        >
          {state.loading ? "Refreshing…" : "Refresh view"}
        </button>
      </div>}
    </section>
  );
}
