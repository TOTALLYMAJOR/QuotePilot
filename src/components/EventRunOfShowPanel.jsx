import StatusChip from "./StatusChip";
import {
  formatWorkspaceDate,
  formatWorkspaceDateTime,
  formatWorkspaceInteger,
  formatWorkspaceText,
  humanizeWorkspaceValue
} from "../lib/workspacePresentation";

const UNKNOWN_FIELD_LABELS = Object.freeze({
  "quote.quoteId": "Quote identifier",
  "quote.quoteNumber": "Quote number",
  "event.name": "Event name",
  "event.date": "Event date",
  "event.time": "Event start time",
  "event.hours": "Event duration",
  "event.venue": "Venue",
  "event.venueAddress": "Venue address",
  "event.guests": "Guest count",
  "event.style": "Service style",
  "event.dietaryRestrictions": "Dietary restrictions",
  "staffing.staffLead": "Staff lead",
  "staffing.servers": "Server count",
  "staffing.chefs": "Chef count",
  "staffing.bartenders": "Bartender count"
});

function sourceAuthorityLabel(authority) {
  const labels = {
    canonical_staff_records: "Canonical tenant staff records",
    browser_local_records: "Browser-local staff records",
    mixed_staff_records: "Mixed staff record sources",
    unconfirmed: "Record authority not confirmed"
  };
  return labels[authority] || "Record authority not confirmed";
}

function timingBasisLabel(value) {
  return value === "booking_override" ? "Booking override" : "Generated default";
}

function timingUnknownLabel(value) {
  if (value === "event_duration_unknown") {
    return "Time unavailable until the event duration is recorded.";
  }
  return "Time unavailable until the event start time is recorded.";
}

function milestonePresentations(event) {
  const acceptanceRecorded = event?.milestones?.proposalAcceptance?.state === "accepted";
  const booked = event?.milestones?.booking?.state === "booked";
  return [
    {
      family: acceptanceRecorded ? "confirmed" : "pending",
      label: acceptanceRecorded ? "Proposal acceptance: Accepted" : "Proposal acceptance: Not established"
    },
    {
      family: booked ? "confirmed" : "pending",
      label: booked ? "Booking: Booked" : "Booking: Not booked"
    },
    {
      family: "action",
      label: "Operational readiness: Not established"
    }
  ];
}

function eventStatusLabel(value) {
  return value === "booked" ? "Booked quote" : "Accepted proposal";
}

function commercialEvidenceLines(event) {
  const acceptance = event?.milestones?.proposalAcceptance || {};
  const booking = event?.milestones?.booking || {};
  const acceptanceLine = acceptance.state === "accepted"
    ? acceptance.atISO
      ? `Proposal accepted ${formatWorkspaceDateTime(acceptance.atISO)}.`
      : "Proposal status is accepted; acceptance time is not recorded."
    : "Proposal acceptance evidence is not recorded.";
  const bookingReference = booking.contractNumber
    ? ` Contract ${booking.contractNumber}.`
    : " Contract reference not recorded.";
  const bookingLine = booking.state === "booked"
    ? booking.atISO
      ? `Booked ${formatWorkspaceDateTime(booking.atISO)}.${bookingReference}`
      : `Quote status is booked; booking time is not recorded.${bookingReference}`
    : "Booking is not recorded.";
  return { acceptanceLine, bookingLine };
}

function staffingLine(staffing = {}) {
  const staffLead = formatWorkspaceText(staffing.staffLead, { emptyLabel: "Staff lead not recorded" });
  const counts = [
    [staffing.servers, "servers"],
    [staffing.chefs, "chefs"],
    [staffing.bartenders, "bartenders"]
  ].map(([value, label]) => (
    value === null || value === undefined
      ? `${humanizeWorkspaceValue(label)} not recorded`
      : `${formatWorkspaceInteger(value)} ${label}`
  ));
  return [staffLead, ...counts].join(", ");
}

function checklistLine(checklist = {}) {
  return [
    `${formatWorkspaceInteger(checklist.completedCount, { emptyLabel: "0" })} completed`,
    `${formatWorkspaceInteger(checklist.notCompletedCount, { emptyLabel: "0" })} explicitly incomplete`,
    `${formatWorkspaceInteger(checklist.unknownCount, { emptyLabel: "0" })} unknown`
  ].join(", ");
}

function eventScopeLine(event = {}) {
  const guests = event.guests === null || event.guests === undefined
    ? "Guest count not recorded"
    : `${formatWorkspaceInteger(event.guests)} guests`;
  const hours = event.hours === null || event.hours === undefined
    ? "Duration not recorded"
    : `${event.hours} hours`;
  const style = formatWorkspaceText(event.style, { emptyLabel: "Service style not recorded" });
  return `${guests}, ${hours}, ${style}`;
}

