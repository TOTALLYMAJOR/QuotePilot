"use strict";

const { createHash } = require("node:crypto");
const { buildStarterCatalogPackDocuments, validateCatalogForConfirmation } = require("./starterCatalogPacks");

const CATALOG_SETUP_DRAFT_SCHEMA_VERSION = 1;
const MAX_CHANGED_RECORDS = 400;
const MAX_CHANGE_BYTES = 30_000;
const MAX_DRAFT_BYTES = 900_000;
const DRAFT_ID = "current";
const DRAFT_MUTATION_RECEIPTS_COLLECTION = "catalogDraftMutationReceipts";
const DRAFT_PUBLICATION_LINEAGES_COLLECTION = "catalogDraftPublicationLineages";
const DRAFT_MUTATION_RECEIPT_KIND = "catalog_setup_draft_mutation";
const DRAFT_PUBLICATION_LINEAGE_KIND = "catalog_setup_draft_publication_lineage";
const MISSING_BASELINE_HASH = "missing";
const CATALOG_COLLECTIONS = Object.freeze([
  "catalogPackages",
  "catalogAddons",
  "catalogRentals",
  "eventTypes",
  "menuCategories",
  "menuItems"
]);
const RECORD_INTENTS = new Set(["create", "update", "deactivate"]);
const PRICING_TYPES = new Set(["per_person", "per_item", "per_event"]);
const MONEY_MAX_MINOR = 100_000_000;
const SETTINGS_AUTHORITY_KEYS = new Set([
  "catalogRevision",
  "pricingSetupConfirmed",
  "pricingConfirmation",
  "pricingSettingsVersion",
  "pricingSettingsUpdatedAtISO",
  "createdAt",
  "createdAtISO",
  "updatedAt",
  "updatedAtISO",
  "organizationId",
  "plan",
  "featureFlagsLocked",
  "featureFlagsPaid",
  "featureFlagsLockReason",
  "featureFlagsLockUpdatedAtISO",
  "orderId",
  "onboarding"
]);
const BUSINESS_METADATA_KEYS = new Set([
  "organizationId",
  "createdAt",
  "createdAtISO",
  "updatedAt",
  "updatedAtISO"
]);

class CatalogSetupDraftError extends Error {
  constructor(code, message, details = undefined) {
    super(message);
    this.name = "CatalogSetupDraftError";
    this.code = code;
    this.details = details;
  }
}

function text(value, maxLength = 500) {
  return String(value ?? "").trim().slice(0, maxLength);
}

function normalizeOrganizationId(value) {
  return text(value, 160)
    .toLowerCase()
    .replace(/[^\w-]+/g, "-")
    .replace(/-{2,}/g, "-")
    .replace(/^-|-$/g, "");
}

function normalizeRequestId(value) {
  const requestId = text(value, 128);
  return /^[A-Za-z0-9_-]{16,128}$/.test(requestId) ? requestId : "";
}

function requireRecordId(value) {
  const id = text(value, 256);
  if (!id || id === "." || id === ".." || id.includes("/")) {
    throw new CatalogSetupDraftError("invalid-argument", "Every catalog draft change needs a valid stable record id.");
  }
  return id;
}

function stableValue(value) {
  if (Array.isArray(value)) return value.map(stableValue);
  if (value && typeof value === "object") {
    return Object.keys(value).sort().reduce((result, key) => {
      if (value[key] !== undefined && typeof value[key] !== "function") {
        result[key] = stableValue(value[key]);
      }
      return result;
    }, {});
  }
  return value;
}

function hashValue(value) {
  return createHash("sha256").update(JSON.stringify(stableValue(value))).digest("hex");
}

function recordBusinessData(value = {}) {
  return Object.keys(value || {}).sort().reduce((result, key) => {
    if (!BUSINESS_METADATA_KEYS.has(key) && value[key] !== undefined && typeof value[key] !== "function") {
      result[key] = stableValue(value[key]);
    }
    return result;
  }, {});
}

function baselineHash(snapshot) {
  return snapshot?.exists
    ? hashValue(recordBusinessData(snapshot.data() || {}))
    : MISSING_BASELINE_HASH;
}

function safeInteger(value, label, { min = 0, max = Number.MAX_SAFE_INTEGER } = {}) {
  const numeric = Number(value);
  if (!Number.isSafeInteger(numeric) || numeric < min || numeric > max) {
    throw new CatalogSetupDraftError("invalid-argument", `${label} is outside the supported integer range.`);
  }
  return numeric;
}

function moneyMinor(value, label, { nullable = false, positive = false } = {}) {
  if (nullable && (value === null || value === "" || value === undefined)) return null;
  const numeric = Number(value);
  if (
    !Number.isSafeInteger(numeric)
    || numeric < 0
    || numeric > MONEY_MAX_MINOR
    || (positive && numeric <= 0)
  ) {
    throw new CatalogSetupDraftError(
      "invalid-argument",
      `${label} must be ${positive ? "a positive" : "a non-negative"} integer minor-unit amount no greater than 100000000.`
    );
  }
  return numeric;
}

function stableIds(value, label) {
  if (!Array.isArray(value)) return [];
  const seen = new Set();
  return value.map((entry) => requireRecordId(entry)).filter((id) => {
    if (seen.has(id)) return false;
    seen.add(id);
    return true;
  }).slice(0, 100);
}

function pricingType(value, fallback = "per_event") {
  const normalized = text(value, 40).toLowerCase();
  return PRICING_TYPES.has(normalized) ? normalized : fallback;
}

