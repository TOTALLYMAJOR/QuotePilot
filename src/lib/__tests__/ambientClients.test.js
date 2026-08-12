import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { describe, expect, test } from "vitest";
import {
  AMBIENT_CLIENT_RELATIONSHIP_MODEL,
  AMBIENT_CLIENT_RELATIONSHIP_SURFACE,
  AMBIENT_CLIENTS_LIST_SURFACE,
  AMBIENT_CLIENTS_MODEL,
  buildAmbientClientRelationship,
  buildAmbientClientsDirectory
} from "../ambientClients";

const LOADED_AT = "2026-08-12T15:00:00.000Z";
const ORGANIZATION_ID = "org-clients";
const CLIENT_ID = "client-avery";

function quote(overrides = {}) {
  return {
    id: "quote-avery-1",
    organizationId: ORGANIZATION_ID,
    customerId: CLIENT_ID,
    quoteNumber: "QP-2041",
    status: "draft",
    updatedAtISO: "2026-08-12T14:00:00.000Z",
    customer: { name: "Avery Bennett", email: "avery@example.test" },
    event: {
      name: "Bennett celebration",
      date: "2026-10-10",
      time: "18:00"
    },
    payment: { depositStatus: "unpaid" },
    ...overrides
  };
}

function workspace(overrides = {}) {
  const quotes = overrides.quotes || [quote()];
  return {
    source: "firebase",
    customer: {
      id: CLIENT_ID,
      customerId: CLIENT_ID,
      name: "Avery Bennett",
      company: "Bennett Foundation",
      email: "avery@example.test",
      phone: "512-555-0101"
    },
    quotes,
    activeQuotes: quotes,
    events: [],
    conversations: quotes.map((entry) => ({
      quoteId: entry.id,
      quoteNumber: entry.quoteNumber,
      summaryAvailable: false,
      messageCount: null,
      latestMessageAtISO: null,
      latestActorType: ""
    })),
    recentActivity: [],
    attention: { itemCount: 0, items: [] },
    briefing: {
      displayedQuoteCount: quotes.length,
      activeQuoteCount: quotes.length,
      attentionCount: 0,
      nextEvent: null,
      latestActivity: null
    },
    quotePageInfo: { limit: 25, truncated: false },
    versionPageInfo: { perQuoteLimit: 10, truncatedQuoteIds: [] },
    ...overrides,
    quotes
  };
}

function relationship(options = {}) {
  return buildAmbientClientRelationship({
    workspace: workspace(),
    source: "firebase",
    loadedAt: LOADED_AT,
    currentUserRole: "sales",
    tenantTimeZone: "America/Chicago",
    capabilities: {
      openOpportunity: true,
      openWorkflow: true,
      openConversation: true,
      reviewRebook: true,
      reviewContext: true,
      refresh: true
    },
    ...options
  });
}

describe("Ambient Clients contracts", () => {
  test("declares purpose-bearing bounded-list and exact-relationship surfaces", () => {
    expect(AMBIENT_CLIENTS_LIST_SURFACE).toMatchObject({
      id: "ambient-clients-list",
      objectScopes: ["client", "customer-directory-record"],
      allowedEmptyState: { kind: "starting_action", actionId: "start-client-opportunity" }
    });
    expect(AMBIENT_CLIENT_RELATIONSHIP_SURFACE).toMatchObject({
      id: "ambient-client-relationship",
      allowedEmptyState: { kind: "caught_up" }
    });
    expect(Object.isFrozen(AMBIENT_CLIENTS_LIST_SURFACE)).toBe(true);
    expect(Object.isFrozen(AMBIENT_CLIENT_RELATIONSHIP_SURFACE)).toBe(true);
  });
});

