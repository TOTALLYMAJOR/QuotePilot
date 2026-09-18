// @vitest-environment jsdom
import React, { act } from "react";
import { createRoot } from "react-dom/client";
import { afterEach, beforeEach, expect, test, vi } from "vitest";
import { EventSupplyActionPlanPanel } from "../InventoryWorkspace";
globalThis.IS_REACT_ACT_ENVIRONMENT = true;
let container, root;
beforeEach(() => { container = document.createElement("div"); document.body.append(container); root = createRoot(container); });
afterEach(async () => { await act(async () => root.unmount()); container.remove(); });
const snapshot = () => ({ resolution: "unresolved", stale: false, source: { eligible: true, allocationFingerprint: "a".repeat(64), shortageFingerprint: "b".repeat(64), sourceFingerprint: "c".repeat(64), shortages: [] }, plan: { status: "draft", planRevision: 1, edits: [{ ingredientId: "chicken", locationId: "main", baseUnitId: "lb", shortageQuantity: "5", supplierId: "supplier", supplierLabel: "Supplier", purchaseQuantity: "5", estimatedCostMinor: null, note: "", conditions: [], policyFingerprint: "d".repeat(64), offerFingerprint: "e".repeat(64) }] } });
async function mount(getPlan, applyPlan = vi.fn()) { await act(async () => root.render(<EventSupplyActionPlanPanel enabled organizationId="org-one" role="admin" events={[{ id: "quote-one", status: "accepted", event: { name: "Dinner" } }]} getPlan={getPlan} applyPlan={applyPlan} />)); }
async function select() { await act(async () => { const field = container.querySelector("select"); field.value = "quote-one"; field.dispatchEvent(new Event("change", { bubbles: true })); }); }
async function approve() { await act(async () => container.querySelector('input[type="checkbox"]').click()); await act(async () => container.querySelector('[data-supply-command="approve"]').click()); }
test("asserts exact supply read states and recovery markers", async () => {
  let resolve; const getPlan = vi.fn().mockImplementationOnce(() => new Promise((done) => { resolve = done; }));
  await mount(getPlan); expect(container.innerHTML).toContain('data-capability-state="empty"');
  expect(container.innerHTML).toContain('data-capability-id="event-supply-action-plan"');
  await select(); expect(container.innerHTML).toContain('data-capability-state="loading"');
  await act(async () => resolve(snapshot())); expect(container.innerHTML).toContain('data-capability-state="success"'); expect(container.innerHTML).toContain('data-capability-state="ready"');
  getPlan.mockResolvedValueOnce({ ...snapshot(), stale: true }); await select(); expect(container.innerHTML).toContain('data-capability-state="stale"');
  getPlan.mockResolvedValueOnce({ ...snapshot(), source: { ...snapshot().source, eligible: false } }); await select(); expect(container.innerHTML).toContain('data-capability-state="partial"');
  getPlan.mockRejectedValueOnce(new Error("Read failed")); await select(); expect(container.innerHTML).toContain('data-capability-state="error"'); expect(container.innerHTML).toContain('data-capability-state="recovery"');
});
test("retains exact uncertain supply command and reconciles without a new identity", async () => {
  let reject, resolve;
  const applyPlan = vi.fn().mockImplementationOnce(() => new Promise((done, fail) => { reject = fail; })).mockImplementationOnce(() => new Promise((done) => { resolve = done; }));
  await mount(vi.fn().mockResolvedValue(snapshot()), applyPlan); await select(); await approve();
  expect(container.innerHTML).toContain('data-capability-id="event-supply-action-plan"');
  expect(container.innerHTML).toContain('data-capability-state="submitting"');
  await act(async () => reject(new Error("Response lost"))); expect(container.innerHTML).toContain('data-capability-state="uncertain"');
  expect(container.querySelector("select").disabled).toBe(true); expect(container.querySelector('[data-supply-command="approve"]')).toBeNull();
  await act(async () => [...container.querySelectorAll("button")].find((button) => button.textContent === "Check exact supply request").click());
  expect(container.innerHTML).toContain('data-capability-state="reconciliation"'); expect(applyPlan.mock.calls[1][0]).toEqual(applyPlan.mock.calls[0][0]);
  await act(async () => resolve({ receipt: { receiptId: "exact-receipt" } })); expect(container.innerHTML).toContain('data-capability-state="receipt"');
});
test("requires explicit recovery after definitive supply refusal", async () => {
  await mount(vi.fn().mockResolvedValue(snapshot()), vi.fn().mockRejectedValue(Object.assign(new Error("Source changed"), { code: "failed-precondition" }))); await select(); await approve();
  expect(container.innerHTML).toContain('data-capability-state="error"');
  const reset = container.querySelector('button[data-capability-state="recovery"]'); expect(reset).not.toBeNull();
  await act(async () => reset.click()); expect(container.querySelector('section[data-capability-state="recovery"]')).not.toBeNull(); expect(container.querySelector('input[type="checkbox"]').checked).toBe(false);
});
