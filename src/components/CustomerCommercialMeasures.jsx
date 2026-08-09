import { buildCustomerCommercialMeasures } from "../lib/customerCommercialMeasures";
import {
  formatWorkspaceInteger,
  formatWorkspaceMoney
} from "../lib/workspacePresentation";

const PRESENTATION_STATES = new Set(["empty", "partial", "success"]);

function text(value) {
  return String(value ?? "").trim();
}

function count(value) {
  const parsed = Number(value);
  return Number.isSafeInteger(parsed) && parsed >= 0 ? parsed : 0;
}

function modelState(model) {
  const state = text(model?.status).toLowerCase();
  return PRESENTATION_STATES.has(state) ? state : "partial";
}

export function customerCommercialMeasuresPresentationState({
  measures = null,
  loading = false,
  error = "",
  stale = false
} = {}) {
  if (!measures && text(error)) return "error";
  if (!measures && loading) return "loading";
  if (!measures) return "empty";
  if (stale) return "stale";
  if (loading) return "loading";
  return modelState(measures);
}

function measureAmountLabel(measure = {}) {
  const eligible = count(measure?.denominator?.eligibleRecordCount);
  const known = count(measure?.denominator?.knownAmountRecordCount);
  if (eligible === 0) return "No eligible records";
  if (known === 0 || measure.amount === null || measure.amount === undefined) {
    return "Amount unavailable";
  }
  return formatWorkspaceMoney(measure.amount, { emptyLabel: "Amount unavailable" });
}

function measureCoverageLabel(measure = {}) {
  const denominator = measure.denominator || {};
  const eligible = count(denominator.eligibleRecordCount);
  const known = count(denominator.knownAmountRecordCount);
  const unknown = count(denominator.unknownAmountRecordCount);
  if (eligible === 0) return "No eligible displayed records.";
  if (unknown > 0) {
    return `${known} of ${eligible} eligible displayed amounts are known; ${unknown} ${unknown === 1 ? "is" : "are"} unavailable. The value shown is the known subtotal only.`;
  }
  return `${known} of ${eligible} eligible displayed amounts are known.`;
}

function MeasureCard({ measure }) {
  const denominator = measure?.denominator || {};
  const evidenceMissing = count(denominator.evidenceMissingRecordCount);
  const stateMismatch = count(denominator.stateMismatchRecordCount);
  const currencyMismatch = count(denominator.currencyMismatchRecordCount);

  return (
    <article
      className="metric-card"
      data-measure-id={measure?.id || "unknown"}
      data-measure-state={modelState(measure)}
    >
      <span>{measure?.label || "Commercial amount"}</span>
      <strong>{measureAmountLabel(measure)}</strong>
      <small>{measureCoverageLabel(measure)}</small>
      {evidenceMissing > 0 && (
        <small className="warning-note">
          {formatWorkspaceInteger(evidenceMissing)} paid-state {evidenceMissing === 1 ? "record lacks" : "records lack"} trusted Firebase provider evidence.
        </small>
      )}
      {stateMismatch > 0 && (
        <small className="warning-note">
          {formatWorkspaceInteger(stateMismatch)} provider-confirmation {stateMismatch === 1 ? "record does" : "records do"} not pair with a current paid state and is excluded.
        </small>
      )}
      {currencyMismatch > 0 && (
        <small className="warning-note">
          {formatWorkspaceInteger(currencyMismatch)} non-USD {currencyMismatch === 1 ? "amount is" : "amounts are"} excluded from this USD subtotal.
        </small>
      )}
    </article>
  );
}

function boundsSummary(measures = {}) {
  const bounds = measures.bounds || {};
  const displayed = count(bounds.displayedRecordCount);
  const limit = count(bounds.quoteReadLimit);
  const excluded = count(bounds.excludedQuoteCount);
  const notes = [];

  if (bounds.quoteReadTruncationKnown !== true) {
    notes.push(`${formatWorkspaceInteger(displayed)} customer-scoped quote ${displayed === 1 ? "record is" : "records are"} displayed; read completeness was not reported.`);
  } else if (bounds.quoteReadTruncated) {
    notes.push(`${formatWorkspaceInteger(displayed)} customer-scoped quote ${displayed === 1 ? "record is" : "records are"} displayed from a read capped at ${formatWorkspaceInteger(limit)}; older linked records exist beyond this view.`);
  } else {
    notes.push(`${formatWorkspaceInteger(displayed)} customer-scoped quote ${displayed === 1 ? "record was" : "records were"} evaluated; the read reports complete within its ${formatWorkspaceInteger(limit)}-record bound.`);
  }

  if (excluded > 0) {
    notes.push(`${formatWorkspaceInteger(excluded)} input ${excluded === 1 ? "record was" : "records were"} excluded because customer or quote identity could not be verified.`);
  }
  return notes.join(" ");
}

function partialSummary(measures = {}) {
  const unknownInputs = Object.values(measures.measures || {}).reduce((total, measure) => (
    total + count(measure?.denominator?.unknownAmountRecordCount)
  ), 0);
  const notes = [];
  if (measures?.bounds?.quoteReadTruncated) {
    notes.push("Older linked quotes are outside this displayed-record calculation.");
  } else if (measures?.bounds?.quoteReadTruncationKnown !== true) {
    notes.push("Read completeness is unknown, so only displayed-record measures are shown.");
  }
  if (count(measures?.bounds?.excludedQuoteCount) > 0) {
    notes.push("Unverified-scope records were excluded.");
  }
  if (unknownInputs > 0) {
    notes.push(`${formatWorkspaceInteger(unknownInputs)} eligible measure ${unknownInputs === 1 ? "input has" : "inputs have"} an unavailable amount or required payment evidence.`);
  }
  return notes.join(" ") || "One or more displayed measures have incomplete source evidence.";
}

