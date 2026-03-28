import {
  addDoc,
  collection,
  deleteDoc,
  doc,
  getDoc,
  getDocs,
  orderBy,
  query,
  runTransaction,
  serverTimestamp,
  setDoc,
  updateDoc,
  where
} from "firebase/firestore";
import { db, firebaseReady } from "./firebase";
import {
  getActiveOrganizationId,
  getOrganizationCollectionRef,
  getOrganizationSubDocRef,
  normalizeOrganizationId
} from "./organizationService";
import {
  buildPricingSnapshotFromClientTotals,
  deriveLegacyPricingSnapshot,
  normalizePricingOutput,
  normalizeVersionMetadata
} from "./pricingContracts";
import { buildCrmAdapterRequest, resolveCrmProvider } from "./crmAdapters";
import { buildQuoteEmailPayload } from "./proposalPayload";

const LOCAL_QUOTES_KEY = "quoteWizard.quotes";
const LOCAL_QUOTE_HISTORY_KEY = "quoteWizard.quoteHistory";
const QUOTES_COLLECTION = "quotes";
const PORTAL_COLLECTION = "customerPortalQuotes";
const QUOTE_HISTORY_COLLECTION = "quoteHistory";
const QUOTE_VERSIONS_COLLECTION = "versions";
const DEFAULT_VALIDITY_DAYS = 30;
const PORTAL_TOKEN_VALIDITY_DAYS = 30;
const PORTAL_TOKEN_EXPIRED_ERROR = "Quote link is invalid or expired.";
const EXPIRABLE_STATUSES = new Set(["draft", "sent", "viewed"]);
const AVAILABILITY_CONFLICT_STATUSES = new Set(["accepted", "booked"]);
const PAYMENT_STATUSES = ["unpaid", "sent", "paid", "refunded"];
const BOOKING_CONFIRMATION_STATUSES = ["pending", "sent", "confirmed", "cancelled"];
const INTEGRATION_PROVIDER_SET = new Set(["crm", "webhook", "webhook_bridge", "hubspot", "salesforce"]);
const INTEGRATION_STATE_SET = new Set(["queued", "success", "error", "retrying", "skipped"]);
const DEFAULT_CRM_SYNC_TIMEOUT_MS = 12000;
const STATUS_LIFECYCLE_FIELD = {
  draft: "draftAtISO",
  sent: "sentAtISO",
  viewed: "viewedAtISO",
  accepted: "acceptedAtISO",
  booked: "bookedAtISO",
  declined: "declinedAtISO",
  expired: "expiredAtISO",
  deleted: "deletedAtISO"
};
const STATUS_FLOW = {
  draft: ["draft", "sent", "declined", "expired", "deleted"],
  sent: ["sent", "viewed", "accepted", "declined", "expired", "deleted"],
  viewed: ["viewed", "accepted", "declined", "expired", "deleted"],
  accepted: ["accepted", "booked", "declined", "deleted"],
  booked: ["booked", "deleted"],
  declined: ["declined", "deleted"],
  expired: ["expired", "draft", "sent", "deleted"],
  deleted: ["deleted", "draft"]
};

export const QUOTE_STATUSES = Object.keys(STATUS_FLOW);
export { PAYMENT_STATUSES, BOOKING_CONFIRMATION_STATUSES };

let scopedOrganizationId = "";

export function setQuoteStoreOrganizationId(organizationId = "") {
  scopedOrganizationId = normalizeOrganizationId(organizationId);
}

function resolveQuoteOrganizationId(organizationId) {
  if (organizationId !== undefined) {
    return normalizeOrganizationId(organizationId);
  }
  return normalizeOrganizationId(scopedOrganizationId || getActiveOrganizationId());
}

function quotesCollectionRef(organizationId = undefined) {
  const resolvedOrganizationId = resolveQuoteOrganizationId(organizationId);
  if (!resolvedOrganizationId) {
    throw new Error("organizationId is required for quote read.");
  }
  return getOrganizationCollectionRef(QUOTES_COLLECTION, resolvedOrganizationId);
}

function quoteDocRef(quoteId, organizationId = undefined) {
  const id = String(quoteId || "").trim();
  const resolvedOrganizationId = resolveQuoteOrganizationId(organizationId);
  if (!resolvedOrganizationId) {
    throw new Error("organizationId is required for quote read.");
  }
  return getOrganizationSubDocRef(QUOTES_COLLECTION, id, resolvedOrganizationId);
}

function quoteVersionsCollectionRef(quoteId, organizationId = undefined) {
  const id = String(quoteId || "").trim();
  const resolvedOrganizationId = resolveQuoteOrganizationId(organizationId);
  if (!resolvedOrganizationId) {
    throw new Error("organizationId is required for quote version read.");
  }
  return collection(db, "organizations", resolvedOrganizationId, QUOTES_COLLECTION, id, QUOTE_VERSIONS_COLLECTION);
}

function resolveContextualOrganizationId() {
  return normalizeOrganizationId(scopedOrganizationId || getActiveOrganizationId());
}

function requireWriteOrganizationId(organizationId = undefined, action = "quote write") {
  const resolvedOrganizationId = normalizeOrganizationId(organizationId) || resolveContextualOrganizationId();
  if (!resolvedOrganizationId) {
    throw new Error(`organizationId is required for ${action}.`);
  }
  return resolvedOrganizationId;
}

function requireReadOrganizationId(organizationId = undefined, action = "quote read") {
  const resolvedOrganizationId = normalizeOrganizationId(organizationId) || resolveContextualOrganizationId();
  if (!resolvedOrganizationId) {
    throw new Error(`organizationId is required for ${action}.`);
  }
  return resolvedOrganizationId;
}

function quoteWriteCollectionRef(organizationId = undefined, action = "quote write") {
  return getOrganizationCollectionRef(QUOTES_COLLECTION, requireWriteOrganizationId(organizationId, action));
}

function quoteWriteDocRef(quoteId, organizationId = undefined, action = "quote write") {
  const id = String(quoteId || "").trim();
  if (!id) {
    throw new Error("Quote id is required.");
  }
  return getOrganizationSubDocRef(QUOTES_COLLECTION, id, requireWriteOrganizationId(organizationId, action));
}

function quoteVersionsWriteCollectionRef(quoteId, organizationId = undefined, action = "quote version write") {
  const id = String(quoteId || "").trim();
  if (!id) {
    throw new Error("Quote id is required.");
  }
  const resolvedOrganizationId = requireWriteOrganizationId(organizationId, action);
  return collection(db, "organizations", resolvedOrganizationId, QUOTES_COLLECTION, id, QUOTE_VERSIONS_COLLECTION);
}

function portalDocRef(portalKey) {
  return doc(db, PORTAL_COLLECTION, portalKey);
}

function isoNow() {
  return new Date().toISOString();
}

function addDaysISO(baseISO, days) {
  const base = parseSafe(baseISO, isoNow());
  base.setDate(base.getDate() + Math.max(1, Number(days || DEFAULT_VALIDITY_DAYS)));
  return base.toISOString();
}

function parseSafe(input, fallback) {
  const dt = new Date(input);
  return Number.isNaN(dt.getTime()) ? new Date(fallback) : dt;
}

function normalizeEmail(value) {
  return String(value || "").trim().toLowerCase();
}

function normalizeVenueKey(value) {
  return String(value || "").trim().toLowerCase().replace(/\s+/g, " ");
}

function normalizeCustomerNameKey(value) {
  return String(value || "").trim().toLowerCase().replace(/\s+/g, " ");
}

function toNumber(value, fallback = 0) {
  const n = Number(value);
  return Number.isFinite(n) ? n : fallback;
}

function normalizePricingType(value, fallback = "per_event") {
  const raw = String(value || fallback).trim().toLowerCase();
  if (raw === "per_person" || raw === "per_item" || raw === "per_event") return raw;
  return fallback;
}

function normalizeQuantityMap(input) {
  if (!input || typeof input !== "object") return {};
  return Object.entries(input).reduce((acc, [key, value]) => {
    const id = String(key || "").trim();
    if (!id) return acc;
    acc[id] = Math.max(1, Math.round(toNumber(value, 1)));
    return acc;
  }, {});
}

function resolveSnapshotQuantity(quantityMap, itemId, fallback = 1) {
  const id = String(itemId || "").trim();
  if (!id) return Math.max(1, Math.round(toNumber(fallback, 1)));
  if (!Object.prototype.hasOwnProperty.call(quantityMap, id)) {
    return Math.max(1, Math.round(toNumber(fallback, 1)));
  }
  return Math.max(1, Math.round(toNumber(quantityMap[id], fallback)));
}

function parseTimeToMinutes(value) {
  const text = String(value || "").trim();
  if (!/^\d{1,2}:\d{2}$/.test(text)) return null;
  const [hRaw, mRaw] = text.split(":");
  const h = Number(hRaw);
  const m = Number(mRaw);
  if (!Number.isFinite(h) || !Number.isFinite(m) || h < 0 || h > 23 || m < 0 || m > 59) return null;
  return (h * 60) + m;
}

function toTimeWindow(time, hours) {
  const start = parseTimeToMinutes(time);
  const durationMin = Math.round(toNumber(hours, 0) * 60);
  if (start === null || durationMin <= 0) return null;
  return {
    start,
    end: start + durationMin
  };
}

function windowsOverlap(a, b) {
  if (!a || !b) return false;
  return a.start < b.end && b.start < a.end;
}

function normalizeIntegrationProvider(value) {
  const raw = String(value || "").trim().toLowerCase();
  if (!raw || raw === "crm") return "crm";
  if (raw === "webhook-bridge") return "webhook_bridge";
  const provider = resolveCrmProvider(raw, "webhook");
  return INTEGRATION_PROVIDER_SET.has(provider) ? provider : "crm";
}

function toText(value, fallback = "") {
  const text = String(value ?? "").trim();
  return text || fallback;
}

function normalizeFeatureFlags(input) {
  const source = input && typeof input === "object" ? input : {};
  return {
    crmSync: source.crmSync !== false
  };
}

function resolveQuoteCrmSettings(quote = {}) {
  const quoteMeta = quote?.quoteMeta || {};
  const integrationsProvider = quote?.integrations?.providers?.crm?.provider;
  return {
    crmEnabled: Boolean(quoteMeta.crmEnabled),
    crmProvider: resolveCrmProvider(quoteMeta.crmProvider || integrationsProvider || "webhook", "webhook"),
    crmWebhookUrl: toText(quoteMeta.crmWebhookUrl),
    crmWebhookBridgeUrl: toText(quoteMeta.crmWebhookBridgeUrl),
    crmHubspotBridgeUrl: toText(quoteMeta.crmHubspotBridgeUrl),
    crmSalesforceBridgeUrl: toText(quoteMeta.crmSalesforceBridgeUrl),
    crmBridgeAuthToken: toText(quoteMeta.crmBridgeAuthToken),
    crmAutoSyncOnSent: Boolean(quoteMeta.crmAutoSyncOnSent),
    crmAutoSyncOnBooked: Boolean(quoteMeta.crmAutoSyncOnBooked),
    featureFlags: normalizeFeatureFlags(quoteMeta.featureFlags)
  };
}

function isCrmSyncEnabled(settings = {}) {
  return Boolean(settings.crmEnabled) && settings.featureFlags?.crmSync !== false;
}

function shouldAutoSyncCrmForStatus(settings, status) {
  if (!isCrmSyncEnabled(settings)) return false;
  if (status === "sent") return Boolean(settings.crmAutoSyncOnSent);
  if (status === "booked") return Boolean(settings.crmAutoSyncOnBooked);
  return false;
}

function normalizeIntegrationState(value) {
  const state = String(value || "").trim().toLowerCase();
  return INTEGRATION_STATE_SET.has(state) ? state : "queued";
}

function buildIntegrationLogEntry({
  provider = "crm",
  direction = "push",
  state = "queued",
  message = "",
  actorEmail = "",
  attempt = 1,
  payloadRef = ""
} = {}) {
  const nowISO = isoNow();
  return {
    id: buildPortalKey(),
    provider: normalizeIntegrationProvider(provider),
    direction: direction === "pull" ? "pull" : "push",
    state: normalizeIntegrationState(state),
    message: String(message || "").trim(),
    actorEmail: normalizeEmail(actorEmail),
    attempt: Math.max(1, Math.round(toNumber(attempt, 1))),
    payloadRef: String(payloadRef || "").trim(),
    occurredAtISO: nowISO
  };
}

function buildPortalKey() {
  if (globalThis.crypto?.randomUUID) {
    return globalThis.crypto.randomUUID().replace(/-/g, "");
  }
  return `${Date.now()}${Math.floor(Math.random() * 1e9)}`;
}

function timestampToISO(value, fallback = isoNow()) {
  if (!value) return fallback;
  if (typeof value === "string") return value;
  if (typeof value?.toDate === "function") {
    return value.toDate().toISOString();
  }
  const parsed = new Date(value);
  return Number.isNaN(parsed.getTime()) ? fallback : parsed.toISOString();
}

function normalizeISO(value, fallback = isoNow()) {
  const raw = String(value || "").trim();
  if (!raw) return fallback;
  const parsed = new Date(raw);
  return Number.isNaN(parsed.getTime()) ? fallback : parsed.toISOString();
}

function minISO(left, right, fallback = isoNow()) {
  const leftISO = normalizeISO(left, fallback);
  const rightISO = normalizeISO(right, fallback);
  const leftMs = parseSafe(leftISO, fallback).getTime();
  const rightMs = parseSafe(rightISO, fallback).getTime();
  return leftMs <= rightMs ? leftISO : rightISO;
}

function resolvePortalIssuedAtISO(quote, fallback = isoNow()) {
  const createdAtISO = timestampToISO(quote?.createdAtISO || quote?.createdAt, fallback);
  return normalizeISO(quote?.portalIssuedAtISO || createdAtISO, createdAtISO);
}

