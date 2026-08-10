import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useModalDialog } from "../hooks/useModalDialog";
import { currency } from "../lib/quoteCalculator";
import { getQuoteHistory } from "../lib/quoteStore";
import { getProductAnalyticsSummary } from "../lib/productAnalytics";

export const REPORTING_QUOTE_LIMIT = 500;
const REPORTING_MONTH_COUNT = 6;
const QUOTE_STATUSES = new Set(["draft", "sent", "viewed", "accepted", "booked", "declined", "expired"]);

function finiteMoney(value) {
  if (value === null || value === undefined || value === "") return null;
  const parsed = Number(value);
  return Number.isFinite(parsed) && parsed >= 0 ? parsed : null;
}

function normalizedEvidenceISO(value) {
  let candidate = value;
  if (typeof value?.toDate === "function") candidate = value.toDate();
  if (candidate instanceof Date) {
    return Number.isNaN(candidate.getTime()) ? "" : candidate.toISOString();
  }
  const raw = String(candidate ?? "").trim();
  if (!/^\d{4}-\d{2}-\d{2}T/.test(raw)) return "";
  const parsed = new Date(raw);
  return Number.isNaN(parsed.getTime()) ? "" : parsed.toISOString();
}

function monthKeyFromISO(iso) {
  const dt = new Date(iso || "");
  if (Number.isNaN(dt.getTime())) return "";
  return `${dt.getUTCFullYear()}-${String(dt.getUTCMonth() + 1).padStart(2, "0")}`;
}

function monthLabel(monthKey) {
  const [year, month] = String(monthKey).split("-");
  const dt = new Date(Date.UTC(Number(year), Number(month) - 1, 1));
  return dt.toLocaleDateString(undefined, {
    month: "short",
    year: "numeric",
    timeZone: "UTC"
  });
}

function recentMonthKeys(count, nowDate = new Date()) {
  const out = [];
  const now = new Date(nowDate);
  for (let i = count - 1; i >= 0; i -= 1) {
    const dt = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth() - i, 1));
    out.push(`${dt.getUTCFullYear()}-${String(dt.getUTCMonth() + 1).padStart(2, "0")}`);
  }
  return out;
}

