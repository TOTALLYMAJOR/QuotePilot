import { describe, expect, test } from "vitest";
import { buildCanonicalMenuSyncPlan } from "../menuCanonicalSync";

describe("menuCanonicalSync", () => {
  test("plans full canonical coverage for each event type", () => {
    const plan = buildCanonicalMenuSyncPlan({
      eventTypeIds: ["wedding", "corporate"],
      existingCategories: [],
      existingItems: [],
      nowISO: "2026-04-01T12:00:00.000Z"
    });

    expect(plan.expectedCounts.eventTypes).toBe(2);
    expect(plan.expectedCounts.categoriesTotal).toBe(20);
    expect(plan.expectedCounts.itemsTotal).toBe(186);
    expect(plan.categories.create).toHaveLength(20);
    expect(plan.items.create).toHaveLength(186);
    expect(plan.categories.delete).toHaveLength(0);
    expect(plan.items.delete).toHaveLength(0);
  });

  test("plans updates plus orphan cleanup when existing docs are inconsistent", () => {
    const plan = buildCanonicalMenuSyncPlan({
      eventTypeIds: ["wedding"],
      existingCategories: [
        {
          id: "wedding__appetizers",
          data: {
            eventTypeId: "wedding",
            name: "Apps",
            createdAtISO: "2026-03-01T00:00:00.000Z"
          }
        },
        {
          id: "legacy__mains",
          data: {
            eventTypeId: "legacy",
            name: "Legacy Mains"
          }
        }
      ],
      existingItems: [
        {
          id: "wedding__appetizers__cocktail-meatballs",
          data: {
            eventTypeId: "wedding",
            categoryId: "wedding__appetizers",
            name: "Cocktail Meatballs",
            pricingType: "per_event",
            type: "per_event",
            price: 5,
            active: true,
            createdAtISO: "2026-03-01T00:00:00.000Z"
          }
        },
        {
          id: "legacy-item",
          data: {
            eventTypeId: "legacy",
            categoryId: "legacy__mains",
            name: "Old Item",
            pricingType: "per_event",
            type: "per_event",
            price: 0,
            active: true
          }
        }
      ],
      nowISO: "2026-04-01T12:00:00.000Z"
    });

    expect(plan.categories.create).toHaveLength(9);
    expect(plan.items.create).toHaveLength(92);
    expect(plan.categories.update).toHaveLength(1);
    expect(plan.items.update).toHaveLength(1);
    expect(plan.categories.delete).toHaveLength(1);
    expect(plan.items.delete).toHaveLength(1);
    expect(plan.categories.orphanDeletes).toBe(1);
    expect(plan.items.orphanDeletes).toBe(1);
  });
});
