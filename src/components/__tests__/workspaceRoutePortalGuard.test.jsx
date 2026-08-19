// @vitest-environment jsdom
import React, { act } from "react";
import { createRoot } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, test, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  appProps: null,
  navigation: null
}));

vi.mock("quotepilot-active-app", () => ({
  default: (props) => {
    mocks.appProps = props;
    return <div data-testid="workspace-app" />;
  }
}));

vi.mock("../../context/EventTypeContext", () => ({
  EventTypeProvider: ({ children }) => children
}));

vi.mock("../../context/OrganizationContext", () => ({
  OrganizationProvider: ({ children }) => children
}));

vi.mock("../../context/WorkspaceNavigationContext", () => ({
  useWorkspaceNavigation: () => mocks.navigation,
  WorkspaceNavigationProvider: ({ children }) => children
}));

vi.mock("../QuoteWorkspaceConceptPage", () => ({
  default: () => <div data-testid="quote-workspace-concept-mock" />
}));

import { ScopedWorkspaceRoute } from "../WorkspaceRoute";

globalThis.IS_REACT_ACT_ENVIRONMENT = true;

const tenantContext = { hostname: "localhost", organizationId: "org-a" };
const authSession = {
  loading: false,
  user: { uid: "owner-a" },
  organizationId: "org-a",
  role: "admin",
  platformAdmin: false
};

let container;
let root;

function workspaceNavigation() {
  return {
    route: { surface: "workspace", routeId: "catalog" },
    location: { pathname: "/app/catalog", search: "", hash: "", state: { from: "library" } },
    replace: vi.fn()
  };
}

function renderRoute(session = authSession) {
  act(() => {
    root.render(<ScopedWorkspaceRoute tenantContext={tenantContext} authSession={session} />);
  });
}

beforeEach(() => {
  window.history.replaceState({}, "", "/app/catalog");
  container = document.createElement("div");
  document.body.appendChild(container);
  root = createRoot(container);
  mocks.appProps = null;
  mocks.navigation = workspaceNavigation();
});

afterEach(() => {
  act(() => root.unmount());
  container.remove();
  vi.restoreAllMocks();
});

describe("workspace customer-portal transition guard", () => {
  test("keeps the authenticated scope mounted until App accepts portal navigation", () => {
    renderRoute();
    mocks.navigation.route = { surface: "portal", routeId: "portal", portalToken: "portal-token" };
    mocks.navigation.location = {
      pathname: "/app/catalog",
      search: "?portal=portal-token",
      hash: "",
      state: null
    };

    renderRoute();

    expect(mocks.appProps.portalRouteAllowed).toBe(false);
    expect(mocks.appProps.committedPortalToken).toBe("");

    act(() => mocks.appProps.onPortalScopeCommit("portal-token"));

    expect(mocks.appProps.portalRouteAllowed).toBe(true);
    expect(mocks.appProps.committedPortalToken).toBe("portal-token");
  });

  test("preserves direct portal-token precedence on the initial mount", () => {
    mocks.navigation = {
      route: { surface: "portal", routeId: "portal", portalToken: "direct-token" },
      location: { pathname: "/app", search: "?portal=direct-token", hash: "", state: null },
      replace: vi.fn()
    };
    const confirm = vi.spyOn(window, "confirm");

    renderRoute();

    expect(confirm).not.toHaveBeenCalled();
    expect(mocks.navigation.replace).not.toHaveBeenCalled();
    expect(mocks.appProps.portalRouteAllowed).toBe(true);
    expect(mocks.appProps.committedPortalToken).toBe("direct-token");
  });

  test("requires a new commit before changing from one portal token to another", () => {
    mocks.navigation = {
      route: { surface: "portal", routeId: "portal", portalToken: "portal-a" },
      location: { pathname: "/app", search: "?portal=portal-a", hash: "", state: null },
      replace: vi.fn()
    };
    renderRoute();
    expect(mocks.appProps.portalRouteAllowed).toBe(true);

    mocks.navigation.route = { surface: "portal", routeId: "portal", portalToken: "portal-b" };
    mocks.navigation.location = {
      pathname: "/app",
      search: "?portal=portal-b",
      hash: "",
      state: null
    };
    renderRoute();

    expect(mocks.appProps.portalRouteAllowed).toBe(false);
    expect(mocks.appProps.committedPortalToken).toBe("portal-a");
  });
});

describe("quote workspace concept authority", () => {
  test("keeps the normal authenticated app boundary while auth is unresolved", () => {
    window.history.replaceState({}, "", "/app/quote-workspace");
    renderRoute({ ...authSession, user: null, role: "" });

    expect(container.querySelector('[data-testid="workspace-app"]')).not.toBeNull();
    expect(container.querySelector('[data-testid="quote-workspace-concept-mock"]')).toBeNull();
  });

  test("denies non-staff principals without mounting the quote workspace", () => {
    window.history.replaceState({}, "", "/app/quote-workspace");
    renderRoute({ ...authSession, role: "customer" });

    expect(container.querySelector('[data-testid="quote-workspace-role-boundary"]')).not.toBeNull();
    expect(container.textContent).toContain("Staff access required");
    expect(container.querySelector('[data-testid="quote-workspace-concept-mock"]')).toBeNull();
  });

  test("loads the concept only for an authenticated staff role", async () => {
    window.history.replaceState({}, "", "/app/quote-workspace-concept");
    renderRoute();
    await act(async () => Promise.resolve());

    expect(container.querySelector('[data-testid="quote-workspace-concept-mock"]')).not.toBeNull();
    expect(container.querySelector('[data-testid="workspace-app"]')).toBeNull();
  });
});
