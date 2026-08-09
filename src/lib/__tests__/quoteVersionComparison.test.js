import { describe, expect, test } from "vitest";
import {
  QUOTE_VERSION_COMPARISON_EVIDENCE_BOUNDARY,
  QUOTE_VERSION_COMPARISON_SCHEMA_VERSION,
  compareImmutableQuoteVersions,
  normalizeImmutableQuoteVersion
} from "../quoteVersionComparison";

function isRecord(value) {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}

function merge(base, patch) {
  if (!isRecord(base) || !isRecord(patch)) return patch;
  const result = { ...base };
  Object.entries(patch).forEach(([key, value]) => {
    result[key] = isRecord(value) && isRecord(base[key])
      ? merge(base[key], value)
      : value;
  });
  return result;
}

function makeVersion(overrides = {}) {
  const base = {
    versionId: "v0001",
    quoteId: "quote-1",
    organizationId: "org-1",
    versionNumber: 1,
    createdAtISO: "2026-08-01T12:00:00.000Z",
    reason: "initial_quote_create",
    status: "draft",
    pricing: {
      authority: "server_authoritative",
      pricingVersion: "pricing-v1",
      lineItems: [
        {
          id: "package-classic",
          category: "package",
          name: "Classic package",
          pricingMode: "per_person",
          unitPrice: 40,
          quantity: 125,
          total: 5000
        },
        {
          id: "addon-coffee",
          category: "addon",
          name: "Coffee station",
          pricingMode: "per_person",
          unitPrice: 3,
          quantity: 125,
          total: 375
        }
      ],
      fees: {
        serviceFee: 860
      },
      tax: {
        amount: 525
      },
      discountTotal: 0,
      deposit: {
        amount: 2028
      },
      subtotal: 5375,
      grandTotal: 6760
    },
    snapshot: {
      id: "quote-1",
      organizationId: "org-1",
      status: "draft",
      expiresAtISO: "2026-08-31T12:00:00.000Z",
      customer: {
        name: "Henderson Group",
        organization: "Henderson Industries",
        email: "events@henderson.example",
        phone: "205-555-0144"
      },
      event: {
        name: "Corporate picnic",
        date: "2026-09-12",
        time: "12:00",
        hours: 5,
        venue: "Oak Meadow",
        venueAddress: "100 Meadow Lane",
        guests: 125,
        style: "Buffet",
        dietaryRestrictions: "Vegetarian meals for 10 guests",
        servers: 6,
        chefs: 2,
        bartenders: 1
      },
      selection: {
        packageId: "classic",
        packageName: "Classic",
        milesRT: 24,
        payMethod: "card",
        menuItemsSnapshot: [
          { id: "pulled-pork", name: "Pulled pork" },
          { id: "garden-salad", name: "Garden salad" }
        ],
        addonSnapshots: [
          { id: "coffee", name: "Coffee station" },
          { id: "dessert", name: "Dessert bar" }
        ],
        rentalSnapshots: [
          { id: "linens", name: "Linens" }
        ],
        packageInclusions: {
          menuItems: [{ id: "tea", name: "Iced tea" }],
          addons: [{ id: "setup", name: "Standard setup" }],
          rentals: [{ id: "chafers", name: "Chafing sets" }]
        },
        menuItemQuantities: {
          "garden-salad": 1,
          "pulled-pork": 1
        },
        addonQuantities: {
          coffee: 125,
          dessert: 125
        },
        rentalQuantities: {
          linens: 15
        }
      },
      quoteMeta: {
        quoteValidityDays: 30,
        depositNotice: "30% deposit required to hold the date.",
        includeDisposables: true,
        disposablesNote: "Compostable serviceware included."
      },
      totals: {
        total: 6760,
        deposit: 2028
      },
      payment: {
        depositStatus: "unpaid"
      },
      booking: {
        confirmationStatus: "pending"
      },
      workflow: {},
      portalDecision: {},
      lifecycle: {
        draftAtISO: "2026-08-01T12:00:00.000Z"
      }
    }
  };
  return merge(base, overrides);
}

function comparisonField(comparison, fieldId) {
  return comparison.sections.flatMap((section) => section.fields)
    .find((field) => field.id === fieldId);
}

function normalizedField(normalized, fieldId) {
  return normalized.sections.flatMap((section) => section.fields)
    .find((field) => field.id === fieldId)?.value;
}

