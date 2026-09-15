// @vitest-environment jsdom

import React, { act, useState } from "react";
import { createRoot } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, test, vi } from "vitest";
import CommercialScenarioWorkbench, {
  workbenchProjectionMatchesScenario
} from "../CommercialScenarioWorkbench";
import { buildCommercialScenarioInputDigest } from "../../lib/commercialScenarioWorkbench";

globalThis.IS_REACT_ACT_ENVIRONMENT = true;

const REVISION = "quote-revision-14";
const CURRENT_GUESTS = 125;
const SCOPE = "org-1:quote-1";

function requestEnvelope({
  scenarioId = "scenario-a",
  generation = 1,
  guestCount = 175,
  baseQuoteRevisionId = REVISION,
  scopeKey = SCOPE
} = {}) {
  return {
    scenarioId,
    generation,
    guestCount,
    baseQuoteRevisionId,
    inputDigest: buildCommercialScenarioInputDigest({
      scopeKey,
      scenarioId,
      generation,
      guestCount,
      baseQuoteRevisionId
    })
  };
}

function projection(guests, {
  workbenchRequest = null,
  proposalChanged = guests !== CURRENT_GUESTS,
  state = "partial",
  nextAction = null,
  previewError = ""
} = {}) {
  const shortage = guests > 137;
  const total = 12_480 + ((guests - CURRENT_GUESTS) * 88.8);
  const deposit = 3_120 + ((guests - CURRENT_GUESTS) * 22.2);
  const ingredientCost = 80_000 + ((guests - CURRENT_GUESTS) * 640);
  const shortageQuantityMicros = shortage ? (guests - 137) * 100_000 : 0;
  const supplyShortages = shortage ? [{
    resourceId: "chicken-breast",
    resourceLabel: "Chicken breast",
    shortageQuantityMicros,
    unitId: "lb"
  }] : [];
  return Object.freeze({
    schemaVersion: "living-commercial-twin-v1",
    authority: "presentation_only_projection",
    state,
    scenario: {
      currentGuestCount: CURRENT_GUESTS,
      proposedGuestCount: guests,
      guestDelta: guests - CURRENT_GUESTS,
      changed: guests !== CURRENT_GUESTS,
      proposalChanged,
      selectedMenuItemNames: ["Chicken Alfredo", "Seasonal greens"],
      workbenchRequest
    },
    consequences: {
      commercial: {
        evidenceState: guests === CURRENT_GUESTS ? "not_applicable" : "available",
        currency: "USD",
        total: {
          before: 12_480,
          proposedAfter: total,
          delta: total - 12_480
        },
        depositRequirement: {
          before: 3_120,
          proposedAfter: deposit,
          delta: deposit - 3_120
        }
      },
      inventory: {
        evidenceState: guests === CURRENT_GUESTS ? "not_applicable" : "available",
        cost: {
          currency: "USD",
          beforeMinor: 80_000,
          proposedAfterMinor: ingredientCost,
          deltaMinor: ingredientCost - 80_000
        },
        ingredients: shortage ? [{
          ingredientId: "chicken-breast",
          ingredientName: "Chicken breast",
          baseUnitId: "lb",
          requiredQuantityMicros: {
            before: 25_000_000,
            proposedAfter: 35_000_000,
            delta: 10_000_000
          },
          shortageQuantityMicros: {
            before: 0,
            proposedAfter: shortageQuantityMicros,
            delta: shortageQuantityMicros
          }
        }] : [],
        shortages: supplyShortages
      },
      staffing: {
        evidenceState: "available",
        effect: "review_required"
      },
      beo: {
        evidenceState: "available",
        effect: "stale"
      }
    },
    fulfillment: {
      state: "partial",
      identity: {
        organizationId: "org-1",
        quoteId: "quote-1",
        quoteRevisionId: REVISION,
        scenarioId: `scenario-${guests}`
      },
      people: {
        evidenceState: "available",
        freshness: "current",
        current: { totalAssigned: 6, totalRequired: 6, totalGap: 0 },
        proposed: { totalAssigned: 6, totalRequired: guests >= 168 ? 7 : 6 },
        resilience: { evidenceState: "available", eligibleProfileCount: 2 },
        staffingHeadroom: {
          state: "missing",
          evidenceState: "missing",
          safeGuestIncrease: null,
          safeThroughGuestCount: null
        }
      },
      supply: {
        evidenceState: "available",
        freshness: "current",
        current: {
          guestCount: CURRENT_GUESTS,
          coverageState: "covered",
          shortages: [],
          projectedCost: { state: "available", currency: "USD", amountMinor: 80_000 }
        },
        proposed: {
          guestCount: guests,
          coverageState: shortage ? "shortage" : "covered",
          shortages: supplyShortages,
          projectedCost: { state: "available", currency: "USD", amountMinor: ingredientCost }
        },
        inventoryHeadroom: {
          state: "available",
          evidenceState: "available",
          safeGuestIncrease: 12,
          safeThroughGuestCount: 137,
          nextBoundary: {
            atGuestCount: 138,
            kind: "inventory_shortage",
            resource: {
              resourceId: "chicken-breast",
              resourceLabel: "Chicken breast"
            }
          }
        }
      },
      fulfillmentHeadroom: {
        state: "missing",
        evidenceState: "missing",
        safeGuestIncrease: null
      },
      limitingDomain: shortage ? "supply" : null,
      limitingResource: shortage ? {
        resourceId: "chicken-breast",
        resourceLabel: "Chicken breast"
      } : null,
      constraints: shortage ? [{
        domain: "supply",
        kind: "inventory_shortage",
        quantity: shortageQuantityMicros,
        resource: {
          resourceId: "chicken-breast",
          resourceLabel: "Chicken breast",
          unitId: "lb"
        }
      }] : [],
      sourceRevisions: {
        people: { authorityVersion: "staffing-v1", planRevision: 4 },
        supply: { proposedAfter: { projectionDigest: `inventory-${guests}` } }
      }
    },
    nextAction,
    provenance: { previewError: previewError || null },
    boundary: "Presentation-only projection. Separate authorities remain unchanged."
  });
}

