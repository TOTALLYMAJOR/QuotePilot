import { describe, expect, test } from "vitest";
import {
  ANNIVERSARY_REBOOKING_ATTENTION_LIMIT,
  buildAnniversaryRebookingAttention,
  mergeAnniversaryRebookingAttention,
  resolveAnniversaryAttentionCalendar
} from "../anniversaryRebookingAttention";

const CALENDAR = Object.freeze({
  date: "2026-08-09",
  instantISO: "2026-08-09T12:00:00.000Z",
  timeZone: "America/Chicago",
  source: "tenant",
  label: "Tenant-local anniversary week"
});

function bookedQuote(id, eventDate = "2025-08-05") {
  return {
    id,
    organizationId: "org-one",
    customerId: `customer-${id}`,
    quoteNumber: `QP-${id}`,
    status: "booked",
    customer: { name: "Henderson Industries", email: "ops@example.test" },
    event: { name: "Henderson corporate picnic", date: eventDate }
  };
}

describe("anniversary rebooking Attention", () => {
  test("turns only a recorded booked event from this week last year into a verification cue", () => {
    const result = buildAnniversaryRebookingAttention([
      bookedQuote("eligible"),
      { ...bookedQuote("accepted"), status: "accepted" },
      { ...bookedQuote("missing-customer"), customerId: "" },
      bookedQuote("outside", "2025-07-01")
    ], {
      calendarContext: CALENDAR,
      sourceLimit: 200,
      sourceTruncated: false
    });

    expect(result.items).toHaveLength(1);
    expect(result.items[0]).toMatchObject({
      id: "anniversary-rebooking:eligible:2025-08-05",
      type: "anniversary_rebooking",
      state: "verification_required",
      quoteId: "eligible",
      customerId: "customer-eligible",
      anniversaryDate: "2026-08-05",
      eventName: "Henderson corporate picnic",
      routeIntent: "verify_exact_version_in_customer_360",
      sourceBound: { quoteLimit: 200, truncated: false }
    });
    expect(result.items[0].evidenceBoundary).toMatch(/not a lead/i);
    expect(result.items[0]).not.toHaveProperty("acceptedVersionVerified");
    expect(result.items[0]).not.toHaveProperty("revenue");
    expect(result.excludedReasonCounts).toMatchObject({
      quote_not_booked: 1,
      stable_customer_missing: 1,
      outside_anniversary_week: 1
    });
  });

  test("rejects an email-shaped legacy identity instead of creating an unsafe customer route", () => {
    const result = buildAnniversaryRebookingAttention([{
      ...bookedQuote("legacy"),
      customerId: "customer@example.test"
    }], { calendarContext: CALENDAR });

    expect(result.items).toEqual([]);
    expect(result.excludedReasonCounts).toEqual({ stable_customer_missing: 1 });
  });

  test("uses the same leap-day clipping rule as the Customer 360 radar", () => {
    const result = buildAnniversaryRebookingAttention([
      bookedQuote("leap", "2024-02-29")
    ], {
      calendarContext: { ...CALENDAR, date: "2025-02-28" }
    });

    expect(result.items[0]).toMatchObject({ anniversaryDate: "2025-02-28" });
  });

  test("caps the operational queue and keeps both source and display incompleteness explicit", () => {
    const quotes = Array.from(
      { length: ANNIVERSARY_REBOOKING_ATTENTION_LIMIT + 2 },
      (_, index) => bookedQuote(`quote-${String(index).padStart(2, "0")}`)
    );
    const result = buildAnniversaryRebookingAttention(quotes, {
      calendarContext: CALENDAR,
      sourceLimit: 200,
      sourceTruncated: true
    });

    expect(result.items).toHaveLength(ANNIVERSARY_REBOOKING_ATTENTION_LIMIT);
    expect(result.bounds).toEqual({
      limit: ANNIVERSARY_REBOOKING_ATTENTION_LIMIT,
      candidateCount: ANNIVERSARY_REBOOKING_ATTENTION_LIMIT + 2,
      returnedCount: ANNIVERSARY_REBOOKING_ATTENTION_LIMIT,
      quoteSourceLimit: 200,
      quoteSourceTruncated: true,
      attentionTruncated: true,
      complete: false
    });
  });

  test("uses the tenant calendar when configured and labels an invalid tenant-zone fallback", () => {
    expect(resolveAnniversaryAttentionCalendar({
      instant: "2026-08-09T02:00:00.000Z",
      tenantTimeZone: "America/Chicago"
    })).toMatchObject({
      date: "2026-08-08",
      source: "tenant",
      timeZone: "America/Chicago"
    });
    expect(resolveAnniversaryAttentionCalendar({
      instant: "2026-08-09T02:00:00.000Z",
      tenantTimeZone: "Not/A_Time_Zone"
    })).toMatchObject({
      source: "device_fallback_invalid_tenant",
      label: expect.stringMatching(/invalid/i)
    });
  });

  test("merges without losing existing Attention counts or duplicating an existing cue", () => {
    const cue = buildAnniversaryRebookingAttention([bookedQuote("eligible")], {
      calendarContext: CALENDAR
    }).items[0];
    const merged = mergeAnniversaryRebookingAttention({
      quoteCount: 1,
      itemCount: 1,
      counts: { followUps: 1 },
      items: [{ id: "follow-up:one", quoteId: "follow-up", priority: 3 }]
    }, {
      quotes: [bookedQuote("eligible")],
      calendarContext: CALENDAR
    });
    expect(merged.counts).toEqual({ followUps: 1, anniversaryRebookings: 1 });
    expect(merged.itemCount).toBe(2);

    const replay = mergeAnniversaryRebookingAttention({
      ...merged
    }, {
      quotes: [bookedQuote("eligible")],
      calendarContext: CALENDAR
    });
    expect(replay.items.filter((item) => item.id === cue.id)).toHaveLength(1);
    expect(replay.counts.anniversaryRebookings).toBe(0);
  });
});
