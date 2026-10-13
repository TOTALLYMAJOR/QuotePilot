// @vitest-environment jsdom
import React, { act, forwardRef, useImperativeHandle } from "react";
import { createRoot } from "react-dom/client";
import { afterEach, beforeEach, expect, test, vi } from "vitest";
import { useDisclosureRefreshAnchor } from "../useDisclosureRefreshAnchor";

globalThis.IS_REACT_ACT_ENVIRONMENT = true;

const Harness = forwardRef(function Harness(_props, ref) {
  const anchor = useDisclosureRefreshAnchor();
  useImperativeHandle(ref, () => anchor, [anchor]);
  return null;
});

let container;
let root;
let api;

beforeEach(() => {
  container = document.createElement("div");
  document.body.append(container);
  root = createRoot(container);
  vi.stubGlobal("requestAnimationFrame", (callback) => {
    callback();
    return 1;
  });
  vi.stubGlobal("cancelAnimationFrame", vi.fn());
  act(() => root.render(<Harness ref={(value) => { api = value; }} />));
});

afterEach(() => {
  act(() => root.unmount());
  container.remove();
  vi.unstubAllGlobals();
});

test("restores disclosure position within one pixel without stealing surviving focus", () => {
  const disclosure = document.createElement("details");
  disclosure.open = true;
  const summary = document.createElement("summary");
  const button = document.createElement("button");
  disclosure.append(summary, button);
  document.body.append(disclosure);
  let top = 120;
  disclosure.getBoundingClientRect = () => ({ top });
  const scrollBy = vi.fn();
  vi.stubGlobal("scrollBy", scrollBy);
  button.focus();

  act(() => api.capture("quote-one", disclosure));
  top = 168;
  act(() => api.restore("quote-one"));

  expect(scrollBy).toHaveBeenCalledWith({ top: 48, left: 0, behavior: "auto" });
  expect(document.activeElement).toBe(button);
  disclosure.remove();
});

test("falls back to the disclosure summary when refreshed content removes the active control", () => {
  const disclosure = document.createElement("details");
  disclosure.open = true;
  const summary = document.createElement("summary");
  summary.tabIndex = 0;
  const retry = document.createElement("button");
  disclosure.append(summary, retry);
  document.body.append(disclosure);
  disclosure.getBoundingClientRect = () => ({ top: 80 });
  retry.focus();

  act(() => api.capture("quote-one", disclosure));
  retry.remove();
  act(() => api.restore("quote-one"));

  expect(document.activeElement).toBe(summary);
  disclosure.remove();
});
