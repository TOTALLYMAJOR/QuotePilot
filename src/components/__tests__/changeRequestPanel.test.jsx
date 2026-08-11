import React from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, test } from "vitest";
import ChangeRequestPanel from "../ChangeRequestPanel";

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
  }],
  menuSections: [{
    id: "mains",
    name: "Mains",
    items: [
      { id: "salmon", name: "Grilled Salmon", price: 6, pricingType: "per_person" },
      { id: "chicken", name: "Herb Chicken", price: 4, pricingType: "per_person" }
    ]
  }]
};

const catalog = {
  packages: [{ id: "classic", name: "Classic", ppp: 20 }],
  addons: [
    { id: "coffee", name: "Coffee Station", type: "per_event", price: 95 },
    { id: "photo-booth", name: "Photo Booth Station", type: "per_event", price: 400 }
  ],
  rentals: [],
  settings
};

const form = {
  pkg: "classic",
  guests: 120,
  hours: 6,
  servers: 8,
  chefs: 3,
  bartenders: 2,
  addons: [],
  rentals: [],
  menuItems: ["salmon"],
  addonQuantities: {},
  rentalQuantities: {},
  menuItemQuantities: {},
  milesRT: 0,
  date: "2026-03-15",
  style: "Plated"
};

function render(message) {
  return renderToStaticMarkup(
    <ChangeRequestPanel
      message={message}
      submittedAtISO="2026-08-10T11:24:00Z"
      form={form}
      catalog={catalog}
      settings={settings}
      styles={["Buffet", "Plated", "Stations", "Drop-off"]}
      onStageProposal={() => {}}
    />
  );
}

describe("ChangeRequestPanel", () => {
  test("shows the verbatim message, a priced proposal card, and the versioning boundary", () => {
    const markup = render("Could we do chicken instead of the salmon? Also add a station.");
    expect(markup).toContain('data-change-request="change-request-parse-v1"');
    expect(markup).toContain("Could we do chicken instead of the salmon?");
    expect(markup).toContain("Swap Grilled Salmon → Herb Chicken");
    expect(markup).toContain("total after the fee and tax cascade");
    expect(markup).toContain("Stage this");
    expect(markup).toContain("saving creates the next version through the standard path");
    expect(markup).toContain("Which one did they mean?");
    expect(markup).toContain("Add Coffee Station");
    expect(markup).toContain("Add Photo Booth Station");
  });

  test("stays honest when nothing is stageable", () => {
    const markup = render("Thank you, everything looks wonderful!");
    expect(markup).toContain("Nothing stageable could be read");
    expect(markup).toContain("Nothing was changed");
    expect(markup).not.toContain("Stage this");
  });
});
