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
  ArrowRight,
  CalendarBlank,
  ChatCircleDots,
  EnvelopeSimple,
  FileText,
  Info,
  NotePencil,
  User
} from "./ProductIcons";
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

function settleAsyncCallback(response, onResolved, onRejected) {
  if (!response || typeof response.then !== "function") return false;
  Promise.resolve(response).then(onResolved).catch(onRejected);
  return true;
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
    sourceLabel: "Client list is catching up",
    sourceBoundary: "We’re waiting for the client source to confirm this list.",
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

function calendarDateKey(value = new Date()) {
  if (typeof value === "string" && /^\d{4}-\d{2}-\d{2}$/u.test(value)) return value;
  const parsed = value instanceof Date ? value : new Date(value);
  if (Number.isNaN(parsed.getTime())) return "";
  const year = parsed.getFullYear();
  const month = String(parsed.getMonth() + 1).padStart(2, "0");
  const day = String(parsed.getDate()).padStart(2, "0");
  return `${year}-${month}-${day}`;
}

function selectFeaturedClient(rows = [], declaredCustomerId = "") {
  const exactCustomerId = text(declaredCustomerId);
  if (exactCustomerId) {
    const declared = rows.find((row) => (
      text(row.customerId || row.clientId || row.id) === exactCustomerId
    ));
    if (declared) return { row: declared, source: "caller-declared" };
  }

  const today = calendarDateKey();
  const dated = rows
    .map((row, index) => ({
      row,
      index,
      date: calendarDateKey(clientLatest(row).eventDate)
    }))
    .filter(({ date }) => Boolean(date));
  if (!dated.length) return { row: null, source: "none" };

  dated.sort((left, right) => {
    const leftUpcoming = left.date >= today;
    const rightUpcoming = right.date >= today;
    if (leftUpcoming !== rightUpcoming) return leftUpcoming ? -1 : 1;
    if (left.date !== right.date) {
      return leftUpcoming
        ? left.date.localeCompare(right.date)
        : right.date.localeCompare(left.date);
    }
    return left.index - right.index;
  });
  return { row: dated[0].row, source: "recorded-event-date" };
}

function clientDirectoryState(row = {}) {
  const identity = clientIdentity(row);
  const latest = clientLatest(row);
  if (!identity.email || !identity.phone) {
    return { key: "contact_gap", label: "Contact details to add", tone: "warning" };
  }
  if (calendarDateKey(latest.eventDate) >= calendarDateKey()) {
    return { key: "upcoming", label: "Upcoming event on file", tone: "good" };
  }
  if (latest.quoteNumber || latest.eventName) {
    return { key: "linked", label: "Recorded work on file", tone: "neutral" };
  }
  return { key: "unlinked", label: "No linked work in this view", tone: "neutral" };
}

function clientRecordedContactDetails(row = {}) {
  const identity = clientIdentity(row);
  const details = [identity.company, identity.email, identity.phone].filter(Boolean);
  return details.length
    ? details.join(" · ")
    : "No recorded contact details are shown on this page yet.";
}

function clientEventSummary(row = {}) {
  const latest = clientLatest(row);
  return {
    title: latest.eventName || latest.quoteNumber || "No linked opportunity in this view",
    reference: latest.eventName ? latest.quoteNumber : "",
    date: latest.eventDate ? formatWorkspaceDate(latest.eventDate) : "No event date shown"
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
  directoryFilter: controlledDirectoryFilter,
  onDirectoryFilterChange,
  aboutOpen: controlledAboutOpen,
  onAboutOpenChange,
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
  const [internalDirectoryFilter, setInternalDirectoryFilter] = useState("all");
  const [internalAboutOpen, setInternalAboutOpen] = useState(false);
  const directoryFilter = controlledDirectoryFilter ?? internalDirectoryFilter;
  const aboutOpen = controlledAboutOpen ?? internalAboutOpen;
  const changeDirectoryFilter = (value) => {
    setInternalDirectoryFilter(value);
    onDirectoryFilterChange?.(value);
  };
  const rows = directoryRows(model);
  const boundary = directoryBoundary(model);
  const state = text(model.state) || (rows.length ? "success" : "empty");
  const visibleRows = rows.filter((row) => {
    if (directoryFilter === "all") return true;
    const rowState = clientDirectoryState(row);
    const latest = clientLatest(row);
    if (directoryFilter === "linked") return Boolean(latest.quoteNumber || latest.eventName);
    if (directoryFilter === "upcoming") return calendarDateKey(latest.eventDate) >= calendarDateKey();
    return directoryFilter === rowState.key;
  });
  const featuredSelection = selectFeaturedClient(
    visibleRows,
    model.featuredCustomerId || model.featuredClientId
  );
  const featuredRow = featuredSelection.row;
  // This is a presentation choice over the already tenant-scoped page, not a
  // relationship-quality or attention inference. An explicit caller selection
  // wins; otherwise the nearest recorded upcoming event (or latest recorded
  // past event) leads. Undated rows remain peers in the directory.
  const remainingRows = featuredRow
    ? visibleRows.filter((row) => row !== featuredRow)
    : visibleRows;

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
    const recover = (reason = "The exact client overview could not be opened.") => {
      const visibleReason = text(reason) || "The exact client overview could not be opened.";
      announce(actionResult(action, "recovery", {
        reason: visibleReason,
        consequence: "The current client list remains visible and no record changed.",
        nextResolution: "Review the current row, then try again."
      }), `${visibleReason} The current client list remains visible and no record changed. Try again from this row.`);
    };
    const settle = (response, resolvedAsync = false) => {
      if (response?.status === "recovery") {
        recover(response.reason);
      } else if (response?.status === "resolved" || (resolvedAsync && response?.status !== "pending")) {
        announce(actionResult(action, "context"), "The exact client overview is ready to review.");
      }
    };
    try {
      const response = onOpenClient?.({
        customerId: text(row.customerId || row.clientId || row.id),
        actionId: action.id,
        object: action.arrivalContract.object,
        reason: action.arrivalContract.reason,
        consequence: action.arrivalContract.consequence,
        nextResolutionId: action.arrivalContract.nextResolutionIds[0]
      });
      if (!settleAsyncCallback(
        response,
        (result) => settle(result, true),
        (error) => recover(error instanceof Error ? error.message : "The exact client overview could not be opened.")
      )) {
        settle(response);
      }
    } catch (error) {
      recover(error instanceof Error ? error.message : "The exact client overview could not be opened.");
    }
  };

  const refresh = () => {
    if (!refreshAction.enabled) return;
    announce(actionResult(refreshAction, "pending", {
      nextResolution: "Review the client list when the refresh finishes."
    }), "Refreshing clients. The current page stays visible while newer information loads.");
    const recover = (error) => {
      const reason = error instanceof Error && text(error.message)
        ? text(error.message)
        : "The client list could not be refreshed.";
      announce(actionResult(refreshAction, "recovery", {
        reason,
        consequence: "The current client page remains visible and no record changed.",
        nextResolution: "Check the current connection, then try this refresh again."
      }), `${reason} The current page is unchanged; try this refresh again.`);
    };
    try {
      const response = onRefresh?.();
      settleAsyncCallback(response, (result) => {
        if (result?.status === "recovery") {
          recover(new Error(result.reason || "The client list could not be refreshed."));
          return;
        }
        if (result?.status !== "pending") {
          announce(actionResult(refreshAction, "context"), "The client refresh finished. Review this page for the latest available information.");
        }
      }, recover);
    } catch (error) {
      recover(error);
    }
  };

  const start = () => {
    if (!startAction.enabled) return;
    announce(actionResult(startAction, "pending", {
      nextResolution: "Add the client and event details needed for a priced draft."
    }), "Opening a new editable opportunity. Nothing has been sent.");
    const recover = (error) => {
      const reason = error instanceof Error && text(error.message)
        ? text(error.message)
        : "A new opportunity could not be opened.";
      announce(actionResult(startAction, "recovery", {
        reason,
        consequence: "The Clients view remains visible and no draft was created here.",
        nextResolution: "Review the current client context, then try again."
      }), `${reason} The Clients view is unchanged; try again when you are ready.`);
    };
    try {
      const response = onStartOpportunity?.({
        actionId: startAction.id,
        object: startAction.arrivalContract.object,
        reason: startAction.arrivalContract.reason,
        consequence: startAction.arrivalContract.consequence,
        nextResolutionId: startAction.arrivalContract.nextResolutionIds[0]
      });
      settleAsyncCallback(response, (result) => {
        if (result?.status === "recovery") {
          recover(new Error(result.reason || "A new opportunity could not be opened."));
        } else if (result?.status !== "pending") {
          announce(actionResult(startAction, "context"), "The new opportunity is ready for client and event details.");
        }
      }, recover);
    } catch (error) {
      recover(error);
    }
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
        <nav className="ambient-clients__breadcrumb" aria-label="Breadcrumb">
          <span>Clients</span><span aria-hidden="true">/</span><strong>Relationships</strong>
        </nav>
        {rows.length === 0 && state !== "empty" && (
          <h1 ref={headingRef} id="ambient-clients-title" className="sr-only workspace-route-heading" tabIndex={-1}>Clients</h1>
        )}

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

        {(model.error || boundary.error) && rows.length > 0 && (
          <p className="error-note" role="alert">{model.error || boundary.error}</p>
        )}

        {state === "loading" && rows.length === 0 && (
          <section className="ambient-clients__state" role="status">
            <p className="ambient-clients__label">Your relationships</p>
            <h2>Gathering your clients</h2>
            <p>Your client list will be here in a moment.</p>
          </section>
        )}

        {["error", "stale", "bounded", "incomplete"].includes(state) && rows.length === 0 && (
          <section className="ambient-clients__state">
            <p className="ambient-clients__label">Your relationships</p>
            <h2>We’re still catching up</h2>
            <p>QuotePilot can’t confirm whether this list is complete yet. Freshen the list to try again; nothing shown will be changed.</p>
          </section>
        )}

        {state === "empty" && (
          <>
            <section className="ambient-clients__empty" aria-labelledby="ambient-clients-title">
              <div className="ambient-clients__empty-copy">
                <p className="ambient-clients__label">Client relationships</p>
                <h1 ref={headingRef} id="ambient-clients-title" className="workspace-route-heading" tabIndex={-1}>
                  Your first client story starts here
                </h1>
                <p>Start with the event. QuotePilot will build the relationship record as the work takes shape.</p>
              </div>
              <img
                className="ambient-clients__hospitality-image"
                src="/images/quote-workspace-wedding-table-v1.webp"
                alt=""
              />
              <div className="ambient-clients__empty-action">
                <button
                  type="button"
                  className="ambient-clients__start"
                  data-ambient-action-id={startAction.id}
                  disabled={!startAction.enabled}
                  onClick={start}
                >
                  {startAction.outcomeLabel}<span aria-hidden="true">→</span>
                </button>
                <a href="#ambient-clients-how">How clients work</a>
              </div>
            </section>
            <section id="ambient-clients-how" className="ambient-clients__steps" aria-label="How client relationships work">
              <article><span aria-hidden="true">01</span><div><h2>Start an opportunity</h2><p>Begin with the client and the work ahead.</p></div></article>
              <article><span aria-hidden="true">02</span><div><h2>Add the event details</h2><p>Capture the date, place, service, and vision.</p></div></article>
              <article><span aria-hidden="true">03</span><div><h2>Keep client details together</h2><p>Carry recorded contact details and event history forward.</p></div></article>
            </section>
          </>
        )}

        {rows.length > 0 && (
          <section className="ambient-clients__populated" aria-labelledby="ambient-clients-title">
            <header className="ambient-clients__populated-hero">
              <div>
                <p className="ambient-clients__label">Client relationships</p>
                <h1 ref={headingRef} id="ambient-clients-title" className="workspace-route-heading" tabIndex={-1}>Clients</h1>
                <p>Every opportunity, proposal, request, and event stays connected to the relationship it belongs to.</p>
              </div>
            </header>

            {featuredRow && (() => {
              const customerId = text(featuredRow.customerId || featuredRow.clientId || featuredRow.id);
              const identity = clientIdentity(featuredRow);
              const event = clientEventSummary(featuredRow);
              const relationshipState = clientDirectoryState(featuredRow);
              const action = featuredRow.primaryAction || fallbackReviewClientAction(featuredRow, currentUserRole);
              return (
                <article
                  className="ambient-clients__featured"
                  data-client-id={customerId}
                  data-featured-source={featuredSelection.source}
                >
                  <p className="ambient-clients__featured-label">Relationship in context</p>
                  <div
                    className="ambient-clients__featured-heading"
                    data-client-summary-part="identity"
                  >
                    <div className="ambient-clients__featured-identity">
                      <h2>{identity.name}</h2>
                      <p className="ambient-clients__featured-mobile-event">{event.title}<span aria-hidden="true"> · </span>{event.date}</p>
                    </div>
                  </div>
                  <dl className="ambient-clients__featured-details">
                    <div className="ambient-clients__featured-event">
                      <dt>Recorded event</dt>
                      <dd>{event.title}<span>{event.date}{event.reference ? ` · ${event.reference}` : ""}</span></dd>
                    </div>
                    <div
                      className="ambient-clients__featured-contact"
                      data-client-summary-part="contact"
                    >
                      <dt>Recorded contact details</dt>
                      <dd>{clientRecordedContactDetails(featuredRow)}</dd>
                    </div>
                    <div
                      className="ambient-clients__featured-status"
                      data-client-summary-part="status"
                    >
                      <dt>Current status</dt>
                      <dd>{relationshipState.label}<span>Based on the recorded event and contact details in this view.</span></dd>
                    </div>
                  </dl>
                  <button
                    type="button"
                    className="ambient-client__primary"
                    data-ambient-action-id={action.id}
                    data-client-summary-part="action"
                    disabled={!action.enabled}
                    title={action.disabledReason || undefined}
                    onClick={() => reviewClient(featuredRow)}
                  >
                    {action.outcomeLabel}<span aria-hidden="true">→</span>
                  </button>
                </article>
              );
            })()}

            <section className="ambient-clients__directory" aria-labelledby="ambient-clients-list-title">
              <div className="ambient-clients__directory-heading">
                <h2 id="ambient-clients-list-title">All clients</h2>
              </div>
              <div className="ambient-clients__directory-controls">
                <form className="ambient-clients__toolbar" role="search" onSubmit={onApplySearch}>
                  <label className="ambient-clients__search">
                    <span className="visually-hidden">Find a client by name or email</span>
                    <input
                      type="search"
                      value={searchDraft}
                      autoComplete="off"
                      placeholder="Search clients"
                      onChange={(event) => onSearchDraftChange?.(event.target.value)}
                    />
                  </label>
                  <button type="submit" className="ghost">Search</button>
                  {searchDraft ? <button type="button" className="ghost" onClick={onClear}>Clear</button> : null}
                </form>
                <p className="source-note" data-client-search-boundary>
                  Search stays in this browser tab and clears after a reload.
                </p>
                {(rows.length > 1 || directoryFilter !== "all") && (
                  <label className="ambient-clients__filter-select">
                    <span className="visually-hidden">Filter clients</span>
                    <select
                      data-view-filter="client-relationship"
                      value={directoryFilter}
                      onChange={(event) => changeDirectoryFilter(event.target.value)}
                    >
                      <option value="all">All clients</option>
                      <option value="linked">With linked work</option>
                      <option value="upcoming">Upcoming events</option>
                      <option value="contact_gap">Contact to add</option>
                    </select>
                  </label>
                )}
              </div>

              {remainingRows.length ? (
                <ol className="ambient-clients__relationship-list">
                  {remainingRows.map((row) => {
                    const customerId = text(row.customerId || row.clientId || row.id);
                    const identity = clientIdentity(row);
                    const event = clientEventSummary(row);
                    const relationshipState = clientDirectoryState(row);
                    const action = row.primaryAction || fallbackReviewClientAction(row, currentUserRole);
                    return (
                      <li key={customerId}>
                        <article className="ambient-clients__relationship-row" data-client-id={customerId}>
                          <div><h3>{identity.name}</h3>{identity.company && <p>{identity.company}</p>}</div>
                          <div><strong>{event.title}</strong><span>{event.date}{event.reference ? ` · ${event.reference}` : ""}</span></div>
                          <p>{clientRecordedContactDetails(row)}</p>
                          <span className="ambient-clients__relationship-state" data-tone={relationshipState.tone}>{relationshipState.label}</span>
                          <button
                            type="button"
                            className="ambient-client__primary"
                            data-ambient-action-id={action.id}
                            disabled={!action.enabled}
                            title={action.disabledReason || undefined}
                            onClick={() => reviewClient(row)}
                          >
                            {action.outcomeLabel}<span aria-hidden="true">→</span>
                          </button>
                        </article>
                      </li>
                    );
                  })}
                </ol>
              ) : !visibleRows.length ? (
                <div className="ambient-clients__filter-empty">
                  <strong>No clients match this view yet.</strong>
                  <span>Try another view—your current client page is unchanged.</span>
                  <button type="button" className="ghost" onClick={() => changeDirectoryFilter("all")}>Show all clients</button>
                </div>
              ) : null}
            </section>
          </section>
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

        <details
          className="ambient-clients__about"
          data-client-disclosure="about"
          open={aboutOpen}
          onToggle={(event) => {
            setInternalAboutOpen(event.currentTarget.open);
            onAboutOpenChange?.(event.currentTarget.open);
          }}
        >
          <summary>About this view</summary>
          <div>
            <h2 id="ambient-clients-boundary-title">{boundary.sourceLabel || "Client records"}</h2>
            <p>{boundary.sourceBoundary || boundary.outcome || "Only the client information available on this page is shown."}</p>
            {boundary.loadedAtISO && <p>Last checked on this device {formatWorkspaceDateTime(boundary.loadedAtISO)}.</p>}
            {Array.isArray(boundary.messages || boundary.notes) && (boundary.messages || boundary.notes).length > 0 && (
              <ul>{(boundary.messages || boundary.notes).map((message) => <li key={message}>{message}</li>)}</ul>
            )}
            {rows.length > 0 && (
              <button
                type="button"
                className="ambient-clients__refresh"
                data-ambient-action-id={refreshAction.id}
                disabled={!refreshAction.enabled}
                onClick={refresh}
              >
                {model.loading ? "Checking…" : "Check this view again"}
              </button>
            )}
          </div>
        </details>
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

function relationshipQuote(workspace, quoteId) {
  return (Array.isArray(workspace?.quotes) ? workspace.quotes : [])
    .find((quote) => text(quote?.id || quote?.quoteId) === text(quoteId)) || null;
}

function relationshipRequest(workspace, quoteId) {
  const quote = relationshipQuote(workspace, quoteId);
  const decision = quote?.portalDecision || {};
  if (text(decision.decision).toLowerCase() !== "changes_requested") return null;
  return {
    message: text(decision.message),
    submittedAtISO: text(decision.submittedAtISO),
    requestId: text(decision.requestId)
  };
}

function relationshipHistory(workspace) {
  const activity = Array.isArray(workspace?.recentActivity) ? workspace.recentActivity : [];
  const requested = new Set(activity
    .filter((entry) => entry?.label === "Customer requested changes")
    .map((entry) => `${text(entry.quoteId)}:${text(entry.atISO)}`));

  return activity
    .filter((entry) => !(
      entry?.label === "Customer sent a conversation message"
      && requested.has(`${text(entry.quoteId)}:${text(entry.atISO)}`)
    ))
    .slice(0, 5)
    .map((entry) => {
      const quote = relationshipQuote(workspace, entry.quoteId);
      const request = entry.label === "Customer requested changes"
        ? relationshipRequest(workspace, entry.quoteId)
        : null;
      return {
        ...entry,
        detail: request?.message
          || (entry.label === "Proposal sent" ? "Proposal status recorded as sent."
            : entry.label === "Quote drafted" ? "Opportunity created."
              : text(quote?.event?.name || quote?.quoteNumber)),
        meta: entry.label === "Customer requested changes"
          ? "Needs review"
          : text(entry.quoteNumber)
      };
    });
}

function relationshipStageModel(workspace, opportunity, client = {}) {
  const quoteId = text(opportunity?.quoteId || opportunity?.id);
  const quote = relationshipQuote(workspace, quoteId) || opportunity || {};
  const status = text(quote.status).toLowerCase();
  const versionNumber = Number(quote.latestVersionNumber);
  const sentAtISO = text(quote.lifecycle?.sentAtISO || quote.sentAtISO);
  const eventDate = text(quote.event?.date || opportunity?.eventDate);
  const proposalStatus = ["sent", "viewed", "accepted", "booked"].includes(status)
    ? `Version ${Number.isFinite(versionNumber) && versionNumber > 0 ? versionNumber : "current"} ${status === "sent" ? "sent" : status}`
    : `Version ${Number.isFinite(versionNumber) && versionNumber > 0 ? versionNumber : "current"}`;
  const eventStatus = status === "booked"
    ? "Booked"
    : status === "accepted"
      ? "Accepted"
      : "Not accepted or booked";
  return [
    {
      key: "client",
      label: "Client",
      title: text(workspace?.customer?.name || workspace?.customer?.email || client.name || client.email) || "Unnamed client",
      detail: text(workspace?.customer?.company || workspace?.customer?.organization || client.company),
      Icon: User
    },
    {
      key: "opportunity",
      label: "Opportunity",
      title: text(quote.event?.name || opportunity?.eventName || quote.quoteNumber) || "Untitled opportunity",
      detail: text(quote.quoteNumber || opportunity?.quoteNumber),
      Icon: FileText
    },
    {
      key: "proposal",
      label: "Proposal",
      title: proposalStatus,
      detail: sentAtISO ? formatWorkspaceDate(sentAtISO) : "No sent date recorded",
      Icon: EnvelopeSimple
    },
    {
      key: "event",
      label: "Event",
      title: eventStatus,
      detail: eventDate ? formatWorkspaceDate(eventDate) : "No event date recorded",
      Icon: CalendarBlank
    }
  ];
}

function historyIcon(label) {
  if (label === "Customer requested changes") return ChatCircleDots;
  if (label === "Proposal sent") return EnvelopeSimple;
  return FileText;
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
  const primaryDestination = text(primaryTarget.destination || primaryTarget.kind);
  const primaryOpportunityId = ["opportunity", "living-opportunity"].includes(primaryDestination)
    ? text(primaryTarget.quoteId || primaryAction?.executionTarget?.targetId)
    : "";
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
    const recover = (error) => {
      const reason = error instanceof Error && text(error.message)
        ? text(error.message)
        : "This client could not be refreshed.";
      announce(actionResult(refreshAction, "recovery", {
        reason,
        consequence: "The current client overview remains visible and no record changed.",
        nextResolution: "Check the current connection, then try this refresh again."
      }), `${reason} The current client overview is unchanged; try this refresh again.`);
    };
    try {
      const response = onRefresh?.();
      settleAsyncCallback(response, (result) => {
        if (result?.status === "recovery") {
          recover(new Error(result.reason || "This client could not be refreshed."));
        } else if (result?.status !== "pending") {
          announce(actionResult(refreshAction, "context"), "The client refresh finished. Review this overview for the latest available information.");
        }
      }, recover);
    } catch (error) {
      recover(error);
    }
  };

  const resolveAction = (action, target = {}) => {
    if (!action?.enabled) return;
    announce(actionResult(action, "pending"), `Opening ${action.outcomeLabel.toLowerCase()} with this client’s context attached.`);
    const recover = (reason = "The exact destination could not be opened.") => {
      const visibleReason = text(reason) || "The exact destination could not be opened.";
      announce(actionResult(action, "recovery", {
        reason: visibleReason,
        consequence: "The client overview remains visible and no record changed.",
        nextResolution: "Review the current context, then try again."
      }), `${visibleReason} The client overview remains visible and no record changed. Try again from this context.`);
    };
    const settle = (response, resolvedAsync = false) => {
      if (response?.status === "recovery") {
        recover(response.reason);
      } else if (response?.status === "resolved" || (resolvedAsync && response?.status !== "pending")) {
        announce(actionResult(action, "context"), "The requested client context is ready to review.");
      }
    };
    try {
      let response = null;
      const destination = text(target.destination || target.kind || action.executionTarget?.surfaceId);
      if (["workflow", "approval"].includes(destination)) {
        response = onOpenWorkflow?.({ ...target, actionId: action.id });
      } else if (["conversation", "messages"].includes(destination)) {
        response = onOpenConversation?.(
          text(target.quoteId || action.executionTarget?.targetId),
          {
            arrivalContext: {
              object: action.arrivalContract.object,
              target,
              actionId: action.id
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
          returnFocusControlId: text(target.returnFocusControlId),
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
      if (!settleAsyncCallback(
        response,
        (result) => settle(result, true),
        (error) => recover(error instanceof Error ? error.message : "The exact destination could not be opened.")
      )) {
        settle(response);
      }
    } catch (error) {
      recover(error instanceof Error ? error.message : "The exact destination could not be opened.");
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
    resolveAction(action, {
      destination: "opportunity",
      quoteId,
      returnFocusControlId: "client-opportunity-row"
    });
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

  const focusedOpportunity = opportunities.find((opportunity) => (
    text(opportunity.quoteId || opportunity.id) === primaryOpportunityId
  )) || opportunities[0] || null;
  const focusedQuoteId = text(focusedOpportunity?.quoteId || focusedOpportunity?.id || primaryOpportunityId);
  const focusedQuote = relationshipQuote(workspace, focusedQuoteId) || focusedOpportunity || {};
  const focusedStatus = classifyQuoteStatus(focusedQuote.status);
  const request = relationshipRequest(workspace, focusedQuoteId);
  const stages = relationshipStageModel(workspace, focusedOpportunity, client);
  const history = relationshipHistory(workspace);
  const hasActionableRequest = Boolean(
    request?.message
    && primaryAction?.enabled
    && text(primaryTarget.attentionType).toLowerCase() === "change_request"
  );

  return (
    <section
      className="ambient-client-overview ambient-purpose-surface"
      data-surface-contract-id={model.surfaceContract?.id || "ambient-client-relationship"}
      data-surface-purpose={(model.surfaceContract?.purposes || ["clarify", "advance", "resolve", "reveal_context"]).join(" ")}
      data-surface-density="editorial"
      data-client-id={customerId}
      data-client-overview-state={model.state || "success"}
      data-client-relationship-layout="ledger"
    >
      <nav className="ambient-client-overview__breadcrumb" aria-label="Breadcrumb">
        <button type="button" className="workspace-text-link ambient-client-overview__back" onClick={onBack}>Clients</button>
        <span aria-hidden="true">/</span>
        <strong>{formatWorkspaceText(client.name || client.email, { emptyLabel: "Unnamed client" })}</strong>
      </nav>

      <header className="ambient-client-overview__identity">
        <div>
          <h1 ref={rootHeadingRef} id="ambient-client-overview-title" className="workspace-route-heading" tabIndex={-1}>
            {formatWorkspaceText(client.name || client.email, { emptyLabel: "Unnamed client" })}
          </h1>
          <p className="ambient-client-overview__identity-contact">
            {[client.company, client.email, client.phone].map(text).filter(Boolean).map((item) => <span key={item}>{item}</span>)}
            {![client.company, client.email, client.phone].some(text) && <span>No contact details recorded</span>}
          </p>
        </div>
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

      <section className="ambient-client-overview__relationship" aria-label="Current client relationship">
        <article className="ambient-client-overview__decision" data-next-state={caughtUp ? "caught-up" : "action"}>
          <p className="ambient-client-overview__label">{hasActionableRequest ? "Needs review" : "Next relationship step"}</p>
          <h2>{hasActionableRequest
            ? `“${request.message}”`
            : caughtUp
              ? "No tracked follow-up is due"
              : primaryAction?.outcomeLabel || model.nextAction?.label || "Review this client"}</h2>
          <div className="ambient-client-overview__evidence">
            <p><Info size={18} aria-hidden="true" />{hasActionableRequest
              ? "No resolution is recorded for this customer request."
              : caughtUp
                ? model.caughtUp?.reason || "No follow-up in the current client view needs attention."
                : primaryAction?.arrivalContract?.reason || "Review the available client context and choose the next step."}</p>
            {!caughtUp && <p><NotePencil size={18} aria-hidden="true" />Nothing changes until this next step is reviewed.</p>}
          </div>
          {!caughtUp && primaryAction?.enabled && (
            <button
              type="button"
              className="ambient-client-overview__primary"
              data-ambient-action-id={primaryAction.id}
              data-opportunity-id={primaryOpportunityId || undefined}
              data-return-focus-control={primaryOpportunityId ? "client-next-action" : undefined}
              data-workspace-task-id={primaryAction.id}
              onClick={() => resolveAction(primaryAction, primaryOpportunityId
                ? { ...primaryTarget, returnFocusControlId: "client-next-action" }
                : primaryTarget)}
            >
              {primaryAction.outcomeLabel}<ArrowRight size={18} aria-hidden="true" />
            </button>
          )}
        </article>

        <div className="ambient-client-overview__relationship-main">
          <section className="ambient-client-overview__spine" aria-labelledby="ambient-client-relationship-title" data-client-relationship-spine>
            <p className="ambient-client-overview__label">Relationship overview</p>
            <h2 id="ambient-client-relationship-title" className="visually-hidden">Relationship overview</h2>
            <ol>
              {stages.map(({ key, label, title, detail, Icon }, index) => (
                <li key={key} data-relationship-stage={key}>
                  <span className="ambient-client-overview__stage-icon"><Icon size={22} aria-hidden="true" /></span>
                  <span className="ambient-client-overview__stage-label">{label}</span>
                  <strong>{title}</strong>
                  {detail && <span>{detail}</span>}
                  {index < stages.length - 1 && <ArrowRight className="ambient-client-overview__stage-arrow" size={18} aria-hidden="true" />}
                </li>
              ))}
            </ol>
          </section>

          <section className="ambient-client-overview__opportunity" aria-labelledby="ambient-client-opportunities-title">
            <p className="ambient-client-overview__label">Active opportunity</p>
            <h2 id="ambient-client-opportunities-title">{focusedOpportunity
              ? formatWorkspaceText(focusedOpportunity.eventName || focusedOpportunity.event?.name || focusedOpportunity.quoteNumber, { emptyLabel: "Untitled opportunity" })
              : "No active opportunity"}</h2>
            {focusedOpportunity ? (
              <div className="ambient-client-overview__opportunity-row" data-opportunity-id={focusedQuoteId}>
                <p>
                  {formatWorkspaceText(focusedOpportunity.quoteNumber, { emptyLabel: "Quote number pending" })}
                  {text(focusedOpportunity.eventDate || focusedOpportunity.event?.date) ? ` · ${formatWorkspaceDate(focusedOpportunity.eventDate || focusedOpportunity.event?.date)}` : ""}
                  {text(focusedQuote.event?.guests) ? ` · ${formatWorkspaceInteger(focusedQuote.event.guests)} guests` : ""}
                  {text(focusedQuote.event?.venue) ? ` · ${focusedQuote.event.venue}` : ""}
                </p>
                <StatusChip family={focusedStatus.family} label={focusedStatus.label} />
                <button
                  type="button"
                  className="ambient-client-overview__secondary"
                  data-ambient-action-id={`review-client-opportunity:${focusedQuoteId}`}
                  data-return-focus-control="client-opportunity-row"
                  onClick={() => reviewOpportunity(focusedOpportunity)}
                >
                  Open opportunity<ArrowRight size={16} aria-hidden="true" />
                </button>
              </div>
            ) : <p className="source-note">No active opportunity appears in the current client information.</p>}
            {opportunities.length > 1 && (
              <details className="ambient-client-overview__more-opportunities">
                <summary>{formatWorkspaceInteger(opportunities.length)} active opportunities</summary>
                <ol className="ambient-client-overview__opportunities">
                  {opportunities.slice(1).map((opportunity) => (
                    <li key={text(opportunity.quoteId || opportunity.id)}>
                      <span>{formatWorkspaceText(opportunity.eventName || opportunity.quoteNumber, { emptyLabel: "Untitled opportunity" })}</span>
                      <button type="button" className="ambient-client-overview__secondary" onClick={() => reviewOpportunity(opportunity)}>Open opportunity</button>
                    </li>
                  ))}
                </ol>
              </details>
            )}
          </section>
        </div>
      </section>

      <section className="ambient-client-overview__history" aria-labelledby="ambient-client-history-title" data-client-history-ledger>
        <p className="ambient-client-overview__label">Recent relationship history</p>
        <h2 id="ambient-client-history-title" className="visually-hidden">Recent relationship history</h2>
        {history.length ? (
          <ol>
            {history.map((entry) => {
              const HistoryIcon = historyIcon(entry.label);
              return (
                <li key={`${entry.quoteId}:${entry.label}:${entry.atISO}`}>
                  <span className="ambient-client-overview__history-icon"><HistoryIcon size={21} aria-hidden="true" /></span>
                  <time dateTime={entry.atISO}>{formatWorkspaceDateTime(entry.atISO)}</time>
                  <div><strong>{entry.label}</strong>{entry.detail && <span>{entry.detail}</span>}</div>
                  <span className="ambient-client-overview__history-meta">{entry.meta}</span>
                </li>
              );
            })}
          </ol>
        ) : <p className="source-note">No recent relationship activity appears in the current client information.</p>}
      </section>

      <div className="ambient-client-overview__footer">
      <details className="ambient-client-overview__conversation-disclosure" data-client-disclosure="conversations">
        <summary><ChatCircleDots size={20} aria-hidden="true" />Conversations<span>{conversations.length ? `${formatWorkspaceInteger(conversations.length)} linked` : "None shown"}</span></summary>
        <section className="ambient-client-overview__section" aria-labelledby="ambient-client-conversations-title">
          <div className="ambient-client-overview__section-head">
            <h2 id="ambient-client-conversations-title">Quote conversations</h2>
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
      </details>

      <details className="ambient-client-overview__about" data-client-disclosure="about">
        <summary><Info size={20} aria-hidden="true" />About this view</summary>
        <aside className="ambient-client-overview__boundary" aria-labelledby="ambient-client-boundary-title">
          <div>
            <p className="ambient-client-overview__label">Source and scope</p>
            <h2 id="ambient-client-boundary-title">{boundary.sourceLabel || "Client relationship"}</h2>
          </div>
          <div>
            <p>{boundary.sourceBoundary || boundary.outcome || "This view summarizes only the client information and linked quotes available here."}</p>
            {boundary.loadedAtISO && <p>Last checked on this device {formatWorkspaceDateTime(boundary.loadedAtISO)}.</p>}
            {Array.isArray(boundary.messages || boundary.issues) && (boundary.messages || boundary.issues).length > 0 && (
              <ul>{(boundary.messages || boundary.issues).map((message) => <li key={message}>{message}</li>)}</ul>
            )}
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
          </div>
        </aside>
      </details>

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
      </div>
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
