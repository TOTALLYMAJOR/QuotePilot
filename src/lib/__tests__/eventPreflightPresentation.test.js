import { describe, expect, test } from "vitest";
import { buildEventPreflightPresentation } from "../../components/eventPreflightPresentation";
import { buildScheduleConflictAssessment, buildScheduledEvents } from "../../components/EventScheduleModal";

function base(overrides = {}) {
  const quote = {
    id: "event-1",
    status: "booked",
    activeVersionId: "revision-4",
    acceptanceReceipt: {
      receiptId: "acceptance-4",
      quoteRevisionId: "revision-4",
      acceptedAtISO: "2026-09-01T12:00:00.000Z"
    },
    payment: {
      depositStatus: "paid",
      finalBalance: { status: "paid" }
    }
  };
  const execution = {
    workspace: { intelligence: { needsYou: { target: null } } },
    runOfShow: {
      productionChecklist: {
        groups: [{ items: [{ id: "guest-count", state: "completed" }] }]
      }
    }
  };
  return {
    quote,
    execution,
    authorityIdentity: "org-1:event-1:revision-4:generation-1",
    organizationId: "org-1",
    authorityReads: {
      identity: "org-1:event-1:revision-4:generation-1",
      beo: { state: "current", value: { state: "CURRENT", commercialSourceRevisionId: "revision-4", unresolvedInvalidationIds: [] } },
      staffing: {
        state: "current",
        value: {
          state: "current",
          organizationId: "org-1",
          quoteId: "event-1",
          activeQuoteRevisionId: "revision-4",
          snapshot: { coverage: { state: "coverage_confirmed" } }
        }
      }
    },
    snapshot: { loading: false, error: "", partial: false, stale: false, truncated: false, truncationKnown: true },
    scheduleAssessment: { state: "clear", reasons: [] },
    ...overrides
  };
}

