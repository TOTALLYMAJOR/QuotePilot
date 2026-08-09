"use strict";

const { createHash } = require("node:crypto");

const REVENUE_AUTOPILOT_KINDS = Object.freeze([
  "quote_follow_up",
  "deposit_reminder",
  "final_balance_reminder",
  "post_event_review_request",
  "unread_customer_reply"
]);

const OUTBOUND_REVENUE_AUTOPILOT_KINDS = new Set([
  "quote_follow_up",
  "deposit_reminder",
  "final_balance_reminder",
  "post_event_review_request"
]);

const REVENUE_AUTOPILOT_JOB_STATES = Object.freeze({
  SCHEDULED: "scheduled",
  SENDING: "sending",
  RETRY_WAIT: "retry_wait",
  OUTCOME_AMBIGUOUS: "outcome_ambiguous",
  PROVIDER_ACCEPTED: "provider_accepted",
  DELIVERED: "delivered",
  BOUNCED: "bounced",
  COMPLAINED: "complained",
  STOPPED: "stopped",
  DEFINITE_FAILURE: "definite_failure"
});

const TERMINAL_JOB_STATES = new Set([
  REVENUE_AUTOPILOT_JOB_STATES.DELIVERED,
  REVENUE_AUTOPILOT_JOB_STATES.BOUNCED,
  REVENUE_AUTOPILOT_JOB_STATES.COMPLAINED,
  REVENUE_AUTOPILOT_JOB_STATES.STOPPED,
  REVENUE_AUTOPILOT_JOB_STATES.DEFINITE_FAILURE
]);

const RETRYABLE_HTTP_STATUSES = new Set([408, 409, 425, 429]);
const DEFINITE_LOCAL_ERROR_CODES = new Set([
  "already-exists",
  "failed-precondition",
  "invalid-argument",
  "not-found",
  "permission-denied",
  "unauthenticated"
]);

const DEFAULT_MAX_ATTEMPTS = 3;
const MAX_ATTEMPTS_LIMIT = 5;
const DEFAULT_RETRY_DELAYS_MS = Object.freeze([5 * 60 * 1000, 30 * 60 * 1000]);
const DEFAULT_LEASE_MS = 2 * 60 * 1000;
const MAX_PROVIDER_EVENT_IDS = 20;
const FINAL_BALANCE_REMINDER_DAYS = Object.freeze([14, 7, 3]);
const POST_EVENT_CLOSEOUT_REVIEW_ITEM_CODES = Object.freeze([
  "internal_closeout",
  "thank_you",
  "review_request",
  "operational_follow_up"
]);
const REVENUE_AUTOPILOT_ATTRIBUTION_WINDOW_DAYS = Object.freeze({
  quote_follow_up: 7,
  deposit_reminder: 7,
  final_balance_reminder: 7,
  post_event_review_request: 30
});
const DATE_ONLY_PATTERN = /^\d{4}-\d{2}-\d{2}$/;
const LOCAL_TIME_PATTERN = /^(?:[01]\d|2[0-3]):[0-5]\d$/;
const IDENTIFIER_PATTERN = /^[A-Za-z0-9][A-Za-z0-9_.:@-]{0,255}$/;

class RevenueAutopilotError extends Error {
  constructor(code, message) {
    super(message);
    this.name = "RevenueAutopilotError";
    this.code = code;
  }
}

function text(value, maxLength = 500) {
  return String(value ?? "").trim().slice(0, maxLength);
}

function record(value) {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}

function normalizeISO(value) {
  const candidate = text(value, 64);
  if (!candidate || !/^\d{4}-\d{2}-\d{2}T/.test(candidate)) return "";
  const parsed = new Date(candidate);
  return Number.isNaN(parsed.getTime()) ? "" : parsed.toISOString();
}

function normalizeDateOnly(value) {
  const candidate = text(value, 10);
  if (!DATE_ONLY_PATTERN.test(candidate)) return "";
  const parsed = new Date(`${candidate}T00:00:00.000Z`);
  return Number.isNaN(parsed.getTime()) || parsed.toISOString().slice(0, 10) !== candidate
    ? ""
    : candidate;
}

function normalizeTimeZone(value) {
  const candidate = text(value, 100);
  if (!candidate) return "";
  try {
    return new Intl.DateTimeFormat("en-US", { timeZone: candidate })
      .resolvedOptions()
      .timeZone;
  } catch {
    return "";
  }
}

function normalizeIdentifier(value, fieldName) {
  const candidate = text(value, 256);
  if (!IDENTIFIER_PATTERN.test(candidate) || /^[^@\s]+@[^@\s]+$/.test(candidate)) {
    throw new RevenueAutopilotError(
      "failed-precondition",
      `${fieldName} must be a stable non-email identifier.`
    );
  }
  return candidate;
}

function normalizeKind(value) {
  const kind = text(value, 64).toLowerCase();
  if (!REVENUE_AUTOPILOT_KINDS.includes(kind)) {
    throw new RevenueAutopilotError(
      "invalid-argument",
      "Revenue Autopilot kind is invalid."
    );
  }
  return kind;
}

function normalizeProviderMessageId(value) {
  const candidate = text(value, 500);
  return /^[A-Za-z0-9][A-Za-z0-9._:@-]{0,499}$/.test(candidate)
    ? candidate
    : "";
}

function requireISO(value, label) {
  const normalized = normalizeISO(value);
  if (!normalized) {
    throw new RevenueAutopilotError(
      "failed-precondition",
      `${label} requires a valid ISO timestamp.`
    );
  }
  return normalized;
}

function requireDateOnly(value, label) {
  const normalized = normalizeDateOnly(value);
  if (!normalized) {
    throw new RevenueAutopilotError(
      "failed-precondition",
      `${label} requires a valid YYYY-MM-DD date.`
    );
  }
  return normalized;
}

function requireTimeZone(value) {
  const normalized = normalizeTimeZone(value);
  if (!normalized) {
    throw new RevenueAutopilotError(
      "failed-precondition",
      "Revenue Autopilot requires an explicit valid tenant IANA time zone."
    );
  }
  return normalized;
}

function evaluateRevenueAutopilotQuoteActivity({
  quoteExists = true,
  quote,
  organizationId,
  nowISO,
  ignorePortalExpiry = false
} = {}) {
  const scopedOrganizationId = normalizeIdentifier(
    organizationId,
    "Organization identity"
  );
  const observedAtISO = requireISO(nowISO, "Revenue Autopilot quote activity time");
  if (quoteExists !== true || !record(quote)) {
    return Object.freeze({ active: false, reason: "quote_missing", observedAtISO });
  }
  if (text(quote.organizationId, 256) !== scopedOrganizationId) {
    return Object.freeze({ active: false, reason: "quote_scope_changed", observedAtISO });
  }
  if (text(quote.deletedAtISO, 64)) {
    return Object.freeze({ active: false, reason: "quote_deleted", observedAtISO });
  }
  const rawExpiry = ignorePortalExpiry === true
    ? ""
    : text(quote.portalExpiresAtISO || quote.expiresAtISO, 64);
  if (rawExpiry) {
    const expiresAtISO = normalizeISO(rawExpiry);
    if (!expiresAtISO) {
      return Object.freeze({
        active: false,
        reason: "portal_expiry_invalid",
        observedAtISO
      });
    }
    if (expiresAtISO <= observedAtISO) {
      return Object.freeze({
        active: false,
        reason: "portal_expired",
        expiresAtISO,
        observedAtISO
      });
    }
  }
  return Object.freeze({ active: true, reason: "active", observedAtISO });
}

function calendarPartsAt(instant, timeZone) {
  const parts = new Intl.DateTimeFormat("en-CA", {
    calendar: "gregory",
    numberingSystem: "latn",
    timeZone,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
    hourCycle: "h23"
  }).formatToParts(instant);
  return Object.fromEntries(parts.map((part) => [part.type, part.value]));
}

function tenantCalendarContext({ nowISO, timeZone } = {}) {
  const normalizedNowISO = requireISO(nowISO, "Tenant calendar context");
  const normalizedTimeZone = requireTimeZone(timeZone);
  const parts = calendarPartsAt(new Date(normalizedNowISO), normalizedTimeZone);
  const date = `${parts.year}-${parts.month}-${parts.day}`;
  const localTime = `${parts.hour}:${parts.minute}`;
  if (!normalizeDateOnly(date) || !LOCAL_TIME_PATTERN.test(localTime)) {
    throw new RevenueAutopilotError(
      "failed-precondition",
      "Tenant calendar context could not be resolved."
    );
  }
  return Object.freeze({
    nowISO: normalizedNowISO,
    timeZone: normalizedTimeZone,
    date,
    localTime,
    minuteOfDay: (Number(parts.hour) * 60) + Number(parts.minute)
  });
}

function timeToMinute(value) {
  const candidate = text(value, 5);
  if (!LOCAL_TIME_PATTERN.test(candidate)) return null;
  const [hour, minute] = candidate.split(":").map(Number);
  return (hour * 60) + minute;
}

function evaluateQuietHours({ nowISO, timeZone, quietHours } = {}) {
  const calendar = tenantCalendarContext({ nowISO, timeZone });
  if (!record(quietHours)) {
    return {
      state: "blocked",
      insideQuietHours: false,
      reason: "quiet_hours_policy_missing",
      calendar
    };
  }
  if (quietHours.enabled === false) {
    return {
      state: "clear",
      insideQuietHours: false,
      reason: "quiet_hours_disabled",
      calendar
    };
  }
  if (quietHours.enabled !== true) {
    return {
      state: "blocked",
      insideQuietHours: false,
      reason: "quiet_hours_policy_ambiguous",
      calendar
    };
  }
  const startMinute = timeToMinute(quietHours.start);
  const endMinute = timeToMinute(quietHours.end);
  if (startMinute === null || endMinute === null || startMinute === endMinute) {
    return {
      state: "blocked",
      insideQuietHours: false,
      reason: "quiet_hours_policy_invalid",
      calendar
    };
  }
  const insideQuietHours = startMinute < endMinute
    ? calendar.minuteOfDay >= startMinute && calendar.minuteOfDay < endMinute
    : calendar.minuteOfDay >= startMinute || calendar.minuteOfDay < endMinute;
  return {
    state: insideQuietHours ? "deferred" : "clear",
    insideQuietHours,
    reason: insideQuietHours ? "inside_quiet_hours" : "outside_quiet_hours",
    window: {
      start: text(quietHours.start, 5),
      end: text(quietHours.end, 5),
      wrapsMidnight: startMinute > endMinute
    },
    calendar
  };
}

function dateSerial(value) {
  const date = requireDateOnly(value, "Calendar arithmetic");
  return Date.parse(`${date}T00:00:00.000Z`) / 86400000;
}

function addCalendarDays(value, days) {
  const count = Number(days);
  if (!Number.isSafeInteger(count) || Math.abs(count) > 3660) {
    throw new RevenueAutopilotError(
      "invalid-argument",
      "Revenue Autopilot calendar offset is invalid."
    );
  }
  return new Date((dateSerial(value) + count) * 86400000).toISOString().slice(0, 10);
}

function normalizeOffsets(values, { defaults = [] } = {}) {
  const source = Array.isArray(values) ? values : defaults;
  const offsets = [...new Set(source.map(Number))]
    .filter((value) => Number.isSafeInteger(value) && value >= 0 && value <= 365)
    .sort((left, right) => left - right);
  if (!offsets.length || offsets.length > 12) {
    throw new RevenueAutopilotError(
      "failed-precondition",
      "Revenue Autopilot requires one to twelve bounded day offsets."
    );
  }
  return offsets;
}

