import { createRequire } from "node:module";
import { describe, expect, test } from "vitest";

const require = createRequire(import.meta.url);
const {
  EventProfitReviewError,
  buildAcceptedEstimateBasis,
  buildEventProfitSummary,
  buildInitialEventProfitReview,
  planEventProfitReviewMutation,
  projectEventProfitReviewSummary
} = require("../../../functions/eventProfitReview.js");
const { buildCanonicalPortalSnapshot } = require("../../../functions/quoteCreation.js");

const binding = { sourceVersionId: "v0003", acceptanceReceiptId: "acceptance-1234567890" };
const actor = { uid: "admin-1", email: "owner@example.test", role: "admin" };
const actuals = {
  grossRevenueCents: 500000,
  discountsCents: 10000,
  refundsCreditsCents: 5000,
  foodCents: 120000,
  laborCents: 90000,
  deliverySetupCents: 0,
  rentalsVendorsCents: 30000,
  packagingSuppliesCents: 0,
  paymentFeesCents: 0,
  otherDirectCents: 0,
  allocatedOverheadCents: 20000
};
const confirmedZeroFields = [
  "deliverySetupCents", "packagingSuppliesCents", "paymentFeesCents", "otherDirectCents"
];

function sourceVersion(overrides = {}) {
  return {
    snapshot: {
      pricing: {
        totals: { base: 4000, addons: 500, rentals: 300, menu: 0, labor: 0, serviceFee: 0 },
        commercialSnapshot: {
          targetMarginPct: 0.4,
          package: { id: "buffet", name: "Buffet", extendedCost: 1000 },
          addons: [{ id: "dessert", extendedCost: 200 }],
          menuItems: [],
          rentals: [{ id: "linen", extendedCost: 300 }],
          staffing: { enabled: true, roles: [{ id: "servers", count: 2, extendedCost: 800 }] }
        },
        ...overrides
      }
    }
  };
}

function request(action, expectedReviewRevision = 0, overrides = {}) {
  return {
    organizationId: "org-one",
    quoteId: "quote-one",
    closeoutId: "closeout-one",
    requestId: `profit_review_request_${action}_${expectedReviewRevision}`,
    action,
    expectedReviewRevision,
    actuals,
    lossSignals: {
      foodWasteCents: 10000,
      overtimePremiumCents: 5000,
      serviceRecoveryCents: 2500
    },
    confirmedZeroFields,
    comparisonBasisConfirmed: true,
    targetMarginBps: 4000,
    notes: "Operator-recorded actuals.",
    ...overrides
  };
}

