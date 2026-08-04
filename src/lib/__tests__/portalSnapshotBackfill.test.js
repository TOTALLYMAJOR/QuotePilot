import { describe, expect, test } from "vitest";
import {
  PORTAL_PROJECTION_VERSION,
  planPortalSnapshotBackfill,
  planPortalSnapshotBackfillBatch
} from "../../../scripts/portal-snapshot-backfill-plan.mjs";

const NOW = "2026-08-03T12:00:00.000Z";
const EXPIRES = "2030-01-01T00:00:00.000Z";

function quote(overrides = {}) {
  return {
    organizationId: "org-a",
    portalKey: "portal-safe-token-abcdefghijklmnopqrstuvwxyz",
    portalIssuedAtISO: "2026-08-01T00:00:00.000Z",
    portalExpiresAtISO: EXPIRES,
    quoteNumber: "Q-100",
    customer: { name: "Ada Customer", email: "ada@example.com" },
    event: {
      name: "Launch Dinner",
      date: "2027-06-10",
      time: "18:00",
      hours: 4,
      guests: 80,
      style: "plated",
      venue: "Market Hall",
      venueAddress: "100 Main St",
      dietaryRestrictions: "Vegetarian options"
    },
    totals: {
      base: 5000,
      addons: 300,
      rentals: 200,
      menu: 0,
      labor: 500,
      travel: 0,
      serviceFee: 600,
      tax: 462,
      total: 7062,
      deposit: 2118.6
    },
    selection: {
      packageName: "Signature",
      addonSnapshots: [{ name: "Coffee Service" }],
      rentalSnapshots: [{ name: "Linens" }],
      menuItemNames: ["Salad"]
    },
    quoteMeta: { brandName: "QuotePilot Catering" },
    status: "sent",
    expiresAtISO: EXPIRES,
    payment: { depositStatus: "unpaid", depositLink: "", depositConfirmedAtISO: "" },
    booking: { confirmationStatus: "pending", contractNumber: "" },
    portalDecision: {},
    lifecycle: { sentAtISO: "2026-08-01T00:00:00.000Z" },
    createdAtISO: "2026-08-01T00:00:00.000Z",
    updatedAtISO: "2026-08-02T00:00:00.000Z",
    ...overrides
  };
}

function portal(overrides = {}) {
  return {
    quoteId: "quote-a",
    organizationId: "org-a",
    portalKey: "portal-safe-token-abcdefghijklmnopqrstuvwxyz",
    portalExpiresAtISO: EXPIRES,
    portalExpiresAtMs: Date.parse(EXPIRES),
    status: "sent",
    ...overrides
  };
}

function plan(portalValue, quoteValue = quote()) {
  return planPortalSnapshotBackfill({
    portalId: "portal-safe-token-abcdefghijklmnopqrstuvwxyz",
    portal: portalValue,
    quoteId: "quote-a",
    quote: quoteValue,
    organizationId: "org-a",
    nowISO: NOW
  });
}

