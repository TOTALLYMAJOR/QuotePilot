const { createHash } = require("node:crypto");

const PORTAL_CONVERSATION_BODY_MAX_LENGTH = 1200;
const PORTAL_CONVERSATION_TOTAL_MESSAGE_LIMIT = 500;
const PORTAL_CONVERSATION_PAGE_SIZE = 50;
const PORTAL_CONVERSATION_RATE_LIMIT = 8;
const PORTAL_CONVERSATION_RATE_WINDOW_MS = 5 * 60 * 1000;
const PORTAL_CONVERSATION_VISIBLE_STATUSES = new Set([
  "sent",
  "viewed",
  "accepted",
  "declined",
  "booked"
]);

class PortalConversationError extends Error {
  constructor(code, message) {
    super(message);
    this.name = "PortalConversationError";
    this.code = code;
  }
}

function text(value, maxLength = 500) {
  return String(value ?? "").trim().slice(0, maxLength);
}

function strictText(value, maxLength) {
  const normalized = String(value ?? "").trim();
  return normalized.length <= maxLength ? normalized : "";
}

function normalizeOrganizationId(value) {
  const normalized = strictText(value, 160).toLowerCase();
  return /^[a-z0-9][a-z0-9_-]{0,159}$/.test(normalized) ? normalized : "";
}

function normalizeDocumentId(value) {
  const normalized = strictText(value, 160);
  return /^[A-Za-z0-9][A-Za-z0-9_-]{0,159}$/.test(normalized) ? normalized : "";
}

function normalizePortalKey(value) {
  const normalized = strictText(value, 128);
  return /^[A-Za-z0-9_-]{20,128}$/.test(normalized) ? normalized : "";
}

function normalizeClientRequestId(value) {
  const normalized = strictText(value, 96);
  return /^[A-Za-z0-9][A-Za-z0-9._:-]{15,95}$/.test(normalized) ? normalized : "";
}

function normalizePortalConversationCursor(value) {
  if (value === undefined || value === null || value === "") return null;
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    throw new PortalConversationError("invalid-argument", "Conversation page cursor is invalid.");
  }
  const createdAtMs = Number(value.createdAtMs);
  const messageId = normalizeDocumentId(value.messageId);
  if (!Number.isSafeInteger(createdAtMs) || createdAtMs < 0 || !messageId) {
    throw new PortalConversationError("invalid-argument", "Conversation page cursor is invalid.");
  }
  return { createdAtMs, messageId };
}

function normalizeActorName(value, fallback = "Quote participant") {
  const normalized = text(value, 160).replace(/\s+/g, " ");
  return normalized || fallback;
}

function normalizeBody(value) {
  const body = String(value ?? "").trim();
  if (!body) {
    throw new PortalConversationError("invalid-argument", "Enter a message before sending.");
  }
  if (body.length > PORTAL_CONVERSATION_BODY_MAX_LENGTH) {
    throw new PortalConversationError(
      "invalid-argument",
      `Messages must be ${PORTAL_CONVERSATION_BODY_MAX_LENGTH} characters or fewer.`
    );
  }
  return body;
}

function normalizePortalConversationRequest(data = {}, { requireBody = false } = {}) {
  const accessMode = text(data?.accessMode, 16).toLowerCase();
  if (!new Set(["staff", "portal"]).has(accessMode)) {
    throw new PortalConversationError("invalid-argument", "A valid conversation access mode is required.");
  }

  const portalKey = normalizePortalKey(data?.portalKey);
  const organizationId = normalizeOrganizationId(data?.organizationId);
  const quoteId = normalizeDocumentId(data?.quoteId);
  if (accessMode === "portal" && !portalKey) {
    throw new PortalConversationError("invalid-argument", "A valid customer portal token is required.");
  }
  if (accessMode === "staff" && (!organizationId || !quoteId)) {
    throw new PortalConversationError(
      "invalid-argument",
      "organizationId and quoteId are required for staff conversation access."
    );
  }

  const clientRequestId = requireBody
    ? normalizeClientRequestId(data?.clientRequestId)
    : "";
  if (requireBody && !clientRequestId) {
    throw new PortalConversationError(
      "invalid-argument",
      "A valid client request id is required for safe message retry."
    );
  }

  const before = requireBody ? null : normalizePortalConversationCursor(data?.before);
  const after = requireBody ? null : normalizePortalConversationCursor(data?.after);
  if (before && after) {
    throw new PortalConversationError(
      "invalid-argument",
      "Conversation history and catch-up cursors cannot be combined."
    );
  }

  return {
    accessMode,
    portalKey,
    organizationId,
    quoteId,
    clientRequestId,
    before,
    after,
    body: requireBody ? normalizeBody(data?.body) : ""
  };
}

