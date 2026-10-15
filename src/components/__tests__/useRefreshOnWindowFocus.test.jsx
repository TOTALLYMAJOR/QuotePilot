// @vitest-environment jsdom
import React from "react";
import { createRoot } from "react-dom/client";
import { act } from "react-dom/test-utils";
import { afterEach, beforeEach, expect, test, vi } from "vitest";
import { useRefreshOnWindowFocus } from "../useRefreshOnWindowFocus";

globalThis.IS_REACT_ACT_ENVIRONMENT = true;
let root;
let host;
function Probe(props) { useRefreshOnWindowFocus(props); return null; }
function render(props) { act(() => root.render(<Probe {...props} />)); }
function focus() { act(() => window.dispatchEvent(new Event("focus"))); }
beforeEach(() => {
  host = document.createElement("div");
  root = createRoot(host);
  vi.useFakeTimers();
  vi.setSystemTime(0);
  vi.spyOn(document, "visibilityState", "get").mockReturnValue("visible");
});
afterEach(() => { act(() => root.unmount()); vi.restoreAllMocks(); vi.useRealTimers(); });

test("refreshes only enabled visible views and deduplicates paired return events", () => {
  const onRefresh = vi.fn();
  render({ enabled: false, onRefresh });
  focus();
  expect(onRefresh).not.toHaveBeenCalled();
  render({ enabled: true, onRefresh });
  focus();
  act(() => document.dispatchEvent(new Event("visibilitychange")));
  expect(onRefresh).toHaveBeenCalledTimes(1);
  vi.advanceTimersByTime(601);
  vi.spyOn(document, "visibilityState", "get").mockReturnValue("hidden");
  focus();
  expect(onRefresh).toHaveBeenCalledTimes(1);
  vi.spyOn(document, "visibilityState", "get").mockReturnValue("visible");
  act(() => document.dispatchEvent(new Event("visibilitychange")));
  expect(onRefresh).toHaveBeenCalledTimes(2);
});

test("uses the latest callback, retains deduplication across rerenders, and cleans up", () => {
  const first = vi.fn();
  const latest = vi.fn();
  render({ enabled: true, onRefresh: first });
  focus();
  render({ enabled: true, onRefresh: latest });
  focus();
  expect(latest).not.toHaveBeenCalled();
  vi.advanceTimersByTime(601);
  focus();
  expect(first).toHaveBeenCalledTimes(1);
  expect(latest).toHaveBeenCalledTimes(1);
  render({ enabled: false, onRefresh: latest });
  vi.advanceTimersByTime(601);
  focus();
  expect(latest).toHaveBeenCalledTimes(1);
  act(() => root.render(null));
  focus();
  expect(latest).toHaveBeenCalledTimes(1);
});
