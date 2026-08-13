export function formatReportingDuration(value) {
  if (value === null || value === undefined || value === "") return "Not available";
  const durationMs = Number(value);
  if (!Number.isSafeInteger(durationMs) || durationMs < 0) return "Not available";
  if (durationMs < 1000) return `${durationMs} ms`;
  const totalSeconds = Math.round(durationMs / 1000);
  if (totalSeconds < 60) {
    const seconds = durationMs / 1000;
    return `${seconds < 10 ? seconds.toFixed(1) : Math.round(seconds)} s`;
  }
  if (totalSeconds < 3600) {
    const minutes = Math.floor(totalSeconds / 60);
    const seconds = totalSeconds % 60;
    return seconds > 0 ? `${minutes} min ${seconds} s` : `${minutes} min`;
  }
  const totalMinutes = Math.round(durationMs / 60_000);
  const hours = Math.floor(totalMinutes / 60);
  const minutes = totalMinutes % 60;
  return minutes > 0 ? `${hours} hr ${minutes} min` : `${hours} hr`;
}

function boundedSampleCount(value, max = 2500) {
  const count = Number(value);
  return Number.isSafeInteger(count) && count >= 0 && count <= max ? count : 0;
}

function reportingDurationMetric(metric = {}) {
  const samples = boundedSampleCount(metric?.samples);
  const median = formatReportingDuration(metric?.medianMs);
  const p75 = formatReportingDuration(metric?.p75Ms);
  return {
    available: samples > 0 && median !== "Not available" && p75 !== "Not available",
    samples,
    median,
    p75
  };
}

function reportingIssueCategoryLabel(value) {
  const labels = {
    "workflow-attention": "Workflow attention",
    "staffing-guidance": "Staffing guidance",
    "proposal-gap-customer-name": "Proposal · customer name",
    "proposal-gap-customer-email": "Proposal · customer email",
    "proposal-gap-customer-phone": "Proposal · customer phone",
    "proposal-gap-event-name": "Proposal · event name",
    "proposal-gap-event-date": "Proposal · event date",
    "proposal-gap-event-time": "Proposal · event time",
    "proposal-gap-venue": "Proposal · venue",
    "proposal-gap-guest-count": "Proposal · guest count",
    "proposal-gap-duration": "Proposal · duration",
    "proposal-gap-package": "Proposal · package",
    "proposal-gap-menu": "Proposal · menu",
    "proposal-gap-total": "Proposal · total"
  };
  return labels[String(value || "").trim().toLowerCase()] || "";
}

