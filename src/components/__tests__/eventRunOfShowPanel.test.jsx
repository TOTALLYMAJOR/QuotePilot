import React, { isValidElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, test, vi } from "vitest";

import EventRunOfShowPanel from "../EventRunOfShowPanel";
import { EventScheduleView } from "../EventScheduleModal";
import { buildEventRunOfShowReadModel } from "../../lib/eventRunOfShow";
import { proposalPayloadFixtureQuote } from "../../lib/__tests__/fixtures/proposalPayloadFixture";

function clone(value) {
  return JSON.parse(JSON.stringify(value));
}

function operationalQuote(overrides = {}) {
  return {
    ...clone(proposalPayloadFixtureQuote),
    status: "accepted",
    lifecycle: { acceptedAtISO: "2026-03-12T15:30:00.000Z" },
    ...overrides
  };
}

function modelFor(quotes, options = {}) {
  return buildEventRunOfShowReadModel({
    quotes,
    source: "firebase",
    ...options
  });
}

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

describe("EventRunOfShowPanel", () => {
  test("renders a source-bound expandable accepted-event sequence without stronger evidence claims", () => {
    const markup = renderToStaticMarkup(
      <EventRunOfShowPanel
        model={modelFor([operationalQuote()])}
        selectedDateLabel="Monday, Apr 20, 2026"
      />
    );

    expect(markup).toContain('data-capability-id="event-run-of-show"');
    expect(markup).toContain('data-capability-state="success"');
    expect(markup).toContain("Read-only sequence for Monday, Apr 20, 2026.");
    expect(markup).toContain("Source: Firestore staff records. Authority: Canonical tenant staff records.");
    expect(markup).toContain("showing 1 of 1 accepted or booked records derived from 1 loaded quotes");
    expect(markup).toContain("<details");
    expect(markup).toContain("Q-2026-0042: Spring Gala");
    expect(markup).toContain("Proposal acceptance: Accepted");
    expect(markup).toContain("Booking: Not booked");
    expect(markup).toContain("Operational readiness: Not established");
    expect(markup).toContain("Proposal accepted Mar 12, 2026,");
    expect(markup).toContain("Booking is not recorded.");
    expect(markup).toContain("120 guests, 5 hours, Plated");
    expect(markup).toContain("Timing source: Booking override.");
    expect(markup).toContain("Timing source: Generated default.");
    expect(markup).toContain("No retained BEO artifact or freshness evidence was read.");
    expect(markup).not.toContain("Operational readiness: Ready");
    expect(markup).not.toContain("BEO current");
  });

  test("keeps a booked quote separate from missing proposal-acceptance evidence and readiness", () => {
    const markup = renderToStaticMarkup(
      <EventRunOfShowPanel
        model={modelFor([operationalQuote({
          status: "booked",
          lifecycle: { bookedAtISO: "2026-03-13T09:00:00.000Z" },
          booking: {
            ...proposalPayloadFixtureQuote.booking,
            contractNumber: "C-2026-0042"
          }
        })])}
      />
    );

    expect(markup).toContain("Proposal acceptance: Not established");
    expect(markup).toContain("Booking: Booked");
    expect(markup).toContain("Operational readiness: Not established");
    expect(markup).toContain("Booked quote");
    expect(markup).toContain("Contract C-2026-0042.");
    expect(markup).toContain("Acceptance and booking remain separate facts.");
  });

  test("surfaces unknown inputs and duration-dependent timing gaps as a partial state", () => {
    const quote = operationalQuote({
      event: {
        ...proposalPayloadFixtureQuote.event,
        hours: "",
        chefs: ""
      },
      booking: {
        ...proposalPayloadFixtureQuote.booking,
        staffLead: ""
      }
    });
    const markup = renderToStaticMarkup(
      <EventRunOfShowPanel
        model={buildEventRunOfShowReadModel({ quotes: [quote], source: "local" })}
      />
    );

    expect(markup).toContain('data-capability-state="partial"');
    expect(markup).toContain("Source: Browser-local workspace. Authority: Browser-local staff records.");
    expect(markup).toContain("Unknown source facts: Event duration, Chef count, Staff lead.");
    expect(markup).toContain("Time unavailable until the event duration is recorded.");
    expect(markup).toContain("Some event, staffing, or schedule facts are not recorded.");
    expect(markup).not.toContain("0 chefs");
  });

  test("covers initial loading, completed empty, and unrecoverable empty-read states", () => {
    const emptyModel = modelFor([]);
    const loadingMarkup = renderToStaticMarkup(
      <EventRunOfShowPanel model={emptyModel} loading />
    );
    const emptyMarkup = renderToStaticMarkup(
      <EventRunOfShowPanel model={emptyModel} />
    );
    const errorMarkup = renderToStaticMarkup(
      <EventRunOfShowPanel model={emptyModel} error="Tenant read failed." />
    );

    expect(loadingMarkup).toContain('data-capability-state="loading"');
    expect(loadingMarkup).toContain("Loading run-of-show records for this day.");
    expect(loadingMarkup).not.toContain("No accepted or booked events for this day.");
    expect(emptyMarkup).toContain('data-capability-state="empty"');
    expect(emptyMarkup).toContain("No accepted or booked events for this day.");
    expect(errorMarkup).toContain('data-capability-state="error"');
    expect(errorMarkup).toContain('role="alert"');
    expect(errorMarkup).toContain("Run of show unavailable. Retry the tenant-scoped Schedule read.");
    expect(errorMarkup).not.toContain("Tenant read failed.");
  });

  test("retains partial records after refresh failure and executes recovery", () => {
    const retry = vi.fn();
    const model = modelFor(
      [
        operationalQuote({ id: "quote-1", quoteNumber: "Q-1" }),
        operationalQuote({ id: "quote-2", quoteNumber: "Q-2" })
      ],
      { limit: 1, upstreamTruncated: true }
    );
    const tree = EventRunOfShowPanel({
      model,
      error: "Network unavailable.",
      onRetry: retry
    });
    const markup = renderToStaticMarkup(tree);
    const retryButton = findElement(tree, (element) => (
      element.type === "button" && elementText(element) === "Retry run of show"
    ));

    expect(markup).toContain('data-capability-state="stale"');
    expect(markup).toContain("Showing the last loaded read-only projection; it may be stale.");
    expect(markup).toContain("This projection is bounded.");
    expect(markup).toContain('data-capability-state="recovery"');
    expect(retryButton).not.toBeNull();
    retryButton.props.onClick();
    expect(retry).toHaveBeenCalledOnce();
  });

  test("is discoverable inside the routed Schedule region during its true loading state", () => {
    const markup = renderToStaticMarkup(
      <EventScheduleView open onClose={() => {}} organizationId="org-a" />
    );

    expect(markup).toContain('role="region"');
    expect(markup).toContain('data-capability-id="event-run-of-show"');
    expect(markup).toContain('data-capability-state="loading"');
    expect(markup).toContain("Loading run-of-show records for this day.");
  });
});
