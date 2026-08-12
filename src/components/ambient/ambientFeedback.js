import { playCue } from "../soundKit";
import "./ambient.css";

export const AMBIENT_FEEDBACK_TYPES = Object.freeze({
  ADD: "add",
  CALCULATING: "calculating",
  RESOLVE: "resolve",
  READY: "ready",
  SENT: "sent",
  ACCEPTED: "accepted",
  WARNING: "warning",
  FAILURE: "failure",
  RECALCULATED: "recalculated",
  CUSTOMER_ACTIVITY: "customer_activity"
});

export const AMBIENT_FEEDBACK_EVENT_NAME = "quotepilot:ambient-feedback";

export const AMBIENT_CHROMATIC_TOKENS = Object.freeze({
  gold: Object.freeze({
    accent: "#875c13",
    onAccent: "#ffffff",
    surface: "#fff7e5",
    onSurface: "#4a3307"
  }),
  teal: Object.freeze({
    accent: "#0b706d",
    onAccent: "#ffffff",
    surface: "#e8f7f5",
    onSurface: "#124b49"
  }),
  coral: Object.freeze({
    accent: "#a94438",
    onAccent: "#ffffff",
    surface: "#fff0ed",
    onSurface: "#702b24"
  }),
  mint: Object.freeze({
    accent: "#27745b",
    onAccent: "#ffffff",
    surface: "#eaf7f1",
    onSurface: "#174d3d"
  }),
  lavender: Object.freeze({
    accent: "#6f5198",
    onAccent: "#ffffff",
    surface: "#f5effc",
    onSurface: "#493267"
  }),
  blue: Object.freeze({
    accent: "#32638e",
    onAccent: "#ffffff",
    surface: "#eef5fb",
    onSurface: "#243f5a"
  }),
  failure: Object.freeze({
    accent: "#9c2f3b",
    onAccent: "#ffffff",
    surface: "#fff0f2",
    onSurface: "#681d28"
  })
});

export const AMBIENT_FEEDBACK_DEFINITIONS = Object.freeze({
  add: Object.freeze({
    color: "blue",
    phase: "changed",
    label: "Added",
    causalText: "The item was added to the current scenario.",
    cue: "tick",
    soundTone: "neutral",
    motion: "settle",
    vibration: Object.freeze([10]),
    durationMs: 240
  }),
  calculating: Object.freeze({
    color: "teal",
    phase: "calculating",
    label: "Checking changes",
    causalText: "QuotePilot is checking what would change in the current scenario.",
    cue: null,
    soundTone: "neutral",
    motion: "reasoning",
    vibration: Object.freeze([]),
    durationMs: 720
  }),
  recalculated: Object.freeze({
    color: "teal",
    phase: "changed",
    label: "Preview updated",
    causalText: "The preview now reflects the current scenario.",
    cue: "tick",
    soundTone: "neutral",
    motion: "recalculated",
    vibration: Object.freeze([8]),
    durationMs: 280
  }),
  resolve: Object.freeze({
    color: "mint",
    phase: "resolved",
    label: "Resolved",
    causalText: "This is resolved. Review what changed.",
    cue: "chime",
    soundTone: "positive",
    motion: "resolve",
    vibration: Object.freeze([12, 24, 12]),
    durationMs: 280
  }),
  ready: Object.freeze({
    color: "gold",
    phase: "ready",
    label: "Ready",
    causalText: "The next step is ready to review.",
    cue: "chime",
    soundTone: "positive",
    motion: "ready",
    vibration: Object.freeze([10, 18, 10]),
    durationMs: 240
  }),
  sent: Object.freeze({
    color: "blue",
    phase: "sent",
    label: "Sent",
    causalText: "The requested item was sent. Its receipt shows the exact status.",
    cue: "tick",
    soundTone: "neutral",
    motion: "sent",
    vibration: Object.freeze([10]),
    durationMs: 220
  }),
  accepted: Object.freeze({
    color: "mint",
    phase: "accepted",
    label: "Accepted",
    causalText: "Acceptance is recorded with the available details.",
    cue: "seal",
    soundTone: "positive",
    motion: "accepted",
    vibration: Object.freeze([16, 28, 16]),
    durationMs: 280
  }),
  warning: Object.freeze({
    color: "coral",
    phase: "warning",
    label: "Needs attention",
    causalText: "This needs attention before the work can safely continue.",
    cue: "chime",
    soundTone: "negative",
    motion: "warning",
    vibration: Object.freeze([24, 30, 24]),
    durationMs: 280
  }),
  failure: Object.freeze({
    color: "failure",
    phase: "failed",
    label: "Couldn’t complete action",
    causalText: "QuotePilot could not complete this action. Review the reason and the next safe step.",
    cue: "chime",
    soundTone: "negative",
    motion: "failure",
    vibration: Object.freeze([28, 40, 28]),
    durationMs: 320
  }),
  customer_activity: Object.freeze({
    color: "lavender",
    phase: "customer-activity",
    label: "Customer update",
    causalText: "A new customer update is available in this context.",
    cue: "tick",
    soundTone: "neutral",
    motion: "customer",
    vibration: Object.freeze([10, 16, 10]),
    durationMs: 260
  })
});

