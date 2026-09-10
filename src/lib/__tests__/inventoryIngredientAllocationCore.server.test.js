import { createRequire } from "node:module";
import { describe, expect, test } from "vitest";

const require = createRequire(import.meta.url);
const inventory = require("../../../functions/inventoryIngredientCore.cjs");
const allocation = require("../../../functions/inventoryIngredientAllocationCore.cjs");

const ORG = "org-inventory";
const NOW = "2026-09-09T05:00:00.000Z";
const actor = { uid: "admin-1", email: "admin@example.com", role: "admin", organizationId: ORG };

function authorities() {
  const location = inventory.planLocation({
    organizationId: ORG,
    request: { kind: "upsert_location", locationId: "kitchen", name: "Main kitchen", active: true, expectedRevision: 0 },
    actor,
    nowISO: NOW
  }).location;
  const ingredient = inventory.planIngredient({
    organizationId: ORG,
    request: {
      kind: "upsert_ingredient", ingredientId: "chicken", name: "Chicken", category: "Protein",
      baseUnitId: "lb", active: true, expectedRevision: 0
    },
    actor,
    nowISO: NOW
  }).ingredient;
  const opened = inventory.planOpeningBalance({
    organizationId: ORG,
    requestId: "opening-chicken-0001",
    request: {
      kind: "opening_balance", ingredientId: "chicken", locationId: "kitchen", quantity: "40",
      baseUnitId: "lb", occurredAtISO: NOW, note: "Opening count", expectedStockRevision: 0
    },
    ingredient,
    location,
    stockState: null,
    actor,
    nowISO: NOW
  });
  return { location, ingredient, opened };
}

function requirement(quoteId, quantityMicros, revisionId = `eir_${"a".repeat(48)}`) {
  return {
    authorityVersion: inventory.INVENTORY_AUTHORITY_VERSION,
    schemaVersion: 1,
    requirementVersion: "ingredient-event-requirement-v1",
    organizationId: ORG,
    quoteId,
    quoteRevisionId: `revision-${quoteId}`,
    requiredByISO: quoteId === "event-a" ? "2026-09-12T18:00:00.000Z" : "2026-09-20T18:00:00.000Z",
    demandState: "complete",
    costState: "complete",
    selections: [],
    ingredients: [{
      ingredientId: "chicken",
      baseUnitId: "lb",
      exactRequiredQuantityMicros: { numerator: String(quantityMicros), denominator: "1" },
      requiredQuantityMicros: quantityMicros,
      contributions: [],
      exactKnownCostMinor: { numerator: "0", denominator: "1" },
      knownCostMinor: 0,
      costState: "complete",
      currency: "USD",
      projectedCostMinor: 0
    }],
    coverage: {
      selectedMenuItemCount: 1,
      compiledMenuItemCount: 1,
      ingredientCount: 1,
      costedIngredientCount: 1,
      knownCostIngredientCount: 1
    },
    issues: [],
    currency: "USD",
    exactKnownCostMinor: { numerator: "0", denominator: "1" },
    knownCostMinor: 0,
    projectedCostMinor: 0,
    eventRequirementRevisionId: revisionId,
    requirementDigest: "b".repeat(64)
  };
}

function headFor(value, revision = 1) {
  return {
    organizationId: ORG,
    quoteId: value.quoteId,
    revision,
    eventRequirementRevisionId: value.eventRequirementRevisionId,
    requirementDigest: value.requirementDigest
  };
}

function allocateRequest(value, revision = 0) {
  return {
    kind: "allocate_event_ingredients",
    quoteId: value.quoteId,
    eventRequirementRevisionId: value.eventRequirementRevisionId,
    locationId: "kitchen",
    expectedRequirementRevision: 1,
    expectedAllocationRevision: revision
  };
}