function resolvePortalExpiresAtISO(quote, issuedAtISO = "", fallback = isoNow()) {
  const issuedISO = normalizeISO(
    issuedAtISO || quote?.portalIssuedAtISO || quote?.createdAtISO || quote?.createdAt,
    fallback
  );
  const hardLimitISO = addDaysISO(issuedISO, PORTAL_TOKEN_VALIDITY_DAYS);
  const quoteExpiryISO = normalizeISO(quote?.expiresAtISO || hardLimitISO, hardLimitISO);
  const explicitPortalExpiryISO = String(quote?.portalExpiresAtISO || "").trim();
  if (explicitPortalExpiryISO) {
    return minISO(explicitPortalExpiryISO, minISO(quoteExpiryISO, hardLimitISO, hardLimitISO), hardLimitISO);
  }
  return minISO(quoteExpiryISO, hardLimitISO, hardLimitISO);
}

function isPortalExpired(portalExpiresAtISO, nowISO = isoNow()) {
  const expiresAt = parseSafe(portalExpiresAtISO, nowISO);
  const now = parseSafe(nowISO, nowISO);
  return expiresAt.getTime() < now.getTime();
}

function toEpochMs(input, fallback = isoNow()) {
  return parseSafe(input, fallback).getTime();
}

function assertPortalTokenActive(portalSnapshot, nowISO = isoNow()) {
  const issuedAtISO = resolvePortalIssuedAtISO(portalSnapshot, nowISO);
  const expiresAtISO = resolvePortalExpiresAtISO(portalSnapshot, issuedAtISO, nowISO);
  if (isPortalExpired(expiresAtISO, nowISO)) {
    throw new Error(PORTAL_TOKEN_EXPIRED_ERROR);
  }
  return {
    portalIssuedAtISO: issuedAtISO,
    portalExpiresAtISO: expiresAtISO
  };
}

function lifecycleObject(status, nowISO, previous = {}) {
  const key = STATUS_LIFECYCLE_FIELD[status];
  if (!key) return { ...(previous || {}) };
  return {
    ...(previous || {}),
    [key]: nowISO
  };
}

function buildPortalSnapshot(quoteId, quote) {
  const createdAtISO = timestampToISO(quote.createdAtISO || quote.createdAt, isoNow());
  const portalIssuedAtISO = resolvePortalIssuedAtISO(quote, createdAtISO);
  const portalExpiresAtISO = resolvePortalExpiresAtISO(
    {
      ...quote,
      createdAtISO,
      portalIssuedAtISO
    },
    portalIssuedAtISO,
    createdAtISO
  );
  return {
    quoteId,
    organizationId: String(quote.organizationId || "").trim(),
    portalKey: quote.portalKey || "",
    portalIssuedAtISO,
    portalExpiresAtISO,
    portalExpiresAtMs: toEpochMs(portalExpiresAtISO, createdAtISO),
    quoteNumber: quote.quoteNumber || "",
    customerName: quote.customer?.name || "",
    customerEmail: quote.customer?.email || "",
    eventName: quote.event?.name || "",
    eventDate: quote.event?.date || "",
    venue: quote.event?.venue || "",
    total: Number(quote.totals?.total || 0),
    deposit: Number(quote.totals?.deposit || 0),
    status: normalizeStatus(quote.status),
    expiresAtISO: quote.expiresAtISO || addDaysISO(createdAtISO, DEFAULT_VALIDITY_DAYS),
    payment: hydratePayment(quote.payment),
    booking: hydrateBooking(quote.booking),
    lifecycle: {
      ...(quote.lifecycle || {})
    },
    createdAtISO,
    updatedAtISO: quote.updatedAtISO || createdAtISO
  };
}

async function ensureQuoteWriteTarget(
  quoteId,
  { organizationId = undefined, action = "quote write" } = {}
) {
  const id = String(quoteId || "").trim();
  if (!id) {
    throw new Error("Quote id is required.");
  }

  const resolvedOrganizationId = requireWriteOrganizationId(organizationId, action);
  if (!firebaseReady || !db) {
    return {
      organizationId: resolvedOrganizationId,
      migratedFromLegacy: false
    };
  }

  const targetRef = quoteWriteDocRef(id, resolvedOrganizationId, action);
  const targetSnap = await getDoc(targetRef);
  if (targetSnap.exists()) {
    return {
      organizationId: resolvedOrganizationId,
      migratedFromLegacy: false
    };
  }
  throw new Error("Quote not found.");
}

function resolvePersistedPricingSnapshot({
  pricingSnapshot = null,
  form = {},
  totals = {},
  settings = {},
  selection = {},
  catalogSource = "",
  organizationId = "",
  quoteId = "",
  quoteNumber = "",
  ownerUid = "",
  ownerEmail = "",
  reason = ""
} = {}) {
  if (pricingSnapshot && typeof pricingSnapshot === "object") {
    return normalizePricingOutput(pricingSnapshot);
  }
  return buildPricingSnapshotFromClientTotals({
    form,
    totals,
    settings,
    selection,
    organizationId,
    quoteId,
    quoteNumber,
    actor: {
      uid: ownerUid,
      email: ownerEmail,
      role: "sales"
    },
    reason: reason || `fallback_${catalogSource || "unknown"}`
  });
}

async function syncPortalSnapshotFromQuoteDoc(quoteId, organizationId = "") {
  if (!firebaseReady || !db || !quoteId) return;
  const writeOrganizationId = requireWriteOrganizationId(organizationId, "syncPortalSnapshotFromQuoteDoc");
  const quoteSnap = await getDoc(quoteWriteDocRef(quoteId, writeOrganizationId, "syncPortalSnapshotFromQuoteDoc"));
  if (!quoteSnap.exists()) return;
  const data = quoteSnap.data();
  const portalKey = data.portalKey;
  if (!portalKey) return;
  await setDoc(
    portalDocRef(portalKey),
    buildPortalSnapshot(quoteId, {
      ...data,
      organizationId: writeOrganizationId,
      createdAtISO: timestampToISO(data.createdAtISO || data.createdAt)
    }),
    { merge: true }
  );
}

function buildQuoteNumber() {
  const now = new Date();
  const yy = String(now.getFullYear()).slice(-2);
  const mm = String(now.getMonth() + 1).padStart(2, "0");
  const dd = String(now.getDate()).padStart(2, "0");
  const hh = String(now.getHours()).padStart(2, "0");
  const min = String(now.getMinutes()).padStart(2, "0");
  const suffix = Math.floor(10000 + Math.random() * 90000);
  return `Q-${yy}${mm}${dd}-${hh}${min}-${suffix}`;
}

function buildContractNumber() {
  const now = new Date();
  const yy = String(now.getFullYear()).slice(-2);
  const mm = String(now.getMonth() + 1).padStart(2, "0");
  const dd = String(now.getDate()).padStart(2, "0");
  const serial = String(Math.floor(Math.random() * 100000)).padStart(5, "0");
  return `C-${yy}${mm}${dd}-${serial}`;
}

function toVersionNumber(value, fallback = 0) {
  const numeric = Math.floor(toNumber(value, fallback));
  return numeric > 0 ? numeric : Math.max(0, Math.floor(toNumber(fallback, 0)));
}

function buildQuoteVersionId(versionNumber) {
  return `v${String(Math.max(1, toVersionNumber(versionNumber, 1))).padStart(4, "0")}`;
}

function sortQuotesDesc(items) {
  return [...items].sort((a, b) => {
    const aTs = new Date(a.updatedAtISO || a.createdAtISO || a.createdAt || 0).getTime();
    const bTs = new Date(b.updatedAtISO || b.createdAtISO || b.createdAt || 0).getTime();
    return bTs - aTs;
  });
}

function normalizeStatus(status) {
  return QUOTE_STATUSES.includes(status) ? status : "draft";
}

function normalizePaymentStatus(status) {
  return PAYMENT_STATUSES.includes(status) ? status : "unpaid";
}

function normalizeBookingConfirmationStatus(status) {
  return BOOKING_CONFIRMATION_STATUSES.includes(status) ? status : "pending";
}

function hydratePayment(payment) {
  const payload = payment || {};
  const depositLink = (payload.depositLink || "").trim();
  const defaultStatus = depositLink ? "sent" : "unpaid";
  return {
    ...payload,
    depositLink,
    depositStatus: normalizePaymentStatus(payload.depositStatus || defaultStatus),
    depositConfirmedAtISO: payload.depositConfirmedAtISO || ""
  };
}

function hydrateBooking(booking) {
  const payload = booking || {};
  const sentAtISO = payload.confirmationSentAtISO || "";
  const confirmedAtISO = payload.confirmedAtISO || "";
  const inferredStatus = confirmedAtISO ? "confirmed" : sentAtISO ? "sent" : "pending";
  const confirmationStatus = normalizeBookingConfirmationStatus(payload.confirmationStatus || inferredStatus);
  return {
    ...payload,
    bookedAtISO: payload.bookedAtISO || "",
    bookedByEmail: normalizeEmail(payload.bookedByEmail),
    staffLead: String(payload.staffLead || "").trim(),
    staffAssignedAtISO: payload.staffAssignedAtISO || "",
    contractNumber: String(payload.contractNumber || "").trim(),
    contractConvertedAtISO: payload.contractConvertedAtISO || "",
    contractConvertedByEmail: normalizeEmail(payload.contractConvertedByEmail),
    confirmationStatus,
    confirmationSentAtISO: sentAtISO,
    confirmedAtISO,
    confirmationUpdatedByEmail: normalizeEmail(payload.confirmationUpdatedByEmail),
    availabilityCheckedAtISO: payload.availabilityCheckedAtISO || "",
    availabilitySummary:
      payload.availabilitySummary && typeof payload.availabilitySummary === "object"
        ? { ...payload.availabilitySummary }
        : {}
  };
}

function hydrateQuote(item, nowISO = isoNow()) {
  const createdAtISO = item.createdAtISO || nowISO;
  const expiresAtISO = item.expiresAtISO || addDaysISO(createdAtISO, DEFAULT_VALIDITY_DAYS);
  const portalIssuedAtISO = resolvePortalIssuedAtISO(item, createdAtISO);
  const portalExpiresAtISO = resolvePortalExpiresAtISO(
    {
      ...item,
      createdAtISO,
      expiresAtISO,
      portalIssuedAtISO
    },
    portalIssuedAtISO,
    expiresAtISO
  );
  const status = normalizeStatus(item.status);
  const integrationPayload = item.integrations || {};
  const integrationLogs = Array.isArray(integrationPayload.logs) ? integrationPayload.logs : [];
  const eventTypeId = String(item.eventTypeId || item.selection?.eventTypeId || item.event?.eventTypeId || "").trim();
  const customerNameKey = normalizeCustomerNameKey(item.customerNameKey || item.customer?.name || "");
  return {
    ...item,
    status,
    eventTypeId,
    customerNameKey,
    activeVersionId: String(item.activeVersionId || "").trim(),
    latestVersionNumber: toVersionNumber(item.latestVersionNumber, 0),
    deletedAtISO: item.deletedAtISO || "",
    createdAtISO,
    expiresAtISO,
    portalIssuedAtISO,
    portalExpiresAtISO,
    payment: hydratePayment(item.payment),
    booking: hydrateBooking(item.booking),
    integrations: {
      ...integrationPayload,
      logs: integrationLogs
    },
    lifecycle: {
      ...(item.lifecycle || {})
    }
  };
}

function applyExpiry(quote, nowISO = isoNow()) {
  if (!EXPIRABLE_STATUSES.has(quote.status) || quote.status === "deleted") return quote;
  const expiresAt = parseSafe(quote.expiresAtISO, nowISO);
  const now = parseSafe(nowISO, nowISO);
  if (expiresAt.getTime() >= now.getTime()) return quote;
  return {
    ...quote,
    status: "expired",
    lifecycle: {
      ...(quote.lifecycle || {}),
      expiredAtISO: quote.lifecycle?.expiredAtISO || nowISO
    }
  };
}

function lifecyclePatch(status, nowISO) {
  const key = STATUS_LIFECYCLE_FIELD[status];
  if (!key) return {};
  return {
    [`lifecycle.${key}`]: nowISO
  };
}

function resolveMenuItemDetails(menuItemIds, settings, menuItemQuantities = {}) {
  const selected = new Set(Array.isArray(menuItemIds) ? menuItemIds : []);
  if (!selected.size) return [];
  const quantityMap = normalizeQuantityMap(menuItemQuantities);

  const sections = Array.isArray(settings?.menuSections) ? settings.menuSections : [];
  const byId = new Map();
  sections.forEach((section) => {
    (section.items || []).forEach((item) => {
      const id = String(item?.id || "").trim();
      if (!id || !selected.has(id) || byId.has(id)) return;
      const pricingType = normalizePricingType(item?.pricingType || item?.type, "per_event");
      byId.set(id, {
        id,
        name: String(item?.name || "").trim() || id,
        pricingType,
        type: pricingType,
        price: Number(item?.price || 0),
        quantity: resolveSnapshotQuantity(quantityMap, id, 1)
      });
    });
  });

  return Array.from(selected).map((id) => {
    const detail = byId.get(id);
    if (detail) return detail;
    const quantity = resolveSnapshotQuantity(quantityMap, id, 1);
    return {
      id,
      name: id,
      pricingType: "per_event",
      type: "per_event",
      price: 0,
      quantity
    };
  });
}

function resolveItemSnapshots(ids = [], catalogItems = [], quantityMap = {}, { guests = 0, defaultPricingType = "per_event" } = {}) {
  const selected = Array.isArray(ids) ? ids.map((id) => String(id || "").trim()).filter(Boolean) : [];
  if (!selected.length) return [];
  const normalizedQtyMap = normalizeQuantityMap(quantityMap);
  const byId = new Map((Array.isArray(catalogItems) ? catalogItems : []).map((item) => [String(item?.id || "").trim(), item]));

  return selected.map((id) => {
    const found = byId.get(id);
    const pricingType = normalizePricingType(found?.pricingType || found?.type, defaultPricingType);
    const defaultQty =
      pricingType === "per_person"
        ? Math.max(1, Math.round(toNumber(guests, 1)))
        : pricingType === "per_item"
          ? typeof found?.qtyRule === "function"
            ? Math.max(1, Math.round(toNumber(found.qtyRule(guests), 1)))
            : 1
          : 1;
    const quantity = resolveSnapshotQuantity(normalizedQtyMap, id, defaultQty);
    return {
      id,
      name: String(found?.name || id).trim() || id,
      price: Number(found?.price || 0),
      pricingType,
      type: pricingType,
      quantity
    };
  });
}

export function getAllowedStatusTransitions(status) {
  const normalized = normalizeStatus(status);
  return STATUS_FLOW[normalized] || STATUS_FLOW.draft;
}

