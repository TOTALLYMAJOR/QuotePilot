import { useEffect, useRef, useState } from "react";
import {
  createDepositCheckout,
  getIntegrationSetupStatus,
  resolveQuoteDeliveryOutcome,
  resolveQuoteDeliveryRevisionId,
  sendPaymentRequestToCustomerEmail,
  sendQuoteToCustomerEmail
} from "../lib/commerceOps";
import { currency } from "../lib/quoteCalculator";
import { getEventTypes } from "../lib/menuService";
import { sanitizeStripePaymentLink } from "../lib/paymentLink";
import { buildQuoteEmailPayload } from "../lib/proposalPayload";
import {
  BOOKING_CONFIRMATION_STATUSES,
  convertQuoteToContract,
  deleteQuote,
  duplicateQuote,
  getAllowedStatusTransitions,
  getQuoteHistory,
  PAYMENT_STATUSES,
  reopenQuote,
  requestQuoteApproval,
  rotateQuotePortalKey,
  updateQuoteBookingConfirmation,
  updateQuotePaymentStatus,
  updateQuoteStatus
} from "../lib/quoteStore";

export function formatQuoteHistoryDate(iso) {
  if (!iso) return "-";
  const raw = String(iso).trim();
  const dt = /^\d{4}-\d{2}-\d{2}$/.test(raw)
    ? new Date(`${raw}T12:00:00`)
    : new Date(raw);
  if (Number.isNaN(dt.getTime())) return "-";
  return dt.toLocaleDateString([], { month: "short", day: "numeric", year: "numeric" });
}

const fmtDate = formatQuoteHistoryDate;

function canConvertToContract(quote) {
  const status = String(quote?.status || "");
  const hasContract = Boolean(String(quote?.booking?.contractNumber || "").trim());
  return status === "accepted" || (status === "booked" && !hasContract);
}

export function getExecutableApprovalRequest(quote, action) {
  const requests = Array.isArray(quote?.workflow?.approvalRequests)
    ? quote.workflow.approvalRequests
    : [];
  return requests.find((request) => {
    const executionState = String(request?.executionState || "").trim().toLowerCase();
    return request?.action === action
      && request?.state === "approved"
      && (!executionState || executionState === "awaiting_execution");
  }) || null;
}

function statusBucket(status) {
  const normalized = String(status || "draft").trim().toLowerCase();
  if (normalized === "draft") return "draft";
  if (["sent", "viewed", "accepted"].includes(normalized)) return "submitted";
  if (["booked", "declined", "expired"].includes(normalized)) return "archived";
  return normalized;
}

