import { describe, expect, test } from "vitest";
import {
  CUSTOMER_REBOOKING_RADAR_EVIDENCE_COPY,
  POST_EVENT_CLOSEOUT_START_DAYS,
  POST_EVENT_CLOSEOUT_WINDOW_DAYS,
  buildCustomerRebookingRadar
} from "../customerRebookingRadar";

const ORGANIZATION_ID = "org-1";
const CUSTOMER_ID = "customer-1";
const PORTAL_ISSUED_AT_ISO = "2025-07-01T12:00:00.000Z";
const REBOOK_REQUEST_ID = `rebook_${"a".repeat(48)}`;

function makeQuote({
  id = "quote-1",
  date = "2025-08-14",
  status = "booked",
  customerId = CUSTOMER_ID,
  organizationId = ORGANIZATION_ID,
  activeVersionId = "v0002",
  acceptanceReceipt = undefined
} = {}) {
  const resolvedReceipt = acceptanceReceipt === undefined
    ? {
        receiptId: `acceptance-${id}`,
        acceptedAtISO: "2025-07-02T12:00:00.000Z",
        portalIssuedAtISO: PORTAL_ISSUED_AT_ISO,
        quoteRevisionId: `${activeVersionId}@${PORTAL_ISSUED_AT_ISO}`
      }
    : acceptanceReceipt;
  return {
    id,
    quoteNumber: `Q-${id}`,
    customerId,
    organizationId,
    status,
    activeVersionId,
    latestVersionNumber: 3,
    event: {
      name: "Corporate picnic",
      date,
      venue: "Oak Meadow"
    },
    booking: {
      contractNumber: `C-${id}`,
      contractConvertedAtISO: "2025-07-03T12:00:00.000Z"
    },
    ...(resolvedReceipt ? { acceptanceReceipt: resolvedReceipt } : {})
  };
}

function makeEvent(quote, overrides = {}) {
  return {
    quoteId: quote.id,
    quoteNumber: quote.quoteNumber,
    status: quote.status,
    eventName: quote.event.name,
    date: quote.event.date,
    venue: quote.event.venue,
    ...overrides
  };
}

function makeVersion(quote, versionId = "v0002", overrides = {}) {
  return {
    id: versionId,
    versionId,
    quoteId: quote.id,
    organizationId: quote.organizationId,
    customerId: quote.customerId,
    versionNumber: Number(versionId.replace(/^v0*/, "")) || 1,
    createdAtISO: "2025-07-01T10:00:00.000Z",
    snapshot: {
      id: quote.id,
      organizationId: quote.organizationId,
      customerId: quote.customerId,
      event: { ...quote.event }
    },
    ...overrides
  };
}

function makeRebookDescendant(sourceQuote, {
  id = `rebook-${sourceQuote.id}`,
  status = "draft",
  customerId = sourceQuote.customerId,
  organizationId = sourceQuote.organizationId,
  duplicatedFromQuoteId = sourceQuote.id,
  pricingAuthority = "server_authoritative",
  eventDate = sourceQuote.event.date,
  rebooking = {}
} = {}) {
  return {
    id,
    quoteNumber: `Q-${id}`,
    customerId,
    organizationId,
    status,
    duplicatedFromQuoteId,
    pricing: { authority: pricingAuthority },
    event: {
      name: sourceQuote.event.name,
      date: eventDate,
      venue: sourceQuote.event.venue
    },
    rebooking: {
      schemaVersion: 1,
      sourceOrganizationId: sourceQuote.organizationId,
      sourceQuoteId: sourceQuote.id,
      sourceVersionId: sourceQuote.activeVersionId,
      sourceCustomerId: sourceQuote.customerId,
      sourceEventDate: sourceQuote.event.date,
      acceptanceReceiptId: sourceQuote.acceptanceReceipt.receiptId,
      sourceAcceptedAtISO: sourceQuote.acceptanceReceipt.acceptedAtISO,
      rebookingRequestId: REBOOK_REQUEST_ID,
      draftCreatedAtISO: "2026-08-12T12:00:00.000Z",
      state: "draft_created_for_staff_review",
      ...rebooking
    }
  };
}

function makeWorkspace({
  quotes = [],
  events = quotes.map((quote) => makeEvent(quote)),
  proposalVersions = quotes.flatMap((quote) => [makeVersion(quote)]),
  quoteTruncated = false,
  versionTruncatedQuoteIds = []
} = {}) {
  return {
    source: "firebase",
    customer: {
      id: CUSTOMER_ID,
      customerId: CUSTOMER_ID,
      name: "Henderson Group"
    },
    quotes,
    events,
    proposalVersions,
    quotePageInfo: {
      limit: 25,
      truncated: quoteTruncated
    },
    versionPageInfo: {
      perQuoteLimit: 10,
      truncatedQuoteIds: versionTruncatedQuoteIds
    }
  };
}

