const ENABLED_BUILD_VALUES = new Set(["1", "true", "yes", "on"]);
const HEALTHY_EVIDENCE_STATES = new Set(["available", "not_applicable"]);
const BLOCKING_EVIDENCE_STATES = new Set([
  "missing",
  "not_yet_available",
  "blocked_by_integration",
  "stale",
  "contradictory",
  "schema_drift",
  "unavailable",
  "unknown",
  "partial"
]);

function text(value) {
  return String(value ?? "").trim();
}

function record(value) {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}

function finite(value) {
  return typeof value === "number" && Number.isFinite(value) ? value : null;
}

function whole(value) {
  return Number.isSafeInteger(value) && value >= 0 ? value : null;
}

function freeze(value, seen = new WeakSet()) {
  if (!value || typeof value !== "object" || seen.has(value)) return value;
  seen.add(value);
  Reflect.ownKeys(value).forEach((key) => freeze(value[key], seen));
  return Object.freeze(value);
}

function evidenceState(value, fallback = "unavailable") {
  const normalized = text(value).toLowerCase();
  if (HEALTHY_EVIDENCE_STATES.has(normalized) || BLOCKING_EVIDENCE_STATES.has(normalized)) {
    return normalized;
  }
  return fallback;
}

function money(value, currency = "USD") {
  if (finite(value) === null) return "Not available";
  const safeCurrency = /^[A-Z]{3}$/u.test(text(currency).toUpperCase())
    ? text(currency).toUpperCase()
    : "USD";
  try {
    return new Intl.NumberFormat("en-US", {
      style: "currency",
      currency: safeCurrency,
      maximumFractionDigits: 2
    }).format(value);
  } catch {
    return "Not available";
  }
}

function signedMoney(value, currency = "USD") {
  if (finite(value) === null) return "Not available";
  if (value === 0) return "No change";
  return `${value > 0 ? "+" : "−"}${money(Math.abs(value), currency)}`;
}

function percent(value) {
  if (finite(value) === null) return "Not available";
  return `${(value * 100).toFixed(1)}%`;
}

function signedPercent(value) {
  if (finite(value) === null) return "Not available";
  if (value === 0) return "No change";
  return `${value > 0 ? "+" : "−"}${Math.abs(value * 100).toFixed(1)} points`;
}

function unavailableRow(id, label, state, reason) {
  return {
    id,
    label,
    current: "Not available",
    proposed: "Not available",
    difference: "Not available",
    evidenceState: evidenceState(state),
    reason: text(reason) || "The exact evidence required for this comparison is not available."
  };
}

function staffingSummary(value) {
  const required = whole(value?.totalRequired);
  const assigned = whole(value?.totalAssigned);
  if (required === null || assigned === null) return null;
  return `${required} required · ${assigned} assigned`;
}

function staffingDifference(current, proposed) {
  const currentRequired = whole(current?.totalRequired);
  const proposedRequired = whole(proposed?.totalRequired);
  const proposedAssigned = whole(proposed?.totalAssigned);
  if (currentRequired === null || proposedRequired === null || proposedAssigned === null) {
    return "Not available";
  }
  const requirementDelta = proposedRequired - currentRequired;
  const gap = Math.max(0, proposedRequired - proposedAssigned);
  const requirement = requirementDelta === 0
    ? "No requirement change"
    : `${requirementDelta > 0 ? "+" : "−"}${Math.abs(requirementDelta)} required`;
  return `${requirement} · ${gap} uncovered`;
}

function supplyShortageCount(value) {
  const explicit = whole(value?.shortageCount);
  if (explicit !== null) return explicit;
  return Array.isArray(value?.shortages)
    ? value.shortages.filter((entry) => Number(entry?.shortageQuantityMicros) > 0).length
    : null;
}

function supplySummary(value) {
  const coverage = text(value?.coverageState).toLowerCase();
  const shortages = supplyShortageCount(value);
  if (!coverage || shortages === null) return null;
  if (coverage === "covered") return "Covered · no recorded shortages";
  if (coverage === "shortage") {
    return `${shortages} recorded shortage${shortages === 1 ? "" : "s"}`;
  }
  return "Coverage unknown";
}

function supplyDifference(current, proposed) {
  const before = supplyShortageCount(current);
  const after = supplyShortageCount(proposed);
  if (before === null || after === null) return "Not available";
  const delta = after - before;
  if (delta === 0) return "No shortage-count change";
  return `${delta > 0 ? "+" : "−"}${Math.abs(delta)} recorded shortage${Math.abs(delta) === 1 ? "" : "s"}`;
}

