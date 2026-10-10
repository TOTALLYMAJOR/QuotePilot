"use strict";

const { createHash } = require("node:crypto");

const KITCHEN_BEO_ARTIFACT_NODE_ID = "artifact.kitchen_beo";
const KITCHEN_BEO_ARTIFACT_TYPE = "kitchen_beo";
const KITCHEN_BEO_INPUT_SCHEMA_VERSION = "kitchen-beo-input-v1";
const KITCHEN_BEO_INPUT_SCHEMA_VERSION_WITH_OPERATIONAL_NOTES = "kitchen-beo-input-v2";
const KITCHEN_BEO_CANONICAL_SCHEMA_VERSION = "qp-canonical-json-v1";
const KITCHEN_BEO_GENERATION_REQUEST_SCHEMA_VERSION =
  "kitchen-beo-generation-request-v1";
const KITCHEN_BEO_GENERATION_RECEIPT_SCHEMA_VERSION =
  "kitchen-beo-generation-receipt-v1";
const KITCHEN_BEO_STATUS_SCHEMA_VERSION = "kitchen-beo-artifact-status-v1";
const KITCHEN_BEO_MAX_ARTIFACT_BYTES = 700_000;

const KITCHEN_BEO_FRESHNESS_STATES = Object.freeze({
  CURRENT: "CURRENT",
  STALE: "STALE",
  REVIEW: "REVIEW",
  NOT_GENERATED: "NOT_GENERATED",
  UNKNOWN: "UNKNOWN"
});

// This is the versioned BEO adapter contract, not a second dependency graph.
// Parity tests bind it to the existing browser adapter and the injected graph.
const KITCHEN_BEO_DECLARED_INPUT_NODE_IDS = Object.freeze([
  "fact.customer.day_of_contact",
  "fact.event.date",
  "fact.event.dietary_constraints",
  "fact.event.duration",
  "fact.event.guest_count",
  "fact.event.name",
  "fact.event.service_style",
  "fact.event.time",
  "fact.event.venue",
  "fact.operations.checkpoint_overrides",
  "fact.operations.production_checklist",
  "fact.operations.staff_lead",
  "fact.organization.day_of_contact",
  "fact.quote.identity",
  "fact.selection.addons",
  "fact.selection.menu",
  "fact.selection.package",
  "fact.selection.rentals",
  "fact.staffing.counts"
]);

const PRODUCTION_CHECKLIST_ITEMS = Object.freeze([
  { id: "event-brief", label: "Event brief reviewed", group: "Plan" },
  { id: "guest-count", label: "Final guest count confirmed", group: "Plan" },
  { id: "dietary-review", label: "Dietary and allergen notes reviewed", group: "Plan" },
  { id: "menu-prep", label: "Menu prep plan completed", group: "Kitchen" },
  { id: "equipment-plan", label: "Rental and equipment plan confirmed", group: "Logistics" },
  { id: "staffing-plan", label: "Staffing lead and assignments confirmed", group: "Team" },
  { id: "pack-out", label: "Pack and load-out completed", group: "Logistics" },
  { id: "venue-setup", label: "Venue setup completed", group: "Service" },
  { id: "service-handoff", label: "Service handoff completed", group: "Service" },
  { id: "closeout", label: "Event closeout completed", group: "Closeout" }
]);

class KitchenBeoAuthorityError extends Error {
  constructor(code, message, details = {}) {
    super(message);
    this.name = "KitchenBeoAuthorityError";
    this.code = code;
    this.details = details;
  }
}

function fail(code, message, details = {}) {
  throw new KitchenBeoAuthorityError(code, message, details);
}

function isRecord(value) {
  if (!value || typeof value !== "object" || Array.isArray(value)) return false;
  const prototype = Object.getPrototypeOf(value);
  return prototype === Object.prototype || prototype === null;
}

function deepFreeze(value, seen = new WeakSet()) {
  if (!value || typeof value !== "object" || seen.has(value)) return value;
  seen.add(value);
  Reflect.ownKeys(value).forEach((key) => deepFreeze(value[key], seen));
  return Object.freeze(value);
}

function cleanText(value, fallback = "") {
  const normalized = String(value ?? "").trim();
  return normalized || fallback;
}

function compareText(left, right) {
  return left < right ? -1 : left > right ? 1 : 0;
}

function toNumber(value, fallback = 0) {
  const number = Number(value);
  return Number.isFinite(number) ? number : fallback;
}

function toPositiveInteger(value) {
  const number = Number(value);
  return Number.isSafeInteger(number) && number > 0 ? number : 0;
}

function versionNumberFromId(value) {
  const match = /^v0*(\d+)$/i.exec(cleanText(value));
  return match ? toPositiveInteger(match[1]) : 0;
}

function toList(input) {
  return Array.isArray(input)
    ? input.map((item) => String(item ?? "").trim()).filter(Boolean)
    : [];
}