let container;
let root;

beforeEach(() => {
  container = document.createElement("div");
  document.body.appendChild(container);
  root = createRoot(container);
});

afterEach(() => {
  act(() => root.unmount());
  container.remove();
  vi.useRealTimers();
  vi.restoreAllMocks();
});

function button(label) {
  return [...container.querySelectorAll("button")]
    .find((entry) => entry.textContent.trim() === label);
}

function changeNumberInput(input, value) {
  const setter = Object.getOwnPropertyDescriptor(
    window.HTMLInputElement.prototype,
    "value"
  ).set;
  setter.call(input, value);
  input.dispatchEvent(new Event("input", { bubbles: true }));
}

function LiveHarness({ onReview = vi.fn(), onRequest = vi.fn() }) {
  const [guests, setGuests] = useState(175);
  const [accepted, setAccepted] = useState(() => requestEnvelope());
  const acceptRequest = (request) => {
    onRequest(request);
    setAccepted(request);
  };
  return (
    <CommercialScenarioWorkbench
      projection={projection(accepted.guestCount, {
        workbenchRequest: accepted,
        state: accepted.guestCount === CURRENT_GUESTS ? "unchanged" : "partial"
      })}
      scopeKey={SCOPE}
      baseQuoteRevisionId={REVISION}
      currentGuestCount={CURRENT_GUESTS}
      proposedGuestCount={guests}
      eventName="Henderson Dinner"
      eventDate="2026-10-10"
      eventTime="18:00"
      venue="Atrium"
      onGuestCountChange={setGuests}
      onRequestConsequences={acceptRequest}
      onReviewForCommitment={onReview}
      inventoryEvidenceAvailable
      onOpenInventory={() => {}}
      previewDebounceMs={20}
      clock={() => "2026-09-09T16:00:00.000Z"}
      idFactory={({ slot }) => `scenario-${slot.toLowerCase()}`}
    />
  );
}

