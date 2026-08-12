import { useEffect, useRef, useState } from "react";
import {
  getRebookDeliveryGate,
  isDefinitiveRebookQuoteDraftError
} from "../lib/rebookQuoteClient";

const EMPTY_MUTATION = Object.freeze({
  phase: "ready",
  receipt: null
});

function text(value) {
  return String(value ?? "").trim();
}

export function RebookQuoteReviewBanner({
  quoteNumber = "",
  organizationId = "",
  customerId = "",
  eventDate = "",
  tenantTimeZone = "",
  rebooking = null,
  onFocusEventDate
}) {
  const gate = getRebookDeliveryGate(
    {
      organizationId,
      customerId,
      event: { date: eventDate },
      rebooking
    },
    { tenantTimeZone }
  );
  if (!gate.applies) return null;

  return (
    <aside
      className={`rebook-review-banner ${gate.ready ? "source-note" : "warning-note"}`}
      data-capability-id="cwf-11-rebook-staff-review"
      data-rebook-review-state={gate.state}
      role="status"
      aria-live="polite"
    >
      <p className="eyebrow">Exact-version rebook</p>
      <h3>{gate.ready ? "Staff review recorded" : "Complete staff review before delivery"}</h3>
      <p>{quoteNumber ? `${quoteNumber}: ` : ""}{gate.message}</p>
      {gate.ready && !gate.deliveryReady && (
        <p className="warning-note">{gate.deliveryMessage}</p>
      )}
      {text(rebooking?.sourceEventDate) && (
        <p className="source-note">
          Accepted source event: {text(rebooking.sourceEventDate)}. The copied commercial scope remains a draft until this review is saved.
        </p>
      )}
      {!gate.deliveryReady && typeof onFocusEventDate === "function" && (
        <button type="button" className="ghost compact" onClick={onFocusEventDate}>
          Review event date
        </button>
      )}
    </aside>
  );
}

export function rebookDraftMutationPresentation(mutation = {}) {
  const phase = text(mutation.phase) || "ready";
  const receipt = mutation.receipt && typeof mutation.receipt === "object"
    ? mutation.receipt
    : null;
  if (phase === "unavailable") {
    return {
      state: "error",
      title: "Trusted rebook creation is unavailable here.",
      message: "Open this customer in an authenticated Firebase workspace. Browser-local mode will not create an unpriced or unreviewed substitute.",
      actionLabel: "Unavailable",
      action: "none"
    };
  }
  if (phase === "cancelled") {
    return {
      state: "ready",
      title: "No rebook request was sent.",
      message: "Your unsaved quote remains intact. Start again when you are ready to replace it after a trusted receipt.",
      actionLabel: "Create rebook draft",
      action: "create"
    };
  }
  if (phase === "submitting") {
    return {
      state: "submitting",
      title: "Creating reviewed rebook draft…",
      message: "QuotePilot is verifying the exact accepted version, current customer identity, and current catalog pricing.",
      actionLabel: "Creating draft…",
      action: "none"
    };
  }
  if (phase === "uncertain") {
    return {
      state: "uncertain",
      title: "Draft outcome is uncertain.",
      message: "Do not start another rebook. Reconcile the same server-derived source identity first.",
      actionLabel: "Reconcile draft",
      action: "reconcile"
    };
  }
  if (phase === "reconciliation") {
    return {
      state: "reconciliation",
      title: "Reconciling the exact rebook…",
      message: "QuotePilot is checking the deterministic draft identity; it is not creating a second request.",
      actionLabel: "Reconciling…",
      action: "none"
    };
  }
  if (phase === "receipt" && receipt) {
    const pendingDraftReview = text(receipt.status).toLowerCase() === "draft"
      && text(receipt.rebooking?.state) === "draft_created_for_staff_review";
    return {
      state: "receipt",
      title: receipt.idempotent
        ? "Matching rebook record confirmed."
        : "Rebook draft created for staff review.",
      message: receipt.rebooking?.state === "staff_review_completed"
        ? "The matching record already contains trusted staff-review evidence. Review its current lifecycle before acting."
        : "Current server-authoritative pricing was applied. Change and save a current-or-future event date before delivery can be attempted.",
      actionLabel: pendingDraftReview ? "Open draft to review" : "Open matching quote",
      action: "open"
    };
  }
  if (phase === "error") {
    return {
      state: "error",
      title: "Rebook draft was not created.",
      message: "The request was rejected before a trusted receipt. Refresh the client overview, review the source evidence, then retry the deterministic action.",
      actionLabel: "Retry after review",
      action: "recover"
    };
  }
  if (phase === "recovery") {
    return {
      state: "recovery",
      title: "Retrying after a definitive rejection…",
      message: "The exact accepted source and stable customer are being validated again.",
      actionLabel: "Retrying…",
      action: "none"
    };
  }
  return {
    state: "ready",
    title: "Create a reviewed rebook draft",
    message: "One click creates one deterministic draft from the exact accepted version, overlays current customer contact, and reprices from the current trusted catalog.",
    actionLabel: "Create rebook draft",
    action: "create"
  };
}

