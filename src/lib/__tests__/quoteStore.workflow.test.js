import { afterEach, beforeEach, describe, expect, test, vi } from "vitest";

vi.mock("../firebase", () => ({
  db: null,
  firebaseReady: false
}));

import {
  getQuoteHistory,
  requestQuoteApproval,
  resolveQuoteApprovalRequest,
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

  test("keeps sensitive approval execution separate from admin resolution", async () => {
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
    expect((await readQuote()).status).toBe("sent");
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
