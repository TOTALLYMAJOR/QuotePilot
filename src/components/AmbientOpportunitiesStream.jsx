import { lazy, Suspense, useMemo, useRef, useState } from "react";
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
import WorkspaceRecoveryState from "./WorkspaceRecoveryState";
import "./ambientOpportunitiesStream.css";

const InquiryQueue = lazy(() => import("./InquiryQueue"));

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

function StatusFact({ fact, hideLabel = false }) {
  return (
    <div className="ambient-opportunity__status-fact" data-status-fact={fact.id}>
      <dt className={hideLabel ? "sr-only" : undefined}>{fact.label}</dt>
      <dd>
        {fact.available
          ? <StatusChip family={fact.family} label={fact.value} />
          : <span className="ambient-opportunity__unavailable">Not recorded</span>}
      </dd>
    </div>
  );
}

function compactObligationCopy(fact) {
  const raw = String(fact?.raw || "").trim().toLowerCase();
  if (fact?.id === "booking-confirmation") {
    if (raw === "pending") return "Booking confirmation pending";
    if (raw === "sent") return "Booking confirmation sent";
  }
  if (fact?.id === "deposit-status") {
    if (raw === "unpaid") return "Deposit not requested";
    if (raw === "sent") return "Deposit requested";
  }
  if (fact?.id === "final-balance-status") {
    if (raw === "unpaid") return "Final balance not requested";
    if (raw === "sent") return "Final balance requested";
  }
  return fact.value;
}

function CompactCommercialPosition({ row }) {
  const { value, position } = row.commercialPriority;
  const recordedObligations = [position.booking, position.deposit, position.finalBalance]
    .filter((fact) => fact.available);
  return (
    <section
      className="ambient-opportunity__commercial-position"
      aria-label={`Commercial position for ${row.identity.eventName}`}
    >
      <div className="ambient-opportunity__saved-value" data-value-available={value.available ? "true" : "false"}>
        <span>{value.label}</span>
        <strong>{value.display}</strong>
      </div>
      <dl className="ambient-opportunity__compact-status">
        <StatusFact fact={position.proposal} hideLabel />
      </dl>
      <p className="ambient-opportunity__obligations">
        {recordedObligations.length > 0
          ? recordedObligations.map(compactObligationCopy).join(" · ")
          : "Booking and payment evidence not recorded"}
      </p>
    </section>
  );
}

function OpportunityRow({ row, onResolve, onInspect, position }) {
  const { primaryAction } = row;
  return (
    <li
      className="ambient-opportunity"
      data-opportunity-id={row.quoteId}
      data-needs-attention={row.requiresAttention ? "true" : "false"}
      data-opportunity-group={row.groupId}
      data-attention-type={row.workflow.target?.attentionType || ""}
      data-request-id={row.workflow.target?.requestId || ""}
    >
      <article aria-labelledby={`ambient-opportunity-title-${row.quoteId}`}>
        <span className="ambient-opportunity__index" aria-hidden="true">
          {String(position).padStart(2, "0")}
        </span>
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
          <span>{row.identity.venue}</span>
          <span aria-hidden="true">·</span>
          <span>
            {row.identity.guests === "Guest count not set"
              ? row.identity.guests
              : `${row.identity.guests} guests`}
          </span>
        </p>

        <CompactCommercialPosition row={row} />

        <div
          className="ambient-opportunity__next"
          data-layout-audit-group={`opportunity-next-${row.quoteId}`}
        >
          <p
            className="ambient-opportunity__next-reason"
            data-opportunity-summary-kind={row.queueSummary.kind}
          >
            <strong>{row.commercialPriority.significance.label}</strong>
            <span>{row.commercialPriority.significance.reason}</span>
            <small>
              {row.commercialPriority.significance.timing}
              {" · "}{row.commercialPriority.significance.consequence}
            </small>
          </p>
          <div className="ambient-opportunity__actions">
            <button
              type="button"
              className="ambient-opportunity__primary-action"
              data-ambient-action-id={primaryAction.id}
              data-workspace-task-id={primaryAction.id}
              data-ambient-action-purpose={primaryAction.purpose}
              disabled={!primaryAction.enabled}
              title={primaryAction.disabledReason || undefined}
              onClick={() => onResolve(row)}
            >
              {primaryAction.outcomeLabel}
              <span aria-hidden="true">→</span>
            </button>
          </div>
        </div>
        {!primaryAction.enabled && (
          <p className="ambient-opportunity__disabled-reason">
            {primaryAction.disabledReason}
          </p>
        )}
        <details
          className="ambient-opportunity__details"
          data-opportunity-disclosure="details"
        >
          <summary>
            <span>Details</span>
            <span
              className="ambient-opportunity__details-icon"
              aria-hidden="true"
            />
          </summary>
          <dl className="ambient-opportunity__momentum" aria-label="Opportunity status by area">
            {Object.entries(row.momentum.domains).map(([domain, value]) => (
              <MomentumFact key={domain} domain={domain} value={value} />
            ))}
          </dl>
          <div className="ambient-opportunity__recorded-state">
            <p className="ambient-opportunity__reference">Booking and payment details</p>
            <dl>
              <StatusFact fact={row.statusFacts.booking} />
              <StatusFact fact={row.statusFacts.deposit} />
              <StatusFact fact={row.statusFacts.finalBalance} />
            </dl>
            <p>
              These details are kept separate. Together, they still do not confirm that the event is ready or every payment is complete.
            </p>
            <button
              type="button"
              className="ambient-opportunity__inspect-action"
              data-ambient-opportunity-inspect="true"
              data-opportunity-row-action="inspect"
              onClick={(event) => onInspect?.(row, event.currentTarget)}
            >
              Inspect exact record
            </button>
          </div>
        </details>
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
    <details
      className="ambient-opportunities__boundary"
      data-read-current={boundary.currentComplete ? "true" : "false"}
    >
      <summary>
        <span>About this view</span>
        <strong>{boundary.sourceLabel}</strong>
      </summary>
      <div className="ambient-opportunities__boundary-body">
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
    </details>
  );
}

