import { beforeEach, describe, expect, test, vi } from "vitest";

const mockState = vi.hoisted(() => ({
  callable: vi.fn(),
  httpsCallable: vi.fn(),
  cloudFunctions: { id: "functions" }
}));

vi.mock("firebase/functions", () => ({
  httpsCallable: mockState.httpsCallable
}));

vi.mock("../firebase", () => ({
  cloudFunctions: mockState.cloudFunctions,
  firebaseReady: true
}));

vi.mock("../organizationService", () => ({
  normalizeOrganizationId: (value) => String(value || "")
    .trim()
    .toLowerCase()
    .replace(/[^\w-]+/g, "-")
    .replace(/-{2,}/g, "-")
    .replace(/^-|-$/g, "")
}));

import {
  createRebookQuoteDraft,
  getRebookDeliveryGate,
  isDefinitiveRebookQuoteDraftError,
  normalizeReviewedRebookAction
} from "../rebookQuoteClient";

const REQUEST_ID = `rebook_${"a".repeat(48)}`;
const ACTION = Object.freeze({
  kind: "review_rebook_draft",
  state: "ready_for_staff_review",
  sourceQuoteId: "quote-source",
  sourceVersionId: "v0003",
  acceptanceReceiptId: "acceptance-1234567890",
  sourceSnapshot: { mustNeverCrossBoundary: true },
  customerEmail: "must-not-send@example.test"
});

function response(overrides = {}) {
  return {
    ok: true,
    storage: "firebase",
    organizationId: "org-one",
    id: "rebook-quote-created",
    quoteNumber: "Q-260809-1800-ABCDEF12",
    activeVersionId: "v0001",
    customerId: "customer-henderson",
    status: "draft",
    idempotent: false,
    rebooking: {
      sourceQuoteId: ACTION.sourceQuoteId,
      sourceVersionId: ACTION.sourceVersionId,
      sourceEventDate: "2025-08-10",
      acceptanceReceiptId: ACTION.acceptanceReceiptId,
      rebookingRequestId: REQUEST_ID,
      state: "draft_created_for_staff_review"
    },
    ...overrides
  };
}

describe("rebook quote client", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockState.callable.mockResolvedValue({ data: response() });
    mockState.httpsCallable.mockReturnValue(mockState.callable);
  });

  test("projects only exact reviewed identities into the callable payload", async () => {
    const result = await createRebookQuoteDraft({
      organizationId: "org-one",
      reviewedAction: ACTION
    });

    expect(mockState.httpsCallable).toHaveBeenCalledWith(
      mockState.cloudFunctions,
      "createRebookQuoteDraft"
    );
    expect(mockState.callable).toHaveBeenCalledWith({
      organizationId: "org-one",
      sourceQuoteId: ACTION.sourceQuoteId,
      sourceVersionId: ACTION.sourceVersionId,
      acceptanceReceiptId: ACTION.acceptanceReceiptId
    });
    expect(mockState.callable.mock.calls[0][0]).not.toHaveProperty("sourceSnapshot");
    expect(mockState.callable.mock.calls[0][0]).not.toHaveProperty("customerEmail");
    expect(result).toMatchObject({
      id: "rebook-quote-created",
      status: "draft",
      idempotent: false,
      rebooking: { rebookingRequestId: REQUEST_ID }
    });
    expect(Object.isFrozen(result)).toBe(true);
  });

  test("accepts an exact idempotent receipt without calling it a new draft", async () => {
    mockState.callable.mockResolvedValue({
      data: response({ idempotent: true, status: "sent" })
    });
    await expect(createRebookQuoteDraft({
      organizationId: "org-one",
      reviewedAction: ACTION
    })).resolves.toMatchObject({ idempotent: true, status: "sent" });
  });

  test.each([
    [{ ...ACTION, state: "unavailable" }, /not ready/i],
    [{ ...ACTION, sourceQuoteId: "client@example.test" }, /sourceQuoteId/i],
    [{ ...ACTION, sourceVersionId: "bad/version" }, /sourceVersionId/i],
    [{ ...ACTION, acceptanceReceiptId: "" }, /acceptanceReceiptId/i]
  ])("fails before dispatch for an invalid reviewed action", async (reviewedAction, message) => {
    await expect(createRebookQuoteDraft({
      organizationId: "org-one",
      reviewedAction
    })).rejects.toThrow(message);
    expect(mockState.httpsCallable).not.toHaveBeenCalled();
  });

  test("requires the exact normalized organization scope", () => {
    expect(() => normalizeReviewedRebookAction(ACTION, {
      organizationId: "Org One"
    })).toThrow(/exact active organization scope/i);
  });

  test("treats a malformed success payload as uncertain reconciliation work", async () => {
    mockState.callable.mockResolvedValue({ data: response({ customerId: "" }) });
    const error = await createRebookQuoteDraft({
      organizationId: "org-one",
      reviewedAction: ACTION
    }).catch((caught) => caught);
    expect(error.message).toMatch(/incomplete receipt.*reconcile/i);
    expect(isDefinitiveRebookQuoteDraftError(error)).toBe(false);
  });

  test.each([
    ["functions/aborted", true],
    ["functions/invalid-argument", true],
    ["permission-denied", true],
    ["functions/unavailable", false],
    ["internal", false],
    ["deadline-exceeded", false]
  ])("classifies callable code %s without guessing an outcome", (code, definitive) => {
    expect(isDefinitiveRebookQuoteDraftError({ code })).toBe(definitive);
  });
});

