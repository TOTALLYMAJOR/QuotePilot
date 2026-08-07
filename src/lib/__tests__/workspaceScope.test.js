import { describe, expect, test } from "vitest";
import { buildAuthenticatedWorkspaceScopeKey } from "../workspaceScope";

function scope({
  loading = false,
  uid = "owner-a",
  organizationId = "org-a",
  role = "admin",
  platformAdmin = false,
  hostOrganizationId = ""
} = {}) {
  return buildAuthenticatedWorkspaceScopeKey({
    tenantContext: {
      hostname: "localhost",
      organizationId: hostOrganizationId
    },
    authSession: {
      loading,
      user: uid ? { uid } : null,
      organizationId,
      role,
      platformAdmin
    }
  });
}

describe("authenticated workspace scope key", () => {
  test("changes for a replacement principal or organization", () => {
    const original = scope();

    expect(scope({ uid: "owner-b" })).not.toBe(original);
    expect(scope({ organizationId: "org-b" })).not.toBe(original);
    expect(scope({ hostOrganizationId: "org-b" })).not.toBe(original);
  });

  test("changes as soon as replacement authority starts resolving", () => {
    expect(scope({ loading: true })).not.toBe(scope({ loading: false }));
  });

  test("changes when role or platform authority changes", () => {
    const original = scope();

    expect(scope({ role: "sales" })).not.toBe(original);
    expect(scope({ platformAdmin: true })).not.toBe(original);
  });

  test("is stable for equivalent normalized scope values", () => {
    expect(scope()).toBe(scope());
  });
});