let feedbackSequence = 0;
const visualTimers = new WeakMap();

function frozenRecord(value) {
  if (!value || typeof value !== "object" || Array.isArray(value)) return null;
  return Object.freeze({ ...value });
}

function feedbackIntensity(type) {
  if (["warning", "failure", "accepted"].includes(type)) return "prominent";
  if (type === "calculating") return "subtle";
  return "standard";
}

function normalizedType(type) {
  const value = String(type || "").trim().toLowerCase();
  if (!AMBIENT_FEEDBACK_DEFINITIONS[value]) {
    throw new TypeError(`Unknown ambient feedback type: ${value || "empty"}`);
  }
  return value;
}

function normalizedOrigin(origin) {
  const value = String(origin || "system").trim().toLowerCase();
  return value === "customer" ? "customer" : "system";
}

export function prefersReducedAmbientMotion() {
  if (typeof window === "undefined" || typeof window.matchMedia !== "function") return false;
  try {
    return window.matchMedia("(prefers-reduced-motion: reduce)").matches;
  } catch {
    return false;
  }
}

export function getAmbientFeedbackDefinition(type, origin = "system") {
  const base = AMBIENT_FEEDBACK_DEFINITIONS[normalizedType(type)];
  if (normalizedOrigin(origin) !== "customer") return base;
  return Object.freeze({ ...base, color: "lavender" });
}

export function getAmbientChromaticToken(color) {
  const key = String(color || "").trim().toLowerCase();
  const token = AMBIENT_CHROMATIC_TOKENS[key];
  if (!token) throw new TypeError(`Unknown ambient chromatic token: ${key || "empty"}`);
  return token;
}

export function createAmbientFeedbackEvent(type, options = {}) {
  const resolvedType = normalizedType(type);
  const origin = resolvedType === AMBIENT_FEEDBACK_TYPES.CUSTOMER_ACTIVITY
    ? "customer"
    : normalizedOrigin(options.origin);
  const definition = getAmbientFeedbackDefinition(resolvedType, origin);
  feedbackSequence += 1;
  const occurredAt = Number.isFinite(Number(options.occurredAt))
    ? Number(options.occurredAt)
    : Date.now();
  const explicitCausalText = typeof options.causalText === "string"
    ? options.causalText.trim()
    : typeof options.message === "string"
      ? options.message.trim()
      : "";
  const causalText = explicitCausalText || (origin === "customer"
    ? `Customer update. ${definition.causalText}`
    : definition.causalText);
  const allowedRepresentations = Object.freeze({
    visual: options.allowedRepresentations?.visual !== false,
    announcement: options.allowedRepresentations?.announcement !== false,
    sound: Boolean(definition.cue) && options.allowedRepresentations?.sound !== false,
    haptic: definition.vibration.length > 0 && options.allowedRepresentations?.haptic !== false
  });

  return Object.freeze({
    id: String(options.id || `ambient-feedback-${occurredAt}-${feedbackSequence}`),
    type: resolvedType,
    origin,
    phase: definition.phase,
    label: typeof options.label === "string" && options.label.trim()
      ? options.label.trim()
      : definition.label,
    message: typeof options.message === "string" ? options.message.trim() : "",
    causalText,
    intensity: ["subtle", "standard", "prominent"].includes(options.intensity)
      ? options.intensity
      : feedbackIntensity(resolvedType),
    evidence: frozenRecord(options.evidence),
    receipt: frozenRecord(options.receipt),
    allowedRepresentations,
    objectId: typeof options.objectId === "string" ? options.objectId : "",
    color: definition.color,
    motion: definition.motion,
    cue: definition.cue,
    soundTone: definition.soundTone,
    vibration: Object.freeze([...definition.vibration]),
    durationMs: definition.durationMs,
    occurredAt
  });
}

