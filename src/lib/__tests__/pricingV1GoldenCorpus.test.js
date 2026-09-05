import { createHash } from "node:crypto";
import { describe, expect, test } from "vitest";
import { calculateQuote } from "../quoteCalculator";

const FAMILY_NAMES = Object.freeze([
  "package",
  "addon",
  "rental",
  "menu",
  "staffing",
  "travel",
  "fees-tax-deposit",
  "seasonality"
]);

const baseCatalog = Object.freeze({
  packages: [{ id: "classic", name: "Classic", ppp: 18, active: true }],
  addons: [{ id: "dessert", name: "Dessert", price: 3.25, pricingType: "per_person", active: true }],
  rentals: [{ id: "linen", name: "Linen", price: 2.4, pricingType: "per_item", qtyPerGuests: 8, active: true }]
});

const baseSettings = Object.freeze({
  staffingLaborEnabled: true,
  staffingChargeMode: "per_hour",
  serverRate: 22,
  chefRate: 28,
  bartenderRate: 30,
  perMileRate: 0.7,
  longDistancePerMileRate: 1.1,
  deliveryThresholdMiles: 30,
  serviceFeePct: 0.2,
  serviceFeeTiers: [],
  taxRate: 0.1,
  taxRegions: [{ id: "local", name: "Local", rate: 0.1 }],
  defaultTaxRegion: "local",
  depositPct: 0.3,
  seasonalProfiles: [{
    id: "standard",
    name: "Standard",
    startMonth: 1,
    startDay: 1,
    endMonth: 12,
    endDay: 31,
    packageMultiplier: 1,
    addonMultiplier: 1,
    rentalMultiplier: 1
  }],
  defaultSeasonProfile: "auto",
  menuSections: [{
    id: "desserts",
    name: "Desserts",
    items: [{ id: "cake", name: "Cake", price: 42.5, pricingType: "per_event", active: true }]
  }]
});

function caseFor(family, index) {
  const guests = [0, 1, 2, 9, 25, 40, 99, 100, 250, 401][index];
  const form = {
    pkg: "classic",
    guests,
    hours: family === "staffing" ? 4.5 : 0,
    servers: family === "staffing" ? 2 : 0,
    chefs: family === "staffing" ? 1 : 0,
    bartenders: family === "staffing" ? 1 : 0,
    milesRT: family === "travel" ? index * 9.25 : 0,
    addons: family === "addon" ? ["dessert"] : [],
    rentals: family === "rental" ? ["linen"] : [],
    rentalQuantities: family === "rental" ? { linen: index + 1 } : {},
    menuItems: family === "menu" ? ["cake"] : [],
    taxRegion: "local",
    seasonProfileId: "auto",
    date: `2026-${String(index + 1).padStart(2, "0")}-15`
  };
  const settings = {
    ...baseSettings,
    serviceFeePct: family === "fees-tax-deposit" ? 0.175 : 0,
    taxRegions: [{ id: "local", name: "Local", rate: family === "fees-tax-deposit" ? 0.0825 : 0 }],
    depositPct: family === "fees-tax-deposit" ? 0.35 : 0,
    seasonalProfiles: family === "seasonality"
      ? [
          baseSettings.seasonalProfiles[0],
          {
            id: "summer",
            name: "Summer",
            startMonth: 5,
            startDay: 1,
            endMonth: 9,
            endDay: 30,
            packageMultiplier: 1.075,
            addonMultiplier: 1.05,
            rentalMultiplier: 1.025
          }
        ]
      : baseSettings.seasonalProfiles
  };
  return { name: `${family}-${String(index + 1).padStart(2, "0")}`, family, form, settings };
}

function projection(result) {
  return {
    guests: result.guests,
    base: result.base,
    addons: result.addons,
    rentals: result.rentals,
    menu: result.menu,
    labor: result.labor,
    travel: result.travel,
    serviceFee: result.serviceFee,
    tax: result.tax,
    total: result.total,
    deposit: result.deposit,
    serviceFeePctApplied: result.serviceFeePctApplied,
    taxRateApplied: result.taxRateApplied,
    seasonProfileId: result.seasonProfileId,
    packageMultiplier: result.packageMultiplier,
    addonMultiplier: result.addonMultiplier,
    rentalMultiplier: result.rentalMultiplier
  };
}

describe("pricing-v1 Golden Pricing Corpus", () => {
  test("freezes 80 named cases before pricing-v2 semantics", () => {
    const corpus = FAMILY_NAMES.flatMap((family) => (
      Array.from({ length: 10 }, (_, index) => caseFor(family, index))
    ));
    const observed = corpus.map((entry) => ({
      name: entry.name,
      family: entry.family,
      result: projection(calculateQuote(entry.form, baseCatalog, entry.settings))
    }));
    const digest = createHash("sha256").update(JSON.stringify(observed)).digest("hex");

    expect(corpus).toHaveLength(80);
    expect(new Set(corpus.map((entry) => entry.name)).size).toBe(80);
    expect(new Set(corpus.map((entry) => entry.family))).toEqual(new Set(FAMILY_NAMES));
    expect(digest).toBe("4c4daaa42f7dcc3f7fcf8100cf70c955cd1826831f6bd6604c5861abedcc4263");
  });
});
