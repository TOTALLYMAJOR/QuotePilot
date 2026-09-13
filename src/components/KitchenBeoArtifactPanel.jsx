import { useEffect, useId, useMemo, useRef, useState } from "react";
import { useModalDialog } from "../hooks/useModalDialog";
import {
  downloadKitchenBeoArtifact,
  generateKitchenBeo,
  getKitchenBeoArtifactStatus,
  getKitchenBeoReceiptArtifact,
  isDefinitiveKitchenBeoError,
  readPendingKitchenBeoAttempt,
  resetDefinitiveKitchenBeoAttempt
} from "../lib/kitchenBeoClient";
import { formatWorkspaceDateTime, humanizeWorkspaceValue } from "../lib/workspacePresentation";
import EventOperationalNotesPanel from "./EventOperationalNotesPanel";
import StatusChip from "./StatusChip";

const FRESHNESS_PRESENTATION = Object.freeze({
  CURRENT: Object.freeze({
    family: "confirmed",
    label: "CURRENT",
    title: "Matches the current canonical source",
    detail: "The latest trusted generation receipt matches the current declared inputs and commercial source revision at the recorded server observation."
  }),
  STALE: Object.freeze({
    family: "failed",
    label: "STALE",
    title: "Do not use this BEO for production",
    detail: "The generated artifact no longer matches its current declared inputs, source revision, or authorized invalidation state."
  }),
  REVIEW: Object.freeze({
    family: "action",
    label: "REVIEW",
    title: "A dependent decision requires review",
    detail: "QuotePilot cannot assert freshness while the generation contract or an authorized dependency review remains open."
  }),
  NOT_GENERATED: Object.freeze({
    family: "info",
    label: "NOT GENERATED",
    title: "No trusted Kitchen BEO receipt",
    detail: "No server generation receipt is available for this quote's current Kitchen BEO history."
  }),
  UNKNOWN: Object.freeze({
    family: "blocked",
    label: "UNKNOWN",
    title: "Freshness cannot be established",
    detail: "The canonical source or trusted receipt could not be validated. Treat the artifact as unavailable until the status read recovers."
  })
});

const READ_PRESENTATION = Object.freeze({
  loading: Object.freeze({
    family: "pending",
    label: "Checking status",
    detail: "Reading the server-derived artifact status. No freshness result is assumed while this read is in progress."
  }),
  success: Object.freeze({
    family: "confirmed",
    label: "Status read complete",
    detail: "The displayed freshness state is derived from the canonical quote, latest trusted receipt, and recorded invalidations."
  }),
  stale: Object.freeze({
    family: "action",
    label: "Retained status",
    detail: "The refresh did not complete. The previous result remains visible but must not be treated as the current server state."
  }),
  error: Object.freeze({
    family: "failed",
    label: "Status unavailable",
    detail: "Kitchen BEO status could not be read, and no retained server result is available."
  }),
  recovery: Object.freeze({
    family: "pending",
    label: "Retrying status",
    detail: "Retrying the authoritative status read. Any retained result remains non-current until this request completes."
  })
});

