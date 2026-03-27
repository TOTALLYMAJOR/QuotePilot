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
  where: vi.fn(),
  allowLegacyGlobalFallback: vi.fn(),
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
  where: mockState.where
}));

vi.mock("../organizationService", () => ({
  allowLegacyGlobalFallback: mockState.allowLegacyGlobalFallback,
  getActiveOrganizationId: mockState.getActiveOrganizationId,
  getOrganizationCollectionRef: mockState.getOrganizationCollectionRef,
  getOrganizationSubDocRef: mockState.getOrganizationSubDocRef,
  normalizeOrganizationId: mockState.normalizeOrganizationId
}));

import { createMenuItem } from "../menuService";

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
    mockState.allowLegacyGlobalFallback.mockReturnValue(true);
    mockState.getActiveOrganizationId.mockReturnValue("");
    mockState.normalizeOrganizationId.mockImplementation((value) => normalizeLikeService(value));
    mockState.collection.mockImplementation((...args) => ({ refType: "legacy", args }));
    mockState.getOrganizationCollectionRef.mockImplementation((name, orgId) => ({ refType: "scoped", name, orgId }));
    mockState.addDoc.mockResolvedValue({ id: "menu-item-1" });
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

  test("createMenuItem throws when org context is missing and legacy fallback is disabled", async () => {
    mockState.allowLegacyGlobalFallback.mockReturnValue(false);

    await expect(
      createMenuItem({
        eventTypeId: "wedding",
        categoryId: "mains",
        name: "Smoked Ribs"
      })
    ).rejects.toThrow(/organizationId is required for createMenuItem/i);
  });
});
