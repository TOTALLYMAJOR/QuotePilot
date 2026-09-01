import { describe, expect, test } from "vitest";
import {
  applyCatalogSetupDraftChanges,
  buildCatalogSetupChanges,
  createCatalogSetupRequestId
} from "../catalogSetupDraftService";

function catalog(overrides = {}) {
  return {
    packages: [],
    addons: [],
    rentals: [],
    settings: {},
    ...overrides
  };
}

describe("catalog setup draft client adapter", () => {
  test("converts one local catalog and managed-menu edit set into bounded server draft intent", () => {
    const baseline = catalog({
      packages: [{ id: "package-a", name: "Package A", ppp: 25, active: true }],
      settings: {
        perMileRate: 0.7,
        serverRate: 24,
        chefRate: 32,
        bartenderRate: 30,
        longDistancePerMileRate: 1.1,
        bartenderRateTypes: [{ id: "standard", name: "Standard", rate: 30 }],
        staffingRateTypes: [{ id: "standard", name: "Standard", serverRate: 24, chefRate: 32 }]
      }
    });
    const next = catalog({
      packages: [{ id: "package-a", name: "Package A", ppp: 29, active: true }],
      settings: {
        ...baseline.settings,
        perMileRate: 0.95,
        serverRate: 48,
        chefRate: 62
      }
    });
    const changes = buildCatalogSetupChanges({
      catalog: next,
      baselineCatalog: baseline,
      serverFingerprints: { packages: { "package-a": "package-fingerprint" } },
      menu: {
        eventTypes: [{ id: "event-a", name: "Wedding", active: true }],
        categories: [{ id: "section-a", name: "Entrées", eventTypeId: "event-a", active: true }],
        items: [{
          id: "menu-a",
          name: "Roasted chicken",
          eventTypeId: "event-a",
          categoryId: "section-a",
          price: 14,
          cost: 6,
          pricingType: "per_person",
          active: true
        }]
      },
      baselineMenu: {
        eventTypes: [{ id: "event-a", name: "Wedding", active: true }],
        categories: [{ id: "section-a", name: "Entrées", eventTypeId: "event-a", active: true }],
        items: [{
          id: "menu-a",
          name: "Roasted chicken",
          eventTypeId: "event-a",
          categoryId: "section-a",
          price: 12,
          cost: null,
          pricingType: "per_person",
          active: true
        }]
      }
    });

    expect(changes).toEqual(expect.arrayContaining([
      expect.objectContaining({
        collection: "catalogPackages",
        recordId: "package-a",
        intent: "update",
        payload: expect.objectContaining({ pppMinor: 2900 })
      }),
      expect.objectContaining({
        collection: "settings",
        payload: expect.objectContaining({ perMileRateMinor: 95, serverRateMinor: 4800, chefRateMinor: 6200 })
      }),
      expect.objectContaining({
        collection: "menuItems",
        recordId: "menu-a",
        intent: "update",
        payload: expect.objectContaining({ priceMinor: 1400, costMinor: 600, pricingType: "per_person" })
      })
    ]));
    expect(changes).toHaveLength(3);
  });

  test("represents removal as dependency-reviewable deactivation with a complete payload", () => {
    const baseline = catalog({
      rentals: [{
        id: "rental-a",
        name: "Linens",
        price: 9,
        cost: 5,
        qtyPerGuests: 8,
        pricingType: "per_item",
        active: true
      }]
    });
    const changes = buildCatalogSetupChanges({
      catalog: catalog(),
      baselineCatalog: baseline,
      serverFingerprints: { rentals: { "rental-a": "rental-fingerprint" } }
    });
    expect(changes).toEqual([expect.objectContaining({
      collection: "catalogRentals",
      recordId: "rental-a",
      intent: "deactivate",
      payload: expect.objectContaining({
        name: "Linens",
        priceMinor: 900,
        costMinor: 500,
        active: false
      })
    })]);
  });

  test("creates stable callable-safe request ids", () => {
    expect(createCatalogSetupRequestId("draft")).toMatch(/^draft_[A-Za-z0-9_]{16,}$/);
  });

  test("rehydrates staged menu price and section changes without mutating the published source", () => {
    const published = {
      eventTypes: [{ id: "event-a", name: "Wedding", active: true }],
      categories: [
        { id: "section-a", eventTypeId: "event-a", name: "Mains", active: true },
        { id: "section-b", eventTypeId: "event-a", name: "Specials", active: true }
      ],
      items: [{
        id: "menu-a",
        eventTypeId: "event-a",
        categoryId: "section-a",
        name: "Roasted chicken",
        price: 10,
        cost: 4,
        pricingType: "per_person",
        active: true
      }]
    };
    const staged = applyCatalogSetupDraftChanges(published, [{
      collection: "menuItems",
      recordId: "menu-a",
      intent: "update",
      payload: {
        eventTypeId: "event-a",
        categoryId: "section-b",
        name: "Roasted chicken",
        priceMinor: 1234,
        costMinor: 450,
        pricingType: "per_person",
        active: true
      }
    }]);

    expect(staged.items[0]).toMatchObject({ categoryId: "section-b", price: 12.34, cost: 4.5 });
    expect(published.items[0]).toMatchObject({ categoryId: "section-a", price: 10, cost: 4 });
  });
});
