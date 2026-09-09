import { beforeEach, describe, expect, test, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  callable: vi.fn(),
  httpsCallable: vi.fn(),
  collection: vi.fn(),
  doc: vi.fn(),
  limit: vi.fn(),
  onSnapshot: vi.fn(),
  orderBy: vi.fn(),
  query: vi.fn(),
  auth: { currentUser: { uid: "admin-user" } },
  cloudFunctions: { id: "functions" },
  db: { id: "firestore" }
}));

vi.mock("firebase/functions", () => ({ httpsCallable: mocks.httpsCallable }));
vi.mock("firebase/firestore", () => ({
  collection: mocks.collection,
  doc: mocks.doc,
  limit: mocks.limit,
  onSnapshot: mocks.onSnapshot,
  orderBy: mocks.orderBy,
  query: mocks.query
}));
vi.mock("../firebase", () => ({
  auth: mocks.auth,
  cloudFunctions: mocks.cloudFunctions,
  db: mocks.db,
  firebaseReady: true
}));

import {
  INVENTORY_AUTHORITY_CALLABLES,
  INVENTORY_EVENT_SELECTION_LIMIT,
  INVENTORY_INGREDIENT_PROJECTION_LIMIT,
  INVENTORY_MENU_COST_PROJECTION_LIMIT,
  applyInventoryCommand,
  buildInventoryRequestId,
  getInventoryBrowserAccess,
  getInventoryMenuCostBrowserAccess,
  inventoryMoneyInputToMinorUnits,
  inventoryProjectionConfirmsReceipt,
  normalizeInventoryIngredientProjection,
  normalizeInventoryMenuCostProjection,
  normalizeEventIngredientProjection,
  normalizeInventoryWorkspaceProjection,
  readPendingInventoryCommands,
  reconcileInventoryCommand,
  previewEventInventory,
  resetDefinitiveInventoryCommand,
  subscribeToInventoryIngredientProjections,
  subscribeToInventoryMenuCostProjection,
  subscribeToInventoryMenuCostProjections,
  subscribeToInventoryRecipeIngredients,
  subscribeToEventIngredientProjection
} from "../inventoryAuthorityClient";

const ORGANIZATION_ID = "org-inventory-client";
const REQUEST_ID = `inventory_request_${"a".repeat(32)}`;
const RECEIPT_ID = `iar_${"b".repeat(48)}`;
const PACK_CONVERSION_REVISION_ID = `ipc_${"e".repeat(48)}`;
const RECIPE_REVISION_ID = `irr_${"f".repeat(48)}`;
const EVENT_REQUIREMENT_REVISION_ID = `eir_${"e".repeat(48)}`;
const EVENT_PLAN_ID = `eip_${"9".repeat(48)}`;
const NOW = "2026-09-09T05:00:00.000Z";
const ADMIN_SCOPE = Object.freeze({
  organizationId: ORGANIZATION_ID,
  role: "admin",
  browserEnabled: true,
  tenantEnabled: true
});

function workspaceProjection(overrides = {}) {
  return {
    authorityVersion: "inventory-ingredient-authority-v2",
    schemaVersion: 2,
    model: "inventory-workspace-projection-v2",
    organizationId: ORGANIZATION_ID,
    projectionId: "current",
    workspaceRevision: 1,
    locations: [{ locationId: "main-kitchen", name: "Main kitchen", active: true, revision: 1 }],
    updatedAtISO: NOW,
    ...overrides
  };
}

function ingredientProjection(overrides = {}) {
  return {
    authorityVersion: "inventory-ingredient-authority-v2",
    schemaVersion: 2,
    model: "inventory-ingredient-projection-v2",
    organizationId: ORGANIZATION_ID,
    ingredientId: "chicken",
    name: "Chicken",
    nameSortKey: "chicken",
    category: "Protein",
    baseUnitId: "lb",
    dimension: "mass",
    active: true,
    ingredientRevision: 1,
    stock: {
      availability: "current",
      stockRevision: 1,
      onHandMicros: 40_000_000,
      quantity: "40",
      locationId: "main-kitchen",
      lastMovementId: `imv_${"c".repeat(48)}`,
      allocationRevision: 1,
      committedMicros: 25_000_000,
      committedQuantity: "25",
      availableToAllocateMicros: 15_000_000,
      availableToAllocateQuantity: "15"
    },
    cost: {
      availability: "available",
      costRevision: 1,
      sourceLabel: "Opening invoice",
      observedAtISO: "2026-09-09T04:00:00.000Z",
      lastCostEvidenceId: `ice_${"d".repeat(48)}`,
      basisQuantityMicros: 40_000_000,
      totalCostMinor: 12_000,
      currency: "USD"
    },
    packConversions: [],
    updatedAtISO: NOW,
    ...overrides
  };
}

function packConversionCommand() {
  return {
    kind: "publish_pack_conversion",
    ingredientId: "chicken",
    packUnitId: "case",
    packLabel: "Case",
    baseUnitId: "lb",
    baseQuantity: "10",
    sourceLabel: "Operator-declared case contents",
    expectedRevision: 0
  };
}

function recipeCommand() {
  return {
    kind: "publish_menu_recipe",
    menuItemId: "chicken-pasta",
    expectedCatalogRevision: 7,
    expectedRecipeRevision: 0,
    outputYield: "10",
    outputUnitId: "portion",
    lines: [
      { lineId: "chicken", ingredientId: "chicken", quantity: "2", unitKind: "standard", quantityBasis: "as_purchased", usableYield: null, unitId: "lb" },
      { lineId: "pasta", ingredientId: "pasta", quantity: "1", unitKind: "standard", quantityBasis: "as_purchased", usableYield: null, unitId: "lb" }
    ]
  };
}

function eventSelection(overrides = {}) {
  return {
    selectionId: "selection-chicken-pasta",
    menuItemId: "chicken-pasta",
    recipeRevisionId: RECIPE_REVISION_ID,
    requiredOutputQuantity: "100",
    outputUnitId: "portion",
    portionBasis: { kind: "explicit_output_quantity", evidenceId: "chicken-pasta" },
    commercialProvenance: { kind: "direct", sourceId: "chicken-pasta" },
    ...overrides
  };
}

function compileEventCommand(requestId = `inventory_request_${"2".repeat(32)}`) {
  return {
    kind: "compile_event_ingredient_demand",
    quoteId: "quote-event-1",
    quoteRevisionId: "quote-revision-17",
    requiredByBasis: { kind: "quote_event_start" },
    selections: [eventSelection()],
    expectedRequirementRevision: 0,
    expectedPreviewProjectionDigest: "a".repeat(64)
  };
}

function receiveStockCommand(cost = { availability: "available", totalCostMinor: 3_000, currency: "USD" }) {
  return {
    kind: "receive_stock",
    ingredientId: "chicken",
    locationId: "main-kitchen",
    quantity: "10",
    baseUnitId: "lb",
    occurredAtISO: "2026-09-09T05:00:00.000Z",
    sourceLabel: "Vendor receipt 1842",
    note: "Confirmed delivery",
    expectedStockRevision: 1,
    expectedCostRevision: 1,
    cost
  };
}

function allocateEventCommand() {
  return {
    kind: "allocate_event_ingredients",
    quoteId: "quote-event-1",
    eventRequirementRevisionId: EVENT_REQUIREMENT_REVISION_ID,
    locationId: "main-kitchen",
    expectedRequirementRevision: 1,
    expectedAllocationRevision: 0
  };
}

function releaseEventCommand() {
  return {
    kind: "release_event_ingredients",
    quoteId: "quote-event-1",
    expectedAllocationRevision: 1,
    reason: "Event cancelled"
  };
}

function reconcileEventCommand() {
  return {
    kind: "reconcile_event_ingredients",
    quoteId: "quote-event-1",
    eventRequirementRevisionId: EVENT_REQUIREMENT_REVISION_ID,
    locationId: "main-kitchen",
    expectedRequirementRevision: 2,
    expectedAllocationRevision: 3,
    reason: "Guest count changed"
  };
}

