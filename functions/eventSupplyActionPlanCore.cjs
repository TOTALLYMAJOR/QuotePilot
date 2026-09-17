"use strict";

const inventory = require("./inventoryIngredientCore.cjs");
const allocation = require("./inventoryIngredientAllocationCore.cjs");
const inventoryAuthority = require("./inventoryAuthority.js");

const SUPPLY_PLAN_SCHEMA_VERSION = 1;
const SUPPLY_PLAN_AUTHORITY_VERSION = "event-supply-action-plan-v1";
const SUPPLY_PLAN_BOUNDARY = "Internal planning evidence only. It does not contact a vendor, create a purchase order or reservation, authorize spend, confirm supply, or change commercial or inventory authority.";
const MAX_EDITS = 100;
const MAX_CONDITIONS = 10;
const SHA256 = /^[a-f0-9]{64}$/u;

class EventSupplyActionPlanError extends Error {
  constructor(code, message) {
    super(message);
    this.name = "EventSupplyActionPlanError";
    this.code = code;
  }
}

function fail(code, message) { throw new EventSupplyActionPlanError(code, message); }
function isRecord(value) { return Boolean(value) && typeof value === "object" && !Array.isArray(value); }
function exact(value, keys, label, code = "invalid-argument") {
  if (!isRecord(value) || Object.keys(value).length !== keys.length || keys.some((key) => !Object.hasOwn(value, key))) {
    fail(code, `${label} contains missing or unsupported fields.`);
  }
}
function boundedText(value, label, maximum, { allowEmpty = false } = {}) {
  if (typeof value !== "string" || value !== value.trim()) fail("invalid-argument", `${label} must be exact text.`);
  const normalized = value.replace(/\s+/gu, " ");
  if ((!allowEmpty && !normalized) || normalized.length > maximum || /[\u0000-\u001f\u007f<>]/u.test(normalized)) {
    fail("invalid-argument", `${label} must be bounded safe text.`);
  }
  return normalized;
}
function fingerprint(value, label) {
  if (typeof value !== "string" || !SHA256.test(value)) fail("invalid-argument", `${label} must be an exact SHA-256 fingerprint.`);
  return value;
}
function planIdFor(organizationId, quoteId) {
  return `esap_${inventory.digest({ organizationId: inventory.opaqueId(organizationId), quoteId: inventory.opaqueId(quoteId) }, "supply plan identity").slice(0, 48)}`;
}
function revisionIdFor(planId, planRevision) {
  return `esapr_${inventory.digest({ planId: inventory.opaqueId(planId), planRevision: inventory.revision(planRevision, "planRevision", { allowZero: false }) }, "supply plan revision identity").slice(0, 48)}`;
}
function receiptIdFor(organizationId, requestId) {
  return `esaprc_${inventory.digest({ organizationId: inventory.opaqueId(organizationId), requestId: inventory.requestId(requestId) }, "supply plan receipt identity").slice(0, 48)}`;
}

function allocationSummary(plan) {
  return {
    state: plan.state,
    eventPlanId: plan.eventPlanId,
    allocationRevision: plan.allocationRevision,
    eventRequirementRevisionId: plan.eventRequirementRevisionId,
    ingredientCount: plan.ingredientCount,
    fullyAllocatedIngredientCount: plan.fullyAllocatedIngredientCount,
    shortageIngredientCount: plan.shortageIngredientCount,
    ingredients: plan.ingredients.map((row) => ({
      ingredientId: row.ingredientId,
      locationId: row.locationId,
      baseUnitId: row.baseUnitId,
      stockRevision: row.stockRevision,
      fenceRevision: row.fenceRevision,
      requiredQuantityMicros: row.requiredQuantityMicros,
      allocatedQuantityMicros: row.allocatedQuantityMicros,
      shortageQuantityMicros: row.shortageQuantityMicros
    }))
  };
}

