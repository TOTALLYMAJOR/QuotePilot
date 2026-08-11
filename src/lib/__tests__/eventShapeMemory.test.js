import { describe, expect, test } from "vitest";
import { GUEST_BANDS, buildEventShapeMemory, guestBandFor } from "../eventShapeMemory";

function quote({
  status = "accepted",
  eventTypeId = "wedding",
  guests = 120,
  servers = 8,
  chefs = 3,
  bartenders = 2,
  hours = 6,
  rentals = [],
  rentalSnapshots = []
} = {}) {
  return {
    status,
    eventTypeId,
    event: { guests, servers, chefs, bartenders, hours },
    selection: { rentals, rentalSnapshots }
  };
}

describe("guestBandFor", () => {
  test("buckets guests into the documented fixed bands, inclusive at both ends", () => {
    expect(guestBandFor(1)).toBe("1-49");
    expect(guestBandFor(49)).toBe("1-49");
    expect(guestBandFor(50)).toBe("50-99");
    expect(guestBandFor(99)).toBe("50-99");
    expect(guestBandFor(100)).toBe("100-149");
    expect(guestBandFor(199)).toBe("150-199");
    expect(guestBandFor(200)).toBe("200-299");
    expect(guestBandFor(299)).toBe("200-299");
    expect(guestBandFor(300)).toBe("300-499");
    expect(guestBandFor(499)).toBe("300-499");
    expect(guestBandFor(500)).toBe("500-plus");
    expect(guestBandFor(5000)).toBe("500-plus");
  });

  test("rejects non-positive or missing guest counts", () => {
    expect(guestBandFor(0)).toBeNull();
    expect(guestBandFor(-5)).toBeNull();
    expect(guestBandFor(undefined)).toBeNull();
    expect(guestBandFor(null)).toBeNull();
    expect(guestBandFor("not a number")).toBeNull();
  });

  test("every band is contiguous with no gap or overlap", () => {
    for (let i = 1; i < GUEST_BANDS.length; i += 1) {
      expect(GUEST_BANDS[i][0]).toBe(GUEST_BANDS[i - 1][1] + 1);
    }
  });
});

describe("buildEventShapeMemory input validation", () => {
  test("returns null without a usable event type or guest count — inputs, not a data outcome", () => {
    expect(buildEventShapeMemory({ quotes: [quote()], eventTypeId: "", guests: 120 })).toBeNull();
    expect(buildEventShapeMemory({ quotes: [quote()], eventTypeId: "wedding", guests: 0 })).toBeNull();
    expect(buildEventShapeMemory({ quotes: [quote()], eventTypeId: "wedding", guests: -1 })).toBeNull();
    expect(buildEventShapeMemory({ quotes: undefined, eventTypeId: "wedding", guests: 120 })).toMatchObject({ sampleSize: 0 });
  });
});

describe("buildEventShapeMemory sample-size honesty", () => {
  test("below MIN_SAMPLE_SIZE reports insufficient with no staffing/hours suggestion, even with real matches", () => {
    const quotes = [quote(), quote()];
    const result = buildEventShapeMemory({ quotes, eventTypeId: "wedding", guests: 120 });
    expect(result.sampleSize).toBe(2);
    expect(result.sufficient).toBe(false);
    expect(result.staffing).toBeNull();
    expect(result.hours).toBeNull();
    expect(result.rentals).toEqual([]);
  });

  test("exactly at MIN_SAMPLE_SIZE (3) is sufficient", () => {
    const quotes = [quote(), quote(), quote()];
    const result = buildEventShapeMemory({ quotes, eventTypeId: "wedding", guests: 120 });
    expect(result.sampleSize).toBe(3);
    expect(result.sufficient).toBe(true);
    expect(result.staffing).not.toBeNull();
  });

  test("zero matching quotes is a real empty outcome, not null", () => {
    const result = buildEventShapeMemory({ quotes: [], eventTypeId: "wedding", guests: 120 });
    expect(result).toMatchObject({ sampleSize: 0, sufficient: false, staffing: null, hours: null, rentals: [] });
  });
});

describe("buildEventShapeMemory filtering — only real, matching, same-band bookings count", () => {
  test("excludes every non-booked status", () => {
    const quotes = [
      quote({ status: "draft" }), quote({ status: "sent" }), quote({ status: "viewed" }),
      quote({ status: "declined" }), quote({ status: "changes_requested" }),
      quote({ status: "accepted" }), quote({ status: "booked" })
    ];
    const result = buildEventShapeMemory({ quotes, eventTypeId: "wedding", guests: 120 });
    expect(result.sampleSize).toBe(2);
  });

  test("excludes a different event type even at the identical guest count", () => {
    const quotes = [quote(), quote(), quote(), quote({ eventTypeId: "corporate" })];
    const result = buildEventShapeMemory({ quotes, eventTypeId: "wedding", guests: 120 });
    expect(result.sampleSize).toBe(3);
  });

  test("excludes a different guest band even at the identical event type", () => {
    const quotes = [
      quote({ guests: 120 }), quote({ guests: 130 }), quote({ guests: 140 }),
      quote({ guests: 60 }), quote({ guests: 500 })
    ];
    const result = buildEventShapeMemory({ quotes, eventTypeId: "wedding", guests: 120 });
    expect(result.sampleSize).toBe(3);
  });

  test("a malformed quote (missing event/selection) is safely excluded, never throws", () => {
    const quotes = [quote(), quote(), quote(), {}, { status: "accepted" }, null, undefined];
    expect(() => buildEventShapeMemory({ quotes, eventTypeId: "wedding", guests: 120 })).not.toThrow();
    const result = buildEventShapeMemory({ quotes, eventTypeId: "wedding", guests: 120 });
    expect(result.sampleSize).toBe(3);
  });
});

