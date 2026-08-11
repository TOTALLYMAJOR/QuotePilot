"use strict";

const { createHash } = require("node:crypto");

// Pure validation and shaping for the structured change-request record
// callable (docs/POST_COMPETITIVE_DESIGN.md §4.8; DEV_TASKS "structured
// change requests"). No I/O here: functions/index.js owns auth, reads, and
// the create-only transaction. The record is a staff attestation of which
// parsed proposals were staged from one exact customer request, bound
// server-side to the exact stored message (by hash), the quote revision at
// record time, and the acting staff identity. It never mutates the quote,
// the portal, or any customer-facing state.
const CHANGE_REQUEST_RECORD_SCHEMA_VERSION = 1;

const PROPOSAL_KINDS = new Set([
  "set_guests",
  "add_staff",
  "set_hours",
  "set_style",
  "remove_item",
  "add_item",
  "swap_item"
]);

const STAFF_FIELDS = new Set(["servers", "chefs", "bartenders"]);
const ITEM_TYPES = new Set(["addons", "rentals", "menuItems"]);
const MAX_PROPOSALS = 16;
const MAX_TEXT = 300;

class ChangeRequestRecordError extends Error {
  constructor(code, message) {
    super(message);
    this.name = "ChangeRequestRecordError";
    this.code = code;
  }
}

function text(value) {
  return String(value ?? "").trim();
}

function bounded(value, label) {
  const normalized = text(value);
  if (!normalized || normalized.length > MAX_TEXT) {
    throw new ChangeRequestRecordError("invalid-argument", `${label} is required and must stay under ${MAX_TEXT} characters.`);
  }
  return normalized;
}

function positiveInt(value, label, { max = 10000 } = {}) {
  const numeric = Number(value);
  if (!Number.isInteger(numeric) || numeric <= 0 || numeric > max) {
    throw new ChangeRequestRecordError("invalid-argument", `${label} must be a positive integer within bounds.`);
  }
  return numeric;
}

function sha256Hex(value) {
  return createHash("sha256").update(String(value), "utf8").digest("hex");
}

function normalizeItemRef(value, label) {
  if (!value || typeof value !== "object") {
    throw new ChangeRequestRecordError("invalid-argument", `${label} is malformed.`);
  }
  const itemType = text(value.itemType);
  if (!ITEM_TYPES.has(itemType)) {
    throw new ChangeRequestRecordError("invalid-argument", `${label} item type is not recognized.`);
  }
  return {
    itemType,
    itemId: bounded(value.itemId, `${label} item id`),
    itemName: bounded(value.itemName, `${label} item name`)
  };
}

function normalizeProposal(value, index) {
  if (!value || typeof value !== "object") {
    throw new ChangeRequestRecordError("invalid-argument", `Proposal ${index + 1} is malformed.`);
  }
  const kind = text(value.kind);
  if (!PROPOSAL_KINDS.has(kind)) {
    throw new ChangeRequestRecordError("invalid-argument", `Proposal ${index + 1} kind is not recognized.`);
  }
  const base = {
    id: bounded(value.id, `Proposal ${index + 1} id`),
    kind,
    title: bounded(value.title, `Proposal ${index + 1} title`),
    clause: bounded(value.clause, `Proposal ${index + 1} clause`)
  };
  if (kind === "set_guests") {
    return { ...base, value: positiveInt(value.value, `Proposal ${index + 1} guest count`, { max: 2000 }) };
  }
  if (kind === "add_staff") {
    const field = text(value.field);
    if (!STAFF_FIELDS.has(field)) {
      throw new ChangeRequestRecordError("invalid-argument", `Proposal ${index + 1} staff role is not recognized.`);
    }
    return { ...base, field, count: positiveInt(value.count, `Proposal ${index + 1} staff count`, { max: 50 }) };
  }
  if (kind === "set_hours") {
    return { ...base, value: positiveInt(value.value, `Proposal ${index + 1} hours`, { max: 24 }) };
  }
  if (kind === "set_style") {
    return { ...base, value: bounded(value.value, `Proposal ${index + 1} style`) };
  }
  if (kind === "remove_item" || kind === "add_item") {
    return { ...base, ...normalizeItemRef(value, `Proposal ${index + 1}`) };
  }
  return {
    ...base,
    remove: normalizeItemRef(value.remove, `Proposal ${index + 1} removal`),
    add: normalizeItemRef(value.add, `Proposal ${index + 1} addition`)
  };
}

