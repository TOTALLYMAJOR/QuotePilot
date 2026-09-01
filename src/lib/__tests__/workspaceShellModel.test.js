import { describe, expect, test } from "vitest";
import {
  buildWorkspaceShellModel,
  WORKSPACE_SHELL_TOOL_IDS
} from "../workspaceShellModel";
import { WORKSPACE_ROUTE_IDS } from "../workspaceRoutes";

function route(routeId) {
  return { routeId, pathname: `/test/${routeId}` };
}

const STANDARD_ROUTE_CASES = [
  [WORKSPACE_ROUTE_IDS.CUSTOMER_LIST, "customer-directory"],
  [WORKSPACE_ROUTE_IDS.CUSTOMER_DETAIL, "customer-360"],
  [WORKSPACE_ROUTE_IDS.STAFF, "staff"],
  [WORKSPACE_ROUTE_IDS.QUOTE_LIST, "quotes"],
  [WORKSPACE_ROUTE_IDS.QUOTE_NEW, "quote-builder"],
  [WORKSPACE_ROUTE_IDS.QUOTE_DETAIL, "quotes"],
  [WORKSPACE_ROUTE_IDS.QUOTE_EDIT, "quote-builder"],
  [WORKSPACE_ROUTE_IDS.MESSAGING, "messages"],
  [WORKSPACE_ROUTE_IDS.WORKFLOW, "workflow"],
  [WORKSPACE_ROUTE_IDS.SCHEDULE, "schedule"],
  [WORKSPACE_ROUTE_IDS.REPORTING, "reporting"],
  [WORKSPACE_ROUTE_IDS.CATALOG, "catalog"],
  [WORKSPACE_ROUTE_IDS.IMPORTS, "imports"],
  [WORKSPACE_ROUTE_IDS.INTEGRATIONS, "integrations"],
  [WORKSPACE_ROUTE_IDS.DIAGNOSTICS, "diagnostics"]
];

const WORKSPACE_ONLY_LEGACY_GAPS = new Set([
  WORKSPACE_ROUTE_IDS.STAFF,
  WORKSPACE_ROUTE_IDS.CUSTOMER_LIST,
  WORKSPACE_ROUTE_IDS.CUSTOMER_DETAIL,
  WORKSPACE_ROUTE_IDS.MESSAGING
]);

const MODAL_LEGACY_ROUTES = new Set([
  WORKSPACE_ROUTE_IDS.QUOTE_LIST,
  WORKSPACE_ROUTE_IDS.QUOTE_DETAIL,
  WORKSPACE_ROUTE_IDS.WORKFLOW,
  WORKSPACE_ROUTE_IDS.SCHEDULE,
  WORKSPACE_ROUTE_IDS.REPORTING,
  WORKSPACE_ROUTE_IDS.CATALOG,
  WORKSPACE_ROUTE_IDS.IMPORTS,
  WORKSPACE_ROUTE_IDS.INTEGRATIONS,
  WORKSPACE_ROUTE_IDS.DIAGNOSTICS
]);

const ADMIN_ONLY_ROUTES = new Set([
  WORKSPACE_ROUTE_IDS.STAFF,
  WORKSPACE_ROUTE_IDS.IMPORTS
]);