export function buildReportingMetrics(quotes = [], {
  nowDate = new Date(),
  source = ""
} = {}) {
  const sourceQuotes = Array.isArray(quotes) ? quotes : [];
  const providerPaymentEvidenceTrusted = String(source).trim().toLowerCase() === "firebase";
  const totals = {
    quotes: sourceQuotes.length,
    draft: 0,
    sent: 0,
    viewed: 0,
    accepted: 0,
    booked: 0,
    declined: 0,
    expired: 0,
    statusUnknown: 0,
    paymentUnpaid: 0,
    paymentSent: 0,
    paymentPaid: 0,
    paymentPaidVerified: 0,
    paymentPaidUnverified: 0,
    paymentRefunded: 0,
    paymentUnknown: 0,
    quotedValue: 0,
    pipelineValue: 0,
    wonValue: 0,
    paidDepositValue: 0,
    quotedValueKnown: 0,
    quotedValueUnknown: 0,
    pipelineValueKnown: 0,
    pipelineValueUnknown: 0,
    wonValueKnown: 0,
    wonValueUnknown: 0,
    paidDepositValueKnown: 0,
    paidDepositValueUnknown: 0,
    paidDepositAmountUnknown: 0,
    paidDepositEvidenceMissing: 0
  };

  sourceQuotes.forEach((quote) => {
    const status = String(quote?.status || "").trim().toLowerCase();
    const value = finiteMoney(quote?.totals?.total);
    const depositValue = finiteMoney(quote?.totals?.deposit);
    const paymentStatus = String(quote?.payment?.depositStatus || "").trim().toLowerCase();

    if (value === null) {
      totals.quotedValueUnknown += 1;
    } else {
      totals.quotedValue += value;
      totals.quotedValueKnown += 1;
    }
    if (QUOTE_STATUSES.has(status)) {
      totals[status] += 1;
    } else {
      totals.statusUnknown += 1;
    }
    if (paymentStatus === "paid") {
      totals.paymentPaid += 1;
      const providerConfirmed = providerPaymentEvidenceTrusted
        && Boolean(normalizedEvidenceISO(quote?.payment?.depositConfirmedAtISO));
      if (!providerConfirmed) {
        totals.paymentPaidUnverified += 1;
        totals.paidDepositEvidenceMissing += 1;
        totals.paidDepositValueUnknown += 1;
      } else if (depositValue === null) {
        totals.paymentPaidVerified += 1;
        totals.paidDepositAmountUnknown += 1;
        totals.paidDepositValueUnknown += 1;
      } else {
        totals.paymentPaidVerified += 1;
        totals.paidDepositValue += depositValue;
        totals.paidDepositValueKnown += 1;
      }
    } else if (paymentStatus === "sent") {
      totals.paymentSent += 1;
    } else if (paymentStatus === "refunded") {
      totals.paymentRefunded += 1;
    } else if (paymentStatus === "unpaid") {
      totals.paymentUnpaid += 1;
    } else {
      totals.paymentUnknown += 1;
    }
    if (["draft", "sent", "viewed"].includes(status)) {
      if (value === null) {
        totals.pipelineValueUnknown += 1;
      } else {
        totals.pipelineValue += value;
        totals.pipelineValueKnown += 1;
      }
    }
    if (status === "accepted" || status === "booked") {
      if (value === null) {
        totals.wonValueUnknown += 1;
      } else {
        totals.wonValue += value;
        totals.wonValueKnown += 1;
      }
    }
  });

  const wins = totals.accepted + totals.booked;
  const decisionPool = wins + totals.declined + totals.expired;
  const closeRate = decisionPool > 0 ? (wins / decisionPool) * 100 : null;
  const conversionRate = totals.quotes > 0 ? (wins / totals.quotes) * 100 : null;

  const monthKeys = recentMonthKeys(REPORTING_MONTH_COUNT, nowDate);
  const months = monthKeys.map((monthKey) => ({
    monthKey,
    label: monthLabel(monthKey),
    quotes: 0,
    sent: 0,
    won: 0,
    wonValue: 0,
    wonValueKnown: 0,
    wonValueUnknown: 0
  }));

  sourceQuotes.forEach((quote) => {
    const key = monthKeyFromISO(quote.createdAtISO);
    const row = months.find((item) => item.monthKey === key);
    if (!row) return;
    const status = String(quote?.status || "").trim().toLowerCase();
    row.quotes += 1;
    if (["sent", "viewed", "accepted", "booked"].includes(status)) {
      row.sent += 1;
    }
    if (status === "accepted" || status === "booked") {
      row.won += 1;
      const value = finiteMoney(quote?.totals?.total);
      if (value === null) {
        row.wonValueUnknown += 1;
      } else {
        row.wonValue += value;
        row.wonValueKnown += 1;
      }
    }
  });

  return {
    ...totals,
    wins,
    decisionPool,
    closeRate,
    conversionRate,
    months
  };
}

function reportingSourceLabel(source) {
  if (source === "firebase") return "Firestore staff records";
  if (source === "local") return "this browser's local fallback records";
  return "not confirmed";
}

function formatLoadedAt(value) {
  const date = new Date(value || "");
  if (Number.isNaN(date.getTime())) return "not loaded yet";
  return date.toLocaleString(undefined, { dateStyle: "medium", timeStyle: "short" });
}

function reportingMoney(value, knownCount) {
  return knownCount > 0 ? currency(value) : "Not available";
}

function reportingRate(value) {
  return Number.isFinite(value) ? `${value.toFixed(1)}%` : "Not available";
}

export function getReportingCapabilityState(state = {}, metrics = {}) {
  const hasCompletedRead = Boolean(state.loadedAtISO);
  if (state.loading && !hasCompletedRead) return "loading";
  if (state.error && hasCompletedRead) return "stale";
  if (state.error) return "error";
  if (
    state.truncated
    || state.analytics?.error
    || Number(metrics.quotedValueUnknown || 0) > 0
    || Number(metrics.statusUnknown || 0) > 0
    || Number(metrics.paymentUnknown || 0) > 0
    || Number(metrics.paidDepositValueUnknown || 0) > 0
    || Number(metrics.paidDepositEvidenceMissing || 0) > 0
  ) {
    return "partial";
  }
  if (hasCompletedRead && Number(metrics.quotes || 0) === 0) return "empty";
  if (hasCompletedRead) return "success";
  return "loading";
}

