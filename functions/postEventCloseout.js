"use strict";

const { createHash } = require("node:crypto");

const POST_EVENT_CLOSEOUT_SCHEMA_VERSION = 1;
const POST_EVENT_CLOSEOUT_OFFSET_DAYS = 7;
const POST_EVENT_CLOSEOUT_POLICY_VERSION = 1;
const POST_EVENT_CLOSEOUT_REVIEW_ITEM_CODES = Object.freeze([
  "internal_closeout",
  "thank_you",
  "review_request",
  "operational_follow_up"
]);

const REVIEW_ITEM_CODE_SET = new Set(POST_EVENT_CLOSEOUT_REVIEW_ITEM_CODES);
const REVIEW_ITEM_STATE_SET = new Set(["pending", "reviewed"]);
const CLOSEOUT_STATE_SET = new Set([
  "blocked_configuration",
  "pending",
  "completed"
]);
const STAFF_ROLE_SET = new Set(["admin", "sales"]);
const ACTION_SET = new Set(["review", "reopen"]);
const OPAQUE_ID_PATTERN = /^[^\s/?#\\\u0000]{1,256}$/u;
const REQUEST_ID_PATTERN = /^[A-Za-z0-9][A-Za-z0-9._:@-]{19,159}$/;
const DATE_ONLY_PATTERN = /^\d{4}-\d{2}-\d{2}$/;

class PostEventCloseoutError extends Error {
  constructor(code, message) {
    super(message);
    this.name = "PostEventCloseoutError";
    this.code = code;
  }
}

function text(value) {
  return String(value ?? "").trim();
}

function isRecord(value) {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}

function deepFreeze(value) {
  if (!value || typeof value !== "object" || Object.isFrozen(value)) return value;
  Object.freeze(value);
  Object.values(value).forEach(deepFreeze);
  return value;
}

function opaqueId(value, label) {
  const normalized = text(value);
  if (
    !OPAQUE_ID_PATTERN.test(normalized)
    || normalized === "."
    || normalized === ".."
    || /^[^@\s]+@[^@\s]+$/.test(normalized)
  ) {
    throw new PostEventCloseoutError("invalid-argument", `${label} is invalid.`);
  }
  return normalized;
}

function validISO(value, label = "timestamp") {
  const normalized = text(value);
  if (!/^\d{4}-\d{2}-\d{2}T/.test(normalized)) {
    throw new PostEventCloseoutError("invalid-argument", `${label} must be an ISO timestamp.`);
  }
  const parsed = new Date(normalized);
  if (Number.isNaN(parsed.getTime())) {
    throw new PostEventCloseoutError("invalid-argument", `${label} must be an ISO timestamp.`);
  }
  return parsed.toISOString();
}

function optionalISO(value) {
  const normalized = text(value);
  if (!normalized) return "";
  try {
    return validISO(normalized);
  } catch {
    return "";
  }
}

function dateOnly(value, label = "date") {
  const normalized = text(value);
  if (!DATE_ONLY_PATTERN.test(normalized)) {
    throw new PostEventCloseoutError("invalid-argument", `${label} must use YYYY-MM-DD.`);
  }
  const [year, month, day] = normalized.split("-").map(Number);
  const parsed = new Date(Date.UTC(year, month - 1, day));
  if (
    parsed.getUTCFullYear() !== year
    || parsed.getUTCMonth() !== month - 1
    || parsed.getUTCDate() !== day
  ) {
    throw new PostEventCloseoutError("invalid-argument", `${label} is not a valid calendar date.`);
  }
  return normalized;
}

function addCalendarDaysDateOnly(value, days = POST_EVENT_CLOSEOUT_OFFSET_DAYS) {
  const sourceDate = dateOnly(value, "eventDate");
  const offset = Number(days);
  if (!Number.isInteger(offset) || Math.abs(offset) > 3660) {
    throw new PostEventCloseoutError(
      "invalid-argument",
      "Calendar-day offset must be an integer within ten years."
    );
  }
  const [year, month, day] = sourceDate.split("-").map(Number);
  const parsed = new Date(Date.UTC(year, month - 1, day));
  parsed.setUTCDate(parsed.getUTCDate() + offset);
  return [
    String(parsed.getUTCFullYear()).padStart(4, "0"),
    String(parsed.getUTCMonth() + 1).padStart(2, "0"),
    String(parsed.getUTCDate()).padStart(2, "0")
  ].join("-");
}

function normalizeIanaTimeZone(value) {
  const requested = text(value);
  if (!requested) return "";
  try {
    return new Intl.DateTimeFormat("en-US", { timeZone: requested })
      .resolvedOptions()
      .timeZone;
  } catch {
    return "";
  }
}

function calendarDateAtISO(value, timeZone) {
  const instant = validISO(value, "nowISO");
  const normalizedTimeZone = normalizeIanaTimeZone(timeZone);
  if (!normalizedTimeZone) {
    throw new PostEventCloseoutError(
      "failed-precondition",
      "A valid tenant IANA time zone is required for closeout calendar evaluation."
    );
  }
  const parts = new Intl.DateTimeFormat("en-US", {
    calendar: "gregory",
    numberingSystem: "latn",
    timeZone: normalizedTimeZone,
    year: "numeric",
    month: "2-digit",
    day: "2-digit"
  }).formatToParts(new Date(instant));
  const values = Object.fromEntries(parts.map((part) => [part.type, part.value]));
  return dateOnly(`${values.year}-${values.month}-${values.day}`, "tenant calendar date");
}

function normalizeActor(value, label = "actor") {
  const actor = isRecord(value) ? value : {};
  const uid = opaqueId(actor.uid, `${label} uid`);
  const email = text(actor.email).toLowerCase();
  const role = text(actor.role).toLowerCase();
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email) || !STAFF_ROLE_SET.has(role)) {
    throw new PostEventCloseoutError(
      "permission-denied",
      `${label} must contain same-tenant admin or sales evidence.`
    );
  }
  return Object.freeze({ uid, email, role });
}