export function buildCommercialConsequenceComparison(projection = {}) {
  const scenario = record(projection.scenario) ? projection.scenario : {};
  const consequences = record(projection.consequences) ? projection.consequences : {};
  const fulfillment = record(projection.fulfillment) ? projection.fulfillment : {};
  const currentGuests = whole(scenario.currentGuestCount);
  const proposedGuests = whole(scenario.proposedGuestCount);
  const guests = currentGuests !== null && proposedGuests !== null
    ? {
        id: "guests",
        label: "Guests",
        current: `${currentGuests} guests`,
        proposed: `${proposedGuests} guests`,
        difference: proposedGuests === currentGuests
          ? "No change"
          : `${proposedGuests > currentGuests ? "+" : "−"}${Math.abs(proposedGuests - currentGuests)} guests`,
        evidenceState: "available",
        reason: "Saved priced count compared with the current session proposal."
      }
    : unavailableRow("guests", "Guests", "missing", "The saved and proposed guest counts must both be present.");

  const menuNames = Array.isArray(scenario.selectedMenuItemNames)
    ? [...new Set(scenario.selectedMenuItemNames.map(text).filter(Boolean))]
    : [];
  const menu = menuNames.length
    ? {
        id: "menu",
        label: "Menu",
        current: menuNames.join(", "),
        proposed: menuNames.join(", "),
        difference: "No menu selection change in this scenario",
        evidenceState: "available",
        reason: "This guest-count scenario retains the currently reviewed draft menu identities."
      }
    : unavailableRow(
        "menu",
        "Menu",
        "missing",
        "Exact menu identities are missing; no unchanged-menu conclusion is inferred."
      );

  const commercial = record(consequences.commercial) ? consequences.commercial : {};
  const commercialState = evidenceState(commercial.evidenceState);
  const price = HEALTHY_EVIDENCE_STATES.has(commercialState)
    && finite(commercial.total?.before) !== null
    && finite(commercial.total?.proposedAfter) !== null
    ? {
        id: "price",
        label: "Price",
        current: money(commercial.total.before, commercial.currency),
        proposed: money(commercial.total.proposedAfter, commercial.currency),
        difference: signedMoney(commercial.total.delta, commercial.currency),
        evidenceState: commercialState,
        reason: "Values come from the existing authoritative commercial preview."
      }
    : unavailableRow(
        "price",
        "Price",
        commercialState,
        "The exact authoritative price preview is not current for this scenario."
      );

  const marginEvidence = record(consequences.margin) ? consequences.margin : {};
  const marginState = evidenceState(marginEvidence.evidenceState, "missing");
  const margin = HEALTHY_EVIDENCE_STATES.has(marginState)
    && finite(marginEvidence.before) !== null
    && finite(marginEvidence.proposedAfter) !== null
    ? {
        id: "margin",
        label: "Margin",
        current: percent(marginEvidence.before),
        proposed: percent(marginEvidence.proposedAfter),
        difference: signedPercent(marginEvidence.delta),
        evidenceState: marginState,
        reason: "Recorded-cost presentation only; no missing cost is estimated."
      }
    : unavailableRow(
        "margin",
        "Margin",
        marginState,
        "Complete recorded-cost coverage for both snapshots is required before margin can be compared."
      );

  const people = record(fulfillment.people) ? fulfillment.people : {};
  const peopleState = evidenceState(
    people.freshness === "stale" ? "stale" : people.evidenceState
  );
  const staffingCurrent = staffingSummary(people.current);
  const staffingProposed = staffingSummary(people.proposed);
  const staffing = HEALTHY_EVIDENCE_STATES.has(peopleState) && staffingCurrent && staffingProposed
    ? {
        id: "staffing",
        label: "Staffing",
        current: staffingCurrent,
        proposed: staffingProposed,
        difference: staffingDifference(people.current, people.proposed),
        evidenceState: peopleState,
        reason: "Current operator-confirmed assignments compared with existing projected requirements."
      }
    : unavailableRow(
        "staffing",
        "Staffing",
        peopleState,
        "Current staffing evidence and proposed requirements must both be complete and current."
      );

  const supplyEvidence = record(fulfillment.supply) ? fulfillment.supply : {};
  const supplyState = evidenceState(
    supplyEvidence.freshness === "stale" ? "stale" : supplyEvidence.evidenceState
  );
  const supplyCurrent = supplySummary(supplyEvidence.current);
  const supplyProposed = supplySummary(supplyEvidence.proposed);
  const supply = HEALTHY_EVIDENCE_STATES.has(supplyState) && supplyCurrent && supplyProposed
    ? {
        id: "supply",
        label: "Supply",
        current: supplyCurrent,
        proposed: supplyProposed,
        difference: supplyDifference(supplyEvidence.current, supplyEvidence.proposed),
        evidenceState: supplyState,
        reason: "Exact current inventory projection evidence only; this does not reserve stock."
      }
    : unavailableRow(
        "supply",
        "Supply",
        supplyState,
        "Current and proposed supply evidence must both be complete and current."
      );

  const rows = [guests, menu, price, margin, staffing, supply];
  const blockingEvidenceStates = [...new Set(
    rows.map((row) => row.evidenceState).filter((state) => !HEALTHY_EVIDENCE_STATES.has(state))
  )];
  return freeze({
    schemaVersion: "commercial-consequence-comparison-v1",
    authority: "presentation_only_projection",
    rows,
    canContinueToGovernedReview: blockingEvidenceStates.length === 0,
    blockingEvidenceStates,
    boundary: "This comparison cannot save, apply, price, staff, reserve supply, or update customer artifacts."
  });
}