function build(workspace, {
  date = "2026-08-12",
  source = "tenant",
  timeZone = "America/Chicago",
  limit
} = {}) {
  return buildCustomerRebookingRadar(workspace, {
    organizationId: ORGANIZATION_ID,
    calendarContext: { date, source, timeZone },
    ...(limit === undefined ? {} : { limit })
  });
}

describe("Customer 360 rebooking radar", () => {
  test("opens one bounded closeout window beginning seven calendar days after a booked event", () => {
    const eligible = makeQuote({ id: "eligible", date: "2026-08-08" });
    const tooEarly = makeQuote({ id: "too-early", date: "2026-08-09" });
    const tooLate = makeQuote({ id: "too-late", date: "2026-08-01" });

    const radar = build(makeWorkspace({ quotes: [eligible, tooEarly, tooLate] }), {
      date: "2026-08-15"
    });

    expect(POST_EVENT_CLOSEOUT_START_DAYS).toBe(7);
    expect(POST_EVENT_CLOSEOUT_WINDOW_DAYS).toBe(7);
    expect(radar.opportunities).toHaveLength(1);
    expect(radar.opportunities[0]).toMatchObject({
      id: "post_event_closeout:eligible:2026-08-08",
      type: "post_event_closeout",
      timing: {
        calendarDate: "2026-08-15",
        daysSinceEvent: 7,
        eligibleFromDate: "2026-08-15",
        eligibleThroughDate: "2026-08-21"
      },
      reviewedAction: null,
      evidenceCopy: CUSTOMER_REBOOKING_RADAR_EVIDENCE_COPY.closeout
    });
    expect(radar.opportunities[0].reviewItems.map((item) => item.code)).toEqual([
      "internal_closeout",
      "thank_you",
      "review_request",
      "operational_follow_up"
    ]);
    expect(radar.excludedReasonCounts.outside_opportunity_window).toBe(2);
  });

  test("creates a same-week-last-year anniversary cue from calendar dates", () => {
    const sameWeek = makeQuote({ id: "same-week", date: "2025-08-14" });
    const nextWeek = makeQuote({ id: "next-week", date: "2025-08-18" });

    const radar = build(makeWorkspace({ quotes: [sameWeek, nextWeek] }), {
      date: "2026-08-12"
    });

    expect(radar.opportunities).toHaveLength(1);
    expect(radar.opportunities[0]).toMatchObject({
      id: "anniversary_rebooking:same-week:2025-08-14",
      type: "anniversary_rebooking",
      title: "Corporate picnic was scheduled for this week last year",
      timing: {
        calendarDate: "2026-08-12",
        anniversaryDate: "2026-08-14"
      }
    });
    expect(radar.excludedReasonCounts.outside_opportunity_window).toBe(1);
  });

  test("selects the exact accepted immutable version instead of the newest loaded version", () => {
    const quote = makeQuote({ id: "accepted-source", date: "2025-08-14" });
    const versions = [
      makeVersion(quote, "v0003", { createdAtISO: "2025-07-04T10:00:00.000Z" }),
      makeVersion(quote, "v0001", { createdAtISO: "2025-06-30T10:00:00.000Z" }),
      makeVersion(quote, "v0002", { createdAtISO: "2025-07-01T10:00:00.000Z" })
    ];

    const radar = build(makeWorkspace({ quotes: [quote], proposalVersions: versions }));
    const action = radar.opportunities[0].reviewedAction;

    expect(action).toEqual({
      kind: "review_rebook_draft",
      state: "ready_for_staff_review",
      label: "Review rebook from accepted proposal",
      sourceQuoteId: "accepted-source",
      sourceVersionId: "v0002",
      acceptanceReceiptId: "acceptance-accepted-source",
      acceptedAtISO: "2025-07-02T12:00:00.000Z",
      performed: false,
      requiredExecution: {
        trustedDuplication: true,
        serverAuthoritativeRepricing: true,
        explicitStaffReview: true,
        newCustomerDecisionCycle: true
      }
    });
    expect(action).not.toHaveProperty("snapshot");
    expect(action).not.toHaveProperty("pricing");
  });

  test("reconciles one exact same-tenant customer descendant instead of offering another draft", () => {
    const source = makeQuote({ id: "accepted-source", date: "2025-08-14" });
    const descendant = makeRebookDescendant(source);
    const radar = build(makeWorkspace({
      quotes: [descendant, source],
      proposalVersions: [],
      quoteTruncated: true,
      versionTruncatedQuoteIds: [source.id]
    }));

    expect(radar.opportunities[0].reviewedAction).toEqual({
      kind: "review_rebook_draft",
      state: "existing_rebook",
      label: "Open rebook draft for staff review",
      sourceQuoteId: "accepted-source",
      sourceVersionId: "v0002",
      acceptanceReceiptId: "acceptance-accepted-source",
      acceptedAtISO: "2025-07-02T12:00:00.000Z",
      performed: true,
      existingQuoteId: "rebook-accepted-source",
      existingQuoteNumber: "Q-rebook-accepted-source",
      existingQuoteStatus: "draft",
      existingReviewState: "draft_created_for_staff_review",
      existingEventDate: "2025-08-14",
      rebookingRequestId: REBOOK_REQUEST_ID,
      openIntent: "edit"
    });
    expect(radar.status).toBe("partial");
  });

  test("exposes a completed descendant as a viewable existing rebook", () => {
    const source = makeQuote({ id: "accepted-source", date: "2025-08-14" });
    const descendant = makeRebookDescendant(source, {
      status: "sent",
      eventDate: "2026-09-12",
      rebooking: {
        state: "staff_review_completed",
        reviewedEventDate: "2026-09-12",
        reviewedAtISO: "2026-08-12T12:30:00.000Z",
        reviewedBy: {
          uid: "staff-1",
          email: "sales@example.com",
          role: "sales"
        },
        reviewCalendar: {
          date: "2026-08-12",
          timeZone: "America/Chicago"
        }
      }
    });
    const action = build(makeWorkspace({ quotes: [descendant, source] }))
      .opportunities[0].reviewedAction;

    expect(action).toMatchObject({
      state: "existing_rebook",
      performed: true,
      existingQuoteId: "rebook-accepted-source",
      existingQuoteStatus: "sent",
      existingReviewState: "staff_review_completed",
      existingEventDate: "2026-09-12",
      openIntent: "view"
    });
  });

  test("validates completed review evidence in its persisted tenant calendar instead of UTC", () => {
    const source = makeQuote({ id: "accepted-source", date: "2025-08-14" });
    const descendant = makeRebookDescendant(source, {
      status: "sent",
      eventDate: "2027-09-12",
      rebooking: {
        state: "staff_review_completed",
        reviewedEventDate: "2027-09-12",
        reviewedAtISO: "2027-01-01T07:30:00.000Z",
        reviewedBy: {
          uid: "staff-1",
          email: "sales@example.com",
          role: "sales"
        },
        reviewCalendar: {
          date: "2026-12-31",
          timeZone: "America/Los_Angeles"
        }
      }
    });

    const action = build(makeWorkspace({ quotes: [descendant, source] }))
      .opportunities[0].reviewedAction;

    expect(action).toMatchObject({
      state: "existing_rebook",
      existingReviewState: "staff_review_completed",
      existingQuoteId: descendant.id,
      openIntent: "view"
    });
  });

  test("ignores cross-scope records and ordinary duplicates when no rebook descendant exists", () => {
    const source = makeQuote({ id: "accepted-source", date: "2025-08-14" });
    const lookalikes = [
      makeRebookDescendant(source, { id: "wrong-org", organizationId: "org-2" }),
      makeRebookDescendant(source, { id: "wrong-customer", customerId: "customer-2" }),
      {
        ...makeRebookDescendant(source, { id: "ordinary-duplicate" }),
        rebooking: null
      },
      makeRebookDescendant(source, {
        id: "unrelated-rebook",
        duplicatedFromQuoteId: "quote-other",
        rebooking: { sourceQuoteId: "quote-other" }
      })
    ];
    const action = build(makeWorkspace({ quotes: [...lookalikes, source] }))
      .opportunities.find((opportunity) => opportunity.quoteId === source.id)
      .reviewedAction;

    expect(action).toMatchObject({
      state: "ready_for_staff_review",
      performed: false,
      sourceQuoteId: source.id
    });
  });

  test("fails closed for a same-scope descendant claim with invalid provenance", () => {
    const source = makeQuote({ id: "accepted-source", date: "2025-08-14" });
    const invalidClaims = [
      makeRebookDescendant(source, {
        id: "wrong-source-version",
        rebooking: { sourceVersionId: "v0001" }
      }),
      makeRebookDescendant(source, {
        id: "wrong-receipt",
        rebooking: { acceptanceReceiptId: "acceptance-other" }
      }),
      makeRebookDescendant(source, {
        id: "wrong-source-customer",
        rebooking: { sourceCustomerId: "customer-2" }
      }),
      makeRebookDescendant(source, {
        id: "wrong-accepted-at",
        rebooking: { sourceAcceptedAtISO: "2025-07-03T12:00:00.000Z" }
      }),
      makeRebookDescendant(source, {
        id: "wrong-request-id",
        rebooking: { rebookingRequestId: "rebook_not_server_derived" }
      }),
      makeRebookDescendant(source, {
        id: "wrong-duplicate-source",
        duplicatedFromQuoteId: "quote-other"
      }),
      makeRebookDescendant(source, {
        id: "untrusted-pricing",
        pricingAuthority: "browser_calculated"
      }),
      makeRebookDescendant(source, {
        id: "invalid-review",
        status: "sent",
        eventDate: "2026-09-12",
        rebooking: { state: "staff_review_completed" }
      }),
      makeRebookDescendant(source, { id: "deleted-rebook", status: "deleted" })
    ];

    invalidClaims.forEach((candidate) => {
      const action = build(makeWorkspace({ quotes: [candidate, source] }))
        .opportunities.find((opportunity) => opportunity.quoteId === source.id)
        .reviewedAction;
      expect(action).toMatchObject({
        state: "unavailable",
        reason: "existing_rebook_invalid",
        sourceQuoteId: source.id,
        performed: false
      });
    });
  });

  test("fails closed when no exact descendant is found in a truncated quote read", () => {
    const source = makeQuote({ id: "accepted-source", date: "2025-08-14" });
    const action = build(makeWorkspace({
      quotes: [source],
      quoteTruncated: true
    })).opportunities[0].reviewedAction;

    expect(action).toMatchObject({
      state: "unavailable",
      reason: "existing_rebook_not_found_quote_history_truncated",
      sourceQuoteId: "accepted-source",
      sourceVersionId: "v0002",
      acceptanceReceiptId: "acceptance-accepted-source",
      performed: false
    });
  });

  test("fails closed when more than one exact descendant claims the accepted source", () => {
    const source = makeQuote({ id: "accepted-source", date: "2025-08-14" });
    const action = build(makeWorkspace({
      quotes: [
        makeRebookDescendant(source, { id: "rebook-one" }),
        makeRebookDescendant(source, {
          id: "rebook-two",
          rebooking: { rebookingRequestId: `rebook_${"b".repeat(48)}` }
        }),
        source
      ]
    })).opportunities[0].reviewedAction;

    expect(action).toMatchObject({
      state: "unavailable",
      reason: "existing_rebook_ambiguous",
      sourceQuoteId: "accepted-source",
      performed: false
    });
  });

  test("fails closed with an exact reason when accepted source evidence cannot be selected", () => {
    const missingReceipt = makeQuote({
      id: "missing-receipt",
      date: "2025-08-14",
      acceptanceReceipt: null
    });
    const missingVersion = makeQuote({ id: "missing-version", date: "2025-08-15" });
    const mismatchedReceipt = makeQuote({
      id: "mismatched-receipt",
      date: "2025-08-16",
      acceptanceReceipt: {
        receiptId: "acceptance-mismatch",
        acceptedAtISO: "2025-07-02T12:00:00.000Z",
        portalIssuedAtISO: PORTAL_ISSUED_AT_ISO,
        quoteRevisionId: `v0001@${PORTAL_ISSUED_AT_ISO}`
      }
    });
    const workspace = makeWorkspace({
      quotes: [missingReceipt, missingVersion, mismatchedReceipt],
      proposalVersions: [
        makeVersion(missingReceipt),
        makeVersion(mismatchedReceipt)
      ],
      versionTruncatedQuoteIds: ["missing-version"]
    });

    const radar = build(workspace);
    const actions = Object.fromEntries(radar.opportunities.map((opportunity) => [
      opportunity.quoteId,
      opportunity.reviewedAction
    ]));

    expect(actions["missing-receipt"]).toMatchObject({
      state: "unavailable",
      reason: "acceptance_receipt_missing",
      performed: false
    });
    expect(actions["missing-version"]).toMatchObject({
      state: "unavailable",
      reason: "accepted_source_version_not_loaded_history_truncated",
      performed: false
    });
    expect(actions["mismatched-receipt"]).toMatchObject({
      state: "unavailable",
      reason: "accepted_revision_mismatch",
      performed: false
    });
    expect(radar.status).toBe("partial");
  });

  test("retains the exact evaluation instant alongside tenant or device calendar context", () => {
    const quote = makeQuote({ id: "calendar-context", date: "2025-08-14" });
    const workspace = makeWorkspace({ quotes: [quote] });

    const tenant = build(workspace, {
      date: "2026-08-12",
      source: "tenant",
      timeZone: "America/Chicago"
    });
    const device = build(workspace, {
      date: "2026-08-12",
      source: "device",
      timeZone: "Pacific/Honolulu"
    });

    expect(tenant.opportunities.map((item) => item.id)).toEqual(
      device.opportunities.map((item) => item.id)
    );
    expect(tenant.calendarContext).toEqual({
      date: "2026-08-12",
      source: "tenant",
      timeZone: "America/Chicago",
      instantISO: "2026-08-12T12:00:00.000Z",
      label: "Tenant-local calendar date"
    });
    expect(device.calendarContext).toEqual({
      date: "2026-08-12",
      source: "device",
      timeZone: "Pacific/Honolulu",
      instantISO: "2026-08-12T12:00:00.000Z",
      label: "Device-local calendar date"
    });
    expect(Object.isFrozen(tenant)).toBe(true);
    expect(build(workspace)).toEqual(build(workspace));

    expect(() => build(workspace, { date: "2026-02-30" })).toThrow(/valid YYYY-MM-DD/);
    expect(() => build(workspace, { source: "server" })).toThrow(/tenant or device/);
    expect(() => build(workspace, { timeZone: "Not/AZone" })).toThrow(/valid IANA/);
  });

  test("excludes records that do not prove the same-customer booked event scope", () => {
    const foreignCustomer = makeQuote({ id: "foreign-customer", customerId: "customer-2" });
    const foreignOrganization = makeQuote({ id: "foreign-org", organizationId: "org-2" });
    const notBooked = makeQuote({ id: "not-booked", status: "accepted" });
    const missingEvent = makeQuote({ id: "missing-event" });
    const eventNotBooked = makeQuote({ id: "event-not-booked" });
    const mismatchedDate = makeQuote({ id: "mismatched-date" });
    const invalidDate = makeQuote({ id: "invalid-date", date: "2025-02-30" });
    const ambiguousEvent = makeQuote({ id: "ambiguous-event" });
    const quotes = [
      foreignCustomer,
      foreignOrganization,
      notBooked,
      missingEvent,
      eventNotBooked,
      mismatchedDate,
      invalidDate,
      ambiguousEvent
    ];
    const events = [
      makeEvent(foreignCustomer),
      makeEvent(foreignOrganization),
      makeEvent(notBooked),
      makeEvent(eventNotBooked, { status: "accepted" }),
      makeEvent(mismatchedDate, { date: "2025-08-13" }),
      makeEvent(invalidDate),
      makeEvent(ambiguousEvent),
      makeEvent(ambiguousEvent)
    ];

    const radar = build(makeWorkspace({ quotes, events }));

    expect(radar.opportunities).toEqual([]);
    expect(radar.excludedReasonCounts).toEqual({
      customer_scope_mismatch: 1,
      event_date_invalid: 1,
      event_date_mismatch: 1,
      event_not_booked: 1,
      event_record_ambiguous: 1,
      event_record_missing: 1,
      organization_scope_mismatch: 1,
      quote_not_booked: 1
    });
  });

  test("bounds opportunities and states the non-action evidence contract", () => {
    const quotes = [10, 11, 12, 13].map((day) => makeQuote({
      id: `quote-${day}`,
      date: `2025-08-${day}`
    }));

    const radar = build(makeWorkspace({ quotes }), { limit: 2 });

    expect(radar.status).toBe("partial");
    expect(radar.pageInfo).toMatchObject({
      limit: 2,
      returned: 2,
      candidateCount: 4,
      radarTruncated: true,
      truncated: true
    });
    expect(radar.evidenceCopy).toEqual(CUSTOMER_REBOOKING_RADAR_EVIDENCE_COPY);
    expect(radar.evidenceCopy.opportunity).toContain(
      "does not create a lead, booking, delivery, payment, or revenue record"
    );
    expect(radar.evidenceCopy.closeout).toContain("No thank-you or review request was sent");
    expect(radar.evidenceCopy.rebook).toContain(
      "Trusted duplication and current server-authoritative repricing remain required"
    );
  });
});