function normalizeOperationalNotesProjection(projection, sourceRevisionId) {
  if (projection == null) return null;
  if (
    !isRecord(projection)
    || projection.schemaVersion !== "event-operational-notes-beo-v1"
    || cleanText(projection.sourceRevisionId) !== sourceRevisionId
    || !Number.isSafeInteger(projection.journalRevision)
    || projection.journalRevision < 1
    || !Array.isArray(projection.notes)
    || projection.notes.length < 1
    || projection.notes.length > 12
  ) {
    fail(
      "failed-precondition",
      "Operational notes are not bound to the active Kitchen BEO source revision."
    );
  }
  const seen = new Set();
  const notes = projection.notes.map((note) => {
    if (!isRecord(note)) {
      fail("failed-precondition", "Kitchen BEO operational note evidence is invalid.");
    }
    const noteId = exactOpaqueId(note.noteId, "operational note id", 160);
    const type = cleanText(note.type).toLowerCase();
    const text = cleanText(note.text);
    if (
      seen.has(noteId)
      || !["kitchen", "venue", "service", "staffing"].includes(type)
      || !text
      || text.length > 800
      || /[\u0000-\u0008\u000B\u000C\u000E-\u001F\u007F]/u.test(text)
    ) {
      fail("failed-precondition", "Kitchen BEO operational note evidence is invalid.");
    }
    seen.add(noteId);
    return { noteId, type, text };
  });
  return {
    schemaVersion: "event-operational-notes-beo-v1",
    sourceRevisionId,
    journalRevision: projection.journalRevision,
    notes
  };
}

