import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { describe, expect, test } from "vitest";
import { normalizeCatalog } from "../../data/mockCatalog";

const APP_SOURCE = readFileSync(
  fileURLToPath(new URL("../../App.jsx", import.meta.url)),
  "utf8"
);
const ADMIN_SOURCE = readFileSync(
  fileURLToPath(new URL("../../components/AdminCatalogModal.jsx", import.meta.url)),
  "utf8"
);

describe("tenant business time-zone authority", () => {
  test("retains a valid IANA setting and fails closed for invalid or absent values", () => {
    expect(normalizeCatalog({
      settings: {
        pricingSetupConfirmed: true,
        businessTimeZone: "America/Chicago"
      }
    }).settings.businessTimeZone).toBe("America/Chicago");
    expect(normalizeCatalog({
      settings: {
        pricingSetupConfirmed: true,
        businessTimeZone: "Mars/Olympus"
      }
    }).settings.businessTimeZone).toBe("");
    expect(normalizeCatalog({ settings: { pricingSetupConfirmed: true } })
      .settings.businessTimeZone).toBe("");
  });

  test("binds the setting to discoverable admin configuration plus revenue and rebook surfaces", () => {
    expect(ADMIN_SOURCE).toContain("Business time zone");
    expect(ADMIN_SOURCE).toContain('patchTextSetting("businessTimeZone"');
    expect(ADMIN_SOURCE).toContain("Revenue timing stays blocked until this is valid");
    expect(APP_SOURCE).toContain('effectiveSettings.businessTimeZone || ""');
    expect(APP_SOURCE.match(/tenantTimeZone=\{tenantTimeZone\}/g)).toHaveLength(4);
  });
});
