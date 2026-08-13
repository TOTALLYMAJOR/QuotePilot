import { describe, expect, test } from "vitest";
import {
  AMBIENT_LEGACY_RETIREMENT_ITEMS,
  assessAmbientLegacyRetirement
} from "../ambientLegacyRetirement";

describe("Ambient legacy retirement", () => {
  test("names every AIUI-48 target", () => {
    expect(AMBIENT_LEGACY_RETIREMENT_ITEMS.map(({ id }) => id)).toEqual([
      "legacy-stepper",
      "duplicated-modal-routes",
      "command-center",
      "primary-quote-table",
      "redundant-search-palette",
      "presentation-only-pilot-flags"
    ]);
  });

  test("fails closed without external release and rollback evidence", () => {
    const result = assessAmbientLegacyRetirement();
    expect(result.removalAuthorized).toBe(false);
    expect(result.retained).toHaveLength(5);
    expect(result.retiredFromAmbientGraph.map(({ id }) => id)).toEqual(["duplicated-modal-routes"]);
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
