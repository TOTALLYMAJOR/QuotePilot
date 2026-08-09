export const REVENUE_AUTOPILOT_PREVIEW_VERSION = 1;

export const REVENUE_AUTOPILOT_KINDS = Object.freeze([
  "quote_follow_up",
  "deposit_reminder",
  "final_balance_reminder",
  "unread_customer_reply"
]);

export const FINAL_BALANCE_REMINDER_DAYS = Object.freeze([14, 7, 3]);

export const REVENUE_AUTOPILOT_PROOF_BOUNDARIES = Object.freeze([
  "This is a deterministic, read-only eligibility preview. It sends, writes, and schedules nothing.",
  "Provider configuration does not prove dispatch, provider acceptance, delivery, inbox placement, or customer action.",
  "Payment stops require matching verified-webhook or settled-ledger evidence. They do not establish accounting revenue or recovered revenue.",
  "Message bodies, portal tokens, payment links, and provider credentials are excluded from this projection."
]);

const DATE_ONLY_PATTERN = /^\d{4}-\d{2}-\d{2}$/;
const IDENTIFIER_PATTERN = /^[A-Za-z0-9][A-Za-z0-9_.:@-]{0,255}$/;
const EMAIL_PATTERN = /^[^@\s]+@[^@\s]+$/;
const PAYMENT_STATES = new Set(["prepared", "sent", "processing", "paid", "failed", "expired"]);
const QUOTE_STATUSES = new Set([
  "draft",
  "sent",
  "viewed",
  "accepted",
  "booked",
  "declined",
  "expired",
  "deleted"
]);

function text(value) {
  return String(value ?? "").trim();
}

function isRecord(value) {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}

function safeIdentifier(value) {
  const normalized = text(value);
  if (!IDENTIFIER_PATTERN.test(normalized) || EMAIL_PATTERN.test(normalized)) return "";
  return normalized;
}

function safeReference(value) {
  const normalized = text(value);
  return IDENTIFIER_PATTERN.test(normalized) ? normalized : "";
}

function validDateOnly(value) {
  const raw = text(value);
  if (!DATE_ONLY_PATTERN.test(raw)) return "";
  const parsed = new Date(`${raw}T00:00:00.000Z`);
  return Number.isNaN(parsed.getTime()) || parsed.toISOString().slice(0, 10) !== raw
    ? ""
    : raw;
}

function validTimeZone(value) {
  const requested = text(value);
  if (!requested) return "";
  try {
    return new Intl.DateTimeFormat("en-US", { timeZone: requested })
      .resolvedOptions()
      .timeZone;
  } catch {
    return "";
  }
}

function normalizedISO(value) {
  const raw = text(value);
  if (!/^\d{4}-\d{2}-\d{2}T/.test(raw) || !/(?:Z|[+-]\d{2}:\d{2})$/i.test(raw)) {
    return "";
  }
  const parsed = new Date(raw);
  return Number.isNaN(parsed.getTime()) ? "" : parsed.toISOString();
}

function deepFreeze(value) {
  if (!value || typeof value !== "object" || Object.isFrozen(value)) return value;
  Object.freeze(value);
  Object.values(value).forEach(deepFreeze);
  return value;
}

function reason(code, message, category = "evidence") {
  return { code, message, category };
}

function normalizeCalendarContext(calendarContext) {
  if (!isRecord(calendarContext)) {
    throw new TypeError("Explicit tenant calendar context is required for revenue autopilot preview.");
  }
  const date = validDateOnly(calendarContext.date);
  const source = text(calendarContext.source).toLowerCase();
  const timeZone = validTimeZone(calendarContext.timeZone);
  if (!date) {
    throw new TypeError("calendarContext.date must be a valid YYYY-MM-DD tenant calendar date.");
  }
  if (source !== "tenant") {
    throw new TypeError("calendarContext.source must be tenant for revenue autopilot preview.");
  }
  if (!timeZone) {
    throw new TypeError("calendarContext.timeZone must be an explicit valid IANA tenant time zone.");
  }
  return { date, source, timeZone, label: "Tenant-local calendar date" };
}

function calendarSerial(value) {
  const date = validDateOnly(value);
  return date ? Date.parse(`${date}T00:00:00.000Z`) / 86400000 : null;
}

function calendarDaysBetween(earlier, later) {
  const earlierSerial = calendarSerial(earlier);
  const laterSerial = calendarSerial(later);
  if (earlierSerial === null || laterSerial === null) return null;
  return laterSerial - earlierSerial;
}

function uniqueNormalizedISO(values) {
  return [...new Set(values.map(normalizedISO).filter(Boolean))];
}

function uniqueText(values) {
  return [...new Set(values.map(text).filter(Boolean))];
}

function quoteIdentity(quote, organizationId) {
  const quoteId = safeIdentifier(quote?.id || quote?.quoteId);
  const quoteOrganizationId = safeIdentifier(quote?.organizationId);
  if (!quoteId) throw new TypeError("A valid quote identity is required for revenue autopilot preview.");
  if (!organizationId || quoteOrganizationId !== organizationId) {
    throw new TypeError("The quote must match the explicit revenue autopilot organization scope.");
  }
  return { quoteId, organizationId };
}

