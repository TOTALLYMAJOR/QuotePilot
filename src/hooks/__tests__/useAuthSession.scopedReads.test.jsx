// @vitest-environment jsdom

import React, { act } from "react";
import { createRoot } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, test, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  authListener: null,
  bootstrap: vi.fn(),
  clearTenantContextCache: vi.fn(),
  signOutCurrentUser: vi.fn(),
  stopAuthListener: vi.fn()
}));

vi.mock("firebase/auth", () => ({
  onAuthStateChanged: vi.fn((_auth, listener) => {
    mocks.authListener = listener;
    return mocks.stopAuthListener;
  })
}));

vi.mock("firebase/functions", () => ({
  httpsCallable: vi.fn(() => mocks.bootstrap)
}));

vi.mock("firebase/firestore", () => ({
  doc: vi.fn(),
  getDoc: vi.fn()
}));

vi.mock("../../lib/authClient", () => ({
  refreshCurrentUserAccess: vi.fn(),
  refreshCurrentUserVerification: vi.fn(),
  resendCurrentUserVerification: vi.fn(),
  signOutCurrentUser: mocks.signOutCurrentUser
}));

vi.mock("../../lib/firebase", () => ({
  auth: {},
  cloudFunctions: {},
  db: {},
  firebaseReady: true
}));

vi.mock("../../lib/organizationService", () => ({
  resolveOrganizationId: (value, fallback = "") => String(value || fallback).trim()
}));

vi.mock("../../lib/sessionDiagnostics", () => ({
  recordDiagnosticError: vi.fn(),
  recordDiagnosticEvent: vi.fn()
}));

vi.mock("../../lib/tenantDomainService", () => ({
  clearTenantContextCache: mocks.clearTenantContextCache
}));

import { useAuthSession } from "../useAuthSession";
import {
  clearScopedReads,
  coalesceScopedRead,
  scopedReadCount
} from "../../lib/scopedReadCoalescer";

globalThis.IS_REACT_ACT_ENVIRONMENT = true;

function authenticatedUser(uid, organizationId) {
  return {
    uid,
    emailVerified: true,
    getIdTokenResult: vi.fn().mockResolvedValue({ claims: { organizationId } })
  };
}

function holdScopedRead(organizationId, principalId) {
  return coalesceScopedRead({
    organizationId,
    principalId,
    operation: "test.pending",
    arguments: {},
    read: () => new Promise(() => {})
  });
}

describe("useAuthSession scoped read eviction", () => {
  let container;
  let root;
  let latest;

  function Harness() {
    latest = useAuthSession();
    return null;
  }

  beforeEach(async () => {
    vi.clearAllMocks();
    clearScopedReads();
    mocks.authListener = null;
    mocks.bootstrap.mockResolvedValue({
      data: { role: "admin", organizationId: "org-a", platformAdmin: false }
    });
    mocks.signOutCurrentUser.mockResolvedValue(undefined);
    container = document.createElement("div");
    document.body.appendChild(container);
    root = createRoot(container);
    await act(async () => root.render(<Harness />));
  });

  afterEach(() => {
    act(() => root.unmount());
    container.remove();
    clearScopedReads();
  });

  test("evicts only the previous tenant and principal scope when auth identity changes", async () => {
    await act(async () => {
      await mocks.authListener(authenticatedUser("user-a", "org-a"));
    });
    expect(latest).toMatchObject({ organizationId: "org-a", user: { uid: "user-a" } });

    holdScopedRead("org-a", "user-a");
    holdScopedRead("org-unrelated", "user-unrelated");
    expect(scopedReadCount()).toBe(2);

    mocks.bootstrap.mockResolvedValueOnce({
      data: { role: "admin", organizationId: "org-b", platformAdmin: false }
    });
    await act(async () => {
      await mocks.authListener(authenticatedUser("user-b", "org-b"));
    });

    expect(latest).toMatchObject({ organizationId: "org-b", user: { uid: "user-b" } });
    expect(scopedReadCount()).toBe(1);
  });

  test("clears all in-flight reads before signing out", async () => {
    holdScopedRead("org-a", "user-a");
    holdScopedRead("org-b", "user-b");
    expect(scopedReadCount()).toBe(2);

    await act(async () => latest.signOut());

    expect(scopedReadCount()).toBe(0);
    expect(mocks.clearTenantContextCache).toHaveBeenCalledTimes(1);
    expect(mocks.signOutCurrentUser).toHaveBeenCalledTimes(1);
  });
});
