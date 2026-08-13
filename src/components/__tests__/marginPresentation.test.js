import { describe, expect, test } from "vitest";
import { MARGIN_MODEL, buildMarginAdvisorCard, buildMarginPresentation } from "../marginPresentation";

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

  test("returns nothing without guests or totals and fails closed when the selected package is unavailable", () => {
    expect(buildMarginPresentation({ form: { ...form, guests: 0 }, totals, catalog, settings })).toBeNull();
    expect(buildMarginPresentation({ form, totals: { total: 0 }, catalog, settings })).toBeNull();
    expect(buildMarginPresentation({ form: { ...form, pkg: "ghost" }, totals, catalog, settings }))
      .toMatchObject({
        available: false,
        missing: ["Selected package ghost (catalog item unavailable)"]
      });
  });

  test("fails closed when any selected add-on, rental, or menu item is missing from the current catalog", () => {
    const result = buildMarginPresentation({
      form: {
        ...form,
        addons: [...form.addons, "retired-addon"],
        rentals: [...form.rentals, "retired-rental"],
        menuItems: [...form.menuItems, "retired-menu-item"]
      },
      totals,
      catalog,
      settings
    });

    expect(result.available).toBe(false);
    expect(result.missing).toEqual(expect.arrayContaining([
      "Selected item retired-addon (catalog item unavailable)",
      "Selected item retired-rental (catalog item unavailable)",
      "Selected item retired-menu-item (catalog item unavailable)"
    ]));
    expect(result.note).toContain("Margins unavailable");
  });

  test("caps the cost guest basis at 400 exactly like calculateQuote, so cost and revenue share one basis", () => {
    // calculateQuote caps guests at 400 before pricing anything; totals below
    // are what it would actually emit for a 500-guest form (i.e. priced at
    // 400). If margin priced cost on the uncapped 500, cost would exceed what
    // this same revenue could ever justify.
    const cappedTotals = { ...totals, base: 20 * 400, addons: 15 * 400 };
    const over = buildMarginPresentation({
      form: { ...form, guests: 500 },
      totals: cappedTotals,
      catalog,
      settings
    });
    const atCap = buildMarginPresentation({
      form: { ...form, guests: 400 },
      totals: cappedTotals,
      catalog,
      settings
    });
    expect(over.available).toBe(true);
    expect(over.cost).toBe(atCap.cost);
    expect(over.marginPct).toBeCloseTo(atCap.marginPct, 6);
  });

  test("skips labor cost entirely when staffing labor is disabled, matching calculateQuote's zeroed labor total", () => {
    // No cost rates recorded at all — if labor cost were still required here,
    // this would report unavailable even though nothing about labor is
    // actually being billed.
    const laborOff = { ...settings, staffingLaborEnabled: false, serverCostRate: undefined, chefCostRate: undefined, bartenderCostRate: undefined };
    const disabledTotals = { ...totals, labor: 0 };
    const result = buildMarginPresentation({ form, totals: disabledTotals, catalog, settings: laborOff });
    expect(result.available).toBe(true);
    // Same cost as the always-on case minus the labor component (2532 - 852).
    expect(result.cost).toBe(1680);

    // Even when rates ARE recorded, disabled labor must still contribute
    // zero cost — a recorded rate must never resurrect a charge the revenue
    // side isn't billing.
    const laborOffWithRates = { ...settings, staffingLaborEnabled: false };
    const withRates = buildMarginPresentation({ form, totals: disabledTotals, catalog, settings: laborOffWithRates });
    expect(withRates.cost).toBe(1680);
  });
});

describe("buildMarginAdvisorCard", () => {
  test("returns a decision card with the point and dollar gap when below target", () => {
    const highTarget = { ...settings, targetMarginPct: 0.75 };
    const margin = buildMarginPresentation({ form, totals, catalog, settings: highTarget });
    const card = buildMarginAdvisorCard(margin);

    expect(card).not.toBeNull();
    expect(card.id).toBe("margin-below-target");
    expect(card.signal).toBe("attend");
    expect(card.family).toBe("info");
    expect(card.title).toBe("Below your margin target");
    expect(card.sentence).toContain("75% target");
    // gap points: (0.75 - marginPct) * 100
    const gapPoints = (0.75 - margin.marginPct) * 100;
    expect(card.sentence).toContain(gapPoints.toFixed(1));
    // gap dollars: revenue * (target - marginPct), formatted via currency()
    const gapDollars = margin.revenue * (0.75 - margin.marginPct);
    expect(card.impact).toContain(gapDollars.toFixed(2));
  });

  test("stays silent (no card) when the quote already meets or beats its target", () => {
    const margin = buildMarginPresentation({ form, totals, catalog, settings });
    expect(margin.targetNote).toContain("Meets");
    expect(buildMarginAdvisorCard(margin)).toBeNull();
  });

  test("stays silent when no target is recorded", () => {
    const noTarget = { ...settings, targetMarginPct: undefined };
    const margin = buildMarginPresentation({ form, totals, catalog, settings: noTarget });
    expect(buildMarginAdvisorCard(margin)).toBeNull();
  });

  test("stays silent when margin itself is unavailable or absent", () => {
    expect(buildMarginAdvisorCard(null)).toBeNull();
    expect(buildMarginAdvisorCard({ available: false })).toBeNull();
  });
});
