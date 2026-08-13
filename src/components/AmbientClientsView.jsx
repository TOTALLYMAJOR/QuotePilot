import { useEffect, useMemo, useRef, useState } from "react";
import StatusChip from "./StatusChip";
import {
  createAmbientAction,
  createAmbientActionResult
} from "../lib/ambientContracts";
import {
  buildAmbientClientRelationship,
  buildAmbientClientsDirectory
} from "../lib/ambientClients";
import { classifyQuoteStatus } from "../lib/statusSemantics";
import {
  formatWorkspaceDate,
  formatWorkspaceDateTime,
  formatWorkspaceInteger,
  formatWorkspaceText
} from "../lib/workspacePresentation";
import "./ambientClientsView.css";

function text(value) {
  return String(value ?? "").trim();
}

function role(value) {
  return text(value).toLowerCase() || "staff";
}

function scheduleFrame(callback) {
  if (typeof window !== "undefined" && typeof window.requestAnimationFrame === "function") {
    const frame = window.requestAnimationFrame(callback);
    return () => window.cancelAnimationFrame?.(frame);
  }
  const timer = setTimeout(callback, 0);
  return () => clearTimeout(timer);
}

function actionResult(action, kind, overrides = {}) {
  return createAmbientActionResult({
    kind,
    actionId: action.id,
    object: action.arrivalContract.object,
    reason: overrides.reason || action.arrivalContract.reason,
    consequence: overrides.consequence || action.arrivalContract.consequence,
    nextResolutions: [{
      actionId: overrides.nextActionId || action.arrivalContract.nextResolutionIds[0],
      label: overrides.nextResolution || "Review the focused client and choose an available next step."
    }]
  });
}

function directoryBoundary(model = {}) {
  return model.boundary || model.readBoundary || {
    sourceLabel: "Client source unavailable",
    sourceBoundary: "Client information has not finished loading yet.",
    messages: []
  };
}

function directoryRows(model = {}) {
  return Array.isArray(model.rows) ? model.rows : [];
}

function clientIdentity(row = {}) {
  const identity = row.identity || row.client || row.customer || row;
  return {
    name: text(identity.name || identity.email) || "Unnamed client",
    company: text(identity.company),
    email: text(identity.email),
    phone: text(identity.phone)
  };
}

function clientLatest(row = {}) {
  const latest = row.latest || row.relationship || row.identity || row;
  return {
    quoteNumber: text(latest.quoteNumber || latest.lastQuoteNumber),
    eventName: text(latest.eventName || latest.lastEventName),
    eventDate: text(latest.eventDate || latest.lastEventDate)
  };
}

function fallbackReviewClientAction(row, currentUserRole) {
  const customerId = text(row.customerId || row.clientId || row.id);
  return createAmbientAction({
    id: `review-client:${customerId || "unavailable"}`,
    outcomeLabel: "Review client",
    purpose: "reveal_context",
    roles: [role(currentUserRole)],
    authorityLevel: "presentation",
    previewPolicy: "none",
    executionTarget: {
      kind: "route",
      targetId: customerId || "unavailable-client",
      surfaceId: "client-overview"
    },
    receiptType: "none",
    reversibility: { kind: "none" },
    arrivalContract: {
      object: { id: customerId || "unavailable-client", type: "client", label: "Client" },
      reason: "You selected this client from the current list.",
      consequence: "Opening the client overview changes no client, quote, conversation, payment, booking, or provider evidence.",
      nextResolutionIds: ["review-client-relationship"]
    },
    primary: true,
    enabled: Boolean(customerId),
    ...(!customerId ? { disabledReason: "This row has no exact client identity." } : {})
  });
}

