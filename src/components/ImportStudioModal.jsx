import { useEffect, useMemo, useRef, useState } from "react";
import {
  createCustomerImportBatchId,
  createImportBatchId,
  createImportBatch,
  isCatalogImportType,
  MAX_IMPORT_RECORDS,
  rollbackImportBatch
} from "../lib/importBatchService";
import {
  buildImportPreview,
  detectImportType,
  getImportTypeDefinition,
  IMPORT_TYPES,
  parseCsvText,
  suggestFieldMapping
} from "../lib/importStudio";
import { useModalDialog } from "../hooks/useModalDialog";

const MAX_FILE_BYTES = 2 * 1024 * 1024;

function fieldLabel(value = "") {
  return String(value || "")
    .replace(/([a-z])([A-Z])/g, "$1 $2")
    .replace(/^./, (character) => character.toUpperCase());
}

function primaryValue(record = {}) {
  return record.name || record.email || "Untitled record";
}

const DEFINITIVE_IMPORT_ERROR_CODES = new Set([
  "already-exists",
  "failed-precondition",
  "invalid-argument",
  "not-found",
  "out-of-range",
  "permission-denied",
  "resource-exhausted",
  "unauthenticated"
]);

export function isDefinitiveImportMutationError(error) {
  const code = String(error?.code || "")
    .trim()
    .toLowerCase()
    .replace(/^functions\//, "");
  return DEFINITIVE_IMPORT_ERROR_CODES.has(code);
}

export function classifyImportMutationFailure({ error, catalogImport = false } = {}) {
  const code = String(error?.code || "")
    .trim()
    .toLowerCase()
    .replace(/^functions\//, "");
  if (catalogImport && code === "aborted") {
    return {
      phase: "recovery",
      preserveBatchIdentity: true,
      requiresCatalogRefresh: true
    };
  }
  if (isDefinitiveImportMutationError(error)) {
    return {
      phase: "error",
      preserveBatchIdentity: false,
      requiresCatalogRefresh: false
    };
  }
  return {
    phase: "uncertain",
    preserveBatchIdentity: true,
    requiresCatalogRefresh: false
  };
}

export function buildImportMutationResetGuard({
  phase = "idle",
  pendingImportBatchId = "",
  busy = false
} = {}) {
  const hasPendingIdentity = Boolean(String(pendingImportBatchId || "").trim());
  const blocked = busy || (
    hasPendingIdentity
    && ["submitting", "uncertain", "reconciling", "recovery"].includes(phase)
  );
  return {
    blocked,
    message: blocked
      ? "Reconcile the current import batch before closing, changing its source, or starting another import."
      : ""
  };
}

export function resolveImportBatchIdentity({
  pendingImportBatchId = "",
  catalogImport = false,
  createCatalogId = createImportBatchId,
  createCustomerId = createCustomerImportBatchId
} = {}) {
  const pending = String(pendingImportBatchId || "").trim();
  if (pending) return pending;
  return catalogImport ? createCatalogId() : createCustomerId();
}

export function advanceImportFileReadGeneration(generationRef) {
  if (!generationRef || typeof generationRef !== "object") return 0;
  const current = Number(generationRef.current || 0);
  generationRef.current = Number.isSafeInteger(current) && current >= 0 ? current + 1 : 1;
  return generationRef.current;
}

export function isImportFileReadGenerationCurrent(generationRef, readGeneration) {
  return Boolean(generationRef && typeof generationRef === "object")
    && Number(generationRef.current) === Number(readGeneration);
}

export function buildImportMutationPresentation({
  phase = "idle",
  operation = "import",
  readyCount = 0,
  error = "",
  receiptStatus = "",
  recoveryReady = false,
  recoveryRefreshBusy = false
} = {}) {
  const normalizedOperation = operation === "rollback" ? "rollback" : "import";
  const operationLabel = normalizedOperation === "rollback" ? "Undo" : "Import";
  const normalizedError = String(error || "").trim();
  const effectivePhase = normalizedError && ["idle", "ready"].includes(phase)
    ? "error"
    : phase;

  if (effectivePhase === "ready") {
    return {
      state: "ready",
      actionLabel: `Import ${Math.max(0, Number(readyCount || 0))} ready record(s)`,
      title: "Ready for review",
      detail: "Nothing has been written. A completed import is reported only after the server returns a receipt.",
      error: ""
    };
  }
  if (effectivePhase === "submitting") {
    return {
      state: "submitting",
      actionLabel: normalizedOperation === "rollback" ? "Undoing..." : "Importing...",
      title: normalizedOperation === "rollback" ? "Submitting undo request" : "Submitting import",
      detail: "Waiting for a server receipt before reporting a completed change. Close, source-change, and new-file actions stay locked to this batch identity.",
      error: normalizedError
    };
  }
  if (effectivePhase === "uncertain") {
    return {
      state: "uncertain",
      actionLabel: normalizedOperation === "rollback" ? "Reconcile undo" : "Reconcile import",
      title: `${operationLabel} outcome is uncertain.`,
      detail: "No server receipt returned. Retry to reconcile the same batch identity before assuming which records changed. Close, source-change, and new-file actions remain locked.",
      error: normalizedError
    };
  }
  if (effectivePhase === "reconciling") {
    return {
      state: "reconciliation",
      actionLabel: normalizedOperation === "rollback" ? "Reconciling undo..." : "Reconciling import...",
      title: normalizedOperation === "rollback" ? "Reconciling undo" : "Reconciling import",
      detail: "The same batch identity is being retried. Waiting for the server receipt that establishes the result; close and source replacement remain locked.",
      error: normalizedError
    };
  }
  if (effectivePhase === "success") {
    const rolledBack = receiptStatus === "rolled_back";
    return {
      state: "receipt",
      actionLabel: rolledBack ? "Undo reconciled" : "Import reconciled",
      title: rolledBack ? "Undo receipt confirmed" : "Import receipt confirmed",
      detail: "The server receipt establishes the recorded batch result. It does not imply any outbound message activity.",
      error: ""
    };
  }
  if (effectivePhase === "error") {
    return {
      state: "error",
      actionLabel: normalizedOperation === "rollback" ? "Retry undo" : "Retry import",
      title: `${operationLabel} needs attention.`,
      detail: "No completed change is assumed. Review the issue and retry when the source is ready.",
      error: normalizedError
    };
  }
  if (effectivePhase === "recovery") {
    return {
      state: "recovery",
      actionLabel: recoveryReady
        ? (normalizedOperation === "rollback" ? "Retry undo" : "Retry import")
        : (recoveryRefreshBusy ? "Refreshing source..." : "Retry source refresh"),
      title: recoveryReady ? `${operationLabel} source refreshed.` : `${operationLabel} source changed.`,
      detail: recoveryReady
        ? "The latest catalog revision is loaded. Retry the same batch identity to obtain a definitive receipt; no completed change is assumed."
        : "The same batch identity remains locked. Refresh the latest catalog source here before retrying; no completed change is assumed.",
      error: normalizedError
    };
  }
  return {
    state: "idle",
    actionLabel: "Choose CSV file",
    title: "No import has started",
    detail: "Nothing has been written to the organization.",
    error: ""
  };
}

export function ImportMutationStatus({ presentation, showPassive = false }) {
  if (!presentation) return null;
  if (!showPassive && ["idle", "ready"].includes(presentation.state)) return null;
  const alertState = ["uncertain", "error"].includes(presentation.state) || Boolean(presentation.error);
  return (
    <div
      className="import-mutation-status"
      data-capability-state={presentation.state}
      data-mutation-state={presentation.state}
      role={alertState ? "alert" : "status"}
    >
      <p className={alertState ? "warning-note" : "source-note"}>
        <strong>{presentation.title}</strong> {presentation.detail}
      </p>
      {presentation.error && <p className="error-note">{presentation.error}</p>}
    </div>
  );
}

export function ImportStudioView({
  open,
  onClose,
  presentation = "embedded",
  organizationId = "",
  organizationName = "",
  currentUserUid = "",
  currentUserEmail = "",
  catalogRevision = 0,
  onReload,
  onImported,
  returnFocusRef = null
}) {
  const embedded = presentation === "embedded";
  const fileInputRef = useRef(null);
  const fileReadGenerationRef = useRef(0);
  const [dragActive, setDragActive] = useState(false);
  const [fileName, setFileName] = useState("");
  const [headers, setHeaders] = useState([]);
  const [sourceRows, setSourceRows] = useState([]);
  const [importType, setImportType] = useState("customers");
  const [mapping, setMapping] = useState({});
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);
  const [receipt, setReceipt] = useState(null);
  const [pendingImportBatchId, setPendingImportBatchId] = useState("");
  const [mutationPhase, setMutationPhase] = useState("idle");
  const [mutationOperation, setMutationOperation] = useState("import");
  const [recoveryCatalogRevision, setRecoveryCatalogRevision] = useState(null);
  const [recoveryMutationError, setRecoveryMutationError] = useState("");

  const definition = getImportTypeDefinition(importType);
  const previewRows = useMemo(
    () => buildImportPreview({ rows: sourceRows, mapping, importType }),
    [sourceRows, mapping, importType]
  );
  const readyRows = useMemo(() => previewRows.filter((row) => row.ready), [previewRows]);
  const issueRows = useMemo(() => previewRows.filter((row) => !row.ready), [previewRows]);
  const recoveryReady = mutationPhase === "recovery"
    && recoveryCatalogRevision !== null
    && Number(catalogRevision || 0) !== recoveryCatalogRevision;
  const mutationPresentation = buildImportMutationPresentation({
    phase: mutationPhase,
    operation: mutationOperation,
    readyCount: readyRows.length,
    error,
    receiptStatus: receipt?.status,
    recoveryReady,
    recoveryRefreshBusy: busy && mutationPhase === "recovery"
  });
  const resetGuard = buildImportMutationResetGuard({
    phase: mutationPhase,
    pendingImportBatchId,
    busy
  });

  const reset = () => {
    advanceImportFileReadGeneration(fileReadGenerationRef);
    setDragActive(false);
    setFileName("");
    setHeaders([]);
    setSourceRows([]);
    setImportType("customers");
    setMapping({});
    setError("");
    setBusy(false);
    setReceipt(null);
    setPendingImportBatchId("");
    setMutationPhase("idle");
    setMutationOperation("import");
    setRecoveryCatalogRevision(null);
    setRecoveryMutationError("");
    if (fileInputRef.current) fileInputRef.current.value = "";
  };

  const handleReset = () => {
    if (resetGuard.blocked) {
      setError(resetGuard.message);
      return;
    }
    reset();
  };

  const handleClose = () => {
    if (resetGuard.blocked) {
      setError(resetGuard.message);
      return;
    }
    reset();
    onClose();
  };
  const { dialogRef } = useModalDialog({
    open: open && !embedded,
    onRequestClose: handleClose,
    canClose: !resetGuard.blocked,
    onCloseBlocked: () => setError(resetGuard.message),
    returnFocusRef
  });

  useEffect(() => {
    if (!open || !embedded || typeof window === "undefined") return undefined;
    const frame = window.requestAnimationFrame(() => {
      dialogRef.current?.focus({ preventScroll: true });
    });
    return () => window.cancelAnimationFrame(frame);
  }, [embedded, open]);

  useEffect(() => {
    if (open) return;
    advanceImportFileReadGeneration(fileReadGenerationRef);
  }, [open]);

  if (!open) return null;

  const loadFile = async (file) => {
    if (resetGuard.blocked) {
      setError(resetGuard.message);
      return;
    }
    const readGeneration = advanceImportFileReadGeneration(fileReadGenerationRef);
    setError("");
    setReceipt(null);
    setPendingImportBatchId("");
    setMutationPhase("idle");
    setMutationOperation("import");
    setRecoveryCatalogRevision(null);
    setRecoveryMutationError("");
    if (!file) return;
    if (!String(file.name || "").toLowerCase().endsWith(".csv")) {
      setError("Choose a CSV file. Excel support will follow in a later release.");
      return;
    }
    if (file.size > MAX_FILE_BYTES) {
      setError("CSV files are limited to 2 MB for this release.");
      return;
    }
    try {
      const sourceText = await file.text();
      if (!isImportFileReadGenerationCurrent(fileReadGenerationRef, readGeneration)) return;
      const parsed = parseCsvText(sourceText);
      if (!isImportFileReadGenerationCurrent(fileReadGenerationRef, readGeneration)) return;
      if (!parsed.headers.length || !parsed.rows.length) {
        setError("The CSV needs a header row and at least one data row.");
        return;
      }
      const detectedType = detectImportType(parsed.headers);
      setFileName(file.name);
      setHeaders(parsed.headers);
      setSourceRows(parsed.rows);
      setImportType(detectedType);
      setMapping(suggestFieldMapping(parsed.headers, detectedType));
      setMutationPhase("ready");
    } catch (err) {
      if (!isImportFileReadGenerationCurrent(fileReadGenerationRef, readGeneration)) return;
      setError(err?.message || "The CSV could not be read.");
    }
  };

  const handleTypeChange = (nextType) => {
    if (resetGuard.blocked) {
      setError(resetGuard.message);
      return;
    }
    setImportType(nextType);
    setMapping(suggestFieldMapping(headers, nextType));
    setReceipt(null);
    setPendingImportBatchId("");
    setError("");
    setMutationPhase("ready");
    setMutationOperation("import");
    setRecoveryCatalogRevision(null);
    setRecoveryMutationError("");
  };

  const refreshCatalogForRecovery = async (mutationError = recoveryMutationError || error) => {
    const baseError = String(mutationError || "The catalog source changed before the operation completed.").trim();
    setMutationPhase("recovery");
    setRecoveryCatalogRevision((current) => (
      current === null ? Number(catalogRevision || 0) : current
    ));
    setRecoveryMutationError(baseError);
    if (typeof onReload !== "function") {
      setError(`${baseError} The current batch identity remains locked; refresh the catalog source before retrying.`);
      return;
    }
    setBusy(true);
    try {
      await onReload();
      setError(baseError);
    } catch (reloadError) {
      setError(`${baseError} Catalog refresh failed: ${reloadError?.message || "try the source refresh again."} The same batch identity remains locked.`);
    } finally {
      setBusy(false);
    }
  };

  const handleImport = async () => {
    if (!organizationId) {
      setError("Your account does not have an organization destination.");
      return;
    }
    if (!readyRows.length) {
      setError("Resolve at least one valid row before importing.");
      return;
    }
    if (readyRows.length > MAX_IMPORT_RECORDS) {
      setError(`Import batches are limited to ${MAX_IMPORT_RECORDS} ready records.`);
      return;
    }
    const catalogImport = isCatalogImportType(importType);
    const confirmed = window.confirm([
      `Create up to ${readyRows.length} ${definition.label.toLowerCase()} record(s) in ${organizationName || organizationId} (${organizationId})?`,
      "Existing duplicates will be skipped and no messages will be sent.",
      catalogImport ? "If new records are created, catalog pricing confirmation will be cleared for review." : ""
    ].filter(Boolean).join(" "));
    if (!confirmed) return;
    const reconciliation = ["uncertain", "recovery"].includes(mutationPhase)
      && mutationOperation === "import";
    setBusy(true);
    setError("");
    setMutationOperation("import");
    setMutationPhase(reconciliation ? "reconciling" : "submitting");
    setRecoveryCatalogRevision(null);
    setRecoveryMutationError("");
    try {
      const importBatchId = resolveImportBatchIdentity({
        pendingImportBatchId,
        catalogImport
      });
      if (!pendingImportBatchId) setPendingImportBatchId(importBatchId);
      const result = await createImportBatch({
        organizationId,
        organizationName,
        importType,
        fileName,
        records: readyRows,
        actor: { uid: currentUserUid, email: currentUserEmail },
        importBatchId,
        expectedCatalogRevision: catalogImport ? Math.max(0, Number(catalogRevision || 0)) : undefined
      });
      setReceipt(result);
      setPendingImportBatchId("");
      setMutationPhase("success");
      setRecoveryMutationError("");
      if (typeof onImported === "function") onImported(result);
    } catch (err) {
      const mutationError = err?.message || "Import failed.";
      setError(mutationError);
      const failure = classifyImportMutationFailure({ error: err, catalogImport });
      if (failure.requiresCatalogRefresh) {
        await refreshCatalogForRecovery(mutationError);
      } else if (!failure.preserveBatchIdentity) {
        setPendingImportBatchId("");
        setMutationPhase(failure.phase);
      } else {
        setMutationPhase(failure.phase);
      }
    } finally {
      setBusy(false);
    }
  };

  const handleRollback = async () => {
    if (!receipt?.importBatchId) return;
    const catalogImport = isCatalogImportType(receipt.importType || importType);
    const confirmed = window.confirm([
      `Undo import ${receipt.importBatchId}?`,
      "Only unchanged records created by this import will be removed.",
      catalogImport ? "Records still used by packages or templates will be protected." : ""
    ].filter(Boolean).join(" "));
    if (!confirmed) return;
    const reconciliation = ["uncertain", "recovery"].includes(mutationPhase)
      && mutationOperation === "rollback";
    setBusy(true);
    setError("");
    setMutationOperation("rollback");
    setMutationPhase(reconciliation ? "reconciling" : "submitting");
    setRecoveryCatalogRevision(null);
    setRecoveryMutationError("");
    setPendingImportBatchId(receipt.importBatchId);
    try {
      const receiptRevision = Number(receipt.catalogRevisionAfter ?? receipt.catalogRevision ?? 0);
      const result = await rollbackImportBatch({
        organizationId,
        importBatchId: receipt.importBatchId,
        importType: receipt.importType || importType,
        expectedCatalogRevision: catalogImport
          ? Math.max(0, Number(catalogRevision || 0), Number.isSafeInteger(receiptRevision) ? receiptRevision : 0)
          : undefined
      });
      setReceipt((current) => ({ ...current, ...result }));
      setPendingImportBatchId("");
      setMutationPhase("success");
      setRecoveryMutationError("");
      if (typeof onImported === "function") onImported(result);
    } catch (err) {
      const mutationError = err?.message || "Rollback failed.";
      setError(mutationError);
      const failure = classifyImportMutationFailure({ error: err, catalogImport });
      if (failure.requiresCatalogRefresh) {
        await refreshCatalogForRecovery(mutationError);
      } else if (!failure.preserveBatchIdentity) {
        setPendingImportBatchId("");
        setMutationPhase(failure.phase);
      } else {
        setMutationPhase(failure.phase);
      }
    } finally {
      setBusy(false);
    }
  };

  return (
    <div
      ref={dialogRef}
      className={embedded ? "container workspace-route-main embedded-workspace-route" : "modal-overlay"}
      role={embedded ? "region" : "dialog"}
      aria-modal={embedded ? undefined : "true"}
      aria-labelledby="import-studio-title"
      tabIndex={-1}
    >
      <div className={`modal-card import-studio-card${embedded ? " workspace-route-card" : ""}`}>
        <header className="modal-head import-studio-head">
          <div>
            <p className="import-studio-kicker">Bring your business with you</p>
            <h2 id="import-studio-title">Import Studio</h2>
            <p>Turn customer and catalog spreadsheets into a clean, reviewable workspace.</p>
          </div>
          <button
            type="button"
            className="ghost"
            data-modal-initial-focus
            onClick={handleClose}
            disabled={resetGuard.blocked}
            title={resetGuard.message}
          >
            {embedded ? "Back to Home" : "Close"}
          </button>
        </header>

        <div className="import-destination-lock" aria-label="Locked import destination">
          <span>Destination locked</span>
          <strong>{organizationName || "Current organization"}</strong>
          <code>{organizationId || "No organization assigned"}</code>
          <small>Uploaded files cannot change this destination.</small>
        </div>

        <ImportMutationStatus presentation={mutationPresentation} showPassive />

        {!fileName && (
          <section
            className={`import-drop-zone ${dragActive ? "is-dragging" : ""}`.trim()}
            onDragEnter={(event) => { event.preventDefault(); setDragActive(true); }}
            onDragOver={(event) => event.preventDefault()}
            onDragLeave={(event) => { event.preventDefault(); setDragActive(false); }}
            onDrop={(event) => {
              event.preventDefault();
              setDragActive(false);
              loadFile(event.dataTransfer.files?.[0]);
            }}
          >
            <p className="import-drop-eyebrow">CSV intake</p>
            <h3>Drop a customer or catalog file here</h3>
            <p>We will suggest the record type and field mapping before anything is written.</p>
            <button type="button" className="cta" onClick={() => fileInputRef.current?.click()}>Choose CSV file</button>
            <input
              ref={fileInputRef}
              className="visually-hidden"
              type="file"
              accept=".csv,text/csv"
              onChange={(event) => loadFile(event.target.files?.[0])}
            />
            <small>No quotes, payments, contracts, bookings, emails, or text messages are created.</small>
          </section>
        )}

        {fileName && !receipt && (
          <>
            <section className="import-file-bar">
              <div>
                <span>File ready</span>
                <strong>{fileName}</strong>
                <small>{sourceRows.length} source row(s)</small>
              </div>
              <button
                type="button"
                className="ghost compact"
                onClick={handleReset}
                disabled={resetGuard.blocked}
                title={resetGuard.message}
              >
                Choose another file
              </button>
            </section>

            <section className="import-type-strip" aria-label="Record type">
              <div>
                <span>We think these are</span>
                <strong>{definition.label}</strong>
              </div>
              <label>
                Change record type
                <select
                  value={importType}
                  onChange={(event) => handleTypeChange(event.target.value)}
                  disabled={resetGuard.blocked}
                >
                  {IMPORT_TYPES.map((type) => <option key={type.id} value={type.id}>{type.label}</option>)}
                </select>
              </label>
            </section>

            <section className="import-mapping-section">
              <div className="import-section-heading">
                <div>
                  <span>Field recognition</span>
                  <h3>Confirm what each column means</h3>
                </div>
                <p>Suggested matches are editable. Unmapped optional fields are ignored.</p>
              </div>
              <div className="import-mapping-grid">
                {definition.fields.map((field) => (
                  <label key={field}>
                    <span>{fieldLabel(field)}</span>
                    <select
                      value={mapping[field] || ""}
                      disabled={resetGuard.blocked}
                      onChange={(event) => {
                        setMapping((current) => ({ ...current, [field]: event.target.value }));
                        setError("");
                        setMutationPhase("ready");
                        setMutationOperation("import");
                      }}
                    >
                      <option value="">Do not import</option>
                      {headers.map((header) => <option key={header} value={header}>{header}</option>)}
                    </select>
                  </label>
                ))}
              </div>
            </section>

            <section className="import-review-section">
              <div className="import-review-metrics">
                <div><span>Ready</span><strong>{readyRows.length}</strong></div>
                <div><span>Need attention</span><strong>{issueRows.length}</strong></div>
                <div><span>Destination</span><strong>{organizationId}</strong></div>
              </div>
              <div className="import-preview-table-wrap">
                <table>
                  <thead><tr><th>Row</th><th>Record</th><th>Status</th><th>Details</th></tr></thead>
                  <tbody>
                    {previewRows.slice(0, 12).map((row) => (
                      <tr key={row.rowNumber} className={row.ready ? "is-ready" : "has-issues"}>
                        <td>{row.rowNumber}</td>
                        <td>{primaryValue(row.record)}</td>
                        <td>{row.ready ? "Ready" : "Needs attention"}</td>
                        <td>{row.errors.join("; ") || "No messages will be sent"}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
              {previewRows.length > 12 && <p className="source-note">Showing 12 of {previewRows.length} rows.</p>}
            </section>

            <footer className="modal-foot import-studio-foot">
              <p>
                {readyRows.length > MAX_IMPORT_RECORDS
                  ? `Split this file into batches of ${MAX_IMPORT_RECORDS} ready records or fewer.`
                  : mutationPresentation.detail}
              </p>
              <button
                type="button"
                className="cta"
                disabled={
                  busy
                  || !readyRows.length
                  || readyRows.length > MAX_IMPORT_RECORDS
                  || (mutationPhase === "recovery" && !recoveryReady && typeof onReload !== "function")
                }
                onClick={mutationPhase === "recovery" && !recoveryReady
                  ? () => refreshCatalogForRecovery()
                  : handleImport}
              >
                {mutationPresentation.actionLabel}
              </button>
            </footer>
          </>
        )}

        {receipt && (
          <section className="import-receipt" aria-live="polite">
            <p className="import-studio-kicker">Import receipt</p>
            <h3>{receipt.status === "rolled_back" ? "Import safely undone" : `${organizationName || organizationId} is updated`}</h3>
            <div className="import-review-metrics">
              <div>
                <span>{receipt.status === "rolled_back" ? "Removed" : "Created"}</span>
                <strong>{receipt.status === "rolled_back" ? (receipt.deletedCount || 0) : (receipt.createdCount || 0)}</strong>
              </div>
              <div>
                <span>
                  {receipt.status === "rolled_back"
                    ? (isCatalogImportType(receipt.importType || importType) ? "Protected" : "Protected edits")
                    : "Skipped"}
                </span>
                <strong>{receipt.status === "rolled_back" ? (receipt.protectedCount || 0) : (receipt.skippedCount || 0)}</strong>
              </div>
              <div><span>Batch</span><strong className="import-batch-id">{receipt.importBatchId}</strong></div>
            </div>
            <p>
              {receipt.status === "rolled_back"
                ? (isCatalogImportType(receipt.importType || importType)
                    ? "Only unchanged records stamped by this batch were removed. Edited records and records still used by packages or templates were protected."
                    : "Only unchanged records stamped by this batch were removed. Records edited after import were protected.")
                : (isCatalogImportType(receipt.importType || importType) && Number(receipt.createdCount || 0) > 0
                    ? "Prices were stored in integer minor units. Review and confirm catalog pricing before activation; existing duplicates were left unchanged."
                    : isCatalogImportType(receipt.importType || importType)
                      ? "No new catalog records were needed. Existing duplicates and current pricing confirmation were left unchanged."
                    : "No outbound messages were sent. Existing duplicate records were left unchanged.")}
            </p>
            <div className="right-actions">
              {receipt.status !== "rolled_back" && (
                <button
                  type="button"
                  className="ghost danger"
                  disabled={busy || (mutationPhase === "recovery" && !recoveryReady && typeof onReload !== "function")}
                  onClick={mutationPhase === "recovery" && !recoveryReady
                    ? () => refreshCatalogForRecovery()
                    : handleRollback}
                >
                  {mutationOperation === "rollback" && ["uncertain", "reconciling", "submitting", "error", "recovery"].includes(mutationPhase)
                    ? mutationPresentation.actionLabel
                    : "Undo this import"}
                </button>
              )}
              <button
                type="button"
                className="ghost"
                onClick={handleReset}
                disabled={resetGuard.blocked}
                title={resetGuard.message}
              >
                Import another file
              </button>
              <button
                type="button"
                className="cta"
                onClick={handleClose}
                disabled={resetGuard.blocked}
                title={resetGuard.message}
              >
                Return to workspace
              </button>
            </div>
          </section>
        )}
      </div>
    </div>
  );
}

export default function ImportStudioModal(props) {
  return <ImportStudioView {...props} presentation="modal" />;
}
