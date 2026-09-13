import { lazy, Suspense, useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
  getIntegrationSetupStatus,
  reconcileDepositCheckout,
  reconcileFinalBalanceCheckout,
  resolveQuoteDeliveryOutcome,
  resolveQuoteDeliveryRevisionId,
  sendFinalBalanceRequestToCustomerEmail,
  sendPaymentRequestToCustomerEmail,
  sendQuoteToCustomerEmail
} from "../lib/commerceOps";
import { getEventTypes } from "../lib/menuService";
import { sanitizeStripePaymentLink } from "../lib/paymentLink";
import { buildQuoteEmailPayload } from "../lib/proposalPayload";
import { buildDefaultEmailAppHandoff } from "../lib/defaultEmailApp";
import { getApprovalRequestExecutionEligibility } from "../lib/quoteWorkflow";
import { getRebookDeliveryGate } from "../lib/rebookQuoteClient";
import { portalConversationAvailable } from "../lib/portalConversationClient";
import {
  classifyBookingConfirmation,
  classifyDepositStatus,
  classifyFinalBalanceDisplayStatus,
  classifyQuoteStatus
} from "../lib/statusSemantics";
import {
  BOOKING_CONFIRMATION_STATUSES,
  convertQuoteToContract,
  deleteQuote,
  duplicateQuote,
  getAllowedStatusTransitions,
  getQuoteHistory,
  reopenQuote,
  rotateQuotePortalKey,
  updateQuoteBookingConfirmation,
  updateQuoteStatus
} from "../lib/quoteStore";
import { useWorkspaceRouteHeadingFocus } from "../hooks/useWorkspaceRouteHeadingFocus";
import { navigateBrowser } from "../hooks/useBrowserLocation";
import {
  useOptionalWorkspaceNavigation,
  useWorkspaceReturnContextAdapter
} from "../context/WorkspaceNavigationContext";
import { restoreWorkspaceReturnViewport } from "../lib/workspaceReturnContext";
import { buildQuotePath } from "../lib/workspaceRoutes";
import {
  buildQuoteHistoryController,
  buildRoleSafeQuoteActionController,
  getQuoteActionPermissions
} from "../lib/quoteHistoryController";
import {
  formatWorkspaceDate,
  formatWorkspaceInteger,
  formatWorkspaceMoney as currency,
  formatWorkspaceSource,
  formatWorkspaceText,
  humanizeWorkspaceValue
} from "../lib/workspacePresentation";
import CommercialDependencyStatePanel from "./CommercialDependencyStatePanel";
import ConfiguredQuoteActionRail from "./ConfiguredQuoteActionRail";
import EventWorkspaceView from "./EventWorkspaceView";
import KitchenBeoArtifactPanel from "./KitchenBeoArtifactPanel";
import QuoteDecisionDebtPanel from "./QuoteDecisionDebtPanel";
import QuoteConversationPanel from "quotepilot-active-conversation-panel";
import StatusChip from "./StatusChip";
import AdaptiveChoiceField from "./AdaptiveChoiceField";

const AMBIENT_UI_ENABLED = import.meta.env.VITE_AMBIENT_UI_ENABLED === "1"
  || import.meta.env.VITE_AMBIENT_UI_ENABLED === "true"
  || import.meta.env.VITE_AMBIENT_UI_ENABLED === "yes"
  || import.meta.env.VITE_AMBIENT_UI_ENABLED === "on";
const AmbientLivingOpportunityRoute = AMBIENT_UI_ENABLED
  ? lazy(() => import("./AmbientLivingOpportunityRoute"))
  : null;

const QUOTE_STATUS_FILTER_OPTIONS = [
  { value: "all", label: "All statuses" },
  { value: "draft", label: "Draft" },
  { value: "submitted", label: "Submitted" },
  { value: "archived", label: "Archived" }
];
const AmbientOpportunitiesStream = AMBIENT_UI_ENABLED
  ? lazy(() => import("./AmbientOpportunitiesStream"))
  : null;

function quoteFiltersFromSearch(search = "") {
  const rawSearch = String(search || "");
  const rawQuery = rawSearch.replace(/^\?/u, "");
  const params = new URLSearchParams(rawQuery);
  const allowedKeys = new Set(["eventType", "status"]);
  const eventTypeValues = params.getAll("eventType");
  const statusValues = params.getAll("status");
  const eventTypeCandidate = String(eventTypeValues[0] || "").trim();
  const statusCandidate = String(statusValues[0] || "").trim().toLowerCase();
  const validShape = [...params.keys()].every((key) => allowedKeys.has(key))
    && eventTypeValues.length <= 1
    && statusValues.length <= 1;
  const validEventType = !eventTypeCandidate
    || eventTypeCandidate === "all"
    || (eventTypeCandidate.length <= 160 && !/[\u0000-\u001f\u007f]/u.test(eventTypeCandidate));
  const validStatus = !statusCandidate
    || ["all", "draft", "submitted", "archived"].includes(statusCandidate);
  const accepted = validShape && validEventType && validStatus;
  const eventTypeFilter = accepted && eventTypeCandidate && eventTypeCandidate !== "all"
    ? eventTypeCandidate
    : "all";
  const statusFilter = accepted && statusCandidate && statusCandidate !== "all"
    ? statusCandidate
    : "all";
  const canonicalParams = new URLSearchParams();
  if (eventTypeFilter !== "all") canonicalParams.set("eventType", eventTypeFilter);
  if (statusFilter !== "all") canonicalParams.set("status", statusFilter);
  canonicalParams.sort();
  const canonicalQuery = canonicalParams.toString();
  const canonicalSearch = canonicalQuery ? `?${canonicalQuery}` : "";
  const currentSearch = rawQuery ? `?${rawQuery}` : "";
  return {
    eventTypeFilter,
    statusFilter,
    canonicalSearch,
    needsCanonicalization: currentSearch !== canonicalSearch
  };
}

function QuoteAdministrationBoundary({
  ambient = false,
  initiallyOpen = false,
  open: controlledOpen,
  onOpenChange,
  children
}) {
  const [internalOpen, setInternalOpen] = useState(Boolean(initiallyOpen));
  const open = typeof controlledOpen === "boolean" ? controlledOpen : internalOpen;
  useEffect(() => {
    if (!initiallyOpen) return;
    setInternalOpen(true);
    onOpenChange?.(true);
  }, [initiallyOpen, onOpenChange]);
  if (!ambient) return children();
  return (
    <details
      className="ambient-opportunities-administration"
      data-quote-administration="true"
      open={open}
      onToggle={(event) => {
        setInternalOpen(event.currentTarget.open);
        onOpenChange?.(event.currentTarget.open);
      }}
    >
      <summary>Quote administration</summary>
      <p className="source-note">
        Open the full role-safe controls for lifecycle, delivery, payment, booking, artifacts, and recovery.
      </p>
      {open ? children() : null}
    </details>
  );
}

function openQuoteWorkspace(quoteId) {
  const requested = String(quoteId || "").trim();
  const destination = requested
    ? buildQuotePath(requested)
    : "/app/quotes";
  navigateBrowser(destination, { preserveSearch: false, preserveHash: false });
}

const RESUMABLE_PAYMENT_APPROVAL_ACTIONS = new Set([
  "send_payment_request",
  "send_final_balance_request"
]);

const DEFINITIVE_CONTRACT_CONVERSION_ERROR_CODES = new Set([
  "already-exists",
  "failed-precondition",
  "invalid-argument",
  "not-found",
  "out-of-range",
  "permission-denied",
  "unauthenticated"
]);
const DELIVERY_LOCK_REASON = "Resolve the current delivery attempt first.";

function contractConversionErrorMessage(error, fallback = "Contract conversion could not be completed.") {
  const message = String(error?.message || fallback)
    .replace(/^FirebaseError:\s*/i, "")
    .trim();
  return message || fallback;
}

