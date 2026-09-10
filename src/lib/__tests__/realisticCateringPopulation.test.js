import { createRequire } from "node:module";
import { describe, expect, it } from "vitest";
import {
  buildRecipeLines,
  CREATIVE_MENU_ITEMS,
  MENU_TARGET,
  REALISTIC_INGREDIENTS,
  REALISTIC_LOCATIONS,
  RECIPE_TARGET
} from "../../../scripts/realistic-catering-population-data.mjs";
import { parsePopulationArgs } from "../../../scripts/populate-ragnakok-inventory.mjs";

const require = createRequire(import.meta.url);
const { createRecipeRevision } = require("../../../functions/inventoryRecipeCore.cjs");

describe("realistic catering population fixture", () => {
  it("is dry-run-first and restricts apply to exact projects, tenant, and confirmation", () => {
    expect(parsePopulationArgs([
      "--project", "tonicatering", "--organization", "mm05366-sandbox"
    ])).toMatchObject({ apply: false, projectId: "tonicatering", organizationId: "mm05366-sandbox" });
    expect(() => parsePopulationArgs([
      "--project", "tonicatering", "--organization", "another-org"
    ])).toThrow(/restricted to organization mm05366-sandbox/u);
    expect(() => parsePopulationArgs([
      "--project", "another-project", "--organization", "mm05366-sandbox"
    ])).toThrow(/Project must be one of/u);
    expect(() => parsePopulationArgs([
      "--project", "tonicatering", "--organization", "mm05366-sandbox", "--apply"
    ])).toThrow(/Apply requires --confirm/u);
    expect(parsePopulationArgs([
      "--project", "quotepilot-staging-20260804",
      "--organization", "mm05366-sandbox",
      "--apply",
      "--confirm", "POPULATE quotepilot-staging-20260804 mm05366-sandbox ragnakok-realistic-v1"
    ])).toMatchObject({ apply: true, projectId: "quotepilot-staging-20260804" });
  });

  it("exceeds the 500-menu floor in the smaller isolated staging catalog", () => {
    expect(CREATIVE_MENU_ITEMS).toHaveLength(130);
    expect(372 + CREATIVE_MENU_ITEMS.length).toBeGreaterThanOrEqual(MENU_TARGET);
    expect(new Set(CREATIVE_MENU_ITEMS.map(({ name }) => name.toLowerCase())).size).toBe(
      CREATIVE_MENU_ITEMS.length
    );
  });

  it("stays within bounded Inventory workspace and recipe limits", () => {
    expect(REALISTIC_INGREDIENTS).toHaveLength(132);
    expect(REALISTIC_INGREDIENTS.length).toBeLessThanOrEqual(200);
    expect(RECIPE_TARGET).toBe(200);
    expect(REALISTIC_LOCATIONS).toHaveLength(5);
    expect(new Set(REALISTIC_INGREDIENTS.map(({ ingredientKey }) => ingredientKey)).size).toBe(
      REALISTIC_INGREDIENTS.length
    );
  });

  it("produces valid governed recipe revisions for every creative dish", () => {
    CREATIVE_MENU_ITEMS.forEach((menuItem, index) => {
      const revision = createRecipeRevision({
        organizationId: "fixture-org",
        menuItemId: `fixture-menu-${index + 1}`,
        revision: 1,
        priorRecipeRevisionId: "",
        outputYield: "1",
        outputUnitId: "each",
        lines: buildRecipeLines(menuItem),
        publishedAtISO: "2026-09-10T09:00:00.000Z"
      });
      expect(revision.validity).toBe("valid");
      expect(revision.lines.length).toBeGreaterThan(0);
    });
  });

  it("preserves the six-pound Chicken Alfredo shortage scenario at 175 guests", () => {
    const lines = buildRecipeLines({
      name: "Chicken Alfredo Pasta",
      sectionId: "pastas",
      categoryId: "wedding__pastas"
    });
    const chicken = REALISTIC_INGREDIENTS.find(({ name }) => name === "Chicken");
    const chickenLine = lines.find(({ ingredientId }) => ingredientId === chicken.ingredientId);
    expect(chicken.openingQuantity).toBe("64");
    expect(chicken.supplier).toBe("Supplier B");
    expect(chickenLine.quantity).toBe("0.4");
    expect((175 * Number(chickenLine.quantity)) - Number(chicken.openingQuantity)).toBe(6);
  });
});