export async function checkEventAvailability({
  eventDate = "",
  venue = "",
  eventTime = "",
  eventHours = 0,
  eventGuests = 0,
  capacityLimit = 400,
  excludeQuoteId = "",
  organizationId = ""
} = {}) {
  const date = String(eventDate || "").trim();
  if (!date) {
    return { conflicts: [], hasBlockingConflict: false };
  }

  const venueKey = normalizeVenueKey(venue);
  const inputWindow = toTimeWindow(eventTime, eventHours);
  const guestCount = Math.max(0, toNumber(eventGuests, 0));
  const maxCapacity = Math.max(1, toNumber(capacityLimit, 400));
  const { quotes } = await getQuoteHistory({ organizationId });
  const candidateConflicts = quotes
    .filter((quote) => quote.id !== excludeQuoteId)
    .filter((quote) => AVAILABILITY_CONFLICT_STATUSES.has(normalizeStatus(quote.status)))
    .filter((quote) => String(quote.event?.date || "").trim() === date)
    .filter((quote) => {
      if (!venueKey) return true;
      return normalizeVenueKey(quote.event?.venue) === venueKey;
    })
    .map((quote) => {
      const status = normalizeStatus(quote.status);
      const otherWindow = toTimeWindow(quote.event?.time, quote.event?.hours);
      let reason = "same_day_venue";
      if (inputWindow && otherWindow) {
        reason = windowsOverlap(inputWindow, otherWindow) ? "time_overlap" : "time_clear";
      } else if (inputWindow || otherWindow) {
        reason = "time_unknown";
      }
      return {
        id: quote.id,
        quoteNumber: quote.quoteNumber || "",
        status,
        eventName: quote.event?.name || "",
        eventDate: quote.event?.date || "",
        eventTime: quote.event?.time || "",
        eventHours: toNumber(quote.event?.hours, 0),
        venue: quote.event?.venue || "",
        customerName: quote.customer?.name || "",
        guests: Math.max(0, toNumber(quote.event?.guests, 0)),
        reason
      };
    })
    .filter((item) => item.reason !== "time_clear");

  const sameVenueLoad = venueKey
    ? candidateConflicts.reduce((sum, item) => sum + item.guests, 0) + guestCount
    : 0;
  const capacityExceeded = Boolean(venueKey) && sameVenueLoad > maxCapacity;

  const conflicts = candidateConflicts.map((item) => ({
    ...item,
    capacityExceeded
  }));

  return {
    conflicts,
    hasBlockingConflict: conflicts.some((item) => item.status === "booked"),
    capacityExceeded,
    capacityLimit: maxCapacity,
    sameVenueLoad
  };
}

function buildAvailabilitySummary(availability) {
  const conflicts = Array.isArray(availability?.conflicts) ? availability.conflicts : [];
  const acceptedConflicts = conflicts.filter((item) => item.status === "accepted").length;
  const bookedConflicts = conflicts.filter((item) => item.status === "booked").length;
  return {
    conflictCount: conflicts.length,
    acceptedConflictCount: acceptedConflicts,
    bookedConflictCount: bookedConflicts,
    capacityExceeded: Boolean(availability?.capacityExceeded),
    sameVenueLoad: Math.max(0, toNumber(availability?.sameVenueLoad, 0)),
    capacityLimit: Math.max(1, toNumber(availability?.capacityLimit, 400))
  };
}

function buildBlockingAvailabilityError(availability) {
  const conflicts = Array.isArray(availability?.conflicts) ? availability.conflicts : [];
  const refs = conflicts
    .filter((item) => item.status === "booked")
    .slice(0, 3)
    .map((item) => item.quoteNumber || item.id)
    .filter(Boolean);
  const suffix = refs.length ? ` Existing booking(s): ${refs.join(", ")}.` : "";
  return `Booking blocked: another contract is already booked for this date/venue.${suffix}`;
}

function ensureConvertibleQuote(quote) {
  const status = normalizeStatus(quote?.status);
  const hasContract = Boolean(String(quote?.booking?.contractNumber || "").trim());
  if (status === "accepted") return;
  if (status === "booked" && !hasContract) return;
  if (status === "booked" && hasContract) {
    throw new Error("This quote is already converted to a contract.");
  }
  throw new Error("Only accepted quotes can be converted to a contract.");
}

function quoteHasVersionPointers(quote = {}) {
  const latestVersionNumber = toVersionNumber(quote.latestVersionNumber, 0);
  const activeVersionId = String(quote.activeVersionId || "").trim();
  return latestVersionNumber > 0 || Boolean(activeVersionId);
}

function withLegacyReadDefaults(quote) {
  const hydrated = quote && typeof quote === "object" ? quote : {};
  return {
    ...hydrated,
    pricing: resolveQuotePricingSnapshot(hydrated),
    versionMeta: resolveQuoteVersionMetadata(hydrated)
  };
}

async function readQuoteById(quoteId) {
  const id = String(quoteId || "").trim();
  if (!id) {
    throw new Error("Quote id is required.");
  }

  const nowISO = isoNow();
  if (firebaseReady) {
    const scopedOrgId = requireReadOrganizationId(undefined, "quote read");
    const quoteSnap = await getDoc(quoteDocRef(id, scopedOrgId));

    if (!quoteSnap.exists()) {
      throw new Error("Quote not found.");
    }
    const data = quoteSnap.data();
    const createdAtISO = timestampToISO(data.createdAtISO || data.createdAt, nowISO);
    return withLegacyReadDefaults(hydrateQuote(
      {
        id,
        ...data,
        organizationId: normalizeOrganizationId(data.organizationId || scopedOrgId),
        createdAtISO
      },
      nowISO
    ));
  }

  const existing = JSON.parse(localStorage.getItem(LOCAL_QUOTES_KEY) || "[]");
  const match = existing.find((quote) => quote.id === id);
  if (!match) {
    throw new Error("Quote not found.");
  }
  return withLegacyReadDefaults(hydrateQuote(match, nowISO));
}

export async function getQuoteById(quoteId) {
  return readQuoteById(quoteId);
}

export function resolveQuotePricingSnapshot(quote) {
  if (quote?.pricing && typeof quote.pricing === "object") {
    return quote.pricing;
  }
  return deriveLegacyPricingSnapshot(quote);
}

export function resolveQuoteVersionMetadata(quote) {
  const source = quote && typeof quote === "object" ? quote : {};
  if (source.versionMeta && typeof source.versionMeta === "object") {
    return normalizeVersionMetadata(source.versionMeta);
  }
  if (source.versionMetadata && typeof source.versionMetadata === "object") {
    return normalizeVersionMetadata(source.versionMetadata);
  }
  return normalizeVersionMetadata({
    versionNumber: source.versionNumber,
    createdAt: source.createdAtISO || source.createdAt,
    ownerUid: source.ownerUid,
    ownerEmail: source.ownerEmail,
    reason: source.versionReason || source.reason || ""
  });
}

function buildLegacyReadFallbackVersion(quote, { reason = "legacy_read_fallback" } = {}) {
  const versionMeta = resolveQuoteVersionMetadata(quote);
  const versionId = String(quote?.activeVersionId || "").trim() || buildQuoteVersionId(versionMeta.versionNumber);
  const snapshot = JSON.parse(JSON.stringify(quote || {}));
  return {
    id: versionId,
    versionId,
    quoteId: String(quote?.id || "").trim(),
    organizationId: String(quote?.organizationId || "").trim(),
    versionNumber: versionMeta.versionNumber,
    createdAtISO: versionMeta.createdAt || quote?.updatedAtISO || quote?.createdAtISO || isoNow(),
    reason: versionMeta.reason || reason,
    createdBy: versionMeta.createdBy,
    status: normalizeStatus(quote?.status),
    pricing: resolveQuotePricingSnapshot(snapshot),
    snapshot,
    legacySynthetic: true
  };
}

export async function ensureLegacyQuoteCompatibility(
  quoteId,
  { organizationId = undefined, persistVersion = true } = {}
) {
  const quote = await readQuoteById(quoteId);
  const organizationCandidate = organizationId !== undefined ? organizationId : quote.organizationId;
  const resolvedOrganizationId = firebaseReady
    ? requireWriteOrganizationId(organizationCandidate, "ensureLegacyQuoteCompatibility")
    : resolveQuoteOrganizationId(organizationCandidate);
  const hasPointers = quoteHasVersionPointers(quote);
  const history = await getQuoteVersionHistory(quote.id, {
    organizationId: resolvedOrganizationId
  });

  if (hasPointers || !persistVersion) {
    return {
      ok: true,
      upgraded: false,
      reason: hasPointers ? "already_versioned" : "persist_disabled",
      activeVersionId: String(quote.activeVersionId || "").trim(),
      latestVersionNumber: toVersionNumber(quote.latestVersionNumber, 0)
    };
  }

  if (history.versions.length) {
    const latest = history.versions[0] || {};
    const latestVersionId = String(latest.versionId || latest.id || "").trim()
      || buildQuoteVersionId(toVersionNumber(latest.versionNumber, 1));
    const latestVersionMeta = normalizeVersionMetadata({
      versionNumber: latest.versionNumber,
      createdAt: latest.createdAtISO || latest.timestamp || quote.updatedAtISO || quote.createdAtISO || isoNow(),
      createdBy: latest.createdBy,
      ownerUid: quote.ownerUid,
      ownerEmail: quote.ownerEmail,
      reason: latest.reason || "legacy_existing_history"
    });

    if (firebaseReady) {
      await ensureQuoteWriteTarget(quote.id, {
        organizationId: resolvedOrganizationId,
        action: "ensureLegacyQuoteCompatibility"
      });
      await updateDoc(quoteWriteDocRef(quote.id, resolvedOrganizationId, "ensureLegacyQuoteCompatibility"), {
        activeVersionId: latestVersionId,
        latestVersionNumber: latestVersionMeta.versionNumber,
        versionMeta: latestVersionMeta
      });
    } else {
      const existing = JSON.parse(localStorage.getItem(LOCAL_QUOTES_KEY) || "[]");
      const next = existing.map((item) => {
        if (item.id !== quote.id) return item;
        return {
          ...item,
          activeVersionId: latestVersionId,
          latestVersionNumber: latestVersionMeta.versionNumber,
          versionMeta: latestVersionMeta
        };
      });
      localStorage.setItem(LOCAL_QUOTES_KEY, JSON.stringify(next));
    }

    return {
      ok: true,
      upgraded: true,
      reason: "attached_existing_history",
      activeVersionId: latestVersionId,
      latestVersionNumber: latestVersionMeta.versionNumber
    };
  }

  const seeded = await saveQuoteVersion(quote.id, {
    reason: "legacy_lazy_upgrade_baseline",
    setActive: true,
    organizationId: resolvedOrganizationId
  });

  return {
    ok: true,
    upgraded: true,
    reason: "seeded_baseline",
    activeVersionId: seeded.versionId,
    latestVersionNumber: seeded.versionNumber
  };
}

export async function saveQuoteVersion(
  quoteId,
  { reason = "snapshot", setActive = false, organizationId = undefined } = {}
) {
  const quote = await readQuoteById(quoteId);
  const timestamp = isoNow();
  const snapshot = JSON.parse(JSON.stringify(quote));
  const organizationCandidate = organizationId !== undefined ? organizationId : quote.organizationId;
  const resolvedOrganizationId = firebaseReady
    ? requireWriteOrganizationId(organizationCandidate, "saveQuoteVersion")
    : resolveQuoteOrganizationId(organizationCandidate);
  const normalizedReason = normalizeVersionMetadata({ reason }).reason;

  if (firebaseReady) {
    const writeTarget = await ensureQuoteWriteTarget(quote.id, {
      organizationId: resolvedOrganizationId,
      action: "saveQuoteVersion"
    });
    const writeOrganizationId = writeTarget.organizationId;
    const quoteRef = quoteWriteDocRef(quote.id, writeOrganizationId, "saveQuoteVersion");
    const result = await runTransaction(db, async (tx) => {
      const quoteSnap = await tx.get(quoteRef);
      if (!quoteSnap.exists()) {
        throw new Error("Quote not found.");
      }
      const data = quoteSnap.data() || {};
      const nextVersionNumber = toVersionNumber(data.latestVersionNumber, 0) + 1;
      const versionId = buildQuoteVersionId(nextVersionNumber);
      const versionMeta = normalizeVersionMetadata({
        versionNumber: nextVersionNumber,
        createdAt: timestamp,
        ownerUid: quote.ownerUid,
        ownerEmail: quote.ownerEmail,
        reason: normalizedReason
      });
      const versionRef = doc(
        quoteVersionsWriteCollectionRef(quote.id, writeOrganizationId, "saveQuoteVersion"),
        versionId
      );
      tx.set(versionRef, {
        versionId,
        quoteId: quote.id,
        organizationId: writeOrganizationId,
        versionNumber: versionMeta.versionNumber,
        createdAtISO: timestamp,
        reason: versionMeta.reason,
        createdBy: versionMeta.createdBy,
        status: normalizeStatus(quote.status),
        pricing: resolveQuotePricingSnapshot(snapshot),
        snapshot
      });
      const quotePatch = {
        latestVersionNumber: versionMeta.versionNumber,
        versionMeta
      };
      if (setActive) {
        quotePatch.activeVersionId = versionId;
      }
      tx.set(quoteRef, quotePatch, { merge: true });
      return {
        versionId,
        versionNumber: versionMeta.versionNumber
      };
    });

    return {
      ok: true,
      storage: "firebase",
      timestamp,
      versionId: result.versionId,
      versionNumber: result.versionNumber
    };
  }

  const nextVersionNumber = toVersionNumber(quote.latestVersionNumber, 0) + 1;
  const versionId = buildQuoteVersionId(nextVersionNumber);
  const versionMeta = normalizeVersionMetadata({
    versionNumber: nextVersionNumber,
    createdAt: timestamp,
    ownerUid: quote.ownerUid,
    ownerEmail: quote.ownerEmail,
    reason: normalizedReason
  });

  const existingQuotes = JSON.parse(localStorage.getItem(LOCAL_QUOTES_KEY) || "[]");
  const nextQuotes = existingQuotes.map((item) => {
    if (item.id !== quote.id) return item;
    const patch = {
      latestVersionNumber: versionMeta.versionNumber,
      versionMeta
    };
    if (setActive) {
      patch.activeVersionId = versionId;
    }
    return {
      ...item,
      ...patch
    };
  });
  localStorage.setItem(LOCAL_QUOTES_KEY, JSON.stringify(nextQuotes));

  const history = JSON.parse(localStorage.getItem(LOCAL_QUOTE_HISTORY_KEY) || "[]");
  history.unshift({
    id: buildPortalKey(),
    versionId,
    versionNumber: versionMeta.versionNumber,
    reason: versionMeta.reason,
    quoteId: quote.id,
    organizationId: resolvedOrganizationId,
    snapshot,
    pricing: resolveQuotePricingSnapshot(snapshot),
    timestamp
  });
  localStorage.setItem(LOCAL_QUOTE_HISTORY_KEY, JSON.stringify(history));
  return {
    ok: true,
    storage: "local",
    timestamp,
    versionId,
    versionNumber: versionMeta.versionNumber
  };
}

