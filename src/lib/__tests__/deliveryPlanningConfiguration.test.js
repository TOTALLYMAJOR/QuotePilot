import { describe, expect, test } from "vitest";
import {
  assessDeliveryPlanningConfiguration,
  buildDeliveryPlanningDraftCatalog,
  parseDeliveryPlanningSourceDrafts,
  validateDeliveryPlanningConfiguration
} from "../deliveryPlanningConfiguration";

function fixture({ enabled = false } = {}) {
  const declared = {
    publicationState: "published",
    declaredBy: "operator-42",
    declaredAtISO: "2026-09-14T12:00:00.000Z",
    provenance: "Operator-reviewed staffed-buffet pilot"
  };
  return {
    packages: [{
      id: "buffet-offer",
      name: "Staffed buffet",
      active: true,
      deliveryBlueprintRef: { id: "staffed-buffet", revision: "1" }
    }],
    settings: {
      deliveryPlanningEnabled: enabled,
      menuSections: [{
        id: "mains",
        items: [{ id: "roasted-chicken", name: "Roasted chicken" }]
      }],
      deliveryBlueprints: [{
        schemaVersion: "delivery-blueprint-v1",
        id: "staffed-buffet",
        revision: "1",
        label: "Staffed buffet",
        ...declared,
        compatibleServiceFormats: ["Buffet"],
        workBlocks: [{
          id: "kitchen-prep",
          label: "Kitchen prep",
          timing: { anchor: "service_start", offsetMinutes: -180, durationMinutes: 120 },
          requiredCapabilities: ["kitchen-prep"]
        }],
        productionComponents: [{
          componentId: "roasted-chicken",
          label: "Roasted chicken",
          required: true,
          quantityPolicyRef: { id: "chicken-portions", revision: "3" }
        }]
      }],
      quantityPolicies: [{
        schemaVersion: "quantity-policy-v1",
        id: "chicken-portions",
        revision: "3",
        ...declared,
        input: { kind: "guest_count", minimumGuestCount: 10, maximumGuestCount: 300 },
        output: { unitId: "portion", numerator: 6, denominator: 5, rounding: "ceil" },
        ingredients: [{
          ingredientId: "chicken-breast",
          unitId: "lb",
          quantityPerOutputMicros: 100_000,
          purchasingPackRef: { id: "chicken-case", revision: "2" }
        }]
      }],
      purchasingPacks: [{
        id: "chicken-case",
        revision: "2",
        publicationState: "published",
        unitId: "lb",
        quantityMicros: 5_000_000
      }]
    }
  };
}

describe("Delivery Planning Library configuration", () => {
  test("qualifies exact published revisions without activating the tenant draft", () => {
    const assessment = assessDeliveryPlanningConfiguration(fixture());

    expect(assessment).toMatchObject({
      state: "ready",
      enabled: false,
      canEnable: true,
      counts: {
        activeOffers: 1,
        boundOffers: 1,
        publishedBlueprints: 1,
        eligibleBlueprints: 1,
        publishedPolicies: 1,
        publishedPacks: 1
      }
    });
    expect(assessment.issues).toEqual([]);
  });

  test("distinguishes a valid enabled draft from provider or human activation proof", () => {
    const assessment = validateDeliveryPlanningConfiguration(fixture({ enabled: true }));
    expect(assessment.state).toBe("enabled");
    expect(assessment.canEnable).toBe(true);
    expect(assessment).not.toHaveProperty("receipt");
  });

  test("blocks an ID-only quantity-policy reference before activation", () => {
    const catalog = fixture({ enabled: true });
    catalog.settings.deliveryBlueprints[0].productionComponents[0].quantityPolicyRef = "chicken-portions";

    const assessment = assessDeliveryPlanningConfiguration(catalog);
    expect(assessment.canEnable).toBe(false);
    expect(assessment.issues).toEqual(expect.arrayContaining([
      expect.objectContaining({ id: "quantity_policy_reference_inexact" })
    ]));
    expect(() => validateDeliveryPlanningConfiguration(catalog)).toThrow(/exact quantity-policy ID and revision/);
  });

  test("blocks a stale purchasing-pack revision and unit mismatch", () => {
    const catalog = fixture({ enabled: true });
    catalog.settings.quantityPolicies[0].ingredients[0].purchasingPackRef.revision = "1";

    expect(assessDeliveryPlanningConfiguration(catalog).issues).toEqual(expect.arrayContaining([
      expect.objectContaining({ id: "purchasing_pack_reference_stale" })
    ]));
    expect(() => validateDeliveryPlanningConfiguration(catalog)).toThrow(/published pack/);
  });

  test("allows incomplete sources only while they remain explicitly draft and inactive", () => {
    const catalog = fixture();
    catalog.packages[0].deliveryBlueprintRef = null;
    catalog.settings.deliveryBlueprints = [{
      schemaVersion: "delivery-blueprint-v1",
      id: "unfinished",
      revision: "1",
      publicationState: "draft"
    }];
    catalog.settings.quantityPolicies = [];
    catalog.settings.purchasingPacks = [];

    const assessment = validateDeliveryPlanningConfiguration(catalog);
    expect(assessment.state).toBe("blocked");
    expect(assessment.enabled).toBe(false);
    expect(assessment.canEnable).toBe(false);
  });

  test("parses the three source arrays and rejects malformed source JSON", () => {
    const catalog = fixture();
    const drafts = {
      deliveryBlueprints: JSON.stringify(catalog.settings.deliveryBlueprints),
      quantityPolicies: JSON.stringify(catalog.settings.quantityPolicies),
      purchasingPacks: JSON.stringify(catalog.settings.purchasingPacks)
    };
    expect(buildDeliveryPlanningDraftCatalog({ ...catalog, settings: {} }, drafts).settings)
      .toMatchObject({ deliveryBlueprints: catalog.settings.deliveryBlueprints });

    const malformed = parseDeliveryPlanningSourceDrafts({ ...drafts, quantityPolicies: "{" });
    expect(malformed.ok).toBe(false);
    expect(malformed.issues[0]).toMatchObject({ id: "source_json_invalid", path: "quantityPolicies" });
  });
});
