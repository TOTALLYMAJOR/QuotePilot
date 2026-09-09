"use strict";

const inventory = require("./inventoryIngredientCore.cjs");
const allocation = require("./inventoryIngredientAllocationCore.cjs");

const RECONCILIATION_VERSION = "ingredient-reconciliation-v1";

class InventoryReconciliationError extends Error {
  constructor(code, message, details = {}) {
    super(message);
    this.name = "InventoryReconciliationError";
    this.code = code;
    this.details = details;
  }
}

function fail(code, message, details) {
  throw new InventoryReconciliationError(code, message, details);
}

function isRecord(value) {
  if (!value || typeof value !== "object" || Array.isArray(value)) return false;
  const prototype = Object.getPrototypeOf(value);
  return prototype === Object.prototype || prototype === null;
}

function normalizeReconcileRequest(value) {
  const keys = [
    "kind", "quoteId", "eventRequirementRevisionId", "locationId",
    "expectedRequirementRevision", "expectedAllocationRevision", "reason"
  ];
  if (!isRecord(value) || Object.keys(value).length !== keys.length
    || keys.some((key) => !Object.hasOwn(value, key))
    || value.kind !== "reconcile_event_ingredients") {
    fail("invalid-argument", "Event ingredient reconciliation command contains missing or unsupported fields.");
  }
  if (typeof value.reason !== "string" || value.reason !== value.reason.trim()
    || !value.reason || value.reason.length > 160) {
    fail("invalid-argument", "Reconciliation reason must be exact bounded text.");
  }
  return Object.freeze({
    kind: value.kind,
    quoteId: inventory.opaqueId(value.quoteId, "quoteId"),
    eventRequirementRevisionId: inventory.opaqueId(
      value.eventRequirementRevisionId,
      "eventRequirementRevisionId"
    ),
    locationId: inventory.opaqueId(value.locationId, "locationId"),
    expectedRequirementRevision: inventory.revision(
      value.expectedRequirementRevision,
      "expectedRequirementRevision",
      { allowZero: false }
    ),
    expectedAllocationRevision: inventory.revision(
      value.expectedAllocationRevision,
      "expectedAllocationRevision",
      { allowZero: false }
    ),
    reason: value.reason.replace(/\s+/gu, " ")
  });
}

function planEventReconciliation({
  request,
  organizationId,
  requirementHead,
  requirement,
  currentPlan,
  stockStates,
  fences,
  nowISO
}) {
  const normalized = normalizeReconcileRequest(request);
  if (!currentPlan || currentPlan.state === "released") {
    fail("failed-precondition", "Only an active ingredient allocation can be reconciled.");
  }
  allocation.verifyPlan(currentPlan, {
    organizationId,
    quoteId: normalized.quoteId
  });
  if (currentPlan.allocationRevision !== normalized.expectedAllocationRevision) {
    fail("aborted", "The event ingredient allocation changed before reconciliation.");
  }
  if (currentPlan.eventRequirementRevisionId === normalized.eventRequirementRevisionId
    && currentPlan.requirementRevision === normalized.expectedRequirementRevision
    && currentPlan.requirementDigest === requirement?.requirementDigest) {
    fail("failed-precondition", "The active allocation already matches the current ingredient requirement.");
  }

  const priorFenceIds = new Set(currentPlan.ingredients.map(({ fenceId }) => fenceId));
  const priorFences = fences.filter(({ fenceId }) => priorFenceIds.has(fenceId));
  const released = allocation.planEventRelease({
    request: {
      kind: "release_event_ingredients",
      quoteId: normalized.quoteId,
      expectedAllocationRevision: normalized.expectedAllocationRevision,
      reason: normalized.reason
    },
    organizationId,
    currentPlan,
    fences: priorFences,
    nowISO
  });

  const fenceById = new Map(fences.map((fence) => [fence.fenceId, fence]));
  released.fences.forEach((fence) => fenceById.set(fence.fenceId, fence));
  const allocated = allocation.planEventAllocation({
    request: {
      kind: "allocate_event_ingredients",
      quoteId: normalized.quoteId,
      eventRequirementRevisionId: normalized.eventRequirementRevisionId,
      locationId: normalized.locationId,
      expectedRequirementRevision: normalized.expectedRequirementRevision,
      expectedAllocationRevision: released.plan.allocationRevision
    },
    organizationId,
    requirementHead,
    requirement,
    currentPlan: released.plan,
    stockStates,
    fences: [...fenceById.values()],
    nowISO
  });

  const finalFenceById = new Map(fenceById);
  allocated.fences.forEach((fence) => finalFenceById.set(fence.fenceId, fence));
  return Object.freeze({
    request: normalized,
    releasedPlan: released.plan,
    plan: allocated.plan,
    fences: Object.freeze([...finalFenceById.values()].sort((left, right) =>
      left.fenceId.localeCompare(right.fenceId)))
  });
}

module.exports = {
  InventoryReconciliationError,
  RECONCILIATION_VERSION,
  normalizeReconcileRequest,
  planEventReconciliation
};
