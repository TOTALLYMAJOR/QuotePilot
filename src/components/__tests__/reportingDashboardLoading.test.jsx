// @vitest-environment jsdom
import React, { act } from "react";
import { createRoot } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, test, vi } from "vitest";

const reads = vi.hoisted(() => ({ quotes: vi.fn(), analytics: vi.fn() }));
vi.mock("../../lib/quoteStore", () => ({ getQuoteHistory: reads.quotes, getQuoteById: vi.fn() }));
vi.mock("../../lib/productAnalyticsAmbient", () => ({ getProductAnalyticsSummary: reads.analytics }));
vi.mock("quotepilot-active-product-analytics", () => ({ getProductAnalyticsSummary: reads.analytics }));
import { ReportingDashboardView as ActiveReporting } from "../ReportingDashboardModal";
import { ReportingDashboardView as LegacyReporting } from "../LegacyReportingDashboardModal";

globalThis.IS_REACT_ACT_ENVIRONMENT = true;
function deferred() {
  let resolve, reject;
  const promise = new Promise((yes, no) => { resolve = yes; reject = no; });
  return { promise, resolve, reject };
}
const analytics = { source: "firebase", days: 30, sessionsStarted: 1, quotesSaved: 2, completionRate: 50, funnel: [], addons: [] };
const quotes = { source: "firebase", quotes: [{ id: "quote-a", status: "draft", totals: { total: 12345 }, payment: { depositStatus: "unpaid" } }], truncated: false };

describe.each([["active", ActiveReporting], ["legacy", LegacyReporting]])("%s independent reporting", (_name, Reporting) => {
  let root, container;
  const render = (organizationId = "org-a") => act(async () => root.render(<Reporting open organizationId={organizationId} onClose={() => {}} />));
  beforeEach(() => {
    vi.clearAllMocks();
    reads.quotes.mockResolvedValue(quotes);
    reads.analytics.mockResolvedValue(analytics);
    container = document.createElement("div");
    document.body.append(container);
    root = createRoot(container);
  });
  afterEach(() => { act(() => root.unmount()); container.remove(); });

  test("publishes quote measures while analytics remain pending without inventing empty analytics", async () => {
    const pending = deferred();
    reads.analytics.mockReturnValueOnce(pending.promise);
    await render();
    expect(container.textContent).toContain("$12345.00");
    expect(container.textContent).toContain("Loading wizard analytics");
    expect(container.textContent).not.toContain("No wizard sessions recorded yet");
    expect(container.textContent).not.toContain("No add-on activity recorded yet");
    await act(async () => pending.resolve(analytics));
    expect(container.textContent).toContain("50.0% saved");
  });

  test("retries failed analytics independently while the quote read remains pending", async () => {
    const pending = deferred();
    reads.quotes.mockReturnValueOnce(pending.promise);
    reads.analytics.mockRejectedValueOnce(new Error("Private backend detail"));
    await render();
    expect(container.textContent).not.toContain("Private backend detail");
    expect(container.textContent).not.toContain("No wizard sessions recorded yet");
    const retry = [...container.querySelectorAll("button")].find((button) => button.textContent === "Retry analytics");
    expect(retry).toBeDefined();
    await act(async () => retry.click());
    expect(container.textContent).toContain("50.0% saved");
    expect(reads.quotes).toHaveBeenCalledTimes(1);
    expect(container.textContent).not.toContain("Draft: 0");
    await act(async () => pending.resolve(quotes));
    expect(container.textContent).toContain("$12345.00");
  });

  test("masks previous organization data and ignores old delayed analytics", async () => {
    const oldAnalytics = deferred(), newQuotes = deferred(), newAnalytics = deferred();
    reads.analytics.mockReturnValueOnce(oldAnalytics.promise);
    await render();
    reads.quotes.mockReturnValueOnce(newQuotes.promise);
    reads.analytics.mockReturnValueOnce(newAnalytics.promise);
    await render("org-b");
    expect(container.textContent).not.toContain("$12345.00");
    await act(async () => oldAnalytics.resolve({ ...analytics, quotesSaved: 987 }));
    expect(container.textContent).not.toContain("987");
    expect(container.textContent).toContain("Loading wizard analytics");
    await act(async () => { newQuotes.resolve({ ...quotes, quotes: [] }); newAnalytics.resolve(analytics); });
    expect(container.textContent).not.toContain("$12345.00");
    expect(container.textContent).toContain("Drafts saved: 2");
  });

  test("retains failed quote refresh evidence and retries it without restarting pending analytics", async () => {
    await render();
    const pendingAnalytics = deferred();
    reads.quotes.mockRejectedValueOnce(new Error("Quote refresh unavailable"));
    reads.analytics.mockReturnValueOnce(pendingAnalytics.promise);
    const refresh = [...container.querySelectorAll("button")].find((button) => button.textContent === "Refresh snapshot");
    await act(async () => refresh.click());
    expect(container.textContent).toContain("$12345.00");
    expect(container.textContent).toContain("retained snapshot may be stale");
    const retry = [...container.querySelectorAll("button")].find((button) => button.textContent === "Retry read");
    await act(async () => retry.click());
    expect(reads.analytics).toHaveBeenCalledTimes(2);
    expect(container.textContent).toContain("Loading wizard analytics");
    expect(container.textContent).not.toContain("retained snapshot may be stale");
    await act(async () => pendingAnalytics.resolve(analytics));
    expect(container.textContent).toContain("50.0% saved");
  });
});
