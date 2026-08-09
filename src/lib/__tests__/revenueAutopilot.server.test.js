import { createRequire } from "node:module";
import fs from "node:fs";
import { describe, expect, test } from "vitest";

const require = createRequire(import.meta.url);
const {
  REVENUE_AUTOPILOT_JOB_STATES,
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
} = require("../../../functions/revenueAutopilot.js");

const CORE_SOURCE = fs.readFileSync(
  new URL("../../../functions/revenueAutopilot.js", import.meta.url),
  "utf8"
);

const NOW = "2026-08-09T15:00:00.000Z";
const ORG_ID = "org-a";
const QUOTE_ID = "quote-a";
const REVISION_ID = "v0004@2026-08-08T17:00:00.000Z";
const PAYMENT_OPERATION_ID = "payment-operation-a";
const MESSAGE_ID = "message-a";

describe("Revenue Autopilot canonical quote activity", () => {
  test("stops deterministically when a quote is missing, deleted, or expired", () => {
    expect(evaluateRevenueAutopilotQuoteActivity({
      quoteExists: false,
      organizationId: ORG_ID,
      nowISO: NOW
    })).toMatchObject({ active: false, reason: "quote_missing" });

    expect(evaluateRevenueAutopilotQuoteActivity({
      quoteExists: true,
      quote: { organizationId: ORG_ID, deletedAtISO: "2026-08-09T14:00:00.000Z" },
      organizationId: ORG_ID,
      nowISO: NOW
    })).toMatchObject({ active: false, reason: "quote_deleted" });

    expect(evaluateRevenueAutopilotQuoteActivity({
      quoteExists: true,
      quote: { organizationId: ORG_ID, portalExpiresAtISO: NOW },
      organizationId: ORG_ID,
      nowISO: NOW
    })).toMatchObject({ active: false, reason: "portal_expired" });
  });

  test("fails closed for tenant drift or invalid expiry and remains active before expiry", () => {
    expect(evaluateRevenueAutopilotQuoteActivity({
      quoteExists: true,
      quote: { organizationId: "org-b" },
      organizationId: ORG_ID,
      nowISO: NOW
    })).toMatchObject({ active: false, reason: "quote_scope_changed" });

    expect(evaluateRevenueAutopilotQuoteActivity({
      quoteExists: true,
      quote: { organizationId: ORG_ID, portalExpiresAtISO: "not-a-time" },
      organizationId: ORG_ID,
      nowISO: NOW
    })).toMatchObject({ active: false, reason: "portal_expiry_invalid" });

    expect(evaluateRevenueAutopilotQuoteActivity({
      quoteExists: true,
      quote: { organizationId: ORG_ID, portalExpiresAtISO: "2026-08-10T15:00:00.000Z" },
      organizationId: ORG_ID,
      nowISO: NOW
    })).toEqual({ active: true, reason: "active", observedAtISO: NOW });
  });

  test("allows only the trusted post-event caller to decouple activity from portal expiry", () => {
    expect(evaluateRevenueAutopilotQuoteActivity({
      quoteExists: true,
      quote: { organizationId: ORG_ID, portalExpiresAtISO: "not-a-time" },
      organizationId: ORG_ID,
      nowISO: NOW,
      ignorePortalExpiry: true
    })).toEqual({ active: true, reason: "active", observedAtISO: NOW });

    expect(evaluateRevenueAutopilotQuoteActivity({
      quoteExists: true,
      quote: {
        organizationId: ORG_ID,
        deletedAtISO: "2026-08-09T14:00:00.000Z",
        portalExpiresAtISO: "2026-08-01T15:00:00.000Z"
      },
      organizationId: ORG_ID,
      nowISO: NOW,
      ignorePortalExpiry: true
    })).toMatchObject({ active: false, reason: "quote_deleted" });
  });
});

function policy(overrides = {}) {
  return {
    enabled: true,
    timeZone: "America/Chicago",
    quietHours: { enabled: true, start: "20:00", end: "08:00" },
    maxAttempts: 3,
    kinds: {
      quote_follow_up: { enabled: true },
      deposit_reminder: { enabled: true },
      final_balance_reminder: { enabled: true },
      unread_customer_reply: { enabled: true }
    },
    ...overrides
  };
}

function controls(overrides = {}) {
  return {
    consent: {
      evidenceId: "consent-a",
      channel: "email",
      state: "granted",
      recordedAtISO: "2026-07-01T15:00:00.000Z"
    },
    subscription: {
      evidenceId: "subscription-a",
      state: "subscribed",
      evaluatedAtISO: NOW
    },
    suppression: {
      evidenceId: "suppression-a",
      state: "clear",
      evaluatedAtISO: NOW
    },
    provider: {
      evidenceId: "provider-a",
      providerId: "resend",
      configurationId: "approved-global-sender-v1",
      state: "configured",
      evaluatedAtISO: NOW
    },
    ...overrides
  };
}

function scope(overrides = {}) {
  return {
    organizationId: ORG_ID,
    quoteId: QUOTE_ID,
    revisionId: REVISION_ID,
    paymentOperationId: PAYMENT_OPERATION_ID,
    messageId: MESSAGE_ID,
    ...overrides
  };
}

function portal(state = "sent") {
  return {
    source: "customer_portal_projection",
    organizationId: ORG_ID,
    quoteId: QUOTE_ID,
    revisionId: REVISION_ID,
    state,
    stateAtISO: state === "accepted"
      ? "2026-08-08T18:00:00.000Z"
      : "2026-08-08T17:00:00.000Z",
    ...(["booked"].includes(state)
      ? { acceptedAtISO: "2026-08-08T18:00:00.000Z" }
      : {})
  };
}

function acceptance() {
  return {
    source: "proposal_acceptance_receipt",
    organizationId: ORG_ID,
    quoteId: QUOTE_ID,
    revisionId: REVISION_ID,
    receiptId: "acceptance-a",
    acceptedAtISO: "2026-08-08T18:00:00.000Z"
  };
}

