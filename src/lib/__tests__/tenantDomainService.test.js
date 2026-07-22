import { describe, expect, test } from "vitest";
import { getHostType, normalizeHostname } from "../tenantDomainService";

describe("tenant domain classification", () => {
  test("treats the QuotePilot MBMApps hostname as a shared application host", () => {
    expect(getHostType("quotepilot.mbmapps.com")).toBe("app");
    expect(getHostType("https://quotepilot.mbmapps.com/app")).toBe("app");
  });

  test("keeps customer subdomains tenant-scoped", () => {
    expect(getHostType("tasteful-touch.mbmapps.com")).toBe("tenant");
  });

  test("normalizes protocol, route, port, and casing", () => {
    expect(normalizeHostname("HTTPS://QuotePilot.MBMApps.com:443/app")).toBe("quotepilot.mbmapps.com");
  });
});
