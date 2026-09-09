"use strict";

const inventory = require("./inventoryIngredientCore.cjs");
const recipe = require("./inventoryRecipeCore.cjs");
const eventDemand = require("./inventoryEventDemandCore.cjs");
const { wallTimeToExactISO } = require("./operationalStaffingRuntime.js");

const COLLECTIONS = Object.freeze({
  locations: "inventoryLocations",
  ingredients: "inventoryIngredients",
  movements: "inventoryMovements",
  stockStates: "inventoryStockStates",
  costEvidence: "inventoryCostEvidence",
  costStates: "inventoryCostStates",
  authorityState: "inventoryAuthorityState",
  receipts: "inventoryAuthorityReceipts",
  workspaceProjections: "inventoryWorkspaceProjections",
  ingredientProjections: "inventoryIngredientProjections",
  recipePolicies: "inventoryRecipePolicies",
  recipeHeads: "inventoryRecipeHeads",
  recipeDependencies: "inventoryRecipeDependencyIndex",
  packConversionRevisions: "inventoryPackConversionRevisions",
  packConversionHeads: "inventoryPackConversionHeads",
  menuCostProjections: "inventoryMenuCostProjections",
  eventRequirementHeads: "eventIngredientRequirementHeads",
  eventRequirements: "eventIngredientRequirements",
  eventProjections: "eventIngredientProjections"
});
const WORKSPACE_LIMIT = 200;
const MENU_COST_PROJECTION_LIMIT = 200;
const MAX_PUBLISHED_RECIPE_LINES = 50;
const COMMAND_KINDS = new Set([
  "upsert_location", "upsert_ingredient", "opening_balance", "record_ingredient_cost",
  "publish_pack_conversion", "publish_menu_recipe", "compile_event_ingredient_demand"
]);

function isRecord(value) {
  if (!value || typeof value !== "object" || Array.isArray(value)) return false;
  const prototype = Object.getPrototypeOf(value);
  return prototype === Object.prototype || prototype === null;
}

function exactKeys(value, keys, label) {
  if (!isRecord(value) || Object.keys(value).length !== keys.length
    || keys.some((key) => !Object.hasOwn(value, key))) {
    throw new inventory.InventoryIngredientError("invalid-argument", `${label} contains missing or unsupported fields.`);
  }
}

function boundedText(value, label, maximum, { allowEmpty = false } = {}) {
  if (typeof value !== "string" || value !== value.trim()) {
    throw new inventory.InventoryIngredientError("invalid-argument", `${label} must be exact text.`);
  }
  const normalized = value.replace(/\s+/gu, " ");
  if ((!allowEmpty && !normalized) || normalized.length > maximum) {
    throw new inventory.InventoryIngredientError("invalid-argument", `${label} must be bounded${allowEmpty ? "" : " non-empty"} text.`);
  }
  return normalized;
}

function normalizePackConversionCommand(value) {
  exactKeys(value, [
    "kind", "ingredientId", "packUnitId", "packLabel", "baseUnitId", "baseQuantity",
    "sourceLabel", "expectedRevision"
  ], "Ingredient pack conversion command");
  const expectedRevision = inventory.revision(value.expectedRevision, "pack conversion expected revision");
  recipe.createPackConversionRevision({
    organizationId: "validation-org",
    ingredientId: value.ingredientId,
    packUnitId: value.packUnitId,
    packLabel: value.packLabel,
    revision: expectedRevision + 1,
    baseUnitId: value.baseUnitId,
    baseQuantity: value.baseQuantity,
    sourceLabel: value.sourceLabel,
    publishedAtISO: "2000-01-01T00:00:00.000Z"
  });
}

function normalizeRecipeCommand(value) {
  exactKeys(value, [
    "kind", "menuItemId", "expectedCatalogRevision", "expectedRecipeRevision",
    "outputYield", "outputUnitId", "lines"
  ], "Menu recipe publication command");
  const expectedRecipeRevision = inventory.revision(value.expectedRecipeRevision, "recipe expected revision");
  inventory.revision(value.expectedCatalogRevision, "catalog expected revision");
  if (!Array.isArray(value.lines) || value.lines.length > MAX_PUBLISHED_RECIPE_LINES) {
    throw new inventory.InventoryIngredientError(
      "resource-exhausted",
      `Published recipes currently support at most ${MAX_PUBLISHED_RECIPE_LINES} ingredient lines.`
    );
  }
  recipe.createRecipeRevision({
    organizationId: "validation-org",
    menuItemId: value.menuItemId,
    revision: expectedRecipeRevision + 1,
    priorRecipeRevisionId: expectedRecipeRevision === 0 ? "" : recipe.recipeRevisionIdFor(
      "validation-org", value.menuItemId, expectedRecipeRevision
    ),
    outputYield: value.outputYield,
    outputUnitId: value.outputUnitId,
    lines: value.lines,
    publishedAtISO: "2000-01-01T00:00:00.000Z"
  });
}

function normalizedDemandSelections({ organizationId, quoteId, quoteRevisionId, selections }) {
  if (!Array.isArray(selections) || selections.length === 0) {
    throw new inventory.InventoryIngredientError(
      "invalid-argument",
      "Event ingredient demand requires at least one exact menu selection."
    );
  }
  try {
    const dryRun = eventDemand.compileEventIngredientDemand({
      organizationId,
      quoteId,
      quoteRevisionId,
      requiredByISO: "2000-01-01T00:00:00.000Z",
      selections,
      recipeRevisions: [],
      recipeCostResults: [],
      stockStates: [],
      activeAllocations: []
    });
    return dryRun.requirementRevision.selections.map((selection) => Object.freeze({
      selectionId: selection.selectionId,
      menuItemId: selection.menuItemId,
      recipeRevisionId: selection.recipeRevisionId,
      requiredOutputQuantity: selection.requiredOutputQuantity,
      outputUnitId: selection.outputUnitId,
      portionBasis: selection.portionBasis,
      commercialProvenance: selection.commercialProvenance
    }));
  } catch (error) {
    if (error instanceof eventDemand.InventoryEventDemandError) {
      throw new inventory.InventoryIngredientError(error.code, error.message);
    }
    throw error;
  }
}

function normalizeEventDemandInput(value, { includeExpectedRevision }) {
  const keys = ["quoteId", "quoteRevisionId", "requiredByBasis", "selections"];
  if (includeExpectedRevision) keys.unshift("kind", "expectedRequirementRevision", "expectedPreviewProjectionDigest");
  exactKeys(value, keys, includeExpectedRevision
    ? "Event ingredient demand command"
    : "Event ingredient demand preview");
  if (includeExpectedRevision && value.kind !== "compile_event_ingredient_demand") {
    throw new inventory.InventoryIngredientError("invalid-argument", "Event ingredient demand command kind is invalid.");
  }
  const normalized = {
    ...(includeExpectedRevision ? {
      kind: value.kind,
      expectedRequirementRevision: inventory.revision(
        value.expectedRequirementRevision,
        "event requirement expected revision"
      ),
      expectedPreviewProjectionDigest: (() => {
        if (!/^[a-f0-9]{64}$/u.test(value.expectedPreviewProjectionDigest)) {
          throw new inventory.InventoryIngredientError(
            "invalid-argument",
            "Event ingredient recording requires the exact preview projection digest."
          );
        }
        return value.expectedPreviewProjectionDigest;
      })()
    } : {}),
    quoteId: inventory.opaqueId(value.quoteId, "quoteId"),
    quoteRevisionId: inventory.opaqueId(value.quoteRevisionId, "quoteRevisionId"),
    requiredByBasis: (() => {
      exactKeys(value.requiredByBasis, ["kind"], "Event ingredient required-by basis");
      if (value.requiredByBasis.kind !== "quote_event_start") {
        throw new inventory.InventoryIngredientError(
          "invalid-argument",
          "Event ingredient required-by basis must use the immutable quote event start."
        );
      }
      return Object.freeze({ kind: "quote_event_start" });
    })()
  };
  normalized.selections = Object.freeze(normalizedDemandSelections({
    organizationId: "validation-org",
    quoteId: normalized.quoteId,
    quoteRevisionId: normalized.quoteRevisionId,
    selections: value.selections
  }));
  return Object.freeze(normalized);
}

function normalizeCommand(value) {
  if (!isRecord(value) || !COMMAND_KINDS.has(value.kind)) {
    throw new inventory.InventoryIngredientError("invalid-argument", "A supported ingredient inventory command is required.");
  }
  if (value.kind === "upsert_location") inventory.normalizeLocationRequest(value);
  else if (value.kind === "upsert_ingredient") inventory.normalizeIngredientRequest(value);
  else if (value.kind === "opening_balance") inventory.normalizeOpeningBalanceRequest(value);
  else if (value.kind === "record_ingredient_cost") inventory.normalizeCostEvidenceRequest(value);
  else if (value.kind === "publish_pack_conversion") normalizePackConversionCommand(value);
  else if (value.kind === "publish_menu_recipe") normalizeRecipeCommand(value);
  else normalizeEventDemandInput(value, { includeExpectedRevision: true });
  return inventory.canonicalClone(value, "ingredient inventory command");
}

function normalizeApplyEnvelope(data) {
  exactKeys(data, ["schemaVersion", "organizationId", "requestId", "command"], "Ingredient inventory command envelope");
  if (data.schemaVersion !== inventory.INVENTORY_SCHEMA_VERSION) {
    throw new inventory.InventoryIngredientError("invalid-argument", "Ingredient inventory command schemaVersion is unsupported.");
  }
  return Object.freeze({
    schemaVersion: inventory.INVENTORY_SCHEMA_VERSION,
    organizationId: inventory.opaqueId(data.organizationId, "organizationId"),
    requestId: inventory.requestId(data.requestId),
    command: Object.freeze(normalizeCommand(data.command))
  });
}

function normalizeWorkspaceEnvelope(data) {
  exactKeys(data, ["schemaVersion", "organizationId"], "Ingredient inventory workspace request");
  if (data.schemaVersion !== inventory.INVENTORY_SCHEMA_VERSION) {
    throw new inventory.InventoryIngredientError("invalid-argument", "Ingredient inventory workspace schemaVersion is unsupported.");
  }
  return Object.freeze({
    schemaVersion: inventory.INVENTORY_SCHEMA_VERSION,
    organizationId: inventory.opaqueId(data.organizationId, "organizationId")
  });
}

function normalizeEventDemandPreviewEnvelope(data) {
  exactKeys(data, [
    "schemaVersion", "organizationId", "quoteId", "quoteRevisionId", "requiredByBasis", "selections"
  ], "Event ingredient demand preview envelope");
  if (data.schemaVersion !== inventory.INVENTORY_SCHEMA_VERSION) {
    throw new inventory.InventoryIngredientError("invalid-argument", "Event ingredient demand preview schemaVersion is unsupported.");
  }
  return Object.freeze({
    schemaVersion: inventory.INVENTORY_SCHEMA_VERSION,
    organizationId: inventory.opaqueId(data.organizationId, "organizationId"),
    ...normalizeEventDemandInput({
      quoteId: data.quoteId,
      quoteRevisionId: data.quoteRevisionId,
      requiredByBasis: data.requiredByBasis,
      selections: data.selections
    }, { includeExpectedRevision: false })
  });
}

function receiptIdFor(organizationId, retryId) {
  return `iar_${inventory.digest({
    organizationId: inventory.opaqueId(organizationId, "organizationId"),
    requestId: inventory.requestId(retryId)
  }).slice(0, 48)}`;
}

function safeLocation(location) {
  return Object.freeze({
    schemaVersion: inventory.INVENTORY_SCHEMA_VERSION,
    locationId: location.locationId,
    name: location.name,
    active: location.active,
    revision: location.revision,
    updatedAtISO: location.updatedAtISO
  });
}

function projectedLocation(location) {
  return Object.freeze({
    locationId: location.locationId,
    name: location.name,
    active: location.active,
    revision: location.revision
  });
}

function projectStockAxis(stockStates) {
  if (stockStates.length > 1) {
    throw new inventory.InventoryIngredientError(
      "failed-precondition",
      "Ingredient stock currently supports one authoritative location. Multiple states require an explicit later-phase aggregation policy."
    );
  }
  if (!stockStates.length) {
    return Object.freeze({
      availability: "not_yet_available",
      stockRevision: 0,
      onHandMicros: 0,
      quantity: "0",
      locationId: "",
      lastMovementId: ""
    });
  }
  const [state] = stockStates;
  return Object.freeze({
    availability: "current",
    stockRevision: state.revision,
    onHandMicros: state.onHandMicros,
    quantity: inventory.formatQuantityMicros(state.onHandMicros),
    locationId: state.locationId,
    lastMovementId: state.lastMovementId
  });
}

function projectCostAxis(costState) {
  if (!costState) return Object.freeze({
    availability: "not_yet_available",
    costRevision: 0,
    sourceLabel: "",
    observedAtISO: "",
    lastCostEvidenceId: ""
  });
  const result = {
    availability: costState.availability,
    costRevision: costState.revision,
    sourceLabel: costState.sourceLabel,
    observedAtISO: costState.observedAtISO,
    lastCostEvidenceId: costState.lastCostEvidenceId
  };
  if (costState.availability === "available") {
    Object.assign(result, {
      basisQuantityMicros: costState.basisQuantityMicros,
      totalCostMinor: costState.totalCostMinor,
      currency: costState.currency
    });
  }
  return Object.freeze(result);
}