export default function AmbientOpportunitiesStream({
  headingRef,
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
  onRefresh,
  organizationId = "",
  catalog = null,
  onInquiryQuoteCreated,
  inquiryShowcaseEnabled = false,
  controller = null
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
          }, {
            preserveReturnContext: true,
            returnContextSurfaceId: "commercial-priority",
            returnContextHint: {
              focus: {
                kind: "opportunity-action",
                objectId: row.quoteId,
                actionId: action.id,
                controlId: row.workflow.target.requestId,
                attentionType: row.workflow.target.attentionType
              }
            }
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
      className="ambient-opportunities ambient-purpose-surface"
      aria-labelledby="ambient-opportunities-heading"
      data-surface-contract-id={stream.surfaceContract.id}
      data-surface-purpose={stream.surfaceContract.purposes.join(" ")}
      data-surface-density="editorial"
      data-opportunity-stream-state={stream.state}
      data-quote-controller={controller?.modelId || undefined}
    >
      <header className="ambient-opportunities__masthead">
        <div>
          <p className="ambient-opportunity__reference">Opportunities</p>
          <h1
            id="ambient-opportunities-heading"
            ref={headingRef}
            className="workspace-route-heading"
            tabIndex={-1}
          >
            Every event, with its next move.
          </h1>
          <p>
            Active and recent opportunities, ordered by what needs attention.
          </p>
        </div>
      </header>
      {inquiryShowcaseEnabled && ["admin", "sales"].includes(role(currentUserRole)) && <Suspense fallback={<p role="status">Loading customer inquiries…</p>}>
        <InquiryQueue
          organizationId={organizationId}
          catalog={catalog}
          enabled
          onQuoteCreated={onInquiryQuoteCreated}
        />
      </Suspense>}

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
        <WorkspaceRecoveryState
          className="ambient-opportunities__recovery"
          data-opportunities-state="unavailable"
          eyebrow="Opportunities unavailable"
          title="We couldn’t load opportunities."
          description="Try again when you’re ready. No quote or customer record changed, and you can still start a new quote."
          titleId="ambient-opportunities-incomplete-title"
          actionGroupLabel="Opportunity recovery actions"
        >
          {refreshAction.enabled && (
            <button
              type="button"
              className="cta"
              data-ambient-action-id={refreshAction.id}
              onClick={requestRefresh}
            >
              Try again
            </button>
          )}
          {startAction.enabled && (
            <button
              type="button"
              className="ghost"
              data-ambient-action-id={startAction.id}
              onClick={startOpportunity}
            >
              Start a quote
            </button>
          )}
        </WorkspaceRecoveryState>
      )}

      {stream.rows.length > 0 && (
        <>
          <div className="ambient-opportunities__groups">
            {stream.groups.map((group) => (
              <section
                className="ambient-opportunities__group"
                data-opportunity-group={group.id}
                aria-labelledby={`ambient-opportunities-group-${group.id}`}
                key={group.id}
              >
                <header className="ambient-opportunities__group-heading">
                  <h2 id={`ambient-opportunities-group-${group.id}`}>{group.label}</h2>
                  <span>{group.rows.length}</span>
                </header>
                <ol className="ambient-opportunities__list" aria-label={`${group.label} opportunities`}>
                  {group.rows.map((row) => (
                    <OpportunityRow
                      key={row.quoteId}
                      row={row}
                      onResolve={resolve}
                      onInspect={capabilities.openOpportunity
                        ? (candidate) => onOpenOpportunity?.({
                            quoteId: candidate.quoteId,
                            actionId: `inspect-opportunity:${candidate.quoteId}`,
                            object: candidate.primaryAction.arrivalContract.object,
                            reason: "Review the exact saved opportunity record without changing it.",
                            consequence: "Opening the quote creates no commercial mutation.",
                            nextResolutionId: candidate.primaryAction.arrivalContract.nextResolutionIds[0]
                          })
                        : undefined}
                      position={stream.rows.findIndex((candidate) => candidate.quoteId === row.quoteId) + 1}
                    />
                  ))}
                </ol>
              </section>
            ))}
          </div>
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