function portalBinding(quote) {
  const delivery = isRecord(quote?.workflow?.quoteDelivery) ? quote.workflow.quoteDelivery : {};
  const projected = isRecord(quote?.deliveryEvidence) ? quote.deliveryEvidence : {};
  const revisions = uniqueText([delivery.revisionId, projected.revisionId]);
  const issuedValues = uniqueNormalizedISO([
    delivery.portalIssuedAtISO,
    projected.portalIssuedAtISO,
    quote?.portalIssuedAtISO
  ]);
  if (revisions.length > 1 || issuedValues.length > 1) {
    return { error: reason(
      "portal_binding_ambiguous",
      "The quote contains conflicting active portal revision or issuance evidence."
    ) };
  }
  const issuedAtISO = issuedValues[0] || "";
  const activeVersionId = safeIdentifier(quote?.activeVersionId || quote?.versionMeta?.versionId);
  const revisionId = revisions[0]
    || (activeVersionId && issuedAtISO ? `${activeVersionId}@${issuedAtISO}` : activeVersionId);
  if (!revisionId || !issuedAtISO) {
    return { error: reason(
      "portal_binding_missing",
      "The active portal revision and issuance must be identified before follow-up eligibility can be evaluated."
    ) };
  }
  if (
    activeVersionId
    && revisionId !== activeVersionId
    && revisionId !== `${activeVersionId}@${issuedAtISO}`
  ) {
    return { error: reason(
      "portal_binding_stale",
      "The active quote version does not match the recorded portal revision."
    ) };
  }
  return { revisionId, issuedAtISO };
}

function expectedPortalStateTime(quote, state) {
  const lifecycle = isRecord(quote?.lifecycle) ? quote.lifecycle : {};
  const receipt = isRecord(quote?.acceptanceReceipt) ? quote.acceptanceReceipt : {};
  const decision = isRecord(quote?.portalDecision) ? quote.portalDecision : {};
  const booking = isRecord(quote?.booking) ? quote.booking : {};
  const values = state === "sent"
    ? [lifecycle.sentAtISO]
    : state === "viewed"
      ? [lifecycle.viewedAtISO]
      : state === "accepted"
        ? [lifecycle.acceptedAtISO, receipt.acceptedAtISO, decision.decision === "accepted" ? decision.submittedAtISO : ""]
        : state === "booked"
          ? [lifecycle.bookedAtISO, booking.bookedAtISO, booking.contractConvertedAtISO]
          : state === "declined"
            ? [lifecycle.declinedAtISO, decision.decision === "declined" ? decision.submittedAtISO : ""]
            : [];
  const normalized = uniqueNormalizedISO(values);
  if (normalized.length !== 1) return "";
  return normalized[0];
}

function portalStateCompatible(quoteStatus, portalState) {
  if (portalState === "sent") return quoteStatus === "sent";
  if (portalState === "viewed") return quoteStatus === "viewed";
  if (portalState === "accepted") return quoteStatus === "accepted";
  if (portalState === "booked") return quoteStatus === "booked";
  if (portalState === "declined") return quoteStatus === "declined";
  return false;
}

function evaluatePortalEvidence({ quote, identity, calendar, evidence }) {
  const records = Array.isArray(evidence?.portalProjections) ? evidence.portalProjections : null;
  if (!records) {
    return { error: reason(
      "portal_evidence_missing",
      "A current customer-portal projection snapshot is required."
    ) };
  }
  if (records.length !== 1) {
    return { error: reason(
      records.length ? "portal_evidence_ambiguous" : "portal_evidence_missing",
      records.length
        ? "More than one portal projection was supplied for this quote."
        : "A current customer-portal projection snapshot is required."
    ) };
  }
  const record = records[0];
  if (
    !isRecord(record)
    || text(record.source).toLowerCase() !== "customer_portal_projection"
    || safeIdentifier(record.organizationId) !== identity.organizationId
    || safeIdentifier(record.quoteId) !== identity.quoteId
  ) {
    return { error: reason(
      "portal_evidence_scope_mismatch",
      "The portal projection does not match this quote and organization."
    ) };
  }
  if (validDateOnly(record.observedForDate) !== calendar.date) {
    return { error: reason(
      "portal_evidence_stale",
      "The portal projection was not observed for the current tenant calendar date."
    ) };
  }
  const binding = portalBinding(quote);
  if (binding.error) return binding;
  const state = text(record.state).toLowerCase();
  const stateAtISO = normalizedISO(record.stateAtISO);
  const quoteStatus = text(quote?.status).toLowerCase();
  if (
    !new Set(["sent", "viewed", "accepted", "booked", "declined"]).has(state)
    || !safeReference(record.revisionId)
    || safeReference(record.revisionId) !== binding.revisionId
    || normalizedISO(record.portalIssuedAtISO) !== binding.issuedAtISO
    || !stateAtISO
  ) {
    return { error: reason(
      "portal_evidence_incomplete",
      "The portal projection is missing exact current-revision state evidence."
    ) };
  }
  if (!QUOTE_STATUSES.has(quoteStatus) || !portalStateCompatible(quoteStatus, state)) {
    return { error: reason(
      "portal_evidence_conflict",
      "The portal projection state conflicts with the canonical quote state."
    ) };
  }
  const expectedStateAtISO = expectedPortalStateTime(quote, state);
  if (!expectedStateAtISO || expectedStateAtISO !== stateAtISO) {
    return { error: reason(
      "portal_evidence_stale",
      "The portal state timestamp does not match the canonical quote evidence."
    ) };
  }
  if (state === "booked") {
    const acceptedAtISO = normalizedISO(record.acceptedAtISO);
    const acceptedRevisionId = safeReference(record.acceptedRevisionId);
    const expectedAcceptedAtISO = expectedPortalStateTime(quote, "accepted");
    if (
      !acceptedAtISO
      || !acceptedRevisionId
      || !expectedAcceptedAtISO
      || acceptedAtISO !== expectedAcceptedAtISO
      || acceptedRevisionId !== binding.revisionId
    ) {
      return { error: reason(
        "portal_acceptance_binding_missing",
        "The booked portal projection must retain exact accepted-revision evidence."
      ) };
    }
    return {
      record: {
        state,
        revisionId: binding.revisionId,
        stateAtISO,
        acceptanceEstablished: true,
        acceptedAtISO
      }
    };
  }
  return {
    record: {
      state,
      revisionId: binding.revisionId,
      stateAtISO,
      acceptanceEstablished: state === "accepted",
      acceptedAtISO: state === "accepted" ? stateAtISO : ""
    }
  };
}