export function AmbientClientsDirectory({
  model = {},
  searchDraft = "",
  cursorHistoryLength = 0,
  currentUserRole = "staff",
  onSearchDraftChange,
  onApplySearch,
  onClear,
  onRefresh,
  onOpenClient,
  onStartOpportunity,
  onPreviousPage,
  onNextPage,
  headingRef = null
}) {
  const acknowledgementRef = useRef(null);
  const [acknowledgement, setAcknowledgement] = useState(null);
  const rows = directoryRows(model);
  const boundary = directoryBoundary(model);
  const state = text(model.state) || (rows.length ? "success" : "empty");

  const announce = (result, message) => {
    setAcknowledgement({ result, message });
    scheduleFrame(() => acknowledgementRef.current?.focus());
  };

  const refreshAction = useMemo(() => createAmbientAction({
    id: "refresh-clients",
    outcomeLabel: "Refresh clients",
    purpose: "clarify",
    roles: [role(currentUserRole)],
    authorityLevel: "presentation",
    previewPolicy: "none",
    executionTarget: { kind: "query", targetId: "tenant-clients", surfaceId: text(model.surfaceContract?.id) || "ambient-clients" },
    receiptType: "none",
    reversibility: { kind: "none" },
    arrivalContract: {
      object: { id: "current-client-read", type: "client-read", label: "Current clients" },
      reason: "You asked to refresh the current client list.",
      consequence: "The app may refresh only this organization’s client information. No client record is changed.",
      nextResolutionIds: ["review-refreshed-clients"]
    },
    primary: false,
    enabled: typeof onRefresh === "function" && !model.loading,
    ...(!(typeof onRefresh === "function" && !model.loading)
      ? { disabledReason: model.loading ? "The current client refresh is already in progress." : "This client list cannot be refreshed right now." }
      : {})
  }), [currentUserRole, model.loading, model.surfaceContract?.id, onRefresh]);

  const startAction = useMemo(() => createAmbientAction({
    id: "start-client-opportunity",
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
      reason: "The meaningful starting action was selected from Clients.",
      consequence: "An editable quote draft opens. Nothing is sent and no outside service is contacted.",
      nextResolutionIds: ["complete-opportunity-draft"]
    },
    primary: false,
    enabled: typeof onStartOpportunity === "function",
    ...(typeof onStartOpportunity !== "function"
      ? { disabledReason: "A new opportunity cannot be started from this view right now." }
      : {})
  }), [currentUserRole, onStartOpportunity]);

  const reviewClient = (row) => {
    const action = row.primaryAction || fallbackReviewClientAction(row, currentUserRole);
    if (!action.enabled) return;
    announce(actionResult(action, "pending"), "Opening this client with the relationship context already in view.");
    try {
      const response = onOpenClient?.({
        customerId: text(row.customerId || row.clientId || row.id),
        actionId: action.id,
        object: action.arrivalContract.object,
        reason: action.arrivalContract.reason,
        consequence: action.arrivalContract.consequence,
        nextResolutionId: action.arrivalContract.nextResolutionIds[0]
      });
      if (response?.status === "recovery") {
        announce(actionResult(action, "recovery", {
          reason: response.reason || "The exact client overview could not be opened.",
          consequence: "The current client list remains visible and no record changed.",
          nextResolution: response.nextResolution || "Review the current row, then try again."
        }), response.reason || "The exact client overview could not be opened.");
      }
    } catch (error) {
      announce(actionResult(action, "recovery", {
        reason: error instanceof Error ? error.message : "The exact client overview could not be opened.",
        consequence: "The current client list remains visible and no record changed.",
        nextResolution: "Review the current row, then try again."
      }), "The exact client overview could not be opened. No record changed.");
    }
  };

  const refresh = () => {
    if (!refreshAction.enabled) return;
    announce(actionResult(refreshAction, "pending", {
      nextResolution: "Review the client list when the refresh finishes."
    }), "Refreshing clients. The current page stays visible while newer information loads.");
    onRefresh?.();
  };

  const start = () => {
    if (!startAction.enabled) return;
    announce(actionResult(startAction, "pending", {
      nextResolution: "Add the client and event details needed for a priced draft."
    }), "Opening a new editable opportunity. Nothing has been sent.");
    onStartOpportunity?.({
      actionId: startAction.id,
      object: startAction.arrivalContract.object,
      reason: startAction.arrivalContract.reason,
      consequence: startAction.arrivalContract.consequence,
      nextResolutionId: startAction.arrivalContract.nextResolutionIds[0]
    });
  };

  return (
    <main
      className="container workspace-route-main"
      aria-labelledby="ambient-clients-title"
      data-capability-state={state}
    >
      <section
        className="ambient-clients ambient-purpose-surface"
        data-surface-contract-id={model.surfaceContract?.id || "ambient-clients"}
        data-surface-purpose={(model.surfaceContract?.purposes || ["clarify", "advance", "reveal_context"]).join(" ")}
        data-surface-density="editorial"
        data-ambient-clients-state={state}
      >
        <header className="ambient-clients__masthead">
          <div>
            <p className="ambient-clients__label">Clients</p>
            <h1 ref={headingRef} id="ambient-clients-title" className="workspace-route-heading" tabIndex={-1}>
              People you’re working with
            </h1>
            <p>Each client stays connected to the quotes, events, and conversations already recorded for them.</p>
          </div>
          {state !== "empty" && (
            <button
              type="button"
              className="ambient-clients__start"
              data-ambient-action-id={startAction.id}
              disabled={!startAction.enabled}
              onClick={start}
            >
              {startAction.outcomeLabel}
            </button>
          )}
        </header>

        {acknowledgement && (
          <div
            ref={acknowledgementRef}
            className="ambient-clients__acknowledgement"
            data-result-kind={acknowledgement.result.kind}
            role={acknowledgement.result.kind === "recovery" ? "alert" : "status"}
            aria-live={acknowledgement.result.kind === "recovery" ? "assertive" : "polite"}
            tabIndex={-1}
          >
            <strong>{acknowledgement.result.kind === "recovery" ? "Needs review" : "Opening"}</strong>
            <span>{acknowledgement.message}</span>
          </div>
        )}

        <form className="ambient-clients__toolbar" role="search" onSubmit={onApplySearch}>
          <label>
            <span>Find a client by name or email</span>
            <input
              type="search"
              value={searchDraft}
              autoComplete="off"
              onChange={(event) => onSearchDraftChange?.(event.target.value)}
            />
          </label>
          <button type="submit" className="ghost">Search</button>
          <button type="button" className="ghost" onClick={onClear}>Clear</button>
          <button
            type="button"
            className="ambient-clients__refresh"
            data-ambient-action-id={refreshAction.id}
            disabled={!refreshAction.enabled}
            onClick={refresh}
          >
            {model.loading ? "Refreshing…" : "Refresh"}
          </button>
        </form>

        {(model.error || boundary.error) && rows.length > 0 && (
          <p className="error-note" role="alert">{model.error || boundary.error}</p>
        )}

        {state === "loading" && rows.length === 0 && (
          <section className="ambient-clients__state" role="status">
            <p className="ambient-clients__label">Current clients</p>
            <h2>Loading client records</h2>
            <p>The client list will appear when loading finishes.</p>
          </section>
        )}

        {["error", "stale", "bounded", "incomplete"].includes(state) && rows.length === 0 && (
          <section className="ambient-clients__state">
            <p className="ambient-clients__label">Current clients</p>
            <h2>Client information is not available yet</h2>
            <p>QuotePilot cannot tell whether this list is empty or fully up to date yet. Refresh to try again.</p>
          </section>
        )}

        {state === "empty" && (
          <section className="ambient-clients__state">
            <p className="ambient-clients__label">A clear starting point</p>
            <h2>No clients appear in this view</h2>
            <p>Start an opportunity when you have someone new to plan for.</p>
            <button
              type="button"
              className="ambient-clients__start"
              data-ambient-action-id={startAction.id}
              disabled={!startAction.enabled}
              onClick={start}
            >
              {startAction.outcomeLabel}
            </button>
          </section>
        )}

        {rows.length > 0 && (
          <ol className="ambient-clients__list">
            {rows.map((row) => {
              const customerId = text(row.customerId || row.clientId || row.id);
              const identity = clientIdentity(row);
              const latest = clientLatest(row);
              const action = row.primaryAction || fallbackReviewClientAction(row, currentUserRole);
              return (
                <li key={customerId}>
                  <article className="ambient-client" data-client-id={customerId}>
                    <div>
                      <p className="ambient-clients__label">Client</p>
                      <h2>{identity.name}</h2>
                      {identity.company && <p>{identity.company}</p>}
                    </div>
                    <div>
                      <p>{identity.email || "Email not recorded"}</p>
                      <small>{identity.phone || "Phone not recorded"}</small>
                    </div>
                    <div className="ambient-client__latest">
                      <p className="ambient-clients__label">Most recent link</p>
                      <p>{latest.eventName || latest.quoteNumber || "No linked opportunity"}</p>
                      <small>
                        {[latest.quoteNumber, latest.eventDate ? formatWorkspaceDate(latest.eventDate) : ""]
                          .filter(Boolean).join(" · ") || "No linked event date"}
                      </small>
                    </div>
                    <button
                      type="button"
                      className="ambient-client__primary"
                      data-ambient-action-id={action.id}
                      disabled={!action.enabled}
                      title={action.disabledReason || undefined}
                      onClick={() => reviewClient(row)}
                    >
                      {action.outcomeLabel}
                      <span aria-hidden="true">→</span>
                    </button>
                  </article>
                </li>
              );
            })}
          </ol>
        )}

        {(cursorHistoryLength > 0 || Boolean(model.nextCursor)) && (
          <nav className="ambient-clients__pagination" aria-label="Client pages">
            <button type="button" className="ghost" disabled={!cursorHistoryLength || model.loading} onClick={onPreviousPage}>
              Previous
            </button>
            <button type="button" className="ghost" disabled={!model.nextCursor || model.loading} onClick={onNextPage}>
              Next
            </button>
          </nav>
        )}

        <aside className="ambient-clients__boundary" aria-labelledby="ambient-clients-boundary-title">
          <div>
            <p className="ambient-clients__label">Where this came from</p>
            <h2 id="ambient-clients-boundary-title">{boundary.sourceLabel || "Client records"}</h2>
          </div>
          <div>
            <p>{boundary.sourceBoundary || boundary.outcome || "Only the client information available on this page is shown."}</p>
            {boundary.loadedAtISO && <p>Last checked on this device {formatWorkspaceDateTime(boundary.loadedAtISO)}.</p>}
            {Array.isArray(boundary.messages || boundary.notes) && (boundary.messages || boundary.notes).length > 0 && (
              <ul>{(boundary.messages || boundary.notes).map((message) => <li key={message}>{message}</li>)}</ul>
            )}
          </div>
        </aside>
      </section>
    </main>
  );
}