export async function getQuoteVersionHistory(quoteId, { organizationId = undefined } = {}) {
  const id = String(quoteId || "").trim();
  if (!id) {
    throw new Error("Quote id is required.");
  }

  if (firebaseReady) {
    const resolvedOrganizationId = requireReadOrganizationId(organizationId, "quote version read");
    const versionSnap = await getDocs(query(
      quoteVersionsCollectionRef(id, resolvedOrganizationId),
      orderBy("versionNumber", "desc")
    ));

    return {
      source: "firebase",
      versions: versionSnap.docs.map((docSnap) => ({
        id: docSnap.id,
        ...docSnap.data()
      }))
    };
  }

  const history = JSON.parse(localStorage.getItem(LOCAL_QUOTE_HISTORY_KEY) || "[]");
  const versions = history
    .filter((item) => item.quoteId === id)
    .sort((a, b) => {
      const aVersion = toVersionNumber(a.versionNumber, 0);
      const bVersion = toVersionNumber(b.versionNumber, 0);
      if (aVersion !== bVersion) return bVersion - aVersion;
      return new Date(b.timestamp || 0).getTime() - new Date(a.timestamp || 0).getTime();
    });

  return {
    source: "local",
    versions
  };
}

export async function getActiveQuoteVersion(quoteId, { organizationId = undefined } = {}) {
  let quote = await readQuoteById(quoteId);
  const resolvedOrganizationId = resolveQuoteOrganizationId(
    organizationId !== undefined ? organizationId : quote.organizationId
  );
  let history = await getQuoteVersionHistory(quote.id, {
    organizationId: resolvedOrganizationId
  });
  if (!history.versions.length && !quoteHasVersionPointers(quote)) {
    const migration = await ensureLegacyQuoteCompatibility(quote.id, {
      organizationId: resolvedOrganizationId,
      persistVersion: true
    });
    if (migration.upgraded) {
      quote = await readQuoteById(quote.id);
      history = await getQuoteVersionHistory(quote.id, {
        organizationId: resolvedOrganizationId
      });
    }
  }
  const fallbackVersion = history.versions.length ? null : buildLegacyReadFallbackVersion(quote);
  const versions = fallbackVersion ? [fallbackVersion] : history.versions;
  const activeVersionId = String(quote.activeVersionId || "").trim();
  const activeVersion = versions.find((item) => {
    const id = String(item.versionId || item.id || "").trim();
    return id && id === activeVersionId;
  }) || versions[0] || null;

  return {
    source: fallbackVersion ? `${history.source}-legacy-fallback` : history.source,
    quoteId: quote.id,
    activeVersionId: activeVersionId || String(activeVersion?.versionId || activeVersion?.id || "").trim(),
    version: activeVersion,
    versions
  };
}

export async function convertQuoteToContract({
  quoteId,
  actorEmail = "",
  capacityLimit = 400
} = {}) {
  const id = String(quoteId || "").trim();
  if (!id) {
    throw new Error("Quote id is required.");
  }

  const quote = await readQuoteById(id);
  ensureConvertibleQuote(quote);

  const availability = await checkEventAvailability({
    eventDate: quote.event?.date,
    venue: quote.event?.venue,
    eventTime: quote.event?.time,
    eventHours: quote.event?.hours,
    eventGuests: quote.event?.guests,
    capacityLimit,
    excludeQuoteId: id,
    organizationId: quote.organizationId
  });
  if (availability.hasBlockingConflict) {
    throw new Error(buildBlockingAvailabilityError(availability));
  }

  const nowISO = isoNow();
  const actor = normalizeEmail(actorEmail);
  const currentBooking = hydrateBooking(quote.booking);
  const contractNumber = currentBooking.contractNumber || buildContractNumber();
  const nextLifecycle = lifecycleObject("booked", nowISO, quote.lifecycle);
  const nextBooking = {
    ...currentBooking,
    bookedAtISO: currentBooking.bookedAtISO || nowISO,
    bookedByEmail: currentBooking.bookedByEmail || actor,
    contractNumber,
    contractConvertedAtISO: currentBooking.contractConvertedAtISO || nowISO,
    contractConvertedByEmail: actor || currentBooking.contractConvertedByEmail,
    confirmationStatus: normalizeBookingConfirmationStatus(currentBooking.confirmationStatus || "pending"),
    availabilityCheckedAtISO: nowISO,
    availabilitySummary: buildAvailabilitySummary(availability)
  };

  await saveQuoteVersion(id);

  if (firebaseReady) {
    await updateDoc(quoteWriteDocRef(id, quote.organizationId, "convertQuoteToContract"), {
      status: "booked",
      booking: nextBooking,
      lifecycle: nextLifecycle,
      updatedAtISO: nowISO
    });
    await syncPortalSnapshotFromQuoteDoc(id, quote.organizationId);
    return {
      ok: true,
      storage: "firebase",
      status: "booked",
      booking: nextBooking,
      lifecycle: nextLifecycle,
      contractNumber,
      availability
    };
  }

  const existing = JSON.parse(localStorage.getItem(LOCAL_QUOTES_KEY) || "[]");
  let found = false;
  const next = existing.map((item) => {
    if (item.id !== id) return item;
    found = true;
    return {
      ...item,
      status: "booked",
      booking: nextBooking,
      lifecycle: nextLifecycle,
      updatedAtISO: nowISO
    };
  });
  if (!found) {
    throw new Error("Quote not found.");
  }
  localStorage.setItem(LOCAL_QUOTES_KEY, JSON.stringify(next));
  return {
    ok: true,
    storage: "local",
    status: "booked",
    booking: nextBooking,
    lifecycle: nextLifecycle,
    contractNumber,
    availability
  };
}

export async function updateQuoteBookingConfirmation({
  quoteId,
  confirmationStatus = "pending",
  actorEmail = ""
} = {}) {
  const id = String(quoteId || "").trim();
  if (!id) {
    throw new Error("Quote id is required.");
  }

  const quote = await readQuoteById(id);
  if (normalizeStatus(quote.status) !== "booked") {
    throw new Error("Quote must be booked before confirmation can be tracked.");
  }
  const booking = hydrateBooking(quote.booking);
  if (!booking.contractNumber) {
    throw new Error("Convert this quote to a contract before tracking confirmation.");
  }

  const nowISO = isoNow();
  const actor = normalizeEmail(actorEmail);
  const nextStatus = normalizeBookingConfirmationStatus(confirmationStatus);
  const nextBooking = {
    ...booking,
    confirmationStatus: nextStatus,
    confirmationUpdatedByEmail: actor || booking.confirmationUpdatedByEmail
  };

  if (nextStatus === "pending") {
    nextBooking.confirmationSentAtISO = "";
    nextBooking.confirmedAtISO = "";
  }
  if (nextStatus === "sent") {
    nextBooking.confirmationSentAtISO = nowISO;
    nextBooking.confirmedAtISO = "";
  }
  if (nextStatus === "confirmed") {
    nextBooking.confirmationSentAtISO = booking.confirmationSentAtISO || nowISO;
    nextBooking.confirmedAtISO = nowISO;
  }
  if (nextStatus === "cancelled") {
    nextBooking.confirmedAtISO = "";
  }

  await saveQuoteVersion(id);

  if (firebaseReady) {
    await updateDoc(quoteWriteDocRef(id, quote.organizationId, "updateQuoteBookingConfirmation"), {
      booking: nextBooking,
      updatedAtISO: nowISO
    });
    await syncPortalSnapshotFromQuoteDoc(id, quote.organizationId);
    return { ok: true, storage: "firebase", booking: nextBooking };
  }

  const existing = JSON.parse(localStorage.getItem(LOCAL_QUOTES_KEY) || "[]");
  let found = false;
  const next = existing.map((item) => {
    if (item.id !== id) return item;
    found = true;
    return {
      ...item,
      booking: nextBooking,
      updatedAtISO: nowISO
    };
  });
  if (!found) {
    throw new Error("Quote not found.");
  }
  localStorage.setItem(LOCAL_QUOTES_KEY, JSON.stringify(next));
  return { ok: true, storage: "local", booking: nextBooking };
}

export async function recordQuoteIntegrationSync({
  quoteId,
  provider = "crm",
  direction = "push",
  state = "queued",
  message = "",
  actorEmail = "",
  attempt = 1,
  payloadRef = ""
} = {}) {
  const id = String(quoteId || "").trim();
  if (!id) {
    throw new Error("Quote id is required.");
  }
  const quote = await readQuoteById(id);

  const entry = buildIntegrationLogEntry({
    provider,
    direction,
    state,
    message,
    actorEmail,
    attempt,
    payloadRef
  });

  await saveQuoteVersion(id);

  if (firebaseReady) {
    const quoteRef = quoteWriteDocRef(id, quote.organizationId, "recordQuoteIntegrationSync");
    const quoteSnap = await getDoc(quoteRef);
    if (!quoteSnap.exists()) {
      throw new Error("Quote not found.");
    }
    const data = quoteSnap.data();
    const current = data.integrations || {};
    const existingLogs = Array.isArray(current.logs) ? current.logs : [];
    const retention = Math.max(10, toNumber(current.retention, data.quoteMeta?.integrationAuditRetention || 50));
    const logs = [entry, ...existingLogs].slice(0, retention);
    const providerKey = entry.provider;
    const nextProviders = {
      ...(current.providers || {}),
      [providerKey]: {
        ...((current.providers || {})[providerKey] || {}),
        state: entry.state,
        direction: entry.direction,
        occurredAtISO: entry.occurredAtISO,
        attempt: entry.attempt,
        message: entry.message,
        actorEmail: entry.actorEmail
      }
    };

    await updateDoc(quoteRef, {
      integrations: {
        ...current,
        providers: nextProviders,
        logs,
        lastSyncAtISO: entry.occurredAtISO,
        retention
      },
      updatedAtISO: entry.occurredAtISO
    });
    await syncPortalSnapshotFromQuoteDoc(id, quote.organizationId);
    return { ok: true, storage: "firebase", entry };
  }

  const existing = JSON.parse(localStorage.getItem(LOCAL_QUOTES_KEY) || "[]");
  let found = false;
  const next = existing.map((quote) => {
    if (quote.id !== id) return quote;
    found = true;
    const current = quote.integrations || {};
    const existingLogs = Array.isArray(current.logs) ? current.logs : [];
    const retention = Math.max(10, toNumber(current.retention, quote.quoteMeta?.integrationAuditRetention || 50));
    const logs = [entry, ...existingLogs].slice(0, retention);
    const providerKey = entry.provider;
    const nextProviders = {
      ...(current.providers || {}),
      [providerKey]: {
        ...((current.providers || {})[providerKey] || {}),
        state: entry.state,
        direction: entry.direction,
        occurredAtISO: entry.occurredAtISO,
        attempt: entry.attempt,
        message: entry.message,
        actorEmail: entry.actorEmail
      }
    };
    return {
      ...quote,
      updatedAtISO: entry.occurredAtISO,
      integrations: {
        ...current,
        providers: nextProviders,
        logs,
        lastSyncAtISO: entry.occurredAtISO,
        retention
      }
    };
  });

  if (!found) {
    throw new Error("Quote not found.");
  }

  localStorage.setItem(LOCAL_QUOTES_KEY, JSON.stringify(next));
  return { ok: true, storage: "local", entry };
}

export async function syncQuoteToCrm({
  quoteId,
  provider = "",
  actorEmail = "",
  trigger = "manual"
} = {}) {
  const id = String(quoteId || "").trim();
  if (!id) {
    throw new Error("Quote id is required.");
  }

  const quote = await readQuoteById(id);
  const crmSettings = resolveQuoteCrmSettings(quote);
  const requestedProvider = String(provider || "").trim().toLowerCase();
  const resolvedProvider = resolveCrmProvider(requestedProvider || crmSettings.crmProvider || "webhook", "webhook");
  const providerKey = normalizeIntegrationProvider(resolvedProvider);
  const currentAttempt = toNumber(quote.integrations?.providers?.[providerKey]?.attempt, 0);
  const attempt = Math.max(1, Math.round(currentAttempt + 1));

  if (!isCrmSyncEnabled(crmSettings)) {
    const reason = crmSettings.crmEnabled ? "CRM sync module is disabled by feature flag." : "CRM sync is disabled.";
    const log = await recordQuoteIntegrationSync({
      quoteId: id,
      provider: providerKey,
      state: "skipped",
      message: reason,
      actorEmail,
      attempt,
      payloadRef: trigger
    });
    return { ok: false, skipped: true, reason, entry: log.entry };
  }

  if (typeof fetch !== "function") {
    const reason = "CRM sync unavailable: fetch API is not supported in this runtime.";
    await recordQuoteIntegrationSync({
      quoteId: id,
      provider: providerKey,
      state: "error",
      message: reason,
      actorEmail,
      attempt,
      payloadRef: trigger
    });
    throw new Error(reason);
  }

  let loggedError = false;
  try {
    const request = buildCrmAdapterRequest({
      quote,
      settings: crmSettings,
      provider: resolvedProvider,
      trigger
    });
    const timeoutMs = Math.max(1000, toNumber(quote.quoteMeta?.integrationTimeoutMs, DEFAULT_CRM_SYNC_TIMEOUT_MS));
    const controller = typeof AbortController !== "undefined" ? new AbortController() : null;
    const timeout = controller
      ? globalThis.setTimeout(() => {
        controller.abort();
      }, timeoutMs)
      : null;

    let response;
    try {
      response = await fetch(request.endpoint, {
        method: request.method || "POST",
        headers: request.headers || { "Content-Type": "application/json" },
        body: JSON.stringify(request.body || {}),
        signal: controller?.signal
      });
    } finally {
      if (timeout) {
        globalThis.clearTimeout(timeout);
      }
    }

    let responseText = "";
    try {
      responseText = String(await response.text());
    } catch {
      responseText = "";
    }

    const payloadRef =
      response.headers.get("x-request-id") ||
      response.headers.get("x-correlation-id") ||
      response.headers.get("x-amzn-requestid") ||
      "";

    if (!response.ok) {
      const detail = responseText.trim().slice(0, 180);
      const message = `CRM sync failed (${response.status})${detail ? `: ${detail}` : ""}`;
      await recordQuoteIntegrationSync({
        quoteId: id,
        provider: providerKey,
        state: "error",
        message,
        actorEmail,
        attempt,
        payloadRef: payloadRef || trigger
      });
      loggedError = true;
      throw new Error(message);
    }

    const successMessage = `CRM sync success (${response.status})`;
    const log = await recordQuoteIntegrationSync({
      quoteId: id,
      provider: providerKey,
      state: "success",
      message: successMessage,
      actorEmail,
      attempt,
      payloadRef: payloadRef || trigger
    });

    return {
      ok: true,
      quoteId: id,
      provider: providerKey,
      endpoint: request.endpoint,
      status: response.status,
      entry: log.entry
    };
  } catch (err) {
    if (!loggedError) {
      const message = err?.name === "AbortError"
        ? `CRM sync timed out after ${DEFAULT_CRM_SYNC_TIMEOUT_MS}ms.`
        : String(err?.message || "CRM sync failed.");
      await recordQuoteIntegrationSync({
        quoteId: id,
        provider: providerKey,
        state: "error",
        message,
        actorEmail,
        attempt,
        payloadRef: trigger
      });
      throw new Error(message);
    }
    throw err;
  }
}

