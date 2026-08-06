import { describe, expect, test } from "vitest";
import {
  applyPortalThemePreset,
  buildPortalThemeStyle,
  findPortalThemePreset,
  PORTAL_THEME_COLOR_KEYS,
  PORTAL_THEME_PRESETS
} from "../portalThemePresets";

function relativeLuminance(color) {
  const channels = color.slice(1).match(/.{2}/g).map((value) => parseInt(value, 16) / 255);
  const [red, green, blue] = channels.map((value) => (
    value <= 0.03928 ? value / 12.92 : ((value + 0.055) / 1.055) ** 2.4
  ));
  return (0.2126 * red) + (0.7152 * green) + (0.0722 * blue);
}

function contrastRatio(left, right) {
  const lighter = Math.max(relativeLuminance(left), relativeLuminance(right));
  const darker = Math.min(relativeLuminance(left), relativeLuminance(right));
  return (lighter + 0.05) / (darker + 0.05);
}

describe("customer portal theme presets", () => {
  test("offers four clearly named palettes with accessible action colors", () => {
    expect(PORTAL_THEME_PRESETS.map(({ id, name }) => ({ id, name }))).toEqual([
      { id: "midnight-amber", name: "Midnight Amber" },
      { id: "warm-linen", name: "Warm Linen" },
      { id: "garden-sage", name: "Garden Sage" },
      { id: "coastal-blue", name: "Coastal Blue" }
    ]);
    expect(new Set(PORTAL_THEME_PRESETS.map((preset) => preset.name)).size).toBe(4);
    PORTAL_THEME_PRESETS.forEach((preset) => {
      expect(preset.description.length).toBeGreaterThan(20);
      expect(contrastRatio(preset.colors.brandDarkAccentColor, "#ffffff")).toBeGreaterThanOrEqual(4.5);
    });
  });

  test("applies only existing brand color fields and never changes pricing or identity", () => {
    const original = {
      brandName: "Northstar Catering",
      serviceFeePct: 0.18,
      pricingSetupConfirmed: true,
      catalogRevision: 12,
      customOperatorField: "preserve"
    };
    const applied = applyPortalThemePreset(original, "garden-sage");

    expect(applied).toMatchObject(original);
    expect(PORTAL_THEME_COLOR_KEYS.every((key) => /^#[0-9a-f]{6}$/i.test(applied[key]))).toBe(true);
    expect(Object.keys(applied).sort()).toEqual([
      ...Object.keys(original),
      ...PORTAL_THEME_COLOR_KEYS
    ].sort());
    expect(applyPortalThemePreset(original, "unknown")).toEqual(original);
  });

  test("recognizes an exact preset while treating owner-edited colors as custom", () => {
    const applied = applyPortalThemePreset({ brandName: "Northstar Catering" }, "coastal-blue");
    expect(findPortalThemePreset(applied)?.id).toBe("coastal-blue");
    expect(findPortalThemePreset({ ...applied, brandBackgroundEnd: "#ffffff" })).toBeNull();
  });

  test("builds safe portal variables and chooses readable action text", () => {
    const style = buildPortalThemeStyle({
      ...PORTAL_THEME_PRESETS[1].colors,
      brandPrimaryColor: "not-a-color",
      brandDarkAccentColor: "#fefefe"
    });

    expect(style["--portal-brand"]).toBe(PORTAL_THEME_PRESETS[0].colors.brandPrimaryColor);
    expect(style["--portal-action"]).toBe("#fefefe");
    expect(style["--portal-action-text"]).toBe("#17130f");
    expect(contrastRatio(style["--portal-action"], style["--portal-action-text"])).toBeGreaterThanOrEqual(4.5);
    expect(style["--portal-link"]).toBe("#17130f");
    expect(style["--portal-focus"]).toBe("#17130f");
    expect(contrastRatio(style["--portal-link"], "#fbfbf8")).toBeGreaterThanOrEqual(4.5);
    expect(contrastRatio(style["--portal-focus"], "#fbfbf8")).toBeGreaterThanOrEqual(3);
  });

  test("keeps branded link and focus colors when they remain accessible", () => {
    PORTAL_THEME_PRESETS.forEach((preset) => {
      const style = buildPortalThemeStyle(preset.colors);
      expect(style["--portal-link"]).toBe(preset.colors.brandDarkAccentColor);
      expect(style["--portal-focus"]).toBe(preset.colors.brandDarkAccentColor);
      expect(contrastRatio(style["--portal-link"], "#fbfbf8")).toBeGreaterThanOrEqual(4.5);
      expect(contrastRatio(style["--portal-focus"], "#fbfbf8")).toBeGreaterThanOrEqual(3);
    });
  });
});