export function buildGovernedQuoteStarts({ templates = [] } = {}) {
  const activeTemplates = (Array.isArray(templates) ? templates : []).flatMap((template) => {
    const id = text(template?.id);
    const name = text(template?.name);
    if (!id || !name || template?.active === false) return [];
    return [{ id, name }];
  });
  return freeze([
    {
      id: "blank",
      label: "Blank quote",
      availability: "available",
      provenance: "Current published Library and pricing settings",
      reviewBoundary: "Enter the event scope and complete the normal quote review before saving.",
      authority: "existing_quote_draft",
      action: "use_existing_blank_draft"
    },
    {
      id: "template",
      label: "Approved template",
      availability: activeTemplates.length ? "available" : "unavailable",
      provenance: activeTemplates.length
        ? "Current active Library template"
        : "No active Library template is available",
      reviewBoundary: "Review every copied value in the ordinary draft before the existing save authority can run.",
      authority: "existing_event_template",
      action: activeTemplates.length ? "review_existing_template" : null,
      templates: activeTemplates
    },
    {
      id: "prior_accepted",
      label: "Prior accepted event",
      availability: "review_required",
      provenance: "Exact accepted quote version and private acceptance receipt",
      reviewBoundary: "Choose the exact accepted source, then complete the existing staff rebook review before delivery.",
      authority: "existing_exact_version_rebook",
      action: "open_existing_rebook_review"
    }
  ]);
}

export function resolveDecisionPacketGate({ buildValue = "", tenantValue = false } = {}) {
  return ENABLED_BUILD_VALUES.has(text(buildValue).toLowerCase()) && tenantValue === true;
}

function decisionEvidence(quote) {
  const decision = text(quote?.portalDecision?.decision).toLowerCase();
  if (!decision) {
    return {
      evidenceState: "missing",
      decision: null,
      requestId: null,
      reason: "No customer decision is recorded for the current portal proposal."
    };
  }
  const terminal = ["accepted", "changes_requested", "declined"].includes(decision);
  const requestId = text(quote?.portalDecision?.requestId);
  const acceptedReceipt = text(quote?.acceptanceReceipt?.receiptId);
  if (!terminal || (!requestId && !(decision === "accepted" && acceptedReceipt))) {
    return {
      evidenceState: "contradictory",
      decision,
      requestId: requestId || null,
      reason: "The recorded decision lacks its exact decision or acceptance receipt identity."
    };
  }
  return {
    evidenceState: "available",
    decision,
    requestId: requestId || null,
    submittedAtISO: text(quote?.portalDecision?.submittedAtISO) || null,
    reason: "Recorded by the existing customer decision room."
  };
}

function acceptanceEvidence(quote) {
  const status = text(quote?.status).toLowerCase();
  const receipt = record(quote?.acceptanceReceipt) ? quote.acceptanceReceipt : null;
  if (!receipt) {
    return {
      evidenceState: ["accepted", "booked"].includes(status) ? "missing" : "not_applicable",
      receiptId: null,
      acceptedRevisionId: null,
      reason: ["accepted", "booked"].includes(status)
        ? "This accepted status has no exact acceptance receipt."
        : "Acceptance has not been recorded for this proposal."
    };
  }
  const receiptId = text(receipt.receiptId);
  const receiptRevisionId = text(receipt.quoteRevisionId);
  const expectedRevisionId = text(quote?.deliveryEvidence?.revisionId || quote?.activeVersionId);
  const issuedAtISO = text(quote?.portalIssuedAtISO);
  const receiptIssuedAtISO = text(receipt.portalIssuedAtISO);
  if (!receiptId || !receiptRevisionId || !expectedRevisionId) {
    return {
      evidenceState: "schema_drift",
      receiptId: receiptId || null,
      acceptedRevisionId: null,
      reason: "The acceptance receipt is missing exact revision identity."
    };
  }
  if (receiptRevisionId !== expectedRevisionId
    || (issuedAtISO && receiptIssuedAtISO && issuedAtISO !== receiptIssuedAtISO)) {
    return {
      evidenceState: "stale",
      receiptId,
      acceptedRevisionId: receiptRevisionId,
      reason: "The acceptance receipt does not match the current portal revision or issuance."
    };
  }
  return {
    evidenceState: "available",
    receiptId,
    acceptedRevisionId: receiptRevisionId,
    acceptedAtISO: text(receipt.acceptedAtISO) || null,
    reason: "Exact electronic acceptance receipt for the current portal revision."
  };
}