export async function updateQuoteBookingAssignment({ quoteId, staffLead = "" } = {}) {
  const id = String(quoteId || "").trim();
  if (!id) {
    throw new Error("Quote id is required.");
  }
  const quote = await readQuoteById(id);
  const nowISO = isoNow();
  const nextLead = String(staffLead || "").trim();

  await saveQuoteVersion(id);

  if (firebaseReady) {
    await updateDoc(quoteWriteDocRef(id, quote.organizationId, "updateQuoteBookingAssignment"), {
      "booking.staffLead": nextLead,
      "booking.staffAssignedAtISO": nowISO,
      updatedAtISO: nowISO
    });
    await syncPortalSnapshotFromQuoteDoc(id, quote.organizationId);
    return { ok: true, storage: "firebase" };
  }

  const existing = JSON.parse(localStorage.getItem(LOCAL_QUOTES_KEY) || "[]");
  let found = false;
  const next = existing.map((quote) => {
    if (quote.id !== id) return quote;
    found = true;
    const booking = hydrateBooking(quote.booking);
    return {
      ...quote,
      updatedAtISO: nowISO,
      booking: {
        ...booking,
        staffLead: nextLead,
        staffAssignedAtISO: nowISO
      }
    };
  });
  if (!found) {
    throw new Error("Quote not found.");
  }
  localStorage.setItem(LOCAL_QUOTES_KEY, JSON.stringify(next));
  return { ok: true, storage: "local" };
}

export async function submitQuote({
  form,
  totals,
  pricingSnapshot = null,
  catalogSource,
  settings,
  catalog = {},
  ownerUid = "",
  ownerEmail = "",
  organizationId = undefined
}) {
  const nowISO = isoNow();
  const quoteNumber = buildQuoteNumber();
  const portalKey = buildPortalKey();
  const portalIssuedAtISO = nowISO;
  const resolvedOrganizationId = resolveQuoteOrganizationId(organizationId);
  const normalizedCustomerEmail = normalizeEmail(form.email);
  const customerNameKey = normalizeCustomerNameKey(form.name);
  const eventTypeId = String(form.eventTypeId || "").trim();
  const validityDays = Math.max(1, Number(settings?.quoteValidityDays || DEFAULT_VALIDITY_DAYS));
  const expiresAtISO = addDaysISO(nowISO, validityDays);
  const portalExpiresAtISO = resolvePortalExpiresAtISO(
    {
      expiresAtISO,
      portalIssuedAtISO
    },
    portalIssuedAtISO,
    nowISO
  );
  const menuItems = Array.isArray(form.menuItems) ? form.menuItems : [];
  const guests = Number(form.guests || 0);
  const menuItemQuantities = normalizeQuantityMap(form.menuItemQuantities);
  const addonQuantities = normalizeQuantityMap(form.addonQuantities);
  const rentalQuantities = normalizeQuantityMap(form.rentalQuantities);
  const menuItemDetails = resolveMenuItemDetails(menuItems, settings, menuItemQuantities);
  const menuItemNames = menuItemDetails.map((item) => item.name);
  const addonSnapshots = resolveItemSnapshots(form.addons, catalog?.addons, addonQuantities, {
    guests,
    defaultPricingType: "per_person"
  });
  const rentalSnapshots = resolveItemSnapshots(form.rentals, catalog?.rentals, rentalQuantities, {
    guests,
    defaultPricingType: "per_item"
  });
  const crmProvider = resolveCrmProvider(settings?.crmProvider || "webhook", "webhook");
  const featureFlags = settings?.featureFlags && typeof settings.featureFlags === "object"
    ? { ...settings.featureFlags }
    : {};
  const crmProviderConfig = {
    enabled: Boolean(settings?.crmEnabled),
    state: "idle",
    occurredAtISO: "",
    provider: crmProvider
  };
  const persistedPricing = resolvePersistedPricingSnapshot({
    pricingSnapshot,
    form,
    totals,
    settings,
    selection: {
      packageId: form.pkg,
      packageName: totals.selectedPkg?.name || "",
      addons: form.addons,
      rentals: form.rentals,
      menuItems,
      addonQuantities,
      rentalQuantities,
      menuItemQuantities,
      milesRT: Number(form.milesRT || 0),
      taxRegion: form.taxRegion || settings?.defaultTaxRegion || "",
      seasonProfileId: form.seasonProfileId || settings?.defaultSeasonProfile || "auto",
      bartenderRateTypeId: String(form.bartenderRateTypeId || ""),
      staffingRateTypeId: String(form.staffingRateTypeId || ""),
      bartenderRateOverride:
        form.bartenderRateOverride === "" || form.bartenderRateOverride === null || form.bartenderRateOverride === undefined
          ? ""
          : toNumber(form.bartenderRateOverride, 0),
      serverRateOverride:
        form.serverRateOverride === "" || form.serverRateOverride === null || form.serverRateOverride === undefined
          ? ""
          : toNumber(form.serverRateOverride, 0),
      chefRateOverride:
        form.chefRateOverride === "" || form.chefRateOverride === null || form.chefRateOverride === undefined
          ? ""
          : toNumber(form.chefRateOverride, 0)
    },
    catalogSource,
    organizationId: resolvedOrganizationId,
    quoteNumber,
    ownerUid,
    ownerEmail,
    reason: "submit_quote"
  });
  const payload = {
    quoteNumber,
    customer: {
      name: form.name || "",
      email: normalizedCustomerEmail,
      phone: form.phone || "",
      organization: form.clientOrg || ""
    },
    customerEmailKey: normalizedCustomerEmail,
    customerNameKey,
    eventTypeId,
    deletedAtISO: "",
    ownerUid: ownerUid || "",
    ownerEmail: normalizeEmail(ownerEmail),
    organizationId: resolvedOrganizationId,
    portalKey,
    portalIssuedAtISO,
    portalExpiresAtISO,
    event: {
      name: form.eventName || "",
      date: form.date || "",
      time: form.time || "",
      venue: form.venue || "",
      venueAddress: form.venueAddress || "",
      guests: Number(form.guests || 0),
      hours: Number(form.hours || 0),
      bartenders: Number(form.bartenders || 0),
      style: form.style || "",
      eventTypeId
    },
    selection: {
      packageId: form.pkg,
      packageName: totals.selectedPkg?.name || "",
      addons: form.addons,
      rentals: form.rentals,
      addonQuantities,
      rentalQuantities,
      menuItemQuantities,
      addonSnapshots,
      rentalSnapshots,
      menuItems,
      menuItemsSnapshot: menuItemDetails.map((item) => ({
        id: item.id,
        name: item.name,
        price: Number(item.price || 0),
        pricingType: normalizePricingType(item.pricingType || item.type, "per_event"),
        quantity: Math.max(1, Math.round(toNumber(item.quantity, 1)))
      })),
      menuItemNames,
      menuItemDetails,
      milesRT: Number(form.milesRT || 0),
      payMethod: form.payMethod,
      eventTemplateId: form.eventTemplateId || "custom",
      eventTypeId,
      taxRegion: form.taxRegion || settings?.defaultTaxRegion || "",
      seasonProfileId: form.seasonProfileId || settings?.defaultSeasonProfile || "auto",
      laborRateSnapshot: {
        bartenderRateApplied: totals.bartenderRateApplied,
        serverRateApplied: totals.serverRateApplied,
        chefRateApplied: totals.chefRateApplied,
        bartenderRateTypeId: totals.bartenderRateTypeId || "",
        bartenderRateTypeName: totals.bartenderRateTypeName || "",
        staffingRateTypeId: totals.staffingRateTypeId || "",
        staffingRateTypeName: totals.staffingRateTypeName || ""
      },
      bartenderRateTypeId: String(form.bartenderRateTypeId || ""),
      staffingRateTypeId: String(form.staffingRateTypeId || ""),
      bartenderRateOverride:
        form.bartenderRateOverride === "" || form.bartenderRateOverride === null || form.bartenderRateOverride === undefined
          ? ""
          : toNumber(form.bartenderRateOverride, 0),
      serverRateOverride:
        form.serverRateOverride === "" || form.serverRateOverride === null || form.serverRateOverride === undefined
          ? ""
          : toNumber(form.serverRateOverride, 0),
      chefRateOverride:
        form.chefRateOverride === "" || form.chefRateOverride === null || form.chefRateOverride === undefined
          ? ""
          : toNumber(form.chefRateOverride, 0)
    },
    payment: {
      depositLink: (form.depositLink || "").trim(),
      depositStatus: form.depositLink ? "sent" : "unpaid",
      depositConfirmedAtISO: ""
    },
    booking: {
      bookedAtISO: "",
      bookedByEmail: "",
      staffLead: "",
      staffAssignedAtISO: "",
      contractNumber: "",
      contractConvertedAtISO: "",
      contractConvertedByEmail: "",
      confirmationStatus: "pending",
      confirmationSentAtISO: "",
      confirmedAtISO: "",
      confirmationUpdatedByEmail: "",
      availabilityCheckedAtISO: "",
      availabilitySummary: {}
    },
    integrations: {
      retryLimit: Math.max(1, Number(settings?.integrationRetryLimit || 3)),
      retention: Math.max(10, Number(settings?.integrationAuditRetention || 50)),
      lastSyncAtISO: "",
      providers: {
        crm: { ...crmProviderConfig },
        [crmProvider]: { ...crmProviderConfig }
      },
      logs: []
    },
    totals: {
      base: totals.base,
      addons: totals.addons,
      rentals: totals.rentals,
      menu: totals.menu,
      labor: totals.labor,
      bartenderLabor: totals.bartenderLabor,
      bartenderRateApplied: totals.bartenderRateApplied,
      serverRateApplied: totals.serverRateApplied,
      chefRateApplied: totals.chefRateApplied,
      bartenderRateTypeId: totals.bartenderRateTypeId || "",
      bartenderRateTypeName: totals.bartenderRateTypeName || "",
      staffingRateTypeId: totals.staffingRateTypeId || "",
      staffingRateTypeName: totals.staffingRateTypeName || "",
      travel: totals.travel,
      serviceFee: totals.serviceFee,
      tax: totals.tax,
      total: totals.total,
      deposit: totals.deposit,
      serviceFeePctApplied: totals.serviceFeePctApplied,
      taxRateApplied: totals.taxRateApplied,
      taxRegionId: totals.taxRegionId,
      taxRegionName: totals.taxRegionName,
      seasonProfileId: totals.seasonProfileId,
      seasonProfileName: totals.seasonProfileName,
      packageMultiplier: totals.packageMultiplier,
      addonMultiplier: totals.addonMultiplier,
      rentalMultiplier: totals.rentalMultiplier
    },
    pricing: persistedPricing,
    quoteMeta: {
      quotePreparedBy: settings?.quotePreparedBy || "",
      brandName: settings?.brandName || "",
      brandTagline: settings?.brandTagline || "",
      brandLogoUrl: settings?.brandLogoUrl || "",
      brandPrimaryColor: settings?.brandPrimaryColor || "",
      brandAccentColor: settings?.brandAccentColor || "",
      brandDarkAccentColor: settings?.brandDarkAccentColor || "",
      brandCrew: Array.isArray(settings?.brandCrew) ? settings.brandCrew : [],
      businessPhone: settings?.businessPhone || "",
      businessEmail: settings?.businessEmail || "",
      businessAddress: settings?.businessAddress || "",
      acceptanceEmail: settings?.acceptanceEmail || "",
      includeDisposables: form.includeDisposables !== false,
      disposablesNote: settings?.disposablesNote || "",
      depositNotice: settings?.depositNotice || "",
      quoteValidityDays: Number(settings?.quoteValidityDays || DEFAULT_VALIDITY_DAYS),
      pricingSettingsVersion: Math.max(0, Math.round(toNumber(settings?.pricingSettingsVersion, 0))),
      pricingSettingsUpdatedAtISO: String(settings?.pricingSettingsUpdatedAtISO || "").trim(),
      crmEnabled: Boolean(settings?.crmEnabled),
      crmProvider,
      crmWebhookUrl: settings?.crmWebhookUrl || "",
      crmWebhookBridgeUrl: settings?.crmWebhookBridgeUrl || "",
      crmHubspotBridgeUrl: settings?.crmHubspotBridgeUrl || "",
      crmSalesforceBridgeUrl: settings?.crmSalesforceBridgeUrl || "",
      crmBridgeAuthToken: settings?.crmBridgeAuthToken || "",
      crmAutoSyncOnSent: Boolean(settings?.crmAutoSyncOnSent),
      crmAutoSyncOnBooked: Boolean(settings?.crmAutoSyncOnBooked),
      featureFlags,
      integrationRetryLimit: Math.max(1, Number(settings?.integrationRetryLimit || 3)),
      integrationAuditRetention: Math.max(10, Number(settings?.integrationAuditRetention || 50))
    },
    status: "draft",
    source: catalogSource,
    createdAtISO: nowISO,
    expiresAtISO,
    lifecycle: {
      draftAtISO: nowISO
    },
    activeVersionId: "",
    latestVersionNumber: 0
  };

  if (firebaseReady) {
    const ref = await addDoc(quoteWriteCollectionRef(resolvedOrganizationId, "submitQuote"), {
      ...payload,
      createdAt: serverTimestamp()
    });
    await setDoc(
      portalDocRef(portalKey),
      buildPortalSnapshot(ref.id, payload),
      { merge: true }
    );
    await saveQuoteVersion(ref.id, {
      reason: "initial_quote_create",
      setActive: true,
      organizationId: resolvedOrganizationId
    });
    return {
      id: ref.id,
      quoteNumber,
      portalKey,
      portalIssuedAtISO,
      portalExpiresAtISO,
      storage: "firebase"
    };
  }

  const existing = JSON.parse(localStorage.getItem(LOCAL_QUOTES_KEY) || "[]");
  const fallbackId = globalThis.crypto?.randomUUID ? globalThis.crypto.randomUUID() : String(Date.now());
  existing.unshift({ id: fallbackId, ...payload });
  localStorage.setItem(LOCAL_QUOTES_KEY, JSON.stringify(existing));
  await saveQuoteVersion(fallbackId, {
    reason: "initial_quote_create",
    setActive: true,
    organizationId: resolvedOrganizationId
  });
  return {
    id: fallbackId,
    quoteNumber,
    portalKey,
    portalIssuedAtISO,
    portalExpiresAtISO,
    storage: "local"
  };
}

