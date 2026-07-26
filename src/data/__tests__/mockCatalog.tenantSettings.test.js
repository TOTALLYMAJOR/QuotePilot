import { describe, expect, test } from "vitest";
import { DEFAULT_SETTINGS, normalizeCatalog } from "../mockCatalog";

function tenantCatalog(settings = {}) {
  return normalizeCatalog({
    packages: [],
    addons: [],
    rentals: [],
    settings
  });
}

describe("tenant catalog identity normalization", () => {
  test("preserves intentionally blank tenant contact, logo, and crew fields", () => {
    const catalog = tenantCatalog({
      brandName: "MBMapps",
      brandLogoUrl: "",
      brandCrew: [],
      quotePreparedBy: "",
      businessPhone: "",
      businessEmail: "",
      businessAddress: "",
      acceptanceEmail: ""
    });

    expect(catalog.settings).toMatchObject({
      brandName: "MBMapps",
      brandLogoUrl: "",
      brandCrew: [],
      quotePreparedBy: "",
      businessPhone: "",
      businessEmail: "",
      businessAddress: "",
      acceptanceEmail: ""
    });
  });

  test("uses neutral appearance fallbacks for a custom tenant with legacy missing colors", () => {
    const catalog = tenantCatalog({ brandName: "MBMapps" });

    expect(catalog.settings.brandPrimaryColor).toBe("#1f2937");
    expect(catalog.settings.brandBackgroundStart).toBe("#f3f4f6");
    expect(catalog.settings.heroHeadline).toBe("MBMapps Quote Operations");
  });

  test("preserves tenant-selected colors across normalization", () => {
    const catalog = tenantCatalog({
      brandName: "MBMapps",
      brandPrimaryColor: "#123456",
      brandAccentColor: "#abcdef",
      brandBackgroundStart: "#102030",
      brandBackgroundMid: "#203040",
      brandBackgroundEnd: "#304050"
    });

    expect(catalog.settings).toMatchObject({
      brandPrimaryColor: "#123456",
      brandAccentColor: "#abcdef",
      brandBackgroundStart: "#102030",
      brandBackgroundMid: "#203040",
      brandBackgroundEnd: "#304050"
    });
  });

  test("retains legacy defaults when tenant identity settings are missing", () => {
    const catalog = tenantCatalog();

    expect(catalog.settings.brandName).toBe(DEFAULT_SETTINGS.brandName);
    expect(catalog.settings.businessAddress).toBe(DEFAULT_SETTINGS.businessAddress);
    expect(catalog.settings.brandCrew).toEqual(DEFAULT_SETTINGS.brandCrew);
  });
});
