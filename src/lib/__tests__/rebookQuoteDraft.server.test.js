import { createRequire } from "node:module";
import fs from "node:fs";
import { describe, expect, test } from "vitest";

const require = createRequire(import.meta.url);
const {
  RebookQuoteDraftError,
  assertRebookCurrentEventDate,
  assertRebookReadyForDelivery,
  assertRebookReviewComplete,
  buildRebookDraftId,
  buildRebookProvenance,
  buildRebookingRequestId,
  completeRebookStaffReview,
  matchesRebookDraft,
  normalizeRebookQuoteDraftRequest,
  overlayCurrentCustomerContact,
  resolveAcceptedRebookSource
} = require("../../../functions/rebookQuoteDraft.js");
const {
  buildCanonicalPortalSnapshot
} = require("../../../functions/quoteCreation.js");
const FUNCTIONS_SOURCE = fs.readFileSync(
  new URL("../../../functions/index.js", import.meta.url),
  "utf8"
);

const REQUEST_SCOPE = Object.freeze({
  organizationId: "org-one",
  sourceQuoteId: "quote-source",
  sourceVersionId: "v0003",
  acceptanceReceiptId: "acceptance-1234567890"
});
const REQUEST = Object.freeze({
  ...REQUEST_SCOPE,
  rebookingRequestId: buildRebookingRequestId(REQUEST_SCOPE)
});
const ACCEPTED_AT_ISO = "2025-08-10T18:30:00.000Z";
const ISSUED_AT_ISO = "2025-07-20T14:00:00.000Z";

function sourceFixture() {
  const snapshot = {
    id: REQUEST.sourceQuoteId,
    organizationId: REQUEST.organizationId,
    customerId: "customer-henderson",
    customer: { name: "Henderson Group", email: "events@henderson.test" },
    event: { name: "Corporate picnic", date: "2025-08-10" },
    pricing: { authority: "server_authoritative" }
  };
  return {
    quote: {
      organizationId: REQUEST.organizationId,
      customerId: "customer-henderson",
      status: "booked",
      activeVersionId: REQUEST.sourceVersionId,
      acceptanceReceipt: {
        receiptId: REQUEST.acceptanceReceiptId,
        acceptedAtISO: ACCEPTED_AT_ISO,
        portalIssuedAtISO: ISSUED_AT_ISO,
        quoteRevisionId: `${REQUEST.sourceVersionId}@${ISSUED_AT_ISO}`
      }
    },
    version: {
      versionId: REQUEST.sourceVersionId,
      quoteId: REQUEST.sourceQuoteId,
      organizationId: REQUEST.organizationId,
      customerId: "customer-henderson",
      snapshot
    }
  };
}

