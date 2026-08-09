// @vitest-environment jsdom
import React, { act } from "react";
import { createRoot } from "react-dom/client";
import { renderToStaticMarkup } from "react-dom/server";
import { afterEach, beforeEach, describe, expect, test, vi } from "vitest";

const client = vi.hoisted(() => ({
  configure: vi.fn(),
  readPending: vi.fn(),
  reset: vi.fn()
}));

vi.mock("../../lib/revenueAutopilotClient", () => ({
  configureRevenueAutopilotCustomerControls: client.configure,
  readPendingRevenueAutopilotCustomerControlsAttempt: client.readPending,
  resetDefinitiveRevenueAutopilotCustomerControlsAttempt: client.reset
}));

import RevenueAutopilotCustomerControls, {
  buildRevenueAutopilotCustomerControlsPresentation
} from "../RevenueAutopilotCustomerControls";

globalThis.IS_REACT_ACT_ENVIRONMENT = true;

const SCOPE = Object.freeze({
  organizationId: "org-one",
  customerId: "customer-one"
});
const REQUEST_ID = `ra_request_${"a".repeat(32)}`;

function dormantProjection(scope = SCOPE) {
  return {
    schemaVersion: 1,
    authority: "server_projection",
    source: "firebase_server_projection",
    ...scope,
    observedAtISO: "2026-08-09T18:55:00.000Z",
    authorityState: "dormant",
    revision: 0,
    consent: { state: "unknown", recordedAtISO: "" },
    subscription: { state: "unknown", recordedAtISO: "" }
  };
}

function configuredProjection(overrides = {}) {
  return {
    ...dormantProjection(),
    authorityState: "configured",
    revision: 4,
    consent: { state: "granted", recordedAtISO: "2026-08-09T18:45:00.000Z" },
    subscription: { state: "subscribed", recordedAtISO: "2026-08-09T18:46:00.000Z" },
    ...overrides
  };
}

function pending(overrides = {}) {
  return {
    operation: "configure_customer_controls",
    ...SCOPE,
    expectedRevision: 0,
    consentState: "granted",
    subscriptionState: "subscribed",
    requestId: REQUEST_ID,
    mode: "submitting",
    state: "uncertain",
    error: "network unavailable",
    definitive: false,
    ...overrides
  };
}

function receipt(overrides = {}) {
  return {
    ok: true,
    storage: "firebase",
    ...SCOPE,
    mutationMode: "submitting",
    receipt: {
      ...SCOPE,
      requestId: REQUEST_ID,
      operation: "configure_customer_controls",
      recordedAtISO: "2026-08-09T19:00:00.000Z"
    },
    ...overrides
  };
}

let container;
let root;

function mount(element) {
  act(() => root.render(element));
}

function field(name) {
  return container.querySelector(`[data-capability-field="${name}"]`);
}

function action(name) {
  return container.querySelector(`[data-capability-action="${name}"]`);
}

function changeSelect(node, value) {
  act(() => {
    node.value = value;
    node.dispatchEvent(new Event("change", { bubbles: true }));
  });
}

function changeCheckbox(node, checked) {
  if (node.checked === checked) return;
  act(() => node.click());
}

beforeEach(() => {
  vi.clearAllMocks();
  client.readPending.mockReturnValue(null);
  client.reset.mockReturnValue(true);
  container = document.createElement("div");
  document.body.appendChild(container);
  root = createRoot(container);
});

afterEach(() => {
  act(() => root.unmount());
  container.remove();
});

