import { createRequire } from "node:module";
import { isDeepStrictEqual } from "node:util";

const require = createRequire(import.meta.url);
const { buildCanonicalPortalSnapshot } = require("../functions/quoteCreation.js");

export const PORTAL_PROJECTION_VERSION = 2;

const TERMINAL_DECISIONS = new Set(["accepted", "declined"]);
const TERMINAL_PAYMENT_STATES = new Set(["paid", "refunded"]);
const AUTHORITATIVE_PROJECTION_FIELDS = [
  "portalIssuedAtISO",
  "portalExpiresAtISO",
  "portalExpiresAtMs",
  "quoteNumber",
  "customerName",
  "customerEmail",
  "eventName",
  "eventDate",
  "eventTime",
  "eventHours",
  "eventGuests",
  "eventStyle",
  "venue",
  "venueAddress",
  "dietaryRestrictions",
  "total",
  "deposit",
  "totals",
  "selection",
  "quoteMeta",
  "expiresAtISO"
];
const PRESERVE_EXISTING_FIELDS = [
  "status",
  "payment",
  "booking",
  "portalDecision",
  "lifecycle",
  "createdAtISO",
  "updatedAtISO"
];

function text(value) {
  return String(value ?? "").trim();
}

function lower(value) {
  return text(value).toLowerCase();
}

function isRecord(value) {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}

function hasOwn(record, key) {
  return Object.prototype.hasOwnProperty.call(record || {}, key);
}

function validEpochMs(value) {
  const parsed = Number(value || 0);
  return Number.isFinite(parsed) && parsed > 0 ? Math.round(parsed) : 0;
}

function parseEpochMs(value) {
  const parsed = Date.parse(text(value));
  return Number.isFinite(parsed) && parsed > 0 ? Math.round(parsed) : 0;
}

function firstValidISO(...values) {
  return values.find((value) => parseEpochMs(value) > 0) || "";
}

function buildMissingPatch(current, desired) {
  if (!isRecord(desired)) return undefined;
  const source = isRecord(current) ? current : {};
  const patch = {};
  Object.entries(desired).forEach(([key, value]) => {
    if (!hasOwn(source, key)) {
      patch[key] = value;
      return;
    }
    if (isRecord(value) && isRecord(source[key])) {
      const nested = buildMissingPatch(source[key], value);
      if (nested && Object.keys(nested).length) patch[key] = nested;
    }
  });
  return patch;
}

function decisionConflict(portal, quote) {
  const portalDecision = lower(portal?.portalDecision?.decision);
  const quoteDecision = lower(quote?.portalDecision?.decision);
  if (
    portalDecision
    && quoteDecision
    && portalDecision !== quoteDecision
    && (TERMINAL_DECISIONS.has(portalDecision) || TERMINAL_DECISIONS.has(quoteDecision))
  ) {
    return true;
  }

  const portalStatus = lower(portal?.status);
  const quoteStatus = lower(quote?.status);
  return (
    portalStatus
    && quoteStatus
    && portalStatus !== quoteStatus
    && (TERMINAL_DECISIONS.has(portalStatus) || TERMINAL_DECISIONS.has(quoteStatus))
  );
}

function commercialEvidenceConflict(portal, quote) {
  const portalPayment = lower(portal?.payment?.depositStatus);
  const quotePayment = lower(quote?.payment?.depositStatus);
  if (
    portalPayment
    && quotePayment
    && portalPayment !== quotePayment
    && (TERMINAL_PAYMENT_STATES.has(portalPayment) || TERMINAL_PAYMENT_STATES.has(quotePayment))
  ) {
    return true;
  }

  const portalContract = text(portal?.booking?.contractNumber);
  const quoteContract = text(quote?.booking?.contractNumber);
  return Boolean(portalContract && quoteContract && portalContract !== quoteContract);
}

function projectionQuote({ quote, portal, portalId, organizationId }) {
  const portalExpiresAtISO = firstValidISO(
    quote?.portalExpiresAtISO,
    portal?.portalExpiresAtISO,
    quote?.expiresAtISO
  );
  return {
    ...(quote || {}),
    organizationId,
    portalKey: portalId,
    portalExpiresAtISO,
    portalIssuedAtISO: firstValidISO(
      quote?.portalIssuedAtISO,
      portal?.portalIssuedAtISO,
      quote?.createdAtISO
    )
  };
}

