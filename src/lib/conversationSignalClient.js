import { doc, onSnapshot } from "firebase/firestore";
import { db, firebaseReady } from "./firebase";

const STAFF_ACCESS_MODE = "staff";
const PORTAL_ACCESS_MODE = "portal";
const ACTOR_TYPES = new Set(["staff", "customer"]);

function text(value, maxLength = 160) {
  return String(value ?? "").trim().slice(0, maxLength);
}

function strictText(value, maxLength) {
  const normalized = String(value ?? "").trim();
  return normalized.length <= maxLength ? normalized : "";
}

function validIso(value) {
  const normalized = text(value, 64);
  return Number.isFinite(Date.parse(normalized)) ? normalized : "";
}

function normalizeCount(value) {
  const count = Number(value);
  return Number.isSafeInteger(count) && count >= 0 ? count : null;
}

function isRecord(value) {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}

export function normalizeConversationSignalAccess(access = {}) {
  const accessMode = text(access?.accessMode, 16).toLowerCase();
  if (accessMode === STAFF_ACCESS_MODE) {
    const organizationId = strictText(access?.organizationId, 160).toLowerCase();
    const quoteId = strictText(access?.quoteId, 160);
    if (
      !/^[a-z0-9][a-z0-9_-]{0,159}$/.test(organizationId)
      || !/^[A-Za-z0-9][A-Za-z0-9_-]{0,159}$/.test(quoteId)
    ) {
      throw new Error("Quote and organization are required for staff conversation updates.");
    }
    return { accessMode, organizationId, quoteId };
  }
  if (accessMode === PORTAL_ACCESS_MODE) {
    const portalKey = strictText(access?.portalKey, 128);
    if (!/^[A-Za-z0-9_-]{20,128}$/.test(portalKey)) {
      throw new Error("Open the current customer portal link before watching conversation updates.");
    }
    return { accessMode, portalKey };
  }
  throw new Error("Conversation update access mode is invalid.");
}

export function conversationSignalAvailable() {
  return Boolean(firebaseReady && db);
}

export function normalizeConversationSignalSnapshot(
  snapshot,
  access,
  observedAtISO = new Date().toISOString()
) {
  const scope = normalizeConversationSignalAccess(access);
  const exists = snapshot?.exists?.() === true;
  const snapshotData = exists ? snapshot?.data?.() : null;
  const data = isRecord(snapshotData) ? snapshotData : {};
  const summary = isRecord(data.conversationSummary) ? data.conversationSummary : null;
  const latestActorType = text(summary?.latestActorType, 32).toLowerCase();
  const metadata = snapshot?.metadata || {};

  return {
    schemaVersion: 1,
    source: scope.accessMode === STAFF_ACCESS_MODE
      ? "organization_quote"
      : "customer_portal_quote",
    accessMode: scope.accessMode,
    organizationId: scope.accessMode === STAFF_ACCESS_MODE
      ? scope.organizationId
      : text(data.organizationId, 160).toLowerCase(),
    quoteId: scope.accessMode === STAFF_ACCESS_MODE
      ? scope.quoteId
      : text(data.quoteId, 160),
    documentExists: exists,
    hasConversationSummary: Boolean(summary),
    messageCount: normalizeCount(summary?.messageCount),
    latestMessageId: text(summary?.latestMessageId, 160),
    latestMessageAtISO: validIso(summary?.latestMessageAtISO),
    latestActorType: ACTOR_TYPES.has(latestActorType) ? latestActorType : "",
    observedAtISO: validIso(observedAtISO) || new Date().toISOString(),
    metadata: {
      fromCache: metadata.fromCache === true,
      hasPendingWrites: metadata.hasPendingWrites === true,
      source: metadata.fromCache === true ? "cache" : "server"
    }
  };
}

export function isConversationSignalNewer(nextSignal = {}, currentSignal = {}) {
  const nextId = text(nextSignal?.latestMessageId, 160);
  const currentId = text(currentSignal?.latestMessageId, 160);
  const nextAt = Date.parse(validIso(nextSignal?.latestMessageAtISO));
  const currentAt = Date.parse(validIso(currentSignal?.latestMessageAtISO));
  const nextCount = normalizeCount(nextSignal?.messageCount);
  const currentCount = normalizeCount(currentSignal?.messageCount);

  if (!nextId || !Number.isFinite(nextAt)) return false;
  if (!currentId || !Number.isFinite(currentAt)) return true;
  if (nextCount !== null && currentCount !== null) {
    if (nextCount > currentCount) return true;
    if (nextCount < currentCount) return false;
  }
  if (nextId === currentId) return false;
  return nextAt >= currentAt;
}

export function subscribeToConversationSignal(
  access,
  { onSignal, onError } = {}
) {
  const scope = normalizeConversationSignalAccess(access);
  if (typeof onSignal !== "function") {
    throw new TypeError("A conversation signal handler is required.");
  }
  if (!conversationSignalAvailable()) {
    throw new Error("Live conversation updates require a connected QuotePilot workspace.");
  }

  const signalRef = scope.accessMode === STAFF_ACCESS_MODE
    ? doc(db, "organizations", scope.organizationId, "quotes", scope.quoteId)
    : doc(db, "customerPortalQuotes", scope.portalKey);

  return onSnapshot(
    signalRef,
    { includeMetadataChanges: true },
    (snapshot) => onSignal(normalizeConversationSignalSnapshot(snapshot, scope)),
    () => {
      if (typeof onError === "function") {
        onError({
          code: "conversation-signal-unavailable",
          message: "Conversation updates are paused."
        });
      }
    }
  );
}