function buildRevenueAutopilotOccurrences({
  kind,
  timeZone,
  anchorAtISO = "",
  eventDate = "",
  dueDate = "",
  closeoutId = "",
  messageId = "",
  dayOffsets
} = {}) {
  const normalizedKind = normalizeKind(kind);
  const normalizedTimeZone = requireTimeZone(timeZone);
  if (normalizedKind === "unread_customer_reply") {
    const normalizedMessageId = normalizeIdentifier(messageId, "Conversation message identity");
    const anchorISO = requireISO(anchorAtISO, "Unread-reply occurrence");
    const dueTenantDate = tenantCalendarContext({
      nowISO: anchorISO,
      timeZone: normalizedTimeZone
    }).date;
    return [{
      occurrenceKey: `message_${normalizedMessageId}`,
      dueTenantDate,
      anchorAtISO: anchorISO
    }];
  }
  if (normalizedKind === "final_balance_reminder") {
    const normalizedEventDate = requireDateOnly(eventDate, "Final-balance occurrence");
    const offsets = normalizeOffsets(dayOffsets, {
      defaults: FINAL_BALANCE_REMINDER_DAYS
    }).sort((left, right) => right - left);
    return offsets.map((days) => ({
      occurrenceKey: `event_minus_${days}`,
      dueTenantDate: addCalendarDays(normalizedEventDate, -days),
      eventDate: normalizedEventDate,
      dayOffset: days
    }));
  }
  if (normalizedKind === "post_event_review_request") {
    const normalizedCloseoutId = normalizeIdentifier(
      closeoutId,
      "Post-event closeout identity"
    );
    const recordedDueDate = requireDateOnly(dueDate, "Post-event review occurrence");
    const completedTenantDate = normalizeISO(anchorAtISO)
      ? tenantCalendarContext({
          nowISO: requireISO(anchorAtISO, "Post-event closeout completion"),
          timeZone: normalizedTimeZone
        }).date
      : "";
    return [{
      occurrenceKey: `closeout_${normalizedCloseoutId}`,
      dueTenantDate: completedTenantDate > recordedDueDate
        ? completedTenantDate
        : recordedDueDate,
      recordedDueTenantDate: recordedDueDate,
      completedTenantDate,
      closeoutId: normalizedCloseoutId
    }];
  }
  const anchorISO = requireISO(anchorAtISO, "Revenue Autopilot occurrence");
  const anchorTenantDate = tenantCalendarContext({
    nowISO: anchorISO,
    timeZone: normalizedTimeZone
  }).date;
  const offsets = normalizeOffsets(dayOffsets);
  return offsets.map((days) => ({
    occurrenceKey: `anchor_plus_${days}`,
    dueTenantDate: addCalendarDays(anchorTenantDate, days),
    anchorAtISO: anchorISO,
    anchorTenantDate,
    dayOffset: days
  }));
}

function normalizeIdentitySegment(value, fieldName) {
  const candidate = text(value, 256);
  if (!candidate || candidate.includes("|")) {
    throw new RevenueAutopilotError(
      "failed-precondition",
      `${fieldName} is invalid for Revenue Autopilot identity.`
    );
  }
  return candidate;
}

function buildRevenueAutopilotJobIdentity({
  organizationId,
  quoteId,
  kind,
  scopeKey,
  occurrenceKey
} = {}) {
  const normalized = {
    organizationId: normalizeIdentifier(organizationId, "Organization identity"),
    quoteId: normalizeIdentifier(quoteId, "Quote identity"),
    kind: normalizeKind(kind),
    scopeKey: normalizeIdentitySegment(scopeKey, "Authoritative scope identity"),
    occurrenceKey: normalizeIdentitySegment(occurrenceKey, "Occurrence identity")
  };
  const digest = createHash("sha256")
    .update([
      "revenue-autopilot-v1",
      normalized.organizationId,
      normalized.quoteId,
      normalized.kind,
      normalized.scopeKey,
      normalized.occurrenceKey
    ].join("|"))
    .digest("hex");
  return Object.freeze({
    ...normalized,
    jobId: `ra_${digest}`,
    idempotencyKey: `revenue-autopilot/${digest}`
  });
}

function buildRevenueAutopilotScopeKey({
  kind,
  revisionId = "",
  paymentOperationId = "",
  closeoutId = "",
  messageId = ""
} = {}) {
  const normalizedKind = normalizeKind(kind);
  if (normalizedKind === "unread_customer_reply") {
    return normalizeIdentitySegment(messageId, "Conversation message scope");
  }
  const normalizedRevisionId = normalizeIdentitySegment(
    revisionId,
    "Proposal revision scope"
  );
  if (normalizedKind === "final_balance_reminder") {
    const normalizedPaymentOperationId = normalizeIdentitySegment(
      paymentOperationId,
      "Final-balance operation scope"
    );
    return `revision:${normalizedRevisionId};payment:${normalizedPaymentOperationId}`;
  }
  if (normalizedKind === "post_event_review_request") {
    const normalizedCloseoutId = normalizeIdentifier(
      closeoutId,
      "Post-event closeout scope"
    );
    return `revision:${normalizedRevisionId};closeout:${normalizedCloseoutId}`;
  }
  return normalizedRevisionId;
}

function gateReason(code, message, category = "control") {
  return { code, message, category };
}

function validControlEvidence(control, timestampFields) {
  if (!record(control) || !text(control.evidenceId, 256)) return false;
  return timestampFields.some((field) => Boolean(normalizeISO(control[field])));
}

function evaluateRevenueAutopilotGates({
  global = {},
  tenantPolicy = {},
  kind,
  nowISO,
  controls = {},
  channel = ""
} = {}) {
  const normalizedKind = normalizeKind(kind);
  const resolvedChannel = text(channel, 32).toLowerCase()
    || (OUTBOUND_REVENUE_AUTOPILOT_KINDS.has(normalizedKind) ? "email" : "attention");
  if (!new Set(["email", "attention"]).has(resolvedChannel)) {
    throw new RevenueAutopilotError("invalid-argument", "Revenue Autopilot channel is invalid.");
  }
  const reasons = [];
  const stopped = [];
  const deferred = [];

  if (global.enabled !== true) {
    reasons.push(gateReason(
      "global_automation_disabled",
      "Revenue Autopilot is disabled by the global runtime gate."
    ));
  }
  if (tenantPolicy.enabled !== true) {
    reasons.push(gateReason(
      "tenant_automation_disabled",
      "Revenue Autopilot is not enabled for this tenant."
    ));
  }
  const kindPolicy = record(tenantPolicy.kinds) && record(tenantPolicy.kinds[normalizedKind])
    ? tenantPolicy.kinds[normalizedKind]
    : null;
  if (!kindPolicy || kindPolicy.enabled !== true) {
    reasons.push(gateReason(
      "automation_kind_disabled",
      "This Revenue Autopilot action is not enabled for the tenant."
    ));
  }

  const timeZone = normalizeTimeZone(tenantPolicy.timeZone);
  let calendar = null;
  if (!timeZone) {
    reasons.push(gateReason(
      "tenant_timezone_missing",
      "An explicit valid tenant IANA time zone is required."
    ));
  } else {
    try {
      calendar = tenantCalendarContext({ nowISO, timeZone });
    } catch {
      reasons.push(gateReason(
        "server_time_invalid",
        "A valid server evaluation timestamp is required."
      ));
    }
  }

  if (resolvedChannel === "email") {
    if (global.sendsEnabled !== true) {
      reasons.push(gateReason(
        "global_sends_disabled",
        "Automated email sends are disabled by the global runtime gate."
      ));
    }

    const consent = controls.consent;
    if (!validControlEvidence(consent, ["recordedAtISO"])) {
      reasons.push(gateReason(
        "consent_evidence_missing",
        "Recorded email-consent evidence is required."
      ));
    } else if (text(consent.channel, 32).toLowerCase() !== "email") {
      reasons.push(gateReason("consent_channel_mismatch", "Consent is not scoped to email."));
    } else if (["denied", "revoked"].includes(text(consent.state, 32).toLowerCase())) {
      stopped.push(gateReason(
        "consent_not_granted",
        "Automated email is stopped because consent is denied or revoked.",
        "stop"
      ));
    } else if (text(consent.state, 32).toLowerCase() !== "granted") {
      reasons.push(gateReason("consent_evidence_ambiguous", "Email consent is not unambiguous."));
    } else if (normalizeISO(consent.recordedAtISO) > calendar?.nowISO) {
      reasons.push(gateReason("consent_evidence_future", "Email consent evidence is future-dated."));
    }

    const subscription = controls.subscription || controls.unsubscribe;
    if (!validControlEvidence(subscription, ["evaluatedAtISO", "recordedAtISO", "updatedAtISO"])) {
      reasons.push(gateReason(
        "subscription_evidence_missing",
        "Current email subscription evidence is required."
      ));
    } else {
      const subscriptionState = text(subscription.state, 32).toLowerCase();
      if (["unsubscribed", "opted_out"].includes(subscriptionState)) {
        stopped.push(gateReason(
          "recipient_unsubscribed",
          "Automated email is stopped because the recipient unsubscribed.",
          "stop"
        ));
      } else if (subscriptionState !== "subscribed") {
        reasons.push(gateReason(
          "subscription_evidence_ambiguous",
          "Email subscription state is not unambiguous."
        ));
      }
    }

    const suppression = controls.suppression;
    if (!validControlEvidence(suppression, ["evaluatedAtISO", "recordedAtISO", "updatedAtISO"])) {
      reasons.push(gateReason(
        "suppression_evidence_missing",
        "Current email suppression evidence is required."
      ));
    } else {
      const suppressionState = text(suppression.state, 32).toLowerCase();
      if (suppressionState === "suppressed") {
        stopped.push(gateReason(
          "recipient_suppressed",
          "Automated email is stopped because the recipient is suppressed.",
          "stop"
        ));
      } else if (suppressionState !== "clear") {
        reasons.push(gateReason(
          "suppression_evidence_ambiguous",
          "Email suppression state is not unambiguous."
        ));
      }
    }

    const provider = controls.provider;
    if (
      !validControlEvidence(provider, ["evaluatedAtISO", "updatedAtISO"])
      || !text(provider.providerId, 64)
      || text(provider.providerId, 64).toLowerCase() === "none"
      || !text(provider.configurationId, 160)
    ) {
      reasons.push(gateReason(
        "provider_configuration_missing",
        "Current email-provider configuration evidence is required."
      ));
    } else if (text(provider.state, 32).toLowerCase() !== "configured") {
      reasons.push(gateReason(
        "provider_not_configured",
        "The email provider is not configured."
      ));
    }

    if (timeZone && calendar) {
      const quiet = evaluateQuietHours({
        nowISO: calendar.nowISO,
        timeZone,
        quietHours: tenantPolicy.quietHours
      });
      if (quiet.state === "blocked") {
        reasons.push(gateReason(quiet.reason, "Tenant quiet-hours policy is unavailable or invalid."));
      } else if (quiet.state === "deferred") {
        deferred.push(gateReason(
          "inside_quiet_hours",
          "Automated email is deferred until tenant quiet hours end.",
          "timing"
        ));
      }
    }
  }

  let state = "clear";
  if (stopped.length) state = "stopped";
  else if (reasons.length) state = "blocked";
  else if (deferred.length) state = "deferred";
  return Object.freeze({
    state,
    eligible: state === "clear",
    channel: resolvedChannel,
    kind: normalizedKind,
    calendar,
    reasons: Object.freeze([...stopped, ...reasons, ...deferred])
  });
}

