// @vitest-environment jsdom
import React, { act } from "react";
import { createRoot } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, test, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  appProps: null,
  conceptProps: null,
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
  default: (props) => {
    mocks.conceptProps = props;
    return <div data-testid="quote-workspace-page" />;
  }
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

function renderRoute() {
  act(() => {
    root.render(<ScopedWorkspaceRoute tenantContext={tenantContext} authSession={authSession} />);
  });
}

async function renderRouteAsync() {
  await act(async () => {
    root.render(<ScopedWorkspaceRoute tenantContext={tenantContext} authSession={authSession} />);
    await Promise.resolve();
  });
}

beforeEach(() => {
  container = document.createElement("div");
  document.body.appendChild(container);
  root = createRoot(container);
  mocks.appProps = null;
  mocks.conceptProps = null;
  mocks.navigation = workspaceNavigation();
  window.history.replaceState({}, "", "/app/catalog");
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

describe("connected quote workspace route", () => {
  test.each([
    "/app/quote-workspace",
    "/app/quote-workspace-concept"
  ])("mounts the isolated page before the legacy route parser for %s", async (pathname) => {
    window.history.replaceState({}, "", pathname);

    await renderRouteAsync();

    expect(container.querySelector('[data-testid="quote-workspace-page"]')).not.toBeNull();
    expect(mocks.appProps).toBeNull();
    expect(mocks.conceptProps).toMatchObject({ tenantContext, authSession });

    act(() => mocks.conceptProps.onExit());

    expect(mocks.navigation.replace).toHaveBeenCalledWith(
      "/app/quotes",
      { preserveSearch: false, preserveHash: false }
    );
  });

  test("preserves portal-token precedence over the workspace alias", () => {
    window.history.replaceState({}, "", "/app/quote-workspace");
    mocks.navigation.route = {
      surface: "portal",
      routeId: "portal",
      portalToken: "customer-token"
    };

    renderRoute();

    expect(mocks.conceptProps).toBeNull();
    expect(mocks.appProps.committedPortalToken).toBe("customer-token");
  });
});