function beoRevisionLabel(beoReference = {}) {
  const revision = beoReference.sourceRevision || {};
  const id = formatWorkspaceText(revision.id, { emptyLabel: "Revision not recorded" });
  return revision.number === null || revision.number === undefined
    ? `Revision reference: ${id}`
    : `Revision reference: ${id}, version ${formatWorkspaceInteger(revision.number)}`;
}

function unknownFieldLabels(fields = []) {
  return (Array.isArray(fields) ? fields : []).map((field) => (
    UNKNOWN_FIELD_LABELS[field]
    || humanizeWorkspaceValue(String(field || "").split(".").at(-1), { emptyLabel: "Unknown field" })
  ));
}

function resolvePanelState({ events, loading, error, truncated, derivationFailedCount }) {
  if (loading && events.length === 0) return "loading";
  if (error && events.length === 0) return "error";
  if (derivationFailedCount > 0 && events.length === 0) return "partial";
  if (events.length === 0) return "empty";
  if (error) return "stale";
  if (loading) return "loading";
  if (
    truncated
    || derivationFailedCount > 0
    || events.some((event) => event.unknownFields?.length > 0)
  ) return "partial";
  return "success";
}

function RunOfShowEvent({ event }) {
  const presentations = milestonePresentations(event);
  const commercialEvidence = commercialEvidenceLines(event);
  const knownCheckpointCount = event.timeline.filter((checkpoint) => (
    checkpoint.timingState === "known"
  )).length;
  const unknowns = unknownFieldLabels(event.unknownFields);

  return (
    <details
      className={`customer-version-history schedule-event-card ${event.quoteStatus}`}
      data-capability-state={unknowns.length > 0 ? "partial" : "success"}
    >
      <summary>
        {formatWorkspaceText(event.quoteNumber, { emptyLabel: "Quote number pending" })}: {formatWorkspaceText(event.event?.name, { emptyLabel: "Untitled event" })}
        {` (${knownCheckpointCount} of ${event.timeline.length} checkpoint times available)`}
      </summary>

      <div className="right-actions" aria-label="Run-of-show commercial and operational states">
        {presentations.map((presentation) => (
          <StatusChip key={presentation.label} {...presentation} />
        ))}
      </div>

      <div className="quote-version-comparison-sections">
        <dl>
          <div>
            <dt>Commercial state</dt>
            <dd>
              {eventStatusLabel(event.quoteStatus)}
              <small>Acceptance and booking are tracked separately.</small>
              <small>{commercialEvidence.acceptanceLine}</small>
              <small>{commercialEvidence.bookingLine}</small>
            </dd>
          </div>
          <div>
            <dt>Event</dt>
            <dd>
              {formatWorkspaceDate(event.event?.date, { emptyLabel: "Date not recorded" })}
              <small>
                {formatWorkspaceText(event.event?.time, { emptyLabel: "Start time not recorded" })}, {formatWorkspaceText(event.event?.venue, { emptyLabel: "Venue not recorded" })}
              </small>
              <small>{formatWorkspaceText(event.event?.venueAddress, { emptyLabel: "Venue address not recorded" })}</small>
            </dd>
          </div>
          <div>
            <dt>Event scope</dt>
            <dd>
              {eventScopeLine(event.event)}
              <small>
                Dietary restrictions: {formatWorkspaceText(event.event?.dietaryRestrictions, { emptyLabel: "Not recorded" })}
              </small>
            </dd>
          </div>
          <div>
            <dt>Staffing inputs</dt>
            <dd>{staffingLine(event.staffing)}</dd>
          </div>
          <div>
            <dt>Production checks</dt>
            <dd>
              {checklistLine(event.productionChecklist)}
              <small>Checklist state does not establish operational readiness.</small>
            </dd>
          </div>
          <div>
            <dt>Kitchen BEO basis</dt>
            <dd>
              {beoRevisionLabel(event.beoReference)}
              <small>A BEO can be derived. No retained BEO artifact or freshness evidence was read.</small>
            </dd>
          </div>
        </dl>
      </div>

      {unknowns.length > 0 && (
        <p className="warning-note" role="status">
          Missing source details: {unknowns.join(", ")}.
        </p>
      )}

      <section className="workflow-timeline-section" aria-label="Event-day sequence">
        <h4>Event-day sequence</h4>
        <ol className="workflow-timeline">
          {event.timeline.map((checkpoint) => (
            <li key={`${event.quoteId || event.quoteNumber}-${checkpoint.id}`}>
              <span aria-hidden="true" />
              <div>
                <strong>{checkpoint.label}</strong>
                {checkpoint.timingState === "known" ? (
                  <p>
                    {checkpoint.date ? `${formatWorkspaceDate(checkpoint.date)} at ` : ""}
                    {checkpoint.timeLabel}. Timing source: {timingBasisLabel(checkpoint.timingBasis)}.
                  </p>
                ) : (
                  <p>
                    {timingUnknownLabel(checkpoint.uncertaintyReason)} Timing source: {timingBasisLabel(checkpoint.timingBasis)}.
                  </p>
                )}
              </div>
            </li>
          ))}
        </ol>
      </section>
    </details>
  );
}

