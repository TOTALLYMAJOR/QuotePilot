"use strict";

const PAYMENT_DISPATCH_STATES = Object.freeze({
  SENDING: "sending",
  OUTCOME_AMBIGUOUS: "outcome_ambiguous",
  PROVIDER_ACCEPTED: "provider_accepted",
  DEFINITE_FAILURE: "definite_failure"
});

const RETRYABLE_HTTP_STATUSES = new Set([408, 409, 425, 429]);
const DEFINITE_LOCAL_ERROR_CODES = new Set([
  "already-exists",
  "failed-precondition",
  "invalid-argument",
  "not-found",
  "permission-denied",
  "unauthenticated"
]);

class PaymentDispatchStateError extends Error {
  constructor(code, message) {
    super(message);
    this.name = "PaymentDispatchStateError";
    this.code = code;
  }
}

function text(value, maxLength = 500) {
  return String(value ?? "").trim().slice(0, maxLength);
}

function normalizeISO(value) {
  const candidate = text(value, 64);
  if (!candidate) return "";
  const parsed = new Date(candidate);
  return Number.isNaN(parsed.getTime()) ? "" : parsed.toISOString();
}

function normalizeHttpStatus(value) {
  const status = Number(value);
  return Number.isInteger(status) && status >= 100 && status <= 599
    ? status
    : 0;
}

function normalizeProviderMessageId(value) {
  if (typeof value !== "string") return "";
  const candidate = value.trim();
  return /^[A-Za-z0-9][A-Za-z0-9._:@-]{0,499}$/.test(candidate)
    ? candidate
    : "";
}

function normalizeDispatchIdentity(input = {}) {
  const operationId = text(input.operationId, 160);
  const actorUid = text(input.actorUid, 160);
  const actionScopeDigest = text(input.actionScopeDigest, 64).toLowerCase();
  const idempotencyKey = text(input.idempotencyKey, 256);
  if (
    !/^[A-Za-z0-9_-]{1,160}$/.test(operationId)
    || !actorUid
    || !/^[a-f0-9]{64}$/.test(actionScopeDigest)
    || !idempotencyKey
  ) {
    throw new PaymentDispatchStateError(
      "failed-precondition",
      "Payment dispatch requires an exact operation, actor, approval scope, and provider idempotency key."
    );
  }
  return {
    operationId,
    actorUid,
    actionScopeDigest,
    idempotencyKey
  };
}

function normalizePaymentDispatch(input = {}) {
  const source = input && typeof input === "object" && !Array.isArray(input)
    ? input
    : {};
  const identity = normalizeDispatchIdentity(source);
  const state = text(source.state, 32).toLowerCase();
  if (!Object.values(PAYMENT_DISPATCH_STATES).includes(state)) {
    throw new PaymentDispatchStateError(
      "failed-precondition",
      "Payment dispatch state is invalid."
    );
  }
  const attemptCount = Number(source.attemptCount);
  const startedAtISO = normalizeISO(source.startedAtISO);
  const lastAttemptAtISO = normalizeISO(source.lastAttemptAtISO);
  if (
    !Number.isSafeInteger(attemptCount)
    || attemptCount < 1
    || !startedAtISO
    || !lastAttemptAtISO
  ) {
    throw new PaymentDispatchStateError(
      "failed-precondition",
      "Payment dispatch attempt audit is invalid."
    );
  }
  const normalized = {
    ...identity,
    state,
    attemptCount,
    startedAtISO,
    lastAttemptAtISO,
    lastOutcome: text(source.lastOutcome, 32).toLowerCase(),
    outcomeReason: text(source.outcomeReason, 160).toLowerCase(),
    lastError: text(source.lastError, 500),
    provider: text(source.provider, 64).toLowerCase(),
    providerMessageId: normalizeProviderMessageId(source.providerMessageId),
    providerAcceptedAtISO: normalizeISO(source.providerAcceptedAtISO),
    completedAtISO: normalizeISO(source.completedAtISO)
  };
  if (
    state === PAYMENT_DISPATCH_STATES.PROVIDER_ACCEPTED
    && (
      !normalized.provider
      || !normalized.providerMessageId
      || !normalized.providerAcceptedAtISO
    )
  ) {
    throw new PaymentDispatchStateError(
      "failed-precondition",
      "Provider-accepted payment dispatch evidence is incomplete."
    );
  }
  if (
    state === PAYMENT_DISPATCH_STATES.DEFINITE_FAILURE
    && !normalized.completedAtISO
  ) {
    throw new PaymentDispatchStateError(
      "failed-precondition",
      "Definite payment dispatch failure evidence is incomplete."
    );
  }
  return normalized;
}