function evidenceReason(code, message, category = "evidence") {
  return { code, message, category };
}

function scopeMatches(evidence, scope) {
  return record(evidence)
    && text(evidence.organizationId, 256) === scope.organizationId
    && text(evidence.quoteId, 256) === scope.quoteId;
}

function exactPortalEvidence(scope, evidence) {
  const portal = evidence.portal;
  if (
    !scopeMatches(portal, scope)
    || text(portal?.source, 64).toLowerCase() !== "customer_portal_projection"
    || text(portal?.revisionId, 256) !== scope.revisionId
    || !normalizeISO(portal?.stateAtISO)
  ) {
    return {
      error: evidenceReason(
        "portal_evidence_missing",
        "Exact current-revision customer-portal evidence is required."
      )
    };
  }
  const state = text(portal.state, 32).toLowerCase();
  if (!new Set(["sent", "viewed", "accepted", "booked", "declined"]).has(state)) {
    return {
      error: evidenceReason("portal_evidence_invalid", "Customer-portal state is invalid.")
    };
  }
  return { state, record: portal };
}

function exactAcceptanceEvidence(scope, evidence, portal) {
  const acceptance = evidence.acceptance;
  const acceptedAtISO = normalizeISO(acceptance?.acceptedAtISO);
  const portalAcceptedAtISO = text(portal?.state, 32).toLowerCase() === "accepted"
    ? normalizeISO(portal?.stateAtISO)
    : normalizeISO(portal?.acceptedAtISO);
  if (
    !scopeMatches(acceptance, scope)
    || text(acceptance?.source, 64).toLowerCase() !== "proposal_acceptance_receipt"
    || text(acceptance?.revisionId, 256) !== scope.revisionId
    || !text(acceptance?.receiptId, 256)
    || !acceptedAtISO
    || !portalAcceptedAtISO
    || acceptedAtISO !== portalAcceptedAtISO
  ) {
    return {
      error: evidenceReason(
        "acceptance_evidence_missing",
        "An exact accepted-revision receipt is required."
      )
    };
  }
  return { record: acceptance };
}

function exactDepositEvidence(scope, evidence) {
  const deposit = evidence.deposit;
  if (
    !scopeMatches(deposit, scope)
    || text(deposit?.source, 64).toLowerCase() !== "verified_provider_webhooks"
    || deposit?.bounded !== true
    || !normalizeISO(deposit?.observedAtISO)
  ) {
    return {
      error: evidenceReason(
        "deposit_evidence_missing",
        "A bounded verified-provider-webhook deposit snapshot is required."
      )
    };
  }
  const state = text(deposit.state, 32).toLowerCase();
  if (!new Set(["unpaid", "paid", "refunded"]).has(state)) {
    return { error: evidenceReason("deposit_evidence_invalid", "Deposit state is invalid.") };
  }
  if (state !== "unpaid" && (
    deposit.signatureVerified !== true
    || text(deposit.processingState, 32).toLowerCase() !== "processed"
    || !text(deposit.providerReference, 256)
    || !normalizeISO(deposit.processedAtISO)
  )) {
    return {
      error: evidenceReason(
        "deposit_settlement_unverified",
        "Paid or refunded deposit state requires exact verified-webhook evidence."
      )
    };
  }
  return { state, record: deposit };
}

function exactFinalBalanceEvidence(scope, evidence) {
  const finalBalance = evidence.finalBalance;
  if (
    !scopeMatches(finalBalance, scope)
    || text(finalBalance?.source, 64).toLowerCase() !== "canonical_payment_ledger"
    || text(finalBalance?.operationId, 256) !== scope.paymentOperationId
    || !normalizeISO(finalBalance?.observedAtISO)
  ) {
    return {
      error: evidenceReason(
        "final_balance_evidence_missing",
        "An exact canonical final-balance ledger observation is required."
      )
    };
  }
  const state = text(finalBalance.state, 32).toLowerCase();
  if (!new Set(["unpaid", "sent", "processing", "paid", "refunded"]).has(state)) {
    return {
      error: evidenceReason("final_balance_evidence_invalid", "Final-balance state is invalid.")
    };
  }
  if (["paid", "refunded"].includes(state) && (
    !text(finalBalance.providerReference, 256)
    || !normalizeISO(finalBalance.providerSettledAtISO)
  )) {
    return {
      error: evidenceReason(
        "final_balance_settlement_unverified",
        "Settled final-balance state requires exact provider evidence."
      )
    };
  }
  return { state, record: finalBalance };
}

function exactPostEventCloseoutEvidence(scope, evidence) {
  const closeout = evidence.postEventCloseout;
  const state = text(closeout?.state, 32).toLowerCase();
  const completedAtISO = normalizeISO(closeout?.completedAtISO);
  const dueDate = normalizeDateOnly(closeout?.dueDate);
  const reviewItems = record(closeout?.reviewItems) ? closeout.reviewItems : {};
  if (
    !scopeMatches(closeout, scope)
    || Number(closeout?.schemaVersion) !== 1
    || text(closeout?.source, 64).toLowerCase() !== "post_event_closeout_authority"
    || text(closeout?.closeoutId, 256) !== scope.closeoutId
    || text(closeout?.revisionId, 256) !== scope.revisionId
    || !text(closeout?.sourceVersionId, 256)
    || !text(closeout?.acceptanceReceiptId, 256)
    || !normalizeDateOnly(closeout?.eventDate)
    || !dueDate
    || !normalizeISO(closeout?.updatedAtISO)
  ) {
    return {
      error: evidenceReason(
        "post_event_closeout_evidence_missing",
        "Exact server-owned post-event closeout evidence is required."
      )
    };
  }
  if (!new Set(["blocked_configuration", "pending", "completed"]).has(state)) {
    return {
      error: evidenceReason(
        "post_event_closeout_state_invalid",
        "Post-event closeout state is invalid."
      )
    };
  }
  const itemEvidence = POST_EVENT_CLOSEOUT_REVIEW_ITEM_CODES.map((code) => {
    const item = record(reviewItems[code]) ? reviewItems[code] : {};
    return {
      code,
      state: text(item.state, 32).toLowerCase(),
      reviewedAtISO: normalizeISO(item.reviewedAtISO)
    };
  });
  if (itemEvidence.some((item) => (
    !new Set(["pending", "reviewed"]).has(item.state)
    || (item.state === "reviewed" && !item.reviewedAtISO)
    || (item.state === "pending" && text(reviewItems[item.code]?.reviewedAtISO, 64))
  ))) {
    return {
      error: evidenceReason(
        "post_event_closeout_review_evidence_invalid",
        "Post-event closeout review evidence is incomplete or contradictory."
      )
    };
  }
  const allReviewed = itemEvidence.every((item) => item.state === "reviewed");
  if (state === "completed") {
    const latestReviewedAtISO = itemEvidence
      .map((item) => item.reviewedAtISO)
      .sort()
      .at(-1) || "";
    if (!allReviewed || !completedAtISO || completedAtISO < latestReviewedAtISO) {
      return {
        error: evidenceReason(
          "post_event_closeout_completion_invalid",
          "Completed post-event closeout evidence must cover every review item."
        )
      };
    }
    return {
      state,
      record: closeout,
      dueDate
    };
  }
  if (allReviewed || completedAtISO || text(closeout?.completedBy, 256)) {
    return {
      error: evidenceReason(
        "post_event_closeout_reopen_evidence_invalid",
        "An incomplete post-event closeout cannot retain completed evidence."
      )
    };
  }
  return {
    state,
    record: closeout,
    dueDate
  };
}

function normalizeStopScope(scope = {}, kind = "") {
  const normalizedKind = normalizeKind(kind);
  const normalized = {
    organizationId: normalizeIdentifier(scope.organizationId, "Organization identity"),
    quoteId: normalizeIdentifier(scope.quoteId, "Quote identity"),
    revisionId: text(scope.revisionId, 256),
    paymentOperationId: text(scope.paymentOperationId, 256),
    closeoutId: text(scope.closeoutId, 256),
    messageId: text(scope.messageId, 256)
  };
  if (normalizedKind !== "unread_customer_reply" && !normalized.revisionId) {
    throw new RevenueAutopilotError(
      "failed-precondition",
      "Revenue Autopilot stop evidence requires an exact proposal revision."
    );
  }
  if (normalizedKind === "final_balance_reminder" && !normalized.paymentOperationId) {
    throw new RevenueAutopilotError(
      "failed-precondition",
      "Final-balance stop evidence requires one canonical payment operation."
    );
  }
  if (normalizedKind === "post_event_review_request") {
    normalized.closeoutId = normalizeIdentifier(
      normalized.closeoutId,
      "Post-event closeout identity"
    );
  }
  if (normalizedKind === "unread_customer_reply" && !normalized.messageId) {
    throw new RevenueAutopilotError(
      "failed-precondition",
      "Unread-reply evidence requires the exact latest message."
    );
  }
  return normalized;
}

function stopResult(state, reason, scope) {
  return Object.freeze({
    state,
    eligible: state === "eligible",
    scope,
    reasons: Object.freeze([reason])
  });
}