function buildPostEventCloseoutPolicySnapshot(settings = {}) {
  const source = isRecord(settings) ? settings : {};
  const timeZone = normalizeIanaTimeZone(source.businessTimeZone);
  const configured = Boolean(timeZone);
  return deepFreeze({
    version: POST_EVENT_CLOSEOUT_POLICY_VERSION,
    state: configured ? "configured" : "blocked_configuration",
    source: "organization_settings",
    timeZone,
    dueBoundary: "tenant_calendar_date",
    offsetDays: POST_EVENT_CLOSEOUT_OFFSET_DAYS,
    blockedReason: configured ? "" : "tenant_time_zone_missing_or_invalid"
  });
}

function acceptedRevisionMatches(receipt, sourceVersionId) {
  const revisionId = text(receipt?.quoteRevisionId);
  if (revisionId === sourceVersionId) return true;
  const portalIssuedAtISO = optionalISO(receipt?.portalIssuedAtISO);
  return Boolean(
    portalIssuedAtISO
    && revisionId === `${sourceVersionId}@${portalIssuedAtISO}`
  );
}

function versionIdOf(version) {
  return text(version?.versionId || version?.id || version?.revisionId);
}

function resolvePostEventCloseoutSource({
  organizationId,
  quoteId,
  sourceQuote,
  sourceVersion,
  acceptanceReceiptDocument
} = {}) {
  const orgId = opaqueId(organizationId, "organizationId");
  const id = opaqueId(quoteId, "quoteId");
  const quote = isRecord(sourceQuote) ? sourceQuote : {};
  const version = isRecord(sourceVersion) ? sourceVersion : {};
  const snapshot = isRecord(version.snapshot) ? version.snapshot : null;
  const receipt = isRecord(quote.acceptanceReceipt) ? quote.acceptanceReceipt : null;
  const receiptDocument = isRecord(acceptanceReceiptDocument)
    ? acceptanceReceiptDocument
    : null;

  if (text(quote.organizationId) !== orgId) {
    throw new PostEventCloseoutError(
      "permission-denied",
      "The booked quote is outside this organization."
    );
  }
  if (text(quote.id || id) !== id || text(quote.status).toLowerCase() !== "booked") {
    throw new PostEventCloseoutError(
      "failed-precondition",
      "Post-event closeout requires the exact booked quote."
    );
  }

  const customerId = opaqueId(quote.customerId, "customerId");
  const sourceVersionId = opaqueId(
    quote.activeVersionId || quote.versionMeta?.versionId,
    "accepted sourceVersionId"
  );
  if (!receipt) {
    throw new PostEventCloseoutError(
      "failed-precondition",
      "The booked quote is missing acceptance evidence."
    );
  }
  const acceptanceReceiptId = opaqueId(receipt.receiptId, "acceptanceReceiptId");
  const acceptedAtISO = validISO(receipt.acceptedAtISO, "acceptedAtISO");
  const portalIssuedAtISO = validISO(receipt.portalIssuedAtISO, "portalIssuedAtISO");
  if (!acceptedRevisionMatches(receipt, sourceVersionId)) {
    throw new PostEventCloseoutError(
      "failed-precondition",
      "The acceptance receipt is not bound to the active accepted proposal version."
    );
  }

  const proposalSnapshot = isRecord(receiptDocument?.proposalSnapshot)
    ? receiptDocument.proposalSnapshot
    : null;
  const recordedSnapshotSha256 = text(receipt.snapshotSha256).toLowerCase();
  const calculatedSnapshotSha256 = proposalSnapshot
    ? createHash("sha256").update(JSON.stringify(proposalSnapshot)).digest("hex")
    : "";
  if (
    !receiptDocument
    || text(receiptDocument.receiptId) !== acceptanceReceiptId
    || text(receiptDocument.organizationId) !== orgId
    || text(receiptDocument.quoteId) !== id
    || text(receiptDocument.quoteRevisionId) !== text(receipt.quoteRevisionId)
    || optionalISO(receiptDocument.acceptedAtISO) !== acceptedAtISO
    || optionalISO(receiptDocument.portalIssuedAtISO) !== portalIssuedAtISO
    || text(receiptDocument.snapshotSha256).toLowerCase() !== recordedSnapshotSha256
    || !/^[a-f0-9]{64}$/.test(recordedSnapshotSha256)
    || calculatedSnapshotSha256 !== recordedSnapshotSha256
    || text(proposalSnapshot?.organizationId) !== orgId
    || text(proposalSnapshot?.quoteId) !== id
    || text(proposalSnapshot?.revisionId) !== text(receipt.quoteRevisionId)
    || optionalISO(proposalSnapshot?.portalIssuedAtISO) !== portalIssuedAtISO
  ) {
    throw new PostEventCloseoutError(
      "failed-precondition",
      "The private proposal acceptance receipt does not verify the accepted commercial snapshot."
    );
  }

  const eventDate = dateOnly(quote.event?.date, "booked event date");
  const bookedAtISO = validISO(
    quote.booking?.bookedAtISO || quote.lifecycle?.bookedAtISO,
    "bookedAtISO"
  );
  if (
    version.legacySynthetic === true
    || !snapshot
    || versionIdOf(version) !== sourceVersionId
    || text(version.quoteId) !== id
    || text(version.organizationId) !== orgId
    || text(snapshot.id) !== id
    || text(snapshot.organizationId) !== orgId
    || text(version.customerId || snapshot.customerId) !== customerId
    || (text(snapshot.customerId) && text(snapshot.customerId) !== customerId)
    || dateOnly(snapshot.event?.date, "accepted source event date") !== eventDate
  ) {
    throw new PostEventCloseoutError(
      "failed-precondition",
      "The immutable accepted source version failed quote, customer, event, or organization checks."
    );
  }

  return deepFreeze({
    organizationId: orgId,
    quoteId: id,
    customerId,
    sourceVersionId,
    acceptanceReceiptId,
    acceptedAtISO,
    portalIssuedAtISO,
    bookedAtISO,
    eventDate
  });
}

