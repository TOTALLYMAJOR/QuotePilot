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
  updateQuoteChangeRequestHandling,
  updateQuoteFollowUp,
  updateQuoteProductionChecklist
} from "../quoteStore";

const LOCAL_QUOTES_KEY = "quoteWizard.quotes";

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
    expect(quote.payment.finalBalance).toEqual({
      amountCents: 112334,
      currency: "usd",
      status: "unpaid",
      paymentLink: "",
      confirmedAtISO: "",
      stripeSessionId: "",
      stripeCheckoutState: "",
      checkoutGeneration: 0,
      knownStripeSessionIds: []
    });
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
