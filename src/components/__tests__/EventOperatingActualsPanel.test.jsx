// @vitest-environment jsdom
import React from "react";
import { act } from "react-dom/test-utils";
import { createRoot } from "react-dom/client";
import { afterEach, beforeEach, expect, test, vi } from "vitest";
import EventOperatingActualsPanel, { parseRecordedCost } from "../EventOperatingActualsPanel";
const api = vi.hoisted(() => ({ applyEventOperatingActualsCommand: vi.fn(), createEventActualsRequestId: vi.fn(), getEventOperatingActualsSnapshot: vi.fn(), isDefinitiveEventActualsError: vi.fn(), readPendingEventActualsCommand: vi.fn(), resetDefinitiveEventActualsCommand: vi.fn() }));
vi.mock("../../lib/eventOperatingActualsClient", () => api);
globalThis.IS_REACT_ACT_ENVIRONMENT = true;
const source = { sourceVersionId: "version-a", acceptanceReceiptId: "accept-a" };
function empty() { return { ...source, availability: "not_yet_available", reasonCode: "actuals_empty", revision: 0, entries: [], categories: Object.fromEntries(["labor", "purchasing", "other"].map((category) => [category, { state: "not_declared", note: "" }])), totals: { laborCostCents: 0, purchasingCostCents: 0, otherCostCents: 0, totalCostCents: 0, durationMinutes: 0 }, captureComplete: false, latestReceipt: null }; }
function recorded() { const value = empty(); value.availability = "available"; value.reasonCode = ""; value.revision = 1; value.entries.push({ entryId: "entry-a", category: "labor", state: "active", description: "Serving labor", costCents: 12500, laborRole: "server", durationMinutes: 120 }); value.categories.labor.state = "partial"; value.totals = { ...value.totals, laborCostCents: 12500, totalCostCents: 12500, durationMinutes: 120 }; return value; }
const props = { organizationId: "org-a", quoteId: "quote-a", principalId: "admin-a", role: "admin", source: "firebase", enabled: true, ...source, phaseSnapshot: { ...source, availability: "available", phase: "prepared" }, phaseReadState: "success", onActualsMutationBlockedChange: vi.fn() };
const deferred = () => { let resolve, reject; const promise = new Promise((yes, no) => { resolve = yes; reject = no; }); return { promise, resolve, reject }; };
let host, root;
async function render(overrides = {}) { await act(async () => root.render(<EventOperatingActualsPanel {...props} {...overrides} />)); }
async function click(label) { const button = [...host.querySelectorAll("button")].find((item) => item.textContent === label || item.getAttribute("aria-label") === label); expect(button).toBeTruthy(); await act(async () => button.click()); }
async function fill(selector, value) { const node = host.querySelector(selector); expect(node).toBeTruthy(); await act(async () => { Object.getOwnPropertyDescriptor(node instanceof HTMLTextAreaElement ? HTMLTextAreaElement.prototype : node instanceof HTMLSelectElement ? HTMLSelectElement.prototype : HTMLInputElement.prototype, "value").set.call(node, value); node.dispatchEvent(new Event(node instanceof HTMLSelectElement ? "change" : "input", { bubbles: true })); }); }
async function laborForm() { await click("Record labor"); await fill("textarea", "Serving labor\nBreak excluded"); await fill('input[inputmode="decimal"]', "125.00"); await fill('input[type="number"]', "120"); }
beforeEach(() => { vi.resetAllMocks(); api.getEventOperatingActualsSnapshot.mockResolvedValue({ snapshot: empty() }); api.createEventActualsRequestId.mockReturnValue("actuals-request-a"); api.readPendingEventActualsCommand.mockReturnValue(null); host = document.createElement("div"); document.body.append(host); root = createRoot(host); });
afterEach(async () => { await act(async () => root.unmount()); host.remove(); });

test("actuals read states distinguish missing declarations from captured totals", async () => {
  const pending = deferred(); api.getEventOperatingActualsSnapshot.mockReturnValueOnce(pending.promise); await render(); expect(host.innerHTML).toContain('data-capability-state="loading"');
  await act(async () => pending.resolve({ snapshot: empty() })); expect(host.innerHTML).toContain('data-capability-state="empty"'); expect(host.innerHTML).toContain('data-capability-state="ready"'); expect(host.innerHTML).toContain('data-capability-state="partial"');
  expect(host.textContent).toContain("Captured subtotal (provisional)"); expect(host.textContent).toContain("Not declared"); expect(host.textContent).not.toContain("Capture declared complete");
  api.getEventOperatingActualsSnapshot.mockResolvedValueOnce({ snapshot: recorded() }); await click("Refresh actuals"); expect(host.innerHTML).toContain('data-capability-state="success"'); expect(host.textContent).toContain("$125.00");
  api.getEventOperatingActualsSnapshot.mockRejectedValueOnce(new Error("Read failed")); await click("Refresh actuals"); expect(host.innerHTML).toContain('data-capability-state="stale"'); expect([...host.querySelectorAll("button")].find((button) => button.textContent === "Record labor").disabled).toBe(true);
});

