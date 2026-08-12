// @vitest-environment jsdom

import React, { act } from "react";
import { createRoot } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, test, vi } from "vitest";
import AmbientLivingOpportunity from "../AmbientLivingOpportunity";
import { AmbientContextProvider } from "../../context/AmbientContext";
import { createImpactPreview } from "../../lib/ambientContracts";

globalThis.IS_REACT_ACT_ENVIRONMENT = true;

const OBSERVED_AT = "2026-08-11T15:00:00.000Z";
const QUOTE = Object.freeze({
  id: "quote-pricing",
  quoteNumber: "Q-PRICE-01",
  activeVersionId: "v0012",
  status: "draft",
  customer: Object.freeze({ name: "Maya Bennett", email: "maya@example.test" }),
  event: Object.freeze({
    name: "Autumn Benefit Dinner",
    date: "2026-09-19",
    time: "18:00",
    venue: "The Foundry Hall",
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
  totals: Object.freeze({ total: 8_400, deposit: 2_520 }),
  pricing: Object.freeze({
    authority: "server_authoritative",
    calculatedAt: OBSERVED_AT,
    inputs: Object.freeze({ event: Object.freeze({ guests: 120 }) }),
    lineItems: Object.freeze([
      Object.freeze({ id: "classic", category: "package", total: 6_000 }),
      Object.freeze({ id: "labor", category: "labor", total: 1_200 }),
      Object.freeze({ id: "service", category: "service_fee", total: 600 })
    ]),
    tax: Object.freeze({ amount: 600, regionId: "austin", regionName: "Austin" }),
    discountTotal: 0,
    deposit: Object.freeze({ pct: 0.3, amount: 2_520 }),
    subtotal: 7_800,
    grandTotal: 8_400,
    rulesSnapshot: Object.freeze({ pricingSettingsVersion: 12 })
  })
});

const CONTEXT = Object.freeze({
  organizationId: "org-alpha",
  role: "sales",
  route: "/app/quotes/quote-pricing",
  activeOpportunityId: "quote-pricing",
  selectedObject: Object.freeze({
    id: "quote-pricing",
    type: "opportunity",
    label: "Autumn Benefit Dinner"
  }),
  revision: "v0012",
  sourceFreshness: Object.freeze({ state: "fresh", observedAt: OBSERVED_AT }),
  pendingPreview: null
});

function impactPreview({ receipt = null } = {}) {
  const server = Boolean(receipt);
  const source = {
    sourceId: server ? receipt.id : "client-calculator:v0012:150-guests",
    label: server ? "Immutable server simulation receipt" : "Current tenant catalog calculation",
    type: server ? "server_simulation_receipt" : "client_pricing_calculation",
    state: "available",
    observedAt: OBSERVED_AT
  };
  return createImpactPreview({
    id: server ? "pricing-server-150" : "pricing-client-150",
    object: { id: QUOTE.id, type: "pricing", label: "Pricing" },
    previewKind: server ? "server_simulation" : "client_calculation",
    evidenceAuthority: server ? "server_authoritative" : "client_calculated",
    status: server ? "available" : "partial",
    baseRevision: "v0012",
    source,
    provenance: [source],
    freshness: { state: "fresh", observedAt: OBSERVED_AT },
    confidence: {
      level: "high",
      basis: server
        ? "The immutable receipt matches this exact server projection."
        : "The current tenant catalog produced this bounded client calculation."
    },
    why: "The active guest scenario changes commercial scope from 120 to 150 guests.",
    consequence: "The scenario adds $1,500.00 while the saved quote remains unchanged.",
    doNothing: "The saved v0012 total remains $8,400.00 for 120 guests.",
    before: { facts: { guests: 120 }, commercial: { currency: "USD", total: 8_400, deposit: 2_520 } },
    after: { facts: { guests: 150 }, commercial: { currency: "USD", total: 9_900, deposit: 2_970 } },
    deltas: [{ field: "guests", before: 120, after: 150 }],
    commercialDeltas: {
      total: { currency: "USD", before: 8_400, after: 9_900, delta: 1_500 },
      deposit: { currency: "USD", before: 2_520, after: 2_970, delta: 450 }
    },
    affectedDependencies: [{
      object: { id: "staffing", type: "operational_fact", label: "Staffing" },
      relationship: "Guest count drives the declared house staffing ratio.",
      consequence: "Review staffing before adopting the scenario."
    }],
    warnings: ["The saved quote is unchanged until an authoritative save succeeds."],
    unavailableReasons: server ? [] : ["Server simulation receipt is not attached to this client preview."],
    receipt
  });
}

function deferred() {
  let resolve;
  let reject;
  const promise = new Promise((resolvePromise, rejectPromise) => {
    resolve = resolvePromise;
    reject = rejectPromise;
  });
  return { promise, resolve, reject };
}

let container;
let root;
let originalRequestAnimationFrame;
let originalCancelAnimationFrame;

function mount(props = {}) {
  act(() => {
    root.render(
      <AmbientContextProvider value={CONTEXT}>
        <AmbientLivingOpportunity
          quote={QUOTE}
          source="firebase"
          ordinaryEditAllowed
          pricingPreviewAvailable
          pricingMargin={{
            available: true,
            revenue: 8_400,
            cost: 5_880,
            marginPct: 0.3,
            target: 0.4,
            targetNote: "Tenant target is 40%."
          }}
          onBackToQuotes={() => {}}
          onEditQuote={() => ({ status: "opened" })}
          onOpenWorkflow={() => {}}
          onOpenConversation={() => {}}
          onSimulatePricing={vi.fn(async () => ({ preview: impactPreview() }))}
          {...props}
        />
      </AmbientContextProvider>
    );
  });
}

function button(name) {
  return [...container.querySelectorAll("button")].find((candidate) => (
    candidate.textContent.replace(/\s+/gu, " ").trim().includes(name)
  ));
}

function changeInput(input, value) {
  const setter = Object.getOwnPropertyDescriptor(
    window.HTMLInputElement.prototype,
    "value"
  ).set;
  act(() => {
    setter.call(input, String(value));
    input.dispatchEvent(new Event("input", { bubbles: true }));
  });
}

async function settle() {
  await act(async () => {
    await Promise.resolve();
    await new Promise((resolve) => window.setTimeout(resolve, 0));
  });
}

async function stageGuestScenario(value = 150) {
  act(() => container.querySelector('[aria-label="Change Guest count scenario"]').click());
  changeInput(container.querySelector('input[type="number"]'), value);
  act(() => button("Apply change").click());
  await settle();
  expect(container.querySelector('[role="dialog"]')?.textContent).toContain(`${value} guests`);
  act(() => container.querySelector('[aria-label="Close context"]').click());
  await settle();
}

function openPricing() {
  const trigger = button("Review pricing");
  trigger.focus();
  act(() => trigger.click());
  return { trigger, dialog: container.querySelector('[role="dialog"]') };
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

describe("Ambient pricing intelligent object", () => {
  test("opens a populated authoritative inspector with commercial, margin, dependency, and boundary evidence", () => {
    mount();

    const { dialog } = openPricing();

    expect(dialog).not.toBeNull();
    expect(dialog.textContent).toContain("Pricing details");
    expect(dialog.textContent).toContain("Current saved pricing");
    expect(dialog.textContent).toContain("$8,400.00");
    expect(dialog.textContent).toContain("Calculated Aug 11, 2026, 3:00 PM UTC.");
    expect(dialog.textContent).toContain("Subtotal$7,800.00");
    expect(dialog.textContent).toContain("Deposit requirement$2,520.00");
    expect(dialog.textContent).toContain("Recorded discount$0.00");
    expect(dialog.querySelector('[aria-label="Saved price breakdown"]')?.textContent)
      .toContain("Package · 1 line$6,000.00");
    expect(dialog.textContent).toContain("30.0% recorded-cost margin");
    expect(dialog.textContent).toContain("10.0 points and approximately $840.00 below target");
    expect(dialog.textContent).toContain("Guest count");
    expect(dialog.textContent).toContain("Why this is here");
    expect(dialog.textContent).toContain("If you do nothing");
    expect(dialog.textContent).toContain("Confidence: high");
    expect(dialog.textContent).toContain("Nothing changes until you use the quote workflow");
    expect(container.querySelector('[data-result-kind="context"]')?.textContent)
      .toContain("Pricing details ready");
    expect(dialog.querySelector('[data-capability-id="aiui-10-pricing-impact-preview"]')
      ?.getAttribute("data-capability-state")).toBe("ready");
    expect(dialog.querySelector('[data-capability-id="aiui-10-pricing-impact-preview"]')?.outerHTML)
      .toContain('data-capability-state="ready"');
  });

  test("acknowledges a counterfactual immediately, then renders a bounded client preview", async () => {
    const request = deferred();
    const onSimulatePricing = vi.fn(() => request.promise);
    mount({ onSimulatePricing });
    await stageGuestScenario(150);
    openPricing();

    act(() => button("Price 150 guests").click());

    const pending = container.querySelector('[data-pricing-result-state="loading"]');
    expect(pending).not.toBeNull();
    expect(pending.textContent).toContain("Calculating this price preview");
    expect(button("Calculating…").disabled).toBe(true);
    expect(container.querySelector('[data-result-kind="pending"]')?.textContent)
      .toContain("Calculating the guest count preview");
    expect(container.querySelector('[data-capability-id="aiui-10-pricing-impact-preview"]')
      ?.getAttribute("data-capability-state")).toBe("submitting");
    expect(container.querySelector('[data-capability-id="aiui-10-pricing-impact-preview"]')?.outerHTML)
      .toContain('data-capability-state="submitting"');
    expect(onSimulatePricing).toHaveBeenCalledWith({
      quote: QUOTE,
      guestCount: 150,
      requestId: ""
    });

    await act(async () => {
      request.resolve({ preview: impactPreview() });
      await request.promise;
    });

    const success = container.querySelector('[data-pricing-result-state="success"]');
    expect(success).not.toBeNull();
    expect(success.textContent).toContain("Current catalog price$8,400.00");
    expect(success.textContent).toContain("Scenario$9,900.00");
    expect(success.textContent).toContain("Change$1,500.00");
    expect(success.textContent).toContain("The scenario adds $1,500.00 while the saved quote remains unchanged.");
    expect(success.textContent).toContain("If unchanged: The saved v0012 total remains $8,400.00 for 120 guests.");
    expect(success.textContent).toContain("Current tenant catalog calculation. Planning preview only. Nothing was saved.");
    expect(container.querySelector('[data-result-kind="preview"]')?.textContent)
      .toContain("Price preview ready");
    expect(container.querySelector('[data-capability-id="aiui-10-pricing-impact-preview"]')
      ?.getAttribute("data-capability-state")).toBe("ready");
  });

  test("renders staff-only advisory margin context when both counterfactual sides have complete costs", async () => {
    const onSimulatePricing = vi.fn(async () => ({
      preview: impactPreview(),
      marginContext: {
        status: "available",
        authority: "advisory_client_cost_context",
        current: { marginPct: 0.3 },
        proposed: { marginPct: 0.36 },
        deltas: { marginPoints: 6 },
        boundary: "Advisory staff-only current-catalog cost context; not authoritative repricing or approval evidence."
      }
    }));
    mount({ onSimulatePricing });
    await stageGuestScenario(150);
    openPricing();

    await act(async () => {
      button("Price 150 guests").click();
      await Promise.resolve();
    });

    const margin = container.querySelector('[data-margin-context-state="available"]');
    expect(margin).not.toBeNull();
    expect(margin.textContent).toContain("Current30.0%");
    expect(margin.textContent).toContain("Scenario36.0%");
    expect(margin.textContent).toContain("Point change+6.0 pts");
    expect(margin.textContent).toContain("not authoritative repricing or approval evidence");
  });

  test("renders the exact immutable receipt returned by a server simulation", async () => {
    const receipt = Object.freeze({
      id: "ccs_111111111111111111111111111111111111111111111111",
      requestId: "change_sim_22222222222222222222222222222222",
      digest: "3".repeat(64),
      type: "simulation",
      baseRevision: "v0012",
      proposedRevision: "v0012-counterfactual",
      simulatedAt: OBSERVED_AT,
      expiresAt: "2026-08-11T15:15:00.000Z",
      authorizationRequired: true
    });
    const onSimulatePricing = vi.fn(async () => ({
      preview: impactPreview({ receipt }),
      requestId: receipt.requestId,
      marginContext: {
        status: "unavailable",
        unavailableReasons: [
          "The server simulation does not carry complete staff-only cost-line evidence; margin remains independently governed."
        ],
        boundary: "Staff-only cost context remains separate from the immutable pricing receipt."
      }
    }));
    mount({ onSimulatePricing });
    await stageGuestScenario(150);
    openPricing();

    await act(async () => {
      button("Price 150 guests").click();
      await Promise.resolve();
    });

    const success = container.querySelector('[data-pricing-result-state="success"]');
    expect(success.textContent).toContain("Saved version$8,400.00");
    expect(success.textContent).toContain(`Server simulation receipt ${receipt.id} recorded. Nothing was saved.`);
    expect(success.textContent).toContain("Immutable server simulation receipt");
    expect(container.querySelector('[data-result-kind="receipt"]')?.textContent)
      .toContain("Price preview confirmed");
    expect(container.querySelector('[data-capability-id="aiui-10-pricing-impact-preview"]')
      ?.getAttribute("data-capability-state")).toBe("receipt");
    expect(container.querySelector('[data-capability-id="aiui-10-pricing-impact-preview"]')?.outerHTML)
      .toContain('data-capability-state="receipt"');
    expect(container.textContent).not.toContain("Planning preview only");
    expect(success.querySelector('[data-margin-context-state="unavailable"]')?.textContent)
      .toContain("margin remains independently governed");
  });

  test("invalidates an old pricing preview and margin context when the guest counterfactual changes", async () => {
    const request = deferred();
    const onSimulatePricing = vi.fn(() => request.promise);
    mount({ onSimulatePricing });
    await stageGuestScenario(150);
    openPricing();

    act(() => button("Price 150 guests").click());
    expect(container.querySelector('[data-pricing-result-state="loading"]')).not.toBeNull();
    act(() => container.querySelector('[aria-label="Close context"]').click());
    await settle();

    await stageGuestScenario(160);
    await act(async () => {
      request.resolve({
        preview: impactPreview(),
        marginContext: {
          status: "available",
          current: { marginPct: 0.3 },
          proposed: { marginPct: 0.36 },
          deltas: { marginPoints: 6 }
        }
      });
      await request.promise;
    });

    openPricing();
    expect(container.querySelector('[data-pricing-result-state]')).toBeNull();
    expect(container.querySelector('[data-margin-context-state]')).toBeNull();
    expect(button("Price 160 guests")).not.toBeUndefined();
    expect(container.textContent).not.toContain("Current catalog price$8,400.00");
  });

  test("shows contextual recovery after a failed counterfactual without changing the scenario or saved quote", async () => {
    const failure = Object.assign(new Error("The pricing service did not return a bounded result."), {
      userMessage: "Pricing is temporarily unavailable for this exact scenario.",
      definitive: true
    });
    const onSimulatePricing = vi.fn(async () => {
      throw failure;
    });
    mount({ onSimulatePricing });
    await stageGuestScenario(150);
    openPricing();

    await act(async () => {
      button("Price 150 guests").click();
      await Promise.resolve();
    });

    const error = container.querySelector('[data-pricing-result-state="error"]');
    expect(error).not.toBeNull();
    expect(error.querySelector('[role="alert"]')?.textContent)
      .toContain("Pricing is temporarily unavailable for this exact scenario");
    expect(container.querySelector('[data-result-kind="recovery"]')?.textContent)
      .toContain("Pricing preview unavailable");
    expect(container.querySelector('[data-result-kind="recovery"]')?.textContent)
      .toContain("saved quote and unsaved guest preview remain unchanged");
    expect(button("Price 150 guests").disabled).toBe(false);
    expect(QUOTE.event.guests).toBe(120);
    expect(container.querySelector('[data-intelligent-object="guest-count"]')?.textContent)
      .toContain("150 guests");
    expect(container.querySelector('[data-capability-id="aiui-10-pricing-impact-preview"]')
      ?.getAttribute("data-capability-state")).toBe("error");
    expect(container.querySelector('[data-capability-id="aiui-10-pricing-impact-preview"]')?.outerHTML)
      .toContain('data-capability-state="error"');
  });

  test("reconciles a transport-uncertain simulation with the exact retained request identity", async () => {
    const requestId = "change_sim_44444444444444444444444444444444";
    const reconciliation = deferred();
    const onSimulatePricing = vi.fn()
      .mockRejectedValueOnce(Object.assign(new Error("The pricing response was interrupted."), {
        userMessage: "The pricing response is uncertain for this exact request.",
        requestId
      }))
      .mockImplementationOnce(() => reconciliation.promise);
    mount({ onSimulatePricing });
    await stageGuestScenario(150);
    openPricing();

    await act(async () => {
      button("Price 150 guests").click();
      await Promise.resolve();
    });

    expect(container.querySelector('[data-pricing-result-state="error"] [role="alert"]')?.textContent)
      .toContain("uncertain for this exact request");
    expect(container.querySelector('[data-result-kind="recovery"]')?.textContent)
      .toContain("Check the previous pricing request before starting another preview");

    act(() => button("Price 150 guests").click());

    expect(container.querySelector('[data-pricing-result-state="recovery"]')?.textContent)
      .toContain("Calculating this price preview");
    expect(container.querySelector('[data-result-kind="pending"]')?.textContent)
      .toContain("Checking the previous pricing request");
    expect(container.querySelector('[data-capability-id="aiui-10-pricing-impact-preview"]')
      ?.getAttribute("data-capability-state")).toBe("reconciliation");
    expect(container.querySelector('[data-capability-id="aiui-10-pricing-impact-preview"]')?.outerHTML)
      .toContain('data-capability-state="reconciliation"');
    expect(onSimulatePricing).toHaveBeenLastCalledWith({
      quote: QUOTE,
      guestCount: 150,
      requestId
    });
  });

  test("restores focus to the exact pricing trigger after dismissal", async () => {
    mount();
    const { trigger, dialog } = openPricing();
    expect(dialog).not.toBeNull();
    expect(document.activeElement).not.toBe(trigger);

    act(() => {
      document.dispatchEvent(new window.KeyboardEvent("keydown", {
        key: "Escape",
        bubbles: true
      }));
    });
    await settle();

    expect(container.querySelector('[role="dialog"]')).toBeNull();
    expect(document.activeElement).toBe(trigger);
    expect(container.querySelector('[data-result-kind="resolved"]')?.textContent)
      .toContain("Pricing context closed");
  });
});
