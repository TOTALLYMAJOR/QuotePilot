import React, { isValidElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, test, vi } from "vitest";
import {
  CustomerRevenueOpportunitiesPresentation,
  buildCustomerRevenueOpportunityRead,
  describeUnavailableRebookReason,
  resolveCustomerRevenueCalendarContext
} from "../CustomerRevenueOpportunities";
import CustomerRebookDraftAction from "../CustomerRebookDraftAction";

const ORGANIZATION_ID = "org-1";
const CUSTOMER_ID = "customer-1";
const PORTAL_ISSUED_AT_ISO = "2025-07-01T12:00:00.000Z";
const REBOOK_REQUEST_ID = `rebook_${"a".repeat(48)}`;

function makeQuote({ id, date, acceptanceReceipt = undefined } = {}) {
  const activeVersionId = "v0002";
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
    quoteNumber: `QP-${id}`,
    customerId: CUSTOMER_ID,
    organizationId: ORGANIZATION_ID,
    status: "booked",
    activeVersionId,
    event: {
      name: id === "anniversary" ? "Henderson corporate picnic" : "Leadership dinner",
      date,
      venue: "Oak Meadow"
    },
    ...(resolvedReceipt ? { acceptanceReceipt: resolvedReceipt } : {})
  };
}

function makeEvent(quote) {
  return {
    quoteId: quote.id,
    quoteNumber: quote.quoteNumber,
    status: "booked",
    eventName: quote.event.name,
    date: quote.event.date,
    venue: quote.event.venue
  };
}

function makeVersion(quote) {
  return {
    id: "v0002",
    versionId: "v0002",
    quoteId: quote.id,
    organizationId: ORGANIZATION_ID,
    customerId: quote.customerId,
    snapshot: {
      id: quote.id,
      organizationId: ORGANIZATION_ID,
      customerId: quote.customerId,
      event: { ...quote.event }
    }
  };
}

function makeRebookDescendant(sourceQuote, {
  status = "draft",
  eventDate = sourceQuote.event.date,
  reviewCompleted = false
} = {}) {
  return {
    id: "rebook-anniversary",
    quoteNumber: "QP-REBOOK-1",
    customerId: sourceQuote.customerId,
    organizationId: sourceQuote.organizationId,
    status,
    duplicatedFromQuoteId: sourceQuote.id,
    pricing: { authority: "server_authoritative" },
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
      state: reviewCompleted
        ? "staff_review_completed"
        : "draft_created_for_staff_review",
      ...(reviewCompleted
        ? {
          reviewedEventDate: eventDate,
          reviewedAtISO: "2026-08-12T12:30:00.000Z",
          reviewCalendar: {
            date: "2026-08-12",
            timeZone: "America/Chicago"
          },
          reviewedBy: {
            uid: "staff-1",
            email: "sales@example.com",
            role: "sales"
          }
        }
        : {})
    }
  };
}

function makeWorkspace({ quotes, proposalVersions = [], truncated = false } = {}) {
  return {
    source: "firebase",
    customer: {
      id: CUSTOMER_ID,
      customerId: CUSTOMER_ID,
      name: "Henderson Group"
    },
    quotes,
    events: quotes.map(makeEvent),
    proposalVersions,
    quotePageInfo: { limit: 25, truncated },
    versionPageInfo: { perQuoteLimit: 10, truncatedQuoteIds: [] }
  };
}

function elementText(node) {
  if (typeof node === "string" || typeof node === "number") return String(node);
  if (Array.isArray(node)) return node.map(elementText).join("");
  if (!isValidElement(node)) return "";
  if (typeof node.type === "function") return elementText(node.type(node.props));
  return elementText(node.props.children);
}

function findElement(node, predicate) {
  if (!isValidElement(node)) return null;
  if (predicate(node)) return node;
  if (node.type === CustomerRebookDraftAction) return null;
  if (typeof node.type === "function") return findElement(node.type(node.props), predicate);
  const children = Array.isArray(node.props.children) ? node.props.children : [node.props.children];
  for (const child of children) {
    const match = findElement(child, predicate);
    if (match) return match;
  }
  return null;
}

