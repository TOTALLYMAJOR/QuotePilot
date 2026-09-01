// @vitest-environment jsdom

import React, { act } from "react";
import { createRoot } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, test, vi } from "vitest";
import AmbientLivingOpportunity from "../AmbientLivingOpportunity";
import { buildAmbientLivingOpportunityPresentation } from "../ambientLivingOpportunityPresentation";
import { AmbientContextProvider } from "../../context/AmbientContext";

globalThis.IS_REACT_ACT_ENVIRONMENT = true;

const QUOTE = Object.freeze({
  id: "quote-logistics",
  quoteNumber: "Q-LOG-01",
  activeVersionId: "version-logistics-7",
  updatedAtISO: "2026-08-11T18:00:00.000Z",
  status: "draft",
  customer: Object.freeze({ name: "Maya Bennett", email: "maya@example.test" }),
  event: Object.freeze({
    name: "Autumn Benefit Dinner",
    date: "2026-09-19",
    time: "18:00",
    hours: 6,
    venue: "The Foundry Hall",
    venueAddress: "1200 East Fifth Street, Austin, TX",
    style: "Plated",
    guests: 120,
    servers: 8,
    chefs: 3,
    bartenders: 0
  }),
  selection: Object.freeze({
    packageName: "Classic",
    rentals: Object.freeze(["chairs"]),
    addons: Object.freeze(["tea"])
  }),
  totals: Object.freeze({ total: 8_400 })
});

const STAFF_CONTEXT = Object.freeze({
  organizationId: "org-alpha",
  role: "sales",
  route: "/app/quotes/quote-logistics",
  activeOpportunityId: "quote-logistics",
  selectedObject: Object.freeze({
    id: "quote-logistics",
    type: "opportunity",
    label: "Autumn Benefit Dinner"
  }),
  revision: "version-logistics-7",
  sourceFreshness: Object.freeze({ state: "fresh", observedAt: "2026-08-11T18:00:00.000Z" }),
  pendingPreview: null
});

let container;
let root;
let originalRequestAnimationFrame;
let originalCancelAnimationFrame;

function component(props = {}) {
  return (
    <AmbientLivingOpportunity
      quote={QUOTE}
      source="firebase"
      ordinaryEditAllowed
      onBackToQuotes={() => ({ status: "opened" })}
      onEditQuote={() => ({ status: "opened" })}
      {...props}
    />
  );
}

function mount(props = {}, { context = STAFF_CONTEXT, withProvider = true } = {}) {
  act(() => {
    root.render(withProvider ? (
      <AmbientContextProvider value={context}>{component(props)}</AmbientContextProvider>
    ) : component(props));
  });
}

function trigger(kind) {
  return container.querySelector(`button[data-event-logistics-kind="${kind}"]`);
}

function buttonContaining(value) {
  return [...container.querySelectorAll("button")].find((item) => (
    item.textContent.replace(/\s+/gu, " ").trim().includes(value)
  ));
}

async function settle() {
  await act(async () => {
    await Promise.resolve();
    await new Promise((resolve) => window.setTimeout(resolve, 0));
  });
}

beforeEach(() => {
  originalRequestAnimationFrame = window.requestAnimationFrame;
  originalCancelAnimationFrame = window.cancelAnimationFrame;
  window.requestAnimationFrame = (callback) => {
    callback();
    return 1;
  };
  window.cancelAnimationFrame = () => {};
  container = document.createElement("div");
  document.body.appendChild(container);
  root = createRoot(container);
});

afterEach(() => {
  act(() => root.unmount());
  container.remove();
  window.requestAnimationFrame = originalRequestAnimationFrame;
  window.cancelAnimationFrame = originalCancelAnimationFrame;
  vi.restoreAllMocks();
});

