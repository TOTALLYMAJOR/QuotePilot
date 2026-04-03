import { afterEach, beforeEach, describe, expect, test, vi } from "vitest";

vi.mock("../firebase", () => ({
  db: null,
  firebaseReady: false
}));

import {
  convertQuoteToContract,
  getQuoteHistory,
  updateQuoteBookingConfirmation,
  updateQuoteKitchenCheckpoints
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

function makeQuote(overrides = {}) {
  const nowISO = "2026-03-10T12:00:00.000Z";
  const base = {
    id: "quote-1",
    quoteNumber: "Q-260310-1200-11111",
    status: "accepted",
    createdAtISO: nowISO,
    updatedAtISO: nowISO,
    expiresAtISO: "2026-04-09T12:00:00.000Z",
    customer: {
      name: "Client One",
      email: "client-one@example.com",
      phone: "205-555-0101"
    },
    event: {
      name: "Spring Banquet",
      date: "2026-04-20",
      time: "18:00",
      venue: "Pine Hall",
      guests: 120,
      hours: 4
    },
    totals: {
      total: 8400,
      deposit: 2520
    },
    payment: {
      depositLink: "",
      depositStatus: "unpaid",
      depositConfirmedAtISO: ""
    },
    booking: {
      bookedAtISO: "",
      bookedByEmail: "",
      contractNumber: "",
      contractConvertedAtISO: "",
      contractConvertedByEmail: "",
      confirmationStatus: "pending",
      confirmationSentAtISO: "",
      confirmedAtISO: "",
      confirmationUpdatedByEmail: "",
      availabilityCheckedAtISO: "",
      availabilitySummary: {}
    },
    lifecycle: {
      acceptedAtISO: nowISO
    }
  };

  return {
    ...base,
    ...overrides,
    customer: {
      ...base.customer,
      ...(overrides.customer || {})
    },
    event: {
      ...base.event,
      ...(overrides.event || {})
    },
    totals: {
      ...base.totals,
      ...(overrides.totals || {})
    },
    payment: {
      ...base.payment,
      ...(overrides.payment || {})
    },
    booking: {
      ...base.booking,
      ...(overrides.booking || {})
    },
    lifecycle: {
      ...base.lifecycle,
      ...(overrides.lifecycle || {})
    }
  };
}

function seedQuotes(quotes) {
  localStorage.setItem(LOCAL_QUOTES_KEY, JSON.stringify(quotes));
}

describe("quoteStore booking workflow", () => {
  beforeEach(() => {
    vi.stubGlobal("localStorage", createStorageMock());
  });

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  test("converts an accepted quote to a booked contract and stores availability summary", async () => {
    seedQuotes([
      makeQuote({ id: "q1", quoteNumber: "Q-1" }),
      makeQuote({
        id: "q2",
        quoteNumber: "Q-2",
        event: {
          time: "19:00"
        }
      })
    ]);

    const result = await convertQuoteToContract({
      quoteId: "q1",
      actorEmail: "sales@tonycatering.com",
      capacityLimit: 400
    });

    expect(result.status).toBe("booked");
    expect(result.contractNumber).toMatch(/^C-\d{6}-\d{5}$/);
    expect(result.booking.contractNumber).toBe(result.contractNumber);
    expect(result.booking.bookedByEmail).toBe("sales@tonycatering.com");
    expect(result.booking.availabilitySummary.acceptedConflictCount).toBe(1);
    expect(result.booking.availabilitySummary.bookedConflictCount).toBe(0);

    const history = await getQuoteHistory();
    const updated = history.quotes.find((quote) => quote.id === "q1");
    expect(updated.status).toBe("booked");
    expect(updated.booking.contractNumber).toBe(result.contractNumber);
    expect(updated.booking.contractConvertedAtISO).not.toBe("");
  });

  test("blocks conversion when a booked conflict already exists", async () => {
    seedQuotes([
      makeQuote({ id: "q1", quoteNumber: "Q-1" }),
      makeQuote({
        id: "q-booked",
        quoteNumber: "Q-BOOKED",
        status: "booked",
        booking: {
          bookedAtISO: "2026-03-10T12:30:00.000Z",
          contractNumber: "C-260310-12345"
        }
      })
    ]);

    await expect(
      convertQuoteToContract({
        quoteId: "q1",
        actorEmail: "sales@tonycatering.com"
      })
    ).rejects.toThrow(/already booked/i);
  });

  test("tracks booking confirmation lifecycle after contract conversion", async () => {
    seedQuotes([
      makeQuote({
        id: "q1",
        quoteNumber: "Q-1",
        status: "booked",
        booking: {
          bookedAtISO: "2026-03-10T12:30:00.000Z",
          contractNumber: "C-260310-12345",
          contractConvertedAtISO: "2026-03-10T12:30:00.000Z",
          confirmationStatus: "pending"
        }
      })
    ]);

    const sent = await updateQuoteBookingConfirmation({
      quoteId: "q1",
      confirmationStatus: "sent",
      actorEmail: "ops@tonycatering.com"
    });
    expect(sent.booking.confirmationStatus).toBe("sent");
    expect(sent.booking.confirmationSentAtISO).not.toBe("");
    expect(sent.booking.confirmedAtISO).toBe("");

    const confirmed = await updateQuoteBookingConfirmation({
      quoteId: "q1",
      confirmationStatus: "confirmed",
      actorEmail: "ops@tonycatering.com"
    });
    expect(confirmed.booking.confirmationStatus).toBe("confirmed");
    expect(confirmed.booking.confirmationSentAtISO).not.toBe("");
    expect(confirmed.booking.confirmedAtISO).not.toBe("");

    const history = await getQuoteHistory();
    const updated = history.quotes.find((quote) => quote.id === "q1");
    expect(updated.booking.confirmationStatus).toBe("confirmed");
    expect(updated.booking.confirmedAtISO).not.toBe("");
  });

  test("persists editable kitchen checkpoints for an event", async () => {
    seedQuotes([
      makeQuote({
        id: "q-checkpoints",
        quoteNumber: "Q-CHECKPOINTS",
        booking: {
          kitchenCheckpoints: []
        }
      })
    ]);

    const result = await updateQuoteKitchenCheckpoints({
      quoteId: "q-checkpoints",
      checkpoints: [
        { id: "prep-start", label: "Prep kickoff", minuteOffset: -165 },
        { id: "service-start", label: "Buffet opens", minuteOffset: 0 }
      ]
    });

    expect(result.ok).toBe(true);
    expect(result.checkpoints).toHaveLength(2);
    expect(result.checkpoints[0]).toEqual({
      id: "prep-start",
      label: "Prep kickoff",
      minuteOffset: -165
    });

    const history = await getQuoteHistory();
    const updated = history.quotes.find((quote) => quote.id === "q-checkpoints");
    expect(updated.booking.kitchenCheckpoints).toHaveLength(2);
    expect(updated.booking.kitchenCheckpoints[1]).toEqual({
      id: "service-start",
      label: "Buffet opens",
      minuteOffset: 0
    });
  });
});
