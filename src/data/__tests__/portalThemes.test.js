import { describe, expect, test } from "vitest";
import { PORTAL_THEME_PRESETS, normalizeCatalog } from "../mockCatalog";

describe("customer portal themes", () => {
  test("offers four distinct configurable presets", () => {
    expect(PORTAL_THEME_PRESETS).toHaveLength(4);
    expect(new Set(PORTAL_THEME_PRESETS.map((theme) => theme.id)).size).toBe(4);
    expect(PORTAL_THEME_PRESETS.map((theme) => theme.id)).toEqual([
      "midnight",
      "linen",
      "garden",
      "coastal"
    ]);
  });

  test("preserves a valid portal theme and rejects an unknown one", () => {
    expect(normalizeCatalog({ settings: { portalThemeId: "garden" } }).settings.portalThemeId).toBe("garden");
    expect(normalizeCatalog({ settings: { portalThemeId: "unknown" } }).settings.portalThemeId).toBe("midnight");
  });
});
