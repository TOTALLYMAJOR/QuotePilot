import { afterEach, beforeEach, describe, expect, test, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  auth: {
    currentUser: null
  },
  fetch: vi.fn()
}));

vi.mock("../firebase", () => ({
  auth: mocks.auth,
  firebaseReady: true
}));

import {
  completeFirebaseEmailVerification,
  parseFirebaseEmailVerificationAction
} from "../firebaseEmailAction";

function actionUrl(overrides = {}) {
  const params = new URLSearchParams({
    apiKey: "staging-api-key",
    mode: "verifyEmail",
    oobCode: "one-time-code",
    continueUrl: "https://quotepilot-staging-20260804.web.app/app",
    ...overrides
  });
  return `https://quotepilot-staging-20260804.web.app/app/auth/action?${params}`;
}

describe("Firebase email verification action", () => {
  beforeEach(() => {
    mocks.auth.currentUser = null;
    mocks.fetch.mockReset().mockResolvedValue({
      ok: true,
      status: 200,
      json: vi.fn().mockResolvedValue({ emailVerified: true })
    });
    vi.stubGlobal("fetch", mocks.fetch);
    vi.stubEnv("VITE_FIREBASE_API_KEY", "staging-api-key");
  });

  afterEach(() => {
    vi.unstubAllGlobals();
    vi.unstubAllEnvs();
  });

  test("parses the exact staging verification route and approved continuation", () => {
    expect(parseFirebaseEmailVerificationAction(actionUrl())).toEqual({
      apiKey: "staging-api-key",
      continueUrl: "https://quotepilot-staging-20260804.web.app/app",
      oobCode: "one-time-code"
    });
  });

  test("rejects a missing or wrong action mode before provider use", () => {
    expect(() => parseFirebaseEmailVerificationAction(actionUrl({ mode: "resetPassword" })))
      .toThrow();
  });

  test("rejects a lookalike continuation before provider use", () => {
    expect(() => parseFirebaseEmailVerificationAction(actionUrl({
      continueUrl: "https://quotepilot-staging-20260804.web.app.evil.example/app"
    }))).toThrow();
  });

  test("uses Firebase's verify-email endpoint and requires its verified receipt", async () => {
    const action = parseFirebaseEmailVerificationAction(actionUrl());
    await expect(completeFirebaseEmailVerification(action)).resolves.toEqual({
      continueUrl: "https://quotepilot-staging-20260804.web.app/app"
    });
    expect(mocks.fetch).toHaveBeenCalledOnce();
    expect(mocks.fetch).toHaveBeenCalledWith(expect.stringContaining("accounts:update"), expect.any(Object));
  });

  test("rejects a different Firebase project key before checking the code", async () => {
    const action = parseFirebaseEmailVerificationAction(actionUrl({ apiKey: "other-project-key" }));
    await expect(completeFirebaseEmailVerification(action)).rejects.toMatchObject({ kind: "malformed" });
    expect(mocks.fetch).not.toHaveBeenCalled();
  });

  test("preserves an interrupted provider response as uncertain", async () => {
    mocks.fetch.mockReset().mockRejectedValueOnce(new TypeError("network unavailable"));
    const action = parseFirebaseEmailVerificationAction(actionUrl());
    await expect(completeFirebaseEmailVerification(action)).rejects.toMatchObject({ kind: "uncertain" });
  });

});
