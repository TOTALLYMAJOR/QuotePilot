import { httpsCallable } from "firebase/functions";
import { auth, cloudFunctions, firebaseReady } from "./firebase";

export const PORTAL_CONVERSATION_BODY_MAX_LENGTH = 1200;
const GET_CONVERSATION_CALLABLE = "getQuotePortalConversation";
const SEND_MESSAGE_CALLABLE = "sendQuotePortalConversationMessage";
const inFlightConversationLoads = new Map();

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