describe("workspace shell route projection", () => {
  test.each([
    [false, false, "legacy sales"],
    [false, true, "legacy admin"],
    [true, false, "workspace sales"],
    [true, true, "workspace admin"]
  ])("projects the complete current route matrix for %s/%s (%s)", (workspaceEnabled, isAdmin) => {
    for (const [routeId, surfaceId] of STANDARD_ROUTE_CASES) {
      const model = buildWorkspaceShellModel({
        route: route(routeId),
        customerCenteredWorkspaceEnabled: workspaceEnabled,
        isAdmin,
        readOnlyLibraryEnabled: true
      });
      const roleDenied = ADMIN_ONLY_ROUTES.has(routeId) && !isAdmin;
      const legacyUnavailable = !workspaceEnabled && WORKSPACE_ONLY_LEGACY_GAPS.has(routeId);
      const denied = roleDenied || legacyUnavailable;

      expect(model.showNotFound, routeId).toBe(denied);
      expect(model.routeAuthorized, routeId).toBe(!denied);
      expect(model.primary.id, routeId).toBe(denied ? "workspace-not-found" : surfaceId);
      expect(model.primary.presentation, routeId).toBe(
        denied
          ? "not-found"
          : !workspaceEnabled && MODAL_LEGACY_ROUTES.has(routeId)
            ? "modal"
            : "embedded"
      );
    }
  });

  test("preserves the legacy /app projection into a new quote while workspace home stays interpreted", () => {
    const legacy = buildWorkspaceShellModel({
      route: route(WORKSPACE_ROUTE_IDS.HOME),
      customerCenteredWorkspaceEnabled: false
    });
    expect(legacy).toMatchObject({
      mode: "legacy",
      browserRouteId: WORKSPACE_ROUTE_IDS.HOME,
      resolvedRouteId: WORKSPACE_ROUTE_IDS.QUOTE_NEW,
      activeSection: "quotes",
      primary: { id: "quote-builder", presentation: "embedded" },
      active: { home: false, quoteBuilder: true }
    });

    const commandCenter = buildWorkspaceShellModel({
      route: route(WORKSPACE_ROUTE_IDS.HOME),
      customerCenteredWorkspaceEnabled: true
    });
    expect(commandCenter).toMatchObject({
      mode: "workspace",
      resolvedRouteId: WORKSPACE_ROUTE_IDS.HOME,
      activeSection: "home",
      primary: { id: "command-center", presentation: "embedded" },
      active: { home: true, quoteBuilder: false }
    });

    const now = buildWorkspaceShellModel({
      route: route(WORKSPACE_ROUTE_IDS.HOME),
      customerCenteredWorkspaceEnabled: true,
      pilotNowEnabled: true
    });
    expect(now.primary).toMatchObject({ id: "now", presentation: "embedded" });
  });

  test.each([
    [WORKSPACE_ROUTE_IDS.QUOTE_LIST, "history"],
    [WORKSPACE_ROUTE_IDS.QUOTE_DETAIL, "history"],
    [WORKSPACE_ROUTE_IDS.WORKFLOW, "workflow"]
  ])("switches %s between modal and embedded without changing its open state", (routeId, activeKey) => {
    const legacy = buildWorkspaceShellModel({ route: route(routeId) });
    const workspace = buildWorkspaceShellModel({
      route: route(routeId),
      customerCenteredWorkspaceEnabled: true
    });

    expect(legacy.active[activeKey]).toBe(true);
    expect(workspace.active[activeKey]).toBe(true);
    expect(legacy.presentation[activeKey]).toBe("modal");
    expect(workspace.presentation[activeKey]).toBe("embedded");
    expect(legacy.primary.presentation).toBe("modal");
    expect(workspace.primary.presentation).toBe("embedded");
  });
});

