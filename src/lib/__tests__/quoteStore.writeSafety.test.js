import { beforeEach, describe, expect, test, vi } from "vitest";

const mockState = vi.hoisted(() => ({
  auth: {
    currentUser: {
      uid: "current-admin",
      email: "current.admin@example.com"
    }
  },
  db: { id: "mock-db" },
  cloudFunctions: { id: "mock-functions" },
  httpsCallable: vi.fn(),
  addDoc: vi.fn(),
  collection: vi.fn(),
  deleteDoc: vi.fn(),
  doc: vi.fn(),
  getDoc: vi.fn(),
  getDocs: vi.fn(),
  orderBy: vi.fn(),
  query: vi.fn(),
  runTransaction: vi.fn(),
  transactionSet: vi.fn(),
  transactionUpdate: vi.fn(),
  serverTimestamp: vi.fn(),
  setDoc: vi.fn(),
  updateDoc: vi.fn(),
  writeBatch: vi.fn(),
  where: vi.fn(),
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
  auth: mockState.auth,
  cloudFunctions: mockState.cloudFunctions,
  db: mockState.db,
  firebaseReady: true
}));

vi.mock("firebase/functions", () => ({
  httpsCallable: mockState.httpsCallable
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
  writeBatch: mockState.writeBatch,
  where: mockState.where
}));

vi.mock("../organizationService", () => ({
  getActiveOrganizationId: mockState.getActiveOrganizationId,
  getOrganizationCollectionRef: mockState.getOrganizationCollectionRef,
  getOrganizationSubDocRef: mockState.getOrganizationSubDocRef,
  normalizeOrganizationId: mockState.normalizeOrganizationId
}));

import {
  buildClientWritablePortalPayment,
  convertQuoteToContract,
  getQuoteHistory,
  getWorkflowAttentionSnapshot,
  requestQuoteApproval,
  reopenQuote,
  resolveQuoteApprovalRequest,
  rotateQuotePortalKey,
  saveQuoteVersion,
  setQuoteStoreOrganizationId,
  submitQuote,
  syncQuoteToCrm,
  updateQuote,
  updateQuoteChangeRequestHandling,
  updateQuoteStatus,
  updatePortalDecision
} from "../quoteStore";