function sanitizeSettingsPayload(input = {}) {
  if (!input || typeof input !== "object" || Array.isArray(input)) {
    throw new CatalogSetupDraftError("invalid-argument", "Settings changes must be an object.");
  }
  const payload = stableValue(input);
  SETTINGS_AUTHORITY_KEYS.forEach((key) => {
    if (Object.prototype.hasOwnProperty.call(payload, key)) {
      throw new CatalogSetupDraftError("invalid-argument", `Catalog draft settings cannot change ${key}.`);
    }
  });
  const scalarMoney = [
    ["perMileRateMinor", "perMileRate"],
    ["longDistancePerMileRateMinor", "longDistancePerMileRate"],
    ["bartenderRateMinor", "bartenderRate"],
    ["serverRateMinor", "serverRate"],
    ["chefRateMinor", "chefRate"]
  ];
  scalarMoney.forEach(([minorKey, legacyKey]) => {
    if (Object.prototype.hasOwnProperty.call(payload, legacyKey)) {
      const amount = Number(payload[legacyKey]);
      const scaled = Math.round(amount * 100);
      if (!Number.isFinite(amount) || Math.abs((amount * 100) - scaled) > 1e-8) {
        throw new CatalogSetupDraftError("invalid-argument", `${legacyKey} must have no more than two decimal places.`);
      }
      payload[minorKey] = moneyMinor(scaled, legacyKey);
      delete payload[legacyKey];
    } else if (Object.prototype.hasOwnProperty.call(payload, minorKey)) {
      payload[minorKey] = moneyMinor(payload[minorKey], minorKey);
    }
  });
  if (Object.prototype.hasOwnProperty.call(payload, "bartenderRateTypes")) {
    if (!Array.isArray(payload.bartenderRateTypes)) {
      throw new CatalogSetupDraftError("invalid-argument", "Bartender rate types must be an array.");
    }
    payload.bartenderRateTypes = payload.bartenderRateTypes.map((entry, index) => ({
      id: requireRecordId(entry?.id),
      name: text(entry?.name, 200) || `Bartender rate ${index + 1}`,
      rateMinor: moneyMinor(
        Object.prototype.hasOwnProperty.call(entry || {}, "rateMinor")
          ? entry.rateMinor
          : Math.round(Number(entry?.rate) * 100),
        `Bartender rate ${index + 1}`
      )
    }));
  }
  if (Object.prototype.hasOwnProperty.call(payload, "staffingRateTypes")) {
    if (!Array.isArray(payload.staffingRateTypes)) {
      throw new CatalogSetupDraftError("invalid-argument", "Staffing rate types must be an array.");
    }
    payload.staffingRateTypes = payload.staffingRateTypes.map((entry, index) => ({
      id: requireRecordId(entry?.id),
      name: text(entry?.name, 200) || `Staffing rate ${index + 1}`,
      serverRateMinor: moneyMinor(
        Object.prototype.hasOwnProperty.call(entry || {}, "serverRateMinor")
          ? entry.serverRateMinor
          : Math.round(Number(entry?.serverRate) * 100),
        `Server rate ${index + 1}`
      ),
      chefRateMinor: moneyMinor(
        Object.prototype.hasOwnProperty.call(entry || {}, "chefRateMinor")
          ? entry.chefRateMinor
          : Math.round(Number(entry?.chefRate) * 100),
        `Chef rate ${index + 1}`
      )
    }));
  }
  return payload;
}

function sanitizeRecordPayload(collection, input = {}) {
  const source = input && typeof input === "object" && !Array.isArray(input) ? input : {};
  const name = text(source.name, 300);
  if (!name) throw new CatalogSetupDraftError("invalid-argument", `${collection} records need a name.`);
  if (collection === "catalogPackages") {
    return {
      name,
      pppMinor: moneyMinor(source.pppMinor, "Package price", { positive: true }),
      costPppMinor: moneyMinor(source.costPppMinor, "Package cost", { nullable: true }),
      includedMenuItemIds: stableIds(source.includedMenuItemIds, "includedMenuItemIds"),
      includedAddonIds: stableIds(source.includedAddonIds, "includedAddonIds"),
      includedRentalIds: stableIds(source.includedRentalIds, "includedRentalIds"),
      active: source.active !== false
    };
  }
  if (collection === "catalogAddons") {
    const basis = pricingType(source.pricingType || source.type, "per_person");
    return {
      name,
      priceMinor: moneyMinor(source.priceMinor, "Add-on price"),
      costMinor: moneyMinor(source.costMinor, "Add-on cost", { nullable: true }),
      pricingType: basis,
      type: basis,
      staffRole: ["server", "chef", "bartender"].includes(text(source.staffRole, 40))
        ? text(source.staffRole, 40)
        : "",
      active: source.active !== false,
      portalDecidable: source.portalDecidable === true
    };
  }
  if (collection === "catalogRentals") {
    const basis = pricingType(source.pricingType || source.type, "per_item");
    return {
      name,
      priceMinor: moneyMinor(source.priceMinor, "Rental price"),
      costMinor: moneyMinor(source.costMinor, "Rental cost", { nullable: true }),
      qtyPerGuests: safeInteger(source.qtyPerGuests || 1, "Rental guest quantity", { min: 1, max: 100_000 }),
      pricingType: basis,
      type: basis,
      active: source.active !== false,
      portalDecidable: source.portalDecidable === true
    };
  }
  if (collection === "eventTypes") return { name, active: source.active !== false };
  if (collection === "menuCategories") {
    return {
      name,
      eventTypeId: requireRecordId(source.eventTypeId),
      active: source.active !== false
    };
  }
  if (collection === "menuItems") {
    const basis = pricingType(source.pricingType || source.type, "per_event");
    return {
      name,
      eventTypeId: requireRecordId(source.eventTypeId),
      categoryId: requireRecordId(source.categoryId),
      priceMinor: moneyMinor(source.priceMinor, "Menu item price"),
      costMinor: moneyMinor(source.costMinor, "Menu item cost", { nullable: true }),
      pricingType: basis,
      type: basis,
      active: source.active !== false
    };
  }
  throw new CatalogSetupDraftError("invalid-argument", "Choose a supported catalog collection.");
}

function changeId(collection, recordId) {
  return `${collection}:${recordId}`;
}

function normalizeChange(input = {}) {
  const collection = text(input.collection, 80);
  const isSettings = collection === "settings";
  if (!isSettings && !CATALOG_COLLECTIONS.includes(collection)) {
    throw new CatalogSetupDraftError("invalid-argument", "Choose a supported catalog draft collection.");
  }
  const recordId = isSettings ? "config" : requireRecordId(input.recordId || input.id);
  const intent = isSettings ? "update" : text(input.intent, 30).toLowerCase();
  if (!isSettings && !RECORD_INTENTS.has(intent)) {
    throw new CatalogSetupDraftError("invalid-argument", "Catalog draft intent must be create, update, or deactivate.");
  }
  const payload = isSettings
    ? sanitizeSettingsPayload(input.payload)
    : sanitizeRecordPayload(collection, {
        ...(input.payload || {}),
        ...(intent === "deactivate" ? { active: false } : {})
      });
  const normalized = {
    id: changeId(collection, recordId),
    collection,
    recordId,
    intent,
    payload
  };
  if (Buffer.byteLength(JSON.stringify(normalized), "utf8") > MAX_CHANGE_BYTES) {
    throw new CatalogSetupDraftError("resource-exhausted", `Catalog draft change ${normalized.id} is too large.`);
  }
  return normalized;
}

function normalizeChanges(changes = []) {
  if (!Array.isArray(changes) || changes.length === 0) {
    throw new CatalogSetupDraftError("invalid-argument", "At least one catalog draft change is required.");
  }
  if (changes.length > MAX_CHANGED_RECORDS) {
    throw new CatalogSetupDraftError("resource-exhausted", `Catalog publication is limited to ${MAX_CHANGED_RECORDS} changed records.`);
  }
  const byId = new Map();
  changes.forEach((entry) => {
    const change = normalizeChange(entry);
    byId.set(change.id, change);
  });
  return [...byId.values()].sort((left, right) => left.id.localeCompare(right.id));
}

