import React from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, test } from "vitest";
import { StepEvent, StepServices } from "../WizardSteps";

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

function renderEventStep({ eventTypes, eventTypeId = "", settings = {}, styles = [] }) {
  return renderToStaticMarkup(
    <StepEvent
      form={{
        eventTypeId,
        date: "",
        time: "",
        hours: 4,
        guests: 0,
        servers: 0,
        chefs: 0,
        bartenders: 0,
        includeDisposables: false
      }}
      setForm={() => {}}
      styles={styles}
      settings={settings}
      eventTypes={eventTypes}
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

  test("renders the only package as confirmed read-only instead of a false select", () => {
    const markup = renderStep();

    expect(markup).toContain('data-choice-field="package-tier"');
    expect(markup).toContain('data-adaptive-choice-mode="single"');
    expect(markup).toContain('data-field-state-primary="confirmed"');
    expect(markup).not.toContain('data-ambient-field="pkg"');
  });

  test("keeps a real package select only when multiple active offers exist", () => {
    const markup = renderStep({
      catalog: {
        ...catalog,
        packages: [
          catalog.packages[0],
          { id: "deluxe", name: "Deluxe", ppp: 32 }
        ]
      }
    });

    expect(markup).toContain('data-ambient-field="pkg"');
    expect(markup).toContain('data-choice-control="package-tier"');
  });

  test("explains why package selection is unavailable when no active offers exist", () => {
    const markup = renderStep({ catalog: { ...catalog, packages: [] } });

    expect(markup).toContain('data-choice-field="package-tier"');
    expect(markup).toContain('data-field-state-primary="unknown"');
    expect(markup).toContain("must publish a current offer");
    expect(markup).not.toContain('data-choice-control="package-tier"');
  });

  test("adapts event type selection across zero, one, and multiple choices", () => {
    const emptyMarkup = renderEventStep({ eventTypes: [] });
    const singleMarkup = renderEventStep({
      eventTypes: [{ id: "wedding", name: "Wedding" }],
      eventTypeId: "wedding"
    });
    const multipleMarkup = renderEventStep({
      eventTypes: [
        { id: "wedding", name: "Wedding" },
        { id: "corporate", name: "Corporate" }
      ],
      eventTypeId: "wedding"
    });

    expect(emptyMarkup).toContain('data-field-state-primary="not_provided"');
    expect(emptyMarkup).toContain("No event types are published");
    expect(singleMarkup).toContain('data-adaptive-choice-mode="single"');
    expect(singleMarkup).not.toContain('data-choice-control="event-type"');
    expect(multipleMarkup).toContain('data-choice-control="event-type"');
  });

});
