"use strict";

const inventory = require("./inventoryIngredientCore.cjs");

const ALLOCATION_VERSION = "ingredient-allocation-v1";
const MAX_ALLOCATION_INGREDIENTS = 100;
const MAX_FENCE_ALLOCATIONS = 300;
const MAX_PLAN_DOCUMENT_BYTES = 700_000;

class InventoryAllocationError extends Error {
  constructor(code, message, details = {}) {
    super(message);
    this.name = "InventoryAllocationError";
    this.code = code;
    this.details = details;
  }
}

function fail(code, message, details) {
  throw new InventoryAllocationError(code, message, details);
}

function isRecord(value) {
  if (!value || typeof value !== "object" || Array.isArray(value)) return false;
  const prototype = Object.getPrototypeOf(value);
  return prototype === Object.prototype || prototype === null;
}

function exact(value, keys, label, code = "invalid-argument") {
  if (!isRecord(value) || Object.keys(value).length !== keys.length
    || keys.some((key) => !Object.hasOwn(value, key))) {
    fail(code, `${label} contains missing or unsupported fields.`);
  }
}

function safeAdd(left, right, label) {
  if (!Number.isSafeInteger(left) || !Number.isSafeInteger(right) || left < 0 || right < 0
    || left > Number.MAX_SAFE_INTEGER - right) fail("out-of-range", `${label} exceeds the safe exact range.`);
  return left + right;
}

function boundedPlan(value, label = "event ingredient plan") {
  const bytes = Buffer.byteLength(inventory.canonicalSerialize(value, label), "utf8");
  if (bytes > MAX_PLAN_DOCUMENT_BYTES) fail("resource-exhausted", `${label} exceeds the bounded Firestore document size.`);
  return value;
}

function allocationFenceId(organizationId, ingredientId, locationId) {
  return `iaf_${inventory.digest({
    organizationId: inventory.opaqueId(organizationId, "organizationId"),
    ingredientId: inventory.opaqueId(ingredientId, "ingredientId"),
    locationId: inventory.opaqueId(locationId, "locationId")
  }, "ingredient allocation fence identity").slice(0, 48)}`;
}

function eventPlanIdFor(organizationId, quoteId) {
  return `eip_${inventory.digest({
    organizationId: inventory.opaqueId(organizationId, "organizationId"),
    quoteId: inventory.opaqueId(quoteId, "quoteId")
  }, "event ingredient plan identity").slice(0, 48)}`;
}

function allocationIdFor(organizationId, quoteId, ingredientId, locationId) {
  return `ial_${inventory.digest({
    organizationId: inventory.opaqueId(organizationId, "organizationId"),
    quoteId: inventory.opaqueId(quoteId, "quoteId"),
    ingredientId: inventory.opaqueId(ingredientId, "ingredientId"),
    locationId: inventory.opaqueId(locationId, "locationId")
  }, "ingredient allocation identity").slice(0, 48)}`;
}

function planRevisionIdFor(eventPlanId, allocationRevision) {
  return `eipr_${inventory.digest({
    eventPlanId: inventory.opaqueId(eventPlanId, "eventPlanId"),
    allocationRevision: inventory.revision(allocationRevision, "allocationRevision", { allowZero: false })
  }, "event ingredient plan revision identity").slice(0, 48)}`;
}

function normalizeAllocateRequest(value) {
  exact(value, [
    "kind", "quoteId", "eventRequirementRevisionId", "locationId",
    "expectedRequirementRevision", "expectedAllocationRevision"
  ], "event ingredient allocation command");
  if (value.kind !== "allocate_event_ingredients") fail("invalid-argument", "Event ingredient allocation command is invalid.");
  return Object.freeze({
    kind: value.kind,
    quoteId: inventory.opaqueId(value.quoteId, "quoteId"),
    eventRequirementRevisionId: inventory.opaqueId(value.eventRequirementRevisionId, "eventRequirementRevisionId"),
    locationId: inventory.opaqueId(value.locationId, "locationId"),
    expectedRequirementRevision: inventory.revision(value.expectedRequirementRevision, "expectedRequirementRevision", { allowZero: false }),
    expectedAllocationRevision: inventory.revision(value.expectedAllocationRevision, "expectedAllocationRevision")
  });
}

