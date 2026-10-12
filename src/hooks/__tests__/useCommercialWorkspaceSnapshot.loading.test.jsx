// @vitest-environment jsdom
import React, { act } from "react";
import { createRoot } from "react-dom/client";
import { afterEach, beforeEach, expect, test, vi } from "vitest";

const reads = vi.hoisted(() => ({ attention: vi.fn(), history: vi.fn(), replies: vi.fn(), debt: vi.fn() }));
vi.mock("../../lib/quoteStore", () => ({ getWorkflowAttentionSnapshot: reads.attention, getQuoteHistory: reads.history }));
vi.mock("../../lib/revenueAutopilotClient", () => ({ getRevenueAutopilotOperations: reads.replies }));
vi.mock("../../lib/decisionDebtClient", () => ({ getDecisionDebtSnapshot: reads.debt }));
import { useCommercialWorkspaceSnapshot } from "../useCommercialWorkspaceSnapshot";

globalThis.IS_REACT_ACT_ENVIRONMENT = true;
function deferred() {
  let resolve, reject;
  const promise = new Promise((yes, no) => { resolve = yes; reject = no; });
  return { promise, resolve, reject };
}
let root, container, latest;
function Harness(props) {
  latest = useCommercialWorkspaceSnapshot(props);
  return <div>{latest.quotes.map((quote) => quote.id).join(",")}</div>;
}
beforeEach(() => {
  vi.clearAllMocks();
  container = document.createElement("div");
  document.body.append(container);
  root = createRoot(container);
  reads.attention.mockResolvedValue({ source: "firebase", quotes: [] });
  reads.history.mockResolvedValue({ source: "firebase", quotes: [], truncated: false });
  reads.replies.mockResolvedValue({ source: "firebase_server_projection", attention: [], bounds: { known: true } });
  reads.debt.mockResolvedValue({ snapshot: { items: [], bounds: { truncated: false } } });
});
afterEach(() => { act(() => root.unmount()); container.remove(); });

test("publishes history before unresolved attention and isolates the later failure", async () => {
  const attention = deferred();
  reads.attention.mockReturnValueOnce(attention.promise);
  reads.history.mockResolvedValueOnce({ source: "firebase", quotes: [{ id: "ready-quote" }], truncated: false });
  await act(async () => root.render(<Harness organizationId="org-a" includeRevenueAttention={false} />));
  expect(container.textContent).toBe("ready-quote");
  expect(latest.reads.attention.status).toBe("loading");
  expect(latest.reads.history.status).toBe("success");
  expect(latest.loadedAt).toBe(0);
  await act(async () => attention.reject(new Error("Attention unavailable")));
  expect(latest.loading).toBe(false);
  expect(latest.reads.attention.status).toBe("error");
  expect(container.textContent).toBe("ready-quote");
});

test("drops old organization settlements and hides its previously displayed quotes", async () => {
  const oldAttention = deferred(), newHistory = deferred();
  reads.attention.mockReturnValueOnce(oldAttention.promise);
  reads.history.mockResolvedValueOnce({ source: "firebase", quotes: [{ id: "org-a-private" }], truncated: false });
  await act(async () => root.render(<Harness organizationId="org-a" includeRevenueAttention={false} />));
  expect(container.textContent).toBe("org-a-private");
  reads.history.mockReturnValueOnce(newHistory.promise);
  await act(async () => root.render(<Harness organizationId="org-b" includeRevenueAttention={false} />));
  expect(container.textContent).toBe("");
  await act(async () => oldAttention.resolve({ source: "firebase", quotes: [{ id: "old-late" }] }));
  expect(latest.reads.history.status).toBe("loading");
  expect(latest.attentionSummary?.items || []).toEqual([]);
  await act(async () => newHistory.resolve({ source: "firebase", quotes: [{ id: "org-b-quote" }], truncated: false }));
  expect(container.textContent).toBe("org-b-quote");
});

test("keeps completed evidence visible and marked stale throughout a failed refresh", async () => {
  reads.history.mockResolvedValueOnce({ source: "firebase", quotes: [{ id: "retained" }], truncated: false });
  await act(async () => root.render(<Harness organizationId="org-a" includeRevenueAttention={false} />));
  const lastCompleteRead = latest.loadedAt;
  const attention = deferred(), history = deferred();
  reads.attention.mockReturnValueOnce(attention.promise);
  reads.history.mockReturnValueOnce(history.promise);
  act(() => latest.refresh({ force: true }));
  expect(container.textContent).toBe("retained");
  expect(latest.stale).toBe(true);
  await act(async () => history.reject(new Error("History unavailable")));
  expect(latest.reads.history.status).toBe("error");
  expect(latest.loadedAt).toBe(lastCompleteRead);
  await act(async () => attention.resolve({ source: "firebase", quotes: [] }));
  expect(latest.loading).toBe(false);
  expect(latest.stale).toBe(true);
  expect(container.textContent).toBe("retained");
});

test("retries only failed history while an unrelated attention request is still pending", async () => {
  const attention = deferred();
  reads.attention.mockReturnValueOnce(attention.promise);
  reads.history.mockRejectedValueOnce(new Error("History unavailable"));
  await act(async () => root.render(<Harness organizationId="org-a" includeRevenueAttention={false} />));
  expect(latest.reads.history.status).toBe("error");
  reads.history.mockResolvedValueOnce({ source: "firebase", quotes: [{ id: "recovered-history" }], truncated: false });
  await act(async () => latest.refresh({ force: true, read: "history" }));
  expect(container.textContent).toBe("recovered-history");
  expect(latest.reads.attention.status).toBe("loading");
  expect(reads.attention).toHaveBeenCalledTimes(1);
  await act(async () => attention.resolve({ source: "firebase", quotes: [] }));
  expect(latest.loading).toBe(false);
  expect(latest.loadedAt).toBeGreaterThan(0);
});