function projectedPackConversion(head) {
  return Object.freeze({
    packUnitId: head.packUnitId,
    packLabel: head.packLabel,
    revision: head.revision,
    packConversionRevisionId: head.packConversionRevisionId,
    baseUnitId: head.baseUnitId,
    baseQuantity: head.baseQuantity,
    sourceLabel: head.sourceLabel
  });
}

function ingredientProjection({ ingredient, stockStates, costState, packConversionHeads = [], nowISO }) {
  const stock = projectStockAxis(stockStates);
  const cost = projectCostAxis(costState);
  return Object.freeze({
    authorityVersion: inventory.INVENTORY_AUTHORITY_VERSION,
    schemaVersion: inventory.INVENTORY_SCHEMA_VERSION,
    model: "inventory-ingredient-projection-v2",
    organizationId: ingredient.organizationId,
    ingredientId: ingredient.ingredientId,
    name: ingredient.name,
    nameSortKey: ingredient.nameSortKey,
    category: ingredient.category,
    baseUnitId: ingredient.baseUnitId,
    dimension: ingredient.dimension,
    active: ingredient.active,
    ingredientRevision: ingredient.revision,
    stock,
    cost,
    packConversions: Object.freeze(packConversionHeads
      .map(projectedPackConversion)
      .sort((left, right) => left.packLabel.localeCompare(right.packLabel)
        || left.packUnitId.localeCompare(right.packUnitId))),
    updatedAtISO: nowISO
  });
}

function menuIdentity(menuItem, menuItemId) {
  const identity = {
    menuItemId: inventory.opaqueId(menuItemId, "menuItemId"),
    eventTypeId: inventory.opaqueId(menuItem?.eventTypeId, "menu item eventTypeId"),
    categoryId: inventory.opaqueId(menuItem?.categoryId, "menu item categoryId"),
    name: boundedText(menuItem?.name, "menu item name", 120),
    priceMinor: menuItem?.priceMinor,
    costMinor: menuItem?.costMinor ?? null,
    pricingType: boundedText(menuItem?.pricingType, "menu item pricingType", 40),
    type: boundedText(menuItem?.type, "menu item type", 40),
    active: menuItem?.active
  };
  if (!Number.isSafeInteger(identity.priceMinor) || identity.priceMinor < 0
    || (identity.costMinor !== null && (!Number.isSafeInteger(identity.costMinor) || identity.costMinor < 0))
    || typeof identity.active !== "boolean") {
    throw new inventory.InventoryIngredientError("data-loss", "Canonical menu item fields are invalid for recipe publication.");
  }
  return Object.freeze({ ...identity, identityDigest: inventory.digest(identity, "menu item recipe identity") });
}

function packHeadId(ingredientId, packUnitId) {
  return `iph_${inventory.digest({
    ingredientId: inventory.opaqueId(ingredientId, "ingredientId"),
    packUnitId: inventory.opaqueId(packUnitId, "packUnitId")
  }, "ingredient pack head identity").slice(0, 48)}`;
}

function verifyPackHead(value, { organizationId, ingredientId, documentId } = {}) {
  exactKeys(value, [
    "authorityVersion", "schemaVersion", "model", "organizationId", "ingredientId", "headId",
    "packUnitId", "packLabel", "revision", "packConversionRevisionId", "baseUnitId",
    "baseQuantity", "sourceLabel", "updatedAtISO"
  ], "Ingredient pack conversion head");
  if (value.authorityVersion !== inventory.INVENTORY_AUTHORITY_VERSION
    || value.schemaVersion !== inventory.INVENTORY_SCHEMA_VERSION
    || value.model !== "ingredient-pack-conversion-head-v2"
    || value.organizationId !== organizationId || value.ingredientId !== ingredientId
    || value.headId !== packHeadId(ingredientId, value.packUnitId)
    || (documentId && value.headId !== documentId)) {
    throw new inventory.InventoryIngredientError("data-loss", "Ingredient pack conversion head identity is invalid.");
  }
  inventory.revision(value.revision, "pack conversion revision", { allowZero: false });
  inventory.baseUnitId(value.baseUnitId);
  inventory.formatQuantityMicros(inventory.parseQuantityMicros(value.baseQuantity, "pack base quantity"));
  boundedText(value.packLabel, "pack label", 80);
  boundedText(value.sourceLabel, "pack source", 120);
  inventory.exactISO(value.updatedAtISO, "pack head updatedAtISO");
  if (value.packConversionRevisionId !== recipe.packConversionRevisionIdFor(
    organizationId, ingredientId, value.packUnitId, value.revision
  )) {
    throw new inventory.InventoryIngredientError("data-loss", "Ingredient pack conversion head revision is inconsistent.");
  }
  return value;
}

function recipeHead(menuItem, recipeRevision, catalogRevision, nowISO) {
  const identity = menuIdentity(menuItem, recipeRevision.menuItemId);
  const ingredientIds = [...new Set(recipeRevision.lines.map((line) => line.ingredientId))].sort();
  const packConversionRevisionIds = [...new Set(recipeRevision.lines
    .filter((line) => line.unitKind === "ingredient_pack")
    .map((line) => line.packConversionRevisionId))].sort();
  return Object.freeze({
    authorityVersion: inventory.INVENTORY_AUTHORITY_VERSION,
    schemaVersion: inventory.INVENTORY_SCHEMA_VERSION,
    model: "ingredient-recipe-head-v2",
    organizationId: recipeRevision.organizationId,
    menuItemId: recipeRevision.menuItemId,
    revision: recipeRevision.revision,
    recipeRevisionId: recipeRevision.recipeRevisionId,
    recipeDigest: recipeRevision.recipeDigest,
    catalogRevision,
    menuIdentity: identity,
    ingredientIds: Object.freeze(ingredientIds),
    packConversionRevisionIds: Object.freeze(packConversionRevisionIds),
    updatedAtISO: nowISO
  });
}

function verifyRecipeHead(value, { organizationId, menuItemId, documentId } = {}) {
  exactKeys(value, [
    "authorityVersion", "schemaVersion", "model", "organizationId", "menuItemId", "revision",
    "recipeRevisionId", "recipeDigest", "catalogRevision", "menuIdentity", "ingredientIds",
    "packConversionRevisionIds", "updatedAtISO"
  ], "Ingredient recipe head");
  if (value.authorityVersion !== inventory.INVENTORY_AUTHORITY_VERSION
    || value.schemaVersion !== inventory.INVENTORY_SCHEMA_VERSION
    || value.model !== "ingredient-recipe-head-v2"
    || value.organizationId !== organizationId || value.menuItemId !== menuItemId
    || (documentId && documentId !== menuItemId)
    || value.recipeRevisionId !== recipe.recipeRevisionIdFor(organizationId, menuItemId, value.revision)) {
    throw new inventory.InventoryIngredientError("data-loss", "Ingredient recipe head identity is invalid.");
  }
  inventory.revision(value.revision, "recipe head revision", { allowZero: false });
  inventory.revision(value.catalogRevision, "recipe catalog revision");
  inventory.exactISO(value.updatedAtISO, "recipe head updatedAtISO");
  if (!Array.isArray(value.ingredientIds) || value.ingredientIds.length > recipe.MAX_RECIPE_LINES
    || !Array.isArray(value.packConversionRevisionIds) || value.packConversionRevisionIds.length > recipe.MAX_PACK_CONVERSIONS
    || [...value.ingredientIds].sort().join("\u0000") !== value.ingredientIds.join("\u0000")
    || new Set(value.ingredientIds).size !== value.ingredientIds.length) {
    throw new inventory.InventoryIngredientError("data-loss", "Ingredient recipe head dependencies are invalid.");
  }
  value.ingredientIds.forEach((ingredientId) => inventory.opaqueId(ingredientId, "recipe ingredientId"));
  value.packConversionRevisionIds.forEach((revisionId) => inventory.opaqueId(revisionId, "recipe pack conversion revisionId"));
  const identity = menuIdentity(value.menuIdentity, menuItemId);
  if (inventory.canonicalSerialize(identity) !== inventory.canonicalSerialize(value.menuIdentity)) {
    throw new inventory.InventoryIngredientError("data-loss", "Ingredient recipe menu identity snapshot is invalid.");
  }
  return value;
}

function recipePolicy(head, recipeRevision) {
  const body = {
    authorityVersion: inventory.INVENTORY_AUTHORITY_VERSION,
    schemaVersion: inventory.INVENTORY_SCHEMA_VERSION,
    model: "ingredient-recipe-policy-v2",
    organizationId: head.organizationId,
    menuItemId: head.menuItemId,
    recipeRevisionId: recipeRevision.recipeRevisionId,
    catalogRevision: head.catalogRevision,
    menuIdentity: head.menuIdentity,
    recipeRevision
  };
  return Object.freeze({ ...body, policyDigest: inventory.digest(body, "ingredient recipe policy") });
}

function verifyRecipePolicy(value, { organizationId, recipeRevisionId, documentId } = {}) {
  exactKeys(value, [
    "authorityVersion", "schemaVersion", "model", "organizationId", "menuItemId",
    "recipeRevisionId", "catalogRevision", "menuIdentity", "recipeRevision", "policyDigest"
  ], "Ingredient recipe policy");
  const { policyDigest, ...body } = value;
  if (value.authorityVersion !== inventory.INVENTORY_AUTHORITY_VERSION
    || value.schemaVersion !== inventory.INVENTORY_SCHEMA_VERSION
    || value.model !== "ingredient-recipe-policy-v2" || value.organizationId !== organizationId
    || value.recipeRevisionId !== recipeRevisionId || (documentId && documentId !== recipeRevisionId)
    || policyDigest !== inventory.digest(body, "ingredient recipe policy")) {
    throw new inventory.InventoryIngredientError("data-loss", "Ingredient recipe policy identity or digest is invalid.");
  }
  recipe.verifyRecipeRevision(value.recipeRevision);
  if (value.recipeRevision.organizationId !== organizationId
    || value.recipeRevision.menuItemId !== value.menuItemId
    || value.recipeRevision.recipeRevisionId !== recipeRevisionId
    || inventory.canonicalSerialize(menuIdentity(value.menuIdentity, value.menuItemId))
      !== inventory.canonicalSerialize(value.menuIdentity)) {
    throw new inventory.InventoryIngredientError("data-loss", "Ingredient recipe policy provenance is invalid.");
  }
  inventory.revision(value.catalogRevision, "recipe policy catalog revision");
  return value;
}

function verifyRecipeDependency(value, { organizationId, ingredientId, documentId } = {}) {
  exactKeys(value, [
    "authorityVersion", "schemaVersion", "model", "organizationId", "ingredientId",
    "menuItemIds", "revision", "updatedAtISO"
  ], "Ingredient recipe dependency index");
  if (value.authorityVersion !== inventory.INVENTORY_AUTHORITY_VERSION
    || value.schemaVersion !== inventory.INVENTORY_SCHEMA_VERSION
    || value.model !== "ingredient-recipe-dependency-index-v2"
    || value.organizationId !== organizationId || value.ingredientId !== ingredientId
    || (documentId && documentId !== ingredientId)
    || !Array.isArray(value.menuItemIds) || value.menuItemIds.length > MENU_COST_PROJECTION_LIMIT
    || [...value.menuItemIds].sort().join("\u0000") !== value.menuItemIds.join("\u0000")
    || new Set(value.menuItemIds).size !== value.menuItemIds.length) {
    throw new inventory.InventoryIngredientError("data-loss", "Ingredient recipe dependency index is invalid.");
  }
  value.menuItemIds.forEach((menuItemId) => inventory.opaqueId(menuItemId, "dependent menuItemId"));
  inventory.revision(value.revision, "recipe dependency revision", { allowZero: false });
  inventory.exactISO(value.updatedAtISO, "recipe dependency updatedAtISO");
  return value;
}

function menuCostProjection({ head, policy, cost, nowISO }) {
  const recipeDefinitionBody = {
    revision: policy.recipeRevision.revision,
    recipeRevisionId: policy.recipeRevision.recipeRevisionId,
    recipeDigest: policy.recipeRevision.recipeDigest,
    outputYield: policy.recipeRevision.outputYield,
    outputUnitId: policy.recipeRevision.outputUnitId,
    lines: policy.recipeRevision.lines
  };
  const sourceDigest = inventory.digest({
    organizationId: head.organizationId,
    menuItemId: head.menuItemId,
    menuIdentityDigest: head.menuIdentity.identityDigest,
    observedCatalogRevision: head.catalogRevision,
    recipeRevisionId: head.recipeRevisionId,
    recipeDigest: head.recipeDigest,
    policyDigest: policy.policyDigest,
    costResultDigest: cost.resultDigest
  }, "inventory menu cost projection sources");
  const body = {
    authorityVersion: inventory.INVENTORY_AUTHORITY_VERSION,
    schemaVersion: inventory.INVENTORY_SCHEMA_VERSION,
    model: "inventory-menu-cost-projection-v2",
    organizationId: head.organizationId,
    menuItemId: head.menuItemId,
    menuItemName: head.menuIdentity.name,
    menuItemNameSortKey: head.menuIdentity.name.toLocaleLowerCase("en-US"),
    observedCatalogRevision: head.catalogRevision,
    menuIdentityDigest: head.menuIdentity.identityDigest,
    recipeRevision: head.revision,
    recipeRevisionId: head.recipeRevisionId,
    recipeDigest: head.recipeDigest,
    policyDigest: policy.policyDigest,
    recipeDefinition: Object.freeze({
      ...recipeDefinitionBody,
      definitionDigest: inventory.digest(recipeDefinitionBody, "projected recipe definition")
    }),
    status: cost.status,
    freshness: "current",
    staleReason: "",
    cost,
    updatedAtISO: nowISO,
    sourceDigest
  };
  return Object.freeze(body);
}

