import { describe, expect, test } from "vitest";
import { normalizeCatalog, toStorageCatalog } from "../mockCatalog";

function catalogWith({ packages, addons, rentals, settings } = {}) {
  return normalizeCatalog({
    packages: packages || [{ id: "classic", name: "Classic", ppp: 20 }],
    addons: addons || [],
    rentals: rentals || [],
    settings: settings || {}
  });
}

describe("normalizeCatalog cost fields", () => {
  test("defaults every cost field to null (not recorded), never 0", () => {
    const catalog = catalogWith();
    expect(catalog.packages[0].costPpp).toBeNull();
    expect(catalog.settings.serverCostRate).toBeNull();
    expect(catalog.settings.chefCostRate).toBeNull();
    expect(catalog.settings.bartenderCostRate).toBeNull();
    expect(catalog.settings.targetMarginPct).toBeNull();
  });

  test("reads plain costPpp/cost fields on packages, addons, and rentals", () => {
    const catalog = catalogWith({
      packages: [{ id: "classic", name: "Classic", ppp: 20, costPpp: 8.5 }],
      addons: [{ id: "bar", name: "Bar", price: 15, cost: 6 }],
      rentals: [{ id: "linens", name: "Linens", price: 9, cost: 3, qtyPerGuests: 8 }]
    });
    expect(catalog.packages[0].costPpp).toBe(8.5);
    expect(catalog.addons[0].cost).toBe(6);
    expect(catalog.rentals[0].cost).toBe(3);
  });

  test("prefers Minor-cents fields when present, matching the ppp/pppMinor and price/priceMinor convention", () => {
    const catalog = catalogWith({
      packages: [{ id: "classic", name: "Classic", ppp: 20, costPpp: 999, costPppMinor: 850 }],
      addons: [{ id: "bar", name: "Bar", price: 15, cost: 999, costMinor: 600 }],
      rentals: [{ id: "linens", name: "Linens", price: 9, cost: 999, costMinor: 300, qtyPerGuests: 8 }]
    });
    expect(catalog.packages[0].costPpp).toBe(8.5);
    expect(catalog.addons[0].cost).toBe(6);
    expect(catalog.rentals[0].cost).toBe(3);
  });

  test("a stored Minor-cents null survives as null, not 0 — the bug fromMinorUnits alone would reintroduce", () => {
    // Number(null) is 0, a safe integer, so fromMinorUnits(null, fallback)
    // would silently return 0 instead of the fallback if not special-cased.
    const catalog = catalogWith({
      packages: [{ id: "classic", name: "Classic", ppp: 20, costPppMinor: null }],
      addons: [{ id: "bar", name: "Bar", price: 15, costMinor: null }],
      rentals: [{ id: "linens", name: "Linens", price: 9, costMinor: null, qtyPerGuests: 8 }]
    });
    expect(catalog.packages[0].costPpp).toBeNull();
    expect(catalog.addons[0].cost).toBeNull();
    expect(catalog.rentals[0].cost).toBeNull();
  });

  test("a deliberately recorded $0 cost is preserved, distinct from unset", () => {
    const catalog = catalogWith({
      packages: [{ id: "classic", name: "Classic", ppp: 20, costPpp: 0 }]
    });
    expect(catalog.packages[0].costPpp).toBe(0);
  });

  test("reads settings cost rates and target margin as plain nullable numbers", () => {
    const catalog = catalogWith({
      settings: {
        serverCostRate: 16,
        chefCostRate: 20,
        bartenderCostRate: 22,
        targetMarginPct: 0.45
      }
    });
    expect(catalog.settings.serverCostRate).toBe(16);
    expect(catalog.settings.chefCostRate).toBe(20);
    expect(catalog.settings.bartenderCostRate).toBe(22);
    expect(catalog.settings.targetMarginPct).toBe(0.45);
  });

  test("blank-string settings inputs (as a cleared form field would send) normalize to null", () => {
    const catalog = catalogWith({ settings: { serverCostRate: "", targetMarginPct: "" } });
    expect(catalog.settings.serverCostRate).toBeNull();
    expect(catalog.settings.targetMarginPct).toBeNull();
  });

  test("toStorageCatalog (local dev fallback path) preserves cost fields the same way", () => {
    const catalog = catalogWith({
      packages: [{ id: "classic", name: "Classic", ppp: 20, costPpp: 8.5 }],
      addons: [{ id: "bar", name: "Bar", price: 15, cost: 6 }],
      rentals: [{ id: "linens", name: "Linens", price: 9, cost: 3, qtyPerGuests: 8 }]
    });
    const stored = toStorageCatalog(catalog);
    expect(stored.packages[0].costPpp).toBe(8.5);
    expect(stored.addons[0].cost).toBe(6);
    expect(stored.rentals[0].cost).toBe(3);
  });
});

describe("normalizeCatalog portalDecidable marks", () => {
  test("defaults strictly false on addons and rentals — no option is customer-offered without a deliberate mark", () => {
    const catalog = catalogWith({
      addons: [{ id: "bar", name: "Bar", price: 15 }],
      rentals: [{ id: "linens", name: "Linens", price: 9, qtyPerGuests: 8 }]
    });
    expect(catalog.addons[0].portalDecidable).toBe(false);
    expect(catalog.rentals[0].portalDecidable).toBe(false);
  });

  test("accepts only an explicit boolean true, rejecting truthy junk from hand-edited JSON", () => {
    const catalog = catalogWith({
      addons: [
        { id: "bar", name: "Bar", price: 15, portalDecidable: true },
        { id: "coffee", name: "Coffee", price: 95, portalDecidable: "yes" }
      ],
      rentals: [{ id: "linens", name: "Linens", price: 9, qtyPerGuests: 8, portalDecidable: 1 }]
    });
    expect(catalog.addons[0].portalDecidable).toBe(true);
    expect(catalog.addons[1].portalDecidable).toBe(false);
    expect(catalog.rentals[0].portalDecidable).toBe(false);
  });

  test("round-trips through toStorageCatalog (local dev fallback path) without loosening the default", () => {
    const stored = toStorageCatalog(catalogWith({
      addons: [{ id: "bar", name: "Bar", price: 15, portalDecidable: true }],
      rentals: [{ id: "linens", name: "Linens", price: 9, qtyPerGuests: 8 }]
    }));
    expect(stored.addons[0].portalDecidable).toBe(true);
    expect(stored.rentals[0].portalDecidable).toBe(false);
  });
});
