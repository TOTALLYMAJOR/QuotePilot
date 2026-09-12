import { auth } from "./firebase";
import { loadQuotePortalConversation } from "./portalConversationClient";

const DEFAULT_CACHE_TTL_MS = 5 * 60 * 1000;
const MAX_CACHE_ENTRIES = 12;
const conversationMemory = new Map();

function text(value, maxLength = 240) {
  return String(value ?? "").trim().slice(0, maxLength);
}

function cacheIdentity(access = {}) {
  const mode = text(access?.accessMode, 16).toLowerCase();
  if (mode === "staff") {
    const organizationId = text(access?.organizationId, 160).toLowerCase();
    const quoteId = text(access?.quoteId, 160);
    const uid = text(auth?.currentUser?.uid, 160);
    if (!organizationId || !quoteId || !uid) return "";
    return `staff:${uid}:${organizationId}:${quoteId}`;
  }
  if (mode === "portal") {
    const portalKey = text(access?.portalKey, 128);
    if (!portalKey) return "";
    return `portal:${portalKey}`;
  }
  return "";
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

function evictOverflow() {
  while (conversationMemory.size > MAX_CACHE_ENTRIES) {
    const oldestKey = conversationMemory.keys().next().value;
    if (!oldestKey) return;
    conversationMemory.delete(oldestKey);
  }
}

export function readConversationMemory(access, {
  nowMs = Date.now(),
  ttlMs = DEFAULT_CACHE_TTL_MS
} = {}) {
  const key = cacheIdentity(access);
  if (!key) return null;
  const entry = conversationMemory.get(key);
  if (!entry) return null;
  if (!Number.isFinite(entry.cachedAtMs) || nowMs - entry.cachedAtMs > ttlMs) {
    conversationMemory.delete(key);
    return null;
  }
  conversationMemory.delete(key);
  conversationMemory.set(key, entry);
  return cloneConversation(entry.result);
}

export function writeConversationMemory(access, result, { nowMs = Date.now() } = {}) {
  const key = cacheIdentity(access);
  if (!key || !result?.quoteId) return false;
  const entry = {
    cachedAtMs: Number(nowMs),
    result: cloneConversation(result)
  };
  conversationMemory.delete(key);
  conversationMemory.set(key, entry);
  evictOverflow();
  return true;
}

export function clearConversationMemory(access) {
  const key = cacheIdentity(access);
  if (!key) return false;
  return conversationMemory.delete(key);
}

export function clearAllConversationMemory() {
  conversationMemory.clear();
}

export async function warmConversationMemory(access) {
  const cached = readConversationMemory(access);
  if (cached) return cached;
  const result = await loadQuotePortalConversation(access);
  writeConversationMemory(access, result);
  return cloneConversation(result);
}

export const conversationMemoryPolicy = Object.freeze({
  ttlMs: DEFAULT_CACHE_TTL_MS,
  maxEntries: MAX_CACHE_ENTRIES,
  persistence: "memory-only"
});