function paymentEvidence(quote) {
  const payment = record(quote?.payment) ? quote.payment : null;
  if (!payment) {
    return {
      evidenceState: "unavailable",
      depositState: null,
      finalBalanceState: null,
      reason: "Payment evidence is not available in this projection; no unpaid conclusion is made."
    };
  }
  const depositState = text(payment.depositStatus).toLowerCase();
  const finalBalanceState = text(payment.finalBalance?.status).toLowerCase();
  if (!depositState) {
    return {
      evidenceState: "missing",
      depositState: null,
      finalBalanceState: finalBalanceState || null,
      reason: "The current payment projection does not include deposit state."
    };
  }
  if (!["unpaid", "sent", "paid", "refunded"].includes(depositState)
    || (finalBalanceState && !["unpaid", "sent", "paid"].includes(finalBalanceState))) {
    return {
      evidenceState: "contradictory",
      depositState: null,
      finalBalanceState: null,
      reason: "The payment projection contains a state outside the existing payment vocabulary."
    };
  }
  return {
    evidenceState: "available",
    depositState,
    finalBalanceState: finalBalanceState || "not_recorded",
    depositConfirmedAtISO: text(payment.depositConfirmedAtISO) || null,
    reason: "Read from the existing server-owned payment projection."
  };
}

export function buildDecisionPacketProjection({ quote = {}, source = "" } = {}) {
  const acceptedFamily = ["accepted", "booked"].includes(text(quote?.status).toLowerCase());
  const connectedSource = ["firebase", "firebase-org"].includes(text(source).toLowerCase());
  const portalDecision = connectedSource
    ? decisionEvidence(quote)
    : {
        evidenceState: "unavailable",
        decision: null,
        requestId: null,
        reason: "Customer decision evidence requires a connected authoritative workspace."
      };
  const acceptance = connectedSource
    ? acceptanceEvidence(quote)
    : {
        evidenceState: "unavailable",
        receiptId: null,
        acceptedRevisionId: null,
        reason: "Acceptance evidence requires a connected authoritative workspace."
      };
  const payment = connectedSource
    ? paymentEvidence(quote)
    : {
        evidenceState: "unavailable",
        depositState: null,
        finalBalanceState: null,
        reason: "Payment evidence requires a connected authoritative workspace."
      };
  const internalHandoff = acceptedFamily
    && acceptance.evidenceState === "available"
    && connectedSource
    ? {
        evidenceState: "available",
        acceptedRevisionId: acceptance.acceptedRevisionId,
        acceptanceReceiptId: acceptance.receiptId,
        action: "open_existing_accepted_revision",
        reason: "Continue from the exact accepted revision using existing staff quote/event authorities."
      }
    : {
        evidenceState: acceptance.evidenceState === "available" && !connectedSource
          ? "unavailable"
          : acceptance.evidenceState,
        acceptedRevisionId: acceptance.acceptedRevisionId,
        acceptanceReceiptId: acceptance.receiptId,
        action: null,
        reason: acceptance.evidenceState === "stale"
          ? "Refresh the exact accepted quote before using this handoff."
          : !connectedSource
            ? "The internal handoff requires a connected authoritative workspace."
            : "An exact current acceptance receipt is required before the internal handoff is available."
      };
  const requiredStates = acceptedFamily
    ? [portalDecision.evidenceState, acceptance.evidenceState, payment.evidenceState, internalHandoff.evidenceState]
    : [portalDecision.evidenceState, acceptance.evidenceState, payment.evidenceState];
  const blocked = requiredStates.some((state) => !HEALTHY_EVIDENCE_STATES.has(state));
  return freeze({
    schemaVersion: "quote-decision-packet-v1",
    authority: "read_only_composition",
    quoteId: text(quote?.id || quote?.quoteId) || null,
    state: blocked ? "blocked" : "ready",
    portalDecision,
    acceptance,
    payment,
    internalHandoff,
    boundary: "This packet composes existing evidence. It does not accept, charge, book, deliver, or revise; it cannot create provider evidence."
  });
}
