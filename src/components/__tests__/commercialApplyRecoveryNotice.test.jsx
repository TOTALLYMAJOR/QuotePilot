// @vitest-environment jsdom
import React, { act } from "react";
import { createRoot } from "react-dom/client";
import { afterEach, beforeEach, expect, test } from "vitest";
import * as notice from "../CommercialApplyRecoveryNotice";

globalThis.IS_REACT_ACT_ENVIRONMENT = true;
let container;
let root;
beforeEach(() => {
  container = document.createElement("div"); document.body.appendChild(container);
  root = createRoot(container);
});
afterEach(() => { act(() => root.unmount()); container.remove(); });
test("returns keyboard focus to the outcome action when the reconciliation control is replaced", () => {
  act(() => root.render(<notice.default pending={{}} onReconcile={() => {}} />));
  container.querySelector("button").focus();
  act(() => root.render(<notice.default outcome={{ outcomeReceipt: { state: "not_committed" } }} onRecover={() => {}} />));
  expect(document.activeElement).toBe(container.querySelector("button"));
});
test("does not steal focus from another surviving control on automatic recovery", () => {
  const external = document.createElement("button"); document.body.appendChild(external);
  act(() => root.render(<notice.default pending={{}} onReconcile={() => {}} />));
  external.focus();
  act(() => root.render(<notice.default outcome={{ outcomeReceipt: { state: "committed", appliedRevisionIsActive: false } }} />));
  expect(document.activeElement).toBe(external);
  expect(container.textContent).toMatch(/later revision.*active/i);
  external.remove();
});
test("focuses the result action when conditional success rendering removed the initiating control", () => {
  const initiating = document.createElement("button"); container.appendChild(initiating); initiating.focus(); initiating.remove();
  act(() => root.render(<notice.default outcome={{ outcomeReceipt: { state: "committed" } }} onOpenQuote={() => {}} />));
  expect(document.activeElement).toBe(container.querySelector("button"));
});
test("makes retained uncertain apply visible and offers exact reconciliation without an apply action", () => {
  expect(notice.default).toBeTypeOf("function");
  let reconciled = 0;
  act(() => root.render(<notice.default pending={{ applyRequestId: "original-apply" }} onReconcile={() => reconciled++} />));
  expect(container.querySelector('[role="status"]').textContent).toMatch(/prior apply|previous change/i);
  expect(container.textContent).toMatch(/before.*another|before.*new/i);
  const button = container.querySelector("button");
  expect(button.textContent).toMatch(/check.*outcome/i);
  act(() => button.click());
  expect(reconciled).toBe(1);
  act(() => root.render(<notice.default pending={{}} busy onReconcile={() => reconciled++} />));
  expect(container.querySelector("button").disabled).toBe(true);
  expect(container.querySelector('[aria-busy="true"]')).not.toBeNull();
});
test("shows failure, exact committed record path and not-committed recovery as separate outcomes", () => {
  expect(notice.default).toBeTypeOf("function");
  act(() => root.render(<notice.default error="Offline; original request retained." pending={{}} />));
  expect(container.querySelector('[role="alert"]').textContent).toContain("Offline");
  let opened = 0;
  act(() => root.render(<notice.default outcome={{ outcomeReceipt: { state: "committed", newRevisionId: "v0018" } }} onOpenQuote={() => opened++} />));
  expect(container.textContent).toMatch(/committed/i);
  act(() => container.querySelector("button").click());
  expect(opened).toBe(1);
  let recovered = 0;
  act(() => root.render(<notice.default outcome={{ outcomeReceipt: { state: "not_committed", sourceChanged: false } }} onRecover={() => recovered++} />));
  expect(container.textContent).toMatch(/did not commit/i);
  act(() => container.querySelector("button").click());
  expect(recovered).toBe(1);
});