function sourceFromEvidence(value, identity = {}) {
  if (!isRecord(value)) fail("failed-precondition", "Current supply-plan supporting evidence is unavailable.");
  const plan = allocation.verifyPlan(value.allocationPlan, identity);
  const head = inventoryAuthority.verifyEventRequirementHead(value.requirementHead, {
    organizationId: identity.organizationId, quoteId: identity.quoteId, documentId: identity.quoteId
  });
  const requirementRecord = inventoryAuthority.verifyEventRequirementRecord(value.requirementRecord, {
    organizationId: identity.organizationId,
    quoteId: identity.quoteId,
    eventRequirementRevisionId: plan.eventRequirementRevisionId,
    documentId: plan.eventRequirementRevisionId
  });
  const requirement = requirementRecord.requirement;
  const projection = inventoryAuthority.verifyPersistedEventProjection(value.eventProjection, {
    organizationId: identity.organizationId, quoteId: identity.quoteId, documentId: identity.quoteId
  });
  if (!isRecord(value.quote) || !isRecord(value.quoteVersion) || !isRecord(value.quoteVersion.snapshot)) {
    fail("data-loss", "Current quote revision evidence is malformed.");
  }
  if (value.quote.organizationId !== identity.organizationId
    || value.quoteVersion.organizationId !== identity.organizationId
    || value.quoteVersion.quoteId !== identity.quoteId
    || value.quoteVersion.versionId !== requirement.quoteRevisionId) {
    fail("data-loss", "Pinned quote revision evidence crossed its tenant or quote boundary.");
  }
  const recipeHeads = Array.isArray(value.recipeHeads) ? value.recipeHeads : [];
  const stockStates = Array.isArray(value.stockStates) ? value.stockStates : [];
  const fences = Array.isArray(value.fences) ? value.fences : [];
  if (recipeHeads.length !== requirement.selections.length
    || stockStates.length !== plan.ingredients.length || fences.length !== plan.ingredients.length) {
    fail("failed-precondition", "Current supply-plan supporting evidence is incomplete.");
  }
  const reasons = [];
  const reason = (code) => { if (!reasons.includes(code)) reasons.push(code); };
  if (!new Set(["reserved", "shortage"]).has(plan.state)) reason("allocation_not_live");
  if (head.eventRequirementRevisionId !== plan.eventRequirementRevisionId
    || head.revision !== plan.requirementRevision
    || head.requirementDigest !== plan.requirementDigest
    || head.quoteRevisionId !== requirement.quoteRevisionId
    || requirementRecord.requirementDigest !== plan.requirementDigest) reason("requirement_changed");
  const expectedAllocation = allocationSummary(plan);
  if (projection.freshness !== "as_recorded" || projection.staleReason
    || projection.freshnessState.demand.state !== "current"
    || projection.freshnessState.cost.state !== "current"
    || projection.freshnessState.availability.state !== "current"
    || projection.freshnessState.allocation.state !== "current"
    || projection.quoteRevisionId !== requirement.quoteRevisionId
    || projection.eventRequirementRevisionId !== plan.eventRequirementRevisionId
    || projection.requirementRevision !== plan.requirementRevision
    || projection.requirementDigest !== plan.requirementDigest
    || inventory.canonicalSerialize(projection.allocation) !== inventory.canonicalSerialize(expectedAllocation)) {
    reason("event_projection_changed");
  }
  const activeQuoteRevisionId = value.quote.activeVersionId || value.quote.versionMeta?.versionId || "";
  const snapshot = value.quoteVersion.snapshot;
  const selectedMenuItemIds = Array.isArray(snapshot.selection?.menuItems)
    ? [...snapshot.selection.menuItems].sort() : [];
  const requirementMenuItemIds = requirement.selections.map(({ menuItemId }) => menuItemId).sort();
  if (!new Set(["accepted", "booked"]).has(String(value.quote.status || "").trim().toLowerCase())) reason("quote_not_accepted");
  if (activeQuoteRevisionId !== requirement.quoteRevisionId
    || (snapshot.organizationId && snapshot.organizationId !== identity.organizationId)
    || (snapshot.id && snapshot.id !== identity.quoteId)
    || (snapshot.activeVersionId && snapshot.activeVersionId !== requirement.quoteRevisionId)
    || inventory.canonicalSerialize(selectedMenuItemIds) !== inventory.canonicalSerialize(requirementMenuItemIds)) {
    reason("quote_revision_changed");
  }
  const verifiedRecipeHeads = recipeHeads.map((candidate, index) => {
    const selection = requirement.selections[index];
    if (!candidate) {
      reason("recipe_changed");
      return { missingMenuItemId: selection.menuItemId };
    }
    const verified = inventoryAuthority.verifyRecipeHead(candidate, {
      organizationId: identity.organizationId, menuItemId: selection.menuItemId, documentId: selection.menuItemId
    });
    if (selection.recipeRevisionId === null || verified.recipeRevisionId !== selection.recipeRevisionId
      || verified.recipeDigest !== selection.recipeDigest) reason("recipe_changed");
    return verified;
  });
  const verifiedStockStates = stockStates.map((candidate, index) => {
    const row = plan.ingredients[index];
    if (!candidate) {
      reason("stock_changed");
      return { missingStockStateId: inventory.stockStateId(row.ingredientId, row.locationId) };
    }
    const verified = inventory.verifyStockState(candidate, {
      organizationId: identity.organizationId, ingredientId: row.ingredientId, locationId: row.locationId
    });
    if (verified.revision !== row.stockRevision || verified.baseUnitId !== row.baseUnitId) reason("stock_changed");
    return verified;
  });
  const verifiedFences = fences.map((candidate, index) => {
    const row = plan.ingredients[index];
    if (!candidate) {
      reason("allocation_fence_changed");
      return { missingFenceId: row.fenceId };
    }
    const verified = allocation.verifyFence(candidate, {
      organizationId: identity.organizationId,
      ingredientId: row.ingredientId,
      locationId: row.locationId,
      documentId: row.fenceId
    });
    const active = verified.allocations.find(({ allocationId }) => allocationId === row.allocationId);
    if (verified.revision !== row.fenceRevision || verified.baseUnitId !== row.baseUnitId
      || (row.allocatedQuantityMicros > 0
        ? !active || active.quantityMicros !== row.allocatedQuantityMicros
        : Boolean(active))) reason("allocation_fence_changed");
    return verified;
  });
  const allocationEvidence = {
    eventPlanId: plan.eventPlanId,
    planRevisionId: plan.planRevisionId,
    allocationRevision: plan.allocationRevision,
    eventRequirementRevisionId: plan.eventRequirementRevisionId,
    state: plan.state,
    ingredients: plan.ingredients.map((row) => ({
      ingredientId: row.ingredientId,
      locationId: row.locationId,
      baseUnitId: row.baseUnitId,
      stockRevision: row.stockRevision,
      fenceRevision: row.fenceRevision,
      requiredQuantityMicros: row.requiredQuantityMicros,
      allocatedQuantityMicros: row.allocatedQuantityMicros,
      shortageQuantityMicros: row.shortageQuantityMicros
    }))
  };
  const shortages = allocationEvidence.ingredients
    .filter((row) => row.shortageQuantityMicros > 0)
    .map((row) => ({
      ingredientId: row.ingredientId,
      locationId: row.locationId,
      baseUnitId: row.baseUnitId,
      shortageQuantity: inventory.formatQuantityMicros(row.shortageQuantityMicros),
      shortageQuantityMicros: row.shortageQuantityMicros
    }))
    .sort((a, b) => `${a.ingredientId}\u0000${a.locationId}`.localeCompare(`${b.ingredientId}\u0000${b.locationId}`));
  const allocationFingerprint = inventory.digest(plan, "supply allocation source");
  const shortageFingerprint = inventory.digest(shortages, "supply shortage source");
  const requirementFingerprint = inventory.digest({ head, requirementRecord }, "supply requirement source");
  const eventProjectionFingerprint = inventory.digest(projection, "supply event projection source");
  const quoteRevisionFingerprint = inventory.digest({ quote: value.quote, quoteVersion: value.quoteVersion }, "supply quote revision source");
  const recipeFingerprint = inventory.digest(verifiedRecipeHeads, "supply recipe source");
  const stockFingerprint = inventory.digest(verifiedStockStates, "supply stock source");
  const fenceFingerprint = inventory.digest(verifiedFences, "supply allocation fence source");
  const supportingEvidenceFingerprint = inventory.digest({
    requirementFingerprint, eventProjectionFingerprint, quoteRevisionFingerprint,
    recipeFingerprint, stockFingerprint, fenceFingerprint
  }, "supply supporting evidence source");
  const eligible = reasons.length === 0;
  const sourceFingerprint = inventory.digest({
    allocationFingerprint, shortageFingerprint, supportingEvidenceFingerprint, eligible,
    ineligibilityReasons: reasons
  }, "supply plan source");
  return Object.freeze({
    eventPlanId: plan.eventPlanId,
    planRevisionId: plan.planRevisionId,
    allocationRevision: plan.allocationRevision,
    eventRequirementRevisionId: plan.eventRequirementRevisionId,
    allocationFingerprint,
    shortageFingerprint,
    requirementFingerprint,
    eventProjectionFingerprint,
    quoteRevisionFingerprint,
    recipeFingerprint,
    stockFingerprint,
    fenceFingerprint,
    supportingEvidenceFingerprint,
    eligible,
    ineligibilityReasons: Object.freeze(reasons),
    sourceFingerprint,
    shortages: Object.freeze(shortages)
  });
}

