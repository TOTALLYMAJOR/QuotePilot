import { existsSync, readFileSync } from "node:fs";
import { describe, expect, test } from "vitest";
import {
  AIUI01_ACKNOWLEDGEMENT_BUDGET_MS,
  AIUI01_COMPATIBILITY_BASELINE,
  AIUI01_DATA_MODES,
  AIUI01_EVENT_WORKSPACE_PARITY,
  AIUI01_EVIDENCE_PROGRAMS,
  AIUI01_FLAG_PROFILES,
  AIUI01_GATES,
  AIUI01_PORTAL_PRECEDENCE,
  AIUI01_ROLES,
  AIUI01_SHELL_ACTIONS,
  AIUI01_SURFACES,
  AIUI01_VIEWPORTS,
  getAiui01EnabledShellActions,
  getAiui01SurfaceExpectation,
  resolveAiui01Flags
} from "../aiui01CompatibilityBaseline";
import {
  parseWorkspaceLocation,
  parseWorkspacePath,
  WORKSPACE_ROUTE_IDS
} from "../workspaceRoutes";

function unique(values) {
  return new Set(values).size === values.length;
}

function runtimeSource(paths) {
  return paths.map((path) => readFileSync(path, "utf8")).join("\n");
}

describe("AIUI-01 machine-readable compatibility baseline", () => {
  test("is immutable, uniquely keyed, and fixes the requested responsive/dead-click bounds", () => {
    expect(AIUI01_COMPATIBILITY_BASELINE.id).toBe("aiui-01-compatibility-dead-click-v1");
    expect(AIUI01_ACKNOWLEDGEMENT_BUDGET_MS).toBe(250);
    expect(AIUI01_VIEWPORTS.map(({ width }) => width)).toEqual([390, 768, 1440]);
    expect(AIUI01_ROLES.map(({ id }) => id)).toEqual(["admin", "sales"]);
    expect(unique(AIUI01_SURFACES.map(({ id }) => id))).toBe(true);
    expect(unique(AIUI01_SHELL_ACTIONS.map(({ id }) => id))).toBe(true);
    expect(unique(AIUI01_FLAG_PROFILES.map(({ id }) => id))).toBe(true);
    expect(Object.isFrozen(AIUI01_COMPATIBILITY_BASELINE)).toBe(true);
    expect(Object.isFrozen(AIUI01_COMPATIBILITY_BASELINE.surfaces[0])).toBe(true);
  });

  test("accounts for every shipped staff route and resolves every inventory path through the real parser", () => {
    const nonStaffRouteIds = new Set([
      WORKSPACE_ROUTE_IDS.NOT_FOUND,
      WORKSPACE_ROUTE_IDS.OUTSIDE,
      WORKSPACE_ROUTE_IDS.PORTAL
    ]);
    const shippedStaffRouteIds = Object.values(WORKSPACE_ROUTE_IDS)
      .filter((routeId) => !nonStaffRouteIds.has(routeId));

    expect(AIUI01_SURFACES.map(({ routeId }) => routeId).sort())
      .toEqual([...shippedStaffRouteIds].sort());

    for (const surface of AIUI01_SURFACES) {
      expect(parseWorkspacePath(surface.path), surface.id).toMatchObject({
        routeId: surface.routeId,
        isKnown: true,
        isWorkspace: true
      });
      expect(surface.roles.every((role) => ["admin", "sales"].includes(role))).toBe(true);
    }
  });

  test("keeps admin-only Catalog, Imports, and Staff absent for sales", () => {
    for (const profile of AIUI01_FLAG_PROFILES) {
      const flags = resolveAiui01Flags(profile.gates);
      expect(flags.profileId).toBe(profile.id);
      for (const surfaceId of ["catalog", "imports"]) {
        expect(getAiui01SurfaceExpectation(surfaceId, { role: "admin", flags }).available).toBe(true);
        expect(getAiui01SurfaceExpectation(surfaceId, { role: "sales", flags })).toMatchObject({
          available: false,
          outcome: "not-found",
          probe: ".workspace-not-found"
        });
      }
      expect(getAiui01SurfaceExpectation("staff", { role: "sales", flags }).available).toBe(false);
    }

    const staffingFlags = resolveAiui01Flags({
      VITE_CUSTOMER_CENTERED_WORKSPACE_ENABLED: "true",
      VITE_OPERATIONAL_STAFFING_ENABLED: "true"
    });
    expect(getAiui01SurfaceExpectation("staff", { role: "admin", flags: staffingFlags }))
      .toMatchObject({ available: true, outcome: "surface", probe: ".staff-workspace" });

    const admin = AIUI01_ROLES.find(({ id }) => id === "admin");
    const sales = AIUI01_ROLES.find(({ id }) => id === "sales");
    expect(admin.routeAuthority).toEqual(["catalog", "imports", "staff"]);
    expect(sales.routeAuthority).toEqual([]);
    expect(admin.quoteAuthority).toEqual(["proposal", "payment", "booking", "delete"]);
    expect(sales.quoteAuthority).toEqual(["proposal"]);
  });

  test("classifies every shell control and binds each primary route action to an inventoried destination", () => {
    const targetIds = new Set(AIUI01_SURFACES.map(({ id }) => id));
    const routeActions = AIUI01_SHELL_ACTIONS.filter(({ classification }) => classification === "primary_route");
    expect(routeActions).toHaveLength(13);
    for (const action of routeActions) {
      expect(targetIds.has(action.targetSurfaceId), action.id).toBe(true);
      expect(["header", "operations"]).toContain(action.entry);
    }

    const shellSource = runtimeSource([
      "src/App.jsx",
      "src/components/WorkspaceShell.jsx"
    ]);
    for (const action of AIUI01_SHELL_ACTIONS) {
      expect(shellSource, action.id).toContain(action.label);
    }

    const rollback = resolveAiui01Flags(
      AIUI01_FLAG_PROFILES.find(({ id }) => id === "legacy-rollback").gates
    );
    const workspace = resolveAiui01Flags(
      AIUI01_FLAG_PROFILES.find(({ id }) => id === "workspace-only").gates
    );
    expect(getAiui01EnabledShellActions({ role: "sales", flags: rollback })
      .filter(({ classification }) => classification === "primary_route")
      .map(({ id }) => id))
      .toEqual(["new-quote", "quotes", "workflow", "schedule", "reporting", "integrations", "diagnostics"]);
    expect(getAiui01EnabledShellActions({ role: "admin", flags: workspace })
      .filter(({ classification }) => classification === "primary_route")
      .map(({ id }) => id))
      .toEqual([
        "home",
        "customers",
        "new-quote",
        "quotes",
        "messages",
        "workflow",
        "schedule",
        "reporting",
        "integrations",
        "imports",
        "catalog",
        "diagnostics"
      ]);
  });

  test("models the five explicit Pilot combinations and keeps Ambient default-off and NOW/Memory dependencies fail-closed", () => {
    expect(AIUI01_GATES.productionPilot).toHaveLength(8);
    expect(AIUI01_GATES.localOnlyPilot).toEqual(["VITE_PILOT_MEMORY_ENABLED"]);

    for (const profile of AIUI01_FLAG_PROFILES) {
      expect(resolveAiui01Flags(profile.gates).profileId).toBe(profile.id);
    }

    for (const falseValue of [undefined, "", "0", "false", "no", "off", "unexpected"]) {
      expect(resolveAiui01Flags({ VITE_AMBIENT_UI_ENABLED: falseValue }).effective.ambient).toBe(false);
    }
    for (const trueValue of ["1", "true", "yes", "on", true]) {
      expect(resolveAiui01Flags({ VITE_AMBIENT_UI_ENABLED: trueValue }).effective.ambient).toBe(true);
    }

    expect(resolveAiui01Flags({ VITE_PILOT_NOW_ENABLED: "true" }).effective.now).toBe(false);
    expect(resolveAiui01Flags({
      VITE_CUSTOMER_CENTERED_WORKSPACE_ENABLED: "true",
      VITE_PILOT_NOW_ENABLED: "true"
    }).effective.now).toBe(true);
    expect(resolveAiui01Flags({ VITE_PILOT_MEMORY_ENABLED: "true" }).effective.memory).toBe(false);
    expect(resolveAiui01Flags({
      VITE_PILOT_CREATE_ENABLED: "true",
      VITE_PILOT_MEMORY_ENABLED: "true"
    }).effective.memory).toBe(true);

    const productionPilot = resolveAiui01Flags(
      AIUI01_FLAG_PROFILES.find(({ id }) => id === "production-pilot").gates
    );
    expect(productionPilot.effective).toMatchObject({
      command: true,
      expandedPilotCommands: false,
      decisionRoom: true,
      ambientDecisionRoom: false
    });
    const ambientAlpha = resolveAiui01Flags(
      AIUI01_FLAG_PROFILES.find(({ id }) => id === "ambient-alpha").gates
    );
    expect(ambientAlpha.effective).toMatchObject({
      command: true,
      expandedPilotCommands: true,
      decisionRoom: true,
      ambientDecisionRoom: true
    });

    const source = runtimeSource([
      "src/App.jsx",
      "src/components/AdminCatalogModal.jsx",
      "src/components/ChangeRequestPanel.jsx",
      "src/components/CreateIntake.jsx",
      "src/components/CustomerPortalView.jsx",
      "src/components/EventWorkspaceView.jsx",
      "src/components/LiveBreakdown.jsx",
      "src/components/PilotCommandBar.jsx",
      "src/components/QuoteCompareModal.jsx",
      "src/components/QuoteHistoryModal.jsx",
      "src/components/WizardSteps.jsx"
    ]);
    for (const gate of [
      AIUI01_GATES.workspace,
      AIUI01_GATES.ambient,
      AIUI01_GATES.operationalStaffing,
      ...AIUI01_GATES.productionPilot,
      ...AIUI01_GATES.localOnlyPilot
    ]) {
      expect(source, gate).toContain(gate);
    }
  });

  test("records the current Event Workspace gaps while preserving the exact administration handoff", () => {
    expect(AIUI01_EVENT_WORKSPACE_PARITY.map(({ id }) => id)).toEqual([
      "back-to-quotes",
      "ordinary-edit",
      "more-quote-actions",
      "workflow",
      "schedule",
      "sold-rentals",
      "production-beo",
      "customer-360",
      "download-pdf",
      "conversation",
      "full-opportunity-controls"
    ]);
    expect(AIUI01_EVENT_WORKSPACE_PARITY.filter(({ parity }) => parity === "gap").map(({ id }) => id))
      .toEqual([
        "more-quote-actions",
        "schedule",
        "production-beo",
        "customer-360",
        "download-pdf",
        "full-opportunity-controls"
      ]);

    const historySource = readFileSync("src/components/QuoteHistoryModal.jsx", "utf8");
    const ambientHostCall = historySource.slice(
      historySource.indexOf("<AmbientLivingOpportunityRoute"),
      historySource.indexOf("</Suspense>", historySource.indexOf("<AmbientLivingOpportunityRoute"))
    );
    expect(ambientHostCall).toContain("onOpenLegacyWorkspace={(context = {}) => (");
    expect(ambientHostCall).toContain("onOpenQuoteAdministration(focusedQuote.id, context)");
    expect(ambientHostCall).not.toContain("onEditQuote(focusedQuote.id, context)");
  });

  test("keeps browser-local evidence separate from Firebase and portal-token authority", () => {
    expect(AIUI01_DATA_MODES).toEqual([
      expect.objectContaining({
        id: "browser-local-fallback",
        firebaseConfigured: false,
        browserQualifiedHere: true,
        authorityClaim: "presentation-and-local-storage-only"
      }),
      expect.objectContaining({
        id: "firebase-emulator",
        firebaseConfigured: true,
        browserQualifiedHere: false,
        authorityClaim: "separate-lane-evidence-only",
        evidenceProgramId: "firebase-auth-rules"
      })
    ]);
    expect(AIUI01_PORTAL_PRECEDENCE.firebaseTokenAuthorityQualifiedHere).toBe(false);
    expect(AIUI01_PORTAL_PRECEDENCE.firebaseEvidenceProgramId).toBe("firebase-auth-rules");

    for (const pathname of AIUI01_PORTAL_PRECEDENCE.paths) {
      expect(parseWorkspaceLocation({ pathname, search: "?portal=aiui01-token" }), pathname)
        .toMatchObject({
          surface: "portal",
          routeId: WORKSPACE_ROUTE_IDS.PORTAL,
          portalToken: "aiui01-token",
          canonicalPath: "/app?portal=aiui01-token"
        });
    }

    const firebaseEvidence = AIUI01_EVIDENCE_PROGRAMS.find(({ id }) => id === "firebase-auth-rules");
    expect(firebaseEvidence.kind).toBe("separate-firebase-emulator-browser");
    expect(firebaseEvidence.command).toBe("npm run test:e2e:firebase");
    const firebaseSpec = readFileSync(firebaseEvidence.files[0], "utf8");
    expect(firebaseSpec).toContain("staff and the exact customer portal share one near-real-time quote conversation");
  });

  test("keeps every claimed evidence program executable and every cited file present", () => {
    for (const program of AIUI01_EVIDENCE_PROGRAMS) {
      expect(program.command, program.id).toBeTruthy();
      expect(program.files.length, program.id).toBeGreaterThan(0);
      for (const file of program.files) {
        expect(existsSync(file), `${program.id}: ${file}`).toBe(true);
      }
    }
  });
});