function eventIngredientProjection(overrides = {}) {
  const digest = "a".repeat(64);
  const defaultAllocationFreshness = overrides.allocation?.state === "released"
    ? "released" : overrides.allocation ? "current" : "not_allocated";
  const contribution = {
    ...eventSelection(),
    recipeDigest: digest,
    exactRequiredQuantityMicros: { numerator: "20000000", denominator: "1" },
    costAvailability: "available",
    currency: "USD",
    costRevision: 1,
    costEvidenceId: `ice_${"d".repeat(48)}`,
    exactCostMinor: { numerator: "6000", denominator: "1" }
  };
  return {
    authorityVersion: "inventory-ingredient-authority-v2",
    schemaVersion: 1,
    projectionVersion: "ingredient-event-projection-v1",
    organizationId: ORGANIZATION_ID,
    quoteId: "quote-event-1",
    quoteRevisionId: "quote-revision-17",
    eventRequirementRevisionId: EVENT_REQUIREMENT_REVISION_ID,
    requirementDigest: digest,
    requiredByISO: "2026-10-11T16:00:00.000Z",
    demandState: "complete",
    costState: "complete",
    availabilityState: "shortage",
    selections: [{
      ...eventSelection(),
      recipeDigest: digest,
      recipeOutputYield: "10",
      demandState: "complete",
      costState: "complete",
      recipeCostResultDigest: digest,
      currency: "USD",
      exactKnownCostMinor: { numerator: "8000", denominator: "1" },
      knownCostMinor: 8000,
      projectedCostMinor: 8000
    }],
    ingredients: [{
      ingredientId: "chicken",
      baseUnitId: "lb",
      exactRequiredQuantityMicros: { numerator: "20000000", denominator: "1" },
      requiredQuantityMicros: 20_000_000,
      contributions: [contribution],
      costState: "complete",
      exactKnownCostMinor: { numerator: "6000", denominator: "1" },
      knownCostMinor: 6000,
      currency: "USD",
      projectedCostMinor: 6000,
      onHandQuantityMicros: 40_000_000,
      committedQuantityMicros: 25_000_000,
      availableToAllocateQuantityMicros: 15_000_000,
      shortageQuantityMicros: 5_000_000,
      availabilityState: "shortage"
    }],
    coverage: {
      selectedMenuItemCount: 1,
      compiledMenuItemCount: 1,
      ingredientCount: 1,
      costedIngredientCount: 1,
      knownCostIngredientCount: 1,
      stockKnownIngredientCount: 1,
      availableIngredientCount: 0,
      shortageIngredientCount: 1
    },
    sourceRevisions: {
      recipeRevisionIds: [RECIPE_REVISION_ID],
      recipeCostResultDigests: [digest],
      stockRevisions: [{ stockStateId: "chicken_main", ingredientId: "chicken", locationId: "main-kitchen", revision: 1 }],
      allocationRevisions: [{ allocationId: "allocation-other", eventPlanId: "event-other", ingredientId: "chicken", revision: 1, sourceRequirementRevisionId: "prior-requirement" }]
    },
    issues: [{ code: "shortage", ingredientId: "chicken" }],
    currency: "USD",
    exactKnownCostMinor: { numerator: "8000", denominator: "1" },
    knownCostMinor: 8000,
    projectedCostMinor: 8000,
    projectionDigest: digest,
    model: "event-ingredient-projection-v1",
    requirementRevision: 1,
    ingredientLabels: [{ ingredientId: "chicken", name: "Chicken" }],
    freshness: "as_recorded",
    staleReason: "",
    freshnessState: overrides.freshnessState || {
      demand: { state: "current", reason: "" },
      cost: { state: "current", reason: "" },
      availability: { state: "current", reason: "" },
      allocation: { state: defaultAllocationFreshness, reason: "" }
    },
    updatedAtISO: NOW,
    ...overrides
  };
}

function eventIngredientRequirement() {
  const source = eventIngredientProjection();
  return {
    authorityVersion: source.authorityVersion,
    schemaVersion: source.schemaVersion,
    requirementVersion: "ingredient-event-requirement-v1",
    organizationId: source.organizationId,
    quoteId: source.quoteId,
    quoteRevisionId: source.quoteRevisionId,
    requiredByISO: source.requiredByISO,
    demandState: source.demandState,
    costState: source.costState,
    selections: source.selections,
    ingredients: source.ingredients.map((row) => {
      const clean = { ...row };
      delete clean.availabilityState;
      delete clean.onHandQuantityMicros;
      delete clean.committedQuantityMicros;
      delete clean.availableToAllocateQuantityMicros;
      delete clean.shortageQuantityMicros;
      return clean;
    }),
    coverage: {
      selectedMenuItemCount: source.coverage.selectedMenuItemCount,
      compiledMenuItemCount: source.coverage.compiledMenuItemCount,
      ingredientCount: source.coverage.ingredientCount,
      costedIngredientCount: source.coverage.costedIngredientCount,
      knownCostIngredientCount: source.coverage.knownCostIngredientCount
    },
    issues: [],
    currency: source.currency,
    exactKnownCostMinor: source.exactKnownCostMinor,
    knownCostMinor: source.knownCostMinor,
    projectedCostMinor: source.projectedCostMinor,
    eventRequirementRevisionId: source.eventRequirementRevisionId,
    requirementDigest: source.requirementDigest
  };
}

function menuCostResult(status = "complete") {
  const chicken = {
    ingredientId: "chicken",
    ingredientRevision: 1,
    baseUnitId: "lb",
    requiredBaseQuantityMicros: { numerator: "2000000", denominator: "1" },
    lineIds: ["chicken"],
    conversionProvenance: [{ kind: "identity", fromUnitId: "lb", toUnitId: "lb" }],
    costAvailability: "available",
    costRevision: 1,
    costEvidenceId: `ice_${"d".repeat(48)}`,
    currency: "USD",
    exactCostMinor: { numerator: "600", denominator: "1" }
  };
  const pasta = status === "partial" ? {
    ingredientId: "pasta",
    ingredientRevision: 1,
    baseUnitId: "lb",
    requiredBaseQuantityMicros: { numerator: "1000000", denominator: "1" },
    lineIds: ["pasta"],
    conversionProvenance: [{ kind: "identity", fromUnitId: "lb", toUnitId: "lb" }],
    costAvailability: "missing"
  } : {
    ingredientId: "pasta",
    ingredientRevision: 1,
    baseUnitId: "lb",
    requiredBaseQuantityMicros: { numerator: "1000000", denominator: "1" },
    lineIds: ["pasta"],
    conversionProvenance: [{ kind: "identity", fromUnitId: "lb", toUnitId: "lb" }],
    costAvailability: "available",
    costRevision: 1,
    costEvidenceId: `ice_${"1".repeat(48)}`,
    currency: "USD",
    exactCostMinor: { numerator: "200", denominator: "1" }
  };
  const complete = status === "complete";
  return {
    authorityVersion: "inventory-ingredient-authority-v2",
    schemaVersion: 2,
    costingVersion: "ingredient-recipe-cost-v2",
    organizationId: ORGANIZATION_ID,
    menuItemId: "chicken-pasta",
    recipeRevisionId: RECIPE_REVISION_ID,
    recipeDigest: "recipe-digest",
    status,
    outputYield: "10",
    outputUnitId: "portion",
    ingredients: [chicken, pasta],
    coverage: {
      expectedIngredientCount: 2,
      normalizedIngredientCount: 2,
      costedIngredientCount: complete ? 2 : 1,
      missingCostIngredientCount: complete ? 0 : 1
    },
    issues: complete ? [] : [{ code: "missing_cost", ingredientId: "pasta" }],
    currency: "USD",
    exactKnownCostMinor: { numerator: complete ? "800" : "600", denominator: "1" },
    knownCostMinor: complete ? 800 : 600,
    ...(complete ? {
      projectedCostMinor: 800,
      exactCostPerOutputUnitMinor: { numerator: "80", denominator: "1" }
    } : {}),
    resultDigest: `${status}-result-digest`
  };
}

function menuCostProjection(status = "complete", overrides = {}) {
  const stale = status === "stale";
  const calculatedStatus = stale ? "complete" : status;
  return {
    authorityVersion: "inventory-ingredient-authority-v2",
    schemaVersion: 2,
    model: "inventory-menu-cost-projection-v2",
    organizationId: ORGANIZATION_ID,
    menuItemId: "chicken-pasta",
    menuItemName: "Chicken Pasta",
    menuItemNameSortKey: "chicken pasta",
    observedCatalogRevision: 7,
    menuIdentityDigest: "menu-identity-digest",
    recipeRevision: 1,
    recipeRevisionId: RECIPE_REVISION_ID,
    recipeDigest: "recipe-digest",
    policyDigest: "policy-digest",
    recipeDefinition: {
      revision: 1,
      recipeRevisionId: RECIPE_REVISION_ID,
      recipeDigest: "recipe-digest",
      outputYield: "10",
      outputUnitId: "portion",
      lines: recipeCommand().lines,
      definitionDigest: "definition-digest"
    },
    status,
    freshness: stale ? "stale" : "current",
    staleReason: stale ? "ingredient_cost_changed" : "",
    cost: menuCostResult(calculatedStatus),
    updatedAtISO: NOW,
    sourceDigest: "projection-source-digest",
    ...overrides
  };
}

