// @vitest-environment jsdom

import { readFileSync } from "node:fs";
import { afterEach, beforeEach, describe, expect, test, vi } from "vitest";

const playCueMock = vi.hoisted(() => vi.fn(() => true));

vi.mock("../soundKit", () => ({
  playCue: playCueMock
}));

import {
  AMBIENT_CHROMATIC_TOKENS,
  AMBIENT_FEEDBACK_DEFINITIONS,
  ambientFeedbackClassName,
  ambientFeedbackStyle,
  createAmbientFeedbackEvent,
  getAmbientFeedbackAnnouncement,
  routeAmbientFeedback
} from "../ambient";

function relativeLuminance(hex) {
  const channels = hex.slice(1).match(/../g).map((part) => Number.parseInt(part, 16) / 255);
  const [red, green, blue] = channels.map((channel) => (
    channel <= 0.04045 ? channel / 12.92 : ((channel + 0.055) / 1.055) ** 2.4
  ));
  return (0.2126 * red) + (0.7152 * green) + (0.0722 * blue);
}

function contrastRatio(first, second) {
  const firstLuminance = relativeLuminance(first);
  const secondLuminance = relativeLuminance(second);
  return (Math.max(firstLuminance, secondLuminance) + 0.05)
    / (Math.min(firstLuminance, secondLuminance) + 0.05);
}