describe("buildAmbientClientsDirectory", () => {
  test("uses only recorded directory details and gives each exact client one Review client action", () => {
    const result = buildAmbientClientsDirectory({
      state: {
        source: "firebase",
        loadedAt: LOADED_AT,
        loading: false,
        stale: false,
        error: "",
        nextCursor: "",
        items: [{
          id: CLIENT_ID,
          customerId: CLIENT_ID,
          name: "Avery Bennett",
          company: "Bennett Foundation",
          email: "avery@example.test",
          phone: "512-555-0101",
          lastQuoteId: "quote-avery-1",
          lastQuoteNumber: "QP-2041",
          lastEventName: "Bennett celebration",
          lastEventDate: "2026-10-10"
        }]
      },
      currentUserRole: "sales",
      capabilities: { openClient: true }
    });

    expect(result.modelId).toBe(AMBIENT_CLIENTS_MODEL);
    expect(result.surfaceContract).toBe(AMBIENT_CLIENTS_LIST_SURFACE);
    expect(result.state).toBe("ready");
    expect(result.rows).toHaveLength(1);
    expect(result.rows[0]).toMatchObject({
      customerId: CLIENT_ID,
      identity: {
        name: "Avery Bennett",
        company: "Bennett Foundation",
        email: "avery@example.test",
        lastQuoteId: "quote-avery-1",
        lastQuoteNumber: "QP-2041",
        lastEventName: "Bennett celebration",
        lastEventDate: "2026-10-10"
      },
      primaryAction: {
        outcomeLabel: "Review client",
        primary: true,
        enabled: true,
        authorityLevel: "presentation",
        executionTarget: {
          targetId: CLIENT_ID,
          surfaceId: "ambient-client-relationship"
        },
        arrivalContract: {
          object: { id: CLIENT_ID, type: "client", label: "Avery Bennett" }
        }
      }
    });
    expect(result.rows[0]).not.toHaveProperty("activeOpportunityCount");
    expect(JSON.stringify(result)).not.toMatch(/unread|lifetime/iu);
  });

  test("keeps stale pages visible, qualifies pagination, and disables unavailable navigation", () => {
    const result = buildAmbientClientsDirectory({
      state: {
        source: "local",
        loadedAt: LOADED_AT,
        stale: true,
        error: "The latest refresh did not finish.",
        nextCursor: "next-client",
        items: [{ id: CLIENT_ID, customerId: CLIENT_ID, name: "Avery Bennett" }]
      }
    });

    expect(result.state).toBe("stale");
    expect(result.boundary).toMatchObject({
      source: "local",
      truncated: true,
      currentComplete: false
    });
    expect(result.boundary.sourceBoundary).toContain("saved in this browser");
    expect(result.boundary.notes.join(" ")).toContain("not the full client list");
    expect(result.rows[0].primaryAction).toMatchObject({ enabled: false, primary: true });
  });

  test("omits malformed, duplicate, and explicitly cross-organization rows", () => {
    const result = buildAmbientClientsDirectory({
      state: {
        organizationId: ORGANIZATION_ID,
        source: "firebase",
        loadedAt: LOADED_AT,
        items: [
          { id: CLIENT_ID, customerId: CLIENT_ID, organizationId: ORGANIZATION_ID, name: "Avery" },
          { id: CLIENT_ID, customerId: CLIENT_ID, organizationId: ORGANIZATION_ID, name: "Duplicate" },
          { id: "client-other", customerId: "client-other", organizationId: "other-org", name: "Other" },
          { id: "client/bad", customerId: "client/bad", organizationId: ORGANIZATION_ID }
        ]
      },
      capabilities: { openClient: true }
    });

    expect(result.rows.map((row) => row.customerId)).toEqual([CLIENT_ID]);
    expect(result.omittedRecords).toHaveLength(3);
    expect(result.state).toBe("bounded");
  });
});

