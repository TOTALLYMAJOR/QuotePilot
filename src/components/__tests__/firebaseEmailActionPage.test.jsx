// @vitest-environment jsdom

import { afterEach, beforeEach, describe, expect, test, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  complete: vi.fn()
}));

vi.mock("../../lib/firebaseEmailAction", async (importOriginal) => ({
  ...(await importOriginal()),
  completeFirebaseEmailVerification: mocks.complete
}));

import {
  mountFirebaseEmailActionPage,
  renderFirebaseEmailActionState
} from "../FirebaseEmailActionPage";

describe("Firebase email action state contract", () => {
  const renderState = (state) => {
    const root = document.createElement("div");
    renderFirebaseEmailActionState(root, state);
    return root;
  };

  test("renders the ready state before the user authorizes the mutation", () => {
    expect(renderState("ready").innerHTML).toContain('data-capability-state="ready"');
  });

  test("renders the submitting state while Firebase applies the code", () => {
    expect(renderState("submitting").innerHTML).toContain('data-capability-state="submitting"');
  });

  test("renders the uncertain state without claiming verification", () => {
    expect(renderState("uncertain").innerHTML).toContain('data-capability-state="uncertain"');
  });

  test("renders reconciliation while waiting for the Firebase receipt", () => {
    expect(renderState("reconciliation").innerHTML).toContain('data-capability-state="reconciliation"');
  });

  test("renders the receipt state only after Firebase acceptance", () => {
    expect(renderState("receipt").innerHTML).toContain('data-capability-state="receipt"');
  });

  test("renders the error state for a definitively unusable code", () => {
    expect(renderState("error").innerHTML).toContain('data-capability-state="error"');
  });

  test("renders the recovery state for a malformed action link", () => {
    expect(renderState("recovery").innerHTML).toContain('data-capability-state="recovery"');
  });
});

describe("mountFirebaseEmailActionPage", () => {
  let container;

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
    mocks.complete.mockResolvedValue({
      continueUrl: "https://quotepilot-staging-20260804.web.app/app",
      verified: true
    });
  });

  afterEach(() => {
    container.remove();
    vi.clearAllMocks();
  });

  test("does not apply a verification code until the person chooses Verify email", async () => {
    mountFirebaseEmailActionPage(container);
    expect(window.location.search).toBe("");
    expect(mocks.complete).not.toHaveBeenCalled();

    container.querySelector("button").click();
    await vi.waitFor(() => expect(mocks.complete).toHaveBeenCalledOnce());

    expect(container.textContent).toContain("Your email is verified");
  });
});
