import { describe, expect, test } from "vitest";
import {
  AMBIENT_PACKAGE_MENU_CATALOG_EVIDENCE_MODEL,
  buildAmbientPackageMenuCatalogEvidence
} from "../ambientPackageMenuCatalogEvidence";

const CURRENT_CATALOG = {
  source: "firebase-org",
  observedAtISO: "2026-08-11T20:15:00.000Z",
  loading: false,
  error: "",
  packages: [{ id: "classic", name: "Classic", active: true }],
  addons: [{
    id: "tea",
    name: "Tea Service",
    active: true,
    qtyRule: () => 120
  }],
  rentals: [{
    id: "linens",
    name: "Table Linens",
    active: true,
    qtyRule: () => 15
  }],
  settings: {
    catalogRevision: 12,
    upsellRules: [{
      id: "tea-review",
      name: "Tea review",
      kind: "addon",
      targetId: "tea",
      enabled: true
    }],
    menuSections: [{
      id: "dinner",
      name: "Dinner",
      items: [{ id: "chicken", name: "Roasted Chicken", active: true }]
    }]
  }
};

describe("Ambient Package/Menu catalog evidence adapter", () => {
  test("binds an observed current catalog to its exact tenant and revision", () => {
    const evidence = buildAmbientPackageMenuCatalogEvidence({
      organizationId: "org-1",
      catalog: CURRENT_CATALOG
    });

    expect(evidence).toMatchObject({
      modelId: AMBIENT_PACKAGE_MENU_CATALOG_EVIDENCE_MODEL,
      organizationId: "org-1",
      sourceLabel: "firebase-org",
      catalogRevision: 12,
      freshness: {
        state: "fresh",
        observedAtISO: "2026-08-11T20:15:00.000Z",
        reason: ""
      }
    });
    expect(evidence.packages[0]).not.toBe(CURRENT_CATALOG.packages[0]);
    expect(evidence.addons[0]).toEqual({
      id: "tea",
      name: "Tea Service",
      active: true
    });
    expect(evidence.rentals[0]).toEqual({
      id: "linens",
      name: "Table Linens",
      active: true
    });
    expect(evidence.upsellRules[0]).not.toBe(CURRENT_CATALOG.settings.upsellRules[0]);
    expect(Object.isFrozen(evidence.addons[0])).toBe(true);
    expect(Object.isFrozen(evidence.rentals[0])).toBe(true);
    expect(Object.isFrozen(evidence.upsellRules[0])).toBe(true);
    expect(evidence.menuSections[0].items[0]).not.toBe(
      CURRENT_CATALOG.settings.menuSections[0].items[0]
    );
    expect(Object.isFrozen(evidence.menuSections[0].items[0])).toBe(true);
  });

  test.each(["firebase-org", "local-cache"])(
    "treats an exactly observed %s snapshot as fresh evidence",
    (source) => {
      const evidence = buildAmbientPackageMenuCatalogEvidence({
        organizationId: "org-1",
        catalog: { ...CURRENT_CATALOG, source }
      });

      expect(evidence.freshness).toEqual({
        state: "fresh",
        observedAtISO: "2026-08-11T20:15:00.000Z",
        reason: ""
      });
      expect(evidence.sourceLabel).toBe(source);
    }
  );

  test.each([
    "firebase",
    "firebase-org-empty",
    "local-defaults",
    "fallback-defaults",
    "firebase-required",
    "auth-required",
    ""
  ])("does not promote the unobserved %s source to fresh evidence", (source) => {
    const evidence = buildAmbientPackageMenuCatalogEvidence({
      organizationId: "org-1",
      catalog: { ...CURRENT_CATALOG, source }
    });

    expect(evidence.freshness.state).toBe("unknown");
    expect(evidence.freshness.reason).toContain("not an observed tenant");
  });

  test("retains a failed-refresh snapshot as stale evidence without enabling freshness", () => {
    const evidence = buildAmbientPackageMenuCatalogEvidence({
      organizationId: "org-1",
      catalog: { ...CURRENT_CATALOG, error: "Refresh failed." }
    });

    expect(evidence.freshness).toMatchObject({
      state: "stale",
      observedAtISO: "2026-08-11T20:15:00.000Z"
    });
    expect(evidence.freshness.reason).toContain("Refresh failed");
    expect(evidence.freshness.state).not.toBe("fresh");
  });

  test.each([
    ["missing tenant scope", "", CURRENT_CATALOG, "active organization scope"],
    ["unobserved defaults", "org-1", { ...CURRENT_CATALOG, source: "local-defaults" }, "not an observed tenant"],
    ["missing observation", "org-1", { ...CURRENT_CATALOG, observedAtISO: "" }, "exact observation time"],
    ["loading refresh", "org-1", { ...CURRENT_CATALOG, loading: true }, "still in progress"],
    ["invalid revision", "org-1", {
      ...CURRENT_CATALOG,
      settings: { ...CURRENT_CATALOG.settings, catalogRevision: -1 }
    }, "exact revision"],
    ["missing revision", "org-1", {
      ...CURRENT_CATALOG,
      settings: { ...CURRENT_CATALOG.settings, catalogRevision: undefined }
    }, "exact revision"],
    ["null revision", "org-1", {
      ...CURRENT_CATALOG,
      settings: { ...CURRENT_CATALOG.settings, catalogRevision: null }
    }, "exact revision"],
    ["blank revision", "org-1", {
      ...CURRENT_CATALOG,
      settings: { ...CURRENT_CATALOG.settings, catalogRevision: "" }
    }, "exact revision"],
    ["string revision", "org-1", {
      ...CURRENT_CATALOG,
      settings: { ...CURRENT_CATALOG.settings, catalogRevision: "12" }
    }, "exact revision"]
  ])("fails %s closed as unknown evidence", (_label, organizationId, catalog, reason) => {
    const evidence = buildAmbientPackageMenuCatalogEvidence({ organizationId, catalog });
    expect(evidence.freshness.state).toBe("unknown");
    expect(evidence.freshness.reason).toContain(reason);
  });

  test.each([
    ["loading", { loading: true }, "unknown"],
    ["refresh error", { error: "Refresh failed." }, "stale"],
    ["missing revision", {
      settings: { ...CURRENT_CATALOG.settings, catalogRevision: undefined }
    }, "unknown"]
  ])("keeps %s evidence fail-closed", (_label, patch, expectedState) => {
    const evidence = buildAmbientPackageMenuCatalogEvidence({
      organizationId: "org-1",
      catalog: { ...CURRENT_CATALOG, ...patch }
    });

    expect(evidence.freshness.state).toBe(expectedState);
    expect(evidence.freshness.state).not.toBe("fresh");
    expect(evidence.freshness.reason).not.toBe("");
  });
});