function buildPostEventCloseoutId(input = {}) {
  const organizationId = opaqueId(input.organizationId, "organizationId");
  const quoteId = opaqueId(input.quoteId, "quoteId");
  const sourceVersionId = opaqueId(input.sourceVersionId, "sourceVersionId");
  const acceptanceReceiptId = opaqueId(
    input.acceptanceReceiptId,
    "acceptanceReceiptId"
  );
  const digest = createHash("sha256")
    .update([
      organizationId,
      quoteId,
      sourceVersionId,
      acceptanceReceiptId
    ].join("\u0000"))
    .digest("hex");
  return `closeout_${digest.slice(0, 48)}`;
}

function buildInitialReviewItems() {
  return Object.fromEntries(POST_EVENT_CLOSEOUT_REVIEW_ITEM_CODES.map((code) => [
    code,
    {
      state: "pending",
      reviewedAtISO: "",
      reviewedBy: null,
      lastActionReceiptId: ""
    }
  ]));
}

function normalizeReviewItems(value) {
  const reviewItems = isRecord(value) ? value : {};
  const normalized = {};
  for (const code of POST_EVENT_CLOSEOUT_REVIEW_ITEM_CODES) {
    const item = isRecord(reviewItems[code]) ? reviewItems[code] : null;
    const state = text(item?.state).toLowerCase();
    if (!item || !REVIEW_ITEM_STATE_SET.has(state)) {
      throw new PostEventCloseoutError(
        "failed-precondition",
        `Closeout review item ${code} is missing or invalid.`
      );
    }
    const reviewedAtISO = optionalISO(item.reviewedAtISO);
    let reviewedBy = null;
    if (state === "reviewed") {
      if (!reviewedAtISO) {
        throw new PostEventCloseoutError(
          "failed-precondition",
          `Closeout review item ${code} is missing review timestamp evidence.`
        );
      }
      reviewedBy = normalizeActor(item.reviewedBy, `${code} reviewer`);
    } else if (text(item.reviewedAtISO) || item.reviewedBy) {
      throw new PostEventCloseoutError(
        "failed-precondition",
        `Pending closeout review item ${code} cannot contain completed review evidence.`
      );
    }
    normalized[code] = {
      state,
      reviewedAtISO: state === "reviewed" ? reviewedAtISO : "",
      reviewedBy,
      lastActionReceiptId: text(item.lastActionReceiptId)
    };
  }
  return normalized;
}