function currentRevision(settings = {}) {
  return safeInteger(settings.catalogRevision || 0, "Catalog revision");
}

function buildPublishedReadiness(projected = {}, { revision, confirmedAtISO } = {}) {
  const settings = projected.settings || {};
  const collections = projected.collections || {};
  const activeEntries = (name) => (collections[name] || []).filter((entry) => entry.data?.active !== false);
  const positivePackage = activeEntries("catalogPackages").some((entry) => (
    Boolean(text(entry.data?.name)) && Number(entry.data?.pppMinor) > 0
  ));
  const eventAndMenu = activeEntries("eventTypes").some((entry) => Boolean(text(entry.data?.name)))
    && activeEntries("menuItems").length > 0;
  const percentagesValid = ["serviceFeePct", "taxRate", "depositPct"].every((key) => (
    Number.isFinite(Number(settings[key])) && Number(settings[key]) >= 0 && Number(settings[key]) <= 1
  ));
  const policyMoneyValid = [
    ["perMileRateMinor", "perMileRate"],
    ["longDistancePerMileRateMinor", "longDistancePerMileRate"],
    ["serverRateMinor", "serverRate"],
    ["chefRateMinor", "chefRate"],
    ["bartenderRateMinor", "bartenderRate"]
  ].every(([minorKey, legacyKey]) => {
    const value = Object.prototype.hasOwnProperty.call(settings, minorKey)
      ? Number(settings[minorKey])
      : Number(settings[legacyKey]) * 100;
    return Number.isSafeInteger(value) && value >= 0 && value <= MONEY_MAX_MINOR;
  });
  const businessReady = positivePackage && eventAndMenu && percentagesValid && policyMoneyValid;
  const costEntries = [
    ...activeEntries("catalogPackages").map((entry) => entry.data?.costPppMinor),
    ...activeEntries("catalogAddons").map((entry) => entry.data?.costMinor),
    ...activeEntries("catalogRentals").map((entry) => entry.data?.costMinor),
    ...activeEntries("menuItems").map((entry) => entry.data?.costMinor)
  ];
  if (settings.staffingLaborEnabled !== false) {
    costEntries.push(settings.serverCostRateMinor, settings.chefCostRateMinor, settings.bartenderCostRateMinor);
  }
  const costRecordedCount = costEntries.filter((value) => Number.isSafeInteger(Number(value)) && Number(value) >= 0).length;
  const marginComplete = costEntries.length > 0 && costRecordedCount === costEntries.length;
  const projection = (id, ready, reasonCode, blocking, nextAction) => ({
    id,
    ready,
    reasonCode,
    evidenceAt: confirmedAtISO || null,
    blocking,
    nextAction
  });
  return {
    catalogRevision: Number(revision),
    businessReadyToQuote: projection(
      "business-ready-to-quote",
      businessReady,
      !positivePackage ? "positive_package_required"
        : !eventAndMenu ? "event_type_and_menu_required"
          : !percentagesValid || !policyMoneyValid ? "pricing_policy_invalid" : "ready",
      true,
      { route: businessReady ? "opportunities/new" : "library", label: businessReady ? "Start a quote" : "Review setup" }
    ),
    catalogDraftReadyToPublish: projection("catalog-draft-ready-to-publish", false, "no_publishable_changes", false, { route: "library", label: "Continue setup" }),
    quoteDraftReadyToSave: projection("quote-draft-ready-to-save", false, "quote_context_not_open", false, { route: "opportunities", label: "Open a quote" }),
    proposalReadyToSend: projection("proposal-ready-to-send", false, "proposal_context_not_open", false, { route: "opportunities", label: "Review a proposal" }),
    marginEvidenceComplete: {
      ...projection("margin-evidence-complete", marginComplete, marginComplete ? "ready" : "cost_evidence_missing", false, { route: "library", label: "Record missing costs" }),
      recordedCount: costRecordedCount,
      totalCount: costEntries.length
    },
    providerConnectionReady: projection("provider-connection-ready", false, "connection_state_not_evaluated", false, { route: "settings/connections", label: "Review connections" })
  };
}

function draftProjection(draft = null) {
  if (!draft || draft.state !== "open") {
    return {
      schemaVersion: CATALOG_SETUP_DRAFT_SCHEMA_VERSION,
      state: "empty",
      baseCatalogRevision: null,
      generation: 0,
      changedRecordCount: 0,
      changes: []
    };
  }
  return {
    schemaVersion: CATALOG_SETUP_DRAFT_SCHEMA_VERSION,
    state: "open",
    baseCatalogRevision: Number(draft.baseCatalogRevision),
    generation: Number(draft.generation),
    changedRecordCount: Number(draft.changedRecordCount || 0),
    actor: draft.actor || null,
    createdAtISO: text(draft.createdAtISO),
    updatedAtISO: text(draft.updatedAtISO),
    changes: Array.isArray(draft.changes) ? draft.changes : []
  };
}

function actorProjection({ actorUid = "", actorEmail = "" } = {}) {
  return {
    uid: text(actorUid, 160),
    email: text(actorEmail, 320).toLowerCase()
  };
}

function createDraftSessionId({ organizationId, baseCatalogRevision, openingRequestId }) {
  return hashValue({
    schemaVersion: CATALOG_SETUP_DRAFT_SCHEMA_VERSION,
    kind: "catalog_setup_draft_session",
    organizationId,
    baseCatalogRevision,
    openingRequestId
  });
}

function normalizeDraftSessionId(value) {
  const id = text(value, 64).toLowerCase();
  return /^[a-f0-9]{64}$/.test(id) ? id : "";
}

function draftMutationRequestHash({
  organizationId,
  requestId,
  actorUid,
  expectedGeneration,
  baseCatalogRevision,
  changes
}) {
  return hashValue({
    schemaVersion: CATALOG_SETUP_DRAFT_SCHEMA_VERSION,
    kind: DRAFT_MUTATION_RECEIPT_KIND,
    organizationId,
    requestId,
    actorUid,
    expectedGeneration,
    baseCatalogRevision,
    changes
  });
}

function draftMutationConflict(message = "This request id is already bound to another catalog draft mutation.") {
  return new CatalogSetupDraftError("failed-precondition", message);
}

function compatibleStagedIntent(requestedIntent, stagedIntent) {
  return requestedIntent === stagedIntent || stagedIntent === "create";
}

function payloadMatches(actual = {}, expected = {}) {
  if (!actual || typeof actual !== "object" || Array.isArray(actual)) return false;
  return Object.entries(expected || {}).every(([key, value]) => (
    Object.prototype.hasOwnProperty.call(actual, key)
    && hashValue({ value: actual[key] }) === hashValue({ value })
  ));
}