export function AmbientClientsDirectoryHost({
  state = {},
  organizationId = "",
  currentUserRole = "staff",
  onOpenClient,
  onStartOpportunity,
  ...viewProps
}) {
  const model = useMemo(() => buildAmbientClientsDirectory({
    state: {
      ...state,
      organizationId
    },
    currentUserRole,
    capabilities: {
      openClient: typeof onOpenClient === "function",
      startOpportunity: typeof onStartOpportunity === "function",
      refresh: typeof viewProps.onRefresh === "function"
    }
  }), [
    currentUserRole,
    onOpenClient,
    onStartOpportunity,
    organizationId,
    state,
    viewProps.onRefresh
  ]);

  return (
    <AmbientClientsDirectory
      {...viewProps}
      model={{
        ...model,
        loading: state.loading,
        error: state.error,
        nextCursor: state.nextCursor
      }}
      currentUserRole={currentUserRole}
      onOpenClient={onOpenClient}
      onStartOpportunity={onStartOpportunity}
    />
  );
}

function relationshipClient(model, workspace) {
  return model.client || model.customer || workspace?.customer || {};
}

function relationshipOpportunities(model, workspace) {
  if (Array.isArray(model.activeOpportunities)) return model.activeOpportunities;
  return (Array.isArray(workspace?.activeQuotes) ? workspace.activeQuotes : []).map((quote) => ({
    quoteId: text(quote.id),
    quoteNumber: text(quote.quoteNumber),
    eventName: text(quote.event?.name),
    eventDate: text(quote.event?.date),
    status: text(quote.status),
    total: quote.totals?.total
  }));
}

