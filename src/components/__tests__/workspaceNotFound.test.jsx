import { describe, expect, test } from "vitest";
import { buildWorkspaceUnavailablePresentation } from "../WorkspaceNotFound";

describe("WorkspaceNotFound", () => {
  test("turns an Ambient Library role denial into a contextual recovery", () => {
    expect(buildWorkspaceUnavailablePresentation({
      pathname: "/app/catalog",
      reason: "role-denied",
      routeId: "catalog",
      ambientMode: true
    })).toEqual({
      eyebrow: "Library access",
      title: "Library requires organization admin access",
      description: "Catalog and template settings can change pricing and the starting details used in new quotes. Your current role cannot open or change them.",
      actionLabel: "Return to Now"
    });
  });

  test("preserves the generic unknown-route recovery outside the exact denial", () => {
    expect(buildWorkspaceUnavailablePresentation({ pathname: "/app/missing" })).toEqual({
      eyebrow: "404",
      title: "Workspace page not found",
      description: "/app/missing is not a QuotePilot staff workspace route.",
      actionLabel: "Return home"
    });
  });
});
