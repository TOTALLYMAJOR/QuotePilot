// @vitest-environment jsdom

import React, { act, useRef, useState } from "react";
import { createRoot } from "react-dom/client";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, test, vi } from "vitest";
import DecisionPacketPanel from "../DecisionPacketPanel";
import GovernedQuoteStarts, {
  scheduleGovernedTemplateDestinationFocus
} from "../GovernedQuoteStarts";
import ProposalComposer from "../ProposalComposer";
import { StepEvent } from "../WizardSteps";

globalThis.IS_REACT_ACT_ENVIRONMENT = true;

const eventTemplate = { id: "template-a", name: "Wedding reception", active: true };
const form = {
  eventTemplateId: "custom",
  eventTypeId: "wedding",
  eventName: "Morgan wedding",
  date: "2026-09-12",
  time: "18:00",
  venue: "Pine Hall",
  venueAddress: "1 Pine Way",
  hours: 4,
  guests: 80,
  name: "Morgan Lee",
  email: "morgan@example.test",
  clientOrg: "",
  phone: "",
  pkg: "standard",
  style: "Buffet",
  servers: 3,
  chefs: 1,
  bartenders: 0,
  addons: [],
  rentals: [],
  menuItems: [],
  addonQuantities: {},
  rentalQuantities: {},
  menuItemQuantities: {},
  payMethod: "card",
  taxRegion: "local",
  seasonProfileId: "auto"
};
const settings = {
  eventTemplates: [eventTemplate],
  taxRegions: [{ id: "local", name: "Local", rate: 0.08 }],
  seasonalProfiles: [],
  staffingLaborEnabled: true,
  quoteValidityDays: 30,
  depositPct: 0.3,
  menuSections: []
};
const totals = {
  guests: 80,
  total: 3200,
  deposit: 960,
  base: 2200,
  labor: 500,
  bartenderLabor: 0,
  travel: 0,
  tax: 200,
  serviceFee: 300,
  addons: 0,
  rentals: 0,
  menu: 0
};
const readiness = {
  score: 100,
  complete: true,
  gaps: [],
  recommendedGaps: [],
  status: { id: "ready", label: "Ready to send" }
};

function templateHarness(mode) {
  return function TemplateHarness() {
    const [editorForm, setEditorForm] = useState(form);
    const rootRef = useRef(null);
    const reviewStarts = (
      <GovernedQuoteStarts
        enabled
        templates={[eventTemplate]}
        onReviewTemplate={() => scheduleGovernedTemplateDestinationFocus({
          editorMode: mode,
          root: rootRef
        })}
      />
    );
    return (
      <main ref={rootRef}>
        {reviewStarts}
        {mode === "guided" ? (
          <StepEvent
            form={editorForm}
            setForm={setEditorForm}
            styles={["Buffet"]}
            settings={settings}
            eventTypes={[{ id: "wedding", name: "Wedding" }]}
            onTemplateChange={() => {}}
            onEventTypeChange={() => {}}
          />
        ) : (
          <ProposalComposer
            form={editorForm}
            totals={totals}
            readiness={readiness}
            catalog={{ packages: [{ id: "standard", name: "Standard", ppp: 40, active: true }], addons: [], rentals: [] }}
            settings={settings}
            menuSections={[]}
            eventTypes={[{ id: "wedding", name: "Wedding" }]}
            eventTemplates={[eventTemplate]}
            onFieldChange={(field, value) => setEditorForm((current) => ({ ...current, [field]: value }))}
            onSelectionTouched={() => {}}
            onPatchForm={() => {}}
            onTemplateChange={() => {}}
            onEventTypeChange={() => {}}
            onSaveQuote={() => {}}
            onGuidedMode={() => {}}
          />
        )}
      </main>
    );
  };
}

function installFrameQueue() {
  const frames = [];
  window.requestAnimationFrame = (callback) => {
    frames.push(callback);
    return frames.length;
  };
  return frames;
}

async function flushFrames(frames) {
  while (frames.length) {
    const pending = frames.splice(0);
    await act(async () => pending.forEach((callback) => callback(performance.now())));
  }
}

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

  test.each(["guided", "composer"])(
    "clicking the template start opens and focuses the actual %s template disclosure",
    async (mode) => {
      const frames = installFrameQueue();
      const host = document.createElement("div");
      document.body.appendChild(host);
      const root = createRoot(host);
      const Harness = templateHarness(mode);
      await act(async () => root.render(<Harness />));

      const start = [...host.querySelectorAll("button")]
        .find((button) => button.textContent.includes("Review template in this draft"));
      await act(async () => start.click());
      await flushFrames(frames);

      if (mode === "guided") {
        const trigger = host.querySelector('[aria-controls="accordion-panel-advancedPricing"]');
        const template = host.querySelector('[data-choice-field="event-template"] select');
        expect(trigger.getAttribute("aria-expanded")).toBe("true");
        expect(document.activeElement).toBe(template);
      } else {
        const template = host.querySelector("#proposal-event-template");
        expect(host.querySelector('[data-testid="workbench-domain-commercials"]')?.getAttribute("aria-current"))
          .toBe("step");
        expect(template.closest("details").open).toBe(true);
        expect(document.activeElement).toBe(template);
      }

      await act(async () => root.unmount());
      host.remove();
    }
  );
});

describe("decision packet presentation", () => {
  const quote = {
    id: "quote-17",
    status: "accepted",
    activeVersionId: "v17",
    portalKey: "portal-key",
    portalIssuedAtISO: "2026-09-17T10:00:00.000Z",
    deliveryEvidence: { revisionId: "v17" },
    portalDecision: { decision: "accepted", requestId: "acceptance-17" },
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
    expect(markup).toContain("Exact handoff ready");
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
    expect(markup).not.toContain("Exact handoff ready");
    expect(markup).not.toContain("Open accepted revision</button>");
  });
});