describe("CommercialScenarioWorkbench", () => {
  test("resolves and restores the exact inventory constraint by editing the active scenario", () => {
    vi.useFakeTimers();
    act(() => root.render(<LiveHarness />));
    const surface = container.querySelector('[data-capability-id="commercial-scenario-workbench"]');
    expect(surface).not.toBeNull();
    expect(surface.getAttribute("data-authority")).toBe("session-only-non-authoritative");
    expect(surface.textContent).toContain("Commercial reviewHenderson DinnerScenario A · 175 guests");
    expect(surface.textContent).toContain("Current commitment · 125 guests");
    expect(surface.textContent).toContain("Current vs Scenario AWhat changes+50 guests");
    expect(button("Compare Current")).not.toBeUndefined();
    expect(button("Review change").disabled).toBe(false);
    expect(surface.textContent).toContain("$12,480.00$16,920.00+$4,440.00");
    expect(surface.textContent).toContain("Guest limit is not available");
    expect(surface.textContent).toContain("Unavailable details do not mean there is no capacity");

    const trigger = [...surface.querySelectorAll("button")]
      .find((entry) => entry.textContent.includes("Chicken breast is the first known constraint"));
    expect(trigger.getAttribute("aria-expanded")).toBe("false");
    act(() => trigger.click());
    expect(trigger.getAttribute("aria-expanded")).toBe("true");
    expect(surface.textContent).toContain("Why Chicken breast is limiting");
    expect(surface.textContent).toContain("covered through 137 guests; the first shortage appears at 138");
    expect(surface.textContent).toContain("does not reserve stock, choose a substitute, or create a purchase order");

    act(() => button("Try 137 guests").click());
    act(() => vi.runOnlyPendingTimers());
    expect(surface.textContent).toContain("Current vs Scenario AWhat changes+12 guests");
    expect(surface.textContent).toContain("No supply issue is listed for this option");

    const input = container.querySelector("#csw-guest-count");
    act(() => {
      changeNumberInput(input, "175");
    });
    act(() => vi.runOnlyPendingTimers());
    expect(surface.textContent).toContain("Current vs Scenario AWhat changes+50 guests");
    expect(surface.textContent).toContain("Chicken breast is the first known constraint");
  });

  test("duplicates and switches independent cached scenarios without treating either as a quote revision", () => {
    vi.useFakeTimers();
    const onRequest = vi.fn();
    act(() => root.render(<LiveHarness onRequest={onRequest} />));
    act(() => button("Duplicate scenario").click());
    expect(container.textContent).toContain("Scenario B · 175 guests");
    const allScenarioHeaders = [...container.querySelectorAll('[data-scenario-comparison="all"] th[scope="col"]')];
    expect(allScenarioHeaders).toHaveLength(3);
    expect(allScenarioHeaders.map((entry) => entry.textContent)).toEqual(expect.arrayContaining([
      "Measure",
      expect.stringContaining("CurrentCurrent"),
      expect.stringContaining("Scenario BChecking")
    ]));
    expect(container.querySelector('[data-scenario-column="scenario-b"][data-selected="true"]')).not.toBeNull();
    act(() => vi.runOnlyPendingTimers());
    expect(onRequest).toHaveBeenCalledTimes(1);
    expect(onRequest).toHaveBeenLastCalledWith(expect.objectContaining({
      scenarioId: "scenario-b",
      generation: 0,
      guestCount: 175
    }));

    const input = container.querySelector("#csw-guest-count");
    act(() => {
      changeNumberInput(input, "160");
    });
    act(() => vi.runOnlyPendingTimers());
    expect(onRequest).toHaveBeenCalledTimes(2);
    expect(container.textContent).toContain("Scenario B · 160 guests");
    expect(container.textContent).toContain("Current vs Scenario BWhat changes+35 guests");

    act(() => button("Scenario A").click());
    expect(container.textContent).toContain("Current vs Scenario AWhat changes+50 guests");
    expect(container.querySelector(".csw-consequence-rail").hasAttribute("aria-busy")).toBe(false);
    expect(button("Review change").disabled).toBe(false);
    act(() => vi.runOnlyPendingTimers());
    expect(onRequest).toHaveBeenCalledTimes(2);
    expect(container.querySelector('[role="tab"][aria-selected="true"]').textContent)
      .toContain("Scenario A");

    const scenarioB = [...container.querySelectorAll('[role="tab"]')]
      .find((entry) => entry.textContent.trim() === "Scenario B");
    act(() => {
      scenarioB.focus();
      scenarioB.dispatchEvent(new KeyboardEvent("keydown", { key: "Home", bubbles: true }));
    });
    expect(container.querySelector('[role="tab"][aria-selected="true"]').textContent)
      .toContain("Current");
    expect(container.querySelector('[data-scenario-comparison="selected"]').getAttribute("aria-label"))
      .toBe("Current compared with Current");
    expect(container.textContent).toContain("Pricing, staffing, inventory, and the BEO are unchanged");
    expect(container.textContent).not.toMatch(/best scenario/i);
  });

  test("retains the last exact result during a fenced recompute and separates review from commitment", () => {
    vi.useFakeTimers();
    const onRequest = vi.fn();
    const onReview = vi.fn();
    let setGuestCount;
    let setAcceptedRequest;
    function DelayedHarness() {
      const [guests, setGuests] = useState(175);
      const [acceptedRequest, setAccepted] = useState(() => requestEnvelope({
        scenarioId: "delayed-a"
      }));
      setGuestCount = setGuests;
      setAcceptedRequest = setAccepted;
      return (
        <CommercialScenarioWorkbench
          projection={projection(acceptedRequest.guestCount, {
            workbenchRequest: acceptedRequest
          })}
          scopeKey={SCOPE}
          baseQuoteRevisionId={REVISION}
          currentGuestCount={CURRENT_GUESTS}
          proposedGuestCount={guests}
          onGuestCountChange={setGuests}
          onRequestConsequences={onRequest}
          onReviewForCommitment={onReview}
          previewDebounceMs={80}
          clock={() => "2026-09-09T16:00:00.000Z"}
          idFactory={({ slot }) => `delayed-${slot.toLowerCase()}`}
        />
      );
    }

    act(() => root.render(<DelayedHarness />));
    expect(container.textContent).toContain("$16,920.00");
    act(() => setGuestCount(160));
    expect(container.textContent).toContain("Showing the previous result for 175 guests");
    expect(container.querySelector(".csw-consequence-rail").getAttribute("aria-busy")).toBe("true");
    expect(button("Checking change…").disabled).toBe(true);

    act(() => vi.advanceTimersByTime(80));
    expect(onRequest).toHaveBeenLastCalledWith(expect.objectContaining({
      baseQuoteRevisionId: REVISION,
      generation: 2,
      guestCount: 160,
      scenarioId: "delayed-a"
    }));

    act(() => setAcceptedRequest(requestEnvelope({
      scenarioId: "delayed-a",
      generation: 2,
      guestCount: 160
    })));
    expect(container.textContent).not.toContain("Showing the previous result for 175 guests");
    expect(button("Review change").disabled).toBe(false);
    act(() => button("Review change").click());
    expect(onReview).toHaveBeenCalledOnce();
    expect(onReview).toHaveBeenCalledWith(expect.objectContaining({
      guestCount: 160,
      generation: 2,
      projection: expect.objectContaining({ authority: "presentation_only_projection" })
    }));
    expect(container.textContent).not.toMatch(/apply scenario|commit scenario/i);
  });

  test("rejects every mismatched field in the five-field projection envelope", () => {
    const exact = requestEnvelope();
    const scenario = { kind: "working", ...exact, inputDigest: exact.inputDigest };
    expect(workbenchProjectionMatchesScenario(
      projection(175, { workbenchRequest: exact }),
      scenario
    )).toBe(true);

    const mismatches = [
      { scenarioId: "scenario-b" },
      { generation: 2 },
      { inputDigest: `${exact.inputDigest}-wrong` },
      { baseQuoteRevisionId: "quote-revision-15" },
      { guestCount: 176 }
    ];
    mismatches.forEach((mismatch) => {
      expect(workbenchProjectionMatchesScenario(
        projection(mismatch.guestCount ?? 175, {
          workbenchRequest: { ...exact, ...mismatch }
        }),
        scenario
      )).toBe(false);
    });

    const currentScenario = {
      kind: "current",
      ...requestEnvelope({ scenarioId: "current", generation: 0, guestCount: CURRENT_GUESTS })
    };
    expect(workbenchProjectionMatchesScenario(
      projection(CURRENT_GUESTS),
      currentScenario
    )).toBe(true);
    expect(workbenchProjectionMatchesScenario(
      projection(CURRENT_GUESTS, { workbenchRequest: exact }),
      currentScenario
    )).toBe(false);
  });

  test("returns to immutable Current without destroying the working alternative", () => {
    vi.useFakeTimers();
    const onRequest = vi.fn();
    act(() => root.render(<LiveHarness onRequest={onRequest} />));
    const requestsBeforeReturn = onRequest.mock.calls.length;
    const input = container.querySelector("#csw-guest-count");
    act(() => changeNumberInput(input, String(CURRENT_GUESTS)));
    act(() => vi.runAllTimers());
    expect(onRequest).toHaveBeenCalledTimes(requestsBeforeReturn);
    expect(container.querySelector('[role="tab"][aria-selected="true"]').textContent)
      .toContain("Current");
    expect(container.textContent).toContain("Scenario A");
  });

  test("keeps exact preview failures explicit and retries only through the recovery action", () => {
    vi.useFakeTimers();
    const exact = requestEnvelope();
    const onRequest = vi.fn();
    const onRetry = vi.fn();
    act(() => root.render(
      <CommercialScenarioWorkbench
        projection={projection(175, {
          workbenchRequest: exact,
          state: "awaiting_preview",
          nextAction: { kind: "retry_preview", disabled: false },
          previewError: "The exact simulation timed out."
        })}
        scopeKey={SCOPE}
        baseQuoteRevisionId={REVISION}
        currentGuestCount={CURRENT_GUESTS}
        proposedGuestCount={175}
        onGuestCountChange={() => {}}
        onRequestConsequences={onRequest}
        onRetryConsequences={onRetry}
        previewDebounceMs={0}
        idFactory={({ slot }) => `scenario-${slot.toLowerCase()}`}
      />
    ));

    act(() => vi.runAllTimers());
    expect(onRequest).not.toHaveBeenCalled();
    expect(container.querySelector('[data-capability-state="recovery"]')).not.toBeNull();
    expect(container.querySelector('[role="alert"]').textContent)
      .toContain("This change could not be checked");
    expect(button("Try again").disabled).toBe(false);
    act(() => button("Try again").click());
    expect(onRetry).toHaveBeenCalledOnce();
    expect(onRetry).toHaveBeenCalledWith(exact);
  });

  test("fences a non-guest Current draft until its exact request returns", () => {
    const onPreview = vi.fn();
    const currentRequest = requestEnvelope({
      scenarioId: "current",
      generation: 0,
      guestCount: CURRENT_GUESTS
    });
    const renderProjection = (workbenchRequest) => act(() => root.render(
      <CommercialScenarioWorkbench
        projection={projection(CURRENT_GUESTS, {
          workbenchRequest,
          proposalChanged: true,
          state: workbenchRequest ? "partial" : "awaiting_preview",
          nextAction: { kind: "preview_consequences", disabled: false }
        })}
        scopeKey={SCOPE}
        baseQuoteRevisionId={REVISION}
        currentGuestCount={CURRENT_GUESTS}
        proposedGuestCount={CURRENT_GUESTS}
        onPreview={onPreview}
      />
    ));

    renderProjection(null);
    expect(button("Check change").disabled).toBe(false);
    act(() => button("Check change").click());
    expect(onPreview).toHaveBeenCalledWith(currentRequest);

    renderProjection({ ...currentRequest, inputDigest: `${currentRequest.inputDigest}-wrong` });
    expect(button("Check change").disabled).toBe(false);
    renderProjection(currentRequest);
    expect(button("Review change").disabled).toBe(false);
  });

  test("hard-resets scenarios and caches when the non-guest scope changes", () => {
    vi.useFakeTimers();
    const onRequest = vi.fn();
    const scopeA = "org-1:quote-1:draft-context-1";
    const scopeB = "org-1:quote-1:draft-context-2";
    const acceptedA = requestEnvelope({ scopeKey: scopeA });
    const renderScope = (scopeKey) => act(() => root.render(
      <CommercialScenarioWorkbench
        projection={projection(175, { workbenchRequest: acceptedA })}
        scopeKey={scopeKey}
        baseQuoteRevisionId={REVISION}
        currentGuestCount={CURRENT_GUESTS}
        proposedGuestCount={175}
        onGuestCountChange={() => {}}
        onRequestConsequences={onRequest}
        previewDebounceMs={0}
        idFactory={({ slot }) => `scenario-${slot.toLowerCase()}`}
      />
    ));

    renderScope(scopeA);
    act(() => button("Duplicate scenario").click());
    expect(container.textContent).toContain("Scenario B");
    renderScope(scopeB);
    expect(container.textContent).not.toContain("Scenario B");
    act(() => vi.runAllTimers());
    expect(onRequest).toHaveBeenLastCalledWith(expect.objectContaining({
      scenarioId: "scenario-a",
      generation: 1,
      guestCount: 175,
      inputDigest: buildCommercialScenarioInputDigest({
        scopeKey: scopeB,
        scenarioId: "scenario-a",
        baseQuoteRevisionId: REVISION,
        generation: 1,
        guestCount: 175
      })
    }));
  });

  test("clears invalid guest input with Escape and exposes all-scenario plus selected-scenario comparisons", () => {
    act(() => root.render(<LiveHarness />));
    const input = container.querySelector("#csw-guest-count");
    act(() => changeNumberInput(input, "401"));
    expect(input.getAttribute("aria-invalid")).toBe("true");
    act(() => input.dispatchEvent(new KeyboardEvent("keydown", { key: "Escape", bubbles: true })));
    expect(input.value).toBe("175");
    expect(input.hasAttribute("aria-invalid")).toBe(false);
    expect(container.querySelectorAll('[data-scenario-comparison="all"] th[scope="col"]')).toHaveLength(3);
    expect(container.querySelector('[data-scenario-comparison="all"] caption').textContent)
      .toBe("Current quote compared with each option");
    expect(container.querySelector('[data-scenario-comparison="selected"]').getAttribute("aria-label"))
      .toBe("Current compared with Scenario A");
    expect(container.querySelector('[data-scenario-comparison="selected"]').textContent)
      .toContain("Quote total · Current$12,480.00Quote total · Scenario A$16,920.00Difference+$4,440.00");
    expect([...container.querySelectorAll("button")]
      .filter((entry) => entry.textContent.trim() === "Discard scenario")).toHaveLength(1);
  });

  test("does not create a scenario request from incomplete current authority", () => {
    const onRequest = vi.fn();
    const onReview = vi.fn();
    act(() => root.render(
      <CommercialScenarioWorkbench
        projection={null}
        scopeKey={SCOPE}
        currentGuestCount={CURRENT_GUESTS}
        onRequestConsequences={onRequest}
        onReviewForCommitment={onReview}
      />
    ));
    expect(container.querySelector('[data-capability-state="unavailable"]')).not.toBeNull();
    expect(onRequest).not.toHaveBeenCalled();
    act(() => button("Review current quote").click());
    expect(onReview).toHaveBeenCalledWith({ reason: "incomplete_scenario_authority" });
  });
});
