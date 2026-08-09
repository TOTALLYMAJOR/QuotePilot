import React, { isValidElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, test, vi } from "vitest";
import {
  CustomerRevenueOpportunitiesPresentation,
  buildCustomerRevenueOpportunityRead,
  describeUnavailableRebookReason,
  resolveCustomerRevenueCalendarContext
} from "../CustomerRevenueOpportunities";

const ORGANIZATION_ID = "org-1";
const CUSTOMER_ID = "customer-1";
const PORTAL_ISSUED_AT_ISO = "2025-07-01T12:00:00.000Z";

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
    snapshot: {
      id: quote.id,
      organizationId: ORGANIZATION_ID,
      event: { ...quote.event }
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
  if (typeof node.type === "function") return findElement(node.type(node.props), predicate);
  if (predicate(node)) return node;
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
    expect(markup).toContain("No rebook draft has been created");
    expect(markup).toContain("not a lead, booking, delivery, payment, or revenue fact");
    expect(markup).not.toContain("Rebook now");
    expect(sourceButton.props["data-capability-action"]).toBe("open-authoritative-source-quote");
    sourceButton.props.onClick();
    expect(onOpenQuote).toHaveBeenCalledWith("anniversary");
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