export function isDefinitiveContractConversionError(error) {
  const code = String(error?.code || "")
    .trim()
    .toLowerCase()
    .replace(/^functions\//, "");
  if (DEFINITIVE_CONTRACT_CONVERSION_ERROR_CODES.has(code)) return true;

  const message = contractConversionErrorMessage(error, "");
  return [
    /admin role required to convert quotes to contracts/i,
    /approve a contract-conversion request in workflow first/i,
    /approved contract-conversion request is required/i,
    /quote id is required/i,
    /organizationId is required for convertQuoteToContract/i,
    /quote not found/i,
    /already converted to a contract/i,
    /only accepted quotes can be converted to a contract/i,
    /accepted quote has no menu selection/i,
    /booking blocked: another contract is already booked/i
  ].some((pattern) => pattern.test(message));
}

export function createContractConversionMutationState(quoteId = "") {
  return {
    phase: "ready",
    quoteId: String(quoteId || "").trim(),
    approvalRequestId: "",
    requiresApproval: false,
    error: "",
    receipt: null
  };
}

export function getContractConversionMutationState(statesByQuote = {}, quoteId = "") {
  const normalizedQuoteId = String(quoteId || "").trim();
  const existing = normalizedQuoteId && statesByQuote && typeof statesByQuote === "object"
    ? statesByQuote[normalizedQuoteId]
    : null;
  return existing && typeof existing === "object"
    ? existing
    : createContractConversionMutationState(normalizedQuoteId);
}

export function reduceContractConversionMutationState(statesByQuote = {}, nextState = {}) {
  const quoteId = String(nextState?.quoteId || "").trim();
  if (!quoteId) return { ...(statesByQuote || {}) };
  return {
    ...(statesByQuote || {}),
    [quoteId]: {
      ...createContractConversionMutationState(quoteId),
      ...nextState,
      quoteId
    }
  };
}

export function quoteHistoryCloseBlockedByConversation(conversationQuote) {
  return Boolean(String(conversationQuote?.id || "").trim());
}

const CONTRACT_CONVERSION_CLOSE_BLOCKING_PHASES = new Set([
  "submitting",
  "uncertain",
  "reconciliation",
  "recovery"
]);

export function buildQuoteHistoryCloseGuard({
  conversationQuote = null,
  contractConversions = {}
} = {}) {
  const conversationQuoteId = String(conversationQuote?.id || "").trim();
  if (conversationQuoteId) {
    return {
      blocked: true,
      reason: "conversation",
      quoteId: conversationQuoteId,
      message: "Close the current quote conversation before leaving Quotes or opening another conversation."
    };
  }

  const blockedConversion = Object.values(
    contractConversions && typeof contractConversions === "object" ? contractConversions : {}
  ).find((conversion) => CONTRACT_CONVERSION_CLOSE_BLOCKING_PHASES.has(
    String(conversion?.phase || "").trim().toLowerCase()
  ));
  if (blockedConversion) {
    const quoteId = String(blockedConversion.quoteId || "").trim();
    const phase = String(blockedConversion.phase || "").trim().toLowerCase();
    const quoteLabel = quoteId ? ` for quote ${quoteId}` : "";
    return {
      blocked: true,
      reason: "contract_conversion",
      quoteId,
      message: phase === "uncertain"
        ? `Reconcile the uncertain contract conversion${quoteLabel} before leaving Quotes.`
        : `Keep Quotes open while the contract conversion${quoteLabel} is ${phase}.`
    };
  }

  return {
    blocked: false,
    reason: "",
    quoteId: "",
    message: ""
  };
}

export function shouldRestoreBlockedQuoteHistoryRoute({ open = true, closeGuard = {} } = {}) {
  return open === false && closeGuard?.blocked === true;
}

export function shouldRenderQuoteHistory({ open = true, closeGuard = {} } = {}) {
  return open === true || closeGuard?.blocked === true;
}

export function canOpenQuoteConversation(conversationQuote) {
  return !quoteHistoryCloseBlockedByConversation(conversationQuote);
}

export function resolveFocusedConversationQuote({
  focusAction = "",
  focusQuoteId = "",
  quotes = [],
  conversationQuote = null
} = {}) {
  if (
    String(focusAction || "").trim() !== "conversation"
    || quoteHistoryCloseBlockedByConversation(conversationQuote)
  ) {
    return null;
  }
  const targetId = String(focusQuoteId || "").trim();
  if (!targetId || !Array.isArray(quotes)) return null;
  return quotes.find((quote) => String(quote?.id || "").trim() === targetId) || null;
}

export function beginContractConversionAttempt({
  currentState = createContractConversionMutationState(),
  quoteId = "",
  approvalRequestId = "",
  requiresApproval = false,
  reconcile = false
} = {}) {
  const normalizedQuoteId = String(quoteId || "").trim();
  if (!normalizedQuoteId) {
    throw new Error("Quote id is required.");
  }
  if (reconcile) {
    const preservedQuoteId = String(currentState?.quoteId || "").trim();
    const preservedApprovalRequestId = String(currentState?.approvalRequestId || "").trim();
    const approvalRequired = currentState?.requiresApproval === true;
    if (preservedQuoteId !== normalizedQuoteId || (approvalRequired && !preservedApprovalRequestId)) {
      throw new Error("The original approved contract-conversion request is required for reconciliation.");
    }
    return {
      phase: "reconciliation",
      quoteId: normalizedQuoteId,
      approvalRequestId: preservedApprovalRequestId,
      requiresApproval: approvalRequired,
      error: "",
      receipt: null
    };
  }

  return {
    phase: "submitting",
    quoteId: normalizedQuoteId,
    approvalRequestId: String(approvalRequestId || "").trim(),
    requiresApproval: requiresApproval === true,
    error: "",
    receipt: null
  };
}

export function buildContractConversionMutationPresentation({
  phase = "ready",
  approvalReady = true,
  error = "",
  receipt = null
} = {}) {
  const normalizedError = String(error || "").trim();
  const contractNumber = String(receipt?.contractNumber || "").trim();
  const status = String(receipt?.status || "booked").trim().toLowerCase() || "booked";
  const versionNumber = Number(receipt?.versionNumber);
  const versionNote = Number.isSafeInteger(versionNumber) && versionNumber > 0
    ? ` Immutable version ${versionNumber} is linked to the result.`
    : "";

  if (phase === "submitting") {
    return {
      state: "submitting",
      title: "Submitting contract conversion",
      detail: "Waiting for the trusted conversion receipt before reporting a contract or status change.",
      error: ""
    };
  }
  if (phase === "uncertain") {
    return {
      state: "uncertain",
      title: "Conversion outcome is uncertain.",
      detail: "No trusted receipt returned. Reconcile the same approved request before assuming whether a contract was recorded.",
      error: normalizedError
    };
  }
  if (phase === "reconciliation") {
    return {
      state: "reconciliation",
      title: "Reconciling contract conversion",
      detail: "The same approval request identity is being retried while QuotePilot waits for the canonical result.",
      error: ""
    };
  }
  if (phase === "receipt") {
    return {
      state: "receipt",
      title: "Contract conversion receipt confirmed.",
      detail: `The trusted result records contract ${contractNumber || "number unavailable"} and quote status ${status}.${versionNote} Deposit and final-balance settlement, customer confirmation, and operational readiness remain separate records.`,
      error: ""
    };
  }
  if (phase === "error") {
    return {
      state: "error",
      title: "Contract conversion needs attention.",
      detail: "The request was definitively rejected before a successful conversion receipt. No contract or status change is assumed.",
      error: normalizedError
    };
  }
  if (phase === "recovery") {
    return {
      state: "recovery",
      title: "Refreshing canonical quote history",
      detail: "QuotePilot is reloading the authoritative quote before returning this row to a safe ready or receipt state.",
      error: ""
    };
  }
  return {
    state: "ready",
    title: approvalReady ? "Ready for approved conversion" : "Approval required before conversion",
    detail: approvalReady
      ? "No conversion request has been submitted from this row."
      : "Approve the exact contract-conversion request in Workflow before submitting this action.",
    error: ""
  };
}

export function ContractConversionMutationStatus({ presentation, showReady = false }) {
  if (!presentation) return null;
  if (!showReady && presentation.state === "ready") return null;
  const alertState = ["uncertain", "error"].includes(presentation.state)
    || Boolean(presentation.error);
  return (
    <div
      className="history-meta-stack"
      data-capability-state={presentation.state}
      data-mutation-state={presentation.state}
      role={alertState ? "alert" : "status"}
    >
      <small className={alertState ? "warning-note" : "source-note"}>
        <strong>{presentation.title}</strong> {presentation.detail}
      </small>
      {presentation.error && <small className="error-note">{presentation.error}</small>}
    </div>
  );
}

export async function recoverContractConversionFromCanonicalHistory({
  quoteId = "",
  refreshHistory
} = {}) {
  const normalizedQuoteId = String(quoteId || "").trim();
  if (!normalizedQuoteId || typeof refreshHistory !== "function") {
    throw new Error("Quote id and canonical history refresh are required for recovery.");
  }
  const history = await refreshHistory();
  if (!history || !Array.isArray(history.quotes)) {
    throw new Error("Canonical quote history could not be refreshed.");
  }
  const quote = history.quotes.find((item) => String(item?.id || "").trim() === normalizedQuoteId);
  if (!quote) {
    throw new Error("The quote is no longer available in canonical quote history.");
  }
  const contractNumber = String(quote?.booking?.contractNumber || "").trim();
  if (quote && String(quote.status || "").trim().toLowerCase() === "booked" && contractNumber) {
    const versionNumber = Number(quote.latestVersionNumber);
    return {
      phase: "receipt",
      quoteId: normalizedQuoteId,
      approvalRequestId: "",
      requiresApproval: false,
      error: "",
      receipt: {
        contractNumber,
        status: "booked",
        versionNumber: Number.isSafeInteger(versionNumber) && versionNumber > 0
          ? versionNumber
          : 0,
        source: "canonical_history"
      }
    };
  }
  return createContractConversionMutationState(normalizedQuoteId);
}

export function formatQuoteHistoryDate(iso) {
  return formatWorkspaceDate(iso, { emptyLabel: "Date not recorded" });
}

export function getQuoteHistoryFinancialCells(quote = {}) {
  return {
    total: currency(quote.totals?.total),
    deposit: currency(quote.totals?.deposit)
  };
}

export function getAmbientQuoteSourceFreshness({
  source = "",
  complete = false,
  loading = false,
  stale = false,
  loadedAtISO = "",
  error = ""
} = {}) {
  const observedAt = String(loadedAtISO || "").trim();
  const sourceLabel = String(source || "").trim().toLowerCase() === "firebase"
    ? "Firestore quote history"
    : "quote history";

  if (complete && !loading && !stale && !error && observedAt) {
    return {
      state: "fresh",
      observedAt,
      reason: `This exact quote came from the latest completed ${sourceLabel} read.`
    };
  }

  if (complete && observedAt && (loading || stale || error)) {
    return {
      state: "stale",
      observedAt,
      reason: loading
        ? `A prior ${sourceLabel} snapshot remains visible while QuotePilot refreshes it.`
        : `A prior ${sourceLabel} snapshot remains visible because the latest read did not complete successfully.`
    };
  }

  return {
    state: "unknown",
    reason: `A completed ${sourceLabel} observation is not available yet.`
  };
}

export function isExactQuoteAdministrationArrival({ arrivalContext, focusQuoteId } = {}) {
  const exactQuoteId = String(focusQuoteId || "").trim();
  const objectType = String(arrivalContext?.object?.type || "").trim();
  const expectedIntent = {
    opportunity: "review_quote_controls",
    "payment-evidence": "review_payment_controls",
    "customer-decision-artifact": "review_proposal_controls"
  }[objectType] || "";
  return Boolean(
    exactQuoteId
    && arrivalContext?.destination === "administration"
    && arrivalContext?.surfaceId === "quote-administration"
    && arrivalContext?.focusConsumerState === "supported"
    && String(arrivalContext?.object?.id || "").trim() === exactQuoteId
    && String(arrivalContext?.focus?.quoteId || "").trim() === exactQuoteId
    && arrivalContext?.intentId === expectedIntent
  );
}

const fmtDate = formatQuoteHistoryDate;

function canConvertToContract(quote) {
  const status = String(quote?.status || "");
  const hasContract = Boolean(String(quote?.booking?.contractNumber || "").trim());
  return status === "accepted" || (status === "booked" && !hasContract);
}

export function isFinalBalanceRequestEligible(quote) {
  const finalBalance = quote?.payment?.finalBalance || {};
  const amountCents = Number(finalBalance.amountCents);
  return String(quote?.status || "").trim().toLowerCase() === "booked"
    && Boolean(String(quote?.booking?.contractNumber || "").trim())
    && Boolean(String(quote?.booking?.contractConvertedAtISO || "").trim())
    && String(quote?.payment?.depositStatus || "").trim().toLowerCase() === "paid"
    && /^cs_[A-Za-z0-9_]+$/.test(String(quote?.payment?.stripeSessionId || "").trim())
    && Boolean(String(quote?.payment?.depositConfirmedAtISO || "").trim())
    && Number.isSafeInteger(amountCents)
    && amountCents > 0
    && String(finalBalance.status || "unpaid").trim().toLowerCase() !== "paid";
}

export function getFinalBalanceDisplayStatus(finalBalance = {}) {
  const status = String(finalBalance.status || "unpaid").trim().toLowerCase();
  const checkoutState = String(finalBalance.stripeCheckoutState || "")
    .trim()
    .toLowerCase();
  if (status === "paid") return "paid";
  if (["prepared", "processing", "failed", "expired"].includes(checkoutState)) {
    return checkoutState;
  }
  return ["unpaid", "sent"].includes(status) ? status : "unpaid";
}

export function getQuoteHistoryStatusSemantics(quote = {}) {
  const finalBalanceDisplayStatus = getFinalBalanceDisplayStatus(
    quote?.payment?.finalBalance
  );
  return {
    lifecycle: classifyQuoteStatus(quote?.status || "draft"),
    bookingConfirmation: classifyBookingConfirmation(
      quote?.booking?.confirmationStatus || "pending"
    ),
    deposit: classifyDepositStatus(quote?.payment?.depositStatus || "unpaid"),
    finalBalance: classifyFinalBalanceDisplayStatus(finalBalanceDisplayStatus),
    finalBalanceDisplayStatus
  };
}

export function getExecutableApprovalRequest(quote, action, options = {}) {
  const requests = Array.isArray(quote?.workflow?.approvalRequests)
    ? quote.workflow.approvalRequests
    : [];
  return requests.find((request) => {
    const executionState = String(request?.executionState || "").trim().toLowerCase();
    const canResumePaymentRequest = RESUMABLE_PAYMENT_APPROVAL_ACTIONS.has(action)
      && executionState === "in_progress";
    const expectedPaymentKind = action === "send_final_balance_request"
      ? "final_balance"
      : "deposit";
    const hasPaymentScope = !RESUMABLE_PAYMENT_APPROVAL_ACTIONS.has(action) || (
      String(request?.actionScope?.paymentKind || "").trim().toLowerCase()
        === expectedPaymentKind
      && Number.isSafeInteger(Number(request?.actionScope?.amountCents))
      && Number(request.actionScope.amountCents) > 0
      && /^[a-f0-9]{64}$/.test(String(request?.actionScopeDigest || "").trim().toLowerCase())
    );
    const structurallyExecutable = request?.action === action
      && request?.state === "approved"
      && hasPaymentScope
      && (!executionState || executionState === "awaiting_execution" || canResumePaymentRequest);
    return structurallyExecutable && (
      options?.validateCurrentEligibility !== true
      || getApprovalRequestExecutionEligibility(quote, request, options).eligible
    );
  }) || null;
}

function statusBucket(status) {
  const normalized = String(status || "draft").trim().toLowerCase();
  if (normalized === "draft") return "draft";
  if (["sent", "viewed", "accepted"].includes(normalized)) return "submitted";
  if (["booked", "declined", "expired"].includes(normalized)) return "archived";
  return normalized;
}

export function filterQuoteHistoryQuotes(quotes, {
  query = "",
  eventTypeFilter = "all",
  statusFilter = "all"
} = {}) {
  const normalizedQuery = String(query || "").trim().toLowerCase();
  return (Array.isArray(quotes) ? quotes : []).filter((quote) => {
    const statusMatch = statusFilter === "all"
      || statusBucket(quote.status || "draft") === statusFilter;
    if (!statusMatch) return false;

    const quoteEventType = String(quote.eventTypeId || quote.selection?.eventTypeId || "").trim();
    if (eventTypeFilter !== "all" && quoteEventType !== eventTypeFilter) return false;
    if (!normalizedQuery) return true;

    return [
      quote.customerNameKey,
      quote.customer?.name,
      quote.customer?.email,
      quote.quoteNumber,
      quote.event?.name
    ]
      .filter(Boolean)
      .join(" ")
      .toLowerCase()
      .includes(normalizedQuery);
  });
}

function isPortalExpired(quote) {
  const expiry = String(quote?.portalExpiresAtISO || quote?.expiresAtISO || "").trim();
  if (!expiry) return true;
  const dt = new Date(expiry);
  if (Number.isNaN(dt.getTime())) return true;
  return dt.getTime() <= Date.now();
}

function hasCurrentProviderAcceptance(quote) {
  try {
    const revisionId = resolveQuoteDeliveryRevisionId(quote);
    const delivery = quote?.workflow?.quoteDelivery || {};
    const portalKey = String(quote?.portalKey || "").trim();
    const portalIssuedAtISO = String(quote?.portalIssuedAtISO || "").trim();
    return delivery.revisionId === revisionId
      && String(delivery.state || "").trim().toLowerCase() === "provider_accepted"
      && String(delivery.portalActivationState || "").trim().toLowerCase() === "active"
      && String(delivery.providerMessageId || "").trim().length > 0
      && String(delivery.portalKey || "").trim() === portalKey
      && String(delivery.portalIssuedAtISO || "").trim() === portalIssuedAtISO;
  } catch {
    return false;
  }
}

export function isCustomerPortalShareable(quote, { requireDeliveryEvidence = false } = {}) {
  const status = String(quote?.status || "draft").trim().toLowerCase();
  const portalKey = String(quote?.portalKey || "").trim();
  return ["sent", "viewed", "accepted", "declined", "booked"].includes(status)
    && portalKey.length >= 20
    && !isPortalExpired(quote)
    && (!requireDeliveryEvidence || hasCurrentProviderAcceptance(quote));
}

const DELIVERY_RETRY_WINDOW_MS = 23 * 60 * 60 * 1000;

function deliveryTimestampMs(value) {
  const parsed = Date.parse(String(value || "").trim());
  return Number.isFinite(parsed) ? parsed : 0;
}

export function getQuoteDeliveryUiState(quote, revisionId, nowMs = Date.now()) {
  const delivery = quote?.workflow?.quoteDelivery || {};
  const matchesRevision = Boolean(
    revisionId && String(delivery.revisionId || "").trim() === revisionId
  );
  if (!matchesRevision) {
    return {
      state: "",
      recorded: false,
      mutationLocked: false,
      activeLease: false,
      retryAvailable: false,
      freshAttemptAvailable: false,
      reviewRequired: false,
      reviewAvailable: false,
      canAttempt: true
    };
  }
  const state = String(delivery.state || "").trim().toLowerCase();
  const leaseExpiresAtMs = deliveryTimestampMs(delivery.leaseExpiresAtISO);
  const firstAttemptAtMs = deliveryTimestampMs(delivery.firstAttemptAtISO || delivery.startedAtISO);
  const explicitRetryDeadlineMs = deliveryTimestampMs(delivery.retryDeadlineAtISO);
  const retryDeadlineMs = explicitRetryDeadlineMs
    || (firstAttemptAtMs ? firstAttemptAtMs + DELIVERY_RETRY_WINDOW_MS : 0);
  const activeLease = state === "sending" && leaseExpiresAtMs > nowMs;
  const retryWindowOpen = !retryDeadlineMs || retryDeadlineMs > nowMs;
  const recorded = state === "provider_accepted";
  const reviewRequired = state === "outcome_unknown"
    || (["sending", "outcome_ambiguous"].includes(state)
      && !activeLease
      && !retryWindowOpen);
  const freshAttemptAvailable = state === "failed" && !retryWindowOpen;
  const retryAvailable = !reviewRequired
    && !activeLease
    && (
      state === "failed"
      || (retryWindowOpen && ["sending", "outcome_ambiguous"].includes(state))
    );
  const reviewAvailable = reviewRequired
    || (!activeLease && ["sending", "outcome_ambiguous"].includes(state));
  const canAttempt = !recorded
    && !activeLease
    && !reviewRequired
    && ["", "sending", "outcome_ambiguous", "failed", "reconciled_not_sent"].includes(state);
  return {
    state,
    recorded,
    mutationLocked: ["sending", "outcome_ambiguous", "outcome_unknown"].includes(state),
    activeLease,
    retryAvailable,
    freshAttemptAvailable,
    reviewRequired,
    reviewAvailable,
    canAttempt
  };
}

export { getQuoteActionPermissions as getQuoteHistoryActionPermissions };

export function getQuoteHistoryKitchenBeoMode(source = "") {
  const normalizedSource = String(source || "").trim().toLowerCase();
  if (normalizedSource === "firebase") {
    return {
      authority: "server_authoritative",
      action: "open-authoritative",
      label: "Kitchen BEO status",
      title: "Review server-derived freshness and generate a Kitchen BEO with an immutable receipt."
    };
  }
  if (normalizedSource === "local") {
    return {
      authority: "local_non_authoritative",
      action: "export-local",
      label: "Local BEO — no receipt",
      title: "Non-authoritative local fallback: creates a browser PDF without a server generation receipt or freshness status."
    };
  }
  return {
    authority: "unavailable",
    action: "none",
    label: "Kitchen BEO unavailable",
    title: "Quote storage authority is not available. Refresh Quotes before generating an artifact."
  };
}

export function QuoteHistoryKitchenBeoAction({
  source = "",
  quote = null,
  disabled = false,
  disabledReason = "",
  exportingLocal = false,
  onOpenAuthoritative,
  onExportLocal
}) {
  const mode = getQuoteHistoryKitchenBeoMode(source);
  const handler = mode.action === "open-authoritative"
    ? onOpenAuthoritative
    : mode.action === "export-local"
      ? onExportLocal
      : null;
  const unavailable = typeof handler !== "function" || mode.action === "none";
  return (
    <button
      type="button"
      className="ghost compact"
      data-beo-authority={mode.authority}
      data-capability-action={mode.action === "open-authoritative"
        ? "open-kitchen-beo"
        : mode.action === "export-local"
          ? "export-local-kitchen-beo"
          : undefined}
      aria-haspopup={mode.action === "open-authoritative" ? "dialog" : undefined}
      onClick={() => handler?.(quote)}
      disabled={disabled || exportingLocal || unavailable}
      title={disabledReason || mode.title}
    >
      {exportingLocal ? "Generating local BEO…" : mode.label}
    </button>
  );
}

export function canRotateQuotePortal(status) {
  return ["draft", "sent", "viewed", "accepted", "booked"].includes(
    String(status || "draft").trim().toLowerCase()
  );
}

export function canDeliverQuoteEmailStatus(status) {
  return ["draft", "sent", "viewed", "accepted", "booked"].includes(
    String(status || "draft").trim().toLowerCase()
  );
}

export function canEditQuoteStatus(status) {
  return ["draft", "sent", "viewed"].includes(
    String(status || "draft").trim().toLowerCase()
  );
}

export function assertRebookArtifactReady(quote = {}, options = {}) {
  const gate = getRebookDeliveryGate(quote, options);
  if (!gate.ready) {
    const error = new Error(gate.message);
    error.code = "failed-precondition";
    throw error;
  }
  return true;
}

function quoteHistoryReadKey({ organizationId = "", focusQuoteId = "", focusAction = "" } = {}) {
  return [organizationId, focusQuoteId, focusAction]
    .map((value) => String(value || "").trim())
    .join("\u0000");
}

export function QuoteHistoryView({
  open,
  onClose,
  onCloseBlocked = null,
  presentation = "embedded",
  basePortalUrl = "",
  organizationId = "",
  currentUserUid = "",
  currentUserEmail = "",
  currentUserRole = "customer",
  attendanceEnabled = false,
  tenantTimeZone = "",
  focusQuoteId = "",
  focusAction = "",
  focusReason = "",
  arrivalContext = null,
  onArrivalResolution = null,
  onEditQuote,
  serviceStyles = [],
  onPreviewQuickUpdate,
  onSaveQuickUpdate,
  onOpenQuickUpdatesLibrary,
  onQuickUpdatesGuardChange,
  ambientPricingCatalog = null,
  ambientPricingSettings = null,
  inquiryShowcaseEnabled = false,
  globalPilotRequest = null,
  globalPilotReturnFocusRef = null,
  onGlobalPilotResolution = null,
  onBackToQuotes,
  onOpenSchedule,
  scheduleAvailable = false,
  onOpenCustomer,
  onOpenOpportunity,
  onOpenWorkflow,
  onOpenConversation,
  onOpenQuoteAdministration,
  onOpenIntegrations,
  integrationsAvailable = true,
  canDeleteQuotes = false,
  onStartOpportunity,
  onToast
}) {
  const workspaceNavigation = useOptionalWorkspaceNavigation();
  const embedded = presentation === "embedded";
  const administrationFocusActive = Boolean(
    embedded
    && String(focusQuoteId || "").trim()
    && String(focusAction || "").trim() === "administration"
  );
  const detailMode = embedded
    && Boolean(String(focusQuoteId || "").trim())
    && !administrationFocusActive;
  const [state, setState] = useState({
    loading: false,
    source: "",
    error: "",
    readError: "",
    feedback: "",
    quotes: [],
    truncated: false,
    readComplete: false,
    loadedAtISO: "",
    organizationId: "",
    readKey: ""
  });
  const stateRef = useRef(state);
  stateRef.current = state;
  const [emailSetup, setEmailSetup] = useState({
    loading: false,
    checked: false,
    configured: false,
    provider: "",
    error: ""
  });
  const [query, setQuery] = useState("");
  const initialQuoteFilters = quoteFiltersFromSearch(workspaceNavigation?.location?.search);
  const [eventTypeFilter, setEventTypeFilter] = useState(initialQuoteFilters.eventTypeFilter);
  const [eventTypes, setEventTypes] = useState([]);
  const [eventTypesReady, setEventTypesReady] = useState(false);
  const [eventTypesError, setEventTypesError] = useState("");
  const [eventTypesRetryNonce, setEventTypesRetryNonce] = useState(0);
  const [statusFilter, setStatusFilter] = useState(initialQuoteFilters.statusFilter);
  const [administrationOpen, setAdministrationOpen] = useState(Boolean(administrationFocusActive));
  const filterOrganizationIdRef = useRef(String(organizationId || "").trim());
  const [updatingId, setUpdatingId] = useState("");
  const [convertingId, setConvertingId] = useState("");
  const [contractConversions, setContractConversions] = useState({});
  const [updatingConfirmationId, setUpdatingConfirmationId] = useState("");
  const [duplicatingId, setDuplicatingId] = useState("");
  const [exportingPdfId, setExportingPdfId] = useState("");
  const [exportingLocalBeoId, setExportingLocalBeoId] = useState("");
  const [sendingQuoteEmailId, setSendingQuoteEmailId] = useState("");
  const [sendingPaymentEmailId, setSendingPaymentEmailId] = useState("");
  const [sendingFinalBalanceEmailId, setSendingFinalBalanceEmailId] = useState("");
  const [reconcilingPaymentId, setReconcilingPaymentId] = useState("");
  const [reconcilingFinalBalanceId, setReconcilingFinalBalanceId] = useState("");
  const [reopeningQuoteId, setReopeningQuoteId] = useState("");
  const [rotatingPortalId, setRotatingPortalId] = useState("");
  const [pendingDeleteQuote, setPendingDeleteQuote] = useState(null);
  const [deliveryReview, setDeliveryReview] = useState(null);
  const [resolvingDeliveryId, setResolvingDeliveryId] = useState("");
  const [conversationQuote, setConversationQuote] = useState(null);
  const [kitchenBeoQuote, setKitchenBeoQuote] = useState(null);
  const [focusedDecisionDebtRead, setFocusedDecisionDebtRead] = useState(null);
  const handleFocusedDecisionDebtRead = useCallback((nextRead) => {
    setFocusedDecisionDebtRead(nextRead && typeof nextRead === "object" ? nextRead : null);
  }, []);
  const kitchenBeoQuoteRef = useRef(null);
  const [deliveryClockMs, setDeliveryClockMs] = useState(() => Date.now());
  const dialogRef = useRef(null);
  const routeHeadingRef = useWorkspaceRouteHeadingFocus(Boolean(open && embedded));
  const savedQuoteHandoffRef = useRef(null);
  const deliveryReviewRef = useRef(null);
  const deliveryReviewReturnFocusRef = useRef(null);
  const kitchenBeoReturnFocusRef = useRef(null);
  const deliveryReviewStateRef = useRef(null);
  const focusedHandoffIdRef = useRef("");
  const loadedFocusQuoteIdRef = useRef("");
  const loadGenerationRef = useRef(0);
  const targetLoadPendingRef = useRef(false);
  const returnRestoreCancelRef = useRef(null);
  const onCloseRef = useRef(onClose);
  const onCloseBlockedRef = useRef(onCloseBlocked);
  const quoteHistoryCloseGuardRef = useRef(buildQuoteHistoryCloseGuard());

  const quoteHistoryCloseGuard = buildQuoteHistoryCloseGuard({
    conversationQuote,
    contractConversions
  });
  quoteHistoryCloseGuardRef.current = quoteHistoryCloseGuard;

  useEffect(() => {
    onCloseRef.current = onClose;
    onCloseBlockedRef.current = onCloseBlocked;
  }, [onClose, onCloseBlocked]);
  useEffect(() => {
    if (!open || detailMode || workspaceNavigation?.route?.routeId !== "quote-list") return;
    const next = quoteFiltersFromSearch(workspaceNavigation.location?.search);
    setEventTypeFilter(next.eventTypeFilter);
    setStatusFilter(next.statusFilter);
    if (next.needsCanonicalization && typeof workspaceNavigation?.replace === "function") {
      workspaceNavigation.replace(`/app/quotes${next.canonicalSearch}`, {
        state: workspaceNavigation.location?.state ?? null,
        preserveSearch: false,
        preserveHash: false
      });
    }
  }, [
    detailMode,
    open,
    workspaceNavigation?.location?.search,
    workspaceNavigation?.location?.state,
    workspaceNavigation?.replace,
    workspaceNavigation?.route?.routeId
  ]);
  const updateQuoteFilterLocation = useCallback((nextEventType, nextStatus) => {
    if (typeof workspaceNavigation?.replace !== "function") return;
    const params = new URLSearchParams();
    if (nextEventType && nextEventType !== "all") params.set("eventType", nextEventType);
    if (nextStatus && nextStatus !== "all") params.set("status", nextStatus);
    const search = params.toString();
    workspaceNavigation.replace(`/app/quotes${search ? `?${search}` : "?"}`, {
      state: workspaceNavigation.location?.state ?? null,
      preserveSearch: false,
      preserveHash: false
    });
  }, [workspaceNavigation]);
  deliveryReviewStateRef.current = deliveryReview;
  kitchenBeoQuoteRef.current = kitchenBeoQuote;

  useEffect(() => {
    if (open) return;
    const closeGuard = quoteHistoryCloseGuardRef.current;
    if (shouldRestoreBlockedQuoteHistoryRoute({ open, closeGuard })) {
      setState((current) => ({ ...current, error: closeGuard.message }));
      onCloseBlockedRef.current?.(closeGuard.message);
      return;
    }
    setDeliveryReview(null);
    setConversationQuote(null);
    setKitchenBeoQuote(null);
    setContractConversions({});
    deliveryReviewReturnFocusRef.current = null;
    kitchenBeoReturnFocusRef.current = null;
  }, [open]);

  useEffect(() => {
    if (!open || !quoteHistoryCloseGuard.blocked || typeof window === "undefined") {
      return undefined;
    }
    const protectPendingQuoteWork = (event) => {
      event.preventDefault();
      event.returnValue = "";
    };
    window.addEventListener("beforeunload", protectPendingQuoteWork);
    return () => window.removeEventListener("beforeunload", protectPendingQuoteWork);
  }, [open, quoteHistoryCloseGuard.blocked]);

  useEffect(() => {
    if (!open) return undefined;
    setDeliveryClockMs(Date.now());
    const timer = window.setInterval(() => setDeliveryClockMs(Date.now()), 10_000);
    return () => window.clearInterval(timer);
  }, [open]);

  useEffect(() => {
    if (!open || embedded) return undefined;
    const previousBodyOverflow = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    const focusFrame = window.requestAnimationFrame(() => dialogRef.current?.focus());
    const handleDialogKeyDown = (event) => {
      if (event.key === "Escape") {
        event.preventDefault();
        if (kitchenBeoQuoteRef.current) {
          setKitchenBeoQuote(null);
        } else {
          const closeGuard = quoteHistoryCloseGuardRef.current;
          if (closeGuard.blocked) {
            setState((current) => ({
              ...current,
              error: closeGuard.message
            }));
          } else if (deliveryReviewStateRef.current) {
            setDeliveryReview(null);
            const returnTarget = deliveryReviewReturnFocusRef.current;
            window.requestAnimationFrame(() => {
              if (returnTarget?.isConnected) {
                returnTarget.focus();
              } else {
                savedQuoteHandoffRef.current?.focus();
              }
            });
          } else {
            setDeliveryReview(null);
            onCloseRef.current?.();
          }
        }
        return;
      }
      if (event.key !== "Tab") return;
      const focusable = Array.from(dialogRef.current?.querySelectorAll(
        'a[href], button:not([disabled]), input:not([disabled]), select:not([disabled]), textarea:not([disabled]), [tabindex]:not([tabindex="-1"])'
      ) || []).filter((element) => element.getClientRects().length > 0);
      if (!focusable.length) {
        event.preventDefault();
        dialogRef.current?.focus();
        return;
      }
      const first = focusable[0];
      const last = focusable[focusable.length - 1];
      if (event.shiftKey && (document.activeElement === first || !dialogRef.current?.contains(document.activeElement))) {
        event.preventDefault();
        last.focus();
      } else if (
        !event.shiftKey
        && (
          document.activeElement === last
          || !dialogRef.current?.contains(document.activeElement)
        )
      ) {
        event.preventDefault();
        first.focus();
      }
    };
    document.addEventListener("keydown", handleDialogKeyDown);
    return () => {
      window.cancelAnimationFrame(focusFrame);
      document.removeEventListener("keydown", handleDialogKeyDown);
      document.body.style.overflow = previousBodyOverflow;
    };
  }, [embedded, open]);

  useEffect(() => {
    loadGenerationRef.current += 1;
    focusedHandoffIdRef.current = "";
    loadedFocusQuoteIdRef.current = "";
    targetLoadPendingRef.current = Boolean(open && focusQuoteId);
    if (!open) {
      return;
    }
    const requestedOrganizationId = String(organizationId || "").trim();
    if (filterOrganizationIdRef.current !== requestedOrganizationId) {
      filterOrganizationIdRef.current = requestedOrganizationId;
      setQuery("");
      setEventTypeFilter("all");
      setEventTypes([]);
      setEventTypesError("");
      setStatusFilter("all");
    }
    setState((prev) => (
      prev.organizationId === requestedOrganizationId
        ? {
            ...prev,
            loading: true,
            error: "",
            readError: "",
            feedback: ""
          }
        : {
            loading: true,
            source: "",
            error: "",
            readError: "",
            feedback: "",
            quotes: [],
            truncated: false,
            readComplete: false,
            loadedAtISO: "",
            organizationId: requestedOrganizationId
          }
    ));
  }, [open, focusQuoteId, focusAction, organizationId]);

  const pushToast = (message, tone = "info") => {
    if (typeof onToast === "function") {
      onToast(message, tone);
    }
  };

  const requestQuoteHistoryClose = () => {
    if (kitchenBeoQuote) {
      setKitchenBeoQuote(null);
      return;
    }
    const closeGuard = quoteHistoryCloseGuardRef.current;
    if (closeGuard.blocked) {
      setState((current) => ({ ...current, error: closeGuard.message }));
      return;
    }
    setDeliveryReview(null);
    onClose?.();
  };
  const approvalExecutionOptions = ({ allowInProgressRecovery = false } = {}) => ({
    validateCurrentEligibility: true,
    requireActivePortal: state.source === "firebase",
    allowInProgressRecovery
  });

  const load = async () => {
    const generation = loadGenerationRef.current + 1;
    loadGenerationRef.current = generation;
    const requestedFocusQuoteId = String(focusQuoteId || "").trim();
    const requestedOrganizationId = String(organizationId || "").trim();
    const requestedReadKey = quoteHistoryReadKey({
      organizationId: requestedOrganizationId,
      focusQuoteId: requestedFocusQuoteId,
      focusAction
    });
    const targetingSavedQuote = Boolean(
      requestedFocusQuoteId && targetLoadPendingRef.current
    );
    setState((prev) => (
      prev.organizationId === requestedOrganizationId
        ? { ...prev, loading: true, error: "", readError: "", feedback: "" }
        : {
            loading: true,
            source: "",
            error: "",
            readError: "",
            feedback: "",
            quotes: [],
            truncated: false,
            readComplete: false,
            loadedAtISO: "",
            organizationId: requestedOrganizationId,
            readKey: ""
          }
    ));
    try {
      const result = await getQuoteHistory({
        organizationId: requestedOrganizationId,
        persistExpiredStatuses: getQuoteActionPermissions(currentUserRole).role === "admin"
      });
      if (generation !== loadGenerationRef.current) return null;
      const targetFound = targetingSavedQuote
        && result.quotes.some((quote) => quote.id === requestedFocusQuoteId);
      if (targetingSavedQuote) {
        targetLoadPendingRef.current = false;
        loadedFocusQuoteIdRef.current = targetFound ? requestedFocusQuoteId : "";
      }
      const priorLoadedAt = Date.parse(stateRef.current.loadedAtISO || "");
      const nextLoadedAt = Math.max(
        Date.now(),
        Number.isFinite(priorLoadedAt) ? priorLoadedAt + 1 : 0
      );
      setState({
        loading: false,
        error: targetingSavedQuote && !targetFound
          ? "The saved quote could not be found in this organization's history. Refresh or save it again."
          : result.expiryPersistenceFailures?.length
            ? `${result.expiryPersistenceFailures.length} expired quote${result.expiryPersistenceFailures.length === 1 ? "" : "s"} remain display-only because the matching portal lifecycle could not be updated. Repair the portal projection and reload before reopening.`
            : "",
        readError: "",
        feedback: "",
        source: result.source,
        quotes: result.quotes,
        truncated: result.truncated === true,
        readComplete: true,
        loadedAtISO: new Date(nextLoadedAt).toISOString(),
        organizationId: requestedOrganizationId,
        readKey: requestedReadKey
      });
      return result;
    } catch (err) {
      if (generation !== loadGenerationRef.current) return null;
      if (targetingSavedQuote) targetLoadPendingRef.current = false;
      loadedFocusQuoteIdRef.current = "";
      setState((prev) => ({
        ...prev,
        loading: false,
        readComplete: true,
        readKey: requestedReadKey,
        error: err?.message || "Failed to load quote history.",
        readError: err?.message || "Failed to load quote history.",
        feedback: ""
      }));
      return null;
    }
  };

  useEffect(() => {
    if (!open) return;
    let alive = true;
    setEventTypesReady(false);
    setEventTypesError("");
    getEventTypes({ organizationId })
      .then((items) => {
        if (!alive) return;
        setEventTypes(items);
        setEventTypesReady(true);
        setEventTypesError("");
      })
      .catch(() => {
        if (!alive) return;
        setEventTypesReady(false);
        setEventTypesError(
          "Event type filters could not be refreshed. Your current selection is preserved; try again before changing this filter."
        );
      });
    return () => {
      alive = false;
    };
  }, [eventTypesRetryNonce, open, organizationId]);

  useEffect(() => {
    if (
      !open
      || detailMode
      || !eventTypesReady
      || eventTypeFilter === "all"
      || eventTypes.some((item) => String(item.id) === eventTypeFilter)
    ) return;
    setEventTypeFilter("all");
    updateQuoteFilterLocation("all", statusFilter);
  }, [
    detailMode,
    eventTypeFilter,
    eventTypes,
    eventTypesReady,
    open,
    statusFilter,
    updateQuoteFilterLocation
  ]);

  useEffect(() => {
    if (!open) return;
    const timer = setTimeout(() => load(), 0);
    return () => clearTimeout(timer);
  }, [open, focusQuoteId, focusAction, organizationId]);

  useEffect(() => {
    const canCheck = getQuoteActionPermissions(currentUserRole).role === "admin";
    if (!open || state.source !== "firebase" || !canCheck) {
      setEmailSetup({
        loading: false,
        checked: false,
        configured: false,
        provider: "",
        error: ""
      });
      return undefined;
    }
    let alive = true;
    setEmailSetup((prev) => ({ ...prev, loading: true, error: "" }));
    getIntegrationSetupStatus()
      .then((result) => {
        if (!alive) return;
        const email = result?.status?.email || {};
        setEmailSetup({
          loading: false,
          checked: true,
          configured: email.configured === true && email.providerSupported === true,
          provider: String(email.provider || "").trim().toLowerCase(),
          error: ""
        });
      })
      .catch((err) => {
        if (!alive) return;
        setEmailSetup({
          loading: false,
          checked: true,
          configured: false,
          provider: "",
          error: err?.message || "Email provider configuration could not be checked."
        });
      });
    return () => {
      alive = false;
    };
  }, [open, state.source, organizationId, currentUserRole]);

  useEffect(() => {
    if (!open || !focusQuoteId || state.loading) return;
    const returnStatus = workspaceNavigation?.returnContextStatus;
    const returnFocusOwnsEntry = ["restoring", "restored"].includes(returnStatus?.state)
      && returnStatus?.entryId === workspaceNavigation?.location?.historyEntry?.entryId;
    if (returnFocusOwnsEntry) return;
    const focusKey = `${focusQuoteId}:${String(focusAction || "").trim()}`;
    if (focusedHandoffIdRef.current === focusKey) return;
    const normalizedAction = String(focusAction || "").trim();
    const administrationArrival = normalizedAction === "administration"
      && arrivalContext?.surfaceId === "quote-administration";
    const exactAdministrationArrival = !administrationArrival
      || isExactQuoteAdministrationArrival({ arrivalContext, focusQuoteId });
    if (administrationArrival && !exactAdministrationArrival) {
      focusedHandoffIdRef.current = focusKey;
      onArrivalResolution?.({
        status: "recovery",
        reason: "The requested quote controls do not match this exact workspace record.",
        consequence: "No alternate quote or control set was selected and no record changed.",
        nextResolution: "Return to the originating opportunity and reopen the exact Payment or Proposal action."
      });
      return;
    }
    if (loadedFocusQuoteIdRef.current !== focusQuoteId) {
      if (administrationArrival && state.readComplete && !state.quotes.some((quote) => quote.id === focusQuoteId)) {
        focusedHandoffIdRef.current = focusKey;
        onArrivalResolution?.({
          status: "recovery",
          reason: "The exact quote is not present in the completed Quote history read.",
          consequence: "No alternate quote was substituted and no proposal or payment control ran.",
          nextResolution: "Return to the originating opportunity, refresh current quote evidence, and retry."
        });
      }
      return;
    }
    const targetQuote = state.quotes.find((quote) => quote.id === focusQuoteId);
    if (!targetQuote) return;
    if (normalizedAction === "administration") {
      const frame = window.requestAnimationFrame(() => {
        const administrationSummary = dialogRef.current?.querySelector(
          '[data-quote-administration="true"] > summary'
        );
        if (!administrationSummary) return;
        administrationSummary.focus({ preventScroll: true });
        administrationSummary.scrollIntoView({ block: "start", inline: "nearest" });
        if (administrationArrival && document.activeElement === administrationSummary) {
          onArrivalResolution?.({ status: "resolved", quoteId: focusQuoteId });
        }
        focusedHandoffIdRef.current = focusKey;
      });
      return () => window.cancelAnimationFrame(frame);
    }
    if (normalizedAction === "conversation") {
      const focusedConversation = resolveFocusedConversationQuote({
        focusAction: normalizedAction,
        focusQuoteId,
        quotes: state.quotes,
        conversationQuote
      });
      if (focusedConversation) {
        setConversationQuote(focusedConversation);
        focusedHandoffIdRef.current = focusKey;
      } else if (conversationQuote?.id === targetQuote.id) {
        focusedHandoffIdRef.current = focusKey;
      }
      return;
    }
    const frame = window.requestAnimationFrame(() => {
      const handoff = savedQuoteHandoffRef.current;
      if (!handoff || handoff.dataset.quoteId !== focusQuoteId) return;
      const targetRow = Array.from(dialogRef.current?.querySelectorAll("tr[data-quote-id]") || [])
        .find((row) => row.dataset.quoteId === focusQuoteId);
      const actionTarget = normalizedAction
        ? Array.from(targetRow?.querySelectorAll("button[data-approval-action]") || [])
          .find((button) => button.dataset.approvalAction === normalizedAction && !button.disabled)
        : null;
      const actionDisclosure = actionTarget?.closest("details.configured-quote-more-actions");
      if (actionDisclosure && !actionDisclosure.open) actionDisclosure.open = true;
      const focusTarget = actionTarget || handoff;
      focusTarget.focus({ preventScroll: true });
      focusTarget.scrollIntoView({ block: "nearest", inline: "nearest" });
      focusedHandoffIdRef.current = focusKey;
    });
    return () => window.cancelAnimationFrame(frame);
  }, [
    open,
    focusQuoteId,
    focusAction,
    state.loading,
    state.readComplete,
    state.quotes,
    conversationQuote,
    arrivalContext,
    onArrivalResolution,
    workspaceNavigation?.location?.historyEntry?.entryId,
    workspaceNavigation?.returnContextStatus
  ]);

  useEffect(() => {
    if (!deliveryReview) return undefined;
    const frame = window.requestAnimationFrame(() => {
      deliveryReviewRef.current?.focus({ preventScroll: true });
      deliveryReviewRef.current?.scrollIntoView({ block: "nearest" });
    });
    return () => window.cancelAnimationFrame(frame);
  }, [deliveryReview?.quoteId]);

  const ambientOpportunityReadBoundary = useMemo(() => ({
    complete: state.readComplete,
    loading: state.loading,
    partial: false,
    stale: Boolean(state.readError && state.readComplete),
    truncated: state.truncated,
    truncationKnown: state.readComplete,
    loadedAtISO: state.loadedAtISO,
    error: state.readError
  }), [
    state.loadedAtISO,
    state.loading,
    state.readComplete,
    state.readError,
    state.truncated
  ]);
  const ambientQuoteSourceFreshness = useMemo(() => getAmbientQuoteSourceFreshness({
    ...ambientOpportunityReadBoundary,
    source: state.source
  }), [ambientOpportunityReadBoundary, state.source]);

  const captureQuoteReturnView = useCallback((hint = {}) => {
    const root = dialogRef.current;
    const activeElement = typeof document !== "undefined" ? document.activeElement : null;
    const hintedFocus = hint?.focus && typeof hint.focus === "object" ? hint.focus : null;
    if (detailMode) {
      return {
        routeId: "quote-detail",
        scrollY: typeof window !== "undefined" ? window.scrollY : 0,
        focus: hintedFocus || {
          kind: "quick-updates",
          objectId: String(focusQuoteId || ""),
          actionId: "open-quick-updates"
        }
      };
    }
    if (
      eventTypeFilter !== "all"
      && (
        !eventTypesReady
        || !eventTypes.some((item) => String(item.id) === eventTypeFilter)
      )
    ) return null;
    const openOpportunityIds = Array.from(
      root?.querySelectorAll('[data-opportunity-disclosure="details"][open]') || []
    ).map((details) => details.closest("[data-opportunity-id]")?.dataset.opportunityId).filter(Boolean);
    const disclosureIds = [
      ...openOpportunityIds,
      ...(root?.querySelector(".ambient-opportunities__boundary[open]") ? ["read-boundary"] : []),
      ...(administrationOpen ? ["quote-administration"] : [])
    ];
    let focus = hintedFocus;
    if (!focus && activeElement && root?.contains(activeElement)) {
      const row = activeElement.closest?.("[data-opportunity-id]");
      const actionId = activeElement.dataset?.ambientActionId || "";
      if (row?.dataset.opportunityId && actionId) {
        focus = {
          kind: "opportunity-action",
          objectId: row.dataset.opportunityId,
          actionId,
          controlId: row.dataset.requestId || "",
          attentionType: row.dataset.attentionType || ""
        };
      } else if (activeElement.matches?.('[data-opportunity-disclosure="details"] > summary')) {
        focus = {
          kind: "opportunity-disclosure",
          objectId: row?.dataset.opportunityId || ""
        };
      }
    }
    return {
      routeId: "quote-list",
      structured: { eventTypeFilter, statusFilter, order: "priority" },
      transient: { query, sourceLoadedAtISO: stateRef.current.loadedAtISO },
      disclosureIds,
      scrollY: typeof window !== "undefined" ? window.scrollY : 0,
      focus: focus || { kind: "route-heading" }
    };
  }, [
    administrationOpen,
    detailMode,
    eventTypeFilter,
    eventTypes,
    eventTypesReady,
    focusQuoteId,
    query,
    statusFilter
  ]);

  const restoreQuoteReturnView = useCallback((view) => {
    returnRestoreCancelRef.current?.();
    const requiredLoadedAtISO = String(view?.transient?.sourceLoadedAtISO || "");
    if (view?.routeId === "quote-list") {
      setQuery(String(view.transient?.query || ""));
      setEventTypeFilter(String(view.structured?.eventTypeFilter || "all"));
      setStatusFilter(String(view.structured?.statusFilter || "all"));
      setAdministrationOpen(view.disclosureIds?.includes("quote-administration") || false);
      void load();
    }
    const expectedReadKey = quoteHistoryReadKey({
      organizationId,
      focusQuoteId,
      focusAction
    });
    return new Promise((resolve) => {
      let attempt = 0;
      let active = true;
      let settled = false;
      let frameId = null;
      let cancelViewport = null;
      const finish = (status) => {
        if (settled) return;
        settled = true;
        resolve({ status });
      };
      const cancel = () => {
        active = false;
        if (frameId !== null) window.cancelAnimationFrame(frameId);
        cancelViewport?.();
        finish("cancelled");
      };
      returnRestoreCancelRef.current = cancel;
      const restoreRenderedView = () => {
        if (!active) return;
        const root = dialogRef.current;
        if (!root) {
          finish("recovery");
          return;
        }
        if (view?.routeId === "quote-list") {
          const openIds = new Set(view.disclosureIds || []);
          root.querySelectorAll('[data-opportunity-disclosure="details"]').forEach((details) => {
            const quoteId = details.closest("[data-opportunity-id]")?.dataset.opportunityId || "";
            details.open = openIds.has(quoteId);
          });
          const boundary = root.querySelector(".ambient-opportunities__boundary");
          if (boundary) boundary.open = openIds.has("read-boundary");
        }
        const focus = view?.focus || {};
        let target = null;
        if (focus.kind === "opportunity-action") {
          target = Array.from(root.querySelectorAll("[data-ambient-action-id]")).find((element) => (
            element.dataset.ambientActionId === focus.actionId
            && element.closest("[data-opportunity-id]")?.dataset.opportunityId === focus.objectId
          ));
          if (!target) {
            const sameOpportunity = Array.from(root.querySelectorAll("[data-opportunity-id]")).find((element) => (
              element.dataset.opportunityId === focus.objectId
            ));
            target = sameOpportunity?.querySelector("[data-ambient-action-id]") || null;
          }
        } else if (focus.kind === "opportunity-disclosure") {
          target = Array.from(root.querySelectorAll('[data-opportunity-disclosure="details"]')).find((element) => (
            element.closest("[data-opportunity-id]")?.dataset.opportunityId === focus.objectId
          ))?.querySelector("summary");
        } else if (focus.kind === "quick-updates") {
          const placement = window.matchMedia?.("(max-width: 620px)")?.matches
            ? "ambient-quick-updates-trigger--mobile"
            : "ambient-quick-updates-trigger--context";
          target = Array.from(root.querySelectorAll("[data-ambient-action-id=\"open-quick-updates\"]")).find((element) => (
            element.classList.contains(placement)
          ));
        } else {
          target = root.querySelector(".workspace-route-heading");
        }
        const baseReadSettled = stateRef.current.organizationId === String(organizationId || "").trim()
          && stateRef.current.readKey === expectedReadKey
          && stateRef.current.readComplete === true
          && stateRef.current.loading === false;
        if (baseReadSettled && stateRef.current.readError) {
          cancelViewport = restoreWorkspaceReturnViewport({
            focusTarget: root.querySelector(".workspace-route-heading"),
            scrollY: 0
          });
          finish("recovery");
          return;
        }
        const readSettled = baseReadSettled
          && (!requiredLoadedAtISO || stateRef.current.loadedAtISO !== requiredLoadedAtISO);
        if (!readSettled) {
          attempt += 1;
          if (attempt > 90) {
            cancelViewport = restoreWorkspaceReturnViewport({
              focusTarget: root.querySelector(".workspace-route-heading"),
              scrollY: 0
            });
            finish("recovery");
            return;
          }
          frameId = window.requestAnimationFrame(restoreRenderedView);
          return;
        }
        if (!target && attempt < 30) {
          attempt += 1;
          frameId = window.requestAnimationFrame(restoreRenderedView);
          return;
        }
        frameId = null;
        const exactTarget = Boolean(target && readSettled);
        cancelViewport = restoreWorkspaceReturnViewport({
          focusTarget: target || root.querySelector(".workspace-route-heading"),
          scrollY: view?.scrollY
        });
        finish(exactTarget ? "restored" : "recovery");
      };
      if (typeof window !== "undefined") {
        frameId = window.requestAnimationFrame(restoreRenderedView);
      } else {
        finish("recovery");
      }
    });
  }, [focusAction, focusQuoteId, load, organizationId]);

  useEffect(() => {
    if (open) return undefined;
    returnRestoreCancelRef.current?.();
    returnRestoreCancelRef.current = null;
    return undefined;
  }, [open]);
  useEffect(() => () => {
    returnRestoreCancelRef.current?.();
  }, []);

  useWorkspaceReturnContextAdapter({
    routeId: detailMode ? "quote-detail" : "quote-list",
    active: Boolean(open),
    capture: captureQuoteReturnView,
    restore: restoreQuoteReturnView
  });

  // Keep the child conversation mounted across a blocked route transition so
  // its in-memory request identity cannot be destroyed before /app/quotes is
  // restored. Contract-conversion identities already live in this parent.
  if (!shouldRenderQuoteHistory({ open, closeGuard: quoteHistoryCloseGuard })) return null;

  const permissions = getQuoteActionPermissions(currentUserRole);
  const authorityCopy = permissions.role === "admin"
    ? "Admin can change quote, payment, booking, portal, and contract state."
    : permissions.role === "sales"
      ? "Sales can prepare proposal artifacts; admin authority is required to send provider email or change payment, booking, portal, and delete state."
      : "Customers can review portal content only; staff authority is required for quote history actions.";
  const normalizedCustomerQuery = query.trim().toLowerCase();
  const eventTypeNameById = new Map(
    (eventTypes || []).map((item) => [String(item.id), item.name])
  );
  const eventTypeFilterUnavailable = eventTypeFilter !== "all"
    && !eventTypes.some((item) => String(item.id) === eventTypeFilter);
  const eventTypeFilterOptions = (!eventTypesReady && eventTypes.length === 0)
    ? []
    : [
        ...(eventTypeFilterUnavailable && eventTypeFilter !== "all"
          ? [{
              value: eventTypeFilter,
              label: `${humanizeWorkspaceValue(eventTypeFilter)} (not in current event types)`,
              disabled: true
            }]
          : []),
        { value: "all", label: "All event types" },
        ...eventTypes.map((eventType) => ({
          value: String(eventType.id),
          label: String(eventType.name || eventType.id)
        }))
      ];
  const retryEventTypes = {
    label: "Retry event types",
    onClick: () => setEventTypesRetryNonce((current) => current + 1)
  };

  const administrationQuotes = administrationFocusActive
    ? state.quotes.filter((quote) => String(quote?.id || "") === String(focusQuoteId || ""))
    : state.quotes;
  const filteredQuotes = filterQuoteHistoryQuotes(administrationQuotes, {
    query,
    eventTypeFilter,
    statusFilter
  });
  const hasActiveFilters = Boolean(
    normalizedCustomerQuery
    || eventTypeFilter !== "all"
    || statusFilter !== "all"
  );
  const clearFilters = () => {
    setQuery("");
    setEventTypeFilter("all");
    setStatusFilter("all");
    updateQuoteFilterLocation("all", "all");
  };
  const quoteHistoryController = buildQuoteHistoryController({
    quotes: state.quotes,
    visibleQuoteIds: filteredQuotes.map((quote) => quote.id),
    focusQuoteId,
    currentUserRole,
    source: state.source
  });
  const focusedQuote = quoteHistoryController.eventRoom.quote;
  const focusedDecisionDebtSnapshot = state.source === "firebase"
    && focusedQuote
    && focusedDecisionDebtRead?.organizationId === String(organizationId || "").trim()
    && focusedDecisionDebtRead?.quoteId === String(focusedQuote.id || "").trim()
    && focusedDecisionDebtRead.loading === false
    && focusedDecisionDebtRead.stale === false
    && !focusedDecisionDebtRead.error
      ? focusedDecisionDebtRead.result
      : null;
  const focusedQuoteIsVisible = Boolean(
    focusedQuote && filteredQuotes.some((quote) => quote.id === focusedQuote.id)
  );
  const focusedQuoteStatus = String(focusedQuote?.status || "draft").trim().toLowerCase();
  const focusedQuoteStatusSemantics = getQuoteHistoryStatusSemantics(focusedQuote || {});
  const focusedQuoteIsDraft = focusedQuoteStatus === "draft";
  const focusedRebookDeliveryGate = getRebookDeliveryGate(focusedQuote || {}, { tenantTimeZone });
  let focusedQuoteRevisionId = "";
  try {
    focusedQuoteRevisionId = focusedQuote
      ? resolveQuoteDeliveryRevisionId(focusedQuote)
      : "";
  } catch {
    focusedQuoteRevisionId = "";
  }
  const focusedDelivery = getQuoteDeliveryUiState(
    focusedQuote,
    focusedQuoteRevisionId,
    deliveryClockMs
  );
  const focusedQuoteCanUsePortal = isCustomerPortalShareable(focusedQuote, {
    requireDeliveryEvidence: state.source === "firebase"
  }) && focusedRebookDeliveryGate.ready;
  const focusedQuoteDeliveryEligible = permissions.canSendQuoteEmail
    && state.source === "firebase"
    && canDeliverQuoteEmailStatus(focusedQuoteStatus)
    && Boolean(focusedQuoteRevisionId)
    && focusedDelivery.canAttempt
    && focusedRebookDeliveryGate.deliveryReady;
  const focusedQuoteCanSend = focusedQuoteDeliveryEligible
    && emailSetup.checked
    && emailSetup.configured;
  const focusedHandoffPrimaryIsPdf = focusedQuoteIsDraft
    && !focusedQuoteCanSend
    && !focusedDelivery.reviewRequired;
  // Email delivery readiness is only meaningful for firebase-backed quotes
  // (see the readiness banner above, which uses the same gate), so a
  // non-firebase source never offers the "go configure it" shortcut.
  const focusedQuoteEmailUnconfigured = permissions.canSendQuoteEmail
    && state.source === "firebase"
    && emailSetup.checked
    && !emailSetup.configured;

  const applyQuoteLocally = (quoteId, updater) => {
    setState((prev) => ({
      ...prev,
      quotes: prev.quotes.map((quote) => (quote.id === quoteId ? updater(quote) : quote))
    }));
  };

  const applyStatusLocally = (quoteId, nextStatus) => {
    applyQuoteLocally(quoteId, (quote) => ({ ...quote, status: nextStatus }));
  };

  const applyApprovalExecutionLocally = (quoteId, approvalRequest) => {
    if (!approvalRequest?.id) return;
    applyQuoteLocally(quoteId, (quote) => ({
      ...quote,
      workflow: {
        ...(quote.workflow || {}),
        approvalRequests: (quote.workflow?.approvalRequests || []).map((request) => (
          request.id === approvalRequest.id ? approvalRequest : request
        ))
      }
    }));
  };

  const resolveQuotePortalLink = (quote) => {
    if (!quote?.portalKey) return "";
    const base = basePortalUrl || `${window.location.origin}/app`;
    return `${base}?portal=${encodeURIComponent(quote.portalKey)}`;
  };

  const handleStatusUpdate = async (quoteId, nextStatus, silent = false) => {
    if (!permissions.canManageQuoteStatus) {
      setState((prev) => ({ ...prev, error: "Admin role required to change quote status." }));
      return;
    }
    setUpdatingId(quoteId);
    try {
      await updateQuoteStatus(quoteId, nextStatus);
      applyStatusLocally(quoteId, nextStatus);
      if (!silent) {
        setState((prev) => ({ ...prev, feedback: `Status updated to ${nextStatus}.` }));
        pushToast(`Quote status updated to ${nextStatus}.`, "success");
      }
    } catch (err) {
      setState((prev) => ({
        ...prev,
        error: err?.message || "Failed to update quote status."
      }));
    } finally {
      setUpdatingId("");
    }
  };

  const handleDeleteQuote = async (quoteId) => {
    if (!permissions.canDeleteQuote || !canDeleteQuotes) {
      setState((prev) => ({ ...prev, error: "Admin role required to delete quotes." }));
      return false;
    }
    setUpdatingId(quoteId);
    setState((prev) => ({ ...prev, error: "" }));
    try {
      const quote = state.quotes.find((item) => item.id === quoteId);
      const approvalRequest = getExecutableApprovalRequest(
        quote,
        "delete_quote",
        approvalExecutionOptions()
      );
      if (state.source === "firebase" && !approvalRequest) {
        throw new Error("Approve a quote-deletion request in Workflow first.");
      }
      await deleteQuote(quoteId, {
        organizationId,
        approvalRequestId: approvalRequest?.id || ""
      });
      setState((prev) => ({
        ...prev,
        quotes: prev.quotes.filter((quote) => quote.id !== quoteId)
      }));
      await load();
      setState((prev) => ({ ...prev, feedback: "Quote permanently deleted." }));
      pushToast("Quote permanently deleted.", "success");
      return true;
    } catch (err) {
      setState((prev) => ({
        ...prev,
        error: err?.message || "Failed to delete quote."
      }));
      return false;
    } finally {
      setUpdatingId("");
    }
  };

  const handleDuplicateQuote = async (quote) => {
    if (!quote?.id) return;
    const confirmed = window.confirm(
      "Create a separate alternate draft from this quote? The client, event, and quote configuration carry forward. The current quote stays unchanged, and delivery, acceptance, payment, booking, and rebooking proof do not transfer."
    );
    if (!confirmed) return;
    setDuplicatingId(quote.id);
    setState((prev) => ({ ...prev, error: "" }));
    try {
      const result = await duplicateQuote(quote.id, {
        ownerUid: currentUserUid,
        ownerEmail: currentUserEmail
      });
      setState((prev) => ({
        ...prev,
        feedback: `Alternate draft created as ${result.quoteNumber}.`
      }));
      pushToast(`Alternate draft created as ${result.quoteNumber}.`, "success");
      await load();
      openQuoteWorkspace(result.id);
    } catch (err) {
      setState((prev) => ({
        ...prev,
        error: err?.message || "Failed to duplicate quote."
      }));
    } finally {
      setDuplicatingId("");
    }
  };

  const handleReopenQuote = async (quote) => {
    if (!quote?.id) return;
    if (!permissions.canReopenQuote) {
      setState((prev) => ({ ...prev, error: "Admin role required to reopen quotes." }));
      return;
    }
    setReopeningQuoteId(quote.id);
    setState((prev) => ({ ...prev, error: "", feedback: "" }));
    try {
      const result = await reopenQuote(quote.id);
      applyQuoteLocally(quote.id, (existing) => ({
        ...existing,
        status: result.status,
        portalKey: result.portalKey,
        portalIssuedAtISO: result.portalIssuedAtISO,
        portalExpiresAtISO: result.portalExpiresAtISO,
        expiresAtISO: result.expiresAtISO,
        deletedAtISO: ""
      }));
      await load();
      setState((prev) => ({
        ...prev,
        feedback: `${formatWorkspaceText(quote.quoteNumber, { emptyLabel: "Quote record" })} reopened as a draft with a new portal issuance.`
      }));
      pushToast(`${formatWorkspaceText(quote.quoteNumber, { emptyLabel: "Quote record" })} reopened as a draft.`, "success");
    } catch (err) {
      setState((prev) => ({
        ...prev,
        error: err?.message || "Failed to reopen quote."
      }));
    } finally {
      setReopeningQuoteId("");
    }
  };

  const requestDeleteQuote = (quote) => {
    setPendingDeleteQuote(quote || null);
  };

  const confirmDeleteQuote = async () => {
    const quoteId = pendingDeleteQuote?.id;
    if (!quoteId) return;
    const deleted = await handleDeleteQuote(quoteId);
    if (deleted) setPendingDeleteQuote(null);
  };

  const handleConvertToContract = async (quote, { reconcile = false } = {}) => {
    if (!permissions.canConvertToContract) {
      const error = "Admin role required to convert quotes to contracts.";
      setContractConversions((current) => reduceContractConversionMutationState(current, {
        ...createContractConversionMutationState(quote?.id),
        phase: "error",
        error
      }));
      setState((prev) => ({ ...prev, error }));
      return;
    }
    let attempt = null;
    let dispatched = false;
    try {
      const requiresApproval = state.source === "firebase";
      let approvalRequestId = "";
      if (!reconcile) {
        const approvalRequest = getExecutableApprovalRequest(
          quote,
          "convert_to_contract",
          approvalExecutionOptions()
        );
        if (requiresApproval && !approvalRequest) {
          throw new Error("Approve a contract-conversion request in Workflow first.");
        }
        approvalRequestId = approvalRequest?.id || "";
      }

      attempt = beginContractConversionAttempt({
        currentState: getContractConversionMutationState(contractConversions, quote.id),
        quoteId: quote.id,
        approvalRequestId,
        requiresApproval,
        reconcile
      });
      setContractConversions((current) => reduceContractConversionMutationState(current, attempt));
      setConvertingId(quote.id);
      setState((prev) => ({ ...prev, error: "", feedback: "" }));
      dispatched = true;
      const result = await convertQuoteToContract({
        quoteId: quote.id,
        actorEmail: currentUserEmail,
        approvalRequestId: attempt.approvalRequestId
      });
      applyQuoteLocally(quote.id, (existing) => ({
        ...existing,
        status: result.status,
        booking: result.booking,
        lifecycle: result.lifecycle
      }));
      applyApprovalExecutionLocally(quote.id, result.approvalRequest);
      const acceptedConflicts = result.availability.conflicts.filter((item) => item.status === "accepted").length;
      const capacityNote = result.availability.capacityExceeded
        ? ` Capacity note: projected load ${result.availability.sameVenueLoad}/${result.availability.capacityLimit}.`
        : "";
      const acceptedNote = acceptedConflicts
        ? ` Soft conflict note: ${acceptedConflicts} accepted quote(s) share this venue/date.`
        : "";
      setState((prev) => ({
        ...prev,
        feedback: `Converted ${quote.quoteNumber} to contract ${result.contractNumber}.${acceptedNote}${capacityNote}`
      }));
      setContractConversions((current) => reduceContractConversionMutationState(current, {
        phase: "receipt",
        quoteId: quote.id,
        approvalRequestId: attempt.approvalRequestId,
        requiresApproval: attempt.requiresApproval,
        error: "",
        receipt: {
          contractNumber: result.contractNumber,
          status: result.status,
          versionNumber: result.versionNumber,
          source: result.storage
        }
      }));
      pushToast(`Converted ${quote.quoteNumber} to contract ${result.contractNumber}.`, "success");
    } catch (err) {
      const error = contractConversionErrorMessage(
        err,
        "Failed to convert quote to contract."
      );
      const uncertain = dispatched && !isDefinitiveContractConversionError(err);
      setContractConversions((current) => reduceContractConversionMutationState(current, {
        phase: uncertain ? "uncertain" : "error",
        quoteId: String(quote?.id || "").trim(),
        approvalRequestId: attempt?.approvalRequestId || "",
        requiresApproval: attempt?.requiresApproval === true,
        error,
        receipt: null
      }));
      setState((prev) => ({
        ...prev,
        error
      }));
    } finally {
      setConvertingId("");
    }
  };

  const handleRecoverContractConversion = async (quote) => {
    const quoteId = String(quote?.id || "").trim();
    if (!quoteId) return;
    setContractConversions((current) => reduceContractConversionMutationState(current, {
      phase: "recovery",
      quoteId,
      approvalRequestId: "",
      requiresApproval: false,
      error: "",
      receipt: null
    }));
    setState((prev) => ({ ...prev, error: "", feedback: "" }));
    try {
      const safeState = await recoverContractConversionFromCanonicalHistory({
        quoteId,
        refreshHistory: load
      });
      setContractConversions((current) => reduceContractConversionMutationState(current, safeState));
    } catch (err) {
      const error = contractConversionErrorMessage(
        err,
        "Canonical quote history could not be refreshed."
      );
      setContractConversions((current) => reduceContractConversionMutationState(current, {
        ...createContractConversionMutationState(quoteId),
        phase: "error",
        error
      }));
      setState((prev) => ({ ...prev, error }));
    }
  };

  const handleConfirmationUpdate = async (quoteId, nextConfirmationStatus) => {
    if (!permissions.canManageConfirmation) {
      setState((prev) => ({ ...prev, error: "Admin role required to update booking confirmation." }));
      return;
    }
    setUpdatingConfirmationId(quoteId);
    setState((prev) => ({ ...prev, error: "" }));
    try {
      const result = await updateQuoteBookingConfirmation({
        quoteId,
        confirmationStatus: nextConfirmationStatus,
        actorEmail: currentUserEmail
      });
      applyQuoteLocally(quoteId, (quote) => ({
        ...quote,
        booking: result.booking
      }));
      setState((prev) => ({
        ...prev,
        feedback: `Confirmation marked ${nextConfirmationStatus}.`
      }));
      pushToast(`Confirmation marked ${nextConfirmationStatus}.`, "success");
    } catch (err) {
      setState((prev) => ({
        ...prev,
        error: err?.message || "Failed to update booking confirmation."
      }));
    } finally {
      setUpdatingConfirmationId("");
    }
  };

  const handleCopyEmail = async (quote) => {
    try {
      assertRebookArtifactReady(quote, { tenantTimeZone });
      if (!navigator.clipboard) {
        throw new Error("Clipboard unavailable in this browser.");
      }
      const template = buildQuoteEmailPayload(quote, {
        basePortalUrl,
        includePortalLink: isCustomerPortalShareable(quote, {
          requireDeliveryEvidence: state.source === "firebase"
        })
      });
      const mailText = `Subject: ${template.subject}\n\n${template.body}`;
      await navigator.clipboard.writeText(mailText);
      const feedback = String(quote.status || "draft").toLowerCase() === "draft"
        ? `Email template copied for ${quote.quoteNumber}. The quote remains a draft until delivery is recorded.`
        : `Email template copied for ${quote.quoteNumber}. No quote status changed.`;
      setState((prev) => ({ ...prev, feedback }));
      pushToast(feedback, "success");
    } catch (err) {
      setState((prev) => ({ ...prev, error: err?.message || "Failed to copy email template." }));
    }
  };

  const handleExportPdf = async (quote) => {
    setExportingPdfId(quote.id);
    try {
      assertRebookArtifactReady(quote, { tenantTimeZone });
      const { exportQuoteProposal } = await import("../lib/proposalExport");
      await exportQuoteProposal(quote, {
        basePortalUrl,
        includePortalLink: isCustomerPortalShareable(quote, {
          requireDeliveryEvidence: state.source === "firebase"
        })
      });
      setState((prev) => ({ ...prev, feedback: `Downloaded PDF for ${quote.quoteNumber}.` }));
      pushToast(`Downloaded PDF for ${quote.quoteNumber}.`, "success");
    } catch (err) {
      setState((prev) => ({ ...prev, error: err?.message || "Failed to export proposal PDF." }));
    } finally {
      setExportingPdfId("");
    }
  };

  const handlePrintProposal = async (quote) => {
    setExportingPdfId(quote.id);
    try {
      assertRebookArtifactReady(quote, { tenantTimeZone });
      const { exportQuoteProposal } = await import("../lib/proposalExport");
      await exportQuoteProposal(quote, {
        basePortalUrl,
        includePortalLink: isCustomerPortalShareable(quote, {
          requireDeliveryEvidence: state.source === "firebase"
        }),
        output: "print"
      });
      const feedback = `Opened a printable proposal for ${quote.quoteNumber}.`;
      setState((prev) => ({ ...prev, feedback }));
      pushToast(feedback, "success");
    } catch (err) {
      setState((prev) => ({ ...prev, error: err?.message || "Failed to open the proposal print preview." }));
    } finally {
      setExportingPdfId("");
    }
  };

  const handleOpenDefaultEmailApp = (quote) => {
    try {
      assertRebookArtifactReady(quote, { tenantTimeZone });
      const template = buildQuoteEmailPayload(quote, {
        basePortalUrl,
        includePortalLink: isCustomerPortalShareable(quote, {
          requireDeliveryEvidence: state.source === "firebase"
        })
      });
      const handoff = buildDefaultEmailAppHandoff({
        to: quote?.customer?.email,
        subject: template.subject,
        body: template.body
      });
      window.location.assign(handoff.href);
      const feedback = `Opened the default email app for ${quote.quoteNumber}. No send or delivery status changed.`;
      setState((prev) => ({ ...prev, feedback }));
      pushToast(feedback, "info");
    } catch (err) {
      setState((prev) => ({ ...prev, error: err?.message || "Failed to open the default email app." }));
    }
  };

  const handleOpenKitchenBeo = (quote) => {
    try {
      assertRebookArtifactReady(quote, { tenantTimeZone });
      if (state.source !== "firebase") {
        throw new Error("Authoritative Kitchen BEO generation requires Firebase-backed quote storage.");
      }
      kitchenBeoReturnFocusRef.current = document.activeElement;
      setState((prev) => ({ ...prev, error: "", feedback: "" }));
      setKitchenBeoQuote(quote);
    } catch (err) {
      setState((prev) => ({ ...prev, error: err?.message || "Failed to open Kitchen BEO status." }));
    }
  };

  const handleExportLocalBeo = async (quote) => {
    setExportingLocalBeoId(quote.id);
    try {
      assertRebookArtifactReady(quote, { tenantTimeZone });
      if (state.source !== "local") {
        throw new Error("The browser-only Kitchen BEO fallback is available only for local quote storage.");
      }
      const { exportKitchenBeo } = await import("../lib/beoExport");
      await exportKitchenBeo(quote, { output: "save" });
      const feedback = `Browser-local Kitchen BEO download started for ${quote.quoteNumber}. It has no server generation receipt or freshness status.`;
      setState((prev) => ({ ...prev, feedback }));
      pushToast(feedback, "success");
    } catch (err) {
      setState((prev) => ({ ...prev, error: err?.message || "Failed to export the local Kitchen BEO fallback." }));
    } finally {
      setExportingLocalBeoId("");
    }
  };

  const handleCopyPaymentLink = async (quote) => {
    try {
      if (!navigator.clipboard) {
        throw new Error("Clipboard unavailable in this browser.");
      }
      const paymentLink = sanitizeStripePaymentLink(quote.payment?.depositLink);
      if (!paymentLink) {
        throw new Error("No approved Stripe deposit link is saved for this quote.");
      }
      await navigator.clipboard.writeText(paymentLink);
      setState((prev) => ({ ...prev, feedback: `Deposit link copied for ${quote.quoteNumber}.` }));
      pushToast(`Deposit link copied for ${quote.quoteNumber}.`, "success");
    } catch (err) {
      setState((prev) => ({ ...prev, error: err?.message || "Failed to copy payment link." }));
    }
  };

  const handleCopyFinalBalanceLink = async (quote) => {
    try {
      if (!navigator.clipboard) {
        throw new Error("Clipboard unavailable in this browser.");
      }
      if (!isFinalBalanceRequestEligible(quote)) {
        throw new Error("Final-balance collection requires a booked contract and a verified paid deposit.");
      }
      const paymentLink = sanitizeStripePaymentLink(quote.payment?.finalBalance?.paymentLink);
      if (!paymentLink) {
        throw new Error("No approved Stripe final-balance link is saved for this quote.");
      }
      await navigator.clipboard.writeText(paymentLink);
      setState((prev) => ({ ...prev, feedback: `Final-balance link copied for ${quote.quoteNumber}.` }));
      pushToast(`Final-balance link copied for ${quote.quoteNumber}.`, "success");
    } catch (err) {
      setState((prev) => ({ ...prev, error: err?.message || "Failed to copy final-balance link." }));
    }
  };

  const handleCopyPortalLink = async (quote) => {
    try {
      if (!navigator.clipboard) {
        throw new Error("Clipboard unavailable in this browser.");
      }
      if (!isCustomerPortalShareable(quote, {
        requireDeliveryEvidence: state.source === "firebase"
      })) {
        throw new Error(
          "Customer portal access requires provider acceptance for this revision and a valid future expiry."
        );
      }
      const portalLink = resolveQuotePortalLink(quote);
      if (!portalLink) {
        throw new Error("No customer portal key for this quote.");
      }
      await navigator.clipboard.writeText(portalLink);
      setState((prev) => ({ ...prev, feedback: `Portal link copied for ${quote.quoteNumber}.` }));
      pushToast(`Portal link copied for ${quote.quoteNumber}.`, "success");
    } catch (err) {
      setState((prev) => ({ ...prev, error: err?.message || "Failed to copy portal link." }));
    }
  };

  const handleRotatePortalLink = async (quote) => {
    if (!quote?.id) return;
    if (!permissions.canRotatePortalLink) {
      setState((prev) => ({ ...prev, error: "Admin role required to rotate portal links." }));
      return;
    }
    setRotatingPortalId(quote.id);
    setState((prev) => ({ ...prev, error: "", feedback: "" }));
    try {
      const approvalRequest = getExecutableApprovalRequest(
        quote,
        "rotate_portal_link",
        approvalExecutionOptions()
      );
      if (state.source === "firebase" && !approvalRequest) {
        throw new Error("Approve a portal-rotation request in Workflow first.");
      }
      const result = await rotateQuotePortalKey({
        quoteId: quote.id,
        actorEmail: currentUserEmail,
        approvalRequestId: approvalRequest?.id || ""
      });
      applyQuoteLocally(quote.id, (existing) => ({
        ...existing,
        portalKey: result.portalKey,
        portalIssuedAtISO: result.portalIssuedAtISO,
        portalExpiresAtISO: result.portalExpiresAtISO
      }));
      applyApprovalExecutionLocally(quote.id, result.approvalRequest);
      await load();
      setState((prev) => ({
        ...prev,
        feedback: `Portal link rotated for ${quote.quoteNumber}.`
      }));
      pushToast(`Portal link rotated for ${quote.quoteNumber}.`, "success");
    } catch (err) {
      setState((prev) => ({ ...prev, error: err?.message || "Failed to rotate portal link." }));
    } finally {
      setRotatingPortalId("");
    }
  };

  const handleSendQuoteEmail = async (quote) => {
    setSendingQuoteEmailId(quote.id);
    setState((prev) => ({ ...prev, error: "", feedback: "" }));
    try {
      if (!emailSetup.checked || !emailSetup.configured) {
        throw new Error("Configure a supported email provider before sending quote email.");
      }
      if (isPortalExpired(quote)) {
        throw new Error("Portal link expired. Rotate the portal link before sending quote email.");
      }
      const sendResult = await sendQuoteToCustomerEmail({
        quoteId: quote.id,
        quoteRevisionId: resolveQuoteDeliveryRevisionId(quote)
      });
      applyQuoteLocally(quote.id, (existing) => ({
        ...existing,
        status: sendResult.status || existing.status,
        lifecycle: sendResult.lifecycle || existing.lifecycle,
        workflow: {
          ...(existing.workflow || {}),
          ...(sendResult.delivery
            ? { quoteDelivery: sendResult.delivery }
            : {})
        }
      }));
      const feedback = sendResult.idempotent
        ? `The email provider already accepted this saved revision for ${quote.customer?.email || "the customer"}.`
        : `The email provider accepted the quote for ${quote.customer?.email || "the customer"}. Quote sent status and portal access were recorded together.`;
      setState((prev) => ({ ...prev, feedback }));
      pushToast(
        sendResult.idempotent
          ? `Provider acceptance was already recorded for ${quote.quoteNumber}.`
          : `Email provider accepted ${quote.quoteNumber}.`,
        "success"
      );
    } catch (err) {
      await load();
      setState((prev) => ({
        ...prev,
        error: err?.message || "Failed to send quote email."
      }));
    } finally {
      setSendingQuoteEmailId("");
    }
  };

  const openDeliveryReview = (quote, quoteRevisionId) => {
    if (!permissions.canSendQuoteEmail || !quote?.id || !quoteRevisionId) return;
    const observedProviderMessageId = String(
      quote.workflow?.quoteDelivery?.observedProviderMessageId || ""
    ).trim();
    deliveryReviewReturnFocusRef.current = document.activeElement;
    setDeliveryReview({
      quoteId: quote.id,
      quoteNumber: formatWorkspaceText(quote.quoteNumber, { emptyLabel: "Quote number pending" }),
      quoteRevisionId,
      resolution: observedProviderMessageId ? "provider_accepted" : "confirmed_not_sent",
      providerMessageId: observedProviderMessageId,
      knownProviderAcceptance: Boolean(observedProviderMessageId),
      note: ""
    });
  };

  const closeDeliveryReview = () => {
    const returnTarget = deliveryReviewReturnFocusRef.current;
    setDeliveryReview(null);
    window.requestAnimationFrame(() => {
      if (returnTarget?.isConnected) {
        returnTarget.focus();
      } else if (savedQuoteHandoffRef.current?.isConnected) {
        savedQuoteHandoffRef.current.focus();
      } else {
        dialogRef.current?.focus();
      }
    });
  };

  const submitDeliveryReview = async () => {
    if (!deliveryReview?.quoteId) return;
    setResolvingDeliveryId(deliveryReview.quoteId);
    setState((prev) => ({ ...prev, error: "", feedback: "" }));
    try {
      const result = await resolveQuoteDeliveryOutcome(deliveryReview);
      applyQuoteLocally(deliveryReview.quoteId, (quote) => ({
        ...quote,
        status: result.status || quote.status,
        lifecycle: result.lifecycle || quote.lifecycle,
        workflow: {
          ...(quote.workflow || {}),
          quoteDelivery: result.delivery
        }
      }));
      const feedback = deliveryReview.resolution === "provider_accepted"
        ? `Provider acceptance recorded for ${deliveryReview.quoteNumber}.`
        : `Provider review confirmed ${deliveryReview.quoteNumber} was not sent. A fresh dispatch is now available.`;
      await load();
      setState((prev) => ({ ...prev, feedback }));
      pushToast(feedback, "success");
      closeDeliveryReview();
    } catch (err) {
      setState((prev) => ({
        ...prev,
        error: err?.message || "Failed to resolve quote delivery review."
      }));
    } finally {
      setResolvingDeliveryId("");
    }
  };

  const handleSendPaymentRequestEmail = async (quote) => {
    setSendingPaymentEmailId(quote.id);
    setState((prev) => ({ ...prev, error: "", feedback: "" }));
    try {
      const approvalRequest = getExecutableApprovalRequest(
        quote,
        "send_payment_request",
        approvalExecutionOptions({ allowInProgressRecovery: true })
      );
      if (!approvalRequest) {
        throw new Error("Approve a payment-request action in Workflow first.");
      }
      const paymentRequestInProgress = String(approvalRequest.executionState || "")
        .trim()
        .toLowerCase() === "in_progress";
      const status = String(quote.status || "").trim().toLowerCase();
      if (!["accepted", "booked"].includes(status)) {
        throw new Error("Payment request email is only available after quote acceptance.");
      }
      if (isPortalExpired(quote) && !paymentRequestInProgress) {
        throw new Error("Portal link expired. Rotate the portal link before sending payment requests.");
      }

      const sendResult = await sendPaymentRequestToCustomerEmail({
        quoteId: quote.id,
        approvalRequestId: approvalRequest.id
      });
      applyApprovalExecutionLocally(quote.id, sendResult.approvalRequest);
      await load();

      setState((prev) => ({ ...prev, feedback: `Payment request sent to ${quote.customer?.email || "customer"}.` }));
      pushToast(`Payment request sent for ${quote.quoteNumber}.`, "success");
    } catch (err) {
      await load();
      setState((prev) => ({ ...prev, error: err?.message || "Failed to send payment request." }));
    } finally {
      setSendingPaymentEmailId("");
    }
  };

  const handleSendFinalBalanceRequestEmail = async (quote) => {
    if (!permissions.canSendFinalBalanceRequest) return;
    setSendingFinalBalanceEmailId(quote.id);
    setState((prev) => ({ ...prev, error: "", feedback: "" }));
    try {
      const approvalRequest = getExecutableApprovalRequest(
        quote,
        "send_final_balance_request",
        approvalExecutionOptions({ allowInProgressRecovery: true })
      );
      if (!approvalRequest) {
        throw new Error("Approve a final-balance request in Workflow first.");
      }
      const finalBalanceRequestInProgress = String(approvalRequest.executionState || "")
        .trim()
        .toLowerCase() === "in_progress";
      if (!isFinalBalanceRequestEligible(quote) && !finalBalanceRequestInProgress) {
        throw new Error(
          "Final-balance collection requires a booked contract and a verified paid deposit."
        );
      }
      if (isPortalExpired(quote) && !finalBalanceRequestInProgress) {
        throw new Error("Portal link expired. Restore customer portal access before sending the final balance.");
      }

      const sendResult = await sendFinalBalanceRequestToCustomerEmail({
        quoteId: quote.id,
        approvalRequestId: approvalRequest.id
      });
      applyApprovalExecutionLocally(quote.id, sendResult.approvalRequest);
      await load();

      setState((prev) => ({
        ...prev,
        feedback: `Final-balance request sent to ${quote.customer?.email || "customer"}.`
      }));
      pushToast(`Final-balance request sent for ${quote.quoteNumber}.`, "success");
    } catch (err) {
      await load();
      setState((prev) => ({
        ...prev,
        error: err?.message || "Failed to send final-balance request."
      }));
    } finally {
      setSendingFinalBalanceEmailId("");
    }
  };

  const handleReconcilePayment = async (quote) => {
    if (!permissions.canReconcilePayment) return;
    setReconcilingPaymentId(quote.id);
    setState((prev) => ({ ...prev, error: "", feedback: "" }));
    try {
      const result = await reconcileDepositCheckout({ quoteId: quote.id });
      await load();
      const feedback = result.reviewRequired
        ? `Stripe reconciliation for ${quote.quoteNumber} requires provider review.`
        : `Stripe reconciliation recorded ${result.providerState} for ${quote.quoteNumber}.`;
      setState((prev) => ({ ...prev, feedback }));
      pushToast(feedback, result.reviewRequired ? "warning" : "success");
    } catch (err) {
      setState((prev) => ({
        ...prev,
        error: err?.message || "Failed to reconcile Stripe payment."
      }));
    } finally {
      setReconcilingPaymentId("");
    }
  };

  const handleReconcileFinalBalance = async (quote) => {
    if (!permissions.canReconcileFinalBalance || !isFinalBalanceRequestEligible(quote)) return;
    setReconcilingFinalBalanceId(quote.id);
    setState((prev) => ({ ...prev, error: "", feedback: "" }));
    try {
      const result = await reconcileFinalBalanceCheckout({ quoteId: quote.id });
      await load();
      const feedback = result.reviewRequired
        ? `Final-balance reconciliation for ${quote.quoteNumber} requires provider review.`
        : `Final-balance reconciliation recorded ${result.providerState} for ${quote.quoteNumber}.`;
      setState((prev) => ({ ...prev, feedback }));
      pushToast(feedback, result.reviewRequired ? "warning" : "success");
    } catch (err) {
      setState((prev) => ({
        ...prev,
        error: err?.message || "Failed to reconcile the Stripe final balance."
      }));
    } finally {
      setReconcilingFinalBalanceId("");
    }
  };

  const handleEditQuote = AMBIENT_UI_ENABLED
    ? (quote, options) => typeof onEditQuote === "function" && onEditQuote(quote, options)
    : (quote) => typeof onEditQuote === "function" && onEditQuote(quote);

  const handleOpenIntegrations = () => {
    if (typeof onOpenIntegrations !== "function") return;
    onOpenIntegrations();
  };

  const beoAvailable = Boolean(
    focusedQuote
    && permissions.canExportBeo
    && focusedRebookDeliveryGate.ready
  );

  if (detailMode) {
    const ordinaryEditAllowed = Boolean(
      focusedQuote
      && permissions.canEditQuote
      && canEditQuoteStatus(focusedQuoteStatus)
      && !focusedDelivery.mutationLocked
      && typeof onEditQuote === "function"
    );
    const conversationAvailable = Boolean(
      focusedQuote
      && permissions.canCopyArtifacts
      && state.source === "firebase"
      && portalConversationAvailable()
      && focusedQuoteCanUsePortal
    );
    const quickUpdateRevisionId = String(
      focusedQuote?.activeVersionId
      || focusedQuote?.versionMeta?.versionId
      || ""
    ).trim();
    const validateQuickUpdateRequest = (request) => {
      const requestQuoteId = String(request?.quoteId || "").trim();
      const requestOrganizationId = String(request?.organizationId || "").trim();
      const requestRevisionId = String(request?.baseRevisionId || "").trim();
      const requestedStyle = String(request?.patch?.event?.style || "").trim();
      const exactDelta = Array.isArray(request?.delta)
        && request.delta.length === 1
        && request.delta[0]?.fieldPath === "event.style"
        && String(request.delta[0]?.after || "").trim() === requestedStyle;
      return Boolean(
        ordinaryEditAllowed
        && focusedQuote
        && request?.modelId === "quick-updates-request-v1"
        && request?.scope === "event.service_style"
        && requestQuoteId === String(focusedQuote.id || focusedQuote.quoteId || "").trim()
        && requestOrganizationId === String(organizationId || focusedQuote.organizationId || "").trim()
        && requestRevisionId
        && requestRevisionId === quickUpdateRevisionId
        && requestedStyle
        && exactDelta
      );
    };
    const handlePreviewQuickUpdate = async (request) => {
      if (!validateQuickUpdateRequest(request)) {
        return {
          status: "conflict",
          message: "The Quick Updates draft no longer matches this exact tenant, opportunity, or saved revision."
        };
      }
      if (typeof onPreviewQuickUpdate !== "function") {
        return {
          status: "failure",
          message: "Authoritative Quick Updates review is not available in this workspace."
        };
      }
      return onPreviewQuickUpdate(request);
    };
    const handleSaveQuickUpdate = async (request, hooks = {}) => {
      if (!validateQuickUpdateRequest(request)) {
        return {
          status: "conflict",
          message: "The saved opportunity changed before this menu draft could be submitted."
        };
      }
      if (typeof onSaveQuickUpdate !== "function") {
        return {
          status: "failure",
          message: "Authoritative Quick Updates save is not available in this workspace."
        };
      }
      const persisted = await onSaveQuickUpdate(request);
      const persistenceStatus = String(persisted?.status || "").trim().toLowerCase();
      if (persistenceStatus !== "persisted") {
        if (["conflict", "failure", "failed", "handoff", "uncertain"].includes(persistenceStatus)) {
          return persisted;
        }
        return {
          status: "uncertain",
          message: "The save did not return the required persisted phase before authoritative list refresh."
        };
      }
      const receipt = persisted.receipt || null;
      hooks.onPersisted?.(receipt);
      const refreshed = await load();
      if (!refreshed || !Array.isArray(refreshed.quotes)) {
        return {
          status: "uncertain",
          message: "The save returned, but the authoritative opportunity list could not be refreshed.",
          receipt
        };
      }
      const authoritativeQuote = refreshed.quotes.find((item) => (
        String(item?.id || item?.quoteId || "").trim() === request.quoteId
      ));
      const refreshedOrganizationId = String(authoritativeQuote?.organizationId || organizationId || "").trim();
      const refreshedRevisionId = String(
        authoritativeQuote?.activeVersionId
        || authoritativeQuote?.versionMeta?.versionId
        || authoritativeQuote?.updatedAtISO
        || ""
      ).trim();
      const expectedRevisionId = String(
        receipt?.activeVersionId || receipt?.versionId || persisted?.activeVersionId || ""
      ).trim();
      if (
        !authoritativeQuote
        || refreshedOrganizationId !== request.organizationId
        || String(authoritativeQuote?.event?.style || "").trim() !== request.patch.event.style
        || (expectedRevisionId && refreshedRevisionId !== expectedRevisionId)
      ) {
        return {
          status: "uncertain",
          message: "The save returned, but the authoritative opportunity reread did not confirm the exact tenant, revision, and service style.",
          receipt
        };
      }
      return {
        status: "saved",
        quote: authoritativeQuote,
        receipt
      };
    };
    return (
      <main
        className="container workspace-route-main embedded-workspace-route event-workspace-route"
        role="region"
        aria-label="Quote event workspace"
      >
        <div className="modal-card history-card workspace-route-card event-workspace-route-card" ref={dialogRef} tabIndex={-1}>
          {state.loading && !focusedQuote && (
            <div className="event-workspace-loading" role="status">Loading event workspace...</div>
          )}
          {state.error && <p className="error-note" role="alert">{state.error}</p>}
          {state.feedback && <p className="source-note" role="status" aria-live="polite">{state.feedback}</p>}
          {!state.loading && !focusedQuote && !state.error && (
            <section className="event-workspace-missing">
              <h1>Quote not found</h1>
              <p>The requested quote is not available in this workspace.</p>
              <button type="button" className="ghost" onClick={onBackToQuotes}>Back to Quotes</button>
            </section>
          )}
          {focusedQuote && AMBIENT_UI_ENABLED && AmbientLivingOpportunityRoute ? (
            <Suspense fallback={(
              <section
                className="event-workspace-loading"
                data-surface-purpose="reveal_context"
                role="status"
                aria-live="polite"
              >
                Opening {focusedQuote.event?.name || focusedQuote.quoteNumber || "the selected opportunity"}. The exact saved quote is loading; nothing is changed.
              </section>
            )}>
              <AmbientLivingOpportunityRoute
                ref={savedQuoteHandoffRef}
                quote={focusedQuote}
                source={state.source}
                attendanceEnabled={attendanceEnabled}
                attendanceReviewAllowed={attendanceEnabled && permissions.canEditQuote && ["accepted", "booked"].includes(focusedQuoteStatus) && !focusedDelivery.mutationLocked}
                principalId={currentUserUid}
                ordinaryEditAllowed={ordinaryEditAllowed}
                conversationAvailable={conversationAvailable}
                ambientPricingCatalog={ambientPricingCatalog}
                ambientPricingSettings={ambientPricingSettings}
                globalPilotRequest={globalPilotRequest}
                globalPilotReturnFocusRef={globalPilotReturnFocusRef}
                onGlobalPilotResolution={onGlobalPilotResolution}
                arrivalContext={arrivalContext}
                quoteActionController={quoteHistoryController.actions}
                decisionDebtSnapshot={focusedDecisionDebtSnapshot}
                onArrivalResolution={onArrivalResolution}
                ambientContext={{
                  organizationId: String(organizationId || focusedQuote.organizationId || "local-fallback"),
                  role: String(permissions.role || currentUserRole || "non_staff"),
                  route: `/app/quotes/${encodeURIComponent(String(focusedQuote.id))}`,
                  activeOpportunityId: String(focusedQuote.id),
                  selectedObject: {
                    id: String(focusedQuote.id),
                    type: "opportunity",
                    label: String(focusedQuote.event?.name || focusedQuote.quoteNumber || "Selected opportunity")
                  },
                  revision: focusedQuote.activeVersionId || focusedQuote.versionMeta?.versionId || null,
                  sourceFreshness: ambientQuoteSourceFreshness,
                  pendingPreview: null
                }}
                onBackToQuotes={onBackToQuotes}
                onEditQuote={handleEditQuote}
                serviceStyles={serviceStyles}
                onPreviewQuickUpdate={handlePreviewQuickUpdate}
                onSaveQuickUpdate={handleSaveQuickUpdate}
                onOpenQuickUpdatesLibrary={String(currentUserRole || "").trim().toLowerCase() === "admin"
                  ? onOpenQuickUpdatesLibrary
                  : undefined}
                onQuickUpdatesGuardChange={onQuickUpdatesGuardChange}
                onOpenWorkflow={onOpenWorkflow}
                onOpenCalendar={scheduleAvailable && typeof onOpenSchedule === "function"
                  ? () => onOpenSchedule(focusedQuote.id)
                  : undefined}
                onOpenLegacyWorkspace={(context = {}) => (
                  typeof onOpenQuoteAdministration === "function"
                    ? onOpenQuoteAdministration(focusedQuote.id, context)
                    : onBackToQuotes(context)
                )}
                onOpenConversation={(quoteId, options) => onOpenConversation
                  ? onOpenConversation(quoteId, options)
                  : setConversationQuote(focusedQuote)}
              />
            </Suspense>
          ) : focusedQuote ? (
            <EventWorkspaceView
              ref={savedQuoteHandoffRef}
              quote={focusedQuote}
              source={state.source}
              ordinaryEditAllowed={ordinaryEditAllowed}
              scheduleAvailable={scheduleAvailable}
              beoAvailable={beoAvailable}
              conversationAvailable={conversationAvailable}
              exportingPdf={exportingPdfId === focusedQuote.id}
              onBackToQuotes={onBackToQuotes}
              onEditQuote={handleEditQuote}
              onMoreQuoteActions={onBackToQuotes}
              onOpenWorkflow={onOpenWorkflow}
              onOpenSchedule={onOpenSchedule}
              onOpenCustomer={() => onOpenCustomer?.(focusedQuote.customerId)}
              onOpenBeo={() => {
                if (state.source === "firebase") handleOpenKitchenBeo(focusedQuote);
                else handleExportLocalBeo(focusedQuote);
              }}
              onExportPdf={permissions.canExportProposal && focusedRebookDeliveryGate.ready
                ? () => handleExportPdf(focusedQuote)
                : undefined}
              onOpenConversation={() => onOpenConversation
                ? onOpenConversation(focusedQuote.id)
                : setConversationQuote(focusedQuote)}
            />
          ) : null}
          {focusedQuote && AMBIENT_UI_ENABLED && permissions.canExportBeo ? (
            <section
              className="admin-section staff-capability-state"
              data-capability-id="cwf-15-kitchen-beo-entry"
              data-capability-state={beoAvailable ? "ready" : "blocked"}
            >
              <p className="eyebrow">Event handoff</p>
              <h3>Kitchen BEO and event notes</h3>
              <p className="source-note">
                Review revision-bound kitchen, venue, service, and staffing instructions before generating the production artifact.
              </p>
              {state.source === "local" ? (
                <p className="warning-note" role="status" data-beo-local-boundary="no-server-receipt">
                  This local fallback has no server generation receipt, retained artifact history, or authoritative freshness status.
                </p>
              ) : null}
              <QuoteHistoryKitchenBeoAction
                source={state.source}
                quote={focusedQuote}
                disabled={!beoAvailable}
                disabledReason={beoAvailable ? "" : focusedRebookDeliveryGate.message}
                exportingLocal={exportingLocalBeoId === focusedQuote.id}
                onOpenAuthoritative={() => handleOpenKitchenBeo(focusedQuote)}
                onExportLocal={() => handleExportLocalBeo(focusedQuote)}
              />
            </section>
          ) : null}
          {focusedQuote
            && state.source === "firebase"
            && ["admin", "sales"].includes(permissions.role) && (
            <CommercialDependencyStatePanel
              organizationId={organizationId}
              quoteId={focusedQuote.id}
              quoteNumber={focusedQuote.quoteNumber}
              available={Boolean(organizationId)}
              canReconcile
              onOpenKitchenBeo={beoAvailable
                ? () => handleOpenKitchenBeo(focusedQuote)
                : undefined}
              onOpenProductionChecklist={scheduleAvailable && typeof onOpenSchedule === "function"
                ? () => onOpenSchedule(focusedQuote.id)
                : undefined}
            />
          )}
          {focusedQuote && state.source === "firebase" && (
            <QuoteDecisionDebtPanel
              organizationId={organizationId}
              quoteId={focusedQuote.id}
              timeZone={tenantTimeZone}
              available={Boolean(organizationId)}
              onOpenWorkflow={onOpenWorkflow}
              onReadStateChange={handleFocusedDecisionDebtRead}
            />
          )}
          {conversationQuote && (
            <aside className="quote-conversation-modal">
              <QuoteConversationPanel
                defaultOpen
                title={`Conversation for ${formatWorkspaceText(conversationQuote.quoteNumber, { emptyLabel: "quote number pending" })}`}
                access={{ accessMode: "staff", organizationId, quoteId: conversationQuote.id }}
                onClose={() => setConversationQuote(null)}
              />
            </aside>
          )}
          {kitchenBeoQuote && state.source === "firebase" && (
            <KitchenBeoArtifactPanel
              open
              presentation="modal"
              organizationId={organizationId}
              quoteId={kitchenBeoQuote.id}
              quoteNumber={kitchenBeoQuote.quoteNumber}
              currentUserUid={currentUserUid}
              currentUserRole={permissions.role}
              source={state.source}
              sourceVersionId={String(
                kitchenBeoQuote.activeVersionId || kitchenBeoQuote.versionMeta?.versionId || ""
              ).trim()}
              returnFocusRef={kitchenBeoReturnFocusRef}
              onClose={() => setKitchenBeoQuote(null)}
              onOpenProductionChecklist={scheduleAvailable && typeof onOpenSchedule === "function"
                ? () => onOpenSchedule(kitchenBeoQuote.id)
                : undefined}
              onGenerated={(result) => {
                const feedback = result?.idempotent
                  ? `Matching server Kitchen BEO receipt confirmed for ${kitchenBeoQuote.quoteNumber}.`
                  : `Server Kitchen BEO receipt recorded for ${kitchenBeoQuote.quoteNumber}.`;
                setState((current) => ({ ...current, feedback, error: "" }));
                pushToast(feedback, "success");
              }}
            />
          )}
        </div>
      </main>
    );
  }

  return (
    <div
      className={embedded ? "container workspace-route-main embedded-workspace-route" : "modal-overlay"}
      data-layout-overlap-allowed={embedded ? undefined : "true"}
      role={embedded ? "main" : "dialog"}
      aria-modal={embedded ? undefined : "true"}
      aria-labelledby={embedded && AMBIENT_UI_ENABLED
        ? "ambient-opportunities-heading"
        : "quote-history-title"}
    >
      <div
        className={`modal-card history-card${embedded ? " workspace-route-card" : ""}${
          embedded && AMBIENT_UI_ENABLED ? " ambient-opportunities-host" : ""
        }`}
        ref={dialogRef}
        tabIndex={-1}
      >
        {!(embedded && AMBIENT_UI_ENABLED) && <div className="modal-head">
          <h2
            ref={routeHeadingRef}
            id="quote-history-title"
            className={embedded ? "workspace-route-heading" : undefined}
            tabIndex={embedded ? -1 : undefined}
          >
            {AMBIENT_UI_ENABLED ? "Opportunities" : "Quotes"}
          </h2>
          <div className="right-actions">
            {!AMBIENT_UI_ENABLED && (
              <button type="button" className="ghost" onClick={load} disabled={state.loading}>
                {state.loading ? "Refreshing..." : "Refresh"}
              </button>
            )}
            <button
              type="button"
              className="ghost"
              onClick={requestQuoteHistoryClose}
              disabled={quoteHistoryCloseGuard.blocked}
              title={quoteHistoryCloseGuard.message}
            >
              {embedded ? AMBIENT_UI_ENABLED ? "Back to Now" : "Back to Home" : "Close"}
            </button>
          </div>
        </div>}

        {!AMBIENT_UI_ENABLED && <details className="staff-evidence-disclosure workspace-data-details">
          <summary>Workspace data details</summary>
          <p className="source-note">Source: {formatWorkspaceSource(state.source)}</p>
          <p className="source-note">
            Authority: {authorityCopy}
          </p>
          {state.source === "local" && permissions.canExportBeo && (
            <p className="warning-note" role="status" data-beo-local-boundary="no-server-receipt">
              Kitchen BEO fallback is browser-local in this workspace. It has no server generation receipt, retained artifact history, or authoritative freshness status.
            </p>
          )}
        </details>}
        {quoteHistoryCloseGuard.blocked && (
          <p className="warning-note" role="status">{quoteHistoryCloseGuard.message}</p>
        )}
        {permissions.canSendQuoteEmail && state.source === "firebase" && (
          <p
            id="quote-email-provider-readiness"
            className={emailSetup.checked && !emailSetup.configured ? "warning-note" : "source-note"}
            role="status"
            aria-live="polite"
          >
            {emailSetup.loading || !emailSetup.checked
              ? "Email delivery: checking provider readiness..."
              : emailSetup.configured
                ? `Email delivery: ${emailSetup.provider || "provider"} is configured.`
                : `Email delivery unavailable: ${emailSetup.error || "finish provider setup in Integration Ops."}`}
          </p>
        )}
        {state.error && (!AMBIENT_UI_ENABLED || state.error !== state.readError) && (
          <p className="error-note" role="alert">{state.error}</p>
        )}
        {state.feedback && <p className="source-note" role="status" aria-live="polite">{state.feedback}</p>}
        {focusedQuoteIsVisible && !administrationFocusActive && (
          <section
            className="saved-quote-handoff"
            ref={savedQuoteHandoffRef}
            tabIndex={-1}
            data-quote-id={focusedQuote.id}
            aria-labelledby="saved-quote-handoff-title"
            aria-describedby="saved-quote-handoff-description"
          >
            <div className="saved-quote-handoff-copy">
              <p className="eyebrow">
                {focusedRebookDeliveryGate.applies && !focusedRebookDeliveryGate.ready
                  ? "Rebook review required"
                  : focusedDelivery.reviewRequired
                  ? "Delivery needs review"
                  : focusedDelivery.activeLease
                    ? "Delivery in progress"
                    : focusedDelivery.freshAttemptAvailable
                      ? "New delivery attempt available"
                    : focusedDelivery.retryAvailable
                      ? "Delivery retry available"
                    : focusedQuoteIsDraft
                  ? focusReason === "updated" ? "Draft updated" : "Draft saved"
                  : `Quote ${focusedQuoteStatus}`}
              </p>
              <h3 id="saved-quote-handoff-title">
                {formatWorkspaceText(focusedQuote.quoteNumber, { emptyLabel: "Quote number pending" })}
              </h3>
              <div className="history-meta-stack" aria-label="Focused quote lifecycle">
                <small>Quote / proposal lifecycle</small>
                <StatusChip {...focusedQuoteStatusSemantics.lifecycle} />
              </div>
              <p id="saved-quote-handoff-description" className="saved-quote-handoff-description">
                {focusedRebookDeliveryGate.applies && !focusedRebookDeliveryGate.ready
                  ? focusedRebookDeliveryGate.message
                  : focusedDelivery.reviewRequired
                  ? "Check the provider outcome, then record whether the email was accepted or was not sent. Quote-changing actions remain locked until review is complete."
                  : focusedDelivery.activeLease
                    ? "Provider delivery is in progress. Quote-changing actions are temporarily locked."
                    : focusedDelivery.freshAttemptAvailable
                      ? "The provider definitively rejected the prior attempt. Starting again creates a fresh delivery generation for this saved revision."
                    : focusedDelivery.retryAvailable
                      ? "The prior attempt did not finish cleanly. Retry this exact saved revision within the provider idempotency window."
                    : focusedQuoteIsDraft
                  ? focusReason === "updated"
                    ? `Changes are saved. This action did not send or resend the quote to ${focusedQuote.customer?.email || "the customer"}.`
                    : `Saved as a draft. It has not been sent to ${focusedQuote.customer?.email || "the customer"}.`
                  : `Current quote status is ${focusedQuoteStatus}.`}
              </p>
              {focusedRebookDeliveryGate.applies
                && focusedRebookDeliveryGate.ready
                && !focusedRebookDeliveryGate.deliveryReady && (
                <p className="warning-note" role="status">
                  {focusedRebookDeliveryGate.deliveryMessage}
                </p>
              )}
              {!focusedQuoteCanSend && (
                focusedQuoteCanUsePortal ? (
                  <div className="portal-link-row">
                    <label htmlFor="saved-quote-handoff-portal-link">Customer portal link</label>
                    <input
                      id="saved-quote-handoff-portal-link"
                      type="text"
                      readOnly
                      value={resolveQuotePortalLink(focusedQuote)}
                      onFocus={(event) => event.target.select()}
                    />
                    <button
                      type="button"
                      className="ghost compact"
                      onClick={() => handleCopyPortalLink(focusedQuote)}
                    >
                      Copy
                    </button>
                  </div>
                ) : (
                  <p className="source-note">
                    {state.source === "firebase"
                      ? "Customer portal sharing requires provider acceptance for this revision and a valid future expiry."
                      : "Customer portal sharing requires an active delivered status and valid future expiry."}
                  </p>
                )
              )}
            </div>
            <div className="saved-quote-handoff-actions">
              {focusedRebookDeliveryGate.applies
                && !focusedRebookDeliveryGate.ready
                && permissions.canEditQuote
                && typeof onEditQuote === "function" ? (
                <button
                  type="button"
                  className="cta"
                  onClick={() => onEditQuote(focusedQuote)}
                >
                  Open edit and complete review
                </button>
              ) : focusedDelivery.reviewRequired
                && permissions.canSendQuoteEmail
                && state.source === "firebase" ? (
                <button
                  type="button"
                  className="cta"
                  onClick={() => openDeliveryReview(focusedQuote, focusedQuoteRevisionId)}
                >
                  Review delivery outcome
                </button>
              ) : focusedQuoteCanSend ? (
                <button
                  type="button"
                  className="cta"
                  onClick={() => handleSendQuoteEmail(focusedQuote)}
                  disabled={sendingQuoteEmailId === focusedQuote.id}
                  aria-busy={sendingQuoteEmailId === focusedQuote.id}
                  aria-describedby="quote-email-provider-readiness"
                >
                  {sendingQuoteEmailId === focusedQuote.id
                    ? "Sending quote email..."
                    : focusedDelivery.freshAttemptAvailable
                      ? "Start new quote email"
                    : focusedDelivery.retryAvailable
                      ? "Retry quote email"
                      : "Send quote email"}
                </button>
              ) : focusedHandoffPrimaryIsPdf && permissions.canExportProposal ? (
                <button
                  type="button"
                  className="cta"
                  onClick={() => handleExportPdf(focusedQuote)}
                  disabled={exportingPdfId === focusedQuote.id || !focusedRebookDeliveryGate.ready}
                  title={!focusedRebookDeliveryGate.ready ? focusedRebookDeliveryGate.message : ""}
                  aria-busy={exportingPdfId === focusedQuote.id}
                >
                  {exportingPdfId === focusedQuote.id ? "Generating draft PDF..." : "Download draft PDF"}
                </button>
              ) : permissions.canCopyArtifacts && focusedQuoteCanUsePortal ? (
                <button
                  type="button"
                  className="cta"
                  onClick={() => handleCopyPortalLink(focusedQuote)}
                >
                  Copy customer portal link
                </button>
              ) : null}
              {focusedDelivery.reviewAvailable
                && !focusedDelivery.reviewRequired
                && permissions.canSendQuoteEmail
                && state.source === "firebase" && (
                <button
                  type="button"
                  className="ghost"
                  onClick={() => openDeliveryReview(focusedQuote, focusedQuoteRevisionId)}
                >
                  Review provider outcome
                </button>
              )}
              {permissions.canExportProposal && !focusedHandoffPrimaryIsPdf && (
                <button
                  type="button"
                  className="ghost"
                  onClick={() => handleExportPdf(focusedQuote)}
                  disabled={exportingPdfId === focusedQuote.id || !focusedRebookDeliveryGate.ready}
                  title={!focusedRebookDeliveryGate.ready ? focusedRebookDeliveryGate.message : ""}
                  aria-busy={exportingPdfId === focusedQuote.id}
                >
                  {exportingPdfId === focusedQuote.id ? "Generating PDF..." : "Download PDF"}
                </button>
              )}
              {permissions.canExportProposal && (
                <button
                  type="button"
                  className="ghost"
                  onClick={() => handlePrintProposal(focusedQuote)}
                  disabled={exportingPdfId === focusedQuote.id || !focusedRebookDeliveryGate.ready}
                  title={!focusedRebookDeliveryGate.ready ? focusedRebookDeliveryGate.message : "Open a print-ready proposal PDF"}
                >
                  {exportingPdfId === focusedQuote.id ? "Preparing proposal…" : "Print proposal"}
                </button>
              )}
              {permissions.canCopyArtifacts && focusedQuote?.customer?.email && (
                <button
                  type="button"
                  className="ghost"
                  onClick={() => handleOpenDefaultEmailApp(focusedQuote)}
                  disabled={!focusedRebookDeliveryGate.ready}
                  title={!focusedRebookDeliveryGate.ready ? focusedRebookDeliveryGate.message : "Open a prefilled message without changing delivery status"}
                >
                  Open email app
                </button>
              )}
              {!focusedQuoteCanSend && focusedQuoteEmailUnconfigured && integrationsAvailable && (
                <button type="button" className="ghost" onClick={handleOpenIntegrations}>
                  Set up email in Integrations
                </button>
              )}
              {!focusedQuoteCanSend && focusedQuoteEmailUnconfigured && !integrationsAvailable && (
                <span className="muted">Email provider setup is unavailable in this workspace.</span>
              )}
              {!focusedQuoteCanSend && permissions.role === "sales" && (
                <span className="muted">Use Copy Email or Download PDF for an admin handoff.</span>
              )}
            </div>
          </section>
        )}
        {focusedQuoteIsVisible
          && !administrationFocusActive
          && state.source === "firebase"
          && ["admin", "sales"].includes(permissions.role) && (
          <CommercialDependencyStatePanel
            organizationId={organizationId}
            quoteId={focusedQuote.id}
            quoteNumber={focusedQuote.quoteNumber}
            available={Boolean(organizationId)}
            canReconcile
            onOpenKitchenBeo={beoAvailable
              ? () => handleOpenKitchenBeo(focusedQuote)
              : undefined}
            onOpenProductionChecklist={scheduleAvailable && typeof onOpenSchedule === "function"
              ? () => onOpenSchedule(focusedQuote.id)
              : undefined}
          />
        )}
        {focusedQuoteIsVisible && !administrationFocusActive && state.source === "firebase" && (
          <QuoteDecisionDebtPanel
            organizationId={organizationId}
            quoteId={focusedQuote.id}
            timeZone={tenantTimeZone}
            available={Boolean(organizationId)}
            onOpenWorkflow={onOpenWorkflow}
            onReadStateChange={handleFocusedDecisionDebtRead}
          />
        )}
        {AMBIENT_UI_ENABLED && !administrationFocusActive && AmbientOpportunitiesStream && (
          <Suspense fallback={(
            <section
              className="ambient-opportunities-loading"
              data-surface-purpose="reveal_context"
              role="status"
              aria-live="polite"
            >
              Gathering the current opportunity view. Completed quote records remain unchanged.
            </section>
          )}>
            <AmbientOpportunitiesStream
              organizationId={organizationId}
              catalog={ambientPricingCatalog}
              inquiryShowcaseEnabled={inquiryShowcaseEnabled}
              headingRef={routeHeadingRef}
              quotes={state.quotes}
              source={state.source}
              readBoundary={ambientOpportunityReadBoundary}
              currentUserRole={permissions.role}
              nowISO={state.loadedAtISO}
              canOpenOpportunity={["admin", "sales"].includes(permissions.role)}
              canOpenWorkflow={["admin", "sales"].includes(permissions.role)}
              canStartOpportunity={["admin", "sales"].includes(permissions.role)}
              canRefresh={["admin", "sales"].includes(permissions.role)}
              onOpenOpportunity={onOpenOpportunity}
              onOpenWorkflow={onOpenWorkflow}
              onStartOpportunity={onStartOpportunity}
              onRefresh={load}
              onInquiryQuoteCreated={(quoteId) => {
                load();
                onOpenOpportunity?.({ quoteId, actionId: `open-inquiry-conversion:${quoteId}` });
              }}
              controller={quoteHistoryController}
            />
          </Suspense>
        )}
        <QuoteAdministrationBoundary
          ambient={AMBIENT_UI_ENABLED}
          initiallyOpen={administrationFocusActive}
          open={administrationOpen}
          onOpenChange={setAdministrationOpen}
        >
          {() => (
          <>
        <div className="history-controls">
          <input
            type="text"
            aria-label="Search quotes"
            data-view-filter="quote-search"
            placeholder="Search customer, quote #, or event"
            value={query}
            onChange={(e) => setQuery(e.target.value)}
          />
          <div data-view-filter="event-type">
            <AdaptiveChoiceField
              id="quote-event-type-filter"
              label="Event type"
              options={eventTypeFilterOptions}
              value={eventTypeFilter}
              onChange={(event) => {
                setEventTypeFilter(event.target.value);
                updateQuoteFilterLocation(event.target.value, statusFilter);
              }}
              emptyState={eventTypesError ? "unavailable" : "blocked"}
              emptyReason={eventTypesError
                ? `${eventTypesError}${eventTypeFilter !== "all" ? ` Current filter “${eventTypeFilter}” remains preserved.` : ""}`
                : "Event type filters are still loading."}
              recoveryAction={retryEventTypes}
              fieldState={eventTypesError
                ? { evidence: "failed" }
                : eventTypeFilterUnavailable
                  ? { evidence: "stale", editability: "draft" }
                  : undefined}
              fieldStateDetails={eventTypesError ? {
                reason: eventTypesError,
                recoveryAction: retryEventTypes
              } : eventTypeFilterUnavailable ? {
                reason: "This saved filter is outside the current event type set; it remains selected until you clear or replace it.",
                recoveryAction: {
                  label: "Clear event type filter",
                  onClick: () => {
                    setEventTypeFilter("all");
                    updateQuoteFilterLocation("all", statusFilter);
                  }
                }
              } : {}}
              singleChoiceDetail="No event-type-specific filter is available, so all event types are shown."
            />
          </div>
          <div data-view-filter="quote-status">
            <AdaptiveChoiceField
              id="quote-status-filter"
              label="Quote status"
              options={QUOTE_STATUS_FILTER_OPTIONS}
              value={statusFilter}
              onChange={(event) => {
                setStatusFilter(event.target.value);
                updateQuoteFilterLocation(eventTypeFilter, event.target.value);
              }}
              emptyReason="Quote status filters are unavailable."
              recoveryAction={{ label: "Clear filters", onClick: clearFilters }}
            />
          </div>
          <p className="history-result-count" role="status">
            Showing {filteredQuotes.length} of {state.quotes.length} quotes
          </p>
        </div>
        <div className="history-table-wrap" aria-busy={state.loading}>
          <table>
            <thead>
              <tr>
                <th>Quote #</th>
                <th>Customer</th>
                <th>Event Type</th>
                <th>Event Date</th>
                <th>Guests</th>
                <th>Total</th>
                <th>Deposit</th>
                <th>Status</th>
                <th>Payment</th>
                <th>Contract</th>
                <th>Confirm</th>
                <th>Expires</th>
                <th>Updated</th>
                <th>Actions</th>
              </tr>
            </thead>
            <tbody>
              {state.loading && [1, 2, 3].map((row) => (
                <tr className="history-skeleton-row" key={`history-skeleton-${row}`} aria-hidden="true">
                  {Array.from({ length: 14 }, (_, column) => (
                    <td key={column}><span /></td>
                  ))}
                </tr>
              ))}
              {!state.loading && state.quotes.length === 0 && (
                <tr>
                  <td colSpan="14">No quotes saved yet.</td>
                </tr>
              )}
              {!state.loading && state.quotes.length > 0 && filteredQuotes.length === 0 && (
                <tr>
                  <td colSpan="14">
                    <div className="history-empty-filtered">
                      <span>
                        {normalizedCustomerQuery
                          ? `No quotes match '${query.trim()}'.`
                          : "No quotes match these filters."}
                      </span>
                      {hasActiveFilters && (
                        <button type="button" className="ghost compact" onClick={clearFilters}>
                          Clear filters
                        </button>
                      )}
                    </div>
                  </td>
                </tr>
              )}
              {filteredQuotes.map((quote) => {
                const normalizedQuoteStatus = String(quote.status || "draft").trim().toLowerCase();
                const statusTransitions = getAllowedStatusTransitions(quote.status)
                  .filter((status) => status !== "booked" && status !== "deleted")
                  .filter((status) => (
                    state.source !== "firebase"
                    || status === normalizedQuoteStatus
                    || status === "expired"
                  ));
                const statusOptions = statusTransitions.length
                  ? statusTransitions
                  : [String(quote.status || "draft")];
                const booking = quote.booking || {};
                const contractNumber = booking.contractNumber || "";
                const confirmationStatus = booking.confirmationStatus || "pending";
                const statusSemantics = getQuoteHistoryStatusSemantics(quote);
                const canConvert = canConvertToContract(quote);
                const canTrackConfirmation = quote.status === "booked" && Boolean(contractNumber);
                const canRotatePortalForStatus = canRotateQuotePortal(normalizedQuoteStatus);
                const approvalRequired = state.source === "firebase";
                const contractApproval = getExecutableApprovalRequest(
                  quote,
                  "convert_to_contract",
                  approvalExecutionOptions()
                );
                const contractConversionState = getContractConversionMutationState(
                  contractConversions,
                  quote.id
                );
                const contractConversionActive = Boolean(contractConversions[quote.id]);
                const contractConversionPresentation = buildContractConversionMutationPresentation({
                  ...contractConversionState,
                  approvalReady: !approvalRequired || Boolean(contractApproval)
                });
                const contractConversionBusy = ["submitting", "reconciliation", "recovery"]
                  .includes(contractConversionState.phase);
                const paymentRequestApproval = getExecutableApprovalRequest(
                  quote,
                  "send_payment_request",
                  approvalExecutionOptions({ allowInProgressRecovery: true })
                );
                const paymentRequestInProgress = String(
                  paymentRequestApproval?.executionState || ""
                ).trim().toLowerCase() === "in_progress";
                const finalBalanceApproval = getExecutableApprovalRequest(
                  quote,
                  "send_final_balance_request",
                  approvalExecutionOptions({ allowInProgressRecovery: true })
                );
                const finalBalanceRequestInProgress = String(
                  finalBalanceApproval?.executionState || ""
                ).trim().toLowerCase() === "in_progress";
                const portalRotationApproval = getExecutableApprovalRequest(
                  quote,
                  "rotate_portal_link",
                  approvalExecutionOptions()
                );
                const deleteApproval = getExecutableApprovalRequest(
                  quote,
                  "delete_quote",
                  approvalExecutionOptions()
                );
                const quoteEventTypeId = String(quote.eventTypeId || quote.selection?.eventTypeId || "");
                const quoteEventTypeLabel = eventTypeNameById.get(quoteEventTypeId)
                  || humanizeWorkspaceValue(quoteEventTypeId, { emptyLabel: "Event type not set" });
                const financialCells = getQuoteHistoryFinancialCells(quote);
                const quoteIsDraft = normalizedQuoteStatus === "draft";
                let quoteRevisionId = "";
                try {
                  quoteRevisionId = resolveQuoteDeliveryRevisionId(quote);
                } catch {
                  quoteRevisionId = "";
                }
                const deliveryUi = getQuoteDeliveryUiState(
                  quote,
                  quoteRevisionId,
                  deliveryClockMs
                );
                const deliveryRecorded = deliveryUi.recorded;
                const deliveryUnresolved = deliveryUi.mutationLocked;
                const rebookDeliveryGate = getRebookDeliveryGate(quote, { tenantTimeZone });
                const canDeliverCurrentQuote = state.source === "firebase"
                  && canDeliverQuoteEmailStatus(normalizedQuoteStatus)
                  && Boolean(quoteRevisionId)
                  && deliveryUi.canAttempt
                  && rebookDeliveryGate.deliveryReady
                  && emailSetup.checked
                  && emailSetup.configured;
                const portalShareable = rebookDeliveryGate.ready && isCustomerPortalShareable(quote, {
                  requireDeliveryEvidence: state.source === "firebase"
                });
                const publishedPaymentLink = (
                  String(quote.payment?.depositStatus || "").trim().toLowerCase() === "sent"
                  && sanitizeStripePaymentLink(quote.payment?.depositLink)
                );
                const finalBalance = quote.payment?.finalBalance || {};
                const finalBalanceStatus = String(finalBalance.status || "unpaid")
                  .trim()
                  .toLowerCase();
                const finalBalanceCheckoutState = String(
                  finalBalance.stripeCheckoutState || ""
                ).trim().toLowerCase();
                const finalBalanceAmountCents = Number(finalBalance.amountCents);
                const showFinalBalance = normalizedQuoteStatus === "booked"
                  && Boolean(contractNumber)
                  && Number.isSafeInteger(finalBalanceAmountCents)
                  && finalBalanceAmountCents > 0;
                const finalBalanceRequestEligible = isFinalBalanceRequestEligible(quote);
                const publishedFinalBalanceLink = finalBalanceRequestEligible
                  && finalBalanceStatus === "sent"
                  && ["", "open"].includes(finalBalanceCheckoutState)
                  && sanitizeStripePaymentLink(finalBalance.paymentLink);
                const canReconcilePayment = permissions.canReconcilePayment
                  && Boolean(String(quote.payment?.stripeSessionId || "").trim())
                  && !["paid", "refunded"].includes(
                    String(quote.payment?.depositStatus || "").trim().toLowerCase()
                  );
                const canReconcileFinalBalance = permissions.canReconcileFinalBalance
                  && finalBalanceRequestEligible
                  && Boolean(String(finalBalance.stripeSessionId || "").trim());
                const sendQuoteDisabledReason = state.source !== "firebase"
                  ? "Provider email requires Firebase-backed quote storage."
                  : !rebookDeliveryGate.deliveryReady
                    ? rebookDeliveryGate.deliveryMessage
                    : deliveryRecorded
                      ? "This saved revision already has provider acceptance evidence."
                      : deliveryUi.activeLease
                        ? "Delivery is still in progress. The safe retry action unlocks after this lease expires."
                        : !emailSetup.checked || !emailSetup.configured
                          ? "Configure a supported email provider in Integration Ops first."
                          : !quoteRevisionId
                            ? "Save this quote as a versioned draft before sending."
                            : !canDeliverQuoteEmailStatus(normalizedQuoteStatus)
                              ? "Only draft, sent, viewed, accepted, or booked quotes can be delivered by quote email."
                              : "";
                const configuredActionRuntime = {
                  convert_contract: {
                    visible: canConvert && !["error", "recovery", "receipt"].includes(contractConversionState.phase),
                    enabled: !deliveryUnresolved
                      && !contractConversionBusy
                      && convertingId !== quote.id
                      && (
                        contractConversionState.phase === "uncertain"
                        || !approvalRequired
                        || Boolean(contractApproval)
                      ),
                    disabledReason: deliveryUnresolved
                      ? DELIVERY_LOCK_REASON
                      : contractConversionBusy || convertingId === quote.id
                        ? "Contract conversion is already in progress."
                        : approvalRequired && !contractApproval
                          ? "Approve contract conversion in Workflow first."
                          : "",
                    label: contractConversionState.phase === "reconciliation"
                      ? "Reconciling..."
                      : contractConversionState.phase === "submitting" || convertingId === quote.id
                        ? "Converting..."
                        : contractConversionState.phase === "uncertain"
                          ? "Reconcile conversion"
                          : ""
                  },
                  convert_contract_refresh: {
                    visible: canConvert && contractConversionActive && contractConversionState.phase === "error",
                    enabled: true
                  },
                  manage_confirmation: {
                    visible: canTrackConfirmation && confirmationStatus !== "confirmed",
                    enabled: updatingConfirmationId !== quote.id && !deliveryUnresolved,
                    disabledReason: deliveryUnresolved
                      ? DELIVERY_LOCK_REASON
                      : "Booking confirmation is already being updated."
                  },
                  change_status: {
                    visible: state.source === "firebase"
                      && normalizedQuoteStatus !== "expired"
                      && statusOptions.includes("expired"),
                    enabled: updatingId !== quote.id && !deliveryUnresolved,
                    disabledReason: deliveryUnresolved
                      ? DELIVERY_LOCK_REASON
                      : "Quote status is already being updated."
                  },
                  edit: {
                    visible: canEditQuoteStatus(normalizedQuoteStatus),
                    enabled: !deliveryUnresolved,
                    disabledReason: DELIVERY_LOCK_REASON
                  },
                  reopen: {
                    visible: normalizedQuoteStatus === "expired",
                    enabled: !deliveryUnresolved && reopeningQuoteId !== quote.id,
                    disabledReason: deliveryUnresolved
                      ? DELIVERY_LOCK_REASON
                      : "This quote is already being restored.",
                    label: reopeningQuoteId === quote.id ? "Restoring..." : ""
                  },
                  duplicate: {
                    enabled: duplicatingId !== quote.id && !deliveryUnresolved,
                    disabledReason: deliveryUnresolved
                      ? DELIVERY_LOCK_REASON
                      : "An alternate draft is already being created.",
                    label: duplicatingId === quote.id ? "Creating draft..." : ""
                  },
                  export_proposal: {
                    enabled: exportingPdfId !== quote.id && rebookDeliveryGate.ready,
                    disabledReason: !rebookDeliveryGate.ready
                      ? rebookDeliveryGate.message
                      : "The proposal artifact is already being generated.",
                    label: exportingPdfId === quote.id ? "Generating PDF..." : ""
                  },
                  print_proposal: {
                    visible: true,
                    enabled: exportingPdfId !== quote.id && rebookDeliveryGate.ready,
                    disabledReason: !rebookDeliveryGate.ready
                      ? rebookDeliveryGate.message
                      : "The proposal artifact is already being generated.",
                    label: "Print"
                  },
                  manual_email: {
                    visible: Boolean(quote?.customer?.email),
                    enabled: rebookDeliveryGate.ready,
                    disabledReason: rebookDeliveryGate.message,
                    label: "Manual email"
                  },
                  review_beo: {
                    enabled: exportingLocalBeoId !== quote.id && rebookDeliveryGate.ready,
                    disabledReason: !rebookDeliveryGate.ready
                      ? rebookDeliveryGate.message
                      : "The Kitchen BEO is already being prepared."
                  },
                  review_delivery: {
                    visible: state.source === "firebase" && deliveryUi.reviewRequired,
                    enabled: true
                  },
                  send_quote: {
                    visible: !deliveryRecorded && !deliveryUi.reviewRequired,
                    enabled: sendingQuoteEmailId !== quote.id && canDeliverCurrentQuote,
                    disabledReason: sendingQuoteEmailId === quote.id
                      ? "Proposal delivery is already in progress."
                      : sendQuoteDisabledReason,
                    label: sendingQuoteEmailId === quote.id
                      ? "Sending..."
                      : deliveryUi.freshAttemptAvailable
                        ? "Send proposal again"
                        : deliveryUi.retryAvailable
                          ? "Retry proposal send"
                          : ""
                  },
                  review_delivery_evidence: {
                    visible: state.source === "firebase"
                      && deliveryUi.reviewAvailable
                      && !deliveryUi.reviewRequired,
                    enabled: true
                  },
                  request_deposit: {
                    enabled: sendingPaymentEmailId !== quote.id
                      && !deliveryUnresolved
                      && (portalShareable || paymentRequestInProgress),
                    disabledReason: sendingPaymentEmailId === quote.id
                      ? "The deposit request is already being submitted."
                      : !portalShareable && !paymentRequestInProgress
                        ? "Payment email requires an active customer portal for the current provider-accepted issuance."
                        : "",
                    label: sendingPaymentEmailId === quote.id
                      ? paymentRequestInProgress ? "Resuming..." : "Sending..."
                      : ""
                  },
                  request_balance: {
                    visible: finalBalanceRequestEligible || finalBalanceRequestInProgress,
                    enabled: sendingFinalBalanceEmailId !== quote.id
                      && !deliveryUnresolved
                      && (portalShareable || finalBalanceRequestInProgress),
                    disabledReason: sendingFinalBalanceEmailId === quote.id
                      ? "The final-balance request is already being submitted."
                      : !portalShareable && !finalBalanceRequestInProgress
                        ? "Final-balance email requires an active customer portal for the current provider-accepted issuance."
                        : "",
                    label: sendingFinalBalanceEmailId === quote.id
                      ? finalBalanceRequestInProgress ? "Resuming..." : "Sending..."
                      : finalBalanceRequestInProgress
                        ? "Resume final balance request"
                        : ""
                  },
                  rotate_portal: {
                    visible: canRotatePortalForStatus,
                    enabled: !deliveryUnresolved
                      && rotatingPortalId !== quote.id
                      && (!approvalRequired || Boolean(portalRotationApproval)),
                    disabledReason: deliveryUnresolved
                      ? DELIVERY_LOCK_REASON
                      : rotatingPortalId === quote.id
                        ? "Customer access is already being renewed."
                        : approvalRequired && !portalRotationApproval
                          ? "Approve customer-link renewal in Workflow first."
                          : "",
                    label: rotatingPortalId === quote.id ? "Renewing..." : ""
                  },
                  open_conversation: {
                    visible: state.source === "firebase" && portalConversationAvailable() && portalShareable,
                    enabled: canOpenQuoteConversation(conversationQuote),
                    disabledReason: "Close the current quote conversation before opening another."
                  },
                  copy_email: {
                    enabled: rebookDeliveryGate.ready,
                    disabledReason: rebookDeliveryGate.message
                  },
                  copy_portal: {
                    enabled: portalShareable,
                    disabledReason: state.source === "firebase"
                      ? "Customer portal sharing requires provider acceptance for this revision and a valid future expiry."
                      : "Customer portal sharing requires an active delivered status and valid future expiry."
                  },
                  copy_payment_link: { visible: Boolean(publishedPaymentLink), enabled: Boolean(publishedPaymentLink) },
                  copy_balance_link: { visible: Boolean(publishedFinalBalanceLink), enabled: Boolean(publishedFinalBalanceLink) },
                  delete: {
                    visible: canDeleteQuotes,
                    enabled: !deliveryUnresolved
                      && updatingId !== quote.id
                      && (!approvalRequired || Boolean(deleteApproval)),
                    disabledReason: deliveryUnresolved
                      ? DELIVERY_LOCK_REASON
                      : updatingId === quote.id
                        ? "This quote is already being deleted."
                        : approvalRequired && !deleteApproval
                          ? "Approve quote deletion in Workflow first."
                          : "",
                    label: updatingId === quote.id ? "Deleting..." : ""
                  },
                  reconcile_deposit: {
                    visible: canReconcilePayment,
                    enabled: reconcilingPaymentId !== quote.id && !deliveryUnresolved,
                    disabledReason: deliveryUnresolved
                      ? DELIVERY_LOCK_REASON
                      : "The deposit outcome is already being checked.",
                    label: reconcilingPaymentId === quote.id ? "Checking..." : ""
                  },
                  reconcile_balance: {
                    visible: canReconcileFinalBalance,
                    enabled: reconcilingFinalBalanceId !== quote.id && !deliveryUnresolved,
                    disabledReason: deliveryUnresolved
                      ? DELIVERY_LOCK_REASON
                      : "The final-balance outcome is already being checked.",
                    label: reconcilingFinalBalanceId === quote.id ? "Checking..." : ""
                  }
                };
                const configuredActionState = buildRoleSafeQuoteActionController({
                  quote,
                  currentUserRole: permissions.role,
                  source: state.source,
                  runtimeActions: configuredActionRuntime
                }).actionState;
                const configuredPrimaryActionId = configuredActionState.primaryAction?.id || "";
                const configuredPrimaryAction = configuredActionState.primaryAction;
                const configuredActions = configuredActionState.actions;
                const rowActionClassName = (actionId) => (
                  configuredPrimaryActionId === actionId ? "cta compact" : "ghost compact"
                );
                return (
                  <tr
                    key={quote.id}
                    data-quote-id={quote.id}
                    className={quote.id === focusQuoteId ? "history-row-target" : ""}
                  >
                    <td>
                      <button
                        type="button"
                        className="button-link history-quote-workspace-link"
                        onClick={() => openQuoteWorkspace(quote.id)}
                        aria-label={`Open ${formatWorkspaceText(quote.quoteNumber, { emptyLabel: "quote" })} workspace`}
                      >
                        {formatWorkspaceText(quote.quoteNumber, { emptyLabel: "Quote number pending" })}
                      </button>
                    </td>
                    <td>{formatWorkspaceText(quote.customer?.name || quote.customer?.email, { emptyLabel: "Customer not recorded" })}</td>
                    <td>{quoteEventTypeLabel}</td>
                    <td>{fmtDate(quote.event?.date)}</td>
                    <td>{formatWorkspaceInteger(quote.event?.guests, { emptyLabel: "Guest count not set" })}</td>
                    <td>{financialCells.total}</td>
                    <td>{financialCells.deposit}</td>
                    <td>
                      <div className="history-meta-stack">
                        <small>Quote / proposal lifecycle</small>
                        <StatusChip {...statusSemantics.lifecycle} />
                        {permissions.canManageQuoteStatus && state.source !== "firebase" && (
                          <AdaptiveChoiceField
                            id={`quote-lifecycle-${quote.id}`}
                            label="Change quote / proposal lifecycle"
                            options={statusOptions.map((status) => ({
                              value: status,
                              label: classifyQuoteStatus(status).label
                            }))}
                            value={quote.status || "draft"}
                            onChange={(event) => handleStatusUpdate(quote.id, event.target.value)}
                            disabled={updatingId === quote.id || deliveryUnresolved}
                            emptyReason="No lifecycle transitions are available for this quote."
                            recoveryAction={{ label: "Reload quote history", onClick: load }}
                            fieldState={updatingId === quote.id
                              ? { persistence: "saving" }
                              : deliveryUnresolved
                                ? { editability: "blocked" }
                                : undefined}
                            fieldStateDetails={deliveryUnresolved ? {
                              reason: DELIVERY_LOCK_REASON,
                              recoveryAction: deliveryUi.reviewRequired
                                ? {
                                    label: "Review provider outcome",
                                    onClick: () => openDeliveryReview(quote, quoteRevisionId)
                                  }
                                : { label: "Refresh delivery status", onClick: load }
                            } : {}}
                            singleChoiceDetail="This is the only lifecycle state currently authorized for this quote."
                          />
                        )}
                        {deliveryUi.reviewRequired ? (
                          <small>Delivery readiness: Review required</small>
                        ) : deliveryUi.activeLease ? (
                          <small>Delivery readiness: Delivery in progress</small>
                        ) : deliveryUi.freshAttemptAvailable ? (
                          <small>Delivery readiness: New attempt available</small>
                        ) : deliveryUi.retryAvailable ? (
                          <small>Delivery readiness: Safe retry available</small>
                        ) : null}
                        {rebookDeliveryGate.applies && (
                          <small className={rebookDeliveryGate.ready ? "source-note" : "warning-note"}>
                            Rebook review: {rebookDeliveryGate.ready ? "Completed" : "Required before delivery"}
                          </small>
                        )}
                        {rebookDeliveryGate.applies
                          && rebookDeliveryGate.ready
                          && !rebookDeliveryGate.deliveryReady && (
                          <small className="warning-note">{rebookDeliveryGate.deliveryMessage}</small>
                        )}
                      </div>
                    </td>
                    <td>
                      <div className="history-meta-stack">
                        <small>Deposit</small>
                        <StatusChip {...statusSemantics.deposit} />
                        {showFinalBalance && (
                          <>
                            <small>Final balance</small>
                            <StatusChip {...statusSemantics.finalBalance} />
                            <small>{currency(finalBalanceAmountCents / 100)}</small>
                          </>
                        )}
                      </div>
                    </td>
                    <td>
                      <div className="history-meta-stack">
                        <strong>{formatWorkspaceText(contractNumber, { emptyLabel: "Not booked" })}</strong>
                        <small>{fmtDate(booking.contractConvertedAtISO)}</small>
                      </div>
                    </td>
                    <td>
                      {canTrackConfirmation ? (
                        <div className="history-meta-stack">
                          <small>Booking confirmation</small>
                          <StatusChip {...statusSemantics.bookingConfirmation} />
                          {permissions.canManageConfirmation && (
                            <select
                              value={confirmationStatus}
                              onChange={(e) => handleConfirmationUpdate(quote.id, e.target.value)}
                              disabled={updatingConfirmationId === quote.id || deliveryUnresolved}
                            >
                              {BOOKING_CONFIRMATION_STATUSES.map((bookingStatus) => (
                                <option key={bookingStatus} value={bookingStatus}>
                                  {classifyBookingConfirmation(bookingStatus).label}
                                </option>
                              ))}
                            </select>
                          )}
                          <small>{fmtDate(booking.confirmedAtISO || booking.confirmationSentAtISO)}</small>
                        </div>
                      ) : (
                        <span className="muted">Not applicable</span>
                      )}
                    </td>
                    <td>{fmtDate(quote.expiresAtISO)}</td>
                    <td>{fmtDate(quote.updatedAtISO || quote.createdAtISO)}</td>
                    <td>
                      <ConfiguredQuoteActionRail
                        primaryActionId={configuredPrimaryActionId}
                        primaryAction={configuredPrimaryAction}
                        actions={configuredActions}
                      >
                        {permissions.canConvertToContract && (canConvert || contractConversionActive) && (
                          <ContractConversionMutationStatus
                            data-quote-action-kind="evidence"
                            presentation={contractConversionPresentation}
                            showReady
                          />
                        )}
                        {configuredActions.convert_contract.visible && (
                            <button
                              type="button"
                              data-approval-action="convert_to_contract"
                              data-quote-action-id="convert_contract"
                              data-quote-action-group="booking"
                              className={rowActionClassName("convert_contract")}
                              onClick={() => handleConvertToContract(quote, {
                                reconcile: contractConversionState.phase === "uncertain"
                              })}
                            >
                              {configuredActions.convert_contract.label}
                            </button>
                          )}
                        {configuredActions.convert_contract_refresh.visible && (
                            <button
                              type="button"
                              className={rowActionClassName("convert_contract_refresh")}
                              data-quote-action-id="convert_contract_refresh"
                              data-quote-action-group="recovery"
                              onClick={() => handleRecoverContractConversion(quote)}
                            >
                              {configuredActions.convert_contract_refresh.label}
                            </button>
                          )}
                        {configuredActions.manage_confirmation.visible && (
                          <button
                            type="button"
                            className={rowActionClassName("manage_confirmation")}
                            data-quote-action-id="manage_confirmation"
                            data-quote-action-group="booking"
                            onClick={() => handleConfirmationUpdate(quote.id, "confirmed")}
                          >
                            {configuredActions.manage_confirmation.label}
                          </button>
                        )}
                        {configuredActions.change_status.visible && (
                          <button
                            type="button"
                            className="ghost compact"
                            data-quote-action-id="change_status"
                            data-quote-action-group="administration"
                            onClick={() => handleStatusUpdate(quote.id, "expired")}
                          >
                            {configuredActions.change_status.label}
                          </button>
                        )}
                        {configuredActions.edit.visible && (
                          <button
                            type="button"
                            className={rowActionClassName("edit")}
                            data-quote-action-id="edit"
                            data-quote-action-group="quote"
                            onClick={() => handleEditQuote(quote)}
                          >
                            {configuredActions.edit.label}
                          </button>
                        )}
                        {configuredActions.reopen.visible && (
                          <button
                            type="button"
                            className={rowActionClassName("reopen")}
                            data-quote-action-id="reopen"
                            data-quote-action-group="quote"
                            onClick={() => handleReopenQuote(quote)}
                          >
                            {configuredActions.reopen.label}
                          </button>
                        )}
                        {configuredActions.duplicate.visible && (
                          <button
                            type="button"
                            className={rowActionClassName("duplicate")}
                            data-quote-action-id="duplicate"
                            data-quote-action-group="quote"
                            onClick={() => handleDuplicateQuote(quote)}
                          >
                            {configuredActions.duplicate.label}
                          </button>
                        )}
                        {configuredActions.export_proposal.visible && (
                          <button
                            type="button"
                            className="ghost compact"
                            data-quote-action-id="export_proposal"
                            data-quote-action-group="proposal"
                            onClick={() => handleExportPdf(quote)}
                          >
                            {configuredActions.export_proposal.label}
                          </button>
                        )}
                        {configuredActions.print_proposal.visible && (
                          <button
                            type="button"
                            className="ghost compact"
                            data-quote-action-id="print_proposal"
                            data-quote-action-group="proposal"
                            onClick={() => handlePrintProposal(quote)}
                          >
                            {configuredActions.print_proposal.label}
                          </button>
                        )}
                        {configuredActions.manual_email.visible && (
                          <button
                            type="button"
                            className="ghost compact"
                            data-quote-action-id="manual_email"
                            data-quote-action-group="communication"
                            onClick={() => handleOpenDefaultEmailApp(quote)}
                          >
                            {configuredActions.manual_email.label}
                          </button>
                        )}
                        {configuredActions.review_beo.visible && (
                          <QuoteHistoryKitchenBeoAction
                            data-quote-action-id="review_beo"
                            data-quote-action-group="operations"
                            source={state.source}
                            quote={quote}
                            disabled={!configuredActions.review_beo.enabled}
                            disabledReason={configuredActions.review_beo.disabledReason}
                            exportingLocal={exportingLocalBeoId === quote.id}
                            onOpenAuthoritative={handleOpenKitchenBeo}
                            onExportLocal={handleExportLocalBeo}
                          />
                        )}
                        {configuredActions.review_delivery.visible ? (
                          <button
                            type="button"
                            className={rowActionClassName("review_delivery")}
                            data-quote-action-id="review_delivery"
                            data-quote-action-group="recovery"
                            onClick={() => openDeliveryReview(quote, quoteRevisionId)}
                          >
                            {configuredActions.review_delivery.label}
                          </button>
                        ) : deliveryRecorded ? (
                          <small
                            className="source-note"
                            data-quote-action-kind="evidence"
                            data-quote-delivery-evidence="provider_accepted"
                          >
                            Delivery: Provider accepted
                          </small>
                        ) : configuredActions.send_quote.visible ? (
                          <button
                            type="button"
                            className={rowActionClassName("send_quote")}
                            data-quote-action-id="send_quote"
                            data-quote-action-group="communication"
                            onClick={() => handleSendQuoteEmail(quote)}
                          >
                            {configuredActions.send_quote.label}
                          </button>
                        ) : null}
                        {configuredActions.review_delivery_evidence.visible && (
                          <button
                            type="button"
                            className="ghost compact"
                            data-quote-action-id="review_delivery_evidence"
                            data-quote-action-group="recovery"
                            onClick={() => openDeliveryReview(quote, quoteRevisionId)}
                          >
                            {configuredActions.review_delivery_evidence.label}
                          </button>
                        )}
                        {configuredActions.request_deposit.visible && (
                          <button
                            type="button"
                            data-approval-action="send_payment_request"
                            data-quote-action-id="request_deposit"
                            data-quote-action-group="payment"
                            className={rowActionClassName("request_deposit")}
                            onClick={() => handleSendPaymentRequestEmail(quote)}
                          >
                            {configuredActions.request_deposit.label}
                          </button>
                        )}
                        {configuredActions.request_balance.visible && (
                          <button
                            type="button"
                            data-approval-action="send_final_balance_request"
                            data-quote-action-id="request_balance"
                            data-quote-action-group="payment"
                            className={rowActionClassName("request_balance")}
                            onClick={() => handleSendFinalBalanceRequestEmail(quote)}
                          >
                            {configuredActions.request_balance.label}
                          </button>
                        )}
                        {configuredActions.rotate_portal.visible && (
                          <button
                            type="button"
                            data-approval-action="rotate_portal_link"
                            data-quote-action-id="rotate_portal"
                            data-quote-action-group="access"
                            className="ghost compact"
                            onClick={() => handleRotatePortalLink(quote)}
                          >
                            {configuredActions.rotate_portal.label}
                          </button>
                        )}
                        {permissions.canCopyArtifacts && (
                          <>
                            {configuredActions.open_conversation.visible && (
                              <button
                                type="button"
                                className={rowActionClassName("open_conversation")}
                                data-quote-action-id="open_conversation"
                                data-quote-action-group="communication"
                                data-capability-action="open-quote-conversation"
                                onClick={() => onOpenConversation
                                  ? onOpenConversation(quote.id)
                                  : setConversationQuote(quote)}
                              >
                                {configuredActions.open_conversation.label}
                              </button>
                            )}
                            {configuredActions.copy_email.visible && (
                              <button
                                type="button"
                                className="ghost compact"
                                data-quote-action-id="copy_email"
                                data-quote-action-group="communication"
                                onClick={() => handleCopyEmail(quote)}
                              >
                                {configuredActions.copy_email.label}
                              </button>
                            )}
                            {configuredActions.copy_portal.visible && (
                              <button
                                type="button"
                                className="ghost compact"
                                data-quote-action-id="copy_portal"
                                data-quote-action-group="communication"
                                onClick={() => handleCopyPortalLink(quote)}
                              >
                                {configuredActions.copy_portal.label}
                              </button>
                            )}
                            {configuredActions.copy_payment_link.visible && (
                              <button
                                type="button"
                                className="ghost compact"
                                data-quote-action-id="copy_payment_link"
                                data-quote-action-group="payment"
                                onClick={() => handleCopyPaymentLink(quote)}
                              >
                                {configuredActions.copy_payment_link.label}
                              </button>
                            )}
                            {configuredActions.copy_balance_link.visible && (
                              <button
                                type="button"
                                className="ghost compact"
                                data-quote-action-id="copy_balance_link"
                                data-quote-action-group="payment"
                                onClick={() => handleCopyFinalBalanceLink(quote)}
                              >
                                {configuredActions.copy_balance_link.label}
                              </button>
                            )}
                          </>
                        )}
                        {configuredActions.delete.visible ? (
                          <button
                            type="button"
                            data-approval-action="delete_quote"
                            data-quote-action-id="delete"
                            data-quote-action-group="administration"
                            className="ghost compact"
                            onClick={() => requestDeleteQuote(quote)}
                          >
                            {configuredActions.delete.label}
                          </button>
                        ) : null}
                        {configuredActions.reconcile_deposit.visible ? (
                          <button
                            type="button"
                            className={rowActionClassName("reconcile_deposit")}
                            data-quote-action-id="reconcile_deposit"
                            data-quote-action-group="recovery"
                            onClick={() => handleReconcilePayment(quote)}
                          >
                            {configuredActions.reconcile_deposit.label}
                          </button>
                        ) : null}
                        {configuredActions.reconcile_balance.visible ? (
                          <button
                            type="button"
                            className={rowActionClassName("reconcile_balance")}
                            data-quote-action-id="reconcile_balance"
                            data-quote-action-group="recovery"
                            onClick={() => handleReconcileFinalBalance(quote)}
                          >
                            {configuredActions.reconcile_balance.label}
                          </button>
                        ) : null}
                      </ConfiguredQuoteActionRail>
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
          </>
          )}
        </QuoteAdministrationBoundary>

        {pendingDeleteQuote && (
          <div className="confirm-modal">
            <p>
              Permanently delete quote <strong>{formatWorkspaceText(pendingDeleteQuote.quoteNumber, { emptyLabel: "Quote number pending" })}</strong>?
              This cannot be undone.
            </p>
            <div className="right-actions">
              <button type="button" className="ghost compact" onClick={() => setPendingDeleteQuote(null)}>
                Cancel
              </button>
              <button
                type="button"
                className="cta compact"
                onClick={confirmDeleteQuote}
                disabled={updatingId === pendingDeleteQuote.id}
              >
                {updatingId === pendingDeleteQuote.id ? "Deleting..." : "Confirm Delete"}
              </button>
            </div>
          </div>
        )}

        {conversationQuote && (
          <aside className="quote-conversation-modal">
            <QuoteConversationPanel
              defaultOpen
              title={`Conversation for ${formatWorkspaceText(conversationQuote.quoteNumber, { emptyLabel: "quote number pending" })}`}
              access={{
                accessMode: "staff",
                organizationId,
                quoteId: conversationQuote.id
              }}
              onClose={() => setConversationQuote(null)}
            />
          </aside>
        )}
        {kitchenBeoQuote && state.source === "firebase" && (
          <KitchenBeoArtifactPanel
            open
            presentation="modal"
            organizationId={organizationId}
            quoteId={kitchenBeoQuote.id}
            quoteNumber={kitchenBeoQuote.quoteNumber}
            currentUserUid={currentUserUid}
            currentUserRole={permissions.role}
            source={state.source}
            sourceVersionId={String(
              kitchenBeoQuote.activeVersionId || kitchenBeoQuote.versionMeta?.versionId || ""
            ).trim()}
            returnFocusRef={kitchenBeoReturnFocusRef}
            onClose={() => setKitchenBeoQuote(null)}
            onOpenProductionChecklist={scheduleAvailable && typeof onOpenSchedule === "function"
              ? () => onOpenSchedule(kitchenBeoQuote.id)
              : undefined}
            onGenerated={(result) => {
              const feedback = result?.idempotent
                ? `Matching server Kitchen BEO receipt confirmed for ${kitchenBeoQuote.quoteNumber}.`
                : `Server Kitchen BEO receipt recorded for ${kitchenBeoQuote.quoteNumber}.`;
              setState((current) => ({ ...current, feedback, error: "" }));
              pushToast(feedback, "success");
            }}
          />
        )}
        {deliveryReview && (
          <section
            className="confirm-modal delivery-review-panel"
            role="group"
            aria-labelledby="delivery-review-title"
            ref={deliveryReviewRef}
            tabIndex={-1}
          >
            <h3 id="delivery-review-title">Resolve delivery for {deliveryReview.quoteNumber}</h3>
            <p>
              Check the email provider before recording an outcome. This audited action either
              restores a fresh safe send cycle or records provider acceptance for the current revision.
            </p>
            {deliveryReview.knownProviderAcceptance && (
              <p className="warning-note" role="status">
                QuotePilot already observed provider acceptance for message {deliveryReview.providerMessageId}.
                That acceptance must be recorded; a no-send resolution is unavailable.
              </p>
            )}
            <AdaptiveChoiceField
              id="quote-provider-outcome"
              label="Provider outcome"
              options={[
                ...(!deliveryReview.knownProviderAcceptance
                  ? [{ value: "confirmed_not_sent", label: "Provider confirms no email was sent" }]
                  : []),
                { value: "provider_accepted", label: "Provider accepted the email" }
              ]}
              value={deliveryReview.resolution}
              onChange={(event) => setDeliveryReview((current) => ({
                ...current,
                resolution: event.target.value,
                providerMessageId: event.target.value === "provider_accepted"
                  ? current.providerMessageId
                  : ""
              }))}
              disabled={resolvingDeliveryId === deliveryReview.quoteId}
              emptyReason="The provider outcome cannot be reviewed from this delivery record."
              recoveryAction={{ label: "Cancel review", onClick: closeDeliveryReview }}
              fieldState={resolvingDeliveryId === deliveryReview.quoteId
                ? { persistence: "saving", evidence: "pending" }
                : undefined}
              singleChoiceDetail="Provider acceptance is already observed for this exact delivery attempt, so the outcome is read-only."
            />
            {deliveryReview.resolution === "provider_accepted" && (
              <label>
                Provider message ID
                <input
                  type="text"
                  value={deliveryReview.providerMessageId}
                  onChange={(event) => setDeliveryReview((current) => ({
                    ...current,
                    providerMessageId: event.target.value
                  }))}
                  autoComplete="off"
                  disabled={resolvingDeliveryId === deliveryReview.quoteId}
                />
              </label>
            )}
            <label>
              Audit note
              <textarea
                value={deliveryReview.note}
                onChange={(event) => setDeliveryReview((current) => ({
                  ...current,
                  note: event.target.value
                }))}
                placeholder="Example: Checked Resend activity; no message exists for this idempotency key."
                maxLength={500}
                disabled={resolvingDeliveryId === deliveryReview.quoteId}
              />
            </label>
            <div className="right-actions">
              <button
                type="button"
                className="ghost compact"
                onClick={closeDeliveryReview}
                disabled={resolvingDeliveryId === deliveryReview.quoteId}
              >
                Cancel
              </button>
              <button
                type="button"
                className="cta compact"
                onClick={submitDeliveryReview}
                disabled={
                  resolvingDeliveryId === deliveryReview.quoteId
                  || deliveryReview.note.trim().length < 8
                  || (
                    deliveryReview.resolution === "provider_accepted"
                    && !deliveryReview.providerMessageId.trim()
                  )
                }
              >
                {resolvingDeliveryId === deliveryReview.quoteId
                  ? "Saving review..."
                  : "Record reviewed outcome"}
              </button>
            </div>
          </section>
        )}
      </div>
    </div>
  );
}

export default function QuoteHistoryModal(props) {
  return <QuoteHistoryView {...props} presentation="modal" />;
}
