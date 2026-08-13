import { lazy, Suspense, useEffect, useMemo, useRef, useState } from "react";
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
import {
  buildQuoteHistoryController,
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
import EventWorkspaceView from "./EventWorkspaceView";
import KitchenBeoArtifactPanel from "./KitchenBeoArtifactPanel";
import QuoteDecisionDebtPanel from "./QuoteDecisionDebtPanel";
import QuoteConversationPanel from "quotepilot-active-conversation-panel";
import StatusChip from "./StatusChip";

const AMBIENT_UI_ENABLED = import.meta.env.VITE_AMBIENT_UI_ENABLED === "1"
  || import.meta.env.VITE_AMBIENT_UI_ENABLED === "true"
  || import.meta.env.VITE_AMBIENT_UI_ENABLED === "yes"
  || import.meta.env.VITE_AMBIENT_UI_ENABLED === "on";
const AmbientLivingOpportunityRoute = AMBIENT_UI_ENABLED
  ? lazy(() => import("./AmbientLivingOpportunityRoute"))
  : null;
const AmbientOpportunitiesStream = AMBIENT_UI_ENABLED
  ? lazy(() => import("./AmbientOpportunitiesStream"))
  : null;

function QuoteAdministrationBoundary({ ambient = false, children }) {
  const [open, setOpen] = useState(false);
  if (!ambient) return children();
  return (
    <details
      className="ambient-opportunities-administration"
      open={open}
      onToggle={(event) => setOpen(event.currentTarget.open)}
    >
      <summary>Quote administration</summary>
      <p className="source-note">
        Open the full role-safe controls for lifecycle, delivery, payment, booking, artifacts, and recovery.
      </p>
      {open ? children() : null}
    </details>
  );
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
  tenantTimeZone = "",
  focusQuoteId = "",
  focusAction = "",
  focusReason = "",
  arrivalContext = null,
  onArrivalResolution = null,
  onEditQuote,
  ambientPricingCatalog = null,
  ambientPricingSettings = null,
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
  onOpenIntegrations,
  integrationsAvailable = true,
  canDeleteQuotes = false,
  onStartOpportunity,
  onToast
}) {
  const embedded = presentation === "embedded";
  const detailMode = embedded && Boolean(String(focusQuoteId || "").trim());
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
    organizationId: ""
  });
  const [emailSetup, setEmailSetup] = useState({
    loading: false,
    checked: false,
    configured: false,
    provider: "",
    error: ""
  });
  const [query, setQuery] = useState("");
  const [eventTypeFilter, setEventTypeFilter] = useState("all");
  const [eventTypes, setEventTypes] = useState([]);
  const [statusFilter, setStatusFilter] = useState("all");
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
    setState((prev) => ({
      ...prev,
      loading: true,
      source: "",
      error: "",
      feedback: "",
      quotes: []
    }));
    if (focusQuoteId) {
      setQuery("");
      setEventTypeFilter("all");
      setStatusFilter("all");
    }
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
            organizationId: requestedOrganizationId
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
        loadedAtISO: new Date().toISOString(),
        organizationId: requestedOrganizationId
      });
      return result;
    } catch (err) {
      if (generation !== loadGenerationRef.current) return null;
      if (targetingSavedQuote) targetLoadPendingRef.current = false;
      loadedFocusQuoteIdRef.current = "";
      setState((prev) => ({
        ...prev,
        loading: false,
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
    getEventTypes({ organizationId })
      .then((items) => {
        if (!alive) return;
        setEventTypes(items);
      })
      .catch(() => {
        if (!alive) return;
        setEventTypes([]);
      });
    return () => {
      alive = false;
    };
  }, [open, organizationId]);

  useEffect(() => {
    if (!open) return;
    const timer = setTimeout(() => load(), 0);
    return () => clearTimeout(timer);
  }, [open, focusQuoteId, organizationId]);

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
    const focusKey = `${focusQuoteId}:${String(focusAction || "").trim()}`;
    if (focusedHandoffIdRef.current === focusKey) return;
    if (loadedFocusQuoteIdRef.current !== focusQuoteId) return;
    const targetQuote = state.quotes.find((quote) => quote.id === focusQuoteId);
    if (!targetQuote) return;
    const normalizedAction = String(focusAction || "").trim();
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
      const focusTarget = actionTarget || handoff;
      focusTarget.focus({ preventScroll: true });
      focusTarget.scrollIntoView({ block: "nearest", inline: "nearest" });
      focusedHandoffIdRef.current = focusKey;
    });
    return () => window.cancelAnimationFrame(frame);
  }, [open, focusQuoteId, focusAction, state.loading, state.quotes, conversationQuote]);

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

  const filteredQuotes = filterQuoteHistoryQuotes(state.quotes, {
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
  };
  const quoteHistoryController = buildQuoteHistoryController({
    quotes: state.quotes,
    visibleQuoteIds: filteredQuotes.map((quote) => quote.id),
    focusQuoteId,
    currentUserRole,
    source: state.source
  });
  const focusedQuote = quoteHistoryController.eventRoom.quote;
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
      return;
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
    } catch (err) {
      setState((prev) => ({
        ...prev,
        error: err?.message || "Failed to delete quote."
      }));
    } finally {
      setUpdatingId("");
    }
  };

  const handleDuplicateQuote = async (quote) => {
    if (!quote?.id) return;
    setDuplicatingId(quote.id);
    setState((prev) => ({ ...prev, error: "" }));
    try {
      const result = await duplicateQuote(quote.id, {
        ownerUid: currentUserUid,
        ownerEmail: currentUserEmail
      });
      setState((prev) => ({
        ...prev,
        feedback: `Quote duplicated as ${result.quoteNumber}.`
      }));
      pushToast(`Quote duplicated as ${result.quoteNumber}.`, "success");
      await load();
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
    await handleDeleteQuote(quoteId);
    setPendingDeleteQuote(null);
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

  if (detailMode) {
    const ordinaryEditAllowed = Boolean(
      focusedQuote
      && permissions.canEditQuote
      && canEditQuoteStatus(focusedQuoteStatus)
      && !focusedDelivery.mutationLocked
      && typeof onEditQuote === "function"
    );
    const beoAvailable = Boolean(
      focusedQuote
      && permissions.canExportBeo
      && focusedRebookDeliveryGate.ready
    );
    const conversationAvailable = Boolean(
      focusedQuote
      && permissions.canCopyArtifacts
      && state.source === "firebase"
      && portalConversationAvailable()
      && focusedQuoteCanUsePortal
    );
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
                ordinaryEditAllowed={ordinaryEditAllowed}
                conversationAvailable={conversationAvailable}
                ambientPricingCatalog={ambientPricingCatalog}
                ambientPricingSettings={ambientPricingSettings}
                globalPilotRequest={globalPilotRequest}
                globalPilotReturnFocusRef={globalPilotReturnFocusRef}
                onGlobalPilotResolution={onGlobalPilotResolution}
                arrivalContext={arrivalContext}
                quoteActionController={quoteHistoryController.actions}
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
                  sourceFreshness: {
                    state: "unknown",
                    reason: "Quote history does not expose a source observation timestamp."
                  },
                  pendingPreview: null
                }}
                onBackToQuotes={onBackToQuotes}
                onEditQuote={handleEditQuote}
                onOpenWorkflow={onOpenWorkflow}
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
          {focusedQuote
            && state.source === "firebase"
            && ["admin", "sales"].includes(permissions.role) && (
            <CommercialDependencyStatePanel
              organizationId={organizationId}
              quoteId={focusedQuote.id}
              quoteNumber={focusedQuote.quoteNumber}
              available={Boolean(organizationId)}
              canReconcile
            />
          )}
          {focusedQuote && state.source === "firebase" && (
            <QuoteDecisionDebtPanel
              organizationId={organizationId}
              quoteId={focusedQuote.id}
              available={Boolean(organizationId)}
              onOpenWorkflow={onOpenWorkflow}
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
              returnFocusRef={kitchenBeoReturnFocusRef}
              onClose={() => setKitchenBeoQuote(null)}
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
      role={embedded ? "region" : "dialog"}
      aria-modal={embedded ? undefined : "true"}
      aria-labelledby="quote-history-title"
    >
      <div className={`modal-card history-card${embedded ? " workspace-route-card" : ""}`} ref={dialogRef} tabIndex={-1}>
        <div className="modal-head">
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
        </div>

        <details className="staff-evidence-disclosure workspace-data-details">
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
        </details>
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
        {state.error && <p className="error-note" role="alert">{state.error}</p>}
        {state.feedback && <p className="source-note" role="status" aria-live="polite">{state.feedback}</p>}
        {focusedQuoteIsVisible && (
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
          && state.source === "firebase"
          && ["admin", "sales"].includes(permissions.role) && (
          <CommercialDependencyStatePanel
            organizationId={organizationId}
            quoteId={focusedQuote.id}
            quoteNumber={focusedQuote.quoteNumber}
            available={Boolean(organizationId)}
            canReconcile
          />
        )}
        {focusedQuoteIsVisible && state.source === "firebase" && (
          <QuoteDecisionDebtPanel
            organizationId={organizationId}
            quoteId={focusedQuote.id}
            available={Boolean(organizationId)}
            onOpenWorkflow={onOpenWorkflow}
          />
        )}
        {AMBIENT_UI_ENABLED && AmbientOpportunitiesStream && (
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
              controller={quoteHistoryController}
            />
          </Suspense>
        )}
        <QuoteAdministrationBoundary ambient={AMBIENT_UI_ENABLED}>
          {() => (
          <>
        <div className="history-controls">
          <input
            type="text"
            placeholder="Search customer, quote #, or event"
            value={query}
            onChange={(e) => setQuery(e.target.value)}
          />
          <select value={eventTypeFilter} onChange={(e) => setEventTypeFilter(e.target.value)}>
            <option value="all">All event types</option>
            {eventTypes.map((eventType) => (
              <option key={eventType.id} value={eventType.id}>{eventType.name}</option>
            ))}
          </select>
          <select value={statusFilter} onChange={(e) => setStatusFilter(e.target.value)}>
            <option value="all">All statuses</option>
            <option value="draft">Draft</option>
            <option value="submitted">Submitted</option>
            <option value="archived">Archived</option>
          </select>
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
                return (
                  <tr
                    key={quote.id}
                    data-quote-id={quote.id}
                    className={quote.id === focusQuoteId ? "history-row-target" : ""}
                  >
                    <td>{formatWorkspaceText(quote.quoteNumber, { emptyLabel: "Quote number pending" })}</td>
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
                        {permissions.canManageQuoteStatus && (
                          <select
                            value={quote.status || "draft"}
                            onChange={(e) => handleStatusUpdate(quote.id, e.target.value)}
                            disabled={updatingId === quote.id || statusOptions.length <= 1 || deliveryUnresolved}
                          >
                            {statusOptions.map((status) => (
                              <option key={status} value={status}>{classifyQuoteStatus(status).label}</option>
                            ))}
                          </select>
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
                      <div className="row-actions">
                        {permissions.canConvertToContract && (canConvert || contractConversionActive) && (
                          <ContractConversionMutationStatus
                            presentation={contractConversionPresentation}
                            showReady
                          />
                        )}
                        {permissions.canConvertToContract
                          && canConvert
                          && !["error", "recovery", "receipt"].includes(contractConversionState.phase)
                          && (
                            <button
                              type="button"
                              data-approval-action="convert_to_contract"
                              className="cta compact"
                              onClick={() => handleConvertToContract(quote, {
                                reconcile: contractConversionState.phase === "uncertain"
                              })}
                              disabled={
                                deliveryUnresolved
                                || contractConversionBusy
                                || convertingId === quote.id
                                || (
                                  contractConversionState.phase !== "uncertain"
                                  && approvalRequired
                                  && !contractApproval
                                )
                              }
                              title={
                                contractConversionState.phase === "uncertain"
                                  ? "Reconcile the original approved conversion request."
                                  : approvalRequired && !contractApproval
                                    ? "Approve contract conversion in Workflow first."
                                    : ""
                              }
                            >
                              {contractConversionState.phase === "reconciliation"
                                ? "Reconciling..."
                                : contractConversionState.phase === "submitting" || convertingId === quote.id
                                  ? "Converting..."
                                  : contractConversionState.phase === "uncertain"
                                    ? "Reconcile conversion"
                                    : "Convert"}
                            </button>
                          )}
                        {permissions.canConvertToContract
                          && canConvert
                          && contractConversionActive
                          && contractConversionState.phase === "error"
                          && (
                            <button
                              type="button"
                              className="ghost compact"
                              onClick={() => handleRecoverContractConversion(quote)}
                            >
                              Refresh history
                            </button>
                          )}
                        {permissions.canManageConfirmation && canTrackConfirmation && confirmationStatus !== "confirmed" && (
                          <button
                            type="button"
                            className="ghost compact"
                            onClick={() => handleConfirmationUpdate(quote.id, "confirmed")}
                            disabled={updatingConfirmationId === quote.id || deliveryUnresolved}
                          >
                            Confirm
                          </button>
                        )}
                        {permissions.canEditQuote && canEditQuoteStatus(normalizedQuoteStatus) && (
                          <button
                            type="button"
                            className="ghost compact"
                            onClick={() => handleEditQuote(quote)}
                            disabled={deliveryUnresolved}
                          >
                            Edit
                          </button>
                        )}
                        {permissions.canReopenQuote && normalizedQuoteStatus === "expired" && (
                          <button
                            type="button"
                            className="ghost compact"
                            onClick={() => handleReopenQuote(quote)}
                            disabled={deliveryUnresolved || reopeningQuoteId === quote.id}
                            title="Restore the last nonterminal version as a draft with a new portal issuance."
                          >
                            {reopeningQuoteId === quote.id ? "Reopening..." : "Reopen"}
                          </button>
                        )}
                        {permissions.canDuplicateQuote && (
                          <button
                            type="button"
                            className="ghost compact"
                            onClick={() => handleDuplicateQuote(quote)}
                            disabled={duplicatingId === quote.id}
                          >
                            {duplicatingId === quote.id ? "Duplicating..." : "Duplicate"}
                          </button>
                        )}
                        {permissions.canExportProposal && (
                          <button
                            type="button"
                            className="ghost compact"
                            onClick={() => handleExportPdf(quote)}
                            disabled={exportingPdfId === quote.id || !rebookDeliveryGate.ready}
                            title={!rebookDeliveryGate.ready ? rebookDeliveryGate.message : ""}
                          >
                            {exportingPdfId === quote.id ? "Generating PDF..." : "PDF"}
                          </button>
                        )}
                        {permissions.canExportBeo && (
                          <QuoteHistoryKitchenBeoAction
                            source={state.source}
                            quote={quote}
                            disabled={!rebookDeliveryGate.ready}
                            disabledReason={!rebookDeliveryGate.ready ? rebookDeliveryGate.message : ""}
                            exportingLocal={exportingLocalBeoId === quote.id}
                            onOpenAuthoritative={handleOpenKitchenBeo}
                            onExportLocal={handleExportLocalBeo}
                          />
                        )}
                        {permissions.canSendQuoteEmail
                          && state.source === "firebase"
                          && deliveryUi.reviewRequired ? (
                          <button
                            type="button"
                            className="cta compact"
                            onClick={() => openDeliveryReview(quote, quoteRevisionId)}
                          >
                            Review Delivery
                          </button>
                        ) : permissions.canSendQuoteEmail ? (
                          <button
                            type="button"
                            className="cta compact"
                            onClick={() => handleSendQuoteEmail(quote)}
                            disabled={sendingQuoteEmailId === quote.id || !canDeliverCurrentQuote}
                            title={state.source !== "firebase"
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
                                    : ""}
                          >
                            {sendingQuoteEmailId === quote.id
                              ? "Sending..."
                              : deliveryRecorded
                                ? "Provider accepted"
                                : deliveryUi.freshAttemptAvailable
                                  ? "Start New Quote Email"
                                : deliveryUi.retryAvailable
                                  ? "Retry Quote Email"
                                  : "Send Quote Email"}
                          </button>
                        ) : null}
                        {permissions.canSendQuoteEmail
                          && state.source === "firebase"
                          && deliveryUi.reviewAvailable
                          && !deliveryUi.reviewRequired && (
                          <button
                            type="button"
                            className="ghost compact"
                            onClick={() => openDeliveryReview(quote, quoteRevisionId)}
                          >
                            Review Outcome
                          </button>
                        )}
                        {permissions.canSendPaymentRequest && paymentRequestApproval && (
                          <button
                            type="button"
                            data-approval-action="send_payment_request"
                            className="cta compact"
                            onClick={() => handleSendPaymentRequestEmail(quote)}
                            disabled={
                              deliveryUnresolved
                              || sendingPaymentEmailId === quote.id
                              || (!portalShareable && !paymentRequestInProgress)
                            }
                            title={!portalShareable && !paymentRequestInProgress
                                ? "Payment email requires an active customer portal for the current provider-accepted issuance."
                              : paymentRequestInProgress
                                ? "Resume the interrupted payment request using its existing approval."
                                : ""}
                          >
                            {sendingPaymentEmailId === quote.id
                              ? paymentRequestInProgress ? "Resuming..." : "Sending..."
                              : paymentRequestInProgress ? "Resume Pay Request" : "Send Pay Request"}
                          </button>
                        )}
                        {permissions.canSendFinalBalanceRequest
                          && finalBalanceApproval
                          && (finalBalanceRequestEligible || finalBalanceRequestInProgress) && (
                          <button
                            type="button"
                            data-approval-action="send_final_balance_request"
                            className="cta compact"
                            onClick={() => handleSendFinalBalanceRequestEmail(quote)}
                            disabled={
                              deliveryUnresolved
                              || sendingFinalBalanceEmailId === quote.id
                              || (!portalShareable && !finalBalanceRequestInProgress)
                            }
                            title={!portalShareable && !finalBalanceRequestInProgress
                                ? "Final-balance email requires an active customer portal for the current provider-accepted issuance."
                              : finalBalanceRequestInProgress
                                ? "Resume the interrupted final-balance request using its existing approval."
                                : ""}
                          >
                            {sendingFinalBalanceEmailId === quote.id
                              ? finalBalanceRequestInProgress ? "Resuming..." : "Sending..."
                              : finalBalanceRequestInProgress
                                ? "Resume Balance Request"
                                : "Send Balance Request"}
                          </button>
                        )}
                        {permissions.canRotatePortalLink && canRotatePortalForStatus && (
                          <button
                            type="button"
                            data-approval-action="rotate_portal_link"
                            className="ghost compact"
                            onClick={() => handleRotatePortalLink(quote)}
                            disabled={deliveryUnresolved || rotatingPortalId === quote.id || (approvalRequired && !portalRotationApproval)}
                            title={approvalRequired && !portalRotationApproval ? "Approve portal rotation in Workflow first." : ""}
                          >
                            {rotatingPortalId === quote.id ? "Rotating..." : "Rotate Portal"}
                          </button>
                        )}
                        {permissions.canCopyArtifacts && (
                          <>
                            {state.source === "firebase"
                              && portalConversationAvailable()
                              && portalShareable && (
                              <button
                                type="button"
                                className="ghost compact"
                                data-capability-action="open-quote-conversation"
                                onClick={() => onOpenConversation
                                  ? onOpenConversation(quote.id)
                                  : setConversationQuote(quote)}
                                disabled={!canOpenQuoteConversation(conversationQuote)}
                                title={conversationQuote
                                  ? "Close the current quote conversation before opening another."
                                  : ""}
                              >
                                Conversation
                              </button>
                            )}
                            <button
                              type="button"
                              className="ghost compact"
                              onClick={() => handleCopyEmail(quote)}
                              disabled={!rebookDeliveryGate.ready}
                              title={!rebookDeliveryGate.ready ? rebookDeliveryGate.message : ""}
                            >
                              Copy Email
                            </button>
                            <button
                              type="button"
                              className="ghost compact"
                              onClick={() => handleCopyPortalLink(quote)}
                              disabled={!portalShareable}
                              title={!portalShareable
                                ? state.source === "firebase"
                                  ? "Customer portal sharing requires provider acceptance for this revision and a valid future expiry."
                                  : "Customer portal sharing requires an active delivered status and valid future expiry."
                                : ""}
                            >
                              Copy Portal
                            </button>
                            {permissions.canCopyPaymentLink && publishedPaymentLink && (
                              <button type="button" className="ghost compact" onClick={() => handleCopyPaymentLink(quote)}>Copy Pay Link</button>
                            )}
                            {permissions.canCopyFinalBalanceLink && publishedFinalBalanceLink && (
                              <button
                                type="button"
                                className="ghost compact"
                                onClick={() => handleCopyFinalBalanceLink(quote)}
                              >
                                Copy Balance Link
                              </button>
                            )}
                          </>
                        )}
                        {permissions.canDeleteQuote && canDeleteQuotes ? (
                          <button
                            type="button"
                            data-approval-action="delete_quote"
                            className="ghost compact"
                            onClick={() => requestDeleteQuote(quote)}
                            disabled={deliveryUnresolved || updatingId === quote.id || (approvalRequired && !deleteApproval)}
                            title={approvalRequired && !deleteApproval ? "Approve quote deletion in Workflow first." : ""}
                          >
                            {updatingId === quote.id ? "Deleting..." : "Delete"}
                          </button>
                        ) : null}
                        {canReconcilePayment ? (
                          <button
                            type="button"
                            className="ghost compact"
                            onClick={() => handleReconcilePayment(quote)}
                            disabled={reconcilingPaymentId === quote.id || deliveryUnresolved}
                          >
                            {reconcilingPaymentId === quote.id ? "Reconciling..." : "Reconcile Payment"}
                          </button>
                        ) : null}
                        {canReconcileFinalBalance ? (
                          <button
                            type="button"
                            className="ghost compact"
                            onClick={() => handleReconcileFinalBalance(quote)}
                            disabled={reconcilingFinalBalanceId === quote.id || deliveryUnresolved}
                          >
                            {reconcilingFinalBalanceId === quote.id
                              ? "Reconciling..."
                              : "Reconcile Final Balance"}
                          </button>
                        ) : null}
                      </div>
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
            returnFocusRef={kitchenBeoReturnFocusRef}
            onClose={() => setKitchenBeoQuote(null)}
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
            <label>
              Provider outcome
              <select
                value={deliveryReview.resolution}
                onChange={(event) => setDeliveryReview((current) => ({
                  ...current,
                  resolution: event.target.value,
                  providerMessageId: event.target.value === "provider_accepted"
                    ? current.providerMessageId
                    : ""
                }))}
                disabled={resolvingDeliveryId === deliveryReview.quoteId}
              >
                {!deliveryReview.knownProviderAcceptance && (
                  <option value="confirmed_not_sent">Provider confirms no email was sent</option>
                )}
                <option value="provider_accepted">Provider accepted the email</option>
              </select>
            </label>
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
