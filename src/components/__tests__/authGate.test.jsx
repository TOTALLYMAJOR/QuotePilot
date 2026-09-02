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
      "Invalid email or password."
    );
  });

  test("maps too-many-requests errors", () => {
    expect(friendlyError(new Error("Firebase: Error (auth/too-many-requests)."))).toBe(
      "Too many attempts. Wait a few minutes and try again."
    );
  });

  test("maps google popup closed errors", () => {
    expect(friendlyError(new Error("Firebase: Error (auth/popup-closed-by-user)."))).toBe(
      "Google sign-in popup was closed."
    );
  });

  test("maps email already in use errors", () => {
    expect(friendlyError(new Error("Firebase: Error (auth/email-already-in-use)."))).toBe(
      "This email is already registered."
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
  test("keeps an empty sign-in local, explains both missing fields, and focuses email", async () => {
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
    expect(email.getAttribute("aria-invalid")).toBe("true");
    expect(password.getAttribute("aria-invalid")).toBe("true");
    expect(container.textContent).toContain("Enter your email address.");
    expect(container.textContent).toContain("Enter your password.");
    expect(document.activeElement).toBe(email);
  });

  test("focuses password when email is present and password is missing", async () => {
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
    expect(email.getAttribute("aria-invalid")).toBe("false");
    expect(password.getAttribute("aria-invalid")).toBe("true");
    expect(document.activeElement).toBe(password);
  });
});