function evaluateRevenueAutopilotStopEvidence({ kind, scope, evidence = {} } = {}) {
  const normalizedKind = normalizeKind(kind);
  const normalizedScope = normalizeStopScope(scope, normalizedKind);

  if (normalizedKind === "unread_customer_reply") {
    const conversation = evidence.conversation;
    if (
      !scopeMatches(conversation, normalizedScope)
      || text(conversation?.source, 64).toLowerCase() !== "quote_conversation_attention_state"
      || text(conversation?.latestMessageId, 256) !== normalizedScope.messageId
      || !normalizeISO(conversation?.latestMessageAtISO)
    ) {
      return stopResult(
        "blocked",
        evidenceReason(
          "conversation_evidence_missing",
          "Exact latest-message and staff-acknowledgement evidence is required."
        ),
        normalizedScope
      );
    }
    const actorType = text(conversation.latestActorType, 32).toLowerCase();
    if (!new Set(["staff", "customer"]).has(actorType)) {
      return stopResult(
        "blocked",
        evidenceReason("conversation_actor_invalid", "Latest conversation actor is invalid."),
        normalizedScope
      );
    }
    if (actorType === "staff") {
      return stopResult(
        "stopped",
        evidenceReason(
          "latest_reply_not_customer",
          "Unread-reply attention is stopped because the latest message is from staff.",
          "stop"
        ),
        normalizedScope
      );
    }
    const staffAcknowledged = record(conversation.staffAcknowledged)
      ? conversation.staffAcknowledged
      : {};
    const acknowledgedAtISO = normalizeISO(staffAcknowledged.acknowledgedAtISO);
    if (text(staffAcknowledged.latestMessageId, 256) === normalizedScope.messageId) {
      if (!acknowledgedAtISO || acknowledgedAtISO < normalizeISO(conversation.latestMessageAtISO)) {
        return stopResult(
          "blocked",
          evidenceReason(
            "conversation_acknowledgement_stale",
            "The staff acknowledgement does not follow the latest customer message."
          ),
          normalizedScope
        );
      }
      return stopResult(
        "stopped",
        evidenceReason(
          "customer_reply_acknowledged",
          "Unread-reply attention is stopped by an exact staff acknowledgement. This is not read evidence.",
          "stop"
        ),
        normalizedScope
      );
    }
    if (
      text(staffAcknowledged.latestMessageId, 256)
      || text(staffAcknowledged.acknowledgedAtISO, 64)
    ) {
      return stopResult(
        "blocked",
        evidenceReason(
          "conversation_acknowledgement_mismatch",
          "Stored staff acknowledgement is not bound to the latest customer message."
        ),
        normalizedScope
      );
    }
    return stopResult(
      "eligible",
      evidenceReason(
        "customer_reply_unread",
        "The exact latest customer message has no covering staff acknowledgement.",
        "eligibility"
      ),
      normalizedScope
    );
  }

  if (normalizedKind === "post_event_review_request") {
    const closeout = exactPostEventCloseoutEvidence(normalizedScope, evidence);
    if (closeout.error) return stopResult("blocked", closeout.error, normalizedScope);
    if (closeout.state !== "completed") {
      return stopResult(
        "stopped",
        evidenceReason(
          closeout.state === "blocked_configuration"
            ? "post_event_closeout_configuration_blocked"
            : "post_event_closeout_not_completed",
          "Post-event review email stops unless the exact closeout remains completed.",
          "stop"
        ),
        normalizedScope
      );
    }
    return stopResult(
      "eligible",
      evidenceReason(
        "post_event_closeout_completed",
        "The exact post-event closeout is completed and remains eligible for its one due occurrence.",
        "eligibility"
      ),
      normalizedScope
    );
  }

  const portal = exactPortalEvidence(normalizedScope, evidence);
  if (portal.error) return stopResult("blocked", portal.error, normalizedScope);

  if (normalizedKind === "quote_follow_up") {
    if (["viewed", "accepted", "booked", "declined"].includes(portal.state)) {
      return stopResult(
        "stopped",
        evidenceReason(
          `portal_${portal.state}_recorded`,
          `Quote follow-up is stopped by exact portal ${portal.state} evidence.`,
          "stop"
        ),
        normalizedScope
      );
    }
    return stopResult(
      "eligible",
      evidenceReason(
        "portal_unviewed",
        "The exact current proposal remains sent and unviewed.",
        "eligibility"
      ),
      normalizedScope
    );
  }

  if (portal.state === "declined") {
    return stopResult(
      "stopped",
      evidenceReason("quote_declined", "Payment reminders stop after a decline.", "stop"),
      normalizedScope
    );
  }
  const requiredPortalState = normalizedKind === "final_balance_reminder"
    ? "booked"
    : ["accepted", "booked"];
  const portalStateAllowed = Array.isArray(requiredPortalState)
    ? requiredPortalState.includes(portal.state)
    : portal.state === requiredPortalState;
  if (!portalStateAllowed) {
    return stopResult(
      "blocked",
      evidenceReason(
        normalizedKind === "final_balance_reminder"
          ? "booking_evidence_missing"
          : "acceptance_evidence_missing",
        normalizedKind === "final_balance_reminder"
          ? "Final-balance reminders require an exact booked proposal."
          : "Deposit reminders require an exact accepted proposal."
      ),
      normalizedScope
    );
  }
  const acceptance = exactAcceptanceEvidence(normalizedScope, evidence, portal.record);
  if (acceptance.error) return stopResult("blocked", acceptance.error, normalizedScope);

  const deposit = exactDepositEvidence(normalizedScope, evidence);
  if (deposit.error) return stopResult("blocked", deposit.error, normalizedScope);
  if (["paid", "refunded"].includes(deposit.state)) {
    if (normalizedKind === "deposit_reminder" || deposit.state === "refunded") {
      const reminderLabel = normalizedKind === "deposit_reminder"
        ? "Deposit reminders"
        : "Final-balance reminders";
      return stopResult(
        "stopped",
        evidenceReason(
          deposit.state === "paid" ? "deposit_paid" : "deposit_refunded",
          `${reminderLabel} stop on exact webhook-confirmed deposit ${deposit.state} evidence.`,
          "stop"
        ),
        normalizedScope
      );
    }
  } else if (normalizedKind === "final_balance_reminder") {
    return stopResult(
      "blocked",
      evidenceReason(
        "deposit_not_settled",
        "Final-balance reminders require exact webhook-confirmed paid deposit evidence."
      ),
      normalizedScope
    );
  }

  if (normalizedKind === "deposit_reminder") {
    return stopResult(
      "eligible",
      evidenceReason(
        "deposit_unpaid",
        "The accepted proposal has no verified paid or refunded deposit event.",
        "eligibility"
      ),
      normalizedScope
    );
  }

  const finalBalance = exactFinalBalanceEvidence(normalizedScope, evidence);
  if (finalBalance.error) return stopResult("blocked", finalBalance.error, normalizedScope);
  if (["paid", "refunded"].includes(finalBalance.state)) {
    return stopResult(
      "stopped",
      evidenceReason(
        finalBalance.state === "paid" ? "final_balance_paid" : "final_balance_refunded",
        `Final-balance reminders stop on exact canonical ${finalBalance.state} evidence.`,
        "stop"
      ),
      normalizedScope
    );
  }
  if (finalBalance.state === "processing") {
    return stopResult(
      "deferred",
      evidenceReason(
        "final_balance_processing",
        "Final-balance reminders are deferred while the canonical payment rail is processing.",
        "timing"
      ),
      normalizedScope
    );
  }
  return stopResult(
    "eligible",
    evidenceReason(
      "final_balance_unsettled",
      "The booked proposal has one exact unsettled final-balance rail.",
      "eligibility"
    ),
    normalizedScope
  );
}

function normalizeTemplateSnapshot(template = {}) {
  const templateId = normalizeIdentifier(template.templateId, "Template identity");
  const version = normalizeIdentifier(template.version, "Template version");
  const fingerprint = text(template.fingerprint, 64).toLowerCase();
  if (!/^[a-f0-9]{64}$/.test(fingerprint)) {
    throw new RevenueAutopilotError(
      "failed-precondition",
      "Revenue Autopilot template fingerprint is invalid."
    );
  }
  return { templateId, version, fingerprint };
}

function normalizePolicyVersion(value) {
  return normalizeIdentifier(value, "Policy version");
}

function normalizeExistingJobs(existingJobs) {
  if (!Array.isArray(existingJobs)) return [];
  return existingJobs.map(normalizeRevenueAutopilotJob);
}

function planRevenueAutopilotMaterialization({
  organizationId,
  quoteId,
  kind,
  scopeKey,
  stopScope,
  evidence,
  global,
  tenantPolicy,
  controls,
  occurrences,
  template,
  policyVersion,
  existingJobs = [],
  nowISO
} = {}) {
  const normalizedKind = normalizeKind(kind);
  if (!OUTBOUND_REVENUE_AUTOPILOT_KINDS.has(normalizedKind)) {
    throw new RevenueAutopilotError(
      "invalid-argument",
      "Unread customer replies use the dedicated Attention planner."
    );
  }
  const now = requireISO(nowISO, "Revenue Autopilot materialization");
  const normalizedOrganizationId = normalizeIdentifier(
    organizationId,
    "Organization identity"
  );
  const normalizedQuoteId = normalizeIdentifier(quoteId, "Quote identity");
  const stop = evaluateRevenueAutopilotStopEvidence({
    kind: normalizedKind,
    scope: stopScope,
    evidence
  });
  if (
    stop.scope.organizationId !== normalizedOrganizationId
    || stop.scope.quoteId !== normalizedQuoteId
  ) {
    throw new RevenueAutopilotError(
      "aborted",
      "Revenue Autopilot materialization evidence is outside the requested quote scope."
    );
  }
  const canonicalScopeKey = buildRevenueAutopilotScopeKey({
    kind: normalizedKind,
    revisionId: stop.scope.revisionId,
    paymentOperationId: stop.scope.paymentOperationId,
    closeoutId: stop.scope.closeoutId
  });
  if (text(scopeKey, 256) && text(scopeKey, 256) !== canonicalScopeKey) {
    throw new RevenueAutopilotError(
      "aborted",
      "Revenue Autopilot job scope does not match its authoritative evidence."
    );
  }
  const gate = evaluateRevenueAutopilotGates({
    global,
    tenantPolicy,
    controls,
    kind: normalizedKind,
    nowISO: now,
    channel: "email"
  });
  const relevantExisting = normalizeExistingJobs(existingJobs).filter((job) => (
    job.organizationId === normalizedOrganizationId
    && job.quoteId === normalizedQuoteId
    && job.kind === normalizedKind
  ));
  const existing = relevantExisting.filter((job) => job.scopeKey === canonicalScopeKey);
  const staleScopeExisting = relevantExisting.filter((job) => job.scopeKey !== canonicalScopeKey);
  const activeExisting = existing.filter((job) => !TERMINAL_JOB_STATES.has(job.state));
  const staleScopeUpdates = staleScopeExisting
    .filter((job) => !TERMINAL_JOB_STATES.has(job.state))
    .map((job) => ({
      jobId: job.jobId,
      state: REVENUE_AUTOPILOT_JOB_STATES.STOPPED,
      stoppedAtISO: now,
      completedAtISO: now,
      outcomeReason: "authoritative_scope_changed"
    }));
  if (stop.state === "stopped" || gate.state === "stopped") {
    const reason = [...stop.reasons, ...gate.reasons][0];
    return Object.freeze({
      state: "stopped",
      stop,
      gate,
      create: Object.freeze([]),
      keep: Object.freeze([]),
      skip: Object.freeze([]),
      conflicts: Object.freeze([]),
      updates: Object.freeze([...staleScopeUpdates, ...activeExisting.map((job) => ({
        jobId: job.jobId,
        state: REVENUE_AUTOPILOT_JOB_STATES.STOPPED,
        stoppedAtISO: now,
        completedAtISO: now,
        outcomeReason: reason?.code || "automation_stopped"
      }))])
    });
  }
  if (stop.state !== "eligible" || !["clear", "deferred"].includes(gate.state)) {
    return Object.freeze({
      state: stop.state === "deferred" || gate.state === "deferred" ? "deferred" : "blocked",
      stop,
      gate,
      create: Object.freeze([]),
      keep: Object.freeze(existing),
      skip: Object.freeze([]),
      conflicts: Object.freeze([]),
      updates: Object.freeze(staleScopeUpdates)
    });
  }

  const templateSnapshot = normalizeTemplateSnapshot(template);
  const normalizedPolicyVersion = normalizePolicyVersion(policyVersion);
  const timeZone = requireTimeZone(tenantPolicy.timeZone);
  const today = tenantCalendarContext({ nowISO: now, timeZone }).date;
  if (!Array.isArray(occurrences) || !occurrences.length || occurrences.length > 12) {
    throw new RevenueAutopilotError(
      "failed-precondition",
      "Revenue Autopilot materialization requires one to twelve occurrences."
    );
  }
  const existingById = new Map(existing.map((job) => [job.jobId, job]));
  const create = [];
  const keep = [];
  const skip = [];
  const conflicts = [];
  const seenIds = new Set();

  for (const occurrence of occurrences) {
    const dueTenantDate = requireDateOnly(
      occurrence?.dueTenantDate,
      "Revenue Autopilot occurrence"
    );
    const identity = buildRevenueAutopilotJobIdentity({
      organizationId,
      quoteId,
      kind: normalizedKind,
      scopeKey: canonicalScopeKey,
      occurrenceKey: occurrence?.occurrenceKey
    });
    if (seenIds.has(identity.jobId)) {
      throw new RevenueAutopilotError(
        "failed-precondition",
        "Revenue Autopilot occurrence identities must be unique."
      );
    }
    seenIds.add(identity.jobId);
    if (dueTenantDate < today) {
      skip.push({
        ...identity,
        dueTenantDate,
        reason: "missed_occurrence_not_backfilled"
      });
      continue;
    }
    const prior = existingById.get(identity.jobId);
    if (prior) {
      if (
        prior.template.fingerprint !== templateSnapshot.fingerprint
        || prior.template.templateId !== templateSnapshot.templateId
        || prior.template.version !== templateSnapshot.version
        || prior.policyVersion !== normalizedPolicyVersion
      ) {
        conflicts.push({
          jobId: prior.jobId,
          reason: "frozen_job_payload_changed",
          existingTemplate: prior.template,
          requestedTemplate: templateSnapshot,
          existingPolicyVersion: prior.policyVersion,
          requestedPolicyVersion: normalizedPolicyVersion
        });
      } else {
        keep.push(prior);
      }
      continue;
    }
    create.push({
      schemaVersion: 1,
      ...identity,
      state: REVENUE_AUTOPILOT_JOB_STATES.SCHEDULED,
      dueTenantDate,
      tenantTimeZone: timeZone,
      policyVersion: normalizedPolicyVersion,
      template: templateSnapshot,
      attemptCount: 0,
      maxAttempts: normalizeMaxAttempts(tenantPolicy.maxAttempts),
      idempotencyKey: identity.idempotencyKey,
      createdAtISO: now,
      lastAttemptAtISO: "",
      quietHoursDeferredAtISO: gate.state === "deferred" && dueTenantDate === today
        ? now
        : "",
      leaseExpiresAtISO: "",
      nextAttemptAtISO: "",
      provider: "",
      providerMessageId: "",
      providerAcceptedAtISO: "",
      deliveredAtISO: "",
      bouncedAtISO: "",
      complainedAtISO: "",
      stoppedAtISO: "",
      completedAtISO: "",
      lastOutcome: "",
      outcomeReason: "",
      lastError: "",
      providerEventIds: []
    });
  }
  return Object.freeze({
    state: conflicts.length ? "conflict" : (gate.state === "deferred" ? "deferred" : "ready"),
    stop,
    gate,
    create: Object.freeze(create),
    keep: Object.freeze(keep),
    skip: Object.freeze(skip),
    conflicts: Object.freeze(conflicts),
    updates: Object.freeze(staleScopeUpdates)
  });
}

