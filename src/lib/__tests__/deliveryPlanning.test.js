import { describe, expect, test } from "vitest";
import { normalizeCatalog, toStorageCatalog } from "../../data/mockCatalog";
import { packageWriteShape } from "../catalogWriteShapes";
import {
  buildDeliveryPlanningContext,
  compileDeliveryProposal,
  createDeliveryHandoff,
  keepDeliveryOverride,
  useGeneratedDeliveryQuantity
} from "../deliveryPlanning";

function fixture(overrides = {}) {
  const blueprint = {
    schemaVersion: "delivery-blueprint-v1",
    id: "staffed-buffet",
    revision: "7",
    label: "Staffed buffet",
    publicationState: "published",
    declaredBy: "operator-42",
    declaredAtISO: "2026-09-01T14:00:00.000Z",
    provenance: "tenant-reviewed pilot",
    compatibleServiceFormats: ["Buffet"],
    workBlocks: [{
      id: "kitchen-prep",
      label: "Kitchen prep",
      timing: { anchor: "service_start", offsetMinutes: -240, durationMinutes: 180 },
      requiredCapabilities: ["kitchen-prep"]
    }, {
      id: "buffet-service",
      label: "Buffet service",
      timing: { anchor: "service_start", offsetMinutes: -30, durationMinutes: 210 },
      requiredCapabilities: ["buffet-service"]
    }],
    productionComponents: [{
      componentId: "chicken",
      label: "Roasted chicken",
      required: true,
      quantityPolicyRef: { id: "chicken-portions", revision: "4" }
    }, {
      componentId: "tea",
      label: "Sweet tea",
      required: false,
      quantityPolicyRef: { id: "tea-servings", revision: "2" }
    }],
    compatibleAlternativeBlueprintRefs: [{ id: "approved-drop-off", revision: "3" }]
  };
  const policies = [{
    schemaVersion: "quantity-policy-v1",
    id: "chicken-portions",
    revision: "4",
    publicationState: "published",
    declaredBy: "operator-42",
    declaredAtISO: "2026-09-01T14:00:00.000Z",
    provenance: "tenant production review",
    input: { kind: "guest_count", minimumGuestCount: 10, maximumGuestCount: 250 },
    output: { unitId: "portion", numerator: 6, denominator: 5, rounding: "ceil" },
    ingredients: [{
      ingredientId: "chicken-breast",
      label: "Chicken breast",
      unitId: "lb",
      quantityPerOutputMicros: 100_000,
      purchasingPackRef: { id: "chicken-case", revision: "2" }
    }]
  }, {
    schemaVersion: "quantity-policy-v1",
    id: "tea-servings",
    revision: "2",
    publicationState: "published",
    declaredBy: "operator-42",
    declaredAtISO: "2026-09-01T14:00:00.000Z",
    provenance: "tenant beverage review",
    input: { kind: "guest_count", minimumGuestCount: 10, maximumGuestCount: 250 },
    output: { unitId: "serving", numerator: 1, denominator: 1, rounding: "ceil" },
    ingredients: []
  }];
  const catalog = {
    packages: [{
      id: "premium",
      name: "Premium",
      deliveryBlueprintRef: { id: blueprint.id, revision: blueprint.revision }
    }],
    settings: {
      catalogRevision: 12,
      deliveryPlanningEnabled: true,
      deliveryBlueprints: [blueprint],
      quantityPolicies: policies,
      purchasingPacks: [{
        schemaVersion: "purchasing-pack-v1",
        id: "chicken-case",
        revision: "2",
        publicationState: "published",
        unitId: "lb",
        quantityMicros: 5_000_000
      }],
      menuSections: [{
        id: "mains",
        name: "Mains",
        items: [{ id: "chicken", name: "Roasted chicken" }, { id: "tea", name: "Sweet tea" }]
      }]
    }
  };
  const form = {
    pkg: "premium",
    style: "Buffet",
    guests: 50,
    menuItems: ["chicken", "tea"]
  };
  return { form, catalog, settings: catalog.settings, ...overrides };
}