function deposit(state = "unpaid", overrides = {}) {
  return {
    source: "verified_provider_webhooks",
    organizationId: ORG_ID,
    quoteId: QUOTE_ID,
    bounded: true,
    observedAtISO: NOW,
    state,
    ...(state !== "unpaid" ? {
      signatureVerified: true,
      processingState: "processed",
      providerReference: "cs-deposit-a",
      processedAtISO: "2026-08-09T14:00:00.000Z"
    } : {}),
    ...overrides
  };
}

function finalBalance(state = "unpaid", overrides = {}) {
  return {
    source: "canonical_payment_ledger",
    organizationId: ORG_ID,
    quoteId: QUOTE_ID,
    operationId: PAYMENT_OPERATION_ID,
    observedAtISO: NOW,
    state,
    ...(["paid", "refunded"].includes(state) ? {
      providerReference: "cs-final-a",
      providerSettledAtISO: "2026-08-09T14:30:00.000Z"
    } : {}),
    ...overrides
  };
}

function conversation(overrides = {}) {
  return {
    source: "quote_conversation_attention_state",
    organizationId: ORG_ID,
    quoteId: QUOTE_ID,
    latestMessageId: MESSAGE_ID,
    latestMessageAtISO: "2026-08-09T14:45:00.000Z",
    latestActorType: "customer",
    staffAcknowledged: {},
    ...overrides
  };
}

function quoteFollowUpEvidence(state = "sent") {
  return { portal: portal(state) };
}

function depositEvidence({ portalState = "accepted", depositState = "unpaid", depositOverrides } = {}) {
  return {
    portal: portal(portalState),
    acceptance: acceptance(),
    deposit: deposit(depositState, depositOverrides)
  };
}

function finalBalanceEvidence({ finalState = "unpaid", depositState = "paid" } = {}) {
  return {
    portal: portal("booked"),
    acceptance: acceptance(),
    deposit: deposit(depositState),
    finalBalance: finalBalance(finalState)
  };
}

function template(version = "v1", fingerprint = "a".repeat(64)) {
  return {
    templateId: "quote-follow-up",
    version,
    fingerprint
  };
}

function materialize(overrides = {}) {
  return planRevenueAutopilotMaterialization({
    organizationId: ORG_ID,
    quoteId: QUOTE_ID,
    kind: "quote_follow_up",
    scopeKey: REVISION_ID,
    stopScope: scope(),
    evidence: quoteFollowUpEvidence(),
    global: { enabled: true, sendsEnabled: true },
    tenantPolicy: policy(),
    controls: controls(),
    occurrences: buildRevenueAutopilotOccurrences({
      kind: "quote_follow_up",
      timeZone: "America/Chicago",
      anchorAtISO: NOW,
      dayOffsets: [0]
    }),
    template: template(),
    policyVersion: "policy-v1",
    nowISO: NOW,
    ...overrides
  });
}

function scheduledJob() {
  const plan = materialize();
  expect(plan.state).toBe("ready");
  expect(plan.create).toHaveLength(1);
  return plan.create[0];
}

describe("Revenue Autopilot tenant calendar and occurrence identity", () => {
  test("uses the tenant calendar across UTC boundaries and DST changes", () => {
    expect(tenantCalendarContext({
      nowISO: "2026-03-09T04:30:00.000Z",
      timeZone: "America/Chicago"
    })).toMatchObject({
      date: "2026-03-08",
      localTime: "23:30",
      timeZone: "America/Chicago"
    });

    expect(tenantCalendarContext({
      nowISO: "2026-03-08T07:59:00.000Z",
      timeZone: "America/Chicago"
    }).localTime).toBe("01:59");
    expect(tenantCalendarContext({
      nowISO: "2026-03-08T08:01:00.000Z",
      timeZone: "America/Chicago"
    }).localTime).toBe("03:01");

    const firstFallHour = tenantCalendarContext({
      nowISO: "2026-11-01T06:30:00.000Z",
      timeZone: "America/Chicago"
    });
    const repeatedFallHour = tenantCalendarContext({
      nowISO: "2026-11-01T07:30:00.000Z",
      timeZone: "America/Chicago"
    });
    expect(firstFallHour).toMatchObject({ date: "2026-11-01", localTime: "01:30" });
    expect(repeatedFallHour).toMatchObject({ date: "2026-11-01", localTime: "01:30" });
  });

  test("applies wrapping quiet hours to both repeated DST hours", () => {
    const quietHours = { enabled: true, start: "20:00", end: "08:00" };
    for (const nowISO of [
      "2026-11-01T06:30:00.000Z",
      "2026-11-01T07:30:00.000Z"
    ]) {
      expect(evaluateQuietHours({
        nowISO,
        timeZone: "America/Chicago",
        quietHours
      })).toMatchObject({
        state: "deferred",
        insideQuietHours: true,
        window: { wrapsMidnight: true }
      });
    }
    expect(evaluateQuietHours({
      nowISO: "2026-11-01T15:00:00.000Z",
      timeZone: "America/Chicago",
      quietHours
    })).toMatchObject({ state: "clear", insideQuietHours: false });
  });

  test("derives tenant-date offsets instead of adding elapsed 24-hour periods", () => {
    const occurrences = buildRevenueAutopilotOccurrences({
      kind: "quote_follow_up",
      timeZone: "America/Chicago",
      anchorAtISO: "2026-03-08T05:30:00.000Z",
      dayOffsets: [0, 2]
    });
    expect(occurrences).toEqual([
      expect.objectContaining({
        occurrenceKey: "anchor_plus_0",
        anchorTenantDate: "2026-03-07",
        dueTenantDate: "2026-03-07"
      }),
      expect.objectContaining({
        occurrenceKey: "anchor_plus_2",
        anchorTenantDate: "2026-03-07",
        dueTenantDate: "2026-03-09"
      })
    ]);
    expect(buildRevenueAutopilotOccurrences({
      kind: "final_balance_reminder",
      timeZone: "America/Chicago",
      eventDate: "2026-08-23"
    })).toEqual([
      expect.objectContaining({ occurrenceKey: "event_minus_14", dueTenantDate: "2026-08-09" }),
      expect.objectContaining({ occurrenceKey: "event_minus_7", dueTenantDate: "2026-08-16" }),
      expect.objectContaining({ occurrenceKey: "event_minus_3", dueTenantDate: "2026-08-20" })
    ]);
    expect(buildRevenueAutopilotOccurrences({
      kind: "post_event_review_request",
      timeZone: "America/Chicago",
      anchorAtISO: "2026-09-10T15:00:00.000Z",
      dueDate: "2026-09-08",
      closeoutId: "closeout-a"
    })).toEqual([{
      occurrenceKey: "closeout_closeout-a",
      dueTenantDate: "2026-09-10",
      recordedDueTenantDate: "2026-09-08",
      completedTenantDate: "2026-09-10",
      closeoutId: "closeout-a"
    }]);
  });

  test("excludes template and policy versions from stable occurrence identity", () => {
    const first = buildRevenueAutopilotJobIdentity({
      organizationId: ORG_ID,
      quoteId: QUOTE_ID,
      kind: "quote_follow_up",
      scopeKey: REVISION_ID,
      occurrenceKey: "anchor_plus_2",
      templateVersion: "v1",
      policyVersion: "policy-v1"
    });
    const changedTemplate = buildRevenueAutopilotJobIdentity({
      organizationId: ORG_ID,
      quoteId: QUOTE_ID,
      kind: "quote_follow_up",
      scopeKey: REVISION_ID,
      occurrenceKey: "anchor_plus_2",
      templateVersion: "v99",
      policyVersion: "policy-v99"
    });
    const nextOccurrence = buildRevenueAutopilotJobIdentity({
      organizationId: ORG_ID,
      quoteId: QUOTE_ID,
      kind: "quote_follow_up",
      scopeKey: REVISION_ID,
      occurrenceKey: "anchor_plus_5"
    });
    expect(first).toEqual(changedTemplate);
    expect(first.jobId).toMatch(/^ra_[a-f0-9]{64}$/);
    expect(first.idempotencyKey).toMatch(/^revenue-autopilot\/[a-f0-9]{64}$/);
    expect(first.jobId).not.toBe(nextOccurrence.jobId);
  });
});