describe("rebook delivery gate", () => {
  const completedQuote = {
    organizationId: "org-one",
    customerId: "customer-henderson",
    event: { date: "2026-10-12" },
    rebooking: {
      schemaVersion: 1,
      sourceOrganizationId: "org-one",
      sourceQuoteId: "quote-source",
      sourceVersionId: "v0003",
      sourceCustomerId: "customer-henderson",
      sourceEventDate: "2025-10-12",
      acceptanceReceiptId: "acceptance-1234567890",
      sourceAcceptedAtISO: "2025-09-01T12:00:00.000Z",
      rebookingRequestId: REQUEST_ID,
      draftCreatedAtISO: "2026-08-09T12:00:00.000Z",
      state: "staff_review_completed",
      reviewedEventDate: "2026-10-12",
      reviewedAtISO: "2026-08-09T12:05:00.000Z",
      reviewedBy: {
        uid: "staff-user",
        email: "staff@example.test",
        role: "sales"
      },
      reviewCalendar: {
        date: "2026-08-09",
        timeZone: "America/Chicago"
      }
    }
  };

  test("does not constrain ordinary quotes", () => {
    expect(getRebookDeliveryGate({ status: "draft" })).toEqual({
      applies: false,
      ready: true,
      state: "not_applicable",
      message: "",
      deliveryReady: true,
      deliveryState: "not_applicable",
      deliveryMessage: ""
    });
  });

  test("blocks an exact-version rebook until staff review is completed", () => {
    const quote = {
      ...completedQuote,
      event: { date: "2025-10-12" },
      rebooking: {
        ...completedQuote.rebooking,
        state: "draft_created_for_staff_review",
        reviewedEventDate: undefined,
        reviewedAtISO: undefined,
        reviewedBy: undefined
      }
    };
    expect(getRebookDeliveryGate(quote, {
      tenantTimeZone: "America/Chicago",
      nowISO: "2026-08-09T18:00:00.000Z"
    })).toMatchObject({
      applies: true,
      ready: false,
      state: "review_required"
    });
  });

  test("allows only exact completed review evidence that matches the saved event", () => {
    expect(getRebookDeliveryGate(completedQuote, {
      tenantTimeZone: "America/Chicago",
      nowISO: "2026-08-09T18:00:00.000Z"
    })).toMatchObject({
      applies: true,
      ready: true,
      state: "staff_review_completed",
      deliveryReady: true,
      deliveryState: "ready"
    });
    expect(getRebookDeliveryGate({
      ...completedQuote,
      event: { date: "2026-11-01" }
    }, {
      tenantTimeZone: "America/Chicago",
      nowISO: "2026-08-09T18:00:00.000Z"
    })).toMatchObject({
      ready: false,
      state: "invalid_evidence"
    });
    expect(getRebookDeliveryGate({
      ...completedQuote,
      customerId: "another-customer"
    }, {
      tenantTimeZone: "America/Chicago",
      nowISO: "2026-08-09T18:00:00.000Z"
    })).toMatchObject({
      ready: false,
      state: "invalid_evidence"
    });
    expect(getRebookDeliveryGate({
      ...completedQuote,
      rebooking: {
        ...completedQuote.rebooking,
        sourceEventDate: completedQuote.rebooking.reviewedEventDate
      }
    }, {
      tenantTimeZone: "America/Chicago",
      nowISO: "2026-08-09T18:00:00.000Z"
    })).toMatchObject({
      ready: false,
      state: "invalid_evidence"
    });
  });

  test("blocks without tenant calendar authority and honors the tenant day near UTC midnight", () => {
    expect(getRebookDeliveryGate(completedQuote, {
      nowISO: "2026-08-10T02:30:00.000Z"
    })).toMatchObject({
      ready: true,
      state: "staff_review_completed",
      deliveryReady: false,
      deliveryState: "calendar_authority_required"
    });
    expect(getRebookDeliveryGate({
      ...completedQuote,
      event: { date: "2026-08-09" },
      rebooking: {
        ...completedQuote.rebooking,
        reviewedEventDate: "2026-08-09",
        reviewedAtISO: "2026-08-10T02:30:00.000Z",
        reviewCalendar: { date: "2026-08-09", timeZone: "America/Chicago" }
      }
    }, {
      tenantTimeZone: "America/Chicago",
      nowISO: "2026-08-10T04:59:00.000Z"
    })).toMatchObject({ ready: true, deliveryReady: true });
  });

  test("retains review and artifact validity after the event while blocking a new delivery", () => {
    expect(getRebookDeliveryGate(completedQuote, {
      tenantTimeZone: "America/Chicago",
      nowISO: "2026-10-13T18:00:00.000Z"
    })).toMatchObject({
      ready: true,
      state: "staff_review_completed",
      deliveryReady: false,
      deliveryState: "event_date_elapsed"
    });
  });
});
