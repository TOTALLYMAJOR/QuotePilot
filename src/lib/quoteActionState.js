export const QUOTE_ACTION_STATE_MODEL = "configured-quote-action-state-v1";

const DELIVERY_MUTATION_LOCK_STATES = new Set([
  "sending",
  "outcome_ambiguous",
  "outcome_unknown"
]);
const PORTAL_SHAREABLE_STATUSES = new Set([
  "sent",
  "viewed",
  "accepted",
  "declined",
  "booked"
]);
const TERMINAL_STATUSES = new Set(["declined", "expired", "deleted"]);
const PAYMENT_APPROVAL_ACTIONS = new Set([
  "send_payment_request",
  "send_final_balance_request"
]);

function text(value) {
  return String(value ?? "").trim();
}

function normalized(value) {
  return text(value).toLowerCase();
}

function immutable(value, seen = new WeakSet()) {
  if (!value || typeof value !== "object" || Object.isFrozen(value) || seen.has(value)) return value;
  seen.add(value);
  Reflect.ownKeys(value).forEach((key) => immutable(value[key], seen));
  return Object.freeze(value);
}

function moneyCents(value) {
  const cents = Math.round(Number(value) * 100);
  return Number.isSafeInteger(cents) && cents >= 0 ? cents : 0;
}

function quoteId(quote) {
  return text(quote?.id || quote?.quoteId);
}

function quoteStatus(quote) {
  return normalized(quote?.status) || "draft";
}

function deliveryState(quote) {
  return normalized(quote?.workflow?.quoteDelivery?.state);
}

function hasSavedVersion(quote) {
  const versionId = text(quote?.activeVersionId || quote?.versionMeta?.versionId);
  const versionNumber = Number(quote?.latestVersionNumber || quote?.versionMeta?.versionNumber);
  return Boolean(versionId) || (Number.isSafeInteger(versionNumber) && versionNumber > 0);
}

function portalExpired(quote, nowMs) {
  const raw = text(quote?.portalExpiresAtISO || quote?.expiresAtISO);
  if (!raw) return true;
  const expiryMs = Date.parse(raw);
  return !Number.isFinite(expiryMs) || expiryMs <= nowMs;
}

function hasProviderAcceptance(quote) {
  const delivery = quote?.workflow?.quoteDelivery || {};
  return normalized(delivery.state) === "provider_accepted"
    && normalized(delivery.portalActivationState) === "active"
    && Boolean(text(delivery.providerMessageId || delivery.observedProviderMessageId));
}

function approvalFor(quote, action) {
  const requests = Array.isArray(quote?.workflow?.approvalRequests)
    ? quote.workflow.approvalRequests
    : [];
  return requests.find((request) => {
    if (normalized(request?.action) !== action) return false;
    if (normalized(request?.state) !== "approved") return false;
    const executionState = normalized(request?.executionState);
    if (!executionState || executionState === "awaiting_execution") return true;
    return PAYMENT_APPROVAL_ACTIONS.has(action) && executionState === "in_progress";
  }) || null;
}

function baseAction(baseActions, id) {
  const action = baseActions?.[id];
  return action && typeof action === "object"
    ? action
    : {
      id,
      outcomeLabel: id,
      enabled: false,
      disabledReason: "This action is not available to the current actor or source.",
      authorityLevel: "unknown",
      executionTarget: "unknown"
    };
}

function decorate(baseActions, id, overrides = {}) {
  const source = baseAction(baseActions, id);
  const roleAllowed = source.enabled === true;
  const stateAllowed = overrides.stateAllowed !== false;
  const visible = overrides.visible !== false && (roleAllowed || overrides.showWhenDisabled === true);
  const disabledReason = !roleAllowed
    ? source.disabledReason || "This action is not available to the current actor or source."
    : !stateAllowed
      ? text(overrides.disabledReason) || "This action is not available in the current quote state."
      : text(overrides.disabledReason);
  return immutable({
    ...source,
    id,
    label: text(overrides.label || source.outcomeLabel || id),
    category: text(overrides.category || "secondary"),
    priority: Number.isFinite(Number(overrides.priority)) ? Number(overrides.priority) : 100,
    visible,
    enabled: Boolean(roleAllowed && stateAllowed && !disabledReason),
    disabledReason,
    consequence: text(overrides.consequence),
    evidenceProduced: text(overrides.evidenceProduced),
    requiresConfirmation: overrides.requiresConfirmation === true,
    presentation: text(overrides.presentation || "secondary"),
    stateReason: text(overrides.stateReason)
  });
}

