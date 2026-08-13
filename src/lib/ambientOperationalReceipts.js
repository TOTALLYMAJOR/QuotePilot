import { createSurfacePurposeContract } from "./ambientContracts";

export const AMBIENT_OPERATIONAL_RECEIPTS_MODEL = "ambient-operational-receipts-v1";

export const AMBIENT_OPERATIONAL_RECEIPTS_SURFACE = createSurfacePurposeContract({
  id: "ambient-operational-receipts",
  objectScopes: ["opportunity", "acceptance", "payment", "contract", "beo", "staffing", "closeout"],
  purposes: ["clarify", "advance", "resolve", "reveal_context"],
  entryReason: "Keep immutable customer, commercial, and operational evidence separate after acceptance and booking.",
  allowedEmptyState: {
    kind: "caught_up",
    message: "No post-acceptance operational receipt is required for this opportunity yet."
  },
  recoveryBehavior: {
    message: "Keep every unavailable evidence domain explicit and continue through its existing role-safe authority surface.",
    nextActionIds: ["open-legacy-opportunity-controls", "open-workflow"]
  }
});

const STAFF_ROLES = new Set(["admin", "sales"]);
const ACCEPTED_STATES = new Set(["accepted", "booked"]);
const BOOKED_STATES = new Set(["booked"]);
const DEPOSIT_PAID_STATES = new Set(["paid", "succeeded", "settled"]);
const FINAL_PAID_STATES = new Set(["paid", "succeeded", "settled"]);

function text(value, maximum = 240) {
  const candidate = String(value ?? "").trim();
  if (!candidate || candidate.length > maximum || /[\u0000-\u001f\u007f]/u.test(candidate)) return "";
  return candidate;
}

function normalizedState(value) {
  return text(value, 64).toLowerCase().replaceAll("-", "_");
}

function exactIso(value) {
  const candidate = text(value, 64);
  if (!candidate) return "";
  const parsed = new Date(candidate);
  return Number.isNaN(parsed.getTime()) || parsed.toISOString() !== candidate ? "" : candidate;
}

function immutable(value, seen = new WeakSet()) {
  if (!value || typeof value !== "object" || Object.isFrozen(value) || seen.has(value)) return value;
  seen.add(value);
  Reflect.ownKeys(value).forEach((key) => immutable(value[key], seen));
  return Object.freeze(value);
}

function receipt({
  id,
  label,
  state,
  summary,
  detail,
  receiptId = "",
  occurredAtISO = "",
  source,
  consequence,
  resolution,
  authority = "existing_authority_surface"
}) {
  return immutable({
    id,
    label,
    state,
    summary,
    detail,
    receiptId: text(receiptId, 256) || null,
    occurredAtISO: exactIso(occurredAtISO) || null,
    source,
    consequence,
    resolution: immutable({
      id: resolution.id,
      label: resolution.label,
      available: resolution.available === true,
      reason: resolution.reason
    }),
    authority
  });
}

function acceptanceReceipt(quote, role) {
  const lifecycle = quote?.lifecycle || {};
  const evidence = quote?.acceptanceReceipt || quote?.acceptance || {};
  const lifecycleState = normalizedState(quote?.status);
  const receiptId = text(evidence.receiptId || evidence.id, 256);
  const acceptedAtISO = exactIso(evidence.acceptedAtISO || lifecycle.acceptedAtISO);
  const sourceVersionId = text(
    evidence.quoteRevisionId
      || evidence.sourceVersionId
      || evidence.versionId
      || quote?.acceptedVersionId,
    256
  );
  const accepted = ACCEPTED_STATES.has(lifecycleState);
  const exact = accepted && receiptId && acceptedAtISO && sourceVersionId;
  return receipt({
    id: "acceptance",
    label: "Customer acceptance",
    state: exact ? "resolved" : accepted ? "needs_evidence" : "not_due",
    summary: exact
      ? "Exact customer acceptance is recorded"
      : accepted
        ? "Accepted lifecycle state needs its exact receipt"
        : "Customer acceptance is not recorded",
    detail: exact
      ? `Receipt ${receiptId} binds the accepted proposal version and recorded acceptance time.`
      : accepted
        ? "The lifecycle label alone does not prove which proposal version the customer accepted."
        : "Proposal delivery, viewing, and customer acceptance remain separate evidence.",
    receiptId,
    occurredAtISO: acceptedAtISO,
    source: exact ? "immutable acceptance receipt" : "saved quote lifecycle",
    consequence: "Contract conversion and post-acceptance automation must remain bound to the exact accepted proposal revision.",
    resolution: {
      id: exact ? "review-acceptance-receipt" : "open-proposal-controls",
      label: exact ? "Review acceptance receipt" : "Resolve proposal evidence",
      available: STAFF_ROLES.has(role),
      reason: exact
        ? "The exact receipt is available for review."
        : "Use the existing proposal and workflow controls to recover missing evidence."
    }
  });
}