function locationCommand() {
  return {
    kind: "upsert_location",
    locationId: "main-kitchen",
    name: "Main kitchen",
    active: true,
    expectedRevision: 0
  };
}

function responseFor(payload, resultOverrides = {}) {
  const common = {
    schemaVersion: 2,
    organizationId: payload.organizationId,
    receiptId: RECEIPT_ID,
    requestId: payload.requestId,
    commandKind: payload.command.kind,
    recordedAtISO: NOW
  };
  let result;
  if (payload.command.kind === "upsert_location") {
    result = { schemaVersion: 2, locationId: payload.command.locationId, name: payload.command.name, active: payload.command.active, revision: payload.command.expectedRevision + 1, updatedAtISO: NOW };
  } else if (payload.command.kind === "upsert_ingredient") {
    result = { schemaVersion: 2, ingredientId: payload.command.ingredientId, revision: payload.command.expectedRevision + 1, baseUnitId: payload.command.baseUnitId, active: payload.command.active, affectedMenuItemIds: [] };
  } else if (payload.command.kind === "opening_balance") {
    result = { schemaVersion: 2, ingredientId: payload.command.ingredientId, locationId: payload.command.locationId, movementId: `imv_${"c".repeat(48)}`, stockRevision: payload.command.expectedStockRevision + 1, onHandMicros: 40_000_000, onHandQuantity: payload.command.quantity };
  } else {
    if (payload.command.kind === "publish_pack_conversion") {
      result = { schemaVersion: 2, ingredientId: payload.command.ingredientId, packUnitId: payload.command.packUnitId, packConversionRevisionId: PACK_CONVERSION_REVISION_ID, revision: payload.command.expectedRevision + 1, affectedMenuItemIds: [] };
    } else if (payload.command.kind === "publish_menu_recipe") {
      result = { schemaVersion: 2, menuItemId: payload.command.menuItemId, recipeRevisionId: RECIPE_REVISION_ID, recipeRevision: payload.command.expectedRecipeRevision + 1, projectionSourceDigest: "projection-source-digest", status: "complete" };
    } else if (payload.command.kind === "compile_event_ingredient_demand") {
      result = {
        schemaVersion: 2,
        quoteId: payload.command.quoteId,
        quoteRevisionId: payload.command.quoteRevisionId,
        requirementRevision: payload.command.expectedRequirementRevision + 1,
        eventRequirementRevisionId: `eir_${"e".repeat(48)}`,
        requirementDigest: "a".repeat(64),
        projectionDigest: "a".repeat(64),
        demandState: "complete",
        costState: "complete",
        availabilityState: "shortage"
      };
    } else if (payload.command.kind === "receive_stock") {
      result = {
        schemaVersion: 2,
        ingredientId: payload.command.ingredientId,
        locationId: payload.command.locationId,
        movementId: `imv_${"8".repeat(48)}`,
        costEvidenceId: `ice_${"7".repeat(48)}`,
        stockRevision: payload.command.expectedStockRevision + 1,
        costRevision: payload.command.expectedCostRevision + 1,
        onHandMicros: 50_000_000,
        onHandQuantity: "50"
      };
    } else if (payload.command.kind === "allocate_event_ingredients") {
      result = {
        schemaVersion: 2,
        quoteId: payload.command.quoteId,
        eventPlanId: EVENT_PLAN_ID,
        allocationRevision: payload.command.expectedAllocationRevision + 1,
        state: "shortage",
        eventRequirementRevisionId: payload.command.eventRequirementRevisionId,
        ingredientCount: 2,
        fullyAllocatedIngredientCount: 1,
        shortageIngredientCount: 1
      };
    } else if (payload.command.kind === "release_event_ingredients") {
      result = {
        schemaVersion: 2,
        quoteId: payload.command.quoteId,
        eventPlanId: EVENT_PLAN_ID,
        allocationRevision: payload.command.expectedAllocationRevision + 1,
        state: "released",
        eventRequirementRevisionId: EVENT_REQUIREMENT_REVISION_ID,
        ingredientCount: 2,
        fullyAllocatedIngredientCount: 1,
        shortageIngredientCount: 1,
        releasedIngredientCount: 2
      };
    } else if (payload.command.kind === "reconcile_event_ingredients") {
      result = {
        schemaVersion: 2,
        quoteId: payload.command.quoteId,
        eventPlanId: EVENT_PLAN_ID,
        allocationRevision: payload.command.expectedAllocationRevision + 2,
        state: "shortage",
        eventRequirementRevisionId: payload.command.eventRequirementRevisionId,
        ingredientCount: 2,
        fullyAllocatedIngredientCount: 1,
        shortageIngredientCount: 1,
        reconciledFromAllocationRevision: payload.command.expectedAllocationRevision
      };
    } else {
      result = { schemaVersion: 2, ingredientId: payload.command.ingredientId, costEvidenceId: `ice_${"d".repeat(48)}`, costRevision: payload.command.expectedCostRevision + 1, availability: payload.command.availability, affectedMenuItemIds: [] };
    }
  }
  return {
    ok: true,
    schemaVersion: 2,
    organizationId: payload.organizationId,
    commandKind: payload.command.kind,
    idempotent: false,
    receipt: common,
    result: { ...result, ...resultOverrides }
  };
}

beforeEach(() => {
  vi.clearAllMocks();
  mocks.auth.currentUser = { uid: "admin-user" };
  mocks.httpsCallable.mockReturnValue(mocks.callable);
  mocks.collection.mockImplementation((...segments) => ({ kind: "collection", segments }));
  mocks.doc.mockImplementation((...segments) => ({ id: segments.at(-1), kind: "doc", segments }));
  mocks.limit.mockImplementation((value) => ({ kind: "limit", value }));
  mocks.orderBy.mockImplementation((field, direction) => ({ kind: "orderBy", field, direction }));
  mocks.query.mockImplementation((...parts) => ({ kind: "query", parts }));
});

describe("inventory schema-v2 access and request identity", () => {
  test("requires exact browser, tenant, organization, and administrator gates", () => {
    expect(getInventoryBrowserAccess(ADMIN_SCOPE)).toMatchObject({ readEnabled: true, mutationEnabled: true });
    expect(getInventoryBrowserAccess({ ...ADMIN_SCOPE, browserEnabled: "true" })).toMatchObject({ readEnabled: false, mutationEnabled: false });
    expect(getInventoryBrowserAccess({ ...ADMIN_SCOPE, tenantEnabled: "true" })).toMatchObject({ readEnabled: false, mutationEnabled: false });
    expect(getInventoryBrowserAccess({ ...ADMIN_SCOPE, role: "sales" }).readEnabled).toBe(false);
    expect(getInventoryBrowserAccess({ ...ADMIN_SCOPE, role: "customer" }).readEnabled).toBe(false);
    expect(getInventoryBrowserAccess({ ...ADMIN_SCOPE, organizationId: "" }).readEnabled).toBe(false);
  });

  test("generates request IDs only from cryptographic bytes and fails closed without them", () => {
    expect(buildInventoryRequestId({ getRandomValues: (bytes) => { bytes.fill(15); return bytes; } }))
      .toBe(`inventory_request_${"0f".repeat(16)}`);
    expect(() => buildInventoryRequestId({})).toThrow(/secure inventory request identity/i);
    expect(() => buildInventoryRequestId({ random: Math.random })).toThrow(/secure inventory request identity/i);
  });

  test("converts operator money input to exact safe minor units", () => {
    expect(inventoryMoneyInputToMinorUnits("120")).toBe(12_000);
    expect(inventoryMoneyInputToMinorUnits("120.05")).toBe(12_005);
    expect(() => inventoryMoneyInputToMinorUnits("120.005")).toThrow(/two decimal/i);
    expect(() => inventoryMoneyInputToMinorUnits(" 120.00")).toThrow(/canonical money/i);
  });
});