function attentionIdentity({ organizationId, quoteId, messageId }) {
  const scope = buildRevenueAutopilotJobIdentity({
    organizationId,
    quoteId,
    kind: "unread_customer_reply",
    scopeKey: messageId,
    occurrenceKey: `message_${messageId}`
  });
  return {
    attentionId: `raa_${scope.jobId.slice(3)}`,
    organizationId: scope.organizationId,
    quoteId: scope.quoteId,
    messageId: scope.scopeKey
  };
}

function planUnreadCustomerReplyAttention({
  organizationId,
  quoteId,
  messageId,
  evidence,
  global,
  tenantPolicy,
  existingAttention = null,
  nowISO
} = {}) {
  const now = requireISO(nowISO, "Unread customer reply Attention planning");
  const identity = attentionIdentity({ organizationId, quoteId, messageId });
  const stop = evaluateRevenueAutopilotStopEvidence({
    kind: "unread_customer_reply",
    scope: { organizationId, quoteId, messageId },
    evidence
  });
  const gate = evaluateRevenueAutopilotGates({
    global,
    tenantPolicy,
    kind: "unread_customer_reply",
    nowISO: now,
    channel: "attention"
  });
  const prior = record(existingAttention) ? existingAttention : null;
  if (prior && text(prior.attentionId, 80) !== identity.attentionId) {
    throw new RevenueAutopilotError(
      "aborted",
      "Existing Attention identity does not match the latest customer message."
    );
  }
  if (
    prior
    && !new Set(["open", "handled", "resolved"]).has(text(prior.state, 32).toLowerCase())
  ) {
    throw new RevenueAutopilotError(
      "failed-precondition",
      "Existing Revenue Autopilot Attention state is invalid."
    );
  }
  if (stop.state === "stopped") {
    return Object.freeze({
      state: "resolved",
      stop,
      gate,
      create: null,
      update: prior && text(prior.state, 32).toLowerCase() === "open"
        ? {
            ...identity,
            state: "resolved",
            resolvedAtISO: now,
            resolutionReason: stop.reasons[0]?.code || "customer_reply_resolved"
          }
        : null
    });
  }
  if (stop.state !== "eligible" || gate.state !== "clear") {
    return Object.freeze({
      state: "blocked",
      stop,
      gate,
      create: null,
      update: null
    });
  }
  if (prior) {
    return Object.freeze({
      state: text(prior.state, 32).toLowerCase() || "open",
      stop,
      gate,
      create: null,
      update: null
    });
  }
  return Object.freeze({
    state: "open",
    stop,
    gate,
    create: {
      schemaVersion: 1,
      ...identity,
      type: "unread_customer_reply",
      state: "open",
      openedAtISO: now,
      updatedAtISO: now
    },
    update: null
  });
}

function normalizeMaxAttempts(value) {
  if (value == null || value === "") return DEFAULT_MAX_ATTEMPTS;
  const parsed = Number(value);
  if (!Number.isSafeInteger(parsed) || parsed < 1 || parsed > MAX_ATTEMPTS_LIMIT) {
    throw new RevenueAutopilotError(
      "failed-precondition",
      `Revenue Autopilot maxAttempts must be between 1 and ${MAX_ATTEMPTS_LIMIT}.`
    );
  }
  return parsed;
}

function normalizeRevenueAutopilotJob(input = {}) {
  if (!record(input)) {
    throw new RevenueAutopilotError("failed-precondition", "Revenue Autopilot job is missing.");
  }
  const identity = buildRevenueAutopilotJobIdentity(input);
  if (text(input.jobId, 80) !== identity.jobId || text(input.idempotencyKey, 256) !== identity.idempotencyKey) {
    throw new RevenueAutopilotError(
      "failed-precondition",
      "Revenue Autopilot job identity or provider idempotency key is invalid."
    );
  }
  const state = text(input.state, 32).toLowerCase();
  if (!Object.values(REVENUE_AUTOPILOT_JOB_STATES).includes(state)) {
    throw new RevenueAutopilotError("failed-precondition", "Revenue Autopilot job state is invalid.");
  }
  const attemptCount = Number(input.attemptCount);
  if (!Number.isSafeInteger(attemptCount) || attemptCount < 0) {
    throw new RevenueAutopilotError(
      "failed-precondition",
      "Revenue Autopilot job attempt count is invalid."
    );
  }
  const normalized = {
    schemaVersion: 1,
    ...identity,
    state,
    dueTenantDate: requireDateOnly(input.dueTenantDate, "Revenue Autopilot job"),
    tenantTimeZone: requireTimeZone(input.tenantTimeZone),
    policyVersion: normalizePolicyVersion(input.policyVersion),
    template: normalizeTemplateSnapshot(input.template),
    attemptCount,
    maxAttempts: normalizeMaxAttempts(input.maxAttempts),
    createdAtISO: requireISO(input.createdAtISO, "Revenue Autopilot job"),
    lastAttemptAtISO: normalizeISO(input.lastAttemptAtISO),
    quietHoursDeferredAtISO: normalizeISO(input.quietHoursDeferredAtISO),
    attemptId: text(input.attemptId, 256),
    leaseExpiresAtISO: normalizeISO(input.leaseExpiresAtISO),
    nextAttemptAtISO: normalizeISO(input.nextAttemptAtISO),
    provider: text(input.provider, 64).toLowerCase(),
    providerMessageId: normalizeProviderMessageId(input.providerMessageId),
    providerAcceptedAtISO: normalizeISO(input.providerAcceptedAtISO),
    deliveredAtISO: normalizeISO(input.deliveredAtISO),
    bouncedAtISO: normalizeISO(input.bouncedAtISO),
    complainedAtISO: normalizeISO(input.complainedAtISO),
    stoppedAtISO: normalizeISO(input.stoppedAtISO),
    completedAtISO: normalizeISO(input.completedAtISO),
    lastOutcome: text(input.lastOutcome, 32).toLowerCase(),
    outcomeReason: text(input.outcomeReason, 160).toLowerCase(),
    lastError: text(input.lastError, 500),
    providerEventIds: Array.isArray(input.providerEventIds)
      ? [...new Set(input.providerEventIds.map((value) => text(value, 160)).filter(Boolean))]
        .slice(-MAX_PROVIDER_EVENT_IDS)
      : []
  };
  if (attemptCount > normalized.maxAttempts) {
    throw new RevenueAutopilotError(
      "failed-precondition",
      "Revenue Autopilot job exceeded its bounded attempt policy."
    );
  }
  if (state === REVENUE_AUTOPILOT_JOB_STATES.SENDING && (
    !normalized.attemptId || !normalized.lastAttemptAtISO || !normalized.leaseExpiresAtISO
  )) {
    throw new RevenueAutopilotError(
      "failed-precondition",
      "Sending job lease evidence is incomplete."
    );
  }
  if (state === REVENUE_AUTOPILOT_JOB_STATES.SCHEDULED && attemptCount !== 0) {
    throw new RevenueAutopilotError(
      "failed-precondition",
      "A newly scheduled Revenue Autopilot job cannot contain prior attempts."
    );
  }
  if (state === REVENUE_AUTOPILOT_JOB_STATES.RETRY_WAIT && (
    attemptCount < 1
    || !normalized.nextAttemptAtISO
    || normalized.lastOutcome !== "ambiguous"
    || tenantCalendarContext({
      nowISO: normalized.nextAttemptAtISO,
      timeZone: normalized.tenantTimeZone
    }).date !== normalized.dueTenantDate
  )) {
    throw new RevenueAutopilotError(
      "failed-precondition",
      "Revenue Autopilot bounded-retry evidence is incomplete."
    );
  }
  if (state === REVENUE_AUTOPILOT_JOB_STATES.OUTCOME_AMBIGUOUS && (
    attemptCount < 1 || normalized.lastOutcome !== "ambiguous" || !normalized.outcomeReason
  )) {
    throw new RevenueAutopilotError(
      "failed-precondition",
      "Ambiguous Revenue Autopilot outcome evidence is incomplete."
    );
  }
  if (state === REVENUE_AUTOPILOT_JOB_STATES.DEFINITE_FAILURE && !normalized.completedAtISO) {
    throw new RevenueAutopilotError(
      "failed-precondition",
      "Definite Revenue Autopilot failure evidence is incomplete."
    );
  }
  if (state === REVENUE_AUTOPILOT_JOB_STATES.STOPPED && (
    !normalized.stoppedAtISO || !normalized.completedAtISO
  )) {
    throw new RevenueAutopilotError(
      "failed-precondition",
      "Stopped Revenue Autopilot evidence is incomplete."
    );
  }
  if ([
    REVENUE_AUTOPILOT_JOB_STATES.PROVIDER_ACCEPTED,
    REVENUE_AUTOPILOT_JOB_STATES.DELIVERED,
    REVENUE_AUTOPILOT_JOB_STATES.BOUNCED,
    REVENUE_AUTOPILOT_JOB_STATES.COMPLAINED
  ].includes(state) && (
    attemptCount < 1
    || !normalized.attemptId
    || !normalized.provider
    || !normalized.providerMessageId
    || !normalized.providerAcceptedAtISO
  )) {
    throw new RevenueAutopilotError(
      "failed-precondition",
      "Provider-accepted Revenue Autopilot evidence is incomplete."
    );
  }
  if (state === REVENUE_AUTOPILOT_JOB_STATES.DELIVERED && !normalized.deliveredAtISO) {
    throw new RevenueAutopilotError("failed-precondition", "Delivered evidence is incomplete.");
  }
  if (state === REVENUE_AUTOPILOT_JOB_STATES.BOUNCED && !normalized.bouncedAtISO) {
    throw new RevenueAutopilotError("failed-precondition", "Bounce evidence is incomplete.");
  }
  if (state === REVENUE_AUTOPILOT_JOB_STATES.COMPLAINED && !normalized.complainedAtISO) {
    throw new RevenueAutopilotError("failed-precondition", "Complaint evidence is incomplete.");
  }
  return normalized;
}