function freezeDeep(value) {
  if (!value || typeof value !== "object" || Object.isFrozen(value)) return value;
  Object.freeze(value);
  Object.values(value).forEach(freezeDeep);
  return value;
}

describe("immutable quote-version comparison", () => {
  test("compares normalized scope, schedule, pricing, and terms without recalculation", () => {
    const before = makeVersion();
    const after = makeVersion({
      versionId: "v0002",
      versionNumber: 2,
      createdAtISO: "2026-08-02T12:00:00.000Z",
      reason: "quote_edit",
      pricing: {
        lineItems: [
          {
            id: "package-premium",
            category: "package",
            name: "Premium package",
            pricingMode: "per_person",
            unitPrice: 50,
            quantity: 175,
            total: 8750
          },
          {
            id: "addon-coffee",
            category: "addon",
            name: "Coffee station",
            pricingMode: "per_person",
            unitPrice: 3,
            quantity: 175,
            total: 525
          }
        ],
        subtotal: 9275,
        fees: { serviceFee: 1484 },
        tax: { amount: 906 },
        grandTotal: 11665,
        deposit: { amount: 3499.5 }
      },
      snapshot: {
        event: {
          guests: 175,
          date: "2026-09-19",
          time: "13:00"
        },
        selection: {
          packageId: "premium",
          packageName: "Premium",
          menuItemsSnapshot: [
            { id: "brisket", name: "Smoked brisket" },
            { id: "garden-salad", name: "Garden salad" }
          ]
        },
        quoteMeta: {
          depositNotice: "30% deposit due after proposal acceptance."
        },
        totals: {
          total: 999999,
          deposit: 999999
        }
      }
    });

    const comparison = compareImmutableQuoteVersions(before, after);

    expect(comparison).toMatchObject({
      schemaVersion: QUOTE_VERSION_COMPARISON_SCHEMA_VERSION,
      advisory: true,
      comparisonState: "complete",
      equivalence: "different",
      issues: []
    });
    expect(comparison.evidenceBoundary).toBe(QUOTE_VERSION_COMPARISON_EVIDENCE_BOUNDARY);
    expect(comparison.sections.map((section) => section.id)).toEqual([
      "scope",
      "schedule",
      "pricing",
      "terms"
    ]);
    expect(comparisonField(comparison, "scope.guestCount")).toMatchObject({
      label: "Guest count",
      before: { state: "known", value: 125 },
      after: { state: "known", value: 175 },
      comparison: "changed"
    });
    expect(comparisonField(comparison, "schedule.eventDate").comparison).toBe("changed");
    expect(comparisonField(comparison, "pricing.total")).toMatchObject({
      before: { value: 6760 },
      after: { value: 11665 },
      comparison: "changed"
    });
    expect(comparisonField(comparison, "terms.depositNotice").comparison).toBe("changed");
    expect(comparisonField(comparison, "pricing.authority").comparison).toBe("unchanged");
    expect(comparison.summary.changedFieldCount).toBeGreaterThan(0);
  });

  test("represents unknown fields and unavailable source groups explicitly", () => {
    const version = makeVersion({
      pricing: null,
      snapshot: {
        event: {
          guests: undefined,
          hours: "not-known"
        },
        selection: {
          addonSnapshots: [],
          addonQuantities: {}
        },
        quoteMeta: {
          includeDisposables: false
        }
      }
    });

    const normalized = normalizeImmutableQuoteVersion(version);

    expect(normalized.availability).toEqual({ state: "available", issues: [] });
    expect(normalizedField(normalized, "scope.guestCount")).toMatchObject({
      state: "unknown",
      value: null,
      reason: "not_recorded"
    });
    expect(normalizedField(normalized, "schedule.durationHours")).toMatchObject({
      state: "unknown",
      value: null,
      reason: "invalid_value"
    });
    expect(normalizedField(normalized, "scope.addons")).toMatchObject({
      state: "known",
      value: []
    });
    expect(normalizedField(normalized, "scope.addonQuantities")).toMatchObject({
      state: "known",
      value: {}
    });
    expect(normalizedField(normalized, "terms.includeDisposables")).toMatchObject({
      state: "known",
      value: false
    });
    expect(normalizedField(normalized, "pricing.total")).toMatchObject({
      state: "unavailable",
      value: null,
      reason: "source_unavailable"
    });
  });

  test("ignores lifecycle, portal, payment, booking, provider, and mutable totals evidence", () => {
    const before = makeVersion();
    const after = makeVersion({
      versionId: "v0002",
      versionNumber: 2,
      status: "accepted",
      deliveryEvidence: {
        state: "provider_accepted",
        providerAcceptedAtISO: "2026-08-03T12:00:00.000Z"
      },
      acceptanceReceipt: { signerName: "Customer" },
      snapshot: {
        status: "booked",
        totals: { total: 999999, deposit: 999999 },
        payment: {
          depositStatus: "paid",
          depositConfirmedAtISO: "2026-08-03T12:00:00.000Z"
        },
        booking: {
          confirmationStatus: "confirmed",
          contractNumber: "C-100"
        },
        workflow: { attention: "urgent" },
        portalDecision: { decision: "accepted" },
        lifecycle: {
          acceptedAtISO: "2026-08-03T12:00:00.000Z",
          bookedAtISO: "2026-08-04T12:00:00.000Z"
        }
      }
    });

    const comparison = compareImmutableQuoteVersions(before, after);

    expect(comparison.comparisonState).toBe("complete");
    expect(comparison.equivalence).toBe("equivalent");
    expect(comparison.summary.changedFieldCount).toBe(0);
    expect(comparison.sections.flatMap((section) => section.fields).map((field) => field.id))
      .not.toEqual(expect.arrayContaining([
        "status",
        "payment",
        "booking",
        "deliveryEvidence",
        "portalDecision",
        "acceptanceReceipt"
      ]));
  });

  test("normalizes unordered selections, quantities, and pricing lines deterministically", () => {
    const before = makeVersion();
    const after = makeVersion({
      versionId: "v0002",
      versionNumber: 2,
      pricing: {
        lineItems: [...before.pricing.lineItems].reverse()
      },
      snapshot: {
        selection: {
          menuItemsSnapshot: [...before.snapshot.selection.menuItemsSnapshot].reverse(),
          addonSnapshots: [...before.snapshot.selection.addonSnapshots].reverse(),
          packageInclusions: {
            ...before.snapshot.selection.packageInclusions,
            menuItems: [...before.snapshot.selection.packageInclusions.menuItems].reverse()
          },
          menuItemQuantities: {
            "pulled-pork": 1,
            "garden-salad": 1
          },
          addonQuantities: {
            dessert: 125,
            coffee: 125
          }
        }
      }
    });

    const comparison = compareImmutableQuoteVersions(before, after);

    expect(comparison.comparisonState).toBe("complete");
    expect(comparison.equivalence).toBe("equivalent");
    expect(comparison.summary.changedFieldCount).toBe(0);
  });

  test("fails closed for cross-quote and legacy-synthetic comparisons", () => {
    const crossQuote = compareImmutableQuoteVersions(
      makeVersion(),
      makeVersion({
        quoteId: "quote-2",
        snapshot: { id: "quote-2" },
        versionId: "v0002",
        versionNumber: 2
      })
    );
    expect(crossQuote).toMatchObject({
      comparisonState: "unavailable",
      equivalence: "undetermined"
    });
    expect(crossQuote.issues).toContain("quote_identity_mismatch");
    expect(crossQuote.summary.changedFieldCount).toBe(0);
    expect(crossQuote.summary.unavailableFieldCount).toBe(crossQuote.summary.totalFieldCount);

    const legacy = normalizeImmutableQuoteVersion(makeVersion({ legacySynthetic: true }));
    expect(legacy.availability.state).toBe("unavailable");
    expect(legacy.availability.issues).toContain("legacy_synthetic_version");
  });

  test("is pure, deterministic, and returns a deeply immutable DTO", () => {
    const before = freezeDeep(makeVersion());
    const after = freezeDeep(makeVersion({
      versionId: "v0002",
      versionNumber: 2,
      snapshot: { event: { guests: 130 } }
    }));
    const beforeBytes = JSON.stringify(before);
    const afterBytes = JSON.stringify(after);

    const first = compareImmutableQuoteVersions(before, after);
    const second = compareImmutableQuoteVersions(before, after);

    expect(first).toEqual(second);
    expect(JSON.stringify(before)).toBe(beforeBytes);
    expect(JSON.stringify(after)).toBe(afterBytes);
    expect(Object.isFrozen(first)).toBe(true);
    expect(Object.isFrozen(first.sections)).toBe(true);
    expect(Object.isFrozen(first.sections[0].fields[0].before)).toBe(true);
  });
});
