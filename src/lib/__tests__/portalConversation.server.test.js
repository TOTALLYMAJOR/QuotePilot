import { createRequire } from "node:module";
import fs from "node:fs";
import { describe, expect, test } from "vitest";

const require = createRequire(import.meta.url);
const {
  PORTAL_CONVERSATION_BODY_MAX_LENGTH,
  PORTAL_CONVERSATION_RATE_LIMIT,
  PORTAL_CONVERSATION_PAGE_SIZE,
  PORTAL_CONVERSATION_TOTAL_MESSAGE_LIMIT,
  assertPortalConversationActivation,
  assertPortalConversationTotal,
  buildPortalConversationActor,
  buildPortalConversationPage,
  buildPortalConversationMessage,
  buildPortalConversationRateKey,
  buildPortalConversationRequestKey,
  normalizePortalConversationRequest,
  normalizePortalConversationCursor,
  planPortalConversationRate,
  projectPortalConversationMessage
} = require("../../../functions/portalConversation.js");
const {
  assertQuoteDeliveryPortalActivation,
  resolveQuoteDeliveryRevisionId
} = require("../../../functions/quoteDelivery.js");

const NOW = "2026-08-06T18:00:00.000Z";
const NOW_MS = Date.parse(NOW);
const PORTAL_KEY = "portal-conversation-token-1234567890";
const PORTAL_ISSUED_AT_ISO = "2026-08-06T17:00:00.000Z";
const PORTAL_EXPIRES_AT_ISO = "2026-09-06T17:00:00.000Z";
const FUNCTIONS_INDEX_SOURCE = fs.readFileSync(
  new URL("../../../functions/index.js", import.meta.url),
  "utf8"
);

function activeDocuments(status = "viewed") {
  const quote = {
    id: "quote-conversation",
    organizationId: "org-a",
    status,
    portalKey: PORTAL_KEY,
    portalIssuedAtISO: PORTAL_ISSUED_AT_ISO,
    portalExpiresAtISO: PORTAL_EXPIRES_AT_ISO,
    activeVersionId: "v0003",
    customer: { name: "Jordan Customer" },
    workflow: {}
  };
  const revisionId = resolveQuoteDeliveryRevisionId(quote, quote.id);
  const providerAcceptedAtISO = "2026-08-06T17:05:00.000Z";
  quote.workflow.quoteDelivery = {
    revisionId,
    state: "provider_accepted",
    portalActivationState: "active",
    portalKey: PORTAL_KEY,
    portalIssuedAtISO: PORTAL_ISSUED_AT_ISO,
    providerAcceptedAtISO,
    providerMessageId: "provider-message-1"
  };
  return {
    quote,
    portalSnapshot: {
      portalKey: PORTAL_KEY,
      quoteId: quote.id,
      organizationId: quote.organizationId,
      status,
      customerName: "Jordan Customer",
      portalIssuedAtISO: PORTAL_ISSUED_AT_ISO,
      portalExpiresAtISO: PORTAL_EXPIRES_AT_ISO,
      deliveryEvidence: {
        revisionId,
        state: "provider_accepted",
        portalActivationState: "active",
        portalKey: PORTAL_KEY,
        portalIssuedAtISO: PORTAL_ISSUED_AT_ISO,
        providerAcceptedAtISO
      }
    }
  };
}

function activate(status = "viewed", overrides = {}) {
  const documents = activeDocuments(status);
  return assertPortalConversationActivation({
    quote: documents.quote,
    quoteId: documents.quote.id,
    organizationId: documents.quote.organizationId,
    portalSnapshot: documents.portalSnapshot,
    requestedPortalKey: PORTAL_KEY,
    organizationActive: true,
    nowISO: NOW,
    assertPortalActivation: assertQuoteDeliveryPortalActivation,
    ...overrides
  });
}

