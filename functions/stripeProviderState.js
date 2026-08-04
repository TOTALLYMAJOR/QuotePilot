class StripeProviderStateError extends Error {
  constructor(message, code = "failed-precondition") {
    super(message);
    this.name = "StripeProviderStateError";
    this.code = code;
  }
}

const STRIPE_CHECKOUT_EVENT_TYPES = new Set([
  "checkout.session.completed",
  "checkout.session.async_payment_succeeded",
  "checkout.session.async_payment_failed",
  "checkout.session.expired"
]);

function text(value) {
  return String(value ?? "").trim();
}

function normalizeStripeMode(value) {
  const mode = text(value).toLowerCase();
  if (!new Set(["test", "live"]).has(mode)) {
    throw new StripeProviderStateError(
      "STRIPE_MODE must be explicitly configured as test or live."
    );
  }
  return mode;
}

function assertStripeSecretKeyMode(secretKey, expectedMode) {
  const key = text(secretKey);
  const mode = normalizeStripeMode(expectedMode);
  const allowedPrefixes = mode === "live"
    ? ["sk_live_", "rk_live_"]
    : ["sk_test_", "rk_test_"];
  if (!allowedPrefixes.some((prefix) => key.startsWith(prefix))) {
    throw new StripeProviderStateError(
      `Stripe ${mode} mode requires a matching secret or restricted key.`
    );
  }
  return true;
}

function assertStripeObjectMode({ expectedMode, eventLivemode, sessionLivemode } = {}) {
  const mode = normalizeStripeMode(expectedMode);
  const expectedLivemode = mode === "live";
  if (
    typeof eventLivemode !== "boolean"
    || typeof sessionLivemode !== "boolean"
    || eventLivemode !== expectedLivemode
    || sessionLivemode !== expectedLivemode
  ) {
    throw new StripeProviderStateError(
      "Stripe event or Checkout Session mode does not match the configured environment."
    );
  }
  return { mode, livemode: expectedLivemode };
}

function assertStripeCheckoutEventEvidence({
  eventType,
  paymentStatus,
  sessionStatus,
  expectedSessionStatus,
  allowedPaymentStatuses
}) {
  if (sessionStatus !== expectedSessionStatus) {
    throw new StripeProviderStateError(
      `Stripe ${eventType} requires Checkout Session status=${expectedSessionStatus}.`
    );
  }
  if (!allowedPaymentStatuses.includes(paymentStatus)) {
    throw new StripeProviderStateError(
      `Stripe ${eventType} requires Checkout Session payment_status=${allowedPaymentStatuses.join(" or ")}.`
    );
  }
}

function mapStripeCheckoutObservation({ eventType, session } = {}) {
  const normalizedEventType = text(eventType).toLowerCase();
  if (!STRIPE_CHECKOUT_EVENT_TYPES.has(normalizedEventType)) {
    return { supported: false, eventType: normalizedEventType };
  }
  const paymentStatus = text(session?.payment_status).toLowerCase();
  const sessionStatus = text(session?.status).toLowerCase();
  if (normalizedEventType === "checkout.session.async_payment_succeeded") {
    assertStripeCheckoutEventEvidence({
      eventType: normalizedEventType,
      paymentStatus,
      sessionStatus,
      expectedSessionStatus: "complete",
      allowedPaymentStatuses: ["paid"]
    });
    return { supported: true, providerState: "paid", paymentStatus, sessionStatus };
  }
  if (normalizedEventType === "checkout.session.completed") {
    assertStripeCheckoutEventEvidence({
      eventType: normalizedEventType,
      paymentStatus,
      sessionStatus,
      expectedSessionStatus: "complete",
      allowedPaymentStatuses: ["paid", "unpaid"]
    });
    return {
      supported: true,
      providerState: paymentStatus === "paid" ? "paid" : "processing",
      paymentStatus,
      sessionStatus
    };
  }
  if (normalizedEventType === "checkout.session.async_payment_failed") {
    assertStripeCheckoutEventEvidence({
      eventType: normalizedEventType,
      paymentStatus,
      sessionStatus,
      expectedSessionStatus: "complete",
      allowedPaymentStatuses: ["unpaid"]
    });
    return { supported: true, providerState: "failed", paymentStatus, sessionStatus };
  }
  assertStripeCheckoutEventEvidence({
    eventType: normalizedEventType,
    paymentStatus,
    sessionStatus,
    expectedSessionStatus: "expired",
    allowedPaymentStatuses: ["unpaid"]
  });
  return { supported: true, providerState: "expired", paymentStatus, sessionStatus };
}

