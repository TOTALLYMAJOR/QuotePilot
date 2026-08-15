import {
  collection,
  doc,
  documentId,
  getDoc,
  getDocs,
  limit,
  orderBy,
  query,
  startAfter,
  where
} from "firebase/firestore";
import { db, firebaseReady } from "./firebase";
import { getQuoteHistory, getQuoteVersionHistory, QUOTE_STATUSES } from "./quoteStore";
import { buildWorkflowAttentionSummary } from "./quoteWorkflow";
import { getFinalBalanceDisplayStatus } from "./statusSemantics";
import { getRevenueAutopilotCustomerControls } from "./revenueAutopilotClient";

const DEFAULT_PAGE_SIZE = 25;
const MAX_PAGE_SIZE = 100;
const CUSTOMER_WORKSPACE_QUOTE_LIMIT = 25;
const VERSION_LIMIT_PER_QUOTE = 10;
const DEFAULT_QUOTE_VALIDITY_DAYS = 30;
const EXPIRABLE_QUOTE_STATUSES = new Set(["draft", "sent", "viewed"]);

function text(value) {
  return String(value || "").trim();
}

function finiteNumberOrNull(value) {
  if (typeof value === "number") return Number.isFinite(value) ? value : null;
  if (typeof value !== "string" || !value.trim()) return null;
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : null;
}

function toIso(value) {
  if (!value) return "";
  if (typeof value?.toDate === "function") return value.toDate().toISOString();
  const parsed = new Date(value);
  return Number.isNaN(parsed.getTime()) ? "" : parsed.toISOString();
}

function localCalendarDate(value = new Date()) {
  const date = value instanceof Date ? value : new Date(value);
  if (Number.isNaN(date.getTime())) return "";
  const year = date.getFullYear();
  const month = String(date.getMonth() + 1).padStart(2, "0");
  const day = String(date.getDate()).padStart(2, "0");
  return `${year}-${month}-${day}`;
}

function addDaysIso(baseISO, days = DEFAULT_QUOTE_VALIDITY_DAYS) {
  const base = new Date(baseISO);
  base.setDate(base.getDate() + Math.max(1, Number(days || DEFAULT_QUOTE_VALIDITY_DAYS)));
  return base.toISOString();
}

function applyQuoteExpirySemantics(quote = {}, nowISO = new Date().toISOString()) {
  const parsedNow = new Date(nowISO);
  const effectiveNow = Number.isNaN(parsedNow.getTime()) ? new Date() : parsedNow;
  const effectiveNowISO = effectiveNow.toISOString();
  const rawStatus = text(quote.status).toLowerCase();
  const status = QUOTE_STATUSES.includes(rawStatus) ? rawStatus : "draft";
  const createdAtISO = toIso(quote.createdAtISO || quote.createdAt) || effectiveNowISO;
  const expiresAtISO = text(quote.expiresAtISO) || addDaysIso(createdAtISO);

  if (!EXPIRABLE_QUOTE_STATUSES.has(status)) {
    return { ...quote, status, createdAtISO, expiresAtISO };
  }

  const parsedExpiry = new Date(expiresAtISO);
  const effectiveExpiry = Number.isNaN(parsedExpiry.getTime()) ? effectiveNow : parsedExpiry;
  if (effectiveExpiry.getTime() >= effectiveNow.getTime()) {
    return { ...quote, status, createdAtISO, expiresAtISO };
  }

  return {
    ...quote,
    status: "expired",
    createdAtISO,
    expiresAtISO,
    lifecycle: {
      ...(quote.lifecycle || {}),
      expiredAtISO: quote.lifecycle?.expiredAtISO || effectiveNowISO
    }
  };
}

function normalizeQuoteRecord(id, data = {}) {
  return {
    id,
    ...data,
    createdAtISO: toIso(data.createdAtISO || data.createdAt),
    updatedAtISO: toIso(data.updatedAtISO || data.updatedAt)
  };
}

