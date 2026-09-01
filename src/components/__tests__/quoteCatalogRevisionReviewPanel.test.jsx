import React from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, test, vi } from "vitest";
import QuoteCatalogRevisionReviewPanel from "../QuoteCatalogRevisionReviewPanel";

function render(review, props = {}) {
  return renderToStaticMarkup(
    <QuoteCatalogRevisionReviewPanel
      review={review}
      onRetry={vi.fn()}
      onKeepQuotedValues={vi.fn()}
      onReviewAndUpdate={vi.fn()}
      {...props}
    />
  );
}

describe("QuoteCatalogRevisionReviewPanel", () => {
  test("shows saved and current values with exact non-house provenance", () => {
    const html = render({
      state: "review_required",
      headline: "2 catalog changes need review",
      quotedCatalogRevision: 7,
      currentCatalogRevision: 8,
      terminal: false,
      diffs: [
        { id: "staff:server", label: "Server rate", field: "server_rate", quotedValue: 24, currentValue: 48 },
        { id: "staff:chef", label: "Chef rate", field: "chef_rate", quotedValue: 32, currentValue: 62 }
      ],
      rateProvenance: {
        server: "Quoted at catalog revision 7",
        chef: "Quoted at catalog revision 7",
        bartender: "Quote override"
      }
    });
    expect(html).toContain('data-capability-state="reconciliation"');
    expect(html).toContain("Quoted: 24 → Current: 48");
    expect(html).toContain("Keep quoted values");
    expect(html).toContain("Review and update");
    expect(html).not.toContain("house rate");
  });

  test("labels legacy authority without inventing a revision", () => {
    const html = render({
      state: "legacy_unknown",
      headline: "Legacy revision unknown",
      terminal: false,
      diffs: [],
      rateProvenance: {
        server: "Saved rate — source revision unavailable",
        chef: "Saved rate — source revision unavailable",
        bartender: "Saved rate — source revision unavailable"
      }
    });
    expect(html).toContain("Legacy revision unknown");
    expect(html).toContain("Saved rate — source revision unavailable");
  });

  test("keeps terminal quotes immutable", () => {
    const html = render({
      state: "review_required",
      headline: "Catalog review required",
      terminal: true,
      diffs: [],
      rateProvenance: {}
    });
    expect(html).toContain("Duplicate or reopen");
    expect(html).not.toContain("Keep quoted values</button>");
  });

  test("shows an immutable outcome receipt and removes duplicate actions", () => {
    const html = render({
      state: "review_required",
      headline: "Catalog review required",
      terminal: false,
      diffs: [],
      rateProvenance: {}
    }, {
      resolvedOutcome: "keep_quoted_values",
      receipt: { receiptId: "receipt-1" }
    });
    expect(html).toContain("Quoted values preserved for this saved version");
    expect(html).not.toContain("Review and update</button>");
  });

  test("projects ready for a current quote", () => {
    const html = render({ state: "current", headline: "Current", terminal: false, diffs: [], rateProvenance: {} });
    expect(html).toContain('data-capability-state="ready"');
  });

  test("projects uncertain when current catalog authority is unavailable", () => {
    const html = render({ state: "unavailable", headline: "Unavailable", terminal: false, diffs: [], rateProvenance: {} });
    expect(html).toContain('data-capability-state="uncertain"');
  });

  test("projects error for a definitive review failure", () => {
    const html = render(null, { error: "Review failed." });
    expect(html).toContain('data-capability-state="error"');
  });

  test("projects recovery before a review can be loaded", () => {
    const html = render(null);
    expect(html).toContain('data-capability-state="recovery"');
  });

  test("projects submitting while the review outcome is being recorded", () => {
    const html = render({ state: "review_required", headline: "Review", terminal: false, diffs: [], rateProvenance: {} }, { submitting: true });
    expect(html).toContain('data-capability-state="submitting"');
  });

  test("projects receipt after an immutable outcome is recorded", () => {
    const html = render({ state: "review_required", headline: "Review", terminal: false, diffs: [], rateProvenance: {} }, {
      resolvedOutcome: "keep_quoted_values",
      receipt: { receiptId: "receipt-state" }
    });
    expect(html).toContain('data-capability-state="receipt"');
  });
});
