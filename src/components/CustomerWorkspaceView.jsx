import { lazy, Suspense, useCallback, useEffect, useMemo, useRef, useState } from "react";
import StatusChip from "./StatusChip";
import { buildStaffProposalPreview, getCustomerWorkspace } from "../lib/customerWorkspace";
import { classifyDepositStatus, classifyFinalBalanceDisplayStatus, classifyQuoteStatus } from "../lib/statusSemantics";
import { buildPortalThemeStyle } from "../data/portalThemePresets";
import { useWorkspaceRouteHeadingFocus } from "../hooks/useWorkspaceRouteHeadingFocus";
import {
  useOptionalWorkspaceNavigation,
  useWorkspaceReturnContextAdapter
} from "../context/WorkspaceNavigationContext";
import { restoreWorkspaceReturnViewport } from "../lib/workspaceReturnContext";
import { StaffReadContextRail } from "./StaffEvidenceRail";
import CustomerCommercialTimeline from "./CustomerCommercialTimeline";
import CustomerCommercialMeasures from "./CustomerCommercialMeasures";
import CustomerRevenueOpportunities, {
  buildCustomerRevenueOpportunityRead
} from "./CustomerRevenueOpportunities";
import RevenueAutopilotCustomerControls from "./RevenueAutopilotCustomerControls";
import QuoteVersionComparison from "./QuoteVersionComparison";
import {
  formatWorkspaceDate,
  formatWorkspaceDateTime,
  formatWorkspaceInteger,
  formatWorkspaceMoney,
  formatWorkspaceText,
  hasWorkspaceNumber,
  humanizeWorkspaceValue
} from "../lib/workspacePresentation";

const AMBIENT_UI_ENABLED = import.meta.env.VITE_AMBIENT_UI_ENABLED === "1"
  || import.meta.env.VITE_AMBIENT_UI_ENABLED === "true"
  || import.meta.env.VITE_AMBIENT_UI_ENABLED === "yes"
  || import.meta.env.VITE_AMBIENT_UI_ENABLED === "on";
const AmbientClientRelationshipHost = AMBIENT_UI_ENABLED
  ? lazy(() => import("./AmbientClientsView").then((module) => ({
      default: module.AmbientClientRelationshipHost
    })))
  : null;

const TABS = [
  ["overview", "Overview"],
  ["quotes", "Quotes & Proposals"],
  ["events", "Events"],
  ["money", "Money"],
  ["conversations", "Conversations"]
];

const TAB_IDS = TABS.map(([id]) => id);

const EMPTY_WORKSPACE_STATE = {
  loading: true,
  error: "",
  stale: false,
  phase: "initial",
  loadedAt: 0,
  scopeKey: "",
  workspace: null,
  revenueRadar: null,
  revenueRadarError: ""
};

function ClientRecordDisclosure({ ambientMode = false, disclosureRef, children }) {
  if (!ambientMode) return <>{children}</>;
  return (
    <details ref={disclosureRef} className="ambient-client-overview__record">
      <summary>More client history and controls</summary>
      <div className="ambient-client-overview__record-body">{children}</div>
    </details>
  );
}

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

export function resolveCustomerWorkspaceTabKey(currentId, key) {
  const index = TAB_IDS.indexOf(currentId);
  if (index < 0) return currentId;
  if (key === "ArrowRight") return TAB_IDS[(index + 1) % TAB_IDS.length];
  if (key === "ArrowLeft") return TAB_IDS[(index - 1 + TAB_IDS.length) % TAB_IDS.length];
  if (key === "Home") return TAB_IDS[0];
  if (key === "End") return TAB_IDS.at(-1);
  return currentId;
}

