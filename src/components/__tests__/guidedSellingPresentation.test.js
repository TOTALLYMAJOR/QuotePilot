import { describe, expect, test } from "vitest";
import {
  GUIDED_SELLING_BOUNDS_NOTE,
  GUIDED_SELLING_CARDS_MODEL,
  buildGuidedSellingCard,
  buildGuidedSellingCards
} from "../guidedSellingPresentation";

const dessertRecommendation = {
  key: "rule-1-addon-dessert",
  kind: "addon",
  id: "dessert",
  label: "Add Dessert Bites",
  reason: "Dessert upgrades are popular for events with 40+ guests.",
  impact: "~$480.00 impact"
};

describe("buildGuidedSellingCard", () => {
  test("dresses an existing recommendation in the full decision grammar", () => {
    const card = buildGuidedSellingCard(dessertRecommendation);
    expect(card.title).toBe("Add Dessert Bites");
    expect(card.meta).toBe("Add-on");
    expect(card.label).toBe("Advisory");
    expect(card.sentence).toBe("Dessert upgrades are popular for events with 40+ guests.");
    expect(card.basis).toContain("guided-selling rule in your catalog settings");
    expect(card.impact).toBe("~$480.00 impact");
    expect(card.action).toEqual({ id: "apply", kind: "primary", label: "Take it" });
    expect(card.recommendation).toBe(dessertRecommendation);
  });

  test("explains itself through the Why? provenance lines", () => {
    const card = buildGuidedSellingCard(dessertRecommendation);
    expect(card.why).toHaveLength(3);
    expect(card.why[0]).toContain(GUIDED_SELLING_CARDS_MODEL);
    expect(card.why[1]).toContain("Dessert upgrades are popular");
    expect(card.why[2]).toContain("saving re-prices authoritatively on the server");
  });

  test("preserves autopilot semantics as a disabled Auto action", () => {
    const card = buildGuidedSellingCard(dessertRecommendation, { aiAutopilotEnabled: true });
    expect(card.action).toEqual({ id: "apply", kind: "primary", label: "Auto", disabled: true });
  });

  test("labels package and rental kinds and tolerates unknown kinds", () => {
    expect(buildGuidedSellingCard({ ...dessertRecommendation, kind: "package" }).meta).toBe("Package upgrade");
    expect(buildGuidedSellingCard({ ...dessertRecommendation, kind: "rental" }).meta).toBe("Rental");
    expect(buildGuidedSellingCard({ ...dessertRecommendation, kind: "mystery" }).meta).toBe("Suggestion");
  });
});

describe("buildGuidedSellingCards", () => {
  test("maps every valid recommendation and reports the model and bounds", () => {
    const result = buildGuidedSellingCards({
      recommendations: [dessertRecommendation, null, { kind: "addon" }]
    });
    expect(result.modelId).toBe(GUIDED_SELLING_CARDS_MODEL);
    expect(result.boundsNote).toBe(GUIDED_SELLING_BOUNDS_NOTE);
    expect(result.cards).toHaveLength(1);
  });

  test("returns an empty bounded result for missing input", () => {
    expect(buildGuidedSellingCards().cards).toEqual([]);
    expect(buildGuidedSellingCards({ recommendations: null }).cards).toEqual([]);
  });
});