function normalizeReleaseRequest(value) {
  exact(value, ["kind", "quoteId", "expectedAllocationRevision", "reason"], "event ingredient release command");
  if (value.kind !== "release_event_ingredients") fail("invalid-argument", "Event ingredient release command is invalid.");
  if (typeof value.reason !== "string" || value.reason !== value.reason.trim()
    || !value.reason || value.reason.length > 160) fail("invalid-argument", "Release reason must be exact bounded text.");
  return Object.freeze({
    kind: value.kind,
    quoteId: inventory.opaqueId(value.quoteId, "quoteId"),
    expectedAllocationRevision: inventory.revision(value.expectedAllocationRevision, "expectedAllocationRevision", { allowZero: false }),
    reason: value.reason.replace(/\s+/gu, " ")
  });
}

function emptyFence({ organizationId, ingredientId, locationId, baseUnitId }) {
  const orgId = inventory.opaqueId(organizationId, "organizationId");
  const itemId = inventory.opaqueId(ingredientId, "ingredientId");
  const stockLocationId = inventory.opaqueId(locationId, "locationId");
  return Object.freeze({
    authorityVersion: inventory.INVENTORY_AUTHORITY_VERSION,
    schemaVersion: inventory.INVENTORY_SCHEMA_VERSION,
    allocationVersion: ALLOCATION_VERSION,
    model: "ingredient-allocation-fence-v1",
    organizationId: orgId,
    fenceId: allocationFenceId(orgId, itemId, stockLocationId),
    ingredientId: itemId,
    locationId: stockLocationId,
    baseUnitId: inventory.baseUnitId(baseUnitId),
    revision: 0,
    committedMicros: 0,
    allocations: Object.freeze([]),
    updatedAtISO: ""
  });
}

function verifyFence(value, identity = {}) {
  exact(value, [
    "authorityVersion", "schemaVersion", "allocationVersion", "model", "organizationId",
    "fenceId", "ingredientId", "locationId", "baseUnitId", "revision", "committedMicros",
    "allocations", "updatedAtISO"
  ], "ingredient allocation fence", "data-loss");
  if (value.authorityVersion !== inventory.INVENTORY_AUTHORITY_VERSION
    || value.schemaVersion !== inventory.INVENTORY_SCHEMA_VERSION
    || value.allocationVersion !== ALLOCATION_VERSION || value.model !== "ingredient-allocation-fence-v1"
    || value.organizationId !== identity.organizationId
    || value.ingredientId !== identity.ingredientId || value.locationId !== identity.locationId
    || value.fenceId !== allocationFenceId(value.organizationId, value.ingredientId, value.locationId)
    || (identity.documentId && value.fenceId !== identity.documentId)) {
    fail("data-loss", "Ingredient allocation fence identity is invalid.");
  }
  inventory.baseUnitId(value.baseUnitId);
  inventory.revision(value.revision, "allocation fence revision");
  inventory.formatQuantityMicros(value.committedMicros, "allocation fence committedMicros");
  if (!Array.isArray(value.allocations) || value.allocations.length > MAX_FENCE_ALLOCATIONS) {
    fail("data-loss", "Ingredient allocation fence exceeds its bounded allocation count.");
  }
  let committed = 0;
  const ids = new Set();
  for (const entry of value.allocations) {
    exact(entry, [
      "allocationId", "eventPlanId", "quoteId", "eventRequirementRevisionId", "quantityMicros"
    ], "active ingredient allocation", "data-loss");
    inventory.opaqueId(entry.allocationId, "allocationId");
    inventory.opaqueId(entry.eventPlanId, "eventPlanId");
    inventory.opaqueId(entry.quoteId, "allocation quoteId");
    inventory.opaqueId(entry.eventRequirementRevisionId, "allocation requirement revisionId");
    if (!Number.isSafeInteger(entry.quantityMicros) || entry.quantityMicros <= 0 || ids.has(entry.allocationId)) {
      fail("data-loss", "Active ingredient allocation quantity or identity is invalid.");
    }
    ids.add(entry.allocationId);
    committed = safeAdd(committed, entry.quantityMicros, "allocation fence commitment");
  }
  if (committed !== value.committedMicros
    || (value.revision === 0) !== (value.updatedAtISO === "")) {
    fail("data-loss", "Ingredient allocation fence total or revision evidence is inconsistent.");
  }
  if (value.updatedAtISO) inventory.exactISO(value.updatedAtISO, "allocation fence updatedAtISO");
  return value;
}