describe("Revenue Autopilot customer-control presentation", () => {
  test.each([
    ["ready", { state: "ready" }],
    ["submitting", { state: "submitting", pending: true }],
    ["uncertain", { state: "uncertain", pending: true, requestId: REQUEST_ID }],
    ["reconciliation", { state: "reconciliation", pending: true, requestId: REQUEST_ID }],
    ["receipt", { state: "receipt", receipt: receipt().receipt }],
    ["error", { state: "error", pending: true, definitive: true, requestId: REQUEST_ID }],
    ["recovery", { state: "recovery" }]
  ])("preserves the governed %s mutation model", (state, mutation) => {
    const view = buildRevenueAutopilotCustomerControlsPresentation({
      isAdmin: true,
      mutation
    });
    expect(view.state).toBe(state);
    expect(view.detail).toBeTruthy();
    expect(view.presentation.label).toBeTruthy();
  });

  test("renders an explicit role gate and never exposes mutation controls to non-admin staff", () => {
    const markup = renderToStaticMarkup(
      <RevenueAutopilotCustomerControls {...SCOPE} isAdmin={false} />
    );
    expect(markup).toContain('data-capability-id="cwf-12-customer-email-controls-mutation"');
    expect(markup).toContain('data-capability-state="restricted"');
    expect(markup).toContain('data-mutation-state="restricted"');
    expect(markup).toContain('data-role-gate="restricted"');
    expect(markup).toContain("Only tenant administrators");
    expect(markup).not.toContain('data-capability-action="save-customer-email-controls"');
  });

  test("keeps consent/subscription separate from provider delivery, customer viewing, and payment", () => {
    const markup = renderToStaticMarkup(
      <RevenueAutopilotCustomerControls {...SCOPE} controls={dormantProjection()} isAdmin />
    );
    expect(markup).toContain('data-proof-boundary="controls-not-delivery"');
    expect(markup).toContain("eligibility records only");
    expect(markup).toContain("do not enable tenant automation");
    expect(markup).toContain("prove provider acceptance or delivery");
    expect(markup).toContain("establish a customer view");
    expect(markup).toContain("verify payment");
    expect(markup).toContain("Not configured");
    expect(markup).toContain("revision 0");
    expect(markup).not.toContain("Email delivered");
    expect(markup).toContain('data-capability-state="ready"');
  });

  test("fails closed when the persisted server projection is missing", () => {
    const onRefresh = vi.fn();
    mount(
      <RevenueAutopilotCustomerControls
        {...SCOPE}
        isAdmin
        projectionError="Current customer email controls could not be loaded."
        onRefresh={onRefresh}
      />
    );

    expect(container.querySelector('[data-email-controls-surface-state="unavailable"]')).toBeTruthy();
    expect(container.querySelector('[data-email-controls-availability="unavailable"]')).toBeTruthy();
    expect(container.textContent).toContain("could not be loaded");
    expect(container.textContent).toContain("Blank choices are not treated as the current state");
    expect(field("customer-email-consent").value).toBe("");
    expect(field("customer-email-consent").disabled).toBe(true);
    expect(field("customer-email-subscription").disabled).toBe(true);
    expect(action("save-customer-email-controls").disabled).toBe(true);
    expect(container.querySelector('[data-email-control="subscription"]')?.textContent)
      .toContain("Current state unavailable");

    act(() => action("refresh-customer-email-controls").click());
    expect(onRefresh).toHaveBeenCalledTimes(1);
  });

  test("locks mutation against a retained projection while Customer 360 refreshes", () => {
    mount(
      <RevenueAutopilotCustomerControls
        {...SCOPE}
        controls={configuredProjection()}
        isAdmin
        projectionStale
      />
    );

    expect(container.querySelector('[data-email-controls-surface-state="stale"]')).toBeTruthy();
    expect(container.querySelector('[data-email-controls-availability="stale"]')).toBeTruthy();
    expect(field("customer-email-consent").value).toBe("granted");
    expect(field("customer-email-consent").disabled).toBe(true);
    expect(action("save-customer-email-controls").disabled).toBe(true);
    expect(container.textContent).toContain("may be stale");
  });
});