export function normalizeCustomerSearchKey(value) {
  return text(value).toLowerCase().replace(/\s+/g, " ");
}

export function encodeCustomerPathId(customerId) {
  const id = text(customerId);
  if (!id || id.includes("/")) throw new Error("A valid customerId is required.");
  return encodeURIComponent(id);
}

export function decodeCustomerPathId(encodedCustomerId) {
  try {
    const id = text(decodeURIComponent(String(encodedCustomerId || "")));
    if (!id || id.includes("/")) return "";
    return id;
  } catch {
    return "";
  }
}

function normalizePageSize(value) {
  const parsed = Number(value || DEFAULT_PAGE_SIZE);
  if (!Number.isFinite(parsed)) return DEFAULT_PAGE_SIZE;
  return Math.min(MAX_PAGE_SIZE, Math.max(1, Math.floor(parsed)));
}

export function normalizeRevenueAutopilotEmailControlsProjection(value, {
  organizationId = "",
  customerId = ""
} = {}) {
  if (!value || typeof value !== "object" || Array.isArray(value)) return null;
  if (
    Number(value.schemaVersion) !== 1
    || text(value.authority).toLowerCase() !== "server_projection"
    || text(value.source).toLowerCase() !== "firebase_server_projection"
  ) return null;
  const projectedOrganizationId = text(value.organizationId);
  const projectedCustomerId = text(value.customerId);
  if (
    !projectedOrganizationId
    || !projectedCustomerId
    || (text(organizationId) && projectedOrganizationId !== text(organizationId))
    || (text(customerId) && projectedCustomerId !== text(customerId))
  ) return null;
  const observedAtISO = toIso(value.observedAtISO);
  const authorityState = text(value.authorityState).toLowerCase();
  const revision = Number(value.revision);
  const consentState = text(value.consent?.state).toLowerCase();
  const subscriptionState = text(value.subscription?.state).toLowerCase();
  const consentRecordedAtISO = toIso(value.consent?.recordedAtISO);
  const subscriptionRecordedAtISO = toIso(value.subscription?.recordedAtISO);
  if (!observedAtISO || !Number.isSafeInteger(revision) || revision < 0) return null;
  if (authorityState === "dormant") {
    if (
      revision !== 0
      || consentState !== "unknown"
      || subscriptionState !== "unknown"
      || consentRecordedAtISO
      || subscriptionRecordedAtISO
    ) return null;
  } else if (authorityState === "configured") {
    if (
      revision < 1
      || !new Set(["granted", "revoked"]).has(consentState)
      || !new Set(["subscribed", "unsubscribed"]).has(subscriptionState)
      || (consentState === "revoked" && subscriptionState === "subscribed")
      || !consentRecordedAtISO
      || !subscriptionRecordedAtISO
    ) return null;
  } else {
    return null;
  }
  return Object.freeze({
    schemaVersion: 1,
    authority: "server_projection",
    source: "firebase_server_projection",
    organizationId: projectedOrganizationId,
    customerId: projectedCustomerId,
    observedAtISO,
    authorityState,
    revision,
    consent: Object.freeze({ state: consentState, recordedAtISO: consentRecordedAtISO }),
    subscription: Object.freeze({
      state: subscriptionState,
      recordedAtISO: subscriptionRecordedAtISO
    })
  });
}

function normalizeCustomerRecord(id, data = {}) {
  const customerId = text(data.customerId || id);
  const organizationId = text(data.organizationId);
  return {
    id,
    customerId,
    name: text(data.name),
    email: text(data.email).toLowerCase(),
    phone: text(data.phone),
    company: text(data.company || data.organization),
    nameKey: normalizeCustomerSearchKey(data.nameKey || data.name),
    emailKey: normalizeCustomerSearchKey(data.emailKey || data.email),
    lastQuoteId: text(data.lastQuoteId),
    lastQuoteNumber: text(data.lastQuoteNumber),
    lastEventName: text(data.lastEventName),
    lastEventDate: text(data.lastEventDate),
    createdAtISO: toIso(data.createdAtISO || data.createdAt),
    updatedAtISO: toIso(data.updatedAtISO || data.updatedAt),
    revenueAutopilotEmailControls: normalizeRevenueAutopilotEmailControlsProjection(
      data.revenueAutopilotEmailControls,
      { organizationId, customerId }
    )
  };
}

