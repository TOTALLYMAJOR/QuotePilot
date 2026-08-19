import { createRequire } from "node:module";
import { describe, expect, test } from "vitest";
import { normalizeCatalog } from "../../data/mockCatalog";
import { calculateQuote } from "../quoteCalculator";
import { packageWriteShape } from "../catalogWriteShapes";

const require = createRequire(import.meta.url);
const {
  calculateQuotePricingAuthoritative
} = require("../../../functions/pricingEngine.js");

function collectionSnapshot(records = []) {
  return {
    docs: records.map((record) => ({
      id: record.id,
      data: () => ({ ...record })
    }))
  };
}

function buildPricingDb({
  settings,
  packages = [],
  addons = [],
  rentals = [],
  menuItems = []
} = {}) {
  const collections = {
    catalogPackages: collectionSnapshot(packages),
    catalogAddons: collectionSnapshot(addons),
    catalogRentals: collectionSnapshot(rentals),
    menuItems: collectionSnapshot(menuItems)
  };

  return {
    collection(collectionName) {
      if (collectionName !== "organizations") {
        throw new Error(`Unexpected collection: ${collectionName}`);
      }
      return {
        doc() {
          return {
            collection(subcollectionName) {
              if (subcollectionName === "settings") {
                return {
                  doc(docId) {
                    if (docId !== "config") {
                      throw new Error(`Unexpected settings document: ${docId}`);
                    }
                    return {
                      async get() {
                        return {
                          exists: true,
                          data: () => settings
                        };
                      }
                    };
                  }
                };
              }
              if (!collections[subcollectionName]) {
                throw new Error(`Unexpected subcollection: ${subcollectionName}`);
              }
              return {
                async get() {
                  return collections[subcollectionName];
                }
              };
            }
          };
        }
      };
    }
  };
}

function confirmedPricingSettings(overrides = {}) {
  return {
    pricingSetupConfirmed: true,
    catalogRevision: 4,
    pricingConfirmation: {
      actorUid: "staff-a",
      actorEmail: "admin@example.com",
      confirmedAtISO: "2026-08-18T18:00:00.000Z",
      confirmedCatalogRevision: 4
    },
    serviceFeePct: 0,
    serviceFeeTiers: [],
    taxRate: 0,
    taxRegions: [],
    defaultTaxRegion: "",
    depositPct: 0,
    seasonalProfiles: [],
    defaultSeasonProfile: "",
    bartenderRate: 0,
    bartenderRateTypes: [],
    serverRate: 0,
    chefRate: 0,
    staffingRateTypes: [],
    staffingLaborEnabled: false,
    perMileRate: 0,
    longDistancePerMileRate: 0,
    deliveryThresholdMiles: 0,
    ...overrides
  };
}

const pricingStaff = {
  uid: "staff-a",
  email: "admin@example.com",
  role: "admin",
  organizationId: "org-a"
};

