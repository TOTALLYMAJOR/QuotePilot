// @vitest-environment jsdom
import React, { act } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { createRoot } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, test, vi } from "vitest";
import SmsProviderPanel, { isSmsProviderAttemptLocked } from "../SmsProviderPanel";
import {
  applySmsSetupStatusRefresh,
  applySmsTestMessageChange,
  resolveSmsDiagnosticRequestId
} from "../IntegrationOpsModal";

globalThis.IS_REACT_ACT_ENVIRONMENT = true;

function providerStatus({ canSend = true } = {}) {
  return {
    smsProvider: "pingram",
    smsProviderSupported: true,
    sms: {
      provider: "pingram",
      supported: true,
      configured: null,
      localConfigComplete: true,
      canAttemptDiagnostic: canSend,
      canSend: null,
      suppressed: false
    },
    pingram: {
      configured: null,
      localConfigComplete: true,
      canAttemptDiagnostic: canSend,
      canSend: null,
      apiKeyConfigured: true,
      senderConfigured: true,
      webhookConfigured: true,
      reconciliationConfigured: true,
      suppressed: false,
      missingFields: [],
      apiKeyHint: "fixture-secret-value",
      fromNumberHint: "+15550100200"
    },
    twilio: {
      configured: false,
      credentialsConfigured: false,
      messagingServiceConfigured: false,
      senderRegistered: false,
      suppressed: false,
      missingFields: ["account", "service"]
    }
  };
}

const BASE_PROPS = Object.freeze({
  status: providerStatus(),
  setupGuidance: [
    "NOTIFICATIONS_SMS_PROVIDER=pingram",
    "PINGRAM_API_KEY=fixture-secret-value",
    "PINGRAM_FROM_NUMBER=+15550100200"
  ].join("\n"),
  disableGuidance: "Set NOTIFICATIONS_SMS_PROVIDER=none through the trusted runtime deployment."
});

function renderPanel(props = {}) {
  return renderToStaticMarkup(<SmsProviderPanel {...BASE_PROPS} {...props} />);
}

let container;
let root;

beforeEach(() => {
  container = document.createElement("div");
  document.body.appendChild(container);
  root = createRoot(container);
});

afterEach(() => {
  act(() => root.unmount());
  container.remove();
});

function mount(props = {}) {
  act(() => {
    root.render(<SmsProviderPanel {...BASE_PROPS} {...props} />);
  });
}

function action(name) {
  return container.querySelector(`[data-capability-action="${name}"]`);
}

