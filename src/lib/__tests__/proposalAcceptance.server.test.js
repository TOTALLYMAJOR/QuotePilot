import { createRequire } from "node:module";
import { describe, expect, test } from "vitest";

const require = createRequire(import.meta.url);
const {
  ACCEPTANCE_CONSENT_TEXT,
  ACCEPTANCE_CONSENT_VERSION,
  ProposalAcceptanceError,
  matchesAcceptanceRetry,
  moneyToMinor,
  planProposalAcceptance
} = require("../../../functions/proposalAcceptance.js");

const PORTAL_KEY = "portal-key-12345678901234567890";
const ISSUED_AT = "2026-08-05T18:00:00.000Z";
const ACCEPTED_AT = "2026-08-06T14:30:00.000Z";
const REVISION_ID = `v0003@${ISSUED_AT}`;

function fixtures() {
  const delivery = {
    revisionId: REVISION_ID,
    state: "provider_accepted",
    portalActivationState: "active",
    portalKey: PORTAL_KEY,
    portalIssuedAtISO: ISSUED_AT,
    providerAcceptedAtISO: ISSUED_AT
  };
  const quote = {
    organizationId: "org-one",
    portalKey: PORTAL_KEY,
    portalIssuedAtISO: ISSUED_AT,
    quoteNumber: "Q-260805-0003",
    status: "viewed",
    customer: { name: "Jordan Client", email: "JORDAN@example.com" },
    event: {
      name: "Reception",
      date: "2026-09-20",
      time: "17:30",
      hours: 5,
      guests: 125,
      venue: "The Hall"
    },
    selection: {
      packageName: "Classic",
      addonSnapshots: [{ name: "Dessert" }],
      rentalSnapshots: [{ name: "Linens" }],
      menuItemNames: ["Chicken", "Green Beans"]
    },
    totals: {
      base: 5000,
      addons: 250.25,
      rentals: 125,
      menu: 0,
      labor: 500,
      travel: 75,
      serviceFee: 357.52,
      tax: 504.62,
      total: 6812.39,
      deposit: 2043.72
    },
    lifecycle: { sentAtISO: ISSUED_AT, viewedAtISO: "2026-08-06T14:00:00.000Z" },
    workflow: { quoteDelivery: delivery }
  };
  const portal = {
    quoteId: "quote-1",
    organizationId: "org-one",
    portalKey: PORTAL_KEY,
    portalIssuedAtISO: ISSUED_AT,
    portalExpiresAtMs: new Date("2026-09-04T18:00:00.000Z").getTime(),
    status: "viewed",
    quoteNumber: "Q-260805-0003",
    customerName: "Jordan Client",
    customerEmail: "jordan@example.com",
    eventName: "Reception",
    eventDate: "2026-09-20",
    eventTime: "17:30",
    eventHours: 5,
    eventGuests: 125,
    eventStyle: "",
    venue: "The Hall",
    venueAddress: "",
    total: 6812.39,
    deposit: 2043.72,
    selection: {
      packageName: "Classic",
      addons: ["Dessert"],
      rentals: ["Linens"],
      menuItems: ["Chicken", "Green Beans"]
    },
    totals: {
      base: 5000,
      addons: 250.25,
      rentals: 125,
      menu: 0,
      labor: 500,
      travel: 75,
      serviceFee: 357.52,
      tax: 504.62,
      total: 6812.39,
      deposit: 2043.72
    },
    lifecycle: { sentAtISO: ISSUED_AT, viewedAtISO: "2026-08-06T14:00:00.000Z" },
    deliveryEvidence: delivery
  };
  return { quote, portal };
}

function plan(overrides = {}) {
  const { quote, portal } = fixtures();
  return planProposalAcceptance({
    quoteId: "quote-1",
    quote,
    portal,
    portalKey: PORTAL_KEY,
    signerName: "  Jordan   Client ",
    consentVersion: ACCEPTANCE_CONSENT_VERSION,
    expectedRevisionId: REVISION_ID,
    expectedPortalIssuedAtISO: ISSUED_AT,
    message: "Approved as presented.",
    acceptedAtISO: ACCEPTED_AT,
    receiptId: "acceptance-12345678-1234-1234-1234-123456789012",
    actor: { uid: "customer-1", email: "JORDAN@example.com" },
    ...overrides
  });
}

