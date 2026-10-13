import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
  ArrowLeft,
  ArrowSquareOut,
  Broadcast,
  CalendarBlank,
  ChatCircleDots,
  MagnifyingGlass,
  User
} from "./ProductIcons";
import { useConversationInbox } from "../hooks/useConversationInbox";
import { useWorkspaceRouteHeadingFocus } from "../hooks/useWorkspaceRouteHeadingFocus";
import { filterConversationThreads, groupConversationThreads } from "../lib/conversationInbox";
import {
  messagingNow,
  recordMessagingPerformanceMilestone
} from "../lib/messagingPerformance";
import {
  formatWorkspaceDate,
  formatWorkspaceDateTime,
  formatWorkspaceMoney,
  formatWorkspaceText
} from "../lib/workspacePresentation";
import QuoteConversationPanel from "quotepilot-active-conversation-panel";

function titleCase(value) {
  return String(value || "")
    .replace(/[_-]+/g, " ")
    .replace(/\b\w/g, (letter) => letter.toUpperCase());
}

export function resolveMessagingStationState({
  inboxStatus = "idle",
  inboxStale = false,
  inboxError = "",
  threads = []
} = {}) {
  if (inboxStatus === "recovering") return "recovery";
  if (inboxStatus === "connecting" && threads.length === 0) return "loading";
  if (inboxStatus === "error" && threads.length === 0) return "error";
  if (threads.length === 0) return "empty";
  if (inboxError || inboxStatus === "error") return "partial";
  if (inboxStale || ["idle", "connecting", "stale"].includes(inboxStatus)) return "stale";
  return "success";
}

export function buildMessagingSyncPresentation(inbox = {}) {
  if (inbox.status === "recovering") return { label: "Reconnecting", tone: "connecting" };
  if (inbox.status === "connecting") return { label: "Catching up", tone: "connecting" };
  if (inbox.error || inbox.status === "error") return { label: "Updates paused", tone: "paused" };
  if (inbox.stale || inbox.status === "stale") return { label: "May be stale", tone: "stale" };
  if (inbox.source === "firebase-live") return { label: "Live updates", tone: "live" };
  if (inbox.source === "firebase-cache") return { label: "Cached", tone: "stale" };
  return { label: "Connecting", tone: "connecting" };
}

export function MessagingStationCapabilitySurface({ state, className = "", children, ...props }) {
  return (
    <main className={className} data-capability-state={state} {...props}>
      {children}
    </main>
  );
}

export function resolveMessagingArrivalConsumption({
  active = false,
  quoteId = "",
  inboxStatus = "idle",
  inboxStale = false,
  inboxError = "",
  inboxBounded = false,
  threads = [],
  selectedQuoteId = ""
} = {}) {
  if (!active) return null;
  if (["idle", "connecting", "recovering"].includes(inboxStatus)) {
    return { status: "pending" };
  }
  if (inboxStatus === "error" && threads.length === 0) {
    return {
      status: "recovery",
      reason: "The exact conversation could not be verified because the current bounded inbox failed to load.",
      consequence: "No other conversation was selected and no message was sent or marked read.",
      nextResolution: "Reconnect Messages, then reopen the exact conversation from its opportunity."
    };
  }
  if (inboxStale || inboxError || inboxStatus === "stale") {
    return {
      status: "recovery",
      reason: "The requested conversation appears only in retained or interrupted inbox evidence, so its current exact state cannot be verified.",
      consequence: "No other message was substituted; no retained conversation was treated as current, and no message was sent or marked read.",
      nextResolution: "Reconnect Messages and retry the exact conversation after the inbox is current."
    };
  }
  const exactThread = threads.find((thread) => thread.quoteId === quoteId) || null;
  if (!exactThread) {
    return {
      status: "recovery",
      reason: inboxBounded
        ? "The requested conversation is not present in the 50 most recently active conversations; it may be outside this bounded inbox or no longer available."
        : "The requested conversation is no longer available in the current workspace evidence.",
      consequence: "No first-listed or similar conversation was substituted; no message was sent or marked read.",
      nextResolution: "Return to the originating opportunity and review its current proposal-delivery or conversation state."
    };
  }
  if (!exactThread.conversationAvailable) {
    return {
      status: "recovery",
      reason: exactThread.unavailableReason || "The requested conversation is not available for the current proposal delivery.",
      consequence: "The opportunity remains selected, but no conversation was opened and no message state changed.",
      nextResolution: "Open the opportunity and resolve its current portal-delivery requirement before returning to Messages."
    };
  }
  return selectedQuoteId === quoteId
    ? { status: "ready", thread: exactThread }
    : { status: "pending" };
}

