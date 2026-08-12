import { describe, expect, test } from "vitest";

import {
  AMBIENT_GLOBAL_PILOT_ACTION,
  AMBIENT_GLOBAL_PILOT_CHOOSE_ACTION,
  AMBIENT_GLOBAL_PILOT_DISMISS_ACTION,
  AMBIENT_GLOBAL_PILOT_SURFACE_CONTRACT,
  resolveAmbientGlobalPilotTarget
} from "../ambientGlobalPilot.js";
import { WORKSPACE_ROUTE_IDS } from "../workspaceRoutes.js";

describe("resolveAmbientGlobalPilotTarget", () => {
  test("grounds a Living Opportunity in the exact opaque opportunity id", () => {
    const model = resolveAmbientGlobalPilotTarget({
      routeId: WORKSPACE_ROUTE_IDS.QUOTE_DETAIL,
      opportunityId: " quote-42 ",
      pilotCommandEnabled: false
    });

    expect(model).toEqual({
      target: "living_opportunity",
      routeId: WORKSPACE_ROUTE_IDS.QUOTE_DETAIL,
      routeLabel: "Living Opportunity",
      object: {
        id: "quote-42",
        type: "opportunity",
        label: "Selected opportunity"
      },
      reason: expect.any(String),
      consequence: expect.stringContaining("Nothing in the quote changes"),
      nextResolution: {
        id: "explain-next-action",
        label: "Review why this matters"
      }
    });
  });

  test("fails closed when a Living Opportunity has no exact object id", () => {
    const model = resolveAmbientGlobalPilotTarget({
      routeId: WORKSPACE_ROUTE_IDS.QUOTE_DETAIL,
      opportunityId: "   ",
      pilotCommandEnabled: true
    });

    expect(model.target).toBe("recovery");
    expect(model.reason).toMatch(/could not be identified/i);
    expect(model.consequence).toMatch(/no other opportunity will be guessed/i);
    expect(model.nextResolution.id).toBe("open-opportunities");
  });

  test.each([WORKSPACE_ROUTE_IDS.QUOTE_NEW, WORKSPACE_ROUTE_IDS.QUOTE_EDIT])(
    "focuses the existing deterministic command surface for %s when enabled",
    (routeId) => {
      const draftObject = {
        id: "draft-9",
        type: "quote-draft",
        label: "Current draft",
        ignoredAuthority: "trusted"
      };
      const model = resolveAmbientGlobalPilotTarget({
        routeId,
        draftObject,
        pilotCommandEnabled: true
      });

      expect(model.target).toBe("draft_command");
      expect(model.object).toEqual({
        id: "draft-9",
        type: "quote-draft",
        label: "Current draft"
      });
      expect(model.nextResolution.id).toBe("focus-pilot-command");
      expect(model.consequence).toMatch(/nothing is previewed, added to the draft, or saved/i);
      expect(model.object).not.toHaveProperty("ignoredAuthority");
    }
  );

  test("uses a bounded new-draft object when draft identity is incomplete", () => {
    const model = resolveAmbientGlobalPilotTarget({
      routeId: WORKSPACE_ROUTE_IDS.QUOTE_NEW,
      draftObject: { id: "draft-9", type: "quote-draft" },
      pilotCommandEnabled: true
    });

    expect(model.object).toEqual({
      id: "new-draft",
      type: "quote-draft",
      label: "New quote draft"
    });
  });

  test("returns truthful draft recovery unless the command gate is exactly true", () => {
    for (const pilotCommandEnabled of [false, undefined, "true", 1]) {
      const model = resolveAmbientGlobalPilotTarget({
        routeId: WORKSPACE_ROUTE_IDS.QUOTE_EDIT,
        draftObject: { id: "draft-9", type: "quote-draft", label: "Current draft" },
        pilotCommandEnabled
      });

      expect(model.target).toBe("recovery");
      expect(model.reason).toMatch(/not available/i);
      expect(model.consequence).toMatch(/remains unchanged/i);
      expect(model.nextResolution).toEqual({
        id: "continue-editing",
        label: "Continue editing"
      });
    }
  });

  test.each([
    WORKSPACE_ROUTE_IDS.HOME,
    WORKSPACE_ROUTE_IDS.CUSTOMER_LIST,
    WORKSPACE_ROUTE_IDS.CUSTOMER_DETAIL,
    WORKSPACE_ROUTE_IDS.QUOTE_LIST,
    WORKSPACE_ROUTE_IDS.MESSAGING,
    WORKSPACE_ROUTE_IDS.WORKFLOW,
    WORKSPACE_ROUTE_IDS.SCHEDULE,
    WORKSPACE_ROUTE_IDS.REPORTING,
    WORKSPACE_ROUTE_IDS.CATALOG,
    WORKSPACE_ROUTE_IDS.IMPORTS,
    WORKSPACE_ROUTE_IDS.INTEGRATIONS,
    WORKSPACE_ROUTE_IDS.DIAGNOSTICS,
    WORKSPACE_ROUTE_IDS.NOT_FOUND,
    WORKSPACE_ROUTE_IDS.OUTSIDE,
    WORKSPACE_ROUTE_IDS.PORTAL,
    "future-route"
  ])("offers an exact starting action instead of generic chat on %s", (routeId) => {
    const model = resolveAmbientGlobalPilotTarget({
      routeId,
      opportunityId: "ignored-opportunity",
      pilotCommandEnabled: true
    });

    expect(model.target).toBe("choose_opportunity");
    expect(model.object).toEqual({
      id: "opportunities",
      type: "opportunity-collection",
      label: "Opportunities"
    });
    expect(model.reason).toMatch(/choose an opportunity/i);
    expect(model.consequence).toMatch(/no guidance appears until you choose one/i);
    expect(model.nextResolution.id).toBe("open-opportunities");
  });

  test("returns a deeply frozen, input-independent presentation model", () => {
    const draftObject = { id: "draft-2", type: "quote-draft", label: "Draft two" };
    const model = resolveAmbientGlobalPilotTarget({
      routeId: WORKSPACE_ROUTE_IDS.QUOTE_EDIT,
      draftObject,
      pilotCommandEnabled: true
    });

    draftObject.label = "Changed outside";

    expect(model.object.label).toBe("Draft two");
    expect(Object.isFrozen(model)).toBe(true);
    expect(Object.isFrozen(model.object)).toBe(true);
    expect(Object.isFrozen(model.nextResolution)).toBe(true);
  });
});