function verifyPlan(value, { organizationId, quoteId, documentId } = {}) {
  exact(value, [
    "authorityVersion", "schemaVersion", "allocationVersion", "model", "organizationId", "quoteId",
    "eventPlanId", "planRevisionId", "allocationRevision", "state", "eventRequirementRevisionId",
    "requirementRevision", "requirementDigest", "requiredByISO", "locationId", "ingredients",
    "ingredientCount", "fullyAllocatedIngredientCount", "shortageIngredientCount", "releaseReason",
    "updatedAtISO"
  ], "event ingredient plan", "data-loss");
  if (value.authorityVersion !== inventory.INVENTORY_AUTHORITY_VERSION
    || value.schemaVersion !== inventory.INVENTORY_SCHEMA_VERSION
    || value.allocationVersion !== ALLOCATION_VERSION || value.model !== "event-ingredient-plan-v1"
    || value.organizationId !== organizationId || value.quoteId !== quoteId
    || value.eventPlanId !== eventPlanIdFor(organizationId, quoteId)
    || value.planRevisionId !== planRevisionIdFor(value.eventPlanId, value.allocationRevision)
    || (documentId && documentId !== quoteId)
    || !["reserved", "shortage", "released"].includes(value.state)) {
    fail("data-loss", "Event ingredient plan identity or state is invalid.");
  }
  inventory.revision(value.allocationRevision, "allocationRevision", { allowZero: false });
  inventory.revision(value.requirementRevision, "requirementRevision", { allowZero: false });
  inventory.opaqueId(value.eventRequirementRevisionId, "eventRequirementRevisionId");
  inventory.opaqueId(value.locationId, "plan locationId");
  inventory.exactISO(value.requiredByISO, "plan requiredByISO");
  inventory.exactISO(value.updatedAtISO, "plan updatedAtISO");
  if (!/^[a-f0-9]{64}$/u.test(value.requirementDigest)
    || !Array.isArray(value.ingredients) || value.ingredients.length > MAX_ALLOCATION_INGREDIENTS
    || value.ingredientCount !== value.ingredients.length) {
    fail("data-loss", "Event ingredient plan requirement evidence is invalid.");
  }
  const ids = new Set();
  let priorIngredientId = "";
  let full = 0;
  let short = 0;
  value.ingredients.forEach((entry) => {
    exact(entry, [
      "allocationId", "fenceId", "ingredientId", "locationId", "baseUnitId", "stockRevision",
      "fenceRevision", "requiredQuantityMicros", "allocatedQuantityMicros", "shortageQuantityMicros"
    ], "planned ingredient allocation", "data-loss");
    if (ids.has(entry.ingredientId) || (priorIngredientId && priorIngredientId.localeCompare(entry.ingredientId) >= 0)
      || entry.locationId !== value.locationId
      || entry.allocationId !== allocationIdFor(organizationId, quoteId, entry.ingredientId, entry.locationId)
      || entry.fenceId !== allocationFenceId(organizationId, entry.ingredientId, entry.locationId)) {
      fail("data-loss", "Planned ingredient allocation identity is invalid.");
    }
    ids.add(entry.ingredientId);
    priorIngredientId = entry.ingredientId;
    inventory.baseUnitId(entry.baseUnitId);
    inventory.revision(entry.stockRevision, "allocation stockRevision", { allowZero: false });
    inventory.revision(entry.fenceRevision, "allocation fenceRevision", { allowZero: false });
    for (const key of ["requiredQuantityMicros", "allocatedQuantityMicros", "shortageQuantityMicros"]) {
      inventory.formatQuantityMicros(entry[key], `allocation ${key}`);
    }
    if (entry.requiredQuantityMicros <= 0
      || entry.allocatedQuantityMicros + entry.shortageQuantityMicros !== entry.requiredQuantityMicros) {
      fail("data-loss", "Planned ingredient allocation quantities are inconsistent.");
    }
    if (entry.shortageQuantityMicros > 0) short += 1;
    else full += 1;
  });
  if (full !== value.fullyAllocatedIngredientCount || short !== value.shortageIngredientCount
    || (value.state === "reserved" && short !== 0)
    || (value.state === "shortage" && short === 0)
    || (value.state === "released") !== Boolean(value.releaseReason)) {
    fail("data-loss", "Event ingredient plan summary is inconsistent.");
  }
  return boundedPlan(value);
}

