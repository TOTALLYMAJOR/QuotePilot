import { afterEach, beforeEach, describe, expect, test, vi } from "vitest";

const authMocks = vi.hoisted(() => ({
  auth: { name: "test-auth", currentUser: null },
  createUserWithEmailAndPassword: vi.fn(),
  reauthenticateWithCredential: vi.fn(),
  reauthenticateWithPopup: vi.fn(),
  sendEmailVerification: vi.fn(),
  sendPasswordResetEmail: vi.fn()
}));

vi.mock("firebase/auth", () => ({
  EmailAuthProvider: class EmailAuthProvider {
    static credential(email, password) {
      return { email, password, providerId: "password" };
    }
  },
  GoogleAuthProvider: class GoogleAuthProvider {
    setCustomParameters(parameters) {
      this.parameters = parameters;
    }
  },
  createUserWithEmailAndPassword: authMocks.createUserWithEmailAndPassword,
  sendEmailVerification: authMocks.sendEmailVerification,
  sendPasswordResetEmail: authMocks.sendPasswordResetEmail,
  reauthenticateWithCredential: authMocks.reauthenticateWithCredential,
  reauthenticateWithPopup: authMocks.reauthenticateWithPopup,
  signInWithEmailAndPassword: vi.fn(),
  signInWithPopup: vi.fn(),
  signOut: vi.fn()
}));

vi.mock("../firebase", () => ({
  auth: authMocks.auth,
  firebaseReady: true
}));

import {
  getCurrentUserReauthenticationMethods,
  getCurrentUserRecentAuthState,
  reauthenticateCurrentUser,
  refreshCurrentUserAccess,
  registerWithEmail,
  requestPasswordReset,
  resendCurrentUserVerification
} from "../authClient";

