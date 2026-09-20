// @vitest-environment jsdom
import React from "react";
import { createRoot } from "react-dom/client";
import { act } from "react-dom/test-utils";
import { afterEach, beforeEach, describe, expect, test, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  registerWithEmail: vi.fn(),
  requestPasswordReset: vi.fn(),
  signInWithEmail: vi.fn(),
  signInWithGoogle: vi.fn()
}));

vi.mock("../../lib/authClient", () => mocks);

import AuthGate, { friendlyError } from "../AuthGate";

globalThis.IS_REACT_ACT_ENVIRONMENT = true;

let container;
let root;

function enterValue(input, value) {
  const setter = Object.getOwnPropertyDescriptor(
    window.HTMLInputElement.prototype,
    "value"
  ).set;
  setter.call(input, value);
  input.dispatchEvent(new Event("input", { bubbles: true }));
}

beforeEach(() => {
  vi.clearAllMocks();
  container = document.createElement("div");
  document.body.append(container);
  root = createRoot(container);
});

afterEach(() => {
  act(() => root.unmount());
  container.remove();
});

describe("AuthGate friendlyError", () => {
  test("maps invalid credential errors", () => {
    expect(friendlyError(new Error("Firebase: Error (auth/invalid-credential)."))).toBe(
      "Invalid email or password. Check your details or reset your password."
    );
  });

  test("maps too-many-requests errors", () => {
    expect(friendlyError(new Error("Firebase: Error (auth/too-many-requests)."))).toBe(
      "Too many attempts. Try again later."
    );
  });

  test("maps google popup closed errors", () => {
    expect(friendlyError(new Error("Firebase: Error (auth/popup-closed-by-user)."))).toBe(
      "Google sign-in was canceled."
    );
  });

  test("maps email already in use errors", () => {
    expect(friendlyError(new Error("Firebase: Error (auth/email-already-in-use)."))).toBe(
      "Email already registered."
    );
  });

  test("never leaks raw firebase error text for unknown codes", () => {
    expect(friendlyError(new Error("Firebase: Error (auth/network-request-failed)."))).toBe(
      "Sign-in failed. Try again or reset your password."
    );
    expect(friendlyError(new Error("some unexpected internal message"))).toBe(
      "Sign-in failed. Try again or reset your password."
    );
  });

  test("handles missing error objects safely", () => {
    expect(friendlyError(undefined)).toBe("Sign-in failed. Try again or reset your password.");
  });
});

describe("AuthGate required-field validation", () => {
  test("keeps an empty sign-in local through required field constraints", async () => {
    await act(async () => {
      root.render(<AuthGate />);
    });

    const submit = Array.from(container.querySelectorAll("button"))
      .find((button) => button.textContent === "Sign In" && button.type === "submit");
    await act(async () => {
      submit.click();
    });

    const email = container.querySelector('input[type="email"]');
    const password = container.querySelector('input[type="password"]');
    expect(mocks.signInWithEmail).not.toHaveBeenCalled();
    expect(email.required).toBe(true);
    expect(password.required).toBe(true);
    expect(email.checkValidity()).toBe(false);
    expect(password.checkValidity()).toBe(false);
  });

  test("keeps a missing-password sign-in local through the password constraint", async () => {
    await act(async () => {
      root.render(<AuthGate />);
    });

    const email = container.querySelector('input[type="email"]');
    const password = container.querySelector('input[type="password"]');
    await act(async () => {
      enterValue(email, "operator@example.com");
    });
    const submit = Array.from(container.querySelectorAll("button"))
      .find((button) => button.textContent === "Sign In" && button.type === "submit");
    await act(async () => {
      submit.click();
    });

    expect(mocks.signInWithEmail).not.toHaveBeenCalled();
    expect(email.checkValidity()).toBe(true);
    expect(password.checkValidity()).toBe(false);
  });
});

describe("AuthGate recovery-first experience", () => {
  test("keeps one dominant sign-in action and updates the page context for registration", async () => {
    await act(async () => {
      root.render(<AuthGate />);
    });

    const initialSignInButtons = Array.from(container.querySelectorAll("button"))
      .filter((button) => button.textContent.trim() === "Sign In");
    const createAccount = Array.from(container.querySelectorAll("button"))
      .find((button) => button.textContent.trim() === "Create a staff account");

    expect(initialSignInButtons).toHaveLength(1);
    expect(createAccount).toBeTruthy();

    await act(async () => {
      createAccount.click();
    });

    expect(container.querySelector("h1")?.textContent).toBe("Create Staff Account");
    expect(container.querySelector('input[type="password"]')?.autocomplete).toBe("new-password");
    expect(container.querySelector("#auth-password-help")?.textContent).toContain("8 characters");
  });

  test("focuses the email field and explains recovery when password reset lacks an email", async () => {
    await act(async () => {
      root.render(<AuthGate />);
    });

    const email = container.querySelector('input[type="email"]');
    const reset = Array.from(container.querySelectorAll("button"))
      .find((button) => button.textContent.trim() === "Forgot password?");

    await act(async () => {
      reset.click();
    });

    const error = container.querySelector("#auth-email-error");
    expect(error?.textContent).toBe("Enter your email to reset your password.");
    expect(email.getAttribute("aria-invalid")).toBe("true");
    expect(email.getAttribute("aria-describedby")).toContain("auth-email-error");
    expect(email.labels[0]?.textContent.trim()).toBe("Email");
    expect(document.activeElement).toBe(email);
    expect(mocks.requestPasswordReset).not.toHaveBeenCalled();
  });

  test("lets the operator reveal and conceal the password without changing its value", async () => {
    await act(async () => {
      root.render(<AuthGate />);
    });

    const password = container.querySelector('input[type="password"]');
    await act(async () => {
      enterValue(password, "kitchen-plan-42");
    });
    const reveal = Array.from(container.querySelectorAll("button"))
      .find((button) => button.getAttribute("aria-label") === "Show password");

    await act(async () => {
      reveal.click();
    });

    const visiblePassword = container.querySelector('input[type="text"]');
    expect(visiblePassword.value).toBe("kitchen-plan-42");
    expect(reveal.getAttribute("aria-pressed")).toBe("true");
    expect(reveal.getAttribute("aria-label")).toBe("Hide password");
  });

  test("announces a failed sign-in as an error with a recovery path", async () => {
    mocks.signInWithEmail.mockRejectedValueOnce(
      new Error("Firebase: Error (auth/invalid-credential).")
    );
    await act(async () => {
      root.render(<AuthGate />);
    });

    await act(async () => {
      enterValue(container.querySelector('input[type="email"]'), "operator@example.com");
      enterValue(container.querySelector('input[type="password"]'), "incorrect-password");
    });
    const submit = Array.from(container.querySelectorAll("button"))
      .find((button) => button.textContent.trim() === "Sign In" && button.type === "submit");

    await act(async () => {
      submit.click();
    });

    expect(container.querySelector('[role="alert"]')?.textContent).toContain(
      "Invalid email or password."
    );
    expect(container.querySelector('[role="alert"]')?.textContent).toContain(
      "Check your details or reset your password."
    );
  });
});