function compareCustomers(left, right) {
  return left.nameKey.localeCompare(right.nameKey)
    || left.emailKey.localeCompare(right.emailKey)
    || left.id.localeCompare(right.id);
}

function customerMatchesSearch(customer, searchKey) {
  if (!searchKey) return true;
  return customer.nameKey.startsWith(searchKey) || customer.emailKey.startsWith(searchKey);
}

function shouldUseLocalCustomerDirectoryFixture() {
  const env = import.meta.env || {};
  if (!env.DEV) return false;
  return ["1", "true", "yes", "on"].includes(String(env.VITE_E2E_BYPASS_AUTH || "").trim().toLowerCase());
}

function localCustomersFromQuotes(quotes = []) {
  const records = new Map();
  quotes.forEach((quote) => {
    const customerId = text(quote?.customerId);
    if (!customerId) return;
    const customer = quote.customer || {};
    const current = records.get(customerId);
    const next = normalizeCustomerRecord(customerId, {
      customerId,
      name: customer.name,
      email: customer.email,
      phone: customer.phone,
      company: customer.organization,
      lastQuoteId: quote.id,
      lastQuoteNumber: quote.quoteNumber,
      lastEventName: quote.event?.name,
      lastEventDate: quote.event?.date,
      updatedAtISO: quote.updatedAtISO || quote.createdAtISO
    });
    if (!current || next.updatedAtISO > current.updatedAtISO) records.set(customerId, next);
  });
  return [...records.values()].sort(compareCustomers);
}

export async function getCustomerDirectoryPage({
  organizationId = "",
  search = "",
  cursor = "",
  pageSize = DEFAULT_PAGE_SIZE
} = {}) {
  const orgId = text(organizationId);
  if (!orgId) throw new Error("organizationId is required for customer directory reads.");
  const normalizedSearch = normalizeCustomerSearchKey(search);
  const normalizedCursor = decodeCustomerPathId(cursor);
  const normalizedPageSize = normalizePageSize(pageSize);

  if (shouldUseLocalCustomerDirectoryFixture()) {
    const { getLocalCustomerDirectoryFixturePage } = await import("./localCustomerDirectoryFixture");
    return getLocalCustomerDirectoryFixturePage({
      organizationId: orgId,
      search: normalizedSearch,
      cursor: normalizedCursor,
      pageSize: normalizedPageSize
    });
  }

  if (!firebaseReady || !db) {
    const history = await getQuoteHistory({ organizationId: orgId });
    const tenantQuotes = history.quotes.filter((quote) => text(quote?.organizationId) === orgId);
    const customers = localCustomersFromQuotes(tenantQuotes)
      .filter((customer) => customerMatchesSearch(customer, normalizedSearch));
    const cursorIndex = normalizedCursor
      ? customers.findIndex((customer) => customer.id === normalizedCursor)
      : -1;
    const startIndex = cursorIndex >= 0 ? cursorIndex + 1 : 0;
    const page = customers.slice(startIndex, startIndex + normalizedPageSize + 1);
    const hasMore = page.length > normalizedPageSize;
    const items = page.slice(0, normalizedPageSize);
    return {
      source: "local",
      items,
      nextCursor: hasMore ? encodeCustomerPathId(items.at(-1)?.id) : ""
    };
  }

  const customersRef = collection(db, "organizations", orgId, "customers");
  const searchField = normalizedSearch.includes("@") ? "emailKey" : "nameKey";
  const constraints = [];
  if (normalizedSearch) {
    constraints.push(
      where(searchField, ">=", normalizedSearch),
      where(searchField, "<=", `${normalizedSearch}\uf8ff`)
    );
  }
  constraints.push(orderBy(searchField), orderBy(documentId()));
  if (normalizedCursor) {
    const cursorSnapshot = await getDoc(doc(customersRef, normalizedCursor));
    if (cursorSnapshot.exists()) constraints.push(startAfter(cursorSnapshot));
  }
  constraints.push(limit(normalizedPageSize + 1));
  const snapshot = await getDocs(query(customersRef, ...constraints));
  const page = snapshot.docs.map((entry) => normalizeCustomerRecord(entry.id, entry.data()));
  const hasMore = page.length > normalizedPageSize;
  const items = page.slice(0, normalizedPageSize);
  return {
    source: "firebase",
    items,
    nextCursor: hasMore ? encodeCustomerPathId(items.at(-1)?.id) : ""
  };
}