export function ReportingAmbientMetrics({ analytics = null, loading = false }) {
  const analyticsAvailable = analytics?.source === "firebase" && !analytics?.error;
  const interactions = analytics?.ambientInteractions || {};
  const assessedActions = boundedSampleCount(interactions.primaryActionsAssessed);
  const deadClicks = boundedSampleCount(interactions.deadClicks);
  const deadClickRate = Number(interactions.deadClickRate);
  const deadClickCountValid = interactions.deadClicks !== null
    && interactions.deadClicks !== undefined
    && interactions.deadClicks !== ""
    && Number.isSafeInteger(Number(interactions.deadClicks))
    && Number(interactions.deadClicks) >= 0;
  const deadClickRateValid = interactions.deadClickRate !== null
    && interactions.deadClickRate !== undefined
    && interactions.deadClickRate !== "";
  const deadClickAvailable = analyticsAvailable
    && interactions.observationSource === "client"
    && Number(interactions.deadlineMs) === 250
    && assessedActions > 0
    && deadClickCountValid
    && deadClickRateValid
    && Number.isFinite(deadClickRate)
    && deadClickRate >= 0
    && deadClickRate <= 1
    && deadClicks <= assessedActions;
  const pricedDraft = reportingDurationMetric(analytics?.intentToPricedDraft);
  const pricedDraftAvailable = analyticsAvailable
    && analytics?.intentToPricedDraft?.observationSource === "client"
    && analytics?.intentToPricedDraft?.receiptAuthority === "server_authoritative"
    && analytics?.intentToPricedDraft?.storage === "firebase"
    && pricedDraft.available;
  const issueResolution = reportingDurationMetric(analytics?.issueResolution);
  const issueResolutionAvailable = analyticsAvailable
    && analytics?.issueResolution?.observationSource === "client"
    && analytics?.issueResolution?.pairing === "same_session_exact_category"
    && issueResolution.available;
  const issueCategories = analyticsAvailable
    ? (Array.isArray(analytics?.issueResolution?.byCategory)
      ? analytics.issueResolution.byCategory
      : [])
      .slice(0, 14)
      .map((row) => ({
        issueCategory: row?.issueCategory,
        label: reportingIssueCategoryLabel(row?.issueCategory),
        ...reportingDurationMetric(row)
      }))
      .filter((row) => row.available && row.label)
    : [];
  const reportedWindowDays = boundedSampleCount(analytics?.days, 90);
  const windowDays = reportedWindowDays >= 7 ? reportedWindowDays : 30;
  const sampledEvents = boundedSampleCount(analytics?.sampledEvents);

  return (
    <section
      className="dashboard-section"
      aria-labelledby="ambient-interaction-health-heading"
      data-reporting-state={loading ? "loading" : analyticsAvailable ? "available" : "unavailable"}
    >
      <div className="dashboard-section-head">
        <div>
          <h3 id="ambient-interaction-health-heading">Ambient interaction health</h3>
          <p className="source-note">
            Last {windowDays} days · same-tenant, client-observed staff-session signals
          </p>
        </div>
        <strong>{analyticsAvailable ? "Bounded evidence" : "Not available"}</strong>
      </div>

      <div className="dashboard-grid" aria-label="Ambient interaction measures">
        <div className="metric-card">
          <span>Primary dead-click rate</span>
          <strong>{deadClickAvailable ? `${(deadClickRate * 100).toFixed(1)}%` : "Not available"}</strong>
          <small>
            {deadClickAvailable
              ? `${deadClicks} dead click${deadClicks === 1 ? "" : "s"} across ${assessedActions} assessed primary actions · 250 ms acknowledgement contract`
              : "No qualifying 250 ms primary-action assessments are available in this window."}
          </small>
        </div>
        <div className="metric-card">
          <span>First intent → priced draft</span>
          <strong>{pricedDraftAvailable ? pricedDraft.median : "Not available"}</strong>
          <small>
            {pricedDraftAvailable
              ? `Median · p75 ${pricedDraft.p75} · ${pricedDraft.samples} exact receipt sample${pricedDraft.samples === 1 ? "" : "s"}`
              : "No client-observed exact server-authoritative Firebase priced-draft receipts are available in this window."}
          </small>
        </div>
        <div className="metric-card">
          <span>Issue surfaced → resolved</span>
          <strong>{issueResolutionAvailable ? issueResolution.median : "Not available"}</strong>
          <small>
            {issueResolutionAvailable
              ? `Median · p75 ${issueResolution.p75} · ${issueResolution.samples} same-session exact-category pair${issueResolution.samples === 1 ? "" : "s"}`
              : "No same-session exact-category issue-resolution pairs are available in this window."}
          </small>
        </div>
      </div>

      {!loading && !analyticsAvailable && (
        <p className={analytics?.error ? "warning-note" : "source-note"} role="status">
          {analytics?.error
            ? "The product-event summary could not be read. Refresh the snapshot to retry; no rate or duration is inferred."
            : "The server summary is unavailable in local fallback. No rate or duration is inferred from this browser's pending queue."}
        </p>
      )}
      {loading && !analyticsAvailable && (
        <p className="source-note" role="status">Loading bounded Ambient interaction evidence.</p>
      )}

      {issueCategories.length > 0 && (
        <details className="staff-evidence-disclosure">
          <summary>Resolved issue categories</summary>
          <div className="status-strip">
            {issueCategories.map((row) => (
              <span key={row.issueCategory}>
                {row.label}: {row.samples} · median {row.median} · p75 {row.p75}
              </span>
            ))}
          </div>
        </details>
      )}

      <p className="source-note">
        {analyticsAvailable
          ? `These are client observations summarized from ${sampledEvents > 0 ? `${sampledEvents} bounded server-stored events` : "bounded server-stored events"}; they are not server timing telemetry.`
          : "When available, the Firebase summary contains bounded client observations; it is not server timing telemetry."}
        {" "}Event payloads omit quote IDs, customer details, and free text. Priced-draft
        timing requires the client to observe an exact server-authoritative Firebase save
        receipt. Issue timing pairs only the same bounded category in the same staff session.
      </p>
    </section>
  );
}

export default ReportingAmbientMetrics;
