import React from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, test } from "vitest";
import LiveBreakdown from "../LiveBreakdown";
import { calculateQuote } from "../../lib/quoteCalculator";

const settings = {
  perMileRate: 0.7,
  longDistancePerMileRate: 1.1,
  deliveryThresholdMiles: 30,
  serverRate: 22,
  chefRate: 28,
  bartenderRate: 30,
  serviceFeePct: 0.2,
  serviceFeeTiers: [
    { id: "small", minGuests: 0, maxGuests: 99, pct: 0.2 },
    { id: "large", minGuests: 100, maxGuests: 9999, pct: 0.18 }
  ],
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
  packages: [{ id: "classic", name: "Classic", ppp: 20 }],
  addons: [],
  rentals: [],
  settings
};

const form = {
  pkg: "classic",
  guests: 115,
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
  style: "Buffet"
};

function render(guestBand) {
  const totals = calculateQuote(form, catalog, settings);
  return renderToStaticMarkup(
    <LiveBreakdown
      form={form}
      totals={totals}
      settings={settings}
      catalog={catalog}
      guestBand={guestBand}
    />
  );
}

describe("LiveBreakdown band strip", () => {
  test("shows the estimated and deposit ranges with the exactness promise when a band exists", () => {
    const markup = render({ kind: "range", min: 100, max: 130, appliedValue: 115, source: "100 to 130 guests" });
    expect(markup).toContain('data-pricing-band="pricing-band-v1"');
    expect(markup).toContain("Estimated range");
    expect(markup).toContain("Deposit range");
    expect(markup).toContain("Saving always prices the exact recorded count.");
    expect(markup).toContain("100–130 guest range");
  });

  test("renders no band strip without a band", () => {
    const markup = render(null);
    expect(markup).not.toContain("data-pricing-band");
    expect(markup).not.toContain("Estimated range");
  });

  test("never shows a margin range while the margin pilot flag is off, even with recorded costs", () => {
    const costedCatalog = {
      ...catalog,
      packages: [{ id: "classic", name: "Classic", ppp: 20, costPpp: 8 }]
    };
    const totals = calculateQuote(form, costedCatalog, settings);
    const markup = renderToStaticMarkup(
      <LiveBreakdown
        form={form}
        totals={totals}
        settings={settings}
        catalog={costedCatalog}
        guestBand={{ kind: "range", min: 100, max: 130, appliedValue: 115, source: "100 to 130 guests" }}
      />
    );
    expect(markup).not.toContain("Margin range");
  });
});
