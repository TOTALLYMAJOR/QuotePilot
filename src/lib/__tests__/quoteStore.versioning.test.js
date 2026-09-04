import { afterEach, beforeEach, describe, expect, test, vi } from "vitest";

vi.mock("../firebase", () => ({
  db: null,
  firebaseReady: false
}));

import {
  deleteQuote,
  duplicateQuote,
  ensureLegacyQuoteCompatibility,
  getActiveQuoteVersion,
  getQuoteHistory,
  resolveQuotePricingSnapshot,
  resolveQuoteVersionMetadata,
  reopenQuote,
  submitQuote,
  updateQuote,
  updateQuoteStatus
} from "../quoteStore";

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

function makeQuote(overrides = {}) {
  const nowISO = "2026-03-10T12:00:00.000Z";
  const base = {
    id: "quote-1",
    quoteNumber: "Q-260310-1200-11111",
    status: "accepted",
    createdAtISO: nowISO,
    updatedAtISO: nowISO,
    expiresAtISO: "2026-04-09T12:00:00.000Z",
    deletedAtISO: "",
    eventTypeId: "wedding",
    customerNameKey: "client one",
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
    selection: {
      menuItems: [],
      menuItemNames: [],
      menuItemDetails: []
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
    selection: {
      ...base.selection,
      ...(overrides.selection || {})
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

describe("quoteStore versioning and delete behavior", () => {
  beforeEach(() => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-03-20T12:00:00.000Z"));
    vi.stubGlobal("localStorage", createStorageMock());
  });

  afterEach(() => {
    vi.useRealTimers();
    vi.unstubAllGlobals();
  });

  test("hard deletes a quote and removes local history entries", async () => {
    seedQuotes([makeQuote({ id: "q1" })]);
    localStorage.setItem(
      LOCAL_QUOTE_HISTORY_KEY,
      JSON.stringify([
        {
          id: "history-q1-v1",
          quoteId: "q1",
          versionId: "v0001",
          versionNumber: 1,
          snapshot: {
            id: "q1",
            status: "accepted"
          }
        },
        {
          id: "history-q2-v1",
          quoteId: "q2",
          versionId: "v0001",
          versionNumber: 1,
          snapshot: {
            id: "q2",
            status: "draft"
          }
        }
      ])
    );

    await deleteQuote("q1");
    const history = JSON.parse(localStorage.getItem(LOCAL_QUOTE_HISTORY_KEY) || "[]");
    expect(history).toHaveLength(1);
    expect(history[0].quoteId).toBe("q2");

    const quotes = await getQuoteHistory();
    const updated = quotes.quotes.find((quote) => quote.id === "q1");
    expect(updated).toBeUndefined();
  });

  test("captures a version before status updates", async () => {
    seedQuotes([makeQuote({ id: "q2", status: "draft", lifecycle: { draftAtISO: "2026-03-10T12:00:00.000Z" } })]);

    await updateQuoteStatus("q2", "sent");

    const history = JSON.parse(localStorage.getItem(LOCAL_QUOTE_HISTORY_KEY) || "[]");
    expect(history.length).toBe(1);
    expect(history[0].snapshot.status).toBe("draft");

    const quotes = await getQuoteHistory();
    const updated = quotes.quotes.find((quote) => quote.id === "q2");
    expect(updated.status).toBe("sent");
  });

  test("submitQuote creates version 1 and preserves authoritative pricing snapshot", async () => {
    const result = await submitQuote({
      form: {
        name: "Client Seed",
        email: "seed@example.com",
        phone: "205-555-0199",
        clientOrg: "Seed Org",
        eventName: "Seed Event",
        date: "2026-05-02",
        time: "18:00",
        venue: "Seed Hall",
        venueAddress: "123 Seed St",
        guests: 80,
        hours: 4,
        bartenders: 1,
        style: "Buffet",
        pkg: "classic",
        addons: [],
        rentals: [],
        menuItems: ["seasonal-salad"],
        addonQuantities: {},
        rentalQuantities: {},
        menuItemQuantities: { "seasonal-salad": 1 },
        milesRT: 10,
        payMethod: "card",
        eventTemplateId: "custom",
        eventTypeId: "wedding",
        taxRegion: "local",
        seasonProfileId: "standard",
        serverRateMixCsv: "24,26",
        chefRateMixCsv: "50,55",
        includeDisposables: true,
        depositLink: ""
      },
      totals: {
        selectedPkg: { id: "classic", name: "Classic" },
        base: 9999,
        addons: 0,
        rentals: 0,
        menu: 0,
        labor: 0,
        bartenderLabor: 0,
        travel: 0,
        serviceFee: 0,
        tax: 0,
        total: 9999,
        deposit: 1000,
        serviceFeePctApplied: 0,
        taxRateApplied: 0,
        taxRegionId: "local",
        taxRegionName: "Local",
        seasonProfileId: "standard",
        seasonProfileName: "Standard",
        packageMultiplier: 1,
        addonMultiplier: 1,
        rentalMultiplier: 1
      },
      pricingSnapshot: {
        authority: "server_authoritative",
        pricingVersion: "pricing-v1",
        calculatedAt: "2026-03-20T00:00:00.000Z",
        inputs: {},
        lineItems: [{ id: "server-line", category: "package", pricingMode: "per_event", total: 4321 }],
        fees: { labor: 50, travel: 10, bartenderLabor: 0, serviceFee: 100 },
        tax: { rate: 0.08, amount: 80, regionId: "local", regionName: "Local" },
        discountTotal: 0,
        deposit: { pct: 0.3, amount: 1296.3 },
        subtotal: 4231,
        grandTotal: 4321,
        rulesSnapshot: {
          pricingSettingsVersion: 5
        }
      },
      catalogSource: "firebase-org",
      settings: {
        quoteValidityDays: 30,
        defaultTaxRegion: "local",
        defaultSeasonProfile: "standard",
        depositPct: 0.3,
        pricingSettingsVersion: 5,
        pricingSettingsUpdatedAtISO: "2026-03-20T00:00:00.000Z"
      },
      catalog: {
        packages: [{ id: "classic", name: "Classic", ppp: 20 }],
        addons: [],
        rentals: []
      },
      ownerUid: "staff-seed",
      ownerEmail: "staff-seed@example.com",
      organizationId: "org-seed"
    });

    const history = JSON.parse(localStorage.getItem(LOCAL_QUOTE_HISTORY_KEY) || "[]")
      .filter((item) => item.quoteId === result.id);
    expect(history.length).toBe(1);
    expect(history[0].versionId).toBe("v0001");
    expect(history[0].pricing.authority).toBe("server_authoritative");
    expect(history[0].pricing.grandTotal).toBe(4321);
    expect(history[0].pricing.commercialSnapshot).toMatchObject({
      package: {
        id: "classic",
        missingReason: "cost_missing"
      }
    });

    const quotes = await getQuoteHistory();
    const created = quotes.quotes.find((quote) => quote.id === result.id);
    expect(created).toBeTruthy();
    expect(created.activeVersionId).toBe("v0001");
    expect(created.latestVersionNumber).toBe(1);
    expect(created.pricing.authority).toBe("server_authoritative");
    expect(created.pricing.grandTotal).toBe(4321);
    expect(created.pricing.commercialSnapshot).toMatchObject({
      package: {
        id: "classic",
        missingReason: "cost_missing"
      }
    });
    expect(created.selection.serverRateMixCsv).toBe("24,26");
    expect(created.selection.chefRateMixCsv).toBe("50,55");
  });

  test("updates an existing quote with versioning and locked labor-rate snapshot", async () => {
    seedQuotes([
      makeQuote({
        id: "q3",
        status: "sent",
        activeVersionId: "v0001",
        latestVersionNumber: 1,
        selection: {
          menuItems: ["smoked-ribs"],
          menuItemNames: ["Smoked Ribs"],
          menuItemDetails: [{ id: "smoked-ribs", name: "Smoked Ribs", price: 12 }]
        }
      })
    ]);

    await updateQuote({
      quoteId: "q3",
      form: {
        name: "Client One",
        email: "client-one@example.com",
        phone: "205-555-0101",
        clientOrg: "Client Org",
        eventName: "Spring Banquet",
        date: "2026-04-20",
        time: "18:00",
        venue: "Pine Hall",
        venueAddress: "123 Pine Ave",
        guests: 120,
        hours: 4,
        bartenders: 2,
        style: "Plated",
        pkg: "classic",
        addons: [],
        rentals: [],
        menuItems: ["smoked-ribs"],
        milesRT: 16,
        payMethod: "card",
        eventTemplateId: "custom",
        eventTypeId: "wedding",
        taxRegion: "local",
        seasonProfileId: "standard",
        includeDisposables: true,
        depositLink: "",
        bartenderRateTypeId: "premium",
        staffingRateTypeId: "senior",
        bartenderRateOverride: 42,
        serverRateOverride: 31,
        serverRateMixCsv: "30,31,32",
        chefRateMixCsv: "52,53,54",
        chefRateOverride: 53
      },
      totals: {
        selectedPkg: { id: "classic", name: "Classic" },
        base: 2160,
        addons: 0,
        rentals: 0,
        menu: 240,
        labor: 1800,
        bartenderLabor: 336,
        bartenderRateApplied: 42,
        serverRateApplied: 31,
        chefRateApplied: 53,
        bartenderRateTypeId: "premium",
        bartenderRateTypeName: "Premium Bartender",
        staffingRateTypeId: "senior",
        staffingRateTypeName: "Senior Staffing",
        travel: 12,
        serviceFee: 631.2,
        tax: 303.12,
        total: 5146.32,
        deposit: 1543.896,
        serviceFeePctApplied: 0.15,
        taxRateApplied: 0.06,
        taxRegionId: "local",
        taxRegionName: "Local",
        seasonProfileId: "standard",
        seasonProfileName: "Standard",
        packageMultiplier: 1,
        addonMultiplier: 1,
        rentalMultiplier: 1
      },
      catalogSource: "local",
      settings: {
        quoteValidityDays: 30,
        defaultTaxRegion: "local",
        defaultSeasonProfile: "auto"
      }
    });

    const history = JSON.parse(localStorage.getItem(LOCAL_QUOTE_HISTORY_KEY) || "[]");
    expect(history.length).toBe(1);
    expect(history[0].quoteId).toBe("q3");
    expect(history[0].snapshot.status).toBe("draft");
    expect(history[0].versionId).toBe("v0002");

    const quotes = await getQuoteHistory();
    const updated = quotes.quotes.find((quote) => quote.id === "q3");
    expect(updated.status).toBe("draft");
    expect(updated.activeVersionId).toBe("v0002");
    expect(updated.latestVersionNumber).toBe(2);
    expect(updated.selection.laborRateSnapshot.bartenderRateApplied).toBe(42);
    expect(updated.selection.laborRateSnapshot.serverRateApplied).toBe(31);
    expect(updated.selection.laborRateSnapshot.chefRateApplied).toBe(53);
    expect(updated.selection.serverRateMixCsv).toBe("30,31,32");
    expect(updated.selection.chefRateMixCsv).toBe("52,53,54");
    expect(updated.totals.bartenderRateApplied).toBe(42);
    expect(updated.totals.serverRateApplied).toBe(31);
    expect(updated.totals.chefRateApplied).toBe(53);
  });

  test("editing creates version 2 and keeps version 1 snapshot immutable", async () => {
    seedQuotes([
      makeQuote({
        id: "q-edit-immutability",
        status: "sent",
        activeVersionId: "v0001",
        latestVersionNumber: 1,
        totals: {
          total: 3000,
          deposit: 900
        }
      })
    ]);
    localStorage.setItem(
      LOCAL_QUOTE_HISTORY_KEY,
      JSON.stringify([
        {
          id: "history-v0001",
          quoteId: "q-edit-immutability",
          versionId: "v0001",
          versionNumber: 1,
          reason: "initial_quote_create",
          timestamp: "2026-03-10T12:00:00.000Z",
          snapshot: {
            id: "q-edit-immutability",
            status: "sent",
            totals: {
              total: 3000,
              deposit: 900
            }
          }
        }
      ])
    );

    await updateQuote({
      quoteId: "q-edit-immutability",
      form: {
        name: "Client One",
        email: "client-one@example.com",
        phone: "205-555-0101",
        clientOrg: "Client Org",
        eventName: "Spring Banquet Updated",
        date: "2026-04-20",
        time: "18:00",
        venue: "Pine Hall",
        venueAddress: "123 Pine Ave",
        guests: 120,
        hours: 4,
        bartenders: 2,
        style: "Plated",
        pkg: "classic",
        addons: [],
        rentals: [],
        menuItems: ["seasonal-salad"],
        addonQuantities: {},
        rentalQuantities: {},
        menuItemQuantities: { "seasonal-salad": 1 },
        milesRT: 16,
        payMethod: "card",
        eventTemplateId: "custom",
        eventTypeId: "wedding",
        taxRegion: "local",
        seasonProfileId: "standard",
        includeDisposables: true,
        depositLink: "",
        bartenderRateTypeId: "premium",
        staffingRateTypeId: "senior",
        bartenderRateOverride: 42,
        serverRateOverride: 31,
        chefRateOverride: 53
      },
      totals: {
        selectedPkg: { id: "classic", name: "Classic" },
        base: 2000,
        addons: 0,
        rentals: 0,
        menu: 0,
        labor: 900,
        bartenderLabor: 200,
        bartenderRateApplied: 42,
        serverRateApplied: 31,
        chefRateApplied: 53,
        bartenderRateTypeId: "premium",
        bartenderRateTypeName: "Premium Bartender",
        staffingRateTypeId: "senior",
        staffingRateTypeName: "Senior Staffing",
        travel: 20,
        serviceFee: 438,
        tax: 233.8,
        total: 3591.8,
        deposit: 1077.54,
        serviceFeePctApplied: 0.15,
        taxRateApplied: 0.08,
        taxRegionId: "local",
        taxRegionName: "Local",
        seasonProfileId: "standard",
        seasonProfileName: "Standard",
        packageMultiplier: 1,
        addonMultiplier: 1,
        rentalMultiplier: 1
      },
      catalogSource: "local",
      settings: {
        quoteValidityDays: 30,
        defaultTaxRegion: "local",
        defaultSeasonProfile: "auto"
      }
    });

    const history = JSON.parse(localStorage.getItem(LOCAL_QUOTE_HISTORY_KEY) || "[]")
      .filter((item) => item.quoteId === "q-edit-immutability");
    expect(history.length).toBe(2);
    expect(history[0].versionId).toBe("v0002");
    expect(history[1].versionId).toBe("v0001");
    expect(history[1].snapshot.totals.total).toBe(3000);
    expect(history[1].snapshot.status).toBe("sent");

    const quotes = await getQuoteHistory();
    const updated = quotes.quotes.find((quote) => quote.id === "q-edit-immutability");
    expect(updated.activeVersionId).toBe("v0002");
    expect(updated.latestVersionNumber).toBe(2);
    expect(updated.totals.total).toBeCloseTo(3591.8, 6);
  });

  test("reopen restores active version snapshot for deleted quotes", async () => {
    seedQuotes([
      makeQuote({
        id: "q4",
        status: "deleted",
        deletedAtISO: "2026-03-11T12:00:00.000Z",
        lifecycle: {
          acceptedAtISO: "",
          draftAtISO: "2026-03-10T12:00:00.000Z",
          deletedAtISO: "2026-03-11T12:00:00.000Z"
        },
        activeVersionId: "v0002",
        latestVersionNumber: 3,
        ownerUid: "staff-1",
        ownerEmail: "staff@example.com",
        customer: {
          name: "Deleted Record Name",
          email: "deleted@example.com"
        },
        totals: {
          total: 9999,
          deposit: 1000
        },
        selection: {
          packageId: "wrong-package"
        }
      })
    ]);
    localStorage.setItem(
      LOCAL_QUOTE_HISTORY_KEY,
      JSON.stringify([
        {
          id: "history-v0003",
          quoteId: "q4",
          versionId: "v0003",
          versionNumber: 3,
          reason: "delete_quote",
          timestamp: "2026-03-11T12:00:00.000Z",
          snapshot: {
            id: "q4",
            status: "deleted",
            customer: {
              name: "Deleted Record Name",
              email: "deleted@example.com"
            },
            totals: {
              total: 9999,
              deposit: 1000
            },
            selection: {
              packageId: "wrong-package"
            }
          }
        },
        {
          id: "history-v0002",
          quoteId: "q4",
          versionId: "v0002",
          versionNumber: 2,
          reason: "quote_edit",
          timestamp: "2026-03-10T12:00:00.000Z",
          snapshot: {
            id: "q4",
            status: "draft",
            customer: {
              name: "Restored Snapshot Customer",
              email: "restored@example.com"
            },
            customerEmailKey: "restored@example.com",
            customerNameKey: "restored snapshot customer",
            eventTypeId: "wedding",
            ownerUid: "staff-1",
            ownerEmail: "staff@example.com",
            event: {
              name: "Restored Event",
              date: "2026-04-22",
              time: "17:00",
              venue: "Grand Hall",
              guests: 110,
              hours: 5
            },
            selection: {
              packageId: "classic",
              addons: ["dessert"],
              rentals: [],
              menuItems: [],
              menuItemNames: []
            },
            payment: {
              depositLink: "",
              depositStatus: "unpaid",
              depositConfirmedAtISO: ""
            },
            booking: {
              confirmationStatus: "pending"
            },
            totals: {
              total: 4200,
              deposit: 1260
            },
            pricing: {
              authority: "legacy_derived",
              pricingVersion: "pricing-v1",
              calculatedAt: "2026-03-10T12:00:00.000Z",
              inputs: {},
              lineItems: [],
              fees: {},
              tax: {
                amount: 0,
                rate: 0,
                regionId: "",
                regionName: ""
              },
              discountTotal: 0,
              deposit: {
                amount: 1260,
                rate: 0
              },
              subtotal: 4200,
              grandTotal: 4200,
              rulesSnapshot: {}
            },
            quoteMeta: {
              quotePreparedBy: "Staff"
            },
            source: "local",
            expiresAtISO: "2026-04-09T12:00:00.000Z"
          }
        }
      ])
    );

    await reopenQuote("q4");

    const quotes = await getQuoteHistory();
    const updated = quotes.quotes.find((quote) => quote.id === "q4");
    expect(updated.status).toBe("draft");
    expect(updated.deletedAtISO).toBe("");
    expect(updated.customer.name).toBe("Restored Snapshot Customer");
    expect(updated.customer.email).toBe("restored@example.com");
    expect(updated.totals.total).toBe(4200);
    expect(updated.selection.packageId).toBe("classic");
  });

  test("resolves legacy pricing snapshot when quote.pricing is missing", () => {
    const legacyQuote = makeQuote({
      id: "q-legacy-pricing",
      totals: {
        base: 2100,
        addons: 300,
        rentals: 120,
        menu: 180,
        labor: 760,
        travel: 20,
        serviceFee: 626.4,
        tax: 332.64,
        total: 4439.04,
        deposit: 1331.712,
        serviceFeePctApplied: 0.18,
        taxRateApplied: 0.08,
        taxRegionId: "local",
        taxRegionName: "Local",
        seasonProfileId: "standard",
        seasonProfileName: "Standard"
      },
      selection: {
        packageId: "classic",
        packageName: "Classic",
        taxRegion: "local",
        seasonProfileId: "standard"
      }
    });

    const snapshot = resolveQuotePricingSnapshot(legacyQuote);
    expect(snapshot.authority).toBe("legacy_derived");
    expect(snapshot.grandTotal).toBeCloseTo(4439.04, 6);
    expect(snapshot.discountTotal).toBe(0);
    expect(snapshot.lineItems.length).toBeGreaterThanOrEqual(9);
    expect(snapshot.tax.regionName).toBe("Local");
  });

  test("resolves legacy-safe version metadata defaults", () => {
    const quote = makeQuote({
      id: "q-version-meta",
      ownerUid: "staff-9",
      ownerEmail: "ops@example.com",
      createdAtISO: "2026-03-10T12:00:00.000Z"
    });

    const metadata = resolveQuoteVersionMetadata(quote);
    expect(metadata.versionNumber).toBe(1);
    expect(metadata.createdAt).toBe("2026-03-10T12:00:00.000Z");
    expect(metadata.createdBy.uid).toBe("staff-9");
    expect(metadata.createdBy.email).toBe("ops@example.com");
    expect(metadata.reason).toBe("unspecified");
  });

  test("lazy-upgrades a legacy quote once and is idempotent", async () => {
    seedQuotes([
      makeQuote({
        id: "legacy-upgrade-1",
        activeVersionId: "",
        latestVersionNumber: 0
      })
    ]);

    const first = await ensureLegacyQuoteCompatibility("legacy-upgrade-1");
    const second = await ensureLegacyQuoteCompatibility("legacy-upgrade-1");

    expect(first.upgraded).toBe(true);
    expect(first.reason).toBe("seeded_baseline");
    expect(second.upgraded).toBe(false);
    expect(second.reason).toBe("already_versioned");

    const history = JSON.parse(localStorage.getItem(LOCAL_QUOTE_HISTORY_KEY) || "[]")
      .filter((item) => item.quoteId === "legacy-upgrade-1");
    expect(history.length).toBe(1);
    expect(history[0].versionId).toBe("v0001");

    const quotes = await getQuoteHistory();
    const updated = quotes.quotes.find((quote) => quote.id === "legacy-upgrade-1");
    expect(updated.activeVersionId).toBe("v0001");
    expect(updated.latestVersionNumber).toBe(1);
  });

  test("local alternate draft keeps presentation while clearing source proof", async () => {
    seedQuotes([
      makeQuote({
        id: "q-duplicate-proof",
        status: "booked",
        acceptanceReceipt: { receiptId: "acceptance-source" },
        rebooking: { state: "draft_created_for_staff_review", sourceQuoteId: "older-source" },
        workflow: {
          quoteDelivery: {
            revisionId: "v0003@2026-03-10T12:00:00.000Z",
            state: "provider_accepted",
            providerMessageId: "provider-source"
          }
        },
        payment: {
          depositLink: "https://checkout.stripe.com/c/pay/cs_test_source",
          depositStatus: "paid",
          depositConfirmedAtISO: "2026-03-12T12:00:00.000Z",
          stripeSessionId: "cs_test_source",
          finalBalance: {
            amountCents: 588000,
            status: "paid",
            paymentLink: "https://checkout.stripe.com/c/pay/cs_test_balance",
            stripeSessionId: "cs_test_balance",
            confirmedAtISO: "2026-03-15T12:00:00.000Z"
          }
        },
        booking: {
          contractNumber: "C-SOURCE",
          contractConvertedAtISO: "2026-03-11T12:00:00.000Z",
          bookedAtISO: "2026-03-11T12:00:00.000Z"
        }
      })
    ]);

    const created = await duplicateQuote("q-duplicate-proof", {
      ownerUid: "staff-new",
      ownerEmail: "staff-new@example.com"
    });
    const stored = JSON.parse(localStorage.getItem(LOCAL_QUOTES_KEY) || "[]")
      .find((item) => item.id === created.id);

    expect(stored.status).toBe("draft");
    expect(stored.duplicatedFromQuoteId).toBe("q-duplicate-proof");
    expect(stored).not.toHaveProperty("acceptanceReceipt");
    expect(stored).not.toHaveProperty("rebooking");
    expect(stored.payment).toMatchObject({
      depositLink: "",
      depositStatus: "unpaid",
      depositConfirmedAtISO: "",
      finalBalance: {
        status: "unpaid",
        paymentLink: "",
        confirmedAtISO: "",
        stripeSessionId: ""
      }
    });
    expect(stored.payment).not.toHaveProperty("stripeSessionId");
    expect(stored.workflow).not.toHaveProperty("quoteDelivery");
    expect(stored.booking.contractNumber).toBe("");
    expect(stored.booking.bookedAtISO).toBe("");
  });

  test("getActiveQuoteVersion resolves legacy quote without persisted version docs", async () => {
    seedQuotes([
      makeQuote({
        id: "legacy-active-read",
        activeVersionId: "",
        latestVersionNumber: 0,
        pricing: undefined
      })
    ]);

    const active = await getActiveQuoteVersion("legacy-active-read");

    expect(active.version).toBeTruthy();
    expect(active.activeVersionId).toBe("v0001");
    expect(active.version.versionId).toBe("v0001");
    expect(active.version.pricing).toBeTruthy();
    expect(active.version.pricing.authority).toBe("legacy_derived");
  });
});
