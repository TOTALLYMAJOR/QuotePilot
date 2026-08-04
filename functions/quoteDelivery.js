const { createHash } = require("node:crypto");

const QUOTE_DELIVERY_STATUSES = new Set(["draft", "sent", "viewed", "booked"]);
const QUOTE_DELIVERY_TERMINAL_DECISIONS = new Set(["accepted", "declined"]);
const QUOTE_DELIVERY_UNRESOLVED_STATES = new Set([
  "sending",
  "outcome_ambiguous",
  "outcome_unknown"
]);
const QUOTE_DELIVERY_RESOLUTIONS = new Set([
  "confirmed_not_sent",
  "provider_accepted"
]);
const DEFAULT_RETRY_WINDOW_MS = 23 * 60 * 60 * 1000;
const MAX_DELIVERY_AUDIT_ENTRIES = 20;

class QuoteDeliveryError extends Error {
  constructor(code, message) {
    super(message);
    this.name = "QuoteDeliveryError";
    this.code = code;
  }
}

function text(value, maxLength = 500) {
  return String(value ?? "").trim().slice(0, maxLength);
}

function normalizeEmail(value) {
  return text(value, 254).toLowerCase();
}

function normalizeISO(value) {
  const candidate = text(value, 64);
  if (!candidate) return "";
  const parsed = new Date(candidate);
  return Number.isNaN(parsed.getTime()) ? "" : parsed.toISOString();
}

function normalizeGeneration(value, fallback = 1) {
  const parsed = Number(value);
  if (!Number.isSafeInteger(parsed) || parsed < 1) return fallback;
  return Math.min(parsed, 1_000_000_000);
}

function normalizeProviderMessageId(value) {
  if (typeof value !== "string") return "";
  const normalized = value.trim();
  return /^[A-Za-z0-9][A-Za-z0-9._:@-]{0,499}$/.test(normalized)
    ? normalized
    : "";
}

function appendAuditEntry(entries, entry) {
  const existing = Array.isArray(entries)
    ? entries.slice(-(MAX_DELIVERY_AUDIT_ENTRIES - 1))
    : [];
  return [...existing, entry];
}

function normalizedVersionNumber(value) {
  const parsed = Number(value);
  if (!Number.isSafeInteger(parsed) || parsed < 1) return "";
  return `v${String(parsed).padStart(4, "0")}`;
}

function resolveQuoteDeliveryRevisionId(quote = {}, quoteId = "") {
  const explicit = text(quote.activeVersionId || quote.versionMeta?.versionId, 80);
  const numbered = normalizedVersionNumber(
    quote.latestVersionNumber || quote.versionMeta?.versionNumber
  );
  const legacyIdentity = [
    text(quoteId || quote.id, 80),
    text(quote.quoteNumber, 80),
    normalizeISO(quote.createdAtISO || quote.createdAt)
  ].filter(Boolean).join("|");
  const contentRevisionId = explicit
    || numbered
    || (legacyIdentity
      ? `legacy-${createHash("sha256").update(legacyIdentity).digest("hex").slice(0, 24)}`
      : "");
  if (!contentRevisionId) {
    throw new QuoteDeliveryError(
      "failed-precondition",
      "Quote revision identity is missing. Save the quote before sending it."
    );
  }
  const portalIdentity = normalizeISO(quote.portalIssuedAtISO)
    || text(quote.portalKey, 64);
  return portalIdentity
    ? `${contentRevisionId}@${portalIdentity}`
    : contentRevisionId;
}

function buildQuoteDeliveryIdempotencyKey({
  organizationId,
  quoteId,
  revisionId,
  generation = 1
}) {
  const scope = [
    text(organizationId, 160),
    text(quoteId, 160),
    text(revisionId, 160),
    `generation:${normalizeGeneration(generation)}`
  ];
  if (scope.some((value) => !value)) {
    throw new QuoteDeliveryError(
      "failed-precondition",
      "Quote delivery scope is incomplete."
    );
  }
  const digest = createHash("sha256").update(scope.join("|")).digest("hex");
  return `quote-delivery/${digest}`;
}

function isActiveDeliveryLease(delivery, nowISO) {
  if (text(delivery?.state, 32).toLowerCase() !== "sending") return false;
  const nowMs = Date.parse(normalizeISO(nowISO));
  const expiresAtMs = Date.parse(normalizeISO(delivery?.leaseExpiresAtISO));
  return Number.isFinite(nowMs)
    && Number.isFinite(expiresAtMs)
    && expiresAtMs > nowMs;
}

function assertQuoteDeliveryRevision(quote, expectedRevisionId, quoteId = "") {
  const revisionId = resolveQuoteDeliveryRevisionId(quote, quoteId);
  if (text(expectedRevisionId, 160) !== revisionId) {
    throw new QuoteDeliveryError(
      "aborted",
      "The quote changed before delivery. Reload the saved revision and try again."
    );
  }
  return revisionId;
}

