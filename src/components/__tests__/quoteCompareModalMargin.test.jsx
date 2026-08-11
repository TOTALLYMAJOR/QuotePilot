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
});
