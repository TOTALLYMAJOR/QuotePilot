// @vitest-environment jsdom
import React from "react";
import { act } from "react-dom/test-utils";
import { createRoot } from "react-dom/client";
import { afterEach, beforeEach, expect, test, vi } from "vitest";
import EventOperatingWorkPanel from "../EventOperatingWorkPanel";
const api = vi.hoisted(() => ({ applyEventOperatingWorkCommand: vi.fn(), createEventWorkRequestId: vi.fn(), getEventOperatingWorkSnapshot: vi.fn(), isDefinitiveEventWorkError: vi.fn(), readPendingEventWorkCommand: vi.fn(), resetDefinitiveEventWorkCommand: vi.fn() }));
vi.mock("../../lib/eventOperatingWorkClient", () => api);
globalThis.IS_REACT_ACT_ENVIRONMENT = true;
const source = { sourceVersionId: "version-a", acceptanceReceiptId: "accept-a" };
function empty() { return { ...source, availability: "not_yet_available", reasonCode: "journal_empty", revision: 0, checkpoints: ["venue_access", "team_briefing", "service_handoff", "pack_down"].map((code) => ({ code, state: "not_recorded", note: "" })), issues: [], latestReceipt: null }; }
function recorded() { const value = empty(); value.availability = "available"; value.reasonCode = ""; value.revision = 1; value.checkpoints[0].state = "recorded"; return value; }
const props = { organizationId: "org-a", quoteId: "quote-a", principalId: "admin-a", role: "admin", source: "firebase", enabled: true, ...source, phaseSnapshot: { ...source, availability: "available", phase: "prepared" }, phaseReadState: "success", onWorkMutationBlockedChange: vi.fn() };
const deferred = () => { let resolve, reject; const promise = new Promise((yes, no) => { resolve = yes; reject = no; }); return { promise, resolve, reject }; };
let host, root;
async function render(overrides = {}) { await act(async () => root.render(<EventOperatingWorkPanel {...props} {...overrides} />)); }
async function click(label) { const button = [...host.querySelectorAll("button")].find((item) => item.textContent === label); expect(button).toBeTruthy(); await act(async () => button.click()); }
async function fill(value) { const input = host.querySelector("textarea"); expect(input).toBeTruthy(); await act(async () => { Object.getOwnPropertyDescriptor(HTMLTextAreaElement.prototype, "value").set.call(input, value); input.dispatchEvent(new Event("input", { bubbles: true })); }); }
beforeEach(() => { vi.resetAllMocks(); api.getEventOperatingWorkSnapshot.mockResolvedValue({ snapshot: empty() }); api.createEventWorkRequestId.mockReturnValue("work-request-a"); api.readPendingEventWorkCommand.mockReturnValue(null); host = document.createElement("div"); document.body.append(host); root = createRoot(host); });
afterEach(async () => { await act(async () => root.unmount()); host.remove(); });

test("event work read states preserve absent current stale and bounded history", async () => {
  const read = deferred(); api.getEventOperatingWorkSnapshot.mockReturnValueOnce(read.promise); await render();
  expect(host.innerHTML).toContain('data-capability-state="loading"');
  await act(async () => read.resolve({ snapshot: empty() }));
  expect(host.innerHTML).toContain('data-capability-state="empty"');
  expect(host.innerHTML).toContain('data-capability-state="ready"');
  expect(host.innerHTML).toContain('data-capability-state="partial"');
  expect(host.textContent).toContain("Not recorded");
  api.getEventOperatingWorkSnapshot.mockResolvedValueOnce({ snapshot: recorded() }); await click("Refresh event work");
  expect(host.innerHTML).toContain('data-capability-state="success"');
  api.getEventOperatingWorkSnapshot.mockRejectedValueOnce(new Error("Read failed")); await click("Refresh event work");
  expect(host.innerHTML).toContain('data-capability-state="stale"');
  expect([...host.querySelectorAll("button")].find((button) => button.textContent === "Reopen Venue access").disabled).toBe(true);
});