const MUTATION_PRESENTATION = Object.freeze({
  ready: Object.freeze({
    family: "info",
    label: "Ready to generate",
    title: "Create an authoritative Kitchen BEO",
    detail: "Generation uses the current canonical quote and creates one immutable server receipt for the exact request identity.",
    action: "generate",
    actionLabel: "Generate Kitchen BEO"
  }),
  submitting: Object.freeze({
    family: "pending",
    label: "Waiting for receipt",
    title: "Generating from the canonical source",
    detail: "Do not repeat this action. QuotePilot is waiting for the exact server receipt and PDF artifact.",
    action: "none",
    actionLabel: "Generating…"
  }),
  uncertain: Object.freeze({
    family: "blocked",
    label: "Outcome uncertain",
    title: "Generation outcome is uncertain",
    detail: "No definitive receipt returned. Do not create a second request; reconcile the unchanged pending request identity.",
    action: "reconcile",
    actionLabel: "Reconcile exact generation"
  }),
  reconciliation: Object.freeze({
    family: "pending",
    label: "Reconciling request",
    title: "Checking the exact pending generation",
    detail: "The same request identity is being retried. This does not create a second logical generation request.",
    action: "none",
    actionLabel: "Reconciling…"
  }),
  receipt: Object.freeze({
    family: "confirmed",
    label: "Generation receipt",
    title: "Server generation receipt recorded",
    detail: "The receipt proves that the server generated the returned PDF from its recorded source and fingerprint. It does not prove kitchen review or use.",
    action: "download",
    actionLabel: "Download PDF again"
  }),
  error: Object.freeze({
    family: "failed",
    label: "Request rejected",
    title: "Generation was definitively rejected",
    detail: "No successful generation receipt is assumed. Review current quote authority, then clear this rejected attempt before starting a new request.",
    action: "reset",
    actionLabel: "Reset rejected attempt"
  }),
  recovery: Object.freeze({
    family: "action",
    label: "Ready after reset",
    title: "Rejected request identity cleared",
    detail: "Review the current status and source before starting a new generation with a new request identity.",
    action: "generate",
    actionLabel: "Start new generation"
  })
});

const REASON_COPY = Object.freeze({
  authorized_invalidation_open: "An authorized stale invalidation remains open.",
  canonical_fingerprint_unavailable: "The canonical Kitchen BEO fingerprint could not be calculated.",
  canonical_source_deleted: "The canonical quote source is deleted.",
  canonical_source_missing: "The canonical quote source is missing.",
  canonical_source_unavailable: "The canonical quote source is unavailable.",
  commercial_source_revision_changed: "The active commercial source revision changed after generation.",
  declared_inputs_changed: "One or more declared Kitchen BEO inputs changed after generation.",
  dependency_review_open: "An authorized dependency review remains open.",
  invalidation_evidence_truncated: "The invalidation evidence exceeded the bounded read, so QuotePilot cannot establish freshness.",
  receipt_contract_requires_review: "The stored receipt uses a generation contract that requires review.",
  trusted_receipt_invalid: "The trusted receipt failed validation.",
  trusted_receipt_matches_canonical_source: "The trusted receipt matches the current canonical source.",
  trusted_receipt_missing: "No trusted generation receipt is recorded.",
  trusted_receipt_scope_mismatch: "The trusted receipt does not match this quote scope."
});

function text(value, maximum = 500) {
  return String(value ?? "").trim().slice(0, maximum);
}

function normalizeFreshnessState(value) {
  const state = text(value, 32).toUpperCase();
  return Object.hasOwn(FRESHNESS_PRESENTATION, state) ? state : "UNKNOWN";
}

function scopeIdentity(organizationId, quoteId) {
  return `${text(organizationId, 256)}\u0000${text(quoteId, 256)}`;
}

function safeReadError() {
  return "The authoritative Kitchen BEO status is temporarily unavailable. Retry before relying on any retained result.";
}