test("actuals access and read failures preserve recovery", async () => {
  api.getEventOperatingActualsSnapshot.mockRejectedValueOnce(new Error("Read failed")); await render(); expect(host.innerHTML).toContain('data-capability-state="error"');
  await render({ role: "customer" }); expect(host.innerHTML).toContain('data-capability-state="recovery"'); expect(api.getEventOperatingActualsSnapshot).toHaveBeenCalledTimes(1);
});

test("actuals commands preserve uncertainty and refresh historical receipts", async () => {
  await render(); await laborForm(); const submission = deferred(); api.applyEventOperatingActualsCommand.mockReturnValueOnce(submission.promise); await click("Save actuals change");
  expect(host.innerHTML).toContain('data-capability-state="submitting"'); expect(host.querySelector("textarea").disabled).toBe(true); expect(props.onActualsMutationBlockedChange).toHaveBeenLastCalledWith(true);
  await act(async () => submission.reject(new Error("Unknown result"))); expect(host.innerHTML).toContain('data-capability-state="uncertain"');
  await render({ otherMutationBlocked: true }); const replay = deferred(); api.applyEventOperatingActualsCommand.mockReturnValueOnce(replay.promise); await click("Check original actuals request"); expect(host.innerHTML).toContain('data-capability-state="reconciliation"');
  expect(api.applyEventOperatingActualsCommand.mock.calls[1][0]).toEqual(api.applyEventOperatingActualsCommand.mock.calls[0][0]);
  api.getEventOperatingActualsSnapshot.mockResolvedValueOnce({ snapshot: recorded() }); await act(async () => replay.resolve({ snapshot: recorded(), idempotent: true, receipt: { receiptId: "actuals-receipt" } })); expect(host.innerHTML).toContain('data-capability-state="receipt"'); expect(document.activeElement).toBe(host.querySelector('[aria-label="Actuals outcome"]'));
});

test("actuals uses explicit cents and minutes and never treats blank cost as zero", async () => {
  expect(parseRecordedCost("")).toBeNull(); expect(parseRecordedCost("0")).toBe(0); expect(parseRecordedCost("0.10")).toBe(10); expect(parseRecordedCost("1.005")).toBeNull(); expect(parseRecordedCost("1e3")).toBeNull();
  await render(); await click("Record labor"); expect(document.activeElement).toBe(host.querySelector("textarea")); await fill("textarea", "Known labor"); await fill('input[type="number"]', "120");
  expect([...host.querySelectorAll("button")].find((button) => button.textContent === "Save actuals change").disabled).toBe(true);
  await fill('input[inputmode="decimal"]', "0.10"); api.applyEventOperatingActualsCommand.mockResolvedValueOnce({ snapshot: recorded(), receipt: { receiptId: "recorded" } }); await click("Save actuals change");
  expect(api.applyEventOperatingActualsCommand.mock.calls[0][0]).toMatchObject({ costCents: 10, durationMinutes: 120, category: "labor" });
});

test("actuals completeness requires a declared category and note independently of rows", async () => {
  await render(); await click("Review purchasing completeness"); await fill('select[aria-label="Completeness state"]', "not_applicable"); expect([...host.querySelectorAll("button")].find((button) => button.textContent === "Save actuals change").disabled).toBe(true);
  await fill("textarea", "No purchasing was required"); api.applyEventOperatingActualsCommand.mockResolvedValueOnce({ snapshot: empty(), receipt: { receiptId: "declaration" } }); await click("Save actuals change");
  expect(api.applyEventOperatingActualsCommand.mock.calls[0][0]).toMatchObject({ command: "declare_category", category: "purchasing", state: "not_applicable", note: "No purchasing was required" });
  const complete = empty(); complete.captureComplete = true; for (const category of Object.keys(complete.categories)) complete.categories[category] = { state: "not_applicable", note: "Explicitly reviewed" }; api.getEventOperatingActualsSnapshot.mockResolvedValueOnce({ snapshot: complete }); await click("Refresh actuals"); expect(host.textContent).toContain("Capture declared complete");
});

