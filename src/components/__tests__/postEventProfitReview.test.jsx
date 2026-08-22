import React from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, test, vi } from "vitest";

vi.mock("../../lib/postEventProfitReviewClient", () => ({
  getPostEventProfitReview: vi.fn(),
  isDefinitiveEventProfitReviewError: vi.fn(() => false),
  readPendingEventProfitReviewAttempt: vi.fn(() => null),
  recordPostEventProfitReview: vi.fn(),
  resetDefinitiveEventProfitReviewAttempt: vi.fn(() => false)
}));

import PostEventProfitReview from "../PostEventProfitReview";

function opportunity(profitReview) {
  return {
    organizationId: "org-one",
    quoteId: "quote-one",
    reviewedAction: { closeoutId: "closeout-one" },
    profitReview
  };
}

describe("PostEventProfitReview", () => {
  test("renders a prioritized admin flow with explicit-zero and subset guidance", () => {
    const html = renderToStaticMarkup(
      <PostEventProfitReview
        opportunity={opportunity({ state: "draft", reviewRevision: 2 })}
        enabled
        isAdmin
      />
    );
    expect(html).toContain("Revenue");
    expect(html).toContain("Costs");
    expect(html).toContain("Loss signals");
    expect(html).toContain("Review");
    expect(html).toContain("never added to costs again");
    expect(html).toContain('data-capability-id="cwf-11-event-profit-review"');
  });

  test("shows sales only the finalized staff-safe summary", () => {
    const html = renderToStaticMarkup(
      <PostEventProfitReview
        opportunity={opportunity({
          state: "final",
          reviewRevision: 3,
          finalizedAtISO: "2026-08-21T12:00:00.000Z",
          summary: {
            contributionCents: 245000,
            contributionMarginBps: 5052,
            netEventRevenueCents: 485000,
            directCostCents: 240000,
            overheadRecorded: false,
            profitAfterAllocatedOverheadCents: null,
            advisoryNextEventPriceCents: 400000,
            comparison: { available: false, reason: "comparison_basis_mismatch" }
          }
        })}
        enabled
        isAdmin={false}
      />
    );
    expect(html).toContain("Event contribution");
    expect(html).toContain("$2,450.00");
    expect(html).toContain("Detailed inputs and notes remain admin-only");
    expect(html).not.toContain("Internal notes");
  });

  test("renders nothing while the tenant gate is off", () => {
    expect(renderToStaticMarkup(
      <PostEventProfitReview opportunity={opportunity({ state: "final" })} enabled={false} />
    )).toBe("");
  });
});
