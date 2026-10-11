import { describe, expect, test } from "vitest";

import {
  COMMERCIAL_CONSEQUENCE_INTENTS,
  createCommercialConsequenceHandoff,
  isCommercialConsequenceArrival
} from "../../lib/commercialConsequenceNavigation";
import { parseWorkspaceArrivalHandoff } from "../../lib/workspaceArrivalContract";

const base = Object.freeze({
  quoteId: "quote-91",
  beforeRevisionId: "revision-before",
  proposedRevisionId: "revision-proposed",
  returnFocusId: "commercial-change-artifact-target"
});

function parsed(handoff) {
  const url = new URL(handoff.navigation.path, "https://quotepilot.local");
  return parseWorkspaceArrivalHandoff({
    pathname: url.pathname,
    search: url.search,
    hash: "",
    state: handoff.navigation.state
  });
}

describe("commercial consequence navigation", () => {
  test.each([
    ["proposal", "administration", "/app/quotes", "customer-decision-artifact"],
    ["kitchen_beo", "administration", "/app/quotes", "kitchen-beo"],
    ["production_plan", "schedule", "/app/operations", "production-plan"],
    ["staffing_requirement", "opportunity", "/app/quotes/quote-91", "staffing-plan"]
  ])("binds %s to its exact supported destination", (kind, destination, path, objectType) => {
    const handoff = createCommercialConsequenceHandoff({ kind, ...base }, {
      expectedQuoteId: base.quoteId
    });

    expect(handoff).toMatchObject({
      ok: true,
      contract: {
        destination,
        object: { id: base.quoteId, type: objectType },
        intentId: COMMERCIAL_CONSEQUENCE_INTENTS[kind],
        focus: {
          quoteId: base.quoteId,
          sourceRevisionId: base.beforeRevisionId,
          proposedRevisionId: base.proposedRevisionId
        }
      },
      navigation: { path, primaryActionReady: true },
      returnFocus: {
        kind: "commercial-consequence",
        objectId: base.quoteId,
        actionId: `review-commercial-consequence:${kind}`,
        controlId: base.returnFocusId
      }
    });
    expect(parsed(handoff)).toEqual(expect.objectContaining({ ok: true }));
    expect(isCommercialConsequenceArrival(handoff.contract)).toBe(true);
  });

  test("binds Inventory to one exact ingredient and base unit", () => {
    const handoff = createCommercialConsequenceHandoff({
      kind: "inventory_ingredient",
      targetId: "ingredient-chicken",
      baseUnitId: "lb",
      ...base
    }, { expectedQuoteId: base.quoteId });

    expect(handoff).toMatchObject({
      ok: true,
      contract: {
        destination: "inventory",
        object: { id: "ingredient-chicken", type: "inventory-ingredient" },
        focus: {
          quoteId: base.quoteId,
          ingredientId: "ingredient-chicken",
          baseUnitId: "lb",
          sourceRevisionId: base.beforeRevisionId,
          proposedRevisionId: base.proposedRevisionId
        }
      },
      navigation: { path: "/app/inventory", primaryActionReady: true }
    });
    expect(parsed(handoff)).toEqual(expect.objectContaining({ ok: true }));
  });

  test.each([
    [{ kind: "proposal", ...base, quoteId: "other-quote" }, "invalid_consequence_scope"],
    [{ kind: "proposal", ...base, beforeRevisionId: "" }, "invalid_consequence_scope"],
    [{ kind: "inventory_ingredient", ...base, targetId: "ingredient-chicken", baseUnitId: "" }, "invalid_inventory_target"],
    [{ kind: "schedule", ...base }, "unsupported_consequence"]
  ])("refuses incomplete or substituted consequence scope", (target, code) => {
    expect(createCommercialConsequenceHandoff(target, {
      expectedQuoteId: base.quoteId
    })).toMatchObject({ ok: false, recovery: { code } });
  });
});
