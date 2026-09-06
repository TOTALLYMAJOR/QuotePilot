import { describe, expect, test } from "vitest";
import {
  AMBIENT_LIBRARY_MODEL,
  AMBIENT_LIBRARY_SECTION_ORDER,
  AMBIENT_LIBRARY_SURFACE_CONTRACT,
  buildAmbientLibrary
} from "../ambientLibrary";

const OBSERVED_AT = "2026-08-12T15:00:00.000Z";
const CONFIRMED_AT = "2026-08-12T14:55:00.000Z";
const ORGANIZATION_ID = "org-library";

function catalogState(overrides = {}) {
  const settings = {
    catalogRevision: 7,
    pricingSetupConfirmed: true,
    pricingConfirmation: {
      actorUid: "admin-library",
      actorEmail: "admin@example.test",
      confirmedAtISO: CONFIRMED_AT,
      confirmedCatalogRevision: 7
    },
    menuSections: [{
      id: "dinner",
      name: "Dinner",
      items: [{ id: "menu-chicken", name: "Herb chicken", active: true }]
    }],
    eventTemplates: [{
      id: "wedding",
      name: "Wedding",
      style: "Plated",
      pkg: "package-plated",
      addons: ["addon-dessert"],
      rentals: ["rental-linen"],
      menuItems: ["menu-chicken"]
    }],
    ...(overrides.settings || {})
  };
  return {
    organizationId: ORGANIZATION_ID,
    source: "firebase-org",
    observedAtISO: OBSERVED_AT,
    loading: false,
    saving: false,
    error: "",
    stale: false,
    authoritativeVersion: 3,
    menuInventoryComplete: true,
    packages: [{ id: "package-plated", name: "Plated dinner", active: true }],
    addons: [{ id: "addon-dessert", name: "Dessert service", active: true }],
    rentals: [{ id: "rental-linen", name: "Table linens", active: true }],
    eventTypes: [],
    ...overrides,
    settings
  };
}

function build(options = {}) {
  return buildAmbientLibrary({
    state: catalogState(),
    currentUserRole: "admin",
    capabilities: {
      openSection: true,
      openTemplate: true,
      refresh: true
    },
    ...options
  });
}

describe("Ambient Library contracts", () => {
  test("declares one purpose-bearing Library surface with a meaningful starting action", () => {
    expect(AMBIENT_LIBRARY_SURFACE_CONTRACT).toMatchObject({
      id: "ambient-library",
      objectScopes: [
        "tenant-catalog",
        "catalog-section",
    "event-template",
        "pricing-settings",
        "configuration-rules"
      ],
      purposes: ["clarify", "advance", "resolve", "reveal_context"],
      allowedEmptyState: {
        kind: "starting_action",
        actionId: "start-library-setup"
      },
      recoveryBehavior: { nextActionIds: ["refresh-library"] }
    });
    expect(Object.isFrozen(AMBIENT_LIBRARY_SURFACE_CONTRACT)).toBe(true);
  });
});

