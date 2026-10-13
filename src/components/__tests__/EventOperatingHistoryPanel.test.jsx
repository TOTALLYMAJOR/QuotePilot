// @vitest-environment jsdom
import React from "react";
import { act } from "react-dom/test-utils";
import { createRoot } from "react-dom/client";
import { afterEach, beforeEach, expect, test, vi } from "vitest";
import EventOperatingHistoryPanel from "../EventOperatingHistoryPanel";
const api = vi.hoisted(() => ({ getEventOperatingHistory: vi.fn(), mergeEventHistoryPages: vi.fn() }));
vi.mock("../../lib/eventOperatingHistoryClient", () => api);
globalThis.IS_REACT_ACT_ENVIRONMENT = true;
const props = { organizationId: "org-a", quoteId: "quote-a", sourceVersionId: "version-a", acceptanceReceiptId: "accept-a", principalId: "admin-a", role: "admin", enabled: true, source: "firebase" };
const row = { channel: "phase", receiptId: "receipt-a", requestId: "request-a", resultRevision: 1, command: "initialize", recordedAtISO: "2026-09-05T10:00:00.000Z", actor: { uid: "admin-a", role: "admin" }, targetType: "phase", targetId: "ledger-a", before: { phase: null }, after: { phase: "prepared" }, note: "" };
const snap = (override = {}) => ({ ...props, availability: "available", rows: [row], anchors: { phase: { revision: 1, receiptId: "receipt-a" }, work: { revision: 0, receiptId: "" }, actuals: { revision: 0, receiptId: "" } }, hasMore: false, nextCursor: null, completeForAnchors: true, newerAvailable: false, evidenceBoundary: "Operational channels only", ...override });
const deferred = () => { let resolve, reject; const promise = new Promise((yes, no) => { resolve = yes; reject = no; }); return { promise, resolve, reject }; };
let host, root;
async function render(overrides = {}) { await act(async () => root.render(<EventOperatingHistoryPanel {...props} {...overrides} />)); }
async function click(label) { const node = [...host.querySelectorAll("button")].find((item) => item.textContent === label); expect(node).toBeTruthy(); await act(async () => node.click()); }
beforeEach(() => { vi.resetAllMocks(); api.mergeEventHistoryPages.mockImplementation((previous, next) => ({ ...next, rows: [...(previous?.rows || []), ...next.rows] })); api.getEventOperatingHistory.mockResolvedValue({ snapshot: snap() }); host = document.createElement("div"); document.body.append(host); root = createRoot(host); });
afterEach(async () => { await act(async () => root.unmount()); host.remove(); });
test("operational history renders all canonical read states", async () => {
  const pending = deferred(); api.getEventOperatingHistory.mockReturnValueOnce(pending.promise); await render(); expect(host.innerHTML).toContain('data-capability-state="loading"');
  await act(async () => pending.resolve({ snapshot: snap({ availability: "not_yet_available", rows: [] }) })); expect(host.innerHTML).toContain('data-capability-state="empty"');
  await click("Refresh Replay"); expect(host.innerHTML).toContain('data-capability-state="success"');
  api.getEventOperatingHistory.mockResolvedValueOnce({ snapshot: snap({ hasMore: true, completeForAnchors: false, nextCursor: "opaque" }) }); await click("Refresh Replay"); expect(host.innerHTML).toContain('data-capability-state="partial"');
  api.getEventOperatingHistory.mockRejectedValueOnce(new Error("Read unavailable")); await click("Load earlier receipts"); expect(host.innerHTML).toContain('data-capability-state="stale"'); expect(host.textContent).toContain("initialize");
  api.getEventOperatingHistory.mockRejectedValueOnce(new Error("Read unavailable")); await render({ quoteId: "quote-b" }); expect(host.innerHTML).toContain('data-capability-state="error"');
  await render({ role: "customer" }); expect(host.innerHTML).toContain('data-capability-state="recovery"');
});
test("operational history pagination keeps original cursor and refresh starts new anchors", async () => {
  api.getEventOperatingHistory.mockResolvedValueOnce({ snapshot: snap({ hasMore: true, completeForAnchors: false, nextCursor: "original_cursor" }) }); await render();
  api.getEventOperatingHistory.mockResolvedValueOnce({ snapshot: snap({ rows: [{ ...row, receiptId: "older" }], newerAvailable: true }) }); await click("Load earlier receipts"); expect(api.getEventOperatingHistory).toHaveBeenLastCalledWith({ organizationId: "org-a", quoteId: "quote-a", cursor: "original_cursor" }); expect(host.querySelectorAll('ol li')).toHaveLength(2); expect(host.textContent).toContain("Newer changes are available"); expect(document.activeElement).toBe(host.querySelector('[aria-label="Replay read outcome"]'));
  await click("Refresh Replay"); expect(api.getEventOperatingHistory).toHaveBeenLastCalledWith({ organizationId: "org-a", quoteId: "quote-a" }); expect(host.querySelectorAll('ol li')).toHaveLength(1);
});
test("operational history rejects changed accepted source and ignores stale route response", async () => {
  const pending = deferred(); api.getEventOperatingHistory.mockReturnValueOnce(pending.promise); await render(); await render({ sourceVersionId: "version-b" }); expect(host.textContent).toContain("accepted source changed");
  await act(async () => pending.resolve({ snapshot: snap() })); expect(host.querySelectorAll('ol li')).toHaveLength(0);
  await render({ source: "local" }); const calls = api.getEventOperatingHistory.mock.calls.length; await render({ role: "sales", source: "local" }); expect(api.getEventOperatingHistory).toHaveBeenCalledTimes(calls);
});

test("operational history presents typed zero costs and nonlabor fields without raw schema labels", async () => {
  api.getEventOperatingHistory.mockResolvedValueOnce({ snapshot: snap({ rows: [{ ...row, channel: "actuals", command: "record", targetType: "actual_entry", before: null, after: { category: "purchasing", state: "active", description: "Zero-cost supplies", costCents: 0, durationMinutes: null, laborRole: "" } }] }) }); await render();
  expect(host.textContent).toContain("Recorded cost (USD)$0.00"); expect(host.textContent).toContain("Worked minutesNot applicable"); expect(host.textContent).toContain("Labor roleNot applicable"); expect(host.textContent).not.toContain("costCents");
});