function statusBucketLabel(status) {
  const bucket = statusBucket(status);
  return bucket.charAt(0).toUpperCase() + bucket.slice(1);
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

function normalizeHistoryRole(role) {
  const normalized = String(role || "").trim().toLowerCase();
  if (normalized === "admin" || normalized === "sales") return normalized;
  return "customer";
}

export function getQuoteHistoryActionPermissions(role) {
  const normalizedRole = normalizeHistoryRole(role);
  const isAdmin = normalizedRole === "admin";
  const isSales = normalizedRole === "sales";
  const isStaff = isAdmin || isSales;

  return {
    role: normalizedRole,
    isStaff,
    canEditQuote: isStaff,
    canDuplicateQuote: isStaff,
    canExportProposal: isStaff,
    canSendQuoteEmail: isAdmin,
    canCopyArtifacts: isStaff,
    canCopyPaymentLink: isAdmin,
    canSendPaymentRequest: isAdmin,
    canCreateCheckoutLink: isAdmin,
    canManageQuoteStatus: isAdmin,
    canManagePaymentStatus: isAdmin,
    canConvertToContract: isAdmin,
    canManageConfirmation: isAdmin,
    canReopenQuote: isAdmin,
    canRotatePortalLink: isAdmin,
    canDeleteQuote: isAdmin
  };
}

export function canRotateQuotePortal(status) {
  return ["draft", "sent", "viewed"].includes(
    String(status || "draft").trim().toLowerCase()
  );
}

export default function QuoteHistoryModal({
  open,
  onClose,
  basePortalUrl = "",
  organizationId = "",
  currentUserUid = "",
  currentUserEmail = "",
  currentUserRole = "customer",
  focusQuoteId = "",
  focusReason = "",
  onEditQuote,
  onOpenIntegrations,
  canDeleteQuotes = false,
  onToast
}) {
  const [state, setState] = useState({
    loading: false,
    source: "",
    error: "",
    feedback: "",
    quotes: []
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
  const [updatingPaymentId, setUpdatingPaymentId] = useState("");
  const [convertingId, setConvertingId] = useState("");
  const [updatingConfirmationId, setUpdatingConfirmationId] = useState("");
  const [creatingCheckoutId, setCreatingCheckoutId] = useState("");
  const [duplicatingId, setDuplicatingId] = useState("");
  const [exportingPdfId, setExportingPdfId] = useState("");
  const [sendingQuoteEmailId, setSendingQuoteEmailId] = useState("");
  const [sendingPaymentEmailId, setSendingPaymentEmailId] = useState("");
  const [reopeningQuoteId, setReopeningQuoteId] = useState("");
  const [rotatingPortalId, setRotatingPortalId] = useState("");
  const [requestingApprovalId, setRequestingApprovalId] = useState("");
  const [pendingDeleteQuote, setPendingDeleteQuote] = useState(null);
  const [deliveryReview, setDeliveryReview] = useState(null);
  const [resolvingDeliveryId, setResolvingDeliveryId] = useState("");
  const [deliveryClockMs, setDeliveryClockMs] = useState(() => Date.now());
  const dialogRef = useRef(null);
  const savedQuoteHandoffRef = useRef(null);
  const deliveryReviewRef = useRef(null);
  const deliveryReviewReturnFocusRef = useRef(null);
  const deliveryReviewStateRef = useRef(null);
  const focusedHandoffIdRef = useRef("");
  const loadedFocusQuoteIdRef = useRef("");
  const loadGenerationRef = useRef(0);
  const targetLoadPendingRef = useRef(false);
  const onCloseRef = useRef(onClose);

  useEffect(() => {
    onCloseRef.current = onClose;
  }, [onClose]);
  deliveryReviewStateRef.current = deliveryReview;

  useEffect(() => {
    if (open) return;
    setDeliveryReview(null);
    deliveryReviewReturnFocusRef.current = null;
  }, [open]);

  useEffect(() => {
    if (!open) return undefined;
    setDeliveryClockMs(Date.now());
    const timer = window.setInterval(() => setDeliveryClockMs(Date.now()), 10_000);
    return () => window.clearInterval(timer);
  }, [open]);

  useEffect(() => {
    if (!open) return undefined;
    const previousBodyOverflow = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    const focusFrame = window.requestAnimationFrame(() => dialogRef.current?.focus());
    const handleDialogKeyDown = (event) => {
      if (event.key === "Escape") {
        event.preventDefault();
        if (deliveryReviewStateRef.current) {
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
  }, [open]);

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
  }, [open, focusQuoteId, organizationId]);

  const pushToast = (message, tone = "info") => {
    if (typeof onToast === "function") {
      onToast(message, tone);
    }
  };

  const load = async () => {
    const generation = loadGenerationRef.current + 1;
    loadGenerationRef.current = generation;
    const requestedFocusQuoteId = String(focusQuoteId || "").trim();
    const requestedOrganizationId = String(organizationId || "").trim();
    const targetingSavedQuote = Boolean(
      requestedFocusQuoteId && targetLoadPendingRef.current
    );
    setState((prev) => ({ ...prev, loading: true, error: "", feedback: "" }));
    try {
      const result = await getQuoteHistory({
        organizationId: requestedOrganizationId,
        persistExpiredStatuses: normalizeHistoryRole(currentUserRole) === "admin"
      });
      if (generation !== loadGenerationRef.current) return;
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
        feedback: "",
        source: result.source,
        quotes: result.quotes
      });
    } catch (err) {
      if (generation !== loadGenerationRef.current) return;
      if (targetingSavedQuote) targetLoadPendingRef.current = false;
      loadedFocusQuoteIdRef.current = "";
      setState((prev) => ({
        ...prev,
        loading: false,
        error: err?.message || "Failed to load quote history.",
        feedback: ""
      }));
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
    const canCheck = normalizeHistoryRole(currentUserRole) === "admin";
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
    if (focusedHandoffIdRef.current === focusQuoteId) return;
    if (loadedFocusQuoteIdRef.current !== focusQuoteId) return;
    if (!state.quotes.some((quote) => quote.id === focusQuoteId)) return;
    const frame = window.requestAnimationFrame(() => {
      const handoff = savedQuoteHandoffRef.current;
      if (!handoff || handoff.dataset.quoteId !== focusQuoteId) return;
      handoff.focus({ preventScroll: true });
      handoff.scrollIntoView({ block: "nearest" });
      focusedHandoffIdRef.current = focusQuoteId;
    });
    return () => window.cancelAnimationFrame(frame);
  }, [open, focusQuoteId, state.loading, state.quotes]);

  useEffect(() => {
    if (!deliveryReview) return undefined;
    const frame = window.requestAnimationFrame(() => {
      deliveryReviewRef.current?.focus({ preventScroll: true });
      deliveryReviewRef.current?.scrollIntoView({ block: "nearest" });
    });
    return () => window.cancelAnimationFrame(frame);
  }, [deliveryReview?.quoteId]);

  if (!open) return null;

  const permissions = getQuoteHistoryActionPermissions(currentUserRole);
  const authorityCopy = permissions.role === "admin"
    ? "Admin can change quote, payment, booking, portal, and contract state."
    : permissions.role === "sales"
      ? "Sales can prepare proposal artifacts; admin approval is required to send email or change payment, booking, portal, and delete state."
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
  const focusedQuote = focusQuoteId
    ? state.quotes.find((quote) => quote.id === focusQuoteId) || null
    : null;
  const focusedQuoteIsVisible = Boolean(
    focusedQuote && filteredQuotes.some((quote) => quote.id === focusedQuote.id)
  );
  const focusedQuoteStatus = String(focusedQuote?.status || "draft").trim().toLowerCase();
  const focusedQuoteIsDraft = focusedQuoteStatus === "draft";
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
  });
  const focusedQuoteDeliveryEligible = permissions.canSendQuoteEmail
    && state.source === "firebase"
    && ["draft", "sent", "viewed"].includes(focusedQuoteStatus)
    && Boolean(focusedQuoteRevisionId)
    && focusedDelivery.canAttempt;
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

  const applyPaymentLocally = (quoteId, nextPaymentStatus) => {
    applyQuoteLocally(quoteId, (quote) => ({
      ...quote,
      payment: {
        ...(quote.payment || {}),
        depositStatus: nextPaymentStatus,
        depositConfirmedAtISO:
          nextPaymentStatus === "paid" ? new Date().toISOString() : quote.payment?.depositConfirmedAtISO || ""
      }
    }));
  };

  const applyPaymentLinkLocally = (quoteId, paymentLink) => {
    applyQuoteLocally(quoteId, (quote) => ({
      ...quote,
      payment: {
        ...(quote.payment || {}),
        depositLink: paymentLink,
        depositStatus: "sent",
        depositConfirmedAtISO: quote.payment?.depositConfirmedAtISO || ""
      }
    }));
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
    const base = basePortalUrl || `${window.location.origin}${window.location.pathname}`;
    return `${base}?portal=${quote.portalKey}`;
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

  const handlePaymentUpdate = async (quoteId, nextPaymentStatus) => {
    if (!permissions.canManagePaymentStatus) {
      setState((prev) => ({ ...prev, error: "Admin role required to change payment status." }));
      return;
    }
    setUpdatingPaymentId(quoteId);
    try {
      await updateQuotePaymentStatus(quoteId, nextPaymentStatus);
      applyPaymentLocally(quoteId, nextPaymentStatus);
      setState((prev) => ({ ...prev, feedback: `Payment marked ${nextPaymentStatus}.` }));
      pushToast(`Payment marked ${nextPaymentStatus}.`, "success");
    } catch (err) {
      setState((prev) => ({
        ...prev,
        error: err?.message || "Failed to update payment status."
      }));
    } finally {
      setUpdatingPaymentId("");
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
      const approvalRequest = getExecutableApprovalRequest(quote, "delete_quote");
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
        feedback: `Quote ${quote.quoteNumber || quote.id} reopened as a draft with a new portal issuance.`
      }));
      pushToast(`Quote ${quote.quoteNumber || quote.id} reopened as a draft.`, "success");
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

  const handleConvertToContract = async (quote) => {
    if (!permissions.canConvertToContract) {
      setState((prev) => ({ ...prev, error: "Admin role required to convert quotes to contracts." }));
      return;
    }
    setConvertingId(quote.id);
    setState((prev) => ({ ...prev, error: "", feedback: "" }));
    try {
      const approvalRequest = getExecutableApprovalRequest(quote, "convert_to_contract");
      if (state.source === "firebase" && !approvalRequest) {
        throw new Error("Approve a contract-conversion request in Workflow first.");
      }
      const result = await convertQuoteToContract({
        quoteId: quote.id,
        actorEmail: currentUserEmail,
        approvalRequestId: approvalRequest?.id || ""
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
      pushToast(`Converted ${quote.quoteNumber} to contract ${result.contractNumber}.`, "success");
    } catch (err) {
      setState((prev) => ({
        ...prev,
        error: err?.message || "Failed to convert quote to contract."
      }));
    } finally {
      setConvertingId("");
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
      const approvalRequest = getExecutableApprovalRequest(quote, "rotate_portal_link");
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

  const createCheckoutLink = async (quote) => {
    if (!permissions.canCreateCheckoutLink) {
      throw new Error("Admin role required to create Stripe checkout links.");
    }
    if (state.source !== "firebase") {
      throw new Error("Stripe checkout requires Firebase-backed quote storage.");
    }
    if (isPortalExpired(quote)) {
      throw new Error("Portal link expired. Rotate the portal link before sending payment requests.");
    }

    const result = await createDepositCheckout({
      quoteId: quote.id
    });
    const paymentLink = sanitizeStripePaymentLink(result?.url);
    if (!paymentLink) {
      throw new Error("An approved Stripe checkout URL was not returned.");
    }
    applyPaymentLinkLocally(quote.id, paymentLink);
    return paymentLink;
  };

  const handleCreateCheckout = async (quote) => {
    setCreatingCheckoutId(quote.id);
    setState((prev) => ({ ...prev, error: "", feedback: "" }));
    try {
      const paymentLink = await createCheckoutLink(quote);
      setState((prev) => ({ ...prev, feedback: `Stripe checkout created for ${quote.quoteNumber}.` }));
      pushToast(`Stripe checkout created for ${quote.quoteNumber}.`, "success");
      window.open(paymentLink, "_blank", "noopener,noreferrer");
    } catch (err) {
      setState((prev) => ({ ...prev, error: err?.message || "Failed to create Stripe checkout." }));
    } finally {
      setCreatingCheckoutId("");
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
      quoteNumber: quote.quoteNumber || quote.id,
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
      const approvalRequest = getExecutableApprovalRequest(quote, "send_payment_request");
      if (!approvalRequest) {
        throw new Error("Approve a payment-request action in Workflow first.");
      }
      const status = String(quote.status || "").trim().toLowerCase();
      if (!["accepted", "booked"].includes(status)) {
        throw new Error("Payment request email is only available after quote acceptance.");
      }
      if (isPortalExpired(quote)) {
        throw new Error("Portal link expired. Rotate the portal link before sending payment requests.");
      }

      let paymentLink = sanitizeStripePaymentLink(quote.payment?.depositLink);
      if (!paymentLink) {
        paymentLink = await createCheckoutLink(quote);
      }

      const sendResult = await sendPaymentRequestToCustomerEmail({
        quoteId: quote.id,
        approvalRequestId: approvalRequest.id
      });
      applyApprovalExecutionLocally(quote.id, sendResult.approvalRequest);

      if (String(quote.payment?.depositStatus || "unpaid").toLowerCase() === "unpaid") {
        await updateQuotePaymentStatus(quote.id, "sent");
        applyPaymentLocally(quote.id, "sent");
      }

      setState((prev) => ({ ...prev, feedback: `Payment request sent to ${quote.customer?.email || "customer"}.` }));
      pushToast(`Payment request sent for ${quote.quoteNumber}.`, "success");
    } catch (err) {
      setState((prev) => ({ ...prev, error: err?.message || "Failed to send payment request." }));
    } finally {
      setSendingPaymentEmailId("");
    }
  };

  const handleEditQuote = (quote) => {
    if (typeof onEditQuote !== "function") return;
    onEditQuote(quote);
  };

  const handleOpenIntegrations = () => {
    if (typeof onOpenIntegrations !== "function") return;
    onOpenIntegrations();
  };

  const handleRequestSendApproval = async (quote) => {
    if (!quote?.id) return;
    setRequestingApprovalId(quote.id);
    setState((prev) => ({ ...prev, error: "", feedback: "" }));
    try {
      const result = await requestQuoteApproval({
        quoteId: quote.id,
        action: "send_quote_email",
        note: "",
        actorEmail: currentUserEmail,
        actorRole: currentUserRole
      });
      applyQuoteLocally(quote.id, (existing) => ({
        ...existing,
        workflow: {
          ...(existing.workflow || {}),
          approvalRequests: [...(existing.workflow?.approvalRequests || []), result.request]
        }
      }));
      const feedback = "Approval requested. An admin will see it in Workflow.";
      setState((prev) => ({ ...prev, feedback }));
      pushToast(feedback, "success");
    } catch (err) {
      setState((prev) => ({ ...prev, error: err?.message || "Failed to request approval." }));
    } finally {
      setRequestingApprovalId("");
    }
  };

  return (
    <div className="modal-overlay" role="dialog" aria-modal="true" aria-labelledby="quote-history-title">
      <div className="modal-card history-card" ref={dialogRef} tabIndex={-1}>
        <div className="modal-head">
          <h2 id="quote-history-title">Quotes</h2>
          <div className="right-actions">
            <button type="button" className="ghost" onClick={load} disabled={state.loading}>
              {state.loading ? "Refreshing..." : "Refresh"}
            </button>
            <button
              type="button"
              className="ghost"
              onClick={() => {
                setDeliveryReview(null);
                onClose?.();
              }}
            >
              Close
            </button>
          </div>
        </div>

        <p className="source-note">Source: {state.source || "-"}</p>
        <p className="source-note">
          Authority: {authorityCopy}
        </p>
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
                {focusedDelivery.reviewRequired
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
                {focusedQuote.quoteNumber || focusedQuote.id}
              </h3>
              <p id="saved-quote-handoff-description" className="saved-quote-handoff-description">
                {focusedDelivery.reviewRequired
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
              {focusedDelivery.reviewRequired
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
                  disabled={exportingPdfId === focusedQuote.id}
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
                  disabled={exportingPdfId === focusedQuote.id}
                  aria-busy={exportingPdfId === focusedQuote.id}
                >
                  {exportingPdfId === focusedQuote.id ? "Generating PDF..." : "Download PDF"}
                </button>
              )}
              {!focusedQuoteCanSend && focusedQuoteEmailUnconfigured && (
                <button type="button" className="ghost" onClick={handleOpenIntegrations}>
                  Set up email in Integrations
                </button>
              )}
              {!focusedQuoteCanSend && permissions.role === "sales" && (
                <button
                  type="button"
                  className="ghost"
                  onClick={() => handleRequestSendApproval(focusedQuote)}
                  disabled={requestingApprovalId === focusedQuote.id}
                  aria-busy={requestingApprovalId === focusedQuote.id}
                >
                  {requestingApprovalId === focusedQuote.id ? "Requesting approval..." : "Request approval to send"}
                </button>
              )}
            </div>
          </section>
        )}
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
                const canConvert = canConvertToContract(quote);
                const canTrackConfirmation = quote.status === "booked" && Boolean(contractNumber);
                const canSendPaymentRequest = ["accepted", "booked"].includes(
                  String(quote.status || "").trim().toLowerCase()
                );
                const canRotatePortalForStatus = canRotateQuotePortal(normalizedQuoteStatus);
                const approvalRequired = state.source === "firebase";
                const contractApproval = getExecutableApprovalRequest(quote, "convert_to_contract");
                const paymentRequestApproval = getExecutableApprovalRequest(quote, "send_payment_request");
                const portalRotationApproval = getExecutableApprovalRequest(quote, "rotate_portal_link");
                const deleteApproval = getExecutableApprovalRequest(quote, "delete_quote");
                const quoteEventTypeId = String(quote.eventTypeId || quote.selection?.eventTypeId || "");
                const quoteEventTypeLabel = eventTypeNameById.get(quoteEventTypeId) || quoteEventTypeId || "-";
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
                const canDeliverCurrentQuote = state.source === "firebase"
                  && ["draft", "sent", "viewed"].includes(normalizedQuoteStatus)
                  && Boolean(quoteRevisionId)
                  && deliveryUi.canAttempt
                  && emailSetup.checked
                  && emailSetup.configured;
                const portalShareable = isCustomerPortalShareable(quote, {
                  requireDeliveryEvidence: state.source === "firebase"
                });
                return (
                  <tr
                    key={quote.id}
                    data-quote-id={quote.id}
                    className={quote.id === focusQuoteId ? "history-row-target" : ""}
                  >
                    <td>{quote.quoteNumber || "-"}</td>
                    <td>{quote.customer?.name || quote.customer?.email || "-"}</td>
                    <td>{quoteEventTypeLabel}</td>
                    <td>{fmtDate(quote.event?.date)}</td>
                    <td>{quote.event?.guests ?? "-"}</td>
                    <td>{currency(quote.totals?.total || 0)}</td>
                    <td>{currency(quote.totals?.deposit || 0)}</td>
                    <td>
                      <div className="history-meta-stack">
                        {permissions.canManageQuoteStatus ? (
                          <select
                            value={quote.status || "draft"}
                            onChange={(e) => handleStatusUpdate(quote.id, e.target.value)}
                            disabled={updatingId === quote.id || statusOptions.length <= 1 || deliveryUnresolved}
                          >
                            {statusOptions.map((status) => (
                              <option key={status} value={status}>{status}</option>
                            ))}
                          </select>
                        ) : (
                          <strong>{quote.status || "draft"}</strong>
                        )}
                        <small>{statusBucketLabel(quote.status || "draft")}</small>
                        {deliveryUi.reviewRequired ? (
                          <small>Delivery review required</small>
                        ) : deliveryUi.activeLease ? (
                          <small>Delivery in progress</small>
                        ) : deliveryUi.freshAttemptAvailable ? (
                          <small>New delivery attempt available</small>
                        ) : deliveryUi.retryAvailable ? (
                          <small>Safe retry available</small>
                        ) : null}
                      </div>
                    </td>
                    <td>
                      {permissions.canManagePaymentStatus ? (
                        <select
                          value={quote.payment?.depositStatus || "unpaid"}
                          onChange={(e) => handlePaymentUpdate(quote.id, e.target.value)}
                          disabled={updatingPaymentId === quote.id || deliveryUnresolved}
                        >
                          {PAYMENT_STATUSES.map((paymentStatus) => (
                            <option key={paymentStatus} value={paymentStatus}>{paymentStatus}</option>
                          ))}
                        </select>
                      ) : (
                        <span>{quote.payment?.depositStatus || "unpaid"}</span>
                      )}
                    </td>
                    <td>
                      <div className="history-meta-stack">
                        <strong>{contractNumber || "-"}</strong>
                        <small>{fmtDate(booking.contractConvertedAtISO)}</small>
                      </div>
                    </td>
                    <td>
                      {canTrackConfirmation ? (
                        <div className="history-meta-stack">
                          {permissions.canManageConfirmation ? (
                            <select
                              value={confirmationStatus}
                              onChange={(e) => handleConfirmationUpdate(quote.id, e.target.value)}
                              disabled={updatingConfirmationId === quote.id || deliveryUnresolved}
                            >
                              {BOOKING_CONFIRMATION_STATUSES.map((bookingStatus) => (
                                <option key={bookingStatus} value={bookingStatus}>{bookingStatus}</option>
                              ))}
                            </select>
                          ) : (
                            <strong>{confirmationStatus}</strong>
                          )}
                          <small>{fmtDate(booking.confirmedAtISO || booking.confirmationSentAtISO)}</small>
                        </div>
                      ) : (
                        <span className="muted">-</span>
                      )}
                    </td>
                    <td>{fmtDate(quote.expiresAtISO)}</td>
                    <td>{fmtDate(quote.updatedAtISO || quote.createdAtISO)}</td>
                    <td>
                      <div className="row-actions">
                        {permissions.canConvertToContract && canConvert && (
                          <button
                            type="button"
                            className="cta compact"
                            onClick={() => handleConvertToContract(quote)}
                            disabled={deliveryUnresolved || convertingId === quote.id || (approvalRequired && !contractApproval)}
                            title={approvalRequired && !contractApproval ? "Approve contract conversion in Workflow first." : ""}
                          >
                            {convertingId === quote.id ? "Converting..." : "Convert"}
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
                        {permissions.canEditQuote && (
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
                            disabled={exportingPdfId === quote.id}
                          >
                            {exportingPdfId === quote.id ? "Generating PDF..." : "PDF"}
                          </button>
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
                              : deliveryRecorded
                                ? "This saved revision already has provider acceptance evidence."
                                : deliveryUi.activeLease
                                  ? "Delivery is still in progress. The safe retry action unlocks after this lease expires."
                                  : !emailSetup.checked || !emailSetup.configured
                                    ? "Configure a supported email provider in Integration Ops first."
                                : !quoteRevisionId
                                  ? "Save this quote as a versioned draft before sending."
                                  : !["draft", "sent", "viewed"].includes(normalizedQuoteStatus)
                                    ? "Only draft, sent, or viewed quotes can be delivered by quote email."
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
                        {permissions.canSendPaymentRequest && canSendPaymentRequest && (
                          <button
                            type="button"
                            className="cta compact"
                            onClick={() => handleSendPaymentRequestEmail(quote)}
                            disabled={deliveryUnresolved || sendingPaymentEmailId === quote.id || !paymentRequestApproval || !portalShareable}
                            title={!paymentRequestApproval
                              ? "Approve the payment request in Workflow first."
                              : !portalShareable
                                ? "Payment email requires an active customer portal for the current provider-accepted issuance."
                                : ""}
                          >
                            {sendingPaymentEmailId === quote.id ? "Sending..." : "Send Pay Request"}
                          </button>
                        )}
                        {permissions.canRotatePortalLink && canRotatePortalForStatus && (
                          <button
                            type="button"
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
                            <button type="button" className="ghost compact" onClick={() => handleCopyEmail(quote)}>Copy Email</button>
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
                            {permissions.canCopyPaymentLink && (
                              <button type="button" className="ghost compact" onClick={() => handleCopyPaymentLink(quote)}>Copy Pay Link</button>
                            )}
                          </>
                        )}
                        {permissions.canCreateCheckoutLink && (
                          <button
                            type="button"
                            className="cta compact"
                            onClick={() => handleCreateCheckout(quote)}
                            disabled={creatingCheckoutId === quote.id || deliveryUnresolved}
                          >
                            {creatingCheckoutId === quote.id ? "Creating..." : "Create Stripe Link"}
                          </button>
                        )}
                        {permissions.canDeleteQuote && canDeleteQuotes ? (
                          <button
                            type="button"
                            className="ghost compact"
                            onClick={() => requestDeleteQuote(quote)}
                            disabled={deliveryUnresolved || updatingId === quote.id || (approvalRequired && !deleteApproval)}
                            title={approvalRequired && !deleteApproval ? "Approve quote deletion in Workflow first." : ""}
                          >
                            {updatingId === quote.id ? "Deleting..." : "Delete"}
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

        {pendingDeleteQuote && (
          <div className="confirm-modal">
            <p>
              Permanently delete quote <strong>{pendingDeleteQuote.quoteNumber || pendingDeleteQuote.id}</strong>?
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