function buildDraftMutationReceipt({
  organizationId,
  requestId,
  actor,
  requestHash,
  expectedGeneration,
  baseCatalogRevision,
  draftSessionId,
  draftGeneration,
  resultingDraftChangedRecordCount,
  requestedChanges,
  stagedChangesById,
  nowISO,
  serverTimestamp
}) {
  const changes = requestedChanges.map((requested) => {
    const staged = stagedChangesById.get(requested.id);
    if (
      !staged
      || staged.collection !== requested.collection
      || staged.recordId !== requested.recordId
      || !compatibleStagedIntent(requested.intent, staged.intent)
      || hashValue(staged.payload) !== hashValue(requested.payload)
    ) {
      throw draftMutationConflict("The accepted catalog draft no longer contains the exact requested patch set.");
    }
    return {
      id: requested.id,
      collection: requested.collection,
      recordId: requested.recordId,
      requestedIntent: requested.intent,
      stagedIntent: staged.intent,
      payload: requested.payload
    };
  });
  const receipt = {
    schemaVersion: CATALOG_SETUP_DRAFT_SCHEMA_VERSION,
    kind: DRAFT_MUTATION_RECEIPT_KIND,
    requestId,
    organizationId,
    actor,
    requestHash,
    expectedGeneration,
    baseCatalogRevision,
    draftSessionId,
    draftGeneration,
    resultingDraftChangedRecordCount,
    requestedChangeCount: changes.length,
    changes,
    stagedAtISO: nowISO,
    ...(serverTimestamp ? { createdAt: serverTimestamp() } : {})
  };
  if (Buffer.byteLength(JSON.stringify(receipt), "utf8") > MAX_DRAFT_BYTES) {
    throw new CatalogSetupDraftError("resource-exhausted", "The exact catalog draft mutation receipt is too large.");
  }
  return receipt;
}

function requestedChangesFromReceipt(receipt = {}) {
  if (!Array.isArray(receipt.changes)) return [];
  return receipt.changes.map((change) => ({
    id: change.id,
    collection: change.collection,
    recordId: change.recordId,
    intent: change.requestedIntent,
    payload: change.payload
  }));
}

function assertDraftMutationReceiptBinding({
  receipt,
  organizationId,
  requestId,
  actorUid,
  expectedGeneration,
  baseCatalogRevision,
  requestHash,
  requestedChanges
}) {
  const storedChanges = requestedChangesFromReceipt(receipt);
  const storedChangesValid = Array.isArray(receipt?.changes)
    && receipt.changes.every((change) => (
      text(change?.id, 600) === changeId(text(change?.collection, 80), text(change?.recordId, 256))
      && (change.collection === "settings" || CATALOG_COLLECTIONS.includes(change.collection))
      && RECORD_INTENTS.has(change.requestedIntent)
      && RECORD_INTENTS.has(change.stagedIntent)
      && compatibleStagedIntent(change.requestedIntent, change.stagedIntent)
      && change.payload
      && typeof change.payload === "object"
      && !Array.isArray(change.payload)
    ));
  if (
    receipt?.schemaVersion !== CATALOG_SETUP_DRAFT_SCHEMA_VERSION
    || receipt?.kind !== DRAFT_MUTATION_RECEIPT_KIND
    || receipt?.organizationId !== organizationId
    || receipt?.requestId !== requestId
    || text(receipt?.actor?.uid, 160) !== actorUid
    || receipt?.requestHash !== requestHash
    || Number(receipt?.expectedGeneration) !== expectedGeneration
    || Number(receipt?.baseCatalogRevision) !== baseCatalogRevision
    || !normalizeDraftSessionId(receipt?.draftSessionId)
    || !Number.isSafeInteger(Number(receipt?.draftGeneration))
    || Number(receipt?.draftGeneration) !== expectedGeneration + 1
    || !Number.isSafeInteger(Number(receipt?.resultingDraftChangedRecordCount))
    || Number(receipt?.resultingDraftChangedRecordCount) < requestedChanges.length
    || Number(receipt?.requestedChangeCount) !== requestedChanges.length
    || !storedChangesValid
    || storedChanges.length !== requestedChanges.length
    || hashValue(storedChanges) !== hashValue(requestedChanges)
  ) {
    throw draftMutationConflict();
  }
}

function draftContainsMutationReceipt(draft, receipt) {
  if (
    draft?.state !== "open"
    || normalizeDraftSessionId(draft.draftSessionId) !== normalizeDraftSessionId(receipt.draftSessionId)
    || Number(draft.baseCatalogRevision) !== Number(receipt.baseCatalogRevision)
  ) return false;
  const currentById = new Map((draft.changes || []).map((change) => [change.id, change]));
  return receipt.changes.every((expected) => {
    const current = currentById.get(expected.id);
    return Boolean(current)
      && current.collection === expected.collection
      && current.recordId === expected.recordId
      && current.intent === expected.stagedIntent
      && hashValue(current.payload) === hashValue(expected.payload);
  });
}

function publicationLineageContainsMutation(lineage, receipt) {
  const revisionBefore = Number(lineage?.catalogRevisionBefore);
  const revisionAfter = Number(lineage?.catalogRevisionAfter);
  const draftGeneration = Number(lineage?.draftGeneration);
  if (
    lineage?.schemaVersion !== CATALOG_SETUP_DRAFT_SCHEMA_VERSION
    || lineage?.kind !== DRAFT_PUBLICATION_LINEAGE_KIND
    || lineage?.organizationId !== receipt.organizationId
    || normalizeDraftSessionId(lineage?.draftSessionId) !== normalizeDraftSessionId(receipt.draftSessionId)
    || !Number.isSafeInteger(revisionBefore)
    || revisionBefore !== Number(receipt.baseCatalogRevision)
    || !Number.isSafeInteger(revisionAfter)
    || revisionAfter !== revisionBefore + 1
    || !Number.isSafeInteger(draftGeneration)
    || draftGeneration < Number(receipt.draftGeneration)
    || !Number.isSafeInteger(Number(lineage?.changedRecordCount))
    || Number(lineage.changedRecordCount) < Number(receipt.requestedChangeCount)
    || !Array.isArray(lineage?.changes)
  ) return false;
  const publishedById = new Map((lineage.changes || []).map((change) => [change.id, change]));
  return receipt.changes.every((expected) => {
    const published = publishedById.get(expected.id);
    return Boolean(published)
      && published.collection === expected.collection
      && published.recordId === expected.recordId
      && published.intent === expected.stagedIntent
      && published.publishedHash === hashValue(expected.payload);
  });
}

