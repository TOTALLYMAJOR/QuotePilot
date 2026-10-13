const EDITABLE_STATUSES = new Set(["draft", "sent", "viewed"]);

function text(value) {
  return String(value ?? "").trim();
}
function finiteNumber(value) {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : null;
}

function evidenceItem(kind, label, detail, recordedAtISO = "", revisionId = "") {
  return Object.freeze({
    kind,
    label,
    detail,
    recordedAtISO: text(recordedAtISO),
    revisionId: text(revisionId)
  });
}

function lifecycleProtocol(status) {
  if (status === "draft") {
    return Object.freeze({
      state: "editable_draft",
      label: "Draft revision",
      explanation: "The change creates a new governed draft revision. Nothing is sent or accepted by saving it.",
      nextAction: "Review the revised quote before any customer delivery.",
      canAmend: true
    });
  }
  if (["sent", "viewed"].includes(status)) {
    return Object.freeze({
      state: "renewed_delivery_required",
      label: "Renewed delivery required",
      explanation: "The saved customer-facing revision remains historical evidence. The amendment creates a new draft that must be reviewed and delivered again.",
      nextAction: "Review the revised draft, then issue a new customer delivery through the existing quote workflow.",
      canAmend: true
    });
  }
  return Object.freeze({
    state: "terminal_commitment_locked",
    label: "Committed record locked",
    explanation: "The existing trusted quote-edit authority does not mutate accepted, booked, paid, declined, refunded, expired, or deleted commitment evidence.",
    nextAction: "Use a separately authorized amendment or replacement workflow; do not overwrite historical truth.",
    canAmend: false
  });
}

export function buildCommercialAmendmentContext(quote = {}) {
  const status = text(quote.status).toLowerCase() || "draft";
  const revisionId = text(quote.activeVersionId || quote.versionMeta?.versionId);
  const versionNumber = Math.max(
    0,
    Math.round(finiteNumber(quote.latestVersionNumber ?? quote.versionMeta?.versionNumber) || 0)
  );
  const preservedEvidence = [];
  const acceptance = quote.acceptanceReceipt && typeof quote.acceptanceReceipt === "object"
    ? quote.acceptanceReceipt
    : null;
  const acceptanceReceiptId = text(acceptance?.receiptId);
  if (acceptanceReceiptId) {
    preservedEvidence.push(evidenceItem(
      "customer_acceptance",
      "Customer acceptance",
      "The recorded customer decision remains attached to its accepted revision; this amendment does not rewrite it.",
      acceptance?.acceptedAtISO,
      acceptance?.quoteRevisionId
    ));
  }

  const payment = quote.payment && typeof quote.payment === "object" ? quote.payment : {};
  if (text(payment.depositStatus).toLowerCase() === "paid" && text(payment.depositConfirmedAtISO)) {
    preservedEvidence.push(evidenceItem(
      "provider_payment",
      "Confirmed deposit",
      "Provider-confirmed deposit evidence remains historical and is not recalculated or replaced by this amendment.",
      payment.depositConfirmedAtISO,
      text(payment.quoteRevisionId || payment.revisionId)
    ));
  }

  const booking = quote.booking && typeof quote.booking === "object" ? quote.booking : {};
  if (text(booking.bookedAtISO) || text(booking.contractNumber)) {
    preservedEvidence.push(evidenceItem(
      "booking",
      "Booking and contract evidence",
      text(booking.contractNumber)
        ? `Contract ${text(booking.contractNumber)} remains historical evidence.`
        : "The recorded booking remains historical evidence.",
      booking.contractConvertedAtISO || booking.bookedAtISO,
      text(booking.quoteRevisionId || booking.revisionId)
    ));
  }

  const delivery = quote.deliveryEvidence && typeof quote.deliveryEvidence === "object"
    ? quote.deliveryEvidence
    : {};
  if (text(delivery.providerAcceptedAtISO)) {
    preservedEvidence.push(evidenceItem(
      "provider_delivery",
      "Provider-accepted delivery",
      "The prior provider acceptance remains attached to the delivered revision; a revised draft requires a new delivery action.",
      delivery.providerAcceptedAtISO,
      delivery.revisionId
    ));
  }

  const protocol = lifecycleProtocol(status);
  return Object.freeze({
    schemaVersion: 1,
    quoteId: text(quote.id),
    quoteNumber: text(quote.quoteNumber || quote.id),
    revisionId,
    versionNumber,
    versionLabel: versionNumber > 0 ? `Version ${versionNumber}` : "Current revision",
    status,
    editable: EDITABLE_STATUSES.has(status) && protocol.canAmend,
    event: Object.freeze({
      name: text(quote.event?.name),
      date: text(quote.event?.date),
      venue: text(quote.event?.venue),
      guests: finiteNumber(quote.event?.guests)
    }),
    commercial: Object.freeze({
      currency: text(quote.pricing?.currency || quote.payment?.currency || "USD").toUpperCase(),
      total: finiteNumber(quote.totals?.total),
      deposit: finiteNumber(quote.totals?.deposit)
    }),
    protocol,
    preservedEvidence: Object.freeze(preservedEvidence)
  });
}
