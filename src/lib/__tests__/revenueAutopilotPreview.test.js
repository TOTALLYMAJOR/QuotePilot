import { describe, expect, test } from "vitest";
import {
  FINAL_BALANCE_REMINDER_DAYS,
  REVENUE_AUTOPILOT_KINDS,
  buildRevenueAutopilotPreview
} from "../revenueAutopilotPreview";

const ORGANIZATION_ID = "org-1";
const QUOTE_ID = "quote-1";
const CALENDAR_DATE = "2026-08-10";
const PORTAL_ISSUED_AT_ISO = "2026-08-01T12:00:00.000Z";
const PORTAL_STATE_AT_ISO = "2026-08-02T12:00:00.000Z";
const REVISION_ID = `v0002@${PORTAL_ISSUED_AT_ISO}`;
const DEPOSIT_SETTLED_AT_ISO = "2026-08-03T12:00:00.000Z";
const FINAL_SETTLED_AT_ISO = "2026-08-04T12:00:00.000Z";
const BOOKED_AT_ISO = "2026-08-03T15:00:00.000Z";

function calendarContext(overrides = {}) {
  return {
    date: CALENDAR_DATE,
    source: "tenant",
    timeZone: "America/Chicago",
    ...overrides
  };
}

function controls(overrides = {}) {
  const templates = Object.fromEntries(REVENUE_AUTOPILOT_KINDS.map((kind) => [kind, {
    state: "active",
    channel: "email",
    evidenceId: `template-evidence-${kind}`,
    templateId: `tenant-${kind}`,
    version: "v1",
    evaluatedForDate: CALENDAR_DATE,
    body: "PRIVATE TEMPLATE BODY"
  }]));
  return {
    consent: {
      state: "granted",
      channel: "email",
      evidenceId: "consent-1",
      recordedAtISO: "2026-01-01T12:00:00.000Z"
    },
    unsubscribe: {
      state: "subscribed",
      evidenceId: "unsubscribe-1",
      evaluatedForDate: CALENDAR_DATE
    },
    suppression: {
      state: "clear",
      evidenceId: "suppression-1",
      evaluatedForDate: CALENDAR_DATE
    },
    quietHours: {
      state: "clear",
      evidenceId: "quiet-hours-1",
      evaluatedForDate: CALENDAR_DATE,
      timeZone: "America/Chicago"
    },
    templates,
    provider: {
      state: "configured",
      channel: "email",
      providerId: "resend",
      configurationId: "tenant-email-primary",
      evidenceId: "provider-config-1",
      evaluatedForDate: CALENDAR_DATE,
      apiKey: "PROVIDER_SECRET_MUST_NOT_LEAK"
    },
    ...overrides
  };
}

function quoteForPortalState(state = "sent", overrides = {}) {
  const status = state === "sent"
    ? "sent"
    : state === "viewed"
      ? "viewed"
      : state;
  const lifecycle = {
    sentAtISO: PORTAL_STATE_AT_ISO,
    ...(state === "viewed" ? { viewedAtISO: PORTAL_STATE_AT_ISO } : {}),
    ...(state === "accepted" ? { acceptedAtISO: PORTAL_STATE_AT_ISO } : {}),
    ...(state === "declined" ? { declinedAtISO: PORTAL_STATE_AT_ISO } : {})
  };
  const portalDecision = ["accepted", "declined"].includes(state)
    ? { decision: state, submittedAtISO: PORTAL_STATE_AT_ISO }
    : {};
  const acceptanceReceipt = state === "accepted"
    ? {
        receiptId: "acceptance-1",
        quoteRevisionId: REVISION_ID,
        acceptedAtISO: PORTAL_STATE_AT_ISO
      }
    : null;
  return {
    id: QUOTE_ID,
    organizationId: ORGANIZATION_ID,
    status,
    activeVersionId: "v0002",
    portalKey: "PORTAL_TOKEN_MUST_NOT_LEAK",
    portalIssuedAtISO: PORTAL_ISSUED_AT_ISO,
    lifecycle,
    portalDecision,
    ...(acceptanceReceipt ? { acceptanceReceipt } : {}),
    workflow: {
      quoteDelivery: {
        revisionId: REVISION_ID,
        portalIssuedAtISO: PORTAL_ISSUED_AT_ISO
      }
    },
    totals: { total: 1000, deposit: 250 },
    event: { date: "2026-08-24" },
    payment: {
      depositStatus: "unpaid",
      finalBalance: {
        amountCents: 75000,
        status: "unpaid"
      },
      ledger: { version: 1, entries: [] }
    },
    conversationSummary: { messageCount: 0 },
    ...overrides
  };
}

