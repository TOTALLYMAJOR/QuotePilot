import { useEffect, useMemo, useState } from "react";
import {
  getQuoteHistory,
  requestQuoteApproval,
  resolveQuoteApprovalRequest,
  updateQuoteFollowUp
} from "../lib/quoteStore";
import {
  APPROVAL_ACTIONS,
  buildProposalReadiness,
  buildQuoteLifecycleTimeline,
  FOLLOW_UP_STAGES
} from "../lib/quoteWorkflow";

function fmtDateTime(value) {
  if (!value) return "-";
  const parsed = new Date(value);
  if (Number.isNaN(parsed.getTime())) return "-";
  return parsed.toLocaleString([], {
    month: "short",
    day: "numeric",
    year: "numeric",
    hour: "numeric",
    minute: "2-digit"
  });
}

function fmtDueDate(value) {
  if (!value) return "No due date";
  const parsed = new Date(`${value}T12:00:00`);
  if (Number.isNaN(parsed.getTime())) return "No due date";
  return parsed.toLocaleDateString([], { month: "short", day: "numeric", year: "numeric" });
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

function followUpFromQuote(quote) {
  const followUp = quote?.workflow?.followUp || {};
  return {
    stage: FOLLOW_UP_STAGES.some((item) => item.id === followUp.stage) ? followUp.stage : "new",
    dueDate: followUp.dueDate || "",
    note: followUp.note || "",
    completed: followUp.completed === true
  };
}

export default function SalesWorkflowModal({
  open,
  onClose,
  onOpenQuoteHistory,
  organizationId = "",
  currentUserEmail = "",
  currentUserRole = "customer",
  onToast
}) {
  const [state, setState] = useState({
    loading: false,
    error: "",
    feedback: "",
    source: "",
    quotes: []
  });
  const [activeTab, setActiveTab] = useState("followups");
  const [selectedQuoteId, setSelectedQuoteId] = useState("");
  const [followUpDraft, setFollowUpDraft] = useState(() => followUpFromQuote(null));
  const [approvalAction, setApprovalAction] = useState(APPROVAL_ACTIONS[0]?.id || "");
  const [approvalNote, setApprovalNote] = useState("");
  const [resolutionNotes, setResolutionNotes] = useState({});
  const [busyKey, setBusyKey] = useState("");

  const pushToast = (message, tone = "info") => {
    if (typeof onToast === "function") onToast(message, tone);
  };
  const reportSuccess = (message) => {
    setState((prev) => ({ ...prev, feedback: message }));
    pushToast(message, "success");
  };

  const load = async () => {
    setState((prev) => ({ ...prev, loading: true, error: "", feedback: "" }));
    try {
      const result = await getQuoteHistory({ organizationId });
      setState({
        loading: false,
        error: "",
        feedback: "",
        source: result.source,
        quotes: result.quotes
      });
      setSelectedQuoteId((current) => (
        result.quotes.some((item) => item.id === current) ? current : result.quotes[0]?.id || ""
      ));
    } catch (err) {
      setState((prev) => ({
        ...prev,
        loading: false,
        error: err?.message || "Failed to load sales workflow."
      }));
    }
  };

  useEffect(() => {
    if (!open) return;
    setActiveTab("followups");
    setApprovalNote("");
    setResolutionNotes({});
    load();
  }, [open, organizationId]);

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

  const metrics = useMemo(() => {
    const today = todayIso();
    return {
      active: state.quotes.filter((quote) => ["draft", "sent", "viewed", "accepted"].includes(quote.status)).length,
      needsReadiness: quoteSummaries.filter((item) => item.readiness.score < 100).length,
      due: quoteSummaries.filter((item) => (
        !item.followUp.completed && item.followUp.dueDate && item.followUp.dueDate <= today
      )).length,
      pendingApprovals: approvalQueue.filter((item) => item.request.state === "pending").length
    };
  }, [state.quotes, quoteSummaries, approvalQueue]);

  const readiness = selectedQuote ? buildProposalReadiness(selectedQuote) : null;
  const timeline = selectedQuote ? buildQuoteLifecycleTimeline(selectedQuote) : [];
  const isAdmin = String(currentUserRole || "").toLowerCase() === "admin";
  const isStaff = ["admin", "sales"].includes(String(currentUserRole || "").toLowerCase());

  const applyQuoteLocally = (quoteId, updater) => {
    setState((prev) => ({
      ...prev,
      quotes: prev.quotes.map((quote) => (quote.id === quoteId ? updater(quote) : quote))
    }));
  };

  const handleSaveFollowUp = async () => {
    if (!selectedQuote?.id || !isStaff) return;
    setBusyKey(`followup:${selectedQuote.id}`);
    setState((prev) => ({ ...prev, error: "", feedback: "" }));
    try {
      const result = await updateQuoteFollowUp({
        quoteId: selectedQuote.id,
        ...followUpDraft,
        actorEmail: currentUserEmail
      });
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
      setState((prev) => ({ ...prev, error: err?.message || "Failed to save follow-up." }));
    } finally {
      setBusyKey("");
    }
  };

  const handleRequestApproval = async () => {
    if (!selectedQuote?.id || !isStaff || !approvalAction) return;
    setBusyKey(`request:${selectedQuote.id}`);
    setState((prev) => ({ ...prev, error: "", feedback: "" }));
    try {
      const result = await requestQuoteApproval({
        quoteId: selectedQuote.id,
        action: approvalAction,
        note: approvalNote,
        actorEmail: currentUserEmail,
        actorRole: currentUserRole
      });
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
      setState((prev) => ({ ...prev, error: err?.message || "Failed to request approval." }));
    } finally {
      setBusyKey("");
    }
  };

  const handleResolveApproval = async (quoteId, requestId, nextState) => {
    if (!isAdmin) return;
    setBusyKey(`resolve:${requestId}`);
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
    } catch (err) {
      setState((prev) => ({ ...prev, error: err?.message || "Failed to resolve approval." }));
    } finally {
      setBusyKey("");
    }
  };

  if (!open) return null;

  return (
    <div className="modal-overlay" role="dialog" aria-modal="true" aria-labelledby="sales-workflow-title">
      <div className="modal-card sales-workflow-card">
        <div className="modal-head">
          <div>
            <h2 id="sales-workflow-title">Sales Workflow</h2>
            <p className="source-note">Source: {state.source || "-"}</p>
          </div>
          <div className="right-actions">
            <button type="button" className="ghost" onClick={load} disabled={state.loading}>
              {state.loading ? "Refreshing..." : "Refresh"}
            </button>
            <button type="button" className="ghost" onClick={onClose}>Close</button>
          </div>
        </div>

        {state.error && <p className="error-note">{state.error}</p>}
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
            aria-selected={activeTab === "followups"}
            className={activeTab === "followups" ? "active" : ""}
            onClick={() => setActiveTab("followups")}
          >
            Follow-ups
          </button>
          <button
            type="button"
            role="tab"
            aria-selected={activeTab === "approvals"}
            className={activeTab === "approvals" ? "active" : ""}
            onClick={() => setActiveTab("approvals")}
          >
            Approvals ({metrics.pendingApprovals})
          </button>
        </div>

        {activeTab === "followups" && (
          <div className="sales-workflow-layout">
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
                      <strong>{quote.quoteNumber || quote.id}</strong>
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
                  <header className="workflow-detail-head">
                    <div>
                      <p className="eyebrow">{selectedQuote.quoteNumber || selectedQuote.id}</p>
                      <h3>{selectedQuote.customer?.name || selectedQuote.customer?.email || "Customer"}</h3>
                    </div>
                    <span className={`status-badge status-${selectedQuote.status || "draft"}`}>
                      {selectedQuote.status || "draft"}
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

                  {!isAdmin && isStaff && (
                    <section className="workflow-form-section">
                      <h4>Request admin approval</h4>
                      <div className="workflow-approval-request">
                        <select value={approvalAction} onChange={(event) => setApprovalAction(event.target.value)}>
                          {APPROVAL_ACTIONS.map((item) => (
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
                          disabled={busyKey === `request:${selectedQuote.id}`}
                        >
                          {busyKey === `request:${selectedQuote.id}` ? "Requesting..." : "Request"}
                        </button>
                      </div>
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
        )}

        {activeTab === "approvals" && (
          <section className="approval-queue" aria-label="Sensitive action approval queue">
            {approvalQueue.length === 0 && !state.loading && (
              <p className="muted">No approval requests yet.</p>
            )}
            {approvalQueue.map(({ quote, request }) => (
              <article key={`${quote.id}-${request.id}`} className={`approval-row state-${request.state}`}>
                <div className="approval-row-main">
                  <div>
                    <span className="approval-state">{request.state}</span>
                    <h3>{actionLabel(request.action)}</h3>
                    <p>{quote.quoteNumber} · {quote.customer?.name || quote.customer?.email || "Customer"}</p>
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
                      disabled={busyKey === `resolve:${request.id}`}
                    >
                      Approve
                    </button>
                    <button
                      type="button"
                      className="ghost compact"
                      onClick={() => handleResolveApproval(quote.id, request.id, "rejected")}
                      disabled={busyKey === `resolve:${request.id}`}
                    >
                      Reject
                    </button>
                  </div>
                )}
                {request.state !== "pending" && (
                  <div className="approval-resolution-summary">
                    <strong>{request.state === "approved" ? "Approved, awaiting admin action" : "Rejected"}</strong>
                    <span>{request.resolutionNote || "No resolution note."}</span>
                    <small>{request.resolvedByEmail || "admin"} · {fmtDateTime(request.resolvedAtISO)}</small>
                  </div>
                )}
              </article>
            ))}
            {isAdmin && approvalQueue.some((item) => item.request.state === "approved") && (
              <div className="right-actions approval-queue-actions">
                <button type="button" className="cta" onClick={onOpenQuoteHistory}>
                  Open Quote History
                </button>
              </div>
            )}
          </section>
        )}
      </div>
    </div>
  );
}