function derivePostEventCloseoutState({ reviewItems, policy } = {}) {
  const policyState = text(policy?.state).toLowerCase();
  if (policyState === "blocked_configuration") return "blocked_configuration";
  if (policyState !== "configured") {
    throw new PostEventCloseoutError(
      "failed-precondition",
      "Closeout policy state must be configured or blocked_configuration."
    );
  }
  const normalized = normalizeReviewItems(reviewItems);
  return POST_EVENT_CLOSEOUT_REVIEW_ITEM_CODES.every(
    (code) => normalized[code].state === "reviewed"
  ) ? "completed" : "pending";
}

function buildPostEventCloseoutRecord({
  organizationId,
  quoteId,
  sourceQuote,
  sourceVersion,
  acceptanceReceiptDocument,
  settings = {},
  actor,
  nowISO
} = {}) {
  const source = resolvePostEventCloseoutSource({
    organizationId,
    quoteId,
    sourceQuote,
    sourceVersion,
    acceptanceReceiptDocument
  });
  const createdAtISO = validISO(nowISO, "createdAtISO");
  const createdBy = normalizeActor(actor, "closeout creator");
  const policy = buildPostEventCloseoutPolicySnapshot(settings);
  const reviewItems = buildInitialReviewItems();
  const closeoutId = buildPostEventCloseoutId(source);

  return deepFreeze({
    schemaVersion: POST_EVENT_CLOSEOUT_SCHEMA_VERSION,
    closeoutId,
    organizationId: source.organizationId,
    quoteId: source.quoteId,
    customerId: source.customerId,
    sourceVersionId: source.sourceVersionId,
    acceptanceReceiptId: source.acceptanceReceiptId,
    sourceAcceptedAtISO: source.acceptedAtISO,
    sourcePortalIssuedAtISO: source.portalIssuedAtISO,
    sourceBookedAtISO: source.bookedAtISO,
    eventDate: source.eventDate,
    dueDate: addCalendarDaysDateOnly(source.eventDate),
    policy,
    state: derivePostEventCloseoutState({ reviewItems, policy }),
    reviewItems,
    completedAtISO: "",
    completedBy: null,
    createdAtISO,
    createdBy,
    updatedAtISO: createdAtISO
  });
}