function buildPortalConversationPage(documents = [], { direction = "older" } = {}) {
  const catchUp = direction === "newer";
  const bounded = (Array.isArray(documents) ? documents : [])
    .slice(0, PORTAL_CONVERSATION_PAGE_SIZE + 1);
  const hasContinuation = bounded.length > PORTAL_CONVERSATION_PAGE_SIZE;
  const pageDocuments = bounded.slice(0, PORTAL_CONVERSATION_PAGE_SIZE);
  const projected = pageDocuments
    .map((document) => projectPortalConversationMessage(document?.data || {}))
    .filter(Boolean);
  const messages = catchUp ? projected : projected.reverse();
  const oldest = catchUp
    ? pageDocuments[0] || null
    : pageDocuments[pageDocuments.length - 1] || null;
  const newest = catchUp
    ? pageDocuments[pageDocuments.length - 1] || null
    : pageDocuments[0] || null;
  const cursor = (document) => document ? {
    createdAtMs: Number(document.data?.createdAtMs),
    messageId: normalizeDocumentId(document.id)
  } : null;
  return {
    messages,
    page: {
      pageSize: PORTAL_CONVERSATION_PAGE_SIZE,
      returned: messages.length,
      hasOlder: catchUp ? false : hasContinuation,
      hasNewer: catchUp ? hasContinuation : false,
      oldestCursor: cursor(oldest),
      newestCursor: cursor(newest)
    }
  };
}

function sha256(value) {
  return createHash("sha256").update(String(value ?? "")).digest("hex");
}

function buildPortalConversationRequestKey({ actorRateKey, clientRequestId } = {}) {
  const actor = text(actorRateKey, 128);
  const requestId = normalizeClientRequestId(clientRequestId);
  if (!actor || !requestId) {
    throw new PortalConversationError("invalid-argument", "Conversation retry identity is incomplete.");
  }
  return `request_${sha256(`${actor}|${requestId}`)}`;
}

function buildPortalConversationRateKey({ accessMode, organizationId, quoteId, staffUid } = {}) {
  const mode = text(accessMode, 16).toLowerCase();
  const orgId = normalizeOrganizationId(organizationId);
  const id = normalizeDocumentId(quoteId);
  if (!orgId || !id || !new Set(["staff", "portal"]).has(mode)) {
    throw new PortalConversationError("failed-precondition", "Conversation actor scope is incomplete.");
  }
  const principal = mode === "staff" ? text(staffUid, 160) : "customer";
  if (mode === "staff" && !principal) {
    throw new PortalConversationError("failed-precondition", "Staff conversation identity is incomplete.");
  }
  return `actor_${sha256(`${mode}|${orgId}|${id}|${principal}`)}`;
}

