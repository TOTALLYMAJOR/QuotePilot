import { describe, expect, test, vi } from "vitest";
import {
  firestoreDocumentUrl,
  parseTenantActivationArgs,
  setOperationalStaffingTenant,
  tenantSettingPatch
} from "../../../scripts/set-operational-staffing-tenant.mjs";

function response(body, status = 200) {
  return { ok: status >= 200 && status < 300, status, json: async () => body };
}

describe("operational staffing tenant activation", () => {
  test("requires exact project, bounded organization, state, and confirmation", () => {
    expect(parseTenantActivationArgs([
      "--project", "tonicatering",
      "--organization", "250",
      "--enabled", "true",
      "--confirm", "SET operational staffing true for organization 250"
    ])).toMatchObject({ projectId: "tonicatering", organizationId: "250", enabled: true });
    expect(() => parseTenantActivationArgs([
      "--project", "other",
      "--organization", "250",
      "--enabled", "true",
      "--confirm", "SET operational staffing true for organization 250"
    ])).toThrow(/restricted/u);
    expect(() => parseTenantActivationArgs([
      "--project", "tonicatering",
      "--organization", "250",
      "--enabled", "true",
      "--confirm", "yes"
    ])).toThrow(/requires --confirm/u);
  });

  test("patches only the named tenant field and verifies readback", async () => {
    const documentUrl = firestoreDocumentUrl({ projectId: "tonicatering", organizationId: "250" });
    const fetchImpl = vi.fn()
      .mockResolvedValueOnce(response({ access_token: "bounded-access-token" }))
      .mockResolvedValueOnce(response({ fields: { catalogRevision: { integerValue: "4" } } }))
      .mockResolvedValueOnce(response(tenantSettingPatch(true)))
      .mockResolvedValueOnce(response(tenantSettingPatch(true)));

    const result = await setOperationalStaffingTenant({
      projectId: "tonicatering",
      organizationId: "250",
      enabled: true,
      firebaseToken: "refresh-token",
      fetchImpl
    });

    expect(result).toMatchObject({ before: false, after: true, changed: true });
    expect(fetchImpl.mock.calls[2][0]).toBe(
      `${documentUrl}?updateMask.fieldPaths=operationalStaffingAuthorityEnabled`
    );
    const patch = fetchImpl.mock.calls[2][1];
    expect(patch.method).toBe("PATCH");
    expect(JSON.parse(patch.body)).toEqual(tenantSettingPatch(true));
    expect(JSON.stringify(patch)).not.toContain("catalogRevision");
  });

  test("does not rewrite a tenant already in the requested state", async () => {
    const fetchImpl = vi.fn()
      .mockResolvedValueOnce(response({ access_token: "bounded-access-token" }))
      .mockResolvedValueOnce(response(tenantSettingPatch(false)))
      .mockResolvedValueOnce(response(tenantSettingPatch(false)));
    const result = await setOperationalStaffingTenant({
      projectId: "tonicatering",
      organizationId: "250",
      enabled: false,
      firebaseToken: "refresh-token",
      fetchImpl
    });
    expect(result.changed).toBe(false);
    expect(fetchImpl).toHaveBeenCalledTimes(3);
  });
});
