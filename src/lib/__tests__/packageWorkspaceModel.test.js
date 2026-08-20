import { describe, expect, test } from "vitest";
import { normalizeCatalog } from "../../data/mockCatalog";
import {
  buildPackageWorkspaceCollectionModel,
  buildPackageWorkspaceModel,
  PACKAGE_WORKSPACE_MODEL_VERSION
} from "../packageWorkspaceModel";

function buildCatalog(overrides = {}) {
  return normalizeCatalog({
    packages: [],
    addons: [],
    rentals: [],
    settings: {
      pricingSetupConfirmed: true,
      catalogRevision: 4,
      pricingConfirmation: {
        actorUid: "owner-1",
        actorEmail: "owner@example.com",
        confirmedAtISO: "2026-08-18T14:00:00.000Z",
        confirmedCatalogRevision: 4
      },
      menuSections: [{
        id: "mains",
        name: "Mains",
        items: [{ id: "salad", name: "Salad", price: 0, type: "per_event" }]
      }]
    },
    ...overrides
  });
}

describe("buildPackageWorkspaceModel", () => {
  test("treats a recorded zero cost as valid economics and keeps draft lifecycle separate from readiness", () => {
    const catalog = buildCatalog();
    const packageRecord = {
      id: "office-lunch",
      name: "Office Lunch",
      ppp: 20,
      costPpp: 0,
      active: false,
      includedMenuItemIds: ["salad"],
      includedAddonIds: [],
      includedRentalIds: []
    };
    const model = buildPackageWorkspaceModel({ packageRecord, catalog });

    expect(model.modelVersion).toBe(PACKAGE_WORKSPACE_MODEL_VERSION);
    expect(model.available).toBe(true);
    expect(model.package).toMatchObject({
      id: "office-lunch",
      lifecycle: "draft",
      lifecycleSource: "legacy_active_boolean",
      active: false
    });
    expect(model.commercialSummary).toMatchObject({
      pricePerPerson: 20,
      costPerPerson: 0,
      contributionPerPerson: 20,
      marginPct: 1,
      marginState: "available",
      includedCounts: {
        menuItems: 1,
        addons: 0,
        rentals: 0,
        total: 1
      }
    });
    expect(model.readiness).toBe("ready");
    expect(model.reasons).toEqual([]);
    expect(model.nextAction).toBeNull();
  });

  test("orders blocker reasons first and names missing plus invalid inclusions deterministically", () => {
    const catalog = buildCatalog();
    const model = buildPackageWorkspaceModel({
      packageRecord: {
        id: "pkg-a",
        name: "   ",
        ppp: 0,
        costPpp: 6,
        includedMenuItemIds: ["missing-menu", "missing-menu", ""],
        includedAddonIds: [],
        includedRentalIds: []
      },
      catalog
    });

    expect(model.readiness).toBe("incomplete");
    expect(model.reasons.map((reason) => reason.code)).toEqual([
      "missing_name",
      "missing_positive_price",
      "missing_or_invalid_reference",
      "margin_unavailable"
    ]);
    expect(model.referenceHealth.counts).toMatchObject({
      total: 3,
      missing: 1,
      invalid: 2,
      inactive: 0,
      blocking: 3
    });
    expect(model.nextAction).toEqual({
      code: "missing_name",
      label: "Add package name",
      targetSection: "overview",
      targetField: "name"
    });
  });

  test("keeps inactive references, missing cost, and stale pricing confirmation as ordered review reasons", () => {
    const catalog = buildCatalog({
      addons: [{ id: "retired-addon", name: "Retired Add-on", active: false, type: "per_event", price: 5 }],
      settings: {
        pricingSetupConfirmed: true,
        catalogRevision: 5,
        pricingConfirmation: {
          actorUid: "owner-1",
          actorEmail: "owner@example.com",
          confirmedAtISO: "2026-08-18T14:00:00.000Z",
          confirmedCatalogRevision: 4
        }
      }
    });
    const model = buildPackageWorkspaceModel({
      packageRecord: {
        id: "pkg-b",
        name: "Review Package",
        ppp: 18,
        costPpp: null,
        active: true,
        includedMenuItemIds: [],
        includedAddonIds: ["retired-addon"],
        includedRentalIds: []
      },
      catalog
    });

    expect(model.readiness).toBe("needs_review");
    expect(model.reasons.map((reason) => reason.code)).toEqual([
      "inactive_reference",
      "missing_package_cost",
      "margin_unavailable",
      "catalog_pricing_unconfirmed"
    ]);
    expect(model.referenceHealth.counts).toMatchObject({
      inactive: 1,
      review: 1
    });
    expect(model.nextAction).toEqual({
      code: "inactive_reference",
      label: "Resolve inactive inclusions",
      targetSection: "includes",
      targetField: ""
    });
  });
});

describe("buildPackageWorkspaceCollectionModel", () => {
  test("sorts packages deterministically by display label and falls back to the first package when no selection is supplied", () => {
    const catalog = buildCatalog({
      packages: [
        { id: "zebra", name: "", ppp: 10, active: true },
        { id: "bravo", name: "Bravo", ppp: 10, active: true },
        { id: "alpha-2", name: "Alpha", ppp: 10, active: true },
        { id: "alpha-1", name: "Alpha", ppp: 10, active: true }
      ]
    });

    const collection = buildPackageWorkspaceCollectionModel({ catalog });

    expect(collection.packageIds).toEqual(["alpha-1", "alpha-2", "bravo", "zebra"]);
    expect(collection.selectedPackageId).toBe("alpha-1");
    expect(collection.selectedPackage?.package?.id).toBe("alpha-1");
  });
});
