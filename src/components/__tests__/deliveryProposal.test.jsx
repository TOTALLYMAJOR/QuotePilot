// @vitest-environment jsdom

import React, { act } from "react";
import { createRoot } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, test, vi } from "vitest";
import DeliveryProposal from "../DeliveryProposal";

globalThis.IS_REACT_ACT_ENVIRONMENT = true;

function props(overrides = {}) {
  const blueprint = {
    schemaVersion: "delivery-blueprint-v1",
    id: "staffed-buffet",
    revision: "7",
    label: "Staffed buffet",
    publicationState: "published",
    declaredBy: "operator-42",
    declaredAtISO: "2026-09-01T14:00:00.000Z",
    provenance: "tenant-reviewed pilot",
    compatibleServiceFormats: ["Buffet"],
    workBlocks: [{
      id: "prep",
      label: "Kitchen prep",
      timing: { anchor: "service_start", offsetMinutes: -180, durationMinutes: 120 },
      requiredCapabilities: ["kitchen-prep"]
    }],
    productionComponents: [{
      componentId: "chicken",
      label: "Roasted chicken",
      required: true,
      quantityPolicyRef: "chicken-portions"
    }, {
      componentId: "tea",
      label: "Sweet tea",
      required: false,
      quantityPolicyRef: "tea-servings"
    }]
  };
  const settings = {
    catalogRevision: 12,
    deliveryPlanningEnabled: true,
    deliveryBlueprints: [blueprint],
    quantityPolicies: [
      {
        schemaVersion: "quantity-policy-v1",
        id: "chicken-portions",
        revision: "4",
        publicationState: "published",
        declaredBy: "operator-42",
        declaredAtISO: "2026-09-01T14:00:00.000Z",
        provenance: "tenant production review",
        input: { kind: "guest_count", minimumGuestCount: 10, maximumGuestCount: 250 },
        output: { unitId: "portion", numerator: 6, denominator: 5, rounding: "ceil" },
        ingredients: [{
          ingredientId: "chicken-breast",
          label: "Chicken breast",
          unitId: "lb",
          quantityPerOutputMicros: 100_000,
          purchasingPackRef: "chicken-case"
        }]
      },
      {
        schemaVersion: "quantity-policy-v1",
        id: "tea-servings",
        revision: "1",
        publicationState: "published",
        declaredBy: "operator-42",
        declaredAtISO: "2026-09-01T14:00:00.000Z",
        provenance: "tenant beverage review",
        input: { kind: "guest_count", minimumGuestCount: 10, maximumGuestCount: 250 },
        output: { unitId: "serving", numerator: 1, denominator: 1, rounding: "ceil" },
        ingredients: []
      }
    ],
    purchasingPacks: [{
      id: "chicken-case",
      revision: "1",
      publicationState: "published",
      unitId: "lb",
      quantityMicros: 5_000_000
    }],
    menuSections: [{
      id: "mains",
      items: [{ id: "chicken", name: "Roasted chicken" }, { id: "tea", name: "Sweet tea" }]
    }]
  };
  return {
    form: { pkg: "premium", style: "Buffet", guests: 50, menuItems: ["chicken", "tea"] },
    catalog: {
      packages: [{
        id: "premium",
        deliveryBlueprintRef: { id: "staffed-buffet", revision: "7" }
      }],
      settings
    },
    settings,
    operatorId: "operator-42",
    ...overrides
  };
}

function buttonByText(container, label) {
  return [...container.querySelectorAll("button")].find((button) => button.textContent.trim() === label);
}

function setInputValue(input, value) {
  const setter = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, "value").set;
  setter.call(input, value);
  input.dispatchEvent(new Event("input", { bubbles: true }));
}