describe("inventory schema-v2 command authority", () => {
  test("sends and validates the exact flat location command and outcome", async () => {
    mocks.callable.mockImplementation(async (payload) => ({ data: responseFor(payload) }));
    const result = await applyInventoryCommand({ ...ADMIN_SCOPE, requestId: REQUEST_ID, command: locationCommand() });

    expect(mocks.httpsCallable).toHaveBeenCalledWith(mocks.cloudFunctions, INVENTORY_AUTHORITY_CALLABLES.applyCommand);
    expect(mocks.callable).toHaveBeenCalledWith({
      schemaVersion: 2,
      organizationId: ORGANIZATION_ID,
      requestId: REQUEST_ID,
      command: locationCommand()
    });
    expect(result).toMatchObject({
      commandKind: "upsert_location",
      confirmation: { locationId: "main-kitchen", revision: 1 },
      receipt: { receiptId: RECEIPT_ID, requestId: REQUEST_ID }
    });
    expect(readPendingInventoryCommands(ADMIN_SCOPE)).toEqual([]);
  });

  test.each([
    {
      label: "ingredient",
      requestCharacter: "1",
      command: { kind: "upsert_ingredient", ingredientId: "chicken", name: "Chicken", category: "Protein", baseUnitId: "lb", active: true, expectedRevision: 0 }
    },
    {
      label: "opening stock",
      requestCharacter: "2",
      command: { kind: "opening_balance", ingredientId: "chicken", locationId: "main-kitchen", quantity: "40", baseUnitId: "lb", occurredAtISO: "2026-09-09T04:00:00.000Z", note: "Opening count", expectedStockRevision: 0 }
    },
    {
      label: "available cost",
      requestCharacter: "3",
      command: { kind: "record_ingredient_cost", ingredientId: "chicken", baseUnitId: "lb", availability: "available", sourceLabel: "Opening invoice", observedAtISO: "2026-09-09T04:00:00.000Z", note: "", expectedCostRevision: 0, basisQuantity: "40", totalCostMinor: 12_000, currency: "USD" }
    },
    {
      label: "missing cost",
      requestCharacter: "4",
      command: { kind: "record_ingredient_cost", ingredientId: "chicken", baseUnitId: "lb", availability: "missing", sourceLabel: "Invoice unavailable", observedAtISO: "2026-09-09T04:00:00.000Z", note: "Awaiting vendor", expectedCostRevision: 0 }
    }
  ])("accepts the exact $label command shape", async ({ command, requestCharacter }) => {
    const requestId = `inventory_request_${requestCharacter.repeat(32)}`;
    mocks.callable.mockImplementation(async (payload) => ({ data: responseFor(payload) }));
    await expect(applyInventoryCommand({ ...ADMIN_SCOPE, organizationId: `org-command-${requestCharacter}`, requestId, command }))
      .resolves.toMatchObject({ commandKind: command.kind });
  });

  test("publishes only the exact ingredient pack conversion shape and validates its receipt result", async () => {
    const scope = { ...ADMIN_SCOPE, organizationId: "org-pack-command" };
    const command = packConversionCommand();
    mocks.callable.mockImplementation(async (payload) => ({ data: responseFor(payload) }));

    await expect(applyInventoryCommand({ ...scope, requestId: `inventory_request_${"5".repeat(32)}`, command }))
      .resolves.toMatchObject({
        commandKind: "publish_pack_conversion",
        confirmation: {
          ingredientId: "chicken",
          packUnitId: "case",
          packConversionRevisionId: PACK_CONVERSION_REVISION_ID,
          revision: 1,
          affectedMenuItemIds: []
        }
      });
    expect(mocks.callable.mock.calls[0][0].command).toEqual(command);

    await expect(applyInventoryCommand({
      ...scope,
      requestId: `inventory_request_${"6".repeat(32)}`,
      command: { ...command, inferredCaseContents: true }
    })).rejects.toThrow(/unsupported fields/i);
  });

  test("sends an exact stale-allocation reconciliation and requires the atomic +2 result revision", async () => {
    const command = reconcileEventCommand();
    const scope = { ...ADMIN_SCOPE, organizationId: "org-reconcile-command" };
    const requestId = `inventory_request_${"7".repeat(32)}`;
    mocks.callable.mockImplementation(async (payload) => ({ data: responseFor(payload) }));

    await expect(applyInventoryCommand({ ...scope, requestId, command })).resolves.toMatchObject({
      commandKind: "reconcile_event_ingredients",
      confirmation: {
        allocationRevision: 5,
        reconciledFromAllocationRevision: 3,
        eventRequirementRevisionId: EVENT_REQUIREMENT_REVISION_ID
      }
    });
    expect(mocks.callable).toHaveBeenCalledWith(expect.objectContaining({ requestId, command }));

    mocks.callable.mockImplementation(async (payload) => ({
      data: responseFor(payload, { allocationRevision: payload.command.expectedAllocationRevision + 1 })
    }));
    await expect(applyInventoryCommand({
      ...scope,
      requestId: `inventory_request_${"8".repeat(32)}`,
      command
    })).rejects.toThrow(/differs from the request/i);
  });

  test("rejects reconciliation request substitution and mismatched result provenance as data loss", async () => {
    const command = reconcileEventCommand();
    const scope = { ...ADMIN_SCOPE, organizationId: "org-reconcile-substitution" };
    mocks.callable.mockRejectedValueOnce(Object.assign(new Error("connection ended"), {
      code: "functions/unavailable"
    }));
    await expect(applyInventoryCommand({
      ...scope,
      requestId: `inventory_request_${"9".repeat(32)}`,
      command
    })).rejects.toThrow(/connection ended/i);
    await expect(applyInventoryCommand({
      ...scope,
      requestId: `inventory_request_${"0".repeat(32)}`,
      command: { ...command, reason: "Different request contents" }
    })).rejects.toThrow(/without changing its identity or contents/i);
    expect(mocks.callable).toHaveBeenCalledTimes(1);

    mocks.callable.mockImplementation(async (payload) => ({
      data: responseFor(payload, { eventRequirementRevisionId: `eir_${"f".repeat(48)}` })
    }));
    await expect(applyInventoryCommand({
      ...scope,
      organizationId: "org-reconcile-data-loss",
      requestId: `inventory_request_${"0".repeat(32)}`,
      command
    })).rejects.toMatchObject({ code: "unknown", inventoryDefinitive: false });
  });

  test("publishes only the exact versioned menu recipe shape and validates immutable result identity", async () => {
    const scope = { ...ADMIN_SCOPE, organizationId: "org-recipe-command" };
    const command = recipeCommand();
    mocks.callable.mockImplementation(async (payload) => ({ data: responseFor(payload) }));

    await expect(applyInventoryCommand({ ...scope, requestId: `inventory_request_${"7".repeat(32)}`, command }))
      .resolves.toMatchObject({
        commandKind: "publish_menu_recipe",
        confirmation: {
          menuItemId: "chicken-pasta",
          recipeRevisionId: RECIPE_REVISION_ID,
          recipeRevision: 1,
          status: "complete"
        }
      });
    expect(mocks.callable.mock.calls[0][0].command).toEqual(command);

    await expect(applyInventoryCommand({
      ...scope,
      requestId: `inventory_request_${"8".repeat(32)}`,
      command: { ...command, derivedSellingPriceMinor: 2400 }
    })).rejects.toThrow(/unsupported fields/i);
  });

  test("records receiving as one exact stock-and-cost evidence command", async () => {
    const command = receiveStockCommand();
    mocks.callable.mockImplementation(async (payload) => ({ data: responseFor(payload) }));

    await expect(applyInventoryCommand({ ...ADMIN_SCOPE, requestId: `inventory_request_${"6".repeat(32)}`, command }))
      .resolves.toMatchObject({
        commandKind: "receive_stock",
        confirmation: {
          ingredientId: "chicken",
          stockRevision: 2,
          costRevision: 2,
          onHandQuantity: "50"
        }
      });
    expect(mocks.callable.mock.calls.at(-1)[0].command).toEqual(command);

    const unknownCost = receiveStockCommand({ availability: "not_yet_available" });
    await expect(applyInventoryCommand({
      ...ADMIN_SCOPE,
      requestId: `inventory_request_${"7".repeat(32)}`,
      command: unknownCost
    })).resolves.toMatchObject({ commandKind: "receive_stock" });
    mocks.callable.mockImplementationOnce(async (payload) => ({
      data: responseFor(payload, { costRevision: payload.command.expectedCostRevision })
    }));
    await expect(applyInventoryCommand({
      ...ADMIN_SCOPE,
      requestId: `inventory_request_${"c".repeat(32)}`,
      command
    })).resolves.toMatchObject({ confirmation: { costRevision: 1 } });
    await expect(applyInventoryCommand({
      ...ADMIN_SCOPE,
      requestId: `inventory_request_${"8".repeat(32)}`,
      command: { ...command, purchaseOrderId: "invented" }
    })).rejects.toThrow(/unsupported fields/i);
  });

  test("validates dimension-safe event allocation and release receipts", async () => {
    mocks.callable.mockImplementation(async (payload) => ({ data: responseFor(payload) }));
    const allocation = await applyInventoryCommand({
      ...ADMIN_SCOPE,
      requestId: `inventory_request_${"9".repeat(32)}`,
      command: allocateEventCommand()
    });
    expect(allocation.confirmation).toMatchObject({
      eventPlanId: EVENT_PLAN_ID,
      state: "shortage",
      ingredientCount: 2,
      shortageIngredientCount: 1
    });
    expect(mocks.callable.mock.calls.at(-1)[0].command).not.toHaveProperty("expectedStockRevisions");

    await expect(applyInventoryCommand({
      ...ADMIN_SCOPE,
      requestId: `inventory_request_${"a".repeat(32)}`,
      command: releaseEventCommand()
    })).resolves.toMatchObject({
      confirmation: { state: "released", allocationRevision: 2, releasedIngredientCount: 2 }
    });

    mocks.callable.mockImplementationOnce(async (payload) => ({
      data: responseFor(payload, { requiredMicros: 20_000_000 })
    }));
    await expect(applyInventoryCommand({
      ...ADMIN_SCOPE,
      requestId: `inventory_request_${"b".repeat(32)}`,
      command: allocateEventCommand()
    })).rejects.toThrow(/unsupported fields/i);
  });

  test("reconciles an uncertain recipe publication with the byte-identical command and idempotent receipt", async () => {
    const scope = { ...ADMIN_SCOPE, organizationId: "org-uncertain-recipe" };
    const requestId = `inventory_request_${"9".repeat(32)}`;
    const command = recipeCommand();
    mocks.callable.mockRejectedValueOnce(Object.assign(new Error("connection ended"), { code: "functions/unavailable" }));

    await expect(applyInventoryCommand({ ...scope, requestId, command })).rejects.toThrow(/connection ended/i);
    expect(readPendingInventoryCommands(scope)).toEqual([
      expect.objectContaining({ requestId, commandKind: "publish_menu_recipe", targetId: "chicken-pasta", state: "uncertain" })
    ]);

    mocks.callable.mockImplementationOnce(async (payload) => ({ data: { ...responseFor(payload), idempotent: true } }));
    await expect(reconcileInventoryCommand({ ...scope, requestId })).resolves.toMatchObject({
      commandKind: "publish_menu_recipe",
      mutationMode: "reconciliation",
      idempotent: true
    });
    expect(mocks.callable.mock.calls[1][0]).toEqual(mocks.callable.mock.calls[0][0]);
  });

  test("retains recipe publication uncertainty when returned projection evidence is not an allowed status", async () => {
    const scope = { ...ADMIN_SCOPE, organizationId: "org-invalid-recipe-result" };
    const requestId = `inventory_request_${"0".repeat(32)}`;
    mocks.callable.mockImplementationOnce(async (payload) => ({
      data: responseFor(payload, { status: "stale" })
    }));

    await expect(applyInventoryCommand({ ...scope, requestId, command: recipeCommand() }))
      .rejects.toMatchObject({ code: "unknown", inventoryDefinitive: false });
    expect(readPendingInventoryCommands(scope)).toEqual([
      expect.objectContaining({ requestId, commandKind: "publish_menu_recipe", state: "uncertain", definitive: false })
    ]);
  });

  test("keeps a transport-uncertain request byte-equivalent for reconciliation", async () => {
    const organizationId = "org-uncertain-command";
    const scope = { ...ADMIN_SCOPE, organizationId };
    const error = Object.assign(new Error("connection ended"), { code: "functions/unavailable" });
    mocks.callable.mockRejectedValueOnce(error);
    await expect(applyInventoryCommand({ ...scope, requestId: REQUEST_ID, command: locationCommand() })).rejects.toThrow(/connection ended/i);

    expect(readPendingInventoryCommands(scope)).toEqual([
      expect.objectContaining({ requestId: REQUEST_ID, commandKind: "upsert_location", state: "uncertain", definitive: false })
    ]);
    mocks.callable.mockImplementationOnce(async (payload) => ({ data: { ...responseFor(payload), idempotent: true } }));
    await expect(reconcileInventoryCommand({ ...scope, requestId: REQUEST_ID })).resolves.toMatchObject({ mutationMode: "reconciliation", idempotent: true });
    expect(mocks.callable.mock.calls[1][0]).toEqual(mocks.callable.mock.calls[0][0]);
  });

  test("treats aborted as definitive and allows a deliberate reset", async () => {
    const scope = { ...ADMIN_SCOPE, organizationId: "org-stale-command" };
    mocks.callable.mockRejectedValueOnce(Object.assign(new Error("revision stale"), { code: "functions/aborted" }));
    await expect(applyInventoryCommand({ ...scope, requestId: REQUEST_ID, command: locationCommand() })).rejects.toThrow(/revision stale/i);
    expect(readPendingInventoryCommands(scope)[0]).toMatchObject({ definitive: true, state: "error" });
    await expect(reconcileInventoryCommand({ ...scope, requestId: REQUEST_ID })).rejects.toThrow(/definitively rejected/i);
    expect(resetDefinitiveInventoryCommand({ ...scope, requestId: REQUEST_ID })).toBe(true);
  });

  test("rejects poison fields before calling Firebase", async () => {
    const command = Object.create(null);
    Object.assign(command, locationCommand());
    command.constructor = "poison";
    await expect(applyInventoryCommand({ ...ADMIN_SCOPE, requestId: REQUEST_ID, command })).rejects.toThrow(/unsupported fields/i);
    expect(mocks.callable).not.toHaveBeenCalled();
  });

  test("does not claim success from extra response keys or mismatched evidence", async () => {
    const scope = { ...ADMIN_SCOPE, organizationId: "org-invalid-response" };
    mocks.callable.mockImplementationOnce(async (payload) => ({ data: { ...responseFor(payload), storage: "firebase" } }));
    await expect(applyInventoryCommand({ ...scope, requestId: REQUEST_ID, command: locationCommand() })).rejects.toThrow(/unsupported fields/i);
    expect(readPendingInventoryCommands(scope)[0]).toMatchObject({ state: "uncertain", definitive: false });
  });
});

