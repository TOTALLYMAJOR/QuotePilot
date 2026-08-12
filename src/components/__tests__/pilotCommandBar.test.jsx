// @vitest-environment jsdom
import React from "react";
import { createRoot } from "react-dom/client";
import { act } from "react-dom/test-utils";
import { afterEach, beforeEach, describe, expect, test, vi } from "vitest";
import PilotCommandBar from "../PilotCommandBar";

globalThis.IS_REACT_ACT_ENVIRONMENT = true;

const settings = {
  perMileRate: 0.7,
  longDistancePerMileRate: 1.1,
  deliveryThresholdMiles: 30,
  serverRate: 22,
  chefRate: 28,
  bartenderRate: 30,
  serviceFeePct: 0.2,
  serviceFeeTiers: [{ id: "all", minGuests: 0, maxGuests: 9999, pct: 0.2 }],
  taxRate: 0.1,
  taxRegions: [{ id: "local", name: "Local", rate: 0.1 }],
  defaultTaxRegion: "local",
  depositPct: 0.3,
  seasonalProfiles: [{
    id: "standard", name: "Standard",
    startMonth: 1, startDay: 1, endMonth: 12, endDay: 31,
    packageMultiplier: 1, addonMultiplier: 1, rentalMultiplier: 1
  }],
  menuSections: []
};

const catalog = { packages: [{ id: "classic", name: "Classic", ppp: 20 }], addons: [], rentals: [], settings };

const form = {
  pkg: "classic", guests: 120, hours: 6, servers: 8, chefs: 3, bartenders: 2,
  addons: [], rentals: [], menuItems: [], addonQuantities: {}, rentalQuantities: {},
  menuItemQuantities: {}, milesRT: 0, date: "2026-03-15", style: "Plated"
};

const scenarioOrganizationId = "pilot-scenario-org";
const scenarioObservedAt = "2026-08-12T12:00:00.000Z";

function scenarioSettings(overrides = {}) {
  return {
    ...settings,
    serviceFeePct: 0,
    serviceFeeTiers: [],
    taxRate: 0,
    taxRegions: [],
    depositPct: 0.3,
    staffingLaborEnabled: false,
    targetMarginPct: 0.4,
    ...overrides
  };
}

function scenarioCatalogEvidence(overrides = {}) {
  return {
    organizationId: scenarioOrganizationId,
    sourceLabel: "firebase-org",
    catalogRevision: 21,
    freshness: { state: "fresh", observedAtISO: scenarioObservedAt },
    packages: [
      { id: "classic", name: "Classic", ppp: 50, costPpp: 30, active: true },
      { id: "focused", name: "Focused", ppp: 40, costPpp: 20, active: true }
    ],
    addons: [{
      id: "champagne",
      name: "Champagne service",
      price: 1000,
      cost: 900,
      pricingType: "per_event",
      active: true
    }],
    rentals: [],
    menuSections: [],
    upsellRules: [],
    ...overrides
  };
}

function scenarioForm(overrides = {}) {
  return {
    ...form,
    pkg: "classic",
    guests: 100,
    servers: 0,
    chefs: 0,
    bartenders: 0,
    eventTemplateId: "wedding-template",
    addons: ["champagne"],
    ...overrides
  };
}

let container;
let root;
let recognitionInstances;

class FakeSpeechRecognition {
  constructor() {
    recognitionInstances.push(this);
    this.started = false;
    this.stopped = false;
    this.aborted = false;
  }

  start() {
    this.started = true;
  }

  confirmStart() {
    this.onstart?.();
  }

  result(transcript) {
    this.onresult?.({ results: [[{ transcript }]] });
  }

  stop() {
    this.stopped = true;
  }

  abort() {
    this.aborted = true;
  }

  end() {
    this.onend?.();
  }

  error(name) {
    this.onerror?.({ error: name });
  }
}

beforeEach(() => {
  recognitionInstances = [];
  delete window.SpeechRecognition;
  delete window.webkitSpeechRecognition;
  container = document.createElement("div");
  document.body.appendChild(container);
  root = createRoot(container);
});

afterEach(() => {
  act(() => root.unmount());
  container.remove();
  delete window.SpeechRecognition;
  delete window.webkitSpeechRecognition;
});