function paymentReceipt(quote, role) {
  const payment = quote?.payment || {};
  const depositState = normalizedState(payment.depositStatus || payment.deposit?.status);
  const finalState = normalizedState(payment.finalBalance?.status || payment.finalBalanceStatus);
  const depositConfirmedAtISO = exactIso(payment.depositConfirmedAtISO || payment.deposit?.paidAtISO);
  const finalConfirmedAtISO = exactIso(payment.finalBalance?.confirmedAtISO || payment.finalBalance?.paidAtISO);
  const depositPaid = DEPOSIT_PAID_STATES.has(depositState) && Boolean(depositConfirmedAtISO);
  const finalPaid = FINAL_PAID_STATES.has(finalState) && Boolean(finalConfirmedAtISO);
  const receiptId = text(
    payment.finalBalance?.stripeSessionId
      || payment.finalBalance?.receiptId
      || payment.stripeSessionId
      || payment.deposit?.receiptId
      || payment.lastReceiptId,
    256
  );
  const occurredAtISO = exactIso(
    finalConfirmedAtISO
      || payment.deposit?.paidAtISO
      || depositConfirmedAtISO
      || payment.paidAtISO
  );
  const state = finalPaid ? "resolved" : depositPaid ? "partial" : "needs_action";
  return receipt({
    id: "payment",
    label: "Payment evidence",
    state,
    summary: finalPaid
      ? "Deposit and final settlement are recorded separately"
      : depositPaid
        ? "Deposit is recorded; final settlement remains open"
        : "Provider-confirmed deposit is not recorded",
    detail: `Deposit: ${depositPaid ? "provider-confirmed paid" : depositState || "not recorded"}. Final settlement: ${finalPaid ? "provider-confirmed paid" : finalState || "not recorded"}. Browser returns and payment requests do not count as settlement.`,
    receiptId,
    occurredAtISO,
    source: "saved provider-confirmed payment projection",
    consequence: "Booking, balance collection, and closeout must not infer payment from a checkout return or an email request.",
    resolution: {
      id: state === "resolved" ? "review-payment-receipts" : "open-payment-controls",
      label: state === "resolved" ? "Review payment receipts" : "Resolve payment evidence",
      available: role === "admin",
      reason: role === "admin"
        ? "Admin can continue through the governed payment controls."
        : "Admin authority is required for payment requests and reconciliation."
    }
  });
}

function contractReceipt(quote, role) {
  const booking = quote?.booking || {};
  const lifecycleState = normalizedState(quote?.status);
  const contractNumber = text(booking.contractNumber, 120);
  const convertedAtISO = exactIso(
    booking.contractConvertedAtISO
      || booking.convertedAtISO
      || booking.bookedAtISO
      || quote?.lifecycle?.bookedAtISO
  );
  const booked = BOOKED_STATES.has(lifecycleState);
  const exact = booked && contractNumber && convertedAtISO;
  return receipt({
    id: "contract",
    label: "Contract and booking",
    state: exact ? "resolved" : booked ? "needs_evidence" : ACCEPTED_STATES.has(lifecycleState) ? "needs_action" : "not_due",
    summary: exact
      ? `Contract ${contractNumber} is recorded`
      : booked
        ? "Booked lifecycle state needs its contract receipt"
        : ACCEPTED_STATES.has(lifecycleState)
          ? "Accepted opportunity is not yet converted to a contract"
          : "Contract conversion is not due",
    detail: exact
      ? "The contract identity and booking time are preserved independently from payment and customer confirmation."
      : "A lifecycle label without the contract identity is not an immutable booking receipt.",
    receiptId: text(booking.receiptId || booking.conversionReceiptId, 256),
    occurredAtISO: convertedAtISO,
    source: "saved contract conversion projection",
    consequence: "BEO, staffing, schedule, final-balance, and closeout work must remain tied to the exact booked contract.",
    resolution: {
      id: exact ? "review-contract-receipt" : "open-contract-controls",
      label: exact ? "Review contract receipt" : "Resolve contract conversion",
      available: role === "admin",
      reason: role === "admin"
        ? "Admin can continue through the existing contract conversion controls."
        : "Admin authority is required to convert an accepted quote to a contract."
    }
  });
}