describe("buildAmbientLibrary", () => {
  test("projects seven exact sections, current pricing evidence, bounded rules, and dependency-safe templates", () => {
    const result = build();

    expect(result.modelId).toBe(AMBIENT_LIBRARY_MODEL);
    expect(result.surfaceContract).toBe(AMBIENT_LIBRARY_SURFACE_CONTRACT);
    expect(result.state).toBe("ready");
    expect(result.roleBoundary).toEqual({
      role: "admin",
      allowed: true,
      editAllowed: true,
      reason: null
    });
    expect(result.readBoundary).toMatchObject({
      kind: "firebase",
      organizationId: ORGANIZATION_ID,
      recordsUsable: true,
      serverScoped: true,
      freshness: { state: "fresh", observedAt: OBSERVED_AT }
    });
    expect(result.revision).toMatchObject({ state: "available", catalogRevision: 7 });
    expect(result.pricing).toMatchObject({
      state: "confirmed",
      authority: "server_recorded",
      catalogRevision: 7,
      confirmationCurrent: true,
      confirmedAt: CONFIRMED_AT
    });
    expect(result.sections.map((section) => section.id)).toEqual(AMBIENT_LIBRARY_SECTION_ORDER);
    expect(result.sections.find((section) => section.id === "rules")?.summary).toMatchObject({
      totalCount: 0,
      activeCount: 0
    });
    expect(result.sections.find((section) => section.id === "menu")?.summary).toMatchObject({
      availability: "available",
      totalCount: 1,
      activeCount: 1,
      sectionCount: 1
    });
    expect(result.templates).toHaveLength(1);
    expect(result.templates[0]).toMatchObject({
      id: "wedding",
      name: "Wedding",
      dependencyState: "resolved",
      unresolvedDependencies: [],
      referenceCount: 4,
      resolvedReferenceCount: 4
    });
    expect(result.templates[0].descriptor).toMatchObject({
      id: "wedding",
      type: "event-template",
      inspectorSurfaceId: "library-template",
      confidence: { level: "high", score: 1 },
      permissions: { view: true, simulate: false, stage: false, commit: false },
      actionIds: ["review-library-template:wedding"]
    });
    expect(result.templates[0].dependencies.map((dependency) => dependency.kind)).toEqual([
      "package",
      "add-on",
      "rental",
      "menu item"
    ]);
    expect(result.caughtUp.eligible).toBe(true);
    expect(result.caughtUp.reason).toContain("Item availability and event readiness are checked separately");
  });

  test("gives every section and exact template an outcome action with full arrival context", () => {
    const result = build();
    const sectionAction = result.actions["review-library-packages"];
    const templateAction = result.actions["review-library-template:wedding"];

    expect(sectionAction).toMatchObject({
      outcomeLabel: "Review packages",
      authorityLevel: "presentation",
      enabled: true,
      executionTarget: {
        kind: "context",
        targetId: "packages",
        surfaceId: "catalog-admin-section"
      },
      arrivalContract: {
        object: { id: "packages", type: "catalog-section", label: "Packages" },
        nextResolutionIds: ["return-to-library"]
      }
    });
    expect(sectionAction.arrivalContract.reason).toBeTruthy();
    expect(sectionAction.arrivalContract.consequence).toBeTruthy();
    expect(templateAction).toMatchObject({
      outcomeLabel: "Review Wedding",
      roles: ["admin"],
      executionTarget: {
        kind: "context",
        targetId: "wedding",
        surfaceId: "library-template"
      },
      arrivalContract: {
        object: { id: "wedding", type: "event-template", label: "Wedding" },
        nextResolutionIds: ["return-to-library-templates"]
      }
    });
    expect(result.nextAction).toBe(result.actions["review-library-templates"]);
    expect(result.nextAction.primary).toBe(true);
  });

  test("ranks stale-read recovery before pricing, template, and setup work", () => {
    const result = build({
      state: catalogState({
        stale: true,
        error: "The latest refresh did not finish.",
        settings: {
          pricingSetupConfirmed: false,
          pricingConfirmation: null,
          eventTemplates: [{
            id: "wedding",
            name: "Wedding",
            pkg: "missing-package",
            addons: [],
            rentals: [],
            menuItems: []
          }]
        },
        packages: []
      })
    });

    expect(result.nextAction).toBe(result.actions["refresh-library"]);
    expect(result.nextAction.outcomeLabel).toBe("Refresh Library");
    expect(result.rankedCandidates.map((candidate) => candidate.kind).slice(0, 4)).toEqual([
      "refresh",
      "pricing",
      "template_dependency",
      "start"
    ]);
    expect(result.caughtUp.eligible).toBe(false);
  });

  test("ranks the exact template when its recorded dependency is missing", () => {
    const result = build({
      state: catalogState({
        settings: {
          eventTemplates: [{
            id: "wedding",
            name: "Wedding",
            pkg: "missing-package",
            addons: [],
            rentals: [],
            menuItems: []
          }]
        }
      })
    });

    expect(result.templates[0]).toMatchObject({
      dependencyState: "attention",
      unresolvedDependencies: [{
        id: "missing-package",
        kind: "package",
        state: "missing"
      }]
    });
    expect(result.nextAction).toBe(result.actions["review-library-template:wedding"]);
    expect(result.nextAction.primary).toBe(true);
    expect(result.nextAction.arrivalContract.object.id).toBe("wedding");
  });

  test("keeps menu counts unavailable and menu references unclassified without complete inventory evidence", () => {
    const result = build({
      state: catalogState({
        menuInventoryComplete: false,
        settings: {
          // This legacy field may be empty while event-scoped menu collections
          // contain records. It must never be treated as a complete inventory.
          menuSections: [],
          eventTemplates: [{
            id: "wedding",
            name: "Wedding",
            pkg: "package-plated",
            addons: ["addon-dessert"],
            rentals: ["rental-linen"],
            menuItems: ["menu-chicken"]
          }]
        }
      })
    });
    const menuSection = result.sections.find((section) => section.id === "menu");
    const menuDependency = result.templates[0].dependencies.find(
      (dependency) => dependency.kind === "menu item"
    );

    expect(menuSection.summary).toEqual({
      availability: "unavailable",
      totalCount: null,
      activeCount: null,
      inactiveCount: null,
      sectionCount: null,
      reason: "The full menu is not available in this view yet, so QuotePilot will not assume there are no event menu records."
    });
    expect(menuSection.descriptor.summary).toContain("full menu is not available");
    expect(menuSection.descriptor).toMatchObject({
      confidence: { level: "unavailable" },
      provenance: [{
        type: "tenant-menu-inventory",
        state: "unavailable"
      }]
    });
    expect(menuDependency).toMatchObject({
      id: "menu-chicken",
      state: "evidence_unavailable"
    });
    expect(menuDependency.reason).toContain("stays unclassified until the current menu is reviewed");
    expect(result.rankedCandidates.map((candidate) => candidate.kind)).not.toContain("empty_menu");
    expect(result.rankedCandidates[0]).toMatchObject({
      kind: "menu_evidence",
      actionId: "review-library-menu"
    });
    expect(result.nextAction).toBe(result.actions["review-library-menu"]);
    expect(result.caughtUp.eligible).toBe(false);
  });

  test("ranks menu evidence review without mislabeling unknown inventory as an empty menu", () => {
    const result = build({
      state: catalogState({
        menuInventoryComplete: false,
        settings: {
          menuSections: [],
          eventTemplates: [{
            id: "wedding",
            name: "Wedding",
            pkg: "package-plated",
            addons: ["addon-dessert"],
            rentals: ["rental-linen"],
            menuItems: []
          }]
        }
      })
    });

    expect(result.rankedCandidates[0]).toMatchObject({
      kind: "menu_evidence",
      actionId: "review-library-menu"
    });
    expect(result.rankedCandidates.map((candidate) => candidate.kind)).not.toContain("empty_menu");
    expect(result.nextAction).toBe(result.actions["review-library-menu"]);
    expect(result.nextAction.arrivalContract.reason).toContain("full menu is not available");
    expect(result.nextAction.arrivalContract.consequence).toContain("does not treat this partial view as the full menu");
  });

  test("withholds initial hook defaults until a completed organization read exists", () => {
    const result = build({
      state: catalogState({
        source: "firebase",
        observedAtISO: "",
        loading: true
      })
    });

    expect(result.state).toBe("loading");
    expect(result.sections).toEqual([]);
    expect(result.templates).toEqual([]);
    expect(result.pricing.state).toBe("unavailable");
    expect(result.readBoundary.recordsUsable).toBe(false);
    expect(result.readBoundary.notes.join(" ")).toContain("still loading");
    expect(JSON.stringify(result)).not.toContain("Herb chicken");
  });

  test("gives sales staff read-only Library readiness without edit controls", () => {
    const result = build({ currentUserRole: "sales" });

    expect(result.state).toBe("ready");
    expect(result.roleBoundary).toEqual({
      role: "sales",
      allowed: true,
      editAllowed: false,
      reason: null
    });
    expect(result.sections).toHaveLength(7);
    expect(result.templates).toHaveLength(1);
    expect(result.capabilities.openSection).toBe(false);
    expect(result.capabilities.openTemplate).toBe(false);
    expect(Object.entries(result.actions)
      .filter(([actionId]) => actionId !== "refresh-library")
      .map(([, action]) => action)
      .every((action) => action.enabled === false)).toBe(true);
    expect(JSON.stringify(result)).toMatch(/Herb chicken|Plated dinner|Wedding/iu);
  });

  test("labels local fallback, revision, and pricing confirmation as browser-only", () => {
    const result = build({ state: catalogState({ source: "local-cache" }) });

    expect(result.state).toBe("local");
    expect(result.readBoundary).toMatchObject({
      kind: "local",
      serverScoped: false,
      recordsUsable: true
    });
    expect(result.readBoundary.sourceBoundary).toContain("not proof of the organization’s server catalog");
    expect(result.revision).toMatchObject({ state: "browser_only", catalogRevision: 7 });
    expect(result.pricing).toMatchObject({ state: "local_only", authority: "browser_only" });
    expect(result.caughtUp.eligible).toBe(false);
  });

  test("keeps malformed and duplicate records bounded instead of inventing identity", () => {
    const result = build({
      state: catalogState({
        packages: [
          { id: "package-plated", name: "Plated dinner", active: true },
          { id: "package-plated", name: "Duplicate", active: true },
          { id: "", name: "Missing identity", active: true },
          { id: "package-inexact", name: "No active flag" }
        ]
      })
    });
    const packageSection = result.sections.find((section) => section.id === "packages");

    expect(packageSection.summary).toMatchObject({ totalCount: 1, activeCount: 1 });
    expect(result.omittedEvidence).toHaveLength(3);
    expect(result.omittedEvidence.join(" ")).toMatch(/duplicate id|lacks an exact id/iu);
    expect(result.state).toBe("bounded");
    expect(result.caughtUp.eligible).toBe(false);
  });

  test("omits records that explicitly declare another organization", () => {
    const result = build({
      state: catalogState({
        packages: [
          { id: "package-plated", name: "Plated dinner", active: true },
          {
            id: "package-other",
            organizationId: "org-other",
            name: "Other organization package",
            active: true
          }
        ],
        addons: [{
          id: "addon-other",
          organizationId: "org-other",
          name: "Other organization add-on",
          active: true
        }]
      })
    });
    const packageSection = result.sections.find((section) => section.id === "packages");
    const addonSection = result.sections.find((section) => section.id === "addons");

    expect(packageSection.summary.totalCount).toBe(1);
    expect(addonSection.summary.totalCount).toBe(0);
    expect(result.omittedEvidence.join(" ")).toContain("different or invalid organization scope");
    expect(JSON.stringify(result)).not.toContain("Other organization");
  });

  test("deep-freezes the full projection and never exposes mutation authority", () => {
    const result = build();

    expect(Object.isFrozen(result)).toBe(true);
    expect(Object.isFrozen(result.sections)).toBe(true);
    expect(Object.isFrozen(result.sections[0].descriptor.dependencies)).toBe(true);
    expect(Object.isFrozen(result.templates[0].dependencies)).toBe(true);
    expect(Object.isFrozen(result.templates[0].descriptor)).toBe(true);
    Object.values(result.actions).forEach((action) => {
      expect(action.authorityLevel).toBe("presentation");
      expect(action.executionTarget.kind).toMatch(/context|command/);
      expect(action.arrivalContract.reason).toBeTruthy();
      expect(action.arrivalContract.consequence).toBeTruthy();
      expect(action.arrivalContract.nextResolutionIds.length).toBeGreaterThan(0);
    });
    expect(result.evidenceBoundary).toContain("no read, cross-tenant lookup, mutation, repricing");
  });
});
