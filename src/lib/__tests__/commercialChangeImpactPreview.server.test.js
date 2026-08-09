import { createRequire } from "node:module";
import { describe, expect, test } from "vitest";
import { simulateCommercialChangeImpact } from "../commercialChangeImpact";

const require = createRequire(import.meta.url);
const {
  CommercialChangeImpactPreviewError,
  buildCommercialChangeImpactPreviewSnapshots
} = require("../../../functions/commercialChangeImpactPreview.js");
const graphCore = require("../../../functions/commercialDependencyGraphCore.cjs");
const { createCommercialChangeImpactEvaluator } = require(
  "../../../functions/commercialChangeImpactEvaluator.js"
);
const evaluateServerImpact = createCommercialChangeImpactEvaluator({ graphCore });

function pricing({ guests = 125, total = 12480, deposit = 3120 } = {}) {
  return {
    authority: "server_authoritative",
    pricingVersion: "pricing-v1",
    grandTotal: total,
    deposit: { amount: deposit },
    inputs: {
      event: {
        guests,
        servers: 4,
        chefs: 2,
        bartenders: 1,
        milesRT: 20,
        taxRegionId: "central",
        seasonProfileId: "summer"
      },
      selection: {
        package: { id: "buffet", quantity: 1 },
        addons: [{ id: "coffee", quantity: 1 }],
        rentals: [{ id: "chair", quantity: guests }],
        menuItems: [{ id: "chicken", quantity: 1 }]
      }
    },
    lineItems: [{
      id: "buffet",
      category: "package",
      pricingMode: "per_person",
      unitPrice: total / guests,
      quantity: guests
    }],
    rulesSnapshot: {
      pricingSettingsVersion: 3,
      pricingSettingsUpdatedAtISO: "2026-08-01T00:00:00.000Z",
      settingsSnapshot: { depositPct: 0.25 },
      seasonProfileId: "summer",
      packageMultiplier: 1,
      taxRegionId: "central",
      taxRateApplied: 0.09,
      travel: { milesRT: 20 }
    }
  };
}

function quote() {
  return {
    id: "quote-1",
    organizationId: "org-1",
    customerId: "customer-1",
    activeVersionId: "v0014",
    status: "draft",
    event: {
      name: "Annual picnic",
      date: "2026-09-01",
      time: "12:00",
      venue: "North lawn",
      venueAddress: "1 Park Way",
      guests: 125,
      hours: 4,
      style: "Buffet",
      servers: 4,
      chefs: 2,
      bartenders: 1,
      dietaryRestrictions: "Vegetarian option"
    },
    pricing: pricing(),
    workflow: { quoteDelivery: { state: "idle" } },
    payment: { depositStatus: "unpaid" },
    booking: {}
  };
}

function form(overrides = {}) {
  return {
    eventName: "Annual picnic",
    date: "2026-09-01",
    time: "12:00",
    venue: "North lawn",
    venueAddress: "1 Park Way",
    guests: 175,
    hours: 4,
    style: "Buffet",
    servers: 4,
    chefs: 2,
    bartenders: 1,
    dietaryRestrictions: "Vegetarian option",
    ...overrides
  };
}