export function ReportingEvidenceRail({ state, metrics, onRetry }) {
  const capabilityState = getReportingCapabilityState(state, metrics);
  const hasCompletedRead = Boolean(state?.loadedAtISO);
  const quoteCount = Number(metrics?.quotes || 0);
  const quoteLimit = Number(state?.limit || REPORTING_QUOTE_LIMIT);
  const incompleteMoney = Number(metrics?.quotedValueUnknown || 0)
    + Number(metrics?.paidDepositAmountUnknown || 0);
  const unverifiedPaidStates = Number(metrics?.paidDepositEvidenceMissing || 0);

  return (
    <section
      className={`reporting-evidence-rail reporting-evidence-${capabilityState}`}
      aria-labelledby="reporting-evidence-title"
      data-capability-state={capabilityState}
    >
      <div className="reporting-evidence-copy">
        <p className="eyebrow">Evidence and scope</p>
        <h3 id="reporting-evidence-title">
          {capabilityState === "loading" && "Loading the commercial snapshot"}
          {capabilityState === "empty" && "No quote records in this bounded view"}
          {capabilityState === "success" && "Commercial snapshot is current"}
          {capabilityState === "partial" && "Commercial snapshot has visible limits"}
          {capabilityState === "stale" && "Showing the last completed snapshot"}
          {capabilityState === "error" && "Commercial snapshot is unavailable"}
        </h3>
        <p>
          Same-tenant source: {reportingSourceLabel(state?.source)}. Last complete client read:{" "}
          {formatLoadedAt(state?.loadedAtISO)}.
        </p>
        <details className="staff-evidence-disclosure">
          <summary>How these numbers are read</summary>
          <p>
            {hasCompletedRead
              ? `${quoteCount} quote record${quoteCount === 1 ? "" : "s"} loaded${state?.truncated ? `; results stop at ${quoteLimit} and additional records may exist` : ` within the ${quoteLimit}-record read cap`}.`
              : `The read is capped at ${quoteLimit} quote records.`}
            {" "}All commercial measures and denominators below use only the displayed records.
          </p>
          <p>
            Six-month trends use UTC calendar months. Accepted/booked quote value remains
            distinct from the paid-deposit total, which requires a Firebase-backed provider
            confirmation timestamp. Neither measure is accounting revenue.
          </p>
        </details>
        {state?.loading && hasCompletedRead && (
          <p className="source-note" role="status">Refreshing while the completed snapshot remains visible.</p>
        )}
        {state?.truncated && (
          <p className="warning-note">This is a truncated snapshot; totals are not tenant-wide totals.</p>
        )}
        {incompleteMoney > 0 && (
          <p className="warning-note">
            {incompleteMoney} required money field{incompleteMoney === 1 ? " is" : "s are"} unavailable;
            those records are excluded from the affected money total, not treated as zero.
          </p>
        )}
        {unverifiedPaidStates > 0 && (
          <p className="warning-note">
            {unverifiedPaidStates} displayed paid state{unverifiedPaidStates === 1 ? " is" : "s are"}
            {" "}excluded from the verified deposit total because Firebase-backed provider
            confirmation evidence is unavailable.
          </p>
        )}
        {state?.analytics?.error && (
          <p className="warning-note">Wizard analytics are unavailable; quote-record measures remain visible.</p>
        )}
        {state?.error && (
          <p className={hasCompletedRead ? "warning-note" : "error-note"} role="alert">
            {hasCompletedRead
              ? "Refresh failed. The retained snapshot may be stale."
              : "The bounded reporting read failed before a snapshot was available."}
          </p>
        )}
      </div>
      <button
        type="button"
        className="ghost"
        onClick={onRetry}
        disabled={state?.loading}
        data-capability-state="recovery"
      >
        {state?.loading ? "Refreshing..." : state?.error ? "Retry read" : "Refresh snapshot"}
      </button>
    </section>
  );
}

