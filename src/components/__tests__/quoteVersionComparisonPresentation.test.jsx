import React from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, test } from "vitest";
import { QuoteVersionComparisonPresentation } from "../QuoteVersionComparison";

function comparison(overrides = {}) {
  return {
    comparisonState: "complete",
    equivalence: "different",
    evidenceBoundary: "Advisory comparison of stored immutable version fields only.",
    issues: [],
    before: {
      identity: {
        versionNumber: { state: "known", value: 1 },
        createdAtISO: { state: "known", value: "2026-08-01T12:00:00.000Z" }
      }
    },
    after: {
      identity: {
        versionNumber: { state: "known", value: 2 },
        createdAtISO: { state: "known", value: "2026-08-02T12:00:00.000Z" }
      }
    },
    summary: {
      changedFieldCount: 2,
      unknownFieldCount: 0
    },
    sections: [{
      id: "scope",
      label: "Scope",
      state: "changed",
      summary: { changed: 2 },
      fields: [
        {
          id: "scope.guestCount",
          label: "Guest count",
          valueType: "number",
          before: { state: "known", value: 125 },
          after: { state: "known", value: 175 },
          comparison: "changed"
        },
        {
          id: "scope.customerName",
          label: "Customer name",
          valueType: "text",
          before: { state: "known", value: "Henderson Group" },
          after: { state: "known", value: "Henderson Group" },
          comparison: "unchanged"
        }
      ]
    }],
    ...overrides
  };
}

describe("Quote version comparison presentation", () => {
  test("renders only material immutable-version changes with human-readable values", () => {
    const markup = renderToStaticMarkup(
      <QuoteVersionComparisonPresentation comparison={comparison()} />
    );

    expect(markup).toContain('data-capability-state="success"');
    expect(markup).toContain("Version 1");
    expect(markup).toContain("Version 2");
    expect(markup).toContain("Guest count");
    expect(markup).toContain("Before: 125");
    expect(markup).toContain("After: 175");
    expect(markup).not.toContain("Customer name");
    expect(markup).toContain("stored immutable version fields only");
  });

  test("renders partial unknown values without inventing a value", () => {
    const partial = comparison({
      comparisonState: "partial",
      summary: { changedFieldCount: 1, unknownFieldCount: 1 },
      sections: [{
        id: "terms",
        label: "Terms",
        state: "changed_partial",
        summary: { changed: 1 },
        fields: [{
          id: "terms.depositNotice",
          label: "Deposit notice",
          valueType: "text",
          before: { state: "unknown", value: null },
          after: { state: "known", value: "30% due" },
          comparison: "unknown"
        }]
      }]
    });
    const markup = renderToStaticMarkup(<QuoteVersionComparisonPresentation comparison={partial} />);

    expect(markup).toContain('data-capability-state="partial"');
    expect(markup).toContain("Not recorded");
    expect(markup).toContain("30% due");
  });

  test("renders fail-closed identity problems and the two-version empty state", () => {
    const unavailableMarkup = renderToStaticMarkup(
      <QuoteVersionComparisonPresentation comparison={comparison({
        comparisonState: "unavailable",
        equivalence: "undetermined",
        issues: ["quote_identity_mismatch"],
        sections: []
      })} />
    );
    const emptyMarkup = renderToStaticMarkup(<QuoteVersionComparisonPresentation comparison={null} />);

    expect(unavailableMarkup).toContain('data-capability-state="error"');
    expect(unavailableMarkup).toContain("Quote identity mismatch");
    expect(emptyMarkup).toContain('data-capability-state="empty"');
    expect(emptyMarkup).toContain("Two retained immutable versions are required");
  });
});