function firstVisible(actions, ids) {
  for (const id of ids) {
    const action = actions[id];
    if (action?.visible) return action;
  }
  return null;
}

function choosePrimary({
  actions,
  status,
  delivery,
  depositSettled,
  finalBalanceDue,
  contractPresent,
  acceptedProgressionPolicy
}) {
  if (["outcome_ambiguous", "outcome_unknown"].includes(delivery)) {
    return firstVisible(actions, ["review_delivery"]);
  }
  if (delivery === "sending") return null;

  if (status === "expired") return firstVisible(actions, ["reopen"]);
  if (status === "declined") return firstVisible(actions, ["duplicate"]);
  if (status === "deleted") return null;

  if (status === "draft") {
    return firstVisible(actions, ["send_quote", "edit"]);
  }
  if (["sent", "viewed"].includes(status)) {
    return firstVisible(actions, ["open_conversation", "edit"]);
  }
  if (status === "accepted") {
    const order = acceptedProgressionPolicy === "deposit_first"
      ? ["request_deposit", "convert_contract"]
      : ["convert_contract", "request_deposit"];
    return firstVisible(actions, order);
  }
  if (status === "booked") {
    if (!depositSettled) return firstVisible(actions, ["request_deposit"]);
    if (finalBalanceDue) return firstVisible(actions, ["request_balance"]);
    if (contractPresent) return firstVisible(actions, ["open_conversation"]);
  }
  return null;
}