function assertSameDispatchIdentity(dispatch, expected) {
  const current = normalizePaymentDispatch(dispatch);
  const identity = normalizeDispatchIdentity(expected);
  if (
    current.operationId !== identity.operationId
    || current.actorUid !== identity.actorUid
    || current.actionScopeDigest !== identity.actionScopeDigest
    || current.idempotencyKey !== identity.idempotencyKey
  ) {
    throw new PaymentDispatchStateError(
      "aborted",
      "Payment dispatch retry identity does not match the approved in-progress operation."
    );
  }
  return current;
}

function classifyPaymentDispatchError(error = {}) {
  const explicitOutcome = text(
    error?.paymentDispatchOutcome || error?.quoteDeliveryOutcome,
    32
  ).toLowerCase();
  const explicitReason = text(
    error?.paymentDispatchReason || error?.quoteDeliveryReason,
    160
  ).toLowerCase();
  const providerHttpStatus = normalizeHttpStatus(error?.providerHttpStatus);
  const code = text(error?.code, 64).toLowerCase();

  if (explicitOutcome === "definite_failure") {
    return {
      outcome: "definite_failure",
      reason: explicitReason || "provider_rejected",
      providerHttpStatus
    };
  }
  if (["ambiguous", "provider_accepted", "manual_review"].includes(explicitOutcome)) {
    return {
      outcome: "ambiguous",
      reason: explicitReason || "provider_outcome_ambiguous",
      providerHttpStatus
    };
  }
  if (explicitReason === "provider_2xx_missing_message_id") {
    return {
      outcome: "ambiguous",
      reason: explicitReason,
      providerHttpStatus
    };
  }
  if (
    (providerHttpStatus >= 200 && providerHttpStatus <= 299)
    || RETRYABLE_HTTP_STATUSES.has(providerHttpStatus)
    || providerHttpStatus >= 500
  ) {
    return {
      outcome: "ambiguous",
      reason: explicitReason || `provider_http_${providerHttpStatus}`,
      providerHttpStatus
    };
  }
  if (providerHttpStatus >= 400 && providerHttpStatus <= 499) {
    return {
      outcome: "definite_failure",
      reason: explicitReason || `provider_http_${providerHttpStatus}`,
      providerHttpStatus
    };
  }
  if (DEFINITE_LOCAL_ERROR_CODES.has(code)) {
    return {
      outcome: "definite_failure",
      reason: explicitReason || `local_${code}`,
      providerHttpStatus
    };
  }
  return {
    outcome: "ambiguous",
    reason: explicitReason || "provider_outcome_unknown",
    providerHttpStatus
  };
}

function beginPaymentDispatchAttempt({
  dispatch = null,
  operationId,
  actorUid,
  actionScopeDigest,
  idempotencyKey,
  nowISO
} = {}) {
  const identity = normalizeDispatchIdentity({
    operationId,
    actorUid,
    actionScopeDigest,
    idempotencyKey
  });
  const attemptedAtISO = normalizeISO(nowISO);
  if (!attemptedAtISO) {
    throw new PaymentDispatchStateError(
      "failed-precondition",
      "Payment dispatch requires a server timestamp."
    );
  }

  if (!dispatch) {
    return {
      ...identity,
      state: PAYMENT_DISPATCH_STATES.SENDING,
      attemptCount: 1,
      startedAtISO: attemptedAtISO,
      lastAttemptAtISO: attemptedAtISO,
      lastOutcome: "",
      outcomeReason: "",
      lastError: "",
      provider: "",
      providerMessageId: "",
      providerAcceptedAtISO: "",
      completedAtISO: ""
    };
  }

  const current = assertSameDispatchIdentity(dispatch, identity);
  if (current.state === PAYMENT_DISPATCH_STATES.PROVIDER_ACCEPTED) {
    throw new PaymentDispatchStateError(
      "failed-precondition",
      "The email provider already accepted this payment request; finish publication without sending again."
    );
  }
  if (current.state === PAYMENT_DISPATCH_STATES.DEFINITE_FAILURE) {
    throw new PaymentDispatchStateError(
      "failed-precondition",
      "A definite payment dispatch failure requires a new approval."
    );
  }
  return {
    ...current,
    state: PAYMENT_DISPATCH_STATES.SENDING,
    attemptCount: current.attemptCount + 1,
    lastAttemptAtISO: attemptedAtISO,
    lastOutcome: "",
    outcomeReason: "",
    lastError: "",
    completedAtISO: ""
  };
}