export function CustomerWorkspaceReadState({
  state,
  organizationName,
  organizationId,
  source = "",
  loadedAt = 0,
  errorMessage = "",
  onBack,
  onRetry
}) {
  const isLoading = state === "loading";
  const isError = state === "error";
  const title = isLoading
    ? "Loading client overview"
    : isError
      ? "Client overview unavailable"
      : "Customer not found";
  const outcome = isLoading
    ? "Waiting for the tenant-scoped customer and linked quote reads to complete."
    : isError
      ? "The client overview did not finish loading; no previous client record is being shown."
      : "The bounded tenant-scoped read completed without a matching customer record.";

  return (
    <main className="container workspace-route-main" data-capability-state={state}>
      <section className="panel customer-workspace">
        <h1>{title}</h1>
        {isLoading && <p role="status">Loading client overview...</p>}
        {isError && <p role="alert" className="error-note">{errorMessage || "Client overview could not be loaded."}</p>}
        {state === "empty" && (
          <p className="muted">This customer ID is not available in the current organization.</p>
        )}
        <StaffReadContextRail
          organizationName={organizationName}
          organizationId={organizationId}
          source={source}
          loadedAt={loadedAt}
          loading={isLoading}
          error={isError ? "Client overview failed to load." : ""}
          truncationKnown={state === "empty"}
          readContract="Tenant-scoped customer record with bounded linked quote and retained-version reads"
          outcome={outcome}
          title="Client overview details"
          titleId="customer-workspace-state-read-context-title"
          caveat="This staff read does not establish proposal delivery, customer viewing or acceptance, booking, payment, or operational completion."
        />
        {isError && (
          <button type="button" className="ghost" data-capability-state="recovery" onClick={onRetry}>Retry</button>
        )}
        {state === "empty" && <button type="button" className="ghost" onClick={onBack}>Back to customers</button>}
      </section>
    </main>
  );
}

export function CustomerEventsHeader({ scheduleAvailable = true, onOpenSchedule }) {
  return (
    <div className="workspace-route-head">
      <h2>Events</h2>
      {scheduleAvailable
        ? <button type="button" className="ghost" onClick={onOpenSchedule}>Open Schedule</button>
        : <span className="source-note">Schedule is not enabled for this organization.</span>}
    </div>
  );
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
      <span>This client overview shows up to {quotePageInfo.limit} linked quotes; counts and amounts below may be incomplete.</span>
      <button type="button" className="ghost compact" onClick={onOpenQuotes}>Open complete Quotes history</button>
    </div>
  );
}

export function CustomerRelationshipBriefing({
  briefing = {},
  onOpenQuote,
  onOpenWorkflow
}) {
  const nextEvent = briefing.nextEvent || null;
  const latestActivity = briefing.latestActivity || null;
  const nextAction = briefing.nextAction || { kind: "none", label: "No immediate staff action" };
  const truncated = briefing.scope?.truncated === true;
  return (
    <section
      className="customer-relationship-briefing"
      aria-labelledby="customer-relationship-briefing-title"
      data-capability-state={truncated ? "partial" : "success"}
    >
      <div className="workspace-route-head">
        <div>
          <p className="eyebrow">Client summary</p>
          <h2 id="customer-relationship-briefing-title">What matters next</h2>
        </div>
        <span className="source-note">
          {truncated
            ? `Derived from ${formatWorkspaceInteger(briefing.displayedQuoteCount)} displayed records; older linked quotes exist.`
            : `Derived from ${formatWorkspaceInteger(briefing.displayedQuoteCount)} linked records in this bounded read.`}
        </span>
      </div>
      <div className="customer-overview-grid">
        <article>
          <span>Active quotes{truncated ? " shown" : ""}</span>
          <strong>{formatWorkspaceInteger(briefing.activeQuoteCount)}</strong>
        </article>
        <article>
          <span>Needs attention{truncated ? " in this view" : ""}</span>
          <strong>{formatWorkspaceInteger(briefing.attentionCount)}</strong>
        </article>
        <article>
          <span>Next dated event</span>
          <strong>
            {nextEvent
              ? formatWorkspaceDate(nextEvent.date)
              : truncated
                ? "No dated event in this bounded view"
                : "No dated event recorded"}
          </strong>
          {nextEvent && (
            <button type="button" className="workspace-text-link" onClick={() => onOpenQuote?.(nextEvent.quoteId)}>
              {formatWorkspaceText(nextEvent.eventName, { emptyLabel: "Untitled event" })}
            </button>
          )}
        </article>
        <article>
          <span>Latest recorded activity</span>
          <strong>
            {latestActivity
              ? latestActivity.label
              : truncated
                ? "No activity in this bounded view"
                : "No activity recorded"}
          </strong>
          {latestActivity && <time dateTime={latestActivity.atISO}>{formatWorkspaceDateTime(latestActivity.atISO)}</time>}
        </article>
      </div>
      <article className="customer-next-action">
        <p className="eyebrow">Next safe staff action</p>
        <h3>{nextAction.label}</h3>
        {nextAction.kind === "workflow" && (
          <button type="button" className="cta" onClick={() => onOpenWorkflow?.(nextAction)}>Open in Workflow</button>
        )}
        {nextAction.kind === "quote" && (
          <button type="button" className="cta" onClick={() => onOpenQuote?.(nextAction.quoteId)}>Open quote</button>
        )}
      </article>
    </section>
  );
}

