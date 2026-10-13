// @vitest-environment jsdom
import React from "react";
import { act } from "react-dom/test-utils";
import { createRoot } from "react-dom/client";
import { afterEach, beforeEach, expect, test, vi } from "vitest";
import EventActualsCloseoutSummary from "../EventActualsCloseoutSummary";
const api = vi.hoisted(() => ({ getEventOperatingActualsSnapshot: vi.fn() })); vi.mock("../../lib/eventOperatingActualsClient", () => api);
globalThis.IS_REACT_ACT_ENVIRONMENT = true;
const props = { organizationId: "org-a", quoteId: "quote-a", sourceVersionId: "accepted-a", acceptanceReceiptId: "accept-a" };
const snapshot = { ...props, availability: "available", captureComplete: false, revision: 7, updatedAtISO: "2026-09-05T10:00:00.000Z", totals: { totalCostCents: 12500, laborCostCents: 12500, purchasingCostCents: 0, otherCostCents: 0, durationMinutes: 90 }, categories: Object.fromEntries(["labor", "purchasing", "other"].map((name) => [name, { state: "partial" }])) };
let host, root;
async function render(overrides = {}) { await act(async () => root.render(<EventActualsCloseoutSummary {...props} {...overrides} />)); }
async function refresh() { await act(async () => host.querySelector("button").click()); }
beforeEach(() => { vi.resetAllMocks(); api.getEventOperatingActualsSnapshot.mockResolvedValue({ snapshot }); host = document.createElement("div"); document.body.append(host); root = createRoot(host); }); afterEach(async () => { await act(async () => root.unmount()); host.remove(); });
test("closeout summary binds both accepted references and displays revision dated provisional costs", async () => {
  await render(); expect(api.getEventOperatingActualsSnapshot).toHaveBeenCalledWith({ organizationId: "org-a", quoteId: "quote-a" }); expect(host.textContent).toContain("Captured subtotal (provisional): $125.00"); expect(host.textContent).toContain("revision 7"); expect(host.textContent).toContain("2026-09-05T10:00:00.000Z");
  api.getEventOperatingActualsSnapshot.mockResolvedValueOnce({ snapshot: { ...snapshot, captureComplete: true, revision: 8 } }); await refresh(); expect(host.textContent).toContain("Capture declared complete"); expect(host.textContent).toContain("does not complete a closeout item"); expect(document.activeElement).toBe(host.querySelector('[aria-label="Closeout actuals read outcome"]'));
  for (const override of [{ sourceVersionId: "foreign" }, { acceptanceReceiptId: "foreign" }]) { api.getEventOperatingActualsSnapshot.mockResolvedValueOnce({ snapshot: { ...snapshot, ...override } }); await refresh(); expect(host.textContent).toContain("another accepted source"); expect(host.textContent).not.toContain("$125.00"); }
});
test("closeout summary distinguishes unavailable empty and missing exact references without inferring zero", async () => {
  await render({ sourceVersionId: "" }); expect(api.getEventOperatingActualsSnapshot).not.toHaveBeenCalled(); expect(host.textContent).toContain("Exact accepted-source references are unavailable");
  api.getEventOperatingActualsSnapshot.mockResolvedValueOnce({ snapshot: { ...snapshot, availability: "not_yet_available" } }); await render(); expect(host.textContent).toContain("Zero and completeness are not established");
  api.getEventOperatingActualsSnapshot.mockRejectedValueOnce(new Error("private")); await refresh(); expect(host.textContent).toContain("Actuals could not be read"); expect(host.textContent).not.toContain("private");
});
test("closeout summary ignores an obsolete source read", async () => {
  let resolve; api.getEventOperatingActualsSnapshot.mockReturnValueOnce(new Promise((yes) => { resolve = yes; })); await render(); await render({ sourceVersionId: "new-source" }); await act(async () => resolve({ snapshot })); expect(host.textContent).toContain("another accepted source"); expect(host.textContent).not.toContain("$125.00");
});