function ThreadRow({ thread, selected, onSelect, buttonRef }) {
  return (
    <li>
      <button
        ref={buttonRef}
        type="button"
        className={`messaging-thread-row${selected ? " is-selected" : ""}`}
        aria-current={selected ? "page" : undefined}
        onClick={() => onSelect(thread.quoteId)}
      >
        <span className="messaging-thread-row-head">
          <strong>{thread.eventName}</strong>
          {!thread.conversationAvailable ? (
            <span className="messaging-unavailable">Unavailable</span>
          ) : thread.needsReply ? (
            <span className="messaging-needs-reply">Customer last replied</span>
          ) : null}
        </span>
        <span className="messaging-thread-customer">{thread.customerName} · {thread.quoteNumber}</span>
        <span className="messaging-thread-meta">
          <span>
            {formatWorkspaceDate(thread.eventDate, { emptyLabel: "Date not set" })}
            {thread.eventTime ? ` · ${thread.eventTime}` : ""}
          </span>
          <span>{thread.messageCount === 0 ? "No messages" : `${thread.messageCount} ${thread.messageCount === 1 ? "message" : "messages"}`}</span>
        </span>
        <small className="messaging-thread-discriminator">
          <span>{formatWorkspaceText(thread.venue, { emptyLabel: "Venue not set" })}</span>
          {thread.latestMessageAtISO && <span>Last activity {formatWorkspaceDateTime(thread.latestMessageAtISO)}</span>}
        </small>
      </button>
    </li>
  );
}

