// @vitest-environment jsdom
import React from "react";
import { act } from "react-dom/test-utils";
import { createRoot } from "react-dom/client";
import { afterEach, beforeEach, expect, test, vi } from "vitest";
import EventOperationsPanel from "../EventOperationsPanel";
const api = vi.hoisted(() => ({ getEventOperatingSnapshot: vi.fn(), applyEventOperatingCommand: vi.fn(), createEventOperatingRequestId: vi.fn(), readPendingEventOperatingCommand: vi.fn(), resetDefinitiveEventOperatingCommand: vi.fn(), isDefinitiveEventOperatingError: vi.fn() }));
vi.mock("../../lib/eventOperationsClient", () => api);
vi.mock("../EventOperatingWorkPanel", () => ({ default: ({ phaseMutationBlocked, onWorkMutationBlockedChange }) => <div data-phase-mutation-blocked={String(phaseMutationBlocked)}><button onClick={() => onWorkMutationBlockedChange(true)}>Hold work uncertainty</button></div> }));
vi.mock("../EventOperatingActualsPanel", () => ({ default: ({ otherMutationBlocked, onActualsMutationBlockedChange }) => <div data-actuals-other-blocked={String(otherMutationBlocked)}><button onClick={() => onActualsMutationBlockedChange(true)}>Hold actuals uncertainty</button></div> }));
vi.mock("../EventWorkflowPolicyPanel", () => ({ default: ({ otherMutationBlocked, onWorkflowMutationBlockedChange, onInitializationEligibilityChange }) => { React.useEffect(() => onInitializationEligibilityChange(true), [onInitializationEligibilityChange]); return <div data-workflow-other-blocked={String(otherMutationBlocked)}><button onClick={() => onWorkflowMutationBlockedChange(true)}>Hold workflow uncertainty</button></div>; } }));
globalThis.IS_REACT_ACT_ENVIRONMENT = true;
const props = { organizationId: "org-a", quoteId: "quote-a", principalId: "admin-a", role: "admin", source: "firebase", enabled: true, quoteStatus: "booked" };
const absent = { availability: "not_yet_available", sourceVersionId: "version-a", acceptanceReceiptId: "accept-a", phase: null, revision: 0 };
const recorded = { ...absent, availability: "available", phase: "prepared", revision: 1, lastReceiptId: "receipt-a" };
let host, root;
const deferred = () => { let resolve, reject; const promise = new Promise((yes, no) => { resolve = yes; reject = no; }); return { promise, resolve, reject }; };
async function render(overrides = {}) { await act(async () => root.render(<EventOperationsPanel {...props} {...overrides} />)); }
async function click(label) { const button = [...host.querySelectorAll("button")].find((item) => item.textContent === label); expect(button).toBeTruthy(); await act(async () => button.click()); }
beforeEach(() => { vi.resetAllMocks(); api.getEventOperatingSnapshot.mockResolvedValue({ snapshot: absent }); api.createEventOperatingRequestId.mockReturnValue("request-a"); api.readPendingEventOperatingCommand.mockReturnValue(null); host = document.createElement("div"); document.body.append(host); root = createRoot(host); });
afterEach(async () => { await act(async () => root.unmount()); host.remove(); });

test("event operating read states retain exact evidence and bounded history", async () => {
  const load = deferred(); api.getEventOperatingSnapshot.mockReturnValueOnce(load.promise);
  await render(); expect(host.innerHTML).toContain('data-capability-state="loading"');
  await act(async () => load.resolve({ snapshot: absent }));
  expect(host.innerHTML).toContain('data-capability-state="empty"');
  expect(host.innerHTML).toContain('data-capability-state="ready"');
  expect(host.innerHTML).toContain('data-capability-state="partial"');
  expect(host.textContent).toContain("latest receipt only");
  api.getEventOperatingSnapshot.mockResolvedValueOnce({ snapshot: recorded }); await click("Refresh phase");
  expect(host.innerHTML).toContain('data-capability-state="success"');
  expect(host.textContent).toContain("Recorded phase: Prepared");
  api.getEventOperatingSnapshot.mockRejectedValueOnce(new Error("Refresh unavailable")); await click("Refresh phase");
  expect(host.innerHTML).toContain('data-capability-state="stale"');
  expect([...host.querySelectorAll("button")].find((item) => item.textContent === "Start event").disabled).toBe(true);
});

