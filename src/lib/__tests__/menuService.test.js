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
import { setActiveOrganizationId } from "../organizationService";

describe("menuService fallback behavior", () => {
  beforeEach(() => {
    setActiveOrganizationId("");
    const values = new Map();
    vi.stubGlobal("localStorage", {
      getItem: vi.fn((key) => values.get(key) || null),
      setItem: vi.fn((key, value) => values.set(key, String(value))),
      removeItem: vi.fn((key) => values.delete(key)),
      clear: vi.fn(() => values.clear())
    });
  });

  test("keeps local catalog revision updates inside the active organization key", async () => {
    await createEventType({
      name: "Organization A dinner",
      organizationId: "org-a",
      expectedCatalogRevision: 0
    });

    expect(localStorage.getItem("quoteWizard.catalog.org-a")).toContain('"catalogRevision":1');
    expect(localStorage.getItem("quoteWizard.catalog.org-b")).toBeNull();
    expect(localStorage.getItem("quoteWizard.catalog")).toBeNull();
  });

  test("keeps the no-organization device fallback isolated from a tenant named local", async () => {
    const deviceEvent = await createEventType({
      name: "Device-only dinner",
      expectedCatalogRevision: 0
    });
    const tenantEvent = await createEventType({
      name: "Local tenant dinner",
      organizationId: "local",
      expectedCatalogRevision: 0
    });

    await expect(getEventTypes()).resolves.toContainEqual(
      expect.objectContaining({ id: deviceEvent.id, name: "Device-only dinner" })
    );
    await expect(getEventTypes()).resolves.not.toContainEqual(
      expect.objectContaining({ id: tenantEvent.id })
    );
    await expect(getEventTypes({ organizationId: "local" })).resolves.toContainEqual(
      expect.objectContaining({ id: tenantEvent.id, name: "Local tenant dinner" })
    );
    await expect(getEventTypes({ organizationId: "local" })).resolves.not.toContainEqual(
      expect.objectContaining({ id: deviceEvent.id })
    );

    expect(localStorage.getItem("quoteWizard.menuCatalog::device")).toContain(deviceEvent.id);
    expect(localStorage.getItem("quoteWizard.menuCatalog.local")).toContain(tenantEvent.id);
    expect(localStorage.getItem("quoteWizard.catalog::device")).toContain('"catalogRevision":1');
    expect(localStorage.getItem("quoteWizard.catalog.local")).toContain('"catalogRevision":1');
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
    const eventType = await createEventType({
      name: "Community Supper",
      organizationId: "org-a",
      expectedCatalogRevision: 0
    });
    const category = await createCategory({
      eventTypeId: eventType.id,
      name: "Mains",
      organizationId: "org-a",
      expectedCatalogRevision: 1
    });
    const item = await createMenuItem({
      eventTypeId: eventType.id,
      categoryId: category.id,
      name: "Ribs",
      price: 6.25,
      organizationId: "org-a",
      expectedCatalogRevision: 2
    });

    await updateEventType(eventType.id, {
      name: "Updated Supper",
      organizationId: "org-a",
      expectedCatalogRevision: 3
    });
    await updateCategory(category.id, {
      name: "Entrees",
      organizationId: "org-a",
      expectedCatalogRevision: 4
    });
    await updateMenuItem(item.id, {
      name: "Smoked Ribs",
      price: 7.5,
      organizationId: "org-a",
      expectedCatalogRevision: 5
    });

    await expect(getEventTypes({ organizationId: "org-a" })).resolves.toContainEqual(
      expect.objectContaining({ id: eventType.id, name: "Updated Supper" })
    );
    await expect(getMenuCategories(eventType.id, { organizationId: "org-a" })).resolves.toContainEqual(
      expect.objectContaining({ id: category.id, name: "Entrees" })
    );
    await expect(getMenuItems(eventType.id, { organizationId: "org-a" })).resolves.toContainEqual(
      expect.objectContaining({ id: item.id, name: "Smoked Ribs", price: 7.5 })
    );

    await deleteMenuItem(item.id, { organizationId: "org-a", expectedCatalogRevision: 6 });
    await expect(getMenuItems(eventType.id, { organizationId: "org-a" })).resolves.toEqual([]);
  });

  test("rejects a stale local menu mutation without changing the stored revision", async () => {
    await createEventType({
      name: "Current event",
      organizationId: "org-a",
      expectedCatalogRevision: 0
    });

    await expect(createEventType({
      name: "Stale event",
      organizationId: "org-a",
      expectedCatalogRevision: 0
    })).rejects.toMatchObject({ code: "aborted" });

    expect(localStorage.getItem("quoteWizard.catalog.org-a")).toContain('"catalogRevision":1');
  });
});
