import { createRequire } from "node:module";
import { describe, expect, test } from "vitest";

const require = createRequire(import.meta.url);
const {
  QuoteCreationError,
  bindCustomerIdentityToQuoteDocuments,
  buildCanonicalPortalSnapshot,
  buildCustomerEmailClaim,
  buildCustomerProjection,
  buildDuplicateQuoteForm,
  buildPortalRotationDocuments,
  buildQuoteReopenDocuments,
  buildServerQuoteNumber,
  buildTrustedQuoteCreationDocuments,
  buildTrustedQuoteEditDocuments,
  customerEmailClaimDocumentId,
  customerProjectionDocumentId,
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
          quantity: 1,
          inclusions: {
            menuItems: [
              { id: "included-side", name: "Included Side", pricingMode: "per_event", unitPrice: 0 },
              { id: "unselected-side", name: "Unselected Side", pricingMode: "per_event", unitPrice: 0 }
            ],
            addons: [
              { id: "included-drink", name: "Included Drink", pricingMode: "per_person", unitPrice: 0 },
              { id: "unselected-drink", name: "Unselected Drink", pricingMode: "per_person", unitPrice: 0 }
            ],
            rentals: [
              { id: "included-chafer", name: "Included Chafer", pricingMode: "per_item", unitPrice: 0 },
              { id: "unselected-chafer", name: "Unselected Chafer", pricingMode: "per_item", unitPrice: 0 }
            ]
          }
        },
        addons: [
          {
            id: "dessert",
            name: "Dessert",
            pricingMode: "per_person",
            unitPrice: 3,
            quantity: 1
          },
          {
            id: "included-drink",
            name: "Included Drink",
            pricingMode: "per_person",
            unitPrice: 0,
            quantity: 1,
            includedInPackage: true
          }
        ],
        rentals: [{
          id: "included-chafer",
          name: "Included Chafer",
          pricingMode: "per_item",
          unitPrice: 0,
          quantity: 1,
          includedInPackage: true
        }],
        menuItems: [
          {
            id: "salad",
            name: "Salad",
            pricingMode: "per_event",
            unitPrice: 50,
            quantity: 1
          },
          {
            id: "included-side",
            name: "Included Side",
            pricingMode: "per_event",
            unitPrice: 0,
            quantity: 1,
            includedInPackage: true
          }
        ],
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
  test("builds a stable, tenant-scoped customer projection from trusted quote data", () => {
    const projection = buildCustomerProjection({
      organizationId: "org-a",
      quoteId: "quote-a",
      quoteNumber: "Q-260727-1200-ABCDEF12",
      customer: {
        name: "  Ada Lovelace  ",
        email: "ADA@Example.com",
        phone: "205-555-0100",
        organization: "Analytical Events"
      },
      event: {
        name: "Launch Dinner",
        date: "2026-09-12"
      },
      nowISO: "2026-07-27T12:00:00.000Z",
      newCustomerId: "customer-generated-a"
    });

    expect(projection).toEqual({
      customerId: "customer-generated-a",
      isNew: true,
      patch: {
        customerId: "customer-generated-a",
        organizationId: "org-a",
        name: "Ada Lovelace",
        email: "ada@example.com",
        nameKey: "ada lovelace",
        emailKey: "ada@example.com",
        phone: "205-555-0100",
        company: "Analytical Events",
        lastQuoteId: "quote-a",
        lastQuoteNumber: "Q-260727-1200-ABCDEF12",
        lastEventName: "Launch Dinner",
        lastEventDate: "2026-09-12",
        lastProjectedAtISO: "2026-07-27T12:00:00.000Z",
        updatedAtISO: "2026-07-27T12:00:00.000Z",
        recordSource: "trusted_quote_projection",
        createdFromQuoteId: "quote-a",
        createdAtISO: "2026-07-27T12:00:00.000Z"
      }
    });
    expect(customerProjectionDocumentId("ADA@example.com"))
      .toBe(customerProjectionDocumentId("ada@example.com"));
  });

  test("builds normalized server-owned email claims and rejects identity reassignment", () => {
    const claim = buildCustomerEmailClaim({
      organizationId: "org-a",
      customerId: "customer-generated-a",
      customerEmail: " ADA@Example.com ",
      nowISO: "2026-07-27T12:00:00.000Z"
    });

    expect(claim).toEqual({
      claimId: customerEmailClaimDocumentId("ada@example.com"),
      customerId: "customer-generated-a",
      emailKey: "ada@example.com",
      isNew: true,
      patch: {
        schemaVersion: 1,
        organizationId: "org-a",
        customerId: "customer-generated-a",
        emailKey: "ada@example.com",
        updatedAtISO: "2026-07-27T12:00:00.000Z",
        lastConfirmedSource: "trusted_quote_projection",
        recordSource: "trusted_customer_email_claim",
        createdBySource: "trusted_quote_projection",
        createdAtISO: "2026-07-27T12:00:00.000Z"
      }
    });
    expect(customerEmailClaimDocumentId("ADA@example.com"))
      .toBe(customerProjectionDocumentId("ada@example.com"));

    const existingClaim = buildCustomerEmailClaim({
      organizationId: "org-a",
      customerId: "customer-generated-a",
      customerEmail: "ada@example.com",
      nowISO: "2026-07-28T12:00:00.000Z",
      existingClaim: claim.patch
    });
    expect(existingClaim.isNew).toBe(false);
    expect(existingClaim.patch).not.toHaveProperty("createdAtISO");
    expect(existingClaim.patch).not.toHaveProperty("createdBySource");

    expect(() => buildCustomerEmailClaim({
      organizationId: "org-a",
      customerId: "customer-other",
      customerEmail: "ada@example.com",
      nowISO: "2026-07-28T12:00:00.000Z",
      existingClaim: claim.patch
    })).toThrow(/another customer identity/i);
    expect(() => buildCustomerEmailClaim({
      organizationId: "org-b",
      customerId: "customer-generated-a",
      customerEmail: "ada@example.com",
      nowISO: "2026-07-28T12:00:00.000Z",
      existingClaim: claim.patch
    })).toThrow(/does not match/i);
  });

  test("requires bounded provenance for customer email claims", () => {
    const base = {
      organizationId: "org-a",
      customerId: "customer-a",
      customerEmail: "ada@example.com",
      nowISO: "2026-07-27T12:00:00.000Z"
    };
    expect(() => buildCustomerEmailClaim({
      ...base,
      claimSource: "browser"
    })).toThrow(/not trusted/i);
    expect(() => buildCustomerEmailClaim({
      ...base,
      customerId: "customer/forged"
    })).toThrow(/incomplete/i);
    expect(() => buildCustomerEmailClaim({
      ...base,
      claimSource: "import_studio"
    })).toThrow(/import provenance/i);
    expect(buildCustomerEmailClaim({
      ...base,
      claimSource: "import_studio",
      importBatchId: "customer_import_batch_0001"
    }).patch).toMatchObject({
      createdBySource: "import_studio",
      importBatchId: "customer_import_batch_0001"
    });
  });

  test("merges into an existing matching customer without erasing richer optional data", () => {
    const projection = buildCustomerProjection({
      organizationId: "org-a",
      quoteId: "quote-b",
      quoteNumber: "Q-260728-1200-ABCDEF12",
      customer: {
        name: "Ada Lovelace",
        email: "ada@example.com",
        phone: "",
        organization: ""
      },
      event: {
        name: "Follow-up Dinner",
        date: "2026-10-12"
      },
      nowISO: "2026-07-28T12:00:00.000Z",
      existingCustomerId: "imported-customer-a",
      existingCustomer: {
        organizationId: "org-a",
        email: "ada@example.com",
        phone: "205-555-0100",
        company: "Analytical Events",
        notes: "Keep this imported note."
      }
    });

    expect(projection.customerId).toBe("imported-customer-a");
    expect(projection.isNew).toBe(false);
    expect(projection.patch).not.toHaveProperty("phone");
    expect(projection.patch).not.toHaveProperty("company");
    expect(projection.patch).not.toHaveProperty("createdAtISO");
    expect(projection.patch).toMatchObject({
      lastQuoteId: "quote-b",
      lastQuoteNumber: "Q-260728-1200-ABCDEF12"
    });
  });

  test("rejects customer projections that cross tenant or customer identity", () => {
    const base = {
      organizationId: "org-a",
      quoteId: "quote-a",
      quoteNumber: "Q-260727-1200-ABCDEF12",
      customer: { name: "Ada", email: "ada@example.com" },
      event: {},
      nowISO: "2026-07-27T12:00:00.000Z",
      existingCustomerId: "customer-a"
    };

    expect(() => buildCustomerProjection({
      ...base,
      existingCustomer: { organizationId: "org-b", email: "ada@example.com" }
    })).toThrow(/does not match/i);
    expect(() => buildCustomerProjection({
      ...base,
      existingCustomer: { organizationId: "org-a", email: "grace@example.com" }
    })).toThrow(/does not match/i);
    expect(() => buildCustomerProjection({
      ...base,
      existingCustomer: {
        organizationId: "org-a",
        email: "ada@example.com",
        emailKey: "grace@example.com"
      }
    })).toThrow(/does not match/i);
  });

  test("retains an explicitly bound customer during a contact edit", () => {
    const projection = buildCustomerProjection({
      organizationId: "org-a",
      quoteId: "quote-a",
      quoteNumber: "Q-260727-1200-ABCDEF12",
      customer: { name: "Ada Byron", email: "ada.byron@example.com" },
      event: {},
      nowISO: "2026-07-29T12:00:00.000Z",
      existingCustomerId: "customer-a",
      existingCustomer: {
        customerId: "customer-a",
        organizationId: "org-a",
        name: "Ada Lovelace",
        email: "ada@example.com"
      },
      allowEmailChange: true
    });

    expect(projection).toMatchObject({
      customerId: "customer-a",
      isNew: false,
      patch: {
        customerId: "customer-a",
        name: "Ada Byron",
        nameKey: "ada byron",
        email: "ada.byron@example.com",
        emailKey: "ada.byron@example.com"
      }
    });
  });

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
        depositStatus: "sent",
        finalBalance: {
          amountCents: 37500,
          currency: "usd",
          status: "sent",
          paymentLink: "https://checkout.stripe.com/c/pay/cs_test_final",
          confirmedAtISO: "",
          stripeSessionId: "cs_test_private_final",
          operationId: "approval-private-final",
          knownStripeSessionIds: ["cs_test_private_final"]
        }
      }
    });

    expect(portal.payment).toMatchObject({
      depositLink: "",
      depositStatus: "sent"
    });
    expect(portal.payment.finalBalance).toEqual({
      amountCents: 37500,
      currency: "usd",
      status: "sent",
      paymentLink: "https://checkout.stripe.com/c/pay/cs_test_final",
      confirmedAtISO: "",
      stripeCheckoutState: ""
    });
    expect(portal.payment.finalBalance).not.toHaveProperty("stripeSessionId");
    expect(portal.payment.finalBalance).not.toHaveProperty("operationId");
    expect(portal.deliveryEvidence).toEqual({
      revisionId: "",
      state: "",
      portalActivationState: "",
      portalKey: "",
      portalIssuedAtISO: "",
      providerAcceptedAtISO: ""
    });
  });

  test("projects only current issuance-bound provider acceptance into the public portal", () => {
    const portalKey = "0123456789abcdef0123456789abcdef";
    const portalIssuedAtISO = "2026-07-27T12:00:00.000Z";
    const quote = {
      organizationId: "org-a",
      portalKey,
      portalIssuedAtISO,
      portalExpiresAtISO: "2026-08-26T12:00:00.000Z",
      createdAtISO: portalIssuedAtISO,
      updatedAtISO: portalIssuedAtISO,
      workflow: {
        quoteDelivery: {
          revisionId: `v0001@${portalIssuedAtISO}`,
          state: "provider_accepted",
          portalActivationState: "active",
          portalKey,
          portalIssuedAtISO,
          providerAcceptedAtISO: "2026-07-27T12:01:00.000Z",
          providerMessageId: "private-provider-message-id"
        }
      }
    };

    expect(buildCanonicalPortalSnapshot("quote-current", quote).deliveryEvidence).toEqual({
      revisionId: `v0001@${portalIssuedAtISO}`,
      state: "provider_accepted",
      portalActivationState: "active",
      portalKey,
      portalIssuedAtISO,
      providerAcceptedAtISO: "2026-07-27T12:01:00.000Z"
    });
    expect(buildCanonicalPortalSnapshot("quote-rotated", {
      ...quote,
      portalKey: "bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb",
      portalIssuedAtISO: "2026-07-28T12:00:00.000Z"
    }).deliveryEvidence.state).toBe("");
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
    expect(() => sanitizeQuoteCreationRequest({
      form: buildForm({ menuItems: [] })
    })).toThrowError(expect.objectContaining({
      code: "invalid-argument",
      message: expect.stringMatching(/at least one menu item/i)
    }));
  });

  test("rejects authoritative pricing that does not resolve a selected menu item", () => {
    const form = sanitizeQuoteCreationRequest({ form: buildForm() }).form;
    const pricing = buildPricing();
    pricing.inputs.selection.menuItems = [];

    expect(() => buildTrustedQuoteCreationDocuments({
      quoteId: "quote-a",
      quoteNumber: "Q-260727-1200-ABCDEF12",
      portalKey: "0123456789abcdef0123456789abcdef",
      organizationId: "org-a",
      staff: {
        uid: "staff-a",
        email: "staff@example.com",
        role: "admin"
      },
      form,
      pricing,
      catalogSource: "firebase-org",
      settings: {},
      nowISO: "2026-07-27T12:00:00.000Z"
    })).toThrowError(expect.objectContaining({
      code: "failed-precondition",
      message: expect.stringMatching(/server pricing.*menu item/i)
    }));
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
        organizationName: "Trusted Organization",
        brandName: "Trusted Caterer",
        brandLogoUrl: "https://cdn.example.test/trusted-logo.png",
        brandPrimaryColor: "#436b55",
        brandAccentColor: "#a7c4a0",
        brandDarkAccentColor: "#294536",
        brandBackgroundStart: "#f4f7f1",
        brandBackgroundMid: "#e1eadc",
        brandBackgroundEnd: "#d5e1cf",
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
    expect(documents.quote.selection.packageInclusions).toMatchObject({
      menuItems: [{ id: "included-side", name: "Included Side", price: 0, includedInPackage: true }],
      addons: [{ id: "included-drink", name: "Included Drink", price: 0, includedInPackage: true }],
      rentals: [{ id: "included-chafer", name: "Included Chafer", price: 0, includedInPackage: true }]
    });
    expect(documents.quote.selection.packageInclusions.menuItems)
      .not.toEqual(expect.arrayContaining([expect.objectContaining({ id: "unselected-side" })]));
    expect(documents.quote.selection.packageInclusions.addons)
      .not.toEqual(expect.arrayContaining([expect.objectContaining({ id: "unselected-drink" })]));
    expect(documents.quote.selection.packageInclusions.rentals)
      .not.toEqual(expect.arrayContaining([expect.objectContaining({ id: "unselected-chafer" })]));
    expect(documents.quote.expiresAtISO).toBe("2026-09-10T12:00:00.000Z");
    expect(documents.quote.quoteMeta).not.toHaveProperty("crmWebhookUrl");
    expect(documents.quote.quoteMeta).not.toHaveProperty("crmBridgeAuthToken");
    expect(documents.quote.quoteMeta.organizationName).toBe("Trusted Organization");
    expect(documents.quote.quoteMeta).toMatchObject({
      brandLogoUrl: "https://cdn.example.test/trusted-logo.png",
      brandPrimaryColor: "#436b55",
      brandAccentColor: "#a7c4a0",
      brandDarkAccentColor: "#294536",
      brandBackgroundStart: "#f4f7f1",
      brandBackgroundMid: "#e1eadc",
      brandBackgroundEnd: "#d5e1cf"
    });

    expect(documents.portal).toMatchObject({
      quoteId: "quote-a",
      organizationId: "org-a",
      status: "draft",
      total: 1647,
      deposit: 494.1,
      totals: {
        serviceFeePctApplied: 0.08
      },
      quoteMeta: {
        organizationName: "Trusted Organization",
        brandName: "Trusted Caterer",
        brandLogoUrl: "https://cdn.example.test/trusted-logo.png",
        brandBackgroundStart: "#f4f7f1",
        brandBackgroundMid: "#e1eadc",
        brandBackgroundEnd: "#d5e1cf",
        businessEmail: "events@example.com"
      },
      selection: {
        packageInclusions: {
          menuItems: ["Included Side"],
          addons: ["Included Drink"],
          rentals: ["Included Chafer"]
        }
      },
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

    const bound = bindCustomerIdentityToQuoteDocuments(documents, "customer-a");
    expect(bound.quote.customerId).toBe("customer-a");
    expect(bound.version).toMatchObject({
      customerId: "customer-a",
      snapshot: { customerId: "customer-a" }
    });
    expect(bound.result.customerId).toBe("customer-a");
    expect(bound.portal).not.toHaveProperty("customerId");
    expect(buildCanonicalPortalSnapshot("quote-a", bound.quote))
      .not.toHaveProperty("customerId");
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
      customerId: "customer-a",
      status: "sent",
      lifecycle: {
        draftAtISO: "2026-07-27T12:00:00.000Z",
        sentAtISO: "2026-07-27T13:00:00.000Z"
      },
      workflow: {
        quoteDelivery: {
          revisionId: "v0001@2026-07-27T12:00:00.000Z",
          state: "provider_accepted",
          portalActivationState: "active",
          portalKey: "aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa",
          portalIssuedAtISO: "2026-07-27T12:00:00.000Z",
          providerAcceptedAtISO: "2026-07-27T13:00:00.000Z"
        }
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
    expect(rotation.portal.deliveryEvidence.state).toBe("");
    expect(rotation.version).toMatchObject({
      versionId: "v0002",
      customerId: "customer-a",
      versionNumber: 2,
      reason: "portal_key_rotate",
      createdBy: {
        uid: "admin-a",
        email: "admin@example.com",
        role: "admin"
      },
      snapshot: {
        id: "quote-a",
        customerId: "customer-a",
        portalKey: "aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa"
      }
    });
  });

  test("rejects non-admin, closed-state, and expired pre-acceptance portal rotations", () => {
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
    for (const status of ["declined", "expired", "deleted"]) {
      expect(() => buildPortalRotationDocuments({
        quoteId: "quote-a",
        quote: {
          ...quote,
          status
        },
        newPortalKey: "bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb",
        staff: {
          uid: "admin-a",
          email: "admin@example.com",
          role: "admin"
        },
        nowISO: "2026-07-28T12:00:00.000Z"
      })).toThrow(/unavailable for this commercial state/i);
    }
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

  test("renews an expired accepted portal without changing acceptance or payment truth", () => {
    const quote = {
      ...buildForm(),
      organizationId: "org-a",
      portalKey: "aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa",
      portalIssuedAtISO: "2026-06-01T00:00:00.000Z",
      portalExpiresAtISO: "2026-07-01T00:00:00.000Z",
      expiresAtISO: "2026-07-01T00:00:00.000Z",
      status: "accepted",
      latestVersionNumber: 2,
      acceptanceReceipt: {
        receiptId: "receipt-a",
        acceptedAtISO: "2026-06-02T12:00:00.000Z",
        portalIssuedAtISO: "2026-06-01T00:00:00.000Z"
      },
      payment: { depositStatus: "unpaid" }
    };
    const rotation = buildPortalRotationDocuments({
      quoteId: "quote-accepted",
      quote,
      newPortalKey: "bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb",
      staff: {
        uid: "admin-a",
        email: "admin@example.com",
        role: "admin"
      },
      nowISO: "2026-08-04T12:00:00.000Z"
    });

    expect(rotation.quotePatch).toMatchObject({
      portalExpiresAtISO: "2026-09-03T12:00:00.000Z"
    });
    expect(rotation.portal).toMatchObject({
      status: "accepted",
      acceptanceReceipt: quote.acceptanceReceipt,
      payment: { depositStatus: "unpaid" }
    });
    expect(rotation.version.snapshot).toMatchObject({
      acceptanceReceipt: quote.acceptanceReceipt,
      payment: quote.payment
    });
  });

  test("renews an expired booked portal without changing contract or payment truth", () => {
    const quote = {
      ...buildForm(),
      organizationId: "org-a",
      portalKey: "aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa",
      portalIssuedAtISO: "2026-06-01T00:00:00.000Z",
      portalExpiresAtISO: "2026-07-01T00:00:00.000Z",
      expiresAtISO: "2026-07-01T00:00:00.000Z",
      status: "booked",
      latestVersionNumber: 3,
      booking: {
        contractNumber: "C-260701-12345",
        contractConvertedAtISO: "2026-07-01T12:00:00.000Z"
      },
      payment: {
        depositStatus: "paid",
        stripeSessionId: "cs_test_paid_deposit",
        depositConfirmedAtISO: "2026-07-01T13:00:00.000Z"
      }
    };
    const rotation = buildPortalRotationDocuments({
      quoteId: "quote-booked",
      quote,
      newPortalKey: "bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb",
      staff: {
        uid: "admin-a",
        email: "admin@example.com",
        role: "admin"
      },
      nowISO: "2026-08-04T12:00:00.000Z"
    });

    expect(rotation.quotePatch).toMatchObject({
      portalKey: "bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb",
      portalIssuedAtISO: "2026-08-04T12:00:00.000Z",
      portalExpiresAtISO: "2026-09-03T12:00:00.000Z"
    });
    expect(rotation.portal).toMatchObject({
      status: "booked",
      booking: { contractNumber: "C-260701-12345" },
      payment: {
        depositStatus: "paid"
      }
    });
    expect(rotation.portal.payment).not.toHaveProperty("stripeSessionId");
    expect(rotation.version.snapshot).toMatchObject({
      booking: quote.booking,
      payment: quote.payment
    });
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
    const boundEdit = bindCustomerIdentityToQuoteDocuments(edited, "customer-a");
    expect(boundEdit.quotePatch.customerId).toBe("customer-a");
    expect(boundEdit.version).toMatchObject({
      customerId: "customer-a",
      snapshot: { customerId: "customer-a" }
    });
    expect(boundEdit.portal).not.toHaveProperty("customerId");
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
