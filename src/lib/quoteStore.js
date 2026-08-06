import {
  collection,
  deleteDoc,
  doc,
  getDoc,
  getDocs,
  orderBy,
  query,
  runTransaction,
  setDoc,
  updateDoc,
  writeBatch,
  where
} from "firebase/firestore";
import { httpsCallable } from "firebase/functions";
import { auth, cloudFunctions, db, firebaseReady } from "./firebase";
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
import { resolveCrmProvider } from "./crmAdapters";
import { buildQuoteEmailPayload } from "./proposalPayload";
import {
  APPROVAL_ACTION_IDS,
  APPROVAL_STATES,
  FOLLOW_UP_STAGE_IDS,
  getApprovalActionEligibility,
  PRODUCTION_CHECKLIST_IDS
} from "./quoteWorkflow";

const LOCAL_QUOTES_KEY = "quoteWizard.quotes";
const LOCAL_QUOTE_HISTORY_KEY = "quoteWizard.quoteHistory";
const QUOTES_COLLECTION = "quotes";
const PORTAL_COLLECTION = "customerPortalQuotes";
const QUOTE_HISTORY_COLLECTION = "quoteHistory";
const QUOTE_VERSIONS_COLLECTION = "versions";
const DEFAULT_VALIDITY_DAYS = 30;
const PORTAL_TOKEN_VALIDITY_DAYS = 30;
const PORTAL_TOKEN_EXPIRED_ERROR = "Quote link is invalid or expired.";
const PORTAL_VISIBLE_STATUSES = new Set(["sent", "viewed", "accepted", "declined", "booked"]);
const QUOTE_DELIVERY_MUTATION_LOCK_STATES = new Set([
  "sending",
  "outcome_ambiguous",
  "outcome_unknown"
]);
const HARD_DELETE_QUOTE_CALLABLE = "hardDeleteQuote";
const UPDATE_QUOTE_DRAFT_CALLABLE = "updateQuoteDraft";
const REQUEST_QUOTE_APPROVAL_CALLABLE = "requestQuoteApproval";
const RESOLVE_QUOTE_APPROVAL_CALLABLE = "resolveQuoteApprovalRequest";
const CONVERT_QUOTE_TO_CONTRACT_CALLABLE = "convertQuoteToContract";
const SERVER_SCOPED_PAYMENT_APPROVAL_ACTIONS = new Set([
  "send_payment_request",
  "send_final_balance_request"
]);
const ACCEPT_QUOTE_PROPOSAL_CALLABLE = "acceptQuoteProposal";
export const PROPOSAL_ACCEPTANCE_CONSENT_VERSION = "proposal-acceptance-v1";
const EXPIRABLE_STATUSES = new Set(["draft", "sent", "viewed"]);
const AVAILABILITY_CONFLICT_STATUSES = new Set(["accepted", "booked"]);
const PAYMENT_STATUSES = ["unpaid", "sent", "paid", "refunded"];
const FINAL_BALANCE_STATUSES = new Set([
  "unpaid",
  "sent",
  "paid"
]);
const FINAL_BALANCE_CHECKOUT_STATES = new Set([
  "",
  "prepared",
  "open",
  "processing",
  "paid",
  "failed",
  "expired"
]);
const BOOKING_CONFIRMATION_STATUSES = ["pending", "sent", "confirmed", "cancelled"];
const INTEGRATION_PROVIDER_SET = new Set(["crm", "webhook", "webhook_bridge", "hubspot", "salesforce"]);
const INTEGRATION_STATE_SET = new Set(["queued", "success", "error", "retrying", "skipped"]);
const MAX_DIETARY_RESTRICTIONS_LENGTH = 1200;
const MAX_RATE_MIX_CSV_LENGTH = 300;
const MAX_FOLLOW_UP_NOTE_LENGTH = 1200;
const MAX_APPROVAL_NOTE_LENGTH = 800;
const MAX_PORTAL_DECISION_MESSAGE_LENGTH = 1200;
const WORKFLOW_ATTENTION_STATUSES = [
  "draft",
  "sent",
  "viewed",
  "accepted"
];
const MAX_CHANGE_REQUEST_HANDLING_NOTE_LENGTH = 800;
const KITCHEN_CHECKPOINT_DEFS = [
  { id: "prep-start", label: "Prep kickoff", minuteOffset: -180 },
  { id: "line-check", label: "Line check", minuteOffset: -120 },
  { id: "pack-out", label: "Pack and load-out", minuteOffset: -60 },
  { id: "onsite-setup", label: "On-site setup", minuteOffset: -30 },
  { id: "service-start", label: "Service start", minuteOffset: 0 },
  { id: "service-end", label: "Service wrap", minuteOffset: 300 },
  { id: "reset", label: "Kitchen reset", minuteOffset: 345 }
];
const KITCHEN_CHECKPOINT_IDS = new Set(KITCHEN_CHECKPOINT_DEFS.map((item) => item.id));
const KITCHEN_CHECKPOINT_BY_ID = new Map(KITCHEN_CHECKPOINT_DEFS.map((item) => [item.id, item]));
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
  accepted: ["accepted", "booked", "deleted"],
  booked: ["booked", "deleted"],
  declined: ["declined", "deleted"],
  expired: ["expired", "draft", "sent", "deleted"],
  deleted: ["deleted", "draft"]
};

export const QUOTE_STATUSES = Object.keys(STATUS_FLOW);
export { BOOKING_CONFIRMATION_STATUSES };

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

function ensureCallableReady(action = "quote callable") {
  if (!cloudFunctions) {
    throw new Error(`Cloud Functions unavailable for ${action}.`);
  }
}

