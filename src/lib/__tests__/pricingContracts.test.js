import { describe, expect, test } from "vitest";
import {
  CLIENT_PREVIEW_AUTHORITY,
  PRICING_VERSION,
  buildPricingSnapshotFromClientTotals,
  deriveLegacyPricingSnapshot,
  normalizePricingInput,
  normalizePricingOutput,
  normalizeVersionMetadata
} from "../pricingContracts";

describe("pricingContracts", () => {
  test("normalizes pricing input deterministically", () => {
    const payload = {
      organizationId: "org-alpha",
      quoteId: "q-100",
      quoteNumber: "Q-100",
      actor: {
        uid: "staff-1",
        email: "STAFF@EXAMPLE.COM",
        role: "sales"
      },
      event: {
        name: "Spring Gala",
        eventTypeId: "wedding",
        date: "2026-05-20",
        time: "18:00",
        venue: "Pine Hall",
        guests: 120,
        hours: 5,
        style: "Plated",
        bartenders: 2
      },
      selection: {
        package: {
          id: "classic",
          name: "Classic",
          pricingType: "per_person",
          price: 24,
          inclusions: {
            menuItems: [{ id: "included-side", name: "Included Side", includedInPackage: true }],
            addons: [],
            rentals: []
          }
        },
        addons: [{ id: "dessert", name: "Dessert", pricingType: "per_person", price: 4 }],
        rentals: [{ id: "linens", name: "Linens", pricingType: "per_item", price: 75, quantity: 6 }],
        menuItems: [{ id: "ribs", name: "Smoked Ribs", pricingType: "per_event", price: 300 }],
        addonQuantities: { dessert: 120 },
        rentalQuantities: { linens: 6 },
        menuItemQuantities: { ribs: 1 },
        milesRT: 22,
        taxRegion: "local",
        seasonProfileId: "standard"
      },
      settings: {
        serviceFeePct: 0.18,
        taxRate: 0.1,
        depositPct: 0.3,
        pricingSettingsVersion: 4,
        pricingSettingsUpdatedAtISO: "2026-03-20T00:00:00.000Z"
      }
    };

    const first = normalizePricingInput(payload);
    const second = normalizePricingInput(payload);

    expect(second).toEqual(first);
    expect(first.selection.package.pricingMode).toBe("per_person");
    expect(first.selection.package.inclusions.menuItems).toEqual([
      expect.objectContaining({ id: "included-side", name: "Included Side", includedInPackage: true })
    ]);
    expect(first.selection.addons[0].pricingMode).toBe("per_person");
    expect(first.selection.rentals[0].pricingMode).toBe("per_item");
    expect(first.selection.menuItems[0].pricingMode).toBe("per_event");
    expect(first.actor.email).toBe("staff@example.com");
    expect(first.settings.pricingSettingsVersion).toBe(4);
    expect(first.settings.pricingSettingsUpdatedAtISO).toBe("2026-03-20T00:00:00.000Z");
  });

  test("builds normalized client-preview pricing snapshot from totals", () => {
    const snapshot = buildPricingSnapshotFromClientTotals({
      form: {
        eventName: "Corporate Dinner",
        eventTypeId: "corporate",
        date: "2026-06-10",
        time: "19:00",
        venue: "City Center",
        venueAddress: "55 Main St",
        guests: 90,
        hours: 4,
        style: "Buffet",
        bartenders: 1,
        pkg: "premium",
        addons: ["dessert"],
        rentals: ["linens"],
        menuItems: ["ribs"],
        addonQuantities: { dessert: 90 },
        rentalQuantities: { linens: 5 },
        menuItemQuantities: { ribs: 1 },
        milesRT: 18,
        taxRegion: "local",
        seasonProfileId: "standard"
      },
      totals: {
        selectedPkg: { id: "premium", name: "Premium" },
        base: 2400,
        addons: 360,
        rentals: 250,
        menu: 300,
        labor: 880,
        bartenderLabor: 120,
        travel: 20,
        serviceFee: 758.4,
        tax: 380.84,
        total: 5349.24,
        deposit: 1604.772,
        serviceFeePctApplied: 0.18,
        taxRateApplied: 0.1,
        taxRegionId: "local",
        taxRegionName: "Local",
        seasonProfileId: "standard",
        seasonProfileName: "Standard",
        packageMultiplier: 1,
        addonMultiplier: 1,
        rentalMultiplier: 1
      },
      settings: {
        serviceFeePct: 0.18,
        taxRate: 0.1,
        depositPct: 0.3,
        serverCostRate: 14,
        chefCostRate: 22,
        bartenderCostRate: 18,
        targetMarginPct: 0.42,
        pricingSettingsVersion: 7,
        pricingSettingsUpdatedAtISO: "2026-03-20T00:00:00.000Z"
      },
      catalog: {
        packages: [{ id: "premium", name: "Premium", costPpp: 13 }],
        addons: [{ id: "dessert", name: "Dessert", pricingType: "per_person", cost: 1.5 }],
        rentals: [{ id: "linens", name: "Linens", pricingType: "per_item", cost: 18 }],
        settings: {
          menuSections: [
            {
              id: "mains",
              items: [{ id: "ribs", name: "Ribs", pricingType: "per_event", cost: 90 }]
            }
          ]
        }
      },
      organizationId: "org-alpha",
      quoteId: "q-200",
      quoteNumber: "Q-200",
      actor: {
        uid: "staff-2",
        email: "ops@example.com",
        role: "sales"
      },
      reason: "phase2-contract-test"
    });

    expect(snapshot.pricingVersion).toBe(PRICING_VERSION);
    expect(snapshot.authority).toBe(CLIENT_PREVIEW_AUTHORITY);
    expect(snapshot.discountTotal).toBe(0);
    expect(snapshot.subtotal).toBeCloseTo(4210, 6);
    expect(snapshot.grandTotal).toBeCloseTo(5349.24, 6);
    expect(snapshot.deposit.amount).toBeCloseTo(1604.772, 6);
    expect(snapshot.lineItems.length).toBeGreaterThanOrEqual(9);
    expect(snapshot.commercialSnapshot).toMatchObject({
      package: {
        id: "premium",
        unitCostPpp: 13,
        extendedCost: 1170
      },
      addons: [
        expect.objectContaining({ id: "dessert", extendedCost: 135 })
      ],
      rentals: [
        expect.objectContaining({ id: "linens", extendedCost: 90 })
      ],
      menuItems: [
        expect.objectContaining({ id: "ribs", extendedCost: 90 })
      ],
      staffing: {
        roles: [
          expect.objectContaining({ id: "servers", extendedCost: 0 }),
          expect.objectContaining({ id: "chefs", extendedCost: 0 }),
          expect.objectContaining({ id: "bartenders", extendedCost: 72 })
        ]
      },
      targetMarginPct: 0.42
    });
    expect(snapshot.rulesSnapshot.reason).toBe("phase2-contract-test");
    expect(snapshot.rulesSnapshot.pricingSettingsVersion).toBe(7);
    expect(snapshot.rulesSnapshot.pricingSettingsUpdatedAtISO).toBe("2026-03-20T00:00:00.000Z");
  });

  test("derives normalized snapshot for legacy quote without pricing object", () => {
    const legacyQuote = {
      id: "legacy-1",
      quoteNumber: "Q-LEGACY-1",
      organizationId: "org-alpha",
      ownerUid: "staff-1",
      ownerEmail: "staff@example.com",
      createdAtISO: "2026-03-01T00:00:00.000Z",
      updatedAtISO: "2026-03-02T00:00:00.000Z",
      source: "firebase",
      event: {
        name: "Legacy Event",
        eventTypeId: "wedding",
        date: "2026-07-11",
        time: "17:30",
        venue: "Legacy Hall",
        venueAddress: "1 Legacy Way",
        guests: 110,
        hours: 4,
        style: "Buffet",
        bartenders: 1
      },
      selection: {
        packageId: "classic",
        packageName: "Classic",
        taxRegion: "local",
        seasonProfileId: "standard"
      },
      quoteMeta: {
        depositPct: 0.3,
        pricingSettingsVersion: 2,
        pricingSettingsUpdatedAtISO: "2026-03-01T00:00:00.000Z"
      },
      totals: {
        base: 2200,
        addons: 350,
        rentals: 200,
        menu: 300,
        labor: 820,
        travel: 16,
        serviceFee: 699.12,
        tax: 354.91,
        total: 4940.03,
        deposit: 1482.009,
        serviceFeePctApplied: 0.18,
        taxRateApplied: 0.1,
        taxRegionId: "local",
        taxRegionName: "Local",
        seasonProfileId: "standard",
        seasonProfileName: "Standard"
      }
    };

    const derived = deriveLegacyPricingSnapshot(legacyQuote);
    expect(derived.pricingVersion).toBe(PRICING_VERSION);
    expect(derived.authority).toBe("legacy_derived");
    expect(derived.grandTotal).toBeCloseTo(legacyQuote.totals.total, 6);
    expect(derived.deposit.amount).toBeCloseTo(legacyQuote.totals.deposit, 6);
    expect(derived.inputs.organizationId).toBe("org-alpha");
    expect(derived.tax.regionName).toBe("Local");
    expect(derived.rulesSnapshot.pricingSettingsVersion).toBe(2);
    expect(derived.rulesSnapshot.pricingSettingsUpdatedAtISO).toBe("2026-03-01T00:00:00.000Z");
  });

  test("normalizes output and version metadata defaults", () => {
    const output = normalizePricingOutput({
      lineItems: [{ id: "x", category: "package", pricingMode: "invalid", total: 10 }],
      tax: { rate: 0.08, amount: 3, regionId: "local", regionName: "Local" },
      deposit: { pct: 0.3, amount: 12 },
      subtotal: 50,
      grandTotal: 53
    });
    const versionMeta = normalizeVersionMetadata({});

    expect(output.pricingVersion).toBe(PRICING_VERSION);
    expect(output.lineItems[0].pricingMode).toBe("per_event");
    expect(output.discountTotal).toBe(0);
    expect(versionMeta.versionNumber).toBe(1);
    expect(versionMeta.reason).toBe("unspecified");
    expect(versionMeta.createdAt).toBe("");
  });
});