export default function CustomerRebookDraftAction({
  reviewedAction,
  onCreateRebook,
  onOpenQuote,
  onOpenQuoteEdit,
  available = true
}) {
  const [mutation, setMutation] = useState(
    available ? EMPTY_MUTATION : { phase: "unavailable", receipt: null }
  );
  const generationRef = useRef(0);
  const inFlightRef = useRef(false);
  const statusRef = useRef(null);
  const identity = [
    reviewedAction?.sourceQuoteId,
    reviewedAction?.sourceVersionId,
    reviewedAction?.acceptanceReceiptId
  ].map(text).join("\u0000");
  const presentation = rebookDraftMutationPresentation(mutation);
  const busy = ["submitting", "reconciliation", "recovery"].includes(presentation.state);
  const receiptNeedsEdit = text(mutation.receipt?.status).toLowerCase() === "draft"
    && text(mutation.receipt?.rebooking?.state) === "draft_created_for_staff_review";
  const openCallbackAvailable = receiptNeedsEdit
    ? typeof onOpenQuoteEdit === "function"
    : typeof onOpenQuote === "function";

  useEffect(() => {
    generationRef.current += 1;
    inFlightRef.current = false;
    setMutation(available ? EMPTY_MUTATION : { phase: "unavailable", receipt: null });
  }, [available, identity]);

  useEffect(() => () => {
    generationRef.current += 1;
    inFlightRef.current = false;
  }, []);

  useEffect(() => {
    if (presentation.state === "ready") return;
    statusRef.current?.focus();
  }, [presentation.state]);

  const run = async (phase) => {
    if (busy || inFlightRef.current || !available || typeof onCreateRebook !== "function") return;
    inFlightRef.current = true;
    const generation = generationRef.current + 1;
    generationRef.current = generation;
    setMutation({ phase, receipt: null });
    let trustedReceipt = null;
    try {
      trustedReceipt = await onCreateRebook(reviewedAction, {
        mode: phase === "reconciliation"
          ? "reconcile"
          : phase === "recovery"
            ? "recovery"
            : "create"
      });
      if (generationRef.current !== generation) return;
      setMutation({ phase: "receipt", receipt: trustedReceipt });
    } catch (error) {
      if (generationRef.current !== generation) return;
      setMutation({
        phase: error?.rebookCancelled === true
          ? "cancelled"
          : isDefinitiveRebookQuoteDraftError(error)
            ? "error"
            : "uncertain",
        receipt: null
      });
    } finally {
      if (generationRef.current === generation) inFlightRef.current = false;
    }
    if (
      generationRef.current === generation
      && text(trustedReceipt?.status).toLowerCase() === "draft"
      && text(trustedReceipt?.rebooking?.state) === "draft_created_for_staff_review"
      && typeof onOpenQuoteEdit === "function"
    ) {
      try {
        onOpenQuoteEdit(trustedReceipt.id);
      } catch {
        // The trusted receipt remains visible so navigation can be retried safely.
      }
    }
  };

  const handleAction = () => {
    if (presentation.action === "create") run("submitting");
    if (presentation.action === "reconcile") run("reconciliation");
    if (presentation.action === "recover") run("recovery");
    if (presentation.action === "open" && mutation.receipt?.id) {
      const pendingDraftReview = text(mutation.receipt.status).toLowerCase() === "draft"
        && text(mutation.receipt.rebooking?.state) === "draft_created_for_staff_review";
      if (pendingDraftReview) onOpenQuoteEdit?.(mutation.receipt.id);
      else onOpenQuote?.(mutation.receipt.id);
    }
  };

  return (
    <section
      className="staff-capability-state customer-rebook-draft-action"
      data-capability-id="cwf-11-exact-version-rebook"
      data-capability-state={presentation.state}
      data-mutation-state={presentation.state}
      aria-label="Exact-version rebook draft"
    >
      <div ref={statusRef} tabIndex={-1} aria-live="polite">
        <strong>{presentation.title}</strong>
        <p className={presentation.state === "uncertain" || presentation.state === "error"
          ? "warning-note"
          : "source-note"}
        >
          {presentation.message}
        </p>
      </div>
      <p className="source-note">
        No customer message, acceptance, booking, or payment is created by this action. Delivery stays blocked until the rebook review is saved.
      </p>
      {presentation.action !== "none" && (
        <button
          type="button"
          className={presentation.action === "create" ? "cta compact" : "ghost compact"}
          disabled={
            busy
            || (presentation.action !== "open" && typeof onCreateRebook !== "function")
            || (
              presentation.action === "open"
              && !openCallbackAvailable
            )
          }
          onClick={handleAction}
        >
          {presentation.actionLabel}
        </button>
      )}
      {presentation.action === "none" && (
        <button type="button" className="ghost compact" disabled>
          {presentation.actionLabel}
        </button>
      )}
    </section>
  );
}