describe("trusted rebook quote draft contract", () => {
  test("normalizes a stable bounded request without accepting customer content", () => {
    expect(normalizeRebookQuoteDraftRequest({
      ...REQUEST,
      rebookingRequestId: REQUEST.rebookingRequestId.toUpperCase(),
      customerName: "must not be trusted",
      eventDate: "2030-01-01"
    })).toEqual(REQUEST);
  });

  test.each([
    [{ ...REQUEST, organizationId: "" }, /organizationId/i],
    [{ ...REQUEST, sourceQuoteId: "client@example.test" }, /sourceQuoteId/i],
    [{ ...REQUEST, sourceVersionId: "bad/version" }, /sourceVersionId/i],
    [{ ...REQUEST, acceptanceReceiptId: ".." }, /acceptanceReceiptId/i],
    [{ ...REQUEST, rebookingRequestId: "rebook_wrong_source_identity_12345" }, /server-derived/i]
  ])("rejects invalid browser-supplied identity", (request, message) => {
    expect(() => normalizeRebookQuoteDraftRequest(request)).toThrow(message);
  });

  test("resolves only the exact booked accepted immutable version and stable customer", () => {
    const source = sourceFixture();
    expect(resolveAcceptedRebookSource({
      request: REQUEST,
      sourceQuote: source.quote,
      sourceVersion: source.version
    })).toMatchObject({
      request: REQUEST,
      customerId: "customer-henderson",
      sourceEventDate: "2025-08-10",
      acceptedAtISO: ACCEPTED_AT_ISO,
      portalIssuedAtISO: ISSUED_AT_ISO,
      sourceSnapshot: source.version.snapshot
    });
  });

  test("keeps accepted commercial inputs but overlays the current stable customer contact", () => {
    const form = overlayCurrentCustomerContact({
      sourceForm: {
        name: "Old Henderson Name",
        email: "old@henderson.test",
        phone: "205-555-0001",
        clientOrg: "Old Company",
        eventName: "Corporate picnic",
        date: "2025-08-10",
        guests: 125,
        menuItems: ["picnic-menu"]
      },
      currentCustomer: {
        customerId: "customer-henderson",
        organizationId: REQUEST.organizationId,
        name: "Henderson Holdings",
        email: "events@henderson.test",
        emailKey: "events@henderson.test",
        phone: "205-555-0199",
        company: "Henderson Holdings LLC"
      },
      organizationId: REQUEST.organizationId,
      customerId: "customer-henderson"
    });
    expect(form).toMatchObject({
      name: "Henderson Holdings",
      email: "events@henderson.test",
      phone: "205-555-0199",
      clientOrg: "Henderson Holdings LLC",
      eventName: "Corporate picnic",
      date: "2025-08-10",
      guests: 125,
      menuItems: ["picnic-menu"]
    });
    expect(form.email).not.toBe("old@henderson.test");
  });

  test("fails closed when current customer contact cannot prove the same stable scope", () => {
    expect(() => overlayCurrentCustomerContact({
      sourceForm: { eventName: "Corporate picnic" },
      currentCustomer: {
        customerId: "customer-other",
        organizationId: REQUEST.organizationId,
        name: "Henderson Holdings",
        email: "events@henderson.test"
      },
      organizationId: REQUEST.organizationId,
      customerId: "customer-henderson"
    })).toThrow(/stable customer contact/i);
  });

  test("accepts the legacy direct revision form only when the exact version still matches", () => {
    const source = sourceFixture();
    source.quote.acceptanceReceipt.quoteRevisionId = REQUEST.sourceVersionId;
    expect(resolveAcceptedRebookSource({
      request: REQUEST,
      sourceQuote: source.quote,
      sourceVersion: source.version
    }).sourceSnapshot.id).toBe(REQUEST.sourceQuoteId);
  });

  test.each([
    ["organization mismatch", (source) => { source.quote.organizationId = "org-two"; }, "permission-denied"],
    ["not booked", (source) => { source.quote.status = "accepted"; }, "failed-precondition"],
    ["missing customer identity", (source) => { source.quote.customerId = ""; }, "invalid-argument"],
    ["receipt mismatch", (source) => { source.quote.acceptanceReceipt.receiptId = "acceptance-other-12345"; }, "failed-precondition"],
    ["missing acceptance timestamp", (source) => { source.quote.acceptanceReceipt.acceptedAtISO = ""; }, "failed-precondition"],
    ["active version changed", (source) => { source.quote.activeVersionId = "v0004"; }, "aborted"],
    ["accepted revision mismatch", (source) => { source.quote.acceptanceReceipt.quoteRevisionId = "v0002"; }, "aborted"],
    ["synthetic source", (source) => { source.version.legacySynthetic = true; }, "failed-precondition"],
    ["version quote mismatch", (source) => { source.version.quoteId = "quote-other"; }, "failed-precondition"],
    ["snapshot organization mismatch", (source) => { source.version.snapshot.organizationId = "org-two"; }, "failed-precondition"],
    ["version customer mismatch", (source) => { source.version.customerId = "customer-other"; }, "failed-precondition"]
  ])("fails closed on %s", (_label, mutate, code) => {
    const source = sourceFixture();
    mutate(source);
    expect(() => resolveAcceptedRebookSource({
      request: REQUEST,
      sourceQuote: source.quote,
      sourceVersion: source.version
    })).toThrowError(expect.objectContaining({ code }));
  });

  test("derives a stable scoped draft identity and changes it for any source identity change", () => {
    const first = buildRebookDraftId(REQUEST);
    expect(first).toMatch(/^rebook_[a-f0-9]{48}$/);
    expect(buildRebookDraftId(REQUEST)).toBe(first);
    expect(buildRebookDraftId({ ...REQUEST_SCOPE, sourceVersionId: "v0004" })).not.toBe(first);
    expect(() => buildRebookDraftId({
      ...REQUEST,
      rebookingRequestId: "rebook_wrong_source_identity_12345"
    })).toThrow(/server-derived/i);
  });

  test("builds auditable provenance without customer or proposal content", () => {
    const provenance = buildRebookProvenance({
      request: REQUEST,
      customerId: "customer-henderson",
      sourceEventDate: "2025-08-10",
      acceptedAtISO: ACCEPTED_AT_ISO,
      createdAtISO: "2026-08-09T18:00:00.000Z"
    });
    expect(provenance).toEqual({
      schemaVersion: 1,
      sourceOrganizationId: REQUEST.organizationId,
      sourceQuoteId: REQUEST.sourceQuoteId,
      sourceVersionId: REQUEST.sourceVersionId,
      sourceCustomerId: "customer-henderson",
      sourceEventDate: "2025-08-10",
      acceptanceReceiptId: REQUEST.acceptanceReceiptId,
      sourceAcceptedAtISO: ACCEPTED_AT_ISO,
      rebookingRequestId: REQUEST.rebookingRequestId,
      draftCreatedAtISO: "2026-08-09T18:00:00.000Z",
      state: "draft_created_for_staff_review"
    });
    expect(JSON.stringify(provenance)).not.toContain("Henderson Group");
  });

  test("recognizes only the exact server-priced deterministic draft during retry reconciliation", () => {
    const draftId = buildRebookDraftId(REQUEST);
    const provenance = buildRebookProvenance({
      request: REQUEST,
      customerId: "customer-henderson",
      sourceEventDate: "2025-08-10",
      acceptedAtISO: ACCEPTED_AT_ISO,
      createdAtISO: "2026-08-09T18:00:00.000Z"
    });
    const quote = {
      id: draftId,
      organizationId: REQUEST.organizationId,
      status: "draft",
      duplicatedFromQuoteId: REQUEST.sourceQuoteId,
      rebooking: provenance,
      pricing: { authority: "server_authoritative" }
    };
    expect(matchesRebookDraft(quote, { request: REQUEST, expectedDraftId: draftId })).toBe(true);
    expect(matchesRebookDraft({
      ...quote,
      id: ""
    }, { request: REQUEST, expectedDraftId: draftId })).toBe(false);
    expect(matchesRebookDraft({
      ...quote,
      pricing: { authority: "client_preview" }
    }, { request: REQUEST, expectedDraftId: draftId })).toBe(false);
    expect(matchesRebookDraft({
      ...quote,
      rebooking: { ...provenance, sourceVersionId: "v9999" }
    }, { request: REQUEST, expectedDraftId: draftId })).toBe(false);
  });

  test("requires a trusted edit with a later current-or-future date before delivery", () => {
    const pending = buildRebookProvenance({
      request: REQUEST,
      customerId: "customer-henderson",
      sourceEventDate: "2025-08-10",
      acceptedAtISO: ACCEPTED_AT_ISO,
      createdAtISO: "2026-08-09T18:00:00.000Z"
    });
    expect(() => assertRebookReadyForDelivery({
      event: { date: "2025-08-10" },
      rebooking: pending
    })).toThrow(/complete the required rebook review/i);
    expect(() => completeRebookStaffReview({
      rebooking: pending,
      eventDate: "2025-08-10",
      reviewedAtISO: "2026-08-09T19:00:00.000Z",
      tenantTimeZone: "America/Chicago",
      reviewedBy: { uid: "staff-a", email: "staff@example.com", role: "sales" }
    })).toThrow(/current-or-future event date later/i);
    expect(() => completeRebookStaffReview({
      rebooking: pending,
      eventDate: "2026-08-08",
      reviewedAtISO: "2026-08-09T19:00:00.000Z",
      tenantTimeZone: "America/Chicago",
      reviewedBy: { uid: "staff-a", email: "staff@example.com", role: "sales" }
    })).toThrow(/current-or-future event date later/i);

    const completed = completeRebookStaffReview({
      rebooking: pending,
      eventDate: "2026-09-12",
      reviewedAtISO: "2026-08-09T19:00:00.000Z",
      tenantTimeZone: "America/Chicago",
      reviewedBy: { uid: "staff-a", email: "STAFF@EXAMPLE.COM", role: "sales" }
    });
    expect(completed).toMatchObject({
      state: "staff_review_completed",
      sourceEventDate: "2025-08-10",
      reviewedEventDate: "2026-09-12",
      reviewedAtISO: "2026-08-09T19:00:00.000Z",
      reviewedBy: { uid: "staff-a", email: "staff@example.com", role: "sales" },
      reviewCalendar: { date: "2026-08-09", timeZone: "America/Chicago" }
    });
    expect(assertRebookReadyForDelivery({
      event: { date: "2026-09-12" },
      rebooking: completed
    }, {
      nowISO: "2026-09-12T20:00:00.000Z",
      tenantTimeZone: "America/Chicago"
    })).toBe(true);
    expect(() => assertRebookReadyForDelivery({
      event: { date: "2026-10-01" },
      rebooking: completed
    }, {
      nowISO: "2026-09-12T20:00:00.000Z",
      tenantTimeZone: "America/Chicago"
    })).toThrow(/required rebook review/i);
  });

  test("uses the tenant calendar across UTC midnight for review and delivery", () => {
    const pending = buildRebookProvenance({
      request: REQUEST,
      customerId: "customer-henderson",
      sourceEventDate: "2025-08-10",
      acceptedAtISO: ACCEPTED_AT_ISO,
      createdAtISO: "2026-08-09T18:00:00.000Z"
    });
    const completed = completeRebookStaffReview({
      rebooking: pending,
      eventDate: "2026-08-09",
      reviewedAtISO: "2026-08-10T02:30:00.000Z",
      tenantTimeZone: "America/Chicago",
      reviewedBy: { uid: "staff-a", email: "staff@example.com", role: "sales" }
    });

    expect(completed.reviewCalendar).toEqual({
      date: "2026-08-09",
      timeZone: "America/Chicago"
    });
    expect(assertRebookReadyForDelivery({
      event: { date: "2026-08-09" },
      rebooking: completed
    }, {
      nowISO: "2026-08-10T04:59:00.000Z",
      tenantTimeZone: "America/Chicago"
    })).toBe(true);
    expect(() => assertRebookReadyForDelivery({
      event: { date: "2026-08-09" },
      rebooking: completed
    }, {
      nowISO: "2026-08-10T05:01:00.000Z",
      tenantTimeZone: "America/Chicago"
    })).toThrow(/current-or-future event date/i);
  });

  test("keeps recorded review valid after the event while blocking a new delivery", () => {
    const pending = buildRebookProvenance({
      request: REQUEST,
      customerId: "customer-henderson",
      sourceEventDate: "2025-08-10",
      acceptedAtISO: ACCEPTED_AT_ISO,
      createdAtISO: "2026-08-09T18:00:00.000Z"
    });
    const completed = completeRebookStaffReview({
      rebooking: pending,
      eventDate: "2026-09-12",
      reviewedAtISO: "2026-08-09T19:00:00.000Z",
      tenantTimeZone: "America/Chicago",
      reviewedBy: { uid: "staff-a", email: "staff@example.com", role: "sales" }
    });
    const quote = { event: { date: "2026-09-12" }, rebooking: completed };

    expect(assertRebookReviewComplete(quote)).toBe(true);
    expect(() => assertRebookReviewComplete({
      ...quote,
      rebooking: {
        ...completed,
        sourceEventDate: completed.reviewedEventDate
      }
    })).toThrow(/conflicts with the accepted source event/i);
    expect(() => assertRebookCurrentEventDate(quote, {
      nowISO: "2026-09-13T18:00:00.000Z",
      tenantTimeZone: "America/Chicago"
    })).toThrow(/new delivery.*current-or-future event date/i);
  });

  test("uses typed failures for callable translation", () => {
    expect(() => normalizeRebookQuoteDraftRequest({})).toThrow(RebookQuoteDraftError);
  });

  test("keeps rebook provenance out of the public portal projection", () => {
    const portal = buildCanonicalPortalSnapshot("rebook-created", {
      organizationId: REQUEST.organizationId,
      portalKey: "0123456789abcdef0123456789abcdef",
      portalIssuedAtISO: "2026-08-09T18:00:00.000Z",
      portalExpiresAtISO: "2026-09-08T18:00:00.000Z",
      status: "draft",
      rebooking: buildRebookProvenance({
        request: REQUEST,
        customerId: "customer-henderson",
        sourceEventDate: "2025-08-10",
        acceptedAtISO: ACCEPTED_AT_ISO,
        createdAtISO: "2026-08-09T18:00:00.000Z"
      })
    });
    expect(portal).not.toHaveProperty("rebooking");
    expect(JSON.stringify(portal)).not.toContain(REQUEST.sourceQuoteId);
    expect(JSON.stringify(portal)).not.toContain(REQUEST.acceptanceReceiptId);
  });

  test("exports a staff-only exact-version callable that never accepts quote content", () => {
    const start = FUNCTIONS_SOURCE.indexOf("exports.createRebookQuoteDraft =");
    const end = FUNCTIONS_SOURCE.indexOf("\nexports.updateQuoteDraft =", start);
    expect(start).toBeGreaterThan(-1);
    expect(end).toBeGreaterThan(start);
    const callable = FUNCTIONS_SOURCE.slice(start, end);
    expect(callable).toContain("await assertStaff(context");
    expect(callable).toContain("normalizeRebookQuoteDraftRequest(data)");
    expect(callable).toContain('.collection("versions")');
    expect(callable).toContain("resolveAcceptedRebookSource({");
    expect(callable).toContain("buildRebookDraftId(request)");
    expect(callable).toContain("sourceForm: buildDuplicateQuoteForm(resolved.sourceSnapshot)");
    expect(callable).toContain("form: rebookForm");
    expect(callable).toContain("expectedCustomerId: resolved.customerId");
    expect(callable).toContain("expectedCustomerContact: currentCustomer");
    expect(callable).toContain("rebookSourceRequest: request");
    expect(callable).toContain('creationReason: "rebook_quote_create"');
    expect(callable).not.toContain("data?.form");
    expect(callable).not.toContain("data?.customer");
    expect(callable).not.toContain("data?.event");
    expect(callable).not.toContain("data?.pricing");
  });

  test("revalidates the exact booked source and immutable version inside the create transaction", () => {
    const start = FUNCTIONS_SOURCE.indexOf("async function createTrustedQuoteDraftInternal({");
    const end = FUNCTIONS_SOURCE.indexOf("\nasync function updateTrustedQuoteDraftInternal({", start);
    expect(start).toBeGreaterThan(-1);
    expect(end).toBeGreaterThan(start);
    const internal = FUNCTIONS_SOURCE.slice(start, end);

    expect(internal).toContain("normalizedRebookSourceRequest");
    expect(internal).toContain("tx.get(rebookSourceQuoteRef)");
    expect(internal).toContain("tx.get(rebookSourceVersionRef)");
    expect(internal).toContain("tx.get(settingsRef)");
    expect(internal).toContain("assertPricingCatalogAuthorityCurrent(pricingResult.catalogAuthority");
    expect(internal).toContain("resolveAcceptedRebookSource({");
    expect(internal).toContain("The reviewed accepted source changed before the rebook draft could be committed");
    expect(internal.indexOf("tx.get(rebookSourceQuoteRef)"))
      .toBeLessThan(internal.indexOf("tx.create(quoteRef"));
    expect(internal.indexOf("tx.get(settingsRef)"))
      .toBeLessThan(internal.indexOf("tx.create(quoteRef"));
  });

  test("reconciles an existing delivery before enforcing the current event-day gate", () => {
    const start = FUNCTIONS_SOURCE.indexOf("exports.sendQuoteToCustomer =");
    const end = FUNCTIONS_SOURCE.indexOf("\nexports.resolveQuoteDeliveryOutcome", start);
    expect(start).toBeGreaterThan(-1);
    expect(end).toBeGreaterThan(start);
    const callable = FUNCTIONS_SOURCE.slice(start, end);
    const organizationGate = callable.indexOf("normalizeOrganizationId(quote.organizationId) !== organizationId");
    const revisionGate = callable.indexOf("assertQuoteDeliveryRevision(quote");
    const reviewGate = callable.indexOf("assertRebookReviewComplete(quote)");
    const providerSelection = callable.indexOf("const attemptProvider = getEmailProvider()");
    const acceptedReceiptBranch = callable.indexOf('normalizeText(existingDelivery.state).toLowerCase() === "provider_accepted"');
    const currentDateGate = callable.indexOf("assertRebookCurrentEventDate(quote");

    expect(organizationGate).toBeGreaterThan(-1);
    expect(revisionGate).toBeGreaterThan(organizationGate);
    expect(reviewGate).toBeGreaterThan(revisionGate);
    expect(providerSelection).toBeGreaterThan(reviewGate);
    expect(acceptedReceiptBranch).toBeGreaterThan(providerSelection);
    expect(callable).toContain("deliverySettingsSnap.data()?.businessTimeZone");
    expect(currentDateGate).toBeGreaterThan(acceptedReceiptBranch);
  });
});
