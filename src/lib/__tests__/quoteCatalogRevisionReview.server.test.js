import { createRequire } from "node:module";
import { describe, expect, test } from "vitest";

const require = createRequire(import.meta.url);
const {
  QUOTE_CATALOG_REVIEW_STATES,
  buildQuoteCatalogRevisionReview,
  buildQuoteCatalogReviewReceipt,
  rateProvenanceLabel
} = require("../../../functions/quoteCatalogRevisionReview");

const NOW = "2026-09-01T02:00:00.000Z";

function settings(revision = 8) {
  return {
    catalogRevision: revision,
    pricingSetupConfirmed: true,
    pricingConfirmation: {
      actorUid: "admin",
      actorEmail: "admin@example.test",
      confirmedAtISO: NOW,
      confirmedCatalogRevision: revision
    },
    serverRateMinor: 4800,
    chefRateMinor: 6200,
    bartenderRateMinor: 5000,
    staffingChargeMode: "per_hour"
  };
}

function collections() {
  return {
    catalogPackages: [{ id: "pkg", data: { name: "Dinner", pppMinor: 4800, active: true } }],
    catalogAddons: [{ id: "coffee", data: { name: "Coffee", priceMinor: 300, pricingType: "per_person", active: true } }],
    catalogRentals: [{ id: "chair", data: { name: "Chair", priceMinor: 800, pricingType: "per_item", qtyPerGuests: 1, active: true } }],
    menuItems: [{ id: "salmon", data: { name: "Salmon", priceMinor: 3400, pricingType: "per_person", active: true } }]
  };
}

function quote(revision = 7) {
  return {
    id: "quote-1",
    organizationId: "org-1",
    status: "draft",
    activeVersionId: "v0002",
    pricingCatalogAuthority: {
      schemaVersion: 1,
      organizationId: "org-1",
      catalogSource: "firebase",
      catalogRevision: revision,
      confirmedCatalogRevision: revision,
      settingsFingerprintSha256: `fingerprint-${revision}`
    },
    pricing: {
      inputs: {
        selection: {
          package: { id: "pkg", name: "Dinner", ppp: 48 },
          addons: [{ id: "coffee", name: "Coffee", price: 3, pricingType: "per_person" }],
          rentals: [{ id: "chair", name: "Chair", price: 8, pricingType: "per_item", qtyPerGuests: 1 }],
          menuItems: [{ id: "salmon", name: "Salmon", price: 34, pricingType: "per_person" }]
        }
      },
      rulesSnapshot: { staffingChargeMode: "per_hour" }
    },
    selection: {
      laborRateSnapshot: {
        serverRateApplied: 24,
        chefRateApplied: 32,
        bartenderRateApplied: 50
      },
      serverRateOverride: null,
      chefRateOverride: null,
      bartenderRateOverride: null
    }
  };
}

function review(overrides = {}) {
  return buildQuoteCatalogRevisionReview({
    organizationId: "org-1",
    quoteId: "quote-1",
    quote: quote(),
    settings: settings(),
    collections: collections(),
    observedAtISO: NOW,
    ...overrides
  });
}

describe("quote catalog revision review", () => {
  test("declares the five authoritative states", () => {
    expect(QUOTE_CATALOG_REVIEW_STATES).toEqual([
      "current", "newer_catalog_no_selected_impact", "review_required", "legacy_unknown", "unavailable"
    ]);
  });

  test("requires review for saved 24/32 staffing rates after the catalog moves to 48/62", () => {
    const result = review();
    expect(result.state).toBe("review_required");
    expect(result.diffs).toEqual(expect.arrayContaining([
      expect.objectContaining({ field: "server_rate", quotedValue: 24, currentValue: 48 }),
      expect.objectContaining({ field: "chef_rate", quotedValue: 32, currentValue: 62 })
    ]));
    expect(result.rateProvenance.server).toBe("Quoted at catalog revision 7");
    expect(JSON.stringify(result)).not.toContain("house rate");
  });

  test("distinguishes a newer unrelated revision from selected impact", () => {
    const currentQuote = quote();
    currentQuote.selection.laborRateSnapshot.serverRateApplied = 48;
    currentQuote.selection.laborRateSnapshot.chefRateApplied = 62;
    const result = review({ quote: currentQuote });
    expect(result.state).toBe("newer_catalog_no_selected_impact");
    expect(result.diffs).toEqual([]);
    expect(result.blocking).toBe(false);
  });

  test("keeps inactive and missing selected choices visible in the difference review", () => {
    const current = collections();
    current.menuItems[0].data.active = false;
    current.catalogAddons = [];
    const result = review({ collections: current });
    expect(result.diffs).toEqual(expect.arrayContaining([
      expect.objectContaining({ category: "addon", field: "availability", currentValue: "missing" }),
      expect.objectContaining({ category: "menu_item", field: "availability", currentValue: false })
    ]));
  });

  test("does not synthesize historical authority for legacy quotes", () => {
    const legacy = quote();
    delete legacy.pricingCatalogAuthority;
    const result = review({ quote: legacy });
    expect(result.state).toBe("legacy_unknown");
    expect(result.headline).toBe("Legacy revision unknown");
    expect(result.rateProvenance.server).toBe("Saved rate — source revision unavailable");
  });

  test("marks an exact current authority current", () => {
    const result = review({ quote: quote(8) });
    expect(result.state).toBe("current");
    expect(result.rateProvenance.server).toBe("Current catalog rate");
  });

  test("fails closed when current catalog confirmation is unavailable", () => {
    const current = settings();
    current.pricingSetupConfirmed = false;
    expect(review({ settings: current }).state).toBe("unavailable");
  });

  test("records keep as a version-and-revision fenced freeze receipt", () => {
    const result = review();
    const receipt = buildQuoteCatalogReviewReceipt({
      review: result,
      outcome: "keep_quoted_values",
      requestId: "review_outcome_1234567890",
      actor: { uid: "staff", email: "staff@example.test", role: "sales" },
      recordedAtISO: NOW
    });
    expect(receipt).toMatchObject({
      quoteVersionId: "v0002",
      reviewedCatalogRevision: 8,
      freezesCommercialInputs: true,
      requiresGovernedCurrentCatalogSimulation: false
    });
  });

  test("terminal quotes reject outcomes and direct operators to duplicate or reopen", () => {
    const terminal = quote();
    terminal.status = "accepted";
    const result = review({ quote: terminal });
    expect(result.terminal).toBe(true);
    expect(result.nextAction.label).toBe("Duplicate or reopen quote");
    expect(() => buildQuoteCatalogReviewReceipt({
      review: result,
      outcome: "keep_quoted_values",
      requestId: "review_outcome_1234567890",
      actor: { uid: "staff", email: "staff@example.test" },
      recordedAtISO: NOW
    })).toThrow(/Terminal quotes are immutable/);
  });

  test("labels explicit overrides without claiming a catalog source", () => {
    expect(rateProvenanceLabel({ override: 31, quoteAuthority: quote().pricingCatalogAuthority, currentRevision: 8 }))
      .toBe("Quote override");
  });
});