function RepeatEventSignal({ signal = {} }) {
  const bookedCount = count(signal.bookedEventCount);
  const repeatCount = count(signal.repeatBookingCount);
  const knownDates = count(signal.knownEventDateCount);
  const unknownDates = count(signal.unknownEventDateCount);
  const hasDateSpan = Number.isSafeInteger(signal.dateSpanDays) && signal.dateSpanDays >= 0;

  return (
    <article
      className="metric-card"
      data-measure-id="repeat-event-signal"
      data-measure-state={modelState(signal)}
    >
      <span>Recorded repeat-event signal</span>
      <strong>
        {bookedCount === 0
          ? "No booked events"
          : `${formatWorkspaceInteger(bookedCount)} booked ${bookedCount === 1 ? "event" : "events"}`}
      </strong>
      <small>
        {repeatCount > 0
          ? `${formatWorkspaceInteger(repeatCount)} repeat ${repeatCount === 1 ? "booking" : "bookings"} after the first recorded event.`
          : "A second booked event has not been recorded in this view."}
      </small>
      <small>
        {hasDateSpan
          ? `Recorded event-date span: ${formatWorkspaceInteger(signal.dateSpanDays)} ${signal.dateSpanDays === 1 ? "day" : "days"}.`
          : "A complete booked-event date span is unavailable."}
      </small>
      <small>
        {formatWorkspaceInteger(knownDates)} of {formatWorkspaceInteger(bookedCount)} booked event dates are known
        {unknownDates > 0 ? `; ${formatWorkspaceInteger(unknownDates)} unavailable.` : "."}
      </small>
    </article>
  );
}

export function CustomerCommercialMeasuresPresentation({
  measures = null,
  loading = false,
  error = "",
  stale = false,
  onRetry
}) {
  const state = customerCommercialMeasuresPresentationState({
    measures,
    loading,
    error,
    stale
  });
  const underlyingState = measures ? modelState(measures) : "empty";
  const measureList = measures ? Object.values(measures.measures || {}) : [];
  const fatalError = state === "error";
  const initialLoading = state === "loading" && !measures;

  return (
    <section
      className="customer-relationship-briefing"
      aria-labelledby="customer-commercial-measures-title"
      aria-busy={loading || undefined}
      data-capability-id="cwf-13-customer-commercial-measures"
      data-capability-state={state}
      data-model-state={underlyingState}
      data-read-state={loading && measures ? "refreshing" : state}
    >
      <div className="workspace-route-head">
        <div>
          <p className="eyebrow">Customer record evidence</p>
          <h2 id="customer-commercial-measures-title">Commercial measures</h2>
          <p className="muted">Quote and booking measures; provider-confirmed payments require Firebase-backed Customer 360.</p>
        </div>
        <span className="source-note">
          Source: {measures?.sourceLabel || "Customer workspace source not confirmed"}
        </span>
      </div>

      {fatalError ? (
        <div className="reporting-evidence-rail reporting-evidence-error" role="alert">
          <div className="reporting-evidence-copy">
            <h3>Commercial measures unavailable</h3>
            <p>The customer read could not be evaluated. No amount or repeat-event result is being shown.</p>
          </div>
          {typeof onRetry === "function" && (
            <button type="button" className="ghost" data-capability-state="recovery" onClick={onRetry}>
              Retry
            </button>
          )}
        </div>
      ) : initialLoading ? (
        <p className="source-note" role="status">Evaluating customer-scoped quote and payment evidence.</p>
      ) : !measures ? (
        <p className="source-note" role="status">No completed customer read is available for commercial measures.</p>
      ) : (
        <>
          {loading && (
            <p className="source-note" role="status">
              Refreshing Customer 360; the prior displayed measures remain visible.
            </p>
          )}
          {(stale || (text(error) && measures)) && (
            <p className="warning-note" role="alert">
              The latest Customer 360 refresh did not complete. These retained displayed-record measures may be stale.
            </p>
          )}
          <p className="source-note" data-commercial-measures-scope={measures?.scope?.kind || "unknown"}>
            Read scope: {boundsSummary(measures)}
          </p>
          <p className="source-note">
            {measures.evidenceBoundary || "Derived from customer-scoped canonical quote records only."}
          </p>
          <p className="warning-note">
            Operational commercial measures only; do not treat these values as an accounting ledger, cash reconciliation, or recognized-revenue report.
          </p>
          {underlyingState === "partial" && (
            <p className="warning-note" role="status" data-capability-state="partial">
              {partialSummary(measures)}
            </p>
          )}
          {underlyingState === "empty" ? (
            <p className="source-note" role="status">
              No eligible customer-linked quote records are available in this completed read.
            </p>
          ) : (
            <div className="dashboard-grid" aria-label="Commercial measures from displayed customer quote records">
              {measureList.map((measure) => (
                <MeasureCard key={measure.id} measure={measure} />
              ))}
              <RepeatEventSignal signal={measures.repeatEventSignal} />
            </div>
          )}
        </>
      )}
    </section>
  );
}

export default function CustomerCommercialMeasures({
  workspace = null,
  loading = false,
  error = "",
  stale = false,
  onRetry
}) {
  let measures = null;
  let derivationError = "";
  if (workspace) {
    try {
      measures = buildCustomerCommercialMeasures(workspace);
    } catch {
      derivationError = "Commercial measures could not be derived from this customer read.";
    }
  }

  return (
    <CustomerCommercialMeasuresPresentation
      measures={measures}
      loading={loading}
      error={text(error) || derivationError}
      stale={stale}
      onRetry={onRetry}
    />
  );
}