describe("Firebase email actions", () => {
  beforeEach(() => {
    authMocks.auth.currentUser = null;
    authMocks.createUserWithEmailAndPassword.mockReset();
    authMocks.sendEmailVerification.mockReset();
    authMocks.sendPasswordResetEmail.mockReset();
    authMocks.reauthenticateWithCredential.mockReset();
    authMocks.reauthenticateWithPopup.mockReset();
    vi.stubGlobal("window", {
      location: { origin: "http://127.0.0.1:4174" }
    });
    vi.stubEnv("VITE_APP_URL", "");
  });

  afterEach(() => {
    vi.unstubAllGlobals();
    vi.unstubAllEnvs();
  });

  test("binds registration verification to the validated exact /app continue URL", async () => {
    const user = { uid: "buyer-owner", emailVerified: false };
    authMocks.createUserWithEmailAndPassword.mockResolvedValueOnce({ user });

    await expect(registerWithEmail({
      email: "  OWNER@Example.COM ",
      password: "Passw0rd!"
    })).resolves.toEqual({
      email: "owner@example.com",
      verificationSent: true
    });

    expect(authMocks.createUserWithEmailAndPassword).toHaveBeenCalledWith(
      authMocks.auth,
      "owner@example.com",
      "Passw0rd!"
    );
    expect(authMocks.sendEmailVerification).toHaveBeenCalledWith(user, {
      url: "http://127.0.0.1:4174/app",
      handleCodeInApp: false
    });
  });

  test("binds verification resend to the same validated exact /app continue URL", async () => {
    const user = { uid: "buyer-owner", emailVerified: false };
    authMocks.auth.currentUser = user;

    await expect(resendCurrentUserVerification()).resolves.toEqual({
      verificationSent: true
    });

    expect(authMocks.sendEmailVerification).toHaveBeenCalledWith(user, {
      url: "http://127.0.0.1:4174/app",
      handleCodeInApp: false
    });
  });

  test("forces a fresh user record and token when refreshing verified workspace access", async () => {
    const user = {
      uid: "buyer-owner",
      emailVerified: true,
      reload: vi.fn().mockResolvedValue(undefined),
      getIdToken: vi.fn().mockResolvedValue("fresh-token")
    };
    authMocks.auth.currentUser = user;

    await expect(refreshCurrentUserAccess()).resolves.toEqual({
      refreshed: true,
      emailVerified: true
    });

    expect(user.reload).toHaveBeenCalledOnce();
    expect(user.getIdToken).toHaveBeenCalledWith(true);
  });

  test("requires a signed-in user before refreshing workspace access", async () => {
    await expect(refreshCurrentUserAccess()).rejects.toThrow(/sign in/i);
  });

  test("reauthenticates password accounts and refreshes the five-minute proof", async () => {
    const authTime = new Date(Date.now() - 2_000).toISOString();
    const user = {
      email: "owner@example.com",
      providerData: [{ providerId: "password" }],
      getIdToken: vi.fn().mockResolvedValue("fresh-token"),
      getIdTokenResult: vi.fn().mockResolvedValue({ authTime })
    };
    authMocks.auth.currentUser = user;

    await expect(reauthenticateCurrentUser({
      method: "password",
      password: "correct horse battery staple"
    })).resolves.toMatchObject({ recent: true, maxAgeSeconds: 300 });

    expect(authMocks.reauthenticateWithCredential).toHaveBeenCalledWith(user, {
      email: "owner@example.com",
      password: "correct horse battery staple",
      providerId: "password"
    });
    expect(user.getIdToken).toHaveBeenCalledWith(true);
    expect(user.getIdTokenResult).toHaveBeenCalledWith(true);
  });

  test("fails closed for unsupported reauthentication providers", async () => {
    authMocks.auth.currentUser = {
      email: "owner@example.com",
      providerData: [{ providerId: "github.com" }]
    };
    expect(getCurrentUserReauthenticationMethods()).toEqual([]);
    await expect(reauthenticateCurrentUser({ method: "github" }))
      .rejects.toThrow(/cannot confirm/i);
  });

  test("reports stale token authentication without treating it as recent", async () => {
    authMocks.auth.currentUser = {
      getIdTokenResult: vi.fn().mockResolvedValue({
        authTime: new Date(Date.now() - 301_000).toISOString()
      })
    };
    await expect(getCurrentUserRecentAuthState()).resolves.toMatchObject({
      recent: false,
      maxAgeSeconds: 300
    });
  });

  test("rejects an unsafe verification return before creating an account or sending email", async () => {
    vi.stubEnv("VITE_APP_URL", "http://untrusted.example/app");

    await expect(registerWithEmail({
      email: "owner@example.com",
      password: "Passw0rd!"
    })).rejects.toThrow("approved HTTPS /app location");

    expect(authMocks.createUserWithEmailAndPassword).not.toHaveBeenCalled();
    expect(authMocks.sendEmailVerification).not.toHaveBeenCalled();
  });

  test("rejects an unsafe verification return before a resend", async () => {
    authMocks.auth.currentUser = { uid: "buyer-owner", emailVerified: false };
    vi.stubEnv("VITE_APP_URL", "http://untrusted.example/app");

    await expect(resendCurrentUserVerification())
      .rejects.toThrow("approved HTTPS /app location");
    expect(authMocks.sendEmailVerification).not.toHaveBeenCalled();
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
    vi.stubEnv("VITE_APP_URL", "http://untrusted.example/app");

    await expect(requestPasswordReset({ email: "owner@example.com" }))
      .rejects.toThrow("approved HTTPS /app location");
    expect(authMocks.sendPasswordResetEmail).not.toHaveBeenCalled();
  });

  test("rejects an HTTPS continue URL on a non-QuotePilot host", async () => {
    vi.stubEnv("VITE_APP_URL", "https://evil.example/app");

    await expect(requestPasswordReset({ email: "owner@example.com" }))
      .rejects.toThrow("approved HTTPS /app location");
    expect(authMocks.sendPasswordResetEmail).not.toHaveBeenCalled();
  });

  test("accepts the canonical QuotePilot HTTPS continue URL", async () => {
    vi.stubEnv("VITE_APP_URL", "https://quotepilot.mbmapps.com/app");

    await requestPasswordReset({ email: "owner@example.com" });

    expect(authMocks.sendPasswordResetEmail).toHaveBeenCalledWith(
      authMocks.auth,
      "owner@example.com",
      {
        url: "https://quotepilot.mbmapps.com/app",
        handleCodeInApp: false
      }
    );
  });

  test("accepts the fixed isolated QuotePilot staging /app continue URL", async () => {
    vi.stubEnv("VITE_APP_URL", "https://quotepilot-staging-20260804.web.app/app");

    await requestPasswordReset({ email: "owner@example.com" });

    expect(authMocks.sendPasswordResetEmail).toHaveBeenCalledWith(
      authMocks.auth,
      "owner@example.com",
      {
        url: "https://quotepilot-staging-20260804.web.app/app",
        handleCodeInApp: false
      }
    );
  });

  test("rejects lookalike QuotePilot staging hosts", async () => {
    vi.stubEnv("VITE_APP_URL", "https://quotepilot-staging-20260804.web.app.evil.example/app");

    await expect(requestPasswordReset({ email: "owner@example.com" }))
      .rejects.toThrow("approved HTTPS /app location");
    expect(authMocks.sendPasswordResetEmail).not.toHaveBeenCalled();
  });

  test("uses the canonical custom-domain URL from the Firebase Hosting fallback", async () => {
    vi.stubGlobal("window", {
      location: { origin: "https://tonicatering.web.app" }
    });

    await requestPasswordReset({ email: "owner@example.com" });

    expect(authMocks.sendPasswordResetEmail).toHaveBeenCalledWith(
      authMocks.auth,
      "owner@example.com",
      {
        url: "https://quotepilot.mbmapps.com/app",
        handleCodeInApp: false
      }
    );
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
