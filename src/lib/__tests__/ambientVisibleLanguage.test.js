import { readFileSync } from "node:fs";
import { describe, expect, test } from "vitest";

const AMBIENT_VISIBLE_SURFACES = Object.freeze([
  "src/components/AmbientClientsView.jsx",
  "src/components/AmbientGlobalPilotSurface.jsx",
  "src/components/AmbientLibraryRoute.jsx",
  "src/components/AmbientLivingOpportunity.jsx",
  "src/components/AmbientNowView.jsx",
  "src/components/AmbientOpportunitiesStream.jsx",
  "src/components/CustomerPortalView.jsx",
  "src/components/MessagingStation.jsx",
  "src/components/PilotCommandBar.jsx"
]);

const SALES_HEAVY_PHRASES = Object.freeze([
  "facts that move",
  "move the deal",
  "deal velocity"
]);

const CALM_LANGUAGE_RULES = Object.freeze([
  Object.freeze({
    phrase: "ai autopilot (auto apply)",
    paths: Object.freeze([
      "src/components/AdminCatalogModal.jsx"
    ])
  }),
  Object.freeze({
    phrase: "customer 360",
    paths: Object.freeze([
      "src/components/CommandCenterHome.jsx",
      "src/components/CustomerRebookDraftAction.jsx",
      "src/components/CustomerRevenueOpportunities.jsx",
      "src/components/SalesWorkflowModal.jsx",
      "src/components/nowPresentation.js",
      "src/lib/anniversaryRebookingAttention.js",
      "functions/rebookQuoteDraft.js"
    ])
  }),
  Object.freeze({
    phrase: "loading decision debt",
    paths: Object.freeze(["src/components/DecisionDebtPanel.jsx"])
  }),
  Object.freeze({
    phrase: "decision debt requires",
    paths: Object.freeze(["src/components/QuoteDecisionDebtPanel.jsx"])
  }),
  Object.freeze({
    phrase: "decision debt is unavailable",
    paths: Object.freeze(["src/components/QuoteDecisionDebtPanel.jsx"])
  }),
  Object.freeze({
    phrase: "a recorded decision debt item",
    paths: Object.freeze(["src/lib/workspaceArrivalContract.js"])
  }),
  Object.freeze({
    phrase: "no alternate debt item",
    paths: Object.freeze(["src/components/SalesWorkflowModal.jsx"])
  }),
  Object.freeze({
    phrase: "revenue autopilot requires",
    paths: Object.freeze(["src/components/SalesWorkflowModal.jsx"])
  })
]);

describe("Ambient visible-language guard", () => {
  test("keeps staff and customer task surfaces free of sales-deck phrasing", () => {
    const visibleSource = AMBIENT_VISIBLE_SURFACES
      .map((path) => readFileSync(path, "utf8"))
      .join("\n")
      .toLowerCase();

    for (const phrase of SALES_HEAVY_PHRASES) {
      expect(visibleSource, phrase).not.toContain(phrase);
    }
  });

  test("keeps retired product jargon out of its user-facing source locations", () => {
    for (const rule of CALM_LANGUAGE_RULES) {
      const visibleSource = rule.paths
        .map((path) => readFileSync(path, "utf8"))
        .join("\n")
        .toLowerCase();
      expect(visibleSource, `${rule.phrase}: ${rule.paths.join(", ")}`)
        .not.toContain(rule.phrase);
    }
  });
});