function assertPostEventCloseoutMatchesSource(record, source) {
  const closeout = isRecord(record) ? record : {};
  const normalizedSource = isRecord(source) ? source : {};
  const expectedCloseoutId = buildPostEventCloseoutId(normalizedSource);
  if (
    Number(closeout.schemaVersion) !== POST_EVENT_CLOSEOUT_SCHEMA_VERSION
    || text(closeout.closeoutId) !== expectedCloseoutId
    || text(closeout.organizationId) !== text(normalizedSource.organizationId)
    || text(closeout.quoteId) !== text(normalizedSource.quoteId)
    || text(closeout.customerId) !== text(normalizedSource.customerId)
    || text(closeout.sourceVersionId) !== text(normalizedSource.sourceVersionId)
    || text(closeout.acceptanceReceiptId) !== text(normalizedSource.acceptanceReceiptId)
    || optionalISO(closeout.sourceAcceptedAtISO) !== text(normalizedSource.acceptedAtISO)
    || optionalISO(closeout.sourcePortalIssuedAtISO) !== text(normalizedSource.portalIssuedAtISO)
    || optionalISO(closeout.sourceBookedAtISO) !== text(normalizedSource.bookedAtISO)
    || text(closeout.eventDate) !== text(normalizedSource.eventDate)
    || text(closeout.dueDate) !== addCalendarDaysDateOnly(normalizedSource.eventDate)
  ) {
    throw new PostEventCloseoutError(
      "failed-precondition",
      "The closeout record no longer matches the exact booked and accepted source."
    );
  }
  return true;
}

function normalizePostEventCloseoutPolicyRefreshRequest(input = {}) {
  const organizationId = opaqueId(input.organizationId, "organizationId");
  const quoteId = opaqueId(input.quoteId, "quoteId");
  const closeoutId = opaqueId(input.closeoutId, "closeoutId");
  const requestId = text(input.requestId);
  if (!REQUEST_ID_PATTERN.test(requestId) || /^[^@\s]+@[^@\s]+$/.test(requestId)) {
    throw new PostEventCloseoutError(
      "invalid-argument",
      "Closeout configuration requestId is invalid."
    );
  }
  const digest = createHash("sha256")
    .update([organizationId, closeoutId, requestId, "refresh_configuration"].join("\u0000"))
    .digest("hex");
  return deepFreeze({
    organizationId,
    quoteId,
    closeoutId,
    requestId,
    action: "refresh_configuration",
    receiptId: `closeout_action_${digest.slice(0, 48)}`
  });
}