function normalizeRequirements(requirement) {
  if (!isRecord(requirement) || requirement.demandState !== "complete"
    || !Array.isArray(requirement.ingredients)) {
    fail("failed-precondition", "Only a complete immutable ingredient requirement can be allocated.");
  }
  if (!requirement.ingredients.length || requirement.ingredients.length > MAX_ALLOCATION_INGREDIENTS) {
    fail("resource-exhausted", `Allocation supports 1-${MAX_ALLOCATION_INGREDIENTS} ingredient rows atomically.`);
  }
  const ids = new Set();
  const normalized = requirement.ingredients.map((entry) => {
    if (!isRecord(entry) || ids.has(entry.ingredientId)
      || !Number.isSafeInteger(entry.requiredQuantityMicros) || entry.requiredQuantityMicros <= 0) {
      fail("data-loss", "Immutable ingredient requirement contains invalid allocation quantities.");
    }
    ids.add(entry.ingredientId);
    return {
      ingredientId: inventory.opaqueId(entry.ingredientId, "requirement ingredientId"),
      baseUnitId: inventory.baseUnitId(entry.baseUnitId),
      requiredQuantityMicros: entry.requiredQuantityMicros
    };
  });
  const sorted = [...normalized].sort((left, right) => left.ingredientId.localeCompare(right.ingredientId));
  if (inventory.canonicalSerialize(normalized.map(({ ingredientId }) => ingredientId))
    !== inventory.canonicalSerialize(sorted.map(({ ingredientId }) => ingredientId))) {
    fail("data-loss", "Immutable ingredient requirements must be deterministically sorted.");
  }
  return sorted;
}