function revenueAutopilotAttributionScope(job) {
  if (job.kind === "final_balance_reminder") {
    const match = /^revision:(.+);payment:([^;]+)$/.exec(job.scopeKey);
    if (!match) {
      throw new RevenueAutopilotError(
        "failed-precondition",
        "Final-balance attribution scope is invalid."
      );
    }
    return { revisionId: match[1], paymentOperationId: match[2], closeoutId: "" };
  }
  if (job.kind === "post_event_review_request") {
    const match = /^revision:(.+);closeout:([^;]+)$/.exec(job.scopeKey);
    if (!match) {
      throw new RevenueAutopilotError(
        "failed-precondition",
        "Post-event attribution scope is invalid."
      );
    }
    return { revisionId: match[1], paymentOperationId: "", closeoutId: match[2] };
  }
  return { revisionId: job.scopeKey, paymentOperationId: "", closeoutId: "" };
}

function attributionCurrency(value) {
  const currency = text(value, 3).toLowerCase();
  if (!/^[a-z]{3}$/.test(currency)) {
    throw new RevenueAutopilotError(
      "failed-precondition",
      "Revenue Autopilot attribution currency is invalid."
    );
  }
  return currency;
}

function attributionAmountCents(value, label) {
  const amountCents = Number(value);
  if (!Number.isSafeInteger(amountCents) || amountCents < 0) {
    throw new RevenueAutopilotError(
      "failed-precondition",
      `${label} must be exact non-negative integer cents.`
    );
  }
  return amountCents;
}

function normalizeRevenueAutopilotAttributionOutcome(outcome, job, scope, observedAtISO) {
  if (!record(outcome)) return null;
  if (!scopeMatches(outcome, job)) {
    throw new RevenueAutopilotError(
      "permission-denied",
      "Revenue Autopilot attribution evidence is outside the exact quote scope."
    );
  }
  const source = text(outcome.source, 64).toLowerCase();
  const outcomeRevisionId = text(outcome.revisionId || outcome.quoteRevisionId, 256);
  const requireRevision = () => {
    if (!outcomeRevisionId || outcomeRevisionId !== scope.revisionId) {
      throw new RevenueAutopilotError(
        "failed-precondition",
        "Revenue Autopilot attribution evidence does not match the exact proposal revision."
      );
    }
  };
  let normalized;
  if (source === "customer_portal_projection") {
    requireRevision();
    const state = text(outcome.state, 32).toLowerCase();
    if (!new Set(["viewed", "accepted", "booked"]).has(state)) {
      throw new RevenueAutopilotError(
        "failed-precondition",
        "Customer-portal attribution requires an exact customer decision state."
      );
    }
    normalized = {
      type: `portal_${state}`,
      source,
      evidenceId: `portal_${createHash("sha256")
        .update(`${job.organizationId}|${job.quoteId}|${scope.revisionId}|${state}|${text(outcome.stateAtISO, 64)}`)
        .digest("hex")}`,
      occurredAtISO: requireISO(outcome.stateAtISO, "Customer-portal outcome"),
      commercialMeasure: { classification: "customer_decision", amountCents: null, currency: "" }
    };
  } else if (source === "proposal_acceptance_receipt") {
    requireRevision();
    normalized = {
      type: "proposal_accepted",
      source,
      evidenceId: normalizeIdentifier(outcome.receiptId, "Acceptance receipt identity"),
      occurredAtISO: requireISO(outcome.acceptedAtISO, "Acceptance outcome"),
      commercialMeasure: { classification: "accepted_scope", amountCents: null, currency: "" }
    };
  } else if (source === "canonical_booking_receipt") {
    requireRevision();
    normalized = {
      type: "booking_recorded",
      source,
      evidenceId: normalizeIdentifier(outcome.receiptId, "Booking receipt identity"),
      occurredAtISO: requireISO(outcome.bookedAtISO, "Booking outcome"),
      commercialMeasure: {
        classification: "booked_value",
        amountCents: attributionAmountCents(outcome.acceptedTotalCents, "Booked value"),
        currency: attributionCurrency(outcome.currency)
      }
    };
  } else if (source === "verified_provider_webhook") {
    requireRevision();
    const paymentKind = text(outcome.paymentKind, 32).toLowerCase();
    if (
      outcome.signatureVerified !== true
      || text(outcome.processingState, 32).toLowerCase() !== "processed"
      || text(outcome.state || outcome.providerState, 32).toLowerCase() !== "paid"
      || !new Set(["deposit", "final_balance"]).has(paymentKind)
      || (job.kind === "deposit_reminder" && paymentKind !== "deposit")
      || (job.kind === "final_balance_reminder" && paymentKind !== "final_balance")
    ) {
      throw new RevenueAutopilotError(
        "failed-precondition",
        "Money-received attribution requires a processed signature-verified webhook."
      );
    }
    normalized = {
      type: "payment_settled",
      source,
      evidenceId: normalizeIdentifier(
        outcome.eventId || outcome.providerReference,
        "Payment evidence identity"
      ),
      occurredAtISO: requireISO(outcome.processedAtISO, "Payment outcome"),
      commercialMeasure: {
        classification: "money_received",
        amountCents: attributionAmountCents(outcome.amountCents, "Money received"),
        currency: attributionCurrency(outcome.currency)
      }
    };
  } else if (source === "canonical_payment_ledger") {
    requireRevision();
    if (
      text(outcome.state, 32).toLowerCase() !== "paid"
      || !text(outcome.providerReference, 256)
    ) {
      throw new RevenueAutopilotError(
        "failed-precondition",
        "Ledger attribution requires exact provider-settled paid evidence."
      );
    }
    if (
      scope.paymentOperationId
      && text(outcome.operationId, 256) !== scope.paymentOperationId
    ) {
      throw new RevenueAutopilotError(
        "failed-precondition",
        "Ledger attribution does not match the exact payment operation."
      );
    }
    normalized = {
      type: "payment_settled",
      source,
      evidenceId: normalizeIdentifier(outcome.operationId, "Payment operation identity"),
      occurredAtISO: requireISO(outcome.providerSettledAtISO, "Payment outcome"),
      commercialMeasure: {
        classification: "money_received",
        amountCents: attributionAmountCents(outcome.amountCents, "Money received"),
        currency: attributionCurrency(outcome.currency)
      }
    };
  } else if (source === "verified_review_receipt") {
    if (
      job.kind !== "post_event_review_request"
      || text(outcome.closeoutId, 256) !== scope.closeoutId
    ) {
      throw new RevenueAutopilotError(
        "failed-precondition",
        "Review attribution does not match the exact post-event closeout."
      );
    }
    normalized = {
      type: "review_recorded",
      source,
      evidenceId: normalizeIdentifier(outcome.receiptId, "Review receipt identity"),
      occurredAtISO: requireISO(outcome.reviewedAtISO, "Review outcome"),
      commercialMeasure: { classification: "customer_review", amountCents: null, currency: "" }
    };
  } else {
    throw new RevenueAutopilotError(
      "failed-precondition",
      "Revenue Autopilot attribution evidence source is unsupported."
    );
  }
  if (normalized.occurredAtISO > observedAtISO) {
    throw new RevenueAutopilotError(
      "failed-precondition",
      "Revenue Autopilot attribution evidence cannot be future-dated."
    );
  }
  return normalized;
}

function buildRevenueAutopilotAttributionProjection({
  job,
  outcomeEvidence = null,
  observedAtISO
} = {}) {
  const current = normalizeRevenueAutopilotJob(job);
  const observedAt = requireISO(observedAtISO, "Revenue Autopilot attribution observation");
  const scope = revenueAutopilotAttributionScope(current);
  const windowDays = REVENUE_AUTOPILOT_ATTRIBUTION_WINDOW_DAYS[current.kind];
  if (!windowDays) {
    throw new RevenueAutopilotError(
      "failed-precondition",
      "Internal Attention does not produce commercial attribution."
    );
  }
  const base = {
    schemaVersion: 1,
    modelVersion: "revenue-autopilot-attribution-v1",
    authority: "deterministic_evidence_projection",
    organizationId: current.organizationId,
    quoteId: current.quoteId,
    jobId: current.jobId,
    kind: current.kind,
    observedAtISO: observedAt,
    recoveredRevenue: {
      established: false,
      amountCents: null,
      reason: "temporal_association_is_not_causal_recovery"
    },
    proofBoundary: "Booked value and money received are commercial measures, not accounting revenue or recovered revenue. A verified time-window match establishes temporal association only."
  };
  if (
    current.state !== REVENUE_AUTOPILOT_JOB_STATES.DELIVERED
    || !current.deliveredAtISO
  ) {
    return Object.freeze({
      ...base,
      attributionState: "insufficient_evidence",
      reason: "provider_delivery_not_verified",
      window: { days: windowDays, startAtISO: "", endAtISO: "", matched: false },
      outcome: null,
      commercialMeasure: { classification: "none", amountCents: null, currency: "" }
    });
  }
  const normalizedOutcome = normalizeRevenueAutopilotAttributionOutcome(
    outcomeEvidence,
    current,
    scope,
    observedAt
  );
  const windowStartAtISO = current.deliveredAtISO;
  const windowEndAtISO = new Date(
    Date.parse(windowStartAtISO) + (windowDays * 86400000)
  ).toISOString();
  if (!normalizedOutcome) {
    return Object.freeze({
      ...base,
      attributionState: "insufficient_evidence",
      reason: "outcome_evidence_missing",
      window: {
        days: windowDays,
        startAtISO: windowStartAtISO,
        endAtISO: windowEndAtISO,
        matched: false
      },
      outcome: null,
      commercialMeasure: { classification: "none", amountCents: null, currency: "" }
    });
  }
  const matched = normalizedOutcome.occurredAtISO >= windowStartAtISO
    && normalizedOutcome.occurredAtISO <= windowEndAtISO;
  return Object.freeze({
    ...base,
    attributionState: matched ? "verified_temporal_association" : "outside_window",
    reason: matched
      ? "verified_outcome_within_exact_window"
      : normalizedOutcome.occurredAtISO < windowStartAtISO
        ? "outcome_predates_verified_delivery"
        : "outcome_after_exact_window",
    window: {
      days: windowDays,
      startAtISO: windowStartAtISO,
      endAtISO: windowEndAtISO,
      matched
    },
    outcome: {
      type: normalizedOutcome.type,
      source: normalizedOutcome.source,
      evidenceId: normalizedOutcome.evidenceId,
      occurredAtISO: normalizedOutcome.occurredAtISO
    },
    commercialMeasure: normalizedOutcome.commercialMeasure
  });
}