describe("DeliveryProposal", () => {
  let container;
  let root;

  beforeEach(() => {
    container = document.createElement("div");
    document.body.appendChild(container);
    root = createRoot(container);
  });

  afterEach(() => {
    act(() => root.unmount());
    container.remove();
  });

  test("shows a progressive, session-only staffed-buffet proposal with independent evidence axes", () => {
    act(() => root.render(<DeliveryProposal {...props()} />));

    const surface = container.querySelector('[data-testid="delivery-proposal"]');
    expect(surface).not.toBeNull();
    expect(surface.getAttribute("data-delivery-proposal-state")).toBe("proposed");
    expect(surface.getAttribute("data-capability-state")).toBe("draft");
    expect(container.textContent).toContain("Proposed work assembled");
    expect(container.textContent).toContain("Kitchen prep");
    expect(container.textContent).toContain("60 portion");
    expect(container.textContent).toContain("6 lb");
    expect(container.textContent).toContain("Staffing");
    expect(container.textContent).toContain("Unchecked");
    expect(container.textContent).toContain("does not save or send the quote");
    expect(container.textContent).not.toContain("Ready to execute");
    expect(buttonByText(container, "Review staffing")).not.toBeNull();
    expect(buttonByText(container, "Review production")).not.toBeNull();
    expect(buttonByText(container, "Review purchasing")).not.toBeNull();
  });

  test("retains an operator override across a guest change and requires explicit conflict resolution", () => {
    const initial = props();
    act(() => root.render(<DeliveryProposal {...initial} />));
    act(() => buttonByText(container, "Adjust quantity").click());
    act(() => {
      setInputValue(container.querySelectorAll(".delivery-proposal__override-editor input")[0], "65");
    });
    act(() => {
      setInputValue(
        container.querySelectorAll(".delivery-proposal__override-editor input")[1],
        "Chef-approved tray yield"
      );
    });
    act(() => buttonByText(container, "Keep this quantity").click());

    act(() => root.render(
      <DeliveryProposal {...initial} form={{ ...initial.form, guests: 60 }} />
    ));

    expect(container.querySelector('[data-override-state="conflict"]')).not.toBeNull();
    expect(container.textContent).toContain("Generated 72 portion");
    expect(buttonByText(container, "Keep override")).not.toBeNull();
    expect(buttonByText(container, "Use generated")).not.toBeNull();

    act(() => buttonByText(container, "Use generated").click());
    expect(container.querySelector('[data-override-state="conflict"]')).toBeNull();
    expect(container.textContent).toContain("72 portion");
  });

  test("keeps a removed optional component removed until the operator restores it", () => {
    act(() => root.render(<DeliveryProposal {...props()} />));
    const removeButtons = [...container.querySelectorAll("button")]
      .filter((button) => button.textContent.trim() === "Remove optional");
    expect(removeButtons).toHaveLength(1);
    act(() => removeButtons[0].click());

    expect(container.textContent).toContain("Removed optional items");
    expect(container.textContent).toContain("Restore Sweet tea");
    expect(container.textContent).not.toContain("50 serving");

    act(() => buttonByText(container, "Restore Sweet tea").click());
    expect(container.textContent).toContain("50 serving");
  });

  test("emits an exact prefill-only handoff only after a saved revision exists", () => {
    const onHandoff = vi.fn();
    const input = props({
      editingQuote: { id: "quote-9", activeQuoteRevisionId: "quote-version-3" },
      onHandoff
    });
    act(() => root.render(<DeliveryProposal {...input} />));
    act(() => buttonByText(container, "Review production").click());

    expect(onHandoff).toHaveBeenCalledOnce();
    expect(onHandoff.mock.calls[0][0]).toMatchObject({
      schemaVersion: "delivery-handoff-v1",
      authority: "prefill_only",
      domain: "production",
      quoteId: "quote-9",
      quoteRevisionId: "quote-version-3",
      blueprintId: "staffed-buffet",
      blueprintRevision: "7"
    });
  });

  test("renders nothing when the tenant planning gate is off", () => {
    const input = props();
    input.settings.deliveryPlanningEnabled = false;
    act(() => root.render(<DeliveryProposal {...input} />));
    expect(container.innerHTML).toBe("");
  });
});
