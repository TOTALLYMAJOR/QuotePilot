import { describe, expect, test } from "vitest";
import { parseOrganizationOwnerBackfillArgs } from "../../../scripts/backfill-organization-owner.mjs";
import { planOrganizationOwnerBackfill } from "../../../scripts/organization-owner-backfill-plan.mjs";

const nowISO = "2026-08-13T00:00:00.000Z";

function validEvidence(overrides = {}) {
  return {
    organizationId: "org-1",
    organization: { ownerEmail: "owner@example.com", ownerUid: "", status: "active" },
    invites: [{
      id: "owner-example-com",
      data: {
        organizationId: "org-1",
        orderId: "order-1",
        email: "owner@example.com",
        role: "admin",
        status: "consumed",
        consumedByUid: "uid-owner",
        consumedByEmail: "owner@example.com"
      }
    }],
    orders: [{ id: "order-1", data: { organizationId: "org-1", ownerEmail: "owner@example.com", ownerUid: "" } }],
    roles: [{ id: "uid-owner", data: { organizationId: "org-1", email: "owner@example.com", role: "admin" } }],
    authUsers: [{ uid: "uid-owner", email: "owner@example.com", emailVerified: true }],
    receipt: null,
    nowISO,
    ...overrides
  };
}

describe("organization owner backfill", () => {
  test("binds exactly one legacy consumed owner invitation", () => {
    const plan = planOrganizationOwnerBackfill(validEvidence());
    expect(plan.state).toBe("bind");
    expect(plan.ownerUid).toBe("uid-owner");
    expect(plan.receipt).toMatchObject({
      organizationId: "org-1",
      ownerUid: "uid-owner",
      invitePurpose: "legacy_unmarked_owner_invite",
      bindingSource: "consumed_owner_invite_backfill"
    });
  });

  test.each([
    ["zero candidates", { invites: [] }, "consumed_owner_invite_missing"],
    ["conflicting owner", { organization: { ownerEmail: "owner@example.com", ownerUid: "another" } }, "organization_owner_conflict"],
    ["unverified email", { authUsers: [{ uid: "uid-owner", email: "owner@example.com", emailVerified: false }] }, "auth_email_unverified"],
    ["non-owner purpose", { invites: [{ ...validEvidence().invites[0], data: { ...validEvidence().invites[0].data, purpose: "buyer_access" } }] }, "invite_purpose_conflict"]
  ])("fails closed for %s", (_label, overrides, reason) => {
    const plan = planOrganizationOwnerBackfill(validEvidence(overrides));
    expect(plan.state).toBe("ownership_required");
    expect(plan.reasons).toContain(reason);
  });

  test("fails closed for multiple consumed owner candidates", () => {
    const plan = planOrganizationOwnerBackfill(validEvidence({
      invites: [...validEvidence().invites, { ...validEvidence().invites[0], id: "second" }]
    }));
    expect(plan.state).toBe("ownership_required");
    expect(plan.reasons).toContain("multiple_consumed_owner_invites");
  });

  test("treats an exact completed binding as current", () => {
    const source = validEvidence({
      organization: { ownerEmail: "owner@example.com", ownerUid: "uid-owner", status: "active" },
      orders: [{ id: "order-1", data: { organizationId: "org-1", ownerEmail: "owner@example.com", ownerUid: "uid-owner" } }]
    });
    const expected = planOrganizationOwnerBackfill(source);
    const plan = planOrganizationOwnerBackfill({ ...source, receipt: expected.receipt });
    expect(plan.state).toBe("already_current");
  });

  test("requires an exact apply confirmation including the expected UID", () => {
    expect(() => parseOrganizationOwnerBackfillArgs([
      "--project", "project-1",
      "--organization", "org-1",
      "--apply",
      "--expected-owner-uid", "uid-owner",
      "--confirm", "wrong"
    ])).toThrow(/Apply requires/);
    expect(parseOrganizationOwnerBackfillArgs([
      "--project", "project-1",
      "--organization", "org-1",
      "--apply",
      "--expected-owner-uid", "uid-owner",
      "--confirm", "BIND ORGANIZATION OWNER project-1 org-1 uid-owner"
    ])).toMatchObject({ dryRun: false, expectedOwnerUid: "uid-owner" });
  });
});
