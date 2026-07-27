import { createRequire } from "node:module";
import { describe, expect, test } from "vitest";

const require = createRequire(import.meta.url);
const {
  QuoteCreationError,
  buildCanonicalPortalSnapshot,
  buildDuplicateQuoteForm,
  buildPortalRotationDocuments,
  buildQuoteReopenDocuments,
  buildServerQuoteNumber,
  buildTrustedQuoteCreationDocuments,
  buildTrustedQuoteEditDocuments,
  sanitizeQuoteCreationRequest,
  sanitizeStoredStripePaymentLink
} = require("../../../functions/quoteCreation.js");

function buildPricing(overrides = {}) {
  return {
    pricingVersion: "pricing-v1",
    calculatedAt: "2026-07-27T12:00:00.000Z",
    authority: "server_authoritative",
    inputs: {
      organizationId: "org-a",
      event: {
        name: "Annual Dinner",
        eventTypeId: "dinner",
        date: "2026-09-12",
        time: "18:00",
        venue: "Main Hall",
        venueAddress: "123 Main Street",
        guests: 50,
        hours: 4,
        style: "Buffet",
        servers: 2,
        chefs: 1,
        bartenders: 1,
        milesRT: 10,
        taxRegionId: "local",
        seasonProfileId: "standard"
      },
      selection: {
        package: {
          id: "classic",
          name: "Classic",
          pricingMode: "per_person",
          unitPrice: 20,
          quantity: 1
        },
        addons: [{
          id: "dessert",
          name: "Dessert",
          pricingMode: "per_person",
          unitPrice: 3,
          quantity: 1
        }],
        rentals: [],
        menuItems: [{
          id: "salad",
          name: "Salad",
          pricingMode: "per_event",
          unitPrice: 50,
          quantity: 1
        }],
        quantities: {
          addonQuantities: {},
          rentalQuantities: {},
          menuItemQuantities: {
            salad: 1
          }
        }
      },
      labor: {
        bartenderRateOverride: "",
        serverRateOverride: "",
        chefRateOverride: "",
        serverRateMixCsv: "",
        chefRateMixCsv: ""
      }
    },
    lineItems: [
      { id: "classic", category: "package", total: 1000 },
      { id: "dessert", category: "addon", total: 150 },
      { id: "salad", category: "menu_item", total: 50 }
    ],
    fees: {
      labor: 200,
      serverLabor: 100,
      chefLabor: 60,
      bartenderLabor: 40,
      travel: 25,
      serviceFee: 100
    },
    tax: {
      rate: 0.08,
      amount: 122,
      regionId: "local",
      regionName: "Local"
    },
    deposit: {
      pct: 0.3,
      amount: 494.1
    },
    subtotal: 1425,
    grandTotal: 1647,
    rulesSnapshot: {
      serviceFeePctApplied: 0.08,
      taxRateApplied: 0.08,
      taxRegionId: "local",
      taxRegionName: "Local",
      seasonProfileId: "standard",
      seasonProfileName: "Standard",
      packageMultiplier: 1,
      addonMultiplier: 1,
      rentalMultiplier: 1,
      pricingSettingsVersion: 3,
      pricingSettingsUpdatedAtISO: "2026-07-27T10:00:00.000Z",
      laborRateSnapshot: {
        bartenderRateApplied: 40,
        serverRateApplied: 25,
        serverRatesApplied: [25, 25],
        serverLabor: 100,
        chefRateApplied: 60,
        chefRatesApplied: [60],
        chefLabor: 60,
        bartenderRateTypeId: "standard",
        bartenderRateTypeName: "Standard",
        staffingRateTypeId: "standard",
        staffingRateTypeName: "Standard"
      }
    },
    ...overrides
  };
}

