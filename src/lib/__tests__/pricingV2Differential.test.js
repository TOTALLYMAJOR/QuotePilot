import { createRequire } from "node:module";
import { describe, expect, test } from "vitest";
import { calculatePricingV2 as calculateBrowserPreview } from "../pricingV2";

const require = createRequire(import.meta.url);
const { calculatePricingV2: calculateServerAuthoritative } = require("../../../functions/pricingV2Core.cjs");

function generator(seed = 0x51c2a9f3) {
  let state = seed >>> 0;
  return () => {
    state = ((state * 1664525) + 1013904223) >>> 0;
    return state / 0x100000000;
  };
}

function integer(next, minimum, maximum) {
  return minimum + Math.floor(next() * ((maximum - minimum) + 1));
}

function fixture(next, index) {
  const guests = integer(next, 1, 400);
  const packageMinor = integer(next, 1, 50_000);
  const addonMinor = integer(next, 0, 10_000);
  const rentalMinor = integer(next, 0, 20_000);
  const menuMinor = integer(next, 0, 15_000);
  const date = index % 3 === 0 ? "2026-06-15" : index % 3 === 1 ? "2026-12-15" : "2026-03-15";
  const form = {
    date,
    guests,
    hours: integer(next, 1, 12) / 2,
    servers: integer(next, 0, 8),
    chefs: integer(next, 0, 4),
    bartenders: integer(next, 0, 4),
    milesRT: integer(next, 0, 250) / 2,
    pkg: "offer",
    addons: index % 2 ? ["addon"] : [],
    rentals: index % 3 ? ["rental"] : [],
    menuItems: index % 5 ? ["menu"] : [],
    addonQuantities: { addon: integer(next, 1, 8) },
    rentalQuantities: { rental: integer(next, 1, 20) },
    menuItemQuantities: { menu: integer(next, 1, 6) }
  };
  const catalog = {
    packages: [{ id: "offer", name: "Offer", pppMinor: packageMinor, active: true }],
    addons: [{ id: "addon", name: "Addon", priceMinor: addonMinor, pricingType: index % 2 ? "per_person" : "per_event", active: true }],
    rentals: [{ id: "rental", name: "Rental", priceMinor: rentalMinor, pricingType: "per_item", qtyPerGuests: integer(next, 1, 25), active: true }],
    menuItems: [{ id: "menu", name: "Menu", priceMinor: menuMinor, pricingType: index % 2 ? "per_event" : "per_person", active: true }]
  };
  const settings = {
    serviceFeePct: integer(next, 0, 300_000) / 1_000_000,
    serviceFeeTiers: [
      { id: "small", minGuests: 0, maxGuests: 99, pct: 0.2 },
      { id: "large", minGuests: 100, maxGuests: 9999, pct: 0.16 }
    ],
    taxRate: 0,
    taxRegions: [{ id: "local", name: "Local", rate: integer(next, 0, 120_000) / 1_000_000 }],
    defaultTaxRegion: "local",
    depositPct: integer(next, 50_000, 900_000) / 1_000_000,
    seasonalProfiles: [
      { id: "standard", name: "Standard", startMonth: 1, startDay: 1, endMonth: 12, endDay: 31, packageMultiplier: 1, addonMultiplier: 1, rentalMultiplier: 1 },
      { id: "summer", name: "Summer", startMonth: 5, startDay: 1, endMonth: 9, endDay: 1, priority: 10, packageMultiplier: 1.04, addonMultiplier: 1.03, rentalMultiplier: 1.02 },
      { id: "holiday", name: "Holiday", startMonth: 11, startDay: 15, endMonth: 1, endDay: 7, priority: 20, packageMultiplier: 1.08, addonMultiplier: 1.05, rentalMultiplier: 1.04 }
    ],
    defaultSeasonProfile: "auto",
    staffingLaborEnabled: true,
    staffingChargeMode: index % 7 ? "per_hour" : "per_event_per_staff",
    serverRate: integer(next, 1_500, 7_500) / 100,
    chefRate: integer(next, 2_000, 10_000) / 100,
    bartenderRate: integer(next, 2_000, 8_000) / 100,
    perMileRateMinor: integer(next, 0, 300),
    longDistancePerMileRateMinor: integer(next, 0, 500),
    deliveryThresholdMiles: integer(next, 0, 100)
  };
  return { form, catalog, settings };
}

function exactProjection(pricing) {
  return {
    lines: pricing.lineItems.map((line) => [line.id, line.lineTotalMinor, line.adjustments]),
    waterfall: pricing.priceWaterfall,
    laborMinor: pricing.fees.laborMinor,
    travelMinor: pricing.fees.travelMinor,
    subtotalMinor: pricing.subtotalMinor,
    serviceFeeMinor: pricing.fees.serviceFeeMinor,
    taxMinor: pricing.tax.amountMinor,
    grandTotalMinor: pricing.grandTotalMinor,
    depositMinor: pricing.deposit.amountMinor,
    balanceMinor: pricing.balance.amountMinor,
    serviceFeePolicyId: pricing.rulesSnapshot.serviceFeePolicyId,
    taxRegionId: pricing.rulesSnapshot.taxRegionId,
    seasonProfileId: pricing.rulesSnapshot.seasonProfileId
  };
}

describe("pricing-v2 browser/server differential certification", () => {
  test("matches exact minor-unit and waterfall results for 5,000 fixed-seed valid cases", () => {
    const next = generator();
    for (let index = 0; index < 5_000; index += 1) {
      const input = fixture(next, index);
      const browser = calculateBrowserPreview({ ...input, authority: "client_preview" });
      const server = calculateServerAuthoritative({ ...input, authority: "server_authoritative" });
      expect(exactProjection(browser), `case ${index}`).toEqual(exactProjection(server));
    }
  }, 20_000);
});