function render(props = {}) {
  act(() => {
    root.render(
      <PilotCommandBar
        ambientEnabled
        form={form}
        catalog={catalog}
        settings={settings}
        styles={["Buffet", "Plated", "Stations", "Drop-off"]}
        onStageProposal={() => {}}
        {...props}
      />
    );
  });
}

function setCommand(value) {
  const input = container.querySelector(".pilot-command-input");
  act(() => {
    const setter = Object.getOwnPropertyDescriptor(window.HTMLInputElement.prototype, "value").set;
    setter.call(input, value);
    input.dispatchEvent(new Event("input", { bubbles: true }));
  });
}

function clickByText(label) {
  const button = [...container.querySelectorAll("button")]
    .find((element) => element.textContent.trim() === label);
  expect(button, `button "${label}"`).toBeTruthy();
  act(() => {
    button.dispatchEvent(new MouseEvent("click", { bubbles: true }));
  });
}

function enableFakeSpeechRecognition() {
  window.SpeechRecognition = FakeSpeechRecognition;
}

function pointerEvent(type, options = {}) {
  const EventConstructor = window.PointerEvent || window.MouseEvent;
  return new EventConstructor(type, {
    bubbles: true,
    button: 0,
    pointerId: 7,
    ...options
  });
}

function voiceButton() {
  return container.querySelector(".pilot-command-voice");
}