function draftMutationReceiptProjection(receipt, status, lineage = null) {
  return {
    schemaVersion: CATALOG_SETUP_DRAFT_SCHEMA_VERSION,
    requestId: receipt.requestId,
    status,
    organizationId: receipt.organizationId,
    actor: receipt.actor || null,
    draftSessionId: normalizeDraftSessionId(receipt.draftSessionId),
    baseCatalogRevision: Number(receipt.baseCatalogRevision),
    expectedGeneration: Number(receipt.expectedGeneration),
    draftGeneration: Number(receipt.draftGeneration),
    resultingDraftChangedRecordCount: Number(receipt.resultingDraftChangedRecordCount || 0),
    requestedChangeCount: Number(receipt.requestedChangeCount || 0),
    stagedAtISO: text(receipt.stagedAtISO),
    changes: (receipt.changes || []).map((change) => ({
      id: change.id,
      collection: change.collection,
      recordId: change.recordId,
      requestedIntent: change.requestedIntent,
      intent: change.stagedIntent,
      payload: change.payload
    })),
    ...(status === "published" && lineage
      ? {
          publicationReceiptId: text(lineage.publicationReceiptId),
          catalogRevisionAfter: Number(lineage.catalogRevisionAfter),
          publishedAtISO: text(lineage.publishedAtISO)
        }
      : {})
  };
}

function draftSaveResult({ receipt, status, currentDraft, currentCatalogRevision, idempotentReplay, lineage = null }) {
  return {
    ok: true,
    idempotentReplay,
    mutationStatus: status,
    organizationId: receipt.organizationId,
    currentCatalogRevision: Number(currentCatalogRevision),
    draft: draftProjection(currentDraft),
    mutationReceipt: draftMutationReceiptProjection(receipt, status, lineage)
  };
}

async function reconcileDraftMutationReceipt({ transaction, refs, receipt, currentDraft, settings }) {
  const revision = currentRevision(settings);
  if (revision === Number(receipt.baseCatalogRevision)) {
    if (draftContainsMutationReceipt(currentDraft, receipt)) {
      return { status: "staged", lineage: null };
    }
    throw draftMutationConflict("The exact accepted mutation is no longer present in the current catalog draft.");
  }
  if (revision < Number(receipt.baseCatalogRevision)) {
    throw draftMutationConflict("The catalog revision is older than the accepted mutation receipt.");
  }

  const lineageRef = refs.publicationLineageCollection.doc(receipt.draftSessionId);
  const lineageSnap = await transaction.get(lineageRef);
  const lineage = lineageSnap.exists ? lineageSnap.data() || {} : null;
  if (
    !publicationLineageContainsMutation(lineage, receipt)
    || Number(lineage.catalogRevisionAfter) > revision
  ) {
    throw draftMutationConflict("The exact accepted mutation cannot be reconciled to a catalog publication.");
  }
  const activeSnapshots = await Promise.all(receipt.changes.map((change) => (
    change.collection === "settings"
      ? null
      : transaction.get(recordRef(refs.organizationRef, change))
  )));
  const exactMutationIsActive = receipt.changes.every((change, index) => {
    if (change.collection === "settings") return payloadMatches(settings, change.payload);
    const snapshot = activeSnapshots[index];
    return snapshot?.exists && payloadMatches(snapshot.data() || {}, change.payload);
  });
  if (!exactMutationIsActive) {
    throw draftMutationConflict("The accepted mutation was published, but its exact values are no longer active.");
  }
  return { status: "published", lineage };
}

function refsForOrganization(db, organizationId) {
  const organizationRef = db.collection("organizations").doc(organizationId);
  return {
    organizationRef,
    settingsRef: organizationRef.collection("settings").doc("config"),
    draftRef: organizationRef.collection("catalogSetupDrafts").doc(DRAFT_ID),
    receiptCollection: organizationRef.collection("catalogPublicationReceipts"),
    mutationReceiptCollection: organizationRef.collection(DRAFT_MUTATION_RECEIPTS_COLLECTION),
    publicationLineageCollection: organizationRef.collection(DRAFT_PUBLICATION_LINEAGES_COLLECTION)
  };
}

function recordRef(organizationRef, change) {
  return change.collection === "settings"
    ? organizationRef.collection("settings").doc("config")
    : organizationRef.collection(change.collection).doc(change.recordId);
}

function assertDraftFence({ draft, settings, expectedGeneration, baseCatalogRevision }) {
  if (!draft || draft.state !== "open") {
    throw new CatalogSetupDraftError("failed-precondition", "No open catalog setup draft is available.");
  }
  if (Number(draft.generation) !== Number(expectedGeneration)) {
    throw new CatalogSetupDraftError("aborted", "Catalog draft generation changed on another device.", {
      expectedGeneration: Number(expectedGeneration),
      currentGeneration: Number(draft.generation)
    });
  }
  if (
    Number(draft.baseCatalogRevision) !== Number(baseCatalogRevision)
    || currentRevision(settings) !== Number(baseCatalogRevision)
  ) {
    throw new CatalogSetupDraftError("aborted", "Catalog revision changed while this draft was open.", {
      baseCatalogRevision: Number(baseCatalogRevision),
      currentCatalogRevision: currentRevision(settings)
    });
  }
}

async function readCatalogTransaction(transaction, refs) {
  const collectionRefs = Object.fromEntries(
    CATALOG_COLLECTIONS.map((name) => [name, refs.organizationRef.collection(name)])
  );
  const [draftSnap, settingsSnap, ...snapshots] = await Promise.all([
    transaction.get(refs.draftRef),
    transaction.get(refs.settingsRef),
    ...CATALOG_COLLECTIONS.map((name) => transaction.get(collectionRefs[name]))
  ]);
  if (!settingsSnap.exists) {
    throw new CatalogSetupDraftError("failed-precondition", "Organization catalog settings are missing.");
  }
  const collections = Object.fromEntries(snapshots.map((snapshot, index) => [
    CATALOG_COLLECTIONS[index],
    snapshot.docs.map((doc) => ({ id: doc.id, data: doc.data() || {}, ref: doc.ref }))
  ]));
  return {
    draft: draftSnap.exists ? draftSnap.data() || {} : null,
    settings: settingsSnap.data() || {},
    collections
  };
}