function planEventAllocation({ request, organizationId, requirementHead, requirement, currentPlan = null, stockStates, fences, nowISO }) {
  const normalized = normalizeAllocateRequest(request);
  const orgId = inventory.opaqueId(organizationId, "organizationId");
  const recordedAtISO = inventory.exactISO(nowISO, "nowISO");
  if (!isRecord(requirementHead) || requirementHead.organizationId !== orgId
    || requirementHead.quoteId !== normalized.quoteId
    || requirementHead.revision !== normalized.expectedRequirementRevision
    || requirementHead.eventRequirementRevisionId !== normalized.eventRequirementRevisionId
    || requirement.eventRequirementRevisionId !== normalized.eventRequirementRevisionId
    || requirement.requirementDigest !== requirementHead.requirementDigest) {
    fail("aborted", "The saved event ingredient requirement changed before allocation.");
  }
  const currentRevision = currentPlan?.allocationRevision || 0;
  if (currentRevision !== normalized.expectedAllocationRevision) fail("aborted", "The event ingredient allocation changed.");
  if (currentPlan) verifyPlan(currentPlan, { organizationId: orgId, quoteId: normalized.quoteId });
  const topsUpShortage = currentPlan?.state === "shortage";
  if (currentPlan?.state === "reserved") {
    fail("failed-precondition", "The event ingredient requirement is already fully allocated.");
  }
  if (topsUpShortage && (currentPlan.eventRequirementRevisionId !== normalized.eventRequirementRevisionId
    || currentPlan.requirementRevision !== normalized.expectedRequirementRevision
    || currentPlan.requirementDigest !== requirement.requirementDigest
    || currentPlan.locationId !== normalized.locationId)) {
    fail("aborted", "The partial allocation no longer matches the current ingredient requirement.");
  }
  const requirements = normalizeRequirements(requirement);
  const stockById = new Map(stockStates.map((state) => [state.ingredientId, state]));
  const fenceById = new Map(fences.map((fence) => [fence.ingredientId, fence]));
  const priorRowsById = new Map((topsUpShortage ? currentPlan.ingredients : [])
    .map((entry) => [entry.ingredientId, entry]));
  if (topsUpShortage && (priorRowsById.size !== requirements.length
    || requirements.some((entry) => {
      const prior = priorRowsById.get(entry.ingredientId);
      return !prior || prior.baseUnitId !== entry.baseUnitId
        || prior.requiredQuantityMicros !== entry.requiredQuantityMicros;
    }))) {
    fail("data-loss", "The partial allocation does not exactly cover its immutable requirement.");
  }
  const nextFences = [];
  const ingredients = [];
  let allocatedAnyAdditionalQuantity = false;
  for (const row of requirements) {
    const stock = stockById.get(row.ingredientId);
    if (!stock) fail("failed-precondition", "Current stock is unavailable for an ingredient requirement.");
    inventory.verifyStockState(stock, {
      organizationId: orgId, ingredientId: row.ingredientId, locationId: normalized.locationId
    });
    if (stock.locationId !== normalized.locationId || stock.baseUnitId !== row.baseUnitId || stock.revision < 1) {
      fail("failed-precondition", "Ingredient stock location, unit, or opening evidence is unavailable.");
    }
    const currentFence = fenceById.get(row.ingredientId) || emptyFence({
      organizationId: orgId,
      ingredientId: row.ingredientId,
      locationId: normalized.locationId,
      baseUnitId: row.baseUnitId
    });
    verifyFence(currentFence, {
      organizationId: orgId, ingredientId: row.ingredientId, locationId: normalized.locationId
    });
    if (currentFence.baseUnitId !== row.baseUnitId || currentFence.committedMicros > stock.onHandMicros) {
      fail("failed-precondition", "Ingredient allocation fence is inconsistent with physical stock.");
    }
    const priorRow = priorRowsById.get(row.ingredientId) || null;
    const allocationId = allocationIdFor(orgId, normalized.quoteId, row.ingredientId, normalized.locationId);
    const priorFenceAllocation = currentFence.allocations.find((entry) => entry.allocationId === allocationId) || null;
    if (priorRow && ((priorRow.allocatedQuantityMicros > 0
      && (!priorFenceAllocation || priorFenceAllocation.quantityMicros !== priorRow.allocatedQuantityMicros))
      || (priorRow.allocatedQuantityMicros === 0 && priorFenceAllocation))) {
      fail("data-loss", "The partial allocation disagrees with its shared contention fence.");
    }
    if (!priorRow && priorFenceAllocation) {
      fail("data-loss", "A new event allocation collides with an active allocation identity.");
    }
    const available = stock.onHandMicros - currentFence.committedMicros;
    const priorAllocated = priorRow?.allocatedQuantityMicros || 0;
    const remaining = row.requiredQuantityMicros - priorAllocated;
    const additional = Math.min(remaining, available);
    const allocated = priorAllocated + additional;
    const shortage = row.requiredQuantityMicros - allocated;
    if (additional > 0) allocatedAnyAdditionalQuantity = true;
    const eventPlanId = eventPlanIdFor(orgId, normalized.quoteId);
    const allocationsWithoutCurrent = currentFence.allocations.filter((entry) => entry.allocationId !== allocationId);
    const allocations = allocated > 0
      ? [...allocationsWithoutCurrent, {
        allocationId,
        eventPlanId,
        quoteId: normalized.quoteId,
        eventRequirementRevisionId: normalized.eventRequirementRevisionId,
        quantityMicros: allocated
      }].sort((left, right) => left.allocationId.localeCompare(right.allocationId))
      : allocationsWithoutCurrent;
    if (allocations.length > MAX_FENCE_ALLOCATIONS) {
      fail("resource-exhausted", `An ingredient fence supports at most ${MAX_FENCE_ALLOCATIONS} active event allocations.`);
    }
    const nextFence = Object.freeze({
      ...currentFence,
      revision: currentFence.revision + 1,
      committedMicros: currentFence.committedMicros + additional,
      allocations: Object.freeze(allocations),
      updatedAtISO: recordedAtISO
    });
    verifyFence(nextFence, {
      organizationId: orgId, ingredientId: row.ingredientId, locationId: normalized.locationId
    });
    nextFences.push(nextFence);
    ingredients.push(Object.freeze({
      allocationId,
      fenceId: nextFence.fenceId,
      ingredientId: row.ingredientId,
      locationId: normalized.locationId,
      baseUnitId: row.baseUnitId,
      stockRevision: stock.revision,
      fenceRevision: nextFence.revision,
      requiredQuantityMicros: row.requiredQuantityMicros,
      allocatedQuantityMicros: allocated,
      shortageQuantityMicros: shortage
    }));
  }
  if (topsUpShortage && !allocatedAnyAdditionalQuantity) {
    fail("failed-precondition", "No newly available ingredient stock can reduce this event shortage.");
  }
  const shortageIngredientCount = ingredients.filter((row) => row.shortageQuantityMicros > 0).length;
  const allocationRevision = currentRevision + 1;
  const eventPlanId = eventPlanIdFor(orgId, normalized.quoteId);
  const plan = Object.freeze({
    authorityVersion: inventory.INVENTORY_AUTHORITY_VERSION,
    schemaVersion: inventory.INVENTORY_SCHEMA_VERSION,
    allocationVersion: ALLOCATION_VERSION,
    model: "event-ingredient-plan-v1",
    organizationId: orgId,
    quoteId: normalized.quoteId,
    eventPlanId,
    planRevisionId: planRevisionIdFor(eventPlanId, allocationRevision),
    allocationRevision,
    state: shortageIngredientCount ? "shortage" : "reserved",
    eventRequirementRevisionId: normalized.eventRequirementRevisionId,
    requirementRevision: normalized.expectedRequirementRevision,
    requirementDigest: requirement.requirementDigest,
    requiredByISO: requirement.requiredByISO,
    locationId: normalized.locationId,
    ingredients: Object.freeze(ingredients),
    ingredientCount: ingredients.length,
    fullyAllocatedIngredientCount: ingredients.length - shortageIngredientCount,
    shortageIngredientCount,
    releaseReason: "",
    updatedAtISO: recordedAtISO
  });
  verifyPlan(plan, { organizationId: orgId, quoteId: normalized.quoteId });
  return Object.freeze({ request: normalized, plan, fences: Object.freeze(nextFences) });
}