function planPostEventCloseoutPolicyRefresh({
  request,
  record,
  source,
  settings,
  actor,
  nowISO,
  existingReceipt = null
} = {}) {
  const normalizedRequest = normalizePostEventCloseoutPolicyRefreshRequest(request);
  const closeout = isRecord(record) ? record : {};
  assertPostEventCloseoutMatchesSource(closeout, source);
  if (
    text(closeout.organizationId) !== normalizedRequest.organizationId
    || text(closeout.quoteId) !== normalizedRequest.quoteId
    || text(closeout.closeoutId) !== normalizedRequest.closeoutId
  ) {
    throw new PostEventCloseoutError(
      "permission-denied",
      "The closeout configuration refresh is outside the reviewed scope."
    );
  }

  const currentPolicy = buildPostEventCloseoutPolicySnapshot(settings);
  if (currentPolicy.state !== "configured") {
    throw new PostEventCloseoutError(
      "failed-precondition",
      "Set a valid tenant business time zone before refreshing closeout configuration."
    );
  }
  const recordedAtISO = validISO(nowISO, "recordedAtISO");
  const recordedBy = normalizeActor(actor, "closeout configuration reviewer");
  if (existingReceipt) {
    const receipt = isRecord(existingReceipt) ? existingReceipt : {};
    if (
      Number(receipt.schemaVersion) !== POST_EVENT_CLOSEOUT_SCHEMA_VERSION
      || text(receipt.receiptId) !== normalizedRequest.receiptId
      || text(receipt.requestId) !== normalizedRequest.requestId
      || text(receipt.organizationId) !== normalizedRequest.organizationId
      || text(receipt.quoteId) !== normalizedRequest.quoteId
      || text(receipt.closeoutId) !== normalizedRequest.closeoutId
      || text(receipt.action) !== normalizedRequest.action
      || text(receipt.resultPolicyState) !== "configured"
      || normalizeIanaTimeZone(receipt.resultTimeZone) !== currentPolicy.timeZone
      || !optionalISO(receipt.recordedAtISO)
      || !isRecord(receipt.recordedBy)
    ) {
      throw new PostEventCloseoutError(
        "already-exists",
        "The closeout configuration request identity is bound to another receipt."
      );
    }
    normalizeActor(receipt.recordedBy, "recorded closeout configuration actor");
    return deepFreeze({
      kind: "reconcile",
      idempotent: true,
      request: normalizedRequest,
      nextRecord: null,
      receipt: { ...receipt }
    });
  }

  const priorPolicyState = text(closeout.policy?.state);
  const priorTimeZone = normalizeIanaTimeZone(closeout.policy?.timeZone);
  const applied = priorPolicyState !== "configured" || priorTimeZone !== currentPolicy.timeZone;
  const nextState = derivePostEventCloseoutState({
    reviewItems: closeout.reviewItems,
    policy: currentPolicy
  });
  const nextRecord = applied
    ? {
        ...closeout,
        policy: currentPolicy,
        state: nextState,
        completedAtISO: nextState === "completed" ? optionalISO(closeout.completedAtISO) : "",
        completedBy: nextState === "completed" && isRecord(closeout.completedBy)
          ? closeout.completedBy
          : null,
        updatedAtISO: recordedAtISO
      }
    : null;
  const receipt = {
    schemaVersion: POST_EVENT_CLOSEOUT_SCHEMA_VERSION,
    receiptId: normalizedRequest.receiptId,
    requestId: normalizedRequest.requestId,
    organizationId: normalizedRequest.organizationId,
    quoteId: normalizedRequest.quoteId,
    closeoutId: normalizedRequest.closeoutId,
    action: normalizedRequest.action,
    priorPolicyState,
    resultPolicyState: "configured",
    priorTimeZone,
    resultTimeZone: currentPolicy.timeZone,
    resultCloseoutState: nextState,
    applied,
    recordedAtISO,
    recordedBy
  };
  return deepFreeze({
    kind: applied ? "apply" : "noop",
    idempotent: false,
    request: normalizedRequest,
    nextRecord,
    receipt
  });
}

function normalizePostEventCloseoutActionRequest(input = {}) {
  const organizationId = opaqueId(input.organizationId, "organizationId");
  const quoteId = opaqueId(input.quoteId, "quoteId");
  const closeoutId = opaqueId(input.closeoutId, "closeoutId");
  const itemCode = text(input.itemCode).toLowerCase();
  const action = text(input.action).toLowerCase();
  const requestId = text(input.requestId);
  const note = text(input.note);
  if (!REVIEW_ITEM_CODE_SET.has(itemCode)) {
    throw new PostEventCloseoutError("invalid-argument", "Closeout review item is invalid.");
  }
  if (!ACTION_SET.has(action)) {
    throw new PostEventCloseoutError("invalid-argument", "Closeout action must be review or reopen.");
  }
  if (!REQUEST_ID_PATTERN.test(requestId) || /^[^@\s]+@[^@\s]+$/.test(requestId)) {
    throw new PostEventCloseoutError("invalid-argument", "Closeout requestId is invalid.");
  }
  if (note.length > 800) {
    throw new PostEventCloseoutError(
      "invalid-argument",
      "Closeout action note must be 800 characters or fewer."
    );
  }
  const targetState = action === "review" ? "reviewed" : "pending";
  const digest = createHash("sha256")
    .update([organizationId, closeoutId, requestId].join("\u0000"))
    .digest("hex");
  return deepFreeze({
    organizationId,
    quoteId,
    closeoutId,
    itemCode,
    action,
    targetState,
    requestId,
    note,
    receiptId: `closeout_action_${digest.slice(0, 48)}`
  });
}

