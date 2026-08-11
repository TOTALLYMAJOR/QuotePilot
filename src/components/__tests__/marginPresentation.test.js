import { describe, expect, test } from "vitest";
import { MARGIN_MODEL, buildMarginPresentation } from "../marginPresentation";

const settings = {
  staffingChargeMode: "per_hour_per_staff",
  serverCostRate: 16,
  chefCostRate: 20,
  bartenderCostRate: 22,
  targetMarginPct: 0.3,
  menuSections: [{
    id: "mains",
    items: [{ id: "salmon", name: "Grilled Salmon", price: 6, pricingType: "per_person", cost: 2.5 }]
  }]
};

const catalog = {
  packages: [{ id: "classic", name: "Classic", ppp: 20, costPpp: 8 }],
  addons: [{ id: "bar", name: "Premium Bar", type: "per_person", price: 15, cost: 6 }],
  rentals: [{ id: "linens", name: "Linens", price: 9, qtyPerGuests: 10, cost: 3 }],
  settings
};

const form = {
  pkg: "classic",
  guests: 100,
  hours: 6,
  servers: 5,
  chefs: 2,
  bartenders: 1,
  addons: ["bar"],
  rentals: ["linens"],
  menuItems: ["salmon"],
  addonQuantities: {},
  rentalQuantities: {},
  menuItemQuantities: {}
};

const totals = {
  total: 5000,
  base: 2000,
  addons: 1500,
  rentals: 90,
  menu: 600,
  labor: 900,
  serviceFee: 700,
  travel: 50,
  tax: 400
};

describe("buildMarginPresentation", () => {
  test("computes margin only from recorded costs, excluding travel and tax", () => {
    const result = buildMarginPresentation({ form, totals, catalog, settings });
    expect(result.modelId).toBe(MARGIN_MODEL);
    expect(result.available).toBe(true);
    // cost: package 8×100 + bar 6×100 + linens 3×ceil(100/10) + salmon 2.5×100
    //       + labor (5×16 + 2×20 + 1×22)×6 = 800+600+30+250+852 = 2532
    expect(result.cost).toBe(2532);
    // revenue: base+addons+rentals+menu+labor+serviceFee = 5790 (travel/tax excluded)
    expect(result.revenue).toBe(5790);
    expect(result.marginPct).toBeCloseTo((5790 - 2532) / 5790, 6);
    expect(result.targetNote).toContain("Meets your 30% target.");
    expect(result.note).toContain("costs never appear to customers");
  });

  test("fails closed and names what is missing instead of estimating", () => {
    const gappy = {
      ...catalog,
      packages: [{ id: "classic", name: "Classic", ppp: 20 }],
      addons: [{ id: "bar", name: "Premium Bar", type: "per_person", price: 15 }]
    };
    const result = buildMarginPresentation({ form, totals, catalog: gappy, settings });
    expect(result.available).toBe(false);
    expect(result.note).toContain("Margins unavailable");
    expect(result.note).toContain("Classic (costPpp)");
    expect(result.note).toContain("Premium Bar (cost)");
    expect(result.missingCount).toBe(2);
  });

  test("requires labor cost rates only when staff are quoted", () => {
    const noRates = { ...settings, serverCostRate: undefined, chefCostRate: undefined, bartenderCostRate: undefined };
    const withStaff = buildMarginPresentation({ form, totals, catalog: { ...catalog, settings: noRates }, settings: noRates });
    expect(withStaff.available).toBe(false);
    expect(withStaff.note).toContain("serverCostRate");

    const noStaff = buildMarginPresentation({
      form: { ...form, servers: 0, chefs: 0, bartenders: 0 },
      totals,
      catalog,
      settings: noRates
    });
    expect(noStaff.available).toBe(true);
  });

  test("reports the gap to a recorded target and stays silent without one", () => {
    const highTarget = { ...settings, targetMarginPct: 0.75 };
    const below = buildMarginPresentation({ form, totals, catalog, settings: highTarget });
    expect(below.targetNote).toContain("below your 75% target");
    const noTarget = buildMarginPresentation({ form, totals, catalog, settings: { ...settings, targetMarginPct: undefined } });
    expect(noTarget.targetNote).toBe("");
  });

  test("returns nothing without guests, totals, or the selected package", () => {
    expect(buildMarginPresentation({ form: { ...form, guests: 0 }, totals, catalog, settings })).toBeNull();
    expect(buildMarginPresentation({ form, totals: { total: 0 }, catalog, settings })).toBeNull();
    expect(buildMarginPresentation({ form: { ...form, pkg: "ghost" }, totals, catalog, settings })).toBeNull();
  });
});
