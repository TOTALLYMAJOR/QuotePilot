import { createRequire } from "node:module";
import fs from "node:fs";
import { describe, expect, test } from "vitest";

const require = createRequire(import.meta.url);
const {
  QuoteDeliveryError,
  assertNoConflictingQuoteExecution,
  assertQuoteDeliveryPortalActivation,
  assertQuoteDeliveryPortalSnapshot,
  assertQuoteDeliveryRevision,
  assertQuoteEditNotDispatching,
  buildQuoteDeliveryFailure,
  buildQuoteDeliveryIdempotencyKey,
  buildQuoteDeliverySuccess,
  classifyQuoteDeliveryAttemptError,
  claimQuoteDelivery,
  normalizeProviderMessageId,
  planQuoteDeliveryAttemptFailure,
  planQuoteDeliveryOutcomeResolution,
  resolveQuoteDeliveryRevisionId
} = require("../../../functions/quoteDelivery.js");

const NOW = "2026-08-03T18:00:00.000Z";
const PORTAL_KEY = "portal-key-abcdefghijklmnopqrstuvwxyz";
const PORTAL_ISSUED_AT_ISO = "2026-08-03T17:30:00.000Z";
const FUNCTIONS_INDEX_SOURCE = fs.readFileSync(
  new URL("../../../functions/index.js", import.meta.url),
  "utf8"
);

function callableSource(name, nextName) {
  const start = FUNCTIONS_INDEX_SOURCE.indexOf(`exports.${name} =`);
  const end = FUNCTIONS_INDEX_SOURCE.indexOf(`exports.${nextName} =`, start + 1);
  return FUNCTIONS_INDEX_SOURCE.slice(start, end);
}

function approvedPaymentRequestSource() {
  const start = FUNCTIONS_INDEX_SOURCE.indexOf("async function sendApprovedPaymentRequestEmail");
  const end = FUNCTIONS_INDEX_SOURCE.indexOf("exports.sendPaymentRequestEmail =", start + 1);
  return FUNCTIONS_INDEX_SOURCE.slice(start, end);
}

function draftQuote(overrides = {}) {
  return {
    id: "quote-a",
    quoteNumber: "Q-260803-1800-ABCDEF12",
    organizationId: "org-a",
    activeVersionId: "v0002",
    latestVersionNumber: 2,
    createdAtISO: "2026-08-03T17:00:00.000Z",
    status: "draft",
    workflow: {},
    ...overrides
  };
}

function acquire(quote = draftQuote(), overrides = {}) {
  return claimQuoteDelivery({
    quote,
    quoteId: quote.id,
    organizationId: quote.organizationId,
    expectedRevisionId: resolveQuoteDeliveryRevisionId(quote, quote.id),
    actorEmail: "ADMIN@EXAMPLE.COM",
    attemptId: "attempt-a",
    payloadSha256: "a".repeat(64),
    nowISO: NOW,
    ...overrides
  });
}

function providerError(message, metadata = {}) {
  return Object.assign(new Error(message), metadata);
}

