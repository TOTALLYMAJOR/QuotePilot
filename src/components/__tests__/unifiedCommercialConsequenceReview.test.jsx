// @vitest-environment jsdom
import React, { act } from "react";
import { createRoot } from "react-dom/client";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, test, vi } from "vitest";
import UnifiedCommercialConsequenceReview from "../UnifiedCommercialConsequenceReview";
import { buildUnifiedCommercialConsequenceReview } from "../../lib/unifiedCommercialConsequenceReview";

function review() {
  return buildUnifiedCommercialConsequenceReview({
    model: {
      identity: { beforeRevisionId: "v1", proposedRevisionId: "preview-v2" },
      factDiffs: [],
      commercialValues: {
        authoritativeTotal: { before: 100, proposedAfter: 120 },
        depositRequirement: { before: 25, proposedAfter: 30 }
      }
    },
    recommendations: [{ key: "coffee", kind: "addon", id: "coffee", label: "Add coffee", reason: "Policy matched", impact: "$20" }],
    margin: { available: true, marginPct: 0.4, note: "Recorded costs." },
    proposalReadiness: { complete: true, gaps: [] },
    catalogRevision: 4
  });
}

function render(props = {}) {
  return renderToStaticMarkup(
    <UnifiedCommercialConsequenceReview
      review={review()}
      scopeCurrent
      onApplyAll={vi.fn()}
      onApplySelected={vi.fn()}
      onKeepQuotedPlan={vi.fn()}
      {...props}
    />
  );
}

describe("UnifiedCommercialConsequenceReview", () => {
  test("renders all six groups, named sources, and three outcomes", () => {
    const html = render();
    ["Price and deposit", "Staffing", "Rentals", "Guided recommendations", "Margin evidence", "Proposal readiness"]
      .forEach((label) => expect(html).toContain(label));
    expect(html).toContain("Server-authoritative quote simulation");
    expect(html).toContain("Operator-declared guided-selling policy");
    expect(html).toContain("Tenant-recorded staff-only cost evidence");
    expect(html).toContain("Draft completeness policy");
    expect(html).toContain("Stage all in form");
    expect(html).toContain("Stage selected in form");
    expect(html).toContain("Keep quoted plan");
    expect(html).toContain("do not save, approve, or authoritatively apply a quote");
    expect(html).toContain('data-capability-state="success"');
  });

  test("fails closed when a revision fence is stale", () => {
    const html = render({ scopeCurrent: false });
    expect(html).toContain('data-capability-state="stale"');
    expect(html).toContain("quote, catalog, or simulation fence changed");
    expect(html).toContain("disabled=\"\"");
  });

  test("preserves an operator selection when recommendation identities are unchanged", () => {
    const container = document.createElement("div");
    document.body.appendChild(container);
    const root = createRoot(container);
    const props = {
      scopeCurrent: true,
      onApplyAll: vi.fn(),
      onApplySelected: vi.fn(),
      onKeepQuotedPlan: vi.fn()
    };
    act(() => root.render(<UnifiedCommercialConsequenceReview review={review()} {...props} />));
    const checkbox = container.querySelector('input[type="checkbox"]');
    expect(checkbox.checked).toBe(true);
    act(() => checkbox.click());
    expect(checkbox.checked).toBe(false);

    act(() => root.render(<UnifiedCommercialConsequenceReview review={review()} {...props} />));
    expect(container.querySelector('input[type="checkbox"]').checked).toBe(false);
    act(() => root.unmount());
    container.remove();
  });
});