test("event work read failures and access denial stay recoverable", async () => {
  api.getEventOperatingWorkSnapshot.mockRejectedValueOnce(new Error("Read failed")); await render();
  expect(host.innerHTML).toContain('data-capability-state="error"');
  expect(host.textContent).toContain("Refresh event work");
  await render({ role: "customer" });
  expect(host.innerHTML).toContain('data-capability-state="recovery"');
  expect(api.getEventOperatingWorkSnapshot).toHaveBeenCalledTimes(1);
});

test("event work commands retain uncertainty and reconcile original receipt", async () => {
  await render(); await click("Record Venue access"); await fill("Venue entrance opened\nTeam informed");
  const request = deferred(); api.applyEventOperatingWorkCommand.mockReturnValueOnce(request.promise); await click("Save work change");
  expect(host.innerHTML).toContain('data-capability-state="submitting"');
  expect(host.querySelector("textarea").disabled).toBe(true);
  expect(props.onWorkMutationBlockedChange).toHaveBeenLastCalledWith(true);
  await act(async () => request.reject(new Error("Unconfirmed")));
  expect(host.innerHTML).toContain('data-capability-state="uncertain"');
  expect(host.querySelector("textarea").value).toContain("\n");
  await render({ phaseMutationBlocked: true });
  const replay = deferred(); api.applyEventOperatingWorkCommand.mockReturnValueOnce(replay.promise); await click("Check original work request");
  expect(host.innerHTML).toContain('data-capability-state="reconciliation"');
  expect(api.applyEventOperatingWorkCommand.mock.calls[1][0]).toEqual(api.applyEventOperatingWorkCommand.mock.calls[0][0]);
  api.getEventOperatingWorkSnapshot.mockResolvedValueOnce({ snapshot: recorded() });
  await act(async () => replay.resolve({ snapshot: recorded(), idempotent: true, receipt: { receiptId: "work-receipt-a" } }));
  expect(host.innerHTML).toContain('data-capability-state="receipt"');
  expect(host.textContent).toContain("Work change recorded. Receipt: work-receipt-a");
});

test("event work rejection requires review and cannot erase original uncertain inputs", async () => {
  await render(); await click("Record Venue access"); api.isDefinitiveEventWorkError.mockReturnValue(true); api.applyEventOperatingWorkCommand.mockRejectedValueOnce(new Error("Stale journal")); await click("Save work change");
  expect(host.querySelector('[data-capability-channel="mutation"][data-capability-state="error"]')).not.toBeNull();
  api.resetDefinitiveEventWorkCommand.mockReturnValue(true); const refresh = deferred(); api.getEventOperatingWorkSnapshot.mockReturnValueOnce(refresh.promise); await click("Refresh and review work");
  expect(host.querySelector('[data-capability-channel="mutation"][data-capability-state="recovery"]')).not.toBeNull();
  await act(async () => refresh.resolve({ snapshot: empty() }));
  expect(host.querySelector("textarea")).toBeNull();
});

test("event work role phase source and journal limits gate new actions", async () => {
  await render({ role: "sales" }); expect(host.textContent).toContain("read-only"); expect(host.textContent).not.toContain("Record Venue access");
  await render({ source: "local" }); expect(host.textContent).toContain("enabled connected workspace");
  await render({ phaseMutationBlocked: true }); expect([...host.querySelectorAll("button")].find((button) => button.textContent === "Record Venue access").disabled).toBe(true);
  await render({ phaseMutationBlocked: false, phaseSnapshot: { ...source, availability: "not_yet_available" } });
  expect([...host.querySelectorAll("button")].find((button) => button.textContent === "Record Venue access").disabled).toBe(true);
  const full = empty(); full.issues = Array.from({ length: 25 }, (_, index) => ({ issueId: `issue-${index}`, state: "resolved", severity: "normal", description: `Issue ${index}`, latestNote: "Resolved" }));
  api.getEventOperatingWorkSnapshot.mockResolvedValueOnce({ snapshot: full });
  await render({ quoteId: "quote-b", phaseSnapshot: { ...source, availability: "available", phase: "completed" } });
  expect([...host.querySelectorAll("button")].find((button) => button.textContent === "Open issue").disabled).toBe(true);
  expect([...host.querySelectorAll("button")].find((button) => button.textContent === "Record Pack down").disabled).toBe(false);
  expect(api.applyEventOperatingWorkCommand).not.toHaveBeenCalled();
});