export async function updateQuote({
  quoteId,
  form,
  totals,
  pricingSnapshot = null,
  catalogSource,
  settings,
  catalog = {},
  ownerUid = "",
  ownerEmail = "",
  organizationId = undefined
}) {
  const id = String(quoteId || "").trim();
  if (!id) {
    throw new Error("Quote id is required.");
  }

  const existing = await readQuoteById(id);
  const nowISO = isoNow();
  const normalizedCustomerEmail = normalizeEmail(form.email);
  const customerNameKey = normalizeCustomerNameKey(form.name);
  const eventTypeId = String(form.eventTypeId || "").trim();
  const validityDays = Math.max(1, Number(settings?.quoteValidityDays || DEFAULT_VALIDITY_DAYS));
  const expiresAtISO = addDaysISO(nowISO, validityDays);
  const menuItems = Array.isArray(form.menuItems) ? form.menuItems : [];
  const guests = Number(form.guests || 0);
  const menuItemQuantities = normalizeQuantityMap(form.menuItemQuantities);
  const addonQuantities = normalizeQuantityMap(form.addonQuantities);
  const rentalQuantities = normalizeQuantityMap(form.rentalQuantities);
  const menuItemDetails = resolveMenuItemDetails(menuItems, settings, menuItemQuantities);
  const menuItemNames = menuItemDetails.map((item) => item.name);
  const addonSnapshots = resolveItemSnapshots(form.addons, catalog?.addons, addonQuantities, {
    guests,
    defaultPricingType: "per_person"
  });
  const rentalSnapshots = resolveItemSnapshots(form.rentals, catalog?.rentals, rentalQuantities, {
    guests,
    defaultPricingType: "per_item"
  });
  const crmProvider = resolveCrmProvider(settings?.crmProvider || "webhook", "webhook");
  const featureFlags = settings?.featureFlags && typeof settings.featureFlags === "object"
    ? { ...settings.featureFlags }
    : {};
  const lifecycle = lifecycleObject("draft", nowISO, existing.lifecycle);
  const portalKey = String(existing.portalKey || "").trim() || buildPortalKey();
  const portalIssuedAtISO = resolvePortalIssuedAtISO(existing, existing.createdAtISO || nowISO);
  const organizationCandidate = organizationId !== undefined ? organizationId : existing.organizationId;
  const nextOrganizationId = firebaseReady
    ? requireWriteOrganizationId(organizationCandidate, "updateQuote")
    : resolveQuoteOrganizationId(organizationCandidate);
  const portalExpiresAtISO = resolvePortalExpiresAtISO(
    {
      ...existing,
      expiresAtISO,
      portalIssuedAtISO
    },
    portalIssuedAtISO,
    nowISO
  );
  const hasVersionHistory =
    toVersionNumber(existing.latestVersionNumber, 0) > 0 || Boolean(String(existing.activeVersionId || "").trim());
  if (!hasVersionHistory) {
    await saveQuoteVersion(id, {
      reason: "legacy_pre_edit_baseline",
      organizationId: nextOrganizationId
    });
  }

  const existingPayment = hydratePayment(existing.payment);
  const nextDepositLink = String(form.depositLink || "").trim();
  let nextDepositStatus = normalizePaymentStatus(existingPayment.depositStatus || "unpaid");
  if (nextDepositLink && nextDepositStatus === "unpaid") {
    nextDepositStatus = "sent";
  }
  if (!nextDepositLink && nextDepositStatus === "sent") {
    nextDepositStatus = "unpaid";
  }
  const persistedPricing = resolvePersistedPricingSnapshot({
    pricingSnapshot,
    form,
    totals,
    settings,
    selection: {
      packageId: form.pkg,
      packageName: totals.selectedPkg?.name || "",
      addons: form.addons,
      rentals: form.rentals,
      menuItems,
      addonQuantities,
      rentalQuantities,
      menuItemQuantities,
      milesRT: Number(form.milesRT || 0),
      taxRegion: form.taxRegion || settings?.defaultTaxRegion || "",
      seasonProfileId: form.seasonProfileId || settings?.defaultSeasonProfile || "auto",
      bartenderRateTypeId: String(form.bartenderRateTypeId || ""),
      staffingRateTypeId: String(form.staffingRateTypeId || ""),
      bartenderRateOverride:
        form.bartenderRateOverride === "" || form.bartenderRateOverride === null || form.bartenderRateOverride === undefined
          ? ""
          : toNumber(form.bartenderRateOverride, 0),
      serverRateOverride:
        form.serverRateOverride === "" || form.serverRateOverride === null || form.serverRateOverride === undefined
          ? ""
          : toNumber(form.serverRateOverride, 0),
      chefRateOverride:
        form.chefRateOverride === "" || form.chefRateOverride === null || form.chefRateOverride === undefined
          ? ""
          : toNumber(form.chefRateOverride, 0)
    },
    catalogSource,
    organizationId: nextOrganizationId,
    quoteId: id,
    quoteNumber: existing.quoteNumber || "",
    ownerUid: ownerUid || existing.ownerUid || "",
    ownerEmail: normalizeEmail(ownerEmail) || existing.ownerEmail || "",
    reason: "update_quote"
  });

  const patch = {
    customer: {
      name: form.name || "",
      email: normalizedCustomerEmail,
      phone: form.phone || "",
      organization: form.clientOrg || ""
    },
    customerEmailKey: normalizedCustomerEmail,
    customerNameKey,
    eventTypeId,
    deletedAtISO: "",
    ownerUid: ownerUid || existing.ownerUid || "",
    ownerEmail: normalizeEmail(ownerEmail) || existing.ownerEmail || "",
    organizationId: nextOrganizationId,
    portalKey,
    portalIssuedAtISO,
    portalExpiresAtISO,
    event: {
      name: form.eventName || "",
      date: form.date || "",
      time: form.time || "",
      venue: form.venue || "",
      venueAddress: form.venueAddress || "",
      guests: Number(form.guests || 0),
      hours: Number(form.hours || 0),
      bartenders: Number(form.bartenders || 0),
      style: form.style || "",
      eventTypeId
    },
    selection: {
      packageId: form.pkg,
      packageName: totals.selectedPkg?.name || "",
      addons: form.addons,
      rentals: form.rentals,
      addonQuantities,
      rentalQuantities,
      menuItemQuantities,
      addonSnapshots,
      rentalSnapshots,
      menuItems,
      menuItemsSnapshot: menuItemDetails.map((item) => ({
        id: item.id,
        name: item.name,
        price: Number(item.price || 0),
        pricingType: normalizePricingType(item.pricingType || item.type, "per_event"),
        quantity: Math.max(1, Math.round(toNumber(item.quantity, 1)))
      })),
      menuItemNames,
      menuItemDetails,
      milesRT: Number(form.milesRT || 0),
      payMethod: form.payMethod,
      eventTemplateId: form.eventTemplateId || "custom",
      eventTypeId,
      taxRegion: form.taxRegion || settings?.defaultTaxRegion || "",
      seasonProfileId: form.seasonProfileId || settings?.defaultSeasonProfile || "auto",
      laborRateSnapshot: {
        bartenderRateApplied: totals.bartenderRateApplied,
        serverRateApplied: totals.serverRateApplied,
        chefRateApplied: totals.chefRateApplied,
        bartenderRateTypeId: totals.bartenderRateTypeId || "",
        bartenderRateTypeName: totals.bartenderRateTypeName || "",
        staffingRateTypeId: totals.staffingRateTypeId || "",
        staffingRateTypeName: totals.staffingRateTypeName || ""
      },
      bartenderRateTypeId: String(form.bartenderRateTypeId || ""),
      staffingRateTypeId: String(form.staffingRateTypeId || ""),
      bartenderRateOverride:
        form.bartenderRateOverride === "" || form.bartenderRateOverride === null || form.bartenderRateOverride === undefined
          ? ""
          : toNumber(form.bartenderRateOverride, 0),
      serverRateOverride:
        form.serverRateOverride === "" || form.serverRateOverride === null || form.serverRateOverride === undefined
          ? ""
          : toNumber(form.serverRateOverride, 0),
      chefRateOverride:
        form.chefRateOverride === "" || form.chefRateOverride === null || form.chefRateOverride === undefined
          ? ""
          : toNumber(form.chefRateOverride, 0)
    },
    payment: {
      ...existingPayment,
      depositLink: nextDepositLink,
      depositStatus: nextDepositStatus
    },
    totals: {
      base: totals.base,
      addons: totals.addons,
      rentals: totals.rentals,
      menu: totals.menu,
      labor: totals.labor,
      bartenderLabor: totals.bartenderLabor,
      bartenderRateApplied: totals.bartenderRateApplied,
      serverRateApplied: totals.serverRateApplied,
      chefRateApplied: totals.chefRateApplied,
      bartenderRateTypeId: totals.bartenderRateTypeId || "",
      bartenderRateTypeName: totals.bartenderRateTypeName || "",
      staffingRateTypeId: totals.staffingRateTypeId || "",
      staffingRateTypeName: totals.staffingRateTypeName || "",
      travel: totals.travel,
      serviceFee: totals.serviceFee,
      tax: totals.tax,
      total: totals.total,
      deposit: totals.deposit,
      serviceFeePctApplied: totals.serviceFeePctApplied,
      taxRateApplied: totals.taxRateApplied,
      taxRegionId: totals.taxRegionId,
      taxRegionName: totals.taxRegionName,
      seasonProfileId: totals.seasonProfileId,
      seasonProfileName: totals.seasonProfileName,
      packageMultiplier: totals.packageMultiplier,
      addonMultiplier: totals.addonMultiplier,
      rentalMultiplier: totals.rentalMultiplier
    },
    pricing: persistedPricing,
    quoteMeta: {
      quotePreparedBy: settings?.quotePreparedBy || "",
      brandName: settings?.brandName || "",
      brandTagline: settings?.brandTagline || "",
      brandLogoUrl: settings?.brandLogoUrl || "",
      brandPrimaryColor: settings?.brandPrimaryColor || "",
      brandAccentColor: settings?.brandAccentColor || "",
      brandDarkAccentColor: settings?.brandDarkAccentColor || "",
      brandCrew: Array.isArray(settings?.brandCrew) ? settings.brandCrew : [],
      businessPhone: settings?.businessPhone || "",
      businessEmail: settings?.businessEmail || "",
      businessAddress: settings?.businessAddress || "",
      acceptanceEmail: settings?.acceptanceEmail || "",
      includeDisposables: form.includeDisposables !== false,
      disposablesNote: settings?.disposablesNote || "",
      depositNotice: settings?.depositNotice || "",
      quoteValidityDays: Number(settings?.quoteValidityDays || DEFAULT_VALIDITY_DAYS),
      pricingSettingsVersion: Math.max(0, Math.round(toNumber(settings?.pricingSettingsVersion, 0))),
      pricingSettingsUpdatedAtISO: String(settings?.pricingSettingsUpdatedAtISO || "").trim(),
      crmEnabled: Boolean(settings?.crmEnabled),
      crmProvider,
      crmWebhookUrl: settings?.crmWebhookUrl || "",
      crmWebhookBridgeUrl: settings?.crmWebhookBridgeUrl || "",
      crmHubspotBridgeUrl: settings?.crmHubspotBridgeUrl || "",
      crmSalesforceBridgeUrl: settings?.crmSalesforceBridgeUrl || "",
      crmBridgeAuthToken: settings?.crmBridgeAuthToken || "",
      crmAutoSyncOnSent: Boolean(settings?.crmAutoSyncOnSent),
      crmAutoSyncOnBooked: Boolean(settings?.crmAutoSyncOnBooked),
      featureFlags,
      integrationRetryLimit: Math.max(1, Number(settings?.integrationRetryLimit || 3)),
      integrationAuditRetention: Math.max(10, Number(settings?.integrationAuditRetention || 50))
    },
    status: "draft",
    source: catalogSource,
    expiresAtISO,
    lifecycle,
    updatedAtISO: nowISO
  };

  if (firebaseReady) {
    const writeTarget = await ensureQuoteWriteTarget(id, {
      organizationId: nextOrganizationId,
      action: "updateQuote"
    });
    const writeOrganizationId = writeTarget.organizationId;
    patch.organizationId = writeOrganizationId;
    await updateDoc(quoteWriteDocRef(id, writeOrganizationId, "updateQuote"), patch);
    await syncPortalSnapshotFromQuoteDoc(id, writeOrganizationId);
    const versionResult = await saveQuoteVersion(id, {
      reason: "quote_edit",
      setActive: true,
      organizationId: writeOrganizationId
    });
    return {
      id,
      quoteNumber: existing.quoteNumber || "",
      portalKey,
      portalIssuedAtISO,
      portalExpiresAtISO,
      storage: "firebase",
      activeVersionId: versionResult.versionId,
      latestVersionNumber: versionResult.versionNumber
    };
  }

  const existingQuotes = JSON.parse(localStorage.getItem(LOCAL_QUOTES_KEY) || "[]");
  let found = false;
  const next = existingQuotes.map((item) => {
    if (item.id !== id) return item;
    found = true;
    return {
      ...item,
      ...patch
    };
  });
  if (!found) {
    throw new Error("Quote not found.");
  }
  localStorage.setItem(LOCAL_QUOTES_KEY, JSON.stringify(next));
  const versionResult = await saveQuoteVersion(id, {
    reason: "quote_edit",
    setActive: true,
    organizationId: nextOrganizationId
  });
  return {
    id,
    quoteNumber: existing.quoteNumber || "",
    portalKey,
    portalIssuedAtISO,
    portalExpiresAtISO,
    storage: "local",
    activeVersionId: versionResult.versionId,
    latestVersionNumber: versionResult.versionNumber
  };
}