describe("server-owned commercial change-impact snapshots", () => {
  test("produces exact snapshots accepted by the browser evaluator", () => {
    const preview = buildCommercialChangeImpactPreviewSnapshots({
      organizationId: "org-1",
      quoteId: "quote-1",
      expectedActiveVersionId: "v0014",
      currentQuote: quote(),
      proposedForm: form(),
      proposedPricing: pricing({ guests: 175, total: 16920, deposit: 4230 })
    });
    const result = simulateCommercialChangeImpact(preview);

    expect(preview.identity).toMatchObject({
      beforeRevisionId: "v0014",
      proposedRevisionId: expect.stringMatching(/^preview_[a-f0-9]{48}$/)
    });
    expect(preview.proposedAfterSnapshot.facts["fact.quote.active_revision"]).toBe("v0014");
    expect(result.factDiffs).toContainEqual({
      nodeId: "fact.event.guest_count",
      before: 125,
      proposedAfter: 175
    });
    expect(result.commercialValues.authoritativeTotal).toMatchObject({
      before: 12480,
      proposedAfter: 16920,
      changed: true
    });
    expect(result.impact.dependentNodes.some((node) => node.id === "artifact.kitchen_beo"))
      .toBe(true);
  });

  test("keeps the deployable server evaluator in exact parity with the browser presentation model", () => {
    const preview = buildCommercialChangeImpactPreviewSnapshots({
      organizationId: "org-1",
      quoteId: "quote-1",
      expectedActiveVersionId: "v0014",
      currentQuote: quote(),
      proposedForm: form(),
      proposedPricing: pricing({ guests: 175, total: 16920, deposit: 4230 })
    });

    expect(evaluateServerImpact(preview)).toEqual(simulateCommercialChangeImpact(preview));
  });

  test("is deterministic for the same canonical source and proposed input", () => {
    const input = {
      organizationId: "org-1",
      quoteId: "quote-1",
      expectedActiveVersionId: "v0014",
      currentQuote: quote(),
      proposedForm: form(),
      proposedPricing: pricing({ guests: 175, total: 16920, deposit: 4230 })
    };
    expect(buildCommercialChangeImpactPreviewSnapshots(input))
      .toEqual(buildCommercialChangeImpactPreviewSnapshots(input));
  });

  test("keeps an unchanged edit empty instead of manufacturing revision staleness", () => {
    const preview = buildCommercialChangeImpactPreviewSnapshots({
      organizationId: "org-1",
      quoteId: "quote-1",
      expectedActiveVersionId: "v0014",
      currentQuote: quote(),
      proposedForm: form({ guests: 125 }),
      proposedPricing: pricing()
    });
    const result = simulateCommercialChangeImpact(preview);

    expect(result.factDiffs).toEqual([]);
    expect(result.impact.rootNodeIds).toEqual([]);
    expect(result.impact.dependentNodes).toEqual([]);
  });

  test.each([
    [{ organizationId: "org-2" }, "permission-denied"],
    [{ currentQuote: { ...quote(), pricing: { authority: "client_preview" } } }, "failed-precondition"],
    [{ proposedPricing: { ...pricing(), authority: "client_preview" } }, "failed-precondition"]
  ])("fails closed for invalid authority or scope", (overrides, code) => {
    expect(() => buildCommercialChangeImpactPreviewSnapshots({
      organizationId: "org-1",
      quoteId: "quote-1",
      expectedActiveVersionId: "v0014",
      currentQuote: quote(),
      proposedForm: form(),
      proposedPricing: pricing({ guests: 175, total: 16920, deposit: 4230 }),
      ...overrides
    })).toThrow(expect.objectContaining({
      name: CommercialChangeImpactPreviewError.name,
      code
    }));
  });

  test("fails closed when the canonical revision changed after the editor loaded", () => {
    expect(() => buildCommercialChangeImpactPreviewSnapshots({
      organizationId: "org-1",
      quoteId: "quote-1",
      expectedActiveVersionId: "v0013",
      currentQuote: quote(),
      proposedForm: form(),
      proposedPricing: pricing({ guests: 175, total: 16920, deposit: 4230 })
    })).toThrow(expect.objectContaining({
      name: CommercialChangeImpactPreviewError.name,
      code: "aborted"
    }));
  });

  test("never places customer contact content in the preview", () => {
    const currentQuote = {
      ...quote(),
      customer: {
        name: "Henderson Secret Name",
        email: "henderson-secret@example.test",
        phone: "205-555-0199"
      }
    };
    const preview = buildCommercialChangeImpactPreviewSnapshots({
      organizationId: "org-1",
      quoteId: "quote-1",
      expectedActiveVersionId: "v0014",
      currentQuote,
      proposedForm: form(),
      proposedPricing: pricing({ guests: 175, total: 16920, deposit: 4230 })
    });
    expect(JSON.stringify(preview)).not.toContain("Henderson Secret Name");
    expect(JSON.stringify(preview)).not.toContain("henderson-secret@example.test");
    expect(JSON.stringify(preview)).not.toContain("205-555-0199");
  });
});