describe("event preflight presentation", () => {
  test("separates narrow satisfied evidence from permanently unavailable operational truth", () => {
    const model = buildEventPreflightPresentation(base());

    expect(model.satisfied.map((item) => item.id)).toEqual(expect.arrayContaining([
      "commitment", "accepted-revision", "deposit", "final-balance", "final-count", "beo", "invalidations", "staffing", "schedule"
    ]));
    expect(model.unknown.map((item) => item.id)).toEqual(expect.arrayContaining([
      "workflow", "phase-issues", "inventory", "attendance"
    ]));
    expect(model.boundary).toContain("not a readiness score");
    expect(model).not.toHaveProperty("score");
    expect(model).not.toHaveProperty("readinessPercent");
    expect(model.nextAction.kind).toBe("schedule");
    expect(model.nextReason).toContain("No conflict appears");
  });

  test("turns revision drift, payment gaps, stale BEO, staffing gaps, workflow, and schedule conflicts into attention", () => {
    const input = base();
    input.quote.activeVersionId = "revision-5";
    input.quote.payment.finalBalance.status = "unpaid";
    input.execution.workspace.intelligence.needsYou = {
      target: { quoteId: "event-1" },
      title: "Customer reply needs review",
      detail: "A reply is waiting."
    };
    input.authorityIdentity = "org-1:event-1:revision-5:generation-1";
    input.authorityReads = {
      identity: input.authorityIdentity,
      beo: { state: "current", value: { state: "STALE", commercialSourceRevisionId: "revision-4", unresolvedInvalidationIds: ["cci-1"] } },
      staffing: {
        state: "current",
        value: { state: "current", organizationId: "org-1", quoteId: "event-1", activeQuoteRevisionId: "revision-5", snapshot: { coverage: { state: "attention" } } }
      }
    };
    input.scheduleAssessment = { state: "conflict", reasons: ["time_overlap"] };

    const model = buildEventPreflightPresentation(input);

    expect(model.state).toBe("attention");
    expect(model.attention.map((item) => item.id)).toEqual(expect.arrayContaining([
      "accepted-revision", "final-balance", "beo", "invalidations", "staffing", "workflow", "schedule"
    ]));
    expect(model.satisfied.find((item) => item.id === "accepted-revision")).toBeUndefined();
  });

  test("never converts stale, partial, truncated, malformed, or absent evidence into a pass", () => {
    const input = base({
      authorityReads: {
        beo: { state: "unavailable", value: null },
        staffing: { state: "stale", value: { snapshot: { coverage: { state: "coverage_confirmed" } } } }
      },
      snapshot: { loading: false, error: "", partial: true, stale: false, truncated: true, truncationKnown: true }
    });
    input.quote.payment.depositStatus = "invented";
    input.execution.runOfShow.productionChecklist.groups = [];

    const model = buildEventPreflightPresentation(input);

    expect(model.unknown.map((item) => item.id)).toEqual(expect.arrayContaining([
      "deposit", "final-count", "beo", "invalidations", "staffing", "schedule"
    ]));
    expect(model.satisfied.map((item) => item.id)).not.toEqual(expect.arrayContaining(["deposit", "final-count", "beo", "staffing", "schedule"]));
    expect(model.nextAction.kind).toBe("refresh");
  });

  test.each(["receiptId", "acceptedAtISO", "quoteRevisionId"])("does not treat acceptance as exact when %s is missing", (field) => {
    const input = base();
    delete input.quote.acceptanceReceipt[field];

    const model = buildEventPreflightPresentation(input);

    expect(model.unknown.map((item) => item.id)).toContain("accepted-revision");
    expect(model.satisfied.map((item) => item.id)).not.toContain("accepted-revision");
  });

  test("rejects late authority reads from another quote, revision, or snapshot generation", () => {
    const input = base();
    input.authorityReads.identity = "org-1:event-2:revision-4:generation-1";

    const wrongQuote = buildEventPreflightPresentation(input);
    expect(wrongQuote.unknown.map((item) => item.id)).toEqual(expect.arrayContaining(["beo", "staffing"]));

    input.authorityReads.identity = input.authorityIdentity;
    input.authorityReads.beo.value.commercialSourceRevisionId = "revision-3";
    input.authorityReads.staffing.value.activeQuoteRevisionId = "revision-3";
    const wrongRevision = buildEventPreflightPresentation(input);
    expect(wrongRevision.unknown.map((item) => item.id)).toEqual(expect.arrayContaining(["beo", "invalidations", "staffing"]));
    expect(wrongRevision.satisfied.map((item) => item.id)).not.toContain("invalidations");
  });

  test("derives Next from a displayed unavailable authority fact rather than a hidden execution fallback", () => {
    const input = base({
      authorityReads: {
        identity: "org-1:event-1:revision-4:generation-1",
        beo: { state: "loading", value: null },
        staffing: { state: "loading", value: null }
      }
    });
    input.execution.nextAction = { kind: "workflow", label: "Hidden legacy fallback", target: { quoteId: "other" } };

    const model = buildEventPreflightPresentation(input);

    expect(model.nextAction).toMatchObject({ kind: "quote", label: "Open commercial truth" });
    expect(model.nextReason).toContain("Kitchen BEO freshness is unavailable");
    expect(model.nextReason).not.toContain("Hidden legacy fallback");
  });

  test.each([
    ["missing selected event", [{ id: "other", date: "2026-09-12", venue: "Hall", time: "17:00", hours: 4, guests: 10 }]],
    ["missing selected date", [{ id: "event-1", date: "", venue: "Hall", time: "17:00", hours: 4, guests: 10 }]],
    ["invalid selected date", [{ id: "event-1", date: "not-a-date", venue: "Hall", time: "17:00", hours: 4, guests: 10 }]],
    ["missing selected venue", [{ id: "event-1", date: "2026-09-12", venue: "", time: "17:00", hours: 4, guests: 10 }]],
    ["missing selected time", [{ id: "event-1", date: "2026-09-12", venue: "Hall", time: "", hours: 4, guests: 10 }]],
    ["missing selected duration", [{ id: "event-1", date: "2026-09-12", venue: "Hall", time: "17:00", hours: 0, guests: 10 }]],
    ["missing selected guest load", [{ id: "event-1", date: "2026-09-12", venue: "Hall", time: "17:00", hours: 4, guests: null }]],
    ["unknown peer timing", [
      { id: "event-1", date: "2026-09-12", venue: "Hall", time: "17:00", hours: 4, guests: 10 },
      { id: "event-2", date: "2026-09-12", venue: "Hall", time: "", hours: 4, guests: 20 }
    ]],
    ["unknown peer guest load", [
      { id: "event-1", date: "2026-09-12", venue: "Hall", time: "17:00", hours: 4, guests: 10 },
      { id: "event-2", date: "2026-09-12", venue: "Hall", time: "18:00", hours: 4, guests: null }
    ]]
  ])("keeps schedule unknown for %s", (_label, events) => {
    expect(buildScheduleConflictAssessment(events, "event-1", 400).state).toBe("unknown");
  });

  test("distinguishes a decidable schedule conflict from a decidable clear projection", () => {
    const selected = { id: "event-1", date: "2026-09-12", venue: "Hall", time: "17:00", hours: 4, guests: 250 };
    const peer = { id: "event-2", date: "2026-09-12", venue: "Hall", time: "18:00", hours: 4, guests: 200 };
    expect(buildScheduleConflictAssessment([selected, peer], "event-1", 400)).toMatchObject({ state: "conflict" });
    expect(buildScheduleConflictAssessment([selected], "event-1", 400)).toEqual({ state: "clear", reasons: [] });
  });

  test("preserves an undated accepted peer so the Control Room cannot infer a clear schedule", () => {
    const scheduled = buildScheduledEvents([
      { id: "event-1", status: "booked", event: { date: "2026-09-12", venue: "Hall", time: "17:00", hours: 4, guests: 10 } },
      { id: "event-2", status: "accepted", event: { date: "", venue: "Hall", time: "18:00", hours: 4, guests: 20 } }
    ], { preserveUndated: true });

    expect(scheduled.map((item) => item.id)).toEqual(["event-2", "event-1"]);
    expect(buildScheduleConflictAssessment(scheduled, "event-1", 400).state).toBe("unknown");
  });

  test("preserves an invalid-date accepted peer so the Control Room cannot infer a clear schedule", () => {
    const scheduled = buildScheduledEvents([
      { id: "event-1", status: "booked", event: { date: "2026-09-12", venue: "Hall", time: "17:00", hours: 4, guests: 10 } },
      { id: "event-2", status: "accepted", event: { date: "not-a-date", venue: "Hall", time: "18:00", hours: 4, guests: 20 } }
    ], { preserveUndated: true });

    expect(buildScheduleConflictAssessment(scheduled, "event-1", 400).state).toBe("unknown");
  });
});
