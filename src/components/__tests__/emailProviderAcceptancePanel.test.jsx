// @vitest-environment jsdom
import React, { act } from "react";
import { createRoot } from "react-dom/client";
import { renderToStaticMarkup } from "react-dom/server";
import { afterEach, beforeEach, describe, expect, test, vi } from "vitest";
import EmailProviderAcceptancePanel, {
  resolveEmailAcceptanceCapabilityState
} from "../EmailProviderAcceptancePanel";

globalThis.IS_REACT_ACT_ENVIRONMENT = true;

const CONFIGURED_STATUS = Object.freeze({
  provider: "resend",
  configured: true,
  fromEmailHint: "quotep...@quietpilot.us"
});
const RECIPIENT = "flightcontrol@quietpilot.us";
const CONFIRMATION = `SEND RESEND TEST TO ${RECIPIENT}`;

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
    root.render(<EmailProviderAcceptancePanel
      emailStatus={CONFIGURED_STATUS}
      recipientEmail={RECIPIENT}
      expectedConfirmationToken={CONFIRMATION}
      {...props}
    />);
  });
}

describe("EmailProviderAcceptancePanel", () => {
  test("renders explicit provider-acceptance and delivery boundaries", () => {
    const markup = renderToStaticMarkup(<EmailProviderAcceptancePanel
      emailStatus={CONFIGURED_STATUS}
      recipientEmail={RECIPIENT}
      expectedConfirmationToken={CONFIRMATION}
    />);
    expect(markup).toContain('data-capability-id="resend-provider-acceptance-test"');
    expect(markup).toContain('data-capability-state="ready"');
    expect(markup).toContain("Provider acceptance proves only that Resend accepted the request");
    expect(markup).toContain("Resend delivered event and recipient inbox confirmation");
    expect(markup).not.toContain("apiKey");
  });

  test("requires the exact recipient confirmation before enabling the single send", () => {
    const onSend = vi.fn();
    mount({ confirmationToken: "wrong", onSend });
    const action = container.querySelector('[data-capability-action="send-resend-acceptance-test"]');
    expect(action.disabled).toBe(true);

    mount({ confirmationToken: CONFIRMATION, onSend });
    expect(action.disabled).toBe(false);
    act(() => action.dispatchEvent(new MouseEvent("click", { bubbles: true })));
    expect(onSend).toHaveBeenCalledTimes(1);
  });

  test("locks controls after provider acceptance and shows the durable receipt fields", () => {
    mount({
      confirmationToken: CONFIRMATION,
      result: {
        state: "provider_accepted",
        recipientEmail: RECIPIENT,
        acceptedAtISO: "2026-09-03T22:00:00.000Z",
        providerMessageId: "provider-message-1"
      }
    });
    expect(container.querySelector("section").dataset.capabilityState).toBe("receipt");
    expect(container.querySelector('input[type="email"]').disabled).toBe(true);
    expect(container.querySelector('[data-capability-action="send-resend-acceptance-test"]').disabled)
      .toBe(true);
    expect(container.textContent).toContain("provider-message-1");
  });

  test("distinguishes unavailable, submitting, error, and uncertain states", () => {
    const renderState = (props = {}) => renderToStaticMarkup(
      <EmailProviderAcceptancePanel emailStatus={CONFIGURED_STATUS} {...props} />
    );
    expect(renderState()).toContain('data-capability-state="ready"');
    expect(renderState({ testing: true })).toContain('data-capability-state="submitting"');
    const receiptMarkup = renderState({
      result: {
        state: "provider_accepted",
        recipientEmail: RECIPIENT,
        acceptedAtISO: "2026-09-03T22:00:00.000Z",
        providerMessageId: "provider-message-1"
      }
    });
    expect(receiptMarkup).toContain('data-capability-state="receipt"');
    expect(renderState({ error: "rejected" })).toContain('data-capability-state="error"');
    expect(renderState({ error: "safe fresh request", recovering: true }))
      .toContain('data-capability-state="recovery"');
    expect(renderState({ error: "unknown", uncertain: true }))
      .toContain('data-capability-state="uncertain"');
    expect(renderState({ error: "unknown", uncertain: true, reconciling: true }))
      .toContain('data-capability-state="reconciliation"');
    expect(resolveEmailAcceptanceCapabilityState()).toBe("unavailable");
  });
});