function assertPortalConversationActivation({
  quote,
  quoteId,
  organizationId,
  portalSnapshot,
  requestedPortalKey = "",
  organizationActive = false,
  organizationTombstoned = false,
  operation = "read",
  nowISO,
  assertPortalActivation
} = {}) {
  const orgId = normalizeOrganizationId(organizationId);
  const id = normalizeDocumentId(quoteId);
  const quoteOrgId = normalizeOrganizationId(quote?.organizationId);
  const portalOrgId = normalizeOrganizationId(portalSnapshot?.organizationId);
  const portalQuoteId = normalizeDocumentId(portalSnapshot?.quoteId);
  const quotePortalKey = normalizePortalKey(quote?.portalKey);
  const portalKey = normalizePortalKey(portalSnapshot?.portalKey);
  const bearerPortalKey = requestedPortalKey ? normalizePortalKey(requestedPortalKey) : "";
  const quoteStatus = text(quote?.status, 32).toLowerCase();
  const portalStatus = text(portalSnapshot?.status, 32).toLowerCase();
  const normalizedOperation = text(operation, 16).toLowerCase();

  if (!organizationActive || organizationTombstoned) {
    throw new PortalConversationError(
      "failed-precondition",
      "This organization is not active for portal conversation."
    );
  }
  if (
    !orgId
    || !id
    || quoteOrgId !== orgId
    || portalOrgId !== orgId
    || portalQuoteId !== id
    || !quotePortalKey
    || portalKey !== quotePortalKey
    || (bearerPortalKey && bearerPortalKey !== quotePortalKey)
  ) {
    throw new PortalConversationError(
      "permission-denied",
      "The customer portal does not match this quote conversation."
    );
  }
  if (normalizedOperation === "send" && quoteStatus === "declined") {
    throw new PortalConversationError(
      "failed-precondition",
      "This proposal was declined. The conversation is read-only; contact the caterer directly to restart planning."
    );
  }
  if (!new Set(["read", "send"]).has(normalizedOperation)) {
    throw new PortalConversationError("internal", "Conversation operation is invalid.");
  }
  if (
    !PORTAL_CONVERSATION_VISIBLE_STATUSES.has(quoteStatus)
    || portalStatus !== quoteStatus
    || text(quote?.deletedAtISO, 64)
    || text(portalSnapshot?.deletedAtISO, 64)
  ) {
    throw new PortalConversationError(
      "failed-precondition",
      "This quote conversation is not available from the current portal."
    );
  }
  if (typeof assertPortalActivation !== "function") {
    throw new PortalConversationError("internal", "Portal activation validation is unavailable.");
  }

  const activation = assertPortalActivation({
    quote,
    quoteId: id,
    organizationId: orgId,
    portalSnapshot,
    nowISO
  });
  return {
    organizationId: orgId,
    quoteId: id,
    portalKey: quotePortalKey,
    portalIssuedAtISO: text(activation?.portalIssuedAtISO, 64),
    revisionId: text(activation?.revisionId, 160),
    providerAcceptedAtISO: text(activation?.providerAcceptedAtISO, 64)
  };
}

function buildPortalConversationActor({ accessMode, staff, authToken, quote, portalSnapshot } = {}) {
  const mode = text(accessMode, 16).toLowerCase();
  if (mode === "staff") {
    const uid = text(staff?.uid, 160);
    if (!uid) {
      throw new PortalConversationError("unauthenticated", "Staff sign-in is required.");
    }
    const email = text(staff?.email, 254).toLowerCase();
    return {
      type: "staff",
      name: normalizeActorName(authToken?.name || email, "QuotePilot staff"),
      uid,
      role: text(staff?.role, 32).toLowerCase()
    };
  }
  if (mode === "portal") {
    return {
      type: "customer",
      name: normalizeActorName(
        portalSnapshot?.customerName || quote?.customer?.name,
        "Customer"
      ),
      uid: "",
      role: "customer"
    };
  }
  throw new PortalConversationError("invalid-argument", "Conversation actor mode is invalid.");
}