function evaluatePaymentWebhookSnapshot({ quote, identity, calendar, evidence }) {
  const snapshot = evidence?.paymentWebhookSnapshot;
  if (!isRecord(snapshot)) {
    return { error: reason(
      "payment_webhook_snapshot_missing",
      "A current verified-payment-webhook snapshot is required."
    ) };
  }
  if (
    text(snapshot.source).toLowerCase() !== "verified_provider_webhooks"
    || safeIdentifier(snapshot.organizationId) !== identity.organizationId
    || safeIdentifier(snapshot.quoteId) !== identity.quoteId
  ) {
    return { error: reason(
      "payment_webhook_scope_mismatch",
      "The payment webhook snapshot does not match this quote and organization."
    ) };
  }
  if (validDateOnly(snapshot.observedForDate) !== calendar.date) {
    return { error: reason(
      "payment_webhook_snapshot_stale",
      "The verified-payment-webhook snapshot is not current for the tenant calendar date."
    ) };
  }
  if (!Array.isArray(snapshot.events)) {
    return { error: reason(
      "payment_webhook_snapshot_incomplete",
      "The verified-payment-webhook snapshot does not declare its bounded event set."
    ) };
  }
  const events = [];
  for (const event of snapshot.events) {
    if (text(event?.paymentKind).toLowerCase() !== "deposit") continue;
    const providerState = text(event?.providerState).toLowerCase();
    const processedAtISO = normalizedISO(event?.processedAtISO);
    const providerReference = safeIdentifier(event?.providerReference);
    if (
      !safeIdentifier(event?.evidenceId)
      || !new Set(["paid", "refunded"]).has(providerState)
      || event?.signatureVerified !== true
      || text(event?.processingState).toLowerCase() !== "processed"
      || !providerReference
      || !processedAtISO
    ) {
      return { error: reason(
        "payment_webhook_evidence_incomplete",
        "A deposit webhook fact is missing verified processing, provider reference, or timestamp evidence."
      ) };
    }
    events.push({ providerState, providerReference, processedAtISO });
  }
  events.sort((left, right) => left.processedAtISO.localeCompare(right.processedAtISO));
  const latest = events.at(-1) || null;
  if (
    latest
    && events.filter((event) => event.processedAtISO === latest.processedAtISO).length > 1
  ) {
    return { error: reason(
      "payment_webhook_evidence_ambiguous",
      "Multiple deposit webhook facts compete as the latest provider observation."
    ) };
  }

  const payment = isRecord(quote?.payment) ? quote.payment : {};
  const depositStatus = text(payment.depositStatus || "unpaid").toLowerCase();
  if (!new Set(["unpaid", "sent", "paid", "refunded"]).has(depositStatus)) {
    return { error: reason(
      "deposit_state_invalid",
      "The canonical deposit state is not recognized."
    ) };
  }
  const settled = new Set(["paid", "refunded"]).has(depositStatus);
  if (!settled && latest) {
    return { error: reason(
      "deposit_webhook_conflict",
      "Verified settled deposit evidence conflicts with the canonical unsettled deposit state."
    ) };
  }
  if (settled && !latest) {
    return { error: reason(
      "deposit_settlement_unverified",
      "The stored paid or refunded deposit state has no matching verified webhook fact."
    ) };
  }
  if (settled) {
    const storedReference = safeIdentifier(payment.stripeSessionId);
    const storedAtISO = depositStatus === "paid"
      ? normalizedISO(payment.depositConfirmedAtISO)
      : normalizedISO(payment.depositRefundedAtISO || payment.refundedAtISO);
    if (
      latest.providerState !== depositStatus
      || !storedReference
      || latest.providerReference !== storedReference
      || !storedAtISO
      || latest.processedAtISO !== storedAtISO
    ) {
      return { error: reason(
        "deposit_webhook_stale",
        "The latest verified deposit webhook does not exactly match the stored settlement state."
      ) };
    }
  }
  return { depositStatus, latest };
}

function normalizeLedgerEntry(entry) {
  const state = text(entry?.state).toLowerCase();
  const amountCents = Number(entry?.amountCents);
  return {
    operationId: safeIdentifier(entry?.operationId),
    paymentKind: text(entry?.paymentKind).toLowerCase(),
    amountCents: Number.isSafeInteger(amountCents) && amountCents > 0 ? amountCents : null,
    state,
    providerReference: safeIdentifier(entry?.providerReference),
    providerSettledAtISO: normalizedISO(entry?.providerSettledAtISO)
  };
}

function ledgerEntriesEqual(leftEntries, rightEntries) {
  const normalize = (entries) => entries.map(normalizeLedgerEntry);
  return JSON.stringify(normalize(leftEntries)) === JSON.stringify(normalize(rightEntries));
}

