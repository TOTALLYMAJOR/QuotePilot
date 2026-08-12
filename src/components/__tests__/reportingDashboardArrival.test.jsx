// @vitest-environment jsdom
import React from "react";
import { createRoot } from "react-dom/client";
import { act } from "react-dom/test-utils";
import { afterEach, beforeEach, describe, expect, test, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  getQuoteById: vi.fn(),
  getQuoteHistory: vi.fn(),
  getProductAnalyticsSummary: vi.fn()
}));

vi.mock("../../lib/quoteStore", () => ({
  getQuoteById: mocks.getQuoteById,
  getQuoteHistory: mocks.getQuoteHistory
}));

vi.mock("../../lib/productAnalytics", () => ({
  getProductAnalyticsSummary: mocks.getProductAnalyticsSummary
}));

import {
  ReportingDashboardView,
  buildReportingArrivalResolution
} from "../ReportingDashboardModal";

globalThis.IS_REACT_ACT_ENVIRONMENT = true;

const ORGANIZATION_ID = "org-reporting";
const QUOTE_ID = "quote-reporting";
const AMBIENT_UI_ENABLED = import.meta.env.VITE_AMBIENT_UI_ENABLED === "1"
  || import.meta.env.VITE_AMBIENT_UI_ENABLED === "true"
  || import.meta.env.VITE_AMBIENT_UI_ENABLED === "yes"
  || import.meta.env.VITE_AMBIENT_UI_ENABLED === "on";
const OPPORTUNITY_CONTEXT = Object.freeze({
  destination: "reporting",
  surfaceId: "reporting",
  focusConsumerState: "supported",
  intentId: "review_opportunity_report",
  object: { id: QUOTE_ID, type: "opportunity", label: "Opportunity" },
  focus: {
    reportScope: "opportunity",
    quoteId: QUOTE_ID,
    reportSignal: "opportunity-summary"
  }
});

function reportingState(overrides = {}) {
  return {
    loading: false,
    error: "",
    source: "firebase",
    quotes: [],
    analytics: { source: "firebase", error: "" },
    truncated: false,
    loadedAtISO: "2026-08-12T12:00:00.000Z",
    ...overrides
  };
}

async function settle() {
  await act(async () => {
    await new Promise((resolve) => setTimeout(resolve, 10));
  });
}