function normalizeChangeRequestRecordRequest(payload) {
  if (!payload || typeof payload !== "object") {
    throw new ChangeRequestRecordError("invalid-argument", "A structured record request is required.");
  }
  const organizationId = bounded(payload.organizationId, "organizationId");
  const quoteId = bounded(payload.quoteId, "quoteId");
  const requestId = bounded(payload.requestId, "requestId");
  const submittedAtISO = text(payload.submittedAtISO);
  if (!/^\d{4}-\d{2}-\d{2}T/.test(submittedAtISO) || Number.isNaN(Date.parse(submittedAtISO))) {
    throw new ChangeRequestRecordError("invalid-argument", "submittedAtISO must be a valid ISO timestamp.");
  }
  const parseModelId = bounded(payload.parseModelId, "parseModelId");

  const rawProposals = Array.isArray(payload.proposals) ? payload.proposals : null;
  if (!rawProposals || !rawProposals.length || rawProposals.length > MAX_PROPOSALS) {
    throw new ChangeRequestRecordError("invalid-argument", `proposals must contain between 1 and ${MAX_PROPOSALS} entries.`);
  }
  const proposals = rawProposals.map((proposal, index) => normalizeProposal(proposal, index));
  const proposalIds = new Set(proposals.map((proposal) => proposal.id));
  if (proposalIds.size !== proposals.length) {
    throw new ChangeRequestRecordError("invalid-argument", "Proposal ids must be unique.");
  }

  const rawStaged = Array.isArray(payload.stagedProposalIds) ? payload.stagedProposalIds.map(text) : [];
  const stagedProposalIds = [...new Set(rawStaged)].filter(Boolean);
  if (!stagedProposalIds.length) {
    throw new ChangeRequestRecordError("failed-precondition", "At least one proposal must be staged before recording.");
  }
  for (const stagedId of stagedProposalIds) {
    if (!proposalIds.has(stagedId)) {
      throw new ChangeRequestRecordError("invalid-argument", "stagedProposalIds must reference the submitted proposals.");
    }
  }

  return { organizationId, quoteId, requestId, submittedAtISO, parseModelId, proposals, stagedProposalIds };
}

function verifyChangeRequestRecordAgainstQuote(normalized, quote) {
  if (!quote || typeof quote !== "object") {
    throw new ChangeRequestRecordError("not-found", "The quote for this record was not found.");
  }
  if (text(quote.organizationId) !== normalized.organizationId) {
    throw new ChangeRequestRecordError("permission-denied", "The quote does not belong to this organization.");
  }
  const decision = quote.portalDecision || {};
  const message = text(decision.message);
  if (
    text(decision.decision) !== "changes_requested"
    || !message
    || text(decision.requestId) !== normalized.requestId
    || text(decision.submittedAtISO) !== normalized.submittedAtISO
  ) {
    throw new ChangeRequestRecordError(
      "failed-precondition",
      "The stored customer request no longer matches this record; re-open the quote and review the current request."
    );
  }
  return {
    messageHash: sha256Hex(message),
    activeVersionIdAtRecord: text(quote.activeVersionId),
    latestVersionNumberAtRecord: Number(quote.latestVersionNumber) || 0
  };
}

function buildChangeRequestRecord({ normalized, verification, actor, nowISO }) {
  const actorUid = text(actor && actor.uid);
  const actorEmail = text(actor && actor.email).toLowerCase();
  if (!actorUid) {
    throw new ChangeRequestRecordError("unauthenticated", "A staff actor is required.");
  }
  const recordedAtISO = text(nowISO);
  if (!/^\d{4}-\d{2}-\d{2}T/.test(recordedAtISO) || Number.isNaN(Date.parse(recordedAtISO))) {
    throw new ChangeRequestRecordError("internal", "A valid record timestamp is required.");
  }
  const payloadHash = sha256Hex(JSON.stringify({
    parseModelId: normalized.parseModelId,
    proposals: normalized.proposals,
    stagedProposalIds: [...normalized.stagedProposalIds].sort()
  }));
  const resolutionId = `crr_${sha256Hex([
    normalized.organizationId,
    normalized.quoteId,
    normalized.requestId,
    normalized.submittedAtISO,
    payloadHash
  ].join("|")).slice(0, 48)}`;

  return {
    resolutionId,
    payloadHash,
    record: {
      schemaVersion: CHANGE_REQUEST_RECORD_SCHEMA_VERSION,
      resolutionId,
      organizationId: normalized.organizationId,
      quoteId: normalized.quoteId,
      requestId: normalized.requestId,
      requestSubmittedAtISO: normalized.submittedAtISO,
      messageHash: verification.messageHash,
      parseModelId: normalized.parseModelId,
      proposals: normalized.proposals,
      stagedProposalIds: normalized.stagedProposalIds,
      activeVersionIdAtRecord: verification.activeVersionIdAtRecord,
      latestVersionNumberAtRecord: verification.latestVersionNumberAtRecord,
      payloadHash,
      recordedByUid: actorUid,
      recordedByEmail: actorEmail,
      recordedAtISO
    }
  };
}

module.exports = {
  CHANGE_REQUEST_RECORD_SCHEMA_VERSION,
  ChangeRequestRecordError,
  normalizeChangeRequestRecordRequest,
  verifyChangeRequestRecordAgainstQuote,
  buildChangeRequestRecord
};