function projectCatalog({ settings, collections, changes }) {
  const projectedSettings = { ...settings };
  const maps = Object.fromEntries(CATALOG_COLLECTIONS.map((name) => [
    name,
    new Map((collections[name] || []).map((entry) => [entry.id, { ...entry, data: { ...entry.data } }]))
  ]));
  const diffs = [];
  changes.forEach((change) => {
    if (change.collection === "settings") {
      const before = recordBusinessData(projectedSettings);
      const existingHash = hashValue(before);
      if (existingHash !== change.baselineHash) {
        throw new CatalogSetupDraftError("aborted", "Catalog settings changed after this draft began.", {
          changeId: change.id,
          expectedBaselineHash: change.baselineHash,
          currentBaselineHash: existingHash
        });
      }
      Object.assign(projectedSettings, change.payload);
      diffs.push({ ...change, before, after: recordBusinessData(projectedSettings) });
      return;
    }
    const collection = maps[change.collection];
    const existing = collection.get(change.recordId);
    const existingHash = existing ? hashValue(recordBusinessData(existing.data)) : MISSING_BASELINE_HASH;
    if (existingHash !== change.baselineHash) {
      throw new CatalogSetupDraftError("aborted", `Catalog record ${change.id} changed after this draft began.`, {
        changeId: change.id,
        expectedBaselineHash: change.baselineHash,
        currentBaselineHash: existingHash
      });
    }
    if (change.intent === "create" && existing) {
      throw new CatalogSetupDraftError("already-exists", `Catalog record ${change.id} already exists.`);
    }
    if (change.intent !== "create" && !existing) {
      throw new CatalogSetupDraftError("failed-precondition", `Catalog record ${change.id} no longer exists.`);
    }
    const nextData = existing
      ? { ...existing.data, ...change.payload }
      : { ...change.payload };
    collection.set(change.recordId, {
      id: change.recordId,
      data: nextData,
      ref: existing?.ref || null
    });
    diffs.push({
      ...change,
      before: existing ? recordBusinessData(existing.data) : null,
      after: recordBusinessData(nextData)
    });
  });
  const projectedCollections = Object.fromEntries(CATALOG_COLLECTIONS.map((name) => [
    name,
    [...maps[name].values()]
  ]));
  validateCatalogForConfirmation({
    settings: projectedSettings,
    collections: projectedCollections
  });
  return { settings: projectedSettings, collections: projectedCollections, diffs };
}

async function getCatalogSetupDraft({ db, organizationId = "" } = {}) {
  const normalizedOrganizationId = normalizeOrganizationId(organizationId);
  if (!db || !normalizedOrganizationId) {
    throw new CatalogSetupDraftError("invalid-argument", "db and organizationId are required.");
  }
  const refs = refsForOrganization(db, normalizedOrganizationId);
  const [draftSnap, settingsSnap] = await Promise.all([refs.draftRef.get(), refs.settingsRef.get()]);
  if (!settingsSnap.exists) {
    throw new CatalogSetupDraftError("failed-precondition", "Organization catalog settings are missing.");
  }
  return {
    ok: true,
    organizationId: normalizedOrganizationId,
    currentCatalogRevision: currentRevision(settingsSnap.data() || {}),
    draft: draftProjection(draftSnap.exists ? draftSnap.data() || {} : null)
  };
}

