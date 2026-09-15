import { useCallback, useEffect, useId, useMemo, useRef, useState } from "react";
import {
  buildCommercialChangeRequestId,
  getCommercialDependencyState,
  isDefinitiveCommercialChangeError,
  reconcileCommercialDependencyState
} from "../lib/commercialChangeAuthorityClient";
import {
  formatWorkspaceDate,
  formatWorkspaceDateTime,
  formatWorkspaceInteger,
  formatWorkspaceText,
  humanizeWorkspaceValue
} from "../lib/workspacePresentation";
import StatusChip from "./StatusChip";

const MAX_INVALIDATIONS = 64;
const MAX_RETAINED_ATTEMPTS = 24;

const READ_PRESENTATION = Object.freeze({
  loading: Object.freeze({
    family: "pending",
    label: "Checking dependencies",
    title: "Reading exact dependency state",
    detail: "QuotePilot is reading the server projection for this exact quote. No dependency or publication state is assumed yet."
  }),
  empty: Object.freeze({
    family: "info",
    label: "No governed change",
    title: "No dependency receipt yet",
    detail: "No governed commercial change has generated dependency invalidations for this quote. Publication eligibility is not established by an empty history."
  }),
  ready: Object.freeze({
    family: "confirmed",
    label: "Dependencies reconciled",
    title: "Named dependencies are reconciled",
    detail: "The complete server projection reports no open invalidations for the latest governed change. This clears the dependency gate only."
  }),
  blocked: Object.freeze({
    family: "blocked",
    label: "Reconciliation required",
    title: "Dependent work remains open",
    detail: "One or more named outputs, artifacts, or projections must be reconciled against trusted evidence before the dependency gate can clear."
  }),
  unknown: Object.freeze({
    family: "failed",
    label: "State unknown",
    title: "Dependency authority is unavailable",
    detail: "QuotePilot cannot establish a complete current invalidation set. Treat publication eligibility as unknown until the exact read recovers."
  }),
  stale: Object.freeze({
    family: "action",
    label: "Retained evidence",
    title: "The latest dependency read did not complete",
    detail: "A prior exact server projection remains visible for reference, but it is not current evidence and cannot clear the dependency gate."
  })
});

const MUTATION_PRESENTATION = Object.freeze({
  ready: Object.freeze({ family: "info", label: "Ready to reconcile" }),
  submitting: Object.freeze({ family: "pending", label: "Recording evidence" }),
  uncertain: Object.freeze({ family: "blocked", label: "Outcome uncertain" }),
  reconciliation: Object.freeze({ family: "pending", label: "Reconciling exact request" }),
  receipt: Object.freeze({ family: "confirmed", label: "Receipt recorded" }),
  error: Object.freeze({ family: "failed", label: "Request rejected" }),
  recovery: Object.freeze({ family: "action", label: "Reloading exact state" })
});

const NODE_LABELS = Object.freeze({
  "artifact.contract": "Contract",
  "artifact.kitchen_beo": "Kitchen BEO",
  "artifact.production_plan": "Production plan",
  "output.money.authoritative_total": "Authoritative total",
  "output.money.deposit_requirement": "Deposit requirement",
  "output.money.final_balance": "Final balance",
  "output.plan.food_quantity": "Food quantities",
  "output.plan.rental_quantity": "Rental quantities",
  "output.plan.staffing_requirement": "Staffing requirement",
  "projection.customer_decision_center": "Customer decision center"
});

const REASON_COPY = Object.freeze({
  all_named_dependencies_reconciled: "All named invalidations from the latest governed change have trusted resolution evidence.",
  dependency_state_incomplete: "The stored state and invalidation set do not form one complete authority record.",
  dependency_state_missing: "Invalidation evidence exists without its expected dependency-state record.",
  governed_dependencies_unresolved: "At least one named dependency remains open.",
  invalidation_evidence_truncated: "The invalidation set exceeded the 64-record safety bound.",
  no_governed_change_applied: "No governed change apply receipt exists for this quote."
});

const pendingReconciliations = new Map();

function text(value, maximum = 2_000) {
  return String(value ?? "").trim().slice(0, maximum);
}