function isMissingCallableError(error) {
  const code = String(error?.code || "").trim().toLowerCase();
  return code === "functions/not-found" || code === "not-found";
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

function requireMenuSelection(form) {
  const selectedMenuItems = Array.isArray(form?.menuItems)
    ? form.menuItems.map((item) => String(item || "").trim()).filter(Boolean)
    : [];
  if (selectedMenuItems.length < 1) {
    throw new Error("Select at least one menu item before saving the quote.");
  }
  return selectedMenuItems;
}

function quoteHasMenuSelection(quote) {
  const selection = quote?.selection && typeof quote.selection === "object"
    ? quote.selection
    : {};
  return [
    selection.menuItems,
    selection.menuItemsSnapshot,
    selection.menuItemNames,
    selection.menuItemDetails
  ].some((items) => (
    Array.isArray(items)
    && items.some((item) => String(
      typeof item === "object" ? item?.id || item?.name || "" : item || ""
    ).trim())
  ));
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

function sanitizeDietaryRestrictions(value) {
  return String(value ?? "")
    .replace(/\r\n/g, "\n")
    .trim()
    .slice(0, MAX_DIETARY_RESTRICTIONS_LENGTH);
}

function sanitizeRateMixCsv(value) {
  return String(value ?? "")
    .replace(/\r\n/g, " ")
    .trim()
    .slice(0, MAX_RATE_MIX_CSV_LENGTH);
}

function sanitizeServerRateMixCsv(value) {
  return sanitizeRateMixCsv(value);
}

function sanitizeChefRateMixCsv(value) {
  return sanitizeRateMixCsv(value);
}

function normalizeRateArray(input) {
  if (!Array.isArray(input)) return [];
  return input
    .map((value) => Math.round(toNumber(value, 0) * 100) / 100)
    .filter((value) => Number.isFinite(value) && value >= 0);
}

function sanitizeCheckpointLabel(value, fallback = "") {
  const text = String(value ?? "").trim();
  const safe = text || fallback;
  return safe.slice(0, 80);
}

function normalizeKitchenCheckpoints(input) {
  if (!Array.isArray(input)) return [];
  const byId = new Map();

  input.forEach((item) => {
    const id = String(item?.id || "").trim();
    if (!id || !KITCHEN_CHECKPOINT_IDS.has(id) || byId.has(id)) return;
    const fallback = KITCHEN_CHECKPOINT_BY_ID.get(id) || { label: id, minuteOffset: 0 };
    byId.set(id, {
      id,
      label: sanitizeCheckpointLabel(item?.label, fallback.label),
      minuteOffset: Math.max(-1440, Math.min(2880, Math.round(toNumber(item?.minuteOffset, fallback.minuteOffset))))
    });
  });

  if (!byId.size) return [];

  return KITCHEN_CHECKPOINT_DEFS.map((item) => byId.get(item.id)).filter(Boolean);
}

function normalizeProductionChecklist(input) {
  if (!Array.isArray(input)) return [];
  const byId = new Map();
  input.forEach((item) => {
    const id = String(item?.id || "").trim();
    if (!id || !PRODUCTION_CHECKLIST_IDS.includes(id) || byId.has(id)) return;
    byId.set(id, {
      id,
      completed: item?.completed === true,
      completedAtISO: item?.completed === true ? String(item?.completedAtISO || "").trim() : "",
      completedByEmail: item?.completed === true ? normalizeEmail(item?.completedByEmail) : ""
    });
  });
  return PRODUCTION_CHECKLIST_IDS.map((id) => byId.get(id)).filter(Boolean);
}

function normalizeFollowUp(input) {
  const source = input && typeof input === "object" ? input : {};
  const stage = FOLLOW_UP_STAGE_IDS.includes(source.stage) ? source.stage : "new";
  const dueDate = /^\d{4}-\d{2}-\d{2}$/.test(String(source.dueDate || "").trim())
    ? String(source.dueDate).trim()
    : "";
  const completed = source.completed === true;
  return {
    stage,
    dueDate,
    note: String(source.note || "").trim().slice(0, MAX_FOLLOW_UP_NOTE_LENGTH),
    completed,
    completedAtISO: completed ? String(source.completedAtISO || "").trim() : "",
    updatedAtISO: String(source.updatedAtISO || "").trim(),
    updatedByEmail: normalizeEmail(source.updatedByEmail)
  };
}

function normalizePaymentApprovalScope(input) {
  const source = input && typeof input === "object" && !Array.isArray(input)
    ? input
    : null;
  if (!source) return null;
  const amountCents = Number(source.amountCents);
  const scope = {
    version: Number(source.version),
    kind: String(source.kind || "").trim(),
    organizationId: normalizeOrganizationId(source.organizationId),
    quoteId: String(source.quoteId || "").trim(),
    quoteRevisionId: String(source.quoteRevisionId || "").trim(),
    portalKey: String(source.portalKey || "").trim(),
    portalIssuedAtISO: String(source.portalIssuedAtISO || "").trim(),
    portalExpiresAtISO: String(source.portalExpiresAtISO || "").trim(),
    customerEmail: normalizeEmail(source.customerEmail),
    paymentKind: String(source.paymentKind || "").trim().toLowerCase(),
    currency: String(source.currency || "").trim().toLowerCase(),
    amountCents: Number.isSafeInteger(amountCents) ? amountCents : 0
  };
  const isDepositScope = scope.kind === "stripe_checkout_deposit_request";
  const isFinalBalanceScope = scope.kind === "stripe_checkout_final_balance_request";
  if (
    scope.version !== 1
    || (!isDepositScope && !isFinalBalanceScope)
    || !scope.organizationId
    || !scope.quoteId
    || !scope.quoteRevisionId
    || scope.portalKey.length < 20
    || !scope.portalIssuedAtISO
    || !scope.portalExpiresAtISO
    || !scope.customerEmail
    || !/^[a-z]{3}$/.test(scope.currency)
    || scope.amountCents <= 0
  ) {
    return null;
  }
  if (isDepositScope) {
    return scope.paymentKind === "deposit" ? scope : null;
  }
  const depositAmountCents = Number(source.depositAmountCents);
  const checkoutGeneration = Number(source.checkoutGeneration);
  const finalBalanceScope = {
    ...scope,
    depositStatus: String(source.depositStatus || "").trim().toLowerCase(),
    depositAmountCents: Number.isSafeInteger(depositAmountCents) ? depositAmountCents : 0,
    depositStripeSessionId: String(source.depositStripeSessionId || "").trim(),
    depositConfirmedAtISO: String(source.depositConfirmedAtISO || "").trim(),
    contractNumber: String(source.contractNumber || "").trim(),
    contractConvertedAtISO: String(source.contractConvertedAtISO || "").trim(),
    checkoutGeneration: Number.isSafeInteger(checkoutGeneration) ? checkoutGeneration : 0
  };
  if (
    finalBalanceScope.paymentKind !== "final_balance"
    || finalBalanceScope.depositStatus !== "paid"
    || finalBalanceScope.depositAmountCents <= 0
    || !/^cs_[A-Za-z0-9_]+$/.test(finalBalanceScope.depositStripeSessionId)
    || !finalBalanceScope.depositConfirmedAtISO
    || !finalBalanceScope.contractNumber
    || !finalBalanceScope.contractConvertedAtISO
    || finalBalanceScope.checkoutGeneration <= 0
  ) {
    return null;
  }
  return finalBalanceScope;
}

function normalizeApprovalRequests(input) {
  if (!Array.isArray(input)) return [];
  const seen = new Set();
  return input
    .map((item) => {
      const id = String(item?.id || "").trim();
      const action = String(item?.action || "").trim();
      const state = String(item?.state || "pending").trim().toLowerCase();
      if (!id || seen.has(id) || !APPROVAL_ACTION_IDS.includes(action) || !APPROVAL_STATES.includes(state)) {
        return null;
      }
      seen.add(id);
      const actionScope = SERVER_SCOPED_PAYMENT_APPROVAL_ACTIONS.has(action)
        ? normalizePaymentApprovalScope(item?.actionScope)
        : null;
      const actionScopeDigest = String(item?.actionScopeDigest || "").trim().toLowerCase();
      return {
        id,
        action,
        state,
        note: String(item?.note || "").trim().slice(0, MAX_APPROVAL_NOTE_LENGTH),
        requestedAtISO: String(item?.requestedAtISO || "").trim(),
        requestedByEmail: normalizeEmail(item?.requestedByEmail),
        resolvedAtISO: state === "pending" ? "" : String(item?.resolvedAtISO || "").trim(),
        resolvedByEmail: state === "pending" ? "" : normalizeEmail(item?.resolvedByEmail),
        resolutionNote: state === "pending"
          ? ""
          : String(item?.resolutionNote || "").trim().slice(0, MAX_APPROVAL_NOTE_LENGTH),
        ...(actionScope && /^[a-f0-9]{64}$/.test(actionScopeDigest)
          ? { actionScope, actionScopeDigest }
          : {}),
        executionState: ["awaiting_execution", "in_progress", "succeeded", "failed"].includes(
          String(item?.executionState || "").trim().toLowerCase()
        )
          ? String(item.executionState).trim().toLowerCase()
          : "",
        executionStartedAtISO: String(item?.executionStartedAtISO || "").trim(),
        executionCompletedAtISO: String(item?.executionCompletedAtISO || "").trim(),
        executedByEmail: normalizeEmail(item?.executedByEmail),
        executionOperationId: String(item?.executionOperationId || "").trim(),
        executionReference: String(item?.executionReference || "").trim().slice(0, 500),
        executionError: String(item?.executionError || "").trim().slice(0, 500)
      };
    })
    .filter(Boolean)
    .slice(-50);
}

function completeLocalApprovalExecution({
  workflow = {},
  approvalRequestId = "",
  action = "",
  actorEmail = "",
  completedAtISO = "",
  reference = ""
} = {}) {
  const requestId = String(approvalRequestId || "").trim();
  if (!requestId) {
    return { workflow, request: null };
  }
  const requests = normalizeApprovalRequests(workflow?.approvalRequests);
  const target = requests.find((request) => request.id === requestId);
  if (
    !target
    || target.action !== action
    || target.state !== "approved"
    || !["", "awaiting_execution"].includes(target.executionState)
  ) {
    throw new Error("The selected approval no longer authorizes this action.");
  }
  const request = {
    ...target,
    executionState: "succeeded",
    executionStartedAtISO: completedAtISO,
    executionCompletedAtISO: completedAtISO,
    executedByEmail: normalizeEmail(actorEmail),
    executionOperationId: requestId,
    executionReference: String(reference || "").trim().slice(0, 500),
    executionError: ""
  };
  return {
    request,
    workflow: {
      ...(workflow || {}),
      approvalRequests: requests.map((item) => (item.id === requestId ? request : item))
    }
  };
}

function normalizePortalDecision(input) {
  const source = input && typeof input === "object" ? input : {};
  const decision = ["accepted", "declined", "changes_requested"].includes(source.decision)
    ? source.decision
    : "";
  if (!decision) return {};
  const normalized = {
    decision,
    message: String(source.message || "").trim().slice(0, MAX_PORTAL_DECISION_MESSAGE_LENGTH),
    submittedAtISO: String(source.submittedAtISO || "").trim()
  };
  const requestId = String(source.requestId || "").trim();
  if (requestId) normalized.requestId = requestId;
  return normalized;
}

function normalizeChangeRequestHandling(input) {
  const source = input && typeof input === "object" ? input : {};
  const state = ["acknowledged", "handled"].includes(source.state) ? source.state : "";
  const sourceRequestId = String(source.sourceRequestId || "");
  const sourceSubmittedAtISO = String(source.sourceSubmittedAtISO || "");
  if (!state || !sourceSubmittedAtISO.trim()) return {};
  return {
    sourceRequestId,
    sourceSubmittedAtISO,
    sourceMessage: String(source.sourceMessage || ""),
    state,
    acknowledgedAtISO: String(source.acknowledgedAtISO || "").trim(),
    acknowledgedByEmail: normalizeEmail(source.acknowledgedByEmail),
    handledAtISO: state === "handled"
      ? String(source.handledAtISO || "").trim()
      : "",
    handledByEmail: state === "handled" ? normalizeEmail(source.handledByEmail) : "",
    note: state === "handled"
      ? String(source.note || "").trim().slice(0, MAX_CHANGE_REQUEST_HANDLING_NOTE_LENGTH)
      : ""
  };
}

function hasTerminalDecisionEvidence(quote = {}) {
  const source = quote && typeof quote === "object" ? quote : {};
  const status = String(source.status || "").trim().toLowerCase();
  const decision = String(source.portalDecision?.decision || "").trim().toLowerCase();
  const lifecycle = source.lifecycle && typeof source.lifecycle === "object" ? source.lifecycle : {};
  const booking = source.booking && typeof source.booking === "object" ? source.booking : {};
  const payment = source.payment && typeof source.payment === "object" ? source.payment : {};
  return (
    ["accepted", "declined", "booked"].includes(status)
    || ["accepted", "declined"].includes(decision)
    || Boolean(String(lifecycle.acceptedAtISO || "").trim())
    || Boolean(String(lifecycle.declinedAtISO || "").trim())
    || Boolean(String(lifecycle.bookedAtISO || "").trim())
    || Boolean(String(booking.bookedAtISO || "").trim())
    || Boolean(String(booking.contractNumber || "").trim())
    || Boolean(String(booking.contractConvertedAtISO || "").trim())
    || ["paid", "refunded"].includes(String(payment.depositStatus || "").trim().toLowerCase())
    || Boolean(String(payment.depositConfirmedAtISO || "").trim())
  );
}

function hasUnresolvedQuoteDelivery(quote = {}) {
  const state = String(quote?.workflow?.quoteDelivery?.state || "").trim().toLowerCase();
  return QUOTE_DELIVERY_MUTATION_LOCK_STATES.has(state);
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
  const timestampPart = Date.now().toString(36).padStart(10, "0");
  const randomPart = Math.floor(Math.random() * Number.MAX_SAFE_INTEGER)
    .toString(36)
    .padStart(11, "0");
  return `${timestampPart}${randomPart}`;
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
  const portalBooking = hydrateBooking(quote.booking);
  const quoteDelivery = quote?.workflow?.quoteDelivery || {};
  const deliveryRevisionId = String(
    quoteDelivery.revisionId
      || quote.activeVersionId
      || quote.versionMeta?.versionId
      || `local@${quote.updatedAtISO || createdAtISO}`
  ).trim();
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
    eventTime: quote.event?.time || "",
    eventHours: Number(quote.event?.hours || 0),
    eventGuests: Number(quote.event?.guests || 0),
    eventStyle: quote.event?.style || "",
    venue: quote.event?.venue || "",
    venueAddress: quote.event?.venueAddress || "",
    dietaryRestrictions: quote.event?.dietaryRestrictions || "",
    total: Number(quote.totals?.total || 0),
    deposit: Number(quote.totals?.deposit || 0),
    totals: {
      base: Number(quote.totals?.base || 0),
      addons: Number(quote.totals?.addons || 0),
      rentals: Number(quote.totals?.rentals || 0),
      menu: Number(quote.totals?.menu || 0),
      labor: Number(quote.totals?.labor || 0),
      travel: Number(quote.totals?.travel || 0),
      serviceFee: Number(quote.totals?.serviceFee || 0),
      ...(Object.prototype.hasOwnProperty.call(quote.totals || {}, "serviceFeePctApplied")
        ? { serviceFeePctApplied: Number(quote.totals.serviceFeePctApplied || 0) }
        : {}),
      tax: Number(quote.totals?.tax || 0),
      total: Number(quote.totals?.total || 0),
      deposit: Number(quote.totals?.deposit || 0)
    },
    selection: {
      packageName: quote.selection?.packageName || "",
      addons: (Array.isArray(quote.selection?.addonSnapshots) ? quote.selection.addonSnapshots : [])
        .map((item) => String(item?.name || "").trim())
        .filter(Boolean),
      rentals: (Array.isArray(quote.selection?.rentalSnapshots) ? quote.selection.rentalSnapshots : [])
        .map((item) => String(item?.name || "").trim())
        .filter(Boolean),
      menuItems: (Array.isArray(quote.selection?.menuItemNames) ? quote.selection.menuItemNames : [])
        .map((item) => String(item || "").trim())
        .filter(Boolean)
    },
    quoteMeta: {
      organizationName: quote.quoteMeta?.organizationName || "",
      brandName: quote.quoteMeta?.brandName || "",
      brandLogoUrl: quote.quoteMeta?.brandLogoUrl || "",
      brandPrimaryColor: quote.quoteMeta?.brandPrimaryColor || "",
      brandAccentColor: quote.quoteMeta?.brandAccentColor || "",
      brandDarkAccentColor: quote.quoteMeta?.brandDarkAccentColor || "",
      businessPhone: quote.quoteMeta?.businessPhone || "",
      businessEmail: quote.quoteMeta?.businessEmail || ""
    },
    status: normalizeStatus(quote.status),
    expiresAtISO: quote.expiresAtISO || addDaysISO(createdAtISO, DEFAULT_VALIDITY_DAYS),
    payment: hydratePayment(quote.payment, quote.totals),
    booking: {
      bookedAtISO: portalBooking.bookedAtISO,
      contractNumber: portalBooking.contractNumber,
      confirmationStatus: portalBooking.confirmationStatus,
      confirmationSentAtISO: portalBooking.confirmationSentAtISO,
      confirmedAtISO: portalBooking.confirmedAtISO
    },
    portalDecision: normalizePortalDecision(quote.portalDecision),
    acceptanceReceipt: quote.acceptanceReceipt && typeof quote.acceptanceReceipt === "object"
      ? { ...quote.acceptanceReceipt }
      : null,
    deliveryEvidence: {
      revisionId: deliveryRevisionId,
      state: String(quoteDelivery.state || "local").trim(),
      portalActivationState: String(quoteDelivery.portalActivationState || "active").trim(),
      portalKey: String(quoteDelivery.portalKey || quote.portalKey || "").trim(),
      portalIssuedAtISO: normalizeISO(quoteDelivery.portalIssuedAtISO || portalIssuedAtISO, portalIssuedAtISO),
      providerAcceptedAtISO: String(quoteDelivery.providerAcceptedAtISO || "").trim()
    },
    lifecycle: {
      ...(quote.lifecycle || {})
    },
    createdAtISO,
    updatedAtISO: quote.updatedAtISO || createdAtISO
  };
}

export function buildClientWritablePortalPayment() {
  return {};
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
  const portalSnapshot = buildPortalSnapshot(quoteId, {
    ...data,
    organizationId: writeOrganizationId,
    createdAtISO: timestampToISO(data.createdAtISO || data.createdAt)
  });
  delete portalSnapshot.payment;
  await setDoc(
    portalDocRef(portalKey),
    portalSnapshot,
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

function moneyToRoundedCents(value) {
  const amount = Number(value);
  if (!Number.isFinite(amount) || amount < 0) return 0;
  const cents = Math.round(amount * 100);
  return Number.isSafeInteger(cents) ? cents : 0;
}

function hydrateFinalBalance(finalBalance, totals = {}) {
  const source = finalBalance && typeof finalBalance === "object" && !Array.isArray(finalBalance)
    ? finalBalance
    : {};
  const explicitAmountCents = Number(source.amountCents);
  const derivedAmountCents = Math.max(
    0,
    moneyToRoundedCents(totals?.total) - moneyToRoundedCents(totals?.deposit)
  );
  const amountCents = Number.isSafeInteger(explicitAmountCents) && explicitAmountCents >= 0
    ? explicitAmountCents
    : derivedAmountCents;
  const paymentLink = String(source.paymentLink || "").trim();
  const rawStatus = String(source.status || "").trim().toLowerCase();
  const status = FINAL_BALANCE_STATUSES.has(rawStatus)
    ? rawStatus
    : paymentLink ? "sent" : "unpaid";
  const rawCheckoutState = String(source.stripeCheckoutState || "").trim().toLowerCase();
  const checkoutGeneration = Number(source.checkoutGeneration);
  const currency = String(source.currency || "usd").trim().toLowerCase();
  return {
    amountCents,
    currency: /^[a-z]{3}$/.test(currency) ? currency : "usd",
    status,
    paymentLink,
    confirmedAtISO: String(source.confirmedAtISO || "").trim(),
    stripeSessionId: String(source.stripeSessionId || "").trim(),
    stripeCheckoutState: FINAL_BALANCE_CHECKOUT_STATES.has(rawCheckoutState)
      ? rawCheckoutState
      : "",
    checkoutGeneration: Number.isSafeInteger(checkoutGeneration) && checkoutGeneration >= 0
      ? checkoutGeneration
      : 0,
    knownStripeSessionIds: Array.from(new Set(
      (Array.isArray(source.knownStripeSessionIds) ? source.knownStripeSessionIds : [])
        .map((value) => String(value || "").trim())
        .filter((value) => /^cs_[A-Za-z0-9_]+$/.test(value))
    )).slice(-20)
  };
}

function hydratePayment(payment, totals = {}) {
  const payload = payment || {};
  const depositLink = (payload.depositLink || "").trim();
  const defaultStatus = depositLink ? "sent" : "unpaid";
  return {
    ...payload,
    depositLink,
    depositStatus: normalizePaymentStatus(payload.depositStatus || defaultStatus),
    depositConfirmedAtISO: payload.depositConfirmedAtISO || "",
    finalBalance: hydrateFinalBalance(payload.finalBalance, totals)
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
        : {},
    kitchenCheckpoints: normalizeKitchenCheckpoints(payload.kitchenCheckpoints),
    productionChecklist: normalizeProductionChecklist(payload.productionChecklist)
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
    payment: hydratePayment(item.payment, item.totals),
    booking: hydrateBooking(item.booking),
    workflow: {
      ...(item.workflow || {}),
      followUp: normalizeFollowUp(item.workflow?.followUp),
      approvalRequests: normalizeApprovalRequests(item.workflow?.approvalRequests),
      changeRequestHandling: normalizeChangeRequestHandling(item.workflow?.changeRequestHandling)
    },
    portalDecision: normalizePortalDecision(item.portalDecision),
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
  if (status === "accepted") {
    if (!quoteHasMenuSelection(quote)) {
      throw new Error(
        "This accepted quote has no menu selection. Create and send a corrected replacement quote with at least one menu item before converting it to a contract."
      );
    }
    return;
  }
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
    latestVersionMeta.versionId = latestVersionId;

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
    const actorUid = String(auth?.currentUser?.uid || "").trim();
    const actorEmail = normalizeEmail(auth?.currentUser?.email);
    if (!actorUid || !actorEmail) {
      throw new Error("Authenticated user identity is required to create a quote version.");
    }
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
        createdBy: {
          uid: actorUid,
          email: actorEmail
        },
        reason: normalizedReason
      });
      versionMeta.versionId = versionId;
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
  versionMeta.versionId = versionId;

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
  capacityLimit = 400,
  approvalRequestId = ""
} = {}) {
  const id = String(quoteId || "").trim();
  if (!id) {
    throw new Error("Quote id is required.");
  }

  if (firebaseReady) {
    const requestId = String(approvalRequestId || "").trim();
    if (!requestId) {
      throw new Error("An approved contract-conversion request is required.");
    }
    const organizationId = requireWriteOrganizationId(
      undefined,
      CONVERT_QUOTE_TO_CONTRACT_CALLABLE
    );
    ensureCallableReady(CONVERT_QUOTE_TO_CONTRACT_CALLABLE);
    const call = httpsCallable(cloudFunctions, CONVERT_QUOTE_TO_CONTRACT_CALLABLE);
    const response = await call({
      organizationId,
      quoteId: id,
      approvalRequestId: requestId
    });
    const converted = response?.data && typeof response.data === "object"
      ? response.data
      : {};
    const approvalRequest = normalizeApprovalRequests([converted.approvalRequest])[0];
    if (
      converted.ok !== true
      || normalizeOrganizationId(converted.organizationId) !== organizationId
      || String(converted.quoteId || "").trim() !== id
      || String(converted.status || "").trim().toLowerCase() !== "booked"
      || !String(converted.contractNumber || "").trim()
      || !converted.booking
      || !converted.lifecycle
      || !converted.availability
      || !approvalRequest
      || approvalRequest.id !== requestId
      || approvalRequest.action !== "convert_to_contract"
      || approvalRequest.executionState !== "succeeded"
    ) {
      throw new Error("Trusted contract conversion returned an invalid response.");
    }
    return {
      ok: true,
      storage: "firebase",
      status: "booked",
      booking: converted.booking,
      lifecycle: converted.lifecycle,
      contractNumber: String(converted.contractNumber).trim(),
      availability: converted.availability,
      approvalRequest,
      versionId: String(converted.versionId || "").trim(),
      versionNumber: Math.max(1, Number(converted.versionNumber || 1))
    };
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
  const approvalExecution = completeLocalApprovalExecution({
    workflow: quote.workflow,
    approvalRequestId,
    action: "convert_to_contract",
    actorEmail: actor,
    completedAtISO: nowISO,
    reference: contractNumber
  });

  await saveQuoteVersion(id);

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
      workflow: approvalExecution.workflow,
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
    availability,
    approvalRequest: approvalExecution.request
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
  quoteId
} = {}) {
  const id = String(quoteId || "").trim();
  if (!id) {
    throw new Error("Quote id is required.");
  }
  throw new Error(
    "Direct browser CRM sends are disabled. A server-authorized admin integration is required."
  );
}

async function persistQuotePatch({
  quote,
  quoteId,
  operation,
  nowISO,
  firebasePatch,
  localPatch,
  syncPortal = false
}) {
  await saveQuoteVersion(quoteId);
  if (firebaseReady) {
    await updateDoc(quoteWriteDocRef(quoteId, quote.organizationId, operation), {
      ...firebasePatch,
      updatedAtISO: nowISO
    });
    if (syncPortal) await syncPortalSnapshotFromQuoteDoc(quoteId, quote.organizationId);
    return "firebase";
  }

  const existing = JSON.parse(localStorage.getItem(LOCAL_QUOTES_KEY) || "[]");
  let found = false;
  const next = existing.map((item) => {
    if (item.id !== quoteId) return item;
    found = true;
    return { ...item, updatedAtISO: nowISO, ...localPatch(item) };
  });
  if (!found) throw new Error("Quote not found.");
  localStorage.setItem(LOCAL_QUOTES_KEY, JSON.stringify(next));
  return "local";
}

export async function updateQuoteBookingAssignment({ quoteId, staffLead = "" } = {}) {
  const id = String(quoteId || "").trim();
  if (!id) {
    throw new Error("Quote id is required.");
  }
  const quote = await readQuoteById(id);
  const nowISO = isoNow();
  const nextLead = String(staffLead || "").trim();

  const storage = await persistQuotePatch({
    quote,
    quoteId: id,
    operation: "updateQuoteBookingAssignment",
    nowISO,
    firebasePatch: {
      "booking.staffLead": nextLead,
      "booking.staffAssignedAtISO": nowISO
    },
    localPatch: (item) => ({
      booking: {
        ...hydrateBooking(item.booking),
        staffLead: nextLead,
        staffAssignedAtISO: nowISO
      }
    }),
    syncPortal: true
  });
  return { ok: true, storage };
}

export async function updateQuoteKitchenCheckpoints({ quoteId, checkpoints = [] } = {}) {
  const id = String(quoteId || "").trim();
  if (!id) {
    throw new Error("Quote id is required.");
  }
  const quote = await readQuoteById(id);
  const nowISO = isoNow();
  const nextCheckpoints = normalizeKitchenCheckpoints(checkpoints);

  const storage = await persistQuotePatch({
    quote,
    quoteId: id,
    operation: "updateQuoteKitchenCheckpoints",
    nowISO,
    firebasePatch: { "booking.kitchenCheckpoints": nextCheckpoints },
    localPatch: (item) => ({
      booking: {
        ...hydrateBooking(item.booking),
        kitchenCheckpoints: nextCheckpoints
      }
    }),
    syncPortal: true
  });
  return { ok: true, storage, checkpoints: nextCheckpoints };
}

export async function updateQuoteProductionChecklist({
  quoteId,
  checklist = [],
  actorEmail = ""
} = {}) {
  const id = String(quoteId || "").trim();
  if (!id) {
    throw new Error("Quote id is required.");
  }
  const quote = await readQuoteById(id);
  const nowISO = isoNow();
  const actor = normalizeEmail(actorEmail);
  const nextChecklist = normalizeProductionChecklist(checklist).map((item) => ({
    ...item,
    completedAtISO: item.completed ? item.completedAtISO || nowISO : "",
    completedByEmail: item.completed ? item.completedByEmail || actor : ""
  }));

  const storage = await persistQuotePatch({
    quote,
    quoteId: id,
    operation: "updateQuoteProductionChecklist",
    nowISO,
    firebasePatch: { "booking.productionChecklist": nextChecklist },
    localPatch: (item) => ({
      booking: {
        ...hydrateBooking(item.booking),
        productionChecklist: nextChecklist
      }
    })
  });
  return { ok: true, storage, checklist: nextChecklist };
}

export async function updateQuoteFollowUp({
  quoteId,
  stage = "new",
  dueDate = "",
  note = "",
  completed = false,
  actorEmail = ""
} = {}) {
  const id = String(quoteId || "").trim();
  if (!id) {
    throw new Error("Quote id is required.");
  }
  if (!FOLLOW_UP_STAGE_IDS.includes(stage)) {
    throw new Error("Invalid follow-up stage.");
  }
  const normalizedDueDate = String(dueDate || "").trim();
  if (normalizedDueDate && !/^\d{4}-\d{2}-\d{2}$/.test(normalizedDueDate)) {
    throw new Error("Follow-up due date must use YYYY-MM-DD.");
  }

  const quote = await readQuoteById(id);
  const current = normalizeFollowUp(quote.workflow?.followUp);
  const nowISO = isoNow();
  const nextFollowUp = normalizeFollowUp({
    stage,
    dueDate: normalizedDueDate,
    note,
    completed,
    completedAtISO: completed ? current.completedAtISO || nowISO : "",
    updatedAtISO: nowISO,
    updatedByEmail: actorEmail
  });

  const storage = await persistQuotePatch({
    quote,
    quoteId: id,
    operation: "updateQuoteFollowUp",
    nowISO,
    firebasePatch: { "workflow.followUp": nextFollowUp },
    localPatch: (item) => ({
      workflow: {
        ...(item.workflow || {}),
        followUp: nextFollowUp,
        approvalRequests: normalizeApprovalRequests(item.workflow?.approvalRequests)
      }
    })
  });
  return { ok: true, storage, followUp: nextFollowUp };
}

export async function updateQuoteChangeRequestHandling({
  organizationId,
  quoteId,
  sourceRequestId = "",
  sourceSubmittedAtISO,
  sourceMessage,
  action,
  note = "",
  actorEmail = "",
  actorRole = ""
} = {}) {
  const id = String(quoteId || "").trim();
  if (!id) {
    throw new Error("Quote id is required.");
  }
  const normalizedRole = String(actorRole || "").trim().toLowerCase();
  if (!["admin", "sales"].includes(normalizedRole)) {
    throw new Error("Staff role required to handle customer change requests.");
  }
  const normalizedAction = String(action || "").trim().toLowerCase();
  if (!["acknowledge", "mark_handled"].includes(normalizedAction)) {
    throw new Error("Change request action must be acknowledge or mark_handled.");
  }
  const requestSource = String(sourceSubmittedAtISO || "").trim();
  if (!requestSource) {
    throw new Error("Customer change request timestamp is required.");
  }
  const requestId = String(sourceRequestId || "").trim();
  const requestMessage = String(sourceMessage || "").trim().slice(0, MAX_PORTAL_DECISION_MESSAGE_LENGTH);
  if (!requestMessage) {
    throw new Error("Customer change request message is required.");
  }
  const normalizedNote = String(note || "").trim();
  if (normalizedNote.length > MAX_CHANGE_REQUEST_HANDLING_NOTE_LENGTH) {
    throw new Error(`Handling note must be ${MAX_CHANGE_REQUEST_HANDLING_NOTE_LENGTH} characters or fewer.`);
  }
  if (normalizedAction === "mark_handled" && !normalizedNote) {
    throw new Error("A handling note is required before marking a change request handled.");
  }
  const auditActorEmail = firebaseReady
    ? normalizeEmail(auth?.currentUser?.email)
    : normalizeEmail(actorEmail);
  if (!auditActorEmail) {
    throw new Error("Authenticated email is required for the change request handling record.");
  }
  const nextState = normalizedAction === "mark_handled" ? "handled" : "acknowledged";
  const staleRequestError = () => {
    const error = new Error("This customer change request is stale. Refresh the workflow and try again.");
    error.code = "workflow/stale-change-request";
    return error;
  };
  const buildNextHandling = (current, nowISO, persistedSource) => {
    const matchesCurrentRequest = (
      String(current.sourceRequestId || "").trim() === requestId
      && String(current.sourceSubmittedAtISO || "").trim() === requestSource
      && String(current.sourceMessage || "").trim() === requestMessage
    );
    if (matchesCurrentRequest && current.state === "handled") {
      if (nextState === "handled") return current;
      throw new Error("A handled change request cannot be returned to acknowledged.");
    }
    if (matchesCurrentRequest && current.state === nextState) return current;
    const acknowledgedAtISO = matchesCurrentRequest && current.acknowledgedAtISO
      ? current.acknowledgedAtISO
      : nowISO;
    const acknowledgedByEmail = matchesCurrentRequest && current.acknowledgedByEmail
      ? current.acknowledgedByEmail
      : auditActorEmail;
    return {
      sourceRequestId: persistedSource.sourceRequestId,
      sourceSubmittedAtISO: persistedSource.sourceSubmittedAtISO,
      sourceMessage: persistedSource.sourceMessage,
      state: nextState,
      acknowledgedAtISO,
      acknowledgedByEmail,
      handledAtISO: nextState === "handled" ? nowISO : "",
      handledByEmail: nextState === "handled" ? auditActorEmail : "",
      note: nextState === "handled" ? normalizedNote : ""
    };
  };

  const writeOrganizationId = requireWriteOrganizationId(
    organizationId,
    "change request handling"
  );
  if (firebaseReady) {
    const quoteRef = quoteWriteDocRef(id, writeOrganizationId, "change request handling");
    let result = null;
    await runTransaction(db, async (transaction) => {
      const quoteSnap = await transaction.get(quoteRef);
      if (!quoteSnap.exists()) throw new Error("Quote not found.");
      const quote = quoteSnap.data();
      if (
        quote.status === "deleted"
        || quote.portalDecision?.decision !== "changes_requested"
        || String(quote.portalDecision?.requestId || "").trim() !== requestId
        || String(quote.portalDecision?.submittedAtISO || "").trim() !== requestSource
        || String(quote.portalDecision?.message || "").trim() !== requestMessage
      ) {
        throw staleRequestError();
      }
      const current = normalizeChangeRequestHandling(quote.workflow?.changeRequestHandling);
      const persistedSource = {
        sourceRequestId: String(quote.portalDecision?.requestId || ""),
        sourceSubmittedAtISO: String(quote.portalDecision?.submittedAtISO || ""),
        sourceMessage: String(quote.portalDecision?.message || "")
      };
      const nextHandling = buildNextHandling(current, isoNow(), persistedSource);
      if (
        current.sourceRequestId === nextHandling.sourceRequestId
        && current.sourceSubmittedAtISO === nextHandling.sourceSubmittedAtISO
        && current.sourceMessage === nextHandling.sourceMessage
        && current.state === nextHandling.state
      ) {
        result = { ok: true, storage: "unchanged", handling: current };
        return;
      }
      transaction.update(quoteRef, {
        "workflow.changeRequestHandling": nextHandling,
        updatedAtISO: nextHandling.handledAtISO || nextHandling.acknowledgedAtISO
      });
      result = { ok: true, storage: "firebase", handling: nextHandling };
    });
    return result;
  }

  const existing = JSON.parse(localStorage.getItem(LOCAL_QUOTES_KEY) || "[]");
  const quoteIndex = existing.findIndex((item) => (
    item.id === id
    && normalizeOrganizationId(item.organizationId) === writeOrganizationId
  ));
  if (quoteIndex < 0) throw new Error("Quote not found.");
  const quote = existing[quoteIndex];
  if (
    quote.status === "deleted"
    || quote.portalDecision?.decision !== "changes_requested"
    || String(quote.portalDecision?.requestId || "").trim() !== requestId
    || String(quote.portalDecision?.submittedAtISO || "").trim() !== requestSource
    || String(quote.portalDecision?.message || "").trim() !== requestMessage
  ) {
    throw staleRequestError();
  }
  const current = normalizeChangeRequestHandling(quote.workflow?.changeRequestHandling);
  const persistedSource = {
    sourceRequestId: String(quote.portalDecision?.requestId || ""),
    sourceSubmittedAtISO: String(quote.portalDecision?.submittedAtISO || ""),
    sourceMessage: String(quote.portalDecision?.message || "")
  };
  const nextHandling = buildNextHandling(current, isoNow(), persistedSource);
  if (
    current.sourceRequestId === nextHandling.sourceRequestId
    && current.sourceSubmittedAtISO === nextHandling.sourceSubmittedAtISO
    && current.sourceMessage === nextHandling.sourceMessage
    && current.state === nextHandling.state
  ) {
    return { ok: true, storage: "unchanged", handling: current };
  }
  existing[quoteIndex] = {
    ...quote,
    updatedAtISO: nextHandling.handledAtISO || nextHandling.acknowledgedAtISO,
    workflow: {
      ...(quote.workflow || {}),
      changeRequestHandling: nextHandling
    }
  };
  localStorage.setItem(LOCAL_QUOTES_KEY, JSON.stringify(existing));
  return { ok: true, storage: "local", handling: nextHandling };
}

export async function requestQuoteApproval({
  quoteId,
  action,
  note = "",
  actorEmail = "",
  actorRole = ""
} = {}) {
  const id = String(quoteId || "").trim();
  if (!id) {
    throw new Error("Quote id is required.");
  }
  const normalizedRole = String(actorRole || "").trim().toLowerCase();
  if (!new Set(["sales", "admin"]).has(normalizedRole)) {
    throw new Error("Staff role required to request approval.");
  }
  const normalizedAction = String(action || "").trim();
  if (!APPROVAL_ACTION_IDS.includes(normalizedAction)) {
    throw new Error("Invalid approval action.");
  }

  if (firebaseReady) {
    const organizationId = requireWriteOrganizationId(
      undefined,
      REQUEST_QUOTE_APPROVAL_CALLABLE
    );
    ensureCallableReady(REQUEST_QUOTE_APPROVAL_CALLABLE);
    const call = httpsCallable(cloudFunctions, REQUEST_QUOTE_APPROVAL_CALLABLE);
    try {
      const response = await call({
        organizationId,
        quoteId: id,
        action: normalizedAction,
        note: String(note || "").trim().slice(0, MAX_APPROVAL_NOTE_LENGTH)
      });
      const result = response?.data && typeof response.data === "object"
        ? response.data
        : {};
      const request = normalizeApprovalRequests([result.request])[0];
      if (
        result.ok !== true
        || normalizeOrganizationId(result.organizationId) !== organizationId
        || String(result.quoteId || "").trim() !== id
        || !request
        || request.action !== normalizedAction
        || request.state !== "pending"
        || (
          SERVER_SCOPED_PAYMENT_APPROVAL_ACTIONS.has(normalizedAction)
          && (!request.actionScope || !request.actionScopeDigest)
        )
      ) {
        throw new Error("Trusted approval request returned an invalid response.");
      }
      return { ok: true, storage: "firebase", request };
    } catch (err) {
      // Vercel can promote the browser before the coordinated Functions/rules
      // release. Only a confirmed missing endpoint may use the existing
      // rule-authorized write path during that short rollout window.
      if (!isMissingCallableError(err)) throw err;
      if (SERVER_SCOPED_PAYMENT_APPROVAL_ACTIONS.has(normalizedAction)) {
        throw new Error(
          "Payment approvals require the coordinated backend release. Retry after Functions are updated."
        );
      }
    }
  }

  const approvalActorEmail = firebaseReady
    ? normalizeEmail(auth?.currentUser?.email)
    : normalizeEmail(actorEmail);
  if (firebaseReady && !approvalActorEmail) {
    throw new Error("Authenticated email is required for approval audit fallback.");
  }
  const quote = await readQuoteById(id);
  const eligibility = getApprovalActionEligibility(quote, normalizedAction);
  if (!eligibility.eligible) {
    throw new Error(eligibility.reason || "This approval action is unavailable for the quote.");
  }
  const current = normalizeApprovalRequests(quote.workflow?.approvalRequests);
  if (current.some((item) => (
    item.action === normalizedAction
    && (
      item.state === "pending"
      || (
        item.state === "approved"
        && !["succeeded", "failed"].includes(item.executionState)
      )
    )
  ))) {
    throw new Error("An unresolved or unexecuted approval request already exists for this action.");
  }
  const nowISO = isoNow();
  const request = {
    id: buildPortalKey(),
    action: normalizedAction,
    state: "pending",
    note: String(note || "").trim().slice(0, MAX_APPROVAL_NOTE_LENGTH),
    requestedAtISO: nowISO,
    requestedByEmail: approvalActorEmail,
    resolvedAtISO: "",
    resolvedByEmail: "",
    resolutionNote: "",
    executionState: "",
    executionStartedAtISO: "",
    executionCompletedAtISO: "",
    executedByEmail: "",
    executionOperationId: "",
    executionReference: "",
    executionError: ""
  };
  const nextRequests = normalizeApprovalRequests([...current, request]);

  const storage = await persistQuotePatch({
    quote,
    quoteId: id,
    operation: "requestQuoteApproval",
    nowISO,
    firebasePatch: { "workflow.approvalRequests": nextRequests },
    localPatch: (item) => ({
      workflow: {
        ...(item.workflow || {}),
        followUp: normalizeFollowUp(item.workflow?.followUp),
        approvalRequests: nextRequests
      }
    })
  });
  return { ok: true, storage, request };
}

export async function resolveQuoteApprovalRequest({
  quoteId,
  requestId,
  state,
  resolutionNote = "",
  actorEmail = "",
  actorRole = ""
} = {}) {
  const id = String(quoteId || "").trim();
  const approvalRequestId = String(requestId || "").trim();
  if (!id || !approvalRequestId) {
    throw new Error("Quote id and approval request id are required.");
  }
  if (String(actorRole || "").trim().toLowerCase() !== "admin") {
    throw new Error("Admin role required to resolve approval requests.");
  }
  const nextState = String(state || "").trim().toLowerCase();
  if (!new Set(["approved", "rejected"]).has(nextState)) {
    throw new Error("Approval resolution must be approved or rejected.");
  }

  if (firebaseReady) {
    const organizationId = requireWriteOrganizationId(
      undefined,
      RESOLVE_QUOTE_APPROVAL_CALLABLE
    );
    ensureCallableReady(RESOLVE_QUOTE_APPROVAL_CALLABLE);
    const call = httpsCallable(cloudFunctions, RESOLVE_QUOTE_APPROVAL_CALLABLE);
    try {
      const response = await call({
        organizationId,
        quoteId: id,
        requestId: approvalRequestId,
        state: nextState,
        resolutionNote: String(resolutionNote || "").trim().slice(0, MAX_APPROVAL_NOTE_LENGTH)
      });
      const result = response?.data && typeof response.data === "object"
        ? response.data
        : {};
      const request = normalizeApprovalRequests([result.request])[0];
      if (
        result.ok !== true
        || normalizeOrganizationId(result.organizationId) !== organizationId
        || String(result.quoteId || "").trim() !== id
        || !request
        || request.id !== approvalRequestId
        || request.state !== nextState
        || (
          SERVER_SCOPED_PAYMENT_APPROVAL_ACTIONS.has(request.action)
          && (!request.actionScope || !request.actionScopeDigest)
        )
      ) {
        throw new Error("Trusted approval resolution returned an invalid response.");
      }
      return { ok: true, storage: "firebase", request };
    } catch (err) {
      if (!isMissingCallableError(err)) throw err;
      if (nextState === "approved") {
        const quote = await readQuoteById(id);
        const target = normalizeApprovalRequests(quote.workflow?.approvalRequests)
          .find((item) => item.id === approvalRequestId);
        if (SERVER_SCOPED_PAYMENT_APPROVAL_ACTIONS.has(target?.action)) {
          throw new Error(
            "Payment approval requires the coordinated backend release. Retry after Functions are updated."
          );
        }
      }
    }
  }

  const resolutionActorEmail = firebaseReady
    ? normalizeEmail(auth?.currentUser?.email)
    : normalizeEmail(actorEmail);
  if (firebaseReady && !resolutionActorEmail) {
    throw new Error("Authenticated email is required for approval resolution audit fallback.");
  }
  const quote = await readQuoteById(id);
  const current = normalizeApprovalRequests(quote.workflow?.approvalRequests);
  const target = current.find((item) => item.id === approvalRequestId);
  if (!target) {
    throw new Error("Approval request not found.");
  }
  if (target.state !== "pending") {
    throw new Error("Approval request is already resolved.");
  }
  if (nextState === "approved") {
    const eligibility = getApprovalActionEligibility(quote, target.action, {
      ignoreRequestId: target.id
    });
    if (!eligibility.eligible) {
      throw new Error(eligibility.reason || "This approval action is no longer available.");
    }
  }
  const nowISO = isoNow();
  const nextRequests = current.map((item) => (
    item.id === approvalRequestId
      ? {
        ...item,
        state: nextState,
        resolvedAtISO: nowISO,
        resolvedByEmail: resolutionActorEmail,
        resolutionNote: String(resolutionNote || "").trim().slice(0, MAX_APPROVAL_NOTE_LENGTH),
        executionState: nextState === "approved" ? "awaiting_execution" : "",
        executionStartedAtISO: "",
        executionCompletedAtISO: "",
        executedByEmail: "",
        executionOperationId: "",
        executionReference: "",
        executionError: ""
      }
      : item
  ));
  const resolvedRequest = nextRequests.find((item) => item.id === approvalRequestId);

  const storage = await persistQuotePatch({
    quote,
    quoteId: id,
    operation: "resolveQuoteApprovalRequest",
    nowISO,
    firebasePatch: { "workflow.approvalRequests": nextRequests },
    localPatch: (item) => ({
      workflow: {
        ...(item.workflow || {}),
        followUp: normalizeFollowUp(item.workflow?.followUp),
        approvalRequests: nextRequests
      }
    })
  });
  return { ok: true, storage, request: resolvedRequest };
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
  const selectedMenuItems = requireMenuSelection(form);
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
  const menuItems = selectedMenuItems;
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
      serverRateMixCsv: sanitizeServerRateMixCsv(form.serverRateMixCsv),
      chefRateMixCsv: sanitizeChefRateMixCsv(form.chefRateMixCsv),
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
      servers: Number(form.servers || 0),
      chefs: Number(form.chefs || 0),
      bartenders: Number(form.bartenders || 0),
      dietaryRestrictions: sanitizeDietaryRestrictions(form.dietaryRestrictions),
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
        serverRatesApplied: normalizeRateArray(totals.serverRatesApplied),
        serverLabor: toNumber(totals.serverLabor, 0),
        chefRateApplied: totals.chefRateApplied,
        chefRatesApplied: normalizeRateArray(totals.chefRatesApplied),
        chefLabor: toNumber(totals.chefLabor, 0),
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
      serverRateMixCsv: sanitizeServerRateMixCsv(form.serverRateMixCsv),
      chefRateMixCsv: sanitizeChefRateMixCsv(form.chefRateMixCsv),
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
      kitchenCheckpoints: [],
      productionChecklist: [],
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
    workflow: {
      followUp: normalizeFollowUp({ stage: "new" }),
      approvalRequests: []
    },
    portalDecision: {},
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
      serverLabor: totals.serverLabor,
      chefLabor: totals.chefLabor,
      bartenderLabor: totals.bartenderLabor,
      bartenderRateApplied: totals.bartenderRateApplied,
      serverRateApplied: totals.serverRateApplied,
      serverRatesApplied: normalizeRateArray(totals.serverRatesApplied),
      chefRateApplied: totals.chefRateApplied,
      chefRatesApplied: normalizeRateArray(totals.chefRatesApplied),
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
      organizationName: settings?.organizationName || "",
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
    const writeOrganizationId = requireWriteOrganizationId(
      resolvedOrganizationId,
      "submitQuote"
    );
    ensureCallableReady("submitQuote");
    const call = httpsCallable(cloudFunctions, "createQuoteDraft");
    const response = await call({
      organizationId: writeOrganizationId,
      form
    });
    const created = response?.data && typeof response.data === "object"
      ? response.data
      : {};
    const createdOrganizationId = normalizeOrganizationId(created.organizationId);
    if (
      created.ok !== true
      || createdOrganizationId !== writeOrganizationId
      || !String(created.id || "").trim()
      || !String(created.quoteNumber || "").trim()
      || !String(created.portalKey || "").trim()
    ) {
      throw new Error("Trusted quote creation returned an invalid response.");
    }
    return {
      id: String(created.id).trim(),
      quoteNumber: String(created.quoteNumber).trim(),
      portalKey: String(created.portalKey).trim(),
      portalIssuedAtISO: String(created.portalIssuedAtISO || "").trim(),
      portalExpiresAtISO: String(created.portalExpiresAtISO || "").trim(),
      activeVersionId: String(created.activeVersionId || "v0001").trim(),
      latestVersionNumber: Math.max(1, Number(created.latestVersionNumber || 1)),
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
  const selectedMenuItems = requireMenuSelection(form);

  if (firebaseReady) {
    const writeOrganizationId = requireWriteOrganizationId(
      organizationId,
      "updateQuote"
    );
    ensureCallableReady("updateQuote");
    const call = httpsCallable(cloudFunctions, UPDATE_QUOTE_DRAFT_CALLABLE);
    const response = await call({
      organizationId: writeOrganizationId,
      quoteId: id,
      form
    });
    const updated = response?.data && typeof response.data === "object"
      ? response.data
      : {};
    const updatedOrganizationId = normalizeOrganizationId(updated.organizationId);
    const updatedQuoteId = String(updated.quoteId || updated.id || "").trim();
    if (
      updated.ok !== true
      || updatedOrganizationId !== writeOrganizationId
      || updatedQuoteId !== id
      || updated.status !== "draft"
      || !String(updated.quoteNumber || "").trim()
      || !String(updated.portalKey || "").trim()
      || !String(updated.activeVersionId || updated.versionId || "").trim()
    ) {
      throw new Error("Trusted quote edit returned an invalid response.");
    }
    return {
      id: updatedQuoteId,
      quoteNumber: String(updated.quoteNumber).trim(),
      portalKey: String(updated.portalKey).trim(),
      portalIssuedAtISO: String(updated.portalIssuedAtISO || "").trim(),
      portalExpiresAtISO: String(updated.portalExpiresAtISO || "").trim(),
      expiresAtISO: String(updated.expiresAtISO || "").trim(),
      status: "draft",
      storage: "firebase",
      activeVersionId: String(updated.activeVersionId || updated.versionId).trim(),
      latestVersionNumber: Math.max(
        1,
        Number(updated.latestVersionNumber || updated.versionNumber || 1)
      )
    };
  }

  const existing = await readQuoteById(id);
  const nowISO = isoNow();
  const normalizedCustomerEmail = normalizeEmail(form.email);
  const customerNameKey = normalizeCustomerNameKey(form.name);
  const eventTypeId = String(form.eventTypeId || "").trim();
  const validityDays = Math.max(1, Number(settings?.quoteValidityDays || DEFAULT_VALIDITY_DAYS));
  const expiresAtISO = addDaysISO(nowISO, validityDays);
  const menuItems = selectedMenuItems;
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

  const existingPayment = hydratePayment(existing.payment, existing.totals);
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
      serverRateMixCsv: sanitizeServerRateMixCsv(form.serverRateMixCsv),
      chefRateMixCsv: sanitizeChefRateMixCsv(form.chefRateMixCsv),
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
      servers: Number(form.servers || 0),
      chefs: Number(form.chefs || 0),
      bartenders: Number(form.bartenders || 0),
      dietaryRestrictions: sanitizeDietaryRestrictions(form.dietaryRestrictions),
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
        serverRatesApplied: normalizeRateArray(totals.serverRatesApplied),
        serverLabor: toNumber(totals.serverLabor, 0),
        chefRateApplied: totals.chefRateApplied,
        chefRatesApplied: normalizeRateArray(totals.chefRatesApplied),
        chefLabor: toNumber(totals.chefLabor, 0),
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
      serverRateMixCsv: sanitizeServerRateMixCsv(form.serverRateMixCsv),
      chefRateMixCsv: sanitizeChefRateMixCsv(form.chefRateMixCsv),
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
      serverLabor: totals.serverLabor,
      chefLabor: totals.chefLabor,
      bartenderLabor: totals.bartenderLabor,
      bartenderRateApplied: totals.bartenderRateApplied,
      serverRateApplied: totals.serverRateApplied,
      serverRatesApplied: normalizeRateArray(totals.serverRatesApplied),
      chefRateApplied: totals.chefRateApplied,
      chefRatesApplied: normalizeRateArray(totals.chefRatesApplied),
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
      organizationName: settings?.organizationName || "",
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

export async function rotateQuotePortalKey({
  quoteId,
  actorEmail = "",
  approvalRequestId = ""
} = {}) {
  const id = String(quoteId || "").trim();
  if (!id) {
    throw new Error("Quote id is required.");
  }

  const quote = await readQuoteById(id);
  if (firebaseReady) {
    const requestId = String(approvalRequestId || "").trim();
    if (!requestId) {
      throw new Error("An approved portal-rotation request is required.");
    }
    const organizationId = requireWriteOrganizationId(
      quote.organizationId,
      "rotateQuotePortalKey"
    );
    ensureCallableReady("rotateQuotePortalKey");
    const call = httpsCallable(cloudFunctions, "rotateQuotePortalKey");
    const response = await call({
      organizationId,
      quoteId: id,
      approvalRequestId: requestId
    });
    const rotated = response?.data && typeof response.data === "object"
      ? response.data
      : {};
    const approvalRequest = normalizeApprovalRequests([rotated.approvalRequest])[0];
    if (
      rotated.ok !== true
      || normalizeOrganizationId(rotated.organizationId) !== organizationId
      || String(rotated.quoteId || "").trim() !== id
      || !String(rotated.portalKey || "").trim()
      || !String(rotated.portalIssuedAtISO || "").trim()
      || !String(rotated.portalExpiresAtISO || "").trim()
      || !approvalRequest
      || approvalRequest.id !== requestId
      || approvalRequest.action !== "rotate_portal_link"
      || approvalRequest.executionState !== "succeeded"
    ) {
      throw new Error("Trusted portal rotation returned an invalid response.");
    }
    return {
      ok: true,
      storage: "firebase",
      portalKey: String(rotated.portalKey).trim(),
      portalIssuedAtISO: String(rotated.portalIssuedAtISO).trim(),
      portalExpiresAtISO: String(rotated.portalExpiresAtISO).trim(),
      versionId: String(rotated.versionId || "").trim(),
      versionNumber: Math.max(1, Number(rotated.versionNumber || 1)),
      approvalRequest
    };
  }

  const nowISO = isoNow();
  const nextPortalKey = buildPortalKey();
  const portalIssuedAtISO = nowISO;
  const portalExpiresAtISO = ["accepted", "booked"].includes(normalizeStatus(quote.status))
    ? addDaysISO(portalIssuedAtISO, PORTAL_TOKEN_VALIDITY_DAYS)
    : resolvePortalExpiresAtISO(
      {
        expiresAtISO: quote.expiresAtISO || addDaysISO(nowISO, DEFAULT_VALIDITY_DAYS),
        portalIssuedAtISO
      },
      portalIssuedAtISO,
      nowISO
    );
  const normalizedActorEmail = normalizeEmail(actorEmail);
  const approvalExecution = completeLocalApprovalExecution({
    workflow: quote.workflow,
    approvalRequestId,
    action: "rotate_portal_link",
    actorEmail: normalizedActorEmail,
    completedAtISO: nowISO,
    reference: nextPortalKey
  });

  await saveQuoteVersion(id, {
    reason: "portal_key_rotate",
    organizationId: quote.organizationId
  });

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
      workflow: approvalExecution.workflow,
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
    portalExpiresAtISO,
    approvalRequest: approvalExecution.request
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
      kitchenCheckpoints: [],
      productionChecklist: [],
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
    workflow: {
      followUp: normalizeFollowUp({ stage: "new" }),
      approvalRequests: []
    },
    portalDecision: {},
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
    ensureCallableReady("duplicateQuote");
    const call = httpsCallable(cloudFunctions, "duplicateQuoteDraft");
    const response = await call({
      organizationId,
      sourceQuoteId: String(source.id || quoteId || "").trim()
    });
    const created = response?.data && typeof response.data === "object"
      ? response.data
      : {};
    if (
      created.ok !== true
      || normalizeOrganizationId(created.organizationId) !== organizationId
      || !String(created.id || "").trim()
      || !String(created.quoteNumber || "").trim()
      || !String(created.portalKey || "").trim()
    ) {
      throw new Error("Trusted quote duplication returned an invalid response.");
    }
    return {
      id: String(created.id).trim(),
      quoteNumber: String(created.quoteNumber).trim(),
      portalKey: String(created.portalKey).trim(),
      portalIssuedAtISO: String(created.portalIssuedAtISO || "").trim(),
      portalExpiresAtISO: String(created.portalExpiresAtISO || "").trim(),
      activeVersionId: String(created.activeVersionId || "v0001").trim(),
      latestVersionNumber: Math.max(1, Number(created.latestVersionNumber || 1)),
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

function applyQuoteHistoryFilters(quotes, { eventTypeId = "", customerName = "", includeDeleted = false } = {}) {
  const normalizedEventTypeId = String(eventTypeId || "").trim();
  const normalizedCustomerName = normalizeCustomerNameKey(customerName);

  return quotes.filter((quote) => {
    if (!includeDeleted && normalizeStatus(quote?.status) === "deleted") {
      return false;
    }

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

export async function getWorkflowAttentionSnapshot({ organizationId = "" } = {}) {
  const scopedOrgId = normalizeOrganizationId(organizationId);
  if (!scopedOrgId) {
    throw new Error("organizationId is required for workflow attention read.");
  }
  const nowISO = isoNow();

  if (firebaseReady) {
    const readableOrgId = requireReadOrganizationId(scopedOrgId, "workflow attention read");
    const snap = await getDocs(query(
      quotesCollectionRef(readableOrgId),
      where("status", "in", WORKFLOW_ATTENTION_STATUSES)
    ));
    return {
      source: "firebase",
      quotes: sortQuotesDesc(snap.docs.map((docSnap) => {
        const data = docSnap.data();
        const createdAtISO = timestampToISO(data.createdAtISO || data.createdAt, nowISO);
        return applyExpiry(hydrateQuote({
          id: docSnap.id,
          ...data,
          organizationId: normalizeOrganizationId(data.organizationId || readableOrgId),
          createdAtISO
        }, nowISO), nowISO);
      }))
    };
  }

  const existing = JSON.parse(localStorage.getItem(LOCAL_QUOTES_KEY) || "[]");
  const quotes = existing
    .filter((quote) => (
      normalizeOrganizationId(quote?.organizationId) === scopedOrgId
      && WORKFLOW_ATTENTION_STATUSES.includes(normalizeStatus(quote?.status))
    ))
    .map((quote) => applyExpiry(hydrateQuote(quote, nowISO), nowISO));
  return {
    source: "local",
    quotes: sortQuotesDesc(quotes)
  };
}

export async function getQuoteHistory(filters = {}) {
  const e2eDelayMs = Math.max(0, Number(globalThis.__quotePilotE2eDelays?.quoteHistoryMs || 0));
  if (e2eDelayMs > 0) {
    await new Promise((resolve) => globalThis.setTimeout(resolve, Math.min(e2eDelayMs, 5_000)));
  }
  const normalizedEventTypeId = String(filters?.eventTypeId || "").trim();
  const normalizedCustomerName = normalizeCustomerNameKey(filters?.customerName || "");
  const includeDeleted = filters?.includeDeleted === true;
  const persistExpiredStatuses = filters?.persistExpiredStatuses === true;
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

    let expiryPersistenceFailures = [];
    if (persistExpiredStatuses && autoExpired.length) {
      const writableAutoExpired = autoExpired.filter((quote) => (
        normalizeOrganizationId(quote.organizationId)
        && !hasUnresolvedQuoteDelivery(quote)
      ));
      const persistenceResults = await Promise.allSettled(
        writableAutoExpired.map((quote) => updateQuoteStatus(quote.id, "expired"))
      );
      expiryPersistenceFailures = persistenceResults
        .map((result, index) => (result.status === "rejected" ? writableAutoExpired[index].id : ""))
        .filter(Boolean);
    }

    const filteredQuotes = applyQuoteHistoryFilters(nextQuotes, {
      eventTypeId: normalizedEventTypeId,
      customerName: usedServerCustomerPrefix ? "" : normalizedCustomerName,
      includeDeleted
    });

    return {
      source: "firebase",
      quotes: filteredQuotes,
      expiryPersistenceFailures
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
      customerName: normalizedCustomerName,
      includeDeleted
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
    const nextQuote = {
      ...existingQuote,
      status: nextStatus,
      deletedAtISO: nextStatus === "deleted" ? nowISO : "",
      updatedAtISO: nowISO,
      lifecycle: lifecycleObject(nextStatus, nowISO, existingQuote.lifecycle),
      booking: nextStatus === "booked"
        ? {
            ...hydrateBooking(existingQuote.booking),
            bookedAtISO: existingQuote.booking?.bookedAtISO || nowISO
          }
        : hydrateBooking(existingQuote.booking)
    };
    const batch = writeBatch(db);
    batch.update(
      quoteWriteDocRef(id, existingQuote.organizationId, "updateQuoteStatus"),
      statusPayload
    );
    if (nextQuote.portalKey) {
      batch.update(portalDocRef(nextQuote.portalKey), {
        status: nextQuote.status,
        updatedAtISO: nextQuote.updatedAtISO,
        lifecycle: nextQuote.lifecycle
      });
    }
    await batch.commit();
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

  return {
    ok: true,
    storage: firebaseReady ? "firebase" : "local",
    crmSync: {
      ok: false,
      skipped: true,
      reason: "Direct browser CRM sends are disabled."
    }
  };
}

export async function reopenQuote(id) {
  const quoteId = String(id || "").trim();
  if (!quoteId) {
    throw new Error("Quote id is required.");
  }

  const quote = await readQuoteById(quoteId);
  if (firebaseReady) {
    const organizationId = requireWriteOrganizationId(
      quote.organizationId,
      "reopenQuote"
    );
    ensureCallableReady("reopenQuote");
    const call = httpsCallable(cloudFunctions, "reopenQuote");
    const response = await call({
      organizationId,
      quoteId
    });
    const reopened = response?.data && typeof response.data === "object"
      ? response.data
      : {};
    if (
      reopened.ok !== true
      || normalizeOrganizationId(reopened.organizationId) !== organizationId
      || String(reopened.quoteId || "").trim() !== quoteId
      || String(reopened.status || "").trim().toLowerCase() !== "draft"
      || !String(reopened.portalKey || "").trim()
      || !String(reopened.portalIssuedAtISO || "").trim()
      || !String(reopened.portalExpiresAtISO || "").trim()
      || !String(reopened.expiresAtISO || "").trim()
    ) {
      throw new Error("Trusted quote reopen returned an invalid response.");
    }
    return {
      ok: true,
      storage: "firebase",
      status: "draft",
      portalKey: String(reopened.portalKey).trim(),
      portalIssuedAtISO: String(reopened.portalIssuedAtISO).trim(),
      portalExpiresAtISO: String(reopened.portalExpiresAtISO).trim(),
      expiresAtISO: String(reopened.expiresAtISO).trim(),
      versionId: String(reopened.versionId || "").trim(),
      versionNumber: Math.max(1, Number(reopened.versionNumber || 1))
    };
  }

  const status = normalizeStatus(quote.status);
  if (!["expired", "deleted"].includes(status)) {
    throw new Error("Only expired or deleted quotes can be reopened.");
  }
  if (status === "deleted" && !String(quote.deletedAtISO || "").trim()) {
    throw new Error("Deleted quotes require a valid deletion audit timestamp before reopen.");
  }
  const activeVersionResult = await getActiveQuoteVersion(quoteId, {
    organizationId: quote.organizationId
  });
  const activeSnapshot =
    activeVersionResult?.version?.snapshot && typeof activeVersionResult.version.snapshot === "object"
      ? activeVersionResult.version.snapshot
      : null;
  const baseline = activeSnapshot || quote;
  if (
    (
      String(baseline.organizationId || "").trim()
      && normalizeOrganizationId(baseline.organizationId) !== normalizeOrganizationId(quote.organizationId)
    )
    || (
      String(baseline.id || "").trim()
      && String(baseline.id).trim() !== quoteId
    )
    || (
      String(baseline.quoteNumber || "").trim()
      && String(baseline.quoteNumber).trim() !== String(quote.quoteNumber || "").trim()
    )
    || String(baseline.ownerUid || "").trim() !== String(quote.ownerUid || "").trim()
    || normalizeEmail(baseline.ownerEmail) !== normalizeEmail(quote.ownerEmail)
  ) {
    throw new Error("Quote active version identity does not match the terminal quote.");
  }
  if (["deleted", "expired"].includes(normalizeStatus(baseline.status))) {
    throw new Error("Quote active version must be a nonterminal commercial snapshot.");
  }
  if (hasTerminalDecisionEvidence(quote) || hasTerminalDecisionEvidence(baseline)) {
    throw new Error("Accepted, declined, booked, or paid quotes cannot be reopened. Duplicate the quote instead.");
  }

  const nowISO = isoNow();
  const lifecycle = {
    ...(quote.lifecycle || {}),
    reopenedAtISO: nowISO
  };
  const nextPortalKey = buildPortalKey();
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
      event: activeSnapshot.event || quote.event,
      selection: activeSnapshot.selection || quote.selection,
      totals: activeSnapshot.totals || quote.totals,
      pricing: resolveQuotePricingSnapshot(activeSnapshot),
      source: activeSnapshot.source || quote.source
    }
    : {};
  const nextPortalIssuedAtISO = nowISO;
  const validityDays = Math.max(
    1,
    Math.min(365, Math.round(Number(quote.quoteMeta?.quoteValidityDays || DEFAULT_VALIDITY_DAYS)))
  );
  const nextExpiresAtISO = addDaysISO(nowISO, validityDays);
  const nextPortalExpiresAtISO = resolvePortalExpiresAtISO(
    {
      expiresAtISO: nextExpiresAtISO,
      portalIssuedAtISO: nextPortalIssuedAtISO
    },
    nextPortalIssuedAtISO,
    nowISO
  );

  const versionResult = await saveQuoteVersion(quoteId, {
    reason: "reopen_quote_before_restore",
    organizationId: quote.organizationId
  });

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
      expiresAtISO: nextExpiresAtISO,
      deletedAtISO: "",
      updatedAtISO: nowISO,
      lifecycle,
      portalDecision: normalizePortalDecision(quote.portalDecision),
      quoteMeta: {
        ...(item.quoteMeta || {}),
        reopenedAtISO: nowISO
      }
    };
  });
  localStorage.setItem(LOCAL_QUOTES_KEY, JSON.stringify(next));
  return {
    ok: true,
    storage: "local",
    status: "draft",
    portalKey: nextPortalKey,
    portalIssuedAtISO: nextPortalIssuedAtISO,
    portalExpiresAtISO: nextPortalExpiresAtISO,
    expiresAtISO: nextExpiresAtISO,
    versionId: versionResult.versionId,
    versionNumber: versionResult.versionNumber
  };
}

export async function deleteQuote(id, {
  organizationId = undefined,
  approvalRequestId = ""
} = {}) {
  const quoteId = String(id || "").trim();
  if (!quoteId) {
    throw new Error("Quote id is required.");
  }

  if (firebaseReady) {
    const requestId = String(approvalRequestId || "").trim();
    if (!requestId) {
      throw new Error("An approved quote-deletion request is required.");
    }
    ensureCallableReady("hard delete quote");
    const call = httpsCallable(cloudFunctions, HARD_DELETE_QUOTE_CALLABLE);
    const resolvedOrganizationId = normalizeOrganizationId(organizationId) || resolveContextualOrganizationId();
    const payload = {
      quoteId,
      approvalRequestId: requestId
    };
    if (resolvedOrganizationId) {
      payload.organizationId = resolvedOrganizationId;
    }
    const result = await call(payload);
    return {
      ok: true,
      storage: "firebase",
      ...(result?.data || {})
    };
  }

  const existing = JSON.parse(localStorage.getItem(LOCAL_QUOTES_KEY) || "[]");
  const exists = existing.some((item) => item.id === quoteId);
  if (!exists) {
    throw new Error("Quote not found.");
  }
  const next = existing.filter((item) => item.id !== quoteId);
  localStorage.setItem(LOCAL_QUOTES_KEY, JSON.stringify(next));
  const history = JSON.parse(localStorage.getItem(LOCAL_QUOTE_HISTORY_KEY) || "[]");
  const nextHistory = history.filter((item) => String(item?.quoteId || "").trim() !== quoteId);
  localStorage.setItem(LOCAL_QUOTE_HISTORY_KEY, JSON.stringify(nextHistory));
  return {
    ok: true,
    storage: "local",
    quoteId
  };
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
    if (!PORTAL_VISIBLE_STATUSES.has(normalizeStatus(portalData.status))) {
      throw new Error(PORTAL_TOKEN_EXPIRED_ERROR);
    }
    return {
      portalKey: key,
      ...portalData,
      payment: hydratePayment(portalData.payment, portalData.totals || {
        total: portalData.total,
        deposit: portalData.deposit
      }),
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
  if (!PORTAL_VISIBLE_STATUSES.has(normalizeStatus(snapshot.status))) {
    throw new Error(PORTAL_TOKEN_EXPIRED_ERROR);
  }
  return {
    ...snapshot,
    ...portalValidity
  };
}

export async function updatePortalDecision({
  portalKey,
  decision,
  message = "",
  signerName = "",
  consentVersion = "",
  expectedRevisionId = "",
  expectedPortalIssuedAtISO = ""
} = {}) {
  const key = String(portalKey || "").trim();
  if (!key) {
    throw new Error("Portal key is required.");
  }

  const normalizedDecision = String(decision || "").trim().toLowerCase();
  if (!["viewed", "accepted", "declined", "changes_requested"].includes(normalizedDecision)) {
    throw new Error("Invalid portal decision.");
  }
  const normalizedMessage = String(message || "").trim().slice(0, MAX_PORTAL_DECISION_MESSAGE_LENGTH);
  if (normalizedDecision === "changes_requested" && !normalizedMessage) {
    throw new Error("Add a note describing the requested changes.");
  }
  const normalizedSignerName = String(signerName || "").trim().replace(/\s+/g, " ").slice(0, 160);
  if (normalizedDecision === "accepted" && normalizedSignerName.length < 2) {
    throw new Error("Enter the signer’s full legal name.");
  }
  if (
    normalizedDecision === "accepted"
    && String(consentVersion || "").trim() !== PROPOSAL_ACCEPTANCE_CONSENT_VERSION
  ) {
    throw new Error("Confirm the electronic-signature statement before accepting.");
  }

  const nowISO = isoNow();
  const nextStatus = normalizedDecision === "changes_requested" ? "viewed" : normalizedDecision;
  const portalDecision = normalizedDecision === "viewed"
    ? {}
    : {
      decision: normalizedDecision,
      message: normalizedMessage,
      requestId: buildPortalKey(),
      submittedAtISO: nowISO
    };
  const portalDecisionPatch = normalizedDecision === "viewed" ? {} : { portalDecision };

  if (firebaseReady) {
    if (normalizedDecision === "accepted") {
      const normalizedRevisionId = String(expectedRevisionId || "").trim();
      const normalizedPortalIssuedAtISO = String(expectedPortalIssuedAtISO || "").trim();
      if (!normalizedRevisionId || !normalizedPortalIssuedAtISO) {
        throw new Error("Reload the current proposal before signing.");
      }
      const call = httpsCallable(cloudFunctions, ACCEPT_QUOTE_PROPOSAL_CALLABLE);
      const response = await call({
        portalKey: key,
        signerName: normalizedSignerName,
        consentVersion: PROPOSAL_ACCEPTANCE_CONSENT_VERSION,
        expectedRevisionId: normalizedRevisionId,
        expectedPortalIssuedAtISO: normalizedPortalIssuedAtISO,
        message: normalizedMessage
      });
      const result = response?.data || {};
      if (result?.ok !== true || result?.status !== "accepted" || !result?.acceptanceReceipt?.receiptId) {
        throw new Error("Proposal acceptance did not return a valid receipt.");
      }
      return result;
    }
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
    const currentStatus = normalizeStatus(portalData.status);
    if (normalizedDecision === "viewed" && currentStatus === "viewed") {
      return { ok: true, storage: "unchanged", status: currentStatus, portalDecision: {} };
    }
    if (!["sent", "viewed"].includes(currentStatus)) {
      throw new Error(
        currentStatus === "draft"
          ? "This proposal has not been sent and cannot be accepted yet."
          : "This customer decision is final and can no longer be changed from the portal."
      );
    }
    const lifecycle = lifecycleObject(nextStatus, nowISO, portalData.lifecycle);
    const decisionPatch = {
      status: nextStatus,
      updatedAtISO: nowISO,
      lifecycle,
      ...portalDecisionPatch
    };

    const quoteId = String(portalData.quoteId || "").trim();
    const organizationId = normalizeOrganizationId(portalData.organizationId);
    if (!quoteId || !organizationId) {
      throw new Error("This quote link needs an administrator data repair before a decision can be recorded.");
    }
    const batch = writeBatch(db);
    batch.update(portalRef, decisionPatch);
    batch.update(
      quoteWriteDocRef(quoteId, organizationId, "updatePortalDecision"),
      decisionPatch
    );
    await batch.commit();
    return { ok: true, storage: "firebase", status: nextStatus, portalDecision };
  }

  const existing = JSON.parse(localStorage.getItem(LOCAL_QUOTES_KEY) || "[]");
  const localTarget = existing.find((quote) => quote.portalKey === key);
  if (!localTarget) {
    throw new Error("Quote not found.");
  }
  assertPortalTokenActive(localTarget, nowISO);
  const currentStatus = normalizeStatus(localTarget.status);
  if (normalizedDecision === "viewed" && currentStatus === "viewed") {
    return { ok: true, storage: "unchanged", status: currentStatus, portalDecision: {} };
  }
  if (!["sent", "viewed"].includes(currentStatus)) {
    throw new Error(
      currentStatus === "draft"
        ? "This proposal has not been sent and cannot be accepted yet."
        : "This customer decision is final and can no longer be changed from the portal."
    );
  }
  if (normalizedDecision === "accepted" && !quoteHasMenuSelection(localTarget)) {
    throw new Error(
      "This proposal has no menu selection and cannot be signed. Ask staff to create and send a corrected quote."
    );
  }
  const localReceiptId = normalizedDecision === "accepted" ? `acceptance-${buildPortalKey()}` : "";
  const localRevisionId = String(
    expectedRevisionId
      || localTarget.workflow?.quoteDelivery?.revisionId
      || localTarget.activeVersionId
      || localTarget.versionMeta?.versionId
      || `local@${localTarget.updatedAtISO || localTarget.createdAtISO || nowISO}`
  ).trim();
  const localPortalIssuedAtISO = normalizeISO(
    expectedPortalIssuedAtISO || localTarget.portalIssuedAtISO,
    nowISO
  );
  const localAcceptanceReceipt = normalizedDecision === "accepted"
    ? {
        receiptId: localReceiptId,
        signerName: normalizedSignerName,
        actor: { type: "customer_portal", uid: "", email: "" },
        consentVersion: PROPOSAL_ACCEPTANCE_CONSENT_VERSION,
        consentText: "I agree to this proposal and consent to use my typed name as my electronic signature.",
        acceptedAtISO: nowISO,
        quoteRevisionId: localRevisionId,
        portalIssuedAtISO: localPortalIssuedAtISO,
        quoteNumber: String(localTarget.quoteNumber || "").trim(),
        currency: "USD",
        totalMinor: Math.round(Number(localTarget.totals?.total || 0) * 100),
        depositMinor: Math.round(Number(localTarget.totals?.deposit || 0) * 100),
        snapshotSha256: ""
      }
    : null;
  if (normalizedDecision === "accepted") {
    portalDecision.requestId = localReceiptId;
  }
  const next = existing.map((quote) => {
    if (quote.portalKey !== key) return quote;
    return {
      ...quote,
      status: nextStatus,
      updatedAtISO: nowISO,
      lifecycle: lifecycleObject(nextStatus, nowISO, quote.lifecycle),
      ...(normalizedDecision === "viewed" ? {} : { portalDecision }),
      ...(localAcceptanceReceipt ? { acceptanceReceipt: localAcceptanceReceipt } : {})
    };
  });
  localStorage.setItem(LOCAL_QUOTES_KEY, JSON.stringify(next));
  return {
    ok: true,
    storage: "local",
    status: nextStatus,
    portalDecision,
    ...(localAcceptanceReceipt ? { acceptanceReceipt: localAcceptanceReceipt } : {})
  };
}

export async function updatePortalQuoteStatus(portalKey, status) {
  const nextStatus = normalizeStatus(status);
  if (!["viewed", "accepted", "declined"].includes(nextStatus)) {
    throw new Error("Invalid portal status.");
  }
  return updatePortalDecision({
    portalKey,
    decision: nextStatus,
    message: ""
  });
}

export function buildQuoteEmailTemplate(quote) {
  const emailPayload = buildQuoteEmailPayload(quote);
  return {
    subject: emailPayload.subject,
    body: emailPayload.body
  };
}