function paymentRowsForQuote(quote) {
  const rows = [];
  const depositStatus = text(quote?.payment?.depositStatus || "unpaid").toLowerCase();
  const depositAmount = finiteNumberOrNull(quote?.totals?.deposit);
  rows.push({
    quoteId: quote.id,
    quoteNumber: quote.quoteNumber,
    kind: "deposit",
    status: depositStatus,
    amount: depositAmount,
    evidenceAtISO: toIso(quote?.payment?.depositConfirmedAtISO)
  });
  const finalBalance = quote?.payment?.finalBalance || {};
  const finalStatus = getFinalBalanceDisplayStatus(finalBalance);
  const finalAmountCents = finiteNumberOrNull(finalBalance.amountCents);
  if (finalAmountCents !== null || finalStatus !== "unpaid") {
    rows.push({
      quoteId: quote.id,
      quoteNumber: quote.quoteNumber,
      kind: "final_balance",
      status: finalStatus,
      amount: finalAmountCents === null ? null : finalAmountCents / 100,
      evidenceAtISO: toIso(finalBalance.paidAtISO)
    });
  }
  return rows;
}

function lifecycleActivity(quotes = []) {
  const activity = [];
  const fields = [
    ["draftAtISO", "Quote drafted"],
    ["sentAtISO", "Proposal sent"],
    ["viewedAtISO", "Proposal viewed"],
    ["acceptedAtISO", "Proposal accepted"],
    ["bookedAtISO", "Event booked"],
    ["declinedAtISO", "Proposal declined"],
    ["expiredAtISO", "Quote expired"]
  ];
  quotes.forEach((quote) => {
    fields.forEach(([field, label]) => {
      const atISO = toIso(quote?.lifecycle?.[field] || quote?.[field]);
      if (atISO) activity.push({ quoteId: quote.id, quoteNumber: quote.quoteNumber, label, atISO });
    });
    const changeAtISO = toIso(quote?.portalDecision?.submittedAtISO);
    if (changeAtISO && quote?.portalDecision?.decision === "changes_requested") {
      activity.push({ quoteId: quote.id, quoteNumber: quote.quoteNumber, label: "Customer requested changes", atISO: changeAtISO });
    }
    const conversationAtISO = toIso(quote?.conversationSummary?.latestMessageAtISO);
    if (conversationAtISO) {
      const actorType = text(quote?.conversationSummary?.latestActorType).toLowerCase();
      activity.push({
        quoteId: quote.id,
        quoteNumber: quote.quoteNumber,
        label: actorType === "customer" ? "Customer sent a conversation message" : "Staff sent a conversation message",
        atISO: conversationAtISO
      });
    }
  });
  return activity.sort((left, right) => right.atISO.localeCompare(left.atISO)).slice(0, 25);
}