export default function MessagingStation({
  organizationId = "",
  seedQuotes = [],
  initialQuoteId = "",
  arrivalContext = null,
  arrivalAttempted = false,
  onArrivalResolution = null,
  onSelectQuote = null,
  onOpenEvent = null,
  onOpenCustomer = null
}) {
  const inbox = useConversationInbox({ organizationId, seedQuotes });
  const performanceStartedAtRef = useRef(messagingNow());
  const routeMeasuredRef = useRef(false);
  const inboxMeasuredRef = useRef(false);
  const eligibleThreads = useMemo(
    () => inbox.threads.filter((thread) => thread.conversationAvailable || thread.messageCount > 0),
    [inbox.threads]
  );
  const invalidArrivalAttempt = Boolean(arrivalAttempted && !arrivalContext);
  const [search, setSearch] = useState("");
  const [filter, setFilter] = useState("all");
  const [selectedQuoteId, setSelectedQuoteId] = useState(
    invalidArrivalAttempt ? "" : initialQuoteId
  );
  const [mobileThreadOpen, setMobileThreadOpen] = useState(
    invalidArrivalAttempt ? false : Boolean(initialQuoteId)
  );
  const [conversationLoadResolution, setConversationLoadResolution] = useState(null);
  const threadHeadingRef = useRef(null);
  const threadRowRefs = useRef(new Map());
  const previousInitialQuoteIdRef = useRef("");
  const arrivalReportRef = useRef("");
  const returnFocusQuoteIdRef = useRef("");
  const pendingThreadFocusRef = useRef(false);
  const routeHeadingRef = useWorkspaceRouteHeadingFocus(true);
  const filteredThreads = useMemo(
    () => filterConversationThreads(eligibleThreads, { search, filter }),
    [eligibleThreads, filter, search]
  );
  const groups = useMemo(() => groupConversationThreads(filteredThreads), [filteredThreads]);
  const selectedThread = eligibleThreads.find((thread) => thread.quoteId === selectedQuoteId) || null;
  const stationState = resolveMessagingStationState({
    inboxStatus: inbox.status,
    inboxStale: inbox.stale,
    inboxError: inbox.error,
    threads: eligibleThreads
  });
  const sync = buildMessagingSyncPresentation(inbox);
  const exactArrivalActive = Boolean(
    arrivalContext?.surfaceId === "conversation"
    && arrivalContext?.focus?.quoteId
    && arrivalContext.focus.quoteId === initialQuoteId
  );
  const exactMessageArrivalActive = Boolean(
    exactArrivalActive && arrivalContext?.focus?.messageId
  );
  const strictArrivalActive = exactArrivalActive || Boolean(arrivalAttempted);

  useEffect(() => {
    if (routeMeasuredRef.current) return;
    routeMeasuredRef.current = true;
    recordMessagingPerformanceMilestone({
      milestone: "route_usable",
      durationMs: messagingNow() - performanceStartedAtRef.current
    });
  }, []);

  useEffect(() => {
    if (inboxMeasuredRef.current || !["ready", "stale"].includes(inbox.status)) return;
    inboxMeasuredRef.current = true;
    recordMessagingPerformanceMilestone({
      milestone: "inbox_visible",
      durationMs: messagingNow() - performanceStartedAtRef.current,
      threadCount: eligibleThreads.length
    });
  }, [eligibleThreads.length, inbox.status]);

  const reportArrivalResolution = useCallback((resolution) => {
    if (!exactArrivalActive || typeof onArrivalResolution !== "function") return;
    const next = {
      ...resolution,
      focus: { ...arrivalContext?.focus, quoteId: initialQuoteId }
    };
    const signature = JSON.stringify(next);
    if (arrivalReportRef.current === signature) return;
    arrivalReportRef.current = signature;
    onArrivalResolution(next);
  }, [arrivalContext?.focus, exactArrivalActive, initialQuoteId, onArrivalResolution]);

  useEffect(() => {
    if (exactArrivalActive) {
      arrivalReportRef.current = "";
    }
  }, [exactArrivalActive, initialQuoteId]);

  useEffect(() => {
    if (invalidArrivalAttempt) {
      setSelectedQuoteId("");
      setMobileThreadOpen(false);
      pendingThreadFocusRef.current = false;
      previousInitialQuoteIdRef.current = initialQuoteId;
      return;
    }
    if (initialQuoteId && eligibleThreads.some((thread) => thread.quoteId === initialQuoteId)) {
      setSelectedQuoteId(initialQuoteId);
      setMobileThreadOpen(true);
      if (exactArrivalActive) {
        pendingThreadFocusRef.current = false;
      } else if (previousInitialQuoteIdRef.current !== initialQuoteId) {
        pendingThreadFocusRef.current = true;
      }
    } else if (!initialQuoteId && previousInitialQuoteIdRef.current) {
      returnFocusQuoteIdRef.current = previousInitialQuoteIdRef.current;
      setMobileThreadOpen(false);
    }
    previousInitialQuoteIdRef.current = initialQuoteId;
  }, [eligibleThreads, exactArrivalActive, initialQuoteId, invalidArrivalAttempt]);

  useEffect(() => {
    if (!selectedThread && eligibleThreads.length > 0 && !strictArrivalActive) {
      const firstAvailable = eligibleThreads.find((thread) => thread.conversationAvailable);
      setSelectedQuoteId((firstAvailable || eligibleThreads[0]).quoteId);
    }
  }, [eligibleThreads, selectedThread, strictArrivalActive]);

  useEffect(() => {
    if (!exactArrivalActive) return;
    const consumption = resolveMessagingArrivalConsumption({
      active: true,
      quoteId: initialQuoteId,
      inboxStatus: inbox.status,
      inboxStale: inbox.stale,
      inboxError: inbox.error,
      inboxBounded: inbox.bounded,
      threads: inbox.threads,
      selectedQuoteId
    });
    if (consumption.status !== "ready") {
      reportArrivalResolution(consumption);
      return;
    }
    // Exact-message arrivals have a single focus and acknowledgement owner:
    // QuoteConversationPanel verifies the canonical quote-scoped bodies and
    // focuses the requested message. The station must not race it by focusing
    // or resolving the surrounding thread heading.
    if (exactMessageArrivalActive) return;
    if (
      conversationLoadResolution?.status === "recovery"
      && conversationLoadResolution?.quoteId === initialQuoteId
    ) {
      reportArrivalResolution(conversationLoadResolution);
      return;
    }
    if (
      conversationLoadResolution?.status !== "ready"
      || conversationLoadResolution?.quoteId !== initialQuoteId
    ) {
      reportArrivalResolution({ status: "pending" });
      return;
    }
    const frame = window.requestAnimationFrame(() => {
      threadHeadingRef.current?.focus({ preventScroll: true });
      if (document.activeElement === threadHeadingRef.current) {
        reportArrivalResolution({ status: "resolved", itemId: initialQuoteId });
      } else if (document.activeElement !== threadHeadingRef.current) {
        reportArrivalResolution({
          status: "recovery",
          reason: "The exact conversation exists, but its focused thread state could not be opened.",
          consequence: "No alternate conversation was focused and no message state changed.",
          nextResolution: "Refresh Messages, or return to the opportunity and reopen this conversation."
        });
      }
    });
    return () => window.cancelAnimationFrame(frame);
  }, [
    eligibleThreads,
    exactArrivalActive,
    inbox.bounded,
    inbox.error,
    inbox.status,
    inbox.stale,
    inbox.threads,
    initialQuoteId,
    reportArrivalResolution,
    selectedQuoteId,
    arrivalContext?.focus?.messageId,
    conversationLoadResolution,
    exactMessageArrivalActive
  ]);

  useEffect(() => {
    if (mobileThreadOpen && pendingThreadFocusRef.current) {
      pendingThreadFocusRef.current = false;
      if (exactArrivalActive) return undefined;
      const frame = window.requestAnimationFrame(() => threadHeadingRef.current?.focus({ preventScroll: true }));
      return () => window.cancelAnimationFrame(frame);
    }
    if (!mobileThreadOpen && returnFocusQuoteIdRef.current) {
      const quoteId = returnFocusQuoteIdRef.current;
      returnFocusQuoteIdRef.current = "";
      const frame = window.requestAnimationFrame(() => threadRowRefs.current.get(quoteId)?.focus({ preventScroll: true }));
      return () => window.cancelAnimationFrame(frame);
    }
    return undefined;
  }, [exactArrivalActive, mobileThreadOpen]);

  const selectThread = (quoteId) => {
    setSelectedQuoteId(quoteId);
    if (mobileThreadOpen) {
      window.requestAnimationFrame(() => threadHeadingRef.current?.focus({ preventScroll: true }));
    } else {
      pendingThreadFocusRef.current = true;
    }
    setMobileThreadOpen(true);
    onSelectQuote?.(quoteId);
  };

  const closeMobileThread = () => {
    returnFocusQuoteIdRef.current = selectedQuoteId;
    setMobileThreadOpen(false);
    onSelectQuote?.("");
  };

  return (
    <MessagingStationCapabilitySurface
      className={`messaging-station messaging-station-${stationState}${mobileThreadOpen ? " mobile-thread-open" : ""}`}
      state={stationState}
      aria-labelledby="messaging-station-title"
    >
      <header className="messaging-station-heading">
        <div className="messaging-station-heading-copy">
          <h1
            id="messaging-station-title"
            ref={routeHeadingRef}
            tabIndex="-1"
            data-layout-audit-group="messaging-route-heading"
          >Messages</h1>
          <p data-layout-audit-group="messaging-route-heading">
            Every conversation stays attached to one event and quote.
          </p>
        </div>
        <span className={`messaging-sync-state is-${sync.tone}`} role="status">
          <Broadcast size={16} weight="bold" aria-hidden="true" />
          {sync.label}
        </span>
      </header>

      {inbox.error && eligibleThreads.length > 0 && (
        <div className="warning-note messaging-station-warning" role="status">
          <span>Live updates are interrupted. Existing event conversations remain visible; use each thread's refresh action while reconnecting.</span>
          <button type="button" className="ghost compact" onClick={inbox.retry}>Reconnect inbox</button>
        </div>
      )}

      {stationState === "loading" && (
        <section className="messaging-station-placeholder" role="status">
          <ChatCircleDots size={30} aria-hidden="true" />
          <h2>Connecting event conversations</h2>
          <p>Loading this workspace's recent conversations.</p>
        </section>
      )}

      {stationState === "error" && (
        <section className="messaging-station-placeholder" role="alert">
          <ChatCircleDots size={30} aria-hidden="true" />
          <h2>Messages are unavailable</h2>
          <p>{inbox.error || "Connect this workspace to Firebase before opening event conversations."}</p>
          <button type="button" className="ghost" onClick={inbox.retry}>Reconnect inbox</button>
        </section>
      )}

      {stationState === "recovery" && eligibleThreads.length === 0 && (
        <section className="messaging-station-placeholder" role="status">
          <ChatCircleDots size={30} aria-hidden="true" />
          <h2>Reconnecting event conversations</h2>
          <p>Refreshing this workspace's recent conversations.</p>
        </section>
      )}

      {stationState === "empty" && (
        <section className="messaging-station-placeholder">
          <ChatCircleDots size={30} aria-hidden="true" />
          <h2>No delivered event conversations yet</h2>
          <p>Deliver a customer portal from an event workspace to create its secure conversation channel.</p>
        </section>
      )}

      {["success", "stale", "partial", "recovery"].includes(stationState) && eligibleThreads.length > 0 && (
        <div className="messaging-station-grid">
          <nav className="messaging-inbox" aria-label="Event conversations">
            <div className="messaging-inbox-tools">
              <label className="messaging-search">
                <span className="sr-only">Search event conversations</span>
                <MagnifyingGlass size={18} aria-hidden="true" />
                <input
                  type="search"
                  value={search}
                  onChange={(event) => setSearch(event.target.value)}
                  placeholder="Search event, customer, quote"
                />
              </label>
              <div className="messaging-filter" role="group" aria-label="Filter conversations">
                {[
                  ["all", "All"],
                  ["needs-reply", "Needs reply"],
                  ["active", "Active"]
                ].map(([value, label]) => (
                  <button
                    key={value}
                    type="button"
                    className={filter === value ? "is-active" : ""}
                    aria-pressed={filter === value}
                    onClick={() => setFilter(value)}
                  >
                    {label}
                  </button>
                ))}
              </div>
            </div>
            <div className="messaging-inbox-scroll">
              {groups.length === 0 ? (
                <div className="messaging-filter-empty">
                  <p>No event conversations match this view.</p>
                  <button type="button" className="ghost compact" onClick={() => { setSearch(""); setFilter("all"); }}>
                    Clear filters
                  </button>
                </div>
              ) : groups.map((group) => (
                <section className="messaging-thread-group" key={group.id} aria-labelledby={`message-group-${group.id}`}>
                  <h2 id={`message-group-${group.id}`}>{group.label}<span>{group.threads.length}</span></h2>
                  <ul>
                    {group.threads.map((thread) => (
                      <ThreadRow
                        key={thread.quoteId}
                        thread={thread}
                        selected={thread.quoteId === selectedQuoteId}
                        onSelect={selectThread}
                        buttonRef={(node) => {
                          if (node) threadRowRefs.current.set(thread.quoteId, node);
                          else threadRowRefs.current.delete(thread.quoteId);
                        }}
                      />
                    ))}
                  </ul>
                </section>
              ))}
            </div>
            {inbox.bounded && (
              <p className="source-note messaging-inbox-bound">Showing the 50 most recently active conversations.</p>
            )}
          </nav>

          <section className="messaging-thread" aria-label="Selected event conversation">
            {selectedThread ? (
              <>
                <button
                  type="button"
                  className="ghost compact messaging-mobile-back"
                  onClick={closeMobileThread}
                >
                  <ArrowLeft size={17} aria-hidden="true" /> Back to Messages
                </button>
                <div className="messaging-thread-heading">
                  <div>
                    <p className="eyebrow">{selectedThread.quoteNumber}</p>
                    <h2 ref={threadHeadingRef} tabIndex="-1">{selectedThread.eventName}</h2>
                    <p>{selectedThread.customerName} · {formatWorkspaceDate(selectedThread.eventDate, { emptyLabel: "Date not set" })}</p>
                  </div>
                  {selectedThread.needsReply && <span className="messaging-needs-reply">Customer last replied</span>}
                </div>
                {selectedThread.conversationAvailable ? (
                  <QuoteConversationPanel
                    key={selectedThread.quoteId}
                    access={{ accessMode: "staff", organizationId, quoteId: selectedThread.quoteId }}
                    title="Event conversation"
                    defaultOpen
                    presentation="station"
                    showCloseAction={false}
                    onLoadResolution={exactArrivalActive && !exactMessageArrivalActive
                      ? setConversationLoadResolution
                      : null}
                    focusMessageId={exactArrivalActive
                      ? arrivalContext?.focus?.messageId || ""
                      : ""}
                    onFocusResolution={exactArrivalActive && arrivalContext?.focus?.messageId
                      ? reportArrivalResolution
                      : null}
                  />
                ) : (
                  <section className="messaging-thread-unavailable" role="status">
                    <h3>Conversation unavailable</h3>
                    <p>{selectedThread.unavailableReason || "Open the event record to review its current portal delivery."}</p>
                  </section>
                )}
              </>
            ) : (
              <div className="messaging-thread-unselected">
                <ChatCircleDots size={30} aria-hidden="true" />
                <h2>Select an event conversation</h2>
                <p>Choose an event to view the messages attached to that event and quote.</p>
              </div>
            )}
          </section>

          <aside className="messaging-context" aria-label="Selected event context">
            {selectedThread && (
              <>
                <div className="messaging-context-title">
                  <p className="eyebrow">Event context</p>
                  <span className={`status-chip status-${selectedThread.status}`}>{titleCase(selectedThread.status)}</span>
                </div>
                <dl>
                  <div><dt><CalendarBlank size={17} aria-hidden="true" /> Event</dt><dd>{formatWorkspaceDate(selectedThread.eventDate)}</dd></div>
                  <div><dt><User size={17} aria-hidden="true" /> Customer</dt><dd>{selectedThread.customerName}</dd></div>
                  <div><dt>Venue</dt><dd>{formatWorkspaceText(selectedThread.venue, { emptyLabel: "Not set" })}</dd></div>
                  <div><dt>Quote</dt><dd>{selectedThread.quoteNumber}</dd></div>
                  <div><dt>Value</dt><dd>{formatWorkspaceMoney(selectedThread.total)}</dd></div>
                </dl>
                <div className="messaging-context-actions">
                  <button type="button" className="cta" onClick={() => onOpenEvent?.(selectedThread.quoteId)}>
                    View event <ArrowSquareOut size={17} aria-hidden="true" />
                  </button>
                  {selectedThread.customerId && onOpenCustomer && (
                    <button type="button" className="ghost" onClick={() => onOpenCustomer(selectedThread.customerId)}>
                      Client overview
                    </button>
                  )}
                </div>
                <p className="source-note">Conversation activity is not a payment, delivery, or read receipt.</p>
              </>
            )}
          </aside>
        </div>
      )}
    </MessagingStationCapabilitySurface>
  );
}
