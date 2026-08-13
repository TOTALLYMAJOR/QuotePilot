import { createRequire } from "node:module";
import { describe, expect, test } from "vitest";

const require = createRequire(import.meta.url);
const {
  OWNER_SMS_ATTEMPT_SCHEMA_VERSION,
  OWNER_SMS_ATTEMPT_STATES,
  OwnerSmsAttemptError,
  buildOwnerSmsAttemptId,
  buildOwnerSmsAttemptReservation,
  buildOwnerSmsPayloadDigest,
  buildOwnerSmsRecipientFingerprint,
  buildOwnerSmsWebhookReceiptId,
  normalizeOwnerSmsAttempt,
  planOwnerSmsDispatch,
  planOwnerSmsPreflightFailure,
  planOwnerSmsOutcome
} = require("../../../functions/ownerSmsAttempts.js");

const NOW = "2026-08-11T18:00:00.000Z";
const DISPATCHED_AT = "2026-08-11T18:00:01.000Z";
const ACCEPTED_AT = "2026-08-11T18:00:02.000Z";
const PROVIDER_OCCURRENCE_AT = "2026-08-11T18:00:03.000Z";
const WEBHOOK_SENT_AT = "2026-08-11T18:00:03.500Z";
const OBSERVED_AT = "2026-08-11T18:00:04.000Z";
const FINGERPRINT_SECRET = "test-only-owner-sms-fingerprint-secret-0123456789abcdef";
const RECIPIENT = "+13125550123";
const TRACKING_ID = "0192a1b2-c3d4-5e6f-7890-abcd1234ef56";
const identity = Object.freeze({
  source: "stripe_webhook",
  sourceId: "evt_payment_101",
  organizationId: "org-one",
  notificationType: "payment_received"
});
const payload = Object.freeze({
  message: "Deposit paid for Q-101. Amount $100.00.",
  type: "quotepilot_payment_received"
});

function recipientFingerprint(
  recipient = RECIPIENT,
  secret = FINGERPRINT_SECRET,
  organizationId = identity.organizationId
) {
  return buildOwnerSmsRecipientFingerprint({ organizationId, recipient, secret });
}

function reservation(overrides = {}) {
  return buildOwnerSmsAttemptReservation({
    ...identity,
    provider: "pingram",
    payloadDigest: buildOwnerSmsPayloadDigest(payload),
    nowISO: NOW,
    ...overrides
  });
}

function dispatch(overrides = {}) {
  return planOwnerSmsDispatch({
    attempt: reservation(),
    leaseId: "dispatch-lease-101",
    recipientFingerprint: recipientFingerprint(),
    nowISO: DISPATCHED_AT,
    ...overrides
  });
}

function accepted(overrides = {}) {
  return planOwnerSmsOutcome({
    attempt: dispatch(),
    outcome: "provider_accepted",
    providerTrackingId: TRACKING_ID,
    nowISO: ACCEPTED_AT,
    ...overrides
  });
}

describe("Owner SMS attempt identity", () => {
  test("builds a deterministic opaque attempt ID from semantic identity", () => {
    const first = buildOwnerSmsAttemptId(identity);
    const reordered = buildOwnerSmsAttemptId({
      notificationType: identity.notificationType,
      organizationId: identity.organizationId,
      sourceId: identity.sourceId,
      source: identity.source
    });

    expect(first).toMatch(/^osa_[a-f0-9]{48}$/);
    expect(reordered).toBe(first);
    expect(first).not.toContain(identity.sourceId);
    expect(buildOwnerSmsAttemptId({ ...identity, sourceId: "evt_payment_102" }))
      .not.toBe(first);
    expect(buildOwnerSmsAttemptId({ ...identity, notificationType: "payment_review" }))
      .not.toBe(first);
    expect(buildOwnerSmsAttemptId({ ...identity, organizationId: "org-two" }))
      .not.toBe(first);
  });

  test.each([
    [{ ...identity, source: "" }],
    [{ ...identity, sourceId: "event/with/slashes" }],
    [{ ...identity, organizationId: "../other-org" }],
    [{ ...identity, notificationType: "Payment Received!" }]
  ])("rejects an invalid attempt identity %#", (candidate) => {
    expect(() => buildOwnerSmsAttemptId(candidate)).toThrow(OwnerSmsAttemptError);
  });
});