function nextSafeAction(attentionSummary, quotes) {
  const item = attentionSummary.items[0];
  if (item) {
    const label = item.type === "change_request"
      ? "Review the customer change request"
      : item.type === "follow_up"
        ? "Complete the due follow-up"
        : "Review the pending approval";
    return {
      kind: "workflow",
      label,
      quoteId: item.quoteId,
      attentionType: item.type,
      requestId: item.sourceRequestId || item.pendingRequests?.[0]?.id || ""
    };
  }
  const acceptedWithoutDeposit = quotes.find((quote) => (
    quote.status === "accepted"
    && ["", "unpaid"].includes(text(quote?.payment?.depositStatus).toLowerCase())
  ));
  if (acceptedWithoutDeposit) {
    return { kind: "quote", label: "Review deposit request eligibility", quoteId: acceptedWithoutDeposit.id };
  }
  return { kind: "none", label: "No immediate staff action" };
}

export function buildCustomerBriefing({
  quotes = [],
  activeQuotes = [],
  events = [],
  attention = {},
  recentActivity = [],
  nextAction = { kind: "none", label: "No immediate staff action" },
  quotePageInfo = { limit: CUSTOMER_WORKSPACE_QUOTE_LIMIT, truncated: false },
  nowISO = "",
  todayDate = ""
} = {}) {
  const explicitDate = text(todayDate);
  const sourceDate = text(nowISO).slice(0, 10);
  const today = /^\d{4}-\d{2}-\d{2}$/.test(explicitDate)
    ? explicitDate
    : /^\d{4}-\d{2}-\d{2}$/.test(sourceDate)
      ? sourceDate
      : localCalendarDate();
  const nextEvent = [...events]
    .filter((event) => /^\d{4}-\d{2}-\d{2}$/.test(text(event?.date)) && text(event.date) >= today)
    .sort((left, right) => (
      text(left.date).localeCompare(text(right.date))
      || text(left.time).localeCompare(text(right.time))
      || text(left.quoteId).localeCompare(text(right.quoteId))
    ))[0] || null;
  const latestActivity = recentActivity[0] || null;
  const itemCount = Number(attention?.itemCount);
  const limitValue = Number(quotePageInfo?.limit);

  return {
    activeQuoteCount: activeQuotes.length,
    displayedQuoteCount: quotes.length,
    attentionCount: Number.isFinite(itemCount) && itemCount >= 0 ? Math.floor(itemCount) : 0,
    nextEvent: nextEvent ? { ...nextEvent } : null,
    latestActivity: latestActivity ? { ...latestActivity } : null,
    nextAction: { ...nextAction },
    scope: {
      truncated: quotePageInfo?.truncated === true,
      limit: Number.isFinite(limitValue) && limitValue > 0
        ? Math.floor(limitValue)
        : CUSTOMER_WORKSPACE_QUOTE_LIMIT
    }
  };
}

export function buildStaffProposalPreview(quote = {}) {
  const quoteMeta = quote?.quoteMeta || {};
  const organizationName = text(quoteMeta.organizationName);
  return {
    quoteId: text(quote.id),
    quoteNumber: text(quote.quoteNumber),
    status: text(quote.status || "draft").toLowerCase(),
    customerName: text(quote?.customer?.name),
    eventName: text(quote?.event?.name),
    eventDate: text(quote?.event?.date),
    venue: text(quote?.event?.venue),
    guests: finiteNumberOrNull(quote?.event?.guests),
    subtotal: finiteNumberOrNull(quote?.totals?.subtotal),
    tax: finiteNumberOrNull(quote?.totals?.tax),
    total: finiteNumberOrNull(quote?.totals?.total),
    deposit: finiteNumberOrNull(quote?.totals?.deposit),
    branding: {
      organizationName,
      brandName: text(quoteMeta.brandName || organizationName),
      brandTagline: text(quoteMeta.brandTagline),
      brandLogoUrl: text(quoteMeta.brandLogoUrl),
      brandPrimaryColor: text(quoteMeta.brandPrimaryColor),
      brandAccentColor: text(quoteMeta.brandAccentColor),
      brandDarkAccentColor: text(quoteMeta.brandDarkAccentColor),
      brandBackgroundStart: text(quoteMeta.brandBackgroundStart),
      brandBackgroundMid: text(quoteMeta.brandBackgroundMid),
      brandBackgroundEnd: text(quoteMeta.brandBackgroundEnd),
      businessEmail: text(quoteMeta.businessEmail),
      businessPhone: text(quoteMeta.businessPhone),
      businessAddress: text(quoteMeta.businessAddress),
      brandCrew: Array.isArray(quoteMeta.brandCrew)
        ? quoteMeta.brandCrew.map((member) => ({ ...member }))
        : []
    },
    portalEvidenceChanged: false
  };
}