export function planPortalSnapshotBackfill({
  portalId = "",
  portal = {},
  quoteId = "",
  quote = {},
  organizationId = "",
  nowISO = new Date().toISOString()
} = {}) {
  const normalizedPortalId = text(portalId);
  const normalizedQuoteId = text(quoteId || portal?.quoteId);
  const normalizedOrganizationId = text(organizationId);
  if (!normalizedPortalId || !normalizedQuoteId || !normalizedOrganizationId) {
    return { state: "skipped_invalid_identity", patch: {} };
  }

  const portalOrganizationId = text(portal?.organizationId);
  if (portalOrganizationId && portalOrganizationId !== normalizedOrganizationId) {
    return { state: "skipped_foreign_organization", patch: {} };
  }
  const quoteOrganizationId = text(quote?.organizationId);
  if (quoteOrganizationId && quoteOrganizationId !== normalizedOrganizationId) {
    return { state: "skipped_foreign_organization", patch: {} };
  }
  if (text(portal?.quoteId) && text(portal.quoteId) !== normalizedQuoteId) {
    return { state: "conflict_identity", patch: {} };
  }
  if (text(portal?.portalKey) && text(portal.portalKey) !== normalizedPortalId) {
    return { state: "conflict_identity", patch: {} };
  }
  if (text(quote?.portalKey) && text(quote.portalKey) !== normalizedPortalId) {
    return { state: "conflict_identity", patch: {} };
  }
  if (lower(portal?.status) === "deleted") {
    return { state: "skipped_inactive", patch: {} };
  }
  if (decisionConflict(portal, quote) || commercialEvidenceConflict(portal, quote)) {
    return { state: "conflict_commercial_evidence", patch: {} };
  }

  const sourceQuote = projectionQuote({
    quote,
    portal,
    portalId: normalizedPortalId,
    organizationId: normalizedOrganizationId
  });
  const canonical = buildCanonicalPortalSnapshot(normalizedQuoteId, sourceQuote);
  const expiresAtMs = validEpochMs(canonical.portalExpiresAtMs)
    || validEpochMs(portal?.portalExpiresAtMs)
    || parseEpochMs(portal?.portalExpiresAtISO);
  const nowMs = parseEpochMs(nowISO);
  if (!expiresAtMs || !nowMs) {
    return { state: "skipped_invalid_expiry", patch: {} };
  }
  if (expiresAtMs <= nowMs) {
    return { state: "skipped_inactive", patch: {} };
  }
  canonical.portalExpiresAtMs = expiresAtMs;

  const patch = {};
  const identities = {
    quoteId: normalizedQuoteId,
    organizationId: normalizedOrganizationId,
    portalKey: normalizedPortalId
  };
  Object.entries(identities).forEach(([key, value]) => {
    if (!text(portal?.[key])) patch[key] = value;
  });
  AUTHORITATIVE_PROJECTION_FIELDS.forEach((key) => {
    if (!isDeepStrictEqual(portal?.[key], canonical[key])) {
      patch[key] = canonical[key];
    }
  });
  PRESERVE_EXISTING_FIELDS.forEach((key) => {
    if (!hasOwn(portal, key)) {
      patch[key] = canonical[key];
      return;
    }
    if (isRecord(canonical[key]) && isRecord(portal[key])) {
      const missing = buildMissingPatch(portal[key], canonical[key]);
      if (missing && Object.keys(missing).length) patch[key] = missing;
    }
  });

  const currentVersion = Number(portal?.portalProjectionVersion || 0);
  if (Object.keys(patch).length || currentVersion < PORTAL_PROJECTION_VERSION) {
    patch.portalProjectionVersion = PORTAL_PROJECTION_VERSION;
    patch.portalProjectionBackfilledAtISO = text(nowISO);
  }
  if (!Object.keys(patch).length) {
    return { state: "already_current", patch: {} };
  }
  return { state: "patch", patch };
}

export function planPortalSnapshotBackfillBatch({
  portals = [],
  quotes = [],
  organizationId = "",
  nowISO = new Date().toISOString()
} = {}) {
  const quoteById = new Map();
  const quoteByPortalKey = new Map();
  quotes.forEach((entry) => {
    const id = text(entry?.id);
    const data = isRecord(entry?.data) ? entry.data : {};
    if (id) quoteById.set(id, { id, data });
    const portalKey = text(data.portalKey);
    if (portalKey) quoteByPortalKey.set(portalKey, { id, data });
  });

  const summary = {
    source: portals.length,
    matched: 0,
    wouldPatch: 0,
    patched: 0,
    alreadyCurrent: 0,
    skippedForeignOrganization: 0,
    skippedNoQuote: 0,
    skippedInactive: 0,
    skippedInvalidIdentity: 0,
    skippedInvalidExpiry: 0,
    conflicts: 0,
    concurrentChanges: 0
  };
  const entries = [];

  portals.forEach((entry) => {
    const portalId = text(entry?.id);
    const portal = isRecord(entry?.data) ? entry.data : {};
    if (text(portal.organizationId) && text(portal.organizationId) !== text(organizationId)) {
      summary.skippedForeignOrganization += 1;
      return;
    }
    const requestedQuoteId = text(portal.quoteId);
    const quoteEntry = requestedQuoteId
      ? quoteById.get(requestedQuoteId)
      : quoteByPortalKey.get(portalId);
    if (!quoteEntry) {
      summary.skippedNoQuote += 1;
      return;
    }
    summary.matched += 1;
    const planned = planPortalSnapshotBackfill({
      portalId,
      portal,
      quoteId: quoteEntry.id,
      quote: quoteEntry.data,
      organizationId,
      nowISO
    });
    if (planned.state === "patch") {
      entries.push({
        portalId,
        quoteId: quoteEntry.id,
        patch: planned.patch
      });
      summary.wouldPatch += 1;
      return;
    }
    if (planned.state === "already_current") summary.alreadyCurrent += 1;
    else if (planned.state === "skipped_foreign_organization") summary.skippedForeignOrganization += 1;
    else if (planned.state === "skipped_inactive") summary.skippedInactive += 1;
    else if (planned.state === "skipped_invalid_expiry") summary.skippedInvalidExpiry += 1;
    else if (planned.state.startsWith("conflict_")) summary.conflicts += 1;
    else summary.skippedInvalidIdentity += 1;
  });

  return { entries, summary };
}