function boundedOperationalReceipt({ quote, role, kind }) {
  const definitions = {
    beo: {
      label: "Kitchen BEO",
      evidence: quote?.kitchenBeo || quote?.kitchenBeoArtifact || quote?.beo || {},
      resolvedStates: new Set(["ready", "generated", "current"]),
      receiptKeys: ["receiptId", "generationReceiptId"],
      timeKeys: ["generatedAtISO", "updatedAtISO"],
      source: "server-derived BEO projection",
      consequence: "Kitchen production should use only an exact current artifact with its immutable generation receipt.",
      openLabel: "Resolve BEO evidence"
    },
    staffing: {
      label: "Operational staffing",
      evidence: quote?.operationalStaffing || quote?.staffingAuthority || {},
      resolvedStates: new Set(["covered", "confirmed", "resolved"]),
      receiptKeys: ["receiptId", "assignmentReceiptId"],
      timeKeys: ["recordedAtISO", "updatedAtISO"],
      source: "tenant-isolated operational staffing projection",
      consequence: "Coverage requires authoritative assignments and availability evidence, not quoted labor counts.",
      openLabel: "Resolve staffing coverage"
    },
    closeout: {
      label: "Event closeout",
      evidence: quote?.postEventCloseout || quote?.closeout || {},
      resolvedStates: new Set(["completed"]),
      receiptKeys: ["receiptId", "lastActionReceiptId"],
      timeKeys: ["completedAtISO", "updatedAtISO"],
      source: "server-owned post-event closeout projection",
      consequence: "Post-event follow-up must remain bound to the exact booked and accepted source plus completed review evidence.",
      openLabel: "Resolve event closeout"
    }
  };
  const definition = definitions[kind];
  const evidence = definition.evidence;
  const stateValue = normalizedState(evidence.state || evidence.status);
  const resolved = definition.resolvedStates.has(stateValue);
  const receiptId = definition.receiptKeys.map((key) => text(evidence[key], 256)).find(Boolean) || "";
  const occurredAtISO = definition.timeKeys.map((key) => exactIso(evidence[key])).find(Boolean) || "";
  const hasEvidence = Boolean(stateValue || receiptId || occurredAtISO);
  return receipt({
    id: kind,
    label: definition.label,
    state: resolved && receiptId ? "resolved" : hasEvidence ? "partial" : "unavailable",
    summary: resolved && receiptId
      ? `${definition.label} receipt is recorded`
      : hasEvidence
        ? `${definition.label} evidence is incomplete`
        : `${definition.label} evidence is unavailable here`,
    detail: hasEvidence
      ? `Recorded state: ${stateValue || "not recorded"}. An exact receipt is ${receiptId ? "present" : "not present"}.`
      : "Open the existing governed operational surface for current evidence. No healthy state is inferred from absence.",
    receiptId,
    occurredAtISO,
    source: definition.source,
    consequence: definition.consequence,
    resolution: {
      id: `open-${kind}-controls`,
      label: resolved && receiptId ? `Review ${definition.label.toLowerCase()} receipt` : definition.openLabel,
      available: STAFF_ROLES.has(role),
      reason: STAFF_ROLES.has(role)
        ? "Continue through the existing role-safe operational surface."
        : "Staff authority is required to review operational evidence."
    }
  });
}

function nextUnresolved(receipts) {
  const priorities = ["acceptance", "contract", "payment", "beo", "staffing", "closeout"];
  const unresolved = priorities
    .map((id) => receipts.find((item) => item.id === id))
    .find((item) => item && !["resolved", "not_due"].includes(item.state));
  if (unresolved) {
    return immutable({
      state: "attention",
      receiptId: unresolved.id,
      label: unresolved.resolution.label,
      reason: unresolved.detail,
      consequence: unresolved.consequence,
      available: unresolved.resolution.available
    });
  }
  const resolvedCount = receipts.filter((item) => item.state === "resolved").length;
  return immutable({
    state: "caught_up",
    receiptId: null,
    label: resolvedCount ? "Operational receipts are current" : "No operational receipt is due yet",
    reason: resolvedCount
      ? "Every applicable receipt exposed by this saved projection is resolved."
      : "This opportunity has not reached a post-acceptance operational state.",
    consequence: "QuotePilot will keep payment, booking, production, staffing, and closeout evidence separate.",
    available: false
  });
}

export function buildAmbientOperationalReceipts(quote = {}, { role = "customer" } = {}) {
  const normalizedRole = STAFF_ROLES.has(normalizedState(role)) ? normalizedState(role) : "customer";
  const lifecycleState = normalizedState(quote?.status) || "draft";
  const applicable = ACCEPTED_STATES.has(lifecycleState);
  const receipts = [
    acceptanceReceipt(quote, normalizedRole),
    contractReceipt(quote, normalizedRole),
    paymentReceipt(quote, normalizedRole),
    boundedOperationalReceipt({ quote, role: normalizedRole, kind: "beo" }),
    boundedOperationalReceipt({ quote, role: normalizedRole, kind: "staffing" }),
    boundedOperationalReceipt({ quote, role: normalizedRole, kind: "closeout" })
  ];
  return immutable({
    modelId: AMBIENT_OPERATIONAL_RECEIPTS_MODEL,
    surfaceContract: AMBIENT_OPERATIONAL_RECEIPTS_SURFACE,
    lifecycleState,
    applicable,
    summary: applicable
      ? "Acceptance, payment, contract, BEO, staffing, and closeout stay as separate receipts."
      : "Operational receipts appear after customer acceptance without changing proposal or pricing authority.",
    receipts,
    nextUnresolved: nextUnresolved(receipts)
  });
}