function planEventRelease({ request, organizationId, currentPlan, fences, nowISO }) {
  const normalized = normalizeReleaseRequest(request);
  const orgId = inventory.opaqueId(organizationId, "organizationId");
  const recordedAtISO = inventory.exactISO(nowISO, "nowISO");
  if (!currentPlan) fail("not-found", "The event has no ingredient allocation to release.");
  verifyPlan(currentPlan, { organizationId: orgId, quoteId: normalized.quoteId });
  if (currentPlan.allocationRevision !== normalized.expectedAllocationRevision) fail("aborted", "The event ingredient allocation changed.");
  if (currentPlan.state === "released") fail("failed-precondition", "The event ingredient allocation is already released.");
  const fenceById = new Map(fences.map((fence) => [fence.fenceId, fence]));
  const nextFences = currentPlan.ingredients.map((row) => {
    const fence = fenceById.get(row.fenceId);
    if (!fence) fail("data-loss", "An active event allocation is missing its contention fence.");
    verifyFence(fence, {
      organizationId: orgId, ingredientId: row.ingredientId, locationId: row.locationId
    });
    const retained = fence.allocations.filter(({ allocationId }) => allocationId !== row.allocationId);
    const match = fence.allocations.find(({ allocationId }) => allocationId === row.allocationId);
    if (row.allocatedQuantityMicros > 0
      && (!match || match.quantityMicros !== row.allocatedQuantityMicros)) {
      fail("data-loss", "An active event allocation disagrees with its contention fence.");
    }
    if (row.allocatedQuantityMicros === 0 && match) {
      fail("data-loss", "A zero allocation unexpectedly consumes a contention fence.");
    }
    const next = Object.freeze({
      ...fence,
      revision: fence.revision + 1,
      committedMicros: fence.committedMicros - row.allocatedQuantityMicros,
      allocations: Object.freeze(retained),
      updatedAtISO: recordedAtISO
    });
    verifyFence(next, {
      organizationId: orgId, ingredientId: row.ingredientId, locationId: row.locationId
    });
    return next;
  });
  const allocationRevision = currentPlan.allocationRevision + 1;
  const plan = Object.freeze({
    ...currentPlan,
    planRevisionId: planRevisionIdFor(currentPlan.eventPlanId, allocationRevision),
    allocationRevision,
    state: "released",
    releaseReason: normalized.reason,
    updatedAtISO: recordedAtISO
  });
  verifyPlan(plan, { organizationId: orgId, quoteId: normalized.quoteId });
  return Object.freeze({ request: normalized, plan, fences: Object.freeze(nextFences) });
}

module.exports = {
  ALLOCATION_VERSION,
  InventoryAllocationError,
  MAX_ALLOCATION_INGREDIENTS,
  MAX_FENCE_ALLOCATIONS,
  MAX_PLAN_DOCUMENT_BYTES,
  allocationFenceId,
  allocationIdFor,
  emptyFence,
  eventPlanIdFor,
  normalizeAllocateRequest,
  normalizeReleaseRequest,
  planEventAllocation,
  planEventRelease,
  planRevisionIdFor,
  verifyFence,
  verifyPlan
};