function assertQuoteDeliveryPortalSnapshot({
  quote,
  quoteId,
  organizationId,
  portalSnapshot,
  nowISO,
  allowExpired = false
} = {}) {
  const portalKey = text(quote?.portalKey, 128);
  if (portalKey.length < 20) {
    throw new QuoteDeliveryError(
      "failed-precondition",
      "Quote portal identity is missing. Rotate the portal link before sending quote email."
    );
  }
  const portalExpiresAtISO = normalizeISO(
    quote?.portalExpiresAtISO || quote?.expiresAtISO
  );
  const portalIssuedAtISO = normalizeISO(quote?.portalIssuedAtISO);
  const portalExpiresAtMs = Date.parse(portalExpiresAtISO);
  const nowMs = Date.parse(normalizeISO(nowISO));
  if (!portalIssuedAtISO || !Number.isFinite(portalExpiresAtMs) || !Number.isFinite(nowMs)) {
    throw new QuoteDeliveryError(
      "failed-precondition",
      "Quote portal issuance or expiry is invalid. Rotate the portal link before sending quote email."
    );
  }
  if (!allowExpired && portalExpiresAtMs <= nowMs) {
    throw new QuoteDeliveryError(
      "failed-precondition",
      "Portal link expired. Rotate the portal link before sending quote email."
    );
  }
  const portal = portalSnapshot && typeof portalSnapshot === "object"
    ? portalSnapshot
    : null;
  if (
    !portal
    || text(portal.portalKey, 128) !== portalKey
    || text(portal.quoteId, 160) !== text(quoteId, 160)
    || text(portal.organizationId, 160) !== text(organizationId, 160)
    || normalizeISO(portal.portalIssuedAtISO) !== portalIssuedAtISO
    || normalizeISO(portal.portalExpiresAtISO) !== portalExpiresAtISO
  ) {
    throw new QuoteDeliveryError(
      "failed-precondition",
      "The canonical customer portal does not match this quote. Rotate the portal link before sending."
    );
  }
  return {
    portalKey,
    portalIssuedAtISO,
    portalExpiresAtISO
  };
}

function assertQuoteDeliveryPortalActivation({
  quote,
  quoteId,
  organizationId,
  portalSnapshot,
  nowISO,
  allowExpired = false
} = {}) {
  const portal = assertQuoteDeliveryPortalSnapshot({
    quote,
    quoteId,
    organizationId,
    portalSnapshot,
    nowISO,
    allowExpired
  });
  const revisionId = resolveQuoteDeliveryRevisionId(quote, quoteId);
  const portalIssuedAtISO = normalizeISO(quote?.portalIssuedAtISO);
  const delivery = quote?.workflow?.quoteDelivery && typeof quote.workflow.quoteDelivery === "object"
    ? quote.workflow.quoteDelivery
    : {};
  const evidence = portalSnapshot?.deliveryEvidence
    && typeof portalSnapshot.deliveryEvidence === "object"
    ? portalSnapshot.deliveryEvidence
    : {};
  const providerAcceptedAtISO = normalizeISO(delivery.providerAcceptedAtISO);
  if (
    !revisionId
    || !portalIssuedAtISO
    || text(portalSnapshot?.portalIssuedAtISO, 64) !== portalIssuedAtISO
    || text(portalSnapshot?.status, 32).toLowerCase() !== text(quote?.status, 32).toLowerCase()
    || text(delivery.state, 32).toLowerCase() !== "provider_accepted"
    || text(delivery.portalActivationState, 32).toLowerCase() !== "active"
    || text(delivery.revisionId, 160) !== revisionId
    || text(delivery.portalKey, 128) !== portal.portalKey
    || normalizeISO(delivery.portalIssuedAtISO) !== portalIssuedAtISO
    || !normalizeProviderMessageId(delivery.providerMessageId)
    || !providerAcceptedAtISO
    || text(evidence.revisionId, 160) !== revisionId
    || text(evidence.state, 32).toLowerCase() !== "provider_accepted"
    || text(evidence.portalActivationState, 32).toLowerCase() !== "active"
    || text(evidence.portalKey, 128) !== portal.portalKey
    || normalizeISO(evidence.portalIssuedAtISO) !== portalIssuedAtISO
    || normalizeISO(evidence.providerAcceptedAtISO) !== providerAcceptedAtISO
  ) {
    throw new QuoteDeliveryError(
      "failed-precondition",
      "The current customer portal is not activated by provider acceptance for this quote issuance."
    );
  }
  return {
    ...portal,
    revisionId,
    portalIssuedAtISO,
    providerAcceptedAtISO
  };
}

