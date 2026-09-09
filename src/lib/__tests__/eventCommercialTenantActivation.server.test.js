import { describe, expect, test, vi } from "vitest";
import {
  eventCommercialDocumentUrl,
  eventCommercialPatch,
  parseEventCommercialTenantArgs,
  setEventCommercialTenant
} from "../../../scripts/set-event-commercial-tenant.mjs";

const response = (body, status = 200) => ({
  ok: status >= 200 && status < 300,
  status,
  json: async () => body
});

describe("event and Commercial Change tenant activation", () => {
  test("is restricted to the exact production project, tenant, state, and confirmation", () => {
    expect(parseEventCommercialTenantArgs([
      "--project", "tonicatering", "--organization", "mm05366-sandbox", "--enabled", "true",
      "--confirm", "SET event and commercial authority true for organization mm05366-sandbox"
    ])).toMatchObject({ projectId: "tonicatering", organizationId: "mm05366-sandbox", enabled: true });
    expect(() => parseEventCommercialTenantArgs([
      "--project", "tonicatering", "--organization", "other", "--enabled", "true",
      "--confirm", "SET event and commercial authority true for organization other"
    ])).toThrow(/approved founder-pilot/u);
  });

  test("atomically patches only the coupled event and commercial gates", async () => {
    const documentUrl = eventCommercialDocumentUrl({
      projectId: "tonicatering", organizationId: "mm05366-sandbox"
    });
    const fetchImpl = vi.fn()
      .mockResolvedValueOnce(response({ fields: { catalogRevision: { integerValue: "4" } } }))
      .mockResolvedValueOnce(response(eventCommercialPatch(true)))
      .mockResolvedValueOnce(response(eventCommercialPatch(true)));
    const result = await setEventCommercialTenant({
      projectId: "tonicatering", organizationId: "mm05366-sandbox", enabled: true,
      accessToken: "bounded-access-token", fetchImpl
    });
    expect(result.changed).toBe(true);
    expect(fetchImpl.mock.calls[1][0]).toBe(
      `${documentUrl}?updateMask.fieldPaths=commercialChangeAuthorityEnabled&updateMask.fieldPaths=eventOperatingSpineEnabled&currentDocument.exists=true`
    );
    expect(JSON.parse(fetchImpl.mock.calls[1][1].body)).toEqual(eventCommercialPatch(true));
    expect(JSON.stringify(fetchImpl.mock.calls[1][1])).not.toContain("catalogRevision");
  });
});
