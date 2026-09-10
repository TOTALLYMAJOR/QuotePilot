import { describe, expect, test } from "vitest";
import {
  nextAnniversaryAttentionBoundaryMs,
  resolveAnniversaryAttentionCalendar
} from "../anniversaryRebookingAttention";

describe("attention business-day boundary", () => {
  test.each([
    ["2026-09-10T04:59:59.000Z", "America/Chicago", "2026-09-10T05:00:00.000Z"],
    ["2026-03-08T06:00:00.000Z", "America/Chicago", "2026-03-09T05:00:00.000Z"],
    ["2026-11-01T05:00:00.000Z", "America/Chicago", "2026-11-02T06:00:00.000Z"],
    ["2026-09-10T12:00:00.000Z", "Asia/Kathmandu", "2026-09-10T18:15:00.000Z"],
    ["2026-12-31T23:59:59.900Z", "UTC", "2027-01-01T00:00:00.000Z"]
  ])("finds the next date after %s in %s", (instant, tenantTimeZone, expected) => {
    const boundary = nextAnniversaryAttentionBoundaryMs({ instant, tenantTimeZone });
    expect(new Date(boundary).toISOString()).toBe(expected);
    const before = resolveAnniversaryAttentionCalendar({ instant: boundary - 1, tenantTimeZone });
    const after = resolveAnniversaryAttentionCalendar({ instant: boundary, tenantTimeZone });
    expect(after.date).not.toBe(before.date);
  });

  test("uses the existing labeled fallback rather than inventing a new zone", () => {
    const instant = "2026-09-10T12:00:00.000Z";
    const resolved = resolveAnniversaryAttentionCalendar({ instant, tenantTimeZone: "invalid/zone" });
    expect(resolved.source).toBe("device_fallback_invalid_tenant");
    expect(nextAnniversaryAttentionBoundaryMs({ instant, tenantTimeZone: "invalid/zone" }))
      .toBe(nextAnniversaryAttentionBoundaryMs({ instant, tenantTimeZone: resolved.timeZone }));
  });

  test("rejects invalid instants without scheduling a past epoch", () => {
    expect(() => nextAnniversaryAttentionBoundaryMs({ instant: "not-a-date" })).toThrow(TypeError);
  });
});
