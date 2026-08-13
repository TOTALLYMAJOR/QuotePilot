// @vitest-environment jsdom

import React, { act, useState } from "react";
import { createRoot } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, test } from "vitest";
import { useWorkspaceRouteHeadingFocus } from "../useWorkspaceRouteHeadingFocus";

globalThis.IS_REACT_ACT_ENVIRONMENT = true;

function DelayedRoute({ enabled = true, onReady }) {
  const [ready, setReady] = useState(false);
  const headingRef = useWorkspaceRouteHeadingFocus(enabled);

  onReady.current = setReady;

  return ready
    ? <h1 ref={headingRef} tabIndex={-1}>Clients</h1>
    : <p role="status">Loading Clients</p>;
}

describe("useWorkspaceRouteHeadingFocus", () => {
  let container;
  let root;
  let frames;
  let nextFrameId;
  let originalRequestAnimationFrame;
  let originalCancelAnimationFrame;

  const flushFrames = () => {
    const pending = [...frames.values()];
    frames.clear();
    pending.forEach((callback) => callback(Date.now()));
  };

  beforeEach(() => {
    container = document.createElement("div");
    document.body.appendChild(container);
    root = createRoot(container);
    frames = new Map();
    nextFrameId = 0;
    originalRequestAnimationFrame = window.requestAnimationFrame;
    originalCancelAnimationFrame = window.cancelAnimationFrame;
    window.requestAnimationFrame = (callback) => {
      nextFrameId += 1;
      frames.set(nextFrameId, callback);
      return nextFrameId;
    };
    window.cancelAnimationFrame = (frameId) => frames.delete(frameId);
  });

  afterEach(() => {
    act(() => root.unmount());
    container.remove();
    window.requestAnimationFrame = originalRequestAnimationFrame;
    window.cancelAnimationFrame = originalCancelAnimationFrame;
  });

  test("focuses a route heading that mounts after the first focus frame", () => {
    const routeTrigger = document.createElement("button");
    document.body.appendChild(routeTrigger);
    routeTrigger.focus();
    const onReady = { current: null };

    act(() => root.render(<DelayedRoute onReady={onReady} />));
    act(flushFrames);
    expect(document.activeElement).toBe(routeTrigger);

    act(() => onReady.current(true));
    act(flushFrames);

    expect(document.activeElement).toBe(container.querySelector("h1"));
    routeTrigger.remove();
  });

  test("does not steal focus when the user chooses another control during lazy loading", () => {
    const routeTrigger = document.createElement("button");
    const userTarget = document.createElement("input");
    document.body.append(routeTrigger, userTarget);
    routeTrigger.focus();
    const onReady = { current: null };

    act(() => root.render(<DelayedRoute onReady={onReady} />));
    act(flushFrames);
    userTarget.focus();
    userTarget.remove();
    expect(document.activeElement).toBe(document.body);

    act(() => onReady.current(true));
    act(flushFrames);

    expect(document.activeElement).toBe(document.body);
    routeTrigger.remove();
  });

  test("leaves focus unchanged when route-heading focus is disabled", () => {
    const routeTrigger = document.createElement("button");
    document.body.appendChild(routeTrigger);
    routeTrigger.focus();
    const onReady = { current: null };

    act(() => root.render(<DelayedRoute enabled={false} onReady={onReady} />));
    act(() => onReady.current(true));
    act(flushFrames);

    expect(document.activeElement).toBe(routeTrigger);
    routeTrigger.remove();
  });
});
