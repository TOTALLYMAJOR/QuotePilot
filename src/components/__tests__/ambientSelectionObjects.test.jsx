// @vitest-environment jsdom
import React, { act } from "react";
import { createRoot } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, test, vi } from "vitest";
import AmbientSelectionObjects from "../ambient/AmbientSelectionObjects";
import { buildAmbientSelectionObjects } from "../../lib/ambientSelectionObjects";

globalThis.IS_REACT_ACT_ENVIRONMENT = true;

const QUOTE = Object.freeze({
  id: "quote-selection-ui",
  organizationId: "org-ui",
  activeVersionId: "version-ui",
  event: Object.freeze({ guests: 80, hours: 5, style: "Buffet" }),
  selection: Object.freeze({
    packageId: "buffet",
    packageInclusions: Object.freeze({ addons: [], rentals: [] }),
    addons: Object.freeze(["bar", "service"]),
    rentals: Object.freeze(["linens"]),
    addonQuantities: Object.freeze({ bar: 2, service: 80 }),
    rentalQuantities: Object.freeze({ linens: 10 }),
    addonSnapshots: Object.freeze([
      Object.freeze({ id: "bar", name: "Hosted Bar", pricingType: "per_event", quantity: 2 }),
      Object.freeze({ id: "service", name: "Table Service", pricingType: "per_person", quantity: 80 })
    ]),
    rentalSnapshots: Object.freeze([
      Object.freeze({ id: "linens", name: "Table Linens", pricingType: "per_item", quantity: 10 })
    ])
  })
});

const EVIDENCE = Object.freeze({
  organizationId: "org-ui",
  sourceLabel: "firebase-org",
  catalogRevision: 8,
  freshness: Object.freeze({ state: "fresh", observedAtISO: "2026-08-12T03:00:00.000Z" }),
  addons: Object.freeze([
    Object.freeze({ id: "bar", name: "Hosted Bar", pricingType: "per_event", price: 450, staffRole: "bartender", active: true }),
    Object.freeze({ id: "service", name: "Table Service", pricingType: "per_person", price: 5, staffRole: "server", active: true })
  ]),
  rentals: Object.freeze([
    Object.freeze({ id: "linens", name: "Table Linens", pricingType: "per_item", price: 12, active: true })
  ]),
  upsellRules: Object.freeze([
    Object.freeze({
      id: "bar-review",
      name: "Hosted bar review",
      kind: "addon",
      targetId: "bar",
      enabled: true,
      minGuests: 50,
      minHours: 4,
      reason: "The tenant bar-review threshold matches this event."
    })
  ])
});

const MODEL = buildAmbientSelectionObjects(QUOTE, {
  source: "saved-record",
  role: "sales",
  ordinaryEditAllowed: true,
  catalogEvidence: EVIDENCE
});
const ACTIONS = Object.freeze(Object.fromEntries(MODEL.objects.map((item) => [
  item.id,
  Object.freeze({
    reduce: Object.freeze({ id: item.actionIds.reduce }),
    increase: Object.freeze({ id: item.actionIds.increase }),
    keep: Object.freeze({ id: item.actionIds.keep }),
    undo: Object.freeze({ id: item.actionIds.undo })
  })
])));

let container;
let root;

function pointerEvent(type, { clientX, clientY, pointerId = 1 }) {
  const event = new Event(type, { bubbles: true, cancelable: true });
  Object.defineProperties(event, {
    clientX: { value: clientX },
    clientY: { value: clientY },
    pointerId: { value: pointerId }
  });
  return event;
}

beforeEach(() => {
  container = document.createElement("div");
  document.body.appendChild(container);
  root = createRoot(container);
});

afterEach(() => {
  act(() => root.unmount());
  container.remove();
});

describe("AmbientSelectionObjects", () => {
  test("renders populated judgment context and visible button alternatives", () => {
    const onAdjust = vi.fn();
    const onKeep = vi.fn();
    act(() => {
      root.render(
        <AmbientSelectionObjects
          groups={MODEL.groups}
          actions={ACTIONS}
          onAdjust={onAdjust}
          onKeep={onKeep}
        />
      );
    });

    expect(container.querySelectorAll("[data-intelligent-selection-object]")).toHaveLength(3);
    expect(container.textContent).toContain("Rentals");
    expect(container.textContent).toContain("Bar");
    expect(container.textContent).toContain("Services");
    expect(container.textContent).toContain("What this connects to");
    expect(container.textContent).toContain("If you do nothing");
    expect(container.textContent).toContain("Confidence: high");
    expect(container.textContent).toContain("Sources:");
    expect(container.textContent).toContain("Why this is recommended");
    expect(container.textContent).not.toContain("Why Pilot thinks this fits");
    expect(container.textContent).toContain("Swipe left to reduce or remove");

    const increase = container.querySelector('[aria-label="Increase Table Linens preview quantity"]');
    expect(increase).not.toBeNull();
    expect(increase.dataset.ambientActionId).toContain("increase-selection-rental");
    act(() => increase.click());
    expect(onAdjust).toHaveBeenCalledWith(
      expect.objectContaining({ label: "Table Linens", kind: "rental" }),
      "increase",
      "button"
    );

    const keep = [...container.querySelectorAll("button")].find((item) => (
      item.textContent.includes("Keep current selection")
    ));
    expect(keep).toBeDefined();
    act(() => keep.click());
    expect(onKeep).toHaveBeenCalledWith(expect.objectContaining({ label: "Hosted Bar" }));
  });

  test("maps a horizontal swipe to the same bounded adjustment callback", () => {
    const onAdjust = vi.fn();
    act(() => {
      root.render(
        <AmbientSelectionObjects
          groups={MODEL.groups}
          actions={ACTIONS}
          onAdjust={onAdjust}
        />
      );
    });

    const service = container.querySelector('[data-selection-kind="service"]');
    expect(service).not.toBeNull();
    act(() => {
      service.dispatchEvent(pointerEvent("pointerdown", { clientX: 120, clientY: 20 }));
      service.dispatchEvent(pointerEvent("pointerup", { clientX: 50, clientY: 22 }));
    });

    expect(onAdjust).toHaveBeenCalledWith(
      expect.objectContaining({ label: "Table Service", kind: "service" }),
      "reduce",
      "swipe"
    );
  });

  test("shows changed local state while preserving the saved quantity", () => {
    const rental = MODEL.objects.find((item) => item.kind === "rental");
    act(() => {
      root.render(
        <AmbientSelectionObjects
          groups={MODEL.groups}
          scenario={{ [rental.id]: 11 }}
          actions={ACTIONS}
        />
      );
    });

    const card = container.querySelector(`[data-intelligent-selection-object="${rental.id}"]`);
    expect(card.dataset.scenarioState).toBe("changed");
    expect(card.dataset.currentQuantity).toBe("11");
    expect(card.textContent).toContain("11 units in unsaved preview");
    expect(card.textContent).toContain("Saved: 10 units selected");
    expect(card.textContent).not.toContain("local scenario");
  });
});