function evaluatePaymentLedger({ quote, identity, calendar, evidence }) {
  const records = Array.isArray(evidence?.paymentLedgers) ? evidence.paymentLedgers : null;
  if (!records || records.length !== 1) {
    return { error: reason(
      records?.length ? "payment_ledger_ambiguous" : "payment_ledger_missing",
      records?.length
        ? "More than one canonical payment-ledger snapshot was supplied."
        : "A current canonical payment-ledger snapshot is required."
    ) };
  }
  const record = records[0];
  if (
    !isRecord(record)
    || text(record.source).toLowerCase() !== "canonical_payment_ledger"
    || safeIdentifier(record.organizationId) !== identity.organizationId
    || safeIdentifier(record.quoteId) !== identity.quoteId
  ) {
    return { error: reason(
      "payment_ledger_scope_mismatch",
      "The payment ledger does not match this quote and organization."
    ) };
  }
  if (validDateOnly(record.observedForDate) !== calendar.date) {
    return { error: reason(
      "payment_ledger_stale",
      "The payment ledger was not observed for the current tenant calendar date."
    ) };
  }
  if (Number(record.version) !== 1 || !Array.isArray(record.entries)) {
    return { error: reason(
      "payment_ledger_invalid",
      "The canonical payment ledger version or bounded entry set is invalid."
    ) };
  }
  const entries = record.entries.map(normalizeLedgerEntry);
  if (entries.some((entry) => (
    !entry.operationId
    || !new Set(["deposit", "final_balance"]).has(entry.paymentKind)
    || entry.amountCents === null
    || !PAYMENT_STATES.has(entry.state)
    || (["sent", "processing", "paid"].includes(entry.state) && !entry.providerReference)
    || (entry.state === "paid" && !entry.providerSettledAtISO)
  ))) {
    return { error: reason(
      "payment_ledger_invalid",
      "A payment-ledger entry is incomplete or invalid."
    ) };
  }
  const quoteLedger = quote?.payment?.ledger;
  if (
    quoteLedger != null
    && (
      Number(quoteLedger?.version) !== 1
      || !Array.isArray(quoteLedger?.entries)
      || !ledgerEntriesEqual(quoteLedger.entries, record.entries)
    )
  ) {
    return { error: reason(
      "payment_ledger_stale",
      "The supplied payment-ledger snapshot does not match the canonical quote ledger."
    ) };
  }
  return { entries };
}

function controlEvidenceId(value) {
  return safeIdentifier(value);
}

function currentControlRecord(record, calendar, code, label) {
  if (!isRecord(record)) {
    return reason(`${code}_missing`, `${label} evidence is required before any automation can be eligible.`, "control");
  }
  if (!controlEvidenceId(record.evidenceId)) {
    return reason(`${code}_incomplete`, `${label} evidence is missing a stable identity.`, "control");
  }
  if (validDateOnly(record.evaluatedForDate) !== calendar.date) {
    return reason(`${code}_stale`, `${label} evidence is not current for the tenant calendar date.`, "control");
  }
  return null;
}

function evaluateControls(controls, kind, calendar) {
  const findings = [];
  const stopped = [];
  const source = isRecord(controls) ? controls : {};

  const consent = source.consent;
  if (!isRecord(consent) || !controlEvidenceId(consent.evidenceId) || !normalizedISO(consent.recordedAtISO)) {
    findings.push(reason(
      "consent_evidence_missing",
      "Recorded email consent evidence is required before any automation can be eligible.",
      "control"
    ));
  } else if (text(consent.channel).toLowerCase() !== "email") {
    findings.push(reason("consent_channel_mismatch", "Consent is not scoped to the email channel.", "control"));
  } else if (["denied", "revoked"].includes(text(consent.state).toLowerCase())) {
    stopped.push(reason("consent_not_granted", "Email consent is denied or revoked.", "control"));
  } else if (text(consent.state).toLowerCase() !== "granted") {
    findings.push(reason("consent_evidence_ambiguous", "Email consent state is not unambiguous.", "control"));
  } else if (consent.recordedAtISO.slice(0, 10) > calendar.date) {
    findings.push(reason("consent_evidence_stale", "Email consent has a future recorded timestamp.", "control"));
  }

  const unsubscribe = source.unsubscribe;
  const unsubscribeIssue = currentControlRecord(unsubscribe, calendar, "unsubscribe_evidence", "Unsubscribe");
  if (unsubscribeIssue) findings.push(unsubscribeIssue);
  else if (text(unsubscribe.state).toLowerCase() === "unsubscribed") {
    stopped.push(reason("recipient_unsubscribed", "The recipient is unsubscribed from email reminders.", "control"));
  } else if (text(unsubscribe.state).toLowerCase() !== "subscribed") {
    findings.push(reason("unsubscribe_evidence_ambiguous", "Unsubscribe state is not unambiguous.", "control"));
  }

  const suppression = source.suppression;
  const suppressionIssue = currentControlRecord(suppression, calendar, "suppression_evidence", "Suppression");
  if (suppressionIssue) findings.push(suppressionIssue);
  else if (text(suppression.state).toLowerCase() === "suppressed") {
    stopped.push(reason("recipient_suppressed", "The recipient is present on the current suppression list.", "control"));
  } else if (text(suppression.state).toLowerCase() !== "clear") {
    findings.push(reason("suppression_evidence_ambiguous", "Suppression state is not unambiguous.", "control"));
  }

  const quietHours = source.quietHours;
  const quietHoursIssue = currentControlRecord(quietHours, calendar, "quiet_hours_evidence", "Quiet-hours");
  if (quietHoursIssue) findings.push(quietHoursIssue);
  else if (validTimeZone(quietHours.timeZone) !== calendar.timeZone) {
    findings.push(reason("quiet_hours_timezone_mismatch", "Quiet-hours evidence does not use the tenant time zone.", "control"));
  } else if (text(quietHours.state).toLowerCase() === "inside_quiet_hours") {
    findings.push(reason("quiet_hours_active", "The tenant quiet-hours policy currently blocks outbound contact.", "control"));
  } else if (text(quietHours.state).toLowerCase() !== "clear") {
    findings.push(reason("quiet_hours_evidence_ambiguous", "Quiet-hours state is not unambiguous.", "control"));
  }

  const template = isRecord(source.templates) ? source.templates[kind] : null;
  const templateIssue = currentControlRecord(template, calendar, "template_evidence", "Template configuration");
  if (templateIssue) findings.push(templateIssue);
  else if (
    text(template.channel).toLowerCase() !== "email"
    || !safeIdentifier(template.templateId)
    || !safeIdentifier(template.version)
  ) {
    findings.push(reason("template_evidence_incomplete", "The email template identity or version is incomplete.", "control"));
  } else if (text(template.state).toLowerCase() !== "active") {
    findings.push(reason("template_not_active", "The required tenant-branded email template is not active.", "control"));
  }

  const provider = source.provider;
  const providerIssue = currentControlRecord(provider, calendar, "provider_configuration", "Provider configuration");
  if (providerIssue) findings.push(providerIssue);
  else if (
    text(provider.channel).toLowerCase() !== "email"
    || !safeIdentifier(provider.providerId)
    || !safeIdentifier(provider.configurationId)
  ) {
    findings.push(reason("provider_configuration_incomplete", "The email provider configuration identity is incomplete.", "control"));
  } else if (text(provider.state).toLowerCase() !== "configured") {
    findings.push(reason("provider_not_configured", "The email provider is not configured for this tenant.", "control"));
  }

  if (stopped.length) return { state: "stopped", reasons: [...stopped, ...findings], template };
  if (findings.length) return { state: "blocked", reasons: findings, template };
  return { state: "clear", reasons: [], template };
}

