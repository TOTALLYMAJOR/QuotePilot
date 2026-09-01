import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { describe, expect, test } from "vitest";
import {
  AMBIENT_OPPORTUNITIES_SURFACE_CONTRACT,
  AMBIENT_OPPORTUNITY_STREAM_MODEL,
  buildAmbientOpportunityStream
} from "../ambientOpportunityStream";

const NOW_ISO = "2026-08-12T15:00:00.000Z";
const READ_BOUNDARY = Object.freeze({
  complete: true,
  loading: false,
  partial: false,
  stale: false,
  truncated: false,
  truncationKnown: true,
  loadedAtISO: "2026-08-12T14:59:00.000Z"
});

function completeQuote(overrides = {}) {
  return {
    id: "quote-ambient-1",
    quoteNumber: "QP-1842",
    status: "accepted",
    customer: {
      name: "Avery Bennett",
      email: "avery@example.com",
      phone: "512-555-0101"
    },
    event: {
      name: "Bennett celebration",
      date: "2026-09-20",
      time: "18:00",
      venue: "The Glass House",
      guests: 120,
      hours: 5
    },
    selection: {
      packageId: "plated-dinner",
      menuItemNames: ["Herb chicken"]
    },
    totals: { total: 11736.56 },
    booking: { confirmationStatus: "pending" },
    payment: {
      depositStatus: "sent",
      finalBalance: { status: "unpaid" }
    },
    workflow: {},
    ...overrides
  };
}

function build(options = {}) {
  return buildAmbientOpportunityStream({
    quotes: [completeQuote()],
    source: "firebase",
    readBoundary: READ_BOUNDARY,
    currentUserRole: "sales",
    capabilities: { openOpportunity: true, openWorkflow: true },
    nowISO: NOW_ISO,
    ...options
  });
}