function planRevenueAutopilotExecution({
  job,
  global,
  tenantPolicy,
  controls,
  stopScope,
  evidence,
  nowISO
} = {}) {
  const current = normalizeRevenueAutopilotJob(job);
  const now = requireISO(nowISO, "Revenue Autopilot execution");
  if (TERMINAL_JOB_STATES.has(current.state)) {
    return { action: "none", reason: "job_terminal", job: current };
  }
  if (current.state === REVENUE_AUTOPILOT_JOB_STATES.PROVIDER_ACCEPTED) {
    return { action: "wait_for_provider_event", reason: "provider_accepted", job: current };
  }
  const stop = evaluateRevenueAutopilotStopEvidence({
    kind: current.kind,
    scope: stopScope,
    evidence
  });
  const canonicalScopeKey = buildRevenueAutopilotScopeKey({
    kind: current.kind,
    revisionId: stop.scope.revisionId,
    paymentOperationId: stop.scope.paymentOperationId,
    closeoutId: stop.scope.closeoutId
  });
  if (
    stop.scope.organizationId !== current.organizationId
    || stop.scope.quoteId !== current.quoteId
    || canonicalScopeKey !== current.scopeKey
  ) {
    throw new RevenueAutopilotError(
      "aborted",
      "Revenue Autopilot execution evidence does not match the materialized job scope."
    );
  }
  if (stop.state === "stopped") {
    return {
      action: "stop",
      reason: stop.reasons[0]?.code || "stop_evidence_recorded",
      stop,
      job: {
        ...current,
        state: REVENUE_AUTOPILOT_JOB_STATES.STOPPED,
        stoppedAtISO: now,
        completedAtISO: now,
        outcomeReason: stop.reasons[0]?.code || "stop_evidence_recorded",
        leaseExpiresAtISO: "",
        nextAttemptAtISO: ""
      }
    };
  }
  if (stop.state !== "eligible") {
    return { action: "block", reason: stop.reasons[0]?.code || "stop_evidence_blocked", stop, job: current };
  }
  const gate = evaluateRevenueAutopilotGates({
    global,
    tenantPolicy,
    controls,
    kind: current.kind,
    nowISO: now,
    channel: "email"
  });
  if (gate.state === "stopped") {
    return {
      action: "stop",
      reason: gate.reasons[0]?.code || "recipient_stopped",
      gate,
      job: {
        ...current,
        state: REVENUE_AUTOPILOT_JOB_STATES.STOPPED,
        stoppedAtISO: now,
        completedAtISO: now,
        outcomeReason: gate.reasons[0]?.code || "recipient_stopped",
        leaseExpiresAtISO: "",
        nextAttemptAtISO: ""
      }
    };
  }
  if (gate.state === "blocked") {
    return { action: "block", reason: gate.reasons[0]?.code || "execution_blocked", gate, job: current };
  }
  if (gate.state === "deferred") {
    return {
      action: "wait",
      reason: "inside_quiet_hours",
      gate,
      job: {
        ...current,
        quietHoursDeferredAtISO: current.quietHoursDeferredAtISO || now
      }
    };
  }
  const calendar = gate.calendar;
  if (current.dueTenantDate > calendar.date) {
    return { action: "wait", reason: "occurrence_not_due", gate, job: current };
  }
  const deferredTenantDate = current.quietHoursDeferredAtISO
    ? tenantCalendarContext({
        nowISO: current.quietHoursDeferredAtISO,
        timeZone: current.tenantTimeZone
      }).date
    : "";
  const quietHoursRollover = current.attemptCount === 0
    && deferredTenantDate === current.dueTenantDate
    && calendar.date === addCalendarDays(current.dueTenantDate, 1);
  if (
    current.dueTenantDate < calendar.date
    && current.attemptCount === 0
    && !quietHoursRollover
  ) {
    return {
      action: "stop",
      reason: "missed_occurrence_not_backfilled",
      gate,
      job: {
        ...current,
        state: REVENUE_AUTOPILOT_JOB_STATES.STOPPED,
        stoppedAtISO: now,
        completedAtISO: now,
        outcomeReason: "missed_occurrence_not_backfilled"
      }
    };
  }
  if (current.nextAttemptAtISO && current.nextAttemptAtISO > now) {
    return { action: "wait", reason: "retry_not_due", gate, job: current };
  }
  if (current.state === REVENUE_AUTOPILOT_JOB_STATES.SENDING) {
    if (current.leaseExpiresAtISO > now) {
      return { action: "wait", reason: "active_send_lease", gate, job: current };
    }
    return {
      action: "reconcile",
      reason: "expired_send_lease_provider_outcome_unknown",
      gate,
      job: {
        ...current,
        state: REVENUE_AUTOPILOT_JOB_STATES.OUTCOME_AMBIGUOUS,
        leaseExpiresAtISO: "",
        lastOutcome: "ambiguous",
        outcomeReason: "expired_send_lease_provider_outcome_unknown"
      }
    };
  }
  if (current.state === REVENUE_AUTOPILOT_JOB_STATES.OUTCOME_AMBIGUOUS) {
    return { action: "reconcile", reason: current.outcomeReason || "provider_outcome_ambiguous", gate, job: current };
  }
  if (current.attemptCount >= current.maxAttempts) {
    return {
      action: "reconcile",
      reason: "attempt_limit_reached",
      gate,
      job: {
        ...current,
        state: REVENUE_AUTOPILOT_JOB_STATES.OUTCOME_AMBIGUOUS,
        lastOutcome: "ambiguous",
        outcomeReason: "attempt_limit_reached"
      }
    };
  }
  return { action: "claim", reason: "eligible_occurrence_due", gate, stop, job: current };
}

function claimRevenueAutopilotJob({ job, attemptId, nowISO, leaseMs = DEFAULT_LEASE_MS } = {}) {
  const current = normalizeRevenueAutopilotJob(job);
  const now = requireISO(nowISO, "Revenue Autopilot claim");
  const normalizedAttemptId = normalizeIdentifier(attemptId, "Attempt identity");
  const leaseDuration = Number(leaseMs);
  if (!Number.isSafeInteger(leaseDuration) || leaseDuration < 1_000 || leaseDuration > 10 * 60 * 1000) {
    throw new RevenueAutopilotError("invalid-argument", "Revenue Autopilot lease duration is invalid.");
  }
  if (![REVENUE_AUTOPILOT_JOB_STATES.SCHEDULED, REVENUE_AUTOPILOT_JOB_STATES.RETRY_WAIT].includes(current.state)) {
    throw new RevenueAutopilotError(
      "failed-precondition",
      "Only a scheduled or bounded-retry Revenue Autopilot job can be claimed."
    );
  }
  if (current.nextAttemptAtISO && current.nextAttemptAtISO > now) {
    throw new RevenueAutopilotError("aborted", "Revenue Autopilot retry is not due yet.");
  }
  if (current.attemptCount >= current.maxAttempts) {
    throw new RevenueAutopilotError("failed-precondition", "Revenue Autopilot attempt limit is reached.");
  }
  return {
    ...current,
    state: REVENUE_AUTOPILOT_JOB_STATES.SENDING,
    attemptId: normalizedAttemptId,
    attemptCount: current.attemptCount + 1,
    lastAttemptAtISO: now,
    leaseExpiresAtISO: new Date(Date.parse(now) + leaseDuration).toISOString(),
    nextAttemptAtISO: "",
    quietHoursDeferredAtISO: "",
    lastOutcome: "",
    outcomeReason: "",
    lastError: ""
  };
}

function normalizeHttpStatus(value) {
  const status = Number(value);
  return Number.isInteger(status) && status >= 100 && status <= 599 ? status : 0;
}