describe("routed tool authorization and presentation", () => {
  const TOOL_MATRIX = [
    ["schedule", WORKSPACE_ROUTE_IDS.SCHEDULE, "eventSchedule"],
    ["reporting", WORKSPACE_ROUTE_IDS.REPORTING, "reportingDashboard"],
    ["integrations", WORKSPACE_ROUTE_IDS.INTEGRATIONS, "integrationsOps"],
    ["diagnostics", WORKSPACE_ROUTE_IDS.DIAGNOSTICS, "diagnostics"]
  ];

  test.each(TOOL_MATRIX)("keeps %s available to admin and sales when its exact tenant flag is enabled", (toolId, routeId) => {
    for (const workspaceEnabled of [false, true]) {
      for (const isAdmin of [false, true]) {
        const model = buildWorkspaceShellModel({
          route: route(routeId),
          customerCenteredWorkspaceEnabled: workspaceEnabled,
          isAdmin
        });
        expect(model.routedTool, `${workspaceEnabled}/${isAdmin}`).toBe(toolId);
        expect(model.routedToolAuthorized, `${workspaceEnabled}/${isAdmin}`).toBe(true);
        expect(model.showNotFound, `${workspaceEnabled}/${isAdmin}`).toBe(false);
      }
    }
  });

  test.each(TOOL_MATRIX)("fails %s closed when its exact tenant feature is disabled", (toolId, routeId, featureFlag) => {
    for (const workspaceEnabled of [false, true]) {
      const model = buildWorkspaceShellModel({
        route: route(routeId),
        customerCenteredWorkspaceEnabled: workspaceEnabled,
        isAdmin: true,
        featureFlags: { [featureFlag]: false }
      });
      expect(model).toMatchObject({
        routedTool: toolId,
        routedToolAuthorized: false,
        showNotFound: true,
        notFoundReason: "feature-disabled",
        primary: { id: "workspace-not-found", presentation: "not-found" }
      });
      const projection = workspaceEnabled
        ? model.active.routedTools[toolId]
        : model.active.modalTools[toolId];
      expect(projection).toMatchObject({ open: true, authorized: false, visible: false });
    }
  });

  test("makes the ambient Library readable by sales while retaining admin-only mutation authority", () => {
    const sales = buildWorkspaceShellModel({
      route: route(WORKSPACE_ROUTE_IDS.CATALOG),
      customerCenteredWorkspaceEnabled: true,
      isAdmin: false,
      readOnlyLibraryEnabled: true
    });
    expect(sales).toMatchObject({
      routedTool: "catalog",
      routedToolAuthorized: true,
      showNotFound: false,
      primary: { id: "catalog", presentation: "embedded" }
    });
  });

  test.each([
    ["catalog", WORKSPACE_ROUTE_IDS.CATALOG, false],
    ["imports", WORKSPACE_ROUTE_IDS.IMPORTS, true]
  ])("keeps %s admin-only when no read-only Library surface is enabled", (toolId, routeId, readOnlyLibraryEnabled) => {
    for (const workspaceEnabled of [false, true]) {
      const sales = buildWorkspaceShellModel({
        route: route(routeId),
        customerCenteredWorkspaceEnabled: workspaceEnabled,
        isAdmin: false,
        readOnlyLibraryEnabled
      });
      expect(sales).toMatchObject({
        routedTool: toolId,
        routedToolAuthorized: false,
        showNotFound: true,
        notFoundReason: "role-denied"
      });

      const admin = buildWorkspaceShellModel({
        route: route(routeId),
        customerCenteredWorkspaceEnabled: workspaceEnabled,
        isAdmin: true
      });
      expect(admin).toMatchObject({
        routedTool: toolId,
        routedToolAuthorized: true,
        showNotFound: false,
        primary: { id: toolId, presentation: workspaceEnabled ? "embedded" : "modal" }
      });
    }
  });

  test("keeps Staff admin-only, presentation-gated, and unavailable in the legacy shell", () => {
    const sales = buildWorkspaceShellModel({
      route: route(WORKSPACE_ROUTE_IDS.STAFF),
      customerCenteredWorkspaceEnabled: true,
      isAdmin: false
    });
    expect(sales).toMatchObject({
      routedTool: "staff",
      routedToolAuthorized: false,
      notFoundReason: "role-denied"
    });

    const disabled = buildWorkspaceShellModel({
      route: route(WORKSPACE_ROUTE_IDS.STAFF),
      customerCenteredWorkspaceEnabled: true,
      isAdmin: true,
      featureFlags: { staffDirectory: false }
    });
    expect(disabled).toMatchObject({
      routedToolAuthorized: false,
      notFoundReason: "feature-disabled"
    });

    const enabled = buildWorkspaceShellModel({
      route: route(WORKSPACE_ROUTE_IDS.STAFF),
      customerCenteredWorkspaceEnabled: true,
      isAdmin: true,
      featureFlags: { staffDirectory: true }
    });
    expect(enabled).toMatchObject({
      routedToolAuthorized: true,
      showNotFound: false,
      primary: { id: "staff", presentation: "embedded" }
    });

    const legacy = buildWorkspaceShellModel({
      route: route(WORKSPACE_ROUTE_IDS.STAFF),
      customerCenteredWorkspaceEnabled: false,
      isAdmin: true,
      featureFlags: { staffDirectory: true }
    });
    expect(legacy).toMatchObject({
      routedToolAuthorized: true,
      showNotFound: true,
      notFoundReason: "legacy-unavailable"
    });
  });

  test.each(TOOL_MATRIX)("projects %s as a legacy modal or workspace embedded route", (toolId, routeId) => {
    const legacy = buildWorkspaceShellModel({ route: route(routeId) });
    expect(legacy.active.routedTools[toolId]).toMatchObject({ open: false, visible: false });
    expect(legacy.active.modalTools[toolId]).toMatchObject({ open: true, visible: true });

    const workspace = buildWorkspaceShellModel({
      route: route(routeId),
      customerCenteredWorkspaceEnabled: true
    });
    expect(workspace.active.routedTools[toolId]).toMatchObject({ open: true, visible: true });
    expect(workspace.active.modalTools[toolId]).toMatchObject({ open: false, visible: false });
  });

  test("models transient legacy-tool state without granting missing role or feature authority", () => {
    const model = buildWorkspaceShellModel({
      route: route(WORKSPACE_ROUTE_IDS.QUOTE_NEW),
      customerCenteredWorkspaceEnabled: true,
      isAdmin: false,
      featureFlags: { eventSchedule: false },
      transientTools: { schedule: true, catalog: true, reporting: true }
    });

    expect(model.primary).toMatchObject({ id: "quote-builder", presentation: "embedded" });
    expect(model.active.modalTools.schedule).toMatchObject({ open: true, authorized: false, visible: false });
    expect(model.active.modalTools.catalog).toMatchObject({ open: true, authorized: false, visible: false });
    expect(model.active.modalTools.reporting).toMatchObject({ open: true, authorized: true, visible: true });
  });

  test("lists every current routed operational tool exactly once", () => {
    expect(WORKSPACE_SHELL_TOOL_IDS).toEqual([
      "staff",
      "schedule",
      "reporting",
      "catalog",
      "imports",
      "integrations",
      "diagnostics"
    ]);
  });
});

