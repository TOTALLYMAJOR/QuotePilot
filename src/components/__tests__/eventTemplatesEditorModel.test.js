import { describe, expect, test } from "vitest";
import {
  buildEventTemplateWarnings,
  flattenEventTemplateMenuItems,
  nextEventTemplateId
} from "../EventTemplatesEditor";

describe("EventTemplatesEditor model helpers", () => {
  test("creates a stable noncolliding local ID without changing existing identities", () => {
    expect(nextEventTemplateId([
      { id: "wedding" },
      { id: "template-1" },
      { id: "template-3" }
    ])).toBe("template-2");
  });

  test("flattens section-owned menu items and keeps exact event ownership", () => {
    expect(flattenEventTemplateMenuItems(
      [{ id: "coffee", name: "Coffee" }],
      [{
        id: "dinner",
        eventTypeId: "wedding",
        items: [
          { id: "salad", name: "Garden salad" },
          { id: "coffee", name: "Coffee service" }
        ]
      }]
    )).toEqual([
      expect.objectContaining({ id: "salad", eventTypeId: "wedding" }),
      expect.objectContaining({ id: "coffee", eventTypeId: "wedding", name: "Coffee" })
    ]);
  });

  test("explains missing, inactive, duplicate, and cross-event dependencies", () => {
    const warnings = buildEventTemplateWarnings({
      id: "wedding",
      eventTypeId: "wedding",
      pkg: "retired-package",
      addons: ["missing-addon"],
      rentals: ["linens"],
      menuItems: ["board-lunch"]
    }, {
      eventTypes: [{ id: "wedding", name: "Wedding" }],
      packages: [{ id: "retired-package", name: "Retired package", active: false }],
      addons: [],
      rentals: [{ id: "linens", name: "Linens", active: false }],
      menuItems: [{ id: "board-lunch", name: "Board lunch", eventTypeId: "corporate" }],
      menuInventoryComplete: true,
      duplicateIds: new Set(["wedding"])
    });

    expect(warnings.map((warning) => warning.code)).toEqual(expect.arrayContaining([
      "duplicate-template-id",
      "inactive-package",
      "missing-addon",
      "inactive-rental",
      "cross-event-menu-item"
    ]));
    expect(warnings.every((warning) => warning.message.length > 8)).toBe(true);
  });

  test("does not claim an unseen saved menu reference is missing when inventory is partial", () => {
    const warnings = buildEventTemplateWarnings({
      id: "wedding",
      eventTypeId: "wedding",
      pkg: "deluxe",
      addons: [],
      rentals: [],
      menuItems: ["unloaded-course"]
    }, {
      eventTypes: [{ id: "wedding", name: "Wedding" }],
      packages: [{ id: "deluxe", name: "Deluxe" }],
      menuItems: [],
      menuInventoryComplete: false
    });

    expect(warnings.map((warning) => warning.code)).not.toContain("missing-menu-item");
  });
});
