import { describe, expect, test } from "vitest";
import { getHostType } from "../tenantDomainService";

describe("tenant host classification", () => {
  test("treats the canonical QuotePilot domain as the application host", () => {
    expect(getHostType("quotepilot.mbmapps.com")).toBe("app");
  });

  test("keeps customer subdomains tenant-scoped", () => {
    expect(getHostType("customer-one.mbmapps.com")).toBe("tenant");
  });
});
