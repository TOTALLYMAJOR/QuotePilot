import { createRequire } from "node:module";

import { describe, expect, test } from "vitest";

const require = createRequire(import.meta.url);
const {
  ORGANIZATION_OWNER_INVITE_PURPOSE,
  OrganizationAuthorityError,
  normalizeInvitePurpose,
  planOrganizationOwnerBinding
} = require("../../../functions/organizationAuthority.js");

const NOW = "2026-08-13T05:00:00.000Z";

function input(overrides = {}) {
  return {
    invite: {
      purpose: ORGANIZATION_OWNER_INVITE_PURPOSE,
      role: "admin",
      organizationId: "org-a",
      email: "owner@example.com"
    },
    organization: {
      ownerEmail: "owner@example.com",
      ownerUid: ""
    },
    organizationId: "org-a",
    uid: "owner-uid",
    email: "owner@example.com",
    nowISO: NOW,
    ...overrides
  };
}

describe("organization owner authority", () => {
  test("treats only an explicit organization_owner purpose as ownership authority", () => {
    expect(normalizeInvitePurpose(" organization_owner ")).toBe("organization_owner");
    expect(normalizeInvitePurpose("admin")).toBe("");
    expect(planOrganizationOwnerBinding(input({
      invite: { role: "admin", organizationId: "org-a", email: "owner@example.com" }
    }))).toEqual({ required: false });
  });

  test("builds an immutable owner receipt and organization patch from exact evidence", () => {
    expect(planOrganizationOwnerBinding(input())).toEqual({
      required: true,
      organizationPatch: {
        ownerUid: "owner-uid",
        ownerBoundAtISO: NOW,
        ownerBindingSource: "organization_owner"
      },
      receipt: {
        schemaVersion: 1,
        organizationId: "org-a",
        ownerUid: "owner-uid",
        ownerEmail: "owner@example.com",
        invitePurpose: "organization_owner",
        boundAtISO: NOW
      }
    });
  });

  test.each([
    ["non-admin invite", { invite: { purpose: "organization_owner", role: "sales", organizationId: "org-a", email: "owner@example.com" } }],
    ["cross-tenant invite", { invite: { purpose: "organization_owner", role: "admin", organizationId: "org-b", email: "owner@example.com" } }],
    ["email mismatch", { email: "attacker@example.com" }],
    ["organization owner mismatch", { organization: { ownerEmail: "different@example.com", ownerUid: "" } }],
    ["existing different owner", { organization: { ownerEmail: "owner@example.com", ownerUid: "other-uid" } }]
  ])("fails closed for %s", (_label, overrides) => {
    expect(() => planOrganizationOwnerBinding(input(overrides))).toThrow(OrganizationAuthorityError);
  });
});