function scopeKey(organizationId, quoteId) {
  return `${text(organizationId, 256)}\u0000${text(quoteId, 256)}`;
}

function rememberPendingAttempt(key, attempt) {
  const retained = Object.freeze({
    ...attempt,
    invalidationIds: Object.freeze([...attempt.invalidationIds])
  });
  pendingReconciliations.delete(key);
  pendingReconciliations.set(key, retained);
  while (pendingReconciliations.size > MAX_RETAINED_ATTEMPTS) {
    pendingReconciliations.delete(pendingReconciliations.keys().next().value);
  }
  return retained;
}

function readPendingAttempt(key) {
  return pendingReconciliations.get(key) || null;
}

function forgetPendingAttempt(key, requestId = "") {
  const current = pendingReconciliations.get(key);
  if (!current || (requestId && current.requestId !== requestId)) return;
  pendingReconciliations.delete(key);
}

function nodeLabel(nodeId) {
  const normalized = text(nodeId, 256);
  const concise = normalized.split(".").filter(Boolean).at(-1) || normalized;
  return NODE_LABELS[normalized]
    || humanizeWorkspaceValue(concise, {
      emptyLabel: "Unidentified dependency"
    });
}

function reasonCopy(reasonCode) {
  const normalized = text(reasonCode, 128);
  return REASON_COPY[normalized]
    || humanizeWorkspaceValue(normalized, { emptyLabel: "No server reason recorded" });
}

function invalidationSetIsComplete(result) {
  if (!result || result.bounds?.invalidationSetComplete !== true || result.bounds?.truncated === true) {
    return false;
  }
  const invalidations = Array.isArray(result.invalidations) ? result.invalidations : [];
  return Number.isSafeInteger(result.totalInvalidationCount)
    && Number.isSafeInteger(result.openInvalidationCount)
    && Number.isSafeInteger(result.resolvedInvalidationCount)
    && result.totalInvalidationCount === invalidations.length
    && result.openInvalidationCount + result.resolvedInvalidationCount
      === result.totalInvalidationCount
    && result.bounds.returnedCount === invalidations.length
    && invalidations.length <= MAX_INVALIDATIONS;
}

export function buildCommercialDependencyPresentation({
  result = null,
  loading = false,
  stale = false,
  error = "",
  organizationId = "",
  quoteId = ""
} = {}) {
  const expectedOrganizationId = text(organizationId, 256);
  const expectedQuoteId = text(quoteId, 256);
  const resultAvailable = Boolean(result && typeof result === "object");
  const exactScope = resultAvailable
    && result.organizationId === expectedOrganizationId
    && result.quoteId === expectedQuoteId
    && result.authority === "server_projection"
    && result.source === "firebase_server_projection";
  const complete = exactScope && invalidationSetIsComplete(result);
  const canonicalState = text(result?.state, 32).toUpperCase();
  const openInvalidations = complete
    ? result.invalidations.filter((item) => item?.state === "open")
    : [];
  let state = "unknown";

  if (loading && !resultAvailable) state = "loading";
  else if (resultAvailable && (stale || loading || text(error))) state = "stale";
  else if (
    complete
    && canonicalState === "NOT_GENERATED"
    && result.safeToPublish === false
    && result.totalInvalidationCount === 0
    && !text(result.latestApplyReceiptId)
  ) state = "empty";
  else if (
    complete
    && canonicalState === "READY"
    && result.safeToPublish === true
    && result.openInvalidationCount === 0
    && openInvalidations.length === 0
    && Boolean(text(result.latestApplyReceiptId))
  ) state = "ready";
  else if (
    complete
    && canonicalState === "BLOCKED"
    && result.safeToPublish === false
    && result.openInvalidationCount > 0
    && result.openInvalidationCount === openInvalidations.length
    && Boolean(text(result.latestApplyReceiptId))
  ) state = "blocked";

  const publicationEligibility = state === "ready"
    ? "eligible"
    : state === "blocked"
      ? "blocked"
      : "not-established";
  const capabilityState = state === "loading"
    ? "loading"
    : state === "empty"
      ? "empty"
      : new Set(["ready", "blocked"]).has(state)
        ? "success"
        : state === "stale"
          ? "stale"
          : exactScope ? "partial" : "error";
  return {
    state,
    capabilityState,
    ...READ_PRESENTATION[state],
    result: exactScope ? result : null,
    resultAvailable: exactScope,
    complete,
    openInvalidations,
    retained: state === "stale" && exactScope,
    publicationEligibility
  };
}

