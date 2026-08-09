import { useEffect, useMemo, useRef, useState } from "react";
import { useModalDialog } from "../hooks/useModalDialog";
import { currency } from "../lib/quoteCalculator";
import { getQuoteHistory } from "../lib/quoteStore";
import { getProductAnalyticsSummary } from "../lib/productAnalytics";

function monthKeyFromISO(iso) {
  const dt = new Date(iso || "");
  if (Number.isNaN(dt.getTime())) return "";
  return `${dt.getFullYear()}-${String(dt.getMonth() + 1).padStart(2, "0")}`;
}

function monthLabel(monthKey) {
  const [year, month] = String(monthKey).split("-");
  const dt = new Date(Number(year), Number(month) - 1, 1);
  return dt.toLocaleDateString(undefined, { month: "short", year: "numeric" });
}

function recentMonthKeys(count, nowDate = new Date()) {
  const out = [];
  const now = new Date(nowDate);
  for (let i = count - 1; i >= 0; i -= 1) {
    const dt = new Date(now.getFullYear(), now.getMonth() - i, 1);
    out.push(`${dt.getFullYear()}-${String(dt.getMonth() + 1).padStart(2, "0")}`);
  }
  return out;
}

export function buildReportingMetrics(quotes = [], { nowDate = new Date() } = {}) {
  const sourceQuotes = Array.isArray(quotes) ? quotes : [];
  const totals = {
    quotes: sourceQuotes.length,
    draft: 0,
    sent: 0,
    viewed: 0,
    accepted: 0,
    booked: 0,
    declined: 0,
    expired: 0,
    paymentUnpaid: 0,
    paymentSent: 0,
    paymentPaid: 0,
    paymentRefunded: 0,
    quotedValue: 0,
    pipelineValue: 0,
    wonValue: 0,
    paidDepositValue: 0
  };

  sourceQuotes.forEach((quote) => {
    const status = quote.status || "draft";
    const value = Number(quote.totals?.total || 0);
    const depositValue = Number(quote.totals?.deposit || 0);
    const paymentStatus = quote.payment?.depositStatus || "unpaid";
    totals.quotedValue += value;
    if (Object.prototype.hasOwnProperty.call(totals, status)) {
      totals[status] += 1;
    }
    if (paymentStatus === "paid") {
      totals.paymentPaid += 1;
      totals.paidDepositValue += depositValue;
    } else if (paymentStatus === "sent") {
      totals.paymentSent += 1;
    } else if (paymentStatus === "refunded") {
      totals.paymentRefunded += 1;
    } else {
      totals.paymentUnpaid += 1;
    }
    if (["draft", "sent", "viewed"].includes(status)) {
      totals.pipelineValue += value;
    }
    if (status === "accepted" || status === "booked") {
      totals.wonValue += value;
    }
  });

  const wins = totals.accepted + totals.booked;
  const decisionPool = wins + totals.declined + totals.expired;
  const closeRate = decisionPool > 0 ? (wins / decisionPool) * 100 : 0;
  const conversionRate = totals.quotes > 0 ? (wins / totals.quotes) * 100 : 0;

  const monthKeys = recentMonthKeys(6, nowDate);
  const months = monthKeys.map((monthKey) => ({
    monthKey,
    label: monthLabel(monthKey),
    quotes: 0,
    sent: 0,
    won: 0,
    wonValue: 0
  }));

  sourceQuotes.forEach((quote) => {
    const key = monthKeyFromISO(quote.createdAtISO);
    const row = months.find((item) => item.monthKey === key);
    if (!row) return;
    row.quotes += 1;
    if (["sent", "viewed", "accepted", "booked"].includes(quote.status)) {
      row.sent += 1;
    }
    if (quote.status === "accepted" || quote.status === "booked") {
      row.won += 1;
      row.wonValue += Number(quote.totals?.total || 0);
    }
  });

  return {
    ...totals,
    closeRate,
    conversionRate,
    months
  };
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
  const [state, setState] = useState({
    loading: false,
    error: "",
    source: "",
    quotes: [],
    analytics: null
  });

  const load = async () => {
    setState((prev) => ({ ...prev, loading: true, error: "" }));
    try {
      const [result, analytics] = await Promise.all([
        getQuoteHistory({ organizationId }),
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
      setState({
        loading: false,
        error: "",
        source: result.source,
        quotes: result.quotes,
        analytics
      });
    } catch (err) {
      setState((prev) => ({
        ...prev,
        loading: false,
        error: err?.message || "Failed to load dashboard data."
      }));
    }
  };

  useEffect(() => {
    if (open) {
      load();
    }
  }, [open, organizationId]);

  const metrics = useMemo(() => buildReportingMetrics(state.quotes), [state.quotes]);

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
            <button type="button" className="ghost" onClick={load} disabled={state.loading}>
              {state.loading ? "Refreshing..." : "Refresh"}
            </button>
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

        <p className="source-note">Source: {state.source || "-"}</p>
        {state.error && <p className="error-note">{state.error}</p>}
        {state.analytics?.error && <p className="warning-note">Quote analytics: {state.analytics.error}</p>}

        <div className="dashboard-grid">
          <div className="metric-card"><span>Total Quotes</span><strong>{metrics.quotes}</strong></div>
          <div className="metric-card"><span>Total Quoted</span><strong>{currency(metrics.quotedValue)}</strong></div>
          <div className="metric-card"><span>Pipeline Value</span><strong>{currency(metrics.pipelineValue)}</strong></div>
          <div className="metric-card"><span>Accepted / Booked Quote Value</span><strong>{currency(metrics.wonValue)}</strong></div>
          <div className="metric-card"><span>Verified Paid-Deposit Total</span><strong>{currency(metrics.paidDepositValue)}</strong></div>
          <div className="metric-card"><span>Close Rate</span><strong>{metrics.closeRate.toFixed(1)}%</strong></div>
          <div className="metric-card"><span>Conversion Rate</span><strong>{metrics.conversionRate.toFixed(1)}%</strong></div>
        </div>
        <p className="source-note">Commercial quote and provider-confirmed deposit states only; these figures are not accounting revenue.</p>

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
          <span>Payment Paid: {metrics.paymentPaid}</span>
          <span>Payment Refunded: {metrics.paymentRefunded}</span>
        </div>

        <section className="dashboard-section" aria-labelledby="wizard-funnel-heading">
          <div className="dashboard-section-head">
            <div>
              <h3 id="wizard-funnel-heading">Quote wizard funnel</h3>
              <p className="source-note">Last {state.analytics?.days || 30} days · anonymous staff sessions · no customer details</p>
            </div>
            <strong>{Number(state.analytics?.completionRate || 0).toFixed(1)}% saved</strong>
          </div>
          <div className="status-strip">
            {(state.analytics?.funnel || []).map((row) => (
              <span key={row.step}>Reached step {row.step}: {row.sessions}</span>
            ))}
            <span>Drafts saved: {state.analytics?.quotesSaved || 0}</span>
          </div>
          {!state.loading && !(state.analytics?.sessionsStarted > 0) && (
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
                  <td>{currency(row.wonValue)}</td>
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
