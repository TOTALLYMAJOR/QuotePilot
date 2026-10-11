import { describe, expect, test } from "vitest";
import { buildQuoteWorkspaceSummary } from "../QuoteWorkspaceConceptPage";
import { buildAmbientLivingOpportunityPresentation } from "../ambientLivingOpportunityPresentation";

const quote = {
  id: "quote-summary", quoteNumber: "QP-SUMMARY", status: "accepted",
  customer: { name: "Maya Bennett", email: "maya@example.test" },
  event: { name: "Autumn dinner", date: "2026-09-19", time: "18:00", venue: "The Foundry", guests: 120, style: "Plated" },
  totals: { total: 12345, deposit: 3000 }, selection: {}
};
function previousSummary(value, source) {
  if (!value) return null;
  try {
    const full = buildAmbientLivingOpportunityPresentation(value, { source });
    return { identity: full.identity, guestObject: { currentGuestCount: full.guestObject.currentGuestCount } };
  } catch {
    return null;
  }
}

describe("Quote Workspace bounded summary", () => {
  test.each([undefined, null, {}, { ...quote, event: null, customer: null, totals: null },
    { ...quote, event: { name: "", date: "not-a-date", time: "unknown", guests: "not-a-number" }, status: "unknown-state" }
  ])("preserves the previous identity and fallback for incomplete records %#", (value) => {
    expect(buildQuoteWorkspaceSummary(value, { source: "firebase" })).toEqual(previousSummary(value, "firebase"));
  });

  test.each([0, null, undefined, -1, 0.1, 1, 1.5, 120, "175", 400, 401, Infinity, NaN, "invalid"])("preserves recorded guest normalization for %s", (guests) => {
    const value = { ...quote, event: { ...quote.event, guests } };
    expect(buildQuoteWorkspaceSummary(value, { source: "local" })).toEqual(previousSummary(value, "local"));
  });

  test("preserves exact rendered title, dates, status, identity and recorded money", () => {
    const result = buildQuoteWorkspaceSummary(quote, { source: "firebase" });
    expect(result).toEqual(previousSummary(quote, "firebase"));
    expect(result.identity).toMatchObject({ quoteId: "quote-summary", quoteNumber: "QP-SUMMARY", eventName: "Autumn dinner", customerName: "Maya Bennett", venue: "The Foundry", time: "6:00 PM", status: { label: "Accepted" } });
    expect(result.guestObject.currentGuestCount).toBe(120);
  });
});