function planPaymentDispatchFailure({ dispatch, error, nowISO } = {}) {
  const current = normalizePaymentDispatch(dispatch);
  if (current.state !== PAYMENT_DISPATCH_STATES.SENDING) {
    throw new PaymentDispatchStateError(
      "failed-precondition",
      "Only an active payment email attempt can record a provider failure."
    );
  }
  const observedAtISO = normalizeISO(nowISO);
  if (!observedAtISO) {
    throw new PaymentDispatchStateError(
      "failed-precondition",
      "Payment dispatch outcome requires a server timestamp."
    );
  }
  const classification = classifyPaymentDispatchError(error);
  const ambiguous = classification.outcome === "ambiguous";
  return {
    outcome: classification.outcome,
    executionState: ambiguous ? "in_progress" : "failed",
    dispatch: {
      ...current,
      state: ambiguous
        ? PAYMENT_DISPATCH_STATES.OUTCOME_AMBIGUOUS
        : PAYMENT_DISPATCH_STATES.DEFINITE_FAILURE,
      lastOutcome: classification.outcome,
      outcomeReason: classification.reason,
      lastError: text(error?.message || error, 500),
      completedAtISO: ambiguous ? "" : observedAtISO
    },
    resumable: ambiguous,
    nextAction: ambiguous ? "retry_provider_with_same_key" : "new_approval_required",
    shouldNeutralizeCheckout: !ambiguous,
    shouldAdvanceCheckoutGeneration: !ambiguous,
    requiresNewApproval: !ambiguous
  };
}

function recordPaymentDispatchProviderAcceptance({
  dispatch,
  provider,
  providerMessageId,
  nowISO
} = {}) {
  const current = normalizePaymentDispatch(dispatch);
  if (current.state !== PAYMENT_DISPATCH_STATES.SENDING) {
    throw new PaymentDispatchStateError(
      "failed-precondition",
      "Provider acceptance must belong to an active payment email attempt."
    );
  }
  const acceptedAtISO = normalizeISO(nowISO);
  const normalizedProvider = text(provider, 64).toLowerCase();
  const normalizedMessageId = normalizeProviderMessageId(providerMessageId);
  if (!acceptedAtISO || !normalizedProvider || !normalizedMessageId) {
    throw new PaymentDispatchStateError(
      "failed-precondition",
      "Provider acceptance requires provider identity, message identity, and a server timestamp."
    );
  }
  return {
    executionState: "in_progress",
    dispatch: {
      ...current,
      state: PAYMENT_DISPATCH_STATES.PROVIDER_ACCEPTED,
      lastOutcome: "provider_accepted",
      outcomeReason: "provider_accepted",
      lastError: "",
      provider: normalizedProvider,
      providerMessageId: normalizedMessageId,
      providerAcceptedAtISO: acceptedAtISO,
      completedAtISO: ""
    },
    resumable: true,
    nextAction: "complete_publication",
    shouldNeutralizeCheckout: false,
    shouldAdvanceCheckoutGeneration: false,
    requiresNewApproval: false
  };
}

function planPaymentDispatchResume({
  executionState,
  dispatch,
  operationId,
  actorUid,
  actionScopeDigest,
  idempotencyKey
} = {}) {
  const current = assertSameDispatchIdentity(dispatch, {
    operationId,
    actorUid,
    actionScopeDigest,
    idempotencyKey
  });
  const normalizedExecutionState = text(executionState, 32).toLowerCase();
  if (normalizedExecutionState === "succeeded") {
    return {
      action: "replay_success",
      resumable: false,
      idempotencyKey: current.idempotencyKey
    };
  }
  if (
    normalizedExecutionState === "failed"
    || current.state === PAYMENT_DISPATCH_STATES.DEFINITE_FAILURE
  ) {
    return {
      action: "new_approval_required",
      resumable: false,
      idempotencyKey: current.idempotencyKey
    };
  }
  if (normalizedExecutionState !== "in_progress") {
    throw new PaymentDispatchStateError(
      "failed-precondition",
      "Payment dispatch execution state is not resumable."
    );
  }
  if (current.state === PAYMENT_DISPATCH_STATES.PROVIDER_ACCEPTED) {
    return {
      action: "complete_publication",
      resumable: true,
      idempotencyKey: current.idempotencyKey,
      provider: current.provider,
      providerMessageId: current.providerMessageId
    };
  }
  if (
    current.state === PAYMENT_DISPATCH_STATES.SENDING
    || current.state === PAYMENT_DISPATCH_STATES.OUTCOME_AMBIGUOUS
  ) {
    return {
      action: "retry_provider_with_same_key",
      resumable: true,
      idempotencyKey: current.idempotencyKey
    };
  }
  throw new PaymentDispatchStateError(
    "failed-precondition",
    "Payment dispatch state is not resumable."
  );
}

module.exports = {
  PAYMENT_DISPATCH_STATES,
  PaymentDispatchStateError,
  beginPaymentDispatchAttempt,
  classifyPaymentDispatchError,
  normalizePaymentDispatch,
  planPaymentDispatchFailure,
  planPaymentDispatchResume,
  recordPaymentDispatchProviderAcceptance
};
