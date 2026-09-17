// @vitest-environment jsdom

import React from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, test, vi } from "vitest";
import DecisionPacketPanel from "../DecisionPacketPanel";
import GovernedQuoteStarts from "../GovernedQuoteStarts";

describe("governed quote start presentation", () => {
  test("uses only existing quote/template/rebook handoffs and names mandatory review boundaries", () => {
    const markup = renderToStaticMarkup(
      <GovernedQuoteStarts
        enabled
        templates={[{ id: "template-a", name: "Wedding reception", active: true }]}
        onUseBlank={vi.fn()}
        onReviewTemplate={vi.fn()}
        onReviewPriorAccepted={vi.fn()}
      />
    );

    expect(markup).toContain('data-capability-id="governed-quote-starts"');
    expect(markup).toContain("Blank quote");
    expect(markup).toContain("Approved template");
    expect(markup).toContain("Prior accepted event");
    expect(markup).toContain("Review template in this draft");
    expect(markup).toContain("Choose exact accepted event");
    expect(markup).toContain("No start saves, prices, sends, accepts, books, or charges");
  });

  test("renders nothing while the release gate is off", () => {
    expect(renderToStaticMarkup(<GovernedQuoteStarts enabled={false} />)).toBe("");
  });
});

describe("decision packet presentation", () => {
  const quote = {
    id: "quote-17",
    status: "accepted",
    activeVersionId: "v17",
    portalKey: "portal-key",
    portalIssuedAtISO: "2026-09-17T10:00:00.000Z",
    deliveryEvidence: { revisionId: "v17" },
    portalDecision: { decision: "accepted", requestId: "decision-17" },
    acceptanceReceipt: {
      receiptId: "acceptance-17",
      quoteRevisionId: "v17",
      portalIssuedAtISO: "2026-09-17T10:00:00.000Z"
    },
    payment: { depositStatus: "paid", finalBalance: { status: "unpaid" } }
  };

  test("renders a labelled four-stage read-only packet with an internal handoff", () => {
    const markup = renderToStaticMarkup(
      <DecisionPacketPanel
        enabled
        quote={quote}
        source="firebase"
        onOpenAcceptedRevision={vi.fn()}
      />
    );

    expect(markup).toContain('data-capability-id="quote-decision-packet"');
    expect(markup).toContain("Customer decision");
    expect(markup).toContain("Acceptance receipt");
    expect(markup).toContain("Payment state");
    expect(markup).toContain("Accepted revision handoff");
    expect(markup).toContain("Open accepted revision");
    expect(markup).toContain("Read-only composition");
  });

  test("withholds the handoff and names stale evidence", () => {
    const markup = renderToStaticMarkup(
      <DecisionPacketPanel
        enabled
        quote={{
          ...quote,
          acceptanceReceipt: { ...quote.acceptanceReceipt, quoteRevisionId: "v16" }
        }}
        source="firebase"
      />
    );

    expect(markup).toContain('data-capability-state="stale"');
    expect(markup).toContain("Refresh the exact accepted quote before using this handoff");
    expect(markup).not.toContain("Open accepted revision</button>");
  });
});
