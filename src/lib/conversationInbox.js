import { limit, onSnapshot, orderBy, query } from "firebase/firestore";
import { firebaseReady } from "./firebase";
import { getOrganizationCollectionRef } from "./organizationService";
import { resolveQuoteDeliveryRevisionId } from "./commerceOps";

export const CONVERSATION_INBOX_LIMIT = 50;

function text(value, maxLength = 240) {
  return String(value ?? "").trim().slice(0, maxLength);
}

function iso(value) {
  if (!value) return "";
  if (typeof value?.toDate === "function") return value.toDate().toISOString();
  const parsed = new Date(value);
  return Number.isNaN(parsed.getTime()) ? "" : parsed.toISOString();
}

function finiteNumber(value) {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : 0;
}

const CONVERSATION_VISIBLE_STATUSES = new Set(["sent", "viewed", "accepted", "declined", "booked"]);

export function resolveConversationThreadAvailability(quote = {}, nowMs = Date.now()) {
  const status = text(quote.status, 40).toLowerCase();
  const portalKey = text(quote.portalKey, 160);
  const portalIssuedAtISO = iso(quote.portalIssuedAtISO);
  const portalExpiresAtISO = iso(quote.portalExpiresAtISO || quote.expiresAtISO);
  const delivery = quote.workflow?.quoteDelivery && typeof quote.workflow.quoteDelivery === "object"
    ? quote.workflow.quoteDelivery
    : {};
  let revisionId = "";
  try {
    revisionId = resolveQuoteDeliveryRevisionId(quote);
  } catch {
    revisionId = "";
  }
  if (!CONVERSATION_VISIBLE_STATUSES.has(status)) {
    return { available: false, readOnly: false, reason: "Deliver the current proposal before messaging." };
  }
  if (text(quote.deletedAtISO, 64)) {
    return { available: false, readOnly: false, reason: "This event conversation is no longer available." };
  }
  if (!/^[A-Za-z0-9_-]{20,128}$/.test(portalKey)) {
    return { available: false, readOnly: false, reason: "Deliver the current proposal before messaging." };
  }
  if (!portalExpiresAtISO || Date.parse(portalExpiresAtISO) <= nowMs) {
    return { available: false, readOnly: false, reason: "The customer portal has expired. Deliver a current proposal to resume messaging." };
  }
  const deliveryAccepted = Boolean(
    revisionId
    && portalIssuedAtISO
    && text(delivery.revisionId, 160) === revisionId
    && text(delivery.state, 40).toLowerCase() === "provider_accepted"
    && text(delivery.portalActivationState, 40).toLowerCase() === "active"
    && text(delivery.providerMessageId, 160)
    && iso(delivery.providerAcceptedAtISO)
    && text(delivery.portalKey, 160) === portalKey
    && iso(delivery.portalIssuedAtISO) === portalIssuedAtISO
  );
  if (!deliveryAccepted) {
    return { available: false, readOnly: false, reason: "Messaging requires the current provider-accepted portal delivery." };
  }
  return {
    available: true,
    readOnly: status === "declined",
    reason: status === "declined" ? "This declined proposal conversation is read-only." : ""
  };
}

export function normalizeConversationThread(quote = {}, documentId = "") {
  const quoteId = text(quote.id || quote.quoteId || documentId, 160);
  if (!quoteId) return null;
  const summary = quote.conversationSummary && typeof quote.conversationSummary === "object"
    ? quote.conversationSummary
    : {};
  const messageCount = Math.max(0, Math.floor(finiteNumber(summary.messageCount)));
  const latestActorType = new Set(["staff", "customer"]).has(text(summary.latestActorType, 32).toLowerCase())
    ? text(summary.latestActorType, 32).toLowerCase()
    : "";
  const eventDate = text(quote.event?.date || quote.eventDate, 32);
  const customerName = text(quote.customer?.name || quote.customerName, 160) || "Customer not named";
  const eventName = text(quote.event?.name || quote.eventName, 160) || "Event not named";
  const availability = resolveConversationThreadAvailability(quote);
  return Object.freeze({
    quoteId,
    quoteNumber: text(quote.quoteNumber, 80) || quoteId,
    customerId: text(quote.customerId, 160),
    customerName,
    eventName,
    eventDate,
    eventTime: text(quote.event?.time || quote.eventTime, 32),
    venue: text(quote.event?.venue || quote.venue, 200),
    status: text(quote.status, 40).toLowerCase() || "draft",
    total: finiteNumber(quote.totals?.total ?? quote.pricing?.total ?? quote.total),
    portalReady: availability.available,
    conversationAvailable: availability.available,
    readOnly: availability.readOnly,
    unavailableReason: availability.reason,
    messageCount,
    latestMessageId: text(summary.latestMessageId, 160),
    latestMessageAtISO: iso(summary.latestMessageAtISO || summary.updatedAt),
    latestActorType,
    needsReply: availability.available && messageCount > 0 && latestActorType === "customer",
    searchText: [eventName, customerName, quote.quoteNumber || quoteId, eventDate]
      .map((part) => text(part).toLowerCase())
      .join(" ")
  });
}