describe("inventory projection validation and listeners", () => {
  test("validates fixed-point stock and independent cost evidence without combining their state", () => {
    const projection = normalizeInventoryIngredientProjection(ingredientProjection(), ORGANIZATION_ID, "chicken");
    expect(projection.stock).toMatchObject({ state: "recorded", quantity: "40", revision: 1 });
    expect(projection.cost).toMatchObject({ state: "recorded", basisQuantity: "40", totalMinorUnits: 12_000 });

    const withoutEvidence = normalizeInventoryIngredientProjection(ingredientProjection({
      cost: { availability: "not_yet_available", costRevision: 0, sourceLabel: "", observedAtISO: "", lastCostEvidenceId: "" }
    }), ORGANIZATION_ID, "chicken");
    expect(withoutEvidence.stock.state).toBe("recorded");
    expect(withoutEvidence.cost.state).toBe("not_recorded");
  });

  test("rejects schema drift, cross-document identity, and contradictory micros", () => {
    expect(() => normalizeInventoryIngredientProjection(ingredientProjection({ schemaVersion: 1 }), ORGANIZATION_ID, "chicken"))
      .toThrow(/internally inconsistent|authority/i);
    expect(() => normalizeInventoryIngredientProjection(ingredientProjection(), ORGANIZATION_ID, "pasta"))
      .toThrow(/internally inconsistent/i);
    expect(() => normalizeInventoryIngredientProjection(ingredientProjection({ stock: { ...ingredientProjection().stock, quantity: "41" } }), ORGANIZATION_ID, "chicken"))
      .toThrow(/contradict/i);
    expect(() => normalizeInventoryWorkspaceProjection({ ...workspaceProjection(), rogue: true }, ORGANIZATION_ID))
      .toThrow(/unsupported fields/i);
  });

  test("subscribes to the exact workspace doc and bounded ordered ingredient query with metadata", () => {
    const registrations = [];
    const unsubscribes = [vi.fn(), vi.fn()];
    mocks.onSnapshot.mockImplementation((reference, options, onNext, onError) => {
      registrations.push({ reference, options, onNext, onError });
      return unsubscribes[registrations.length - 1];
    });
    const onData = vi.fn();
    const onError = vi.fn();
    const unsubscribe = subscribeToInventoryIngredientProjections({ ...ADMIN_SCOPE, onData, onError });

    expect(mocks.doc).toHaveBeenCalledWith(mocks.db, "organizations", ORGANIZATION_ID, "inventoryWorkspaceProjections", "current");
    expect(mocks.collection).toHaveBeenCalledWith(mocks.db, "organizations", ORGANIZATION_ID, "inventoryIngredientProjections");
    expect(mocks.orderBy).toHaveBeenCalledWith("nameSortKey", "asc");
    expect(mocks.limit).toHaveBeenCalledWith(INVENTORY_INGREDIENT_PROJECTION_LIMIT);
    expect(registrations).toHaveLength(2);
    expect(registrations.every((entry) => entry.options.includeMetadataChanges === true)).toBe(true);

    registrations[0].onNext({ id: "current", exists: () => true, data: () => workspaceProjection(), metadata: { fromCache: false, hasPendingWrites: false } });
    expect(onData.mock.calls.at(-1)[0]).toMatchObject({ freshness: "loading", sources: { workspace: { state: "current" }, ingredients: { state: "loading" } } });
    registrations[1].onNext({ docs: [{ id: "chicken", data: () => ingredientProjection() }], metadata: { fromCache: true, hasPendingWrites: false } });
    expect(onData.mock.calls.at(-1)[0]).toMatchObject({ freshness: "cached", sources: { ingredients: { state: "cached" } } });
    registrations[1].onNext({ docs: [{ id: "chicken", data: () => ingredientProjection() }], metadata: { fromCache: false, hasPendingWrites: true } });
    expect(onData.mock.calls.at(-1)[0].freshness).toBe("pending");
    registrations[1].onNext({ docs: [{ id: "chicken", data: () => ingredientProjection() }], metadata: { fromCache: false, hasPendingWrites: false } });
    expect(onData.mock.calls.at(-1)[0]).toMatchObject({ freshness: "current", ingredients: [{ ingredientId: "chicken" }] });

    const countBeforeUnsubscribe = onData.mock.calls.length;
    unsubscribe();
    expect(unsubscribes[0]).toHaveBeenCalledOnce();
    expect(unsubscribes[1]).toHaveBeenCalledOnce();
    registrations[1].onNext({ docs: [], metadata: { fromCache: false, hasPendingWrites: false } });
    expect(onData).toHaveBeenCalledTimes(countBeforeUnsubscribe);
  });

  test("turns projection schema drift into unavailable evidence rather than a current snapshot", () => {
    const registrations = [];
    mocks.onSnapshot.mockImplementation((reference, options, onNext, onError) => {
      registrations.push({ onNext, onError });
      return vi.fn();
    });
    const onData = vi.fn();
    const onError = vi.fn();
    subscribeToInventoryIngredientProjections({ ...ADMIN_SCOPE, onData, onError });
    registrations[0].onNext({ id: "current", exists: () => true, data: () => workspaceProjection(), metadata: {} });
    registrations[1].onNext({ docs: [{ id: "chicken", data: () => ingredientProjection({ schemaVersion: 1 }) }], metadata: {} });

    expect(onError).toHaveBeenCalledWith(expect.objectContaining({ code: "inventory-projections-unavailable", source: "ingredients" }));
    expect(onData.mock.calls.at(-1)[0].freshness).not.toBe("current");
  });

  test("confirms receipts only from a matching server-current projection", () => {
    const workspace = normalizeInventoryWorkspaceProjection(workspaceProjection(), ORGANIZATION_ID);
    const ingredient = normalizeInventoryIngredientProjection(ingredientProjection(), ORGANIZATION_ID, "chicken");
    const model = {
      organizationId: ORGANIZATION_ID,
      freshness: "current",
      workspace,
      ingredients: [ingredient]
    };
    const attempt = {
      receipt: { organizationId: ORGANIZATION_ID, commandKind: "opening_balance" },
      confirmation: { ingredientId: "chicken", stockRevision: 1, movementId: ingredient.stock.lastMovementId }
    };
    expect(inventoryProjectionConfirmsReceipt(model, attempt)).toBe(true);
    expect(inventoryProjectionConfirmsReceipt({ ...model, freshness: "cached" }, attempt)).toBe(false);
    const receivingAttempt = {
      receipt: { organizationId: ORGANIZATION_ID, commandKind: "receive_stock" },
      confirmation: {
        ingredientId: "chicken",
        stockRevision: 1,
        movementId: ingredient.stock.lastMovementId,
        costRevision: 1,
        costEvidenceId: `ice_${"9".repeat(48)}`
      }
    };
    expect(inventoryProjectionConfirmsReceipt(model, receivingAttempt)).toBe(true);
    expect(inventoryProjectionConfirmsReceipt({ ...model, freshness: "pending" }, receivingAttempt)).toBe(false);
  });
});