function portalProjection(state = "sent", overrides = {}) {
  return {
    source: "customer_portal_projection",
    organizationId: ORGANIZATION_ID,
    quoteId: QUOTE_ID,
    state,
    revisionId: REVISION_ID,
    portalIssuedAtISO: PORTAL_ISSUED_AT_ISO,
    stateAtISO: PORTAL_STATE_AT_ISO,
    observedForDate: CALENDAR_DATE,
    portalToken: "PORTAL_PROJECTION_TOKEN_MUST_NOT_LEAK",
    ...overrides
  };
}

function paymentWebhookSnapshot(events = [], overrides = {}) {
  return {
    source: "verified_provider_webhooks",
    organizationId: ORGANIZATION_ID,
    quoteId: QUOTE_ID,
    observedForDate: CALENDAR_DATE,
    events,
    ...overrides
  };
}

function depositWebhook(providerState, overrides = {}) {
  return {
    evidenceId: `webhook-${providerState}`,
    paymentKind: "deposit",
    providerState,
    signatureVerified: true,
    processingState: "processed",
    providerReference: "cs_test_deposit_1",
    processedAtISO: providerState === "paid"
      ? DEPOSIT_SETTLED_AT_ISO
      : "2026-08-05T12:00:00.000Z",
    ...overrides
  };
}

function paymentLedger(entries = [], overrides = {}) {
  return {
    source: "canonical_payment_ledger",
    organizationId: ORGANIZATION_ID,
    quoteId: QUOTE_ID,
    observedForDate: CALENDAR_DATE,
    version: 1,
    entries,
    ...overrides
  };
}

function conversationSnapshot(overrides = {}) {
  return {
    source: "quote_conversation_read_state",
    organizationId: ORGANIZATION_ID,
    quoteId: QUOTE_ID,
    observedForDate: CALENDAR_DATE,
    messageCount: 0,
    latestMessageId: "",
    latestMessageAtISO: "",
    latestActorType: "",
    evaluatedMessageId: "",
    staffReadState: "read",
    staffReadAtISO: "",
    body: "PRIVATE CUSTOMER MESSAGE MUST NOT LEAK",
    ...overrides
  };
}

function evidenceFor(state = "sent", overrides = {}) {
  return {
    portalProjections: [portalProjection(state)],
    paymentWebhookSnapshot: paymentWebhookSnapshot(),
    paymentLedgers: [paymentLedger()],
    conversationSnapshots: [conversationSnapshot()],
    ...overrides
  };
}

function build({ quote = quoteForPortalState(), evidence = evidenceFor(), policy = controls(), context = calendarContext() } = {}) {
  return buildRevenueAutopilotPreview({
    organizationId: ORGANIZATION_ID,
    quote,
    calendarContext: context,
    controls: policy,
    evidence
  });
}

function evaluation(preview, kind) {
  return preview.evaluations.find((item) => item.kind === kind);
}

function acceptedQuote(overrides = {}) {
  return quoteForPortalState("accepted", overrides);
}

function paidDepositEntry() {
  return {
    operationId: "deposit-operation-1",
    paymentKind: "deposit",
    amountCents: 25000,
    state: "paid",
    providerReference: "cs_test_deposit_1",
    providerSettledAtISO: DEPOSIT_SETTLED_AT_ISO
  };
}

function bookedQuote({ eventDate = "2026-08-24", finalBalance = {}, ledgerEntries = [paidDepositEntry()] } = {}) {
  return acceptedQuote({
    status: "booked",
    lifecycle: {
      sentAtISO: PORTAL_STATE_AT_ISO,
      acceptedAtISO: PORTAL_STATE_AT_ISO,
      bookedAtISO: BOOKED_AT_ISO
    },
    event: { date: eventDate },
    booking: {
      contractNumber: "CON-1001",
      contractConvertedAtISO: BOOKED_AT_ISO
    },
    payment: {
      depositStatus: "paid",
      stripeSessionId: "cs_test_deposit_1",
      depositConfirmedAtISO: DEPOSIT_SETTLED_AT_ISO,
      finalBalance: {
        amountCents: 75000,
        status: "unpaid",
        ...finalBalance
      },
      ledger: { version: 1, entries: ledgerEntries }
    }
  });
}