function classifyRevenueAutopilotDispatchError(error = {}) {
  const explicitOutcome = text(
    error.revenueAutopilotOutcome || error.quoteDeliveryOutcome,
    32
  ).toLowerCase();
  const explicitReason = text(
    error.revenueAutopilotReason || error.quoteDeliveryReason,
    160
  ).toLowerCase();
  const providerHttpStatus = normalizeHttpStatus(error.providerHttpStatus);
  const code = text(error.code, 64).toLowerCase();
  if (explicitOutcome === "definite_failure") {
    return { outcome: "definite_failure", reason: explicitReason || "provider_rejected", providerHttpStatus };
  }
  if (["ambiguous", "provider_accepted", "manual_review"].includes(explicitOutcome)) {
    return { outcome: "ambiguous", reason: explicitReason || "provider_outcome_ambiguous", providerHttpStatus };
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

function normalizeRetryDelays(values) {
  const source = Array.isArray(values) && values.length ? values : DEFAULT_RETRY_DELAYS_MS;
  const delays = source.map(Number);
  if (
    !delays.length
    || delays.length > MAX_ATTEMPTS_LIMIT - 1
    || delays.some((value) => !Number.isSafeInteger(value) || value < 1_000 || value > 12 * 60 * 60 * 1000)
  ) {
    throw new RevenueAutopilotError("invalid-argument", "Revenue Autopilot retry delays are invalid.");
  }
  return delays;
}

function planRevenueAutopilotDispatchFailure({ job, error, nowISO, retryDelaysMs } = {}) {
  const current = normalizeRevenueAutopilotJob(job);
  if (current.state !== REVENUE_AUTOPILOT_JOB_STATES.SENDING) {
    throw new RevenueAutopilotError(
      "failed-precondition",
      "Only a claimed Revenue Autopilot job can record a dispatch failure."
    );
  }
  const now = requireISO(nowISO, "Revenue Autopilot dispatch failure");
  const classification = classifyRevenueAutopilotDispatchError(error);
  if (classification.outcome === "definite_failure") {
    return {
      outcome: "definite_failure",
      resumable: false,
      requiresReconciliation: false,
      job: {
        ...current,
        state: REVENUE_AUTOPILOT_JOB_STATES.DEFINITE_FAILURE,
        leaseExpiresAtISO: "",
        nextAttemptAtISO: "",
        lastOutcome: "definite_failure",
        outcomeReason: classification.reason,
        lastError: text(error?.message, 500),
        completedAtISO: now
      }
    };
  }
  const delays = normalizeRetryDelays(retryDelaysMs);
  const retryIndex = Math.max(0, current.attemptCount - 1);
  if (current.attemptCount >= current.maxAttempts || retryIndex >= delays.length) {
    return {
      outcome: "ambiguous",
      resumable: false,
      requiresReconciliation: true,
      job: {
        ...current,
        state: REVENUE_AUTOPILOT_JOB_STATES.OUTCOME_AMBIGUOUS,
        leaseExpiresAtISO: "",
        nextAttemptAtISO: "",
        lastOutcome: "ambiguous",
        outcomeReason: classification.reason,
        lastError: text(error?.message, 500)
      }
    };
  }
  const nextAttemptAtISO = new Date(Date.parse(now) + delays[retryIndex]).toISOString();
  const nextTenantDate = tenantCalendarContext({
    nowISO: nextAttemptAtISO,
    timeZone: current.tenantTimeZone
  }).date;
  if (nextTenantDate !== current.dueTenantDate) {
    return {
      outcome: "ambiguous",
      resumable: false,
      requiresReconciliation: true,
      job: {
        ...current,
        state: REVENUE_AUTOPILOT_JOB_STATES.OUTCOME_AMBIGUOUS,
        leaseExpiresAtISO: "",
        nextAttemptAtISO: "",
        lastOutcome: "ambiguous",
        outcomeReason: "retry_window_crossed_tenant_day",
        lastError: text(error?.message, 500)
      }
    };
  }
  return {
    outcome: "ambiguous",
    resumable: true,
    requiresReconciliation: false,
    job: {
      ...current,
      state: REVENUE_AUTOPILOT_JOB_STATES.RETRY_WAIT,
      leaseExpiresAtISO: "",
      nextAttemptAtISO,
      lastOutcome: "ambiguous",
      outcomeReason: classification.reason,
      lastError: text(error?.message, 500)
    }
  };
}

function planRevenueAutopilotOutcomeResolution({
  job,
  resolution,
  provider = "",
  providerMessageId = "",
  providerAcceptedAtISO = "",
  nowISO
} = {}) {
  const current = normalizeRevenueAutopilotJob(job);
  const now = requireISO(nowISO, "Revenue Autopilot outcome resolution");
  if (current.state !== REVENUE_AUTOPILOT_JOB_STATES.OUTCOME_AMBIGUOUS) {
    throw new RevenueAutopilotError(
      "failed-precondition",
      "Only an ambiguous Revenue Autopilot outcome can be reconciled."
    );
  }
  const normalizedResolution = text(resolution, 32).toLowerCase();
  if (!new Set(["confirmed_not_sent", "provider_accepted"]).has(normalizedResolution)) {
    throw new RevenueAutopilotError(
      "invalid-argument",
      "Revenue Autopilot outcome resolution is invalid."
    );
  }
  if (normalizedResolution === "confirmed_not_sent") {
    const tenantDate = tenantCalendarContext({
      nowISO: now,
      timeZone: current.tenantTimeZone
    }).date;
    if (current.attemptCount >= current.maxAttempts || tenantDate !== current.dueTenantDate) {
      return {
        action: "complete_without_send",
        resumable: false,
        job: {
          ...current,
          state: REVENUE_AUTOPILOT_JOB_STATES.DEFINITE_FAILURE,
          nextAttemptAtISO: "",
          lastOutcome: "definite_failure",
          outcomeReason: tenantDate !== current.dueTenantDate
            ? "confirmed_not_sent_outside_occurrence"
            : "confirmed_not_sent_attempt_limit",
          completedAtISO: now
        }
      };
    }
    return {
      action: "retry_same_occurrence",
      resumable: true,
      job: {
        ...current,
        state: REVENUE_AUTOPILOT_JOB_STATES.RETRY_WAIT,
        nextAttemptAtISO: now,
        lastOutcome: "ambiguous",
        outcomeReason: "provider_confirmed_not_sent",
        lastError: ""
      }
    };
  }

  const normalizedProvider = text(provider, 64).toLowerCase();
  const normalizedProviderMessageId = normalizeProviderMessageId(providerMessageId);
  const acceptedAtISO = requireISO(
    providerAcceptedAtISO,
    "Revenue Autopilot provider-acceptance resolution"
  );
  if (
    !normalizedProvider
    || !normalizedProviderMessageId
    || acceptedAtISO > now
    || (current.lastAttemptAtISO && acceptedAtISO < current.lastAttemptAtISO)
  ) {
    throw new RevenueAutopilotError(
      "failed-precondition",
      "Provider-acceptance resolution evidence is incomplete or outside the attempted delivery window."
    );
  }
  return {
    action: "wait_for_provider_event",
    resumable: false,
    job: {
      ...current,
      state: REVENUE_AUTOPILOT_JOB_STATES.PROVIDER_ACCEPTED,
      provider: normalizedProvider,
      providerMessageId: normalizedProviderMessageId,
      providerAcceptedAtISO: acceptedAtISO,
      nextAttemptAtISO: "",
      lastOutcome: "provider_accepted",
      outcomeReason: "provider_acceptance_reconciled",
      lastError: "",
      completedAtISO: ""
    }
  };
}

function recordRevenueAutopilotProviderAcceptance({
  job,
  provider,
  providerMessageId,
  nowISO
} = {}) {
  const current = normalizeRevenueAutopilotJob(job);
  const normalizedProvider = text(provider, 64).toLowerCase();
  const normalizedMessageId = normalizeProviderMessageId(providerMessageId);
  const acceptedAtISO = requireISO(nowISO, "Revenue Autopilot provider acceptance");
  if (!normalizedProvider || !normalizedMessageId) {
    throw new RevenueAutopilotError(
      "failed-precondition",
      "Provider acceptance requires provider and message identities."
    );
  }
  if (current.state === REVENUE_AUTOPILOT_JOB_STATES.PROVIDER_ACCEPTED) {
    if (current.provider !== normalizedProvider || current.providerMessageId !== normalizedMessageId) {
      throw new RevenueAutopilotError("aborted", "Provider acceptance identity changed during retry.");
    }
    return { idempotent: true, job: current };
  }
  if (current.state !== REVENUE_AUTOPILOT_JOB_STATES.SENDING) {
    throw new RevenueAutopilotError(
      "failed-precondition",
      "Provider acceptance requires one currently claimed job."
    );
  }
  return {
    idempotent: false,
    job: {
      ...current,
      state: REVENUE_AUTOPILOT_JOB_STATES.PROVIDER_ACCEPTED,
      provider: normalizedProvider,
      providerMessageId: normalizedMessageId,
      providerAcceptedAtISO: acceptedAtISO,
      leaseExpiresAtISO: "",
      nextAttemptAtISO: "",
      lastOutcome: "provider_accepted",
      outcomeReason: "provider_accepted",
      lastError: "",
      completedAtISO: ""
    }
  };
}

function recordRevenueAutopilotProviderEvent({ job, event, nowISO } = {}) {
  const current = normalizeRevenueAutopilotJob(job);
  const observedAtISO = requireISO(nowISO, "Revenue Autopilot provider event");
  if (
    !record(event)
    || text(event.source, 64).toLowerCase() !== "verified_provider_webhook"
    || event.signatureVerified !== true
    || !text(event.eventId, 160)
    || text(event.provider, 64).toLowerCase() !== current.provider
    || normalizeProviderMessageId(event.providerMessageId) !== current.providerMessageId
  ) {
    throw new RevenueAutopilotError(
      "failed-precondition",
      "Provider event must be verified and match the accepted provider message."
    );
  }
  if (![
    REVENUE_AUTOPILOT_JOB_STATES.PROVIDER_ACCEPTED,
    REVENUE_AUTOPILOT_JOB_STATES.DELIVERED,
    REVENUE_AUTOPILOT_JOB_STATES.BOUNCED,
    REVENUE_AUTOPILOT_JOB_STATES.COMPLAINED
  ].includes(current.state)) {
    throw new RevenueAutopilotError(
      "failed-precondition",
      "Provider delivery evidence requires prior provider acceptance."
    );
  }
  const eventId = text(event.eventId, 160);
  if (current.providerEventIds.includes(eventId)) {
    return { idempotent: true, suppressionRecommended: false, job: current };
  }
  const eventType = text(event.type, 32).toLowerCase();
  if (!new Set(["delivered", "bounced", "complained"]).has(eventType)) {
    throw new RevenueAutopilotError(
      "invalid-argument",
      "Only delivered, bounced, or complained provider evidence is supported; provider events never establish customer viewing."
    );
  }
  if ([
    REVENUE_AUTOPILOT_JOB_STATES.BOUNCED,
    REVENUE_AUTOPILOT_JOB_STATES.COMPLAINED
  ].includes(current.state)) {
    return {
      idempotent: false,
      ignored: true,
      suppressionRecommended: true,
      suppressionReason: current.state === REVENUE_AUTOPILOT_JOB_STATES.BOUNCED
        ? "provider_bounce"
        : "provider_complaint",
      job: current
    };
  }
  const providerEventIds = [...current.providerEventIds, eventId].slice(-MAX_PROVIDER_EVENT_IDS);
  const providerOccurredAtISO = normalizeISO(event.occurredAtISO) || observedAtISO;
  if (
    providerOccurredAtISO > observedAtISO
    || providerOccurredAtISO < current.providerAcceptedAtISO
  ) {
    throw new RevenueAutopilotError(
      "failed-precondition",
      "Provider event time is outside the accepted message evidence window."
    );
  }
  if (eventType === "delivered") {
    return {
      idempotent: false,
      suppressionRecommended: false,
      job: {
        ...current,
        state: REVENUE_AUTOPILOT_JOB_STATES.DELIVERED,
        deliveredAtISO: current.deliveredAtISO
          || providerOccurredAtISO,
        completedAtISO: observedAtISO,
        lastOutcome: "delivered",
        outcomeReason: "provider_delivery_webhook",
        providerEventIds
      }
    };
  }
  const terminalAtISO = providerOccurredAtISO;
  return {
    idempotent: false,
    suppressionRecommended: true,
    suppressionReason: eventType === "bounced" ? "provider_bounce" : "provider_complaint",
    job: {
      ...current,
      state: eventType === "bounced"
        ? REVENUE_AUTOPILOT_JOB_STATES.BOUNCED
        : REVENUE_AUTOPILOT_JOB_STATES.COMPLAINED,
      ...(eventType === "bounced"
        ? { bouncedAtISO: terminalAtISO }
        : { complainedAtISO: terminalAtISO }),
      completedAtISO: observedAtISO,
      lastOutcome: eventType,
      outcomeReason: eventType === "bounced" ? "provider_bounce_webhook" : "provider_complaint_webhook",
      providerEventIds
    }
  };
}

module.exports = {
  DEFAULT_MAX_ATTEMPTS,
  DEFAULT_RETRY_DELAYS_MS,
  FINAL_BALANCE_REMINDER_DAYS,
  OUTBOUND_REVENUE_AUTOPILOT_KINDS,
  REVENUE_AUTOPILOT_ATTRIBUTION_WINDOW_DAYS,
  REVENUE_AUTOPILOT_JOB_STATES,
  REVENUE_AUTOPILOT_KINDS,
  RevenueAutopilotError,
  buildRevenueAutopilotAttributionProjection,
  buildRevenueAutopilotJobIdentity,
  buildRevenueAutopilotOccurrences,
  buildRevenueAutopilotScopeKey,
  claimRevenueAutopilotJob,
  classifyRevenueAutopilotDispatchError,
  evaluateRevenueAutopilotQuoteActivity,
  evaluateQuietHours,
  evaluateRevenueAutopilotGates,
  evaluateRevenueAutopilotStopEvidence,
  normalizeRevenueAutopilotJob,
  planRevenueAutopilotDispatchFailure,
  planRevenueAutopilotExecution,
  planRevenueAutopilotMaterialization,
  planRevenueAutopilotOutcomeResolution,
  planUnreadCustomerReplyAttention,
  recordRevenueAutopilotProviderAcceptance,
  recordRevenueAutopilotProviderEvent,
  tenantCalendarContext
};