describe("Revenue Autopilot safety gates", () => {
  test("requires every global, tenant, kind, recipient, provider, and quiet-hour gate", () => {
    expect(evaluateRevenueAutopilotGates({
      global: { enabled: true, sendsEnabled: true },
      tenantPolicy: policy(),
      kind: "quote_follow_up",
      nowISO: NOW,
      controls: controls()
    })).toMatchObject({ state: "clear", eligible: true, channel: "email" });

    expect(evaluateRevenueAutopilotGates({
      global: { enabled: false, sendsEnabled: false },
      tenantPolicy: policy({ enabled: false }),
      kind: "quote_follow_up",
      nowISO: NOW,
      controls: controls({ provider: null })
    })).toMatchObject({ state: "blocked", eligible: false });
    const reasonCodes = evaluateRevenueAutopilotGates({
      global: {},
      tenantPolicy: policy({
        kinds: { ...policy().kinds, quote_follow_up: { enabled: false } }
      }),
      kind: "quote_follow_up",
      nowISO: NOW,
      controls: {}
    }).reasons.map((item) => item.code);
    expect(reasonCodes).toEqual(expect.arrayContaining([
      "global_automation_disabled",
      "global_sends_disabled",
      "automation_kind_disabled",
      "consent_evidence_missing",
      "subscription_evidence_missing",
      "suppression_evidence_missing",
      "provider_configuration_missing"
    ]));
  });

  test.each([
    ["revoked consent", { consent: { ...controls().consent, state: "revoked" } }, "consent_not_granted"],
    ["unsubscribe", { subscription: { ...controls().subscription, state: "unsubscribed" } }, "recipient_unsubscribed"],
    ["suppression", { suppression: { ...controls().suppression, state: "suppressed" } }, "recipient_suppressed"]
  ])("stops outbound email for %s", (_label, override, reason) => {
    const result = evaluateRevenueAutopilotGates({
      global: { enabled: true, sendsEnabled: true },
      tenantPolicy: policy(),
      kind: "deposit_reminder",
      nowISO: NOW,
      controls: controls(override)
    });
    expect(result).toMatchObject({ state: "stopped", eligible: false });
    expect(result.reasons.map((item) => item.code)).toContain(reason);
  });

  test("defers email in tenant quiet hours but does not apply email gates to internal Attention", () => {
    expect(evaluateRevenueAutopilotGates({
      global: { enabled: true, sendsEnabled: true },
      tenantPolicy: policy(),
      kind: "quote_follow_up",
      nowISO: "2026-08-10T03:00:00.000Z",
      controls: controls()
    })).toMatchObject({ state: "deferred", eligible: false });

    expect(evaluateRevenueAutopilotGates({
      global: { enabled: true, sendsEnabled: false },
      tenantPolicy: policy({ quietHours: null }),
      kind: "unread_customer_reply",
      nowISO: "2026-08-10T03:00:00.000Z",
      controls: {}
    })).toMatchObject({ state: "clear", eligible: true, channel: "attention" });
  });

  test("rejects future consent, provider none, and unbounded attempt policies", () => {
    const futureConsent = evaluateRevenueAutopilotGates({
      global: { enabled: true, sendsEnabled: true },
      tenantPolicy: policy(),
      kind: "quote_follow_up",
      nowISO: NOW,
      controls: controls({
        consent: {
          ...controls().consent,
          recordedAtISO: "2026-08-10T15:00:00.000Z"
        },
        provider: {
          ...controls().provider,
          providerId: "none"
        }
      })
    });
    expect(futureConsent.state).toBe("blocked");
    expect(futureConsent.reasons.map((item) => item.code)).toEqual(expect.arrayContaining([
      "consent_evidence_future",
      "provider_configuration_missing"
    ]));
    expect(() => materialize({
      tenantPolicy: policy({ maxAttempts: 99 })
    })).toThrowError(/maxAttempts must be between 1 and 5/i);
  });
});

