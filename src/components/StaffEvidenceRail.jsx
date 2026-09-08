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

const COMPACT_STATE_LABELS = {
  loading: "Gathering view",
  refreshing: "Updating view",
  partial: "View incomplete",
  stale: "Earlier view retained",
  unavailable: "View unavailable",
  truncated: "Bounded view",
  current: "View current"
};

function readStatus(reads, key) {
  return String(reads?.[key]?.status || "idle").trim().toLowerCase();
}

function contractOutcome(reads = {}, { retained = false } = {}) {
  const attention = readStatus(reads, "attention");
  const history = readStatus(reads, "history");
  const unreadReplies = readStatus(reads, "unreadReplies");
  if (reads?.unreadReplies) {
    const definitions = [
      ["Workflow attention", attention],
      ["quote history", history],
      ["unread customer-reply Attention", unreadReplies],
      ...(reads?.decisionDebt
        ? [["Decision Debt", readStatus(reads, "decisionDebt")]]
        : [])
    ];
    if (definitions.every(([, status]) => status === "success")) {
      return `All ${definitions.length === 4 ? "four" : "three"} tenant reads completed.`;
    }
    const completed = definitions.filter(([, status]) => status === "success").map(([label]) => label);
    const failed = definitions.filter(([, status]) => status === "error").map(([label]) => label);
    if (failed.length > 0) {
      const completedCopy = completed.length > 0 ? `${completed.join(" and ")} completed; ` : "";
      const failureCopy = `${failed.join(" and ")} did not complete.`;
      return retained
        ? `${completedCopy}${failureCopy} Fresh results were not applied; the prior complete snapshot remains visible.`
        : `${completedCopy}${failureCopy}`;
    }
    return "Waiting for the tenant reads to complete.";
  }
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
    partial: "Some workspace sources refreshed, and at least one did not. A complete refresh was not recorded.",
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

export function StaffReadContextRail({
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
  historyLimit = 200,
  readContract = "Tenant-scoped staff read",
  outcome = "",
  boundsNote = "",
  caveat = "Freshness describes this staff read only. It does not prove provider delivery, customer acceptance, booking, payment, or operational completion.",
  title = "Staff read context",
  titleId = "staff-evidence-rail-title",
  headingLevel = 3,
  presentation = "standard"
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
  const presentationMode = presentation === "compact" ? "compact" : "standard";
  const Heading = headingLevel === 2 ? "h2" : "h3";

  return (
    <aside
      className={`staff-evidence-rail staff-evidence-${model.state}${presentationMode === "compact" ? " staff-evidence-rail--compact" : ""}`}
      aria-labelledby={titleId}
      data-capability-state={model.state}
      data-read-truncation={truncationKnown ? (truncated ? "truncated" : "complete") : "unknown"}
      data-staff-evidence-presentation={presentationMode}
    >
      <div className="staff-evidence-head">
        <div>
          <p className="eyebrow">Data freshness</p>
          <Heading id={titleId}>{title}</Heading>
        </div>
        <StatusChip
          {...model.presentation}
          label={presentationMode === "compact"
            ? COMPACT_STATE_LABELS[model.state]
            : model.presentation.label}
        />
      </div>

      <p className="staff-evidence-outcome" role="status" aria-live="polite" aria-atomic="true">
        {model.detail} {outcome}
      </p>

      <details className="staff-evidence-disclosure">
        <summary>Read details</summary>
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
        {truncationKnown && truncated && boundsNote && (
          <p className="staff-evidence-bounds-note">
            {boundsNote}
          </p>
        )}
        <p className="staff-evidence-caveat">
          {caveat}
        </p>
      </details>
    </aside>
  );
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
  title = "Staff read context",
  headingLevel = 3,
  readContract = "Tenant-scoped Workflow Attention quote read, unread customer-reply Attention projection, optional Decision Debt projection, plus the latest 200 staff quote records",
  presentation = "standard"
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
  return (
    <StaffReadContextRail
      organizationName={organizationName}
      organizationId={organizationId}
      source={source}
      loadedAt={loadedAt}
      loading={loading}
      error={error}
      partial={partial}
      stale={stale}
      truncated={truncated}
      truncationKnown={truncationKnown}
      historyLimit={historyLimit}
      title={title}
      headingLevel={headingLevel}
      readContract={readContract}
      presentation={presentation}
      outcome={contractOutcome(reads, { retained: model.state === "stale" })}
      boundsNote={`Quote history is capped at the latest ${historyLimit} records, unread customer-reply Attention at 50 records, and any requested Decision Debt read at its server bound; open Quotes or Workflow for the authoritative records.`}
    />
  );
}