function normalizeEdit(value, shortage, index) {
  exact(value, [
    "ingredientId", "locationId", "baseUnitId", "shortageQuantity", "supplierId",
    "supplierLabel", "purchaseQuantity", "estimatedCostMinor", "currency", "note",
    "conditions", "policyFingerprint", "offerFingerprint"
  ], `Supply plan edit ${index + 1}`);
  if (!shortage || value.ingredientId !== shortage.ingredientId || value.locationId !== shortage.locationId
    || value.baseUnitId !== shortage.baseUnitId || value.shortageQuantity !== shortage.shortageQuantity) {
    fail("aborted", `Supply plan edit ${index + 1} no longer matches the exact shortage evidence.`);
  }
  inventory.parseQuantityMicros(value.purchaseQuantity, `Supply plan edit ${index + 1} purchaseQuantity`);
  if ((value.estimatedCostMinor === null) !== (value.currency === null)
    || (value.estimatedCostMinor !== null && (!Number.isSafeInteger(value.estimatedCostMinor) || value.estimatedCostMinor < 0))
    || (value.currency !== null && !/^[A-Z]{3}$/u.test(value.currency))) {
    fail("invalid-argument", `Supply plan edit ${index + 1} cost must be null or exact non-negative minor-unit money.`);
  }
  if (!Array.isArray(value.conditions) || value.conditions.length > MAX_CONDITIONS) {
    fail("invalid-argument", `Supply plan edit ${index + 1} conditions exceed the bounded contract.`);
  }
  return Object.freeze({
    ingredientId: value.ingredientId,
    locationId: value.locationId,
    baseUnitId: value.baseUnitId,
    shortageQuantity: value.shortageQuantity,
    supplierId: inventory.opaqueId(value.supplierId, `Supply plan edit ${index + 1} supplierId`),
    supplierLabel: boundedText(value.supplierLabel, `Supply plan edit ${index + 1} supplierLabel`, 120),
    purchaseQuantity: inventory.formatQuantityMicros(inventory.parseQuantityMicros(value.purchaseQuantity)),
    estimatedCostMinor: value.estimatedCostMinor,
    currency: value.currency,
    note: boundedText(value.note, `Supply plan edit ${index + 1} note`, 500, { allowEmpty: true }),
    conditions: Object.freeze(value.conditions.map((entry, conditionIndex) => boundedText(
      entry, `Supply plan edit ${index + 1} condition ${conditionIndex + 1}`, 180
    ))),
    policyFingerprint: fingerprint(value.policyFingerprint, `Supply plan edit ${index + 1} policyFingerprint`),
    offerFingerprint: fingerprint(value.offerFingerprint, `Supply plan edit ${index + 1} offerFingerprint`)
  });
}