function buildManualReviewDelivery(existing, nowISO, error) {
  const manualReviewAtISO = normalizeISO(nowISO);
  return {
    ...existing,
    state: "outcome_unknown",
    leaseExpiresAtISO: "",
    manualReviewAtISO: normalizeISO(existing?.manualReviewAtISO) || manualReviewAtISO,
    lastAttemptOutcome: text(existing?.lastAttemptOutcome, 64) || "ambiguous",
    error: text(error, 500)
      || "Delivery outcome requires manual review before this quote can be changed or sent again."
  };
}

function claimQuoteDelivery({
  quote,
  quoteId,
  organizationId,
  expectedRevisionId,
  actorEmail,
  attemptId,
  attemptProvider = "",
  payloadSha256 = "",
  nowISO,
  leaseMs = 2 * 60 * 1000,
  retryWindowMs = DEFAULT_RETRY_WINDOW_MS
} = {}) {
  const revisionId = assertQuoteDeliveryRevision(quote, expectedRevisionId, quoteId);
  const existing = quote?.workflow?.quoteDelivery && typeof quote.workflow.quoteDelivery === "object"
    ? quote.workflow.quoteDelivery
    : {};
  const existingRevisionId = text(existing.revisionId, 160);
  const existingState = text(existing.state, 32).toLowerCase();
  const sameRevision = existingRevisionId === revisionId;
  const normalizedPayloadSha256 = text(payloadSha256, 64).toLowerCase();
  if (normalizedPayloadSha256 && !/^[a-f0-9]{64}$/.test(normalizedPayloadSha256)) {
    throw new QuoteDeliveryError("invalid-argument", "Quote delivery payload digest is invalid.");
  }
  if (sameRevision && existingState === "provider_accepted") {
    return {
      state: "provider_accepted",
      revisionId,
      delivery: { ...existing }
    };
  }
  if (
    sameRevision
    && text(existing.payloadSha256, 64)
    && text(existing.payloadSha256, 64) !== normalizedPayloadSha256
  ) {
    return {
      state: "manual_review",
      revisionId,
      delivery: buildManualReviewDelivery(
        existing,
        nowISO,
        "The authoritative delivery payload changed after dispatch began and requires manual review."
      )
    };
  }
  const status = text(quote?.status || "draft", 32).toLowerCase();
  const normalizedNowISO = normalizeISO(nowISO);
  const normalizedRetryWindowMs = Math.max(
    60 * 1000,
    Math.min(DEFAULT_RETRY_WINDOW_MS, Number(retryWindowMs) || 0)
  );
  const firstAttemptAtISO = sameRevision
    ? normalizeISO(existing.firstAttemptAtISO || existing.startedAtISO)
    : "";
  const firstAttemptAtMs = Date.parse(firstAttemptAtISO);
  const nowMs = Date.parse(normalizedNowISO);
  const retryWindowExpired = Number.isFinite(firstAttemptAtMs)
    && Number.isFinite(nowMs)
    && nowMs >= firstAttemptAtMs + normalizedRetryWindowMs;
  const unresolvedSameRevision = sameRevision
    && QUOTE_DELIVERY_UNRESOLVED_STATES.has(existingState);
  if (unresolvedSameRevision && existingState === "sending" && isActiveDeliveryLease(existing, nowISO)) {
    return {
      state: "in_progress",
      revisionId,
      delivery: { ...existing }
    };
  }
  if (
    unresolvedSameRevision
    && (
      existingState === "outcome_unknown"
      || retryWindowExpired
      || QUOTE_DELIVERY_TERMINAL_DECISIONS.has(status)
    )
  ) {
    return {
      state: "manual_review",
      revisionId,
      delivery: buildManualReviewDelivery(
        existing,
        nowISO,
        QUOTE_DELIVERY_TERMINAL_DECISIONS.has(status)
          ? "A terminal customer decision was recorded while delivery was unresolved. Reconcile the provider outcome manually."
          : "Delivery outcome requires manual review before this quote can be changed or sent again."
      )
    };
  }
  if (!QUOTE_DELIVERY_STATUSES.has(status)) {
    throw new QuoteDeliveryError(
      "failed-precondition",
      "Only draft, sent, viewed, or booked quotes can be delivered by quote email."
    );
  }
  if (status === "booked") {
    const contractNumber = text(quote?.booking?.contractNumber, 120);
    const contractConvertedAtISO = normalizeISO(quote?.booking?.contractConvertedAtISO);
    const depositStatus = text(quote?.payment?.depositStatus, 32).toLowerCase();
    const depositSessionId = text(quote?.payment?.stripeSessionId, 200);
    const depositConfirmedAtISO = normalizeISO(quote?.payment?.depositConfirmedAtISO);
    if (
      !contractNumber
      || !contractConvertedAtISO
      || depositStatus !== "paid"
      || !/^cs_[A-Za-z0-9_]+$/.test(depositSessionId)
      || !depositConfirmedAtISO
    ) {
      throw new QuoteDeliveryError(
        "failed-precondition",
        "Booked portal delivery requires an authoritative contract and provider-paid deposit."
      );
    }
  }

  const startedAtISO = normalizedNowISO;
  const actor = normalizeEmail(actorEmail);
  const normalizedAttemptId = text(attemptId, 160);
  if (!startedAtISO || !actor || !normalizedAttemptId) {
    throw new QuoteDeliveryError(
      "failed-precondition",
      "Quote delivery audit identity is incomplete."
    );
  }
  const normalizedLeaseMs = Math.max(1_000, Math.min(15 * 60 * 1000, Number(leaseMs) || 0));
  const startsNewGeneration = sameRevision
    && existingState === "failed"
    && retryWindowExpired;
  const previousGeneration = normalizeGeneration(existing.generation);
  if (startsNewGeneration && previousGeneration >= 1_000_000_000) {
    throw new QuoteDeliveryError(
      "failed-precondition",
      "Quote delivery generation limit reached. Create a new saved revision before dispatch."
    );
  }
  const attemptCount = sameRevision && !startsNewGeneration
    ? Math.max(0, Number(existing.attemptCount) || 0) + 1
    : 1;
  const generation = sameRevision
    ? previousGeneration + (startsNewGeneration ? 1 : 0)
    : 1;
  const idempotencyKey = sameRevision
    && !startsNewGeneration
    && text(existing.idempotencyKey, 256)
    ? text(existing.idempotencyKey, 256)
    : buildQuoteDeliveryIdempotencyKey({
      organizationId,
      quoteId,
      revisionId,
      generation
    });
  const delivery = {
    revisionId,
    state: "sending",
    generation,
    attemptId: normalizedAttemptId,
    attemptCount,
    idempotencyKey,
    payloadSha256: normalizedPayloadSha256,
    firstAttemptAtISO: startsNewGeneration ? startedAtISO : firstAttemptAtISO || startedAtISO,
    retryDeadlineAtISO: new Date(
      Date.parse(startsNewGeneration ? startedAtISO : firstAttemptAtISO || startedAtISO)
        + normalizedRetryWindowMs
    ).toISOString(),
    startedAtISO,
    leaseExpiresAtISO: new Date(Date.parse(startedAtISO) + normalizedLeaseMs).toISOString(),
    actorEmail: actor,
    attemptProvider: text(attemptProvider, 80).toLowerCase(),
    providerAcceptedAtISO: "",
    provider: "",
    providerMessageId: "",
    error: "",
    lastAttemptOutcome: "",
    outcomeReason: "",
    errorCode: "",
    providerHttpStatus: 0,
    attemptHistory: Array.isArray(existing.attemptHistory)
      ? existing.attemptHistory.slice(-MAX_DELIVERY_AUDIT_ENTRIES)
      : [],
    resolutionHistory: Array.isArray(existing.resolutionHistory)
      ? existing.resolutionHistory.slice(-MAX_DELIVERY_AUDIT_ENTRIES)
      : [],
    ...(existing.lastResolution && typeof existing.lastResolution === "object"
      ? { lastResolution: { ...existing.lastResolution } }
      : {}),
    observedProvider: startsNewGeneration
      ? ""
      : text(existing.observedProvider, 80).toLowerCase(),
    observedProviderMessageId: startsNewGeneration
      ? ""
      : normalizeProviderMessageId(existing.observedProviderMessageId),
    observedProviderAtISO: startsNewGeneration
      ? ""
      : normalizeISO(existing.observedProviderAtISO),
    portalActivationState: "",
    portalActivatedAtISO: "",
    portalKey: "",
    portalIssuedAtISO: ""
  };

  return {
    state: "acquired",
    revisionId,
    delivery
  };
}

