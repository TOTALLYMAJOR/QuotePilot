import { describe, expect, test } from "vitest";
import { DEFAULT_FEATURE_FLAGS, normalizeCatalog } from "../../data/mockCatalog";
import {
  buildCommercialConsequenceComparison,
  buildDecisionPacketProjection,
  buildGovernedQuoteStarts,
  resolveDecisionPacketGate
} from "../quoteConfidenceDecisionPacket";

function consequenceProjection(overrides = {}) {
  return {
    state: "ready",
    scenario: {
      currentGuestCount: 80,
      proposedGuestCount: 96,
      selectedMenuItemNames: ["Braised chicken", "Market greens"],
      ...overrides.scenario
    },
    consequences: {
      commercial: {
        evidenceState: "available",
        currency: "USD",
        total: { before: 8_000, proposedAfter: 9_200, delta: 1_200 }
      },
      margin: {
        evidenceState: "available",
        before: 0.31,
        proposedAfter: 0.27,
        delta: -0.04
      },
      ...overrides.consequences
    },
    fulfillment: {
      people: {
        evidenceState: "available",
        freshness: "current",
        current: { totalRequired: 5, totalAssigned: 5, totalGap: 0 },
        proposed: { totalRequired: 6, totalAssigned: 5, totalGap: 1 }
      },
      supply: {
        evidenceState: "available",
        freshness: "current",
        current: { coverageState: "covered", shortageCount: 0 },
        proposed: { coverageState: "shortage", shortageCount: 2 }
      },
      ...overrides.fulfillment
    }
  };
}

describe("quote-to-confidence consequence comparison", () => {
  test("builds six explicit Current / Proposed / Difference rows from existing projections", () => {
    const comparison = buildCommercialConsequenceComparison(consequenceProjection());

    expect(comparison.rows.map((row) => row.id)).toEqual([
      "guests",
      "menu",
      "price",
      "margin",
      "staffing",
      "supply"
    ]);
    expect(comparison.rows.find((row) => row.id === "price")).toMatchObject({
      current: "$8,000.00",
      proposed: "$9,200.00",
      difference: "+$1,200.00",
      evidenceState: "available"
    });
    expect(comparison.rows.find((row) => row.id === "staffing")).toMatchObject({
      current: "5 required · 5 assigned",
      proposed: "6 required · 5 assigned",
      difference: "+1 required · 1 uncovered",
      evidenceState: "available"
    });
    expect(comparison.canContinueToGovernedReview).toBe(true);
  });

  test.each(["missing", "stale", "contradictory", "unavailable"])(
    "keeps %s supply evidence explicit and blocks review authorization",
    (evidenceState) => {
      const comparison = buildCommercialConsequenceComparison(consequenceProjection({
        fulfillment: {
          supply: {
            evidenceState,
            freshness: evidenceState === "stale" ? "stale" : "unavailable"
          }
        }
      }));
      const supply = comparison.rows.find((row) => row.id === "supply");

      expect(supply).toMatchObject({
        current: "Not available",
        proposed: "Not available",
        difference: "Not available",
        evidenceState
      });
      expect(comparison.canContinueToGovernedReview).toBe(false);
      expect(comparison.blockingEvidenceStates).toContain(evidenceState);
    }
  );
});

describe("governed quote starts", () => {
  test("presents blank, active Library template, and exact accepted-event review as handoffs", () => {
    const starts = buildGovernedQuoteStarts({
      templates: [
        { id: "template-approved", name: "Wedding reception", active: true },
        { id: "template-retired", name: "Retired", active: false }
      ]
    });

    expect(starts.map((start) => start.id)).toEqual(["blank", "template", "prior_accepted"]);
    expect(starts[1]).toMatchObject({
      availability: "available",
      provenance: "Current active Library template",
      action: "review_existing_template"
    });
    expect(starts[1].templates.map((template) => template.id)).toEqual(["template-approved"]);
    expect(starts[2]).toMatchObject({
      authority: "existing_exact_version_rebook",
      action: "open_existing_rebook_review"
    });
  });
});

describe("decision packet projection", () => {
  const acceptedQuote = {
    id: "quote-17",
    organizationId: "org-1",
    status: "accepted",
    activeVersionId: "v17",
    portalKey: "portal-key",
    portalIssuedAtISO: "2026-09-17T10:00:00.000Z",
    deliveryEvidence: { revisionId: "v17" },
    portalDecision: {
      decision: "accepted",
      submittedAtISO: "2026-09-17T10:30:00.000Z",
      requestId: "decision-17"
    },
    acceptanceReceipt: {
      receiptId: "acceptance-17",
      quoteRevisionId: "v17",
      portalIssuedAtISO: "2026-09-17T10:00:00.000Z",
      acceptedAtISO: "2026-09-17T10:30:00.000Z",
      signerName: "Ada Lovelace"
    },
    payment: {
      depositStatus: "paid",
      depositConfirmedAtISO: "2026-09-17T10:45:00.000Z",
      finalBalance: { status: "unpaid" }
    }
  };

  test("composes portal decision, exact acceptance, payment, and internal handoff without authority", () => {
    const packet = buildDecisionPacketProjection({ quote: acceptedQuote, source: "firebase" });

    expect(packet).toMatchObject({
      schemaVersion: "quote-decision-packet-v1",
      authority: "read_only_composition",
      state: "ready",
      portalDecision: { evidenceState: "available", decision: "accepted" },
      acceptance: { evidenceState: "available", receiptId: "acceptance-17" },
      payment: { evidenceState: "available", depositState: "paid" },
      internalHandoff: {
        evidenceState: "available",
        acceptedRevisionId: "v17",
        action: "open_existing_accepted_revision"
      }
    });
    expect(packet.boundary).toMatch(/does not accept, charge, book, deliver, or revise/i);
  });

  test("fails closed when the acceptance receipt points at a stale revision", () => {
    const packet = buildDecisionPacketProjection({
      quote: {
        ...acceptedQuote,
        acceptanceReceipt: { ...acceptedQuote.acceptanceReceipt, quoteRevisionId: "v16" }
      },
      source: "firebase"
    });

    expect(packet.state).toBe("blocked");
    expect(packet.acceptance.evidenceState).toBe("stale");
    expect(packet.internalHandoff).toMatchObject({
      evidenceState: "stale",
      action: null
    });
  });

  test("does not present local fallback records as connected decision or payment evidence", () => {
    const packet = buildDecisionPacketProjection({ quote: acceptedQuote, source: "local" });

    expect(packet).toMatchObject({
      state: "blocked",
      portalDecision: { evidenceState: "unavailable", decision: null },
      acceptance: { evidenceState: "unavailable", receiptId: null },
      payment: { evidenceState: "unavailable", depositState: null },
      internalHandoff: { evidenceState: "unavailable", action: null }
    });
  });

  test("requires both build and tenant gates", () => {
    expect(DEFAULT_FEATURE_FLAGS.decisionPacket).toBe(false);
    expect(normalizeCatalog({ settings: {} }).settings.featureFlags.decisionPacket).toBe(false);
    expect(resolveDecisionPacketGate()).toBe(false);
    expect(resolveDecisionPacketGate({ buildValue: "true", tenantValue: true })).toBe(true);
    expect(resolveDecisionPacketGate({ buildValue: "true", tenantValue: false })).toBe(false);
    expect(resolveDecisionPacketGate({ buildValue: "false", tenantValue: true })).toBe(false);
  });
});
