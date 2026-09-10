// @vitest-environment jsdom
import React, { act, StrictMode } from "react";
import { createRoot } from "react-dom/client";
import { afterEach, beforeEach, expect, test, vi } from "vitest";
import ProposalComposer, { ClientPreviewDialog } from "../ProposalComposer";

let container;
let root;
let trigger;
let frameCallbacks;
globalThis.IS_REACT_ACT_ENVIRONMENT = true;
beforeEach(() => {
  frameCallbacks = new Map();
  let sequence = 0;
  vi.spyOn(window, "requestAnimationFrame").mockImplementation((callback) => {
    const id = ++sequence; frameCallbacks.set(id, callback); return id;
  });
  vi.spyOn(window, "cancelAnimationFrame").mockImplementation((id) => frameCallbacks.delete(id));
  vi.spyOn(HTMLElement.prototype, "getClientRects").mockReturnValue([{}]);
  trigger = document.createElement("button");
  trigger.textContent = "Preview";
  container = document.createElement("div");
  document.body.append(trigger, container);
  root = createRoot(container);
  trigger.focus();
});
async function frames() {
  const pending = [...frameCallbacks.values()]; frameCallbacks.clear();
  await act(async () => pending.forEach((callback) => callback(0)));
}
afterEach(async () => {
  await act(async () => root.unmount());
  await frames();
  container.remove(); trigger.remove();
  vi.restoreAllMocks();
});

const props = {
  form: { eventName: "Lunch", guests: 80 }, totals: { total: 4000, deposit: 1200 },
  experience: { title: "Lunch", blurb: "A catered lunch" }, menu: { groups: [] }
};
test("client preview reuses modal containment, isolates background, and restores focus", async () => {
  const close = vi.fn();
  await act(async () => root.render(<ClientPreviewDialog {...props} open onClose={close} />));
  await frames();
  const dialog = container.querySelector('[role="dialog"]');
  const closeButton = dialog.querySelector("button");
  expect(dialog.getAttribute("aria-modal")).toBe("true");
  expect(trigger.hasAttribute("inert")).toBe(true);
  expect(document.activeElement).toBe(closeButton);
  for (const shiftKey of [false, true]) {
    await act(async () => document.dispatchEvent(new KeyboardEvent("keydown", { key: "Tab", shiftKey, bubbles: true, cancelable: true })));
    expect(document.activeElement).toBe(closeButton);
  }
  await act(async () => document.dispatchEvent(new KeyboardEvent("keydown", { key: "Escape", bubbles: true, cancelable: true })));
  expect(close).toHaveBeenCalledTimes(1);
  await act(async () => root.render(<ClientPreviewDialog {...props} open={false} onClose={close} />));
  await frames();
  expect(document.activeElement).toBe(trigger);
  expect(trigger.hasAttribute("inert")).toBe(false);
  expect(document.body.style.overflow).not.toBe("hidden");
});

test("Review blockers focuses the same readiness section on every activation", async () => {
  const onSaveQuote = vi.fn();
  const settings = { taxRegions: [{ id: "local", name: "Local", rate: 0 }], seasonalProfiles: [], menuSections: [] };
  const catalog = { packages: [{ id: "basic", name: "Basic", ppp: 50, active: true }], addons: [], rentals: [], settings };
  const form = { eventName: "Lunch", eventTypeId: "lunch", eventTemplateId: "custom", date: "2026-10-01", time: "12:00", hours: 2, guests: 80, venue: "Hall", name: "Client", email: "", pkg: "basic", style: "Buffet", servers: 0, chefs: 0, bartenders: 0, addons: [], rentals: [], menuItems: [], taxRegion: "local", seasonProfileId: "auto", payMethod: "card" };
  await act(async () => root.render(
    <StrictMode>
      <ProposalComposer form={form} totals={{ guests: 80, base: 4000, addons: 0, rentals: 0, menu: 0, labor: 0, travel: 0, serviceFee: 0, tax: 0, total: 4000, deposit: 1200 }}
        catalog={catalog} settings={settings} eventTypes={[{ id: "lunch", name: "Lunch" }]}
        onFieldChange={vi.fn()} onEventTypeChange={vi.fn()} onTemplateChange={vi.fn()}
        onPatchForm={vi.fn()} onGuidedMode={vi.fn()} onSaveQuote={onSaveQuote}
        saveBlockers={[{ id: "client-email", message: "Add the client email." }]} />
    </StrictMode>
  ));
  const review = () => [...container.querySelectorAll("button")].find((button) => button.textContent === "Review 1 blocker");
  await act(async () => review().click());
  await frames();
  const readiness = document.activeElement;
  expect(readiness).not.toBe(document.body);
  expect(readiness).not.toBe(review());
  expect(readiness.textContent).toContain("Add the client email.");
  review().focus();
  await act(async () => review().click());
  await frames();
  expect(document.activeElement).toBe(readiness);
  expect(onSaveQuote).not.toHaveBeenCalled();
});