export async function rotateQuotePortalKey({ quoteId, actorEmail = "" } = {}) {
  const id = String(quoteId || "").trim();
  if (!id) {
    throw new Error("Quote id is required.");
  }

  const quote = await readQuoteById(id);
  const nowISO = isoNow();
  const previousPortalKey = String(quote.portalKey || "").trim();
  const nextPortalKey = buildPortalKey();
  const portalIssuedAtISO = nowISO;
  const portalExpiresAtISO = resolvePortalExpiresAtISO(
    {
      expiresAtISO: quote.expiresAtISO || addDaysISO(nowISO, DEFAULT_VALIDITY_DAYS),
      portalIssuedAtISO
    },
    portalIssuedAtISO,
    nowISO
  );
  const normalizedActorEmail = normalizeEmail(actorEmail);

  await saveQuoteVersion(id, {
    reason: "portal_key_rotate",
    organizationId: quote.organizationId
  });

  if (firebaseReady) {
    await updateDoc(quoteWriteDocRef(id, quote.organizationId, "rotateQuotePortalKey"), {
      portalKey: nextPortalKey,
      portalIssuedAtISO,
      portalExpiresAtISO,
      updatedAtISO: nowISO,
      ...(normalizedActorEmail ? { "quoteMeta.portalRotatedByEmail": normalizedActorEmail } : {})
    });
    await syncPortalSnapshotFromQuoteDoc(id, quote.organizationId);
    if (previousPortalKey && previousPortalKey !== nextPortalKey) {
      try {
        await deleteDoc(portalDocRef(previousPortalKey));
      } catch {
        // Ignore best-effort cleanup errors for stale portal snapshots.
      }
    }
    return {
      ok: true,
      storage: "firebase",
      portalKey: nextPortalKey,
      portalIssuedAtISO,
      portalExpiresAtISO
    };
  }

  const existing = JSON.parse(localStorage.getItem(LOCAL_QUOTES_KEY) || "[]");
  let found = false;
  const next = existing.map((item) => {
    if (item.id !== id) return item;
    found = true;
    return {
      ...item,
      portalKey: nextPortalKey,
      portalIssuedAtISO,
      portalExpiresAtISO,
      updatedAtISO: nowISO,
      quoteMeta: {
        ...(item.quoteMeta || {}),
        ...(normalizedActorEmail ? { portalRotatedByEmail: normalizedActorEmail } : {})
      }
    };
  });
  if (!found) {
    throw new Error("Quote not found.");
  }
  localStorage.setItem(LOCAL_QUOTES_KEY, JSON.stringify(next));

  return {
    ok: true,
    storage: "local",
    portalKey: nextPortalKey,
    portalIssuedAtISO,
    portalExpiresAtISO
  };
}

export async function duplicateQuote(quoteId, { ownerUid = "", ownerEmail = "" } = {}) {
  const source = await readQuoteById(quoteId);
  const nowISO = isoNow();
  const quoteNumber = buildQuoteNumber();
  const portalKey = buildPortalKey();
  const portalIssuedAtISO = nowISO;
  const organizationId = firebaseReady
    ? requireWriteOrganizationId(source.organizationId, "duplicateQuote")
    : resolveQuoteOrganizationId(source.organizationId);
  const validityDays = Math.max(1, Number(source?.quoteMeta?.quoteValidityDays || DEFAULT_VALIDITY_DAYS));
  const expiresAtISO = addDaysISO(nowISO, validityDays);
  const portalExpiresAtISO = resolvePortalExpiresAtISO(
    {
      expiresAtISO,
      portalIssuedAtISO
    },
    portalIssuedAtISO,
    nowISO
  );
  const payment = hydratePayment(source.payment);
  const normalizedOwnerEmail = normalizeEmail(ownerEmail) || source.ownerEmail || "";
  const { id: _sourceId, createdAt: _createdAt, ...sourceWithoutIdentity } = source;

  const selection = {
    ...(sourceWithoutIdentity.selection || {}),
    addonQuantities: normalizeQuantityMap(sourceWithoutIdentity.selection?.addonQuantities),
    rentalQuantities: normalizeQuantityMap(sourceWithoutIdentity.selection?.rentalQuantities),
    menuItemQuantities: normalizeQuantityMap(sourceWithoutIdentity.selection?.menuItemQuantities),
    menuItemsSnapshot: Array.isArray(sourceWithoutIdentity.selection?.menuItemsSnapshot)
      ? sourceWithoutIdentity.selection.menuItemsSnapshot.map((item) => ({
        id: String(item?.id || "").trim(),
        name: String(item?.name || "").trim() || String(item?.id || "").trim(),
        price: Number(item?.price || 0),
        pricingType: normalizePricingType(item?.pricingType || item?.type, "per_event"),
        quantity: Math.max(1, Math.round(toNumber(item?.quantity, 1)))
      }))
      : [],
    menuItemDetails: Array.isArray(sourceWithoutIdentity.selection?.menuItemDetails)
      ? sourceWithoutIdentity.selection.menuItemDetails.map((item) => ({
        id: String(item?.id || "").trim(),
        name: String(item?.name || "").trim() || String(item?.id || "").trim(),
        price: Number(item?.price || 0),
        pricingType: normalizePricingType(item?.pricingType || item?.type, "per_event"),
        type: normalizePricingType(item?.pricingType || item?.type, "per_event"),
        quantity: Math.max(1, Math.round(toNumber(item?.quantity, 1)))
      }))
      : []
  };

  const payload = {
    ...sourceWithoutIdentity,
    quoteNumber,
    portalKey,
    portalIssuedAtISO,
    portalExpiresAtISO,
    ownerUid: ownerUid || source.ownerUid || "",
    ownerEmail: normalizedOwnerEmail,
    organizationId,
    status: "draft",
    deletedAtISO: "",
    selection,
    payment: {
      ...payment,
      depositStatus: payment.depositLink ? "sent" : "unpaid",
      depositConfirmedAtISO: ""
    },
    booking: {
      bookedAtISO: "",
      bookedByEmail: "",
      staffLead: "",
      staffAssignedAtISO: "",
      contractNumber: "",
      contractConvertedAtISO: "",
      contractConvertedByEmail: "",
      confirmationStatus: "pending",
      confirmationSentAtISO: "",
      confirmedAtISO: "",
      confirmationUpdatedByEmail: "",
      availabilityCheckedAtISO: "",
      availabilitySummary: {}
    },
    integrations: {
      ...(sourceWithoutIdentity.integrations || {}),
      lastSyncAtISO: "",
      logs: []
    },
    createdAtISO: nowISO,
    updatedAtISO: nowISO,
    expiresAtISO,
    lifecycle: {
      draftAtISO: nowISO
    },
    activeVersionId: "",
    latestVersionNumber: 0
  };

  if (firebaseReady) {
    const ref = await addDoc(quoteWriteCollectionRef(organizationId, "duplicateQuote"), {
      ...payload,
      createdAt: serverTimestamp()
    });
    await setDoc(
      portalDocRef(portalKey),
      buildPortalSnapshot(ref.id, payload),
      { merge: true }
    );
    await saveQuoteVersion(ref.id, {
      reason: "duplicate_quote_create",
      setActive: true,
      organizationId
    });
    return {
      id: ref.id,
      quoteNumber,
      portalKey,
      portalIssuedAtISO,
      portalExpiresAtISO,
      storage: "firebase"
    };
  }

  const existing = JSON.parse(localStorage.getItem(LOCAL_QUOTES_KEY) || "[]");
  const fallbackId = globalThis.crypto?.randomUUID ? globalThis.crypto.randomUUID() : String(Date.now());
  existing.unshift({ id: fallbackId, ...payload });
  localStorage.setItem(LOCAL_QUOTES_KEY, JSON.stringify(existing));
  await saveQuoteVersion(fallbackId, {
    reason: "duplicate_quote_create",
    setActive: true,
    organizationId
  });
  return {
    id: fallbackId,
    quoteNumber,
    portalKey,
    portalIssuedAtISO,
    portalExpiresAtISO,
    storage: "local"
  };
}

function applyQuoteHistoryFilters(quotes, { eventTypeId = "", customerName = "" } = {}) {
  const normalizedEventTypeId = String(eventTypeId || "").trim();
  const normalizedCustomerName = normalizeCustomerNameKey(customerName);

  return quotes.filter((quote) => {
    const quoteEventTypeId = String(quote?.eventTypeId || quote?.selection?.eventTypeId || "").trim();
    if (normalizedEventTypeId && quoteEventTypeId !== normalizedEventTypeId) {
      return false;
    }

    if (!normalizedCustomerName) {
      return true;
    }

    const nameKey = normalizeCustomerNameKey(quote?.customerNameKey || quote?.customer?.name || "");
    return nameKey.includes(normalizedCustomerName);
  });
}

export async function getQuoteHistory(filters = {}) {
  const normalizedEventTypeId = String(filters?.eventTypeId || "").trim();
  const normalizedCustomerName = normalizeCustomerNameKey(filters?.customerName || "");
  const nowISO = isoNow();

  if (firebaseReady) {
    const scopedOrganizationId = requireReadOrganizationId(filters?.organizationId, "quote history read");
    const quoteCollection = quotesCollectionRef(scopedOrganizationId);
    const runHistoryQuery = async (targetCollection) => {
      if (normalizedCustomerName) {
        const prefixConstraints = [
          where("customerNameKey", ">=", normalizedCustomerName),
          where("customerNameKey", "<=", `${normalizedCustomerName}\uf8ff`),
          orderBy("customerNameKey")
        ];
        if (normalizedEventTypeId) {
          prefixConstraints.unshift(where("eventTypeId", "==", normalizedEventTypeId));
        }
        try {
          const snap = await getDocs(query(targetCollection, ...prefixConstraints));
          return { snap, usedServerCustomerPrefix: true };
        } catch {
          const fallbackConstraints = [orderBy("createdAt", "desc")];
          if (normalizedEventTypeId) {
            fallbackConstraints.unshift(where("eventTypeId", "==", normalizedEventTypeId));
          }
          const snap = await getDocs(query(targetCollection, ...fallbackConstraints));
          return { snap, usedServerCustomerPrefix: false };
        }
      }

      const constraints = [orderBy("createdAt", "desc")];
      if (normalizedEventTypeId) {
        constraints.unshift(where("eventTypeId", "==", normalizedEventTypeId));
      }
      const snap = await getDocs(query(targetCollection, ...constraints));
      return { snap, usedServerCustomerPrefix: false };
    };

    const { snap, usedServerCustomerPrefix } = await runHistoryQuery(quoteCollection);

    const quotes = sortQuotesDesc(
      snap.docs.map((docSnap) => {
        const data = docSnap.data();
        const createdAtISO = data.createdAt?.toDate ? data.createdAt.toDate().toISOString() : data.createdAtISO;
        return hydrateQuote(
          {
            id: docSnap.id,
            ...data,
            organizationId: normalizeOrganizationId(data.organizationId || scopedOrganizationId),
            createdAtISO: createdAtISO || nowISO
          },
          nowISO
        );
      })
    );

    const nextQuotes = quotes.map((quote) => applyExpiry(quote, nowISO));
    const autoExpired = nextQuotes.filter(
      (quote, idx) => quote.status === "expired" && quotes[idx].status !== "expired"
    );

    if (autoExpired.length) {
      const writableAutoExpired = autoExpired.filter((quote) => normalizeOrganizationId(quote.organizationId));
      await Promise.all(
        writableAutoExpired.map(async (quote) => {
          await saveQuoteVersion(quote.id);
          await updateDoc(quoteWriteDocRef(quote.id, quote.organizationId, "getQuoteHistory auto-expire"), {
            status: "expired",
            updatedAtISO: nowISO,
            "lifecycle.expiredAtISO": quote.lifecycle?.expiredAtISO || nowISO
          });
          await syncPortalSnapshotFromQuoteDoc(quote.id, quote.organizationId);
        })
      );
    }

    const filteredQuotes = applyQuoteHistoryFilters(nextQuotes, {
      eventTypeId: normalizedEventTypeId,
      customerName: usedServerCustomerPrefix ? "" : normalizedCustomerName
    });

    return {
      source: "firebase",
      quotes: filteredQuotes
    };
  }

  const existing = JSON.parse(localStorage.getItem(LOCAL_QUOTES_KEY) || "[]");
  const hydrated = sortQuotesDesc(existing).map((quote) => hydrateQuote(quote, nowISO));
  const nextQuotes = hydrated.map((quote) => applyExpiry(quote, nowISO));

  const autoExpiredIds = nextQuotes
    .map((quote, idx) => (quote.status !== hydrated[idx].status ? quote.id : ""))
    .filter(Boolean);

  if (autoExpiredIds.length) {
    for (const quoteId of autoExpiredIds) {
      await saveQuoteVersion(quoteId);
    }
    localStorage.setItem(LOCAL_QUOTES_KEY, JSON.stringify(nextQuotes));
  }

  return {
    source: "local",
    quotes: applyQuoteHistoryFilters(nextQuotes, {
      eventTypeId: normalizedEventTypeId,
      customerName: normalizedCustomerName
    })
  };
}