describe("Owner SMS private digests", () => {
  test("canonicalizes payload key order and changes for meaningful payload changes", () => {
    const digest = buildOwnerSmsPayloadDigest(payload);
    const reordered = buildOwnerSmsPayloadDigest({
      type: payload.type,
      message: payload.message
    });

    expect(digest).toMatch(/^[a-f0-9]{64}$/);
    expect(reordered).toBe(digest);
    expect(buildOwnerSmsPayloadDigest({ ...payload, message: `${payload.message} Review.` }))
      .not.toBe(digest);
    expect(buildOwnerSmsPayloadDigest({ ...payload, type: "quotepilot_payment_review" }))
      .not.toBe(digest);
  });

  test("rejects payloads that are lossy, cyclic, or unbounded", () => {
    const cyclic = {};
    cyclic.self = cyclic;

    expect(() => buildOwnerSmsPayloadDigest({ value: undefined })).toThrow(/undefined/i);
    expect(() => buildOwnerSmsPayloadDigest({ value: Number.NaN })).toThrow(/non-finite/i);
    expect(() => buildOwnerSmsPayloadDigest(cyclic)).toThrow(/circular/i);
    expect(() => buildOwnerSmsPayloadDigest({ message: "x".repeat(33 * 1024) }))
      .toThrow(/bounded digest input size/i);
  });

  test("HMAC-fingerprints an exact E.164 recipient without exposing it", () => {
    const fingerprint = recipientFingerprint();

    expect(fingerprint).toMatch(/^osrf_[a-f0-9]{64}$/);
    expect(fingerprint).not.toContain(RECIPIENT.slice(-4));
    expect(recipientFingerprint(` ${RECIPIENT} `)).toBe(fingerprint);
    expect(recipientFingerprint("+13125550124")).not.toBe(fingerprint);
    expect(recipientFingerprint(RECIPIENT, `${FINGERPRINT_SECRET}-rotated`))
      .not.toBe(fingerprint);
    expect(recipientFingerprint(RECIPIENT, FINGERPRINT_SECRET, "org-two"))
      .not.toBe(fingerprint);
    expect(() => recipientFingerprint(RECIPIENT, FINGERPRINT_SECRET, ""))
      .toThrow(/requires an organization/i);
    expect(() => recipientFingerprint("312-555-0123")).toThrow(/E\.164/i);
    expect(() => recipientFingerprint(RECIPIENT, "too-short"))
      .toThrow(/not configured/i);
  });
});

describe("Owner SMS attempt reservation", () => {
  test("freezes the immutable queued identity without requiring the recipient HMAC secret", () => {
    const attempt = reservation();

    expect(Object.isFrozen(attempt)).toBe(true);
    expect(attempt).toEqual({
      schemaVersion: OWNER_SMS_ATTEMPT_SCHEMA_VERSION,
      attemptId: buildOwnerSmsAttemptId(identity),
      ...identity,
      provider: "pingram",
      payloadDigest: buildOwnerSmsPayloadDigest(payload),
      recipientFingerprint: "",
      state: OWNER_SMS_ATTEMPT_STATES.QUEUED,
      revision: 0,
      attemptCount: 0,
      reservedAtISO: NOW,
      stateUpdatedAtISO: NOW,
      dispatchLeaseId: "",
      dispatchStartedAtISO: "",
      providerTrackingId: "",
      providerAcceptedAtISO: "",
      outcomeReason: "",
      outcomeRecordedAtISO: "",
      providerEventType: "",
      providerOccurrenceAtISO: "",
      webhookSentAtISO: "",
      webhookReceiptId: ""
    });
    expect(JSON.stringify(attempt)).not.toContain(RECIPIENT);
    expect(JSON.stringify(attempt)).not.toContain(payload.message);
    expect(normalizeOwnerSmsAttempt(attempt)).toMatchObject(attempt);
  });

  test.each([
    [{ provider: "none" }, /reservation evidence/i],
    [{ provider: "unsupported" }, /reservation evidence/i],
    [{ payloadDigest: "a".repeat(63) }, /reservation evidence/i],
    [{ recipientFingerprint: "osrf_invalid" }, /reservation evidence/i],
    [{ nowISO: "not-a-date" }, /reservation evidence/i]
  ])("fails closed on invalid reservation evidence %#", (overrides, expected) => {
    expect(() => reservation(overrides)).toThrow(expected);
  });

  test("detects immutable identity and audit-state tampering", () => {
    const attempt = reservation();

    expect(() => normalizeOwnerSmsAttempt({ ...attempt, sourceId: "evt_tampered" }))
      .toThrow(/identity or audit state/i);
    expect(() => normalizeOwnerSmsAttempt({
      ...attempt,
      state: "dispatching",
      revision: 1,
      attemptCount: 1
    })).toThrow(/dispatch evidence/i);
    expect(() => normalizeOwnerSmsAttempt({
      ...accepted(),
      providerAcceptedAtISO: DISPATCHED_AT
    })).toThrow(/provider-accepted Owner SMS evidence/i);
  });
});

