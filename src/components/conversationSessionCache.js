import { auth } from "../lib/firebase";
import { loadQuotePortalConversation } from "../lib/portalConversationClient";

const DEFAULT_CACHE_TTL_MS = 5 * 60 * 1000;
const MAX_CACHE_ENTRIES = 12;
const conversationMemory = new Map();
const inFlightConversationLoads = new Map();

function text(value, maxLength = 240) {
  return String(value ?? "").trim().slice(0, maxLength);
}

function conversationIdentity(access = {}) {
  const accessMode = text(access?.accessMode, 16).toLowerCase();
  // Session reuse is intentionally limited to authenticated staff. Customer
  // portal message bodies keep the existing callable-only load behavior so an
  // exact bearer link never gains a new retained-body lifecycle in this patch.
  if (accessMode !== "staff") return "";
  const organizationId = text(access?.organizationId, 160).toLowerCase();
  const quoteId = text(access?.quoteId, 160);
  const uid = text(auth?.currentUser?.uid, 160);
  if (!organizationId || !quoteId || !uid) return "";
  return `staff:${uid}:${organizationId}:${quoteId}`;
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

function writeConversationSessionAtKey(key, result, nowMs = Date.now()) {
  if (!key || !result?.quoteId) return false;
  conversationMemory.delete(key);
  conversationMemory.set(key, {
    cachedAtMs: Number(nowMs),
    result: cloneConversation(result)
  });
  evictOverflow();
  return true;
}

function assertConversationResultScope(access = {}, result = {}) {
  if (text(access?.accessMode, 16).toLowerCase() !== "staff") return;
  const expectedOrganizationId = text(access?.organizationId, 160).toLowerCase();
  const expectedQuoteId = text(access?.quoteId, 160);
  const returnedOrganizationId = text(result?.organizationId, 160).toLowerCase();
  const returnedQuoteId = text(result?.quoteId, 160);
  if (
    !expectedOrganizationId
    || !expectedQuoteId
    || returnedOrganizationId !== expectedOrganizationId
    || returnedQuoteId !== expectedQuoteId
  ) {
    throw new Error("The loaded conversation does not match the requested quote-scoped thread.");
  }
}

export function readConversationSession(access, {
  nowMs = Date.now(),
  ttlMs = DEFAULT_CACHE_TTL_MS
} = {}) {
  const key = conversationIdentity(access);
  if (!key) return null;
  const entry = conversationMemory.get(key);
  if (!entry) return null;
  // Viewing retained bodies must not extend their freshness window. This read
  // is intentionally side-effect free so it is also safe during React render.
  if (!Number.isFinite(entry.cachedAtMs) || nowMs - entry.cachedAtMs > ttlMs) {
    return null;
  }
  return cloneConversation(entry.result);
}

export function writeConversationSession(access, result, { nowMs = Date.now() } = {}) {
  const key = conversationIdentity(access);
  if (!key) return false;
  assertConversationResultScope(access, result);
  return writeConversationSessionAtKey(key, result, nowMs);
}

export function clearConversationSession(access) {
  const key = conversationIdentity(access);
  if (!key) return false;
  return conversationMemory.delete(key);
}

export function clearAllConversationSessions() {
  conversationMemory.clear();
  inFlightConversationLoads.clear();
}

export async function loadConversationAuthoritatively(access) {
  const key = conversationIdentity(access);
  // Portal access and staff without a current authenticated principal stay on
  // the existing callable path and receive no session reuse or coalescing.
  if (!key) return loadQuotePortalConversation(access);

  const existing = inFlightConversationLoads.get(key);
  if (existing) return existing;

  const loadPromise = (async () => {
    const result = await loadQuotePortalConversation(access);
    assertConversationResultScope(access, result);
    // Use the identity captured when the request began. If Firebase Auth changes
    // before this request settles, its message bodies must not move into the
    // newly authenticated principal's cache entry.
    writeConversationSessionAtKey(key, result);
    return cloneConversation(result);
  })();
  inFlightConversationLoads.set(key, loadPromise);

  try {
    return await loadPromise;
  } finally {
    if (inFlightConversationLoads.get(key) === loadPromise) {
      inFlightConversationLoads.delete(key);
    }
  }
}

export async function warmConversationSession(access) {
  const cached = readConversationSession(access);
  if (cached) return cached;
  return loadConversationAuthoritatively(access);
}

export const conversationSessionPolicy = Object.freeze({
  ttlMs: DEFAULT_CACHE_TTL_MS,
  maxEntries: MAX_CACHE_ENTRIES,
  persistence: "memory-only",
  accessMode: "staff-only"
});