describe("Living Opportunity event-logistics intelligent objects", () => {
  test("keeps exact date, time, duration, and venue in the top layer and opens one populated context", () => {
    mount();

    const layout = container.querySelector('[data-event-logistics-layout="responsive"]');
    expect(layout).not.toBeNull();
    expect(layout.textContent).toContain("2026-09-19");
    expect(layout.textContent).toContain("18:00");
    expect(layout.textContent).toContain("6 hours");
    expect(layout.textContent).toContain("The Foundry Hall · 1200 East Fifth Street, Austin, TX");
    expect([...layout.querySelectorAll("button")]).toHaveLength(4);
    expect([...layout.querySelectorAll("button")].every((item) => (
      item.dataset.ambientActionId && item.dataset.surfacePurpose.includes("clarify")
    ))).toBe(true);

    act(() => trigger("date").click());
    const dialog = container.querySelector('[role="dialog"]');
    expect(container.querySelectorAll('[role="dialog"]')).toHaveLength(1);
    expect(dialog.textContent).toContain("Event date details");
    expect(dialog.textContent).toContain("Saved value2026-09-19");
    ["Availability", "Seasonal pricing", "Travel", "Quote validity", "Scheduling"].forEach((label) => {
      expect(dialog.textContent).toContain(label);
    });
    expect(dialog.querySelectorAll('[data-evidence-state="missing"]')).toHaveLength(5);
    expect(dialog.textContent).toContain("Why this matters");
    expect(dialog.textContent).toContain("If you do nothing");
    expect(dialog.textContent).toContain("Confidence: low");
    expect(dialog.textContent).toContain("Sources:");
    expect(dialog.textContent).toContain("does not prove availability");
    expect(container.querySelector('[data-result-kind="context"]')?.textContent)
      .toContain("Event date details ready");

    act(() => trigger("time").click());
    expect(container.querySelectorAll('[role="dialog"]')).toHaveLength(1);
    expect(container.querySelector('[role="dialog"]')?.textContent).toContain("Event time details");
    expect(container.querySelector('[role="dialog"]')?.textContent).not.toContain("Event date details");
  });

  test("keeps missing and stale evidence explicit without fabricating a healthy conclusion", () => {
    mount({
      eventLogisticsEvidence: {
        availability: {
          state: "stale",
          claim: "The venue calendar showed an opening.",
          sourceLabel: "Venue calendar import",
          observedAt: "2026-08-01T15:00:00.000Z",
          reason: "The calendar observation is older than the operating freshness window."
        },
        seasonalPricing: {
          state: "unavailable",
          reason: "No governed seasonal-pricing source is attached."
        }
      }
    });

    act(() => trigger("venue").click());
    const dialog = container.querySelector('[role="dialog"]');
    expect(dialog.querySelector('[data-evidence-state="stale"]')?.textContent)
      .toContain("The venue calendar showed an opening");
    expect(dialog.querySelector('[data-evidence-state="stale"]')?.textContent)
      .toContain("Venue calendar import");
    expect(dialog.querySelector('[data-evidence-state="stale"]')?.textContent)
      .toContain("older than the operating freshness window");
    expect(dialog.querySelector('[data-evidence-state="unavailable"]')?.textContent)
      .toContain("No governed seasonal-pricing source is attached");
    expect(dialog.querySelectorAll('[data-evidence-state="missing"]')).toHaveLength(3);
    expect(dialog.textContent).not.toMatch(/venue is available|availability confirmed|reserved/iu);
  });

  test("stages only exact draft intent through the existing editor handoff and acknowledges immediately", () => {
    const onEditQuote = vi.fn(() => ({ status: "opened" }));
    mount({ onEditQuote });

    act(() => trigger("date").click());
    act(() => buttonContaining("Continue event date in editor").click());

    expect(onEditQuote).toHaveBeenCalledOnce();
    const [selectedQuote, options] = onEditQuote.mock.calls[0];
    expect(selectedQuote).toBe(QUOTE);
    expect(options).not.toHaveProperty("draftPatch");
    expect(options.draftIntent).toEqual({
      schemaVersion: "ambient-event-logistics-draft-intent-v1",
      source: "ambient-event-logistics-v1",
      baseRevisionId: "version-logistics-7",
      objectId: "event-date",
      kind: "date",
      fieldPaths: ["event.date"],
      savedValue: "2026-09-19",
      authority: "draft_only",
      commit: false,
      consequencePreviewRequired: true,
      requiresOutcomeNamedSave: true
    });
    expect(options.arrivalContext).toMatchObject({
      object: { id: QUOTE.id, type: "opportunity", label: QUOTE.event.name },
      consequence: expect.stringContaining("No value is applied, reserved, repriced, scheduled, or saved"),
      nextResolution: expect.stringContaining("save intentionally or leave")
    });
    expect(container.querySelector('[data-result-kind="pending"]')?.textContent)
      .toContain("Opening event date draft controls");
    expect(QUOTE.event.date).toBe("2026-09-19");
  });

  test("recovers instead of inventing a base revision for a draft-intent handoff", () => {
    const onEditQuote = vi.fn();
    const quoteWithoutRevision = {
      ...QUOTE,
      activeVersionId: undefined,
      updatedAtISO: undefined
    };
    mount({ quote: quoteWithoutRevision, onEditQuote });

    act(() => trigger("time").click());
    act(() => buttonContaining("Continue event time in editor").click());

    expect(onEditQuote).not.toHaveBeenCalled();
    expect(container.querySelector('[data-result-kind="recovery"]')?.textContent)
      .toContain("needs a fresh revision");
    expect(container.textContent).toContain("No value was applied, reserved, repriced, scheduled, or saved");
    expect(container.textContent).toContain("Refresh the opportunity");
  });

  test("keeps missing saved values inspectable but removes their unsafe staging handoff", () => {
    const quoteWithMissingDate = {
      ...QUOTE,
      event: {
        ...QUOTE.event,
        date: ""
      }
    };
    mount({ quote: quoteWithMissingDate });

    expect(trigger("date").textContent).toContain("Event date not recorded");
    act(() => trigger("date").click());

    const dialog = container.querySelector('[role="dialog"]');
    expect(dialog.textContent).toContain("Saved valueEvent date not recorded");
    expect(dialog.textContent).toContain("Draft staging requires an exact available saved event date");
    expect(buttonContaining("Continue event date in editor")).toBeUndefined();

    const model = buildAmbientLivingOpportunityPresentation(quoteWithMissingDate, {
      role: "sales",
      ordinaryEditAllowed: true
    });
    expect(model.eventLogisticsObjects.date.savedValue.state).toBe("missing");
    expect(model.eventLogisticsObjects.date.staging).toBeNull();
    expect(model.actions.stageEventDate).toMatchObject({
      enabled: false,
      disabledReason: expect.stringContaining("exact available saved event date")
    });
    expect(model.actions.inspectEventDate.arrivalContract.nextResolutionIds)
      .toEqual([model.actions.dismissEventDateContext.id]);
  });

  test("fails closed when role context is omitted and withholds internal evidence interactions", () => {
    const privateEvidence = {
      availability: {
        state: "available",
        claim: "Internal availability claim must remain hidden.",
        sourceLabel: "Internal calendar"
      }
    };
    mount({ eventLogisticsEvidence: privateEvidence }, { withProvider: false });

    const surface = container.querySelector(".ambient-living-opportunity");
    expect(surface.dataset.ambientRole).toBe("non_staff");
    expect(container.querySelectorAll("button[data-event-logistics-kind]")).toHaveLength(0);
    expect(container.querySelector('[data-event-logistics-kind="date"]')?.textContent).toContain("2026-09-19");
    expect(container.textContent).not.toContain("Internal availability claim must remain hidden");
    expect(container.querySelector('[role="dialog"]')).toBeNull();

    const model = buildAmbientLivingOpportunityPresentation(QUOTE, {
      ordinaryEditAllowed: true,
      eventLogisticsEvidence: privateEvidence
    });
    expect(model.actions.inspectEventDate).toMatchObject({
      enabled: false,
      roles: ["non_staff"]
    });
    expect(model.actions.stageEventDate.enabled).toBe(false);
    expect(model.eventLogisticsObjects.date.permissions).toMatchObject({
      view: false,
      stage: false,
      commit: false
    });
    const customerModel = buildAmbientLivingOpportunityPresentation(QUOTE, {
      role: "customer",
      ordinaryEditAllowed: true,
      eventLogisticsEvidence: privateEvidence
    });
    expect(customerModel.actions.inspectEventVenue.enabled).toBe(false);
    expect(customerModel.actions.stageEventVenue.enabled).toBe(false);
  });

  test("restores focus to the exact trigger and emits zero-dead-click acknowledgements", async () => {
    const observations = [];
    mount();
    const surface = container.querySelector(".ambient-living-opportunity");
    surface.addEventListener("quotepilot:ambient-interaction", (event) => observations.push(event.detail));
    const dateTrigger = trigger("date");
    dateTrigger.focus();

    act(() => dateTrigger.click());
    expect(container.querySelectorAll('[role="dialog"]')).toHaveLength(1);
    expect(observations.some((item) => (
      item.phase === "acknowledge"
      && item.resultKind === "context"
      && item.monitor.deadClickRate === 0
    ))).toBe(true);

    act(() => {
      document.dispatchEvent(new window.KeyboardEvent("keydown", { key: "Escape", bubbles: true }));
    });
    await settle();

    expect(container.querySelector('[role="dialog"]')).toBeNull();
    expect(document.activeElement).toBe(dateTrigger);
    expect(container.querySelector('[data-result-kind="resolved"]')?.textContent)
      .toContain("Event date context closed");
    expect(surface.querySelectorAll("button:not(:disabled):not([data-ambient-action-id])")).toHaveLength(0);
  });

  test("keeps the top layer responsive at mobile width without a parallel mobile data model", () => {
    Object.defineProperty(window, "innerWidth", { configurable: true, value: 390 });
    mount();

    const layout = container.querySelector('[data-event-logistics-layout="responsive"]');
    expect(layout.querySelectorAll("[data-event-logistics-kind]")).toHaveLength(4);
    expect(layout.querySelector("table")).toBeNull();
    expect(layout.textContent).toContain("The Foundry Hall · 1200 East Fifth Street, Austin, TX");
    expect(container.querySelectorAll('[data-glance="state"], [data-glance="risk"], [data-glance="next"]'))
      .toHaveLength(3);
    expect(container.querySelector('[data-glance="next"] button')).toBeNull();
  });
});