function quoteFollowUpCore({ quote, identity, calendar, evidence }) {
  const portal = evaluatePortalEvidence({ quote, identity, calendar, evidence });
  if (portal.error) return { state: "blocked", reasons: [portal.error], scopeKey: "portal-unresolved" };
  if (portal.record.state === "viewed") {
    return {
      state: "stopped",
      reasons: [reason("portal_view_recorded", "Quote follow-up stops because an exact portal view is recorded.", "stop")],
      scopeKey: portal.record.revisionId
    };
  }
  if (["accepted", "booked"].includes(portal.record.state)) {
    return {
      state: "stopped",
      reasons: [reason("portal_acceptance_recorded", "Quote follow-up stops because exact portal acceptance is recorded.", "stop")],
      scopeKey: portal.record.revisionId
    };
  }
  if (portal.record.state === "declined") {
    return {
      state: "stopped",
      reasons: [reason("portal_decline_recorded", "Quote follow-up stops because an exact portal decline is recorded.", "stop")],
      scopeKey: portal.record.revisionId
    };
  }
  return {
    state: "eligible",
    reasons: [],
    scopeKey: portal.record.revisionId
  };
}

function acceptanceEstablished(quote, portal) {
  if (portal?.record?.acceptanceEstablished !== true) return false;
  const receipt = isRecord(quote?.acceptanceReceipt) ? quote.acceptanceReceipt : {};
  const receiptId = safeIdentifier(receipt.receiptId);
  const receiptRevision = safeReference(receipt.quoteRevisionId);
  const receiptAtISO = normalizedISO(receipt.acceptedAtISO);
  return Boolean(
    receiptId
    && receiptRevision === portal.record.revisionId
    && receiptAtISO === portal.record.acceptedAtISO
  );
}

function depositReminderCore({ quote, identity, calendar, evidence }) {
  const portal = evaluatePortalEvidence({ quote, identity, calendar, evidence });
  if (portal.error) return { state: "blocked", reasons: [portal.error], scopeKey: "acceptance-unresolved" };
  if (!acceptanceEstablished(quote, portal)) {
    return {
      state: portal.record.state === "declined" ? "stopped" : "blocked",
      reasons: [reason(
        portal.record.state === "declined" ? "quote_declined" : "acceptance_evidence_missing",
        portal.record.state === "declined"
          ? "Deposit reminders stop because the proposal was declined."
          : "Deposit reminders require exact accepted-revision and acceptance-receipt evidence.",
        portal.record.state === "declined" ? "stop" : "evidence"
      )],
      scopeKey: portal.record.revisionId
    };
  }
  const depositAmount = Number(quote?.totals?.deposit);
  const depositCents = Math.round(depositAmount * 100);
  if (!Number.isFinite(depositAmount) || depositAmount < 0 || !Number.isSafeInteger(depositCents)) {
    return {
      state: "blocked",
      reasons: [reason("deposit_scope_invalid", "The accepted quote deposit requirement is missing or invalid.")],
      scopeKey: portal.record.revisionId
    };
  }
  if (depositCents === 0) {
    return {
      state: "stopped",
      reasons: [reason("deposit_not_required", "This accepted quote has no positive deposit requirement.", "stop")],
      scopeKey: portal.record.revisionId
    };
  }
  const webhook = evaluatePaymentWebhookSnapshot({ quote, identity, calendar, evidence });
  if (webhook.error) {
    return { state: "blocked", reasons: [webhook.error], scopeKey: portal.record.revisionId };
  }
  if (webhook.depositStatus === "paid") {
    return {
      state: "stopped",
      reasons: [reason("deposit_paid_webhook_confirmed", "Deposit reminders stop because matching webhook-confirmed payment is recorded.", "stop")],
      scopeKey: portal.record.revisionId
    };
  }
  if (webhook.depositStatus === "refunded") {
    return {
      state: "stopped",
      reasons: [reason("deposit_refund_webhook_confirmed", "Deposit reminders stop because matching webhook-confirmed refund evidence is recorded.", "stop")],
      scopeKey: portal.record.revisionId
    };
  }
  return { state: "eligible", reasons: [], scopeKey: portal.record.revisionId };
}

