import { useEffect, useMemo, useRef, useState } from "react";
import {
  getQuoteHistory,
  requestQuoteApproval,
  resolveQuoteApprovalRequest,
  updateQuoteChangeRequestHandling,
  updateQuoteFollowUp
} from "../lib/quoteStore";
import {
  APPROVAL_ACTIONS,
  buildProposalReadiness,
  buildQuoteLifecycleTimeline,
  buildWorkflowAttentionSummary,
  FOLLOW_UP_STAGES,
  getApprovalActionEligibility,
  getApprovalRequestExecutionEligibility,
  getRequestableApprovalActions
} from "../lib/quoteWorkflow";
import { classifyQuoteStatus } from "../lib/statusSemantics";
import { useWorkspaceRouteHeadingFocus } from "../hooks/useWorkspaceRouteHeadingFocus";
import {
  formatWorkspaceDate,
  formatWorkspaceDateTime,
  formatWorkspaceSource,
  formatWorkspaceText,
  humanizeWorkspaceValue
} from "../lib/workspacePresentation";

const WORKFLOW_TABS = ["attention", "followups", "approvals"];
const PROVIDER_APPROVAL_ACTIONS = new Set([
  "send_payment_request",
  "send_final_balance_request"
]);

function fmtDateTime(value) {
  return formatWorkspaceDateTime(value);
}

function fmtDueDate(value) {
  return formatWorkspaceDate(value, { emptyLabel: "No due date" });
}

function todayIso() {
  const now = new Date();
  const year = now.getFullYear();
  const month = String(now.getMonth() + 1).padStart(2, "0");
  const day = String(now.getDate()).padStart(2, "0");
  return `${year}-${month}-${day}`;
}

function actionLabel(action) {
  return APPROVAL_ACTIONS.find((item) => item.id === action)?.label || action || "Sensitive action";
}

function approvalOutcomeLabel(request) {
  if (request?.state === "rejected") return "Rejected";
  const executionState = String(request?.executionState || "").trim().toLowerCase();
  if (executionState === "in_progress") return "Admin action in progress";
  if (executionState === "succeeded") return "Admin action completed";
  if (executionState === "failed") return "Admin action failed — new approval required";
  return "Approved, awaiting admin action";
}

function safeDomId(value) {
  return String(value || "item").replace(/[^a-zA-Z0-9_-]/g, "-");
}

function followUpFromQuote(quote) {
  const followUp = quote?.workflow?.followUp || {};
  return {
    stage: FOLLOW_UP_STAGES.some((item) => item.id === followUp.stage) ? followUp.stage : "new",
    dueDate: followUp.dueDate || "",
    note: followUp.note || "",
    completed: followUp.completed === true
  };
}

