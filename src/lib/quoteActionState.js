export const QUOTE_ACTION_STATE_MODEL = "configured-quote-action-state-v2";

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
      visible: false,
      enabled: false,
      disabledReason: "This action is not available to the current actor or source.",
      authorityLevel: "unknown",
      executionTarget: "unknown"
    };
}

function withRuntimeActions(baseActions, runtimeActions) {
  const sourceActions = baseActions && typeof baseActions === "object" ? baseActions : {};
  const surfaceActions = runtimeActions && typeof runtimeActions === "object" ? runtimeActions : {};
  return Object.fromEntries(
    [...new Set([...Object.keys(sourceActions), ...Object.keys(surfaceActions)])].map((id) => [
      id,
      {
        ...baseAction(sourceActions, id),
        runtime: surfaceActions[id] && typeof surfaceActions[id] === "object"
          ? surfaceActions[id]
          : {}
      }
    ])
  );
}

function decorate(baseActions, id, overrides = {}) {
  const source = baseAction(baseActions, id);
  const runtime = source.runtime && typeof source.runtime === "object" ? source.runtime : {};
  const { runtime: _runtime, ...sourceAction } = source;
  const roleAllowed = source.visible === true || source.enabled === true;
  const sourceAllowed = source.enabled === true;
  const stateAllowed = overrides.stateAllowed !== false;
  const runtimeAllowed = runtime.enabled !== false;
  const visible = overrides.visible !== false && runtime.visible !== false && roleAllowed;
  const disabledReason = !roleAllowed
    ? source.disabledReason || "This action is not available to the current actor or source."
    : !sourceAllowed
      ? source.disabledReason || "This action is not available from the current source."
    : !stateAllowed
      ? text(overrides.disabledReason) || "This action is not available in the current quote state."
      : !runtimeAllowed
        ? text(runtime.disabledReason) || "This action is temporarily unavailable from this surface."
        : "";
  return immutable({
    ...sourceAction,
    id,
    label: text(runtime.label || overrides.label || source.outcomeLabel || id),
    visible,
    enabled: Boolean(visible && sourceAllowed && stateAllowed && runtimeAllowed),
    disabledReason,
    consequence: text(runtime.consequence || overrides.consequence),
    requiresConfirmation: runtime.requiresConfirmation === true || overrides.requiresConfirmation === true,
    presentation: text(runtime.presentation || overrides.presentation || "secondary")
  });
}

function firstVisible(actions, ids) {
  for (const id of ids) {
    const action = actions[id];
    if (action?.visible) return action;
  }
  return null;
}

function firstEnabled(actions, ids) {
  for (const id of ids) {
    const action = actions[id];
    if (action?.visible && action?.enabled) return action;
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
  depositNeedsReconciliation,
  finalBalanceNeedsReconciliation,
  portalIsExpired,
  acceptedProgressionPolicy
}) {
  const contractRecovery = firstVisible(actions, ["convert_contract_refresh"]);
  if (contractRecovery) return contractRecovery;
  if (["outcome_ambiguous", "outcome_unknown"].includes(delivery)) {
    return firstVisible(actions, ["review_delivery"]);
  }
  if (delivery === "sending") return null;
  if (depositNeedsReconciliation) return firstVisible(actions, ["reconcile_deposit"]);
  if (finalBalanceNeedsReconciliation) return firstVisible(actions, ["reconcile_balance"]);

  if (status === "expired") return firstVisible(actions, ["reopen"]);
  if (portalIsExpired) {
    const portalRecovery = firstVisible(actions, ["rotate_portal"]);
    if (portalRecovery) return portalRecovery;
  }
  if (status === "declined") return firstVisible(actions, ["duplicate"]);
  if (status === "deleted") return null;

  if (status === "draft") {
    return firstVisible(actions, ["send_quote", "edit"]);
  }
  if (["sent", "viewed"].includes(status)) {
    return firstEnabled(actions, ["open_conversation"])
      || firstVisible(actions, ["send_quote"]);
  }
  if (status === "accepted") {
    const order = acceptedProgressionPolicy === "deposit_first"
      ? ["request_deposit", "convert_contract"]
      : ["convert_contract", "request_deposit"];
    return firstEnabled(actions, order) || firstVisible(actions, order);
  }
  if (status === "booked") {
    if (!depositSettled) return firstVisible(actions, ["request_deposit"]);
    if (finalBalanceDue) return firstVisible(actions, ["request_balance"]);
    if (contractPresent) return firstEnabled(actions, ["open_conversation"]);
  }
  return null;
}

