import React from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, test } from "vitest";
import QuoteCompareModal from "../QuoteCompareModal";

const settings = {
  perMileRate: 0.7,
  longDistancePerMileRate: 1.1,
  deliveryThresholdMiles: 30,
  serverRate: 22,
  chefRate: 28,
  bartenderRate: 30,
  serverCostRate: 16,
  chefCostRate: 20,
  bartenderCostRate: 22,
  targetMarginPct: 0.3,
  serviceFeePct: 0.2,
  serviceFeeTiers: [{ id: "small", minGuests: 0, maxGuests: 9999, pct: 0.2 }],
  taxRate: 0.1,
  taxRegions: [{ id: "local", name: "Local", rate: 0.1 }],
  defaultTaxRegion: "local",
  depositPct: 0.3,
  seasonalProfiles: [{
    id: "standard", name: "Standard",
    startMonth: 1, startDay: 1, endMonth: 12, endDay: 31,
    packageMultiplier: 1, addonMultiplier: 1, rentalMultiplier: 1
  }]
};

const catalog = {
  packages: [
    { id: "classic", name: "Classic", ppp: 20, costPpp: 8 },
    { id: "premium", name: "Premium", ppp: 35, costPpp: 14 }
  ],
  addons: [],
  rentals: [],
  settings
};

const form = {
  pkg: "classic",
  guests: 100,
  hours: 6,
  servers: 0,
  chefs: 0,
  bartenders: 0,
  addons: [],
  rentals: [],
  menuItems: [],
  addonQuantities: {},
  rentalQuantities: {},
  menuItemQuantities: {},
  milesRT: 0,
  date: "2026-03-15",
  style: "Buffet",
  payMethod: "card"
};

describe("QuoteCompareModal margin (flag default off)", () => {
  test("never shows margin figures or the Margin comparison row while the pilot flag is off, even with full cost data recorded", () => {
    const markup = renderToStaticMarkup(
      <QuoteCompareModal
        open
        onClose={() => {}}
        form={form}
        setForm={() => {}}
        catalog={catalog}
        settings={settings}
        styles={["Buffet", "Plated"]}
        primaryTotals={{ total: 5000, servers: 0, chefs: 0 }}
      />
    );
    expect(markup).not.toContain("margin");
    expect(markup).not.toContain("Margin");
    expect(markup).toContain("Scenario Compare");
    expect(markup).toContain("Good");
    expect(markup).toContain("Better");
    expect(markup).toContain("Best");
  });

  test("uses selects only for multi-option comparison sets", () => {
    const markup = renderToStaticMarkup(
      <QuoteCompareModal
        open
        onClose={() => {}}
        form={form}
        setForm={() => {}}
        catalog={catalog}
        settings={settings}
        styles={["Buffet", "Plated"]}
        primaryTotals={{ total: 5000, servers: 0, chefs: 0 }}
      />
    );

    expect(markup).toContain('id="compare-package"');
    expect(markup).toContain('id="compare-service-style"');
    expect(markup).toContain('data-adaptive-choice-value="local"');
    expect(markup).not.toContain('id="compare-tax-region"');
    expect(markup).toContain('id="compare-season-profile"');
  });

  test("blocks empty comparison sets and keeps stale values visible", () => {
    const emptyCatalog = { ...catalog, packages: [] };
    const staleForm = { ...form, pkg: "retired", style: "Family", taxRegion: "retired-tax" };
    const emptySettings = { ...settings, taxRegions: [] };
    const markup = renderToStaticMarkup(
      <QuoteCompareModal
        open
        onClose={() => {}}
        form={staleForm}
        setForm={() => {}}
        catalog={emptyCatalog}
        settings={emptySettings}
        styles={[]}
        primaryTotals={{ total: 5000, servers: 0, chefs: 0 }}
      />
    );

    expect(markup).toContain("no longer available in the catalog");
    expect(markup).toContain("no longer available");
    expect(markup).toContain("no longer configured");
    expect(markup).toContain("retired");
    expect(markup).toContain("Family");
    expect(markup).toContain("retired-tax");
    expect(markup).toContain("Return to quote");
    expect(markup).not.toContain('id="compare-package"');
    expect(markup).not.toContain('id="compare-service-style"');
    expect(markup).not.toContain('id="compare-tax-region"');
  });
});