export function compileConfiguredQuoteActions({
  quote = null,
  baseActions = {},
  source = "",
  nowMs = Date.now(),
  acceptedProgressionPolicy = "contract_first"
} = {}) {
  const id = quoteId(quote);
  const status = quoteStatus(quote);
  const delivery = deliveryState(quote);
  const firebaseBacked = normalized(source) === "firebase";
  const deliveryLocked = DELIVERY_MUTATION_LOCK_STATES.has(delivery);
  const providerAccepted = hasProviderAcceptance(quote);
  const versionSaved = hasSavedVersion(quote);
  const portalIsExpired = portalExpired(quote, nowMs);
  const portalShareable = PORTAL_SHAREABLE_STATUSES.has(status)
    && !portalIsExpired
    && (!firebaseBacked || providerAccepted);
  const depositStatus = normalized(quote?.payment?.depositStatus) || "unpaid";
  const depositSettled = ["paid", "refunded"].includes(depositStatus)
    || Boolean(text(quote?.payment?.depositConfirmedAtISO));
  const depositAmountCents = moneyCents(quote?.totals?.deposit);
  const contractPresent = Boolean(text(quote?.booking?.contractNumber))
    && Boolean(text(quote?.booking?.contractConvertedAtISO));
  const finalBalance = quote?.payment?.finalBalance || {};
  const finalBalanceStatus = normalized(finalBalance.status) || "unpaid";
  const derivedBalanceCents = Math.max(
    0,
    moneyCents(quote?.totals?.total) - moneyCents(quote?.totals?.deposit)
  );
  const storedBalanceCents = Number(finalBalance.amountCents);
  const finalBalanceCents = Number.isSafeInteger(storedBalanceCents) && storedBalanceCents >= 0
    ? storedBalanceCents
    : derivedBalanceCents;
  const finalBalanceDue = status === "booked"
    && contractPresent
    && depositSettled
    && finalBalanceCents > 0
    && finalBalanceStatus !== "paid";

  const depositApproval = approvalFor(quote, "send_payment_request");
  const balanceApproval = approvalFor(quote, "send_final_balance_request");
  const contractApproval = approvalFor(quote, "convert_to_contract");
  const portalApproval = approvalFor(quote, "rotate_portal_link");
  const deleteApproval = approvalFor(quote, "delete_quote");

  const actions = {};

  actions.edit = decorate(baseActions, "edit", {
    label: status === "draft" ? "Edit draft" : "Revise quote",
    visible: ["draft", "sent", "viewed"].includes(status),
    stateAllowed: ["draft", "sent", "viewed"].includes(status) && !deliveryLocked,
    disabledReason: deliveryLocked
      ? "Resolve the current delivery attempt before changing quote content."
      : "",
    category: "quote",
    consequence: status === "draft"
      ? "Open the current saved draft for changes."
      : "Create a new draft version while preserving the previously sent or viewed version.",
    evidenceProduced: "A trusted save creates a new immutable quote version.",
    priority: 40
  });

  actions.duplicate = decorate(baseActions, "duplicate", {
    label: "Create alternate draft",
    visible: status !== "deleted",
    stateAllowed: status !== "deleted" && !deliveryLocked,
    disabledReason: deliveryLocked
      ? "Resolve the current delivery attempt before creating a related draft."
      : "",
    category: "quote",
    consequence: "Create a separate draft using this client, event, and quote configuration. The current quote remains unchanged.",
    evidenceProduced: "The new quote receives its own identity, version, portal issuance, and proof state.",
    requiresConfirmation: true,
    priority: 70
  });

  actions.send_quote = decorate(baseActions, "send_quote", {
    label: ["accepted", "booked"].includes(status) ? "Resend proposal" : "Send proposal",
    visible: ["draft", "sent", "viewed", "accepted", "booked"].includes(status)
      && !providerAccepted,
    stateAllowed: ["draft", "sent", "viewed", "accepted", "booked"].includes(status)
      && versionSaved
      && !portalIsExpired
      && !deliveryLocked
      && !providerAccepted,
    disabledReason: !versionSaved
      ? "Save this quote as an exact version before sending."
      : portalIsExpired
        ? "Renew customer portal access before sending."
        : deliveryLocked
          ? "Resolve the current delivery attempt before starting another send."
          : providerAccepted
            ? "Provider acceptance is already recorded for this saved revision."
            : "",
    category: "delivery",
    consequence: "Submit the exact saved proposal revision through QuotePilot's tracked email provider path.",
    evidenceProduced: "A successful provider response records provider acceptance for the exact revision; recipient delivery remains separate evidence.",
    presentation: status === "draft" ? "primary_candidate" : "secondary",
    priority: 20
  });

  actions.review_delivery = decorate(baseActions, "review_delivery", {
    label: "Resolve delivery outcome",
    visible: ["outcome_ambiguous", "outcome_unknown"].includes(delivery),
    stateAllowed: ["outcome_ambiguous", "outcome_unknown"].includes(delivery),
    category: "recovery",
    consequence: "Review provider evidence for the exact saved revision without assuming whether delivery occurred.",
    evidenceProduced: "An audited resolution records either provider acceptance or confirmed not sent.",
    presentation: "recovery",
    priority: 0
  });

  actions.open_conversation = decorate(baseActions, "open_conversation", {
    label: "Open conversation",
    visible: ["sent", "viewed", "accepted", "booked"].includes(status) && portalShareable,
    stateAllowed: ["sent", "viewed", "accepted", "booked"].includes(status) && portalShareable,
    disabledReason: !portalShareable
      ? "Conversation requires current customer portal access for this quote."
      : "",
    category: "communication",
    consequence: "Open the quote-scoped customer conversation without changing commercial state.",
    priority: 50
  });

  actions.request_deposit = decorate(baseActions, "request_deposit", {
    label: normalized(depositApproval?.executionState) === "in_progress"
      ? "Resume deposit request"
      : "Request deposit",
    visible: ["accepted", "booked"].includes(status) && !depositSettled && depositAmountCents > 0,
    stateAllowed: ["accepted", "booked"].includes(status)
      && !depositSettled
      && depositAmountCents > 0
      && portalShareable
      && !deliveryLocked
      && Boolean(depositApproval),
    disabledReason: !depositApproval
      ? "Approve the deposit request in Workflow first."
      : !portalShareable
        ? "Deliver the current customer portal before requesting the deposit."
        : deliveryLocked
          ? "Resolve the current delivery attempt before requesting payment."
          : "",
    showWhenDisabled: ["accepted", "booked"].includes(status) && !depositSettled && depositAmountCents > 0,
    category: "payment",
    consequence: "Send the approved Stripe deposit request for the exact customer and commercial scope.",
    evidenceProduced: "The request can create provider checkout evidence; payment settlement remains separate evidence.",
    presentation: "primary_candidate",
    priority: 10
  });

  actions.convert_contract = decorate(baseActions, "convert_contract", {
    label: "Create contract",
    visible: status === "accepted" && !contractPresent,
    stateAllowed: status === "accepted"
      && !contractPresent
      && !deliveryLocked
      && Boolean(contractApproval),
    disabledReason: !contractApproval
      ? "Approve contract conversion in Workflow first."
      : deliveryLocked
        ? "Resolve the current delivery attempt before creating a contract."
        : "",
    showWhenDisabled: status === "accepted" && !contractPresent,
    category: "booking",
    consequence: "Convert the accepted quote through the trusted contract workflow and availability check.",
    evidenceProduced: "A successful trusted receipt records the contract identity and booked lifecycle state.",
    presentation: "primary_candidate",
    priority: 10
  });

  actions.manage_confirmation = decorate(baseActions, "manage_confirmation", {
    label: "Record customer confirmation",
    visible: status === "booked" && contractPresent,
    stateAllowed: status === "booked" && contractPresent && !deliveryLocked,
    disabledReason: deliveryLocked
      ? "Resolve the current delivery attempt before changing booking confirmation evidence."
      : "",
    category: "booking",
    consequence: "Record operator-observed booking confirmation state. This does not send a customer message.",
    evidenceProduced: "Booking confirmation status and timestamp are recorded as staff-entered evidence.",
    priority: 60
  });

  actions.request_balance = decorate(baseActions, "request_balance", {
    label: normalized(balanceApproval?.executionState) === "in_progress"
      ? "Resume final balance request"
      : "Request final balance",
    visible: finalBalanceDue,
    stateAllowed: finalBalanceDue
      && portalShareable
      && !deliveryLocked
      && Boolean(balanceApproval),
    disabledReason: !balanceApproval
      ? "Approve the final-balance request in Workflow first."
      : !portalShareable
        ? "Deliver the current customer portal before requesting the final balance."
        : deliveryLocked
          ? "Resolve the current delivery attempt before requesting the final balance."
          : "",
    showWhenDisabled: finalBalanceDue,
    category: "payment",
    consequence: "Send the approved final-balance request for the booked contract and verified paid deposit scope.",
    evidenceProduced: "The request can create provider checkout evidence; final settlement remains separate evidence.",
    presentation: "primary_candidate",
    priority: 10
  });

  actions.reopen = decorate(baseActions, "reopen", {
    label: "Restore as draft",
    visible: status === "expired",
    stateAllowed: status === "expired" && !deliveryLocked,
    disabledReason: deliveryLocked
      ? "Resolve the current delivery attempt before restoring this quote."
      : "",
    category: "quote",
    consequence: "Restore the last eligible nonterminal commercial snapshot as a draft with new portal issuance.",
    evidenceProduced: "A trusted reopen records a new draft state and portal issuance while preserving prior history.",
    presentation: "primary_candidate",
    priority: 10
  });

  actions.rotate_portal = decorate(baseActions, "rotate_portal", {
    label: "Renew customer link",
    visible: ["draft", "sent", "viewed", "accepted", "booked"].includes(status),
    stateAllowed: ["draft", "sent", "viewed", "accepted", "booked"].includes(status)
      && !deliveryLocked
      && (!firebaseBacked || Boolean(portalApproval)),
    disabledReason: firebaseBacked && !portalApproval
      ? "Approve customer-link renewal in Workflow first."
      : deliveryLocked
        ? "Resolve the current delivery attempt before renewing customer access."
        : "",
    category: "access",
    consequence: "Issue new customer portal access; the previous portal identity is no longer current.",
    evidenceProduced: "A trusted rotation records a new portal key and validity window.",
    priority: portalIsExpired ? 15 : 80
  });

  actions.export_proposal = decorate(baseActions, "export_proposal", {
    label: "Download PDF",
    visible: status !== "deleted",
    stateAllowed: status !== "deleted",
    category: "artifact",
    consequence: "Generate a proposal artifact without changing quote or delivery state.",
    priority: 90
  });

  actions.copy_email = decorate(baseActions, "copy_email", {
    label: "Copy email text",
    visible: status !== "deleted",
    stateAllowed: status !== "deleted",
    category: "manual_handoff",
    consequence: "Copy prepared email text for manual use. QuotePilot records no send or delivery evidence.",
    priority: 90
  });

  actions.copy_portal = decorate(baseActions, "copy_portal", {
    label: "Copy customer link",
    visible: PORTAL_SHAREABLE_STATUSES.has(status),
    stateAllowed: portalShareable,
    disabledReason: !portalShareable
      ? "Customer link sharing requires current provider-accepted portal access."
      : "",
    category: "manual_handoff",
    consequence: "Copy the current customer portal URL without changing commercial state.",
    priority: 90
  });

  actions.delete = decorate(baseActions, "delete", {
    label: "Delete quote",
    visible: status !== "deleted",
    stateAllowed: status !== "deleted"
      && !deliveryLocked
      && (!firebaseBacked || Boolean(deleteApproval)),
    disabledReason: firebaseBacked && !deleteApproval
      ? "Approve quote deletion in Workflow first."
      : deliveryLocked
        ? "Resolve the current delivery attempt before deleting this quote."
        : "",
    category: "administration",
    consequence: "Permanently delete this quote after the required approval and confirmation boundary.",
    requiresConfirmation: true,
    priority: 100
  });

  const primaryAction = choosePrimary({
    actions,
    status,
    delivery,
    depositSettled,
    finalBalanceDue,
    contractPresent,
    acceptedProgressionPolicy
  });

  const evidence = immutable({
    delivery: providerAccepted
      ? {
        state: "provider_accepted",
        label: "Provider accepted",
        atISO: text(quote?.workflow?.quoteDelivery?.providerAcceptedAtISO),
        providerMessageId: text(quote?.workflow?.quoteDelivery?.providerMessageId)
      }
      : {
        state: delivery || "not_recorded",
        label: delivery ? delivery.replaceAll("_", " ") : "Not recorded",
        atISO: "",
        providerMessageId: ""
      },
    deposit: {
      state: depositStatus,
      settled: depositSettled,
      confirmedAtISO: text(quote?.payment?.depositConfirmedAtISO)
    },
    contract: {
      state: contractPresent ? "recorded" : "not_recorded",
      contractNumber: text(quote?.booking?.contractNumber),
      convertedAtISO: text(quote?.booking?.contractConvertedAtISO)
    },
    finalBalance: {
      state: finalBalanceStatus,
      amountCents: finalBalanceCents,
      due: finalBalanceDue
    }
  });

  const visibleActions = Object.values(actions)
    .filter((action) => action.visible)
    .sort((left, right) => left.priority - right.priority || left.label.localeCompare(right.label));
  const secondaryActions = visibleActions.filter((action) => action.id !== primaryAction?.id);
  const blockedActions = visibleActions.filter((action) => !action.enabled);

  return immutable({
    modelId: QUOTE_ACTION_STATE_MODEL,
    quoteId: id || null,
    quoteStatus: status,
    source: normalized(source) || "unknown",
    acceptedProgressionPolicy: acceptedProgressionPolicy === "deposit_first"
      ? "deposit_first"
      : "contract_first",
    state: {
      delivery,
      deliveryLocked,
      providerAccepted,
      versionSaved,
      portalExpired: portalIsExpired,
      portalShareable,
      depositSettled,
      contractPresent,
      finalBalanceDue
    },
    primaryAction: primaryAction || null,
    secondaryActions,
    blockedActions,
    actions: immutable(actions),
    evidence,
    closed: TERMINAL_STATUSES.has(status)
  });
}