function normalizeEdits(value, source) {
  if (!Array.isArray(value) || value.length > MAX_EDITS || value.length !== source.shortages.length) {
    fail("invalid-argument", "Supply plan edits must exactly cover the current bounded shortage set.");
  }
  const shortageByKey = new Map(source.shortages.map((row) => [`${row.ingredientId}\u0000${row.locationId}`, row]));
  const edits = value.map((entry, index) => normalizeEdit(
    entry, shortageByKey.get(`${entry?.ingredientId}\u0000${entry?.locationId}`), index
  ));
  if (new Set(edits.map((entry) => `${entry.ingredientId}\u0000${entry.locationId}`)).size !== edits.length) {
    fail("invalid-argument", "Supply plan edits must have unique ingredient and location identities.");
  }
  return Object.freeze(edits.sort((a, b) => `${a.ingredientId}\u0000${a.locationId}`.localeCompare(`${b.ingredientId}\u0000${b.locationId}`)));
}

function normalizeCommand(value, source = null) {
  if (!isRecord(value) || !["save_draft", "approve", "rebase", "cancel"].includes(value.kind)) {
    fail("invalid-argument", "Supply plan command is unsupported.");
  }
  const quoteId = inventory.opaqueId(value.quoteId, "quoteId");
  const expectedPlanRevision = inventory.revision(value.expectedPlanRevision, "expectedPlanRevision");
  if (value.kind === "cancel") {
    exact(value, ["kind", "quoteId", "expectedPlanRevision", "reason"], "Supply plan cancel command");
    return Object.freeze({ kind: value.kind, quoteId, expectedPlanRevision, reason: boundedText(value.reason, "cancel reason", 240) });
  }
  const common = [
    "kind", "quoteId", "expectedPlanRevision", "expectedAllocationFingerprint",
    "expectedShortageFingerprint", "expectedSourceFingerprint"
  ];
  exact(value, value.kind === "approve" ? [...common, "confirmation"] : [...common, "edits"], "Supply plan command");
  if (!source) fail("failed-precondition", "Current allocation evidence is required.");
  if (!source.eligible) fail("aborted", "Supply-plan evidence is no longer current and eligible. Refresh upstream inventory evidence.");
  const normalized = {
    kind: value.kind,
    quoteId,
    expectedPlanRevision,
    expectedAllocationFingerprint: fingerprint(value.expectedAllocationFingerprint, "expectedAllocationFingerprint"),
    expectedShortageFingerprint: fingerprint(value.expectedShortageFingerprint, "expectedShortageFingerprint"),
    expectedSourceFingerprint: fingerprint(value.expectedSourceFingerprint, "expectedSourceFingerprint")
  };
  if (normalized.expectedAllocationFingerprint !== source.allocationFingerprint
    || normalized.expectedShortageFingerprint !== source.shortageFingerprint
    || normalized.expectedSourceFingerprint !== source.sourceFingerprint) {
    fail("aborted", "Supply plan source evidence changed. Refresh before continuing.");
  }
  if (value.kind === "approve") {
    if (value.confirmation !== "approve_internal_supply_plan") fail("invalid-argument", "Supply plan approval requires explicit human confirmation.");
    normalized.confirmation = value.confirmation;
  } else normalized.edits = normalizeEdits(value.edits, source);
  return Object.freeze(normalized);
}

