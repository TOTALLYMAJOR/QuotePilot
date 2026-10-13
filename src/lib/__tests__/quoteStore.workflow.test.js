import { afterEach, beforeEach, describe, expect, test, vi } from "vitest";

vi.mock("../firebase", () => ({
  db: null,
  firebaseReady: false
}));

import {
  getQuoteHistory,
  getWorkflowAttentionSnapshot,
  requestQuoteApproval,
  resolveQuoteApprovalRequest,
  updateQuoteStatus,
  updateQuoteChangeRequestHandling,
  updateQuoteFollowUp,
  updateQuoteProductionChecklist
} from "../quoteStore";
import { buildCommercialPriorityContext } from "../ambientOpportunityStream";
import { buildMoneyRows } from "../commandCenterEvidence";
import { readCommercialEvidencePresence } from "../commercialEvidencePresence";

const LOCAL_QUOTES_KEY = "quoteWizard.quotes";
const LOCAL_QUOTE_HISTORY_KEY = "quoteWizard.quoteHistory";

function createStorageMock() {
  const store = {};
  return {
    getItem(key) {
      return Object.prototype.hasOwnProperty.call(store, key) ? store[key] : null;
    },
    setItem(key, value) {
      store[key] = String(value);
    },
    removeItem(key) {
      delete store[key];
    },
    clear() {
      Object.keys(store).forEach((key) => delete store[key]);
    }
  };
}

function seedQuote() {
  localStorage.setItem(LOCAL_QUOTES_KEY, JSON.stringify([{
    id: "workflow-quote",
    organizationId: "org-local",
    quoteNumber: "Q-WORKFLOW",
    status: "sent",
    createdAtISO: "2026-05-01T10:00:00.000Z",
    updatedAtISO: "2026-05-01T10:00:00.000Z",
    expiresAtISO: "2026-12-01T10:00:00.000Z",
    portalKey: "portal-key-12345678901234567890",
    customer: { name: "Avery", email: "avery@example.com", phone: "205-555-0100" },
    event: {
      name: "Gala",
      date: "2026-08-01",
      time: "18:00",
      venue: "Grand Hall",
      guests: 100,
      hours: 5
    },
    selection: { packageId: "classic", menuItems: ["salmon"] },
    totals: { total: 7000, deposit: 2100 },
    booking: {},
    workflow: {}
  }]));
}

async function readQuote() {
  const result = await getQuoteHistory();
  return result.quotes.find((item) => item.id === "workflow-quote");
}