function finalBalanceReminderCore({ quote, identity, calendar, evidence }) {
  if (text(quote?.status).toLowerCase() !== "booked") {
    return {
      state: "blocked",
      reasons: [reason("booking_evidence_missing", "Final-balance reminders require a booked quote with authoritative contract evidence.")],
      scopeKey: "booking-unresolved"
    };
  }
  if (
    !safeIdentifier(quote?.booking?.contractNumber)
    || !normalizedISO(quote?.booking?.contractConvertedAtISO)
  ) {
    return {
      state: "blocked",
      reasons: [reason("contract_evidence_missing", "Final-balance reminders require a recorded contract number and conversion timestamp.")],
      scopeKey: "contract-unresolved"
    };
  }
  const portal = evaluatePortalEvidence({ quote, identity, calendar, evidence });
  if (portal.error || !acceptanceEstablished(quote, portal)) {
    return {
      state: "blocked",
      reasons: [portal.error || reason("acceptance_evidence_missing", "Final-balance reminders require exact accepted-revision evidence.")],
      scopeKey: "acceptance-unresolved"
    };
  }
  const webhook = evaluatePaymentWebhookSnapshot({ quote, identity, calendar, evidence });
  if (webhook.error) {
    return { state: "blocked", reasons: [webhook.error], scopeKey: "deposit-unresolved" };
  }
  if (webhook.depositStatus !== "paid") {
    return {
      state: "blocked",
      reasons: [reason("deposit_not_settled", "Final-balance reminders require matching webhook-confirmed paid deposit evidence.")],
      scopeKey: "deposit-unsettled"
    };
  }
  const ledger = evaluatePaymentLedger({ quote, identity, calendar, evidence });
  if (ledger.error) return { state: "blocked", reasons: [ledger.error], scopeKey: "ledger-unresolved" };

  const totalCents = Math.round(Number(quote?.totals?.total) * 100);
  const depositCents = Math.round(Number(quote?.totals?.deposit) * 100);
  const expectedFinalCents = totalCents - depositCents;
  const finalBalance = isRecord(quote?.payment?.finalBalance) ? quote.payment.finalBalance : {};
  const amountCents = Number(finalBalance.amountCents);
  const finalStatus = text(finalBalance.status || "unpaid").toLowerCase();
  if (
    !Number.isSafeInteger(totalCents)
    || !Number.isSafeInteger(depositCents)
    || !Number.isSafeInteger(expectedFinalCents)
    || expectedFinalCents <= 0
    || !Number.isSafeInteger(amountCents)
    || amountCents !== expectedFinalCents
    || !new Set(["unpaid", "sent", "paid"]).has(finalStatus)
  ) {
    return {
      state: "blocked",
      reasons: [reason("final_balance_scope_invalid", "The final-balance amount or stored state does not match authoritative quote totals.")],
      scopeKey: "balance-unresolved"
    };
  }

  const finalEntries = ledger.entries.filter((entry) => entry.paymentKind === "final_balance");
  const paidEntries = finalEntries.filter((entry) => entry.state === "paid");
  const activeEntries = finalEntries.filter((entry) => ["prepared", "sent", "processing"].includes(entry.state));
  if (paidEntries.length > 1 || activeEntries.length > 1 || (paidEntries.length && activeEntries.length)) {
    return {
      state: "blocked",
      reasons: [reason("final_balance_rail_ambiguous", "The payment ledger contains competing final-balance rails.")],
      scopeKey: "rail-ambiguous"
    };
  }
  if (finalStatus === "paid") {
    const settled = paidEntries[0];
    if (
      !settled
      || settled.amountCents !== amountCents
      || settled.providerReference !== safeIdentifier(finalBalance.stripeSessionId)
      || settled.providerSettledAtISO !== normalizedISO(finalBalance.confirmedAtISO)
    ) {
      return {
        state: "blocked",
        reasons: [reason("final_balance_settlement_mismatch", "Stored final-balance payment does not match one settled canonical ledger rail.")],
        scopeKey: "rail-mismatch"
      };
    }
    return {
      state: "stopped",
      reasons: [reason("final_balance_settled", "Final-balance reminders stop because the stored payment matches one settled canonical ledger rail.", "stop")],
      scopeKey: settled.operationId
    };
  }
  if (paidEntries.length) {
    return {
      state: "blocked",
      reasons: [reason("final_balance_settlement_stale", "A settled ledger rail conflicts with the stored unsettled final-balance state.")],
      scopeKey: "rail-stale"
    };
  }
  if (finalStatus === "sent" && activeEntries.length !== 1) {
    return {
      state: "blocked",
      reasons: [reason("final_balance_active_rail_missing", "The sent final-balance state does not match one active canonical ledger rail.")],
      scopeKey: "rail-missing"
    };
  }
  if (
    finalStatus === "sent"
    && (
      activeEntries[0].amountCents !== amountCents
      || activeEntries[0].providerReference !== safeIdentifier(finalBalance.stripeSessionId)
    )
  ) {
    return {
      state: "blocked",
      reasons: [reason("final_balance_active_rail_mismatch", "The sent final-balance state does not match its active canonical ledger rail.")],
      scopeKey: "rail-mismatch"
    };
  }
  if (finalStatus === "unpaid" && activeEntries.length) {
    return {
      state: "blocked",
      reasons: [reason("final_balance_active_rail_stale", "An active ledger rail conflicts with the stored unpaid final-balance state.")],
      scopeKey: "rail-stale"
    };
  }

  const eventDate = validDateOnly(quote?.event?.date);
  if (!eventDate) {
    return {
      state: "blocked",
      reasons: [reason("event_date_missing", "A valid event date is required for final-balance reminder windows.")],
      scopeKey: "event-date-unresolved"
    };
  }
  const daysUntilEvent = calendarDaysBetween(calendar.date, eventDate);
  if (!FINAL_BALANCE_REMINDER_DAYS.includes(daysUntilEvent)) {
    return {
      state: "not_due",
      reasons: [reason(
        daysUntilEvent < 0 ? "event_passed" : "outside_final_balance_window",
        daysUntilEvent < 0
          ? "The recorded event date has passed."
          : "Today is outside the event-minus-14, event-minus-7, and event-minus-3 reminder windows.",
        "timing"
      )],
      scopeKey: `${eventDate}:outside-window`,
      window: null,
      daysUntilEvent
    };
  }
  return {
    state: "eligible",
    reasons: [],
    scopeKey: `${eventDate}:event-minus-${daysUntilEvent}`,
    window: `event_minus_${daysUntilEvent}`,
    daysUntilEvent
  };
}

