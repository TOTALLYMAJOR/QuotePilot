// @vitest-environment jsdom
import React from "react";
import { act } from "react-dom/test-utils";
import { createRoot } from "react-dom/client";
import { afterEach, beforeEach, expect, test, vi } from "vitest";
import EventExecutionContextPanel from "../EventExecutionContextPanel";
const api = vi.hoisted(() => ({ staffing: vi.fn(), beo: vi.fn(), dependencies: vi.fn(), actuals: vi.fn() }));
vi.mock("../../lib/operationalStaffingClient", () => ({ getOperationalStaffingSnapshot: api.staffing }));
vi.mock("../../lib/kitchenBeoClient", () => ({ getKitchenBeoArtifactStatus: api.beo }));
vi.mock("../../lib/commercialChangeAuthorityClient", () => ({ getCommercialDependencyState: api.dependencies }));
vi.mock("../../lib/eventOperatingActualsClient", () => ({ getEventOperatingActualsSnapshot: api.actuals }));
vi.mock("../EventRunOfShowPanel", () => ({ default: ({ model }) => <p>Derived run of show: {model.events?.[0]?.quoteId}</p> }));
globalThis.IS_REACT_ACT_ENVIRONMENT = true;
const props = { organizationId: "org-a", principalId: "admin-a", role: "admin", source: "firebase", enabled: true, quote: { id: "quote-a", status: "booked", customerId: "customer-a", activeVersionId: "version-a", acceptanceReceipt: { receiptId: "accept-a" }, event: { date: "2026-09-06", time: "18:00", hours: 4 } }, onOpenQuote: vi.fn(), onOpenCustomer: vi.fn() };
const actuals = () => ({ sourceVersionId: "version-a", acceptanceReceiptId: "accept-a", availability: "available", captureComplete: false, totals: { totalCostCents: 0, laborCostCents: 0, purchasingCostCents: 0, otherCostCents: 0, durationMinutes: 0 }, categories: Object.fromEntries(["labor", "purchasing", "other"].map((name) => [name, { state: "not_declared" }])) });
let host, root;
async function render(overrides = {}) { await act(async () => root.render(<EventExecutionContextPanel {...props} {...overrides} />)); }
async function click(label) { const button = [...host.querySelectorAll("button")].find((node) => node.textContent === label); await act(async () => button.click()); }
beforeEach(() => { vi.resetAllMocks(); api.staffing.mockResolvedValue({ state: "stale", activeQuoteRevisionId: "current-commercial", snapshot: { quoteRevisionId: "old-commercial", coverage: { state: "attention", totalOperatorConfirmedCount: 1, totalGap: 2 } } }); api.beo.mockResolvedValue({ state: "STALE", commercialSourceRevisionId: "artifact-source", receiptId: "beo-receipt" }); api.dependencies.mockResolvedValue({ state: "BLOCKED", activeRevisionId: "current-commercial", openInvalidationCount: 2, bounds: { invalidationSetComplete: false } }); api.actuals.mockResolvedValue({ snapshot: actuals() }); host = document.createElement("div"); document.body.append(host); root = createRoot(host); });
afterEach(async () => { await act(async () => root.unmount()); host.remove(); });
test("execution context uses current domain reads without implying operational history", async () => {
  await render({ role: "sales" }); for (const read of Object.values(api)) expect(read).toHaveBeenCalledWith({ organizationId: "org-a", quoteId: "quote-a" });
  expect(host.textContent).toContain("Current source records are shown by reference"); expect(host.textContent).toContain("Current staffing read: stale"); expect(host.textContent).toContain("Plan source revision: old-commercial"); expect(host.textContent).toContain("Artifact source revision: artifact-source"); expect(host.textContent).toContain("Current commercial dependencies: BLOCKED"); expect(host.textContent).toContain("dependency read is incomplete"); expect(host.textContent).toContain("Derived run of show: quote-a");
  await click("Open staffing, BEO, and dependencies in quote record"); expect(props.onOpenQuote).toHaveBeenCalledWith("quote-a"); await click("Open customer closeout review"); expect(props.onOpenCustomer).toHaveBeenCalledWith("customer-a");
});
test("closeout actuals require exact accepted version and receipt and preserve provisional zero", async () => {
  await render(); expect(host.textContent).toContain("Captured subtotal (provisional): $0.00"); expect(host.textContent).not.toContain("Capture declared complete");
  api.actuals.mockResolvedValueOnce({ snapshot: { ...actuals(), acceptanceReceiptId: "foreign" } }); await click("Refresh context"); expect(host.textContent).toContain("different accepted source"); expect(host.textContent).not.toContain("$0.00");
  api.actuals.mockResolvedValueOnce({ snapshot: { ...actuals(), availability: "not_yet_available" } }); await click("Refresh context"); expect(host.textContent).toContain("Zero is not established");
});
test("execution reads fail independently and reject late responses after source changes", async () => {
  api.beo.mockRejectedValueOnce(new Error("private")); await render(); expect(host.textContent).toContain("current domain read is unavailable"); expect(host.textContent).toContain("Current staffing read: stale"); expect(host.textContent).not.toContain("private");
  let resolve; api.actuals.mockReturnValueOnce(new Promise((yes) => { resolve = yes; })); await click("Refresh context"); await render({ source: "local" }); await act(async () => resolve({ snapshot: actuals() })); expect(host.textContent).toBe("");
  const count = api.actuals.mock.calls.length; await render({ role: "customer" }); expect(api.actuals).toHaveBeenCalledTimes(count);
});