export function ReportingDashboardView({
  open,
  onClose,
  presentation = "embedded",
  organizationId = "",
  addons = [],
  returnFocusRef = null
}) {
  const embedded = presentation === "embedded";
  const routeHeadingRef = useRef(null);
  const requestGenerationRef = useRef(0);
  const initialNowISORef = useRef(new Date().toISOString());
  const [state, setState] = useState({
    loading: Boolean(open),
    error: "",
    source: "",
    quotes: [],
    analytics: null,
    truncated: false,
    limit: REPORTING_QUOTE_LIMIT,
    loadedAtISO: ""
  });

  const load = useCallback(async () => {
    const generation = requestGenerationRef.current + 1;
    requestGenerationRef.current = generation;
    setState((prev) => ({ ...prev, loading: true, error: "" }));
    try {
      const [result, analytics] = await Promise.all([
        getQuoteHistory({ organizationId, limitCount: REPORTING_QUOTE_LIMIT }),
        getProductAnalyticsSummary({ organizationId, days: 30 }).catch((err) => ({
          source: "unavailable",
          days: 30,
          sessionsStarted: 0,
          quotesSaved: 0,
          completionRate: 0,
          funnel: [],
          addons: [],
          error: err?.message || "Analytics summary is unavailable."
        }))
      ]);
      if (requestGenerationRef.current !== generation) return;
      setState({
        loading: false,
        error: "",
        source: result.source,
        quotes: result.quotes,
        analytics,
        truncated: Boolean(result.truncated),
        limit: REPORTING_QUOTE_LIMIT,
        loadedAtISO: new Date().toISOString()
      });
    } catch (err) {
      if (requestGenerationRef.current !== generation) return;
      setState((prev) => ({
        ...prev,
        loading: false,
        error: err?.message || "Failed to load dashboard data."
      }));
    }
  }, [organizationId]);

  useEffect(() => {
    if (open) {
      load();
    }
    return () => {
      requestGenerationRef.current += 1;
    };
  }, [load, open]);

  const metrics = useMemo(() => buildReportingMetrics(state.quotes, {
    nowDate: new Date(state.loadedAtISO || initialNowISORef.current),
    source: state.source
  }), [state.loadedAtISO, state.quotes, state.source]);

  const addonNames = useMemo(() => new Map(
    (Array.isArray(addons) ? addons : []).map((item) => [
      String(item?.id || ""),
      String(item?.name || item?.id || "")
    ])
  ), [addons]);

  const { dialogRef } = useModalDialog({
    open: Boolean(open && !embedded),
    onRequestClose: onClose,
    returnFocusRef
  });

  useEffect(() => {
    if (!open || !embedded || typeof window === "undefined") return undefined;
    const frame = window.requestAnimationFrame(() => {
      routeHeadingRef.current?.focus({ preventScroll: true });
    });
    return () => window.cancelAnimationFrame(frame);
  }, [embedded, open]);

  if (!open) return null;

  return (
    <div
      className={embedded ? "container workspace-route-main embedded-workspace-route" : "modal-overlay"}
      role={embedded ? "region" : "dialog"}
      aria-modal={embedded ? undefined : "true"}
      aria-labelledby="reporting-dashboard-title"
    >
      <div
        className={`modal-card dashboard-card${embedded ? " workspace-route-card" : ""}`}
        ref={dialogRef}
        tabIndex={-1}
      >
        <div className="modal-head">
          <h2
            id="reporting-dashboard-title"
            ref={routeHeadingRef}
            tabIndex={embedded ? -1 : undefined}
          >
            Reporting Dashboard
          </h2>
          <div className="right-actions">
            <button
              type="button"
              className="ghost"
              onClick={onClose}
              data-modal-initial-focus={embedded ? undefined : true}
            >
              {embedded ? "Back to Home" : "Close"}
            </button>
          </div>
        </div>

        <ReportingEvidenceRail state={state} metrics={metrics} onRetry={load} />

        <div className="dashboard-grid" aria-label="Commercial measures from displayed quote records">
          <div className="metric-card">
            <span>Loaded Quotes</span>
            <strong>{state.loadedAtISO ? metrics.quotes : "Not available"}</strong>
            <small>Displayed-record denominator</small>
          </div>
          <div className="metric-card">
            <span>Total Quoted</span>
            <strong>{reportingMoney(metrics.quotedValue, metrics.quotedValueKnown)}</strong>
            <small>{metrics.quotedValueKnown} of {metrics.quotes} loaded totals recorded</small>
          </div>
          <div className="metric-card">
            <span>Open Quote Value</span>
            <strong>{reportingMoney(metrics.pipelineValue, metrics.pipelineValueKnown)}</strong>
            <small>{metrics.pipelineValueKnown} recorded draft/sent/viewed totals</small>
          </div>
          <div className="metric-card">
            <span>Accepted / Booked Quote Value</span>
            <strong>{reportingMoney(metrics.wonValue, metrics.wonValueKnown)}</strong>
            <small>{metrics.wonValueKnown} of {metrics.wins} accepted/booked totals recorded</small>
          </div>
          <div className="metric-card">
            <span>Verified Paid-Deposit Total</span>
            <strong>{reportingMoney(metrics.paidDepositValue, metrics.paidDepositValueKnown)}</strong>
            <small>{metrics.paidDepositValueKnown} of {metrics.paymentPaid} displayed paid states have provider confirmation and a recorded amount</small>
          </div>
          <div className="metric-card">
            <span>Decision Close Rate</span>
            <strong>{reportingRate(metrics.closeRate)}</strong>
            <small>{metrics.wins} accepted/booked of {metrics.decisionPool} decided records</small>
          </div>
          <div className="metric-card">
            <span>Loaded-Record Conversion</span>
            <strong>{reportingRate(metrics.conversionRate)}</strong>
            <small>{metrics.wins} accepted/booked of {metrics.quotes} loaded records</small>
          </div>
        </div>
        <p className="source-note">Commercial quote states only; the paid-deposit total additionally requires Firebase-backed provider confirmation. These figures are not accounting revenue.</p>

        <div className="status-strip">
          <span>Draft: {metrics.draft}</span>
          <span>Sent: {metrics.sent}</span>
          <span>Viewed: {metrics.viewed}</span>
          <span>Accepted: {metrics.accepted}</span>
          <span>Booked: {metrics.booked}</span>
          <span>Declined: {metrics.declined}</span>
          <span>Expired: {metrics.expired}</span>
          <span>Payment Unpaid: {metrics.paymentUnpaid}</span>
          <span>Payment Sent: {metrics.paymentSent}</span>
          <span>Recorded Payment Paid: {metrics.paymentPaid}</span>
          <span>Provider-Confirmed Paid: {metrics.paymentPaidVerified}</span>
          <span>Recorded Payment Refunded: {metrics.paymentRefunded}</span>
          {metrics.statusUnknown > 0 && <span>Lifecycle unavailable: {metrics.statusUnknown}</span>}
          {metrics.paymentUnknown > 0 && <span>Deposit state unavailable: {metrics.paymentUnknown}</span>}
        </div>

        <section className="dashboard-section" aria-labelledby="wizard-funnel-heading">
          <div className="dashboard-section-head">
            <div>
              <h3 id="wizard-funnel-heading">Quote wizard funnel</h3>
              <p className="source-note">Last {state.analytics?.days || 30} days · anonymous staff sessions · no customer details</p>
            </div>
            <strong>
              {state.analytics?.error
                ? "Not available"
                : `${Number(state.analytics?.completionRate || 0).toFixed(1)}% saved`}
            </strong>
          </div>
          <div className="status-strip">
            {(state.analytics?.funnel || []).map((row) => (
              <span key={row.step}>Reached step {row.step}: {row.sessions}</span>
            ))}
            {!state.analytics?.error && <span>Drafts saved: {state.analytics?.quotesSaved || 0}</span>}
          </div>
          {!state.loading && !state.analytics?.error && !(state.analytics?.sessionsStarted > 0) && (
            <p className="source-note">No wizard sessions recorded yet. New activity will appear here.</p>
          )}
        </section>

        <section className="dashboard-section" aria-labelledby="addon-trends-heading">
          <div className="dashboard-section-head">
            <div>
              <h3 id="addon-trends-heading">Add-on selection trends</h3>
              <p className="source-note">Selections reveal popular offers and choices that are often removed.</p>
            </div>
          </div>
          <div className="history-table-wrap">
            <table>
              <thead><tr><th>Add-on</th><th>Selected</th><th>Removed</th></tr></thead>
              <tbody>
                {(state.analytics?.addons || []).map((row) => (
                  <tr key={row.addonId}>
                    <td>{addonNames.get(row.addonId) || row.addonId}</td>
                    <td>{row.selected}</td>
                    <td>{row.removed}</td>
                  </tr>
                ))}
                {!state.loading && !(state.analytics?.addons || []).length && (
                  <tr><td colSpan="3">No add-on activity recorded yet.</td></tr>
                )}
              </tbody>
            </table>
          </div>
        </section>

        <div className="history-table-wrap">
          <table>
            <thead>
              <tr>
                <th>Month</th>
                <th>Quotes</th>
                <th>Sent/Viewed/Accepted/Booked</th>
                <th>Accepted/Booked</th>
                <th>Accepted / Booked Quote Value</th>
              </tr>
            </thead>
            <tbody>
              {metrics.months.map((row) => (
                <tr key={row.monthKey}>
                  <td>{row.label}</td>
                  <td>{row.quotes}</td>
                  <td>{row.sent}</td>
                  <td>{row.won}</td>
                  <td>
                    {reportingMoney(row.wonValue, row.wonValueKnown)}
                    {row.wonValueUnknown > 0 ? ` (${row.wonValueUnknown} unavailable)` : ""}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>
    </div>
  );
}

export default function ReportingDashboardModal(props) {
  return <ReportingDashboardView {...props} presentation="modal" />;
}