describe("Reporting exact-arrival resolution", () => {
  test("requires the exact same-organization opportunity without changing aggregate evidence", () => {
    const quote = {
      id: QUOTE_ID,
      organizationId: ORGANIZATION_ID,
      status: "draft",
      totals: { total: 1200 }
    };
    const resolved = buildReportingArrivalResolution({
      context: OPPORTUNITY_CONTEXT,
      organizationId: ORGANIZATION_ID,
      targetState: {
        requestedQuoteId: QUOTE_ID,
        loading: false,
        completed: true,
        error: false,
        quote
      },
      reportingState: reportingState({
        quotes: [{ id: "aggregate-quote" }]
      })
    });
    const mismatch = buildReportingArrivalResolution({
      context: OPPORTUNITY_CONTEXT,
      organizationId: ORGANIZATION_ID,
      targetState: {
        requestedQuoteId: QUOTE_ID,
        loading: false,
        completed: true,
        error: false,
        quote: { ...quote, organizationId: "org-other" }
      },
      reportingState: reportingState()
    });

    expect(resolved).toMatchObject({
      status: "resolved",
      quote,
      reportScope: "opportunity",
      reportSignal: "opportunity-summary"
    });
    expect(resolved).not.toHaveProperty("quotes");
    expect(mismatch).toMatchObject({
      status: "recovery",
      code: "opportunity_identity_mismatch"
    });
    expect(mismatch.consequence).toMatch(/No nearby quote, aggregate, or reporting signal was substituted/i);
  });

  test("fails closed for truncated, stale, or unavailable exact report evidence", () => {
    const pipelineContext = {
      destination: "reporting",
      surfaceId: "reporting",
      focusConsumerState: "supported",
      intentId: "review_pipeline_report",
      object: { id: "pipeline-summary", type: "report-signal" },
      focus: { reportScope: "pipeline", reportSignal: "pipeline-summary", quoteId: "" }
    };
    const operationsContext = {
      destination: "reporting",
      surfaceId: "reporting",
      focusConsumerState: "supported",
      intentId: "review_operational_report",
      object: { id: "ambient-interaction-health", type: "report-signal" },
      focus: {
        reportScope: "operations",
        reportSignal: "ambient-interaction-health",
        quoteId: ""
      }
    };

    expect(buildReportingArrivalResolution({
      context: pipelineContext,
      reportingState: reportingState({ truncated: true })
    })).toMatchObject({ status: "recovery", code: "pipeline_snapshot_truncated" });
    expect(buildReportingArrivalResolution({
      context: pipelineContext,
      reportingState: reportingState({ error: "refresh failed" })
    })).toMatchObject({ status: "recovery", code: "report_snapshot_stale" });
    expect(buildReportingArrivalResolution({
      context: operationsContext,
      reportingState: reportingState({ analytics: { source: "unavailable", error: "" } })
    })).toMatchObject({ status: "recovery", code: "interaction_health_unavailable" });
    expect(buildReportingArrivalResolution({
      context: {
        ...operationsContext,
        focus: { ...operationsContext.focus, reportSignal: "arbitrary-signal" }
      },
      reportingState: reportingState()
    })).toMatchObject({ status: "recovery", code: "unsupported_report_target" });
    expect(buildReportingArrivalResolution({
      context: {
        ...pipelineContext,
        object: { id: "different-signal", type: "report-signal" }
      },
      reportingState: reportingState()
    })).toMatchObject({ status: "recovery", code: "report_object_mismatch" });
    expect(buildReportingArrivalResolution({
      context: { ...pipelineContext, focusConsumerState: "pending" },
      reportingState: reportingState()
    })).toMatchObject({ status: "recovery", code: "unsupported_report_consumer" });
  });
});

