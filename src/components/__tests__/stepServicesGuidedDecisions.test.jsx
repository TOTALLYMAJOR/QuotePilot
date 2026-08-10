import React from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, test } from "vitest";
import { StepServices } from "../WizardSteps";

const catalog = {
  packages: [{ id: "classic", name: "Classic", ppp: 18 }],
  addons: [{ id: "dessert", name: "Dessert Bites", type: "per_person", price: 4 }],
  rentals: [{ id: "linens", name: "Linens", price: 9, qtyPerGuests: 8 }],
  settings: { menuSections: [] }
};

const form = {
  pkg: "classic",
  addons: [],
  rentals: [],
  menuItems: [],
  addonQuantities: {},
  rentalQuantities: {},
  guests: 120,
  hours: 6
};

const recommendations = [{
  key: "rule-1-addon-dessert",
  kind: "addon",
  id: "dessert",
  label: "Add Dessert Bites",
  reason: "Dessert upgrades are popular for events with 40+ guests.",
  impact: "~$480.00 impact"
}];

function renderStep(props = {}) {
  return renderToStaticMarkup(
    <StepServices
      form={form}
      setForm={() => {}}
      catalog={catalog}
      recommendations={recommendations}
      onApplyRecommendation={() => {}}
      {...props}
    />
  );
}

describe("StepServices pilot guided-selling decide cards", () => {
  test("keeps the existing recommendation panel while the flag is off", () => {
    const markup = renderStep({ pilotGuidedSelling: false });
    expect(markup).toContain("recommendation-card");
    expect(markup).toContain(">Apply<");
    expect(markup).not.toContain("data-guided-selling");
  });

  test("renders decision-grammar cards with Take it and Why? when the flag is on", () => {
    const markup = renderStep({ pilotGuidedSelling: true });
    expect(markup).toContain('data-guided-selling="guided-selling-cards-v1"');
    expect(markup).toContain("Add Dessert Bites");
    expect(markup).toContain("Based on: ");
    expect(markup).toContain("~$480.00 impact");
    expect(markup).toContain(">Take it<");
    expect(markup).toContain(">Why?<");
    expect(markup).toContain("Taking one updates this draft only");
    expect(markup).not.toContain("recommendation-card");
  });

  test("shows a disabled Auto action when autopilot owns application", () => {
    const markup = renderStep({ pilotGuidedSelling: true, aiAutopilotEnabled: true });
    expect(markup).toContain(">Auto<");
    expect(markup).toContain("disabled");
  });
});