describe("ingredient receiving and consumable allocation core", () => {
  test("receiving advances physical stock and establishes only the first known planning-cost basis", () => {
    const { location, ingredient, opened } = authorities();
    const firstReceipt = inventory.planReceiving({
      organizationId: ORG,
      requestId: "receiving-chicken-0001",
      request: {
        kind: "receive_stock", ingredientId: "chicken", locationId: "kitchen", quantity: "10.5",
        baseUnitId: "lb", occurredAtISO: NOW, sourceLabel: "Vendor receipt 101", note: "Fresh delivery",
        expectedStockRevision: 1, expectedCostRevision: 0,
        cost: { availability: "available", totalCostMinor: 4200, currency: "USD" }
      },
      ingredient,
      location,
      stockState: opened.nextStockState,
      currentCostState: null,
      actor,
      nowISO: NOW
    });
    expect(firstReceipt.nextStockState).toMatchObject({ revision: 2, onHandMicros: 50_500_000 });
    expect(firstReceipt.nextCostState).toMatchObject({
      revision: 1, availability: "available", basisQuantityMicros: 10_500_000, totalCostMinor: 4200
    });
    expect(firstReceipt.planningBasisAction).toBe("established");
    inventory.verifyMovement(firstReceipt.movement);
    inventory.verifyCostEvidence(firstReceipt.costEvidence);

    const laterReceipt = inventory.planReceiving({
      organizationId: ORG,
      requestId: "receiving-chicken-0002",
      request: {
        kind: "receive_stock", ingredientId: "chicken", locationId: "kitchen", quantity: "5",
        baseUnitId: "lb", occurredAtISO: NOW, sourceLabel: "Vendor receipt 102", note: "Different observed price",
        expectedStockRevision: 2, expectedCostRevision: 1,
        cost: { availability: "available", totalCostMinor: 2500, currency: "USD" }
      },
      ingredient,
      location,
      stockState: firstReceipt.nextStockState,
      currentCostState: firstReceipt.nextCostState,
      actor,
      nowISO: NOW
    });
    expect(laterReceipt.nextStockState.onHandMicros).toBe(55_500_000);
    expect(laterReceipt.nextCostState).toBe(firstReceipt.nextCostState);
    expect(laterReceipt.planningBasisAction).toBe("retained_existing");
    expect(laterReceipt.costEvidence).toMatchObject({
      costEvidenceVersion: inventory.INVENTORY_RECEIVING_COST_VERSION,
      priorCostRevision: 1,
      resultCostRevision: 1,
      totalCostMinor: 2500,
      planningBasisAction: "retained_existing"
    });
    inventory.verifyReceivingCostEvidence(laterReceipt.costEvidence);
    expect(inventory.replayMovements({
      organizationId: ORG,
      ingredientId: "chicken",
      locationId: "kitchen",
      baseUnitId: "lb",
      movements: [opened.movement, firstReceipt.movement, laterReceipt.movement]
    })).toEqual(laterReceipt.nextStockState);
  });

  test("receiving retains an existing missing-cost state and ignores its stale cost expectation", () => {
    const { location, ingredient, opened } = authorities();
    const missingCost = inventory.planIngredientCostEvidence({
      organizationId: ORG,
      requestId: "missing-cost-before-receive-0001",
      request: {
        kind: "record_ingredient_cost",
        ingredientId: "chicken",
        baseUnitId: "lb",
        availability: "missing",
        sourceLabel: "Prior count",
        observedAtISO: NOW,
        note: "Cost was unavailable",
        expectedCostRevision: 0
      },
      ingredient,
      currentCostState: null,
      actor,
      nowISO: NOW
    }).nextCostState;
    const received = inventory.planReceiving({
      organizationId: ORG,
      requestId: "receiving-after-missing-cost-0001",
      request: {
        kind: "receive_stock",
        ingredientId: "chicken",
        locationId: "kitchen",
        quantity: "5",
        baseUnitId: "lb",
        occurredAtISO: NOW,
        sourceLabel: "Vendor receipt after missing observation",
        note: "Physical receipt must remain independent",
        expectedStockRevision: 1,
        expectedCostRevision: 0,
        cost: { availability: "available", totalCostMinor: 2500, currency: "USD" }
      },
      ingredient,
      location,
      stockState: opened.nextStockState,
      currentCostState: missingCost,
      actor,
      nowISO: NOW
    });
    expect(received.nextStockState).toMatchObject({ revision: 2, onHandMicros: 45_000_000 });
    expect(received.nextCostState).toBe(missingCost);
    expect(received.planningBasisAction).toBe("retained_existing");
    expect(received.costEvidence).toMatchObject({
      priorCostRevision: 1,
      resultCostRevision: 1,
      planningBasisAction: "retained_existing",
      availability: "available",
      totalCostMinor: 2500
    });
  });

  test("allocates cumulative consumable stock across different dates and records partial shortage", () => {
    const { opened } = authorities();
    const firstRequirement = requirement("event-a", 25_000_000);
    const first = allocation.planEventAllocation({
      request: allocateRequest(firstRequirement),
      organizationId: ORG,
      requirementHead: headFor(firstRequirement),
      requirement: firstRequirement,
      stockStates: [opened.nextStockState],
      fences: [],
      nowISO: NOW
    });
    expect(first.plan).toMatchObject({ state: "reserved", allocationRevision: 1 });
    expect(first.fences[0].committedMicros).toBe(25_000_000);

    const secondRequirement = requirement("event-b", 20_000_000, `eir_${"c".repeat(48)}`);
    const second = allocation.planEventAllocation({
      request: allocateRequest(secondRequirement),
      organizationId: ORG,
      requirementHead: headFor(secondRequirement),
      requirement: secondRequirement,
      stockStates: [opened.nextStockState],
      fences: first.fences,
      nowISO: NOW
    });
    expect(second.plan).toMatchObject({
      state: "shortage",
      ingredientCount: 1,
      fullyAllocatedIngredientCount: 0,
      shortageIngredientCount: 1
    });
    expect(second.plan.ingredients[0]).toMatchObject({
      requiredQuantityMicros: 20_000_000,
      allocatedQuantityMicros: 15_000_000,
      shortageQuantityMicros: 5_000_000,
      stockRevision: 1
    });
    expect(second.fences[0].committedMicros).toBe(40_000_000);
    expect(opened.nextStockState.onHandMicros).toBe(40_000_000);
  });

  test("a transaction retry against the changed shared fence cannot overallocate", () => {
    const { opened } = authorities();
    const existing = requirement("event-a", 25_000_000);
    const first = allocation.planEventAllocation({
      request: allocateRequest(existing), organizationId: ORG, requirementHead: headFor(existing),
      requirement: existing, stockStates: [opened.nextStockState], fences: [], nowISO: NOW
    });
    const contenderB = requirement("event-b", 10_000_000, `eir_${"c".repeat(48)}`);
    const contenderC = requirement("event-c", 10_000_000, `eir_${"d".repeat(48)}`);
    const committedB = allocation.planEventAllocation({
      request: allocateRequest(contenderB), organizationId: ORG, requirementHead: headFor(contenderB),
      requirement: contenderB, stockStates: [opened.nextStockState], fences: first.fences, nowISO: NOW
    });
    const retriedC = allocation.planEventAllocation({
      request: allocateRequest(contenderC), organizationId: ORG, requirementHead: headFor(contenderC),
      requirement: contenderC, stockStates: [opened.nextStockState], fences: committedB.fences, nowISO: NOW
    });
    expect(committedB.plan.ingredients[0].allocatedQuantityMicros).toBe(10_000_000);
    expect(retriedC.plan.ingredients[0]).toMatchObject({
      allocatedQuantityMicros: 5_000_000,
      shortageQuantityMicros: 5_000_000
    });
    expect(retriedC.fences[0].committedMicros).toBe(40_000_000);
  });

  test("tops up only the remaining shortage after stock is received and preserves the prior hold", () => {
    const { location, ingredient, opened } = authorities();
    const existing = requirement("event-a", 25_000_000);
    const first = allocation.planEventAllocation({
      request: allocateRequest(existing), organizationId: ORG, requirementHead: headFor(existing),
      requirement: existing, stockStates: [opened.nextStockState], fences: [], nowISO: NOW
    });
    const target = requirement("event-b", 20_000_000, `eir_${"c".repeat(48)}`);
    const partial = allocation.planEventAllocation({
      request: allocateRequest(target), organizationId: ORG, requirementHead: headFor(target),
      requirement: target, stockStates: [opened.nextStockState], fences: first.fences, nowISO: NOW
    });
    const received = inventory.planReceiving({
      organizationId: ORG,
      requestId: "receiving-for-top-up-0001",
      request: {
        kind: "receive_stock", ingredientId: "chicken", locationId: "kitchen", quantity: "5",
        baseUnitId: "lb", occurredAtISO: NOW, sourceLabel: "Top-up supply", note: "",
        expectedStockRevision: 1, expectedCostRevision: 0,
        cost: { availability: "missing" }
      },
      ingredient,
      location,
      stockState: opened.nextStockState,
      currentCostState: null,
      actor,
      nowISO: NOW
    });
    const toppedUp = allocation.planEventAllocation({
      request: allocateRequest(target, 1),
      organizationId: ORG,
      requirementHead: headFor(target),
      requirement: target,
      currentPlan: partial.plan,
      stockStates: [received.nextStockState],
      fences: partial.fences,
      nowISO: NOW
    });
    expect(toppedUp.plan).toMatchObject({ state: "reserved", allocationRevision: 2 });
    expect(toppedUp.plan.ingredients[0]).toMatchObject({
      requiredQuantityMicros: 20_000_000,
      allocatedQuantityMicros: 20_000_000,
      shortageQuantityMicros: 0
    });
    expect(toppedUp.fences[0].committedMicros).toBe(45_000_000);
    expect(toppedUp.fences[0].allocations.find(
      ({ quoteId }) => quoteId === "event-b"
    ).quantityMicros).toBe(20_000_000);
  });

  test("release restores commitment without changing physical on-hand and cannot be repeated", () => {
    const { opened } = authorities();
    const demand = requirement("event-a", 25_000_000);
    const reserved = allocation.planEventAllocation({
      request: allocateRequest(demand), organizationId: ORG, requirementHead: headFor(demand),
      requirement: demand, stockStates: [opened.nextStockState], fences: [], nowISO: NOW
    });
    const released = allocation.planEventRelease({
      request: {
        kind: "release_event_ingredients", quoteId: "event-a", expectedAllocationRevision: 1,
        reason: "Event cancelled"
      },
      organizationId: ORG,
      currentPlan: reserved.plan,
      fences: reserved.fences,
      nowISO: NOW
    });
    expect(released.plan).toMatchObject({ state: "released", allocationRevision: 2, releaseReason: "Event cancelled" });
    expect(released.fences[0].committedMicros).toBe(0);
    expect(opened.nextStockState.onHandMicros).toBe(40_000_000);
    expect(() => allocation.planEventRelease({
      request: {
        kind: "release_event_ingredients", quoteId: "event-a", expectedAllocationRevision: 2,
        reason: "Repeated release"
      },
      organizationId: ORG,
      currentPlan: released.plan,
      fences: released.fences,
      nowISO: NOW
    })).toThrow(/already released/i);
  });

  test("fails closed rather than splitting an oversized atomic allocation", () => {
    const oversized = requirement("event-large", 1_000_000);
    oversized.ingredients = Array.from({ length: 101 }, (_, index) => ({
      ingredientId: `ingredient-${String(index).padStart(3, "0")}`,
      baseUnitId: "lb",
      requiredQuantityMicros: 1_000_000
    }));
    expect(() => allocation.planEventAllocation({
      request: allocateRequest(oversized),
      organizationId: ORG,
      requirementHead: headFor(oversized),
      requirement: oversized,
      stockStates: [],
      fences: [],
      nowISO: NOW
    })).toThrow(/1-100 ingredient rows/i);
  });
});
