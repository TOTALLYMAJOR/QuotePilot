function text(value) {
  return typeof value === "string" ? value.trim() : "";
}

const WIZARD_DESTINATIONS = Object.freeze({
  '[data-ambient-action-id="pc-edit-client-name"]': Object.freeze({
    surfaceId: "quote-wizard", step: 1, selector: '[data-ambient-field="name"]', activate: false
  }),
  '[data-ambient-action-id="pc-edit-client-email"]': Object.freeze({
    surfaceId: "quote-wizard", step: 1, selector: '[data-ambient-field="email"]', activate: false
  }),
  '[data-ambient-action-id="pc-edit-event-name"]': Object.freeze({
    surfaceId: "quote-wizard", step: 1, selector: '[data-ambient-field="eventName"]', activate: false
  }),
  "#proposal-event-type": Object.freeze({
    surfaceId: "quote-wizard", step: 1, selector: '[data-choice-control="event-type"]', activate: false
  }),
  '[data-ambient-action-id="pc-edit-date"]': Object.freeze({
    surfaceId: "quote-wizard", step: 1, selector: '[data-ambient-field="date"]', activate: false
  }),
  '[data-ambient-action-id="pc-edit-time"]': Object.freeze({
    surfaceId: "quote-wizard", step: 1, selector: '[data-ambient-field="time"]', activate: false
  }),
  '[data-ambient-action-id="pc-edit-venue"]': Object.freeze({
    surfaceId: "quote-wizard", step: 1, selector: '[data-ambient-field="venue"]', activate: false
  }),
  '[data-ambient-action-id="pc-edit-guests"]': Object.freeze({
    surfaceId: "quote-wizard", step: 1, selector: '[aria-label="Guests (max 400)"]', activate: false
  }),
  '[data-ambient-action-id="pc-edit-hours"]': Object.freeze({
    surfaceId: "quote-wizard", step: 1, selector: '[data-ambient-field="hours"]', activate: false
  }),
  '[data-testid="pc-edit-experience"]': Object.freeze({
    surfaceId: "quote-wizard", step: 2, selector: '[data-ambient-field="pkg"]', activate: false
  }),
  '[data-testid="pc-edit-menu"]': Object.freeze({
    surfaceId: "quote-wizard",
    step: 3,
    selector: '[data-ambient-field="menuItems"]',
    focusSelector: '[data-ambient-field="menuItems"] input[type="search"]',
    activate: false
  })
});

export function resolveQuoteWizardCompletionDestination(destination) {
  const mapped = WIZARD_DESTINATIONS[text(destination?.selector)];
  return mapped ? { ...destination, ...mapped } : destination;
}

function resolveRoot(root) {
  const candidate = typeof root === "function" ? root() : root?.current || root;
  if (candidate && typeof candidate.querySelector === "function") return candidate;
  return typeof document !== "undefined" ? document : null;
}

function query(root, selector) {
  if (!root || !selector) return null;
  try {
    return root.querySelector(selector);
  } catch {
    return null;
  }
}

function frameScheduler(requestFrame) {
  if (typeof requestFrame === "function") return requestFrame;
  if (typeof window !== "undefined" && typeof window.requestAnimationFrame === "function") {
    return window.requestAnimationFrame.bind(window);
  }
  return (callback) => setTimeout(callback, 0);
}

export function scheduleQuoteCompletionDestinationFocus(destination, {
  root = null,
  setStep = null,
  requestFrame = null
} = {}) {
  const selector = text(destination?.selector);
  const focusSelector = text(destination?.focusSelector);
  const step = Number(destination?.step);
  const boundedStep = Number.isInteger(step) && step >= 1 && step <= 5 ? step : null;
  if (boundedStep !== null && typeof setStep === "function") setStep(boundedStep);

  if (!selector && !focusSelector) {
    return Object.freeze({ scheduled: false, step: boundedStep });
  }

  const schedule = frameScheduler(requestFrame);
  schedule(() => {
    const firstRoot = resolveRoot(root);
    const activationTarget = query(firstRoot, selector);
    if (destination?.activate === true && activationTarget && !activationTarget.disabled) {
      activationTarget.click?.();
    }
    schedule(() => {
      const finalRoot = resolveRoot(root);
      const focusTarget = query(finalRoot, focusSelector) || query(finalRoot, selector);
      if (!focusTarget) return;
      if (!focusTarget.matches?.("button, input, select, textarea, a[href], [tabindex]")) {
        focusTarget.setAttribute?.("tabindex", "-1");
      }
      focusTarget.scrollIntoView?.({ behavior: "smooth", block: "center" });
      focusTarget.focus?.({ preventScroll: true });
    });
  });

  return Object.freeze({ scheduled: true, step: boundedStep });
}