describe("Revenue Autopilot authoritative stop evidence", () => {
  test("stops quote follow-up only on exact current-revision portal decisions", () => {
    expect(evaluateRevenueAutopilotStopEvidence({
      kind: "quote_follow_up",
      scope: scope(),
      evidence: quoteFollowUpEvidence("sent")
    })).toMatchObject({ state: "eligible", eligible: true });
    for (const state of ["viewed", "accepted", "booked", "declined"]) {
      expect(evaluateRevenueAutopilotStopEvidence({
        kind: "quote_follow_up",
        scope: scope(),
        evidence: quoteFollowUpEvidence(state)
      })).toMatchObject({ state: "stopped", eligible: false });
    }
    expect(evaluateRevenueAutopilotStopEvidence({
      kind: "quote_follow_up",
      scope: scope(),
      evidence: { portal: { ...portal("viewed"), revisionId: "v0003" } }
    })).toMatchObject({ state: "blocked", eligible: false });
  });

  test("requires acceptance and verified webhook authority for deposit stops", () => {
    expect(evaluateRevenueAutopilotStopEvidence({
      kind: "deposit_reminder",
      scope: scope(),
      evidence: depositEvidence()
    })).toMatchObject({ state: "eligible" });
    expect(evaluateRevenueAutopilotStopEvidence({
      kind: "deposit_reminder",
      scope: scope(),
      evidence: depositEvidence({ depositState: "paid" })
    })).toMatchObject({ state: "stopped" });
    expect(evaluateRevenueAutopilotStopEvidence({
      kind: "deposit_reminder",
      scope: scope(),
      evidence: depositEvidence({
        depositState: "paid",
        depositOverrides: { signatureVerified: false }
      })
    })).toMatchObject({
      state: "blocked",
      reasons: [expect.objectContaining({ code: "deposit_settlement_unverified" })]
    });
  });

  test("keeps final-balance processing, settlement, and missing authority distinct", () => {
    expect(evaluateRevenueAutopilotStopEvidence({
      kind: "final_balance_reminder",
      scope: scope(),
      evidence: finalBalanceEvidence()
    })).toMatchObject({ state: "eligible" });
    expect(evaluateRevenueAutopilotStopEvidence({
      kind: "final_balance_reminder",
      scope: scope(),
      evidence: finalBalanceEvidence({ finalState: "processing" })
    })).toMatchObject({ state: "deferred" });
    expect(evaluateRevenueAutopilotStopEvidence({
      kind: "final_balance_reminder",
      scope: scope(),
      evidence: finalBalanceEvidence({ finalState: "paid" })
    })).toMatchObject({ state: "stopped" });
    expect(evaluateRevenueAutopilotStopEvidence({
      kind: "final_balance_reminder",
      scope: scope(),
      evidence: finalBalanceEvidence({ depositState: "unpaid" })
    })).toMatchObject({
      state: "blocked",
      reasons: [expect.objectContaining({ code: "deposit_not_settled" })]
    });
    expect(evaluateRevenueAutopilotStopEvidence({
      kind: "final_balance_reminder",
      scope: scope(),
      evidence: finalBalanceEvidence({ depositState: "refunded" })
    })).toMatchObject({
      state: "stopped",
      reasons: [expect.objectContaining({ code: "deposit_refunded" })]
    });
  });

  test("binds unread status and staff acknowledgements to the exact latest customer message", () => {
    expect(evaluateRevenueAutopilotStopEvidence({
      kind: "unread_customer_reply",
      scope: scope(),
      evidence: { conversation: conversation() }
    })).toMatchObject({ state: "eligible" });
    expect(evaluateRevenueAutopilotStopEvidence({
      kind: "unread_customer_reply",
      scope: scope(),
      evidence: {
        conversation: conversation({
          staffAcknowledged: {
            latestMessageId: MESSAGE_ID,
            acknowledgedAtISO: "2026-08-09T14:46:00.000Z"
          }
        })
      }
    })).toMatchObject({ state: "stopped" });
    expect(evaluateRevenueAutopilotStopEvidence({
      kind: "unread_customer_reply",
      scope: scope(),
      evidence: {
        conversation: conversation({
          staffAcknowledged: {
            latestMessageId: MESSAGE_ID,
            acknowledgedAtISO: "2026-08-09T14:44:00.000Z"
          }
        })
      }
    })).toMatchObject({ state: "blocked" });
    expect(evaluateRevenueAutopilotStopEvidence({
      kind: "unread_customer_reply",
      scope: scope(),
      evidence: { conversation: conversation({ latestActorType: "staff" }) }
    })).toMatchObject({ state: "stopped" });
  });
});

