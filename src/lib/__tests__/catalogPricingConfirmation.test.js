import { describe, expect, test } from "vitest";
import {
  buildLocalCatalogPricingConfirmation,
  isCatalogPricingConfirmationCurrent
} from "../catalogPricingConfirmation";

function confirmedSettings(overrides = {}) {
  return {
    pricingSetupConfirmed: true,
    catalogRevision: 7,
    pricingConfirmation: {
      actorUid: "admin-1",
      actorEmail: "admin@example.com",
      confirmedAtISO: "2026-08-06T15:30:00.000Z",
      confirmedCatalogRevision: 7
    },
    ...overrides
  };
}

describe("catalog pricing confirmation receipt", () => {
  test("accepts only an attributed receipt for the exact current revision", () => {
    expect(isCatalogPricingConfirmationCurrent(confirmedSettings())).toBe(true);
    expect(isCatalogPricingConfirmationCurrent(confirmedSettings({ pricingSetupConfirmed: false }))).toBe(false);
    expect(isCatalogPricingConfirmationCurrent(confirmedSettings({ catalogRevision: 8 }))).toBe(false);
    expect(isCatalogPricingConfirmationCurrent(confirmedSettings({ pricingConfirmation: null }))).toBe(false);
    expect(isCatalogPricingConfirmationCurrent(confirmedSettings({
      pricingConfirmation: {
        ...confirmedSettings().pricingConfirmation,
        actorUid: ""
      }
    }))).toBe(false);
    expect(isCatalogPricingConfirmationCurrent(confirmedSettings({
      pricingConfirmation: {
        ...confirmedSettings().pricingConfirmation,
        confirmedAtISO: "not-a-timestamp"
      }
    }))).toBe(false);
  });

  test("builds a deterministic local receipt tied to the supplied revision", () => {
    expect(buildLocalCatalogPricingConfirmation({ catalogRevision: 3 }, {
      actorUid: "local-admin",
      actorEmail: "LOCAL@EXAMPLE.COM",
      confirmedAtISO: "2026-08-06T16:00:00.000Z"
    })).toEqual({
      actorUid: "local-admin",
      actorEmail: "local@example.com",
      confirmedAtISO: "2026-08-06T16:00:00.000Z",
      confirmedCatalogRevision: 3
    });
    expect(buildLocalCatalogPricingConfirmation({ catalogRevision: -1 })).toBeNull();
  });
});
