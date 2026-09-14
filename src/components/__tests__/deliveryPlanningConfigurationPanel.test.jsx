// @vitest-environment jsdom
import React from "react";
import { createRoot } from "react-dom/client";
import { act } from "react";
import { afterEach, beforeEach, describe, expect, test, vi } from "vitest";
import DeliveryPlanningConfigurationPanel from "../DeliveryPlanningConfigurationPanel";

globalThis.IS_REACT_ACT_ENVIRONMENT = true;

function fixture({ bound = true, enabled = false } = {}) {
  const declared = {
    publicationState: "published",
    declaredBy: "operator-42",
    declaredAtISO: "2026-09-14T12:00:00.000Z",
    provenance: "Operator-reviewed staffed-buffet pilot"
  };
  const deliveryBlueprints = [{
    schemaVersion: "delivery-blueprint-v1",
    id: "staffed-buffet",
    revision: "1",
    label: "Staffed buffet",
    ...declared,
    compatibleServiceFormats: ["Buffet"],
    workBlocks: [{
      id: "kitchen-prep",
      label: "Kitchen prep",
      timing: { anchor: "service_start", offsetMinutes: -180, durationMinutes: 120 },
      requiredCapabilities: ["kitchen-prep"]
    }],
    productionComponents: [{
      componentId: "roasted-chicken",
      label: "Roasted chicken",
      required: true,
      quantityPolicyRef: { id: "chicken-portions", revision: "3" }
    }]
  }];
  const quantityPolicies = [{
    schemaVersion: "quantity-policy-v1",
    id: "chicken-portions",
    revision: "3",
    ...declared,
    input: { kind: "guest_count", minimumGuestCount: 10, maximumGuestCount: 300 },
    output: { unitId: "portion", numerator: 6, denominator: 5, rounding: "ceil" },
    ingredients: [{
      ingredientId: "chicken-breast",
      unitId: "lb",
      quantityPerOutputMicros: 100_000,
      purchasingPackRef: { id: "chicken-case", revision: "2" }
    }]
  }];
  const purchasingPacks = [{
    id: "chicken-case",
    revision: "2",
    publicationState: "published",
    unitId: "lb",
    quantityMicros: 5_000_000
  }];
  return {
    catalog: {
      packages: [{
        id: "buffet-offer",
        name: "Staffed buffet",
        active: true,
        deliveryBlueprintRef: bound ? { id: "staffed-buffet", revision: "1" } : null
      }],
      settings: {
        deliveryPlanningEnabled: enabled,
        deliveryBlueprints,
        quantityPolicies,
        purchasingPacks,
        menuSections: [{
          id: "mains",
          items: [{ id: "roasted-chicken", name: "Roasted chicken" }]
        }]
      }
    },
    jsonDrafts: {
      deliveryBlueprints: JSON.stringify(deliveryBlueprints, null, 2),
      quantityPolicies: JSON.stringify(quantityPolicies, null, 2),
      purchasingPacks: JSON.stringify(purchasingPacks, null, 2)
    }
  };
}

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

function renderPanel(overrides = {}) {
  const input = fixture(overrides.fixture);
  const props = {
    ...input,
    onPatchJson: vi.fn(),
    onPatchSetting: vi.fn(),
    onPatchPackageField: vi.fn(),
    ...overrides.props
  };
  act(() => root.render(<DeliveryPlanningConfigurationPanel {...props} />));
  return props;
}

function clickButton(label) {
  const button = [...container.querySelectorAll("button")]
    .find((candidate) => candidate.textContent.trim() === label);
  expect(button, label).toBeTruthy();
  act(() => button.dispatchEvent(new MouseEvent("click", { bubbles: true })));
}

describe("DeliveryPlanningConfigurationPanel", () => {
  test("keeps activation blocked and offers source recovery when no reviewed Blueprint is available", () => {
    const input = fixture({ bound: false });
    input.catalog.settings.deliveryBlueprints = [];
    input.jsonDrafts.deliveryBlueprints = "[]";
    act(() => root.render(
      <DeliveryPlanningConfigurationPanel
        {...input}
        onPatchJson={() => {}}
        onPatchSetting={() => {}}
        onPatchPackageField={() => {}}
      />
    ));

    const panel = container.querySelector('[data-testid="delivery-planning-configuration"]');
    expect(panel.dataset.capabilityState).toBe("blocked");
    expect(panel.textContent).toContain("Needs configuration");
    expect(panel.textContent).toContain("No published Blueprint currently passes");
    expect(panel.textContent).toContain("QuotePilot will not infer them");
    expect(container.querySelector('input[type="checkbox"]').disabled).toBe(true);
  });

  test("binds the sole exact Blueprint revision to the selected Offer", () => {
    const props = renderPanel({ fixture: { bound: false } });

    clickButton("Bind Blueprint to Offer");
    expect(props.onPatchPackageField).toHaveBeenCalledWith(
      "buffet-offer",
      "deliveryBlueprintRef",
      { id: "staffed-buffet", revision: "1" }
    );
  });

  test("routes missing Offer recovery back to the owning Library section", () => {
    const input = fixture({ bound: false });
    input.catalog.packages[0].active = false;
    const onReviewOffers = vi.fn();
    act(() => root.render(
      <DeliveryPlanningConfigurationPanel
        {...input}
        onPatchJson={() => {}}
        onPatchSetting={() => {}}
        onPatchPackageField={() => {}}
        onReviewOffers={onReviewOffers}
      />
    ));

    clickButton("Review Offers");
    expect(onReviewOffers).toHaveBeenCalledOnce();
  });

  test("lets a fully bound draft enable Delivery Planning without claiming persistence", () => {
    const props = renderPanel();
    const checkbox = container.querySelector('input[type="checkbox"]');
    expect(checkbox.disabled).toBe(false);
    expect(container.textContent).toContain("Ready to enable");
    expect(container.textContent).toContain("No new quote receives a Delivery Proposal yet");

    act(() => checkbox.dispatchEvent(new MouseEvent("click", { bubbles: true })));
    expect(props.onPatchSetting).toHaveBeenCalledWith("deliveryPlanningEnabled", true);
  });

  test("keeps all operator-authored source fields visible behind one disclosure", () => {
    renderPanel();
    for (const label of [
      "Delivery Blueprints JSON",
      "Quantity Policies JSON",
      "Purchasing Packs JSON"
    ]) {
      expect(container.querySelector(`textarea[aria-label="${label}"]`)).toBeTruthy();
    }
    expect(container.querySelector('[data-field-state-surface="delivery-planning-configuration"]')).toBeTruthy();
  });
});
