import { beforeEach, describe, expect, test, vi } from "vitest";

const mockState = vi.hoisted(() => ({
  db: { id: "mock-db" },
  addDoc: vi.fn(),
  collection: vi.fn(),
  deleteDoc: vi.fn(),
  doc: vi.fn(),
  getDocs: vi.fn(),
  query: vi.fn(),
  updateDoc: vi.fn(),
  writeBatch: vi.fn(),
  where: vi.fn(),
  getActiveOrganizationId: vi.fn(),
  getOrganizationCollectionRef: vi.fn(),
  getOrganizationSubDocRef: vi.fn(),
  normalizeOrganizationId: vi.fn()
}));

vi.mock("../firebase", () => ({
  db: mockState.db,
  firebaseReady: true
}));

vi.mock("firebase/firestore", () => ({
  addDoc: mockState.addDoc,
  collection: mockState.collection,
  deleteDoc: mockState.deleteDoc,
  doc: mockState.doc,
  getDocs: mockState.getDocs,
  query: mockState.query,
  updateDoc: mockState.updateDoc,
  writeBatch: mockState.writeBatch,
  where: mockState.where
}));

vi.mock("../organizationService", () => ({
  getActiveOrganizationId: mockState.getActiveOrganizationId,
  getOrganizationCollectionRef: mockState.getOrganizationCollectionRef,
  getOrganizationSubDocRef: mockState.getOrganizationSubDocRef,
  normalizeOrganizationId: mockState.normalizeOrganizationId
}));

import { createEventType, createMenuItem, getEventTypes } from "../menuService";

function normalizeLikeService(value) {
  return String(value || "")
    .trim()
    .toLowerCase()
    .replace(/[^\w-]+/g, "-")
    .replace(/-{2,}/g, "-")
    .replace(/^-|-$/g, "");
}

describe("menuService write fallback behavior", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockState.getActiveOrganizationId.mockReturnValue("");
    mockState.normalizeOrganizationId.mockImplementation((value) => normalizeLikeService(value));
    mockState.collection.mockImplementation((...args) => ({ refType: "legacy", args }));
    mockState.getOrganizationCollectionRef.mockImplementation((name, orgId) => ({ refType: "scoped", name, orgId }));
    mockState.doc.mockImplementation((collectionRef, id) => ({
      refType: "doc",
      collectionRef,
      id: id || "event-type-seeded"
    }));
    mockState.addDoc.mockResolvedValue({ id: "menu-item-1" });
    mockState.writeBatch.mockReturnValue({
      set: vi.fn(),
      delete: vi.fn(),
      commit: vi.fn().mockResolvedValue(undefined)
    });
  });

  test("createMenuItem throws when org context is missing, even if legacy fallback is enabled", async () => {
    await expect(
      createMenuItem({
        eventTypeId: "wedding",
        categoryId: "mains",
        name: "Smoked Ribs",
        price: 6
      })
    ).rejects.toThrow(/organizationId is required for createMenuItem/i);

    expect(mockState.collection).not.toHaveBeenCalledWith(mockState.db, "menuItems");
    expect(mockState.getOrganizationCollectionRef).not.toHaveBeenCalled();
    expect(mockState.addDoc).not.toHaveBeenCalled();
  });

  test("createMenuItem uses scoped org collection when organizationId is provided", async () => {
    await createMenuItem({
      eventTypeId: "wedding",
      categoryId: "mains",
      name: "Smoked Ribs",
      price: 6,
      organizationId: "Org 123"
    });

    expect(mockState.getOrganizationCollectionRef).toHaveBeenCalledWith("menuItems", "org-123");
    expect(mockState.collection).not.toHaveBeenCalledWith(mockState.db, "menuItems");
  });

  test("createMenuItem uses scoped active org collection when explicit organizationId is omitted", async () => {
    mockState.getActiveOrganizationId.mockReturnValue("Active Org");

    await createMenuItem({
      eventTypeId: "wedding",
      categoryId: "mains",
      name: "Smoked Ribs",
      price: 6
    });

    expect(mockState.getOrganizationCollectionRef).toHaveBeenCalledWith("menuItems", "active-org");
    expect(mockState.collection).not.toHaveBeenCalledWith(mockState.db, "menuItems");
  });

  test("getEventTypes throws when org context is missing in firebase mode", async () => {
    await expect(getEventTypes()).rejects.toThrow(/organizationId is required for getEventTypes/i);
  });

  test("createMenuItem throws when org context is missing", async () => {
    await expect(
      createMenuItem({
        eventTypeId: "wedding",
        categoryId: "mains",
        name: "Smoked Ribs"
      })
    ).rejects.toThrow(/organizationId is required for createMenuItem/i);
  });

  test("createEventType starts blank unless canonical seeding is explicitly requested", async () => {
    const batch = {
      set: vi.fn(),
      delete: vi.fn(),
      commit: vi.fn().mockResolvedValue(undefined)
    };
    mockState.writeBatch.mockReturnValue(batch);

    const created = await createEventType({
      name: "New Event Type",
      organizationId: "Org 123"
    });

    expect(created.id).toBe("event-type-seeded");
    expect(created.seeded).toEqual({
      categories: 0,
      items: 0
    });
    expect(batch.set).toHaveBeenCalledTimes(1);
    expect(batch.commit).toHaveBeenCalledTimes(1);
  });

  test("createEventType can seed the canonical menu only through an explicit opt-in", async () => {
    const batch = {
      set: vi.fn(),
      delete: vi.fn(),
      commit: vi.fn().mockResolvedValue(undefined)
    };
    mockState.writeBatch.mockReturnValue(batch);

    const created = await createEventType({
      name: "New Event Type",
      organizationId: "Org 123",
      seedCanonical: true
    });

    expect(created.seeded).toEqual({
      categories: 10,
      items: 93
    });
    expect(batch.set).toHaveBeenCalledTimes(104);
    expect(batch.commit).toHaveBeenCalledTimes(1);
  });
});