function staleMenuCostProjection(value, { reason, nowISO }) {
  const current = verifyMenuCostProjection(value, {
    organizationId: value?.organizationId,
    menuItemId: value?.menuItemId
  });
  const body = {
    ...current,
    status: "stale",
    freshness: "stale",
    staleReason: boundedText(reason, "menu cost stale reason", 80),
    updatedAtISO: nowISO
  };
  return Object.freeze(body);
}

function verifyRecipeCostResult(value, { organizationId, menuItemId, recipeRevisionId } = {}) {
  if (!isRecord(value) || typeof value.resultDigest !== "string") {
    throw new inventory.InventoryIngredientError("data-loss", "Inventory menu cost result is unavailable.");
  }
  const { resultDigest, ...body } = value;
  if (resultDigest !== inventory.digest(body, "ingredient recipe cost")
    || value.authorityVersion !== inventory.INVENTORY_AUTHORITY_VERSION
    || value.schemaVersion !== inventory.INVENTORY_SCHEMA_VERSION
    || value.costingVersion !== recipe.RECIPE_COST_VERSION
    || value.organizationId !== organizationId || value.menuItemId !== menuItemId
    || value.recipeRevisionId !== recipeRevisionId
    || !["complete", "partial", "invalid", "unavailable"].includes(value.status)) {
    throw new inventory.InventoryIngredientError("data-loss", "Inventory menu cost result identity or digest is invalid.");
  }
  return value;
}

function verifyMenuCostProjection(value, { organizationId, menuItemId, documentId } = {}) {
  exactKeys(value, [
    "authorityVersion", "schemaVersion", "model", "organizationId", "menuItemId",
    "menuItemName", "menuItemNameSortKey", "observedCatalogRevision", "menuIdentityDigest",
    "recipeRevision", "recipeRevisionId", "recipeDigest", "policyDigest", "recipeDefinition", "status",
    "freshness", "staleReason", "cost", "updatedAtISO", "sourceDigest"
  ], "Inventory menu cost projection");
  const expectedSourceDigest = inventory.digest({
    organizationId: value.organizationId,
    menuItemId: value.menuItemId,
    menuIdentityDigest: value.menuIdentityDigest,
    observedCatalogRevision: value.observedCatalogRevision,
    recipeRevisionId: value.recipeRevisionId,
    recipeDigest: value.recipeDigest,
    policyDigest: value.policyDigest,
    costResultDigest: value.cost?.resultDigest
  }, "inventory menu cost projection sources");
  if (value.authorityVersion !== inventory.INVENTORY_AUTHORITY_VERSION
    || value.schemaVersion !== inventory.INVENTORY_SCHEMA_VERSION
    || value.model !== "inventory-menu-cost-projection-v2"
    || value.organizationId !== organizationId || value.menuItemId !== menuItemId
    || (documentId && documentId !== menuItemId)
    || value.sourceDigest !== expectedSourceDigest) {
    throw new inventory.InventoryIngredientError("data-loss", "Inventory menu cost projection identity or digest is invalid.");
  }
  boundedText(value.menuItemName, "projected menu item name", 120);
  if (value.menuItemNameSortKey !== value.menuItemName.toLocaleLowerCase("en-US")) {
    throw new inventory.InventoryIngredientError("data-loss", "Inventory menu cost projection sort key is invalid.");
  }
  inventory.revision(value.observedCatalogRevision, "projected catalog revision");
  inventory.revision(value.recipeRevision, "projected recipe revision", { allowZero: false });
  if (value.recipeRevisionId !== recipe.recipeRevisionIdFor(organizationId, menuItemId, value.recipeRevision)) {
    throw new inventory.InventoryIngredientError("data-loss", "Inventory menu cost recipe revision is invalid.");
  }
  exactKeys(value.recipeDefinition, [
    "revision", "recipeRevisionId", "recipeDigest", "outputYield", "outputUnitId", "lines", "definitionDigest"
  ], "Projected recipe definition");
  const { definitionDigest, ...recipeDefinitionBody } = value.recipeDefinition;
  if (value.recipeDefinition.revision !== value.recipeRevision
    || value.recipeDefinition.recipeRevisionId !== value.recipeRevisionId
    || value.recipeDefinition.recipeDigest !== value.recipeDigest
    || definitionDigest !== inventory.digest(recipeDefinitionBody, "projected recipe definition")
    || !Array.isArray(value.recipeDefinition.lines)
    || value.recipeDefinition.lines.length > MAX_PUBLISHED_RECIPE_LINES) {
    throw new inventory.InventoryIngredientError("data-loss", "Projected recipe definition provenance is invalid.");
  }
  inventory.exactISO(value.updatedAtISO, "menu cost projection updatedAtISO");
  verifyRecipeCostResult(value.cost, { organizationId, menuItemId, recipeRevisionId: value.recipeRevisionId });
  if (!["current", "stale"].includes(value.freshness)
    || (value.freshness === "current" && (value.staleReason || value.status !== value.cost.status))
    || (value.freshness === "stale" && (!value.staleReason || value.status !== "stale"))) {
    throw new inventory.InventoryIngredientError("data-loss", "Inventory menu cost freshness is invalid.");
  }
  return value;
}

function exactOpaqueList(value, label) {
  if (!Array.isArray(value) || value.length === 0 || value.length > eventDemand.MAX_EVENT_SELECTIONS) {
    throw new inventory.InventoryIngredientError("failed-precondition", `${label} must be a bounded non-empty list.`);
  }
  const normalized = value.map((entry) => inventory.opaqueId(entry, label)).sort();
  if (new Set(normalized).size !== normalized.length) {
    throw new inventory.InventoryIngredientError("failed-precondition", `${label} contains duplicate identities.`);
  }
  return normalized;
}

function validateQuoteDemandScope({ organizationId, quoteId, quoteRevisionId, quote, version, selections }) {
  if (!isRecord(quote) || !isRecord(version) || !isRecord(version.snapshot)) {
    throw new inventory.InventoryIngredientError("failed-precondition", "The exact immutable quote revision is unavailable.");
  }
  if (inventory.opaqueId(quote.organizationId, "quote organizationId") !== organizationId
    || inventory.opaqueId(version.organizationId, "quote version organizationId") !== organizationId
    || inventory.opaqueId(version.quoteId, "quote version quoteId") !== quoteId
    || inventory.opaqueId(version.versionId, "quote versionId") !== quoteRevisionId
    || version.legacySynthetic === true) {
    throw new inventory.InventoryIngredientError("failed-precondition", "The immutable quote revision does not match the event ingredient scope.");
  }
  const activeRevisionId = inventory.opaqueId(
    quote.activeVersionId || quote.versionMeta?.versionId,
    "active quote revisionId"
  );
  if (activeRevisionId !== quoteRevisionId) {
    throw new inventory.InventoryIngredientError("aborted", "The quote revision changed. Preview or compile from the current saved revision.");
  }
  const snapshot = version.snapshot;
  if ((snapshot.organizationId && snapshot.organizationId !== organizationId)
    || (snapshot.id && snapshot.id !== quoteId)
    || (snapshot.activeVersionId && snapshot.activeVersionId !== quoteRevisionId)
    || !isRecord(snapshot.selection)) {
    throw new inventory.InventoryIngredientError("data-loss", "The immutable quote snapshot identity or selection evidence is inconsistent.");
  }
  const selectedIds = exactOpaqueList(snapshot.selection.menuItems, "quote menu item selection");
  const snapshotIds = exactOpaqueList(
    snapshot.selection.menuItemsSnapshot?.map((entry) => entry?.id),
    "quote menu item snapshot"
  );
  if (inventory.canonicalSerialize(selectedIds) !== inventory.canonicalSerialize(snapshotIds)) {
    throw new inventory.InventoryIngredientError("data-loss", "The immutable quote menu identities disagree with their commercial snapshots.");
  }
  const requestedIds = selections.map(({ menuItemId }) => menuItemId).sort();
  if (inventory.canonicalSerialize(selectedIds) !== inventory.canonicalSerialize(requestedIds)) {
    throw new inventory.InventoryIngredientError(
      "failed-precondition",
      "Event ingredient demand must account for every selected menu item exactly once."
    );
  }
  const packageId = snapshot.selection.packageId
    ? inventory.opaqueId(snapshot.selection.packageId, "quote packageId") : "";
  const includedIds = new Set((snapshot.selection.packageInclusions?.menuItems || [])
    .map((entry) => inventory.opaqueId(entry?.id, "package included menuItemId")));
  for (const selection of selections) {
    if (selection.portionBasis.kind !== "explicit_output_quantity"
      || selection.portionBasis.evidenceId !== selection.menuItemId) {
      throw new inventory.InventoryIngredientError(
        "failed-precondition",
        "Phase 4 event demand accepts only an explicit operator-entered output quantity bound to the selected menu item."
      );
    }
    const provenance = selection.commercialProvenance;
    if (provenance.sourceId !== selection.menuItemId) {
      throw new inventory.InventoryIngredientError("failed-precondition", "Menu demand provenance must name its exact selected menu item.");
    }
    if (provenance.kind === "package_inclusion"
      && (provenance.packageId !== packageId
        || provenance.inclusionId !== selection.menuItemId
        || !includedIds.has(selection.menuItemId))) {
      throw new inventory.InventoryIngredientError("failed-precondition", "Package-inclusion provenance is not present in the immutable quote revision.");
    }
    if (provenance.kind === "direct" && includedIds.has(selection.menuItemId)) {
      throw new inventory.InventoryIngredientError("failed-precondition", "Package-included menu demand must retain its package provenance.");
    }
  }
  return Object.freeze({ selectedMenuItemIds: Object.freeze(selectedIds) });
}

function eventRequirementHead({ organizationId, quoteId, current, compiled, nowISO }) {
  const priorRevision = current?.revision || 0;
  const unchanged = current?.eventRequirementRevisionId === compiled.eventRequirementRevisionId
    && current?.requirementDigest === compiled.requirementDigest
    && current?.quoteRevisionId === compiled.quoteRevisionId;
  return Object.freeze({
    authorityVersion: inventory.INVENTORY_AUTHORITY_VERSION,
    schemaVersion: inventory.INVENTORY_SCHEMA_VERSION,
    model: "event-ingredient-requirement-head-v1",
    organizationId,
    quoteId,
    quoteRevisionId: compiled.quoteRevisionId,
    revision: unchanged ? priorRevision : priorRevision + 1,
    eventRequirementRevisionId: compiled.eventRequirementRevisionId,
    requirementDigest: compiled.requirementDigest,
    updatedAtISO: nowISO
  });
}

function verifyEventRequirementHead(value, { organizationId, quoteId, documentId } = {}) {
  exactKeys(value, [
    "authorityVersion", "schemaVersion", "model", "organizationId", "quoteId", "quoteRevisionId",
    "revision", "eventRequirementRevisionId", "requirementDigest", "updatedAtISO"
  ], "Event ingredient requirement head");
  if (value.authorityVersion !== inventory.INVENTORY_AUTHORITY_VERSION
    || value.schemaVersion !== inventory.INVENTORY_SCHEMA_VERSION
    || value.model !== "event-ingredient-requirement-head-v1"
    || value.organizationId !== organizationId || value.quoteId !== quoteId
    || (documentId && documentId !== quoteId)
    || !/^eir_[a-f0-9]{48}$/u.test(value.eventRequirementRevisionId)
    || !/^[a-f0-9]{64}$/u.test(value.requirementDigest)) {
    throw new inventory.InventoryIngredientError("data-loss", "Event ingredient requirement head identity is invalid.");
  }
  inventory.opaqueId(value.quoteRevisionId, "event requirement quoteRevisionId");
  inventory.revision(value.revision, "event requirement revision", { allowZero: false });
  inventory.exactISO(value.updatedAtISO, "event requirement head updatedAtISO");
  return value;
}

function persistedEventProjection({ projection, requirementRevision, ingredientLabels, nowISO }) {
  const value = Object.freeze({
    ...projection,
    model: "event-ingredient-projection-v1",
    requirementRevision,
    ingredientLabels: Object.freeze(ingredientLabels),
    freshness: "as_recorded",
    staleReason: "",
    updatedAtISO: nowISO
  });
  eventDemand.assertFirestoreDocumentSize(value, "persisted event ingredient projection");
  return value;
}

function eventRequirementRecord({ requirement, actor, nowISO }) {
  eventDemand.verifyEventIngredientRequirement(requirement);
  return Object.freeze({
    authorityVersion: inventory.INVENTORY_AUTHORITY_VERSION,
    schemaVersion: inventory.INVENTORY_SCHEMA_VERSION,
    model: "event-ingredient-requirement-record-v1",
    organizationId: requirement.organizationId,
    quoteId: requirement.quoteId,
    eventRequirementRevisionId: requirement.eventRequirementRevisionId,
    requirementDigest: requirement.requirementDigest,
    requirement,
    recordedAtISO: nowISO,
    recordedBy: actor
  });
}

