import { beforeEach, describe, expect, test, vi } from "vitest";

vi.mock("../firebase", () => ({
  db: null,
  firebaseReady: false
}));

import {
  createCategory,
  createEventType,
  createMenuItem,
  deleteMenuItem,
  getEventTypes,
  getMenuCategories,
  getMenuItems,
  updateCategory,
  updateEventType,
  updateMenuItem
} from "../menuService";

describe("menuService fallback behavior", () => {
  beforeEach(() => {
    const values = new Map();
    vi.stubGlobal("localStorage", {
      getItem: vi.fn((key) => values.get(key) || null),
      setItem: vi.fn((key, value) => values.set(key, String(value))),
      removeItem: vi.fn((key) => values.delete(key)),
      clear: vi.fn(() => values.clear())
    });
  });

  test("returns persisted canonical menu fallbacks when firebase is unavailable", async () => {
    await expect(getEventTypes()).resolves.toEqual(
      expect.arrayContaining([
        expect.objectContaining({ id: "birthday" }),
        expect.objectContaining({ id: "church" }),
        expect.objectContaining({ id: "corporate" })
      ])
    );
    await expect(getMenuCategories("wedding")).resolves.not.toHaveLength(0);
    await expect(getMenuItems("wedding")).resolves.not.toHaveLength(0);
  });

  test("executes local event, category, and menu CRUD when firebase is unavailable", async () => {
    const eventType = await createEventType({ name: "Community Supper", organizationId: "org-a" });
    const category = await createCategory({
      eventTypeId: eventType.id,
      name: "Mains",
      organizationId: "org-a"
    });
    const item = await createMenuItem({
      eventTypeId: eventType.id,
      categoryId: category.id,
      name: "Ribs",
      price: 6.25,
      organizationId: "org-a"
    });

    await updateEventType(eventType.id, { name: "Updated Supper", organizationId: "org-a" });
    await updateCategory(category.id, { name: "Entrees", organizationId: "org-a" });
    await updateMenuItem(item.id, { name: "Smoked Ribs", price: 7.5, organizationId: "org-a" });

    await expect(getEventTypes({ organizationId: "org-a" })).resolves.toContainEqual(
      expect.objectContaining({ id: eventType.id, name: "Updated Supper" })
    );
    await expect(getMenuCategories(eventType.id, { organizationId: "org-a" })).resolves.toContainEqual(
      expect.objectContaining({ id: category.id, name: "Entrees" })
    );
    await expect(getMenuItems(eventType.id, { organizationId: "org-a" })).resolves.toContainEqual(
      expect.objectContaining({ id: item.id, name: "Smoked Ribs", price: 7.5 })
    );

    await deleteMenuItem(item.id, { organizationId: "org-a" });
    await expect(getMenuItems(eventType.id, { organizationId: "org-a" })).resolves.toEqual([]);
  });
});