describe("Revenue Autopilot materialization and Attention plans", () => {
  test("materializes bounded future occurrences and never backfills a missed first send", () => {
    const occurrences = buildRevenueAutopilotOccurrences({
      kind: "quote_follow_up",
      timeZone: "America/Chicago",
      anchorAtISO: "2026-08-08T15:00:00.000Z",
      dayOffsets: [0, 1, 3]
    });
    const plan = materialize({ occurrences });
    expect(plan).toMatchObject({ state: "ready" });
    expect(plan.skip).toEqual([
      expect.objectContaining({
        occurrenceKey: "anchor_plus_0",
        reason: "missed_occurrence_not_backfilled"
      })
    ]);
    expect(plan.create.map((job) => job.occurrenceKey)).toEqual([
      "anchor_plus_1",
      "anchor_plus_3"
    ]);
    expect(plan.create[0]).toMatchObject({
      state: "scheduled",
      attemptCount: 0,
      template: template(),
      policyVersion: "policy-v1"
    });
  });

  test("does not duplicate an occurrence after template changes", () => {
    const first = scheduledJob();
    const repeated = materialize({ existingJobs: [first] });
    expect(repeated).toMatchObject({ state: "ready", create: [], conflicts: [] });
    expect(repeated.keep).toHaveLength(1);

    const changed = materialize({
      existingJobs: [first],
      template: template("v2", "b".repeat(64))
    });
    expect(changed).toMatchObject({ state: "conflict", create: [] });
    expect(changed.conflicts).toEqual([
      expect.objectContaining({
        jobId: first.jobId,
        reason: "frozen_job_payload_changed",
        existingTemplate: template(),
        requestedTemplate: template("v2", "b".repeat(64))
      })
    ]);
  });

  test("rejects cross-scope materialization and retires jobs for an older authority scope", () => {
    expect(() => materialize({
      organizationId: "org-b"
    })).toThrowError(/outside the requested quote scope/i);
    expect(() => materialize({
      scopeKey: "v0003"
    })).toThrowError(/scope does not match its authoritative evidence/i);

    const current = scheduledJob();
    const staleIdentity = buildRevenueAutopilotJobIdentity({
      organizationId: ORG_ID,
      quoteId: QUOTE_ID,
      kind: "quote_follow_up",
      scopeKey: "v0003@2026-08-01T15:00:00.000Z",
      occurrenceKey: current.occurrenceKey
    });
    const stale = {
      ...current,
      ...staleIdentity,
      idempotencyKey: staleIdentity.idempotencyKey
    };
    const plan = materialize({ existingJobs: [stale] });
    expect(plan.updates).toEqual([
      expect.objectContaining({
        jobId: stale.jobId,
        state: "stopped",
        outcomeReason: "authoritative_scope_changed",
        completedAtISO: NOW
      })
    ]);
    expect(plan.create).toHaveLength(1);
  });

  test("default-disabled sends create no jobs and exact portal stops cancel active ones", () => {
    expect(materialize({
      global: { enabled: true, sendsEnabled: false }
    })).toMatchObject({ state: "blocked", create: [] });

    const first = scheduledJob();
    const stopped = materialize({
      evidence: quoteFollowUpEvidence("viewed"),
      existingJobs: [first]
    });
    expect(stopped).toMatchObject({ state: "stopped", create: [] });
    expect(stopped.updates).toEqual([
      expect.objectContaining({
        jobId: first.jobId,
        state: "stopped",
        outcomeReason: "portal_viewed_recorded"
      })
    ]);
  });

  test("creates one internal Attention item per exact unread customer message and resolves it on acknowledgement", () => {
    const initial = planUnreadCustomerReplyAttention({
      organizationId: ORG_ID,
      quoteId: QUOTE_ID,
      messageId: MESSAGE_ID,
      evidence: { conversation: conversation() },
      global: { enabled: true, sendsEnabled: false },
      tenantPolicy: policy({ quietHours: null }),
      nowISO: NOW
    });
    expect(initial).toMatchObject({
      state: "open",
      create: {
        type: "unread_customer_reply",
        state: "open",
        messageId: MESSAGE_ID
      }
    });
    const repeated = planUnreadCustomerReplyAttention({
      organizationId: ORG_ID,
      quoteId: QUOTE_ID,
      messageId: MESSAGE_ID,
      evidence: { conversation: conversation() },
      global: { enabled: true },
      tenantPolicy: policy(),
      existingAttention: initial.create,
      nowISO: "2026-08-09T15:01:00.000Z"
    });
    expect(repeated).toMatchObject({ state: "open", create: null, update: null });

    const resolved = planUnreadCustomerReplyAttention({
      organizationId: ORG_ID,
      quoteId: QUOTE_ID,
      messageId: MESSAGE_ID,
      evidence: {
        conversation: conversation({
          staffAcknowledged: {
            latestMessageId: MESSAGE_ID,
            acknowledgedAtISO: "2026-08-09T15:02:00.000Z"
          }
        })
      },
      global: { enabled: true },
      tenantPolicy: policy(),
      existingAttention: initial.create,
      nowISO: "2026-08-09T15:02:00.000Z"
    });
    expect(resolved).toMatchObject({
      state: "resolved",
      create: null,
      update: {
        attentionId: initial.create.attentionId,
        state: "resolved",
        resolutionReason: "customer_reply_acknowledged"
      }
    });
  });
});

