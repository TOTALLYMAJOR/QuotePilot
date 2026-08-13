import { createRequire } from "node:module";

import { describe, expect, test } from "vitest";

const require = createRequire(import.meta.url);
const {
  OrganizationRoleAuthorityError,
  assertRecentAuthentication,
  assertRoleAuthorityAppCheck,
  normalizeOrganizationRoleMutationRequest,
  planOrganizationRoleMutation
} = require("../../../functions/organizationRoleAuthority.js");

const NOW = "2026-08-13T06:30:00.000Z";

function request(overrides = {}) {
  return {
    requestId: "role-authority-request-0001",
    targetEmail: "staff@example.com",
    expectedCurrentRole: "sales",
    nextRole: "admin",
    ...overrides
  };
}

function input(overrides = {}) {
  return {
    actor: {
      uid: "owner-uid",
      email: "owner@example.com",
      role: "admin",
      organizationId: "org-a"
    },
    organization: { ownerUid: "owner-uid" },
    organizationId: "org-a",
    request: request(),
    target: {
      uid: "staff-uid",
      email: "staff@example.com",
      emailVerified: true,
      disabled: false,
      role: "sales",
      organizationId: "org-a"
    },
    nowISO: NOW,
    ...overrides
  };
}

describe("organization role authority", () => {
  test("accepts only the exact mutation schema", () => {
    expect(normalizeOrganizationRoleMutationRequest(request())).toEqual(request());
    expect(() => normalizeOrganizationRoleMutationRequest({
      ...request(),
      organizationId: "forged-org"
    })).toThrow(OrganizationRoleAuthorityError);
  });

  test("lets the canonical owner promote a same-tenant verified sales user to admin", () => {
    expect(planOrganizationRoleMutation(input())).toEqual({
      requestId: "role-authority-request-0001",
      organizationId: "org-a",
      actorIsOwner: true,
      targetUid: "staff-uid",
      targetEmail: "staff@example.com",
      previousRole: "sales",
      nextRole: "admin",
      nextRoleDocument: {
        role: "admin",
        organizationId: "org-a",
        email: "staff@example.com"
      },
      receipt: {
        schemaVersion: 1,
        requestId: "role-authority-request-0001",
        organizationId: "org-a",
        actorUid: "owner-uid",
        actorEmail: "owner@example.com",
        actorWasOwner: true,
        targetUid: "staff-uid",
        targetEmail: "staff@example.com",
        previousRole: "sales",
        nextRole: "admin",
        changedAtISO: NOW
      }
    });
  });

  test("lets an admin manage sales but not admin authority", () => {
    const adminActor = {
      uid: "admin-uid",
      email: "admin@example.com",
      role: "admin",
      organizationId: "org-a"
    };
    expect(planOrganizationRoleMutation(input({
      actor: adminActor,
      request: request({ expectedCurrentRole: "none", nextRole: "sales" }),
      target: { ...input().target, role: "none", organizationId: "" }
    })).nextRole).toBe("sales");
    expect(() => planOrganizationRoleMutation(input({ actor: adminActor })))
      .toThrow(/only the canonical organization owner/i);
  });

  test.each([
    ["owner demotion", {
      request: request({ targetEmail: "owner@example.com", expectedCurrentRole: "admin", nextRole: "sales" }),
      target: { uid: "owner-uid", email: "owner@example.com", emailVerified: true, disabled: false, role: "admin", organizationId: "org-a" }
    }],
    ["cross-tenant target", { target: { ...input().target, organizationId: "org-b" } }],
    ["unverified target", { target: { ...input().target, emailVerified: false } }],
    ["stale expected role", { request: request({ expectedCurrentRole: "none" }) }]
  ])("fails closed for %s", (_label, overrides) => {
    expect(() => planOrganizationRoleMutation(input(overrides)))
      .toThrow(OrganizationRoleAuthorityError);
  });

  test("requires authentication within five minutes", () => {
    const nowMs = Date.parse(NOW);
    expect(assertRecentAuthentication({
      authTimeSeconds: (nowMs / 1000) - 299,
      nowMs
    }).ageSeconds).toBe(299);
    expect(() => assertRecentAuthentication({
      authTimeSeconds: (nowMs / 1000) - 301,
      nowMs
    })).toThrow(/no longer recent/i);
  });

  test("distinguishes App Check monitoring, enforcement, and replay rejection", () => {
    expect(assertRoleAuthorityAppCheck()).toEqual({
      state: "unavailable",
      appId: "",
      replayProtection: "monitor"
    });
    expect(assertRoleAuthorityAppCheck({
      app: { appId: "1:demo:web:app" },
      enforced: true,
      consumeToken: true
    })).toEqual({
      state: "verified",
      appId: "1:demo:web:app",
      replayProtection: "consumed"
    });
    expect(() => assertRoleAuthorityAppCheck({ enforced: true }))
      .toThrow(/app verification is required/i);
    expect(() => assertRoleAuthorityAppCheck({
      app: { appId: "1:demo:web:app", alreadyConsumed: true },
      enforced: true,
      consumeToken: true
    })).toThrow(/already used/i);
  });
});