describe("SmsProviderPanel", () => {
  test("renders every canonical SMS provider mutation state from the exported resolver", () => {
    expect(renderPanel()).toContain('data-capability-state="ready"');
    expect(renderPanel({ testing: true })).toContain('data-capability-state="submitting"');
    expect(renderPanel({ smsResult: { state: "queued" } })).toMatch(/data-capability-state=.submitting./);
    expect(renderPanel({ smsResult: { outcome: "indeterminate" } })).toContain('data-capability-state="uncertain"');
    expect(renderPanel({ reconciling: true })).toContain('data-capability-state="reconciliation"');
    expect(renderPanel({ smsResult: { state: "request_accepted", provider: "pingram" } })).toContain('data-capability-state="receipt"');
    expect(renderPanel({ statusError: "status read failed" })).toContain('data-capability-state="error"');
    expect(renderPanel({ loading: true, statusError: "retrying status read" })).toContain('data-capability-state="recovery"');
  });

  test("shows provider-specific readiness without rendering secrets or full phone numbers", () => {
    const markup = renderPanel({
      smsResult: { accepted: true, safeToRetry: false, provider: "pingram" }
    });

    expect(markup).toContain('data-capability-id="sms-provider-choice"');
    expect(markup).toContain('data-sms-provider="pingram"');
    expect(markup).toContain('data-sms-provider="twilio"');
    expect(markup).toContain("Request acceptance is not carrier delivery");
    expect(markup).toContain("Field completeness does not prove that credentials exist");
    expect(markup).toContain("Local runtime fields:");
    expect(markup).toContain("Controlled diagnostic can be attempted:");
    expect(markup).toContain("indeterminate send is unsafe to retry");
    expect(markup).toContain("Pingram webhook and reconciliation are required");
    expect(markup).toContain("Twilio requires trusted runtime auth and contact-digest secrets");
    expect(markup).toContain("Request accepted");
    expect(markup).toContain("stored in trusted runtime");
    expect(markup).not.toContain("fixture-secret-value");
    expect(markup).not.toContain("+15550100200");
    expect(markup).not.toContain("apiKeyHint");
    expect(markup).not.toContain("fromNumberHint");
  });

  test("does not infer credential presence from non-secret provider configuration", () => {
    const status = providerStatus();
    const markup = renderPanel({
      status: {
        ...status,
        pingram: {
          ...status.pingram,
          configured: true,
          apiKeyConfigured: null,
          credentialConfigured: null,
          credentialsConfigured: null
        },
        twilio: {
          ...status.twilio,
          configured: true,
          credentialConfigured: null,
          credentialsConfigured: null,
          accountConfigured: null
        }
      }
    });

    expect(markup).toContain("API credential: not reported");
    expect(markup).toContain("Account credentials: not reported");
    expect(markup).not.toContain("API credential: configured");
    expect(markup).not.toContain("Account credentials: configured");
  });

  test("uses only generic SMS send authority and wires the five parent-owned callbacks", () => {
    const onRefresh = vi.fn();
    const onTestMessageChange = vi.fn();
    const onSendTest = vi.fn();
    const onCopySetupGuidance = vi.fn();
    const onCopyDisableGuidance = vi.fn();
    const callbacks = {
      onRefresh,
      onTestMessageChange,
      onSendTest,
      onCopySetupGuidance,
      onCopyDisableGuidance
    };

    mount({ ...callbacks, status: providerStatus({ canSend: false }) });
    expect(action("send-sms-provider-test").disabled).toBe(true);

    mount({ ...callbacks, status: providerStatus({ canSend: true }) });
    expect(action("send-sms-provider-test").disabled).toBe(false);

    const input = container.querySelector('input[aria-label="Test SMS message (optional)"]')
      || [...container.querySelectorAll("input")].find((element) => element.type === "text");
    const setValue = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, "value").set;
    act(() => {
      setValue.call(input, "Connectivity check");
      input.dispatchEvent(new Event("input", { bubbles: true }));
      action("refresh-sms-provider-status").dispatchEvent(new MouseEvent("click", { bubbles: true }));
      action("copy-sms-provider-setup").dispatchEvent(new MouseEvent("click", { bubbles: true }));
      action("copy-sms-provider-disable").dispatchEvent(new MouseEvent("click", { bubbles: true }));
      action("send-sms-provider-test").dispatchEvent(new MouseEvent("click", { bubbles: true }));
    });

    expect(onTestMessageChange).toHaveBeenCalledWith("Connectivity check");
    expect(onRefresh).toHaveBeenCalledTimes(1);
    expect(onCopySetupGuidance).toHaveBeenCalledTimes(1);
    expect(onCopyDisableGuidance).toHaveBeenCalledTimes(1);
    expect(onSendTest).toHaveBeenCalledTimes(1);
  });

  test("locks an indeterminate request against both input changes and a duplicate send", () => {
    mount({
      status: providerStatus({ canSend: true }),
      smsResult: { state: "outcome_ambiguous" },
      onRefresh: vi.fn(),
      onSendTest: vi.fn()
    });

    expect(container.querySelector('input[type="text"]').disabled).toBe(true);
    expect(action("send-sms-provider-test").disabled).toBe(true);
    expect(action("refresh-sms-provider-status").textContent).toContain("Refresh Recorded Evidence");
  });

  test("keeps a signed owner opt-out hold active across provider selection", () => {
    const status = providerStatus({ canSend: false });
    mount({
      status: {
        ...status,
        smsProvider: "twilio",
        sms: { ...status.sms, provider: "twilio", suppressed: true },
        pingram: { ...status.pingram, suppressed: true },
        twilio: { ...status.twilio, configured: true, suppressed: true }
      },
      onSendTest: vi.fn()
    });

    expect(action("send-sms-provider-test").disabled).toBe(true);
    expect(container.textContent).toContain("Owner SMS opt-out hold: active");
    expect(container.textContent).toContain("held across every provider selection");
    expect(container.textContent).toContain("no browser or callable clear path");
    expect(container.querySelector('[data-sms-provider="twilio"]').textContent)
      .toContain("Opt-out hold: active");
  });

  test.each([
    ["queued", { state: "queued" }],
    ["dispatching", { state: "dispatching" }],
    ["provider accepted", { state: "provider_accepted" }],
    ["submitting", { mutationState: "submitting" }],
    ["uncertain", { state: "uncertain" }]
  ])("locks a %s attempt against message edits and duplicate sends", (_label, smsResult) => {
    mount({
      status: providerStatus({ canSend: true }),
      smsResult,
      onRefresh: vi.fn(),
      onSendTest: vi.fn()
    });

    expect(isSmsProviderAttemptLocked({ status: providerStatus(), smsResult })).toBe(true);
    expect(container.querySelector('input[type="text"]').disabled).toBe(true);
    expect(action("send-sms-provider-test").disabled).toBe(true);
    expect(action("refresh-sms-provider-status").textContent).toContain("Refresh Recorded Evidence");
  });

  test("keeps provider rejection distinct from provider-accepted delivery failure", () => {
    const rejected = renderPanel({
      smsResult: {
        state: "definite_failure",
        provider: "pingram",
        safeToRetry: true
      }
    });
    const deliveryFailed = renderPanel({
      smsResult: {
        state: "failed",
        provider: "pingram",
        providerAccepted: true,
        safeToRetry: false
      }
    });

    expect(rejected).toContain("Request rejected");
    expect(rejected).toContain("definitively rejected before provider acceptance");
    expect(deliveryFailed).toContain("Delivery failed");
    expect(deliveryFailed).toContain("provider accepted the request");
    expect(deliveryFailed).toContain("signed provider evidence reports delivery failure");
    expect(deliveryFailed).not.toContain("No provider acceptance");
  });

  test("keeps provider acceptance distinct from verified signed carrier delivery", () => {
    const accepted = renderPanel({
      smsResult: {
        state: "provider_accepted",
        provider: "pingram",
        providerAccepted: true
      }
    });
    const delivered = renderPanel({
      smsResult: {
        state: "delivered",
        provider: "pingram",
        providerAccepted: true,
        delivered: true
      }
    });

    expect(accepted).toContain("Request accepted");
    expect(accepted).toContain("does not establish carrier delivery or recipient receipt");
    expect(accepted).not.toContain("Signed delivery evidenced");
    expect(delivered).toContain("Signed delivery evidenced");
    expect(delivered).toContain("establishes carrier delivery for the original SMS request");
    expect(delivered).toContain("Recipient/device receipt is not established");
    expect(delivered).not.toContain("does not establish carrier delivery or recipient receipt");

    const switchedStatus = providerStatus();
    const recordedBeforeSwitch = renderPanel({
      status: {
        ...switchedStatus,
        smsProvider: "twilio",
        sms: {
          ...switchedStatus.sms,
          provider: "twilio",
          mutationState: "receipt",
          latestEvidence: {
            state: "delivered",
            provider: "pingram",
            delivered: true
          }
        }
      }
    });
    expect(recordedBeforeSwitch).toContain("Signed delivery evidenced");
    expect(recordedBeforeSwitch).toContain("Recorded provider: Pingram");
    expect(recordedBeforeSwitch).not.toContain("Recorded provider: Twilio");
  });

  test("preserves stable request and result evidence across refresh and blocks unresolved message changes", () => {
    const smsResult = {
      state: "queued",
      attemptId: "sms_attempt_fixture",
      safeToRetry: false
    };
    const previous = {
      loading: true,
      reconciling: false,
      error: "stale read",
      status: providerStatus(),
      smsResult,
      testRequestId: "sms_test_0123456789abcdef0123456789abcdef",
      testMessage: "Original payload"
    };
    const refreshedStatus = {
      ...providerStatus(),
      sms: {
        ...providerStatus().sms,
        latestEvidence: {
          state: "delivered",
          notificationType: "integration_test"
        }
      }
    };

    const refreshed = applySmsSetupStatusRefresh(previous, refreshedStatus);
    expect(refreshed.testRequestId).toBe(previous.testRequestId);
    expect(refreshed.smsResult).toBe(smsResult);
    expect(refreshed.status).toBe(refreshedStatus);

    const ignoredEdit = applySmsTestMessageChange(refreshed, "Changed payload");
    expect(ignoredEdit).toBe(refreshed);
    expect(ignoredEdit.testMessage).toBe("Original payload");
    expect(ignoredEdit.testRequestId).toBe(previous.testRequestId);
    expect(ignoredEdit.smsResult).toBe(smsResult);
  });

  test("allows a corrected fresh payload after a definitive retry-safe rejection", () => {
    const previous = {
      loading: false,
      testing: false,
      reconciling: false,
      error: "",
      status: providerStatus(),
      smsResult: { state: "definite_failure", safeToRetry: true },
      testRequestId: "sms_test_0123456789abcdef0123456789abcdef",
      testMessage: "Original payload"
    };

    const changed = applySmsTestMessageChange(previous, "Corrected payload");
    expect(changed).not.toBe(previous);
    expect(changed).toMatchObject({
      testMessage: "Corrected payload",
      testRequestId: "",
      smsResult: null
    });
  });

  test("uses a new idempotency key for a same-payload terminal diagnostic retest", () => {
    const createRequestId = vi.fn(() => "sms_test_new_terminal_attempt");
    const currentRequestId = "sms_test_original_terminal_attempt";

    expect(resolveSmsDiagnosticRequestId({
      currentRequestId,
      smsResult: { state: "delivered" },
      createRequestId
    })).toBe("sms_test_new_terminal_attempt");
    expect(createRequestId).toHaveBeenCalledTimes(1);

    createRequestId.mockClear();
    expect(resolveSmsDiagnosticRequestId({
      currentRequestId,
      smsResult: { state: "uncertain" },
      createRequestId
    })).toBe(currentRequestId);
    expect(createRequestId).not.toHaveBeenCalled();
  });
});