function exactOpaqueId(value, label, maximum = 256) {
  const normalized = cleanText(value);
  if (
    !normalized
    || normalized.length > maximum
    || /[\s/?#\\\u0000]/u.test(normalized)
    || normalized === "."
    || normalized === ".."
    || /^[^@\s]+@[^@\s]+$/.test(normalized)
  ) {
    fail("invalid-argument", `${label} must be an exact opaque identifier.`);
  }
  return normalized;
}

function exactRequestId(value) {
  const normalized = cleanText(value);
  if (!/^[A-Za-z0-9_-]{1,160}$/.test(normalized)) {
    fail("invalid-argument", "Kitchen BEO requestId is invalid.");
  }
  return normalized;
}

function exactISO(value, label) {
  const normalized = cleanText(value);
  const parsed = new Date(normalized);
  if (!normalized || Number.isNaN(parsed.getTime()) || parsed.toISOString() !== normalized) {
    fail("failed-precondition", `${label} must be an exact server ISO timestamp.`);
  }
  return normalized;
}

function normalizeActor(actor) {
  if (!isRecord(actor)) {
    fail("failed-precondition", "Kitchen BEO server actor is required.");
  }
  const uid = cleanText(actor.uid);
  const email = cleanText(actor.email).toLowerCase();
  const role = cleanText(actor.role).toLowerCase();
  if (!uid || uid.length > 128 || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
    fail("failed-precondition", "Kitchen BEO server actor identity is invalid.");
  }
  if (!["admin", "sales"].includes(role)) {
    fail("permission-denied", "Kitchen BEO generation requires a staff actor.");
  }
  return { uid, email, role };
}

function sha256Hex(value) {
  return createHash("sha256").update(value).digest("hex");
}

function assertGraphCore(graphCore) {
  if (
    !isRecord(graphCore)
    || !isRecord(graphCore.COMMERCIAL_DEPENDENCY_GRAPH_V1)
    || typeof graphCore.canonicalSerialize !== "function"
    || typeof graphCore.validateCommercialDependencyGraph !== "function"
  ) {
    fail(
      "failed-precondition",
      "The canonical Commercial Dependency Graph core must be injected."
    );
  }
  graphCore.validateCommercialDependencyGraph(
    graphCore.COMMERCIAL_DEPENDENCY_GRAPH_V1
  );
  return graphCore;
}

function collectUpstreamNodeIds(nodesById, nodeId, visited = new Set()) {
  const node = nodesById.get(nodeId);
  if (!node) return visited;
  node.dependsOn.forEach((dependencyId) => {
    if (visited.has(dependencyId)) return;
    visited.add(dependencyId);
    collectUpstreamNodeIds(nodesById, dependencyId, visited);
  });
  return visited;
}

function assertKitchenBeoGraphContract(graphCore) {
  const core = assertGraphCore(graphCore);
  const registry = core.COMMERCIAL_DEPENDENCY_GRAPH_V1;
  const nodesById = new Map(registry.nodes.map((node) => [node.id, node]));
  const artifactNode = nodesById.get(KITCHEN_BEO_ARTIFACT_NODE_ID);
  if (!artifactNode || artifactNode.kind !== "artifact") {
    fail(
      "failed-precondition",
      `Commercial dependency graph is missing ${KITCHEN_BEO_ARTIFACT_NODE_ID}.`
    );
  }
  const upstream = collectUpstreamNodeIds(
    nodesById,
    KITCHEN_BEO_ARTIFACT_NODE_ID
  );
  KITCHEN_BEO_DECLARED_INPUT_NODE_IDS.forEach((nodeId) => {
    const node = nodesById.get(nodeId);
    if (!node || node.kind !== "fact" || !upstream.has(nodeId)) {
      fail(
        "failed-precondition",
        `Kitchen BEO declared input is not a graph fact dependency: ${nodeId}.`
      );
    }
  });
  return registry;
}

function parseTimeToMinutes(value) {
  const normalized = cleanText(value);
  if (!/^\d{1,2}:\d{2}$/.test(normalized)) return null;
  const [hoursRaw, minutesRaw] = normalized.split(":");
  const hours = Number(hoursRaw);
  const minutes = Number(minutesRaw);
  if (
    !Number.isFinite(hours)
    || !Number.isFinite(minutes)
    || hours < 0
    || hours > 23
    || minutes < 0
    || minutes > 59
  ) return null;
  return (hours * 60) + minutes;
}

function formatClock(minutesInDay) {
  const normalized = ((minutesInDay % 1440) + 1440) % 1440;
  const hours24 = Math.floor(normalized / 60);
  const minutes = normalized % 60;
  const suffix = hours24 >= 12 ? "PM" : "AM";
  const hours12 = hours24 % 12 || 12;
  return `${hours12}:${String(minutes).padStart(2, "0")} ${suffix}`;
}

function formatCheckpointTime(totalMinutes) {
  const dayOffset = Math.floor(totalMinutes / 1440);
  const label = formatClock(totalMinutes);
  if (dayOffset === -1) return `${label} (prev day)`;
  if (dayOffset === 1) return `${label} (next day)`;
  if (dayOffset < -1 || dayOffset > 1) {
    return `${label} (${dayOffset > 0 ? `+${dayOffset}` : dayOffset} days)`;
  }
  return label;
}

function formatMinutesToTimeInput(totalMinutes) {
  const normalized = ((Math.round(totalMinutes) % 1440) + 1440) % 1440;
  const hours = Math.floor(normalized / 60);
  const minutes = normalized % 60;
  return `${String(hours).padStart(2, "0")}:${String(minutes).padStart(2, "0")}`;
}

function buildKitchenCheckpoints({ time, hours, kitchenCheckpointOverrides }) {
  const startMinutes = parseTimeToMinutes(time);
  if (startMinutes === null) return [];
  const durationMinutes = Math.max(60, Math.round(toNumber(hours) * 60));
  const defaults = [
    { id: "prep-start", label: "Prep kickoff", minuteOffset: -180 },
    { id: "line-check", label: "Line check", minuteOffset: -120 },
    { id: "pack-out", label: "Pack and load-out", minuteOffset: -60 },
    { id: "onsite-setup", label: "On-site setup", minuteOffset: -30 },
    { id: "service-start", label: "Service start", minuteOffset: 0 },
    { id: "service-end", label: "Service wrap", minuteOffset: durationMinutes },
    { id: "reset", label: "Kitchen reset", minuteOffset: durationMinutes + 45 }
  ];
  const overrides = Array.isArray(kitchenCheckpointOverrides)
    ? kitchenCheckpointOverrides
    : [];
  const overrideById = new Map(
    overrides
      .map((item) => ({
        id: cleanText(item?.id),
        label: cleanText(item?.label),
        minuteOffset: Number(item?.minuteOffset)
      }))
      .filter((item) => item.id && Number.isFinite(item.minuteOffset))
      .map((item) => [item.id, item])
  );
  return defaults.map((item) => {
    const override = overrideById.get(item.id);
    const minuteOffset = override
      ? Math.round(override.minuteOffset)
      : item.minuteOffset;
    const minute = startMinutes + minuteOffset;
    return {
      id: item.id,
      label: override?.label ? override.label.slice(0, 80) : item.label,
      minute,
      minuteOffset,
      timeLabel: formatCheckpointTime(minute),
      timeValue: formatMinutesToTimeInput(minute)
    };
  });
}

function buildProductionChecklistByPhase(quote) {
  const persisted = Array.isArray(quote.booking?.productionChecklist)
    ? quote.booking.productionChecklist
    : [];
  const persistedById = new Map(
    persisted
      .filter((item) => Boolean(cleanText(item?.id)))
      .map((item) => [cleanText(item.id), item])
  );
  const groups = [];
  const groupIndexByName = new Map();
  PRODUCTION_CHECKLIST_ITEMS.forEach((definition) => {
    const stored = persistedById.get(definition.id) || {};
    const item = {
      id: definition.id,
      label: definition.label,
      completed: stored.completed === true,
      completedAtISO: cleanText(stored.completedAtISO),
      completedByEmail: cleanText(stored.completedByEmail)
    };
    if (!groupIndexByName.has(definition.group)) {
      groupIndexByName.set(definition.group, groups.length);
      groups.push({ group: definition.group, items: [] });
    }
    groups[groupIndexByName.get(definition.group)].items.push(item);
  });
  return groups;
}

function resolveKitchenBeoCommercialSourceRevision(quote = {}) {
  const activeVersionId = cleanText(quote.activeVersionId);
  const versionMetaId = cleanText(quote.versionMeta?.versionId);
  const versionMetaNumber = toPositiveInteger(quote.versionMeta?.versionNumber);
  const latestVersionNumber = toPositiveInteger(quote.latestVersionNumber);
  let id = "legacy-unversioned";
  let number = 0;
  let createdAtISO = "";
  if (activeVersionId) {
    const metadataMatches = versionMetaId === activeVersionId;
    id = activeVersionId;
    number = metadataMatches
      ? versionMetaNumber || versionNumberFromId(activeVersionId)
      : versionNumberFromId(activeVersionId);
    createdAtISO = metadataMatches ? cleanText(quote.versionMeta?.createdAt) : "";
  } else if (versionMetaId) {
    id = versionMetaId;
    number = versionMetaNumber || versionNumberFromId(versionMetaId);
    createdAtISO = cleanText(quote.versionMeta?.createdAt);
  } else {
    number = latestVersionNumber || versionMetaNumber;
    if (number > 0) id = `legacy-version-${number}`;
  }
  return {
    id,
    number,
    createdAtISO,
    createdOn: createdAtISO.length >= 10 ? createdAtISO.slice(0, 10) : "-"
  };
}

function buildCanonicalKitchenBeoPayload(quote, operationalNotes = null) {
  if (!isRecord(quote)) {
    fail("invalid-argument", "Canonical quote data is required for Kitchen BEO generation.");
  }
  const sourceRevision = resolveKitchenBeoCommercialSourceRevision(quote);
  const notes = normalizeOperationalNotesProjection(operationalNotes, sourceRevision.id);
  const payload = {
    quoteNumber: cleanText(quote.quoteNumber),
    organizationName: cleanText(quote.quoteMeta?.organizationName),
    version: sourceRevision,
    contacts: {
      clientName: cleanText(quote.customer?.name),
      clientPhone: cleanText(quote.customer?.phone),
      businessPhone: cleanText(quote.quoteMeta?.businessPhone)
    },
    event: {
      name: cleanText(quote.event?.name),
      date: cleanText(quote.event?.date),
      time: cleanText(quote.event?.time),
      venue: cleanText(quote.event?.venue),
      venueAddress: cleanText(quote.event?.venueAddress),
      guests: toNumber(quote.event?.guests, 0),
      hours: toNumber(quote.event?.hours, 0),
      style: cleanText(quote.event?.style),
      dietaryRestrictions: cleanText(quote.event?.dietaryRestrictions)
    },
    staffing: {
      servers: toNumber(quote.event?.servers, 0),
      chefs: toNumber(quote.event?.chefs, 0),
      bartenders: toNumber(quote.event?.bartenders, 0),
      staffLead: cleanText(quote.booking?.staffLead)
    },
    selections: {
      packageName: cleanText(quote.selection?.packageName),
      menuItemNames: toList(quote.selection?.menuItemNames),
      addons: toList(quote.selection?.addons),
      rentals: toList(quote.selection?.rentals)
    },
    checkpoints: buildKitchenCheckpoints({
      time: quote.event?.time,
      hours: quote.event?.hours,
      kitchenCheckpointOverrides: quote.booking?.kitchenCheckpoints
    }),
    productionChecklist: buildProductionChecklistByPhase(quote)
  };
  if (notes) payload.operationalNotes = notes;
  return deepFreeze(payload);
}

function normalizeKitchenBeoFingerprintInputs(payload) {
  if (!isRecord(payload)) {
    fail("invalid-argument", "Canonical Kitchen BEO payload is required.");
  }
  return Object.fromEntries(
    Object.entries(payload).filter(([key]) => (
      !["version", "fingerprint", "dependencyFingerprint"].includes(key)
    ))
  );
}

function createKitchenBeoFingerprint(payload, graphCore) {
  const registry = assertKitchenBeoGraphContract(graphCore);
  const fingerprintSchemaVersion = isRecord(payload?.operationalNotes)
    ? KITCHEN_BEO_INPUT_SCHEMA_VERSION_WITH_OPERATIONAL_NOTES
    : KITCHEN_BEO_INPUT_SCHEMA_VERSION;
  const document = {
    artifactType: KITCHEN_BEO_ARTIFACT_TYPE,
    fingerprintSchemaVersion,
    declaredNodeIds: [...KITCHEN_BEO_DECLARED_INPUT_NODE_IDS],
    graphVersion: registry.graphVersion,
    inputs: normalizeKitchenBeoFingerprintInputs(payload)
  };
  const canonical = graphCore.canonicalSerialize(document);
  return deepFreeze({
    artifactType: KITCHEN_BEO_ARTIFACT_TYPE,
    artifactNodeId: KITCHEN_BEO_ARTIFACT_NODE_ID,
    declaredNodeIds: [...KITCHEN_BEO_DECLARED_INPUT_NODE_IDS],
    canonicalSchemaVersion: KITCHEN_BEO_CANONICAL_SCHEMA_VERSION,
    fingerprintSchemaVersion,
    graphId: registry.graphId,
    graphVersion: registry.graphVersion,
    dependencyFingerprint: sha256Hex(Buffer.from(canonical, "utf8"))
  });
}

function trustedScope({ canonicalQuote, trustedContext }) {
  if (!isRecord(canonicalQuote)) {
    fail("failed-precondition", "Canonical quote data is required.");
  }
  if (!isRecord(trustedContext)) {
    fail("failed-precondition", "Trusted Kitchen BEO context is required.");
  }
  const organizationId = exactOpaqueId(
    trustedContext.organizationId,
    "organizationId"
  );
  const quoteId = exactOpaqueId(trustedContext.quoteId, "quoteId");
  if (cleanText(canonicalQuote.organizationId) !== organizationId) {
    fail("permission-denied", "Canonical quote is outside the trusted organization.");
  }
  if (canonicalQuote.id && cleanText(canonicalQuote.id) !== quoteId) {
    fail("permission-denied", "Canonical quote identity does not match the trusted quote.");
  }
  return { organizationId, quoteId };
}

function receiptIdentity({ organizationId, quoteId, requestId }, graphCore) {
  const canonical = graphCore.canonicalSerialize({
    schemaVersion: KITCHEN_BEO_GENERATION_RECEIPT_SCHEMA_VERSION,
    organizationId,
    quoteId,
    requestId,
    artifactType: KITCHEN_BEO_ARTIFACT_TYPE
  });
  return `beo_${sha256Hex(Buffer.from(canonical, "utf8")).slice(0, 48)}`;
}

function buildKitchenBeoGenerationClaim({
  canonicalQuote,
  operationalNotes = null,
  request = {},
  trustedContext
}, graphCore) {
  assertKitchenBeoGraphContract(graphCore);
  const scope = trustedScope({ canonicalQuote, trustedContext });
  const requestId = exactRequestId(request.requestId);
  const actor = normalizeActor(trustedContext.actor);
  const claimedAtISO = exactISO(trustedContext.nowISO, "Kitchen BEO claim time");
  const sourceRevision = resolveKitchenBeoCommercialSourceRevision(canonicalQuote);
  if (!cleanText(canonicalQuote.activeVersionId) || sourceRevision.id !== canonicalQuote.activeVersionId) {
    fail(
      "failed-precondition",
      "A canonical active quote revision is required for a trusted Kitchen BEO receipt."
    );
  }
  const payload = buildCanonicalKitchenBeoPayload(canonicalQuote, operationalNotes);
  const fingerprint = createKitchenBeoFingerprint(payload, graphCore);
  const receiptId = receiptIdentity({ ...scope, requestId }, graphCore);
  return deepFreeze({
    schemaVersion: KITCHEN_BEO_GENERATION_REQUEST_SCHEMA_VERSION,
    authority: "server_authoritative",
    requestId,
    receiptId,
    ...scope,
    artifactType: KITCHEN_BEO_ARTIFACT_TYPE,
    artifactNodeId: KITCHEN_BEO_ARTIFACT_NODE_ID,
    commercialSourceRevisionId: sourceRevision.id,
    graphId: fingerprint.graphId,
    graphVersion: fingerprint.graphVersion,
    canonicalSchemaVersion: fingerprint.canonicalSchemaVersion,
    fingerprintSchemaVersion: fingerprint.fingerprintSchemaVersion,
    declaredNodeIds: [...fingerprint.declaredNodeIds],
    dependencyFingerprint: fingerprint.dependencyFingerprint,
    claimedAtISO,
    claimedBy: actor,
    payload
  });
}

function validateGenerationClaim(claim, graphCore) {
  if (
    !isRecord(claim)
    || claim.schemaVersion !== KITCHEN_BEO_GENERATION_REQUEST_SCHEMA_VERSION
    || claim.authority !== "server_authoritative"
  ) {
    fail("failed-precondition", "Kitchen BEO generation claim is invalid.");
  }
  const organizationId = exactOpaqueId(claim.organizationId, "organizationId");
  const quoteId = exactOpaqueId(claim.quoteId, "quoteId");
  const requestId = exactRequestId(claim.requestId);
  const expectedReceiptId = receiptIdentity({ organizationId, quoteId, requestId }, graphCore);
  if (claim.receiptId !== expectedReceiptId) {
    fail("failed-precondition", "Kitchen BEO generation claim identity is invalid.");
  }
  exactOpaqueId(claim.commercialSourceRevisionId, "commercialSourceRevisionId");
  exactISO(claim.claimedAtISO, "Kitchen BEO claim time");
  normalizeActor(claim.claimedBy);
  const fingerprint = createKitchenBeoFingerprint(claim.payload, graphCore);
  if (
    claim.artifactType !== fingerprint.artifactType
    || claim.artifactNodeId !== fingerprint.artifactNodeId
    || claim.graphId !== fingerprint.graphId
    || claim.graphVersion !== fingerprint.graphVersion
    || claim.canonicalSchemaVersion !== fingerprint.canonicalSchemaVersion
    || claim.fingerprintSchemaVersion !== fingerprint.fingerprintSchemaVersion
    || claim.dependencyFingerprint !== fingerprint.dependencyFingerprint
    || graphCore.canonicalSerialize(claim.declaredNodeIds)
      !== graphCore.canonicalSerialize(fingerprint.declaredNodeIds)
  ) {
    fail("failed-precondition", "Kitchen BEO generation claim fingerprint is invalid.");
  }
  return claim;
}

function normalizeArtifactBytes(value) {
  if (Buffer.isBuffer(value)) return Buffer.from(value);
  if (value instanceof Uint8Array) {
    return Buffer.from(value.buffer, value.byteOffset, value.byteLength);
  }
  if (value instanceof ArrayBuffer) return Buffer.from(value);
  fail("invalid-argument", "Generated Kitchen BEO bytes are required.");
}

function normalizeArtifactDescriptor(artifact) {
  if (!isRecord(artifact)) {
    fail("invalid-argument", "Generated Kitchen BEO artifact is required.");
  }
  const bytes = normalizeArtifactBytes(artifact.bytes);
  if (!bytes.length || bytes.length > KITCHEN_BEO_MAX_ARTIFACT_BYTES) {
    fail(
      "resource-exhausted",
      `Generated Kitchen BEO must be between 1 and ${KITCHEN_BEO_MAX_ARTIFACT_BYTES} bytes.`
    );
  }
  const mimeType = cleanText(artifact.mimeType).toLowerCase();
  const filename = cleanText(artifact.filename);
  if (mimeType !== "application/pdf") {
    fail("invalid-argument", "Generated Kitchen BEO must be a PDF.");
  }
  if (
    !filename
    || filename.length > 180
    || !/^[A-Za-z0-9_.-]+\.pdf$/i.test(filename)
    || filename.includes("..")
  ) {
    fail("invalid-argument", "Generated Kitchen BEO filename is invalid.");
  }
  return {
    artifactSha256: sha256Hex(bytes),
    artifactByteLength: bytes.length,
    mimeType,
    filename
  };
}

function buildKitchenBeoGenerationReceipt({
  claim,
  artifact,
  trustedCompletion = {}
}, graphCore) {
  const validatedClaim = validateGenerationClaim(claim, graphCore);
  const descriptor = normalizeArtifactDescriptor(artifact);
  const generatedAtISO = exactISO(
    trustedCompletion.generatedAtISO,
    "Kitchen BEO generation time"
  );
  if (generatedAtISO < validatedClaim.claimedAtISO) {
    fail(
      "failed-precondition",
      "Kitchen BEO generation time cannot precede its server claim."
    );
  }
  return deepFreeze({
    schemaVersion: KITCHEN_BEO_GENERATION_RECEIPT_SCHEMA_VERSION,
    authority: "server_authoritative",
    receiptId: validatedClaim.receiptId,
    requestId: validatedClaim.requestId,
    organizationId: validatedClaim.organizationId,
    quoteId: validatedClaim.quoteId,
    artifactType: validatedClaim.artifactType,
    artifactNodeId: validatedClaim.artifactNodeId,
    commercialSourceRevisionId: validatedClaim.commercialSourceRevisionId,
    graphId: validatedClaim.graphId,
    graphVersion: validatedClaim.graphVersion,
    canonicalSchemaVersion: validatedClaim.canonicalSchemaVersion,
    fingerprintSchemaVersion: validatedClaim.fingerprintSchemaVersion,
    declaredNodeIds: [...validatedClaim.declaredNodeIds],
    dependencyFingerprint: validatedClaim.dependencyFingerprint,
    artifactSha256: descriptor.artifactSha256,
    artifactByteLength: descriptor.artifactByteLength,
    mimeType: descriptor.mimeType,
    filename: descriptor.filename,
    generatedAtISO,
    generatedBy: { ...validatedClaim.claimedBy }
  });
}

function receiptProjection(receipt) {
  if (!isRecord(receipt)) return null;
  return {
    schemaVersion: receipt.schemaVersion,
    authority: receipt.authority,
    receiptId: receipt.receiptId,
    requestId: receipt.requestId,
    organizationId: receipt.organizationId,
    quoteId: receipt.quoteId,
    artifactType: receipt.artifactType,
    artifactNodeId: receipt.artifactNodeId,
    commercialSourceRevisionId: receipt.commercialSourceRevisionId,
    graphId: receipt.graphId,
    graphVersion: receipt.graphVersion,
    canonicalSchemaVersion: receipt.canonicalSchemaVersion,
    fingerprintSchemaVersion: receipt.fingerprintSchemaVersion,
    declaredNodeIds: receipt.declaredNodeIds,
    dependencyFingerprint: receipt.dependencyFingerprint,
    artifactSha256: receipt.artifactSha256,
    artifactByteLength: receipt.artifactByteLength,
    mimeType: receipt.mimeType,
    filename: receipt.filename,
    generatedAtISO: receipt.generatedAtISO,
    generatedBy: receipt.generatedBy
  };
}

function assertReceiptShape(receipt, graphCore = null) {
  const projected = receiptProjection(receipt);
  if (
    !projected
    || projected.schemaVersion !== KITCHEN_BEO_GENERATION_RECEIPT_SCHEMA_VERSION
    || projected.authority !== "server_authoritative"
    || projected.artifactType !== KITCHEN_BEO_ARTIFACT_TYPE
    || projected.artifactNodeId !== KITCHEN_BEO_ARTIFACT_NODE_ID
    || !/^beo_[a-f0-9]{48}$/.test(cleanText(projected.receiptId))
    || !cleanText(projected.graphId)
    || !cleanText(projected.graphVersion)
    || !cleanText(projected.canonicalSchemaVersion)
    || !cleanText(projected.fingerprintSchemaVersion)
    || !Array.isArray(projected.declaredNodeIds)
    || projected.declaredNodeIds.some((nodeId) => typeof nodeId !== "string")
    || !/^[a-f0-9]{64}$/.test(cleanText(projected.dependencyFingerprint))
    || !/^[a-f0-9]{64}$/.test(cleanText(projected.artifactSha256))
    || !Number.isSafeInteger(projected.artifactByteLength)
    || projected.artifactByteLength < 1
    || projected.artifactByteLength > KITCHEN_BEO_MAX_ARTIFACT_BYTES
    || projected.mimeType !== "application/pdf"
    || !/^[A-Za-z0-9_.-]+\.pdf$/i.test(cleanText(projected.filename))
    || cleanText(projected.filename).includes("..")
  ) {
    fail("failed-precondition", "Kitchen BEO generation receipt is invalid.");
  }
  exactOpaqueId(projected.organizationId, "organizationId");
  exactOpaqueId(projected.quoteId, "quoteId");
  exactRequestId(projected.requestId);
  exactOpaqueId(projected.commercialSourceRevisionId, "commercialSourceRevisionId");
  exactISO(projected.generatedAtISO, "Kitchen BEO generation time");
  const generatedBy = normalizeActor(projected.generatedBy);
  if (graphCore) {
    const expectedReceiptId = receiptIdentity({
      organizationId: projected.organizationId,
      quoteId: projected.quoteId,
      requestId: projected.requestId
    }, graphCore);
    if (projected.receiptId !== expectedReceiptId) {
      fail("failed-precondition", "Kitchen BEO generation receipt identity is invalid.");
    }
  }
  return { ...projected, generatedBy };
}

function validateStoredKitchenBeoArtifact(record, graphCore) {
  const receipt = assertReceiptShape(record, graphCore);
  const artifactBase64 = cleanText(record?.artifactBase64);
  if (
    !artifactBase64
    || !/^(?:[A-Za-z0-9+/]{4})*(?:[A-Za-z0-9+/]{2}==|[A-Za-z0-9+/]{3}=)?$/u.test(artifactBase64)
  ) {
    fail("failed-precondition", "Stored Kitchen BEO artifact bytes are invalid.");
  }
  const bytes = Buffer.from(artifactBase64, "base64");
  if (
    bytes.toString("base64") !== artifactBase64
    || bytes.length !== receipt.artifactByteLength
    || sha256Hex(bytes) !== receipt.artifactSha256
  ) {
    fail(
      "failed-precondition",
      "Stored Kitchen BEO artifact bytes do not match the immutable receipt."
    );
  }
  return deepFreeze({
    receipt,
    artifact: {
      mimeType: receipt.mimeType,
      filename: receipt.filename,
      base64: artifactBase64
    }
  });
}

function reconcileKitchenBeoReceiptReplay({ existingReceipt, proposedReceipt }, graphCore) {
  const existing = assertReceiptShape(existingReceipt, graphCore);
  const proposed = assertReceiptShape(proposedReceipt, graphCore);
  if (existing.receiptId !== proposed.receiptId) {
    fail("invalid-argument", "Kitchen BEO replay receipt identity does not match.");
  }
  if (
    graphCore.canonicalSerialize(existing)
    !== graphCore.canonicalSerialize(proposed)
  ) {
    fail(
      "already-exists",
      "Kitchen BEO request identity is already bound to different immutable evidence."
    );
  }
  return deepFreeze({ receipt: existingReceipt, idempotent: true });
}

function normalizeInvalidations(invalidations) {
  if (!Array.isArray(invalidations) || invalidations.length > 100) {
    fail("failed-precondition", "Kitchen BEO invalidation evidence is invalid.");
  }
  return invalidations.map((item) => {
    if (!isRecord(item)) {
      fail("failed-precondition", "Kitchen BEO invalidation evidence is invalid.");
    }
    const id = exactOpaqueId(item.id, "invalidation id", 160);
    const artifactNodeId = cleanText(item.artifactNodeId);
    const state = cleanText(item.state).toLowerCase();
    const classification = cleanText(item.classification).toUpperCase();
    if (
      artifactNodeId !== KITCHEN_BEO_ARTIFACT_NODE_ID
      || !["open", "resolved"].includes(state)
      || !["STALE", "REVIEW"].includes(classification)
    ) {
      fail("failed-precondition", "Kitchen BEO invalidation evidence is invalid.");
    }
    return { id, artifactNodeId, state, classification };
  });
}

function statusResult({
  state,
  observedAtISO,
  reasonCodes,
  currentFingerprint = "",
  receipt = null,
  invalidations = []
}) {
  return deepFreeze({
    schemaVersion: KITCHEN_BEO_STATUS_SCHEMA_VERSION,
    authority: "server_derived",
    state,
    observedAtISO,
    reasonCodes: [...new Set(reasonCodes)].sort(compareText),
    currentDependencyFingerprint: currentFingerprint,
    receiptId: cleanText(receipt?.receiptId),
    receiptDependencyFingerprint: cleanText(receipt?.dependencyFingerprint),
    commercialSourceRevisionId: cleanText(receipt?.commercialSourceRevisionId),
    unresolvedInvalidationIds: invalidations
      .filter((item) => item.state === "open")
      .map((item) => item.id)
      .sort(compareText)
  });
}

function deriveKitchenBeoArtifactStatus({
  canonicalQuote,
  operationalNotes = null,
  trustedReceipt = null,
  invalidations = [],
  sourceState = "available",
  trustedContext
}, graphCore) {
  const observedAtISO = exactISO(
    trustedContext?.nowISO,
    "Kitchen BEO status observation time"
  );
  if (sourceState !== "available") {
    return statusResult({
      state: KITCHEN_BEO_FRESHNESS_STATES.UNKNOWN,
      observedAtISO,
      reasonCodes: [`canonical_source_${cleanText(sourceState).toLowerCase() || "unknown"}`]
    });
  }
  let scope;
  let currentFingerprint;
  let currentSource;
  let normalizedInvalidations;
  try {
    scope = trustedScope({ canonicalQuote, trustedContext });
    const payload = buildCanonicalKitchenBeoPayload(canonicalQuote, operationalNotes);
    currentFingerprint = createKitchenBeoFingerprint(payload, graphCore);
    currentSource = resolveKitchenBeoCommercialSourceRevision(canonicalQuote);
    normalizedInvalidations = normalizeInvalidations(invalidations);
  } catch (error) {
    if (error instanceof KitchenBeoAuthorityError && error.code === "permission-denied") {
      throw error;
    }
    return statusResult({
      state: KITCHEN_BEO_FRESHNESS_STATES.UNKNOWN,
      observedAtISO,
      reasonCodes: ["canonical_fingerprint_unavailable"]
    });
  }
  if (!trustedReceipt) {
    return statusResult({
      state: KITCHEN_BEO_FRESHNESS_STATES.NOT_GENERATED,
      observedAtISO,
      reasonCodes: ["trusted_receipt_missing"],
      currentFingerprint: currentFingerprint.dependencyFingerprint,
      invalidations: normalizedInvalidations
    });
  }
  let receipt;
  try {
    receipt = assertReceiptShape(trustedReceipt);
  } catch {
    return statusResult({
      state: KITCHEN_BEO_FRESHNESS_STATES.UNKNOWN,
      observedAtISO,
      reasonCodes: ["trusted_receipt_invalid"],
      currentFingerprint: currentFingerprint.dependencyFingerprint,
      invalidations: normalizedInvalidations
    });
  }
  if (receipt.organizationId !== scope.organizationId || receipt.quoteId !== scope.quoteId) {
    return statusResult({
      state: KITCHEN_BEO_FRESHNESS_STATES.UNKNOWN,
      observedAtISO,
      reasonCodes: ["trusted_receipt_scope_mismatch"],
      currentFingerprint: currentFingerprint.dependencyFingerprint,
      receipt,
      invalidations: normalizedInvalidations
    });
  }
  if (receipt.receiptId !== receiptIdentity({
    organizationId: receipt.organizationId,
    quoteId: receipt.quoteId,
    requestId: receipt.requestId
  }, graphCore)) {
    return statusResult({
      state: KITCHEN_BEO_FRESHNESS_STATES.UNKNOWN,
      observedAtISO,
      reasonCodes: ["trusted_receipt_invalid"],
      currentFingerprint: currentFingerprint.dependencyFingerprint,
      receipt,
      invalidations: normalizedInvalidations
    });
  }
  if (
    receipt.graphId !== currentFingerprint.graphId
    || receipt.graphVersion !== currentFingerprint.graphVersion
    || receipt.canonicalSchemaVersion !== currentFingerprint.canonicalSchemaVersion
    || receipt.fingerprintSchemaVersion !== currentFingerprint.fingerprintSchemaVersion
    || graphCore.canonicalSerialize(receipt.declaredNodeIds)
      !== graphCore.canonicalSerialize(currentFingerprint.declaredNodeIds)
  ) {
    return statusResult({
      state: KITCHEN_BEO_FRESHNESS_STATES.REVIEW,
      observedAtISO,
      reasonCodes: ["receipt_contract_requires_review"],
      currentFingerprint: currentFingerprint.dependencyFingerprint,
      receipt,
      invalidations: normalizedInvalidations
    });
  }
  const staleReasons = [];
  if (receipt.commercialSourceRevisionId !== currentSource.id) {
    staleReasons.push("commercial_source_revision_changed");
  }
  if (receipt.dependencyFingerprint !== currentFingerprint.dependencyFingerprint) {
    staleReasons.push("declared_inputs_changed");
  }
  if (normalizedInvalidations.some((item) => (
    item.state === "open" && item.classification === "STALE"
  ))) {
    staleReasons.push("authorized_invalidation_open");
  }
  if (staleReasons.length) {
    return statusResult({
      state: KITCHEN_BEO_FRESHNESS_STATES.STALE,
      observedAtISO,
      reasonCodes: staleReasons,
      currentFingerprint: currentFingerprint.dependencyFingerprint,
      receipt,
      invalidations: normalizedInvalidations
    });
  }
  if (normalizedInvalidations.some((item) => (
    item.state === "open" && item.classification === "REVIEW"
  ))) {
    return statusResult({
      state: KITCHEN_BEO_FRESHNESS_STATES.REVIEW,
      observedAtISO,
      reasonCodes: ["dependency_review_open"],
      currentFingerprint: currentFingerprint.dependencyFingerprint,
      receipt,
      invalidations: normalizedInvalidations
    });
  }
  return statusResult({
    state: KITCHEN_BEO_FRESHNESS_STATES.CURRENT,
    observedAtISO,
    reasonCodes: ["trusted_receipt_matches_canonical_source"],
    currentFingerprint: currentFingerprint.dependencyFingerprint,
    receipt,
    invalidations: normalizedInvalidations
  });
}

function createKitchenBeoAuthority({ graphCore } = {}) {
  const core = assertGraphCore(graphCore);
  assertKitchenBeoGraphContract(core);
  return Object.freeze({
    buildCanonicalPayload: buildCanonicalKitchenBeoPayload,
    buildGenerationClaim: (input) => buildKitchenBeoGenerationClaim(input, core),
    buildGenerationReceipt: (input) => buildKitchenBeoGenerationReceipt(input, core),
    createFingerprint: (payload) => createKitchenBeoFingerprint(payload, core),
    deriveArtifactStatus: (input) => deriveKitchenBeoArtifactStatus(input, core),
    reconcileReceiptReplay: (input) => reconcileKitchenBeoReceiptReplay(input, core),
    validateGenerationReceipt: (receipt) => deepFreeze(assertReceiptShape(receipt, core)),
    validateStoredArtifact: (record) => validateStoredKitchenBeoArtifact(record, core),
    resolveCommercialSourceRevision: resolveKitchenBeoCommercialSourceRevision
  });
}

module.exports = {
  KITCHEN_BEO_ARTIFACT_NODE_ID,
  KITCHEN_BEO_ARTIFACT_TYPE,
  KITCHEN_BEO_CANONICAL_SCHEMA_VERSION,
  KITCHEN_BEO_DECLARED_INPUT_NODE_IDS,
  KITCHEN_BEO_FRESHNESS_STATES,
  KITCHEN_BEO_GENERATION_RECEIPT_SCHEMA_VERSION,
  KITCHEN_BEO_GENERATION_REQUEST_SCHEMA_VERSION,
  KITCHEN_BEO_INPUT_SCHEMA_VERSION,
  KITCHEN_BEO_INPUT_SCHEMA_VERSION_WITH_OPERATIONAL_NOTES,
  KITCHEN_BEO_MAX_ARTIFACT_BYTES,
  KITCHEN_BEO_STATUS_SCHEMA_VERSION,
  KitchenBeoAuthorityError,
  createKitchenBeoAuthority
};
