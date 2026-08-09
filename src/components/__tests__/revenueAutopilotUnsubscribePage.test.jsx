// @vitest-environment jsdom
import React, { act } from "react";
import { createRoot } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, test, vi } from "vitest";

const client = vi.hoisted(() => ({
  getContext: vi.fn(),
  isDefinitive: vi.fn(),
  readPending: vi.fn(),
  reset: vi.fn(),
  unsubscribe: vi.fn()
}));

vi.mock("../../lib/revenueAutopilotClient", () => ({
  getRevenueAutopilotUnsubscribeContext: client.getContext,
  isDefinitiveRevenueAutopilotError: client.isDefinitive,
  readPendingRevenueAutopilotUnsubscribeAttempt: client.readPending,
  resetDefinitiveRevenueAutopilotUnsubscribeAttempt: client.reset,
  unsubscribeRevenueAutopilotEmail: client.unsubscribe
}));

import RevenueAutopilotUnsubscribePage from "../RevenueAutopilotUnsubscribePage";

globalThis.IS_REACT_ACT_ENVIRONMENT = true;

const TOKEN = "unsubscribe_token_cccccccccccccccccccccccccccc";
const REQUEST_ID = `ra_request_${"e".repeat(32)}`;

function context(overrides = {}) {
  return {
    organizationName: "Example Catering",
    recipientLabel: "Customer email on file",
    subscriptionState: "subscribed",
    ...overrides
  };
}

function pending(overrides = {}) {
  return {
    operation: "unsubscribe_email",
    token: TOKEN,
    requestId: REQUEST_ID,
    definitive: false,
    ...overrides
  };
}

function result() {
  return {
    ok: true,
    storage: "firebase",
    mutationMode: "submitting",
    receipt: {
      operation: "unsubscribe_email",
      requestId: REQUEST_ID,
      recordedAtISO: "2026-08-09T20:00:00.000Z"
    }
  };
}

function deferred() {
  let resolve;
  let reject;
  const promise = new Promise((resolvePromise, rejectPromise) => {
    resolve = resolvePromise;
    reject = rejectPromise;
  });
  return { promise, resolve, reject };
}

let container;
let root;

async function settle() {
  await act(async () => {
    await Promise.resolve();
    await new Promise((resolve) => window.setTimeout(resolve, 0));
  });
}

function mount() {
  act(() => root.render(<RevenueAutopilotUnsubscribePage />));
}

function action(name) {
  return container.querySelector(`[data-capability-action="${name}"]`);
}

beforeEach(() => {
  vi.clearAllMocks();
  window.history.replaceState({}, "", `/?unsubscribe=${TOKEN}`);
  client.getContext.mockResolvedValue({ context: context() });
  client.isDefinitive.mockReturnValue(false);
  client.readPending.mockReturnValue(null);
  client.reset.mockReturnValue(true);
  client.unsubscribe.mockResolvedValue(result());
  container = document.createElement("div");
  document.body.appendChild(container);
  root = createRoot(container);
});

afterEach(() => {
  act(() => root.unmount());
  container.remove();
});

describe("RevenueAutopilotUnsubscribePage", () => {
  test("renders the governed ready state from an exact-token context", async () => {
    mount();
    await settle();

    expect(container.innerHTML).toContain('data-capability-state="ready"');
    expect(container.innerHTML).toContain('data-capability-id="cwf-12-revenue-autopilot-unsubscribe"');
    expect(container.textContent).toContain("Example Catering");
    expect(container.textContent).toContain("Automated reminder email only");
    expect(container.textContent).toContain("does not create a customer account");
    expect(client.getContext).toHaveBeenCalledWith({ token: TOKEN });
  });

  test("moves a real request through submitting to an exact receipt", async () => {
    const request = deferred();
    client.unsubscribe.mockReturnValue(request.promise);
    mount();
    await settle();

    act(() => action("submit-revenue-autopilot-unsubscribe").click());
    expect(container.innerHTML).toContain('data-capability-state="submitting"');
    expect(client.unsubscribe).toHaveBeenCalledWith({ token: TOKEN });

    await act(async () => request.resolve(result()));
    expect(container.innerHTML).toContain('data-capability-state="receipt"');
    expect(container.textContent).toContain("Server receipt recorded");
    expect(container.textContent).toContain("not provider-delivery or payment evidence");
  });

  test("retains an uncertain request and reconciles the same identity", async () => {
    const request = deferred();
    client.readPending.mockReturnValue(pending());
    client.unsubscribe.mockReturnValue(request.promise);
    mount();
    await settle();

    expect(container.innerHTML).toContain('data-capability-state="uncertain"');
    act(() => action("submit-revenue-autopilot-unsubscribe").click());
    expect(container.innerHTML).toContain('data-capability-state="reconciliation"');
    expect(client.unsubscribe).toHaveBeenCalledWith({ token: TOKEN, requestId: REQUEST_ID });
    await act(async () => request.resolve(result()));
  });

  test("resets a definitive rejection into explicit recovery", async () => {
    client.readPending.mockReturnValue(pending({ definitive: true }));
    mount();
    await settle();

    expect(container.innerHTML).toContain('data-capability-state="error"');
    act(() => action("reset-revenue-autopilot-unsubscribe").click());
    expect(client.reset).toHaveBeenCalledWith({ token: TOKEN });
    expect(container.innerHTML).toContain('data-capability-state="recovery"');
  });

  test("fails closed when the exact-token context cannot be loaded and exposes read recovery", async () => {
    client.getContext.mockRejectedValueOnce(new Error("link expired"));
    mount();
    await settle();

    expect(container.querySelector('[data-unsubscribe-read-state="error"]')).toBeTruthy();
    expect(action("submit-revenue-autopilot-unsubscribe")).toBeNull();
    expect(container.textContent).toContain("link expired");

    client.getContext.mockResolvedValueOnce({ context: context() });
    act(() => action("retry-unsubscribe-context").click());
    await settle();
    expect(container.querySelector('[data-unsubscribe-read-state="success"]')).toBeTruthy();
  });
});