test("event operating read error and denied access preserve recovery", async () => {
  api.getEventOperatingSnapshot.mockRejectedValueOnce(new Error("Unavailable")); await render();
  expect(host.innerHTML).toContain('data-capability-state="error"');
  expect(host.textContent).toContain("Refresh event evidence");
  await render({ role: "customer" });
  expect(host.innerHTML).toContain('data-capability-state="recovery"');
  expect(host.textContent).not.toContain("version-a");
  expect(api.getEventOperatingSnapshot).toHaveBeenCalledTimes(1);
});

test("event operating command states freeze uncertainty and reconcile the exact request", async () => {
  await render(); const submitted = deferred(); api.applyEventOperatingCommand.mockReturnValueOnce(submitted.promise);
  await click("Record event prepared");
  expect(host.innerHTML).toContain('data-capability-state="submitting"');
  expect([...host.querySelectorAll("button")].find((item) => item.textContent === "Record event prepared").disabled).toBe(true);
  await act(async () => submitted.reject(new Error("Result unknown")));
  expect(host.innerHTML).toContain('data-capability-state="uncertain"');
  expect(host.textContent).not.toContain("Prepared recorded");
  const retry = deferred(); api.applyEventOperatingCommand.mockReturnValueOnce(retry.promise);
  await click("Check original request");
  expect(host.innerHTML).toContain('data-capability-state="reconciliation"');
  expect(api.applyEventOperatingCommand.mock.calls[1][0]).toEqual(api.applyEventOperatingCommand.mock.calls[0][0]);
  api.getEventOperatingSnapshot.mockResolvedValueOnce({ snapshot: recorded });
  await act(async () => retry.resolve({ snapshot: recorded, receipt: { receiptId: "receipt-a", resultPhase: "prepared" } }));
  expect(host.innerHTML).toContain('data-capability-state="receipt"');
  expect(host.textContent).toContain("Prepared recorded. Receipt: receipt-a");
  expect(host.textContent).toContain("Start event");
  expect(api.createEventOperatingRequestId).toHaveBeenCalledTimes(1);
});

test("event operating rejected commands require reviewed recovery", async () => {
  await render(); api.isDefinitiveEventOperatingError.mockReturnValue(true); api.applyEventOperatingCommand.mockRejectedValueOnce(new Error("Source changed"));
  await click("Record event prepared");
  expect(host.querySelector('[data-capability-channel="mutation"][data-capability-state="error"]')).not.toBeNull();
  api.resetDefinitiveEventOperatingCommand.mockReturnValue(true); const refresh = deferred(); api.getEventOperatingSnapshot.mockReturnValueOnce(refresh.promise);
  await click("Refresh and review");
  expect(host.querySelector('[data-capability-channel="mutation"][data-capability-state="recovery"]')).not.toBeNull();
  await act(async () => refresh.resolve({ snapshot: absent }));
  expect(host.innerHTML).toContain('data-capability-state="ready"');
});

test("event operating sales reads and local or accepted records never mutate", async () => {
  await render({ role: "sales" }); expect(host.textContent).toContain("read-only"); expect(host.textContent).not.toContain("Record event prepared");
  await render({ source: "local" }); expect(host.innerHTML).toContain('data-capability-state="recovery"');
  await render({ quoteStatus: "accepted" }); expect(host.innerHTML).toContain('data-capability-state="recovery"');
  expect(api.getEventOperatingSnapshot).toHaveBeenCalledTimes(1); expect(api.applyEventOperatingCommand).not.toHaveBeenCalled();
});

test("event operating identity changes discard stale responses and restore only scoped pending work", async () => {
  const first = deferred(); api.getEventOperatingSnapshot.mockReturnValueOnce(first.promise);
  await render(); await render({ quoteId: "quote-b", enabled: false });
  await act(async () => first.resolve({ snapshot: recorded }));
  expect(host.textContent).not.toContain("version-a");
  api.readPendingEventOperatingCommand.mockReturnValueOnce({ definitive: false, command: { requestId: "old-request" } });
  await render(); expect(host.innerHTML).toContain('data-capability-state="uncertain"');
  expect(api.readPendingEventOperatingCommand).toHaveBeenLastCalledWith({ organizationId: "org-a", quoteId: "quote-a", principalId: "admin-a" });
});


