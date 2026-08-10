import { describe, expect, test } from "vitest";
import { calculateQuote } from "../../lib/quoteCalculator";
import { buildApplyPayload } from "../CreateIntake";
import { extractIntentDraft } from "../intentExtraction";
import { PRICING_BAND_MODEL, buildPricingBand, deriveGuestBand } from "../pricingBand";

const settings = {
  perMileRate: 0.7,
  longDistancePerMileRate: 1.1,
  deliveryThresholdMiles: 30,
  serverRate: 22,
  chefRate: 28,
  bartenderRate: 30,
  serviceFeePct: 0.2,
  serviceFeeTiers: [
    { id: "small", minGuests: 0, maxGuests: 99, pct: 0.2 },
    { id: "large", minGuests: 100, maxGuests: 9999, pct: 0.18 }
  ],
  taxRate: 0.1,
  taxRegions: [{ id: "local", name: "Local", rate: 0.1 }],
  defaultTaxRegion: "local",
  depositPct: 0.3,
  seasonalProfiles: [{
    id: "standard", name: "Standard",
    startMonth: 1, startDay: 1, endMonth: 12, endDay: 31,
    packageMultiplier: 1, addonMultiplier: 1, rentalMultiplier: 1
  }]
};

const catalog = {
  packages: [{ id: "classic", name: "Classic", ppp: 20 }],
  addons: [],
  rentals: [],
  settings
};

const form = {
  pkg: "classic",
  guests: 115,
  hours: 6,
  servers: 0,
  chefs: 0,
  bartenders: 0,
  addons: [],
  rentals: [],
  menuItems: [],
  addonQuantities: {},
  rentalQuantities: {},
  menuItemQuantities: {},
  milesRT: 0,
  date: "2026-03-15",
  style: "Buffet"
};

describe("deriveGuestBand", () => {
  test("keeps a stated range verbatim", () => {
    const band = deriveGuestBand({ id: "guests", field: "guests", kind: "range", value: 115, min: 100, max: 130, source: "100 to 130 guests" });
    expect(band).toEqual({ kind: "range", min: 100, max: 130, appliedValue: 115, source: "100 to 130 guests" });
  });

  test("derives a ±10% band for approximate counts", () => {
    const band = deriveGuestBand({ id: "guests", field: "guests", kind: "approximate", value: 80, source: "about 80 people" });
    expect(band.min).toBe(72);
    expect(band.max).toBe(88);
    expect(band.appliedValue).toBe(80);
  });

  test("returns null for exact counts, non-guest facts, and malformed input", () => {
    expect(deriveGuestBand({ id: "guests", field: "guests", kind: "exact", value: 120 })).toBeNull();
    expect(deriveGuestBand({ id: "date", field: "date", kind: "range", value: 1, min: 1, max: 2 })).toBeNull();
    expect(deriveGuestBand({ id: "guests", field: "guests", kind: "range", value: 115, min: 130, max: 100 })).toBeNull();
    expect(deriveGuestBand(null)).toBeNull();
  });
});

describe("buildPricingBand", () => {
  const band = { kind: "range", min: 100, max: 130, appliedValue: 115, source: "100 to 130 guests" };

  test("prices both ends with the exact same preview calculator", () => {
    const result = buildPricingBand({ form, catalog, settings, band });
    const low = calculateQuote({ ...form, guests: 100 }, catalog, settings);
    const high = calculateQuote({ ...form, guests: 130 }, catalog, settings);
    expect(result.modelId).toBe(PRICING_BAND_MODEL);
    expect(result.lowTotal).toBe(low.total);
    expect(result.highTotal).toBe(high.total);
    expect(result.lowDeposit).toBe(low.deposit);
    expect(result.highDeposit).toBe(high.deposit);
    expect(result.lowTotal).toBeLessThan(result.highTotal);
    expect(result.note).toContain("100–130 guest range");
  });

  test("labels approximate bands with their spread", () => {
    const approx = { kind: "approximate", min: 72, max: 88, appliedValue: 80, source: "about 80 people" };
    const result = buildPricingBand({ form: { ...form, guests: 80 }, catalog, settings, band: approx });
    expect(result.note).toContain("±10%");
    expect(result.note).toContain("~80");
  });

  test("returns null without a band or with malformed bounds", () => {
    expect(buildPricingBand({ form, catalog, settings, band: null })).toBeNull();
    expect(buildPricingBand({ form, catalog, settings, band: { kind: "range", min: 0, max: 10 } })).toBeNull();
    expect(buildPricingBand({ form, catalog, settings, band: { kind: "range", min: 10, max: 10 } })).toBeNull();
    expect(buildPricingBand({ band: { kind: "range", min: 10, max: 20 } })).toBeNull();
  });
});

describe("buildApplyPayload", () => {
  const NOW = new Date("2026-08-10T09:00:00");

  test("carries the guest band alongside the draft for uncertain counts", () => {
    const result = extractIntentDraft("Reception for 100 to 130 guests.", { nowDate: NOW });
    const payload = buildApplyPayload(result);
    expect(payload.draft.guests).toBe(115);
    expect(payload.guestBand).toMatchObject({ kind: "range", min: 100, max: 130, appliedValue: 115 });
  });

  test("carries no band when the operator stated an exact count", () => {
    const result = extractIntentDraft("Reception for 120 guests.", { nowDate: NOW });
    const payload = buildApplyPayload(result);
    expect(payload.draft.guests).toBe(120);
    expect(payload.guestBand).toBeNull();
  });
});