describe("Owner SMS dispatch transitions", () => {
  test("records a redacted queued preflight failure without claiming a provider attempt", () => {
    const queued = reservation();
    const failed = planOwnerSmsPreflightFailure({
      attempt: queued,
      safeReason: "payload_digest_mismatch",
      nowISO: DISPATCHED_AT
    });

    expect(queued.state).toBe("queued");
    expect(failed).toMatchObject({
      state: "definite_failure",
      revision: 1,
      attemptCount: 0,
      dispatchLeaseId: "",
      dispatchStartedAtISO: "",
      providerTrackingId: "",
      providerAcceptedAtISO: "",
      outcomeReason: "payload_digest_mismatch",
      outcomeRecordedAtISO: DISPATCHED_AT,
      stateUpdatedAtISO: DISPATCHED_AT,
      providerEventType: "",
      providerOccurrenceAtISO: "",
      webhookSentAtISO: "",
      webhookReceiptId: ""
    });
    expect(normalizeOwnerSmsAttempt(failed)).toMatchObject(failed);
    expect(planOwnerSmsPreflightFailure({
      attempt: failed,
      safeReason: "payload_digest_mismatch",
      nowISO: OBSERVED_AT
    })).toEqual(failed);
  });

  test("requires reviewed safe evidence for preflight failure and rejects other source states", () => {
    expect(() => planOwnerSmsPreflightFailure({
      attempt: reservation(),
      safeReason: "PINGRAM_API_KEY=pingram_sk_sensitive",
      nowISO: DISPATCHED_AT
    })).toThrow(/redacted safe reason code/i);
    expect(() => planOwnerSmsPreflightFailure({
      attempt: reservation(),
      safeReason: "payload mismatch from provider response",
      nowISO: DISPATCHED_AT
    })).toThrow(/redacted safe reason code/i);
    expect(() => planOwnerSmsPreflightFailure({
      attempt: reservation(),
      safeReason: "payload_digest_mismatch",
      nowISO: "2026-08-11T17:59:59.000Z"
    })).toThrow(/monotonic/i);
    expect(() => planOwnerSmsPreflightFailure({
      attempt: dispatch(),
      safeReason: "payload_digest_mismatch",
      nowISO: OBSERVED_AT
    })).toThrow(/queued Owner SMS work/i);

    const failed = planOwnerSmsPreflightFailure({
      attempt: reservation(),
      safeReason: "payload_digest_mismatch",
      nowISO: DISPATCHED_AT
    });
    expect(() => planOwnerSmsPreflightFailure({
      attempt: failed,
      safeReason: "recipient_fingerprint_unavailable",
      nowISO: OBSERVED_AT
    })).toThrow(/does not match recorded evidence/i);
  });

  test("claims queued work without mutating the reservation and replays the same lease", () => {
    const queued = reservation();
    const claimed = planOwnerSmsDispatch({
      attempt: queued,
      leaseId: "dispatch-lease-101",
      recipientFingerprint: recipientFingerprint(),
      nowISO: DISPATCHED_AT
    });

    expect(queued.state).toBe("queued");
    expect(claimed.attemptId).toBe(queued.attemptId);
    expect(claimed.payloadDigest).toBe(queued.payloadDigest);
    expect(claimed.provider).toBe(queued.provider);
    expect(claimed).toMatchObject({
      state: "dispatching",
      revision: 1,
      attemptCount: 1,
      dispatchLeaseId: "dispatch-lease-101",
      dispatchStartedAtISO: DISPATCHED_AT,
      recipientFingerprint: recipientFingerprint(),
      stateUpdatedAtISO: DISPATCHED_AT
    });
    expect(planOwnerSmsDispatch({
      attempt: claimed,
      leaseId: "dispatch-lease-101",
      recipientFingerprint: recipientFingerprint(),
      nowISO: OBSERVED_AT
    })).toEqual(claimed);
    expect(() => planOwnerSmsDispatch({
      attempt: claimed,
      leaseId: "another-lease",
      recipientFingerprint: recipientFingerprint(),
      nowISO: OBSERVED_AT
    })).toThrow(/another dispatch lease/i);
  });

  test("requires the provider worker to bind the HMAC recipient fingerprint while claiming", () => {
    expect(() => planOwnerSmsDispatch({
      attempt: reservation(),
      leaseId: "dispatch-lease-101",
      nowISO: DISPATCHED_AT
    })).toThrow(/HMAC recipient fingerprint/i);
    expect(() => planOwnerSmsDispatch({
      attempt: reservation({ recipientFingerprint: recipientFingerprint() }),
      leaseId: "dispatch-lease-101",
      recipientFingerprint: recipientFingerprint("+13125550124"),
      nowISO: DISPATCHED_AT
    })).toThrow(/does not match the queued reservation/i);
  });

  test.each([
    ["provider_accepted", { providerTrackingId: TRACKING_ID }, "provider_accepted"],
    ["definite_failure", { reason: "provider_http_400" }, "definite_failure"],
    ["uncertain", { reason: "provider_timeout" }, "uncertain"]
  ])("records dispatching -> %s", (outcome, evidence, expectedState) => {
    const current = dispatch();
    const result = planOwnerSmsOutcome({
      attempt: current,
      outcome,
      nowISO: ACCEPTED_AT,
      ...evidence
    });

    expect(current.state).toBe("dispatching");
    expect(result).toMatchObject({
      state: expectedState,
      revision: 2,
      stateUpdatedAtISO: ACCEPTED_AT,
      outcomeRecordedAtISO: ACCEPTED_AT
    });
    if (outcome === "provider_accepted") {
      expect(result).toMatchObject({
        providerTrackingId: TRACKING_ID,
        providerAcceptedAtISO: ACCEPTED_AT,
        outcomeReason: "provider_accepted"
      });
    } else {
      expect(result.providerAcceptedAtISO).toBe("");
      expect(result.outcomeReason).toBe(evidence.reason);
    }
  });

  test("retains an exact tracking ID when the transport result remains uncertain", () => {
    const result = planOwnerSmsOutcome({
      attempt: dispatch(),
      outcome: "uncertain",
      reason: "malformed_provider_response",
      providerTrackingId: TRACKING_ID,
      nowISO: ACCEPTED_AT
    });

    expect(result).toMatchObject({
      state: "uncertain",
      revision: 2,
      providerTrackingId: TRACKING_ID,
      providerAcceptedAtISO: "",
      outcomeReason: "malformed_provider_response"
    });
    expect(normalizeOwnerSmsAttempt(result).providerTrackingId).toBe(TRACKING_ID);
    expect(planOwnerSmsOutcome({
      attempt: result,
      outcome: "uncertain",
      reason: "malformed_provider_response",
      providerTrackingId: TRACKING_ID,
      nowISO: OBSERVED_AT
    })).toEqual(result);
    expect(() => normalizeOwnerSmsAttempt({
      ...result,
      providerTrackingId: "tracking id with spaces"
    })).toThrow(/identity or audit state/i);
  });

  test("requires exact outcome evidence and monotonic transition time", () => {
    expect(() => planOwnerSmsOutcome({
      attempt: dispatch(),
      outcome: "provider_accepted",
      nowISO: ACCEPTED_AT
    })).toThrow(/tracking ID/i);
    expect(() => planOwnerSmsOutcome({
      attempt: dispatch(),
      outcome: "uncertain",
      nowISO: ACCEPTED_AT
    })).toThrow(/requires a reason/i);
    expect(() => planOwnerSmsOutcome({
      attempt: dispatch(),
      outcome: "uncertain",
      reason: "malformed_provider_response",
      providerTrackingId: "tracking id with spaces",
      nowISO: ACCEPTED_AT
    })).toThrow(/tracking ID is invalid/i);
    expect(() => planOwnerSmsOutcome({
      attempt: dispatch(),
      outcome: "definite_failure",
      reason: "provider_rejected",
      providerTrackingId: TRACKING_ID,
      nowISO: ACCEPTED_AT
    })).toThrow(/cannot retain a tracking ID/i);
    expect(() => planOwnerSmsOutcome({
      attempt: dispatch(),
      outcome: "definite_failure",
      reason: "provider_rejected",
      nowISO: NOW
    })).toThrow(/monotonic/i);
    expect(() => planOwnerSmsOutcome({
      attempt: reservation(),
      outcome: "provider_accepted",
      providerTrackingId: TRACKING_ID,
      nowISO: ACCEPTED_AT
    })).toThrow(/not allowed/i);
  });
});

