import { createRequire } from "node:module";
import { describe, expect, test } from "vitest";

const require = createRequire(import.meta.url);
const {
  PRICING_AUTHORITY,
  PricingEngineError,
  calculateQuotePricingAuthoritative,
  isCatalogPricingConfirmationCurrent
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
  settingsExists = true,
  packages = [{ id: "package-a", name: "Package A", ppp: 10 }],
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
                          exists: settingsExists,
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

function buildPricingRequest(event = {}) {
  return {
    pricingInput: {
      organizationId: "org-a",
      event: {
        date: "2026-09-12",
        guests: 10,
        hours: 2,
        servers: 0,
        chefs: 0,
        bartenders: 0,
        milesRT: 0,
        ...event
      },
      selection: {
        package: {
          id: "package-a"
        },
        addons: [],
        rentals: [],
        menuItems: []
      }
    }
  };
}

const pricingStaff = {
  uid: "staff-a",
  email: "admin@example.com",
  role: "admin",
  organizationId: "org-a"
};

function confirmedPricingSettings(overrides = {}) {
  return {
    pricingSetupConfirmed: true,
    catalogRevision: 4,
    pricingConfirmation: {
      actorUid: "staff-a",
      actorEmail: "admin@example.com",
      confirmedAtISO: "2026-08-06T15:00:00.000Z",
      confirmedCatalogRevision: 4
    },
    ...overrides
  };
}

describe("server-authoritative pricing setup safety", () => {
  test.each([
    ["missing", undefined, false],
    ["unconfirmed", { pricingSetupConfirmed: false }, true]
  ])("fails closed when pricing setup is %s", async (_label, settings, settingsExists) => {
    const operation = calculateQuotePricingAuthoritative({
      db: buildPricingDb({ settings, settingsExists }),
      data: buildPricingRequest(),
      staff: pricingStaff
    });

    await expect(operation).rejects.toMatchObject({
      name: "PricingEngineError",
      code: "failed-precondition",
      message: expect.stringMatching(/reviewed and confirmed/i)
    });
    await expect(operation).rejects.toBeInstanceOf(PricingEngineError);
  });

  test("fails closed when a confirmation receipt is missing, unattributed, or stale", async () => {
    expect(isCatalogPricingConfirmationCurrent(confirmedPricingSettings())).toBe(true);
    const invalidSettings = [
      { pricingSetupConfirmed: true, catalogRevision: 4, pricingConfirmation: null },
      confirmedPricingSettings({ catalogRevision: 5 }),
      confirmedPricingSettings({
        pricingConfirmation: {
          ...confirmedPricingSettings().pricingConfirmation,
          actorEmail: ""
        }
      })
    ];

    for (const settings of invalidSettings) {
      await expect(calculateQuotePricingAuthoritative({
        db: buildPricingDb({ settings }),
        data: buildPricingRequest(),
        staff: pricingStaff
      })).rejects.toMatchObject({
        code: "failed-precondition",
        message: expect.stringMatching(/current catalog revision/i)
      });
    }
  });

  test("keeps explicit empty pricing arrays empty and uses only explicit neutral scalar rates", async () => {
    const result = await calculateQuotePricingAuthoritative({
      db: buildPricingDb({
        settings: confirmedPricingSettings({
          serviceFeeTiers: [],
          taxRegions: [],
          defaultTaxRegion: "",
          depositPct: 0,
          seasonalProfiles: [],
          defaultSeasonProfile: "",
          bartenderRateTypes: [],
          defaultBartenderRateType: "",
          staffingRateTypes: [],
          defaultStaffingRateType: "",
          staffingLaborEnabled: true,
          perMileRate: 0,
          longDistancePerMileRate: 0,
          deliveryThresholdMiles: 0
        })
      }),
      data: buildPricingRequest({
        servers: 1,
        chefs: 1,
        bartenders: 1,
        milesRT: 10
      }),
      staff: pricingStaff
    });

    const { pricing } = result;
    expect(pricing.authority).toBe(PRICING_AUTHORITY);
    expect(pricing.grandTotal).toBe(100);
    expect(pricing.fees).toMatchObject({
      labor: 0,
      travel: 0,
      serviceFee: 0
    });
    expect(pricing.tax).toMatchObject({
      rate: 0,
      amount: 0
    });
    expect(pricing.deposit).toMatchObject({
      pct: 0,
      amount: 0
    });
    expect(pricing.rulesSnapshot).toMatchObject({
      serviceFeePctApplied: 0,
      taxRateApplied: 0,
      packageMultiplier: 1,
      addonMultiplier: 1,
      rentalMultiplier: 1
    });
    expect(pricing.rulesSnapshot.settingsSnapshot).toMatchObject({
      pricingSetupConfirmed: true,
      serviceFeeTiers: [],
      taxRegions: [],
      seasonalProfiles: [],
      bartenderRateTypes: [],
      staffingRateTypes: []
    });
    expect(pricing.rulesSnapshot.laborRateSnapshot).toMatchObject({
      bartenderRateApplied: 0,
      serverRateApplied: 0,
      chefRateApplied: 0
    });
  });

  test("uses explicitly configured scalar rates when their optional rate arrays are empty", async () => {
    const result = await calculateQuotePricingAuthoritative({
      db: buildPricingDb({
        settings: confirmedPricingSettings({
          serviceFeePct: 0.05,
          serviceFeeTiers: [],
          taxRate: 0.02,
          taxRegions: [],
          depositPct: 0,
          seasonalProfiles: [],
          bartenderRate: 7,
          bartenderRateTypes: [],
          serverRate: 8,
          chefRate: 9,
          staffingRateTypes: [],
          staffingLaborEnabled: true,
          perMileRate: 0,
          longDistancePerMileRate: 0,
          deliveryThresholdMiles: 0
        })
      }),
      data: buildPricingRequest({
        servers: 1,
        chefs: 1,
        bartenders: 1
      }),
      staff: pricingStaff
    });

    expect(result.pricing.fees.labor).toBe(48);
    expect(result.pricing.fees.serviceFee).toBeCloseTo(7.4);
    expect(result.pricing.tax.rate).toBe(0.02);
    expect(result.pricing.tax.amount).toBeCloseTo(2.148);
    expect(result.pricing.grandTotal).toBeCloseTo(157.548);
    expect(result.pricing.rulesSnapshot.settingsSnapshot).toMatchObject({
      serviceFeePct: 0.05,
      serviceFeeTiers: [],
      taxRate: 0.02,
      taxRegions: [],
      seasonalProfiles: [],
      bartenderRateTypes: [],
      staffingRateTypes: []
    });
    expect(result.pricing.rulesSnapshot.laborRateSnapshot).toMatchObject({
      bartenderRateApplied: 7,
      serverRateApplied: 8,
      chefRateApplied: 9
    });
  });

  test("preserves configured pricing arrays for confirmed tenants", async () => {
    const result = await calculateQuotePricingAuthoritative({
      db: buildPricingDb({
        settings: confirmedPricingSettings({
          serviceFeePct: 0.2,
          serviceFeeTiers: [
            { id: "configured", minGuests: 0, maxGuests: 9999, pct: 0.1 }
          ],
          taxRate: 0.1,
          taxRegions: [
            { id: "configured", name: "Configured Region", rate: 0.05 }
          ],
          defaultTaxRegion: "configured",
          depositPct: 0.25,
          seasonalProfiles: [
            {
              id: "configured",
              name: "Configured Season",
              startMonth: 1,
              startDay: 1,
              endMonth: 12,
              endDay: 31,
              packageMultiplier: 1.2,
              addonMultiplier: 1.1,
              rentalMultiplier: 1.05
            }
          ],
          defaultSeasonProfile: "configured",
          bartenderRate: 31,
          bartenderRateTypes: [
            { id: "configured", name: "Configured Bartender", rate: 31 }
          ],
          serverRate: 23,
          chefRate: 29,
          staffingRateTypes: [
            {
              id: "configured",
              name: "Configured Staffing",
              serverRate: 23,
              chefRate: 29
            }
          ],
          staffingLaborEnabled: true,
          perMileRate: 0,
          longDistancePerMileRate: 0,
          deliveryThresholdMiles: 0
        })
      }),
      data: buildPricingRequest(),
      staff: pricingStaff
    });

    expect(result.pricing).toMatchObject({
      subtotal: 120,
      fees: {
        serviceFee: 12
      },
      tax: {
        rate: 0.05,
        regionId: "configured"
      },
      deposit: {
        pct: 0.25
      }
    });
    expect(result.pricing.tax.amount).toBeCloseTo(6.6);
    expect(result.pricing.grandTotal).toBeCloseTo(138.6);
    expect(result.pricing.deposit.amount).toBeCloseTo(34.65);
    expect(result.pricing.rulesSnapshot).toMatchObject({
      serviceFeePctApplied: 0.1,
      seasonProfileId: "configured",
      packageMultiplier: 1.2
    });
    expect(result.pricing.rulesSnapshot.settingsSnapshot).toMatchObject({
      serviceFeeTiers: [
        { id: "configured", minGuests: 0, maxGuests: 9999, pct: 0.1 }
      ],
      taxRegions: [
        { id: "configured", name: "Configured Region", rate: 0.05 }
      ],
      bartenderRateTypes: [
        { id: "configured", name: "Configured Bartender", rate: 31 }
      ],
      staffingRateTypes: [
        {
          id: "configured",
          name: "Configured Staffing",
          serverRate: 23,
          chefRate: 29
        }
      ]
    });
  });

  test("uses authoritative package refs and never charges a selected inclusion twice", async () => {
    const request = buildPricingRequest();
    request.pricingInput.selection = {
      package: {
        id: "package-a",
        inclusions: {
          addons: [{ id: "spoofed-free-addon" }]
        }
      },
      addons: ["included-addon", "extra-addon"],
      rentals: ["included-rental", "extra-rental"],
      menuItems: ["included-menu", "extra-menu"]
    };
    const result = await calculateQuotePricingAuthoritative({
      db: buildPricingDb({
        settings: confirmedPricingSettings({
          serviceFeeTiers: [],
          taxRegions: [],
          depositPct: 0,
          seasonalProfiles: [],
          bartenderRateTypes: [],
          staffingRateTypes: [],
          staffingLaborEnabled: false,
          perMileRate: 0,
          longDistancePerMileRate: 0,
          deliveryThresholdMiles: 0
        }),
        packages: [{
          id: "package-a",
          name: "Package A",
          pppMinor: 1000,
          includedAddonIds: ["included-addon", "unselected-included-addon"],
          includedRentalIds: ["included-rental"],
          includedMenuItemIds: ["included-menu"]
        }],
        addons: [
          { id: "included-addon", name: "Included add-on", priceMinor: 300, pricingType: "per_event" },
          { id: "unselected-included-addon", name: "Unselected included add-on", priceMinor: 900, pricingType: "per_event" },
          { id: "extra-addon", name: "Extra add-on", priceMinor: 400, pricingType: "per_event" }
        ],
        rentals: [
          { id: "included-rental", name: "Included rental", priceMinor: 500, pricingType: "per_event" },
          { id: "extra-rental", name: "Extra rental", priceMinor: 600, pricingType: "per_event" }
        ],
        menuItems: [
          { id: "included-menu", name: "Included menu", priceMinor: 700, pricingType: "per_event" },
          { id: "extra-menu", name: "Extra menu", priceMinor: 800, pricingType: "per_event" }
        ]
      }),
      data: request,
      staff: pricingStaff
    });

    expect(result.pricing.grandTotal).toBe(118);
    expect(result.pricing.inputs.selection.package.inclusions).toMatchObject({
      addons: [{ id: "included-addon", unitPrice: 0, includedInPackage: true }],
      rentals: [{ id: "included-rental", unitPrice: 0, includedInPackage: true }],
      menuItems: [{ id: "included-menu", unitPrice: 0, includedInPackage: true }]
    });
    expect(result.pricing.inputs.selection.package.inclusions.addons)
      .not.toEqual(expect.arrayContaining([expect.objectContaining({ id: "spoofed-free-addon" })]));
    expect(result.pricing.inputs.selection.package.inclusions.addons)
      .not.toEqual(expect.arrayContaining([expect.objectContaining({ id: "unselected-included-addon" })]));
    expect(result.pricing.lineItems.filter((line) => line.meta?.includedInPackage))
      .toHaveLength(3);
  });

  test("fails closed when an authoritative package inclusion is missing", async () => {
    await expect(calculateQuotePricingAuthoritative({
      db: buildPricingDb({
        settings: confirmedPricingSettings(),
        packages: [{
          id: "package-a",
          name: "Package A",
          pppMinor: 1000,
          includedAddonIds: ["missing-addon"],
          includedRentalIds: [],
          includedMenuItemIds: []
        }]
      }),
      data: buildPricingRequest(),
      staff: pricingStaff
    })).rejects.toMatchObject({
      code: "failed-precondition",
      message: expect.stringMatching(/includes unavailable add-on missing-addon/i)
    });
  });
});