function buildQuoteDeliverySuccess({
  delivery,
  email,
  nowISO,
  portalKey,
  portalIssuedAtISO
} = {}) {
  const completedAtISO = normalizeISO(nowISO);
  const provider = text(email?.provider, 80).toLowerCase();
  const providerMessageId = normalizeProviderMessageId(email?.messageId);
  const activationPortalKey = text(portalKey, 128);
  const activationPortalIssuedAtISO = normalizeISO(portalIssuedAtISO);
  if (
    text(delivery?.state, 32).toLowerCase() !== "sending"
    || !text(delivery?.revisionId, 160)
    || !text(delivery?.attemptId, 160)
    || !provider
    || !providerMessageId
    || activationPortalKey.length < 20
    || !activationPortalIssuedAtISO
    || !completedAtISO
  ) {
    throw new QuoteDeliveryError(
      "failed-precondition",
      "Quote delivery completion does not match an active dispatch."
    );
  }
  return {
    ...delivery,
    state: "provider_accepted",
    leaseExpiresAtISO: "",
    providerAcceptedAtISO: completedAtISO,
    provider,
    providerMessageId,
    observedProvider: provider,
    observedProviderMessageId: providerMessageId,
    observedProviderAtISO: completedAtISO,
    portalActivationState: "active",
    portalActivatedAtISO: completedAtISO,
    portalKey: activationPortalKey,
    portalIssuedAtISO: activationPortalIssuedAtISO,
    lastAttemptOutcome: "provider_accepted",
    outcomeReason: "provider_accepted",
    errorCode: "",
    providerHttpStatus: 0,
    error: "",
    attemptHistory: appendAuditEntry(delivery.attemptHistory, {
      attemptId: text(delivery.attemptId, 160),
      attemptCount: Math.max(1, Number(delivery.attemptCount) || 1),
      generation: normalizeGeneration(delivery.generation),
      outcome: "provider_accepted",
      completedAtISO,
      provider,
      providerMessageId
    })
  };
}