function verifyEventRequirementRecord(value, {
  organizationId, quoteId, eventRequirementRevisionId, documentId
} = {}) {
  exactKeys(value, [
    "authorityVersion", "schemaVersion", "model", "organizationId", "quoteId",
    "eventRequirementRevisionId", "requirementDigest", "requirement", "recordedAtISO", "recordedBy"
  ], "Event ingredient requirement record");
  if (value.authorityVersion !== inventory.INVENTORY_AUTHORITY_VERSION
    || value.schemaVersion !== inventory.INVENTORY_SCHEMA_VERSION
    || value.model !== "event-ingredient-requirement-record-v1"
    || value.organizationId !== organizationId || value.quoteId !== quoteId
    || value.eventRequirementRevisionId !== eventRequirementRevisionId
    || (documentId && documentId !== eventRequirementRevisionId)) {
    throw new inventory.InventoryIngredientError("data-loss", "Event ingredient requirement record identity is invalid.");
  }
  eventDemand.verifyEventIngredientRequirement(value.requirement);
  if (value.requirement.organizationId !== organizationId
    || value.requirement.quoteId !== quoteId
    || value.requirement.eventRequirementRevisionId !== eventRequirementRevisionId
    || value.requirement.requirementDigest !== value.requirementDigest) {
    throw new inventory.InventoryIngredientError("data-loss", "Event ingredient requirement record provenance is invalid.");
  }
  inventory.exactISO(value.recordedAtISO, "event requirement recordedAtISO");
  inventory.normalizeActor(value.recordedBy, organizationId);
  return value;
}

function verifyPersistedEventProjection(value, { organizationId, quoteId, documentId } = {}) {
  if (!isRecord(value)) {
    throw new inventory.InventoryIngredientError("data-loss", "Event ingredient projection is unavailable.");
  }
  const {
    model, requirementRevision, ingredientLabels, freshness, staleReason, updatedAtISO, ...coreProjection
  } = value;
  if (model !== "event-ingredient-projection-v1"
    || value.organizationId !== organizationId || value.quoteId !== quoteId
    || (documentId && documentId !== quoteId)
    || !["as_recorded", "stale"].includes(freshness)
    || typeof staleReason !== "string"
    || (freshness === "as_recorded" && staleReason)
    || (freshness === "stale" && !staleReason)) {
    throw new inventory.InventoryIngredientError("data-loss", "Event ingredient projection metadata is invalid.");
  }
  inventory.revision(requirementRevision, "event projection requirement revision", { allowZero: false });
  inventory.exactISO(updatedAtISO, "event projection updatedAtISO");
  if (!Array.isArray(ingredientLabels)
    || ingredientLabels.length > eventDemand.MAX_EVENT_INGREDIENTS
    || ingredientLabels.some((entry) => !isRecord(entry)
      || Object.keys(entry).length !== 2
      || typeof entry.ingredientId !== "string"
      || typeof entry.name !== "string")) {
    throw new inventory.InventoryIngredientError("data-loss", "Event ingredient projection labels are invalid.");
  }
  ingredientLabels.forEach((entry) => {
    inventory.opaqueId(entry.ingredientId, "event projection label ingredientId");
    boundedText(entry.name, "event projection ingredient name", 100);
  });
  if (new Set(ingredientLabels.map(({ ingredientId }) => ingredientId)).size !== ingredientLabels.length
    || ingredientLabels.some((entry, index) => index > 0
      && ingredientLabels[index - 1].ingredientId.localeCompare(entry.ingredientId) >= 0)) {
    throw new inventory.InventoryIngredientError("data-loss", "Event ingredient projection labels are not unique and sorted.");
  }
  try {
    eventDemand.verifyEventIngredientProjection(coreProjection);
  } catch (error) {
    if (error instanceof eventDemand.InventoryEventDemandError) {
      throw new inventory.InventoryIngredientError("data-loss", error.message);
    }
    throw error;
  }
  const projectedIds = coreProjection.ingredients.map(({ ingredientId }) => ingredientId);
  if (inventory.canonicalSerialize(projectedIds)
    !== inventory.canonicalSerialize(ingredientLabels.map(({ ingredientId }) => ingredientId))) {
    throw new inventory.InventoryIngredientError("data-loss", "Event ingredient projection labels do not cover its ingredient rows.");
  }
  return value;
}

function publicReceipt(receipt) {
  return Object.freeze({
    schemaVersion: inventory.INVENTORY_SCHEMA_VERSION,
    organizationId: receipt.organizationId,
    receiptId: receipt.receiptId,
    requestId: receipt.requestId,
    commandKind: receipt.commandKind,
    recordedAtISO: receipt.recordedAtISO
  });
}

function publicOutcome(receipt, idempotent) {
  return Object.freeze({
    ok: true,
    schemaVersion: inventory.INVENTORY_SCHEMA_VERSION,
    organizationId: receipt.organizationId,
    commandKind: receipt.commandKind,
    idempotent,
    receipt: publicReceipt(receipt),
    result: receipt.result
  });
}

function verifyConfigurationState(value, organizationId) {
  exactKeys(value, [
    "authorityVersion", "schemaVersion", "model", "organizationId", "stateId",
    "locationCount", "ingredientCount", "revision", "updatedAtISO"
  ], "Ingredient inventory configuration state");
  if (value.authorityVersion !== inventory.INVENTORY_AUTHORITY_VERSION
    || value.schemaVersion !== inventory.INVENTORY_SCHEMA_VERSION
    || value.model !== "inventory-configuration-state-v2"
    || value.organizationId !== organizationId || value.stateId !== "ingredient-v2"
    || !Number.isSafeInteger(value.locationCount) || value.locationCount < 0 || value.locationCount > WORKSPACE_LIMIT
    || !Number.isSafeInteger(value.ingredientCount) || value.ingredientCount < 0 || value.ingredientCount > WORKSPACE_LIMIT) {
    throw new inventory.InventoryIngredientError("data-loss", "Ingredient inventory configuration state is invalid.");
  }
  inventory.revision(value.revision, "configuration revision", { allowZero: false });
  if (value.revision !== value.locationCount + value.ingredientCount) {
    throw new inventory.InventoryIngredientError("data-loss", "Ingredient inventory configuration revision is inconsistent.");
  }
  inventory.exactISO(value.updatedAtISO, "configuration updatedAtISO");
  return value;
}

function advanceConfigurationState({ current, organizationId, increment, nowISO }) {
  const prior = current || {
    locationCount: 0,
    ingredientCount: 0,
    revision: 0
  };
  const field = increment === "location" ? "locationCount" : "ingredientCount";
  if (prior[field] >= WORKSPACE_LIMIT) {
    throw new inventory.InventoryIngredientError(
      "resource-exhausted",
      `Ingredient inventory currently supports at most ${WORKSPACE_LIMIT} ${increment} records per organization.`
    );
  }
  return Object.freeze({
    authorityVersion: inventory.INVENTORY_AUTHORITY_VERSION,
    schemaVersion: inventory.INVENTORY_SCHEMA_VERSION,
    model: "inventory-configuration-state-v2",
    organizationId,
    stateId: "ingredient-v2",
    locationCount: prior.locationCount + (increment === "location" ? 1 : 0),
    ingredientCount: prior.ingredientCount + (increment === "ingredient" ? 1 : 0),
    revision: prior.revision + 1,
    updatedAtISO: nowISO
  });
}

function verifyWorkspaceProjection(value, organizationId) {
  exactKeys(value, [
    "authorityVersion", "schemaVersion", "model", "organizationId", "projectionId",
    "workspaceRevision", "locations", "updatedAtISO"
  ], "Ingredient inventory workspace projection");
  if (value.authorityVersion !== inventory.INVENTORY_AUTHORITY_VERSION
    || value.schemaVersion !== inventory.INVENTORY_SCHEMA_VERSION
    || value.model !== "inventory-workspace-projection-v2"
    || value.organizationId !== organizationId || value.projectionId !== "current") {
    throw new inventory.InventoryIngredientError("data-loss", "Ingredient inventory workspace projection identity is invalid.");
  }
  inventory.revision(value.workspaceRevision, "workspaceRevision", { allowZero: false });
  inventory.exactISO(value.updatedAtISO, "workspace updatedAtISO");
  if (!Array.isArray(value.locations) || value.locations.length > WORKSPACE_LIMIT) {
    throw new inventory.InventoryIngredientError("data-loss", "Ingredient inventory workspace location projection is invalid.");
  }
  value.locations.forEach((location) => {
    exactKeys(location, ["locationId", "name", "active", "revision"], "Projected inventory location");
    inventory.opaqueId(location.locationId, "projected locationId");
    inventory.revision(location.revision, "projected location revision", { allowZero: false });
    if (typeof location.name !== "string" || typeof location.active !== "boolean") {
      throw new inventory.InventoryIngredientError("data-loss", "Projected inventory location fields are invalid.");
    }
  });
  return value;
}

function verifyIngredientProjection(value, organizationId, ingredientId) {
  exactKeys(value, [
    "authorityVersion", "schemaVersion", "model", "organizationId", "ingredientId", "name",
    "nameSortKey", "category", "baseUnitId", "dimension", "active", "ingredientRevision",
    "stock", "cost", "packConversions", "updatedAtISO"
  ], "Ingredient inventory projection");
  if (value.authorityVersion !== inventory.INVENTORY_AUTHORITY_VERSION
    || value.schemaVersion !== inventory.INVENTORY_SCHEMA_VERSION
    || value.model !== "inventory-ingredient-projection-v2"
    || value.organizationId !== organizationId || value.ingredientId !== ingredientId) {
    throw new inventory.InventoryIngredientError("data-loss", "Ingredient inventory projection identity is invalid.");
  }
  const unit = inventory.baseUnitId(value.baseUnitId);
  inventory.revision(value.ingredientRevision, "projected ingredient revision", { allowZero: false });
  inventory.exactISO(value.updatedAtISO, "ingredient projection updatedAtISO");
  if (typeof value.active !== "boolean" || typeof value.name !== "string"
    || typeof value.nameSortKey !== "string" || typeof value.category !== "string"
    || value.nameSortKey !== value.name.toLocaleLowerCase("en-US")
    || value.dimension !== inventory.BASE_UNITS[unit]) {
    throw new inventory.InventoryIngredientError("data-loss", "Ingredient inventory projection fields are invalid.");
  }
  exactKeys(value.stock, [
    "availability", "stockRevision", "onHandMicros", "quantity", "locationId", "lastMovementId"
  ], "Ingredient stock projection");
  if (!new Set(["current", "not_yet_available"]).has(value.stock.availability)) {
    throw new inventory.InventoryIngredientError("data-loss", "Ingredient stock projection availability is invalid.");
  }
  const stockRevision = inventory.revision(value.stock.stockRevision, "projected stock revision");
  if (inventory.formatQuantityMicros(value.stock.onHandMicros) !== value.stock.quantity
    || (value.stock.availability === "not_yet_available"
      && (stockRevision !== 0 || value.stock.onHandMicros !== 0 || value.stock.locationId || value.stock.lastMovementId))
    || (value.stock.availability === "current"
      && (stockRevision < 1 || !/^imv_[a-f0-9]{48}$/u.test(value.stock.lastMovementId)))) {
    throw new inventory.InventoryIngredientError("data-loss", "Ingredient stock projection quantity is invalid.");
  }
  if (value.stock.availability === "current") inventory.opaqueId(value.stock.locationId, "projected stock locationId");
  const costKeys = ["availability", "costRevision", "sourceLabel", "observedAtISO", "lastCostEvidenceId"];
  if (value.cost.availability === "available") {
    costKeys.push("basisQuantityMicros", "totalCostMinor", "currency");
  }
  exactKeys(value.cost, costKeys, "Ingredient cost projection");
  if (!inventory.COST_AVAILABILITY.includes(value.cost.availability)) {
    throw new inventory.InventoryIngredientError("data-loss", "Ingredient cost projection availability is invalid.");
  }
  const costRevision = inventory.revision(value.cost.costRevision, "projected cost revision");
  if (costRevision === 0 && (value.cost.availability !== "not_yet_available"
    || value.cost.sourceLabel || value.cost.observedAtISO || value.cost.lastCostEvidenceId)) {
    throw new inventory.InventoryIngredientError("data-loss", "Unrecorded ingredient cost projection is invalid.");
  }
  if (costRevision > 0) {
    inventory.exactISO(value.cost.observedAtISO, "projected cost observedAtISO");
    if (typeof value.cost.sourceLabel !== "string" || !value.cost.sourceLabel
      || !/^ice_[a-f0-9]{48}$/u.test(value.cost.lastCostEvidenceId)) {
      throw new inventory.InventoryIngredientError("data-loss", "Ingredient cost projection lacks evidence provenance.");
    }
  }
  if (value.cost.availability === "available") {
    inventory.formatQuantityMicros(value.cost.basisQuantityMicros, "projected basisQuantityMicros");
    if (!Number.isSafeInteger(value.cost.totalCostMinor) || value.cost.totalCostMinor < 0
      || !/^[A-Z]{3}$/u.test(value.cost.currency)) {
      throw new inventory.InventoryIngredientError("data-loss", "Available ingredient cost projection is invalid.");
    }
  }
  if (!Array.isArray(value.packConversions) || value.packConversions.length > recipe.MAX_PACK_CONVERSIONS) {
    throw new inventory.InventoryIngredientError("data-loss", "Ingredient pack conversion projection is invalid.");
  }
  const packSortKeys = value.packConversions.map((entry) => `${entry.packLabel}\u0000${entry.packUnitId}`);
  if (packSortKeys.some((key, index) => index > 0 && packSortKeys[index - 1].localeCompare(key) > 0)
    || new Set(value.packConversions.map((entry) => entry.packUnitId)).size !== value.packConversions.length) {
    throw new inventory.InventoryIngredientError("data-loss", "Ingredient pack conversion projection order is invalid.");
  }
  value.packConversions.forEach((entry) => {
    exactKeys(entry, [
      "packUnitId", "packLabel", "revision", "packConversionRevisionId", "baseUnitId",
      "baseQuantity", "sourceLabel"
    ], "Projected ingredient pack conversion");
    inventory.opaqueId(entry.packUnitId, "projected packUnitId");
    inventory.revision(entry.revision, "projected pack revision", { allowZero: false });
    inventory.baseUnitId(entry.baseUnitId);
    inventory.parseQuantityMicros(entry.baseQuantity, "projected pack base quantity");
    boundedText(entry.packLabel, "projected pack label", 80);
    boundedText(entry.sourceLabel, "projected pack source", 120);
    if (entry.baseUnitId !== value.baseUnitId || entry.packConversionRevisionId !== recipe.packConversionRevisionIdFor(
      organizationId, ingredientId, entry.packUnitId, entry.revision
    )) {
      throw new inventory.InventoryIngredientError("data-loss", "Projected ingredient pack conversion provenance is invalid.");
    }
  });
  return value;
}