function buildRevision({ organizationId, command, current = null, source, actor, nowISO }) {
  const orgId = inventory.opaqueId(organizationId, "organizationId");
  const recordedAtISO = inventory.exactISO(nowISO, "nowISO");
  const normalizedActor = inventory.normalizeActor(actor, orgId);
  const currentRevision = current?.planRevision || 0;
  if (currentRevision !== command.expectedPlanRevision) fail("aborted", "The internal supply plan changed. Refresh before continuing.");
  if (current?.status === "cancelled") fail("failed-precondition", "A cancelled internal supply plan cannot be changed.");
  let status = current?.status || "draft";
  let edits = current?.edits || [];
  let approvalEvidence = current?.approvalEvidence || null;
  let cancelEvidence = null;
  if (command.kind === "save_draft") {
    if (source.shortages.length === 0) fail("failed-precondition", "There are no current shortages requiring an internal supply plan.");
    status = "draft";
    edits = command.edits;
    approvalEvidence = null;
  } else if (command.kind === "approve") {
    if (!current || current.status !== "draft" || current.source.sourceFingerprint !== source.sourceFingerprint) {
      fail("aborted", "Only the exact current draft may be approved.");
    }
    status = "approved";
    approvalEvidence = Object.freeze({
      confirmation: command.confirmation,
      confirmedAtISO: recordedAtISO,
      confirmedBy: normalizedActor
    });
  } else if (command.kind === "rebase") {
    if (!current) fail("not-found", "Create an internal supply plan before rebasing it.");
    status = "draft";
    edits = command.edits;
    approvalEvidence = null;
  } else {
    if (!current) fail("not-found", "There is no internal supply plan to cancel.");
    status = "cancelled";
    cancelEvidence = Object.freeze({ reason: command.reason, cancelledAtISO: recordedAtISO, cancelledBy: normalizedActor });
  }
  const planRevision = currentRevision + 1;
  const planId = planIdFor(orgId, command.quoteId);
  const revisionSource = command.kind === "cancel" ? current.source : source;
  const resolution = revisionSource.eligible && revisionSource.shortages.length === 0 ? "resolved" : "unresolved";
  const body = {
    authorityVersion: SUPPLY_PLAN_AUTHORITY_VERSION,
    schemaVersion: SUPPLY_PLAN_SCHEMA_VERSION,
    organizationId: orgId,
    quoteId: command.quoteId,
    planId,
    revisionId: revisionIdFor(planId, planRevision),
    planRevision,
    status,
    resolution,
    source: revisionSource,
    edits: Object.freeze(edits),
    approvalEvidence,
    cancelEvidence,
    boundary: SUPPLY_PLAN_BOUNDARY,
    createdAtISO: current?.createdAtISO || recordedAtISO,
    updatedAtISO: recordedAtISO,
    updatedBy: normalizedActor
  };
  return Object.freeze({ ...body, revisionDigest: inventory.digest(body, "supply plan revision") });
}

function verifyRevision(value, identity = {}) {
  exact(value, [
    "authorityVersion", "schemaVersion", "organizationId", "quoteId", "planId", "revisionId",
    "planRevision", "status", "resolution", "source", "edits", "approvalEvidence", "cancelEvidence",
    "boundary", "createdAtISO", "updatedAtISO", "updatedBy", "revisionDigest"
  ], "Supply plan revision", "data-loss");
  const { revisionDigest, ...body } = value;
  exact(value.source, [
    "eventPlanId", "planRevisionId", "allocationRevision", "eventRequirementRevisionId",
    "allocationFingerprint", "shortageFingerprint", "requirementFingerprint",
    "eventProjectionFingerprint", "quoteRevisionFingerprint", "recipeFingerprint",
    "stockFingerprint", "fenceFingerprint", "supportingEvidenceFingerprint", "eligible",
    "ineligibilityReasons", "sourceFingerprint", "shortages"
  ], "Supply plan source", "data-loss");
  if (!Array.isArray(value.source.shortages)) fail("data-loss", "Stored supply plan shortage evidence is invalid.");
  value.source.shortages.forEach((row) => exact(row, [
    "ingredientId", "locationId", "baseUnitId", "shortageQuantity", "shortageQuantityMicros"
  ], "Supply plan shortage", "data-loss"));
  const expectedShortageFingerprint = inventory.digest(value.source.shortages, "supply shortage source");
  const supportingKeys = [
    "requirementFingerprint", "eventProjectionFingerprint", "quoteRevisionFingerprint",
    "recipeFingerprint", "stockFingerprint", "fenceFingerprint"
  ];
  if (supportingKeys.some((key) => !SHA256.test(value.source[key]))
    || typeof value.source.eligible !== "boolean"
    || !Array.isArray(value.source.ineligibilityReasons)
    || value.source.ineligibilityReasons.some((entry) => typeof entry !== "string" || !entry)
    || value.source.eligible !== (value.source.ineligibilityReasons.length === 0)) {
    fail("data-loss", "Stored supply plan supporting evidence is invalid.");
  }
  const expectedSupportingEvidenceFingerprint = inventory.digest(Object.fromEntries(
    supportingKeys.map((key) => [key, value.source[key]])
  ), "supply supporting evidence source");
  const expectedSourceFingerprint = inventory.digest({
    allocationFingerprint: value.source.allocationFingerprint,
    shortageFingerprint: value.source.shortageFingerprint,
    supportingEvidenceFingerprint: value.source.supportingEvidenceFingerprint,
    eligible: value.source.eligible,
    ineligibilityReasons: value.source.ineligibilityReasons
  }, "supply plan source");
  if (value.authorityVersion !== SUPPLY_PLAN_AUTHORITY_VERSION || value.schemaVersion !== 1
    || value.organizationId !== identity.organizationId || value.quoteId !== identity.quoteId
    || value.planId !== planIdFor(value.organizationId, value.quoteId)
    || value.revisionId !== revisionIdFor(value.planId, value.planRevision)
    || !["draft", "approved", "cancelled"].includes(value.status)
    || !["unresolved", "resolved"].includes(value.resolution)
    || !SHA256.test(value.source.allocationFingerprint)
    || value.source.shortageFingerprint !== expectedShortageFingerprint
    || value.source.supportingEvidenceFingerprint !== expectedSupportingEvidenceFingerprint
    || value.source.sourceFingerprint !== expectedSourceFingerprint
    || value.resolution !== (value.source.eligible && value.source.shortages.length === 0 ? "resolved" : "unresolved")
    || value.boundary !== SUPPLY_PLAN_BOUNDARY
    || revisionDigest !== inventory.digest(body, "supply plan revision")) {
    fail("data-loss", "Stored supply plan revision is inconsistent.");
  }
  inventory.revision(value.planRevision, "planRevision", { allowZero: false });
  inventory.revision(value.source.allocationRevision, "allocationRevision", { allowZero: false });
  inventory.opaqueId(value.source.eventPlanId, "eventPlanId");
  inventory.opaqueId(value.source.planRevisionId, "allocation planRevisionId");
  inventory.opaqueId(value.source.eventRequirementRevisionId, "eventRequirementRevisionId");
  normalizeEdits(value.edits, value.source);
  if ((value.status === "draft" && value.approvalEvidence !== null)
    || (value.status === "approved" && !value.approvalEvidence)
    || (value.status !== "cancelled" && value.cancelEvidence !== null)
    || (value.status === "cancelled" && !value.cancelEvidence)) {
    fail("data-loss", "Stored supply plan decision evidence is inconsistent.");
  }
  if (value.approvalEvidence) {
    exact(value.approvalEvidence, ["confirmation", "confirmedAtISO", "confirmedBy"], "Supply plan approval evidence", "data-loss");
    if (value.approvalEvidence.confirmation !== "approve_internal_supply_plan") fail("data-loss", "Stored supply plan approval evidence is invalid.");
    inventory.exactISO(value.approvalEvidence.confirmedAtISO, "confirmedAtISO");
    inventory.normalizeActor(value.approvalEvidence.confirmedBy, value.organizationId);
  }
  if (value.cancelEvidence) {
    exact(value.cancelEvidence, ["reason", "cancelledAtISO", "cancelledBy"], "Supply plan cancellation evidence", "data-loss");
    boundedText(value.cancelEvidence.reason, "cancel reason", 240);
    inventory.exactISO(value.cancelEvidence.cancelledAtISO, "cancelledAtISO");
    inventory.normalizeActor(value.cancelEvidence.cancelledBy, value.organizationId);
  }
  inventory.exactISO(value.createdAtISO, "createdAtISO");
  inventory.exactISO(value.updatedAtISO, "updatedAtISO");
  inventory.normalizeActor(value.updatedBy, value.organizationId);
  return value;
}