function classifyQuoteDeliveryAttemptError(error) {
  const explicitOutcome = text(error?.quoteDeliveryOutcome, 64).toLowerCase();
  const rawStatus = Number(error?.providerHttpStatus);
  const providerHttpStatus = Number.isInteger(rawStatus) && rawStatus >= 100 && rawStatus <= 599
    ? rawStatus
    : 0;
  const errorCode = text(error?.code, 80).toLowerCase();
  let outcome = "ambiguous";
  if (["ambiguous", "definite_failure", "manual_review"].includes(explicitOutcome)) {
    outcome = explicitOutcome;
  } else if (providerHttpStatus) {
    outcome = (
      [408, 409, 429].includes(providerHttpStatus)
      || providerHttpStatus >= 500
      || providerHttpStatus < 400
    )
      ? "ambiguous"
      : "definite_failure";
  } else if ([
    "failed-precondition",
    "invalid-argument",
    "permission-denied",
    "unauthenticated"
  ].includes(errorCode)) {
    outcome = "definite_failure";
  }
  const reason = text(error?.quoteDeliveryReason, 120).toLowerCase()
    || (providerHttpStatus ? `provider_http_${providerHttpStatus}` : "")
    || errorCode
    || "provider_transport_or_unknown";
  return {
    outcome,
    reason,
    errorCode,
    providerHttpStatus,
    message: text(error?.message || error, 500)
      || (["ambiguous", "manual_review"].includes(outcome)
        ? "Email provider outcome is ambiguous."
        : "Email provider rejected the quote delivery.")
  };
}

function buildQuoteDeliveryFailure({ delivery, error, nowISO } = {}) {
  const failedAtISO = normalizeISO(nowISO);
  if (
    text(delivery?.state, 32).toLowerCase() !== "sending"
    || !text(delivery?.revisionId, 160)
    || !text(delivery?.attemptId, 160)
    || !failedAtISO
  ) {
    throw new QuoteDeliveryError(
      "failed-precondition",
      "Quote delivery failure does not match an active dispatch."
    );
  }
  const classification = classifyQuoteDeliveryAttemptError(error);
  if (classification.outcome !== "definite_failure") {
    throw new QuoteDeliveryError(
      "failed-precondition",
      "Only a definite pre-dispatch or provider rejection can be recorded as failed."
    );
  }
  return {
    ...delivery,
    state: "failed",
    leaseExpiresAtISO: "",
    failedAtISO,
    lastAttemptOutcome: classification.outcome,
    outcomeReason: classification.reason,
    errorCode: classification.errorCode,
    providerHttpStatus: classification.providerHttpStatus,
    error: classification.message,
    attemptHistory: appendAuditEntry(delivery.attemptHistory, {
      attemptId: text(delivery.attemptId, 160),
      attemptCount: Math.max(1, Number(delivery.attemptCount) || 1),
      generation: normalizeGeneration(delivery.generation),
      outcome: classification.outcome,
      completedAtISO: failedAtISO,
      reason: classification.reason,
      errorCode: classification.errorCode,
      providerHttpStatus: classification.providerHttpStatus,
      error: classification.message
    })
  };
}