describe("PilotCommandBar", () => {
  test("keeps expanded queries, package commands, and scenarios dormant outside Ambient", () => {
    const onStageProposal = vi.fn();
    render({ ambientEnabled: false, onStageProposal });
    const surface = container.querySelector(".pilot-command");
    expect(surface.dataset).toMatchObject({
      pilotCommand: "change-request-parse-v1",
      pilotExpanded: "false"
    });

    setCommand("explain this price and switch package to Premium and get this under $4,500");
    clickByText("Preview");
    expect(container.querySelector(".pilot-command-query")).toBeNull();
    expect(container.querySelector(".pilot-command-scenario")).toBeNull();
    expect(container.textContent).not.toContain("Package → Premium");
    expect(container.textContent).toContain("nothing was read from this; the draft is unchanged");
    expect(onStageProposal).not.toHaveBeenCalled();

    setCommand("add another bartender");
    clickByText("Preview");
    expect(container.textContent).toContain("Add 1 bartender");
    clickByText("Apply to draft");
    expect(onStageProposal).toHaveBeenCalledWith(expect.objectContaining({
      kind: "add_staff",
      field: "bartenders",
      count: 1
    }));
  });

  test("focuses the exact contextual draft on a global Pilot request without running anything", async () => {
    const onStageProposal = vi.fn();
    const onFocusRequestResolution = vi.fn();
    render({
      onStageProposal,
      contextLabel: "Autumn Benefit Dinner",
      focusRequest: { id: "global-pilot-1" },
      onFocusRequestResolution
    });

    await act(async () => {
      await new Promise((resolve) => setTimeout(resolve, 30));
    });

    const input = container.querySelector(".pilot-command-input");
    expect(document.activeElement).toBe(input);
    expect(container.textContent).toContain("Current draftAutumn Benefit Dinner");
    expect(container.textContent).toContain("Describe a change or ask for an explanation.");
    expect(container.querySelector(".pilot-command-preview")).toBeNull();
    expect(onStageProposal).not.toHaveBeenCalled();
    expect(onFocusRequestResolution).toHaveBeenCalledWith({
      requestId: "global-pilot-1",
      status: "focused",
      reason: ""
    });
  });

  test("holds the preview-confirm contract: commands preview with a priced delta before anything applies", () => {
    const onStageProposal = vi.fn();
    render({ onStageProposal });
    setCommand("add another bartender and switch to buffet");
    clickByText("Preview");
    expect(container.innerHTML).toContain("Add 1 bartender");
    expect(container.innerHTML).toContain("Service style → Buffet");
    expect(container.innerHTML).toContain("total (preview includes fee and tax changes)");
    expect(container.innerHTML).toContain("Nothing is saved yet");
    const actionLabels = [...container.querySelectorAll("button")]
      .map((button) => button.textContent.trim());
    expect(actionLabels).toContain("Refresh preview");
    expect(actionLabels).not.toContain("Preview");

    setCommand("add two bartenders");
    const changedActionLabels = [...container.querySelectorAll("button")]
      .map((button) => button.textContent.trim());
    expect(changedActionLabels).toContain("Preview");
    expect(changedActionLabels).not.toContain("Refresh preview");
    expect(onStageProposal).not.toHaveBeenCalled();
  });

  test("applies exactly the confirmed proposal and marks it applied", () => {
    const onStageProposal = vi.fn();
    render({ onStageProposal });
    setCommand("add another bartender");
    clickByText("Preview");
    clickByText("Apply to draft");
    expect(onStageProposal).toHaveBeenCalledTimes(1);
    expect(onStageProposal.mock.calls[0][0]).toMatchObject({ kind: "add_staff", field: "bartenders", count: 1 });
    expect(container.innerHTML).toContain("Applied to this draft.");
    expect(container.innerHTML).toContain("Applied to draft");
    expect(container.querySelector(".pilot-command-proposal")).toMatchObject({
      dataset: expect.objectContaining({
        pilotCommandClass: "draft_mutation",
        pilotCommandExecutable: "true"
      })
    });
  });

  test("stays honest about unreadable commands and hides voice without browser support", () => {
    render();
    setCommand("please make it magnificent");
    clickByText("Preview");
    expect(container.innerHTML).toContain("nothing was read from this; the draft is unchanged");
    expect(container.innerHTML).not.toContain(">Speak<");
  });

  test("holds to capture, releases to an automatic preview, and still requires explicit apply", () => {
    enableFakeSpeechRecognition();
    const onStageProposal = vi.fn();
    render({ onStageProposal, voiceCaptureMode: "hold" });

    const button = voiceButton();
    expect(button.textContent).toContain("Hold to speak");
    expect(container.textContent).toContain("Release to preview");

    act(() => button.dispatchEvent(pointerEvent("pointerdown")));
    expect(recognitionInstances).toHaveLength(1);
    expect(recognitionInstances[0].started).toBe(true);
    expect(container.querySelector(".pilot-command").dataset.pilotVoiceState).toBe("requesting");

    act(() => recognitionInstances[0].confirmStart());
    expect(button.textContent).toContain("Release to preview");
    expect(container.textContent).toContain("Listening while you hold");

    act(() => recognitionInstances[0].result("add another bartender"));
    act(() => button.dispatchEvent(pointerEvent("pointerup")));
    expect(recognitionInstances[0].stopped).toBe(true);
    expect(container.textContent).toContain("Preparing your preview");
    expect(onStageProposal).not.toHaveBeenCalled();

    act(() => recognitionInstances[0].end());
    expect(container.querySelector(".pilot-command-input").value).toBe("add another bartender");
    expect(container.textContent).toContain("Add 1 bartender");
    expect(container.textContent).toContain("Voice captured. Review before applying.");
    expect(onStageProposal).not.toHaveBeenCalled();

    clickByText("Apply to draft");
    expect(onStageProposal).toHaveBeenCalledTimes(1);
    expect(onStageProposal).toHaveBeenCalledWith(expect.objectContaining({
      kind: "add_staff",
      field: "bartenders",
      count: 1
    }));
  });

  test("supports keyboard hold and stops immediately when permission arrives after release", () => {
    enableFakeSpeechRecognition();
    render({ voiceCaptureMode: "hold" });
    const button = voiceButton();

    act(() => button.dispatchEvent(new KeyboardEvent("keydown", { key: " ", bubbles: true })));
    act(() => button.dispatchEvent(new KeyboardEvent("keyup", { key: " ", bubbles: true })));
    expect(recognitionInstances[0].stopped).toBe(false);
    expect(container.querySelector(".pilot-command").dataset.pilotVoiceState).toBe("preparing");

    act(() => recognitionInstances[0].confirmStart());
    expect(recognitionInstances[0].stopped).toBe(true);
    act(() => recognitionInstances[0].result("switch to buffet"));
    act(() => recognitionInstances[0].end());
    expect(container.textContent).toContain("Service style → Buffet");
  });

  test("waits for release when recognition ends naturally while the control is still held", () => {
    enableFakeSpeechRecognition();
    const onStageProposal = vi.fn();
    render({ voiceCaptureMode: "hold", onStageProposal });
    const button = voiceButton();

    act(() => button.dispatchEvent(pointerEvent("pointerdown")));
    act(() => recognitionInstances[0].confirmStart());
    act(() => recognitionInstances[0].result("add another bartender"));
    act(() => recognitionInstances[0].end());

    expect(container.querySelector(".pilot-command").dataset.pilotVoiceState)
      .toBe("captured_waiting_release");
    expect(container.textContent).toContain("Voice captured. Release to preview; nothing has changed.");
    expect(container.querySelector(".pilot-command-preview")).toBeNull();
    expect(container.querySelector(".pilot-command-input").value).toBe("");
    expect(onStageProposal).not.toHaveBeenCalled();

    act(() => button.dispatchEvent(pointerEvent("pointerup")));
    expect(container.querySelector(".pilot-command").dataset.pilotVoiceState).toBe("preview_ready");
    expect(container.textContent).toContain("Add 1 bartender");
    expect(onStageProposal).not.toHaveBeenCalled();
  });

  test("suppresses the synthesized click even after a long keyboard hold", () => {
    enableFakeSpeechRecognition();
    render({ voiceCaptureMode: "hold" });
    const button = voiceButton();

    act(() => button.dispatchEvent(new KeyboardEvent("keydown", { key: " ", bubbles: true })));
    act(() => recognitionInstances[0].confirmStart());
    act(() => recognitionInstances[0].result("add another bartender"));
    act(() => button.dispatchEvent(new KeyboardEvent("keyup", { key: " ", bubbles: true })));
    act(() => recognitionInstances[0].end());
    act(() => button.dispatchEvent(new MouseEvent("click", { bubbles: true, detail: 0 })));

    expect(recognitionInstances).toHaveLength(1);
    expect(container.querySelector(".pilot-command").dataset.pilotVoiceState).toBe("preview_ready");
  });

  test("cancels on pointer cancellation and leaves the prior command and preview unchanged", () => {
    enableFakeSpeechRecognition();
    const onStageProposal = vi.fn();
    render({ voiceCaptureMode: "hold", onStageProposal });
    setCommand("explain this price");
    clickByText("Preview");
    const existingPreview = container.querySelector(".pilot-command-query").textContent;
    const button = voiceButton();

    act(() => button.dispatchEvent(pointerEvent("pointerdown")));
    act(() => recognitionInstances[0].confirmStart());
    act(() => recognitionInstances[0].result("add another bartender"));
    act(() => button.dispatchEvent(pointerEvent("pointercancel")));

    expect(recognitionInstances[0].aborted).toBe(true);
    expect(container.querySelector(".pilot-command-input").value).toBe("explain this price");
    expect(container.querySelector(".pilot-command-query").textContent).toBe(existingPreview);
    expect(container.textContent).toContain("Voice capture canceled");
    expect(onStageProposal).not.toHaveBeenCalled();
  });

  test.each([
    ["not-allowed", "Microphone access is blocked"],
    ["service-not-allowed", "Speech input is unavailable here"],
    ["audio-capture", "No usable microphone was found"],
    ["network", "speech service could not be reached"],
    ["no-speech", "No words were captured"]
  ])("maps %s to contextual recovery without changing the draft", (errorName, recoveryText) => {
    enableFakeSpeechRecognition();
    const onStageProposal = vi.fn();
    render({ voiceCaptureMode: "hold", onStageProposal });
    setCommand("explain this price");
    const button = voiceButton();

    act(() => button.dispatchEvent(pointerEvent("pointerdown")));
    act(() => recognitionInstances[0].error(errorName));

    expect(container.querySelector(".pilot-command-input").value).toBe("explain this price");
    expect(container.textContent).toContain(recoveryText);
    expect(onStageProposal).not.toHaveBeenCalled();
  });

  test("aborts an active capture on unmount", () => {
    enableFakeSpeechRecognition();
    render({ voiceCaptureMode: "hold" });
    act(() => voiceButton().dispatchEvent(pointerEvent("pointerdown")));
    expect(recognitionInstances[0].aborted).toBe(false);

    act(() => root.unmount());
    expect(recognitionInstances[0].aborted).toBe(true);
    root = createRoot(container);
  });

  test("keeps the existing click-to-toggle voice behavior outside Ambient mode", () => {
    enableFakeSpeechRecognition();
    render({ voiceCaptureMode: "toggle" });
    const button = [...container.querySelectorAll("button")]
      .find((element) => element.textContent.trim() === "Speak");
    expect(button.textContent).toContain("Speak");
    act(() => button.dispatchEvent(new MouseEvent("click", { bubbles: true })));
    expect(recognitionInstances[0].started).toBe(true);
    expect(button.textContent).toContain("Listening");
    act(() => recognitionInstances[0].result("add another bartender"));
    act(() => recognitionInstances[0].end());
    expect(container.querySelector(".pilot-command-input").value).toBe("add another bartender");
    expect(container.querySelector(".pilot-command-preview")).toBeNull();
  });

  test("keeps hold-only presentation out of the flag-off toggle control", () => {
    enableFakeSpeechRecognition();
    render({ voiceCaptureMode: "toggle" });
    const button = voiceButton();
    expect(button).toBeNull();
    const legacyButton = [...container.querySelectorAll("button")]
      .find((element) => element.textContent.trim() === "Speak");
    expect(legacyButton).toBeTruthy();
    expect(legacyButton.classList.contains("pilot-command-voice")).toBe(false);
    expect(legacyButton.querySelector("svg")).toBeNull();
    expect(container.querySelector("#pilot-command-voice-status")).toBeNull();
  });

  test("answers deterministic price questions in place without staging anything", () => {
    const onStageProposal = vi.fn();
    render({ onStageProposal });
    setCommand("explain this price");
    clickByText("Preview");
    const answer = container.querySelector(".pilot-command-query");
    expect(answer).toBeTruthy();
    expect(answer.dataset).toMatchObject({
      pilotCommandClass: "query",
      pilotQueryKind: "price_explanation"
    });
    expect(answer.textContent).toContain("How this draft price is composed");
    expect(answer.textContent).toContain("What this affects");
    expect(answer.textContent).toContain("If you do nothing");
    expect(answer.textContent).toContain("server-authoritative repricing");
    expect(container.textContent).toContain("This answer changes no draft, saved quote, or customer state");
    expect(onStageProposal).not.toHaveBeenCalled();
  });

  test("previews and applies one exact package change as a draft mutation", () => {
    const onStageProposal = vi.fn();
    render({
      onStageProposal,
      catalog: {
        ...catalog,
        packages: [
          ...catalog.packages,
          { id: "premium", name: "Premium", ppp: 28 }
        ]
      }
    });
    setCommand("switch package to Premium");
    clickByText("Preview");
    expect(container.textContent).toContain("Package → Premium");
    expect(onStageProposal).not.toHaveBeenCalled();
    clickByText("Apply to draft");
    expect(onStageProposal).toHaveBeenCalledWith(expect.objectContaining({
      kind: "set_package",
      packageId: "premium",
      packageName: "Premium"
    }));
  });

  test("never shows a margin note while the margin pilot flag is off, even with recorded costs", () => {
    const costedSettings = { ...settings, bartenderCostRate: 22 };
    const costedCatalog = { ...catalog, packages: [{ id: "classic", name: "Classic", ppp: 20, costPpp: 8 }], settings: costedSettings };
    render({ catalog: costedCatalog, settings: costedSettings });
    setCommand("add another bartender");
    clickByText("Preview");
    expect(container.innerHTML).toContain("total (preview includes fee and tax changes)");
    expect(container.innerHTML).not.toContain("Margin");
  });

  test("fails an explicit bounded scenario closed when current exact-tenant evidence is not wired", () => {
    const onStageProposal = vi.fn();
    render({ onStageProposal });
    setCommand("get this under $4,500");
    clickByText("Preview");

    const scenario = container.querySelector(".pilot-command-scenario");
    expect(scenario).toBeTruthy();
    expect(scenario.dataset).toMatchObject({
      pilotCommandClass: "simulation",
      pilotScenarioState: "unavailable"
    });
    expect(scenario.textContent).toContain("Refresh this opportunity first");
    expect(scenario.textContent).toContain("active tenant scope is unavailable");
    expect(scenario.textContent).toContain("draft, saved quote, customer communication, and provider state remain unchanged");
    expect(container.textContent).not.toContain("not understood");
    expect(container.textContent).not.toContain("Adopt in draft review");
    expect(onStageProposal).not.toHaveBeenCalled();
  });

  test("renders every bounded compromise and hands the exact immutable proposal to draft review", () => {
    const onStageProposal = vi.fn();
    const onHandoffScenarioToDraftReview = vi.fn();
    const exactSettings = scenarioSettings();
    const exactEvidence = scenarioCatalogEvidence();
    render({
      form: scenarioForm(),
      catalog: {
        packages: exactEvidence.packages,
        addons: exactEvidence.addons,
        rentals: exactEvidence.rentals,
        settings: exactSettings
      },
      settings: exactSettings,
      scenarioOrganizationId,
      scenarioCatalogEvidence: exactEvidence,
      scenarioLockedScope: ["staffing"],
      onStageProposal,
      onHandoffScenarioToDraftReview
    });
    setCommand("get this under $4,500");
    clickByText("Preview");

    const scenario = container.querySelector('[data-pilot-scenario-state="available"]');
    expect(scenario).toBeTruthy();
    expect(scenario.textContent).toContain("Options found");
    expect(scenario.textContent).toContain("Current preview");
    expect(scenario.textContent).toContain("Scenario preview");
    expect(scenario.textContent).toContain("What changes in this option");
    expect(scenario.textContent).toContain("Classic → Focused");
    expect(scenario.textContent).toContain("Recorded event template → Custom draft");
    expect(scenario.textContent).toContain("Why this option");
    expect(scenario.textContent).toContain("If you do nothing");
    expect(scenario.textContent).toContain("Confidence: medium");
    expect(scenario.textContent).toContain("active_tenant_catalog | revision 21 | fresh");
    expect(scenario.textContent).not.toContain("Recorded-cost margin");
    expect(onStageProposal).not.toHaveBeenCalled();
    expect(onHandoffScenarioToDraftReview).not.toHaveBeenCalled();

    clickByText("Adopt in draft review");
    expect(onHandoffScenarioToDraftReview).toHaveBeenCalledTimes(1);
    const handedOff = onHandoffScenarioToDraftReview.mock.calls[0][0];
    expect(handedOff).toMatchObject({
      id: expect.stringMatching(/^pilot-bounded-scenario:under_budget:/),
      modelId: "pilot-bounded-scenarios-v1",
      kind: "simulation_proposal",
      commandClass: "simulation",
      authorityLevel: "draft",
      state: "available",
      patch: expect.any(Object),
      changedFields: expect.any(Array),
      lockedScope: ["staffing"],
      compromises: expect.any(Array),
      clientPreview: {
        before: expect.any(Object),
        after: expect.any(Object),
        delta: expect.any(Object)
      },
      marginEvidence: expect.any(Object),
      why: expect.any(String),
      consequence: expect.any(String),
      doNothing: expect.any(String),
      confidence: expect.any(Object),
      provenance: expect.any(Array),
      unavailableReasons: expect.any(Array),
      adoption: { required: true, outcomeLabel: "Adopt in draft review" },
      boundary: expect.any(String)
    });
    expect(Object.isFrozen(handedOff)).toBe(true);
    expect(Object.isFrozen(handedOff.patch)).toBe(true);
    expect(onStageProposal).not.toHaveBeenCalled();
    expect(container.textContent).toContain("Handed to draft review");
    expect(container.textContent).not.toContain("Applied scenario");
    expect(container.textContent).not.toContain("Staged scenario");
  });

  test("shows a satisfied budget state without inventing a compromise or adoption action", () => {
    const exactSettings = scenarioSettings();
    const exactEvidence = scenarioCatalogEvidence();
    render({
      form: scenarioForm({ addons: [] }),
      catalog: {
        packages: exactEvidence.packages,
        addons: exactEvidence.addons,
        rentals: exactEvidence.rentals,
        settings: exactSettings
      },
      settings: exactSettings,
      scenarioOrganizationId,
      scenarioCatalogEvidence: exactEvidence
    });
    setCommand("keep this under $6,000");
    clickByText("Preview");

    const scenario = container.querySelector('[data-pilot-scenario-state="satisfied"]');
    expect(scenario).toBeTruthy();
    expect(scenario.textContent).toContain("This draft already meets the goal");
    expect(scenario.textContent).toContain("already within the stated");
    expect(scenario.textContent).toContain("No compromise is recommended");
    expect(scenario.textContent).not.toContain("What changes in this option");
    expect(container.textContent).not.toContain("Adopt in draft review");
  });

  test("shows no match when all scenario dimensions are explicitly locked", () => {
    const exactSettings = scenarioSettings();
    const exactEvidence = scenarioCatalogEvidence();
    render({
      form: scenarioForm(),
      catalog: {
        packages: exactEvidence.packages,
        addons: exactEvidence.addons,
        rentals: exactEvidence.rentals,
        settings: exactSettings
      },
      settings: exactSettings,
      scenarioOrganizationId,
      scenarioCatalogEvidence: exactEvidence,
      scenarioLockedScope: ["package", "event_template", "addons", "rentals", "menu", "staffing"]
    });
    setCommand("get this under $4,500");
    clickByText("Preview");

    const scenario = container.querySelector('[data-pilot-scenario-state="no_match"]');
    expect(scenario).toBeTruthy();
    expect(scenario.textContent).toContain("No option fits safely");
    expect(scenario.textContent).toContain("declared locked scope");
    expect(scenario.textContent).toContain("If you do nothing");
    expect(container.textContent).not.toContain("Adopt in draft review");
  });

  test("keeps deterministic queries and draft mutations alongside an explicit scenario", () => {
    const onStageProposal = vi.fn();
    const exactSettings = scenarioSettings();
    const exactEvidence = scenarioCatalogEvidence();
    render({
      form: scenarioForm(),
      catalog: {
        packages: exactEvidence.packages,
        addons: exactEvidence.addons,
        rentals: exactEvidence.rentals,
        settings: exactSettings
      },
      settings: exactSettings,
      scenarioOrganizationId,
      scenarioCatalogEvidence: exactEvidence,
      onStageProposal
    });
    setCommand("get this under $4,500 and explain this price and add another bartender");
    clickByText("Preview");

    expect(container.querySelector('[data-pilot-command-class="simulation"]')).toBeTruthy();
    expect(container.querySelector('[data-pilot-command-class="query"]')).toBeTruthy();
    expect(container.querySelector('[data-pilot-command-class="draft_mutation"]')).toBeTruthy();
    expect(container.textContent).toContain("Nothing is saved yet");
    expect(container.textContent).toContain("cannot be opened for draft review here");
    expect(container.textContent).toContain("Nothing has changed");
    expect(onStageProposal).not.toHaveBeenCalled();

    clickByText("Apply to draft");
    expect(onStageProposal).toHaveBeenCalledWith(expect.objectContaining({
      kind: "add_staff",
      field: "bartenders",
      count: 1
    }));
  });

  test("keeps explicit margin scenarios unavailable while the margin presentation gate is off", () => {
    const exactSettings = scenarioSettings();
    const exactEvidence = scenarioCatalogEvidence();
    render({
      form: scenarioForm(),
      catalog: {
        packages: exactEvidence.packages,
        addons: exactEvidence.addons,
        rentals: exactEvidence.rentals,
        settings: exactSettings
      },
      settings: exactSettings,
      canViewStaffMargin: true,
      scenarioOrganizationId,
      scenarioCatalogEvidence: exactEvidence
    });
    setCommand("improve the margin");
    clickByText("Preview");

    const scenario = container.querySelector('[data-pilot-scenario-state="unavailable"]');
    expect(scenario).toBeTruthy();
    expect(scenario.textContent).toContain("presentation gate is disabled");
    expect(scenario.textContent).toContain("cannot recommend a margin change");
    expect(container.textContent).not.toContain("Adopt in draft review");
  });
});
