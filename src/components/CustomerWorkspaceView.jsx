import { useEffect, useMemo, useRef, useState } from "react";
import StatusChip from "./StatusChip";
import { buildStaffProposalPreview, getCustomerWorkspace } from "../lib/customerWorkspace";
import { classifyDepositStatus, classifyFinalBalanceDisplayStatus, classifyQuoteStatus } from "../lib/statusSemantics";
import { buildPortalThemeStyle } from "../data/portalThemePresets";
import { useWorkspaceRouteHeadingFocus } from "../hooks/useWorkspaceRouteHeadingFocus";
import {
  formatWorkspaceDate,
  formatWorkspaceDateTime,
  formatWorkspaceInteger,
  formatWorkspaceMoney,
  formatWorkspaceText,
  hasWorkspaceNumber,
  humanizeWorkspaceValue
} from "../lib/workspacePresentation";

const TABS = [
  ["overview", "Overview"],
  ["quotes", "Quotes & Proposals"],
  ["events", "Events"],
  ["money", "Money"],
  ["conversations", "Conversations"]
];

function safeLogoUrl(value) {
  const normalized = String(value || "").trim();
  if (!normalized) return "";
  try {
    const url = new URL(normalized);
    return url.protocol === "https:" ? url.toString() : "";
  } catch {
    return "";
  }
}

function readableReason(value) {
  return humanizeWorkspaceValue(value, { emptyLabel: "Saved proposal snapshot" });
}

export function StaffProposalPreview({ quote, onClose }) {
  const headingRef = useRef(null);
  const preview = buildStaffProposalPreview(quote);
  const branding = preview.branding || {};
  const brandLogoUrl = safeLogoUrl(branding.brandLogoUrl);
  const proposalTheme = buildPortalThemeStyle(branding);
  const brandName = branding.brandName || branding.organizationName || "Catering proposal";
  const contact = [branding.businessEmail, branding.businessPhone, branding.businessAddress]
    .filter(Boolean)
    .join(" · ");

  useEffect(() => {
    if (typeof window === "undefined") return undefined;
    const frame = window.requestAnimationFrame(() => headingRef.current?.focus({ preventScroll: true }));
    const handleKeyDown = (event) => {
      if (event.key !== "Escape") return;
      event.preventDefault();
      event.stopPropagation();
      onClose?.();
    };
    window.addEventListener("keydown", handleKeyDown);
    return () => {
      window.cancelAnimationFrame(frame);
      window.removeEventListener("keydown", handleKeyDown);
    };
  }, [onClose]);

  return (
    <aside
      className="staff-proposal-preview"
      aria-labelledby="staff-proposal-preview-title"
      role="region"
    >
      <div className="workspace-route-head staff-proposal-preview-controls">
        <div>
          <p className="eyebrow">Read-only staff preview</p>
          <h3 ref={headingRef} id="staff-proposal-preview-title" tabIndex={-1}>Proposal presentation</h3>
        </div>
        <button type="button" className="ghost compact" onClick={onClose}>Close preview</button>
      </div>
      <p className="source-note">Built from canonical staff data. Opening this preview does not create customer viewed evidence.</p>
      <section
        className="staff-proposal-customer-presentation"
        data-customer-presentation="true"
        style={proposalTheme}
        aria-label={`Customer-facing presentation for ${preview.quoteNumber || "proposal"}`}
      >
        <header className="staff-proposal-brand-heading">
          <div className="staff-proposal-brand-lockup">
            {brandLogoUrl && <img src={brandLogoUrl} alt={`${brandName} logo`} />}
            <div>
              <p className="staff-proposal-brand-kicker">Catering proposal</p>
              <h4>{brandName}</h4>
              {branding.brandTagline && <p>{branding.brandTagline}</p>}
            </div>
          </div>
          {contact && <p className="staff-proposal-brand-contact">{contact}</p>}
        </header>
        <div className="staff-proposal-title-block">
          <span>{preview.quoteNumber || "Proposal"}</span>
          <h5>{preview.eventName || "Your event"}</h5>
          <p>Prepared for {preview.customerName || "the customer"}</p>
        </div>
        <dl className="staff-proposal-preview-grid">
          <div><dt>Date</dt><dd>{formatWorkspaceDate(preview.eventDate)}</dd></div>
          <div><dt>Venue</dt><dd>{formatWorkspaceText(preview.venue, { emptyLabel: "Venue not set" })}</dd></div>
          <div><dt>Guests</dt><dd>{formatWorkspaceInteger(preview.guests, { emptyLabel: "Guest count not set" })}</dd></div>
          <div><dt>Subtotal</dt><dd>{formatWorkspaceMoney(preview.subtotal)}</dd></div>
          <div><dt>Tax</dt><dd>{formatWorkspaceMoney(preview.tax)}</dd></div>
          <div><dt>Total</dt><dd>{formatWorkspaceMoney(preview.total)}</dd></div>
          <div><dt>Deposit</dt><dd>{formatWorkspaceMoney(preview.deposit)}</dd></div>
        </dl>
      </section>
    </aside>
  );
}