async function saveCatalogSetupDraft({
  db,
  organizationId = "",
  requestId = "",
  expectedGeneration = 0,
  baseCatalogRevision,
  patches = [],
  setupPreset = null,
  actorUid = "",
  actorEmail = "",
  serverTimestamp = null,
  nowISO = new Date().toISOString()
} = {}) {
  const normalizedOrganizationId = normalizeOrganizationId(organizationId);
  const normalizedRequestId = normalizeRequestId(requestId);
  const generationFence = safeInteger(expectedGeneration, "Expected draft generation");
  const revisionFence = safeInteger(baseCatalogRevision, "Base catalog revision");
  const preset = setupPreset && typeof setupPreset === "object"
    ? buildStarterCatalogPackDocuments(setupPreset.packId, {
        packVersion: setupPreset.packVersion,
        nowISO,
        actorUid
      })
    : null;
  const presetPatches = preset ? [
    { collection: "settings", recordId: "config", intent: "update", payload: preset.controlledSettings },
    ...CATALOG_COLLECTIONS.flatMap((collection) => (
      (preset.collections[collection] || []).map((entry) => ({
        collection,
        recordId: entry.id,
        intent: "create",
        payload: entry.data
      }))
    ))
  ] : [];
  const changes = normalizeChanges([...presetPatches, ...(Array.isArray(patches) ? patches : [])]);
  const actor = actorProjection({ actorUid, actorEmail });
  if (!db || !normalizedOrganizationId || !normalizedRequestId || !actor.uid) {
    throw new CatalogSetupDraftError("invalid-argument", "Organization, request id, and actor are required.");
  }
  const requestHash = draftMutationRequestHash({
    organizationId: normalizedOrganizationId,
    requestId: normalizedRequestId,
    actorUid: actor.uid,
    expectedGeneration: generationFence,
    baseCatalogRevision: revisionFence,
    changes
  });
  const refs = refsForOrganization(db, normalizedOrganizationId);
  const mutationReceiptRef = refs.mutationReceiptCollection.doc(normalizedRequestId);
  return db.runTransaction(async (transaction) => {
    const [mutationReceiptSnap, draftSnap, settingsSnap] = await Promise.all([
      transaction.get(mutationReceiptRef),
      transaction.get(refs.draftRef),
      transaction.get(refs.settingsRef)
    ]);
    if (!settingsSnap.exists) {
      throw new CatalogSetupDraftError("failed-precondition", "Organization catalog settings are missing.");
    }
    const settings = settingsSnap.data() || {};
    const stored = draftSnap.exists ? draftSnap.data() || {} : null;
    const open = stored?.state === "open" ? stored : null;
    const currentGeneration = open ? Number(open.generation || 0) : 0;

    if (mutationReceiptSnap.exists) {
      const mutationReceipt = mutationReceiptSnap.data() || {};
      assertDraftMutationReceiptBinding({
        receipt: mutationReceipt,
        organizationId: normalizedOrganizationId,
        requestId: normalizedRequestId,
        actorUid: actor.uid,
        expectedGeneration: generationFence,
        baseCatalogRevision: revisionFence,
        requestHash,
        requestedChanges: changes
      });
      const reconciliation = await reconcileDraftMutationReceipt({
        transaction,
        refs,
        receipt: mutationReceipt,
        currentDraft: stored,
        settings
      });
      return draftSaveResult({
        receipt: mutationReceipt,
        status: reconciliation.status,
        currentDraft: stored,
        currentCatalogRevision: currentRevision(settings),
        idempotentReplay: true,
        lineage: reconciliation.lineage
      });
    }

    // Safely adopt the exact final-request replay of a draft created before
    // durable mutation receipts were introduced. No payload-blind fallback is
    // permitted: actor, fences, and every staged field must still match.
    if (open?.lastRequestId === normalizedRequestId) {
      const openById = new Map((open.changes || []).map((change) => [change.id, change]));
      const exactLegacyReplay = currentRevision(settings) === revisionFence
        && Number(open.baseCatalogRevision) === revisionFence
        && currentGeneration === generationFence + 1
        && text(open.actor?.uid, 160) === actor.uid
        && changes.every((change) => {
          const staged = openById.get(change.id);
          return Boolean(staged)
            && staged.collection === change.collection
            && staged.recordId === change.recordId
            && compatibleStagedIntent(change.intent, staged.intent)
            && hashValue(staged.payload) === hashValue(change.payload);
        });
      if (!exactLegacyReplay) throw draftMutationConflict();
      const draftSessionId = normalizeDraftSessionId(open.draftSessionId) || createDraftSessionId({
        organizationId: normalizedOrganizationId,
        baseCatalogRevision: revisionFence,
        openingRequestId: normalizedRequestId
      });
      const adoptedDraft = open.draftSessionId ? open : { ...open, draftSessionId };
      const mutationReceipt = buildDraftMutationReceipt({
        organizationId: normalizedOrganizationId,
        requestId: normalizedRequestId,
        actor,
        requestHash,
        expectedGeneration: generationFence,
        baseCatalogRevision: revisionFence,
        draftSessionId,
        draftGeneration: currentGeneration,
        resultingDraftChangedRecordCount: Number(open.changedRecordCount || 0),
        requestedChanges: changes,
        stagedChangesById: openById,
        nowISO,
        serverTimestamp
      });
      if (!open.draftSessionId) transaction.set(refs.draftRef, adoptedDraft, { merge: false });
      transaction.create(mutationReceiptRef, mutationReceipt);
      return draftSaveResult({
        receipt: mutationReceipt,
        status: "staged",
        currentDraft: adoptedDraft,
        currentCatalogRevision: currentRevision(settings),
        idempotentReplay: true
      });
    }

    if (currentRevision(settings) !== revisionFence) {
      throw new CatalogSetupDraftError("aborted", "Catalog revision changed before the draft could sync.", {
        currentCatalogRevision: currentRevision(settings)
      });
    }
    if (currentGeneration !== generationFence) {
      throw new CatalogSetupDraftError("aborted", "Catalog draft generation changed on another device.", {
        expectedGeneration: generationFence,
        currentGeneration
      });
    }
    if (open && Number(open.baseCatalogRevision) !== revisionFence) {
      throw new CatalogSetupDraftError("aborted", "Catalog draft is based on another catalog revision.");
    }

    const existingById = new Map((open?.changes || []).map((change) => [change.id, change]));
    const newChanges = changes.filter((change) => !existingById.has(change.id));
    const newSnapshots = await Promise.all(newChanges.map((change) => (
      transaction.get(recordRef(refs.organizationRef, change))
    )));
    newChanges.forEach((change, index) => {
      const snapshot = newSnapshots[index];
      if (change.intent === "create" && snapshot.exists) {
        throw new CatalogSetupDraftError("already-exists", `Catalog record ${change.id} already exists.`);
      }
      if (change.intent !== "create" && !snapshot.exists) {
        throw new CatalogSetupDraftError("failed-precondition", `Catalog record ${change.id} does not exist.`);
      }
      change.baselineHash = baselineHash(snapshot);
    });
    changes.forEach((change) => {
      const previous = existingById.get(change.id);
      existingById.set(change.id, {
        ...change,
        baselineHash: previous?.baselineHash || change.baselineHash,
        intent: previous?.intent === "create" ? "create" : change.intent
      });
    });
    const mergedChanges = [...existingById.values()].sort((left, right) => left.id.localeCompare(right.id));
    if (mergedChanges.length > MAX_CHANGED_RECORDS) {
      throw new CatalogSetupDraftError("resource-exhausted", `Catalog publication is limited to ${MAX_CHANGED_RECORDS} changed records.`);
    }
    if (Buffer.byteLength(JSON.stringify(mergedChanges), "utf8") > MAX_DRAFT_BYTES) {
      throw new CatalogSetupDraftError("resource-exhausted", "Catalog setup draft is too large.");
    }
    const draftSessionId = normalizeDraftSessionId(open?.draftSessionId) || createDraftSessionId({
      organizationId: normalizedOrganizationId,
      baseCatalogRevision: revisionFence,
      openingRequestId: normalizedRequestId
    });
    const next = {
      schemaVersion: CATALOG_SETUP_DRAFT_SCHEMA_VERSION,
      state: "open",
      draftSessionId,
      baseCatalogRevision: revisionFence,
      generation: currentGeneration + 1,
      changedRecordCount: mergedChanges.length,
      changes: mergedChanges,
      actor,
      createdAtISO: open?.createdAtISO || nowISO,
      updatedAtISO: nowISO,
      lastRequestId: normalizedRequestId,
      ...(serverTimestamp
        ? { createdAt: open?.createdAt || serverTimestamp(), updatedAt: serverTimestamp() }
        : {})
    };
    const mutationReceipt = buildDraftMutationReceipt({
      organizationId: normalizedOrganizationId,
      requestId: normalizedRequestId,
      actor,
      requestHash,
      expectedGeneration: generationFence,
      baseCatalogRevision: revisionFence,
      draftSessionId,
      draftGeneration: next.generation,
      resultingDraftChangedRecordCount: mergedChanges.length,
      requestedChanges: changes,
      stagedChangesById: existingById,
      nowISO,
      serverTimestamp
    });
    transaction.set(refs.draftRef, next, { merge: false });
    transaction.create(mutationReceiptRef, mutationReceipt);
    return draftSaveResult({
      receipt: mutationReceipt,
      status: "staged",
      currentDraft: next,
      currentCatalogRevision: currentRevision(settings),
      idempotentReplay: false
    });
  });
}

async function reviewCatalogSetupDraft({
  db,
  organizationId = "",
  expectedGeneration,
  baseCatalogRevision
} = {}) {
  const normalizedOrganizationId = normalizeOrganizationId(organizationId);
  if (!db || !normalizedOrganizationId) {
    throw new CatalogSetupDraftError("invalid-argument", "db and organizationId are required.");
  }
  const refs = refsForOrganization(db, normalizedOrganizationId);
  return db.runTransaction(async (transaction) => {
    const active = await readCatalogTransaction(transaction, refs);
    assertDraftFence({
      draft: active.draft,
      settings: active.settings,
      expectedGeneration,
      baseCatalogRevision
    });
    const projected = projectCatalog({
      settings: active.settings,
      collections: active.collections,
      changes: active.draft.changes || []
    });
    return {
      ok: true,
      organizationId: normalizedOrganizationId,
      baseCatalogRevision: Number(baseCatalogRevision),
      generation: Number(expectedGeneration),
      changedRecordCount: projected.diffs.length,
      readyToPublish: projected.diffs.length > 0,
      diffs: projected.diffs
    };
  });
}

function publicationResult(receipt = {}, { idempotentReplay = false } = {}) {
  return {
    ok: true,
    idempotentReplay,
    organizationId: text(receipt.organizationId),
    receiptId: text(receipt.receiptId),
    draftSessionId: normalizeDraftSessionId(receipt.draftSessionId),
    catalogRevisionBefore: Number(receipt.catalogRevisionBefore),
    catalogRevisionAfter: Number(receipt.catalogRevisionAfter),
    changedRecordCount: Number(receipt.changedRecordCount || 0),
    changedCounts: receipt.changedCounts || {},
    confirmationActor: receipt.confirmationActor || null,
    confirmedAtISO: text(receipt.confirmedAtISO),
    readiness: receipt.readiness || null
  };
}

