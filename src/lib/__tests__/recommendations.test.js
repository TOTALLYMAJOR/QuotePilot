import { describe, expect, test } from "vitest";
import { buildUpsellRecommendations } from "../recommendations";

const recommendationCatalog = {
  packages: [
    { id: "classic", name: "Classic", ppp: 18 },
    { id: "premium", name: "Premium", ppp: 24 },
    { id: "deluxe", name: "Deluxe", ppp: 32 }
  ],
  addons: [
    { id: "dessert", name: "Dessert", type: "per_person", price: 3 },
    { id: "coffee", name: "Coffee Station", type: "per_event", price: 95 }
  ],
  rentals: [
    {
      id: "linens",
      name: "Linens",
      price: 8,
      qtyRule: (guests) => Math.max(1, Math.ceil(guests / 8))
    }
  ]
};

const recommendationForm = {
  guests: 150,
  hours: 5,
  pkg: "classic",
  addons: [],
  rentals: []
};

const recommendationTotals = {
  addonMultiplier: 1,
  rentalMultiplier: 1,
  packageMultiplier: 1
};

describe("buildUpsellRecommendations", () => {
  test("respects global guided-selling toggle", () => {
    const results = buildUpsellRecommendations({
      form: recommendationForm,
      catalog: recommendationCatalog,
      totals: recommendationTotals,
      settings: {
        guidedSellingEnabled: false,
        upsellRules: [
          {
            id: "rule-dessert",
            kind: "addon",
            targetId: "dessert",
            enabled: true,
            minGuests: 10,
            minHours: 0,
            reason: "Test"
          }
        ]
      }
    });

    expect(results).toEqual([]);
  });

  test("builds recommendations from configured rules", () => {
    const results = buildUpsellRecommendations({
      form: recommendationForm,
      catalog: recommendationCatalog,
      totals: recommendationTotals,
      settings: {
        guidedSellingEnabled: true,
        upsellRules: [
          {
            id: "rule-dessert",
            kind: "addon",
            targetId: "dessert",
            enabled: true,
            minGuests: 40,
            minHours: 0,
            reason: "Dessert improves conversion."
          },
          {
            id: "rule-linens",
            kind: "rental",
            targetId: "linens",
            enabled: true,
            minGuests: 80,
            minHours: 0,
            reason: "Linen polish for larger events."
          },
          {
            id: "rule-package",
            kind: "package",
            targetId: "",
            enabled: true,
            minGuests: 130,
            minHours: 0,
            reason: "Upgrade package for capacity."
          }
        ]
      }
    });

    expect(results).toHaveLength(3);
    expect(results.map((item) => item.kind)).toEqual(["addon", "rental", "package"]);
    expect(results.map((item) => item.id)).toEqual(["dessert", "linens", "premium"]);
  });

  test("never recommends inactive catalog records", () => {
    const results = buildUpsellRecommendations({
      form: recommendationForm,
      catalog: {
        packages: recommendationCatalog.packages.map((item) => (
          item.id === "premium" ? { ...item, active: false } : item
        )),
        addons: recommendationCatalog.addons.map((item) => ({ ...item, active: false })),
        rentals: recommendationCatalog.rentals.map((item) => ({ ...item, active: false }))
      },
      totals: recommendationTotals,
      settings: {
        guidedSellingEnabled: true,
        upsellRules: [
          { id: "addon", kind: "addon", targetId: "dessert", enabled: true },
          { id: "rental", kind: "rental", targetId: "linens", enabled: true },
          { id: "package", kind: "package", targetId: "premium", enabled: true }
        ]
      }
    });

    expect(results).toEqual([]);
  });
});
