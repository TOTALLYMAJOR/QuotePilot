import { useEffect, useMemo, useRef, useState } from "react";
import {
  createCustomerImportSession,
  createCustomerImportBatchId,
  createImportBatchId,
  isCatalogImportType,
  MAX_IMPORT_SESSION_RECORDS,
  preflightCustomerImport,
  rollbackImportBatch
} from "../lib/importBatchService";
import {
  preflightCatalogImportDraft,
  stageCatalogImportDraft
} from "../lib/catalogSetupDraftService";
import {
  buildImportPreview,
  detectImportType,
  getImportTypeDefinition,
  IMPORT_TYPES,
  parseCsvSource,
  suggestFieldMapping,
  validateFieldMapping
} from "../lib/importWorkbenchModel";
import { extractSearchablePdf } from "../lib/pdfImport";
import { useModalDialog } from "../hooks/useModalDialog";
import FieldStateIndicator from "./FieldStateIndicator";
import AdaptiveChoiceField from "./AdaptiveChoiceField";

const MAX_CSV_FILE_BYTES = 5 * 1024 * 1024;
const MAX_PDF_FILE_BYTES = 12 * 1024 * 1024;
export const IMPORT_REVIEW_PAGE_SIZE = 50;

const WORKBENCH_STEPS = Object.freeze([
  ["source", "Choose source"],
  ["inspect", "Inspect source"],
  ["records", "Confirm records"],
  ["mapping", "Map fields"],
  ["issues", "Resolve issues"],
  ["preflight", "Preflight plan"],
  ["import", "Authoritative import"],
  ["activate", "Review and publish"]
]);

function fieldLabel(value = "") {
  return String(value || "")
    .replace(/([a-z])([A-Z])/g, "$1 $2")
    .replace(/^./, (character) => character.toUpperCase());
}

function primaryValue(record = {}) {
  return record.name || record.email || "Untitled record";
}

export function buildImportReviewSignature(rows = []) {
  return JSON.stringify(Array.isArray(rows) ? rows : []);
}

export function paginateImportReviewRows(rows = [], requestedPage = 1, pageSize = IMPORT_REVIEW_PAGE_SIZE) {
  const source = Array.isArray(rows) ? rows : [];
  const safePageSize = Number.isSafeInteger(pageSize) && pageSize > 0 ? pageSize : IMPORT_REVIEW_PAGE_SIZE;
  const pageCount = Math.max(1, Math.ceil(source.length / safePageSize));
  const numericPage = Number(requestedPage);
  const page = Math.min(pageCount, Math.max(1, Number.isSafeInteger(numericPage) ? numericPage : 1));
  const startIndex = (page - 1) * safePageSize;
  const endIndex = Math.min(source.length, startIndex + safePageSize);
  return {
    rows: source.slice(startIndex, endIndex),
    page,
    pageCount,
    total: source.length,
    rangeStart: source.length ? startIndex + 1 : 0,
    rangeEnd: endIndex
  };
}

function exactReviewValue(record = {}, field = "") {
  if (field === "eventType") {
    const label = String(record.eventTypeName || record.eventType || "").trim();
    const id = String(record.eventTypeId || "").trim();
    return label && id && label !== id ? `${label} (${id})` : label || id || "Not provided";
  }
  if (field === "category") {
    const label = String(record.categoryName || record.category || "").trim();
    const id = String(record.categoryId || "").trim();
    return label && id && label !== id ? `${label} (${id})` : label || id || "Not provided";
  }
  const relationshipTargets = {
    includedMenuItems: "includedMenuItemIds",
    includedAddons: "includedAddonIds",
    includedRentals: "includedRentalIds"
  };
  if (relationshipTargets[field]) {
    const source = String(record[field] || "").trim();
    const ids = Array.isArray(record[relationshipTargets[field]])
      ? record[relationshipTargets[field]].map(String).filter(Boolean)
      : [];
    if (source && ids.length) return `${source} → ${ids.join(", ")}`;
    return source || ids.join(", ") || "Not provided";
  }
  const value = record[field];
  if (["type", "pricingType"].includes(field) && typeof value === "string" && value) {
    return `${value.replaceAll("_", " ")} (${value})`;
  }
  if (typeof value === "boolean") return value ? "Yes" : "No";
  if (Array.isArray(value)) return value.length ? value.join(", ") : "Not provided";
  if (value === null || value === undefined || String(value).trim() === "") return "Not provided";
  return String(value);
}