function buildForm(overrides = {}) {
  return {
    name: "Client One",
    email: "CLIENT@EXAMPLE.COM",
    phone: "205-555-0101",
    clientOrg: "Client Co",
    eventName: "Annual Dinner",
    date: "2026-09-12",
    time: "18:00",
    venue: "Main Hall",
    venueAddress: "123 Main Street",
    guests: 50,
    hours: 4,
    servers: 2,
    chefs: 1,
    bartenders: 1,
    dietaryRestrictions: "No peanuts",
    style: "Buffet",
    pkg: "classic",
    addons: ["dessert"],
    rentals: [],
    menuItems: ["salad"],
    menuItemQuantities: { salad: 1, injected: 999 },
    eventTypeId: "dinner",
    eventTemplateId: "custom",
    taxRegion: "local",
    seasonProfileId: "standard",
    milesRT: 10,
    includeDisposables: true,
    payMethod: "ach",
    depositLink: "https://attacker.example/pay",
    ...overrides
  };
}

describe("trusted server quote creation documents", () => {
  test("keeps only approved Stripe-host payment links in public portal snapshots", () => {
    expect(sanitizeStoredStripePaymentLink(
      "https://checkout.stripe.com/c/pay/cs_test_123?prefilled_email=client%40example.com"
    )).toBe(
      "https://checkout.stripe.com/c/pay/cs_test_123?prefilled_email=client%40example.com"
    );
    expect(sanitizeStoredStripePaymentLink("https://buy.stripe.com/test_123")).toBe(
      "https://buy.stripe.com/test_123"
    );
    expect(sanitizeStoredStripePaymentLink("http://checkout.stripe.com/c/pay/test")).toBe("");
    expect(sanitizeStoredStripePaymentLink("https://checkout.stripe.com.evil.test/pay")).toBe("");
    expect(sanitizeStoredStripePaymentLink("javascript:alert(1)")).toBe("");

    const portal = buildCanonicalPortalSnapshot("quote-legacy", {
      organizationId: "org-a",
      portalKey: "0123456789abcdef0123456789abcdef",
      portalIssuedAtISO: "2026-07-27T12:00:00.000Z",
      portalExpiresAtISO: "2026-08-26T12:00:00.000Z",
      createdAtISO: "2026-07-27T12:00:00.000Z",
      updatedAtISO: "2026-07-27T12:00:00.000Z",
      payment: {
        depositLink: "https://attacker.example.test/pay",
        depositStatus: "sent"
      }
    });

    expect(portal.payment).toMatchObject({
      depositLink: "",
      depositStatus: "sent"
    });
  });

  test("sanitizes bounded presentation input and excludes untrusted payment state", () => {
    const sanitized = sanitizeQuoteCreationRequest({
      organizationId: "org-a",
      ownerUid: "forged-owner",
      totals: { total: 1 },
      form: buildForm({
        dietaryRestrictions: "x".repeat(2_000),
        menuItems: ["salad", "salad"]
      })
    });

    expect(sanitized.organizationId).toBe("org-a");
    expect(sanitized.form.email).toBe("client@example.com");
    expect(sanitized.form.dietaryRestrictions).toHaveLength(1_200);
    expect(sanitized.form.menuItems).toEqual(["salad"]);
    expect(sanitized.form.menuItemQuantities).toEqual({ salad: 1 });
    expect(sanitized.form).not.toHaveProperty("depositLink");
    expect(sanitized.form).not.toHaveProperty("ownerUid");
    expect(sanitized.form).not.toHaveProperty("totals");
  });

  test("rejects malformed required customer and event presentation fields", () => {
    expect(() => sanitizeQuoteCreationRequest({
      form: buildForm({ email: "not-an-email" })
    })).toThrow(QuoteCreationError);
    expect(() => sanitizeQuoteCreationRequest({
      form: buildForm({ date: "2026-02-31" })
    })).toThrow(/event date is invalid/i);
  });

  test("builds one canonical draft, public snapshot, and v0001 from server proof", () => {
    const form = sanitizeQuoteCreationRequest({ form: buildForm() }).form;
    const documents = buildTrustedQuoteCreationDocuments({
      quoteId: "quote-a",
      quoteNumber: "Q-260727-1200-ABCDEF12",
      portalKey: "0123456789abcdef0123456789abcdef",
      organizationId: "org-a",
      staff: {
        uid: "staff-a",
        email: "STAFF@EXAMPLE.COM",
        role: "admin"
      },
      form,
      pricing: buildPricing(),
      catalogSource: "firebase-org",
      settings: {
        quoteValidityDays: 45,
        brandName: "Trusted Caterer",
        businessEmail: "events@example.com",
        acceptanceEmail: "accept@example.com",
        crmEnabled: true,
        crmProvider: "webhook",
        crmWebhookUrl: "https://secret.example/hook",
        crmBridgeAuthToken: "must-not-persist",
        integrationRetryLimit: 4,
        integrationAuditRetention: 60
      },
      nowISO: "2026-07-27T12:00:00.000Z"
    });

    expect(documents.quote).toMatchObject({
      quoteNumber: "Q-260727-1200-ABCDEF12",
      ownerUid: "staff-a",
      ownerEmail: "staff@example.com",
      organizationId: "org-a",
      status: "draft",
      activeVersionId: "v0001",
      latestVersionNumber: 1,
      totals: {
        base: 1000,
        addons: 150,
        menu: 50,
        total: 1647,
        deposit: 494.1
      },
      payment: {
        depositLink: "",
        depositStatus: "unpaid"
      },
      pricing: {
        authority: "server_authoritative",
        grandTotal: 1647
      }
    });
    expect(documents.quote.portalExpiresAtISO).toBe("2026-08-26T12:00:00.000Z");
    expect(documents.quote.expiresAtISO).toBe("2026-09-10T12:00:00.000Z");
    expect(documents.quote.quoteMeta).not.toHaveProperty("crmWebhookUrl");
    expect(documents.quote.quoteMeta).not.toHaveProperty("crmBridgeAuthToken");

    expect(documents.portal).toMatchObject({
      quoteId: "quote-a",
      organizationId: "org-a",
      status: "draft",
      total: 1647,
      deposit: 494.1,
      lifecycle: {
        draftAtISO: "2026-07-27T12:00:00.000Z"
      }
    });
    expect(documents.version).toMatchObject({
      versionId: "v0001",
      quoteId: "quote-a",
      versionNumber: 1,
      status: "draft",
      createdBy: {
        uid: "staff-a",
        email: "staff@example.com",
        role: "admin"
      },
      snapshot: {
        id: "quote-a",
        status: "draft"
      }
    });
  });

  test("duplicates only source presentation while leaving identity and proof server-owned", () => {
    const duplicateForm = buildDuplicateQuoteForm({
      id: "source-quote",
      ownerUid: "old-owner",
      customer: {
        name: "Client One",
        email: "client@example.com"
      },
      event: {
        name: "Annual Dinner",
        date: "2026-09-12",
        time: "18:00"
      },
      selection: {
        packageId: "classic",
        addons: ["dessert"],
        rentals: [],
        menuItems: ["salad"],
        payMethod: "ach"
      },
      quoteMeta: {
        includeDisposables: false
      },
      payment: {
        depositLink: "https://old.example/pay",
        depositStatus: "paid"
      },
      status: "booked"
    });

    expect(duplicateForm).toMatchObject({
      name: "Client One",
      email: "client@example.com",
      pkg: "classic",
      addons: ["dessert"],
      menuItems: ["salad"],
      payMethod: "ach",
      includeDisposables: false
    });
    expect(duplicateForm).not.toHaveProperty("ownerUid");
    expect(duplicateForm).not.toHaveProperty("payment");
    expect(duplicateForm).not.toHaveProperty("status");
  });

  test("generates server quote numbers from timestamp and entropy", () => {
    expect(buildServerQuoteNumber(
      "2026-07-27T12:34:00.000Z",
      "abcdef12-3456-7890"
    )).toBe("Q-260727-1234-ABCDEF12");
  });

  test("builds an admin-attributed atomic portal rotation and audit version", () => {
    const form = sanitizeQuoteCreationRequest({ form: buildForm() }).form;
    const created = buildTrustedQuoteCreationDocuments({
      quoteId: "quote-a",
      quoteNumber: "Q-260727-1200-ABCDEF12",
      portalKey: "aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa",
      organizationId: "org-a",
      staff: {
        uid: "staff-a",
        email: "staff@example.com",
        role: "admin"
      },
      form,
      pricing: buildPricing(),
      catalogSource: "firebase-org",
      settings: {
        quoteValidityDays: 45,
        brandName: "Trusted Caterer"
      },
      nowISO: "2026-07-27T12:00:00.000Z"
    });
    const sourceQuote = {
      ...created.quote,
      status: "sent",
      lifecycle: {
        draftAtISO: "2026-07-27T12:00:00.000Z",
        sentAtISO: "2026-07-27T13:00:00.000Z"
      },
      updatedAtISO: "2026-07-27T13:00:00.000Z"
    };

    const rotation = buildPortalRotationDocuments({
      quoteId: "quote-a",
      quote: sourceQuote,
      newPortalKey: "bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb",
      staff: {
        uid: "admin-a",
        email: "ADMIN@EXAMPLE.COM",
        role: "admin"
      },
      nowISO: "2026-07-28T12:00:00.000Z"
    });

    expect(rotation.previousPortalKey).toBe("aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa");
    expect(rotation.quotePatch).toMatchObject({
      portalKey: "bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb",
      portalIssuedAtISO: "2026-07-28T12:00:00.000Z",
      portalExpiresAtISO: "2026-08-27T12:00:00.000Z",
      latestVersionNumber: 2,
      "quoteMeta.portalRotatedByEmail": "admin@example.com"
    });
    expect(rotation.portal).toMatchObject({
      quoteId: "quote-a",
      portalKey: "bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb",
      status: "sent",
      portalIssuedAtISO: "2026-07-28T12:00:00.000Z",
      portalExpiresAtISO: "2026-08-27T12:00:00.000Z",
      lifecycle: sourceQuote.lifecycle
    });
    expect(rotation.version).toMatchObject({
      versionId: "v0002",
      versionNumber: 2,
      reason: "portal_key_rotate",
      createdBy: {
        uid: "admin-a",
        email: "admin@example.com",
        role: "admin"
      },
      snapshot: {
        id: "quote-a",
        portalKey: "aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa"
      }
    });
  });

  test("rejects non-admin and expired portal rotations", () => {
    const quote = {
      organizationId: "org-a",
      portalKey: "aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa",
      status: "sent",
      expiresAtISO: "2026-08-15T00:00:00.000Z",
      latestVersionNumber: 1
    };
    expect(() => buildPortalRotationDocuments({
      quoteId: "quote-a",
      quote,
      newPortalKey: "bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb",
      staff: {
        uid: "sales-a",
        email: "sales@example.com",
        role: "sales"
      },
      nowISO: "2026-07-28T12:00:00.000Z"
    })).toThrow(/admin role required/i);
    expect(() => buildPortalRotationDocuments({
      quoteId: "quote-a",
      quote: {
        ...quote,
        expiresAtISO: "2026-07-27T00:00:00.000Z"
      },
      newPortalKey: "bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb",
      staff: {
        uid: "admin-a",
        email: "admin@example.com",
        role: "admin"
      },
      nowISO: "2026-07-28T12:00:00.000Z"
    })).toThrow(/expiry must be extended/i);
  });

  test("builds an atomic admin reopen with fresh expiry and immutable terminal audit", () => {
    const form = sanitizeQuoteCreationRequest({ form: buildForm() }).form;
    const created = buildTrustedQuoteCreationDocuments({
      quoteId: "quote-reopen",
      quoteNumber: "Q-260727-1200-REOPEN12",
      portalKey: "aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa",
      organizationId: "org-a",
      staff: {
        uid: "admin-a",
        email: "admin@example.com",
        role: "admin"
      },
      form,
      pricing: buildPricing(),
      catalogSource: "firebase-org",
      settings: {
        quoteValidityDays: 45,
        brandName: "Trusted Caterer"
      },
      nowISO: "2026-07-01T12:00:00.000Z"
    });
    const activeSnapshot = {
      ...created.version.snapshot,
      customer: {
        ...created.version.snapshot.customer,
        name: "Approved Snapshot Customer"
      }
    };
    const sourceQuote = {
      ...created.quote,
      status: "expired",
      customer: {
        ...created.quote.customer,
        name: "Stale Terminal Customer"
      },
      portalDecision: {
        decision: "changes_requested",
        message: "Please revise timing.",
        submittedAtISO: "2026-07-10T12:00:00.000Z"
      },
      payment: {
        depositLink: "https://pay.example/current",
        depositStatus: "sent",
        depositConfirmedAtISO: ""
      },
      booking: {
        ...created.quote.booking,
        staffLead: "Current Ops Lead"
      },
      lifecycle: {
        draftAtISO: "2026-07-01T12:00:00.000Z",
        sentAtISO: "2026-07-02T12:00:00.000Z",
        expiredAtISO: "2026-07-20T12:00:00.000Z"
      },
      updatedAtISO: "2026-07-20T12:00:00.000Z"
    };

    const reopened = buildQuoteReopenDocuments({
      quoteId: "quote-reopen",
      quote: sourceQuote,
      activeSnapshot,
      newPortalKey: "bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb",
      staff: {
        uid: "admin-b",
        email: "ADMIN-B@EXAMPLE.COM",
        role: "admin"
      },
      nowISO: "2026-07-28T12:00:00.000Z"
    });

    expect(reopened.previousPortalKey).toBe("aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa");
    expect(reopened.quotePatch).toMatchObject({
      status: "draft",
      customer: {
        name: "Approved Snapshot Customer"
      },
      payment: {
        depositLink: "https://pay.example/current",
        depositStatus: "sent"
      },
      booking: {
        staffLead: "Current Ops Lead"
      },
      portalDecision: sourceQuote.portalDecision,
      portalKey: "bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb",
      portalIssuedAtISO: "2026-07-28T12:00:00.000Z",
      portalExpiresAtISO: "2026-08-27T12:00:00.000Z",
      expiresAtISO: "2026-09-11T12:00:00.000Z",
      deletedAtISO: "",
      latestVersionNumber: 2,
      lifecycle: {
        draftAtISO: "2026-07-01T12:00:00.000Z",
        expiredAtISO: "2026-07-20T12:00:00.000Z",
        reopenedAtISO: "2026-07-28T12:00:00.000Z"
      }
    });
    expect(reopened.quotePatch).not.toHaveProperty("workflow");
    expect(reopened.quotePatch).not.toHaveProperty("integrations");
    expect(reopened.portal).toMatchObject({
      quoteId: "quote-reopen",
      status: "draft",
      portalKey: "bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb",
      portalDecision: sourceQuote.portalDecision
    });
    expect(reopened.version).toMatchObject({
      versionId: "v0002",
      reason: "reopen_quote_before_restore",
      status: "expired",
      createdBy: {
        uid: "admin-b",
        email: "admin-b@example.com",
        role: "admin"
      },
      snapshot: {
        id: "quote-reopen",
        status: "expired",
        portalKey: "aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa",
        portalDecision: sourceQuote.portalDecision
      }
    });
  });

  test("rejects unsafe reopen authority, status, and hidden terminal evidence", () => {
    const activeSnapshot = {
      id: "quote-reopen",
      organizationId: "org-a",
      quoteNumber: "Q-REOPEN",
      ownerUid: "admin-a",
      ownerEmail: "admin@example.com",
      status: "draft"
    };
    const quote = {
      ...activeSnapshot,
      portalKey: "aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa",
      status: "expired",
      latestVersionNumber: 1,
      quoteMeta: {
        quoteValidityDays: 30
      }
    };
    const baseInput = {
      quoteId: "quote-reopen",
      quote,
      activeSnapshot,
      newPortalKey: "bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb",
      staff: {
        uid: "admin-a",
        email: "admin@example.com",
        role: "admin"
      },
      nowISO: "2026-07-28T12:00:00.000Z"
    };

    expect(() => buildQuoteReopenDocuments({
      ...baseInput,
      staff: {
        ...baseInput.staff,
        role: "sales"
      }
    })).toThrow(/admin role required/i);
    expect(() => buildQuoteReopenDocuments({
      ...baseInput,
      activeSnapshot: null
    })).toThrow(/active version is required/i);
    expect(() => buildQuoteReopenDocuments({
      ...baseInput,
      activeSnapshot: {
        ...activeSnapshot,
        ownerUid: "different-owner"
      }
    })).toThrow(/identity does not match/i);
    expect(() => buildQuoteReopenDocuments({
      ...baseInput,
      quote: {
        ...quote,
        status: "sent"
      }
    })).toThrow(/only expired or deleted/i);
    expect(() => buildQuoteReopenDocuments({
      ...baseInput,
      quote: {
        ...quote,
        status: "deleted"
      }
    })).toThrow(/deletion audit timestamp/i);
    expect(() => buildQuoteReopenDocuments({
      ...baseInput,
      quote: {
        ...quote,
        status: "deleted",
        deletedAtISO: "2026-07-27T12:00:00.000Z",
        portalDecision: {
          decision: "accepted",
          submittedAtISO: "2026-07-20T12:00:00.000Z"
        }
      }
    })).toThrow(/cannot be reopened/i);
    expect(() => buildQuoteReopenDocuments({
      ...baseInput,
      quote: {
        ...quote,
        payment: {
          depositStatus: "refunded"
        }
      }
    })).toThrow(/cannot be reopened/i);
  });

  test("builds a server-priced edit while preserving quote identity and operational evidence", () => {
    const originalForm = sanitizeQuoteCreationRequest({ form: buildForm() }).form;
    const created = buildTrustedQuoteCreationDocuments({
      quoteId: "quote-edit",
      quoteNumber: "Q-260727-1200-EDIT0001",
      portalKey: "aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa",
      organizationId: "org-a",
      staff: {
        uid: "owner-a",
        email: "owner@example.com",
        role: "admin"
      },
      form: originalForm,
      pricing: buildPricing(),
      catalogSource: "firebase-org",
      settings: {
        quoteValidityDays: 45,
        brandName: "Original Brand"
      },
      nowISO: "2026-07-27T12:00:00.000Z"
    });
    const sourceQuote = {
      ...created.quote,
      status: "viewed",
      payment: {
        depositLink: "https://pay.example/current",
        depositStatus: "sent",
        depositConfirmedAtISO: ""
      },
      booking: {
        ...created.quote.booking,
        staffLead: "Operations Lead"
      },
      portalDecision: {
        decision: "changes_requested",
        message: "Please revise the guest count.",
        submittedAtISO: "2026-07-28T09:00:00.000Z"
      },
      lifecycle: {
        draftAtISO: "2026-07-27T12:00:00.000Z",
        sentAtISO: "2026-07-27T13:00:00.000Z",
        viewedAtISO: "2026-07-28T09:00:00.000Z"
      },
      quoteMeta: {
        ...created.quote.quoteMeta,
        crmBridgeAuthToken: "must-be-removed",
        portalRotatedByEmail: "admin@example.com"
      },
      updatedAtISO: "2026-07-28T09:00:00.000Z"
    };
    const editedForm = sanitizeQuoteCreationRequest({
      form: buildForm({
        name: "Updated Client",
        guests: 75
      })
    }).form;
    const editedPricing = buildPricing({
      grandTotal: 2345,
      deposit: {
        pct: 0.3,
        amount: 703.5
      }
    });

    const edited = buildTrustedQuoteEditDocuments({
      quoteId: "quote-edit",
      quote: sourceQuote,
      staff: {
        uid: "sales-editor",
        email: "sales@example.com",
        role: "sales"
      },
      form: editedForm,
      pricing: editedPricing,
      catalogSource: "firebase-org",
      settings: {
        quoteValidityDays: 60,
        brandName: "Current Server Brand",
        crmBridgeAuthToken: "must-not-persist"
      },
      nowISO: "2026-07-29T12:00:00.000Z"
    });

    expect(edited.quotePatch).toMatchObject({
      quoteNumber: "Q-260727-1200-EDIT0001",
      organizationId: "org-a",
      ownerUid: "owner-a",
      ownerEmail: "owner@example.com",
      status: "draft",
      customer: {
        name: "Updated Client",
        email: "client@example.com"
      },
      totals: {
        total: 2345,
        deposit: 703.5
      },
      pricing: {
        authority: "server_authoritative",
        grandTotal: 2345
      },
      payment: sourceQuote.payment,
      booking: {
        staffLead: "Operations Lead"
      },
      portalDecision: sourceQuote.portalDecision,
      activeVersionId: "v0002",
      latestVersionNumber: 2,
      lifecycle: {
        sentAtISO: "2026-07-27T13:00:00.000Z",
        viewedAtISO: "2026-07-28T09:00:00.000Z",
        editedAtISO: "2026-07-29T12:00:00.000Z"
      }
    });
    expect(edited.quotePatch.quoteMeta).toMatchObject({
      brandName: "Current Server Brand",
      portalRotatedByEmail: "admin@example.com",
      lastEditedByEmail: "sales@example.com"
    });
    expect(edited.quotePatch.quoteMeta).not.toHaveProperty("crmBridgeAuthToken");
    expect(edited.portal).toMatchObject({
      quoteId: "quote-edit",
      organizationId: "org-a",
      status: "draft",
      total: 2345,
      portalDecision: sourceQuote.portalDecision,
      payment: {
        depositLink: ""
      }
    });
    expect(edited.version).toMatchObject({
      versionId: "v0002",
      versionNumber: 2,
      reason: "quote_edit",
      createdBy: {
        uid: "sales-editor",
        email: "sales@example.com",
        role: "sales"
      },
      snapshot: {
        id: "quote-edit",
        status: "draft",
        ownerUid: "owner-a",
        totals: {
          total: 2345
        }
      }
    });
    expect(edited.result).toMatchObject({
      id: "quote-edit",
      quoteId: "quote-edit",
      quoteNumber: "Q-260727-1200-EDIT0001",
      status: "draft",
      activeVersionId: "v0002",
      latestVersionNumber: 2
    });
  });

  test("rejects trusted edits that could overwrite terminal evidence or lack staff authority", () => {
    const base = {
      quoteId: "quote-edit",
      quote: {
        id: "quote-edit",
        quoteNumber: "Q-EDIT",
        organizationId: "org-a",
        portalKey: "aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa",
        ownerUid: "owner-a",
        ownerEmail: "owner@example.com",
        status: "draft",
        latestVersionNumber: 1
      },
      staff: {
        uid: "sales-a",
        email: "sales@example.com",
        role: "sales"
      },
      form: sanitizeQuoteCreationRequest({ form: buildForm() }).form,
      pricing: buildPricing(),
      catalogSource: "firebase-org",
      settings: {
        quoteValidityDays: 30
      },
      nowISO: "2026-07-29T12:00:00.000Z"
    };

    expect(() => buildTrustedQuoteEditDocuments({
      ...base,
      quote: {
        ...base.quote,
        status: "accepted",
        portalDecision: {
          decision: "accepted",
          submittedAtISO: "2026-07-28T12:00:00.000Z"
        }
      }
    })).toThrow(/only draft, sent, or viewed/i);
    expect(() => buildTrustedQuoteEditDocuments({
      ...base,
      quote: {
        ...base.quote,
        payment: {
          depositStatus: "paid",
          depositConfirmedAtISO: "2026-07-28T12:00:00.000Z"
        }
      }
    })).toThrow(/cannot be overwritten/i);
    expect(() => buildTrustedQuoteEditDocuments({
      ...base,
      staff: {
        uid: "customer-a",
        email: "customer@example.com",
        role: "customer"
      }
    })).toThrow(/staff role required/i);
  });
});