export function buildCustomerWorkspaceDto({
  customer,
  quotes = [],
  versionsByQuote = {},
  versionTruncatedQuoteIds = [],
  revenueAutopilotEmailControls = null,
  revenueAutopilotEmailControlsError = "",
  quotePageInfo = { limit: CUSTOMER_WORKSPACE_QUOTE_LIMIT, truncated: false },
  nowISO = new Date().toISOString(),
  todayDate = localCalendarDate()
} = {}) {
  const effectiveNowISO = toIso(nowISO) || new Date().toISOString();
  const normalizedCustomer = normalizeCustomerRecord(
    customer?.id || customer?.customerId,
    customer
  );
  const normalizedRevenueAutopilotEmailControls =
    normalizeRevenueAutopilotEmailControlsProjection(
      revenueAutopilotEmailControls,
      { customerId: normalizedCustomer.customerId }
    );
  const normalizedQuotes = quotes.map((quote) => (
    applyQuoteExpirySemantics(quote, effectiveNowISO)
  )).sort((left, right) => (
    text(right.updatedAtISO || right.createdAtISO).localeCompare(text(left.updatedAtISO || left.createdAtISO))
  ));
  const activeQuotes = normalizedQuotes.filter((quote) => !["deleted", "declined", "expired"].includes(text(quote.status).toLowerCase()));
  const attention = buildWorkflowAttentionSummary(normalizedQuotes, { now: effectiveNowISO });
  const events = normalizedQuotes
    .filter((quote) => ["accepted", "booked"].includes(text(quote.status).toLowerCase()))
    .map((quote) => ({
      quoteId: quote.id,
      quoteNumber: quote.quoteNumber,
      status: quote.status,
      eventName: quote?.event?.name || quote.quoteNumber,
      date: quote?.event?.date || "",
      time: quote?.event?.time || "",
      venue: quote?.event?.venue || "",
      guests: finiteNumberOrNull(quote?.event?.guests),
      contractNumber: text(quote?.booking?.contractNumber),
      beoAvailable: text(quote.status).toLowerCase() === "booked"
    }))
    .sort((left, right) => text(left.date).localeCompare(text(right.date)));
  const versions = normalizedQuotes.flatMap((quote) => (
    (versionsByQuote[quote.id] || []).map((version) => ({
      ...version,
      quoteId: quote.id,
      quoteNumber: quote.quoteNumber
    }))
  ));
  const money = normalizedQuotes.flatMap(paymentRowsForQuote);
  const conversations = normalizedQuotes.map((quote) => {
    const summary = quote?.conversationSummary && typeof quote.conversationSummary === "object"
      ? quote.conversationSummary
      : null;
    const messageCount = Number(summary?.messageCount);
    return {
      quoteId: quote.id,
      quoteNumber: quote.quoteNumber,
      status: quote.status,
      summaryAvailable: Boolean(summary && Number.isFinite(messageCount) && messageCount >= 0),
      messageCount: Number.isFinite(messageCount) && messageCount >= 0 ? Math.floor(messageCount) : null,
      latestMessageAtISO: toIso(summary?.latestMessageAtISO),
      latestActorType: ["staff", "customer"].includes(text(summary?.latestActorType).toLowerCase())
        ? text(summary.latestActorType).toLowerCase()
        : ""
    };
  });
  const recentActivity = lifecycleActivity(normalizedQuotes);
  const resolvedNextAction = nextSafeAction(attention, normalizedQuotes);
  const resolvedQuotePageInfo = {
    limit: Number(quotePageInfo.limit || CUSTOMER_WORKSPACE_QUOTE_LIMIT),
    truncated: quotePageInfo.truncated === true
  };

  return {
    customer: {
      ...normalizedCustomer,
      revenueAutopilotEmailControls: normalizedRevenueAutopilotEmailControls
        ? { ...normalizedRevenueAutopilotEmailControls }
        : null,
      revenueAutopilotEmailControlsError: text(revenueAutopilotEmailControlsError)
    },
    quotes: normalizedQuotes,
    activeQuotes,
    proposalVersions: versions,
    events,
    money,
    conversations,
    recentActivity,
    attention,
    nextAction: resolvedNextAction,
    briefing: buildCustomerBriefing({
      quotes: normalizedQuotes,
      activeQuotes,
      events,
      attention,
      recentActivity,
      nextAction: resolvedNextAction,
      quotePageInfo: resolvedQuotePageInfo,
      nowISO: effectiveNowISO,
      todayDate
    }),
    quotePageInfo: resolvedQuotePageInfo,
    versionPageInfo: {
      perQuoteLimit: VERSION_LIMIT_PER_QUOTE,
      truncatedQuoteIds: [...new Set(versionTruncatedQuoteIds.map(text).filter(Boolean))]
    }
  };
}