describe("Customer revenue opportunities presentation", () => {
  test("derives one honest tenant or device calendar context per completed read instant", () => {
    const loadedAt = Date.parse("2026-08-10T01:30:00.000Z");

    expect(resolveCustomerRevenueCalendarContext({
      loadedAt,
      tenantTimeZone: "America/Chicago",
      deviceTimeZone: "Asia/Tokyo"
    })).toEqual({
      date: "2026-08-09",
      source: "tenant",
      timeZone: "America/Chicago"
    });
    expect(resolveCustomerRevenueCalendarContext({
      loadedAt,
      deviceTimeZone: "Asia/Tokyo"
    })).toEqual({
      date: "2026-08-10",
      source: "device",
      timeZone: "Asia/Tokyo"
    });
    expect(() => resolveCustomerRevenueCalendarContext({
      loadedAt,
      tenantTimeZone: "not-a-time-zone",
      deviceTimeZone: "UTC"
    })).toThrow(/explicitly supplied tenant time zone/i);
  });

  test("renders closeout review work and an evidence-safe anniversary source action", () => {
    const closeoutQuote = makeQuote({ id: "closeout", date: "2026-08-05" });
    const anniversaryQuote = makeQuote({ id: "anniversary", date: "2025-08-14" });
    const workspace = makeWorkspace({
      quotes: [closeoutQuote, anniversaryQuote],
      proposalVersions: [makeVersion(anniversaryQuote)]
    });
    const radar = buildCustomerRevenueOpportunityRead({
      workspace,
      organizationId: ORGANIZATION_ID,
      loadedAt: Date.parse("2026-08-12T12:00:00.000Z"),
      deviceTimeZone: "America/Chicago"
    });
    const onOpenQuote = vi.fn();
    const tree = CustomerRevenueOpportunitiesPresentation({ radar, onOpenQuote });
    const markup = renderToStaticMarkup(tree);
    const anniversaryArticle = findElement(tree, (element) => (
      element.props["data-opportunity-type"] === "anniversary_rebooking"
    ));
    const sourceButton = findElement(anniversaryArticle, (element) => (
      element.type === "button" && elementText(element) === "Open source quote"
    ));
    const rebookAction = findElement(anniversaryArticle, (element) => (
      element.type === CustomerRebookDraftAction
    ));

    expect(markup).toContain('data-capability-id="cwf-11-rebooking-radar"');
    expect(markup).toContain('data-capability-state="success"');
    expect(markup).toContain("Revenue opportunities");
    expect(markup).toContain("Device-local calendar date");
    expect(markup).toContain("America/Chicago");
    expect(markup).toContain("Leadership dinner reached its one-week closeout window");
    expect(markup).toContain("Review the internal event closeout");
    expect(markup).toContain("No thank-you or review request was sent");
    expect(markup).toContain("Henderson corporate picnic was scheduled for this week last year");
    expect(markup).toContain("Accepted source identified: version v0002");
    expect(markup).toContain("No matching trusted rebook record was found in this completed bounded customer read");
    expect(markup).toContain("not a lead, booking, delivery, payment, or revenue fact");
    expect(markup).not.toContain("Rebook now");
    expect(sourceButton.props["data-capability-action"]).toBe("open-authoritative-source-quote");
    expect(rebookAction.props.reviewedAction).toMatchObject({
      sourceQuoteId: "anniversary",
      sourceVersionId: "v0002"
    });
    sourceButton.props.onClick();
    expect(onOpenQuote).toHaveBeenCalledWith("anniversary");
  });

  test("opens an exact pending descendant for edit instead of rendering another create action", () => {
    const source = makeQuote({ id: "anniversary", date: "2025-08-14" });
    const descendant = makeRebookDescendant(source);
    const radar = buildCustomerRevenueOpportunityRead({
      workspace: makeWorkspace({
        quotes: [descendant, source],
        proposalVersions: [makeVersion(source)],
        truncated: true
      }),
      organizationId: ORGANIZATION_ID,
      loadedAt: Date.parse("2026-08-12T12:00:00.000Z"),
      deviceTimeZone: "America/Chicago"
    });
    const onOpenQuote = vi.fn();
    const onOpenQuoteEdit = vi.fn();
    const tree = (
      <CustomerRevenueOpportunitiesPresentation
        radar={radar}
        onOpenQuote={onOpenQuote}
        onOpenQuoteEdit={onOpenQuoteEdit}
      />
    );
    const markup = renderToStaticMarkup(tree);
    const existingButton = findElement(tree, (element) => (
      element.type === "button"
      && element.props["data-capability-action"] === "open-existing-rebook"
    ));

    expect(markup).toContain("Matching rebook found: QP-REBOOK-1 (draft)");
    expect(markup).toContain("Staff review required");
    expect(markup).not.toContain("No matching trusted rebook record was found");
    expect(existingButton.props["data-existing-quote-id"]).toBe("rebook-anniversary");
    expect(elementText(existingButton)).toBe("Open draft to review");
    expect(findElement(tree, (element) => element.type === CustomerRebookDraftAction)).toBeNull();
    existingButton.props.onClick();
    expect(onOpenQuoteEdit).toHaveBeenCalledWith("rebook-anniversary");
    expect(onOpenQuote).not.toHaveBeenCalledWith("rebook-anniversary");
  });

  test("opens a progressed reviewed descendant as its authoritative quote record", () => {
    const source = makeQuote({ id: "anniversary", date: "2025-08-14" });
    const descendant = makeRebookDescendant(source, {
      status: "sent",
      eventDate: "2026-09-12",
      reviewCompleted: true
    });
    const radar = buildCustomerRevenueOpportunityRead({
      workspace: makeWorkspace({
        quotes: [descendant, source],
        proposalVersions: [makeVersion(source)]
      }),
      organizationId: ORGANIZATION_ID,
      loadedAt: Date.parse("2026-08-12T12:00:00.000Z"),
      deviceTimeZone: "America/Chicago"
    });
    const onOpenQuote = vi.fn();
    const onOpenQuoteEdit = vi.fn();
    const tree = (
      <CustomerRevenueOpportunitiesPresentation
        radar={radar}
        onOpenQuote={onOpenQuote}
        onOpenQuoteEdit={onOpenQuoteEdit}
      />
    );
    const existingButton = findElement(tree, (element) => (
      element.type === "button"
      && element.props["data-capability-action"] === "open-existing-rebook"
    ));

    expect(renderToStaticMarkup(tree)).toContain("Staff review completed");
    expect(elementText(existingButton)).toBe("Open matching quote");
    existingButton.props.onClick();
    expect(onOpenQuote).toHaveBeenCalledWith("rebook-anniversary");
    expect(onOpenQuoteEdit).not.toHaveBeenCalled();
  });

  test("translates unavailable accepted-source evidence without exposing machine reason codes", () => {
    const quote = makeQuote({
      id: "anniversary",
      date: "2025-08-14",
      acceptanceReceipt: null
    });
    const radar = buildCustomerRevenueOpportunityRead({
      workspace: makeWorkspace({ quotes: [quote] }),
      organizationId: ORGANIZATION_ID,
      loadedAt: Date.parse("2026-08-12T12:00:00.000Z"),
      tenantTimeZone: "America/Chicago"
    });
    const markup = renderToStaticMarkup(
      <CustomerRevenueOpportunitiesPresentation radar={radar} onOpenQuote={() => {}} />
    );

    expect(describeUnavailableRebookReason("acceptance_receipt_missing"))
      .toBe("No acceptance receipt is available for this booked quote.");
    expect(markup).toContain("Rebook source unavailable");
    expect(markup).toContain("No acceptance receipt is available for this booked quote.");
    expect(markup).not.toContain("acceptance_receipt_missing");
    expect(markup).not.toContain("Rebook now");
  });

  test("keeps creation unavailable when a bounded quote read cannot rule out an existing rebook", () => {
    const quote = makeQuote({ id: "anniversary", date: "2025-08-14" });
    const radar = buildCustomerRevenueOpportunityRead({
      workspace: makeWorkspace({
        quotes: [quote],
        proposalVersions: [makeVersion(quote)],
        truncated: true
      }),
      organizationId: ORGANIZATION_ID,
      loadedAt: Date.parse("2026-08-12T12:00:00.000Z"),
      tenantTimeZone: "America/Chicago"
    });
    const tree = <CustomerRevenueOpportunitiesPresentation radar={radar} />;
    const markup = renderToStaticMarkup(tree);

    expect(describeUnavailableRebookReason(
      "existing_rebook_not_found_quote_history_truncated"
    )).toContain("outside this bounded Customer 360 quote read");
    expect(describeUnavailableRebookReason("existing_rebook_invalid"))
      .toContain("trusted provenance is incomplete");
    expect(markup).toContain("A matching rebook may exist outside this bounded Customer 360 quote read");
    expect(markup).not.toContain("No matching trusted rebook record was found");
    expect(findElement(tree, (element) => element.type === CustomerRebookDraftAction)).toBeNull();
  });

  test("shows explicit empty, partial, source, bounds, and evaluation error states", () => {
    const baseRadar = {
      status: "empty",
      source: "firebase",
      calendarContext: {
        date: "2026-08-12",
        source: "device",
        timeZone: "America/Chicago",
        label: "Device-local calendar date"
      },
      evidenceCopy: {
        opportunity: "This is a read-only opportunity, not a completed commercial outcome."
      },
      opportunities: [],
      pageInfo: {
        limit: 12,
        returned: 0,
        candidateCount: 0,
        radarTruncated: false,
        quoteReadTruncated: false,
        versionReadTruncated: false
      }
    };
    const emptyMarkup = renderToStaticMarkup(
      <CustomerRevenueOpportunitiesPresentation radar={baseRadar} />
    );
    const partialMarkup = renderToStaticMarkup(
      <CustomerRevenueOpportunitiesPresentation
        radar={{
          ...baseRadar,
          status: "partial",
          pageInfo: {
            ...baseRadar.pageInfo,
            quoteReadTruncated: true,
            versionReadTruncated: true
          }
        }}
      />
    );
    const errorMarkup = renderToStaticMarkup(
      <CustomerRevenueOpportunitiesPresentation error="calendar unavailable" />
    );

    expect(emptyMarkup).toContain('data-capability-state="empty"');
    expect(emptyMarkup).toContain("Source: Firestore customer workspace");
    expect(emptyMarkup).toContain("Evaluation bound: first 12 eligible opportunities");
    expect(emptyMarkup).toContain("No closeout or anniversary cues fall within this calendar window");
    expect(partialMarkup).toContain('data-capability-state="partial"');
    expect(partialMarkup).toContain("Older linked quotes may contain additional opportunities");
    expect(partialMarkup).toContain("retained proposal history loaded here");
    expect(errorMarkup).toContain('data-capability-state="error"');
    expect(errorMarkup).toContain('role="alert"');
    expect(errorMarkup).toContain("No actions were created");
  });

  test("labels retained opportunities during refresh and stale recovery", () => {
    const radar = {
      status: "success",
      source: "firebase",
      calendarContext: {
        date: "2026-08-12",
        source: "device",
        timeZone: "America/Chicago",
        label: "Device-local calendar date"
      },
      evidenceCopy: { opportunity: "Read-only opportunity evidence." },
      opportunities: [],
      pageInfo: {
        limit: 12,
        returned: 0,
        candidateCount: 0,
        radarTruncated: false,
        quoteReadTruncated: false,
        versionReadTruncated: false
      }
    };
    const refreshingMarkup = renderToStaticMarkup(
      <CustomerRevenueOpportunitiesPresentation radar={radar} loading />
    );
    const staleMarkup = renderToStaticMarkup(
      <CustomerRevenueOpportunitiesPresentation radar={radar} stale />
    );

    expect(refreshingMarkup).toContain('data-capability-state="loading"');
    expect(refreshingMarkup).toContain('data-read-state="refreshing"');
    expect(refreshingMarkup).toContain("prior opportunity evaluation remains visible");
    expect(staleMarkup).toContain('data-capability-state="stale"');
    expect(staleMarkup).toContain("retained snapshot and may be stale");
  });
});