export function resolveCustomerCloseoutTarget({ organizationId, workspace, radar, target } = {}) {
  const quoteId = String(target?.quoteId || "").trim();
  if (target?.attentionType !== "post_event_closeout" || !quoteId || !organizationId) return null;
  if (!workspace?.quotes?.some((quote) => quote.id === quoteId && quote.organizationId === organizationId)) return null;
  const matches = (radar?.opportunities || []).filter((opportunity) => (
    opportunity.type === "post_event_closeout"
    && opportunity.quoteId === quoteId
    && opportunity.organizationId === organizationId
  ));
  return matches.length === 1 ? matches[0] : null;
}

export default function CustomerWorkspaceView({
  organizationId = "",
  organizationName = "",
  customerId = "",
  onBack,
  onOpenQuotes,
  onOpenQuote,
  onOpenOpportunity,
  onOpenConversation,
  onOpenQuoteEdit,
  onCreateRebook,
  onOpenWorkflow,
  onOpenSchedule,
  scheduleAvailable = true,
  tenantTimeZone = "",
  isAdmin = false,
  currentUserRole = "staff",
  currentUserUid = "",
  workflowEnabled = false,
  postEventLearningEnabled = false,
  learningInventoryEnabled = false,
  onReviewLearning,
  ambientMode = false,
  arrivalContext = null,
  arrivalAttempted = false,
  onArrivalResolution
}) {
  const navigation = useOptionalWorkspaceNavigation();
  const [activeTab, setActiveTab] = useState("overview");
  const [previewQuoteId, setPreviewQuoteId] = useState("");
  const [refreshToken, setRefreshToken] = useState(0);
  const [state, setState] = useState(EMPTY_WORKSPACE_STATE);
  const generationRef = useRef(0);
  const tabRefs = useRef({});
  const recordDisclosureRef = useRef(null);
  const closeoutReturnRef = useRef(null);
  const closeoutFocusFrameRef = useRef(null);
  const [revealedCloseout, setRevealedCloseout] = useState(null);
  const previewTriggerRef = useRef(null);
  const returnRestoreCancelRef = useRef(null);
  const requestedScopeKey = `${String(organizationId || "").trim()}\u0000${String(customerId || "").trim()}`;
  const workspaceForScope = state.scopeKey === requestedScopeKey ? state.workspace : null;
  const headingRef = useWorkspaceRouteHeadingFocus(Boolean(workspaceForScope));

  const captureClientOverviewReturnView = useCallback((hint = {}) => {
    const root = headingRef.current?.closest("main");
    const activeElement = typeof document !== "undefined" ? document.activeElement : null;
    let focus = hint?.focus && typeof hint.focus === "object" ? hint.focus : null;
    if (!focus && activeElement && root?.contains(activeElement)) {
      const actionId = activeElement.dataset?.ambientActionId || "";
      const opportunityId = activeElement.closest?.("[data-opportunity-id]")?.dataset.opportunityId || "";
      if (actionId && opportunityId) {
        focus = {
          kind: "client-overview-action",
          objectId: opportunityId,
          actionId,
          controlId: activeElement.dataset?.returnFocusControl || ""
        };
      } else if (activeElement.getAttribute?.("role") === "tab") {
        focus = { kind: "client-overview-tab", controlId: activeElement.id?.replace("customer-tab-", "") || activeTab };
      }
    }
    return {
      routeId: "customer-detail",
      structured: { activeTab },
      disclosureIds: recordDisclosureRef.current?.open ? ["client-record"] : [],
      scrollY: typeof window !== "undefined" ? window.scrollY : 0,
      focus: focus || { kind: "route-heading" }
    };
  }, [activeTab, headingRef]);

  const restoreClientOverviewReturnView = useCallback((view) => {
    returnRestoreCancelRef.current?.();
    const requestedTab = TAB_IDS.includes(view?.structured?.activeTab)
      ? view.structured.activeTab
      : "overview";
    setActiveTab(requestedTab);
    if (recordDisclosureRef.current) {
      recordDisclosureRef.current.open = view?.disclosureIds?.includes("client-record") || false;
    }
    return new Promise((resolve) => {
      let attempt = 0;
      let active = true;
      let settled = false;
      let frameId = null;
      let cancelViewport = null;
      const finish = (status) => {
        if (settled) return;
        settled = true;
        resolve({ status });
      };
      const cancel = () => {
        active = false;
        if (frameId !== null) window.cancelAnimationFrame(frameId);
        cancelViewport?.();
        finish("cancelled");
      };
      returnRestoreCancelRef.current = cancel;
      const restoreRenderedView = () => {
        if (!active) return;
        const root = headingRef.current?.closest("main");
        const focus = view?.focus || {};
        let target = null;
        if (focus.kind === "client-overview-action") {
          target = Array.from(root?.querySelectorAll("[data-ambient-action-id]") || []).find((element) => (
            element.dataset.ambientActionId === focus.actionId
            && element.closest("[data-opportunity-id]")?.dataset.opportunityId === focus.objectId
            && (!focus.controlId || element.dataset.returnFocusControl === focus.controlId)
          ));
        } else if (focus.kind === "client-overview-tab") {
          target = tabRefs.current[focus.controlId] || null;
        } else {
          target = headingRef.current;
        }
        const relationshipReady = Boolean(root?.querySelector(".ambient-client-overview"));
        if (
          ["client-overview-action", "route-heading"].includes(focus.kind || "route-heading")
          && !relationshipReady
        ) {
          frameId = window.requestAnimationFrame(restoreRenderedView);
          return;
        }
        if (!target && attempt < 30) {
          attempt += 1;
          frameId = window.requestAnimationFrame(restoreRenderedView);
          return;
        }
        frameId = null;
        const exactTarget = Boolean(target);
        cancelViewport = restoreWorkspaceReturnViewport({
          focusTarget: target || headingRef.current,
          scrollY: view?.scrollY
        });
        finish(exactTarget ? "restored" : "recovery");
      };
      if (typeof window !== "undefined") {
        frameId = window.requestAnimationFrame(restoreRenderedView);
      } else {
        finish("recovery");
      }
    });
  }, [headingRef]);

  useWorkspaceReturnContextAdapter({
    routeId: "customer-detail",
    active: Boolean(ambientMode && workspaceForScope),
    capture: captureClientOverviewReturnView,
    restore: restoreClientOverviewReturnView
  });

  useEffect(() => () => {
    returnRestoreCancelRef.current?.();
  }, []);

  useEffect(() => {
    const generation = generationRef.current + 1;
    generationRef.current = generation;
    setState((current) => current.scopeKey === requestedScopeKey
      ? { ...current, loading: true, error: "", stale: false }
      : { ...EMPTY_WORKSPACE_STATE, scopeKey: requestedScopeKey });
    const projectWorkspace = (workspace, loadedAt) => {
      let revenueRadar = null;
      let revenueRadarError = "";
      if (workspace) {
        try {
          revenueRadar = buildCustomerRevenueOpportunityRead({
            workspace,
            organizationId,
            loadedAt,
            tenantTimeZone
          });
        } catch (error) {
          revenueRadarError = error?.message || "Follow-ups could not be checked.";
        }
      }
      return { revenueRadar, revenueRadarError };
    };
    getCustomerWorkspace({
      organizationId,
      customerId,
      onCoreWorkspace: (workspace) => {
        if (generation !== generationRef.current || !workspace) return;
        const loadedAt = Date.now();
        const derived = projectWorkspace(workspace, loadedAt);
        setState((current) => {
          if (
            generation !== generationRef.current
            || (current.scopeKey === requestedScopeKey && current.phase === "complete" && current.workspace)
          ) return current;
          return {
            loading: true,
            error: "",
            stale: false,
            phase: "core",
            loadedAt,
            scopeKey: requestedScopeKey,
            workspace,
            ...derived
          };
        });
      }
    })
      .then((workspace) => {
        if (generation !== generationRef.current) return;
        const loadedAt = Date.now();
        const derived = projectWorkspace(workspace, loadedAt);
        setState({
          loading: false,
          error: "",
          stale: false,
          phase: "complete",
          loadedAt,
          scopeKey: requestedScopeKey,
          workspace,
          ...derived
        });
      })
      .catch((error) => {
        if (generation !== generationRef.current) return;
        setState((current) => ({
          ...current,
          loading: false,
          stale: current.scopeKey === requestedScopeKey
            && current.phase === "complete"
            && Number(current.loadedAt) > 0,
          phase: current.scopeKey === requestedScopeKey && current.phase === "core"
            ? "core-error"
            : current.phase,
          error: error?.message || "Failed to load client overview.",
          scopeKey: requestedScopeKey,
          workspace: current.scopeKey === requestedScopeKey ? current.workspace : null
        }));
      });
    return () => {
      generationRef.current += 1;
    };
  }, [customerId, organizationId, refreshToken, requestedScopeKey, tenantTimeZone]);

  const previewQuote = useMemo(
    () => workspaceForScope?.quotes.find((quote) => quote.id === previewQuoteId) || null,
    [previewQuoteId, workspaceForScope?.quotes]
  );
  const openClientRecord = useCallback(() => {
    const disclosure = recordDisclosureRef.current;
    if (!disclosure) {
      return {
        status: "recovery",
        reason: "The additional client history is not available in this view.",
        nextResolution: "Refresh this client overview, then try again."
      };
    }
    disclosure.open = true;
    window.requestAnimationFrame(() => {
      disclosure.scrollIntoView?.({ behavior: "smooth", block: "start" });
      disclosure.querySelector?.("summary")?.focus({ preventScroll: true });
    });
    return { status: "resolved" };
  }, []);

  const openWorkflowOrCloseout = useCallback((target) => {
    if (target?.attentionType !== "post_event_closeout") return onOpenWorkflow?.(target);
    const opportunity = !state.loading && !state.stale && !state.error
      ? resolveCustomerCloseoutTarget({ organizationId, workspace: workspaceForScope, radar: state.revenueRadar, target })
      : null;
    if (!opportunity) {
      return {
        status: "recovery",
        reason: "This event’s closeout is not available in the current client read.",
        nextResolution: "Refresh this client overview to load the exact event review."
      };
    }
    closeoutReturnRef.current = document.activeElement;
    setRevealedCloseout({ scopeKey: requestedScopeKey, quoteId: opportunity.quoteId });
    setActiveTab("overview");
    if (recordDisclosureRef.current) recordDisclosureRef.current.open = true;
    window.cancelAnimationFrame(closeoutFocusFrameRef.current);
    closeoutFocusFrameRef.current = window.requestAnimationFrame(() => {
      closeoutFocusFrameRef.current = window.requestAnimationFrame(() => {
        const root = headingRef.current?.closest("main");
        const heading = Array.from(root?.querySelectorAll("[data-closeout-review-heading]") || [])
          .find((node) => node.dataset.closeoutReviewHeading === opportunity.quoteId);
        heading?.focus({ preventScroll: true });
        heading?.scrollIntoView?.({ block: "start", behavior: "auto" });
      });
    });
    return { status: "resolved" };
  }, [headingRef, onOpenWorkflow, organizationId, requestedScopeKey, state, workspaceForScope]);

  const returnFromCloseout = useCallback(() => {
    const trigger = closeoutReturnRef.current;
    const target = trigger?.isConnected ? trigger : headingRef.current;
    target?.focus({ preventScroll: true });
    target?.scrollIntoView?.({ block: "center", behavior: "auto" });
    setRevealedCloseout(null);
  }, [headingRef]);

  useEffect(() => () => window.cancelAnimationFrame(closeoutFocusFrameRef.current), [requestedScopeKey]);

  const closePreview = useCallback(() => {
    setPreviewQuoteId("");
    const returnTarget = previewTriggerRef.current;
    window.requestAnimationFrame(() => returnTarget?.focus());
  }, []);

  useEffect(() => {
    setActiveTab("overview");
    setPreviewQuoteId("");
    previewTriggerRef.current = null;
  }, [customerId]);

  useEffect(() => {
    if (activeTab === "quotes") return;
    setPreviewQuoteId("");
    previewTriggerRef.current = null;
  }, [activeTab]);

  const handleTabKeyDown = (event, tabId) => {
    const nextId = resolveCustomerWorkspaceTabKey(tabId, event.key);
    if (nextId === tabId) return;
    event.preventDefault();
    setActiveTab(nextId);
    window.requestAnimationFrame(() => tabRefs.current[nextId]?.focus());
  };

  if (state.scopeKey !== requestedScopeKey || (state.loading && !workspaceForScope)) {
    return (
      <CustomerWorkspaceReadState
        state="loading"
        organizationName={organizationName}
        organizationId={organizationId}
      />
    );
  }
  if (state.error && !workspaceForScope) {
    return (
      <CustomerWorkspaceReadState
        state="error"
        organizationName={organizationName}
        organizationId={organizationId}
        source={state.source}
        loadedAt={state.loadedAt}
        errorMessage={state.error}
        onRetry={() => setRefreshToken((value) => value + 1)}
      />
    );
  }
  if (!workspaceForScope) {
    return (
      <CustomerWorkspaceReadState
        state="empty"
        organizationName={organizationName}
        organizationId={organizationId}
        source={state.source}
        loadedAt={state.loadedAt}
        onBack={onBack}
      />
    );
  }

  const workspace = workspaceForScope;
  const customer = workspace.customer;
  const supplementalPending = state.phase === "core";
  const supplementalError = state.phase === "core-error";
  const workspaceTruncated = workspace.quotePageInfo.truncated
    || workspace.versionPageInfo.truncatedQuoteIds.length > 0;
  const readOutcome = supplementalPending
    ? "The client record and linked opportunities are ready; retained proposal history and private controls are still loading."
    : supplementalError
      ? "The client record and linked opportunities are available, but retained proposal history or private controls did not finish loading."
      : state.loading
    ? "Refreshing client overview; the previous completed view remains visible."
    : state.error
      ? "The latest client overview refresh failed; the previous completed view remains visible."
      : workspaceTruncated
        ? "The customer record read completed within its declared quote or version bounds."
        : "The customer record, linked quote page, and retained version reads completed within their declared bounds.";
  const rootReadState = state.stale
    ? "stale"
    : state.loading
      ? "loading"
      : supplementalError
        ? "partial"
      : workspaceTruncated
        ? "partial"
        : "success";
  const ambientClientViewEnabled = ambientMode && Boolean(AmbientClientRelationshipHost);
  return (
    <main
      className="container workspace-route-main"
      aria-labelledby={ambientClientViewEnabled ? "ambient-client-overview-title" : "customer-workspace-title"}
      data-capability-state={rootReadState}
      data-client-profile-phase={state.phase}
    >
      <section className={`panel customer-workspace${ambientClientViewEnabled ? " ambient-client-host" : ""}`}>
        {ambientClientViewEnabled ? (
          <Suspense fallback={<div role="status">Loading client overview…</div>}>
            <AmbientClientRelationshipHost
              workspace={workspace}
              source={workspace.source}
              loadedAt={state.loadedAt}
              stale={state.stale}
              loading={state.loading}
              error={state.error}
              rebookingRadar={state.revenueRadar}
              currentUserRole={currentUserRole}
              tenantTimeZone={tenantTimeZone}
              headingRef={headingRef}
              onBack={onBack}
              onRefresh={() => setRefreshToken((value) => value + 1)}
              onOpenOpportunity={onOpenOpportunity}
              onOpenConversation={onOpenConversation}
              onOpenWorkflow={openWorkflowOrCloseout}
              onOpenClientRecord={openClientRecord}
              arrivalContext={arrivalContext}
              arrivalAttempted={arrivalAttempted}
              onArrivalResolution={onArrivalResolution}
            />
          </Suspense>
        ) : (
          <>
          <div className="workspace-route-head">
          <div>
            <button type="button" className="workspace-text-link" onClick={onBack}>Customers</button>
            <p className="eyebrow">Client overview</p>
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

          <StaffReadContextRail
          organizationName={organizationName}
          organizationId={organizationId}
          source={workspace.source}
          loadedAt={state.loadedAt}
          loading={state.loading}
          error={state.error}
          stale={state.stale}
          truncated={workspaceTruncated}
          truncationKnown
          readContract="Canonical customer record, up to 25 linked quotes, and up to 10 retained proposal versions per displayed quote"
          outcome={readOutcome}
          boundsNote="This client overview shows up to 25 linked quotes and 10 saved proposal versions per displayed quote; open Quotes for broader history."
          title="Client overview details"
          titleId="customer-workspace-read-context-title"
          caveat="Freshness describes these staff reads only. It does not establish proposal delivery, customer viewing or acceptance, booking, payment, or operational completion."
          />

          <CustomerRelationshipBriefing
          briefing={workspace.briefing || {
            activeQuoteCount: workspace.activeQuotes.length,
            displayedQuoteCount: workspace.quotes.length,
            attentionCount: workspace.attention.itemCount,
            nextEvent: workspace.events[0] || null,
            latestActivity: workspace.recentActivity[0] || null,
            nextAction: workspace.nextAction,
            scope: workspace.quotePageInfo
          }}
          onOpenQuote={onOpenQuote}
          onOpenWorkflow={openWorkflowOrCloseout}
          />
          </>
        )}

        <ClientRecordDisclosure ambientMode={ambientClientViewEnabled} disclosureRef={recordDisclosureRef}>
        {(supplementalPending || supplementalError) ? (
          <section
            className="customer-workspace-supplemental-state"
            data-capability-state={supplementalPending ? "loading" : "partial"}
          >
            <h2>Client history and controls</h2>
            {supplementalPending ? (
              <p role="status">
                Loading retained proposal history and private controls. The client overview above is ready to use.
              </p>
            ) : (
              <>
                <p role="alert" className="error-note">
                  Retained proposal history or private controls could not be loaded. The client record and linked opportunities remain available above.
                </p>
                <button type="button" className="ghost" onClick={() => setRefreshToken((value) => value + 1)}>
                  Retry client details
                </button>
              </>
            )}
          </section>
        ) : <>
        <div className="customer-workspace-tabs" role="tablist" aria-label="Customer workspace sections">
          {TABS.map(([id, label]) => (
            <button
              key={id}
              type="button"
              role="tab"
              ref={(node) => { tabRefs.current[id] = node; }}
              id={`customer-tab-${id}`}
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

        <section id="customer-panel-overview" role="tabpanel" aria-labelledby="customer-tab-overview" tabIndex={0} hidden={activeTab !== "overview"}>
          <CustomerRevenueOpportunities
            learningContext={{ enabled: postEventLearningEnabled && !state.loading && !state.stale && !state.revenueRadarError, inventoryEnabled: learningInventoryEnabled, quotes: workspace.quotes, versions: workspace.proposalVersions, onReview: onReviewLearning }}
            workflowScope={{ principalId: currentUserUid, role: currentUserRole, enabled: workflowEnabled, source: workspace.source }}
            radar={state.revenueRadar}
            focusedCloseoutQuoteId={revealedCloseout?.scopeKey === requestedScopeKey ? revealedCloseout.quoteId : ""}
            onReturnFromCloseout={returnFromCloseout}
            error={state.revenueRadarError}
            loading={state.loading}
            stale={state.stale}
            onOpenQuote={onOpenQuote}
            onOpenQuoteEdit={onOpenQuoteEdit}
            onCreateRebook={onCreateRebook}
            rebookCreationAvailable={workspace.source === "firebase"}
            closeoutReviewAvailable={workspace.source === "firebase"}
            onCloseoutReceipt={() => setRefreshToken((value) => value + 1)}
          />
          <RevenueAutopilotCustomerControls
            organizationId={organizationId}
            customerId={customer.customerId || customer.id}
            controls={customer.revenueAutopilotEmailControls}
            isAdmin={isAdmin}
            projectionStale={state.stale || state.loading}
            projectionError={customer.revenueAutopilotEmailControlsError}
            onRefresh={() => setRefreshToken((value) => value + 1)}
          />
          <CustomerCommercialMeasures
            workspace={workspace}
            loading={state.loading}
            error={state.error}
            stale={state.stale}
            onRetry={() => setRefreshToken((value) => value + 1)}
          />
          <CustomerCommercialTimeline workspace={workspace} onOpenQuote={onOpenQuote} />
        </section>

        <section id="customer-panel-quotes" role="tabpanel" aria-labelledby="customer-tab-quotes" tabIndex={0} hidden={activeTab !== "quotes"}>
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
                      <QuoteVersionComparison versions={versions} />
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

        <section id="customer-panel-events" role="tabpanel" aria-labelledby="customer-tab-events" tabIndex={0} hidden={activeTab !== "events"}>
          <CustomerEventsHeader scheduleAvailable={scheduleAvailable} onOpenSchedule={onOpenSchedule} />
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

        <section id="customer-panel-money" role="tabpanel" aria-labelledby="customer-tab-money" tabIndex={0} hidden={activeTab !== "money"}>
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

        <section id="customer-panel-conversations" role="tabpanel" aria-labelledby="customer-tab-conversations" tabIndex={0} hidden={activeTab !== "conversations"}>
          <h2>Conversations</h2>
          <p className="source-note">Messages remain bound to each quote. This overview links them without merging their histories.</p>
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
                <button
                  type="button"
                  className="ghost compact"
                  onClick={() => (onOpenConversation || onOpenQuote)?.(conversation.quoteId)}
                >
                  Open event conversation
                </button>
              </article>
            ))}
          </div>
        </section>
        </>}
        </ClientRecordDisclosure>
      </section>
    </main>
  );
}
