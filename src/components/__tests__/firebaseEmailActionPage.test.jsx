// @vitest-environment jsdom

import React, { act } from "react";
import { createRoot } from "react-dom/client";
import { renderToStaticMarkup } from "react-dom/server";
import { afterEach, beforeEach, describe, expect, test, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  complete: vi.fn()
}));

vi.mock("../../lib/firebaseEmailAction", async (importOriginal) => ({
  ...(await importOriginal()),
  completeFirebaseEmailVerification: mocks.complete
}));

vi.mock("../ProductBrandLockup", () => ({ default: () => <div>QuotePilot</div> }));

import FirebaseEmailActionPage, {
  FirebaseEmailActionPresentation
} from "../FirebaseEmailActionPage";

globalThis.IS_REACT_ACT_ENVIRONMENT = true;

function markupFor(state) {
  return renderToStaticMarkup(<FirebaseEmailActionPresentation state={state} />);
}

describe("FirebaseEmailActionPresentation state contract", () => {
  test("renders the ready state before the user authorizes the mutation", () => {
    const markup = markupFor("ready");
    expect(markup).toContain('data-capability-state="ready"');
  });

  test("renders the submitting state while Firebase applies the code", () => {
    const markup = markupFor("submitting");
    expect(markup).toContain('data-capability-state="submitting"');
  });

  test("renders the uncertain state without claiming verification", () => {
    const markup = markupFor("uncertain");
    expect(markup).toContain('data-capability-state="uncertain"');
  });

  test("renders reconciliation while waiting for the Firebase receipt", () => {
    const markup = markupFor("reconciliation");
    expect(markup).toContain('data-capability-state="reconciliation"');
  });

  test("renders the receipt state only after Firebase acceptance", () => {
    const markup = markupFor("receipt");
    expect(markup).toContain('data-capability-state="receipt"');
  });

  test("renders the error state for a definitively unusable code", () => {
    const markup = markupFor("error");
    expect(markup).toContain('data-capability-state="error"');
  });

  test("renders the recovery state for a malformed action link", () => {
    const markup = markupFor("recovery");
    expect(markup).toContain('data-capability-state="recovery"');
  });
});

describe("FirebaseEmailActionPage", () => {
  let container;
  let root;

  beforeEach(() => {
    const params = new URLSearchParams({
      apiKey: "staging-api-key",
      mode: "verifyEmail",
      oobCode: "one-time-code",
      continueUrl: "https://quotepilot-staging-20260804.web.app/app"
    });
    window.history.replaceState({}, "", `/app/auth/action?${params}`);
    container = document.createElement("div");
    document.body.appendChild(container);
    root = createRoot(container);
    mocks.complete.mockResolvedValue({
      continueUrl: "https://quotepilot-staging-20260804.web.app/app",
      verified: true
    });
  });

  afterEach(() => {
    act(() => root.unmount());
    container.remove();
    vi.clearAllMocks();
  });

  test("does not apply a verification code until the person chooses Verify email", async () => {
    await act(async () => {
      root.render(<FirebaseEmailActionPage />);
      await Promise.resolve();
    });
    expect(window.location.search).toBe("");
    expect(mocks.complete).not.toHaveBeenCalled();

    const button = Array.from(container.querySelectorAll("button"))
      .find((candidate) => candidate.textContent.trim() === "Verify email");
    await act(async () => {
      button.dispatchEvent(new MouseEvent("click", { bubbles: true }));
      await Promise.resolve();
      await Promise.resolve();
    });

    expect(mocks.complete).toHaveBeenCalledOnce();
    expect(container.textContent).toContain("Your email is verified");
  });
});
