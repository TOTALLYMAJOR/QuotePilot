// @vitest-environment jsdom
import React from "react";
import { createRoot } from "react-dom/client";
import { act } from "react-dom/test-utils";
import { afterEach, beforeEach, describe, expect, test, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  getQuoteHistory: vi.fn()
}));

vi.mock("../../lib/quoteStore", () => ({
  getQuoteHistory: mocks.getQuoteHistory,
  updateQuoteBookingAssignment: vi.fn(),
  updateQuoteKitchenCheckpoints: vi.fn(),
  updateQuoteProductionChecklist: vi.fn()
}));

import { EventScheduleView } from "../EventScheduleModal";
import { createWorkspaceArrivalHandoff } from "../../lib/workspaceArrivalContract";

globalThis.IS_REACT_ACT_ENVIRONMENT = true;

const ORGANIZATION_ID = "org-schedule-arrival";
const QUOTE_ID = "quote-schedule-arrival";

function quote(overrides = {}) {
  return {
    id: QUOTE_ID,
    organizationId: ORGANIZATION_ID,
    quoteNumber: "QP-2042",
    status: "accepted",
    event: {
      date: "2026-10-14",
      time: "18:00",
      hours: 4,
      name: "Garden dinner",
      venue: "River Garden",
      guests: 80
    },
    customer: { name: "Jordan Customer" },
    totals: { total: 8400 },
    booking: {},
    ...overrides
  };
}

function contextFor({
  intentId = "review_event_schedule",
  object = { id: QUOTE_ID, type: "opportunity" }
} = {}) {
  const handoff = createWorkspaceArrivalHandoff({
    destination: "schedule",
    object,
    focus: { quoteId: QUOTE_ID },
    intentId
  });
  if (!handoff.ok) throw new Error(handoff.recovery.code);
  return handoff.contract;
}

let container;
let root;
let originalScrollIntoView;

beforeEach(() => {
  vi.clearAllMocks();
  container = document.createElement("div");
  document.body.appendChild(container);
  root = createRoot(container);
  originalScrollIntoView = HTMLElement.prototype.scrollIntoView;
  HTMLElement.prototype.scrollIntoView = vi.fn();
  window.requestAnimationFrame = (callback) => window.setTimeout(() => callback(Date.now()), 0);
  window.cancelAnimationFrame = (handle) => window.clearTimeout(handle);
  mocks.getQuoteHistory.mockResolvedValue({
    source: "firebase",
    quotes: [quote()],
    truncated: false
  });
});

afterEach(() => {
  act(() => root.unmount());
  container.remove();
  HTMLElement.prototype.scrollIntoView = originalScrollIntoView;
});

async function settle() {
  await act(async () => {
    await new Promise((resolve) => window.setTimeout(resolve, 60));
  });
}

async function renderSchedule({ arrivalContext = contextFor(), onArrivalResolution = vi.fn() } = {}) {
  act(() => {
    root.render(
      <EventScheduleView
        open
        organizationId={ORGANIZATION_ID}
        arrivalContext={arrivalContext}
        onArrivalResolution={onArrivalResolution}
        onClose={() => {}}
      />
    );
  });
  await settle();
  return onArrivalResolution;
}

describe("Event Schedule exact arrival consumption", () => {
  test("keeps arrival pending until the exact same-tenant event is selected and focused", async () => {
    const onArrivalResolution = await renderSchedule();
    const target = container.querySelector(`[data-schedule-event-id="${QUOTE_ID}"]`);

    expect(mocks.getQuoteHistory).toHaveBeenCalledWith({
      organizationId: ORGANIZATION_ID,
      limitCount: 500
    });
    expect(target).toBeTruthy();
    expect(document.activeElement).toBe(target);
    expect(onArrivalResolution).toHaveBeenCalledWith(expect.objectContaining({
      status: "pending",
      focus: { quoteId: QUOTE_ID }
    }));
    expect(onArrivalResolution).toHaveBeenLastCalledWith(expect.objectContaining({
      status: "resolved",
      itemId: QUOTE_ID,
      eventDate: "2026-10-14",
      object: { id: QUOTE_ID, type: "opportunity" }
    }));
  });

  test("focuses an exact event found in a truncated snapshot without claiming absence or completeness", async () => {
    mocks.getQuoteHistory.mockResolvedValue({
      source: "firebase",
      quotes: [quote()],
      truncated: true
    });
    const onArrivalResolution = await renderSchedule();

    expect(onArrivalResolution).toHaveBeenLastCalledWith(expect.objectContaining({
      status: "resolved",
      itemId: QUOTE_ID
    }));
  });

  test("recovers from a missing exact event in a truncated snapshot without focusing another event", async () => {
    mocks.getQuoteHistory.mockResolvedValue({
      source: "firebase",
      quotes: [quote({ id: "quote-neighbor" })],
      truncated: true
    });
    const onArrivalResolution = await renderSchedule();

    expect(onArrivalResolution).toHaveBeenLastCalledWith(expect.objectContaining({
      status: "recovery",
      code: "schedule_snapshot_incomplete",
      consequence: expect.stringMatching(/No nearby, first-listed, or same-day event was substituted/i)
    }));
    expect(onArrivalResolution).not.toHaveBeenCalledWith(expect.objectContaining({
      status: "resolved"
    }));
    expect(document.activeElement).not.toBe(
      container.querySelector('[data-schedule-event-id="quote-neighbor"]')
    );
  });

  test("recovers from stale schedule evidence without presenting the exact event as current", async () => {
    mocks.getQuoteHistory.mockResolvedValue({
      source: "firebase-cache",
      quotes: [quote()],
      stale: true,
      truncated: false
    });
    const onArrivalResolution = await renderSchedule();

    expect(onArrivalResolution).toHaveBeenLastCalledWith(expect.objectContaining({
      status: "recovery",
      code: "schedule_evidence_stale",
      consequence: expect.stringMatching(/no alternate event was focused/i)
    }));
    expect(onArrivalResolution).not.toHaveBeenCalledWith(expect.objectContaining({
      status: "resolved"
    }));
  });

  test("requires complete current conflict evidence before focusing an exact conflict", async () => {
    mocks.getQuoteHistory.mockResolvedValue({
      source: "firebase",
      quotes: [quote()],
      truncated: true
    });
    const onArrivalResolution = await renderSchedule({
      arrivalContext: contextFor({
        intentId: "review_schedule_conflict",
        object: { id: QUOTE_ID, type: "schedule-item" }
      })
    });

    expect(onArrivalResolution).toHaveBeenLastCalledWith(expect.objectContaining({
      status: "recovery",
      code: "schedule_conflict_evidence_incomplete"
    }));
    expect(onArrivalResolution).not.toHaveBeenCalledWith(expect.objectContaining({
      status: "resolved"
    }));
  });

  test("refuses to substitute legacy staff-lead data for authoritative operational staffing", async () => {
    const onArrivalResolution = await renderSchedule({
      arrivalContext: contextFor({
        intentId: "review_staffing_schedule",
        object: { id: "staffing", type: "intelligent-object" }
      })
    });

    expect(onArrivalResolution).toHaveBeenLastCalledWith(expect.objectContaining({
      status: "recovery",
      code: "authoritative_staffing_consumer_unavailable",
      consequence: expect.stringMatching(/No event or legacy booking\.staffLead value was substituted/i)
    }));
    expect(onArrivalResolution).not.toHaveBeenCalledWith(expect.objectContaining({
      status: "resolved"
    }));
  });
});
