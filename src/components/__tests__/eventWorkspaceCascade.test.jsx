import React from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, test } from "vitest";
import EventWorkspaceView from "../EventWorkspaceView";

function quoteFixture(overrides = {}) {
  return {
    id: "q-1",
    quoteNumber: "Q-260812-1504-00001",
    status: "accepted",
    customer: { name: "Elena Rivera", email: "elena@example.test" },
    event: {
      name: "Rivera Wedding", date: "2026-08-22", time: "18:00",
      venue: "Hill Country Pavilion", guests: 120, hours: 6, style: "Plated",
      servers: 10, chefs: 3, bartenders: 2
    },
    selection: { packageId: "deluxe", packageName: "Deluxe Plated", menuItems: ["duet"] },
    totals: { total: 15423, deposit: 4626 },
    activeVersionId: "v0006",
    acceptanceReceipt: { receiptId: "pa_1234567890abcdef" },
    lifecycle: { acceptedAtISO: "2026-08-12T15:04:00.000Z" },
    payment: { depositStatus: "sent" },
    booking: {},
    workflow: {},
    ...overrides
  };
}

describe("EventWorkspaceView cascade panel", () => {
  test("shows the receipt chain for an accepted quote when the pilot flag is on", () => {
    const markup = renderToStaticMarkup(
      <EventWorkspaceView quote={quoteFixture()} source="firebase" pilotEventRoom />
    );
    expect(markup).toContain('data-cascade="cascade-receipts-v1"');
    expect(markup).toContain("Accepted — the cascade so far");
    expect(markup).toContain("Proposal accepted");
    expect(markup).toContain("Immutable version v0006");
    expect(markup).toContain("Deposit requested");
    expect(markup).toContain("Awaiting the provider&#x27;s signed payment confirmation.");
    expect(markup).toContain("Each step reports only the evidence recorded on this quote.");
  });

  test("renders no cascade before acceptance or while the flag is off", () => {
    const draft = renderToStaticMarkup(
      <EventWorkspaceView quote={quoteFixture({ status: "draft" })} source="firebase" pilotEventRoom />
    );
    expect(draft).not.toContain("data-cascade");
    const flagOff = renderToStaticMarkup(
      <EventWorkspaceView quote={quoteFixture()} source="firebase" pilotEventRoom={false} />
    );
    expect(flagOff).not.toContain("data-cascade");
  });
});
