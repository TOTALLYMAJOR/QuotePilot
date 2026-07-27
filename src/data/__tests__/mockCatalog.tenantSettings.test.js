import { describe, expect, test } from "vitest";
import { DEFAULT_SETTINGS, normalizeCatalog } from "../mockCatalog";

function tenantCatalog(settings = {}) {
  return normalizeCatalog({
    packages: [],
    addons: [],
    rentals: [],
    settings
  });
}

describe("tenant catalog identity normalization", () => {
  test("preserves intentionally blank tenant contact, logo, and crew fields", () => {
    const catalog = tenantCatalog({
      brandName: "MBMapps",
      brandLogoUrl: "",
      brandCrew: [],
      quotePreparedBy: "",
      businessPhone: "",
      businessEmail: "",
      businessAddress: "",
      acceptanceEmail: ""
    });

    expect(catalog.settings).toMatchObject({
      brandName: "MBMapps",
      brandLogoUrl: "",
      brandCrew: [],
      quotePreparedBy: "",
      businessPhone: "",
      businessEmail: "",
      businessAddress: "",
      acceptanceEmail: ""
    });
  });

  test("uses neutral appearance fallbacks for a custom tenant with legacy missing colors", () => {
    const catalog = tenantCatalog({ brandName: "MBMapps" });

    expect(catalog.settings.brandPrimaryColor).toBe("#1f2937");
    expect(catalog.settings.brandBackgroundStart).toBe("#f3f4f6");
    expect(catalog.settings.heroHeadline).toBe("MBMapps Quote Operations");
  });

  test("preserves tenant-selected colors across normalization", () => {
    const catalog = tenantCatalog({
      brandName: "MBMapps",
      brandPrimaryColor: "#123456",
      brandAccentColor: "#abcdef",
      brandBackgroundStart: "#102030",
      brandBackgroundMid: "#203040",
      brandBackgroundEnd: "#304050"
    });

    expect(catalog.settings).toMatchObject({
      brandPrimaryColor: "#123456",
      brandAccentColor: "#abcdef",
      brandBackgroundStart: "#102030",
      brandBackgroundMid: "#203040",
      brandBackgroundEnd: "#304050"
    });
  });

  test("retains legacy defaults when tenant identity settings are missing", () => {
    const catalog = tenantCatalog();

    expect(catalog.settings.brandName).toBe(DEFAULT_SETTINGS.brandName);
    expect(catalog.settings.businessAddress).toBe(DEFAULT_SETTINGS.businessAddress);
    expect(catalog.settings.brandCrew).toEqual(DEFAULT_SETTINGS.brandCrew);
  });

  test("does not synthesize quote templates when the tenant has no matching packages", () => {
    const blankCatalog = tenantCatalog({
      brandName: "New Tenant"
    });
    const configuredCatalog = normalizeCatalog({
      packages: [{ id: "owner-package", name: "Owner Package", ppp: 42 }],
      addons: [],
      rentals: [],
      settings: {
        brandName: "New Tenant",
        eventTemplates: [
          {
            id: "owner-event",
            name: "Owner Event",
            pkg: "owner-package"
          },
          {
            id: "legacy-event",
            name: "Legacy Event",
            pkg: "classic"
          }
        ]
      }
    });

    expect(blankCatalog.settings.eventTemplates).toEqual([]);
    expect(configuredCatalog.settings.eventTemplates.map((item) => item.id)).toEqual(["owner-event"]);
  });

  test("preserves an explicitly neutral, unconfirmed pricing baseline", () => {
    const catalog = tenantCatalog({
      pricingSetupConfirmed: false,
      serviceFeePct: 0,
      serviceFeeTiers: [{ id: "unconfigured", minGuests: 0, maxGuests: 9999, pct: 0 }],
      taxRate: 0,
      taxRegions: [{ id: "unconfigured", name: "Not configured", rate: 0 }],
      defaultTaxRegion: "unconfigured",
      depositPct: 0,
      perMileRate: 0,
      longDistancePerMileRate: 0,
      bartenderRate: 0,
      bartenderRateTypes: [{ id: "unconfigured", name: "Unconfigured bartender rate", rate: 0 }],
      serverRate: 0,
      chefRate: 0,
      staffingRateTypes: [{
        id: "unconfigured",
        name: "Unconfigured staffing rate",
        serverRate: 0,
        chefRate: 0
      }],
      staffingLaborEnabled: false,
      eventTemplates: [],
      upsellRules: [],
      seasonalProfiles: [{
        id: "standard",
        name: "Standard pricing",
        startMonth: 1,
        startDay: 1,
        endMonth: 12,
        endDay: 31,
        packageMultiplier: 1,
        addonMultiplier: 1,
        rentalMultiplier: 1
      }],
      defaultSeasonProfile: "standard"
    });

    expect(catalog.settings).toMatchObject({
      pricingSetupConfirmed: false,
      serviceFeePct: 0,
      taxRate: 0,
      depositPct: 0,
      perMileRate: 0,
      longDistancePerMileRate: 0,
      bartenderRate: 0,
      serverRate: 0,
      chefRate: 0,
      staffingLaborEnabled: false,
      eventTemplates: [],
      upsellRules: [],
      defaultSeasonProfile: "standard"
    });
    expect(catalog.settings.serviceFeeTiers).toEqual([
      { id: "unconfigured", minGuests: 0, maxGuests: 9999, pct: 0 }
    ]);
    expect(catalog.settings.taxRegions).toEqual([
      { id: "unconfigured", name: "Not configured", rate: 0 }
    ]);
  });

  test("does not repopulate explicitly empty pricing arrays with legacy rates", () => {
    const neutralCatalog = tenantCatalog({
      pricingSetupConfirmed: true,
      serviceFeeTiers: [],
      taxRegions: [],
      seasonalProfiles: [],
      bartenderRateTypes: [],
      staffingRateTypes: [],
      depositPct: 0,
      perMileRate: 0,
      longDistancePerMileRate: 0,
      deliveryThresholdMiles: 0
    });
    const scalarCatalog = tenantCatalog({
      pricingSetupConfirmed: true,
      serviceFeePct: 0.05,
      serviceFeeTiers: [],
      taxRate: 0.02,
      taxRegions: [],
      seasonalProfiles: [],
      bartenderRate: 7,
      bartenderRateTypes: [],
      serverRate: 8,
      chefRate: 9,
      staffingRateTypes: []
    });

    expect(neutralCatalog.settings).toMatchObject({
      serviceFeePct: 0,
      serviceFeeTiers: [],
      taxRate: 0,
      taxRegions: [],
      defaultTaxRegion: "",
      seasonalProfiles: [],
      bartenderRate: 0,
      bartenderRateTypes: [],
      defaultBartenderRateType: "",
      serverRate: 0,
      chefRate: 0,
      staffingRateTypes: [],
      defaultStaffingRateType: ""
    });
    expect(scalarCatalog.settings).toMatchObject({
      serviceFeePct: 0.05,
      serviceFeeTiers: [],
      taxRate: 0.02,
      taxRegions: [],
      seasonalProfiles: [],
      bartenderRate: 7,
      bartenderRateTypes: [],
      serverRate: 8,
      chefRate: 9,
      staffingRateTypes: []
    });
  });
});
