import { describe, expect, test, vi } from "vitest";
import {
  inventoryFirestoreDocumentUrl,
  inventoryTenantSettingPatch,
  parseInventoryTenantActivationArgs,
  setInventoryTenant
} from "../../../scripts/set-inventory-tenant.mjs";

function response(body, status = 200) {
  return { ok: status >= 200 && status < 300, status, json: async () => body };
}

describe("inventory tenant activation", () => {
  test("requires exact project, bounded organization, state, and confirmation", () => {
    expect(parseInventoryTenantActivationArgs([
      "--project", "tonicatering", "--organization", "mm05366-sandbox",
      "--enabled", "true", "--confirm", "SET inventory authority true for organization mm05366-sandbox"
    ])).toMatchObject({ projectId: "tonicatering", organizationId: "mm05366-sandbox", enabled: true });
    expect(() => parseInventoryTenantActivationArgs([
      "--project", "other", "--organization", "250", "--enabled", "true",
      "--confirm", "SET inventory authority true for organization 250"
    ])).toThrow(/restricted/u);
    expect(() => parseInventoryTenantActivationArgs([
      "--project", "tonicatering", "--organization", "unapproved-sandbox", "--enabled", "true",
      "--confirm", "SET inventory authority true for organization unapproved-sandbox"
    ])).toThrow(/restricted to organization mm05366-sandbox/u);
    expect(() => parseInventoryTenantActivationArgs([
      "--project", "tonicatering", "--organization", "250", "--enabled", "true",
      "--confirm", "SET inventory authority true for organization 250"
    ])).toThrow(/restricted to organization mm05366-sandbox/u);
  });

  test("patches only the inventory tenant field and verifies readback", async () => {
    const documentUrl = inventoryFirestoreDocumentUrl({ projectId: "tonicatering", organizationId: "mm05366-sandbox" });
    const fetchImpl = vi.fn()
      .mockResolvedValueOnce(response({ fields: { catalogRevision: { integerValue: "4" } } }))
      .mockResolvedValueOnce(response(inventoryTenantSettingPatch(true)))
      .mockResolvedValueOnce(response(inventoryTenantSettingPatch(true)));
    const result = await setInventoryTenant({
      projectId: "tonicatering", organizationId: "mm05366-sandbox", enabled: true,
      accessToken: "bounded-access-token", fetchImpl
    });
    expect(result).toMatchObject({ before: false, after: true, changed: true });
    expect(fetchImpl.mock.calls[1][0]).toBe(
      `${documentUrl}?updateMask.fieldPaths=inventoryAuthorityEnabled&currentDocument.exists=true`
    );
    expect(JSON.parse(fetchImpl.mock.calls[1][1].body)).toEqual(inventoryTenantSettingPatch(true));
  });

  test("does not rewrite an already matching tenant", async () => {
    const fetchImpl = vi.fn()
      .mockResolvedValueOnce(response(inventoryTenantSettingPatch(true)))
      .mockResolvedValueOnce(response(inventoryTenantSettingPatch(true)));
    const result = await setInventoryTenant({
      projectId: "tonicatering", organizationId: "mm05366-sandbox", enabled: true,
      accessToken: "bounded-access-token", fetchImpl
    });
    expect(result.changed).toBe(false);
    expect(fetchImpl).toHaveBeenCalledTimes(2);
  });
});
