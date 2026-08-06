import { createRequire } from "node:module";
import { describe, expect, test } from "vitest";

const require = createRequire(import.meta.url);
const {
  ContractWorkflowError,
  planContractConversion
} = require("../../../functions/contractWorkflow.js");

function acceptedQuote(overrides = {}) {
  return {
    status: "accepted",
    event: {
      date: "2026-09-12",
      time: "17:00",
      hours: 4,
      venue: "Lakeside Hall",
      guests: 120
    },
    booking: {},
    selection: {
      menuItems: ["seasonal-salad"]
    },
    lifecycle: {
      acceptedAtISO: "2026-08-03T12:00:00.000Z"
    },
    ...overrides
  };
}

describe("server contract conversion planning", () => {
  test("derives contract audit fields and soft capacity evidence from server input", () => {
    const result = planContractConversion({
      quoteId: "quote-target",
      quote: acceptedQuote(),
      peerQuotes: [{
        id: "accepted-peer",
        quoteNumber: "Q-PEER",
        status: "accepted",
        event: {
          date: "2026-09-12",
          time: "18:00",
          hours: 2,
          venue: " lakeside   hall ",
          guests: 100
        }
      }],
      actorEmail: "ADMIN@EXAMPLE.COM",
      nowISO: "2026-08-03T18:00:00.000Z",
      contractNumber: "C-260803-12345",
      capacityLimit: 200
    });

    expect(result).toMatchObject({
      status: "booked",
      contractNumber: "C-260803-12345",
      booking: {
        bookedByEmail: "admin@example.com",
        contractConvertedByEmail: "admin@example.com",
        availabilitySummary: {
          conflictCount: 1,
          acceptedConflictCount: 1,
          capacityExceeded: true,
          sameVenueLoad: 220,
          capacityLimit: 200
        }
      },
      availability: {
        hasBlockingConflict: false,
        capacityExceeded: true
      }
    });
  });

  test("blocks an overlapping booked contract at the same venue", () => {
    expect(() => planContractConversion({
      quoteId: "quote-target",
      quote: acceptedQuote(),
      peerQuotes: [{
        id: "booked-peer",
        quoteNumber: "Q-BOOKED",
        status: "booked",
        event: {
          date: "2026-09-12",
          time: "16:00",
          hours: 3,
          venue: "Lakeside Hall",
          guests: 80
        }
      }],
      actorEmail: "admin@example.com",
      nowISO: "2026-08-03T18:00:00.000Z",
      contractNumber: "C-260803-12345"
    })).toThrowError(expect.objectContaining({
      name: "ContractWorkflowError",
      code: "failed-precondition",
      message: expect.stringContaining("Q-BOOKED")
    }));
  });

  test("fails closed for non-accepted or already converted quotes", () => {
    expect(() => planContractConversion({
      quoteId: "quote-target",
      quote: acceptedQuote({ status: "sent" }),
      actorEmail: "admin@example.com",
      nowISO: "2026-08-03T18:00:00.000Z",
      contractNumber: "C-260803-12345"
    })).toThrow(ContractWorkflowError);

    expect(() => planContractConversion({
      quoteId: "quote-target",
      quote: acceptedQuote({
        status: "booked",
        booking: { contractNumber: "C-EXISTING" }
      }),
      actorEmail: "admin@example.com",
      nowISO: "2026-08-03T18:00:00.000Z",
      contractNumber: "C-260803-12345"
    })).toThrowError(expect.objectContaining({ code: "already-exists" }));
  });

  test("blocks contract conversion for a legacy accepted quote with no menu selection", () => {
    expect(() => planContractConversion({
      quoteId: "quote-target",
      quote: acceptedQuote({ selection: { menuItems: [] } }),
      actorEmail: "admin@example.com",
      nowISO: "2026-08-03T18:00:00.000Z",
      contractNumber: "C-260803-12345"
    })).toThrowError(expect.objectContaining({
      code: "failed-precondition",
      message: expect.stringMatching(/no menu selection/i)
    }));
  });
});