describe("menu costing projection access and realtime evidence", () => {
  test("allows same-tenant sales to read menu costs without granting ingredient-stock access", () => {
    const salesScope = { ...ADMIN_SCOPE, role: "sales" };
    expect(getInventoryMenuCostBrowserAccess(salesScope)).toMatchObject({
      readEnabled: true,
      mutationEnabled: false,
      role: "sales"
    });
    expect(getInventoryBrowserAccess(salesScope)).toMatchObject({ readEnabled: false, mutationEnabled: false });

    mocks.onSnapshot.mockReturnValue(vi.fn());
    expect(() => subscribeToInventoryMenuCostProjections({ ...salesScope, onData: vi.fn() })).not.toThrow();
    expect(() => subscribeToInventoryIngredientProjections({ ...salesScope, onData: vi.fn() })).toThrow(/administrator/i);
    expect(() => subscribeToInventoryRecipeIngredients({ ...salesScope, onData: vi.fn() })).toThrow(/administrator/i);
  });

  test.each([
    ["complete", "current", "$8.00", 2, 0],
    ["partial", "current", "$6.00", 1, 1],
    ["stale", "stale", "$8.00", 2, 0]
  ])("normalizes %s menu-cost projections with their exact completeness and freshness", (
    status,
    freshness,
    display,
    costedIngredientCount,
    missingCostIngredientCount
  ) => {
    const normalized = normalizeInventoryMenuCostProjection(
      menuCostProjection(status), ORGANIZATION_ID, "chicken-pasta"
    );
    expect(normalized).toMatchObject({
      menuItemId: "chicken-pasta",
      recipeRevision: 1,
      status,
      freshness,
      projectedIngredientCostDisplay: display,
      coverage: { costedIngredientCount, missingCostIngredientCount }
    });
    expect(normalized.recipeDefinition.lines.map(({ ingredientId }) => ingredientId)).toEqual(["chicken", "pasta"]);
    if (status === "stale") {
      expect(normalized.staleReason).toBe("ingredient_cost_changed");
      expect(normalized.cost.status).toBe("complete");
    }
    if (status === "partial") expect(normalized.cost).not.toHaveProperty("projectedCostMinor");
  });

  test("rejects projection authority drift and contradictory current status", () => {
    expect(() => normalizeInventoryMenuCostProjection(
      menuCostProjection("complete", { organizationId: "other-org" }), ORGANIZATION_ID, "chicken-pasta"
    )).toThrow(/authority boundary|internally inconsistent/i);
    expect(() => normalizeInventoryMenuCostProjection(
      menuCostProjection("complete", { status: "partial" }), ORGANIZATION_ID, "chicken-pasta"
    )).toThrow(/contradicts/i);
    expect(() => normalizeInventoryMenuCostProjection(
      menuCostProjection("stale", { staleReason: "" }), ORGANIZATION_ID, "chicken-pasta"
    )).toThrow(/internally inconsistent/i);
  });

  test("uses one bounded ordered onSnapshot query and retains menu-cost values through cache, pending writes, and errors", () => {
    const registrations = [];
    const unsubscribeSnapshot = vi.fn();
    mocks.onSnapshot.mockImplementation((reference, options, onNext, onError) => {
      registrations.push({ reference, options, onNext, onError });
      return unsubscribeSnapshot;
    });
    const onData = vi.fn();
    const onError = vi.fn();
    const unsubscribe = subscribeToInventoryMenuCostProjections({ ...ADMIN_SCOPE, onData, onError });

    expect(mocks.collection).toHaveBeenCalledWith(
      mocks.db, "organizations", ORGANIZATION_ID, "inventoryMenuCostProjections"
    );
    expect(mocks.orderBy).toHaveBeenCalledWith("menuItemNameSortKey", "asc");
    expect(mocks.limit).toHaveBeenCalledWith(INVENTORY_MENU_COST_PROJECTION_LIMIT);
    expect(registrations).toHaveLength(1);
    expect(registrations[0].options).toEqual({ includeMetadataChanges: true });

    const snapshot = (metadata) => ({
      docs: [{ id: "chicken-pasta", data: () => menuCostProjection("complete") }],
      metadata
    });
    registrations[0].onNext(snapshot({ fromCache: true, hasPendingWrites: false }));
    expect(onData.mock.calls.at(-1)[0]).toMatchObject({
      freshness: "cached",
      projections: [{ menuItemId: "chicken-pasta" }],
      source: { state: "cached", fromCache: true, hasPendingWrites: false }
    });
    registrations[0].onNext(snapshot({ fromCache: false, hasPendingWrites: true }));
    expect(onData.mock.calls.at(-1)[0]).toMatchObject({
      freshness: "pending",
      projections: [{ menuItemId: "chicken-pasta" }]
    });
    registrations[0].onNext(snapshot({ fromCache: false, hasPendingWrites: false }));
    expect(onData.mock.calls.at(-1)[0]).toMatchObject({
      freshness: "current",
      byMenuItemId: { "chicken-pasta": { status: "complete" } }
    });

    registrations[0].onError(new Error("listener disconnected"));
    expect(onData.mock.calls.at(-1)[0]).toMatchObject({
      freshness: "unavailable",
      projections: [{ menuItemId: "chicken-pasta" }]
    });
    expect(onError).toHaveBeenCalledWith(expect.objectContaining({
      code: "inventory-menu-cost-projections-unavailable",
      source: expect.objectContaining({ state: "unavailable" })
    }));

    const countBeforeUnsubscribe = onData.mock.calls.length;
    unsubscribe();
    expect(unsubscribeSnapshot).toHaveBeenCalledOnce();
    registrations[0].onNext(snapshot({ fromCache: false, hasPendingWrites: false }));
    expect(onData).toHaveBeenCalledTimes(countBeforeUnsubscribe);
  });

  test("uses an exact-document listener for the active menu item and treats only a current missing document as no recipe", () => {
    const registrations = [];
    mocks.onSnapshot.mockImplementation((reference, options, onNext, onError) => {
      registrations.push({ reference, options, onNext, onError });
      return vi.fn();
    });
    const onData = vi.fn();
    subscribeToInventoryMenuCostProjection({
      ...ADMIN_SCOPE,
      menuItemId: "chicken-pasta",
      onData
    });

    expect(mocks.doc).toHaveBeenCalledWith(
      mocks.db, "organizations", ORGANIZATION_ID, "inventoryMenuCostProjections", "chicken-pasta"
    );
    registrations[0].onNext({
      exists: () => false,
      metadata: { fromCache: true, hasPendingWrites: false }
    });
    expect(onData.mock.calls.at(-1)[0]).toMatchObject({
      menuItemId: "chicken-pasta", exists: false, projection: null, freshness: "cached"
    });

    registrations[0].onNext({
      exists: () => false,
      metadata: { fromCache: false, hasPendingWrites: false }
    });
    expect(onData.mock.calls.at(-1)[0]).toMatchObject({
      menuItemId: "chicken-pasta", exists: false, projection: null, freshness: "current"
    });

    registrations[0].onNext({
      exists: () => true,
      data: () => menuCostProjection("complete"),
      metadata: { fromCache: false, hasPendingWrites: false }
    });
    expect(onData.mock.calls.at(-1)[0]).toMatchObject({
      exists: true,
      freshness: "current",
      projection: { menuItemId: "chicken-pasta", recipeRevision: 1 }
    });
  });

  test("accepts the maximum server-produced issue envelope for a 50-line recipe", () => {
    const cost = {
      ...menuCostResult("invalid"),
      issues: Array.from({ length: (50 * 3) + 1 }, (_, index) => ({
        code: "invalid_recipe_evidence",
        lineId: `line-${index}`
      }))
    };
    expect(() => normalizeInventoryMenuCostProjection(
      menuCostProjection("invalid", { cost }), ORGANIZATION_ID, "chicken-pasta"
    )).not.toThrow();
  });

  test("subscribes recipe editing to the bounded ingredient projection and retains definitions on listener failure", () => {
    const registrations = [];
    mocks.onSnapshot.mockImplementation((reference, options, onNext, onError) => {
      registrations.push({ reference, options, onNext, onError });
      return vi.fn();
    });
    const onData = vi.fn();
    const onError = vi.fn();
    subscribeToInventoryRecipeIngredients({ ...ADMIN_SCOPE, onData, onError });

    expect(mocks.collection).toHaveBeenCalledWith(
      mocks.db, "organizations", ORGANIZATION_ID, "inventoryIngredientProjections"
    );
    expect(mocks.orderBy).toHaveBeenCalledWith("nameSortKey", "asc");
    expect(mocks.limit).toHaveBeenCalledWith(INVENTORY_INGREDIENT_PROJECTION_LIMIT);
    expect(registrations[0].options).toEqual({ includeMetadataChanges: true });

    registrations[0].onNext({
      docs: [{ id: "chicken", data: () => ingredientProjection({
        packConversions: [{
          packUnitId: "case",
          packLabel: "Case",
          revision: 1,
          packConversionRevisionId: PACK_CONVERSION_REVISION_ID,
          baseUnitId: "lb",
          baseQuantity: "10",
          sourceLabel: "Operator-declared case contents"
        }]
      }) }],
      metadata: { fromCache: false, hasPendingWrites: false }
    });
    expect(onData.mock.calls.at(-1)[0]).toMatchObject({
      freshness: "current",
      ingredients: [{
        ingredientId: "chicken",
        supportedRecipeUnits: expect.arrayContaining([
          expect.objectContaining({ unitKind: "ingredient_pack", packUnitId: "case" })
        ])
      }]
    });

    registrations[0].onError(new Error("listener disconnected"));
    expect(onData.mock.calls.at(-1)[0]).toMatchObject({
      freshness: "unavailable",
      ingredients: [{ ingredientId: "chicken" }]
    });
    expect(onError).toHaveBeenCalledWith(expect.objectContaining({
      code: "inventory-recipe-ingredients-unavailable"
    }));
  });
});