describe("quoteStore Firebase write safety", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    setQuoteStoreOrganizationId("");
    mockState.getActiveOrganizationId.mockReturnValue("");
    mockState.auth.currentUser = {
      uid: "current-admin",
      email: "current.admin@example.com"
    };
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
        set: mockState.transactionSet,
        update: mockState.transactionUpdate
      };
      return handler(tx);
    });
    mockState.serverTimestamp.mockReturnValue({ ".sv": "timestamp" });
    mockState.addDoc.mockResolvedValue({ id: "quote-1" });
    mockState.doc.mockImplementation((...args) => ({ refType: "doc", args }));
    mockState.httpsCallable.mockImplementation((_functions, name) => {
      if (name === "acceptQuoteProposal") {
        return vi.fn().mockResolvedValue({
          data: {
            ok: true,
            organizationId: "org-one",
            quoteId: "quote-1",
            storage: "firebase",
            status: "accepted",
            portalDecision: {
              decision: "accepted",
              message: "",
              requestId: "acceptance-12345678-1234-1234-1234-123456789012",
              submittedAtISO: "2026-08-06T14:30:00.000Z"
            },
            acceptanceReceipt: {
              receiptId: "acceptance-12345678-1234-1234-1234-123456789012",
              signerName: "Jordan Client",
              quoteRevisionId: "v0003@2026-08-05T18:00:00.000Z"
            }
          }
        });
      }
      if (name === "createQuoteDraft") {
        return vi.fn().mockResolvedValue({
          data: {
            ok: true,
            organizationId: "org-one",
            storage: "firebase",
            id: "trusted-quote-1",
            quoteNumber: "Q-260727-1200-ABCDEF12",
            portalKey: "0123456789abcdef0123456789abcdef",
            portalIssuedAtISO: "2026-07-27T12:00:00.000Z",
            portalExpiresAtISO: "2026-08-26T12:00:00.000Z",
            activeVersionId: "v0001",
            latestVersionNumber: 1
          }
        });
      }
      if (name === "rotateQuotePortalKey") {
        return vi.fn().mockResolvedValue({
          data: {
            ok: true,
            organizationId: "org-one",
            quoteId: "quote-1",
            storage: "firebase",
            portalKey: "fedcba9876543210fedcba9876543210",
            portalIssuedAtISO: "2026-07-28T12:00:00.000Z",
            portalExpiresAtISO: "2026-08-27T12:00:00.000Z",
            versionId: "v0002",
            versionNumber: 2,
            approvalRequest: {
              id: "rotate-approval-request-000001",
              action: "rotate_portal_link",
              state: "approved",
              resolvedAtISO: "2026-07-28T11:55:00.000Z",
              resolvedByEmail: "current.admin@example.com",
              executionState: "succeeded",
              executionStartedAtISO: "2026-07-28T12:00:00.000Z",
              executionCompletedAtISO: "2026-07-28T12:00:00.000Z",
              executedByEmail: "current.admin@example.com",
              executionOperationId: "rotate-approval-request-000001",
              executionReference: "v0002"
            }
          }
        });
      }
      if (name === "convertQuoteToContract") {
        return vi.fn().mockResolvedValue({
          data: {
            ok: true,
            organizationId: "org-one",
            quoteId: "quote-1",
            storage: "firebase",
            status: "booked",
            contractNumber: "C-260803-12345",
            booking: {
              contractNumber: "C-260803-12345",
              contractConvertedByEmail: "current.admin@example.com"
            },
            lifecycle: { bookedAtISO: "2026-08-03T18:00:00.000Z" },
            availability: {
              conflicts: [],
              hasBlockingConflict: false,
              capacityExceeded: false,
              capacityLimit: 400,
              sameVenueLoad: 120
            },
            versionId: "v0002",
            versionNumber: 2,
            approvalRequest: {
              id: "contract-approval-request-0001",
              action: "convert_to_contract",
              state: "approved",
              executionState: "succeeded",
              executionStartedAtISO: "2026-08-03T18:00:00.000Z",
              executionCompletedAtISO: "2026-08-03T18:00:00.000Z",
              executedByEmail: "current.admin@example.com",
              executionOperationId: "contract-approval-request-0001",
              executionReference: "C-260803-12345"
            }
          }
        });
      }
      if (name === "reopenQuote") {
        return vi.fn().mockResolvedValue({
          data: {
            ok: true,
            organizationId: "org-one",
            quoteId: "quote-1",
            storage: "firebase",
            status: "draft",
            portalKey: "abcdef0123456789abcdef0123456789",
            portalIssuedAtISO: "2026-07-28T12:00:00.000Z",
            portalExpiresAtISO: "2026-08-27T12:00:00.000Z",
            expiresAtISO: "2026-09-11T12:00:00.000Z",
            versionId: "v0002",
            versionNumber: 2
          }
        });
      }
      if (name === "requestQuoteApproval") {
        return vi.fn().mockResolvedValue({
          data: {
            ok: true,
            organizationId: "org-one",
            quoteId: "quote-1",
            request: {
              id: "0123456789abcdef0123456789abcdef",
              action: "delete_quote",
              state: "pending",
              note: "Remove duplicate quote.",
              requestedAtISO: "2026-08-03T18:00:00.000Z",
              requestedByEmail: "current.admin@example.com",
              resolvedAtISO: "",
              resolvedByEmail: "",
              resolutionNote: ""
            }
          }
        });
      }
      if (name === "resolveQuoteApprovalRequest") {
        return vi.fn().mockResolvedValue({
          data: {
            ok: true,
            organizationId: "org-one",
            quoteId: "quote-1",
            request: {
              id: "0123456789abcdef0123456789abcdef",
              action: "delete_quote",
              state: "approved",
              note: "Remove duplicate quote.",
              requestedAtISO: "2026-08-03T18:00:00.000Z",
              requestedByEmail: "sales@example.com",
              resolvedAtISO: "2026-08-03T18:05:00.000Z",
              resolvedByEmail: "current.admin@example.com",
              resolutionNote: "Approved for separate execution."
            }
          }
        });
      }
      if (name === "updateQuoteDraft") {
        return vi.fn().mockResolvedValue({
          data: {
            ok: true,
            organizationId: "org-one",
            quoteId: "quote-1",
            quoteNumber: "Q-260727-1200-EDIT0001",
            storage: "firebase",
            status: "draft",
            portalKey: "0123456789abcdef0123456789abcdef",
            portalIssuedAtISO: "2026-07-29T12:00:00.000Z",
            portalExpiresAtISO: "2026-08-28T12:00:00.000Z",
            expiresAtISO: "2026-09-27T12:00:00.000Z",
            activeVersionId: "v0002",
            latestVersionNumber: 2,
            versionId: "v0002",
            versionNumber: 2
          }
        });
      }
      throw new Error(`Unexpected callable: ${name}`);
    });
  });

  test("portal sync payloads omit all server-owned payment evidence", () => {
    expect(buildClientWritablePortalPayment({
      depositLink: "https://checkout.stripe.com/c/pay/cs_test_server",
      stripeSessionId: "cs_test_server",
      lastCheckoutCreatedAtISO: "2026-07-27T12:00:00.000Z",
      lastHost: "quotepilot.mbmapps.com",
      lastEventType: "checkout.session.created",
      lastOrganizationId: "org-one",
      checkoutGeneration: 2,
      depositStatus: "sent",
      depositConfirmedAtISO: ""
    })).toEqual({});
  });

  test("CRM provider sends cannot execute from the browser", async () => {
    const originalFetch = globalThis.fetch;
    const fetchSpy = vi.fn();
    globalThis.fetch = fetchSpy;
    try {
      await expect(syncQuoteToCrm({
        quoteId: "quote-1",
        provider: "webhook",
        actorEmail: "sales@example.com"
      })).rejects.toThrow(/direct browser CRM sends are disabled/i);
      expect(fetchSpy).not.toHaveBeenCalled();
      expect(mockState.getDoc).not.toHaveBeenCalled();
      expect(mockState.updateDoc).not.toHaveBeenCalled();
    } finally {
      globalThis.fetch = originalFetch;
    }
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

  test("submitQuote delegates Firebase creation without sending client totals or pricing proof", async () => {
    const result = await submitQuote({
      form: {
        name: "Client",
        email: "client@example.com",
        eventName: "Event",
        date: "2026-09-12",
        time: "18:00",
        venue: "Venue",
        guests: 50,
        hours: 4,
        pkg: "classic",
        addons: [],
        rentals: [],
        menuItems: [],
        addonQuantities: {},
        rentalQuantities: {},
        menuItemQuantities: {},
        eventTypeId: "dinner"
      },
      totals: {
        selectedPkg: { id: "classic", name: "Forged Name" },
        total: 1,
        deposit: 1
      },
      pricingSnapshot: {
        authority: "server_authoritative",
        grandTotal: 1
      },
      catalogSource: "firebase-org",
      settings: {
        quoteValidityDays: 30
      },
      organizationId: "Org One"
    });

    expect(result).toMatchObject({
      id: "trusted-quote-1",
      quoteNumber: "Q-260727-1200-ABCDEF12",
      portalKey: "0123456789abcdef0123456789abcdef",
      storage: "firebase",
      activeVersionId: "v0001",
      latestVersionNumber: 1
    });
    expect(mockState.httpsCallable).toHaveBeenCalledWith(
      mockState.cloudFunctions,
      "createQuoteDraft"
    );
    const callable = mockState.httpsCallable.mock.results[0].value;
    expect(callable).toHaveBeenCalledWith({
      organizationId: "org-one",
      form: expect.objectContaining({
        name: "Client",
        pkg: "classic"
      })
    });
    expect(callable.mock.calls[0][0]).not.toHaveProperty("totals");
    expect(callable.mock.calls[0][0]).not.toHaveProperty("pricingSnapshot");
    expect(mockState.addDoc).not.toHaveBeenCalled();
    expect(mockState.setDoc).not.toHaveBeenCalled();
    expect(mockState.runTransaction).not.toHaveBeenCalled();
  });

  test("updateQuote delegates only quote identity and presentation to the trusted edit callable", async () => {
    const result = await updateQuote({
      quoteId: "quote-1",
      organizationId: "Org One",
      form: {
        name: "Updated Client",
        email: "client@example.com",
        eventName: "Updated Event",
        date: "2026-09-12",
        time: "18:00",
        venue: "Venue",
        guests: 75,
        hours: 4,
        pkg: "classic",
        addons: [],
        rentals: [],
        menuItems: []
      },
      totals: {
        selectedPkg: {
          id: "classic",
          name: "Forged Package"
        },
        total: 1,
        deposit: 1
      },
      pricingSnapshot: {
        authority: "server_authoritative",
        grandTotal: 1
      },
      settings: {
        brandName: "Forged Brand",
        crmBridgeAuthToken: "forged-secret"
      },
      catalog: {
        packages: [{
          id: "classic",
          name: "Forged Package",
          ppp: 0.01
        }]
      },
      ownerUid: "forged-owner",
      ownerEmail: "forged-owner@example.com"
    });

    expect(result).toMatchObject({
      id: "quote-1",
      quoteNumber: "Q-260727-1200-EDIT0001",
      status: "draft",
      storage: "firebase",
      activeVersionId: "v0002",
      latestVersionNumber: 2
    });
    expect(mockState.httpsCallable).toHaveBeenCalledWith(
      mockState.cloudFunctions,
      "updateQuoteDraft"
    );
    const callable = mockState.httpsCallable.mock.results[0].value;
    expect(callable).toHaveBeenCalledWith({
      organizationId: "org-one",
      quoteId: "quote-1",
      form: expect.objectContaining({
        name: "Updated Client",
        pkg: "classic"
      })
    });
    const payload = callable.mock.calls[0][0];
    expect(payload).not.toHaveProperty("totals");
    expect(payload).not.toHaveProperty("pricingSnapshot");
    expect(payload).not.toHaveProperty("settings");
    expect(payload).not.toHaveProperty("catalog");
    expect(payload).not.toHaveProperty("ownerUid");
    expect(payload).not.toHaveProperty("ownerEmail");
    expect(mockState.getDoc).not.toHaveBeenCalled();
    expect(mockState.updateDoc).not.toHaveBeenCalled();
    expect(mockState.setDoc).not.toHaveBeenCalled();
    expect(mockState.runTransaction).not.toHaveBeenCalled();
  });

  test("saveQuoteVersion blocks Firebase read/write without org context", async () => {
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

    await expect(saveQuoteVersion("legacy-global-quote")).rejects.toThrow(/organizationId is required for quote read/i);

    expect(mockState.doc).not.toHaveBeenCalledWith(mockState.db, "quotes", "legacy-global-quote");
    expect(mockState.runTransaction).not.toHaveBeenCalled();
  });

  test("saveQuoteVersion binds immutable version authorship to the authenticated actor", async () => {
    mockState.getActiveOrganizationId.mockReturnValue("Org One");
    mockState.getDoc.mockResolvedValue({
      exists: () => true,
      data: () => ({
        quoteNumber: "Q-1",
        organizationId: "org-one",
        status: "draft",
        createdAtISO: "2026-03-27T12:00:00.000Z",
        updatedAtISO: "2026-03-27T12:00:00.000Z",
        ownerUid: "original-owner",
        ownerEmail: "original.owner@example.com",
        customer: { name: "Client", email: "client@example.com" },
        event: { name: "Event", date: "2026-05-01", venue: "Venue", guests: 50, hours: 4 },
        selection: { menuItems: [] },
        totals: { total: 1000, deposit: 300 },
        pricing: { authority: "server_authoritative", grandTotal: 1000 },
        payment: { depositStatus: "unpaid" },
        booking: { confirmationStatus: "pending" },
        lifecycle: { draftAtISO: "2026-03-27T12:00:00.000Z" }
      })
    });

    await expect(saveQuoteVersion("quote-1")).resolves.toMatchObject({
      ok: true,
      storage: "firebase",
      versionId: "v0001",
      versionNumber: 1
    });

    const versionPayload = mockState.transactionSet.mock.calls[0][1];
    expect(versionPayload.createdBy).toEqual({
      uid: "current-admin",
      email: "current.admin@example.com",
      role: ""
    });
    expect(versionPayload.snapshot.ownerUid).toBe("original-owner");
    expect(versionPayload.snapshot.ownerEmail).toBe("original.owner@example.com");
  });

  test("portal rotation delegates identity and timestamps to the admin-only callable", async () => {
    mockState.getActiveOrganizationId.mockReturnValue("Org One");
    mockState.getDoc.mockResolvedValue({
      exists: () => true,
      data: () => ({
        quoteNumber: "Q-1",
        status: "sent",
        createdAtISO: "2026-07-27T12:00:00.000Z",
        updatedAtISO: "2026-07-27T13:00:00.000Z",
        expiresAtISO: "2026-09-10T12:00:00.000Z",
        portalKey: "0123456789abcdef0123456789abcdef",
        portalIssuedAtISO: "2026-07-27T12:00:00.000Z",
        portalExpiresAtISO: "2026-08-26T12:00:00.000Z",
        organizationId: "org-one",
        ownerUid: "admin-one",
        ownerEmail: "admin@example.com",
        customer: { name: "Client", email: "client@example.com" },
        event: { name: "Event", date: "2026-09-01" },
        selection: { packageId: "classic" },
        totals: { total: 1000, deposit: 300 },
        pricing: { authority: "server_authoritative", grandTotal: 1000 },
        payment: { depositStatus: "unpaid" },
        booking: { confirmationStatus: "pending" },
        lifecycle: { sentAtISO: "2026-07-27T13:00:00.000Z" }
      })
    });

    const result = await rotateQuotePortalKey({
      quoteId: "quote-1",
      actorEmail: "forged@example.com",
      approvalRequestId: "rotate-approval-request-000001"
    });

    expect(result).toMatchObject({
      ok: true,
      storage: "firebase",
      portalKey: "fedcba9876543210fedcba9876543210",
      portalIssuedAtISO: "2026-07-28T12:00:00.000Z",
      portalExpiresAtISO: "2026-08-27T12:00:00.000Z",
      versionId: "v0002",
      versionNumber: 2
    });
    const callable = mockState.httpsCallable.mock.results[0].value;
    expect(mockState.httpsCallable).toHaveBeenCalledWith(
      mockState.cloudFunctions,
      "rotateQuotePortalKey"
    );
    expect(callable).toHaveBeenCalledWith({
      organizationId: "org-one",
      quoteId: "quote-1",
      approvalRequestId: "rotate-approval-request-000001"
    });
    expect(callable.mock.calls[0][0]).not.toHaveProperty("actorEmail");
    expect(callable.mock.calls[0][0]).not.toHaveProperty("portalKey");
    expect(callable.mock.calls[0][0]).not.toHaveProperty("portalIssuedAtISO");
    expect(mockState.updateDoc).not.toHaveBeenCalled();
    expect(mockState.setDoc).not.toHaveBeenCalled();
    expect(mockState.deleteDoc).not.toHaveBeenCalled();
    expect(mockState.runTransaction).not.toHaveBeenCalled();
  });

  test("contract conversion requires and consumes a server-approved action", async () => {
    mockState.getActiveOrganizationId.mockReturnValue("Org One");

    const result = await convertQuoteToContract({
      quoteId: "quote-1",
      actorEmail: "forged@example.com",
      capacityLimit: 999999,
      approvalRequestId: "contract-approval-request-0001"
    });

    expect(result).toMatchObject({
      ok: true,
      storage: "firebase",
      status: "booked",
      contractNumber: "C-260803-12345",
      approvalRequest: {
        id: "contract-approval-request-0001",
        action: "convert_to_contract",
        executionState: "succeeded"
      }
    });
    const callable = mockState.httpsCallable.mock.results[0].value;
    expect(mockState.httpsCallable).toHaveBeenCalledWith(
      mockState.cloudFunctions,
      "convertQuoteToContract"
    );
    expect(callable).toHaveBeenCalledWith({
      organizationId: "org-one",
      quoteId: "quote-1",
      approvalRequestId: "contract-approval-request-0001"
    });
    expect(callable.mock.calls[0][0]).not.toHaveProperty("actorEmail");
    expect(callable.mock.calls[0][0]).not.toHaveProperty("capacityLimit");
    expect(mockState.getDoc).not.toHaveBeenCalled();
    expect(mockState.updateDoc).not.toHaveBeenCalled();
    expect(mockState.setDoc).not.toHaveBeenCalled();
    expect(mockState.runTransaction).not.toHaveBeenCalled();
  });

  test("quote reopen delegates eligibility, portal identity, timestamps, and audit version to the admin-only callable", async () => {
    mockState.getActiveOrganizationId.mockReturnValue("Org One");
    mockState.getDoc.mockResolvedValue({
      exists: () => true,
      data: () => ({
        quoteNumber: "Q-1",
        status: "expired",
        createdAtISO: "2026-07-01T12:00:00.000Z",
        updatedAtISO: "2026-07-27T13:00:00.000Z",
        expiresAtISO: "2026-07-20T12:00:00.000Z",
        portalKey: "0123456789abcdef0123456789abcdef",
        portalIssuedAtISO: "2026-07-01T12:00:00.000Z",
        portalExpiresAtISO: "2026-07-20T12:00:00.000Z",
        organizationId: "org-one",
        ownerUid: "admin-one",
        ownerEmail: "admin@example.com",
        customer: { name: "Client", email: "client@example.com" },
        event: { name: "Event", date: "2026-09-01" },
        selection: { packageId: "classic" },
        totals: { total: 1000, deposit: 300 },
        pricing: { authority: "server_authoritative", grandTotal: 1000 },
        payment: { depositStatus: "unpaid" },
        booking: { confirmationStatus: "pending" },
        lifecycle: { expiredAtISO: "2026-07-20T12:00:00.000Z" }
      })
    });

    const result = await reopenQuote("quote-1");

    expect(result).toMatchObject({
      ok: true,
      storage: "firebase",
      status: "draft",
      portalKey: "abcdef0123456789abcdef0123456789",
      portalIssuedAtISO: "2026-07-28T12:00:00.000Z",
      portalExpiresAtISO: "2026-08-27T12:00:00.000Z",
      expiresAtISO: "2026-09-11T12:00:00.000Z",
      versionId: "v0002",
      versionNumber: 2
    });
    expect(mockState.httpsCallable).toHaveBeenCalledWith(
      mockState.cloudFunctions,
      "reopenQuote"
    );
    const callable = mockState.httpsCallable.mock.results[0].value;
    expect(callable).toHaveBeenCalledWith({
      organizationId: "org-one",
      quoteId: "quote-1"
    });
    expect(callable.mock.calls[0][0]).not.toHaveProperty("status");
    expect(callable.mock.calls[0][0]).not.toHaveProperty("portalKey");
    expect(callable.mock.calls[0][0]).not.toHaveProperty("portalIssuedAtISO");
    expect(callable.mock.calls[0][0]).not.toHaveProperty("activeSnapshot");
    expect(mockState.getDocs).not.toHaveBeenCalled();
    expect(mockState.updateDoc).not.toHaveBeenCalled();
    expect(mockState.setDoc).not.toHaveBeenCalled();
    expect(mockState.deleteDoc).not.toHaveBeenCalled();
    expect(mockState.runTransaction).not.toHaveBeenCalled();
  });

  test("approval request and resolution use trusted callables without direct Firestore writes", async () => {
    mockState.getActiveOrganizationId.mockReturnValue("Org One");

    const requested = await requestQuoteApproval({
      quoteId: "quote-1",
      action: "delete_quote",
      note: "Remove duplicate quote.",
      actorEmail: "forged@example.com",
      actorRole: "sales"
    });
    const resolved = await resolveQuoteApprovalRequest({
      quoteId: "quote-1",
      requestId: requested.request.id,
      state: "approved",
      resolutionNote: "Approved for separate execution.",
      actorEmail: "forged@example.com",
      actorRole: "admin"
    });

    expect(requested).toMatchObject({
      ok: true,
      storage: "firebase",
      request: {
        state: "pending",
        requestedByEmail: "current.admin@example.com"
      }
    });
    expect(resolved).toMatchObject({
      ok: true,
      storage: "firebase",
      request: {
        state: "approved",
        resolvedByEmail: "current.admin@example.com"
      }
    });
    expect(mockState.httpsCallable).toHaveBeenNthCalledWith(
      1,
      mockState.cloudFunctions,
      "requestQuoteApproval"
    );
    expect(mockState.httpsCallable).toHaveBeenNthCalledWith(
      2,
      mockState.cloudFunctions,
      "resolveQuoteApprovalRequest"
    );
    expect(mockState.httpsCallable.mock.results[0].value).toHaveBeenCalledWith({
      organizationId: "org-one",
      quoteId: "quote-1",
      action: "delete_quote",
      note: "Remove duplicate quote."
    });
    expect(mockState.httpsCallable.mock.results[1].value).toHaveBeenCalledWith({
      organizationId: "org-one",
      quoteId: "quote-1",
      requestId: "0123456789abcdef0123456789abcdef",
      state: "approved",
      resolutionNote: "Approved for separate execution."
    });
    expect(mockState.getDoc).not.toHaveBeenCalled();
    expect(mockState.updateDoc).not.toHaveBeenCalled();
    expect(mockState.setDoc).not.toHaveBeenCalled();
    expect(mockState.runTransaction).not.toHaveBeenCalled();
  });

  test("approval rollout fallback is limited to a confirmed missing callable", async () => {
    mockState.getActiveOrganizationId.mockReturnValue("Org One");
    const pendingRequest = {
      id: "0123456789abcdef0123456789abcdef",
      action: "delete_quote",
      state: "pending",
      note: "Remove duplicate quote.",
      requestedAtISO: "2026-08-03T18:00:00.000Z",
      requestedByEmail: "sales@example.com",
      resolvedAtISO: "",
      resolvedByEmail: "",
      resolutionNote: ""
    };
    mockState.getDoc.mockResolvedValue({
      exists: () => true,
      data: () => ({
        id: "quote-1",
        quoteNumber: "Q-1",
        organizationId: "org-one",
        workflow: { approvalRequests: [pendingRequest] }
      })
    });
    mockState.updateDoc.mockResolvedValue(undefined);
    mockState.httpsCallable
      .mockImplementationOnce(() => vi.fn().mockRejectedValue({ code: "functions/not-found" }))
      .mockImplementationOnce(() => vi.fn().mockRejectedValue({ code: "functions/not-found" }))
      .mockImplementationOnce(() => vi.fn().mockRejectedValue({ code: "functions/permission-denied" }));

    const requested = await requestQuoteApproval({
      quoteId: "quote-1",
      action: "convert_to_contract",
      actorEmail: "sales@example.com",
      actorRole: "sales"
    });
    const resolved = await resolveQuoteApprovalRequest({
      quoteId: "quote-1",
      requestId: pendingRequest.id,
      state: "approved",
      actorEmail: "admin@example.com",
      actorRole: "admin"
    });

    expect(requested).toMatchObject({
      ok: true,
      storage: "firebase",
      request: { requestedByEmail: "current.admin@example.com" }
    });
    expect(resolved).toMatchObject({
      ok: true,
      storage: "firebase",
      request: {
        id: pendingRequest.id,
        state: "approved",
        resolvedByEmail: "current.admin@example.com"
      }
    });
    expect(mockState.updateDoc).toHaveBeenCalledTimes(2);

    await expect(requestQuoteApproval({
      quoteId: "quote-1",
      action: "rotate_portal_link",
      actorEmail: "sales@example.com",
      actorRole: "sales"
    })).rejects.toMatchObject({ code: "functions/permission-denied" });
    expect(mockState.updateDoc).toHaveBeenCalledTimes(2);
  });

  test("rejects a trusted final-balance approval response when its server scope is missing", async () => {
    mockState.getActiveOrganizationId.mockReturnValue("Org One");
    mockState.httpsCallable.mockImplementationOnce(() => vi.fn().mockResolvedValue({
      data: {
        ok: true,
        organizationId: "org-one",
        quoteId: "quote-1",
        request: {
          id: "final-balance-request-000001",
          action: "send_final_balance_request",
          state: "pending",
          requestedAtISO: "2026-08-04T16:00:00.000Z",
          requestedByEmail: "current.admin@example.com"
        }
      }
    }));

    await expect(requestQuoteApproval({
      quoteId: "quote-1",
      action: "send_final_balance_request",
      actorEmail: "forged@example.com",
      actorRole: "admin"
    })).rejects.toThrow(/invalid response/i);
    expect(mockState.getDoc).not.toHaveBeenCalled();
    expect(mockState.updateDoc).not.toHaveBeenCalled();
  });

  test("never falls back to browser writes for final-balance approval or resolution", async () => {
    mockState.getActiveOrganizationId.mockReturnValue("Org One");
    const pendingRequest = {
      id: "final-balance-request-000001",
      action: "send_final_balance_request",
      state: "pending",
      requestedAtISO: "2026-08-04T16:00:00.000Z",
      requestedByEmail: "sales@example.com"
    };
    mockState.getDoc.mockResolvedValue({
      exists: () => true,
      data: () => ({
        id: "quote-1",
        quoteNumber: "Q-1",
        organizationId: "org-one",
        workflow: { approvalRequests: [pendingRequest] }
      })
    });
    mockState.httpsCallable
      .mockImplementationOnce(() => vi.fn().mockRejectedValue({ code: "functions/not-found" }))
      .mockImplementationOnce(() => vi.fn().mockRejectedValue({ code: "functions/not-found" }));

    await expect(requestQuoteApproval({
      quoteId: "quote-1",
      action: "send_final_balance_request",
      actorEmail: "sales@example.com",
      actorRole: "sales"
    })).rejects.toThrow(/coordinated backend release/i);
    await expect(resolveQuoteApprovalRequest({
      quoteId: "quote-1",
      requestId: pendingRequest.id,
      state: "approved",
      actorEmail: "admin@example.com",
      actorRole: "admin"
    })).rejects.toThrow(/coordinated backend release/i);
    expect(mockState.updateDoc).not.toHaveBeenCalled();
    expect(mockState.setDoc).not.toHaveBeenCalled();
    expect(mockState.runTransaction).not.toHaveBeenCalled();
  });

  test("saveQuoteVersion does not auto-migrate legacy global quote into scoped org path", async () => {
    mockState.getActiveOrganizationId.mockReturnValue("Org One");
    mockState.getDoc.mockResolvedValueOnce({ exists: () => false, data: () => ({}) });

    await expect(saveQuoteVersion("legacy-global-quote")).rejects.toThrow(/quote not found/i);
    expect(mockState.setDoc).not.toHaveBeenCalled();
  });

  test("change-request handling re-reads transactionally and writes only internal workflow audit", async () => {
    const requestSubmittedAtISO = "2026-08-03T14:00:00.000Z";
    mockState.runTransaction.mockImplementationOnce(async (_db, handler) => handler({
      get: vi.fn().mockResolvedValue({
        exists: () => true,
        data: () => ({
          status: "viewed",
          portalDecision: {
            decision: "changes_requested",
            message: "Please revise the service plan.",
            requestId: "request-service-plan",
            submittedAtISO: requestSubmittedAtISO
          },
          workflow: {}
        })
      }),
      update: mockState.transactionUpdate
    }));

    const result = await updateQuoteChangeRequestHandling({
      organizationId: "org-one",
      quoteId: "quote-1",
      sourceRequestId: "request-service-plan",
      sourceSubmittedAtISO: requestSubmittedAtISO,
      sourceMessage: "Please revise the service plan.",
      action: "mark_handled",
      note: "Prepared the revised proposal for customer review.",
      actorEmail: "forged@example.com",
      actorRole: "sales"
    });

    expect(result).toMatchObject({
      ok: true,
      storage: "firebase",
      handling: {
        sourceRequestId: "request-service-plan",
        sourceSubmittedAtISO: requestSubmittedAtISO,
        sourceMessage: "Please revise the service plan.",
        state: "handled",
        acknowledgedByEmail: "current.admin@example.com",
        handledByEmail: "current.admin@example.com",
        note: "Prepared the revised proposal for customer review."
      }
    });
    expect(mockState.runTransaction).toHaveBeenCalledTimes(1);
    expect(mockState.transactionUpdate).toHaveBeenCalledTimes(1);
    const [quoteRef, patch] = mockState.transactionUpdate.mock.calls[0];
    expect(quoteRef).toMatchObject({
      refType: "org-doc",
      name: "quotes",
      docId: "quote-1",
      orgId: "org-one"
    });
    expect(Object.keys(patch).sort()).toEqual([
      "updatedAtISO",
      "workflow.changeRequestHandling"
    ]);
    expect(patch["workflow.changeRequestHandling"]).toMatchObject({
      acknowledgedByEmail: "current.admin@example.com",
      handledByEmail: "current.admin@example.com"
    });
    expect(mockState.updateDoc).not.toHaveBeenCalled();
    expect(mockState.transactionSet).not.toHaveBeenCalled();
    expect(mockState.writeBatch).not.toHaveBeenCalled();
    expect(mockState.httpsCallable).not.toHaveBeenCalled();
  });

  test("workflow attention snapshot is a one-shot active-status read with no operational writes", async () => {
    const result = await getWorkflowAttentionSnapshot({ organizationId: "org-one" });

    expect(result).toEqual({ source: "firebase", quotes: [] });
    expect(mockState.where).toHaveBeenCalledWith(
      "status",
      "in",
      ["draft", "sent", "viewed", "accepted"]
    );
    expect(mockState.getDocs).toHaveBeenCalledTimes(1);
    expect(mockState.updateDoc).not.toHaveBeenCalled();
    expect(mockState.runTransaction).not.toHaveBeenCalled();
    expect(mockState.transactionSet).not.toHaveBeenCalled();
    expect(mockState.writeBatch).not.toHaveBeenCalled();
  });

  test("history derives expiry without attempting a staff write by default", async () => {
    mockState.getDocs.mockResolvedValue({
      docs: [{
        id: "quote-expired",
        data: () => ({
          organizationId: "org-one",
          portalKey: "portal-key-12345678901234567890",
          status: "sent",
          createdAtISO: "2026-01-01T00:00:00.000Z",
          updatedAtISO: "2026-01-01T00:00:00.000Z",
          expiresAtISO: "2026-01-02T00:00:00.000Z",
          portalExpiresAtISO: "2026-01-02T00:00:00.000Z"
        })
      }]
    });

    const result = await getQuoteHistory({ organizationId: "org-one" });

    expect(result.quotes[0]?.status).toBe("expired");
    expect(mockState.updateDoc).not.toHaveBeenCalled();
    expect(mockState.writeBatch).not.toHaveBeenCalled();
  });

  test("history keeps an expired unresolved delivery visible without attempting lifecycle persistence", async () => {
    mockState.getDocs.mockResolvedValue({
      docs: [{
        id: "quote-unresolved-expiry",
        data: () => ({
          organizationId: "org-one",
          portalKey: "portal-key-unresolved-12345678901234567890",
          status: "sent",
          createdAtISO: "2026-01-01T00:00:00.000Z",
          updatedAtISO: "2026-01-01T00:00:00.000Z",
          expiresAtISO: "2026-01-02T00:00:00.000Z",
          portalExpiresAtISO: "2026-01-02T00:00:00.000Z",
          workflow: {
            quoteDelivery: {
              state: "outcome_unknown"
            }
          }
        })
      }]
    });

    const result = await getQuoteHistory({
      organizationId: "org-one",
      persistExpiredStatuses: true
    });

    expect(result.quotes[0]?.status).toBe("expired");
    expect(result.expiryPersistenceFailures).toEqual([]);
    expect(mockState.getDoc).not.toHaveBeenCalled();
    expect(mockState.writeBatch).not.toHaveBeenCalled();
  });

  test("one failed expiry persistence does not blank quote history", async () => {
    setQuoteStoreOrganizationId("org-one");
    const storedQuote = {
      organizationId: "org-one",
      portalKey: "portal-key-failed-12345678901234567890",
      portalIssuedAtISO: "2026-01-01T00:00:00.000Z",
      portalExpiresAtISO: "2026-01-02T00:00:00.000Z",
      status: "sent",
      createdAtISO: "2026-01-01T00:00:00.000Z",
      updatedAtISO: "2026-01-01T00:00:00.000Z",
      expiresAtISO: "2026-01-02T00:00:00.000Z",
      customer: {},
      event: {},
      totals: {},
      payment: {},
      booking: {},
      lifecycle: { sentAtISO: "2026-01-01T00:00:00.000Z" },
      latestVersionNumber: 1,
      activeVersionId: "v0001"
    };
    mockState.getDocs.mockResolvedValue({
      docs: [{
        id: "quote-failed-expiry",
        data: () => storedQuote
      }]
    });
    mockState.getDoc.mockResolvedValue({
      id: "quote-failed-expiry",
      exists: () => true,
      data: () => storedQuote
    });
    mockState.writeBatch.mockReturnValue({
      update: vi.fn(),
      commit: vi.fn().mockRejectedValue(new Error("matching portal missing"))
    });

    const result = await getQuoteHistory({
      organizationId: "org-one",
      persistExpiredStatuses: true
    });

    expect(result.quotes[0]?.status).toBe("expired");
    expect(result.expiryPersistenceFailures).toEqual(["quote-failed-expiry"]);
    expect(mockState.writeBatch).toHaveBeenCalledTimes(1);
  });

  test("admin expiry persists quote and portal in one batch", async () => {
    setQuoteStoreOrganizationId("org-one");
    const batchUpdate = vi.fn();
    const batchSet = vi.fn();
    const batchCommit = vi.fn().mockResolvedValue(undefined);
    mockState.writeBatch.mockReturnValue({
      update: batchUpdate,
      set: batchSet,
      commit: batchCommit
    });
    mockState.getDoc.mockResolvedValue({
      id: "quote-1",
      exists: () => true,
      data: () => ({
        id: "quote-1",
        organizationId: "org-one",
        portalKey: "portal-key-12345678901234567890",
        portalIssuedAtISO: "2026-08-03T17:00:00.000Z",
        portalExpiresAtISO: "2026-09-02T17:00:00.000Z",
        status: "sent",
        customer: {},
        event: {},
        totals: {},
        payment: {},
        booking: {},
        lifecycle: { sentAtISO: "2026-08-03T17:00:00.000Z" },
        latestVersionNumber: 1,
        activeVersionId: "v0001"
      })
    });

    await updateQuoteStatus("quote-1", "expired");

    expect(batchUpdate).toHaveBeenCalledTimes(2);
    expect(batchUpdate.mock.calls[1][0]).toMatchObject({
      refType: "doc",
      args: [mockState.db, "customerPortalQuotes", "portal-key-12345678901234567890"]
    });
    expect(batchUpdate.mock.calls[1][1]).toMatchObject({
      status: "expired",
      lifecycle: {
        sentAtISO: "2026-08-03T17:00:00.000Z"
      }
    });
    expect(batchUpdate.mock.calls[1][1].lifecycle.expiredAtISO).toEqual(expect.any(String));
    expect(Object.keys(batchUpdate.mock.calls[1][1]).sort()).toEqual([
      "lifecycle",
      "status",
      "updatedAtISO"
    ]);
    expect(batchSet).not.toHaveBeenCalled();
    expect(batchCommit).toHaveBeenCalledTimes(1);
    expect(mockState.updateDoc).not.toHaveBeenCalled();
  });

  test("change-request handling rejects a stale source before any write", async () => {
    mockState.runTransaction.mockImplementationOnce(async (_db, handler) => handler({
      get: vi.fn().mockResolvedValue({
        exists: () => true,
        data: () => ({
          status: "viewed",
          portalDecision: {
            decision: "changes_requested",
            message: "Please revise the service plan.",
            requestId: "request-service-plan-new",
            submittedAtISO: "2026-08-03T15:00:00.000Z"
          },
          workflow: {}
        })
      }),
      update: mockState.transactionUpdate
    }));

    await expect(updateQuoteChangeRequestHandling({
      organizationId: "org-one",
      quoteId: "quote-1",
      sourceRequestId: "request-service-plan",
      sourceSubmittedAtISO: "2026-08-03T14:00:00.000Z",
      sourceMessage: "Please revise the service plan.",
      action: "acknowledge",
      actorRole: "sales"
    })).rejects.toMatchObject({ code: "workflow/stale-change-request" });

    expect(mockState.transactionUpdate).not.toHaveBeenCalled();
    expect(mockState.updateDoc).not.toHaveBeenCalled();
    expect(mockState.transactionSet).not.toHaveBeenCalled();
  });

  test("portal acceptance delegates signer consent and revision preconditions to the server", async () => {
    const result = await updatePortalDecision({
      portalKey: "portal-key-12345678901234567890",
      decision: "accepted",
      message: "",
      signerName: "Jordan Client",
      consentVersion: "proposal-acceptance-v1",
      expectedRevisionId: "v0003@2026-08-05T18:00:00.000Z",
      expectedPortalIssuedAtISO: "2026-08-05T18:00:00.000Z"
    });

    expect(result).toMatchObject({
      ok: true,
      storage: "firebase",
      status: "accepted",
      portalDecision: {
        decision: "accepted"
      },
      acceptanceReceipt: {
        signerName: "Jordan Client"
      }
    });
    expect(mockState.httpsCallable).toHaveBeenCalledWith(
      mockState.cloudFunctions,
      "acceptQuoteProposal"
    );
    expect(mockState.getDoc).not.toHaveBeenCalled();
    expect(mockState.writeBatch).not.toHaveBeenCalled();
    expect(mockState.updateDoc).not.toHaveBeenCalled();
  });

  test("portal acceptance fails closed before calling the server when revision evidence is missing", async () => {
    await expect(updatePortalDecision({
      portalKey: "portal-key-12345678901234567890",
      decision: "accepted",
      message: "",
      signerName: "Jordan Client",
      consentVersion: "proposal-acceptance-v1"
    })).rejects.toThrow(/reload the current proposal/i);

    expect(mockState.writeBatch).not.toHaveBeenCalled();
    expect(mockState.updateDoc).not.toHaveBeenCalled();
  });
});
