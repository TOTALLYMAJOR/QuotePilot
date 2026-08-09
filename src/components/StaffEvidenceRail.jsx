import StatusChip from "./StatusChip";
import {
  formatWorkspaceDateTime,
  formatWorkspaceSource,
  formatWorkspaceText
} from "../lib/workspacePresentation";

const STATE_PRESENTATION = {
  loading: { family: "info", label: "Loading staff data" },
  refreshing: { family: "pending", label: "Refreshing" },
  partial: { family: "action", label: "Incomplete read" },
  stale: { family: "action", label: "Last complete read retained" },
  unavailable: { family: "failed", label: "Read unavailable" },
  truncated: { family: "pending", label: "Bounded snapshot" },
  current: { family: "confirmed", label: "Read complete" }
};

function readStatus(reads, key) {
  return String(reads?.[key]?.status || "idle").trim().toLowerCase();
}

function contractOutcome(reads = {}, { retained = false } = {}) {
  const attention = readStatus(reads, "attention");
  const history = readStatus(reads, "history");
  if (attention === "success" && history === "success") return "Both tenant reads completed.";
  if (attention === "success" && history === "error") {
    return retained
      ? "Workflow attention completed but was not applied because quote history failed; the prior complete snapshot remains visible."
      : "Workflow attention completed; quote history did not complete.";
  }
  if (attention === "error" && history === "success") {
    return retained
      ? "Quote history completed but was not applied because Workflow attention failed; the prior complete snapshot remains visible."
      : "Quote history completed; Workflow attention did not complete.";
  }
  if (attention === "error" && history === "error") return "Neither tenant read completed.";
  return "Waiting for the tenant reads to complete.";
}

function presentationAuthority(source = "") {
  const normalized = String(source || "").trim().toLowerCase();
  if (normalized === "firebase") return "Derived staff presentation from canonical tenant quote records";
  if (normalized === "local") return "Derived local presentation from browser-local quote records";
  if (normalized === "mixed") return "Derived presentation across mixed staff read sources";
  return "Derived presentation; record authority is not confirmed yet";
}

export function buildStaffEvidenceRailModel({
  loading = false,
  error = "",
  loadedAt = 0,
  partial = false,
  stale = false,
  truncated = false,
  historyLimit = 200
} = {}) {
  const hasCompleteRead = Number(loadedAt) > 0;
  let state = "current";
  if (loading && !hasCompleteRead) state = "loading";
  else if (loading) state = "refreshing";
  else if ((stale || error) && hasCompleteRead) state = "stale";
  else if (partial) state = "partial";
  else if (error || !hasCompleteRead) state = "unavailable";
  else if (truncated) state = "truncated";

  const detail = {
    loading: "Loading the tenant-scoped staff snapshot.",
    refreshing: "Refreshing now; the last complete snapshot remains visible.",
    partial: "One staff read completed and one did not. No complete refresh was recorded.",
    stale: "The latest refresh did not complete. Visible retained data comes from the last complete read.",
    unavailable: "No complete staff snapshot is available yet.",
    truncated: "The tenant-scoped staff snapshot completed within a bounded quote-history window.",
    current: "The tenant-scoped staff snapshot completed."
  }[state];

  return {
    state,
    detail,
    presentation: STATE_PRESENTATION[state]
  };
}

export default function StaffEvidenceRail({
  organizationName = "",
  organizationId = "",
  source = "",
  loadedAt = 0,
  loading = false,
  error = "",
  partial = false,
  stale = false,
  truncated = false,
  truncationKnown = false,
  reads = {},
  historyLimit = 200,
  readContract = "Tenant-scoped Workflow Attention quote read plus the latest 200 staff quote records"
}) {
  const model = buildStaffEvidenceRailModel({
    loading,
    error,
    loadedAt,
    partial,
    stale,
    truncated,
    historyLimit
  });
  const scopeName = formatWorkspaceText(organizationName, { emptyLabel: "Current organization" });
  const tenantKey = formatWorkspaceText(organizationId, { emptyLabel: "Not available" });

  return (
    <aside
      className={`staff-evidence-rail staff-evidence-${model.state}`}
      aria-labelledby="staff-evidence-rail-title"
      data-capability-state={model.state}
      data-read-truncation={truncationKnown ? (truncated ? "truncated" : "complete") : "unknown"}
    >
      <div className="staff-evidence-head">
        <div>
          <p className="eyebrow">Data confidence</p>
          <h3 id="staff-evidence-rail-title">Staff read context</h3>
        </div>
        <StatusChip {...model.presentation} />
      </div>

      <dl className="staff-evidence-details">
        <div>
          <dt>Tenant scope</dt>
          <dd>{scopeName}<small>Tenant key: {tenantKey}</small></dd>
        </div>
        <div>
          <dt>Read contract</dt>
          <dd>{readContract}</dd>
        </div>
        <div>
          <dt>Presentation authority</dt>
          <dd>{presentationAuthority(source)}</dd>
        </div>
        <div>
          <dt>Last complete read (device time)</dt>
          <dd>
            {Number(loadedAt) > 0
              ? <time dateTime={new Date(loadedAt).toISOString()}>{formatWorkspaceDateTime(loadedAt)}</time>
              : "No complete read yet"}
          </dd>
        </div>
        <div>
          <dt>Source</dt>
          <dd>{formatWorkspaceSource(source)}</dd>
        </div>
      </dl>

      <p className="staff-evidence-outcome" role="status" aria-live="polite" aria-atomic="true">
        {model.detail} {contractOutcome(reads, { retained: model.state === "stale" })}
      </p>
      {truncationKnown && truncated && (
        <p className="staff-evidence-bounds-note">
          Quote history is capped at the latest {historyLimit} records; open Quotes for full history.
        </p>
      )}
      <p className="staff-evidence-caveat">
        Freshness describes this staff read only. It does not prove provider delivery, customer acceptance, booking, payment, or operational completion.
      </p>
    </aside>
  );
}