describe("buildEventShapeMemory staffing and hours math", () => {
  test("computes the median for an odd sample, integer staffing and half-hour rounded duration", () => {
    const quotes = [
      quote({ servers: 6, chefs: 2, bartenders: 1, hours: 5 }),
      quote({ servers: 8, chefs: 3, bartenders: 2, hours: 6 }),
      quote({ servers: 10, chefs: 4, bartenders: 3, hours: 7 })
    ];
    const result = buildEventShapeMemory({ quotes, eventTypeId: "wedding", guests: 120 });
    expect(result.staffing).toEqual({ servers: 8, chefs: 3, bartenders: 2 });
    expect(result.hours).toBe(6);
  });

  test("averages the two middle values for an even sample", () => {
    const quotes = [
      quote({ servers: 6, hours: 5 }), quote({ servers: 8, hours: 5.5 }),
      quote({ servers: 10, hours: 6 }), quote({ servers: 12, hours: 6.5 })
    ];
    const result = buildEventShapeMemory({ quotes, eventTypeId: "wedding", guests: 120 });
    expect(result.staffing.servers).toBe(9);
    // Median of [5, 5.5, 6, 6.5] is 5.75, which rounds to the nearest half hour: 6.
    expect(result.hours).toBe(6);
  });

  test("rounds a fractional hours median to the nearest half hour", () => {
    const quotes = [quote({ hours: 5 }), quote({ hours: 5 }), quote({ hours: 6 })];
    const result = buildEventShapeMemory({ quotes, eventTypeId: "wedding", guests: 120 });
    expect(result.hours).toBe(5);
    const nudged = [quote({ hours: 5 }), quote({ hours: 5.2 }), quote({ hours: 5.4 })];
    expect(buildEventShapeMemory({ quotes: nudged, eventTypeId: "wedding", guests: 120 }).hours).toBe(5);
  });

  test("a bookings-only tenant with zero bartenders on every match reports zero, not missing", () => {
    const quotes = [quote({ bartenders: 0 }), quote({ bartenders: 0 }), quote({ bartenders: 0 })];
    const result = buildEventShapeMemory({ quotes, eventTypeId: "wedding", guests: 120 });
    expect(result.staffing.bartenders).toBe(0);
  });
});

describe("buildEventShapeMemory rental frequency", () => {
  test("suggests only rentals in a strict majority of matches, sorted by frequency then name", () => {
    const quotes = [
      quote({ rentals: ["linens", "lounge"] }),
      quote({ rentals: ["linens"] }),
      quote({ rentals: ["linens", "dance-floor"] }),
      quote({ rentals: ["lounge"] })
    ];
    const result = buildEventShapeMemory({ quotes, eventTypeId: "wedding", guests: 120 });
    expect(result.rentals.map((r) => r.id)).toEqual(["linens"]);
  });

  test("exactly 50% does not count as a majority", () => {
    const quotes = [
      quote({ rentals: ["linens"] }), quote({ rentals: ["linens"] }),
      quote({ rentals: [] }), quote({ rentals: [] })
    ];
    const result = buildEventShapeMemory({ quotes, eventTypeId: "wedding", guests: 120 });
    expect(result.rentals).toEqual([]);
  });

  test("just over 50% counts, and a quote with zero rentals still counts toward the denominator", () => {
    const quotes = [
      quote({ rentals: ["linens"] }), quote({ rentals: ["linens"] }),
      quote({ rentals: ["linens"] }), quote({ rentals: [] })
    ];
    const result = buildEventShapeMemory({ quotes, eventTypeId: "wedding", guests: 120 });
    expect(result.rentals.map((r) => r.id)).toEqual(["linens"]);
  });

  test("prefers a named snapshot over a bare id for display, and never double-counts the same rental within one quote", () => {
    const quotes = [
      quote({ rentals: ["linens"], rentalSnapshots: [{ id: "linens", name: "Table Linens" }] }),
      quote({ rentals: ["linens"], rentalSnapshots: [{ id: "linens", name: "Table Linens" }] }),
      quote({ rentals: ["linens"], rentalSnapshots: [] })
    ];
    const result = buildEventShapeMemory({ quotes, eventTypeId: "wedding", guests: 120 });
    expect(result.rentals).toEqual([{ id: "linens", name: "Table Linens", count: 3 }]);
  });

  test("caps the suggestion list and breaks ties alphabetically", () => {
    const rentalSets = [
      ["a", "b", "c", "d", "e", "f"],
      ["a", "b", "c", "d", "e", "f"],
      ["a", "b", "c", "d", "e", "f"]
    ];
    const quotes = rentalSets.map((rentals) => quote({ rentals }));
    const result = buildEventShapeMemory({ quotes, eventTypeId: "wedding", guests: 120 });
    expect(result.rentals).toHaveLength(5);
    expect(result.rentals.map((r) => r.id)).toEqual(["a", "b", "c", "d", "e"]);
  });
});