describe("buildAmbientClientRelationship", () => {
  test("projects bounded relationship context, active opportunities, conversations, and exact rebook entries", () => {
    const sourceQuote = quote({
      id: "quote-booked",
      quoteNumber: "QP-BOOKED",
      status: "booked",
      updatedAtISO: "2026-08-11T12:00:00.000Z"
    });
    const currentWorkspace = workspace({
      quotes: [sourceQuote],
      conversations: [{
        quoteId: sourceQuote.id,
        quoteNumber: sourceQuote.quoteNumber,
        summaryAvailable: true,
        messageCount: 3,
        latestMessageAtISO: "2026-08-12T14:30:00.000Z",
        latestActorType: "customer"
      }],
      recentActivity: [{
        quoteId: sourceQuote.id,
        label: "Proposal accepted",
        atISO: "2026-08-11T12:00:00.000Z"
      }],
      briefing: {
        nextEvent: {
          quoteId: sourceQuote.id,
          eventName: "Bennett celebration",
          date: "2026-10-10",
          time: "18:00"
        }
      }
    });
    const radar = {
      organizationId: ORGANIZATION_ID,
      customerId: CLIENT_ID,
      pageInfo: { truncated: false },
      opportunities: [{
        id: "anniversary-entry-1",
        type: "anniversary_rebooking",
        title: "Bennett celebration was held this week last year",
        quoteId: sourceQuote.id,
        event: { name: "Bennett celebration", date: "2025-08-12" },
        timing: { anniversaryDate: "2026-08-12" },
        reviewedAction: {
          state: "ready_for_staff_review",
          sourceQuoteId: sourceQuote.id,
          sourceVersionId: "v0002"
        }
      }]
    };
    const result = relationship({ workspace: currentWorkspace, rebookingRadar: radar });

    expect(result.modelId).toBe(AMBIENT_CLIENT_RELATIONSHIP_MODEL);
    expect(result.surfaceContract).toBe(AMBIENT_CLIENT_RELATIONSHIP_SURFACE);
    expect(result.client).toMatchObject({ clientId: CLIENT_ID, name: "Avery Bennett" });
    expect(result.relationshipContext).toMatchObject({
      displayedOpportunityCount: 1,
      activeOpportunityCount: 1,
      attentionCount: 0,
      countsAreBounded: true,
      nextEvent: { quoteId: "quote-booked" },
      latestActivity: { label: "Proposal accepted" }
    });
    expect(result.activeOpportunities[0]).toMatchObject({ quoteId: "quote-booked", status: "booked" });
    expect(result.conversations[0]).toMatchObject({
      quoteId: "quote-booked",
      messageCount: 3,
      latestActorType: "customer",
      unreadState: "not_inferred"
    });
    expect(result.conversations[0].latestActivity).toBe("Latest recorded message came from customer.");
    expect(result.rebookEntries[0]).toMatchObject({
      id: "anniversary-entry-1",
      exactSource: true,
      state: "ready_for_staff_review",
      sourceVersionId: "v0002"
    });
    expect(result.primaryAction.outcomeLabel).toBe("Review repeat-event option");
    expect(result.primaryTarget).toEqual({
      kind: "rebook",
      entryId: "anniversary-entry-1",
      quoteId: "quote-booked"
    });
  });

  test("ranks exact authority, customer-originated, and deadline work ahead of later options", () => {
    const baseQuote = quote({ status: "accepted" });
    const attentionItems = [
      {
        id: "follow-up:quote-avery-1",
        type: "follow_up",
        state: "overdue",
        quoteId: baseQuote.id,
        dateISO: "2026-08-10"
      },
      {
        id: "change-request:quote-avery-1:request-1",
        type: "change_request",
        state: "new",
        quoteId: baseQuote.id,
        sourceRequestId: "request-1",
        dateISO: "2026-08-11T10:00:00.000Z"
      },
      {
        id: "approval:quote-avery-1",
        type: "approval",
        state: "pending",
        quoteId: baseQuote.id,
        dateISO: "2026-08-12T10:00:00.000Z",
        pendingRequests: [{ id: "approval-1" }]
      }
    ];
    const result = relationship({
      workspace: workspace({
        quotes: [baseQuote],
        attention: { itemCount: attentionItems.length, items: attentionItems }
      })
    });

    expect(result.primaryAction).toMatchObject({
      outcomeLabel: "Review pending approval",
      purpose: "resolve",
      executionTarget: { targetId: "approval-1", surfaceId: "workflow" }
    });
    expect(result.primaryTarget).toEqual({
      kind: "workflow",
      quoteId: baseQuote.id,
      attentionType: "approval",
      requestId: "approval-1"
    });
  });

  test.each([
    [
      "change_request",
      { id: "change-request:q:one", state: "new", sourceRequestId: "request-one" },
      "Review requested changes",
      "workflow"
    ],
    [
      "unread_customer_reply",
      { id: "unread-reply:attention-one", state: "open", attentionId: "attention-one", messageId: "message-one" },
      "Review customer reply",
      "messages"
    ],
    [
      "follow_up",
      { id: "follow-up:q", state: "due_today", dateISO: "2026-08-12" },
      "Review today’s follow-up",
      "workflow"
    ]
  ])("uses exact %s evidence without strengthening it", (type, item, label, targetKind) => {
    const currentQuote = quote();
    const result = relationship({
      workspace: workspace({
        quotes: [currentQuote],
        attention: {
          itemCount: 1,
          items: [{ ...item, type, quoteId: currentQuote.id }]
        }
      })
    });

    expect(result.primaryAction.outcomeLabel).toBe(label);
    expect(result.primaryTarget.kind).toBe(targetKind);
    expect(result.primaryAction.arrivalContract.consequence).toMatch(/without|does not/iu);
  });

  test("does not turn a latest-from-customer summary into unread or reply-needed work", () => {
    const currentQuote = quote();
    const result = relationship({
      workspace: workspace({
        quotes: [currentQuote],
        conversations: [{
          quoteId: currentQuote.id,
          quoteNumber: currentQuote.quoteNumber,
          summaryAvailable: true,
          messageCount: 2,
          latestMessageAtISO: "2026-08-12T14:00:00.000Z",
          latestActorType: "customer"
        }],
        attention: { itemCount: 0, items: [] }
      })
    });

    expect(result.primaryAction.outcomeLabel).toBe("Review opportunity");
    expect(result.primaryTarget).toEqual({ kind: "opportunity", quoteId: currentQuote.id });
    expect(result.conversations[0]).toMatchObject({ unreadState: "not_inferred" });
    expect(result.primaryAction.outcomeLabel).not.toMatch(/reply|unread/iu);
  });

  test("ranks accepted-without-deposit before rebook and active-opportunity context", () => {
    const accepted = quote({ status: "accepted", payment: { depositStatus: "unpaid" } });
    const result = relationship({ workspace: workspace({ quotes: [accepted] }) });

    expect(result.primaryAction.outcomeLabel).toBe("Review deposit next step");
    expect(result.primaryTarget).toEqual({
      kind: "opportunity",
      quoteId: accepted.id,
      focus: "money"
    });
    expect(result.primaryAction.arrivalContract.reason).toContain("provider-confirmed deposit is not recorded");
  });

  test("uses calm caught-up context only for a current complete view with no active next step", () => {
    const inactive = quote({ id: "quote-declined", status: "declined" });
    const result = relationship({
      workspace: workspace({ quotes: [inactive] })
    });

    expect(result.primaryAction.outcomeLabel).toBe("Review relationship history");
    expect(result.primaryTarget).toEqual({ kind: "client_context", clientId: CLIENT_ID });
    expect(result.caughtUp.eligible).toBe(true);
    expect(result.caughtUp.reason).toContain("not a lifetime-history");
    expect(result.caughtUp.reason).not.toMatch(/ready|optimized|healthy/iu);
  });

  test("withholds caught-up language for stale, truncated, unknown-source, or invalid-time-zone views", () => {
    const inactiveWorkspace = workspace({ quotes: [quote({ status: "declined" })] });
    const cases = [
      relationship({ workspace: inactiveWorkspace, stale: true }),
      relationship({
        workspace: {
          ...inactiveWorkspace,
          quotePageInfo: { limit: 25, truncated: true }
        }
      }),
      relationship({ workspace: inactiveWorkspace, source: "unknown" }),
      relationship({ workspace: inactiveWorkspace, tenantTimeZone: "not/a-time-zone" })
    ];

    cases.forEach((result, index) => {
      expect(result.caughtUp.eligible).toBe(false);
      expect(result.state).toBe(index === 0 ? "stale" : "bounded");
    });
  });

  test("fails closed for malformed clients, cross-client opportunities, and mismatched radar scope", () => {
    const malformed = relationship({
      workspace: workspace({
        customer: { id: "bad/client", customerId: "bad/client", name: "Bad" },
        quotes: []
      })
    });
    expect(malformed).toMatchObject({
      state: "unavailable",
      client: null,
      primaryAction: null,
      caughtUp: { eligible: false }
    });

    const scoped = relationship({
      workspace: workspace({
        quotes: [
          quote(),
          quote({ id: "quote-other", customerId: "other-client" })
        ]
      }),
      rebookingRadar: {
        organizationId: "other-org",
        customerId: CLIENT_ID,
        pageInfo: { truncated: false },
        opportunities: []
      }
    });
    expect(scoped.state).toBe("bounded");
    expect(scoped.boundary.scopeValid).toBe(false);
    expect(scoped.omittedRecords).toHaveLength(1);
    expect(scoped.rebookEntries).toEqual([]);
    expect(scoped.caughtUp.eligible).toBe(false);
    expect(scoped.activeOpportunities.map((entry) => entry.quoteId)).toEqual(["quote-avery-1"]);
  });

  test("is deeply frozen, leaves caller data unchanged, and contains no data-access dependency", () => {
    const input = workspace();
    const before = structuredClone(input);
    const result = relationship({ workspace: input });
    const source = readFileSync(
      fileURLToPath(new URL("../ambientClients.js", import.meta.url)),
      "utf8"
    );

    expect(input).toEqual(before);
    expect(Object.isFrozen(result)).toBe(true);
    expect(Object.isFrozen(result.activeOpportunities)).toBe(true);
    expect(Object.isFrozen(result.primaryAction)).toBe(true);
    expect(source).not.toMatch(/from ["']\.\/(?:customerWorkspace|quoteStore|firebase|authClient)/u);
    expect(source).not.toMatch(/\b(?:fetch|httpsCallable|collection|getDocs|getDoc|query)\s*\(/u);
  });
});
