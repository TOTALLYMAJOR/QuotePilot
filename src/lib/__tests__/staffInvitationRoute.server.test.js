import fs from "node:fs";
import { describe, expect, test } from "vitest";

const source = fs.readFileSync(new URL("../../main.jsx", import.meta.url), "utf8");

describe("staff invitation public route", () => {
  test("requires the exact response path and non-empty bearer while preserving portal precedence", () => {
    expect(source).toContain('normalizedPath === "/staffing/respond"');
    expect(source).toContain('searchParams.get("staffing")');
    expect(source).toContain("const isStaffInvitationRoute = !isPortalRoute");
    expect(source.indexOf("isStaffInvitationRoute ?")).toBeGreaterThan(source.indexOf("createRoot("));
    expect(source).toContain("component={StaffInvitationResponsePage}");
  });
});
