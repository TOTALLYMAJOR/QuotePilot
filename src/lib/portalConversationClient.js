import { httpsCallable } from "firebase/functions";
import { cloudFunctions, firebaseReady } from "./firebase";

export const PORTAL_CONVERSATION_BODY_MAX_LENGTH = 1200;
const GET_CONVERSATION_CALLABLE = "getQuotePortalConversation";
const SEND_MESSAGE_CALLABLE = "sendQuotePortalConversationMessage";
const CONVERSATION_LOAD_CACHE_TTL_MS = 30_000;
const CONVERSATION_LOAD_CACHE_LIMIT = 25;
const conversationLoadCache = new Map();
const conversationLoadsInFlight = new Map();

function text(value, maxLength = 500) {
  return String(value ?? "").trim().slice(0, maxLength);
}

function strictText(value, maxLength) {
  const normalized = String(value ?? "").trim();
  return normalized.length <= maxLength ? normalized : "";
}

function requireConnectedConversation() {
  if (!firebaseReady || !cloudFunctions) {
    throw new Error("Conversation requires a connected QuotePilot workspace.");
  }
}

function normalizeAccess(access = {}) {
  const accessMode = text(access?.accessMode, 16).toLowerCase();
  if (accessMode === "portal") {
    const portalKey = strictText(access?.portalKey, 128);
    if (!/^[A-Za-z0-9_-]{20,128}$/.test(portalKey)) {
      throw new Error("Open the current customer portal link before loading its conversation.");
    }
    return { accessMode, portalKey };
  }
  if (accessMode === "staff") {
    const organizationId = strictText(access?.organizationId, 160).toLowerCase();
    const quoteId = strictText(access?.quoteId, 160);
    if (
      !/^[a-z0-9][a-z0-9_-]{0,159}$/.test(organizationId)
      || !/^[A-Za-z0-9][A-Za-z0-9_-]{0,159}$/.test(quoteId)
    ) {
      throw new Error("Quote and organization are required for staff conversation access.");
    }
    return { accessMode, organizationId, quoteId };
  }
  throw new Error("Conversation access mode is invalid.");
}