function normalizeExistingActionReceipt(value) {
  const receipt = isRecord(value) ? value : {};
  return {
    schemaVersion: Number(receipt.schemaVersion),
    receiptId: text(receipt.receiptId),
    requestId: text(receipt.requestId),
    organizationId: text(receipt.organizationId),
    quoteId: text(receipt.quoteId),
    closeoutId: text(receipt.closeoutId),
    itemCode: text(receipt.itemCode),
    action: text(receipt.action),
    targetState: text(receipt.targetState),
    priorItemState: text(receipt.priorItemState),
    resultItemState: text(receipt.resultItemState),
    priorCloseoutState: text(receipt.priorCloseoutState),
    resultCloseoutState: text(receipt.resultCloseoutState),
    applied: receipt.applied === true,
    note: text(receipt.note),
    recordedAtISO: optionalISO(receipt.recordedAtISO),
    recordedBy: isRecord(receipt.recordedBy) ? { ...receipt.recordedBy } : null
  };
}

function receiptMatchesRequest(receipt, request) {
  return Number(receipt.schemaVersion) === POST_EVENT_CLOSEOUT_SCHEMA_VERSION
    && receipt.receiptId === request.receiptId
    && receipt.requestId === request.requestId
    && receipt.organizationId === request.organizationId
    && receipt.quoteId === request.quoteId
    && receipt.closeoutId === request.closeoutId
    && receipt.itemCode === request.itemCode
    && receipt.action === request.action
    && receipt.targetState === request.targetState
    && receipt.note === request.note
    && REVIEW_ITEM_STATE_SET.has(receipt.priorItemState)
    && receipt.resultItemState === request.targetState
    && CLOSEOUT_STATE_SET.has(receipt.priorCloseoutState)
    && CLOSEOUT_STATE_SET.has(receipt.resultCloseoutState)
    && Boolean(receipt.recordedAtISO)
    && Boolean(receipt.recordedBy);
}

