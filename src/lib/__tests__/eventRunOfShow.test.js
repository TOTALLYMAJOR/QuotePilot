import { describe, expect, test } from "vitest";

import {
  buildCustomerWorkspaceEventRunOfShow,
  buildEventRunOfShowItem,
  buildEventRunOfShowReadModel,
  EVENT_RUN_OF_SHOW_DEFAULT_LIMIT,
  EVENT_RUN_OF_SHOW_MODEL_VERSION
} from "../eventRunOfShow";
import { proposalPayloadFixtureQuote } from "./fixtures/proposalPayloadFixture";

function clone(value) {
  return JSON.parse(JSON.stringify(value));
}

function acceptedQuote(overrides = {}) {
  const fixture = clone(proposalPayloadFixtureQuote);
  return {
    ...fixture,
    status: "accepted",
    lifecycle: { acceptedAtISO: "2026-03-12T15:30:00.000Z" },
    ...overrides
  };
}

describe("buildEventRunOfShowItem", () => {
  test("derives an accepted event without promoting it to booked or operationally ready", () => {
    const item = buildEventRunOfShowItem(acceptedQuote());

    expect(item).toMatchObject({
      quoteId: "fixture-quote-1",
      quoteNumber: "Q-2026-0042",
      quoteStatus: "accepted",
      milestones: {
        proposalAcceptance: {
          state: "accepted",
          atISO: "2026-03-12T15:30:00.000Z",
          evidence: "lifecycle.acceptedAtISO"
        },
        booking: {
          state: "not_booked",
          atISO: null,
          contractNumber: null,
          evidence: null
        }
      },
      operationalReadiness: { state: "not_established" },
      event: {
        date: "2026-04-20",
        time: "18:00",
        guests: 120,
        hours: 5
      },
      staffing: {
        staffLead: "Jamie Chen",
        servers: 8,
        chefs: 3,
        bartenders: 2
      },
      beoReference: {
        state: "derivable",
        sourceRevision: {
          id: "legacy-unversioned",
          number: null,
          createdAtISO: null,
          createdOn: null
        },
        retainedArtifactEvidence: false,
        artifactState: "not_read",
        freshness: "not_assessed"
      }
    });

    expect(item.timeline.map((entry) => entry.id)).toEqual([
      "prep-start",
      "line-check",
      "pack-out",
      "onsite-setup",
      "service-start",
      "service-end",
      "reset"
    ]);
    expect(item.timeline.find((entry) => entry.id === "service-start")).toMatchObject({
      label: "Doors open",
      timingState: "known",
      timingBasis: "booking_override",
      minuteOffset: -15,
      date: "2026-04-20",
      time: "17:45"
    });
    expect(item.productionChecklist).toMatchObject({
      state: "incomplete",
      completedCount: 2,
      notCompletedCount: 0,
      unknownCount: 8,
      totalCount: 10
    });
    expect(item.productionChecklist.groups[0].items[0]).toMatchObject({
      id: "event-brief",
      state: "completed",
      completedAtISO: "2026-04-01T10:00:00.000Z"
    });
    expect(item.productionChecklist.groups[0].items[1]).toMatchObject({
      id: "guest-count",
      state: "unknown"
    });
    expect(item.unknownFields).toEqual([]);
  });

  test("keeps booked evidence distinct from acceptance and readiness", () => {
    const item = buildEventRunOfShowItem(acceptedQuote({
      status: "booked",
      lifecycle: {
        acceptedAtISO: "2026-03-12T15:30:00.000Z",
        bookedAtISO: "2026-03-13T09:00:00.000Z"
      },
      booking: {
        ...proposalPayloadFixtureQuote.booking,
        contractNumber: "C-2026-0042",
        bookedAtISO: "2026-03-13T09:05:00.000Z"
      }
    }));

    expect(item.quoteStatus).toBe("booked");
    expect(item.milestones.proposalAcceptance).toMatchObject({
      state: "accepted",
      atISO: "2026-03-12T15:30:00.000Z"
    });
    expect(item.milestones.booking).toEqual({
      state: "booked",
      atISO: "2026-03-13T09:00:00.000Z",
      contractNumber: "C-2026-0042",
      evidence: "quote.status"
    });
    expect(item.operationalReadiness.state).toBe("not_established");
  });

  test("does not infer acceptance merely because a quote is booked", () => {
    const item = buildEventRunOfShowItem(acceptedQuote({
      status: "booked",
      lifecycle: {},
      booking: {
        ...proposalPayloadFixtureQuote.booking,
        contractNumber: "C-2026-0042"
      }
    }));

    expect(item.milestones.proposalAcceptance).toEqual({
      state: "unknown",
      atISO: null,
      evidence: null
    });
    expect(item.milestones.booking.state).toBe("booked");
  });

  test("represents missing facts as unknown instead of zeroes or fabricated times", () => {
    const quote = acceptedQuote({
      id: "quote-with-gaps",
      quoteNumber: "",
      event: {
        name: "",
        date: "2026-02-30",
        time: "",
        venue: "",
        venueAddress: "",
        guests: "",
        hours: "",
        servers: "",
        chefs: null,
        bartenders: undefined,
        style: "",
        dietaryRestrictions: ""
      },
      booking: {
        productionChecklist: [{ id: "event-brief", completed: false }]
      }
    });
    const item = buildEventRunOfShowItem(quote);

    expect(item.event).toEqual({
      name: null,
      date: null,
      time: null,
      hours: null,
      venue: null,
      venueAddress: null,
      guests: null,
      style: null,
      dietaryRestrictions: null
    });
    expect(item.staffing).toEqual({
      staffLead: null,
      servers: null,
      chefs: null,
      bartenders: null
    });
    expect(item.timeline).toHaveLength(7);
    expect(item.timeline.every((entry) => (
      entry.timingState === "unknown"
      && entry.minute === null
      && entry.date === null
      && entry.time === null
      && entry.uncertaintyReason === "event_time_unknown"
    ))).toBe(true);
    expect(item.productionChecklist).toMatchObject({
      state: "incomplete",
      completedCount: 0,
      notCompletedCount: 1,
      unknownCount: 9
    });
    expect(item.unknownFields).toEqual([
      "event.date",
      "event.dietaryRestrictions",
      "event.guests",
      "event.hours",
      "event.name",
      "event.style",
      "event.time",
      "event.venue",
      "event.venueAddress",
      "quote.quoteNumber",
      "staffing.bartenders",
      "staffing.chefs",
      "staffing.servers",
      "staffing.staffLead"
    ]);
  });

  test("withholds duration-dependent default times when duration is unknown", () => {
    const quote = acceptedQuote({
      event: {
        ...proposalPayloadFixtureQuote.event,
        hours: ""
      },
      booking: {
        ...proposalPayloadFixtureQuote.booking,
        kitchenCheckpoints: [
          ...proposalPayloadFixtureQuote.booking.kitchenCheckpoints,
          { id: "service-end", label: "Venue handoff", minuteOffset: 270 }
        ]
      }
    });
    const item = buildEventRunOfShowItem(quote);
    const serviceEnd = item.timeline.find((entry) => entry.id === "service-end");
    const reset = item.timeline.find((entry) => entry.id === "reset");

    expect(serviceEnd).toMatchObject({
      label: "Venue handoff",
      timingState: "known",
      timingBasis: "booking_override",
      minuteOffset: 270,
      time: "22:30"
    });
    expect(reset).toMatchObject({
      timingState: "unknown",
      timingBasis: "generated_default",
      minuteOffset: null,
      minute: null,
      date: null,
      time: null,
      uncertaintyReason: "event_duration_unknown"
    });
  });

  test("returns null for non-operational quote states", () => {
    expect(buildEventRunOfShowItem({ status: "sent" })).toBeNull();
    expect(buildEventRunOfShowItem({ status: "draft" })).toBeNull();
  });
});