describe("Revenue Autopilot customer-control interaction", () => {
  test("requires deliberate compatible evidence and sends only the exact customer-control fields", async () => {
    client.configure.mockResolvedValue(receipt());
    const onReceipt = vi.fn();
    mount(<RevenueAutopilotCustomerControls
      {...SCOPE}
      controls={dormantProjection()}
      isAdmin
      onReceipt={onReceipt}
    />);

    const save = action("save-customer-email-controls");
    expect(save.disabled).toBe(true);
    changeSelect(field("customer-email-consent"), "granted");
    expect(field("customer-email-subscription").querySelector('option[value="subscribed"]').disabled).toBe(false);
    changeSelect(field("customer-email-subscription"), "subscribed");
    changeCheckbox(field("customer-email-evidence-confirmed"), true);
    expect(save.disabled).toBe(false);

    await act(async () => save.click());

    expect(client.configure).toHaveBeenCalledWith({
      ...SCOPE,
      expectedRevision: 0,
      consentState: "granted",
      subscriptionState: "subscribed"
    });
    expect(container.querySelector('[data-mutation-state="receipt"]')).toBeTruthy();
    expect(container.innerHTML).toContain('data-capability-state="receipt"');
    expect(container.textContent).toContain("Controls recorded");
    expect(container.textContent).toContain("Consent granted");
    expect(container.textContent).toContain("Subscribed");
    expect(container.textContent).toContain("No email was scheduled or sent");
    expect(container.textContent).toContain("receipt proves only the control mutation");
    expect(onReceipt).toHaveBeenCalledWith(expect.objectContaining({
      receipt: expect.objectContaining({ requestId: REQUEST_ID }),
      controls: expect.objectContaining({
        revision: 1,
        consentState: "granted",
        subscriptionState: "subscribed",
        source: "exact_receipt"
      })
    }));
  });

  test("hydrates persisted configured state and advances the exact server revision", async () => {
    client.configure.mockResolvedValue(receipt());
    mount(
      <RevenueAutopilotCustomerControls
        {...SCOPE}
        controls={configuredProjection()}
        isAdmin
      />
    );

    expect(field("customer-email-consent").value).toBe("granted");
    expect(field("customer-email-subscription").value).toBe("subscribed");
    expect(container.textContent).toContain("revision 4");
    expect(container.textContent).toContain("Server projection");

    changeSelect(field("customer-email-subscription"), "unsubscribed");
    changeCheckbox(field("customer-email-evidence-confirmed"), true);
    await act(async () => action("save-customer-email-controls").click());

    expect(client.configure).toHaveBeenCalledWith({
      ...SCOPE,
      expectedRevision: 4,
      consentState: "granted",
      subscriptionState: "unsubscribed"
    });
    expect(container.textContent).toContain("revision 5");
    expect(container.textContent).toContain("Exact mutation receipt");
  });

  test("forces revoked consent to unsubscribed and prevents an incompatible state", () => {
    mount(<RevenueAutopilotCustomerControls {...SCOPE} controls={dormantProjection()} isAdmin />);
    changeSelect(field("customer-email-consent"), "granted");
    changeSelect(field("customer-email-subscription"), "subscribed");
    changeSelect(field("customer-email-consent"), "revoked");

    expect(field("customer-email-subscription").value).toBe("unsubscribed");
    expect(field("customer-email-subscription").querySelector('option[value="subscribed"]').disabled).toBe(true);
    expect(field("customer-email-evidence-confirmed").disabled).toBe(false);
  });

  test("restores unresolved process-memory input and reconciles the unchanged request identity", async () => {
    client.readPending.mockReturnValue(pending());
    client.configure.mockResolvedValue(receipt({ mutationMode: "reconciliation" }));
    mount(<RevenueAutopilotCustomerControls {...SCOPE} controls={dormantProjection()} isAdmin />);

    expect(container.querySelector('[data-mutation-state="uncertain"]')).toBeTruthy();
    expect(field("customer-email-consent").value).toBe("granted");
    expect(field("customer-email-subscription").value).toBe("subscribed");
    expect(field("customer-email-consent").disabled).toBe(true);
    expect(action("save-customer-email-controls").disabled).toBe(true);

    const reconcile = action("reconcile-customer-email-controls");
    let resolveReconciliation;
    client.configure.mockReturnValueOnce(new Promise((resolve) => {
      resolveReconciliation = resolve;
    }));
    act(() => reconcile.click());
    expect(container.querySelector('[data-mutation-state="reconciliation"]')).toBeTruthy();
    expect(container.innerHTML).toContain('data-capability-state="reconciliation"');
    expect(client.configure).toHaveBeenCalledWith({
      ...SCOPE,
      expectedRevision: 0,
      consentState: "granted",
      subscriptionState: "subscribed",
      requestId: REQUEST_ID
    });

    await act(async () => resolveReconciliation(receipt({ mutationMode: "reconciliation" })));
    expect(container.querySelector('[data-mutation-state="receipt"]')).toBeTruthy();
  });

  test("shows submitting while the exact request is in flight", async () => {
    let resolveRequest;
    client.configure.mockReturnValue(new Promise((resolve) => {
      resolveRequest = resolve;
    }));
    mount(<RevenueAutopilotCustomerControls {...SCOPE} controls={dormantProjection()} isAdmin />);
    changeSelect(field("customer-email-consent"), "granted");
    changeSelect(field("customer-email-subscription"), "subscribed");
    changeCheckbox(field("customer-email-evidence-confirmed"), true);

    act(() => action("save-customer-email-controls").click());
    expect(container.querySelector('[data-mutation-state="submitting"]')).toBeTruthy();
    expect(container.innerHTML).toContain('data-capability-state="submitting"');
    expect(field("customer-email-consent").disabled).toBe(true);
    expect(container.textContent).toContain("Do not repeat it");

    await act(async () => resolveRequest(receipt()));
    expect(container.querySelector('[data-mutation-state="receipt"]')).toBeTruthy();
  });

  test("retains an uncertain failed outcome and exposes only exact reconciliation", async () => {
    const unavailable = Object.assign(new Error("network unavailable"), {
      code: "functions/unavailable"
    });
    client.configure.mockRejectedValue(unavailable);
    client.readPending
      .mockReturnValueOnce(null)
      .mockReturnValue(pending());
    mount(<RevenueAutopilotCustomerControls {...SCOPE} controls={dormantProjection()} isAdmin />);
    changeSelect(field("customer-email-consent"), "granted");
    changeSelect(field("customer-email-subscription"), "subscribed");
    changeCheckbox(field("customer-email-evidence-confirmed"), true);

    await act(async () => action("save-customer-email-controls").click());

    expect(container.querySelector('[data-mutation-state="uncertain"]')).toBeTruthy();
    expect(container.innerHTML).toContain('data-capability-state="uncertain"');
    expect(container.textContent).toContain("Reconcile this unchanged request");
    expect(action("reconcile-customer-email-controls")).toBeTruthy();
    expect(action("reset-customer-email-controls")).toBeNull();
    expect(field("customer-email-consent").disabled).toBe(true);
  });

  test("requires an exact safe reset after definitive rejection before corrected input", () => {
    client.readPending.mockReturnValue(pending({
      state: "error",
      error: "admin authority required",
      definitive: true
    }));
    mount(<RevenueAutopilotCustomerControls {...SCOPE} controls={dormantProjection()} isAdmin />);

    expect(container.querySelector('[data-mutation-state="error"]')).toBeTruthy();
    expect(container.innerHTML).toContain('data-capability-state="error"');
    expect(action("reconcile-customer-email-controls")).toBeNull();
    const reset = action("reset-customer-email-controls");
    act(() => reset.click());

    expect(client.reset).toHaveBeenCalledWith({
      ...SCOPE,
      requestId: REQUEST_ID
    });
    expect(container.querySelector('[data-mutation-state="recovery"]')).toBeTruthy();
    expect(container.innerHTML).toContain('data-capability-state="recovery"');
    expect(field("customer-email-consent").disabled).toBe(false);
    expect(field("customer-email-evidence-confirmed").checked).toBe(false);
    expect(container.textContent).toContain("safely reset");
  });

  test("does not carry an unresolved request across customer scope changes", () => {
    client.readPending.mockImplementation(({ customerId }) => (
      customerId === SCOPE.customerId ? pending() : null
    ));
    mount(<RevenueAutopilotCustomerControls {...SCOPE} controls={dormantProjection()} isAdmin />);
    expect(container.querySelector('[data-mutation-state="uncertain"]')).toBeTruthy();

    mount(
      <RevenueAutopilotCustomerControls
        organizationId={SCOPE.organizationId}
        customerId="customer-two"
        controls={dormantProjection({
          organizationId: SCOPE.organizationId,
          customerId: "customer-two"
        })}
        isAdmin
      />
    );
    expect(container.querySelector('[data-mutation-state="ready"]')).toBeTruthy();
    expect(field("customer-email-consent").value).toBe("");
    expect(field("customer-email-subscription").value).toBe("");
  });
});
