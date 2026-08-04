import { afterEach, beforeEach, describe, expect, test, vi } from "vitest";

const authMocks = vi.hoisted(() => ({
  auth: { name: "test-auth" },
  sendPasswordResetEmail: vi.fn()
}));

vi.mock("firebase/auth", () => ({
  GoogleAuthProvider: class GoogleAuthProvider {},
  createUserWithEmailAndPassword: vi.fn(),
  sendEmailVerification: vi.fn(),
  sendPasswordResetEmail: authMocks.sendPasswordResetEmail,
  signInWithEmailAndPassword: vi.fn(),
  signInWithPopup: vi.fn(),
  signOut: vi.fn()
}));

vi.mock("../firebase", () => ({
  auth: authMocks.auth,
  firebaseReady: true
}));

import { requestPasswordReset } from "../authClient";

describe("password recovery", () => {
  beforeEach(() => {
    authMocks.sendPasswordResetEmail.mockReset();
    vi.stubGlobal("window", {
      location: { origin: "http://127.0.0.1:4174" }
    });
  });

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  test("normalizes the email before requesting a Firebase reset", async () => {
    await expect(requestPasswordReset({
      email: "  OWNER@Example.COM "
    })).resolves.toEqual({ requestAccepted: true });

    expect(authMocks.sendPasswordResetEmail).toHaveBeenCalledWith(
      authMocks.auth,
      "owner@example.com",
      {
        url: "http://127.0.0.1:4174/app",
        handleCodeInApp: false
      }
    );
  });

  test("requires an email without contacting Firebase", async () => {
    await expect(requestPasswordReset({ email: "  " }))
      .rejects.toThrow("Email is required.");
    expect(authMocks.sendPasswordResetEmail).not.toHaveBeenCalled();
  });

  test("rejects a non-local HTTP continue origin before contacting Firebase", async () => {
    vi.stubGlobal("window", {
      location: { origin: "http://untrusted.example" }
    });

    await expect(requestPasswordReset({ email: "owner@example.com" }))
      .rejects.toThrow("approved HTTPS /app location");
    expect(authMocks.sendPasswordResetEmail).not.toHaveBeenCalled();
  });

  test("accepts an IPv6 loopback continue origin for local development", async () => {
    vi.stubGlobal("window", {
      location: { origin: "http://[::1]:4174" }
    });

    await requestPasswordReset({ email: "owner@example.com" });

    expect(authMocks.sendPasswordResetEmail).toHaveBeenCalledWith(
      authMocks.auth,
      "owner@example.com",
      {
        url: "http://[::1]:4174/app",
        handleCodeInApp: false
      }
    );
  });

  test.each(["auth/user-not-found", "auth/user-disabled"])(
    "returns the same accepted result for the account-state error %s",
    async (code) => {
      authMocks.sendPasswordResetEmail.mockRejectedValueOnce(
        Object.assign(new Error(code), { code })
      );

      await expect(requestPasswordReset({ email: "owner@example.com" }))
        .resolves.toEqual({ requestAccepted: true });
    }
  );

  test("preserves operational failures so the UI does not claim an email was sent", async () => {
    const failure = Object.assign(new Error("Network unavailable"), {
      code: "auth/network-request-failed"
    });
    authMocks.sendPasswordResetEmail.mockRejectedValueOnce(failure);

    await expect(requestPasswordReset({ email: "owner@example.com" }))
      .rejects.toBe(failure);
  });
});
