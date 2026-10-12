// @vitest-environment jsdom
import { afterEach, describe, expect, test } from "vitest";
import { getEventScheduleQuotes, projectLocalEventScheduleQuotes } from "../quoteStore";

afterEach(() => localStorage.clear());

describe("getEventScheduleQuotes local fallback", () => {
  test("returns only the inclusive visible interval with explicit page metadata", async () => {
    const inRange = Array.from({ length: 101 }, (_, index) => ({
      id: `visible-${String(index).padStart(3, "0")}`,
      organizationId: "org-a",
      status: "accepted",
      event: { date: index % 2 ? "2026-10-10" : "2026-10-31" }
    }));
    const quotes = [
      ...inRange,
      { id: "before", organizationId: "org-a", event: { date: "2026-09-30" } },
      { id: "after", organizationId: "org-a", event: { date: "2026-11-01" } },
      { id: "other-tenant", organizationId: "org-b", event: { date: "2026-10-15" } }
    ];

    const result = projectLocalEventScheduleQuotes({
      quotes,
      organizationId: "org-a",
      startDate: "2026-10-01",
      endDate: "2026-10-31",
      pageSize: 100,
      observedAtISO: "2026-10-10T12:00:00.000Z"
    });

    expect(result).toMatchObject({
      source: "local",
      interval: { startDate: "2026-10-01", endDate: "2026-10-31" },
      complete: true,
      pageCount: 2
    });
    expect(result.quotes).toHaveLength(101);
    expect(result.quotes.every((quote) => quote.organizationId === "org-a")).toBe(true);
  });

  test("rejects missing or inverted intervals", async () => {
    await expect(getEventScheduleQuotes({ organizationId: "org-a", startDate: "", endDate: "2026-10-31" }))
      .rejects.toThrow("startDate");
    await expect(getEventScheduleQuotes({ organizationId: "org-a", startDate: "2026-11-01", endDate: "2026-10-31" }))
      .rejects.toThrow("endDate");
  });
});
