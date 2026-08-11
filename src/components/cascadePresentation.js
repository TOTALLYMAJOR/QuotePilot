import { formatWorkspaceDate } from "../lib/workspacePresentation";

// Deterministic cascade presentation for the flag-gated Event Room
// (docs/POST_COMPETITIVE_DESIGN.md §4.9). Once a quote is accepted, the
// commercial afterlife is shown as a receipt chain in which every step
// reports ONLY its own recorded evidence on this quote document: acceptance
// receipt, retained version, contract conversion, the separate deposit and
// final-balance provider rails, booking confirmation, availability check,
// staff lead, and the post-event review. Nothing is inferred across steps,
// no timestamp is invented, and provider-dependent steps show provider
// truth or say they are waiting for it.
export const CASCADE_MODEL = "cascade-receipts-v1";

export const CASCADE_BOUNDS_NOTE =
  "Each step reports only the evidence recorded on this quote. A pending step is not a failure claim, and no step implies delivery, payment, or readiness beyond its own recorded state.";

const APPLICABLE_STATUSES = new Set(["accepted", "booked"]);

function text(value) {
  return String(value ?? "").trim();
}

function when(iso) {
  const value = text(iso);
  return value ? formatWorkspaceDate(value) : "";
}

function step(id, state, label, detail, timeISO = "") {
  return { id, state, label, detail, timeLabel: when(timeISO) };
}

export function buildCascadePresentation(quote = {}) {
  const status = text(quote.status).toLowerCase();
  if (!APPLICABLE_STATUSES.has(status)) {
    return { modelId: CASCADE_MODEL, applicable: false, steps: [], boundsNote: CASCADE_BOUNDS_NOTE };
  }

  const lifecycle = quote.lifecycle || {};
  const booking = quote.booking || {};
  const payment = quote.payment || {};
  const finalBalance = payment.finalBalance || {};
  const workflow = quote.workflow || {};
  const steps = [];

  const receiptId = text(quote.acceptanceReceipt?.receiptId);
  steps.push(receiptId || text(lifecycle.acceptedAtISO)
    ? step(
        "accepted",
        "done",
        "Proposal accepted",
        receiptId
          ? `Electronic acceptance receipt ${receiptId.slice(0, 14)}… on file.`
          : "Acceptance is recorded; no receipt id is stored on this record.",
        lifecycle.acceptedAtISO
      )
    : step("accepted", "pending", "Proposal accepted", "No acceptance evidence is recorded on this quote."));

  const versionId = text(quote.activeVersionId);
  steps.push(versionId
    ? step("version", "done", "Version retained", `Immutable version ${versionId} is the accepted record.`)
    : step("version", "pending", "Version retained", "No retained version id is recorded on this quote."));

  const contractNumber = text(booking.contractNumber);
  steps.push(contractNumber
    ? step("contract", "done", "Contract created", `${contractNumber} from the accepted scope.`, booking.contractConvertedAtISO)
    : step("contract", "pending", "Contract created", "Convert to contract from the role-gated Quotes actions when ready."));

  const depositStatus = text(payment.depositStatus).toLowerCase() || "unpaid";
  if (depositStatus === "paid") {
    steps.push(step("deposit-request", "done", "Deposit requested", "The approval-gated deposit request completed."));
    steps.push(step("deposit-paid", "done", "Deposit paid", "Provider-confirmed payment is recorded.", payment.depositConfirmedAtISO));
  } else if (depositStatus === "sent") {
    steps.push(step("deposit-request", "done", "Deposit requested", "The approval-gated request is with the customer."));
    steps.push(step("deposit-paid", "pending", "Deposit paid", "Awaiting the provider's signed payment confirmation."));
  } else if (depositStatus === "refunded") {
    steps.push(step("deposit-request", "done", "Deposit requested", "A deposit was collected and later refunded."));
    steps.push(step("deposit-paid", "done", "Deposit refunded", "The recorded deposit state is refunded."));
  } else {
    steps.push(step("deposit-request", "pending", "Deposit requested", "Not yet requested; deposit requests are approval-gated in Quotes."));
    steps.push(step("deposit-paid", "pending", "Deposit paid", "Follows the deposit request."));
  }

  const confirmation = text(booking.confirmationStatus).toLowerCase();
  if (confirmation === "confirmed") {
    steps.push(step("confirmation", "done", "Booking confirmed", "The customer confirmation is recorded.", booking.confirmedAtISO));
  } else if (confirmation === "sent") {
    steps.push(step("confirmation", "done", "Confirmation sent", "Awaiting the recorded customer confirmation.", booking.confirmationSentAtISO));
  } else if (confirmation === "cancelled") {
    steps.push(step("confirmation", "blocked", "Confirmation cancelled", "The recorded confirmation state is cancelled."));
  } else {
    steps.push(step("confirmation", "pending", "Booking confirmation", "No confirmation send is recorded on this quote."));
  }

  steps.push(text(booking.availabilityCheckedAtISO)
    ? step("availability", "done", "Date conflicts checked", "An availability check is recorded for this event date.", booking.availabilityCheckedAtISO)
    : step("availability", "pending", "Date conflicts checked", "No availability check is recorded on this quote."));

  steps.push(text(booking.staffLead)
    ? step("staff-lead", "done", `Staff lead: ${text(booking.staffLead)}`, "Assigned on this record.", booking.staffAssignedAtISO)
    : step("staff-lead", "pending", "Staff lead assigned", "No staff lead is recorded; assign one from Schedule."));

  if (status === "booked") {
    const balanceStatus = text(finalBalance.status).toLowerCase() || "unpaid";
    if (balanceStatus === "paid") {
      steps.push(step("final-balance", "done", "Final balance paid", "Provider-confirmed settlement is recorded."));
    } else if (balanceStatus === "sent") {
      steps.push(step("final-balance", "done", "Final balance requested", "Awaiting the provider's signed payment confirmation."));
    } else {
      steps.push(step(
        "final-balance",
        "pending",
        "Final balance",
        depositStatus === "paid"
          ? "Requestable from the approval-gated Quotes actions."
          : "Becomes requestable after the deposit is provider-confirmed."
      ));
    }

    const closeoutId = text(workflow.postEventCloseout?.closeoutId);
    steps.push(closeoutId
      ? step("closeout", "done", "Post-event review scheduled", "The governed closeout record exists for this booking.")
      : step("closeout", "pending", "Post-event review", "The governed closeout is created with a governed booking; none is recorded here."));
  }

  const doneCount = steps.filter((item) => item.state === "done").length;
  return {
    modelId: CASCADE_MODEL,
    applicable: true,
    status,
    headline: status === "booked" ? "Booked — the cascade so far" : "Accepted — the cascade so far",
    progressLabel: `${doneCount} of ${steps.length} steps recorded`,
    steps,
    boundsNote: CASCADE_BOUNDS_NOTE
  };
}