export function compileConfiguredQuoteActions({
  quote = null,
  baseActions = {},
  runtimeActions = {},
  source = "",
  nowMs = Date.now(),
  acceptedProgressionPolicy = "contract_first"
} = {}) {
  baseActions = withRuntimeActions(baseActions, runtimeActions);
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
  const depositConfirmedAtISO = text(quote?.payment?.depositConfirmedAtISO);
  const depositSessionId = text(quote?.payment?.stripeSessionId);
  const depositPaid = depositStatus === "paid"
    && /^cs_[A-Za-z0-9_]+$/.test(depositSessionId)
    && Boolean(depositConfirmedAtISO);
  const depositSettled = ["paid", "refunded"].includes(depositStatus)
    || Boolean(depositConfirmedAtISO);
  const depositAmountCents = moneyCents(quote?.totals?.deposit);
  const contractPresent = Boolean(text(quote?.booking?.contractNumber))
    && Boolean(text(quote?.booking?.contractConvertedAtISO));
  const finalBalance = quote?.payment?.finalBalance || {};
  const finalBalanceStatus = normalized(finalBalance.status) || "unpaid";
  const storedBalanceCents = Number(finalBalance.amountCents);
  const finalBalanceCents = Number.isSafeInteger(storedBalanceCents) && storedBalanceCents > 0
    ? storedBalanceCents
    : 0;
  const finalBalanceDue = status === "booked"
    && contractPresent
    && depositPaid
    && finalBalanceCents > 0
    && finalBalanceStatus !== "paid";
  const depositCheckoutState = normalized(quote?.payment?.stripeCheckoutState);
  const depositNeedsReconciliation = Boolean(depositSessionId)
    && !depositSettled
    && ["processing", "failed", "expired", "unknown"].includes(depositCheckoutState);
  const finalBalanceSessionId = text(finalBalance.stripeSessionId);
  const finalBalanceCheckoutState = normalized(finalBalance.stripeCheckoutState);
  const finalBalanceNeedsReconciliation = finalBalanceDue
    && Boolean(finalBalanceSessionId)
    && ["processing", "failed", "expired", "unknown"].includes(finalBalanceCheckoutState);

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
    consequence: status === "draft"
      ? "Open the current saved draft for changes."
      : "Create a new draft version while preserving the previously sent or viewed version.",
  });

  actions.duplicate = decorate(baseActions, "duplicate", {
    label: "Create alternate draft",
    visible: status !== "deleted",
    stateAllowed: status !== "deleted" && !deliveryLocked,
    disabledReason: deliveryLocked
      ? "Resolve the current delivery attempt before creating a related draft."
      : "",
    consequence: "Create a separate draft using this client, event, and quote configuration. The current quote remains unchanged.",
    requiresConfirmation: true
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
    consequence: "Submit the exact saved proposal revision through QuotePilot's tracked email provider path.",
    presentation: status === "draft" ? "primary_candidate" : "secondary"
  });

  actions.review_delivery = decorate(baseActions, "review_delivery", {
    label: "Resolve delivery outcome",
    visible: ["outcome_ambiguous", "outcome_unknown"].includes(delivery),
    stateAllowed: ["outcome_ambiguous", "outcome_unknown"].includes(delivery),
    consequence: "Review provider evidence for the exact saved revision without assuming whether delivery occurred.",
    presentation: "recovery"
  });

  actions.open_conversation = decorate(baseActions, "open_conversation", {
    label: "Open conversation",
    visible: ["sent", "viewed", "accepted", "booked"].includes(status) && portalShareable,
    stateAllowed: ["sent", "viewed", "accepted", "booked"].includes(status) && portalShareable,
    disabledReason: !portalShareable
      ? "Conversation requires current customer portal access for this quote."
      : "",
    consequence: "Open the quote-scoped customer conversation without changing commercial state."
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
    consequence: "Send the approved Stripe deposit request for the exact customer and commercial scope.",
    presentation: "primary_candidate"
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
    consequence: "Convert the accepted quote through the trusted contract workflow and availability check.",
    presentation: "primary_candidate"
  });

  actions.manage_confirmation = decorate(baseActions, "manage_confirmation", {
    label: "Record customer confirmation",
    visible: status === "booked" && contractPresent,
    stateAllowed: status === "booked" && contractPresent && !deliveryLocked,
    disabledReason: deliveryLocked
      ? "Resolve the current delivery attempt before changing booking confirmation evidence."
      : "",
    consequence: "Record operator-observed booking confirmation state. This does not send a customer message."
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
    consequence: "Send the approved final-balance request for the booked contract and verified paid deposit scope.",
    presentation: "primary_candidate"
  });

  actions.reopen = decorate(baseActions, "reopen", {
    label: "Restore as draft",
    visible: status === "expired",
    stateAllowed: status === "expired" && !deliveryLocked,
    disabledReason: deliveryLocked
      ? "Resolve the current delivery attempt before restoring this quote."
      : "",
    consequence: "Restore the last eligible nonterminal commercial snapshot as a draft with new portal issuance.",
    presentation: "primary_candidate"
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
    consequence: "Issue new customer portal access; the previous portal identity is no longer current."
  });

  actions.review_beo = decorate(baseActions, "review_beo", {
    label: "Review Kitchen BEO",
    visible: status !== "deleted",
    stateAllowed: status !== "deleted",
    consequence: "Open the Kitchen BEO authority without changing quote or payment state."
  });

  actions.reconcile_deposit = decorate(baseActions, "reconcile_deposit", {
    label: "Check payment outcome",
    visible: Boolean(depositSessionId) && !depositSettled,
    stateAllowed: Boolean(depositSessionId) && !depositSettled && !deliveryLocked,
    disabledReason: deliveryLocked
      ? "Resolve the current quote-delivery attempt before reconciling payment."
      : "",
    consequence: "Ask Stripe for the authoritative outcome of the existing deposit checkout without creating another checkout.",
    presentation: depositNeedsReconciliation ? "recovery" : "secondary"
  });

  actions.reconcile_balance = decorate(baseActions, "reconcile_balance", {
    label: "Check final-balance outcome",
    visible: Boolean(finalBalanceSessionId) && finalBalanceStatus !== "paid",
    stateAllowed: Boolean(finalBalanceSessionId) && finalBalanceStatus !== "paid" && !deliveryLocked,
    disabledReason: deliveryLocked
      ? "Resolve the current quote-delivery attempt before reconciling the final balance."
      : "",
    consequence: "Ask Stripe for the authoritative outcome of the existing final-balance checkout without creating another checkout.",
    presentation: finalBalanceNeedsReconciliation ? "recovery" : "secondary"
  });

  actions.change_status = decorate(baseActions, "change_status", {
    label: "Expire quote",
    visible: ["draft", "sent", "viewed"].includes(status),
    stateAllowed: ["draft", "sent", "viewed"].includes(status) && !deliveryLocked,
    disabledReason: deliveryLocked
      ? "Resolve the current delivery attempt before expiring this quote."
      : "",
    consequence: "Mark this quote expired. This does not create customer acceptance, payment, or booking evidence.",
    requiresConfirmation: true
  });

  actions.copy_payment_link = decorate(baseActions, "copy_payment_link", {
    label: "Copy deposit link",
    visible: Boolean(text(quote?.payment?.depositLink)) && depositStatus === "sent",
    stateAllowed: Boolean(text(quote?.payment?.depositLink)) && depositStatus === "sent",
    consequence: "Copy the already-created deposit checkout link. No payment or delivery evidence changes."
  });

  actions.copy_balance_link = decorate(baseActions, "copy_balance_link", {
    label: "Copy final-balance link",
    visible: Boolean(text(finalBalance.paymentLink)) && finalBalanceStatus === "sent",
    stateAllowed: Boolean(text(finalBalance.paymentLink)) && finalBalanceStatus === "sent",
    consequence: "Copy the already-created final-balance checkout link. No settlement evidence changes."
  });

  actions.export_proposal = decorate(baseActions, "export_proposal", {
    label: "Download PDF",
    visible: status !== "deleted",
    stateAllowed: status !== "deleted",
    consequence: "Generate a proposal artifact without changing quote or delivery state."
  });

  actions.copy_email = decorate(baseActions, "copy_email", {
    label: "Copy email text",
    visible: status !== "deleted",
    stateAllowed: status !== "deleted",
    consequence: "Copy prepared email text for manual use. QuotePilot records no send or delivery evidence."
  });

  actions.copy_portal = decorate(baseActions, "copy_portal", {
    label: "Copy customer link",
    visible: PORTAL_SHAREABLE_STATUSES.has(status),
    stateAllowed: portalShareable,
    disabledReason: !portalShareable
      ? "Customer link sharing requires current provider-accepted portal access."
      : "",
    consequence: "Copy the current customer portal URL without changing commercial state."
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
    consequence: "Permanently delete this quote after the required approval and confirmation boundary.",
    requiresConfirmation: true
  });

  Object.keys(baseActions || {}).forEach((actionId) => {
    if (actions[actionId]) return;
    const runtimeManaged = Object.prototype.hasOwnProperty.call(runtimeActions || {}, actionId);
    actions[actionId] = decorate(baseActions, actionId, {
      visible: runtimeManaged,
      stateAllowed: runtimeManaged && runtimeActions[actionId]?.enabled !== false,
      disabledReason: runtimeManaged
        ? runtimeActions[actionId]?.disabledReason
        : "This capability is not a direct configured-quote action in the current state."
    });
  });

  const primaryAction = choosePrimary({
    actions,
    status,
    delivery,
    depositSettled,
    finalBalanceDue,
    contractPresent,
    depositNeedsReconciliation,
    finalBalanceNeedsReconciliation,
    portalIsExpired,
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
      depositPaid,
      contractPresent,
      finalBalanceDue,
      depositNeedsReconciliation,
      finalBalanceNeedsReconciliation
    },
    primaryAction: primaryAction || null,
    secondaryActions,
    blockedActions,
    actions: immutable(actions),
    evidence,
    closed: TERMINAL_STATUSES.has(status)
  });
}
