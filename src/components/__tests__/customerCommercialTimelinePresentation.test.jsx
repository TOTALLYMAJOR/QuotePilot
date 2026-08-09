import React, { isValidElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, test, vi } from "vitest";
import { CustomerCommercialTimelinePresentation } from "../CustomerCommercialTimeline";

function elementText(node) {
  if (typeof node === "string" || typeof node === "number") return String(node);
  if (Array.isArray(node)) return node.map(elementText).join("");
  if (!isValidElement(node)) return "";
  return elementText(node.props.children);
}

function findElement(node, predicate) {
  if (isValidElement(node) && predicate(node)) return node;
  if (!isValidElement(node)) return null;
  const children = Array.isArray(node.props.children) ? node.props.children : [node.props.children];
  for (const child of children) {
    const match = findElement(child, predicate);
    if (match) return match;
  }
  return null;
}

const BASE_TIMELINE = {
  status: "success",
  source: "firebase",
  sourceLabel: "Firestore customer workspace",
  evidenceBoundary: "Recorded milestones only; evidence families remain distinct.",
  items: [],
  pageInfo: {
    returned: 0,
    candidateCount: 0,
    timelineTruncated: false,
    quoteReadTruncated: false,
    quoteReadLimit: 25,
    versionReadTruncated: false,
    versionReadTruncatedQuoteCount: 0,
    versionPerQuoteLimit: 10
  }
};

describe("Customer commercial timeline presentation", () => {
  test("renders a source-labeled empty state without delivery claims", () => {
    const markup = renderToStaticMarkup(
      <CustomerCommercialTimelinePresentation timeline={{ ...BASE_TIMELINE, status: "empty" }} />
    );

    expect(markup).toContain('data-capability-state="empty"');
    expect(markup).toContain("Firestore customer workspace");
    expect(markup).toContain("No recorded commercial milestones");
    expect(markup).toContain("delivery and bounce milestones are not shown");
  });

  test("renders a completed timeline as a successful bounded read", () => {
    const markup = renderToStaticMarkup(
      <CustomerCommercialTimelinePresentation timeline={{
        ...BASE_TIMELINE,
        items: [{
          id: "quote-1:quote_created:2026-08-09T12:00:00.000Z",
          label: "Quote created",
          atISO: "2026-08-09T12:00:00.000Z",
          quoteId: "quote-1",
          quoteNumber: "QP-1001",
          sourceLabel: "Customer-scoped quote record"
        }]
      }} />
    );

    expect(markup).toContain('data-capability-state="success"');
    expect(markup).toContain("Quote created");
    expect(markup).toContain("QP-1001");
  });

  test("renders bounded partial evidence and keeps recorded rows actionable", () => {
    const onOpenQuote = vi.fn();
    const timeline = {
      ...BASE_TIMELINE,
      status: "partial",
      items: [{
        id: "quote-1:proposal_viewed:2026-08-09T12:00:00.000Z",
        label: "Recipient proposal view recorded",
        atISO: "2026-08-09T12:00:00.000Z",
        quoteId: "quote-1",
        quoteNumber: "QP-1001",
        sourceLabel: "Recorded quote lifecycle"
      }],
      pageInfo: {
        ...BASE_TIMELINE.pageInfo,
        returned: 1,
        candidateCount: 8,
        timelineTruncated: true,
        quoteReadTruncated: true,
        versionReadTruncated: true,
        versionReadTruncatedQuoteCount: 1
      }
    };
    const tree = CustomerCommercialTimelinePresentation({ timeline, onOpenQuote });
    const markup = renderToStaticMarkup(tree);
    const quoteButton = findElement(tree, (element) => (
      element.type === "button" && elementText(element) === "QP-1001"
    ));

    expect(markup).toContain('data-capability-state="partial"');
    expect(markup).toContain("latest 1 of 8 recorded milestones");
    expect(markup).toContain("25-quote bound");
    expect(markup).toContain("10-version bound");
    expect(markup).toContain("Recipient proposal view recorded");
    quoteButton.props.onClick();
    expect(onOpenQuote).toHaveBeenCalledWith("quote-1");
  });
});