function unreadCustomerReplyCore({ quote, identity, calendar, evidence }) {
  const records = Array.isArray(evidence?.conversationSnapshots) ? evidence.conversationSnapshots : null;
  if (!records || records.length !== 1) {
    return {
      state: "blocked",
      reasons: [reason(
        records?.length ? "conversation_evidence_ambiguous" : "conversation_evidence_missing",
        records?.length
          ? "More than one conversation-attention snapshot was supplied."
          : "A current quote conversation-attention snapshot is required."
      )],
      scopeKey: "conversation-unresolved"
    };
  }
  const record = records[0];
  if (
    !isRecord(record)
    || text(record.source).toLowerCase() !== "quote_conversation_attention_state"
    || safeIdentifier(record.organizationId) !== identity.organizationId
    || safeIdentifier(record.quoteId) !== identity.quoteId
  ) {
    return {
      state: "blocked",
      reasons: [reason("conversation_evidence_scope_mismatch", "The conversation-attention snapshot does not match this quote and organization.")],
      scopeKey: "conversation-scope-mismatch"
    };
  }
  if (validDateOnly(record.observedForDate) !== calendar.date) {
    return {
      state: "blocked",
      reasons: [reason("conversation_evidence_stale", "The conversation-attention snapshot is not current for the tenant calendar date.")],
      scopeKey: "conversation-stale"
    };
  }
  const summary = isRecord(quote?.conversationSummary) ? quote.conversationSummary : null;
  const messageCount = Number(summary?.messageCount);
  const latestMessageId = safeIdentifier(summary?.latestMessageId);
  const latestMessageAtISO = normalizedISO(summary?.latestMessageAtISO);
  const latestActorType = text(summary?.latestActorType).toLowerCase();
  if (
    !summary
    || !Number.isSafeInteger(messageCount)
    || messageCount < 0
    || (messageCount > 0 && (
      !latestMessageId
      || !latestMessageAtISO
      || !new Set(["staff", "customer"]).has(latestActorType)
    ))
  ) {
    return {
      state: "blocked",
      reasons: [reason("conversation_summary_incomplete", "The canonical quote conversation summary is incomplete.")],
      scopeKey: "conversation-summary-incomplete"
    };
  }
  if (
    Number(record.messageCount) !== messageCount
    || safeIdentifier(record.latestMessageId) !== latestMessageId
    || normalizedISO(record.latestMessageAtISO) !== latestMessageAtISO
    || text(record.latestActorType).toLowerCase() !== latestActorType
  ) {
    return {
      state: "blocked",
      reasons: [reason("conversation_evidence_stale", "The conversation-attention snapshot does not match the latest canonical conversation summary.")],
      scopeKey: latestMessageId
    };
  }
  if (messageCount === 0) {
    return {
      state: "not_due",
      reasons: [reason("conversation_empty", "No customer conversation message is recorded for escalation.", "timing")],
      scopeKey: "conversation-empty"
    };
  }
  const evaluatedMessageId = safeIdentifier(record.evaluatedMessageId);
  const acknowledgementState = text(record.staffAcknowledgementState).toLowerCase();
  if (
    evaluatedMessageId !== latestMessageId
    || !new Set(["acknowledged", "unacknowledged"]).has(acknowledgementState)
  ) {
    return {
      state: "blocked",
      reasons: [reason("conversation_acknowledgement_state_incomplete", "Staff acknowledgement state is not bound to the latest conversation message.")],
      scopeKey: latestMessageId
    };
  }
  if (latestActorType !== "customer") {
    if (acknowledgementState === "unacknowledged") {
      return {
        state: "blocked",
        reasons: [reason("conversation_acknowledgement_state_conflict", "Unacknowledged-customer state conflicts with a latest message not authored by the customer.")],
        scopeKey: latestMessageId
      };
    }
    return {
      state: "stopped",
      reasons: [reason("latest_reply_not_customer", "No unread customer reply is eligible because the latest message was not from the customer.", "stop")],
      scopeKey: latestMessageId
    };
  }
  if (acknowledgementState === "acknowledged") {
    const staffAcknowledgedAtISO = normalizedISO(record.staffAcknowledgedAtISO);
    if (!staffAcknowledgedAtISO || staffAcknowledgedAtISO < latestMessageAtISO) {
      return {
        state: "blocked",
        reasons: [reason("conversation_acknowledgement_stale", "The staff acknowledgement does not follow the latest customer message.")],
        scopeKey: latestMessageId
      };
    }
    return {
      state: "stopped",
      reasons: [reason("customer_reply_acknowledged", "Unread-reply escalation stops because staff manually acknowledged the latest customer message. This is not read evidence.", "stop")],
      scopeKey: latestMessageId
    };
  }
  if (text(record.staffAcknowledgedAtISO)) {
    return {
      state: "blocked",
      reasons: [reason("conversation_unacknowledged_evidence_conflict", "Unacknowledged state conflicts with a recorded staff acknowledgement timestamp.")],
      scopeKey: latestMessageId
    };
  }
  return { state: "eligible", reasons: [], scopeKey: latestMessageId };
}