describe("Revenue Autopilot deterministic attribution boundaries", () => {
  function deliveredJob(
    job = scheduledJob(),
    deliveredAtISO = "2026-08-09T15:02:00.000Z",
    claimAtISO = "2026-08-09T15:00:00.000Z"
  ) {
    const providerAcceptedAtISO = new Date(
      Date.parse(claimAtISO) + 60000
    ).toISOString();
    const claimed = claimRevenueAutopilotJob({
      job,
      attemptId: "attempt-attribution",
      nowISO: claimAtISO
    });
    const accepted = recordRevenueAutopilotProviderAcceptance({
      job: claimed,
      provider: "resend",
      providerMessageId: "provider-attribution-a",
      nowISO: providerAcceptedAtISO
    }).job;
    return recordRevenueAutopilotProviderEvent({
      job: accepted,
      event: {
        source: "verified_provider_webhook",
        signatureVerified: true,
        eventId: "resend-attribution-delivered-a",
        provider: "resend",
        providerMessageId: "provider-attribution-a",
        type: "delivered",
        occurredAtISO: deliveredAtISO
      },
      nowISO: deliveredAtISO
    }).job;
  }

  test("keeps booked value distinct from recovered revenue even inside the exact verified window", () => {
    const delivered = deliveredJob();
    const projection = buildRevenueAutopilotAttributionProjection({
      job: delivered,
      outcomeEvidence: {
        source: "canonical_booking_receipt",
        organizationId: ORG_ID,
        quoteId: QUOTE_ID,
        revisionId: REVISION_ID,
        receiptId: "booking-receipt-a",
        bookedAtISO: "2026-08-10T15:02:00.000Z",
        acceptedTotalCents: 1692000,
        currency: "USD"
      },
      observedAtISO: "2026-08-11T15:02:00.000Z"
    });

    expect(projection).toMatchObject({
      attributionState: "verified_temporal_association",
      reason: "verified_outcome_within_exact_window",
      window: { days: 7, matched: true },
      outcome: { type: "booking_recorded", source: "canonical_booking_receipt" },
      commercialMeasure: {
        classification: "booked_value",
        amountCents: 1692000,
        currency: "usd"
      },
      recoveredRevenue: {
        established: false,
        amountCents: null,
        reason: "temporal_association_is_not_causal_recovery"
      }
    });
    expect(projection.proofBoundary).toMatch(/not accounting revenue or recovered revenue/i);
  });

  test("requires provider delivery and exact same-scope outcome evidence", () => {
    const claimed = claimRevenueAutopilotJob({
      job: scheduledJob(),
      attemptId: "attempt-attribution",
      nowISO: NOW
    });
    const accepted = recordRevenueAutopilotProviderAcceptance({
      job: claimed,
      provider: "resend",
      providerMessageId: "provider-attribution-a",
      nowISO: "2026-08-09T15:01:00.000Z"
    }).job;
    expect(buildRevenueAutopilotAttributionProjection({
      job: accepted,
      observedAtISO: "2026-08-10T15:00:00.000Z"
    })).toMatchObject({
      attributionState: "insufficient_evidence",
      reason: "provider_delivery_not_verified",
      recoveredRevenue: { established: false, amountCents: null }
    });

    const delivered = deliveredJob();
    expect(() => buildRevenueAutopilotAttributionProjection({
      job: delivered,
      outcomeEvidence: {
        source: "proposal_acceptance_receipt",
        organizationId: "org-b",
        quoteId: QUOTE_ID,
        revisionId: REVISION_ID,
        receiptId: "acceptance-receipt-a",
        acceptedAtISO: "2026-08-10T15:00:00.000Z"
      },
      observedAtISO: "2026-08-10T16:00:00.000Z"
    })).toThrowError(/outside the exact quote scope/i);
  });

  test("reports exact money received outside the window without promoting it to recovered revenue", () => {
    const projection = buildRevenueAutopilotAttributionProjection({
      job: deliveredJob(),
      outcomeEvidence: {
        source: "verified_provider_webhook",
        organizationId: ORG_ID,
        quoteId: QUOTE_ID,
        revisionId: REVISION_ID,
        signatureVerified: true,
        processingState: "processed",
        state: "paid",
        paymentKind: "deposit",
        eventId: "stripe-payment-event-a",
        processedAtISO: "2026-08-17T15:03:00.000Z",
        amountCents: 423000,
        currency: "usd"
      },
      observedAtISO: "2026-08-17T16:00:00.000Z"
    });

    expect(projection).toMatchObject({
      attributionState: "outside_window",
      reason: "outcome_after_exact_window",
      window: { matched: false },
      commercialMeasure: {
        classification: "money_received",
        amountCents: 423000
      },
      recoveredRevenue: { established: false, amountCents: null }
    });
  });

  test("uses a bounded 30-day review window for the exact post-event closeout occurrence", () => {
    const closeoutId = "closeout_aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa";
    const scopeKey = buildRevenueAutopilotScopeKey({
      kind: "post_event_review_request",
      revisionId: REVISION_ID,
      closeoutId
    });
    const postPlan = planRevenueAutopilotMaterialization({
      organizationId: ORG_ID,
      quoteId: QUOTE_ID,
      kind: "post_event_review_request",
      scopeKey,
      stopScope: { ...scope(), closeoutId },
      evidence: {
        postEventCloseout: {
          schemaVersion: 1,
          source: "post_event_closeout_authority",
          organizationId: ORG_ID,
          quoteId: QUOTE_ID,
          revisionId: REVISION_ID,
          closeoutId,
          sourceVersionId: "v0004",
          acceptanceReceiptId: "acceptance-a",
          eventDate: "2026-09-01",
          dueDate: "2026-09-08",
          state: "completed",
          reviewItems: Object.fromEntries([
            "internal_closeout",
            "thank_you",
            "review_request",
            "operational_follow_up"
          ].map((code) => [code, {
            state: "reviewed",
            reviewedAtISO: "2026-09-08T14:00:00.000Z"
          }])),
          completedAtISO: "2026-09-08T14:00:00.000Z",
          completedBy: "server_recorded",
          updatedAtISO: "2026-09-08T14:00:00.000Z"
        }
      },
      global: { enabled: true, sendsEnabled: true },
      tenantPolicy: policy({
        kinds: {
          ...policy().kinds,
          post_event_review_request: { enabled: true }
        }
      }),
      controls: controls({
        subscription: { ...controls().subscription, evaluatedAtISO: "2026-09-08T15:00:00.000Z" },
        suppression: { ...controls().suppression, evaluatedAtISO: "2026-09-08T15:00:00.000Z" },
        provider: { ...controls().provider, evaluatedAtISO: "2026-09-08T15:00:00.000Z" }
      }),
      occurrences: buildRevenueAutopilotOccurrences({
        kind: "post_event_review_request",
        timeZone: "America/Chicago",
        anchorAtISO: "2026-09-08T14:00:00.000Z",
        dueDate: "2026-09-08",
        closeoutId
      }),
      template: {
        templateId: "post-event-review",
        version: "v1",
        fingerprint: "b".repeat(64)
      },
      policyVersion: "policy-v1",
      nowISO: "2026-09-08T15:00:00.000Z"
    });
    const delivered = deliveredJob(
      postPlan.create[0],
      "2026-09-08T15:02:00.000Z",
      "2026-09-08T15:00:00.000Z"
    );
    const projection = buildRevenueAutopilotAttributionProjection({
      job: delivered,
      outcomeEvidence: {
        source: "verified_review_receipt",
        organizationId: ORG_ID,
        quoteId: QUOTE_ID,
        closeoutId,
        receiptId: "review-receipt-a",
        reviewedAtISO: "2026-10-01T15:02:00.000Z"
      },
      observedAtISO: "2026-10-02T15:02:00.000Z"
    });

    expect(projection).toMatchObject({
      attributionState: "verified_temporal_association",
      window: { days: 30, matched: true },
      commercialMeasure: { classification: "customer_review", amountCents: null },
      recoveredRevenue: { established: false, amountCents: null }
    });
  });
});