function resolvedEvent(eventOrType) {
  if (typeof eventOrType === "string") return createAmbientFeedbackEvent(eventOrType);
  if (!eventOrType || typeof eventOrType !== "object") {
    throw new TypeError("Ambient feedback requires an event type or event object.");
  }
  return createAmbientFeedbackEvent(eventOrType.type, eventOrType);
}

function classNameForEvent(event, motion) {
  return [
    "ambient-feedback-event",
    `ambient-feedback-event--${event.type}`,
    `ambient-feedback-event--${event.color}`,
    `ambient-feedback-event--phase-${event.phase}`,
    `ambient-feedback-event--motion-${event.motion}`,
    `ambient-feedback-event--origin-${event.origin}`,
    motion ? "ambient-feedback-event--active" : "ambient-feedback-event--static"
  ].join(" ");
}

function styleForEvent(event, durationMs = event.durationMs) {
  const token = getAmbientChromaticToken(event.color);
  return Object.freeze({
    "--ambient-feedback-accent": token.accent,
    "--ambient-feedback-on-accent": token.onAccent,
    "--ambient-feedback-surface": token.surface,
    "--ambient-feedback-on-surface": token.onSurface,
    "--ambient-feedback-duration": `${durationMs}ms`
  });
}

function feedbackAnimationNames(event) {
  const motionName = event.motion === "accepted" ? "resolve" : event.motion;
  const names = new Set([`ambient-feedback-${motionName}`]);
  if (event.origin === "customer") names.add("ambient-feedback-customer-arrival");
  if (event.motion === "customer") names.add("ambient-feedback-customer-surface");
  return names;
}

export function ambientFeedbackClassName(eventOrType, { motion = true } = {}) {
  const event = resolvedEvent(eventOrType);
  return classNameForEvent(event, motion);
}

export function ambientFeedbackStyle(eventOrType, { durationMs } = {}) {
  const event = resolvedEvent(eventOrType);
  const resolvedDuration = Number.isFinite(Number(durationMs))
    ? Math.max(0, Math.min(5000, Number(durationMs)))
    : event.durationMs;
  return styleForEvent(event, resolvedDuration);
}

export function getAmbientFeedbackAnnouncement(eventOrType) {
  return resolvedEvent(eventOrType).causalText;
}

export function applyAmbientFeedbackEvent(element, eventOrType, { motion = true, durationMs } = {}) {
  if (!element?.classList) return { applied: false, cancel: () => {} };
  const event = resolvedEvent(eventOrType);
  const prior = visualTimers.get(element);
  prior?.cancel();
  const resolvedDuration = Number.isFinite(Number(durationMs))
    ? Math.max(0, Math.min(5000, Number(durationMs)))
    : event.durationMs;
  const classes = classNameForEvent(event, motion).split(" ");
  const addedClasses = classes.filter((className) => !element.classList.contains(className));
  const styles = styleForEvent(event, resolvedDuration);
  const priorStyles = Object.fromEntries(Object.keys(styles).map((property) => [
    property,
    element.style.getPropertyValue(property)
  ]));
  const priorDataset = {
    type: element.dataset.ambientFeedbackType,
    color: element.dataset.ambientFeedbackColor,
    phase: element.dataset.ambientFeedbackPhase,
    origin: element.dataset.ambientFeedbackOrigin
  };

  addedClasses.forEach((className) => element.classList.add(className));
  Object.entries(styles).forEach(([property, value]) => element.style.setProperty(property, value));
  element.dataset.ambientFeedbackType = event.type;
  element.dataset.ambientFeedbackColor = event.color;
  element.dataset.ambientFeedbackPhase = event.phase;
  element.dataset.ambientFeedbackOrigin = event.origin;

  let timer;
  let fallbackFrame;
  let cancelled = false;
  const expectedAnimationNames = feedbackAnimationNames(event);
  const handleAnimationEnd = (animationEvent) => {
    if (animationEvent.target !== element) return;
    if (!expectedAnimationNames.has(animationEvent.animationName)) return;
    cancel();
  };
  const cancel = () => {
    if (cancelled) return;
    cancelled = true;
    if (timer !== undefined) clearTimeout(timer);
    if (fallbackFrame !== undefined && typeof cancelAnimationFrame === "function") {
      cancelAnimationFrame(fallbackFrame);
    }
    element.removeEventListener?.("animationend", handleAnimationEnd);
    addedClasses.forEach((className) => element.classList.remove(className));
    Object.entries(priorStyles).forEach(([property, value]) => {
      if (value) element.style.setProperty(property, value);
      else element.style.removeProperty(property);
    });
    Object.entries(priorDataset).forEach(([key, value]) => {
      const datasetKey = `ambientFeedback${key[0].toUpperCase()}${key.slice(1)}`;
      if (value === undefined) delete element.dataset[datasetKey];
      else element.dataset[datasetKey] = value;
    });
    if (visualTimers.get(element)?.cancel === cancel) visualTimers.delete(element);
  };

  if (motion) {
    // Let the browser's semantic animation lifecycle end the visual. Starting
    // the safety timer after the first paint prevents a busy main thread from
    // consuming the whole feedback window before the user can see it.
    element.addEventListener?.("animationend", handleAnimationEnd);
    const scheduleFallback = () => {
      timer = setTimeout(cancel, resolvedDuration + 1_000);
    };
    if (typeof requestAnimationFrame === "function") {
      fallbackFrame = requestAnimationFrame(scheduleFallback);
    } else {
      scheduleFallback();
    }
  } else {
    timer = setTimeout(cancel, resolvedDuration);
  }
  visualTimers.set(element, { cancel });
  return { applied: true, cancel };
}