test("an older refresh cannot overwrite a confirmed mutation result", async () => {
  await render();
  const load = deferred(); api.getEventOperatingSnapshot.mockReturnValueOnce(load.promise);
  const applied = deferred(); api.applyEventOperatingCommand.mockReturnValueOnce(applied.promise);
  const buttons = [...host.querySelectorAll("button")];
  await act(async () => {
    buttons.find((button) => button.textContent === "Refresh phase").click();
    buttons.find((button) => button.textContent === "Record event prepared").click();
  });
  expect(api.applyEventOperatingCommand).toHaveBeenCalledTimes(1);
  await act(async () => applied.resolve({ snapshot: recorded, receipt: { receiptId: "receipt-a", resultPhase: "prepared" } }));
  await act(async () => load.resolve({ snapshot: absent }));
  expect(host.textContent).toContain("Recorded phase: Prepared");
  expect(host.textContent).not.toContain("No event phase has been recorded.");
});


test("replayed historical receipt requires current evidence before enabling another phase", async () => {
  await render();
  api.applyEventOperatingCommand.mockRejectedValueOnce(new Error("Unknown result"));
  await click("Record event prepared");
  const current = deferred(); api.getEventOperatingSnapshot.mockReturnValueOnce(current.promise);
  api.applyEventOperatingCommand.mockResolvedValueOnce({ snapshot: recorded, idempotent: true, receipt: { receiptId: "receipt-a", resultPhase: "prepared" } });
  await click("Check original request");
  expect(host.innerHTML).toContain('data-capability-state="loading"');
  expect(host.textContent).not.toContain("Start event");
  await act(async () => current.resolve({ snapshot: { ...recorded, phase: "in_progress", revision: 2 } }));
  expect(host.textContent).toContain("Recorded phase: In progress");
  expect(host.textContent).toContain("Prepared recorded. Receipt: receipt-a");
  expect(host.textContent).toContain("Complete event");
});

test("changed acceptance source reloads evidence and retains the exact unresolved command", async () => {
  await render({ sourceVersionId: "version-a", acceptanceReceiptId: "accept-a" });
  api.applyEventOperatingCommand.mockRejectedValueOnce(new Error("Unknown result"));
  await click("Record event prepared");
  const original = api.applyEventOperatingCommand.mock.calls[0][0];
  api.readPendingEventOperatingCommand.mockReturnValueOnce({ definitive: false, command: original });
  api.getEventOperatingSnapshot.mockResolvedValueOnce({ snapshot: { ...absent, sourceVersionId: "version-b", acceptanceReceiptId: "accept-b" } });
  await render({ sourceVersionId: "version-b", acceptanceReceiptId: "accept-b" });
  expect(api.getEventOperatingSnapshot).toHaveBeenCalledTimes(2);
  expect(host.innerHTML).toContain('data-capability-state="uncertain"');
  api.applyEventOperatingCommand.mockRejectedValueOnce(new Error("Original remains unknown"));
  await click("Check original request");
  expect(api.applyEventOperatingCommand.mock.calls[1][0]).toEqual(original);
});


test("unresolved work blocks new phase actions while phase uncertainty blocks new work", async () => {
  await render(); await click("Hold work uncertainty");
  expect([...host.querySelectorAll("button")].find((button) => button.textContent === "Record event prepared").disabled).toBe(true);
  await render({ quoteId: "quote-b" });
  api.applyEventOperatingCommand.mockRejectedValueOnce(new Error("Phase uncertain"));
  await click("Record event prepared");
  expect(host.querySelector('[data-phase-mutation-blocked="true"]')).not.toBeNull();
  expect(host.textContent).toContain("Check original request");
});

test("actuals uncertainty blocks phase and work while work uncertainty blocks actuals", async () => {
  await render(); await click("Hold actuals uncertainty");
  expect([...host.querySelectorAll("button")].find((button) => button.textContent === "Record event prepared").disabled).toBe(true);
  expect(host.querySelector('[data-phase-mutation-blocked="true"]')).not.toBeNull();
  await render({ quoteId: "quote-c" }); await click("Hold work uncertainty");
  expect(host.querySelector('[data-actuals-other-blocked="true"]')).not.toBeNull();
});

test("workflow uncertainty blocks phase work and actuals while operational uncertainty blocks workflow", async () => {
  await render(); await click("Hold workflow uncertainty"); expect([...host.querySelectorAll("button")].find((node) => node.textContent === "Record event prepared").disabled).toBe(true); expect(host.querySelector('[data-phase-mutation-blocked="true"]')).not.toBeNull(); expect(host.querySelector('[data-actuals-other-blocked="true"]')).not.toBeNull();
  await render({ quoteId: "quote-b" }); await click("Hold work uncertainty"); expect(host.querySelector('[data-workflow-other-blocked="true"]')).not.toBeNull();
});
