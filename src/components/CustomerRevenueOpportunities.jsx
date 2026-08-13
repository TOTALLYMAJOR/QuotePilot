import { buildCustomerRebookingRadar } from "../lib/customerRebookingRadar";
import {
  formatWorkspaceDate,
  formatWorkspaceInteger,
  formatWorkspaceText
} from "../lib/workspacePresentation";
import CustomerRebookDraftAction from "./CustomerRebookDraftAction";
import PostEventCloseoutReviewAction from "./PostEventCloseoutReviewAction";

const SOURCE_LABELS = Object.freeze({
  firebase: "Firestore customer workspace",
  local: "Browser-local customer workspace",
  mixed: "Mixed customer workspace sources"
});

const REBOOK_UNAVAILABLE_REASONS = Object.freeze({
  acceptance_receipt_missing: "No acceptance receipt is available for this booked quote.",
  acceptance_receipt_incomplete: "The recorded acceptance receipt is incomplete.",
  accepted_version_identity_missing: "The accepted proposal version is not identified.",
  accepted_revision_mismatch: "The acceptance receipt does not match the active accepted version.",
  accepted_source_version_not_loaded: "The accepted proposal version is not available in this customer read.",
  accepted_source_version_not_loaded_history_truncated:
    "The accepted proposal version is older than the retained history loaded into this bounded view.",
  accepted_source_version_ambiguous: "More than one retained version matches the accepted version identity.",
  accepted_source_version_invalid: "The retained accepted version does not pass quote and organization scope checks.",
  existing_rebook_not_found_quote_history_truncated:
    "A matching rebook may exist beyond the quotes currently shown in this client overview. Refresh the client overview or open Quotes before creating another draft.",
  existing_rebook_invalid:
    "A same-customer rebook record claims this source but its trusted provenance is incomplete. Open Quotes and repair that record before continuing.",
  existing_rebook_ambiguous:
    "More than one exact rebook record matches this accepted source. Open Quotes and resolve the conflict before continuing."
});

function text(value) {
  return String(value ?? "").trim();
}

function normalizeTimeZone(value) {
  const requested = text(value);
  if (!requested) return "";
  try {
    return new Intl.DateTimeFormat("en-US", { timeZone: requested })
      .resolvedOptions()
      .timeZone;
  } catch {
    return "";
  }
}

function calendarDateAt(instant, timeZone) {
  const parts = new Intl.DateTimeFormat("en-US", {
    calendar: "gregory",
    numberingSystem: "latn",
    timeZone,
    year: "numeric",
    month: "2-digit",
    day: "2-digit"
  }).formatToParts(instant);
  const values = Object.fromEntries(parts.map((part) => [part.type, part.value]));
  return `${values.year}-${values.month}-${values.day}`;
}

function resolvedDeviceTimeZone(explicitDeviceTimeZone = "") {
  const supplied = normalizeTimeZone(explicitDeviceTimeZone);
  if (supplied) return supplied;
  try {
    return normalizeTimeZone(Intl.DateTimeFormat().resolvedOptions().timeZone);
  } catch {
    return "";
  }
}

export function resolveCustomerRevenueCalendarContext({
  loadedAt,
  tenantTimeZone = "",
  deviceTimeZone = ""
} = {}) {
  const instant = loadedAt instanceof Date ? new Date(loadedAt.getTime()) : new Date(loadedAt);
  if (Number.isNaN(instant.getTime())) {
    throw new TypeError("A completed client-overview read time is required before checking follow-ups.");
  }

  const requestedTenantTimeZone = text(tenantTimeZone);
  if (requestedTenantTimeZone) {
    const timeZone = normalizeTimeZone(requestedTenantTimeZone);
    if (!timeZone) {
      throw new TypeError("The explicitly supplied tenant time zone is not a valid IANA time zone.");
    }
    return {
      date: calendarDateAt(instant, timeZone),
      source: "tenant",
      timeZone,
      instantISO: instant.toISOString()
    };
  }

  const timeZone = resolvedDeviceTimeZone(deviceTimeZone);
  if (!timeZone) {
    throw new TypeError("The device-local IANA time zone could not be resolved.");
  }
  return {
    date: calendarDateAt(instant, timeZone),
    source: "device",
    timeZone,
    instantISO: instant.toISOString()
  };
}

export function buildCustomerRevenueOpportunityRead({
  workspace,
  organizationId,
  loadedAt,
  tenantTimeZone = "",
  deviceTimeZone = ""
} = {}) {
  const calendarContext = resolveCustomerRevenueCalendarContext({
    loadedAt,
    tenantTimeZone,
    deviceTimeZone
  });
  return buildCustomerRebookingRadar(workspace, {
    organizationId,
    calendarContext
  });
}

export function describeUnavailableRebookReason(reason) {
  return REBOOK_UNAVAILABLE_REASONS[text(reason)]
    || "The exact accepted immutable proposal source could not be verified from this bounded read.";
}

