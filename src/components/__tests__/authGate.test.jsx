import { describe, expect, test } from "vitest";
import { friendlyError } from "../AuthGate";

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
