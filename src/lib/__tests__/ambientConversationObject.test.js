import { describe, expect, test } from "vitest";
import {
  AMBIENT_CONVERSATION_OBJECT_MODEL,
  buildAmbientConversationObject
} from "../ambientConversationObject";

function quote(overrides = {}) {
  return {
    id: "quote-conversation-proof",
    organizationId: "org-conversation-proof",
    quoteNumber: "Q-2084",
    activeVersionId: "v0007",
    status: "sent",
    createdAtISO: "2026-08-12T12:00:00.000Z",
    updatedAtISO: "2026-08-12T14:00:00.000Z",
    customer: { name: "Amara Fields" },
    event: { name: "Fields Anniversary Dinner" },
    lifecycle: { sentAtISO: "2026-08-12T13:00:00.000Z" },
    workflow: {
      quoteDelivery: {
        state: "provider_accepted",
        revisionId: "v0007@2026-08-12T12:55:00.000Z",
        providerMessageId: "resend_message_2084",
        providerAcceptedAtISO: "2026-08-12T13:00:01.000Z"
      },
      followUp: {}
    },
    conversationSummary: {
      messageCount: 1,
      latestMessageId: "message_staff_1",
      latestMessageAtISO: "2026-08-12T13:05:00.000Z",
      latestActorType: "staff"
    },
    ...overrides
  };
}

function build(input = quote(), options = {}) {
  return buildAmbientConversationObject(input, {
    sourceMode: "firebase",
    sourceFreshness: "fresh",
    role: "sales",
    todayISO: "2026-08-12",
    conversationAccess: { available: true, readOnly: false },
    ...options
  });
}