function createEventSupplyActionPlanRuntime({
  db, FieldValue, HttpsError, assertStaff, normalizeOrganizationId,
  isOrganizationRecordActive, globalEnabled, logger = { error() {} }, now = () => new Date().toISOString()
}) {
  if (!db || !FieldValue || !HttpsError || typeof assertStaff !== "function") throw new TypeError("Supply plan runtime dependencies are required.");
  const refsFor = (organizationId, quoteId = "") => {
    const organization = db.collection("organizations").doc(organizationId);
    return {
      organization,
      tombstone: db.collection("organizationTombstones").doc(organizationId),
      settings: organization.collection("settings").doc("config"),
      role: (uid) => db.collection("userRoles").doc(uid),
      allocationPlan: quoteId ? organization.collection("eventIngredientPlans").doc(quoteId) : null,
      requirementHead: quoteId ? organization.collection("eventIngredientRequirementHeads").doc(quoteId) : null,
      requirements: quoteId ? organization.collection("eventIngredientRequirements").doc(quoteId) : null,
      eventProjection: quoteId ? organization.collection("eventIngredientProjections").doc(quoteId) : null,
      quote: quoteId ? organization.collection("quotes").doc(quoteId) : null,
      recipeHeads: organization.collection("inventoryRecipeHeads"),
      stockStates: organization.collection("inventoryStockStates"),
      allocationFences: organization.collection("inventoryAllocationFences"),
      supplyPlan: quoteId ? organization.collection("eventSupplyActionPlans").doc(quoteId) : null,
      receipts: organization.collection("eventSupplyActionPlanReceipts")
    };
  };
  const principalFor = (staff, organizationId, mutation) => {
    const principal = {
      uid: inventory.opaqueId(staff?.uid, "actor uid"),
      email: boundedText(staff?.email, "actor email", 254),
      role: boundedText(String(staff?.role || "").trim().toLowerCase(), "actor role", 24),
      organizationId: inventory.opaqueId(normalizeOrganizationId(staff?.principalOrganizationId || staff?.organizationId), "actor organizationId")
    };
    if (principal.organizationId !== organizationId || (mutation ? principal.role !== "admin" : !["admin", "sales"].includes(principal.role))) {
      fail("permission-denied", mutation ? "Supply plan changes require same-tenant administrator authority." : "Supply plan reads require same-tenant staff authority.");
    }
    return principal;
  };
  const assertAuthority = async (tx, refs, principal, mutation) => {
    const [roleSnap, orgSnap, tombstoneSnap, settingsSnap] = await tx.getAll(
      refs.role(principal.uid), refs.organization, refs.tombstone, refs.settings
    );
    const role = roleSnap.data?.() || {};
    const storedEmail = String(role.email || "").trim().toLowerCase();
    if (!roleSnap.exists || !orgSnap.exists || tombstoneSnap.exists || !settingsSnap.exists
      || normalizeOrganizationId(role.organizationId) !== principal.organizationId
      || String(role.role || "").trim().toLowerCase() !== principal.role
      || (storedEmail && storedEmail !== principal.email.toLowerCase())
      || (mutation && principal.role !== "admin")
      || !isOrganizationRecordActive(orgSnap.data() || {})
      || globalEnabled(principal.organizationId) !== true
      || settingsSnap.data()?.inventoryAuthorityEnabled !== true) {
      fail("permission-denied", "Current supply-plan authority is unavailable or changed.");
    }
  };
  const throwFailure = (error, operation) => {
    if (error instanceof HttpsError) throw error;
    if (error instanceof EventSupplyActionPlanError || error instanceof allocation.InventoryAllocationError
      || error instanceof inventory.InventoryIngredientError) throw new HttpsError(error.code, error.message);
    logger.error("Supply plan authority failed.", { operation, errorName: String(error?.name || "Error") });
    throw new HttpsError("internal", "Supply plan authority failed without a confirmed outcome. Retry the same request identity.");
  };

  const loadCurrentSource = async (tx, refs, organizationId, quoteId) => {
    const [allocationSnap, headSnap, projectionSnap, quoteSnap] = await tx.getAll(
      refs.allocationPlan, refs.requirementHead, refs.eventProjection, refs.quote
    );
    if (!allocationSnap.exists || !headSnap.exists || !projectionSnap.exists || !quoteSnap.exists) {
      fail("failed-precondition", "Current allocation, requirement, event projection, and quote evidence are required.");
    }
    const plan = allocation.verifyPlan(allocationSnap.data() || {}, {
      organizationId, quoteId, documentId: allocationSnap.id
    });
    const head = inventoryAuthority.verifyEventRequirementHead(headSnap.data() || {}, {
      organizationId, quoteId, documentId: headSnap.id
    });
    const requirementRef = refs.requirements.collection("revisions").doc(plan.eventRequirementRevisionId);
    const requirementSnap = await tx.get(requirementRef);
    if (!requirementSnap.exists) fail("failed-precondition", "Pinned requirement evidence is required.");
    const requirementRecord = inventoryAuthority.verifyEventRequirementRecord(requirementSnap.data() || {}, {
      organizationId, quoteId, eventRequirementRevisionId: plan.eventRequirementRevisionId, documentId: requirementSnap.id
    });
    const quoteVersionRef = refs.quote.collection("versions").doc(requirementRecord.requirement.quoteRevisionId);
    const quoteVersionSnap = await tx.get(quoteVersionRef);
    if (!quoteVersionSnap.exists) fail("failed-precondition", "Pinned quote revision evidence is required.");
    const recipeHeadRefs = requirementRecord.requirement.selections.map(({ menuItemId }) => refs.recipeHeads.doc(menuItemId));
    const stockRefs = plan.ingredients.map((row) => refs.stockStates.doc(inventory.stockStateId(row.ingredientId, row.locationId)));
    const fenceRefs = plan.ingredients.map((row) => refs.allocationFences.doc(row.fenceId));
    const evidenceSnaps = await tx.getAll(...recipeHeadRefs, ...stockRefs, ...fenceRefs);
    const recipeHeads = evidenceSnaps.slice(0, recipeHeadRefs.length).map((snap) => snap.exists ? snap.data() || {} : null);
    const stockStart = recipeHeadRefs.length;
    const fenceStart = stockStart + stockRefs.length;
    const stockStates = evidenceSnaps.slice(stockStart, fenceStart).map((snap) => snap.exists ? snap.data() || {} : null);
    const fences = evidenceSnaps.slice(fenceStart).map((snap) => snap.exists ? snap.data() || {} : null);
    return sourceFromEvidence({
      allocationPlan: plan,
      requirementHead: head,
      requirementRecord,
      eventProjection: projectionSnap.data() || {},
      quote: quoteSnap.data() || {},
      quoteVersion: quoteVersionSnap.data() || {},
      recipeHeads,
      stockStates,
      fences
    }, { organizationId, quoteId, documentId: allocationSnap.id });
  };

  async function getEventSupplyActionPlan(data = {}, context = {}) {
    try {
      exact(data, ["schemaVersion", "organizationId", "quoteId"], "Supply plan read request");
      if (data.schemaVersion !== 1) fail("invalid-argument", "Supply plan schemaVersion is unsupported.");
      const organizationId = inventory.opaqueId(data.organizationId, "organizationId");
      const quoteId = inventory.opaqueId(data.quoteId, "quoteId");
      const staff = await assertStaff(context, { expectedOrganizationId: organizationId });
      const principal = principalFor(staff, organizationId, false);
      const refs = refsFor(organizationId, quoteId);
      return await db.runTransaction(async (tx) => {
        await assertAuthority(tx, refs, principal, false);
        const supplySnap = await tx.get(refs.supplyPlan);
        const source = await loadCurrentSource(tx, refs, organizationId, quoteId);
        const plan = supplySnap.exists ? verifyRevision(supplySnap.data() || {}, { organizationId, quoteId }) : null;
        const stale = !source.eligible || Boolean(plan && plan.source.sourceFingerprint !== source.sourceFingerprint);
        return Object.freeze({
          ok: true,
          schemaVersion: 1,
          appCheck: context?.app ? "verified" : "monitoring",
          organizationId,
          quoteId,
          source,
          plan,
          stale,
          resolution: !plan ? "not_started" : stale ? "stale" : plan.resolution
        });
      });
    } catch (error) { return throwFailure(error, "getEventSupplyActionPlan"); }
  }

  async function applyEventSupplyActionPlanCommand(data = {}, context = {}) {
    try {
      exact(data, ["schemaVersion", "organizationId", "requestId", "command"], "Supply plan command request");
      if (data.schemaVersion !== 1) fail("invalid-argument", "Supply plan schemaVersion is unsupported.");
      const organizationId = inventory.opaqueId(data.organizationId, "organizationId");
      const requestId = inventory.requestId(data.requestId);
      if (!isRecord(data.command)) fail("invalid-argument", "Supply plan command is required.");
      const quoteId = inventory.opaqueId(data.command.quoteId, "quoteId");
      const staff = await assertStaff(context, { expectedOrganizationId: organizationId });
      const actor = principalFor(staff, organizationId, true);
      const refs = refsFor(organizationId, quoteId);
      const receiptId = receiptIdFor(organizationId, requestId);
      const receiptRef = refs.receipts.doc(receiptId);
      const commandDigest = inventory.digest({ schemaVersion: 1, organizationId, requestId, command: data.command, principal: { uid: actor.uid, organizationId } }, "supply plan command");
      return await db.runTransaction(async (tx) => {
        const receiptSnap = await tx.get(receiptRef);
        await assertAuthority(tx, refs, actor, true);
        if (receiptSnap.exists) {
          const receipt = receiptSnap.data()?.receipt;
          const { receiptDigest, ...receiptBody } = receipt || {};
          if (!receipt || receiptDigest !== inventory.digest(receiptBody, "supply plan receipt")
            || receipt.commandDigest !== commandDigest || receipt.requestId !== requestId
            || receipt.organizationId !== organizationId || receipt.receiptId !== receiptId) {
            fail("already-exists", "This request identity belongs to a different immutable supply plan command.");
          }
          return Object.freeze({
            ...receipt.result,
            appCheck: context?.app ? "verified" : "monitoring",
            idempotent: true,
            receipt: receipt.publicReceipt
          });
        }
        const currentSnap = await tx.get(refs.supplyPlan);
        const source = await loadCurrentSource(tx, refs, organizationId, quoteId);
        const command = normalizeCommand(data.command, source);
        const current = currentSnap.exists ? verifyRevision(currentSnap.data() || {}, { organizationId, quoteId }) : null;
        const revision = buildRevision({ organizationId, command, current, source, actor, nowISO: now() });
        const revisionRef = refs.supplyPlan.collection("revisions").doc(revision.revisionId);
        const revisionSnap = await tx.get(revisionRef);
        if (revisionSnap.exists) fail("data-loss", "Immutable supply plan revision already exists.");
        const publicReceipt = Object.freeze({ schemaVersion: 1, organizationId, receiptId, requestId, commandKind: command.kind, recordedAtISO: revision.updatedAtISO });
        const result = Object.freeze({
          ok: true, schemaVersion: 1, organizationId, quoteId, commandKind: command.kind,
          planRevision: revision.planRevision, revisionId: revision.revisionId, status: revision.status,
          resolution: revision.resolution, sourceFingerprint: revision.source.sourceFingerprint,
          idempotent: false
        });
        const receiptBody = { authorityVersion: SUPPLY_PLAN_AUTHORITY_VERSION, schemaVersion: 1, organizationId, receiptId, requestId, commandDigest, commandKind: command.kind, recordedAtISO: revision.updatedAtISO, recordedBy: actor, result, publicReceipt };
        const receipt = Object.freeze({ ...receiptBody, receiptDigest: inventory.digest(receiptBody, "supply plan receipt") });
        tx.create(revisionRef, revision);
        if (currentSnap.exists) tx.set(refs.supplyPlan, revision); else tx.create(refs.supplyPlan, revision);
        tx.create(receiptRef, { receipt, createdAt: FieldValue.serverTimestamp() });
        return Object.freeze({
          ...result,
          appCheck: context?.app ? "verified" : "monitoring",
          receipt: publicReceipt
        });
      });
    } catch (error) { return throwFailure(error, "applyEventSupplyActionPlanCommand"); }
  }
  return Object.freeze({ getEventSupplyActionPlan, applyEventSupplyActionPlanCommand });
}

module.exports = {
  EventSupplyActionPlanError,
  MAX_CONDITIONS,
  MAX_EDITS,
  SUPPLY_PLAN_AUTHORITY_VERSION,
  SUPPLY_PLAN_BOUNDARY,
  SUPPLY_PLAN_SCHEMA_VERSION,
  buildRevision,
  createEventSupplyActionPlanRuntime,
  normalizeCommand,
  planIdFor,
  receiptIdFor,
  revisionIdFor,
  sourceFromEvidence,
  verifyRevision
};