function planPostEventCloseoutAction({
  request,
  record,
  source,
  actor,
  nowISO,
  existingReceipt = null
} = {}) {
  const normalizedRequest = normalizePostEventCloseoutActionRequest(request);
  if (existingReceipt) {
    const receipt = normalizeExistingActionReceipt(existingReceipt);
    if (!receiptMatchesRequest(receipt, normalizedRequest)) {
      throw new PostEventCloseoutError(
        "already-exists",
        "The closeout request identity is already bound to a different action receipt."
      );
    }
    normalizeActor(receipt.recordedBy, "recorded closeout actor");
    return deepFreeze({
      kind: "reconcile",
      idempotent: true,
      request: normalizedRequest,
      nextRecord: null,
      receipt
    });
  }

  const closeout = isRecord(record) ? record : {};
  assertPostEventCloseoutMatchesSource(closeout, source);
  if (
    text(closeout.organizationId) !== normalizedRequest.organizationId
    || text(closeout.quoteId) !== normalizedRequest.quoteId
    || text(closeout.closeoutId) !== normalizedRequest.closeoutId
  ) {
    throw new PostEventCloseoutError(
      "permission-denied",
      "The closeout action is outside the reviewed organization, quote, or record scope."
    );
  }
  if (text(closeout.policy?.state) !== "configured") {
    throw new PostEventCloseoutError(
      "failed-precondition",
      "Configure a valid tenant business time zone before recording closeout review."
    );
  }
  const recordedAtISO = validISO(nowISO, "recordedAtISO");
  const recordedBy = normalizeActor(actor, "closeout reviewer");
  const tenantDate = calendarDateAtISO(recordedAtISO, closeout.policy?.timeZone);
  const dueDate = dateOnly(closeout.dueDate, "closeout dueDate");
  if (tenantDate < dueDate) {
    throw new PostEventCloseoutError(
      "failed-precondition",
      `Post-event closeout is scheduled for ${dueDate} in the recorded tenant calendar.`
    );
  }

  const reviewItems = normalizeReviewItems(closeout.reviewItems);
  const priorItemState = reviewItems[normalizedRequest.itemCode].state;
  const priorCloseoutState = text(closeout.state).toLowerCase();
  if (!CLOSEOUT_STATE_SET.has(priorCloseoutState)) {
    throw new PostEventCloseoutError("failed-precondition", "Closeout state is invalid.");
  }
  const applied = priorItemState !== normalizedRequest.targetState;
  let nextRecord = null;
  let resultCloseoutState = priorCloseoutState;

  if (applied) {
    const nextReviewItems = {
      ...reviewItems,
      [normalizedRequest.itemCode]: normalizedRequest.targetState === "reviewed"
        ? {
            state: "reviewed",
            reviewedAtISO: recordedAtISO,
            reviewedBy: recordedBy,
            lastActionReceiptId: normalizedRequest.receiptId
          }
        : {
            state: "pending",
            reviewedAtISO: "",
            reviewedBy: null,
            lastActionReceiptId: normalizedRequest.receiptId
          }
    };
    resultCloseoutState = derivePostEventCloseoutState({
      reviewItems: nextReviewItems,
      policy: closeout.policy
    });
    const completedNow = resultCloseoutState === "completed";
    nextRecord = {
      ...closeout,
      reviewItems: nextReviewItems,
      state: resultCloseoutState,
      completedAtISO: completedNow
        ? optionalISO(closeout.completedAtISO) || recordedAtISO
        : "",
      completedBy: completedNow
        ? (isRecord(closeout.completedBy) ? closeout.completedBy : recordedBy)
        : null,
      updatedAtISO: recordedAtISO
    };
  }

  const receipt = {
    schemaVersion: POST_EVENT_CLOSEOUT_SCHEMA_VERSION,
    receiptId: normalizedRequest.receiptId,
    requestId: normalizedRequest.requestId,
    organizationId: normalizedRequest.organizationId,
    quoteId: normalizedRequest.quoteId,
    closeoutId: normalizedRequest.closeoutId,
    itemCode: normalizedRequest.itemCode,
    action: normalizedRequest.action,
    targetState: normalizedRequest.targetState,
    priorItemState,
    resultItemState: normalizedRequest.targetState,
    priorCloseoutState,
    resultCloseoutState,
    applied,
    note: normalizedRequest.note,
    recordedAtISO,
    recordedBy
  };

  return deepFreeze({
    kind: applied ? "apply" : "noop",
    idempotent: false,
    request: normalizedRequest,
    nextRecord,
    receipt
  });
}

module.exports = {
  POST_EVENT_CLOSEOUT_OFFSET_DAYS,
  POST_EVENT_CLOSEOUT_POLICY_VERSION,
  POST_EVENT_CLOSEOUT_REVIEW_ITEM_CODES,
  POST_EVENT_CLOSEOUT_SCHEMA_VERSION,
  PostEventCloseoutError,
  addCalendarDaysDateOnly,
  assertPostEventCloseoutMatchesSource,
  buildPostEventCloseoutId,
  buildPostEventCloseoutPolicySnapshot,
  buildPostEventCloseoutRecord,
  calendarDateAtISO,
  derivePostEventCloseoutState,
  normalizeIanaTimeZone,
  normalizePostEventCloseoutActionRequest,
  normalizePostEventCloseoutPolicyRefreshRequest,
  planPostEventCloseoutAction,
  planPostEventCloseoutPolicyRefresh,
  resolvePostEventCloseoutSource
};
