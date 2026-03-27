import { beforeEach, describe, expect, test, vi } from "vitest";

const mockState = vi.hoisted(() => ({
  db: { id: "mock-db" },
  addDoc: vi.fn(),
  collection: vi.fn(),
  deleteDoc: vi.fn(),
  doc: vi.fn(),
  getDoc: vi.fn(),
  getDocs: vi.fn(),
  orderBy: vi.fn(),
  query: vi.fn(),
  runTransaction: vi.fn(),
  serverTimestamp: vi.fn(),
  setDoc: vi.fn(),
  updateDoc: vi.fn(),
  where: vi.fn(),
  allowLegacyGlobalFallback: vi.fn(),
  getActiveOrganizationId: vi.fn(),
  getOrganizationCollectionRef: vi.fn(),
  getOrganizationSubDocRef: vi.fn(),
  normalizeOrganizationId: vi.fn()
}));

function normalizeLikeService(value) {
  return String(value || "")
    .trim()
    .toLowerCase()
    .replace(/[^\w-]+/g, "-")
    .replace(/-{2,}/g, "-")
    .replace(/^-|-$/g, "");
}

vi.mock("../firebase", () => ({
  db: mockState.db,
  firebaseReady: true
}));

vi.mock("firebase/firestore", () => ({
  addDoc: mockState.addDoc,
  collection: mockState.collection,
  deleteDoc: mockState.deleteDoc,
  doc: mockState.doc,
  getDoc: mockState.getDoc,
  getDocs: mockState.getDocs,
  orderBy: mockState.orderBy,
  query: mockState.query,
  runTransaction: mockState.runTransaction,
  serverTimestamp: mockState.serverTimestamp,
  setDoc: mockState.setDoc,
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

import { saveQuoteVersion, setQuoteStoreOrganizationId, submitQuote } from "../quoteStore";

describe("quoteStore Firebase write safety", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    setQuoteStoreOrganizationId("");
    mockState.allowLegacyGlobalFallback.mockReturnValue(true);
    mockState.getActiveOrganizationId.mockReturnValue("");
    mockState.normalizeOrganizationId.mockImplementation((value) => normalizeLikeService(value));
    mockState.getOrganizationCollectionRef.mockImplementation((name, orgId) => ({ refType: "org-collection", name, orgId }));
    mockState.getOrganizationSubDocRef.mockImplementation((name, docId, orgId) => ({ refType: "org-doc", name, docId, orgId }));
    mockState.collection.mockImplementation((...args) => ({ refType: "collection", args }));
    mockState.orderBy.mockImplementation((...args) => ({ refType: "orderBy", args }));
    mockState.query.mockImplementation((...args) => ({ refType: "query", args }));
    mockState.getDocs.mockResolvedValue({ docs: [] });
    mockState.setDoc.mockResolvedValue(undefined);
    mockState.runTransaction.mockImplementation(async (_db, handler) => {
      const tx = {
        get: vi.fn().mockResolvedValue({
          exists: () => true,
          data: () => ({ latestVersionNumber: 0 })
        }),
        set: vi.fn()
      };
      return handler(tx);
    });
    mockState.serverTimestamp.mockReturnValue({ ".sv": "timestamp" });
    mockState.addDoc.mockResolvedValue({ id: "quote-1" });
    mockState.doc.mockImplementation((...args) => ({ refType: "doc", args }));
  });

  test("submitQuote rejects Firebase writes when organization context is missing", async () => {
    await expect(
      submitQuote({
        form: {
          name: "Client",
          email: "client@example.com",
          eventName: "Event",
          date: "2026-05-01",
          time: "18:00",
          venue: "Venue",
          guests: 50,
          hours: 4,
          addons: [],
          rentals: [],
          menuItems: [],
          addonQuantities: {},
          rentalQuantities: {},
          menuItemQuantities: {},
          eventTypeId: "wedding"
        },
        totals: {
          selectedPkg: { id: "classic", name: "Classic" },
          total: 1000,
          deposit: 300
        },
        catalogSource: "firebase",
        settings: {
          quoteValidityDays: 30
        }
      })
    ).rejects.toThrow(/organizationId is required for submitQuote/i);

    expect(mockState.getOrganizationCollectionRef).not.toHaveBeenCalled();
    expect(mockState.addDoc).not.toHaveBeenCalled();
  });

  test("saveQuoteVersion preserves legacy global read compatibility but blocks Firebase write without org", async () => {
    const createdAtISO = "2026-03-27T12:00:00.000Z";
    mockState.getDoc.mockResolvedValue({
      exists: () => true,
      data: () => ({
        quoteNumber: "Q-1",
        status: "draft",
        createdAtISO,
        updatedAtISO: createdAtISO,
        ownerUid: "staff-1",
        ownerEmail: "staff@example.com",
        customer: { name: "Client", email: "client@example.com" },
        event: { name: "Event", date: "2026-05-01", venue: "Venue", guests: 50, hours: 4 },
        selection: { menuItems: [] },
        totals: { total: 1000, deposit: 300 },
        payment: { depositStatus: "unpaid" },
        booking: { confirmationStatus: "pending" },
        lifecycle: { draftAtISO: createdAtISO }
      })
    });

    await expect(saveQuoteVersion("legacy-global-quote")).rejects.toThrow(/organizationId is required for saveQuoteVersion/i);

    expect(mockState.doc).toHaveBeenCalledWith(mockState.db, "quotes", "legacy-global-quote");
    expect(mockState.runTransaction).not.toHaveBeenCalled();
  });

  test("saveQuoteVersion auto-migrates legacy global quote into scoped org path when active org is available", async () => {
    mockState.getActiveOrganizationId.mockReturnValue("Org One");
    const createdAtISO = "2026-03-27T12:00:00.000Z";
    const legacyPayload = {
      quoteNumber: "Q-1",
      status: "draft",
      createdAtISO,
      updatedAtISO: createdAtISO,
      ownerUid: "staff-1",
      ownerEmail: "staff@example.com",
      customer: { name: "Client", email: "client@example.com" },
      event: { name: "Event", date: "2026-05-01", venue: "Venue", guests: 50, hours: 4 },
      selection: { menuItems: [] },
      totals: { total: 1000, deposit: 300 },
      payment: { depositStatus: "unpaid" },
      booking: { confirmationStatus: "pending" },
      lifecycle: { draftAtISO: createdAtISO }
    };

    mockState.getDoc
      .mockResolvedValueOnce({ exists: () => false, data: () => ({}) })
      .mockResolvedValueOnce({ exists: () => true, data: () => legacyPayload })
      .mockResolvedValueOnce({ exists: () => false, data: () => ({}) })
      .mockResolvedValueOnce({ exists: () => true, data: () => legacyPayload });

    await expect(saveQuoteVersion("legacy-global-quote")).resolves.toMatchObject({
      ok: true,
      storage: "firebase",
      versionNumber: 1
    });

    expect(mockState.getOrganizationSubDocRef).toHaveBeenCalledWith("quotes", "legacy-global-quote", "org-one");
    expect(mockState.setDoc).toHaveBeenCalledWith(
      { refType: "org-doc", name: "quotes", docId: "legacy-global-quote", orgId: "org-one" },
      expect.objectContaining({
        organizationId: "org-one",
        quoteNumber: "Q-1"
      }),
      { merge: true }
    );
  });
});
