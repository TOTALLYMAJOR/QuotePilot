export const AMBIENT_GESTURE_CONTROLLER_MODEL = "ambient-gesture-controller-v1";

export const AMBIENT_GESTURE_CONTRACT = Object.freeze({
  pointerTypes: Object.freeze(["touch", "pen", "mouse"]),
  horizontalThresholdPx: 48,
  verticalThresholdPx: 42,
  axisDominanceRatio: 1.15,
  visibleAlternativeRequired: true,
  keyboardAlternativeRequired: true,
  cancellationEvents: Object.freeze(["pointercancel", "lostpointercapture", "blur"])
});

function finite(value) {
  const number = Number(value);
  return Number.isFinite(number) ? number : null;
}

export function beginAmbientGesture(event = {}, { axis = "horizontal", itemId = "" } = {}) {
  const x = finite(event.clientX);
  const y = finite(event.clientY);
  const pointerId = finite(event.pointerId);
  if (x === null || y === null || pointerId === null || !["horizontal", "vertical"].includes(axis)) return null;
  return Object.freeze({
    modelId: AMBIENT_GESTURE_CONTROLLER_MODEL,
    pointerId,
    pointerType: String(event.pointerType || "unknown").trim().toLowerCase() || "unknown",
    axis,
    itemId: String(itemId || "").trim(),
    x,
    y
  });
}

export function resolveAmbientGesture(start, event = {}, contract = AMBIENT_GESTURE_CONTRACT) {
  const x = finite(event.clientX);
  const y = finite(event.clientY);
  const pointerId = finite(event.pointerId);
  if (!start || x === null || y === null || pointerId === null || pointerId !== start.pointerId) {
    return Object.freeze({ state: "cancelled", direction: null, reason: "The pointer sequence did not match." });
  }
  const deltaX = x - start.x;
  const deltaY = y - start.y;
  const primary = start.axis === "horizontal" ? deltaX : deltaY;
  const secondary = start.axis === "horizontal" ? deltaY : deltaX;
  const threshold = start.axis === "horizontal"
    ? contract.horizontalThresholdPx
    : contract.verticalThresholdPx;
  if (Math.abs(primary) < threshold) {
    return Object.freeze({ state: "ignored", direction: null, reason: "The movement stayed below the gesture threshold." });
  }
  if (Math.abs(primary) < Math.abs(secondary) * contract.axisDominanceRatio) {
    return Object.freeze({ state: "ignored", direction: null, reason: "The movement belongs to page scrolling on the other axis." });
  }
  const direction = start.axis === "horizontal"
    ? primary > 0 ? "right" : "left"
    : primary > 0 ? "down" : "up";
  return Object.freeze({
    state: "resolved",
    direction,
    itemId: start.itemId,
    interaction: "gesture",
    deltaX,
    deltaY
  });
}

export function gestureDirectionToSelectionOutcome(direction) {
  if (direction === "right") return "increase";
  if (direction === "left") return "reduce";
  return null;
}

export function gestureDirectionToReorderOffset(direction) {
  if (direction === "up" || direction === "left") return -1;
  if (direction === "down" || direction === "right") return 1;
  return 0;
}