describe("portal snapshot backfill planner", () => {
  test("fills a legacy snapshot from the customer-safe canonical projection", () => {
    const result = plan(portal());

    expect(result.state).toBe("patch");
    expect(result.patch).toMatchObject({
      quoteNumber: "Q-100",
      customerName: "Ada Customer",
      eventName: "Launch Dinner",
      total: 7062,
      deposit: 2118.6,
      selection: {
        packageName: "Signature",
        addons: ["Coffee Service"],
        rentals: ["Linens"],
        menuItems: ["Salad"]
      },
      portalProjectionVersion: PORTAL_PROJECTION_VERSION,
      portalProjectionBackfilledAtISO: NOW
    });
  });

  test("refreshes display fields while preserving existing customer and commercial evidence", () => {
    const result = plan(portal({
      customerName: "Old Name",
      selection: { packageName: "Old Package" },
      payment: { depositStatus: "unpaid", providerReference: "preserve-me" },
      booking: { confirmationStatus: "pending", operatorNote: "preserve-me" },
      lifecycle: { openedAtISO: "2026-08-02T00:00:00.000Z" },
      customOperatorField: "preserve-me"
    }));

    expect(result.state).toBe("patch");
    expect(result.patch.customerName).toBe("Ada Customer");
    expect(result.patch.selection.packageName).toBe("Signature");
    expect(result.patch.payment).toEqual({ depositLink: "", depositConfirmedAtISO: "" });
    expect(result.patch.booking).toMatchObject({ bookedAtISO: "", contractNumber: "" });
    expect(result.patch).not.toHaveProperty("customOperatorField");
    expect(result.patch.lifecycle).toEqual({ sentAtISO: "2026-08-01T00:00:00.000Z" });
  });

  test("skips foreign tenant and mismatched portal identities", () => {
    expect(plan(portal({ organizationId: "org-b" })).state).toBe("skipped_foreign_organization");
    expect(plan(portal({ portalKey: "different-token" })).state).toBe("conflict_identity");
    expect(plan(portal({ quoteId: "quote-b" })).state).toBe("conflict_identity");
  });

  test("skips terminal decision, payment, and contract conflicts", () => {
    expect(plan(portal({ status: "accepted" }), quote({ status: "declined" })).state)
      .toBe("conflict_commercial_evidence");
    expect(plan(
      portal({ payment: { depositStatus: "paid" } }),
      quote({ payment: { depositStatus: "refunded" } })
    ).state).toBe("conflict_commercial_evidence");
    expect(plan(
      portal({ booking: { contractNumber: "CONTRACT-A" } }),
      quote({ booking: { contractNumber: "CONTRACT-B" } })
    ).state).toBe("conflict_commercial_evidence");
  });

  test("skips deleted, expired, and invalid-expiry portals", () => {
    expect(plan(portal({ status: "deleted" })).state).toBe("skipped_inactive");
    expect(plan(portal({
      portalExpiresAtISO: "2020-01-01T00:00:00.000Z",
      portalExpiresAtMs: Date.parse("2020-01-01T00:00:00.000Z")
    }), quote({ portalExpiresAtISO: "2020-01-01T00:00:00.000Z", expiresAtISO: "2020-01-01T00:00:00.000Z" })).state)
      .toBe("skipped_inactive");
    expect(plan(portal({ portalExpiresAtISO: "", portalExpiresAtMs: 0 }), quote({ portalExpiresAtISO: "", expiresAtISO: "" })).state)
      .toBe("skipped_invalid_expiry");
  });

  test("recognizes a snapshot that already carries the current projection", () => {
    const first = plan(portal());
    const current = { ...portal(), ...first.patch };
    const second = plan(current);

    expect(second).toEqual({ state: "already_current", patch: {} });
  });

  test("batch planning reports counts without mapping a foreign tenant", () => {
    const result = planPortalSnapshotBackfillBatch({
      portals: [
        { id: "portal-safe-token-abcdefghijklmnopqrstuvwxyz", data: portal() },
        { id: "portal-foreign-token-abcdefghijklmnopqrstuvwxyz", data: portal({
          quoteId: "quote-b",
          portalKey: "portal-foreign-token-abcdefghijklmnopqrstuvwxyz",
          organizationId: "org-b"
        }) },
        { id: "portal-orphan-token-abcdefghijklmnopqrstuvwxyz", data: portal({
          quoteId: "missing",
          portalKey: "portal-orphan-token-abcdefghijklmnopqrstuvwxyz"
        }) }
      ],
      quotes: [{ id: "quote-a", data: quote() }],
      organizationId: "org-a",
      nowISO: NOW
    });

    expect(result.entries).toHaveLength(1);
    expect(result.summary).toMatchObject({
      source: 3,
      matched: 1,
      wouldPatch: 1,
      skippedForeignOrganization: 1,
      skippedNoQuote: 1
    });
  });
});
