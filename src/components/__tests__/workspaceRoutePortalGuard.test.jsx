// @vitest-environment jsdom
import React, { act } from "react";
import { createRoot } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, test, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  appProps: null,
  feedbackComponent: null,
  navigation: null,
  workspaceProps: null
}));

vi.mock("quotepilot-active-app", () => ({
  default: (props) => {
    mocks.appProps = props;
    const FeedbackComponent = mocks.feedbackComponent;
    return (
      <div data-testid="workspace-app">
        {FeedbackComponent ? <FeedbackComponent /> : null}
      </div>
    );
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
    mocks.workspaceProps = props;
    const FeedbackComponent = mocks.feedbackComponent;
    return (
      <div data-testid="quote-workspace-mock">
        {FeedbackComponent ? <FeedbackComponent /> : null}
      </div>
    );
  }
}));

import { ScopedWorkspaceRoute } from "../WorkspaceRoute";
import { useWorkspaceActionFeedback } from "../../context/WorkspaceActionFeedbackContext";

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
    navigate: vi.fn(),
    replace: vi.fn()
  };
}

function renderRoute(session = authSession) {
  act(() => {
    root.render(<ScopedWorkspaceRoute tenantContext={tenantContext} authSession={session} />);
  });
}

function RouteFeedbackProbe() {
  const feedback = useWorkspaceActionFeedback();
  return (
    <div>
      <output
        data-testid="route-feedback-probe"
        data-available={String(feedback.available)}
        data-count={String(feedback.feedbackRecords.length)}
        data-attempt={feedback.currentFeedback?.attemptId || ""}
        data-phase={feedback.currentFeedback?.phase || ""}
      />
      <button
        type="button"
        data-testid="begin-route-feedback"
        onClick={() => feedback.beginActionFeedback({
          actionId: "save-follow-up",
          actionLabel: "Save follow-up",
          generation: "route-generation-one",
          object: { kind: "quote", id: "quote-101", label: "Quote 101" },
          message: "Saving the follow-up record.",
          changed: ["Follow-up save requested"],
          unchanged: ["Quote status remains unchanged"]
        })}
      >
        Begin route feedback
      </button>
      <button
        type="button"
        data-testid="complete-route-feedback"
        onClick={() => feedback.transitionActionFeedback({
          attemptId: feedback.currentFeedback?.attemptId,
          generation: feedback.currentFeedback?.generation,
          phase: "succeeded",
          message: "The follow-up is confirmed.",
          changed: ["Follow-up confirmed"],
          evidence: {
            kind: "authoritative_readback",
            id: "route-readback-101",
            source: "route-test"
          }
        })}
      >
        Complete route feedback
      </button>
    </div>
  );
}

beforeEach(() => {
  window.history.replaceState({}, "", "/app/catalog");
  container = document.createElement("div");
  document.body.appendChild(container);
  root = createRoot(container);
  mocks.appProps = null;
  mocks.feedbackComponent = null;
  mocks.workspaceProps = null;
  mocks.navigation = workspaceNavigation();
});

afterEach(() => {
  act(() => root.unmount());
  container.remove();
  vi.unstubAllEnvs();
  vi.restoreAllMocks();
});

