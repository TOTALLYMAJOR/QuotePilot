// @vitest-environment jsdom
import { afterEach, describe, expect, test, vi } from "vitest";
import {
  beginRouteMeasurement,
  markRouteStage,
  routePerformanceSnapshot
} from "../routePerformance";

afterEach(() => {
  vi.restoreAllMocks();
  window.__QUOTE_PILOT_ROUTE_PERFORMANCE__ = undefined;
});

describe("route performance marks", () => {
  test.each(["now", "clients", "inventory", "quote-review"])("accepts canonical %s navigation and matching stages", (routeId) => {
    vi.spyOn(performance, "mark").mockImplementation(() => undefined);
    vi.spyOn(performance, "measure").mockImplementation(() => undefined);
    const navigation = beginRouteMeasurement(routeId);
    expect(navigation).toMatchObject({ routeId, stage: "route-start", outcome: "ready" });
    expect(markRouteStage({ routeId, stage: "usable-core" })).toMatchObject({
      routeId, navigationId: navigation.navigationId, stage: "usable-core"
    });
  });

  test("records only allow-listed route, stage, and outcome labels", () => {
    const mark = vi.spyOn(performance, "mark").mockImplementation(() => undefined);

    const result = markRouteStage({
      routeId: "customer-detail",
      navigationId: "nav-secret-customer-17",
      stage: "usable-core",
      outcome: "ready"
    });

    expect(result).toMatchObject({ routeId: "clients", stage: "usable-core", outcome: "ready" });
    expect(result.navigationId).not.toContain("secret");
    expect(mark).toHaveBeenCalledWith(
      "quotepilot:clients:usable-core:ready",
      expect.objectContaining({ detail: expect.objectContaining({ navigationId: result.navigationId }) })
    );
    expect(JSON.stringify(routePerformanceSnapshot())).not.toContain("nav-secret-customer-17");
  });

  test("rejects unknown routes and invalid stages instead of emitting arbitrary marks", () => {
    const mark = vi.spyOn(performance, "mark").mockImplementation(() => undefined);

    expect(markRouteStage({ routeId: "tenant-a", stage: "usable-core", outcome: "ready" })).toBeNull();
    expect(markRouteStage({ routeId: "now", stage: "customer-email", outcome: "ready" })).toBeNull();
    expect(mark).not.toHaveBeenCalled();
  });

  test("starts a fresh navigation and measures later stages from route start", () => {
    vi.spyOn(performance, "mark").mockImplementation(() => undefined);
    const measure = vi.spyOn(performance, "measure").mockImplementation(() => undefined);

    const navigation = beginRouteMeasurement("inventory");
    const core = markRouteStage({
      routeId: "inventory",
      navigationId: navigation.navigationId,
      stage: "usable-core",
      outcome: "ready"
    });

    expect(navigation.stage).toBe("route-start");
    expect(core.navigationId).toBe(navigation.navigationId);
    expect(measure).toHaveBeenCalledWith(
      "quotepilot:inventory:route-start-to-usable-core:ready",
      expect.objectContaining({
        start: `quotepilot:navigation:${navigation.navigationId}:route-start`,
        end: `quotepilot:navigation:${navigation.navigationId}:usable-core`
      })
    );
  });
});
