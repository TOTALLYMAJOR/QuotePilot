import React from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, test } from "vitest";
import EventWorkspaceView from "../EventWorkspaceView";

function quoteFixture(overrides = {}) {
  return {
    id: "q-1",
    quoteNumber: "Q-260810-0900-00001",
    status: "draft",
    customer: { name: "Elena Rivera", email: "elena@example.test" },
    event: {
      name: "Rivera Wedding",
      date: "2026-08-22",
      time: "18:00",
      guests: 120,
      hours: 6,
      style: "Plated",
      servers: 8,
      chefs: 3
    },
    selection: { packageId: "deluxe", packageName: "Deluxe Plated", menuItems: ["duet"] },
    totals: {
      total: 15423,
      base: 6489,
      addons: 2039,
      rentals: 330,
      menu: 988,
      labor: 2184,
      travel: 19,
      serviceFee: 2169,
      tax: 1201,
      deposit: 4626,
      serverLabor: 1056,
      chefLabor: 504
    },
    ...overrides
  };
}

describe("EventWorkspaceView pilot Event Room dressing", () => {
  test("keeps the existing readiness presentation and no decide stack while the flag is off", () => {
    const markup = renderToStaticMarkup(
      <EventWorkspaceView quote={quoteFixture()} source="firebase" pilotEventRoom={false} />
    );
    expect(markup).toContain("<progress");
    expect(markup).not.toContain("data-decide-stack");
    expect(markup).not.toContain("readiness-ring");
  });

  test("renders the readiness ring and advisory decide stack when the pilot flag is on", () => {
    const markup = renderToStaticMarkup(
      <EventWorkspaceView
        quote={quoteFixture()}
        source="firebase"
        ordinaryEditAllowed
        pilotEventRoom
      />
    );
    expect(markup).toContain('data-decide-stack="decide-stack-v1"');
    expect(markup).toContain("Staffing below the house ratio");
    expect(markup).toContain("Record the venue");
    expect(markup).toContain('aria-label="Proposal readiness: 85%"');
    expect(markup).not.toContain("<progress");
    expect(markup).toContain("Proposal completeness only");
    expect(markup).toContain("≈ +$264.00 labor at this quote&#x27;s average recorded server rate.");
  });

  test("suppresses the decide stack for accepted scope while keeping the ring", () => {
    const markup = renderToStaticMarkup(
      <EventWorkspaceView
        quote={quoteFixture({ status: "accepted", lifecycle: { acceptedAtISO: "2026-08-12T15:04:00Z" } })}
        source="firebase"
        pilotEventRoom
      />
    );
    expect(markup).not.toContain("data-decide-stack");
    expect(markup).toContain("readiness-ring");
  });
});