function safeGenerationError(error) {
  const code = text(error?.code, 100).toLowerCase().replace(/^functions\//u, "");
  if (code === "permission-denied" || code === "unauthenticated") {
    return "Your current authenticated role cannot generate this Kitchen BEO.";
  }
  if (code === "not-found") return "The canonical quote could not be found in this workspace.";
  if (code === "failed-precondition") {
    return "The quote or generation source does not currently satisfy the trusted Kitchen BEO requirements.";
  }
  if (code === "invalid-argument") return "The exact Kitchen BEO request scope was rejected.";
  if (code === "already-exists") return "The request identity is already bound to different generation evidence.";
  return "No definitive server generation receipt was returned.";
}

function shortFingerprint(value) {
  const normalized = text(value, 128);
  return normalized ? `${normalized.slice(0, 12)}${normalized.length > 12 ? "…" : ""}` : "Not recorded";
}

export function buildKitchenBeoFreshnessPresentation(status = null) {
  const state = normalizeFreshnessState(status?.state);
  const reasonCodes = Array.isArray(status?.reasonCodes)
    ? status.reasonCodes.map((value) => text(value, 100)).filter(Boolean)
    : [];
  const receiptHistory = status?.receiptHistory && typeof status.receiptHistory === "object"
    ? status.receiptHistory
    : {
      state: "UNKNOWN",
      bounds: { returnedCount: 0, truncated: true },
      reasonCodes: ["receipt_history_unavailable"],
      receipts: []
    };
  return {
    state,
    ...FRESHNESS_PRESENTATION[state],
    reasons: reasonCodes.length
      ? reasonCodes.map((reason) => REASON_COPY[reason] || humanizeWorkspaceValue(reason))
      : ["No server reason was provided; freshness remains unknown."],
    observedAtISO: text(status?.observedAtISO, 40),
    receiptId: text(status?.receiptId, 180),
    commercialSourceRevisionId: text(status?.commercialSourceRevisionId, 180),
    currentFingerprint: text(status?.currentDependencyFingerprint, 128),
    receiptFingerprint: text(status?.receiptDependencyFingerprint, 128),
    unresolvedInvalidationIds: Array.isArray(status?.unresolvedInvalidationIds)
      ? status.unresolvedInvalidationIds.map((value) => text(value, 180)).filter(Boolean)
      : [],
    receiptHistory
  };
}

export function buildKitchenBeoMutationPresentation(mutation = {}) {
  const requestedState = text(mutation?.state, 32).toLowerCase();
  const state = Object.hasOwn(MUTATION_PRESENTATION, requestedState)
    ? requestedState
    : "ready";
  return { state, ...MUTATION_PRESENTATION[state] };
}

function KitchenBeoFreshnessSummary({
  status,
  headingId,
  receiptDownload,
  onDownloadReceipt
}) {
  const view = useMemo(() => buildKitchenBeoFreshnessPresentation(status), [status]);
  return (
    <section
      className="admin-section staff-capability-state"
      aria-labelledby={headingId}
      data-beo-freshness-state={view.state}
    >
      <div className="workflow-attention-head">
        <div>
          <p className="eyebrow">Artifact freshness</p>
          <h3 id={headingId}>{view.title}</h3>
        </div>
        <StatusChip family={view.family} label={view.label} />
      </div>
      <p className={view.state === "CURRENT" ? "source-note" : "warning-note"}>{view.detail}</p>
      <ul>
        {view.reasons.map((reason, index) => <li key={`${reason}-${index}`}>{reason}</li>)}
      </ul>
      <div className="status-strip">
        <span>Observed: <strong>{formatWorkspaceDateTime(view.observedAtISO)}</strong></span>
        <span>Receipt source revision: <strong>{view.commercialSourceRevisionId || "Not recorded"}</strong></span>
        <span>Open invalidations: <strong>{view.unresolvedInvalidationIds.length}</strong></span>
      </div>
      <p className="source-note">
        Current fingerprint: <code title={view.currentFingerprint}>{shortFingerprint(view.currentFingerprint)}</code>
        {view.receiptId ? <>
          {" · "}Receipt fingerprint: <code title={view.receiptFingerprint}>{shortFingerprint(view.receiptFingerprint)}</code>
        </> : null}
      </p>
      <div className="workflow-form-section" data-beo-receipt-history-state={view.receiptHistory.state}>
        <h4>Generation receipts</h4>
        <p className={view.receiptHistory.state === "COMPLETE" ? "source-note" : "warning-note"}>
          {view.receiptHistory.state === "COMPLETE"
            ? "This bounded receipt history is complete for the recorded artifact pointer."
            : view.receiptHistory.state === "PARTIAL"
              ? "Showing the newest retained receipts. Older generation receipts may exist outside this bounded list."
              : "Receipt history could not be validated. No prior download is offered from untrusted history."}
        </p>
        {Array.isArray(view.receiptHistory.receipts) && view.receiptHistory.receipts.length > 0 ? (
          <ul
            className="command-center-list"
            aria-label="Kitchen BEO generation receipt history"
          >
            {view.receiptHistory.receipts.map((receipt) => {
              const receiptId = text(receipt.receiptId, 180);
              const fetching = receiptDownload.state === "submitting"
                && receiptDownload.receiptId === receiptId;
              return (
                <li
                  className="command-center-row"
                  key={receiptId}
                  data-beo-receipt-id={receiptId}
                >
                  <div className="command-center-row-main">
                    <strong>{receipt.current ? "Current receipt" : "Prior receipt"}</strong>
                    <p className="command-center-row-detail">
                      Generated {formatWorkspaceDateTime(receipt.generatedAtISO)}
                    </p>
                    <p className="command-center-row-meta">
                      Commercial source <code>{text(receipt.commercialSourceRevisionId, 180)}</code>
                    </p>
                  </div>
                  <div className="right-actions">
                    <button
                      type="button"
                      className="ghost compact"
                      data-capability-action="download-receipt"
                      data-receipt-id={receiptId}
                      disabled={receiptDownload.state === "submitting"}
                      onClick={() => onDownloadReceipt(receiptId)}
                    >
                      {fetching ? "Fetching recorded PDF…" : "Download recorded PDF"}
                    </button>
                  </div>
                </li>
              );
            })}
          </ul>
        ) : (
          <p className="source-note">No validated generation receipts are available.</p>
        )}
        {receiptDownload.state === "receipt" ? (
          <span className="source-note" role="status">
            Exact receipt bytes downloaded. Opening or use is not proven.
          </span>
        ) : null}
        {receiptDownload.state === "error" ? (
          <span className="warning-note" role="alert">
            The selected recorded PDF could not be downloaded. Its receipt and freshness state were not changed.
          </span>
        ) : null}
      </div>
    </section>
  );
}

export function KitchenBeoMutationStatus({ mutation, onAction, headingId }) {
  const view = buildKitchenBeoMutationPresentation(mutation);
  const busy = new Set(["submitting", "reconciliation"]).has(view.state);
  const warning = new Set(["uncertain", "error", "recovery"]).has(view.state);
  return (
    <section
      className="admin-section staff-capability-state"
      aria-labelledby={headingId}
      data-capability-id="cwf-15-kitchen-beo-generation"
      data-capability-state={view.state}
      data-mutation-state={view.state}
    >
      <div className="workflow-attention-head">
        <div ref={mutation.statusRef} tabIndex={-1} aria-live="polite">
          <p className="eyebrow">Authoritative generation</p>
          <h3 id={headingId}>{view.title}</h3>
        </div>
        <StatusChip family={view.family} label={view.label} />
      </div>
      <p className={warning ? "warning-note" : "source-note"}>{view.detail}</p>
      {mutation.error ? <p className="warning-note" role="alert">{mutation.error}</p> : null}
      {mutation.receipt?.receiptId ? (
        <p className="source-note">
          Receipt <code>{mutation.receipt.receiptId}</code>
          {mutation.receipt.requestId ? <> · Request <code>{mutation.receipt.requestId}</code></> : null}
          {mutation.idempotent ? " · Existing matching receipt confirmed." : " · New receipt recorded."}
        </p>
      ) : null}
      {mutation.dependencyReconciliation?.resolvedCount > 0 ? (
        <p className="source-note" data-beo-dependency-reconciliation>
          This exact generation also resolved {mutation.dependencyReconciliation.resolvedCount} current Kitchen BEO invalidation{mutation.dependencyReconciliation.resolvedCount === 1 ? "" : "s"}. Other commercial decisions remain independently governed.
        </p>
      ) : null}
      {mutation.downloadState === "started" ? (
        <p className="source-note" role="status">
          The browser download was started. That does not prove the file was opened, reviewed, printed, or used.
        </p>
      ) : null}
      {mutation.downloadError ? (
        <p className="warning-note" role="alert">
          {mutation.downloadError} The trusted server receipt remains recorded; retry only the browser download.
        </p>
      ) : null}
      {view.action !== "none" ? (
        <button
          type="button"
          className={view.action === "generate" ? "cta compact" : "ghost compact"}
          data-capability-action={view.action}
          disabled={mutation.disabled === true || (view.action === "download" && !mutation.artifact)}
          onClick={() => onAction(view.action)}
        >
          {view.actionLabel}
        </button>
      ) : (
        <button type="button" className="ghost compact" disabled aria-busy={busy}>
          {view.actionLabel}
        </button>
      )}
    </section>
  );
}

export default function KitchenBeoArtifactPanel({
  open = true,
  presentation = "modal",
  organizationId = "",
  quoteId = "",
  quoteNumber = "",
  currentUserUid = "",
  currentUserRole = "customer",
  source = "firebase",
  sourceVersionId = "",
  available = true,
  onClose,
  onGenerated,
  onOpenProductionChecklist,
  onStatusChange,
  returnFocusRef = null
}) {
  const embedded = presentation === "embedded";
  const idPrefix = useId().replaceAll(":", "");
  const panelHeadingId = `${idPrefix}-kitchen-beo-panel-title`;
  const freshnessHeadingId = `${idPrefix}-kitchen-beo-freshness-title`;
  const generationHeadingId = `${idPrefix}-kitchen-beo-generation-title`;
  const identity = scopeIdentity(organizationId, quoteId);
  const identityRef = useRef(identity);
  const openRef = useRef(open);
  const readGenerationRef = useRef(0);
  const mutationGenerationRef = useRef(0);
  const receiptDownloadGenerationRef = useRef(0);
  const mutationInFlightRef = useRef(false);
  const receiptDownloadInFlightRef = useRef(false);
  const mutationStatusRef = useRef(null);
  const [read, setRead] = useState({ state: "loading", status: null, error: "" });
  const readRef = useRef(read);
  const [mutation, setMutation] = useState({
    state: "ready",
    pendingAttempt: null,
    receipt: null,
    artifact: null,
    dependencyReconciliation: null,
    idempotent: false,
    error: "",
    downloadState: "",
    downloadError: ""
  });
  const [receiptDownload, setReceiptDownload] = useState({ state: "ready", receiptId: "" });
  const [notesMutationBlocked, setNotesMutationBlocked] = useState(false);
  const { dialogRef } = useModalDialog({
    open: open && !embedded,
    onRequestClose: onClose,
    returnFocusRef
  });

  identityRef.current = identity;
  openRef.current = open;
  readRef.current = read;

  const scope = useMemo(() => ({ organizationId, quoteId }), [organizationId, quoteId]);
  const readView = READ_PRESENTATION[read.state] || READ_PRESENTATION.error;
  const freshnessState = buildKitchenBeoFreshnessPresentation(read.status).state;
  const readCapabilityState = read.state === "success"
    ? freshnessState === "NOT_GENERATED"
      ? "empty"
      : freshnessState === "UNKNOWN"
        ? "partial"
        : "success"
    : read.state;

  const isCurrentRead = (generation, requestIdentity) => (
    readGenerationRef.current === generation
    && identityRef.current === requestIdentity
    && openRef.current
  );
  const isCurrentMutation = (generation, requestIdentity) => (
    mutationGenerationRef.current === generation
    && identityRef.current === requestIdentity
    && openRef.current
  );
  const isCurrentReceiptDownload = (generation, requestIdentity) => (
    receiptDownloadGenerationRef.current === generation
    && identityRef.current === requestIdentity
    && openRef.current
  );

  const loadStatus = async ({ recovery = false } = {}) => {
    if (!openRef.current || !available) return;
    const requestIdentity = identityRef.current;
    const retainedStatus = readRef.current.status;
    const generation = readGenerationRef.current + 1;
    readGenerationRef.current = generation;
    setRead({
      state: recovery ? "recovery" : "loading",
      status: retainedStatus,
      error: ""
    });
    try {
      const status = await getKitchenBeoArtifactStatus(scope);
      if (!isCurrentRead(generation, requestIdentity)) return;
      setRead({ state: "success", status, error: "" });
      try {
        onStatusChange?.(status);
      } catch {
        // Presentation callbacks cannot invalidate an authoritative read.
      }
    } catch {
      if (!isCurrentRead(generation, requestIdentity)) return;
      setRead({
        state: retainedStatus ? "stale" : "error",
        status: retainedStatus,
        error: safeReadError()
      });
    }
  };

  useEffect(() => {
    readGenerationRef.current += 1;
    mutationGenerationRef.current += 1;
    receiptDownloadGenerationRef.current += 1;
    mutationInFlightRef.current = false;
    receiptDownloadInFlightRef.current = false;
    setNotesMutationBlocked(false);
    if (!open) return undefined;

    let pendingAttempt = null;
    try {
      pendingAttempt = readPendingKitchenBeoAttempt(scope);
    } catch {
      // The authoritative read below owns invalid-scope presentation.
    }
    setMutation({
      state: pendingAttempt?.definitive ? "error" : pendingAttempt ? "uncertain" : "ready",
      pendingAttempt,
      receipt: null,
      artifact: null,
      dependencyReconciliation: null,
      idempotent: false,
      error: pendingAttempt
        ? pendingAttempt.definitive
          ? "The previous exact generation request was definitively rejected."
          : "A previous exact generation request still requires reconciliation."
        : "",
      downloadState: "",
      downloadError: ""
    });
    setReceiptDownload({ state: "ready", receiptId: "" });

    if (!available) {
      setRead({
        state: "error",
        status: null,
        error: "Authoritative Kitchen BEO operations require a connected staff workspace."
      });
      return undefined;
    }

    setRead({ state: "loading", status: null, error: "" });
    void loadStatus();
    return () => {
      readGenerationRef.current += 1;
      mutationGenerationRef.current += 1;
      receiptDownloadGenerationRef.current += 1;
      mutationInFlightRef.current = false;
      receiptDownloadInFlightRef.current = false;
    };
    // Scope identity intentionally owns both read and mutation generations.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [available, identity, open]);

  useEffect(() => {
    if (mutation.state === "ready") return;
    mutationStatusRef.current?.focus({ preventScroll: true });
  }, [mutation.state]);

  const startDownload = (artifact) => {
    try {
      downloadKitchenBeoArtifact(artifact);
      setMutation((current) => ({
        ...current,
        downloadState: "started",
        downloadError: ""
      }));
    } catch {
      setMutation((current) => ({
        ...current,
        downloadState: "",
        downloadError: "The browser could not start the returned PDF download."
      }));
    }
  };

  const downloadRecordedReceipt = async (requestedReceiptId) => {
    const receiptId = text(requestedReceiptId, 180);
    const availableReceiptIds = Array.isArray(readRef.current.status?.receiptHistory?.receipts)
      ? readRef.current.status.receiptHistory.receipts.map((receipt) => text(receipt.receiptId, 180))
      : [];
    if (!availableReceiptIds.includes(receiptId)) return;
    if (!available || !receiptId || receiptDownloadInFlightRef.current) return;
    const requestIdentity = identityRef.current;
    const generation = receiptDownloadGenerationRef.current + 1;
    receiptDownloadGenerationRef.current = generation;
    receiptDownloadInFlightRef.current = true;
    setReceiptDownload({ state: "submitting", receiptId });
    try {
      const result = await getKitchenBeoReceiptArtifact({ ...scope, receiptId });
      if (!isCurrentReceiptDownload(generation, requestIdentity)) return;
      downloadKitchenBeoArtifact(result.artifact);
      setReceiptDownload({ state: "receipt", receiptId });
    } catch {
      if (!isCurrentReceiptDownload(generation, requestIdentity)) return;
      setReceiptDownload({ state: "error", receiptId });
    } finally {
      if (isCurrentReceiptDownload(generation, requestIdentity)) {
        receiptDownloadInFlightRef.current = false;
      }
    }
  };

  const runGeneration = async ({ reconcile = false } = {}) => {
    if (!available || notesMutationBlocked || mutationInFlightRef.current) return;
    const requestIdentity = identityRef.current;
    let pendingAttempt = mutation.pendingAttempt;
    try {
      pendingAttempt = pendingAttempt || readPendingKitchenBeoAttempt(scope);
    } catch {
      pendingAttempt = null;
    }
    if (reconcile && !pendingAttempt) {
      setMutation((current) => ({
        ...current,
        state: "error",
        error: "The exact pending request is unavailable. Refresh status before starting a new generation."
      }));
      return;
    }
    mutationInFlightRef.current = true;
    const generation = mutationGenerationRef.current + 1;
    mutationGenerationRef.current = generation;
    setMutation((current) => ({
      ...current,
      state: reconcile || pendingAttempt ? "reconciliation" : "submitting",
      pendingAttempt,
      receipt: null,
      artifact: null,
      dependencyReconciliation: null,
      idempotent: false,
      error: "",
      downloadState: "",
      downloadError: ""
    }));
    try {
      const result = await generateKitchenBeo(pendingAttempt || scope);
      if (!isCurrentMutation(generation, requestIdentity)) return;
      readGenerationRef.current += 1;
      setRead({ state: "success", status: result.status, error: "" });
      setMutation({
        state: "receipt",
        pendingAttempt: null,
        receipt: result.receipt,
        artifact: result.artifact,
        dependencyReconciliation: result.dependencyReconciliation,
        idempotent: result.idempotent === true,
        error: "",
        downloadState: "",
        downloadError: ""
      });
      try {
        onStatusChange?.(result.status);
      } catch {
        // Presentation callbacks cannot invalidate an authoritative receipt.
      }
      try {
        onGenerated?.(result);
      } catch {
        // Keep the receipt and returned artifact available when navigation feedback fails.
      }
      startDownload(result.artifact);
    } catch (error) {
      if (!isCurrentMutation(generation, requestIdentity)) return;
      let unresolvedAttempt = pendingAttempt;
      try {
        unresolvedAttempt = readPendingKitchenBeoAttempt(scope) || pendingAttempt;
      } catch {
        // Keep the attempt captured before dispatch when scope validation fails.
      }
      const definitive = isDefinitiveKitchenBeoError(error);
      setMutation({
        state: definitive ? "error" : "uncertain",
        pendingAttempt: unresolvedAttempt,
        receipt: null,
        artifact: null,
        dependencyReconciliation: null,
        idempotent: false,
        error: safeGenerationError(error),
        downloadState: "",
        downloadError: ""
      });
    } finally {
      if (isCurrentMutation(generation, requestIdentity)) mutationInFlightRef.current = false;
    }
  };

  const resetRejectedAttempt = () => {
    let reset = false;
    try {
      reset = resetDefinitiveKitchenBeoAttempt(scope);
    } catch {
      reset = false;
    }
    if (!reset) {
      setMutation((current) => ({
        ...current,
        state: "error",
        error: "The rejected request could not be cleared. Refresh status and reconcile the exact attempt."
      }));
      return;
    }
    setMutation({
      state: "recovery",
      pendingAttempt: null,
      receipt: null,
      artifact: null,
      dependencyReconciliation: null,
      idempotent: false,
      error: "",
      downloadState: "",
      downloadError: ""
    });
  };

  const handleMutationAction = (action) => {
    if (action === "generate") void runGeneration();
    if (action === "reconcile") void runGeneration({ reconcile: true });
    if (action === "reset") resetRejectedAttempt();
    if (action === "download" && mutation.artifact) startDownload(mutation.artifact);
  };

  if (!open) return null;

  const panel = (
    <div className={embedded ? "staff-capability-state" : "modal-card history-card"}>
      <div className="modal-head">
        <div>
          <p className="eyebrow">Production artifact</p>
          <h2 id={panelHeadingId}>
            Kitchen BEO{quoteNumber ? ` · ${text(quoteNumber, 80)}` : ""}
          </h2>
        </div>
        <div className="right-actions">
          <button
            type="button"
            className="ghost"
            data-capability-action="refresh-status"
            disabled={read.state === "loading" || read.state === "recovery"}
            onClick={() => void loadStatus({ recovery: read.state === "error" })}
          >
            {read.state === "recovery" ? "Retrying…" : "Refresh status"}
          </button>
          {typeof onClose === "function" ? (
            <button
              type="button"
              className="ghost"
              data-modal-initial-focus={embedded ? undefined : "true"}
              onClick={onClose}
            >
              {embedded ? "Back to quote" : "Close"}
            </button>
          ) : null}
        </div>
      </div>

      <section
        className="admin-section staff-capability-state"
        data-capability-id="cwf-15-kitchen-beo-artifact-status"
        data-capability-state={readCapabilityState}
        data-beo-status-read-state={read.state}
        aria-live="polite"
      >
        <div className="workflow-attention-head">
          <div>
            <p className="eyebrow">Authoritative status read</p>
            <h3>{readView.label}</h3>
          </div>
          <StatusChip family={readView.family} label={readView.label} />
        </div>
        <p className={new Set(["stale", "error"]).has(read.state) ? "warning-note" : "source-note"}>
          {readView.detail}
        </p>
        {read.error ? <p className="warning-note" role="alert">{read.error}</p> : null}
        {new Set(["error", "stale"]).has(read.state) ? (
          <button
            type="button"
            className="ghost compact"
            data-capability-state="recovery"
            data-capability-action="retry-status"
            onClick={() => void loadStatus({ recovery: true })}
          >
            Retry authoritative status
          </button>
        ) : null}
      </section>

      {read.status ? (
        <KitchenBeoFreshnessSummary
          status={read.status}
          headingId={freshnessHeadingId}
          receiptDownload={receiptDownload}
          onDownloadReceipt={(receiptId) => void downloadRecordedReceipt(receiptId)}
        />
      ) : null}

      <EventOperationalNotesPanel
        organizationId={organizationId}
        quoteId={quoteId}
        principalId={currentUserUid}
        role={currentUserRole}
        source={source}
        enabled={available}
        sourceVersionId={sourceVersionId}
        onNotesMutationBlockedChange={setNotesMutationBlocked}
        onOpenProductionChecklist={onOpenProductionChecklist}
        onChanged={() => void loadStatus({ recovery: true })}
      />

      <KitchenBeoMutationStatus
        mutation={{
          ...mutation,
          statusRef: mutationStatusRef,
          disabled: !available
            || notesMutationBlocked
            || read.state === "loading"
            || read.state === "recovery"
        }}
        onAction={handleMutationAction}
        headingId={generationHeadingId}
      />

      <aside className="source-note" data-beo-proof-boundary="generation-freshness-use">
        <strong>Evidence boundary:</strong> server generation, freshness, kitchen review, publication, and operational completion are tracked separately. Generating or downloading this PDF changes no proposal acceptance, booking, payment, portal, or customer-message state.
      </aside>
    </div>
  );

  if (embedded) {
    return (
      <section role="region" aria-labelledby={panelHeadingId}>
        {panel}
      </section>
    );
  }
  return (
    <div
      ref={dialogRef}
      className="modal-overlay"
      data-layout-overlap-allowed="true"
      role="dialog"
      aria-modal="true"
      aria-labelledby={panelHeadingId}
      tabIndex={-1}
    >
      {panel}
    </div>
  );
}