function planPortalConversationRate({ recentSendAtMs = [], nowMs } = {}) {
  const now = Number(nowMs);
  if (!Number.isFinite(now)) {
    throw new PortalConversationError("internal", "Conversation clock is unavailable.");
  }
  const windowStart = now - PORTAL_CONVERSATION_RATE_WINDOW_MS;
  const active = (Array.isArray(recentSendAtMs) ? recentSendAtMs : [])
    .map(Number)
    .filter((value) => Number.isFinite(value) && value > windowStart && value <= now)
    .sort((a, b) => a - b);
  if (active.length >= PORTAL_CONVERSATION_RATE_LIMIT) {
    const retryAfterMs = Math.max(1, active[0] + PORTAL_CONVERSATION_RATE_WINDOW_MS - now);
    throw new PortalConversationError(
      "resource-exhausted",
      `Too many messages were sent. Try again in ${Math.ceil(retryAfterMs / 1000)} seconds.`
    );
  }
  return [...active, now];
}

function assertPortalConversationTotal(messageCount) {
  const count = Number(messageCount || 0);
  if (!Number.isSafeInteger(count) || count < 0) {
    throw new PortalConversationError("failed-precondition", "Conversation count is invalid.");
  }
  if (count >= PORTAL_CONVERSATION_TOTAL_MESSAGE_LIMIT) {
    throw new PortalConversationError(
      "resource-exhausted",
      "This quote conversation has reached its message limit. Continue by phone or email."
    );
  }
  return count + 1;
}

function buildPortalConversationMessage({
  messageId,
  organizationId,
  quoteId,
  activation,
  actor,
  body,
  nowISO,
  nowMs
} = {}) {
  const id = normalizeDocumentId(messageId);
  const normalizedBody = normalizeBody(body);
  if (!id || !activation?.portalKey || !actor?.type || !actor?.name) {
    throw new PortalConversationError("failed-precondition", "Conversation message scope is incomplete.");
  }
  return {
    messageId: id,
    organizationId: normalizeOrganizationId(organizationId),
    quoteId: normalizeDocumentId(quoteId),
    actorType: actor.type,
    actorName: normalizeActorName(actor.name),
    ...(actor.type === "staff" ? {
      actorUid: text(actor.uid, 160),
      actorRole: text(actor.role, 32)
    } : {}),
    body: normalizedBody,
    bodySha256: sha256(normalizedBody),
    portalIssuance: {
      portalKeySha256: sha256(activation.portalKey),
      portalIssuedAtISO: text(activation.portalIssuedAtISO, 64),
      revisionId: text(activation.revisionId, 160)
    },
    createdAtISO: text(nowISO, 64),
    createdAtMs: Number(nowMs)
  };
}

function projectPortalConversationMessage(message = {}) {
  const messageId = normalizeDocumentId(message?.messageId);
  const actorType = text(message?.actorType, 32).toLowerCase();
  const actorName = normalizeActorName(message?.actorName);
  const body = String(message?.body ?? "").trim();
  const createdAtISO = text(message?.createdAtISO, 64);
  if (
    !messageId
    || !new Set(["staff", "customer"]).has(actorType)
    || !body
    || body.length > PORTAL_CONVERSATION_BODY_MAX_LENGTH
    || !Number.isFinite(Date.parse(createdAtISO))
  ) {
    return null;
  }
  return { messageId, actorType, actorName, body, createdAtISO };
}

module.exports = {
  PORTAL_CONVERSATION_BODY_MAX_LENGTH,
  PORTAL_CONVERSATION_RATE_LIMIT,
  PORTAL_CONVERSATION_RATE_WINDOW_MS,
  PORTAL_CONVERSATION_TOTAL_MESSAGE_LIMIT,
  PORTAL_CONVERSATION_PAGE_SIZE,
  PortalConversationError,
  assertPortalConversationActivation,
  assertPortalConversationTotal,
  buildPortalConversationActor,
  buildPortalConversationPage,
  buildPortalConversationMessage,
  buildPortalConversationRateKey,
  buildPortalConversationRequestKey,
  normalizePortalConversationRequest,
  normalizePortalConversationCursor,
  planPortalConversationRate,
  projectPortalConversationMessage,
  sha256
};