function normalizeMessage(message = {}) {
  const messageId = text(message?.messageId, 160);
  const actorType = text(message?.actorType, 32).toLowerCase();
  const actorName = text(message?.actorName, 160) || "Quote participant";
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

function normalizeConversationCursor(value) {
  if (!value || typeof value !== "object" || Array.isArray(value)) return null;
  const createdAtMs = Number(value.createdAtMs);
  const messageId = strictText(value.messageId, 160);
  if (
    !Number.isSafeInteger(createdAtMs)
    || createdAtMs < 0
    || !/^[A-Za-z0-9][A-Za-z0-9_-]{0,159}$/.test(messageId)
  ) return null;
  return { createdAtMs, messageId };
}

function normalizeConversationResponse(data = {}) {
  if (data?.ok !== true || !data?.organizationId || !data?.quoteId) {
    throw new Error("Conversation did not return a valid quote scope.");
  }
  const oldestCursor = normalizeConversationCursor(data?.page?.oldestCursor);
  const newestCursor = normalizeConversationCursor(data?.page?.newestCursor);
  return {
    organizationId: text(data.organizationId, 160),
    quoteId: text(data.quoteId, 160),
    portalIssuedAtISO: text(data.portalIssuedAtISO, 64),
    readOnly: data.readOnly === true,
    readOnlyReason: text(data.readOnlyReason, 500),
    messages: (Array.isArray(data.messages) ? data.messages : [])
      .map(normalizeMessage)
      .filter(Boolean),
    limits: data?.limits && typeof data.limits === "object" ? { ...data.limits } : {},
    idempotent: data.idempotent === true,
    message: normalizeMessage(data.message),
    page: {
      pageSize: Math.max(0, Math.floor(Number(data?.page?.pageSize) || 0)),
      returned: Math.max(0, Math.floor(Number(data?.page?.returned) || 0)),
      hasOlder: data?.page?.hasOlder === true,
      hasNewer: data?.page?.hasNewer === true,
      oldestCursor,
      newestCursor
    }
  };
}

function conversationAccessPrefix(payload) {
  return `${[
    payload.accessMode,
    payload.organizationId,
    payload.quoteId,
    payload.portalKey
  ].map((value) => String(value || "").trim()).join(":")}:`;
}

function conversationLoadKey(payload, cacheScope = "") {
  return `${conversationAccessPrefix(payload)}${[
    payload.before?.createdAtMs,
    payload.before?.messageId,
    payload.after?.createdAtMs,
    payload.after?.messageId,
    strictText(cacheScope, 500)
  ].map((value) => String(value || "").trim()).join(":")}`;
}

function invalidateConversationLoadCache(payload) {
  const prefix = conversationAccessPrefix(payload);
  for (const key of conversationLoadCache.keys()) {
    if (key.startsWith(prefix)) conversationLoadCache.delete(key);
  }
}

function pruneConversationLoadCache(nowMs = Date.now()) {
  for (const [key, entry] of conversationLoadCache) {
    if (nowMs - entry.cachedAtMs > CONVERSATION_LOAD_CACHE_TTL_MS) {
      conversationLoadCache.delete(key);
    }
  }
  while (conversationLoadCache.size > CONVERSATION_LOAD_CACHE_LIMIT) {
    conversationLoadCache.delete(conversationLoadCache.keys().next().value);
  }
}

export function clearConversationLoadMemory() {
  conversationLoadCache.clear();
  conversationLoadsInFlight.clear();
}

export function portalConversationAvailable() {
  return Boolean(firebaseReady && cloudFunctions);
}

export function buildPortalConversationClientRequestId() {
  if (globalThis.crypto?.randomUUID) {
    return `conversation:${globalThis.crypto.randomUUID()}`;
  }
  const random = Math.random().toString(36).slice(2);
  return `conversation:${Date.now().toString(36)}:${random.padEnd(16, "0")}`;
}

export async function loadQuotePortalConversation(access, {
  cacheScope = "",
  forceRefresh = false,
  before = null,
  after = null
} = {}) {
  requireConnectedConversation();
  if (before && after) {
    throw new Error("Conversation history and catch-up cursors cannot be combined.");
  }
  const payload = {
    ...normalizeAccess(access),
    ...(before ? { before: normalizeConversationCursor(before) } : {}),
    ...(after ? { after: normalizeConversationCursor(after) } : {})
  };
  if (before && !payload.before) {
    throw new Error("Conversation page cursor is invalid.");
  }
  if (after && !payload.after) {
    throw new Error("Conversation catch-up cursor is invalid.");
  }
  const key = conversationLoadKey(payload, cacheScope);
  const nowMs = Date.now();
  pruneConversationLoadCache(nowMs);
  if (!forceRefresh) {
    const cached = conversationLoadCache.get(key);
    if (cached && nowMs - cached.cachedAtMs <= CONVERSATION_LOAD_CACHE_TTL_MS) {
      return cached.result;
    }
  }
  const existing = conversationLoadsInFlight.get(key);
  if (existing) return existing;

  const request = (async () => {
    const call = httpsCallable(cloudFunctions, GET_CONVERSATION_CALLABLE);
    const response = await call(payload);
    const result = normalizeConversationResponse(response?.data || {});
    conversationLoadCache.delete(key);
    conversationLoadCache.set(key, { cachedAtMs: Date.now(), result });
    pruneConversationLoadCache();
    return result;
  })();
  conversationLoadsInFlight.set(key, request);
  try {
    return await request;
  } finally {
    if (conversationLoadsInFlight.get(key) === request) {
      conversationLoadsInFlight.delete(key);
    }
  }
}

export async function sendQuotePortalConversationMessage({
  access,
  body,
  clientRequestId
} = {}) {
  requireConnectedConversation();
  const payload = normalizeAccess(access);
  const normalizedBody = String(body ?? "").trim();
  if (!normalizedBody) {
    throw new Error("Enter a message before sending.");
  }
  if (normalizedBody.length > PORTAL_CONVERSATION_BODY_MAX_LENGTH) {
    throw new Error(`Messages must be ${PORTAL_CONVERSATION_BODY_MAX_LENGTH} characters or fewer.`);
  }
  const requestId = strictText(clientRequestId, 96);
  if (!/^[A-Za-z0-9][A-Za-z0-9._:-]{15,95}$/.test(requestId)) {
    throw new Error("A safe message retry id is required.");
  }
  const call = httpsCallable(cloudFunctions, SEND_MESSAGE_CALLABLE);
  const response = await call({
    ...payload,
    body: normalizedBody,
    clientRequestId: requestId
  });
  const result = normalizeConversationResponse(response?.data || {});
  if (!result.message) {
    throw new Error("Message send did not return a valid receipt.");
  }
  invalidateConversationLoadCache(payload);
  return result;
}