function bookedEvidence(quote, overrides = {}) {
  return evidenceFor("booked", {
    portalProjections: [portalProjection("booked", {
      stateAtISO: BOOKED_AT_ISO,
      acceptedAtISO: PORTAL_STATE_AT_ISO,
      acceptedRevisionId: REVISION_ID
    })],
    paymentWebhookSnapshot: paymentWebhookSnapshot([depositWebhook("paid")]),
    paymentLedgers: [paymentLedger(quote.payment.ledger.entries)],
    ...overrides
  });
}

describe("revenue autopilot read-only preview", () => {
  test("returns a deterministic bounded quote follow-up preview and leaks no outbound content or secrets", () => {
    const first = build();
    const second = build();
    const followUp = evaluation(first, "quote_follow_up");
    const serialized = JSON.stringify(first);

    expect(first).toEqual(second);
    expect(Object.isFrozen(first)).toBe(true);
    expect(first.mode).toBe("read_only_preview");
    expect(first.bounds).toEqual({ quoteCount: 1, evaluationCount: 4, maximumEvaluationCount: 4 });
    expect(first.sideEffects).toEqual({
      sends: false,
      writes: false,
      schedules: false,
      idempotencyClaims: false
    });
    expect(followUp).toMatchObject({
      state: "eligible",
      eligible: true,
      job: {
        executable: false,
        executionState: "preview_only",
        idempotency: { claimState: "not_claimed", persisted: false }
      }
    });
    expect(followUp.job.identity).toBe(second.evaluations[0].job.identity);
    expect(serialized).not.toContain("PRIVATE TEMPLATE BODY");
    expect(serialized).not.toContain("PRIVATE CUSTOMER MESSAGE");
    expect(serialized).not.toContain("PORTAL_TOKEN_MUST_NOT_LEAK");
    expect(serialized).not.toContain("PORTAL_PROJECTION_TOKEN_MUST_NOT_LEAK");
    expect(serialized).not.toContain("PROVIDER_SECRET_MUST_NOT_LEAK");
    expect(first.proofBoundaries.join(" ")).toContain("sends, writes, and schedules nothing");
    expect(first.proofBoundaries.join(" ")).toContain("do not establish accounting revenue or recovered revenue");
  });

  test.each([
    ["viewed", "portal_view_recorded"],
    ["accepted", "portal_acceptance_recorded"],
    ["declined", "portal_decline_recorded"]
  ])("stops quote follow-up on exact %s portal evidence", (state, code) => {
    const preview = build({
      quote: quoteForPortalState(state),
      evidence: evidenceFor(state)
    });

    expect(evaluation(preview, "quote_follow_up")).toMatchObject({
      state: "stopped",
      eligible: false,
      reasons: [{ code }]
    });
  });

  test("requires exact acceptance before a deposit reminder becomes eligible", () => {
    const sent = build();
    const accepted = build({
      quote: acceptedQuote(),
      evidence: evidenceFor("accepted")
    });

    expect(evaluation(sent, "deposit_reminder")).toMatchObject({
      state: "blocked",
      reasons: [{ code: "acceptance_evidence_missing" }]
    });
    expect(evaluation(accepted, "deposit_reminder")).toMatchObject({
      state: "eligible",
      eligible: true
    });
  });

  test("retains exact acceptance evidence when the canonical portal projection advances to booked", () => {
    const quote = bookedQuote();
    const exact = build({ quote, evidence: bookedEvidence(quote) });
    const missingAcceptanceBinding = build({
      quote,
      evidence: bookedEvidence(quote, {
        portalProjections: [portalProjection("booked", { stateAtISO: BOOKED_AT_ISO })]
      })
    });

    expect(evaluation(exact, "quote_follow_up")).toMatchObject({
      state: "stopped",
      reasons: [{ code: "portal_acceptance_recorded" }]
    });
    expect(evaluation(exact, "deposit_reminder")).toMatchObject({
      state: "stopped",
      reasons: [{ code: "deposit_paid_webhook_confirmed" }]
    });
    expect(evaluation(missingAcceptanceBinding, "final_balance_reminder")).toMatchObject({
      state: "blocked",
      reasons: [{ code: "portal_acceptance_binding_missing" }]
    });
  });

  test.each([
    ["paid", DEPOSIT_SETTLED_AT_ISO, "deposit_paid_webhook_confirmed"],
    ["refunded", "2026-08-05T12:00:00.000Z", "deposit_refund_webhook_confirmed"]
  ])("stops deposit reminders only on matching webhook-confirmed %s evidence", (status, settledAtISO, code) => {
    const quote = acceptedQuote({
      payment: {
        depositStatus: status,
        stripeSessionId: "cs_test_deposit_1",
        ...(status === "paid"
          ? { depositConfirmedAtISO: settledAtISO }
          : { depositRefundedAtISO: settledAtISO }),
        finalBalance: { amountCents: 75000, status: "unpaid" },
        ledger: { version: 1, entries: [] }
      }
    });
    const preview = build({
      quote,
      evidence: evidenceFor("accepted", {
        paymentWebhookSnapshot: paymentWebhookSnapshot([depositWebhook(status)])
      })
    });

    expect(evaluation(preview, "deposit_reminder")).toMatchObject({
      state: "stopped",
      eligible: false,
      reasons: [{ code }]
    });
  });

  test("fails closed when a stored settled deposit lacks exact verified-webhook evidence", () => {
    const quote = acceptedQuote({
      payment: {
        depositStatus: "paid",
        stripeSessionId: "cs_test_deposit_1",
        depositConfirmedAtISO: DEPOSIT_SETTLED_AT_ISO,
        finalBalance: { amountCents: 75000, status: "unpaid" },
        ledger: { version: 1, entries: [] }
      }
    });
    const preview = build({ quote, evidence: evidenceFor("accepted") });

    expect(evaluation(preview, "deposit_reminder")).toMatchObject({
      state: "blocked",
      reasons: [{ code: "deposit_settlement_unverified" }]
    });
  });

  test.each([
    [14, "2026-08-24", "event_minus_14"],
    [7, "2026-08-17", "event_minus_7"],
    [3, "2026-08-13", "event_minus_3"]
  ])("opens the exact final-balance event-minus-%i tenant-calendar-day window", (days, eventDate, window) => {
    const quote = bookedQuote({ eventDate });
    const preview = build({ quote, evidence: bookedEvidence(quote) });

    expect(FINAL_BALANCE_REMINDER_DAYS).toContain(days);
    expect(evaluation(preview, "final_balance_reminder")).toMatchObject({
      state: "eligible",
      eligible: true,
      daysUntilEvent: days,
      window
    });
  });

  test("keeps final-balance reminders not due outside 14, 7, and 3 calendar days", () => {
    const quote = bookedQuote({ eventDate: "2026-08-16" });
    const preview = build({ quote, evidence: bookedEvidence(quote) });

    expect(evaluation(preview, "final_balance_reminder")).toMatchObject({
      state: "not_due",
      eligible: false,
      daysUntilEvent: 6,
      reasons: [{ code: "outside_final_balance_window" }]
    });
  });

  test("stops final-balance reminders only when stored payment matches one settled ledger rail", () => {
    const settledEntry = {
      operationId: "final-operation-1",
      paymentKind: "final_balance",
      amountCents: 75000,
      state: "paid",
      providerReference: "cs_test_final_1",
      providerSettledAtISO: FINAL_SETTLED_AT_ISO
    };
    const quote = bookedQuote({
      finalBalance: {
        status: "paid",
        stripeSessionId: "cs_test_final_1",
        confirmedAtISO: FINAL_SETTLED_AT_ISO
      },
      ledgerEntries: [paidDepositEntry(), settledEntry]
    });
    const stopped = build({ quote, evidence: bookedEvidence(quote) });
    const mismatchQuote = bookedQuote({
      finalBalance: {
        status: "paid",
        stripeSessionId: "cs_test_different_final",
        confirmedAtISO: FINAL_SETTLED_AT_ISO
      },
      ledgerEntries: [paidDepositEntry(), settledEntry]
    });
    const mismatch = build({ quote: mismatchQuote, evidence: bookedEvidence(mismatchQuote) });

    expect(evaluation(stopped, "final_balance_reminder")).toMatchObject({
      state: "stopped",
      reasons: [{ code: "final_balance_settled" }]
    });
    expect(evaluation(mismatch, "final_balance_reminder")).toMatchObject({
      state: "blocked",
      reasons: [{ code: "final_balance_settlement_mismatch" }]
    });
  });

  test("escalates only an exact unread latest customer reply", () => {
    const summary = {
      messageCount: 3,
      latestMessageId: "message-3",
      latestMessageAtISO: "2026-08-10T14:00:00.000Z",
      latestActorType: "customer"
    };
    const quote = quoteForPortalState("sent", { conversationSummary: summary });
    const unreadEvidence = evidenceFor("sent", {
      conversationSnapshots: [conversationSnapshot({
        ...summary,
        evaluatedMessageId: "message-3",
        staffReadState: "unread"
      })]
    });
    const readEvidence = evidenceFor("sent", {
      conversationSnapshots: [conversationSnapshot({
        ...summary,
        evaluatedMessageId: "message-3",
        staffReadState: "read",
        staffReadAtISO: "2026-08-10T14:05:00.000Z"
      })]
    });

    expect(evaluation(build({ quote, evidence: unreadEvidence }), "unread_customer_reply"))
      .toMatchObject({ state: "eligible", eligible: true });
    expect(evaluation(build({ quote, evidence: readEvidence }), "unread_customer_reply"))
      .toMatchObject({
        state: "stopped",
        reasons: [{ code: "customer_reply_read" }]
      });
  });

  test("fails closed on stale, missing, and ambiguous evidence", () => {
    const missingPortal = build({
      evidence: evidenceFor("sent", { portalProjections: [] })
    });
    const stalePortal = build({
      evidence: evidenceFor("sent", {
        portalProjections: [portalProjection("sent", { observedForDate: "2026-08-09" })]
      })
    });
    const ambiguousPortal = build({
      evidence: evidenceFor("sent", {
        portalProjections: [portalProjection("sent"), portalProjection("sent")]
      })
    });
    const staleControls = controls({
      unsubscribe: {
        state: "subscribed",
        evidenceId: "unsubscribe-1",
        evaluatedForDate: "2026-08-09"
      }
    });
    const blockedByControl = build({ policy: staleControls });

    expect(evaluation(missingPortal, "quote_follow_up")).toMatchObject({
      state: "blocked",
      reasons: [{ code: "portal_evidence_missing" }]
    });
    expect(evaluation(stalePortal, "quote_follow_up")).toMatchObject({
      state: "blocked",
      reasons: [{ code: "portal_evidence_stale" }]
    });
    expect(evaluation(ambiguousPortal, "quote_follow_up")).toMatchObject({
      state: "blocked",
      reasons: [{ code: "portal_evidence_ambiguous" }]
    });
    expect(evaluation(blockedByControl, "quote_follow_up")).toMatchObject({
      state: "blocked",
      reasons: [{ code: "unsubscribe_evidence_stale" }]
    });
  });

  test("fails closed on competing webhook and payment-rail evidence", () => {
    const accepted = acceptedQuote();
    const webhookAmbiguous = build({
      quote: accepted,
      evidence: evidenceFor("accepted", {
        paymentWebhookSnapshot: paymentWebhookSnapshot([
          depositWebhook("paid"),
          depositWebhook("paid", { evidenceId: "webhook-paid-duplicate" })
        ])
      })
    });
    const finalRailOne = {
      operationId: "final-active-1",
      paymentKind: "final_balance",
      amountCents: 75000,
      state: "sent",
      providerReference: "cs_test_final_active_1",
      providerSettledAtISO: ""
    };
    const finalRailTwo = {
      ...finalRailOne,
      operationId: "final-active-2",
      providerReference: "cs_test_final_active_2"
    };
    const booked = bookedQuote({
      finalBalance: {
        status: "sent",
        stripeSessionId: "cs_test_final_active_1"
      },
      ledgerEntries: [paidDepositEntry(), finalRailOne, finalRailTwo]
    });
    const ledgerAmbiguous = build({ quote: booked, evidence: bookedEvidence(booked) });

    expect(evaluation(webhookAmbiguous, "deposit_reminder")).toMatchObject({
      state: "blocked",
      reasons: [{ code: "payment_webhook_evidence_ambiguous" }]
    });
    expect(evaluation(ledgerAmbiguous, "final_balance_reminder")).toMatchObject({
      state: "blocked",
      reasons: [{ code: "final_balance_rail_ambiguous" }]
    });
  });

  test("fails closed when conversation read evidence is stale or ambiguous", () => {
    const summary = {
      messageCount: 2,
      latestMessageId: "message-2",
      latestMessageAtISO: "2026-08-10T14:00:00.000Z",
      latestActorType: "customer"
    };
    const quote = quoteForPortalState("sent", { conversationSummary: summary });
    const stale = build({
      quote,
      evidence: evidenceFor("sent", {
        conversationSnapshots: [conversationSnapshot({
          ...summary,
          latestMessageId: "message-1",
          evaluatedMessageId: "message-1",
          staffReadState: "unread"
        })]
      })
    });
    const current = conversationSnapshot({
      ...summary,
      evaluatedMessageId: "message-2",
      staffReadState: "unread"
    });
    const ambiguous = build({
      quote,
      evidence: evidenceFor("sent", { conversationSnapshots: [current, current] })
    });

    expect(evaluation(stale, "unread_customer_reply")).toMatchObject({
      state: "blocked",
      reasons: [{ code: "conversation_evidence_stale" }]
    });
    expect(evaluation(ambiguous, "unread_customer_reply")).toMatchObject({
      state: "blocked",
      reasons: [{ code: "conversation_evidence_ambiguous" }]
    });
  });

  test.each([
    ["denied consent", (current) => ({
      ...current,
      consent: { ...current.consent, state: "revoked" }
    }), "stopped", "consent_not_granted"],
    ["unsubscribe", (current) => ({
      ...current,
      unsubscribe: { ...current.unsubscribe, state: "unsubscribed" }
    }), "stopped", "recipient_unsubscribed"],
    ["suppression", (current) => ({
      ...current,
      suppression: { ...current.suppression, state: "suppressed" }
    }), "stopped", "recipient_suppressed"],
    ["quiet hours", (current) => ({
      ...current,
      quietHours: { ...current.quietHours, state: "inside_quiet_hours" }
    }), "blocked", "quiet_hours_active"],
    ["inactive template", (current) => ({
      ...current,
      templates: {
        ...current.templates,
        quote_follow_up: { ...current.templates.quote_follow_up, state: "disabled" }
      }
    }), "blocked", "template_not_active"],
    ["unconfigured provider", (current) => ({
      ...current,
      provider: { ...current.provider, state: "unconfigured" }
    }), "blocked", "provider_not_configured"]
  ])("enforces explicit current %s controls", (_label, mutate, state, code) => {
    const preview = build({ policy: mutate(controls()) });

    expect(evaluation(preview, "quote_follow_up")).toMatchObject({
      state,
      eligible: false,
      reasons: [{ code }]
    });
  });

  test("blocks eligibility when required control inputs are absent", () => {
    const preview = build({ policy: {} });
    const followUp = evaluation(preview, "quote_follow_up");

    expect(followUp.state).toBe("blocked");
    expect(followUp.reasons.map((item) => item.code)).toEqual([
      "consent_evidence_missing",
      "unsubscribe_evidence_missing",
      "suppression_evidence_missing",
      "quiet_hours_evidence_missing",
      "template_evidence_missing",
      "provider_configuration_missing"
    ]);
  });

  test("requires explicit tenant date and IANA time-zone context", () => {
    expect(() => build({ context: calendarContext({ source: "device" }) }))
      .toThrow(/source must be tenant/i);
    expect(() => build({ context: calendarContext({ date: "2026-02-30" }) }))
      .toThrow(/valid YYYY-MM-DD/i);
    expect(() => build({ context: calendarContext({ timeZone: "Mars/Olympus" }) }))
      .toThrow(/valid IANA/i);
  });
});
