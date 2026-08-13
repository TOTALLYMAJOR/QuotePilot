// @vitest-environment jsdom
import React from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, test } from "vitest";

import CustomerProvisioningAuthorityState from "../CustomerProvisioningAuthorityState";

describe("CustomerProvisioningAuthorityState", () => {
  test("marks the owner provisioning ready state", () => {
    const markup = renderToStaticMarkup(<CustomerProvisioningAuthorityState state="ready" />);
    expect(markup).toContain('data-capability-state="ready"');
  });

  test("marks the exact request submitting state", () => {
    const markup = renderToStaticMarkup(<CustomerProvisioningAuthorityState state="submitting" />);
    expect(markup).toContain('data-capability-state="submitting"');
  });

  test("marks transport uncertainty without discarding the order", () => {
    const markup = renderToStaticMarkup(<CustomerProvisioningAuthorityState state="uncertain" onReconcile={() => {}} />);
    expect(markup).toContain('data-capability-state="uncertain"');
  });

  test("marks exact-order reconciliation while it is running", () => {
    const markup = renderToStaticMarkup(<CustomerProvisioningAuthorityState state="reconciliation" />);
    expect(markup).toContain('data-capability-state="reconciliation"');
  });

  test("marks a successful provisioning receipt", () => {
    const markup = renderToStaticMarkup(<CustomerProvisioningAuthorityState state="receipt" />);
    expect(markup).toContain('data-capability-state="receipt"');
  });

  test("marks a definitive error with contextual recovery", () => {
    const markup = renderToStaticMarkup(<CustomerProvisioningAuthorityState state="error" onReset={() => {}} />);
    expect(markup).toContain('data-capability-state="error"');
    expect(markup).toContain('data-capability-state="recovery"');
  });
});