function buildQuoteDeliveryAmbiguousOutcome({
  delivery,
  error,
  nowISO,
  providerObservation = {}
} = {}) {
  const ambiguousAtISO = normalizeISO(nowISO);
  if (
    text(delivery?.state, 32).toLowerCase() !== "sending"
    || !text(delivery?.revisionId, 160)
    || !text(delivery?.attemptId, 160)
    || !ambiguousAtISO
  ) {
    throw new QuoteDeliveryError(
      "failed-precondition",
      "Quote delivery ambiguity does not match an active dispatch."
    );
  }
  const classification = classifyQuoteDeliveryAttemptError(error);
  const provider = text(providerObservation?.provider, 80).toLowerCase();
  const providerMessageId = normalizeProviderMessageId(providerObservation?.messageId);
  return {
    ...delivery,
    state: "outcome_ambiguous",
    leaseExpiresAtISO: "",
    ambiguousAtISO,
    lastAttemptOutcome: "ambiguous",
    outcomeReason: classification.reason,
    errorCode: classification.errorCode,
    providerHttpStatus: classification.providerHttpStatus,
    error: classification.message,
    observedProvider: provider || text(delivery.observedProvider, 80).toLowerCase(),
    observedProviderMessageId: providerMessageId
      || normalizeProviderMessageId(delivery.observedProviderMessageId),
    observedProviderAtISO: provider || providerMessageId
      ? ambiguousAtISO
      : normalizeISO(delivery.observedProviderAtISO),
    attemptHistory: appendAuditEntry(delivery.attemptHistory, {
      attemptId: text(delivery.attemptId, 160),
      attemptCount: Math.max(1, Number(delivery.attemptCount) || 1),
      generation: normalizeGeneration(delivery.generation),
      outcome: "ambiguous",
      completedAtISO: ambiguousAtISO,
      reason: classification.reason,
      errorCode: classification.errorCode,
      providerHttpStatus: classification.providerHttpStatus,
      error: classification.message,
      provider,
      providerMessageId
    })
  };
}

function buildQuoteDeliveryManualReviewOutcome({
  delivery,
  error,
  nowISO,
  providerObservation = {}
} = {}) {
  const manualReviewAtISO = normalizeISO(nowISO);
  const ambiguous = buildQuoteDeliveryAmbiguousOutcome({
    delivery,
    error,
    nowISO,
    providerObservation
  });
  const attemptHistory = Array.isArray(ambiguous.attemptHistory)
    ? [...ambiguous.attemptHistory]
    : [];
  if (attemptHistory.length) {
    attemptHistory[attemptHistory.length - 1] = {
      ...attemptHistory[attemptHistory.length - 1],
      outcome: "manual_review"
    };
  }
  return {
    ...ambiguous,
    state: "outcome_unknown",
    manualReviewAtISO,
    lastAttemptOutcome: "manual_review",
    attemptHistory
  };
}

function planQuoteDeliveryAttemptFailure({
  delivery,
  error,
  nowISO,
  providerObservation = {}
} = {}) {
  const classification = classifyQuoteDeliveryAttemptError(error);
  if (classification.outcome === "manual_review") {
    return {
      outcome: "manual_review",
      delivery: buildQuoteDeliveryManualReviewOutcome({
        delivery,
        error,
        nowISO,
        providerObservation
      })
    };
  }
  if (classification.outcome === "ambiguous") {
    return {
      outcome: "ambiguous",
      delivery: buildQuoteDeliveryAmbiguousOutcome({
        delivery,
        error,
        nowISO,
        providerObservation
      })
    };
  }
  return {
    outcome: "definite_failure",
    delivery: buildQuoteDeliveryFailure({ delivery, error, nowISO })
  };
}

