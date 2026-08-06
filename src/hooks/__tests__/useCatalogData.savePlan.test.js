import { describe, expect, test } from "vitest";
import { buildCatalogRecordChanges } from "../useCatalogData";

function catalog(overrides = {}) {
  return {
    packages: [],
    addons: [],
    rentals: [],
    settings: {},
    ...overrides
  };
}

describe("catalog record save planning", () => {
  test("omits unchanged records so a small edit does not rewrite the whole catalog", () => {
    const baseline = catalog({
      packages: [
        { id: "package-a", name: "Package A", ppp: 25 },
        { id: "package-b", name: "Package B", ppp: 35 }
      ],
      addons: [
        {
          id: "addon-a",
          name: "Dessert",
          price: 4,
          pricingType: "per_person",
          type: "per_person",
          staffRole: "",
          active: true
        }
      ]
    });

    expect(buildCatalogRecordChanges({
      catalog: structuredClone(baseline),
      baselineCatalog: baseline,
      serverFingerprints: {
        packages: {
          "package-a": "package-a-fingerprint",
          "package-b": "package-b-fingerprint"
        },
        addons: {
          "addon-a": "addon-a-fingerprint"
        }
      }
    })).toEqual([]);
  });

  test("plans only the changed record and carries its loaded server fingerprint", () => {
    const baseline = catalog({
      packages: [
        { id: "package-a", name: "Package A", ppp: 25 },
        { id: "package-b", name: "Package B", ppp: 35 }
      ]
    });
    const next = catalog({
      packages: [
        {
          id: "package-a",
          name: "Package A Plus",
          ppp: 29,
          description: "Metadata stays on the server.",
          importBatchId: "batch-a"
        },
        { id: "package-b", name: "Package B", ppp: 35 }
      ]
    });

    expect(buildCatalogRecordChanges({
      catalog: next,
      baselineCatalog: baseline,
      serverFingerprints: {
        packages: {
          "package-a": "package-a-fingerprint",
          "package-b": "package-b-fingerprint"
        }
      }
    })).toEqual([
      {
        id: "package-a",
        key: "packages",
        label: "package",
        nextItem: next.packages[0],
        writeData: {
          name: "Package A Plus",
          pppMinor: 2900
        },
        expectedFingerprint: "package-a-fingerprint"
      }
    ]);
  });

  test("distinguishes a fingerprint-guarded delete from a collision-checked create", () => {
    const baseline = catalog({
      rentals: [
        {
          id: "rental-old",
          name: "Old Rental",
          price: 10,
          qtyPerGuests: 10,
          pricingType: "per_item",
          type: "per_item",
          active: true
        }
      ]
    });
    const next = catalog({
      rentals: [
        {
          id: "rental-new",
          name: "New Rental",
          price: 12,
          qtyPerGuests: 8,
          pricingType: "per_item",
          type: "per_item",
          active: true
        }
      ]
    });

    const changes = buildCatalogRecordChanges({
      catalog: next,
      baselineCatalog: baseline,
      serverFingerprints: {
        rentals: {
          "rental-old": "full-rental-fingerprint"
        }
      }
    });

    expect(changes).toHaveLength(2);
    expect(changes[0]).toMatchObject({
      id: "rental-old",
      key: "rentals",
      nextItem: undefined,
      writeData: null,
      expectedFingerprint: "full-rental-fingerprint"
    });
    expect(changes[1]).toMatchObject({
      id: "rental-new",
      key: "rentals",
      writeData: {
        name: "New Rental",
        priceMinor: 1200,
        qtyPerGuests: 8,
        pricingType: "per_item",
        type: "per_item",
        active: true
      },
      expectedFingerprint: ""
    });
  });

  test("materializes an inferred staffing role when that add-on is edited", () => {
    const baseline = catalog({
      addons: [
        {
          id: "bartender",
          name: "Event Bartender",
          price: 30,
          pricingType: "per_event",
          type: "per_event",
          staffRole: "bartender",
          active: true
        }
      ]
    });
    const next = catalog({
      addons: [
        {
          ...baseline.addons[0],
          price: 35
        }
      ]
    });

    expect(buildCatalogRecordChanges({
      catalog: next,
      baselineCatalog: baseline,
      serverFingerprints: {
        addons: {
          bartender: "legacy-addon-fingerprint"
        }
      }
    })[0]).toMatchObject({
      id: "bartender",
      writeData: {
        priceMinor: 3500,
        staffRole: "bartender"
      },
      expectedFingerprint: "legacy-addon-fingerprint"
    });
  });

  test("rejects missing and duplicate record ids before a transaction starts", () => {
    expect(() => buildCatalogRecordChanges({
      catalog: catalog({
        packages: [{ id: "", name: "Missing ID", ppp: 20 }]
      }),
      baselineCatalog: catalog()
    })).toThrow("package id is required");

    expect(() => buildCatalogRecordChanges({
      catalog: catalog({
        packages: [
          { id: "duplicate", name: "First", ppp: 20 },
          { id: "duplicate", name: "Second", ppp: 30 }
        ]
      }),
      baselineCatalog: catalog()
    })).toThrow('Duplicate package id "duplicate"');
  });
});