describe("server proposal acceptance planning", () => {
  test("builds matching quote, portal, and immutable receipt records", () => {
    const result = plan();

    expect(result.quotePatch).toMatchObject({
      status: "accepted",
      portalDecision: {
        decision: "accepted",
        submittedAtISO: ACCEPTED_AT
      },
      lifecycle: { acceptedAtISO: ACCEPTED_AT }
    });
    expect(result.portalPatch).toEqual(result.quotePatch);
    expect(result.acceptanceReceipt).toMatchObject({
      signerName: "Jordan Client",
      actor: {
        type: "customer_portal",
        uid: "customer-1",
        email: "jordan@example.com"
      },
      consentVersion: ACCEPTANCE_CONSENT_VERSION,
      consentText: ACCEPTANCE_CONSENT_TEXT,
      acceptedAtISO: ACCEPTED_AT,
      quoteRevisionId: REVISION_ID,
      portalIssuedAtISO: ISSUED_AT,
      currency: "USD",
      totalMinor: 681239,
      depositMinor: 204372
    });
    expect(result.acceptanceReceipt.snapshotSha256).toMatch(/^[a-f0-9]{64}$/);
    expect(result.receiptDocument.proposalSnapshot.totalsMinor.total).toBe(681239);
    expect(result.receiptDocument.portalKeyHash).toMatch(/^[a-f0-9]{64}$/);
  });

  test("stores all signed monetary values as integer minor units", () => {
    expect(moneyToMinor(10.01, "amount")).toBe(1001);
    expect(Number.isInteger(plan().receiptDocument.proposalSnapshot.totalsMinor.serviceFee)).toBe(true);
    expect(() => moneyToMinor(Number.NaN, "amount")).toThrow(ProposalAcceptanceError);
    expect(() => moneyToMinor(-1, "amount")).toThrow(/invalid/i);
  });

  test("fails closed for stale revisions, stale portal issuance, and expired links", () => {
    expect(() => plan({ expectedRevisionId: "v0002@stale" })).toThrowError(
      expect.objectContaining({ code: "aborted" })
    );
    expect(() => plan({ expectedPortalIssuedAtISO: "2026-08-01T00:00:00.000Z" })).toThrowError(
      expect.objectContaining({ code: "aborted" })
    );
    const { quote, portal } = fixtures();
    expect(() => plan({
      quote,
      portal: { ...portal, portalExpiresAtMs: new Date(ACCEPTED_AT).getTime() }
    })).toThrowError(expect.objectContaining({ code: "failed-precondition" }));
    expect(() => plan({
      quote,
      portal: { ...portal, total: 1 }
    })).toThrowError(expect.objectContaining({ code: "aborted" }));
  });

  test("rejects mismatched portal state, weak signer identity, and stale consent", () => {
    const { quote, portal } = fixtures();
    expect(() => plan({ portal: { ...portal, status: "sent" } })).toThrowError(
      expect.objectContaining({ code: "aborted" })
    );
    expect(() => plan({ signerName: " " })).toThrowError(
      expect.objectContaining({ code: "invalid-argument" })
    );
    expect(() => plan({ consentVersion: "proposal-acceptance-v0" })).toThrowError(
      expect.objectContaining({ code: "failed-precondition" })
    );
    expect(() => plan({ quote: { ...quote, status: "accepted" } })).toThrowError(
      expect.objectContaining({ code: "failed-precondition" })
    );
  });

  test("rejects a legacy delivered proposal with no menu selection", () => {
    const { quote, portal } = fixtures();
    expect(() => plan({
      quote: {
        ...quote,
        selection: { ...quote.selection, menuItemNames: [] }
      },
      portal: {
        ...portal,
        selection: { ...portal.selection, menuItems: [] }
      }
    })).toThrowError(expect.objectContaining({
      code: "failed-precondition",
      message: expect.stringMatching(/incomplete.*cannot be signed/i)
    }));
  });

  test("recognizes only an exact server-recorded retry", () => {
    const accepted = plan();
    const quote = {
      ...fixtures().quote,
      ...accepted.quotePatch
    };
    const portal = {
      ...fixtures().portal,
      ...accepted.portalPatch
    };
    const input = {
      quote,
      portal,
      signerName: "Jordan Client",
      consentVersion: ACCEPTANCE_CONSENT_VERSION,
      expectedRevisionId: REVISION_ID,
      expectedPortalIssuedAtISO: ISSUED_AT
    };
    expect(matchesAcceptanceRetry(input)).toBe(true);
    expect(matchesAcceptanceRetry({ ...input, signerName: "Someone Else" })).toBe(false);
    expect(matchesAcceptanceRetry({ ...input, expectedRevisionId: "v0004" })).toBe(false);
  });
});