describe("event profit review authority", () => {
  test("derives contribution without double-counting explanatory loss signals", () => {
    const summary = buildEventProfitSummary({
      inputs: request("finalize"),
      estimateBasis: buildAcceptedEstimateBasis(sourceVersion())
    });
    expect(summary).toMatchObject({
      netEventRevenueCents: 485000,
      directCostCents: 240000,
      contributionCents: 245000,
      profitAfterAllocatedOverheadCents: 225000,
      advisoryNextEventPriceCents: 433334
    });
    expect(summary.comparison).toMatchObject({
      available: true,
      quotedContributionCents: 250000,
      contributionVarianceCents: -5000
    });
  });

  test("fails closed when accepted costs are incomplete or bases do not match", () => {
    const incomplete = sourceVersion();
    incomplete.snapshot.pricing.commercialSnapshot.package.extendedCost = null;
    expect(buildAcceptedEstimateBasis(incomplete)).toMatchObject({
      available: false,
      reason: "accepted_cost_basis_incomplete"
    });
    const mismatch = buildEventProfitSummary({
      inputs: request("finalize", 0, {
        actuals: { ...actuals, deliverySetupCents: 12000 },
        confirmedZeroFields: confirmedZeroFields.filter((field) => field !== "deliverySetupCents")
      }),
      estimateBasis: buildAcceptedEstimateBasis(sourceVersion())
    });
    expect(mismatch.comparison).toMatchObject({ available: false, reason: "comparison_basis_mismatch" });
    const unconfirmed = buildEventProfitSummary({
      inputs: request("finalize", 0, { comparisonBasisConfirmed: false }),
      estimateBasis: buildAcceptedEstimateBasis(sourceVersion())
    });
    expect(unconfirmed.comparison).toMatchObject({
      available: false,
      reason: "actual_comparison_basis_not_confirmed"
    });
  });

  test("requires explicit confirmation for recorded zero evidence", () => {
    expect(() => planEventProfitReviewMutation({
      request: request("finalize", 0, { confirmedZeroFields: [] }),
      currentProfitReview: buildInitialEventProfitReview(binding),
      binding,
      sourceVersion: sourceVersion(),
      actor,
      nowISO: "2026-08-21T12:00:00.000Z"
    })).toThrowError(EventProfitReviewError);
  });

  test("rejects non-admin mutation authority", () => {
    expect(() => planEventProfitReviewMutation({
      request: request("save_draft"),
      currentProfitReview: buildInitialEventProfitReview(binding),
      binding,
      sourceVersion: sourceVersion(),
      actor: { ...actor, role: "sales" },
      nowISO: "2026-08-21T12:00:00.000Z"
    })).toThrow(/admin evidence/i);
  });

  test("fences revisions and replays an exact request idempotently", () => {
    const planned = planEventProfitReviewMutation({
      request: request("finalize"),
      currentProfitReview: buildInitialEventProfitReview(binding),
      binding,
      sourceVersion: sourceVersion(),
      actor,
      nowISO: "2026-08-21T12:00:00.000Z"
    });
    expect(planned.nextProfitReview).toMatchObject({ state: "final", reviewRevision: 1 });
    expect(projectEventProfitReviewSummary(planned.nextProfitReview, binding)).not.toHaveProperty("actuals");
    const replay = planEventProfitReviewMutation({
      request: request("finalize"),
      currentProfitReview: buildInitialEventProfitReview(binding),
      binding,
      sourceVersion: sourceVersion(),
      actor,
      nowISO: "2026-08-21T12:05:00.000Z",
      existingReceipt: planned.receipt
    });
    expect(replay).toMatchObject({ kind: "replay", idempotent: true });
    expect(() => planEventProfitReviewMutation({
      request: request("finalize", 0, { notes: "Changed under the same request ID." }),
      currentProfitReview: buildInitialEventProfitReview(binding),
      binding,
      sourceVersion: sourceVersion(),
      actor,
      nowISO: "2026-08-21T12:06:00.000Z",
      existingReceipt: planned.receipt
    })).toThrow(/different input/i);
    expect(() => planEventProfitReviewMutation({
      request: request("save_draft", 0),
      currentProfitReview: planned.nextProfitReview,
      binding,
      sourceVersion: sourceVersion(),
      actor,
      nowISO: "2026-08-21T12:10:00.000Z"
    })).toThrow(/revision conflict/i);
  });

  test("legacy closeouts normalize to not_started without backfill", () => {
    expect(projectEventProfitReviewSummary(undefined, binding)).toEqual(expect.objectContaining({
      state: "not_started",
      reviewRevision: 0
    }));
    expect(() => projectEventProfitReviewSummary({
      ...buildInitialEventProfitReview(binding),
      sourceVersionId: "v-other"
    }, binding)).toThrow(/exact accepted proposal source/i);
  });

  test("customer portal projection never receives profit review data", () => {
    const portal = buildCanonicalPortalSnapshot("quote-one", {
      organizationId: "org-one",
      customerId: "customer-one",
      portalKey: "portal-one",
      customer: { name: "Client", email: "client@example.test" },
      event: { name: "Dinner", date: "2026-09-01" },
      totals: { total: 5000 },
      workflow: {
        postEventCloseout: {
          profitReview: {
            actuals,
            notes: "private",
            summary: { contributionCents: 245000 }
          }
        }
      }
    });
    expect(JSON.stringify(portal)).not.toMatch(/profitReview|contributionCents|private/);
  });
});
