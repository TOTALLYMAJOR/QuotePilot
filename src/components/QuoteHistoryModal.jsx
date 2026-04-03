import { useEffect, useState } from "react";
import {
  createDepositCheckout,
  sendPaymentRequestToCustomerEmail,
  sendQuoteToCustomerEmail
} from "../lib/commerceOps";
import { currency } from "../lib/quoteCalculator";
import { getEventTypes } from "../lib/menuService";
import {
  BOOKING_CONFIRMATION_STATUSES,
  buildQuoteEmailTemplate,
  convertQuoteToContract,
  deleteQuote,
  duplicateQuote,
  getAllowedStatusTransitions,
  getQuoteHistory,
  PAYMENT_STATUSES,
  rotateQuotePortalKey,
  updateQuoteBookingConfirmation,
  updateQuotePaymentStatus,
  updateQuoteStatus
} from "../lib/quoteStore";

function fmtDate(iso) {
  if (!iso) return "-";
  const dt = new Date(iso);
  if (Number.isNaN(dt.getTime())) return "-";
  return dt.toLocaleString();
}

function canConvertToContract(quote) {
  const status = String(quote?.status || "");
  const hasContract = Boolean(String(quote?.booking?.contractNumber || "").trim());
  return status === "accepted" || (status === "booked" && !hasContract);
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

function isPortalExpired(quote) {
  const expiry = String(quote?.portalExpiresAtISO || quote?.expiresAtISO || "").trim();
  if (!expiry) return false;
  const dt = new Date(expiry);
  if (Number.isNaN(dt.getTime())) return false;
  return dt.getTime() < Date.now();
}

export default function QuoteHistoryModal({
  open,
  onClose,
  basePortalUrl = "",
  organizationId = "",
  currentUserUid = "",
  currentUserEmail = "",
  onEditQuote,
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
  const [rotatingPortalId, setRotatingPortalId] = useState("");
  const [pendingDeleteQuote, setPendingDeleteQuote] = useState(null);

  const pushToast = (message, tone = "info") => {
    if (typeof onToast === "function") {
      onToast(message, tone);
    }
  };

  const load = async () => {
    setState((prev) => ({ ...prev, loading: true, error: "", feedback: "" }));
    try {
      const result = await getQuoteHistory({
        eventTypeId: eventTypeFilter === "all" ? "" : eventTypeFilter,
        customerName: query,
        organizationId
      });
      setState({
        loading: false,
        error: "",
        feedback: "",
        source: result.source,
        quotes: result.quotes
      });
    } catch (err) {
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
    const timer = setTimeout(() => {
      load();
    }, query.trim() ? 220 : 0);
    return () => clearTimeout(timer);
  }, [open, eventTypeFilter, query]);

  if (!open) return null;

  const normalizedCustomerQuery = query.trim().toLowerCase();
  const eventTypeNameById = new Map(
    (eventTypes || []).map((item) => [String(item.id), item.name])
  );

  const filteredQuotes = state.quotes.filter((quote) => {
    const statusMatch = statusFilter === "all" || statusBucket(quote.status || "draft") === statusFilter;
    if (!statusMatch) return false;

    const quoteEventType = String(quote.eventTypeId || quote.selection?.eventTypeId || "").trim();
    const eventTypeMatch = eventTypeFilter === "all" || quoteEventType === eventTypeFilter;
    if (!eventTypeMatch) return false;

    if (!normalizedCustomerQuery) return true;
    const customerHaystack = [
      quote.customerNameKey,
      quote.customer?.name
    ]
      .filter(Boolean)
      .join(" ")
      .toLowerCase();
    return customerHaystack.includes(normalizedCustomerQuery);
  });

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

  const resolveQuotePortalLink = (quote) => {
    if (!quote?.portalKey) return "";
    const base = basePortalUrl || `${window.location.origin}${window.location.pathname}`;
    return `${base}?portal=${quote.portalKey}`;
  };

  const handleStatusUpdate = async (quoteId, nextStatus, silent = false) => {
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
    setUpdatingId(quoteId);
    setState((prev) => ({ ...prev, error: "" }));
    try {
      await deleteQuote(quoteId, { organizationId });
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
    setConvertingId(quote.id);
    setState((prev) => ({ ...prev, error: "", feedback: "" }));
    try {
      const result = await convertQuoteToContract({
        quoteId: quote.id,
        actorEmail: currentUserEmail
      });
      applyQuoteLocally(quote.id, (existing) => ({
        ...existing,
        status: result.status,
        booking: result.booking,
        lifecycle: result.lifecycle
      }));
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
      const template = buildQuoteEmailTemplate(quote);
      const mailText = `Subject: ${template.subject}\n\n${template.body}`;
      await navigator.clipboard.writeText(mailText);
      setState((prev) => ({ ...prev, feedback: `Email template copied for ${quote.quoteNumber}.` }));
      pushToast(`Email template copied for ${quote.quoteNumber}.`, "success");

      if (quote.status === "draft") {
        await handleStatusUpdate(quote.id, "sent", true);
        setState((prev) => ({ ...prev, feedback: `Email copied and ${quote.quoteNumber} marked sent.` }));
        pushToast(`Email copied and ${quote.quoteNumber} marked sent.`, "success");
      }
    } catch (err) {
      setState((prev) => ({ ...prev, error: err?.message || "Failed to copy email template." }));
    }
  };

  const handleExportPdf = async (quote) => {
    setExportingPdfId(quote.id);
    try {
      const { exportQuoteProposal } = await import("../lib/proposalExport");
      await exportQuoteProposal(quote, { basePortalUrl });
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
      const paymentLink = quote.payment?.depositLink;
      if (!paymentLink) {
        throw new Error("No deposit link saved for this quote.");
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
      if (isPortalExpired(quote)) {
        throw new Error("Portal link expired. Rotate the portal link before sharing.");
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
    setRotatingPortalId(quote.id);
    setState((prev) => ({ ...prev, error: "", feedback: "" }));
    try {
      const result = await rotateQuotePortalKey({
        quoteId: quote.id,
        actorEmail: currentUserEmail
      });
      applyQuoteLocally(quote.id, (existing) => ({
        ...existing,
        portalKey: result.portalKey,
        portalIssuedAtISO: result.portalIssuedAtISO,
        portalExpiresAtISO: result.portalExpiresAtISO
      }));
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
    if (state.source !== "firebase") {
      throw new Error("Stripe checkout requires Firebase-backed quote storage.");
    }
    if (isPortalExpired(quote)) {
      throw new Error("Portal link expired. Rotate the portal link before sending payment requests.");
    }

    const base = basePortalUrl || `${window.location.origin}${window.location.pathname}`;
    const successUrl = quote.portalKey
      ? `${base}?portal=${encodeURIComponent(quote.portalKey)}&payment=success`
      : `${base}?payment=success`;
    const cancelUrl = quote.portalKey
      ? `${base}?portal=${encodeURIComponent(quote.portalKey)}&payment=cancelled`
      : `${base}?payment=cancelled`;

    const result = await createDepositCheckout({
      quoteId: quote.id,
      successUrl,
      cancelUrl
    });
    const paymentLink = String(result?.url || "").trim();
    if (!paymentLink) {
      throw new Error("Checkout URL was not returned.");
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
      if (isPortalExpired(quote)) {
        throw new Error("Portal link expired. Rotate the portal link before sending quote email.");
      }
      const { exportQuoteProposal } = await import("../lib/proposalExport");
      const attachment = await exportQuoteProposal(quote, {
        basePortalUrl,
        output: "base64",
        compact: true
      });
      const portalLink = resolveQuotePortalLink(quote);

      await sendQuoteToCustomerEmail({
        quoteId: quote.id,
        portalLink,
        attachment
      });

      if (String(quote.status || "").toLowerCase() === "draft") {
        await handleStatusUpdate(quote.id, "sent", true);
      }

      setState((prev) => ({ ...prev, feedback: `Quote email sent to ${quote.customer?.email || "customer"}.` }));
      pushToast(`Quote email sent for ${quote.quoteNumber}.`, "success");
    } catch (err) {
      setState((prev) => ({ ...prev, error: err?.message || "Failed to send quote email." }));
    } finally {
      setSendingQuoteEmailId("");
    }
  };

  const handleSendPaymentRequestEmail = async (quote) => {
    setSendingPaymentEmailId(quote.id);
    setState((prev) => ({ ...prev, error: "", feedback: "" }));
    try {
      const status = String(quote.status || "").trim().toLowerCase();
      if (!["accepted", "booked"].includes(status)) {
        throw new Error("Payment request email is only available after quote acceptance.");
      }
      if (isPortalExpired(quote)) {
        throw new Error("Portal link expired. Rotate the portal link before sending payment requests.");
      }

      let paymentLink = String(quote.payment?.depositLink || "").trim();
      if (!paymentLink) {
        paymentLink = await createCheckoutLink(quote);
      }

      const { exportQuoteProposal } = await import("../lib/proposalExport");
      const attachment = await exportQuoteProposal(quote, {
        basePortalUrl,
        output: "base64",
        compact: true
      });
      const portalLink = resolveQuotePortalLink(quote);

      await sendPaymentRequestToCustomerEmail({
        quoteId: quote.id,
        paymentLink,
        portalLink,
        attachment
      });

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

  return (
    <div className="modal-overlay" role="dialog" aria-modal="true">
      <div className="modal-card history-card">
        <div className="modal-head">
          <h2>Quote History</h2>
          <div className="right-actions">
            <button type="button" className="ghost" onClick={load} disabled={state.loading}>
              {state.loading ? "Refreshing..." : "Refresh"}
            </button>
            <button type="button" className="ghost" onClick={onClose}>Close</button>
          </div>
        </div>

        <p className="source-note">Source: {state.source || "-"}</p>
        {state.error && <p className="error-note">{state.error}</p>}
        {state.feedback && <p className="source-note">{state.feedback}</p>}
        <div className="history-controls">
          <input
            type="text"
            placeholder="Search customer name"
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
        </div>

        <div className="history-table-wrap">
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
              {!state.loading && filteredQuotes.length === 0 && (
                <tr>
                  <td colSpan="14">No quotes saved yet.</td>
                </tr>
              )}
              {filteredQuotes.map((quote) => {
                const statusTransitions = getAllowedStatusTransitions(quote.status)
                  .filter((status) => status !== "booked" && status !== "deleted");
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
                const quoteEventTypeId = String(quote.eventTypeId || quote.selection?.eventTypeId || "");
                const quoteEventTypeLabel = eventTypeNameById.get(quoteEventTypeId) || quoteEventTypeId || "-";
                return (
                  <tr key={quote.id}>
                    <td>{quote.quoteNumber || "-"}</td>
                    <td>{quote.customer?.name || quote.customer?.email || "-"}</td>
                    <td>{quoteEventTypeLabel}</td>
                    <td>{quote.event?.date || "-"}</td>
                    <td>{quote.event?.guests ?? "-"}</td>
                    <td>{currency(quote.totals?.total || 0)}</td>
                    <td>{currency(quote.totals?.deposit || 0)}</td>
                    <td>
                      <div className="history-meta-stack">
                        <select
                          value={quote.status || "draft"}
                          onChange={(e) => handleStatusUpdate(quote.id, e.target.value)}
                          disabled={updatingId === quote.id || statusTransitions.length === 0}
                        >
                          {statusOptions.map((status) => (
                            <option key={status} value={status}>{status}</option>
                          ))}
                        </select>
                        <small>{statusBucketLabel(quote.status || "draft")}</small>
                      </div>
                    </td>
                    <td>
                      <select
                        value={quote.payment?.depositStatus || "unpaid"}
                        onChange={(e) => handlePaymentUpdate(quote.id, e.target.value)}
                        disabled={updatingPaymentId === quote.id}
                      >
                        {PAYMENT_STATUSES.map((paymentStatus) => (
                          <option key={paymentStatus} value={paymentStatus}>{paymentStatus}</option>
                        ))}
                      </select>
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
                          <select
                            value={confirmationStatus}
                            onChange={(e) => handleConfirmationUpdate(quote.id, e.target.value)}
                            disabled={updatingConfirmationId === quote.id}
                          >
                            {BOOKING_CONFIRMATION_STATUSES.map((bookingStatus) => (
                              <option key={bookingStatus} value={bookingStatus}>{bookingStatus}</option>
                            ))}
                          </select>
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
                        {canConvert && (
                          <button
                            type="button"
                            className="cta compact"
                            onClick={() => handleConvertToContract(quote)}
                            disabled={convertingId === quote.id}
                          >
                            {convertingId === quote.id ? "Converting..." : "Convert"}
                          </button>
                        )}
                        {canTrackConfirmation && confirmationStatus !== "confirmed" && (
                          <button
                            type="button"
                            className="ghost compact"
                            onClick={() => handleConfirmationUpdate(quote.id, "confirmed")}
                            disabled={updatingConfirmationId === quote.id}
                          >
                            Confirm
                          </button>
                        )}
                        <button type="button" className="ghost compact" onClick={() => handleEditQuote(quote)}>
                          Edit
                        </button>
                        <button
                          type="button"
                          className="ghost compact"
                          onClick={() => handleDuplicateQuote(quote)}
                          disabled={duplicatingId === quote.id}
                        >
                          {duplicatingId === quote.id ? "Duplicating..." : "Duplicate"}
                        </button>
                        <button
                          type="button"
                          className="ghost compact"
                          onClick={() => handleExportPdf(quote)}
                          disabled={exportingPdfId === quote.id}
                        >
                          {exportingPdfId === quote.id ? "Generating PDF..." : "PDF"}
                        </button>
                        <button
                          type="button"
                          className="cta compact"
                          onClick={() => handleSendQuoteEmail(quote)}
                          disabled={sendingQuoteEmailId === quote.id}
                        >
                          {sendingQuoteEmailId === quote.id ? "Sending..." : "Send Quote Email"}
                        </button>
                        {canSendPaymentRequest && (
                          <button
                            type="button"
                            className="cta compact"
                            onClick={() => handleSendPaymentRequestEmail(quote)}
                            disabled={sendingPaymentEmailId === quote.id}
                          >
                            {sendingPaymentEmailId === quote.id ? "Sending..." : "Send Pay Request"}
                          </button>
                        )}
                        <button
                          type="button"
                          className="ghost compact"
                          onClick={() => handleRotatePortalLink(quote)}
                          disabled={rotatingPortalId === quote.id}
                        >
                          {rotatingPortalId === quote.id ? "Rotating..." : "Rotate Portal"}
                        </button>
                        <button type="button" className="ghost compact" onClick={() => handleCopyEmail(quote)}>Copy Email</button>
                        <button type="button" className="ghost compact" onClick={() => handleCopyPortalLink(quote)}>Copy Portal</button>
                        <button type="button" className="ghost compact" onClick={() => handleCopyPaymentLink(quote)}>Copy Pay Link</button>
                        <button
                          type="button"
                          className="cta compact"
                          onClick={() => handleCreateCheckout(quote)}
                          disabled={creatingCheckoutId === quote.id}
                        >
                          {creatingCheckoutId === quote.id ? "Creating..." : "Create Stripe Link"}
                        </button>
                        {canDeleteQuotes && (
                          <button
                            type="button"
                            className="ghost compact"
                            onClick={() => requestDeleteQuote(quote)}
                            disabled={updatingId === quote.id}
                          >
                            {updatingId === quote.id ? "Deleting..." : "Delete"}
                          </button>
                        )}
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
      </div>
    </div>
  );
}
