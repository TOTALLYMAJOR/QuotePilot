import { describe, expect, test } from "vitest";
import {
  AMBIENT_GESTURE_CONTRACT,
  beginAmbientGesture,
  gestureDirectionToReorderOffset,
  gestureDirectionToSelectionOutcome,
  resolveAmbientGesture
} from "../ambientGestureController";

describe("Ambient mobile gesture controller", () => {
  test("resolves horizontal selection gestures only after axis-dominant movement", () => {
    const start = beginAmbientGesture(
      { pointerId: 2, pointerType: "touch", clientX: 100, clientY: 100 },
      { axis: "horizontal", itemId: "addon-1" }
    );
    const result = resolveAmbientGesture(start, {
      pointerId: 2,
      clientX: 154,
      clientY: 104
    });
    expect(result).toMatchObject({ state: "resolved", direction: "right", itemId: "addon-1" });
    expect(gestureDirectionToSelectionOutcome(result.direction)).toBe("increase");
  });

  test("preserves page scrolling when the other axis dominates", () => {
    const start = beginAmbientGesture(
      { pointerId: 3, pointerType: "touch", clientX: 100, clientY: 100 },
      { axis: "horizontal" }
    );
    expect(resolveAmbientGesture(start, {
      pointerId: 3,
      clientX: 151,
      clientY: 180
    })).toMatchObject({ state: "ignored", direction: null });
  });

  test("maps vertical menu gestures to the same earlier and later offsets as visible buttons", () => {
    const start = beginAmbientGesture(
      { pointerId: 4, pointerType: "touch", clientX: 40, clientY: 150 },
      { axis: "vertical", itemId: "menu-2" }
    );
    const result = resolveAmbientGesture(start, {
      pointerId: 4,
      clientX: 42,
      clientY: 98
    });
    expect(result).toMatchObject({ state: "resolved", direction: "up", interaction: "gesture" });
    expect(gestureDirectionToReorderOffset(result.direction)).toBe(-1);
    expect(gestureDirectionToReorderOffset("down")).toBe(1);
    expect(gestureDirectionToReorderOffset("left")).toBe(-1);
    expect(gestureDirectionToReorderOffset("right")).toBe(1);
  });

  test("requires visible and keyboard alternatives for every gesture", () => {
    expect(AMBIENT_GESTURE_CONTRACT).toMatchObject({
      visibleAlternativeRequired: true,
      keyboardAlternativeRequired: true
    });
    expect(Object.isFrozen(AMBIENT_GESTURE_CONTRACT)).toBe(true);
  });
});