describe("server-owned quote portal conversation", () => {
  test("accepts only bound staff or bearer inputs and rejects oversized bodies instead of truncating", () => {
    expect(normalizePortalConversationRequest({
      accessMode: "staff",
      organizationId: "org-a",
      quoteId: "quote-conversation"
    })).toMatchObject({ accessMode: "staff", organizationId: "org-a" });
    expect(normalizePortalConversationRequest({
      accessMode: "portal",
      portalKey: PORTAL_KEY,
      body: "Please confirm the arrival time.",
      clientRequestId: "conversation:request-0001"
    }, { requireBody: true })).toMatchObject({
      accessMode: "portal",
      body: "Please confirm the arrival time."
    });
    expect(() => normalizePortalConversationRequest({
      accessMode: "portal",
      portalKey: PORTAL_KEY,
      body: "x".repeat(PORTAL_CONVERSATION_BODY_MAX_LENGTH + 1),
      clientRequestId: "conversation:request-0002"
    }, { requireBody: true })).toThrow(/1200 characters or fewer/i);
    expect(() => normalizePortalConversationRequest({
      accessMode: "portal",
      portalKey: `${"p".repeat(128)}extra`
    })).toThrow(/portal token/i);
    expect(() => normalizePortalConversationRequest({
      accessMode: "portal",
      portalKey: PORTAL_KEY,
      body: "hello",
      clientRequestId: `${"r".repeat(96)}extra`
    }, { requireBody: true })).toThrow(/client request id/i);
  });

  test("validates opaque history cursors and builds a latest-50 chronological page", () => {
    expect(normalizePortalConversationCursor({
      createdAtMs: NOW_MS,
      messageId: "message_1234567890abcdef"
    })).toEqual({ createdAtMs: NOW_MS, messageId: "message_1234567890abcdef" });
    expect(() => normalizePortalConversationCursor({ createdAtMs: -1, messageId: "bad/id" }))
      .toThrow(/cursor is invalid/i);

    const documents = Array.from({ length: PORTAL_CONVERSATION_PAGE_SIZE + 1 }, (_, index) => ({
      id: `message_${String(100 - index).padStart(4, "0")}`,
      data: {
        messageId: `message_${String(100 - index).padStart(4, "0")}`,
        actorType: index % 2 ? "customer" : "staff",
        actorName: "Participant",
        body: `Message ${100 - index}`,
        createdAtISO: new Date(NOW_MS - index * 1000).toISOString(),
        createdAtMs: NOW_MS - index * 1000
      }
    }));
    const result = buildPortalConversationPage(documents);
    expect(result.messages).toHaveLength(PORTAL_CONVERSATION_PAGE_SIZE);
    expect(result.messages[0].messageId).toBe("message_0051");
    expect(result.messages.at(-1).messageId).toBe("message_0100");
    expect(result.page).toMatchObject({
      pageSize: PORTAL_CONVERSATION_PAGE_SIZE,
      returned: PORTAL_CONVERSATION_PAGE_SIZE,
      hasOlder: true,
      oldestCursor: { messageId: "message_0051" },
      newestCursor: { messageId: "message_0100" }
    });

    const catchUp = buildPortalConversationPage(documents.slice(0, 2).reverse(), {
      direction: "newer"
    });
    expect(catchUp.messages.map(({ messageId }) => messageId))
      .toEqual(["message_0099", "message_0100"]);
    expect(catchUp.page).toMatchObject({
      hasOlder: false,
      hasNewer: false,
      oldestCursor: { messageId: "message_0099" },
      newestCursor: { messageId: "message_0100" }
    });
  });

  test("accepts one history direction and rejects ambiguous cursor requests", () => {
    const cursor = { createdAtMs: NOW_MS, messageId: "message_1234567890abcdef" };
    expect(normalizePortalConversationRequest({
      accessMode: "staff",
      organizationId: "org-a",
      quoteId: "quote-conversation",
      after: cursor
    })).toMatchObject({ after: cursor, before: null });
    expect(() => normalizePortalConversationRequest({
      accessMode: "staff",
      organizationId: "org-a",
      quoteId: "quote-conversation",
      before: cursor,
      after: cursor
    })).toThrow(/cannot be combined/i);
    expect(FUNCTIONS_INDEX_SOURCE).toMatch(/catchUp \? "asc" : "desc"/);
    expect(FUNCTIONS_INDEX_SOURCE).toMatch(/input\.after\.createdAtMs, input\.after\.messageId/);
  });

  test.each(["sent", "viewed", "accepted", "booked"])(
    "allows read and send for the active provider-accepted %s issuance",
    (status) => {
      expect(activate(status)).toMatchObject({
        organizationId: "org-a",
        quoteId: "quote-conversation",
        portalKey: PORTAL_KEY
      });
      expect(activate(status, { operation: "send" })).toMatchObject({
        revisionId: expect.any(String)
      });
    }
  );

  test("keeps a declined conversation readable but rejects new messages server-side", () => {
    expect(activate("declined", { operation: "read" })).toMatchObject({
      portalKey: PORTAL_KEY
    });
    expect(() => activate("declined", { operation: "send" }))
      .toThrow(/declined.*read-only/i);
  });

  test("fails closed for old, expired, deleted, and provider-unaccepted portal state", () => {
    expect(() => activate("viewed", {
      requestedPortalKey: "rotated-portal-token-1234567890"
    })).toThrow(/does not match/i);
    const expired = activeDocuments("viewed");
    expired.quote.portalExpiresAtISO = "2026-08-06T17:59:59.000Z";
    expired.portalSnapshot.portalExpiresAtISO = "2026-08-06T17:59:59.000Z";
    expect(() => assertPortalConversationActivation({
      quote: expired.quote,
      quoteId: expired.quote.id,
      organizationId: expired.quote.organizationId,
      portalSnapshot: expired.portalSnapshot,
      requestedPortalKey: PORTAL_KEY,
      organizationActive: true,
      nowISO: NOW,
      assertPortalActivation: assertQuoteDeliveryPortalActivation
    })).toThrow(/expired/i);
    expect(() => activate("viewed", {
      quote: { ...activeDocuments("viewed").quote, deletedAtISO: NOW }
    })).toThrow(/not available/i);
    const unaccepted = activeDocuments("viewed");
    unaccepted.quote.workflow.quoteDelivery.state = "failed";
    expect(() => assertPortalConversationActivation({
      quote: unaccepted.quote,
      quoteId: unaccepted.quote.id,
      organizationId: unaccepted.quote.organizationId,
      portalSnapshot: unaccepted.portalSnapshot,
      requestedPortalKey: PORTAL_KEY,
      organizationActive: true,
      nowISO: NOW,
      assertPortalActivation: assertQuoteDeliveryPortalActivation
    })).toThrow(/not activated/i);
  });

  test("bounds total count and each actor's rolling send window", () => {
    expect(assertPortalConversationTotal(PORTAL_CONVERSATION_TOTAL_MESSAGE_LIMIT - 1))
      .toBe(PORTAL_CONVERSATION_TOTAL_MESSAGE_LIMIT);
    expect(() => assertPortalConversationTotal(PORTAL_CONVERSATION_TOTAL_MESSAGE_LIMIT))
      .toThrow(/message limit/i);
    const sends = Array.from(
      { length: PORTAL_CONVERSATION_RATE_LIMIT },
      (_, index) => NOW_MS - index * 1000
    );
    expect(() => planPortalConversationRate({ recentSendAtMs: sends, nowMs: NOW_MS }))
      .toThrow(/too many messages/i);
    expect(planPortalConversationRate({
      recentSendAtMs: [NOW_MS - 6 * 60 * 1000],
      nowMs: NOW_MS
    })).toEqual([NOW_MS]);
  });

  test("derives request, rate, actor, message, and timestamp fields on the server", () => {
    const activation = activate("accepted", { operation: "send" });
    const actor = buildPortalConversationActor({
      accessMode: "staff",
      staff: { uid: "staff-1", email: "owner@example.com", role: "admin" },
      authToken: { name: "Avery Owner" }
    });
    const actorRateKey = buildPortalConversationRateKey({
      accessMode: "staff",
      organizationId: "org-a",
      quoteId: "quote-conversation",
      staffUid: "staff-1"
    });
    expect(buildPortalConversationRequestKey({
      actorRateKey,
      clientRequestId: "conversation:request-0003"
    })).toMatch(/^request_[a-f0-9]{64}$/);
    const message = buildPortalConversationMessage({
      messageId: "message_1234567890abcdef",
      organizationId: "org-a",
      quoteId: "quote-conversation",
      activation,
      actor,
      body: "The arrival window is 4:30–5:00 PM.",
      nowISO: NOW,
      nowMs: NOW_MS
    });
    expect(message).toMatchObject({
      actorType: "staff",
      actorName: "Avery Owner",
      actorUid: "staff-1",
      createdAtISO: NOW,
      createdAtMs: NOW_MS,
      portalIssuance: {
        portalKeySha256: expect.stringMatching(/^[a-f0-9]{64}$/)
      }
    });
    expect(projectPortalConversationMessage(message)).toEqual({
      messageId: "message_1234567890abcdef",
      actorType: "staff",
      actorName: "Avery Owner",
      body: "The arrival window is 4:30–5:00 PM.",
      createdAtISO: NOW
    });
  });

  test("callables revalidate activation, transact messages, and never trust client actor/time/message ids", () => {
    const getStart = FUNCTIONS_INDEX_SOURCE.indexOf("exports.getQuotePortalConversation =");
    const sendStart = FUNCTIONS_INDEX_SOURCE.indexOf("exports.sendQuotePortalConversationMessage =");
    const nextStart = FUNCTIONS_INDEX_SOURCE.indexOf("async function createTrustedQuoteDraftInternal", sendStart);
    const getSource = FUNCTIONS_INDEX_SOURCE.slice(getStart, sendStart);
    const sendSource = FUNCTIONS_INDEX_SOURCE.slice(sendStart, nextStart);
    expect(getSource.match(/readBoundPortalConversationScope/g)).toHaveLength(2);
    expect(getSource).toContain('.limit(PORTAL_CONVERSATION_PAGE_SIZE + 1)');
    expect(getSource).toContain('startAfter(input.before.createdAtMs, input.before.messageId)');
    expect(sendSource).toContain("db.runTransaction");
    expect(sendSource).toContain('operation: "send"');
    expect(sendSource).toContain("randomUUID()");
    expect(sendSource).toContain("Timestamp.fromMillis(nowMs)");
    expect(sendSource).toContain("conversationSummary");
    expect(sendSource).toContain("latestActorType: message.actorType");
    expect(sendSource).toContain("messageCount: nextMessageCount");
    for (const forbidden of ["data?.actorType", "data?.actorName", "data?.messageId", "data?.createdAtISO"]) {
      expect(sendSource).not.toContain(forbidden);
    }
  });

  test("new sends atomically project a body-free signal to the exact current portal after retry reconciliation", () => {
    const sendStart = FUNCTIONS_INDEX_SOURCE.indexOf("exports.sendQuotePortalConversationMessage =");
    const nextStart = FUNCTIONS_INDEX_SOURCE.indexOf("async function createTrustedQuoteDraftInternal", sendStart);
    const sendSource = FUNCTIONS_INDEX_SOURCE.slice(sendStart, nextStart);
    const idempotentReturnIndex = sendSource.indexOf("idempotent: true");
    const summaryStart = sendSource.indexOf("const conversationSummary = {");
    const summaryEnd = sendSource.indexOf("};", summaryStart);
    const summarySource = sendSource.slice(summaryStart, summaryEnd);
    const portalProjectionIndex = sendSource.indexOf(
      "db.collection(PORTAL_COLLECTION).doc(scope.activation.portalKey)"
    );

    expect(idempotentReturnIndex).toBeGreaterThan(-1);
    expect(summaryStart).toBeGreaterThan(idempotentReturnIndex);
    expect(portalProjectionIndex).toBeGreaterThan(summaryStart);
    expect(summarySource).toContain("schemaVersion: 1");
    expect(summarySource).toContain("messageCount: nextMessageCount");
    expect(summarySource).toContain("latestMessageId: generatedMessageId");
    expect(summarySource).toContain("latestMessageAtISO: nowISO");
    expect(summarySource).toContain("latestActorType: message.actorType");
    for (const privateField of [
      "body",
      "bodySha256",
      "actorName",
      "actorUid",
      "actorRole",
      "portalKeySha256"
    ]) {
      expect(summarySource).not.toContain(privateField);
    }
    expect(sendSource).toContain("{ conversationSummary },\n        { merge: true }");
  });
});