async function loadQuoteVersions(orgId, quoteId) {
  const versionsRef = collection(db, "organizations", orgId, "quotes", quoteId, "versions");
  const snapshot = await getDocs(query(
    versionsRef,
    orderBy("createdAtISO", "desc"),
    limit(VERSION_LIMIT_PER_QUOTE + 1)
  ));
  return {
    items: snapshot.docs.slice(0, VERSION_LIMIT_PER_QUOTE).map((entry) => ({
      id: entry.id,
      ...entry.data(),
      createdAtISO: toIso(entry.data().createdAtISO || entry.data().createdAt)
    })),
    truncated: snapshot.size > VERSION_LIMIT_PER_QUOTE
  };
}

export async function getCustomerWorkspace({ organizationId = "", customerId = "" } = {}) {
  const orgId = text(organizationId);
  const id = text(customerId);
  if (!orgId || !id) throw new Error("organizationId and customerId are required for Customer 360.");

  if (shouldUseLocalCustomerDirectoryFixture()) {
    const { getLocalCustomerWorkspaceFixture } = await import("./localCustomerDirectoryFixture");
    const fixture = getLocalCustomerWorkspaceFixture({ organizationId: orgId, customerId: id });
    if (!fixture) return null;
    return {
      source: fixture.source,
      organizationId: orgId,
      ...buildCustomerWorkspaceDto({
        customer: fixture.customer,
        quotes: fixture.quotes,
        versionsByQuote: fixture.versionsByQuote,
        revenueAutopilotEmailControls: null,
        revenueAutopilotEmailControlsError: "Customer email controls are unavailable in local review data.",
        quotePageInfo: fixture.quotePageInfo,
        nowISO: "2026-08-15T17:00:00.000Z",
        todayDate: "2026-08-15"
      })
    };
  }

  if (!firebaseReady || !db) {
    const history = await getQuoteHistory({ organizationId: orgId });
    const matchingQuotes = history.quotes.filter((quote) => (
      text(quote?.organizationId) === orgId
      && text(quote?.customerId) === id
    ));
    const quotes = matchingQuotes.slice(0, CUSTOMER_WORKSPACE_QUOTE_LIMIT);
    const customer = localCustomersFromQuotes(quotes).find((entry) => entry.id === id);
    if (!customer) return null;
    const versionResults = await Promise.all(quotes.map(async (quote) => {
      const result = await getQuoteVersionHistory(quote.id, { organizationId: orgId });
      const scopedVersions = result.versions.filter((version) => (
        text(version?.organizationId) === orgId
      ));
      return [quote.id, {
        items: scopedVersions.slice(0, VERSION_LIMIT_PER_QUOTE).map((version) => ({
          ...version,
          createdAtISO: toIso(version.createdAtISO || version.createdAt || version.timestamp)
        })),
        truncated: scopedVersions.length > VERSION_LIMIT_PER_QUOTE
      }];
    }));
    const versionsByQuote = Object.fromEntries(versionResults.map(([quoteId, result]) => (
      [quoteId, result.items]
    )));
    const versionTruncatedQuoteIds = versionResults
      .filter(([, result]) => result.truncated)
      .map(([quoteId]) => quoteId);
    return {
      source: "local",
      ...buildCustomerWorkspaceDto({
        customer,
        quotes,
        versionsByQuote,
        versionTruncatedQuoteIds,
        revenueAutopilotEmailControls: null,
        revenueAutopilotEmailControlsError: "Customer email controls require a connected workspace.",
        quotePageInfo: {
          limit: CUSTOMER_WORKSPACE_QUOTE_LIMIT,
          truncated: matchingQuotes.length > CUSTOMER_WORKSPACE_QUOTE_LIMIT
        }
      })
    };
  }

  const customerSnapshot = await getDoc(doc(db, "organizations", orgId, "customers", id));
  if (!customerSnapshot.exists()) return null;
  const quoteSnapshot = await getDocs(query(
    collection(db, "organizations", orgId, "quotes"),
    where("customerId", "==", id),
    orderBy("createdAt", "desc"),
    limit(CUSTOMER_WORKSPACE_QUOTE_LIMIT + 1)
  ));
  const quoteDocuments = quoteSnapshot.docs.slice(0, CUSTOMER_WORKSPACE_QUOTE_LIMIT);
  const quotes = quoteDocuments.map((entry) => normalizeQuoteRecord(entry.id, entry.data()));
  const versionResults = await Promise.all(quotes.map(async (quote) => (
    [quote.id, await loadQuoteVersions(orgId, quote.id)]
  )));
  const versionsByQuote = Object.fromEntries(versionResults.map(([quoteId, result]) => (
    [quoteId, result.items]
  )));
  const versionTruncatedQuoteIds = versionResults
    .filter(([, result]) => result.truncated)
    .map(([quoteId]) => quoteId);
  let revenueAutopilotEmailControls = null;
  let revenueAutopilotEmailControlsError = "";
  try {
    revenueAutopilotEmailControls = await getRevenueAutopilotCustomerControls({
      organizationId: orgId,
      customerId: id
    });
  } catch {
    // Customer 360 remains available, but the independently private controls
    // surface must fail closed and expose no inferred current state.
    revenueAutopilotEmailControls = null;
    revenueAutopilotEmailControlsError = "Current customer email controls could not be loaded.";
  }
  return {
    source: "firebase",
    ...buildCustomerWorkspaceDto({
      customer: { id: customerSnapshot.id, ...customerSnapshot.data() },
      quotes,
      versionsByQuote,
      versionTruncatedQuoteIds,
      revenueAutopilotEmailControls,
      revenueAutopilotEmailControlsError,
      quotePageInfo: {
        limit: CUSTOMER_WORKSPACE_QUOTE_LIMIT,
        truncated: quoteSnapshot.size > CUSTOMER_WORKSPACE_QUOTE_LIMIT
      }
    })
  };
}