function relationshipConversations(model, workspace) {
  return Array.isArray(model.conversations)
    ? model.conversations
    : Array.isArray(workspace?.conversations)
      ? workspace.conversations
      : [];
}

function relationshipPrimaryAction(model = {}) {
  return model.primaryAction || model.nextAction?.action || null;
}

function relationshipTarget(model = {}) {
  return model.primaryTarget || model.nextAction?.target || model.target || {};
}

export function AmbientClientRelationship({
  model = {},
  workspace = null,
  currentUserRole = "staff",
  headingRef = null,
  onBack,
  onRefresh,
  onOpenOpportunity,
  onOpenConversation,
  onOpenWorkflow,
  onOpenClientRecord,
  recordSections = null,
  arrivalContext = null,
  arrivalAttempted = false,
  onArrivalResolution
}) {
  const localHeadingRef = useRef(null);
  const acknowledgementRef = useRef(null);
  const recordRef = useRef(null);
  const [acknowledgement, setAcknowledgement] = useState(null);
  const [recordOpen, setRecordOpen] = useState(false);
  const client = relationshipClient(model, workspace);
  const customerId = text(client.clientId || client.customerId || client.id);
  const opportunities = relationshipOpportunities(model, workspace);
  const conversations = relationshipConversations(model, workspace);
  const boundary = model.boundary || model.readBoundary || {};
  const primaryAction = relationshipPrimaryAction(model);
  const primaryTarget = relationshipTarget(model);
  const rootHeadingRef = headingRef || localHeadingRef;
  const caughtUp = model.caughtUp === true
    || model.caughtUp?.eligible === true
    || model.nextAction?.kind === "none";
  const refreshAction = useMemo(() => createAmbientAction({
    id: `refresh-client:${customerId || "unavailable"}`,
    outcomeLabel: "Refresh client",
    purpose: "clarify",
    roles: [role(currentUserRole)],
    authorityLevel: "presentation",
    previewPolicy: "none",
    executionTarget: {
      kind: "query",
      targetId: customerId || "unavailable-client",
      surfaceId: model.surfaceContract?.id || "ambient-client-relationship"
    },
    receiptType: "none",
    reversibility: { kind: "none" },
    arrivalContract: {
      object: { id: customerId || "unavailable-client", type: "client", label: "Client" },
      reason: "You asked to refresh this client’s current information.",
      consequence: "The current client view stays visible while newer information loads. No record is changed.",
      nextResolutionIds: ["review-refreshed-client"]
    },
    primary: false,
    enabled: Boolean(customerId && typeof onRefresh === "function" && !model.boundary?.loading),
    ...(!(customerId && typeof onRefresh === "function" && !model.boundary?.loading)
      ? { disabledReason: "This client cannot be refreshed right now." }
      : {})
  }), [customerId, currentUserRole, model.boundary?.loading, model.surfaceContract?.id, onRefresh]);

  useEffect(() => {
    if (!arrivalAttempted) return;
    if (!arrivalContext) {
      onArrivalResolution?.({
        status: "recovery",
        reason: "The exact client arrival context is unavailable.",
        consequence: "No alternate client was substituted and the current view remains unchanged.",
        nextResolution: "Return to Clients and choose the client again."
      });
      return;
    }
    const exact = arrivalContext.surfaceId === "client-overview"
      && arrivalContext.object?.type === "client"
      && arrivalContext.object?.id === customerId
      && arrivalContext.focus?.customerId === customerId;
    if (!exact) {
      onArrivalResolution?.({
        status: "recovery",
        reason: "The loaded client does not match the exact requested client.",
        consequence: "No alternate client was substituted and no record changed.",
        nextResolution: "Return to Clients and choose the intended client again."
      });
      return;
    }
    const cancel = scheduleFrame(() => {
      rootHeadingRef.current?.focus({ preventScroll: true });
      onArrivalResolution?.({ status: "resolved" });
    });
    return cancel;
  }, [arrivalAttempted, arrivalContext, customerId, onArrivalResolution, rootHeadingRef]);

  const announce = (result, message) => {
    setAcknowledgement({ result, message });
    scheduleFrame(() => acknowledgementRef.current?.focus());
  };

  const refresh = () => {
    if (!refreshAction.enabled) return;
    announce(actionResult(refreshAction, "pending", {
      nextResolution: "Review the client overview when the refresh finishes."
    }), "Refreshing this client. The current view stays visible while newer information loads.");
    onRefresh?.();
  };

  const resolveAction = (action, target = {}) => {
    if (!action?.enabled) return;
    announce(actionResult(action, "pending"), `Opening ${action.outcomeLabel.toLowerCase()} with this client’s context attached.`);
    try {
      let response = null;
      const destination = text(target.destination || target.kind || action.executionTarget?.surfaceId);
      if (["workflow", "approval"].includes(destination)) {
        response = onOpenWorkflow?.(target);
      } else if (["conversation", "messages"].includes(destination)) {
        response = onOpenConversation?.(
          text(target.quoteId || action.executionTarget?.targetId),
          {
            arrivalContext: {
              object: action.arrivalContract.object,
              target
            }
          }
        );
      } else if (["rebook", "rebook-entry", "client-record", "client_context"].includes(destination)) {
        if (typeof onOpenClientRecord === "function") {
          response = onOpenClientRecord(target);
        } else {
          setRecordOpen(true);
          scheduleFrame(() => {
            const rebookHeading = document.getElementById("customer-revenue-opportunities-title");
            (rebookHeading || recordRef.current)?.focus?.({ preventScroll: false });
            (rebookHeading || recordRef.current)?.scrollIntoView?.({ block: "start", behavior: "smooth" });
          });
          response = { status: "resolved" };
        }
      } else if (["opportunity", "living-opportunity"].includes(destination)) {
        response = onOpenOpportunity?.({
          quoteId: text(target.quoteId || action.executionTarget?.targetId),
          actionId: action.id,
          object: action.arrivalContract.object,
          reason: action.arrivalContract.reason,
          consequence: action.arrivalContract.consequence,
          nextResolutionId: action.arrivalContract.nextResolutionIds[0]
        });
      } else if (destination === "refresh") {
        response = onRefresh?.();
      } else {
        throw new Error("This next step has no exact destination in the client overview.");
      }
      if (response?.status === "recovery") {
        announce(actionResult(action, "recovery", {
          reason: response.reason || "The exact destination could not be opened.",
          consequence: "The client overview remains visible and no record changed.",
          nextResolution: response.nextResolution || "Review the current context, then try again."
        }), response.reason || "The exact destination could not be opened.");
      } else if (response?.status === "resolved") {
        announce(actionResult(action, "context"), "The requested client context is ready to review.");
      }
    } catch (error) {
      announce(actionResult(action, "recovery", {
        reason: error instanceof Error ? error.message : "The exact destination could not be opened.",
        consequence: "The client overview remains visible and no record changed.",
        nextResolution: "Review the current context, then try again."
      }), "The exact destination could not be opened. No record changed.");
    }
  };

  const reviewOpportunity = (opportunity) => {
    const quoteId = text(opportunity.quoteId || opportunity.id);
    const action = createAmbientAction({
      id: `review-client-opportunity:${quoteId}`,
      outcomeLabel: "Review opportunity",
      purpose: "reveal_context",
      roles: [role(currentUserRole)],
      authorityLevel: "presentation",
      previewPolicy: "none",
      executionTarget: { kind: "route", targetId: quoteId, surfaceId: "living-opportunity" },
      receiptType: "none",
      reversibility: { kind: "none" },
      arrivalContract: {
        object: { id: quoteId, type: "opportunity", label: "Opportunity" },
        reason: "This active opportunity was selected from the exact client relationship.",
        consequence: "Opening it changes no quote, client, pricing, conversation, payment, or booking evidence.",
        nextResolutionIds: ["review-living-opportunity"]
      },
      primary: false,
      enabled: Boolean(quoteId && typeof onOpenOpportunity === "function"),
      ...(!(quoteId && typeof onOpenOpportunity === "function") ? { disabledReason: "This opportunity has no exact available destination." } : {})
    });
    resolveAction(action, { destination: "opportunity", quoteId });
  };

  const reviewConversation = (conversation) => {
    const quoteId = text(conversation.quoteId);
    const action = createAmbientAction({
      id: `review-client-conversation:${quoteId}`,
      outcomeLabel: "Open conversation",
      purpose: "reveal_context",
      roles: [role(currentUserRole)],
      authorityLevel: "presentation",
      previewPolicy: "none",
      executionTarget: { kind: "route", targetId: quoteId, surfaceId: "conversation" },
      receiptType: "none",
      reversibility: { kind: "none" },
      arrivalContract: {
        object: { id: quoteId, type: "opportunity", label: "Opportunity conversation" },
        reason: "You selected this opportunity’s conversation from the client overview.",
        consequence: "Opening it sends nothing and marks no message read.",
        nextResolutionIds: ["review-quote-conversation"]
      },
      primary: false,
      enabled: Boolean(quoteId && typeof onOpenConversation === "function"),
      ...(!(quoteId && typeof onOpenConversation === "function") ? { disabledReason: "This conversation has no exact available destination." } : {})
    });
    resolveAction(action, { destination: "conversation", quoteId });
  };

  const relationshipContext = model.relationshipContext || model.summary || {};
  const bounded = model.boundary?.currentComplete === false;
  const activeCount = relationshipContext.activeOpportunityCount ?? opportunities.length;
  const attentionCount = relationshipContext.attentionCount ?? workspace?.attention?.itemCount ?? 0;
  const activeLabel = relationshipContext.activeOpportunityLabel
    || `${formatWorkspaceInteger(activeCount)} active ${activeCount === 1 ? "opportunity" : "opportunities"}${bounded ? " shown" : ""}`;
  const attentionLabel = relationshipContext.attentionLabel
    || `${formatWorkspaceInteger(attentionCount)} needing review${bounded ? " in this view" : ""}`;
  const nextEvent = relationshipContext.nextEvent || workspace?.briefing?.nextEvent || null;

  return (
    <section
      className="ambient-client-overview ambient-purpose-surface"
      data-surface-contract-id={model.surfaceContract?.id || "ambient-client-relationship"}
      data-surface-purpose={(model.surfaceContract?.purposes || ["clarify", "advance", "resolve", "reveal_context"]).join(" ")}
      data-surface-density="editorial"
      data-client-id={customerId}
      data-client-overview-state={model.state || "success"}
    >
      <button type="button" className="workspace-text-link ambient-client-overview__back" onClick={onBack}>
        Back to Clients
      </button>

      <header className="ambient-client-overview__identity">
        <div>
          <p className="ambient-client-overview__label">Client</p>
          <h1 ref={rootHeadingRef} id="ambient-client-overview-title" className="workspace-route-heading" tabIndex={-1}>
            {formatWorkspaceText(client.name || client.email, { emptyLabel: "Unnamed client" })}
          </h1>
          <p className="ambient-client-overview__identity-contact">
            {[client.company, client.email, client.phone].map(text).filter(Boolean).map((item) => <span key={item}>{item}</span>)}
            {![client.company, client.email, client.phone].some(text) && <span>No contact details recorded</span>}
          </p>
        </div>
        <button
          type="button"
          className="ambient-client-overview__secondary"
          data-ambient-action-id={refreshAction.id}
          disabled={!refreshAction.enabled}
          title={refreshAction.disabledReason || undefined}
          onClick={refresh}
        >
          {model.boundary?.loading ? "Refreshing…" : refreshAction.outcomeLabel}
        </button>
      </header>

      {acknowledgement && (
        <div
          ref={acknowledgementRef}
          className="ambient-client-overview__acknowledgement"
          data-result-kind={acknowledgement.result.kind}
          role={acknowledgement.result.kind === "recovery" ? "alert" : "status"}
          aria-live={acknowledgement.result.kind === "recovery" ? "assertive" : "polite"}
          tabIndex={-1}
        >
          <strong>{acknowledgement.result.kind === "recovery" ? "Needs review" : "Opening"}</strong>
          <span>{acknowledgement.message}</span>
        </div>
      )}

      <section className="ambient-client-overview__summary" aria-labelledby="ambient-client-at-a-glance-title">
        <div>
          <p className="ambient-client-overview__label">At a glance</p>
          <h2 id="ambient-client-at-a-glance-title" className="visually-hidden">Client relationship at a glance</h2>
          <dl className="ambient-client-overview__signals">
            <div><dt>Current work</dt><dd>{activeLabel}</dd></div>
            <div><dt>Needs review</dt><dd>{attentionLabel}</dd></div>
            <div>
              <dt>Next dated event</dt>
              <dd>{nextEvent ? formatWorkspaceDate(nextEvent.date) : model.boundary?.truncated ? "Not shown in the current results" : "None recorded"}</dd>
            </div>
          </dl>
        </div>
        <article className="ambient-client-overview__next" data-next-state={caughtUp ? "caught-up" : "action"}>
          <div>
            <p className="ambient-client-overview__label">Suggested next step</p>
            <h2>{caughtUp
              ? "No tracked follow-up is due"
              : primaryAction?.outcomeLabel || model.nextAction?.label || "Review this client"}</h2>
            <p>{caughtUp
              ? model.caughtUp?.reason || "No follow-up in the current client view needs attention."
              : primaryAction?.arrivalContract?.reason || model.nextAction?.reason || "Review the available client context and choose the next step."}</p>
          </div>
          {!caughtUp && primaryAction?.enabled && (
            <button
              type="button"
              className="ambient-client-overview__primary"
              data-ambient-action-id={primaryAction.id}
              onClick={() => resolveAction(primaryAction, primaryTarget)}
            >
              {primaryAction.outcomeLabel}
              <span aria-hidden="true">→</span>
            </button>
          )}
        </article>
      </section>

      <section className="ambient-client-overview__section" aria-labelledby="ambient-client-opportunities-title">
        <div className="ambient-client-overview__section-head">
          <h2 id="ambient-client-opportunities-title">Active opportunities</h2>
          <p>{model.boundary?.truncated ? "Only active opportunities available in this view are shown." : "Current quotes still in progress for this client."}</p>
        </div>
        {opportunities.length === 0 ? (
          <p className="source-note">No active opportunity appears in the current client information.</p>
        ) : (
          <ol className="ambient-client-overview__opportunities">
            {opportunities.map((opportunity) => {
              const quoteId = text(opportunity.quoteId || opportunity.id);
              const status = classifyQuoteStatus(opportunity.status);
              return (
                <li key={quoteId}>
                  <div>
                    <h3>{formatWorkspaceText(opportunity.eventName || opportunity.event?.name || opportunity.quoteNumber, { emptyLabel: "Untitled opportunity" })}</h3>
                    <p>
                      {formatWorkspaceText(opportunity.quoteNumber, { emptyLabel: "Quote number pending" })}
                      {text(opportunity.eventDate || opportunity.event?.date) ? ` · ${formatWorkspaceDate(opportunity.eventDate || opportunity.event?.date)}` : ""}
                    </p>
                    <StatusChip family={status.family} label={status.label} />
                  </div>
                  <button type="button" className="ambient-client-overview__secondary" onClick={() => reviewOpportunity(opportunity)}>
                    Review opportunity
                  </button>
                </li>
              );
            })}
          </ol>
        )}
      </section>

      <section className="ambient-client-overview__section" aria-labelledby="ambient-client-conversations-title">
        <div className="ambient-client-overview__section-head">
          <h2 id="ambient-client-conversations-title">Conversations</h2>
          <p>Each conversation stays attached to its quote. Opening one sends nothing and marks nothing read.</p>
        </div>
        {conversations.length === 0 ? (
          <p className="source-note">No conversation linked to a quote appears in the current client information.</p>
        ) : (
          <ol className="ambient-client-overview__conversations">
            {conversations.map((conversation) => (
              <li key={conversation.quoteId}>
                <div>
                  <h3>{formatWorkspaceText(conversation.quoteNumber, { emptyLabel: "Quote number pending" })}</h3>
                  <p>
                    {conversation.summaryAvailable
                      ? `${formatWorkspaceInteger(conversation.messageCount)} recorded ${conversation.messageCount === 1 ? "message" : "messages"}${conversation.latestMessageAtISO ? ` · latest ${formatWorkspaceDateTime(conversation.latestMessageAtISO)}` : ""}`
                      : "Conversation details are not available here. Open the conversation to see its current messages."}
                  </p>
                </div>
                <button type="button" className="ambient-client-overview__secondary" onClick={() => reviewConversation(conversation)}>
                  Open conversation
                </button>
              </li>
            ))}
          </ol>
        )}
      </section>

      <aside className="ambient-client-overview__boundary" aria-labelledby="ambient-client-boundary-title">
        <div>
          <p className="ambient-client-overview__label">About this information</p>
          <h2 id="ambient-client-boundary-title">{boundary.sourceLabel || "Client relationship"}</h2>
        </div>
        <div>
          <p>{boundary.sourceBoundary || boundary.outcome || "This view summarizes only the client information and linked quotes available here."}</p>
          {boundary.loadedAtISO && <p>Last checked on this device {formatWorkspaceDateTime(boundary.loadedAtISO)}.</p>}
          {Array.isArray(boundary.messages || boundary.issues) && (boundary.messages || boundary.issues).length > 0 && (
            <ul>{(boundary.messages || boundary.issues).map((message) => <li key={message}>{message}</li>)}</ul>
          )}
        </div>
      </aside>

      {recordSections && (
        <details
          ref={recordRef}
          className="ambient-client-overview__record"
          open={recordOpen}
          onToggle={(event) => setRecordOpen(event.currentTarget.open)}
        >
          <summary>More client history and controls</summary>
          <div className="ambient-client-overview__record-body">{recordSections}</div>
        </details>
      )}
    </section>
  );
}