describe("global Pilot ambient contracts", () => {
  test("declares a presentation-only contextual action", () => {
    expect(AMBIENT_GLOBAL_PILOT_ACTION).toMatchObject({
      id: "open-global-pilot-context",
      purpose: "reveal_context",
      authorityLevel: "presentation",
      previewPolicy: "none",
      receiptType: "context",
      enabled: true,
      executionTarget: {
        kind: "context",
        targetId: "global-pilot",
        surfaceId: "ambient-global-pilot-context"
      }
    });
    expect(AMBIENT_GLOBAL_PILOT_ACTION.arrivalContract.nextResolutionIds).toEqual([
      "explain-next-action",
      "focus-pilot-command",
      "open-opportunities"
    ]);
    expect(Object.isFrozen(AMBIENT_GLOBAL_PILOT_ACTION)).toBe(true);
  });

  test("declares a nonempty context surface with bounded recovery", () => {
    expect(AMBIENT_GLOBAL_PILOT_SURFACE_CONTRACT).toMatchObject({
      id: "ambient-global-pilot-context",
      objectScopes: [
        "workspace-intelligence",
        "opportunity",
        "opportunity-collection",
        "quote-draft"
      ],
      purposes: ["clarify", "reveal_context", "resolve"],
      allowedEmptyState: {
        kind: "starting_action",
        actionId: "open-opportunities"
      }
    });
    expect(AMBIENT_GLOBAL_PILOT_SURFACE_CONTRACT.recoveryBehavior.nextActionIds).toEqual([
      "open-opportunities",
      "dismiss-global-pilot-context"
    ]);
    expect(Object.isFrozen(AMBIENT_GLOBAL_PILOT_SURFACE_CONTRACT)).toBe(true);
  });

  test("registers exact close and choose-opportunity outcomes", () => {
    expect(AMBIENT_GLOBAL_PILOT_DISMISS_ACTION).toMatchObject({
      id: "dismiss-global-pilot-context",
      authorityLevel: "presentation",
      receiptType: "resolved"
    });
    expect(AMBIENT_GLOBAL_PILOT_CHOOSE_ACTION).toMatchObject({
      id: "open-opportunities",
      authorityLevel: "presentation",
      executionTarget: { kind: "route", surfaceId: "opportunities" }
    });
  });
});