describe("Ambient Conversation intelligent object", () => {
  test("keeps five communication truths separate and does not upgrade provider acceptance", () => {
    const model = build();
    expect(model.modelId).toBe(AMBIENT_CONVERSATION_OBJECT_MODEL);
    expect(model.evidence.map((entry) => entry.id)).toEqual([
      "sent",
      "provider-delivered",
      "portal-viewed",
      "replied",
      "inferred-engagement"
    ]);
    expect(model.evidenceById.sent).toMatchObject({
      state: "recorded",
      evidenceAuthority: "quote_lifecycle"
    });
    expect(model.evidenceById["provider-delivered"]).toMatchObject({
      state: "provider_accepted_only",
      outcome: "provider_accepted"
    });
    expect(model.evidenceById["portal-viewed"].state).toBe("not_recorded");
    expect(model.evidenceById.replied.state).toBe("latest_staff_message");
    expect(model.evidenceById["inferred-engagement"].state).toBe("unsupported");
    expect(model.descriptor.dependencies).toHaveLength(5);
    expect(model.boundary).toMatch(/performs no I\/O/iu);
  });

  test("never infers viewed or replied from status, availability, or unrelated timestamps", () => {
    const model = build(quote({
      status: "viewed",
      lifecycle: {
        sentAtISO: "2026-08-12T13:00:00.000Z",
        acceptedAtISO: "2026-08-12T13:30:00.000Z"
      },
      conversationSummary: undefined
    }));
    expect(model.access.available).toBe(true);
    expect(model.evidenceById["portal-viewed"].state).toBe("not_recorded");
    expect(model.evidenceById.replied.state).toBe("not_recorded");
    expect(model.evidenceById["portal-viewed"].reason).toMatch(/does not imply a view/iu);
    expect(model.evidenceById.replied.reason).toMatch(/do not imply a reply/iu);
  });

  test("accepts provider delivery only from an exact signed provider event", () => {
    const exact = build(quote(), {
      providerDeliveryEvidence: {
        sourceId: "resend-event-delivered-2084",
        sourceLabel: "Verified Resend delivery webhook",
        source: "verified_provider_webhook",
        signatureVerified: true,
        provider: "resend",
        state: "delivered",
        organizationId: "org-conversation-proof",
        quoteId: "quote-conversation-proof",
        revisionId: "v0007@2026-08-12T12:55:00.000Z",
        providerMessageId: "resend_message_2084",
        occurredAtISO: "2026-08-12T13:00:03.000Z"
      }
    });
    expect(exact.evidenceById["provider-delivered"]).toMatchObject({
      state: "verified_delivered",
      outcome: "delivered",
      evidenceAuthority: "verified_provider_webhook"
    });
    expect(exact.evidenceById["portal-viewed"].state).toBe("not_recorded");
    expect(exact.evidenceById.replied.state).toBe("latest_staff_message");

    const wrongScope = build(quote(), {
      providerDeliveryEvidence: {
        source: "verified_provider_webhook",
        signatureVerified: true,
        provider: "resend",
        state: "delivered",
        organizationId: "another-org",
        quoteId: "quote-conversation-proof",
        revisionId: "v0007",
        providerMessageId: "resend_message_2084",
        occurredAtISO: "2026-08-12T13:00:03.000Z"
      }
    });
    expect(wrongScope.evidenceById["provider-delivered"].state).toBe("unavailable");
    expect(wrongScope.state).toBe("needs_reconciliation");
  });

  test("surfaces the exact latest customer reply without claiming read or resolution", () => {
    const model = build(quote({
      conversationSummary: {
        messageCount: 2,
        latestMessageId: "message_customer_2",
        latestMessageAtISO: "2026-08-12T13:12:00.000Z",
        latestActorType: "customer"
      }
    }));
    expect(model.state).toBe("attention");
    expect(model.evidenceById.replied).toMatchObject({
      state: "latest_customer_reply",
      messageCount: 2,
      latestMessageId: "message_customer_2",
      latestActorType: "customer"
    });
    expect(model.nextResolution).toMatchObject({
      id: "review-latest-customer-reply",
      availability: "available"
    });
    expect(model.evidenceById.replied.consequence).toMatch(/does not prove the message was read/iu);
    expect(model.descriptor.doNothing).toMatch(/no reply is marked read/iu);
  });

  test("fails closed on a contradictory conversation summary", () => {
    const model = build(quote({
      conversationSummary: {
        messageCount: 0,
        latestMessageId: "message_impossible",
        latestMessageAtISO: "2026-08-12T13:12:00.000Z",
        latestActorType: "customer"
      }
    }));
    expect(model.evidenceById.replied.state).toBe("unavailable");
    expect(model.state).toBe("needs_reconciliation");
    expect(model.confidence.level).toBe("unavailable");
  });

  test("keeps a bounded advisory engagement inference distinct from direct evidence", () => {
    const model = build(quote(), {
      engagementInference: {
        organizationId: "org-conversation-proof",
        quoteId: "quote-conversation-proof",
        claim: "The customer may be comparing menu alternatives.",
        reason: "Three customer-originated option questions reference menu substitutions.",
        consequence: "A concise comparison may reduce decision effort, but no purchase intent is established.",
        observedAtISO: "2026-08-12T13:15:00.000Z",
        confidence: {
          level: "medium",
          basis: "The claim is bounded to recorded question categories and excludes behavior scoring."
        },
        sourceId: "bounded-question-pattern-2084",
        sourceLabel: "Bounded customer question pattern",
        sourceType: "deterministic_question_category_summary"
      }
    });
    expect(model.evidenceById["inferred-engagement"]).toMatchObject({
      state: "advisory",
      evidenceAuthority: "bounded_advisory_inference",
      claim: "The customer may be comparing menu alternatives."
    });
    expect(model.evidenceById["portal-viewed"].state).toBe("not_recorded");
    expect(model.evidenceById.replied.state).toBe("latest_staff_message");

    const overclaimed = build(quote(), {
      engagementInference: {
        organizationId: "org-conversation-proof",
        quoteId: "quote-conversation-proof",
        claim: "The customer will buy.",
        reason: "A timestamp exists.",
        consequence: "Treat this as certain.",
        observedAtISO: "2026-08-12T13:15:00.000Z",
        confidence: { level: "high", basis: "Unsupported certainty." },
        sourceId: "bad-score",
        sourceLabel: "Unsupported score",
        sourceType: "unsupported"
      }
    });
    expect(overclaimed.evidenceById["inferred-engagement"].state).toBe("unavailable");
  });

  test("exposes exact change-request and follow-up resolutions without performing them", () => {
    const input = quote({
      portalDecision: {
        decision: "changes_requested",
        requestId: "request-2084",
        submittedAtISO: "2026-08-12T13:20:00.000Z",
        message: "Please swap the salad and move dinner to 7 PM."
      },
      workflow: {
        ...quote().workflow,
        changeRequestHandling: {},
        followUp: {
          stage: "awaiting_response",
          dueDate: "2026-08-11",
          completed: false,
          note: "Confirm menu and schedule."
        }
      }
    });
    const before = JSON.stringify(input);
    const model = build(input);
    expect(model.changeRequest).toMatchObject({
      state: "open",
      requestId: "request-2084"
    });
    expect(model.followUp.state).toBe("overdue");
    expect(model.resolutions.find((entry) => entry.id === "review-customer-change-request"))
      .toMatchObject({
        availability: "available",
        target: {
          surfaceId: "workflow",
          quoteId: "quote-conversation-proof",
          attentionType: "change_request",
          requestId: "request-2084"
        }
      });
    expect(model.resolutions.find((entry) => entry.id === "review-opportunity-follow-up"))
      .toMatchObject({
        availability: "available",
        target: {
          surfaceId: "workflow",
          quoteId: "quote-conversation-proof",
          attentionType: "follow_up",
          requestId: "follow-up:quote-conversation-proof"
        }
      });
    expect(JSON.stringify(input)).toBe(before);
    expect(Object.isFrozen(model)).toBe(true);
    expect(Object.isFrozen(model.evidence)).toBe(true);
    expect(Object.isFrozen(model.resolutions)).toBe(true);
  });

  test("blocks a change-request Workflow handoff when its exact request identity is absent", () => {
    const model = build(quote({
      portalDecision: {
        decision: "changes_requested",
        submittedAtISO: "2026-08-12T13:20:00.000Z",
        message: "Please move dinner to 7 PM."
      }
    }));
    const resolution = model.resolutions.find((entry) => (
      entry.id === "review-customer-change-request"
    ));

    expect(model.changeRequest).toMatchObject({ state: "open", requestId: "" });
    expect(resolution).toMatchObject({
      availability: "blocked",
      reason: expect.stringContaining("no exact request identity"),
      target: {
        surfaceId: "workflow",
        quoteId: "quote-conversation-proof",
        attentionType: "change_request",
        requestId: ""
      }
    });
  });

  test("distinguishes internal handling and completion from customer communication", () => {
    const model = build(quote({
      portalDecision: {
        decision: "changes_requested",
        requestId: "request-2084",
        submittedAtISO: "2026-08-12T13:20:00.000Z",
        message: "Please move dinner to 7 PM."
      },
      workflow: {
        ...quote().workflow,
        changeRequestHandling: {
          state: "handled",
          sourceRequestId: "request-2084",
          sourceSubmittedAtISO: "2026-08-12T13:20:00.000Z",
          sourceMessage: "Please move dinner to 7 PM.",
          handledAtISO: "2026-08-12T13:35:00.000Z"
        },
        followUp: {
          stage: "won",
          completed: true,
          completedAtISO: "2026-08-12T13:40:00.000Z"
        }
      }
    }));
    expect(model.changeRequest.state).toBe("handled_internal");
    expect(model.followUp.state).toBe("completed_internal");
    expect(model.changeRequest.reason).toMatch(/not a customer reply or quote revision receipt/iu);
    expect(model.followUp.reason).toMatch(/does not prove customer contact or reply/iu);
  });

  test("shows stale and local facts without strengthening them", () => {
    const stale = build(quote(), { sourceFreshness: "stale" });
    expect(stale.state).toBe("stale");
    expect(stale.freshness.state).toBe("stale");
    expect(stale.evidenceById.sent.state).toBe("stale");

    const local = build(quote(), { sourceMode: "local" });
    expect(local.state).toBe("local_preview");
    expect(local.evidenceById.sent.state).toBe("local_unverified");
    expect(local.evidenceById.replied.state).toBe("local_unverified");
    expect(local.descriptor.permissions.commit).toBe(false);
  });
});