function jobDescriptor({ identity, kind, scopeKey, template }) {
  const templateId = safeIdentifier(template?.templateId) || "template-unresolved";
  const templateVersion = safeIdentifier(template?.version) || "version-unresolved";
  const segments = [
    `revenue-autopilot-preview-v${REVENUE_AUTOPILOT_PREVIEW_VERSION}`,
    identity.organizationId,
    identity.quoteId,
    kind,
    safeReference(scopeKey) || "scope-unresolved",
    templateId,
    templateVersion
  ];
  const key = segments.map((segment) => encodeURIComponent(segment)).join(":");
  return {
    identity: key,
    kind,
    sourceQuoteId: identity.quoteId,
    template: { id: templateId, version: templateVersion },
    idempotency: {
      namespace: `revenue-autopilot-preview-v${REVENUE_AUTOPILOT_PREVIEW_VERSION}`,
      key,
      claimState: "not_claimed",
      persisted: false
    },
    executable: false,
    executionState: "preview_only"
  };
}

function finalizeEvaluation({ kind, label, core, controls, identity }) {
  const gate = evaluateControls(controls, kind, controls.calendar);
  let state = core.state;
  let reasons = [...core.reasons];
  if (state === "eligible") {
    if (gate.state === "clear") {
      reasons = [reason(
        "eligible_for_review",
        "All required source and control evidence is present for a reviewed, non-sending preview.",
        "eligibility"
      )];
    } else {
      state = gate.state;
      reasons = gate.reasons;
    }
  }
  return {
    kind,
    label,
    state,
    eligible: state === "eligible",
    ...(core.window ? { window: core.window } : {}),
    ...(Number.isFinite(core.daysUntilEvent) ? { daysUntilEvent: core.daysUntilEvent } : {}),
    reasons,
    summary: reasons[0]?.message || "Eligibility was not established.",
    job: jobDescriptor({
      identity,
      kind,
      scopeKey: core.scopeKey,
      template: gate.template
    })
  };
}

export function buildRevenueAutopilotPreview({
  organizationId,
  quote,
  calendarContext,
  controls,
  evidence
} = {}) {
  const orgId = safeIdentifier(organizationId);
  if (!orgId) throw new TypeError("A valid organizationId is required for revenue autopilot preview.");
  if (!isRecord(quote)) throw new TypeError("A canonical quote record is required for revenue autopilot preview.");
  const calendar = normalizeCalendarContext(calendarContext);
  const identity = quoteIdentity(quote, orgId);
  const controlInput = { ...(isRecord(controls) ? controls : {}), calendar };
  const context = { quote, identity, calendar, evidence: isRecord(evidence) ? evidence : {} };
  const evaluations = [
    finalizeEvaluation({
      kind: "quote_follow_up",
      label: "Quote follow-up",
      core: quoteFollowUpCore(context),
      controls: controlInput,
      identity
    }),
    finalizeEvaluation({
      kind: "deposit_reminder",
      label: "Deposit reminder",
      core: depositReminderCore(context),
      controls: controlInput,
      identity
    }),
    finalizeEvaluation({
      kind: "final_balance_reminder",
      label: "Final-balance reminder",
      core: finalBalanceReminderCore(context),
      controls: controlInput,
      identity
    }),
    finalizeEvaluation({
      kind: "unread_customer_reply",
      label: "Unread customer reply escalation",
      core: unreadCustomerReplyCore(context),
      controls: controlInput,
      identity
    })
  ];
  const counts = evaluations.reduce((result, evaluation) => {
    result[evaluation.state] = (result[evaluation.state] || 0) + 1;
    return result;
  }, {});

  return deepFreeze({
    version: REVENUE_AUTOPILOT_PREVIEW_VERSION,
    mode: "read_only_preview",
    organizationId: identity.organizationId,
    quoteId: identity.quoteId,
    calendarContext: calendar,
    proofBoundaries: REVENUE_AUTOPILOT_PROOF_BOUNDARIES,
    sideEffects: {
      sends: false,
      writes: false,
      schedules: false,
      idempotencyClaims: false
    },
    bounds: {
      quoteCount: 1,
      evaluationCount: evaluations.length,
      maximumEvaluationCount: REVENUE_AUTOPILOT_KINDS.length
    },
    counts,
    evaluations
  });
}