describe("ReportingDashboardView exact arrival", () => {
  let container;
  let root;

  beforeEach(() => {
    container = document.createElement("div");
    document.body.append(container);
    root = createRoot(container);
    mocks.getQuoteHistory.mockReset().mockResolvedValue({
      source: "firebase",
      truncated: false,
      quotes: [{
        id: "aggregate-quote",
        organizationId: ORGANIZATION_ID,
        status: "draft",
        totals: { total: 500 },
        payment: { depositStatus: "unpaid" }
      }]
    });
    mocks.getQuoteById.mockReset().mockResolvedValue({
      id: QUOTE_ID,
      organizationId: ORGANIZATION_ID,
      quoteNumber: "QP-1042",
      status: "sent",
      event: { name: "River Garden Dinner" },
      totals: { total: 2400, deposit: 600 }
    });
    mocks.getProductAnalyticsSummary.mockReset().mockResolvedValue({
      source: "firebase",
      days: 30,
      sessionsStarted: 0,
      quotesSaved: 0,
      completionRate: 0,
      funnel: [],
      addons: [],
      error: ""
    });
    vi.stubGlobal("requestAnimationFrame", (callback) => setTimeout(callback, 0));
    vi.stubGlobal("cancelAnimationFrame", (frame) => clearTimeout(frame));
    Object.defineProperty(HTMLElement.prototype, "scrollIntoView", {
      configurable: true,
      value: vi.fn()
    });
  });

  afterEach(async () => {
    await act(async () => root.unmount());
    container.remove();
    vi.unstubAllGlobals();
  });

  test("uses a targeted quote read, focuses its exact summary, and leaves the aggregate denominator unchanged", async () => {
    const onArrivalResolution = vi.fn();
    await act(async () => {
      root.render(
        <ReportingDashboardView
          open
          onClose={() => {}}
          organizationId={ORGANIZATION_ID}
          arrivalContext={OPPORTUNITY_CONTEXT}
          onArrivalResolution={onArrivalResolution}
        />
      );
    });
    await settle();
    await settle();

    const target = container.querySelector("#reporting-opportunity-summary");
    expect(mocks.getQuoteById).toHaveBeenCalledWith(QUOTE_ID);
    expect(mocks.getQuoteHistory).toHaveBeenCalledWith({
      organizationId: ORGANIZATION_ID,
      limitCount: 500
    });
    expect(target.getAttribute("data-arrival-focus")).toBe("resolved");
    expect(target.getAttribute("data-report-quote-id")).toBe(QUOTE_ID);
    expect(document.activeElement).toBe(target);
    expect(target.textContent).toContain("River Garden Dinner");
    expect(target.textContent).toContain("not added to the aggregate displayed-record denominator");

    const loadedQuotes = Array.from(container.querySelectorAll(".metric-card"))
      .find((card) => card.textContent.includes("Loaded Quotes"));
    expect(loadedQuotes.textContent).toContain("1");
    expect(onArrivalResolution).toHaveBeenCalledWith(expect.objectContaining({
      status: "resolved",
      itemId: "opportunity-summary",
      focus: expect.objectContaining({
        reportScope: "opportunity",
        quoteId: QUOTE_ID,
        reportSignal: "opportunity-summary"
      })
    }));
  });

  test.each([
    [
      "pipeline",
      { reportScope: "pipeline", quoteId: "" },
      "#reporting-pipeline-summary",
      "pipeline-summary"
    ],
    ...(AMBIENT_UI_ENABLED
      ? [[
          "operations",
          {
            reportScope: "operations",
            quoteId: "",
            reportSignal: "ambient-interaction-health"
          },
          "#reporting-ambient-interaction-health",
          "ambient-interaction-health"
        ]]
      : [])
  ])("focuses the exact %s report signal without a targeted quote read", async (
    _scope,
    focus,
    selector,
    expectedSignal
  ) => {
    const onArrivalResolution = vi.fn();
    await act(async () => {
      root.render(
        <ReportingDashboardView
          open
          onClose={() => {}}
          organizationId={ORGANIZATION_ID}
          arrivalContext={{
            destination: "reporting",
            surfaceId: "reporting",
            focusConsumerState: "supported",
            intentId: focus.reportScope === "pipeline"
              ? "review_pipeline_report"
              : "review_operational_report",
            object: { id: expectedSignal, type: "report-signal", label: "Reporting signal" },
            focus
          }}
          onArrivalResolution={onArrivalResolution}
        />
      );
    });
    await settle();
    await settle();

    const target = container.querySelector(selector);
    expect(mocks.getQuoteById).not.toHaveBeenCalled();
    expect(target.getAttribute("data-arrival-focus")).toBe("resolved");
    expect(target.getAttribute("data-report-signal")).toBe(expectedSignal);
    expect(document.activeElement).toBe(target);
    expect(onArrivalResolution).toHaveBeenCalledWith(expect.objectContaining({
      status: "resolved",
      itemId: expectedSignal,
      focus: expect.objectContaining({ reportSignal: expectedSignal })
    }));
  });

  test("recovers on an organization mismatch without focusing or substituting the aggregate quote", async () => {
    mocks.getQuoteById.mockResolvedValueOnce({
      id: QUOTE_ID,
      organizationId: "org-other",
      event: { name: "Wrong tenant" }
    });
    const onArrivalResolution = vi.fn();
    await act(async () => {
      root.render(
        <ReportingDashboardView
          open
          onClose={() => {}}
          organizationId={ORGANIZATION_ID}
          arrivalContext={OPPORTUNITY_CONTEXT}
          onArrivalResolution={onArrivalResolution}
        />
      );
    });
    await settle();

    expect(container.querySelector("#reporting-opportunity-summary")).toBeNull();
    expect(container.querySelector('[data-arrival-focus="resolved"]')).toBeNull();
    expect(onArrivalResolution).toHaveBeenCalledWith(expect.objectContaining({
      status: "recovery",
      code: "opportunity_identity_mismatch"
    }));
  });
});
