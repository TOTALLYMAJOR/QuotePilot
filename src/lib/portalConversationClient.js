import { httpsCallable } from "firebase/functions";
import { auth, cloudFunctions, firebaseReady } from "./firebase";

export const PORTAL_CONVERSATION_BODY_MAX_LENGTH = 1200;
const GET_CONVERSATION_CALLABLE = "getQuotePortalConversation";
const SEND_MESSAGE_CALLABLE = "sendQuotePortalConversationMessage";
const DEFAULT_CACHE_TTL_MS = 5 * 60 * 1000;
const MAX_CACHE_ENTRIES = 12;
const inFlightConversationLoads = new Map();
const conversationMemory = new Map();

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

function conversationLoadKey(payload = {}) {
  const principal = payload.accessMode === "staff"
    ? text(auth?.currentUser?.uid, 160)
    : "portal";
  return [
    payload.accessMode,
    payload.organizationId || "",
    payload.quoteId || "",
    payload.portalKey || "",
    principal
  ].join(":");
}

function conversationCacheKey(access = {}) {
  let payload;
  try {
    payload = normalizeAccess(access);
  } catch {
    return "";
  }
  if (payload.accessMode === "staff") {
    const uid = text(auth?.currentUser?.uid, 160);
    if (!uid) return "";
    return `staff:${uid}:${payload.organizationId}:${payload.quoteId}`;
  }
  return `portal:${payload.portalKey}`;
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

function normalizeConversationResponse(data = {}) {
  if (data?.ok !== true || !data?.organizationId || !data?.quoteId) {
    throw new Error("Conversation did not return a valid quote scope.");
  }
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
    message: normalizeMessage(data.message)
  };
}

function cloneMessage(message = {}) {
  return {
    messageId: text(message?.messageId, 160),
    actorType: text(message?.actorType, 32),
    actorName: text(message?.actorName, 160),
    body: String(message?.body ?? ""),
    createdAtISO: text(message?.createdAtISO, 64)
  };
}

function cloneConversation(result = {}) {
  return {
    organizationId: text(result?.organizationId, 160),
    quoteId: text(result?.quoteId, 160),
    portalIssuedAtISO: text(result?.portalIssuedAtISO, 64),
    readOnly: result?.readOnly === true,
    readOnlyReason: text(result?.readOnlyReason, 500),
    messages: (Array.isArray(result?.messages) ? result.messages : []).map(cloneMessage),
    limits: result?.limits && typeof result.limits === "object" ? { ...result.limits } : {},
    idempotent: result?.idempotent === true,
    message: result?.message ? cloneMessage(result.message) : null
  };
}

function evictConversationMemoryOverflow() {
  while (conversationMemory.size > MAX_CACHE_ENTRIES) {
    const oldestKey = conversationMemory.keys().next().value;
    if (!oldestKey) return;
    conversationMemory.delete(oldestKey);
  }
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

export function readConversationMemory(access, {
  nowMs = Date.now(),
  ttlMs = DEFAULT_CACHE_TTL_MS
} = {}) {
  const key = conversationCacheKey(access);
  if (!key) return null;
  const entry = conversationMemory.get(key);
  if (!entry) return null;
  // Keep reads side-effect free: React may call this during render, and viewing
  // retained bodies must never extend their freshness window.
  if (!Number.isFinite(entry.cachedAtMs) || nowMs - entry.cachedAtMs > ttlMs) {
    return null;
  }
  return cloneConversation(entry.result);
}

export function writeConversationMemory(access, result, { nowMs = Date.now() } = {}) {
  const key = conversationCacheKey(access);
  if (!key || !result?.quoteId) return false;
  const entry = {
    cachedAtMs: Number(nowMs),
    result: cloneConversation(result)
  };
  conversationMemory.delete(key);
  conversationMemory.set(key, entry);
  evictConversationMemoryOverflow();
  return true;
}

export function clearConversationMemory(access) {
  const key = conversationCacheKey(access);
  if (!key) return false;
  return conversationMemory.delete(key);
}

export function clearAllConversationMemory() {
  conversationMemory.clear();
}

export const conversationMemoryPolicy = Object.freeze({
  ttlMs: DEFAULT_CACHE_TTL_MS,
  maxEntries: MAX_CACHE_ENTRIES,
  persistence: "memory-only"
});

export async function loadQuotePortalConversation(access) {
  requireConnectedConversation();
  const payload = normalizeAccess(access);
  const loadKey = conversationLoadKey(payload);
  const existing = inFlightConversationLoads.get(loadKey);
  if (existing) return existing;

  const loadPromise = (async () => {
    const call = httpsCallable(cloudFunctions, GET_CONVERSATION_CALLABLE);
    const response = await call(payload);
    return normalizeConversationResponse(response?.data || {});
  })();
  inFlightConversationLoads.set(loadKey, loadPromise);

  try {
    return await loadPromise;
  } finally {
    if (inFlightConversationLoads.get(loadKey) === loadPromise) {
      inFlightConversationLoads.delete(loadKey);
    }
  }
}

export async function warmConversationMemory(access) {
  const cached = readConversationMemory(access);
  if (cached) return cached;
  const result = await loadQuotePortalConversation(access);
  writeConversationMemory(access, result);
  return cloneConversation(result);
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
  return result;
}
