// @vitest-environment jsdom
import React, { act } from "react";
import { createRoot } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, test, vi } from "vitest";

const auth0 = vi.hoisted(() => ({
  providerProps: null,
  state: null,
  loginWithRedirect: vi.fn(),
  logout: vi.fn()
}));

vi.mock("@auth0/auth0-react", () => ({
  Auth0Provider: ({ children, ...props }) => {
    auth0.providerProps = props;
    return children;
  },
  useAuth0: () => auth0.state
}));

import Auth0SetupPage, {
  AUTH0_SETUP_PATH,
  buildAuth0ReturnUrl,
  resolveAuth0Configuration
} from "../Auth0SetupPage";

globalThis.IS_REACT_ACT_ENVIRONMENT = true;

let container;
let root;

function setAuth0State(overrides = {}) {
  auth0.state = {
    isLoading: false,
    isAuthenticated: false,
    error: null,
    loginWithRedirect: auth0.loginWithRedirect,
    logout: auth0.logout,
    user: null,
    ...overrides
  };
}

function renderPage() {
  act(() => root.render(<Auth0SetupPage />));
}

beforeEach(() => {
  vi.clearAllMocks();
  auth0.providerProps = null;
  setAuth0State();
  window.history.replaceState({}, "", AUTH0_SETUP_PATH);
  container = document.createElement("div");
  document.body.appendChild(container);
  root = createRoot(container);
});

afterEach(() => {
  act(() => root.unmount());
  container.remove();
});

describe("Auth0 React SDK verification route", () => {
  test("configures the official provider for the exact local callback route", () => {
    renderPage();

    expect(buildAuth0ReturnUrl("http://localhost:5173"))
      .toBe("http://localhost:5173/auth0");
    expect(auth0.providerProps.domain).toBe("dev-xsvppgzt3vgy0ydn.us.auth0.com");
    expect(auth0.providerProps.clientId).toBe("cMAurgZ60fCyx8KZLBPfGLumsYtvtjhv");
    expect(auth0.providerProps.authorizationParams).toEqual({
      redirect_uri: buildAuth0ReturnUrl(window.location.origin)
    });
  });

  test("requires environment overrides to replace domain and client id together", () => {
    expect(resolveAuth0Configuration({ VITE_AUTH0_DOMAIN: "tenant.example.com" })).toEqual({
      ready: false,
      error: "Set VITE_AUTH0_DOMAIN and VITE_AUTH0_CLIENT_ID together."
    });
    expect(resolveAuth0Configuration({
      VITE_AUTH0_DOMAIN: "tenant.example.com",
      VITE_AUTH0_CLIENT_ID: "client-123"
    })).toMatchObject({
      ready: true,
      domain: "tenant.example.com",
      clientId: "client-123"
    });
  });

  test("renders the SDK loading and error states", () => {
    setAuth0State({ isLoading: true });
    renderPage();
    expect(container.textContent).toContain("Checking Auth0 session");

    setAuth0State({ error: new Error("callback mismatch") });
    renderPage();
    expect(container.querySelector('[role="alert"]').textContent).toContain("callback mismatch");
  });

  test("starts login and signup through the official SDK", () => {
    renderPage();
    const buttons = [...container.querySelectorAll("button")];

    act(() => buttons.find((button) => button.textContent === "Login with Auth0").click());
    expect(auth0.loginWithRedirect).toHaveBeenCalledWith({
      appState: { returnTo: AUTH0_SETUP_PATH }
    });

    act(() => buttons.find((button) => button.textContent === "Signup with Auth0").click());
    expect(auth0.loginWithRedirect).toHaveBeenLastCalledWith({
      appState: { returnTo: AUTH0_SETUP_PATH },
      authorizationParams: { screen_hint: "signup" }
    });
  });

  test("shows the Auth0 profile without granting Firebase workspace authority", () => {
    setAuth0State({
      isAuthenticated: true,
      user: { name: "Avery", email: "avery@example.com", sub: "auth0|123" }
    });
    renderPage();

    expect(container.textContent).toContain("Logged in as avery@example.com");
    expect(container.textContent).toContain("does not create a Firebase session");
    expect(container.textContent).toContain("auth0|123");
    expect(container.querySelector('a[href="/app"]').textContent).toContain("Firebase Staff Sign In");

    act(() => [...container.querySelectorAll("button")]
      .find((button) => button.textContent === "Logout of Auth0").click());
    expect(auth0.logout).toHaveBeenCalledWith({
      logoutParams: { returnTo: buildAuth0ReturnUrl(window.location.origin) }
    });
  });
});
