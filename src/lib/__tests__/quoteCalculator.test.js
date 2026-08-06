import { describe, expect, test } from "vitest";
import { calculateQuote } from "../quoteCalculator";
import {
  quoteCalculationCatalog,
  quoteCalculationFixtures,
  quoteCalculationSettings
} from "./fixtures/quoteCalculationFixtures";

describe("calculateQuote fixtures", () => {
  test("returns deterministic totals for identical inputs", () => {
    const fixture = quoteCalculationFixtures[0];
    const first = calculateQuote(fixture.form, quoteCalculationCatalog, quoteCalculationSettings);
    const second = calculateQuote(fixture.form, quoteCalculationCatalog, quoteCalculationSettings);

    expect(second).toEqual(first);
  });

  test.each(quoteCalculationFixtures)("covers $id", ({ form, expected, settingsPatch = null }) => {
    const totals = calculateQuote(
      form,
      quoteCalculationCatalog,
      settingsPatch ? { ...quoteCalculationSettings, ...settingsPatch } : quoteCalculationSettings
    );

    for (const [key, value] of Object.entries(expected)) {
      if (key === "selectedPkgId") {
        expect(totals.selectedPkg?.id).toBe(value);
        continue;
      }

      if (typeof value === "number") {
        expect(totals[key]).toBeCloseTo(value, 6);
        continue;
      }

      expect(totals[key]).toEqual(value);
    }
  });

  test("keeps deposit in sync with configured depositPct", () => {
    const depositFixture = quoteCalculationFixtures.find((fixture) => fixture.id === "deposit-pricing");
    const totals = calculateQuote(depositFixture.form, quoteCalculationCatalog, quoteCalculationSettings);

    expect(totals.deposit).toBeCloseTo(totals.total * quoteCalculationSettings.depositPct, 6);
  });

  test("supports disabling staffing labor automation", () => {
    const laborFixture = quoteCalculationFixtures.find((fixture) => fixture.id === "labor-pricing");
    const enabledTotals = calculateQuote(laborFixture.form, quoteCalculationCatalog, quoteCalculationSettings);
    const disabledTotals = calculateQuote(laborFixture.form, quoteCalculationCatalog, {
      ...quoteCalculationSettings,
      staffingLaborEnabled: false
    });

    expect(enabledTotals.labor).toBeGreaterThan(0);
    expect(disabledTotals.staffingLaborEnabled).toBe(false);
    expect(disabledTotals.servers).toBe(0);
    expect(disabledTotals.chefs).toBe(0);
    expect(disabledTotals.bartenderLabor).toBe(0);
    expect(disabledTotals.labor).toBe(0);
    expect(disabledTotals.total).toBeLessThan(enabledTotals.total);
  });

  test("applies an exact server-rate mix per server", () => {
    const totals = calculateQuote({
      ...quoteCalculationFixtures.find((fixture) => fixture.id === "labor-pricing").form,
      servers: 4,
      chefs: 0,
      bartenders: 0,
      hours: 5,
      serverRateOverride: 20,
      serverRateMixCsv: "25,30,30,35"
    }, quoteCalculationCatalog, quoteCalculationSettings);

    expect(totals.serverRatesApplied).toEqual([25, 30, 30, 35]);
    expect(totals.serverLabor).toBeCloseTo(600, 6);
    expect(totals.labor).toBeCloseTo(600, 6);
  });

  test("fills missing server-rate mix entries with fallback rate", () => {
    const totals = calculateQuote({
      ...quoteCalculationFixtures.find((fixture) => fixture.id === "labor-pricing").form,
      servers: 4,
      chefs: 0,
      bartenders: 0,
      hours: 3,
      serverRateOverride: 20,
      serverRateMixCsv: "25,30"
    }, quoteCalculationCatalog, quoteCalculationSettings);

    expect(totals.serverRatesApplied).toEqual([25, 30, 20, 20]);
    expect(totals.serverLabor).toBeCloseTo(285, 6);
    expect(totals.labor).toBeCloseTo(285, 6);
  });

  test("ignores invalid server-rate mix tokens and preserves fallback behavior", () => {
    const baseForm = {
      ...quoteCalculationFixtures.find((fixture) => fixture.id === "labor-pricing").form,
      servers: 3,
      chefs: 0,
      bartenders: 0,
      hours: 2,
      serverRateOverride: 20
    };

    const fallbackOnly = calculateQuote({
      ...baseForm,
      serverRateMixCsv: "foo,-2"
    }, quoteCalculationCatalog, quoteCalculationSettings);
    const withMixed = calculateQuote({
      ...baseForm,
      serverRateMixCsv: "foo, -2, 31, ,abc"
    }, quoteCalculationCatalog, quoteCalculationSettings);

    expect(fallbackOnly.serverRatesApplied).toEqual([20, 20, 20]);
    expect(fallbackOnly.serverLabor).toBeCloseTo(120, 6);
    expect(withMixed.serverRatesApplied).toEqual([31, 20, 20]);
    expect(withMixed.serverLabor).toBeCloseTo(142, 6);
  });

  test("respects staffing charge mode when server-rate mix is set", () => {
    const form = {
      ...quoteCalculationFixtures.find((fixture) => fixture.id === "labor-pricing").form,
      servers: 4,
      chefs: 0,
      bartenders: 0,
      hours: 5,
      serverRateOverride: 20,
      serverRateMixCsv: "25,30,30,35"
    };
    const perHour = calculateQuote(form, quoteCalculationCatalog, quoteCalculationSettings);
    const perEvent = calculateQuote(form, quoteCalculationCatalog, {
      ...quoteCalculationSettings,
      staffingChargeMode: "per_event_per_staff"
    });

    expect(perHour.serverLabor).toBeCloseTo(600, 6);
    expect(perHour.labor).toBeCloseTo(600, 6);
    expect(perEvent.serverLabor).toBeCloseTo(120, 6);
    expect(perEvent.labor).toBeCloseTo(120, 6);
  });

  test("applies an exact chef-rate mix per chef", () => {
    const totals = calculateQuote({
      ...quoteCalculationFixtures.find((fixture) => fixture.id === "labor-pricing").form,
      servers: 0,
      chefs: 3,
      bartenders: 0,
      hours: 4,
      chefRateOverride: 50,
      chefRateMixCsv: "45,50,55"
    }, quoteCalculationCatalog, quoteCalculationSettings);

    expect(totals.chefRatesApplied).toEqual([45, 50, 55]);
    expect(totals.chefLabor).toBeCloseTo(600, 6);
    expect(totals.labor).toBeCloseTo(600, 6);
  });

  test("fills missing chef-rate mix entries with fallback rate", () => {
    const totals = calculateQuote({
      ...quoteCalculationFixtures.find((fixture) => fixture.id === "labor-pricing").form,
      servers: 0,
      chefs: 4,
      bartenders: 0,
      hours: 3,
      chefRateOverride: 50,
      chefRateMixCsv: "45,55"
    }, quoteCalculationCatalog, quoteCalculationSettings);

    expect(totals.chefRatesApplied).toEqual([45, 55, 50, 50]);
    expect(totals.chefLabor).toBeCloseTo(600, 6);
    expect(totals.labor).toBeCloseTo(600, 6);
  });

  test("ignores invalid chef-rate mix tokens and preserves fallback behavior", () => {
    const baseForm = {
      ...quoteCalculationFixtures.find((fixture) => fixture.id === "labor-pricing").form,
      servers: 0,
      chefs: 3,
      bartenders: 0,
      hours: 2,
      chefRateOverride: 50
    };

    const fallbackOnly = calculateQuote({
      ...baseForm,
      chefRateMixCsv: "foo,-3"
    }, quoteCalculationCatalog, quoteCalculationSettings);
    const withMixed = calculateQuote({
      ...baseForm,
      chefRateMixCsv: "foo, -2, 55, ,abc"
    }, quoteCalculationCatalog, quoteCalculationSettings);

    expect(fallbackOnly.chefRatesApplied).toEqual([50, 50, 50]);
    expect(fallbackOnly.chefLabor).toBeCloseTo(300, 6);
    expect(withMixed.chefRatesApplied).toEqual([55, 50, 50]);
    expect(withMixed.chefLabor).toBeCloseTo(310, 6);
  });

  test("respects staffing charge mode when chef-rate mix is set", () => {
    const form = {
      ...quoteCalculationFixtures.find((fixture) => fixture.id === "labor-pricing").form,
      servers: 0,
      chefs: 3,
      bartenders: 0,
      hours: 5,
      chefRateOverride: 50,
      chefRateMixCsv: "45,50,55"
    };
    const perHour = calculateQuote(form, quoteCalculationCatalog, quoteCalculationSettings);
    const perEvent = calculateQuote(form, quoteCalculationCatalog, {
      ...quoteCalculationSettings,
      staffingChargeMode: "per_event_per_staff"
    });

    expect(perHour.chefLabor).toBeCloseTo(750, 6);
    expect(perHour.labor).toBeCloseTo(750, 6);
    expect(perEvent.chefLabor).toBeCloseTo(150, 6);
    expect(perEvent.labor).toBeCloseTo(150, 6);
  });

  test("does not charge selected package inclusions a second time", () => {
    const catalog = {
      packages: [{
        id: "included-package",
        name: "Included Package",
        ppp: 10,
        includedAddonIds: ["included-addon", "unselected-included-addon"],
        includedRentalIds: ["included-rental"],
        includedMenuItemIds: ["included-menu"]
      }],
      addons: [
        { id: "included-addon", name: "Included add-on", price: 3, pricingType: "per_event" },
        { id: "unselected-included-addon", name: "Unselected included add-on", price: 9, pricingType: "per_event" },
        { id: "extra-addon", name: "Extra add-on", price: 4, pricingType: "per_event" }
      ],
      rentals: [
        { id: "included-rental", name: "Included rental", price: 5, pricingType: "per_event" },
        { id: "extra-rental", name: "Extra rental", price: 6, pricingType: "per_event" }
      ]
    };
    const settings = {
      ...quoteCalculationSettings,
      menuSections: [{
        id: "menu",
        name: "Menu",
        items: [
          { id: "included-menu", name: "Included menu", price: 7, pricingType: "per_event" },
          { id: "extra-menu", name: "Extra menu", price: 8, pricingType: "per_event" }
        ]
      }],
      serviceFeePct: 0,
      serviceFeeTiers: [],
      taxRate: 0,
      taxRegions: [],
      depositPct: 0,
      staffingLaborEnabled: false,
      perMileRate: 0,
      longDistancePerMileRate: 0,
      deliveryThresholdMiles: 0
    };
    const totals = calculateQuote({
      pkg: "included-package",
      guests: 10,
      hours: 0,
      addons: ["included-addon", "extra-addon"],
      rentals: ["included-rental", "extra-rental"],
      menuItems: ["included-menu", "extra-menu"],
      addonQuantities: {},
      rentalQuantities: {},
      menuItemQuantities: {}
    }, catalog, settings);

    expect(totals.base).toBe(100);
    expect(totals.addons).toBe(4);
    expect(totals.rentals).toBe(6);
    expect(totals.menu).toBe(8);
    expect(totals.total).toBe(118);
    expect(totals.packageInclusions).toMatchObject({
      addons: [{ id: "included-addon", includedInPackage: true }],
      rentals: [{ id: "included-rental", includedInPackage: true }],
      menuItems: [{ id: "included-menu", includedInPackage: true }]
    });
    expect(totals.packageInclusions.addons).not.toEqual(
      expect.arrayContaining([expect.objectContaining({ id: "unselected-included-addon" })])
    );
  });
});