export function mergeConversationThreads(seedQuotes = [], liveQuotes = []) {
  const byQuoteId = new Map();
  for (const quote of seedQuotes) {
    const thread = normalizeConversationThread(quote, quote?.id);
    if (thread) byQuoteId.set(thread.quoteId, thread);
  }
  for (const quote of liveQuotes) {
    const live = normalizeConversationThread(quote, quote?.id);
    if (!live) continue;
    const seed = byQuoteId.get(live.quoteId);
    byQuoteId.set(live.quoteId, Object.freeze({
      ...(seed || {}),
      ...live,
      customerId: live.customerId || seed?.customerId || "",
      customerName: live.customerName === "Customer not named" ? seed?.customerName || live.customerName : live.customerName,
      eventName: live.eventName === "Event not named" ? seed?.eventName || live.eventName : live.eventName,
      eventDate: live.eventDate || seed?.eventDate || "",
      eventTime: live.eventTime || seed?.eventTime || "",
      venue: live.venue || seed?.venue || "",
      searchText: [
        live.eventName === "Event not named" ? seed?.eventName : live.eventName,
        live.customerName === "Customer not named" ? seed?.customerName : live.customerName,
        live.quoteNumber || seed?.quoteNumber,
        live.eventDate || seed?.eventDate
      ].map((part) => text(part).toLowerCase()).join(" ")
    }));
  }
  return [...byQuoteId.values()].sort(compareConversationThreads);
}

export function compareConversationThreads(left, right) {
  if (left.needsReply !== right.needsReply) return left.needsReply ? -1 : 1;
  const leftLatest = Date.parse(left.latestMessageAtISO);
  const rightLatest = Date.parse(right.latestMessageAtISO);
  if (Number.isFinite(leftLatest) !== Number.isFinite(rightLatest)) return Number.isFinite(rightLatest) ? 1 : -1;
  if (Number.isFinite(leftLatest) && rightLatest !== leftLatest) return rightLatest - leftLatest;
  if (left.messageCount !== right.messageCount) return right.messageCount - left.messageCount;
  return (left.eventDate || "9999-99-99").localeCompare(right.eventDate || "9999-99-99")
    || left.eventName.localeCompare(right.eventName)
    || left.quoteId.localeCompare(right.quoteId);
}

export function filterConversationThreads(threads = [], { search = "", filter = "all" } = {}) {
  const searchKey = text(search).toLowerCase().replace(/\s+/g, " ");
  return threads.filter((thread) => {
    if (searchKey && !thread.searchText.includes(searchKey)) return false;
    if (filter === "needs-reply") return thread.needsReply;
    if (filter === "active") return thread.portalReady && !new Set(["declined", "expired"]).has(thread.status);
    return true;
  });
}

export function groupConversationThreads(threads = [], today = new Date()) {
  const date = today instanceof Date ? today : new Date(today);
  const todayKey = Number.isNaN(date.getTime())
    ? ""
    : `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, "0")}-${String(date.getDate()).padStart(2, "0")}`;
  const groups = [
    { id: "needs-reply", label: "Needs reply", threads: [] },
    { id: "upcoming", label: "Upcoming events", threads: [] },
    { id: "past", label: "Past or read-only", threads: [] },
    { id: "not-started", label: "No messages yet", threads: [] },
    { id: "unscheduled", label: "Date not set", threads: [] }
  ];
  for (const thread of threads) {
    if (thread.needsReply) groups[0].threads.push(thread);
    else if (!thread.conversationAvailable || new Set(["declined", "expired"]).has(thread.status) || (thread.eventDate && thread.eventDate < todayKey)) groups[2].threads.push(thread);
    else if (thread.messageCount === 0) groups[3].threads.push(thread);
    else if (thread.eventDate && thread.eventDate >= todayKey) groups[1].threads.push(thread);
    else groups[4].threads.push(thread);
  }
  return groups.filter((group) => group.threads.length > 0);
}

export function subscribeConversationInbox({ organizationId = "", onData, onError } = {}) {
  const orgId = text(organizationId, 160).toLowerCase();
  if (!orgId) throw new Error("organizationId is required for conversation updates.");
  if (!firebaseReady) throw new Error("Live conversation updates require a connected QuotePilot workspace.");
  const inboxQuery = query(
    getOrganizationCollectionRef("quotes", orgId),
    orderBy("conversationSummary.latestMessageAtISO", "desc"),
    limit(CONVERSATION_INBOX_LIMIT)
  );
  return onSnapshot(inboxQuery, { includeMetadataChanges: true }, (snapshot) => {
    const quotes = snapshot.docs.map((entry) => ({
      ...(entry.data() || {}),
      id: entry.id,
      organizationId: orgId
    }));
    const stale = snapshot.metadata.fromCache === true
      || snapshot.metadata.hasPendingWrites === true;
    onData?.({
      quotes,
      source: snapshot.metadata.fromCache
        ? "firebase-cache"
        : snapshot.metadata.hasPendingWrites
          ? "firebase-pending"
          : "firebase-live",
      stale,
      bounded: snapshot.size >= CONVERSATION_INBOX_LIMIT
    });
  }, (error) => onError?.(error));
}