function sourceLabel(source) {
  return SOURCE_LABELS[text(source).toLowerCase()] || "Customer workspace source not confirmed";
}

function partialBoundsSummary(pageInfo = {}) {
  const notes = [];
  if (pageInfo.radarTruncated) {
    notes.push(
      `Showing the first ${formatWorkspaceInteger(pageInfo.returned)} of ${formatWorkspaceInteger(pageInfo.candidateCount)} eligible opportunities.`
    );
  }
  if (pageInfo.quoteReadTruncated) {
    notes.push("Older linked quotes may contain additional opportunities.");
  }
  if (pageInfo.versionReadTruncated) {
    notes.push("Some accepted-source checks are limited by the retained proposal history loaded here.");
  }
  return notes.join(" ") || "This follow-up view is partial because the client overview reached its quote limit.";
}

function rebookReviewLabel(state) {
  if (text(state) === "draft_created_for_staff_review") return "Staff review required";
  if (text(state) === "staff_review_completed") return "Staff review completed";
  return "Review state unavailable";
}

function OpportunityEvidence({ opportunity }) {
  if (opportunity.type !== "anniversary_rebooking") {
    return <p className="source-note">{opportunity.evidenceCopy}</p>;
  }
  const action = opportunity.reviewedAction || {};
  if (action.state === "ready_for_staff_review") {
    return (
      <>
        <p className="source-note" data-rebook-source-state="verified">
          Accepted source identified: version {formatWorkspaceText(action.sourceVersionId)}. No matching trusted rebook record was found in this completed bounded customer read.
        </p>
        <p className="source-note">{opportunity.evidenceCopy}</p>
      </>
    );
  }
  if (action.state === "existing_rebook") {
    return (
      <>
        <p className="source-note" data-rebook-source-state="existing">
          Matching rebook found: {formatWorkspaceText(action.existingQuoteNumber || action.existingQuoteId)} ({formatWorkspaceText(action.existingQuoteStatus)}). {rebookReviewLabel(action.existingReviewState)}.
        </p>
        <p className="source-note">{opportunity.evidenceCopy}</p>
      </>
    );
  }
  return (
    <>
      <p className="warning-note" data-rebook-source-state="unavailable">
        Rebook source unavailable: {describeUnavailableRebookReason(action.reason)}
      </p>
      <p className="source-note">{opportunity.evidenceCopy}</p>
    </>
  );
}

function OpportunityCard({
  opportunity,
  onOpenQuote,
  onOpenQuoteEdit,
  onCreateRebook,
  rebookCreationAvailable,
  closeoutReviewAvailable,
  onCloseoutReceipt
}) {
  const actionQuoteId = opportunity.reviewedAction?.sourceQuoteId || opportunity.quoteId;
  const reviewedAction = opportunity.reviewedAction || {};
  const existingQuoteId = text(reviewedAction.existingQuoteId);
  const existingNeedsEdit = reviewedAction.state === "existing_rebook"
    && text(reviewedAction.existingQuoteStatus).toLowerCase() === "draft"
    && text(reviewedAction.existingReviewState) === "draft_created_for_staff_review";
  const existingOpenAvailable = existingNeedsEdit
    ? typeof onOpenQuoteEdit === "function"
    : typeof onOpenQuote === "function";
  const venue = text(opportunity.event?.venue);
  return (
    <article className="customer-revenue-opportunity" data-opportunity-type={opportunity.type}>
      <div>
        <span className="customer-revenue-opportunity-type">
          {opportunity.type === "anniversary_rebooking" ? "Repeat-event reminder" : "Post-event follow-up"}
        </span>
        <h3>{opportunity.title}</h3>
        <p>
          {formatWorkspaceDate(opportunity.event?.date)}
          {venue ? ` at ${formatWorkspaceText(venue)}` : ""}
        </p>
        {opportunity.type === "post_event_closeout" && (
          <>
            <p className="source-note">
              Review window: {formatWorkspaceDate(opportunity.timing?.eligibleFromDate)} to {formatWorkspaceDate(opportunity.timing?.eligibleThroughDate)}.
            </p>
            <ul>
              {(opportunity.reviewItems || []).map((item) => (
                <li key={item.code}>{item.label}</li>
              ))}
            </ul>
            <PostEventCloseoutReviewAction
              opportunity={opportunity}
              available={closeoutReviewAvailable}
              onReceipt={onCloseoutReceipt}
            />
          </>
        )}
        {opportunity.type === "anniversary_rebooking" && (
          <p className="source-note">
            Anniversary date: {formatWorkspaceDate(opportunity.timing?.anniversaryDate)}.
          </p>
        )}
        <OpportunityEvidence opportunity={opportunity} />
        {opportunity.type === "anniversary_rebooking"
          && opportunity.reviewedAction?.state === "ready_for_staff_review" && (
          <CustomerRebookDraftAction
            reviewedAction={opportunity.reviewedAction}
            available={rebookCreationAvailable}
            onCreateRebook={onCreateRebook}
            onOpenQuote={onOpenQuote}
            onOpenQuoteEdit={onOpenQuoteEdit}
          />
        )}
        {opportunity.type === "anniversary_rebooking"
          && reviewedAction.state === "existing_rebook"
          && existingQuoteId && (
          <div className="right-actions">
            <button
              type="button"
              className="ghost compact"
              data-capability-action="open-existing-rebook"
              data-existing-quote-id={existingQuoteId}
              disabled={!existingOpenAvailable}
              onClick={() => {
                if (existingNeedsEdit) onOpenQuoteEdit?.(existingQuoteId);
                else onOpenQuote?.(existingQuoteId);
              }}
            >
              {existingNeedsEdit ? "Open draft to review" : "Open matching quote"}
            </button>
          </div>
        )}
      </div>
      {typeof onOpenQuote === "function" && actionQuoteId && (
        <div className="right-actions">
          <button
            type="button"
            className="ghost compact"
            data-capability-action="open-authoritative-source-quote"
            onClick={() => onOpenQuote(actionQuoteId)}
          >
            Open source quote
          </button>
        </div>
      )}
    </article>
  );
}