function fieldRecoveryProps(row, field) {
  const state = row?.fieldStates?.[field] || {};
  const needsRecovery = Object.values(state).some((value) => (
    ["failed", "unavailable", "stale", "blocked"].includes(value)
  ));
  if (!needsRecovery) return {};
  return {
    reason: row.errors?.join("; ") || "This inferred value could not be established.",
    recoveryAction: {
      label: "Review mapping",
      onClick: () => document.getElementById("import-mapping-title")?.scrollIntoView?.({ block: "start" })
    }
  };
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
  if (Array.isArray(error?.partialResult?.childReceipts) && error.partialResult.childReceipts.length > 0) {
    return {
      phase: "partial",
      preserveBatchIdentity: true,
      requiresCatalogRefresh: false
    };
  }
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
  const blocked = busy || hasPendingIdentity;
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
      actionLabel: normalizedOperation === "rollback" ? "Check this undo" : "Check this import",
      title: `${operationLabel} outcome is uncertain.`,
      detail: "No server receipt returned. Retry to reconcile the same batch identity before assuming which records changed. Close, source-change, and new-file actions remain locked.",
      error: normalizedError
    };
  }
  if (effectivePhase === "partial") {
    return {
      state: "partial",
      actionLabel: normalizedOperation === "rollback" ? "Resume this undo" : "Resume this import",
      title: `Part of this ${normalizedOperation === "rollback" ? "undo" : "import"} is confirmed.`,
      detail: normalizedOperation === "rollback"
        ? "At least one removal has a server receipt. Resume with the same batch identity; confirmed removals replay safely and the remaining work is retried."
        : "At least one child batch has a server receipt. Resume with the same session identity; completed parts replay safely and the remaining part is retried.",
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
      title: rolledBack ? "Undo confirmed" : "Import confirmed",
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
        ? (normalizedOperation === "rollback" ? "Retry undo" : "Run preflight again")
        : (recoveryRefreshBusy ? "Refreshing source..." : "Retry source refresh"),
      title: recoveryReady ? `${operationLabel} source refreshed.` : `${operationLabel} source changed.`,
      detail: recoveryReady
        ? (normalizedOperation === "rollback"
            ? "The latest catalog revision is loaded. Retry the same batch identity to obtain a definitive receipt; no completed change is assumed."
            : "The source refresh completed. Run preflight again to bind this same batch identity to the latest shared-draft generation; no completed change is assumed.")
        : "The same batch identity remains locked. Refresh the latest catalog source here before retrying; no completed change is assumed.",
      error: normalizedError
    };
  }
  return {
    state: "idle",
    actionLabel: "Choose CSV file",
    title: "Ready when you are",
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
  catalogContext = {},
  onReload,
  onReviewCatalog,
  onImported,
  returnFocusRef = null
}) {
  const embedded = presentation === "embedded";
  const fileInputRef = useRef(null);
  const fileReadGenerationRef = useRef(0);
  const [dragActive, setDragActive] = useState(false);
  const [sourceKind, setSourceKind] = useState("");
  const [sourceDetails, setSourceDetails] = useState(null);
  const [sourceDiagnostics, setSourceDiagnostics] = useState([]);
  const [fileName, setFileName] = useState("");
  const [headers, setHeaders] = useState([]);
  const [sourceRows, setSourceRows] = useState([]);
  const [importType, setImportType] = useState("customers");
  const [mapping, setMapping] = useState({});
  const [constantValues, setConstantValues] = useState({});
  const [excludedRows, setExcludedRows] = useState(() => new Set());
  const [reviewFilter, setReviewFilter] = useState("all");
  const [reviewPage, setReviewPage] = useState(1);
  const [preflight, setPreflight] = useState(null);
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);
  const [receipt, setReceipt] = useState(null);
  const [pendingImportBatchId, setPendingImportBatchId] = useState("");
  const [mutationPhase, setMutationPhase] = useState("idle");
  const [mutationOperation, setMutationOperation] = useState("import");
  const [recoverySourceState, setRecoverySourceState] = useState("idle");
  const [recoveryMutationError, setRecoveryMutationError] = useState("");

  const definition = getImportTypeDefinition(importType);
  const allRelationshipChoices = useMemo(() => ({
    eventType: (Array.isArray(catalogContext?.eventTypes) ? catalogContext.eventTypes : [])
      .map((entry) => ({ value: String(entry?.id || "").trim(), label: String(entry?.name || entry?.id || "").trim() }))
      .filter((entry) => entry.value && entry.label),
    category: [
      ...(Array.isArray(catalogContext?.categories) ? catalogContext.categories : []),
      ...(Array.isArray(catalogContext?.menuSections) ? catalogContext.menuSections : [])
    ]
      .map((entry) => ({
        value: String(entry?.id || entry?.categoryId || "").trim(),
        label: String(entry?.name || entry?.id || "").trim(),
        eventTypeId: String(entry?.eventTypeId || catalogContext?.eventTypeId || "").trim()
      }))
      .filter((entry, index, values) => entry.value && entry.label && values.findIndex((candidate) => candidate.value === entry.value) === index)
  }), [catalogContext]);
  const relationshipChoices = useMemo(() => {
    const selectedEventTypeId = mapping.eventType ? "" : String(constantValues.eventType || "").trim();
    return {
      eventType: allRelationshipChoices.eventType,
      category: selectedEventTypeId
        ? allRelationshipChoices.category.filter((entry) => entry.eventTypeId === selectedEventTypeId)
        : allRelationshipChoices.category
    };
  }, [allRelationshipChoices, constantValues.eventType, mapping.eventType]);
  const mappingDiagnostics = useMemo(() => validateFieldMapping(mapping), [mapping]);
  const unmappedHeaders = useMemo(() => {
    const mapped = new Set(Object.values(mapping).filter(Boolean));
    return headers.filter((header) => !mapped.has(header));
  }, [headers, mapping]);
  const previewRows = useMemo(
    () => buildImportPreview({ rows: sourceRows, mapping, constants: constantValues, importType, catalogContext }),
    [sourceRows, mapping, constantValues, importType, catalogContext]
  );
  const readyRows = useMemo(
    () => previewRows.filter((row) => row.ready && !excludedRows.has(row.rowNumber)),
    [excludedRows, previewRows]
  );
  const readyRowsSignature = useMemo(() => buildImportReviewSignature(readyRows), [readyRows]);
  const issueRows = useMemo(() => previewRows.filter((row) => !row.ready), [previewRows]);
  const includedIssueCount = issueRows.filter((row) => !excludedRows.has(row.rowNumber)).length;
  const filteredPreviewRows = useMemo(() => previewRows.filter((row) => {
    if (reviewFilter === "issues") return !row.ready && !excludedRows.has(row.rowNumber);
    if (reviewFilter === "ready") return row.ready && !excludedRows.has(row.rowNumber);
    if (reviewFilter === "excluded") return excludedRows.has(row.rowNumber);
    return true;
  }), [excludedRows, previewRows, reviewFilter]);
  const reviewPagination = useMemo(
    () => paginateImportReviewRows(filteredPreviewRows, reviewPage),
    [filteredPreviewRows, reviewPage]
  );
  const sourceBlocked = sourceDiagnostics.some((diagnostic) => diagnostic.severity === "error");
  const preflightCurrent = Boolean(preflight)
    && preflight.importType === importType
    && preflight.readyCount === readyRows.length
    && preflight.reviewSignature === readyRowsSignature
    && (
      !isCatalogImportType(importType)
      || Number(preflight.currentCatalogRevision) === Number(catalogRevision || 0)
    );
  const recoveryReady = mutationPhase === "recovery"
    && recoverySourceState === "refreshed";
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
  const catalogRecoveryMayReview = isCatalogImportType(importType)
    && mutationOperation === "import"
    && mutationPhase === "recovery"
    && recoveryReady;
  const catalogRecoveryMayPreflight = catalogRecoveryMayReview;
  const reviewInteractionBlocked = resetGuard.blocked && !catalogRecoveryMayReview;
  const preflightInteractionBlocked = resetGuard.blocked && !catalogRecoveryMayPreflight;
  const recoveryNeedsSourceRefresh = mutationPhase === "recovery" && !recoveryReady;
  const recoveryNeedsPreflight = mutationPhase === "recovery" && recoveryReady && !preflightCurrent;
  const mayReleaseNoWriteCatalogRecovery = isCatalogImportType(importType)
    && mutationOperation === "import"
    && mutationPhase === "recovery"
    && Boolean(pendingImportBatchId);
  const footerActionDisabled = busy
    || !readyRows.length
    || readyRows.length > MAX_IMPORT_SESSION_RECORDS
    || (recoveryNeedsSourceRefresh
      ? typeof onReload !== "function"
      : recoveryNeedsPreflight
        ? sourceBlocked || includedIssueCount > 0 || mappingDiagnostics.some((diagnostic) => diagnostic.severity === "error")
        : !preflightCurrent);

  useEffect(() => {
    setConstantValues((current) => {
      let changed = false;
      const next = { ...current };
      for (const field of ["eventType", "category"]) {
        if (!definition.fields.includes(field) || mapping[field]) {
          if (next[field]) {
            delete next[field];
            changed = true;
          }
          continue;
        }
        const options = relationshipChoices[field] || [];
        const currentStillExists = options.some((option) => option.value === next[field]);
        const desired = options.length === 1 ? options[0].value : currentStillExists ? next[field] : "";
        if ((next[field] || "") !== desired) {
          next[field] = desired;
          changed = true;
        }
      }
      return changed ? next : current;
    });
  }, [definition.fields, mapping, relationshipChoices]);

  useEffect(() => {
    setPreflight(null);
  }, [constantValues]);

  useEffect(() => {
    if (reviewPage !== reviewPagination.page) setReviewPage(reviewPagination.page);
  }, [reviewPage, reviewPagination.page]);

  const reset = () => {
    advanceImportFileReadGeneration(fileReadGenerationRef);
    setDragActive(false);
    setSourceKind("");
    setSourceDetails(null);
    setSourceDiagnostics([]);
    setFileName("");
    setHeaders([]);
    setSourceRows([]);
    setImportType("customers");
    setMapping({});
    setConstantValues({});
    setExcludedRows(new Set());
    setReviewFilter("all");
    setReviewPage(1);
    setPreflight(null);
    setError("");
    setBusy(false);
    setReceipt(null);
    setPendingImportBatchId("");
    setMutationPhase("idle");
    setMutationOperation("import");
    setRecoverySourceState("idle");
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

  const activeStepIndex = receipt
    ? 7
    : busy && ["submitting", "reconciling"].includes(mutationPhase)
      ? 6
      : preflightCurrent
        ? 5
        : fileName
          ? (includedIssueCount > 0 ? 4 : 3)
          : 0;

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
    setRecoverySourceState("idle");
    setRecoveryMutationError("");
    setPreflight(null);
    setExcludedRows(new Set());
    setReviewPage(1);
    if (!file) return;
    const lowerName = String(file.name || "").toLowerCase();
    const nextSourceKind = lowerName.endsWith(".pdf") ? "pdf" : lowerName.endsWith(".csv") ? "csv" : "";
    if (!nextSourceKind) {
      setError("Choose a CSV or searchable PDF file. Excel and scanned PDFs are not accepted in this release.");
      return;
    }
    const byteLimit = nextSourceKind === "pdf" ? MAX_PDF_FILE_BYTES : MAX_CSV_FILE_BYTES;
    if (file.size > byteLimit) {
      setError(`${nextSourceKind.toUpperCase()} files are limited to ${Math.round(byteLimit / 1024 / 1024)} MB for an inspectable review.`);
      return;
    }
    try {
      const parsed = nextSourceKind === "pdf"
        ? await extractSearchablePdf(file)
        : parseCsvSource(await file.text());
      if (!isImportFileReadGenerationCurrent(fileReadGenerationRef, readGeneration)) return;
      if (!parsed.headers.length || !parsed.rows.length) {
        setError(nextSourceKind === "pdf"
          ? "The PDF text layer did not yield any reviewable catalog records."
          : "The CSV needs a header row and at least one data row.");
        return;
      }
      const detectedType = parsed.detectedImportType || detectImportType(parsed.headers);
      if (nextSourceKind === "pdf" && detectedType === "customers") {
        setError("PDF customer imports are intentionally unavailable. Export customer data as CSV so identity fields remain explicit.");
        return;
      }
      setSourceKind(nextSourceKind);
      setSourceDetails(parsed.source || {
        kind: "csv",
        fileName: file.name,
        delimiter: parsed.delimiter,
        inferredRowCount: parsed.rows.length
      });
      setSourceDiagnostics(parsed.diagnostics || []);
      setFileName(file.name);
      setHeaders(parsed.headers);
      setSourceRows(parsed.rows);
      setImportType(detectedType);
      setMapping(suggestFieldMapping(parsed.headers, detectedType));
      setConstantValues({});
      setReviewFilter("all");
      setReviewPage(1);
      setMutationPhase("ready");
    } catch (err) {
      if (!isImportFileReadGenerationCurrent(fileReadGenerationRef, readGeneration)) return;
      setError(err?.message || "The source file could not be inspected.");
    }
  };

  const handleTypeChange = (nextType) => {
    if (resetGuard.blocked) {
      setError(resetGuard.message);
      return;
    }
    setImportType(nextType);
    setMapping(suggestFieldMapping(headers, nextType));
    setConstantValues({});
    setReviewFilter("all");
    setReviewPage(1);
    setReceipt(null);
    setPreflight(null);
    setExcludedRows(new Set());
    setPendingImportBatchId("");
    setError("");
    setMutationPhase("ready");
    setMutationOperation("import");
    setRecoverySourceState("idle");
    setRecoveryMutationError("");
  };

  const toggleRowExclusion = (rowNumber) => {
    if (reviewInteractionBlocked) {
      setError(resetGuard.message);
      return;
    }
    setExcludedRows((current) => {
      const next = new Set(current);
      if (next.has(rowNumber)) next.delete(rowNumber);
      else next.add(rowNumber);
      return next;
    });
    setPreflight(null);
    setError("");
    setMutationPhase(catalogRecoveryMayReview ? "recovery" : "ready");
  };

  const excludeRowsNeedingAttention = () => {
    if (reviewInteractionBlocked) {
      setError(resetGuard.message);
      return;
    }
    setExcludedRows((current) => {
      const next = new Set(current);
      issueRows.forEach((row) => next.add(row.rowNumber));
      return next;
    });
    setPreflight(null);
    setError("");
    setMutationPhase(catalogRecoveryMayReview ? "recovery" : "ready");
  };

  const refreshCatalogForRecovery = async (
    mutationError = recoveryMutationError || error,
    recoveryOperation = mutationOperation
  ) => {
    const baseError = String(mutationError || "The catalog source changed before the operation completed.").trim();
    setMutationPhase("recovery");
    setRecoverySourceState("refreshing");
    setRecoveryMutationError(baseError);
    if (recoveryOperation === "import") setPreflight(null);
    if (typeof onReload !== "function") {
      setRecoverySourceState("refreshed");
      setError(`${baseError} Run preflight again to read the latest shared-draft generation. The same batch identity remains locked.`);
      return;
    }
    setBusy(true);
    try {
      await onReload();
      setRecoverySourceState("refreshed");
      setError(`${baseError} Source refresh completed; run preflight again with the same batch identity.`);
    } catch (reloadError) {
      setRecoverySourceState("failed");
      setError(`${baseError} Catalog refresh failed: ${reloadError?.message || "try the source refresh again."} The same batch identity remains locked.`);
    } finally {
      setBusy(false);
    }
  };

  const releaseNoWriteCatalogRecovery = ({ reviewCatalog = false } = {}) => {
    if (!mayReleaseNoWriteCatalogRecovery) return;
    const confirmed = window.confirm(
      "Release this rejected catalog attempt? The shared-draft write was aborted, so this batch has no staged receipt. Its source stays available until you leave Import Studio."
    );
    if (!confirmed) return;
    setPendingImportBatchId("");
    setPreflight(null);
    setMutationPhase("ready");
    setMutationOperation("import");
    setRecoverySourceState("idle");
    setRecoveryMutationError("");
    setError("The no-write catalog attempt was released. Review the latest catalog or run a new preflight when the source is ready.");
    if (reviewCatalog && typeof onReviewCatalog === "function") {
      onReviewCatalog({ importType, status: "recovery_released", noWrite: true });
    }
  };

  const handlePreflight = async () => {
    if (preflightInteractionBlocked) {
      setError(resetGuard.message);
      return;
    }
    if (!organizationId) {
      setError("Your account does not have an organization destination.");
      return;
    }
    if (sourceBlocked || mappingDiagnostics.some((diagnostic) => diagnostic.severity === "error")) {
      setError("Resolve the source and mapping blockers before preflight.");
      return;
    }
    if (includedIssueCount > 0) {
      setError(`Resolve or explicitly exclude ${includedIssueCount} row(s) that need attention before preflight.`);
      return;
    }
    if (!readyRows.length) {
      setError("Keep at least one valid row before preflight.");
      return;
    }
    if (readyRows.length > MAX_IMPORT_SESSION_RECORDS) {
      setError(`Import sessions are limited to ${MAX_IMPORT_SESSION_RECORDS} ready records. Split this source into reviewable groups.`);
      return;
    }
    const catalogImport = isCatalogImportType(importType);
    const importBatchId = resolveImportBatchIdentity({ pendingImportBatchId, catalogImport });
    setBusy(true);
    setError("");
    setPreflight(null);
    try {
      const result = catalogImport
        ? await preflightCatalogImportDraft({
            organizationId,
            importType,
            rows: readyRows,
            importBatchId
          })
        : await preflightCustomerImport({
            organizationId,
            fileName,
            records: readyRows
          });
      setPreflight({
        ...result,
        importType,
        importBatchId,
        readyCount: readyRows.length,
        reviewSignature: readyRowsSignature
      });
      setMutationPhase("ready");
    } catch (err) {
      setError(err?.message || "Preflight could not establish a safe import plan.");
      setMutationPhase(catalogRecoveryMayPreflight ? "recovery" : "error");
    } finally {
      setBusy(false);
    }
  };

  const handleImport = async () => {
    if (!organizationId) {
      setError("Your account does not have an organization destination.");
      return;
    }
    if (!preflightCurrent) {
      setError("Run preflight again so this exact set of records has a current server plan.");
      return;
    }
    const catalogImport = isCatalogImportType(importType);
    const confirmed = window.confirm([
      `${catalogImport ? "Add" : "Create"} ${readyRows.length} reviewed ${definition.label.toLowerCase()} record(s) in ${organizationName || organizationId} (${organizationId})?`,
      catalogImport
        ? "The records will be added to the shared catalog draft; the active catalog remains unchanged until review and publish."
        : `Server preflight projects ${preflight.projectedCreateCount ?? readyRows.length} created and ${preflight.projectedSkipCount ?? 0} skipped across ${preflight.chunks?.length || 1} safe batch part(s).`,
      "No messages will be sent."
    ].filter(Boolean).join(" "));
    if (!confirmed) return;
    const reconciliation = ["uncertain", "partial", "recovery"].includes(mutationPhase)
      && mutationOperation === "import";
    setBusy(true);
    setError("");
    setMutationOperation("import");
    setMutationPhase(reconciliation ? "reconciling" : "submitting");
    setRecoverySourceState("idle");
    setRecoveryMutationError("");
    try {
      const importBatchId = pendingImportBatchId || preflight.importBatchId;
      if (!pendingImportBatchId) setPendingImportBatchId(importBatchId);
      const result = catalogImport
        ? await stageCatalogImportDraft({ organizationId, importType, rows: readyRows, importBatchId, preflight })
        : await createCustomerImportSession({
            organizationId,
            organizationName,
            fileName,
            records: readyRows,
            importBatchId,
            preflight
          });
      if (result?.ok !== true) {
        const rejectedResult = new Error(
          String(result?.error || result?.message || "The import did not return an accepted server receipt.")
        );
        rejectedResult.code = result?.code || "failed-precondition";
        throw rejectedResult;
      }
      setReceipt(result);
      setPendingImportBatchId("");
      setMutationPhase("success");
      setRecoveryMutationError("");
      if (typeof onImported === "function") onImported(result);
    } catch (err) {
      const mutationError = err?.message || "Import failed.";
      setError(mutationError);
      const failure = classifyImportMutationFailure({ error: err, catalogImport });
      if (Array.isArray(err?.partialResult?.childReceipts) && err.partialResult.childReceipts.length > 0) {
        setReceipt({
          ...err.partialResult,
          ok: false,
          status: "partial",
          partialEvidence: true,
          importType: "customers",
          importBatchId: err.partialResult.importBatchId || pendingImportBatchId || preflight?.importBatchId
        });
      }
      if (failure.requiresCatalogRefresh) {
        await refreshCatalogForRecovery(mutationError, "import");
      } else if (!failure.preserveBatchIdentity) {
        setPendingImportBatchId("");
        if (catalogImport) setPreflight(null);
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
    setRecoverySourceState("idle");
    setRecoveryMutationError("");
    setPendingImportBatchId(receipt.importBatchId);
    try {
      const receiptRevision = Number(receipt.catalogRevisionAfter ?? receipt.catalogRevision ?? 0);
      const result = await rollbackImportBatch({
        organizationId,
        importBatchId: receipt.importBatchId,
        childBatchIds: receipt.childBatchIds,
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
        await refreshCatalogForRecovery(mutationError, "rollback");
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
      data-layout-overlap-allowed={embedded ? undefined : "true"}
      role={embedded ? "region" : "dialog"}
      aria-modal={embedded ? undefined : "true"}
      aria-labelledby="import-studio-title"
      tabIndex={-1}
    >
      <div className={`modal-card import-studio-card${embedded ? " workspace-route-card" : ""}`}>
        <header className="modal-head import-studio-head">
          <div>
            <p className="import-studio-kicker">Import Workbench · Bring your business with you</p>
            <h2 id="import-studio-title">Import Studio</h2>
            <p>Inspect, resolve, preflight, and import customer or catalog sources without guessing what changed.</p>
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
          <span>Adding only to</span>
          <strong>{organizationName || "Current organization"}</strong>
          <code>{organizationId || "No organization assigned"}</code>
          <small>Uploaded files cannot change this destination.</small>
        </div>

        <nav className="import-workbench-steps" aria-label="Import Workbench progress">
          <ol>
            {WORKBENCH_STEPS.map(([id, label], index) => (
              <li
                key={id}
                data-step-state={index < activeStepIndex ? "complete" : index === activeStepIndex ? "current" : "upcoming"}
                aria-current={index === activeStepIndex ? "step" : undefined}
              >
                <span>{index + 1}</span>
                <strong>{label}</strong>
              </li>
            ))}
          </ol>
        </nav>

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
            <p className="import-drop-eyebrow">CSV + searchable PDF intake</p>
            <h3>Bring the source. Keep control of the truth.</h3>
            <p>QuotePilot inspects structure, retains source provenance, and requires a server preflight before anything is written.</p>
            <button type="button" className="cta" onClick={() => fileInputRef.current?.click()}>Choose CSV or PDF</button>
            <input
              ref={fileInputRef}
              className="visually-hidden"
              type="file"
              accept=".csv,text/csv,.pdf,application/pdf"
              onChange={(event) => loadFile(event.target.files?.[0])}
            />
            <small>CSV supports customers and catalog records. Searchable PDF is catalog-only. Quotes, payments, contracts, bookings, staff, emails, and messages stay protected.</small>
          </section>
        )}

        {fileName && !receipt && (
          <>
            <section className="import-file-bar">
              <div>
                <span>{sourceKind?.toUpperCase()} source inspected</span>
                <strong>{fileName}</strong>
                <small>
                  {sourceRows.length} inferred row(s)
                  {sourceDetails?.pageCount ? ` · ${sourceDetails.pageCount} page(s)` : ""}
                  {sourceDetails?.textCharacterCount ? ` · ${sourceDetails.textCharacterCount.toLocaleString()} text characters` : ""}
                </small>
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

            <section className="import-source-inspection" aria-labelledby="import-source-inspection-title">
              <div className="import-section-heading">
                <div>
                  <span>Source inspection</span>
                  <h3 id="import-source-inspection-title">What QuotePilot could establish</h3>
                </div>
                <FieldStateIndicator
                  state={sourceBlocked
                    ? { availability: "unavailable", evidence: "failed" }
                    : { origin: "historical_imported", evidence: "confirmed" }}
                  label="Source extraction"
                  reason={sourceBlocked ? "The source contains a structural blocker." : "The source was read; inferred meaning still requires your review."}
                  provenance={sourceKind === "pdf" ? "Searchable PDF text layer with page locators" : "Delimited source rows"}
                  recoveryAction={sourceBlocked ? { label: "Choose another source", onClick: handleReset } : undefined}
                />
              </div>
              {sourceDiagnostics.length > 0 ? (
                <ul className="import-diagnostic-list">
                  {sourceDiagnostics.map((diagnostic, index) => (
                    <li key={`${diagnostic.code || "diagnostic"}-${diagnostic.rowNumber || index}`} data-severity={diagnostic.severity || "info"}>
                      <strong>{diagnostic.severity === "error" ? "Blocked" : diagnostic.severity === "warning" ? "Review" : "Detected"}</strong>
                      <span>{diagnostic.message}</span>
                    </li>
                  ))}
                </ul>
              ) : <p className="source-note">No structural source warnings were found.</p>}
            </section>

            <section className="import-type-strip" aria-label="Record type">
              <div>
                <span>Suggested record type</span>
                <strong>{definition.label}</strong>
              </div>
              <label>
                Change record type
                <select
                  value={importType}
                  onChange={(event) => handleTypeChange(event.target.value)}
                  disabled={resetGuard.blocked}
                >
                  {IMPORT_TYPES
                    .filter((type) => !sourceKind || type.sourceKinds.includes(sourceKind))
                    .map((type) => <option key={type.id} value={type.id}>{type.label}</option>)}
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
              <FieldStateIndicator
                state={{ origin: "suggested", editability: "draft" }}
                label="Field mapping"
                provenance="Header recognition; operator confirmation required"
                supportingDetail="Changing any mapping invalidates the current preflight plan."
              />
              {mappingDiagnostics.length > 0 && (
                <ul className="import-diagnostic-list">
                  {mappingDiagnostics.map((diagnostic) => (
                    <li key={diagnostic.message} data-severity="error"><strong>Blocked</strong><span>{diagnostic.message}</span></li>
                  ))}
                </ul>
              )}
              {unmappedHeaders.length > 0 && (
                <p className="source-note import-unmapped-fields">
                  <strong>Not imported as record fields:</strong> {unmappedHeaders.join(", ")}.
                  {sourceKind === "pdf" && " Source page and excerpt remain attached as review provenance."}
                </p>
              )}
              <div className="import-mapping-grid">
                {definition.fields.map((field) => (
                  <div className="import-mapping-field" key={field}>
                    <label>
                      <span>{fieldLabel(field)}</span>
                      <select
                        value={mapping[field] || ""}
                        disabled={reviewInteractionBlocked}
                        onChange={(event) => {
                          setMapping((current) => ({ ...current, [field]: event.target.value }));
                          setPreflight(null);
                          setError("");
                          setMutationPhase(catalogRecoveryMayReview ? "recovery" : "ready");
                          setMutationOperation("import");
                        }}
                      >
                        <option value="">Do not import this column</option>
                        {headers.map((header) => <option key={header} value={header}>{header}</option>)}
                      </select>
                    </label>
                    {["eventType", "category"].includes(field) && !mapping[field] && (
                      <AdaptiveChoiceField
                        label={`Apply one ${fieldLabel(field).toLowerCase()} to every row`}
                        options={relationshipChoices[field]}
                        value={constantValues[field] || ""}
                        disabled={reviewInteractionBlocked}
                        onChange={(event) => {
                          setConstantValues((current) => ({ ...current, [field]: event.target.value }));
                          setPreflight(null);
                          setError("");
                          setMutationPhase(catalogRecoveryMayReview ? "recovery" : "ready");
                        }}
                        placeholder={`Choose ${fieldLabel(field).toLowerCase()}`}
                        emptyState="blocked"
                        emptyReason={`No active ${field === "eventType" ? "event types" : "menu sections"} are available for relationship matching.`}
                        recoveryAction={mayReleaseNoWriteCatalogRecovery
                          ? {
                              label: "Release no-write attempt and review catalog",
                              onClick: () => releaseNoWriteCatalogRecovery({ reviewCatalog: true })
                            }
                          : typeof onReviewCatalog === "function"
                            ? { label: "Review catalog", onClick: () => onReviewCatalog({ importType }) }
                            : { label: "Choose another source", onClick: handleReset }}
                      />
                    )}
                    {field === "qtyPerGuests" && !mapping[field] && (
                      <label className="import-mapping-constant">
                        <span>Apply one guests-per-unit ratio to every row</span>
                        <input
                          type="number"
                          min="1"
                          max="100000"
                          step="1"
                          value={constantValues[field] || ""}
                          disabled={reviewInteractionBlocked}
                          placeholder="For example, 8"
                          onChange={(event) => {
                            setConstantValues((current) => ({ ...current, [field]: event.target.value }));
                            setPreflight(null);
                            setError("");
                            setMutationPhase(catalogRecoveryMayReview ? "recovery" : "ready");
                          }}
                        />
                      </label>
                    )}
                  </div>
                ))}
              </div>
            </section>

            <section className="import-review-section">
              <div className="import-review-metrics">
                <div><span>Included + ready</span><strong>{readyRows.length}</strong></div>
                <div><span>Included blockers</span><strong>{includedIssueCount}</strong></div>
                <div><span>Explicitly excluded</span><strong>{excludedRows.size}</strong></div>
                <div><span>Destination</span><strong>{organizationId}</strong></div>
              </div>
              {includedIssueCount > 0 && (
                <div className="import-issue-action">
                  <p><strong>{includedIssueCount} row(s) need attention.</strong> Fix the source and reload it, or explicitly exclude those rows from this operation.</p>
                  <button
                    type="button"
                    className="ghost compact"
                    disabled={reviewInteractionBlocked}
                    onClick={excludeRowsNeedingAttention}
                  >
                    Exclude every blocked row
                  </button>
                </div>
              )}
              <div className="import-review-filters" role="group" aria-label="Filter inferred records">
                {[
                  ["all", `All ${previewRows.length}`],
                  ["issues", `Blocked ${includedIssueCount}`],
                  ["ready", `Ready ${readyRows.length}`],
                  ["excluded", `Excluded ${excludedRows.size}`]
                ].map(([value, label]) => (
                  <button
                    key={value}
                    type="button"
                    className="ghost compact"
                    aria-pressed={reviewFilter === value}
                    onClick={() => {
                      setReviewFilter(value);
                      setReviewPage(1);
                    }}
                  >
                    {label}
                  </button>
                ))}
              </div>
              <div className="import-review-pagination" role="group" aria-label="Review page navigation">
                <p aria-live="polite">
                  <strong>{reviewPagination.rangeStart}-{reviewPagination.rangeEnd}</strong> of {reviewPagination.total} matching records
                  <span> · Page {reviewPagination.page} of {reviewPagination.pageCount}</span>
                </p>
                <div>
                  <button
                    type="button"
                    className="ghost compact"
                    disabled={reviewPagination.page <= 1}
                    onClick={() => setReviewPage(reviewPagination.page - 1)}
                  >
                    Previous review page
                  </button>
                  <button
                    type="button"
                    className="ghost compact"
                    disabled={reviewPagination.page >= reviewPagination.pageCount}
                    onClick={() => setReviewPage(reviewPagination.page + 1)}
                  >
                    Next review page
                  </button>
                </div>
              </div>
              <div className="import-preview-table-wrap">
                <table className="import-review-table">
                  <thead>
                    <tr>
                      <th>Include</th>
                      <th>Source</th>
                      {definition.fields.map((field) => <th key={field}>{fieldLabel(field)}</th>)}
                      <th>Status</th>
                      <th>Details</th>
                    </tr>
                  </thead>
                  <tbody>
                    {filteredPreviewRows.length === 0 && (
                      <tr><td colSpan={definition.fields.length + 4}>No inferred records match this filter.</td></tr>
                    )}
                    {reviewPagination.rows.map((row) => (
                      <tr key={row.rowNumber} className={excludedRows.has(row.rowNumber) ? "is-excluded" : row.ready ? "is-ready" : "has-issues"}>
                        <td>
                          <input
                            type="checkbox"
                            checked={!excludedRows.has(row.rowNumber)}
                            onChange={() => toggleRowExclusion(row.rowNumber)}
                            aria-label={`${excludedRows.has(row.rowNumber) ? "Include" : "Exclude"} source ${row.sourceLocator?.kind === "pdf" ? `page ${row.sourceLocator.page}` : `row ${row.rowNumber}`}`}
                          />
                        </td>
                        <td className="import-source-cell">
                          <strong>{row.sourceLocator?.kind === "pdf" ? `Page ${row.sourceLocator.page}` : `Row ${row.rowNumber}`}</strong>
                          {row.sourceLocator?.kind === "pdf" && row.sourceLocator.excerpt ? (
                            <span className="import-source-excerpt">{row.sourceLocator.excerpt}</span>
                          ) : null}
                        </td>
                        {definition.fields.map((field) => (
                          <td className="import-preview-field" key={field}>
                            <strong>{exactReviewValue(row.record, field)}</strong>
                            <FieldStateIndicator
                              state={row.fieldStates[field] || { availability: "unknown" }}
                              label={`${fieldLabel(field)} state`}
                              provenance={(row.fieldStates[field]?.origin === "defaulted")
                                ? "QuotePilot import default; source value not provided"
                                : `${fileName}, ${row.sourceLocator?.kind === "pdf" ? `page ${row.sourceLocator.page}` : `row ${row.rowNumber}`}`}
                              {...fieldRecoveryProps(row, field)}
                            />
                          </td>
                        ))}
                        <td className="import-row-status">{excludedRows.has(row.rowNumber) ? "Excluded" : row.ready ? "Ready" : "Blocked"}</td>
                        <td className="import-row-details">{[...row.errors, ...row.warnings].join("; ") || `${primaryValue(row.record)} mapped without warnings`}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
              {reviewPagination.pageCount > 1 && (
                <p className="source-note">Every inferred record remains available through review pages. Preflight evaluates the exact included set across all pages.</p>
              )}
            </section>

            <section className="import-preflight-section" aria-labelledby="import-preflight-title">
              <div className="import-section-heading">
                <div>
                  <span>Readiness gate</span>
                  <h3 id="import-preflight-title">Prove this exact plan can proceed</h3>
                </div>
                <button
                  type="button"
                  className="ghost"
                  onClick={handlePreflight}
                  disabled={preflightInteractionBlocked || busy || sourceBlocked || includedIssueCount > 0 || !readyRows.length || mappingDiagnostics.length > 0}
                >
                  {busy && !preflightCurrent ? "Running preflight..." : preflightCurrent ? "Run preflight again" : "Run server preflight"}
                </button>
              </div>
              <FieldStateIndicator
                state={preflightCurrent
                  ? { evidence: "confirmed" }
                  : preflight && (!preflightInteractionBlocked || isCatalogImportType(importType))
                    ? { evidence: "stale" }
                    : { evidence: "pending" }}
                label="Import plan"
                reason={preflight && !preflightCurrent ? "The included records changed after this plan was calculated." : ""}
                supportingDetail={preflightCurrent
                  ? `${preflight.authority === "server_preflight" ? "Server" : "Shared catalog draft"} checked ${readyRows.length} row(s) at ${preflight.observedAtISO || "the current source revision"}.`
                  : "No authoritative mutation will begin until this exact included set passes preflight."}
                recoveryAction={preflight && !preflightCurrent
                  ? (!preflightInteractionBlocked
                      ? { label: "Run preflight again", onClick: handlePreflight }
                      : isCatalogImportType(importType)
                        ? {
                            label: "Refresh latest catalog source",
                            onClick: () => refreshCatalogForRecovery(
                              "The catalog changed after this plan was confirmed.",
                              "import"
                            )
                          }
                        : undefined)
                  : undefined}
              />
              {preflightCurrent && (
                <div className="import-preflight-plan" data-capability-state="confirmed">
                  {isCatalogImportType(importType) ? (
                    <>
                      <div><span>Will add to draft</span><strong>{preflight.stagedCount}</strong></div>
                      <div><span>Draft after staging</span><strong>{preflight.projectedDraftChangeCount} changes</strong></div>
                      <div><span>Revision fence</span><strong>{preflight.baseCatalogRevision}</strong></div>
                    </>
                  ) : (
                    <>
                      <div><span>Projected create</span><strong>{preflight.projectedCreateCount}</strong></div>
                      <div><span>Projected skip</span><strong>{preflight.projectedSkipCount}</strong></div>
                      <div><span>Safe child batches</span><strong>{preflight.chunks?.length || 1}</strong></div>
                    </>
                  )}
                </div>
              )}
            </section>

            <footer className="modal-foot import-studio-foot">
              <p>
                {readyRows.length > MAX_IMPORT_SESSION_RECORDS
                  ? `Split this source into reviewable groups of ${MAX_IMPORT_SESSION_RECORDS} records or fewer.`
                  : preflightCurrent
                    ? (isCatalogImportType(importType)
                        ? "Preflight confirmed the shared-draft fence. The active catalog will remain unchanged."
                        : "Preflight confirmed duplicate visibility and safe transaction-sized child batches.")
                    : mutationPresentation.detail}
              </p>
              {mayReleaseNoWriteCatalogRecovery && (
                <button
                  type="button"
                  className="ghost danger"
                  disabled={busy}
                  onClick={() => releaseNoWriteCatalogRecovery()}
                >
                  Release no-write attempt
                </button>
              )}
              <button
                type="button"
                className="cta"
                disabled={footerActionDisabled}
                onClick={recoveryNeedsSourceRefresh
                  ? () => refreshCatalogForRecovery()
                  : recoveryNeedsPreflight
                    ? handlePreflight
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
            <h3>
              {receipt.status === "published"
                ? `${receipt.stagedCount || 0} catalog record${Number(receipt.stagedCount || 0) === 1 ? "" : "s"} already published`
                : receipt.status === "staged"
                ? `${receipt.stagedCount || 0} record${Number(receipt.stagedCount || 0) === 1 ? "" : "s"} added to the catalog draft`
                : receipt.status === "rolled_back"
                ? "Import safely undone"
                : receipt.status === "partial"
                  ? "Part of this customer import is confirmed"
                : Number(receipt.createdCount || 0) > 0
                  ? `${organizationName || organizationId} has new records`
                  : "Everything already matched"}
            </h3>
            <FieldStateIndicator
              state={receipt.status === "partial"
                ? { persistence: "saved", evidence: "pending" }
                : receipt.status === "published"
                  ? { persistence: "published", evidence: "confirmed", editability: "read_only" }
                  : { persistence: "saved", evidence: "confirmed", ...(receipt.status === "staged" ? { editability: "draft" } : {}) }}
              label={["staged", "published"].includes(receipt.status)
                ? "Catalog import"
                : receipt.status === "partial"
                  ? "Customer import continuation"
                  : "Customer import"}
              supportingDetail={receipt.status === "partial"
                ? `${receipt.childReceipts?.length || 0} child batch part(s) have accepted server receipts. Remaining parts are not established; resume this identity or undo the confirmed subset.`
                : receipt.status === "published"
                  ? `The server reconciled this exact request to publication${receipt.publicationReceiptId ? ` ${receipt.publicationReceiptId}` : ""} at catalog revision ${receipt.catalogRevisionAfter ?? receipt.catalogRevision ?? "the confirmed revision"}.`
                : receipt.status === "staged"
                ? "Saved in the shared draft. It is not Published until a catalog publication receipt exists."
                : `Server receipts confirmed ${receipt.childBatchIds?.length || 1} transaction-safe batch part(s).`}
            />
            <div className="import-review-metrics">
              <div>
                <span>{receipt.status === "published" ? "Published" : receipt.status === "staged" ? "Staged" : receipt.status === "rolled_back" ? "Removed" : receipt.status === "partial" ? "Confirmed created" : "Created"}</span>
                <strong>{["staged", "published"].includes(receipt.status) ? (receipt.stagedCount || 0) : receipt.status === "rolled_back" ? (receipt.deletedCount || 0) : (receipt.createdCount || 0)}</strong>
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
              {receipt.status === "published"
                ? `These exact values are active in catalog revision ${receipt.catalogRevisionAfter ?? receipt.catalogRevision ?? "confirmed by the server"}. The current shared draft may contain later, unrelated work.`
                : receipt.status === "staged"
                ? "The active catalog is unchanged. Review and publish the shared setup draft to activate these records."
                : receipt.status === "rolled_back"
                ? (isCatalogImportType(receipt.importType || importType)
                    ? "Only unchanged records stamped by this batch were removed. Edited records and records still used by packages or templates were protected."
                    : "Only unchanged records stamped by this batch were removed. Records edited after import were protected.")
                : receipt.status === "partial"
                  ? "Only the child batches listed by accepted server receipts are confirmed. Resume with this exact identity, or undo those confirmed records before starting a new source."
                : (isCatalogImportType(receipt.importType || importType) && Number(receipt.createdCount || 0) > 0
                    ? "Prices were stored in integer minor units. Review and confirm catalog pricing before activation; existing duplicates were left unchanged."
                    : isCatalogImportType(receipt.importType || importType)
                      ? "No new catalog records were needed. Existing duplicates and current pricing confirmation were left unchanged."
                    : "No outbound messages were sent. Existing duplicate records were left unchanged.")}
            </p>
            <div className="right-actions">
              {receipt.status === "partial" && (
                <button type="button" className="cta" disabled={busy} onClick={handleImport}>
                  Resume remaining import
                </button>
              )}
              {["staged", "published"].includes(receipt.status) && typeof onReviewCatalog === "function" && (
                <button type="button" className="cta" onClick={() => onReviewCatalog(receipt)}>
                  {receipt.status === "published" ? "Review active catalog" : "Review catalog draft"}
                </button>
              )}
              {receipt.status !== "rolled_back" && !["staged", "published"].includes(receipt.status) && (
                <button
                  type="button"
                  className="ghost danger"
                  disabled={busy || (mutationPhase === "recovery" && !recoveryReady && typeof onReload !== "function")}
                  onClick={mutationPhase === "recovery" && !recoveryReady
                    ? () => refreshCatalogForRecovery()
                    : handleRollback}
                >
                  {mutationOperation === "rollback" && ["uncertain", "partial", "reconciling", "submitting", "error", "recovery"].includes(mutationPhase)
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
