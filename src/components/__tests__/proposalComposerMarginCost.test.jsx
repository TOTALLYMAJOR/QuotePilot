import React from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { afterEach, describe, expect, test, vi } from "vitest";

afterEach(() => {
  vi.unstubAllEnvs();
  vi.resetModules();
});

async function loadComposerWithMarginGate() {
  vi.resetModules();
  vi.stubEnv("VITE_PILOT_MARGINS_ENABLED", "true");
  const mod = await import("../ProposalComposer");
  return mod.default;
}

function baseProps() {
  const settings = {
    documentFontScale: "large",
    brandName: "Acme Events",
    brandLogoUrl: "",
    serverCostRate: 16,
    chefCostRate: 20,
    bartenderCostRate: 18,
    targetMarginPct: 0.4,
    staffingLaborEnabled: true,
    staffingChargeMode: "per_hour",
    taxRegions: [{ id: "local", name: "Local", rate: 0.1 }],
    seasonalProfiles: []
  };
  const catalog = {
    packages: [{ id: "premium", name: "Premium", ppp: 50, costPpp: 20, active: true }],
    addons: [{ id: "bar", name: "Premium Bar", type: "per_person", price: 15, cost: 6, active: true }],
    rentals: [{ id: "linens", name: "Linens", pricingType: "per_item", price: 9, qtyPerGuests: 10, cost: 3, active: true }],
    settings: {
      ...settings,
      menuSections: [{
        id: "dinner",
        name: "Dinner",
        items: [{ id: "salad", name: "Garden salad", pricingType: "per_person", price: 5, cost: 2, active: true }]
      }]
    }
  };
  const form = {
    eventName: "Spring Gala",
    eventTypeId: "gala",
    date: "2026-04-20",
    time: "18:00",
    hours: 4,
    guests: 50,
    venue: "Pine Hall",
    name: "Jordan Lee",
    email: "jordan@example.com",
    pkg: "premium",
    style: "Plated",
    servers: 3,
    chefs: 1,
    bartenders: 1,
    addons: ["bar"],
    rentals: ["linens"],
    menuItems: ["salad"],
    rentalQuantities: { linens: 5 },
    payMethod: "card",
    taxRegion: "local",
    seasonProfileId: "auto"
  };
  return {
    form,
    totals: {
      guests: 50,
      base: 2500,
      addons: 750,
      rentals: 45,
      menu: 250,
      labor: 600,
      serviceFee: 414.5,
      tax: 0,
      travel: 0,
      total: 4559.5,
      deposit: 1367.85
    },
    catalog,
    settings,
    menuSections: catalog.settings.menuSections,
    eventTypes: [{ id: "gala", name: "Gala" }],
    eventTemplates: [{ id: "gala-template", name: "Gala template" }],
    readiness: null,
    onFieldChange: vi.fn(),
    onSelectionTouched: vi.fn(),
    onPatchForm: vi.fn(),
    onTemplateChange: vi.fn(),
    onEventTypeChange: vi.fn(),
    onGuidedMode: vi.fn(),
    onOpenCatalogPricing: vi.fn()
  };
}

describe("ProposalComposer staff cost and margin", () => {
  test("renders recorded cost and margin in Quote Pulse as staff-only context", async () => {
    const ProposalComposer = await loadComposerWithMarginGate();
    const html = renderToStaticMarkup(<ProposalComposer {...baseProps()} />);

    expect(html).toContain("Cost &amp; margin");
    expect(html).toContain("Staff-only");
    expect(html).toContain("Recorded cost");
    expect(html).toContain("Margin");
    expect(html).toContain("Meets your 40% target.");
    expect(html).toContain("Proposal polish");
    expect(html).toContain("Large proposal text");
  });

  test("renders one available choice as static context and many as selects", async () => {
    const ProposalComposer = await loadComposerWithMarginGate();
    const html = renderToStaticMarkup(<ProposalComposer {...baseProps()} />);

    expect(html).toContain('id="proposal-event-type-label"');
    expect(html).toContain('data-adaptive-choice-value="gala"');
    expect(html).not.toContain('id="proposal-event-type"');
    expect(html).toContain('id="proposal-event-template"');
    expect(html).toContain('data-adaptive-choice-value="local"');
    expect(html).toContain('data-adaptive-choice-value="auto"');
  });

  test("blocks empty authoritative sets while preserving stale draft values", async () => {
    const ProposalComposer = await loadComposerWithMarginGate();
    const props = baseProps();
    const html = renderToStaticMarkup(
      <ProposalComposer
        {...props}
        eventTypes={[]}
        settings={{ ...props.settings, taxRegions: [] }}
      />
    );

    expect(html).toContain("The saved event type");
    expect(html).toContain("The saved tax region");
    expect(html).toContain("Open Library setup");
    expect(html).not.toContain('id="proposal-event-type"');
    expect(html).not.toContain('id="proposal-tax-region"');
  });
});