export function CustomerWorkspacePartialNotice({ quotePageInfo = {}, onOpenQuotes }) {
  if (!quotePageInfo.truncated) return null;
  return (
    <div
      className="warning-note customer-partial-results"
      data-capability-state="partial"
      role="status"
    >
      <span>Customer 360 is a partial view capped at {quotePageInfo.limit} linked quotes; counts and money below are not complete.</span>
      <button type="button" className="ghost compact" onClick={onOpenQuotes}>Open complete Quotes history</button>
    </div>
  );
}

export default function CustomerWorkspaceView({
  organizationId = "",
  customerId = "",
  onBack,
  onOpenQuotes,
  onOpenQuote,
  onOpenWorkflow,
  onOpenSchedule
}) {
  const [activeTab, setActiveTab] = useState("overview");
  const [previewQuoteId, setPreviewQuoteId] = useState("");
  const [refreshToken, setRefreshToken] = useState(0);
  const [state, setState] = useState({ loading: true, error: "", workspace: null });
  const generationRef = useRef(0);
  const tabRefs = useRef({});
  const previewTriggerRef = useRef(null);
  const headingRef = useWorkspaceRouteHeadingFocus(Boolean(
    !state.loading && !state.error && state.workspace
  ));

  useEffect(() => {
    const generation = generationRef.current + 1;
    generationRef.current = generation;
    setState({ loading: true, error: "", workspace: null });
    getCustomerWorkspace({ organizationId, customerId })
      .then((workspace) => {
        if (generation !== generationRef.current) return;
        setState({ loading: false, error: "", workspace });
      })
      .catch((error) => {
        if (generation !== generationRef.current) return;
        setState({ loading: false, error: error?.message || "Failed to load Customer 360.", workspace: null });
      });
    return () => {
      generationRef.current += 1;
    };
  }, [customerId, organizationId, refreshToken]);

  const previewQuote = useMemo(
    () => state.workspace?.quotes.find((quote) => quote.id === previewQuoteId) || null,
    [previewQuoteId, state.workspace?.quotes]
  );

  const closePreview = () => {
    setPreviewQuoteId("");
    const returnTarget = previewTriggerRef.current;
    window.requestAnimationFrame(() => returnTarget?.focus());
  };

  const handleTabKeyDown = (event, tabId) => {
    const index = TABS.findIndex(([id]) => id === tabId);
    let next = index;
    if (event.key === "ArrowRight") next = (index + 1) % TABS.length;
    if (event.key === "ArrowLeft") next = (index - 1 + TABS.length) % TABS.length;
    if (event.key === "Home") next = 0;
    if (event.key === "End") next = TABS.length - 1;
    if (next === index) return;
    event.preventDefault();
    const nextId = TABS[next][0];
    setActiveTab(nextId);
    window.requestAnimationFrame(() => tabRefs.current[nextId]?.focus());
  };

  if (state.loading) {
    return <main className="container workspace-route-main"><section className="panel"><p role="status">Loading Customer 360...</p></section></main>;
  }
  if (state.error) {
    return (
      <main className="container workspace-route-main"><section className="panel">
        <h1>Customer 360 unavailable</h1>
        <p role="alert" className="error-note">{state.error}</p>
        <button type="button" className="ghost" onClick={() => setRefreshToken((value) => value + 1)}>Retry</button>
      </section></main>
    );
  }
  if (!state.workspace) {
    return (
      <main className="container workspace-route-main"><section className="panel">
        <h1>Customer not found</h1>
        <p className="muted">This customer ID is not available in the current organization.</p>
        <button type="button" className="ghost" onClick={onBack}>Back to customers</button>
      </section></main>
    );
  }

  const workspace = state.workspace;
  const customer = workspace.customer;
  return (
    <main className="container workspace-route-main" aria-labelledby="customer-workspace-title">
      <section className="panel customer-workspace">
        <div className="workspace-route-head">
          <div>
            <button type="button" className="workspace-text-link" onClick={onBack}>Customers</button>
            <p className="eyebrow">Internal Customer 360</p>
            <h1
              ref={headingRef}
              id="customer-workspace-title"
              className="workspace-route-heading"
              tabIndex={-1}
            >
              {formatWorkspaceText(customer.name || customer.email, { emptyLabel: "Unnamed customer" })}
            </h1>
            <p className="muted">{[customer.company, customer.email, customer.phone].filter(Boolean).join(" · ") || "No contact details"}</p>
          </div>
          <button type="button" className="ghost" onClick={() => setRefreshToken((value) => value + 1)}>Refresh</button>
        </div>

        <div className="customer-workspace-tabs" role="tablist" aria-label="Customer workspace sections">
          {TABS.map(([id, label]) => (
            <button
              key={id}
              type="button"
              role="tab"
              ref={(node) => { tabRefs.current[id] = node; }}
              aria-selected={activeTab === id}
              aria-controls={`customer-panel-${id}`}
              tabIndex={activeTab === id ? 0 : -1}
              className={activeTab === id ? "active" : ""}
              onKeyDown={(event) => handleTabKeyDown(event, id)}
              onClick={() => setActiveTab(id)}
            >
              {label}
            </button>
          ))}
        </div>

        <CustomerWorkspacePartialNotice
          quotePageInfo={workspace.quotePageInfo}
          onOpenQuotes={onOpenQuotes}
        />

        <section id="customer-panel-overview" role="tabpanel" tabIndex={0} hidden={activeTab !== "overview"}>
          <div className="customer-overview-grid">
            <article><span>Active quotes{workspace.quotePageInfo.truncated ? " shown" : ""}</span><strong>{formatWorkspaceInteger(workspace.activeQuotes.length)}</strong></article>
            <article><span>Accepted / booked events{workspace.quotePageInfo.truncated ? " shown" : ""}</span><strong>{formatWorkspaceInteger(workspace.events.length)}</strong></article>
            <article><span>Needs attention{workspace.quotePageInfo.truncated ? " in this view" : ""}</span><strong>{formatWorkspaceInteger(workspace.attention.itemCount)}</strong></article>
          </div>
          <article className="customer-next-action">
            <p className="eyebrow">Next safe staff action</p>
            <h3>{workspace.nextAction.label}</h3>
            {workspace.nextAction.kind === "workflow" && (
              <button type="button" className="cta" onClick={() => onOpenWorkflow?.(workspace.nextAction)}>Open in Workflow</button>
            )}
            {workspace.nextAction.kind === "quote" && (
              <button type="button" className="cta" onClick={() => onOpenQuote?.(workspace.nextAction.quoteId)}>Open quote</button>
            )}
          </article>
          <h2>Recent activity</h2>
          {workspace.recentActivity.length === 0 ? <p className="source-note">No lifecycle activity is recorded yet.</p> : (
            <ol className="customer-activity-list">
              {workspace.recentActivity.map((item, index) => (
                <li key={`${item.quoteId}-${item.label}-${index}`}>
                  <button type="button" className="workspace-text-link" onClick={() => onOpenQuote?.(item.quoteId)}>
                    {formatWorkspaceText(item.quoteNumber, { emptyLabel: "Quote number pending" })}
                  </button>
                  <span>{item.label}</span><time dateTime={item.atISO}>{formatWorkspaceDateTime(item.atISO)}</time>
                </li>
              ))}
            </ol>
          )}
        </section>

        <section id="customer-panel-quotes" role="tabpanel" tabIndex={0} hidden={activeTab !== "quotes"}>
          <h2>Quotes &amp; proposals</h2>
          <p className="source-note">Canonical staff records and immutable version snapshots. Customer viewed evidence is never inferred here.</p>
          {workspace.quotes.length === 0 ? <p className="source-note">No customer-linked quotes.</p> : (
            <div className="customer-card-list">
              {workspace.quotes.map((quote) => {
                const status = classifyQuoteStatus(quote.status);
                const versions = workspace.proposalVersions.filter((version) => version.quoteId === quote.id);
                const versionsTruncated = workspace.versionPageInfo.truncatedQuoteIds.includes(quote.id);
                return (
                  <article key={quote.id}>
                    <div>
                      <h3>{formatWorkspaceText(quote.quoteNumber, { emptyLabel: "Quote number pending" })}</h3>
                      <p>
                        {formatWorkspaceText(quote.event?.name, { emptyLabel: "Untitled event" })}
                        {" · "}{formatWorkspaceDate(quote.event?.date)}
                      </p>
                      <StatusChip family={status.family} label={status.label} />
                      <small>
                        {versions.length} most recent retained version{versions.length === 1 ? "" : "s"}
                        {versionsTruncated ? ` shown; older versions exist beyond the ${workspace.versionPageInfo.perQuoteLimit}-version read limit` : ""}
                      </small>
                      {versions.length > 0 && (
                        <details className="customer-version-history">
                          <summary>Review proposal versions</summary>
                          <ol className="customer-version-list">
                            {versions.map((version, index) => (
                              <li key={version.id || version.versionId || `${quote.id}-${index}`}>
                                <strong>Version {Number(version.versionNumber || 0) || versions.length - index}</strong>
                                <span>{readableReason(version.reason)}</span>
                                <time dateTime={version.createdAtISO}>{formatWorkspaceDateTime(version.createdAtISO)}</time>
                              </li>
                            ))}
                          </ol>
                        </details>
                      )}
                    </div>
                    <div className="right-actions">
                      <button
                        type="button"
                        className="ghost compact"
                        aria-expanded={previewQuoteId === quote.id}
                        onClick={(event) => {
                          previewTriggerRef.current = event.currentTarget;
                          setPreviewQuoteId(quote.id);
                        }}
                      >
                        Preview
                      </button>
                      <button type="button" className="ghost compact" onClick={() => onOpenQuote?.(quote.id)}>Open record</button>
                    </div>
                  </article>
                );
              })}
            </div>
          )}
          {previewQuote && <StaffProposalPreview quote={previewQuote} onClose={closePreview} />}
        </section>

        <section id="customer-panel-events" role="tabpanel" tabIndex={0} hidden={activeTab !== "events"}>
          <div className="workspace-route-head"><h2>Events</h2><button type="button" className="ghost" onClick={onOpenSchedule}>Open Schedule</button></div>
          {workspace.events.length === 0 ? <p className="source-note">No accepted or booked events.</p> : (
            <div className="customer-card-list">
              {workspace.events.map((event) => (
                <article key={event.quoteId}>
                  <div>
                    <h3>{formatWorkspaceText(event.eventName, { emptyLabel: "Untitled event" })}</h3>
                    <p>
                      {formatWorkspaceDate(event.date)} · {formatWorkspaceText(event.venue, { emptyLabel: "Venue not set" })}
                      {" · "}{formatWorkspaceInteger(event.guests, { emptyLabel: "Guest count not set" })}
                      {hasWorkspaceNumber(event.guests) ? " guests" : ""}
                    </p>
                    <small>{event.contractNumber ? `Contract ${event.contractNumber}` : "Acceptance recorded; booking not yet recorded"}</small>
                  </div>
                  <button type="button" className="ghost compact" onClick={() => onOpenQuote?.(event.quoteId)}>{event.beoAvailable ? "Open BEO entry point" : "Open quote"}</button>
                </article>
              ))}
            </div>
          )}
        </section>

        <section id="customer-panel-money" role="tabpanel" tabIndex={0} hidden={activeTab !== "money"}>
          <h2>Money</h2>
          <p className="warning-note">Operational payment states only. These amounts are not an accounting revenue report.</p>
          {workspace.money.length === 0 && <p className="source-note">No deposit or final-balance state is recorded for this customer.</p>}
          <div className="customer-card-list">
            {workspace.money.map((row, index) => {
              const status = row.kind === "deposit" ? classifyDepositStatus(row.status) : classifyFinalBalanceDisplayStatus(row.status);
              return (
                <article key={`${row.quoteId}-${row.kind}-${index}`}>
                  <div><h3>{row.kind === "deposit" ? "Deposit" : "Final balance"} · {formatWorkspaceMoney(row.amount)}</h3><p>{formatWorkspaceText(row.quoteNumber, { emptyLabel: "Quote number pending" })}</p><StatusChip family={status.family} label={status.label} /></div>
                  <button type="button" className="ghost compact" onClick={() => onOpenQuote?.(row.quoteId)}>Open record</button>
                </article>
              );
            })}
          </div>
        </section>

        <section id="customer-panel-conversations" role="tabpanel" tabIndex={0} hidden={activeTab !== "conversations"}>
          <h2>Conversations</h2>
          <p className="source-note">Messages remain bound to each quote. Customer 360 links them without merging their histories.</p>
          {workspace.conversations.length === 0 && <p className="source-note">No quote conversations are linked to this customer.</p>}
          <div className="customer-card-list">
            {workspace.conversations.map((conversation) => (
              <article key={conversation.quoteId}>
                <div>
                  <h3>{formatWorkspaceText(conversation.quoteNumber, { emptyLabel: "Quote number pending" })}</h3>
                  {conversation.summaryAvailable ? (
                    <p>
                      {formatWorkspaceInteger(conversation.messageCount)} message{conversation.messageCount === 1 ? "" : "s"} recorded
                      {conversation.latestMessageAtISO
                        ? conversation.latestActorType
                          ? ` · latest from ${humanizeWorkspaceValue(conversation.latestActorType, {
                              labels: { customer: "customer", staff: "staff" }
                            })} ${formatWorkspaceDateTime(conversation.latestMessageAtISO)}`
                          : ` · latest message ${formatWorkspaceDateTime(conversation.latestMessageAtISO)}`
                        : ""}
                    </p>
                  ) : (
                    <p>Conversation summary is unavailable for this legacy quote; open the record for the authoritative thread.</p>
                  )}
                </div>
                <button type="button" className="ghost compact" onClick={() => onOpenQuote?.(conversation.quoteId)}>Open quote conversation</button>
              </article>
            ))}
          </div>
        </section>
      </section>
    </main>
  );
}