describe("workspace customer-portal transition guard", () => {
  test("keeps the authenticated scope mounted until App accepts portal navigation", () => {
    mocks.feedbackComponent = RouteFeedbackProbe;
    renderRoute();
    expect(container.querySelector('[data-testid="route-feedback-probe"]').dataset.available)
      .toBe("true");
    expect(container.querySelectorAll('[data-testid="workspace-action-feedback-announcer"]'))
      .toHaveLength(1);
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
    expect(container.querySelector('[data-testid="route-feedback-probe"]').dataset.available)
      .toBe("false");
    expect(container.querySelectorAll('[data-testid="workspace-action-feedback-announcer"]'))
      .toHaveLength(0);

    act(() => mocks.appProps.onPortalScopeCommit("portal-token"));

    expect(mocks.appProps.portalRouteAllowed).toBe(true);
    expect(mocks.appProps.committedPortalToken).toBe("portal-token");
    expect(container.querySelector('[data-testid="route-feedback-probe"]').dataset.available)
      .toBe("false");
    expect(container.querySelectorAll('[data-testid="workspace-action-feedback-announcer"]'))
      .toHaveLength(0);
  });

  test("preserves direct portal-token precedence on the initial mount", () => {
    mocks.feedbackComponent = RouteFeedbackProbe;
    mocks.navigation = {
      route: { surface: "portal", routeId: "portal", portalToken: "direct-token" },
      location: { pathname: "/app", search: "?portal=direct-token", hash: "", state: null },
      navigate: vi.fn(),
      replace: vi.fn()
    };
    const confirm = vi.spyOn(window, "confirm");

    renderRoute();

    expect(confirm).not.toHaveBeenCalled();
    expect(mocks.navigation.replace).not.toHaveBeenCalled();
    expect(mocks.appProps.portalRouteAllowed).toBe(true);
    expect(mocks.appProps.committedPortalToken).toBe("direct-token");
    expect(container.querySelector('[data-testid="route-feedback-probe"]').dataset.available)
      .toBe("false");
    expect(container.querySelectorAll('[data-testid="workspace-action-feedback-announcer"]'))
      .toHaveLength(0);
  });

  test("requires a new commit before changing from one portal token to another", () => {
    mocks.navigation = {
      route: { surface: "portal", routeId: "portal", portalToken: "portal-a" },
      location: { pathname: "/app", search: "?portal=portal-a", hash: "", state: null },
      navigate: vi.fn(),
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

describe("canonical quote workspace authority", () => {
  test("dismisses terminal feedback from the compatibility workspace with its exact revision", async () => {
    vi.stubEnv("VITE_AMBIENT_UI_ENABLED", "true");
    mocks.feedbackComponent = RouteFeedbackProbe;
    window.history.replaceState({}, "", "/app/quotes/quote-101");
    mocks.navigation = {
      route: { surface: "workspace", routeId: "quote-detail", params: { quoteId: "quote-101" } },
      location: { pathname: "/app/quotes/quote-101", search: "", hash: "", state: null },
      navigate: vi.fn(),
      replace: vi.fn()
    };
    renderRoute();
    act(() => container.querySelector('[data-testid="begin-route-feedback"]').click());
    act(() => container.querySelector('[data-testid="complete-route-feedback"]').click());
    expect(container.querySelector('[data-testid="route-feedback-probe"]').dataset.phase)
      .toBe("succeeded");

    window.history.replaceState({}, "", "/app/quote-workspace?quoteId=quote-101");
    mocks.navigation = {
      route: { surface: "workspace", routeId: "quote-workspace" },
      location: {
        pathname: "/app/quote-workspace",
        search: "?quoteId=quote-101",
        hash: "",
        state: null
      },
      navigate: vi.fn(),
      replace: vi.fn()
    };
    renderRoute();
    await act(async () => Promise.resolve());

    const dismiss = Array.from(container.querySelectorAll(
      '[data-compatibility-action-feedback="true"] button'
    )).find((button) => button.textContent === "Dismiss");
    expect(dismiss).toBeTruthy();
    act(() => dismiss.click());

    expect(container.querySelector('[data-testid="route-feedback-probe"]').dataset.count).toBe("0");
    expect(container.querySelector('[data-compatibility-action-feedback="true"]')).toBeNull();
  });

  test("preserves exact same-runtime feedback across both authorized workspace branches", async () => {
    vi.stubEnv("VITE_AMBIENT_UI_ENABLED", "true");
    mocks.feedbackComponent = RouteFeedbackProbe;
    window.history.replaceState({}, "", "/app/quotes/quote-101");
    mocks.navigation = {
      route: { surface: "workspace", routeId: "quote-detail", params: { quoteId: "quote-101" } },
      location: { pathname: "/app/quotes/quote-101", search: "", hash: "", state: null },
      navigate: vi.fn(),
      replace: vi.fn()
    };
    renderRoute();
    expect(container.querySelector('[data-testid="workspace-app"]')).not.toBeNull();
    act(() => container.querySelector('[data-testid="begin-route-feedback"]').click());
    const activeAttempt = container.querySelector('[data-testid="route-feedback-probe"]')
      .dataset.attempt;
    expect(activeAttempt).toBeTruthy();
    expect(container.querySelector('[data-testid="route-feedback-probe"]').dataset.count).toBe("1");
    const initialAnnouncers = container.querySelectorAll(
      '[data-testid="workspace-action-feedback-announcer"]'
    );
    expect(initialAnnouncers).toHaveLength(1);
    const providerAnnouncer = initialAnnouncers[0];
    const announcementId = providerAnnouncer.dataset.actionFeedbackAnnouncementId;
    const announcementText = providerAnnouncer.textContent;
    expect(announcementId).toBeTruthy();
    expect(announcementText).toContain("Save follow-up");
    expect(container.querySelector('[data-testid="workspace-app"]').contains(providerAnnouncer))
      .toBe(false);

    const announcementMutations = [];
    const announcementObserver = new MutationObserver((records) => {
      announcementMutations.push(...records);
    });
    announcementObserver.observe(providerAnnouncer, {
      attributes: true,
      characterData: true,
      childList: true,
      subtree: true
    });

    try {
      window.history.replaceState({}, "", "/app/quote-workspace?quoteId=quote-101");
      mocks.navigation = {
        route: { surface: "workspace", routeId: "quote-workspace" },
        location: {
          pathname: "/app/quote-workspace",
          search: "?quoteId=quote-101",
          hash: "",
          state: null
        },
        navigate: vi.fn(),
        replace: vi.fn()
      };
      renderRoute();
      await act(async () => Promise.resolve());

      const compatibilityWorkspace = container.querySelector(
        '[data-testid="quote-workspace-mock"]'
      );
      expect(compatibilityWorkspace).not.toBeNull();
      expect(container.querySelector('[data-testid="route-feedback-probe"]').dataset.attempt)
        .toBe(activeAttempt);
      const compatibilityNotice = container.querySelector(
        '[data-compatibility-action-feedback="true"] [data-testid="workspace-action-feedback"]'
      );
      expect(compatibilityNotice).not.toBeNull();
      expect(compatibilityNotice.dataset.actionFeedbackAttemptId).toBe(activeAttempt);
      expect(compatibilityNotice.textContent).toContain("Quote status remains unchanged");
      const compatibilityAnnouncers = container.querySelectorAll(
        '[data-testid="workspace-action-feedback-announcer"]'
      );
      expect(compatibilityAnnouncers).toHaveLength(1);
      expect(compatibilityAnnouncers[0]).toBe(providerAnnouncer);
      expect(compatibilityWorkspace.contains(providerAnnouncer)).toBe(false);
      expect(providerAnnouncer.dataset.actionFeedbackAnnouncementId).toBe(announcementId);
      expect(providerAnnouncer.textContent).toBe(announcementText);

      window.history.replaceState({}, "", "/app/quotes/quote-101");
      mocks.navigation = {
        route: { surface: "workspace", routeId: "quote-detail", params: { quoteId: "quote-101" } },
        location: { pathname: "/app/quotes/quote-101", search: "", hash: "", state: null },
        navigate: vi.fn(),
        replace: vi.fn()
      };
      renderRoute();
      await act(async () => Promise.resolve());

      const ambientWorkspace = container.querySelector('[data-testid="workspace-app"]');
      expect(ambientWorkspace).not.toBeNull();
      expect(container.querySelector('[data-testid="route-feedback-probe"]').dataset.attempt)
        .toBe(activeAttempt);
      const ambientAnnouncers = container.querySelectorAll(
        '[data-testid="workspace-action-feedback-announcer"]'
      );
      expect(ambientAnnouncers).toHaveLength(1);
      expect(ambientAnnouncers[0]).toBe(providerAnnouncer);
      expect(ambientWorkspace.contains(providerAnnouncer)).toBe(false);
      expect(providerAnnouncer.dataset.actionFeedbackAnnouncementId).toBe(announcementId);
      expect(providerAnnouncer.textContent).toBe(announcementText);

      await act(async () => Promise.resolve());
      expect(announcementMutations).toHaveLength(0);
    } finally {
      announcementObserver.disconnect();
    }
  });

  test("removes prior staff feedback while auth is unresolved even when identity is retained", () => {
    mocks.feedbackComponent = RouteFeedbackProbe;
    window.history.replaceState({}, "", "/app/quote-workspace");
    renderRoute();
    act(() => container.querySelector('[data-testid="begin-route-feedback"]').click());
    expect(container.querySelector('[data-testid="route-feedback-probe"]').dataset.count).toBe("1");
    expect(container.querySelectorAll('[data-testid="workspace-action-feedback-announcer"]'))
      .toHaveLength(1);

    renderRoute({ ...authSession, loading: true });

    expect(container.querySelector('[data-testid="workspace-app"]')).not.toBeNull();
    expect(container.querySelector('[data-testid="quote-workspace-mock"]')).toBeNull();
    expect(container.querySelector('[data-testid="route-feedback-probe"]').dataset.available)
      .toBe("false");
    expect(container.querySelectorAll('[data-testid="workspace-action-feedback-announcer"]'))
      .toHaveLength(0);
  });

  test("keeps customer workspace routes outside the staff feedback provider", () => {
    mocks.feedbackComponent = RouteFeedbackProbe;
    renderRoute({ ...authSession, role: "customer" });

    expect(container.querySelector('[data-testid="workspace-app"]')).not.toBeNull();
    expect(container.querySelector('[data-testid="route-feedback-probe"]').dataset.available)
      .toBe("false");
    act(() => container.querySelector('[data-testid="begin-route-feedback"]').click());
    expect(container.querySelector('[data-testid="route-feedback-probe"]').dataset.count).toBe("0");
    expect(container.querySelectorAll('[data-testid="workspace-action-feedback-announcer"]'))
      .toHaveLength(0);
  });

  test("denies non-staff principals without mounting the quote workspace", () => {
    window.history.replaceState({}, "", "/app/quote-workspace");
    renderRoute({ ...authSession, role: "customer" });

    expect(container.querySelector('[data-testid="quote-workspace-role-boundary"]')).not.toBeNull();
    expect(container.textContent).toContain("Staff access required");
    expect(container.querySelector('[data-testid="quote-workspace-mock"]')).toBeNull();
    expect(container.querySelectorAll('[data-testid="workspace-action-feedback-announcer"]'))
      .toHaveLength(0);
  });

  test("keeps the former concept path as an authenticated compatibility alias", async () => {
    window.history.replaceState({}, "", "/app/quote-workspace-concept");
    renderRoute();
    await act(async () => Promise.resolve());

    expect(container.querySelector('[data-testid="quote-workspace-mock"]')).not.toBeNull();
    expect(container.querySelector('[data-testid="workspace-app"]')).toBeNull();
  });

  test("promotes an exact quote route to the canonical workspace and preserves identity", async () => {
    window.history.replaceState({}, "", "/app/quotes/quote-101");
    mocks.navigation = {
      route: { surface: "workspace", routeId: "quote-detail", params: { quoteId: "quote-101" } },
      location: { pathname: "/app/quotes/quote-101", search: "", hash: "", state: null },
      navigate: vi.fn(),
      replace: vi.fn()
    };

    renderRoute();
    await act(async () => Promise.resolve());

    expect(container.querySelector('[data-testid="quote-workspace-mock"]')).not.toBeNull();
    expect(mocks.workspaceProps.quoteId).toBe("quote-101");
    expect(container.querySelector('[data-testid="workspace-app"]')).toBeNull();
  });

  test("keeps an exact quote route in the approved Ambient opportunity workspace", () => {
    vi.stubEnv("VITE_AMBIENT_UI_ENABLED", "true");
    window.history.replaceState({}, "", "/app/quotes/quote-101");
    mocks.navigation = {
      route: { surface: "workspace", routeId: "quote-detail", params: { quoteId: "quote-101" } },
      location: { pathname: "/app/quotes/quote-101", search: "", hash: "", state: null },
      navigate: vi.fn(),
      replace: vi.fn()
    };

    renderRoute();

    expect(container.querySelector('[data-testid="workspace-app"]')).not.toBeNull();
    expect(container.querySelector('[data-testid="quote-workspace-mock"]')).toBeNull();
  });

  test("preserves the explicit quote-administration fallback", () => {
    window.history.replaceState({}, "", "/app/quotes/quote-101?view=administration");
    mocks.navigation = {
      route: { surface: "workspace", routeId: "quote-detail", params: { quoteId: "quote-101" } },
      location: {
        pathname: "/app/quotes/quote-101",
        search: "?view=administration",
        hash: "",
        state: null
      },
      navigate: vi.fn(),
      replace: vi.fn()
    };

    renderRoute();

    expect(container.querySelector('[data-testid="workspace-app"]')).not.toBeNull();
    expect(container.querySelector('[data-testid="quote-workspace-mock"]')).toBeNull();
  });

  test("preserves exact governed administration arrivals", () => {
    window.history.replaceState({}, "", "/app/quotes/quote-101");
    mocks.navigation = {
      route: { surface: "workspace", routeId: "quote-detail", params: { quoteId: "quote-101" } },
      location: {
        pathname: "/app/quotes/quote-101",
        search: "",
        hash: "",
        state: { ambientArrival: { surfaceId: "quote-administration" } }
      },
      navigate: vi.fn(),
      replace: vi.fn()
    };

    renderRoute();

    expect(container.querySelector('[data-testid="workspace-app"]')).not.toBeNull();
    expect(container.querySelector('[data-testid="quote-workspace-mock"]')).toBeNull();
  });
});
