import { describe, expect, test } from "vitest";
import { logoUrlWasNormalized, normalizeBrandLogoUrl } from "../brandLogoUrl";

describe("brand logo URL normalization", () => {
  test("keeps direct HTTPS and safe local assets", () => {
    expect(normalizeBrandLogoUrl("https://cdn.example.test/logo.png"))
      .toBe("https://cdn.example.test/logo.png");
    expect(normalizeBrandLogoUrl("/images/logo.png")).toBe("/images/logo.png");
  });

  test("extracts direct HTTPS images from Google result links", () => {
    const indirect = "https://www.google.com/imgres?imgurl=https%3A%2F%2Fcdn.example.test%2Fbrand.png";
    expect(normalizeBrandLogoUrl(indirect)).toBe("https://cdn.example.test/brand.png");
    expect(logoUrlWasNormalized(indirect)).toBe(true);
  });

  test("rejects unsafe schemes and malformed relative paths", () => {
    expect(normalizeBrandLogoUrl("javascript:alert(1)")).toBe("");
    expect(normalizeBrandLogoUrl("//example.test/logo.png")).toBe("");
    expect(normalizeBrandLogoUrl("/images/logo with spaces.png")).toBe("");
  });
});