function planQuoteDeliveryOutcomeResolution({
  quote,
  quoteId,
  organizationId,
  expectedRevisionId,
  resolution,
  note,
  providerMessageId,
  portalActivation = {},
  actorUid,
  actorEmail,
  nowISO
} = {}) {
  const revisionId = assertQuoteDeliveryRevision(quote, expectedRevisionId, quoteId);
  const normalizedResolution = text(resolution, 64).toLowerCase();
  const normalizedNote = text(note, 1_000);
  const normalizedProviderMessageId = normalizeProviderMessageId(providerMessageId);
  const resolvedAtISO = normalizeISO(nowISO);
  const resolverUid = text(actorUid, 160);
  const resolverEmail = normalizeEmail(actorEmail);
  if (!QUOTE_DELIVERY_RESOLUTIONS.has(normalizedResolution)) {
    throw new QuoteDeliveryError(
      "invalid-argument",
      "resolution must be confirmed_not_sent or provider_accepted."
    );
  }
  if (!normalizedNote) {
    throw new QuoteDeliveryError("invalid-argument", "A reconciliation note is required.");
  }
  if (!resolvedAtISO || !resolverUid || !resolverEmail) {
    throw new QuoteDeliveryError(
      "failed-precondition",
      "Quote delivery reconciliation audit identity is incomplete."
    );
  }
  const delivery = quote?.workflow?.quoteDelivery && typeof quote.workflow.quoteDelivery === "object"
    ? quote.workflow.quoteDelivery
    : {};
  const deliveryState = text(delivery.state, 32).toLowerCase();
  const observedProviderMessageId = normalizeProviderMessageId(
    delivery.observedProviderMessageId
  );
  if (text(delivery.revisionId, 160) !== revisionId) {
    throw new QuoteDeliveryError(
      "failed-precondition",
      "This saved quote revision has no matching unresolved delivery outcome."
    );
  }
  if (isActiveDeliveryLease(delivery, resolvedAtISO)) {
    throw new QuoteDeliveryError(
      "aborted",
      "Quote delivery is still in progress. Wait for its active lease before reconciling the outcome."
    );
  }
  if (
    normalizedResolution === "provider_accepted"
    && deliveryState === "provider_accepted"
  ) {
    if (!normalizedProviderMessageId) {
      throw new QuoteDeliveryError(
        "invalid-argument",
        "providerMessageId is required when the provider accepted delivery."
      );
    }
    if (normalizeProviderMessageId(delivery.providerMessageId) !== normalizedProviderMessageId) {
      throw new QuoteDeliveryError(
        "failed-precondition",
        "The provider message ID conflicts with the recorded delivery outcome."
      );
    }
    return {
      state: "provider_accepted",
      revisionId,
      delivery: { ...delivery },
      idempotent: true
    };
  }
  if (
    normalizedResolution === "confirmed_not_sent"
    && deliveryState === "reconciled_not_sent"
    && text(delivery.lastResolution?.resolution, 64) === "confirmed_not_sent"
  ) {
    return {
      state: "reconciled_not_sent",
      revisionId,
      delivery: { ...delivery },
      idempotent: true
    };
  }
  if (!QUOTE_DELIVERY_UNRESOLVED_STATES.has(deliveryState)) {
    throw new QuoteDeliveryError(
      "failed-precondition",
      "Only an unresolved quote delivery outcome can be reconciled."
    );
  }
  if (
    normalizedResolution === "confirmed_not_sent"
    && observedProviderMessageId
  ) {
    throw new QuoteDeliveryError(
      "failed-precondition",
      "The server already observed provider acceptance. Record that exact provider message ID instead of confirming no send."
    );
  }
  const resolutionAudit = {
    resolution: normalizedResolution,
    note: normalizedNote,
    resolvedAtISO,
    actorUid: resolverUid,
    actorEmail: resolverEmail,
    previousState: deliveryState,
    previousAttemptId: text(delivery.attemptId, 160),
    previousGeneration: normalizeGeneration(delivery.generation),
    previousIdempotencyKey: text(delivery.idempotencyKey, 256),
    providerMessageId: normalizedResolution === "provider_accepted"
      ? normalizedProviderMessageId
      : ""
  };
  const resolutionHistory = appendAuditEntry(delivery.resolutionHistory, resolutionAudit);

  if (normalizedResolution === "provider_accepted") {
    if (!normalizedProviderMessageId) {
      throw new QuoteDeliveryError(
        "invalid-argument",
        "providerMessageId is required when the provider accepted delivery."
      );
    }
    if (observedProviderMessageId && observedProviderMessageId !== normalizedProviderMessageId) {
      throw new QuoteDeliveryError(
        "failed-precondition",
        "The provider message ID conflicts with the provider response already observed by the server."
      );
    }
    const provider = text(
      delivery.observedProvider || delivery.attemptProvider || delivery.provider || "resend",
      80
    ).toLowerCase();
    const activationIsActive = portalActivation?.active === true;
    const activationPortalKey = text(
      portalActivation?.portalKey || quote?.portalKey,
      128
    );
    const activationPortalIssuedAtISO = normalizeISO(
      portalActivation?.portalIssuedAtISO || quote?.portalIssuedAtISO
    );
    if (
      activationIsActive
      && (
        activationPortalKey.length < 20
        || activationPortalKey !== text(quote?.portalKey, 128)
        || activationPortalIssuedAtISO !== normalizeISO(quote?.portalIssuedAtISO)
      )
    ) {
      throw new QuoteDeliveryError(
        "failed-precondition",
        "Portal activation evidence does not match the current quote issuance."
      );
    }
    return {
      state: "provider_accepted",
      revisionId,
      idempotent: false,
      delivery: {
        ...delivery,
        state: "provider_accepted",
        leaseExpiresAtISO: "",
        providerAcceptedAtISO: resolvedAtISO,
        provider,
        providerMessageId: normalizedProviderMessageId,
        observedProvider: provider,
        observedProviderMessageId: normalizedProviderMessageId,
        observedProviderAtISO: normalizeISO(delivery.observedProviderAtISO) || resolvedAtISO,
        portalActivationState: activationIsActive ? "active" : "requires_rotation",
        portalActivatedAtISO: activationIsActive ? resolvedAtISO : "",
        portalKey: activationPortalKey,
        portalIssuedAtISO: activationPortalIssuedAtISO,
        lastAttemptOutcome: "provider_accepted_reconciled",
        outcomeReason: "admin_provider_accepted_reconciliation",
        errorCode: "",
        providerHttpStatus: 0,
        error: "",
        lastResolution: resolutionAudit,
        resolutionHistory
      }
    };
  }

  const previousGeneration = normalizeGeneration(delivery.generation);
  if (previousGeneration >= 1_000_000_000) {
    throw new QuoteDeliveryError(
      "failed-precondition",
      "Quote delivery generation limit reached. Create a new saved revision before dispatch."
    );
  }
  const generation = previousGeneration + 1;
  return {
    state: "reconciled_not_sent",
    revisionId,
    idempotent: false,
    delivery: {
      revisionId,
      state: "reconciled_not_sent",
      generation,
      attemptId: "",
      attemptCount: 0,
      idempotencyKey: buildQuoteDeliveryIdempotencyKey({
        organizationId,
        quoteId,
        revisionId,
        generation
      }),
      payloadSha256: "",
      firstAttemptAtISO: "",
      retryDeadlineAtISO: "",
      startedAtISO: "",
      leaseExpiresAtISO: "",
      actorEmail: resolverEmail,
      attemptProvider: "",
      providerAcceptedAtISO: "",
      provider: "",
      providerMessageId: "",
      observedProvider: "",
      observedProviderMessageId: "",
      observedProviderAtISO: "",
      portalActivationState: "",
      portalActivatedAtISO: "",
      portalKey: "",
      portalIssuedAtISO: "",
      reconciledAtISO: resolvedAtISO,
      lastAttemptOutcome: "confirmed_not_sent",
      outcomeReason: "admin_confirmed_not_sent_reconciliation",
      errorCode: "",
      providerHttpStatus: 0,
      error: "",
      attemptHistory: Array.isArray(delivery.attemptHistory)
        ? delivery.attemptHistory.slice(-MAX_DELIVERY_AUDIT_ENTRIES)
        : [],
      lastResolution: resolutionAudit,
      resolutionHistory
    }
  };
}