describe("quoteStore workflow persistence", () => {
  beforeEach(() => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-05-02T12:00:00.000Z"));
    vi.stubGlobal("localStorage", createStorageMock());
    seedQuote();
  });

  afterEach(() => {
    vi.useRealTimers();
    vi.unstubAllGlobals();
  });

  test("persists follow-up stage, due date, note, and completion", async () => {
    const result = await updateQuoteFollowUp({
      quoteId: "workflow-quote",
      stage: "awaiting_response",
      dueDate: "2026-05-08",
      note: "Call after venue walkthrough.",
      completed: true,
      actorEmail: "sales@example.com"
    });

    expect(result.followUp).toMatchObject({
      stage: "awaiting_response",
      dueDate: "2026-05-08",
      completed: true,
      updatedByEmail: "sales@example.com"
    });
    expect((await readQuote()).workflow.followUp.completedAtISO).toBeTruthy();
  });

  test("reads workflow attention quotes without expiry writes and keeps tenant scope exact", async () => {
    const sameTenant = await getWorkflowAttentionSnapshot({ organizationId: "org-local" });
    const otherTenant = await getWorkflowAttentionSnapshot({ organizationId: "org-other" });

    expect(sameTenant).toMatchObject({ source: "local" });
    expect(sameTenant.quotes.map((quote) => quote.id)).toEqual(["workflow-quote"]);
    expect(otherTenant.quotes).toEqual([]);
    await expect(getWorkflowAttentionSnapshot()).rejects.toThrow(/organizationId is required/i);
  });

  test("keeps compatibility defaults from becoming payment or booking evidence after a real read", async () => {
    const existing = JSON.parse(localStorage.getItem(LOCAL_QUOTES_KEY));
    existing[0].status = "accepted";
    localStorage.setItem(LOCAL_QUOTES_KEY, JSON.stringify(existing));

    const hydrated = await readQuote();
    expect(hydrated.payment.depositStatus).toBe("unpaid");
    expect(hydrated.payment.finalBalance.status).toBe("unpaid");
    expect(hydrated.booking.confirmationStatus).toBe("pending");
    expect(readCommercialEvidencePresence(hydrated)).toEqual({
      quote: true,
      deposit: false,
      depositStatus: false,
      depositStatusValue: "",
      finalBalance: false,
      finalBalanceStatus: false,
      finalBalanceStatusValue: "",
      finalBalanceCheckoutStateValue: "",
      booking: false,
      bookingStatus: false,
      bookingStatusValue: ""
    });
    expect(buildCommercialPriorityContext(hydrated).position).toMatchObject({
      booking: { available: false },
      deposit: { available: false },
      finalBalance: { available: false }
    });
    expect(buildMoneyRows([hydrated])).toEqual([]);
  });

  test("does not persist hydration defaults through automatic expiry or status writes", async () => {
    const expiring = JSON.parse(localStorage.getItem(LOCAL_QUOTES_KEY));
    expiring[0].expiresAtISO = "2026-05-01T11:00:00.000Z";
    localStorage.setItem(LOCAL_QUOTES_KEY, JSON.stringify(expiring));

    const expired = await readQuote();
    expect(expired.status).toBe("expired");
    let persisted = JSON.parse(localStorage.getItem(LOCAL_QUOTES_KEY))[0];
    expect(persisted.payment).toEqual({});
    expect(persisted.booking).toEqual({});

    await updateQuoteStatus("workflow-quote", "draft");
    persisted = JSON.parse(localStorage.getItem(LOCAL_QUOTES_KEY))[0];
    expect(persisted.payment).toEqual({});
    expect(persisted.booking).toEqual({});

    const reread = await readQuote();
    expect(readCommercialEvidencePresence(reread)).toMatchObject({
      deposit: false,
      finalBalance: false,
      booking: false
    });
  });

  test("keeps timestamp-only payment and contract rails status-unknown through write and reread", async () => {
    const existing = JSON.parse(localStorage.getItem(LOCAL_QUOTES_KEY));
    existing[0].payment = {
      depositConfirmedAtISO: "2026-05-02T09:00:00.000Z",
      finalBalance: { confirmedAtISO: "2026-05-02T10:00:00.000Z" }
    };
    existing[0].booking = { contractNumber: "CT-STATUS-UNKNOWN" };
    localStorage.setItem(LOCAL_QUOTES_KEY, JSON.stringify(existing));

    const hydrated = await readQuote();
    expect(readCommercialEvidencePresence(hydrated)).toMatchObject({
      deposit: true,
      depositStatus: false,
      finalBalance: true,
      finalBalanceStatus: false,
      booking: true,
      bookingStatus: false
    });
    expect(buildCommercialPriorityContext(hydrated).position).toMatchObject({
      booking: { available: false },
      deposit: { available: false },
      finalBalance: { available: false }
    });
    expect(buildMoneyRows([hydrated])).toEqual([]);

    await updateQuoteStatus("workflow-quote", "draft");
    const persisted = JSON.parse(localStorage.getItem(LOCAL_QUOTES_KEY))[0];
    expect(persisted.payment.depositStatus).toBeUndefined();
    expect(persisted.payment.finalBalance.status).toBeUndefined();
    expect(persisted.booking.confirmationStatus).toBeUndefined();
    const reread = await readQuote();
    expect(readCommercialEvidencePresence(reread)).toMatchObject({
      depositStatus: false,
      finalBalanceStatus: false,
      bookingStatus: false
    });
  });

  test("preserves malformed recorded statuses as unavailable through write and reread", async () => {
    const existing = JSON.parse(localStorage.getItem(LOCAL_QUOTES_KEY));
    existing[0].payment = {
      depositStatus: "provider_mystery",
      finalBalance: { status: "provider_mystery" }
    };
    existing[0].booking = { confirmationStatus: "provider_mystery" };
    localStorage.setItem(LOCAL_QUOTES_KEY, JSON.stringify(existing));

    let hydrated = await readQuote();
    expect(hydrated.payment.depositStatus).toBe("unpaid");
    expect(hydrated.payment.finalBalance.status).toBe("unpaid");
    expect(hydrated.booking.confirmationStatus).toBe("pending");
    expect(readCommercialEvidencePresence(hydrated)).toMatchObject({
      depositStatusValue: "provider_mystery",
      finalBalanceStatusValue: "provider_mystery",
      bookingStatusValue: "provider_mystery"
    });
    expect(buildCommercialPriorityContext(hydrated).position).toMatchObject({
      booking: { available: false, raw: "provider_mystery" },
      deposit: { available: false, raw: "provider_mystery" },
      finalBalance: { available: false, raw: "provider_mystery" }
    });
    expect(buildMoneyRows([hydrated])).toEqual([]);

    await updateQuoteStatus("workflow-quote", "draft");
    const snapshot = JSON.parse(localStorage.getItem(LOCAL_QUOTE_HISTORY_KEY))[0].snapshot;
    expect(snapshot.payment.depositStatus).toBe("provider_mystery");
    expect(snapshot.payment.finalBalance.status).toBe("provider_mystery");
    expect(snapshot.booking.confirmationStatus).toBe("provider_mystery");

    await updateQuoteProductionChecklist({
      quoteId: "workflow-quote",
      checklist: [{ id: "final-count", label: "Final count", completed: false }],
      actorEmail: "ops@example.com"
    });
    const checklistPersisted = JSON.parse(localStorage.getItem(LOCAL_QUOTES_KEY))[0];
    expect(checklistPersisted.booking.confirmationStatus).toBe("provider_mystery");
    const checklistSnapshot = JSON.parse(localStorage.getItem(LOCAL_QUOTE_HISTORY_KEY))[0].snapshot;
    expect(checklistSnapshot.booking.confirmationStatus).toBe("provider_mystery");

    await updateQuoteStatus("workflow-quote", "booked");
    const bookedPersisted = JSON.parse(localStorage.getItem(LOCAL_QUOTES_KEY))[0];
    expect(bookedPersisted.booking).toMatchObject({
      confirmationStatus: "provider_mystery",
      bookedAtISO: "2026-05-02T12:00:00.000Z"
    });
    const bookedSnapshot = JSON.parse(localStorage.getItem(LOCAL_QUOTE_HISTORY_KEY))[0].snapshot;
    expect(bookedSnapshot.booking.confirmationStatus).toBe("provider_mystery");

    hydrated = await readQuote();
    expect(hydrated.payment.depositStatus).toBe("unpaid");
    expect(hydrated.payment.finalBalance.status).toBe("unpaid");
    expect(hydrated.booking.confirmationStatus).toBe("pending");
    expect(readCommercialEvidencePresence(hydrated)).toMatchObject({
      depositStatusValue: "provider_mystery",
      finalBalanceStatusValue: "provider_mystery",
      bookingStatusValue: "provider_mystery"
    });
  });

  test("binds internal change-request handling to the current customer request", async () => {
    const existing = JSON.parse(localStorage.getItem(LOCAL_QUOTES_KEY));
    existing[0].portalDecision = {
      decision: "changes_requested",
      message: "Please remove coffee service.",
      requestId: "request-remove-coffee",
      submittedAtISO: "2026-05-02T11:00:00.000Z"
    };
    localStorage.setItem(LOCAL_QUOTES_KEY, JSON.stringify(existing));

    await expect(updateQuoteChangeRequestHandling({
      quoteId: "workflow-quote",
      organizationId: "org-local",
      sourceRequestId: "request-remove-coffee",
      sourceSubmittedAtISO: "2026-05-02T11:00:00.000Z",
      sourceMessage: "Please remove coffee service.",
      action: "acknowledge",
      actorEmail: "customer@example.com",
      actorRole: "customer"
    })).rejects.toThrow(/staff role required/i);

    const acknowledged = await updateQuoteChangeRequestHandling({
      quoteId: "workflow-quote",
      organizationId: "org-local",
      sourceRequestId: "request-remove-coffee",
      sourceSubmittedAtISO: "2026-05-02T11:00:00.000Z",
      sourceMessage: "Please remove coffee service.",
      action: "acknowledge",
      actorEmail: "sales@example.com",
      actorRole: "sales"
    });
    expect(acknowledged.handling).toMatchObject({
      sourceSubmittedAtISO: "2026-05-02T11:00:00.000Z",
      state: "acknowledged",
      acknowledgedByEmail: "sales@example.com"
    });

    vi.setSystemTime(new Date("2026-05-02T13:00:00.000Z"));
    const handled = await updateQuoteChangeRequestHandling({
      quoteId: "workflow-quote",
      organizationId: "org-local",
      sourceRequestId: "request-remove-coffee",
      sourceSubmittedAtISO: "2026-05-02T11:00:00.000Z",
      sourceMessage: "Please remove coffee service.",
      action: "mark_handled",
      note: "Updated the proposal and confirmed the revision with the customer.",
      actorEmail: "admin@example.com",
      actorRole: "admin"
    });
    expect(handled.handling).toMatchObject({
      state: "handled",
      acknowledgedAtISO: acknowledged.handling.acknowledgedAtISO,
      acknowledgedByEmail: "sales@example.com",
      handledAtISO: "2026-05-02T13:00:00.000Z",
      handledByEmail: "admin@example.com",
      note: "Updated the proposal and confirmed the revision with the customer."
    });

    const quote = await readQuote();
    expect(quote.portalDecision).toEqual(existing[0].portalDecision);
    expect(quote.workflow.changeRequestHandling).toMatchObject({
      sourceSubmittedAtISO: existing[0].portalDecision.submittedAtISO,
      state: "handled"
    });
  });

  test("fails stale or unnoted handling closed and keeps repeated handling idempotent", async () => {
    const existing = JSON.parse(localStorage.getItem(LOCAL_QUOTES_KEY));
    existing[0].portalDecision = {
      decision: "changes_requested",
      message: "Change the service time.",
      requestId: "request-service-time",
      submittedAtISO: "2026-05-02T11:00:00.000Z"
    };
    localStorage.setItem(LOCAL_QUOTES_KEY, JSON.stringify(existing));

    await expect(updateQuoteChangeRequestHandling({
      organizationId: "org-local",
      quoteId: "workflow-quote",
      sourceRequestId: "request-service-time",
      sourceSubmittedAtISO: "2026-05-02T10:00:00.000Z",
      sourceMessage: "Change the service time.",
      action: "acknowledge",
      actorEmail: "sales@example.com",
      actorRole: "sales"
    })).rejects.toMatchObject({ code: "workflow/stale-change-request" });
    await expect(updateQuoteChangeRequestHandling({
      organizationId: "org-local",
      quoteId: "workflow-quote",
      sourceRequestId: "replayed-request-id",
      sourceSubmittedAtISO: "2026-05-02T11:00:00.000Z",
      sourceMessage: "A different request.",
      action: "acknowledge",
      actorEmail: "sales@example.com",
      actorRole: "sales"
    })).rejects.toMatchObject({ code: "workflow/stale-change-request" });
    await expect(updateQuoteChangeRequestHandling({
      organizationId: "org-local",
      quoteId: "workflow-quote",
      sourceRequestId: "request-service-time",
      sourceSubmittedAtISO: "2026-05-02T11:00:00.000Z",
      sourceMessage: "Change the service time.",
      action: "mark_handled",
      actorEmail: "sales@example.com",
      actorRole: "sales"
    })).rejects.toThrow(/handling note is required/i);

    const handled = await updateQuoteChangeRequestHandling({
      organizationId: "org-local",
      quoteId: "workflow-quote",
      sourceRequestId: "request-service-time",
      sourceSubmittedAtISO: "2026-05-02T11:00:00.000Z",
      sourceMessage: "Change the service time.",
      action: "mark_handled",
      note: "Adjusted the service time in the draft.",
      actorEmail: "sales@example.com",
      actorRole: "sales"
    });
    const persistedAfterFirstWrite = localStorage.getItem(LOCAL_QUOTES_KEY);
    const repeated = await updateQuoteChangeRequestHandling({
      organizationId: "org-local",
      quoteId: "workflow-quote",
      sourceRequestId: "request-service-time",
      sourceSubmittedAtISO: "2026-05-02T11:00:00.000Z",
      sourceMessage: "Change the service time.",
      action: "mark_handled",
      note: "A different note must not rewrite immutable handling.",
      actorEmail: "sales@example.com",
      actorRole: "sales"
    });

    expect(handled.storage).toBe("local");
    expect(repeated.storage).toBe("unchanged");
    expect(repeated.handling.note).toBe("Adjusted the service time in the draft.");
    expect(localStorage.getItem(LOCAL_QUOTES_KEY)).toBe(persistedAfterFirstWrite);
  });

  test("keeps sensitive approval execution separate from admin resolution", async () => {
    const existing = JSON.parse(localStorage.getItem(LOCAL_QUOTES_KEY));
    existing[0].status = "accepted";
    localStorage.setItem(LOCAL_QUOTES_KEY, JSON.stringify(existing));

    const requested = await requestQuoteApproval({
      quoteId: "workflow-quote",
      action: "convert_to_contract",
      note: "Customer accepted by phone.",
      actorEmail: "sales@example.com",
      actorRole: "sales"
    });
    expect(requested.request.state).toBe("pending");

    await expect(resolveQuoteApprovalRequest({
      quoteId: "workflow-quote",
      requestId: requested.request.id,
      state: "approved",
      actorEmail: "sales@example.com",
      actorRole: "sales"
    })).rejects.toThrow(/admin role required/i);

    const resolved = await resolveQuoteApprovalRequest({
      quoteId: "workflow-quote",
      requestId: requested.request.id,
      state: "approved",
      resolutionNote: "Approved for admin execution.",
      actorEmail: "admin@example.com",
      actorRole: "admin"
    });
    expect(resolved.request).toMatchObject({
      state: "approved",
      resolvedByEmail: "admin@example.com"
    });
    expect((await readQuote()).status).toBe("accepted");
  });

  test("hydrates final-balance defaults and preserves the exact governed scope", async () => {
    const existing = JSON.parse(localStorage.getItem(LOCAL_QUOTES_KEY));
    existing[0].status = "booked";
    existing[0].totals = { total: 1604.772, deposit: 481.4316 };
    existing[0].payment = {
      depositStatus: "paid",
      stripeSessionId: "cs_test_deposit_123",
      depositConfirmedAtISO: "2026-05-02T10:00:00.000Z"
    };
    existing[0].booking = {
      contractNumber: "C-260502-12345",
      contractConvertedAtISO: "2026-05-02T11:00:00.000Z"
    };
    const actionScope = {
      version: 1,
      kind: "stripe_checkout_final_balance_request",
      organizationId: "org-local",
      quoteId: "workflow-quote",
      quoteRevisionId: "v0001@2026-05-01T10:00:00.000Z",
      portalKey: "portal-key-12345678901234567890",
      portalIssuedAtISO: "2026-05-01T10:00:00.000Z",
      portalExpiresAtISO: "2026-12-01T10:00:00.000Z",
      customerEmail: "avery@example.com",
      paymentKind: "final_balance",
      currency: "usd",
      amountCents: 112334,
      depositStatus: "paid",
      depositAmountCents: 48143,
      depositStripeSessionId: "cs_test_deposit_123",
      depositConfirmedAtISO: "2026-05-02T10:00:00.000Z",
      contractNumber: "C-260502-12345",
      contractConvertedAtISO: "2026-05-02T11:00:00.000Z",
      checkoutGeneration: 1
    };
    existing[0].workflow = {
      approvalRequests: [{
        id: "final-balance-approval",
        action: "send_final_balance_request",
        state: "approved",
        requestedAtISO: "2026-05-02T11:30:00.000Z",
        resolvedAtISO: "2026-05-02T11:45:00.000Z",
        actionScope,
        actionScopeDigest: "a".repeat(64),
        executionState: "awaiting_execution"
      }]
    };
    localStorage.setItem(LOCAL_QUOTES_KEY, JSON.stringify(existing));

    const quote = await readQuote();
    expect(quote.payment.finalBalance.amountCents).toBe(112334);
    expect(quote.payment.finalBalance.status).toBe("unpaid");
    expect(quote.payment.finalBalance.currency).toBe("usd");
    expect(Object.keys(quote.payment.finalBalance)).toEqual([]);
    expect(quote.workflow.approvalRequests[0]).toMatchObject({
      action: "send_final_balance_request",
      actionScope,
      actionScopeDigest: "a".repeat(64)
    });
  });

  test("persists only recognized production checklist items", async () => {
    const result = await updateQuoteProductionChecklist({
      quoteId: "workflow-quote",
      actorEmail: "ops@example.com",
      checklist: [
        { id: "event-brief", completed: true },
        { id: "unknown", completed: true },
        { id: "pack-out", completed: false }
      ]
    });

    expect(result.checklist).toHaveLength(2);
    expect(result.checklist[0]).toMatchObject({
      id: "event-brief",
      completed: true,
      completedByEmail: "ops@example.com"
    });
    expect((await readQuote()).booking.productionChecklist).toHaveLength(2);
  });
});