describe("package workspace characterization and pricing parity", () => {
  test("preserves the current package write shape including null-vs-zero cost and trimmed inclusion IDs", () => {
    expect(packageWriteShape({
      name: "  Gold package  ",
      ppp: 12.34,
      costPpp: "",
      includedMenuItemIds: [" salad ", "", "salad", "dessert"],
      includedAddonIds: null,
      includedRentalIds: ["chafer"],
      active: false
    })).toEqual({
      name: "  Gold package  ",
      pppMinor: 1234,
      costPppMinor: null,
      includedMenuItemIds: ["salad", "salad", "dessert"],
      includedAddonIds: [],
      includedRentalIds: ["chafer"],
      active: false
    });

    expect(packageWriteShape({
      name: "Zero cost package",
      ppp: 10,
      costPpp: 0
    }).costPppMinor).toBe(0);
  });

  test("keeps local and authoritative package inclusion pricing aligned on the same shared fixture", async () => {
    const settings = confirmedPricingSettings({
      menuSections: [{
        id: "menu",
        name: "Menu",
        items: [
          { id: "included-menu", name: "Included menu", price: 7, type: "per_event" },
          { id: "extra-menu", name: "Extra menu", price: 8, type: "per_event" }
        ]
      }]
    });
    const rawCatalog = {
      packages: [{
        id: "package-a",
        name: "Package A",
        ppp: 10,
        includedAddonIds: ["included-addon", "unselected-included-addon"],
        includedRentalIds: ["included-rental"],
        includedMenuItemIds: ["included-menu"]
      }],
      addons: [
        { id: "included-addon", name: "Included add-on", price: 3, type: "per_event" },
        { id: "unselected-included-addon", name: "Unselected included add-on", price: 9, type: "per_event" },
        { id: "extra-addon", name: "Extra add-on", price: 4, type: "per_event" }
      ],
      rentals: [
        { id: "included-rental", name: "Included rental", price: 5, type: "per_event" },
        { id: "extra-rental", name: "Extra rental", price: 6, type: "per_event" }
      ],
      settings
    };
    const localCatalog = normalizeCatalog(rawCatalog);
    const form = {
      pkg: "package-a",
      guests: 10,
      hours: 0,
      servers: 0,
      chefs: 0,
      bartenders: 0,
      style: "Drop-off",
      addons: ["included-addon", "extra-addon"],
      rentals: ["included-rental", "extra-rental"],
      menuItems: ["included-menu", "extra-menu"],
      addonQuantities: {},
      rentalQuantities: {},
      menuItemQuantities: {},
      milesRT: 0,
      taxRegion: "",
      seasonProfileId: "",
      payMethod: "card"
    };

    const localTotals = calculateQuote(form, localCatalog, localCatalog.settings);
    const authoritative = await calculateQuotePricingAuthoritative({
      db: buildPricingDb({
        settings,
        packages: rawCatalog.packages,
        addons: rawCatalog.addons,
        rentals: rawCatalog.rentals,
        menuItems: [
          { id: "included-menu", name: "Included menu", price: 7, pricingType: "per_event" },
          { id: "extra-menu", name: "Extra menu", price: 8, pricingType: "per_event" }
        ]
      }),
      data: {
        pricingInput: {
          organizationId: "org-a",
          event: {
            date: "2026-09-12",
            guests: 10,
            hours: 0,
            servers: 0,
            chefs: 0,
            bartenders: 0,
            milesRT: 0,
            taxRegionId: "",
            seasonProfileId: ""
          },
          selection: {
            package: {
              id: "package-a"
            },
            addons: ["included-addon", "extra-addon"],
            rentals: ["included-rental", "extra-rental"],
            menuItems: ["included-menu", "extra-menu"]
          }
        }
      },
      staff: pricingStaff
    });

    expect(localTotals.total).toBe(118);
    expect(localTotals.base).toBe(100);
    expect(localTotals.addons).toBe(4);
    expect(localTotals.rentals).toBe(6);
    expect(localTotals.menu).toBe(8);
    expect(authoritative.pricing.grandTotal).toBe(118);
    expect(localTotals.packageInclusions).toMatchObject({
      addons: [{ id: "included-addon", includedInPackage: true }],
      rentals: [{ id: "included-rental", includedInPackage: true }],
      menuItems: [{ id: "included-menu", includedInPackage: true }]
    });
    expect(authoritative.pricing.inputs.selection.package.inclusions).toMatchObject({
      addons: [{ id: "included-addon", includedInPackage: true, unitPrice: 0 }],
      rentals: [{ id: "included-rental", includedInPackage: true, unitPrice: 0 }],
      menuItems: [{ id: "included-menu", includedInPackage: true, unitPrice: 0 }]
    });
    expect(authoritative.pricing.inputs.selection.package.inclusions.addons)
      .not.toEqual(expect.arrayContaining([expect.objectContaining({ id: "unselected-included-addon" })]));
  });
});