function mapStripeCheckoutReconciliation(session = {}) {
  const paymentStatus = text(session.payment_status).toLowerCase();
  const sessionStatus = text(session.status).toLowerCase();
  const paymentIntentStatus = text(session.payment_intent?.status).toLowerCase();
  if (paymentStatus === "paid") {
    return { actionable: true, providerState: "paid", reviewRequired: false };
  }
  if (sessionStatus === "expired") {
    return { actionable: true, providerState: "expired", reviewRequired: false };
  }
  if (sessionStatus === "open") {
    return { actionable: false, providerState: "open", reviewRequired: false };
  }
  if (sessionStatus === "complete") {
    if (paymentIntentStatus === "processing") {
      return { actionable: true, providerState: "processing", reviewRequired: false };
    }
    if (["canceled", "requires_payment_method"].includes(paymentIntentStatus)) {
      return { actionable: true, providerState: "failed", reviewRequired: false };
    }
  }
  return { actionable: false, providerState: "unknown", reviewRequired: true };
}

function normalizeCurrentPayment(payment = {}) {
  return {
    depositStatus: text(payment.depositStatus).toLowerCase() || "unpaid",
    depositLink: text(payment.depositLink),
    depositConfirmedAtISO: text(payment.depositConfirmedAtISO),
    stripeSessionId: text(payment.stripeSessionId),
    stripeCheckoutState: text(payment.stripeCheckoutState).toLowerCase()
  };
}

function planStripeCheckoutTransition({
  currentPayment,
  sessionId,
  providerState,
  confirmedAtISO = ""
} = {}) {
  const current = normalizeCurrentPayment(currentPayment);
  const normalizedSessionId = text(sessionId);
  const nextProviderState = text(providerState).toLowerCase();
  if (!normalizedSessionId || !new Set(["processing", "paid", "failed", "expired"]).has(nextProviderState)) {
    throw new StripeProviderStateError("A valid Stripe session observation is required.");
  }
  if (current.stripeSessionId !== normalizedSessionId) {
    return { apply: false, reason: "stale_session", current };
  }
  const settled = ["paid", "refunded"].includes(current.depositStatus)
    || Boolean(current.depositConfirmedAtISO);
  if (settled) {
    return {
      apply: false,
      reason: nextProviderState === "paid" ? "already_settled" : "settlement_is_monotonic",
      current
    };
  }
  if (
    ["failed", "expired"].includes(current.stripeCheckoutState)
    && nextProviderState !== "paid"
  ) {
    return { apply: false, reason: "terminal_provider_state", current };
  }

  let paymentPatch;
  if (nextProviderState === "paid") {
    const confirmed = text(confirmedAtISO);
    if (!confirmed) {
      throw new StripeProviderStateError("Paid settlement requires a server timestamp.");
    }
    paymentPatch = {
      depositStatus: "paid",
      depositLink: "",
      depositConfirmedAtISO: confirmed,
      stripeSessionId: normalizedSessionId,
      stripeCheckoutState: "paid"
    };
  } else if (nextProviderState === "processing") {
    paymentPatch = {
      depositStatus: "sent",
      depositLink: "",
      depositConfirmedAtISO: "",
      stripeSessionId: normalizedSessionId,
      stripeCheckoutState: "processing"
    };
  } else {
    paymentPatch = {
      depositStatus: "unpaid",
      depositLink: "",
      depositConfirmedAtISO: "",
      stripeSessionId: normalizedSessionId,
      stripeCheckoutState: nextProviderState
    };
  }
  const unchanged = Object.entries(paymentPatch).every(([key, value]) => (
    text(current[key]) === text(value)
  ));
  return unchanged
    ? { apply: false, reason: "already_applied", current, paymentPatch }
    : { apply: true, reason: "state_transition", current, paymentPatch };
}

module.exports = {
  STRIPE_CHECKOUT_EVENT_TYPES,
  StripeProviderStateError,
  assertStripeObjectMode,
  assertStripeSecretKeyMode,
  mapStripeCheckoutObservation,
  mapStripeCheckoutReconciliation,
  normalizeStripeMode,
  planStripeCheckoutTransition
};