function createInventoryAuthorityRuntime({
  db, FieldValue, HttpsError, assertStaff, normalizeOrganizationId,
  isOrganizationRecordActive, globalEnabled, logger = { error() {} },
  now = () => new Date().toISOString()
}) {
  if (!db || !FieldValue || !HttpsError || typeof assertStaff !== "function"
    || typeof normalizeOrganizationId !== "function" || typeof isOrganizationRecordActive !== "function"
    || typeof globalEnabled !== "function" || typeof now !== "function") {
    throw new TypeError("Ingredient inventory authority runtime dependencies are required.");
  }

  function refsFor(organizationId) {
    const organizationRef = db.collection("organizations").doc(organizationId);
    return {
      organizationRef,
      tombstoneRef: db.collection("organizationTombstones").doc(organizationId),
      settingsRef: organizationRef.collection("settings").doc("config"),
      roleRef: (uid) => db.collection("userRoles").doc(uid),
      locations: organizationRef.collection(COLLECTIONS.locations),
      ingredients: organizationRef.collection(COLLECTIONS.ingredients),
      movements: organizationRef.collection(COLLECTIONS.movements),
      stockStates: organizationRef.collection(COLLECTIONS.stockStates),
      costEvidence: organizationRef.collection(COLLECTIONS.costEvidence),
      costStates: organizationRef.collection(COLLECTIONS.costStates),
      configurationStateRef: organizationRef.collection(COLLECTIONS.authorityState).doc("ingredient-v2"),
      receipts: organizationRef.collection(COLLECTIONS.receipts),
      workspaceProjectionRef: organizationRef.collection(COLLECTIONS.workspaceProjections).doc("current"),
      ingredientProjections: organizationRef.collection(COLLECTIONS.ingredientProjections),
      recipePolicies: organizationRef.collection(COLLECTIONS.recipePolicies),
      recipeHeads: organizationRef.collection(COLLECTIONS.recipeHeads),
      recipeDependencies: organizationRef.collection(COLLECTIONS.recipeDependencies),
      packConversionRevisions: organizationRef.collection(COLLECTIONS.packConversionRevisions),
      packConversionHeads: organizationRef.collection(COLLECTIONS.packConversionHeads),
      menuCostProjections: organizationRef.collection(COLLECTIONS.menuCostProjections),
      eventRequirementHeads: organizationRef.collection(COLLECTIONS.eventRequirementHeads),
      eventRequirements: organizationRef.collection(COLLECTIONS.eventRequirements),
      eventProjections: organizationRef.collection(COLLECTIONS.eventProjections),
      menuItems: organizationRef.collection("menuItems"),
      quotes: organizationRef.collection("quotes")
    };
  }

  function actorFor(staff, organizationId) {
    return inventory.normalizeActor({
      uid: staff?.uid,
      email: staff?.email,
      role: String(staff?.role || "").trim().toLowerCase(),
      organizationId: normalizeOrganizationId(staff?.principalOrganizationId || staff?.organizationId)
    }, organizationId);
  }

  function readerFor(staff, organizationId) {
    const principal = Object.freeze({
      uid: inventory.opaqueId(staff?.uid, "reader uid"),
      email: boundedText(staff?.email, "reader email", 254),
      role: boundedText(String(staff?.role || "").trim().toLowerCase(), "reader role", 24),
      organizationId: inventory.opaqueId(
        normalizeOrganizationId(staff?.principalOrganizationId || staff?.organizationId),
        "reader organizationId"
      )
    });
    if (principal.organizationId !== organizationId || !["admin", "sales"].includes(principal.role)) {
      throw new inventory.InventoryIngredientError(
        "permission-denied",
        "Event ingredient previews require same-tenant admin or sales access."
      );
    }
    return principal;
  }

  function assertStoredAuthority({
    organizationId, actor, roleSnap, organizationSnap, tombstoneSnap, settingsSnap,
    allowedRoles = ["admin"]
  }) {
    if (!roleSnap.exists || !organizationSnap.exists || tombstoneSnap.exists || !settingsSnap.exists) {
      throw new inventory.InventoryIngredientError("failed-precondition", "Current ingredient inventory authority is unavailable.");
    }
    const role = roleSnap.data() || {};
    const storedEmail = String(role.email || "").trim().toLowerCase();
    if (normalizeOrganizationId(role.organizationId) !== organizationId
      || !allowedRoles.includes(String(role.role || "").trim().toLowerCase())
      || !allowedRoles.includes(actor.role)
      || (storedEmail && storedEmail !== actor.email.toLowerCase())
      || !isOrganizationRecordActive(organizationSnap.data() || {})) {
      throw new inventory.InventoryIngredientError("permission-denied", "Ingredient inventory authority changed. Refresh access before continuing.");
    }
    if (globalEnabled(organizationId) !== true || settingsSnap.data()?.inventoryAuthorityEnabled !== true) {
      throw new inventory.InventoryIngredientError("failed-precondition", "Ingredient inventory authority is not enabled for this environment and organization.");
    }
  }

  async function readAuthorityEnvelope(tx, refs, actor, { allowedRoles = ["admin"] } = {}) {
    const [roleSnap, organizationSnap, tombstoneSnap, settingsSnap] = await tx.getAll(
      refs.roleRef(actor.uid), refs.organizationRef, refs.tombstoneRef, refs.settingsRef
    );
    assertStoredAuthority({
      organizationId: actor.organizationId, actor, roleSnap, organizationSnap, tombstoneSnap, settingsSnap,
      allowedRoles
    });
    return { roleSnap, organizationSnap, tombstoneSnap, settingsSnap };
  }

  function storedCanonical(value, kind, identity) {
    if (kind === "location") inventory.verifyLocation(value, {
      ...identity,
      locationId: identity.locationId || value?.locationId
    });
    else if (kind === "ingredient") inventory.verifyIngredient(value, {
      ...identity,
      ingredientId: identity.ingredientId || value?.ingredientId
    });
    else if (kind === "stock state") inventory.verifyStockState(value, {
      ...identity,
      locationId: identity.locationId || value?.locationId
    });
    else if (kind === "cost state") inventory.verifyCostState(value, identity);
    else throw new inventory.InventoryIngredientError("data-loss", "Stored ingredient inventory kind is unsupported.");
    const storedDocumentId = kind === "location" ? value.locationId
      : kind === "ingredient" ? value.ingredientId
        : kind === "stock state" ? value.stockStateId : value.costStateId;
    if (identity.documentId && identity.documentId !== storedDocumentId) {
      throw new inventory.InventoryIngredientError("data-loss", `Stored ingredient inventory ${kind} is filed under the wrong document identity.`);
    }
    return value;
  }

  function verifyReceipt(wrapper, claim) {
    const receipt = wrapper?.receipt;
    if (!isRecord(receipt)) {
      throw new inventory.InventoryIngredientError("data-loss", "Ingredient inventory receipt is unavailable.");
    }
    const { receiptDigest, ...body } = receipt;
    if (receiptDigest !== inventory.digest(body, "ingredient inventory receipt")) {
      throw new inventory.InventoryIngredientError("data-loss", "Ingredient inventory receipt failed integrity validation.");
    }
    if (receipt.authorityVersion !== inventory.INVENTORY_AUTHORITY_VERSION
      || receipt.schemaVersion !== inventory.INVENTORY_SCHEMA_VERSION
      || receipt.organizationId !== claim.organizationId || receipt.receiptId !== claim.receiptId
      || receipt.requestId !== claim.requestId) {
      throw new inventory.InventoryIngredientError("data-loss", "Ingredient inventory receipt identity is invalid.");
    }
    if (receipt.commandKind !== claim.commandKind || receipt.commandDigest !== claim.commandDigest) {
      throw new inventory.InventoryIngredientError("already-exists", "This request identity belongs to a different immutable ingredient inventory command.");
    }
    return receipt;
  }

  async function readIngredientInputs(tx, refs, organizationId, ingredientId) {
    const ingredientRef = refs.ingredients.doc(ingredientId);
    const costRef = refs.costStates.doc(inventory.costStateId(ingredientId));
    const stockQuery = refs.stockStates.where("ingredientId", "==", ingredientId).limit(WORKSPACE_LIMIT + 1);
    const packHeadQuery = refs.packConversionHeads.where("ingredientId", "==", ingredientId)
      .limit(recipe.MAX_PACK_CONVERSIONS + 1);
    const [ingredientSnap, costSnap, stockSnap, packHeadSnap] = await Promise.all([
      tx.get(ingredientRef), tx.get(costRef), tx.get(stockQuery), tx.get(packHeadQuery)
    ]);
    const ingredient = ingredientSnap.exists
      ? storedCanonical(ingredientSnap.data() || {}, "ingredient", {
        organizationId, ingredientId, documentId: ingredientSnap.id
      }) : null;
    if (stockSnap.size > WORKSPACE_LIMIT || packHeadSnap.size > recipe.MAX_PACK_CONVERSIONS) {
      throw new inventory.InventoryIngredientError("resource-exhausted", "Ingredient evidence exceeds its bounded projection limit.");
    }
    const stockStates = stockSnap.docs.map((doc) => storedCanonical(doc.data() || {}, "stock state", {
      organizationId, ingredientId, documentId: doc.id
    }));
    const costState = costSnap.exists
      ? storedCanonical(costSnap.data() || {}, "cost state", {
        organizationId, ingredientId, documentId: costSnap.id
      }) : null;
    const packConversionHeads = packHeadSnap.docs.map((doc) => verifyPackHead(doc.data() || {}, {
      organizationId, ingredientId, documentId: doc.id
    }));
    if (!ingredient && (stockStates.length || costState)) {
      throw new inventory.InventoryIngredientError("data-loss", "Ingredient evidence exists without its ingredient authority.");
    }
    if (ingredient && (stockStates.some((state) => state.baseUnitId !== ingredient.baseUnitId)
      || (costState && costState.baseUnitId !== ingredient.baseUnitId)
      || packConversionHeads.some((head) => head.baseUnitId !== ingredient.baseUnitId))) {
      throw new inventory.InventoryIngredientError("data-loss", "Ingredient evidence base units do not match the ingredient authority.");
    }
    if (!ingredient && packConversionHeads.length) {
      throw new inventory.InventoryIngredientError("data-loss", "Ingredient pack conversions exist without their ingredient authority.");
    }
    return { ingredientRef, costRef, ingredient, costState, stockStates, packConversionHeads };
  }

  async function readDependencyImpact(tx, refs, organizationId, ingredientId, nowISO, reason) {
    const dependencyRef = refs.recipeDependencies.doc(ingredientId);
    const dependencySnap = await tx.get(dependencyRef);
    if (!dependencySnap.exists) return { dependency: null, affectedMenuItemIds: [], writes: [] };
    const dependency = verifyRecipeDependency(dependencySnap.data() || {}, {
      organizationId, ingredientId, documentId: dependencySnap.id
    });
    const projectionRefs = dependency.menuItemIds.map((menuItemId) => refs.menuCostProjections.doc(menuItemId));
    const projectionSnaps = projectionRefs.length ? await tx.getAll(...projectionRefs) : [];
    const writes = [];
    projectionSnaps.forEach((snapshot, index) => {
      if (!snapshot.exists) return;
      const menuItemId = dependency.menuItemIds[index];
      const current = verifyMenuCostProjection(snapshot.data() || {}, {
        organizationId, menuItemId, documentId: snapshot.id
      });
      writes.push({
        operation: "set",
        ref: projectionRefs[index],
        value: staleMenuCostProjection(current, { reason, nowISO })
      });
    });
    return { dependency, affectedMenuItemIds: dependency.menuItemIds, writes };
  }

  async function readRecipeCostInputs(tx, refs, policy) {
    const ingredientIds = [...new Set(policy.recipeRevision.lines.map((line) => line.ingredientId))].sort();
    const packRevisionIds = [...new Set(policy.recipeRevision.lines
      .filter((line) => line.unitKind === "ingredient_pack")
      .map((line) => line.packConversionRevisionId))].sort();
    const ingredientRefs = ingredientIds.map((ingredientId) => refs.ingredients.doc(ingredientId));
    const costRefs = ingredientIds.map((ingredientId) => refs.costStates.doc(inventory.costStateId(ingredientId)));
    const packRefs = packRevisionIds.map((revisionId) => refs.packConversionRevisions.doc(revisionId));
    const snapshots = ingredientRefs.length || costRefs.length || packRefs.length
      ? await tx.getAll(...ingredientRefs, ...costRefs, ...packRefs) : [];
    const ingredientSnaps = snapshots.slice(0, ingredientRefs.length);
    const costSnaps = snapshots.slice(ingredientRefs.length, ingredientRefs.length + costRefs.length);
    const packSnaps = snapshots.slice(ingredientRefs.length + costRefs.length);
    const ingredients = ingredientSnaps.flatMap((snapshot, index) => snapshot.exists ? [storedCanonical(
      snapshot.data() || {}, "ingredient", {
        organizationId: policy.organizationId,
        ingredientId: ingredientIds[index],
        documentId: snapshot.id
      }
    )] : []);
    const costStates = costSnaps.flatMap((snapshot, index) => snapshot.exists ? [storedCanonical(
      snapshot.data() || {}, "cost state", {
        organizationId: policy.organizationId,
        ingredientId: ingredientIds[index],
        documentId: snapshot.id
      }
    )] : []);
    const packConversions = packSnaps.flatMap((snapshot, index) => {
      if (!snapshot.exists) return [];
      const value = snapshot.data() || {};
      try {
        recipe.verifyPackConversionRevision(value);
      } catch (error) {
        if (error instanceof recipe.InventoryRecipeError) {
          throw new inventory.InventoryIngredientError("data-loss", error.message);
        }
        throw error;
      }
      if (value.organizationId !== policy.organizationId || value.packConversionRevisionId !== packRevisionIds[index]
        || snapshot.id !== packRevisionIds[index]) {
        throw new inventory.InventoryIngredientError("data-loss", "Ingredient pack conversion revision is misfiled.");
      }
      return [value];
    });
    return { ingredients, costStates, packConversions };
  }

  async function readEventDemandInputs(tx, refs, envelope, settings) {
    const quoteRef = refs.quotes.doc(envelope.quoteId);
    const versionRef = quoteRef.collection("versions").doc(envelope.quoteRevisionId);
    const selectionMenuItemIds = envelope.selections.map(({ menuItemId }) => menuItemId);
    const recipeHeadRefs = selectionMenuItemIds.map((menuItemId) => refs.recipeHeads.doc(menuItemId));
    const [quoteSnap, versionSnap, ...recipeHeadSnaps] = await tx.getAll(
      quoteRef,
      versionRef,
      ...recipeHeadRefs
    );
    if (!quoteSnap.exists || !versionSnap.exists) {
      throw new inventory.InventoryIngredientError("not-found", "The exact immutable quote revision is unavailable.");
    }
    validateQuoteDemandScope({
      organizationId: envelope.organizationId,
      quoteId: envelope.quoteId,
      quoteRevisionId: envelope.quoteRevisionId,
      quote: quoteSnap.data() || {},
      version: versionSnap.data() || {},
      selections: envelope.selections
    });
    let canonicalRequiredByISO;
    try {
      canonicalRequiredByISO = wallTimeToExactISO({
        date: versionSnap.data()?.snapshot?.event?.date,
        time: versionSnap.data()?.snapshot?.event?.time,
        timeZone: settings?.businessTimeZone
      });
    } catch (error) {
      throw new inventory.InventoryIngredientError(
        error?.code || "failed-precondition",
        error?.message || "The immutable quote event time cannot establish ingredient demand."
      );
    }

    const heads = recipeHeadSnaps.map((snapshot, index) => snapshot.exists
      ? verifyRecipeHead(snapshot.data() || {}, {
        organizationId: envelope.organizationId,
        menuItemId: selectionMenuItemIds[index],
        documentId: snapshot.id
      })
      : null);
    heads.forEach((head, index) => {
      const selectedRecipeRevisionId = envelope.selections[index].recipeRevisionId;
      if ((!head && selectedRecipeRevisionId !== null)
        || (head && selectedRecipeRevisionId !== head.recipeRevisionId)) {
        throw new inventory.InventoryIngredientError(
          "aborted",
          "A selected menu recipe changed. Refresh the saved quote before evaluating ingredient demand."
        );
      }
    });

    const policyRefs = heads.filter(Boolean).map((head) => refs.recipePolicies.doc(head.recipeRevisionId));
    const policySnaps = policyRefs.length ? await tx.getAll(...policyRefs) : [];
    const policies = policySnaps.map((snapshot, index) => {
      const head = heads.filter(Boolean)[index];
      if (!snapshot.exists) {
        throw new inventory.InventoryIngredientError("data-loss", "A current menu recipe is missing its immutable policy.");
      }
      const policy = verifyRecipePolicy(snapshot.data() || {}, {
        organizationId: envelope.organizationId,
        recipeRevisionId: head.recipeRevisionId,
        documentId: snapshot.id
      });
      if (policy.recipeRevision.recipeDigest !== head.recipeDigest
        || policy.catalogRevision !== head.catalogRevision
        || policy.menuIdentity.identityDigest !== head.menuIdentity.identityDigest) {
        throw new inventory.InventoryIngredientError("data-loss", "A current menu recipe head disagrees with its immutable policy.");
      }
      return policy;
    });

    const recipeRevisions = [];
    const recipeCostResults = [];
    const ingredientsById = new Map();
    for (const policy of policies) {
      const costInputs = await readRecipeCostInputs(tx, refs, policy);
      costInputs.ingredients.forEach((ingredient) => ingredientsById.set(ingredient.ingredientId, ingredient));
      recipeRevisions.push(policy.recipeRevision);
      recipeCostResults.push(recipe.calculateRecipeCost({
        recipeRevision: policy.recipeRevision,
        ingredients: costInputs.ingredients,
        costStates: costInputs.costStates,
        packConversions: costInputs.packConversions
      }));
    }

    const normalizedIngredientIds = [...new Set(recipeCostResults.flatMap((result) =>
      result.ingredients.map(({ ingredientId }) => ingredientId)))].sort();
    if (normalizedIngredientIds.length > eventDemand.MAX_EVENT_INGREDIENTS) {
      throw new inventory.InventoryIngredientError("resource-exhausted", "Event ingredient demand exceeds its bounded ingredient limit.");
    }
    const stockQueries = normalizedIngredientIds.map((ingredientId) =>
      refs.stockStates.where("ingredientId", "==", ingredientId).limit(WORKSPACE_LIMIT + 1));
    const stockSnapshots = await Promise.all(stockQueries.map((query) => tx.get(query)));
    const stockStates = stockSnapshots.flatMap((snapshot, index) => {
      if (snapshot.size > WORKSPACE_LIMIT) {
        throw new inventory.InventoryIngredientError("resource-exhausted", "Ingredient stock states exceed the bounded event-demand limit.");
      }
      return snapshot.docs.map((doc) => storedCanonical(doc.data() || {}, "stock state", {
        organizationId: envelope.organizationId,
        ingredientId: normalizedIngredientIds[index],
        documentId: doc.id
      }));
    });
    const ingredientLabels = [...ingredientsById.values()]
      .filter((ingredient) => normalizedIngredientIds.includes(ingredient.ingredientId))
      .map((ingredient) => ({ ingredientId: ingredient.ingredientId, name: ingredient.name }))
      .sort((left, right) => left.ingredientId.localeCompare(right.ingredientId));
    return {
      quote: quoteSnap.data() || {},
      version: versionSnap.data() || {},
      recipeRevisions,
      recipeCostResults,
      stockStates,
      ingredientLabels,
      canonicalRequiredByISO
    };
  }

  async function compileCurrentEventDemand(tx, refs, envelope, settings) {
    const inputs = await readEventDemandInputs(tx, refs, envelope, settings);
    try {
      const compiled = eventDemand.compileEventIngredientDemand({
        organizationId: envelope.organizationId,
        quoteId: envelope.quoteId,
        quoteRevisionId: envelope.quoteRevisionId,
        requiredByISO: inputs.canonicalRequiredByISO,
        selections: envelope.selections,
        recipeRevisions: inputs.recipeRevisions,
        recipeCostResults: inputs.recipeCostResults,
        stockStates: inputs.stockStates,
        activeAllocations: []
      });
      return { ...compiled, ingredientLabels: inputs.ingredientLabels };
    } catch (error) {
      if (error instanceof eventDemand.InventoryEventDemandError) {
        throw new inventory.InventoryIngredientError(error.code, error.message);
      }
      throw error;
    }
  }

  async function calculateCurrentMenuProjection(tx, refs, { organizationId, menuItemId, nowISO }) {
    const headRef = refs.recipeHeads.doc(menuItemId);
    const projectionRef = refs.menuCostProjections.doc(menuItemId);
    const [headSnap, currentProjectionSnap] = await Promise.all([tx.get(headRef), tx.get(projectionRef)]);
    if (!headSnap.exists) {
      throw new inventory.InventoryIngredientError("data-loss", "Recipe dependency points to a missing current recipe head.");
    }
    const head = verifyRecipeHead(headSnap.data() || {}, { organizationId, menuItemId, documentId: headSnap.id });
    const policyRef = refs.recipePolicies.doc(head.recipeRevisionId);
    const policySnap = await tx.get(policyRef);
    if (!policySnap.exists) {
      throw new inventory.InventoryIngredientError("data-loss", "Current recipe head points to a missing immutable policy.");
    }
    const policy = verifyRecipePolicy(policySnap.data() || {}, {
      organizationId, recipeRevisionId: head.recipeRevisionId, documentId: policySnap.id
    });
    if (policy.recipeRevision.recipeDigest !== head.recipeDigest || policy.catalogRevision !== head.catalogRevision
      || policy.menuIdentity.identityDigest !== head.menuIdentity.identityDigest) {
      throw new inventory.InventoryIngredientError("data-loss", "Current recipe head and immutable policy disagree.");
    }
    const inputs = await readRecipeCostInputs(tx, refs, policy);
    const cost = recipe.calculateRecipeCost({
      recipeRevision: policy.recipeRevision,
      ingredients: inputs.ingredients,
      costStates: inputs.costStates,
      packConversions: inputs.packConversions
    });
    const projection = menuCostProjection({ head, policy, cost, nowISO });
    if (currentProjectionSnap.exists) verifyMenuCostProjection(currentProjectionSnap.data() || {}, {
      organizationId, menuItemId, documentId: currentProjectionSnap.id
    });
    return { head, policy, cost, projection, projectionRef, currentProjectionSnap };
  }

  async function refreshMenuCostProjection(refs, actor, menuItemId) {
    return db.runTransaction(async (tx) => {
      await readAuthorityEnvelope(tx, refs, actor);
      const nowISO = inventory.exactISO(now(), "menu projection refreshedAtISO");
      const calculated = await calculateCurrentMenuProjection(tx, refs, {
        organizationId: actor.organizationId, menuItemId, nowISO
      });
      const current = calculated.currentProjectionSnap.exists
        ? calculated.currentProjectionSnap.data() || {} : null;
      if (current?.freshness === "current" && current?.sourceDigest === calculated.projection.sourceDigest) {
        return calculated.projection;
      }
      tx.set(calculated.projectionRef, calculated.projection);
      return calculated.projection;
    });
  }

  async function refreshAffectedMenuCosts(refs, actor, menuItemIds) {
    for (const menuItemId of menuItemIds) {
      await refreshMenuCostProjection(refs, actor, menuItemId);
    }
  }

  function commandResult(commandKind, planned) {
    if (commandKind === "upsert_location") return safeLocation(planned.location);
    if (commandKind === "upsert_ingredient") return Object.freeze({
      schemaVersion: inventory.INVENTORY_SCHEMA_VERSION,
      ingredientId: planned.ingredient.ingredientId,
      revision: planned.ingredient.revision,
      baseUnitId: planned.ingredient.baseUnitId,
      active: planned.ingredient.active,
      affectedMenuItemIds: Object.freeze(planned.affectedMenuItemIds || [])
    });
    if (commandKind === "opening_balance") return Object.freeze({
      schemaVersion: inventory.INVENTORY_SCHEMA_VERSION,
      ingredientId: planned.movement.ingredientId,
      locationId: planned.movement.locationId,
      movementId: planned.movement.movementId,
      stockRevision: planned.nextStockState.revision,
      onHandMicros: planned.nextStockState.onHandMicros,
      onHandQuantity: inventory.formatQuantityMicros(planned.nextStockState.onHandMicros)
    });
    if (commandKind === "publish_pack_conversion") return Object.freeze({
      schemaVersion: inventory.INVENTORY_SCHEMA_VERSION,
      ingredientId: planned.packConversion.ingredientId,
      packUnitId: planned.packConversion.packUnitId,
      packConversionRevisionId: planned.packConversion.packConversionRevisionId,
      revision: planned.packConversion.revision,
      affectedMenuItemIds: Object.freeze(planned.affectedMenuItemIds || [])
    });
    if (commandKind === "publish_menu_recipe") return Object.freeze({
      schemaVersion: inventory.INVENTORY_SCHEMA_VERSION,
      menuItemId: planned.recipeRevision.menuItemId,
      recipeRevisionId: planned.recipeRevision.recipeRevisionId,
      recipeRevision: planned.recipeRevision.revision,
      projectionSourceDigest: planned.menuCostProjection.sourceDigest,
      status: planned.menuCostProjection.status
    });
    if (commandKind === "compile_event_ingredient_demand") return Object.freeze({
      schemaVersion: inventory.INVENTORY_SCHEMA_VERSION,
      quoteId: planned.requirementRevision.quoteId,
      quoteRevisionId: planned.requirementRevision.quoteRevisionId,
      requirementRevision: planned.head.revision,
      eventRequirementRevisionId: planned.requirementRevision.eventRequirementRevisionId,
      requirementDigest: planned.requirementRevision.requirementDigest,
      projectionDigest: planned.projection.projectionDigest,
      demandState: planned.projection.demandState,
      costState: planned.projection.costState,
      availabilityState: planned.projection.availabilityState
    });
    return Object.freeze({
      schemaVersion: inventory.INVENTORY_SCHEMA_VERSION,
      ingredientId: planned.costEvidence.ingredientId,
      costEvidenceId: planned.costEvidence.costEvidenceId,
      costRevision: planned.nextCostState.revision,
      availability: planned.nextCostState.availability,
      affectedMenuItemIds: Object.freeze(planned.affectedMenuItemIds || [])
    });
  }

  async function applyInventoryCommand(data = {}, context = {}) {
    try {
      const envelope = normalizeApplyEnvelope(data);
      const staff = await assertStaff(context, { expectedOrganizationId: envelope.organizationId });
      const actor = actorFor(staff, envelope.organizationId);
      const refs = refsFor(envelope.organizationId);
      const receiptId = receiptIdFor(envelope.organizationId, envelope.requestId);
      const receiptRef = refs.receipts.doc(receiptId);
      const commandDigest = inventory.digest({
        schemaVersion: envelope.schemaVersion,
        organizationId: envelope.organizationId,
        requestId: envelope.requestId,
        command: envelope.command,
        principal: { uid: actor.uid, organizationId: actor.organizationId }
      }, "ingredient inventory command");

      const outcome = await db.runTransaction(async (tx) => {
        const receiptSnap = await tx.get(receiptRef);
        const authority = await readAuthorityEnvelope(tx, refs, actor);
        if (receiptSnap.exists) {
          return publicOutcome(verifyReceipt(receiptSnap.data() || {}, {
            organizationId: envelope.organizationId,
            receiptId,
            requestId: envelope.requestId,
            commandKind: envelope.command.kind,
            commandDigest
          }), true);
        }

        const nowISO = inventory.exactISO(now(), "recordedAtISO");
        const commandKind = envelope.command.kind;
        let planned;
        let priorRevision = 0;
        const writes = [];

        if (commandKind === "upsert_location") {
          const locationRef = refs.locations.doc(envelope.command.locationId);
          const [locationSnap, locationsSnap, workspaceSnap, configurationSnap] = await Promise.all([
            tx.get(locationRef),
            tx.get(refs.locations.orderBy("name").limit(WORKSPACE_LIMIT + 1)),
            tx.get(refs.workspaceProjectionRef),
            tx.get(refs.configurationStateRef)
          ]);
          if (locationsSnap.size > WORKSPACE_LIMIT) {
            throw new inventory.InventoryIngredientError("resource-exhausted", "Inventory locations exceed the bounded workspace limit.");
          }
          const current = locationSnap.exists ? storedCanonical(locationSnap.data() || {}, "location", {
            organizationId: envelope.organizationId, locationId: envelope.command.locationId,
            documentId: locationSnap.id
          }) : null;
          const configuration = configurationSnap.exists
            ? verifyConfigurationState(configurationSnap.data() || {}, envelope.organizationId) : null;
          if ((current || locationsSnap.size > 0) && !configuration) {
            throw new inventory.InventoryIngredientError("data-loss", "Inventory locations exist without their configuration fence.");
          }
          if (configuration && configuration.locationCount !== locationsSnap.size) {
            throw new inventory.InventoryIngredientError("data-loss", "Inventory location count disagrees with its configuration fence.");
          }
          planned = inventory.planLocation({
            organizationId: envelope.organizationId, request: envelope.command, current, actor, nowISO
          });
          priorRevision = current?.revision || 0;
          const locations = locationsSnap.docs.filter((doc) => doc.id !== planned.location.locationId)
            .map((doc) => projectedLocation(storedCanonical(doc.data() || {}, "location", {
              organizationId: envelope.organizationId, documentId: doc.id
            })))
            .concat(projectedLocation(planned.location))
            .sort((left, right) => left.name.localeCompare(right.name) || left.locationId.localeCompare(right.locationId));
          const priorWorkspaceRevision = workspaceSnap.exists
            ? verifyWorkspaceProjection(workspaceSnap.data() || {}, envelope.organizationId).workspaceRevision : 0;
          inventory.revision(priorWorkspaceRevision, "workspaceRevision");
          writes.push({ operation: locationSnap.exists ? "set" : "create", ref: locationRef, value: planned.location });
          if (!current) writes.push({
            operation: configuration ? "set" : "create",
            ref: refs.configurationStateRef,
            value: advanceConfigurationState({
              current: configuration,
              organizationId: envelope.organizationId,
              increment: "location",
              nowISO
            })
          });
          writes.push({ operation: "set", ref: refs.workspaceProjectionRef, value: {
            authorityVersion: inventory.INVENTORY_AUTHORITY_VERSION,
            schemaVersion: inventory.INVENTORY_SCHEMA_VERSION,
            model: "inventory-workspace-projection-v2",
            organizationId: envelope.organizationId,
            projectionId: "current",
            workspaceRevision: priorWorkspaceRevision + 1,
            locations,
            updatedAtISO: nowISO
          } });
        } else if (commandKind === "compile_event_ingredient_demand") {
          const normalizedCommand = normalizeEventDemandInput(envelope.command, { includeExpectedRevision: true });
          const eventEnvelope = Object.freeze({
            organizationId: envelope.organizationId,
            ...normalizedCommand
          });
          const headRef = refs.eventRequirementHeads.doc(eventEnvelope.quoteId);
          const projectionRef = refs.eventProjections.doc(eventEnvelope.quoteId);
          const [headSnap, projectionSnap] = await Promise.all([
            tx.get(headRef),
            tx.get(projectionRef)
          ]);
          const currentHead = headSnap.exists ? verifyEventRequirementHead(headSnap.data() || {}, {
            organizationId: envelope.organizationId,
            quoteId: eventEnvelope.quoteId,
            documentId: headSnap.id
          }) : null;
          if ((currentHead?.revision || 0) !== eventEnvelope.expectedRequirementRevision) {
            throw new inventory.InventoryIngredientError(
              "aborted",
              "The saved event ingredient requirement changed. Reload it before recording another revision."
            );
          }
          if (projectionSnap.exists) verifyPersistedEventProjection(projectionSnap.data() || {}, {
            organizationId: envelope.organizationId,
            quoteId: eventEnvelope.quoteId,
            documentId: projectionSnap.id
          });
          const compiled = await compileCurrentEventDemand(
            tx,
            refs,
            eventEnvelope,
            authority.settingsSnap.data() || {}
          );
          if (compiled.projection.projectionDigest !== eventEnvelope.expectedPreviewProjectionDigest) {
            throw new inventory.InventoryIngredientError(
              "aborted",
              "Ingredient cost or stock evidence changed after preview. Preview again before recording."
            );
          }
          const head = eventRequirementHead({
            organizationId: envelope.organizationId,
            quoteId: eventEnvelope.quoteId,
            current: currentHead,
            compiled: compiled.requirementRevision,
            nowISO
          });
          const requirementDocumentRef = refs.eventRequirements.doc(eventEnvelope.quoteId)
            .collection("revisions")
            .doc(compiled.requirementRevision.eventRequirementRevisionId);
          const requirementDocumentSnap = await tx.get(requirementDocumentRef);
          const requirementDocument = eventRequirementRecord({
            requirement: compiled.requirementRevision,
            actor,
            nowISO
          });
          if (requirementDocumentSnap.exists) {
            const currentRecord = verifyEventRequirementRecord(requirementDocumentSnap.data() || {}, {
              organizationId: envelope.organizationId,
              quoteId: eventEnvelope.quoteId,
              eventRequirementRevisionId: compiled.requirementRevision.eventRequirementRevisionId,
              documentId: requirementDocumentSnap.id
            });
            if (inventory.canonicalSerialize(currentRecord.requirement)
              !== inventory.canonicalSerialize(compiled.requirementRevision)) {
              throw new inventory.InventoryIngredientError("data-loss", "An immutable event requirement identity collided.");
            }
          }
          const projection = persistedEventProjection({
            projection: compiled.projection,
            requirementRevision: head.revision,
            ingredientLabels: compiled.ingredientLabels,
            nowISO
          });
          planned = {
            requirementRevision: compiled.requirementRevision,
            projection,
            head,
            requirementDocument
          };
          priorRevision = currentHead?.revision || 0;
          if (!requirementDocumentSnap.exists) writes.push({
            operation: "create",
            ref: requirementDocumentRef,
            value: requirementDocument
          });
          writes.push(
            { operation: currentHead ? "set" : "create", ref: headRef, value: head },
            { operation: "set", ref: projectionRef, value: projection }
          );
        } else if (commandKind === "publish_menu_recipe") {
          const menuItemId = envelope.command.menuItemId;
          const headRef = refs.recipeHeads.doc(menuItemId);
          const menuItemRef = refs.menuItems.doc(menuItemId);
          const projectionRef = refs.menuCostProjections.doc(menuItemId);
          const [headSnap, menuItemSnap, currentProjectionSnap] = await Promise.all([
            tx.get(headRef), tx.get(menuItemRef), tx.get(projectionRef)
          ]);
          if (!menuItemSnap.exists) {
            throw new inventory.InventoryIngredientError("not-found", "Publish the menu item before publishing its ingredient recipe.");
          }
          const catalogRevision = authority.settingsSnap.data()?.catalogRevision;
          inventory.revision(catalogRevision, "catalog revision");
          if (catalogRevision !== envelope.command.expectedCatalogRevision) {
            throw new inventory.InventoryIngredientError("aborted", "The Library catalog changed. Reload the menu item before publishing its recipe.");
          }
          const currentHead = headSnap.exists ? verifyRecipeHead(headSnap.data() || {}, {
            organizationId: envelope.organizationId, menuItemId, documentId: headSnap.id
          }) : null;
          if ((currentHead?.revision || 0) !== envelope.command.expectedRecipeRevision) {
            throw new inventory.InventoryIngredientError("aborted", "The menu recipe changed. Reload it before publishing another revision.");
          }
          const recipeRevision = recipe.createRecipeRevision({
            organizationId: envelope.organizationId,
            menuItemId,
            revision: (currentHead?.revision || 0) + 1,
            priorRecipeRevisionId: currentHead?.recipeRevisionId || "",
            outputYield: envelope.command.outputYield,
            outputUnitId: envelope.command.outputUnitId,
            lines: envelope.command.lines,
            publishedAtISO: nowISO
          });
          const head = recipeHead(menuItemSnap.data() || {}, recipeRevision, catalogRevision, nowISO);
          const policy = recipePolicy(head, recipeRevision);
          const changedIngredientIds = [...new Set([
            ...(currentHead?.ingredientIds || []), ...head.ingredientIds
          ])].sort();
          const dependencyRefs = changedIngredientIds.map((ingredientId) => refs.recipeDependencies.doc(ingredientId));
          const dependencySnaps = dependencyRefs.length ? await tx.getAll(...dependencyRefs) : [];
          const dependencyWrites = dependencySnaps.map((snapshot, index) => {
            const ingredientId = changedIngredientIds[index];
            const current = snapshot.exists ? verifyRecipeDependency(snapshot.data() || {}, {
              organizationId: envelope.organizationId, ingredientId, documentId: snapshot.id
            }) : null;
            if (!current && currentHead?.ingredientIds.includes(ingredientId)) {
              throw new inventory.InventoryIngredientError("data-loss", "Current recipe is missing its reverse dependency index.");
            }
            const nextIds = new Set(current?.menuItemIds || []);
            if (head.ingredientIds.includes(ingredientId)) nextIds.add(menuItemId);
            else nextIds.delete(menuItemId);
            if (nextIds.size > MENU_COST_PROJECTION_LIMIT) {
              throw new inventory.InventoryIngredientError(
                "resource-exhausted",
                `An ingredient cannot currently index more than ${MENU_COST_PROJECTION_LIMIT} dependent menu items.`
              );
            }
            return {
              operation: current ? "set" : "create",
              ref: dependencyRefs[index],
              value: {
                authorityVersion: inventory.INVENTORY_AUTHORITY_VERSION,
                schemaVersion: inventory.INVENTORY_SCHEMA_VERSION,
                model: "ingredient-recipe-dependency-index-v2",
                organizationId: envelope.organizationId,
                ingredientId,
                menuItemIds: [...nextIds].sort(),
                revision: (current?.revision || 0) + 1,
                updatedAtISO: nowISO
              }
            };
          });
          const inputs = await readRecipeCostInputs(tx, refs, policy);
          const cost = recipe.calculateRecipeCost({
            recipeRevision,
            ingredients: inputs.ingredients,
            costStates: inputs.costStates,
            packConversions: inputs.packConversions
          });
          const nextProjection = menuCostProjection({ head, policy, cost, nowISO });
          if (currentProjectionSnap.exists) verifyMenuCostProjection(currentProjectionSnap.data() || {}, {
            organizationId: envelope.organizationId, menuItemId, documentId: currentProjectionSnap.id
          });
          planned = { recipeRevision, head, policy, menuCostProjection: nextProjection };
          priorRevision = currentHead?.revision || 0;
          writes.push(
            { operation: "create", ref: refs.recipePolicies.doc(recipeRevision.recipeRevisionId), value: policy },
            { operation: currentHead ? "set" : "create", ref: headRef, value: head },
            ...dependencyWrites,
            { operation: "set", ref: projectionRef, value: nextProjection }
          );
        } else {
          const ingredientId = envelope.command.ingredientId;
          const projectionRef = refs.ingredientProjections.doc(ingredientId);
          const inputs = await readIngredientInputs(tx, refs, envelope.organizationId, ingredientId);
          if (commandKind === "upsert_ingredient") {
            const configurationSnap = await tx.get(refs.configurationStateRef);
            const configuration = configurationSnap.exists
              ? verifyConfigurationState(configurationSnap.data() || {}, envelope.organizationId) : null;
            if (inputs.ingredient && !configuration) {
              throw new inventory.InventoryIngredientError("data-loss", "Inventory ingredients exist without their configuration fence.");
            }
            planned = inventory.planIngredient({
              organizationId: envelope.organizationId, request: envelope.command,
              current: inputs.ingredient,
              currentCostState: inputs.costState,
              hasPackConversionEvidence: inputs.packConversionHeads.length > 0,
              actor,
              nowISO
            });
            const impact = await readDependencyImpact(
              tx, refs, envelope.organizationId, ingredientId, nowISO, "ingredient_definition_changed"
            );
            planned = { ...planned, affectedMenuItemIds: impact.affectedMenuItemIds };
            priorRevision = inputs.ingredient?.revision || 0;
            writes.push({ operation: inputs.ingredient ? "set" : "create", ref: inputs.ingredientRef, value: planned.ingredient });
            if (!inputs.ingredient) writes.push({
              operation: configuration ? "set" : "create",
              ref: refs.configurationStateRef,
              value: advanceConfigurationState({
                current: configuration,
                organizationId: envelope.organizationId,
                increment: "ingredient",
                nowISO
              })
            });
            writes.push({ operation: "set", ref: projectionRef, value: ingredientProjection({
              ingredient: planned.ingredient, stockStates: inputs.stockStates, costState: inputs.costState,
              packConversionHeads: inputs.packConversionHeads, nowISO
            }) });
            writes.push(...impact.writes);
          } else if (commandKind === "opening_balance") {
            const stockRef = refs.stockStates.doc(inventory.stockStateId(ingredientId, envelope.command.locationId));
            const locationRef = refs.locations.doc(envelope.command.locationId);
            const [stockSnap, locationSnap] = await Promise.all([tx.get(stockRef), tx.get(locationRef)]);
            const stockState = stockSnap.exists ? storedCanonical(stockSnap.data() || {}, "stock state", {
              organizationId: envelope.organizationId, ingredientId, locationId: envelope.command.locationId,
              documentId: stockSnap.id
            }) : null;
            const location = locationSnap.exists ? storedCanonical(locationSnap.data() || {}, "location", {
              organizationId: envelope.organizationId, locationId: envelope.command.locationId,
              documentId: locationSnap.id
            }) : null;
            planned = inventory.planOpeningBalance({
              organizationId: envelope.organizationId, requestId: envelope.requestId,
              request: envelope.command, ingredient: inputs.ingredient, location,
              stockState, actor, nowISO
            });
            priorRevision = stockState?.revision || 0;
            const nextIngredient = Object.freeze({
              ...inputs.ingredient,
              firstMovementId: inputs.ingredient.firstMovementId || planned.movement.movementId,
              movementCount: (inputs.ingredient.movementCount || 0) + 1,
              updatedAtISO: nowISO,
              updatedBy: actor
            });
            const stockStates = inputs.stockStates.filter((state) => state.stockStateId !== planned.nextStockState.stockStateId)
              .concat(planned.nextStockState);
            writes.push({ operation: "create", ref: refs.movements.doc(planned.movement.movementId), value: planned.movement });
            writes.push({ operation: stockSnap.exists ? "set" : "create", ref: stockRef, value: planned.nextStockState });
            writes.push({ operation: "set", ref: inputs.ingredientRef, value: nextIngredient });
            writes.push({ operation: "set", ref: projectionRef, value: ingredientProjection({
              ingredient: nextIngredient, stockStates, costState: inputs.costState,
              packConversionHeads: inputs.packConversionHeads, nowISO
            }) });
          } else if (commandKind === "publish_pack_conversion") {
            if (!inputs.ingredient) {
              throw new inventory.InventoryIngredientError("not-found", "Create the ingredient before publishing a purchase pack conversion.");
            }
            if (inputs.ingredient.baseUnitId !== envelope.command.baseUnitId) {
              throw new inventory.InventoryIngredientError("failed-precondition", "Purchase pack base unit must match the ingredient base stock unit.");
            }
            const currentHead = inputs.packConversionHeads.find(
              (entry) => entry.packUnitId === envelope.command.packUnitId
            ) || null;
            if ((currentHead?.revision || 0) !== envelope.command.expectedRevision) {
              throw new inventory.InventoryIngredientError("aborted", "The purchase pack conversion changed. Reload it before publishing another revision.");
            }
            const packConversion = recipe.createPackConversionRevision({
              organizationId: envelope.organizationId,
              ingredientId,
              packUnitId: envelope.command.packUnitId,
              packLabel: envelope.command.packLabel,
              revision: (currentHead?.revision || 0) + 1,
              baseUnitId: envelope.command.baseUnitId,
              baseQuantity: envelope.command.baseQuantity,
              sourceLabel: envelope.command.sourceLabel,
              publishedAtISO: nowISO
            });
            const nextHead = {
              authorityVersion: inventory.INVENTORY_AUTHORITY_VERSION,
              schemaVersion: inventory.INVENTORY_SCHEMA_VERSION,
              model: "ingredient-pack-conversion-head-v2",
              organizationId: envelope.organizationId,
              ingredientId,
              headId: packHeadId(ingredientId, envelope.command.packUnitId),
              packUnitId: packConversion.packUnitId,
              packLabel: packConversion.packLabel,
              revision: packConversion.revision,
              packConversionRevisionId: packConversion.packConversionRevisionId,
              baseUnitId: packConversion.baseUnitId,
              baseQuantity: packConversion.baseQuantity,
              sourceLabel: packConversion.sourceLabel,
              updatedAtISO: nowISO
            };
            verifyPackHead(nextHead, {
              organizationId: envelope.organizationId, ingredientId, documentId: nextHead.headId
            });
            const packConversionHeads = inputs.packConversionHeads
              .filter((entry) => entry.packUnitId !== nextHead.packUnitId)
              .concat(nextHead);
            planned = { packConversion, nextHead, affectedMenuItemIds: [] };
            priorRevision = currentHead?.revision || 0;
            writes.push(
              { operation: "create", ref: refs.packConversionRevisions.doc(packConversion.packConversionRevisionId), value: packConversion },
              { operation: currentHead ? "set" : "create", ref: refs.packConversionHeads.doc(nextHead.headId), value: nextHead },
              { operation: "set", ref: projectionRef, value: ingredientProjection({
                ingredient: inputs.ingredient, stockStates: inputs.stockStates, costState: inputs.costState,
                packConversionHeads, nowISO
              }) }
            );
          } else {
            planned = inventory.planIngredientCostEvidence({
              organizationId: envelope.organizationId, requestId: envelope.requestId,
              request: envelope.command, ingredient: inputs.ingredient,
              currentCostState: inputs.costState, actor, nowISO
            });
            const impact = await readDependencyImpact(
              tx, refs, envelope.organizationId, ingredientId, nowISO, "ingredient_cost_changed"
            );
            planned = { ...planned, affectedMenuItemIds: impact.affectedMenuItemIds };
            priorRevision = inputs.costState?.revision || 0;
            writes.push({ operation: "create", ref: refs.costEvidence.doc(planned.costEvidence.costEvidenceId), value: planned.costEvidence });
            writes.push({ operation: inputs.costState ? "set" : "create", ref: inputs.costRef, value: planned.nextCostState });
            writes.push({ operation: "set", ref: projectionRef, value: ingredientProjection({
              ingredient: inputs.ingredient, stockStates: inputs.stockStates,
              costState: planned.nextCostState, packConversionHeads: inputs.packConversionHeads, nowISO
            }) });
            writes.push(...impact.writes);
          }
        }

        const result = commandResult(commandKind, planned);
        const resultRevision = commandKind === "upsert_location" ? planned.location.revision
          : commandKind === "upsert_ingredient" ? planned.ingredient.revision
            : commandKind === "opening_balance" ? planned.nextStockState.revision
              : commandKind === "publish_pack_conversion" ? planned.packConversion.revision
                : commandKind === "publish_menu_recipe" ? planned.recipeRevision.revision
                  : commandKind === "compile_event_ingredient_demand" ? planned.head.revision
                  : planned.nextCostState.revision;
        const body = {
          authorityVersion: inventory.INVENTORY_AUTHORITY_VERSION,
          schemaVersion: inventory.INVENTORY_SCHEMA_VERSION,
          organizationId: envelope.organizationId,
          receiptId,
          requestId: envelope.requestId,
          commandKind,
          commandDigest,
          recordedAtISO: nowISO,
          recordedBy: actor,
          priorRevision,
          resultRevision,
          result
        };
        const receipt = Object.freeze({ ...body, receiptDigest: inventory.digest(body, "ingredient inventory receipt") });
        writes.push({ operation: "create", ref: receiptRef, value: {
          receipt, createdAt: FieldValue.serverTimestamp()
        } });
        for (const write of writes) tx[write.operation](write.ref, write.value);
        return publicOutcome(receipt, false);
      });
      if (["upsert_ingredient", "record_ingredient_cost"].includes(envelope.command.kind)
        && Array.isArray(outcome.result?.affectedMenuItemIds)
        && outcome.result.affectedMenuItemIds.length) {
        await refreshAffectedMenuCosts(refs, actor, outcome.result.affectedMenuItemIds);
      }
      return outcome;
    } catch (error) {
      return throwFailure(error, "applyInventoryCommand");
    }
  }

  async function getInventoryWorkspace(data = {}, context = {}) {
    try {
      const envelope = normalizeWorkspaceEnvelope(data);
      const staff = await assertStaff(context, { expectedOrganizationId: envelope.organizationId });
      const actor = actorFor(staff, envelope.organizationId);
      const refs = refsFor(envelope.organizationId);
      return await db.runTransaction(async (tx) => {
        await readAuthorityEnvelope(tx, refs, actor);
        const [locationsSnap, projectionsSnap] = await Promise.all([
          tx.get(refs.locations.orderBy("name").limit(WORKSPACE_LIMIT + 1)),
          tx.get(refs.ingredientProjections.orderBy("nameSortKey").limit(WORKSPACE_LIMIT + 1))
        ]);
        if (locationsSnap.size > WORKSPACE_LIMIT || projectionsSnap.size > WORKSPACE_LIMIT) {
          throw new inventory.InventoryIngredientError("resource-exhausted", "Ingredient inventory workspace exceeds its bounded recovery limit.");
        }
        const locations = locationsSnap.docs.map((doc) => safeLocation(storedCanonical(doc.data() || {}, "location", {
          organizationId: envelope.organizationId, documentId: doc.id
        })));
        const ingredients = projectionsSnap.docs.map((doc) => {
          const projection = doc.data() || {};
          return verifyIngredientProjection(projection, envelope.organizationId, doc.id);
        });
        return Object.freeze({
          schemaVersion: inventory.INVENTORY_SCHEMA_VERSION,
          organizationId: envelope.organizationId,
          locations,
          ingredients,
          bounded: true,
          limit: WORKSPACE_LIMIT
        });
      });
    } catch (error) {
      return throwFailure(error, "getInventoryWorkspace");
    }
  }

  async function previewEventInventory(data = {}, context = {}) {
    try {
      const envelope = normalizeEventDemandPreviewEnvelope(data);
      const staff = await assertStaff(context, { expectedOrganizationId: envelope.organizationId });
      const reader = readerFor(staff, envelope.organizationId);
      const refs = refsFor(envelope.organizationId);
      return await db.runTransaction(async (tx) => {
        const authority = await readAuthorityEnvelope(tx, refs, reader, { allowedRoles: ["admin", "sales"] });
        const compiled = await compileCurrentEventDemand(
          tx,
          refs,
          envelope,
          authority.settingsSnap.data() || {}
        );
        return Object.freeze({
          ok: true,
          schemaVersion: inventory.INVENTORY_SCHEMA_VERSION,
          organizationId: envelope.organizationId,
          quoteId: envelope.quoteId,
          quoteRevisionId: envelope.quoteRevisionId,
          preview: true,
          requirementRevision: compiled.requirementRevision,
          projection: compiled.projection,
          ingredientLabels: Object.freeze(compiled.ingredientLabels)
        });
      });
    } catch (error) {
      return throwFailure(error, "previewEventInventory");
    }
  }

  function throwFailure(error, operation) {
    if (error instanceof HttpsError) throw error;
    if (error instanceof inventory.InventoryIngredientError) throw new HttpsError(error.code, error.message);
    if (error instanceof recipe.InventoryRecipeError) throw new HttpsError(error.code, error.message);
    logger.error("Ingredient inventory authority failed.", {
      operation,
      errorName: String(error?.name || "Error"),
      errorMessage: String(error?.message || "Unknown failure")
    });
    throw new HttpsError("internal", "Ingredient inventory authority failed without a confirmed outcome. Retry the same request identity.");
  }

  return Object.freeze({ applyInventoryCommand, getInventoryWorkspace, previewEventInventory });
}

module.exports = {
  COLLECTIONS,
  MAX_PUBLISHED_RECIPE_LINES,
  MENU_COST_PROJECTION_LIMIT,
  WORKSPACE_LIMIT,
  createInventoryAuthorityRuntime,
  ingredientProjection,
  menuCostProjection,
  normalizeApplyEnvelope,
  normalizeEventDemandPreviewEnvelope,
  normalizeWorkspaceEnvelope,
  packHeadId,
  receiptIdFor,
  verifyMenuCostProjection,
  verifyEventRequirementHead,
  verifyEventRequirementRecord,
  verifyPersistedEventProjection,
  verifyPackHead,
  verifyRecipeDependency,
  verifyRecipeHead,
  verifyRecipePolicy,
  verifyIngredientProjection,
  verifyWorkspaceProjection
};
