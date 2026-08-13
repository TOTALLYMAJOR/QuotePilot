import { useMemo, useRef, useState } from "react";
import StatusChip from "./StatusChip";
import {
  createAmbientAction,
  createAmbientActionResult
} from "../lib/ambientContracts";
import {
  AMBIENT_OPPORTUNITIES_SURFACE_CONTRACT,
  buildAmbientOpportunityStream
} from "../lib/ambientOpportunityStream";
import { formatWorkspaceDateTime } from "../lib/workspacePresentation";
import "./ambientOpportunitiesStream.css";

const MOMENTUM_LABELS = Object.freeze({
  proposal: "Proposal completeness",
  commercial: "Pricing and margin",
  customer: "Customer state",
  operational: "Event planning"
});

function role(value) {
  return String(value || "staff").trim().toLowerCase() || "staff";
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

function MomentumFact({ domain, value }) {
  const unavailable = value.state === "unavailable";
  return (
    <div
      className="ambient-opportunity__momentum-fact"
      data-momentum-domain={domain}
      data-momentum-state={value.state}
    >
      <dt>{MOMENTUM_LABELS[domain]}</dt>
      <dd>
        <strong>
          {domain === "proposal" && Number.isFinite(value.completenessPercent)
            ? `${value.completenessPercent}%`
            : unavailable
              ? "Still to confirm"
              : value.state === "healthy"
                ? "On track"
                : value.state === "blocked"
                  ? "Blocked"
                  : "Needs attention"}
        </strong>
        <span>{value.reason || value.summary}</span>
      </dd>
    </div>
  );
}

function StatusFact({ fact }) {
  return (
    <div className="ambient-opportunity__status-fact" data-status-fact={fact.id}>
      <dt>{fact.label}</dt>
      <dd>
        {fact.available
          ? <StatusChip family={fact.family} label={fact.value} />
          : <span className="ambient-opportunity__unavailable">Not recorded</span>}
      </dd>
    </div>
  );
}

function OpportunityRow({ row, onResolve }) {
  const { primaryAction } = row;
  return (
    <li
      className="ambient-opportunity"
      data-opportunity-id={row.quoteId}
      data-needs-attention={row.requiresAttention ? "true" : "false"}
    >
      <article aria-labelledby={`ambient-opportunity-title-${row.quoteId}`}>
        <header className="ambient-opportunity__identity">
          <div>
            <p className="ambient-opportunity__reference">{row.identity.quoteNumber}</p>
            <h3 id={`ambient-opportunity-title-${row.quoteId}`}>{row.identity.eventName}</h3>
            <p>{row.identity.customerName}</p>
          </div>
          {row.statusFacts.lifecycle.available
            ? (
                <StatusChip
                  family={row.statusFacts.lifecycle.family}
                  label={row.statusFacts.lifecycle.value}
                  className="ambient-opportunity__lifecycle"
                />
              )
            : <span className="ambient-opportunity__unavailable">Lifecycle not recorded</span>}
        </header>

        <p className="ambient-opportunity__event-line">
          <span>{row.identity.eventDate}</span>
          <span aria-hidden="true">·</span>
          <span>
            {row.identity.guests === "Guest count not set"
              ? row.identity.guests
              : `${row.identity.guests} guests`}
          </span>
        </p>

        <dl className="ambient-opportunity__momentum" aria-label="Opportunity status by area">
          {Object.entries(row.momentum.domains).map(([domain, value]) => (
            <MomentumFact key={domain} domain={domain} value={value} />
          ))}
        </dl>

        <details className="ambient-opportunity__recorded-state">
          <summary>
            <span>Booking and payment details</span>
            <span className="ambient-opportunity__recorded-cue" aria-hidden="true" />
          </summary>
          <dl>
            <StatusFact fact={row.statusFacts.booking} />
            <StatusFact fact={row.statusFacts.deposit} />
            <StatusFact fact={row.statusFacts.finalBalance} />
          </dl>
          <p>
            These details are kept separate. Together, they still do not confirm that the event is ready or every payment is complete.
          </p>
        </details>

        <div className="ambient-opportunity__next">
          <div>
            <p className="ambient-opportunity__reference">Next useful step</p>
            <h4>{primaryAction.outcomeLabel}</h4>
            <p>{primaryAction.arrivalContract.reason}</p>
          </div>
          <button
            type="button"
            className="ambient-opportunity__primary-action"
            data-ambient-action-id={primaryAction.id}
            data-ambient-action-purpose={primaryAction.purpose}
            disabled={!primaryAction.enabled}
            title={primaryAction.disabledReason || undefined}
            onClick={() => onResolve(row)}
          >
            {primaryAction.outcomeLabel}
            <span aria-hidden="true">→</span>
          </button>
        </div>
        {!primaryAction.enabled && (
          <p className="ambient-opportunity__disabled-reason">
            {primaryAction.disabledReason}
          </p>
        )}
      </article>
    </li>
  );
}

function ReadBoundary({ boundary, omittedCount }) {
  const concerns = [...boundary.messages];
  if (omittedCount > 0) {
    concerns.push(`${omittedCount} record${omittedCount === 1 ? " was" : "s were"} omitted because exact identity could not be established.`);
  }
  return (
    <aside
      className="ambient-opportunities__boundary"
      aria-labelledby="ambient-opportunities-boundary-title"
      data-read-current={boundary.currentComplete ? "true" : "false"}
    >
      <div>
        <p className="ambient-opportunity__reference">Where this came from</p>
        <h3 id="ambient-opportunities-boundary-title">{boundary.sourceLabel}</h3>
      </div>
      <div>
        <p>{boundary.sourceBoundary}</p>
        {boundary.loadedAtISO && (
          <p>Last checked on this device {formatWorkspaceDateTime(boundary.loadedAtISO)}.</p>
        )}
        {concerns.length > 0 && (
          <ul>
            {concerns.map((message) => <li key={message}>{message}</li>)}
          </ul>
        )}
      </div>
    </aside>
  );
}

export default function AmbientOpportunitiesStream({
  quotes = [],
  source = "",
  readBoundary = {},
  currentUserRole = "staff",
  nowISO = "",
  todayISO = "",
  canOpenOpportunity = false,
  canOpenWorkflow = false,
  canStartOpportunity = false,
  canRefresh = false,
  onOpenOpportunity,
  onOpenWorkflow,
  onStartOpportunity,
  onRefresh
}) {
  const acknowledgementRef = useRef(null);
  const [acknowledgement, setAcknowledgement] = useState(null);
  const capabilities = useMemo(() => ({
    openOpportunity: canOpenOpportunity && typeof onOpenOpportunity === "function",
    openWorkflow: canOpenWorkflow && typeof onOpenWorkflow === "function",
    startOpportunity: canStartOpportunity && typeof onStartOpportunity === "function",
    refresh: canRefresh && typeof onRefresh === "function"
  }), [
    canOpenOpportunity,
    canOpenWorkflow,
    canRefresh,
    canStartOpportunity,
    onOpenOpportunity,
    onOpenWorkflow,
    onRefresh,
    onStartOpportunity
  ]);
  const stream = useMemo(() => buildAmbientOpportunityStream({
    quotes,
    source,
    readBoundary,
    currentUserRole,
    capabilities,
    nowISO,
    todayISO
  }), [capabilities, currentUserRole, nowISO, quotes, readBoundary, source, todayISO]);

  const announce = (result, message) => {
    setAcknowledgement({ result, message });
    window.requestAnimationFrame?.(() => acknowledgementRef.current?.focus());
  };

  const resolve = (row) => {
    const action = row.primaryAction;
    if (!action.enabled) return;
    announce(resultFor(action, "pending", {
      consequence: "Opening the exact context changes no quote, customer, booking, payment, or provider state."
    }), `Opening ${action.outcomeLabel.toLowerCase()} with its opportunity and reason.`);
    try {
      const callbackResult = row.workflow.target && capabilities.openWorkflow
        ? onOpenWorkflow?.({
            ...row.workflow.target,
            actionId: action.id,
            object: action.arrivalContract.object,
            reason: action.arrivalContract.reason,
            consequence: action.arrivalContract.consequence,
            nextResolutionId: action.arrivalContract.nextResolutionIds[0]
          })
        : onOpenOpportunity?.({
            quoteId: row.quoteId,
            actionId: action.id,
            object: action.arrivalContract.object,
            reason: action.arrivalContract.reason,
            consequence: action.arrivalContract.consequence,
            nextResolutionId: action.arrivalContract.nextResolutionIds[0]
          });
      if (callbackResult?.status === "recovery") {
        announce(resultFor(action, "recovery", {
          reason: callbackResult.reason || "The exact destination could not be prepared.",
          consequence: "This opportunity stream remains visible and no record changed.",
          nextActionId: capabilities.refresh ? "refresh-opportunities" : action.id,
          nextResolution: callbackResult.nextResolution || "Try the exact destination again."
        }), callbackResult.reason || "The exact destination could not be opened.");
      }
    } catch (error) {
      announce(resultFor(action, "recovery", {
        reason: error instanceof Error ? error.message : "The exact destination could not be prepared.",
        consequence: "This opportunity stream remains visible and no record changed.",
        nextActionId: capabilities.refresh ? "refresh-opportunities" : action.id,
        nextResolution: "Review the current record, then try the exact destination again."
      }), "The exact destination could not be opened. No record changed.");
    }
  };

  const refreshAction = createAmbientAction({
    id: "refresh-opportunities",
    outcomeLabel: "Refresh opportunities",
    purpose: "clarify",
    roles: [role(currentUserRole)],
    authorityLevel: "presentation",
    previewPolicy: "none",
    executionTarget: {
      kind: "query",
      targetId: "tenant-scoped-opportunities",
      surfaceId: AMBIENT_OPPORTUNITIES_SURFACE_CONTRACT.id
    },
    receiptType: "none",
    reversibility: { kind: "none" },
    arrivalContract: {
      object: { id: "current-opportunity-read", type: "quote-read", label: "Current opportunities" },
      reason: "The opportunity list may be incomplete, or newer records were requested.",
      consequence: "The workspace may refresh its existing organization-scoped records; this view does not access data itself.",
      nextResolutionIds: ["review-refreshed-opportunities"]
    },
    primary: false,
    enabled: capabilities.refresh && !stream.readBoundary.loading,
    ...(!(capabilities.refresh && !stream.readBoundary.loading)
      ? { disabledReason: stream.readBoundary.loading ? "A refresh is already in progress." : "Refresh is unavailable in this host." }
      : {})
  });

  const startAction = createAmbientAction({
    id: "start-opportunity",
    outcomeLabel: "Start an opportunity",
    purpose: "advance",
    roles: [role(currentUserRole)],
    authorityLevel: "presentation",
    previewPolicy: "none",
    executionTarget: { kind: "route", targetId: "new-quote", surfaceId: "quote-create" },
    receiptType: "none",
    reversibility: { kind: "none" },
    arrivalContract: {
      object: { id: "new-opportunity", type: "opportunity", label: "New opportunity" },
      reason: "The completed opportunity read returned no records and the user chose the meaningful starting action.",
      consequence: "The host opens a new editable quote flow; no proposal is sent or provider action performed.",
      nextResolutionIds: ["complete-new-opportunity-draft"]
    },
    primary: false,
    enabled: capabilities.startOpportunity,
    ...(!capabilities.startOpportunity ? { disabledReason: "You can’t start an opportunity from this view." } : {})
  });

  const requestRefresh = () => {
    if (!refreshAction.enabled) return;
    announce(resultFor(refreshAction, "pending", {
      nextResolution: "Review the records when the host read completes."
    }), "Refreshing opportunities. Records already loaded will stay visible.");
    onRefresh?.({
      force: true,
      actionId: refreshAction.id,
      object: refreshAction.arrivalContract.object,
      reason: refreshAction.arrivalContract.reason,
      consequence: refreshAction.arrivalContract.consequence,
      nextResolutionId: refreshAction.arrivalContract.nextResolutionIds[0]
    });
  };

  const startOpportunity = () => {
    if (!startAction.enabled) return;
    announce(resultFor(startAction, "pending", {
      nextResolution: "Add the event details required for a priced draft."
    }), "Opening a new editable opportunity. Nothing has been sent.");
    try {
      const callbackResult = onStartOpportunity?.({
        actionId: startAction.id,
        object: startAction.arrivalContract.object,
        reason: startAction.arrivalContract.reason,
        consequence: startAction.arrivalContract.consequence,
        nextResolutionId: startAction.arrivalContract.nextResolutionIds[0]
      });
      if (callbackResult?.status === "recovery") {
        announce(resultFor(startAction, "recovery", {
          reason: callbackResult.reason || "The new opportunity flow was not opened.",
          consequence: "The existing workspace and any unsaved draft remain unchanged.",
          nextResolution: callbackResult.nextResolution || "Continue the current work or try again."
        }), callbackResult.reason || "The new opportunity flow was not opened.");
      }
    } catch (error) {
      announce(resultFor(startAction, "recovery", {
        reason: error instanceof Error ? error.message : "The new opportunity flow was not opened.",
        consequence: "The existing workspace and any unsaved draft remain unchanged.",
        nextResolution: "Continue the current work or try again."
      }), "The new opportunity flow was not opened. Nothing changed.");
    }
  };

  return (
    <section
      className="ambient-opportunities"
      aria-labelledby="ambient-opportunities-heading"
      data-surface-contract-id={stream.surfaceContract.id}
      data-surface-purpose={stream.surfaceContract.purposes.join(" ")}
      data-opportunity-stream-state={stream.state}
    >
      <header className="ambient-opportunities__masthead">
        <div>
          <p className="ambient-opportunity__reference">Opportunities</p>
          <h2 id="ambient-opportunities-heading">Current opportunities</h2>
          <p>
            Each opportunity keeps proposal, pricing, customer, and event-planning details separate, with one useful next step.
          </p>
        </div>
        <button
          type="button"
          className="ambient-opportunities__refresh"
          data-ambient-action-id={refreshAction.id}
          disabled={!refreshAction.enabled}
          title={refreshAction.disabledReason || undefined}
          onClick={requestRefresh}
        >
          {stream.readBoundary.loading ? "Refreshing…" : "Refresh"}
        </button>
      </header>

      {acknowledgement && (
        <div
          ref={acknowledgementRef}
          className={`ambient-opportunities__acknowledgement ambient-opportunities__acknowledgement--${acknowledgement.result.kind}`}
          role={acknowledgement.result.kind === "recovery" ? "alert" : "status"}
          aria-live={acknowledgement.result.kind === "recovery" ? "assertive" : "polite"}
          tabIndex={-1}
        >
          <strong>{acknowledgement.result.kind === "recovery" ? "Needs attention" : "On it"}</strong>
          <span>{acknowledgement.message}</span>
        </div>
      )}

      {stream.state === "loading" && (
        <p className="ambient-opportunities__state" role="status">
          Loading current opportunities…
        </p>
      )}

      {stream.state === "empty" && (
        <section className="ambient-opportunities__state" aria-labelledby="ambient-opportunities-empty-title">
          <p className="ambient-opportunity__reference">A clear starting point</p>
          <h3 id="ambient-opportunities-empty-title">No opportunities appear in the current records.</h3>
          <p>Start one when you have a customer or event to plan.</p>
          <button
            type="button"
            className="ambient-opportunity__primary-action"
            data-ambient-action-id={startAction.id}
            disabled={!startAction.enabled}
            title={startAction.disabledReason || undefined}
            onClick={startOpportunity}
          >
            {startAction.outcomeLabel}
            <span aria-hidden="true">→</span>
          </button>
        </section>
      )}

      {stream.state === "incomplete" && (
        <section className="ambient-opportunities__state" aria-labelledby="ambient-opportunities-incomplete-title">
          <p className="ambient-opportunity__reference">Still checking</p>
          <h3 id="ambient-opportunities-incomplete-title">We couldn’t finish loading opportunities.</h3>
          <p>Caught-up status is unavailable until the current records finish loading.</p>
          {refreshAction.enabled && (
            <button
              type="button"
              className="ambient-opportunity__primary-action"
              data-ambient-action-id={refreshAction.id}
              onClick={requestRefresh}
            >
              Refresh opportunities
              <span aria-hidden="true">→</span>
            </button>
          )}
        </section>
      )}

      {stream.rows.length > 0 && (
        <>
          <ol className="ambient-opportunities__list">
            {stream.rows.map((row) => (
              <OpportunityRow key={row.quoteId} row={row} onResolve={resolve} />
            ))}
          </ol>
          {stream.caughtUp.eligible && (
            <div className="ambient-opportunities__caught-up" data-caught-up="true">
              <span aria-hidden="true">✓</span>
              <div>
                <strong>No tracked follow-ups or proposal gaps are due here.</strong>
                <p>Other details may still need confirmation; this does not mean the event is ready or that outside services have completed.</p>
              </div>
            </div>
          )}
        </>
      )}

      <ReadBoundary
        boundary={stream.readBoundary}
        omittedCount={stream.omittedRecords.length}
      />
    </section>
  );
}