describe("Delivery Planning compiler", () => {
  test("deterministically compiles declared work, production, and ingredient demand without assuming stock", () => {
    const input = fixture();
    const first = buildDeliveryPlanningContext(input);
    const second = buildDeliveryPlanningContext(input);

    expect(first).toEqual(second);
    expect(first.schemaVersion).toBe("delivery-proposal-v1");
    expect(first.authority).toBe("session_only_advisory_projection");
    expect(first).not.toHaveProperty("readiness");
    expect(first.workBlocks.map((block) => block.id)).toEqual(["kitchen-prep", "buffet-service"]);
    expect(first.productionOutputs[0]).toMatchObject({
      componentId: "chicken",
      billingQuantity: 50,
      generatedQuantity: 60,
      productionQuantity: 60,
      unitId: "portion"
    });
    expect(first.ingredientDemand[0].requiredQuantityMicros).toBe(6_000_000);
    expect(first.purchaseRequirements[0]).toMatchObject({
      availableQuantityMicros: null,
      shortageQuantityMicros: null,
      purchasablePackQuantity: null,
      expectedRemainderQuantityMicros: null,
      state: "unchecked"
    });
    expect(first.evidence.staffing.state).toBe("not_yet_available");
    expect(first.evidence.inventory.state).toBe("not_yet_available");
    expect(Object.isFrozen(first)).toBe(true);
  });

  test("keeps required, shortage, pack, and remainder quantities distinct when exact Inventory evidence is current", () => {
    const input = fixture({
      editingQuote: { id: "quote-9", activeQuoteRevisionId: "quote-version-3" },
      calculationGeneration: 5
    });
    const draft = buildDeliveryPlanningContext(input);
    const scope = {
      state: "available",
      quoteId: "quote-9",
      quoteRevisionId: "quote-version-3",
      blueprintId: "staffed-buffet",
      blueprintRevision: "7",
      proposalFingerprint: draft.proposalFingerprint,
      calculationGeneration: 5
    };
    const proposal = buildDeliveryPlanningContext({
      ...input,
      staffingEvidence: { ...scope, sourceRevision: "staff-plan-4" },
      inventoryEvidence: {
        ...scope,
        sourceRevision: "inventory-projection-8",
        availableByIngredient: {
          "chicken-breast": { quantityMicros: 1_000_000, unitId: "lb" }
        }
      }
    });

    expect(proposal.purchaseRequirements[0]).toMatchObject({
      requiredIngredientQuantityMicros: 6_000_000,
      availableQuantityMicros: 1_000_000,
      shortageQuantityMicros: 5_000_000,
      packQuantityMicros: 5_000_000,
      purchasablePackQuantity: 1,
      expectedRemainderQuantityMicros: 0,
      state: "calculated"
    });
    expect(proposal.presentation.state).toBe("reviewable");
  });

  test("fails explicitly for missing policies and policy bounds", () => {
    const missing = fixture();
    missing.catalog.settings.quantityPolicies = missing.catalog.settings.quantityPolicies
      .filter((policy) => policy.id !== "chicken-portions");
    expect(buildDeliveryPlanningContext(missing).conflicts).toEqual(expect.arrayContaining([
      expect.objectContaining({ id: "quantity_policy_missing", componentId: "chicken" })
    ]));

    const outOfBounds = fixture({ form: { ...fixture().form, guests: 500 } });
    expect(buildDeliveryPlanningContext(outOfBounds).conflicts).toEqual(expect.arrayContaining([
      expect.objectContaining({ id: "quantity_policy_out_of_bounds", componentId: "chicken" })
    ]));
  });

  test("rejects an ambiguous ID-only policy reference when multiple revisions exist", () => {
    const input = fixture();
    const priorRevision = {
      ...input.catalog.settings.quantityPolicies[0],
      revision: "3",
      output: {
        ...input.catalog.settings.quantityPolicies[0].output,
        numerator: 1,
        denominator: 1
      }
    };
    input.catalog.settings.quantityPolicies.push(priorRevision);
    input.catalog.settings.deliveryBlueprints[0].productionComponents[0].quantityPolicyRef = "chicken-portions";

    expect(buildDeliveryPlanningContext(input).conflicts).toEqual(expect.arrayContaining([
      expect.objectContaining({ id: "quantity_policy_missing", componentId: "chicken" })
    ]));

    input.catalog.settings.deliveryBlueprints[0].productionComponents[0].quantityPolicyRef = {
      id: "chicken-portions",
      revision: "4"
    };
    expect(buildDeliveryPlanningContext(input).productionOutputs[0].generatedQuantity).toBe(60);
  });

  test("retains an explicit override across recalculation until the operator resolves the conflict", () => {
    const overrides = {
      chicken: {
        quantity: 65,
        reason: "Chef-approved tray yield",
        declaredBy: "operator-42",
        declaredAtISO: "2026-09-02T14:00:00.000Z",
        baseGeneratedQuantity: 60
      }
    };
    const proposal = buildDeliveryPlanningContext(fixture({
      form: { ...fixture().form, guests: 60 },
      overrides
    }));

    expect(proposal.productionOutputs[0]).toMatchObject({
      generatedQuantity: 72,
      productionQuantity: 65,
      override: { state: "conflict" }
    });
    expect(proposal.conflicts).toEqual(expect.arrayContaining([
      expect.objectContaining({ id: "retained_override_conflict" })
    ]));

    expect(keepDeliveryOverride(overrides, "chicken", 72).chicken.baseGeneratedQuantity).toBe(72);
    expect(useGeneratedDeliveryQuantity(overrides, "chicken")).not.toHaveProperty("chicken");
  });

  test("preserves removed optional items and raises required-component conflicts", () => {
    const optionalRemoved = buildDeliveryPlanningContext(fixture({ removedOptionalComponentIds: ["tea"] }));
    expect(optionalRemoved.productionOutputs.map((output) => output.componentId)).toEqual(["chicken"]);

    const requiredRemoved = buildDeliveryPlanningContext(fixture({
      form: { ...fixture().form, menuItems: ["tea"] }
    }));
    expect(requiredRemoved.conflicts).toEqual(expect.arrayContaining([
      expect.objectContaining({ id: "required_component_missing", componentId: "chicken" })
    ]));
  });

  test("rejects late domain evidence after the draft generation changes", () => {
    const firstInput = fixture({
      editingQuote: { id: "quote-9", activeQuoteRevisionId: "quote-version-3" },
      calculationGeneration: 1
    });
    const first = buildDeliveryPlanningContext(firstInput);
    const oldEvidence = {
      state: "available",
      quoteId: "quote-9",
      quoteRevisionId: "quote-version-3",
      blueprintId: "staffed-buffet",
      blueprintRevision: "7",
      proposalFingerprint: first.proposalFingerprint,
      calculationGeneration: 1
    };
    const next = buildDeliveryPlanningContext({
      ...firstInput,
      form: { ...firstInput.form, guests: 60 },
      calculationGeneration: 2,
      staffingEvidence: oldEvidence,
      inventoryEvidence: oldEvidence
    });

    expect(next.evidence.staffing.state).toBe("stale");
    expect(next.evidence.inventory.state).toBe("stale");
  });

  test("creates a prefill-only handoff and does not mutate quote or catalog inputs", () => {
    const input = fixture();
    const before = structuredClone(input);
    const proposal = buildDeliveryPlanningContext(input);
    const handoff = createDeliveryHandoff(proposal, "production");

    expect(input).toEqual(before);
    expect(handoff).toMatchObject({
      schemaVersion: "delivery-handoff-v1",
      authority: "prefill_only",
      domain: "production",
      proposalFingerprint: proposal.proposalFingerprint
    });
    expect(handoff.requirements).toEqual(proposal.productionOutputs);
  });

  test("preserves Offer and Event Template blueprint references through catalog normalization and writes", () => {
    const input = fixture();
    input.catalog.settings.eventTemplates = [{
      id: "buffet-template",
      name: "Buffet template",
      pkg: "premium",
      deliveryBlueprintRef: { id: "staffed-buffet", revision: "7" }
    }];
    const normalized = normalizeCatalog(input.catalog);
    const stored = toStorageCatalog(normalized);

    expect(normalized.packages[0].deliveryBlueprintRef).toEqual({ id: "staffed-buffet", revision: "7" });
    expect(normalized.settings.eventTemplates[0].deliveryBlueprintRef).toEqual({ id: "staffed-buffet", revision: "7" });
    expect(stored.packages[0].deliveryBlueprintRef).toEqual({ id: "staffed-buffet", revision: "7" });
    expect(packageWriteShape(normalized.packages[0]).deliveryBlueprintRef).toEqual({
      id: "staffed-buffet",
      revision: "7"
    });
  });

  test("renders no proposal when the tenant gate is off or the Offer has no blueprint reference", () => {
    const disabled = fixture();
    disabled.catalog.settings.deliveryPlanningEnabled = false;
    expect(buildDeliveryPlanningContext(disabled)).toBeNull();

    const noReference = fixture();
    delete noReference.catalog.packages[0].deliveryBlueprintRef;
    expect(buildDeliveryPlanningContext(noReference)).toBeNull();
  });

  test("returns bounded conflicts instead of throwing on malformed blueprint input", () => {
    const input = fixture();
    const result = compileDeliveryProposal({
      ...input,
      offer: input.catalog.packages[0],
      blueprint: { schemaVersion: "delivery-blueprint-v1", id: "staffed-buffet" },
      quantityPolicies: input.settings.quantityPolicies
    });
    expect(result.conflicts).toEqual(expect.arrayContaining([
      expect.objectContaining({ id: "blueprint_unavailable" })
    ]));
  });
});