function assertQuoteEditNotDispatching(quote, nowISO) {
  const delivery = quote?.workflow?.quoteDelivery;
  if (!delivery || typeof delivery !== "object") return true;
  const currentRevisionId = resolveQuoteDeliveryRevisionId(quote, quote?.id);
  const deliveryState = text(delivery.state, 32).toLowerCase();
  if (
    text(delivery.revisionId, 160) === currentRevisionId
    && ["sending", "outcome_ambiguous", "outcome_unknown"].includes(deliveryState)
  ) {
    throw new QuoteDeliveryError(
      "aborted",
      deliveryState === "outcome_unknown"
        ? "Quote delivery outcome requires manual review before this revision can be changed."
        : deliveryState === "outcome_ambiguous"
        ? "Quote delivery outcome is unresolved. Retry this exact saved revision or reconcile it before editing."
        : isActiveDeliveryLease(delivery, nowISO)
        ? "Quote delivery is in progress. Wait for it to finish before editing this revision."
        : "Quote delivery is unresolved. Retry this saved revision before editing it."
    );
  }
  return true;
}

function assertNoConflictingQuoteExecution(quote) {
  const approvalRequests = Array.isArray(quote?.workflow?.approvalRequests)
    ? quote.workflow.approvalRequests
    : [];
  const conflict = approvalRequests.find((request) => (
    text(request?.executionState, 32).toLowerCase() === "in_progress"
    && [
      "convert_to_contract",
      "delete_quote",
      "rotate_portal_link",
      "send_payment_request",
      "send_final_balance_request"
    ].includes(text(request?.action, 80))
  ));
  if (conflict) {
    throw new QuoteDeliveryError(
      "aborted",
      "A sensitive quote action is already in progress. Finish it before sending quote email."
    );
  }
  return true;
}

module.exports = {
  QuoteDeliveryError,
  assertNoConflictingQuoteExecution,
  assertQuoteDeliveryPortalActivation,
  assertQuoteDeliveryPortalSnapshot,
  assertQuoteDeliveryRevision,
  assertQuoteEditNotDispatching,
  buildQuoteDeliveryAmbiguousOutcome,
  buildQuoteDeliveryFailure,
  buildQuoteDeliveryIdempotencyKey,
  buildQuoteDeliveryManualReviewOutcome,
  buildQuoteDeliverySuccess,
  classifyQuoteDeliveryAttemptError,
  claimQuoteDelivery,
  isActiveDeliveryLease,
  normalizeProviderMessageId,
  planQuoteDeliveryAttemptFailure,
  planQuoteDeliveryOutcomeResolution,
  resolveQuoteDeliveryRevisionId
};