test("issue corrections require reasons and preserve server-generated targets", async () => {
  const state = recorded(); state.issues = [{ issueId: "server-issue", state: "open", severity: "urgent", description: "Missing supply", latestNote: "Missing supply" }];
  api.getEventOperatingWorkSnapshot.mockResolvedValueOnce({ snapshot: state }); await render(); await click("Resolve issue");
  expect([...host.querySelectorAll("button")].find((button) => button.textContent === "Save work change").disabled).toBe(true);
  await fill("Supply arrived"); api.applyEventOperatingWorkCommand.mockResolvedValueOnce({ snapshot: state, receipt: { receiptId: "resolution-receipt" } }); await click("Save work change");
  expect(api.applyEventOperatingWorkCommand.mock.calls[0][0]).toMatchObject({ command: "issue_resolve", issueId: "server-issue", note: "Supply arrived" });
});

test("historical work replay refreshes current journal before another edit", async () => {
  await render(); await click("Record Venue access"); api.applyEventOperatingWorkCommand.mockRejectedValueOnce(new Error("Unconfirmed")); await click("Save work change");
  const fresh = deferred(); api.getEventOperatingWorkSnapshot.mockReturnValueOnce(fresh.promise); api.applyEventOperatingWorkCommand.mockResolvedValueOnce({ snapshot: recorded(), idempotent: true, receipt: { receiptId: "old-work-receipt" } }); await click("Check original work request");
  expect(host.textContent).toContain("Loading checkpoints and issues"); expect(host.textContent).not.toContain("Reopen Venue access");
  const current = recorded(); current.revision = 2; current.checkpoints[0].state = "reopened";
  await act(async () => fresh.resolve({ snapshot: current })); expect(host.textContent).toContain("Reopened"); expect(host.textContent).toContain("old-work-receipt");
});

test("source remount restores original pending work without applying an obsolete read", async () => {
  const first = deferred(); api.getEventOperatingWorkSnapshot.mockReturnValueOnce(first.promise); await render();
  const command = { organizationId: "org-a", quoteId: "quote-a", ...source, requestId: "old-request", command: "checkpoint_record", checkpointCode: "venue_access", note: "" };
  api.readPendingEventWorkCommand.mockReturnValueOnce({ command, definitive: false });
  await render({ sourceVersionId: "version-b", acceptanceReceiptId: "accept-b" });
  await act(async () => first.resolve({ snapshot: recorded() }));
  expect(host.textContent).toContain("original work request still needs review");
  api.applyEventOperatingWorkCommand.mockRejectedValueOnce(new Error("Still unknown")); await click("Check original work request");
  expect(api.applyEventOperatingWorkCommand.mock.calls[0][0]).toMatchObject(command);
});


test("explicit editor selection focuses its note and terminal receipt receives focus", async () => {
  await render(); await click("Record Venue access");
  expect(document.activeElement).toBe(host.querySelector("textarea"));
  await fill("Checked at the venue"); expect(document.activeElement).toBe(host.querySelector("textarea"));
  api.applyEventOperatingWorkCommand.mockResolvedValueOnce({ snapshot: recorded(), receipt: { receiptId: "focused-receipt" } });
  await click("Save work change");
  expect(document.activeElement).toBe(host.querySelector('[aria-label="Event work outcome"]'));
  expect(document.activeElement.textContent).toContain("focused-receipt");
});