export function routeAmbientFeedback(eventOrType, options = {}) {
  const event = resolvedEvent(eventOrType);
  const preferences = options.preferences || {};
  const reducedMotion = prefersReducedAmbientMotion();
  const reducedSensory = preferences.reducedSensory === true;
  const motionEnabled = (options.motion ?? preferences.motion ?? true) && !reducedMotion && !reducedSensory;
  const visualEnabled = event.allowedRepresentations.visual && options.visual !== false;
  const announcementEnabled = event.allowedRepresentations.announcement && options.announcement !== false;
  const soundEnabled = event.allowedRepresentations.sound
    && (options.sound ?? preferences.sound ?? true)
    && !reducedSensory;
  const hapticsEnabled = event.allowedRepresentations.haptic
    && (options.haptics ?? preferences.haptics ?? false)
    && !reducedMotion
    && !reducedSensory;
  const target = options.target ?? (typeof window !== "undefined" ? window : null);
  const element = options.element || null;

  const presentation = Object.freeze({
    ...event,
    motionEnabled,
    reducedMotion
  });

  let announced = false;
  if (announcementEnabled && typeof options.announce === "function") {
    try {
      options.announce(presentation.causalText, presentation);
      announced = true;
    } catch {
      announced = false;
    }
  }

  const visual = !visualEnabled
    ? { applied: false, cancel: () => {} }
    : applyAmbientFeedbackEvent(element, presentation, {
      motion: motionEnabled,
      durationMs: options.durationMs
    });

  let visualDispatched = false;
  if (visualEnabled && target?.dispatchEvent && typeof CustomEvent === "function") {
    target.dispatchEvent(new CustomEvent(AMBIENT_FEEDBACK_EVENT_NAME, {
      detail: presentation,
      bubbles: true,
      composed: true
    }));
    visualDispatched = true;
  }

  let soundPlayed = false;
  if (soundEnabled && event.cue) {
    const soundRouter = typeof options.playSound === "function" ? options.playSound : playCue;
    try {
      soundPlayed = soundRouter(event.cue, event.soundTone) === true;
    } catch {
      soundPlayed = false;
    }
  }

  let hapticPlayed = false;
  if (hapticsEnabled && event.vibration.length) {
    const vibrationRouter = typeof options.vibrate === "function"
      ? options.vibrate
      : (typeof navigator !== "undefined" && typeof navigator.vibrate === "function"
        ? (pattern) => navigator.vibrate(pattern)
        : null);
    if (vibrationRouter) {
      try {
        hapticPlayed = vibrationRouter([...event.vibration]) !== false;
      } catch {
        hapticPlayed = false;
      }
    }
  }

  return Object.freeze({
    event: presentation,
    visualApplied: visual.applied,
    visualDispatched,
    announced,
    soundPlayed,
    hapticPlayed,
    cancelVisual: visual.cancel
  });
}