describe("server-authoritative quote delivery", () => {
  test("keeps owner SMS free of draft portal URLs", () => {
    const source = callableSource("notifyOwnerNewQuote", "sendQuoteToCustomer");
    expect(source).not.toContain("resolvePortalLink");
    expect(source).not.toContain("Portal:");
    expect(source).toContain("New quote ${quoteNumber} saved");
  });

  test("normalizes unresolved claims before portal preflight and uses completion time", () => {
    const source = callableSource("sendQuoteToCustomer", "resolveQuoteDeliveryOutcome");
    const unresolvedClaim = source.indexOf("const unresolvedPlan = claimQuoteDelivery");
    const portalPreflight = source.indexOf("const portal = assertQuoteDeliveryPortal");
    expect(unresolvedClaim).toBeGreaterThan(-1);
    expect(portalPreflight).toBeGreaterThan(unresolvedClaim);
    expect(source).toContain("nowISO: completedAtISO");
    expect(source).toContain("Quote delivery attachments are server-controlled");
  });

  test("lets audited provider acceptance settle before an invalid portal is rotated", () => {
    const source = callableSource("resolveQuoteDeliveryOutcome", "sendPaymentRequestEmail");
    expect(source).toContain("active: false");
    expect(source).toContain("portalActivation");
    expect(source).toContain("if (portalActivation.active && portalRef && portalSnap?.exists)");
    expect(source).not.toContain("Rotate the portal link before resolving provider acceptance");
  });

  test("builds one stable provider idempotency key per tenant quote revision", () => {
    const quote = draftQuote();
    const revisionId = resolveQuoteDeliveryRevisionId(quote, quote.id);
    const first = buildQuoteDeliveryIdempotencyKey({
      organizationId: quote.organizationId,
      quoteId: quote.id,
      revisionId
    });
    const repeated = buildQuoteDeliveryIdempotencyKey({
      organizationId: quote.organizationId,
      quoteId: quote.id,
      revisionId
    });
    const edited = buildQuoteDeliveryIdempotencyKey({
      organizationId: quote.organizationId,
      quoteId: quote.id,
      revisionId: "v0003"
    });
    const reconciledGeneration = buildQuoteDeliveryIdempotencyKey({
      organizationId: quote.organizationId,
      quoteId: quote.id,
      revisionId,
      generation: 2
    });

    expect(first).toBe(repeated);
    expect(first).not.toBe(edited);
    expect(first).not.toBe(reconciledGeneration);
    expect(first).toMatch(/^quote-delivery\/[a-f0-9]{64}$/);
    expect(first.length).toBeLessThan(256);
  });

  test("rejects a stale browser revision before dispatch", () => {
    expect(() => assertQuoteDeliveryRevision(
      draftQuote(),
      "v0001",
      "quote-a"
    )).toThrowError(expect.objectContaining({
      name: "QuoteDeliveryError",
      code: "aborted"
    }));
  });

  test("requires an existing tenant-matching portal with a future expiry", () => {
    const quote = draftQuote({
      portalKey: "portal-key-abcdefghijklmnopqrstuvwxyz",
      portalExpiresAtISO: "2026-09-03T18:00:00.000Z"
    });
    const portalSnapshot = {
      portalKey: quote.portalKey,
      quoteId: quote.id,
      organizationId: quote.organizationId,
      portalIssuedAtISO: PORTAL_ISSUED_AT_ISO,
      portalExpiresAtISO: quote.portalExpiresAtISO
    };
    quote.portalIssuedAtISO = PORTAL_ISSUED_AT_ISO;
    expect(assertQuoteDeliveryPortalSnapshot({
      quote,
      quoteId: quote.id,
      organizationId: quote.organizationId,
      portalSnapshot,
      nowISO: NOW
    })).toEqual({
      portalKey: quote.portalKey,
      portalIssuedAtISO: PORTAL_ISSUED_AT_ISO,
      portalExpiresAtISO: quote.portalExpiresAtISO
    });
    expect(() => assertQuoteDeliveryPortalSnapshot({
      quote,
      quoteId: quote.id,
      organizationId: quote.organizationId,
      portalSnapshot: { ...portalSnapshot, organizationId: "org-b" },
      nowISO: NOW
    })).toThrowError(expect.objectContaining({ code: "failed-precondition" }));
    expect(() => assertQuoteDeliveryPortalSnapshot({
      quote: { ...quote, portalExpiresAtISO: "invalid" },
      quoteId: quote.id,
      organizationId: quote.organizationId,
      portalSnapshot,
      nowISO: NOW
    })).toThrowError(expect.objectContaining({ code: "failed-precondition" }));
    expect(() => assertQuoteDeliveryPortalSnapshot({
      quote: { ...quote, portalIssuedAtISO: "" },
      quoteId: quote.id,
      organizationId: quote.organizationId,
      portalSnapshot,
      nowISO: NOW
    })).toThrowError(expect.objectContaining({ code: "failed-precondition" }));
    expect(() => assertQuoteDeliveryPortalSnapshot({
      quote,
      quoteId: quote.id,
      organizationId: quote.organizationId,
      portalSnapshot: {
        ...portalSnapshot,
        portalIssuedAtISO: "2026-08-03T17:31:00.000Z"
      },
      nowISO: NOW
    })).toThrowError(expect.objectContaining({ code: "failed-precondition" }));
  });

  test("revalidates portal expiry against completion or reconciliation time", () => {
    const quote = draftQuote({
      portalKey: "portal-key-abcdefghijklmnopqrstuvwxyz",
      portalIssuedAtISO: PORTAL_ISSUED_AT_ISO,
      portalExpiresAtISO: "2026-08-03T18:00:05.000Z"
    });
    const portalSnapshot = {
      portalKey: quote.portalKey,
      quoteId: quote.id,
      organizationId: quote.organizationId,
      portalIssuedAtISO: PORTAL_ISSUED_AT_ISO,
      portalExpiresAtISO: quote.portalExpiresAtISO
    };
    expect(assertQuoteDeliveryPortalSnapshot({
      quote,
      quoteId: quote.id,
      organizationId: quote.organizationId,
      portalSnapshot,
      nowISO: NOW
    })).toBeTruthy();
    expect(() => assertQuoteDeliveryPortalSnapshot({
      quote,
      quoteId: quote.id,
      organizationId: quote.organizationId,
      portalSnapshot,
      nowISO: "2026-08-03T18:00:06.000Z"
    })).toThrowError(expect.objectContaining({ code: "failed-precondition" }));
    expect(assertQuoteDeliveryPortalSnapshot({
      quote,
      quoteId: quote.id,
      organizationId: quote.organizationId,
      portalSnapshot,
      nowISO: "2026-08-03T18:00:06.000Z",
      allowExpired: true
    })).toMatchObject({
      portalKey: quote.portalKey,
      portalIssuedAtISO: PORTAL_ISSUED_AT_ISO,
      portalExpiresAtISO: quote.portalExpiresAtISO
    });
    expect(() => assertQuoteDeliveryPortalSnapshot({
      quote,
      quoteId: quote.id,
      organizationId: quote.organizationId,
      portalSnapshot: { ...portalSnapshot, portalKey: "wrong-portal-key-abcdefghijklmnop" },
      nowISO: "2026-08-03T18:00:06.000Z",
      allowExpired: true
    })).toThrowError(expect.objectContaining({ code: "failed-precondition" }));
  });

  test("requires current provider activation evidence before reusing a portal", () => {
    const quote = draftQuote({
      status: "accepted",
      portalKey: PORTAL_KEY,
      portalIssuedAtISO: PORTAL_ISSUED_AT_ISO,
      portalExpiresAtISO: "2026-09-03T18:00:00.000Z"
    });
    const revisionId = resolveQuoteDeliveryRevisionId(quote, quote.id);
    const providerAcceptedAtISO = "2026-08-03T17:45:00.000Z";
    quote.workflow = {
      quoteDelivery: {
        revisionId,
        state: "provider_accepted",
        portalActivationState: "active",
        portalKey: PORTAL_KEY,
        portalIssuedAtISO: PORTAL_ISSUED_AT_ISO,
        providerAcceptedAtISO,
        providerMessageId: "provider-message-accepted"
      }
    };
    const portalSnapshot = {
      portalKey: PORTAL_KEY,
      quoteId: quote.id,
      organizationId: quote.organizationId,
      status: "accepted",
      portalIssuedAtISO: PORTAL_ISSUED_AT_ISO,
      portalExpiresAtISO: quote.portalExpiresAtISO,
      deliveryEvidence: {
        revisionId,
        state: "provider_accepted",
        portalActivationState: "active",
        portalKey: PORTAL_KEY,
        portalIssuedAtISO: PORTAL_ISSUED_AT_ISO,
        providerAcceptedAtISO
      }
    };

    expect(assertQuoteDeliveryPortalActivation({
      quote,
      quoteId: quote.id,
      organizationId: quote.organizationId,
      portalSnapshot,
      nowISO: NOW
    })).toMatchObject({ revisionId, portalKey: PORTAL_KEY });
    expect(assertQuoteDeliveryPortalActivation({
      quote: { ...quote, portalExpiresAtISO: "2026-08-03T17:59:59.000Z" },
      quoteId: quote.id,
      organizationId: quote.organizationId,
      portalSnapshot: {
        ...portalSnapshot,
        portalExpiresAtISO: "2026-08-03T17:59:59.000Z"
      },
      nowISO: NOW,
      allowExpired: true
    })).toMatchObject({ revisionId, portalKey: PORTAL_KEY });
    expect(() => assertQuoteDeliveryPortalActivation({
      quote: {
        ...quote,
        portalKey: "rotated-portal-key-abcdefghijklmnop"
      },
      quoteId: quote.id,
      organizationId: quote.organizationId,
      portalSnapshot,
      nowISO: NOW
    })).toThrowError(expect.objectContaining({ code: "failed-precondition" }));
  });

  test("payment email claims require current portal activation evidence", () => {
    const source = approvedPaymentRequestSource();
    expect(source).toContain("deriveApprovedPaymentRequestScope");
    expect(source.indexOf("deriveApprovedPaymentRequestScope"))
      .toBeLessThan(source.indexOf("sendCustomerEmail"));
  });

  test("routes changed server payload bytes to manual review", () => {
    const first = acquire();
    const review = acquire(draftQuote({
      workflow: { quoteDelivery: first.delivery }
    }), {
      attemptId: "attempt-b",
      payloadSha256: "b".repeat(64),
      nowISO: "2026-08-03T18:01:00.000Z"
    });
    expect(review).toMatchObject({
      state: "manual_review",
      delivery: { state: "outcome_unknown" }
    });
  });

  test("leases one dispatch and returns in-progress for a concurrent retry", () => {
    const first = acquire();
    expect(first).toMatchObject({
      state: "acquired",
      revisionId: "v0002",
      delivery: {
        state: "sending",
        attemptId: "attempt-a",
        attemptCount: 1,
        actorEmail: "admin@example.com"
      }
    });

    const concurrent = acquire(draftQuote({
      workflow: { quoteDelivery: first.delivery }
    }), {
      attemptId: "attempt-b",
      nowISO: "2026-08-03T18:01:00.000Z"
    });
    expect(concurrent).toMatchObject({
      state: "in_progress",
      delivery: { attemptId: "attempt-a" }
    });
  });

  test("records provider acceptance once and replays the saved result", () => {
    const first = acquire();
    const sent = buildQuoteDeliverySuccess({
      delivery: first.delivery,
      email: { provider: "resend", messageId: "email-123" },
      nowISO: "2026-08-03T18:00:10.000Z",
      portalKey: PORTAL_KEY,
      portalIssuedAtISO: PORTAL_ISSUED_AT_ISO
    });
    expect(sent).toMatchObject({
      state: "provider_accepted",
      revisionId: "v0002",
      providerAcceptedAtISO: "2026-08-03T18:00:10.000Z",
      provider: "resend",
      providerMessageId: "email-123",
      portalActivationState: "active",
      portalKey: PORTAL_KEY,
      portalIssuedAtISO: PORTAL_ISSUED_AT_ISO
    });

    const replay = acquire(draftQuote({
      status: "sent",
      workflow: { quoteDelivery: sent }
    }), {
      attemptId: "attempt-b",
      nowISO: "2026-08-03T18:05:00.000Z"
    });
    expect(replay).toMatchObject({
      state: "provider_accepted",
      delivery: { providerMessageId: "email-123" }
    });
  });

  test("replays provider acceptance after a concurrent customer decision", () => {
    const first = acquire();
    const sent = buildQuoteDeliverySuccess({
      delivery: first.delivery,
      email: { provider: "resend", messageId: "email-accepted" },
      nowISO: "2026-08-03T18:00:10.000Z",
      portalKey: PORTAL_KEY,
      portalIssuedAtISO: PORTAL_ISSUED_AT_ISO
    });
    const replay = acquire(draftQuote({
      status: "accepted",
      workflow: { quoteDelivery: sent }
    }), {
      attemptId: "attempt-replay",
      nowISO: "2026-08-03T18:05:00.000Z"
    });

    expect(replay).toMatchObject({
      state: "provider_accepted",
      delivery: { providerMessageId: "email-accepted" }
    });
  });

  test("requires provider identity before recording acceptance", () => {
    const first = acquire();
    expect(() => buildQuoteDeliverySuccess({
      delivery: first.delivery,
      email: { provider: "resend", messageId: "" },
      nowISO: "2026-08-03T18:00:10.000Z",
      portalKey: PORTAL_KEY,
      portalIssuedAtISO: PORTAL_ISSUED_AT_ISO
    })).toThrowError(expect.objectContaining({ code: "failed-precondition" }));
    expect(() => buildQuoteDeliverySuccess({
      delivery: first.delivery,
      email: { provider: "resend", messageId: { id: "email-123" } },
      nowISO: "2026-08-03T18:00:10.000Z",
      portalKey: PORTAL_KEY,
      portalIssuedAtISO: PORTAL_ISSUED_AT_ISO
    })).toThrowError(expect.objectContaining({ code: "failed-precondition" }));
    expect(() => buildQuoteDeliverySuccess({
      delivery: first.delivery,
      email: { provider: "resend", messageId: "email-123" },
      nowISO: "2026-08-03T18:00:10.000Z",
      portalKey: PORTAL_KEY,
      portalIssuedAtISO: ""
    })).toThrowError(expect.objectContaining({ code: "failed-precondition" }));
    expect(normalizeProviderMessageId({ id: "email-123" })).toBe("");
    expect(normalizeProviderMessageId("invalid message id")).toBe("");
    expect(normalizeProviderMessageId("email-123")).toBe("email-123");
  });

  test.each([
    ["network errors", providerError("fetch failed"), "ambiguous"],
    ["HTTP 408", providerError("timeout", { providerHttpStatus: 408 }), "ambiguous"],
    ["HTTP 409", providerError("conflict", { providerHttpStatus: 409 }), "ambiguous"],
    ["HTTP 429", providerError("rate limited", { providerHttpStatus: 429 }), "ambiguous"],
    ["HTTP 503", providerError("unavailable", { providerHttpStatus: 503 }), "ambiguous"],
    ["missing-ID HTTP 202", providerError("missing id", {
      providerHttpStatus: 202,
      quoteDeliveryReason: "provider_2xx_missing_message_id"
    }), "ambiguous"],
    ["HTTP 400", providerError("invalid recipient", { providerHttpStatus: 400 }), "definite_failure"],
    ["HTTP 422", providerError("validation failed", { providerHttpStatus: 422 }), "definite_failure"],
    ["local configuration", providerError("provider disabled", {
      code: "failed-precondition"
    }), "definite_failure"]
  ])("classifies %s without unlocking uncertain outcomes", (_label, error, outcome) => {
    expect(classifyQuoteDeliveryAttemptError(error).outcome).toBe(outcome);
  });

  test("keeps ambiguous provider outcomes locked and retryable with the same key", () => {
    const first = acquire();
    const ambiguity = planQuoteDeliveryAttemptFailure({
      delivery: first.delivery,
      error: providerError("fetch failed", {
        quoteDeliveryOutcome: "ambiguous",
        quoteDeliveryReason: "provider_network_error"
      }),
      nowISO: "2026-08-03T18:00:05.000Z"
    });

    expect(ambiguity).toMatchObject({
      outcome: "ambiguous",
      delivery: {
        state: "outcome_ambiguous",
        leaseExpiresAtISO: "",
        lastAttemptOutcome: "ambiguous",
        outcomeReason: "provider_network_error"
      }
    });
    expect(() => assertQuoteEditNotDispatching(draftQuote({
      workflow: { quoteDelivery: ambiguity.delivery }
    }), "2026-08-03T18:01:00.000Z")).toThrowError(
      expect.objectContaining({ code: "aborted" })
    );

    const retry = acquire(draftQuote({
      workflow: { quoteDelivery: ambiguity.delivery }
    }), {
      attemptId: "attempt-b",
      nowISO: "2026-08-03T18:02:00.000Z"
    });
    expect(retry).toMatchObject({
      state: "acquired",
      delivery: {
        state: "sending",
        attemptId: "attempt-b",
        attemptCount: 2,
        idempotencyKey: first.delivery.idempotencyKey,
        firstAttemptAtISO: NOW
      }
    });
  });

  test("moves provider-accepted portal validation failures straight to manual review", () => {
    const first = acquire();
    const outcome = planQuoteDeliveryAttemptFailure({
      delivery: first.delivery,
      error: providerError("Portal link expired.", {
        code: "failed-precondition",
        quoteDeliveryOutcome: "manual_review",
        quoteDeliveryReason: "provider_accepted_portal_validation_failed"
      }),
      providerObservation: { provider: "resend", messageId: "email-accepted" },
      nowISO: "2026-08-03T18:00:10.000Z"
    });
    expect(outcome).toMatchObject({
      outcome: "manual_review",
      delivery: {
        state: "outcome_unknown",
        lastAttemptOutcome: "manual_review",
        outcomeReason: "provider_accepted_portal_validation_failed",
        observedProviderMessageId: "email-accepted"
      }
    });

    const review = acquire(draftQuote({
      workflow: { quoteDelivery: outcome.delivery }
    }), {
      attemptId: "attempt-retry",
      nowISO: "2026-08-03T18:01:00.000Z"
    });
    expect(review).toMatchObject({
      state: "manual_review",
      delivery: { state: "outcome_unknown" }
    });
  });

  test("records a known provider validation rejection as a definite failure", () => {
    const first = acquire();
    const rejected = planQuoteDeliveryAttemptFailure({
      delivery: first.delivery,
      error: providerError("invalid recipient", { providerHttpStatus: 422 }),
      nowISO: "2026-08-03T18:00:05.000Z"
    });
    expect(rejected).toMatchObject({
      outcome: "definite_failure",
      delivery: {
        state: "failed",
        lastAttemptOutcome: "definite_failure",
        providerHttpStatus: 422
      }
    });
    expect(assertQuoteEditNotDispatching(draftQuote({
      workflow: { quoteDelivery: rejected.delivery }
    }), "2026-08-03T18:01:00.000Z")).toBe(true);
  });

  test("does not let the low-level failed-state builder unlock an unknown error", () => {
    const first = acquire();
    expect(() => buildQuoteDeliveryFailure({
      delivery: first.delivery,
      error: new Error("fetch failed"),
      nowISO: "2026-08-03T18:00:05.000Z"
    })).toThrowError(expect.objectContaining({ code: "failed-precondition" }));
  });

  test("permits a bounded retry after failure while preserving the revision key", () => {
    const first = acquire();
    const failed = buildQuoteDeliveryFailure({
      delivery: first.delivery,
      error: providerError("Invalid recipient.", { providerHttpStatus: 422 }),
      nowISO: "2026-08-03T18:00:05.000Z"
    });
    const retry = acquire(draftQuote({
      workflow: { quoteDelivery: failed }
    }), {
      attemptId: "attempt-b",
      nowISO: "2026-08-03T18:02:00.000Z"
    });

    expect(failed).toMatchObject({
      state: "failed",
      error: "Invalid recipient."
    });
    expect(retry).toMatchObject({
      state: "acquired",
      delivery: {
        attemptId: "attempt-b",
        attemptCount: 2,
        idempotencyKey: first.delivery.idempotencyKey
      }
    });
  });

  test("starts a fresh generation after a definite failure outlives the retry window", () => {
    const first = acquire();
    const failed = buildQuoteDeliveryFailure({
      delivery: first.delivery,
      error: providerError("Invalid recipient.", { providerHttpStatus: 422 }),
      nowISO: "2026-08-03T18:00:05.000Z"
    });
    const fresh = acquire(draftQuote({
      workflow: { quoteDelivery: failed }
    }), {
      attemptId: "attempt-generation-two",
      nowISO: "2026-08-04T17:00:00.000Z"
    });

    expect(fresh).toMatchObject({
      state: "acquired",
      delivery: {
        state: "sending",
        generation: 2,
        attemptCount: 1,
        firstAttemptAtISO: "2026-08-04T17:00:00.000Z",
        retryDeadlineAtISO: "2026-08-05T16:00:00.000Z"
      }
    });
    expect(fresh.delivery.idempotencyKey).not.toBe(first.delivery.idempotencyKey);
  });

  test("stops automatic retries before provider idempotency expires", () => {
    const first = acquire();
    const review = acquire(draftQuote({
      workflow: { quoteDelivery: first.delivery }
    }), {
      attemptId: "attempt-late",
      nowISO: "2026-08-04T17:00:00.000Z"
    });

    expect(review).toMatchObject({
      state: "manual_review",
      delivery: {
        state: "outcome_unknown",
        firstAttemptAtISO: NOW
      }
    });
    expect(() => assertQuoteEditNotDispatching(draftQuote({
      workflow: { quoteDelivery: review.delivery }
    }), "2026-08-04T17:01:00.000Z")).toThrowError(
      expect.objectContaining({ code: "aborted" })
    );
  });

  test("moves an ambiguous outcome to manual review when the retry window expires", () => {
    const first = acquire();
    const ambiguity = planQuoteDeliveryAttemptFailure({
      delivery: first.delivery,
      error: providerError("rate limited", { providerHttpStatus: 429 }),
      nowISO: "2026-08-03T18:00:05.000Z"
    });
    const review = acquire(draftQuote({
      workflow: { quoteDelivery: ambiguity.delivery }
    }), {
      attemptId: "attempt-late",
      nowISO: "2026-08-04T17:00:00.000Z"
    });

    expect(review).toMatchObject({
      state: "manual_review",
      delivery: {
        state: "outcome_unknown",
        firstAttemptAtISO: NOW,
        lastAttemptOutcome: "ambiguous"
      }
    });
  });

  test("routes a terminal customer-decision race through manual review after the lease", () => {
    const first = acquire();
    const terminalQuote = draftQuote({
      status: "accepted",
      workflow: { quoteDelivery: first.delivery }
    });
    const active = acquire(terminalQuote, {
      attemptId: "attempt-concurrent",
      nowISO: "2026-08-03T18:01:00.000Z"
    });
    expect(active).toMatchObject({
      state: "in_progress",
      delivery: { attemptId: "attempt-a" }
    });

    const review = acquire(terminalQuote, {
      attemptId: "attempt-after-lease",
      nowISO: "2026-08-03T18:03:00.000Z"
    });
    expect(review).toMatchObject({
      state: "manual_review",
      delivery: {
        state: "outcome_unknown",
        error: expect.stringContaining("terminal customer decision")
      }
    });
  });

  test("confirmed-not-sent reconciliation unlocks a fresh generation and retry window", () => {
    const first = acquire();
    const ambiguity = planQuoteDeliveryAttemptFailure({
      delivery: first.delivery,
      error: providerError("fetch failed"),
      nowISO: "2026-08-03T18:00:05.000Z"
    });
    const unresolvedQuote = draftQuote({
      workflow: { quoteDelivery: ambiguity.delivery }
    });
    const resolution = planQuoteDeliveryOutcomeResolution({
      quote: unresolvedQuote,
      quoteId: unresolvedQuote.id,
      organizationId: unresolvedQuote.organizationId,
      expectedRevisionId: resolveQuoteDeliveryRevisionId(unresolvedQuote, unresolvedQuote.id),
      resolution: "confirmed_not_sent",
      note: "Provider dashboard confirms no message was created.",
      actorUid: "admin-uid",
      actorEmail: "admin@example.com",
      nowISO: "2026-08-03T18:05:00.000Z"
    });

    expect(resolution).toMatchObject({
      state: "reconciled_not_sent",
      delivery: {
        state: "reconciled_not_sent",
        generation: 2,
        attemptCount: 0,
        firstAttemptAtISO: "",
        retryDeadlineAtISO: "",
        lastResolution: {
          resolution: "confirmed_not_sent",
          actorEmail: "admin@example.com"
        }
      }
    });
    expect(resolution.delivery.idempotencyKey).not.toBe(first.delivery.idempotencyKey);
    expect(assertQuoteEditNotDispatching(draftQuote({
      workflow: { quoteDelivery: resolution.delivery }
    }), "2026-08-03T18:05:01.000Z")).toBe(true);

    const fresh = acquire(draftQuote({
      workflow: { quoteDelivery: resolution.delivery }
    }), {
      attemptId: "attempt-generation-two",
      nowISO: "2026-08-03T18:06:00.000Z"
    });
    expect(fresh).toMatchObject({
      state: "acquired",
      delivery: {
        generation: 2,
        attemptCount: 1,
        idempotencyKey: resolution.delivery.idempotencyKey,
        firstAttemptAtISO: "2026-08-03T18:06:00.000Z",
        retryDeadlineAtISO: "2026-08-04T17:06:00.000Z"
      }
    });
  });

  test("provider-accepted reconciliation requires the observed message ID and audits resolution", () => {
    const first = acquire();
    const ambiguity = planQuoteDeliveryAttemptFailure({
      delivery: first.delivery,
      error: providerError("completion write failed", {
        quoteDeliveryOutcome: "ambiguous",
        quoteDeliveryReason: "provider_accepted_completion_failed"
      }),
      providerObservation: { provider: "resend", messageId: "email-observed" },
      nowISO: "2026-08-03T18:00:10.000Z"
    });
    const unresolvedQuote = draftQuote({
      status: "accepted",
      workflow: { quoteDelivery: ambiguity.delivery }
    });
    const input = {
      quote: unresolvedQuote,
      quoteId: unresolvedQuote.id,
      organizationId: unresolvedQuote.organizationId,
      expectedRevisionId: resolveQuoteDeliveryRevisionId(unresolvedQuote, unresolvedQuote.id),
      resolution: "provider_accepted",
      note: "Matched the provider delivery log.",
      actorUid: "admin-uid",
      actorEmail: "admin@example.com",
      nowISO: "2026-08-03T18:05:00.000Z"
    };
    expect(() => planQuoteDeliveryOutcomeResolution(input)).toThrowError(
      expect.objectContaining({ code: "invalid-argument" })
    );
    expect(() => planQuoteDeliveryOutcomeResolution({
      ...input,
      providerMessageId: "email-conflict"
    })).toThrowError(expect.objectContaining({ code: "failed-precondition" }));
    expect(() => planQuoteDeliveryOutcomeResolution({
      ...input,
      resolution: "confirmed_not_sent",
      note: "Incorrectly trying to clear known provider acceptance."
    })).toThrowError(expect.objectContaining({
      code: "failed-precondition",
      message: expect.stringContaining("already observed provider acceptance")
    }));

    const resolution = planQuoteDeliveryOutcomeResolution({
      ...input,
      providerMessageId: "email-observed"
    });
    expect(resolution).toMatchObject({
      state: "provider_accepted",
      delivery: {
        state: "provider_accepted",
        provider: "resend",
        providerMessageId: "email-observed",
        providerAcceptedAtISO: "2026-08-03T18:05:00.000Z",
        portalActivationState: "requires_rotation",
        lastResolution: {
          resolution: "provider_accepted",
          note: "Matched the provider delivery log."
        }
      }
    });

    const portalQuote = {
      ...unresolvedQuote,
      portalKey: PORTAL_KEY,
      portalIssuedAtISO: PORTAL_ISSUED_AT_ISO
    };
    const portalRevisionId = resolveQuoteDeliveryRevisionId(portalQuote, portalQuote.id);
    portalQuote.workflow = {
      quoteDelivery: {
        ...ambiguity.delivery,
        revisionId: portalRevisionId
      }
    };
    const activated = planQuoteDeliveryOutcomeResolution({
      ...input,
      quote: portalQuote,
      expectedRevisionId: portalRevisionId,
      providerMessageId: "email-observed",
      portalActivation: {
        active: true,
        portalKey: PORTAL_KEY,
        portalIssuedAtISO: PORTAL_ISSUED_AT_ISO
      }
    });
    expect(activated.delivery).toMatchObject({
      portalActivationState: "active",
      portalKey: PORTAL_KEY,
      portalIssuedAtISO: PORTAL_ISSUED_AT_ISO
    });
  });

  test("rejects reconciliation while the delivery lease is active", () => {
    const first = acquire();
    const quote = draftQuote({ workflow: { quoteDelivery: first.delivery } });
    expect(() => planQuoteDeliveryOutcomeResolution({
      quote,
      quoteId: quote.id,
      organizationId: quote.organizationId,
      expectedRevisionId: resolveQuoteDeliveryRevisionId(quote, quote.id),
      resolution: "confirmed_not_sent",
      note: "Checked too early.",
      actorUid: "admin-uid",
      actorEmail: "admin@example.com",
      nowISO: "2026-08-03T18:01:00.000Z"
    })).toThrowError(expect.objectContaining({ code: "aborted" }));
  });

  test("portal rotation creates a new delivery identity", () => {
    const beforeRotation = draftQuote({
      portalKey: "portal-key-before-rotation-123456",
      portalIssuedAtISO: "2026-08-03T17:00:00.000Z"
    });
    const afterRotation = {
      ...beforeRotation,
      portalKey: "portal-key-after-rotation-1234567",
      portalIssuedAtISO: "2026-08-03T19:00:00.000Z"
    };

    expect(resolveQuoteDeliveryRevisionId(beforeRotation, beforeRotation.id))
      .not.toBe(resolveQuoteDeliveryRevisionId(afterRotation, afterRotation.id));
    expect(resolveQuoteDeliveryRevisionId({
      ...beforeRotation,
      portalIssuedAtISO: "2026-08-03T18:00:00-05:00"
    }, beforeRotation.id)).toBe("v0002@2026-08-03T23:00:00.000Z");
  });

  test("blocks edits while the current revision delivery is unresolved", () => {
    const first = acquire();
    expect(() => assertQuoteEditNotDispatching(draftQuote({
      workflow: { quoteDelivery: first.delivery }
    }), "2026-08-03T18:01:00.000Z")).toThrow(QuoteDeliveryError);

    expect(assertQuoteEditNotDispatching(draftQuote({
      activeVersionId: "v0003",
      latestVersionNumber: 3,
      workflow: { quoteDelivery: first.delivery }
    }), "2026-08-03T18:01:00.000Z")).toBe(true);
    expect(() => assertQuoteEditNotDispatching(draftQuote({
      workflow: { quoteDelivery: first.delivery }
    }), "2026-08-03T18:03:00.000Z")).toThrow(QuoteDeliveryError);

    expect(assertQuoteEditNotDispatching(draftQuote({
      workflow: {
        quoteDelivery: buildQuoteDeliveryFailure({
          delivery: first.delivery,
          error: providerError("Invalid recipient.", { providerHttpStatus: 422 }),
          nowISO: "2026-08-03T18:03:00.000Z"
        })
      }
    }), "2026-08-03T18:04:00.000Z")).toBe(true);
  });

  test("allows an accepted portal renewal and still rejects closed commercial states", () => {
    expect(acquire(draftQuote({ status: "accepted" }))).toMatchObject({
      state: "acquired",
      delivery: { state: "sending" }
    });
    expect(() => acquire(draftQuote({ status: "declined" }))).toThrowError(
      expect.objectContaining({ code: "failed-precondition" })
    );
  });

  test("allows a booked contract portal renewal to be provider-activated", () => {
    const booked = draftQuote({
      status: "booked",
      booking: {
        contractNumber: "C-260804-12345",
        contractConvertedAtISO: "2026-08-04T12:00:00.000Z"
      },
      payment: {
        depositStatus: "paid",
        stripeSessionId: "cs_test_paid_deposit",
        depositConfirmedAtISO: "2026-08-04T13:00:00.000Z"
      }
    });
    expect(acquire(booked)).toMatchObject({
      state: "acquired",
      delivery: { state: "sending" }
    });
    expect(() => acquire(draftQuote({ status: "booked" }))).toThrow(/contract.*deposit/i);

    const payloadStart = FUNCTIONS_INDEX_SOURCE.indexOf(
      "function buildQuoteDeliveryEmailPayload"
    );
    const payloadEnd = FUNCTIONS_INDEX_SOURCE.indexOf(
      "function annotateQuoteDeliveryAttemptError",
      payloadStart
    );
    const payloadSource = FUNCTIONS_INDEX_SOURCE.slice(payloadStart, payloadEnd);
    const renewalBranch = payloadSource.indexOf("if (bookedPortalRenewal)");
    const genericQuoteCopy = payloadSource.indexOf("Your quote ${quoteNumber} is ready");
    expect(renewalBranch).toBeGreaterThan(-1);
    expect(genericQuoteCopy).toBeGreaterThan(renewalBranch);
    expect(payloadSource).toContain("Your secure portal access has been renewed");
    expect(payloadSource).toContain("Your event remains booked");
    expect(payloadSource).toContain("Deposit received");
    expect(payloadSource).toContain("Review your booked contract and payment status");
  });

  test("rejects delivery while a sensitive approved action is executing", () => {
    for (const action of ["rotate_portal_link", "send_payment_request", "send_final_balance_request"]) {
      expect(() => assertNoConflictingQuoteExecution(draftQuote({
        workflow: {
          approvalRequests: [{ action, executionState: "in_progress" }]
        }
      }))).toThrowError(expect.objectContaining({ code: "aborted" }));
    }
    expect(assertNoConflictingQuoteExecution(draftQuote({
      workflow: {
        approvalRequests: [{
          action: "rotate_portal_link",
          executionState: "succeeded"
        }]
      }
    }))).toBe(true);
  });
});
