import React, { isValidElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, test, vi } from "vitest";
import {
  REPORTING_QUOTE_LIMIT,
  ReportingEvidenceRail,
  buildReportingMetrics,
  getReportingCapabilityState
} from "../ReportingDashboardModal";

function baseState(overrides = {}) {
  return {
    loading: false,
    error: "",
    source: "firebase",
    quotes: [],
    analytics: { error: "" },
    truncated: false,
    limit: REPORTING_QUOTE_LIMIT,
    loadedAtISO: "2026-08-09T15:00:00.000Z",
    ...overrides
  };
}

function findElement(node, predicate) {
  if (isValidElement(node) && predicate(node)) return node;
  if (!isValidElement(node)) return null;
  const children = Array.isArray(node.props.children) ? node.props.children : [node.props.children];
  for (const child of children) {
    const match = findElement(child, predicate);
    if (match) return match;
  }
  return null;
}

describe("reporting evidence and scope", () => {
  test("renders the bounded loading state without manufactured totals", () => {
    const state = baseState({
      loading: true,
      source: "",
      analytics: null,
      loadedAtISO: ""
    });
    const metrics = buildReportingMetrics([], { nowDate: new Date("2026-08-09T15:00:00.000Z") });
    const markup = renderToStaticMarkup(
      <ReportingEvidenceRail state={state} metrics={metrics} onRetry={() => {}} />
    );

    expect(markup).toContain('data-capability-state="loading"');
    expect(markup).toContain(`capped at ${REPORTING_QUOTE_LIMIT} quote records`);
    expect(markup).toContain("not loaded yet");
  });

  test("distinguishes completed empty and successful bounded snapshots", () => {
    const emptyMetrics = buildReportingMetrics([]);
    const successMetrics = buildReportingMetrics([{
      status: "draft",
      totals: { total: 0 },
      payment: { depositStatus: "unpaid" }
    }]);

    expect(getReportingCapabilityState(baseState(), emptyMetrics)).toBe("empty");
    expect(getReportingCapabilityState(baseState(), successMetrics)).toBe("success");
    expect(renderToStaticMarkup(
      <ReportingEvidenceRail state={baseState()} metrics={emptyMetrics} onRetry={() => {}} />
    )).toContain('data-capability-state="empty"');
    expect(renderToStaticMarkup(
      <ReportingEvidenceRail state={baseState()} metrics={successMetrics} onRetry={() => {}} />
    )).toContain('data-capability-state="success"');
  });

  test("renders truncated and incomplete records as a partial snapshot", () => {
    const state = baseState({ truncated: true });
    const metrics = buildReportingMetrics([{
      status: "accepted",
      totals: {},
      payment: { depositStatus: "paid" }
    }]);
    const markup = renderToStaticMarkup(
      <ReportingEvidenceRail state={state} metrics={metrics} onRetry={() => {}} />
    );

    expect(markup).toContain('data-capability-state="partial"');
    expect(markup).toContain("additional records may exist");
    expect(markup).toContain("excluded from the affected money total, not treated as zero");
    expect(markup).toContain("not tenant-wide totals");
  });

  test("retains a stale snapshot after refresh failure and exposes recovery", () => {
    const retry = vi.fn();
    const state = baseState({ error: "network detail that must not be rendered" });
    const metrics = buildReportingMetrics([{
      status: "booked",
      totals: { total: 1200, deposit: 300 },
      payment: { depositStatus: "paid" }
    }]);
    const tree = ReportingEvidenceRail({ state, metrics, onRetry: retry });
    const markup = renderToStaticMarkup(tree);
    const retryButton = findElement(tree, (element) => (
      element.type === "button" && element.props["data-capability-state"] === "recovery"
    ));

    expect(markup).toContain('data-capability-state="stale"');
    expect(markup).toContain("retained snapshot may be stale");
    expect(markup).not.toContain("network detail");
    expect(markup).toContain('data-capability-state="recovery"');
    retryButton.props.onClick();
    expect(retry).toHaveBeenCalledOnce();
  });

  test("renders an initial error without claiming an empty read", () => {
    const state = baseState({
      error: "private backend detail",
      source: "",
      loadedAtISO: ""
    });
    const metrics = buildReportingMetrics([]);
    const markup = renderToStaticMarkup(
      <ReportingEvidenceRail state={state} metrics={metrics} onRetry={() => {}} />
    );

    expect(markup).toContain('data-capability-state="error"');
    expect(markup).toContain("failed before a snapshot was available");
    expect(markup).not.toContain("private backend detail");
    expect(markup).not.toContain("No quote records in this bounded view");
  });
});

describe("reporting metric evidence", () => {
  test("excludes missing money from totals instead of coercing it to zero", () => {
    const metrics = buildReportingMetrics([
      {
        status: "accepted",
        totals: { total: 4000, deposit: 1000 },
        payment: { depositStatus: "paid" }
      },
      {
        status: "booked",
        totals: {},
        payment: { depositStatus: "paid" }
      },
      {
        status: "migrated-unknown",
        totals: { total: "" },
        payment: {}
      }
    ]);

    expect(metrics).toMatchObject({
      quotedValue: 4000,
      quotedValueKnown: 1,
      quotedValueUnknown: 2,
      wonValue: 4000,
      wonValueKnown: 1,
      wonValueUnknown: 1,
      paidDepositValue: 1000,
      paidDepositValueKnown: 1,
      paidDepositValueUnknown: 1,
      statusUnknown: 1,
      paymentUnknown: 1,
      wins: 2,
      decisionPool: 2
    });
  });

  test("uses explicit denominators and unavailable rates for empty sets", () => {
    const empty = buildReportingMetrics([]);
    const decided = buildReportingMetrics([
      { status: "accepted", totals: { total: 0 }, payment: { depositStatus: "unpaid" } },
      { status: "declined", totals: { total: 0 }, payment: { depositStatus: "unpaid" } }
    ]);

    expect(empty.closeRate).toBeNull();
    expect(empty.conversionRate).toBeNull();
    expect(decided.closeRate).toBe(50);
    expect(decided.conversionRate).toBe(50);
    expect(decided.decisionPool).toBe(2);
  });

  test("assigns month trends on UTC boundaries deterministically", () => {
    const metrics = buildReportingMetrics([{
      status: "booked",
      createdAtISO: "2026-08-01T00:15:00.000Z",
      totals: { total: 500 },
      payment: { depositStatus: "unpaid" }
    }], { nowDate: new Date("2026-08-31T23:59:00.000Z") });
    const august = metrics.months.find((month) => month.monthKey === "2026-08");

    expect(august).toMatchObject({ quotes: 1, won: 1, wonValue: 500, wonValueKnown: 1 });
  });
});