export function SalesWorkflowView({
  open,
  onClose,
  presentation = "embedded",
  onOpenQuoteHistory,
  onEditQuote,
  onAttentionSummaryChange,
  focusQuoteId = "",
  focusAttentionType = "",
  focusRequestId = "",
  organizationId = "",
  currentUserEmail = "",
  currentUserRole = "customer",
  onToast
}) {
  const embedded = presentation === "embedded";
  const [state, setState] = useState({
    loading: false,
    error: "",
    feedback: "",
    source: "",
    organizationId: "",
    quotes: []
  });
  const [activeTab, setActiveTab] = useState("attention");
  const [selectedQuoteId, setSelectedQuoteId] = useState("");
  const [followUpDraft, setFollowUpDraft] = useState(() => followUpFromQuote(null));
  const [approvalAction, setApprovalAction] = useState(APPROVAL_ACTIONS[0]?.id || "");
  const [approvalNote, setApprovalNote] = useState("");
  const [resolutionNotes, setResolutionNotes] = useState({});
  const [handlingNotes, setHandlingNotes] = useState({});
  const [busyKey, setBusyKey] = useState("");
  const dialogRef = useRef(null);
  const routeHeadingRef = useWorkspaceRouteHeadingFocus(Boolean(open && embedded));
  const detailHeadingRef = useRef(null);
  const attentionEmptyHeadingRef = useRef(null);
  const tabRefs = useRef({});
  const returnFocusRef = useRef(null);
  const skipReturnFocusRef = useRef(false);
  const tabInteractedRef = useRef(false);
  const loadGenerationRef = useRef(0);
  const workflowScopeRef = useRef("");
  const onCloseRef = useRef(onClose);
  workflowScopeRef.current = [organizationId, currentUserRole, currentUserEmail]
    .map((value) => String(value || "").trim().toLowerCase())
    .join(":");

  useEffect(() => {
    onCloseRef.current = onClose;
  }, [onClose]);

  const pushToast = (message, tone = "info") => {
    if (typeof onToast === "function") onToast(message, tone);
  };
  const reportSuccess = (message) => {
    setState((prev) => ({ ...prev, feedback: message }));
    pushToast(message, "success");
  };

  const load = async ({ selectDefaultTab = false } = {}) => {
    const loadOrganizationId = String(organizationId || "").trim();
    const loadScope = [organizationId, currentUserRole, currentUserEmail]
      .map((value) => String(value || "").trim().toLowerCase())
      .join(":");
    if (workflowScopeRef.current !== loadScope) return;
    const generation = loadGenerationRef.current + 1;
    loadGenerationRef.current = generation;
    setState((prev) => ({ ...prev, loading: true, error: "", feedback: "" }));
    try {
      const result = await getQuoteHistory({ organizationId });
      if (generation !== loadGenerationRef.current || workflowScopeRef.current !== loadScope) return;
      setState({
        loading: false,
        error: "",
        feedback: "",
        source: result.source,
        organizationId: loadOrganizationId,
        quotes: result.quotes
      });
      setSelectedQuoteId((current) => {
        if (focusQuoteId && result.quotes.some((item) => item.id === focusQuoteId)) return focusQuoteId;
        return result.quotes.some((item) => item.id === current) ? current : result.quotes[0]?.id || "";
      });
      if (selectDefaultTab && !tabInteractedRef.current) {
        setActiveTab(buildWorkflowAttentionSummary(result.quotes).quoteCount > 0 ? "attention" : "followups");
      }
    } catch (err) {
      if (generation !== loadGenerationRef.current || workflowScopeRef.current !== loadScope) return;
      setState((prev) => ({
        ...prev,
        loading: false,
        error: err?.message || "Failed to load sales workflow."
      }));
    }
  };

  useEffect(() => {
    if (!open) return;
    tabInteractedRef.current = false;
    skipReturnFocusRef.current = false;
    setState((prev) => ({
      ...prev,
      loading: false,
      error: "",
      feedback: "",
      source: "",
      organizationId: "",
      quotes: []
    }));
    setActiveTab("attention");
    setApprovalNote("");
    setResolutionNotes({});
    setHandlingNotes({});
    setBusyKey("");
    load({ selectDefaultTab: true });
  }, [focusQuoteId, open, organizationId]);

  useEffect(() => {
    if (!open || embedded) return undefined;
    returnFocusRef.current = document.activeElement;
    const previousBodyOverflow = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    const focusFrame = window.requestAnimationFrame(() => dialogRef.current?.focus());
    const handleDialogKeyDown = (event) => {
      if (event.key === "Escape") {
        event.preventDefault();
        onCloseRef.current?.();
        return;
      }
      if (event.key !== "Tab") return;
      const focusable = Array.from(dialogRef.current?.querySelectorAll(
        'a[href], button:not([disabled]), input:not([disabled]), select:not([disabled]), textarea:not([disabled]), [tabindex]:not([tabindex="-1"])'
      ) || []).filter((element) => element.getClientRects().length > 0);
      if (!focusable.length) {
        event.preventDefault();
        dialogRef.current?.focus();
        return;
      }
      const first = focusable[0];
      const last = focusable[focusable.length - 1];
      if (event.shiftKey && (document.activeElement === first || !dialogRef.current?.contains(document.activeElement))) {
        event.preventDefault();
        last.focus();
      } else if (!event.shiftKey && document.activeElement === last) {
        event.preventDefault();
        first.focus();
      }
    };
    document.addEventListener("keydown", handleDialogKeyDown);
    return () => {
      window.cancelAnimationFrame(focusFrame);
      document.removeEventListener("keydown", handleDialogKeyDown);
      document.body.style.overflow = previousBodyOverflow;
      const returnTarget = returnFocusRef.current;
      if (!skipReturnFocusRef.current && returnTarget?.isConnected) {
        window.requestAnimationFrame(() => returnTarget.focus());
      }
    };
  }, [embedded, open]);

  const selectedQuote = useMemo(
    () => state.quotes.find((item) => item.id === selectedQuoteId) || null,
    [state.quotes, selectedQuoteId]
  );

  useEffect(() => {
    setFollowUpDraft(followUpFromQuote(selectedQuote));
  }, [selectedQuote]);

  const quoteSummaries = useMemo(
    () => state.quotes
      .map((quote) => ({
        quote,
        readiness: buildProposalReadiness(quote),
        followUp: followUpFromQuote(quote)
      }))
      .sort((left, right) => {
        const leftDone = left.followUp.completed ? 1 : 0;
        const rightDone = right.followUp.completed ? 1 : 0;
        if (leftDone !== rightDone) return leftDone - rightDone;
        const leftDue = left.followUp.dueDate || "9999-12-31";
        const rightDue = right.followUp.dueDate || "9999-12-31";
        if (leftDue !== rightDue) return leftDue.localeCompare(rightDue);
        return String(right.quote.updatedAtISO || "").localeCompare(String(left.quote.updatedAtISO || ""));
      }),
    [state.quotes]
  );

  const approvalQueue = useMemo(
    () => state.quotes
      .flatMap((quote) => (
        Array.isArray(quote.workflow?.approvalRequests)
          ? quote.workflow.approvalRequests.map((request) => ({ quote, request }))
          : []
      ))
      .sort((left, right) => {
        const leftPending = left.request.state === "pending" ? 0 : 1;
        const rightPending = right.request.state === "pending" ? 0 : 1;
        if (leftPending !== rightPending) return leftPending - rightPending;
        return String(right.request.requestedAtISO || "").localeCompare(String(left.request.requestedAtISO || ""));
      }),
    [state.quotes]
  );

  const attentionSummary = useMemo(
    () => buildWorkflowAttentionSummary(state.quotes),
    [state.quotes]
  );

  useEffect(() => {
    if (!open || state.loading || !focusQuoteId) return undefined;
    setSelectedQuoteId((current) => (
      state.quotes.some((quote) => quote.id === focusQuoteId) ? focusQuoteId : current
    ));
    const attentionItem = attentionSummary.items.find((item) => (
      item.quoteId === focusQuoteId
      && (!focusAttentionType || item.type === focusAttentionType)
      && (
        !focusRequestId
        || item.sourceRequestId === focusRequestId
        || item.pendingRequests?.some((request) => request.id === focusRequestId)
      )
    ));
    if (!attentionItem) return undefined;
    setActiveTab("attention");
    const frame = window.requestAnimationFrame(() => {
      const row = Array.from(dialogRef.current?.querySelectorAll("[data-attention-id]") || [])
        .find((element) => element.dataset.attentionId === attentionItem.id);
      row?.scrollIntoView({ behavior: "smooth", block: "center" });
      row?.focus({ preventScroll: true });
    });
    return () => window.cancelAnimationFrame(frame);
  }, [
    attentionSummary.items,
    focusAttentionType,
    focusQuoteId,
    focusRequestId,
    open,
    state.loading,
    state.quotes
  ]);

  useEffect(() => {
    if (
      !open
      || state.loading
      || state.organizationId !== String(organizationId || "").trim()
      || typeof onAttentionSummaryChange !== "function"
    ) return;
    onAttentionSummaryChange({
      ...attentionSummary,
      organizationId: state.organizationId
    });
  }, [
    attentionSummary.itemCount,
    attentionSummary.quoteCount,
    open,
    onAttentionSummaryChange,
    organizationId,
    state.loading,
    state.organizationId
  ]);

  const metrics = useMemo(() => {
    return {
      active: state.quotes.filter((quote) => ["draft", "sent", "viewed", "accepted"].includes(quote.status)).length,
      needsReadiness: quoteSummaries.filter((item) => item.readiness.score < 100).length,
      due: attentionSummary.counts.followUps,
      pendingApprovals: approvalQueue.filter((item) => item.request.state === "pending").length
    };
  }, [state.quotes, quoteSummaries, approvalQueue, attentionSummary.counts.followUps]);

  const readiness = selectedQuote ? buildProposalReadiness(selectedQuote) : null;
  const timeline = selectedQuote ? buildQuoteLifecycleTimeline(selectedQuote) : [];
  const requestableApprovalActions = useMemo(
    () => getRequestableApprovalActions(selectedQuote || {}, {
      requireActivePortal: state.source === "firebase"
    }).filter((action) => (
      state.source === "firebase" || !PROVIDER_APPROVAL_ACTIONS.has(action.id)
    )),
    [selectedQuote, state.source]
  );
  const isAdmin = String(currentUserRole || "").toLowerCase() === "admin";
  const isStaff = ["admin", "sales"].includes(String(currentUserRole || "").toLowerCase());

  useEffect(() => {
    setApprovalAction((current) => (
      requestableApprovalActions.some((item) => item.id === current)
        ? current
        : requestableApprovalActions[0]?.id || ""
    ));
  }, [requestableApprovalActions]);

  const selectTab = (tabId, { focus = false } = {}) => {
    tabInteractedRef.current = true;
    setActiveTab(tabId);
    if (focus) {
      window.requestAnimationFrame(() => tabRefs.current[tabId]?.focus());
    }
  };

  const handleTabKeyDown = (event, tabId) => {
    const currentIndex = WORKFLOW_TABS.indexOf(tabId);
    let nextIndex = currentIndex;
    if (event.key === "ArrowRight") nextIndex = (currentIndex + 1) % WORKFLOW_TABS.length;
    if (event.key === "ArrowLeft") nextIndex = (currentIndex - 1 + WORKFLOW_TABS.length) % WORKFLOW_TABS.length;
    if (event.key === "Home") nextIndex = 0;
    if (event.key === "End") nextIndex = WORKFLOW_TABS.length - 1;
    if (nextIndex === currentIndex) return;
    event.preventDefault();
    const nextTab = WORKFLOW_TABS[nextIndex];
    selectTab(nextTab, { focus: true });
  };

  const applyQuoteLocally = (quoteId, updater) => {
    setState((prev) => ({
      ...prev,
      quotes: prev.quotes.map((quote) => (quote.id === quoteId ? updater(quote) : quote))
    }));
  };

  const handleSaveFollowUp = async () => {
    if (!selectedQuote?.id || !isStaff) return;
    const actionScope = workflowScopeRef.current;
    const actionBusyKey = `followup:${selectedQuote.id}`;
    setBusyKey(actionBusyKey);
    setState((prev) => ({ ...prev, error: "", feedback: "" }));
    try {
      const result = await updateQuoteFollowUp({
        quoteId: selectedQuote.id,
        ...followUpDraft,
        actorEmail: currentUserEmail
      });
      if (workflowScopeRef.current !== actionScope) return;
      applyQuoteLocally(selectedQuote.id, (quote) => ({
        ...quote,
        workflow: {
          ...(quote.workflow || {}),
          followUp: result.followUp,
          approvalRequests: quote.workflow?.approvalRequests || []
        }
      }));
      reportSuccess(`Follow-up saved for ${selectedQuote.quoteNumber}.`);
    } catch (err) {
      if (workflowScopeRef.current !== actionScope) return;
      setState((prev) => ({ ...prev, error: err?.message || "Failed to save follow-up." }));
    } finally {
      if (workflowScopeRef.current === actionScope) {
        setBusyKey((current) => (current === actionBusyKey ? "" : current));
      }
    }
  };

  const handleRequestApproval = async () => {
    if (!selectedQuote?.id || !isStaff || !approvalAction) return;
    if (state.source !== "firebase" && PROVIDER_APPROVAL_ACTIONS.has(approvalAction)) {
      setState((prev) => ({
        ...prev,
        error: "Payment approvals require Firebase-backed provider execution. Reload the hosted workspace and try again."
      }));
      return;
    }
    const eligibility = getApprovalActionEligibility(selectedQuote, approvalAction, {
      requireActivePortal: state.source === "firebase"
    });
    if (!eligibility.eligible) {
      setState((prev) => ({
        ...prev,
        error: eligibility.reason || "This action is no longer available for the selected quote."
      }));
      return;
    }
    const actionScope = workflowScopeRef.current;
    const actionBusyKey = `request:${selectedQuote.id}`;
    setBusyKey(actionBusyKey);
    setState((prev) => ({ ...prev, error: "", feedback: "" }));
    try {
      const result = await requestQuoteApproval({
        quoteId: selectedQuote.id,
        action: approvalAction,
        note: approvalNote,
        actorEmail: currentUserEmail,
        actorRole: currentUserRole
      });
      if (workflowScopeRef.current !== actionScope) return;
      applyQuoteLocally(selectedQuote.id, (quote) => ({
        ...quote,
        workflow: {
          ...(quote.workflow || {}),
          followUp: quote.workflow?.followUp || followUpFromQuote(quote),
          approvalRequests: [...(quote.workflow?.approvalRequests || []), result.request]
        }
      }));
      setApprovalNote("");
      reportSuccess(`${actionLabel(approvalAction)} approval requested.`);
    } catch (err) {
      if (workflowScopeRef.current !== actionScope) return;
      setState((prev) => ({ ...prev, error: err?.message || "Failed to request approval." }));
    } finally {
      if (workflowScopeRef.current === actionScope) {
        setBusyKey((current) => (current === actionBusyKey ? "" : current));
      }
    }
  };

  const handleResolveApproval = async (quoteId, requestId, nextState) => {
    if (!isAdmin) return;
    const actionScope = workflowScopeRef.current;
    const actionBusyKey = `resolve:${requestId}:${nextState}`;
    setBusyKey(actionBusyKey);
    setState((prev) => ({ ...prev, error: "", feedback: "" }));
    try {
      const result = await resolveQuoteApprovalRequest({
        quoteId,
        requestId,
        state: nextState,
        resolutionNote: resolutionNotes[requestId] || "",
        actorEmail: currentUserEmail,
        actorRole: currentUserRole
      });
      if (workflowScopeRef.current !== actionScope) return;
      applyQuoteLocally(quoteId, (quote) => ({
        ...quote,
        workflow: {
          ...(quote.workflow || {}),
          approvalRequests: (quote.workflow?.approvalRequests || []).map((item) => (
            item.id === requestId ? result.request : item
          ))
        }
      }));
      setResolutionNotes((prev) => ({ ...prev, [requestId]: "" }));
      reportSuccess(`Approval request ${nextState}.`);
      window.requestAnimationFrame(() => {
        window.requestAnimationFrame(() => {
          const resolvedRow = Array.from(dialogRef.current?.querySelectorAll(".approval-row") || [])
            .find((element) => element.dataset.requestId === requestId);
          (resolvedRow || tabRefs.current.approvals)?.focus();
        });
      });
    } catch (err) {
      if (workflowScopeRef.current !== actionScope) return;
      setState((prev) => ({ ...prev, error: err?.message || "Failed to resolve approval." }));
    } finally {
      if (workflowScopeRef.current === actionScope) {
        setBusyKey((current) => (current === actionBusyKey ? "" : current));
      }
    }
  };

  const handleReviewFollowUp = (quoteId) => {
    setSelectedQuoteId(quoteId);
    selectTab("followups");
    window.requestAnimationFrame(() => {
      window.requestAnimationFrame(() => detailHeadingRef.current?.focus());
    });
  };

  const handleReviewApprovals = (quoteId) => {
    selectTab("approvals");
    window.requestAnimationFrame(() => {
      window.requestAnimationFrame(() => {
        const quoteApproval = Array.from(dialogRef.current?.querySelectorAll(".approval-row") || [])
          .find((element) => element.dataset.quoteId === quoteId && element.dataset.pending === "true");
        (quoteApproval || tabRefs.current.approvals)?.focus();
      });
    });
  };

  const handleEditQuote = (quote) => {
    skipReturnFocusRef.current = true;
    onEditQuote?.(quote);
  };

  const handleOpenQuoteHistory = (quote, request) => {
    skipReturnFocusRef.current = true;
    onOpenQuoteHistory?.({
      quoteId: quote?.id || "",
      action: request?.action || ""
    });
  };

  const focusAttentionItem = (candidateIds = []) => {
    window.requestAnimationFrame(() => {
      window.requestAnimationFrame(() => {
        const rows = Array.from(dialogRef.current?.querySelectorAll(".workflow-attention-row") || []);
        const target = candidateIds
          .map((candidateId) => rows.find((row) => row.dataset.attentionId === candidateId))
          .find(Boolean);
        (target || attentionEmptyHeadingRef.current || tabRefs.current.attention)?.focus();
      });
    });
  };

  const handleChangeRequestAction = async (item, action) => {
    if (!isStaff || !item?.quoteId || item.unhandleable) return;
    const actionScope = workflowScopeRef.current;
    const note = handlingNotes[item.id] || "";
    const busyId = `change-request:${item.quoteId}:${action}`;
    const itemIndex = attentionSummary.items.findIndex((candidate) => candidate.id === item.id);
    const nextItemId = attentionSummary.items[itemIndex + 1]?.id || "";
    const previousItemId = attentionSummary.items[itemIndex - 1]?.id || "";
    setBusyKey(busyId);
    setState((prev) => ({ ...prev, error: "", feedback: "" }));
    try {
      const result = await updateQuoteChangeRequestHandling({
        organizationId,
        quoteId: item.quoteId,
        sourceRequestId: item.sourceRequestId,
        sourceSubmittedAtISO: item.sourceSubmittedAtISO,
        sourceMessage: item.sourceMessage,
        action,
        note,
        actorEmail: currentUserEmail,
        actorRole: currentUserRole
      });
      if (workflowScopeRef.current !== actionScope) return;
      applyQuoteLocally(item.quoteId, (quote) => ({
        ...quote,
        workflow: {
          ...(quote.workflow || {}),
          changeRequestHandling: result.handling
        }
      }));
      if (action === "mark_handled") {
        setHandlingNotes((prev) => ({ ...prev, [item.id]: "" }));
      }
      reportSuccess(action === "mark_handled"
        ? "Change request marked handled internally. No customer message was sent."
        : "Change request acknowledged internally. No customer message was sent.");
      focusAttentionItem(action === "mark_handled"
        ? [nextItemId, previousItemId].filter(Boolean)
        : [item.id]);
    } catch (err) {
      if (workflowScopeRef.current !== actionScope) return;
      if (err?.code === "workflow/stale-change-request") {
        await load();
      }
      if (workflowScopeRef.current !== actionScope) return;
      setState((prev) => ({
        ...prev,
        error: err?.message || "Failed to update change request handling."
      }));
    } finally {
      if (workflowScopeRef.current === actionScope) {
        setBusyKey((current) => (current === busyId ? "" : current));
      }
    }
  };

  if (!open) return null;

  return (
    <div
      className={embedded ? "container workspace-route-main embedded-workspace-route" : "modal-overlay"}
      role={embedded ? "region" : "dialog"}
      aria-modal={embedded ? undefined : "true"}
      aria-labelledby="sales-workflow-title"
    >
      <div
        className={`modal-card sales-workflow-card${embedded ? " workspace-route-card" : ""}`}
        ref={dialogRef}
        tabIndex={-1}
        aria-busy={state.loading}
      >
        <div className="modal-head">
          <div>
            <h2
              ref={routeHeadingRef}
              id="sales-workflow-title"
              className={embedded ? "workspace-route-heading" : undefined}
              tabIndex={embedded ? -1 : undefined}
            >
              Workflow
            </h2>
            <p className="source-note">Source: {formatWorkspaceSource(state.source)}</p>
          </div>
          <div className="right-actions">
            <button type="button" className="ghost" onClick={load} disabled={state.loading}>
              {state.loading ? "Refreshing..." : "Refresh"}
            </button>
            <button type="button" className="ghost" onClick={onClose}>
              {embedded ? "Back to Home" : "Close"}
            </button>
          </div>
        </div>

        <p className="visually-hidden" role="status" aria-live="polite">
          {state.loading ? "Loading sales workflow." : ""}
        </p>
        {state.error && <p className="error-note" role="alert">{state.error}</p>}
        {state.feedback && <p className="source-note">{state.feedback}</p>}

        <div className="workflow-metrics" aria-label="Sales workflow summary">
          <div><span>Active opportunities</span><strong>{metrics.active}</strong></div>
          <div><span>Readiness gaps</span><strong>{metrics.needsReadiness}</strong></div>
          <div><span>Follow-ups due</span><strong>{metrics.due}</strong></div>
          <div><span>Pending approvals</span><strong>{metrics.pendingApprovals}</strong></div>
        </div>

        <div className="workflow-tabs" role="tablist" aria-label="Sales workflow views">
          <button
            type="button"
            role="tab"
            id="workflow-tab-attention"
            aria-controls="workflow-panel-attention"
            tabIndex={activeTab === "attention" ? 0 : -1}
            ref={(node) => { tabRefs.current.attention = node; }}
            onKeyDown={(event) => handleTabKeyDown(event, "attention")}
            aria-selected={activeTab === "attention"}
            className={activeTab === "attention" ? "active" : ""}
            onClick={() => selectTab("attention")}
          >
            Attention ({attentionSummary.quoteCount})
          </button>
          <button
            type="button"
            role="tab"
            id="workflow-tab-followups"
            aria-controls="workflow-panel-followups"
            tabIndex={activeTab === "followups" ? 0 : -1}
            ref={(node) => { tabRefs.current.followups = node; }}
            onKeyDown={(event) => handleTabKeyDown(event, "followups")}
            aria-selected={activeTab === "followups"}
            className={activeTab === "followups" ? "active" : ""}
            onClick={() => selectTab("followups")}
          >
            Follow-ups
          </button>
          <button
            type="button"
            role="tab"
            id="workflow-tab-approvals"
            aria-controls="workflow-panel-approvals"
            tabIndex={activeTab === "approvals" ? 0 : -1}
            ref={(node) => { tabRefs.current.approvals = node; }}
            onKeyDown={(event) => handleTabKeyDown(event, "approvals")}
            aria-selected={activeTab === "approvals"}
            className={activeTab === "approvals" ? "active" : ""}
            onClick={() => selectTab("approvals")}
          >
            Approvals ({metrics.pendingApprovals})
          </button>
        </div>

        <section
          className="workflow-attention-panel"
          role="tabpanel"
          id="workflow-panel-attention"
          aria-labelledby="workflow-tab-attention"
          tabIndex={0}
          hidden={activeTab !== "attention"}
        >
            <p className="workflow-attention-boundary">
              This is an in-app queue. Acknowledging or marking work handled does not edit a quote or send email or SMS.
            </p>
            {attentionSummary.items.length === 0 && !state.loading && (
              <div className="workflow-attention-empty">
                <h3 ref={attentionEmptyHeadingRef} tabIndex={-1}>No workflow attention needed</h3>
                <p>Due follow-ups, customer change requests, and pending approvals will appear here.</p>
              </div>
            )}
            <ol className="workflow-attention-list" aria-label="Quotes needing workflow attention">
              {attentionSummary.items.map((item) => {
                const quote = item.quote;
                const customerLabel = quote.customer?.name || quote.customer?.email || "Customer";
                const quoteLabel = formatWorkspaceText(quote.quoteNumber, { emptyLabel: "Quote number pending" });
                const acknowledgeBusyKey = `change-request:${item.quoteId}:acknowledge`;
                const handleBusyKey = `change-request:${item.quoteId}:mark_handled`;
                const acknowledging = busyKey === acknowledgeBusyKey;
                const markingHandled = busyKey === handleBusyKey;
                const itemBusy = acknowledging || markingHandled;
                const handlingNote = handlingNotes[item.id] || "";
                const itemDomId = `workflow-attention-${safeDomId(item.id)}`;
                return (
                  <li key={item.id}>
                    <article
                      className={`workflow-attention-row attention-${item.type} state-${item.state}`}
                      tabIndex={-1}
                      data-attention-id={item.id}
                      aria-labelledby={`${itemDomId}-priority ${itemDomId}-quote`}
                    >
                      <div className="workflow-attention-head">
                        <div>
                          <span className="workflow-attention-priority" id={`${itemDomId}-priority`}>
                            {item.type === "change_request"
                              ? item.state === "acknowledged"
                                ? "Acknowledged change request"
                                : item.state === "invalid"
                                  ? "Change request data issue"
                                  : "New customer change request"
                              : item.type === "follow_up"
                                ? item.state === "overdue"
                                  ? `Overdue follow-up${item.daysOverdue ? ` · ${item.daysOverdue}d` : ""}`
                                  : "Follow-up due today"
                                : `${item.pendingRequests.length} pending approval${item.pendingRequests.length === 1 ? "" : "s"}`}
                          </span>
                          <h3 id={`${itemDomId}-quote`}>{quoteLabel}</h3>
                          <p>{customerLabel}</p>
                        </div>
                        <time dateTime={item.dateISO}>{item.type === "follow_up" ? fmtDueDate(item.dateISO) : fmtDateTime(item.dateISO)}</time>
                      </div>

                      {item.type === "change_request" && (
                        <>
                          <p className="workflow-attention-message">
                            {quote.portalDecision?.message || "The customer request has no readable message."}
                          </p>
                          {item.unhandleable ? (
                            <p className="error-note">
                              This request is missing valid identity or message evidence. Review the quote data before taking action.
                            </p>
                          ) : (
                            <label className="field workflow-handling-note">
                              <span>Internal handling note (required to mark handled)</span>
                              <textarea
                                rows="2"
                                maxLength="800"
                                aria-label={`Internal handling note (required to mark handled) — ${quoteLabel}`}
                                value={handlingNote}
                                placeholder="What was changed or how was the request addressed?"
                                onChange={(event) => setHandlingNotes((prev) => ({
                                  ...prev,
                                  [item.id]: event.target.value
                                }))}
                              />
                            </label>
                          )}
                          <div className="workflow-attention-actions">
                            {!item.unhandleable && item.state === "new" && (
                              <button
                                type="button"
                                className="ghost compact"
                                onClick={() => handleChangeRequestAction(item, "acknowledge")}
                                disabled={itemBusy}
                                aria-label={acknowledging
                                  ? `Saving... acknowledgment — ${quoteLabel}`
                                  : `Acknowledge internally — ${quoteLabel}`}
                                aria-busy={acknowledging}
                              >
                                {acknowledging ? "Saving..." : "Acknowledge internally"}
                              </button>
                            )}
                            {!item.unhandleable && (
                              <button
                                type="button"
                                className="cta compact"
                                onClick={() => handleChangeRequestAction(item, "mark_handled")}
                                disabled={itemBusy || !handlingNote.trim()}
                                aria-label={markingHandled
                                  ? `Saving... handled state — ${quoteLabel}`
                                  : `Mark handled internally — ${quoteLabel}`}
                                aria-busy={markingHandled}
                              >
                                {markingHandled ? "Saving..." : "Mark handled internally"}
                              </button>
                            )}
                            {typeof onEditQuote === "function" && (
                              <button
                                type="button"
                                className="ghost compact"
                                onClick={() => handleEditQuote(quote)}
                                aria-label={`Edit quote — ${quoteLabel}`}
                              >
                                Edit quote
                              </button>
                            )}
                          </div>
                        </>
                      )}

                      {item.type === "follow_up" && (
                        <div className="workflow-attention-actions">
                          <button
                            type="button"
                            className="ghost compact"
                            onClick={() => handleReviewFollowUp(item.quoteId)}
                            aria-label={`Review follow-up for ${quoteLabel}`}
                          >
                            Review follow-up
                          </button>
                        </div>
                      )}

                      {item.type === "approval" && (
                        <div className="workflow-attention-actions">
                          <button
                            type="button"
                            className="ghost compact"
                            onClick={() => handleReviewApprovals(item.quoteId)}
                            aria-label={`Review approvals for ${quoteLabel}`}
                          >
                            Review approvals
                          </button>
                        </div>
                      )}
                    </article>
                  </li>
                );
              })}
            </ol>
        </section>

        <div
          className="sales-workflow-layout"
          role="tabpanel"
          id="workflow-panel-followups"
          aria-labelledby="workflow-tab-followups"
          tabIndex={0}
          hidden={activeTab !== "followups"}
        >
            <section className="workflow-quote-list" aria-label="Quotes and follow-ups">
              {quoteSummaries.length === 0 && !state.loading && <p className="muted">No quotes saved yet.</p>}
              {quoteSummaries.map(({ quote, readiness: itemReadiness, followUp }) => {
                const overdue = !followUp.completed && followUp.dueDate && followUp.dueDate <= todayIso();
                return (
                  <button
                    type="button"
                    key={quote.id}
                    className={`workflow-quote-row ${quote.id === selectedQuoteId ? "selected" : ""}`.trim()}
                    onClick={() => setSelectedQuoteId(quote.id)}
                  >
                    <span>
                      <strong>{formatWorkspaceText(quote.quoteNumber, { emptyLabel: "Quote number pending" })}</strong>
                      <small>{quote.customer?.name || quote.customer?.email || "Customer"}</small>
                    </span>
                    <span className="workflow-quote-meta">
                      <em className={`readiness-tone-${itemReadiness.status.id}`}>{itemReadiness.score}%</em>
                      <small className={overdue ? "overdue" : ""}>
                        {followUp.completed ? "Complete" : fmtDueDate(followUp.dueDate)}
                      </small>
                    </span>
                  </button>
                );
              })}
            </section>

            <section className="workflow-detail">
              {!selectedQuote && <p className="muted">Select a quote to manage its workflow.</p>}
              {selectedQuote && readiness && (
                <>
                  <header
                    className="workflow-detail-head"
                    ref={detailHeadingRef}
                    tabIndex={-1}
                    aria-labelledby={`workflow-detail-${safeDomId(selectedQuote.id)}-quote workflow-detail-${safeDomId(selectedQuote.id)}-customer`}
                  >
                    <div>
                      <p className="eyebrow" id={`workflow-detail-${safeDomId(selectedQuote.id)}-quote`}>
                        {formatWorkspaceText(selectedQuote.quoteNumber, { emptyLabel: "Quote number pending" })}
                      </p>
                      <h3 id={`workflow-detail-${safeDomId(selectedQuote.id)}-customer`}>
                        {selectedQuote.customer?.name || selectedQuote.customer?.email || "Customer"}
                      </h3>
                    </div>
                    <span className={`status-badge status-${selectedQuote.status || "draft"}`}>
                      {classifyQuoteStatus(selectedQuote.status || "draft").label}
                    </span>
                  </header>

                  <section className={`readiness-panel readiness-${readiness.status.id}`}>
                    <div className="readiness-head">
                      <div>
                        <span>Proposal readiness</span>
                        <strong>{readiness.score}%</strong>
                      </div>
                      <em>{readiness.status.label}</em>
                    </div>
                    <progress max="100" value={readiness.score}>{readiness.score}%</progress>
                    {readiness.gaps.length > 0 && (
                      <div className="readiness-gaps">
                        {readiness.gaps.map((item) => <span key={item.id}>{item.label}</span>)}
                      </div>
                    )}
                  </section>

                  <section className="workflow-form-section">
                    <h4>Next follow-up</h4>
                    <div className="workflow-form-grid">
                      <label className="field">
                        <span>Stage</span>
                        <select
                          value={followUpDraft.stage}
                          onChange={(event) => setFollowUpDraft((prev) => ({ ...prev, stage: event.target.value }))}
                        >
                          {FOLLOW_UP_STAGES.map((item) => (
                            <option key={item.id} value={item.id}>{item.label}</option>
                          ))}
                        </select>
                      </label>
                      <label className="field">
                        <span>Due date</span>
                        <input
                          type="date"
                          value={followUpDraft.dueDate}
                          onChange={(event) => setFollowUpDraft((prev) => ({ ...prev, dueDate: event.target.value }))}
                        />
                      </label>
                      <label className="workflow-complete-toggle">
                        <input
                          type="checkbox"
                          checked={followUpDraft.completed}
                          onChange={(event) => setFollowUpDraft((prev) => ({ ...prev, completed: event.target.checked }))}
                        />
                        <span>Follow-up complete</span>
                      </label>
                      <label className="field workflow-note-field">
                        <span>Note</span>
                        <textarea
                          rows="3"
                          maxLength="1200"
                          value={followUpDraft.note}
                          onChange={(event) => setFollowUpDraft((prev) => ({ ...prev, note: event.target.value }))}
                        />
                      </label>
                    </div>
                    <div className="right-actions">
                      <button
                        type="button"
                        className="cta compact"
                        onClick={handleSaveFollowUp}
                        disabled={busyKey === `followup:${selectedQuote.id}`}
                      >
                        {busyKey === `followup:${selectedQuote.id}` ? "Saving..." : "Save Follow-up"}
                      </button>
                    </div>
                  </section>

                  {isStaff && requestableApprovalActions.length > 0 && (
                    <section className="workflow-form-section">
                      <h4>Request sensitive action approval</h4>
                      <div className="workflow-approval-request">
                        <select value={approvalAction} onChange={(event) => setApprovalAction(event.target.value)}>
                          {requestableApprovalActions.map((item) => (
                            <option key={item.id} value={item.id}>{item.label}</option>
                          ))}
                        </select>
                        <input
                          type="text"
                          maxLength="800"
                          placeholder="Reason or customer context"
                          value={approvalNote}
                          onChange={(event) => setApprovalNote(event.target.value)}
                        />
                        <button
                          type="button"
                          className="ghost compact"
                          onClick={handleRequestApproval}
                          disabled={!approvalAction || busyKey === `request:${selectedQuote.id}`}
                        >
                          {busyKey === `request:${selectedQuote.id}` ? "Requesting..." : "Request"}
                        </button>
                      </div>
                    </section>
                  )}
                  {isStaff && requestableApprovalActions.length === 0 && (
                    <section className="workflow-form-section">
                      <h4>Sensitive action approval</h4>
                      <p className="muted">No approval-backed action is currently available for this quote.</p>
                    </section>
                  )}

                  <section className="workflow-timeline-section">
                    <h4>Lifecycle timeline</h4>
                    <ol className="workflow-timeline">
                      {timeline.map((item) => (
                        <li key={item.id} className={`timeline-${item.tone || "default"}`}>
                          <span aria-hidden="true" />
                          <div>
                            <strong>{item.label}</strong>
                            <p>{item.detail}</p>
                            <time dateTime={item.atISO}>{fmtDateTime(item.atISO)}</time>
                          </div>
                        </li>
                      ))}
                    </ol>
                  </section>
                </>
              )}
            </section>
        </div>

        <section
          className="approval-queue"
          aria-label="Sensitive action approval queue"
          role="tabpanel"
          id="workflow-panel-approvals"
          aria-labelledby="workflow-tab-approvals"
          tabIndex={0}
          hidden={activeTab !== "approvals"}
        >
            {approvalQueue.length === 0 && !state.loading && (
              <p className="muted">No approval requests yet.</p>
            )}
            {approvalQueue.map(({ quote, request }) => {
              const approvalDomId = `workflow-approval-${safeDomId(quote.id)}-${safeDomId(request.id)}`;
              const quoteLabel = formatWorkspaceText(quote.quoteNumber, { emptyLabel: "Quote number pending" });
              const resolvingApproval = busyKey === `resolve:${request.id}:approved`;
              const resolvingRejection = busyKey === `resolve:${request.id}:rejected`;
              const requestResolving = resolvingApproval || resolvingRejection;
              const awaitingExecution = request.state === "approved"
                && (!request.executionState || request.executionState === "awaiting_execution")
                && APPROVAL_ACTIONS.some((action) => action.id === request.action);
              const executionEligibility = awaitingExecution
                ? getApprovalRequestExecutionEligibility(quote, request, {
                  requireActivePortal: state.source === "firebase"
                })
                : null;
              return (
              <article
                key={`${quote.id}-${request.id}`}
                className={`approval-row state-${request.state}`}
                tabIndex={-1}
                data-quote-id={quote.id}
                data-request-id={request.id}
                data-pending={request.state === "pending"}
                aria-labelledby={`${approvalDomId}-action ${approvalDomId}-quote`}
              >
                <div className="approval-row-main">
                  <div>
                    <span className="approval-state">{humanizeWorkspaceValue(request.state)}</span>
                    <h3 id={`${approvalDomId}-action`}>{actionLabel(request.action)}</h3>
                    <p id={`${approvalDomId}-quote`}>{quoteLabel} · {quote.customer?.name || quote.customer?.email || "Customer"}</p>
                  </div>
                  <div className="approval-audit">
                    <span>Requested by {request.requestedByEmail || "staff"}</span>
                    <time dateTime={request.requestedAtISO}>{fmtDateTime(request.requestedAtISO)}</time>
                  </div>
                </div>
                {request.note && <p className="approval-note">{request.note}</p>}
                {request.state === "pending" && isAdmin && (
                  <div className="approval-resolution">
                    <input
                      type="text"
                      maxLength="800"
                      placeholder="Resolution note"
                      aria-label={`Resolution note for ${actionLabel(request.action)} on ${quoteLabel}`}
                      value={resolutionNotes[request.id] || ""}
                      onChange={(event) => setResolutionNotes((prev) => ({
                        ...prev,
                        [request.id]: event.target.value
                      }))}
                    />
                    <button
                      type="button"
                      className="cta compact"
                      onClick={() => handleResolveApproval(quote.id, request.id, "approved")}
                      disabled={requestResolving}
                      aria-label={resolvingApproval
                        ? `Approving... ${actionLabel(request.action)} for ${quoteLabel}`
                        : `Approve ${actionLabel(request.action)} for ${quoteLabel}`}
                      aria-busy={resolvingApproval}
                    >
                      {resolvingApproval ? "Approving..." : "Approve"}
                    </button>
                    <button
                      type="button"
                      className="ghost compact"
                      onClick={() => handleResolveApproval(quote.id, request.id, "rejected")}
                      disabled={requestResolving}
                      aria-label={resolvingRejection
                        ? `Rejecting... ${actionLabel(request.action)} for ${quoteLabel}`
                        : `Reject ${actionLabel(request.action)} for ${quoteLabel}`}
                      aria-busy={resolvingRejection}
                    >
                      {resolvingRejection ? "Rejecting..." : "Reject"}
                    </button>
                  </div>
                )}
                {request.state !== "pending" && (
                  <div className="approval-resolution-summary">
                    <strong>{approvalOutcomeLabel(request)}</strong>
                    <span>{request.resolutionNote || "No resolution note."}</span>
                    <small>{request.resolvedByEmail || "admin"} · {fmtDateTime(request.resolvedAtISO)}</small>
                    {request.executionState && (
                      <small>
                        {request.executedByEmail || "admin"}
                        {request.executionCompletedAtISO
                          ? ` · ${fmtDateTime(request.executionCompletedAtISO)}`
                          : request.executionStartedAtISO
                            ? ` · started ${fmtDateTime(request.executionStartedAtISO)}`
                            : ""}
                      </small>
                    )}
                    {request.executionReference && <span>{request.executionReference}</span>}
                    {request.executionError && <span>{request.executionError}</span>}
                    {isAdmin && awaitingExecution && (
                      executionEligibility?.eligible ? (
                        <button
                          type="button"
                          className="cta compact"
                          onClick={() => handleOpenQuoteHistory(quote, request)}
                        >
                          Execute in Quotes
                        </button>
                      ) : (
                        <p className="muted approval-not-executable" role="status">
                          No longer executable: {executionEligibility?.reason || "the quote changed after approval."}
                        </p>
                      )
                    )}
                  </div>
                )}
              </article>
              );
            })}
        </section>
      </div>
    </div>
  );
}

export default function SalesWorkflowModal(props) {
  return <SalesWorkflowView {...props} presentation="modal" />;
}