export function EventRunOfShowPanel({
  model = {},
  selectedDateLabel = "Selected day",
  loading = false,
  error = "",
  onRetry = null
}) {
  const events = Array.isArray(model.events) ? model.events : [];
  const bounds = model.bounds || {};
  const source = model.generatedFrom?.source || {};
  const truncated = bounds.truncated === true;
  const derivationFailedCount = Number(bounds.derivationFailedCount || 0);
  const hasUnknowns = events.some((event) => event.unknownFields?.length > 0);
  const state = resolvePanelState({
    events,
    loading,
    error,
    truncated,
    derivationFailedCount
  });
  const sourceLabel = loading && events.length === 0 && source.id === "unknown"
    ? "Loading tenant records"
    : formatWorkspaceText(source.label, { emptyLabel: "Source not confirmed" });

  return (
    <section
      className="schedule-staff-board event-run-of-show"
      aria-labelledby="event-run-of-show-title"
      aria-busy={loading}
      data-capability-id="event-run-of-show"
      data-capability-state={state}
      data-read-state={loading && events.length > 0 ? "refreshing" : state}
    >
      <div className="schedule-staff-head">
        <div>
          <h4 id="event-run-of-show-title">Run of show</h4>
          <p className="source-note">Read-only sequence for {selectedDateLabel}.</p>
        </div>
      </div>

      <p className="source-note" data-capability-state="source">
        Source: {sourceLabel}. Authority: {sourceAuthorityLabel(source.authority)}.
      </p>
      <p className="source-note" data-capability-state={truncated ? "partial" : "bounds"}>
        Selected-day bounds: showing {Number(bounds.displayedCount || 0)} of {Number(bounds.eligibleCount || 0)} accepted or booked records derived from {Number(bounds.inputCount || 0)} loaded quotes for this date.
        {bounds.upstreamLimit ? ` The Schedule read is capped at ${Number(bounds.upstreamLimit)} tenant quotes.` : ""}
      </p>
      <p className="source-note">
        {formatWorkspaceText(model.proofBoundary, {
          emptyLabel: "This projection does not establish payment, staffing attendance, inventory availability, or operational readiness."
        })}
      </p>

      {loading && events.length === 0 && (
        <p className="source-note" role="status">Loading run-of-show records for this day.</p>
      )}
      {loading && events.length > 0 && (
        <p className="warning-note" role="status">
          Refreshing run-of-show records. The prior read-only projection remains visible.
        </p>
      )}
      {error && events.length === 0 && (
        <p className="error-note" role="alert">
          Run of show unavailable. Retry the tenant-scoped Schedule read.
        </p>
      )}
      {error && events.length > 0 && (
        <p className="warning-note" role="alert">
          Refresh failed. Showing the last loaded read-only projection; it may be stale.
        </p>
      )}
      {truncated && (
        <p className="warning-note" role="status">
          This projection is bounded. Additional matching records may exist outside the loaded result.
        </p>
      )}
      {derivationFailedCount > 0 && (
        <p className="warning-note" role="status">
          {derivationFailedCount} eligible record{derivationFailedCount === 1 ? "" : "s"} could not be safely projected and {derivationFailedCount === 1 ? "is" : "are"} excluded from this view.
        </p>
      )}
      {hasUnknowns && events.length > 0 && (
        <p className="warning-note" role="status">
          Some event, staffing, or schedule details are not recorded. Expand an event to review what is missing.
        </p>
      )}
      {state === "empty" && (
        <p className="muted">No accepted or booked events for this day. Select another date or refresh after a quote changes.</p>
      )}
      {error && typeof onRetry === "function" && (
        <button
          type="button"
          className="ghost compact"
          data-capability-state="recovery"
          onClick={onRetry}
        >
          Retry run of show
        </button>
      )}

      {events.length > 0 && (
        <div className="schedule-event-list">
          {events.map((event, index) => (
            <RunOfShowEvent
              key={event.quoteId || `${event.quoteNumber}-${index}`}
              event={event}
            />
          ))}
        </div>
      )}
    </section>
  );
}

export default EventRunOfShowPanel;