describe("Revenue Autopilot bounded dispatch state", () => {
  test("plans execution, creates a bounded lease, and keeps one provider idempotency key", () => {
    const job = scheduledJob();
    expect(planRevenueAutopilotExecution({
      job,
      global: { enabled: true, sendsEnabled: true },
      tenantPolicy: policy(),
      controls: controls(),
      stopScope: scope(),
      evidence: quoteFollowUpEvidence(),
      nowISO: NOW
    })).toMatchObject({ action: "claim", reason: "eligible_occurrence_due" });

    const claimed = claimRevenueAutopilotJob({
      job,
      attemptId: "attempt-a",
      nowISO: NOW
    });
    expect(claimed).toMatchObject({
      state: "sending",
      attemptCount: 1,
      idempotencyKey: job.idempotencyKey,
      leaseExpiresAtISO: "2026-08-09T15:02:00.000Z"
    });
    expect(planRevenueAutopilotExecution({
      job: claimed,
      global: { enabled: true, sendsEnabled: true },
      tenantPolicy: policy(),
      controls: controls(),
      stopScope: scope(),
      evidence: quoteFollowUpEvidence(),
      nowISO: "2026-08-09T15:01:00.000Z"
    })).toMatchObject({ action: "wait", reason: "active_send_lease" });
  });

  test("persists quiet-hour deferral and permits only the next clear tenant-day rollover", () => {
    const job = scheduledJob();
    const deferred = planRevenueAutopilotExecution({
      job,
      global: { enabled: true, sendsEnabled: true },
      tenantPolicy: policy(),
      controls: controls(),
      stopScope: scope(),
      evidence: quoteFollowUpEvidence(),
      nowISO: "2026-08-10T03:00:00.000Z"
    });
    expect(deferred).toMatchObject({
      action: "wait",
      reason: "inside_quiet_hours",
      job: { quietHoursDeferredAtISO: "2026-08-10T03:00:00.000Z" }
    });
    expect(planRevenueAutopilotExecution({
      job: deferred.job,
      global: { enabled: true, sendsEnabled: true },
      tenantPolicy: policy(),
      controls: controls(),
      stopScope: scope(),
      evidence: quoteFollowUpEvidence(),
      nowISO: "2026-08-10T13:00:00.000Z"
    })).toMatchObject({ action: "claim", reason: "eligible_occurrence_due" });
    expect(planRevenueAutopilotExecution({
      job,
      global: { enabled: true, sendsEnabled: true },
      tenantPolicy: policy(),
      controls: controls(),
      stopScope: scope(),
      evidence: quoteFollowUpEvidence(),
      nowISO: "2026-08-10T13:00:00.000Z"
    })).toMatchObject({ action: "stop", reason: "missed_occurrence_not_backfilled" });
  });

  test("bounds ambiguous retries to the same tenant day and same idempotency key", () => {
    const job = scheduledJob();
    const firstClaim = claimRevenueAutopilotJob({
      job,
      attemptId: "attempt-a",
      nowISO: NOW
    });
    const retry = planRevenueAutopilotDispatchFailure({
      job: firstClaim,
      error: Object.assign(new Error("network ended without a response"), {
        revenueAutopilotOutcome: "ambiguous",
        revenueAutopilotReason: "provider_network_error"
      }),
      nowISO: "2026-08-09T15:01:00.000Z",
      retryDelaysMs: [60_000, 120_000]
    });
    expect(retry).toMatchObject({
      outcome: "ambiguous",
      resumable: true,
      requiresReconciliation: false,
      job: {
        state: "retry_wait",
        attemptCount: 1,
        nextAttemptAtISO: "2026-08-09T15:02:00.000Z",
        idempotencyKey: job.idempotencyKey
      }
    });
    const secondClaim = claimRevenueAutopilotJob({
      job: retry.job,
      attemptId: "attempt-b",
      nowISO: retry.job.nextAttemptAtISO
    });
    expect(secondClaim).toMatchObject({
      state: "sending",
      attemptCount: 2,
      idempotencyKey: job.idempotencyKey
    });

    const lateJob = {
      ...job,
      dueTenantDate: "2026-08-09"
    };
    const lateClaim = claimRevenueAutopilotJob({
      job: lateJob,
      attemptId: "attempt-late",
      nowISO: "2026-08-10T04:58:00.000Z"
    });
    expect(planRevenueAutopilotDispatchFailure({
      job: lateClaim,
      error: new Error("unknown provider outcome"),
      nowISO: "2026-08-10T04:59:00.000Z",
      retryDelaysMs: [120_000]
    })).toMatchObject({
      outcome: "ambiguous",
      resumable: false,
      requiresReconciliation: true,
      job: {
        state: "outcome_ambiguous",
        outcomeReason: "retry_window_crossed_tenant_day"
      }
    });
  });

  test("separates definite failure from ambiguous provider outcomes", () => {
    expect(classifyRevenueAutopilotDispatchError({ providerHttpStatus: 422 })).toMatchObject({
      outcome: "definite_failure",
      reason: "provider_http_422"
    });
    expect(classifyRevenueAutopilotDispatchError({ providerHttpStatus: 503 })).toMatchObject({
      outcome: "ambiguous",
      reason: "provider_http_503"
    });
    const claimed = claimRevenueAutopilotJob({
      job: scheduledJob(),
      attemptId: "attempt-a",
      nowISO: NOW
    });
    expect(planRevenueAutopilotDispatchFailure({
      job: claimed,
      error: Object.assign(new Error("recipient rejected"), { providerHttpStatus: 422 }),
      nowISO: "2026-08-09T15:01:00.000Z"
    })).toMatchObject({
      outcome: "definite_failure",
      resumable: false,
      requiresReconciliation: false,
      job: { state: "definite_failure", completedAtISO: "2026-08-09T15:01:00.000Z" }
    });
  });

  test("requires reconciliation rather than silently retrying an expired sending lease", () => {
    const claimed = claimRevenueAutopilotJob({
      job: scheduledJob(),
      attemptId: "attempt-a",
      nowISO: NOW,
      leaseMs: 60_000
    });
    expect(planRevenueAutopilotExecution({
      job: claimed,
      global: { enabled: true, sendsEnabled: true },
      tenantPolicy: policy(),
      controls: controls(),
      stopScope: scope(),
      evidence: quoteFollowUpEvidence(),
      nowISO: "2026-08-09T15:01:00.000Z"
    })).toMatchObject({
      action: "reconcile",
      reason: "expired_send_lease_provider_outcome_unknown",
      job: { state: "outcome_ambiguous" }
    });
  });

  test("reconciles provider-unknown outcomes without changing occurrence identity", () => {
    const source = scheduledJob();
    const claimed = claimRevenueAutopilotJob({
      job: source,
      attemptId: "attempt-a",
      nowISO: NOW,
      leaseMs: 60_000
    });
    const ambiguous = planRevenueAutopilotExecution({
      job: claimed,
      global: { enabled: true, sendsEnabled: true },
      tenantPolicy: policy(),
      controls: controls(),
      stopScope: scope(),
      evidence: quoteFollowUpEvidence(),
      nowISO: "2026-08-09T15:01:00.000Z"
    }).job;

    const notSent = planRevenueAutopilotOutcomeResolution({
      job: ambiguous,
      resolution: "confirmed_not_sent",
      nowISO: "2026-08-09T15:02:00.000Z"
    });
    expect(notSent).toMatchObject({
      action: "retry_same_occurrence",
      resumable: true,
      job: {
        state: "retry_wait",
        jobId: source.jobId,
        idempotencyKey: source.idempotencyKey,
        nextAttemptAtISO: "2026-08-09T15:02:00.000Z"
      }
    });

    const accepted = planRevenueAutopilotOutcomeResolution({
      job: ambiguous,
      resolution: "provider_accepted",
      provider: "resend",
      providerMessageId: "provider-message-a",
      providerAcceptedAtISO: "2026-08-09T15:00:30.000Z",
      nowISO: "2026-08-09T15:02:00.000Z"
    });
    expect(accepted).toMatchObject({
      action: "wait_for_provider_event",
      resumable: false,
      job: {
        state: "provider_accepted",
        providerAcceptedAtISO: "2026-08-09T15:00:30.000Z",
        deliveredAtISO: ""
      }
    });
  });

  test("keeps provider acceptance distinct from delivered and bounced webhook evidence", () => {
    const claimed = claimRevenueAutopilotJob({
      job: scheduledJob(),
      attemptId: "attempt-a",
      nowISO: NOW
    });
    const accepted = recordRevenueAutopilotProviderAcceptance({
      job: claimed,
      provider: "resend",
      providerMessageId: "provider-message-a",
      nowISO: "2026-08-09T15:01:00.000Z"
    });
    expect(accepted).toMatchObject({
      idempotent: false,
      job: {
        state: "provider_accepted",
        providerAcceptedAtISO: "2026-08-09T15:01:00.000Z",
        deliveredAtISO: "",
        bouncedAtISO: "",
        completedAtISO: ""
      }
    });

    const delivered = recordRevenueAutopilotProviderEvent({
      job: accepted.job,
      event: {
        source: "verified_provider_webhook",
        signatureVerified: true,
        eventId: "resend-event-delivered-a",
        provider: "resend",
        providerMessageId: "provider-message-a",
        type: "delivered",
        occurredAtISO: "2026-08-09T15:02:00.000Z"
      },
      nowISO: "2026-08-09T15:02:01.000Z"
    });
    expect(delivered).toMatchObject({
      suppressionRecommended: false,
      job: {
        state: "delivered",
        deliveredAtISO: "2026-08-09T15:02:00.000Z"
      }
    });
    expect(recordRevenueAutopilotProviderEvent({
      job: delivered.job,
      event: {
        source: "verified_provider_webhook",
        signatureVerified: true,
        eventId: "resend-event-delivered-a",
        provider: "resend",
        providerMessageId: "provider-message-a",
        type: "delivered"
      },
      nowISO: "2026-08-09T15:03:00.000Z"
    })).toMatchObject({ idempotent: true });

    const bounced = recordRevenueAutopilotProviderEvent({
      job: accepted.job,
      event: {
        source: "verified_provider_webhook",
        signatureVerified: true,
        eventId: "resend-event-bounced-a",
        provider: "resend",
        providerMessageId: "provider-message-a",
        type: "bounced"
      },
      nowISO: "2026-08-09T15:03:00.000Z"
    });
    expect(bounced).toMatchObject({
      suppressionRecommended: true,
      suppressionReason: "provider_bounce",
      job: { state: "bounced", bouncedAtISO: "2026-08-09T15:03:00.000Z" }
    });
    expect(recordRevenueAutopilotProviderEvent({
      job: bounced.job,
      event: {
        source: "verified_provider_webhook",
        signatureVerified: true,
        eventId: "resend-event-late-delivered-a",
        provider: "resend",
        providerMessageId: "provider-message-a",
        type: "delivered"
      },
      nowISO: "2026-08-09T15:03:30.000Z"
    })).toMatchObject({
      ignored: true,
      suppressionRecommended: true,
      job: { state: "bounced", deliveredAtISO: "" }
    });
    expect(() => recordRevenueAutopilotProviderEvent({
      job: accepted.job,
      event: {
        source: "verified_provider_webhook",
        signatureVerified: true,
        eventId: "resend-event-opened-a",
        provider: "resend",
        providerMessageId: "provider-message-a",
        type: "viewed"
      },
      nowISO: "2026-08-09T15:04:00.000Z"
    })).toThrowError(/never establish customer viewing/i);
  });

  test("contains no provider call seam", () => {
    expect(CORE_SOURCE).not.toContain("fetch(");
    expect(CORE_SOURCE).not.toContain("api.resend.com");
    expect(CORE_SOURCE).not.toContain("sendCustomerEmail");
    expect(() => normalizeRevenueAutopilotJob({})).toThrowError(RevenueAutopilotError);
  });
});