describe("event ingredient preview, immutable requirements, and exact realtime reads", () => {
  test("previews for authorized sales without granting mutation authority and sends only explicit output evidence", async () => {
    const salesScope = { ...ADMIN_SCOPE, role: "sales" };
    mocks.callable.mockImplementation(async (payload) => ({
      data: {
        ok: true,
        schemaVersion: 2,
        organizationId: ORGANIZATION_ID,
        quoteId: payload.quoteId,
        quoteRevisionId: payload.quoteRevisionId,
        preview: true,
        requirementRevision: eventIngredientRequirement(),
        ingredientLabels: [{ ingredientId: "chicken", name: "Chicken" }],
        projection: (() => {
          const {
            model, requirementRevision, ingredientLabels, freshness, staleReason,
            freshnessState, updatedAtISO, ...core
          } = eventIngredientProjection();
          return core;
        })()
      }
    }));

    const result = await previewEventInventory({
      ...salesScope,
      quoteId: "quote-event-1",
      quoteRevisionId: "quote-revision-17",
      requiredByBasis: { kind: "quote_event_start" },
      selections: [eventSelection()]
    });

    expect(mocks.httpsCallable).toHaveBeenCalledWith(mocks.cloudFunctions, INVENTORY_AUTHORITY_CALLABLES.previewEvent);
    expect(mocks.callable).toHaveBeenCalledWith({
      schemaVersion: 2,
      organizationId: ORGANIZATION_ID,
      quoteId: "quote-event-1",
      quoteRevisionId: "quote-revision-17",
      requiredByBasis: { kind: "quote_event_start" },
      selections: [eventSelection()]
    });
    expect(result).toMatchObject({
      preview: true,
      requirementRevision: { eventRequirementRevisionId: `eir_${"e".repeat(48)}` },
      projection: { costState: "complete", availabilityState: "shortage" }
    });
    await expect(previewEventInventory({
      ...ADMIN_SCOPE,
      role: "customer",
      quoteId: "quote-event-1",
      quoteRevisionId: "quote-revision-17",
      requiredByBasis: { kind: "quote_event_start" },
      selections: [eventSelection()]
    })).rejects.toThrow(/authorized staff/i);
  });

  test("accepts explicit missing recipe evidence while rejecting guessed and over-bounded selections", async () => {
    mocks.callable.mockImplementation(async () => { throw new Error("should not reach callable"); });
    const base = {
      ...ADMIN_SCOPE,
      quoteId: "quote-event-1",
      quoteRevisionId: "quote-revision-17",
      requiredByBasis: { kind: "quote_event_start" }
    };
    await expect(previewEventInventory({
      ...base,
      selections: [eventSelection({ recipeRevisionId: null, outputUnitId: null })]
    }))
      .rejects.toThrow(/should not reach callable/i);
    await expect(previewEventInventory({ ...base, selections: [{ ...eventSelection(), guestCount: 100 }] }))
      .rejects.toThrow(/unsupported fields/i);
    await expect(previewEventInventory({
      ...base,
      selections: Array.from({ length: INVENTORY_EVENT_SELECTION_LIMIT + 1 }, (_, index) => eventSelection({ selectionId: `selection-${index}` }))
    })).rejects.toThrow(/at most/i);
  });

  test("records an exact event requirement through the existing retry-safe command authority", async () => {
    const requestId = `inventory_request_${"2".repeat(32)}`;
    const command = compileEventCommand(requestId);
    mocks.callable.mockImplementation(async (payload) => ({ data: responseFor(payload) }));

    await expect(applyInventoryCommand({ ...ADMIN_SCOPE, requestId, command })).resolves.toMatchObject({
      commandKind: "compile_event_ingredient_demand",
      confirmation: {
        quoteId: "quote-event-1",
        quoteRevisionId: "quote-revision-17",
        requirementRevision: 1,
        demandState: "complete",
        costState: "complete",
        availabilityState: "shortage"
      }
    });
    await expect(applyInventoryCommand({
      ...ADMIN_SCOPE,
      requestId: `inventory_request_${"3".repeat(32)}`,
      command: { ...compileEventCommand(requestId), requestId }
    })).rejects.toThrow(/unsupported fields/i);
  });

  test("accepts a deterministic recompile that preserves the existing requirement head revision", async () => {
    const scope = { ...ADMIN_SCOPE, organizationId: "org-event-same-requirement" };
    const requestId = `inventory_request_${"4".repeat(32)}`;
    const command = { ...compileEventCommand(), expectedRequirementRevision: 4 };
    mocks.callable.mockImplementation(async (payload) => ({
      data: responseFor(payload, { requirementRevision: 4 })
    }));
    await expect(applyInventoryCommand({ ...scope, requestId, command })).resolves.toMatchObject({
      confirmation: { requirementRevision: 4 }
    });
  });

  test("validates persisted wrapper identity while retaining independent demand, cost, and stock rails", () => {
    const allocation = {
      state: "shortage",
      eventPlanId: EVENT_PLAN_ID,
      allocationRevision: 1,
      eventRequirementRevisionId: EVENT_REQUIREMENT_REVISION_ID,
      ingredientCount: 1,
      fullyAllocatedIngredientCount: 0,
      shortageIngredientCount: 1,
      ingredients: [{
        ingredientId: "chicken",
        locationId: "main-kitchen",
        baseUnitId: "lb",
        requiredQuantityMicros: 20_000_000,
        allocatedQuantityMicros: 15_000_000,
        shortageQuantityMicros: 5_000_000
      }]
    };
    const normalized = normalizeEventIngredientProjection(
      eventIngredientProjection({ allocation }), ORGANIZATION_ID, "quote-event-1"
    );
    expect(normalized).toMatchObject({
      quoteRevisionId: "quote-revision-17",
      requirementRevision: 1,
      demandState: "complete",
      costState: "complete",
      availabilityState: "shortage",
      ingredients: [{ requiredQuantityMicros: 20_000_000, shortageQuantityMicros: 5_000_000 }],
      allocation: {
        state: "shortage",
        ingredientCount: 1,
        ingredients: [{ ingredientName: "Chicken", allocatedQuantityMicros: 15_000_000 }]
      }
    });
    expect(() => normalizeEventIngredientProjection(
      eventIngredientProjection({ organizationId: "other-org" }), ORGANIZATION_ID, "quote-event-1"
    )).toThrow(/authority boundary/i);
    expect(() => normalizeEventIngredientProjection(
      eventIngredientProjection({ model: "other-model" }), ORGANIZATION_ID, "quote-event-1"
    )).toThrow(/model/i);
    expect(() => normalizeEventIngredientProjection(eventIngredientProjection({
      allocation: {
        ...allocation,
        ingredients: [{ ...allocation.ingredients[0], baseUnitId: "oz" }]
      }
    }), ORGANIZATION_ID, "quote-event-1")).toThrow(/saved requirement projection/i);
  });

  test("accepts an explicitly stale retained allocation without rebinding it to the revised requirement", () => {
    const retainedAllocation = {
      state: "reserved",
      eventPlanId: EVENT_PLAN_ID,
      allocationRevision: 3,
      eventRequirementRevisionId: `eir_${"f".repeat(48)}`,
      ingredientCount: 1,
      fullyAllocatedIngredientCount: 1,
      shortageIngredientCount: 0,
      ingredients: [{
        ingredientId: "chicken",
        locationId: "main-kitchen",
        baseUnitId: "lb",
        requiredQuantityMicros: 10_000_000,
        allocatedQuantityMicros: 10_000_000,
        shortageQuantityMicros: 0
      }]
    };
    const staleFreshness = {
      demand: { state: "current", reason: "" },
      cost: { state: "current", reason: "" },
      availability: { state: "current", reason: "" },
      allocation: { state: "stale", reason: "requirement_changed" }
    };
    expect(normalizeEventIngredientProjection(eventIngredientProjection({
      allocation: retainedAllocation,
      freshnessState: staleFreshness
    }), ORGANIZATION_ID, "quote-event-1")).toMatchObject({
      freshnessState: staleFreshness,
      allocation: {
        allocationRevision: 3,
        eventRequirementRevisionId: retainedAllocation.eventRequirementRevisionId,
        ingredients: [{ requiredQuantityMicros: 10_000_000 }]
      }
    });
    expect(() => normalizeEventIngredientProjection(eventIngredientProjection({
      allocation: retainedAllocation,
      freshnessState: { ...staleFreshness, allocation: { state: "current", reason: "" } }
    }), ORGANIZATION_ID, "quote-event-1")).toThrow(/saved requirement projection/i);
  });

  test("uses exact document metadata, retains prior evidence as stale on failure, and ignores callbacks after teardown", () => {
    const registrations = [];
    const unsubscribeSnapshot = vi.fn();
    mocks.onSnapshot.mockImplementation((reference, options, onNext, onError) => {
      registrations.push({ reference, options, onNext, onError });
      return unsubscribeSnapshot;
    });
    const onData = vi.fn();
    const onError = vi.fn();
    const unsubscribe = subscribeToEventIngredientProjection({
      ...ADMIN_SCOPE,
      role: "sales",
      quoteId: "quote-event-1",
      onData,
      onError
    });

    expect(mocks.doc).toHaveBeenCalledWith(
      mocks.db, "organizations", ORGANIZATION_ID, "eventIngredientProjections", "quote-event-1"
    );
    expect(registrations[0].options).toEqual({ includeMetadataChanges: true });
    const snapshot = (metadata) => ({
      exists: () => true,
      data: () => eventIngredientProjection(),
      metadata
    });
    registrations[0].onNext(snapshot({ fromCache: true, hasPendingWrites: false }));
    expect(onData.mock.calls.at(-1)[0]).toMatchObject({ freshness: "cached", projection: { quoteId: "quote-event-1" } });
    registrations[0].onNext(snapshot({ fromCache: false, hasPendingWrites: true }));
    expect(onData.mock.calls.at(-1)[0]).toMatchObject({ freshness: "pending" });
    registrations[0].onNext(snapshot({ fromCache: false, hasPendingWrites: false }));
    expect(onData.mock.calls.at(-1)[0]).toMatchObject({ freshness: "current" });
    registrations[0].onError(new Error("disconnected"));
    expect(onData.mock.calls.at(-1)[0]).toMatchObject({
      freshness: "unavailable", retained: true, projection: { quoteId: "quote-event-1" }
    });
    expect(onError).toHaveBeenCalledWith(expect.objectContaining({ code: "event-ingredient-projection-unavailable" }));

    const emitted = onData.mock.calls.length;
    unsubscribe();
    expect(unsubscribeSnapshot).toHaveBeenCalledOnce();
    registrations[0].onNext(snapshot({ fromCache: false, hasPendingWrites: false }));
    expect(onData).toHaveBeenCalledTimes(emitted);
  });
});