describe("Owner SMS provider events", () => {
  test.each([
    ["delivered", "SMS.DELIVERED", "provider_reported_delivered", PROVIDER_OCCURRENCE_AT],
    ["failed", "SMS-FAILED", "carrier_rejected", ""]
  ])("records provider_accepted -> %s with separate webhook time evidence", (
    outcome,
    eventType,
    reason,
    providerOccurrenceAtISO
  ) => {
    const current = accepted();
    const expectedReceiptId = buildOwnerSmsWebhookReceiptId({
      provider: current.provider,
      eventType,
      providerTrackingId: current.providerTrackingId
    });
    const result = planOwnerSmsOutcome({
      attempt: current,
      outcome,
      nowISO: OBSERVED_AT,
      reason: outcome === "failed" ? reason : "",
      providerTrackingId: current.providerTrackingId,
      providerEventType: eventType,
      providerOccurrenceAtISO,
      webhookSentAtISO: WEBHOOK_SENT_AT,
      webhookReceiptId: expectedReceiptId
    });

    expect(result).toMatchObject({
      state: outcome,
      revision: 3,
      stateUpdatedAtISO: OBSERVED_AT,
      outcomeReason: reason,
      outcomeRecordedAtISO: OBSERVED_AT,
      providerEventType: `sms_${outcome === "delivered" ? "delivered" : "failed"}`,
      providerOccurrenceAtISO,
      webhookSentAtISO: WEBHOOK_SENT_AT,
      webhookReceiptId: expectedReceiptId
    });
    expect(planOwnerSmsOutcome({
      attempt: result,
      outcome,
      nowISO: OBSERVED_AT,
      webhookReceiptId: expectedReceiptId
    })).toEqual(result);
  });

  test.each(["delivered", "failed"])(
    "records an exact signed %s event after an uncertain response with tracking",
    (outcome) => {
      const uncertain = planOwnerSmsOutcome({
        attempt: dispatch(),
        outcome: "uncertain",
        reason: "malformed_provider_response",
        providerTrackingId: TRACKING_ID,
        nowISO: ACCEPTED_AT
      });
      const result = planOwnerSmsOutcome({
        attempt: uncertain,
        outcome,
        reason: outcome === "failed" ? "carrier_rejected" : "",
        providerTrackingId: TRACKING_ID,
        providerEventType: outcome === "delivered" ? "SMS_DELIVERED" : "SMS_FAILED",
        webhookSentAtISO: WEBHOOK_SENT_AT,
        nowISO: OBSERVED_AT
      });

      expect(result).toMatchObject({
        state: outcome,
        revision: 3,
        providerTrackingId: TRACKING_ID,
        providerAcceptedAtISO: "",
        providerOccurrenceAtISO: "",
        webhookSentAtISO: WEBHOOK_SENT_AT,
        outcomeRecordedAtISO: OBSERVED_AT
      });
      expect(normalizeOwnerSmsAttempt(result)).toMatchObject(result);
    }
  );

  test("deduplicates semantic provider events independently of provider event IDs", () => {
    const common = {
      provider: "pingram",
      eventType: "SMS_DELIVERED",
      providerTrackingId: TRACKING_ID
    };

    expect(buildOwnerSmsWebhookReceiptId({
      ...common,
      providerEventId: "provider-event-one"
    })).toBe(buildOwnerSmsWebhookReceiptId({
      ...common,
      providerEventId: "provider-event-two"
    }));
    expect(buildOwnerSmsWebhookReceiptId({ ...common, eventType: "sms.delivered" }))
      .toBe(buildOwnerSmsWebhookReceiptId(common));
    expect(buildOwnerSmsWebhookReceiptId({ ...common, eventType: "SMS_FAILED" }))
      .not.toBe(buildOwnerSmsWebhookReceiptId(common));
  });

  test("supports recipient-scoped STOP receipts without exposing the phone number", () => {
    const receiptId = buildOwnerSmsWebhookReceiptId({
      provider: "pingram",
      eventType: "SMS_UNSUBSCRIBE",
      recipientFingerprint: recipientFingerprint()
    });

    expect(receiptId).toMatch(/^oswr_[a-f0-9]{48}$/);
    expect(receiptId).not.toContain(RECIPIENT.slice(-4));
  });

  test("rejects mismatched tracking, event type, receipt, and terminal transitions", () => {
    const current = accepted();
    const base = {
      attempt: current,
      outcome: "delivered",
      nowISO: OBSERVED_AT,
      providerEventType: "SMS_DELIVERED",
      providerOccurrenceAtISO: PROVIDER_OCCURRENCE_AT,
      webhookSentAtISO: WEBHOOK_SENT_AT
    };

    expect(() => planOwnerSmsOutcome({
      ...base,
      providerTrackingId: "different-tracking-id"
    })).toThrow(/does not match/i);
    expect(() => planOwnerSmsOutcome({
      ...base,
      providerEventType: "SMS_FAILED"
    })).toThrow(/provider-event outcome evidence/i);
    expect(() => planOwnerSmsOutcome({
      ...base,
      webhookReceiptId: `oswr_${"f".repeat(48)}`
    })).toThrow(/provider-event outcome evidence/i);

    const delivered = planOwnerSmsOutcome(base);
    expect(() => planOwnerSmsOutcome({
      attempt: delivered,
      outcome: "failed",
      nowISO: "2026-08-11T18:00:05.000Z",
      providerEventType: "SMS_FAILED",
      providerOccurrenceAtISO: PROVIDER_OCCURRENCE_AT,
      webhookSentAtISO: WEBHOOK_SENT_AT
    })).toThrow(/not allowed/i);
  });

  test("requires webhook transmission time and validates optional occurrence time", () => {
    const current = accepted();
    expect(() => planOwnerSmsOutcome({
      attempt: current,
      outcome: "delivered",
      nowISO: OBSERVED_AT,
      providerEventType: "SMS_DELIVERED",
      providerOccurrenceAtISO: PROVIDER_OCCURRENCE_AT
    })).toThrow(/provider-event outcome evidence/i);
    expect(() => planOwnerSmsOutcome({
      attempt: current,
      outcome: "delivered",
      nowISO: OBSERVED_AT,
      providerEventType: "SMS_DELIVERED",
      providerOccurrenceAtISO: "not-a-date",
      webhookSentAtISO: WEBHOOK_SENT_AT
    })).toThrow(/provider-event outcome evidence/i);
  });

  test("does not accept a provider event from uncertainty without a tracking ID", () => {
    const uncertain = planOwnerSmsOutcome({
      attempt: dispatch(),
      outcome: "uncertain",
      reason: "transport_timeout",
      nowISO: ACCEPTED_AT
    });
    expect(() => planOwnerSmsOutcome({
      attempt: uncertain,
      outcome: "delivered",
      nowISO: OBSERVED_AT,
      providerEventType: "SMS_DELIVERED",
      webhookSentAtISO: WEBHOOK_SENT_AT
    })).toThrow(/not allowed/i);
  });

  test("normalizes the undeployed legacy provider-event timestamp as webhook-sent time", () => {
    const terminal = planOwnerSmsOutcome({
      attempt: accepted(),
      outcome: "delivered",
      nowISO: OBSERVED_AT,
      providerEventType: "SMS_DELIVERED",
      webhookSentAtISO: WEBHOOK_SENT_AT
    });
    const legacy = { ...terminal, providerEventAtISO: WEBHOOK_SENT_AT };
    delete legacy.webhookSentAtISO;

    expect(normalizeOwnerSmsAttempt(legacy)).toMatchObject({
      providerOccurrenceAtISO: "",
      webhookSentAtISO: WEBHOOK_SENT_AT
    });
  });
});