describe("buildAmbientOpportunityStream", () => {
  test("projects identity and keeps lifecycle, booking, deposit, and final balance exact and separate", () => {
    const result = build({
      quotes: [completeQuote({
        status: "booked",
        booking: { confirmationStatus: "confirmed" },
        payment: {
          depositStatus: "paid",
          finalBalance: { status: "paid", stripeCheckoutState: "failed" }
        }
      })]
    });
    const row = result.rows[0];

    expect(result.modelId).toBe(AMBIENT_OPPORTUNITY_STREAM_MODEL);
    expect(result.surfaceContract).toBe(AMBIENT_OPPORTUNITIES_SURFACE_CONTRACT);
    expect(row.identity).toMatchObject({
      quoteId: "quote-ambient-1",
      quoteNumber: "QP-1842",
      eventName: "Bennett celebration",
      customerName: "Avery Bennett",
      eventDate: "Sep 20, 2026",
      guests: "120"
    });
    expect(row.statusFacts.lifecycle.value).toBe("Booked");
    expect(row.statusFacts.booking.value).toBe("Confirmed");
    expect(row.statusFacts.deposit.value).toBe("Deposit paid");
    expect(row.statusFacts.finalBalance.value).toBe("Balance paid");
    expect(new Set(Object.values(row.statusFacts).map((fact) => fact.value)).size).toBe(4);
  });

  test("keeps four momentum dimensions and permits a percentage only for proposal completeness", () => {
    const row = build().rows[0];

    expect(Object.keys(row.momentum.domains)).toEqual([
      "proposal",
      "commercial",
      "customer",
      "operational"
    ]);
    expect(row.momentum.domains.proposal).toMatchObject({
      kind: "proposal_completeness",
      state: "healthy",
      completenessPercent: 100
    });
    expect(row.momentum.domains.commercial).toMatchObject({
      kind: "commercial_health",
      state: "unavailable"
    });
    expect(row.momentum.domains.commercial.reason).toContain(
      "has not been checked against current pricing"
    );
    expect(row.momentum.domains.customer).toMatchObject({
      kind: "customer_state",
      state: "healthy",
      summary: "Recorded lifecycle: Accepted."
    });
    expect(row.momentum.domains.operational).toMatchObject({
      kind: "operational_evidence",
      state: "unavailable"
    });

    for (const [domain, value] of Object.entries(row.momentum.domains)) {
      if (domain === "proposal") continue;
      expect(Object.keys(value).join(" ")).not.toMatch(/score|percent|readiness/iu);
    }
    expect(Object.keys(row.momentum).join(" ")).not.toMatch(/score|percent|readiness/iu);
    expect(row.primaryAction.outcomeLabel).toBe("Open Bennett celebration");
  });

  test("keeps proposal momentum healthy when only recommended phone enrichment is missing", () => {
    const row = build({
      quotes: [completeQuote({
        customer: {
          ...completeQuote().customer,
          phone: ""
        }
      })]
    }).rows[0];

    expect(row.momentum.domains.proposal).toMatchObject({
      state: "healthy",
      completenessPercent: 100,
      summary: "All required proposal fields are recorded; 1 recommended contact detail remains."
    });
    expect(row.momentum.domains.proposal.evidence).toEqual([{
      model: "proposal-readiness-v1",
      criteriaCount: 11,
      recordedCriteriaCount: 11,
      recommendedGapCount: 1
    }]);
    expect(row.primaryAction).toMatchObject({
      id: "open-opportunity:quote-ambient-1",
      outcomeLabel: "Open Bennett celebration"
    });
  });

  test("fails closed for unknown recorded states instead of applying fallback semantics", () => {
    const row = build({
      quotes: [completeQuote({
        status: "mystery",
        booking: { confirmationStatus: "maybe" },
        payment: {
          depositStatus: "processing-someday",
          finalBalance: { status: "unrecognized" }
        }
      })]
    }).rows[0];

    expect(row.statusFacts.lifecycle).toMatchObject({ available: false, value: "Not recorded" });
    expect(row.statusFacts.booking).toMatchObject({ available: false, value: "Not recorded" });
    expect(row.statusFacts.deposit).toMatchObject({ available: false, value: "Not recorded" });
    expect(row.statusFacts.finalBalance).toMatchObject({ available: false, value: "Not recorded" });
    expect(row.momentum.domains.customer.state).toBe("unavailable");
    expect(build({ quotes: [completeQuote({ status: "mystery" })] }).caughtUp.eligible).toBe(false);
  });

  test("ranks an exact Workflow arrival above proposal review when bounded attention is present", () => {
    const row = build({
      quotes: [completeQuote({
        workflow: {
          approvalRequests: [{
            id: "approval-7",
            state: "pending",
            requestedAtISO: "2026-08-10T12:00:00.000Z"
          }]
        }
      })]
    }).rows[0];

    expect(row.workflow.target).toEqual({
      quoteId: "quote-ambient-1",
      attentionType: "approval",
      requestId: "approval-7"
    });
    expect(row.primaryAction).toMatchObject({
      outcomeLabel: "Review pending approval",
      purpose: "resolve",
      authorityLevel: "presentation",
      primary: true,
      enabled: true,
      executionTarget: { targetId: "approval-7", surfaceId: "workflow" }
    });
    expect(row.momentum.nextAction.category).toBe("authority_or_safety_blocker");
    expect(row.primaryAction.arrivalContract).toMatchObject({
      object: { id: "quote-ambient-1", type: "opportunity" }
    });
  });

  test("groups and orders opportunities from canonical Workflow priority and recorded dates", () => {
    const changeRequest = completeQuote({
      id: "quote-change",
      quoteNumber: "QP-100",
      portalDecision: {
        decision: "changes_requested",
        requestId: "change-1",
        message: "Please revise the menu.",
        submittedAtISO: "2026-08-11T12:00:00.000Z"
      }
    });
    const approval = completeQuote({
      id: "quote-approval",
      quoteNumber: "QP-200",
      workflow: {
        approvalRequests: [{
          id: "approval-1",
          state: "pending",
          requestedAtISO: "2026-08-10T12:00:00.000Z"
        }]
      }
    });
    const activeLater = completeQuote({
      id: "quote-active-later",
      quoteNumber: "QP-400",
      event: {
        name: "Later event",
        date: "2026-10-20",
        time: "18:00",
        venue: "The Glass House",
        guests: 120,
        hours: 5
      }
    });
    const activeSooner = completeQuote({
      id: "quote-active-sooner",
      quoteNumber: "QP-300",
      event: {
        name: "Sooner event",
        date: "2026-09-18",
        time: "18:00",
        venue: "The Garden",
        guests: 90,
        hours: 5
      }
    });
    const closed = completeQuote({
      id: "quote-closed",
      quoteNumber: "QP-500",
      status: "deleted",
      updatedAtISO: "2026-08-12T12:00:00.000Z"
    });
    const unordered = [closed, activeLater, approval, activeSooner, changeRequest];

    const first = build({ quotes: unordered });
    const permuted = build({ quotes: [...unordered].reverse() });
    const expectedOrder = [
      "quote-change",
      "quote-approval",
      "quote-active-sooner",
      "quote-active-later",
      "quote-closed"
    ];

    expect(first.rows.map((row) => row.quoteId)).toEqual(expectedOrder);
    expect(permuted.rows.map((row) => row.quoteId)).toEqual(expectedOrder);
    expect(first.groups.map((group) => ({
      id: group.id,
      rows: group.rows.map((row) => row.quoteId)
    }))).toEqual([
      { id: "needs-attention", rows: ["quote-change", "quote-approval"] },
      { id: "active-recent", rows: ["quote-active-sooner", "quote-active-later"] },
      { id: "recent-closed", rows: ["quote-closed"] }
    ]);
    expect(first.rows.slice(0, 2).map((row) => row.workflow.priority)).toEqual([0, 4]);
    expect(first.rows[2].identity.venue).toBe("The Garden");
  });

  test("falls back to exact opportunity context without widening Workflow authority", () => {
    const row = build({
      capabilities: { openOpportunity: true, openWorkflow: false },
      quotes: [completeQuote({
        workflow: {
          approvalRequests: [{
            id: "approval-7",
            state: "pending",
            requestedAtISO: "2026-08-10T12:00:00.000Z"
          }]
        }
      })]
    }).rows[0];

    expect(row.primaryAction).toMatchObject({
      outcomeLabel: "Review opportunity context",
      enabled: true,
      executionTarget: { targetId: "quote-ambient-1", surfaceId: "living-opportunity" }
    });
    expect(row.primaryAction.arrivalContract.reason).toContain("This task can’t open directly here");
  });

  test("returns one disabled contextual action when no role-safe host callback is available", () => {
    const row = build({
      capabilities: { openOpportunity: false, openWorkflow: false }
    }).rows[0];

    expect(row.primaryAction.primary).toBe(true);
    expect(row.primaryAction.enabled).toBe(false);
    expect(row.primaryAction.disabledReason).toContain("can’t open this opportunity");
    expect(row.momentum.nextAction).toBeNull();
    expect(row.momentum.unavailableActions).toHaveLength(1);
  });

  test("withholds caught-up language unless read bounds, freshness, identity, and Workflow timing are explicit", () => {
    const caughtUp = build();
    const noClock = build({ nowISO: "" });
    const truncated = build({
      readBoundary: { ...READ_BOUNDARY, truncated: true }
    });
    const missingId = build({
      quotes: [completeQuote({ id: "", quoteId: "" })]
    });

    expect(caughtUp.state).toBe("ready");
    expect(caughtUp.caughtUp.eligible).toBe(true);
    expect(caughtUp.caughtUp.reason).toContain("This is not event readiness");
    expect(noClock.state).toBe("bounded");
    expect(noClock.caughtUp.reason).toContain("Workflow timing was not evaluated");
    expect(truncated.caughtUp.eligible).toBe(false);
    expect(missingId.state).toBe("incomplete");
    expect(missingId.omittedRecords).toEqual([{ index: 0, reason: "Missing exact quote identity." }]);
  });

  test.each(["sent", "viewed", "declined", "expired"])(
    "withholds caught up when the customer dimension for %s is attention or blocked",
    (status) => {
      const result = build({ quotes: [completeQuote({ status })] });
      const row = result.rows[0];

      expect(["attention", "blocked"]).toContain(row.momentum.domains.customer.state);
      expect(row.requiresAttention).toBe(true);
      expect(result.caughtUp.eligible).toBe(false);
    }
  );

  test("distinguishes a completed empty read from an incomplete read and preserves local fallback truth", () => {
    const empty = build({ quotes: [] });
    const incomplete = build({
      quotes: [],
      readBoundary: {
        complete: false,
        loading: false,
        truncationKnown: false
      }
    });
    const local = build({ source: "local" });
    const unknownSource = build({ source: "" });

    expect(empty.state).toBe("empty");
    expect(empty.caughtUp.eligible).toBe(false);
    expect(incomplete.state).toBe("incomplete");
    expect(local.readBoundary.sourceLabel).toBe("Browser-local workspace");
    expect(local.readBoundary.sourceBoundary).toContain("do not confirm payment or outside-service completion");
    expect(unknownSource.readBoundary.currentComplete).toBe(false);
    expect(unknownSource.caughtUp.eligible).toBe(false);
  });

  test("is deeply frozen, does not mutate caller records, and contains no data-access dependency", () => {
    const quote = completeQuote();
    const before = structuredClone(quote);
    const result = build({ quotes: [quote] });
    const source = readFileSync(
      fileURLToPath(new URL("../ambientOpportunityStream.js", import.meta.url)),
      "utf8"
    );

    expect(quote).toEqual(before);
    expect(Object.isFrozen(result)).toBe(true);
    expect(Object.isFrozen(result.rows[0].momentum.domains)).toBe(true);
    expect(source).not.toMatch(/from ["']\.\/(?:quoteStore|firebase|authClient)/u);
    expect(source).not.toMatch(/\b(?:fetch|getQuoteHistory|httpsCallable|collection|query)\s*\(/u);
  });
});