export async function updateQuoteStatus(quoteId, status) {
  if (!quoteId) {
    throw new Error("Quote id is required.");
  }

  const id = String(quoteId || "").trim();
  if (!id) {
    throw new Error("Quote id is required.");
  }
  const nowISO = isoNow();
  const nextStatus = normalizeStatus(status);
  const existingQuote = await readQuoteById(id);
  const statusPayload = {
    status: nextStatus,
    deletedAtISO: nextStatus === "deleted" ? nowISO : "",
    updatedAtISO: nowISO,
    ...lifecyclePatch(nextStatus, nowISO)
  };
  if (nextStatus === "booked") {
    statusPayload["booking.bookedAtISO"] = nowISO;
  }

  await saveQuoteVersion(id);

  if (firebaseReady) {
    await updateDoc(quoteWriteDocRef(id, existingQuote.organizationId, "updateQuoteStatus"), statusPayload);
    await syncPortalSnapshotFromQuoteDoc(id, existingQuote.organizationId);
  } else {
    const existing = JSON.parse(localStorage.getItem(LOCAL_QUOTES_KEY) || "[]");
    const next = existing.map((quote) => {
      if (quote.id !== id) return quote;
      const booking = hydrateBooking(quote.booking);
      return {
        ...quote,
        status: nextStatus,
        deletedAtISO: nextStatus === "deleted" ? nowISO : "",
        updatedAtISO: nowISO,
        booking:
          nextStatus === "booked"
            ? {
              ...booking,
              bookedAtISO: booking.bookedAtISO || nowISO
            }
            : booking,
        lifecycle: lifecycleObject(nextStatus, nowISO, quote.lifecycle)
      };
    });
    localStorage.setItem(LOCAL_QUOTES_KEY, JSON.stringify(next));
  }

  let crmSync = null;
  if (nextStatus === "sent" || nextStatus === "booked") {
    try {
      const updatedQuote = await readQuoteById(id);
      const crmSettings = resolveQuoteCrmSettings(updatedQuote);
      if (shouldAutoSyncCrmForStatus(crmSettings, nextStatus)) {
        try {
          crmSync = await syncQuoteToCrm({
            quoteId: id,
            provider: crmSettings.crmProvider,
            trigger: `status:${nextStatus}`
          });
        } catch (err) {
          crmSync = {
            ok: false,
            error: err?.message || "CRM auto-sync failed."
          };
        }
      }
    } catch {
      crmSync = {
        ok: false,
        error: "CRM auto-sync skipped: quote refresh failed."
      };
    }
  }

  return { ok: true, storage: firebaseReady ? "firebase" : "local", crmSync };
}

export async function updateQuotePaymentStatus(quoteId, paymentStatus) {
  if (!quoteId) {
    throw new Error("Quote id is required.");
  }

  const nowISO = isoNow();
  const nextPaymentStatus = normalizePaymentStatus(paymentStatus);
  const paymentPatch = {
    "payment.depositStatus": nextPaymentStatus,
    updatedAtISO: nowISO
  };

  if (nextPaymentStatus === "paid") {
    paymentPatch["payment.depositConfirmedAtISO"] = nowISO;
  }
  if (nextPaymentStatus === "unpaid" || nextPaymentStatus === "sent") {
    paymentPatch["payment.depositConfirmedAtISO"] = "";
  }

  await saveQuoteVersion(quoteId);

  if (firebaseReady) {
    const quote = await readQuoteById(quoteId);
    await updateDoc(quoteWriteDocRef(quoteId, quote.organizationId, "updateQuotePaymentStatus"), paymentPatch);
    await syncPortalSnapshotFromQuoteDoc(quoteId, quote.organizationId);
    return { ok: true, storage: "firebase" };
  }

  const existing = JSON.parse(localStorage.getItem(LOCAL_QUOTES_KEY) || "[]");
  const next = existing.map((quote) => {
    if (quote.id !== quoteId) return quote;
    const payment = hydratePayment(quote.payment);
    return {
      ...quote,
      updatedAtISO: nowISO,
      payment: {
        ...payment,
        depositStatus: nextPaymentStatus,
        depositConfirmedAtISO:
          nextPaymentStatus === "paid"
            ? nowISO
            : nextPaymentStatus === "unpaid" || nextPaymentStatus === "sent"
              ? ""
              : payment.depositConfirmedAtISO || ""
      }
    };
  });

  localStorage.setItem(LOCAL_QUOTES_KEY, JSON.stringify(next));
  return { ok: true, storage: "local" };
}

export async function reopenQuote(id) {
  const quoteId = String(id || "").trim();
  if (!quoteId) {
    throw new Error("Quote id is required.");
  }

  const quote = await readQuoteById(quoteId);
  const activeVersionResult = await getActiveQuoteVersion(quoteId, {
    organizationId: quote.organizationId
  });
  const activeSnapshot =
    activeVersionResult?.version?.snapshot && typeof activeVersionResult.version.snapshot === "object"
      ? activeVersionResult.version.snapshot
      : null;
  const nowISO = isoNow();
  const lifecycle = lifecycleObject("draft", nowISO, quote.lifecycle);
  const nextPortalKey = buildPortalKey();
  const previousPortalKey = String(quote.portalKey || "").trim();
  const restoredPatch = activeSnapshot
    ? {
      customer: activeSnapshot.customer || quote.customer,
      customerEmailKey: normalizeEmail(
        activeSnapshot.customerEmailKey || activeSnapshot.customer?.email || quote.customerEmailKey
      ),
      customerNameKey: normalizeCustomerNameKey(
        activeSnapshot.customerNameKey || activeSnapshot.customer?.name || quote.customerNameKey
      ),
      eventTypeId: String(activeSnapshot.eventTypeId || activeSnapshot.selection?.eventTypeId || quote.eventTypeId || "").trim(),
      ownerUid: String(activeSnapshot.ownerUid || quote.ownerUid || "").trim(),
      ownerEmail: normalizeEmail(activeSnapshot.ownerEmail || quote.ownerEmail || ""),
      event: activeSnapshot.event || quote.event,
      selection: activeSnapshot.selection || quote.selection,
      payment: hydratePayment(activeSnapshot.payment || quote.payment),
      booking: hydrateBooking(activeSnapshot.booking || quote.booking),
      totals: activeSnapshot.totals || quote.totals,
      pricing: resolveQuotePricingSnapshot(activeSnapshot),
      quoteMeta: activeSnapshot.quoteMeta || quote.quoteMeta,
      source: activeSnapshot.source || quote.source,
      expiresAtISO: activeSnapshot.expiresAtISO || quote.expiresAtISO
    }
    : {};
  const nextPortalIssuedAtISO = nowISO;
  const nextPortalExpiresAtISO = resolvePortalExpiresAtISO(
    {
      expiresAtISO: restoredPatch.expiresAtISO || quote.expiresAtISO || addDaysISO(nowISO, DEFAULT_VALIDITY_DAYS),
      portalIssuedAtISO: nextPortalIssuedAtISO
    },
    nextPortalIssuedAtISO,
    nowISO
  );

  await saveQuoteVersion(quoteId, {
    reason: "reopen_quote_before_restore",
    organizationId: quote.organizationId
  });

  if (firebaseReady) {
    await updateDoc(quoteWriteDocRef(quoteId, quote.organizationId, "reopenQuote"), {
      ...restoredPatch,
      status: "draft",
      portalKey: nextPortalKey,
      portalIssuedAtISO: nextPortalIssuedAtISO,
      portalExpiresAtISO: nextPortalExpiresAtISO,
      deletedAtISO: "",
      updatedAtISO: nowISO,
      lifecycle
    });
    await syncPortalSnapshotFromQuoteDoc(quoteId, quote.organizationId);
    if (previousPortalKey && previousPortalKey !== nextPortalKey) {
      try {
        await deleteDoc(portalDocRef(previousPortalKey));
      } catch {
        // Ignore best-effort cleanup errors for stale portal snapshots.
      }
    }
    return { ok: true, storage: "firebase" };
  }

  const existing = JSON.parse(localStorage.getItem(LOCAL_QUOTES_KEY) || "[]");
  const next = existing.map((item) => {
    if (item.id !== quoteId) return item;
    return {
      ...item,
      ...restoredPatch,
      status: "draft",
      portalKey: nextPortalKey,
      portalIssuedAtISO: nextPortalIssuedAtISO,
      portalExpiresAtISO: nextPortalExpiresAtISO,
      deletedAtISO: "",
      updatedAtISO: nowISO,
      lifecycle
    };
  });
  localStorage.setItem(LOCAL_QUOTES_KEY, JSON.stringify(next));
  return { ok: true, storage: "local" };
}

export async function deleteQuote(id) {
  const quoteId = String(id || "").trim();
  if (!quoteId) {
    throw new Error("Quote id is required.");
  }

  const quote = await readQuoteById(quoteId);
  const nowISO = isoNow();
  const lifecycle = lifecycleObject("deleted", nowISO, quote.lifecycle);

  await saveQuoteVersion(quoteId);

  if (firebaseReady) {
    await updateDoc(quoteWriteDocRef(quoteId, quote.organizationId, "deleteQuote"), {
      status: "deleted",
      deletedAtISO: nowISO,
      updatedAtISO: nowISO,
      lifecycle
    });
    await syncPortalSnapshotFromQuoteDoc(quoteId, quote.organizationId);
    return { ok: true, storage: "firebase" };
  }

  const existing = JSON.parse(localStorage.getItem(LOCAL_QUOTES_KEY) || "[]");
  const next = existing.map((item) => {
    if (item.id !== quoteId) return item;
    return {
      ...item,
      status: "deleted",
      deletedAtISO: nowISO,
      updatedAtISO: nowISO,
      lifecycle
    };
  });
  localStorage.setItem(LOCAL_QUOTES_KEY, JSON.stringify(next));
  return { ok: true, storage: "local" };
}

export async function getPortalQuote(portalKey) {
  const key = String(portalKey || "").trim();
  if (!key) {
    throw new Error("Portal key is required.");
  }
  const nowISO = isoNow();

  if (firebaseReady) {
    const snap = await getDoc(portalDocRef(key));
    if (!snap.exists()) {
      throw new Error("Quote not found.");
    }
    const portalData = snap.data();
    if (String(portalData.portalKey || "").trim() !== key) {
      throw new Error(PORTAL_TOKEN_EXPIRED_ERROR);
    }
    const portalValidity = assertPortalTokenActive(portalData, nowISO);
    if (normalizeStatus(portalData.status) === "deleted") {
      throw new Error(PORTAL_TOKEN_EXPIRED_ERROR);
    }
    return {
      portalKey: key,
      ...portalData,
      ...portalValidity
    };
  }

  const existing = JSON.parse(localStorage.getItem(LOCAL_QUOTES_KEY) || "[]");
  const quote = existing.find((item) => item.portalKey === key);
  if (!quote) {
    throw new Error("Quote not found.");
  }
  const snapshot = buildPortalSnapshot(quote.id, quote);
  const portalValidity = assertPortalTokenActive(snapshot, nowISO);
  if (normalizeStatus(snapshot.status) === "deleted") {
    throw new Error(PORTAL_TOKEN_EXPIRED_ERROR);
  }
  return {
    ...snapshot,
    ...portalValidity
  };
}

export async function updatePortalQuoteStatus(portalKey, status) {
  const key = String(portalKey || "").trim();
  if (!key) {
    throw new Error("Portal key is required.");
  }

  const nextStatus = normalizeStatus(status);
  if (!["viewed", "accepted", "declined"].includes(nextStatus)) {
    throw new Error("Invalid portal status.");
  }

  const nowISO = isoNow();

  if (firebaseReady) {
    const portalRef = portalDocRef(key);
    const portalSnap = await getDoc(portalRef);
    if (!portalSnap.exists()) {
      throw new Error("Quote not found.");
    }
    const portalData = portalSnap.data();
    if (String(portalData.portalKey || "").trim() !== key) {
      throw new Error(PORTAL_TOKEN_EXPIRED_ERROR);
    }
    assertPortalTokenActive(portalData, nowISO);
    if (normalizeStatus(portalData.status) === "booked") {
      throw new Error("This quote is already booked and can no longer be changed from the portal.");
    }
    if (portalData.quoteId) {
      await saveQuoteVersion(portalData.quoteId);
    }
    const lifecycle = lifecycleObject(nextStatus, nowISO, portalData.lifecycle);
    await updateDoc(portalRef, {
      status: nextStatus,
      updatedAtISO: nowISO,
      lifecycle
    });

    if (portalData.quoteId) {
      await updateDoc(quoteWriteDocRef(portalData.quoteId, portalData.organizationId, "updatePortalQuoteStatus"), {
        status: nextStatus,
        updatedAtISO: nowISO,
        lifecycle
      });
    }
    return { ok: true, storage: "firebase" };
  }

  const existing = JSON.parse(localStorage.getItem(LOCAL_QUOTES_KEY) || "[]");
  const localTarget = existing.find((quote) => quote.portalKey === key);
  if (!localTarget) {
    throw new Error("Quote not found.");
  }
  assertPortalTokenActive(localTarget, nowISO);
  const locked = existing.find((quote) => quote.portalKey === key && normalizeStatus(quote.status) === "booked");
  if (locked) {
    throw new Error("This quote is already booked and can no longer be changed from the portal.");
  }
  if (localTarget?.id) {
    await saveQuoteVersion(localTarget.id);
  }
  const next = existing.map((quote) => {
    if (quote.portalKey !== key) return quote;
    return {
      ...quote,
      status: nextStatus,
      updatedAtISO: nowISO,
      lifecycle: lifecycleObject(nextStatus, nowISO, quote.lifecycle)
    };
  });
  localStorage.setItem(LOCAL_QUOTES_KEY, JSON.stringify(next));
  return { ok: true, storage: "local" };
}

export function buildQuoteEmailTemplate(quote) {
  const emailPayload = buildQuoteEmailPayload(quote);
  return {
    subject: emailPayload.subject,
    body: emailPayload.body
  };
}