function safeReadError(error) {
  const code = text(error?.code, 100).toLowerCase().replace(/^functions\//u, "");
  if (["permission-denied", "unauthenticated"].includes(code)) {
    return "Your current authenticated role cannot read this quote's commercial dependency state.";
  }
  if (code === "not-found") return "The canonical quote no longer exists in this workspace.";
  return "The exact commercial dependency state could not be read. Retry before relying on publication eligibility.";
}

function safeMutationError(error) {
  const code = text(error?.code, 100).toLowerCase().replace(/^functions\//u, "");
  if (["permission-denied", "unauthenticated"].includes(code)) {
    return "Your current authenticated role cannot reconcile these dependencies.";
  }
  if (code === "aborted") return "The quote or dependency state changed. Reload the exact state before preparing another reconciliation.";
  if (code === "failed-precondition") return "The selected dependency does not yet have the required trusted evidence. Complete its stated next action, then reload.";
  if (code === "invalid-argument") return "The exact reconciliation selection or required staff note was rejected.";
  if (code === "already-exists") return "This request identity is already bound to different immutable reconciliation evidence.";
  return "The reconciliation request was definitively rejected. No dependency resolution is assumed.";
}

function nextActionForInvalidation(invalidation) {
  if (invalidation.nodeKind === "output") {
    return "Complete the dependent decision and record the staff rationale below.";
  }
  if (invalidation.nodeId === "artifact.kitchen_beo") {
    return "Review the current Kitchen BEO and generate a revision-bound artifact if this evidence is stale.";
  }
  if (invalidation.nodeId === "projection.customer_decision_center") {
    return "Confirm the server projection matches the active revision, then reconcile.";
  }
  if (invalidation.nodeId === "artifact.production_plan") {
    return "Review the exact event checklist and update only the work affected by this change.";
  }
  if (invalidation.nodeId === "artifact.contract") {
    return "Regenerate this artifact with revision-bound evidence before reconciliation when an artifact already exists.";
  }
  return "Complete the trusted adapter requirement for this dependency before reconciliation.";
}

function recoveryActionForInvalidation(invalidation, {
  onOpenKitchenBeo,
  onOpenProductionChecklist
}) {
  if (invalidation.nodeId === "artifact.kitchen_beo" && typeof onOpenKitchenBeo === "function") {
    return {
      label: "Review Kitchen BEO",
      action: onOpenKitchenBeo,
      actionId: "review-kitchen-beo"
    };
  }
  if (
    invalidation.nodeId === "artifact.production_plan"
    && typeof onOpenProductionChecklist === "function"
  ) {
    return {
      label: "Open production checklist",
      action: onOpenProductionChecklist,
      actionId: "review-production-checklist"
    };
  }
  return null;
}

function DependencyInvalidation({
  invalidation,
  checked,
  disabled,
  onToggle,
  recoveryAction
}) {
  const label = nodeLabel(invalidation.nodeId);
  const classification = invalidation.classification === "STALE"
    ? { family: "failed", label: "STALE" }
    : { family: "action", label: "REVIEW" };
  return (
    <li
      className="commercial-dependency-invalidation"
      data-commercial-invalidation-id={invalidation.invalidationId}
      data-commercial-node-id={invalidation.nodeId}
      data-commercial-node-kind={invalidation.nodeKind}
    >
      <label className="commercial-dependency-select">
        <input
          type="checkbox"
          checked={checked}
          disabled={disabled}
          aria-label={`Select ${label} for reconciliation`}
          onChange={() => onToggle(invalidation.invalidationId)}
        />
        <span>
          <span className="commercial-dependency-node-heading">
            <strong>{label}</strong>
            <StatusChip {...classification} />
          </span>
          <small>{nextActionForInvalidation(invalidation)}</small>
        </span>
      </label>
      {recoveryAction && (
        <div className="workspace-inline-actions">
          <button
            type="button"
            className="ghost compact"
            data-capability-action={recoveryAction.actionId}
            data-commercial-node-id={invalidation.nodeId}
            onClick={() => recoveryAction.action()}
          >
            {recoveryAction.label}
          </button>
          <small>Opens the owning workspace; reconciliation remains a separate reviewed action.</small>
        </div>
      )}
      <details className="commercial-dependency-provenance">
        <summary>Exact provenance</summary>
        <dl>
          <div>
            <dt>Node</dt>
            <dd><code>{invalidation.nodeId}</code></dd>
          </div>
          <div>
            <dt>Kind</dt>
            <dd>{humanizeWorkspaceValue(invalidation.nodeKind)}</dd>
          </div>
          <div>
            <dt>Revision path</dt>
            <dd><code>{invalidation.sourceRevisionId}</code> → <code>{invalidation.targetRevisionId}</code></dd>
          </div>
          <div>
            <dt>Triggered by</dt>
            <dd>{invalidation.triggeredBy.length
              ? invalidation.triggeredBy.map(nodeLabel).join(", ")
              : "No trigger recorded"}</dd>
          </div>
          <div>
            <dt>Invalidation receipt</dt>
            <dd><code>{invalidation.invalidationId}</code></dd>
          </div>
          <div>
            <dt>Operation</dt>
            <dd><code>{invalidation.operationId}</code></dd>
          </div>
          <div>
            <dt>Created</dt>
            <dd>{formatWorkspaceDateTime(invalidation.createdAtISO)}</dd>
          </div>
          <div>
            <dt>Decision</dt>
            <dd>{invalidation.decisionType
              ? humanizeWorkspaceValue(invalidation.decisionType)
              : "No decision classification"}</dd>
          </div>
        </dl>
      </details>
    </li>
  );
}

function ReconciliationReceipt({ receipt, id }) {
  if (!receipt) return null;
  return (
    <article
      className="commercial-dependency-receipt"
      aria-labelledby={id}
      data-capability-id="cwf-15-commercial-dependency-reconciliation"
      data-capability-state="receipt"
      data-commercial-reconciliation-state="receipt"
      data-reconciliation-receipt-id={receipt.receiptId}
    >
      <div className="workflow-attention-head">
        <div>
          <p className="eyebrow">Immutable reconciliation receipt</p>
          <h4 id={id}>Server evidence recorded</h4>
        </div>
        <StatusChip {...MUTATION_PRESENTATION.receipt} />
      </div>
      <p className="source-note">
        This receipt proves only the named dependency resolutions below. It does not publish the quote, contact the customer, or establish artifact use.
      </p>
      <dl className="commercial-dependency-receipt-grid">
        <div>
          <dt>Receipt</dt>
          <dd><code>{receipt.receiptId}</code></dd>
        </div>
        <div>
          <dt>Exact request</dt>
          <dd><code>{receipt.requestId}</code></dd>
        </div>
        <div>
          <dt>Apply receipt</dt>
          <dd><code>{receipt.applyReceiptId}</code></dd>
        </div>
        <div>
          <dt>Active revision</dt>
          <dd><code>{receipt.activeRevisionId}</code></dd>
        </div>
        <div>
          <dt>Recorded</dt>
          <dd>{formatWorkspaceDateTime(receipt.reconciledAtISO)}</dd>
        </div>
        <div>
          <dt>Actor</dt>
          <dd>{formatWorkspaceText(receipt.reconciledBy?.email)} · {humanizeWorkspaceValue(receipt.reconciledBy?.role)}</dd>
        </div>
      </dl>
      <ul className="commercial-dependency-receipt-resolutions">
        {receipt.resolutions.map((resolution) => (
          <li key={resolution.invalidationId}>
            <strong>{nodeLabel(resolution.nodeId)}</strong>
            <span>{humanizeWorkspaceValue(resolution.resolution)}</span>
            <code>{resolution.evidenceId}</code>
          </li>
        ))}
      </ul>
      <p className="source-note">{receipt.boundary}</p>
    </article>
  );
}

export default function CommercialDependencyStatePanel({
  organizationId = "",
  quoteId = "",
  quoteNumber = "",
  available = true,
  canReconcile = true,
  onOpenKitchenBeo,
  onOpenProductionChecklist
}) {
  const headingId = useId();
  const receiptHeadingId = useId();
  const noteRef = useRef(null);
  const readGenerationRef = useRef(0);
  const mutationGenerationRef = useRef(0);
  const normalizedOrganizationId = text(organizationId, 256);
  const normalizedQuoteId = text(quoteId, 256);
  const key = scopeKey(normalizedOrganizationId, normalizedQuoteId);
  const [read, setRead] = useState({
    scopeKey: key,
    loading: true,
    result: null,
    stale: false,
    recovering: false,
    error: ""
  });
  const [selectedIds, setSelectedIds] = useState([]);
  const [resolutionNote, setResolutionNote] = useState("");
  const [validationError, setValidationError] = useState("");
  const [receipt, setReceipt] = useState(null);
  const [mutation, setMutation] = useState({
    phase: "ready",
    pending: null,
    error: ""
  });

  const load = useCallback(async ({ retainExisting = true, recovery = false } = {}) => {
    const requestScopeKey = scopeKey(normalizedOrganizationId, normalizedQuoteId);
    const generation = readGenerationRef.current + 1;
    readGenerationRef.current = generation;
    if (!available || !normalizedOrganizationId || !normalizedQuoteId) {
      setRead({
        scopeKey: requestScopeKey,
        loading: false,
        result: null,
        stale: false,
        recovering: false,
        error: "Commercial dependencies require a connected same-tenant staff quote."
      });
      return;
    }
    setRead((current) => {
      const retainedResult = retainExisting && current.scopeKey === requestScopeKey
        ? current.result
        : null;
      return {
        scopeKey: requestScopeKey,
        loading: true,
        result: retainedResult,
        stale: Boolean(retainedResult),
        recovering: recovery === true,
        error: ""
      };
    });
    try {
      const result = await getCommercialDependencyState({
        organizationId: normalizedOrganizationId,
        quoteId: normalizedQuoteId
      });
      if (readGenerationRef.current !== generation) return;
      setRead({
        scopeKey: requestScopeKey,
        loading: false,
        result,
        stale: false,
        recovering: false,
        error: ""
      });
      setMutation((current) => (
        new Set(["error", "recovery"]).has(current.phase)
          ? { phase: "ready", pending: null, error: "" }
          : current
      ));
    } catch (error) {
      if (readGenerationRef.current !== generation) return;
      setRead((current) => {
        const retainedResult = current.scopeKey === requestScopeKey ? current.result : null;
        return {
          scopeKey: requestScopeKey,
          loading: false,
          result: retainedResult,
          stale: Boolean(retainedResult),
          recovering: false,
          error: safeReadError(error)
        };
      });
    }
  }, [available, normalizedOrganizationId, normalizedQuoteId]);

  useEffect(() => {
    readGenerationRef.current += 1;
    mutationGenerationRef.current += 1;
    const pending = readPendingAttempt(key);
    setSelectedIds(pending ? [...pending.invalidationIds] : []);
    setResolutionNote(pending?.resolutionNote || "");
    setValidationError("");
    setReceipt(null);
    setMutation(pending
      ? { phase: "uncertain", pending, error: "No definitive receipt was retained for this exact request." }
      : { phase: "ready", pending: null, error: "" });
    load({ retainExisting: false });
    return () => {
      readGenerationRef.current += 1;
      mutationGenerationRef.current += 1;
    };
  }, [key, load]);

  useEffect(() => {
    if (!mutation.pending || typeof window === "undefined") return undefined;
    const protectExactAttempt = (event) => {
      event.preventDefault();
      event.returnValue = "";
    };
    window.addEventListener("beforeunload", protectExactAttempt);
    return () => window.removeEventListener("beforeunload", protectExactAttempt);
  }, [mutation.pending]);

  const view = useMemo(() => buildCommercialDependencyPresentation({
    result: read.result,
    loading: read.loading,
    stale: read.stale,
    error: read.error,
    organizationId: normalizedOrganizationId,
    quoteId: normalizedQuoteId
  }), [read, normalizedOrganizationId, normalizedQuoteId]);
  const openInvalidationKey = view.openInvalidations
    .map((item) => item.invalidationId)
    .join("\u0000");

  useEffect(() => {
    if (mutation.pending) return;
    const openIds = new Set(view.openInvalidations.map((item) => item.invalidationId));
    setSelectedIds((current) => {
      const retained = current.filter((id) => openIds.has(id));
      return retained.length === current.length ? current : retained;
    });
  }, [mutation.pending, openInvalidationKey, view.openInvalidations]);

  const selectedOpenInvalidations = view.openInvalidations.filter((item) => (
    selectedIds.includes(item.invalidationId)
  ));
  const selectedOutputCount = selectedOpenInvalidations.filter((item) => (
    item.nodeKind === "output"
  )).length;
  const busy = ["submitting", "reconciliation"].includes(mutation.phase);
  const selectionLocked = !canReconcile
    || busy
    || mutation.phase === "uncertain"
    || view.state !== "blocked";
  const mutationPresentation = MUTATION_PRESENTATION[mutation.phase]
    || MUTATION_PRESENTATION.error;

  const toggleInvalidation = (invalidationId) => {
    if (selectionLocked) return;
    setSelectedIds((current) => current.includes(invalidationId)
      ? current.filter((id) => id !== invalidationId)
      : [...current, invalidationId].slice(0, MAX_INVALIDATIONS));
    setValidationError("");
  };

  const runAttempt = useCallback(async (attempt, { retry = false } = {}) => {
    const generation = mutationGenerationRef.current + 1;
    mutationGenerationRef.current = generation;
    setMutation({
      phase: retry ? "reconciliation" : "submitting",
      pending: attempt,
      error: ""
    });
    try {
      const result = await reconcileCommercialDependencyState({
        organizationId: attempt.organizationId,
        quoteId: attempt.quoteId,
        applyReceiptId: attempt.applyReceiptId,
        requestId: attempt.requestId,
        invalidationIds: attempt.invalidationIds,
        resolutionNote: attempt.resolutionNote
      });
      forgetPendingAttempt(attempt.scopeKey, attempt.requestId);
      if (mutationGenerationRef.current !== generation) return;
      setRead({
        scopeKey: attempt.scopeKey,
        loading: false,
        result: result.dependencyState,
        stale: false,
        recovering: false,
        error: ""
      });
      setSelectedIds([]);
      setResolutionNote("");
      setValidationError("");
      setReceipt(result.reconciliationReceipt);
      setMutation({ phase: "receipt", pending: null, error: "" });
    } catch (error) {
      const definitive = isDefinitiveCommercialChangeError(error);
      if (definitive) forgetPendingAttempt(attempt.scopeKey, attempt.requestId);
      if (mutationGenerationRef.current !== generation) return;
      setMutation({
        phase: definitive ? "error" : "uncertain",
        pending: definitive ? null : attempt,
        error: definitive
          ? safeMutationError(error)
          : "No definitive server receipt returned. Keep this exact request identity and reconcile it before making another selection."
      });
    }
  }, []);

  const submitSelection = () => {
    if (!canReconcile || selectionLocked) return;
    if (!selectedOpenInvalidations.length) {
      setValidationError("Select at least one exact open invalidation.");
      return;
    }
    const note = text(resolutionNote, 800);
    if (selectedOutputCount > 0 && !note) {
      setValidationError("A staff resolution note is required for dependent output decisions.");
      noteRef.current?.focus();
      return;
    }
    const attempt = rememberPendingAttempt(key, {
      scopeKey: key,
      organizationId: normalizedOrganizationId,
      quoteId: normalizedQuoteId,
      applyReceiptId: view.result.latestApplyReceiptId,
      requestId: buildCommercialChangeRequestId("reconciliation"),
      invalidationIds: selectedOpenInvalidations.map((item) => item.invalidationId),
      resolutionNote: note
    });
    runAttempt(attempt);
  };

  const retryExactAttempt = () => {
    const pending = mutation.pending || readPendingAttempt(key);
    if (!pending || busy) return;
    runAttempt(pending, { retry: true });
  };

  const recoverAfterDefinitiveError = () => {
    if (read.loading) return;
    setMutation({ phase: "recovery", pending: null, error: "" });
    void load({ recovery: true });
  };

  const reasonCodes = Array.isArray(view.result?.reasonCodes)
    ? view.result.reasonCodes
    : [];
  const publicationLabel = view.publicationEligibility === "eligible"
    ? "Eligible for a separate publish decision"
    : view.publicationEligibility === "blocked"
      ? "Blocked by open dependencies"
      : "Not established";

  return (
    <section
      className={`commercial-dependency-panel staff-capability-state commercial-dependency-${view.state}`}
      aria-labelledby={headingId}
      aria-busy={read.loading || busy}
      data-capability-id="cwf-15-commercial-dependency-state"
      data-capability-state={read.recovering ? "recovery" : view.capabilityState}
      data-commercial-dependency-state={view.state}
      data-quote-id={normalizedQuoteId || "unscoped"}
    >
      <div className="commercial-dependency-header">
        <div>
          <p className="eyebrow">Commercial Change Authority</p>
          <h3 id={headingId}>Dependency reconciliation{quoteNumber ? ` · ${quoteNumber}` : ""}</h3>
          <p>{view.title}</p>
        </div>
        <StatusChip family={view.family} label={view.label} />
      </div>
      <p className={view.state === "ready" ? "source-note" : "warning-note"}>{view.detail}</p>

      <div
        className={`commercial-dependency-gate commercial-dependency-gate-${view.publicationEligibility}`}
        data-commercial-publish-eligibility={view.publicationEligibility}
      >
        <span>Dependency-gate eligibility</span>
        <strong>{publicationLabel}</strong>
        <small>This control never publishes, sends, or establishes customer visibility.</small>
      </div>

      {view.resultAvailable && (
        <dl className="commercial-dependency-evidence">
          <div>
            <dt>Active revision</dt>
            <dd><code>{view.result.activeRevisionId}</code></dd>
          </div>
          <div>
            <dt>Latest apply receipt</dt>
            <dd><code>{view.result.latestApplyReceiptId || "Not generated"}</code></dd>
          </div>
          <div>
            <dt>Observed</dt>
            <dd>{formatWorkspaceDateTime(view.result.observedAtISO)}</dd>
          </div>
          <div>
            <dt>Event</dt>
            <dd>{formatWorkspaceDate(view.result.eventDate)}</dd>
          </div>
          <div>
            <dt>Invalidation set</dt>
            <dd>{formatWorkspaceInteger(view.result.bounds?.returnedCount)} of {formatWorkspaceInteger(view.result.totalInvalidationCount)} · {view.complete ? "Complete" : "Incomplete"}</dd>
          </div>
          <div>
            <dt>Open / resolved</dt>
            <dd>{formatWorkspaceInteger(view.result.openInvalidationCount)} / {formatWorkspaceInteger(view.result.resolvedInvalidationCount)}</dd>
          </div>
        </dl>
      )}

      {reasonCodes.length > 0 && (
        <ul className="commercial-dependency-reasons">
          {reasonCodes.map((reason) => <li key={reason}>{reasonCopy(reason)}</li>)}
        </ul>
      )}

      {(view.state === "unknown" || view.state === "stale") && read.error && (
        <p className="warning-note" role="alert">{read.error}</p>
      )}
      {view.state !== "loading" && (
        <button
          type="button"
          className="ghost compact"
          data-capability-action="refresh-commercial-dependency-state"
          onClick={() => load({ recovery: Boolean(read.error) })}
          disabled={read.loading}
        >
          {read.loading ? "Refreshing exact state…" : "Refresh exact state"}
        </button>
      )}

      {view.openInvalidations.length > 0 && (
        <fieldset className="commercial-dependency-selection" disabled={selectionLocked}>
          <legend>Open invalidations</legend>
          <div className="commercial-dependency-selection-head">
            <p>
              Select only work with completed trusted evidence. {formatWorkspaceInteger(view.openInvalidations.length)} open item{view.openInvalidations.length === 1 ? "" : "s"} returned within the 64-item bound.
            </p>
            <div className="workspace-inline-actions">
              <button
                type="button"
                className="ghost compact"
                disabled={selectionLocked || selectedIds.length === view.openInvalidations.length}
                onClick={() => setSelectedIds(view.openInvalidations.map((item) => item.invalidationId))}
              >
                Select all open
              </button>
              <button
                type="button"
                className="ghost compact"
                disabled={selectionLocked || selectedIds.length === 0}
                onClick={() => setSelectedIds([])}
              >
                Clear selection
              </button>
            </div>
          </div>
          <ul className="commercial-dependency-invalidation-list">
            {view.openInvalidations.map((invalidation) => (
              <DependencyInvalidation
                key={invalidation.invalidationId}
                invalidation={invalidation}
                checked={selectedIds.includes(invalidation.invalidationId)}
                disabled={selectionLocked}
                onToggle={toggleInvalidation}
                recoveryAction={recoveryActionForInvalidation(invalidation, {
                  onOpenKitchenBeo,
                  onOpenProductionChecklist
                })}
              />
            ))}
          </ul>
        </fieldset>
      )}

      {(view.state === "blocked" || mutation.phase === "recovery") && canReconcile && view.resultAvailable && (
        <section
          className="commercial-dependency-reconcile"
          data-capability-id="cwf-15-commercial-dependency-reconciliation"
          data-capability-state={mutation.phase}
          data-commercial-reconciliation-state={mutation.phase}
        >
          <div className="workflow-attention-head">
            <div>
              <p className="eyebrow">Authorized reconciliation</p>
              <h4>{mutation.phase === "uncertain"
                ? "Reconcile the retained exact request"
                : "Resolve selected dependency evidence"}</h4>
            </div>
            <StatusChip {...mutationPresentation} />
          </div>
          <label className="field">
            Staff resolution note {selectedOutputCount > 0 ? "(required for selected outputs)" : "(optional for artifact/projection evidence)"}
            <textarea
              ref={noteRef}
              rows={3}
              maxLength={800}
              value={resolutionNote}
              disabled={busy || mutation.phase === "uncertain"}
              onChange={(event) => {
                setResolutionNote(event.target.value);
                setValidationError("");
              }}
              placeholder="Record what was reviewed or recomputed; never paste customer or payment credentials."
            />
          </label>
          <div className="commercial-dependency-reconcile-summary">
            <span>{formatWorkspaceInteger(selectedIds.length)} selected</span>
            <span>{formatWorkspaceInteger(selectedOutputCount)} output decision{selectedOutputCount === 1 ? "" : "s"}</span>
            <span>{formatWorkspaceInteger(800 - resolutionNote.length)} characters remaining</span>
          </div>
          {validationError && <p className="warning-note" role="alert">{validationError}</p>}
          {mutation.error && <p className="warning-note" role="alert">{mutation.error}</p>}
          {mutation.pending && (
            <p className="source-note">
              Retained request: <code>{mutation.pending.requestId}</code>. Its apply receipt, selection, and note remain locked until a definitive receipt or rejection returns.
            </p>
          )}
          <div className="workspace-inline-actions">
            {mutation.phase === "uncertain" ? (
              <button type="button" className="cta compact" onClick={retryExactAttempt} disabled={busy}>
                Reconcile exact request
              </button>
            ) : (
              <button
                type="button"
                className="cta compact"
                onClick={submitSelection}
                disabled={busy || mutation.phase === "error"}
              >
                {busy ? "Recording evidence…" : "Reconcile selected"}
              </button>
            )}
            {mutation.phase === "error" && (
              <button type="button" className="ghost compact" onClick={recoverAfterDefinitiveError} disabled={read.loading}>
                Reload before another attempt
              </button>
            )}
          </div>
        </section>
      )}

      {view.state === "blocked" && !canReconcile && (
        <p className="warning-note">Your role may inspect this evidence but cannot submit a reconciliation.</p>
      )}

      <ReconciliationReceipt receipt={receipt} id={receiptHeadingId} />
    </section>
  );
}
