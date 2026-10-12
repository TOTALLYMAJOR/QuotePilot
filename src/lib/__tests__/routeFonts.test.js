// @vitest-environment jsdom
import { afterEach, describe, expect, test } from "vitest";
import { ensureRouteFonts } from "../routeFonts";

afterEach(() => {
  document.head.querySelectorAll("[data-quotepilot-route-fonts]").forEach((node) => node.remove());
});

describe("route font profiles", () => {
  test("loads only the landing families and weights on the public homepage", () => {
    const link = ensureRouteFonts("marketing");

    expect(link.rel).toBe("stylesheet");
    expect(link.href).toContain("family=Bodoni+Moda:opsz,wght@6..96,500;6..96,700");
    expect(link.href).toContain("family=DM+Mono:wght@400;500");
    expect(link.href).toContain("family=Manrope:wght@400;500;600;700");
    expect(link.href).not.toContain("family=Inter");
  });

  test("reuses one link while changing to the authenticated workspace profile", () => {
    ensureRouteFonts("marketing");
    const workspaceLink = ensureRouteFonts("workspace");

    expect(document.head.querySelectorAll("[data-quotepilot-route-fonts]")).toHaveLength(1);
    expect(workspaceLink.href).toContain("family=Inter:wght@400;500;600;700");
    expect(workspaceLink.href).toContain("family=Manrope:wght@400;500;600;700");
    expect(workspaceLink.href).toContain("display=swap");
  });

  test("keeps single-purpose public routes on the working-text family only", () => {
    const link = ensureRouteFonts("buyer-access");

    expect(link.href).toContain("family=Manrope:wght@400;500;600;700");
    expect(link.href).not.toContain("Bodoni");
    expect(link.href).not.toContain("DM+Mono");
    expect(link.href).not.toContain("Inter");
  });
});