describe("buildEventRunOfShowReadModel", () => {
  test("sorts deterministically, reports bounds, and labels canonical source authority", () => {
    const missingDate = acceptedQuote({
      id: "quote-c",
      quoteNumber: "Q-3",
      event: { ...proposalPayloadFixtureQuote.event, date: "", time: "09:00" }
    });
    const later = acceptedQuote({
      id: "quote-b",
      quoteNumber: "Q-2",
      status: "booked",
      event: { ...proposalPayloadFixtureQuote.event, date: "2026-05-02", time: "11:00" }
    });
    const earlier = acceptedQuote({
      id: "quote-a",
      quoteNumber: "Q-1",
      event: { ...proposalPayloadFixtureQuote.event, date: "2026-05-02", time: "09:00" }
    });
    const draft = acceptedQuote({ id: "quote-d", quoteNumber: "Q-0", status: "draft" });
    const quotes = [missingDate, later, draft, earlier];
    const before = clone(quotes);

    const result = buildEventRunOfShowReadModel({
      quotes,
      source: "firebase",
      limit: 2,
      upstreamTruncated: true,
      upstreamLimit: 50
    });

    expect(result).toMatchObject({
      schemaVersion: 1,
      modelVersion: EVENT_RUN_OF_SHOW_MODEL_VERSION,
      generatedFrom: {
        source: {
          id: "firebase",
          label: "Firestore staff records",
          authority: "canonical_staff_records"
        },
        projection: "derived_read_only"
      },
      bounds: {
        inputCount: 4,
        eligibleCount: 3,
        excludedCount: 1,
        displayedCount: 2,
        limit: 2,
        upstreamLimit: 50,
        projectionTruncated: true,
        upstreamTruncated: true,
        truncated: true
      }
    });
    expect(result.events.map((event) => event.quoteId)).toEqual(["quote-a", "quote-b"]);
    expect(buildEventRunOfShowReadModel({
      quotes: [...quotes].reverse(),
      source: "firebase",
      limit: 2,
      upstreamTruncated: true,
      upstreamLimit: 50
    })).toEqual(result);
    expect(quotes).toEqual(before);
  });

  test("uses conservative defaults for invalid arguments", () => {
    const result = buildEventRunOfShowReadModel({
      quotes: "not-an-array",
      source: "unexpected",
      limit: -1,
      upstreamLimit: ""
    });

    expect(result.generatedFrom.source).toEqual({
      id: "unknown",
      label: "Source not confirmed",
      authority: "unconfirmed"
    });
    expect(result.bounds).toMatchObject({
      inputCount: 0,
      limit: EVENT_RUN_OF_SHOW_DEFAULT_LIMIT,
      upstreamLimit: null,
      truncated: false
    });
  });
});

describe("buildCustomerWorkspaceEventRunOfShow", () => {
  test("carries Customer 360 source and upstream page bounds into the projection", () => {
    const result = buildCustomerWorkspaceEventRunOfShow({
      source: "local",
      quotePageInfo: { limit: 25, truncated: true },
      quotes: [acceptedQuote()]
    });

    expect(result.generatedFrom.source).toEqual({
      id: "local",
      label: "Browser-local workspace",
      authority: "browser_local_records"
    });
    expect(result.bounds).toMatchObject({
      displayedCount: 1,
      upstreamLimit: 25,
      upstreamTruncated: true,
      truncated: true
    });
  });
});