describe("Ambient feedback semantics", () => {
  beforeEach(() => {
    playCueMock.mockClear();
    window.matchMedia = vi.fn(() => ({ matches: false }));
  });

  afterEach(() => {
    document.body.innerHTML = "";
    vi.restoreAllMocks();
  });

  test("maps calculating, recalculated, resolved, failed, and customer events to behavior", () => {
    expect(createAmbientFeedbackEvent("ready").color).toBe("gold");
    expect(createAmbientFeedbackEvent("add").color).toBe("blue");
    expect(createAmbientFeedbackEvent("sent").color).toBe("blue");

    const calculating = createAmbientFeedbackEvent("calculating", { id: "reprice-pending" });
    expect(calculating).toMatchObject({
      color: "teal",
      phase: "calculating",
      motion: "reasoning"
    });
    expect(ambientFeedbackClassName(calculating)).toContain("ambient-feedback-event--motion-reasoning");

    const recalculated = createAmbientFeedbackEvent("recalculated", { id: "reprice-1" });
    expect(recalculated.color).toBe("teal");
    expect(recalculated.motion).toBe("recalculated");
    expect(ambientFeedbackClassName(recalculated)).toContain("ambient-feedback-event--teal");
    expect(recalculated).toMatchObject({
      intensity: "standard",
      allowedRepresentations: {
        visual: true,
        announcement: true,
        sound: true,
        haptic: true
      }
    });

    const resolved = createAmbientFeedbackEvent("resolve");
    expect(resolved).toMatchObject({ color: "mint", phase: "resolved", motion: "resolve" });

    const failed = createAmbientFeedbackEvent("failure");
    expect(failed).toMatchObject({ color: "failure", phase: "failed", motion: "failure" });
    expect(ambientFeedbackClassName(failed)).toContain("ambient-feedback-event--failure");

    const customerAccepted = createAmbientFeedbackEvent("accepted", {
      origin: "customer",
      objectId: "quote-17"
    });
    expect(customerAccepted.color).toBe("lavender");
    expect(customerAccepted.origin).toBe("customer");
    expect(customerAccepted.causalText).toContain("Customer update.");
    expect(ambientFeedbackClassName(customerAccepted)).toContain("ambient-feedback-event--origin-customer");

    const customerActivity = createAmbientFeedbackEvent("customer_activity");
    expect(customerActivity).toMatchObject({
      color: "lavender",
      origin: "customer",
      phase: "customer-activity",
      motion: "customer"
    });
    expect(ambientFeedbackClassName(customerActivity)).toContain("ambient-feedback-event--motion-customer");
  });

  test("meets WCAG AA text contrast and non-text contrast for every chromatic token", () => {
    expect(Object.keys(AMBIENT_CHROMATIC_TOKENS)).toEqual([
      "gold",
      "teal",
      "coral",
      "mint",
      "lavender",
      "blue",
      "failure"
    ]);

    Object.entries(AMBIENT_CHROMATIC_TOKENS).forEach(([name, token]) => {
      expect(contrastRatio(token.onAccent, token.accent), `${name} on accent`).toBeGreaterThanOrEqual(4.5);
      expect(contrastRatio(token.onSurface, token.surface), `${name} on surface`).toBeGreaterThanOrEqual(4.5);
      expect(contrastRatio(token.accent, token.surface), `${name} indicator`).toBeGreaterThanOrEqual(3);
    });

    Object.values(AMBIENT_FEEDBACK_DEFINITIONS).forEach((definition) => {
      expect(AMBIENT_CHROMATIC_TOKENS[definition.color]).toBeDefined();
    });
  });

  test("routes one event through visual, sound, and opted-in haptic representations", () => {
    const target = new window.EventTarget();
    const element = document.createElement("div");
    const vibrate = vi.fn(() => true);
    let received;
    target.addEventListener("quotepilot:ambient-feedback", (event) => {
      received = event.detail;
    });

    const receipt = routeAmbientFeedback("recalculated", {
      target,
      element,
      haptics: true,
      vibrate
    });

    expect(receipt.visualApplied).toBe(true);
    expect(receipt.visualDispatched).toBe(true);
    expect(element.classList.contains("ambient-feedback-event--teal")).toBe(true);
    expect(element.classList.contains("ambient-feedback-event--active")).toBe(true);
    expect(element.classList.contains("ambient-feedback-event--motion-recalculated")).toBe(true);
    expect(element.dataset.ambientFeedbackPhase).toBe("changed");
    expect(element.style.getPropertyValue("--ambient-feedback-accent")).toBe("#0b706d");
    expect(ambientFeedbackStyle(receipt.event)["--ambient-feedback-duration"]).toBe("280ms");
    expect(received.type).toBe("recalculated");
    expect(playCueMock).toHaveBeenCalledWith("tick", "neutral");
    expect(vibrate).toHaveBeenCalledWith([8]);
    receipt.cancelVisual();
    expect(element.classList.contains("ambient-feedback-event--teal")).toBe(false);
    expect(element.style.getPropertyValue("--ambient-feedback-accent")).toBe("");
    expect(element.dataset.ambientFeedbackPhase).toBeUndefined();
  });

  test("keeps semantic motion active until its own animation completes", () => {
    const element = document.createElement("div");
    document.body.append(element);
    const receipt = routeAmbientFeedback("add", {
      target: new window.EventTarget(),
      element,
      sound: false
    });

    expect(element.classList.contains("ambient-feedback-event--active")).toBe(true);

    const unrelatedEnd = new window.Event("animationend", { bubbles: true });
    Object.defineProperty(unrelatedEnd, "animationName", { value: "ambient-next-action-replace" });
    element.dispatchEvent(unrelatedEnd);
    expect(element.classList.contains("ambient-feedback-event--active")).toBe(true);

    const semanticEnd = new window.Event("animationend", { bubbles: true });
    Object.defineProperty(semanticEnd, "animationName", { value: "ambient-feedback-settle" });
    element.dispatchEvent(semanticEnd);
    expect(element.classList.contains("ambient-feedback-event--active")).toBe(false);
    expect(element.dataset.ambientFeedbackPhase).toBeUndefined();

    receipt.cancelVisual();
  });

  test("carries bounded evidence and receipt context while representation policy can fail closed", () => {
    const event = createAmbientFeedbackEvent("warning", {
      evidence: { source: "workflow", itemId: "approval-17" },
      receipt: { kind: "context", surfaceId: "living-opportunity" },
      allowedRepresentations: { sound: false, haptic: false }
    });
    const playSound = vi.fn(() => true);
    const vibrate = vi.fn(() => true);
    const receipt = routeAmbientFeedback(event, {
      target: new window.EventTarget(),
      haptics: true,
      playSound,
      vibrate
    });

    expect(event).toMatchObject({
      intensity: "prominent",
      evidence: { source: "workflow", itemId: "approval-17" },
      receipt: { kind: "context", surfaceId: "living-opportunity" },
      allowedRepresentations: { visual: true, announcement: true, sound: false, haptic: false }
    });
    expect(receipt.soundPlayed).toBe(false);
    expect(receipt.hapticPlayed).toBe(false);
    expect(playSound).not.toHaveBeenCalled();
    expect(vibrate).not.toHaveBeenCalled();
  });

  test("keeps causal text and announcements when reduced motion removes animation", () => {
    window.matchMedia = vi.fn((query) => ({ matches: query === "(prefers-reduced-motion: reduce)" }));
    const element = document.createElement("div");
    const vibrate = vi.fn(() => true);
    const announce = vi.fn();
    const event = createAmbientFeedbackEvent("resolve", {
      causalText: "Staffing is healthy because the service ratio is restored."
    });
    const reducedReceipt = routeAmbientFeedback(event, {
      target: new window.EventTarget(),
      element,
      haptics: true,
      vibrate,
      announce
    });

    expect(reducedReceipt.event.reducedMotion).toBe(true);
    expect(reducedReceipt.event.motionEnabled).toBe(false);
    expect(reducedReceipt.event.causalText).toBe(
      "Staffing is healthy because the service ratio is restored."
    );
    expect(getAmbientFeedbackAnnouncement(reducedReceipt.event)).toBe(
      "Staffing is healthy because the service ratio is restored."
    );
    expect(announce).toHaveBeenCalledWith(
      "Staffing is healthy because the service ratio is restored.",
      reducedReceipt.event
    );
    expect(reducedReceipt.announced).toBe(true);
    expect(element.classList.contains("ambient-feedback-event--static")).toBe(true);
    expect(vibrate).not.toHaveBeenCalled();
    expect(playCueMock).toHaveBeenCalledWith("chime", "positive");
    reducedReceipt.cancelVisual();

    playCueMock.mockClear();
    const quietReceipt = routeAmbientFeedback("warning", {
      target: new window.EventTarget(),
      haptics: true,
      vibrate,
      preferences: { reducedSensory: true }
    });
    expect(quietReceipt.soundPlayed).toBe(false);
    expect(quietReceipt.hapticPlayed).toBe(false);
    expect(playCueMock).not.toHaveBeenCalled();
  });

  test("keeps calculating quiet while exposing a teal causal phase", () => {
    const vibrate = vi.fn(() => true);
    const receipt = routeAmbientFeedback("calculating", {
      target: new window.EventTarget(),
      haptics: true,
      vibrate
    });

    expect(receipt.event).toMatchObject({
      color: "teal",
      phase: "calculating",
      motion: "reasoning"
    });
    expect(receipt.event).toMatchObject({
      label: "Checking changes",
      causalText: "QuotePilot is checking what would change in the current scenario."
    });
    expect(playCueMock).not.toHaveBeenCalled();
    expect(vibrate).not.toHaveBeenCalled();
  });

  test("keeps CSS chromatic values synchronized and provides a static reduced-motion state", () => {
    const css = readFileSync("src/components/ambient/ambient.css", "utf8");
    Object.entries(AMBIENT_CHROMATIC_TOKENS).forEach(([name, token]) => {
      expect(css).toContain(`.ambient-feedback-event--${name}`);
      Object.values(token).forEach((value) => expect(css).toContain(value));
    });
    expect(css).toContain("@media (prefers-reduced-motion: reduce)");
    expect(css).toContain(".ambient-feedback-event__cause");
    expect(css).toContain("@keyframes ambient-feedback-reasoning");
    expect(css).toContain("@keyframes ambient-feedback-customer-arrival");
    expect(css).toContain("@keyframes ambient-feedback-failure");
    expect(css).toContain("@keyframes ambient-context-enter-end");
    expect(css).toContain("@keyframes ambient-context-enter-mobile");
    expect(css).toContain("@keyframes ambient-dependent-settle");
    expect(css).toContain("@keyframes ambient-next-action-replace");
  });
});