export function CustomerRevenueOpportunitiesPresentation({
  radar = null,
  error = "",
  loading = false,
  stale = false,
  onOpenQuote,
  onOpenQuoteEdit,
  onCreateRebook,
  rebookCreationAvailable = true,
  closeoutReviewAvailable = true,
  onCloseoutReceipt
}) {
  const state = error && !radar
    ? "error"
    : stale && radar
      ? "stale"
      : loading
        ? "loading"
        : radar?.status || "empty";
  const opportunities = Array.isArray(radar?.opportunities) ? radar.opportunities : [];
  const pageInfo = radar?.pageInfo || {};

  return (
    <section
      className="customer-relationship-briefing customer-revenue-opportunities"
      aria-labelledby="customer-revenue-opportunities-title"
      data-capability-id="cwf-11-rebooking-radar"
      data-capability-state={state}
      data-read-state={loading && radar ? "refreshing" : state}
    >
      <div className="workspace-route-head">
        <div>
          <h2 id="customer-revenue-opportunities-title">Follow-ups worth revisiting</h2>
          <p className="muted">Post-event follow-ups and repeat-event reminders from recorded bookings.</p>
        </div>
        <span className="source-note">Source: {sourceLabel(radar?.source)}</span>
      </div>

      {error && !radar ? (
        <p className="warning-note" role="alert">
          Follow-ups could not be checked for this completed client read. No actions were created.
        </p>
      ) : loading && !radar ? (
        <p className="source-note" role="status">Checking bounded closeout and anniversary windows.</p>
      ) : (
        <>
          {loading && radar && (
            <p className="source-note" role="status">
              Refreshing the client overview; the previous follow-up check remains visible.
            </p>
          )}
          {stale && radar && (
            <p className="warning-note" role="alert">
              The client overview refresh failed. These reminders come from the retained snapshot and may be stale.
            </p>
          )}
          {error && radar && (
            <p className="warning-note" role="alert">
              The current follow-up check failed. The previous bounded check remains visible.
            </p>
          )}
          <p className="source-note">
            {radar?.calendarContext?.label || "Calendar source not confirmed"}: {formatWorkspaceDate(radar?.calendarContext?.date)} ({formatWorkspaceText(radar?.calendarContext?.timeZone, { emptyLabel: "time zone unavailable" })}).
          </p>
          <p className="source-note">
            Review bound: first {formatWorkspaceInteger(pageInfo.limit)} eligible follow-ups from this bounded client read.
          </p>
          <p className="source-note">
            {radar?.evidenceCopy?.opportunity || "These reminders are read-only. They do not record a completed follow-up or booking."}
          </p>
          {state === "partial" && (
            <p className="warning-note" role="status" data-capability-state="partial">
              {partialBoundsSummary(pageInfo)}
            </p>
          )}
          {opportunities.length === 0 ? (
            <p className="source-note" role="status">
              No closeout or anniversary cues fall within this calendar window in the bounded customer read.
            </p>
          ) : (
            <div className="customer-card-list">
              {opportunities.map((opportunity) => (
                <OpportunityCard
                  key={opportunity.id}
                  opportunity={opportunity}
                  onOpenQuote={onOpenQuote}
                  onOpenQuoteEdit={onOpenQuoteEdit}
                  onCreateRebook={onCreateRebook}
                  rebookCreationAvailable={rebookCreationAvailable}
                  closeoutReviewAvailable={closeoutReviewAvailable}
                  onCloseoutReceipt={onCloseoutReceipt}
                />
              ))}
            </div>
          )}
        </>
      )}
    </section>
  );
}

export default CustomerRevenueOpportunitiesPresentation;
