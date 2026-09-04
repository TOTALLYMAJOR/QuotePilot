import { describe, expect, test } from "vitest";
import {
  AMBIENT_LEGACY_RETIREMENT_ITEMS,
  assessAmbientLegacyRetirement
} from "../ambientLegacyRetirement";

describe("Ambient legacy retirement", () => {
  test("names every governed target including the superseded Operations switchboard", () => {
    expect(AMBIENT_LEGACY_RETIREMENT_ITEMS.map(({ id }) => id)).toEqual([
      "legacy-stepper",
      "duplicated-modal-routes",
      "command-center",
      "operations-switchboard",
      "primary-quote-table",
      "redundant-search-palette",
      "presentation-only-pilot-flags"
    ]);

    expect(AMBIENT_LEGACY_RETIREMENT_ITEMS.find(({ id }) => id === "operations-switchboard")).toMatchObject({
      replacement: "calendar-first Operations route with Workspace tools reachability",
      sourceState: "ambient-graph-retired",
      retirementCondition: "calendar-first-route-active-and-zero-runtime-consumers",
      capabilityDisposition: "live-routes-preserved"
    });
  });

  test("fails closed without external release and rollback evidence", () => {
    const result = assessAmbientLegacyRetirement();
    expect(result.removalAuthorized).toBe(false);
    expect(result.retained).toHaveLength(5);
    expect(result.retiredFromAmbientGraph.map(({ id }) => id)).toEqual([
      "duplicated-modal-routes",
      "operations-switchboard"
    ]);
  });

  test("requires every gate before reviewed removal becomes eligible", () => {
    const partial = assessAmbientLegacyRetirement({
      parityAccepted: true,
      rollbackArtifactVerified: true,
      releaseAccepted: true
    });
    expect(partial.removalAuthorized).toBe(false);

    const complete = assessAmbientLegacyRetirement({
      parityAccepted: true,
      rollbackArtifactVerified: true,
      releaseAccepted: true,
      productionPromotionApproved: true
    });
    expect(complete.removalAuthorized).toBe(true);
    expect(complete.items.every(({ eligible }) => eligible)).toBe(true);
  });
});