test("actuals correction and void require reasons and preserve exact entry identity", async () => {
  api.getEventOperatingActualsSnapshot.mockResolvedValueOnce({ snapshot: recorded() }); await render(); await click("Correct labor entry 1");
  expect([...host.querySelectorAll("button")].find((button) => button.textContent === "Save actuals change").disabled).toBe(true);
  await fill('textarea:nth-of-type(1)', "Corrected serving labor"); const notes = host.querySelectorAll("textarea"); await act(async () => { Object.getOwnPropertyDescriptor(HTMLTextAreaElement.prototype, "value").set.call(notes[1], "Corrected timesheet"); notes[1].dispatchEvent(new Event("input", { bubbles: true })); });
  api.applyEventOperatingActualsCommand.mockResolvedValueOnce({ snapshot: recorded(), receipt: { receiptId: "correct" } }); await click("Save actuals change"); expect(api.applyEventOperatingActualsCommand.mock.calls[0][0]).toMatchObject({ command: "correct", entryId: "entry-a", category: "labor", reason: "Corrected timesheet" });
  await click("Void labor entry 1"); await fill("textarea", "Duplicate entry"); api.applyEventOperatingActualsCommand.mockResolvedValueOnce({ snapshot: empty(), receipt: { receiptId: "void" } }); await click("Save actuals change"); expect(api.applyEventOperatingActualsCommand.mock.calls[1][0]).toMatchObject({ command: "void", entryId: "entry-a", reason: "Duplicate entry" }); expect(api.applyEventOperatingActualsCommand.mock.calls[1][0]).not.toHaveProperty("costCents");
});

test("actuals sales local missing-parent and retained-entry bounds gate changes", async () => {
  await render({ role: "sales" }); expect(host.textContent).toContain("read-only"); expect(host.textContent).not.toContain("Record labor");
  await render({ source: "local" }); expect(host.textContent).toContain("enabled connected workspace");
  await render({ otherMutationBlocked: true }); expect([...host.querySelectorAll("button")].find((button) => button.textContent === "Record labor").disabled).toBe(true);
  const full = recorded(); full.entries = Array.from({ length: 50 }, (_, index) => ({ ...full.entries[0], entryId: `entry-${index}`, state: "voided" })); api.getEventOperatingActualsSnapshot.mockResolvedValueOnce({ snapshot: full }); await render({ quoteId: "quote-b" }); expect([...host.querySelectorAll("button")].find((button) => button.textContent === "Record labor").disabled).toBe(true);
  expect(host.textContent).toContain("50 of 50 retained entries"); expect(api.applyEventOperatingActualsCommand).not.toHaveBeenCalled();
});

test("actuals rejection enters reviewed recovery and source remount retains original command", async () => {
  await render(); await laborForm(); api.isDefinitiveEventActualsError.mockReturnValue(true); api.applyEventOperatingActualsCommand.mockRejectedValueOnce(new Error("Stale")); await click("Save actuals change");
  expect(host.querySelector('[data-capability-channel="mutation"][data-capability-state="error"]')).not.toBeNull(); api.resetDefinitiveEventActualsCommand.mockReturnValue(true); const fresh = deferred(); api.getEventOperatingActualsSnapshot.mockReturnValueOnce(fresh.promise); await click("Refresh and review actuals"); expect(host.querySelector('[data-capability-channel="mutation"][data-capability-state="recovery"]')).not.toBeNull(); await act(async () => fresh.resolve({ snapshot: empty() }));
  const command = api.applyEventOperatingActualsCommand.mock.calls[0][0]; api.readPendingEventActualsCommand.mockReturnValueOnce({ command, definitive: false }); await render({ sourceVersionId: "version-b", acceptanceReceiptId: "accept-b" });
  api.isDefinitiveEventActualsError.mockReturnValue(false); api.applyEventOperatingActualsCommand.mockRejectedValueOnce(new Error("Unresolved original")); await click("Check original actuals request"); expect(api.applyEventOperatingActualsCommand.mock.calls[1][0]).toEqual(command);
});

test("actuals compact rows preserve costs and keyboard-expandable full descriptions for sales", async () => {
  const value = recorded(); value.entries[0].description = "Long labor description ".repeat(10); api.getEventOperatingActualsSnapshot.mockResolvedValueOnce({ snapshot: value }); await render({ role: "sales" });
  const row = host.querySelector('ul[aria-label="Recorded labor and purchasing entries"] li'); expect(row.querySelector("strong").textContent.length).toBeLessThanOrEqual(65); expect(row.textContent).toContain("$125.00 USD"); expect(row.textContent).toContain("120 minutes");
  const details = row.querySelector("details"); expect(details.open).toBe(false); expect(details.querySelector("p").textContent).toBe(value.entries[0].description); expect(details.querySelector("summary").textContent).toContain("Full description for labor entry 1"); await act(async () => { details.open = true; details.dispatchEvent(new Event("toggle")); }); expect(details.open).toBe(true); expect(row.querySelector("button")).toBeNull();
});
