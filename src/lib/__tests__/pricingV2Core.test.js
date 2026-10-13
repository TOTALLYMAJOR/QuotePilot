import { describe, expect, test } from "vitest";
import {
  PRICING_V2_ROUNDING,
  PricingV2Error,
  calculatePricingV2,
  resolveSeasonProfileV2,
  validatePricingV2Policy
} from "../pricingV2";

function fixture(overrides = {}) {
  return {
    form: {
      pkg: "wedding",
      guests: 101,
      hours: 4.5,
      servers: 2,
      chefs: 1,
      bartenders: 1,
      milesRT: 42.5,
      addons: ["dessert", "bar"],
      rentals: ["linen"],
      rentalQuantities: { linen: 13 },
      menuItems: ["cake"],
      date: "2026-06-20",
      taxRegion: "local",
      seasonProfileId: "auto"
    },
    catalog: {
      packages: [{ id: "wedding", name: "Wedding", pppMinor: 1999, active: true, includedAddonIds: ["bar"], includedMenuItemIds: [], includedRentalIds: [] }],
      addons: [
        { id: "dessert", name: "Dessert", priceMinor: 275, pricingType: "per_person", active: true },
        { id: "bar", name: "Bar", priceMinor: 50000, pricingType: "per_event", active: true }
      ],
      rentals: [{ id: "linen", name: "Linen", priceMinor: 240, pricingType: "per_item", qtyPerGuests: 8, active: true }]
    },
    settings: {
      serviceFeePct: 0.2,
      serviceFeeTiers: [{ id: "mid", minGuests: 100, maxGuests: 249, pct: 0.18 }],
      taxRate: 0.1,
      taxRegions: [{ id: "local", name: "Local", rate: 0.0825 }],
      defaultTaxRegion: "local",
      depositPct: 0.3,
      seasonalProfiles: [
        { id: "standard", name: "Standard", startMonth: 1, startDay: 1, endMonth: 12, endDay: 31, packageMultiplier: 1, addonMultiplier: 1, rentalMultiplier: 1 },
        { id: "summer", name: "Summer", startMonth: 5, startDay: 1, endMonth: 9, endDay: 30, packageMultiplier: 1.04, addonMultiplier: 1.03, rentalMultiplier: 1.02 }
      ],
      defaultSeasonProfile: "auto",
      staffingLaborEnabled: true,
      staffingChargeMode: "per_hour",
      serverRate: 22,
      chefRate: 28,
      bartenderRate: 30,
      staffingRateTypes: [],
      bartenderRateTypes: [],
      perMileRateMinor: 70,
      longDistancePerMileRateMinor: 110,
      deliveryThresholdMiles: 30,
      menuSections: [{ id: "dessert", name: "Dessert", items: [{ id: "cake", name: "Cake", priceMinor: 4250, pricingType: "per_event", active: true }] }]
    },
    ...overrides
  };
}

describe("pricing-v2 exact-money core", () => {
  test("produces exact minor-unit totals, balance reconciliation, and deterministic waterfalls", () => {
    const input = fixture();
    const first = calculatePricingV2(input);
    const second = calculatePricingV2(input);
    const charged = first.lineItems.reduce((sum, line) => sum + line.lineTotalMinor, 0);
    expect(first).toEqual(second);
    expect(first.pricingVersion).toBe("pricing-v2");
    expect(first.roundingPolicy).toBe(PRICING_V2_ROUNDING);
    expect(Number.isSafeInteger(first.grandTotalMinor)).toBe(true);
    expect(charged).toBe(first.grandTotalMinor);
    expect(first.deposit.amountMinor + first.balance.amountMinor).toBe(first.grandTotalMinor);
    expect(first.discountTotalMinor).toBe(0);
    expect(first.priceWaterfall).toHaveLength(first.lineItems.length);
  });

  test("records explicit bundle inclusion and seasonal adjustments", () => {
    const pricing = calculatePricingV2(fixture());
    const includedBar = pricing.lineItems.find((line) => line.id === "bar");
    const packageLine = pricing.lineItems.find((line) => line.category === "package");
    expect(includedBar.lineTotalMinor).toBe(0);
    expect(includedBar.adjustments.map((item) => item.type)).toEqual(["context_adjustment", "bundle_inclusion"]);
    expect(packageLine.adjustments[0]).toMatchObject({ type: "context_adjustment", sourcePolicyId: "summer" });
  });

  test("specific seasons outrank a generic full-year standard profile regardless of array order", () => {
    const { settings } = fixture();
    const policy = validatePricingV2Policy(settings);
    const resolved = resolveSeasonProfileV2({ date: "2026-06-20", seasonProfileId: "auto" }, settings, policy);
    expect(resolved).toMatchObject({ id: "summer", source: "matching_specific" });
  });

  test("fails closed for unknown explicit tax regions, overlapping fee tiers, and ambiguous seasons", () => {
    const unknownTax = fixture();
    unknownTax.form = { ...unknownTax.form, taxRegion: "missing" };
    expect(() => calculatePricingV2(unknownTax)).toThrowError(PricingV2Error);

    const overlappingTiers = fixture();
    overlappingTiers.settings = {
      ...overlappingTiers.settings,
      serviceFeeTiers: [
        { id: "a", minGuests: 0, maxGuests: 100, pct: 0.2 },
        { id: "b", minGuests: 100, maxGuests: 200, pct: 0.18 }
      ]
    };
    expect(() => calculatePricingV2(overlappingTiers)).toThrow(/overlap/i);

    const ambiguous = fixture();
    ambiguous.settings = {
      ...ambiguous.settings,
      seasonalProfiles: [
        ...ambiguous.settings.seasonalProfiles,
        { id: "festival", name: "Festival", startMonth: 6, startDay: 1, endMonth: 7, endDay: 1, packageMultiplier: 1.1, addonMultiplier: 1.1, rentalMultiplier: 1.1 }
      ]
    };
    expect(() => calculatePricingV2(ambiguous)).toThrow(/overlap without unique priority/i);
  });

  test("rounds each line before fees and never emits fractional cents", () => {
    const input = fixture();
    input.catalog = {
      packages: [{ id: "wedding", name: "Wedding", pppMinor: 1, active: true, includedAddonIds: [], includedMenuItemIds: [], includedRentalIds: [] }],
      addons: [],
      rentals: []
    };
    input.form = { ...input.form, guests: 3, addons: [], rentals: [], menuItems: [], servers: 0, chefs: 0, bartenders: 0, milesRT: 0 };
    input.settings = { ...input.settings, serviceFeeTiers: [], serviceFeePct: 0.5, taxRegions: [{ id: "local", name: "Local", rate: 0 }], depositPct: 0.5, seasonalProfiles: [{ id: "standard", name: "Standard", startMonth: 1, startDay: 1, endMonth: 12, endDay: 31, packageMultiplier: 1, addonMultiplier: 1, rentalMultiplier: 1 }], menuSections: [] };
    const pricing = calculatePricingV2(input);
    expect(pricing.subtotalMinor).toBe(3);
    expect(pricing.fees.serviceFeeMinor).toBe(2);
    expect(pricing.grandTotalMinor).toBe(5);
    expect(pricing.deposit.amountMinor).toBe(3);
  });
});
