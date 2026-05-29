import { describe, expect, test } from "vitest";
import {
  buildCanonicalMenuForEventType,
  CANONICAL_MENU_CATEGORY_COUNT,
  CANONICAL_MENU_ITEM_COUNT,
  CANONICAL_MENU_TEMPLATE
} from "../canonicalMenuTemplate";

describe("canonicalMenuTemplate", () => {
  test("defines the expected category and item counts", () => {
    expect(CANONICAL_MENU_CATEGORY_COUNT).toBe(10);
    expect(CANONICAL_MENU_ITEM_COUNT).toBe(93);
    expect(CANONICAL_MENU_TEMPLATE).toHaveLength(10);
  });

  test("uses exact menu category names for canonical source", () => {
    expect(CANONICAL_MENU_TEMPLATE.map((section) => section.name)).toEqual([
      "Appetizers",
      "Sides",
      "Desserts",
      "Meats",
      "Salads",
      "Beverages",
      "Pastas",
      "Specialty Bars",
      "Soups",
      "Breads"
    ]);
  });

  test("builds deterministic scoped docs for an event type", () => {
    const result = buildCanonicalMenuForEventType("wedding");
    expect(result.categories).toHaveLength(10);
    expect(result.items).toHaveLength(93);

    const firstCategory = result.categories[0];
    expect(firstCategory.id).toBe("wedding__appetizers");
    expect(firstCategory.name).toBe("Appetizers");

    const firstItem = result.items.find((item) => item.id === "wedding__appetizers__cocktail-meatballs");
    expect(firstItem).toEqual({
      id: "wedding__appetizers__cocktail-meatballs",
      eventTypeId: "wedding",
      categoryId: "wedding__appetizers",
      name: "Cocktail Meatballs",
      pricingType: "per_event",
      type: "per_event",
      price: 0,
      active: true
    });
  });
});