async function publishCatalogSetupDraft({
  db,
  organizationId = "",
  requestId = "",
  expectedGeneration,
  baseCatalogRevision,
  actorUid = "",
  actorEmail = "",
  serverTimestamp = null,
  deleteField = null,
  nowISO = new Date().toISOString()
} = {}) {
  const normalizedOrganizationId = normalizeOrganizationId(organizationId);
  const normalizedRequestId = normalizeRequestId(requestId);
  if (!db || !normalizedOrganizationId || !normalizedRequestId || !text(actorUid) || !text(actorEmail)) {
    throw new CatalogSetupDraftError("invalid-argument", "Organization, request id, and attributed actor are required.");
  }
  const refs = refsForOrganization(db, normalizedOrganizationId);
  const receiptRef = refs.receiptCollection.doc(normalizedRequestId);
  return db.runTransaction(async (transaction) => {
    const receiptSnap = await transaction.get(receiptRef);
    if (receiptSnap.exists) return publicationResult(receiptSnap.data() || {}, { idempotentReplay: true });
    const active = await readCatalogTransaction(transaction, refs);
    assertDraftFence({
      draft: active.draft,
      settings: active.settings,
      expectedGeneration,
      baseCatalogRevision
    });
    const changes = active.draft.changes || [];
    if (changes.length === 0 || changes.length > MAX_CHANGED_RECORDS) {
      throw new CatalogSetupDraftError("failed-precondition", "Catalog setup draft has no publishable changes.");
    }
    const projected = projectCatalog({
      settings: active.settings,
      collections: active.collections,
      changes
    });
    const revisionBefore = currentRevision(active.settings);
    const revisionAfter = revisionBefore + 1;
    const draftSessionId = normalizeDraftSessionId(active.draft.draftSessionId) || createDraftSessionId({
      organizationId: normalizedOrganizationId,
      baseCatalogRevision: revisionBefore,
      openingRequestId: normalizeRequestId(active.draft.lastRequestId) || hashValue(active.draft.changes || [])
    });
    const publicationChanges = changes.map((change) => ({
      id: change.id,
      collection: change.collection,
      recordId: change.recordId,
      intent: change.intent,
      baselineHash: change.baselineHash,
      publishedHash: hashValue(change.payload)
    }));
    const changedCounts = {};
    changes.forEach((change) => {
      changedCounts[change.collection] = Number(changedCounts[change.collection] || 0) + 1;
    });
    const publicationLineage = {
      schemaVersion: CATALOG_SETUP_DRAFT_SCHEMA_VERSION,
      kind: DRAFT_PUBLICATION_LINEAGE_KIND,
      draftSessionId,
      organizationId: normalizedOrganizationId,
      publicationReceiptId: normalizedRequestId,
      draftGeneration: Number(expectedGeneration),
      catalogRevisionBefore: revisionBefore,
      catalogRevisionAfter: revisionAfter,
      changedRecordCount: changes.length,
      changes: publicationChanges,
      publishedAtISO: nowISO,
      ...(serverTimestamp ? { createdAt: serverTimestamp() } : {})
    };
    transaction.create(refs.publicationLineageCollection.doc(draftSessionId), publicationLineage);
    changes.forEach((change) => {
      if (change.collection === "settings") return;
      transaction.set(recordRef(refs.organizationRef, change), {
        ...change.payload,
        updatedAtISO: nowISO,
        ...(serverTimestamp ? { updatedAt: serverTimestamp() } : {}),
        ...(change.intent === "create"
          ? {
              createdAtISO: nowISO,
              ...(serverTimestamp ? { createdAt: serverTimestamp() } : {})
            }
          : {})
      }, { merge: true });
    });
    const settingsChange = changes.find((change) => change.collection === "settings");
    const settingsPatch = { ...(settingsChange?.payload || {}) };
    if (deleteField) {
      [
        ["perMileRateMinor", "perMileRate"],
        ["longDistancePerMileRateMinor", "longDistancePerMileRate"],
        ["bartenderRateMinor", "bartenderRate"],
        ["serverRateMinor", "serverRate"],
        ["chefRateMinor", "chefRate"]
      ].forEach(([minorKey, legacyKey]) => {
        if (Object.prototype.hasOwnProperty.call(settingsPatch, minorKey)) settingsPatch[legacyKey] = deleteField();
      });
    }
    const confirmationActor = {
      uid: text(actorUid, 160),
      email: text(actorEmail, 320).toLowerCase()
    };
    const readiness = buildPublishedReadiness(projected, {
      revision: revisionAfter,
      confirmedAtISO: nowISO
    });
    transaction.set(refs.settingsRef, {
      ...settingsPatch,
      catalogRevision: revisionAfter,
      pricingSetupConfirmed: true,
      pricingSettingsVersion: Math.max(0, Number(active.settings.pricingSettingsVersion || 0)) + 1,
      pricingSettingsUpdatedAtISO: nowISO,
      pricingConfirmation: {
        actorUid: confirmationActor.uid,
        actorEmail: confirmationActor.email,
        confirmedAtISO: nowISO,
        confirmedCatalogRevision: revisionAfter
      },
      updatedAtISO: nowISO,
      ...(serverTimestamp ? { updatedAt: serverTimestamp() } : {})
    }, { merge: true });
    const receipt = {
      schemaVersion: CATALOG_SETUP_DRAFT_SCHEMA_VERSION,
      receiptId: normalizedRequestId,
      organizationId: normalizedOrganizationId,
      draftId: DRAFT_ID,
      draftSessionId,
      draftGeneration: Number(expectedGeneration),
      catalogRevisionBefore: revisionBefore,
      catalogRevisionAfter: revisionAfter,
      changedRecordCount: changes.length,
      changedCounts,
      changes: publicationChanges,
      confirmationActor,
      confirmedAtISO: nowISO,
      readiness,
      ...(serverTimestamp ? { createdAt: serverTimestamp() } : {})
    };
    transaction.create(receiptRef, receipt);
    transaction.set(refs.draftRef, {
      ...active.draft,
      draftSessionId,
      state: "published",
      publishedCatalogRevision: revisionAfter,
      publicationReceiptId: normalizedRequestId,
      publishedAtISO: nowISO,
      ...(serverTimestamp ? { publishedAt: serverTimestamp(), updatedAt: serverTimestamp() } : {})
    }, { merge: false });
    return publicationResult(receipt);
  });
}

module.exports = {
  CATALOG_COLLECTIONS,
  CATALOG_SETUP_DRAFT_SCHEMA_VERSION,
  CatalogSetupDraftError,
  DRAFT_ID,
  MAX_CHANGED_RECORDS,
  MISSING_BASELINE_HASH,
  draftProjection,
  getCatalogSetupDraft,
  hashValue,
  normalizeChange,
  normalizeChanges,
  projectCatalog,
  publishCatalogSetupDraft,
  recordBusinessData,
  reviewCatalogSetupDraft,
  sanitizeSettingsPayload,
  saveCatalogSetupDraft
};
