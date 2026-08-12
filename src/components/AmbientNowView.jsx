import { useMemo, useRef, useState } from "react";
import StatusChip from "./StatusChip";
import StaffEvidenceRail from "./StaffEvidenceRail";
import { useWorkspaceRouteHeadingFocus } from "../hooks/useWorkspaceRouteHeadingFocus";
import {
  buildMoneyRows,
  selectUpcomingEvents
} from "./CommandCenterHome";
import { buildNowCard } from "./nowPresentation";
import { buildAmbientNowBriefing } from "../lib/ambientNowBriefing";
import {
  createAmbientAction,
  createAmbientActionResult,
  createSurfacePurposeContract
} from "../lib/ambientContracts";
import {
  formatWorkspaceDate,
  formatWorkspaceDateTime,
  formatWorkspaceInteger,
  formatWorkspaceMoney,
  formatWorkspaceText,
  hasWorkspaceNumber
} from "../lib/workspacePresentation";
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

function normalizeRole(value) {
  const role = String(value || "staff").trim().toLowerCase();
  return role || "staff";
}

function priorityAction(priority, card, role) {
  const itemId = String(priority?.item?.id || priority?.signal?.id || "workflow-item").trim();
  const quoteId = String(priority?.item?.quoteId || "").trim();
  return createAmbientAction({
    id: `review-now-priority:${itemId}`,
    outcomeLabel: card.action.label,
    purpose: "resolve",
    roles: [normalizeRole(role)],
    authorityLevel: "presentation",
    previewPolicy: "none",
    executionTarget: {
      kind: "route",
      targetId: itemId,
      surfaceId: "workflow"
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
    enabled: Boolean(quoteId),
    ...(!quoteId ? { disabledReason: "This item has no quote identity for an exact Workflow arrival." } : {})
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

function PriorityRow({ priority, card, index, role, onResolve }) {
  const action = priorityAction(priority, card, role);
  const evidenceState = priority.signal.availability.state;

  return (
    <li
      className="ambient-now-priority"
      data-signal-severity={priority.signal.severity}
      data-evidence-state={evidenceState}
    >
      <span className="ambient-now-priority__number" aria-hidden="true">
        {String(index + 1).padStart(2, "0")}
      </span>
      <div className="ambient-now-priority__body">
        <div className="ambient-now-priority__heading">
          <div>
            <p>{card.meta}</p>
            <h4>{card.title}</h4>
          </div>
          <StatusChip family={card.family} label={card.label} />
        </div>
        <p className="ambient-now-priority__sentence">{card.sentence}</p>
        {evidenceState !== "available" && (
          <p className="ambient-now-priority__boundary">
            This view is {evidenceState}; source details follow below.
          </p>
        )}
        <button
          type="button"
          className="ambient-now-priority__action"
          data-ambient-action-id={action.id}
          disabled={!action.enabled}
          title={!action.enabled ? action.disabledReason : undefined}
          onClick={() => onResolve({ action, card, priority })}
        >
          {action.outcomeLabel}
          <span aria-hidden="true">→</span>
        </button>
      </div>
    </li>
  );
}

function QuietProgress({ receipts = [] }) {
  if (!receipts.length) return null;
  return (
    <section className="ambient-now-progress" aria-labelledby="ambient-now-progress-title">
      <div>
        <p className="eyebrow">Recently completed</p>
        <h3 id="ambient-now-progress-title">Recently recorded as complete</h3>
        <p>These are internal staff records only. They do not imply customer contact or provider delivery.</p>
      </div>
      <ul>
        {receipts.map((receipt) => (
          <li key={receipt.id}>
            <span aria-hidden="true">✓</span>
            <div>
              <strong>{receipt.label}</strong>
              <small>
                {formatWorkspaceText(receipt.quoteNumber, { emptyLabel: "Recorded opportunity" })}
                {" · "}{formatWorkspaceDateTime(receipt.completedAtISO)}
              </small>
            </div>
          </li>
        ))}
      </ul>
    </section>
  );
}

function Horizon({ upcomingEvents, moneyRows }) {
  if (!upcomingEvents.length && !moneyRows.length) return null;
  return (
    <section className="ambient-now-horizon" aria-labelledby="ambient-now-horizon-title">
      <div className="ambient-now-horizon__heading">
        <p className="eyebrow">Coming up</p>
        <h3 id="ambient-now-horizon-title">Upcoming events and payment steps</h3>
      </div>
      <div className="ambient-now-horizon__columns">
        {upcomingEvents.length > 0 && (
          <section aria-labelledby="ambient-now-events-title">
            <h4 id="ambient-now-events-title">Next 7 days</h4>
            <ul>
              {upcomingEvents.slice(0, 3).map((quote) => (
                <li key={quote.id}>
                  <strong>{formatWorkspaceText(quote.event?.name || quote.quoteNumber, { emptyLabel: "Untitled event" })}</strong>
                  <span>
                    {formatWorkspaceDate(quote.event?.date)}
                    {" · "}{formatWorkspaceInteger(quote.event?.guests, { emptyLabel: "Guest count not set" })}
                    {hasWorkspaceNumber(quote.event?.guests) ? " guests" : ""}
                  </span>
                </li>
              ))}
            </ul>
          </section>
        )}
        {moneyRows.length > 0 && (
          <section aria-labelledby="ambient-now-money-title">
            <h4 id="ambient-now-money-title">Payment steps</h4>
            <ul>
              {moneyRows.slice(0, 3).map((row, index) => (
                <li key={`${row.quoteId}-${row.kind}-${index}`}>
                  <strong>{row.kind}</strong>
                  <span>{row.customerName} · {formatWorkspaceMoney(row.amount)}</span>
                </li>
              ))}
            </ul>
          </section>
        )}
      </div>
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
  const priorityRows = useMemo(() => briefing.priorities.map((priority) => ({
    priority,
    card: buildNowCard(priority.item, state.quotes)
  })), [briefing.priorities, state.quotes]);
  const upcomingEvents = useMemo(
    () => selectUpcomingEvents(state.quotes, { nowDate: new Date(nowISO) }),
    [nowISO, state.quotes]
  );
  const moneyRows = useMemo(() => buildMoneyRows(state.quotes), [state.quotes]);
  const day = new Date(nowISO);
  const dayLabel = day.toLocaleDateString(undefined, { weekday: "long" });
  const dateLabel = day.toLocaleDateString(undefined, { month: "short", day: "numeric" });
  const trulyCaughtUp = briefing.caughtUp.eligible && moneyRows.length === 0;

  const announce = (result, label) => {
    setAcknowledgement({ result, label });
    window.requestAnimationFrame?.(() => acknowledgementRef.current?.focus());
  };

  const resolvePriority = ({ action, priority }) => {
    const pending = resultFor(action, "pending", {
      consequence: "Opening the exact Workflow item changes no quote or customer state.",
      nextResolution: "Review the focused item and choose the next step available to your role."
    });
    announce(pending, `Opening ${action.outcomeLabel.toLowerCase()} with its opportunity and reason.`);
    const item = priority.item;
    const result = onOpenWorkflow?.({
      quoteId: item.quoteId,
      attentionType: item.type,
      requestId: item.sourceRequestId || item.requestId || ""
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

  return (
    <section
      className="now-surface ambient-now"
      aria-labelledby="now-heading"
      data-surface-contract-id={AMBIENT_NOW_SURFACE.id}
      data-surface-purpose="clarify advance resolve reveal_context"
      data-briefing-state={briefing.state}
    >
      <header className="command-center-head ambient-now__masthead">
        <div>
          <p className="eyebrow">Now</p>
          <h2 ref={headingRef} id="now-heading" className="workspace-route-heading" tabIndex={-1}>
            What to review today
          </h2>
          <p className="now-date">{dayLabel} · {dateLabel}</p>
          <p className="ambient-now__intro">
            A short list of what needs attention today.
          </p>
        </div>
        <div className="right-actions">
          <button
            type="button"
            className="ghost"
            data-ambient-action-id="refresh-ambient-now"
            onClick={refresh}
            disabled={state.loading}
          >
            {state.loading ? "Refreshing..." : "Refresh view"}
          </button>
          <button
            type="button"
            className="cta"
            data-ambient-action-id="start-new-quote"
            onClick={() => {
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
            }}
          >
            Start a quote
          </button>
        </div>
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

      <section className="ambient-now__priorities" aria-labelledby="ambient-now-priorities-title">
        <div className="ambient-now__section-heading">
          <div>
            <p className="eyebrow">What matters now</p>
            <h3 id="ambient-now-priorities-title">
              {priorityRows.length > 0
                ? "What needs attention next"
                : trulyCaughtUp
                  ? "A quieter moment"
                  : "This view needs a little more context"}
            </h3>
          </div>
          {briefing.overflowCount > 0 && (
            <p>
              {briefing.overflowCount} more item{briefing.overflowCount === 1 ? "" : "s"}{" "}
              {briefing.overflowCount === 1 ? "remains" : "remain"} in Workflow.
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
                role={currentUserRole}
                onResolve={resolvePriority}
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

      {state.error && (
        <p className="ambient-now__error" role="alert">
          One part of this workspace view could not refresh. Review the information details above, then try again.
        </p>
      )}

      <QuietProgress receipts={briefing.quietProgress.items} />
      <Horizon upcomingEvents={upcomingEvents} moneyRows={moneyRows} />
    </section>
  );
}