export function AmbientClientRelationshipHost({
  workspace = null,
  source = "",
  loadedAt = 0,
  stale = false,
  loading = false,
  error = "",
  rebookingRadar = null,
  currentUserRole = "staff",
  tenantTimeZone = "",
  onRefresh,
  onOpenOpportunity,
  onOpenConversation,
  onOpenWorkflow,
  ...viewProps
}) {
  const model = useMemo(() => buildAmbientClientRelationship({
    workspace,
    source,
    loadedAt,
    stale,
    loading,
    error,
    rebookingRadar,
    currentUserRole,
    tenantTimeZone,
    capabilities: {
      openOpportunity: typeof onOpenOpportunity === "function",
      openWorkflow: typeof onOpenWorkflow === "function",
      openConversation: typeof onOpenConversation === "function",
      reviewRebook: true,
      reviewContext: true,
      refresh: typeof onRefresh === "function"
    }
  }), [
    currentUserRole,
    error,
    loadedAt,
    loading,
    onOpenConversation,
    onOpenOpportunity,
    onOpenWorkflow,
    onRefresh,
    rebookingRadar,
    source,
    stale,
    tenantTimeZone,
    workspace
  ]);

  return (
    <AmbientClientRelationship
      {...viewProps}
      model={model}
      workspace={workspace}
      currentUserRole={currentUserRole}
      onRefresh={onRefresh}
      onOpenOpportunity={onOpenOpportunity}
      onOpenConversation={onOpenConversation}
      onOpenWorkflow={onOpenWorkflow}
    />
  );
}

export default AmbientClientsDirectory;
