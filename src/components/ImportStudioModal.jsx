import { useMemo, useRef, useState } from "react";
import {
  createImportBatch,
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

export default function ImportStudioModal({
  open,
  onClose,
  organizationId = "",
  organizationName = "",
  currentUserUid = "",
  currentUserEmail = "",
  onImported,
  returnFocusRef = null
}) {
  const fileInputRef = useRef(null);
  const [dragActive, setDragActive] = useState(false);
  const [fileName, setFileName] = useState("");
  const [headers, setHeaders] = useState([]);
  const [sourceRows, setSourceRows] = useState([]);
  const [importType, setImportType] = useState("customers");
  const [mapping, setMapping] = useState({});
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);
  const [receipt, setReceipt] = useState(null);

  const definition = getImportTypeDefinition(importType);
  const previewRows = useMemo(
    () => buildImportPreview({ rows: sourceRows, mapping, importType }),
    [sourceRows, mapping, importType]
  );
  const readyRows = useMemo(() => previewRows.filter((row) => row.ready), [previewRows]);
  const issueRows = useMemo(() => previewRows.filter((row) => !row.ready), [previewRows]);

  const reset = () => {
    setDragActive(false);
    setFileName("");
    setHeaders([]);
    setSourceRows([]);
    setImportType("customers");
    setMapping({});
    setError("");
    setBusy(false);
    setReceipt(null);
    if (fileInputRef.current) fileInputRef.current.value = "";
  };

  const handleClose = () => {
    if (busy) {
      setError("Wait for the current import operation to finish before closing.");
      return;
    }
    reset();
    onClose();
  };
  const { dialogRef } = useModalDialog({
    open,
    onRequestClose: handleClose,
    canClose: !busy,
    onCloseBlocked: () => setError("Wait for the current import operation to finish before closing."),
    returnFocusRef
  });

  if (!open) return null;

  const loadFile = async (file) => {
    setError("");
    setReceipt(null);
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
      const parsed = parseCsvText(await file.text());
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
    } catch (err) {
      setError(err?.message || "The CSV could not be read.");
    }
  };

  const handleTypeChange = (nextType) => {
    setImportType(nextType);
    setMapping(suggestFieldMapping(headers, nextType));
    setReceipt(null);
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
    const confirmed = window.confirm(
      `Create up to ${readyRows.length} ${definition.label.toLowerCase()} record(s) in ${organizationName || organizationId} (${organizationId})? Existing duplicates will be skipped and no messages will be sent.`
    );
    if (!confirmed) return;
    setBusy(true);
    setError("");
    try {
      const result = await createImportBatch({
        organizationId,
        organizationName,
        importType,
        fileName,
        records: readyRows,
        actor: { uid: currentUserUid, email: currentUserEmail }
      });
      setReceipt(result);
      if (typeof onImported === "function") onImported(result);
    } catch (err) {
      setError(err?.message || "Import failed.");
    } finally {
      setBusy(false);
    }
  };

  const handleRollback = async () => {
    if (!receipt?.importBatchId) return;
    const confirmed = window.confirm(
      `Undo import ${receipt.importBatchId}? Only records created by this import will be removed.`
    );
    if (!confirmed) return;
    setBusy(true);
    setError("");
    try {
      const result = await rollbackImportBatch({ organizationId, importBatchId: receipt.importBatchId });
      setReceipt((current) => ({ ...current, ...result }));
      if (typeof onImported === "function") onImported(result);
    } catch (err) {
      setError(err?.message || "Rollback failed.");
    } finally {
      setBusy(false);
    }
  };

  return (
    <div
      ref={dialogRef}
      className="modal-overlay"
      role="dialog"
      aria-modal="true"
      aria-labelledby="import-studio-title"
      tabIndex={-1}
    >
      <div className="modal-card import-studio-card">
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
            disabled={busy}
          >
            Close
          </button>
        </header>

        <div className="import-destination-lock" aria-label="Locked import destination">
          <span>Destination locked</span>
          <strong>{organizationName || "Current organization"}</strong>
          <code>{organizationId || "No organization assigned"}</code>
          <small>Uploaded files cannot change this destination.</small>
        </div>

        {error && <p className="error-note" role="alert">{error}</p>}

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
              <button type="button" className="ghost compact" onClick={reset}>Choose another file</button>
            </section>

            <section className="import-type-strip" aria-label="Record type">
              <div>
                <span>We think these are</span>
                <strong>{definition.label}</strong>
              </div>
              <label>
                Change record type
                <select value={importType} onChange={(event) => handleTypeChange(event.target.value)}>
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
                      onChange={(event) => setMapping((current) => ({ ...current, [field]: event.target.value }))}
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
                  : "Create ready records, skip existing duplicates, and save a reversible receipt."}
              </p>
              <button
                type="button"
                className="cta"
                disabled={busy || !readyRows.length || readyRows.length > MAX_IMPORT_RECORDS}
                onClick={handleImport}
              >
                {busy ? "Importing..." : `Import ${readyRows.length} ready record(s)`}
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
                <span>{receipt.status === "rolled_back" ? "Protected edits" : "Skipped"}</span>
                <strong>{receipt.status === "rolled_back" ? (receipt.protectedCount || 0) : (receipt.skippedCount || 0)}</strong>
              </div>
              <div><span>Batch</span><strong className="import-batch-id">{receipt.importBatchId}</strong></div>
            </div>
            <p>
              {receipt.status === "rolled_back"
                ? "Only unchanged records stamped by this batch were removed. Records edited after import were protected."
                : "No outbound messages were sent. Existing duplicate records were left unchanged."}
            </p>
            <div className="right-actions">
              {receipt.status !== "rolled_back" && (
                <button type="button" className="ghost danger" disabled={busy} onClick={handleRollback}>
                  {busy ? "Undoing..." : "Undo this import"}
                </button>
              )}
              <button type="button" className="ghost" onClick={reset}>Import another file</button>
              <button type="button" className="cta" onClick={handleClose}>Return to workspace</button>
            </div>
          </section>
        )}
      </div>
    </div>
  );
}