describe("not-found, portal, and immutability contracts", () => {
  test.each([
    [WORKSPACE_ROUTE_IDS.CUSTOMER_LIST, "legacy-unavailable"],
    [WORKSPACE_ROUTE_IDS.CUSTOMER_DETAIL, "legacy-unavailable"],
    [WORKSPACE_ROUTE_IDS.MESSAGING, "legacy-unavailable"],
    [WORKSPACE_ROUTE_IDS.NOT_FOUND, "unknown-route"],
    [WORKSPACE_ROUTE_IDS.OUTSIDE, "outside-workspace"]
  ])("returns contextual not-found projection for %s", (routeId, reason) => {
    expect(buildWorkspaceShellModel({ route: route(routeId) })).toMatchObject({
      routeAuthorized: false,
      showNotFound: true,
      notFoundReason: reason,
      primary: { id: "workspace-not-found", presentation: "not-found" }
    });
  });

  test("fails an unrecognized route identity closed as a not-found route", () => {
    expect(buildWorkspaceShellModel({ route: { routeId: "future-route" } })).toMatchObject({
      browserRouteId: WORKSPACE_ROUTE_IDS.NOT_FOUND,
      resolvedRouteId: WORKSPACE_ROUTE_IDS.NOT_FOUND,
      showNotFound: true,
      notFoundReason: "unknown-route"
    });
  });

  test("keeps portal precedence outside all staff route and modal projections", () => {
    const model = buildWorkspaceShellModel({
      route: route(WORKSPACE_ROUTE_IDS.PORTAL),
      customerCenteredWorkspaceEnabled: true,
      isAdmin: true,
      transientTools: Object.fromEntries(WORKSPACE_SHELL_TOOL_IDS.map((toolId) => [toolId, true]))
    });

    expect(model).toMatchObject({
      mode: "portal",
      portal: true,
      routeAuthorized: true,
      showNotFound: false,
      primary: { id: "customer-portal", presentation: "portal" },
      active: {
        home: false,
        history: false,
        messaging: false,
        workflow: false,
        quoteBuilder: false
      }
    });
    for (const toolId of WORKSPACE_SHELL_TOOL_IDS) {
      expect(model.active.routedTools[toolId].visible, toolId).toBe(false);
      expect(model.active.modalTools[toolId].visible, toolId).toBe(false);
    }
  });

  test("returns deeply frozen output without retaining mutable input aliases", () => {
    const featureFlags = { eventSchedule: true };
    const transientTools = { schedule: true };
    const model = buildWorkspaceShellModel({
      route: route(WORKSPACE_ROUTE_IDS.QUOTE_NEW),
      featureFlags,
      transientTools
    });
    featureFlags.eventSchedule = false;
    transientTools.schedule = false;

    expect(model.featureFlags.eventSchedule).toBe(true);
    expect(model.active.modalTools.schedule.open).toBe(true);
    expect(Object.isFrozen(model)).toBe(true);
    expect(Object.isFrozen(model.primary)).toBe(true);
    expect(Object.isFrozen(model.active)).toBe(true);
    expect(Object.isFrozen(model.active.routedTools.schedule)).toBe(true);
    expect(() => {
      model.active.modalTools.schedule.visible = false;
    }).toThrow(TypeError);
  });
});
